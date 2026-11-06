import { it, expect, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { withDurableAgentRuntimeHistory } from './durable-runtime-history'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import type { AgentRuntimeEvent, AgentRuntimeThread } from '../../../shared/agent-runtime-contract'

it('discovers real Host journals omitted while held and after reopen, with live identity precedence and governed limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-discovery-'))
  const context = {} as AgentRuntimeAdapterContext
  const locator = { contractVersion: 1 as const, hostSessionId: 'workspace-host', path: '/workspace/project' }
  const row = (id: string, extra: Partial<AgentRuntimeThread> = {}): AgentRuntimeThread => ({
    runtimeId: 'pi', id, title: id, updatedAt: '2026-10-22T00:00:00Z', workspace: locator.path, workspaceLocator: locator, ...extra
  })
  const enrolled = [row('held', { title: 'Actual journal title', updatedAt: '2026-10-24T00:00:00Z' }),
    row('duplicate'), row('archived', { archived: true }), row('side', { relation: 'side' }),
    row('hidden', { sidebarVisibility: 'hidden' }), row('child', { parentThreadId: 'held' }),
    row('main', { relation: 'side', sidebarVisibility: 'main' }),
    row('other-workspace', { workspace: '/workspace/other', workspaceLocator: { ...locator, path: '/workspace/other' } }),
    row('other-host', { workspaceLocator: { ...locator, hostSessionId: 'another-host' } }), row('deleted')]
  const live = row('duplicate', { title: '', updatedAt: '2026-10-23T00:00:00Z', status: 'running' })
  const listed = vi.fn(async () => [live, live, row('provider-only'), row('wrong-runtime', { runtimeId: 'codex' })])
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const source = { id: 'pi', startThread: vi.fn(async () => enrolled.shift()!), listThreads: listed,
    deleteThread: async () => { release() },
    subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> { // eslint-disable-line require-yield -- held transport intentionally emits no updates
      await held
    } }), close: async () => { release() }
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  let adapter = withDurableAgentRuntimeHistory(source, root)
  try {
    const count = enrolled.length
    for (let index = 0; index < count; index++) await adapter.startThread(context, { runtimeId: 'pi' })
    const input = { runtimeId: 'pi' as const, workspaceLocator: locator }
    const discovered = await adapter.listThreads(context, input)
    expect(discovered.map(thread => thread.id)).toEqual(['held', 'duplicate', 'provider-only', 'main', 'deleted'])
    expect(discovered[0]).toEqual(row('held', { title: 'Actual journal title', updatedAt: '2026-10-24T00:00:00Z' }))
    expect(discovered[1]).toEqual(live) // No journal title or timestamp repairs a live row.
    expect(await adapter.listThreads(context, { ...input, limit: 2 })).toEqual(discovered.slice(0, 2))
    expect((await adapter.listThreads(context, { ...input, limit: 1.9 })).map(thread => thread.id)).toEqual(['held'])
    expect((await adapter.listThreads(context, { ...input, archivedOnly: true })).map(thread => thread.id)).toEqual(['archived'])
    expect((await adapter.listThreads(context, { ...input, includeArchived: true })).map(thread => thread.id)).toContain('archived')
    expect((await adapter.listThreads(context, { ...input, includeSide: true })).map(thread => thread.id)).toEqual(expect.arrayContaining(['side', 'hidden', 'child']))
    expect((await adapter.listThreads(context, { ...input, search: ' ACTUAL JOURNAL ' })).map(thread => thread.id)).toEqual(['held'])
    expect(await adapter.listThreads(context, { ...input, search: 'held' })).toEqual([]) // Search is metadata, not identity.
    await expect(adapter.listThreads(context, { runtimeId: 'codex' })).rejects.toThrow('runtime_mismatch')
    await adapter.deleteThread(context, { runtimeId: 'pi', threadId: 'deleted' })
    await adapter.close()
    adapter = withDurableAgentRuntimeHistory(source, root)
    expect((await adapter.listThreads(context, input)).map(thread => thread.id)).toEqual(['held', 'duplicate', 'provider-only', 'main'])
    const routeFailure = new Error('runtime_model_route_invalid')
    listed.mockRejectedValueOnce(routeFailure)
    await expect(adapter.listThreads(context, input)).rejects.toBe(routeFailure)
    expect(listed).toHaveBeenCalledWith(context, expect.objectContaining({ workspaceLocator: locator, limit: 2 }))
  } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
})

