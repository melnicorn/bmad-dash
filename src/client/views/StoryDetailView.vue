<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import { ArrowLeft, TriangleAlert } from '@lucide/vue'
import type { CommitMapping } from '../../types/index'
import MarkdownPane from '../components/MarkdownPane.vue'
import TicketBadges from '../components/TicketBadges.vue'

// ─── Route + Store ───
const route = useRoute()
const router = useRouter()
const store = useProjectStore()

// ─── Status Constants ───
const STATUSES = [
  { key: 'todo',   label: 'To Do',      colorVar: '--todo',   bgVar: '--todo-bg'   },
  { key: 'active', label: 'In Progress', colorVar: '--active', bgVar: '--active-bg' },
  { key: 'review', label: 'Review',      colorVar: '--review', bgVar: '--review-bg' },
  { key: 'done',   label: 'Done',        colorVar: '--done',   bgVar: '--done-bg'   },
] as const

// ─── Derive epic and story from route params ───
const epicId = computed(() => route.params.epicId as string)
const storyId = computed(() => route.params.storyId as string)

const epic = computed(() =>
  store.epics.find(e => e.id === epicId.value) ?? null
)
const story = computed(() =>
  epic.value?.stories.find(s => s.id === storyId.value) ?? null
)

// ─── 6.13+ ticket tree ───
// A ticket's acceptance lives in its plan, not in a checklist the dashboard
// owns, so the Requirements tab shows the entry's text and the Plan tab
// renders the plan file itself.
const ticket = computed(() => story.value?.ticket ?? null)
const isTicket = computed(() => !!ticket.value)
const vizTabLabel = computed(() => (isTicket.value ? 'Plan' : 'Visualizer'))

/**
 * Prerequisite chips, with the title and state of whatever each names. An
 * epic-level gate ("waits for epic-shell to be done") is unmet work the ticket
 * is waiting on but is not in its own `after`, so it is appended here —
 * otherwise the "still unmet" count names more than the list shows.
 */
const prerequisites = computed(() => {
  const after = ticket.value?.after ?? []
  const seen = new Set(after.map(a => a.ref))
  const gates = (ticket.value?.waitingOn ?? []).filter(w => !seen.has(w.ref))
  return [...after, ...gates]
})
const blocks = computed(() => ticket.value?.blocks ?? [])
const waitingSet = computed(() => new Set((ticket.value?.waitingOn ?? []).map(w => w.ref)))

const planMetaRows = computed(() =>
  Object.entries(ticket.value?.planMeta ?? {}).map(([key, value]) => ({
    label: key.replace(/_/g, ' '),
    value,
  }))
)

const STATE_COLOR: Record<string, string> = {
  planned: '--todo',
  backlog: '--todo',
  'in-progress': '--active',
  review: '--review',
  done: '--done',
  dropped: '--text-3',
}

function stateColorVar(state?: string): string {
  return STATE_COLOR[state ?? ''] ?? '--todo'
}

/** Jump to a prerequisite or blocked ticket by its ref. */
function goToRef(ref: string) {
  for (const e of store.epics) {
    const hit = e.stories.find(s => s.id === ref)
    if (hit) {
      router.push({ name: 'storyDetail', params: { epicId: e.id, storyId: ref } })
      return
    }
  }
  // A whole-epic gate: open that epic instead.
  const bySlug = store.epics.find(e => e.ticketSlug === ref)
  if (bySlug) router.push({ name: 'epic', params: { epicId: bySlug.id } })
}

// ─── Per-item pending state (prevents double-click race) ───
const pendingAC = ref<Set<number>>(new Set())
const pendingTask = ref<Set<string>>(new Set())
const pendingStatus = ref(false)

// ─── Back navigation ───
function goBack() {
  router.push({ name: 'epic', params: { epicId: epicId.value } })
}

// ─── Mutations ───
async function onToggleAC(index: number, done: boolean) {
  if (pendingAC.value.has(index)) return
  pendingAC.value = new Set([...pendingAC.value, index])
  await store.toggleAC(epicId.value, storyId.value, index, done)
  pendingAC.value = new Set([...pendingAC.value].filter(i => i !== index))
}

