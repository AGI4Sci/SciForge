import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import type { AgentRuntimeEvent, AgentRuntimeThread, AgentRuntimeThreadPage, AgentRuntimeTurn } from '../../../shared/agent-runtime-contract'
import { AppDataJsonlStore } from '../../services/app-data-store'
import { readJsonlThreadPage, readLatestJsonlThreadRecord, decodeToolArtifactRef, externalizeToolDetails, toolArtifactContent } from './jsonl-thread-page'

type Record = { seq: number; threadId: string; thread?: AgentRuntimeThread; event?: AgentRuntimeEvent; captureFailure?: true }

/** Host transcript for transports with live updates but no history-read RPC.
 * Only threads created through this owner are enrolled: a missing journal is
 * NOT evidence of empty provider history. Provider resume is not history replay.
 */
export function withDurableAgentRuntimeHistory<T extends AgentRuntimeAdapter & { close(): Promise<void> }>(adapter: T, rootDir: string): T {
  const stores = new Map<string, AppDataJsonlStore>()
  const headers = new Map<string, AgentRuntimeThread>()
  const lanes = new Map<string, Promise<unknown>>()
  const captures = new Map<string, Promise<void>>()
  const failures = new Map<string, unknown>()
  const activeTurns = new Map<string, string>()
  const listeners = new Set<{ threadId: string; push(event: AgentRuntimeEvent): void; stop(): void }>()
  const store = (threadId: string): AppDataJsonlStore => {
    let result = stores.get(threadId)
    if (!result) {
      result = new AppDataJsonlStore({ rootDir, segments: [createHash('sha256').update(JSON.stringify([adapter.id, threadId])).digest('hex') + '.jsonl'] })
      stores.set(threadId, result)
    }
    return result
  }
  const persist = async (record: Record): Promise<void> => {
    const journal = store(record.threadId)
    await journal.appendJson([record])
    const path = await journal.path() // validates the app-data owner path, including symlink confinement
    const handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
    try { await handle.sync() } finally { await handle.close() }
    if (record.seq === 0) {
      for (const directory of [dirname(path), dirname(dirname(path))]) {
        const dir = await open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        try { await dir.sync() } finally { await dir.close() }
      }
    }
  }
  const parse = (line: string): Record => {
    const record = JSON.parse(line) as Record
    if (!Number.isSafeInteger(record.seq) || record.seq < 0 || typeof record.threadId !== 'string') throw new Error('runtime_history_corrupt')
    if (record.captureFailure) throw new Error('runtime_history_capture_failed')
    return record
  }
  const check = (input: { runtimeId?: string; threadId: string }): void => {
    if (input.runtimeId && input.runtimeId !== adapter.id) throw new Error('runtime_mismatch')
    if (failures.has(input.threadId)) throw failures.get(input.threadId)
  }
  const header = async (threadId: string): Promise<AgentRuntimeThread> => {
    const cached = headers.get(threadId)
    if (cached) return structuredClone(cached)
    let first: Record | undefined
    await store(threadId).readLines(line => { if (!first) first = parse(line) })
    if (!first?.thread || first.seq !== 0 || first.threadId !== threadId || first.thread.id !== threadId || first.thread.runtimeId !== adapter.id) throw new Error('runtime_history_not_enrolled')
    headers.set(threadId, first.thread)
    return structuredClone(first.thread)
  }
  const append = (event: AgentRuntimeEvent): Promise<AgentRuntimeEvent> => {
    const threadId = event.threadId
    const run = (lanes.get(threadId) ?? Promise.resolve()).then(async () => {
      check({ runtimeId: event.runtimeId, threadId })
      await header(threadId)
      const latest = await readLatestJsonlThreadRecord({ store: store(threadId), threadId, parse })
      const stored = { ...event, seq: (latest?.seq ?? 0) + 1 }
      await persist({ seq: stored.seq, threadId, event: stored })
      if (stored.kind === 'turn_lifecycle' && ['completed', 'failed', 'interrupted', 'cancelled'].includes(stored.state)) activeTurns.delete(threadId)
      for (const listener of listeners) if (listener.threadId === threadId) listener.push(structuredClone(stored))
      return stored
    })
    lanes.set(threadId, run)
    return run
  }
  const capture = (context: AgentRuntimeAdapterContext, threadId: string): void => {
    if (captures.has(threadId)) return
    // Acquire the live subscription eagerly, before the first provider prompt.
    const source = adapter.subscribeEvents(context, { runtimeId: adapter.id, threadId })
    const task = (async () => {
      try { for await (const event of source) await append(event) }
      catch (error) {
        failures.set(threadId, error)
        // Persist the loss fence before interrupting. A cold owner must not
        // mistake a valid but incomplete prefix for a complete transcript.
        try {
          await lanes.get(threadId)?.catch(() => {})
          const tail = await readLatestJsonlThreadRecord({ store: store(threadId), threadId, parse })
          await persist({ seq: (tail?.seq ?? 0) + 1, threadId, captureFailure: true })
        } catch { /* original capture failure remains authoritative; corrupt journals already reject reads */ }
        // A lost durable transcript fences the next turn and terminates current
        // execution; never silently substitute an empty/partial success page.
        const turnId = activeTurns.get(threadId)
        if (turnId) try { await adapter.interruptTurn(context, { runtimeId: adapter.id, threadId, turnId }) } catch { /* original capture failure remains authoritative */ }
      } finally {
        captures.delete(threadId)
        for (const listener of [...listeners]) if (listener.threadId === threadId) listener.stop()
      }
    })()
    captures.set(threadId, task)
  }
  const latest = async (threadId: string): Promise<Record> => {
    await lanes.get(threadId)
    check({ threadId })
    await header(threadId)
    return (await readLatestJsonlThreadRecord({ store: store(threadId), threadId, parse }))!
  }
  return {
    ...adapter,
    async capabilities(context) {
      const capabilities = await adapter.capabilities(context)
      // Replay is supplied by this Host journal, not the underlying ACP transport.
      return { ...capabilities, events: { ...capabilities.events, replayable: true } }
    },
    async startThread(context, input) {
      const thread = await adapter.startThread(context, input)
      // Never enroll a provider-returned existing id over an existing journal.
      try { await header(thread.id); throw new Error('runtime_history_already_enrolled') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await persist({ seq: 0, threadId: thread.id, thread })
      capture(context, thread.id)
      return thread
    },
    async listThreads(context, input) {
      // The Host asks for one exact durable thread by identity; the journal
      // header is the authority for it because the provider omits sessions it
      // currently holds open. `search` stays a free-text query for the caller.
      const exactThreadId = input.threadId?.trim()
      if (exactThreadId) {
        try { return [await header(exactThreadId)] }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      return adapter.listThreads(context, input)
    },
    async readThreadStatus(_context, input) {
      check(input)
      const record = await latest(input.threadId)
      let terminal: AgentRuntimeEvent | undefined
      await store(input.threadId).readLinesReverse(line => {
        const event = parse(line).event
        if (event?.kind === 'turn_lifecycle') { terminal = event; return false }
      })
      return { id: input.threadId, runtimeId: adapter.id, latestSeq: record.seq,
        status: terminal?.kind === 'turn_lifecycle' && ['running', 'queued'].includes(terminal.state) ? 'running' : 'idle',
        ...(terminal?.kind === 'turn_lifecycle' ? { latestTurnId: terminal.turnId, latestTurnStatus: terminal.state } : {}) }
    },
    async readThreadPage(_context, input): Promise<AgentRuntimeThreadPage> {
      check(input)
      const end = await latest(input.threadId)
      const page = await readJsonlThreadPage({ store: store(input.threadId), threadId: input.threadId,
        cursor: input.cursor, limit: input.limit, parse, turnId: record => record.event?.turnId })
      return { runtimeId: adapter.id, threadId: input.threadId, latestSeq: end.seq,
        turns: projectTurns(page.records).map(turn => ({ ...turn, items: externalizeToolDetails({
          runtimeId: adapter.id, threadId: input.threadId, items: turn.items ?? []
        }) })), nextCursor: page.nextCursor }
    },
    async readToolArtifact(_context, input) {
      check(input)
      await latest(input.threadId)
      const itemId = decodeToolArtifactRef(input.ref)
      let content: string | null = null
      await store(input.threadId).readLinesReverse(line => {
        const record = parse(line)
        if (record.threadId !== input.threadId) return
        const event = record.event
        if (event?.kind === 'item_snapshot' && event.item.kind === 'tool' && event.item.id === itemId) {
          content = toolArtifactContent(event.item.detail, event.item.meta)
        } else if (event?.kind === 'tool_event' && event.itemId === itemId) {
          content = toolArtifactContent(event.detail, event.meta, event.receipt?.output)
        }
        if (content !== null) return false
      })
      if (content === null) throw Object.assign(new Error('Tool artifact was not found.'), { code: 'not_found' })
      return { runtimeId: adapter.id, threadId: input.threadId, ref: input.ref,
        size: Buffer.byteLength(content, 'utf8'), content }
    },
    async startTurn(context, input) {
      check(input)
      await latest(input.threadId)
      capture(context, input.threadId)
      let accepted = false
      return adapter.startTurn({ ...context, onTurnAccepted: async handle => {
        if (!accepted) {
          accepted = true
          activeTurns.set(handle.threadId, handle.turnId)
          await append({ runtimeId: adapter.id, threadId: handle.threadId, turnId: handle.turnId,
            kind: 'user_message', itemId: handle.userMessageItemId ?? `${handle.turnId}:user`, text: input.displayText ?? input.text ?? '',
            createdAt: new Date().toISOString(), principal: context.principal, principalContext: context.principalContext })
        }
        await context.onTurnAccepted?.(handle)
      } }, input)
    },
    subscribeEvents(_context, input) {
      check(input)
      if (input.sinceSeq !== undefined && (!Number.isSafeInteger(input.sinceSeq) || input.sinceSeq < 0)) throw new Error('runtime_replay_cursor_invalid')
      const queue: AgentRuntimeEvent[] = []
      let done = false
      let wake: (() => void) | undefined
      const stop = (): void => { done = true; listeners.delete(listener); input.signal?.removeEventListener('abort', stop); wake?.() }
      const listener = { threadId: input.threadId, push: (event: AgentRuntimeEvent): void => { queue.push(event); wake?.() }, stop }
      listeners.add(listener)
      input.signal?.addEventListener('abort', stop, { once: true })
      if (input.signal?.aborted) stop()
      return { async *[Symbol.asyncIterator]() {
        try {
          // Register live delivery before taking the durable high-water mark.
          // Events racing with the replay occur in both sources; seq removes
          // that overlap without leaving a replay/live subscription gap.
          let delivered = input.sinceSeq
          if (delivered !== undefined) {
            const end = await latest(input.threadId)
            const replay: AgentRuntimeEvent[] = []
            await store(input.threadId).readLines(line => {
              const record = parse(line)
              if (record.event && record.seq > delivered! && record.seq <= end.seq) replay.push(record.event)
            })
            for (const event of replay) { if (input.signal?.aborted) return; yield structuredClone(event) }
            delivered = Math.max(delivered, end.seq)
          }
          while (!done || queue.length) {
            check(input)
            const event = queue.shift()
            if (!event) { await new Promise<void>(resolve => { wake = resolve }); continue }
            if (delivered !== undefined && event.seq! <= delivered) continue
            if (delivered !== undefined) delivered = event.seq!
            yield event
          }
          check(input)
        } finally { stop() }
      } }
    },
    async close() {
      await adapter.close()
      await Promise.all(captures.values())
      await Promise.all(lanes.values())
      for (const listener of [...listeners]) listener.stop()
    }
  }
}

function projectTurns(records: Record[]): AgentRuntimeTurn[] {
  const turns = new Map<string, AgentRuntimeTurn>()
  for (const { event } of records) {
    if (!event?.turnId) continue
    let turn = turns.get(event.turnId)
    if (!turn) { turn = { id: event.turnId, threadId: event.threadId, status: 'running', items: [] }; turns.set(turn.id, turn) }
    if (event.kind === 'turn_lifecycle') {
      turn.status = event.state
      if (event.state === 'running') turn.startedAt = event.createdAt
      else if (['completed', 'failed', 'interrupted'].includes(event.state)) turn.completedAt = event.createdAt
    } else if (event.kind === 'item_snapshot') {
      const index = turn.items!.findIndex(item => item.id === event.item.id)
      if (index < 0) turn.items!.push(event.item)
      else turn.items![index] = event.item
    } else if (['user_message', 'assistant_delta', 'reasoning_delta'].includes(event.kind)) {
      if (event.kind !== 'user_message' && event.kind !== 'assistant_delta' && event.kind !== 'reasoning_delta') continue
      let item = turn.items!.find(item => item.id === event.itemId)
      if (!item) { item = { id: event.itemId, turnId: turn.id, kind: event.kind === 'user_message' ? 'user_message' : event.kind === 'assistant_delta' ? 'assistant_message' : 'reasoning', text: '', createdAt: event.createdAt, principal: event.principal, principalContext: event.principalContext }; turn.items!.push(item) }
      item.text = (item.text ?? '') + event.text
    }
  }
  return [...turns.values()]
}
