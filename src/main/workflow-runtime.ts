import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { URL } from 'node:url'
import { compileFunction, runInNewContext } from 'node:vm'
import {
  createResearchSearchService,
  researchSearchConfigFromEnv
} from '../../packages/workers/search/src/research-service'
import type {
  AppSettingsV1,
  AgentRuntimeId,
  ScheduledTaskV1,
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowConditionConfigV1,
  WorkflowCustomModuleV1,
  WorkflowConnectionV1,
  WorkflowEnvVarV1,
  WorkflowHttpRequestConfigV1,
  WorkflowInputFieldV1,
  WorkflowApprovalDecision,
  WorkflowLlmConfigV1,
  WorkflowPaperDownloadConfigV1,
  WorkflowResearchSearchConfigV1,
  WorkflowNodeRunResultV1,
  WorkflowNodeTestResult,
  WorkflowPendingApprovalV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowRunV1,
  WorkflowRuntimeStatus,
  WorkflowScheduleV1,
  WorkflowV1
} from '../shared/app-settings'
import {
  normalizeAgentRuntimeId,
  isScheduleOwnedWorkflow,
  scheduleTaskIdFromWorkflow
} from '../shared/app-settings'
import { resolveRuntimeModelRouterSettings } from '../shared/app-settings-model-router'
import { MAX_WORKFLOW_RUNS, normalizeWorkflow } from '../shared/app-settings-workflow'
import { buildModelRouterResponsesUrl } from '../shared/model-router-url'
import { exportWorkflowDsl } from '../shared/workflow-dsl'
import { researchSearchEnvForGuiMcp } from './research-search-mcp-server'
import { isAuthorizedInternalHttpRequest } from './internal-http-secret'
import {
  SCHEDULER_INTERVAL_MS,
  parseJsonObject,
  readRequestBody,
  resolveScheduleModelConfig,
  runPromptViaRuntime,
  sleep,
  summarizeTaskResult,
  writeJson,
  type ScheduleRuntimeDeps
} from './schedule-runtime-helpers'

const MAX_NODE_EXECUTIONS = 200
const MAX_RUN_DURATION_MS = 30 * 60_000
/** Sentinel branch that matches no output handle (e.g. switch with no rule + no fallback). */
const NO_BRANCH = '__none__'
const AI_NODE_RESPONSE_TIMEOUT_MS = 30 * 60_000
const HTTP_MAX_RESPONSE_BYTES = 5_000_000
const PAPER_DOWNLOAD_MAX_BYTES = 100_000_000
const PAPER_DOWNLOAD_TIMEOUT_MS = 120_000
const RESEARCH_TEXT_FIELD_LIMIT = 900
const RESEARCH_TEXT_RESULT_LIMIT = 5
const LLM_NODE_RESPONSE_TIMEOUT_MS = 10 * 60_000
const LIVE_STATUS_LINGER_MS = 8_000

type WorkflowPayload = { json: unknown; text: string }
type ScheduleTriggerNode = Extract<WorkflowNodeV1, { type: 'schedule-trigger' }>
type WorkflowToolRunResult = {
  ok: boolean
  status: WorkflowRunStatus
  message: string
  output: string
  runId: string
}
type PreparedWorkflowRun =
  | { ok: false; result: WorkflowToolRunResult }
  | {
      ok: true
      triggerNodeId: string
      runId: ReturnType<typeof randomUUID>
      initialPayload: WorkflowPayload
    }

type NodeOutcome = {
  payload: WorkflowPayload
  message: string
  /** For condition nodes: which outgoing handle to follow ('true' | 'false'). */
  branch?: string
  /** For ai-agent nodes: the local runtime thread created. */
  threadId?: string
}

type WorkflowInternalValidateIssue = {
  code: string
  message: string
  path?: string
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isScheduleTrigger(node: WorkflowNodeV1): node is ScheduleTriggerNode {
  return node.type === 'schedule-trigger'
}

function activeScheduleTriggers(workflow: WorkflowV1): ScheduleTriggerNode[] {
  return workflow.nodes
    .filter(isScheduleTrigger)
    .filter((node) => !node.disabled && node.config.schedule.kind !== 'manual')
}

export function workflowHasScheduleTrigger(workflow: WorkflowV1): boolean {
  return activeScheduleTriggers(workflow).length > 0
}

function hasEnabledScheduleOwnedWorkflow(settings: AppSettingsV1): boolean {
  return settings.workflow.workflows.some((workflow) =>
    workflow.enabled && isScheduleOwnedWorkflow(workflow) && workflowHasScheduleTrigger(workflow)
  )
}

function workflowHasOneShotAtTrigger(workflow: WorkflowV1): boolean {
  return activeScheduleTriggers(workflow).some((node) => node.config.schedule.kind === 'at')
}

export function hasEnabledScheduledWorkflow(settings: AppSettingsV1): boolean {
  return settings.workflow.workflows.some((workflow) => workflow.enabled && workflowHasScheduleTrigger(workflow))
}

/** Minimal, dependency-free 5-field cron field parser ("* , - /"). */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const match = part.trim().match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!match) return null
    const star = match[1] === '*'
    const lo = star ? min : Number(match[1])
    const hi = star ? max : match[2] !== undefined ? Number(match[2]) : match[3] !== undefined ? max : lo
    const step = match[3] !== undefined ? Number(match[3]) : 1
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || step < 1) return null
    for (let value = lo; value <= hi; value += step) {
      if (value >= min && value <= max) out.add(value)
    }
  }
  return out.size ? out : null
}

/** Next fire time at or after `from` for a standard "min hour dom month dow" cron, in local time. */
export function cronNextRun(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minutes = parseCronField(parts[0], 0, 59)
  const hours = parseCronField(parts[1], 0, 23)
  const doms = parseCronField(parts[2], 1, 31)
  const months = parseCronField(parts[3], 1, 12)
  const dowsRaw = parseCronField(parts[4], 0, 7)
  if (!minutes || !hours || !doms || !months || !dowsRaw) return null
  const dows = new Set([...dowsRaw].map((day) => (day === 7 ? 0 : day)))
  const domRestricted = parts[2].trim() !== '*'
  const dowRestricted = parts[4].trim() !== '*'

  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = 366 * 24 * 60
  for (let i = 0; i < limit; i += 1) {
    if (months.has(cursor.getMonth() + 1)) {
      const dom = cursor.getDate()
      const dow = cursor.getDay()
      // Standard cron: when both DOM and DOW are restricted, match either.
      const dayOk =
        domRestricted && dowRestricted
          ? doms.has(dom) || dows.has(dow)
          : (domRestricted ? doms.has(dom) : true) && (dowRestricted ? dows.has(dow) : true)
      if (dayOk && hours.has(cursor.getHours()) && minutes.has(cursor.getMinutes())) {
        return new Date(cursor.getTime())
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

function nextRunFromSchedule(schedule: WorkflowScheduleV1, from: Date): string {
  switch (schedule.kind) {
    case 'manual':
      return ''
    case 'at':
      return schedule.atTime.trim()
    case 'interval':
      return new Date(from.getTime() + schedule.everyMinutes * 60_000).toISOString()
    case 'cron': {
      const next = schedule.cron.trim() ? cronNextRun(schedule.cron, from) : null
      return next ? next.toISOString() : ''
    }
    case 'daily':
    default: {
      const [hourRaw, minuteRaw] = schedule.timeOfDay.split(':')
      const hour = Number(hourRaw)
      const minute = Number(minuteRaw)
      const next = new Date(from)
      next.setSeconds(0, 0)
      next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0)
      if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1)
      return next.toISOString()
    }
  }
}

export function computeWorkflowNextRunAt(workflow: WorkflowV1, from: Date): string {
  if (!workflow.enabled) return ''
  const candidates = activeScheduleTriggers(workflow)
    .map((node) => nextRunFromSchedule(node.config.schedule, from).trim())
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort()
  return candidates[0] ?? ''
}

function buildAdjacency(connections: WorkflowConnectionV1[]): Map<string, WorkflowConnectionV1[]> {
  const map = new Map<string, WorkflowConnectionV1[]>()
  for (const edge of connections) {
    const list = map.get(edge.source) ?? []
    list.push(edge)
    map.set(edge.source, list)
  }
  return map
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueWorkflowId(base: string, usedIds: Set<string>): string {
  const normalized = base.trim() || 'workflow'
  if (!usedIds.has(normalized)) return normalized
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${normalized}-${index}`
    if (!usedIds.has(candidate)) return candidate
  }
  return `${normalized}-${Date.now()}`
}

function uniqueWorkflowName(base: string, usedNames: Set<string>): string {
  const normalized = base.trim() || 'Workflow'
  if (!usedNames.has(normalized.toLowerCase())) return normalized
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${normalized} (${index})`
    if (!usedNames.has(candidate.toLowerCase())) return candidate
  }
  return `${normalized} (${Date.now()})`
}

function withAgentThreadId(
  current: ScheduledTaskV1['agentThreadIds'],
  runtimeId: AgentRuntimeId,
  threadId: string
): ScheduledTaskV1['agentThreadIds'] {
  const trimmed = threadId.trim()
  if (!trimmed) return current
  return {
    ...(current ?? {}),
    [runtimeId]: trimmed
  }
}

function latestWorkflowThreadId(workflow: WorkflowV1): string {
  for (let runIndex = workflow.runs.length - 1; runIndex >= 0; runIndex -= 1) {
    const results = workflow.runs[runIndex].nodeResults
    for (let resultIndex = results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const threadId = results[resultIndex].threadId.trim()
      if (threadId) return threadId
    }
  }
  return ''
}

function workflowRuntimeId(workflow: WorkflowV1, settings: AppSettingsV1): AgentRuntimeId {
  const agentNode = workflow.nodes.find((node) => node.type === 'ai-agent')
  return normalizeAgentRuntimeId(agentNode?.type === 'ai-agent' ? agentNode.config.runtimeId : settings.activeAgentRuntime)
}

function mirrorScheduleTaskFromWorkflow(
  task: ScheduledTaskV1,
  workflow: WorkflowV1,
  settings: AppSettingsV1
): ScheduledTaskV1 {
  const runtimeId = workflowRuntimeId(workflow, settings)
  const threadId = latestWorkflowThreadId(workflow)
  const oneShotFinished = workflowHasOneShotAtTrigger(workflow) && workflow.lastStatus !== 'running'
  return {
    ...task,
    ...(oneShotFinished ? { enabled: false } : {}),
    lastRunAt: workflow.lastRunAt,
    nextRunAt: oneShotFinished ? '' : workflow.nextRunAt,
    lastStatus: workflow.lastStatus,
    lastMessage: workflow.lastMessage,
    updatedAt: workflow.updatedAt,
    runtimeId,
    agentThreadIds: withAgentThreadId(task.agentThreadIds, runtimeId, threadId)
  }
}

function readPath(payload: WorkflowPayload, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed || trimmed === 'text') return payload.text
  if (trimmed === 'json') return payload.json
  const segments = trimmed.replace(/^json\.?/, '').split('.').filter(Boolean)
  let cursor: unknown = payload.json
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return cursor
}

/** Drill into a value by a dot-path (e.g. "user.name"); empty path returns the value itself. */
function getByPath(value: unknown, path: string): unknown {
  const trimmed = path.trim()
  if (!trimmed) return value
  const segments = trimmed.replace(/^json\.?/, '').split('.').filter(Boolean)
  let cursor: unknown = value
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return cursor
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : safeJson(value)
}

/** Cross-node / variable scope available to {{ }} expressions during a run. */
export type InterpScope = {
  /** This node's resolved typed inputs, exposed as {{$input.key}}. */
  input?: Record<string, unknown>
  /** nodeId -> that node's output payload (only completed, reachable nodes). */
  nodes?: Record<string, WorkflowPayload>
  /** workflow env vars, exposed as {{$env.key}}. */
  env?: Record<string, unknown>
  /** run-scoped vars (set-fields scope=run), exposed as {{$run.key}}. */
  run?: Record<string, unknown>
  /** current loop frame, exposed as {{$loop.index}} / {{$loop.item}} / {{$loop.total}}. */
  loop?: { index: number; item: unknown; total: number }
}

function resolveExpr(payload: WorkflowPayload, expr: string, scope?: InterpScope): unknown {
  const t = expr.trim()
  if (t.startsWith('$nodes.')) {
    const rest = t.slice('$nodes.'.length)
    const dot = rest.indexOf('.')
    const nodeId = dot === -1 ? rest : rest.slice(0, dot)
    const sub = dot === -1 ? '' : rest.slice(dot + 1)
    const np = scope?.nodes?.[nodeId]
    if (!np) return undefined
    if (!sub || sub === 'json') return np.json
    if (sub === 'text') return np.text
    return getByPath(np.json, sub.replace(/^json\.?/, ''))
  }
  if (t.startsWith('$input.')) {
    const rest = t.slice('$input.'.length)
    const dot = rest.indexOf('.')
    const key = dot === -1 ? rest : rest.slice(0, dot)
    const sub = dot === -1 ? '' : rest.slice(dot + 1)
    const base = scope?.input?.[key]
    return sub ? getByPath(base, sub) : base
  }
  if (t.startsWith('$env.')) return scope?.env?.[t.slice('$env.'.length)]
  if (t.startsWith('$run.')) {
    const rest = t.slice('$run.'.length)
    const dot = rest.indexOf('.')
    const key = dot === -1 ? rest : rest.slice(0, dot)
    const sub = dot === -1 ? '' : rest.slice(dot + 1)
    const base = scope?.run?.[key]
    return sub ? getByPath(base, sub) : base
  }
  if (t === '$loop.index') return scope?.loop?.index
  if (t === '$loop.total') return scope?.loop?.total
  if (t === '$loop.item' || t.startsWith('$loop.item.')) {
    const item = scope?.loop?.item
    const sub = t === '$loop.item' ? '' : t.slice('$loop.item.'.length)
    return sub ? getByPath(item, sub) : item
  }
  return readPath(payload, t)
}

function interpolate(template: string, payload: WorkflowPayload, scope?: InterpScope): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => stringifyValue(resolveExpr(payload, expr, scope)))
}

