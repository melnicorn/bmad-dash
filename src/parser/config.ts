import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { BmadConfig, BmadVersion } from "../types/index.js";

// ─── BMAD install resolution ────────────────────────────────────────
// BMAD artifact roots are CONFIGURED, not fixed. In v6 they live in
// _bmad/bmm/config.yaml (with an optional config.user.yaml overlay).
// v4/v5 use .bmad-core/core-config.{yml,yaml}. When no config exists we
// fall back to globbing the well-known default layouts.

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

/** Shallow-merge an optional user-override layer on top of base config. */
function mergeConfig(
  base: Record<string, unknown>,
  overlay: Record<string, unknown> | null,
): Record<string, unknown> {
  return overlay ? { ...base, ...overlay } : base;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

// ─── v6 ─────────────────────────────────────────────────────────────

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

/**
 * Resolve the BMAD install for a project directory.
 * Probes v6 → v5 → v4 config files, then falls back to default globs.
 */
export function resolveBmadConfig(projectDir: string): BmadConfig {
  const abs = path.resolve(projectDir);

  const v6Cfg = path.join(abs, "_bmad", "bmm", "config.yaml");
  if (fs.existsSync(v6Cfg)) return resolveV6(abs, v6Cfg);

  const v5Cfg = path.join(abs, ".bmad-core", "core-config.yaml");
  if (fs.existsSync(v5Cfg)) return resolveLegacy(abs, v5Cfg, "v5");

  const v4Cfg = path.join(abs, ".bmad-core", "core-config.yml");
  if (fs.existsSync(v4Cfg)) return resolveLegacy(abs, v4Cfg, "v4");

  return fallbackConfig(abs);
}
