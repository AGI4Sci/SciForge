import type { ChatBlock, NormalizedThread } from '../agent/types'
import { isRemoteChannelManagedBy } from '../agent/types'
import {
  deriveThreadTitleFromPrompt,
  hasNonDisplayThreadTitleSource,
  hasThreadIdFallbackTitle,
  hasPlaceholderThreadTitle
} from './thread-title'

type ThreadDetailReader = {
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
  getThreadSidebarProbe?: (threadId: string) => Promise<{ text: string | null }>
}

type SidebarVisibilityFilterOptions = {
  maxDetailInspections?: number
  hiddenThreadIds?: Iterable<string>
}

export const SIDEBAR_VISIBILITY_INSPECTION_LIMIT = 20
export const SIDEBAR_DETAIL_INSPECTION_CONCURRENCY = 2

type SidebarThreadShape = Pick<NormalizedThread, 'id' | 'title'> &
  Partial<Pick<
    NormalizedThread,
    'visibility' | 'sidebarVisibility' | 'threadSource' | 'relation' | 'parentThreadId' | 'titleSource'
  >>

type SidebarThreadInspectionResult = {
  threadId: string
  hide: boolean
  title: string | null
}

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

export function shouldInspectThreadForSidebarVisibility(
  thread: SidebarThreadShape
): boolean {
  if (sidebarVisibilityDecision(thread) === false) return false
  return !shouldHideThreadFromSidebarByDefault(thread) &&
    (
      hasThreadIdFallbackTitle(thread) ||
      hasPlaceholderThreadTitle(thread.title) ||
      hasNonDisplayThreadTitleSource(thread.titleSource)
    )
}

export function shouldHideThreadFromSidebarByBlocks(blocks: ChatBlock[]): boolean {
  return !blocks.some((block) => {
    if (block.kind !== 'user' || isRemoteChannelManagedBy(block.managedBy)) return false
    return Boolean(block.meta?.displayText?.trim() || block.text.trim())
  })
}

export function filterThreadsForSidebarSummary(
  threads: NormalizedThread[]
): NormalizedThread[] {
  return threads.filter(
    (thread) =>
      !shouldHideThreadFromSidebarByDefault(thread) &&
      !shouldInspectThreadForSidebarVisibility(thread)
  )
}

export function hasThreadsRequiringSidebarVisibilityInspection(
  threads: NormalizedThread[]
): boolean {
  return threads.some((thread) =>
    !shouldHideThreadFromSidebarByDefault(thread) &&
    shouldInspectThreadForSidebarVisibility(thread)
  )
}

function titleFromThreadBlocks(blocks: ChatBlock[]): string | null {
  const userBlock = blocks.find((block) => {
    if (block.kind !== 'user' || isRemoteChannelManagedBy(block.managedBy)) return false
    const text = block.meta?.displayText?.trim() || block.text.trim()
    return Boolean(text)
  })
  if (!userBlock || userBlock.kind !== 'user') return null
  const text = userBlock.meta?.displayText?.trim() || userBlock.text.trim()
  if (!text) return null
  const title = deriveThreadTitleFromPrompt(text)
  return hasPlaceholderThreadTitle(title) ? null : title
}

function titleFromUserText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return null
  const title = deriveThreadTitleFromPrompt(trimmed)
  return hasPlaceholderThreadTitle(title) ? null : title
}

function needsRealDerivedTitle(
  thread: Pick<NormalizedThread, 'id' | 'title'> & Partial<Pick<NormalizedThread, 'titleSource'>>
): boolean {
  return hasThreadIdFallbackTitle(thread) ||
    hasPlaceholderThreadTitle(thread.title) ||
    hasNonDisplayThreadTitleSource(thread.titleSource)
}

function threadUpdatedAtMs(thread: Pick<NormalizedThread, 'updatedAt'>): number {
  const parsed = Date.parse(thread.updatedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function prioritizeThreadsForVisibilityInspection(
  threads: NormalizedThread[]
): NormalizedThread[] {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const newestFirst = threadUpdatedAtMs(b.thread) - threadUpdatedAtMs(a.thread)
      return newestFirst || a.index - b.index
    })
    .map(({ thread }) => thread)
}