/** Whether a template references at least one {{ }} expression. */
function hasInterpolation(template: string): boolean {
  return /\{\{\s*[^}]+?\s*\}\}/.test(template)
}

/** A trimmed string, treating empty JSON literals ({} / [] / null) as "no content". */
function meaningfulText(value: string): string {
  const trimmed = value.trim()
  return trimmed === '{}' || trimmed === '[]' || trimmed === 'null' ? '' : trimmed
}

/**
 * The upstream input rendered as plain text, for AI prompts that don't explicitly
 * template it. A node's declared typed inputs ($input) win; otherwise the upstream
 * payload's text, then a primitive json value. Empty/empty-object payloads → ''.
 */
function buildUpstreamContext(payload: WorkflowPayload, inputs?: Record<string, unknown>): string {
  if (inputs && Object.keys(inputs).length > 0) {
    return Object.entries(inputs)
      .map(([key, value]) => `${key}: ${stringifyValue(value)}`)
      .join('\n')
      .trim()
  }
  const text = meaningfulText(payload.text ?? '')
  if (text) return text
  const json = payload.json
  if (json !== null && json !== undefined && typeof json !== 'object') return stringifyValue(json)
  return ''
}

/**
 * Assemble an AI node's prompt. The configured prompt is interpolated as usual;
 * when it has no {{ }} reference, the upstream input is appended so an AI node
 * that doesn't explicitly template its input still receives it.
 */
function buildAiPrompt(template: string, payload: WorkflowPayload, scope: InterpScope): string {
  const rendered = interpolate(template, payload, scope)
  if (hasInterpolation(template)) return rendered
  const context = buildUpstreamContext(payload, scope.input)
  if (!context) return rendered
  const base = rendered.trim()
  return base ? `${base}\n\n${context}` : context
}

type ModelRouterResponsesResponse = {
  output_text?: string
  output?: Array<{
    content?: string | Array<{ text?: string; type?: string }>
    text?: string
  }>
  choices?: Array<{
    message?: { content?: string | Array<{ text?: string; type?: string }> }
    text?: string
  }>
}

function flattenModelRouterContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (isRecord(item) && typeof item.text === 'string') return item.text
      return ''
    })
    .join('')
}

function modelRouterTextFromResponse(responseText: string): string {
  let parsed: ModelRouterResponsesResponse
  try {
    parsed = JSON.parse(responseText) as ModelRouterResponsesResponse
  } catch {
    throw new Error('Model Router returned non-JSON data.')
  }
  if (typeof parsed.output_text === 'string') return parsed.output_text
  if (Array.isArray(parsed.output)) {
    const outputText = parsed.output
      .map((item) => (typeof item?.text === 'string' ? item.text : flattenModelRouterContent(item?.content)))
      .join('')
    if (outputText) return outputText
  }
  const firstChoice = parsed.choices?.[0]
  if (typeof firstChoice?.text === 'string') return firstChoice.text
  return flattenModelRouterContent(firstChoice?.message?.content)
}

async function runLlmNode(
  config: WorkflowLlmConfigV1,
  payload: WorkflowPayload,
  settings: AppSettingsV1,
  scope: InterpScope
): Promise<NodeOutcome> {
  const router = resolveRuntimeModelRouterSettings(settings)
  if (!router.apiKey) throw new Error('Missing Model Router runtime API key.')
  const url = buildModelRouterResponsesUrl(router.baseUrl)
  if (!url) throw new Error('Missing Model Router base URL.')
  const prompt = buildAiPrompt(config.prompt, payload, scope)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${router.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model.trim() || router.model,
      input: prompt,
      ...(config.maxTokens > 0 ? { max_tokens: config.maxTokens } : {})
    }),
    signal: AbortSignal.timeout(LLM_NODE_RESPONSE_TIMEOUT_MS)
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`Model Router request failed (${response.status}): ${responseText.slice(0, 500)}`)
  }
  const text = modelRouterTextFromResponse(responseText)
  return { payload: { json: { text }, text }, message: summarizeTaskResult(text) }
}

function evaluateCondition(
  config: WorkflowConditionConfigV1,
  payload: WorkflowPayload,
  scope?: InterpScope
): boolean {
  const leftRaw = config.leftExpr.trim() ? resolveExpr(payload, config.leftExpr, scope) : payload.text
  const left = stringifyValue(leftRaw)
  const right = config.rightValue
  const l = config.caseSensitive ? left : left.toLowerCase()
  const r = config.caseSensitive ? right : right.toLowerCase()
  switch (config.operator) {
    case 'contains':
      return l.includes(r)
    case 'notContains':
      return !l.includes(r)
    case 'equals':
      return l === r
    case 'notEquals':
      return l !== r
    case 'startsWith':
      return l.startsWith(r)
    case 'endsWith':
      return l.endsWith(r)
    case 'isEmpty':
      return left.trim() === ''
    case 'isNotEmpty':
      return left.trim() !== ''
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    default:
      return false
  }
}

