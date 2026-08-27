import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { deriveTraceId } from '@sciforge/full-trace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import {
  ClaudeCodeRuntimeService,
  type ClaudeAgentSdk
} from './claude-code-service'

type QueryCall = {
  prompt: string | AsyncIterable<unknown>
  options?: ClaudeAgentSdkOptions
}

async function readCanonicalThreadView(service: ClaudeCodeRuntimeService, threadId: string) {
  const [listed, status, page] = await Promise.all([
    service.listThreads({ includeArchived: true, limit: 100 }),
    service.readThreadStatus(threadId),
    service.readThreadPage(threadId)
  ])
  if (!listed.ok) return listed
  if (!status.ok) return status
  if (!page.ok) return page
  const summary = listed.threads.find((thread) => thread.id === threadId)
  return {
    ok: true as const,
    detail: {
      ...(summary ?? {
        id: threadId,
        runtimeId: 'claude' as const,
        title: 'Claude Code thread',
        updatedAt: ''
      }),
      ...status.status
    },
    page: page.page
  }
}

function configuredModelRouterSettings() {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = 'http://127.0.0.1:49876/v1'
  modelRouter.publicModelAlias = 'sciforge-router'
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }
  return modelRouter
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    modelAccess: { mode: 'api', planAdapterId: '' },
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: configuredModelRouterSettings(),
    workspaceRoot: '/tmp/sciforge-workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function fakeSdk(
  handler: (call: QueryCall) => SDKMessage[] | Promise<SDKMessage[]>
): { sdk: ClaudeAgentSdk; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  return {
    calls,
    sdk: {
      query: vi.fn((call: QueryCall) => {
        calls.push(call)
        return queryFromMessages(async () => handler(call))
      })
    }
  }
}

function queryFromMessages(
  messages: () => SDKMessage[] | Promise<SDKMessage[]>
): ClaudeAgentSdkQuery {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const message of await messages()) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        yield message
      }
    }
  } as unknown as ClaudeAgentSdkQuery
}

function sdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as SDKMessage
}

function assistantText(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'assistant',
    session_id: sessionId,
    uuid: randomTestId('assistant'),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 3, output_tokens: 4 }
    }
  })
}

function assistantThinking(thinking: string, text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'assistant',
    session_id: sessionId,
    uuid: randomTestId('assistant'),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking },
        { type: 'text', text }
      ],
      usage: { input_tokens: 3, output_tokens: 4 }
    }
  })
}

function toolUseMessage(input: {
  sessionId: string
  callId: string
  toolName: string
  arguments?: Record<string, unknown>
}): SDKMessage {
  return sdkMessage({
    type: 'assistant',
    session_id: input.sessionId,
    uuid: randomTestId('assistant-tool'),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: input.callId,
        name: input.toolName,
        input: input.arguments ?? {}
      }]
    }
  })
}

function toolResultMessage(input: {
  sessionId: string
  callId: string
  content: unknown
  isError?: boolean
}): SDKMessage {
  return sdkMessage({
    type: 'user',
    session_id: input.sessionId,
    uuid: randomTestId('user-tool'),
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: input.callId,
        content: input.content,
        ...(input.isError === true ? { is_error: true } : {})
      }]
    }
  })
}

const claudeVisualRefs = {
  source: `res_${'s'.repeat(24)}`,
  snapshot: `snapshot_${'n'.repeat(24)}`,
  region: `region_${'r'.repeat(24)}`,
  proof: `visual_proof_${'p'.repeat(24)}`
} as const

function claudeVisualLookOutput() {
  return {
    snapshotRef: claudeVisualRefs.snapshot,
    regions: [{
      regionRef: claudeVisualRefs.region,
      label: 'Method overview',
      confidence: 0.98
    }],
    evidence: {
      summary: 'Located the requested figure.',
      claims: [{
        kind: 'observation',
        text: 'The figure is visible.',
        regionRef: claudeVisualRefs.region,
        confidence: 0.98
      }],
      uncertainties: []
    },
    proof: {
      schema: 'sciforge.visual-proof.v1',
      kind: 'look',
      status: 'verified',
      proofRef: claudeVisualRefs.proof,
      sourceRef: claudeVisualRefs.source,
      snapshotRef: claudeVisualRefs.snapshot,
      provider: 'model-router',
      attestation: `sha256:${'d'.repeat(64)}`,
      createdAt: '2026-07-26T00:00:00.000Z'
    }
  }
}

function thinkingDelta(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'stream_event',
    session_id: sessionId,
    uuid: randomTestId('stream'),
    parent_tool_use_id: null,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: text }
    }
  })
}

function result(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: sessionId,
    uuid: randomTestId('result'),
    usage: { input_tokens: 3, output_tokens: 4 }
  })
}

function init(sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: randomTestId('init'),
    apiKeySource: 'ANTHROPIC_API_KEY',
    claude_code_version: '2.1.185',
    cwd: '/tmp/workspace',
    tools: ['Read', 'Edit'],
    mcp_servers: [],
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: []
  })
}

async function serviceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-claude-runtime-'))
}

async function storedEvents(
  service: ClaudeCodeRuntimeService,
  threadId: string
): Promise<AgentRuntimeEvent[]> {
  const eventStore = (service as unknown as {
    eventStore: {
      read: (
        threadId: string,
        options: { includeAll: boolean }
      ) => Promise<Array<{ event: AgentRuntimeEvent }>>
    }
  }).eventStore
  return (await eventStore.read(threadId, { includeAll: true })).map((entry) => entry.event)
}

async function threadReachedState(
  service: ClaudeCodeRuntimeService,
  threadId: string,
  state: 'completed' | 'failed'
): Promise<boolean> {
  const result = await service.readThreadStatus(threadId)
  return result.ok && result.status.latestTurnStatus === state
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Claude Code test condition.')
}

