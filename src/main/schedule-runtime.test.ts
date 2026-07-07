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
  scheduleTaskWorkflowId,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ScheduledTaskV1,
  type WorkflowRuntimeStatus
} from '../shared/app-settings'
import {
  ScheduleRuntime,
  computeScheduleNextRunAt,
  scheduledThreadTitle,
  type ScheduleWorkflowRunner
} from './schedule-runtime'
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
  agentRuntime: unknown = unusedAgentRuntime(),
  workflowRunner: ScheduleWorkflowRunner = {
    runWorkflow: vi.fn(async () => ({ ok: true as const, runId: 'workflow-run-1', status: 'running' as const, message: 'Started' })),
    status: vi.fn(async (): Promise<WorkflowRuntimeStatus> => ({
      runningWorkflowIds: [],
      nodeStatus: {},
      nodeResults: {},
      powerSaveBlockerActive: false,
      pendingApprovals: []
    }))
  }
) {
  const store = createStore(initial)
  const runtime = new ScheduleRuntime({
    store: store as never,
    agentRuntime: agentRuntime as ScheduleRuntimeDeps['agentRuntime'],
    logError: vi.fn()
  }, workflowRunner)
  return { runtime, store, forbiddenDirectCall, agentRuntime, workflowRunner }
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

  it('delegates manual Schedule runs to the compiled Workflow runtime', async () => {
    const task = makeTask({ reasoningEffort: 'max' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = unusedAgentRuntime()
    const { runtime, workflowRunner } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'workflow-run-1',
      message: 'Started'
    })

    expect(workflowRunner.runWorkflow).toHaveBeenCalledWith(scheduleTaskWorkflowId(task.id))
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('returns Workflow runtime errors without falling back to direct agent execution', async () => {
    const task = makeTask({ runtimeId: 'sciforge' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = unusedAgentRuntime()
    const workflowRunner = {
      runWorkflow: vi.fn(async () => ({ ok: false as const, message: 'Workflow rejected the scheduled run.' })),
      status: vi.fn(async (): Promise<WorkflowRuntimeStatus> => ({
        runningWorkflowIds: [],
        nodeStatus: {},
        nodeResults: {},
        powerSaveBlockerActive: false,
        pendingApprovals: []
      }))
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime, workflowRunner)

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: false,
      message: 'Workflow rejected the scheduled run.'
    })

    expect(workflowRunner.runWorkflow).toHaveBeenCalledWith(scheduleTaskWorkflowId(task.id))
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(store.read().schedule.tasks[0]).toMatchObject({ lastStatus: 'idle', lastMessage: '' })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('projects schedule-owned Workflow runtime status back to Schedule status', async () => {
    const task = makeTask()
    const workflowRunner = {
      runWorkflow: vi.fn(async () => ({ ok: true as const, runId: 'run-1', status: 'running' as const, message: 'Started' })),
      status: vi.fn(async (): Promise<WorkflowRuntimeStatus> => ({
        runningWorkflowIds: [scheduleTaskWorkflowId(task.id), 'workflow-2'],
        nodeStatus: {},
        nodeResults: {},
        powerSaveBlockerActive: true,
        pendingApprovals: []
      }))
    }
    const { runtime } = createRuntime(settingsWith([task]), vi.fn(), unusedAgentRuntime(), workflowRunner)

    await expect(runtime.status()).resolves.toMatchObject({
      runningTaskIds: [task.id],
      powerSaveBlockerActive: true
    })
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
