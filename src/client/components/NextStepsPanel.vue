<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'

const store = useProjectStore()
const router = useRouter()

const next = computed(() => store.nextStep)
const risks = computed(() => store.risks)
const allDone = computed(() => !!next.value && next.value.workflowId === '')

const copied = ref(false)
async function copyCommand() {
  if (!next.value?.command) return
  try {
    await navigator.clipboard.writeText(next.value.command)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* clipboard unavailable */ }
}

// Map a sprint-status story key (e.g. "30-1-slug") to its story route.
const targetRoute = computed(() => {
  const id = next.value?.targetId
  if (!id) return null
  const m = id.match(/^(\d+)-(\d+)-/)
  if (!m) return null
  const epicId = `EPIC-${m[1].padStart(2, '0')}`
  const storyId = `${Number(m[1])}.${Number(m[2])}`
  const epic = store.epics.find(e => e.id === epicId)
  if (!epic?.stories.some(s => s.id === storyId)) return null
  return { name: 'storyDetail', params: { epicId, storyId } }
})

function openTarget() {
  if (targetRoute.value) router.push(targetRoute.value as any)
}
</script>

<template>
  <div v-if="next" class="next-steps">
    <div class="ns-head">
      <span class="ns-label">Next Step</span>
      <span v-if="store.sprintStatus?.lastUpdated" class="ns-updated">
        sprint updated {{ store.sprintStatus.lastUpdated }}
      </span>
    </div>

    <div v-if="allDone" class="ns-done">
      🎉 All implementation items are done — nice work!
    </div>

    <template v-else>
      <p class="ns-recommend">{{ next.label }}</p>
      <div class="ns-actions">
        <code class="ns-command">{{ next.command }}</code>
        <button class="ns-copy" @click="copyCommand">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
        <button v-if="targetRoute" class="ns-open" @click="openTarget">Open story →</button>
      </div>
    </template>

    <ul v-if="risks.length" class="ns-risks">
      <li v-for="(r, i) in risks" :key="i" :class="r.level">
        <span class="risk-icon">{{ r.level === 'warning' ? '⚠' : 'ℹ' }}</span>
        {{ r.message }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.next-steps {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 14px 16px;
}

.ns-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.ns-label {
  font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--accent);
}
.ns-updated { margin-left: auto; font-size: 0.68rem; color: var(--text-3); }

.ns-recommend { font-size: 0.9rem; color: var(--text-0); margin: 0 0 10px; font-weight: 500; }
.ns-done { font-size: 0.9rem; color: var(--done); }

.ns-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ns-command {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  background: var(--bg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  color: var(--accent);
}
.ns-copy, .ns-open {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 0.74rem;
  color: var(--text-1);
  cursor: pointer;
  font-family: inherit;
}
.ns-copy:hover, .ns-open:hover { border-color: var(--accent); color: var(--accent); }

.ns-risks { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.ns-risks li { font-size: 0.78rem; color: var(--text-2); display: flex; gap: 7px; align-items: flex-start; }
.ns-risks li.warning { color: var(--review); }
.risk-icon { flex-shrink: 0; }
</style>
