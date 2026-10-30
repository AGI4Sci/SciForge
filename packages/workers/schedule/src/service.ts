import { createHash } from 'node:crypto'

import {
  SCHEDULE_INTERNAL_ENDPOINTS,
  SCHEDULE_TOOL_SIDE_EFFECTS,
  ScheduleWorkerError,
  scheduleCreateToolInputSchema,
  scheduleDeleteToolInputSchema,
  scheduleDetectFromTextToolInputSchema,
  scheduleErrorPayloadFromUnknown,
  scheduleListToolInputSchema,
  scheduleRunResultSchema,
  scheduleRunToolInputSchema,
  scheduleRuntimeStatusSchema,
  scheduleStatusToolInputSchema,
  scheduleTaskFromTextResultSchema,
  scheduleUpdateToolInputSchema,
  scheduledTaskSchema,
  type ScheduleCreateToolInput,
  type ScheduleDeleteToolInput,
  type ScheduleDetectFromTextToolInput,
  type ScheduleErrorCode,
  type ScheduleErrorPayload,
  type ScheduleListToolInput,
  type ScheduleRunResult,
  type ScheduleRunToolInput,
  type ScheduleRuntimeStatus,
  type ScheduleStatusToolInput,
  type ScheduleTaskFromTextResult,
  type ScheduleToolEffect,
  type ScheduleUpdateToolInput,
  type ScheduledTask
} from './contract.js'
import {
  mcpWriteControlFromInput,
  mcpWriteConfirmationRequired,
  mcpWriteIsPreview,
  mcpWriteRedactedInput
} from './write-action.js'

export type ScheduleFetchResponse = {
  ok: boolean
  status: number
  statusText?: string
  text(): Promise<string>
}

export type ScheduleFetch = (
  input: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  }
) => Promise<ScheduleFetchResponse>

export type ScheduleInternalHttpClient = {
  postJson(
    path: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<Record<string, unknown>>
}

export type ScheduleInternalHttpClientOptions = {
  baseUrl?: string
  secret?: string
  timeoutMs?: number
  fetch?: ScheduleFetch
}

export type ScheduleServiceOptions = ScheduleInternalHttpClientOptions & {
  internalClient?: ScheduleInternalHttpClient
  auditSink?: ScheduleAuditSink
}

export type ScheduleListResult = {
  tasks: ScheduledTask[]
  count: number
}

export type ScheduleAuditAction =
  | 'list'
  | 'create'
  | 'update'
  | 'delete'
  | 'status'
  | 'run'
  | 'detect_from_text'

export type ScheduleAuditOutcome =
  | 'success'
  | 'failure'
  | 'dry_run'
  | 'confirmation_required'

export type ScheduleAuditError = {
  code: ScheduleErrorCode
  retryable: boolean
  status?: number
  reasonLength: number
  suggestionLength: number
}

export type ScheduleAuditEvent = {
  id: string
  timestamp: string
  action: ScheduleAuditAction
  effect: ScheduleToolEffect
  outcome: ScheduleAuditOutcome
  dryRun: boolean
  confirmationProvided: boolean
  confirmationRequired?: boolean
  taskId?: string
  request: Record<string, unknown>
  result?: Record<string, unknown>
  error?: ScheduleAuditError
}

export type ScheduleAuditSink = (event: ScheduleAuditEvent) => void | Promise<void>

export type ScheduleOperationPreview = {
  action: ScheduleAuditAction
  effect: ScheduleToolEffect
  summary: string
  endpoint: string
  taskId?: string
  input: Record<string, unknown>
}

export type ScheduleDryRunResult = {
  ok: true
  dryRun: true
  action: ScheduleAuditAction
  effect: ScheduleToolEffect
  preview: ScheduleOperationPreview
  confirmation?: {
    required: true
    field: 'confirmation'
    value: string
  }
}

export type ScheduleCreateResult = ScheduledTask | ScheduleDryRunResult
export type ScheduleUpdateResult = ScheduledTask | ScheduleDryRunResult

export type ScheduleDeleteResult = {
  taskId: string
  deleted: true
}

export type ScheduleDeleteToolResult = ScheduleDeleteResult | ScheduleDryRunResult
export type ScheduleRunToolResult = ScheduleRunResult | ScheduleDryRunResult
export type ScheduleDetectFromTextResult = ScheduleTaskFromTextResult | ScheduleDryRunResult

export class ScheduleHttpClient implements ScheduleInternalHttpClient {
  private readonly baseUrl: string
  private readonly secret: string
  private readonly timeoutMs: number
  private readonly fetchImpl: ScheduleFetch

  constructor(options: ScheduleInternalHttpClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? scheduleBaseUrlFromEnv())
    this.secret = (options.secret ?? scheduleSecretFromEnv()).trim()
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? scheduleTimeoutMsFromEnv())
    this.fetchImpl = options.fetch ?? defaultFetch()
  }

  async postJson(
    path: string,
    body: Record<string, unknown>,
    options: { signal?: AbortSignal } = {}
  ): Promise<Record<string, unknown>> {
    const endpointPath = normalizeInternalEndpointPath(path)
    const url = new URL(endpointPath, this.baseUrl).toString()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
    if (!this.secret) {
      throw new ScheduleWorkerError({
        code: 'unauthorized',
        reason: 'Schedule internal secret is not configured.',
        retryable: false,
        suggestion: 'Restart SciForge so the managed schedule MCP worker receives GUI_SCHEDULE_INTERNAL_SECRET.'
      })
    }
    headers.Authorization = `Bearer ${this.secret}`

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal.signal
      })
      const text = await response.text()
      const parsed = parseJsonRecord(text)
      if (!response.ok) {
        throw scheduleHttpError(response.status, parsed, text)
      }
      return parsed
    } catch (error) {
      if (error instanceof ScheduleWorkerError) throw error
      if (requestSignal.timedOut()) {
        throw new ScheduleWorkerError({
          code: 'timeout',
          reason: `Schedule internal request timed out after ${this.timeoutMs}ms.`,
          retryable: true,
          suggestion: 'Ensure the SciForge app is running and try again.'
        })
      }
      if (options.signal?.aborted) {
        throw new ScheduleWorkerError({
          code: 'aborted',
          reason: 'Schedule internal request was aborted.',
          retryable: false,
          suggestion: 'Retry only if the original operation should still be performed.'
        })
      }
      throw new ScheduleWorkerError({
        code: 'internal_http_unavailable',
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
        suggestion: 'Ensure the SciForge app schedule internal server is running and reachable.'
      })
    } finally {
      requestSignal.dispose()
    }
  }
}