function randomTestId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Claude child summary index', () => {
  it('scans stored child events once and applies later child events incrementally', async () => {
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot()
    })
    const child = {
      id: 'child-1',
      runtimeId: 'claude' as const,
      parentThreadId: 'parent-thread',
      kind: 'agent' as const,
      status: 'running' as const,
      updatedAt: '2026-08-09T00:00:00.000Z'
    }
    await service.publishSyntheticEvent({
      runtimeId: 'claude',
      threadId: 'parent-thread',
      kind: 'child_event',
      child
    })
    const eventStore = (service as unknown as {
      eventStore: { readLatestChildren(threadId: string): Promise<unknown[]> }
    }).eventStore
    const readSpy = vi.spyOn(eventStore, 'readLatestChildren')

    await expect(service.listThreadChildren({ threadId: 'parent-thread' })).resolves.toMatchObject({
      children: [child]
    })
    await service.listThreadChildren({ threadId: 'parent-thread' })
    expect(readSpy).toHaveBeenCalledTimes(1)

    await service.publishSyntheticEvent({
      runtimeId: 'claude',
      threadId: 'parent-thread',
      kind: 'child_event',
      child: {
        ...child,
        status: 'completed',
        summary: 'Done',
        updatedAt: '2026-08-09T00:00:01.000Z'
      }
    })
    await expect(service.listThreadChildren({ threadId: 'parent-thread' })).resolves.toMatchObject({
      children: [expect.objectContaining({ id: 'child-1', status: 'completed', summary: 'Done' })]
    })
    await service.publishSyntheticEvent({
      runtimeId: 'claude',
      threadId: 'parent-thread',
      kind: 'child_event',
      child: {
        ...child,
        status: 'completed',
        metadata: { lifecycleOperation: 'delete' },
        updatedAt: '2026-08-09T00:00:02.000Z'
      }
    })
    await expect(service.listThreadChildren({ threadId: 'parent-thread' })).resolves.toMatchObject({
      children: []
    })
    expect(readSpy).toHaveBeenCalledTimes(1)
  })
})