async function onToggleTask(taskId: string, done: boolean) {
  if (pendingTask.value.has(taskId)) return
  pendingTask.value = new Set([...pendingTask.value, taskId])
  await store.toggleTask(epicId.value, storyId.value, taskId, done)
  pendingTask.value = new Set([...pendingTask.value].filter(i => i !== taskId))
}

async function onStatusChange(status: string) {
  if (pendingStatus.value) return
  pendingStatus.value = true
  await store.updateStoryStatus(epicId.value, storyId.value, status)
  pendingStatus.value = false
}

// ─── Commits panel ───
const storyCommits = computed(() =>
  store.commitMappings.filter((c: CommitMapping) => c.storyId === storyId.value)
)

function shortSha(sha: string) { return sha.slice(0, 7) }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Collapsible files per commit ───
const expandedCommits = ref<Set<string>>(new Set())
function toggleFiles(sha: string) {
  const next = new Set(expandedCommits.value)
  if (next.has(sha)) { next.delete(sha) } else { next.add(sha) }
  expandedCommits.value = next
}
function scoreLabel(score: number) { return Math.round(score * 100) + '%' }

// ─── Match explainability ───
// SignalBreakdown is computed and persisted per commit but was never surfaced.
const expandedSignals = ref<Set<string>>(new Set())
function toggleSignals(sha: string) {
  const next = new Set(expandedSignals.value)
  if (next.has(sha)) { next.delete(sha) } else { next.add(sha) }
  expandedSignals.value = next
}
const SIGNAL_LABELS: { key: keyof CommitMapping['signalBreakdown']; label: string }[] = [
  { key: 'embedding', label: 'Embedding' },
  { key: 'storyIdMatch', label: 'Story ID' },
  { key: 'keyword', label: 'Keyword' },
  { key: 'pathOverlap', label: 'Path' },
  { key: 'nli', label: 'NLI' },
  { key: 'diffSignal', label: 'Diff' },
]
function signalRows(c: CommitMapping) {
  const b = c.signalBreakdown
  if (!b) return []
  return SIGNAL_LABELS.map(({ key, label }) => ({ label, value: Number(b[key] ?? 0) }))
}

// ─── Tab state ───
const activeTab = ref<'requirements' | 'visualizer'>('requirements')
const markdownSource = ref('')
const markdownLoading = ref(false)
const markdownError = ref('')

/**
 * A ticket plan is rendered whole — its "Tasks & Acceptance" section is the
 * plan's own content, not a checklist this view owns. Only the frontmatter
 * block is dropped, since its fields are already shown under Build plan.
 */
function stripFrontmatter(md: string): string {
  return md.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')
}

