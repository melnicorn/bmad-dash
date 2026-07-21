// Shared board column definitions — previously duplicated in KanbanBoard,
// StoryDetailView, and OverviewView. Single source of truth.

export interface Column {
  key: string
  label: string
  colorVar: string
}

export const STORY_COLUMNS: Column[] = [
  { key: 'todo', label: 'To Do', colorVar: '--todo' },
  { key: 'active', label: 'Active', colorVar: '--active' },
  { key: 'review', label: 'Ready for Review', colorVar: '--review' },
  { key: 'done', label: 'Done', colorVar: '--done' },
]

// Epic status vocabulary from sprint-status.yaml.
export const EPIC_COLUMNS: Column[] = [
  { key: 'backlog', label: 'Backlog', colorVar: '--todo' },
  { key: 'in-progress', label: 'In Progress', colorVar: '--active' },
  { key: 'done', label: 'Done', colorVar: '--done' },
]

/** Board column a story status falls into (unknown → todo). */
export function storyColumnKey(status?: string): string {
  return STORY_COLUMNS.some((c) => c.key === status) ? (status as string) : 'todo'
}

/** True when a story's status counts as completed (done or cancelled). */
export function isStoryComplete(status?: string): boolean {
  return status === 'done'
}

/** True when an epic's sprint status is done. */
export function isEpicComplete(status?: string): boolean {
  return status === 'done'
}
