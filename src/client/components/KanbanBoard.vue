<script setup lang="ts">
import { computed } from 'vue'
import KanbanColumn from './KanbanColumn.vue'
import { useFilterStore } from '../stores/filters'
import { STORY_COLUMNS, storyColumnKey } from '../constants/columns'
import type { Epic, UserStory } from '../../types/index'

// ─── Props ───
const props = defineProps<{ epic: Epic | null }>()
const filters = useFilterStore()

// ─── Stories grouped by status (text filter applied; completed handled per-column) ───
const storiesByStatus = computed<Record<string, UserStory[]>>(() => {
  const groups: Record<string, UserStory[]> = { todo: [], active: [], review: [], done: [] }
  if (!props.epic) return groups
  const q = filters.text.trim().toLowerCase()
  for (const story of props.epic.stories) {
    if (q && !`${story.id} ${story.title}`.toLowerCase().includes(q)) continue
    groups[storyColumnKey(story.status)].push(story)
  }
  return groups
})
</script>

<template>
  <div v-if="epic" class="kanban-board">
    <KanbanColumn
      v-for="col in STORY_COLUMNS"
      :key="col.key"
      :status="col.key"
      :label="col.label"
      :color-var="col.colorVar"
      :stories="storiesByStatus[col.key]"
      :epic-id="epic.id"
    />
  </div>
  <div v-else class="board-empty">
    Select an epic from the sidebar
  </div>
</template>

<style scoped>
.kanban-board {
  display: flex;
  gap: 1rem;
  padding: 1.5rem;
  height: 100%;
  overflow-x: auto;
}

.board-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-2);
  font-size: 0.9rem;
}
</style>
