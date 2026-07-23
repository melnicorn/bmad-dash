<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import type { BmadDocument } from '../../types/index'
import DocTree from '../components/DocTree.vue'
import MarkdownPane from '../components/MarkdownPane.vue'
import { docTypeMeta } from '../constants/docTypes'

const store = useProjectStore()
const route = useRoute()
const router = useRouter()

const treeFilter = ref('')
const activeId = computed(() => (route.query.doc as string) || '')
const activeDoc = computed(() => store.docById(activeId.value))

const content = ref('')
const loading = ref(false)
const error = ref('')

async function loadDoc(id: string) {
  content.value = ''
  error.value = ''
  if (!id) return
  loading.value = true
  try {
    const res = await fetch(`/api/document?id=${encodeURIComponent(id)}`)
    if (!res.ok) { error.value = 'Document could not be loaded.'; return }
    const data = await res.json()
    content.value = data.content ?? ''
  } catch {
    error.value = 'Failed to load document.'
  } finally {
    loading.value = false
  }
}

watch(activeId, (id) => loadDoc(id), { immediate: true })

// Default to the first doc if none selected.
watch(() => store.documents, (docs) => {
  if (!activeId.value && docs.length) select(docs[0].id)
}, { immediate: true })

function select(id: string) {
  router.push({ name: 'docs', query: { doc: id } })
}

// ─── Related documents (upstream inputs + downstream backlinks) ───
const upstream = computed<BmadDocument[]>(() => {
  const doc = activeDoc.value
  if (!doc) return []
  const ids = new Set(doc.links.filter((l) => l.targetId).map((l) => l.targetId!))
  return [...ids].map((id) => store.docById(id)).filter((d): d is BmadDocument => !!d)
})

const downstream = computed<BmadDocument[]>(() => {
  const doc = activeDoc.value
  if (!doc) return []
  return store.documents.filter((d) =>
    d.id !== doc.id && d.links.some((l) => l.targetId === doc.id))
})

// ─── TOC ───
function scrollToHeading(slug: string) {
  const el = document.getElementById(slug)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// In-doc link resolution: rewrite a relative .md href to a doc id we know.
function resolveLink(href: string): string | null {
  const doc = activeDoc.value
  if (!doc) return null
  const bare = href.split('#')[0].replace(/^\.\//, '')
  const base = bare.split('/').pop() ?? bare
  const hit = store.documents.find((d) =>
    d.path.endsWith(bare) || d.path.split('/').pop() === base)
  return hit ? hit.id : null
}

function onNavigate(target: string) {
  select(target)
}

function metaFor(doc: BmadDocument) {
  return docTypeMeta(doc.type)
}
</script>

<template>
  <div class="docs-view">
    <!-- Doc list -->
    <div class="docs-list">
      <div class="docs-search">
        <input v-model="treeFilter" type="text" placeholder="Filter documents…" />
      </div>
      <DocTree :documents="store.documents" :active-id="activeId" :filter="treeFilter" @select="select" />
    </div>

    <!-- Content -->
    <div class="docs-main">
      <div v-if="!store.documents.length" class="docs-placeholder">
        No BMAD documents detected in this project.
      </div>
      <template v-else-if="activeDoc">
        <header class="doc-header">
          <div class="doc-crumb">
            <span class="doc-type-badge">
              <component :is="metaFor(activeDoc).icon" :size="13" :stroke-width="2" />
              {{ metaFor(activeDoc).label }}
            </span>
            <span class="doc-path">{{ activeDoc.path }}</span>
          </div>
          <h1 class="doc-title">{{ activeDoc.title }}</h1>
          <div v-if="upstream.length || downstream.length" class="related">
            <template v-if="upstream.length">
              <span class="related-label">Inputs:</span>
              <button v-for="d in upstream" :key="d.id" class="related-chip" @click="select(d.id)">{{ d.title }}</button>
            </template>
            <template v-if="downstream.length">
              <span class="related-label">Used by:</span>
              <button v-for="d in downstream" :key="d.id" class="related-chip" @click="select(d.id)">{{ d.title }}</button>
            </template>
          </div>
        </header>

        <p v-if="loading" class="docs-status">Loading…</p>
        <p v-else-if="error" class="docs-status error">{{ error }}</p>
        <MarkdownPane v-else :source="content" :resolve-link="resolveLink" @navigate="onNavigate" />
      </template>
    </div>

    <!-- TOC -->
    <aside class="docs-toc" v-if="activeDoc && activeDoc.headings.length > 1">
      <div class="toc-label">On this page</div>
      <ul>
        <li
          v-for="(h, i) in activeDoc.headings"
          :key="i"
          :class="`toc-d${Math.min(h.depth, 4)}`"
        >
          <a href="#" @click.prevent="scrollToHeading(h.slug)">{{ h.text }}</a>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.docs-view {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 220px;
  height: 100%;
  overflow: hidden;
}
.docs-list {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  background: var(--bg-1);
}
.docs-search { padding: 8px; border-bottom: 1px solid var(--border); }
.docs-search input {
  width: 100%;
  background: var(--bg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  color: var(--text-0);
  font-family: inherit;
  font-size: 0.8rem;
}
.docs-search input:focus { outline: none; border-color: var(--accent); }

.docs-main { overflow-y: auto; padding: 1.5rem 2rem; }
.docs-placeholder, .docs-status { color: var(--text-3); }
.docs-status.error { color: var(--review); }

.doc-header { border-bottom: 1px solid var(--border); margin-bottom: 1.25rem; padding-bottom: 0.75rem; }
.doc-crumb { display: flex; align-items: center; gap: 10px; margin-bottom: 0.4rem; flex-wrap: wrap; }
.doc-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  color: var(--accent);
  background: var(--accent-dim);
  border-radius: 999px;
  padding: 2px 9px;
  font-weight: 600;
}
.doc-path { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-3); }
.doc-title { font-size: 1.5rem; font-weight: 700; color: var(--text-0); margin: 0.2rem 0 0.6rem; }

.related { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.related-label { font-size: 0.72rem; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.related-chip {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  font-size: 0.76rem;
  color: var(--text-1);
  cursor: pointer;
  font-family: inherit;
}
.related-chip:hover { border-color: var(--accent); color: var(--accent); }

.docs-toc { border-left: 1px solid var(--border); overflow-y: auto; padding: 1rem 0.75rem; background: var(--bg-1); }
.toc-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); margin-bottom: 0.5rem; }
.docs-toc ul { list-style: none; margin: 0; padding: 0; }
.docs-toc li { margin: 0; }
.docs-toc a {
  display: block;
  color: var(--text-2);
  text-decoration: none;
  font-size: 0.76rem;
  padding: 2px 4px;
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.docs-toc a:hover { color: var(--accent); background: var(--bg-2); }
.toc-d1 a { font-weight: 600; color: var(--text-1); }
.toc-d2 a { padding-left: 12px; }
.toc-d3 a { padding-left: 22px; }
.toc-d4 a { padding-left: 32px; font-size: 0.72rem; }

@media (max-width: 1100px) {
  .docs-view { grid-template-columns: 220px minmax(0, 1fr); }
  .docs-toc { display: none; }
}
</style>
