import { z } from 'zod'
import type { McpWriteConfirmationRequired } from './write-action.js'

export const SCHEDULE_MCP_SERVER_NAME = 'sciforge-schedule'
export const SCHEDULE_MCP_SERVER_VERSION = '0.1.0'

export const SCHEDULE_TASKS_RESOURCE_URI = 'schedule://tasks'
export const SCHEDULE_STATUS_RESOURCE_URI = 'schedule://status'
export const SCHEDULE_TASK_RESOURCE_URI_TEMPLATE = 'schedule://task/{id}'

export const SCHEDULE_INTERNAL_ENDPOINTS = {
  list: '/schedule/internal/list',
  create: '/schedule/internal/create',
  update: '/schedule/internal/update',
  delete: '/schedule/internal/delete',
  status: '/schedule/internal/status',
  run: '/schedule/internal/run',
  detectFromText: '/schedule/internal/detect-from-text'
} as const

export const SCHEDULE_KIND_IDS = ['manual', 'interval', 'daily', 'at'] as const
export const SCHEDULE_CREATE_KIND_IDS = ['at', 'daily', 'interval'] as const
export const SCHEDULE_RUN_MODE_IDS = ['agent', 'plan'] as const
export const SCHEDULE_REASONING_EFFORT_IDS = ['off', 'low', 'medium', 'high', 'max'] as const
export const SCHEDULE_TASK_STATUS_IDS = ['idle', 'running', 'success', 'error'] as const
export const SCHEDULE_TOOL_EFFECT_IDS = ['read-only', 'write', 'destructive'] as const

export const scheduleKindSchema = z.enum(SCHEDULE_KIND_IDS)
export const scheduleCreateKindSchema = z.enum(SCHEDULE_CREATE_KIND_IDS)
export const scheduleRunModeSchema = z.enum(SCHEDULE_RUN_MODE_IDS)
export const scheduleReasoningEffortSchema = z.enum(SCHEDULE_REASONING_EFFORT_IDS)
export const scheduleTaskStatusSchema = z.enum(SCHEDULE_TASK_STATUS_IDS)
export const scheduleToolEffectSchema = z.enum(SCHEDULE_TOOL_EFFECT_IDS)

export const scheduleToolSideEffectContractSchema = z.object({
  effect: scheduleToolEffectSchema,
  supportsDryRun: z.boolean(),
  requiresConfirmation: z.boolean()
}).strict()

export const SCHEDULE_TOOL_SIDE_EFFECTS = {
  gui_schedule_list: {
    effect: 'read-only',
    supportsDryRun: false,
    requiresConfirmation: false
  },
  gui_schedule_create: {
    effect: 'write',
    supportsDryRun: true,
    requiresConfirmation: true
  },
  gui_schedule_update: {
    effect: 'write',
    supportsDryRun: true,
    requiresConfirmation: true
  },
  gui_schedule_delete: {
    effect: 'destructive',
    supportsDryRun: true,
    requiresConfirmation: true
  },
  gui_schedule_status: {
    effect: 'read-only',
    supportsDryRun: false,
    requiresConfirmation: false
  },
  gui_schedule_run: {
    effect: 'destructive',
    supportsDryRun: true,
    requiresConfirmation: true
  },
  gui_schedule_detect_from_text: {
    effect: 'write',
    supportsDryRun: true,
    requiresConfirmation: false
  }
} as const satisfies Record<string, z.infer<typeof scheduleToolSideEffectContractSchema>>

const trimmedString = (max = 16_384) => z.string().trim().min(1).max(max)
const optionalTrimmedString = (max = 16_384) => z.string().trim().max(max).optional()
const timeOfDaySchema = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected 24h time like 09:00')
const dryRunField = z.boolean().optional().describe('Validate and return a preview without performing the schedule operation')
const previewField = z.boolean().optional().describe('Alias for dry_run; return the planned operation without side effects')
const confirmedField = z.boolean().optional().describe('Set true only after explicit user confirmation for schedule actions that require it')
const confirmationField = optionalTrimmedString(512).describe('Legacy confirmation value for operations that require it. Use the exact confirmation value from dry_run or confirmation_required responses')
const confirmationIdField = optionalTrimmedString(512).describe('Optional confirmation id from a confirmation_required response')
const writeControlFields = {
  dry_run: dryRunField,
  preview: previewField,
  confirmed: confirmedField,
  confirmation_id: confirmationIdField,
  confirmation: confirmationField
}

export const scheduledTaskScheduleSchema = z.object({
  kind: scheduleKindSchema,
  everyMinutes: z.number().int().min(1).max(10_080),
  timeOfDay: z.string(),
  atTime: z.string()
}).passthrough()

