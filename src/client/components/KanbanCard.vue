<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { UserStory } from '../../types/index'
import TicketBadges from './TicketBadges.vue'

// ─── Props ───
const props = defineProps<{ story: UserStory; epicId: string }>()

// ─── 6.13+ tickets ───
// A ticket card shows its ref and badges, and names the prerequisites it is
// still waiting on — including cross-epic ones, which read as "<epic>.<entry>".
const ticket = computed(() => props.story.ticket ?? null)
const waitingOn = computed(() => ticket.value?.waitingOn ?? [])
const isDropped = computed(() => ticket.value?.state === 'dropped')
const waitingTitle = computed(() =>
  waitingOn.value.map(w => (w.title ? `${w.ref} — ${w.title}` : w.ref)).join('\n')
)

// ─── Drag State ───
const isDragging = ref(false)

function onDragStart(event: DragEvent): void {
  isDragging.value = true
  event.dataTransfer!.setData('text/plain', `${props.epicId}|${props.story.id}`)
  event.dataTransfer!.effectAllowed = 'move'
}

function onDragEnd(): void {
  isDragging.value = false
}

// ─── Navigation ───
const router = useRouter()

function onClick(): void {
  router.push({ name: 'storyDetail', params: { epicId: props.epicId, storyId: props.story.id } })
}

// ─── Status Color ───
const STATUS_COLOR: Record<string, string> = {
  todo:   '--todo',
  active: '--active',
  review: '--review',
  done:   '--done',
}

function statusColorVar(status: string | undefined): string {
  return STATUS_COLOR[status ?? 'todo'] ?? '--todo'
}
</script>

<template>
  <div
    class="kanban-card"
    :class="{ 'is-dragging': isDragging, 'is-ticket': !!ticket, 'is-dropped': isDropped }"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @click="onClick"
    :title="story.title"
  >
    <div class="card-row">
      <span
        class="status-dot"
        :style="{ background: `var(${statusColorVar(story.status)})` }"
      />
      <span class="card-title">{{ story.title }}</span>
    </div>

    <TicketBadges v-if="ticket" :ticket="ticket" size="card" />

    <div v-if="waitingOn.length" class="card-waiting" :title="waitingTitle">
      waiting on
      <span v-for="w in waitingOn" :key="w.ref" class="waiting-ref">{{ w.ref }}</span>
    </div>
  </div>
</template>

<style scoped>
.kanban-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.625rem 0.75rem;
  cursor: grab;
  transition: border-color 0.15s, opacity 0.15s;
  overflow: hidden;
  user-select: none;
}

.kanban-card:hover {
  border-color: var(--border-hover);
}

.kanban-card.is-dragging {
  opacity: 0.5;
  cursor: grabbing;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
}

/* A dropped ticket stays visible but reads as struck through. */
.kanban-card.is-dropped { opacity: 0.55; }
.kanban-card.is-dropped .card-title { text-decoration: line-through; }

.card-waiting {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.65rem;
  color: var(--text-2);
}

.waiting-ref {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  padding: 0.1rem 0.26rem;
  border-radius: var(--radius-sm);
  background: var(--bg-3);
  color: var(--text-1);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.card-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
