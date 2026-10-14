import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { extractFrontmatter } from "./markdown-utils.js";

// ─── BMAD 6.13+ ticket tree ─────────────────────────────────────────
//
// A port of BMAD's own `_bmad/method/scripts/tickets.py`, which is the
// reference implementation for this layout. Semantics are mirrored rather
// than reinvented: states, `after` resolution, the ready/blocked split and
// the plan-is-the-status rule all follow that script.
//
// Shape of the tree:
//
//   {output_folder}/{active_initiative}/
//     initiative-<slug>.md        container ticket (frontmatter type: initiative)
//     tickets.toml                [[epic]] tables — epics in BUILD ORDER
//     spec-*/ prd-*/ ...          planning documents
//     epic-<slug>/
//       epic-<slug>.md            container ticket (frontmatter type: epic)
//       tickets.toml              [[entry]] tables — leaves in BUILD ORDER
//       <type>-<slug>.md          OPTIONAL leaf file, written once "pulled"
//       <type>-<slug>-plan.md     OPTIONAL build plan — holds the STATUS
//     backlog/                    OPTIONAL leaves with no epic
//
// An entry needs no file to exist: most entries are only rows in
// `tickets.toml` until a build starts. Status lives in the plan, never in
// `tickets.toml` and never in a leaf file.
//
// One deliberate divergence from tickets.py: a reference that resolves to
// nothing is recorded in `problems` and dropped instead of aborting the whole
// read. A dashboard should degrade, not go blank, on one bad `after`.

// ─── Vocabulary ─────────────────────────────────────────────────────

/** Ticket status as a plan records it. "" means no build has started. */
export const TICKET_STATUSES = [
  "draft", "ready-for-dev", "in-progress", "in-review", "built", "done", "blocked", "dropped",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number] | "";

/** Derived state — what a board column is keyed on. */
export const TICKET_STATES = ["planned", "backlog", "in-progress", "review", "done", "dropped"] as const;
export type TicketState = (typeof TICKET_STATES)[number];

/** States a tracker mirrors back into a leaf file (no "planned"). */
const TRACKER_STATES = ["backlog", "in-progress", "review", "done", "dropped"] as const;

/** Statuses a container (initiative/epic) ticket file may carry. */
const CONTAINER_STATUSES = ["in-progress", "done", "dropped"] as const;

export const LEAF_TYPES = ["story", "spike", "bug"] as const;
export type LeafType = (typeof LEAF_TYPES)[number];

const CONTAINER_TYPES = ["initiative", "epic"] as const;

/** BMAD's own status → state mapping (STATE_OF in tickets.py). */
const STATE_OF: Record<string, TicketState> = {
  "": "backlog",
  "draft": "backlog",
  "ready-for-dev": "backlog",
  "in-progress": "in-progress",
  "blocked": "in-progress",
  "in-review": "review",
  "built": "review",
  "done": "done",
  "dropped": "dropped",
};

const BREAKDOWN = "tickets.toml";
const LEAF_NAME_RE = /^(story|spike|bug)-(.+)\.md$/;
const ID_RE = /^[0-9A-Za-z]+$/;
const CROSS_RE = /^([0-9A-Za-z]+)\.([0-9A-Za-z]+)$/;
const EPIC_SLUG_RE = /^epic-[^/]+$/;
const UNKNOWN_RE = /^[ \t]*(?:[-*][ \t]+)?Unknown:[ \t]*(\S.*)$/gm;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** An id is a number or an alphanumeric string; `6` and `"6"` are one id. */
export type TicketId = number | string;

// ─── Public row shape ───────────────────────────────────────────────

export interface TicketDrift {
  file: unknown;
  entry: unknown;
}

export interface TicketRow {
  /** Container folder name, e.g. "epic-core-play-loop". */
  epic: string;
  id: TicketId | null;
  /** Internal identity: "<epic>/<id>", or "<epic>/<file>" for an id-less leaf. */
  key: string;
  /** Globally unique reference: "<epic id>.<entry id>", else the file name. */
  ref: string;
  /** Leaf file basename, null until the entry is pulled. */
  file: string | null;
  /** Plan file basename, when one joined this ticket. */
  plan?: string;
  type: LeafType;
  trackerId: string;
  title: string;
  status: TicketStatus;
  trackerStatus: string;
  state: TicketState;
  assignee: string;
  refine: boolean;
  refined: boolean;
  description: string;
  verify: string;
  unknown: string;
  references: string[];
  notes: string[];
  risk: string;
  hitl: boolean;
  planCheckpoint: boolean;
  doneCheckpoint: boolean;
  covers: string[];
  estimate: string | number;
  blockedAt: string;
  blockedReason: string;
  /** Resolved prerequisite keys. */
  after: string[];
  /** Prerequisite refs as a human reads them. */
  afterRefs: string[];
  /** Epic-level gates inherited from the container's own `after`. */
  gatedBy: string[];
  /** Tickets that name this one in their `after`, as refs. */
  blocks: string[];
  /** Unmet prerequisites, as refs — set for blocked tickets. */
  waitingOn?: string[];
  /** Fields where a pulled leaf file disagrees with its entry. */
  drift?: Record<string, TicketDrift>;
  // ── internals, stripped before the row leaves this module ──
  rawAfter?: unknown[];
  entryAfter?: unknown[] | null;
  entryHitl?: boolean;
}