export const scheduledTaskSchema = z.object({
  id: trimmedString(512),
  title: z.string(),
  enabled: z.boolean(),
  prompt: z.string(),
  workspaceRoot: z.string(),
  model: z.string(),
  reasoningEffort: scheduleReasoningEffortSchema,
  mode: scheduleRunModeSchema,
  schedule: scheduledTaskScheduleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string(),
  nextRunAt: z.string(),
  lastStatus: scheduleTaskStatusSchema,
  lastMessage: z.string(),
  lastThreadId: z.string(),
  runtimeId: z.string().optional(),
  agentThreadIds: z.record(z.string(), z.string()).optional()
}).passthrough()

export const scheduleRuntimeStatusSchema = z.object({
  internalServerRunning: z.boolean(),
  internalUrl: z.string(),
  runningTaskIds: z.array(z.string()),
  powerSaveBlockerActive: z.boolean()
}).passthrough()

const scheduleGeneratedFileSchema = z.object({
  path: z.string(),
  relativePath: z.string().optional(),
  fileName: z.string()
}).passthrough()

export const scheduleRunResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    threadId: z.string(),
    turnId: z.string().optional(),
    text: z.string().optional(),
    message: z.string().optional(),
    files: z.array(scheduleGeneratedFileSchema).optional()
  }).passthrough(),
  z.object({
    ok: z.literal(false),
    message: z.string()
  }).passthrough()
])

export const scheduleTaskFromTextResultSchema = z.union([
  z.object({ kind: z.literal('noop') }).passthrough(),
  z.object({
    kind: z.literal('created'),
    taskId: z.string(),
    title: z.string(),
    scheduleAt: z.string(),
    confirmationText: z.string()
  }).passthrough(),
  z.object({
    kind: z.literal('error'),
    message: z.string()
  }).passthrough()
])

export const scheduleListToolInputSchema = z.object({}).strict()

export const scheduleCreateToolInputSchema = z.object({
  title: trimmedString(512).describe('Short task title shown in the GUI'),
  prompt: trimmedString(65_536).describe('The prompt/instruction the agent should run at schedule time'),
  schedule_kind: scheduleCreateKindSchema.describe('Schedule type'),
  at_time: optionalTrimmedString(128).describe('ISO 8601 timestamp with timezone offset, required when schedule_kind is `at`'),
  time_of_day: timeOfDaySchema.optional().describe('24h time like 09:00, required when schedule_kind is `daily`'),
  every_minutes: z.number().int().min(1).max(10_080).optional().describe('Interval in minutes, required when schedule_kind is `interval`'),
  workspace_root: optionalTrimmedString(4_096).describe('Optional workspace directory override'),
  model: optionalTrimmedString(128).describe('Optional model id, e.g. auto / deepseek-v4-pro / deepseek-v4-flash'),
  reasoning_effort: scheduleReasoningEffortSchema.optional().describe('Optional reasoning strength'),
  mode: scheduleRunModeSchema.optional().describe('Execution mode'),
  enabled: z.boolean().optional().describe('Whether the task should be enabled immediately'),
  ...writeControlFields
}).strict().superRefine((input, context) => {
  if (input.schedule_kind === 'at' && !input.at_time) {
    context.addIssue({
      code: 'custom',
      path: ['at_time'],
      message: 'at_time is required when schedule_kind is `at`'
    })
  }
  if (input.schedule_kind === 'daily' && !input.time_of_day) {
    context.addIssue({
      code: 'custom',
      path: ['time_of_day'],
      message: 'time_of_day is required when schedule_kind is `daily`'
    })
  }
  if (input.schedule_kind === 'interval' && input.every_minutes === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['every_minutes'],
      message: 'every_minutes is required when schedule_kind is `interval`'
    })
  }
})

export const scheduleUpdateToolInputSchema = z.object({
  task_id: trimmedString(512).describe('Task id returned by gui_schedule_list or gui_schedule_create'),
  title: trimmedString(512).optional(),
  prompt: trimmedString(65_536).optional(),
  enabled: z.boolean().optional(),
  workspace_root: optionalTrimmedString(4_096),
  model: optionalTrimmedString(128),
  reasoning_effort: scheduleReasoningEffortSchema.optional(),
  mode: scheduleRunModeSchema.optional(),
  schedule_kind: scheduleKindSchema.optional(),
  at_time: optionalTrimmedString(128),
  time_of_day: timeOfDaySchema.optional(),
  every_minutes: z.number().int().min(1).max(10_080).optional(),
  ...writeControlFields
}).strict().superRefine((input, context) => {
  const controlKeys = new Set(['task_id', 'dry_run', 'preview', 'confirmed', 'confirmation', 'confirmation_id'])
  const keys = Object.keys(input).filter((key) => !controlKeys.has(key))
  if (keys.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'At least one update field is required'
    })
  }
})

export const scheduleDeleteToolInputSchema = z.object({
  task_id: trimmedString(512).describe('Task id returned by gui_schedule_list or gui_schedule_create'),
  ...writeControlFields,
  confirmation: confirmationField
}).strict()

export const scheduleStatusToolInputSchema = z.object({}).strict()

export const scheduleRunToolInputSchema = z.object({
  task_id: trimmedString(512).describe('Task id returned by gui_schedule_list or gui_schedule_create'),
  ...writeControlFields,
  confirmation: confirmationField
}).strict()