export class ScheduleService {
  private readonly internalClient: ScheduleInternalHttpClient
  private readonly auditSink?: ScheduleAuditSink
  private readonly auditEvents: ScheduleAuditEvent[] = []
  private auditSequence = 0

  constructor(options: ScheduleServiceOptions = {}) {
    this.internalClient = options.internalClient ?? new ScheduleHttpClient(options)
    this.auditSink = options.auditSink
  }

  getAuditEvents(): ScheduleAuditEvent[] {
    return this.auditEvents.map(cloneAuditEvent)
  }

  async list(
    input: ScheduleListToolInput = {},
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleListResult> {
    scheduleListToolInputSchema.parse(input)
    const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.list, {}, options)
    const rawTasks = Array.isArray(response.tasks) ? response.tasks : null
    if (!rawTasks) {
      throw invalidResponse('Expected schedule list response to include tasks array.')
    }
    const tasks = rawTasks.map((task, index) => parseScheduledTask(task, `tasks[${index}]`))
    return { tasks, count: tasks.length }
  }

  async getTask(taskId: string, options?: { signal?: AbortSignal }): Promise<ScheduledTask> {
    const id = scheduleDeleteToolInputSchema.parse({ task_id: taskId }).task_id
    const result = await this.list({}, options)
    const task = result.tasks.find((candidate) => candidate.id === id)
    if (!task) {
      throw new ScheduleWorkerError({
        code: 'not_found',
        reason: `Scheduled task ${id} was not found.`,
        retryable: false,
        suggestion: 'Call gui_schedule_list or read schedule://tasks to find a valid task id.'
      })
    }
    return task
  }

