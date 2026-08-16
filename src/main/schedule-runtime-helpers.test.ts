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
  AgentRuntimeThreadPage,
  AgentRuntimeThreadStatus
} from '../shared/agent-runtime-contract'
import {
  resolveScheduleModelConfig,
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
    runtimeId: 'sciforge',
    latestSeq,
    latestTurnId: 'turn-1',
    latestTurnStatus: state
  })

  const page = (text = ''): AgentRuntimeThreadPage => ({
    runtimeId: 'sciforge',
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

    const result = waitForAssistantTextViaRuntime(deps, 'sciforge', 'thread-1', 'turn-1', 30_000)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(readThreadStatus).toHaveBeenCalledOnce()
    expect(readThreadPage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(result).resolves.toBe('')
    expect(readThreadStatus).toHaveBeenCalledTimes(2)
    expect(readThreadPage).toHaveBeenCalledOnce()
    expect(subscribeEvents).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'sciforge',
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

    const result = waitForAssistantTextViaRuntime(deps, 'sciforge', 'thread-1', 'turn-1', 3_000)
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
        runtimeId: 'sciforge',
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
        runtimeId: 'sciforge',
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

    const result = waitForAssistantTextViaRuntime(deps, 'sciforge', 'thread-1', 'turn-1', 30_000)
    const rejection = expect(result).rejects.toThrow('waiting for desktop approval or input')
    await vi.advanceTimersByTimeAsync(1_500)

    await rejection
    expect(readThreadStatus).not.toHaveBeenCalled()
    expect(readThreadPage).not.toHaveBeenCalled()
  })
})