export const scheduleDetectFromTextToolInputSchema = z.object({
  text: trimmedString(65_536).describe('Natural language request that may contain schedule intent'),
  workspace_root: optionalTrimmedString(4_096).describe('Optional workspace directory override'),
  model_hint: optionalTrimmedString(128).nullable().describe('Optional model id hint'),
  mode: scheduleRunModeSchema.nullable().optional().describe('Execution mode'),
  ...writeControlFields
}).strict()

export const scheduleErrorCodeSchema = z.enum([
  'invalid_input',
  'confirmation_required',
  'unauthorized',
  'not_found',
  'timeout',
  'aborted',
  'internal_http_error',
  'internal_http_unavailable',
  'internal_response_invalid',
  'schedule_task_failed',
  'detect_failed',
  'unknown'
])

export const scheduleErrorPayloadSchema = z.object({
  code: scheduleErrorCodeSchema,
  reason: z.string(),
  retryable: z.boolean(),
  suggestion: z.string()
}).passthrough()

export class ScheduleWorkerError extends Error {
  readonly code: ScheduleErrorCode
  readonly retryable: boolean
  readonly suggestion: string
  readonly status?: number
  readonly confirmationRequired?: McpWriteConfirmationRequired

  constructor(payload: ScheduleErrorPayload) {
    super(payload.reason)
    this.name = 'ScheduleWorkerError'
    this.code = payload.code
    this.retryable = payload.retryable
    this.suggestion = payload.suggestion
    this.status = payload.status
    this.confirmationRequired = payload.confirmationRequired
  }

  toPayload(): ScheduleErrorPayload {
    return {
      code: this.code,
      reason: this.message,
      retryable: this.retryable,
      suggestion: this.suggestion,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.confirmationRequired ? { confirmationRequired: this.confirmationRequired } : {})
    }
  }
}

export function scheduleTaskResourceUri(taskId: string): string {
  return `schedule://task/${encodeURIComponent(taskId)}`
}

export function scheduleErrorPayloadFromUnknown(
  error: unknown,
  fallback: Partial<ScheduleErrorPayload> = {}
): ScheduleErrorPayload {
  if (error instanceof ScheduleWorkerError) {
    return error.toPayload()
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_input',
      reason: formatZodIssues(error),
      retryable: false,
      suggestion: 'Fix the schedule tool arguments and retry.'
    }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return {
    code: fallback.code ?? 'unknown',
    reason: fallback.reason ?? (reason.trim() || 'Unknown schedule worker error.'),
    retryable: fallback.retryable ?? false,
    suggestion: fallback.suggestion ?? 'Check the schedule request and try again.'
  }
}

function formatZodIssues(error: z.ZodError): string {
  const issues = error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'input'
      return `${path}: ${issue.message}`
    })
  const suffix = error.issues.length > issues.length ? `; ${error.issues.length - issues.length} more issue(s)` : ''
  return issues.length > 0
    ? `Invalid schedule tool input: ${issues.join('; ')}${suffix}.`
    : 'Invalid schedule tool input.'
}

export type ScheduleKind = z.infer<typeof scheduleKindSchema>
export type ScheduleRunMode = z.infer<typeof scheduleRunModeSchema>
export type ScheduleReasoningEffort = z.infer<typeof scheduleReasoningEffortSchema>
export type ScheduleTaskStatus = z.infer<typeof scheduleTaskStatusSchema>
export type ScheduleToolEffect = z.infer<typeof scheduleToolEffectSchema>
export type ScheduleToolSideEffectContract = z.infer<typeof scheduleToolSideEffectContractSchema>
export type ScheduledTaskSchedule = z.infer<typeof scheduledTaskScheduleSchema>
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>
export type ScheduleRuntimeStatus = z.infer<typeof scheduleRuntimeStatusSchema>
export type ScheduleRunResult = z.infer<typeof scheduleRunResultSchema>
export type ScheduleTaskFromTextResult = z.infer<typeof scheduleTaskFromTextResultSchema>
export type ScheduleListToolInput = z.infer<typeof scheduleListToolInputSchema>
export type ScheduleCreateToolInput = z.infer<typeof scheduleCreateToolInputSchema>
export type ScheduleUpdateToolInput = z.infer<typeof scheduleUpdateToolInputSchema>
export type ScheduleDeleteToolInput = z.infer<typeof scheduleDeleteToolInputSchema>
export type ScheduleStatusToolInput = z.infer<typeof scheduleStatusToolInputSchema>
export type ScheduleRunToolInput = z.infer<typeof scheduleRunToolInputSchema>
export type ScheduleDetectFromTextToolInput = z.infer<typeof scheduleDetectFromTextToolInputSchema>
export type ScheduleErrorCode = z.infer<typeof scheduleErrorCodeSchema>
export type ScheduleErrorPayload = z.infer<typeof scheduleErrorPayloadSchema> & {
  status?: number
  confirmationRequired?: McpWriteConfirmationRequired
}