it('resolves the enrolled journal header for an exact thread identity and passes search through', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-exact-thread-'))
  const context = {} as AgentRuntimeAdapterContext
  const enrolledAt = '2098-01-01T00:00:00.000Z'
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
      updatedAt: enrolledAt,
      workspace: '/workspace/enrolled'
    }),
    listThreads: listed,
    subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> { // eslint-disable-line require-yield -- this journal test never emits provider events
      await releaseCapture
    } }),
    close: async () => { releaseCaptureResolve() }
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  let adapter = withDurableAgentRuntimeHistory(source, root)
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
      search: 'other'
    })).resolves.toEqual([expect.objectContaining({ id: 'other-thread' })])
    expect(listed).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ search: 'other' })
    )
    // Omitted sessions recover from durable history after process rotation.
    await adapter.publishSyntheticEvent!(context, { runtimeId: 'dsh', threadId: 'thread', kind: 'user_message',
      turnId: 'turn', itemId: 'user', text: 'saved input', createdAt: '2099-01-01T00:00:00.000Z' })
    await adapter.close()
    adapter = withDurableAgentRuntimeHistory(source, root)
    await expect(adapter.listThreads(context, { runtimeId: 'dsh' })).resolves.toEqual([
      expect.objectContaining({ id: 'thread', title: 'test', workspace: '/workspace/enrolled', updatedAt: enrolledAt }),
      expect.objectContaining({ id: 'other-thread' })
    ])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', search: 'TEST' }))
      .resolves.toEqual([expect.objectContaining({ id: 'thread' })])
    expect(listed).toHaveBeenCalledWith(context, expect.objectContaining({ search: 'TEST' }))
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', search: 'missing' })).resolves.toEqual([])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', limit: 1 }))
      .resolves.toEqual([expect.objectContaining({ id: 'thread' })])
    // Provider summaries remain authoritative when a session is listed live.
    const live = { id: 'thread', runtimeId: 'dsh', title: 'DSH', workspace: '/wrong', updatedAt: '2100-01-01T00:00:00.000Z' }
    listed.mockResolvedValueOnce([live])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh' })).resolves.toEqual([live])
  } finally {
    await adapter.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('capture loss interrupts the active turn and fences history after a cold reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-capture-loss-'))
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


it('isolates persisted capture failure from healthy discovery without resurrecting tombstones after cold reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-directory-capture-loss-'))
  const context = {} as AgentRuntimeAdapterContext
  const rows = [
    { runtimeId: 'dsh' as const, id: 'failed-A', title: 'Failed', workspace: '/workspace/A', updatedAt: '2026-01-04T00:00:00.000Z' },
    { runtimeId: 'dsh' as const, id: 'healthy-B', title: 'Healthy discovery', workspace: '/workspace/B', updatedAt: '2026-01-03T00:00:00.000Z' },
    { runtimeId: 'dsh' as const, id: 'archived-B', title: 'Archived discovery', workspace: '/workspace/B', updatedAt: '2026-01-02T00:00:00.000Z', archived: true },
    { runtimeId: 'dsh' as const, id: 'removed-B', title: 'Removed discovery', workspace: '/workspace/B', updatedAt: '2026-01-05T00:00:00.000Z' }
  ].map(row => ({ ...row, workspaceLocator: { contractVersion: 1 as const, hostSessionId: 'local', path: row.workspace } }))
  const dispatch = vi.fn()
  const source = {
    id: 'dsh', transport: 'jsonrpc_stdio',
    startThread: async (_context: AgentRuntimeAdapterContext, input: { title?: string }) => rows.find(row => row.title === input.title)!,
    // Deliberately return stale failed/deleted metadata, and omit the healthy
    // enrolled thread: its discovery must come from the durable directory.
    listThreads: vi.fn(async () => [rows[0], rows[3]]),
    startTurn: dispatch, deleteThread: vi.fn(async () => {}),
    subscribeEvents: (_context: AgentRuntimeAdapterContext, input: { threadId: string }) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> { // eslint-disable-line require-yield -- exercise actual capture rejection rather than writing a fake fence
        if (input.threadId === 'failed-A') throw new Error('runtime_event_queue_overflow')
      }
    }),
    close: async () => {}
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  let adapter = withDurableAgentRuntimeHistory(source, root)
  const workspaceLocator = { contractVersion: 1 as const, hostSessionId: 'local', path: '/workspace/B' }
  try {
    for (const row of rows) await adapter.startThread(context, { runtimeId: 'dsh', title: row.title, workspace: row.workspace })
    await adapter.close() // joins the capture task and fsynced loss fence
    const journals = await readdir(root)
    const persisted = await Promise.all(journals.filter(name => name.endsWith('.jsonl')).map(name => readFile(join(root, name), 'utf8')))
    expect(persisted.some(text => text.split('\n').filter(Boolean).some(line => {
      const record = JSON.parse(line)
      return record.threadId === 'failed-A' && record.captureFailure === true && record.seq === 1
    }))).toBe(true)
    await adapter.deleteThread(context, { runtimeId: 'dsh', threadId: 'removed-B' })
    adapter = withDurableAgentRuntimeHistory(source, root)
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', workspaceLocator })).resolves.toEqual([rows[1]])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', includeArchived: true })).resolves.toEqual([rows[1], rows[2]])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', workspaceLocator, search: 'DISCOVERY', includeArchived: true, limit: 1 })).resolves.toEqual([rows[1]])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', workspaceLocator, archivedOnly: true })).resolves.toEqual([rows[2]])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', workspaceLocator, search: 'missing' })).resolves.toEqual([])
    // The upstream discovery contract only applies positive finite limits.
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(adapter.listThreads(context, { runtimeId: 'dsh', workspaceLocator, limit })).resolves.toEqual([rows[1]])
    }
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', threadId: 'failed-A' })).resolves.toEqual([])
    await expect(adapter.listThreads(context, { runtimeId: 'dsh', threadId: 'removed-B' })).resolves.toEqual([])
    await expect(adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: 'failed-A' })).rejects.toThrow('runtime_history_capture_failed')
    await expect(adapter.readThreadStatus(context, { runtimeId: 'dsh', threadId: 'failed-A' })).rejects.toThrow('runtime_history_capture_failed')
    await expect(adapter.startTurn(context, { runtimeId: 'dsh', threadId: 'failed-A', text: 'blocked' })).rejects.toThrow('runtime_history_capture_failed')
    expect(dispatch).not.toHaveBeenCalled()
    await expect(adapter.readToolArtifact(context, {
      runtimeId: 'dsh', threadId: 'failed-A', size: 0, ref: Buffer.from(JSON.stringify({ v: 1, itemId: 'tool' })).toString('base64url')
    })).rejects.toThrow('runtime_history_capture_failed')
    for (const sinceSeq of [0, undefined]) {
      const controller = new AbortController()
      const iterator = adapter.subscribeEvents(context, {
        runtimeId: 'dsh', threadId: 'failed-A', sinceSeq, signal: controller.signal
      })[Symbol.asyncIterator]()
      const next = iterator.next()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        // Bound the regression: a missing cold fence otherwise silently waits
        // forever for a live event. Abort in finally releases that listener.
        await expect(Promise.race([next, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('subscription_did_not_reject_capture_failure')), 250)
        })])).rejects.toThrow('runtime_history_capture_failed')
      } finally {
        clearTimeout(timeout)
        controller.abort()
        await next.catch(() => {})
        await iterator.return?.()
      }
    }
    await expect(adapter.readThreadStatus(context, { runtimeId: 'dsh', threadId: 'removed-B' })).rejects.toThrow('runtime_thread_not_found')
    await expect(adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: 'healthy-B' })).resolves.toMatchObject({ turns: [], latestSeq: 0 })
  } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
})

