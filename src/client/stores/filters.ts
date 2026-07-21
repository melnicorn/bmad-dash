import { defineStore } from 'pinia'
import type { Epic, UserStory } from '../../types/index'
import { isEpicComplete } from '../constants/columns'

// ─── View filters ───
// Shared, persisted filter state applied across the sidebar, overview, and
// boards so "hide completed" behaves consistently everywhere.

const STORAGE_KEY = 'bmad-dash.filters'

interface FilterState {
  hideCompletedEpics: boolean
  hideCompletedStories: boolean
  text: string
}

function load(): FilterState {
  const defaults: FilterState = { hideCompletedEpics: false, hideCompletedStories: false, text: '' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return defaults
}

export const useFilterStore = defineStore('filters', {
  state: (): FilterState => load(),
  getters: {
    active: (s) => s.hideCompletedEpics || s.hideCompletedStories || s.text.trim().length > 0,
  },
  actions: {
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          hideCompletedEpics: this.hideCompletedEpics,
          hideCompletedStories: this.hideCompletedStories,
          text: this.text,
        }))
      } catch { /* ignore */ }
    },
    setHideCompletedEpics(v: boolean) { this.hideCompletedEpics = v; this.persist() },
    setHideCompletedStories(v: boolean) { this.hideCompletedStories = v; this.persist() },
    setText(v: string) { this.text = v; this.persist() },
    clear() { this.hideCompletedEpics = false; this.hideCompletedStories = false; this.text = ''; this.persist() },

    // ─── Predicates (used by every filtered surface) ───
    matchesStory(story: UserStory): boolean {
      if (this.hideCompletedStories && story.status === 'done') return false
      const q = this.text.trim().toLowerCase()
      if (q) {
        const hay = `${story.id} ${story.title}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    },
    /** Stories in an epic that pass the current filters. */
    visibleStories(epic: Epic): UserStory[] {
      return epic.stories.filter((s) => this.matchesStory(s))
    },
    /** Whether an epic should appear at all. */
    matchesEpic(epic: Epic): boolean {
      if (this.hideCompletedEpics && isEpicComplete(epic.status)) return false
      const q = this.text.trim().toLowerCase()
      if (q) {
        const epicHit = `${epic.id} ${epic.title}`.toLowerCase().includes(q)
        const storyHit = epic.stories.some((s) => this.matchesStory(s))
        if (!epicHit && !storyHit) return false
      }
      return true
    },
  },
})
