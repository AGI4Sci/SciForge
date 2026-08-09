import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir } from 'node:fs/promises'
import type {
  AppSettingsV1,
  AgentRuntimeId,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduleRunResult,
  ScheduledTaskV1
} from '../shared/app-settings'
import {
  DEFAULT_SCHEDULE_MODEL,
  buildScheduleRuntimePrompt,
  normalizeAgentRuntimeId,
  normalizeScheduleReasoningEffort,
  resolveRuntimeModelRouterSettings
} from '../shared/app-settings'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadPageInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput
} from '../shared/agent-runtime-contract'
import type { JsonSettingsStore } from './settings-store'

export type PowerSaveBlockerLike = {
  start: (type: 'prevent-app-suspension' | 'prevent-display-sleep') => number
  stop: (id: number) => void
  isStarted: (id: number) => boolean
}

export type ScheduleRuntimeDeps = {
  store: JsonSettingsStore
  agentRuntime: {
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThreadStatus: (input: AgentRuntimeThreadStatusInput) => Promise<AgentRuntimeThreadStatus>
    readThreadPage: (input: AgentRuntimeThreadPageInput) => Promise<AgentRuntimeThreadPage>
    subscribeEvents: (input: {
      runtimeId: AgentRuntimeId
      threadId: string
      sinceSeq?: number
      signal?: AbortSignal
    }) => AsyncIterable<AgentRuntimeEvent>
    startTurn: (input: AgentRuntimeTurnStartInput) => Promise<AgentRuntimeTurnHandle>
    interruptTurn?: (input: { runtimeId: AgentRuntimeId; threadId: string; turnId: string; discard?: boolean }) => Promise<void>
  }
  logError: (category: string, message: string, detail?: unknown) => void
  powerSaveBlocker?: PowerSaveBlockerLike
}

export type ThreadRecordJson = {
  id: string
  status?: string
}

export type TurnRecordJson = {
  id: string
  status?: string
  error?: string | null
  items?: TurnItemJson[]
}

export type TurnItemJson = {
  kind: string
  turnId?: string
  status?: string
  toolName?: string
  toolKind?: string
  output?: unknown
  isError?: boolean | null
  text?: string | null
  summary?: string
  detail?: string | null
}

export type ThreadDetailJson = {
  thread?: ThreadRecordJson
  id?: string
  status?: string
  turns?: TurnRecordJson[]
  items?: TurnItemJson[]
  latestSeq?: number
  latestTurnId?: string
  latestTurnStatus?: string
}

export type RunPromptOptions = {
  prompt: string
  title: string
  workspaceRoot: string
  model: string
  providerId?: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  waitForResult: boolean
  responseTimeoutMs: number
  runtimeId?: AgentRuntimeId
}

export type ScheduleModelConfig = {
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type SchedulePromptRunResult = ScheduleRunResult & {
  /** Event watermark captured immediately before the scheduled turn starts. */
  eventSinceSeq?: number
}

export const SCHEDULER_INTERVAL_MS = 30_000
export const INTERNAL_BODY_LIMIT_BYTES = 1_000_000
export const TASK_RESPONSE_TIMEOUT_MS = 30 * 60_000

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function isRunningStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

export function latestAssistantText(
  detail: ThreadDetailJson,
  options: { turnId?: string } = {}
): string {
  const turnId = options.turnId?.trim()
  const items = turnId
    ? threadItems(detail).filter((item) => item.turnId === turnId)
    : threadItems(detail)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'assistant_text' && item.kind !== 'agent_message' && item.kind !== 'assistant_message') continue
    const text = (item.text ?? item.detail ?? item.summary ?? '').trim()
    if (text) return text
  }
  return ''
}

