import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { createLocalRuntimeAgentRuntimeAdapter } from './local-runtime-agent-runtime-adapter'

type CapturedRequest = {
  pathAndQuery: string
  body: Record<string, unknown>
}

const MODEL_ROUTER_MODEL_CASES: Array<[string, string | undefined]> = [
  ['auto', 'auto'],
  ['empty', ''],
  ['undefined', undefined]
]

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function adapterWithCapturedRequests(captured: CapturedRequest[]) {
  return createLocalRuntimeAgentRuntimeAdapter({
    request: vi.fn(async (_settings, pathAndQuery, init) => {
      if (init.body) {
        captured.push({
          pathAndQuery,
          body: JSON.parse(init.body) as Record<string, unknown>
        })
      }
      if (pathAndQuery === '/v1/threads') {
        return jsonResponse({
          thread: {
            id: 'thread-1',
            title: 'Thread 1',
            updatedAt: '2026-06-02T00:00:00.000Z'
          }
        })
      }
      if (pathAndQuery.endsWith('/turns')) {
        return jsonResponse({
          turn: {
            id: 'turn-1',
            threadId: 'thread-1'
          }
        })
      }
      if (pathAndQuery.endsWith('/resume-thread')) {
        return jsonResponse({
          threadId: 'thread-1',
          sessionId: 'session-1'
        })
      }
      return jsonResponse({})
    })
  })
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    body: JSON.stringify(body)
  }
}

