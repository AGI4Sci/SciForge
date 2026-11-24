import { translateWorkspace } from './workspace-i18n.js'
/**
 * Capability failures reach the renderer as broker envelopes, for example:
 *
 * `Handler for collaboration.task-offer.reassign failed: handler_failed: First
 * requirements assignment failed: invalid_state_transition: Every Task
 * dependency must be completed in the same Project.`
 *
 * A User must never read that envelope. This module is the one place that
 * strips the transport prefixes and turns the known codes into localized
 * guidance; every surface that shows a capability failure uses it.
 */
export type CollaborationFailure = Readonly<{
  /** The guidance that is safe to show as the primary message. */
  message: string
  /**
   * The trimmed original capability message. It is kept for the
   * 「复制错误详情」 affordance so a User can still report the exact failure.
   */
  detail?: string
}>

const HANDLER_ENVELOPE_PREFIX = /^Handler for [\s\S]+? failed:\s*/iu
const HANDLER_FAILED_PREFIX = /^handler_failed:\s*/iu
const INVALID_STATE_TRANSITION = /\binvalid_state_transition\b/iu
const DEPENDENCY_SENTENCE = /dependenc(?:y|ies)[\s\S]*(?:complete|completed|adopt(?:ed)?)/iu
const AUTHORIZATION_FAILURE = /\b(?:not_authorized|forbidden)\b/iu

const DEPENDENCY_MESSAGE = '依赖任务未全部完成，暂时无法派发'
const STATE_CHANGED_MESSAGE = '任务状态已变化，请刷新后重试'
const AUTHORIZATION_MESSAGE = '你没有这个操作的权限'
const INVALID_INPUT_MESSAGE = '提交的内容不符合要求，请刷新后重试。'

/**
 * A schema failure is an array of machine-readable issues, not a sentence. The
 * renderer's own capability client rejects with a ZodError whose `message` is
 * that array, and the broker rejects with the same issues in `details`, so both
 * shapes are recognized here and never reach a User.
 */
type ValidationIssue = Readonly<{ code: string; path?: readonly unknown[] }>

/** The field a User can act on, in the order the copy is most useful. */
const VALIDATION_FIELD_MESSAGES: readonly Readonly<{ field: string; message: string }>[] = [
  { field: 'taskId', message: '任务标识无效，请刷新任务后重试。' },
  { field: 'projectId', message: '项目标识无效，请刷新项目后重试。' },
  { field: 'executionId', message: '执行记录无效，请刷新任务后重试。' }
]

function isValidationIssue(value: unknown): value is ValidationIssue {
  return typeof value === 'object' && value !== null &&
    typeof (value as { code?: unknown }).code === 'string'
}

function validationIssuesIn(value: unknown): readonly ValidationIssue[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  return value.every(isValidationIssue) ? value as readonly ValidationIssue[] : null
}

function serializedValidationIssues(text: string): readonly ValidationIssue[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    return validationIssuesIn(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return null
  }
}

/** Reads the issues from a ZodError, a transport error's details, or the message itself. */
function validationIssues(cause: unknown, text: string): readonly ValidationIssue[] | null {
  if (typeof cause === 'object' && cause !== null) {
    const direct = validationIssuesIn((cause as { issues?: unknown }).issues)
    if (direct) return direct
    const details = (cause as { details?: { issues?: unknown } }).details
    const nested = validationIssuesIn(details?.issues)
    if (nested) return nested
  }
  return serializedValidationIssues(text)
}

function validationMessage(issues: readonly ValidationIssue[]): string {
  const fields = new Set(issues.flatMap((issue) => (issue.path ?? []).map(String)))
  for (const candidate of VALIDATION_FIELD_MESSAGES) {
    if (fields.has(candidate.field)) return translateWorkspace(candidate.message)
  }
  return translateWorkspace(INVALID_INPUT_MESSAGE)
}

function rawMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) return cause.message
  return ''
}

/** Removes the broker transport wrappers while keeping the handler reason. */
export function stripCapabilityEnvelope(message: string): string {
  let text = message.trim()
  for (;;) {
    const stripped = text
      .replace(HANDLER_ENVELOPE_PREFIX, '')
      .replace(HANDLER_FAILED_PREFIX, '')
      .trim()
    if (stripped === text) return text
    text = stripped
  }
}

/**
 * Maps one capability failure to localized guidance. Unknown failures keep the
 * original (trimmed) message so nothing is silently swallowed.
 */
export function collaborationFailure(
  cause: unknown,
  fallback = '操作失败，请稍后重试。'
): CollaborationFailure {
  const original = rawMessage(cause).trim()
  if (!original) return { message: translateWorkspace(fallback) }
  const detail = stripCapabilityEnvelope(original)
  const issues = validationIssues(cause, detail)
  if (issues) {
    // The raw issue array stays copyable as the detail; the User only sees the
    // actionable localized sentence.
    return { message: validationMessage(issues), detail: detail || original }
  }
  const dependencyFailure = INVALID_STATE_TRANSITION.test(original) &&
    DEPENDENCY_SENTENCE.test(original)
  if (dependencyFailure) {
    return { message: translateWorkspace(DEPENDENCY_MESSAGE), detail: detail || original }
  }
  if (INVALID_STATE_TRANSITION.test(original)) {
    return { message: translateWorkspace(STATE_CHANGED_MESSAGE), detail: detail || original }
  }
  if (/\bassurance_insufficient\b/iu.test(original)) {
    return { message: translateWorkspace('这项审批需要近期登录验证。请重新登录 SciForge 后，再回来审批；当前请求尚未批准。'), detail: detail || original }
  }
  if (AUTHORIZATION_FAILURE.test(original)) {
    return { message: translateWorkspace(AUTHORIZATION_MESSAGE), detail: detail || original }
  }
  return { message: original, detail: original }
}

export function collaborationFailureMessage(
  cause: unknown,
  fallback = '操作失败，请稍后重试。'
): string {
  return collaborationFailure(cause, fallback).message
}