  async create(
    input: ScheduleCreateToolInput,
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleCreateResult> {
    return this.audited('create', SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_create.effect, input, async () => {
      const parsed = scheduleCreateToolInputSchema.parse(input)
      const requiresConfirmation = createRequiresConfirmation(parsed)
      const confirmation = requiresConfirmation
        ? confirmationValueFor('create', fingerprintCreateInput(parsed))
        : undefined
      if (inputRequestsPreview(parsed)) {
        return createDryRunResult({
          action: 'create',
          effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_create.effect,
          endpoint: SCHEDULE_INTERNAL_ENDPOINTS.create,
          summary: `Would create scheduled task "${parsed.title}".`,
          input: {
            title: parsed.title,
            promptLength: parsed.prompt.length,
            workspaceRoot: parsed.workspace_root,
            model: parsed.model,
            reasoningEffort: parsed.reasoning_effort,
            mode: parsed.mode,
            enabled: parsed.enabled,
            schedule: {
              kind: parsed.schedule_kind,
              atTime: parsed.at_time,
              timeOfDay: parsed.time_of_day,
              everyMinutes: parsed.every_minutes
            }
          },
          confirmation
        })
      }
      if (confirmation) {
        requireConfirmation({
          action: 'create',
          tool: 'gui_schedule_create',
          destructive: false,
          confirmationId: confirmation,
          input: parsed
        })
      }
      const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.create, {
        input: {
          title: parsed.title,
          prompt: parsed.prompt,
          workspaceRoot: parsed.workspace_root,
          model: parsed.model,
          reasoningEffort: parsed.reasoning_effort,
          mode: parsed.mode,
          enabled: parsed.enabled,
          schedule: {
            kind: parsed.schedule_kind,
            atTime: parsed.at_time,
            timeOfDay: parsed.time_of_day,
            everyMinutes: parsed.every_minutes
          }
        }
      }, options)
      return parseScheduledTask(response.task, 'task')
    })
  }

  async update(
    input: ScheduleUpdateToolInput,
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleUpdateResult> {
    return this.audited('update', SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_update.effect, input, async () => {
      const parsed = scheduleUpdateToolInputSchema.parse(input)
      const patch = buildUpdatePatch(parsed)
      const requiresConfirmation = updateRequiresConfirmation(patch)
      const confirmation = requiresConfirmation
        ? confirmationValueFor('update', `${parsed.task_id}:${fingerprintRecord(patch)}`)
        : undefined
      if (inputRequestsPreview(parsed)) {
        return createDryRunResult({
          action: 'update',
          effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_update.effect,
          endpoint: SCHEDULE_INTERNAL_ENDPOINTS.update,
          taskId: parsed.task_id,
          summary: `Would update scheduled task ${parsed.task_id}.`,
          input: {
            taskId: parsed.task_id,
            patch: sanitizePatchForPreview(patch)
          },
          confirmation
        })
      }
      if (confirmation) {
        requireConfirmation({
          action: 'update',
          tool: 'gui_schedule_update',
          destructive: false,
          confirmationId: confirmation,
          input: parsed
        })
      }
      const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.update, {
        taskId: parsed.task_id,
        patch
      }, options)
      return parseScheduledTask(response.task, 'task')
    })
  }

  async delete(
    input: ScheduleDeleteToolInput,
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleDeleteToolResult> {
    return this.audited('delete', SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_delete.effect, input, async () => {
      const parsed = scheduleDeleteToolInputSchema.parse(input)
      const confirmation = confirmationValueFor('delete', parsed.task_id)
      if (inputRequestsPreview(parsed)) {
        return createDryRunResult({
          action: 'delete',
          effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_delete.effect,
          endpoint: SCHEDULE_INTERNAL_ENDPOINTS.delete,
          taskId: parsed.task_id,
          summary: `Would delete scheduled task ${parsed.task_id}.`,
          input: { taskId: parsed.task_id },
          confirmation
        })
      }
      requireConfirmation({
        action: 'delete',
        tool: 'gui_schedule_delete',
        destructive: true,
        confirmationId: confirmation,
        input: parsed
      })
      const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.delete, {
        taskId: parsed.task_id
      }, options)
      if (response.ok === false) {
        throw new ScheduleWorkerError({
          code: 'not_found',
          reason: stringFromRecord(response, ['message', 'reason', 'error']) ?? `Scheduled task ${parsed.task_id} was not found.`,
          retryable: false,
          suggestion: 'Call gui_schedule_list or read schedule://tasks to find a valid task id.'
        })
      }
      return { taskId: parsed.task_id, deleted: true }
    })
  }

  async status(
    input: ScheduleStatusToolInput = {},
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleRuntimeStatus> {
    scheduleStatusToolInputSchema.parse(input)
    const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.status, {}, options)
    const candidate = isRecord(response.status) ? response.status : response
    const parsed = scheduleRuntimeStatusSchema.safeParse(candidate)
    if (!parsed.success) {
      throw invalidResponse('Expected schedule status response to include runtime status fields.')
    }
    return parsed.data
  }

