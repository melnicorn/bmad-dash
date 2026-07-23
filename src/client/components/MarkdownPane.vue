<script setup lang="ts">
import { computed } from 'vue'
import { extractMermaidBlocks, renderMarkdown } from '../utils/markdown'
import { makeSlugger } from '../utils/slug'
import MermaidDiagram from './MermaidDiagram.vue'

const props = defineProps<{
  source: string
  /** Optional pre-render filter (e.g. strip AC/Tasks sections in the story visualizer). */
  filter?: (md: string) => string
  /** Resolve a local .md href to an in-app path, or null to leave it inert. */
  resolveLink?: (href: string) => string | null
}>()

const emit = defineEmits<{ (e: 'navigate', path: string): void }>()

type Segment = { type: 'html'; html: string } | { type: 'mermaid'; code: string }

const MERMAID_PLACEHOLDER = /<div data-mermaid-idx="(\d+)"><\/div>/g

const segments = computed<Segment[]>(() => {
  const md = props.filter ? props.filter(props.source) : props.source
  const { text: stripped, blocks } = extractMermaidBlocks(md)
  const html = postProcess(renderMarkdown(stripped))

  const result: Segment[] = []
  let lastIndex = 0
  MERMAID_PLACEHOLDER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MERMAID_PLACEHOLDER.exec(html))) {
    if (match.index > lastIndex) result.push({ type: 'html', html: html.slice(lastIndex, match.index) })
    result.push({ type: 'mermaid', code: blocks[Number(match[1])] ?? '' })
    lastIndex = MERMAID_PLACEHOLDER.lastIndex
  }
  if (lastIndex < html.length) result.push({ type: 'html', html: html.slice(lastIndex) })
  return result
})

// Add heading anchor ids (for TOC deep-linking) and tag internal doc links.
function postProcess(rawHtml: string): string {
  if (typeof DOMParser === 'undefined') return rawHtml
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
  const slug = makeSlugger()
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (!h.id) h.id = slug(h.textContent ?? '')
  })
  // Mark local .md links so the click handler can intercept them.
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    if (/^[a-z]+:\/\//i.test(href) || href.startsWith('#')) return
    if (/\.md(#.*)?$/i.test(href)) a.setAttribute('data-doc-link', href)
  })
  return doc.body.innerHTML
}

function onClick(e: MouseEvent) {
  const target = (e.target as HTMLElement).closest('a[data-doc-link]') as HTMLAnchorElement | null
  if (!target) return
  const href = target.getAttribute('data-doc-link') ?? ''
  const resolved = props.resolveLink?.(href)
  if (resolved) {
    e.preventDefault()
    emit('navigate', resolved)
  }
}
</script>

<template>
  <div class="md-pane" @click="onClick">
    <template v-for="(seg, i) in segments" :key="i">
      <div v-if="seg.type === 'html'" class="md-segment" v-html="seg.html"></div>
      <MermaidDiagram v-else :code="seg.code" />
    </template>
  </div>
</template>

<style scoped>
.md-pane {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-1);
}

.md-segment { display: contents; }
.md-pane :deep(> *:first-child) { margin-top: 0; }
.md-pane :deep(> *:first-child > *:first-child) { margin-top: 0; }

.md-pane :deep(h1) {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--accent);
  margin: 1.75rem 0 0.6rem;
  letter-spacing: -0.01em;
  scroll-margin-top: 1rem;
}
.md-pane :deep(h2) {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-0);
  margin: 1.5rem 0 0.5rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3rem;
  scroll-margin-top: 1rem;
}
.md-pane :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-1);
  margin: 1.25rem 0 0.4rem;
  scroll-margin-top: 1rem;
}
.md-pane :deep(h4) { font-size: 0.9rem; font-weight: 600; color: var(--text-1); margin: 1rem 0 0.3rem; scroll-margin-top: 1rem; }
.md-pane :deep(h5) { font-size: 0.85rem; font-weight: 600; color: var(--text-2); margin: 0.9rem 0 0.25rem; scroll-margin-top: 1rem; }
.md-pane :deep(h6) { font-size: 0.82rem; font-weight: 500; color: var(--text-3); margin: 0.8rem 0 0.2rem; scroll-margin-top: 1rem; }

.md-pane :deep(p) { margin-bottom: 1rem; }

.md-pane :deep(ul),
.md-pane :deep(ol) { padding-left: 2.25rem; margin-bottom: 0.75rem; }
.md-pane :deep(li) { margin-bottom: 0.45rem; padding-top: 0.1rem; }

.md-pane :deep(a) { color: var(--accent); text-decoration: none; }
.md-pane :deep(a:hover) { text-decoration: underline; }
.md-pane :deep(a[data-doc-link]) {
  border-bottom: 1px dotted var(--accent-dim);
}

.md-pane :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.82em;
  background: var(--bg-2);
  padding: 0.1em 0.35em;
  border-radius: 3px;
  color: var(--accent);
}

.md-pane :deep(blockquote) {
  border-left: 3px solid var(--accent);
  margin: 0 0 1rem 0;
  padding: 0.5rem 0 0.5rem 1rem;
  color: var(--text-2);
  background: var(--bg-1);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.md-pane :deep(pre) {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0;
  overflow-x: auto;
  margin-bottom: 1rem;
  font-size: 0.82rem;
  line-height: 1.6;
}
.md-pane :deep(pre code.hljs) { border-radius: var(--radius); padding: 1rem 1.25rem; font-size: 0.82rem; }

/* Tables — docs (FR maps, change logs) rely on these; the story viz set lacked them. */
.md-pane :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1rem;
  font-size: 0.82rem;
  display: block;
  overflow-x: auto;
}
.md-pane :deep(th),
.md-pane :deep(td) {
  border: 1px solid var(--border);
  padding: 0.4rem 0.6rem;
  text-align: left;
  vertical-align: top;
}
.md-pane :deep(th) { background: var(--bg-2); color: var(--text-0); font-weight: 600; }
.md-pane :deep(tr:nth-child(even) td) { background: var(--bg-1); }

.md-pane :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 1.25rem 0; }
.md-pane :deep(strong) { color: var(--text-0); font-weight: 600; }
.md-pane :deep(em) { color: var(--text-2); }
.md-pane :deep(img) { max-width: 100%; height: auto; }
</style>
