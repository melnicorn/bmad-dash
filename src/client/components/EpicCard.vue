<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheck } from '@lucide/vue'
import { useProjectStore } from '../stores/project'
import { STORY_COLUMNS, storyColumnKey } from '../constants/columns'
import type { Epic } from '../../types/index'

const props = defineProps<{ epic: Epic }>()
const store = useProjectStore()
const router = useRouter()

// Story status rollup for the mini progress bar.
const rollup = computed(() => {
  const counts: Record<string, number> = { todo: 0, active: 0, review: 0, done: 0 }
  for (const s of props.epic.stories) counts[storyColumnKey(s.status)]++
  return counts
})
const total = computed(() => props.epic.stories.length)
const pct = computed(() => total.value ? Math.round(rollup.value.done / total.value * 100) : 0)

const deps = computed(() =>
  (props.epic.dependsOn ?? []).map(n => `EPIC-${String(n).padStart(2, '0')}`))

// A dependency is blocking if that epic isn't done yet.
const blockingDeps = computed(() =>
  deps.value.filter(id => store.epics.find(e => e.id === id)?.status !== 'done'))

function onDragStart(event: DragEvent) {
  event.dataTransfer!.setData('text/plain', props.epic.id)
  event.dataTransfer!.effectAllowed = 'move'
}

function open() {
  store.selectEpic(props.epic.id)
  router.push({ name: 'epic', params: { epicId: props.epic.id } })
}
</script>

<template>
  <article class="epic-card" draggable="true" @dragstart="onDragStart" @click="open">
    <header class="card-head">
      <span class="card-id">{{ epic.id }}</span>
      <span v-if="epic.retrospectiveStatus === 'done'" class="retro-dot" title="Retrospective complete">
        <CircleCheck :size="12" :stroke-width="2.5" />retro
      </span>
    </header>
    <h4 class="card-title">{{ epic.title }}</h4>

    <div v-if="total" class="rollup">
      <div class="rollup-bar">
        <div
          v-for="c in STORY_COLUMNS"
          :key="c.key"
          class="rollup-seg"
          :style="{ flex: rollup[c.key], background: `var(${c.colorVar})` }"
          :title="`${c.label}: ${rollup[c.key]}`"
        />
      </div>
      <div class="rollup-meta">
        <span>{{ rollup.done }}/{{ total }} stories</span>
        <span class="rollup-pct">{{ pct }}%</span>
      </div>
    </div>
    <p v-else class="no-stories">No stories yet</p>

    <div v-if="deps.length" class="deps">
      <span
        v-for="d in deps"
        :key="d"
        class="dep-chip"
        :class="{ blocking: blockingDeps.includes(d) }"
        :title="blockingDeps.includes(d) ? `${d} is not done yet` : `${d} is done`"
      >{{ d }}</span>
    </div>
  </article>
</template>

<style scoped>
.epic-card {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.epic-card:hover { border-color: var(--border-hover); background: var(--bg-3); }
.epic-card:active { cursor: grabbing; }

.card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.card-id {
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
  color: var(--text-2); background: var(--bg-3);
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px;
}
.retro-dot { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; font-size: 0.62rem; color: var(--done); }

.card-title {
  font-size: 0.82rem; font-weight: 600; color: var(--text-0);
  margin: 0 0 8px; line-height: 1.35;
}

.rollup-bar {
  display: flex; height: 4px; background: var(--bg-3);
  border-radius: 2px; overflow: hidden; margin-bottom: 4px;
}
.rollup-seg { min-width: 0; }
.rollup-meta {
  display: flex; justify-content: space-between;
  font-size: 0.68rem; color: var(--text-3);
}
.rollup-pct { color: var(--text-2); font-weight: 600; }
.no-stories { font-size: 0.7rem; color: var(--text-3); font-style: italic; margin: 0; }

.deps { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.dep-chip {
  font-size: 0.62rem; font-family: var(--font-mono);
  color: var(--text-3); border: 1px solid var(--border);
  border-radius: 3px; padding: 1px 4px;
}
.dep-chip.blocking { color: var(--review); border-color: var(--review); }
</style>
