<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BmadDocument, DocType } from '../../types/index'
import { docTypeMeta } from '../constants/docTypes'

const props = defineProps<{
  documents: BmadDocument[]
  activeId?: string
  filter?: string
}>()
const emit = defineEmits<{ (e: 'select', id: string): void }>()

interface Group {
  type: DocType
  label: string
  icon: string
  order: number
  docs: BmadDocument[]
}

const groups = computed<Group[]>(() => {
  const q = (props.filter ?? '').trim().toLowerCase()
  const byType = new Map<DocType, BmadDocument[]>()
  for (const d of props.documents) {
    if (q && !`${d.title} ${d.path}`.toLowerCase().includes(q)) continue
    if (!byType.has(d.type)) byType.set(d.type, [])
    byType.get(d.type)!.push(d)
  }
  const out: Group[] = []
  for (const [type, docs] of byType) {
    const meta = docTypeMeta(type)
    docs.sort((a, b) => a.path.localeCompare(b.path))
    out.push({ type, label: meta.label, icon: meta.icon, order: meta.order, docs })
  }
  out.sort((a, b) => a.order - b.order)
  return out
})

// Sub-group a type's docs by initiative bundle for readability.
function byInitiative(docs: BmadDocument[]): { name: string | null; docs: BmadDocument[] }[] {
  const map = new Map<string | null, BmadDocument[]>()
  for (const d of docs) {
    const key = d.initiative ?? null
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(d)
  }
  return [...map.entries()].map(([name, ds]) => ({ name, docs: ds }))
}

const collapsed = ref<Set<DocType>>(new Set())
function toggle(type: DocType) {
  const next = new Set(collapsed.value)
  next.has(type) ? next.delete(type) : next.add(type)
  collapsed.value = next
}
</script>

<template>
  <nav class="doc-tree">
    <p v-if="groups.length === 0" class="doc-empty">No documents found.</p>
    <div v-for="g in groups" :key="g.type" class="doc-group">
      <button class="doc-group-header" @click="toggle(g.type)">
        <span class="chev">{{ collapsed.has(g.type) ? '▸' : '▾' }}</span>
        <span class="doc-group-icon">{{ g.icon }}</span>
        <span class="doc-group-label">{{ g.label }}</span>
        <span class="doc-group-count">{{ g.docs.length }}</span>
      </button>
      <div v-show="!collapsed.has(g.type)" class="doc-group-body">
        <template v-for="sub in byInitiative(g.docs)" :key="sub.name ?? '_root'">
          <div v-if="sub.name" class="doc-initiative">{{ sub.name }}</div>
          <button
            v-for="d in sub.docs"
            :key="d.id"
            class="doc-item"
            :class="{ active: d.id === activeId, indented: !!sub.name }"
            :title="d.path"
            @click="emit('select', d.id)"
          >
            {{ d.title }}
          </button>
        </template>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.doc-tree { padding: 6px 0; }
.doc-empty { color: var(--text-3); font-size: 0.82rem; padding: 8px 12px; }

.doc-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px 10px;
  color: var(--text-1);
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
}
.doc-group-header:hover { color: var(--text-0); }
.chev { color: var(--text-3); width: 0.8em; }
.doc-group-icon { font-size: 0.85rem; }
.doc-group-label { flex: 1; text-align: left; }
.doc-group-count {
  color: var(--text-3);
  font-size: 0.72rem;
  background: var(--bg-2);
  border-radius: 999px;
  padding: 1px 7px;
}

.doc-initiative {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-3);
  padding: 6px 10px 2px 26px;
}

.doc-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px 10px 5px 26px;
  color: var(--text-2);
  font-family: inherit;
  font-size: 0.8rem;
  border-left: 2px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-item.indented { padding-left: 38px; }
.doc-item:hover { background: var(--bg-2); color: var(--text-0); }
.doc-item.active {
  color: var(--accent);
  border-left-color: var(--accent);
  background: var(--accent-dim);
}
</style>