async function readBodyCapped(response: Response, limit: number): Promise<string> {
  const body = response.body
  if (!body) return response.text()
  const reader = body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      size += value.length
      if (size > limit) {
        await reader.cancel()
        throw new Error('Response body exceeds the 5MB limit.')
      }
      chunks.push(Buffer.from(value))
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function runHttpNode(
  config: WorkflowHttpRequestConfigV1,
  payload: WorkflowPayload,
  scope?: InterpScope
): Promise<NodeOutcome> {
  const url = interpolate(config.url, payload, scope).trim()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url || '(empty)'}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.')
  }
  const headers: Record<string, string> = {}
  for (const header of config.headers) {
    const key = header.key.trim()
    if (key) headers[key] = interpolate(header.value, payload, scope)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const init: RequestInit = { method: config.method, headers, signal: controller.signal }
    if (config.method !== 'GET' && config.method !== 'DELETE' && config.body.trim()) {
      init.body = interpolate(config.body, payload, scope)
    }
    const response = await fetch(url, init)
    const raw = await readBodyCapped(response, HTTP_MAX_RESPONSE_BYTES)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`)
    }
    let json: unknown = { status: response.status, body: raw }
    if (config.parseJson) {
      try {
        json = JSON.parse(raw)
      } catch {
        json = { status: response.status, body: raw }
      }
    }
    return { payload: { json, text: raw }, message: `${response.status} ${response.statusText}`.trim() }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${config.timeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function boundedRuntimeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function scopedNumberInput(
  scope: InterpScope | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  return boundedRuntimeNumber(scope?.input?.[key], fallback, min, max)
}

function defaultResearchQuery(payload: WorkflowPayload, scope?: InterpScope): string {
  const inputQuery = scope?.input?.query
  if (typeof inputQuery === 'string' && inputQuery.trim()) return inputQuery.trim()
  const text = meaningfulText(payload.text ?? '')
  if (text) return text
  return meaningfulText(stringifyValue(payload.json))
}

function compactText(value: unknown, limit = RESEARCH_TEXT_FIELD_LIMIT): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : stringifyValue(value)
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text
}

function compactResearchText(json: Record<string, unknown>): string {
  const lines: string[] = []
  const query = stringFromRecord(json, 'query')
  if (query) lines.push(`Query: ${query}`)
  const papers = Array.isArray(json.papers) ? json.papers.filter(isRecord).slice(0, RESEARCH_TEXT_RESULT_LIMIT) : []
  if (papers.length > 0) {
    lines.push('Papers:')
    papers.forEach((paper, index) => {
      const title = stringFromRecord(paper, 'title') || `Paper ${index + 1}`
      const year = paper.year ? ` (${paper.year})` : ''
      const venue = stringFromRecord(paper, 'venue')
      const url = stringFromRecord(paper, 'url') || stringFromRecord(paper, 'pdfUrl')
      const summary = compactText(stringFromRecord(paper, 'tldr') || stringFromRecord(paper, 'abstract'), 600)
      lines.push(`${index + 1}. ${title}${year}${venue ? ` — ${venue}` : ''}`)
      if (summary) lines.push(`   Summary: ${summary}`)
      if (url) lines.push(`   URL: ${url}`)
    })
  }
  const webResults = Array.isArray(json.webResults) ? json.webResults.filter(isRecord).slice(0, 3) : []
  if (webResults.length > 0) {
    lines.push('Web results:')
    webResults.forEach((result, index) => {
      const title = stringFromRecord(result, 'title') || `Result ${index + 1}`
      const url = stringFromRecord(result, 'url')
      const snippet = compactText(stringFromRecord(result, 'snippet'), 450)
      lines.push(`${index + 1}. ${title}${url ? ` — ${url}` : ''}`)
      if (snippet) lines.push(`   Snippet: ${snippet}`)
    })
  }
  const gaps = Array.isArray(json.gaps) ? json.gaps.map((item) => compactText(item, 240)).filter(Boolean) : []
  if (gaps.length > 0) lines.push(`Gaps: ${gaps.join(' | ')}`)
  const followups = Array.isArray(json.suggestedFollowups)
    ? json.suggestedFollowups.map((item) => compactText(item, 180)).filter(Boolean)
    : []
  if (followups.length > 0) lines.push(`Suggested followups: ${followups.join(' | ')}`)
  return lines.join('\n').trim() || safeJson(json)
}

function compactDownloadText(json: Record<string, unknown>): string {
  const base = compactResearchText(json)
  const downloads = Array.isArray(json.downloads) ? json.downloads.filter(isRecord) : []
  const downloadLines = downloads.map((download, index) => {
    const title = stringFromRecord(download, 'title') || `Download ${index + 1}`
    const status = stringFromRecord(download, 'status') || 'unknown'
    const localPath = stringFromRecord(download, 'localPath')
    const reason = stringFromRecord(download, 'reason')
    return `${index + 1}. ${title} — ${status}${localPath ? ` — ${localPath}` : ''}${reason ? ` — ${reason}` : ''}`
  })
  return [base, downloadLines.length ? `Downloads:\n${downloadLines.join('\n')}` : 'Downloads: none'].filter(Boolean).join('\n')
}

async function runResearchSearchNode(
  config: WorkflowResearchSearchConfigV1,
  payload: WorkflowPayload,
  scope?: InterpScope
): Promise<NodeOutcome> {
  const query = meaningfulText(interpolate(config.query, payload, scope)) || defaultResearchQuery(payload, scope)
  if (!query) throw new Error('Research search query is required.')
  const maxResults = scopedNumberInput(scope, 'maxResults', config.maxResults, 1, 50)
  const sinceYear = scopedNumberInput(scope, 'sinceYear', config.sinceYear, 0, 3000)
  const service = createResearchSearchService(
    researchSearchConfigFromEnv(researchSearchEnvForGuiMcp(process.env, process.argv))
  )
  const result = await service.search({
    query,
    intent: config.intent,
    domain: config.domain,
    ...(sinceYear ? { sinceYear } : {}),
    maxResults,
    sources: config.sources.length > 0 ? config.sources : undefined
  })
  const base = isRecord(payload.json) ? { ...payload.json } : { input: payload.json }
  const json = { ...base, query, ...result }
  return {
    payload: { json, text: compactResearchText(json) },
    message: `found ${result.papers.length} paper(s)`
  }
}

function resolveWorkflowOutputDir(runWorkspace: string, rawDir: string): string {
  const base = resolve(runWorkspace || process.cwd())
  const dir = rawDir.trim() || 'papers'
  if (isAbsolute(dir)) throw new Error('Download outputDir must be relative to the workflow workspace.')
  const target = resolve(base, dir)
  const rel = relative(base, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Download outputDir must stay inside the workflow workspace.')
  }
  return target
}

function sanitizeDownloadName(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  const safe = raw
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return safe || fallback
}

function candidatePapers(payload: WorkflowPayload): Record<string, unknown>[] {
  const source = isRecord(payload.json) && Array.isArray(payload.json.papers) ? payload.json.papers : payload.json
  if (!Array.isArray(source)) return []
  return source.filter(isRecord)
}

function stringFromRecord(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function looksLikePdfUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const path = url.pathname.toLowerCase()
    return path.endsWith('.pdf') || path.includes('/pdf/')
  } catch {
    return false
  }
}

function paperPdfUrl(paper: Record<string, unknown>): string {
  const pdfUrl = stringFromRecord(paper, 'pdfUrl')
  if (pdfUrl) return pdfUrl
  const url = stringFromRecord(paper, 'url')
  return url && looksLikePdfUrl(url) ? url : ''
}

function responseLooksPdf(response: Response, url: string): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  return contentType.includes('application/pdf') || contentType.includes('application/octet-stream') || looksLikePdfUrl(url)
}

async function writeResponseBodyToFile(response: Response, partPath: string, limitBytes: number): Promise<number> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response has no body.')
  const out = createWriteStream(partPath, { flags: 'wx' })
  const finished = Promise.race([
    once(out, 'finish'),
    once(out, 'error').then(([error]) => {
      throw error instanceof Error ? error : new Error(String(error))
    })
  ])
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > limitBytes) {
        await reader.cancel()
        throw new Error('Downloaded PDF exceeds the 100MB limit.')
      }
      if (!out.write(Buffer.from(value))) await once(out, 'drain')
    }
    out.end()
    await finished
    return bytes
  } catch (error) {
    out.destroy()
    await reader.cancel().catch(() => {})
    throw error
  }
}

async function downloadPdf(url: string, finalPath: string): Promise<number> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid PDF URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) PDF URLs are allowed.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAPER_DOWNLOAD_TIMEOUT_MS)
  const partPath = `${finalPath}.${randomUUID()}.part`
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/pdf,*/*;q=0.8' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (!responseLooksPdf(response, url)) {
      throw new Error(`URL did not return a PDF (${response.headers.get('content-type') || 'unknown content type'}).`)
    }
    const bytes = await writeResponseBodyToFile(response, partPath, PAPER_DOWNLOAD_MAX_BYTES)
    await rename(partPath, finalPath)
    return bytes
  } catch (error) {
    await rm(partPath, { force: true }).catch(() => {})
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timed out after ${PAPER_DOWNLOAD_TIMEOUT_MS}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function runPaperDownloadNode(
  config: WorkflowPaperDownloadConfigV1,
  payload: WorkflowPayload,
  runWorkspace: string,
  scope?: InterpScope
): Promise<NodeOutcome> {
  const outputDir = resolveWorkflowOutputDir(runWorkspace, interpolate(config.outputDir, payload, scope))
  await mkdir(outputDir, { recursive: true })
  const papers = candidatePapers(payload)
  const maxFiles = scopedNumberInput(scope, 'maxFiles', config.maxFiles, 1, 50)
  const downloads: Array<Record<string, unknown>> = []
  let attempts = 0
  let downloaded = 0
  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index]
    const title = stringFromRecord(paper, 'title') || `paper-${index + 1}`
    const pdfUrl = paperPdfUrl(paper)
    const base = { title, pdfUrl }
    if (!pdfUrl) {
      downloads.push({ ...base, status: 'skipped', reason: 'No open PDF URL in the upstream paper record.' })
      continue
    }
    if (attempts >= maxFiles) {
      downloads.push({ ...base, status: 'skipped', reason: 'Download limit reached.' })
      continue
    }
    attempts += 1
    const safeTitle = sanitizeDownloadName(title, `paper-${index + 1}`)
    const filename = `${String(index + 1).padStart(2, '0')}-${safeTitle}-${randomUUID().slice(0, 8)}.pdf`
    const localPath = join(outputDir, filename)
    try {
      const bytes = await downloadPdf(pdfUrl, localPath)
      downloaded += 1
      downloads.push({ ...base, status: 'downloaded', localPath, bytes })
    } catch (error) {
      downloads.push({
        ...base,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const base = isRecord(payload.json) ? { ...payload.json } : { input: payload.json }
  const json = { ...base, downloads, downloadFolder: outputDir }
  return {
    payload: { json, text: compactDownloadText(json) },
    message: `downloaded ${downloaded}/${attempts}`
  }
}

const CODE_TIMEOUT_MS = 2_000
/** python/bash scripts may do real work (network, files), so they get longer than the JS sandbox. */
const COMMAND_TIMEOUT_MS = 30_000
const PYTHON_BIN = process.env.WORKFLOW_PYTHON_BIN?.trim() || 'python3'
const MAX_SUBWORKFLOW_DEPTH = 5

function runCodeNode(
  code: string,
  payload: WorkflowPayload,
  fields: Record<string, unknown> = {}
): NodeOutcome {
  const sandbox: Record<string, unknown> = {
    $json: payload.json,
    $text: payload.text,
    $fields: fields,
    __result: undefined
  }
  try {
    runInNewContext(`__result = (function(){\n${code}\n})()`, sandbox, {
      timeout: CODE_TIMEOUT_MS,
      displayErrors: true
    })
  } catch (error) {
    throw new Error(`Code error: ${error instanceof Error ? error.message : String(error)}`)
  }
  const out = sandbox.__result
  if (out === undefined || out === null) return { payload: { json: {}, text: '' }, message: 'ok' }
  if (typeof out === 'string') return { payload: { json: { value: out }, text: out }, message: 'ok' }
  const json = typeof out === 'object' ? out : { value: out }
  return { payload: { json, text: safeJson(json) }, message: 'ok' }
}

/**
 * Run a python or bash script in a child process. The script reads its input on
 * stdin as JSON ({ json, text }) and via the $WORKFLOW_JSON / $WORKFLOW_TEXT env
 * vars; whatever it writes to stdout becomes the node output (parsed as JSON when
 * the whole stdout is a JSON object/array, otherwise passed through as text).
 */
function runCommandNode(
  language: 'python' | 'bash',
  code: string,
  payload: WorkflowPayload,
  fields: Record<string, unknown> = {}
): Promise<NodeOutcome> {
  const bin = language === 'python' ? PYTHON_BIN : 'bash'
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-c', code], {
      env: {
        ...process.env,
        WORKFLOW_TEXT: payload.text ?? '',
        WORKFLOW_JSON: safeJson(payload.json),
        WORKFLOW_FIELDS: safeJson(fields)
      }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (run: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      run()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error(`${language} script timed out after ${COMMAND_TIMEOUT_MS}ms`)))
    }, COMMAND_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      const reason =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? `${bin} was not found on this machine`
          : error.message
      finish(() => reject(new Error(`${language} error: ${reason}`)))
    })
    child.on('close', (exitCode) => {
      finish(() => {
        if (exitCode !== 0) {
          reject(new Error(`${language} exited with code ${exitCode}: ${(stderr || stdout).trim().slice(0, 500)}`))
          return
        }
        const out = stdout.trim()
        let parsed: unknown
        try {
          parsed = out ? JSON.parse(out) : undefined
        } catch {
          parsed = undefined
        }
        if (parsed !== null && typeof parsed === 'object') {
          resolve({ payload: { json: parsed, text: out }, message: 'ok' })
        } else {
          resolve({ payload: { json: out ? { text: out } : {}, text: out }, message: 'ok' })
        }
      })
    })
    // Scripts that never read stdin trigger EPIPE on write — ignore it.
    child.stdin.on('error', () => {})
    child.stdin.write(JSON.stringify({ json: payload.json, text: payload.text }))
    child.stdin.end()
  })
}

/** Coerce a custom node's stored string values into typed $fields for its module. */
function coerceModuleFields(
  module: WorkflowCustomModuleV1,
  values: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of module.fields) {
    const raw = values[field.key] ?? field.defaultValue ?? ''
    if (field.type === 'number') out[field.key] = raw === '' ? 0 : Number(raw) || 0
    else if (field.type === 'boolean') out[field.key] = raw === 'true' || raw === '1'
    else out[field.key] = raw
  }
  return out
}

/**
 * Editor-time syntax check for a Code node. JavaScript compiles in-process
 * (never executed); python/bash are parse-checked with the local interpreter
 * (`ast.parse` / `bash -n`). A missing interpreter returns `unavailable` rather
 * than a hard error so the editor can show a soft note.
 */
export function checkWorkflowCode(language: WorkflowCodeLanguage, code: string): Promise<WorkflowCodeCheckResult> {
  if (!code.trim()) return Promise.resolve({ status: 'ok' })
  if (language === 'javascript') {
    try {
      // Compiles the function body without running it — surfaces SyntaxError only.
      compileFunction(code, ['$json', '$text'])
      return Promise.resolve({ status: 'ok' })
    } catch (error) {
      return Promise.resolve({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const bin = language === 'python' ? PYTHON_BIN : 'bash'
  const args = language === 'python' ? ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'] : ['-n']
  return new Promise((resolveResult) => {
    let settled = false
    const done = (result: WorkflowCodeCheckResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult(result)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args)
    } catch {
      done({ status: 'unavailable', message: `${bin} is not available — cannot check ${language} syntax.` })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      done({ status: 'error', message: 'Syntax check timed out.' })
    }, 8_000)
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      done(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? { status: 'unavailable', message: `${bin} was not found — cannot check ${language} syntax.` }
          : { status: 'error', message: error.message }
      )
    })
    child.on('close', (exitCode) => {
      done(
        exitCode === 0
          ? { status: 'ok' }
          : { status: 'error', message: stderr.trim().slice(0, 800) || `Exited with code ${exitCode}.` }
      )
    })
    child.stdin?.on('error', () => {})
    child.stdin?.write(code)
    child.stdin?.end()
  })
}

/**
 * The run's working directory: the firing trigger's workspaceRoot, else the
 * workflow-settings default, else the app workspace. Used as the default cwd
 * for AI / image / code nodes that don't set their own.
 */
function coerceInputFieldValue(field: WorkflowInputFieldV1, raw: unknown): unknown {
  const asString = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw)
  switch (field.type) {
    case 'number':
      return typeof raw === 'number' ? raw : asString.trim() === '' ? 0 : Number(asString) || 0
    case 'boolean':
      return typeof raw === 'boolean' ? raw : asString === 'true' || asString === '1'
    case 'json':
      if (raw && typeof raw === 'object') return raw
      try {
        return JSON.parse(asString)
      } catch {
        return asString
      }
    default:
      return raw && typeof raw === 'object' ? raw : asString
  }
}

/** Build the run's initial payload from the manual trigger's input schema (or pass input through verbatim). */
function coerceInputToPayload(schema: WorkflowInputFieldV1[] | undefined, input: unknown): WorkflowPayload {
  if (!schema || schema.length === 0) {
    if (input === undefined || input === null) return { json: {}, text: '' }
    if (typeof input === 'string') return { json: { text: input }, text: input }
    return { json: input, text: safeJson(input) }
  }
  let src: Record<string, unknown> = {}
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    src = input as Record<string, unknown>
  } else if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) src = parsed as Record<string, unknown>
    } catch {
      /* not a JSON object — fields fall back to defaults */
    }
  }
  const json: Record<string, unknown> = {}
  for (const field of schema) {
    json[field.key] = coerceInputFieldValue(field, field.key in src ? src[field.key] : field.defaultValue)
  }
  return { json, text: safeJson(json) }
}

/** Returns the first required input key missing from `input`, or null if all present. */
function missingRequiredInput(schema: WorkflowInputFieldV1[] | undefined, input: unknown): string | null {
  if (!schema) return null
  const src = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  for (const field of schema) {
    if (field.required && !(field.key in src) && !field.defaultValue.trim()) return field.label || field.key
  }
  return null
}

function workflowInputFieldsForAgent(schema: WorkflowInputFieldV1[] | undefined): Array<Record<string, unknown>> {
  return (schema ?? []).map((field) => ({
    key: field.key,
    type: field.type,
    required: field.required,
    description: field.description || field.label,
    label: field.label || undefined,
    options: field.options.length > 0 ? field.options : undefined,
    defaultValue: field.defaultValue || undefined
  }))
}

function manualTriggerInputSchema(workflow: WorkflowV1): WorkflowInputFieldV1[] | undefined {
  const manual = workflow.nodes.find((node) => node.type === 'manual-trigger')
  return manual?.type === 'manual-trigger' ? manual.config.inputSchema : undefined
}

function validateWorkflowImportDocumentForInternal(value: unknown): WorkflowInternalValidateIssue[] {
  const issues: WorkflowInternalValidateIssue[] = []
  if (!isRecord(value)) {
    return [{ code: 'invalid_workflow_document', message: 'Workflow document must be an object.' }]
  }
  if (!stringField(value, 'name')) {
    issues.push({ code: 'invalid_workflow_document', message: 'Workflow document must include a name.', path: 'name' })
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    issues.push({ code: 'invalid_workflow_document', message: 'Workflow document must include at least one node.', path: 'nodes' })
  } else {
    value.nodes.slice(0, 200).forEach((node, index) => {
      if (!isRecord(node)) {
        issues.push({ code: 'invalid_workflow_document', message: 'Workflow node must be an object.', path: `nodes.${index}` })
        return
      }
      if (!stringField(node, 'id')) {
        issues.push({ code: 'invalid_workflow_document', message: 'Workflow node must include an id.', path: `nodes.${index}.id` })
      }
      if (!stringField(node, 'type')) {
        issues.push({ code: 'invalid_workflow_document', message: 'Workflow node must include a type.', path: `nodes.${index}.type` })
      }
    })
  }
  if (value.connections !== undefined && !Array.isArray(value.connections)) {
    issues.push({ code: 'invalid_workflow_document', message: 'Workflow connections must be an array.', path: 'connections' })
  }
  return issues
}

function validateWorkflowInputAgainstRuntimeSchema(
  schema: WorkflowInputFieldV1[] | undefined,
  input: unknown
): WorkflowInternalValidateIssue[] {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const issues: WorkflowInternalValidateIssue[] = []
  for (const field of schema ?? []) {
    const hasValue = Object.prototype.hasOwnProperty.call(source, field.key)
    const value = source[field.key]
    const hasDefault = field.defaultValue.trim().length > 0
    if (field.required && (!hasValue || value === undefined || value === null || value === '') && !hasDefault) {
      issues.push({
        code: 'missing_required_input',
        message: `Missing required input: ${field.key}`,
        path: field.key
      })
      continue
    }
    if (hasValue && value !== undefined && value !== null && value !== '') {
      const typeIssue = validateWorkflowInputFieldValue(field, value)
      if (typeIssue) issues.push(typeIssue)
    }
  }
  return issues
}

function validateWorkflowInputFieldValue(
  field: WorkflowInputFieldV1,
  value: unknown
): WorkflowInternalValidateIssue | null {
  switch (field.type) {
    case 'number':
      return typeof value === 'number'
        ? null
        : { code: 'invalid_input_type', message: `Input ${field.key} must be a number.`, path: field.key }
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : { code: 'invalid_input_type', message: `Input ${field.key} must be a boolean.`, path: field.key }
    case 'select':
      return field.options.length > 0 && !field.options.includes(String(value))
        ? { code: 'invalid_input_option', message: `Input ${field.key} must be one of: ${field.options.join(', ')}.`, path: field.key }
        : null
    case 'json':
      return null
    case 'text':
    case 'paragraph':
      return typeof value === 'string'
        ? null
        : { code: 'invalid_input_type', message: `Input ${field.key} must be a string.`, path: field.key }
  }
}

/** Parse a JSON object out of an LLM reply, tolerating ```json fences and surrounding prose. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(candidate)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(text)
  if (direct) return direct
  const match = text.match(/\{[\s\S]*\}/)
  return match ? tryParse(match[0]) : null
}

