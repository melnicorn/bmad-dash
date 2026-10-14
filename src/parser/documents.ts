import fs from "node:fs";
import path from "node:path";
import type { BmadConfig, BmadDocument, DocType, DocLink } from "../types/index.js";
import {
  extractFrontmatter, extractHeadings, extractInlineMdLinks, firstH1,
} from "./markdown-utils.js";

// ─── BMAD document ingestion ────────────────────────────────────────
// Walks the planning / knowledge / implementation roots and builds a
// typed, cross-linked index of every BMAD artifact — the data behind
// the Documents browser. Story files are handled by the epic/story
// parser and excluded here.

/** Story files look like `1-2-slug.md` (v6) or `1.2.slug.md` (v4/v5). */
function isStoryFilename(name: string): boolean {
  return /^\d+[-.]\d+[-.]/.test(name);
}

/**
 * Files the 6.13+ ticket tree owns: container tickets (`initiative-*.md`,
 * `epic-*.md`), leaf tickets (`story|spike|bug-*.md`) and build plans
 * (`*-plan.md`). These are the board's data, not documents to browse.
 */
function isTicketFile(name: string): boolean {
  return (
    /^(story|spike|bug)-.+\.md$/.test(name) ||
    /^(epic|initiative)-.+\.md$/.test(name) ||
    /-plan\.md$/.test(name)
  );
}

/** Dotfiles BMAD writes as scratch logs — hidden from the browser by default. */
function isHiddenDoc(name: string): boolean {
  return name.startsWith(".");
}

function walkMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      out.push(...walkMarkdown(full));
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// ─── Type classification ────────────────────────────────────────────
// Ordered rules: filename-specific first, then folder/path keywords.

function classify(relPath: string, name: string): DocType {
  const base = name.toLowerCase();
  const p = relPath.toLowerCase();

  if (base === "epics.md" || /^epic-\d+\.md$/.test(base)) return "epics";
  if (base === "project-context.md") return "project-context";
  if (base.startsWith("implementation-readiness-report")) return "readiness-report";
  if (base.startsWith("sprint-change-proposal")) return "sprint-change-proposal";
  if (base.startsWith("spec-") || base === "spec.md") return "spec";
  if (/(^|[-/])retro(spective)?[-.]/.test(p) || base.includes("-retro-")) return "retrospective";
  if (base.startsWith("review-") || base.includes("review-triage") || base.includes("review-findings")) return "review";

  if (p.includes("/prds/") || base === "prd.md" || base.startsWith("prd-")) return "prd";
  if (p.includes("/architecture") || base === "architecture.md" || base.startsWith("architecture-")) return "architecture";
  if (p.includes("/briefs/") || base.startsWith("brief")) return "brief";
  if (p.includes("/ux-designs/") || p.includes("/ux-") || base.startsWith("ux-")
      || base === "design.md" || base === "experience.md") return "ux-design";
  if (p.includes("/research") || base.includes("-research") || base.startsWith("research-")) return "research";
  if (p.includes("/brainstorm") || base.startsWith("brainstorm")) return "brief";

  return "other";
}

/**
 * The bundle folder a doc belongs to, e.g. prds/<initiative>/prd.md →
 * "<initiative>". With `flat`, the first segment is the bundle instead —
 * the 6.13+ tree nests documents one level under the initiative
 * (`spec-numception/functional-requirements.md` → "spec-numception").
 */
function detectInitiative(relFromRoot: string, flat = false): string | undefined {
  const parts = relFromRoot.split(path.sep);
  if (flat) return parts.length >= 2 ? parts[0] : undefined;
  // parts like ["prds", "prd-one-stop-shop-2026-07-02", "prd.md"]
  if (parts.length >= 3) return parts[1];
  return undefined;
}

/** Deterministic id from a project-relative path. */
export function docIdFromPath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

interface ScanRoot {
  dir: string;
  /** exclude story files (true for the implementation dir) */
  excludeStories: boolean;
  /** exclude the ticket tree's own .md files (true for a 6.13+ initiative root) */
  excludeTickets?: boolean;
  /** group docs by their first path segment rather than their second */
  flatInitiative?: boolean;
}

/**
 * Build the document index for a resolved BMAD config. Two passes so inline
 * and frontmatter links can resolve to real doc ids.
 */
