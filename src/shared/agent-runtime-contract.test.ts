import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_AUXILIARY_OPERATIONS,
  AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS,
  AGENT_RUNTIME_EVENT_KINDS,
  createAgentRuntimeCapabilityMatrix,
  createDefaultAgentRuntimeCapabilities,
  createUnavailableCapabilityState,
  directAgentRuntimeChildrenForThread,
  filterAgentRuntimeThreadChildren,
  isAgentRuntimeChildActive,
  isAgentRuntimeDirectThreadChild,
  type AgentRuntimeAuxiliaryInput,
  type AgentRuntimeAuxiliaryOperation,
  type AgentRuntimeCapabilities,
  type AgentRuntimeChild,
  type AgentRuntimeEvent,
  type AgentRuntimeListThreadChildrenResponse,
  type AgentRuntimeReadChildTranscriptResponse
} from './agent-runtime-contract'

function exhaustiveEventLabel(event: AgentRuntimeEvent): string {
  switch (event.kind) {
    case 'thread_lifecycle':
      return event.state
    case 'turn_lifecycle':
      return event.state
    case 'runtime_status':
      return event.phase ?? 'runtime_status'
    case 'user_message':
      return event.text
    case 'assistant_delta':
      return event.text
    case 'reasoning_delta':
      return event.visibility
    case 'item_snapshot':
      return event.item.kind
    case 'tool_event':
      return event.status
    case 'approval_requested':
      return event.approvalId
    case 'approval_resolved':
      return event.decision
    case 'user_input_requested':
      return event.requestId
    case 'user_input_resolved':
      return event.status
    case 'compaction_event':
      return event.status
    case 'handoff_event':
      return event.status
    case 'review_event':
      return event.status
    case 'goal_event':
      return event.status ?? 'goal'
    case 'todo_event':
      return String(event.items.length)
    case 'child_event':
      return event.child.id
    case 'usage':
      return String(event.usage.inputTokens ?? 0)
    case 'error':
      return event.severity
    case 'heartbeat':
      return 'heartbeat'
    default: {
      const neverEvent: never = event
      return neverEvent
    }
  }
}

