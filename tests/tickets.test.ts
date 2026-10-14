import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadTicketTree, classifyTickets, titleSlug, planPath, leafPath, ticketId,
} from "../src/parser/tickets.js";
import {
  parseTicketTree, writeTicketStatus, STATE_TO_COLUMN, COLUMN_TO_STATUS,
} from "../src/parser/ticket-project.js";
import { resolveBmadConfig, hasTicketTree, LayoutNotFoundError } from "../src/parser/config.js";
import { parseBmadProject, updateStoryStatus } from "../src/parser/index.js";

// ─── Fixture: a ticket tree in the 6.13+ shape ──────────────────────
//
// Two epics whose build order is NOT their id order (epic id 2 is built
// before id 1), entries with each status, one pulled leaf file, a cross-epic
// `after`, a whole-epic gate, and a backlog folder.

let dir: string;

function write(rel: string, content: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

const OUT = "_bmad-output";
const INIT = `${OUT}/initiative-demo`;
const E_CORE = `${INIT}/epic-core`;
const E_SHELL = `${INIT}/epic-shell`;

function scaffold() {
  write("_bmad/config.toml", [
    "[core]",
    'project_name = "demo"',
    'output_folder = "{project-root}/_bmad-output"',
  ].join("\n"));
  write("_bmad/custom/config.user.toml", '[core]\nactive_initiative = "initiative-demo"\n');

  write(`${INIT}/initiative-demo.md`, [
    "---", "type: initiative", "title: Demo initiative", "covers: [CAP-1]", "after: []", "---",
    "", "# Demo initiative", "", "## Description", "", "A tree for the tests.", "",
  ].join("\n"));

  // Build order: epic-shell (id 2) first, then epic-core (id 1).
  write(`${INIT}/tickets.toml`, `
[[epic]]
id = 2
slug = "epic-shell"
title = "The shell"
covers = ["CAP-2"]

[[epic]]
id = 1
slug = "epic-core"
title = "The core"
covers = ["CAP-1", "CAP-3"]
after = [{ epic = 2, needs = "the shell to mount into" }]
`);

  // ── epic-shell: one done, one built, one dropped ──
  write(`${E_SHELL}/epic-shell.md`, [
    "---", "type: epic", "title: The shell", "parent: initiative-demo",
    "covers: [CAP-2]", "after: []", "risk: low", "---",
    "", "# The shell", "", "## Description", "", "Boots the app.", "",
    "## Done when", "", "1. It boots.", "",
  ].join("\n"));

  write(`${E_SHELL}/tickets.toml`, `
[[entry]]
id = 1
type = "story"
title = "Boot the app"
description = "Renders the first frame."
verify = "The app opens."
covers = ["CAP-2"]
after = []
hitl = false
risk = "low"

[[entry]]
id = 3
type = "spike"
title = "Pick a renderer"
description = "Measure two renderers."
verify = "A decision is recorded."
after = [1]
hitl = true
risk = "high"
notes = ["Measured on a real phone."]
references = ["docs/renderers.md"]

[[entry]]
id = 2
type = "story"
title = "Dropped idea"
description = "Abandoned."
after = [1]
`);

  write(`${E_SHELL}/story-boot-the-app-plan.md`, [
    "---", "title: 'Boot the app'", "type: 'feature'", "ticket: '1'",
    "created: '2026-01-01'", "status: 'done'", "route: 'full'", "---",
    "", "## Intent", "", "Boot it.", "", "## Implementation Notes", "", "Done.", "",
  ].join("\n"));

  write(`${E_SHELL}/spike-pick-a-renderer-plan.md`, [
    "---", "title: 'Pick a renderer'", "type: 'chore'", "ticket: '3'",
    "status: 'built'", "review: 'quick'", "---",
    "", "## Auto Run Result", "", "Passed.", "",
  ].join("\n"));

  write(`${E_SHELL}/story-dropped-idea-plan.md`, [
    "---", "title: 'Dropped idea'", "ticket: '2'", "status: 'dropped'", "---", "",
  ].join("\n"));

  // ── epic-core: gated on epic-shell; in-progress, blocked, planned, pulled ──
  write(`${E_CORE}/epic-core.md`, [
    "---", "type: epic", "title: The core", "parent: initiative-demo",
    "covers: [CAP-1, CAP-3]", "after: [epic-shell]", "risk: high", "---",
    "", "# The core", "", "## Description", "", "The actual work.", "",
  ].join("\n"));

  write(`${E_CORE}/tickets.toml`, `
[[entry]]
id = 1
type = "story"
title = "Save and resume"
description = "Persists state."
verify = "A reload restores it."
covers = ["CAP-1"]
after = ["2.3"]
hitl = false
risk = "high"

[[entry]]
id = 2
type = "story"
title = "Keyboard play"
description = "Arrow keys."
verify = "A round is solved by keyboard."
after = [1]
hitl = false
risk = "medium"

[[entry]]
id = 4
type = "bug"
title = "Wrong tap counts twice"
description = "Double counting."
after = [1]

[[entry]]
id = 5
type = "story"
title = "Puzzle realisation for + and −"
description = "Operators."
verify = "Both operators work."
after = [1]

[[entry]]
id = 6
type = "story"
title = "Blocked by hand"
description = "Someone stopped it."
after = []
`);

  // In progress.
  write(`${E_CORE}/story-save-and-resume-plan.md`, [
    "---", "title: 'Save and resume'", "ticket: '1'", "status: 'in-progress'",
    "risk: 'high'", "route: 'full'", "deferred: []", "---",
    "", "## Intent", "", "Persist it.", "", "## Review Triage Log", "", "Nothing yet.", "",
  ].join("\n"));

  // A plan whose file name does NOT match the slug of its title: it must still
  // join through its frontmatter `ticket:` field.
  write(`${E_CORE}/story-puzzle-realisation-for-add-and-sub-plan.md`, [
    "---", "title: 'Puzzle realisation for + and −'", "ticket: '5'",
    "status: 'ready-for-dev'", "---", "",
  ].join("\n"));

  // Explicitly blocked, with a reason.
  write(`${E_CORE}/story-blocked-by-hand-plan.md`, [
    "---", "title: 'Blocked by hand'", "ticket: '6'", "status: 'blocked'",
    "blocked_at: '2026-02-02'", "blocked_reason: 'waiting on a decision'", "---", "",
  ].join("\n"));

  // A pulled leaf file: its `after` and `hitl` replace the entry's (drift).
  write(`${E_CORE}/story-keyboard-play.md`, [
    "---", "type: story", "id: 2", "title: 'Keyboard play'",
    "after: [1, '2.1']", "hitl: true", "---",
    "", "# Keyboard play", "", "## Notes", "", "- Unknown: which keys open the menu?", "",
  ].join("\n"));

  // ── backlog: a leaf with no epic ──
  write(`${OUT}/backlog/story-tidy-the-readme.md`, [
    "---", "type: story", "id: 1", "title: 'Tidy the readme'", "after: []", "hitl: false", "---",
    "", "# Tidy the readme", "",
  ].join("\n"));
  write(`${OUT}/backlog/story-tidy-the-readme-plan.md`, [
    "---", "title: 'Tidy the readme'", "ticket: 'story-tidy-the-readme'", "status: 'draft'", "---", "",
  ].join("\n"));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bmadtickets-"));
  scaffold();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const initiativeDir = () => path.join(dir, INIT);

// ─── Config resolution ──────────────────────────────────────────────

describe("ticket-tree config", () => {
  it("detects the ticket tree and resolves the active initiative", () => {
    expect(hasTicketTree(dir)).toBe(true);
    const cfg = resolveBmadConfig(dir);
    expect(cfg.version).toBe("tickets");
    expect(cfg.projectName).toBe("demo");
    expect(cfg.outputDir).toBe(path.join(dir, OUT));
    expect(cfg.initiativeDir).toBe(initiativeDir());
    expect(cfg.activeInitiative).toBe("initiative-demo");
    expect(cfg.backlogDir).toBe(path.join(dir, OUT, "backlog"));
  });

  it("substitutes {project-root} in output_folder", () => {
    const cfg = resolveBmadConfig(dir);
    expect(cfg.outputDir.startsWith(dir)).toBe(true);
    expect(cfg.outputDir).not.toContain("{project-root}");
  });

  it("lets the user config override the base config", () => {
    write("_bmad/custom/config.user.toml", [
      "[core]", 'active_initiative = "initiative-demo"', 'project_name = "overridden"',
    ].join("\n"));
    expect(resolveBmadConfig(dir).projectName).toBe("overridden");
  });

  it("merges the middle custom/config.toml layer under the user layer", () => {
    write("_bmad/custom/config.toml", '[core]\nproject_name = "middle"\nuser_name = "Ada"\n');
    const cfg = resolveBmadConfig(dir);
    // config.user.toml sets no project_name, so the middle layer wins over the base.
    expect(cfg.projectName).toBe("middle");
    expect(cfg.userName).toBe("Ada");
  });

  it("falls back to the only initiative folder when none is active", () => {
    fs.rmSync(path.join(dir, "_bmad/custom/config.user.toml"));
    expect(resolveBmadConfig(dir).activeInitiative).toBe("initiative-demo");
  });

  it("detects a tree with no _bmad/config.toml from the tickets.toml alone", () => {
    fs.rmSync(path.join(dir, "_bmad"), { recursive: true });
    expect(hasTicketTree(dir)).toBe(true);
    expect(resolveBmadConfig(dir).version).toBe("tickets");
  });
});

// ─── Layout selection ───────────────────────────────────────────────

describe("--bmad-version layout selection", () => {
  it("an explicit layout that is present is used", () => {
    expect(resolveBmadConfig(dir, "tickets").version).toBe("tickets");
  });

  it("an explicit layout that is absent names what it expected", () => {
    expect(() => resolveBmadConfig(dir, "v6")).toThrow(LayoutNotFoundError);
    try {
      resolveBmadConfig(dir, "v6");
    } catch (err: any) {
      expect(err.message).toContain("_bmad/bmm/config.yaml");
      expect(err.message).toContain(dir);
    }
  });

  it("an explicit v4/v5 layout is refused on a ticket tree", () => {
    expect(() => resolveBmadConfig(dir, "v4")).toThrow(/core-config\.yml/);
    expect(() => resolveBmadConfig(dir, "v5")).toThrow(/core-config\.yaml/);
  });

  it("the ticket tree wins over a v6 config left behind by a migration", () => {
    write("_bmad/bmm/config.yaml", "output_folder: _bmad-output\nproject_name: legacy\n");
    expect(resolveBmadConfig(dir).version).toBe("tickets");
    // …but asking for v6 explicitly still gets v6.
    expect(resolveBmadConfig(dir, "v6").version).toBe("v6");
  });
});

// ─── Tree semantics (mirrors tickets.py) ────────────────────────────

describe("loadTicketTree", () => {
  it("orders epics by the initiative's build order, not by id", () => {
    const tree = loadTicketTree(initiativeDir());
    expect(tree.containers.map((c) => c.slug)).toEqual(["epic-shell", "epic-core"]);
    expect(tree.containers.map((c) => c.id)).toEqual([2, 1]);
  });

  it("orders entries by table order within an epic, not by id", () => {
    const tree = loadTicketTree(initiativeDir());
    const shell = tree.tickets.filter((t) => t.epic === "epic-shell");
    expect(shell.map((t) => t.id)).toEqual([1, 3, 2]);
    const core = tree.tickets.filter((t) => t.epic === "epic-core");
    expect(core.map((t) => t.id)).toEqual([1, 2, 4, 5, 6]);
  });

  it("gives every ticket a globally unique <epic id>.<entry id> ref", () => {
    const tree = loadTicketTree(initiativeDir());
    expect(tree.tickets.map((t) => t.ref)).toEqual([
      "2.1", "2.3", "2.2", "1.1", "1.2", "1.4", "1.5", "1.6",
    ]);
  });

  it("a pulled leaf file with no plan is 'backlog', not 'planned'", () => {
    const tree = loadTicketTree(initiativeDir());
    const kb = tree.tickets.find((t) => t.ref === "1.2")!;
    expect(kb.file).toBe("story-keyboard-play.md");
    expect(kb.plan).toBeUndefined();
    expect(kb.state).toBe("backlog");
  });

  it("an entry with no file and no plan is 'planned'", () => {
    const tree = loadTicketTree(initiativeDir());
    const bug = tree.tickets.find((t) => t.ref === "1.4")!;
    expect(bug.file).toBeNull();
    expect(bug.plan).toBeUndefined();
    expect(bug.state).toBe("planned");
    expect(bug.status).toBe("");
  });

  it("derives state from the plan's status using BMAD's mapping", () => {
    const tree = loadTicketTree(initiativeDir());
    const state = (ref: string) => tree.tickets.find((t) => t.ref === ref)!.state;
    expect(state("2.1")).toBe("done");          // done
    expect(state("2.3")).toBe("review");        // built
    expect(state("2.2")).toBe("dropped");       // dropped
    expect(state("1.1")).toBe("in-progress");   // in-progress
    expect(state("1.5")).toBe("backlog");       // ready-for-dev
    expect(state("1.6")).toBe("in-progress");   // blocked
    expect(state("1.4")).toBe("planned");       // no plan at all
  });

  it("joins a plan by its frontmatter ticket field, not by the slug of the title", () => {
    const tree = loadTicketTree(initiativeDir());
    const t = tree.tickets.find((t) => t.ref === "1.5")!;
    // The title slugifies to "puzzle-realisation-for-and" — the file is named
    // "...-for-add-and-sub-plan.md" and still joins.
    expect(titleSlug(t.title)).toBe("puzzle-realisation-for-and");
    expect(t.plan).toBe("story-puzzle-realisation-for-add-and-sub-plan.md");
    expect(t.status).toBe("ready-for-dev");
  });

  it("a plan joins a backlog leaf by its file stem", () => {
    const tree = loadTicketTree(path.join(dir, OUT, "backlog"));
    const t = tree.tickets[0];
    expect(t.file).toBe("story-tidy-the-readme.md");
    expect(t.plan).toBe("story-tidy-the-readme-plan.md");
    expect(t.state).toBe("backlog");
  });

  it("resolves a cross-epic E.N reference", () => {
    const tree = loadTicketTree(initiativeDir());
    const save = tree.tickets.find((t) => t.ref === "1.1")!;
    expect(save.afterRefs).toEqual(["2.3"]);
    const spike = tree.tickets.find((t) => t.ref === "2.3")!;
    expect(spike.blocks).toContain("1.1");
  });

  it("applies an epic's own after as a gate on every ticket under it", () => {
    const tree = loadTicketTree(initiativeDir());
    for (const t of tree.tickets.filter((t) => t.epic === "epic-core")) {
      expect(t.gatedBy).toEqual(["epic-shell"]);
    }
    expect(tree.containers.find((c) => c.slug === "epic-core")!.after).toEqual(["epic-shell"]);
  });

  it("carries the needs note from the initiative's declared after", () => {
    const tree = loadTicketTree(initiativeDir());
    const core = tree.containers.find((c) => c.slug === "epic-core")!;
    expect(core.declaredAfter).toEqual([
      { epic: "epic-shell", epicId: 2, needs: "the shell to mount into" },
    ]);
  });

  it("a pulled leaf file's after and hitl replace the entry's, and the difference is drift", () => {
    const tree = loadTicketTree(initiativeDir());
    const kb = tree.tickets.find((t) => t.ref === "1.2")!;
    expect(kb.file).toBe("story-keyboard-play.md");
    expect(kb.hitl).toBe(true);                       // file says true, entry said false
    expect(kb.afterRefs).toEqual(["1.1", "2.1"]);     // file widened the entry's [1]
    expect(Object.keys(kb.drift ?? {}).sort()).toEqual(["after", "hitl"]);
  });

  it("reads Unknown: lines out of a pulled leaf file's body", () => {
    const tree = loadTicketTree(initiativeDir());
    expect(tree.tickets.find((t) => t.ref === "1.2")!.unknown)
      .toBe("which keys open the menu?");
  });

  it("counts tickets by derived state", () => {
    const tree = loadTicketTree(initiativeDir());
    expect(tree.counts).toEqual({
      total: 8, done: 1, review: 1, dropped: 1, "in-progress": 2, backlog: 2, planned: 1,
    });
  });

  it("reports no problems on a well-formed tree", () => {
    expect(loadTicketTree(initiativeDir()).problems).toEqual([]);
  });
});

// ─── Ready / blocked split ──────────────────────────────────────────

describe("classifyTickets", () => {
  it("an epic gate holds every ticket under it until that epic is done", () => {
    const tree = loadTicketTree(initiativeDir());
    const groups = classifyTickets(tree);
    // 1.5 waits on 1.1 (in-progress), and epic-core is gated on epic-shell,
    // whose container status is not "done".
    expect(groups.blocked.map((t) => t.ref)).toContain("1.5");
    expect(tree.tickets.find((t) => t.ref === "1.5")!.waitingOn)
      .toEqual(["1.1", "epic-shell"]);
  });

  it("an in-progress ticket is in flight even when its gate is unmet", () => {
    const groups = classifyTickets(loadTicketTree(initiativeDir()));
    expect(groups.inProgress.map((t) => t.ref)).toContain("1.1");
    expect(groups.blocked.map((t) => t.ref)).not.toContain("1.1");
  });

  it("a ticket in review satisfies an after, but an epic gate still waits for done", () => {
    const shellDone = [
      "---", "type: epic", "title: The shell", "status: done", "after: []", "---", "",
    ].join("\n");

    // Gate met, but 1.5 still waits on 1.1 while that is in-progress.
    write(`${E_SHELL}/epic-shell.md`, shellDone);
    let tree = loadTicketTree(initiativeDir());
    expect(classifyTickets(tree).blocked.map((t) => t.ref)).toContain("1.5");
    expect(tree.tickets.find((t) => t.ref === "1.5")!.waitingOn).toEqual(["1.1"]);

    // Move 1.1 to "built" — a review state — and 1.5 becomes ready.
    write(`${E_CORE}/story-save-and-resume-plan.md`, [
      "---", "title: 'Save and resume'", "ticket: '1'", "status: 'built'", "---", "",
    ].join("\n"));
    tree = loadTicketTree(initiativeDir());
    expect(classifyTickets(tree).readyToStart.map((t) => t.ref)).toContain("1.5");
  });

  it("an explicitly blocked ticket is blocked even with no unmet prerequisite", () => {
    const groups = classifyTickets(loadTicketTree(initiativeDir()));
    const t = groups.blocked.find((t) => t.ref === "1.6")!;
    expect(t.status).toBe("blocked");
    expect(t.blockedReason).toBe("waiting on a decision");
  });

  it("a bug needs refining before it can start", () => {
    write(`${E_SHELL}/epic-shell.md`, [
      "---", "type: epic", "title: The shell", "status: done", "after: []", "---", "",
    ].join("\n"));
    // Clear the bug's prerequisite so only the refine rule is left.
    const toml = fs.readFileSync(path.join(dir, E_CORE, "tickets.toml"), "utf-8")
      .replace('title = "Wrong tap counts twice"\ndescription = "Double counting."\nafter = [1]',
               'title = "Wrong tap counts twice"\ndescription = "Double counting."\nafter = []');
    fs.writeFileSync(path.join(dir, E_CORE, "tickets.toml"), toml, "utf-8");
    const groups = classifyTickets(loadTicketTree(initiativeDir()));
    expect(groups.readyToRefine.map((t) => t.ref)).toContain("1.4");
    expect(groups.readyToStart.map((t) => t.ref)).not.toContain("1.4");
  });

  it("done and dropped tickets fall out of every group", () => {
    const groups = classifyTickets(loadTicketTree(initiativeDir()));
    const all = [...groups.readyToStart, ...groups.readyToRefine, ...groups.inProgress, ...groups.blocked];
    expect(all.map((t) => t.ref)).not.toContain("2.1");   // done
    expect(all.map((t) => t.ref)).not.toContain("2.2");   // dropped
  });
});

// ─── Malformed trees degrade instead of crashing ────────────────────

describe("malformed trees", () => {
  it("records an unresolvable after as a problem and drops the edge", () => {
    write(`${E_SHELL}/tickets.toml`, `
[[entry]]
id = 1
type = "story"
title = "Boot the app"
after = [99]
`);
    const tree = loadTicketTree(initiativeDir());
    expect(tree.problems.join(" ")).toMatch(/after 99 names no entry in epic-shell/);
    expect(tree.tickets.find((t) => t.ref === "2.1")!.after).toEqual([]);
  });

  it("records a plan naming no ticket as a problem", () => {
    write(`${E_SHELL}/story-ghost-plan.md`, [
      "---", "title: 'Ghost'", "ticket: '77'", "status: 'done'", "---", "",
    ].join("\n"));
    const tree = loadTicketTree(initiativeDir());
    expect(tree.problems.join(" ")).toMatch(/names no entry or leaf file/);
  });

  it("an unknown plan status blocks its ticket rather than failing the parse", () => {
    write(`${E_SHELL}/story-boot-the-app-plan.md`, [
      "---", "title: 'Boot the app'", "ticket: '1'", "status: 'nonsense'", "---", "",
    ].join("\n"));
    const tree = loadTicketTree(initiativeDir());
    const t = tree.tickets.find((t) => t.ref === "2.1")!;
    expect(t.status).toBe("blocked");
    expect(t.blockedReason).toMatch(/unknown status/);
    expect(tree.problems.join(" ")).toMatch(/is not one of/);
  });

  it("a cycle is reported and broken instead of hanging", () => {
    write(`${E_SHELL}/tickets.toml`, `
[[entry]]
id = 1
type = "story"
title = "A"
after = [2]

[[entry]]
id = 2
type = "story"
title = "B"
after = [1]
`);
    const tree = loadTicketTree(initiativeDir());
    expect(tree.problems.join(" ")).toMatch(/cycle through/);
    expect(() => classifyTickets(tree)).not.toThrow();
  });

  it("malformed TOML is a problem, not a crash", () => {
    write(`${E_SHELL}/tickets.toml`, "[[entry]\nid = = 1\n");
    const tree = loadTicketTree(initiativeDir());
    expect(tree.problems.length).toBeGreaterThan(0);
    expect(tree.tickets.filter((t) => t.epic === "epic-shell")).toHaveLength(0);
  });
});

// ─── Paths ──────────────────────────────────────────────────────────

describe("ticket paths", () => {
  it("plan path is the joined plan when there is one", () => {
    const tree = loadTicketTree(initiativeDir());
    const t = tree.tickets.find((x) => x.ref === "1.1")!;
    expect(planPath(t, tree)).toBe(path.join(dir, E_CORE, "story-save-and-resume-plan.md"));
  });

  it("plan path for a ticket with no plan is <type>-<title slug>-plan.md", () => {
    const tree = loadTicketTree(initiativeDir());
    const t = tree.tickets.find((x) => x.ref === "1.4")!;
    expect(planPath(t, tree)).toBe(path.join(dir, E_CORE, "bug-wrong-tap-counts-twice-plan.md"));
  });

  it("leaf path is null until the entry is pulled", () => {
    const tree = loadTicketTree(initiativeDir());
    expect(leafPath(tree.tickets.find((x) => x.ref === "1.1")!, tree)).toBeNull();
    expect(leafPath(tree.tickets.find((x) => x.ref === "1.2")!, tree))
      .toBe(path.join(dir, E_CORE, "story-keyboard-play.md"));
  });

  it("titleSlug drops non-ascii and collapses separators", () => {
    expect(titleSlug("Save and resume")).toBe("save-and-resume");
    expect(titleSlug("Puzzle realisation for + and −")).toBe("puzzle-realisation-for-and");
    expect(titleSlug("Round flow, tiers & presentation")).toBe("round-flow-tiers-presentation");
    expect(titleSlug("!!!")).toBe("untitled");
  });

  it("ticketId treats 6 and \"6\" as one id and rejects booleans", () => {
    expect(ticketId(6)).toBe(6);
    expect(ticketId("6")).toBe(6);
    expect(ticketId("6a")).toBe("6a");
    expect(ticketId(true)).toBeNull();
    expect(ticketId("true")).toBeNull();
    expect(ticketId("3.4")).toBeNull();
  });
});

// ─── Projection onto the dashboard model ────────────────────────────

describe("parseTicketTree projection", () => {
  it("projects epics in build order with their tickets", () => {
    const cfg = resolveBmadConfig(dir);
    const result = parseTicketTree(cfg)!;
    expect(result.epics.map((e) => e.title)).toEqual(["The shell", "The core", "Backlog"]);
    expect(result.epics.map((e) => e.id)).toEqual(["EPIC-02", "EPIC-01", "EPIC-99"]);
    expect(result.epics[1].stories.map((s) => s.id)).toEqual(["1.1", "1.2", "1.4", "1.5", "1.6"]);
  });

  it("maps derived state onto board columns", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const byId = new Map(result.epics.flatMap((e) => e.stories).map((s) => [s.id, s]));
    expect(byId.get("2.1")!.status).toBe("done");
    expect(byId.get("2.3")!.status).toBe("review");
    expect(byId.get("1.1")!.status).toBe("active");
    expect(byId.get("1.4")!.status).toBe("todo");
    expect(STATE_TO_COLUMN.planned).toBe("todo");
  });

  it("carries the ticket's facts onto the story", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const spike = result.epics[0].stories.find((s) => s.id === "2.3")!;
    expect(spike.ticket).toBeDefined();
    expect(spike.ticket!.type).toBe("spike");
    expect(spike.ticket!.hitl).toBe(true);
    expect(spike.ticket!.risk).toBe("high");
    expect(spike.ticket!.verify).toBe("A decision is recorded.");
    expect(spike.ticket!.notes).toEqual(["Measured on a real phone."]);
    expect(spike.ticket!.references).toEqual(["docs/renderers.md"]);
    expect(spike.ticket!.blocks.map((b) => b.ref)).toContain("1.1");
  });

  it("keeps an epic gate out of after but inside waitingOn", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const op = result.epics[1].stories.find((s) => s.id === "1.5")!;
    // `after` is what the entry declares; the gate comes from the epic file.
    expect(op.ticket!.after.map((a) => a.ref)).toEqual(["1.1"]);
    expect(op.ticket!.waitingOn!.map((w) => w.ref)).toEqual(["1.1", "epic-shell"]);
  });

  it("decorates prerequisites with the title and state of what they name", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const save = result.epics[1].stories.find((s) => s.id === "1.1")!;
    expect(save.ticket!.after).toEqual([
      { ref: "2.3", title: "Pick a renderer", state: "review" },
    ]);
    // 1.1 is in flight, so it carries no waiting-on list.
    expect(save.ticket!.waitingOn).toBeUndefined();

    // 1.5 is blocked, and its unmet list names the whole-epic gate too.
    const op = result.epics[1].stories.find((s) => s.id === "1.5")!;
    expect(op.ticket!.waitingOn).toEqual([
      { ref: "1.1", title: "Save and resume", state: "in-progress" },
      { ref: "epic-shell", title: "The shell", isEpic: true },
    ]);
  });

  it("points the story at its plan so the detail view can render it", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const save = result.epics[1].stories.find((s) => s.id === "1.1")!;
    expect(save.sourceFile).toBe(path.join(dir, E_CORE, "story-save-and-resume-plan.md"));
    expect(save.ticket!.planPath).toBe(`${E_CORE}/story-save-and-resume-plan.md`);
    expect(save.ticket!.planMeta).toMatchObject({ risk: "high", route: "full" });
  });

  it("a ticket with no plan reports where one would go", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const bug = result.epics[1].stories.find((s) => s.id === "1.4")!;
    expect(bug.ticket!.planPath).toBeUndefined();
    expect(bug.ticket!.planTarget).toBe(`${E_CORE}/bug-wrong-tap-counts-twice-plan.md`);
  });

  it("derives epic status from its tickets", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    // epic-shell: done + built + dropped → the live ones are not all done.
    expect(result.epics[0].status).toBe("in-progress");
    expect(result.epics[1].status).toBe("in-progress");
  });

  it("an epic whose live tickets are all done is done", () => {
    write(`${E_SHELL}/spike-pick-a-renderer-plan.md`, [
      "---", "title: 'Pick a renderer'", "ticket: '3'", "status: 'done'", "---", "",
    ].join("\n"));
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    expect(result.epics[0].status).toBe("done");
  });

  it("turns epic dependencies into links with their needs note", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const core = result.epics[1];
    expect(core.dependsOn).toEqual([2]);
    expect(core.dependsOnNeeds).toEqual({ "2": "the shell to mount into" });
    expect(core.gatedBy).toEqual(["epic-shell"]);
  });

  it("collects backlog leaves into their own epic", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    const backlog = result.epics.find((e) => e.ticketSlug === "backlog")!;
    expect(backlog.stories.map((s) => s.title)).toEqual(["Tidy the readme"]);
  });

  it("summarises the tree for the dashboard", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    expect(result.summary.initiative).toBe("initiative-demo");
    expect(result.summary.initiativeTitle).toBe("Demo initiative");
    expect(result.summary.counts.total).toBe(8);
    expect(result.summary.inProgress).toContain("1.1");
    expect(result.summary.blocked).toContain("1.5");
    expect(result.summary.problems).toEqual([]);
  });

  it("lists the planning document folders under the initiative", () => {
    fs.mkdirSync(path.join(dir, INIT, "spec-demo"), { recursive: true });
    fs.mkdirSync(path.join(dir, INIT, "architecture-demo"), { recursive: true });
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    expect(result.summary.planningFolders).toEqual(["architecture-demo", "spec-demo"]);
  });

  it("recommends the next ticket the way tickets.py next would", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    // 1.1 is in-progress, so continuing it comes first.
    expect(result.nextStep!.workflowId).toBe("bmad-build");
    expect(result.nextStep!.targetId).toBe("1.1");
    expect(result.nextStep!.command).toBe("/bmad-build 1.1");
  });

  it("surfaces a blocked ticket's reason as a risk", () => {
    const result = parseTicketTree(resolveBmadConfig(dir))!;
    expect(result.risks.map((r) => r.message).join(" ")).toMatch(/1\.6 is blocked: waiting on a decision/);
  });
});

