import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString } from "mdast-util-to-string";
import type { Root, Content, Heading, List, ListItem } from "mdast";
import type {
  Epic, UserStory, AcceptanceCriteria, Task, BmadProject, FrMapRow,
  BmadConfig, SprintStatus, BmadDocument,
} from "../types/index.js";
import { resolveBmadConfig } from "./config.js";
import { loadSprintStatus, writeSprintStatusEntry } from "./sprint-status.js";
import { parseDocuments } from "./documents.js";
import { computeNextStep, computeRisks } from "./next-steps.js";

// ─── Helpers ────────────────────────────────────────────────────────

function parseMarkdown(content: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(content) as Root;
}

function findMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMarkdownFiles(full));
    else if (entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function extractMetadata(nodes: Content[]): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const node of nodes) {
    if (node.type !== "paragraph") continue;
    const text = toString(node);
    for (const line of text.split("\n")) {
      // Match both "**Key:** Value" and "Key: Value"
      const m = line.match(/^\s*\**([^*:]+?)\**:\s*(.+)/);
      if (m) meta[m[1].trim()] = m[2].trim();
    }
  }
  return meta;
}

function splitByHeading(nodes: Content[], level: number): { heading: string; children: Content[] }[] {
  const sections: { heading: string; children: Content[] }[] = [];
  let current: { heading: string; children: Content[] } | null = null;
  for (const node of nodes) {
    if (node.type === "heading" && (node as Heading).depth === level) {
      if (current) sections.push(current);
      current = { heading: toString(node), children: [] };
    } else if (current) {
      current.children.push(node);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function extractUserStoryText(nodes: Content[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type !== "paragraph") continue;
    const text = toString(node);
    if (text.includes("As a") || text.includes("I want to") || text.includes("So that")) {
      lines.push(text);
    }
  }
  return lines.join("\n").trim();
}

// ─── Status mapping ─────────────────────────────────────────────────
// BMAD: backlog, ready-for-dev → todo | in-progress → active | review → review | done → done

export const BOARD_COLUMNS = ["todo", "active", "review", "done"] as const;
export type BoardStatus = (typeof BOARD_COLUMNS)[number];

function parseStatus(raw: string): BoardStatus {
  const lower = raw.toLowerCase();
  // "cancelled" stories are finished work — group under done rather than todo.
  if (lower.includes("done") || lower.includes("complete") || lower.includes("cancel") || lower.includes("✅")) return "done";
  if (lower.includes("review")) return "review";
  if (lower.includes("in-progress") || lower.includes("in progress") || lower.includes("active") || lower.includes("🔄")) return "active";
  return "todo";
}

function statusToMarkdown(status: BoardStatus): string {
  switch (status) {
    case "done": return "done";
    case "review": return "review";
    case "active": return "in-progress";
    case "todo": default: return "ready-for-dev";
  }
}

// ─── AC extraction ──────────────────────────────────────────────────

/** Extract GFM checkbox items (old BMAD format) */
function extractCheckboxes(nodes: Content[]): AcceptanceCriteria[] {
  const criteria: AcceptanceCriteria[] = [];
  let idx = 1;
  for (const node of nodes) {
    if (node.type === "list") {
      for (const item of (node as List).children) {
        const li = item as ListItem;
        if (li.checked === null || li.checked === undefined) continue;
        let text = toString(li).trim().replace(/^\[[ xX]\]\s*/i, "").replace(/\s*-\s*DONE\s*$/i, "").trim();
        if (!text) continue;
        criteria.push({ id: `AC-${idx++}`, description: text, done: li.checked === true });
      }
    }
  }
  return criteria;
}

/** Extract numbered paragraph-style ACs (new BMAD format: "1. **Given** ...") */
function extractNumberedAC(nodes: Content[]): AcceptanceCriteria[] {
  const criteria: AcceptanceCriteria[] = [];
  let idx = 1;
  for (const node of nodes) {
    if (node.type === "list" && (node as List).ordered) {
      for (const item of (node as List).children) {
        const text = toString(item).trim();
        if (text) {
          criteria.push({ id: `AC-${idx++}`, description: text, done: false });
        }
      }
    }
  }
  return criteria;
}

/** Extract task checkboxes from ## Tasks / Subtasks */
function extractTasks(nodes: Content[]): Task[] {
  const tasks: Task[] = [];
  let idx = 1;
  for (const node of nodes) {
    if (node.type !== "list") continue;
    for (const item of (node as List).children) {
      const li = item as ListItem;
      if (li.checked === null || li.checked === undefined) continue;
      // Get only the first line of text (task description), not subtasks
      const firstChild = li.children[0];
      const text = firstChild ? toString(firstChild).trim().replace(/^\[[ xX]\]\s*/i, "") : "";
      if (!text) continue;

      // Check for nested list (subtasks)
      const subtasks: Task[] = [];
      let subIdx = 1;
      for (const child of li.children) {
        if (child.type === "list") {
          for (const subItem of (child as List).children) {
            const subLi = subItem as ListItem;
            const subText = toString(subLi).trim().replace(/^\[[ xX]\]\s*/i, "");
            if (subText) {
              subtasks.push({ id: `T${idx}.${subIdx++}`, description: subText, done: subLi.checked === true });
            }
          }
        }
      }

      tasks.push({ id: `T${idx++}`, description: text, done: li.checked === true, subtasks: subtasks.length > 0 ? subtasks : undefined });
    }
  }
  return tasks;
}

function extractNodesAfterLabel(nodes: Content[], label: string): Content[] {
  const lowerLabel = label.toLowerCase();
  let capturing = false;
  const result: Content[] = [];
  for (const node of nodes) {
    if (node.type === "paragraph") {
      const text = toString(node).trim();
      if (text.toLowerCase().includes(lowerLabel)) { capturing = true; continue; }
      if (capturing && text.endsWith(":") && text.length < 80) break;
    }
    if (capturing) result.push(node);
  }
  return result;
}

// ─── New BMAD story parser ──────────────────────────────────────────
// Files like: 1-1-user-registration.md
// Status is plain: "Status: ready-for-dev"
// AC are numbered paragraphs, Tasks are checkboxes

function parseNewStoryFile(content: string, filePath: string): UserStory | null {
  const tree = parseMarkdown(normalizeContent(content));
  const nodes = tree.children;

  const h1 = nodes.find((n) => n.type === "heading" && (n as Heading).depth === 1);
  if (!h1) return null;
  const titleText = toString(h1);
  const titleMatch = titleText.match(/^Story\s+([\d.]+):\s*(.+)/i);
  if (!titleMatch) return null;

  // Status is plain text: "Status: ready-for-dev"
  let status: BoardStatus = "todo";
  let rawStatus: string | undefined;
  for (const node of nodes) {
    if (node.type !== "paragraph") continue;
    const text = toString(node);
    const statusMatch = text.match(/^Status:\s*(.+)/i);
    if (statusMatch) { rawStatus = statusMatch[1].trim(); status = parseStatus(rawStatus); break; }
  }

  const sections = splitByHeading(nodes, 2);

  // User story text (## Story)
  const storySection = sections.find((s) =>
    s.heading.toLowerCase() === "story" || s.heading.toLowerCase().includes("user story")
  );
  const description = storySection ? extractUserStoryText(storySection.children) : "";

  // Acceptance criteria
  const acSection = sections.find((s) => s.heading.toLowerCase().includes("acceptance criteria"));
  let acceptanceCriteria: AcceptanceCriteria[] = [];
  if (acSection) {
    // Try numbered AC first (new format), fall back to checkboxes (old format)
    acceptanceCriteria = extractNumberedAC(acSection.children);
    if (acceptanceCriteria.length === 0) {
      const subSections = splitByHeading(acSection.children, 3);
      if (subSections.length > 0) {
        for (const sub of subSections) acceptanceCriteria.push(...extractCheckboxes(sub.children));
      } else {
        acceptanceCriteria = extractCheckboxes(acSection.children);
      }
    }
  }

  // Tasks
  const taskSection = sections.find((s) => s.heading.toLowerCase().includes("task"));
  const tasks = taskSection ? extractTasks(taskSection.children) : [];

  const meta = extractMetadata(nodes);

  return {
    id: titleMatch[1],
    title: titleMatch[2].trim(),
    description,
    acceptanceCriteria,
    tasks,
    status,
    rawStatus,
    statusSource: "file",
    priority: meta["Priority"],
    epicRef: meta["Epic"],
    sourceFile: filePath,
  };
}

// ─── Old BMAD story parser ──────────────────────────────────────────
// Backward compat with the Portalyr-style files

function parseOldStoryFile(content: string, filePath: string): UserStory | null {
  const tree = parseMarkdown(normalizeContent(content));
  const nodes = tree.children;

  const h1 = nodes.find((n) => n.type === "heading" && (n as Heading).depth === 1);
  if (!h1) return null;
  const titleText = toString(h1);
  const titleMatch = titleText.match(/^Story\s+([\d.]+):\s*(.+)/i);
  if (!titleMatch) return null;

  const meta = extractMetadata(nodes);
  const sections = splitByHeading(nodes, 2);

  const userStorySection = sections.find((s) => s.heading.toLowerCase().includes("user story") || s.heading.toLowerCase() === "story");
  const description = userStorySection ? extractUserStoryText(userStorySection.children) : "";

  const acSection = sections.find((s) => s.heading.toLowerCase().includes("acceptance criteria"));
  let acceptanceCriteria: AcceptanceCriteria[] = [];
  if (acSection) {
    const subSections = splitByHeading(acSection.children, 3);
    if (subSections.length > 0) {
      for (const sub of subSections) acceptanceCriteria.push(...extractCheckboxes(sub.children));
    } else {
      acceptanceCriteria = extractCheckboxes(acSection.children);
    }
  }

  return {
    id: titleMatch[1],
    title: titleMatch[2].trim(),
    description,
    acceptanceCriteria,
    tasks: [],
    status: parseStatus(meta["Status"] ?? ""),
    priority: meta["Priority"],
    epicRef: meta["Epic"],
    sourceFile: filePath,
  };
}

function parseStoryFile(content: string, filePath: string): UserStory | null {
  // Detect format: new BMAD has plain "Status: xxx", old has "**Status:** xxx"
  const hasPlainStatus = /^Status:\s/m.test(content);
  if (hasPlainStatus) return parseNewStoryFile(content, filePath);
  return parseOldStoryFile(content, filePath);
}

// ─── Epic parsers ───────────────────────────────────────────────────

interface EpicTraceability {
  requirements: string[];
  dependsOn: number[];
}

/**
 * Extract per-epic traceability (Requirements covered, Additional requirements,
 * Depends on) from the `### Epic N:` summary blocks in the Epic List. These live
 * separately from the `## Epic N:` detail sections. Keyed by epic number.
 */
function parseEpicTraceability(content: string): Map<number, EpicTraceability> {
  const map = new Map<number, EpicTraceability>();
  // Split the file into `### Epic N:` blocks (summary entries).
  const blockRe = /^###\s+Epic\s+(\d+):[^\n]*$/gim;
  const norm = normalizeContent(content);
  const matches: { num: number; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(norm)) !== null) {
    matches.push({ num: parseInt(m[1], 10), start: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const block = norm.slice(matches[i].start, matches[i + 1]?.start ?? norm.length);
    const requirements = new Set<string>();
    const reqLine = block.match(/\*\*Requirements covered:\*\*\s*([^\n]+)/i);
    const addLine = block.match(/\*\*Additional requirements:\*\*\s*([^\n]+)/i);
    for (const line of [reqLine?.[1], addLine?.[1]]) {
      if (!line) continue;
      for (const id of line.match(/\b(?:FR|NFR|AD|AR|UX-DR)-[\w.]+/gi) ?? []) {
        requirements.add(id.toUpperCase());
      }
    }
    const dependsOn = new Set<number>();
    const depLine = block.match(/\*Depends on:\s*([^\n]*)\*/i);
    if (depLine) {
      for (const d of depLine[1].match(/Epic\s+(\d+)/gi) ?? []) {
        dependsOn.add(parseInt(d.replace(/\D/g, ""), 10));
      }
    }
    // Merge (an epic number may appear in both the Epic List and a backlog section).
    const existing = map.get(matches[i].num) ?? { requirements: [], dependsOn: [] };
    map.set(matches[i].num, {
      requirements: [...new Set([...existing.requirements, ...requirements])],
      dependsOn: [...new Set([...existing.dependsOn, ...dependsOn])],
    });
  }
  return map;
}

/** Parse the `### FR Coverage Map` markdown table into rows. */
function parseFrCoverageMap(content: string): FrMapRow[] {
  const norm = normalizeContent(content);
  const headingIdx = norm.search(/^#{2,4}\s+FR Coverage Map\s*$/im);
  if (headingIdx === -1) return [];
  const after = norm.slice(headingIdx);
  const rows: FrMapRow[] = [];
  for (const line of after.split("\n").slice(1)) {
    // Stop at the next heading.
    if (/^#{1,6}\s/.test(line)) break;
    const cells = line.match(/^\s*\|(.+)\|\s*$/);
    if (!cells) continue;
    const parts = cells[1].split("|").map((c) => c.trim());
    // Skip header row and separator row.
    if (/^requirement$/i.test(parts[0]) || /^-{2,}$/.test(parts[0].replace(/:/g, ""))) continue;
    if (!parts[0]) continue;
    rows.push({ requirement: parts[0], epic: parts[1] ?? "", notes: parts[2] || undefined });
  }
  return rows;
}

/** New BMAD: single epics.md with ## Epic N: and ### Story X.Y: */
function parseEpicsFile(content: string, filePath: string): Epic[] {
  const tree = parseMarkdown(normalizeContent(content));
  const h2Sections = splitByHeading(tree.children, 2);
  const epics: Epic[] = [];
  const traceability = parseEpicTraceability(content);

  for (const section of h2Sections) {
    const epicMatch = section.heading.match(/^Epic\s+(\d+):\s*(.+)/i);
    if (!epicMatch) continue;

    const epicNum = epicMatch[1];
    const epicId = `EPIC-${epicNum.padStart(2, "0")}`;
    const description = section.children
      .filter((n) => n.type === "paragraph")
      .map((n) => toString(n))
      .filter((t) => !t.includes("As a") && !t.includes("I want to") && !t.includes("Acceptance Criteria"))
      .slice(0, 1)
      .join("\n")
      .trim();

    const h3Sections = splitByHeading(section.children, 3);
    const stories: UserStory[] = [];

    for (const ss of h3Sections) {
      const storyMatch = ss.heading.match(/^Story\s+([\d.]+):\s*(.+)/i);
      if (!storyMatch) continue;
      const storyDesc = extractUserStoryText(ss.children);
      const storyMeta = extractMetadata(ss.children);
      const acNodes = extractNodesAfterLabel(ss.children, "acceptance criteria");
      let ac: AcceptanceCriteria[] = [];
      if (acNodes.length > 0) {
        ac = extractNumberedAC(acNodes);
        if (ac.length === 0) ac = extractCheckboxes(acNodes);
      }

      stories.push({
        id: storyMatch[1],
        title: storyMatch[2].trim(),
        description: storyDesc,
        acceptanceCriteria: ac,
        tasks: [],
        status: parseStatus(storyMeta["Status"] ?? ""),
        rawStatus: storyMeta["Status"],
        statusSource: "file",
        priority: storyMeta["Priority"],
        sourceFile: filePath,
      });
    }

    const trace = traceability.get(parseInt(epicNum, 10));
    epics.push({
      id: epicId, title: epicMatch[2].trim(), description, stories,
      requirements: trace?.requirements.length ? trace.requirements : undefined,
      dependsOn: trace?.dependsOn.length ? trace.dependsOn : undefined,
    });
  }

  return epics;
}

/** Old BMAD: separate epic files with # Epic N: */
function parseOldEpicFile(content: string, filePath: string): Epic | null {
  const tree = parseMarkdown(normalizeContent(content));
  const nodes = tree.children;
  const h1 = nodes.find((n) => n.type === "heading" && (n as Heading).depth === 1);
  if (!h1) return null;
  const titleText = toString(h1);
  const epicMatch = titleText.match(/^Epic\s+(\d+):\s*(.+)/i);
  if (!epicMatch) return null;

  const meta = extractMetadata(nodes);
  const h2Sections = splitByHeading(nodes, 2);
  const summarySection = h2Sections.find((s) => s.heading.toLowerCase().includes("epic summary"));
  const description = summarySection
    ? summarySection.children.filter((n) => n.type === "paragraph").map((n) => toString(n)).join("\n").trim()
    : "";

  const storiesSection = h2Sections.find((s) => s.heading.toLowerCase().includes("user stories"));
  const inlineStories: UserStory[] = [];
  if (storiesSection) {
    const h3Sections = splitByHeading(storiesSection.children, 3);
    for (const ss of h3Sections) {
      const storyMatch = ss.heading.match(/^Story\s+([\d.]+):\s*(.+)/i);
      if (!storyMatch) continue;
      const storyMeta = extractMetadata(ss.children);
      const storyDesc = extractUserStoryText(ss.children);
      const acNodes = extractNodesAfterLabel(ss.children, "acceptance criteria");
      const ac = extractCheckboxes(acNodes.length > 0 ? acNodes : ss.children);
      inlineStories.push({
        id: storyMatch[1], title: storyMatch[2].trim(), description: storyDesc,
        acceptanceCriteria: ac, tasks: [], status: parseStatus(storyMeta["Status"] ?? ""),
        priority: storyMeta["Priority"], sourceFile: filePath,
      });
    }
  }

  return {
    id: meta["Epic ID"] ?? `EPIC-${epicMatch[1].padStart(2, "0")}`,
    title: epicMatch[2].trim(), description, stories: inlineStories,
  };
}

// ─── Structure detection & main entry ───────────────────────────────

export interface ParseOptions { dir: string; mode?: "auto" | "bmad-new" | "bmad-old" | "flat"; }

function detectStructure(dir: string): "bmad-new" | "bmad-old" | "flat" {
  if (fs.existsSync(path.join(dir, "_bmad-output", "planning-artifacts"))) return "bmad-new";
  if (fs.existsSync(path.join(dir, "docs", "sprint-artifacts"))) return "bmad-old";
  return "flat";
}

/** Choose a parse layout from the resolved config, falling back to legacy detection. */
function layoutForConfig(config: BmadConfig, dir: string): "bmad-new" | "bmad-old" | "flat" {
  if (config.version === "v6" || config.version === "unknown") {
    if (fs.existsSync(config.planningDir) || fs.existsSync(config.implementationDir)) return "bmad-new";
  }
  if (config.version === "v4" || config.version === "v5") {
    if (fs.existsSync(config.implementationDir)) return "bmad-old";
  }
  return detectStructure(dir);
}

export function parseBmadProject(opts: ParseOptions): BmadProject {
  const { dir } = opts;
  const config = resolveBmadConfig(dir);
  const mode = opts.mode === "auto" || !opts.mode ? layoutForConfig(config, dir) : opts.mode;
  const raw: Record<string, string> = {};
  const epics: Epic[] = [];
  const standaloneStories: UserStory[] = [];
  let frMap: FrMapRow[] = [];

  if (mode === "bmad-new") {
    const planDir = config.planningDir;
    const implDir = config.implementationDir;

    // Parse epics.md (single file with all epics)
    const epicsFile = path.join(planDir, "epics.md");
    if (fs.existsSync(epicsFile)) {
      const content = fs.readFileSync(epicsFile, "utf-8");
      raw[path.relative(dir, epicsFile)] = content;
      epics.push(...parseEpicsFile(content, epicsFile));
      frMap = parseFrCoverageMap(content);
    }

    // Parse standalone story files
    for (const file of findMarkdownFiles(implDir)) {
      const content = fs.readFileSync(file, "utf-8");
      raw[path.relative(dir, file)] = content;
      const story = parseStoryFile(content, file);
      if (story) standaloneStories.push(story);
    }

  } else if (mode === "bmad-old") {
    // v4/v5: docs/stories/*.md + docs/prd/epic-*.md, driven by config paths.
    const storyDir = config.implementationDir;
    const epicDir = config.planningDir;
    for (const file of findMarkdownFiles(epicDir)) {
      if (!/epic-\d+/i.test(path.basename(file))) continue;
      const content = fs.readFileSync(file, "utf-8");
      raw[path.relative(dir, file)] = content;
      const epic = parseOldEpicFile(content, file);
      if (epic) epics.push(epic);
    }
    for (const file of findMarkdownFiles(storyDir)) {
      const content = fs.readFileSync(file, "utf-8");
      raw[path.relative(dir, file)] = content;
      const story = parseStoryFile(content, file);
      if (story) standaloneStories.push(story);
    }

    // Legacy docs/sprint-artifacts/ community variant (kept as a fallback).
    const sprintDir = path.join(dir, "docs", "sprint-artifacts");
    if (fs.existsSync(sprintDir)) {
      for (const file of findMarkdownFiles(path.join(sprintDir, "epics"))) {
        const content = fs.readFileSync(file, "utf-8");
        raw[path.relative(dir, file)] = content;
        const epic = parseOldEpicFile(content, file);
        if (epic) epics.push(epic);
      }
      for (const file of findMarkdownFiles(path.join(sprintDir, "stories"))) {
        const content = fs.readFileSync(file, "utf-8");
        raw[path.relative(dir, file)] = content;
        const story = parseStoryFile(content, file);
        if (story) standaloneStories.push(story);
      }
    }

  } else {
    for (const file of findMarkdownFiles(dir)) {
      const content = fs.readFileSync(file, "utf-8");
      raw[path.relative(dir, file)] = content;
      // Try as epic file first
      const parsedEpics = parseEpicsFile(content, file);
      if (parsedEpics.length > 0) {
        epics.push(...parsedEpics);
        if (!frMap.length) frMap = parseFrCoverageMap(content);
        continue;
      }
      const epic = parseOldEpicFile(content, file);
      if (epic) { epics.push(epic); continue; }
      const story = parseStoryFile(content, file);
      if (story) standaloneStories.push(story);
    }
  }

  const epicNumOf = (e: Epic) => parseInt(e.id.replace(/\D/g, ""), 10).toString();

  // Merge standalone stories into parent epics; create the epic if it exists
  // only as story files (e.g. an epic with no header in epics.md).
  for (const story of standaloneStories) {
    const epicNum = parseInt(story.id.split(".")[0], 10).toString();
    let parentEpic = epics.find((e) => epicNumOf(e) === epicNum);
    if (!parentEpic) {
      parentEpic = { id: `EPIC-${epicNum.padStart(2, "0")}`, title: `Epic ${epicNum}`, description: "", stories: [] };
      epics.push(parentEpic);
    }
    const existingIdx = parentEpic.stories.findIndex((s) => s.id === story.id);
    if (existingIdx >= 0) {
      const existing = parentEpic.stories[existingIdx];
      if (!story.status || story.status === "todo") story.status = existing.status;
      parentEpic.stories[existingIdx] = story;
    } else {
      parentEpic.stories.push(story);
    }
  }

  // ─── Reconcile with sprint-status.yaml (authoritative in v6) ──────
  const sprintStatus = mode === "bmad-new" ? loadSprintStatus(config.implementationDir) : null;
  if (sprintStatus) reconcileSprintStatus(epics, sprintStatus);

  for (const epic of epics) {
    epic.stories.sort((a, b) => {
      const aParts = a.id.split(".").map(Number);
      const bParts = b.id.split(".").map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
  }
  epics.sort((a, b) => Number(epicNumOf(a)) - Number(epicNumOf(b)));

  // ─── Documents index ─────────────────────────────────────────────
  let documents: BmadDocument[];
  try { documents = parseDocuments(config); } catch { documents = []; }

  return {
    name: config.projectName || path.basename(path.resolve(dir)),
    epics,
    raw,
    config,
    sprintStatus: sprintStatus ?? undefined,
    documents,
    nextStep: computeNextStep(sprintStatus),
    risks: computeRisks(sprintStatus, epics),
    frMap: frMap.length ? frMap : undefined,
  };
}

// ─── Sprint-status reconciliation ───────────────────────────────────
// sprint-status.yaml is authoritative for status; per-file Status: is the
// fallback. Records statusSource and flags drift so the UI can surface it.

const STORY_KEY_RE = /^(\d+)-(\d+)-/;

function reconcileSprintStatus(epics: Epic[], sprint: SprintStatus): void {
  const epicByNum = new Map<number, Epic>();
  for (const e of epics) epicByNum.set(parseInt(e.id.replace(/\D/g, ""), 10), e);

  // Epic + retrospective status.
  for (const [key, status] of Object.entries(sprint.epics)) {
    const num = parseInt(key.replace(/\D/g, ""), 10);
    let epic = epicByNum.get(num);
    if (!epic) {
      epic = { id: `EPIC-${String(num).padStart(2, "0")}`, title: `Epic ${num}`, description: "", stories: [] };
      epics.push(epic);
      epicByNum.set(num, epic);
    }
    epic.status = status;
  }
  for (const [key, status] of Object.entries(sprint.retrospectives)) {
    const num = parseInt(key.replace(/\D/g, ""), 10);
    const epic = epicByNum.get(num);
    if (epic) epic.retrospectiveStatus = status;
  }

  // Story status.
  for (const [key, rawSprintStatus] of Object.entries(sprint.stories)) {
    const m = key.match(STORY_KEY_RE);
    if (!m) continue;
    const epicNum = parseInt(m[1], 10);
    const storyId = `${epicNum}.${parseInt(m[2], 10)}`;
    let epic = epicByNum.get(epicNum);
    if (!epic) {
      epic = { id: `EPIC-${String(epicNum).padStart(2, "0")}`, title: `Epic ${epicNum}`, description: "", stories: [] };
      epics.push(epic);
      epicByNum.set(epicNum, epic);
    }
    let story = epic.stories.find((s) => s.id === storyId);
    const boardStatus = parseStatus(rawSprintStatus);
    if (!story) {
      // Backlog story that lives only in sprint-status — create a stub.
      const slug = key.replace(STORY_KEY_RE, "").replace(/-/g, " ").trim();
      story = {
        id: storyId,
        title: slug ? slug.replace(/\b\w/g, (c) => c.toUpperCase()) : `Story ${storyId}`,
        description: "",
        acceptanceCriteria: [],
        tasks: [],
      };
      epic.stories.push(story);
    }
    // Flag drift before overwriting: file-derived board status vs sprint status.
    if (story.rawStatus && story.status && story.status !== boardStatus) {
      story.statusConflict = true;
    }
    story.status = boardStatus;
    story.rawStatus = rawSprintStatus;
    story.statusSource = "sprint-status";
  }
}

// ─── Write-back: status ─────────────────────────────────────────────

/** Find the sprint-status.yaml key for a story (from its filename or number prefix). */
function sprintKeyForStory(project: BmadProject, story: UserStory): string | undefined {
  if (story.sourceFile) {
    const base = path.basename(story.sourceFile).replace(/\.md$/, "");
    if (STORY_KEY_RE.test(base)) return base;
  }
  // Fall back to matching a sprint-status key by "{epic}-{story}-" prefix.
  const [epicNum, storyNum] = story.id.split(".").map((n) => parseInt(n, 10));
  const prefix = `${epicNum}-${storyNum}-`;
  const keys = project.sprintStatus ? Object.keys(project.sprintStatus.stories) : [];
  return keys.find((k) => k.startsWith(prefix));
}

export function updateStoryStatus(
  project: BmadProject, epicId: string, storyId: string, newStatus: BoardStatus
): { ok: boolean; error?: string } {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) return { ok: false, error: "Epic not found" };
  const story = epic.stories.find((s) => s.id === storyId);
  if (!story) return { ok: false, error: "Story not found" };
  const mdStatus = statusToMarkdown(newStatus);

  // ─── Write the story file (if one exists) ───
  const filePath = story.sourceFile;
  if (filePath && fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, "utf-8");
    const hasWindows = content.includes("\r\n");
    const norm = content.replace(/\r\n/g, "\n");

    let updated: string;
    if (/^Status:\s/m.test(norm)) {
      updated = norm.replace(/^(Status:\s*)[^\n]*$/m, `$1${mdStatus}`);
    } else if (/^\*\*Status:\*\*/m.test(norm)) {
      updated = norm.replace(/^(\*\*Status:\*\*\s*)[^\n]*$/m, `$1${mdStatus}`);
    } else {
      const lines = norm.split("\n");
      const h1Idx = lines.findIndex((l) => /^#\s+Story/i.test(l));
      if (h1Idx >= 0) {
        lines.splice(h1Idx + 1, 0, "", `Status: ${mdStatus}`);
        updated = lines.join("\n");
      } else {
        updated = norm;
      }
    }
    fs.writeFileSync(filePath, hasWindows ? updated.replace(/\n/g, "\r\n") : updated, "utf-8");
  }

  // ─── Mirror into sprint-status.yaml (authoritative in v6) ───
  if (project.config && project.sprintStatus) {
    const key = sprintKeyForStory(project, story);
    if (key) {
      const res = writeSprintStatusEntry(project.config.implementationDir, key, mdStatus);
      if (res.ok) project.sprintStatus.stories[key] = mdStatus;
      // A failed yaml sync is non-fatal — the story file is still updated.
    }
  }

  if (!filePath && !(project.config && project.sprintStatus)) {
    return { ok: false, error: "Source file not found" };
  }

  story.status = newStatus;
  story.statusConflict = false;
  return { ok: true };
}

/** Update an epic's status in sprint-status.yaml. */
export function updateEpicStatus(
  project: BmadProject, epicId: string, newStatus: string
): { ok: boolean; error?: string } {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) return { ok: false, error: "Epic not found" };
  if (!project.config || !project.sprintStatus) return { ok: false, error: "No sprint-status.yaml" };
  const num = parseInt(epic.id.replace(/\D/g, ""), 10);
  const key = `epic-${num}`;
  const res = writeSprintStatusEntry(project.config.implementationDir, key, newStatus);
  if (!res.ok) return res;
  project.sprintStatus.epics[key] = newStatus;
  epic.status = newStatus;
  return { ok: true };
}

// ─── Write-back: toggle AC ──────────────────────────────────────────

export function toggleAcceptanceCriteria(
  project: BmadProject, epicId: string, storyId: string, acIndex: number, done: boolean
): { ok: boolean; error?: string } {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) return { ok: false, error: "Epic not found" };
  const story = epic.stories.find((s) => s.id === storyId);
  if (!story) return { ok: false, error: "Story not found" };
  const ac = story.acceptanceCriteria.find((a) => a.id === `AC-${acIndex}`);
  if (!ac) return { ok: false, error: `AC-${acIndex} not found` };
  const filePath = story.sourceFile;
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: "Source file not found" };

  let content = fs.readFileSync(filePath, "utf-8");
  const hasWindows = content.includes("\r\n");
  const norm = content.replace(/\r\n/g, "\n");
  const lines = norm.split("\n");
  const checkboxRe = /^(\s*-\s*)\[([ xX])\](.*)$/;

  // Scope counting to the "## Acceptance Criteria" section only — counting every
  // checkbox in the file desyncs indices whenever Tasks precede or interleave ACs.
  const [acStart, acEnd] = sectionBounds(lines, /^#{1,6}\s+acceptance criteria/i);
  let count = 0;

  for (let i = acStart; i < acEnd; i++) {
    const m = lines[i].match(checkboxRe);
    if (m) {
      count++;
      if (count === acIndex) {
        lines[i] = m[1] + "[" + (done ? "x" : " ") + "]" + m[3];
        const updated = lines.join(hasWindows ? "\r\n" : "\n");
        fs.writeFileSync(filePath, updated, "utf-8");
        ac.done = done;
        return { ok: true };
      }
    }
  }
  return { ok: false, error: "Checkbox not found in Acceptance Criteria section" };
}

/**
 * Return [start, end) line indices spanning the section whose heading matches
 * `headingRe`, up to the next same-or-higher-level heading. Falls back to the
 * whole file when the heading is absent.
 */
function sectionBounds(lines: string[], headingRe: RegExp): [number, number] {
  let start = -1;
  let headingDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+/);
    if (h && headingRe.test(lines[i])) {
      start = i + 1;
      headingDepth = h[1].length;
      break;
    }
  }
  if (start === -1) return [0, lines.length];
  for (let i = start; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+/);
    if (h && h[1].length <= headingDepth) return [start, i];
  }
  return [start, lines.length];
}

// ─── Write-back: toggle Task ────────────────────────────────────────

export function toggleTask(
  project: BmadProject, epicId: string, storyId: string, taskId: string, done: boolean
): { ok: boolean; error?: string } {
  const epic = project.epics.find((e) => e.id === epicId);
  if (!epic) return { ok: false, error: "Epic not found" };
  const story = epic.stories.find((s) => s.id === storyId);
  if (!story) return { ok: false, error: "Story not found" };

  // Find task (might be a subtask like T1.2)
  let task: Task | undefined;
  for (const t of story.tasks) {
    if (t.id === taskId) { task = t; break; }
    if (t.subtasks) {
      const sub = t.subtasks.find((s) => s.id === taskId);
      if (sub) { task = sub; break; }
    }
  }
  if (!task) return { ok: false, error: `Task ${taskId} not found` };

  const filePath = story.sourceFile;
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: "Source file not found" };

  // Find the Nth checkbox that matches this task's description
  let content = fs.readFileSync(filePath, "utf-8");
  const hasWindows = content.includes("\r\n");
  const norm = content.replace(/\r\n/g, "\n");
  const lines = norm.split("\n");
  const checkboxRe = /^(\s*-\s*)\[([ xX])\](.*)$/;

  // Match by description text since task IDs are generated
  const descStart = task.description.slice(0, 40);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(checkboxRe);
    if (m && m[3].includes(descStart.slice(0, 20))) {
      lines[i] = m[1] + "[" + (done ? "x" : " ") + "]" + m[3];
      const updated = lines.join(hasWindows ? "\r\n" : "\n");
      fs.writeFileSync(filePath, updated, "utf-8");
      task.done = done;
      return { ok: true };
    }
  }
  return { ok: false, error: "Checkbox not found in file" };
}