function filterMarkdown(md: string): string {
  const lines = md.split('\n')
  const result: string[] = []
  let blockedLevel = 0
  const headingRe = /^(#{1,6})\s+(.+)/
  const blockedPattern = /^(acceptance criteria|tasks?(\s*[/|].*)?|sub-?tasks?)/i
  for (const line of lines) {
    const match = headingRe.exec(line)
    if (match) {
      const level = match[1].length
      const text = match[2].trim()
      if (blockedLevel > 0 && level <= blockedLevel) {
        // End of blocked section — check if new heading is also blocked
        blockedLevel = 0
      }
      if (blockedLevel === 0) {
        if (blockedPattern.test(text)) {
          blockedLevel = level
          // Drop this heading line
        } else {
          result.push(line)
        }
      }
    } else {
      if (blockedLevel === 0) result.push(line)
    }
  }
  return result.join('\n')
}

async function loadMarkdown() {
  if (markdownSource.value) return  // already loaded for this story
  markdownLoading.value = true
  markdownError.value = ''
  try {
    const res = await fetch(`/api/epics/${epicId.value}/stories/${storyId.value}/markdown`)
    if (!res.ok) { markdownError.value = 'No source file available for this story.'; return }
    markdownSource.value = await res.text()
  } catch {
    markdownError.value = 'Failed to load source file.'
  } finally {
    markdownLoading.value = false
  }
}

function onTabChange(tab: 'requirements' | 'visualizer') {
  activeTab.value = tab
  if (tab === 'visualizer') loadMarkdown()
}

// Reset markdown state when story changes
watch(storyId, () => {
  markdownSource.value = ''
  markdownError.value = ''
  activeTab.value = 'requirements'
})
</script>

<template>
  <div v-if="story" class="story-detail">

    <!-- Sticky header: breadcrumb, meta, title, status, tabs -->
    <div class="story-header">

      <!-- Back breadcrumb -->
      <button class="breadcrumb" @click="goBack">
        <ArrowLeft :size="14" :stroke-width="2" />
        {{ epic?.title }}
      </button>

      <!-- Identifier badges -->
      <div v-if="ticket" class="story-meta">
        <TicketBadges :ticket="ticket" size="full" />
        <span class="meta-badge raw-status" :title="`Derived state: ${ticket.state}`">
          {{ ticket.status || ticket.state }}
        </span>
      </div>
      <div v-else class="story-meta">
        <span class="meta-badge">Epic {{ epicId }}</span>
        <span class="meta-sep">·</span>
        <span class="meta-badge">Story {{ storyId }}</span>
        <span
          v-if="story.rawStatus"
          class="meta-badge raw-status"
          :title="`Raw BMAD status (source: ${story.statusSource ?? 'file'})`"
        >{{ story.rawStatus }}</span>
        <span
          v-if="story.statusConflict"
          class="meta-badge conflict"
          title="sprint-status.yaml and the story file disagree on this story's status"
        ><TriangleAlert :size="12" :stroke-width="2" /> status drift</span>
      </div>

      <!-- Title -->
      <h1 class="story-title">{{ story.title }}</h1>

      <!-- Status button group -->
      <div class="status-group">
        <button
          v-for="s in STATUSES"
          :key="s.key"
          class="status-btn"
          :class="{ 'is-active': story.status === s.key }"
          :style="story.status === s.key ? { color: `var(${s.colorVar})`, background: `var(${s.bgVar})`, borderColor: `var(${s.colorVar})` } : {}"
          :disabled="pendingStatus"
          @click="onStatusChange(s.key)"
        >{{ s.label }}</button>
      </div>

      <!-- Tab bar -->
      <div class="story-tabs">
        <button
          class="story-tab"
          :class="{ 'is-active': activeTab === 'requirements' }"
          @click="onTabChange('requirements')"
        >Requirements</button>
        <button
          class="story-tab"
          :class="{ 'is-active': activeTab === 'visualizer' }"
          @click="onTabChange('visualizer')"
        >{{ vizTabLabel }}</button>
      </div>

    </div>

    <div class="story-columns">

      <div class="story-body">

        <!-- Requirements tab content -->
        <div v-if="activeTab === 'requirements'">

          <!-- Description -->
          <p v-if="story.description" class="story-description">{{ story.description }}</p>

          <!-- ─── 6.13+ ticket panel ─── -->
          <template v-if="ticket">

            <!-- Blocked, with the reason the build recorded -->
            <div v-if="ticket.blockedReason" class="ticket-callout is-blocked">
              <strong>Blocked{{ ticket.blockedAt ? ` since ${ticket.blockedAt}` : '' }}:</strong>
              {{ ticket.blockedReason }}
            </div>

            <!-- An open question to settle before the ticket starts -->
            <div v-if="ticket.unknown" class="ticket-callout is-open">
              <strong>Open question:</strong> {{ ticket.unknown }}
            </div>

            <!-- How the ticket is verified -->
            <section v-if="ticket.verify" class="detail-section">
              <h3 class="section-title">Verify</h3>
              <p class="ticket-text">{{ ticket.verify }}</p>
            </section>

            <!-- Requirements / capabilities this ticket covers -->
            <section v-if="ticket.covers.length" class="detail-section">
              <h3 class="section-title">Covers</h3>
              <div class="chip-row">
                <span v-for="c in ticket.covers" :key="c" class="chip">{{ c }}</span>
              </div>
            </section>

            <!-- Prerequisites, in the order the tree declares them -->
            <section v-if="prerequisites.length" class="detail-section">
              <h3 class="section-title">
                Waits on
                <span v-if="waitingSet.size" class="section-note">{{ waitingSet.size }} still unmet</span>
              </h3>
              <ul class="ref-list">
                <li v-for="p in prerequisites" :key="p.ref">
                  <button
                    class="ref-chip"
                    :class="{ 'is-unmet': waitingSet.has(p.ref) }"
                    @click="goToRef(p.ref)"
                  >
                    <span class="ref-dot" :style="{ background: `var(${stateColorVar(p.state)})` }" />
                    <span class="ref-id">{{ p.ref }}</span>
                    <span v-if="p.title" class="ref-title">{{ p.title }}</span>
                    <span v-if="p.isEpic" class="ref-kind">whole epic</span>
                  </button>
                </li>
              </ul>
            </section>

            <!-- What this ticket is holding up -->
            <section v-if="blocks.length" class="detail-section">
              <h3 class="section-title">Blocks</h3>
              <ul class="ref-list">
                <li v-for="b in blocks" :key="b.ref">
                  <button class="ref-chip" @click="goToRef(b.ref)">
                    <span class="ref-dot" :style="{ background: `var(${stateColorVar(b.state)})` }" />
                    <span class="ref-id">{{ b.ref }}</span>
                    <span v-if="b.title" class="ref-title">{{ b.title }}</span>
                  </button>
                </li>
              </ul>
            </section>

            <!-- Notes the entry or its leaf file carries -->
            <section v-if="ticket.notes.length" class="detail-section">
              <h3 class="section-title">Notes</h3>
              <ul class="note-list">
                <li v-for="(n, i) in ticket.notes" :key="i">{{ n }}</li>
              </ul>
            </section>

            <!-- Reference links the entry carries -->
            <section v-if="ticket.references.length" class="detail-section">
              <h3 class="section-title">References</h3>
              <ul class="note-list">
                <li v-for="(r, i) in ticket.references" :key="i" class="ref-path">{{ r }}</li>
              </ul>
            </section>

            <!-- The build plan: where it is and what it recorded -->
            <section class="detail-section">
              <h3 class="section-title">Build plan</h3>
              <p v-if="!ticket.planPath" class="ticket-text is-muted">
                No plan yet — this ticket is still only an entry in
                <code>{{ ticket.epicSlug }}/tickets.toml</code>.
              </p>
              <template v-else>
                <p class="ticket-text">
                  <code>{{ ticket.planPath }}</code>
                  — open the <strong>{{ vizTabLabel }}</strong> tab to read it.
                </p>
                <dl v-if="planMetaRows.length" class="meta-grid">
                  <template v-for="row in planMetaRows" :key="row.label">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.value }}</dd>
                  </template>
                </dl>
              </template>
            </section>

          </template>

          <!-- Acceptance Criteria -->
          <section v-if="story.acceptanceCriteria.length > 0" class="detail-section">
            <h3 class="section-title">Acceptance Criteria</h3>
            <ul class="checklist">
              <li v-for="(ac, index) in story.acceptanceCriteria" :key="ac.id" class="checklist-item">
                <label :class="{ 'is-done': ac.done }">
                  <input
                    type="checkbox"
                    :checked="ac.done"
                    :disabled="pendingAC.has(index)"
                    @change="onToggleAC(index, !ac.done)"
                  />
                  <span>{{ ac.description }}</span>
                </label>
              </li>
            </ul>
          </section>

          <!-- Tasks -->
          <section v-if="story.tasks.length > 0" class="detail-section">
            <h3 class="section-title">Tasks</h3>
            <ul class="checklist">
              <li v-for="task in story.tasks" :key="task.id" class="checklist-item">
                <label :class="{ 'is-done': task.done }">
                  <input
                    type="checkbox"
                    :checked="task.done"
                    :disabled="pendingTask.has(task.id)"
                    @change="onToggleTask(task.id, !task.done)"
                  />
                  <span>{{ task.description }}</span>
                </label>
                <!-- Subtasks (one level only) -->
                <ul v-if="task.subtasks && task.subtasks.length > 0" class="checklist subtask-list">
                  <li v-for="sub in task.subtasks" :key="sub.id" class="checklist-item">
                    <label :class="{ 'is-done': sub.done }">
                      <input
                        type="checkbox"
                        :checked="sub.done"
                        :disabled="pendingTask.has(sub.id)"
                        @change="onToggleTask(sub.id, !sub.done)"
                      />
                      <span>{{ sub.description }}</span>
                    </label>
                  </li>
                </ul>
              </li>
            </ul>
          </section>

        </div>

        <!-- Visualizer tab content -->
        <div v-else-if="activeTab === 'visualizer'" class="visualizer-panel">
          <p v-if="markdownLoading" class="viz-loading">Loading...</p>
          <p v-else-if="markdownError" class="viz-error">{{ markdownError }}</p>
          <MarkdownPane v-else :source="markdownSource" :filter="isTicket ? stripFrontmatter : filterMarkdown" />
        </div>

      </div>

      <!-- Sticky commits panel -->
      <aside class="commits-panel">
        <h3 class="section-title">Related Commits</h3>
        <ul v-if="storyCommits.length > 0" class="commits-list">
          <li v-for="c in storyCommits" :key="c.sha" class="commit-item">
            <span class="commit-sha">{{ shortSha(c.sha) }}<span class="commit-score">{{ scoreLabel(c.score) }}</span></span>
            <span class="commit-msg">{{ c.message }}</span>
            <span class="commit-date">{{ formatDate(c.date) }}</span>
            <div class="commit-toggles">
              <button
                class="commit-files-toggle"
                @click="toggleFiles(c.sha)"
              >{{ expandedCommits.has(c.sha) ? '▾' : '▸' }} Files ({{ c.files.length }})</button>
              <button
                v-if="c.signalBreakdown"
                class="commit-files-toggle"
                @click="toggleSignals(c.sha)"
                title="Why did this commit match?"
              >{{ expandedSignals.has(c.sha) ? '▾' : '▸' }} Why?</button>
            </div>
            <ul class="commit-files" v-show="expandedCommits.has(c.sha)">
              <li v-for="f in c.files" :key="f" class="commit-file">{{ f }}</li>
            </ul>
            <ul class="signal-list" v-show="expandedSignals.has(c.sha)">
              <li v-for="s in signalRows(c)" :key="s.label" class="signal-row">
                <span class="signal-label">{{ s.label }}</span>
                <span class="signal-bar-track">
                  <span class="signal-bar-fill" :style="{ width: `${Math.round(s.value * 100)}%` }" />
                </span>
                <span class="signal-value">{{ s.value.toFixed(2) }}</span>
              </li>
            </ul>
          </li>
        </ul>
        <p v-else class="commits-empty">No related commits found.</p>
      </aside>

    </div>

  </div>

  <!-- Empty state -->
  <div v-else class="story-empty">Select a story</div>
