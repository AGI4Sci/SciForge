import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import type { AgentRuntimeTurn } from '../shared/agent-runtime-contract'
import { createDomainAgentThreadsHost } from './domain-agent-threads'

const workspace = resolve('fixtures/history workspace')
const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: workspace }
const thread = { id: scope.threadId, runtimeId: 'codex' as const, workspace, title: 'History', updatedAt: '2026-11-04T00:00:00Z' }
const turn: AgentRuntimeTurn = { id: 'turn-old', threadId: scope.threadId, status: 'completed', items: [
  { id: 'user-old', kind: 'user_message', text: 'original question' },
  { id: 'tool-old', kind: 'tool', text: 'original result', status: 'failed' },
  { id: 'reasoning-old', kind: 'reasoning', text: 'hidden internal text' },
  { id: 'compact-old', kind: 'compaction', text: 'opaque provider data', summary: 'opaque summary' },
  { id: 'assistant-old', kind: 'assistant_message', text: 'visible final answer' }
] }
function runtime() {
  return { listThreads: vi.fn(async () => [thread]), readThreadMetadata: vi.fn(async () => thread),
    readThreadSnapshot: vi.fn(async () => ({ ...thread, latestSeq: 100, turns: [turn] })),
    readThreadPage: vi.fn(async () => ({ runtimeId: 'codex' as const, threadId: scope.threadId, latestSeq: 100, turns: [turn], nextCursor: 'older-page' as string | null })),
    subscribeEvents: vi.fn(async function* () {}), hasActiveTurns: () => false }
}

describe('domain agent threads bounded history', () => {
  it('reads exact metadata without hydrating the transcript', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    expect(await api.readMetadata!(scope)).toEqual({ id: scope.threadId, runtimeId: 'codex', workspaceRoot: workspace })
    expect(host.readThreadSnapshot).not.toHaveBeenCalled(); expect(host.readThreadPage).not.toHaveBeenCalled()
  })
  it('forwards an opaque page cursor and keeps exact visible sources without hidden payloads', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    const result = await api.readPage!({ ...scope, cursor: 'current-page', limit: 20 })
    expect(host.readThreadPage).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: scope.threadId, cursor: 'current-page', limit: 20 })
    expect(result.nextCursor).toBe('older-page'); expect(result.watermark).toBe('100')
    expect(result.artifacts).toContainEqual(turn.items![1])
    expect(result.artifacts).toContainEqual({ id: 'compact-old', kind: 'compaction' })
    expect(JSON.stringify(result)).not.toMatch(/hidden internal|opaque provider|opaque summary/)
    expect(result.turns[0].messages.map(m => m.itemId)).toEqual(['user-old', 'assistant-old'])
    expect(host.readThreadMetadata).toHaveBeenCalledTimes(2); expect(host.readThreadSnapshot).not.toHaveBeenCalled()
  })
  it('rejects foreign and unknown workspaces before querying history', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    await expect(api.readPage!({ ...scope, workspaceRoot: resolve('foreign') })).rejects.toThrow('workspace')
    host.readThreadMetadata.mockResolvedValue({ ...thread, workspace: '' })
    await expect(api.readPage!(scope)).rejects.toThrow('workspace')
    expect(host.readThreadPage).not.toHaveBeenCalled()
  })
  it('rechecks workspace ownership after an asynchronous read', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    host.readThreadMetadata.mockResolvedValueOnce(thread).mockResolvedValueOnce({ ...thread, workspace: resolve('foreign') })
    await expect(api.readPage!(scope)).rejects.toThrow('workspace')
  })
  it('rejects a provider response for another session and repeated cursors', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    host.readThreadPage.mockResolvedValueOnce({ runtimeId: 'codex', threadId: 'foreign', latestSeq: 100, turns: [], nextCursor: null })
    await expect(api.readPage!(scope)).rejects.toThrow('identity')
    await expect(api.readPage!({ ...scope, cursor: 'older-page' })).rejects.toThrow('repeated')
  })
  it('bounds inputs and preserves rejection without a snapshot fallback', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    for (const limit of [0, 101, 1.5, NaN]) await expect(api.readPage!({ ...scope, limit })).rejects.toThrow('limit')
    await expect(api.readPage!({ ...scope, cursor: 'x'.repeat(4097) })).rejects.toThrow('cursor')
    host.readThreadPage.mockRejectedValue(new Error('access revoked'))
    await expect(api.readPage!(scope)).rejects.toThrow('access revoked')
    expect(host.readThreadSnapshot).not.toHaveBeenCalled()
  })
  it('uses the same visible projection for whole reads and keeps list filters', async () => {
    const host = runtime(), api = createDomainAgentThreadsHost(host)
    await api.list({ includeArchived: true, includeSide: false })
    expect(host.listThreads).toHaveBeenCalledWith({ includeArchived: true, includeSide: false })
    expect((await api.read(scope)).artifacts).toEqual((await api.readPage!(scope)).artifacts)
  })
})