/** Run `fn` over items with at most `limit` in flight, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** Replace every secret value with *** in a string. */
function redactSecrets(secretValues: string[], text: string): string {
  return secretValues.reduce((acc, secret) => acc.split(secret).join('***'), text)
}

/**
 * All secret-typed env values across every workflow. Used so a parent run redacts
 * secrets that belong to a sub-workflow / loop body it invoked, not just its own.
 */
function collectSecretValues(settings: AppSettingsV1): string[] {
  const values: string[] = []
  for (const workflow of settings.workflow.workflows) {
    for (const entry of workflow.env) {
      if (entry.type === 'secret' && entry.value.trim()) values.push(entry.value)
    }
  }
  return values
}

/** Coerce a resolved node-input value to its declared type. */
function coerceNodeInputValue(type: 'text' | 'number' | 'boolean' | 'json', raw: unknown): unknown {
  switch (type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
      return Number.isFinite(n) ? n : 0
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1'
    case 'json': {
      if (raw && typeof raw === 'object') return raw
      try {
        return JSON.parse(String(raw ?? ''))
      } catch {
        return raw ?? null
      }
    }
    default:
      return typeof raw === 'string' ? raw : raw == null ? '' : safeJson(raw)
  }
}

/**
 * Resolve a node's typed inputs (bound to upstream output) into a {{$input.key}}
 * lookup. A single `{{ expr }}` source yields the raw value (object/number/…);
 * anything else is interpolated as a string. Returns undefined when no inputs.
 */
function resolveNodeInputs(
  node: WorkflowNodeV1,
  payload: WorkflowPayload,
  scope: InterpScope
): Record<string, unknown> | undefined {
  const bindings = node.inputs
  if (!bindings || bindings.length === 0) return undefined
  const out: Record<string, unknown> = {}
  for (const binding of bindings) {
    const key = binding.key.trim()
    if (!key) continue
    const single = binding.source.trim().match(/^\{\{([^}]+)\}\}$/)
    const raw = single ? resolveExpr(payload, single[1], scope) : interpolate(binding.source, payload, scope)
    out[key] = coerceNodeInputValue(binding.type, raw)
  }
  return out
}

/** Coerce a workflow's env vars into a {{$env.key}} lookup (secrets are plain values here). */
function resolveEnv(env: WorkflowEnvVarV1[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const entry of env) {
    if (!entry.key) continue
    out[entry.key] =
      entry.type === 'number'
        ? Number(entry.value) || 0
        : entry.type === 'boolean'
          ? entry.value === 'true'
          : entry.value
  }
  return out
}

function resolveRunWorkspace(
  workflow: WorkflowV1,
  settings: AppSettingsV1,
  triggerNodeId?: string,
  payload?: WorkflowPayload,
  scope?: InterpScope
): string {
  const triggers = workflow.nodes.filter(
    (node) =>
      node.type === 'manual-trigger' || node.type === 'schedule-trigger' || node.type === 'webhook-trigger'
  )
  const trigger = (triggerNodeId ? triggers.find((node) => node.id === triggerNodeId) : undefined) ?? triggers[0]
  const rawWorkspace =
    trigger && typeof (trigger.config as { workspaceRoot?: unknown }).workspaceRoot === 'string'
      ? (trigger.config as { workspaceRoot: string }).workspaceRoot
      : ''
  // The trigger's working directory may reference the run input ({{json.dir}} /
  // {{$env.X}}), so the working directory itself can be passed in as a parameter.
  const triggerWorkspace = (payload ? interpolate(rawWorkspace, payload, scope) : rawWorkspace).trim()
  return triggerWorkspace || settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot
}

function summarizeRun(results: WorkflowNodeRunResultV1[]): string {
  const lastMeaningful = [...results].reverse().find((result) => result.status === 'success' && result.message.trim())
  if (lastMeaningful) return lastMeaningful.message
  return `Completed ${results.length} step${results.length === 1 ? '' : 's'}`
}

/** Short description of a workflow for the agent's run_workflow / list_workflows tools. */
function summarizeWorkflowForAgent(workflow: WorkflowV1): string {
  const steps = workflow.nodes.filter((node) => node.type === 'ai-agent' || node.type === 'custom').length
  const kinds = [...new Set(workflow.nodes.map((node) => node.type))].filter(
    (kind) => kind !== 'manual-trigger' && kind !== 'schedule-trigger' && kind !== 'webhook-trigger'
  )
  return `${workflow.nodes.length} nodes${steps ? `, ${steps} AI step(s)` : ''} — ${kinds.slice(0, 6).join(', ') || 'trigger only'}`
}

// ---------------------------------------------------------------------------
// WorkflowRuntime
// ---------------------------------------------------------------------------

export class WorkflowRuntime {
  private readonly deps: ScheduleRuntimeDeps
  private scheduler: ReturnType<typeof setInterval> | null = null
  private runningWorkflowIds = new Set<string>()
  private cancelRequested = new Set<string>()
  /** Recursion guard: true while a hook-triggered workflow is running, so its own
   * tool calls (via AI-agent nodes) don't re-trigger hooks and loop forever. */
  private hookRunActive = false
  /** token -> paused human-approval node awaiting a decision. */
  private pendingApprovals = new Map<
    string,
    { entry: WorkflowPendingApprovalV1; resolve: (decision: WorkflowApprovalDecision) => void }
  >()
  /** workflowId -> nodeId -> live status, surfaced to the canvas via status(). */
  private liveNodeStatus = new Map<string, Map<string, WorkflowNodeRunStatus>>()
  /** workflowId -> nodeId -> latest per-node result (input/output/timing), surfaced live during a run. */
  private liveNodeResults = new Map<string, Map<string, WorkflowNodeRunResultV1>>()
  private powerSaveBlockerId: number | null = null
  private webhookServer: Server | null = null
  private webhookServerKey = ''

  constructor(deps: ScheduleRuntimeDeps) {
    this.deps = deps
  }

  sync(settings: AppSettingsV1): void {
    this.startScheduler()
    this.syncPowerSaveBlocker(settings)
    this.syncWebhookServer(settings)
    void this.ensureNextRuns(settings)
  }