</template>

<style scoped>
.story-detail {
  padding: 0;
  padding-bottom: 2rem;
  height: 100%;
  overflow-y: auto;
}

.story-header {
  position: sticky;
  top: 0;
  background: var(--bg-0);
  z-index: 10;
  padding: 1.5rem 2rem 0;
  margin-bottom: 1.5rem;
  border-bottom: none;
}

.story-columns {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  padding: 0 2rem;
}

.story-body {
  flex: 1 1 0;
  min-width: 0;
}

.commits-panel {
  flex: 0 0 280px;
  position: sticky;
  top: 188px;
  max-height: calc(100vh - 220px);
  overflow-y: auto;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
}

.commits-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.commit-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.commit-sha {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--accent);
  letter-spacing: 0.04em;
}

.commit-msg {
  font-size: 0.8rem;
  color: var(--text-1);
  line-height: 1.4;
  word-break: break-word;
}

.commit-date {
  font-size: 0.72rem;
  color: var(--text-3);
}

.commits-empty {
  font-size: 0.8rem;
  color: var(--text-3);
  margin-top: 0.5rem;
}

.breadcrumb {
  background: none;
  border: none;
  color: var(--text-2);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0;
  margin-bottom: 1.25rem;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: color 0.15s;
}
.breadcrumb:hover { color: var(--text-1); }

