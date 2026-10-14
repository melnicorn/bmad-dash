<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import { useFilterStore } from '../stores/filters'
import { EPIC_COLUMNS } from '../constants/columns'
import EpicCard from '../components/EpicCard.vue'
import type { Epic } from '../../types/index'

const store = useProjectStore()
const filters = useFilterStore()

const dragOverKey = ref<string | null>(null)

// Epics grouped by sprint-status epic status; unknown/missing → backlog.
const epicsByStatus = computed<Record<string, Epic[]>>(() => {
  const groups: Record<string, Epic[]> = { backlog: [], 'in-progress': [], done: [] }
  for (const epic of store.epics) {
    if (!filters.matchesEpic(epic)) continue
    const key = EPIC_COLUMNS.some(c => c.key === epic.status) ? epic.status! : 'backlog'
    groups[key].push(epic)
  }
  return groups
})

const hasSprintStatus = computed(() => !!store.sprintStatus)

function onDragEnter(key: string) { dragOverKey.value = key }
function onDragLeave(event: DragEvent, key: string) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
    if (dragOverKey.value === key) dragOverKey.value = null
  }
}
function onDragOver(event: DragEvent) {
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
}
async function onDrop(event: DragEvent, status: string) {
  event.preventDefault()
  dragOverKey.value = null
  const epicId = event.dataTransfer!.getData('text/plain')
  if (!epicId) return
  const epic = store.epics.find(e => e.id === epicId)
  if (!epic || epic.status === status) return
  // In a 6.13+ tree an epic's status follows its tickets; there is nothing to write.
  if (store.isTicketLayout) return
  await store.updateEpicStatus(epicId, status)
}
</script>

<template>
  <div class="epic-board-view">
    <header class="board-header">
      <h1 class="board-title">Epic Board</h1>
      <p class="board-sub">
        <template v-if="store.isTicketLayout">
          Epic status is derived from each epic's tickets, so it is not dragged here.
          Move a ticket on its epic's board instead.
        </template>
        <template v-else-if="hasSprintStatus">
          Epic status from <code>sprint-status.yaml</code> — drag to update.
        </template>
        <template v-else>
          No <code>sprint-status.yaml</code> found; epics default to Backlog and cannot be updated.
        </template>
      </p>
    </header>

    <div class="epic-board">
      <section
        v-for="col in EPIC_COLUMNS"
        :key="col.key"
        class="epic-col"
        :class="{ 'drag-over': dragOverKey === col.key }"
        @dragenter.prevent="onDragEnter(col.key)"
        @dragleave="onDragLeave($event, col.key)"
        @dragover="onDragOver"
        @drop="onDrop($event, col.key)"
      >
        <div class="col-header">
          <span class="col-dot" :style="{ background: `var(${col.colorVar})` }" />
          <span class="col-label">{{ col.label }}</span>
          <span class="col-count">{{ epicsByStatus[col.key].length }}</span>
        </div>
        <div class="col-body">
          <EpicCard v-for="epic in epicsByStatus[col.key]" :key="epic.id" :epic="epic" />
          <p v-if="!epicsByStatus[col.key].length" class="col-empty">No epics</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.epic-board-view { display: flex; flex-direction: column; height: 100%; }
.board-header { padding: 1.25rem 1.5rem 0.5rem; }
.board-title { font-size: 1.25rem; font-weight: 700; color: var(--text-0); margin: 0 0 4px; }
.board-sub { font-size: 0.8rem; color: var(--text-2); margin: 0; }
.board-sub code {
  font-family: var(--font-mono); font-size: 0.75rem;
  background: var(--bg-2); padding: 1px 4px; border-radius: 3px; color: var(--accent);
}

.epic-board { display: flex; gap: 1rem; padding: 1rem 1.5rem 1.5rem; flex: 1; overflow: hidden; }

.epic-col {
  flex: 1;
  min-width: 0;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s, background 0.15s;
}
.epic-col.drag-over { border-color: var(--accent); background: var(--accent-dim); }

.col-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.col-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.col-label { font-size: 0.78rem; font-weight: 600; color: var(--text-1); }
.col-count {
  margin-left: auto; font-size: 0.7rem; color: var(--text-3);
  background: var(--bg-2); border-radius: 999px; padding: 1px 7px;
}

.col-body {
  padding: 10px; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 8px;
}
.col-empty { color: var(--text-3); font-size: 0.78rem; font-style: italic; text-align: center; margin: 12px 0; }
</style>
