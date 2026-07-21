import { describe, it, expect } from "vitest";
import { computeNextStep, computeRisks } from "../src/parser/next-steps.js";
import type { SprintStatus, Epic } from "../src/types/index.js";

function sprint(partial: Partial<SprintStatus>): SprintStatus {
  return {
    epics: {}, stories: {}, retrospectives: {}, actionItems: [],
    ...partial,
  };
}

// ─── Priority ladder (mirrors bmad-sprint-status step 3) ────────────

describe("computeNextStep — BMAD priority ladder", () => {
  it("prefers an in-progress story over everything else", () => {
    const s = sprint({ stories: {
      "1-1-a": "review", "2-3-b": "in-progress", "1-2-c": "ready-for-dev",
    }});
    const next = computeNextStep(s)!;
    expect(next.workflowId).toBe("dev-story");
    expect(next.targetId).toBe("2-3-b");
  });

  it("falls to code-review when a story is in review and none in progress", () => {
    const s = sprint({ stories: { "1-1-a": "review", "1-2-b": "ready-for-dev" } });
    const next = computeNextStep(s)!;
    expect(next.workflowId).toBe("code-review");
    expect(next.targetId).toBe("1-1-a");
  });

  it("recommends dev-story for ready-for-dev when nothing is active or in review", () => {
    const s = sprint({ stories: { "3-1-a": "ready-for-dev", "1-4-b": "done" } });
    expect(computeNextStep(s)!.workflowId).toBe("dev-story");
  });

  it("recommends create-story when only backlog stories remain", () => {
    const s = sprint({ stories: { "1-1-a": "done", "2-1-b": "backlog" } });
    const next = computeNextStep(s)!;
    expect(next.workflowId).toBe("create-story");
    expect(next.targetId).toBe("2-1-b");
  });

  it("recommends a retrospective when all stories are done", () => {
    const s = sprint({
      stories: { "1-1-a": "done" },
      retrospectives: { "epic-1-retrospective": "optional" },
    });
    expect(computeNextStep(s)!.workflowId).toBe("retrospective");
  });

  it("congratulates when everything is complete", () => {
    const s = sprint({
      stories: { "1-1-a": "done" },
      retrospectives: { "epic-1-retrospective": "done" },
    });
    expect(computeNextStep(s)!.workflowId).toBe("");
  });

  it("sorts by epic number then story number when picking the first target", () => {
    const s = sprint({ stories: {
      "10-1-late": "ready-for-dev", "2-10-b": "ready-for-dev", "2-2-a": "ready-for-dev",
    }});
    expect(computeNextStep(s)!.targetId).toBe("2-2-a");
  });

  it("emits a copyable BMAD workflow command", () => {
    const s = sprint({ stories: { "1-1-a": "ready-for-dev" } });
    expect(computeNextStep(s)!.command).toBe("/bmad:bmm:workflows:dev-story");
  });

  it("returns null without a sprint-status file", () => {
    expect(computeNextStep(null)).toBeNull();
  });
});

// ─── Risks ──────────────────────────────────────────────────────────

describe("computeRisks", () => {
  const noEpics: Epic[] = [];

  it("flags a stale status file", () => {
    const r = computeRisks(sprint({ stale: true, lastUpdated: "2020-01-01" }), noEpics);
    expect(r.some((x) => /stale/i.test(x.message))).toBe(true);
  });

  it("flags orphaned stories with no matching epic", () => {
    const s = sprint({ epics: { "epic-1": "done" }, stories: { "9-1-orphan": "backlog" } });
    const r = computeRisks(s, noEpics);
    expect(r.some((x) => /orphaned/i.test(x.message))).toBe(true);
  });

  it("flags an in-progress epic that has no stories", () => {
    const s = sprint({ epics: { "epic-4": "in-progress" }, stories: {} });
    const r = computeRisks(s, noEpics);
    expect(r.some((x) => /epic-4 is in progress but has no stories/i.test(x.message))).toBe(true);
  });

  it("counts stories awaiting review", () => {
    const s = sprint({ stories: { "1-1-a": "review", "1-2-b": "review" } });
    expect(computeRisks(s, noEpics).some((x) => /2 stories are awaiting code review/.test(x.message))).toBe(true);
  });

  it("advises staying focused when work is active with nothing queued", () => {
    const s = sprint({ stories: { "1-1-a": "in-progress" } });
    expect(computeRisks(s, noEpics).some((x) => /stay focused/i.test(x.message))).toBe(true);
  });

  it("surfaces status drift between the yaml and story files", () => {
    const epics: Epic[] = [{
      id: "EPIC-01", title: "E", description: "", stories: [
        { id: "1.1", title: "S", description: "", acceptanceCriteria: [], tasks: [], statusConflict: true },
      ],
    }];
    const r = computeRisks(sprint({ stories: { "1-1-s": "done" } }), epics);
    expect(r.some((x) => /disagrees with sprint-status/i.test(x.message))).toBe(true);
  });
});
