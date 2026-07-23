<template>
  <div
    class="story-item"
    :class="{ active: isActive }"
    :title="story.title"
    @click="$emit('select')"
  >
    <span
      class="status-dot"
      :style="{ backgroundColor: `var(--${story.status ?? 'todo'})` }"
    ></span>
    <span class="story-title"><span class="item-id">{{ story.id }} ·</span> {{ story.title }}</span>
    <span
      v-if="story.statusConflict"
      class="drift-flag"
      title="sprint-status.yaml and the story file disagree on this story's status"
    >
      <TriangleAlert :size="13" :stroke-width="2" aria-label="Status drift" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import type { UserStory } from '../../types/index'

// ─── Props ───
defineProps<{
  story: UserStory
  isActive: boolean
}>()

// ─── Emits ───
defineEmits<{
  (e: 'select'): void
}>()
</script>

<style scoped>
.drift-flag {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  color: var(--review);
  flex-shrink: 0;
}

.story-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 32px;
  cursor: pointer;
  color: var(--text-1);
  border-left: 2px solid transparent;
  font-size: 0.85rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: background 0.1s;
}

.story-item:hover {
  background: var(--bg-2);
}

.story-item.active {
  border-left-color: var(--accent);
  background: var(--accent-dim);
  color: var(--text-0);
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.story-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-id {
  color: var(--text-2);
  font-size: 0.75rem;
  font-weight: 400;
  flex-shrink: 0;
}
</style>
