import fs from "node:fs";
import path from "node:path";
import type {
  BmadConfig, BmadProject, Epic, UserStory, NextStep, Risk,
  TicketInfo, TicketRef, TicketSummary, TicketState,
} from "../types/index.js";
import {
  loadTicketTree, classifyTickets, inScope, planPath, leafPath,
  type TicketTree, type TicketRow,
} from "./tickets.js";
import { extractFrontmatter } from "./markdown-utils.js";

// ─── Ticket tree → dashboard model ──────────────────────────────────
// The dashboard's Epic/UserStory model is the same one the v4/v5/v6
// parsers fill, so every existing view keeps working. The ticket tree's
// extra facts (ref, type, risk, hitl, prerequisites, the plan) ride along
// on `story.ticket` and are surfaced as badges and panels.

/** Board column for a derived ticket state — BMAD's own mapping. */
export const STATE_TO_COLUMN: Record<TicketState, string> = {
  "planned": "todo",
  "backlog": "todo",
  "in-progress": "active",
  "review": "review",
  "done": "done",
  "dropped": "done",
};

/** Plan status to write when a card is dragged into a column. */
export const COLUMN_TO_STATUS: Record<string, string> = {
  todo: "ready-for-dev",
  active: "in-progress",
  review: "in-review",
  done: "done",
};

/** Epic id the dashboard uses, so epic dependency links resolve as they do elsewhere. */
function epicIdFor(num: number | string): string {
  return `EPIC-${String(num).padStart(2, "0")}`;
}

function relative(projectDir: string, abs: string | null | undefined): string | undefined {
  if (!abs) return undefined;
  return path.relative(projectDir, abs).split(path.sep).join("/");
}

/** Build metadata from a plan's frontmatter that is worth showing on the detail panel. */
const PLAN_META_KEYS = [
  "type", "created", "route", "risk", "review", "baseline_revision",
  "followup_review_recommended", "review_loop_iteration", "warnings",
] as const;