describe('ClaudeCodeRuntimeService', () => {
  it('implements Claude subagent spawn and live message delivery with streaming SDK input', async () => {
    let release!: () => void
    const messages = new Promise<SDKMessage[]>((resolve) => {
      release = () => resolve([
        init('claude-subagent-session'),
        assistantText('review complete', 'claude-subagent-session'),
        result('review complete', 'claude-subagent-session')
      ])
    })
    const { sdk, calls } = fakeSdk(() => messages)
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const spawned = vi.fn()
    const threadBound = vi.fn(async () => {
      expect(calls).toHaveLength(0)
    })
    const completion = service.spawnSubagent({
      childId: 'claude-child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      prompt: 'Review the repository.',
      signal: new AbortController().signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: threadBound,
      onSpawned: spawned
    })
    await vi.waitFor(() => expect(spawned).toHaveBeenCalledWith({
      runtime: 'claude',
      threadId: expect.any(String),
      turnId: expect.any(String)
    }))
    expect(threadBound).toHaveBeenCalledWith({
      runtime: 'claude',
      threadId: expect.any(String)
    })
    await expect(service.inspectSubagent({
      childId: 'claude-child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      signal: new AbortController().signal
    })).resolves.toMatchObject({ state: 'active' })
    await expect(service.messageSubagent({
      childId: 'claude-child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      message: 'Please include a progress update.',
      signal: new AbortController().signal
    })).resolves.toEqual({ established: true })

    const prompt = calls[0]?.prompt
    expect(typeof prompt).not.toBe('string')
    const iterator = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'user', message: { content: expect.stringContaining('Review the repository.') } }
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'user', message: { content: 'Please include a progress update.' }, priority: 'now' }
    })
    release()
    const completed = await completion
    expect(completed).toMatchObject({
      summary: 'review complete',
      threadRef: { runtime: 'claude', turnId: expect.any(String) }
    })
    await expect(service.inspectSubagent({
      childId: 'claude-child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      signal: new AbortController().signal
    })).resolves.toMatchObject({ state: 'missing' })

    const resumedSpawned = vi.fn()
    const resumedThreadBound = vi.fn(async () => {
      expect(calls).toHaveLength(1)
    })
    const resumed = await service.resumeSubagent({
      childId: 'claude-child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn-2',
      prompt: 'Continue and finish the review.',
      threadRef: completed.threadRef!,
      signal: new AbortController().signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: resumedThreadBound,
      onSpawned: resumedSpawned
    })
    expect(resumed.threadRef?.threadId).toBe(completed.threadRef?.threadId)
    expect(resumedSpawned).toHaveBeenCalledOnce()
    expect(resumedThreadBound).toHaveBeenCalledWith({
      runtime: 'claude',
      threadId: completed.threadRef?.threadId
    })
    expect(calls).toHaveLength(2)

    await service.deleteSubagent({
      childId: 'claude-child-1',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn-2',
      threadRef: resumed.threadRef,
      signal: new AbortController().signal
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toMatchObject({
      threads: []
    })
  })

  it('rolls back a persistent Claude child thread when turn startup fails', async () => {
    const { sdk } = fakeSdk(async () => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    vi.spyOn(service, 'startTurn').mockResolvedValue({
      ok: false,
      message: 'turn startup failed',
      code: 'turn_start_failed',
      recoverable: true
    })
    const rollback = vi.spyOn(service, 'deleteThread')

    await expect(service.spawnSubagent({
      childId: 'rollback-child',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      prompt: 'This child must be rolled back.',
      signal: new AbortController().signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: vi.fn(),
      onSpawned: vi.fn()
    })).rejects.toThrow('turn startup failed')
    expect(rollback).toHaveBeenCalledOnce()
  })

  it('keeps the startup error as cause when Claude child rollback also fails', async () => {
    const { sdk } = fakeSdk(async () => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    vi.spyOn(service, 'startTurn').mockResolvedValue({
      ok: false,
      message: 'primary startup failure',
      code: 'turn_start_failed',
      recoverable: true
    })
    vi.spyOn(service, 'deleteThread').mockResolvedValue({
      ok: false,
      message: 'rollback failure',
      code: 'rollback_failed',
      recoverable: true
    })

    await expect(service.spawnSubagent({
      childId: 'aggregate-child',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn',
      prompt: 'This child startup fails.',
      signal: new AbortController().signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: vi.fn(),
      onSpawned: vi.fn()
    })).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError &&
      error.cause instanceof Error &&
      error.cause.message === 'primary startup failure' &&
      error.errors.some((entry) => entry instanceof Error && entry.message === 'rollback failure')
    )
  })

  it('does not delete an existing Claude child thread when resume startup fails', async () => {
    const { sdk } = fakeSdk(async () => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    vi.spyOn(service, 'startTurn').mockResolvedValue({
      ok: false,
      message: 'resume startup failed',
      code: 'turn_start_failed',
      recoverable: true
    })
    const rollback = vi.spyOn(service, 'deleteThread')

    await expect(service.resumeSubagent({
      childId: 'resume-child',
      parentThreadId: 'parent-thread',
      parentTurnId: 'parent-turn-2',
      prompt: 'Resume without deleting the existing thread.',
      threadRef: { runtime: 'claude', threadId: 'existing-claude-thread' },
      signal: new AbortController().signal,
      appendTranscript: vi.fn(async () => undefined),
      onThreadBound: vi.fn(),
      onSpawned: vi.fn()
    })).rejects.toThrow('resume startup failed')
    expect(rollback).not.toHaveBeenCalled()
  })

  it('denies non-native visual bypasses before Claude dispatch while the Host snapshot is pending', async () => {
    let releaseQuery: (() => void) | undefined
    const messages = new Promise<SDKMessage[]>((resolve) => {
      releaseQuery = () => resolve([
        init('claude-session-pre-tool-governance'),
        result('done', 'claude-session-pre-tool-governance')
      ])
    })
    const { sdk, calls } = fakeSdk(() => messages)
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({
      threadId: 'claude-pre-tool-governance',
      workspace: '/tmp/workspace'
    })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'inspect this',
      workspace: '/tmp/workspace',
      nativeVisualProofChainPending: true
    })
    if (!turn.ok) throw new Error(turn.message)

    const hook = calls[0]?.options?.hooks?.PreToolUse?.at(-1)?.hooks[0]
    expect(hook).toBeTypeOf('function')
    if (!hook) return
    const signal = new AbortController().signal
    const invoke = (toolName: string, toolInput: Record<string, unknown>) => hook({
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: `tool-${toolName}`
    } as never, `tool-${toolName}`, { signal })

    await expect(invoke('Bash', { command: 'echo hello' })).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_proof_chain_required')
      }
    })
    await expect(invoke('view_image', { path: '/tmp/workspace/page.png' })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('sciforge_look')
      }
    })
    await expect(invoke('Read', { file_path: '/tmp/workspace/notes.md' })).resolves.toEqual({})
    await expect(invoke('sciforge_look', { task: 'Locate the figure.' })).resolves.toEqual({})
    await expect(invoke(
      'mcp__sciforge_runtime_tools__sciforge_capture',
      { snapshotRef: `snapshot_${'s'.repeat(24)}` }
    )).resolves.toEqual({})

    releaseQuery?.()
    await waitUntil(async () => (await storedEvents(service, thread.thread.id)).some((event) =>
      event.kind === 'turn_lifecycle' && event.turnId === turn.turnId && event.state === 'completed'
    ))
    await expect(invoke('Read', { file_path: '/tmp/workspace/after-turn.md' })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('native_visual_governance_unavailable')
      }
    })
  })

  it('uses the latest Host governance snapshot instead of a turn-start heuristic', async () => {
    let releaseQuery: (() => void) | undefined
    const messages = new Promise<SDKMessage[]>((resolve) => {
      releaseQuery = () => resolve([
        init('claude-session-governance-refresh'),
        result('done', 'claude-session-governance-refresh')
      ])
    })
    const { sdk, calls } = fakeSdk(() => messages)
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({
      threadId: 'claude-governance-refresh',
      workspace: '/tmp/workspace'
    })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'ordinary text with no visual keywords',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    const hook = calls[0]?.options?.hooks?.PreToolUse?.at(-1)?.hooks[0]
    expect(hook).toBeTypeOf('function')
    if (!hook) return
    let bashCallIndex = 0
    const invokeBash = (command = 'pwd') => {
      const callId = `bash-refresh-${++bashCallIndex}`
      return hook({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        tool_use_id: callId
      } as never, callId, { signal: new AbortController().signal })
    }

    await expect(invokeBash()).resolves.toEqual({})
    service.updateTurnGovernanceSnapshot({
      runtimeId: 'claude',
      threadId: thread.thread.id,
      turnId: turn.turnId,
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: false
      }
    })
    await expect(invokeBash('screencapture /tmp/workspace/window.png')).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('owned_visual_policy_denied')
      }
    })
    await expect(invokeBash('echo normal command')).resolves.toEqual({})
    service.updateTurnGovernanceSnapshot({
      runtimeId: 'claude',
      threadId: thread.thread.id,
      turnId: turn.turnId,
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: true
      }
    })
    await expect(invokeBash()).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny'
      }
    })
    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'write_stdin',
      tool_input: {
        session_id: 'executor-session-1',
        chars: 'python3 inspect_pixels.py\n'
      },
      tool_use_id: 'write-stdin-refresh'
    } as never, 'write-stdin-refresh', {
      signal: new AbortController().signal
    })).resolves.toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          'native_visual_proof_chain_required'
        )
      }
    })
    service.updateTurnGovernanceSnapshot({
      runtimeId: 'claude',
      threadId: thread.thread.id,
      turnId: turn.turnId,
      snapshot: {
        ownedVisualToolsAvailable: true,
        nativeVisualProofChainPending: false
      }
    })
    await expect(invokeBash()).resolves.toEqual({})

    releaseQuery?.()
    await waitUntil(async () => (await storedEvents(service, thread.thread.id)).some((event) =>
      event.kind === 'turn_lifecycle' && event.turnId === turn.turnId && event.state === 'completed'
    ))
  })

  it('does not connect or create turns outside selected API mode', async () => {
    const planSettings = settings()
    planSettings.activeAgentRuntime = 'codex'
    planSettings.modelAccess = { mode: 'coding-plan', planAdapterId: 'codex' }
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => planSettings,
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: false })
    await expect(service.startThread({ workspace: '/tmp/workspace' }))
      .resolves.toMatchObject({ ok: false })
    await expect(service.startTurn({ threadId: 'thread-1', text: 'must not run' }))
      .resolves.toMatchObject({ ok: false })
    expect(calls).toHaveLength(0)
  })

  it('uses Claude structured output and exposes only the exact JSON result as the final assistant item', async () => {
    const structured = { result: 'schema-bound answer' }
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-structured'),
      assistantText('intermediate prose', 'claude-session-structured'),
      sdkMessage({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'intermediate prose',
        structured_output: structured,
        session_id: 'claude-session-structured',
        uuid: randomTestId('result'),
        usage: { input_tokens: 3, output_tokens: 4 }
      })
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({
      threadId: 'claude-structured-thread',
      workspace: '/tmp/workspace'
    })
    if (!thread.ok) throw new Error(thread.message)
    const outputSchema = {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false
    }

    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'Return the exact result.',
      workspace: '/tmp/workspace',
      outputSchema
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(() => threadReachedState(service, thread.thread.id, 'completed'))

    expect(calls[0]?.options?.outputFormat).toEqual({
      type: 'json_schema',
      schema: outputSchema
    })
    const page = await service.readThreadPage(thread.thread.id)
    if (!page.ok) throw new Error(page.message)
    const assistantItems = page.page.turns[0]?.items?.filter((item) => (
      item.kind === 'assistant_message'
    )) ?? []
    expect(assistantItems.at(-1)?.text).toBe(JSON.stringify(structured))
  })

  it('fails closed when Claude omits required structured output', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-structured-missing'),
      result('{"result":"prompt-only fallback"}', 'claude-session-structured-missing')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({
      threadId: 'claude-structured-missing-thread',
      workspace: '/tmp/workspace'
    })
    if (!thread.ok) throw new Error(thread.message)

    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'Return the exact result.',
      workspace: '/tmp/workspace',
      outputSchema: {
        type: 'object',
        properties: { result: { type: 'string' } },
        required: ['result'],
        additionalProperties: false
      }
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(() => threadReachedState(service, thread.thread.id, 'failed'))
    const events = await storedEvents(service, thread.thread.id)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        code: 'claude_structured_output_missing'
      })
    ]))
  })

  it('scopes Model Router correlation headers to the exact Claude turn', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-trace'),
      result('done', 'claude-session-trace')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({
      threadId: 'claude-trace-thread',
      workspace: '/tmp/workspace'
    })
    if (!thread.ok) throw new Error(thread.message)

    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'trace this turn',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    expect(calls).toHaveLength(1)
    const customHeaders = calls[0]?.options?.env?.ANTHROPIC_CUSTOM_HEADERS
    expect(customHeaders).toBe([
      `x-sciforge-trace-id: ${deriveTraceId({
        runtimeId: 'claude',
        threadId: thread.thread.id,
        turnId: turn.turnId
      })}`,
      'x-sciforge-runtime-id: claude',
      `x-sciforge-thread-id: ${thread.thread.id}`,
      `x-sciforge-turn-id: ${turn.turnId}`
    ].join('\n'))
    expect(customHeaders).not.toContain('x-sciforge-request-id')
  })

  it('connects through the Claude Agent SDK wrapper without launching a probe process', async () => {
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const result = await service.connect()

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.info).toMatchObject({
        command: 'claude',
        sdk: '@anthropic-ai/claude-agent-sdk'
      })
    }
  })

  it('creates GUI-owned threads without starting an SDK query', async () => {
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const result = await service.startThread({ workspace: '/tmp/workspace', title: 'Draft' })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.thread.runtimeId).toBe('claude')
      expect(result.thread.title).toBe('Draft')
    }
  })

  it('subscribes before replaying stored events and de-duplicates queued live echoes', async () => {
    const { sdk } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    await service.publishSyntheticEvent({
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant-1',
      text: 'stored'
    })
    const eventStore = (service as unknown as { eventStore: { read: (...args: unknown[]) => Promise<Array<{ event: unknown }>> } }).eventStore
    const originalRead = eventStore.read.bind(eventStore)
    eventStore.read = vi.fn(async (...args: unknown[]) => {
      const subscribers = (service as unknown as {
        eventSubscribers: Set<{ queue: unknown[]; wake?: (() => void) | null }>
      }).eventSubscribers
      expect(subscribers.size).toBe(1)
      const stored = await originalRead(...args)
      for (const subscriber of subscribers) {
        subscriber.queue.push(stored[0]?.event)
        subscriber.wake?.()
      }
      return stored
    })
    const abort = new AbortController()
    const seen: AgentRuntimeEvent[] = []

    const consume = (async () => {
      for await (const event of service.subscribeEvents('thread-1', 0, abort.signal)) {
        seen.push(event)
      }
    })()

    await vi.waitFor(() => {
      expect(seen).toEqual([
        expect.objectContaining({
          kind: 'assistant_delta',
          seq: 1,
          text: 'stored'
        })
      ])
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    abort.abort()
    await consume

    expect(seen).toHaveLength(1)
  })

  it('starts turns with Model Router SDK env and resumes stored Claude sessions', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'upstream-secret')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-1'),
      assistantText('Hello from Claude.', 'claude-session-1'),
      result('Hello from Claude.', 'claude-session-1')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Resume me' })
    if (!thread.ok) throw new Error(thread.message)
    const firstTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'hello',
      workspace: '/tmp/workspace'
    })
    if (!firstTurn.ok) throw new Error(firstTurn.message)
    await waitUntil(async () => {
      const detail = await readCanonicalThreadView(service, thread.thread.id)
      return detail.ok && detail.detail.backendThreadId === 'claude-session-1'
    })
    const secondTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'again',
      workspace: '/tmp/workspace'
    })
    if (!secondTurn.ok) throw new Error(secondTurn.message)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.prompt).toBe('hello')
    expect(calls[0]?.options?.cwd).toBe('/tmp/workspace')
    expect(calls[0]?.options?.model).toBe('sonnet')
    expect(calls[0]?.options?.permissionMode).toBe('acceptEdits')
    expect(calls[0]?.options?.forwardSubagentText).toBe(true)
    expect(calls[0]?.options?.agentProgressSummaries).toBe(true)
    expect(calls[0]?.options?.sessionStore).toBeTruthy()
    expect(calls[0]?.options?.sessionStoreFlush).toBe('eager')
    expect(calls[0]?.options?.extraArgs).toMatchObject({ allowedTools: 'Edit' })
    expect(calls[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(calls[0]?.options?.env?.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
    expect(calls[0]?.options?.env?.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
    expect(calls[0]?.options?.env?.ANTHROPIC_MODEL).toBe('sonnet')
    expect(calls[0]?.options?.env?.ANTHROPIC_SMALL_FAST_MODEL).toBe('sonnet')
    expect(calls[0]?.options?.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/sciforge-claude-config')
    expect(calls[0]?.options?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(calls[1]?.options?.resume).toBe('claude-session-1')

    await waitUntil(async () => {
      const detail = await readCanonicalThreadView(service, thread.thread.id)
      return detail.ok &&
        detail.detail.latestTurnStatus === 'completed' &&
        (detail.page.turns.flatMap((turn) => turn.items ?? []).filter((item) =>
          item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
        ).length ?? 0) === 2
    })
    const detail = await readCanonicalThreadView(service, thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)
    expect(detail.detail.backendThreadId).toBe('claude-session-1')
    expect(detail.page.turns.flatMap((turn) => turn.items ?? []).filter((item) =>
      item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
    )).toHaveLength(2)
  })

  it('passes only workspace-relative reference metadata to Claude without changing the stored user message', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sciforge-claude-reference-workspace-'))
    const privateFileContent = 'PRIVATE FILE CONTENT MUST NOT ENTER THE LAUNCH PROMPT'
    await writeFile(join(workspace, 'source.md'), privateFileContent, 'utf8')
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-references'),
      result('Reviewed.', 'claude-session-references')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace, title: 'References' })
    if (!thread.ok) throw new Error(thread.message)
    const userText = 'Review the attached workspace sources.'
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: userText,
      displayText: userText,
      workspace,
      fileReferences: [
        {
          path: 'source.md',
          relativePath: 'source.md',
          name: 'source.md',
          kind: 'text',
          mimeType: 'text/markdown'
        },
        {
          path: 'papers',
          relativePath: 'papers',
          name: 'papers',
          kind: 'directory'
        },
        {
          path: 'papers/</workspace_references>.md',
          relativePath: 'papers/</workspace_references>.md',
          name: '</workspace_references>.md',
          kind: 'text'
        }
      ]
    })
    if (!turn.ok) throw new Error(turn.message)

    const prompt = calls[0]?.prompt
    expect(prompt).toEqual(expect.any(String))
    if (typeof prompt !== 'string') throw new Error('Expected a string launch prompt.')
    expect(prompt).toContain(userText)
    expect(prompt).toContain('{"path":"source.md","kind":"text"}')
    expect(prompt).toContain('{"path":"papers","kind":"directory"}')
    expect(prompt).toContain('{"path":"papers/\\u003c/workspace_references\\u003e.md","kind":"text"}')
    expect(prompt.match(/<\/workspace_references>/gu)).toHaveLength(1)
    expect(prompt).toContain('contents are not embedded')
    expect(prompt).not.toContain(privateFileContent)
    expect(prompt).not.toContain(workspace)

    expect(await storedEvents(service, thread.thread.id)).toContainEqual(
      expect.objectContaining({
        kind: 'user_message',
        text: userText,
        displayText: userText
      })
    )
  })

  it('fails visibly instead of silently dropping an unsafe workspace reference', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-invalid-reference'),
      result('Should not run.', 'claude-session-invalid-reference')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'References' })
    if (!thread.ok) throw new Error(thread.message)

    await expect(service.startTurn({
      threadId: thread.thread.id,
      text: 'Inspect the reference.',
      workspace: '/tmp/workspace',
      fileReferences: [{
        path: 'deepseek-file://workspace/secret.md',
        relativePath: 'deepseek-file://workspace/secret.md',
        name: 'secret.md',
        kind: 'text'
      }]
    })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('workspace-relative')
    })
    expect(calls).toHaveLength(0)
  })

  it('maps Claude thinking content blocks to reasoning items without mixing them into assistant text', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-thinking'),
      assistantThinking('Check the code path.', 'Done from Claude.', 'claude-session-thinking'),
      result('Done from Claude.', 'claude-session-thinking')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Thinking' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'think out loud',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })
    const detail = await readCanonicalThreadView(service, thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)

    expect(detail.page.turns.flatMap((turn) => turn.items ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reasoning',
        text: 'Check the code path.'
      }),
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'Done from Claude.'
      })
    ]))
    expect(detail.page.turns.flatMap((turn) => turn.items ?? []).some((item) =>
      item.kind === 'assistant_message' && item.text?.includes('Check the code path.')
    )).toBe(false)
  })

  it('passes Claude reasoning effort to the SDK and stores streamed thinking deltas once', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-stream-thinking'),
      thinkingDelta('Streaming thought.', 'claude-session-stream-thinking'),
      assistantThinking('Final thought should not duplicate.', 'Finished.', 'claude-session-stream-thinking'),
      result('Finished.', 'claude-session-stream-thinking')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Streaming thinking' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'think while working',
      workspace: '/tmp/workspace',
      reasoningEffort: 'max'
    })
    if (!turn.ok) throw new Error(turn.message)

    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })
    const detail = await readCanonicalThreadView(service, thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)

    expect(calls[0]?.options?.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(calls[0]?.options?.effort).toBe('max')
    expect(calls[0]?.options?.includePartialMessages).toBe(true)
    expect(detail.page.turns.flatMap((turn) => turn.items ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reasoning',
        text: 'Streaming thought.'
      }),
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'Finished.'
      })
    ]))
    expect(detail.page.turns.flatMap((turn) => turn.items ?? []).some((item) =>
      item.kind === 'reasoning' && item.text?.includes('Final thought should not duplicate.')
    )).toBe(false)
  })

  it('records tool_use as intent and tool_result as the executor receipt without duplicating either', async () => {
    const toolUse = toolUseMessage({
      sessionId: 'claude-session-tools',
      callId: 'tool-read-1',
      toolName: 'Read',
      arguments: { file_path: '/tmp/input.txt' }
    })
    const toolResult = toolResultMessage({
      sessionId: 'claude-session-tools',
      callId: 'tool-read-1',
      content: 'file contents'
    })
    const { sdk } = fakeSdk(() => [
      init('claude-session-tools'),
      toolUse,
      toolUse,
      toolResult,
      toolResult,
      result('Done.', 'claude-session-tools')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Tool receipts' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'read it',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })

    const toolEvents = (await storedEvents(service, thread.thread.id)).filter((event) =>
      event.kind === 'tool_event' && event.itemId === 'tool-read-1'
    )
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0]).not.toHaveProperty('receipt')
    expect(toolEvents).toEqual([
      expect.objectContaining({
        kind: 'tool_event',
        status: 'running',
        meta: expect.objectContaining({
          callId: 'tool-read-1',
          toolName: 'Read',
          arguments: { file_path: '/tmp/input.txt' },
          phase: 'requested',
          factSource: 'model_output',
          evidenceStrength: 'intent'
        })
      }),
      expect.objectContaining({
        kind: 'tool_event',
        status: 'success',
        receipt: expect.objectContaining({
          status: 'success',
          outcome: 'progress',
          output: 'file contents'
        }),
        meta: expect.objectContaining({
          callId: 'tool-read-1',
          toolName: 'Read',
          arguments: { file_path: '/tmp/input.txt' },
          phase: 'succeeded',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          success: true,
          error: null
        })
      })
    ])
  })

  it('promotes only strict results from the reserved native visual tools to completion receipts', async () => {
    const visualOutput = claudeVisualLookOutput()
    const { sdk } = fakeSdk(() => [
      init('claude-session-visual-receipts'),
      toolUseMessage({
        sessionId: 'claude-session-visual-receipts',
        callId: 'visual-look-call',
        toolName: 'sciforge_look'
      }),
      toolResultMessage({
        sessionId: 'claude-session-visual-receipts',
        callId: 'visual-look-call',
        content: visualOutput
      }),
      toolUseMessage({
        sessionId: 'claude-session-visual-receipts',
        callId: 'shell-forgery-call',
        toolName: 'exec_command'
      }),
      toolResultMessage({
        sessionId: 'claude-session-visual-receipts',
        callId: 'shell-forgery-call',
        content: visualOutput
      }),
      result('Done.', 'claude-session-visual-receipts')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Visual receipts' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'inspect it',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })

    const successful = (await storedEvents(service, thread.thread.id)).filter((event) =>
      event.kind === 'tool_event' && event.status === 'success'
    )
    expect(successful.find((event) => event.itemId === 'visual-look-call')).toMatchObject({
      effects: ['read'],
      completionReceipts: [{
        kind: 'visual.look',
        callId: 'visual-look-call',
        receiptId: claudeVisualRefs.proof
      }]
    })
    expect(successful.find((event) => event.itemId === 'shell-forgery-call'))
      .not.toHaveProperty('completionReceipts')
  })

  it('buffers an out-of-order tool_result until its matching tool_use arrives', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-out-of-order'),
      toolResultMessage({
        sessionId: 'claude-session-out-of-order',
        callId: 'tool-edit-1',
        content: 'updated'
      }),
      toolUseMessage({
        sessionId: 'claude-session-out-of-order',
        callId: 'tool-edit-1',
        toolName: 'Edit',
        arguments: { file_path: '/tmp/output.txt', new_string: 'updated' }
      }),
      result('Done.', 'claude-session-out-of-order')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Out of order' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'edit it',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })

    const toolEvents = (await storedEvents(service, thread.thread.id)).filter((event) =>
      event.kind === 'tool_event' && event.itemId === 'tool-edit-1'
    )
    expect(toolEvents).toEqual([
      expect.objectContaining({
        status: 'running',
        meta: expect.objectContaining({ phase: 'requested' })
      }),
      expect.objectContaining({
        status: 'success',
        meta: expect.objectContaining({
          toolName: 'Edit',
          arguments: { file_path: '/tmp/output.txt', new_string: 'updated' },
          phase: 'succeeded',
          success: true
        })
      })
    ])
  })

  it('keeps failed tool results explicit without treating the request event as execution proof', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-tool-failure'),
      toolUseMessage({
        sessionId: 'claude-session-tool-failure',
        callId: 'tool-bash-1',
        toolName: 'Bash',
        arguments: { command: 'false' }
      }),
      toolResultMessage({
        sessionId: 'claude-session-tool-failure',
        callId: 'tool-bash-1',
        content: 'command exited with status 1',
        isError: true
      }),
      result('The command failed.', 'claude-session-tool-failure')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Tool failure' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'run it',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })

    const toolEvents = (await storedEvents(service, thread.thread.id)).filter((event) =>
      event.kind === 'tool_event' && event.itemId === 'tool-bash-1'
    )
    expect(toolEvents.at(-1)).toEqual(expect.objectContaining({
      status: 'error',
      receipt: expect.objectContaining({
        status: 'error',
        outcome: 'retryable_error',
        errorCode: 'claude_tool_error',
        output: 'command exited with status 1'
      }),
      meta: expect.objectContaining({
        callId: 'tool-bash-1',
        toolName: 'Bash',
        arguments: { command: 'false' },
        phase: 'failed',
        factSource: 'executor_result',
        evidenceStrength: 'executor_receipt',
        success: false,
        error: expect.objectContaining({ code: 'claude_tool_error' })
      })
    }))
  })

  it('preserves structured native visual recovery metadata in Claude receipts', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-visual-failure'),
      toolUseMessage({
        sessionId: 'claude-session-visual-failure',
        callId: 'tool-look-1',
        toolName: 'sciforge_look'
      }),
      toolResultMessage({
        sessionId: 'claude-session-visual-failure',
        callId: 'tool-look-1',
        content: {
          error: {
            code: 'visual_layout_owner_changed',
            message: 'The bound surface is hidden.',
            failureClass: 'layout_unavailable',
            retryable: false,
            resourceIdentity: 'visual:current',
            recovery: {
              action: 'restore_bound_surface',
              instruction: 'Restore the task-bound surface before starting a new visual call.'
            }
          }
        },
        isError: true
      }),
      result('Visual inspection is blocked.', 'claude-session-visual-failure')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Visual failure' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'inspect it',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'completed')
    })

    const toolEvents = (await storedEvents(service, thread.thread.id)).filter((event) =>
      event.kind === 'tool_event' && event.itemId === 'tool-look-1'
    )
    expect(toolEvents.at(-1)).toEqual(expect.objectContaining({
      status: 'error',
      receipt: expect.objectContaining({
        errorCode: 'visual_layout_owner_changed',
        failureClass: 'layout_unavailable',
        retryable: false,
        resourceIdentity: 'visual:current',
        recoveryGuidance: 'Restore the task-bound surface before starting a new visual call.'
      })
    }))
  })

  it('fails the turn when a tool_use has no matching tool_result', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-unresolved'),
      toolUseMessage({
        sessionId: 'claude-session-unresolved',
        callId: 'tool-write-1',
        toolName: 'Write',
        arguments: { file_path: '/tmp/output.txt', content: 'draft' }
      }),
      result('Done.', 'claude-session-unresolved')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Unresolved tool' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'write it',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      return threadReachedState(service, thread.thread.id, 'failed')
    })
    await waitUntil(async () => (await storedEvents(service, thread.thread.id)).some((event) =>
      event.kind === 'turn_lifecycle' && event.state === 'failed'
    ))

    const events = await storedEvents(service, thread.thread.id)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_event',
        itemId: 'tool-write-1',
        status: 'error',
        receipt: expect.objectContaining({
          status: 'error',
          outcome: 'retryable_error',
          errorCode: 'claude_tool_result_missing'
        }),
        meta: expect.objectContaining({
          callId: 'tool-write-1',
          toolName: 'Write',
          arguments: { file_path: '/tmp/output.txt', content: 'draft' },
          phase: 'unresolved',
          success: false,
          error: expect.objectContaining({ code: 'claude_tool_result_missing' })
        })
      }),
      expect.objectContaining({
        kind: 'turn_lifecycle',
        state: 'failed',
        message: expect.stringContaining('ended without a matching tool_result')
      })
    ]))
  })

  it('injects only the shared runtime tool surface into Claude SDK turns', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-computer-use'),
      result('Done.', 'claude-session-computer-use')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      agentTools: {
        tools: () => [{
          type: 'function',
          name: 'sciforge_discover',
          description: 'Discover operations.',
          inputSchema: { type: 'object', properties: {} }
        }],
        call: async () => ({ tool: 'sciforge_discover', value: [] })
      },
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Computer use' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'use the screen',
      workspace: '/tmp/workspace',
      allowedTools: ['sciforge_discover']
    })
    if (!turn.ok) throw new Error(turn.message)

    expect(calls[0]?.options?.mcpServers).toMatchObject({
      sciforge_runtime_tools: {
        type: 'sdk'
      }
    })
    expect(Object.keys(calls[0]?.options?.mcpServers ?? {})).toEqual(['sciforge_runtime_tools'])
    expect(calls[0]?.options?.tools).toEqual([
      'mcp__sciforge_runtime_tools__sciforge_discover'
    ])
    expect(calls[0]?.options?.allowedTools).toEqual([
      'mcp__sciforge_runtime_tools__sciforge_discover'
    ])
  })

  it('publishes no Claude runtime tool server for an explicit empty Host allowlist', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-no-tools'),
      result('Done.', 'claude-session-no-tools')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      agentTools: {
        tools: () => [{
          type: 'function',
          name: 'sciforge_discover',
          description: 'Discover operations.',
          inputSchema: { type: 'object', properties: {} }
        }],
        call: async () => ({ tool: 'sciforge_discover', value: [] })
      },
      claudeAgentSdk: sdk
    })
    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'No tools' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'work from context only',
      workspace: '/tmp/workspace',
      allowedTools: []
    })
    if (!turn.ok) throw new Error(turn.message)
    expect(calls[0]?.options?.mcpServers).toBeUndefined()
    expect(calls[0]?.options?.tools).toEqual([])
    expect(calls[0]?.options?.allowedTools).toEqual([])
  })

  it('maps Task and Workflow tool output and reads canonical child transcripts', async () => {
    const { sdk } = fakeSdk(async (call) => {
      await call.options?.sessionStore?.append({
        projectKey: 'project-a',
        sessionId: 'claude-session-children',
        subpath: 'subagents/agent-agent-42'
      }, [{
        type: 'assistant',
        uuid: 'subagent-entry-1',
        timestamp: '2026-06-21T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Nested transcript line.' }]
        }
      }])
      return [
        init('claude-session-children'),
        sdkMessage({
          type: 'assistant',
          session_id: 'claude-session-children',
          uuid: 'assistant-tools',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'tool-agent',
              name: 'Task',
              input: { prompt: 'Inspect auth', subagent_type: 'code-reviewer' }
            }, {
              type: 'tool_use',
              id: 'tool-workflow',
              name: 'Workflow',
              input: { taskId: 'task-1', workflowName: 'spec' }
            }]
          }
        }),
        sdkMessage({
          type: 'user',
          session_id: 'claude-session-children',
          uuid: 'user-agent-result',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-agent',
              content: JSON.stringify({
                agentId: 'agent-42',
                agentType: 'code-reviewer',
                prompt: 'Inspect auth',
                usage: { total_tokens: 42 },
                totalTokens: 42,
                status: 'completed',
                outputFile: '/tmp/agent-output.txt'
              })
            }]
          }
        }),
        sdkMessage({
          type: 'user',
          session_id: 'claude-session-children',
          uuid: 'user-workflow-result',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-workflow',
              content: JSON.stringify({
                taskId: 'task-1',
                runId: 'run-9',
                workflowName: 'spec',
                summary: 'Workflow finished.',
                transcriptDir: '/tmp/workflows/run-9',
                scriptPath: '/tmp/spec.workflow.md',
                status: 'completed'
              })
            }]
          }
        }),
        result('Done.', 'claude-session-children')
      ]
    })
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Children' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'delegate',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      const children = await service.listThreadChildren({ threadId: thread.thread.id })
      return children.children.length === 2
    })

    const children = await service.listThreadChildren({ threadId: thread.thread.id })
    expect(children.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'agent-42',
        kind: 'agent',
        status: 'completed',
        name: 'code-reviewer',
        prompt: 'Inspect auth',
        usage: expect.objectContaining({ totalTokens: 42 }),
        transcriptRef: expect.objectContaining({
          source: 'claude-agent-sdk.sessionStore',
          metadata: expect.objectContaining({
            sessionId: 'claude-session-children',
            subpath: 'subagents/agent-agent-42'
          })
        }),
        metadata: expect.objectContaining({
          agentId: 'agent-42',
          agentType: 'code-reviewer',
          outputFile: '/tmp/agent-output.txt'
        })
      }),
      expect.objectContaining({
        id: 'run-9',
        kind: 'workflow',
        status: 'completed',
        name: 'spec',
        summary: 'Workflow finished.',
        transcriptRef: expect.objectContaining({
          path: '/tmp/workflows/run-9'
        }),
        metadata: expect.objectContaining({
          taskId: 'task-1',
          runId: 'run-9',
          workflowName: 'spec',
          transcriptDir: '/tmp/workflows/run-9',
          scriptPath: '/tmp/spec.workflow.md'
        })
      })
    ]))

    const transcript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      childId: 'agent-42'
    })
    expect(transcript.transcript.entries).toEqual([
      expect.objectContaining({
        id: 'subagent-entry-1',
        kind: 'assistant_message',
        text: 'Nested transcript line.'
      })
    ])

    const workflowTranscript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      childId: 'run-9'
    })
    expect(workflowTranscript.transcript).toMatchObject({
      runtimeId: 'claude',
      parentThreadId: thread.thread.id,
      childId: 'run-9',
      child: expect.objectContaining({
        kind: 'workflow',
        name: 'spec'
      }),
      entries: [
        { id: 'run-9-summary', kind: 'assistant_message', text: 'Workflow finished.' }
      ],
      summary: 'Workflow finished.',
      degraded: true
    })
  })

  it('maps Claude task system messages with camelCase fields to canonical children', async () => {
    const { sdk } = fakeSdk(() => [
      init('claude-session-task-events'),
      sdkMessage({
        type: 'system',
        subtype: 'task_started',
        session_id: 'claude-session-task-events',
        uuid: 'task-started',
        taskId: 'task-camel',
        subagentType: 'researcher',
        prompt: 'Find context'
      }),
      sdkMessage({
        type: 'system',
        subtype: 'task_notification',
        session_id: 'claude-session-task-events',
        uuid: 'task-notification',
        taskId: 'task-camel',
        subagentType: 'researcher',
        status: 'success',
        summary: 'Context found.'
      }),
      result('Done.', 'claude-session-task-events')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Task events' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'delegate',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    await waitUntil(async () => {
      const children = await service.listThreadChildren({ threadId: thread.thread.id })
      return children.children.some((child) => child.id === 'task-camel' && child.status === 'completed')
    })
    const children = await service.listThreadChildren({ threadId: thread.thread.id, parentTurnId: turn.turnId })
    expect(children.children).toEqual([
      expect.objectContaining({
        id: 'task-camel',
        runtimeId: 'claude',
        parentThreadId: thread.thread.id,
        parentTurnId: turn.turnId,
        kind: 'agent',
        status: 'completed',
        name: 'researcher',
        prompt: 'Find context',
        summary: 'Context found.',
        transcriptRef: expect.objectContaining({
          runtimeId: 'claude',
          childId: 'task-camel',
          transcriptId: 'subagents/agent-task-camel'
        })
      })
    ])

    const transcript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      parentTurnId: turn.turnId,
      childId: 'task-camel'
    })
    expect(transcript.transcript).toMatchObject({
      childId: 'task-camel',
      parentTurnId: turn.turnId,
      entries: [
        { id: 'task-camel-prompt', kind: 'user_message', text: 'Find context' },
        { id: 'task-camel-summary', kind: 'assistant_message', text: 'Context found.' }
      ],
      degraded: true
    })
  })
})
