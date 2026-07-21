import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseBmadProject, toggleAcceptanceCriteria, updateStoryStatus,
} from "../src/parser/index.js";
import type { BmadProject } from "../src/types/index.js";

// Build a minimal v6 project on disk.
function scaffold(dir: string) {
  const planning = path.join(dir, "_bmad-output", "planning-artifacts");
  const impl = path.join(dir, "_bmad-output", "implementation-artifacts");
  fs.mkdirSync(planning, { recursive: true });
  fs.mkdirSync(impl, { recursive: true });
  fs.writeFileSync(path.join(dir, "_bmad", "bmm", "config.yaml"),
    'planning_artifacts: "{project-root}/_bmad-output/planning-artifacts"\n' +
    'implementation_artifacts: "{project-root}/_bmad-output/implementation-artifacts"\n' +
    'project_knowledge: "{project-root}/docs"\noutput_folder: _bmad-output\nproject_name: demo\n',
    { flag: "w" });
  return { planning, impl };
}
// mkdir for the config path
function scaffoldWithConfig(dir: string) {
  fs.mkdirSync(path.join(dir, "_bmad", "bmm"), { recursive: true });
  return scaffold(dir);
}

const EPICS_MD = `---
stepsCompleted: [1,2,3]
---
# demo - Epic Breakdown

## Epic List

### Epic 1: Foundation
Sets things up.
**Requirements covered:** FR-1, FR-2
*Foundation epic.*

### Epic 2: Features
Adds features.
**Requirements covered:** FR-3
*Depends on: Epic 1 (foundation).*

### FR Coverage Map

| Requirement | Epic | Notes |
|---|---|---|
| FR-1 | Epic 1 | setup |
| FR-3 | Epic 2 | feature work |

## Epic 1: Foundation
Sets things up.

### Story 1.1: First
As a user, I want a thing, So that I benefit.

## Epic 2: Features
Adds features.

### Story 2.1: Second
As a user, I want another, So that I gain.
`;

const STORY_COMPLETE = `# Story 1.1: First

Status: complete

## Story
As a user, I want a thing, so that I benefit.

## Acceptance Criteria
1. First criterion
2. Second criterion

## Tasks / Subtasks
- [ ] Task one
- [x] Task two
`;

describe("parseBmadProject — v6 integration", () => {
  let dir: string;
  let project: BmadProject;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
    const { planning, impl } = scaffoldWithConfig(dir);
    fs.writeFileSync(path.join(planning, "epics.md"), EPICS_MD, "utf-8");
    fs.writeFileSync(path.join(impl, "1-1-first.md"), STORY_COMPLETE, "utf-8");
    fs.writeFileSync(path.join(impl, "sprint-status.yaml"), [
      "generated: 2026-01-01",
      "last_updated: 2026-01-02",
      "development_status:",
      "  epic-1: in-progress",
      "  1-1-first: done",
      "  epic-1-retrospective: optional",
      "  epic-2: backlog",
      "  2-1-second: backlog",
      "  epic-3: done",           // epic with no epics.md header
      "  3-1-orphan-work: done",  // story with no file
    ].join("\n"), "utf-8");
    project = parseBmadProject({ dir });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("resolves config and project name from _bmad/bmm/config.yaml", () => {
    expect(project.config?.version).toBe("v6");
    expect(project.name).toBe("demo");
  });

  it("parses epic traceability: requirements and dependsOn", () => {
    const e1 = project.epics.find((e) => e.id === "EPIC-01")!;
    const e2 = project.epics.find((e) => e.id === "EPIC-02")!;
    expect(e1.requirements).toEqual(expect.arrayContaining(["FR-1", "FR-2"]));
    expect(e2.dependsOn).toEqual([1]);
  });

  it("parses the FR Coverage Map", () => {
    expect(project.frMap).toEqual([
      { requirement: "FR-1", epic: "Epic 1", notes: "setup" },
      { requirement: "FR-3", epic: "Epic 2", notes: "feature work" },
    ]);
  });

  it("treats sprint-status.yaml as authoritative for story status", () => {
    const s = project.epics.find((e) => e.id === "EPIC-01")!.stories.find((x) => x.id === "1.1")!;
    expect(s.status).toBe("done");
    expect(s.statusSource).toBe("sprint-status");
  });

  it("sets epic and retrospective status from sprint-status.yaml", () => {
    const e1 = project.epics.find((e) => e.id === "EPIC-01")!;
    expect(e1.status).toBe("in-progress");
    expect(e1.retrospectiveStatus).toBe("optional");
  });

  it("creates epics and stories that exist only in sprint-status.yaml", () => {
    const e3 = project.epics.find((e) => e.id === "EPIC-03");
    expect(e3).toBeTruthy();
    expect(e3!.status).toBe("done");
    expect(e3!.stories.find((s) => s.id === "3.1")).toBeTruthy();
  });

  it("indexes documents (epics.md appears, story file does not)", () => {
    const names = (project.documents ?? []).map((d) => path.basename(d.path));
    expect(names).toContain("epics.md");
    expect(names).not.toContain("1-1-first.md");
  });
});

describe("status + AC fixes", () => {
  let dir: string;
  let project: BmadProject;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fix-"));
    const { planning, impl } = scaffoldWithConfig(dir);
    fs.writeFileSync(path.join(planning, "epics.md"), EPICS_MD, "utf-8");
    fs.writeFileSync(path.join(impl, "1-1-first.md"), STORY_COMPLETE, "utf-8");
    // No sprint-status.yaml → per-file status is the source of truth here.
    project = parseBmadProject({ dir });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("maps 'complete' status to the done column", () => {
    const s = project.epics.find((e) => e.id === "EPIC-01")!.stories.find((x) => x.id === "1.1")!;
    expect(s.status).toBe("done");
  });

  it("toggles the correct AC checkbox even though Tasks contain checkboxes", () => {
    // Convert AC to checkbox form so the toggle has a target, with a Task checkbox present too.
    const file = path.join(dir, "_bmad-output", "implementation-artifacts", "1-1-first.md");
    fs.writeFileSync(file, [
      "# Story 1.1: First", "", "Status: in-progress", "",
      "## Acceptance Criteria",
      "- [ ] AC one",
      "- [ ] AC two", "",
      "## Tasks / Subtasks",
      "- [x] Task done",
      "- [ ] Task pending", "",
    ].join("\n"), "utf-8");
    const p = parseBmadProject({ dir });
    const res = toggleAcceptanceCriteria(p, "EPIC-01", "1.1", 2, true);
    expect(res.ok).toBe(true);
    const after = fs.readFileSync(file, "utf-8");
    // AC two flipped, Task checkboxes untouched.
    expect(after).toMatch(/- \[x\] AC two/);
    expect(after).toMatch(/- \[x\] Task done/);
    expect(after).toMatch(/- \[ \] Task pending/);
  });

  it("writes status back to the story file", () => {
    const file = path.join(dir, "_bmad-output", "implementation-artifacts", "1-1-first.md");
    const res = updateStoryStatus(project, "EPIC-01", "1.1", "review");
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toMatch(/^Status: review$/m);
  });
});