  async run(
    input: ScheduleRunToolInput,
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleRunToolResult> {
    return this.audited('run', SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_run.effect, input, async () => {
      const parsed = scheduleRunToolInputSchema.parse(input)
      const confirmation = confirmationValueFor('run', parsed.task_id)
      if (inputRequestsPreview(parsed)) {
        return createDryRunResult({
          action: 'run',
          effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_run.effect,
          endpoint: SCHEDULE_INTERNAL_ENDPOINTS.run,
          taskId: parsed.task_id,
          summary: `Would run scheduled task ${parsed.task_id} immediately.`,
          input: { taskId: parsed.task_id },
          confirmation
        })
      }
      requireConfirmation({
        action: 'run',
        tool: 'gui_schedule_run',
        destructive: true,
        confirmationId: confirmation,
        input: parsed
      })
      const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.run, {
        taskId: parsed.task_id
      }, options)
      const candidate = isRecord(response.result) ? response.result : response
      const result = scheduleRunResultSchema.safeParse(candidate)
      if (!result.success) {
        throw invalidResponse('Expected schedule run response to match ScheduleRunResult.')
      }
      return result.data
    })
  }

  async detectFromText(
    input: ScheduleDetectFromTextToolInput,
    options?: { signal?: AbortSignal }
  ): Promise<ScheduleDetectFromTextResult> {
    return this.audited('detect_from_text', SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_detect_from_text.effect, input, async () => {
      const parsed = scheduleDetectFromTextToolInputSchema.parse(input)
      if (inputRequestsPreview(parsed)) {
        return createDryRunResult({
          action: 'detect_from_text',
          effect: SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_detect_from_text.effect,
          endpoint: SCHEDULE_INTERNAL_ENDPOINTS.detectFromText,
          summary: 'Would ask the schedule detector to interpret text and create a task only if it confirms an intent.',
          input: {
            textLength: parsed.text.length,
            workspaceRoot: parsed.workspace_root,
            modelHint: parsed.model_hint,
            mode: parsed.mode
          }
        })
      }
      const response = await this.internalClient.postJson(SCHEDULE_INTERNAL_ENDPOINTS.detectFromText, {
        text: parsed.text,
        workspaceRoot: parsed.workspace_root,
        modelHint: parsed.model_hint,
        mode: parsed.mode
      }, options)
      const candidate = isRecord(response.result) ? response.result : response
      const result = scheduleTaskFromTextResultSchema.safeParse(candidate)
      if (!result.success) {
        throw invalidResponse('Expected schedule detect_from_text response to match ScheduleTaskFromTextResult.')
      }
      return result.data
    })
  }

  private async audited<T>(
    action: ScheduleAuditAction,
    effect: ScheduleToolEffect,
    input: unknown,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      const result = await operation()
      const dryRun = inputRequestsDryRun(input) || isScheduleDryRunResult(result)
      await this.recordAudit({
        action,
        effect,
        outcome: isScheduleDryRunResult(result) ? 'dry_run' : 'success',
        dryRun,
        confirmationProvided: inputHasConfirmation(input),
        confirmationRequired: isScheduleDryRunResult(result) && result.confirmation?.required ? true : undefined,
        taskId: taskIdFromInput(input) ?? taskIdFromResult(result),
        request: sanitizeInputForAudit(input),
        result: summarizeResultForAudit(result)
      })
      return result
    } catch (error) {
      const payload = scheduleErrorPayloadFromUnknown(error)
      await this.recordAudit({
        action,
        effect,
        outcome: payload.code === 'confirmation_required' ? 'confirmation_required' : 'failure',
        dryRun: inputRequestsDryRun(input),
        confirmationProvided: inputHasConfirmation(input),
        confirmationRequired: payload.code === 'confirmation_required' ? true : undefined,
        taskId: taskIdFromInput(input),
        request: sanitizeInputForAudit(input),
        error: auditErrorFromPayload(payload)
      })
      throw error
    }
  }

  private async recordAudit(event: Omit<ScheduleAuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const auditEvent: ScheduleAuditEvent = {
      id: `schedule-audit-${++this.auditSequence}`,
      timestamp: new Date().toISOString(),
      ...event
    }
    this.auditEvents.push(auditEvent)
    if (!this.auditSink) return
    try {
      await this.auditSink(cloneAuditEvent(auditEvent))
    } catch {
      // Audit sinks are observational; schedule operation results should remain authoritative.
    }
  }
}

