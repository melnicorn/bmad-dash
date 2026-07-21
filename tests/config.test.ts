import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBmadConfig } from "../src/parser/config.js";

describe("resolveBmadConfig", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "bmadcfg-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function write(rel: string, content: string) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }

  it("resolves v6 config with {project-root} token substitution", () => {
    write("_bmad/bmm/config.yaml", [
      'planning_artifacts: "{project-root}/_bmad-output/planning-artifacts"',
      'implementation_artifacts: "{project-root}/_bmad-output/implementation-artifacts"',
      'project_knowledge: "{project-root}/docs"',
      "output_folder: _bmad-output",
      "project_name: my-proj",
      "user_name: Chris",
    ].join("\n"));

    const cfg = resolveBmadConfig(dir);
    expect(cfg.version).toBe("v6");
    expect(cfg.projectName).toBe("my-proj");
    expect(cfg.userName).toBe("Chris");
    expect(cfg.planningDir).toBe(path.join(dir, "_bmad-output", "planning-artifacts"));
    expect(cfg.implementationDir).toBe(path.join(dir, "_bmad-output", "implementation-artifacts"));
    expect(cfg.knowledgeDir).toBe(path.join(dir, "docs"));
  });

  it("honors a customized planning_artifacts path", () => {
    write("_bmad/bmm/config.yaml", [
      'planning_artifacts: "{project-root}/custom/plans"',
      "output_folder: out",
      "project_name: p",
    ].join("\n"));
    const cfg = resolveBmadConfig(dir);
    expect(cfg.planningDir).toBe(path.join(dir, "custom", "plans"));
  });

  it("overlays config.user.yaml on top of base config", () => {
    write("_bmad/bmm/config.yaml", 'project_name: base\noutput_folder: _bmad-output\n');
    write("_bmad/bmm/config.user.yaml", 'project_name: overridden\n');
    const cfg = resolveBmadConfig(dir);
    expect(cfg.projectName).toBe("overridden");
  });

  it("detects v5 flat/camelCase core-config.yaml", () => {
    write(".bmad-core/core-config.yaml", "devStoryLocation: docs/stories\nprdShardedLocation: docs/prd\n");
    const cfg = resolveBmadConfig(dir);
    expect(cfg.version).toBe("v5");
    expect(cfg.implementationDir).toBe(path.join(dir, "docs", "stories"));
    expect(cfg.planningDir).toBe(path.join(dir, "docs", "prd"));
  });

  it("detects v4 nested/kebab-case core-config.yml", () => {
    write(".bmad-core/core-config.yml", [
      "core-project-information:",
      "  dev-story-location: docs/stories",
    ].join("\n"));
    const cfg = resolveBmadConfig(dir);
    expect(cfg.version).toBe("v4");
    expect(cfg.implementationDir).toBe(path.join(dir, "docs", "stories"));
  });

  it("falls back to default globs with version 'unknown' when no config exists", () => {
    const cfg = resolveBmadConfig(dir);
    expect(cfg.version).toBe("unknown");
    expect(cfg.planningDir).toBe(path.join(dir, "_bmad-output", "planning-artifacts"));
  });
});