export interface TicketContainer {
  slug: string;
  id?: TicketId;
  title: string;
  trackerId: string;
  /** "", "in-progress", "done" or "dropped" — as the container file declares it. */
  status: string;
  /** Resolved gate keys from the container file's own `after`. */
  after: string[];
  /** Declared dependency edges from the initiative's tickets.toml. */
  declaredAfter: { epic: string; epicId?: TicketId; needs: string }[];
  covers: string[];
  risk: string;
  assignee: string;
  /** Absolute path of the container's ticket file. */
  file: string;
  /** Absolute path of the container folder. */
  dir: string;
}

export interface TicketTree {
  /** Absolute path of the folder the read ran on. */
  root: string;
  /** Folder name the read ran on. */
  folder: string;
  /** Set when the read ran on a single epic rather than a whole initiative. */
  scope: string | null;
  /** Absolute path of the initiative folder, when there is one. */
  initiative: string | null;
  initiativeTitle?: string;
  containers: TicketContainer[];
  tickets: TicketRow[];
  counts: Record<string, number>;
  /** Longest remaining prerequisite chain, as refs. */
  longestRemainingChain: string[];
  problems: string[];
  unpinnedAfter: { epic: string; after: string; needs: string }[];
  undeclaredAfter: { epic: string; after: string; ref: string; names: string }[];
  orderConflict: { epic: string; after: string }[];
}

export interface TicketGroups {
  readyToRefine: TicketRow[];
  readyToStart: TicketRow[];
  inProgress: TicketRow[];
  blocked: TicketRow[];
}

// ─── Small helpers ──────────────────────────────────────────────────

/** An id as the tree compares it, else null: a number, or letters and digits. */
export function ticketId(value: unknown): TicketId | null {
  if (typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && ID_RE.test(value) && value !== "true" && value !== "false") {
    return /^\d+$/.test(value) ? parseInt(value, 10) : value;
  }
  return null;
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function flag(value: unknown): boolean {
  return String(value).toLowerCase() === "true";
}

function str(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  return typeof value === "string" ? value : String(value);
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => str(v)) : [];
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, where: string, field: string, problems: string[]): string {
  const text = str(value);
  if (text === "" || (allowed as readonly string[]).includes(text)) return text;
  problems.push(`${where}: ${field} '${text}' is not one of ${allowed.join(", ")}`);
  return "";
}

/**
 * Ticket files are read head-first and capped. A plan's frontmatter and its
 * `Unknown:` notes live in the first few KB, and a dashboard re-reads the
 * tree on every file change — including while a build is part-way through
 * writing a plan, when the file can briefly be enormous. Reading a bounded
 * prefix keeps one mid-write file from stalling the whole parse.
 */
const MAX_TICKET_BYTES = 256 * 1024;

function readTextSafe(file: string, maxBytes = MAX_TICKET_BYTES): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size <= maxBytes) {
      // utf-8 with the ﻿ stripped: a Windows editor can save one, which would hide the frontmatter.
      return fs.readFileSync(fd, "utf-8").replace(/^﻿/, "");
    }
    const buf = Buffer.alloc(maxBytes);
    const read = fs.readSync(fd, buf, 0, maxBytes, 0);
    // A multi-byte character can straddle the cut; toString replaces the tail
    // with U+FFFD rather than throwing, which is fine for what is read here.
    return buf.subarray(0, read).toString("utf-8").replace(/^﻿/, "");
  } catch {
    return null;
  } finally {
    // readFileSync(fd) closes the descriptor itself; closing twice is harmless.
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

/** `<type>-<slug>` slug of a title, as BMAD's `title_slug` builds it. */
export function titleSlug(title: string): string {
  const ascii = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7F]/g, "");
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 60).replace(/-+$/, "") || "untitled";
}

/** The `Unknown:` lines of a leaf file's body, which is where `pull` writes an entry's `unknown`. */
function fileUnknown(text: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, "").replace(HTML_COMMENT_RE, "");
  const out: string[] = [];
  UNKNOWN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UNKNOWN_RE.exec(body)) !== null) out.push(m[1].trim());
  return out.join("; ");
}

// ─── tickets.toml ───────────────────────────────────────────────────

interface Breakdown {
  entry: Record<string, unknown>[];
  epic: Record<string, unknown>[];
  nextId: number;
}

