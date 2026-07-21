import { parse as parseYaml } from "yaml";
import type { DocHeading } from "../types/index.js";

// ─── Shared markdown helpers ────────────────────────────────────────
// Lightweight, dependency-minimal utilities for frontmatter, headings,
// and anchor slugs — used by the documents layer and reusable elsewhere.

export interface Frontmatter {
  data: Record<string, unknown>;
  /** Content with the frontmatter block stripped */
  body: string;
}

/** Split a leading `---` YAML frontmatter block from the body. */
export function extractFrontmatter(content: string): Frontmatter {
  const normalized = content.replace(/^﻿/, "");
  const m = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: normalized };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { data, body: normalized.slice(m[0].length) };
}

/** GitHub-style anchor slug (matches the marked/gfm heading id scheme closely enough for TOC links). */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Extract ATX headings (`#`..`######`) from markdown body, ignoring fenced
 * code blocks. Slugs are de-duplicated the way GitHub does (`-1`, `-2`, ...).
 */
export function extractHeadings(body: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  let fenceMarker = "";

  for (const line of body.split(/\r?\n/)) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) { inFence = true; fenceMarker = fence[1][0]; }
      else if (fence[1][0] === fenceMarker) { inFence = false; }
      continue;
    }
    if (inFence) continue;

    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const depth = h[1].length;
    const text = h[2].trim();
    let slug = slugify(text);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;
    headings.push({ depth, text, slug });
  }
  return headings;
}

/** First ATX H1 in the body (outside code fences), or undefined. */
export function firstH1(body: string): string | undefined {
  return extractHeadings(body).find((h) => h.depth === 1)?.text;
}

/** Extract inline markdown links to local .md files: [label](path.md#anchor). */
export function extractInlineMdLinks(body: string): string[] {
  const links: string[] = [];
  const re = /\[[^\]]*\]\(([^)]+\.md(?:#[^)]*)?)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1].trim();
    // Skip absolute URLs
    if (/^[a-z]+:\/\//i.test(target)) continue;
    links.push(target);
  }
  return links;
}
