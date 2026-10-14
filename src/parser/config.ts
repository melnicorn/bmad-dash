import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";
import type { BmadConfig, BmadVersion } from "../types/index.js";

// ─── BMAD install resolution ────────────────────────────────────────
// BMAD artifact roots are CONFIGURED, not fixed.
//   6.13+ (ticket tree) _bmad/config.toml [core].output_folder, with
//                       _bmad/custom/config{,.user}.toml overlays
//   v6 (classic)        _bmad/bmm/config.yaml (+ config.user.yaml overlay)
//   v4/v5               .bmad-core/core-config.{yml,yaml}
// When no config exists we fall back to globbing the well-known defaults.

/** Replace BMAD path tokens ({project-root}, {output_folder}) and resolve to absolute. */
function resolvePath(value: string, projectDir: string, outputFolder: string): string {
  const substituted = value
    .replace(/\{project-root\}/g, projectDir)
    .replace(/\{output_folder\}/g, outputFolder);
  return path.isAbsolute(substituted) ? substituted : path.join(projectDir, substituted);
}

function readYamlSafe(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = parseYaml(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readTomlSafe(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = parseToml(fs.readFileSync(file, "utf-8").replace(/^﻿/, ""));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Shallow-merge an optional user-override layer on top of base config. */
function mergeConfig(
  base: Record<string, unknown>,
  overlay: Record<string, unknown> | null,
): Record<string, unknown> {
  return overlay ? { ...base, ...overlay } : base;
}

function isTable(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Table-wise merge of BMAD's config layers, as `_bmad/scripts/config_utils.py` does it. */
function mergeLayers(layers: (Record<string, unknown> | null)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      out[key] = isTable(value) && isTable(out[key]) ? { ...out[key], ...value } : value;
    }
  }
  return out;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

// ─── 6.13+ ticket tree ──────────────────────────────────────────────

export const BMAD_TOML_CONFIG = path.join("_bmad", "config.toml");

/**
 * The merged `[core]` table of a 6.13+ install: `_bmad/config.toml`, then the
 * `_bmad/custom/config.toml` and `_bmad/custom/config.user.toml` overlays.
 */
export function loadCoreToml(projectDir: string): Record<string, unknown> {
  const bmad = path.join(projectDir, "_bmad");
  const merged = mergeLayers([
    readTomlSafe(path.join(bmad, "config.toml")),
    readTomlSafe(path.join(bmad, "custom", "config.toml")),
    readTomlSafe(path.join(bmad, "custom", "config.user.toml")),
  ]);
  return isTable(merged.core) ? merged.core : {};
}

/** Folders under `{output_folder}` that look like an initiative (one holds a tickets.toml). */
function initiativeCandidates(outputDir: string): string[] {
  if (!fs.existsSync(outputDir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(outputDir, entry.name);
    if (fs.existsSync(path.join(dir, "tickets.toml"))) out.push(dir);
  }
  return out.sort();
}

/** True when a project uses the 6.13+ ticket tree. */
export function hasTicketTree(projectDir: string): boolean {
  const abs = path.resolve(projectDir);
  if (fs.existsSync(path.join(abs, BMAD_TOML_CONFIG))) return true;
  return initiativeCandidates(ticketsOutputDir(abs)).length > 0;
}

function ticketsOutputDir(projectDir: string): string {
  const core = loadCoreToml(projectDir);
  const outputFolder = str(core.output_folder, "{project-root}/_bmad-output");
  return resolvePath(outputFolder, projectDir, outputFolder);
}

function resolveTickets(projectDir: string): BmadConfig {
  const core = loadCoreToml(projectDir);
  const outputFolder = str(core.output_folder, "{project-root}/_bmad-output");
  const outputDir = resolvePath(outputFolder, projectDir, outputFolder);

  // `active_initiative` names the folder; without one, the single initiative
  // folder that holds a tickets.toml is used, so a fresh install still renders.
  const active = str(core.active_initiative).trim();
  const candidates = initiativeCandidates(outputDir);
  let initiativeDir: string | undefined;
  if (active) {
    const named = path.join(outputDir, active);
    initiativeDir = fs.existsSync(named) ? named : candidates[0];
  } else {
    initiativeDir = candidates[0];
  }

  const backlogDir = path.join(outputDir, "backlog");

  return {
    version: "tickets",
    projectDir,
    // The initiative folder holds both the planning documents and the ticket tree.
    planningDir: initiativeDir ?? outputDir,
    implementationDir: initiativeDir ?? outputDir,
    knowledgeDir: path.join(projectDir, "docs"),
    outputDir,
    initiativeDir,
    backlogDir: fs.existsSync(backlogDir) ? backlogDir : undefined,
    activeInitiative: initiativeDir ? path.basename(initiativeDir) : undefined,
    projectName: str(core.project_name, path.basename(projectDir)),
    userName: str(core.user_name) || undefined,
  };
}

// ─── v6 (classic) ───────────────────────────────────────────────────

function resolveV6(projectDir: string, bmmCfgPath: string): BmadConfig {
  const base = readYamlSafe(bmmCfgPath) ?? {};
  const overlay = readYamlSafe(path.join(path.dirname(bmmCfgPath), "config.user.yaml"));
  const cfg = mergeConfig(base, overlay);

  const outputFolder = str(cfg.output_folder, "_bmad-output");
  const outputDir = resolvePath(outputFolder, projectDir, outputFolder);

  const planningDir = resolvePath(
    str(cfg.planning_artifacts, `${outputFolder}/planning-artifacts`),
    projectDir, outputFolder,
  );
  const implementationDir = resolvePath(
    str(cfg.implementation_artifacts, `${outputFolder}/implementation-artifacts`),
    projectDir, outputFolder,
  );
  const knowledgeDir = resolvePath(
    str(cfg.project_knowledge, "docs"),
    projectDir, outputFolder,
  );

  return {
    version: "v6",
    projectDir,
    planningDir,
    implementationDir,
    knowledgeDir,
    outputDir,
    projectName: str(cfg.project_name, path.basename(projectDir)),
    userName: str(cfg.user_name) || undefined,
  };
}

// ─── v4 / v5 ────────────────────────────────────────────────────────
// v5: .bmad-core/core-config.yaml — flat, camelCase (devStoryLocation, ...)
// v4: .bmad-core/core-config.yml  — nested under core-project-information, kebab-case

function resolveLegacy(projectDir: string, cfgPath: string, version: BmadVersion): BmadConfig {
  const raw = readYamlSafe(cfgPath) ?? {};
  // v4 nests everything under core-project-information
  const flat = (raw["core-project-information"] as Record<string, unknown>) ?? raw;

  const storyLoc = str(flat.devStoryLocation ?? flat["dev-story-location"], "docs/stories");
  const prdShardedLoc = str(
    flat.prdShardedLocation ?? flat["prdShardedLocation"] ?? flat["prd-sharded-location"],
    "docs/prd",
  );
  // For legacy layouts planning + knowledge both live under docs/
  const docsRoot = path.join(projectDir, "docs");

  return {
    version,
    projectDir,
    planningDir: path.isAbsolute(prdShardedLoc) ? prdShardedLoc : path.join(projectDir, prdShardedLoc),
    implementationDir: path.isAbsolute(storyLoc) ? storyLoc : path.join(projectDir, storyLoc),
    knowledgeDir: docsRoot,
    outputDir: docsRoot,
    projectName: str(flat.projectName ?? flat["project-name"], path.basename(projectDir)),
  };
}

// ─── Glob fallback ──────────────────────────────────────────────────

function fallbackConfig(projectDir: string): BmadConfig {
  const outputDir = path.join(projectDir, "_bmad-output");
  return {
    version: "unknown",
    projectDir,
    planningDir: path.join(outputDir, "planning-artifacts"),
    implementationDir: path.join(outputDir, "implementation-artifacts"),
    knowledgeDir: path.join(projectDir, "docs"),
    outputDir,
    projectName: path.basename(projectDir),
  };
}

// ─── Entry point ────────────────────────────────────────────────────

/** A layout the user can ask for explicitly on the command line. */
export type RequestedLayout = "auto" | "tickets" | "v6" | "v5" | "v4";

export class LayoutNotFoundError extends Error {}

/** Where each explicit layout expects to find its config, for the error message. */
const LAYOUT_EXPECTS: Record<Exclude<RequestedLayout, "auto">, string> = {
  tickets: "_bmad/config.toml, or a folder holding a tickets.toml under the output folder",
  v6: "_bmad/bmm/config.yaml",
  v5: ".bmad-core/core-config.yaml",
  v4: ".bmad-core/core-config.yml",
};

/**
 * Resolve the BMAD install for a project directory. `auto` probes
 * 6.13+ → v6 → v5 → v4, then falls back to default globs. An explicit
 * layout bypasses detection and throws when that layout is not present.
 */
export function resolveBmadConfig(projectDir: string, requested: RequestedLayout = "auto"): BmadConfig {
  const abs = path.resolve(projectDir);

  const v6Cfg = path.join(abs, "_bmad", "bmm", "config.yaml");
  const v5Cfg = path.join(abs, ".bmad-core", "core-config.yaml");
  const v4Cfg = path.join(abs, ".bmad-core", "core-config.yml");

  if (requested !== "auto") {
    switch (requested) {
      case "tickets":
        if (!hasTicketTree(abs)) break;
        return resolveTickets(abs);
      case "v6":
        if (!fs.existsSync(v6Cfg)) break;
        return resolveV6(abs, v6Cfg);
      case "v5":
        if (!fs.existsSync(v5Cfg)) break;
        return resolveLegacy(abs, v5Cfg, "v5");
      case "v4":
        if (!fs.existsSync(v4Cfg)) break;
        return resolveLegacy(abs, v4Cfg, "v4");
    }
    throw new LayoutNotFoundError(
      `No BMAD "${requested}" layout found in ${abs} — expected ${LAYOUT_EXPECTS[requested]}.`,
    );
  }

  // The ticket tree is probed first: a 6.13+ install has no bmm/config.yaml,
  // but a project mid-migration can hold both, and the newer tree wins.
  if (hasTicketTree(abs)) return resolveTickets(abs);
  if (fs.existsSync(v6Cfg)) return resolveV6(abs, v6Cfg);
  if (fs.existsSync(v5Cfg)) return resolveLegacy(abs, v5Cfg, "v5");
  if (fs.existsSync(v4Cfg)) return resolveLegacy(abs, v4Cfg, "v4");

  return fallbackConfig(abs);
}
