import { describe, expect, it, vi } from 'vitest'
import {
  createCodexAppServerPendingRequestRegistry,
  type CodexAppServerPendingRequest
} from '@sciforge/codex-runtime/app-server'

describe('Codex app-server pending request registry', () => {
  it('captures known approval and user-input request ids without resolving them', async () => {
    const observed: CodexAppServerPendingRequest[] = []
    const registry = createCodexAppServerPendingRequestRegistry({
      onPendingRequest: (request) => observed.push(request)
    })

    const approval = registry.handle({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        command: 'npm test',
        providerPayload: { apiKey: 'secret' }
      }
    })
    const input = registry.handle({
      id: 'input-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-1',
        questions: [{ id: 'q1', question: 'Pick one' }]
      }
    })

    expect(observed).toEqual([
      expect.objectContaining({
        requestId: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        kind: 'approval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        summary: 'Command approval requested'
      }),
      expect.objectContaining({
        requestId: 'input-1',
        method: 'item/tool/requestUserInput',
        kind: 'user_input',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-1',
        summary: 'User input requested'
      })
    ])
    expect(registry.pending()).toHaveLength(2)

    registry.resolveApproval({ requestId: 'approval-1', decision: 'denied' })
    registry.resolveUserInput({
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'A' }]
    })

    await expect(approval).resolves.toEqual({ decision: 'decline' })
    await expect(input).resolves.toEqual({ answers: { q1: { answers: ['A'] } } })
    expect(registry.pending()).toEqual([])
  })

  it('resolves numeric app-server request ids from string IPC payloads', async () => {
    const registry = createCodexAppServerPendingRequestRegistry()

    const approval = registry.handle({
      id: 39,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        command: 'npm test'
      }
    })

    expect(registry.pending()).toEqual([
      expect.objectContaining({
        requestId: 39,
        kind: 'approval'
      })
    ])

    registry.resolveApproval({ requestId: '39', decision: 'denied' })

    await expect(approval).resolves.toEqual({ decision: 'decline' })
    expect(registry.pending()).toEqual([])
  })

  it('captures current MCP elicitation requests as user-input requests', async () => {
    const observed: CodexAppServerPendingRequest[] = []
    const registry = createCodexAppServerPendingRequestRegistry({
      onPendingRequest: (request) => observed.push(request)
    })

    const input = registry.handle({
      id: 'input-mcp',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-mcp',
        questions: [{ id: 'q1', question: 'Pick one' }]
      }
    })

    expect(observed).toEqual([
      expect.objectContaining({
        requestId: 'input-mcp',
        method: 'mcpServer/elicitation/request',
        kind: 'user_input',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-mcp',
        summary: 'MCP input requested'
      })
    ])

    registry.resolveUserInput({
      requestId: 'input-mcp',
      answers: [{ id: 'q1', value: 'A' }]
    })

    await expect(input).resolves.toEqual({ action: 'accept', content: { q1: 'A' } })
  })

  it('fails legacy user-input aliases closed', async () => {
    const onPendingRequest = vi.fn()
    const onUnknownRequest = vi.fn()
    const registry = createCodexAppServerPendingRequestRegistry({
      onPendingRequest,
      onUnknownRequest
    })

    for (const method of [
      'item/userInput/request',
      'item/userInput/requested',
      'userInput/request',
      'user_input/request',
      'request_user_input',
      'item/requestUserInput'
    ]) {
      await expect(registry.handle({
        id: `input-${method}`,
        method,
        params: { threadId: 'thread-1' }
      })).rejects.toThrow(`Unsupported Codex app-server request: ${method}`)
    }

    expect(onPendingRequest).not.toHaveBeenCalled()
    expect(onUnknownRequest).toHaveBeenCalledTimes(6)
    expect(registry.pending()).toEqual([])
  })

  it('classifies current approval methods with consistent summaries and denial responses', async () => {
    const observed: CodexAppServerPendingRequest[] = []
    const registry = createCodexAppServerPendingRequestRegistry({
      onPendingRequest: (request) => observed.push(request)
    })

    const command = registry.handle({
      id: 'approval-exec',
      method: 'execCommandApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1' }
    })
    const patch = registry.handle({
      id: 'approval-patch',
      method: 'applyPatchApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1' }
    })

    expect(observed).toEqual([
      expect.objectContaining({
        requestId: 'approval-exec',
        method: 'execCommandApproval',
        kind: 'approval',
        summary: 'Command approval requested'
      }),
      expect.objectContaining({
        requestId: 'approval-patch',
        method: 'applyPatchApproval',
        kind: 'approval',
        summary: 'File change approval requested'
      })
    ])

    registry.resolveApproval({ requestId: 'approval-exec', decision: 'denied' })
    registry.resolveApproval({ requestId: 'approval-patch', decision: 'denied' })

    await expect(command).resolves.toEqual({ decision: 'decline' })
    await expect(patch).resolves.toEqual({ decision: 'decline' })
  })

  it('routes dynamic tool call requests to the configured handler without queuing them', async () => {
    const onToolCallRequest = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: 'tool-ok' }],
      success: true
    }))
    const registry = createCodexAppServerPendingRequestRegistry({ onToolCallRequest })

    await expect(registry.handle({
      id: 'tool-request-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-1',
        namespace: 'mcp_server',
        tool: 'lookup',
        arguments: { id: 'ABC-123' }
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'tool-ok' }],
      success: true
    })
    expect(onToolCallRequest).toHaveBeenCalledWith({
      requestId: 'tool-request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: 'mcp_server',
      tool: 'lookup',
      arguments: { id: 'ABC-123' }
    })
    expect(registry.pending()).toEqual([])
  })

  it('normalizes dotted params.tool values when app-server omits namespace', async () => {
    const onToolCallRequest = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: 'tool-ok' }],
      success: true
    }))
    const registry = createCodexAppServerPendingRequestRegistry({ onToolCallRequest })

    await expect(registry.handle({
      id: 'tool-request-dotted',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        tool: 'mcp_server.lookup',
        arguments: { id: 'ABC-123' }
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'tool-ok' }],
      success: true
    })
    expect(onToolCallRequest).toHaveBeenCalledWith({
      requestId: 'tool-request-dotted',
      threadId: 'thread-1',
      callId: undefined,
      namespace: 'mcp_server',
      tool: 'lookup',
      arguments: { id: 'ABC-123' }
    })
    expect(registry.pending()).toEqual([])
  })

  it('normalizes dotted multi-agent dynamic tool names', async () => {
    const onToolCallRequest = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: 'child-ok' }],
      success: true
    }))
    const registry = createCodexAppServerPendingRequestRegistry({ onToolCallRequest })

    await expect(registry.handle({
      id: 'tool-request-multi-agent',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tool: 'multi_agent_v1.spawn_agent',
        arguments: { prompt: 'Run child' }
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'child-ok' }],
      success: true
    })
    expect(onToolCallRequest).toHaveBeenCalledWith({
      requestId: 'tool-request-multi-agent',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: undefined,
      namespace: 'multi_agent_v1',
      tool: 'spawn_agent',
      arguments: { prompt: 'Run child' }
    })
    expect(registry.pending()).toEqual([])
  })

  it('fails legacy dynamic tool name fallbacks closed', async () => {
    const onToolCallRequest = vi.fn()
    const onUnknownRequest = vi.fn()
    const registry = createCodexAppServerPendingRequestRegistry({
      onToolCallRequest,
      onUnknownRequest
    })

    for (const params of [
      { toolName: 'mcp_server.lookup' },
      { name: 'mcp_server.lookup' }
    ]) {
      await expect(registry.handle({
        id: `tool-request-${Object.keys(params)[0]}`,
        method: 'item/tool/call',
        params
      })).rejects.toThrow('Unsupported Codex app-server request: item/tool/call')
    }

    expect(onToolCallRequest).not.toHaveBeenCalled()
    expect(onUnknownRequest).toHaveBeenCalledTimes(2)
    expect(registry.pending()).toEqual([])
  })

  it('fails unknown server-originated requests closed and emits a safe visible error', async () => {
    const onUnknownRequest = vi.fn()
    const registry = createCodexAppServerPendingRequestRegistry({ onUnknownRequest })

    await expect(registry.handle({
      id: 'unknown-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        rawJson: { token: 'secret' }
      }
    })).rejects.toThrow('Unsupported Codex app-server request: item/tool/call')

    expect(onUnknownRequest).toHaveBeenCalledWith({
      requestId: 'unknown-1',
      method: 'item/tool/call',
      threadId: 'thread-1',
      turnId: undefined,
      message: 'Codex requested an unsupported operation and it was declined.'
    })
  })
})
