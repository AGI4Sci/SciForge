import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import type { UserMessageManagedBy } from '../agent/types'
import {
  filterThreadsForSidebarSummary,
  filterThreadsForSidebar,
  hasThreadsRequiringSidebarVisibilityInspection,
  SIDEBAR_DETAIL_INSPECTION_CONCURRENCY,
  SIDEBAR_VISIBILITY_INSPECTION_LIMIT,
  shouldHideThreadFromSidebarByBlocks,
  shouldHideThreadFromSidebarByLineage,
  shouldHideThreadFromSidebarByThreadSource,
  shouldInspectThreadForSidebarVisibility
} from './thread-sidebar-visibility'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'title'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title,
    updatedAt: overrides.updatedAt ?? '2026-05-25T00:00:00.000Z',
    model: overrides.model ?? 'auto',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace ?? '/Users/zxy/workspace',
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    ...(overrides.latestTurnId ? { latestTurnId: overrides.latestTurnId } : {}),
    ...(overrides.threadSource ? { threadSource: overrides.threadSource } : {}),
    ...(overrides.visibility ? { visibility: overrides.visibility } : {}),
    ...(overrides.sidebarVisibility ? { sidebarVisibility: overrides.sidebarVisibility } : {}),
    ...(overrides.titleSource ? { titleSource: overrides.titleSource } : {}),
    ...(overrides.relation ? { relation: overrides.relation } : {}),
    ...(overrides.parentThreadId ? { parentThreadId: overrides.parentThreadId } : {})
  }
}

function userBlock(text = 'hello', managedBy?: UserMessageManagedBy): ChatBlock {
  return {
    kind: 'user',
    id: 'u-1',
    text,
    ...(managedBy ? { managedBy } : {})
  }
}