describe('createLocalRuntimeAgentRuntimeAdapter', () => {
  it('passes side conversation inclusion only when explicitly requested', async () => {
    const request = vi.fn(async (
      _settings: AppSettingsV1,
      _pathAndQuery: string,
      _init: { method?: string }
    ) => jsonResponse({ threads: [] }))
    const adapter = createLocalRuntimeAgentRuntimeAdapter({ request })
    const context = { settings: buildSettings() }

    await adapter.listThreads(context, {})
    await adapter.listThreads(context, { includeSide: false })
    await adapter.listThreads(context, { includeSide: true })

    expect(request.mock.calls.map(([, pathAndQuery]) => pathAndQuery)).toEqual([
      '/v1/threads',
      '/v1/threads',
      '/v1/threads?include=side'
    ])
  })

  it('reports GUI-managed computer-use MCP capability through the shared runtime contract', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery) => {
        if (pathAndQuery === '/v1/runtime/info') {
          return jsonResponse({
            capabilities: {
              model: { supportsToolCalling: true },
              mcp: { available: true, toolCount: 1 },
              computerUse: {
                available: true,
                backend: 'browser-cdp'
              }
            }
          })
        }
        return jsonResponse({})
      })
    })

    await expect(adapter.capabilities({ settings: buildSettings() })).resolves.toMatchObject({
      runtimeId: 'sciforge',
      tools: {
        mcp: { available: true, toolCount: 1 },
        computerUse: {
          available: true,
          server: 'mcp',
          toolName: 'computer_use',
          backend: 'browser-cdp',
          inputIsolation: 'agent-isolated',
          affectsUserInput: false,
          requiresHostFocus: false,
          usesHostClipboard: false
        }
      }
    })
  })

  it('normalizes legacy local runtime computer-use backend info to the isolated MCP backend', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery) => {
        if (pathAndQuery === '/v1/runtime/info') {
          return jsonResponse({
            capabilities: {
              model: { supportsToolCalling: true },
              mcp: { available: true, toolCount: 1 },
              computerUse: {
                available: true,
                backend: 'global-native',
                affectsUserInput: true
              }
            }
          })
        }
        return jsonResponse({})
      })
    })

    await expect(adapter.capabilities({ settings: buildSettings() })).resolves.toMatchObject({
      tools: {
        computerUse: {
          available: true,
          backend: 'browser-cdp',
          inputIsolation: 'agent-isolated',
          affectsUserInput: false,
          requiresHostFocus: false,
          usesHostClipboard: false
        }
      }
    })
  })

  it.each(MODEL_ROUTER_MODEL_CASES)(
    'routes startThread %s model through the resolved Model Router alias',
    async (_name, model) => {
      const captured: CapturedRequest[] = []
      const adapter = adapterWithCapturedRequests(captured)

      await adapter.startThread({ settings: buildSettings() }, {
        runtimeId: 'sciforge',
        workspace: '/tmp/workspace',
        title: 'New thread',
        model
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        pathAndQuery: '/v1/threads',
        body: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS }
      })
    }
  )

  it.each(MODEL_ROUTER_MODEL_CASES)(
    'routes startTurn %s model through the resolved Model Router alias',
    async (_name, model) => {
      const captured: CapturedRequest[] = []
      const adapter = adapterWithCapturedRequests(captured)

      await adapter.startTurn({ settings: buildSettings() }, {
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        text: 'Hello',
        model
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        pathAndQuery: '/v1/threads/thread-1/turns',
        body: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS }
      })
    }
  )

  it('passes the selected remote target id to the local runtime startTurn request', async () => {
    const captured: CapturedRequest[] = []
    const adapter = adapterWithCapturedRequests(captured)

    await adapter.startTurn({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      text: 'Run on the remote box',
      remoteTargetId: ' gpu-a '
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      pathAndQuery: '/v1/threads/thread-1/turns',
      body: { remoteTargetId: 'gpu-a' }
    })
  })

  it.each(MODEL_ROUTER_MODEL_CASES)(
    'routes resumeSession %s model through the resolved Model Router alias',
    async (_name, model) => {
      const captured: CapturedRequest[] = []
      const adapter = adapterWithCapturedRequests(captured)
      const resumeSession = adapter.resumeSession
      if (!resumeSession) throw new Error('Expected local runtime adapter to support session resume.')

      await resumeSession({ settings: buildSettings() }, {
        runtimeId: 'sciforge',
        sessionId: 'session-1',
        model
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        pathAndQuery: '/v1/sessions/session-1/resume-thread',
        body: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS }
      })
    }
  )

  it('maps local runtime tool call and result items to the same callId-backed item id', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({
        id: 'thread-1',
        title: 'Thread 1',
        updatedAt: '2026-06-02T00:00:00.000Z',
        turns: [{
          id: 'turn-1',
          threadId: 'thread-1',
          status: 'completed',
          items: [
            {
              id: 'tool-call-source',
              kind: 'tool_call',
              status: 'running',
              callId: 'call-1',
              toolName: 'read_file',
              arguments: { path: 'draft.md' }
            },
            {
              id: 'tool-result-source',
              kind: 'tool_result',
              status: 'success',
              callId: 'call-1',
              toolName: 'read_file',
              output: 'ok'
            }
          ]
        }]
      }))
    })

    const detail = await adapter.readThread({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      threadId: 'thread-1'
    })
    const tools = detail.items?.filter((item) => item.kind === 'tool') ?? []

    expect(tools).toEqual([
      expect.objectContaining({
        id: 'tool_call-1',
        status: 'running',
        meta: expect.objectContaining({ sourceItemId: 'tool-call-source', callId: 'call-1', toolName: 'read_file' })
      }),
      expect.objectContaining({
        id: 'tool_call-1',
        status: 'success',
        meta: expect.objectContaining({ sourceItemId: 'tool-result-source', callId: 'call-1', toolName: 'read_file' })
      })
    ])
  })

  it('maps local runtime todo snapshots and create_plan result metadata', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({
        id: 'thread-1',
        title: 'Thread 1',
        updatedAt: '2026-06-02T00:00:00.000Z',
        todos: {
          threadId: 'thread-1',
          updatedAt: '2026-06-02T00:00:02.000Z',
          items: [{
            id: 'todo-1',
            content: 'Write replay test',
            status: 'in_progress',
            createdAt: '2026-06-02T00:00:01.000Z',
            updatedAt: '2026-06-02T00:00:02.000Z',
            source: {
              kind: 'plan',
              planId: 'plan-1',
              relativePath: '.sciforge/plan/replay.md',
              ordinal: 0,
              contentHash: 'hash-1'
            }
          }]
        },
        turns: [{
          id: 'turn-1',
          threadId: 'thread-1',
          status: 'completed',
          items: [{
            id: 'tool-result-source',
            kind: 'tool_result',
            status: 'success',
            callId: 'call-plan',
            toolName: 'create_plan',
            output: {
              summary: 'Saved plan',
              plan_id: 'plan-1',
              workspace_root: '/workspace',
              relative_path: '.sciforge/plan/replay.md',
              operation: 'draft',
              saved_at: '2026-06-02T00:00:03.000Z',
              content_hash: 'hash-1'
            }
          }]
        }]
      }))
    })

    const detail = await adapter.readThread({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      threadId: 'thread-1'
    })
    const tool = detail.items?.find((item) => item.kind === 'tool')

    expect(detail.todos).toEqual({
      threadId: 'thread-1',
      updatedAt: '2026-06-02T00:00:02.000Z',
      items: [expect.objectContaining({
        id: 'todo-1',
        content: 'Write replay test',
        status: 'in_progress',
        source: {
          kind: 'plan',
          planId: 'plan-1',
          relativePath: '.sciforge/plan/replay.md',
          ordinal: 0,
          contentHash: 'hash-1'
        }
      })]
    })
    expect(tool).toEqual(expect.objectContaining({
      id: 'tool_call-plan',
      status: 'success',
      meta: expect.objectContaining({
        callId: 'call-plan',
        toolName: 'create_plan',
        plan: expect.objectContaining({
          plan_id: 'plan-1',
          workspace_root: '/workspace',
          relative_path: '.sciforge/plan/replay.md',
          operation: 'draft'
        })
      })
    }))
  })

  it('normalizes auxiliary get/set todo responses through the shared todo mapper', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-02T00:00:09.000Z'))
    try {
      const setTodos = [{
        id: 'todo-2',
        content: 'Set todo',
        status: 'completed'
      }]
      const request = vi.fn(async (_settings, pathAndQuery, init) => {
        if (pathAndQuery === '/v1/threads/thread-1/todos' && init.method === 'GET') {
          return jsonResponse({
            todos: {
              thread_id: 'thread-1',
              updated_at: '2026-06-02T00:00:04.000Z',
              items: [
                {
                  id: 'todo-1',
                  content: ' Map auxiliary todo ',
                  status: 'pending',
                  created_at: '2026-06-02T00:00:01.000Z',
                  updated_at: '2026-06-02T00:00:02.000Z',
                  source: {
                    kind: 'plan',
                    plan_id: 'plan-1',
                    relative_path: '.sciforge/plan/aux.md',
                    ordinal: 1,
                    content_hash: 'hash-1'
                  }
                },
                { id: 'todo-no-content', content: ' ', status: 'pending' },
                { id: 'todo-bad-status', content: 'Bad status', status: 'blocked' },
                null
              ]
            }
          })
        }
        if (pathAndQuery === '/v1/threads/thread-1/todos' && init.method === 'POST') {
          return jsonResponse({
            todos: {
              items: [
                {
                  id: 'todo-2',
                  content: 'Set todo',
                  status: 'completed',
                  source: {
                    kind: 'plan',
                    plan_id: 'plan-2'
                  }
                },
                { id: 'todo-set-invalid', content: 'Invalid', status: 'done' }
              ]
            }
          })
        }
        return jsonResponse({})
      })
      const adapter = createLocalRuntimeAgentRuntimeAdapter({ request })

      await expect(adapter.auxiliary?.({ settings: buildSettings() }, {
        operation: 'getThreadTodos',
        payload: { threadId: 'thread-1' }
      })).resolves.toEqual({
        threadId: 'thread-1',
        updatedAt: '2026-06-02T00:00:04.000Z',
        items: [{
          id: 'todo-1',
          content: 'Map auxiliary todo',
          status: 'pending',
          createdAt: '2026-06-02T00:00:01.000Z',
          updatedAt: '2026-06-02T00:00:02.000Z',
          source: {
            kind: 'plan',
            planId: 'plan-1',
            relativePath: '.sciforge/plan/aux.md',
            ordinal: 1,
            contentHash: 'hash-1'
          }
        }]
      })

      await expect(adapter.auxiliary?.({ settings: buildSettings() }, {
        operation: 'setThreadTodos',
        payload: { threadId: 'thread-1', todos: setTodos }
      })).resolves.toEqual({
        threadId: 'thread-1',
        updatedAt: '2026-06-02T00:00:09.000Z',
        items: [{
          id: 'todo-2',
          content: 'Set todo',
          status: 'completed',
          createdAt: '2026-06-02T00:00:09.000Z',
          updatedAt: '2026-06-02T00:00:09.000Z'
        }]
      })
      expect(JSON.parse(request.mock.calls[1][2].body ?? '{}')).toEqual({ todos: setTodos })
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps local runtime tool_call_ready events onto the same tool event chain', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'tool_call_ready',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 7,
          timestamp: '2026-06-02T00:00:01.000Z',
          itemId: 'tool-ready-source',
          callId: 'call-1',
          toolName: 'read_file',
          readyCount: 1
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { runtimeId: 'sciforge', threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'tool_event',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 7,
        itemId: 'tool_call-1',
        status: 'running',
        summary: 'read_file',
        toolKind: 'tool_call',
        meta: expect.objectContaining({
          sourceItemId: 'tool-ready-source',
          callId: 'call-1',
          toolName: 'read_file',
          readyCount: 1,
          runtimeStatus: 'tool_call_ready'
        })
      })
    ])
  })

  it('maps local runtime todo events into neutral todo events', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'todos_updated',
          threadId: 'thread-1',
          seq: 8,
          timestamp: '2026-06-02T00:00:05.000Z',
          todos: {
            threadId: 'thread-1',
            updatedAt: '2026-06-02T00:00:04.000Z',
            items: [{
              id: 'todo-1',
              content: 'Map todo event',
              status: 'completed',
              createdAt: '2026-06-02T00:00:01.000Z',
              updatedAt: '2026-06-02T00:00:04.000Z'
            }]
          }
        }
        yield {
          kind: 'todos_cleared',
          threadId: 'thread-1',
          seq: 9,
          timestamp: '2026-06-02T00:00:06.000Z',
          cleared: true
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { runtimeId: 'sciforge', threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'todo_event',
        threadId: 'thread-1',
        seq: 8,
        items: [expect.objectContaining({
          id: 'todo-1',
          content: 'Map todo event',
          status: 'completed',
          createdAt: '2026-06-02T00:00:01.000Z',
          updatedAt: '2026-06-02T00:00:04.000Z'
        })]
      }),
      expect.objectContaining({
        kind: 'todo_event',
        threadId: 'thread-1',
        seq: 9,
        items: [],
        cleared: true
      })
    ])
  })

  it('maps local runtime user input events to the shared request id shape', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'user_input_requested',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'input-item',
          inputId: 'input-1',
          seq: 8,
          timestamp: '2026-06-02T00:00:02.000Z',
          questions: [{
            id: 'scope',
            header: 'Scope',
            question: 'Choose scope',
            options: [{ label: 'Demo', description: 'Small run' }]
          }]
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { runtimeId: 'sciforge', threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'user_input_requested',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item',
        requestId: 'input-1',
        questions: [{
          id: 'scope',
          header: 'Scope',
          question: 'Choose scope',
          options: [{ label: 'Demo', description: 'Small run' }]
        }]
      })
    ])
  })

  it('maps local runtime assistant reasoning deltas to neutral reasoning events', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'assistant_reasoning_delta',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 8,
          timestamp: '2026-06-02T00:00:02.000Z',
          item: {
            id: 'reasoning-1',
            summary: 'Check options.'
          },
          visibility: 'trace'
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { runtimeId: 'sciforge', threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'reasoning_delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 8,
        itemId: 'reasoning-1',
        text: 'Check options.',
        visibility: 'trace'
      })
    ])
  })

  it('maps local runtime child lifecycle metadata into neutral child events', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'turn_started',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 11,
          timestamp: '2026-06-02T00:00:05.000Z',
          child: {
            parentThreadId: 'thread-1',
            parentTurnId: 'turn-1',
            childId: 'child-1',
            childLabel: 'research',
            childStatus: 'running',
            childSeq: 1
          }
        }
        yield {
          kind: 'turn_completed',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 12,
          timestamp: '2026-06-02T00:00:06.000Z',
          text: 'Child summary',
          child: {
            parentThreadId: 'thread-1',
            parentTurnId: 'turn-1',
            childId: 'child-1',
            childLabel: 'research',
            childStatus: 'completed',
            childSeq: 2
          }
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { runtimeId: 'sciforge', threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'child_event',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 11,
        itemId: 'child-1',
        child: expect.objectContaining({
          id: 'child-1',
          runtimeId: 'sciforge',
          parentThreadId: 'thread-1',
          parentTurnId: 'turn-1',
          kind: 'agent',
          status: 'running',
          label: 'research',
          metadata: expect.objectContaining({ source: 'local-runtime.runtime_event', childSeq: 1 })
        })
      }),
      expect.objectContaining({
        kind: 'child_event',
        threadId: 'thread-1',
        seq: 12,
        message: 'Child summary',
        child: expect.objectContaining({
          id: 'child-1',
          status: 'completed',
          summary: 'Child summary',
          completedAt: '2026-06-02T00:00:06.000Z',
          metadata: expect.objectContaining({ childSeq: 2 })
        })
      })
    ])
  })

  it('maps local runtime child run records through listThreadChildren auxiliary', async () => {
    const seen: string[] = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery) => {
        seen.push(pathAndQuery)
        if (pathAndQuery === '/v1/threads/thread-1/children?turn_id=turn-1&limit=10') {
          return jsonResponse({
            threadId: 'thread-1',
            turnId: 'turn-1',
            children: [
              {
                id: 'child-1',
                parentThreadId: 'thread-1',
                parentTurnId: 'turn-1',
                label: 'research',
                prompt: 'Find the latest papers',
                workspace: '/tmp/workspace',
                model: 'deepseek-chat',
                status: 'completed',
                summary: 'Found three papers.',
                usage: {
                  promptTokens: 11,
                  completionTokens: 7,
                  totalTokens: 18,
                  cacheHitTokens: 4,
                  cacheMissTokens: 7,
                  costUsd: 0.02
                },
                createdAt: '2026-06-02T00:00:00.000Z',
                updatedAt: '2026-06-02T00:00:10.000Z'
              }
            ],
            metadata: { enabled: true, active: 0 }
          })
        }
        return jsonResponse({})
      })
    })

    await expect(adapter.auxiliary?.({ settings: buildSettings() }, {
      operation: 'listThreadChildren',
      payload: { threadId: 'thread-1', turnId: 'turn-1', limit: 10 }
    })).resolves.toMatchObject({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      parentTurnId: 'turn-1',
      children: [
        {
          id: 'child-1',
          runtimeId: 'sciforge',
          parentThreadId: 'thread-1',
          parentTurnId: 'turn-1',
          kind: 'agent',
          status: 'completed',
          label: 'research',
          name: 'research',
          prompt: 'Find the latest papers',
          summary: 'Found three papers.',
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            totalTokens: 18,
            cacheReadTokens: 4,
            cacheWriteTokens: 7,
            costUsd: 0.02
          },
          transcriptRef: {
            id: 'child-1',
            kind: 'runtime',
            runtimeId: 'sciforge',
            childId: 'child-1',
            transcriptId: 'child-1',
            source: 'local-runtime-child-run',
            label: 'research'
          },
          completedAt: '2026-06-02T00:00:10.000Z',
          metadata: {
            source: 'local-runtime.delegate_task',
            workspace: '/tmp/workspace',
            model: 'deepseek-chat'
          }
        }
      ],
      metadata: { enabled: true, active: 0 }
    })
    expect(seen).toEqual(['/v1/threads/thread-1/children?turn_id=turn-1&limit=10'])
  })

  it('reads local runtime child transcripts through the runtime endpoint', async () => {
    const request = vi.fn(async (_settings, pathAndQuery) => {
      if (pathAndQuery === '/v1/threads/thread-1/children/child-1/transcript?limit=20') {
        return jsonResponse({
          transcript: {
            runtimeId: 'sciforge',
            threadId: 'thread-1',
            parentThreadId: 'thread-1',
            parentTurnId: 'turn-1',
            childId: 'child-1',
            format: 'jsonl',
            transcriptRef: {
              id: 'child-1',
              kind: 'runtime',
              runtimeId: 'sciforge',
              childId: 'child-1',
              transcriptId: 'child-1',
              source: 'local-runtime-child-run',
              label: 'research'
            },
            entries: [{
              id: 'entry-1',
              kind: 'assistant_message',
              text: 'child output',
              createdAt: '2026-06-02T00:00:03.000Z'
            }],
            summary: 'child output',
            usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
            metadata: { source: 'local-runtime.child-runs' }
          }
        })
      }
      return jsonResponse({})
    })
    const adapter = createLocalRuntimeAgentRuntimeAdapter({ request })

    await expect(adapter.auxiliary?.({ settings: buildSettings() }, {
      operation: 'readChildTranscript',
      payload: { threadId: 'thread-1', parentTurnId: 'turn-1', childId: 'child-1', limit: 20 }
    })).resolves.toMatchObject({
      transcript: {
        runtimeId: 'sciforge',
        threadId: 'thread-1',
        parentThreadId: 'thread-1',
        parentTurnId: 'turn-1',
        childId: 'child-1',
        transcriptRef: {
          id: 'child-1',
          kind: 'runtime',
          runtimeId: 'sciforge',
          childId: 'child-1',
          transcriptId: 'child-1',
          source: 'local-runtime-child-run',
          label: 'research'
        },
        format: 'jsonl',
        entries: [{
          id: 'entry-1',
          kind: 'assistant_message',
          text: 'child output',
          createdAt: '2026-06-02T00:00:03.000Z'
        }],
        summary: 'child output',
        usage: {
          inputTokens: 5,
          outputTokens: 3,
          totalTokens: 8
        },
        metadata: { source: 'local-runtime.child-runs' }
      }
    })
    expect(request).toHaveBeenCalledWith(
      buildSettings(),
      '/v1/threads/thread-1/children/child-1/transcript?limit=20',
      { method: 'GET' }
    )
  })

  it('treats an unavailable memory store as an empty memory list', async () => {
    const seen: string[] = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery) => {
        seen.push(pathAndQuery)
        return {
          ok: false,
          status: 503,
          body: JSON.stringify({
            code: 'capability_unavailable',
            message: 'memory store is unavailable'
          })
        }
      })
    })

    await expect(adapter.auxiliary?.({ settings: buildSettings() }, {
      operation: 'listMemories',
      payload: { options: { workspace: '/tmp/workspace', includeDeleted: false } }
    })).resolves.toEqual([])
    expect(seen).toEqual(['/v1/memory?workspace=%2Ftmp%2Fworkspace&include_deleted=false'])
  })

  it('maps local runtime compaction and goal events into shared context events', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'compaction_completed',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'compact-1',
          seq: 8,
          timestamp: '2026-06-02T00:00:02.000Z',
          summary: 'Runtime compacted summary',
          replacedTokens: 1234,
          sourceDigest: 'digest-123',
          digestMarker: '<compact:digest-123>',
          sourceItemIds: ['item-1', 'item-2'],
          auto: false
        }
        yield {
          kind: 'goal_updated',
          threadId: 'thread-1',
          seq: 9,
          timestamp: '2026-06-02T00:00:03.000Z',
          goal: {
            threadId: 'thread-1',
            objective: 'Finish the migration',
            status: 'active',
            tokensUsed: 10,
            timeUsedSeconds: 5,
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:03.000Z'
          }
        }
        yield {
          kind: 'goal_cleared',
          threadId: 'thread-1',
          seq: 10,
          timestamp: '2026-06-02T00:00:04.000Z',
          cleared: true
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { runtimeId: 'sciforge', threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'compaction_event',
        threadId: 'thread-1',
        runtimeId: 'sciforge',
        turnId: 'turn-1',
        itemId: 'compact-1',
        seq: 8,
        status: 'success',
        summary: 'Runtime compacted summary',
        detail: 'replacedTokens=1234',
        auto: false,
        replacedTokens: 1234,
        sourceDigest: 'digest-123',
        digestMarker: '<compact:digest-123>',
        sourceItemIds: ['item-1', 'item-2'],
        messagesBefore: 2
      }),
      expect.objectContaining({
        kind: 'goal_event',
        threadId: 'thread-1',
        runtimeId: 'sciforge',
        seq: 9,
        objective: 'Finish the migration',
        status: 'active',
        cleared: false
      }),
      expect.objectContaining({
        kind: 'goal_event',
        threadId: 'thread-1',
        runtimeId: 'sciforge',
        seq: 10,
        cleared: true
      })
    ])
  })
})
