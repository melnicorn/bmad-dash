import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { SprintStatus, ActionItem } from "../types/index.js";

// ─── sprint-status.yaml (v6 central state tracker) ──────────────────
// A flat development_status map keyed by shape:
//   epic-{N}                 → epic status   (backlog | in-progress | done)
//   epic-{N}-retrospective   → retro status  (optional | done)
//   {epic}-{story}-{slug}     → story status  (backlog | ready-for-dev | in-progress | review | done | cancelled)
// The file also carries a human-maintained comment changelog we must never clobber.

export const SPRINT_STATUS_FILENAME = "sprint-status.yaml";

/** Legacy status aliases BMAD's own sprint-status workflow normalizes. */
const STORY_STATUS_ALIASES: Record<string, string> = {
  drafted: "ready-for-dev",
  complete: "done",
  completed: "done",
};
const EPIC_STATUS_ALIASES: Record<string, string> = {
  contexted: "in-progress",
  complete: "done",
  completed: "done",
};

function normalizeStory(status: string): string {
  const s = status.trim().toLowerCase();
  return STORY_STATUS_ALIASES[s] ?? s;
}
function normalizeEpic(status: string): string {
  const s = status.trim().toLowerCase();
  return EPIC_STATUS_ALIASES[s] ?? s;
}

const STALE_DAYS = 7;

/** Days between an ISO-ish date string and now; null if unparseable. */
function ageInDays(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function isEpicKey(key: string): boolean {
  return /^epic-\d+$/.test(key);
}
function isRetroKey(key: string): boolean {
  return /^epic-\d+-retrospective$/.test(key);
}

/** Parse a sprint-status.yaml file's contents into a normalized SprintStatus. */
export function parseSprintStatus(content: string): SprintStatus {
  const epics: Record<string, string> = {};
  const stories: Record<string, string> = {};
  const retrospectives: Record<string, string> = {};
  const actionItems: ActionItem[] = [];

  let doc: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(content);
    if (parsed && typeof parsed === "object") doc = parsed as Record<string, unknown>;
  } catch {
    doc = {};
  }

  const devStatus = doc.development_status;
  if (devStatus && typeof devStatus === "object") {
    for (const [key, rawVal] of Object.entries(devStatus as Record<string, unknown>)) {
      const val = typeof rawVal === "string" ? rawVal : String(rawVal ?? "");
      if (isRetroKey(key)) {
        retrospectives[key] = val.trim().toLowerCase();
      } else if (isEpicKey(key)) {
        epics[key] = normalizeEpic(val);
      } else {
        stories[key] = normalizeStory(val);
      }
    }
  }

  const rawItems = doc.action_items;
  if (Array.isArray(rawItems)) {
    for (const it of rawItems) {
      if (it && typeof it === "object") {
        const o = it as Record<string, unknown>;
        actionItems.push({
          epic: typeof o.epic === "number" ? o.epic : undefined,
          action: typeof o.action === "string" ? o.action : String(o.action ?? ""),
          owner: typeof o.owner === "string" ? o.owner : undefined,
          status: typeof o.status === "string" ? o.status : undefined,
        });
      }
    }
  }

  const lastUpdated = typeof doc.last_updated === "string"
    ? doc.last_updated
    : doc.last_updated != null ? String(doc.last_updated) : undefined;
  const generated = typeof doc.generated === "string"
    ? doc.generated
    : doc.generated != null ? String(doc.generated) : undefined;

  const age = ageInDays(lastUpdated ?? generated);
  const stale = age != null ? age > STALE_DAYS : undefined;

  return { epics, stories, retrospectives, actionItems, lastUpdated, generated, stale };
}

/** Load and parse sprint-status.yaml from an implementation-artifacts dir; null if absent. */
export function loadSprintStatus(implementationDir: string): SprintStatus | null {
  const file = path.join(implementationDir, SPRINT_STATUS_FILENAME);
  if (!fs.existsSync(file)) return null;
  try {
    return parseSprintStatus(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Surgical write-back ────────────────────────────────────────────
// Never round-trips the whole YAML — that would drop the comment changelog.
// Rewrites exactly the one development_status line for `key`, preserving
// indentation, inline comments elsewhere, and line endings.

/** Update a single development_status entry in-place. Returns {ok, error?}. */
export function writeSprintStatusEntry(
  implementationDir: string,
  key: string,
  status: string,
): { ok: boolean; error?: string } {
  const file = path.join(implementationDir, SPRINT_STATUS_FILENAME);
  if (!fs.existsSync(file)) return { ok: false, error: "sprint-status.yaml not found" };

  let content: string;
  try {
    content = fs.readFileSync(file, "utf-8");
  } catch (e) {
    return { ok: false, error: `read failed: ${(e as Error).message}` };
  }

  const usesCrlf = content.includes("\r\n");
  const eol = usesCrlf ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  // Match "  <key>: <value>" preserving leading indent and any trailing inline comment.
  const keyEsc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lineRe = new RegExp(`^(\\s*)(${keyEsc}\\s*:\\s*)([^\\s#]+)(.*)$`);

  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(lineRe);
    if (m) {
      lines[i] = `${m[1]}${m[2]}${status}${m[4]}`;
      found = true;
      break;
    }
  }

  if (!found) return { ok: false, error: `key not found in sprint-status.yaml: ${key}` };

  try {
    fs.writeFileSync(file, lines.join(eol), "utf-8");
  } catch (e) {
    return { ok: false, error: `write failed: ${(e as Error).message}` };
  }
  return { ok: true };
}
