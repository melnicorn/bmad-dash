import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDocuments } from "../src/parser/documents.js";
import {
  extractFrontmatter, extractHeadings, slugify, extractInlineMdLinks,
} from "../src/parser/markdown-utils.js";
import type { BmadConfig } from "../src/types/index.js";

// ─── markdown-utils ─────────────────────────────────────────────────

describe("extractFrontmatter", () => {
  it("parses a leading YAML block and strips it from the body", () => {
    const { data, body } = extractFrontmatter("---\ntitle: Hi\nstatus: final\n---\n# Heading\ntext");
    expect(data.title).toBe("Hi");
    expect(body.startsWith("# Heading")).toBe(true);
  });
  it("returns empty data when there is no frontmatter", () => {
    const { data, body } = extractFrontmatter("# No frontmatter");
    expect(data).toEqual({});
    expect(body).toBe("# No frontmatter");
  });
});

describe("extractHeadings", () => {
  it("collects ATX headings with depth and de-duplicated slugs", () => {
    const h = extractHeadings("# Title\n## Part\n## Part\n");
    expect(h).toEqual([
      { depth: 1, text: "Title", slug: "title" },
      { depth: 2, text: "Part", slug: "part" },
      { depth: 2, text: "Part", slug: "part-1" },
    ]);
  });
  it("ignores headings inside fenced code blocks", () => {
    const h = extractHeadings("# Real\n```\n# Fake\n```\n## Also Real");
    expect(h.map((x) => x.text)).toEqual(["Real", "Also Real"]);
  });
});

describe("slugify / extractInlineMdLinks", () => {
  it("slugifies punctuation and spaces", () => {
    expect(slugify("§4. Features & Scope")).toBe("4-features--scope".replace("--", "-"));
  });
  it("extracts local .md links and skips absolute URLs", () => {
    const links = extractInlineMdLinks("see [prd](prds/prd.md#vision) and [ext](https://x.com/a.md)");
    expect(links).toEqual(["prds/prd.md#vision"]);
  });
});

// ─── parseDocuments ─────────────────────────────────────────────────

describe("parseDocuments", () => {
  let dir: string;
  let config: BmadConfig;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
    const planning = path.join(dir, "_bmad-output", "planning-artifacts");
    const impl = path.join(dir, "_bmad-output", "implementation-artifacts");
    const knowledge = path.join(dir, "docs");
    for (const d of [planning, impl, knowledge]) fs.mkdirSync(d, { recursive: true });

    fs.writeFileSync(path.join(planning, "architecture.md"),
      "---\ntitle: Arch Doc\n---\n# Architecture\n## Decisions\n", "utf-8");
    fs.mkdirSync(path.join(planning, "prds", "prd-thing-2026-01-01"), { recursive: true });
    fs.writeFileSync(path.join(planning, "prds", "prd-thing-2026-01-01", "prd.md"),
      "---\ntitle: The PRD\ninputDocuments:\n  - _bmad-output/planning-artifacts/architecture.md\n---\n# PRD\nSee [arch](../../architecture.md).\n", "utf-8");
    fs.writeFileSync(path.join(planning, "epics.md"), "# Epic Breakdown\n", "utf-8");
    fs.writeFileSync(path.join(planning, ".decision-log.md"), "# hidden\n", "utf-8");
    fs.writeFileSync(path.join(impl, "1-2-some-story.md"), "# Story 1.2: Thing\nStatus: done\n", "utf-8");
    fs.writeFileSync(path.join(impl, "deferred-work.md"), "# Deferred\n", "utf-8");
    fs.writeFileSync(path.join(impl, "sprint-status.yaml"), "development_status:\n", "utf-8");

    config = {
      version: "v6", projectDir: dir, planningDir: planning,
      implementationDir: impl, knowledgeDir: knowledge, outputDir: path.join(dir, "_bmad-output"),
      projectName: "thing",
    };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("indexes planning docs but excludes story files and dotfiles", () => {
    const docs = parseDocuments(config);
    const paths = docs.map((d) => path.basename(d.path));
    expect(paths).toContain("architecture.md");
    expect(paths).toContain("prd.md");
    expect(paths).toContain("epics.md");
    expect(paths).toContain("deferred-work.md"); // non-story impl doc IS included
    expect(paths).not.toContain("1-2-some-story.md"); // story file excluded
    expect(paths).not.toContain(".decision-log.md"); // dotfile excluded
  });

  it("classifies document types", () => {
    const docs = parseDocuments(config);
    const byName = (n: string) => docs.find((d) => path.basename(d.path) === n)!;
    expect(byName("architecture.md").type).toBe("architecture");
    expect(byName("prd.md").type).toBe("prd");
    expect(byName("epics.md").type).toBe("epics");
    expect(byName("deferred-work.md").type).toBe("other");
  });

  it("prefers frontmatter title, else first H1", () => {
    const docs = parseDocuments(config);
    const arch = docs.find((d) => path.basename(d.path) === "architecture.md")!;
    expect(arch.title).toBe("Arch Doc");
    const epics = docs.find((d) => path.basename(d.path) === "epics.md")!;
    expect(epics.title).toBe("Epic Breakdown");
  });

  it("detects the initiative bundle folder for nested docs", () => {
    const docs = parseDocuments(config);
    const prd = docs.find((d) => path.basename(d.path) === "prd.md")!;
    expect(prd.initiative).toBe("prd-thing-2026-01-01");
  });

  it("resolves frontmatter inputDocuments and inline links to doc ids", () => {
    const docs = parseDocuments(config);
    const prd = docs.find((d) => path.basename(d.path) === "prd.md")!;
    const archId = docs.find((d) => path.basename(d.path) === "architecture.md")!.id;
    const inputLink = prd.links.find((l) => l.kind === "input");
    const inlineLink = prd.links.find((l) => l.kind === "inline");
    expect(inputLink?.targetId).toBe(archId);
    expect(inlineLink?.targetId).toBe(archId);
  });
});