function loadBreakdown(folder: string, problems: string[]): Breakdown {
  const empty: Breakdown = { entry: [], epic: [], nextId: 0 };
  const file = path.join(folder, BREAKDOWN);
  if (!fs.existsSync(file)) return empty;
  const where = `${path.basename(folder)}/${BREAKDOWN}`;
  const text = readTextSafe(file);
  if (text === null) return empty;

  let data: Record<string, unknown>;
  try {
    data = parseToml(text) as Record<string, unknown>;
  } catch (err: any) {
    problems.push(`${where}: ${err?.message ?? "could not be parsed"}`);
    return empty;
  }

  const table = (name: "entry" | "epic"): Record<string, unknown>[] => {
    const rows = data[name];
    if (rows === undefined) return [];
    if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      problems.push(`${where}: write [[${name}]] tables, one per ${name}`);
      return [];
    }
    return rows as Record<string, unknown>[];
  };

  const nextId = typeof data.next_id === "number" && Number.isInteger(data.next_id) ? data.next_id : 0;
  return { entry: table("entry"), epic: table("epic"), nextId };
}

// ─── Containers ─────────────────────────────────────────────────────

function loadContainer(folder: string, problems: string[]): TicketContainer | null {
  const slug = path.basename(folder);
  const file = path.join(folder, `${slug}.md`);
  const text = readTextSafe(file);
  if (text === null) {
    problems.push(`${slug}: no ${slug}.md`);
    return null;
  }
  const { data } = extractFrontmatter(text);
  const type = str(data.type);
  if (!(CONTAINER_TYPES as readonly string[]).includes(type)) {
    problems.push(`${slug}/${slug}.md: type '${type}' is not one of ${CONTAINER_TYPES.join(", ")}`);
    return null;
  }
  return {
    slug,
    title: str(data.title, slug),
    trackerId: str(data.tracker_id),
    status: oneOf(data.status, CONTAINER_STATUSES, `${slug}/${slug}.md`, "status", problems),
    after: [],
    declaredAfter: [],
    covers: strList(data.covers),
    risk: str(data.risk),
    assignee: str(data.assignee),
    file,
    dir: folder,
    // `raw_after` is carried on the side; see resolveTree.
    ...({ rawAfter: asList(data.after) } as object),
  };
}

// ─── One folder's rows ──────────────────────────────────────────────

function emptyRow(epic: string, id: TicketId | null): TicketRow {
  return {
    epic, id, key: "", ref: "", file: null, type: "story", trackerId: "", title: "",
    status: "", trackerStatus: "", state: "planned", assignee: "", refine: false, refined: false,
    description: "", verify: "", unknown: "", references: [], notes: [], risk: "", hitl: false,
    planCheckpoint: false, doneCheckpoint: false, covers: [], estimate: "",
    blockedAt: "", blockedReason: "", after: [], afterRefs: [], gatedBy: [], blocks: [],
    rawAfter: [], entryAfter: null,
  };
}

/**
 * One row per ticket in a folder, in build order: every breakdown entry joined
 * to its leaf file when one exists, then leaf files the breakdown does not
 * list. Plans then set the status fields of the rows they join.
 */