export function createScheduleService(options: ScheduleServiceOptions = {}): ScheduleService {
  return new ScheduleService(options)
}

export function createScheduleInternalHttpClient(
  options: ScheduleInternalHttpClientOptions = {}
): ScheduleInternalHttpClient {
  return new ScheduleHttpClient(options)
}

export function isScheduleDryRunResult(value: unknown): value is ScheduleDryRunResult {
  return isRecord(value) && value.ok === true && value.dryRun === true && isRecord(value.preview)
}

export function confirmationValueFor(action: 'create' | 'update' | 'delete' | 'run', target: string): string {
  return `${action}:${target}`
}

function buildUpdatePatch(parsed: ScheduleUpdateToolInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (parsed.title !== undefined) patch.title = parsed.title
  if (parsed.prompt !== undefined) patch.prompt = parsed.prompt
  if (parsed.enabled !== undefined) patch.enabled = parsed.enabled
  if (parsed.workspace_root !== undefined) patch.workspaceRoot = parsed.workspace_root
  if (parsed.model !== undefined) patch.model = parsed.model
  if (parsed.reasoning_effort !== undefined) patch.reasoningEffort = parsed.reasoning_effort
  if (parsed.mode !== undefined) patch.mode = parsed.mode
  if (
    parsed.schedule_kind !== undefined ||
    parsed.at_time !== undefined ||
    parsed.time_of_day !== undefined ||
    parsed.every_minutes !== undefined
  ) {
    patch.schedule = {
      ...(parsed.schedule_kind !== undefined ? { kind: parsed.schedule_kind } : {}),
      ...(parsed.at_time !== undefined ? { atTime: parsed.at_time } : {}),
      ...(parsed.time_of_day !== undefined ? { timeOfDay: parsed.time_of_day } : {}),
      ...(parsed.every_minutes !== undefined ? { everyMinutes: parsed.every_minutes } : {})
    }
  }
  return patch
}

function createRequiresConfirmation(parsed: ScheduleCreateToolInput): boolean {
  return parsed.enabled !== false
}

function updateRequiresConfirmation(patch: Record<string, unknown>): boolean {
  if (patch.prompt !== undefined) return true
  if (patch.workspaceRoot !== undefined) return true
  if (patch.model !== undefined) return true
  if (patch.reasoningEffort !== undefined) return true
  if (patch.mode !== undefined) return true
  if (patch.schedule !== undefined) return true
  return patch.enabled === true
}

function fingerprintCreateInput(parsed: ScheduleCreateToolInput): string {
  return fingerprintRecord({
    title: parsed.title,
    prompt: parsed.prompt,
    workspaceRoot: parsed.workspace_root ?? '',
    model: parsed.model ?? '',
    reasoningEffort: parsed.reasoning_effort ?? '',
    mode: parsed.mode ?? '',
    enabled: parsed.enabled !== false,
    schedule: {
      kind: parsed.schedule_kind,
      atTime: parsed.at_time ?? '',
      timeOfDay: parsed.time_of_day ?? '',
      everyMinutes: parsed.every_minutes ?? null
    }
  })
}

function fingerprintRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(stableJson(record))
    .digest('hex')
    .slice(0, 16)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function createDryRunResult(options: {
  action: ScheduleAuditAction
  effect: ScheduleToolEffect
  endpoint: string
  summary: string
  taskId?: string
  input: Record<string, unknown>
  confirmation?: string
}): ScheduleDryRunResult {
  return {
    ok: true,
    dryRun: true,
    action: options.action,
    effect: options.effect,
    preview: {
      action: options.action,
      effect: options.effect,
      summary: options.summary,
      endpoint: options.endpoint,
      ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
      input: sanitizeRecordForPreview(options.input)
    },
    ...(options.confirmation !== undefined
      ? { confirmation: { required: true, field: 'confirmation' as const, value: options.confirmation } }
      : {})
  }
}