function planMeta(file: string): Record<string, string> | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
  const { data } = extractFrontmatter(text);
  const out: Record<string, string> = {};
  for (const key of PLAN_META_KEYS) {
    const value = data[key];
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[key] = value.map((v) => String(v)).join(", ");
    } else if (typeof value === "object") {
      continue;
    } else {
      out[key] = String(value);
    }
  }
  const deferred = data.deferred;
  if (Array.isArray(deferred) && deferred.length > 0) {
    out.deferred = `${deferred.length} deferred item${deferred.length === 1 ? "" : "s"}`;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Decorate a bare ref with the title and state of whatever it names. */
function decorateRefs(refs: string[], byRef: Map<string, TicketRow>, epicTitles: Map<string, string>): TicketRef[] {
  return refs.map((ref) => {
    const hit = byRef.get(ref);
    if (hit) return { ref, title: hit.title, state: hit.state };
    const epicTitle = epicTitles.get(ref);
    if (epicTitle !== undefined) return { ref, title: epicTitle, isEpic: true };
    return { ref };
  });
}

function toTicketInfo(
  t: TicketRow,
  tree: TicketTree,
  config: BmadConfig,
  byRef: Map<string, TicketRow>,
  epicTitles: Map<string, string>,
): TicketInfo {
  const plan = planPath(t, tree);
  const planExists = !!t.plan && fs.existsSync(plan);
  const leaf = leafPath(t, tree);

  return {
    ref: t.ref,
    entryId: String(t.id ?? t.file ?? ""),
    epicSlug: t.epic,
    type: t.type,
    state: t.state,
    status: t.status,
    hitl: t.hitl,
    risk: t.risk || undefined,
    covers: t.covers,
    verify: t.verify || undefined,
    notes: t.notes,
    references: t.references,
    unknown: t.unknown || undefined,
    refine: t.refine,
    refined: t.refined,
    assignee: t.assignee || undefined,
    blockedAt: t.blockedAt || undefined,
    blockedReason: t.blockedReason || undefined,
    estimate: t.estimate === "" ? undefined : t.estimate,
    after: decorateRefs(t.afterRefs, byRef, epicTitles),
    waitingOn: t.waitingOn ? decorateRefs(t.waitingOn, byRef, epicTitles) : undefined,
    blocks: decorateRefs(t.blocks, byRef, epicTitles),
    planPath: planExists ? relative(config.projectDir, plan) : undefined,
    planTarget: relative(config.projectDir, plan),
    leafPath: relative(config.projectDir, leaf),
    planMeta: planExists ? planMeta(plan) : undefined,
    drift: t.drift ? Object.keys(t.drift) : undefined,
  };
}

/** An epic is done when every ticket under it is; in progress once any has started. */
function epicStatusFrom(container: { status: string }, stories: UserStory[]): string {
  if (container.status === "done") return "done";
  if (container.status === "in-progress") return "in-progress";
  if (stories.length === 0) return "backlog";
  const states = stories.map((s) => s.ticket?.state ?? "planned");
  const live = states.filter((s) => s !== "dropped");
  if (live.length > 0 && live.every((s) => s === "done")) return "done";
  if (live.some((s) => s === "in-progress" || s === "review" || s === "done")) return "in-progress";
  return "backlog";
}

/** Planning document folders under the initiative (spec-*, prd-*, architecture-*, ux-*, research-*, ...). */
export function planningFolders(initiativeDir: string | undefined): string[] {
  if (!initiativeDir || !fs.existsSync(initiativeDir)) return [];
  return fs
    .readdirSync(initiativeDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("epic-"))
    .map((e) => e.name)
    .sort();
}

export interface TicketParseResult {
  epics: Epic[];
  summary: TicketSummary;
  nextStep: NextStep | null;
  risks: Risk[];
  /** The tree itself, so write-backs can reuse the resolved rows. */
  tree: TicketTree;
}

/**
 * Read the ticket tree for a resolved 6.13+ config and project it onto the
 * dashboard's epic/story model.
 */
export function parseTicketTree(config: BmadConfig): TicketParseResult | null {
  if (!config.initiativeDir || !fs.existsSync(config.initiativeDir)) return null;

  const tree = loadTicketTree(config.initiativeDir);
  const groups = classifyTickets(tree);

  const byRef = new Map<string, TicketRow>();
  for (const t of tree.tickets) byRef.set(t.ref, t);
  const epicTitles = new Map<string, string>();
  for (const c of tree.containers) epicTitles.set(c.slug, c.title);

  // ── Epics, in the initiative's build order ──
  const epics: Epic[] = [];
  const initiativeName = path.basename(tree.initiative ?? tree.root);

  for (const c of tree.containers) {
    const num = c.id ?? c.slug;
    const stories: UserStory[] = [];
    // tree.tickets is already in build order within each folder.
    for (const t of tree.tickets) {
      if (t.epic !== c.slug) continue;
      stories.push(toUserStory(t, tree, config, byRef, epicTitles));
    }

    const { data } = readContainer(c.file);
    const dependsOn: number[] = [];
    const dependsOnNeeds: Record<string, string> = {};
    for (const edge of c.declaredAfter) {
      if (typeof edge.epicId === "number") {
        dependsOn.push(edge.epicId);
        if (edge.needs) dependsOnNeeds[String(edge.epicId)] = edge.needs;
      }
    }

    epics.push({
      id: epicIdFor(num),
      title: c.title,
      description: data.description,
      stories,
      status: epicStatusFrom(c, stories),
      dependsOn: dependsOn.length ? dependsOn : undefined,
      dependsOnNeeds: Object.keys(dependsOnNeeds).length ? dependsOnNeeds : undefined,
      gatedBy: c.after.length ? c.after : undefined,
      requirements: c.covers.length ? c.covers : undefined,
      ticketSlug: c.slug,
      sourceFile: relative(config.projectDir, c.file),
    });
  }

  // ── Leaves with no epic: the initiative folder itself, and the backlog ──
  const loose = tree.tickets.filter((t) => !tree.containers.some((c) => c.slug === t.epic));
  const backlogStories: UserStory[] = loose
    .filter((t) => t.epic === initiativeName)
    .map((t) => toUserStory(t, tree, config, byRef, epicTitles));

  if (config.backlogDir && fs.existsSync(config.backlogDir)) {
    try {
      const backlogTree = loadTicketTree(config.backlogDir);
      for (const t of backlogTree.tickets) {
        backlogStories.push(toUserStory(t, backlogTree, config, byRef, epicTitles));
      }
      tree.problems.push(...backlogTree.problems.map((p) => `backlog: ${p}`));
    } catch (err: any) {
      tree.problems.push(`backlog: ${err?.message ?? "could not be read"}`);
    }
  }

  if (backlogStories.length > 0) {
    epics.push({
      id: epicIdFor(99),
      title: "Backlog",
      description: "Tickets with no epic.",
      stories: backlogStories,
      status: epicStatusFrom({ status: "" }, backlogStories),
      ticketSlug: "backlog",
    });
  }

  const summary: TicketSummary = {
    initiative: initiativeName,
    initiativeTitle: tree.initiativeTitle,
    counts: tree.counts,
    longestRemainingChain: tree.longestRemainingChain,
    readyToStart: groups.readyToStart.map((t) => t.ref),
    readyToRefine: groups.readyToRefine.map((t) => t.ref),
    inProgress: groups.inProgress.map((t) => t.ref),
    blocked: groups.blocked.map((t) => t.ref),
    problems: tree.problems,
    unpinnedAfter: tree.unpinnedAfter,
    undeclaredAfter: tree.undeclaredAfter,
    orderConflict: tree.orderConflict,
    planningFolders: planningFolders(config.initiativeDir),
  };

  return {
    epics,
    summary,
    nextStep: computeTicketNextStep(groups),
    risks: computeTicketRisks(tree, groups),
    tree,
  };
}

function readContainer(file: string): { data: { description: string } } {
  try {
    const text = fs.readFileSync(file, "utf-8");
    const { body } = extractFrontmatter(text);
    // The Description section of an epic's ticket file.
    const m = body.match(/^##\s+Description\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/m);
    return { data: { description: (m?.[1] ?? "").trim() } };
  } catch {
    return { data: { description: "" } };
  }
}

function toUserStory(
  t: TicketRow,
  tree: TicketTree,
  config: BmadConfig,
  byRef: Map<string, TicketRow>,
  epicTitles: Map<string, string>,
): UserStory {
  const info = toTicketInfo(t, tree, config, byRef, epicTitles);
  const plan = t.plan ? planPath(t, tree) : null;
  const leaf = leafPath(t, tree);
  return {
    id: t.ref,
    title: t.title,
    description: t.description,
    // A ticket's acceptance lives in the plan, not in a checklist the
    // dashboard owns, so nothing here is writable — see the README.
    acceptanceCriteria: [],
    tasks: [],
    status: STATE_TO_COLUMN[t.state],
    rawStatus: t.status || t.state,
    statusSource: "file",
    epicRef: t.epic,
    // The plan is the richest view of a built ticket; fall back to the leaf file.
    sourceFile: plan ?? leaf ?? undefined,
    ticket: info,
  };
}

// ─── Next step & risks ──────────────────────────────────────────────
// The 6.13+ skills replace v6's workflow ids: a ticket is built with
// /bmad-build, refined with /bmad-ticket and reviewed with /bmad-code-review.

function step(skill: string, label: string, targetId?: string, arg?: string): NextStep {
  return { workflowId: skill, targetId, label, command: arg ? `/${skill} ${arg}` : `/${skill}` };
}

/** What `tickets.py next` would tell you to do, as a dashboard recommendation. */
export function computeTicketNextStep(groups: {
  readyToStart: TicketRow[]; readyToRefine: TicketRow[]; inProgress: TicketRow[]; blocked: TicketRow[];
}): NextStep | null {
  const active = groups.inProgress.find((t) => t.state === "in-progress");
  if (active) {
    return step("bmad-build", `Continue the build of ${active.ref} — ${active.title}`, active.ref, active.ref);
  }

  const review = groups.inProgress.find((t) => t.state === "review");
  if (review) {
    return step("bmad-code-review", `Review ${review.ref} — ${review.title}`, review.ref, review.ref);
  }

  const ready = groups.readyToStart[0];
  if (ready) {
    return step("bmad-build", `Start ${ready.ref} — ${ready.title}`, ready.ref, ready.ref);
  }

  const refine = groups.readyToRefine[0];
  if (refine) {
    return step("bmad-ticket", `Refine ${refine.ref} — ${refine.title}`, refine.ref, `refine ${refine.ref}`);
  }

  if (groups.blocked.length > 0) {
    const first = groups.blocked[0];
    const waiting = (first.waitingOn ?? []).join(", ");
    return step(
      "bmad-ticket",
      waiting
        ? `Nothing is ready: ${first.ref} waits on ${waiting}`
        : `Nothing is ready: ${first.ref} is blocked`,
      first.ref,
    );
  }

  return step("", "Every ticket is done — nice work!");
}

export function computeTicketRisks(
  tree: TicketTree,
  groups: { readyToStart: TicketRow[]; readyToRefine: TicketRow[]; inProgress: TicketRow[]; blocked: TicketRow[] },
): Risk[] {
  const risks: Risk[] = [];
  const scoped = inScope(tree);

  const inReview = scoped.filter((t) => t.state === "review").length;
  if (inReview > 0) {
    risks.push({
      level: "info",
      message: `${inReview} ${inReview === 1 ? "ticket is" : "tickets are"} built and awaiting sign-off.`,
    });
  }

  const hitl = groups.readyToStart.filter((t) => t.hitl);
  if (hitl.length > 0) {
    risks.push({
      level: "info",
      message: `${hitl.length} ready ${hitl.length === 1 ? "ticket needs" : "tickets need"} a human step (${hitl.map((t) => t.ref).join(", ")}).`,
    });
  }

  const explicitlyBlocked = groups.blocked.filter((t) => t.status === "blocked" || t.blockedAt);
  for (const t of explicitlyBlocked) {
    risks.push({
      level: "warning",
      message: `${t.ref} is blocked${t.blockedReason ? `: ${t.blockedReason}` : ""}.`,
    });
  }

  if (groups.readyToStart.length === 0 && groups.inProgress.length === 0 && groups.blocked.length > 0) {
    risks.push({
      level: "warning",
      message: "Nothing is ready to start — every remaining ticket is waiting on a prerequisite.",
    });
  }

  const highRisk = groups.readyToStart.filter((t) => t.risk === "high").length;
  if (highRisk > 0) {
    risks.push({
      level: "info",
      message: `${highRisk} ready ${highRisk === 1 ? "ticket is" : "tickets are"} marked high risk.`,
    });
  }

  for (const u of tree.unpinnedAfter) {
    risks.push({
      level: "warning",
      message: `${u.epic} declares it waits on ${u.after}${u.needs ? ` (${u.needs})` : ""}, but no ticket in it pins that.`,
    });
  }
  for (const u of tree.undeclaredAfter) {
    risks.push({
      level: "warning",
      message: `${u.ref} waits on ${u.names} in ${u.after}, which ${u.epic} does not declare.`,
    });
  }
  for (const c of tree.orderConflict) {
    risks.push({
      level: "warning",
      message: `${c.epic} waits on ${c.after}, which is later in build order.`,
    });
  }
  for (const p of tree.problems) {
    risks.push({ level: "warning", message: p });
  }

  return risks;
}

// ─── Write-back: status into the plan's frontmatter ─────────────────
// This mirrors `tickets.py mark`: status goes in the plan and nowhere else.
// `tickets.toml` and leaf files are never written.

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;

/** Set a frontmatter key, preserving the file's line endings. */
function setFrontmatterValue(text: string, key: string, value: string): string {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return text;
  const eol = m[1].includes("\r") ? "\r\n" : "\n";
  const lineRe = new RegExp(`^${key}:.*$`, "m");
  let block = m[2];
  if (value === "") {
    block = block.replace(new RegExp(`^${key}:.*(\\r?\\n)?`, "m"), "").replace(/(\r?\n)+$/, "");
  } else if (lineRe.test(block)) {
    block = block.replace(lineRe, `${key}: ${value}`);
  } else {
    block = `${block}${eol}${key}: ${value}`;
  }
  return text.slice(0, m.index! + m[1].length) + block + text.slice(m.index! + m[1].length + m[2].length);
}

/** A single-quoted YAML scalar, the quoting style BMAD's own plans use. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
  /** Absolute path of the plan that was written */
  plan?: string;
  created?: boolean;
}

/**
 * Write a ticket's status into its plan's frontmatter, creating a
 * frontmatter-only plan when there is none. Never touches `tickets.toml`
 * or a leaf file.
 */
export function writeTicketStatus(
  tree: TicketTree,
  ref: string,
  status: string,
  opts?: { blockedReason?: string },
): WriteResult {
  const t = tree.tickets.find((x) => x.ref === ref);
  if (!t) return { ok: false, error: `No ticket matches ${ref}` };

  const file = planPath(t, tree);
  const blocked = opts?.blockedReason
    ? { blocked_at: quoted(new Date().toISOString().slice(0, 10)), blocked_reason: quoted(opts.blockedReason) }
    : { blocked_at: "", blocked_reason: "" };

  if (!t.plan) {
    // A frontmatter-only plan, exactly as `tickets.py mark` writes one.
    const fields: [string, string][] = [
      ["title", quoted(t.title)],
      ["ticket", t.id !== null ? String(t.id) : quoted((t.file ?? "").slice(0, -3))],
      ["status", status],
      ["assignee", t.assignee ? quoted(t.assignee) : ""],
      ...Object.entries(blocked),
    ];
    const text = `---\n${fields.filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}\n`).join("")}---\n`;
    try {
      // "wx": never clobber a file that is not this ticket's plan.
      fs.writeFileSync(file, text, { encoding: "utf-8", flag: "wx" });
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        return { ok: false, error: `${path.basename(file)} exists already and is not the plan for ${ref}` };
      }
      return { ok: false, error: err?.message ?? "could not write the plan" };
    }
    t.plan = path.basename(file);
    t.status = status as TicketRow["status"];
    return { ok: true, plan: file, created: true };
  }

  let text: string;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "could not read the plan" };
  }
  if (!FRONTMATTER_RE.test(text)) {
    return { ok: false, error: `${path.basename(file)} has no frontmatter to write status into` };
  }
  for (const [key, value] of [["status", status], ...Object.entries(blocked)] as [string, string][]) {
    text = setFrontmatterValue(text, key, value);
  }
  try {
    fs.writeFileSync(file, text, "utf-8");
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "could not write the plan" };
  }
  t.status = status as TicketRow["status"];
  return { ok: true, plan: file, created: false };
}

/** Attach the ticket-tree projection to a project being assembled. */
export function applyTicketTree(project: BmadProject, result: TicketParseResult): void {
  project.epics = result.epics;
  project.tickets = result.summary;
  project.nextStep = result.nextStep;
  project.risks = result.risks;
}
