#!/usr/bin/env node

import path from "node:path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { parseBmadProject } from "./parser/index.js";
import { LayoutNotFoundError, type RequestedLayout } from "./parser/config.js";
import { matchCommitsToStories } from "./git/index.js";
import { createServer } from "./server/index.js";

const args = process.argv.slice(2);

const LAYOUTS: RequestedLayout[] = ["auto", "tickets", "v6", "v5", "v4"];

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  bmad-dash — Visualize BMAD epics, stories, docs & git history

  Usage:
    npx @melnicorn/bmad-dash [path] [options]

  Arguments:
    path                     Project root (default: .)

  Options:
    -p, --port <n>           Port number (default: 3334)
    --bmad-version <layout>  BMAD layout to parse (default: auto)
    --no-git                 Skip git commit matching
    --debug                  Dump parsed data as JSON and exit
    -h, --help               Show this help

  Layouts (--bmad-version):
    auto       Detect the layout (tickets → v6 → v5 → v4 → glob fallback)
    tickets    BMAD 6.13+ ticket tree — _bmad/config.toml, initiative and epic
               tickets.toml files, status from each ticket's *-plan.md
    v6         BMAD v6 — _bmad/bmm/config.yaml, epics.md, sprint-status.yaml
    v5         BMAD v5 — .bmad-core/core-config.yaml
    v4         BMAD v4 — .bmad-core/core-config.yml

  An explicit layout skips detection and fails with what it expected and
  where, rather than quietly showing an empty dashboard.
  `);
  process.exit(0);
}

const portIdx = args.findIndex((a) => a === "-p" || a === "--port");
const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 3334;
const debug = args.includes("--debug");
const noGit = args.includes("--no-git");

// ─── --bmad-version ───
const versionIdx = args.findIndex((a) => a === "--bmad-version" || a.startsWith("--bmad-version="));
let bmadVersion: RequestedLayout = "auto";
let versionValue: string | undefined;
if (versionIdx !== -1) {
  const arg = args[versionIdx];
  versionValue = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[versionIdx + 1];
  // `6.13` and `v6.13` are friendly aliases for the ticket-tree layout.
  const normalized = (versionValue ?? "").trim().toLowerCase().replace(/^v?6\.13(\.\d+)?$/, "tickets");
  if (!LAYOUTS.includes(normalized as RequestedLayout)) {
    console.error(
      `\n  Unknown --bmad-version "${versionValue ?? ""}".` +
      `\n  Expected one of: ${LAYOUTS.join(", ")} (6.13 is an alias for tickets).\n`,
    );
    process.exit(1);
  }
  bmadVersion = normalized as RequestedLayout;
}

const __cliDirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__cliDirname, "public");
const isDev = !existsSync(publicDir);

/** Values consumed by a flag must not be mistaken for the project path. */
const consumed = new Set<string>();
if (portIdx !== -1 && args[portIdx + 1]) consumed.add(args[portIdx + 1]);
if (versionIdx !== -1 && !args[versionIdx].includes("=") && versionValue) consumed.add(versionValue);

const dir = path.resolve(
  args.find((a) => !a.startsWith("-") && !consumed.has(a)) ?? ".",
);

console.log(`\n  Scanning: ${dir}`);

let project;
try {
  project = parseBmadProject({ dir, bmadVersion });
} catch (err: any) {
  if (err instanceof LayoutNotFoundError) {
    console.error(`\n  ${err.message}`);
    console.error(`  Drop --bmad-version to let bmad-dash detect the layout.\n`);
    process.exit(1);
  }
  throw err;
}

console.log(`  Layout: ${project.layout ?? "unknown"}${bmadVersion === "auto" ? " (detected)" : " (--bmad-version)"}`);

const storyCount = project.epics.reduce((n, e) => n + e.stories.length, 0);
const unit = project.config?.version === "tickets" ? "tickets" : "stories";
console.log(`  Found ${project.epics.length} epics, ${storyCount} ${unit}`);

if (project.tickets?.problems.length) {
  console.log(`  ${project.tickets.problems.length} tree problem(s):`);
  for (const p of project.tickets.problems.slice(0, 5)) console.log(`    - ${p}`);
}

if (debug) {
  console.log(JSON.stringify({ layout: project.layout, tickets: project.tickets, epics: project.epics }, null, 2));
  process.exit(0);
}

// Git matching
if (!noGit) {
  try {
    const mappings = await matchCommitsToStories(project, dir);
    project.commitMappings = mappings;
  } catch (err: any) {
    console.log(`  Git matching skipped: ${err.message}`);
  }
} else {
  console.log("  Git matching skipped (--no-git)");
}

createServer(project, port, isDev ? __cliDirname : undefined, dir, { bmadVersion });
