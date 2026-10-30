import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AgentRuntimeId,
  type AppSettingsV1
} from '../shared/app-settings'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadStartInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput
} from '../shared/agent-runtime-contract'
import {
  resolveScheduleModelConfig,
  runPromptViaRuntime,
  waitForAssistantTextViaRuntime,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    modelRouter: {
      ...defaultModelRouterSettings(),
      publicModelAlias: 'router-public-alias',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
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

describe('resolveScheduleModelConfig', () => {
  it('uses the Model Router public alias instead of task or workflow model names', () => {
    expect(resolveScheduleModelConfig(settings(), {
      providerId: 'legacy-provider',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'high'
    })).toEqual({
      providerId: 'legacy-provider',
      model: 'router-public-alias',
      reasoningEffort: 'high'
    })
  })
})

describe('waitForAssistantTextViaRuntime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const status = (
    state: AgentRuntimeThreadStatus['latestTurnStatus'],
    latestSeq = 1
  ): AgentRuntimeThreadStatus => ({
    id: 'thread-1',
    runtimeId: 'dsh',
    latestSeq,
    latestTurnId: 'turn-1',
    latestTurnStatus: state
  })

  const page = (text = ''): AgentRuntimeThreadPage => ({
    runtimeId: 'dsh',
    threadId: 'thread-1',
    latestSeq: 1,
    turns: [{
      id: 'turn-1',
      threadId: 'thread-1',
      status: 'completed',
      items: text ? [{ id: 'assistant-1', kind: 'assistant_message', text }] : []
    }],
    nextCursor: null
  })

  const subscribe = (events: AgentRuntimeEvent[] = []) => vi.fn(async function* (
    _input: { runtimeId: AgentRuntimeId; threadId: string; sinceSeq?: number; signal?: AbortSignal }
  ) {
    for (const event of events) yield event
  })

  it('uses status-only polling while active and reads one page after terminal completion', async () => {
    vi.useFakeTimers()
    const readThreadStatus = vi.fn()
      .mockResolvedValueOnce(status('running', 1))
      .mockResolvedValueOnce(status('completed', 2))
    const readThreadPage = vi.fn(async () => page())
    const subscribeEvents = subscribe()
    const deps = {
      agentRuntime: { readThreadStatus, readThreadPage, subscribeEvents }
    } as unknown as ScheduleRuntimeDeps

    const result = waitForAssistantTextViaRuntime(deps, 'dsh', 'thread-1', 'turn-1', 30_000)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(readThreadStatus).toHaveBeenCalledOnce()
    expect(readThreadPage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(result).resolves.toBe('')
    expect(readThreadStatus).toHaveBeenCalledTimes(2)
    expect(readThreadPage).toHaveBeenCalledOnce()
    expect(subscribeEvents).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'dsh',
      threadId: 'thread-1',
      sinceSeq: 0,
      signal: expect.any(AbortSignal)
    }))
  })

  it('reads at most one page when an active turn reaches the timeout', async () => {
    vi.useFakeTimers()
    const readThreadStatus = vi.fn(async () => status('running'))
    const readThreadPage = vi.fn(async () => page())
    const deps = {
      agentRuntime: { readThreadStatus, readThreadPage, subscribeEvents: subscribe() }
    } as unknown as ScheduleRuntimeDeps

    const result = waitForAssistantTextViaRuntime(deps, 'dsh', 'thread-1', 'turn-1', 3_000)
    const rejection = expect(result).rejects.toThrow('Timed out waiting for agent response.')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(readThreadPage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)

    await rejection
    expect(readThreadStatus).toHaveBeenCalledTimes(2)
    expect(readThreadPage).toHaveBeenCalledOnce()
  })

  it.each([
    {
      label: 'approval',
      event: {
        kind: 'approval_requested',
        runtimeId: 'dsh',
        threadId: 'thread-1',
        turnId: 'turn-1',
        approvalId: 'approval-1',
        summary: 'Approve command'
      } satisfies AgentRuntimeEvent
    },
    {
      label: 'input',
      event: {
        kind: 'user_input_requested',
        runtimeId: 'dsh',
        threadId: 'thread-1',
        turnId: 'turn-1',
        requestId: 'input-1',
        questions: [{ id: 'choice', header: 'Continue', question: 'Continue?', options: [] }]
      } satisfies AgentRuntimeEvent
    }
  ])('fails immediately when the event stream reports pending desktop $label', async ({ event }) => {
    vi.useFakeTimers()
    const readThreadStatus = vi.fn(async () => status('running'))
    const readThreadPage = vi.fn(async () => page())
    const deps = {
      agentRuntime: { readThreadStatus, readThreadPage, subscribeEvents: subscribe([event as AgentRuntimeEvent]) }
    } as unknown as ScheduleRuntimeDeps

    const result = waitForAssistantTextViaRuntime(deps, 'dsh', 'thread-1', 'turn-1', 30_000)
    const rejection = expect(result).rejects.toThrow('waiting for desktop approval or input')
    await vi.advanceTimersByTimeAsync(1_500)

    await rejection
    expect(readThreadStatus).not.toHaveBeenCalled()
    expect(readThreadPage).not.toHaveBeenCalled()
  })
})

