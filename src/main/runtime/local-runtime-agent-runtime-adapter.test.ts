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
  it('persists synthetic execution-integrity errors through the runtime event log', async () => {
    const request = vi.fn(async (_settings, pathAndQuery, init) => jsonResponse({
      kind: 'error',
      seq: 9,
      timestamp: '2026-07-13T00:00:00.000Z',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'integrity-1',
      code: 'runtime_execution_incomplete',
      message: 'Completion rejected.',
      details: 'Open calls: call-1.',
      severity: 'error',
      requestMethod: init.method,
      requestPath: pathAndQuery
    }))
    const adapter = createLocalRuntimeAgentRuntimeAdapter({ request })
    const event = await adapter.publishSyntheticEvent?.({ settings: buildSettings() }, {
      kind: 'error',
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'integrity-1',
      recoverable: true,
      severity: 'error',
      code: 'runtime_execution_incomplete',
      message: 'Completion rejected.',
      detail: 'Open calls: call-1.'
    })

    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      '/v1/threads/thread-1/events',
      expect.objectContaining({ method: 'POST' })
    )
    expect(event).toMatchObject({
      kind: 'error',
      runtimeId: 'sciforge',
      code: 'runtime_execution_incomplete',
      detail: 'Open calls: call-1.'
    })
  })

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

  it('reads sidebar probes from the lightweight local runtime endpoint', async () => {
    const request = vi.fn(async (
      _settings: AppSettingsV1,
      pathAndQuery: string,
      _init: { method?: string }
    ) => {
      if (pathAndQuery === '/v1/threads/thread-1/sidebar-probe') {
        return jsonResponse({ threadId: 'thread-1', text: ' real prompt ' })
      }
      throw new Error(`Unexpected request: ${pathAndQuery}`)
    })
    const adapter = createLocalRuntimeAgentRuntimeAdapter({ request })
    const context = { settings: buildSettings() }

    await expect(adapter.readThreadSidebarProbe?.(context, {
      runtimeId: 'sciforge',
      threadId: 'thread-1'
    })).resolves.toEqual({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      text: 'real prompt'
    })

    expect(request).toHaveBeenCalledWith(
      context.settings,
      '/v1/threads/thread-1/sidebar-probe',
      { method: 'GET' }
    )
  })

  it('maps structured local runtime thread metadata without using preview as a title fallback', async () => {
    const request = vi.fn(async () => jsonResponse({
      threads: [{
        id: 'child-thread-1',
        title: '',
        name: '',
        preview: 'Preview should stay preview-only',
        updated_at: '2026-06-02T00:00:00.000Z',
        relation: 'side',
        parent_thread_id: 'parent-thread',
        parent_turn_id: 'turn-1',
        thread_source: 'subagent',
        sidebar_visibility: 'side',
        title_source: 'fallback',
        agent_nickname: 'Reviewer',
        agent_role: 'code reviewer'
      }]
    }))
    const adapter = createLocalRuntimeAgentRuntimeAdapter({ request })

    await expect(adapter.listThreads({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      includeSide: true
    })).resolves.toEqual([expect.objectContaining({
      id: 'child-thread-1',
      title: 'Runtime thread',
      preview: 'Preview should stay preview-only',
      relation: 'side',
      parentThreadId: 'parent-thread',
      parentTurnId: 'turn-1',
      threadSource: 'subagent',
      sidebarVisibility: 'side',
      titleSource: 'fallback',
      agentNickname: 'Reviewer',
      agentRole: 'code reviewer'
    })])
  })

  it('reports GUI-Owl computer-use capability through the shared runtime contract', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery) => {
        if (pathAndQuery === '/v1/runtime/info') {
          return jsonResponse({
            capabilities: {
              model: { supportsToolCalling: true },
              mcp: { available: true, toolCount: 1 },
              computerUse: {
                available: true,
                server: 'mcp',
                toolName: 'computer_use',
                backend: 'gui-owl',
                inputIsolation: 'host-approved',
                affectsUserInput: true,
                requiresHostFocus: true,
                usesHostClipboard: false
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
          backend: 'gui-owl',
          inputIsolation: 'host-approved',
          affectsUserInput: true,
          requiresHostFocus: true,
          usesHostClipboard: false
        }
      }
    })
  })

  it('falls back unknown local runtime computer-use backend labels while preserving safety flags', async () => {
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
          backend: 'gui-owl',
          inputIsolation: 'host-approved',
          affectsUserInput: true,
          requiresHostFocus: true,
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

  it('passes side-thread visibility metadata when starting a local runtime thread', async () => {
    const captured: CapturedRequest[] = []
    const adapter = adapterWithCapturedRequests(captured)

    await adapter.startThread({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      workspace: '/tmp/workspace',
      title: 'PDF: selected text',
      relation: 'side',
      threadSource: 'pdf_annotation',
      sidebarVisibility: 'hidden'
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      pathAndQuery: '/v1/threads',
      body: {
        relation: 'side',
        threadSource: 'pdf_annotation',
        sidebarVisibility: 'hidden'
      }
    })
  })

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

  it('forwards trusted native tool context to the local runtime startTurn request', async () => {
    const captured: CapturedRequest[] = []
    const adapter = adapterWithCapturedRequests(captured)

    await adapter.startTurn({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      text: '请查看结果并继续',
      nativeToolContext: { activeToolNames: ['biogym_design'] }
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      pathAndQuery: '/v1/threads/thread-1/turns',
      body: { nativeToolContext: { activeToolNames: ['biogym_design'] } }
    })
  })

  it('forwards a trusted host continuation id and maps a reused handle', async () => {
    const captured: CapturedRequest[] = []
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery, init) => {
        if (init.body) {
          captured.push({
            pathAndQuery,
            body: JSON.parse(init.body) as Record<string, unknown>
          })
        }
        return jsonResponse({
          threadId: 'thread-1',
          turnId: 'turn-existing',
          userMessageItemId: 'item_turn-existing_user',
          reused: true
        })
      })
    })

    const handle = await adapter.startTurn({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      text: 'BioGym stage completed',
      hostRequestId: ' biogym:run-1:stage:8 '
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      pathAndQuery: '/v1/threads/thread-1/turns',
      body: { hostRequestId: 'biogym:run-1:stage:8' }
    })
    expect(handle).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-existing',
      userMessageItemId: 'item_turn-existing_user',
      reused: true
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
        meta: expect.objectContaining({
          sourceItemId: 'tool-call-source',
          callId: 'call-1',
          toolName: 'read_file',
          phase: 'requested',
          factSource: 'model_output',
          evidenceStrength: 'intent',
          arguments: { path: 'draft.md' }
        })
      }),
      expect.objectContaining({
        id: 'tool_call-1',
        status: 'success',
        meta: expect.objectContaining({
          sourceItemId: 'tool-result-source',
          callId: 'call-1',
          toolName: 'read_file',
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          output: 'ok'
        })
      })
    ])
  })

  it('marks failed local runtime tool results as executor failure receipts', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({
        id: 'thread-1',
        title: 'Thread 1',
        updatedAt: '2026-06-02T00:00:00.000Z',
        turns: [{
          id: 'turn-1',
          threadId: 'thread-1',
          status: 'failed',
          items: [{
            id: 'tool-result-source',
            kind: 'tool_result',
            status: 'completed',
            callId: 'call-1',
            toolName: 'read_file',
            output: { code: 'ENOENT', message: 'missing' },
            isError: true
          }]
        }]
      }))
    })

    const detail = await adapter.readThread({ settings: buildSettings() }, {
      runtimeId: 'sciforge',
      threadId: 'thread-1'
    })

    expect(detail.items?.find((item) => item.kind === 'tool')).toEqual(expect.objectContaining({
      id: 'tool_call-1',
      status: 'error',
      detail: expect.stringContaining('ENOENT'),
      meta: expect.objectContaining({
        sourceItemId: 'tool-result-source',
        callId: 'call-1',
        toolName: 'read_file',
        phase: 'failed',
        factSource: 'executor_result',
        evidenceStrength: 'executor_receipt',
        output: { code: 'ENOENT', message: 'missing' }
      })
    }))
  })

  it('maps local runtime todo snapshots and create_plan result metadata', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({
        id: 'thread-1',
        title: 'Thread 1',
        updatedAt: '2026-06-02T00:00:00.000Z',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/workspace',
          relativePath: '.sciforge/plan/replay.md',
          planId: '/workspace:.sciforge/plan/replay.md',
          sourceRequest: 'Replay plan',
          title: 'Replay'
        },
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

    expect(detail.guiPlan).toEqual({
      operation: 'draft',
      workspaceRoot: '/workspace',
      relativePath: '.sciforge/plan/replay.md',
      planId: '/workspace:.sciforge/plan/replay.md',
      sourceRequest: 'Replay plan',
      title: 'Replay'
    })
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
        runtimeId: 'sciforge',
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
        runtimeId: 'sciforge',
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
        callId: 'call-1',
        toolName: 'read_file',
        phase: 'requested',
        factSource: 'model_output',
        evidenceStrength: 'intent',
        meta: expect.objectContaining({
          sourceItemId: 'tool-ready-source',
          callId: 'call-1',
          toolName: 'read_file',
          phase: 'requested',
          factSource: 'model_output',
          evidenceStrength: 'intent',
          readyCount: 1,
          runtimeStatus: 'tool_call_ready'
        })
      })
    ])
  })

  it('preserves tool call arguments and executor results on replayable item snapshots', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'item_created',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 8,
          item: {
            id: 'tool-call-source',
            kind: 'tool_call',
            status: 'pending',
            callId: 'call-1',
            toolName: 'read_file',
            arguments: { path: 'draft.md' }
          }
        }
        yield {
          kind: 'item_completed',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 9,
          item: {
            id: 'tool-result-source',
            kind: 'tool_result',
            status: 'completed',
            callId: 'call-1',
            toolName: 'read_file',
            output: { text: 'contents' },
            isError: false
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
        kind: 'item_snapshot',
        seq: 8,
        itemId: 'tool_call-1',
        item: expect.objectContaining({
          id: 'tool_call-1',
          detail: expect.stringContaining('draft.md'),
          meta: expect.objectContaining({
            sourceItemId: 'tool-call-source',
            callId: 'call-1',
            toolName: 'read_file',
            phase: 'requested',
            factSource: 'model_output',
            evidenceStrength: 'intent',
            arguments: { path: 'draft.md' }
          })
        })
      }),
      expect.objectContaining({
        kind: 'item_snapshot',
        seq: 9,
        itemId: 'tool_call-1',
        item: expect.objectContaining({
          id: 'tool_call-1',
          detail: expect.stringContaining('contents'),
          meta: expect.objectContaining({
            sourceItemId: 'tool-result-source',
            callId: 'call-1',
            toolName: 'read_file',
            phase: 'succeeded',
            factSource: 'executor_result',
            evidenceStrength: 'executor_receipt',
            output: { text: 'contents' }
          })
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

  it('maps local runtime approval status onto the shared decision shape', async () => {
    const adapter = createLocalRuntimeAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'approval_requested',
          threadId: 'thread-1',
          turnId: 'turn-1',
          approvalId: 'approval-1',
          toolName: 'biogym_design',
          status: 'pending',
          summary: 'Run biogym_design(operation="start")',
          seq: 9,
          timestamp: '2026-06-02T00:00:03.000Z'
        }
        yield {
          kind: 'approval_resolved',
          threadId: 'thread-1',
          turnId: 'turn-1',
          approvalId: 'approval-1',
          toolName: 'biogym_design',
          status: 'allowed',
          summary: 'Run biogym_design(operation="start")',
          seq: 10,
          timestamp: '2026-06-02T00:00:04.000Z'
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
        kind: 'approval_requested',
        threadId: 'thread-1',
        turnId: 'turn-1',
        approvalId: 'approval-1',
        toolName: 'biogym_design',
        summary: 'Run biogym_design(operation="start")'
      }),
      expect.objectContaining({
        kind: 'approval_resolved',
        threadId: 'thread-1',
        turnId: 'turn-1',
        approvalId: 'approval-1',
        decision: 'allowed',
        message: 'Run biogym_design(operation="start")'
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
                threadRef: {
                  runtime: 'sciforge',
                  threadId: 'child-thread-1',
                  turnId: 'child-turn-1',
                  url: 'sciforge://threads/child-thread-1'
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
      runtimeId: 'sciforge',
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
          openAsThreadRef: {
            runtimeId: 'sciforge',
            threadId: 'child-thread-1',
            relation: 'side',
            url: 'sciforge://threads/child-thread-1',
            title: 'research',
            metadata: { turnId: 'child-turn-1' }
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
      runtimeId: 'sciforge',
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
