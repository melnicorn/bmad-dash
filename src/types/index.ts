export interface AcceptanceCriteria {
  id: string;
  description: string;
  done: boolean;
}

export interface Task {
  id: string;
  description: string;
  done: boolean;
  subtasks?: Task[];
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: AcceptanceCriteria[];
  tasks: Task[];
  status?: string;      // "todo" | "active" | "review" | "done"
  priority?: string;
  epicRef?: string;
  sourceFile?: string;
  /** Raw BMAD status string before normalization (e.g. "ready-for-dev", "cancelled") */
  rawStatus?: string;
  /** Where the resolved status came from: "sprint-status" | "file" — used to flag drift */
  statusSource?: StatusSource;
  /** True when sprint-status.yaml and the story file disagree on status */
  statusConflict?: boolean;
}

export type StatusSource = "sprint-status" | "file";

export interface Epic {
  id: string;
  title: string;
  description: string;
  stories: UserStory[];
  /** Raw epic status from sprint-status.yaml: "backlog" | "in-progress" | "done" */
  status?: string;
  /** Epic numbers this epic depends on, parsed from "*Depends on: Epic N*" */
  dependsOn?: number[];
  /** Requirement IDs this epic covers, from "**Requirements covered:** FR-10, ..." */
  requirements?: string[];
  /** Retrospective status from sprint-status.yaml: "optional" | "done" */
  retrospectiveStatus?: string;
}

export interface SignalBreakdown {
  storyIdMatch: number;   // 1.0 if story ID referenced, else 0
  typeGate: number;       // 1.0 if conventional type matches, 0.5 if informal feature, else 0
  pathOverlap: number;    // Jaccard on file path tokens
  keyword: number;        // Jaccard on text tokens
  embedding: number;      // cosine similarity
  nli: number;            // zero-shot NLI score (0 if skipped)
  diffSignal: number;     // Jaccard on diff +line tokens vs story path tokens
}

export interface CommitMapping {
  sha: string;
  message: string;
  body: string;
  files: string[];
  date: string;
  storyId: string | null;
  score: number;
  signalBreakdown: SignalBreakdown;
  pipeline_version: string;
}

// ─── BMAD install config ────────────────────────────────────────────

export type BmadVersion = "v6" | "v5" | "v4" | "unknown";

export interface BmadConfig {
  version: BmadVersion;
  /** Absolute path to the project root */
  projectDir: string;
  /** Absolute path to planning artifacts (PRD, architecture, epics, briefs, ...) */
  planningDir: string;
  /** Absolute path to implementation artifacts (story files, sprint-status.yaml) */
  implementationDir: string;
  /** Absolute path to long-lived project knowledge (research, brownfield scans) */
  knowledgeDir: string;
  /** Absolute path to the BMAD output root */
  outputDir: string;
  projectName: string;
  userName?: string;
}

// ─── Sprint status (v6 central state tracker) ───────────────────────

export interface ActionItem {
  epic?: number;
  action: string;
  owner?: string;
  status?: string;
}

export interface SprintStatus {
  /** epic key ("epic-1") → status */
  epics: Record<string, string>;
  /** story key ("1-2-slug") → status */
  stories: Record<string, string>;
  /** retro key ("epic-1-retrospective") → status */
  retrospectives: Record<string, string>;
  actionItems: ActionItem[];
  lastUpdated?: string;
  generated?: string;
  /** True when last_updated is more than 7 days old */
  stale?: boolean;
}

// ─── Documents ──────────────────────────────────────────────────────

export type DocType =
  | "prd" | "architecture" | "epics" | "brief" | "ux-design"
  | "research" | "spec" | "retrospective" | "readiness-report"
  | "sprint-change-proposal" | "review" | "project-context" | "other";

export interface DocHeading {
  depth: number;
  text: string;
  /** URL-safe anchor slug for TOC deep-linking */
  slug: string;
}

export interface DocLink {
  /** Document id this points to, if it resolved to a known doc */
  targetId?: string;
  /** Raw path/label as written in the source */
  raw: string;
  /** "input" (from inputDocuments/sources frontmatter) or "inline" (markdown link) */
  kind: "input" | "inline";
}

export interface BmadDocument {
  /** Stable id derived from the project-relative path */
  id: string;
  /** Project-relative path */
  path: string;
  title: string;
  type: DocType;
  /** Bundle/initiative folder this doc belongs to (e.g. "prd-one-stop-shop-2026-07-02"), if any */
  initiative?: string;
  frontmatter?: Record<string, unknown>;
  headings: DocHeading[];
  /** Outgoing links (upstream inputs + inline references) */
  links: DocLink[];
  sizeBytes: number;
}

// ─── Next steps ─────────────────────────────────────────────────────

export interface NextStep {
  /** BMAD workflow id, e.g. "dev-story", "code-review", "create-story" */
  workflowId: string;
  /** Story key/id the workflow applies to, if any */
  targetId?: string;
  /** Human-readable recommendation */
  label: string;
  /** Copyable invocation, e.g. "/bmad:bmm:workflows:dev-story" */
  command: string;
}

export type RiskLevel = "info" | "warning";

export interface Risk {
  level: RiskLevel;
  message: string;
}

export interface BmadProject {
  name: string;
  epics: Epic[];
  raw: Record<string, string>;
  commitMappings?: CommitMapping[];
  config?: BmadConfig;
  sprintStatus?: SprintStatus;
  documents?: BmadDocument[];
  nextStep?: NextStep | null;
  risks?: Risk[];
  /** FR Coverage Map rows parsed from epics.md */
  frMap?: FrMapRow[];
}

export interface FrMapRow {
  requirement: string;
  epic: string;
  notes?: string;
}