describe('thread-sidebar-visibility', () => {
  it('prioritizes structured sidebar visibility and thread source metadata', async () => {
    const hiddenByVisibility = thread({
      id: 'hidden-by-visibility',
      title: 'Runtime managed',
      sidebarVisibility: 'hidden'
    })
    const visibleSideThread = thread({
      id: 'visible-side-thread',
      title: 'Pinned child',
      sidebarVisibility: 'visible',
      relation: 'side',
      parentThreadId: 'parent-thread'
    })
    const subagentThread = thread({
      id: 'subagent-thread',
      title: 'Worker B',
      threadSource: 'subagent'
    })
    const mainThread = thread({ id: 'main-thread', title: 'Main research task' })
    const getThreadDetail = vi.fn(async () => ({ blocks: [userBlock()] }))

    expect(shouldHideThreadFromSidebarByThreadSource(subagentThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByLineage(visibleSideThread)).toBe(true)
    await expect(
      filterThreadsForSidebar(
        [hiddenByVisibility, visibleSideThread, subagentThread, mainThread],
        { getThreadDetail }
      )
    ).resolves.toEqual([visibleSideThread, mainThread])
    expect(getThreadDetail).not.toHaveBeenCalled()
  })

  it('hides child and side threads from the main sidebar', async () => {
    const sideThread = thread({
      id: 'child-side-thread',
      title: 'Child worker',
      relation: 'side',
      parentThreadId: 'parent-thread'
    })
    const childThread = thread({
      id: 'child-parent-thread',
      title: 'Child worker',
      parentThreadId: 'parent-thread'
    })
    const promotedThread = thread({
      id: 'promoted-thread',
      title: 'Promoted child',
      relation: 'primary',
      parentThreadId: 'parent-thread'
    })
    const forkedThread = thread({
      id: 'forked-thread',
      title: 'Forked session',
      relation: 'fork',
      parentThreadId: 'parent-thread'
    })
    const mainThread = thread({ id: 'main-thread', title: 'Main research task' })
    const getThreadDetail = vi.fn(async () => ({ blocks: [userBlock()] }))

    expect(shouldHideThreadFromSidebarByLineage(sideThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByLineage(childThread)).toBe(true)
    expect(shouldHideThreadFromSidebarByLineage(promotedThread)).toBe(false)
    expect(shouldHideThreadFromSidebarByLineage(forkedThread)).toBe(false)
    await expect(
      filterThreadsForSidebar(
        [sideThread, childThread, promotedThread, forkedThread, mainThread],
        { getThreadDetail }
      )
    ).resolves.toEqual([promotedThread, forkedThread, mainThread])
    expect(getThreadDetail).not.toHaveBeenCalled()
  })

  it('hides attached side conversation ids even without runtime lineage metadata', async () => {
    const attachedChildThread = thread({ id: 'child-thread', title: 'research child' })
    const mainThread = thread({ id: 'main-thread', title: 'Main research task' })
    const getThreadDetail = vi.fn(async () => ({ blocks: [userBlock()] }))

    const visible = await filterThreadsForSidebar(
      [attachedChildThread, mainThread],
      { getThreadDetail },
      { hiddenThreadIds: [' child-thread '] }
    )

    expect(visible).toEqual([mainThread])
    expect(getThreadDetail).not.toHaveBeenCalled()
  })

  it('inspects fallback thread titles before hiding them', () => {
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_279f3fef', title: 'thr_279f' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_279f3fef', title: '新会话' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_codex', title: 'Codex thread' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_structured', title: 'raw setup title', titleSource: 'internal_prompt' })
      )
    ).toBe(true)
  })

  it('treats only empty threads as hidden fallback entries', () => {
    expect(shouldHideThreadFromSidebarByBlocks([])).toBe(true)
    expect(shouldHideThreadFromSidebarByBlocks([userBlock()])).toBe(false)
  })

  it('keeps only immediately safe threads in the summary pass', () => {
    const hiddenThread = thread({ id: 'thr_hidden01', title: 'Runtime managed', sidebarVisibility: 'hidden' })
    const fallbackThread = thread({ id: 'thr_279f3fef', title: 'thr_279f' })
    const realThread = thread({ id: 'thr_real0001', title: '修一下侧边栏 bug' })

    expect(filterThreadsForSidebarSummary([hiddenThread, fallbackThread, realThread])).toEqual([realThread])
    expect(
      hasThreadsRequiringSidebarVisibilityInspection([hiddenThread, fallbackThread, realThread])
    ).toBe(true)
    expect(hasThreadsRequiringSidebarVisibilityInspection([hiddenThread, realThread])).toBe(false)
  })

  it('hides fallback entries whose raw prompt came from a remote channel', () => {
    expect(shouldHideThreadFromSidebarByBlocks([userBlock('现在时间是23:50', 'remoteChannel')])).toBe(true)
    expect(shouldHideThreadFromSidebarByBlocks([userBlock('现在时间是23:50', 'claw')])).toBe(true)
  })

  it('filters empty fallback threads while keeping real threads', async () => {
    const threads = [
      thread({ id: 'thr_279f3fef', title: 'thr_279f' }),
      thread({ id: 'thr_gui0001', title: '新会话' }),
      thread({ id: 'thr_real0001', title: '修一下侧边栏 bug' })
    ]
    const getThreadDetail = vi.fn(async (threadId: string) => {
      if (threadId === 'thr_279f3fef') return { blocks: [] }
      if (threadId === 'thr_gui0001') return { blocks: [] }
      return { blocks: [userBlock()] }
    })

    const visible = await filterThreadsForSidebar(threads, { getThreadDetail })

    expect(visible.map((thread) => thread.id)).toEqual(['thr_real0001'])
    expect(getThreadDetail).toHaveBeenCalledTimes(2)
    expect(getThreadDetail).toHaveBeenCalledWith('thr_279f3fef')
    expect(getThreadDetail).toHaveBeenCalledWith('thr_gui0001')
  })

  it('uses sidebar probes instead of full thread details when available', async () => {
    const fallbackThread = thread({ id: 'thr_probe_title', title: 'New Thread' })
    const getThreadDetail = vi.fn(async () => ({ blocks: [] }))
    const getThreadSidebarProbe = vi.fn(async () => ({ text: 'Summarize the AI4AI benchmarks' }))

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail,
      getThreadSidebarProbe
    })

    expect(getThreadSidebarProbe).toHaveBeenCalledWith('thr_probe_title')
    expect(getThreadDetail).not.toHaveBeenCalled()
    expect(visible).toEqual([{ ...fallbackThread, title: 'Summarize the AI4AI benchmarks' }])
  })

  it('limits suspicious detail reads to the newest fallback titled threads', async () => {
    const suspiciousThreads = Array.from(
      { length: SIDEBAR_VISIBILITY_INSPECTION_LIMIT + 3 },
      (_, index) => {
        const id = `thr_${String(index).padStart(4, '0')}`
        return thread({
          id,
          title: id,
          updatedAt: new Date(Date.UTC(2026, 4, index + 1)).toISOString()
        })
      }
    )
    const getThreadDetail = vi.fn(async (threadId: string) => ({
      blocks: [userBlock(`real content ${threadId}`)]
    }))

    const visible = await filterThreadsForSidebar(suspiciousThreads, { getThreadDetail })

    const inspectedByPriority = suspiciousThreads
      .slice(-SIDEBAR_VISIBILITY_INSPECTION_LIMIT)
      .reverse()
      .map((thread) => thread.id)
    const visibleInspectedThreads = suspiciousThreads
      .slice(-SIDEBAR_VISIBILITY_INSPECTION_LIMIT)
      .map((thread) => thread.id)
    expect(getThreadDetail).toHaveBeenCalledTimes(SIDEBAR_VISIBILITY_INSPECTION_LIMIT)
    expect(getThreadDetail.mock.calls.map(([threadId]) => threadId)).toEqual(inspectedByPriority)
    expect(visible.map((thread) => thread.id)).toEqual(visibleInspectedThreads)
  })

  it('limits concurrent suspicious detail reads', async () => {
    const suspiciousThreads = Array.from(
      { length: SIDEBAR_DETAIL_INSPECTION_CONCURRENCY + 4 },
      (_, index) => {
        const id = `thr_concurrent_${index}`
        return thread({
          id,
          title: 'New Thread',
          updatedAt: new Date(Date.UTC(2026, 4, index + 1)).toISOString()
        })
      }
    )
    let activeReads = 0
    let maxActiveReads = 0
    const getThreadDetail = vi.fn(async (threadId: string) => {
      activeReads += 1
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeReads -= 1
      return { blocks: [userBlock(`real content ${threadId}`)] }
    })

    const visible = await filterThreadsForSidebar(suspiciousThreads, { getThreadDetail }, {
      maxDetailInspections: suspiciousThreads.length
    })

    expect(getThreadDetail).toHaveBeenCalledTimes(suspiciousThreads.length)
    expect(maxActiveReads).toBeLessThanOrEqual(SIDEBAR_DETAIL_INSPECTION_CONCURRENCY)
    expect(visible).toHaveLength(suspiciousThreads.length)
  })

  it('derives display titles for fallback titled threads when detail shows real content', async () => {
    const fallbackThread = thread({ id: 'thr_997f4104', title: 'thr_997f' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('real content')] })
    })

    expect(visible).toEqual([{ ...fallbackThread, title: 'real content' }])
  })

  it('derives display titles for placeholder titled threads with real content', async () => {
    const placeholderThread = thread({ id: 'thr_placeholder', title: 'New Thread' })

    const visible = await filterThreadsForSidebar([placeholderThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('fix the sidebar session bug')] })
    })

    expect(visible).toEqual([{ ...placeholderThread, title: 'fix the sidebar session bug' }])
  })

  it('hides empty Codex runtime placeholder threads', async () => {
    const placeholderThread = thread({ id: 'thr_codex_empty', title: 'Codex thread' })

    const visible = await filterThreadsForSidebar([placeholderThread], {
      getThreadDetail: async () => ({ blocks: [] })
    })

    expect(visible).toEqual([])
  })

  it('hides placeholder titled threads with only non-user runtime blocks', async () => {
    const placeholderThread = thread({ id: 'thr_placeholder_runtime', title: '新会话' })

    const visible = await filterThreadsForSidebar([placeholderThread], {
      getThreadDetail: async () => ({
        blocks: [
          { kind: 'system', id: 'status-1', text: 'Starting runtime' },
          { kind: 'assistant', id: 'assistant-1', text: 'internal status only' }
        ]
      })
    })

    expect(visible).toEqual([])
  })

  it('hides placeholder titled threads when the only user text is also a placeholder', async () => {
    const placeholderThread = thread({ id: 'thr_placeholder_user', title: '新会话' })

    const visible = await filterThreadsForSidebar([placeholderThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('新会话')] })
    })

    expect(visible).toEqual([])
  })

  it('derives display titles for structured non-display title sources with real content', async () => {
    const internalTitleThread = thread({
      id: 'thr_internal_title_source',
      title: 'raw setup title',
      titleSource: 'internal_prompt'
    })

    const visible = await filterThreadsForSidebar([internalTitleThread], {
      getThreadDetail: async () => ({
        blocks: [
          userBlock('继续完成 session 修复')
        ]
      })
    })

    expect(visible).toEqual([{ ...internalTitleThread, title: '继续完成 session 修复' }])
  })

  it('hides structured non-display title sources without a real user message', async () => {
    const internalTitleThread = thread({
      id: 'thr_internal_only',
      title: 'raw setup title',
      titleSource: 'internal_prompt'
    })

    const visible = await filterThreadsForSidebar([internalTitleThread], {
      getThreadDetail: async () => ({
        blocks: [userBlock('managed setup message', 'remoteChannel')]
      })
    })

    expect(visible).toEqual([])
  })

  it('filters legacy fallback remote-channel sessions after inspecting detail', async () => {
    const fallbackThread = thread({ id: 'thr_20be8f66', title: 'thr_20be' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('现在时间是23:50', 'claw')] })
    })

    expect(visible).toEqual([])
  })

  it('hides fallback titled threads when detail loading fails', async () => {
    const fallbackThread = thread({ id: 'thr_997f4104', title: 'thr_997f' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => {
        throw new Error('detail unavailable')
      }
    })

    expect(visible).toEqual([])
  })

  it('does not derive suspicious thread titles from previews without loading detail', async () => {
    const previewOnlyThread = thread({
      id: 'thr_preview_title',
      title: 'New Thread',
      preview: 'Summarize the AlphaFold benchmark results'
    })
    const getThreadDetail = vi.fn(async () => ({ blocks: [] }))

    const visible = await filterThreadsForSidebar([previewOnlyThread], { getThreadDetail }, {
      maxDetailInspections: 0
    })

    expect(getThreadDetail).not.toHaveBeenCalled()
    expect(visible).toEqual([])
  })

  it('caps suspicious thread detail inspection and hides skipped suspicious threads', async () => {
    const first = thread({ id: 'thr_first', title: 'New Thread', latestTurnId: 'turn-1' })
    const second = thread({ id: 'thr_second', title: 'New Thread', latestTurnId: 'turn-2' })
    const getThreadDetail = vi.fn(async () => ({ blocks: [userBlock('first real title')] }))

    const visible = await filterThreadsForSidebar([first, second], { getThreadDetail }, {
      maxDetailInspections: 1
    })

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(getThreadDetail).toHaveBeenCalledWith('thr_first')
    expect(visible.map((item) => [item.id, item.title])).toEqual([
      ['thr_first', 'first real title']
    ])
  })
})