function requireConfirmation(options: {
  action: 'create' | 'update' | 'delete' | 'run'
  tool: 'gui_schedule_create' | 'gui_schedule_update' | 'gui_schedule_delete' | 'gui_schedule_run'
  destructive: boolean
  confirmationId: string
  input: ScheduleCreateToolInput | ScheduleUpdateToolInput | ScheduleDeleteToolInput | ScheduleRunToolInput
}): void {
  const expected = options.confirmationId
  const control = mcpWriteControlFromInput(options.input)
  const confirmedWithExpectedId = control.confirmed && control.confirmationId === expected
  if (inputConfirmationValue(options.input) === expected || confirmedWithExpectedId) return
  const confirmationRequired = mcpWriteConfirmationRequired({
    worker: 'schedule',
    tool: options.tool,
    action: options.action,
    destructive: options.destructive,
    confirmationId: expected
  })
  throw new ScheduleWorkerError({
    code: 'confirmation_required',
    reason: confirmationRequired.message,
    retryable: false,
    suggestion: `Call again with confirmed: true and confirmation_id: "${expected}", or use dry_run/preview to inspect without side effects.`,
    confirmationRequired
  })
}

function inputConfirmationValue(input: unknown): string | undefined {
  return isRecord(input) && typeof input.confirmation === 'string' && input.confirmation.trim()
    ? input.confirmation.trim()
    : undefined
}

function sanitizePatchForPreview(patch: Record<string, unknown>): Record<string, unknown> {
  const preview: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (key === 'prompt' && typeof value === 'string') {
      preview.promptLength = value.length
      continue
    }
    preview[key] = sanitizeValueForPreview(value, key)
  }
  return preview
}

function sanitizeRecordForPreview(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    sanitized[key] = sanitizeValueForPreview(value, key)
  }
  return sanitized
}

function sanitizeValueForPreview(value: unknown, key: string): unknown {
  if (/secret|token|authorization|password|api[_-]?key/i.test(key)) {
    return { redacted: true }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValueForPreview(item, key))
  }
  if (isRecord(value)) {
    return sanitizeRecordForPreview(value)
  }
  if (typeof value === 'string' && value.length > 512) {
    return { length: value.length, truncated: true }
  }
  return mcpWriteRedactedInput(value)
}

function sanitizeInputForAudit(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === 'prompt' && typeof value === 'string') {
      sanitized.promptLength = value.length
      continue
    }
    if (key === 'text' && typeof value === 'string') {
      sanitized.textLength = value.length
      continue
    }
    if (key === 'confirmation') {
      sanitized.confirmationProvided = typeof value === 'string' && value.trim().length > 0
      continue
    }
    if (key === 'confirmation_id') {
      sanitized.confirmationProvided = typeof value === 'string' && value.trim().length > 0
      continue
    }
    sanitized[key] = sanitizeAuditValue(value, key)
  }
  return sanitized
}

function sanitizeAuditValue(value: unknown, key: string): unknown {
  if (/secret|token|authorization|password|api[_-]?key/i.test(key)) {
    return { redacted: true }
  }
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.slice(0, 20).map((item) => sanitizeAuditValue(item, key))
    }
  }
  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeAuditValue(childValue, childKey)
    }
    return sanitized
  }
  if (typeof value === 'string' && value.length > 256) {
    return { length: value.length, truncated: true }
  }
  return mcpWriteRedactedInput(value)
}

function summarizeResultForAudit(result: unknown): Record<string, unknown> {
  if (isScheduleDryRunResult(result)) {
    return {
      dryRun: true,
      action: result.action,
      effect: result.effect,
      endpoint: result.preview.endpoint,
      taskId: result.preview.taskId,
      confirmationRequired: result.confirmation?.required === true
    }
  }
  if (isRecord(result) && Array.isArray(result.tasks)) {
    return {
      count: typeof result.count === 'number' ? result.count : result.tasks.length,
      taskIds: result.tasks
        .map((task) => isRecord(task) && typeof task.id === 'string' ? task.id : undefined)
        .filter((id): id is string => Boolean(id))
        .slice(0, 50)
    }
  }
  if (isScheduledTaskRecord(result)) {
    return summarizeTaskForAudit(result)
  }
  if (isRecord(result) && result.deleted === true) {
    return {
      deleted: true,
      taskId: typeof result.taskId === 'string' ? result.taskId : undefined
    }
  }
  if (isRuntimeStatusRecord(result)) {
    return {
      internalServerRunning: result.internalServerRunning,
      runningTaskCount: result.runningTaskIds.length,
      powerSaveBlockerActive: result.powerSaveBlockerActive
    }
  }
  if (isRecord(result) && result.ok === true && typeof result.threadId === 'string') {
    return {
      ok: true,
      threadId: result.threadId,
      turnId: typeof result.turnId === 'string' ? result.turnId : undefined,
      messageLength: typeof result.message === 'string' ? result.message.length : undefined,
      textLength: typeof result.text === 'string' ? result.text.length : undefined,
      fileCount: Array.isArray(result.files) ? result.files.length : undefined
    }
  }
  if (isRecord(result) && result.ok === false) {
    return {
      ok: false,
      messageLength: typeof result.message === 'string' ? result.message.length : undefined
    }
  }
  if (isRecord(result) && typeof result.kind === 'string') {
    return {
      kind: result.kind,
      taskId: typeof result.taskId === 'string' ? result.taskId : undefined,
      title: typeof result.title === 'string' ? result.title : undefined,
      scheduleAt: typeof result.scheduleAt === 'string' ? result.scheduleAt : undefined,
      messageLength: typeof result.message === 'string' ? result.message.length : undefined,
      confirmationTextLength: typeof result.confirmationText === 'string' ? result.confirmationText.length : undefined
    }
  }
  return { type: typeof result }
}

