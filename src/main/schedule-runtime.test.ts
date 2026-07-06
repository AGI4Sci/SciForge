import { createServer, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  mergeScheduleSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ScheduledTaskV1
} from '../shared/app-settings'
import { ScheduleRuntime, computeScheduleNextRunAt, scheduledThreadTitle } from './schedule-runtime'
import type { ScheduleRuntimeDeps } from './schedule-runtime-helpers'

function makeTask(patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  const schedule = {
    kind: 'manual' as const,
    everyMinutes: 60,
    timeOfDay: '09:00',
    atTime: '',
    ...patch.schedule
  }
  return {
    id: 'task-1',
    title: 'Task 1',
    enabled: true,
    prompt: 'Run the task',
    workspaceRoot: '/tmp/workspace',
    model: 'auto',
    reasoningEffort: 'medium',
    mode: 'agent',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    ...patch,
    schedule
  }
}

function settingsWith(
  tasks: ScheduledTaskV1[] = [],
  schedulePatch: AppSettingsPatch['schedule'] = {}
): AppSettingsV1 {
  const modelRouter = defaultModelRouterSettings()
  modelRouter.runtimeApiKey = 'local-runtime-router-key'
  modelRouter.profiles.default.textReasoner = {
    provider: 'openai-compatible',
    baseUrl: 'https://text-provider.example/v1',
    apiKey: 'text-secret',
    model: 'text-model'
  }

  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter,
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: mergeScheduleSettings(defaultScheduleSettings(), {
      enabled: true,
      tasks,
      ...schedulePatch
    }),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function createStore(initial: AppSettingsV1) {
  let current = initial
  return {
    load: vi.fn(async () => current),
    patch: vi.fn(async (partial: AppSettingsPatch) => {
      current = {
        ...current,
        schedule: mergeScheduleSettings(current.schedule, partial.schedule),
        remoteChannel: current.remoteChannel
      }
      return current
    }),
    read: () => current
  }
}

function unusedAgentRuntime(): ScheduleRuntimeDeps['agentRuntime'] {
  const fail = async (): Promise<never> => {
    throw new Error('Unexpected agentRuntime call in this test.')
  }
  return {
    startThread: vi.fn(fail),
    readThread: vi.fn(fail),
    startTurn: vi.fn(fail),
    interruptTurn: vi.fn(fail)
  } as unknown as ScheduleRuntimeDeps['agentRuntime']
}

function createRuntime(
  initial: AppSettingsV1,
  forbiddenDirectCall = vi.fn(),
  agentRuntime: unknown = unusedAgentRuntime()
) {
  const store = createStore(initial)
  const runtime = new ScheduleRuntime({
    store: store as never,
    agentRuntime: agentRuntime as ScheduleRuntimeDeps['agentRuntime'],
    logError: vi.fn()
  })
  return { runtime, store, forbiddenDirectCall, agentRuntime }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const port = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function postInternal(
  port: number,
  path: string,
  body: Record<string, unknown>,
  secret = '',
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders }
  if (secret) headers.Authorization = `Bearer ${secret}`
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>
  }
}

