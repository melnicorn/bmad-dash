<template>
  <nav class="sidebar-tree">
    <!-- ─── Top-level sections ─── -->
    <div class="nav-sections">
      <button class="nav-link" :class="{ active: isOverviewActive }" @click="goTo('overview')">
        <span class="nav-ico">▚</span> Overview
      </button>
      <button class="nav-link" :class="{ active: route.name === 'epicBoard' }" @click="goTo('epicBoard')">
        <span class="nav-ico">▦</span> Epic Board
      </button>
      <button class="nav-link" :class="{ active: route.name === 'docs' }" @click="goTo('docs')">
        <span class="nav-ico">📄</span> Documents
        <span v-if="store.documents.length" class="nav-count">{{ store.documents.length }}</span>
      </button>
    </div>

    <div class="sidebar-header">
      <span class="sidebar-header-label">Epics ({{ visibleEpics.length }})</span>
      <button class="collapse-all-btn" @click="toggleAll" :title="allExpanded ? 'Collapse all' : 'Expand all'">
        {{ allExpanded ? '⊟' : '⊞' }}
      </button>
    </div>

    <!-- ─── Filters ─── -->
    <div class="filter-box">
      <input
        class="filter-input"
        type="text"
        placeholder="Filter epics & stories…"
        :value="filters.text"
        @input="filters.setText(($event.target as HTMLInputElement).value)"
      />
      <label class="filter-toggle">
        <input
          type="checkbox"
          :checked="filters.hideCompletedEpics"
          @change="filters.setHideCompletedEpics(($event.target as HTMLInputElement).checked)"
        />
        Hide completed epics
      </label>
      <label class="filter-toggle">
        <input
          type="checkbox"
          :checked="filters.hideCompletedStories"
          @change="filters.setHideCompletedStories(($event.target as HTMLInputElement).checked)"
        />
        Hide completed stories
      </label>
    </div>

    <SidebarEpicItem
      v-for="epic in visibleEpics"
      :key="epic.id"
      :epic="epic"
      :is-expanded="isExpanded(epic.id)"
      :is-active="activeEpicId === epic.id"
      @toggle="toggleEpic(epic.id)"
      @select="selectEpic(epic.id)"
    >
      <SidebarStoryItem
        v-for="story in filters.visibleStories(epic)"
        :key="story.id"
        :story="story"
        :is-active="activeStoryId === story.id"
        @select="selectStory(epic.id, story.id)"
      />
    </SidebarEpicItem>
    <p v-if="visibleEpics.length === 0" class="no-epics">No epics match the current filters.</p>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../stores/project'
import { useFilterStore } from '../stores/filters'
import SidebarEpicItem from './SidebarEpicItem.vue'
import SidebarStoryItem from './SidebarStoryItem.vue'

// ─── Store & Router ───
const store = useProjectStore()
const filters = useFilterStore()
const route = useRoute()
const router = useRouter()

// Epics passing the current filters.
const visibleEpics = computed(() => store.epics.filter((e) => filters.matchesEpic(e)))

// ─── Active State (source of truth: route params) ───
const activeEpicId = computed(() => route.params.epicId as string | undefined)
const activeStoryId = computed(() => route.params.storyId as string | undefined)
const isOverviewActive = computed(() => route.name === 'overview')

// ─── Expand/Collapse State ───
// Must replace Set (not mutate) to trigger Vue 3 reactivity
const expandedEpicIds = ref<Set<string>>(new Set())

// Initialize: expand first epic once store data is available
watch(
  () => store.epics,
  (epics) => {
    if (epics.length > 0 && expandedEpicIds.value.size === 0) {
      expandedEpicIds.value = new Set([epics[0].id])
    }
  },
  { immediate: true }
)

// Auto-expand active epic on navigation so active story stays visible
watch(activeEpicId, (id) => {
  if (id && !expandedEpicIds.value.has(id)) {
    expandedEpicIds.value = new Set([...expandedEpicIds.value, id])
  }
}, { immediate: true })

function isExpanded(epicId: string): boolean {
  return expandedEpicIds.value.has(epicId)
}

function toggleEpic(epicId: string): void {
  const next = new Set(expandedEpicIds.value)
  if (next.has(epicId)) {
    next.delete(epicId)
  } else {
    next.add(epicId)
  }
  expandedEpicIds.value = next
}

// ─── Collapse/Expand All ───
const allExpanded = computed(() =>
  store.epics.length > 0 && store.epics.every(e => expandedEpicIds.value.has(e.id))
)

function toggleAll(): void {
  if (allExpanded.value) {
    expandedEpicIds.value = new Set()
  } else {
    expandedEpicIds.value = new Set(store.epics.map(e => e.id))
  }
}

// ─── Navigation Actions ───
function goTo(name: string): void {
  router.push({ name })
}

function selectEpic(epicId: string): void {
  store.selectEpic(epicId)
  router.push({ name: 'epic', params: { epicId } })
}

function selectStory(epicId: string, storyId: string): void {
  router.push({ name: 'storyDetail', params: { epicId, storyId } })
}

// ─── Initial Load Navigation ───
// Sync: production has __INITIAL_DATA__ — store is populated before mount
// Async: dev fetches /api/project — store.selectedEpicId may be null at mount
function maybeNavigateToFirstEpic(): void {
  if (route.name === 'home' && store.selectedEpicId) {
    router.push({ name: 'epic', params: { epicId: store.selectedEpicId } })
  }
}

onMounted(maybeNavigateToFirstEpic)

// Dev fallback: watch for first non-null selectedEpicId after async hydration
watch(() => store.selectedEpicId, (id) => {
  if (id && route.name === 'home') {
    router.push({ name: 'epic', params: { epicId: id } })
  }
}, { once: true })
</script>

<style scoped>
.sidebar-tree {
  padding: 8px 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px 6px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}

.sidebar-header-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-2);
}

.collapse-all-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-2);
  font-size: 1rem;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  line-height: 1;
}

.collapse-all-btn:hover {
  color: var(--text-0);
  background: var(--bg-3);
}

/* ─── Top-level nav ─── */
.nav-sections { padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  text-align: left;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-1);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.nav-link:hover { background: var(--bg-3); color: var(--text-0); }
.nav-link.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.nav-ico { font-size: 0.85rem; width: 1.1em; text-align: center; }
.nav-count {
  margin-left: auto;
  font-size: 0.7rem;
  color: var(--text-3);
  background: var(--bg-2);
  border-radius: 999px;
  padding: 1px 7px;
}

/* ─── Filters ─── */
.filter-box { padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.filter-input {
  width: 100%;
  background: var(--bg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  color: var(--text-0);
  font-family: inherit;
  font-size: 0.78rem;
}
.filter-input:focus { outline: none; border-color: var(--accent); }
.filter-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  color: var(--text-2);
  cursor: pointer;
}
.filter-toggle input { cursor: pointer; }

.no-epics { color: var(--text-3); font-size: 0.8rem; padding: 8px 12px; }
</style>