function loadFolder(folder: string, problems: string[]): TicketRow[] {
  const where = path.basename(folder);
  const rows = new Map<string, TicketRow>();     // keyed by String(id), preserving insertion (build) order
  const idOf = new Map<string, TicketId>();

  for (const e of loadBreakdown(folder, problems).entry) {
    const id = ticketId(e.id);
    if (id === null) {
      problems.push(`${where}/${BREAKDOWN}: every entry needs an id: a number, or letters and digits`);
      continue;
    }
    const kind = str(e.type);
    if (!(LEAF_TYPES as readonly string[]).includes(kind)) {
      problems.push(`${where}/${BREAKDOWN}: entry ${id} type '${kind}' is not one of ${LEAF_TYPES.join(", ")}`);
      continue;
    }
    const slot = String(id);
    if (rows.has(slot)) {
      problems.push(`${where}/${BREAKDOWN}: two entries with id ${id}`);
      continue;
    }
    idOf.set(slot, id);
    rows.set(slot, {
      ...emptyRow(where, id),
      type: kind as LeafType,
      title: str(e.title),
      refine: kind === "bug" || flag(e.refine ?? false),
      description: str(e.description),
      verify: str(e.verify),
      unknown: str(e.unknown),
      references: strList(e.references),
      notes: strList(e.notes),
      risk: str(e.risk),
      hitl: flag(e.hitl ?? false),
      planCheckpoint: flag(e.plan_checkpoint ?? false),
      doneCheckpoint: flag(e.done_checkpoint ?? false),
      covers: strList(e.covers),
      estimate: typeof e.estimate === "number" ? e.estimate : str(e.estimate),
      rawAfter: asList(e.after),
    });
  }

  const unlisted = new Map<string, TicketRow>();
  const stray: TicketRow[] = [];
  const plans: { name: string; data: Record<string, unknown> }[] = [];
  const seenIds = new Map<string, string>();

  const names = fs.existsSync(folder)
    ? fs.readdirSync(folder).filter((n) => n.endsWith(".md")).sort()
    : [];

  for (const name of names) {
    const text = readTextSafe(path.join(folder, name));
    if (text === null) continue;
    const { data } = extractFrontmatter(text);
    const type = str(data.type);
    if (!(LEAF_TYPES as readonly string[]).includes(type)) {
      // A plan is any other .md whose frontmatter has `ticket`.
      if ("ticket" in data) plans.push({ name, data });
      continue;
    }

    const id = ticketId(data.id);
    if (id !== null) {
      const slot = String(id);
      if (seenIds.has(slot)) {
        problems.push(`${where}: ${seenIds.get(slot)} and ${name} share the id ${id}`);
        continue;
      }
      seenIds.set(slot, name);
    }

    let row = id !== null ? rows.get(String(id)) : undefined;
    if (!row) {
      // A leaf file the breakdown does not list still needs refining.
      row = { ...emptyRow(where, id), refine: true };
      if (id === null) stray.push(row);
      else unlisted.set(String(id), row);
    } else {
      // Keep the entry's values so drift against the file can be reported.
      row.entryAfter = row.rawAfter ?? [];
      row.entryHitl = row.hitl;
    }

    const status = oneOf(data.status, TICKET_STATUSES, `${where}/${name}`, "status", problems) as TicketStatus;
    const trackerStatus = oneOf(data.tracker_status, TRACKER_STATES, `${where}/${name}`, "tracker_status", problems);

    row.file = name;
    row.type = type as LeafType;
    row.trackerId = str(data.tracker_id);
    row.title = str(data.title) || row.title;
    row.status = status;
    row.trackerStatus = trackerStatus;
    row.state = (trackerStatus || STATE_OF[status]) as TicketState;
    row.assignee = str(data.assignee);
    row.refined = flag(data.refined ?? false);
    row.refine = row.refine || type === "bug";
    row.hitl = flag(data.hitl ?? false);
    if (Array.isArray(data.covers)) row.covers = strList(data.covers);
    if (data.estimate !== undefined) row.estimate = typeof data.estimate === "number" ? data.estimate : str(data.estimate);
    if (typeof data.risk === "string") row.risk = data.risk;
    row.blockedAt = str(data.blocked_at);
    row.blockedReason = str(data.blocked_reason);
    row.unknown = fileUnknown(text);
    row.rawAfter = asList(data.after);
  }

  const sortedUnlisted = [...unlisted.keys()].sort((a, b) => {
    const ia = idOf.get(a) ?? ticketId(a) ?? a;
    const ib = idOf.get(b) ?? ticketId(b) ?? b;
    const na = typeof ia === "number", nb = typeof ib === "number";
    if (na !== nb) return na ? -1 : 1;                              // numbers before lettered ids
    return na ? (ia as number) - (ib as number) : String(ia).localeCompare(String(ib));
  });

  const out = [...rows.values(), ...sortedUnlisted.map((k) => unlisted.get(k)!), ...stray];
  joinPlans(out, plans, where, problems);
  return out;
}

/** Each plan sets the status fields of the one row its `ticket` names. */
function joinPlans(
  rows: TicketRow[],
  plans: { name: string; data: Record<string, unknown> }[],
  where: string,
  problems: string[],
): void {
  for (const { name, data } of plans) {
    const raw = data.ticket;
    const id = ticketId(raw);
    let row: TicketRow | undefined;
    if (id !== null) row = rows.find((r) => r.id !== null && String(r.id) === String(id));
    if (!row && typeof raw === "string" && raw) row = rows.find((r) => r.file === `${raw}.md`);
    if (!row) {
      problems.push(`${where}/${name}: ticket '${str(raw)}' names no entry or leaf file in ${where}; skipped`);
      continue;
    }
    if (row.plan) {
      problems.push(`${where}/${row.plan} and ${name} are both plans for ticket '${str(raw)}'`);
      continue;
    }

    let status = str(data.status) as TicketStatus;
    let blockedReason = str(data.blocked_reason);
    if (status !== "" && !(TICKET_STATUSES as readonly string[]).includes(status)) {
      problems.push(
        `${where}/${name}: status '${status}' is not one of ${TICKET_STATUSES.join(", ")}; ` +
        `the ticket reads as blocked until the plan is fixed`,
      );
      blockedReason = `${name} has an unknown status '${status}'`;
      status = "blocked";
    }

    row.plan = name;
    row.status = status;
    row.blockedAt = str(data.blocked_at);
    row.blockedReason = blockedReason;
    // A tracker's assignee is mirrored into the leaf file; the builds' plans carry no assignee.
    if ("assignee" in data) row.assignee = str(data.assignee);
    row.state = (row.trackerStatus || STATE_OF[status]) as TicketState;
  }
}

// ─── The tree ───────────────────────────────────────────────────────

