import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import type {
  AppSettingsV1,
  AgentRuntimeId,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult,
  ScheduledTaskV1
} from '../shared/app-settings'
import {
  DEFAULT_SCHEDULE_MODEL,
  normalizeAgentRuntimeId,
  normalizeScheduleReasoningEffort
} from '../shared/app-settings'
import {
  buildScheduledTaskFromDetectedRequest,
  detectScheduledTaskRequest
} from './scheduled-task-detector'
import { isAuthorizedInternalHttpRequest } from './internal-http-secret'
import {
  asString,
  computeScheduleNextRunAt,
  internalUrl,
  nestedRecord,
  parseJsonObject,
  readRequestBody,
  runPromptViaRuntime,
  SCHEDULER_INTERVAL_MS,
  summarizeTaskResult,
  TASK_RESPONSE_TIMEOUT_MS,
  waitForAssistantTextViaRuntime,
  writeJson,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'

export { computeScheduleNextRunAt } from './schedule-runtime-helpers'

export function scheduledThreadTitle(title: string): string {
  const trimmed = title.trim()
  const prefix = '[Scheduled task]'
  const suffix = Array.from(trimmed).slice(0, 4).join('')
  return suffix ? `${prefix} ${suffix}` : prefix
}

type RunningScheduleTask = {
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  eventSinceSeq: number
}

export class ScheduleRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private readonly runningTasks = new Map<string, RunningScheduleTask>()
  private server: Server | null = null
  private serverKey = ''
  private powerSaveBlockerId: number | null = null

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.startScheduler()
    this.syncInternalServer(settings)
    this.syncPowerSaveBlocker(settings)
    void this.ensureNextRuns(settings)
  }

  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    for (const running of this.runningTasks.values()) {
      void this.deps.agentRuntime.interruptTurn?.({
        runtimeId: running.runtimeId,
        threadId: running.threadId,
        turnId: running.turnId
      }).catch((error) => {
        this.deps.logError('schedule-task', 'Failed to interrupt scheduled task during shutdown', {
          message: error instanceof Error ? error.message : String(error),
          threadId: running.threadId,
          turnId: running.turnId
        })
      })
    }
    this.runningTasks.clear()
    this.closeInternalServer()
    this.stopPowerSaveBlocker()
  }

  async status(): Promise<ScheduleRuntimeStatus> {
    const settings = await this.deps.store.load()
    return {
      internalServerRunning: this.server !== null,
      internalUrl: internalUrl(settings),
      runningTaskIds: [...this.runningTasks.keys()],
      powerSaveBlockerActive: this.isPowerSaveBlockerActive()
    }
  }

  async runTask(taskId: string): Promise<ScheduleRunResult> {
    const settings = await this.deps.store.load()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return { ok: false, message: 'Task not found.' }
    if (!task.prompt.trim()) return { ok: false, message: 'Task prompt is empty.' }
    if (this.runningTasks.has(task.id)) return { ok: false, message: 'Task is already running.' }
    const runtimeId = normalizeAgentRuntimeId(task.runtimeId ?? settings.activeAgentRuntime)
    const result = await runPromptViaRuntime(this.deps, settings, {
      prompt: task.prompt,
      title: scheduledThreadTitle(task.title),
      workspaceRoot: task.workspaceRoot,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      mode: task.mode,
      runtimeId,
      waitForResult: false,
      responseTimeoutMs: TASK_RESPONSE_TIMEOUT_MS
    })
    if (!result.ok) return result
    const threadId = result.threadId.trim()
    const turnId = result.turnId?.trim() ?? ''
    if (!threadId || !turnId) return { ok: false, message: 'Failed to start scheduled task.' }

    const running = {
      runtimeId,
      threadId,
      turnId,
      eventSinceSeq: result.eventSinceSeq ?? 0
    }
    this.runningTasks.set(task.id, running)
    await this.updateTaskRunState(task.id, (current) => ({
      ...current,
      lastRunAt: new Date().toISOString(),
      nextRunAt: '',
      lastStatus: 'running',
      lastMessage: 'Running',
      runtimeId,
      agentThreadIds: {
        ...(current.agentThreadIds ?? {}),
        [runtimeId]: threadId
      }
    }))
    this.syncPowerSaveBlocker(await this.deps.store.load())
    void this.finishTask(task.id, running)
    return { ok: true, threadId, turnId, message: result.message || 'Started' }
  }

  private async finishTask(taskId: string, running: RunningScheduleTask): Promise<void> {
    let status: ScheduledTaskV1['lastStatus'] = 'success'
    let message = 'Completed'
    try {
      const text = await waitForAssistantTextViaRuntime(
        this.deps,
        running.runtimeId,
        running.threadId,
        running.turnId,
        TASK_RESPONSE_TIMEOUT_MS,
        running.eventSinceSeq
      )
      message = summarizeTaskResult(text)
    } catch (error) {
      status = 'error'
      message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-task', 'Scheduled task failed', { taskId, message })
    } finally {
      const active = this.runningTasks.get(taskId)
      if (active?.turnId === running.turnId) this.runningTasks.delete(taskId)
      await this.updateTaskRunState(taskId, (current) => {
        const finishedAt = new Date()
        const oneShot = current.schedule.kind === 'at'
        return {
          ...current,
          ...(oneShot ? { enabled: false } : {}),
          lastStatus: status,
          lastMessage: message,
          updatedAt: finishedAt.toISOString(),
          nextRunAt: oneShot ? '' : computeScheduleNextRunAt(current, finishedAt)
        }
      })
      this.syncPowerSaveBlocker(await this.deps.store.load())
    }
  }

  private async updateTaskRunState(
    taskId: string,
    update: (task: ScheduledTaskV1) => ScheduledTaskV1
  ): Promise<void> {
    const settings = await this.deps.store.load()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return
    await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.map((item) => item.id === taskId ? update(item) : item)
      }
    })
  }

  async createScheduledTaskFromText(
    text: string,
    options: { workspaceRoot?: string | null; modelHint?: string | null; mode?: ScheduleRunMode | null } = {}
  ): Promise<ScheduleTaskFromTextResult> {
    const settings = await this.deps.store.load()
    try {
      const request = await detectScheduledTaskRequest(settings, text)
      if (!request) return { kind: 'noop' }
      const task = buildScheduledTaskFromDetectedRequest({
        request,
        workspaceRoot: options.workspaceRoot?.trim() || this.resolveDefaultWorkspaceRoot(settings),
        model: options.modelHint?.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
        mode: options.mode ?? settings.schedule.mode,
        id: randomUUID()
      })
      task.runtimeId = normalizeAgentRuntimeId(settings.activeAgentRuntime)
      task.agentThreadIds = task.agentThreadIds ?? {}
      const saved = await this.deps.store.patch({
        schedule: {
          enabled: true,
          tasks: [...settings.schedule.tasks, task]
        }
      })
      this.sync(saved)
      return {
        kind: 'created',
        taskId: task.id,
        title: task.title,
        scheduleAt: request.scheduleAt,
        confirmationText: request.confirmationText
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-task', 'Failed to create scheduled task from text', { message, text })
      return { kind: 'error', message }
    }
  }

  async listTasks(): Promise<ScheduledTaskV1[]> {
    const settings = await this.deps.store.load()
    return settings.schedule.tasks
  }

  async createTask(task: ScheduledTaskV1): Promise<ScheduledTaskV1> {
    const settings = await this.deps.store.load()
    const saved = await this.deps.store.patch({
      schedule: {
        enabled: true,
        tasks: [...settings.schedule.tasks, task]
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === task.id) ?? task
  }

  async createTaskFromInput(input: {
    title: string
    prompt: string
    workspaceRoot?: string
    model?: string
    reasoningEffort?: ScheduleReasoningEffort
    mode?: ScheduleRunMode
    enabled?: boolean
    schedule: Partial<ScheduledTaskV1['schedule']> & { kind: ScheduledTaskV1['schedule']['kind'] }
  }): Promise<ScheduledTaskV1> {
    const settings = await this.deps.store.load()
    const now = new Date().toISOString()
    const task: ScheduledTaskV1 = {
      id: randomUUID(),
      title: input.title.trim() || 'New scheduled task',
      enabled: input.enabled !== false,
      prompt: input.prompt,
      workspaceRoot: input.workspaceRoot?.trim() || this.resolveDefaultWorkspaceRoot(settings),
      model: input.model?.trim() || settings.schedule.model || DEFAULT_SCHEDULE_MODEL,
      reasoningEffort: normalizeScheduleReasoningEffort(input.reasoningEffort),
      mode: input.mode ?? settings.schedule.mode,
      schedule: {
        kind: input.schedule.kind,
        everyMinutes: typeof input.schedule.everyMinutes === 'number' ? input.schedule.everyMinutes : 60,
        timeOfDay: input.schedule.timeOfDay?.trim() || '09:00',
        atTime: input.schedule.atTime?.trim() || ''
      },
      createdAt: now,
      updatedAt: now,
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      runtimeId: normalizeAgentRuntimeId(settings.activeAgentRuntime),
      agentThreadIds: {}
    }
    const saved = await this.createTask(task)
    return saved
  }

  async updateTaskById(taskId: string, patch: Partial<ScheduledTaskV1>): Promise<ScheduledTaskV1 | null> {
    const settings = await this.deps.store.load()
    const task = settings.schedule.tasks.find((item) => item.id === taskId)
    if (!task) return null
    const now = new Date().toISOString()
    const shouldRecomputeNextRun =
      Object.prototype.hasOwnProperty.call(patch, 'enabled') || patch.schedule !== undefined
    const nextTask: ScheduledTaskV1 = {
      ...task,
      ...patch,
      schedule: patch.schedule ? { ...task.schedule, ...patch.schedule } : task.schedule,
      ...(shouldRecomputeNextRun ? { nextRunAt: '' } : {}),
      updatedAt: now
    }
    const saved = await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.map((item) => (item.id === taskId ? nextTask : item))
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.find((item) => item.id === taskId) ?? nextTask
  }

  async deleteTaskById(taskId: string): Promise<boolean> {
    const settings = await this.deps.store.load()
    if (!settings.schedule.tasks.some((item) => item.id === taskId)) return false
    const saved = await this.deps.store.patch({
      schedule: {
        tasks: settings.schedule.tasks.filter((item) => item.id !== taskId)
      }
    })
    this.sync(saved)
    return saved.schedule.tasks.every((item) => item.id !== taskId)
  }

  private resolveDefaultWorkspaceRoot(settings: AppSettingsV1): string {
    return settings.schedule.defaultWorkspaceRoot.trim() || settings.workspaceRoot
  }

  private startScheduler(): void {
    if (this.scheduler) return
    this.scheduler = setInterval(() => {
      void this.tick()
    }, SCHEDULER_INTERVAL_MS)
    this.scheduler.unref?.()
    void this.tick()
  }

  private async tick(): Promise<void> {
    const settings = await this.deps.store.load()
    if (!settings.schedule.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.deps.store.load()
    const now = Date.now()
    for (const task of fresh.schedule.tasks) {
      if (!task.enabled || this.runningTasks.has(task.id)) continue
      const dueAt = Date.parse(task.nextRunAt)
      if (!Number.isFinite(dueAt) || dueAt > now) continue
      void this.runTask(task.id)
    }
  }

  private async ensureNextRuns(settings: AppSettingsV1): Promise<void> {
    const now = new Date()
    let changed = false
    const tasks = settings.schedule.tasks.map((task) => {
      if (this.runningTasks.has(task.id)) return task
      if (task.lastStatus === 'running') {
        changed = true
        const oneShot = task.schedule.kind === 'at'
        return {
          ...task,
          ...(oneShot ? { enabled: false } : {}),
          lastStatus: 'error' as const,
          lastMessage: 'Scheduled task was interrupted before completion.',
          updatedAt: now.toISOString(),
          nextRunAt: oneShot ? '' : computeScheduleNextRunAt(task, now)
        }
      }
      if (
        !settings.schedule.enabled ||
        !task.enabled ||
        task.schedule.kind === 'manual' ||
        task.nextRunAt
      ) return task
      changed = true
      return {
        ...task,
        nextRunAt: computeScheduleNextRunAt(task, now)
      }
    })
    if (!changed) return
    await this.deps.store.patch({ schedule: { tasks } })
  }

  private syncInternalServer(settings: AppSettingsV1): void {
    const internal = settings.schedule.internal
    const key = `${internal.port}`
    if (this.server && this.serverKey === key) return
    this.closeInternalServer()

    const server = createServer((req, res) => {
      void this.handleInternalRequest(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('schedule-server', 'Schedule internal server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.server === server) {
        this.closeInternalServer()
      }
    })
    server.listen(internal.port, '127.0.0.1')
    this.server = server
    this.serverKey = key
  }

  private closeInternalServer(): void {
    if (!this.server) return
    const server = this.server
    this.server = null
    this.serverKey = ''
    server.close()
  }

  private async handleInternalRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith('/schedule/internal/')) {
        writeJson(res, 404, { ok: false, message: 'Not found.' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, message: 'Method not allowed.' })
        return
      }
      if (!isAuthorizedInternalHttpRequest(req, settings.schedule.internal.secret)) {
        writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
        return
      }

      if (url.pathname === '/schedule/internal/list') {
        const tasks = await this.listTasks()
        writeJson(res, 200, { ok: true, tasks })
        return
      }

      if (url.pathname === '/schedule/internal/status') {
        const status = await this.status()
        writeJson(res, 200, { ok: true, status })
        return
      }

      const body = await readRequestBody(req)
      const payload = parseJsonObject(body)
      if (!payload) {
        writeJson(res, 400, { ok: false, message: 'Expected a JSON object.' })
        return
      }

      if (url.pathname === '/schedule/internal/create') {
        const input = nestedRecord(payload.input)
        if (!input || Object.keys(input).length === 0) {
          writeJson(res, 400, { ok: false, message: 'Missing task input.' })
          return
        }
        const title = asString(input.title)
        const prompt = asString(input.prompt)
        const schedule = nestedRecord(input.schedule)
        const kind = asString(schedule.kind) as ScheduledTaskV1['schedule']['kind']
        if (!prompt || !kind) {
          writeJson(res, 400, { ok: false, message: 'Missing prompt or schedule.kind.' })
          return
        }
        const saved = await this.createTaskFromInput({
          title,
          prompt,
          workspaceRoot: asString(input.workspaceRoot) || undefined,
          model: asString(input.model) || undefined,
          reasoningEffort: (asString(input.reasoningEffort) as ScheduleReasoningEffort) || undefined,
          mode: (asString(input.mode) as ScheduleRunMode) || undefined,
          enabled: input.enabled === false ? false : true,
          schedule: {
            kind,
            everyMinutes: Number(schedule.everyMinutes),
            timeOfDay: asString(schedule.timeOfDay),
            atTime: asString(schedule.atTime)
          }
        })
        writeJson(res, 200, { ok: true, task: saved })
        return
      }

      if (url.pathname === '/schedule/internal/update') {
        const taskId = asString(payload.taskId)
        const patch = nestedRecord(payload.patch)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const updated = await this.updateTaskById(taskId, patch as Partial<ScheduledTaskV1>)
        if (!updated) {
          writeJson(res, 404, { ok: false, message: 'Task not found.' })
          return
        }
        writeJson(res, 200, { ok: true, task: updated })
        return
      }

      if (url.pathname === '/schedule/internal/delete') {
        const taskId = asString(payload.taskId)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const removed = await this.deleteTaskById(taskId)
        writeJson(res, removed ? 200 : 404, removed ? { ok: true } : { ok: false, message: 'Task not found.' })
        return
      }

      if (url.pathname === '/schedule/internal/run') {
        const taskId = asString(payload.taskId)
        if (!taskId) {
          writeJson(res, 400, { ok: false, message: 'Missing taskId.' })
          return
        }
        const result = await this.runTask(taskId)
        writeJson(res, result.ok ? 200 : 400, { ok: result.ok, result })
        return
      }

      if (url.pathname === '/schedule/internal/detect-from-text') {
        const text = asString(payload.text)
        if (!text) {
          writeJson(res, 400, { ok: false, message: 'Missing text.' })
          return
        }
        const result = await this.createScheduledTaskFromText(text, {
          workspaceRoot: asString(payload.workspaceRoot) || undefined,
          modelHint: asString(payload.modelHint) || undefined,
          mode: (asString(payload.mode) as ScheduleRunMode) || undefined
        })
        writeJson(res, result.kind === 'error' ? 400 : 200, {
          ok: result.kind !== 'error',
          result
        })
        return
      }

      writeJson(res, 404, { ok: false, message: 'Not found.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logError('schedule-server', 'Schedule internal request failed', { message })
      writeJson(res, 500, { ok: false, message })
    }
  }

  private syncPowerSaveBlocker(settings: AppSettingsV1): void {
    const blocker = this.deps.powerSaveBlocker
    const shouldBlock = settings.schedule.keepAwake && this.runningTasks.size > 0
    if (!blocker || !shouldBlock) {
      this.stopPowerSaveBlocker()
      return
    }
    try {
      if (this.powerSaveBlockerId != null && blocker.isStarted(this.powerSaveBlockerId)) return
      this.stopPowerSaveBlocker()
      this.powerSaveBlockerId = blocker.start('prevent-app-suspension')
    } catch (error) {
      this.deps.logError('schedule-power-save', 'Failed to start power save blocker', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private isPowerSaveBlockerActive(): boolean {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    if (!blocker || id == null) return false
    try {
      return blocker.isStarted(id)
    } catch {
      return false
    }
  }

  private stopPowerSaveBlocker(): void {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    this.powerSaveBlockerId = null
    if (!blocker || id == null) return
    try {
      if (blocker.isStarted(id)) blocker.stop(id)
    } catch (error) {
      this.deps.logError('schedule-power-save', 'Failed to stop power save blocker', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export function createScheduleRuntime(
  deps: ScheduleRuntimeDeps
): ScheduleRuntime {
  return new ScheduleRuntime(deps)
}