function summarizeTaskForAudit(task: ScheduledTask): Record<string, unknown> {
  return {
    taskId: task.id,
    title: task.title,
    enabled: task.enabled,
    workspaceRoot: task.workspaceRoot,
    model: task.model,
    reasoningEffort: task.reasoningEffort,
    mode: task.mode,
    schedule: task.schedule,
    promptLength: task.prompt.length,
    lastStatus: task.lastStatus
  }
}

function auditErrorFromPayload(payload: ScheduleErrorPayload): ScheduleAuditError {
  return {
    code: payload.code,
    retryable: payload.retryable,
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    reasonLength: payload.reason.length,
    suggestionLength: payload.suggestion.length
  }
}

function inputRequestsPreview(input: unknown): boolean {
  return mcpWriteIsPreview(mcpWriteControlFromInput(input))
}

function inputRequestsDryRun(input: unknown): boolean {
  return inputRequestsPreview(input)
}

function inputHasConfirmation(input: unknown): boolean {
  const control = mcpWriteControlFromInput(input)
  return control.confirmed || Boolean(control.confirmationId)
}

function taskIdFromInput(input: unknown): string | undefined {
  return isRecord(input) && typeof input.task_id === 'string' && input.task_id.trim()
    ? input.task_id.trim()
    : undefined
}

function taskIdFromResult(result: unknown): string | undefined {
  if (isScheduleDryRunResult(result)) return result.preview.taskId
  if (!isRecord(result)) return undefined
  if (typeof result.taskId === 'string') return result.taskId
  if (typeof result.id === 'string') return result.id
  return undefined
}

function cloneAuditEvent(event: ScheduleAuditEvent): ScheduleAuditEvent {
  return JSON.parse(JSON.stringify(event)) as ScheduleAuditEvent
}

function parseScheduledTask(value: unknown, label: string): ScheduledTask {
  const parsed = scheduledTaskSchema.safeParse(value)
  if (!parsed.success) {
    throw invalidResponse(`Expected ${label} to match ScheduledTask.`)
  }
  return parsed.data
}

function invalidResponse(reason: string): ScheduleWorkerError {
  return new ScheduleWorkerError({
    code: 'internal_response_invalid',
    reason,
    retryable: true,
    suggestion: 'Update the SciForge main process schedule internal endpoint to match the worker contract.'
  })
}

function parseJsonRecord(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { message: trimmed }
  }
}

function scheduleHttpError(
  status: number,
  parsed: Record<string, unknown>,
  fallbackText: string
): ScheduleWorkerError {
  const parsedReason = stringFromRecord(parsed, ['reason', 'message', 'error'])
  const reason = parsedReason ?? (fallbackText.trim() || `HTTP ${status}`)
  return new ScheduleWorkerError({
    code: errorCodeForHttpStatus(status),
    reason,
    retryable: status === 408 || status === 429 || status >= 500,
    suggestion: suggestionForHttpStatus(status),
    status
  })
}

function errorCodeForHttpStatus(status: number): ScheduleErrorCode {
  if (status === 400 || status === 422) return 'invalid_input'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 408) return 'timeout'
  return 'internal_http_error'
}

function suggestionForHttpStatus(status: number): string {
  if (status === 400 || status === 422) return 'Check the tool arguments and retry with valid schedule fields.'
  if (status === 401 || status === 403) return 'Check the schedule internal secret passed to the worker.'
  if (status === 404) return 'Check the task id or endpoint path against the running SciForge app.'
  if (status === 408 || status === 429 || status >= 500) return 'Retry after the SciForge app schedule runtime is healthy.'
  return 'Check the SciForge app schedule internal server response.'
}