// ─── Whole-project parse ────────────────────────────────────────────

describe("parseBmadProject on a ticket tree", () => {
  it("parses the tree and labels the layout", () => {
    const project = parseBmadProject({ dir });
    expect(project.config!.version).toBe("tickets");
    expect(project.layout).toBe("tickets (BMAD 6.13+ ticket tree)");
    expect(project.name).toBe("demo");
    expect(project.epics.flatMap((e) => e.stories)).toHaveLength(9); // 8 + the backlog leaf
    expect(project.tickets!.counts.total).toBe(8);
  });

  it("excludes ticket files from the documents index", () => {
    write(`${INIT}/spec-demo/spec-demo.md`, "# Spec\n\nWhat we are building.\n");
    write(`${INIT}/architecture-demo/architecture-demo.md`, "# Architecture\n");
    const project = parseBmadProject({ dir });
    const paths = (project.documents ?? []).map((d) => path.basename(d.path));
    expect(paths).toContain("spec-demo.md");
    expect(paths).toContain("architecture-demo.md");
    expect(paths).not.toContain("epic-core.md");
    expect(paths).not.toContain("story-keyboard-play.md");
    expect(paths).not.toContain("story-save-and-resume-plan.md");
    expect(paths).not.toContain("initiative-demo.md");
  });

  it("groups documents by their planning folder", () => {
    write(`${INIT}/spec-demo/spec-demo.md`, "# Spec\n");
    write(`${INIT}/spec-demo/glossary.md`, "# Glossary\n");
    const project = parseBmadProject({ dir });
    const glossary = project.documents!.find((d) => d.path.endsWith("glossary.md"))!;
    expect(glossary.initiative).toBe("spec-demo");
  });

  it("an explicit --bmad-version that is absent throws with what it expected", () => {
    expect(() => parseBmadProject({ dir, bmadVersion: "v6" })).toThrow(LayoutNotFoundError);
  });
});

