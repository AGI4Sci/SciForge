import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveTraceId,
  LocalTraceStore,
  sanitizeTraceTextChunks,
  type TraceEvent,
  type TraceEventInput
} from '@sciforge/full-trace'
import type { AgentRuntimeEvent } from '../../shared/agent-runtime-contract'
import {
  AGENT_TRACE_STALE_TURN_MS,
  AGENT_TRACE_TURN_BUFFER_MAX_BYTES,
  AGENT_TRACE_TURN_BUFFER_MAX_EVENTS,
  AgentRuntimeTraceRecorder,
  normalizeAgentTraceEventKind
} from './agent-runtime-trace-service'

type AgentTracePayload = TraceEventInput<'agent_event'>['payload']

describe('AgentRuntimeTraceRecorder', () => {
  it('appends runtime events with stable turn correlation and the complete raw event', async () => {
    const { recorder, append } = fakeRecorder()
    const event = {
      kind: 'tool_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      status: 'running',
      toolName: 'read_file',
      meta: { arguments: { path: 'README.md' } },
      createdAt: '2026-07-19T10:00:00.000Z'
    } satisfies AgentRuntimeEvent

    await recorder.observeEvent('dsh', event)
    await recorder.flushTurn('codex', 'thread-1', 'turn-1')

    expect(append).toHaveBeenCalledWith({
      traceId: deriveTraceId({ runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1' }),
      source: 'agent-runtime',
      kind: 'agent_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      payload: {
        eventKind: 'tool',
        event
      }
    })
  })

  it('uses the adapter owner when an event omits runtimeId', async () => {
    const { recorder, append } = fakeRecorder()
    const event = {
      kind: 'heartbeat',
      threadId: 'thread-1'
    } satisfies AgentRuntimeEvent

    await recorder.observeEvent('claude', event)

    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      traceId: deriveTraceId({ runtimeId: 'claude', threadId: 'thread-1' }),
      runtimeId: 'claude',
      payload: { eventKind: 'lifecycle', event }
    }))
  })

  it('normalizes the complete runtime event surface without provider branches', () => {
    const base = { runtimeId: 'dsh' as const, threadId: 'thread-1', turnId: 'turn-1' }
    const cases: Array<[AgentRuntimeEvent, ReturnType<typeof normalizeAgentTraceEventKind>]> = [
      [{ ...base, kind: 'assistant_delta', itemId: 'a', text: 'hello' }, 'assistant'],
      [{ ...base, kind: 'reasoning_delta', itemId: 'r', text: 'why', visibility: 'summary' }, 'reasoning'],
      [{ ...base, kind: 'approval_requested', approvalId: 'approval-1', summary: 'Run?' }, 'approval'],
      [{ ...base, kind: 'usage', usage: { totalTokens: 12 } }, 'usage'],
      [{ ...base, kind: 'error', recoverable: false, severity: 'error', message: 'failed' }, 'error'],
      [{ ...base, kind: 'turn_lifecycle', state: 'completed' }, 'lifecycle']
    ]

    for (const [event, expected] of cases) {
      expect(normalizeAgentTraceEventKind(event)).toBe(expected)
    }
  })

  it('preserves identical consecutive delta chunks as distinct observed events', async () => {
    const { recorder, append } = fakeRecorder()
    const event = {
      kind: 'assistant_delta',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      seq: 8,
      text: 'same event'
    } satisfies AgentRuntimeEvent

    await recorder.observeEvent('codex', event)
    await recorder.observeEvent('codex', structuredClone(event))
    await recorder.flushTurn('codex', 'thread-1', 'turn-1')

    expect(append).toHaveBeenCalledTimes(2)
  })

  it('persists tools, approvals, usage, errors, and lifecycle before buffered deltas flush', async () => {
    const { recorder, append, appendMany } = fakeRecorder()
    const base = {
      runtimeId: 'codex' as const,
      threadId: 'thread-1',
      turnId: 'turn-1'
    }
    await recorder.observeEvent('codex', {
      ...base,
      kind: 'assistant_delta',
      itemId: 'assistant-1',
      text: 'buffered text'
    })
    await recorder.observeEvent('codex', {
      ...base,
      kind: 'tool_event',
      itemId: 'tool-1',
      status: 'running',
      toolName: 'read_file'
    })
    await recorder.observeEvent('codex', {
      ...base,
      kind: 'approval_requested',
      approvalId: 'approval-1',
      summary: 'Allow read?'
    })
    await recorder.observeEvent('codex', {
      ...base,
      kind: 'usage',
      usage: { totalTokens: 12 }
    })
    await recorder.observeEvent('codex', {
      ...base,
      kind: 'error',
      recoverable: true,
      severity: 'warning',
      message: 'temporary error'
    })
    await recorder.observeEvent('codex', {
      ...base,
      kind: 'turn_lifecycle',
      state: 'completed'
    })

    expect(appendMany).not.toHaveBeenCalled()
    expect(append.mock.calls.map(([input]) => input.payload.eventKind)).toEqual([
      'tool',
      'approval',
      'usage',
      'error',
      'lifecycle'
    ])

    await recorder.flushTurn('codex', 'thread-1', 'turn-1')
    expect(appendMany).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledTimes(6)
  })

  it('uses the store-wide current-secret filter when Agent text echoes an arbitrary API key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-full-trace-'))
    const apiKey = 'tenant-credential-without-a-known-prefix'
    try {
      const store = new LocalTraceStore({
        storageDirectory: directory,
        sensitiveValues: () => [apiKey]
      })
      const recorder = new AgentRuntimeTraceRecorder(store)
      await recorder.observeEvent('dsh', {
        kind: 'assistant_delta',
        runtimeId: 'dsh',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        text: `The credential was ${apiKey}`
      })
      await recorder.observeEvent('dsh', {
        kind: 'tool_event',
        runtimeId: 'dsh',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'tool-1',
        status: 'running',
        toolName: 'diagnostic',
        meta: { output: `tool echoed ${apiKey}` }
      })
      await recorder.observeEvent('dsh', {
        kind: 'error',
        runtimeId: 'dsh',
        threadId: 'thread-1',
        turnId: 'turn-1',
        recoverable: false,
        severity: 'error',
        message: `upstream rejected ${apiKey}`
      })
      await recorder.flushTurn('dsh', 'thread-1', 'turn-1')

      const serialized = JSON.stringify(await store.read())
      expect(serialized).not.toContain(apiKey)
      expect(serialized).toContain('[REDACTED]')
      expect((await store.read()).events).toHaveLength(3)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('removes a cross-kind/item split secret, preserves similar text, and keeps observed order', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'agent-split-secret-'))
    const destination = join(userDataDirectory, '..', `agent-trace-${Date.now()}.jsonl`)
    const apiKey = 'tenant-credential-opaque-value'
    try {
      const store = new LocalTraceStore({
        userDataDirectory,
        sensitiveValues: () => [apiKey]
      })
      const recorder = new AgentRuntimeTraceRecorder(store)
      const base = {
        runtimeId: 'codex' as const,
        threadId: 'thread-1',
        turnId: 'turn-1'
      }
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'assistant_delta',
        itemId: 'assistant-1',
        seq: 1,
        text: 'answer tenant-credential-'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'reasoning_delta',
        itemId: 'reasoning-cross-boundary',
        seq: 2,
        visibility: 'summary',
        text: 'opaque-value remains hidden'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'assistant_delta',
        itemId: 'assistant-similar-text',
        seq: 3,
        text: 'ordinary tenant-credential-'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'reasoning_delta',
        itemId: 'reasoning-1',
        seq: 4,
        visibility: 'summary',
        text: 'similar-value remains readable'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'tool_event',
        itemId: 'tool-1',
        seq: 5,
        status: 'running',
        toolName: 'read_file',
        meta: { output: 'tool output remains complete' }
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'turn_lifecycle',
        seq: 6,
        state: 'completed'
      })
      await recorder.flushTurn('codex', 'thread-1', 'turn-1')

      const result = await store.read({ order: 'asc' })
      const payloads = result.events.map(agentTracePayload)
      const deltaText = joinedDeltaText(payloads)
      expect(deltaText).not.toContain(apiKey)
      expect(deltaText).toBe(
        'answer [REDACTED] remains hiddenordinary tenant-credential-similar-value remains readable'
      )
      expect(payloads.map((payload) => payload.eventKind)).toEqual([
        'assistant',
        'reasoning',
        'assistant',
        'reasoning',
        'tool',
        'lifecycle'
      ])
      expect(JSON.stringify(result.events)).toContain('tool output remains complete')

      await store.export({ destination })
      const exported = await readFile(destination, 'utf8')
      expect(exported).not.toContain(apiKey)
      const exportedEvents = exported.trim().split('\n').slice(1)
        .map((line) => JSON.parse(line) as TraceEvent)
      expect(joinedDeltaText(exportedEvents.map(agentTracePayload))).not.toContain(apiKey)
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
      await rm(destination, { force: true })
    }
  })

  it('keeps mixed buffered and immediate events ordered when source timestamps are identical', async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), 'agent-observed-order-'))
    const destination = join(userDataDirectory, '..', `agent-order-${Date.now()}.jsonl`)
    try {
      const store = new LocalTraceStore({ userDataDirectory })
      const recorder = new AgentRuntimeTraceRecorder(store)
      const base = {
        runtimeId: 'codex' as const,
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-07-19T00:00:00.000Z'
      }
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'assistant_delta',
        itemId: 'assistant-1',
        seq: 1,
        text: 'first'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'tool_event',
        itemId: 'tool-1',
        seq: 2,
        status: 'running',
        toolName: 'read_file'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'reasoning_delta',
        itemId: 'reasoning-1',
        seq: 3,
        visibility: 'summary',
        text: 'second'
      })
      await recorder.observeEvent('codex', {
        ...base,
        kind: 'turn_lifecycle',
        seq: 4,
        state: 'completed'
      })
      await recorder.flushTurn('codex', 'thread-1', 'turn-1')

      const readEvents = (await store.read({ order: 'asc' })).events
      expect(readEvents.map(agentEventSeq)).toEqual([1, 2, 3, 4])
      expect(readEvents.every((event) => (
        agentTracePayload(event).event as unknown as { createdAt?: string }
      ).createdAt === base.createdAt)).toBe(true)

      await store.export({ destination })
      const exportedEvents = (await readFile(destination, 'utf8')).trim().split('\n').slice(1)
        .map((line) => JSON.parse(line) as TraceEvent)
      expect(exportedEvents.map(agentEventSeq)).toEqual([1, 2, 3, 4])
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
      await rm(destination, { force: true })
    }
  })

  it('bounds the per-turn delta buffer by count and flushes a truncation marker', async () => {
    const { recorder, append, appendMany } = fakeRecorder()
    const base = {
      kind: 'assistant_delta' as const,
      runtimeId: 'codex' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1'
    }

    for (let index = 0; index < AGENT_TRACE_TURN_BUFFER_MAX_EVENTS + 10; index += 1) {
      await recorder.observeEvent('codex', { ...base, seq: index, text: `chunk-${index}` })
    }
    await recorder.flushTurn('codex', 'thread-1', 'turn-1')

    expect(appendMany).toHaveBeenCalledTimes(1)
    expect(appendMany.mock.calls[0]?.[0]).toHaveLength(AGENT_TRACE_TURN_BUFFER_MAX_EVENTS)
    // appendMany fans out to append in this harness; the truncation marker is
    // the single direct append.
    const markers = append.mock.calls.filter(([input]) => input.payload.eventKind === 'error')
    expect(markers).toHaveLength(1)
    expect(markers[0]?.[0]).toMatchObject({
      payload: {
        eventKind: 'error',
        event: {
          kind: 'error',
          code: 'agent_trace_turn_truncated',
          recoverable: true,
          severity: 'warning'
        }
      }
    })
  })

  it('bounds the per-turn delta buffer by bytes', async () => {
    const { recorder, append, appendMany } = fakeRecorder()
    const base = {
      kind: 'assistant_delta' as const,
      runtimeId: 'codex' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1'
    }

    await recorder.observeEvent('codex', { ...base, seq: 1, text: 'small chunk' })
    await recorder.observeEvent('codex', {
      ...base,
      seq: 2,
      text: 'x'.repeat(AGENT_TRACE_TURN_BUFFER_MAX_BYTES)
    })
    await recorder.flushTurn('codex', 'thread-1', 'turn-1')

    expect(appendMany.mock.calls[0]?.[0]).toHaveLength(1)
    const markers = append.mock.calls.filter(([input]) => input.payload.eventKind === 'error')
    expect(markers).toHaveLength(1)
  })

  it('evicts turn buffers that go stale without a flush', async () => {
    vi.useFakeTimers()
    try {
      const { recorder, appendMany } = fakeRecorder()
      const delta = (threadId: string, turnId: string): AgentRuntimeEvent => ({
        kind: 'assistant_delta',
        runtimeId: 'codex',
        threadId,
        turnId,
        itemId: 'assistant-1',
        text: 'stale chunk'
      })

      vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'))
      await recorder.observeEvent('codex', delta('thread-1', 'turn-stale'))
      vi.setSystemTime(new Date(Date.now() + AGENT_TRACE_STALE_TURN_MS + 1_000))
      // The next observed delta sweeps abandoned turn buffers.
      await recorder.observeEvent('codex', delta('thread-1', 'turn-live'))

      await recorder.flushTurn('codex', 'thread-1', 'turn-stale')
      expect(appendMany).not.toHaveBeenCalled()

      await recorder.flushTurn('codex', 'thread-1', 'turn-live')
      expect(appendMany).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

function fakeRecorder(): {
  recorder: AgentRuntimeTraceRecorder
  append: ReturnType<typeof vi.fn<(input: TraceEventInput<'agent_event'>) => Promise<TraceEvent>>>
  appendMany: ReturnType<typeof vi.fn<(
    inputs: readonly TraceEventInput<'agent_event'>[]
  ) => Promise<TraceEvent[]>>>
} {
  const append = vi.fn(async (input: TraceEventInput<'agent_event'>) => input as unknown as TraceEvent)
  const appendMany = vi.fn(async (inputs: readonly TraceEventInput<'agent_event'>[]) =>
    Promise.all(inputs.map((input) => append(input))))
  return {
    recorder: new AgentRuntimeTraceRecorder({
      append,
      appendMany,
      sanitizeTextChunks: (chunks) => sanitizeTraceTextChunks(chunks)
    }),
    append,
    appendMany
  }
}

function agentTracePayload(event: TraceEvent): AgentTracePayload {
  if (event.kind !== 'agent_event') throw new Error(`Expected Agent trace event, received ${event.kind}`)
  return event.payload as AgentTracePayload
}

function agentEventSeq(event: TraceEvent): number | undefined {
  return (agentTracePayload(event).event as unknown as { seq?: number }).seq
}

function joinedDeltaText(payloads: readonly AgentTracePayload[]): string {
  return payloads
    .filter((payload) => payload.eventKind === 'assistant' || payload.eventKind === 'reasoning')
    .map((payload) => payload.event as unknown as { seq?: number; text?: string })
    .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    .map((event) => event.text ?? '')
    .join('')
}