export function parseDocuments(config: BmadConfig): BmadDocument[] {
  const { projectDir, planningDir, implementationDir, knowledgeDir } = config;

  // In the 6.13+ ticket tree the initiative folder is both the planning and
  // the implementation root: planning documents sit in `spec-*`, `prd-*`,
  // `architecture-*`, `ux-*` and `research-*` folders beside the epics, so
  // docs are grouped by that folder and the ticket files are skipped.
  const tickets = config.version === "tickets";
  const roots: ScanRoot[] = tickets
    ? [
        { dir: planningDir, excludeStories: true, excludeTickets: true, flatInitiative: true },
        { dir: knowledgeDir, excludeStories: false },
      ]
    : [
        { dir: planningDir, excludeStories: false },
        { dir: implementationDir, excludeStories: true },
        { dir: knowledgeDir, excludeStories: false },
      ];

  const seen = new Set<string>();
  const raw: { file: string; rel: string; root: ScanRoot }[] = [];
  for (const root of roots) {
    for (const file of walkMarkdown(root.dir)) {
      if (seen.has(file)) continue;
      const name = path.basename(file);
      if (isHiddenDoc(name)) continue;
      if (root.excludeStories && isStoryFilename(name)) continue;
      if (root.excludeTickets && isTicketFile(name)) continue;
      seen.add(file);
      raw.push({ file, rel: path.relative(projectDir, file), root });
    }
  }

  // Pass 1: build docs with resolved metadata; index by absolute + relative path.
  const byAbsPath = new Map<string, BmadDocument>();
  const byRelPath = new Map<string, BmadDocument>();
  const docs: BmadDocument[] = [];

  for (const { file, rel, root } of raw) {
    let content = "";
    let sizeBytes = 0;
    try {
      content = fs.readFileSync(file, "utf-8");
      sizeBytes = Buffer.byteLength(content, "utf-8");
    } catch {
      continue;
    }
    const { data, body } = extractFrontmatter(content);
    const name = path.basename(file);
    const relForRoot = relForContainingRoot(file, roots);
    const type = classify(rel, name);
    const initiative = relForRoot ? detectInitiative(relForRoot, root.flatInitiative) : undefined;
    const fmTitle = typeof data.title === "string" ? data.title : undefined;
    const title = fmTitle || firstH1(body) || name.replace(/\.md$/, "");

    const doc: BmadDocument = {
      id: docIdFromPath(rel),
      path: rel,
      title,
      type,
      initiative,
      frontmatter: Object.keys(data).length ? data : undefined,
      headings: extractHeadings(body),
      links: [],
      sizeBytes,
    };
    docs.push(doc);
    byAbsPath.set(path.resolve(file), doc);
    byRelPath.set(doc.path, doc);
    byRelPath.set(doc.path.replace(/\\/g, "/"), doc);
  }

  // Pass 2: resolve links now that every doc id exists.
  for (const { file, rel } of raw) {
    const doc = byAbsPath.get(path.resolve(file));
    if (!doc) continue;
    let content = "";
    try { content = fs.readFileSync(file, "utf-8"); } catch { continue; }
    const { data, body } = extractFrontmatter(content);
    const links: DocLink[] = [];

    // Frontmatter upstream inputs (inputDocuments / sources).
    for (const fmKey of ["inputDocuments", "sources"]) {
      const arr = data[fmKey];
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (typeof entry !== "string") continue;
          const targetId = resolveRef(entry, byRelPath, projectDir);
          links.push({ raw: entry, targetId, kind: "input" });
        }
      }
    }

    // Inline links to local .md files.
    const dir = path.dirname(file);
    for (const target of extractInlineMdLinks(body)) {
      const targetId = resolveRef(target, byRelPath, projectDir, dir);
      links.push({ raw: target, targetId, kind: "inline" });
    }

    doc.links = links;
  }

  docs.sort((a, b) => a.path.localeCompare(b.path));
  return docs;
}

/** Relative path from whichever scan root contains `file` (for initiative detection). */
function relForContainingRoot(file: string, roots: ScanRoot[]): string | undefined {
  const abs = path.resolve(file);
  for (const root of roots) {
    const rootAbs = path.resolve(root.dir);
    if (abs.startsWith(rootAbs + path.sep)) return path.relative(rootAbs, abs);
  }
  return undefined;
}

/**
 * Resolve a link ref (frontmatter path or inline href) to a known doc id.
 * Handles BMAD's inconsistent tokens (`_bmad_output` vs `_bmad-output`),
 * anchors, and relative hrefs.
 */
function resolveRef(
  ref: string,
  byRelPath: Map<string, BmadDocument>,
  projectDir: string,
  fromDir?: string,
): string | undefined {
  // Free-text entries (e.g. "brain dump ...") — not a path.
  if (!ref.includes(".md")) return undefined;

  let cleaned = ref.split("#")[0].trim();
  // BMAD frontmatter sometimes uses underscores in the output-folder token.
  cleaned = cleaned.replace(/_bmad_output/g, "_bmad-output");

  const candidates: string[] = [];
  if (fromDir && !path.isAbsolute(cleaned)) {
    candidates.push(path.relative(projectDir, path.resolve(fromDir, cleaned)));
  }
  candidates.push(cleaned.replace(/^\.\//, ""));

  for (const c of candidates) {
    const norm = c.replace(/\\/g, "/");
    const hit = byRelPath.get(norm) ?? byRelPath.get(c);
    if (hit) return hit.id;
    // Last-ditch: match on basename when only the filename is unambiguous.
    const base = path.basename(norm);
    for (const doc of byRelPath.values()) {
      if (path.basename(doc.path) === base) return doc.id;
    }
  }
  return undefined;
}
