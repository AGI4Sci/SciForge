import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AgentRuntimeId,
  type AppSettingsV1
} from '@shared/app-settings'
import { getProvider, resetProviderCacheForTests } from './registry'
import { rendererRuntimeClient } from './runtime-client'
import { createDefaultAgentRuntimeCapabilities } from '@shared/agent-runtime-contract'

function transportForRuntime(runtimeId: AgentRuntimeId): 'http_sse' | 'jsonrpc_stdio' | 'cli_process' {
  return runtimeId === 'sciforge' ? 'http_sse' : runtimeId === 'claude' ? 'cli_process' : 'jsonrpc_stdio'
}

function settings(activeAgentRuntime: AgentRuntimeId): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function installSciForge(activeAgentRuntime: AgentRuntimeId): {
  forbiddenDirectCall: ReturnType<typeof vi.fn>
  codexListThreads: ReturnType<typeof vi.fn>
  agentRuntimeListThreads: ReturnType<typeof vi.fn>
  agentRuntimeReadThread: ReturnType<typeof vi.fn>
  agentRuntimeReadThreadSidebarProbe: ReturnType<typeof vi.fn>
  agentRuntimeResolveApproval: ReturnType<typeof vi.fn>
  agentRuntimeResolveUserInput: ReturnType<typeof vi.fn>
  agentRuntimeForkThread: ReturnType<typeof vi.fn>
  agentRuntimeResumeSession: ReturnType<typeof vi.fn>
  agentRuntimeUpdateThreadRelation: ReturnType<typeof vi.fn>
  agentRuntimeAuxiliary: ReturnType<typeof vi.fn>
} {
  const forbiddenDirectCall = vi.fn(async () => ({
    ok: true,
    status: 200,
    body: JSON.stringify({ threads: [] })
  }))
  const codexListThreads = vi.fn(async () => ({ ok: true, threads: [] }))
  const agentRuntimeListThreads = vi.fn(async () => [])
  const agentRuntimeReadThread = vi.fn(async () => ({
    id: 'thread-1',
    runtimeId: activeAgentRuntime,
    title: 'One',
    updatedAt: '2026-06-11T00:00:00.000Z',
    latestSeq: 2,
    items: [
      {
        id: 'approval-item',
        kind: 'approval',
        status: 'pending',
        summary: 'Approve?',
        meta: { approvalId: 'approval-1' }
      },
      {
        id: 'input-item',
        kind: 'user_input',
        status: 'pending',
        summary: 'Input?',
        meta: { requestId: 'input-1' }
      }
    ]
  }))
  const agentRuntimeReadThreadSidebarProbe = vi.fn(async () => ({
    runtimeId: activeAgentRuntime,
    threadId: 'thread-1',
    text: 'real prompt'
  }))
  const agentRuntimeResolveApproval = vi.fn(async () => undefined)
  const agentRuntimeResolveUserInput = vi.fn(async () => undefined)
  const agentRuntimeForkThread = vi.fn(async () => ({
    id: 'side-thread',
    runtimeId: activeAgentRuntime,
    title: 'Side path',
    updatedAt: '2026-06-11T00:00:00.000Z'
  }))
  const agentRuntimeResumeSession = vi.fn(async () => ({
    threadId: 'resumed-thread',
    sessionId: 'session-1'
  }))
  const agentRuntimeUpdateThreadRelation = vi.fn(async () => undefined)
  const agentRuntimeAuxiliary = vi.fn(async (input: { operation?: string }) => {
    if (input.operation === 'listGitCheckpoints') return []
    return { ok: true }
  })
  vi.stubGlobal('window', {
    sciforge: {
      getSettings: vi.fn(async () => settings(activeAgentRuntime)),
      setSettings: vi.fn(),
      agentRuntime: {
        listThreads: agentRuntimeListThreads,
        connect: vi.fn(async () => undefined),
        capabilities: vi.fn(async () => createDefaultAgentRuntimeCapabilities({
          runtimeId: activeAgentRuntime,
          transport: transportForRuntime(activeAgentRuntime)
        })),
        readThread: agentRuntimeReadThread,
        readThreadSidebarProbe: agentRuntimeReadThreadSidebarProbe,
        resolveApproval: agentRuntimeResolveApproval,
        resolveUserInput: agentRuntimeResolveUserInput,
        forkThread: agentRuntimeForkThread,
        resumeSession: agentRuntimeResumeSession,
        updateThreadRelation: agentRuntimeUpdateThreadRelation,
        auxiliary: agentRuntimeAuxiliary
      },
      codex: {
        listThreads: codexListThreads
      },
      forbiddenDirectCall,
    }
  })
  return {
    forbiddenDirectCall,
    codexListThreads,
    agentRuntimeListThreads,
    agentRuntimeReadThread,
    agentRuntimeReadThreadSidebarProbe,
    agentRuntimeResolveApproval,
    agentRuntimeResolveUserInput,
    agentRuntimeForkThread,
    agentRuntimeResumeSession,
    agentRuntimeUpdateThreadRelation,
    agentRuntimeAuxiliary
  }
}