describe('runPromptViaRuntime turn settings', () => {
  function promptDeps(captured: { threads: unknown[]; turns: unknown[] }) {
    const agentRuntime = {
      startThread: vi.fn(async (input: AgentRuntimeThreadStartInput) => {
        captured.threads.push(input)
        return { id: 'thread-1' } as unknown as AgentRuntimeThread
      }),
      readThreadStatus: vi.fn(async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        latestSeq: 1,
        latestTurnId: null,
        latestTurnStatus: 'running'
      }) as unknown as AgentRuntimeThreadStatus),
      readThreadPage: vi.fn(async () => ({
        runtimeId: 'codex',
        threadId: 'thread-1',
        latestSeq: 1,
        turns: [],
        nextCursor: null
      }) as unknown as AgentRuntimeThreadPage),
      subscribeEvents: vi.fn(async function* () {}),
      startTurn: vi.fn(async (input: AgentRuntimeTurnStartInput) => {
        captured.turns.push(input)
        return { threadId: input.threadId, turnId: 'turn-1' } as AgentRuntimeTurnHandle
      }),
      interruptTurn: vi.fn(async () => {})
    }
    const deps = {
      store: undefined,
      agentRuntime,
      logError: vi.fn()
    } as unknown as ScheduleRuntimeDeps
    return { deps, agentRuntime }
  }

  it('forwards an explicit level and never forwards the legacy task model field', async () => {
    const captured = { threads: [] as unknown[], turns: [] as unknown[] }
    const { deps, agentRuntime } = promptDeps(captured)
    const result = await runPromptViaRuntime(deps, settings(), {
      prompt: 'run it',
      title: 'Task',
      workspaceRoot: '/tmp/workspace',
      reasoningEffort: 'high',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 1_000,
      runtimeId: 'codex'
    })
    expect(result).toMatchObject({ ok: true, turnId: 'turn-1' })
    expect(captured.threads[0]).not.toHaveProperty('model')
    expect(captured.turns[0]).toMatchObject({ reasoningEffort: 'high' })
    expect(captured.turns[0]).not.toHaveProperty('model')
    expect(agentRuntime.startTurn).toHaveBeenCalledTimes(1)
  })

  it('sends no reasoning field at all for an unset level (upstream default)', async () => {
    const captured = { threads: [] as unknown[], turns: [] as unknown[] }
    const { deps } = promptDeps(captured)
    const result = await runPromptViaRuntime(deps, settings(), {
      prompt: 'run it',
      title: 'Task',
      workspaceRoot: '/tmp/workspace',
      reasoningEffort: '',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 1_000,
      runtimeId: 'codex'
    })
    expect(result).toMatchObject({ ok: true })
    expect(captured.turns[0]).not.toHaveProperty('reasoningEffort')
  })

  it('refuses an explicit level on a session-fixed runtime instead of dropping it', async () => {
    const captured = { threads: [] as unknown[], turns: [] as unknown[] }
    const { deps, agentRuntime } = promptDeps(captured)
    const result = await runPromptViaRuntime(deps, settings(), {
      prompt: 'run it',
      title: 'Task',
      workspaceRoot: '/tmp/workspace',
      reasoningEffort: 'high',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 1_000,
      runtimeId: 'dsh'
    })
    expect(result.ok).toBe(false)
    expect(String((result as { message?: string }).message)).toContain('fixed for the session')
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
  })
})
