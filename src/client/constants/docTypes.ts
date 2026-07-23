import type { DocType } from '../../types/index'
import {
  ClipboardList,
  Landmark,
  FolderTree,
  Palette,
  FileText,
  Microscope,
  Ruler,
  CircleCheck,
  GitPullRequestArrow,
  RefreshCw,
  Search,
  Compass,
  File,
  type LucideIcon,
} from '@lucide/vue'

// Presentation metadata for BMAD document types: label, icon component, and the
// display order used to group the Documents browser.

interface DocTypeMeta {
  label: string
  icon: LucideIcon
  order: number
}

export const DOC_TYPE_META: Record<DocType, DocTypeMeta> = {
  'prd': { label: 'PRDs', icon: ClipboardList, order: 1 },
  'architecture': { label: 'Architecture', icon: Landmark, order: 2 },
  'epics': { label: 'Epics', icon: FolderTree, order: 3 },
  'ux-design': { label: 'UX Designs', icon: Palette, order: 4 },
  'brief': { label: 'Briefs', icon: FileText, order: 5 },
  'research': { label: 'Research', icon: Microscope, order: 6 },
  'spec': { label: 'Specs', icon: Ruler, order: 7 },
  'readiness-report': { label: 'Readiness Reports', icon: CircleCheck, order: 8 },
  'sprint-change-proposal': { label: 'Sprint Change Proposals', icon: GitPullRequestArrow, order: 9 },
  'retrospective': { label: 'Retrospectives', icon: RefreshCw, order: 10 },
  'review': { label: 'Reviews', icon: Search, order: 11 },
  'project-context': { label: 'Project Context', icon: Compass, order: 12 },
  'other': { label: 'Other', icon: File, order: 99 },
}

export function docTypeMeta(type: DocType): DocTypeMeta {
  return DOC_TYPE_META[type] ?? DOC_TYPE_META.other
}
