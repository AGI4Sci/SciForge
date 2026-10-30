import { describe, expect, it, vi } from 'vitest'
import { createHistoryTool } from './history-tool'
import type { AgentRuntimeThreadPage } from '../../../shared/agent-runtime-contract'

const context = { runtimeId: 'codex', threadId: 'own-session', turnId: 'current', requestId: 'r' }
const page: AgentRuntimeThreadPage = {
  runtimeId: 'codex', threadId: 'own-session', latestSeq: 80, nextCursor: 'older',
  turns: [{ id: 'before-compaction', threadId: 'own-session', status: 'completed', items: [
    { id: 'original', kind: 'assistant_message', text: '建议4：合并阅读路径。建议5：保留原始公式。' },
    { id: 'long', kind: 'user_message', text: 'a'.repeat(13_000) }
  ] }]
}

describe('durable history tool', () => {
  it('finds original wording on a canonical older page within the calling session', async () => {
    const readPage = vi.fn(async () => page)
    const assertLease = vi.fn()
    const tool = createHistoryTool({ readPage, assertLease })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { cursor: 'page-2', query: '建议4' } })
    expect(readPage).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'own-session', cursor: 'page-2', limit: 20 })
    expect(result.value).toMatchObject({ pageCursor: 'page-2', nextCursor: 'older', items: [{ itemId: 'original', text: '建议4：合并阅读路径。建议5：保留原始公式。', nextOffset: null }] })
    expect(assertLease).toHaveBeenCalledTimes(2)
  })

  it('searches durable tool facts and preserves their artifact reference', async () => {
    const toolPage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: null,
      turns: [{ ...page.turns[0], items: [{
        id: 'tool-1',
        kind: 'tool',
        summary: 'Read manuscript metadata',
        detail: 'The sample count is 42.',
        detailArtifact: { runtimeId: 'codex', threadId: 'own-session', ref: 'artifact-ref', size: 24 }
      }] }]
    }
    const tool = createHistoryTool({ readPage: async () => toolPage, assertLease: () => undefined })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { query: 'sample count' } })
    expect(result.value).toMatchObject({
      items: [{ itemId: 'tool-1', kind: 'tool', text: 'Read manuscript metadata\nThe sample count is 42.', summary: 'Read manuscript metadata',
        detailArtifact: { ref: 'artifact-ref' } }]
    })
  })

  it('finds summary-only tool matches and delivers artifact continuation exactly', async () => {
    const tool = createHistoryTool({
      readPage: async () => ({ ...page, nextCursor: null, turns: [{ ...page.turns[0], items: [
        { id: 'summary', kind: 'tool', summary: 'summary-only durable fact' }
      ] }] }),
      readArtifact: async () => ({ content: 'a'.repeat(6000) }),
      assertLease: () => undefined
    })
    const found = await tool.call({ name: 'sciforge_read_history', context, arguments: { query: 'summary-only' } })
    expect(JSON.parse(found.modelContent!)).toMatchObject({ items: [{ itemId: 'summary', text: 'summary-only durable fact' }] })
    const first = await tool.call({ name: 'sciforge_read_history', context, arguments: { artifactRef: 'ref' } })
    expect(JSON.parse(first.modelContent!)).toMatchObject({ content: 'a'.repeat(2800), offset: 0, nextOffset: 2800 })
    const next = await tool.call({ name: 'sciforge_read_history', context, arguments: { artifactRef: 'ref', offset: 2800 } })
    expect(JSON.parse(next.modelContent!)).toMatchObject({ content: 'a'.repeat(2800), offset: 2800, nextOffset: 5600 })
  })

  it('loads a complete tool artifact through the canonical artifact reader', async () => {
    const readArtifact = vi.fn(async () => ({ content: 'complete tool output', size: 21 }))
    const tool = createHistoryTool({
      readPage: async () => page,
      readArtifact,
      assertLease: () => undefined
    })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { artifactRef: 'artifact-ref' } })
    expect(readArtifact).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'own-session', ref: 'artifact-ref' })
    expect(result.value).toMatchObject({ artifactRef: 'artifact-ref', content: 'complete tool output', size: 21 })
    expect(JSON.parse(result.modelContent!)).toMatchObject({ content: 'complete tool output', offset: 0, nextOffset: null })
  })

  it('recovers long originals in exact consecutive chunks without treating an empty search as exhausted', async () => {
    const tool = createHistoryTool({ readPage: async () => page, assertLease: () => undefined })
    const first = await tool.call({ name: 'sciforge_read_history', context, arguments: { itemId: 'long' } })
    expect(first.value).toMatchObject({ items: [{ text: 'a'.repeat(2_800), nextOffset: 2_800 }] })
    expect(JSON.parse(first.modelContent!)).toMatchObject({ items: [{ text: 'a'.repeat(2_800), nextOffset: 2_800 }] })
    const rest = await tool.call({ name: 'sciforge_read_history', context, arguments: { itemId: 'long', offset: 12_000 } })
    expect(rest.value).toMatchObject({ items: [{ text: 'a'.repeat(1000), nextOffset: null }] })
    const emptyTool = createHistoryTool({
      readPage: async () => ({ ...page, nextCursor: null }),
      assertLease: () => undefined
    })
    const empty = await emptyTool.call({ name: 'sciforge_read_history', context, arguments: { query: 'absent' } })
    expect(empty.value).toMatchObject({ items: [], nextCursor: null })
  })

  it('scans older durable pages when a query is absent from the newest page', async () => {
    const olderPage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: null,
      turns: [{ ...page.turns[0], items: [{ id: 'older', kind: 'user_message', text: 'the durable detail' }] }]
    }
    const readPage = vi.fn(async ({ cursor }: { cursor?: string }) => cursor ? olderPage : { ...page, nextCursor: 'older' })
    const tool = createHistoryTool({ readPage, assertLease: () => undefined })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { query: 'durable detail' } })
    expect(readPage).toHaveBeenNthCalledWith(1, { runtimeId: 'codex', threadId: 'own-session', limit: 20 })
    expect(readPage).toHaveBeenNthCalledWith(2, { runtimeId: 'codex', threadId: 'own-session', cursor: 'older', limit: 20 })
    expect(result.value).toMatchObject({ pagesScanned: 2, items: [{ itemId: 'older', text: 'the durable detail' }] })
  })

  it('returns no-match after scanning all available durable pages', async () => {
    const oldestPage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: null,
      turns: [{ ...page.turns[0], items: [{ id: 'oldest', kind: 'user_message', text: 'oldest detail' }] }]
    }
    const middlePage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: 'oldest',
      turns: [{ ...page.turns[0], items: [{ id: 'middle', kind: 'user_message', text: 'middle detail' }] }]
    }
    const readPage = vi.fn(async ({ cursor }: { cursor?: string }) => {
      if (cursor === 'oldest') return oldestPage
      if (cursor === 'newest') return middlePage
      return { ...page, nextCursor: 'newest' }
    })
    const tool = createHistoryTool({ readPage, assertLease: () => undefined })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { query: 'missing detail' } })

    expect(readPage).toHaveBeenCalledTimes(3)
    expect(result.value).toMatchObject({ pagesScanned: 3, nextCursor: null, items: [] })
  })

  it('finds an exact item on an older page and preserves its continuation cursor', async () => {
    const olderPage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: 'oldest',
      turns: [{ ...page.turns[0], items: [{ id: 'target', kind: 'assistant_message', text: 'target wording' }] }]
    }
    const readPage = vi.fn(async ({ cursor }: { cursor?: string }) =>
      cursor === 'older' ? olderPage : { ...page, nextCursor: 'older' })
    const tool = createHistoryTool({ readPage, assertLease: () => undefined })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { itemId: 'target' } })

    expect(readPage).toHaveBeenNthCalledWith(1, { runtimeId: 'codex', threadId: 'own-session', limit: 20 })
    expect(readPage).toHaveBeenNthCalledWith(2, { runtimeId: 'codex', threadId: 'own-session', cursor: 'older', limit: 20 })
    expect(result.value).toMatchObject({
      pagesScanned: 2,
      pageCursor: 'older',
      nextCursor: 'oldest',
      items: [{ itemId: 'target', text: 'target wording' }]
    })
  })

  it('requires itemId and query to match the same item', async () => {
    const olderPage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: null,
      turns: [{ ...page.turns[0], items: [
        { id: 'other', kind: 'assistant_message', text: 'the desired query' },
        { id: 'target', kind: 'user_message', text: 'unrelated wording' }
      ] }]
    }
    const readPage = vi.fn(async ({ cursor }: { cursor?: string }) => cursor ? olderPage : { ...page, nextCursor: 'older' })
    const tool = createHistoryTool({ readPage, assertLease: () => undefined })
    const result = await tool.call({
      name: 'sciforge_read_history',
      context,
      arguments: { itemId: 'target', query: 'desired query' }
    })

    expect(result.value).toMatchObject({ pagesScanned: 2, items: [] })
  })

  it('returns the next item offset for continuation within a matching page', async () => {
    const matchingItems = Array.from({ length: 21 }, (_, index) => ({
      id: `match-${index}`,
      kind: 'user_message' as const,
      text: `matching detail ${index}`
    }))
    const matchingPage: AgentRuntimeThreadPage = {
      ...page,
      nextCursor: 'older',
      turns: [{ ...page.turns[0], items: matchingItems }]
    }
    const tool = createHistoryTool({ readPage: async () => matchingPage, assertLease: () => undefined })
    const result = await tool.call({ name: 'sciforge_read_history', context, arguments: { query: 'matching detail', itemOffset: 20 } })

    expect(result.value).toMatchObject({
      nextItemOffset: null,
      items: [{ itemId: 'match-20', text: 'matching detail 20' }]
    })
  })

  it('rejects a repeated durable history cursor instead of looping', async () => {
    const readPage = vi.fn(async ({ cursor }: { cursor?: string }) => ({
      ...page,
      nextCursor: cursor || 'loop'
    }))
    const tool = createHistoryTool({ readPage, assertLease: () => undefined })

    await expect(tool.call({ name: 'sciforge_read_history', context, arguments: { query: 'absent' } }))
      .rejects.toMatchObject({ code: 'history_cursor_loop' })
    expect(readPage).toHaveBeenCalledTimes(2)
  })

  it('rejects caller-selected sessions and expired principal leases before reading', async () => {
    const readPage = vi.fn(async () => page)
    const tool = createHistoryTool({ readPage, assertLease: () => { throw new Error('expired') } })
    await expect(tool.call({ name: 'sciforge_read_history', context, arguments: { threadId: 'other' } })).rejects.toThrow()
    await expect(tool.call({ name: 'sciforge_read_history', context, arguments: {} })).rejects.toThrow('expired')
    expect(readPage).not.toHaveBeenCalled()
  })
})
