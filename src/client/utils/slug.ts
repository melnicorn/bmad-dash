// Client-side slug helpers — MUST match src/parser/markdown-utils.ts so that
// server-computed TOC slugs line up with the anchor ids rendered here.

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Stateful de-duplicating slugger (`part`, `part-1`, `part-2`, …). */
export function makeSlugger() {
  const seen = new Map<string, number>()
  return (text: string): string => {
    let slug = slugify(text)
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    if (count > 0) slug = `${slug}-${count}`
    return slug
  }
}
