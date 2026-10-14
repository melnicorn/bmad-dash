<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import KanbanBoard from '../components/KanbanBoard.vue'
import { EPIC_COLUMNS } from '../constants/columns'
import type { Epic } from '../../types/index'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()

const epic = computed<Epic | null>(() =>
  store.epics.find(e => e.id === route.params.epicId) ?? null
)

function epicNumId(n: number): string {
  return `EPIC-${String(n).padStart(2, '0')}`
}

// Resolve dependency epic numbers to real epics (so we can link + label them).
const deps = computed(() =>
  (epic.value?.dependsOn ?? [])
    .map(n => store.epics.find(e => e.id === epicNumId(n)))
    .filter((e): e is Epic => !!e)
)

/**
 * Why this epic waits on a dependency. The 6.13+ initiative `tickets.toml`
 * records a `needs` note on each `after` edge; the v6 layouts have none.
 */
function needsFor(depEpicId: string): string {
  const num = parseInt(depEpicId.replace(/\D/g, ''), 10)
  return epic.value?.dependsOnNeeds?.[String(num)] ?? ''
}

const statusColor = computed(() =>
  EPIC_COLUMNS.find(c => c.key === epic.value?.status)?.colorVar ?? '--todo'
)

// The epics.md doc, so "requirements" can deep-link into the FR coverage map.
const epicsDoc = computed(() =>
  store.documents.find(d => d.type === 'epics') ?? null
)

function goToEpic(id: string) {
  store.selectEpic(id)
  router.push({ name: 'epic', params: { epicId: id } })
}
function openEpicsDoc() {
  if (epicsDoc.value) router.push({ name: 'docs', query: { doc: epicsDoc.value.id } })
}
</script>

<template>
  <div v-if="epic" class="epic-view">
    <header class="epic-header">
      <div class="epic-head-row">
        <span class="epic-id">{{ epic.id }}</span>
        <span v-if="epic.status" class="epic-status" :style="{ color: `var(${statusColor})` }">
          {{ epic.status }}
        </span>
        <h1 class="epic-title">{{ epic.title }}</h1>
        <span
          v-if="epic.retrospectiveStatus"
          class="retro-badge"
          :class="{ done: epic.retrospectiveStatus === 'done' }"
        >retro: {{ epic.retrospectiveStatus }}</span>
      </div>
      <p v-if="epic.description" class="epic-desc">{{ epic.description }}</p>
      <div class="epic-meta">
        <div v-if="deps.length" class="meta-group">
          <span class="meta-label">Depends on</span>
          <button
            v-for="d in deps"
            :key="d.id"
            class="meta-chip"
            :title="needsFor(d.id) || undefined"
            @click="goToEpic(d.id)"
          >
            {{ d.id }} · {{ d.title }}
            <span v-if="needsFor(d.id)" class="meta-needs">— {{ needsFor(d.id) }}</span>
          </button>
        </div>
        <div v-if="epic.requirements?.length" class="meta-group">
          <span class="meta-label">Requirements</span>
          <button
            v-for="r in epic.requirements"
            :key="r"
            class="meta-chip req"
            :disabled="!epicsDoc"
            @click="openEpicsDoc"
          >{{ r }}</button>
        </div>
      </div>
    </header>
    <KanbanBoard :epic="epic" />
  </div>
  <div v-else class="board-empty">Select an epic from the sidebar</div>
</template>

<style scoped>
.epic-view { display: flex; flex-direction: column; height: 100%; }
.epic-header { padding: 1.25rem 1.5rem 0.75rem; border-bottom: 1px solid var(--border); }
.epic-head-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.epic-id {
  font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  color: var(--text-2); background: var(--bg-3); border: 1px solid var(--border);
  border-radius: 4px; padding: 2px 6px;
}
.epic-status { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.epic-title { font-size: 1.2rem; font-weight: 700; color: var(--text-0); margin: 0; }
.retro-badge {
  margin-left: auto; font-size: 0.7rem; color: var(--text-3);
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
}
.retro-badge.done { color: var(--done); border-color: var(--done); }
.epic-desc { color: var(--text-2); font-size: 0.85rem; margin: 0.5rem 0 0; line-height: 1.5; }

.epic-meta { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 0.6rem; }
.meta-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.meta-label {
  font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-3); font-weight: 600;
}
.meta-chip {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 2px 8px; font-size: 0.74rem; color: var(--text-1); cursor: pointer; font-family: inherit;
}
.meta-chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.meta-chip.req { font-family: var(--font-mono); font-size: 0.7rem; }
.meta-chip:disabled { cursor: default; opacity: 0.7; }

.board-empty {
  display: flex; align-items: center; justify-content: center; height: 100%;
  color: var(--text-2); font-size: 0.9rem;
}

.meta-needs {
  color: var(--text-2);
  font-weight: 400;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