afterEach(() => {
  resetProviderCacheForTests()
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('registry provider selector', () => {
  it('returns a cached neutral provider', () => {
    installSciForge('sciforge')
    const first = getProvider()
    const second = getProvider()
    expect(first).toBe(second)
  })

  it('lists shared threads through neutral IPC while local runtime is active', async () => {
    const { forbiddenDirectCall, codexListThreads, agentRuntimeListThreads } = installSciForge('sciforge')

    await expect(getProvider().listThreads()).resolves.toEqual([])

    expect(agentRuntimeListThreads).toHaveBeenCalledWith({})
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(codexListThreads).not.toHaveBeenCalled()
  })

  it('lists shared threads through neutral IPC while Codex is active', async () => {
    const { forbiddenDirectCall, codexListThreads, agentRuntimeListThreads } = installSciForge('codex')
    const provider = getProvider()

    await expect(provider.connect()).resolves.toBeUndefined()
    expect(provider.id).toBe('codex')
    await expect(provider.listThreads()).resolves.toEqual([])

    expect(agentRuntimeListThreads).toHaveBeenCalledWith({})
    expect(codexListThreads).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('keeps approval and user input responses on the neutral provider path', async () => {
    const {
      forbiddenDirectCall,
      codexListThreads,
      agentRuntimeReadThread,
      agentRuntimeResolveApproval,
      agentRuntimeResolveUserInput
    } = installSciForge('codex')
    const provider = getProvider()
    provider.rememberThreadRuntime?.('thread-1', 'codex')

    await provider.getThreadDetail('thread-1')
    await expect(provider.submitApprovalDecision?.('approval-1', 'deny')).resolves.toBeUndefined()
    await expect(provider.submitUserInputResponse?.('input-1', [
      { id: 'choice', label: 'No', value: 'no' }
    ])).resolves.toBeUndefined()

    expect(agentRuntimeReadThread).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'thread-1' })
    expect(agentRuntimeResolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'denied'
    })
    expect(agentRuntimeResolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'input-1',
      answers: [{ id: 'choice', label: 'No', value: 'no' }]
    })
    expect(codexListThreads).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('forwards sidebar thread probes through the neutral provider path', async () => {
    const {
      forbiddenDirectCall,
      codexListThreads,
      agentRuntimeReadThread,
      agentRuntimeReadThreadSidebarProbe
    } = installSciForge('codex')
    const provider = getProvider()
    provider.rememberThreadRuntime?.('thread-1', 'codex')

    await expect(provider.getThreadSidebarProbe?.('thread-1')).resolves.toEqual({ text: 'real prompt' })

    expect(agentRuntimeReadThreadSidebarProbe).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(agentRuntimeReadThread).not.toHaveBeenCalled()
    expect(codexListThreads).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('keeps fork, resume, and relation updates on the neutral provider path', async () => {
    const {
      forbiddenDirectCall,
      codexListThreads,
      agentRuntimeForkThread,
      agentRuntimeResumeSession,
      agentRuntimeUpdateThreadRelation
    } = installSciForge('sciforge')
    const provider = getProvider()
    provider.rememberThreadRuntime?.('thread-1', 'sciforge')

    await expect(provider.forkThread?.('thread-1', {
      relation: 'side',
      title: 'Side path'
    })).resolves.toEqual(expect.objectContaining({ id: 'side-thread', runtimeId: 'sciforge' }))
    await expect(provider.resumeSession?.('session-1', {
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })).resolves.toEqual({ threadId: 'resumed-thread', sessionId: 'session-1' })
    await expect(provider.updateThreadRelation?.('thread-1', 'primary')).resolves.toBeUndefined()

    expect(agentRuntimeForkThread).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })
    expect(agentRuntimeResumeSession).toHaveBeenCalledWith({
      runtimeId: 'codex',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent'
    })
    expect(agentRuntimeUpdateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      relation: 'primary'
    })
    expect(codexListThreads).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('passes checkpoint helpers through neutral auxiliary with top-level runtime routing', async () => {
    const {
      forbiddenDirectCall,
      codexListThreads,
      agentRuntimeAuxiliary
    } = installSciForge('codex')
    const provider = getProvider()

    await expect(provider.listGitCheckpoints?.({
      runtimeId: 'sciforge',
      threadId: 'thread-1',
      workspaceRoot: '/tmp/workspace'
    })).resolves.toEqual([])
    await expect(provider.previewGitCheckpoint?.('checkpoint-1')).resolves.toEqual({ ok: true })
    await expect(provider.restoreGitCheckpoint?.('checkpoint-1', { force: true })).resolves.toEqual({ ok: true })

    expect(agentRuntimeAuxiliary).toHaveBeenNthCalledWith(1, {
      runtimeId: 'sciforge',
      operation: 'listGitCheckpoints',
      payload: {
        threadId: 'thread-1',
        workspaceRoot: '/tmp/workspace'
      }
    })
    expect(agentRuntimeAuxiliary).toHaveBeenNthCalledWith(2, {
      runtimeId: 'codex',
      operation: 'previewGitCheckpoint',
      payload: { checkpointId: 'checkpoint-1' }
    })
    expect(agentRuntimeAuxiliary).toHaveBeenNthCalledWith(3, {
      runtimeId: 'codex',
      operation: 'restoreGitCheckpoint',
      payload: { checkpointId: 'checkpoint-1', force: true }
    })
    expect(codexListThreads).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('passes code navigation through neutral auxiliary', async () => {
    const {
      forbiddenDirectCall,
      codexListThreads,
      agentRuntimeAuxiliary
    } = installSciForge('sciforge')
    const provider = getProvider()

    await expect(provider.runCodeNavigation?.({
      workspaceRoot: '/tmp/workspace',
      operation: 'goToDefinition',
      filePath: 'src/index.ts',
      line: 4,
      character: 2
    })).resolves.toEqual({ ok: true })

    expect(agentRuntimeAuxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'runCodeNavigation',
      payload: {
        workspaceRoot: '/tmp/workspace',
        operation: 'goToDefinition',
        filePath: 'src/index.ts',
        line: 4,
        character: 2
      }
    })
    expect(codexListThreads).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })
})