// ─── Write-back ─────────────────────────────────────────────────────

describe("status write-back", () => {
  it("writes status into an existing plan and nothing else", () => {
    const tree = loadTicketTree(initiativeDir());
    const before = fs.readFileSync(path.join(dir, E_CORE, "tickets.toml"), "utf-8");
    const res = writeTicketStatus(tree, "1.1", "in-review");
    expect(res.ok).toBe(true);
    expect(res.created).toBe(false);

    const plan = fs.readFileSync(path.join(dir, E_CORE, "story-save-and-resume-plan.md"), "utf-8");
    expect(plan).toMatch(/^status: in-review$/m);
    expect(plan).not.toMatch(/status: in-progress/);
    // The body and the other frontmatter keys survive.
    expect(plan).toMatch(/## Review Triage Log/);
    expect(plan).toMatch(/^risk: 'high'$/m);
    // tickets.toml is never touched.
    expect(fs.readFileSync(path.join(dir, E_CORE, "tickets.toml"), "utf-8")).toBe(before);
  });

  it("creates a frontmatter-only plan when the ticket has none", () => {
    const tree = loadTicketTree(initiativeDir());
    const res = writeTicketStatus(tree, "1.4", "in-progress");
    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);

    const created = path.join(dir, E_CORE, "bug-wrong-tap-counts-twice-plan.md");
    expect(fs.readFileSync(created, "utf-8")).toBe(
      "---\ntitle: 'Wrong tap counts twice'\nticket: 4\nstatus: in-progress\n---\n",
    );
    // It now joins on the next read.
    expect(loadTicketTree(initiativeDir()).tickets.find((t) => t.ref === "1.4")!.state)
      .toBe("in-progress");
  });

  it("never writes status into a leaf file", () => {
    const leaf = path.join(dir, E_CORE, "story-keyboard-play.md");
    const before = fs.readFileSync(leaf, "utf-8");
    const tree = loadTicketTree(initiativeDir());
    expect(writeTicketStatus(tree, "1.2", "done").ok).toBe(true);
    expect(fs.readFileSync(leaf, "utf-8")).toBe(before);
    expect(fs.existsSync(path.join(dir, E_CORE, "story-keyboard-play-plan.md"))).toBe(true);
  });

  it("refuses to clobber a file that is not the ticket's plan", () => {
    const squatter = path.join(dir, E_CORE, "bug-wrong-tap-counts-twice-plan.md");
    fs.writeFileSync(squatter, "not a plan\n", "utf-8");
    const tree = loadTicketTree(initiativeDir());
    const res = writeTicketStatus(tree, "1.4", "done");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exists already/);
    expect(fs.readFileSync(squatter, "utf-8")).toBe("not a plan\n");
  });

  it("sets blocked_at and blocked_reason when a reason is given", () => {
    const tree = loadTicketTree(initiativeDir());
    expect(writeTicketStatus(tree, "1.1", "blocked", { blockedReason: "needs a decision" }).ok).toBe(true);
    const plan = fs.readFileSync(path.join(dir, E_CORE, "story-save-and-resume-plan.md"), "utf-8");
    expect(plan).toMatch(/^blocked_reason: 'needs a decision'$/m);
    expect(plan).toMatch(/^blocked_at: '\d{4}-\d{2}-\d{2}'$/m);
  });

  it("clears the blocked fields when no reason is given", () => {
    const tree = loadTicketTree(initiativeDir());
    writeTicketStatus(tree, "1.1", "blocked", { blockedReason: "x" });
    writeTicketStatus(loadTicketTree(initiativeDir()), "1.1", "in-progress");
    const plan = fs.readFileSync(path.join(dir, E_CORE, "story-save-and-resume-plan.md"), "utf-8");
    expect(plan).not.toMatch(/blocked_at/);
    expect(plan).not.toMatch(/blocked_reason/);
  });

  it("a board column maps to the status a drag should write", () => {
    expect(COLUMN_TO_STATUS).toEqual({
      todo: "ready-for-dev", active: "in-progress", review: "in-review", done: "done",
    });
  });

  it("dragging a card on the board writes the plan, not the tickets.toml", () => {
    const project = parseBmadProject({ dir });
    const before = fs.readFileSync(path.join(dir, E_CORE, "tickets.toml"), "utf-8");
    const res = updateStoryStatus(project, "EPIC-01", "1.1", "review");
    expect(res.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, E_CORE, "story-save-and-resume-plan.md"), "utf-8"))
      .toMatch(/^status: in-review$/m);
    expect(fs.readFileSync(path.join(dir, E_CORE, "tickets.toml"), "utf-8")).toBe(before);
  });
});
