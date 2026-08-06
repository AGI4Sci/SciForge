import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveTraceId,
  LocalTraceStore,
  SCIENTIFIC_TRACE_SOURCE,
  sanitizeTraceTextChunks,
  type TraceEvent,
  type TraceEventInput
} from '@sciforge/full-trace'
import type { AgentRuntimeEvent } from '../../shared/agent-runtime-contract'
import {
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

    await recorder.observeEvent('sciforge', event)
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
    const base = { runtimeId: 'sciforge' as const, threadId: 'thread-1', turnId: 'turn-1' }
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

    expect(rawAppendManyCalls(appendMany)).toHaveLength(0)
    expect(rawAppendInputs(append).map((input) => input.payload.eventKind)).toEqual([
      'tool',
      'approval',
      'usage',
      'error',
      'lifecycle'
    ])
    expect(scientificAppendManyCalls(appendMany).flatMap((inputs) =>
      inputs.map((input) => (input.payload.event as { type?: string }).type)
    )).toEqual([
      'TRACE_STARTED',
      'TOOL_CALL_REQUESTED',
      'HUMAN_REVIEW_REQUESTED',
      'RESOURCE_USAGE_RECORDED',
      'ERROR_RECORDED'
    ])

    await recorder.flushTurn('codex', 'thread-1', 'turn-1')
    expect(rawAppendManyCalls(appendMany)).toHaveLength(1)
    expect(rawAppendInputs(append)).toHaveLength(6)
  })

  it('projects runtime file changes and completion receipts into scientific artifacts and evidence', async () => {
    const { recorder, appendMany } = fakeRecorder()
    const artifactRef = `artifact_${'a'.repeat(24)}`

    await recorder.observeEvent('codex', {
      kind: 'tool_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      callId: 'call-1',
      status: 'success',
      toolKind: 'file_change',
      toolName: 'write_file',
      filePath: 'results/report.md',
      receipt: { status: 'success', outcome: 'progress' },
      completionReceipts: [{
        contractVersion: 'completion-receipt.v1',
        receiptId: 'visual-capture-proof-1',
        kind: 'visual.capture',
        status: 'satisfied',
        issuer: 'sciforge.agent-visual',
        callId: 'call-1',
        subjectRef: artifactRef,
        relatedRefs: [artifactRef],
        sha256: 'a'.repeat(64),
        createdAt: '2026-08-06T00:00:00.000Z'
      }, {
        contractVersion: 'completion-receipt.v1',
        receiptId: 'artifact-validation-proof-1',
        kind: 'artifact.reference-validation',
        status: 'satisfied',
        issuer: 'sciforge.agent-visual',
        callId: 'call-1',
        subjectRef: artifactRef,
        relatedRefs: [artifactRef],
        attestation: 'Typed artifact reference validated.',
        createdAt: '2026-08-06T00:00:01.000Z'
      }]
    })

    const scientificEvents = scientificAppendManyCalls(appendMany)
      .flatMap((inputs) => inputs.map((input) => input.payload.event as {
        type: string
        payload: Record<string, unknown>
        links?: { artifacts?: string[]; evidence?: string[] }
      }))
    expect(scientificEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
      'TRACE_STARTED',
      'TOOL_CALL_COMPLETED',
      'ARTIFACT_CREATED',
      'EVIDENCE_ATTACHED'
    ]))
    expect(scientificEvents.filter((event) => event.type === 'ARTIFACT_CREATED')).toHaveLength(2)
    expect(scientificEvents.find((event) =>
      event.type === 'ARTIFACT_CREATED' && event.payload.artifactId === artifactRef
    )?.payload.sha256).toBe('a'.repeat(64))
    expect(scientificEvents.find((event) =>
      event.type === 'EVIDENCE_ATTACHED'
    )?.links?.artifacts).toContain(artifactRef)
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
      await recorder.observeEvent('sciforge', {
        kind: 'assistant_delta',
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        text: `The credential was ${apiKey}`
      })
      await recorder.observeEvent('sciforge', {
        kind: 'tool_event',
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'tool-1',
        status: 'running',
        toolName: 'diagnostic',
        meta: { output: `tool echoed ${apiKey}` }
      })
      await recorder.observeEvent('sciforge', {
        kind: 'error',
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        turnId: 'turn-1',
        recoverable: false,
        severity: 'error',
        message: `upstream rejected ${apiKey}`
      })
      await recorder.flushTurn('sciforge', 'thread-1', 'turn-1')

      const serialized = JSON.stringify(await store.read())
      expect(serialized).not.toContain(apiKey)
      expect(serialized).toContain('[REDACTED]')
      const events = (await store.read()).events
      expect(rawTraceEvents(events)).toHaveLength(3)
      expect(scientificTraceEvents(events).map((event) =>
        (agentTracePayload(event).event as { type?: string }).type
      )).toEqual(expect.arrayContaining(['TRACE_STARTED', 'TOOL_CALL_REQUESTED', 'ERROR_RECORDED']))
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
      const payloads = rawTraceEvents(result.events).map(agentTracePayload)
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
      expect(joinedDeltaText(rawTraceEvents(exportedEvents).map(agentTracePayload))).not.toContain(apiKey)
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

      const readEvents = rawTraceEvents((await store.read({ order: 'asc' })).events)
      expect(readEvents.map(agentEventSeq)).toEqual([1, 2, 3, 4])
      expect(readEvents.every((event) => (
        agentTracePayload(event).event as unknown as { createdAt?: string }
      ).createdAt === base.createdAt)).toBe(true)

      await store.export({ destination })
      const exportedEvents = rawTraceEvents((await readFile(destination, 'utf8')).trim().split('\n').slice(1)
        .map((line) => JSON.parse(line) as TraceEvent)
      )
      expect(exportedEvents.map(agentEventSeq)).toEqual([1, 2, 3, 4])
    } finally {
      await rm(userDataDirectory, { recursive: true, force: true })
      await rm(destination, { force: true })
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

function rawAppendInputs(
  append: ReturnType<typeof vi.fn<(input: TraceEventInput<'agent_event'>) => Promise<TraceEvent>>>
): TraceEventInput<'agent_event'>[] {
  return append.mock.calls.map(([input]) => input).filter((input) => input.source !== SCIENTIFIC_TRACE_SOURCE)
}

function rawAppendManyCalls(
  appendMany: ReturnType<typeof vi.fn<(
    inputs: readonly TraceEventInput<'agent_event'>[]
  ) => Promise<TraceEvent[]>>>
): Array<readonly TraceEventInput<'agent_event'>[]> {
  return appendMany.mock.calls.map(([inputs]) => inputs).filter((inputs) =>
    inputs.some((input) => input.source !== SCIENTIFIC_TRACE_SOURCE))
}

function scientificAppendManyCalls(
  appendMany: ReturnType<typeof vi.fn<(
    inputs: readonly TraceEventInput<'agent_event'>[]
  ) => Promise<TraceEvent[]>>>
): Array<readonly TraceEventInput<'agent_event'>[]> {
  return appendMany.mock.calls.map(([inputs]) => inputs).filter((inputs) =>
    inputs.every((input) => input.source === SCIENTIFIC_TRACE_SOURCE))
}

function rawTraceEvents(events: readonly TraceEvent[]): TraceEvent[] {
  return events.filter((event) => event.source !== SCIENTIFIC_TRACE_SOURCE)
}

function scientificTraceEvents(events: readonly TraceEvent[]): TraceEvent[] {
  return events.filter((event) => event.source === SCIENTIFIC_TRACE_SOURCE)
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