it('does not suppress corrupt journal tails during directory discovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-directory-corrupt-'))
  const context = {} as AgentRuntimeAdapterContext
  const source = {
    id: 'dsh', startThread: async () => ({ runtimeId: 'dsh', id: 'thread', title: 'test', updatedAt: '2026-01-01T00:00:00.000Z' }),
    listThreads: async () => [],
    subscribeEvents: () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<AgentRuntimeEvent> {
    } }), close: async () => {}
  } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  let adapter = withDurableAgentRuntimeHistory(source, root)
  try {
    await adapter.startThread(context, { runtimeId: 'dsh' })
    await adapter.close()
    const [name] = await readdir(root)
    const path = join(root, name)
    const text = await readFile(path, 'utf8')
    await writeFile(path, text + JSON.stringify({ seq: -1, threadId: 'thread' }) + '\n')
    adapter = withDurableAgentRuntimeHistory(source, root)
    await expect(adapter.listThreads(context, { runtimeId: 'dsh' })).rejects.toThrow('runtime_history_corrupt')
  } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
})

it('persists complete tool output and retrieves it through a bounded page artifact after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-tool-artifact-'))
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

it('persists removal of provider-listed, unenrolled conversations without hiding other sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'durable-delete-listed-'))
  const context = {} as AgentRuntimeAdapterContext
  const rows = ['removed', 'kept'].map(id => ({ id, runtimeId: 'dsh', title: id, updatedAt: '2026-10-22T00:00:00Z' }))
  const source = { id: 'dsh', listThreads: vi.fn(async () => rows), deleteThread: vi.fn(async () => {}), close: async () => {} } as unknown as AgentRuntimeAdapter & { close(): Promise<void> }
  let adapter = withDurableAgentRuntimeHistory(source, root)
  const input = { runtimeId: 'dsh' as const, threadId: 'removed' }
  try {
    await adapter.deleteThread(context, input)
    expect(await adapter.listThreads(context, { runtimeId: 'dsh' })).toEqual([rows[1]])
    await adapter.close()
    adapter = withDurableAgentRuntimeHistory(source, root)
    expect(await adapter.listThreads(context, { runtimeId: 'dsh' })).toEqual([rows[1]])
    expect(await adapter.listThreads(context, input)).toEqual([])
    await expect(adapter.readThreadStatus(context, input)).rejects.toThrow('runtime_thread_not_found')
  } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
})
