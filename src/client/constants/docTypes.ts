import type { DocType } from '../../types/index'

// Presentation metadata for BMAD document types: label, short icon, and the
// display order used to group the Documents browser.

interface DocTypeMeta {
  label: string
  icon: string
  order: number
}

export const DOC_TYPE_META: Record<DocType, DocTypeMeta> = {
  'prd': { label: 'PRDs', icon: '📋', order: 1 },
  'architecture': { label: 'Architecture', icon: '🏛️', order: 2 },
  'epics': { label: 'Epics', icon: '🗂️', order: 3 },
  'ux-design': { label: 'UX Designs', icon: '🎨', order: 4 },
  'brief': { label: 'Briefs', icon: '📝', order: 5 },
  'research': { label: 'Research', icon: '🔬', order: 6 },
  'spec': { label: 'Specs', icon: '📐', order: 7 },
  'readiness-report': { label: 'Readiness Reports', icon: '✅', order: 8 },
  'sprint-change-proposal': { label: 'Sprint Change Proposals', icon: '🔀', order: 9 },
  'retrospective': { label: 'Retrospectives', icon: '🔁', order: 10 },
  'review': { label: 'Reviews', icon: '🔎', order: 11 },
  'project-context': { label: 'Project Context', icon: '🧭', order: 12 },
  'other': { label: 'Other', icon: '📄', order: 99 },
}

export function docTypeMeta(type: DocType): DocTypeMeta {
  return DOC_TYPE_META[type] ?? DOC_TYPE_META.other
}