function threadItems(detail: ThreadDetailJson): TurnItemJson[] {
  const turns = Array.isArray(detail.turns) ? detail.turns : []
  const singleTurnId = turns.length === 1 ? turns[0].id : ''
  const topLevelItems = Array.isArray(detail.items)
    ? detail.items.map((item) => ({ ...item, turnId: item.turnId || singleTurnId || undefined }))
    : []
  const turnItems = turns.flatMap((turn) =>
    Array.isArray(turn.items)
      ? turn.items.map((item) => ({ ...item, turnId: item.turnId || turn.id }))
      : []
  )
  return [...topLevelItems, ...turnItems]
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function normalizeTaskModel(model: string): string | undefined {
  const trimmed = model.trim()
  return trimmed || undefined
}

export function resolveScheduleModelConfig(
  settings: AppSettingsV1,
  input: { providerId?: string; model?: string; reasoningEffort?: unknown },
  fallbackProviderId = ''
): ScheduleModelConfig {
  const routerModel = resolveRuntimeModelRouterSettings(settings).model
  return {
    providerId: (input.providerId ?? '').trim() || fallbackProviderId.trim(),
    model: normalizeTaskModel(routerModel) ?? DEFAULT_SCHEDULE_MODEL,
    reasoningEffort: normalizeScheduleReasoningEffort(input.reasoningEffort)
  }
}

export async function runPromptViaRuntime(
  deps: ScheduleRuntimeDeps,
  settings: AppSettingsV1,
  options: RunPromptOptions
): Promise<SchedulePromptRunResult> {
  const workspace = options.workspaceRoot.trim() || settings.schedule.defaultWorkspaceRoot.trim() || settings.workspaceRoot
  const runtimeId = normalizeAgentRuntimeId(options.runtimeId ?? settings.activeAgentRuntime)
  if (workspace) {
    await mkdir(workspace, { recursive: true })
  }
  const agentRuntime = deps.agentRuntime
  const model = normalizeTaskModel(options.model) ?? DEFAULT_SCHEDULE_MODEL

  let thread: { id: string }
  try {
    thread = await agentRuntime.startThread({
      runtimeId,
      workspace,
      title: options.title.trim() || undefined,
      mode: options.mode,
      model
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: message || 'Failed to create thread.' }
  }

  const eventSinceSeq = await agentRuntime.readThreadStatus({
    runtimeId,
    threadId: thread.id
  }).then((status) => status.latestSeq).catch(() => 0)
  let turn: { threadId: string; turnId: string }
  try {
    turn = await agentRuntime.startTurn({
      runtimeId,
      threadId: thread.id,
      text: buildScheduleRuntimePrompt(settings, options.prompt),
      workspace,
      mode: options.mode,
      model,
      reasoningEffort: options.reasoningEffort,
      governanceProfile: 'remote_guard'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: message || 'Failed to start turn.' }
  }

  const threadId = turn.threadId.trim() || thread.id
  const turnId = turn.turnId.trim()
  if (!turnId) {
    return { ok: false, message: 'Failed to start turn: missing turn id.' }
  }
  if (!options.waitForResult) {
    return { ok: true, threadId, turnId, message: 'Started', eventSinceSeq }
  }

  const text = await waitForAssistantTextViaRuntime(
    deps,
    runtimeId,
    threadId,
    turnId,
    options.responseTimeoutMs,
    eventSinceSeq
  )
  return { ok: true, threadId, turnId, text, message: text || 'Completed' }
}

export async function waitForAssistantTextViaRuntime(
  deps: ScheduleRuntimeDeps,
  runtimeId: AgentRuntimeId,
  threadId: string,
  turnId: string,
  timeoutMs: number,
  sinceSeq = 0
): Promise<string> {
  const agentRuntime = deps.agentRuntime
  const deadline = Date.now() + timeoutMs
  const pendingApprovals = new Set<string>()
  const pendingInputs = new Set<string>()
  const subscriptionController = new AbortController()
  const subscriptionTask = (async () => {
    for await (const event of agentRuntime.subscribeEvents({
      runtimeId,
      threadId,
      sinceSeq,
      signal: subscriptionController.signal
    })) {
      if (event.turnId?.trim() && event.turnId.trim() !== turnId) continue
      if (event.kind === 'approval_requested') pendingApprovals.add(event.approvalId)
      if (event.kind === 'approval_resolved') pendingApprovals.delete(event.approvalId)
      if (event.kind === 'user_input_requested') pendingInputs.add(event.requestId)
      if (event.kind === 'user_input_resolved') pendingInputs.delete(event.requestId)
    }
  })().catch((error) => {
    if (subscriptionController.signal.aborted) return
    deps.logError('schedule-task', 'Agent event subscription failed while waiting for a response.', {
      runtimeId,
      threadId,
      turnId,
      message: error instanceof Error ? error.message : String(error)
    })
  })
  try {
    while (Date.now() < deadline) {
      await sleep(1_500)
      if (pendingApprovals.size > 0 || pendingInputs.size > 0) {
        throw new Error('Agent turn is waiting for desktop approval or input.')
      }
      const status = await agentRuntime.readThreadStatus({ runtimeId, threadId })
      if (status.latestTurnId !== turnId) continue
      const turnStatus = status.latestTurnStatus ?? status.status
      if (isRunningStatus(turnStatus)) continue
      if (turnStatus === 'failed' || turnStatus === 'aborted') {
        throw new Error(`Agent turn ${turnStatus}.`)
      }
      // A tool-driven agent turn may complete successfully without emitting a final
      // assistant message. Completion is authoritative; an empty result is valid
      // and callers surface it as "Completed" instead of waiting until timeout.
      if (turnStatus === 'completed') {
        const page = await agentRuntime.readThreadPage({ runtimeId, threadId, limit: 20 })
        return latestAssistantText({ turns: page.turns }, { turnId })
      }
    }
    const page = await agentRuntime.readThreadPage({ runtimeId, threadId, limit: 20 })
    const lastText = latestAssistantText({ turns: page.turns }, { turnId })
    if (lastText) return lastText
    throw new Error('Timed out waiting for agent response.')
  } finally {
    subscriptionController.abort()
    void subscriptionTask
  }
}

export function summarizeTaskResult(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'Completed'
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 1_000)}...` : trimmed
}

export function computeScheduleNextRunAt(task: ScheduledTaskV1, from: Date): string {
  if (!task.enabled || task.schedule.kind === 'manual') return ''
  if (task.schedule.kind === 'at') {
    return task.schedule.atTime.trim()
  }
  if (task.schedule.kind === 'interval') {
    return new Date(from.getTime() + task.schedule.everyMinutes * 60_000).toISOString()
  }

  const [hourRaw, minuteRaw] = task.schedule.timeOfDay.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0)
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.toISOString()
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

export async function readRequestBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > INTERNAL_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function internalUrl(settings: AppSettingsV1): string {
  return `http://127.0.0.1:${settings.schedule.internal.port}`
}

export function hasEnabledScheduledTask(settings: AppSettingsV1): boolean {
  return settings.schedule.tasks.some((task) => task.enabled && task.schedule.kind !== 'manual')
}
