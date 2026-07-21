import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseSprintStatus,
  loadSprintStatus,
  writeSprintStatusEntry,
} from "../src/parser/sprint-status.js";

// ─── parseSprintStatus ──────────────────────────────────────────────

const SAMPLE = `# comment header
generated: 2026-06-09
last_updated: 2026-07-06  # inline comment changelog that must survive
project: socket-tray

development_status:
  epic-1: done
  1-1-extract-worker: done
  1-2-dockerfile: ready-for-dev
  epic-1-retrospective: optional
  epic-2: in-progress
  2-1-preserve-reference: complete
  2-2-cancelled-work: cancelled
`;

describe("parseSprintStatus — classification by key shape", () => {
  it("splits development_status into epics, stories, and retrospectives", () => {
    const s = parseSprintStatus(SAMPLE);
    expect(s.epics).toEqual({ "epic-1": "done", "epic-2": "in-progress" });
    expect(s.retrospectives).toEqual({ "epic-1-retrospective": "optional" });
    expect(Object.keys(s.stories)).toContain("1-1-extract-worker");
    expect(Object.keys(s.stories)).not.toContain("epic-1");
  });

  it("normalizes legacy story status 'complete' → 'done'", () => {
    const s = parseSprintStatus(SAMPLE);
    expect(s.stories["2-1-preserve-reference"]).toBe("done");
  });

  it("preserves 'cancelled' as-is (not remapped)", () => {
    const s = parseSprintStatus(SAMPLE);
    expect(s.stories["2-2-cancelled-work"]).toBe("cancelled");
  });

  it("captures last_updated despite the trailing inline comment", () => {
    const s = parseSprintStatus(SAMPLE);
    expect(s.lastUpdated).toContain("2026-07-06");
  });

  it("flags a status file older than 7 days as stale", () => {
    const s = parseSprintStatus(SAMPLE);
    expect(s.stale).toBe(true);
  });

  it("returns empty maps for malformed yaml rather than throwing", () => {
    const s = parseSprintStatus(":::not yaml:::\n  - broken");
    expect(s.epics).toEqual({});
    expect(s.stories).toEqual({});
  });

  it("parses action_items when present", () => {
    const withItems = SAMPLE + `
action_items:
  - epic: 1
    action: "Add error-handling review"
    owner: "Charlie"
    status: open
`;
    const s = parseSprintStatus(withItems);
    expect(s.actionItems).toHaveLength(1);
    expect(s.actionItems[0]).toMatchObject({ epic: 1, owner: "Charlie", status: "open" });
  });
});

// ─── write-back ─────────────────────────────────────────────────────

describe("writeSprintStatusEntry — surgical line edit", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-"));
    file = path.join(dir, "sprint-status.yaml");
    fs.writeFileSync(file, SAMPLE, "utf-8");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("changes exactly one line and preserves the comment changelog", () => {
    const before = fs.readFileSync(file, "utf-8").split("\n");
    const res = writeSprintStatusEntry(dir, "1-2-dockerfile", "in-progress");
    expect(res.ok).toBe(true);

    const after = fs.readFileSync(file, "utf-8").split("\n");
    const diff = after.filter((l, i) => l !== before[i]);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain("1-2-dockerfile: in-progress");
    // The human changelog comment is untouched.
    expect(fs.readFileSync(file, "utf-8")).toContain("inline comment changelog that must survive");
  });

  it("updates an epic key", () => {
    const res = writeSprintStatusEntry(dir, "epic-2", "done");
    expect(res.ok).toBe(true);
    expect(loadSprintStatus(dir)!.epics["epic-2"]).toBe("done");
  });

  it("errors when the key is absent", () => {
    const res = writeSprintStatusEntry(dir, "9-9-nope", "done");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it("errors when the file is missing", () => {
    const res = writeSprintStatusEntry(path.join(dir, "nope"), "epic-1", "done");
    expect(res.ok).toBe(false);
  });
});