  stop(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler)
      this.scheduler = null
    }
    this.stopPowerSaveBlocker()
    this.closeWebhookServer()
  }

  private syncWebhookServer(settings: AppSettingsV1): void {
    // The same local server hosts webhook-trigger paths, /workflow/internal/* (agent
    // tool) and the public POST /workflow/run, so listen whenever workflows are on.
    const shouldListen = settings.workflow.enabled && settings.workflow.workflows.length > 0
    if (!shouldListen) {
      this.closeWebhookServer()
      return
    }
    const key = String(settings.workflow.webhookPort)
    if (this.webhookServer && this.webhookServerKey === key) return
    this.closeWebhookServer()
    const server = createServer((req, res) => {
      void this.handleWebhookRequest(req, res)
    })
    server.on('error', (error) => {
      this.deps.logError('workflow-webhook', 'Webhook server failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      if (this.webhookServer === server) this.closeWebhookServer()
    })
    // Bind to localhost only — never expose the listener to the network.
    server.listen(settings.workflow.webhookPort, '127.0.0.1')
    this.webhookServer = server
    this.webhookServerKey = key
  }

  private closeWebhookServer(): void {
    if (!this.webhookServer) return
    const server = this.webhookServer
    this.webhookServer = null
    this.webhookServerKey = ''
    server.close()
  }

  private async handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const settings = await this.deps.store.load()
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      if (!isAuthorizedInternalHttpRequest(req, settings.workflow.webhookSecret)) {
        writeJson(res, 401, { ok: false, message: 'Unauthorized.' })
        return
      }
      // Internal endpoints used by the GUI-hosted workflow MCP server (agent tool)
      // and the local runtime hook bridge.
      if (
        pathname === '/workflow/internal/list' ||
        pathname === '/workflow/internal/run' ||
        pathname === '/workflow/internal/hook-run' ||
        pathname === '/workflow/internal/status' ||
        pathname === '/workflow/internal/stop' ||
        pathname === '/workflow/internal/approval' ||
        pathname === '/workflow/internal/validate' ||
        pathname === '/workflow/internal/import' ||
        pathname === '/workflow/internal/export'
      ) {
        await this.handleInternalRequest(pathname, req, res, settings)
        return
      }
      // Public local API: run any workflow by name/id and get its output back.
      if (pathname === '/workflow/run') {
        const body = await readRequestBody(req)
        const parsed = parseJsonObject(body) ?? {}
        const idOrName = String(parsed.workflow ?? parsed.name ?? parsed.workflowId ?? '').trim()
        if (!idOrName) {
          writeJson(res, 400, { ok: false, message: 'Provide a workflow name or id.' })
          return
        }
        const workspaceOverride = typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : undefined
        const result = await this.runWorkflowByRef(idOrName, parsed.input, workspaceOverride)
        writeJson(res, result.ok ? 200 : 400, result)
        return
      }
      const method = req.method ?? 'GET'
      let match: { workflow: WorkflowV1; nodeId: string } | null = null
      for (const workflow of settings.workflow.workflows) {
        if (!workflow.enabled) continue
        for (const node of workflow.nodes) {
          if (node.type !== 'webhook-trigger' || node.disabled) continue
          if (node.config.path !== pathname) continue
          if (node.config.method !== 'ANY' && node.config.method !== method) continue
          match = { workflow, nodeId: node.id }
          break
        }
        if (match) break
      }
      if (!match) {
        writeJson(res, 404, { ok: false, message: 'No enabled workflow matches this webhook.' })
        return
      }
      const body = await readRequestBody(req)
      const parsed = parseJsonObject(body)
      const runId = randomUUID()
      void this.runWorkflowInternal(match.workflow, match.nodeId, 'webhook', runId, {
        json: parsed ?? body,
        text: body
      })
      writeJson(res, 200, { ok: true, runId })
    } catch (error) {
      this.deps.logError('workflow-webhook', 'Webhook request failed', {
        message: error instanceof Error ? error.message : String(error)
      })
      try {
        writeJson(res, 500, { ok: false, message: 'Internal error.' })
      } catch {
        /* response already sent */
      }
    }
  }

  private async handleInternalRequest(
    pathname: string,
    req: IncomingMessage,
    res: ServerResponse,
    settings: AppSettingsV1
  ): Promise<void> {
    if (pathname === '/workflow/internal/list') {
      const workflows = settings.workflow.workflows
        .filter((workflow) => workflow.enabled && workflow.callableByAgent)
        .map((workflow) => {
          const inputs = workflowInputFieldsForAgent(manualTriggerInputSchema(workflow))
          return { id: workflow.id, name: workflow.name, description: summarizeWorkflowForAgent(workflow), inputs }
        })
      writeJson(res, 200, { ok: true, workflows })
      return
    }

    if (pathname === '/workflow/internal/status') {
      const body = await readRequestBody(req)
      const parsed = parseJsonObject(body) ?? {}
      const runtime = await this.status()
      const runId = stringField(parsed, 'runId')
      const workflowId = stringField(parsed, 'workflowId')
      const located = runId || workflowId ? this.findWorkflowRun(settings, { runId, workflowId }) : null
      writeJson(res, 200, {
        ok: true,
        ...(runId ? { runId } : {}),
        ...(workflowId || located?.workflow.id ? { workflowId: workflowId || located?.workflow.id } : {}),
        status: located?.run?.status,
        runtime,
        ...(located?.run ? { run: located.run } : {})
      })
      return
    }

    const body = await readRequestBody(req)
    const parsed = parseJsonObject(body) ?? {}

    if (pathname === '/workflow/internal/approval') {
      const token = stringField(parsed, 'token')
      const rawDecision = stringField(parsed, 'decision')
      const decision: WorkflowApprovalDecision =
        rawDecision === 'approved' || rawDecision === 'allow' ? 'approved' : 'rejected'
      if (!token) {
        writeJson(res, 400, { ok: false, message: 'Provide an approval token.' })
        return
      }
      const ok = this.resolveApproval(token, decision)
      writeJson(res, ok ? 200 : 404, { ok, decision, message: ok ? 'Approval resolved.' : 'Approval not found.' })
      return
    }

    if (pathname === '/workflow/internal/validate') {
      if (parsed.workflow !== undefined && typeof parsed.workflow !== 'string') {
        const issues = validateWorkflowImportDocumentForInternal(parsed.workflow)
        writeJson(res, 200, {
          ok: true,
          valid: issues.length === 0,
          issues
        })
        return
      }

      const idOrName = String(parsed.workflow ?? parsed.name ?? parsed.workflowId ?? '').trim()
      if (!idOrName) {
        writeJson(res, 400, { ok: false, message: 'Provide a workflow document, name, or id.' })
        return
      }
      const workflow = this.findAgentCallableWorkflowByRef(settings, idOrName)
      if (!workflow) {
        writeJson(res, 404, { ok: false, message: `No agent-callable workflow matches "${idOrName}".` })
        return
      }
      const inputSchema = manualTriggerInputSchema(workflow)
      const issues = validateWorkflowInputAgainstRuntimeSchema(inputSchema, parsed.input)
      writeJson(res, 200, {
        ok: true,
        valid: issues.length === 0,
        workflowId: workflow.id,
        issues,
        inputSchema: workflowInputFieldsForAgent(inputSchema)
      })
      return
    }

    if (pathname === '/workflow/internal/stop') {
      const runId = stringField(parsed, 'runId')
      let workflowId = stringField(parsed, 'workflowId')
      if (!workflowId && runId) {
        workflowId = this.findWorkflowRun(settings, { runId })?.workflow.id ?? ''
      }
      if (!workflowId) {
        writeJson(res, 400, { ok: false, message: 'Provide a workflow id or run id.' })
        return
      }
      const result = await this.stopWorkflow(workflowId)
      writeJson(res, result.ok ? 200 : 400, {
        ...result,
        ...(runId ? { runId } : {}),
        workflowId
      })
      return
    }

    if (pathname === '/workflow/internal/export') {
      const idOrName = String(parsed.workflow ?? parsed.name ?? parsed.workflowId ?? '').trim()
      if (!idOrName) {
        writeJson(res, 400, { ok: false, message: 'Provide a workflow name or id.' })
        return
      }
      const workflow = this.findWorkflowByRef(settings, idOrName)
      if (!workflow) {
        writeJson(res, 404, { ok: false, message: `Workflow "${idOrName}" not found.` })
        return
      }
      const exported = exportWorkflowDsl(workflow, 'SciForge', new Date().toISOString()).workflow
      writeJson(res, 200, {
        ok: true,
        workflowId: workflow.id,
        workflow: parsed.includeRuns === true ? { ...exported, runs: workflow.runs } : exported
      })
      return
    }

    if (pathname === '/workflow/internal/import') {
      const rawWorkflow = parsed.workflow
      if (!rawWorkflow || typeof rawWorkflow !== 'object' || Array.isArray(rawWorkflow)) {
        writeJson(res, 400, { ok: false, message: 'Provide a workflow document.' })
        return
      }
      const now = new Date().toISOString()
      const workflow = this.prepareImportedWorkflow(rawWorkflow as Partial<WorkflowV1>, settings, now)
      const saved = await this.deps.store.patch({
        workflow: {
          workflows: [...settings.workflow.workflows, workflow]
        }
      })
      this.sync(saved)
      writeJson(res, 200, {
        ok: true,
        workflowId: workflow.id,
        workflow,
        message: 'Workflow imported disabled and not callable by agents. Enable it and allow agent access in the SciForge workflow editor before running it.'
      })
      return
    }

    const idOrName = String(parsed.workflow ?? parsed.name ?? parsed.workflowId ?? '').trim()
    if (!idOrName) {
      writeJson(res, 400, { ok: false, message: 'Provide a workflow name or id.' })
      return
    }
    const workspaceOverride = typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : undefined
    if (pathname === '/workflow/internal/hook-run') {
      // The hook payload (the runtime invocation) is the workflow input; nodes read it via {{json.*}}.
      const result = await this.runForHook(idOrName, parsed.payload ?? parsed.input, workspaceOverride)
      writeJson(res, 200, result)
      return
    }
    const result = await this.runWorkflowForTool(idOrName, parsed.input, workspaceOverride)
    writeJson(res, result.ok ? 200 : 400, result)
  }

  private findWorkflowByRef(settings: AppSettingsV1, idOrName: string): WorkflowV1 | null {
    const normalized = idOrName.trim()
    if (!normalized) return null
    const lower = normalized.toLowerCase()
    return settings.workflow.workflows.find((item) =>
      item.id === normalized || item.name.toLowerCase() === lower
    ) ?? null
  }

  private findAgentCallableWorkflowByRef(settings: AppSettingsV1, idOrName: string): WorkflowV1 | null {
    const workflow = this.findWorkflowByRef(settings, idOrName)
    return workflow && workflow.enabled && workflow.callableByAgent ? workflow : null
  }

  private findWorkflowRun(
    settings: AppSettingsV1,
    input: { runId?: string; workflowId?: string }
  ): { workflow: WorkflowV1; run?: WorkflowRunV1 } | null {
    const workflowId = input.workflowId?.trim()
    const runId = input.runId?.trim()
    const workflows = workflowId
      ? settings.workflow.workflows.filter((workflow) => workflow.id === workflowId)
      : settings.workflow.workflows
    for (const workflow of workflows) {
      const run = runId ? workflow.runs.find((entry) => entry.id === runId) : undefined
      if (!runId || run) return { workflow, run }
    }
    return null
  }

  private prepareImportedWorkflow(
    rawWorkflow: Partial<WorkflowV1>,
    settings: AppSettingsV1,
    now: string
  ): WorkflowV1 {
    const normalized = normalizeWorkflow(rawWorkflow, settings.workflow.workflows.length, now)
    const usedIds = new Set(settings.workflow.workflows.map((workflow) => workflow.id))
    const usedNames = new Set(settings.workflow.workflows.map((workflow) => workflow.name.toLowerCase()))
    const idBase = normalized.id.trim() || `workflow-${settings.workflow.workflows.length + 1}`
    const nameBase = normalized.name.trim() || `Workflow ${settings.workflow.workflows.length + 1}`
    return {
      ...normalized,
      id: uniqueWorkflowId(idBase, usedIds),
      name: uniqueWorkflowName(nameBase, usedNames),
      enabled: false,
      callableByAgent: false,
      createdAt: now,
      updatedAt: now,
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      runs: []
    }
  }

  /** Start a workflow on behalf of the local runtime tool and return a pollable run id immediately. */
  async runWorkflowForTool(
    idOrName: string,
    input?: unknown,
    workspaceOverride?: string
  ): Promise<WorkflowToolRunResult> {
    const settings = await this.deps.store.load()
    const workflow = this.findAgentCallableWorkflowByRef(settings, idOrName)
    if (!workflow) {
      return { ok: false, status: 'error', message: `No agent-callable workflow matches "${idOrName}".`, output: '', runId: '' }
    }
    return this.startResolved(workflow, input, workspaceOverride)
  }

  private startResolved(
    workflow: WorkflowV1,
    input: unknown,
    workspaceOverride?: string
  ): WorkflowToolRunResult {
    const prepared = this.prepareResolvedRun(workflow, input)
    if (!prepared.ok) return prepared.result
    void this.runWorkflowInternal(
      workflow,
      prepared.triggerNodeId,
      'agent',
      prepared.runId,
      prepared.initialPayload,
      workspaceOverride
    )
      .catch((error: unknown) => {
        this.deps.logError('workflow', 'Detached workflow run failed', {
          message: error instanceof Error ? error.message : String(error),
          workflowId: workflow.id,
          runId: prepared.runId
        })
      })
    return {
      ok: true,
      status: 'running',
      message: 'Workflow started.',
      output: '',
      runId: prepared.runId
    }
  }

  private prepareResolvedRun(workflow: WorkflowV1, input: unknown): PreparedWorkflowRun {
    if (this.runningWorkflowIds.has(workflow.id)) {
      return {
        ok: false,
        result: { ok: false, status: 'error', message: 'Workflow is already running.', output: '', runId: '' }
      }
    }
    const trigger =
      workflow.nodes.find((node) => node.type === 'manual-trigger' && !node.disabled) ??
      workflow.nodes.find((node) => node.type === 'schedule-trigger' && !node.disabled) ??
      workflow.nodes.find((node) => node.type === 'webhook-trigger' && !node.disabled) ??
      workflow.nodes.find(
        (node) =>
          node.type === 'manual-trigger' || node.type === 'schedule-trigger' || node.type === 'webhook-trigger'
      )
    if (!trigger) {
      return {
        ok: false,
        result: { ok: false, status: 'error', message: 'Workflow has no trigger node.', output: '', runId: '' }
      }
    }
    const inputSchema = trigger.type === 'manual-trigger' ? trigger.config.inputSchema : undefined
    const missing = missingRequiredInput(inputSchema, input)
    if (missing) {
      return {
        ok: false,
        result: { ok: false, status: 'error', message: `Missing required input: ${missing}`, output: '', runId: '' }
      }
    }
    const runId = randomUUID()
    const initialPayload = coerceInputToPayload(inputSchema, input)
    return { ok: true, triggerNodeId: trigger.id, runId, initialPayload }
  }

  /**
   * Run a workflow triggered by a local runtime hook. Resolves by id (no callableByAgent
   * gate — the trigger binding is the gate). Reentrancy-guarded: while one hook run is
   * in flight, further hook runs are skipped so a workflow that edits files can't loop.
   */
  async runForHook(
    workflowId: string,
    input: unknown,
    workspaceOverride?: string
  ): Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string; skipped: boolean }> {
    if (this.hookRunActive) {
      return { ok: true, status: 'success', message: 'skipped (hook already running)', output: '', runId: '', skipped: true }
    }
    const settings = await this.deps.store.load()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) {
      return { ok: false, status: 'error', message: `Hook workflow "${workflowId}" not found.`, output: '', runId: '', skipped: false }
    }
    this.hookRunActive = true
    try {
      const result = await this.runResolved(workflow, input, workspaceOverride)
      return { ...result, skipped: false }
    } finally {
      this.hookRunActive = false
    }
  }

  /** Run any workflow by id or name (no callableByAgent gate) — for the local POST /workflow/run API. */
  async runWorkflowByRef(
    idOrName: string,
    input?: unknown,
    workspaceOverride?: string
  ): Promise<{ ok: boolean; status: WorkflowRunStatus; message: string; output: string; runId: string }> {
    const settings = await this.deps.store.load()
    const lower = idOrName.toLowerCase()
    const workflow = settings.workflow.workflows.find(
      (item) => item.enabled && (item.id === idOrName || item.name.toLowerCase() === lower)
    )
    if (!workflow) {
      return {
        ok: false,
        status: 'error',
        message: `No enabled workflow matches "${idOrName}". Enable the workflow to expose it over HTTP.`,
        output: '',
        runId: ''
      }
    }
    return this.runResolved(workflow, input, workspaceOverride)
  }

  private async runResolved(
    workflow: WorkflowV1,
    input: unknown,
    workspaceOverride?: string
  ): Promise<WorkflowToolRunResult> {
    const prepared = this.prepareResolvedRun(workflow, input)
    if (!prepared.ok) return prepared.result
    const result = await this.runWorkflowInternal(
      workflow,
      prepared.triggerNodeId,
      'agent',
      prepared.runId,
      prepared.initialPayload,
      workspaceOverride
    )
    const after = await this.deps.store.load()
    const run = after.workflow.workflows
      .find((item) => item.id === workflow.id)
      ?.runs.find((entry) => entry.id === prepared.runId)
    const status: WorkflowRunStatus = 'status' in result ? result.status : 'error'
    const output = this.pickRunOutput(workflow, run) || result.message
    return { ok: result.ok, status, message: result.message, output, runId: prepared.runId }
  }

  /** The run's canonical output: the last successful `output` node's result, else the last node's. */
  private pickRunOutput(workflow: WorkflowV1, run: WorkflowRunV1 | undefined): string {
    if (!run) return ''
    const outputIds = new Set(workflow.nodes.filter((node) => node.type === 'output').map((node) => node.id))
    const fromOutput = [...run.nodeResults]
      .reverse()
      .find((entry) => outputIds.has(entry.nodeId) && entry.status === 'success')
    const chosen = fromOutput ?? run.nodeResults[run.nodeResults.length - 1]
    return chosen?.outputJson ?? ''
  }

  async status(): Promise<WorkflowRuntimeStatus> {
    const nodeStatus: Record<string, Record<string, WorkflowNodeRunStatus>> = {}
    for (const [workflowId, map] of this.liveNodeStatus) {
      nodeStatus[workflowId] = Object.fromEntries(map)
    }
    const nodeResults: Record<string, Record<string, WorkflowNodeRunResultV1>> = {}
    for (const [workflowId, map] of this.liveNodeResults) {
      nodeResults[workflowId] = Object.fromEntries(map)
    }
    return {
      runningWorkflowIds: [...this.runningWorkflowIds],
      nodeStatus,
      nodeResults,
      powerSaveBlockerActive: this.isPowerSaveBlockerActive(),
      pendingApprovals: [...this.pendingApprovals.values()].map((pending) => pending.entry)
    }
  }

  /** Resolve a paused human-approval node. Returns false if the token is unknown (e.g. already decided). */
  resolveApproval(token: string, decision: WorkflowApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(token)
    if (!pending) return false
    pending.resolve(decision)
    return true
  }

  async runWorkflow(workflowId: string, input?: unknown): Promise<WorkflowRunResult> {
    const settings = await this.deps.store.load()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    if (this.runningWorkflowIds.has(workflowId)) return { ok: false, message: 'Workflow is already running.' }
    const trigger =
      workflow.nodes.find((node) => node.type === 'manual-trigger') ??
      workflow.nodes.find((node) => node.type === 'schedule-trigger') ??
      workflow.nodes.find((node) => node.type === 'webhook-trigger')
    if (!trigger) return { ok: false, message: 'Workflow has no trigger node.' }
    const inputSchema = trigger.type === 'manual-trigger' ? trigger.config.inputSchema : undefined
    const missing = missingRequiredInput(inputSchema, input)
    if (missing) return { ok: false, message: `Missing required input: ${missing}` }
    const runId = randomUUID()
    const initialPayload = coerceInputToPayload(inputSchema, input)
    // Fire-and-poll: the UI watches status() for per-node progress.
    void this.runWorkflowInternal(workflow, trigger.id, 'manual', runId, initialPayload)
    return { ok: true, runId, status: 'running', message: 'Started' }
  }

  async stopWorkflow(workflowId: string): Promise<WorkflowRunResult> {
    if (!this.runningWorkflowIds.has(workflowId)) return { ok: false, message: 'Workflow is not running.' }
    this.cancelRequested.add(workflowId)
    // Unblock any human-approval node paused in this run so it can wind down.
    for (const pending of this.pendingApprovals.values()) {
      if (pending.entry.workflowId === workflowId) pending.resolve('rejected')
    }
    return { ok: true, runId: '', status: 'running', message: 'Stopping' }
  }

  async runSingleNode(workflowId: string, nodeId: string): Promise<WorkflowRunResult> {
    const settings = await this.deps.store.load()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    const node = workflow.nodes.find((item) => item.id === nodeId)
    if (!node) return { ok: false, message: 'Node not found.' }
    const runId = randomUUID()
    void (async () => {
      const live = new Map<string, WorkflowNodeRunStatus>([[nodeId, 'running']])
      this.liveNodeStatus.set(workflowId, live)
      try {
        await this.executeNode(node, { json: {}, text: '' }, settings, undefined, 0, resolveRunWorkspace(workflow, settings))
        live.set(nodeId, 'success')
      } catch {
        live.set(nodeId, 'error')
      } finally {
        setTimeout(() => this.liveNodeStatus.delete(workflowId), LIVE_STATUS_LINGER_MS)
      }
    })()
    return { ok: true, runId, status: 'running', message: 'Started' }
  }

  /** Run a single node in isolation against a mock upstream payload, returning its result (not persisted). */
  async testNode(workflowId: string, nodeId: string, mockJson: string): Promise<WorkflowNodeTestResult> {
    const settings = await this.deps.store.load()
    const workflow = settings.workflow.workflows.find((item) => item.id === workflowId)
    if (!workflow) return { ok: false, message: 'Workflow not found.' }
    const node = workflow.nodes.find((item) => item.id === nodeId)
    if (!node) return { ok: false, message: 'Node not found.' }
    if (node.type.endsWith('-trigger')) return { ok: false, message: 'Trigger nodes cannot be tested.' }

    let mockValue: unknown = {}
    const trimmed = mockJson.trim()
    if (trimmed) {
      try {
        mockValue = JSON.parse(trimmed)
      } catch {
        mockValue = trimmed
      }
    }
    const payload: WorkflowPayload = {
      json: mockValue,
      text: typeof mockValue === 'string' ? mockValue : safeJson(mockValue)
    }
    const env = resolveEnv(workflow.env)
    const secretValues = workflow.env
      .filter((entry) => entry.type === 'secret' && entry.value.trim())
      .map((entry) => entry.value)
    const redact = (text: string): string => secretValues.reduce((acc, secret) => acc.split(secret).join('***'), text)
    const scope: InterpScope = { nodes: {}, env, run: {} }
    const startedAt = new Date()
    const inputJson = redact(safeJson(payload.json))
    try {
      const outcome = await this.executeNode(
        node,
        payload,
        settings,
        [payload],
        0,
        resolveRunWorkspace(workflow, settings),
        scope,
        {}
      )
      return {
        ok: true,
        result: {
          nodeId,
          status: 'success',
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          message: redact(outcome.message),
          outputJson: redact(safeJson(outcome.payload.json)),
          inputJson,
          retries: 0,
          threadId: outcome.threadId ?? '',
          error: ''
        }
      }
    } catch (error) {
      return {
        ok: true,
        result: {
          nodeId,
          status: 'error',
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          message: '',
          outputJson: '',
          inputJson,
          retries: 0,
          threadId: '',
          error: redact(error instanceof Error ? error.message : String(error))
        }
      }
    }
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
    if (!settings.workflow.enabled) return
    await this.ensureNextRuns(settings)
    const fresh = await this.deps.store.load()
    const now = Date.now()
    for (const workflow of fresh.workflow.workflows) {
      if (!workflow.enabled || this.runningWorkflowIds.has(workflow.id)) continue
      const trigger = activeScheduleTriggers(workflow)[0]
      if (!trigger) continue
      const dueAt = Date.parse(workflow.nextRunAt)
      if (!Number.isFinite(dueAt) || dueAt > now) continue
      void this.runWorkflowInternal(workflow, trigger.id, 'schedule')
    }
  }

  private async ensureNextRuns(settings: AppSettingsV1): Promise<void> {
    if (!settings.workflow.enabled) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    let changed = false
    const now = new Date()
    const interruptedMessage = 'Workflow was interrupted before completion.'
    const markInterrupted = (workflow: WorkflowV1): WorkflowV1 => ({
      ...workflow,
      ...(workflowHasOneShotAtTrigger(workflow) ? { enabled: false, nextRunAt: '' } : {}),
      lastStatus: 'error',
      lastMessage: interruptedMessage,
      updatedAt: now.toISOString(),
      runs: workflow.runs.map((run) => run.status === 'running'
        ? {
            ...run,
            status: 'error',
            finishedAt: now.toISOString(),
            message: interruptedMessage
          }
        : run)
    })
    const workflows = settings.workflow.workflows.map((workflow) => {
      const wasInterrupted = workflow.lastStatus === 'running' && !this.runningWorkflowIds.has(workflow.id)
      const scheduled = workflowHasScheduleTrigger(workflow)
      if (!workflow.enabled || !scheduled || this.runningWorkflowIds.has(workflow.id)) {
        if (!wasInterrupted) return workflow
        changed = true
        return markInterrupted(workflow)
      }
      if (workflow.nextRunAt && !wasInterrupted) return workflow
      changed = true
      const next = wasInterrupted ? markInterrupted(workflow) : workflow
      return {
        ...next,
        nextRunAt: workflowHasOneShotAtTrigger(next) ? '' : computeWorkflowNextRunAt(next, now)
      }
    })
    if (!changed) {
      this.syncPowerSaveBlocker(settings)
      return
    }
    const scheduleOwnedByTaskId = new Map<string, WorkflowV1>()
    for (const workflow of workflows) {
      if (!isScheduleOwnedWorkflow(workflow)) continue
      const taskId = scheduleTaskIdFromWorkflow(workflow)
      if (taskId) scheduleOwnedByTaskId.set(taskId, workflow)
    }
    const scheduleTasks = settings.schedule.tasks.map((task) => {
      const workflow = scheduleOwnedByTaskId.get(task.id)
      return workflow ? mirrorScheduleTaskFromWorkflow(task, workflow, settings) : task
    })
    const saved = await this.deps.store.patch({
      workflow: { ...settings.workflow, workflows },
      ...(scheduleOwnedByTaskId.size > 0
        ? { schedule: { ...settings.schedule, tasks: scheduleTasks } }
        : {})
    })
    this.syncPowerSaveBlocker(saved)
  }

  private async updateWorkflow(
    workflowId: string,
    updater: (workflow: WorkflowV1) => WorkflowV1
  ): Promise<AppSettingsV1> {
    const settings = await this.deps.store.load()
    let nextWorkflow: WorkflowV1 | null = null
    const workflows = settings.workflow.workflows.map((workflow) =>
      workflow.id === workflowId ? (nextWorkflow = updater(workflow)) : workflow
    )
    const scheduleTaskId = nextWorkflow && isScheduleOwnedWorkflow(nextWorkflow)
      ? scheduleTaskIdFromWorkflow(nextWorkflow)
      : ''
    const scheduleTask = scheduleTaskId
      ? settings.schedule.tasks.find((task) => task.id === scheduleTaskId)
      : undefined
    const saved = await this.deps.store.patch({
      workflow: { ...settings.workflow, workflows },
      ...(nextWorkflow && scheduleTask
        ? {
            schedule: {
              ...settings.schedule,
              tasks: settings.schedule.tasks.map((task) =>
                task.id === scheduleTask.id
                  ? mirrorScheduleTaskFromWorkflow(task, nextWorkflow as WorkflowV1, settings)
                  : task
              )
            }
          }
        : {})
    })
    this.syncPowerSaveBlocker(saved)
    return saved
  }

  private setLive(workflowId: string, nodeId: string, status: WorkflowNodeRunStatus): void {
    const map = this.liveNodeStatus.get(workflowId) ?? new Map<string, WorkflowNodeRunStatus>()
    map.set(nodeId, status)
    this.liveNodeStatus.set(workflowId, map)
  }

  /** Surface a per-node result (input/output/timing) live so the editor can show run logs as it runs. */
  private setLiveResult(workflowId: string | undefined, result: WorkflowNodeRunResultV1): void {
    if (!workflowId) return
    const map = this.liveNodeResults.get(workflowId) ?? new Map<string, WorkflowNodeRunResultV1>()
    map.set(result.nodeId, result)
    this.liveNodeResults.set(workflowId, map)
  }

  private async runWorkflowInternal(
    workflow: WorkflowV1,
    triggerNodeId: string,
    triggerLabel: string,
    runId = randomUUID(),
    initialPayload: WorkflowPayload = { json: {}, text: '' },
    workspaceOverride?: string
  ): Promise<WorkflowRunResult> {
    if (this.runningWorkflowIds.has(workflow.id)) {
      return { ok: false, message: 'Workflow is already running.' }
    }
    this.runningWorkflowIds.add(workflow.id)
    this.cancelRequested.delete(workflow.id)

    const liveStatus = new Map<string, WorkflowNodeRunStatus>()
    workflow.nodes.forEach((node) => liveStatus.set(node.id, 'pending'))
    this.liveNodeStatus.set(workflow.id, liveStatus)
    this.liveNodeResults.set(workflow.id, new Map())

    const startedAt = new Date()
    const run: WorkflowRunV1 = {
      id: runId,
      trigger: triggerLabel,
      status: 'running',
      startedAt: startedAt.toISOString(),
      finishedAt: '',
      message: '',
      nodeResults: []
    }
    await this.updateWorkflow(workflow.id, (current) => ({
      ...current,
      lastStatus: 'running',
      lastMessage: 'Running',
      nextRunAt: '',
      updatedAt: startedAt.toISOString(),
      runs: [...current.runs, run].slice(-MAX_WORKFLOW_RUNS)
    }))

    let runStatus: WorkflowRunStatus = 'success'
    let runMessage = ''
    let nodeResults: WorkflowNodeRunResultV1[] = []
    try {
      const settings = await this.deps.store.load()
      const result = await this.runGraph(workflow, triggerNodeId, initialPayload, {
        settings,
        statusWorkflowId: workflow.id,
        cancelId: workflow.id,
        runId,
        depth: 0,
        workspaceOverride
      })
      runStatus = result.status
      nodeResults = result.nodeResults
      runMessage = runStatus === 'success' ? summarizeRun(nodeResults) : result.errorMessage
    } catch (error) {
      runStatus = 'error'
      runMessage = error instanceof Error ? error.message : String(error)
      this.deps.logError('workflow', 'Workflow run failed', { message: runMessage, workflowId: workflow.id })
    } finally {
      const finishedAt = new Date()
      await this.updateWorkflow(workflow.id, (current) => ({
        ...current,
        ...(workflowHasOneShotAtTrigger(current) ? { enabled: false } : {}),
        lastRunAt: finishedAt.toISOString(),
        lastStatus: runStatus,
        lastMessage: runMessage,
        nextRunAt: workflowHasOneShotAtTrigger(current) ? '' : computeWorkflowNextRunAt(current, finishedAt),
        updatedAt: finishedAt.toISOString(),
        runs: current.runs.map((entry) =>
          entry.id === runId
            ? { ...entry, status: runStatus, finishedAt: finishedAt.toISOString(), message: runMessage, nodeResults }
            : entry
        )
      }))
      this.runningWorkflowIds.delete(workflow.id)
      this.cancelRequested.delete(workflow.id)
      for (const [token, pending] of this.pendingApprovals) {
        if (pending.entry.runId === runId) this.pendingApprovals.delete(token)
      }
      setTimeout(() => {
        this.liveNodeStatus.delete(workflow.id)
        this.liveNodeResults.delete(workflow.id)
      }, LIVE_STATUS_LINGER_MS)
    }
    return { ok: runStatus !== 'error', runId, status: runStatus, message: runMessage }
  }

  /**
   * Pruning dataflow scheduler over one workflow graph. A node runs once all its
   * incoming edges are resolved (delivered a payload, or pruned). Conditions /
   * switches prune the branches they don't take, cascading to make downstream
   * nodes unreachable — so joins (Merge) wait only for branches that fire.
   * Pure: no persistence. Used by both top-level runs and sub-workflow nodes.
   */
  private async runGraph(
    workflow: WorkflowV1,
    triggerNodeId: string,
    initialPayload: WorkflowPayload,
    ctx: {
      settings: AppSettingsV1
      statusWorkflowId?: string
      cancelId?: string
      /** Run id, for keying human-approval pauses to this run. */
      runId?: string
      depth: number
      workspaceOverride?: string
      /** Loop frame for body sub-runs, exposed via {{$loop.*}}. */
      loop?: { index: number; item: unknown; total: number }
      /** Run-scoped vars shared across the run (set-fields scope=run). */
      runVars?: Record<string, unknown>
    }
  ): Promise<{
    status: WorkflowRunStatus
    errorMessage: string
    nodeResults: WorkflowNodeRunResultV1[]
    output: WorkflowPayload
  }> {
    const { settings } = ctx
    const env = resolveEnv(workflow.env)
    const runVars = ctx.runVars ?? {}
    // The trigger's working directory can read the run input ({{json.dir}}), so a
    // caller can pass the working directory in as a run parameter.
    const runWorkspace =
      ctx.workspaceOverride?.trim() ||
      resolveRunWorkspace(workflow, settings, triggerNodeId, initialPayload, { env, run: runVars, loop: ctx.loop })
    const setLive = (nodeId: string, status: WorkflowNodeRunStatus): void => {
      if (ctx.statusWorkflowId) this.setLive(ctx.statusWorkflowId, nodeId, status)
    }
    const isCanceled = (): boolean => (ctx.cancelId ? this.cancelRequested.has(ctx.cancelId) : false)

    const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]))
    const outEdges = new Map<string, WorkflowConnectionV1[]>()
    const inEdges = new Map<string, WorkflowConnectionV1[]>()
    for (const edge of workflow.connections) {
      const outList = outEdges.get(edge.source) ?? []
      outList.push(edge)
      outEdges.set(edge.source, outList)
      const inList = inEdges.get(edge.target) ?? []
      inList.push(edge)
      inEdges.set(edge.target, inList)
    }

    const nodeResults: WorkflowNodeRunResultV1[] = []
    const delivered = new Set<string>()
    const prunedEdges = new Set<string>()
    const payloadByEdge = new Map<string, WorkflowPayload>()
    const settledNodes = new Set<string>()
    const readyQueue: string[] = []
    const deadline = Date.now() + MAX_RUN_DURATION_MS
    let executions = 0
    let status: WorkflowRunStatus = 'success'
    let errorMessage = ''
    let output = initialPayload

    // Interpolation scope shared across the run: completed-node outputs ($nodes),
    // workflow env ($env), run-scoped vars ($run), and the loop frame ($loop).
    const nodeOutputs: Record<string, WorkflowPayload> = {}
    // Global secret set so this run also masks secrets owned by sub-workflows / loop
    // bodies whose output or error flows back across the workflow boundary.
    const secretValues = collectSecretValues(settings)
    const redact = (text: string): string => redactSecrets(secretValues, text)
    const scopeFor = (): InterpScope => ({ nodes: nodeOutputs, env, run: runVars, loop: ctx.loop })

    const incoming = (nodeId: string): WorkflowConnectionV1[] => inEdges.get(nodeId) ?? []
    const edgeResolved = (edge: WorkflowConnectionV1): boolean =>
      delivered.has(edge.id) || prunedEdges.has(edge.id)
    const allResolved = (nodeId: string): boolean => incoming(nodeId).every(edgeResolved)
    const hasLiveInput = (nodeId: string): boolean => incoming(nodeId).some((edge) => delivered.has(edge.id))
    const markReady = (nodeId: string): void => {
      if (!settledNodes.has(nodeId) && !readyQueue.includes(nodeId)) readyQueue.push(nodeId)
    }
    function pruneEdge(edge: WorkflowConnectionV1): void {
      if (delivered.has(edge.id) || prunedEdges.has(edge.id)) return
      prunedEdges.add(edge.id)
      settleTarget(edge.target)
    }
    function pruneNode(nodeId: string): void {
      if (settledNodes.has(nodeId)) return
      settledNodes.add(nodeId)
      for (const edge of outEdges.get(nodeId) ?? []) pruneEdge(edge)
    }
    function settleTarget(nodeId: string): void {
      if (settledNodes.has(nodeId) || !allResolved(nodeId)) return
      if (hasLiveInput(nodeId)) markReady(nodeId)
      else pruneNode(nodeId)
    }
    const handleActive = (outcome: NodeOutcome | null, sourceHandle: string): boolean => {
      if (!outcome || outcome.branch === undefined) return true
      return sourceHandle === outcome.branch
    }

    markReady(triggerNodeId)
    try {
      while (readyQueue.length > 0) {
        if (isCanceled()) {
          status = 'error'
          errorMessage = 'Canceled.'
          break
        }
        if (Date.now() > deadline) {
          status = 'error'
          errorMessage = 'Workflow exceeded the maximum run duration.'
          break
        }
        if (executions >= MAX_NODE_EXECUTIONS) {
          status = 'error'
          errorMessage = 'Workflow exceeded the maximum node count.'
          break
        }
        const nodeId = readyQueue.shift()
        if (!nodeId || settledNodes.has(nodeId)) continue
        const node = nodeById.get(nodeId)
        settledNodes.add(nodeId)
        if (!node) continue
        executions += 1

        const inputs = incoming(nodeId)
          .filter((edge) => delivered.has(edge.id))
          .map((edge) => payloadByEdge.get(edge.id))
          .filter((value): value is WorkflowPayload => Boolean(value))
        const primary = inputs[0] ?? (nodeId === triggerNodeId ? initialPayload : { json: {}, text: '' })

        let outcome: NodeOutcome | null
        if (node.disabled) {
          setLive(node.id, 'skipped')
          outcome = null
        } else {
          setLive(node.id, 'running')
          const nodeStartedAt = new Date()
          const inputJson = redact(safeJson(primary.json))
          // Surface the input immediately so the run log shows it while the node runs.
          this.setLiveResult(ctx.statusWorkflowId, {
            nodeId: node.id,
            status: 'running',
            startedAt: nodeStartedAt.toISOString(),
            finishedAt: '',
            message: '',
            outputJson: '',
            inputJson,
            retries: 0,
            threadId: '',
            error: ''
          })
          const maxRetries = node.retries ?? 0
          let attempt = 0
          let produced: NodeOutcome | null = null
          let lastError = ''
          // Retry, then apply onError: 'fail' (default) stops the run; 'continue'/'fallback' resume.
          while (true) {
            try {
              const baseScope = scopeFor()
              const nodeInputs = resolveNodeInputs(node, primary, baseScope)
              produced = await this.executeNode(
                node,
                primary,
                settings,
                inputs.length ? inputs : [primary],
                ctx.depth,
                runWorkspace,
                nodeInputs ? { ...baseScope, input: nodeInputs } : baseScope,
                runVars,
                ctx.statusWorkflowId && ctx.runId
                  ? { workflowId: ctx.statusWorkflowId, runId: ctx.runId }
                  : undefined
              )
              break
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error)
              if (attempt < maxRetries) {
                attempt += 1
                if (node.retryDelayMs) await sleep(node.retryDelayMs)
                continue
              }
              const mode = node.onError ?? 'fail'
              if (mode === 'continue' || mode === 'fallback') {
                let fallback: unknown = null
                if (mode === 'fallback' && node.fallbackJson) {
                  try {
                    fallback = JSON.parse(node.fallbackJson)
                  } catch {
                    fallback = node.fallbackJson
                  }
                }
                produced = {
                  payload: { json: fallback, text: mode === 'fallback' ? safeJson(fallback) : '' },
                  message: `error handled (${mode}): ${lastError}`
                }
              }
              break
            }
          }
          if (produced) {
            const result: WorkflowNodeRunResultV1 = {
              nodeId: node.id,
              status: 'success',
              startedAt: nodeStartedAt.toISOString(),
              finishedAt: new Date().toISOString(),
              message: redact(produced.message),
              outputJson: redact(safeJson(produced.payload.json)),
              inputJson,
              retries: attempt,
              threadId: produced.threadId ?? '',
              error: lastError ? redact(lastError) : ''
            }
            nodeResults.push(result)
            this.setLiveResult(ctx.statusWorkflowId, result)
            setLive(node.id, 'success')
            outcome = produced
            output = produced.payload
            nodeOutputs[node.id] = produced.payload
          } else {
            const result: WorkflowNodeRunResultV1 = {
              nodeId: node.id,
              status: 'error',
              startedAt: nodeStartedAt.toISOString(),
              finishedAt: new Date().toISOString(),
              message: '',
              outputJson: '',
              inputJson,
              retries: attempt,
              threadId: '',
              error: redact(lastError)
            }
            nodeResults.push(result)
            this.setLiveResult(ctx.statusWorkflowId, result)
            setLive(node.id, 'error')
            status = 'error'
            errorMessage = redact(lastError)
            break
          }
        }

        const outPayload = outcome ? outcome.payload : primary
        const edges = outEdges.get(node.id) ?? []
        for (const edge of edges) {
          if (handleActive(outcome, edge.sourceHandle || 'out')) {
            delivered.add(edge.id)
            payloadByEdge.set(edge.id, outPayload)
          } else {
            prunedEdges.add(edge.id)
          }
        }
        for (const edge of edges) settleTarget(edge.target)
      }
    } catch (error) {
      status = 'error'
      errorMessage = redact(error instanceof Error ? error.message : String(error))
      this.deps.logError('workflow', 'Workflow graph failed', { message: errorMessage, workflowId: workflow.id })
    }

    return { status, errorMessage, nodeResults, output }
  }

  private async executeNode(
    node: WorkflowNodeV1,
    payload: WorkflowPayload,
    settings: AppSettingsV1,
    inputs: WorkflowPayload[] = [payload],
    depth = 0,
    runWorkspace = '',
    scope: InterpScope = {},
    runVars: Record<string, unknown> = {},
    runRef?: { workflowId: string; runId: string }
  ): Promise<NodeOutcome> {
    switch (node.type) {
      case 'manual-trigger':
      case 'schedule-trigger':
      case 'webhook-trigger':
        // Triggers emit the run's initial payload (e.g. a webhook request body).
        return { payload, message: 'Triggered' }
      case 'llm':
        return runLlmNode(node.config, payload, settings, scope)
      case 'ai-agent': {
        const modelConfig = resolveScheduleModelConfig(
          settings,
          {
            providerId: node.config.providerId,
            model: node.config.model.trim() || settings.agents.sciforge.model,
            reasoningEffort: node.config.reasoningEffort
          },
          settings.workflow.providerId?.trim() || ''
        )
        const workspace =
          interpolate(node.config.workspaceRoot, payload, scope).trim() ||
          runWorkspace ||
          settings.workflow.defaultWorkspaceRoot.trim() ||
          settings.workspaceRoot
        const result = await runPromptViaRuntime(this.deps, settings, {
          prompt: buildAiPrompt(node.config.prompt, payload, scope),
          title: `[Workflow] ${node.name || 'AI task'}`.trim(),
          workspaceRoot: workspace,
          model: modelConfig.model,
          ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
          reasoningEffort: modelConfig.reasoningEffort,
          mode: node.config.mode,
          ...(node.config.runtimeId ? { runtimeId: node.config.runtimeId } : {}),
          waitForResult: true,
          responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS
        })
        if (!result.ok) throw new Error(result.message)
        const text = result.text ?? ''
        return { payload: { json: { text }, text }, message: summarizeTaskResult(text), threadId: result.threadId }
      }
      case 'generate-image': {
        throw new Error('Image generation workflow nodes are not supported in this SciForge build yet.')
      }
      case 'condition': {
        const matched = evaluateCondition(node.config, payload, scope)
        return { payload, message: matched ? 'true' : 'false', branch: matched ? 'true' : 'false' }
      }
      case 'switch': {
        for (let index = 0; index < node.config.rules.length; index += 1) {
          if (evaluateCondition(node.config.rules[index], payload, scope)) {
            return { payload, message: `case ${index + 1}`, branch: `case-${index}` }
          }
        }
        return {
          payload,
          message: node.config.fallback ? 'fallback' : 'no match',
          branch: node.config.fallback ? 'fallback' : NO_BRANCH
        }
      }
      case 'code':
        return node.config.language === 'python' || node.config.language === 'bash'
          ? runCommandNode(node.config.language, node.config.code, payload)
          : runCodeNode(node.config.code, payload)
      case 'subworkflow': {
        if (depth >= MAX_SUBWORKFLOW_DEPTH) throw new Error('Sub-workflow nesting is too deep.')
        const target = settings.workflow.workflows.find((workflow) => workflow.id === node.config.workflowId)
        if (!target) throw new Error('Sub-workflow not found.')
        const trigger =
          target.nodes.find((item) => item.type === 'manual-trigger') ??
          target.nodes.find((item) => item.type === 'schedule-trigger')
        if (!trigger) throw new Error('Sub-workflow has no trigger node.')
        const result = await this.runGraph(target, trigger.id, payload, { settings, depth: depth + 1 })
        if (result.status === 'error') throw new Error(result.errorMessage || 'Sub-workflow failed.')
        return { payload: result.output, message: `ran ${target.name || 'sub-workflow'}` }
      }
      case 'loop': {
        if (depth >= MAX_SUBWORKFLOW_DEPTH) throw new Error('Loop nesting is too deep.')
        const target = settings.workflow.workflows.find((workflow) => workflow.id === node.config.workflowId)
        if (!target) throw new Error('Loop body workflow not found.')
        const trigger =
          target.nodes.find((item) => item.type === 'manual-trigger') ??
          target.nodes.find((item) => item.type === 'schedule-trigger') ??
          target.nodes.find((item) => item.type === 'webhook-trigger')
        if (!trigger) throw new Error('Loop body has no trigger node.')
        if (node.config.mode === 'foreach') {
          // for-each: iterate an array, running the body once per item, optionally
          // in parallel. Each iteration sees $loop.index / $loop.item / $loop.total.
          const source = node.config.arraySource?.trim()
          const raw = source ? resolveExpr(payload, source, scope) : payload.json
          const items = (Array.isArray(raw) ? raw : []).slice(0, node.config.maxIterations)
          const total = items.length
          // Fail-fast: once one iteration throws (and we're not collecting errors),
          // short-circuit pending iterations so parallel workers stop launching new sub-runs.
          let aborted = false
          const runItem = async (item: unknown, index: number): Promise<unknown> => {
            if (aborted) throw new Error('Loop aborted after an earlier item failed.')
            const itemPayload: WorkflowPayload = {
              json: item,
              text: typeof item === 'string' ? item : safeJson(item)
            }
            try {
              const result = await this.runGraph(target, trigger.id, itemPayload, {
                settings,
                depth: depth + 1,
                loop: { index, item, total }
              })
              if (result.status === 'error') throw new Error(result.errorMessage || 'Loop item failed.')
              return result.output.json
            } catch (error) {
              if (node.config.continueOnError) return { error: error instanceof Error ? error.message : String(error) }
              aborted = true
              throw error
            }
          }
          const outputs =
            node.config.execution === 'parallel'
              ? await mapWithConcurrency(items, node.config.concurrency ?? 4, runItem)
              : await (async (): Promise<unknown[]> => {
                  const acc: unknown[] = []
                  for (let index = 0; index < items.length; index += 1) acc.push(await runItem(items[index], index))
                  return acc
                })()
          const failures = outputs.filter(
            (value) => value && typeof value === 'object' && 'error' in (value as Record<string, unknown>)
          ).length
          return {
            payload: { json: outputs, text: safeJson(outputs) },
            message: `foreach ${total - failures}/${total}${node.config.execution === 'parallel' ? ' (parallel)' : ''}`
          }
        }
        const stopCondition = {
          leftExpr: node.config.leftExpr,
          operator: node.config.operator,
          rightValue: node.config.rightValue,
          caseSensitive: node.config.caseSensitive
        }
        // Loop agent: run the body, feed its output back in, until the stop
        // condition holds or maxIterations caps it.
        let current = payload
        let iterations = 0
        let done = false
        while (iterations < node.config.maxIterations) {
          const result = await this.runGraph(target, trigger.id, current, {
            settings,
            depth: depth + 1,
            loop: { index: iterations, item: current.json, total: node.config.maxIterations }
          })
          iterations += 1
          if (result.status === 'error') throw new Error(result.errorMessage || 'Loop body failed.')
          current = result.output
          if (evaluateCondition(stopCondition, current, scope)) {
            done = true
            break
          }
        }
        const baseJson =
          current.json && typeof current.json === 'object' && !Array.isArray(current.json)
            ? { ...(current.json as Record<string, unknown>) }
            : { value: current.json }
        return {
          payload: { json: { ...baseJson, _iterations: iterations, _done: done }, text: current.text },
          message: `looped ${iterations}${done ? ' (done)' : ' (max)'}`
        }
      }
      case 'merge': {
        if (node.config.mode === 'object') {
          const merged: Record<string, unknown> = {}
          for (const input of inputs) {
            if (input.json && typeof input.json === 'object' && !Array.isArray(input.json)) {
              Object.assign(merged, input.json as Record<string, unknown>)
            }
          }
          return { payload: { json: merged, text: safeJson(merged) }, message: `merged ${inputs.length}` }
        }
        const collected = inputs.map((input) => input.json)
        return {
          payload: { json: collected, text: inputs.map((input) => input.text).filter(Boolean).join('\n') },
          message: `merged ${inputs.length}`
        }
      }
      case 'set-fields': {
        if (node.config.scope === 'run') {
          // Write into run-scoped vars ({{$run.key}}); pass the incoming payload through unchanged.
          for (const field of node.config.fields) {
            const key = field.key.trim()
            if (key) runVars[key] = interpolate(field.value, payload, scope)
          }
          return { payload, message: `set ${node.config.fields.length} run var(s)` }
        }
        const base =
          node.config.keepIncoming && payload.json && typeof payload.json === 'object' && !Array.isArray(payload.json)
            ? { ...(payload.json as Record<string, unknown>) }
            : {}
        for (const field of node.config.fields) {
          if (field.key.trim()) base[field.key.trim()] = interpolate(field.value, payload, scope)
        }
        const json = base
        return { payload: { json, text: safeJson(json) }, message: `${node.config.fields.length} fields` }
      }
      case 'filter': {
        const pass = evaluateCondition(node.config, payload, scope)
        return { payload, message: pass ? 'pass' : 'blocked', branch: pass ? undefined : NO_BRANCH }
      }
      case 'sort': {
        const items = Array.isArray(payload.json) ? [...(payload.json as unknown[])] : []
        const { field, order, numeric } = node.config
        items.sort((a, b) => {
          const av = field ? getByPath(a, field) : a
          const bv = field ? getByPath(b, field) : b
          const cmp = numeric
            ? (Number(av) || 0) - (Number(bv) || 0)
            : String(av ?? '').localeCompare(String(bv ?? ''))
          return order === 'desc' ? -cmp : cmp
        })
        return { payload: { json: items, text: safeJson(items) }, message: `sorted ${items.length}` }
      }
      case 'limit': {
        const items = Array.isArray(payload.json) ? (payload.json as unknown[]) : []
        const out = node.config.from === 'last' ? items.slice(-node.config.count) : items.slice(0, node.config.count)
        return { payload: { json: out, text: safeJson(out) }, message: `${out.length} items` }
      }
      case 'aggregate': {
        const items = Array.isArray(payload.json) ? (payload.json as unknown[]) : []
        const valueOf = (item: unknown): unknown => (node.config.field ? getByPath(item, node.config.field) : item)
        if (node.config.mode === 'sum') {
          const sum = items.reduce<number>((acc, item) => acc + (Number(valueOf(item)) || 0), 0)
          return { payload: { json: { sum }, text: safeJson({ sum }) }, message: `sum ${sum}` }
        }
        if (node.config.mode === 'join') {
          const text = items.map((item) => stringifyValue(valueOf(item))).join(node.config.separator || ', ')
          return { payload: { json: { text }, text }, message: `joined ${items.length}` }
        }
        if (node.config.mode === 'collect') {
          const values = items.map((item) => valueOf(item))
          return { payload: { json: { values }, text: safeJson({ values }) }, message: `collected ${values.length}` }
        }
        return { payload: { json: { count: items.length }, text: safeJson({ count: items.length }) }, message: `count ${items.length}` }
      }
      case 'research-search':
        return runResearchSearchNode(node.config, payload, scope)
      case 'paper-download':
        return runPaperDownloadNode(node.config, payload, runWorkspace, scope)
      case 'http-request':
        return runHttpNode(node.config, payload, scope)
      case 'delay':
        await sleep(node.config.delayMs)
        return { payload, message: `Waited ${node.config.delayMs}ms` }
      case 'template': {
        const rendered = interpolate(node.config.template, payload, scope)
        if (node.config.outputMode === 'json') {
          let parsed: unknown
          let parsedOk = true
          try {
            parsed = JSON.parse(rendered)
          } catch {
            parsed = { text: rendered }
            parsedOk = false
          }
          return { payload: { json: parsed, text: rendered }, message: parsedOk ? 'formatted' : 'formatted (text fallback)' }
        }
        return { payload: { json: { text: rendered }, text: rendered }, message: 'formatted' }
      }
      case 'json': {
        if (node.config.mode === 'stringify') {
          const text = safeJson(payload.json)
          return { payload: { json: { text }, text }, message: 'stringified' }
        }
        try {
          const parsed = JSON.parse(payload.text) as unknown
          return { payload: { json: parsed, text: payload.text }, message: 'parsed' }
        } catch (error) {
          if (node.config.strict) {
            throw new Error(`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
          }
          return { payload: { json: { text: payload.text }, text: payload.text }, message: 'parse fallback' }
        }
      }
      case 'output': {
        if (node.config.mode === 'text') {
          const text = interpolate(node.config.textTemplate, payload, scope)
          return { payload: { json: { text }, text }, message: 'output' }
        }
        if (node.config.mode === 'json') {
          const path = node.config.jsonPath.trim()
          // A missing path resolves to undefined — coerce to null so the output is valid JSON.
          const value = (path ? getByPath(payload.json, path) : payload.json) ?? null
          return { payload: { json: value, text: safeJson(value) }, message: 'output' }
        }
        return { payload, message: 'output' }
      }
      case 'parameter-extractor': {
        const modelConfig = resolveScheduleModelConfig(
          settings,
          { providerId: node.config.providerId, model: node.config.model.trim() || settings.agents.sciforge.model, reasoningEffort: node.config.reasoningEffort },
          settings.workflow.providerId?.trim() || ''
        )
        const workspace =
          runWorkspace || settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot
        const sourceText = node.config.source.trim() ? interpolate(node.config.source, payload, scope) : payload.text
        const fieldList = node.config.fields
          .map(
            (field) =>
              `- ${field.key}${field.required ? ' (required)' : ''}: ${field.type}` +
              `${field.description ? ` — ${field.description}` : ''}` +
              `${field.type === 'select' && field.options.length ? ` (one of: ${field.options.join(', ')})` : ''}`
          )
          .join('\n')
        const prompt =
          `${node.config.instruction ? `${node.config.instruction}\n\n` : ''}` +
          `Extract these fields from the text and reply with ONLY a JSON object using exactly these keys (no markdown, no prose):\n${fieldList}\n\nText:\n${sourceText}`
        const result = await runPromptViaRuntime(this.deps, settings, {
          prompt,
          title: `[Workflow] ${node.name || 'Extract'}`.trim(),
          workspaceRoot: workspace,
          model: modelConfig.model,
          ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
          reasoningEffort: modelConfig.reasoningEffort,
          mode: 'agent',
          waitForResult: true,
          responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS
        })
        if (!result.ok) throw new Error(result.message)
        const parsed = extractJsonObject(result.text ?? '')
        const json: Record<string, unknown> = {}
        for (const field of node.config.fields) {
          json[field.key] = coerceInputFieldValue(field, parsed?.[field.key])
        }
        return { payload: { json, text: safeJson(json) }, message: 'extracted', threadId: result.threadId }
      }
      case 'question-classifier': {
        const categories = node.config.categories
        if (categories.length === 0) return { payload, message: 'no categories' }
        const modelConfig = resolveScheduleModelConfig(
          settings,
          { providerId: node.config.providerId, model: node.config.model.trim() || settings.agents.sciforge.model, reasoningEffort: node.config.reasoningEffort },
          settings.workflow.providerId?.trim() || ''
        )
        const workspace =
          runWorkspace || settings.workflow.defaultWorkspaceRoot.trim() || settings.workspaceRoot
        const sourceText = node.config.source.trim() ? interpolate(node.config.source, payload, scope) : payload.text
        const list = categories.map((category, index) => `${index + 1}. ${category.label}`).join('\n')
        const prompt =
          `${node.config.instruction ? `${node.config.instruction}\n\n` : ''}` +
          `Classify the text into exactly one of these categories. Reply with ONLY the category number (1-${categories.length}):\n${list}\n\nText:\n${sourceText}`
        const result = await runPromptViaRuntime(this.deps, settings, {
          prompt,
          title: `[Workflow] ${node.name || 'Classify'}`.trim(),
          workspaceRoot: workspace,
          model: modelConfig.model,
          ...(modelConfig.providerId ? { providerId: modelConfig.providerId } : {}),
          reasoningEffort: modelConfig.reasoningEffort,
          mode: 'agent',
          waitForResult: true,
          responseTimeoutMs: AI_NODE_RESPONSE_TIMEOUT_MS
        })
        if (!result.ok) throw new Error(result.message)
        const num = Number.parseInt((result.text ?? '').match(/\d+/)?.[0] ?? '', 10)
        const index = Number.isFinite(num) && num >= 1 && num <= categories.length ? num - 1 : 0
        const chosen = categories[index]
        return { payload, message: `→ ${chosen.label}`, branch: chosen.id, threadId: result.threadId }
      }
      case 'human-approval': {
        // Pause the run until a decision arrives. Routes to the approved/rejected branch.
        // Note: the pending state is in-memory — an app restart mid-pause loses the run.
        if (!runRef) {
          // Single-node test / validation: cannot pause, so auto-approve.
          return { payload, message: 'approved (test)', branch: 'approved' }
        }
        const token = randomUUID()
        // Redact secrets: the instruction is surfaced via status() to the approval UI.
        const approvalSecrets = collectSecretValues(settings)
        const entry: WorkflowPendingApprovalV1 = {
          token,
          workflowId: runRef.workflowId,
          runId: runRef.runId,
          nodeId: node.id,
          nodeName: node.name,
          title: redactSecrets(approvalSecrets, node.config.title.trim() || node.name.trim() || 'Approval required'),
          instruction: redactSecrets(approvalSecrets, interpolate(node.config.instruction, payload, scope)),
          createdAt: new Date().toISOString()
        }
        const decision = await new Promise<WorkflowApprovalDecision>((resolve) => {
          let timer: ReturnType<typeof setTimeout> | undefined
          const settle = (value: WorkflowApprovalDecision): void => {
            if (timer) clearTimeout(timer)
            this.pendingApprovals.delete(token)
            resolve(value)
          }
          if (node.config.timeoutMs > 0) {
            timer = setTimeout(() => settle(node.config.onTimeout), node.config.timeoutMs)
          }
          this.pendingApprovals.set(token, { entry, resolve: settle })
        })
        if (decision === 'rejected') return { payload, message: 'rejected', branch: 'rejected' }
        const approvedJson =
          payload.json && typeof payload.json === 'object' && !Array.isArray(payload.json)
            ? { ...(payload.json as Record<string, unknown>), _approved: true }
            : payload.json
        return { payload: { json: approvedJson, text: payload.text }, message: 'approved', branch: 'approved' }
      }
      case 'custom': {
        const module = settings.workflow.modules.find((item) => item.id === node.config.moduleId)
        if (!module) throw new Error('Custom module not found — it may have been deleted.')
        const fields = coerceModuleFields(module, node.config.values)
        return module.language === 'python' || module.language === 'bash'
          ? runCommandNode(module.language, module.code, payload, fields)
          : runCodeNode(module.code, payload, fields)
      }
      default:
        return { payload, message: '' }
    }
  }

  private syncPowerSaveBlocker(settings: AppSettingsV1): void {
    const shouldKeepAwake =
      settings.workflow.enabled &&
      hasEnabledScheduledWorkflow(settings) &&
      (settings.workflow.keepAwake || (settings.schedule.keepAwake && hasEnabledScheduleOwnedWorkflow(settings)))
    if (!shouldKeepAwake) {
      this.stopPowerSaveBlocker()
      return
    }
    if (this.isPowerSaveBlockerActive()) return
    const blocker = this.deps.powerSaveBlocker
    if (!blocker) return
    this.powerSaveBlockerId = blocker.start('prevent-app-suspension')
  }

  private stopPowerSaveBlocker(): void {
    const blocker = this.deps.powerSaveBlocker
    const id = this.powerSaveBlockerId
    this.powerSaveBlockerId = null
    if (!blocker || id == null) return
    try {
      if (blocker.isStarted(id)) blocker.stop(id)
    } catch (error) {
      this.deps.logError('workflow-power-save', 'Failed to stop power save blocker', {
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
}

export function createWorkflowRuntime(deps: ScheduleRuntimeDeps): WorkflowRuntime {
  return new WorkflowRuntime(deps)
}