function epicFolders(initiative: string): string[] {
  if (!fs.existsSync(initiative)) return [];
  return fs
    .readdirSync(initiative, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("epic-"))
    .map((d) => path.join(initiative, d.name))
    .filter((dir) =>
      fs.existsSync(path.join(dir, `${path.basename(dir)}.md`)) || fs.existsSync(path.join(dir, BREAKDOWN)),
    )
    .sort();
}

/** Read a ticket tree: an initiative folder (all its epics), one epic folder, or a backlog folder. */
export function loadTicketTree(folder: string): TicketTree {
  const root = path.resolve(folder);
  const problems: string[] = [];

  let epics = epicFolders(root);
  let scope: string | null;
  let initiative: string | null;
  let folders: string[];

  if (epics.length > 0 || loadBreakdown(root, problems).epic.length > 0) {
    scope = null;
    initiative = root;
    folders = [...epics, root];
  } else {
    const parent = path.dirname(root);
    const siblings = epicFolders(parent);
    if (siblings.includes(root)) {
      scope = path.basename(root);
      initiative = parent;
      epics = siblings;
      folders = siblings;
    } else {
      // A standalone folder: a backlog, or an epic outside an initiative.
      scope = path.basename(root);
      initiative = null;
      folders = [root];
    }
  }

  const listed = initiative ? loadBreakdown(initiative, problems).epic : [];
  const order = listed.map((e) => str(e.slug));
  epics.sort((a, b) => {
    const ia = order.indexOf(path.basename(a)), ib = order.indexOf(path.basename(b));
    const ra = ia === -1 ? order.length : ia, rb = ib === -1 ? order.length : ib;
    return ra - rb || path.basename(a).localeCompare(path.basename(b));
  });
  if (scope === null) folders = [...epics, root];

  // Epic ids and declared dependency edges from the initiative's tickets.toml.
  const epicIds = new Map<string, TicketId>();
  const declared = new Map<string, { epic: string; epicId?: TicketId; needs: string }[]>();
  for (const e of listed) {
    const id = ticketId(e.id);
    const slug = str(e.slug);
    if (id === null || !slug) {
      problems.push(`${path.basename(initiative!)}/${BREAKDOWN}: every epic needs an id and a slug`);
      continue;
    }
    if ([...epicIds.values()].some((v) => String(v) === String(id))) {
      problems.push(`${path.basename(initiative!)}/${BREAKDOWN}: two epics with id ${id}`);
      continue;
    }
    if (epicIds.has(slug)) {
      problems.push(`${path.basename(initiative!)}/${BREAKDOWN}: two epics with slug ${slug}`);
      continue;
    }
    epicIds.set(slug, id);
  }
  const slugOfId = new Map<string, string>();
  for (const [slug, id] of epicIds) slugOfId.set(String(id), slug);

  for (const e of listed) {
    const slug = str(e.slug);
    if (!epicIds.has(slug)) continue;
    const edges: { epic: string; epicId?: TicketId; needs: string }[] = [];
    for (const a of asList(e.after)) {
      if (!a || typeof a !== "object" || Array.isArray(a)) {
        problems.push(
          `${path.basename(initiative!)}/${BREAKDOWN}: ${slug}'s after takes tables: ` +
          `[{ epic = <id or slug>, needs = "..." }]`,
        );
        continue;
      }
      const row = a as Record<string, unknown>;
      const id = ticketId(row.epic);
      const named = (id !== null ? slugOfId.get(String(id)) : undefined) ?? str(row.epic);
      if (!epicIds.has(named)) {
        problems.push(
          `${path.basename(initiative!)}/${BREAKDOWN}: ${slug} is after '${str(row.epic)}', which is no epic listed`,
        );
        continue;
      }
      edges.push({ epic: named, epicId: epicIds.get(named), needs: str(row.needs) });
    }
    declared.set(slug, edges);
  }

  // Containers, in the order the initiative lists them.
  const containers: TicketContainer[] = [];
  for (const dir of epics) {
    const c = loadContainer(dir, problems);
    if (!c) continue;
    c.id = epicIds.get(c.slug);
    c.declaredAfter = declared.get(c.slug) ?? [];
    containers.push(c);
  }

  const tickets: TicketRow[] = [];
  for (const dir of folders) tickets.push(...loadFolder(dir, problems));
  for (const t of tickets) {
    t.key = t.id !== null ? `${t.epic}/${t.id}` : `${t.epic}/${t.file}`;
  }

  const tree: TicketTree = {
    root, folder: path.basename(root), scope, initiative,
    containers, tickets,
    counts: {}, longestRemainingChain: [], problems,
    unpinnedAfter: [], undeclaredAfter: [], orderConflict: [],
  };

  if (initiative) {
    const text = readTextSafe(path.join(initiative, `${path.basename(initiative)}.md`));
    if (text !== null) {
      const { data } = extractFrontmatter(text);
      tree.initiativeTitle = str(data.title) || path.basename(initiative);
    }
  }

  resolveTree(tree, epicIds, slugOfId);
  dropCycles(tree);
  annotate(tree, epicIds, declared);
  return tree;
}

