import { describe, expect, it, vi } from 'vitest'
import { createCodexAgentRuntimeAdapter } from './codex-agent-runtime-adapter'

describe('createCodexAgentRuntimeAdapter', () => {
  it('reports shared research MCP capability when Codex managed config includes it', async () => {
    const adapter = createCodexAgentRuntimeAdapter({
      isResearchMcpConfigured: () => true
    } as never)

    const caps = await adapter.capabilities({ settings: {} as never })
    expect(caps.tools.research).toMatchObject({
      available: true,
      server: 'mcp',
      toolName: 'research_search',
      sources: ['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns'],
      maxResults: 10
    })
    expect(caps.tools.mcp).toMatchObject({
      available: true,
      degraded: true,
      toolCount: 1
    })

    await expect(adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'getToolDiagnostics'
    })).resolves.toMatchObject({
      mcpServers: [{
        id: 'gui_research',
        status: 'configured',
        toolCount: 1,
        tools: ['research_search']
      }]
    })
  })

  it('reports shared computer-use MCP capability for Codex', async () => {
    const adapter = createCodexAgentRuntimeAdapter({
      isMcpConfigured: () => true,
      isResearchMcpConfigured: () => false,
      isComputerUseMcpConfigured: () => true
    } as never)

    const caps = await adapter.capabilities({ settings: {} as never })
    expect(caps.tools.mcp).toMatchObject({
      available: true,
      toolCount: 1
    })
    expect(caps.tools.computerUse).toMatchObject({
      available: true,
      server: 'mcp',
      toolName: 'computer_use'
    })
    expect(caps.tools.research).toMatchObject({
      available: false
    })

    await expect(adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'getToolDiagnostics'
    })).resolves.toMatchObject({
      mcpServers: [{
        id: 'gui_owl_computer_use',
        status: 'configured',
        toolCount: 1,
        tools: ['computer_use']
      }]
    })
  })

  it('honors shared subagent capability settings', async () => {
    const adapter = createCodexAgentRuntimeAdapter({} as never)

    const caps = await adapter.capabilities({
      settings: {
        agentCapabilities: {
          subagents: {
            enabled: false,
            maxParallel: 2,
            maxChildRuns: 4
          }
        }
      } as never
    })

    expect(caps.tools.subagents).toMatchObject({
      available: false,
      maxParallel: 2,
      maxChildren: 4
    })

    await expect(adapter.auxiliary!({
      settings: {
        agentCapabilities: {
          subagents: {
            enabled: false,
            maxParallel: 2,
            maxChildRuns: 4
          }
        }
      } as never
    }, {
      runtimeId: 'codex',
      operation: 'getRuntimeInfo'
    })).resolves.toMatchObject({
      capabilities: {
        subagents: {
          available: false,
          maxParallel: 2,
          maxChildren: 4,
          maxChildRuns: 4
        }
      }
    })
  })

  it('keeps GUI thread ids public while exposing the Codex backend thread id separately', async () => {
    const service = {
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [{
          id: 'gui-thread-1',
          codexThreadId: 'codex-thread-1',
          title: 'Recovered Codex',
          updatedAt: '2026-06-21T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent'
        }]
      })),
      startTurn: vi.fn(async () => ({
        ok: true as const,
        threadId: 'gui-thread-1',
        turnId: 'turn-1',
        userMessageItemId: 'user-1'
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    await expect(adapter.listThreads({ settings: {} as never }, {
      runtimeId: 'codex',
      includeArchived: true
    })).resolves.toEqual([expect.objectContaining({
      id: 'gui-thread-1',
      backendThreadId: 'codex-thread-1'
    })])

    await expect(adapter.startTurn({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      text: 'continue'
    })).resolves.toEqual({
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })
  })

  it('maps structured Codex thread metadata without using preview as a title fallback', async () => {
    const service = {
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [{
          id: 'gui-child-thread',
          codexThreadId: 'codex-child-thread',
          title: '',
          updatedAt: '2026-06-21T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent',
          preview: 'Preview should stay preview-only',
          relation: 'side' as const,
          parentThreadId: 'parent-thread',
          parentTurnId: 'turn-1',
          threadSource: 'subagent',
          sidebarVisibility: 'side' as const,
          titleSource: 'fallback',
          agentNickname: 'Reviewer',
          agentRole: 'code reviewer'
        }]
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    await expect(adapter.listThreads({ settings: {} as never }, {
      runtimeId: 'codex',
      includeSide: true
    })).resolves.toEqual([expect.objectContaining({
      id: 'gui-child-thread',
      backendThreadId: 'codex-child-thread',
      title: 'Codex thread',
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

  it('keeps Codex thread blocks grouped by their source turn id', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 4,
          latestTurnId: 'turn-2',
          threadStatus: 'completed',
          blocks: [
            { kind: 'user' as const, id: 'user-1', turnId: 'turn-1', text: 'Q1' },
            { kind: 'assistant' as const, id: 'assistant-1', turnId: 'turn-1', text: 'R1' },
            { kind: 'user' as const, id: 'user-2', turnId: 'turn-2', text: 'Q2' },
            { kind: 'assistant' as const, id: 'assistant-2', turnId: 'turn-2', text: 'R2' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.latestTurnId).toBe('turn-2')
    expect(detail.turns?.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2'])
    expect(detail.turns?.find((turn) => turn.id === 'turn-1')?.items?.map((item) => item.text)).toEqual(['Q1', 'R1'])
    expect(detail.turns?.find((turn) => turn.id === 'turn-2')?.items?.map((item) => item.text)).toEqual(['Q2', 'R2'])
  })

  it('keeps numeric Codex approval request ids instead of falling back to item ids', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 1,
          latestTurnId: 'turn-1',
          blocks: [
            {
              kind: 'tool' as const,
              id: 'call_approval',
              turnId: 'turn-1',
              summary: 'Command approval requested',
              status: 'running' as const,
              toolKind: 'command_execution' as const,
              meta: {
                codexRequestId: 39,
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/commandExecution/requestApproval'
              }
            }
          ]
        }
      })),
      readStoredEvents: vi.fn(async () => [
        {
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 1,
          tool: {
            itemId: 'call_approval',
            summary: 'Command approval requested',
            status: 'running' as const,
            toolKind: 'command_execution' as const,
            meta: {
              codexRequestId: 39,
              codexRequestKind: 'approval',
              codexRequestMethod: 'item/commandExecution/requestApproval'
            }
          }
        }
      ])
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })
    const approval = detail.turns?.[0]?.items?.[0]
    expect(approval).toMatchObject({
      id: 'call_approval',
      kind: 'approval',
      turnId: 'turn-1',
      meta: expect.objectContaining({
        approvalId: '39',
        codexRequestId: 39
      })
    })

    const events = []
    for await (const event of adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'approval_requested',
        itemId: 'call_approval',
        approvalId: '39'
      })
    ])
  })

  it('keeps stale approval blocks on their original turn instead of attaching them to the latest turn', async () => {
    const service = {
      pendingServerRequests: vi.fn(() => []),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 3,
          latestTurnId: 'turn-2',
          threadStatus: 'running',
          blocks: [
            {
              kind: 'tool' as const,
              id: 'call_approval',
              turnId: 'turn-1',
              summary: 'Command approval requested',
              status: 'running' as const,
              toolKind: 'command_execution' as const,
              meta: {
                codexRequestId: 4,
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/commandExecution/requestApproval'
              }
            },
            { kind: 'user' as const, id: 'user-2', turnId: 'turn-2', text: 'continue' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.latestTurnId).toBe('turn-2')
    expect(detail.turns?.find((turn) => turn.id === 'turn-1')?.items).toEqual([
      expect.objectContaining({
        id: 'call_approval',
        kind: 'approval',
        turnId: 'turn-1',
        status: 'error'
      })
    ])
    expect(detail.turns?.find((turn) => turn.id === 'turn-2')?.items).toEqual([
      expect.objectContaining({
        id: 'user-2',
        kind: 'user_message',
        turnId: 'turn-2'
      })
    ])
  })

  it('marks stale pending approvals from failed Codex threads as errors', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 2,
          latestTurnId: 'turn-1',
          threadStatus: 'failed',
          blocks: [
            {
              kind: 'tool' as const,
              id: 'call_approval',
              turnId: 'turn-1',
              summary: 'Command approval requested',
              status: 'running' as const,
              toolKind: 'command_execution' as const,
              meta: {
                codexRequestId: 4,
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/commandExecution/requestApproval'
              }
            }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.status).toBe('failed')
    expect(detail.turns?.[0]).toMatchObject({ id: 'turn-1', status: 'failed' })
    expect(detail.items).toEqual([
      expect.objectContaining({
        id: 'call_approval',
        kind: 'approval',
        status: 'error',
        meta: expect.objectContaining({
          approvalId: '4',
          codexRequestId: 4
        })
      })
    ])
  })

  it('marks pending approval blocks stale when the app-server registry no longer has the request', async () => {
    const service = {
      pendingServerRequests: vi.fn(() => []),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 2,
          latestTurnId: 'turn-1',
          threadStatus: 'running',
          blocks: [
            {
              kind: 'tool' as const,
              id: 'call_approval',
              turnId: 'turn-1',
              summary: 'Command approval requested',
              status: 'running' as const,
              toolKind: 'command_execution' as const,
              meta: {
                codexRequestId: 4,
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/commandExecution/requestApproval'
              }
            }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.items).toEqual([
      expect.objectContaining({
        id: 'call_approval',
        kind: 'approval',
        status: 'error'
      })
    ])
  })

  it('keeps pending approval blocks live while the app-server registry still has the request', async () => {
    const service = {
      pendingServerRequests: vi.fn(() => [{ requestId: 4 }]),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 2,
          latestTurnId: 'turn-1',
          threadStatus: 'running',
          blocks: [
            {
              kind: 'tool' as const,
              id: 'call_approval',
              turnId: 'turn-1',
              summary: 'Command approval requested',
              status: 'running' as const,
              toolKind: 'command_execution' as const,
              meta: {
                codexRequestId: 4,
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/commandExecution/requestApproval'
              }
            }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.items).toEqual([
      expect.objectContaining({
        id: 'call_approval',
        kind: 'approval',
        status: 'pending'
      })
    ])
  })

  it('maps interrupted Codex thread status to an aborted turn instead of inferring running', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 1,
          latestTurnId: 'turn-1',
          threadStatus: 'interrupted',
          blocks: [
            { kind: 'user' as const, id: 'user-1', turnId: 'turn-1', text: 'Q1' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.turns?.[0]).toMatchObject({
      id: 'turn-1',
      status: 'aborted'
    })
  })

  it('keeps a Codex turn running while later tools are still active after a tool error', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 4,
          latestTurnId: 'turn-1',
          blocks: [
            { kind: 'user' as const, id: 'user-1', turnId: 'turn-1', text: 'check downloads' },
            {
              kind: 'tool' as const,
              id: 'grep-1',
              turnId: 'turn-1',
              summary: 'grep no matches',
              status: 'error' as const,
              toolKind: 'command_execution' as const,
              detail: 'exit code 1'
            },
            {
              kind: 'tool' as const,
              id: 'verify-1',
              turnId: 'turn-1',
              summary: 'verify PDFs',
              status: 'running' as const,
              toolKind: 'command_execution' as const
            }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.turns?.[0]).toMatchObject({
      id: 'turn-1',
      status: 'running'
    })
  })

  it('maps stored Codex user display text to runtime events', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => [
        {
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 1,
          userMessage: {
            itemId: 'user-1',
            turnId: 'turn-1',
            text: 'expanded runtime prompt',
            displayText: 'short user prompt',
            createdAt: '2026-06-11T00:00:00.000Z'
          }
        }
      ])
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)
    const events = []

    for await (const event of adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'user_message',
        itemId: 'user-1',
        text: 'expanded runtime prompt',
        displayText: 'short user prompt'
      })
    ])
  })

  it('maps terminal Codex runtime errors to turn lifecycle events', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => [
        {
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 1,
          runtimeError: {
            itemId: 'err-1',
            message: 'provider failed',
            code: 'provider_error',
            severity: 'error' as const
          }
        },
        {
          threadId: 'thread-1',
          turnId: 'turn-2',
          seq: 2,
          runtimeError: {
            itemId: 'cancel-1',
            message: 'Codex turn cancelled.',
            code: 'cancelled',
            severity: 'warning' as const
          }
        },
        {
          threadId: 'thread-1',
          turnId: 'turn-3',
          seq: 3,
          runtimeError: {
            itemId: 'abort-1',
            message: 'Codex turn aborted.',
            code: 'aborted',
            severity: 'warning' as const
          }
        },
        {
          threadId: 'thread-1',
          turnId: 'turn-4',
          seq: 4,
          runtimeError: {
            itemId: 'recover-1',
            message: 'stream recovering',
            code: 'stream_recovering',
            severity: 'error' as const
          }
        }
      ])
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)
    const events = []

    for await (const event of adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })) {
      events.push(event)
    }

    expect(events.filter((event) => event.kind === 'turn_lifecycle')).toEqual([
      expect.objectContaining({ turnId: 'turn-1', state: 'failed', message: 'provider failed' }),
      expect.objectContaining({ turnId: 'turn-2', state: 'cancelled', message: 'Codex turn cancelled.' }),
      expect.objectContaining({ turnId: 'turn-3', state: 'aborted', message: 'Codex turn aborted.' })
    ])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime_status',
        turnId: 'turn-4',
        phase: 'stream_recovering',
        message: 'stream recovering'
      })
    ]))
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        turnId: 'turn-4',
        code: 'stream_recovering'
      })
    ]))
  })

  it('maps stored Codex child events and lists direct children for the requested thread only', async () => {
    const childStarted = {
      id: 'collab-1',
      runtimeId: 'codex' as const,
      parentThreadId: 'parent-thread',
      parentTurnId: 'turn-1',
      kind: 'agent' as const,
      status: 'running' as const,
      name: 'Reviewer',
      prompt: 'Review the diff',
      openAsThreadRef: {
        runtimeId: 'codex' as const,
        threadId: 'child-thread',
        relation: 'side' as const
      }
    }
    const childCompleted = {
      ...childStarted,
      status: 'completed' as const,
      summary: 'Found one issue.'
    }
    const service = {
      readStoredEvents: vi.fn(async (threadId: string) => threadId === 'parent-thread'
        ? [
            { threadId, turnId: 'turn-1', seq: 1, child: childStarted },
            { threadId, turnId: 'turn-1', seq: 2, child: childCompleted },
            {
              threadId,
              turnId: 'turn-1',
              seq: 3,
              child: {
                ...childCompleted,
                id: 'duplicate-call-id'
              }
            },
            {
              threadId,
              turnId: 'turn-1',
              seq: 4,
              child: {
                ...childCompleted,
                id: 'other-child',
                parentThreadId: 'other-thread'
              }
            }
          ]
        : []),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 2,
          blocks: [
            { kind: 'user' as const, id: 'child-user', text: 'Review the diff' },
            { kind: 'assistant' as const, id: 'child-assistant', text: 'Found one issue.' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const events = []
    for await (const event of adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'parent-thread'
    })) {
      events.push(event)
    }
    expect(events.filter((event) => event.kind === 'child_event').map((event) => event.child.id)).toContain('collab-1')

    const listed = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: { threadId: 'parent-thread' }
    })

    expect(listed).toMatchObject({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      children: [{
        id: 'collab-1',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1',
        status: 'completed',
        prompt: 'Review the diff',
        summary: 'Found one issue.',
        openAsThreadRef: {
          runtimeId: 'codex',
          threadId: 'child-thread',
          relation: 'side'
        }
      }]
    })
    expect((listed as { children: Array<{ id: string }> }).children.map((child) => child.id)).toEqual(['collab-1'])

    const transcript = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: { parentThreadId: 'parent-thread', childId: 'collab-1' }
    })

    expect(service.readThread).toHaveBeenCalledWith('child-thread')
    expect(transcript).toMatchObject({
      transcript: {
        runtimeId: 'codex',
        parentThreadId: 'parent-thread',
        childId: 'collab-1',
        entries: [
          { id: 'child-user', kind: 'user_message', text: 'Review the diff' },
          { id: 'child-assistant', kind: 'assistant_message', text: 'Found one issue.' }
        ],
        metadata: {
          source: 'openAsThreadRef',
          threadId: 'child-thread'
        }
      }
    })
  })

  it('normalizes raw Codex child event aliases before replaying and listing children', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => [
        {
          threadId: 'parent-thread',
          turnId: 'turn-1',
          seq: 1,
          child: {
            child_id: 'workflow-1',
            parent_thread_id: 'parent-thread',
            parent_turn_id: 'turn-1',
            kind: 'workflow',
            status: 'done',
            name: 'release-check',
            summary: 'Release checks passed.',
            openAsThreadRef: {
              thread_id: 'workflow-thread'
            },
            transcriptRef: {
              transcript_id: 'workflow-thread',
              source: 'codex-workflow'
            }
          }
        }
      ])
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const events = []
    for await (const event of adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'parent-thread'
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'child_event',
        child: expect.objectContaining({
          id: 'workflow-1',
          runtimeId: 'codex',
          parentThreadId: 'parent-thread',
          parentTurnId: 'turn-1',
          kind: 'workflow',
          status: 'completed',
          openAsThreadRef: {
            runtimeId: 'codex',
            threadId: 'workflow-thread',
            relation: 'side'
          },
          transcriptRef: expect.objectContaining({
            runtimeId: 'codex',
            childId: 'workflow-1',
            transcriptId: 'workflow-thread',
            source: 'codex-workflow'
          })
        })
      })
    ])

    await expect(adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: { threadId: 'parent-thread', parentTurnId: 'turn-1' }
    })).resolves.toMatchObject({
      children: [{
        id: 'workflow-1',
        kind: 'workflow',
        status: 'completed',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1'
      }]
    })
  })

  it('lists native Codex subagent threads for the active parent thread', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => []),
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [
          {
            id: 'native-child',
            title: 'Reviewer',
            updatedAt: '2026-06-21T00:00:01.000Z',
            model: 'gpt-5',
            mode: 'agent',
            status: 'running',
            preview: 'Reviewing the patch',
            latestTurnStatus: 'running',
            parentThreadId: 'parent-thread',
            parentTurnId: 'turn-1',
            relation: 'side' as const,
            threadSource: 'subagent',
            agentNickname: 'Reviewer',
            agentRole: 'code reviewer'
          },
          {
            id: 'other-native-child',
            title: 'Other',
            updatedAt: '2026-06-21T00:00:02.000Z',
            model: 'gpt-5',
            mode: 'agent',
            status: 'running',
            parentThreadId: 'other-thread',
            threadSource: 'subagent'
          }
        ]
      })),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 1,
          blocks: [
            { kind: 'assistant' as const, id: 'native-assistant', text: 'Native child transcript.' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const listed = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: { threadId: 'parent-thread', parentTurnId: 'turn-1' }
    })

    expect(service.listThreads).toHaveBeenCalledWith({ includeArchived: true, includeSide: true })
    expect(listed).toMatchObject({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      parentTurnId: 'turn-1',
      children: [{
        id: 'native-child',
        runtimeId: 'codex',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1',
        kind: 'thread',
        status: 'running',
        name: 'Reviewer',
        label: 'code reviewer',
        summary: 'Reviewing the patch',
        openAsThreadRef: {
          runtimeId: 'codex',
          threadId: 'native-child',
          relation: 'side',
          title: 'Reviewer'
        },
        transcriptRef: {
          runtimeId: 'codex',
          childId: 'native-child',
          transcriptId: 'native-child',
          source: 'codex-thread'
        }
      }]
    })

    const transcript = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: { parentThreadId: 'parent-thread', parentTurnId: 'turn-1', childId: 'native-child' }
    })

    expect(service.readThread).toHaveBeenCalledWith('native-child')
    expect(transcript).toMatchObject({
      transcript: {
        runtimeId: 'codex',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1',
        childId: 'native-child',
        entries: [
          { id: 'native-assistant', kind: 'assistant_message', text: 'Native child transcript.' }
        ],
        metadata: {
          source: 'openAsThreadRef',
          threadId: 'native-child'
        }
      }
    })
  })

  it('deduplicates a native child thread and collab event that reference the same thread', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => [{
        threadId: 'parent-thread',
        turnId: 'turn-1',
        seq: 1,
        child: {
          id: 'collab-call-1',
          runtimeId: 'codex' as const,
          parentThreadId: 'parent-thread',
          parentTurnId: 'turn-1',
          kind: 'agent' as const,
          status: 'completed' as const,
          name: 'Reviewer',
          prompt: 'Review the patch',
          summary: 'The patch looks good.',
          openAsThreadRef: {
            runtimeId: 'codex' as const,
            threadId: 'native-child',
            relation: 'side' as const
          },
          transcriptRef: {
            runtimeId: 'codex' as const,
            childId: 'collab-call-1',
            transcriptId: 'native-child',
            source: 'codex-multi-agent'
          },
          updatedAt: '2026-06-21T00:00:02.000Z'
        }
      }]),
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [{
          id: 'native-child',
          title: 'Reviewer thread',
          updatedAt: '2026-06-21T00:00:01.000Z',
          model: 'gpt-5',
          mode: 'agent',
          status: 'running',
          latestTurnStatus: 'running',
          parentThreadId: 'parent-thread',
          parentTurnId: 'turn-1',
          relation: 'side' as const,
          threadSource: 'subagent',
          agentNickname: 'Reviewer',
          agentRole: 'code reviewer'
        }]
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const listed = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: { threadId: 'parent-thread', parentTurnId: 'turn-1' }
    })

    expect(listed).toMatchObject({
      metadata: { totalChildren: 1 },
      children: [{
        id: 'native-child',
        kind: 'thread',
        status: 'completed',
        prompt: 'Review the patch',
        summary: 'The patch looks good.',
        openAsThreadRef: {
          threadId: 'native-child',
          title: 'Reviewer thread'
        },
        transcriptRef: {
          childId: 'native-child',
          transcriptId: 'native-child',
          source: 'codex-thread'
        },
        metadata: {
          source: 'codex.threadSource',
          threadSource: 'subagent'
        }
      }]
    })
    expect((listed as { children: Array<{ id: string }> }).children).toHaveLength(1)
  })

  it('returns a degraded child transcript when Codex exposes no real child thread', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => [{
        threadId: 'parent-thread',
        turnId: 'turn-1',
        seq: 1,
        child: {
          id: 'summary-only',
          runtimeId: 'codex' as const,
          parentThreadId: 'parent-thread',
          parentTurnId: 'turn-1',
          kind: 'agent' as const,
          status: 'completed' as const,
          prompt: 'Summarize the logs',
          summary: 'No transcript was exposed.'
        }
      }]),
      readThread: vi.fn()
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const transcript = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: { parentThreadId: 'parent-thread', childId: 'summary-only' }
    })

    expect(service.readThread).not.toHaveBeenCalled()
    expect(transcript).toMatchObject({
      transcript: {
        childId: 'summary-only',
        degraded: true,
        reason: 'Codex app-server did not expose a real child thread transcript.',
        entries: [
          { kind: 'user_message', text: 'Summarize the logs' },
          { kind: 'assistant_message', text: 'No transcript was exposed.' }
        ]
      }
    })
  })
})
