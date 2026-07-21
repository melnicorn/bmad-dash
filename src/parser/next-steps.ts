import type { SprintStatus, NextStep, Risk, Epic } from "../types/index.js";

// ─── Next-step recommendation ───────────────────────────────────────
// Mirrors BMAD's own bmad-sprint-status workflow (step 3 priority ladder and
// its risk rules) so the dashboard recommends exactly what the BMAD agent
// would recommend for the same sprint-status.yaml.

const WORKFLOW_PREFIX = "/bmad:bmm:workflows:";

/** Sort story keys by epic number, then story number (1-1 before 1-2 before 2-1). */
function sortStoryKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const pa = a.match(/^(\d+)-(\d+)-/);
    const pb = b.match(/^(\d+)-(\d+)-/);
    if (!pa || !pb) return a.localeCompare(b);
    return (Number(pa[1]) - Number(pb[1])) || (Number(pa[2]) - Number(pb[2]));
  });
}

function firstWithStatus(sprint: SprintStatus, status: string): string | undefined {
  const keys = Object.entries(sprint.stories)
    .filter(([, v]) => v === status)
    .map(([k]) => k);
  return sortStoryKeys(keys)[0];
}

function step(workflowId: string, label: string, targetId?: string): NextStep {
  return { workflowId, targetId, label, command: `${WORKFLOW_PREFIX}${workflowId}` };
}

/**
 * The recommended next workflow, following BMAD's priority order:
 * in-progress → review → ready-for-dev → backlog → retrospective → done.
 */
export function computeNextStep(sprint: SprintStatus | null): NextStep | null {
  if (!sprint) return null;

  const inProgress = firstWithStatus(sprint, "in-progress");
  if (inProgress) return step("dev-story", `Continue development on ${inProgress}`, inProgress);

  const review = firstWithStatus(sprint, "review");
  if (review) return step("code-review", `Run code review for ${review}`, review);

  const ready = firstWithStatus(sprint, "ready-for-dev");
  if (ready) return step("dev-story", `Start development on ${ready}`, ready);

  const backlog = firstWithStatus(sprint, "backlog");
  if (backlog) return step("create-story", `Create the story file for ${backlog}`, backlog);

  const retro = Object.entries(sprint.retrospectives)
    .filter(([, v]) => v === "optional")
    .map(([k]) => k)
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))[0];
  if (retro) return step("retrospective", `Run the retrospective for ${retro}`, retro);

  return step("", "All implementation items are done — nice work!");
}

/**
 * Risk/warning list, mirroring the detection rules in BMAD's sprint-status
 * workflow (stale status file, orphaned stories, epics with no stories, …).
 */
export function computeRisks(sprint: SprintStatus | null, epics: Epic[]): Risk[] {
  if (!sprint) return [];
  const risks: Risk[] = [];
  const values = Object.values(sprint.stories);

  const reviewCount = values.filter((v) => v === "review").length;
  if (reviewCount > 0) {
    risks.push({
      level: "info",
      message: `${reviewCount} ${reviewCount === 1 ? "story is" : "stories are"} awaiting code review.`,
    });
  }

  const hasInProgress = values.includes("in-progress");
  const hasReady = values.includes("ready-for-dev");
  if (hasInProgress && !hasReady) {
    risks.push({ level: "info", message: "Work is in progress with nothing queued — stay focused on the active story." });
  }

  const epicValues = Object.values(sprint.epics);
  if (epicValues.length > 0 && epicValues.every((v) => v === "backlog") && !hasReady) {
    risks.push({ level: "warning", message: "No epic has started yet — create the first story to begin." });
  }

  if (sprint.stale) {
    const when = sprint.lastUpdated ?? sprint.generated;
    risks.push({
      level: "warning",
      message: `sprint-status.yaml may be stale (last updated ${when}).`,
    });
  }

  // Orphaned stories: a story key whose epic has no epic-N entry.
  const epicNums = new Set(Object.keys(sprint.epics).map((k) => k.replace(/\D/g, "")));
  const orphans = Object.keys(sprint.stories).filter((k) => {
    const m = k.match(/^(\d+)-/);
    return m ? !epicNums.has(m[1]) : false;
  });
  if (orphans.length > 0) {
    risks.push({
      level: "warning",
      message: `${orphans.length} orphaned ${orphans.length === 1 ? "story has" : "stories have"} no matching epic (e.g. ${orphans[0]}).`,
    });
  }

  // In-progress epics with no stories at all.
  for (const [key, status] of Object.entries(sprint.epics)) {
    if (status !== "in-progress") continue;
    const num = key.replace(/\D/g, "");
    const hasStories = Object.keys(sprint.stories).some((k) => k.startsWith(`${num}-`));
    if (!hasStories) {
      risks.push({ level: "warning", message: `${key} is in progress but has no stories.` });
    }
  }

  // Status drift between sprint-status.yaml and the story files.
  const conflicts = epics.flatMap((e) => e.stories).filter((s) => s.statusConflict).length;
  if (conflicts > 0) {
    risks.push({
      level: "warning",
      message: `${conflicts} ${conflicts === 1 ? "story's" : "stories'"} file status disagrees with sprint-status.yaml.`,
    });
  }

  return risks;
}