.story-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.6rem;
}

.meta-badge {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-dim);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 0.15rem 0.5rem;
  letter-spacing: 0.03em;
  opacity: 0.8;
}

.meta-badge.raw-status {
  color: var(--text-2);
  background: var(--bg-2);
  border-color: var(--border);
}

.meta-badge.conflict {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--review);
  background: var(--review-bg);
  border-color: var(--review);
  opacity: 1;
}

.meta-sep {
  color: var(--text-3);
  font-size: 0.75rem;
}

.story-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-0);
  margin-bottom: 1rem;
}

.status-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0;
}

.status-btn {
  padding: 0.35rem 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.status-btn:hover:not(:disabled) {
  border-color: var(--border-hover);
  color: var(--text-1);
}
.status-btn:disabled { opacity: 0.6; cursor: default; }

.story-description {
  color: var(--text-2);
  font-size: 0.9rem;
  line-height: 1.7;
  margin-bottom: 1.75rem;
  white-space: pre-wrap;
}

.detail-section {
  margin-bottom: 1.75rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin-bottom: 0.75rem;
}

.checklist {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.checklist-item label {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  cursor: pointer;
  color: var(--text-1);
  font-size: 0.875rem;
  line-height: 1.55;
}

.checklist-item input[type="checkbox"] {
  margin-top: 0.2rem;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--accent);
}

.is-done {
  text-decoration: line-through;
  color: var(--text-3);
}

.subtask-list {
  margin-left: 1.5rem;
  margin-top: 0.4rem;
}

.story-empty {
  padding: 2rem;
  color: var(--text-2);
  font-size: 0.85rem;
}

.commit-score {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--accent);
  opacity: 0.75;
  margin-left: 0.4rem;
}