/** Resolve every `after` list to internal keys, and record file-vs-entry drift. */
function resolveTree(tree: TicketTree, epicIds: Map<string, TicketId>, slugOfId: Map<string, string>): void {
  const { tickets, containers, problems } = tree;
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const containerBySlug = new Map(containers.map((c) => [c.slug, c]));

  // Tracker ids address tickets and containers too.
  const byTrackerId = new Map<string, string>();
  for (const c of containers) if (c.trackerId) byTrackerId.set(c.trackerId, c.slug);
  for (const t of tickets) if (t.trackerId) byTrackerId.set(t.trackerId, t.key);

  /** A bare number is always a sibling's id; a lettered id is one when a sibling has it. */
  function sibling(epic: string, ref: unknown): string | null | undefined {
    const mates = tickets.filter((o) => o.epic === epic);
    if (typeof ref === "number") {
      const hit = mates.find((o) => typeof o.id === "number" && o.id === ref);
      return hit ? hit.key : null;   // null: a bare number names nothing here — an error, not a fallthrough
    }
    const text = String(ref);
    const lettered = mates.find((o) => typeof o.id === "string" && o.id === text);
    if (lettered) return lettered.key;
    const byFile = mates.find((o) => o.file && (o.file === text || o.file.slice(0, -3) === text));
    if (byFile) return byFile.key;
    return undefined;
  }

  function resolve(epic: string, hasId: boolean, refs: unknown[], where: string): string[] {
    const keys: string[] = [];
    for (const ref of refs) {
      const text = String(ref);
      let key: string | null | undefined = hasId ? sibling(epic, ref) : undefined;
      if (key === null) {
        problems.push(`${where}: after ${text} names no entry in ${epic}`);
        continue;
      }
      const m = CROSS_RE.exec(text);
      if (key === undefined && m) {
        const slug = slugOfId.get(String(ticketId(m[1])));
        if (slug) {
          const candidate = `${slug}/${ticketId(m[2])}`;
          if (!byKey.has(candidate)) {
            problems.push(`${where}: after '${text}' names no entry in ${slug}`);
            continue;
          }
          key = candidate;
        }
      }
      if (key === undefined && EPIC_SLUG_RE.test(text)) {
        if (!containerBySlug.has(text)) {
          problems.push(`${where}: after '${text}' names no epic in this initiative`);
          continue;
        }
        key = text;
      }
      if (key === undefined) key = byTrackerId.get(text);
      if (key === undefined && m) {
        problems.push(`${where}: after '${text}' names no epic id in this initiative's ${BREAKDOWN}`);
        continue;
      }
      if (key === undefined && LEAF_NAME_RE.test(text.endsWith(".md") ? text : `${text}.md`)) {
        problems.push(
          `${where}: after '${text}' matches no ticket in ${epic}; a file name names a pulled ticket ` +
          `in the same folder only — use the entry's id`,
        );
        continue;
      }
      if (key === undefined) {
        problems.push(`${where}: after '${text}' matches no ticket`);
        continue;
      }
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }

  for (const t of tickets) {
    const where = t.file ? `${t.epic}/${t.file}` : `${t.epic}/${BREAKDOWN} entry ${t.id}`;
    t.after = resolve(t.epic, t.id !== null, t.rawAfter ?? [], where);
    const planned = t.entryAfter;
    const entryHitl = t.entryHitl;
    const drift: Record<string, TicketDrift> = {};
    if (planned !== null && planned !== undefined) {
      const entryAfter = resolve(t.epic, t.id !== null, planned, where);
      if ([...entryAfter].sort().join("|") !== [...t.after].sort().join("|")) {
        drift.after = { file: t.after, entry: entryAfter };
      }
      if (entryHitl !== t.hitl) drift.hitl = { file: t.hitl, entry: entryHitl };
    }
    if (Object.keys(drift).length) t.drift = drift;
    delete t.rawAfter;
    delete t.entryAfter;
    delete t.entryHitl;
  }

  for (const c of containers) {
    const raw = asList((c as unknown as { rawAfter?: unknown[] }).rawAfter);
    delete (c as unknown as { rawAfter?: unknown[] }).rawAfter;
    c.after = resolve(c.slug, false, raw, `${c.slug}.md`);
    for (const t of tickets) if (t.epic === c.slug) t.gatedBy = c.after;
  }

  // Refs, now that keys are final.
  for (const t of tickets) {
    t.ref = rowRef(t, epicIds, tree.scope);
    t.afterRefs = t.after.map((k) => keyRef(k, epicIds));
  }
}

/** Break prerequisite cycles rather than aborting: the edge that closes a cycle is dropped. */
function dropCycles(tree: TicketTree): void {
  const byKey = new Map(tree.tickets.map((t) => [t.key, t]));
  const members = new Map<string, string[]>();
  for (const t of tree.tickets) {
    const list = members.get(t.epic) ?? [];
    list.push(t.key);
    members.set(t.epic, list);
  }
  for (const c of tree.containers) {
    members.set(c.slug, [...(members.get(c.slug) ?? []), ...c.after]);
  }

  const state = new Map<string, "active" | "done">();

  function edgesOf(node: string): string[] {
    const t = byKey.get(node);
    return t ? [...t.after, ...t.gatedBy] : (members.get(node) ?? []);
  }

  function visit(node: string, path: string[]): void {
    if (state.get(node) === "done") return;
    if (state.get(node) === "active") return;
    state.set(node, "active");
    for (const next of [...edgesOf(node)]) {
      if (state.get(next) === "active") {
        tree.problems.push(`cycle through ${[...path, node, next].join(" -> ")}; the edge was ignored`);
        const t = byKey.get(node);
        if (t) {
          t.after = t.after.filter((k) => k !== next);
          t.gatedBy = t.gatedBy.filter((k) => k !== next);
        }
        continue;
      }
      visit(next, [...path, node]);
    }
    state.set(node, "done");
  }

  for (const t of tree.tickets) visit(t.key, []);
}

/** Counts, blocks, the longest chain and the initiative-level consistency checks. */
function annotate(
  tree: TicketTree,
  epicIds: Map<string, TicketId>,
  declared: Map<string, { epic: string; epicId?: TicketId; needs: string }[]>,
): void {
  const scoped = inScope(tree);

  const counts: Record<string, number> = { total: scoped.length };
  for (const t of scoped) counts[t.state] = (counts[t.state] ?? 0) + 1;
  tree.counts = counts;

  const blocks = new Map<string, string[]>();
  for (const t of tree.tickets) {
    for (const b of t.after) blocks.set(b, [...(blocks.get(b) ?? []), t.key]);
  }
  for (const t of tree.tickets) {
    t.blocks = (blocks.get(t.key) ?? []).map((k) => keyRef(k, epicIds));
  }
  for (const c of tree.containers) {
    (c as TicketContainer & { blocks?: string[] }).blocks =
      (blocks.get(c.slug) ?? []).map((k) => keyRef(k, epicIds));
  }

  tree.longestRemainingChain = longestRemainingChain(tree).map((k) => keyRef(k, epicIds));

  // unpinned_after: a declared edge no entry of the waiting epic pins.
  for (const [slug, edges] of declared) {
    const mine = tree.tickets.filter((t) => t.epic === slug);
    if (mine.length === 0) continue;
    for (const a of edges) {
      const pinned = mine.some((t) =>
        [...t.after, ...t.gatedBy].some((b) => b === a.epic || b.startsWith(`${a.epic}/`)),
      );
      if (!pinned && (tree.scope === null || tree.scope === slug)) {
        tree.unpinnedAfter.push({ epic: slug, after: a.epic, needs: a.needs });
      }
    }
  }

  // undeclared_after / order_conflict.
  const order = [...declared.keys()];
  const addConflict = (epic: string, needed: string) => {
    const ie = order.indexOf(epic), inn = order.indexOf(needed);
    if (ie === -1 || inn === -1 || inn <= ie) return;
    if (tree.scope !== null && tree.scope !== epic) return;
    if (!tree.orderConflict.some((c) => c.epic === epic && c.after === needed)) {
      tree.orderConflict.push({ epic, after: needed });
    }
  };
  for (const [slug, edges] of declared) for (const a of edges) addConflict(slug, a.epic);
  for (const c of tree.containers) {
    for (const b of c.after) {
      const needed = b.split("/")[0];
      if (declared.has(c.slug) && declared.has(needed)) addConflict(c.slug, needed);
    }
  }
  for (const t of tree.tickets) {
    if (!declared.has(t.epic)) continue;
    const allowed = new Set((declared.get(t.epic) ?? []).map((a) => a.epic));
    for (const b of t.after) {
      const needed = b.split("/")[0];
      if (needed === t.epic || !declared.has(needed)) continue;
      addConflict(t.epic, needed);
      if (!allowed.has(needed) && (tree.scope === null || tree.scope === t.epic)) {
        tree.undeclaredAfter.push({
          epic: t.epic, after: needed, ref: t.ref, names: keyRef(b, epicIds),
        });
      }
    }
  }
}

// ─── Refs ───────────────────────────────────────────────────────────

/** An internal key as a human reads it: "<epic id>.<entry id>", an epic slug, else the key. */
function keyRef(key: string, epicIds: Map<string, TicketId>): string {
  const slash = key.indexOf("/");
  if (slash === -1) return key;                       // a whole-epic gate
  const slug = key.slice(0, slash), rest = key.slice(slash + 1);
  const id = epicIds.get(slug);
  if (id === undefined || ticketId(rest) === null) return key;
  return `${id}.${rest}`;
}

/** The reference that names a row: "<epic id>.<entry id>", else its file name. */
function rowRef(t: TicketRow, epicIds: Map<string, TicketId>, scope: string | null): string {
  if (t.id !== null && epicIds.has(t.epic)) return `${epicIds.get(t.epic)}.${t.id}`;
  if (t.id !== null && t.epic === scope) return String(t.id);
  return t.file ?? `${t.epic}/${t.id}`;
}

// ─── Views ──────────────────────────────────────────────────────────

export function inScope(tree: TicketTree): TicketRow[] {
  return tree.tickets.filter((t) => tree.scope === null || tree.scope === t.epic);
}

function doneKeys(tree: TicketTree): Set<string> {
  const done = new Set(tree.tickets.filter((t) => t.state === "done").map((t) => t.key));
  for (const c of tree.containers) if (c.status === "done") done.add(c.slug);
  return done;
}

/**
 * The ready / in-progress / blocked split, mirroring `tickets.py next`:
 * a ticket in review meets an `after`, but an epic gate waits for that epic
 * to be done. Sets `waitingOn` on every blocked row.
 */
export function classifyTickets(tree: TicketTree): TicketGroups {
  const done = doneKeys(tree);
  const met = new Set(done);
  for (const t of tree.tickets) if (t.state === "review") met.add(t.key);

  const groups: TicketGroups = { readyToRefine: [], readyToStart: [], inProgress: [], blocked: [] };
  const epicIds = new Map(tree.containers.filter((c) => c.id !== undefined).map((c) => [c.slug, c.id!]));

  for (const t of inScope(tree)) {
    if (t.state === "done" || t.state === "dropped") continue;
    const unmet = [
      ...t.after.filter((b) => !met.has(b)),
      ...t.gatedBy.filter((b) => !done.has(b)),
    ];
    if (t.status === "blocked" || t.blockedAt) {
      t.waitingOn = unmet.map((k) => keyRef(k, epicIds));
      groups.blocked.push(t);
    } else if (t.state === "in-progress" || t.state === "review") {
      groups.inProgress.push(t);
    } else if (unmet.length) {
      t.waitingOn = unmet.map((k) => keyRef(k, epicIds));
      groups.blocked.push(t);
    } else if (t.refine && !t.refined) {
      groups.readyToRefine.push(t);       // refining is where its `unknown` gets settled
    } else if (t.unknown) {
      groups.blocked.push(t);
    } else {
      groups.readyToStart.push(t);
    }
  }
  return groups;
}

function longestRemainingChain(tree: TicketTree): string[] {
  const remaining = new Map(
    tree.tickets.filter((t) => t.state !== "done" && t.state !== "dropped").map((t) => [t.key, t]),
  );
  const memo = new Map<string, string[]>();

  function chain(key: string, seen: Set<string>): string[] {
    const cached = memo.get(key);
    if (cached) return cached;
    if (seen.has(key)) return [key];
    seen.add(key);
    const row = remaining.get(key)!;
    let best: string[] = [];
    for (const b of [...row.after, ...row.gatedBy]) {
      if (!remaining.has(b)) continue;
      const c = chain(b, seen);
      if (c.length > best.length) best = c;
    }
    seen.delete(key);
    const out = [...best, key];
    memo.set(key, out);
    return out;
  }

  let longest: string[] = [];
  for (const t of inScope(tree)) {
    if (!remaining.has(t.key)) continue;
    const c = chain(t.key, new Set());
    if (c.length > longest.length) longest = c;
  }
  return longest;
}

// ─── Paths ──────────────────────────────────────────────────────────

/** A pulled leaf file's stem, or the one `pull` would give it. */
export function leafStem(t: TicketRow, tree: TicketTree): string {
  if (t.file) return t.file.slice(0, -3);
  const stem = `${t.type}-${titleSlug(t.title)}`;
  const taken = new Set<string>();
  for (const o of tree.tickets) {
    if (o === t) break;
    if (o.epic === t.epic && !o.file) taken.add(`${o.type}-${titleSlug(o.title)}`);
  }
  for (const o of tree.tickets) {
    if (o.epic === t.epic && o.file) taken.add(o.file.slice(0, -3));
  }
  return taken.has(stem) ? `${stem}-${t.id}` : stem;
}

/** Absolute path of the ticket's container folder. */
export function folderOf(t: TicketRow, tree: TicketTree): string {
  const c = tree.containers.find((x) => x.slug === t.epic);
  if (c) return c.dir;
  // The initiative's own folder, or a standalone backlog folder.
  return tree.initiative && t.epic === path.basename(tree.initiative)
    ? tree.initiative
    : path.join(path.dirname(tree.root), t.epic);
}

/** The ticket's plan file: the joined one, else where `mark` would create it. */
export function planPath(t: TicketRow, tree: TicketTree): string {
  const folder = folderOf(t, tree);
  return path.join(folder, t.plan ?? `${leafStem(t, tree)}-plan.md`);
}

/** The ticket's leaf file, when it has been pulled. */
export function leafPath(t: TicketRow, tree: TicketTree): string | null {
  return t.file ? path.join(folderOf(t, tree), t.file) : null;
}
