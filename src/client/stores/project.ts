import { defineStore } from 'pinia'
import type { BmadProject } from '../../types/index'

// ─── Project Store ───
export const useProjectStore = defineStore('project', {
  state: () => ({
    project: null as BmadProject | null,
    selectedEpicId: null as string | null,
  }),
  getters: {
    epics: (state) => state.project?.epics ?? [],
    selectedEpic: (state) =>
      state.project?.epics.find((e) => e.id === state.selectedEpicId) ?? null,
    commitMappings: (state) => state.project?.commitMappings ?? [],
    documents: (state) => state.project?.documents ?? [],
    sprintStatus: (state) => state.project?.sprintStatus ?? null,
    frMap: (state) => state.project?.frMap ?? [],
    nextStep: (state) => state.project?.nextStep ?? null,
    risks: (state) => state.project?.risks ?? [],
    projectConfig: (state) => state.project?.config ?? null,
    /** 6.13+ ticket-tree summary; null for the v4/v5/v6 layouts. */
    ticketSummary: (state) => state.project?.tickets ?? null,
    /** True when the project was parsed as a 6.13+ ticket tree. */
    isTicketLayout: (state) => state.project?.config?.version === 'tickets',
    layout: (state) => state.project?.layout ?? null,
    docById: (state) => (id: string) =>
      state.project?.documents?.find((d) => d.id === id) ?? null,
    /** Unmatched commits (storyId === null) — work happening outside any tracked story. */
    unmatchedCommits: (state) =>
      (state.project?.commitMappings ?? []).filter((c) => c.storyId === null),
  },
  actions: {
    setProject(data: BmadProject & { commits?: BmadProject['commitMappings'] }) {
      // SSE broadcasts and the injected payload use `commits`; the API uses
      // `commitMappings`. Normalize so the commits panel survives live updates.
      if (data.commitMappings === undefined && data.commits !== undefined) {
        data.commitMappings = data.commits
      }
      this.project = data
      if (data.epics.length > 0 && !this.selectedEpicId) {
        this.selectedEpicId = data.epics[0].id
      }
    },
    selectEpic(epicId: string) {
      this.selectedEpicId = epicId
    },
    /** Epic status lives only in sprint-status.yaml; optimistic with rollback. */
    async updateEpicStatus(epicId: string, status: string): Promise<void> {
      const epic = this.project?.epics.find(e => e.id === epicId)
      if (!epic) return
      const previous = epic.status
      epic.status = status
      try {
        const res = await fetch(`/api/epics/${encodeURIComponent(epicId)}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        if (!res.ok) epic.status = previous
      } catch {
        epic.status = previous
      }
    },
    async updateStoryStatus(epicId: string, storyId: string, status: string): Promise<void> {
      // ─── Optimistic Update ───
      const epic = this.project?.epics.find(e => e.id === epicId)
      const story = epic?.stories.find(s => s.id === storyId)
      if (!story) return
      const previousStatus = story.status
      story.status = status
      // ─── API Sync ───
      try {
        const res = await fetch(
          `/api/epics/${encodeURIComponent(epicId)}/stories/${encodeURIComponent(storyId)}/status`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          }
        )
        if (!res.ok) {
          story.status = previousStatus
        }
      } catch {
        story.status = previousStatus
      }
    },
    async toggleAC(epicId: string, storyId: string, acIndex: number, done: boolean): Promise<void> {
      // ─── Optimistic Update ───
      const epic = this.project?.epics.find(e => e.id === epicId)
      const story = epic?.stories.find(s => s.id === storyId)
      const ac = story?.acceptanceCriteria[acIndex]
      if (!ac) return
      const previousDone = ac.done
      ac.done = done
      // ─── API Sync ───
      // Server uses 1-based index matching AC-1, AC-2 … so add 1 to the 0-based array index
      const apiIndex = acIndex + 1
      try {
        const res = await fetch(
          `/api/epics/${encodeURIComponent(epicId)}/stories/${encodeURIComponent(storyId)}/ac/${apiIndex}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) }
        )
        if (!res.ok) { ac.done = previousDone }
      } catch {
        ac.done = previousDone
      }
    },
    async toggleTask(epicId: string, storyId: string, taskId: string, done: boolean): Promise<void> {
      // ─── Optimistic Update ───
      const epic = this.project?.epics.find(e => e.id === epicId)
      const story = epic?.stories.find(s => s.id === storyId)
      // Search top-level tasks first, then nested subtasks
      let task = story?.tasks.find(t => t.id === taskId)
      if (!task && story) {
        for (const t of story.tasks) {
          const sub = t.subtasks?.find(s => s.id === taskId)
          if (sub) { task = sub; break }
        }
      }
      if (!task) return
      const previousDone = task.done
      task.done = done
      // ─── API Sync ───
      try {
        const res = await fetch(
          `/api/epics/${encodeURIComponent(epicId)}/stories/${encodeURIComponent(storyId)}/task/${encodeURIComponent(taskId)}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) }
        )
        if (!res.ok) { task.done = previousDone }
      } catch {
        task.done = previousDone
      }
    },
  },
})
