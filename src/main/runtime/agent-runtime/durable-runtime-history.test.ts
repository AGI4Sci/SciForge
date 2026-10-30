import { it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { withDurableAgentRuntimeHistory } from './durable-runtime-history'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'

it('resolves the enrolled journal header for an exact thread identity and passes search through', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'durable-exact-thread-'))
  const context = {} as AgentRuntimeAdapterContext
  let releaseCaptureResolve!: () => void
  const releaseCapture = new Promise<void>(resolve => { releaseCaptureResolve = resolve })
  const listed = vi.fn(async () => [{
    runtimeId: 'dsh',
    id: 'other-thread',
    title: 'Other',
    updatedAt: new Date().toISOString(),
    workspace: '/workspace/other'
  }])
  const source = {
    id: 'dsh',
    transport: 'jsonrpc_stdio',
    startThread: async () => ({
      runtimeId: 'dsh',
      id: 'thread',
      title: 'test',
      updatedAt: new Date().toISOString(),
      workspace: '/workspace/enrolled'
    }),
    listThreads: listed,
    subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> { // eslint-disable-line require-yield -- this journal test never emits provider events
      await releaseCapture
    } }),
    close: async () => { releaseCaptureResolve() }
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  const adapter = withDurableAgentRuntimeHistory(source, root)
  try {
    await adapter.startThread(context, { runtimeId: 'dsh', workspace: '/workspace/enrolled' })
    // The provider omits sessions it currently holds open, so the durable
    // journal header is the exact identity authority the Host resolves against.
    await expect(adapter.listThreads(context, {
      runtimeId: 'dsh',
      threadId: 'thread'
    })).resolves.toEqual([
      expect.objectContaining({ id: 'thread', workspace: '/workspace/enrolled' })
    ])
    // A free-text query is not a thread identity filter: it reaches the provider.
    await expect(adapter.listThreads(context, {
      runtimeId: 'dsh',
      search: 'thread'
    })).resolves.toEqual([expect.objectContaining({ id: 'other-thread' })])
    expect(listed).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ search: 'thread' })
    )
  } finally {
    await adapter.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('capture loss interrupts the active turn and fences history after a cold reopen', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'durable-capture-loss-'))
  const context = {} as AgentRuntimeAdapterContext
  let loseCapture!: () => void

  const captureLost = new Promise<void>(resolve => { loseCapture = resolve })
  const interrupted = vi.fn(async () => {})
  const dispatch = vi.fn(async (ctx: AgentRuntimeAdapterContext) => {
    const handle = { runtimeId: 'dsh', threadId: 'thread', turnId: 'turn' }
    await ctx.onTurnAccepted?.(handle)
    return handle
  })
  // Controlled live-only transport: fail only after the turn is durably accepted.
  const source = {
    id: 'dsh', transport: 'jsonrpc_stdio',
    startThread: async () => ({ runtimeId: 'dsh', id: 'thread', title: 'test', updatedAt: new Date().toISOString() }),
    startTurn: dispatch, interruptTurn: interrupted,
    subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> { // eslint-disable-line require-yield -- always throws after acceptance; never yields by design
      await captureLost
      throw new Error('runtime_event_queue_overflow')
    } }),
    close: async () => { loseCapture() }
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  const adapter = withDurableAgentRuntimeHistory(source, root)
  try {
    await adapter.startThread(context, { runtimeId: 'dsh' })
    await adapter.startTurn(context, { runtimeId: 'dsh', threadId: 'thread', text: 'input' })
    const observed = (async () => {
      for await (const _event of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: 'thread' })) { /* drain */ }
    })().then(() => undefined, error => error)
    loseCapture()
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledOnce())
    expect(await observed).toMatchObject({ message: 'runtime_event_queue_overflow' })
    await expect(adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: 'thread' })).rejects.toThrow('runtime_event_queue_overflow')
    await expect(adapter.startTurn(context, { runtimeId: 'dsh', threadId: 'thread', text: 'blocked' })).rejects.toThrow()
    expect(dispatch).toHaveBeenCalledOnce()
    await adapter.close()
    const reopened = withDurableAgentRuntimeHistory(source, root)
    try {
      await expect(reopened.readThreadPage(context, { runtimeId: 'dsh', threadId: 'thread' })).rejects.toThrow('runtime_history_capture_failed')
      await expect(reopened.startTurn(context, { runtimeId: 'dsh', threadId: 'thread', text: 'also blocked after restart' })).rejects.toThrow('runtime_history_capture_failed')
      expect(dispatch).toHaveBeenCalledOnce()
    } finally { await reopened.close() }
  } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
})


it('persists complete tool output and retrieves it through a bounded page artifact after restart', async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'durable-tool-artifact-'))
  const context = {} as AgentRuntimeAdapterContext
  const detail = JSON.stringify({ source: '报告😀'.repeat(10000), tail: 'recoverable' })
  const source = {
    id: 'dsh', transport: 'jsonrpc_stdio',
    startThread: async () => ({ runtimeId: 'dsh', id: 'thread', title: 'test', updatedAt: new Date().toISOString() }),
    subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> {
      yield { kind: 'item_snapshot', runtimeId: 'dsh', threadId: 'thread', turnId: 'turn',
        item: { id: 'tool', kind: 'tool', detail, status: 'completed' } }
    } }),
    close: async () => undefined
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  const adapter = withDurableAgentRuntimeHistory(source, root)
  try {
    await adapter.startThread(context, { runtimeId: 'dsh' })
    await adapter.close()
    const reopened = withDurableAgentRuntimeHistory(source, root)
    try {
      const page = await reopened.readThreadPage(context, { runtimeId: 'dsh', threadId: 'thread' })
      const item = page.turns[0]?.items?.[0]
      expect(item?.detail!.length).toBeLessThan(5000)
      expect(item?.detailArtifact).toBeTruthy()
      const artifact = await reopened.readToolArtifact(context, item!.detailArtifact!)
      expect(artifact.content).toBe(detail)
      expect(artifact.size).toBe(Buffer.byteLength(detail, 'utf8'))
      await expect(reopened.readToolArtifact(context, { ...item!.detailArtifact!, threadId: 'another-thread' })).rejects.toThrow()
      await expect(reopened.readToolArtifact(context, { ...item!.detailArtifact!, runtimeId: 'codex' })).rejects.toThrow('runtime_mismatch')
    } finally { await reopened.close() }
  } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
})