function defaultFetch(): ScheduleFetch {
  const fetchImpl = globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new ScheduleWorkerError({
      code: 'internal_http_unavailable',
      reason: 'globalThis.fetch is not available in this Node runtime.',
      retryable: false,
      suggestion: 'Run the schedule worker on Node 18 or newer, or inject a fetch implementation.'
    })
  }
  return fetchImpl as unknown as ScheduleFetch
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim() || 'http://127.0.0.1:8788'
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new ScheduleWorkerError({
      code: 'internal_http_unavailable',
      reason: 'Schedule internal base URL is invalid.',
      retryable: false,
      suggestion: 'Use a loopback HTTP URL such as http://127.0.0.1:8788.'
    })
  }
  if (parsed.protocol !== 'http:' || !isLoopbackHostname(parsed.hostname)) {
    throw new ScheduleWorkerError({
      code: 'internal_http_unavailable',
      reason: 'Schedule internal base URL must use loopback HTTP.',
      retryable: false,
      suggestion: 'Use the managed SciForge schedule URL, for example http://127.0.0.1:8788.'
    })
  }
  return parsed.toString().endsWith('/') ? parsed.toString() : `${parsed.toString()}/`
}

function normalizeInternalEndpointPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new ScheduleWorkerError({
      code: 'internal_http_unavailable',
      reason: 'Schedule internal endpoint path must be a relative internal route.',
      retryable: false,
      suggestion: 'Use one of the schedule internal endpoint constants.'
    })
  }
  const allowed = new Set<string>(Object.values(SCHEDULE_INTERNAL_ENDPOINTS))
  if (!allowed.has(trimmed)) {
    throw new ScheduleWorkerError({
      code: 'internal_http_unavailable',
      reason: `Schedule internal endpoint is not allowed: ${trimmed}`,
      retryable: false,
      suggestion: 'Use one of the schedule internal endpoint constants.'
    })
  }
  return trimmed
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (normalized === 'localhost' || normalized === '[::1]' || normalized === '::1') return true
  const parts = normalized.split('.')
  if (parts.length !== 4 || parts[0] !== '127') return false
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return Number.isInteger(value) && value >= 0 && value <= 255
  })
}

function scheduleBaseUrlFromEnv(): string {
  return (
    process.env.SCIFORGE_SCHEDULE_INTERNAL_BASE_URL?.trim() ||
    process.env.GUI_SCHEDULE_INTERNAL_BASE_URL?.trim() ||
    'http://127.0.0.1:8788'
  )
}

function scheduleSecretFromEnv(): string {
  return (
    process.env.SCIFORGE_SCHEDULE_INTERNAL_SECRET?.trim() ||
    process.env.GUI_SCHEDULE_INTERNAL_SECRET?.trim() ||
    ''
  )
}

function scheduleTimeoutMsFromEnv(): number {
  const raw = process.env.SCIFORGE_SCHEDULE_INTERNAL_TIMEOUT_MS?.trim()
  return raw ? Number(raw) : 15_000
}

function normalizeTimeoutMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 120_000) : 15_000
}

function createRequestSignal(
  outerSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose(): void; timedOut(): boolean } {
  const controller = new AbortController()
  let didTimeOut = false
  const timeout = setTimeout(() => {
    didTimeOut = true
    controller.abort()
  }, timeoutMs)
  timeout.unref?.()

  const abortFromOuter = (): void => controller.abort()
  if (outerSignal?.aborted) abortFromOuter()
  else outerSignal?.addEventListener('abort', abortFromOuter, { once: true })

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timeout)
      outerSignal?.removeEventListener('abort', abortFromOuter)
    }
  }
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function isScheduledTaskRecord(value: unknown): value is ScheduledTask {
  return isRecord(value) && typeof value.id === 'string' && typeof value.prompt === 'string' && isRecord(value.schedule)
}

function isRuntimeStatusRecord(value: unknown): value is ScheduleRuntimeStatus {
  return (
    isRecord(value) &&
    typeof value.internalServerRunning === 'boolean' &&
    Array.isArray(value.runningTaskIds) &&
    typeof value.powerSaveBlockerActive === 'boolean'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export { scheduleErrorPayloadFromUnknown }
export type { ScheduleErrorPayload }
