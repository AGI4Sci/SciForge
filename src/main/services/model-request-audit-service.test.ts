import { describe, expect, it } from 'vitest'
import { ModelRequestAuditRecorder } from './model-request-audit-service'
import type { AgentRuntimeEvent } from '../../shared/agent-runtime-contract'

describe('ModelRequestAuditRecorder', () => {
  it('keeps a newest-first in-memory ring buffer and clears it', () => {
    const recorder = new ModelRequestAuditRecorder(2)

    recorder.start({
      runtimeId: 'codex',
      threadId: 'thread-1',
      model: 'alias-a',
      request: { runtimeId: 'codex', threadId: 'thread-1', text: 'one', workspace: '/Users/test/project' }
    })
    recorder.start({
      runtimeId: 'codex',
      threadId: 'thread-2',
      model: 'alias-b',
      request: { runtimeId: 'codex', threadId: 'thread-2', text: 'two', workspace: '/Users/test/project' }
    })
    recorder.start({
      runtimeId: 'sciforge',
      threadId: 'thread-3',
      model: 'alias-c',
      request: { runtimeId: 'sciforge', threadId: 'thread-3', text: 'three', workspace: '/Users/test/project' }
    })

    expect(recorder.snapshot().map((record) => record.threadId)).toEqual(['thread-3', 'thread-2'])
    expect(recorder.snapshot({ runtimeId: 'codex' }).map((record) => record.threadId)).toEqual(['thread-2'])
    expect(recorder.clear()).toBe(true)
    expect(recorder.snapshot()).toEqual([])
  })

  it('attaches runtime events without mutating the event stream payloads', () => {
    const recorder = new ModelRequestAuditRecorder()
    const id = recorder.start({
      runtimeId: 'codex',
      threadId: 'thread-1',
      model: 'deepseek-v4',
      request: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        text: 'look at /Users/alice/secret-project and use token sk-test',
        workspace: '/Users/alice/secret-project'
      }
    })
    recorder.attachTurn(id, 'codex', 'thread-1', 'turn-1')
    const assistantEvent = {
      kind: 'assistant_delta',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      text: 'done in /Users/alice/secret-project'
    } satisfies AgentRuntimeEvent

    recorder.observeEvent(assistantEvent)
    recorder.observeEvent({
      kind: 'tool_event',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      status: 'success',
      summary: 'read_file',
      meta: { callId: 'call-1', toolName: 'read_file', Authorization: 'Bearer secret' }
    })
    recorder.observeEvent({
      kind: 'item_snapshot',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        id: 'tool-snapshot-1',
        kind: 'tool',
        summary: 'run_shell',
        status: 'completed',
        meta: { toolName: 'run_shell', token: 'secret-token' }
      }
    })
    recorder.observeEvent({
      kind: 'runtime_status',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      metadata: { finishReason: 'stop' }
    })
    recorder.observeEvent({
      kind: 'usage',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }
    })
    recorder.observeEvent({
      kind: 'turn_lifecycle',
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      state: 'completed'
    })

    const [record] = recorder.snapshot()
    expect(record.request.bodySummary).toMatchObject({
      schema: 'agent-runtime.turnStart',
      keys: ['runtimeId', 'text', 'threadId', 'workspace'],
      textChars: 57,
      attachmentCount: 0,
      fileReferenceCount: 0,
      hasGuiPlan: false
    })
    expect(record.streamOutput.text).toContain('[path]')
    expect(record.streamOutput.text).not.toContain('/Users/alice')
    expect(record.streamOutput.toolCalls[0]).toMatchObject({
      callId: 'call-1',
      toolName: 'read_file',
      status: 'success'
    })
    expect(record.streamOutput.toolCalls[0]?.arguments).toMatchObject({
      Authorization: '[redacted]'
    })
    expect(record.streamOutput.toolCalls[1]).toMatchObject({
      callId: 'tool-snapshot-1',
      toolName: 'run_shell',
      status: 'success',
      arguments: {
        toolName: 'run_shell',
        token: '[redacted]'
      }
    })
    expect(record.streamOutput.usage?.totalTokens).toBe(14)
    expect(record.streamOutput.stopReason).toBe('stop')
    expect(assistantEvent.text).toBe('done in /Users/alice/secret-project')
  })

  it('redacts inline secrets and absolute paths from requests, streamed output, tools, and errors', () => {
    const recorder = new ModelRequestAuditRecorder()
    const id = recorder.start({
      runtimeId: 'sciforge',
      threadId: 'thread-secret',
      model: 'deepseek-v4',
      modelRouterUrl: 'http://127.0.0.1:1234/v1',
      providerAlias: 'model-router',
      modelAlias: 'public-router-alias',
      modelRouter: {
        requestUrl: 'http://127.0.0.1:1234/v1/responses',
        endpointRoute: 'responses'
      },
      request: {
        runtimeId: 'sciforge',
        threadId: 'thread-secret',
        text: 'Authorization: Bearer super-secret-token in /Users/alice/project',
        workspace: '/Users/alice/project',
        attachmentIds: ['att_1'],
        fileReferences: [
          {
            path: 'docs/private.pdf',
            relativePath: 'docs/private.pdf',
            name: 'private.pdf',
            modelRouterObject: true
          }
        ]
      }
    })
    recorder.attachTurn(id, 'sciforge', 'thread-secret', 'turn-secret')
    recorder.observeEvent({
      kind: 'assistant_delta',
      runtimeId: 'sciforge',
      threadId: 'thread-secret',
      turnId: 'turn-secret',
      itemId: 'assistant-secret',
      text: 'token=abc123 and api_key=xyz789 in /private/tmp/raw.txt'
    })
    recorder.observeEvent({
      kind: 'tool_event',
      runtimeId: 'sciforge',
      threadId: 'thread-secret',
      turnId: 'turn-secret',
      itemId: 'tool-secret',
      status: 'error',
      summary: 'call_api',
      meta: {
        callId: 'call-secret',
        toolName: 'call_api',
        token: 'abc123',
        command: 'curl -H "Authorization: Bearer secret-value" /Users/alice/project/file'
      }
    })
    recorder.observeEvent({
      kind: 'error',
      runtimeId: 'sciforge',
      threadId: 'thread-secret',
      turnId: 'turn-secret',
      recoverable: false,
      severity: 'error',
      message: 'secret=raw-secret at /Users/alice/project/file'
    })

    const record = recorder.snapshot()[0]
    expect(record.providerAlias).toBe('model-router')
    expect(record.modelAlias).toBe('public-router-alias')
    expect(record.modelRouter).toMatchObject({
      providerAlias: 'model-router',
      modelAlias: 'public-router-alias',
      requestUrl: 'http://127.0.0.1:1234/v1/responses',
      endpointRoute: 'responses',
      requestBodySummary: {
        schema: 'model-router.responses.runtime',
        keys: ['input', 'metadata'],
        inputTextChars: 64,
        metadataKeys: ['attachmentIds', 'fileReferences', 'runtimeId', 'threadId', 'workspace'],
        attachmentCount: 1,
        fileReferenceCount: 1,
        inlineContextReferenceCount: 1,
        modelRouterObjectReferenceCount: 1,
        hasGuiPlan: false
      }
    })
    const serialized = JSON.stringify(record)
    expect(serialized).not.toMatch(/super-secret-token|abc123|xyz789|secret-value|raw-secret/)
    expect(serialized).not.toMatch(/\/Users\/alice|\/private\/tmp/)
    expect(serialized).toContain('[redacted]')
    expect(serialized).toContain('[path]')
  })

  it('preserves request identity and records terminal executor proof', () => {
    const recorder = new ModelRequestAuditRecorder()
    const id = recorder.start({
      runtimeId: 'codex',
      threadId: 'thread-proof',
      request: { runtimeId: 'codex', threadId: 'thread-proof', text: 'Run it.' }
    })
    recorder.attachTurn(id, 'codex', 'thread-proof', 'turn-proof')
    recorder.observeEvent({
      kind: 'tool_event',
      runtimeId: 'codex',
      threadId: 'thread-proof',
      turnId: 'turn-proof',
      itemId: 'request-item',
      callId: 'call-proof',
      toolName: 'local_shell',
      status: 'running',
      phase: 'requested',
      factSource: 'model_output',
      evidenceStrength: 'intent',
      meta: { arguments: { cmd: 'pnpm test' } }
    })
    recorder.observeEvent({
      kind: 'tool_event',
      runtimeId: 'codex',
      threadId: 'thread-proof',
      turnId: 'turn-proof',
      itemId: 'result-item',
      callId: 'call-proof',
      status: 'success',
      phase: 'succeeded',
      factSource: 'executor_result',
      evidenceStrength: 'executor_receipt',
      resultDigest: 'sha256:result',
      meta: { output: { exitCode: 0 } }
    })

    expect(recorder.snapshot()[0].streamOutput.toolCalls).toEqual([expect.objectContaining({
      callId: 'call-proof',
      toolName: 'local_shell',
      arguments: { cmd: 'pnpm test' },
      result: { exitCode: 0 },
      status: 'success',
      phase: 'succeeded',
      factSource: 'executor_result',
      evidenceStrength: 'executor_receipt',
      resultDigest: 'sha256:result'
    })])
  })
})
