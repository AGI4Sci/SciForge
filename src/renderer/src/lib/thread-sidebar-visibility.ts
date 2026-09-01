import type { NormalizedThread } from '../agent/types'

type SidebarVisibilityFilterOptions = {
  hiddenThreadIds?: Iterable<string>
}

type SidebarThreadShape = Pick<NormalizedThread, 'id'> &
  Partial<Pick<
    NormalizedThread,
    'visibility' | 'sidebarVisibility' | 'threadSource' | 'relation' | 'parentThreadId'
  >>

const SIDEBAR_HIDDEN_VISIBILITY_VALUES = new Set([
  'auxiliary',
  'hidden',
  'hide',
  'internal',
  'none',
  'sidebar_hidden'
])
const SIDEBAR_VISIBLE_VISIBILITY_VALUES = new Set([
  'main',
  'show',
  'sidebar',
  'visible'
])
const SIDEBAR_HIDDEN_THREAD_SOURCES = new Set([
  'local_workflow',
  'pdf_annotation',
  'subagent',
  'workflow'
])

function normalizedStructuredValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function sidebarVisibilityDecision(
  thread: Partial<Pick<NormalizedThread, 'visibility' | 'sidebarVisibility'>>
): boolean | null {
  const visibility = normalizedStructuredValue(thread.sidebarVisibility) ||
    normalizedStructuredValue(thread.visibility)
  if (!visibility || visibility === 'auto' || visibility === 'default') return null
  if (SIDEBAR_HIDDEN_VISIBILITY_VALUES.has(visibility)) return true
  if (SIDEBAR_VISIBLE_VISIBILITY_VALUES.has(visibility)) return false
  return null
}

export function shouldHideThreadFromSidebarByThreadSource(
  thread: Partial<Pick<NormalizedThread, 'threadSource'>>
): boolean {
  return SIDEBAR_HIDDEN_THREAD_SOURCES.has(normalizedStructuredValue(thread.threadSource))
}

export function shouldHideThreadFromSidebarByLineage(
  thread: Pick<NormalizedThread, 'id'> & Partial<Pick<NormalizedThread, 'relation' | 'parentThreadId'>>
): boolean {
  if (thread.relation === 'side') return true
  if (thread.relation === 'primary' || thread.relation === 'fork') return false
  const parentThreadId = thread.parentThreadId?.trim() ?? ''
  return Boolean(parentThreadId && parentThreadId !== thread.id.trim())
}

export function shouldHideThreadFromSidebarByDefault(thread: SidebarThreadShape): boolean {
  const visibilityDecision = sidebarVisibilityDecision(thread)
  if (visibilityDecision !== null) return visibilityDecision
  return shouldHideThreadFromSidebarByThreadSource(thread) ||
    shouldHideThreadFromSidebarByLineage(thread)
}

function normalizeHiddenThreadIds(ids: Iterable<string> | undefined): Set<string> {
  const normalized = new Set<string>()
  for (const id of ids ?? []) {
    const threadId = id.trim()
    if (threadId) normalized.add(threadId)
  }
  return normalized
}

export function filterThreadsForSidebar(
  threads: NormalizedThread[],
  options: SidebarVisibilityFilterOptions = {}
): NormalizedThread[] {
  const hiddenThreadIds = normalizeHiddenThreadIds(options.hiddenThreadIds)
  return threads.filter((thread) => (
    !shouldHideThreadFromSidebarByDefault(thread) &&
    (thread.hasUserMessage !== false || sidebarVisibilityDecision(thread) === false) &&
    !hiddenThreadIds.has(thread.id.trim())
  ))
}