.commit-files-toggle {
  background: none;
  border: none;
  padding: 0;
  margin-top: 0.1rem;
  font-size: 0.7rem;
  color: var(--text-3);
  cursor: pointer;
  text-align: left;
  transition: color 0.15s;
}
.commit-files-toggle:hover { color: var(--text-2); }

.commit-toggles { display: flex; gap: 0.75rem; }

/* ─── Match signal breakdown ─── */
.signal-list {
  list-style: none;
  margin: 0.35rem 0 0 0.5rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.signal-row { display: flex; align-items: center; gap: 6px; font-size: 0.66rem; }
.signal-label { color: var(--text-3); width: 4.6em; flex-shrink: 0; }
.signal-bar-track {
  flex: 1;
  height: 3px;
  background: var(--bg-3);
  border-radius: 2px;
  overflow: hidden;
}
.signal-bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
.signal-value { color: var(--text-2); font-family: var(--font-mono); width: 2.4em; text-align: right; }

.commit-files {
  list-style: none;
  margin: 0.25rem 0 0 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.commit-file {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--text-3);
  word-break: break-all;
}

/* ─── Tab bar ─── */
.story-tabs {
  display: flex;
  gap: 0;
  margin-top: 1rem;
  border-bottom: 1px solid var(--border);
}

.story-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.4rem 1rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}

.story-tab:hover { color: var(--text-1); }

.story-tab.is-active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* ─── 6.13+ ticket panel ─── */

.ticket-callout {
  font-size: 0.82rem;
  line-height: 1.5;
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  margin-bottom: 1rem;
  color: var(--text-1);
}

.ticket-callout.is-blocked {
  border-color: var(--blocked);
  background: var(--blocked-bg);
}

.ticket-callout.is-open {
  border-color: var(--active);
  background: var(--active-bg);
}

.ticket-text {
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--text-1);
  margin: 0;
}

.ticket-text.is-muted { color: var(--text-2); }

.ticket-text code,
.meta-grid dd code {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  background: var(--bg-2);
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
}

.section-note {
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--blocked);
  margin-left: 0.4rem;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.chip {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  padding: 0.16rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  background: var(--bg-2);
}

.ref-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.ref-chip {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  text-align: left;
  font-size: 0.8rem;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  color: var(--text-1);
  cursor: pointer;
  transition: border-color 0.15s;
}

.ref-chip:hover { border-color: var(--border-hover); }
.ref-chip.is-unmet { border-color: var(--blocked); background: var(--blocked-bg); }

.ref-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ref-id {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--accent);
  flex-shrink: 0;
}

.ref-title {
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-kind {
  font-size: 0.65rem;
  color: var(--text-2);
  margin-left: auto;
  flex-shrink: 0;
}

.note-list {
  list-style: disc;
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--text-1);
}

.note-list .ref-path {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-2);
  word-break: break-all;
}

.meta-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0.6rem 0 0;
  font-size: 0.78rem;
}

.meta-grid dt {
  color: var(--text-2);
  text-transform: capitalize;
}

.meta-grid dd {
  margin: 0;
  color: var(--text-1);
  word-break: break-word;
}

/* ─── Visualizer panel ─── */
.visualizer-panel {
  padding-top: 0.5rem;
}

.viz-loading,
.viz-error {
  font-size: 0.85rem;
  color: var(--text-3);
  margin-top: 1rem;
}

.viz-error { color: var(--text-2); }

</style>