function normalizeHiddenThreadIds(ids: Iterable<string> | undefined): Set<string> {
  const normalized = new Set<string>()
  for (const id of ids ?? []) {
    const threadId = id.trim()
    if (threadId) normalized.add(threadId)
  }
  return normalized
}

async function inspectThreadsForSidebar(
  threads: NormalizedThread[],
  reader: ThreadDetailReader
): Promise<SidebarThreadInspectionResult[]> {
  if (threads.length === 0) return []

  const results = new Array<SidebarThreadInspectionResult | null>(threads.length).fill(null)
  const workerCount = Math.min(threads.length, SIDEBAR_DETAIL_INSPECTION_CONCURRENCY)
  let nextIndex = 0

  const inspectNext = async (): Promise<void> => {
    while (nextIndex < threads.length) {
      const index = nextIndex
      nextIndex += 1
      const thread = threads[index]
      try {
        if (reader.getThreadSidebarProbe) {
          const probe = await reader.getThreadSidebarProbe(thread.id)
          const hasUserText = Boolean(probe.text?.trim())
          const title = titleFromUserText(probe.text)
          results[index] = {
            threadId: thread.id,
            hide: !hasUserText || (needsRealDerivedTitle(thread) && !title),
            title
          }
          continue
        }
        const detail = await reader.getThreadDetail(thread.id)
        const title = titleFromThreadBlocks(detail.blocks)
        results[index] = {
          threadId: thread.id,
          hide: shouldHideThreadFromSidebarByBlocks(detail.blocks) ||
            (needsRealDerivedTitle(thread) && !title),
          title
        }
      } catch {
        results[index] = null
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => inspectNext()))
  return results.filter((result): result is SidebarThreadInspectionResult => result !== null)
}

export async function filterThreadsForSidebar(
  threads: NormalizedThread[],
  reader: ThreadDetailReader,
  options: SidebarVisibilityFilterOptions = {}
): Promise<NormalizedThread[]> {
  const hiddenThreadIds = normalizeHiddenThreadIds(options.hiddenThreadIds)
  const hiddenIds = new Set(
    threads
      .filter((thread) =>
        shouldHideThreadFromSidebarByDefault(thread) ||
        hiddenThreadIds.has(thread.id.trim())
      )
      .map((thread) => thread.id)
  )
  const derivedTitles = new Map<string, string>()
  const maxDetailInspections = Math.max(
    0,
    Math.floor(options.maxDetailInspections ?? SIDEBAR_VISIBILITY_INSPECTION_LIMIT)
  )
  const suspiciousThreads = prioritizeThreadsForVisibilityInspection(
    threads.filter(
      (thread) =>
        !hiddenIds.has(thread.id) && shouldInspectThreadForSidebarVisibility(thread)
    )
  )
  const threadsToInspect: NormalizedThread[] = []
  for (const thread of suspiciousThreads) {
    if (threadsToInspect.length < maxDetailInspections) {
      threadsToInspect.push(thread)
      hiddenIds.add(thread.id)
      continue
    }
    hiddenIds.add(thread.id)
  }

  if (threadsToInspect.length > 0) {
    const results = await inspectThreadsForSidebar(threadsToInspect, reader)

    for (const result of results) {
      if (result.hide) {
        hiddenIds.add(result.threadId)
      } else {
        hiddenIds.delete(result.threadId)
        if (result.title) derivedTitles.set(result.threadId, result.title)
      }
    }
  }

  if (hiddenIds.size === 0 && derivedTitles.size === 0) return threads
  return threads
    .filter((thread) => !hiddenIds.has(thread.id))
    .map((thread) => {
      const title = derivedTitles.get(thread.id)
      return title ? { ...thread, title } : thread
    })
}