describe('agent runtime contract', () => {
  it('partitions auxiliary inputs between thread-bound and active-scoped operations', () => {
    const runtimeIdRequired = new Set<AgentRuntimeAuxiliaryOperation>(
      AGENT_RUNTIME_AUXILIARY_RUNTIME_ID_REQUIRED_OPERATIONS
    )
    const activeScopedOperations = AGENT_RUNTIME_AUXILIARY_OPERATIONS.filter(
      (operation) => !runtimeIdRequired.has(operation)
    )
    const activeScoped = { operation: 'getRuntimeInfo' } satisfies AgentRuntimeAuxiliaryInput
    const threadBound = {
      runtimeId: 'codex',
      operation: 'getThreadGoal',
      payload: { threadId: 'thread-1' }
    } satisfies AgentRuntimeAuxiliaryInput

    expect(activeScoped.operation).toBe('getRuntimeInfo')
    expect(threadBound.runtimeId).toBe('codex')
    expect(runtimeIdRequired.has('getThreadGoal')).toBe(true)
    expect(activeScopedOperations).toEqual(expect.arrayContaining([
      'getRuntimeInfo',
      'listSkills',
      'listMemories',
      'listWorkspaceReferences'
    ]))
    expect(activeScopedOperations).not.toContain('getThreadGoal')
  })

  it('keeps event kinds aligned with the discriminated union', () => {
    const sampleEvents = [
      { kind: 'thread_lifecycle', threadId: 'thr', state: 'created' },
      { kind: 'turn_lifecycle', threadId: 'thr', turnId: 'turn', state: 'started' },
      { kind: 'runtime_status', threadId: 'thr', phase: 'process_start', message: 'starting' },
      { kind: 'user_message', threadId: 'thr', itemId: 'user', text: 'hello' },
      { kind: 'assistant_delta', threadId: 'thr', itemId: 'assistant', text: 'hi' },
      {
        kind: 'reasoning_delta',
        threadId: 'thr',
        itemId: 'reasoning',
        text: 'thinking',
        visibility: 'summary',
        source: 'model'
      },
      {
        kind: 'item_snapshot',
        threadId: 'thr',
        item: { id: 'item', kind: 'assistant_message', text: 'snapshot' }
      },
      { kind: 'tool_event', threadId: 'thr', itemId: 'tool', status: 'running', toolKind: 'tool_call' },
      {
        kind: 'child_event',
        threadId: 'thr',
        child: {
          id: 'child',
          runtimeId: 'codex',
          parentThreadId: 'thr',
          kind: 'agent',
          status: 'running',
          prompt: 'Investigate failing tests'
        }
      },
      { kind: 'approval_requested', threadId: 'thr', approvalId: 'approval', summary: 'Allow tool?' },
      { kind: 'approval_resolved', threadId: 'thr', approvalId: 'approval', decision: 'denied' },
      {
        kind: 'user_input_requested',
        threadId: 'thr',
        requestId: 'input',
        questions: [{ id: 'q', header: 'Choice', question: 'Pick one', options: [] }]
      },
      { kind: 'user_input_resolved', threadId: 'thr', requestId: 'input', status: 'cancelled' },
      { kind: 'compaction_event', threadId: 'thr', itemId: 'compact', status: 'success', summary: 'Compacted' },
      {
        kind: 'handoff_event',
        threadId: 'thr',
        status: 'started',
        sourceRuntimeId: 'codex',
        sourceThreadId: 'source',
        targetRuntimeId: 'claude',
        targetThreadId: 'target'
      },
      { kind: 'review_event', threadId: 'thr', itemId: 'review', status: 'running', title: 'Review' },
      { kind: 'goal_event', threadId: 'thr', status: 'active', objective: 'Ship it' },
      {
        kind: 'todo_event',
        threadId: 'thr',
        items: [{
          id: 'todo',
          content: 'One',
          status: 'pending',
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }]
      },
      { kind: 'usage', threadId: 'thr', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      { kind: 'error', threadId: 'thr', recoverable: true, severity: 'warning', message: 'Recoverable' },
      { kind: 'heartbeat', threadId: 'thr' }
    ] satisfies AgentRuntimeEvent[]

    expect(sampleEvents.map((event) => event.kind)).toEqual(AGENT_RUNTIME_EVENT_KINDS)
    expect(sampleEvents.map(exhaustiveEventLabel)).toHaveLength(AGENT_RUNTIME_EVENT_KINDS.length)
  })

  it('defaults unsupported capabilities to unavailable instead of available', () => {
    const capabilities = createDefaultAgentRuntimeCapabilities({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio'
    })

    expect(capabilities).toMatchObject({
      contractVersion: 1,
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio',
      controls: {
        interrupt: false,
        steer: false,
        approval: 'unsupported',
        userInput: 'unsupported',
        compact: 'unsupported',
        fork: false,
        review: false,
        goals: false,
        todos: false,
        resumeSession: false
      },
      guard: {
        execution: 'unsupported'
      }
    })
    expect(capabilities.events.live).toBe(false)
    expect(capabilities.reasoning.visibility).toBe('none')
    expect(capabilities.reasoning.source).toBe('unknown')
    expect(capabilities.latency.supportedPhases).toEqual([])
    expect(capabilities.tools.commandExecution.available).toBe(false)
    expect(capabilities.tools.mcp.available).toBe(false)
    expect(capabilities.tools.mcp.search?.available).toBe(false)
    expect(capabilities.tools.web.available).toBe(false)
    expect(capabilities.tools.web.fetch?.available).toBe(false)
    expect(capabilities.tools.web.search?.available).toBe(false)
    expect(capabilities.tools.research.available).toBe(false)
    expect(capabilities.storage.attachments.available).toBe(false)
    expect(capabilities.storage.usage).toBe(false)
    expect(capabilities.storage.memory.available).toBe(false)
    expect(capabilities.matrix).toMatchObject({
      nativeHistory: { available: false, reason: 'unsupported' },
      nativeCompact: { available: false, reason: 'unsupported' },
      nativeResume: { available: false, reason: 'unsupported' },
      steer: { available: false, reason: 'unsupported' },
      fork: { available: false, reason: 'unsupported' },
      handoffImport: { available: false, reason: 'unsupported' },
      usage: { available: false, reason: 'unsupported' },
      eventReplay: { available: false, reason: 'unsupported' }
    })
    expect(capabilities.context?.ledger?.available).toBe(false)
    expect(capabilities.context?.handoff?.available).toBe(false)
  })

  it('creates explicit unavailable capability states with reasons', () => {
    expect(createUnavailableCapabilityState('not implemented yet')).toEqual({
      available: false,
      reason: 'not implemented yet'
    })
  })

  it('creates a runtime capability matrix with stable keys', () => {
    const matrix = createAgentRuntimeCapabilityMatrix({
      nativeHistory: true,
      nativeCompact: false,
      nativeResume: true,
      steer: true,
      fork: false,
      handoffImport: true,
      usage: true,
      eventReplay: false,
      reasons: {
        nativeCompact: 'host compact only',
        fork: 'runtime fork unavailable',
        eventReplay: 'event log missing'
      }
    })

    expect(Object.keys(matrix)).toEqual([
      'nativeHistory',
      'nativeCompact',
      'nativeResume',
      'steer',
      'fork',
      'handoffImport',
      'usage',
      'eventReplay'
    ])
    expect(matrix.nativeHistory).toEqual({ available: true })
    expect(matrix.nativeCompact).toEqual({ available: false, reason: 'host compact only' })
    expect(matrix.fork).toEqual({ available: false, reason: 'runtime fork unavailable' })
    expect(matrix.eventReplay).toEqual({ available: false, reason: 'event log missing' })
  })

  it('represents native and observe runtime guards without implying host controls', () => {
    const base = createDefaultAgentRuntimeCapabilities({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio'
    })
    const codex = {
      ...base,
      guard: { execution: 'observe' }
    } satisfies AgentRuntimeCapabilities
    const localRuntime = {
      ...base,
      runtimeId: 'sciforge',
      transport: 'http_sse',
      guard: { execution: 'native' },
      controls: {
        ...base.controls,
        interrupt: false,
        steer: false
      }
    } satisfies AgentRuntimeCapabilities

    expect(codex.guard.execution).toBe('observe')
    expect(localRuntime.guard.execution).toBe('native')
    expect(localRuntime.controls.interrupt).toBe(false)
    expect(localRuntime.controls.steer).toBe(false)
  })

  it('serializes child runs and degraded transcript responses without runtime-specific imports', () => {
    const child = {
      id: 'agent-1',
      runtimeId: 'claude',
      parentThreadId: 'thread-1',
      parentTurnId: 'turn-1',
      kind: 'agent',
      status: 'completed',
      name: 'research',
      label: 'Research',
      prompt: 'Read the docs',
      summary: 'Found the relevant section.',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      },
      transcriptRef: {
        id: 'transcript-1',
        kind: 'runtime',
        runtimeId: 'claude',
        childId: 'agent-1',
        transcriptId: 'transcript-1',
        source: 'runtime'
      },
      openAsThreadRef: {
        runtimeId: 'claude',
        threadId: 'thread-child-1',
        relation: 'side',
        title: 'Research'
      },
      createdAt: '2026-06-11T00:00:00.000Z',
      startedAt: '2026-06-11T00:00:01.000Z',
      completedAt: '2026-06-11T00:00:05.000Z',
      metadata: {
        adapter: 'neutral'
      }
    } satisfies AgentRuntimeChild

    const listResponse = {
      runtimeId: 'claude',
      threadId: 'thread-1',
      parentTurnId: 'turn-1',
      children: [
        child,
        {
          id: 'remote-1',
          runtimeId: 'claude',
          parentThreadId: 'thread-1',
          kind: 'remote',
          label: 'Remote child',
          status: 'unknown',
          transcriptRef: {
            kind: 'remote',
            source: 'remote',
            transcriptId: 'remote-transcript'
          }
        }
      ],
      degraded: true,
      reason: 'Runtime listed a child without replayable transcript metadata'
    } satisfies AgentRuntimeListThreadChildrenResponse

    const transcriptResponse = {
      transcript: {
        runtimeId: 'claude',
        parentThreadId: 'thread-1',
        threadId: 'thread-1',
        parentTurnId: 'turn-1',
        childId: 'agent-1',
        child,
        transcriptRef: child.transcriptRef,
        format: 'markdown',
        entries: [
          {
            id: 'entry-1',
            kind: 'user_message',
            text: 'Read the docs',
            createdAt: '2026-06-11T00:00:01.000Z'
          },
          {
            id: 'entry-2',
            kind: 'assistant_message',
            summary: 'Found the relevant section.',
            createdAt: '2026-06-11T00:00:05.000Z'
          }
        ],
        degraded: true,
        reason: 'Tool events were summarized by the runtime'
      }
    } satisfies AgentRuntimeReadChildTranscriptResponse

    const roundTrip = JSON.parse(JSON.stringify({ child, listResponse, transcriptResponse }))

    expect(roundTrip.child).toEqual(child)
    expect(roundTrip.listResponse).toMatchObject({
      degraded: true,
      reason: 'Runtime listed a child without replayable transcript metadata',
      children: [
        expect.objectContaining({ id: 'agent-1', kind: 'agent', status: 'completed' }),
        expect.objectContaining({ id: 'remote-1', kind: 'remote', status: 'unknown' })
      ]
    })
    expect(roundTrip.transcriptResponse.transcript).toMatchObject({
      childId: 'agent-1',
      format: 'markdown',
      degraded: true,
      reason: 'Tool events were summarized by the runtime',
      entries: [
        expect.objectContaining({ kind: 'user_message' }),
        expect.objectContaining({ kind: 'assistant_message' })
      ]
    })
  })

  it('filters direct active-thread children without leaking children from other threads', () => {
    const children = [
      {
        id: 'direct',
        runtimeId: 'sciforge',
        parentThreadId: 'active',
        parentTurnId: 'turn-a',
        kind: 'agent',
        status: 'running'
      },
      {
        id: 'queued',
        runtimeId: 'sciforge',
        parentThreadId: 'active',
        parentTurnId: 'turn-b',
        kind: 'agent',
        status: 'queued'
      },
      {
        id: 'other-thread',
        runtimeId: 'sciforge',
        parentThreadId: 'other',
        parentTurnId: 'turn-a',
        kind: 'agent',
        status: 'completed'
      },
      {
        id: 'other-turn',
        runtimeId: 'sciforge',
        parentThreadId: 'active',
        parentTurnId: 'turn-b',
        kind: 'workflow',
        status: 'completed'
      },
      {
        id: 'unknown',
        runtimeId: 'sciforge',
        parentThreadId: 'active',
        kind: 'remote',
        status: 'unknown'
      },
      {
        id: 'descendant',
        runtimeId: 'sciforge',
        parentThreadId: 'direct',
        kind: 'agent',
        status: 'running'
      },
      {
        id: 'other-runtime',
        runtimeId: 'codex',
        parentThreadId: 'active',
        kind: 'agent',
        status: 'running'
      }
    ] satisfies AgentRuntimeChild[]

    expect(isAgentRuntimeChildActive(children[0])).toBe(true)
    expect(isAgentRuntimeChildActive(children[4])).toBe(false)
    expect(isAgentRuntimeDirectThreadChild(children[5], {
      runtimeId: 'sciforge',
      parentThreadId: 'active'
    })).toBe(false)

    expect(directAgentRuntimeChildrenForThread(children, 'active').map((child) => child.id)).toEqual([
      'direct',
      'queued',
      'other-turn',
      'unknown',
      'other-runtime'
    ])
    expect(directAgentRuntimeChildrenForThread(children, 'active', 'turn-a').map((child) => child.id)).toEqual([
      'direct'
    ])
    expect(filterAgentRuntimeThreadChildren(children, {
      runtimeId: 'sciforge',
      parentThreadId: 'active',
      activeOnly: true
    }).map((child) => child.id)).toEqual(['direct', 'queued'])
    expect(filterAgentRuntimeThreadChildren(children, {
      runtimeId: 'sciforge',
      parentThreadId: 'active',
      turnId: 'turn-b'
    }).map((child) => child.id)).toEqual(['queued', 'other-turn'])
  })

  it('keeps the shared contract free of renderer and runtime-specific imports', async () => {
    // @ts-ignore - This Vitest source-inspection check runs in Node, while the shared package also typechecks in the web tsconfig.
    const { readFileSync } = await import('node:fs')
    // @ts-ignore - See the Node-only source-inspection note above.
    const { dirname, resolve } = await import('node:path')
    // @ts-ignore - See the Node-only source-inspection note above.
    const { fileURLToPath } = await import('node:url')
    const contractPath = resolve(dirname(fileURLToPath(import.meta.url)), 'agent-runtime-contract.ts')
    const source = readFileSync(contractPath, 'utf8')

	    expect(source).not.toMatch(/from\s+['"][^'"]*(?:@renderer|renderer|electron|src\/main|runtime\/(?:kun|local-runtime)|(?:kun|local-runtime)-adapter|(?:kun|local-runtime)-agent|runtime\/codex|codex\/app-server|codex-agent)[^'"]*['"]/)
	    expect(source).not.toMatch(/require\([^)]*(?:@renderer|renderer|electron|src\/main|runtime\/(?:kun|local-runtime)|(?:kun|local-runtime)-adapter|(?:kun|local-runtime)-agent|runtime\/codex|codex\/app-server|codex-agent)/)
  })
})
