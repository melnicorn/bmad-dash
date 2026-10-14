<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PartyPopper, TriangleAlert, Info, Check, ArrowRight } from '@lucide/vue'
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

// Map the recommendation's target to its story route: a sprint-status story
// key ("30-1-slug") in the v6 layouts, or a ticket ref ("3.4") in a 6.13+ tree.
const targetRoute = computed(() => {
  const id = next.value?.targetId
  if (!id) return null

  // A ticket ref is already the story id the ticket tree projects.
  const byRef = store.epics.find(e => e.stories.some(s => s.id === id))
  if (byRef) return { name: 'storyDetail', params: { epicId: byRef.id, storyId: id } }

  const m = id.match(/^(\d+)-(\d+)-/)
  if (!m) return null
  const epicId = `EPIC-${m[1].padStart(2, '0')}`
  const storyId = `${Number(m[1])}.${Number(m[2])}`
  const epic = store.epics.find(e => e.id === epicId)
  if (!epic?.stories.some(s => s.id === storyId)) return null
  return { name: 'storyDetail', params: { epicId, storyId } }
})

// ─── 6.13+ ticket tree summary ───
const tickets = computed(() => store.ticketSummary)
const readyCount = computed(() => tickets.value?.readyToStart.length ?? 0)
const blockedCount = computed(() => tickets.value?.blocked.length ?? 0)
const inProgressCount = computed(() => tickets.value?.inProgress.length ?? 0)
const refineCount = computed(() => tickets.value?.readyToRefine.length ?? 0)

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
      <span v-else-if="tickets" class="ns-updated">{{ tickets.initiative }}</span>
    </div>

    <div v-if="allDone" class="ns-done">
      <PartyPopper :size="16" :stroke-width="2" />
      All implementation items are done — nice work!
    </div>

    <template v-else>
      <p class="ns-recommend">{{ next.label }}</p>

      <!-- What `tickets.py next` reports, at a glance -->
      <div v-if="tickets" class="ns-ticket-counts">
        <span class="ns-count" :class="{ 'is-zero': !readyCount }">
          <strong>{{ readyCount }}</strong> ready
        </span>
        <span v-if="refineCount" class="ns-count"><strong>{{ refineCount }}</strong> to refine</span>
        <span class="ns-count" :class="{ 'is-zero': !inProgressCount }">
          <strong>{{ inProgressCount }}</strong> in flight
        </span>
        <span class="ns-count" :class="{ 'is-blocked': blockedCount > 0 }">
          <strong>{{ blockedCount }}</strong> blocked
        </span>
      </div>
      <div class="ns-actions">
        <code class="ns-command">{{ next.command }}</code>
        <button class="ns-copy" @click="copyCommand">
          <Check v-if="copied" :size="13" :stroke-width="2.5" />
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
        <button v-if="targetRoute" class="ns-open" @click="openTarget">
          Open story
          <ArrowRight :size="13" :stroke-width="2" />
        </button>
      </div>
    </template>

    <ul v-if="risks.length" class="ns-risks">
      <li v-for="(r, i) in risks" :key="i" :class="r.level">
        <component :is="r.level === 'warning' ? TriangleAlert : Info" class="risk-icon" :size="14" :stroke-width="2" />
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
.ns-done { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: var(--done); }

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
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.risk-icon { flex-shrink: 0; margin-top: 1px; }

/* ─── 6.13+ ticket counts ─── */

.ns-ticket-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 0.6rem;
}

.ns-count {
  font-size: 0.7rem;
  color: var(--text-2);
  padding: 0.16rem 0.42rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
}

.ns-count strong {
  color: var(--text-0);
  font-weight: 650;
}

.ns-count.is-zero strong { color: var(--text-2); }

.ns-count.is-blocked {
  color: var(--blocked);
  border-color: var(--blocked);
  background: var(--blocked-bg);
}

.ns-count.is-blocked strong { color: var(--blocked); }
</style>