describe('ScheduleRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('computes nextRunAt for supported schedule kinds', () => {
    const from = new Date('2026-06-02T00:00:00.000Z')

    expect(computeScheduleNextRunAt(makeTask(), from)).toBe('')
    expect(computeScheduleNextRunAt(makeTask({
      schedule: { kind: 'interval', everyMinutes: 15, timeOfDay: '09:00', atTime: '' }
    }), from)).toBe('2026-06-02T00:15:00.000Z')
    expect(computeScheduleNextRunAt(makeTask({
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-03T09:00:00.000+08:00'
      }
    }), from)).toBe('2026-06-03T09:00:00.000+08:00')
  })

  it('builds compact Scheduled task thread titles from task names', () => {
    expect(scheduledThreadTitle('每日A股行情盘')).toBe('[Scheduled task] 每日A股')
    expect(scheduledThreadTitle('Task 1')).toBe('[Scheduled task] Task')
    expect(scheduledThreadTitle('   ')).toBe('[Scheduled task]')
  })

  it('creates detected reminder requests into top-level schedule settings', async () => {
    const future = '2099-06-03T09:00:00.000Z'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        output_text: JSON.stringify({
          shouldCreateTask: true,
          scheduleAt: future,
          reminderBody: 'ship the review',
          taskName: 'Ship review'
        })
      })
    })))
    const { runtime, store } = createRuntime(settingsWith())
    vi.spyOn(runtime, 'sync').mockImplementation(() => undefined)

    const result = await runtime.createScheduledTaskFromText('Remind me tomorrow to ship the review.', {
      workspaceRoot: '/tmp/schedule',
      modelHint: 'deepseek-v4-flash',
      mode: 'plan'
    })

    expect(result).toMatchObject({
      kind: 'created',
      title: 'Ship review reminder',
      scheduleAt: future
    })
    expect(store.read().schedule.enabled).toBe(true)
    expect(store.read().schedule.tasks[0]).toMatchObject({
      title: 'Ship review reminder',
      workspaceRoot: '/tmp/schedule',
      model: 'deepseek-v4-flash',
      mode: 'plan',
      schedule: { kind: 'at', atTime: future }
    })
    expect('tasks' in store.read().remoteChannel).toBe(false)
  })

  it('starts a SciForge thread through agentRuntime with a Schedule title and records running status', async () => {
    const task = makeTask({ reasoningEffort: 'max' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'sciforge',
        title: '[Scheduled task] Task',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_1' })),
      readThread: vi.fn()
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'thr_1',
      turnId: 'turn_1'
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      title: '[Scheduled task] Task',
      workspace: '/tmp/workspace',
      model: 'auto',
      mode: 'agent'
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith({
      runtimeId: 'sciforge',
      threadId: 'thr_1',
      text: expect.stringContaining('Run the task'),
      workspace: '/tmp/workspace',
      mode: 'agent',
      model: 'auto',
      reasoningEffort: 'max',
      governanceProfile: 'remote_guard'
    })
    expect(store.read().schedule.tasks[0]).toMatchObject({
      lastStatus: 'running',
      lastMessage: 'Started',
      agentThreadIds: { sciforge: 'thr_1' }
    })
    expect(store.read().schedule.tasks[0]).not.toHaveProperty('lastThreadId')
  })

  it('runs Codex scheduled tasks through agentRuntime and saves the Codex thread id', async () => {
    const task = makeTask({
      runtimeId: 'codex',
      agentThreadIds: { sciforge: 'sciforge-thread' }
    })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex',
        title: '[Scheduled task] Task',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'codex-thread', turnId: 'codex-turn' })),
      readThread: vi.fn()
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'codex-thread',
      turnId: 'codex-turn'
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: '[Scheduled task] Task',
      mode: 'agent',
      model: 'auto'
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: expect.stringContaining('Run the task'),
      workspace: '/tmp/workspace',
      mode: 'agent',
      model: 'auto',
      reasoningEffort: 'medium',
      governanceProfile: 'remote_guard'
    })
    expect(store.read().schedule.tasks[0]).toMatchObject({
      runtimeId: 'codex',
      lastStatus: 'running',
      lastMessage: 'Started',
      agentThreadIds: {
        sciforge: 'sciforge-thread',
        codex: 'codex-thread'
      }
    })
    expect(store.read().schedule.tasks[0]).not.toHaveProperty('lastThreadId')
  })

  it('runs SciForge scheduled tasks through agentRuntime when the host is available', async () => {
    const task = makeTask({ runtimeId: 'sciforge' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'sciforge-host-thread',
        runtimeId: 'sciforge',
        title: '[Scheduled task] Task',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'sciforge-host-thread', turnId: 'sciforge-host-turn' })),
      readThread: vi.fn()
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'sciforge-host-thread',
      turnId: 'sciforge-host-turn'
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'sciforge',
      workspace: '/tmp/workspace',
      title: '[Scheduled task] Task'
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'sciforge',
      threadId: 'sciforge-host-thread',
      text: expect.stringContaining('Run the task')
    }))
    expect(store.read().schedule.tasks[0]).toMatchObject({
      runtimeId: 'sciforge',
      lastStatus: 'running',
      agentThreadIds: {
        sciforge: 'sciforge-host-thread'
      }
    })
    expect(store.read().schedule.tasks[0]).not.toHaveProperty('lastThreadId')
  })

  it('records an error when agentRuntime rejects scheduled runs', async () => {
    const task = makeTask({ runtimeId: 'sciforge' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = unusedAgentRuntime()
    vi.mocked(agentRuntime.startThread).mockRejectedValue(new Error('AgentRuntimeHost rejected the scheduled run.'))
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('AgentRuntimeHost rejected the scheduled run')
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(store.read().schedule.tasks[0]).toMatchObject({
      lastStatus: 'error',
      lastMessage: expect.stringContaining('AgentRuntimeHost rejected the scheduled run')
    })
  })

  it('reads assistant text from the agentRuntime thread detail shape', async () => {
    const task = makeTask()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'sciforge',
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_1' })),
      readThread: vi.fn(async () => ({
        id: 'thr_1',
        status: 'idle',
        turns: [
          {
            id: 'turn_1',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'scheduled task completed' }]
          }
        ]
      }))
    }
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000
    })

    expect(result).toMatchObject({ ok: true, text: 'scheduled task completed' })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.readThread).toHaveBeenCalledWith({ runtimeId: 'sciforge', threadId: 'thr_1' })
  })

  it('waits for the current scheduled turn to complete before returning final text', async () => {
    const task = makeTask()
    let getCount = 0
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'sciforge',
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_current' })),
      readThread: vi.fn(async () => {
        getCount += 1
        return getCount === 1
          ? {
              id: 'thr_1',
              status: 'running',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
                },
                {
                  id: 'turn_current',
                  status: 'running',
                  items: [{ kind: 'assistant_text', text: 'intermediate scheduled reply' }]
                }
              ]
            }
          : {
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
                },
                {
                  id: 'turn_current',
                  status: 'completed',
                  items: [
                    { kind: 'assistant_text', text: 'intermediate scheduled reply' },
                    { kind: 'assistant_text', text: 'final scheduled reply' }
                  ]
                }
              ]
            }
      })
    }
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_500
    })

    expect(result).toMatchObject({ ok: true, text: 'final scheduled reply' })
    expect(getCount).toBe(2)
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('does not return historical scheduled text when the current turn fails', async () => {
    const task = makeTask()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'sciforge',
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_current' })),
      readThread: vi.fn(async () => ({
        id: 'thr_1',
        status: 'idle',
        turns: [
          {
            id: 'turn_previous',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
          },
          {
            id: 'turn_current',
            status: 'failed',
            items: []
          }
        ]
      }))
    }
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    await expect((runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000
    })).rejects.toThrow('Agent turn failed.')
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('disables one-time tasks after monitored completion', async () => {
    const task = makeTask({
      lastStatus: 'running',
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2099-06-03T09:00:00.000Z'
      }
    })
    const agentRuntime = {
      startThread: vi.fn(),
      startTurn: vi.fn(),
      readThread: vi.fn(async () => ({
        id: 'thr_1',
        status: 'idle',
        turns: [
          {
            id: 'turn_1',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'done' }]
          }
        ]
      }))
    }
    const { runtime, store } = createRuntime(settingsWith([task]), vi.fn(), agentRuntime)

    await (runtime as unknown as {
      monitorTaskTurn: (taskId: string, threadId: string, turnId: string) => Promise<void>
    }).monitorTaskTurn(task.id, 'thr_1', 'turn_1')

    expect(store.read().schedule.tasks[0]).toMatchObject({
      enabled: false,
      nextRunAt: '',
      lastStatus: 'success',
      lastMessage: 'done',
      agentThreadIds: { sciforge: 'thr_1' }
    })
    expect(store.read().schedule.tasks[0]).not.toHaveProperty('lastThreadId')
    expect(agentRuntime.readThread).toHaveBeenCalledWith({ runtimeId: 'sciforge', threadId: 'thr_1' })
  })

  it('does not auto-run manual tasks during tick', async () => {
    const task = makeTask({
      schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
      nextRunAt: '2026-06-02T00:00:00.000Z'
    })
    const forbiddenDirectCall = vi.fn()
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall)

    await (runtime as unknown as { tick: () => Promise<void> }).tick()

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('marks interrupted running tasks as errors during next-run recovery', async () => {
    const task = makeTask({
      lastStatus: 'running',
      schedule: { kind: 'interval', everyMinutes: 10, timeOfDay: '09:00', atTime: '' }
    })
    const initial = settingsWith([task])
    const { runtime, store } = createRuntime(initial)

    await (runtime as unknown as {
      ensureNextRuns: (settings: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(initial)

    expect(store.read().schedule.tasks[0].lastStatus).toBe('error')
    expect(store.read().schedule.tasks[0].lastMessage).toBe('Task was interrupted before completion.')
    expect(Date.parse(store.read().schedule.tasks[0].nextRunAt)).toBeGreaterThan(0)
  })

  it('uses the power save blocker only for enabled automatic schedules', () => {
    const started = new Set<number>()
    const powerSaveBlocker = {
      start: vi.fn(() => {
        started.add(1)
        return 1
      }),
      stop: vi.fn((id: number) => {
        started.delete(id)
      }),
      isStarted: vi.fn((id: number) => started.has(id))
    }
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith()) as never,
      agentRuntime: unusedAgentRuntime(),
      logError: vi.fn(),
      powerSaveBlocker
    })
    const scheduled = settingsWith([
      makeTask({ schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' } })
    ], { keepAwake: true })

    ;(runtime as unknown as { syncPowerSaveBlocker: (settings: AppSettingsV1) => void })
      .syncPowerSaveBlocker(scheduled)
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension')

    ;(runtime as unknown as { syncPowerSaveBlocker: (settings: AppSettingsV1) => void })
      .syncPowerSaveBlocker({ ...scheduled, schedule: { ...scheduled.schedule, keepAwake: false } })
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(1)
  })

  it('serves status, run, and detect-from-text through the authenticated internal HTTP API', async () => {
    const port = await findAvailablePort()
    const secret = 'internal-secret'
    const task = makeTask()
    const settings = settingsWith([task], { internal: { port, secret } })
    const { runtime } = createRuntime(settings)
    const syncInternalServer = (runtime as unknown as {
      syncInternalServer: (settings: AppSettingsV1) => void
    }).syncInternalServer.bind(runtime)
    syncInternalServer(settings)

    try {
      await expect(postInternal(port, '/schedule/internal/status', {})).resolves.toMatchObject({
        status: 401,
        json: { ok: false, message: 'Unauthorized.' }
      })

      await expect(postInternal(port, '/schedule/internal/status', {}, '', {
        'x-sciforge-secret': secret
      })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          status: {
            internalServerRunning: true,
            internalUrl: `http://127.0.0.1:${port}`,
            runningTaskIds: []
          }
        }
      })

      await expect(postInternal(port, '/schedule/internal/status', {}, secret)).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          status: {
            internalServerRunning: true,
            internalUrl: `http://127.0.0.1:${port}`,
            runningTaskIds: []
          }
        }
      })

      const runTask = vi.spyOn(runtime, 'runTask').mockResolvedValue({
        ok: true,
        threadId: 'thread-1',
        turnId: 'turn-1',
        message: 'Started'
      })
      await expect(postInternal(port, '/schedule/internal/run', { taskId: task.id }, secret))
        .resolves.toMatchObject({
          status: 200,
          json: {
            ok: true,
            result: {
              ok: true,
              threadId: 'thread-1',
              turnId: 'turn-1'
            }
          }
        })
      expect(runTask).toHaveBeenCalledWith(task.id)

      const createFromText = vi.spyOn(runtime, 'createScheduledTaskFromText').mockResolvedValue({
        kind: 'created',
        taskId: 'detected-task',
        title: 'Detected task',
        scheduleAt: '2099-06-03T09:00:00.000Z',
        confirmationText: 'Scheduled.'
      })
      await expect(postInternal(port, '/schedule/internal/detect-from-text', {
        text: 'Remind me tomorrow.',
        workspaceRoot: '/tmp/workspace',
        modelHint: 'deepseek-v4-flash',
        mode: 'plan'
      }, secret)).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          result: {
            kind: 'created',
            taskId: 'detected-task'
          }
        }
      })
      expect(createFromText).toHaveBeenCalledWith('Remind me tomorrow.', {
        workspaceRoot: '/tmp/workspace',
        modelHint: 'deepseek-v4-flash',
        mode: 'plan'
      })
    } finally {
      runtime.stop()
    }
  })

  it('denies internal HTTP requests when the stored schedule secret is empty', async () => {
    const port = await findAvailablePort()
    const settings = settingsWith([], { internal: { port, secret: '' } })
    const { runtime } = createRuntime(settings)
    const syncInternalServer = (runtime as unknown as {
      syncInternalServer: (settings: AppSettingsV1) => void
    }).syncInternalServer.bind(runtime)
    syncInternalServer(settings)

    try {
      await expect(postInternal(port, '/schedule/internal/status', {}, 'anything')).resolves.toMatchObject({
        status: 401,
        json: { ok: false, message: 'Unauthorized.' }
      })
    } finally {
      runtime.stop()
    }
  })
})
