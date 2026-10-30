/**
 * Local runtime HTTP endpoint path templates. The renderer and the main
 * process IPC allow-list both derive their paths from this table, so
 * adding a new endpoint is a one-file change.
 *
 * `*TEMPLATE` constants carry the `{id}` / `{turn}` placeholders
 * literally. `*PATH(...)` builders perform the URL encoding and
 * return a concrete path for runtime use.
 */

export const LOCAL_RUNTIME_HEALTH_PATH = '/health'
export const LOCAL_RUNTIME_HEALTH_TEMPLATE = '/health'

export const LOCAL_RUNTIME_INFO_PATH = '/v1/runtime/info'
export const LOCAL_RUNTIME_INFO_TEMPLATE = '/v1/runtime/info'

export const LOCAL_RUNTIME_TOOLS_PATH = '/v1/runtime/tools'
export const LOCAL_RUNTIME_TOOLS_TEMPLATE = '/v1/runtime/tools'

export const LOCAL_RUNTIME_SKILLS_PATH = '/v1/skills'
export const LOCAL_RUNTIME_SKILLS_TEMPLATE = '/v1/skills'

export const LOCAL_RUNTIME_ATTACHMENTS_PATH = '/v1/attachments'
export const LOCAL_RUNTIME_ATTACHMENTS_TEMPLATE = '/v1/attachments'
export const LOCAL_RUNTIME_ATTACHMENT_DIAGNOSTICS_PATH = '/v1/attachments/diagnostics'
export const LOCAL_RUNTIME_ATTACHMENT_DIAGNOSTICS_TEMPLATE = '/v1/attachments/diagnostics'
export const LOCAL_RUNTIME_ATTACHMENT_TEMPLATE = '/v1/attachments/{id}'
export function localRuntimeAttachmentPath(attachmentId: string): string {
  return `/v1/attachments/${encodeURIComponent(attachmentId)}`
}
export const LOCAL_RUNTIME_ATTACHMENT_CONTENT_TEMPLATE = '/v1/attachments/{id}/content'
export function localRuntimeAttachmentContentPath(attachmentId: string): string {
  return `${localRuntimeAttachmentPath(attachmentId)}/content`
}

export const LOCAL_RUNTIME_MEMORY_PATH = '/v1/memory'
export const LOCAL_RUNTIME_MEMORY_TEMPLATE = '/v1/memory'
export const LOCAL_RUNTIME_MEMORY_DIAGNOSTICS_PATH = '/v1/memory/diagnostics'
export const LOCAL_RUNTIME_MEMORY_DIAGNOSTICS_TEMPLATE = '/v1/memory/diagnostics'
export const LOCAL_RUNTIME_MEMORY_RECORD_TEMPLATE = '/v1/memory/{id}'
export function localRuntimeMemoryRecordPath(memoryId: string): string {
  return `/v1/memory/${encodeURIComponent(memoryId)}`
}

export const LOCAL_RUNTIME_THREADS_PATH = '/v1/threads'
export const LOCAL_RUNTIME_THREADS_TEMPLATE = '/v1/threads'

export const LOCAL_RUNTIME_THREAD_TEMPLATE = '/v1/threads/{id}'
export function localRuntimeThreadPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}`
}

export const LOCAL_RUNTIME_THREAD_SIDEBAR_PROBE_TEMPLATE = '/v1/threads/{id}/sidebar-probe'
export function localRuntimeThreadSidebarProbePath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/sidebar-probe`
}

export const LOCAL_RUNTIME_THREAD_FORK_TEMPLATE = '/v1/threads/{id}/fork'
export function localRuntimeThreadForkPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/fork`
}

export const LOCAL_RUNTIME_THREAD_GOAL_TEMPLATE = '/v1/threads/{id}/goal'
export function localRuntimeThreadGoalPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/goal`
}

export const LOCAL_RUNTIME_THREAD_TODOS_TEMPLATE = '/v1/threads/{id}/todos'
export function localRuntimeThreadTodosPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/todos`
}

export const LOCAL_RUNTIME_THREAD_COMPACT_TEMPLATE = '/v1/threads/{id}/compact'
export function localRuntimeThreadCompactPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/compact`
}

export const LOCAL_RUNTIME_THREAD_REVIEW_TEMPLATE = '/v1/threads/{id}/review'
export function localRuntimeThreadReviewPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/review`
}

export const LOCAL_RUNTIME_THREAD_TURNS_TEMPLATE = '/v1/threads/{id}/turns'
export function localRuntimeThreadTurnsPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/turns`
}

export const LOCAL_RUNTIME_THREAD_STEER_TEMPLATE = '/v1/threads/{id}/turns/{turn}/steer'
export function localRuntimeThreadSteerPath(threadId: string, turnId: string): string {
  return `${localRuntimeThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}/steer`
}

export const LOCAL_RUNTIME_THREAD_INTERRUPT_TEMPLATE = '/v1/threads/{id}/turns/{turn}/interrupt'
export function localRuntimeThreadInterruptPath(threadId: string, turnId: string): string {
  return `${localRuntimeThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}/interrupt`
}

export const LOCAL_RUNTIME_THREAD_EVENTS_TEMPLATE = '/v1/threads/{id}/events'
export function localRuntimeThreadEventsPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/events`
}

export const LOCAL_RUNTIME_THREAD_CHILDREN_TEMPLATE = '/v1/threads/{id}/children'
export function localRuntimeThreadChildrenPath(threadId: string): string {
  return `${localRuntimeThreadPath(threadId)}/children`
}

export const LOCAL_RUNTIME_THREAD_CHILD_TRANSCRIPT_TEMPLATE = '/v1/threads/{id}/children/{child}/transcript'
export function localRuntimeThreadChildTranscriptPath(threadId: string, childId: string): string {
  return `${localRuntimeThreadChildrenPath(threadId)}/${encodeURIComponent(childId)}/transcript`
}

export const LOCAL_RUNTIME_APPROVAL_TEMPLATE = '/v1/approvals/{id}'
export function localRuntimeApprovalPath(approvalId: string): string {
  return `/v1/approvals/${encodeURIComponent(approvalId)}`
}

export const LOCAL_RUNTIME_USER_INPUT_TEMPLATE = '/v1/user-inputs/{id}'
export function localRuntimeUserInputPath(inputId: string): string {
  return `/v1/user-inputs/${encodeURIComponent(inputId)}`
}

export const LOCAL_RUNTIME_SESSION_RESUME_TEMPLATE = '/v1/sessions/{id}/resume-thread'
export function localRuntimeSessionResumePath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-thread`
}

export const LOCAL_RUNTIME_USAGE_PATH = '/v1/usage'
export const LOCAL_RUNTIME_USAGE_TEMPLATE = '/v1/usage'

/** Thread mode shared with the local runtime contract. */
export type LocalRuntimeThreadMode = 'agent' | 'plan'

const THREAD_MODES: ReadonlySet<LocalRuntimeThreadMode> = new Set<LocalRuntimeThreadMode>(['agent', 'plan'])

export function isLocalRuntimeThreadMode(value: unknown): value is LocalRuntimeThreadMode {
  return typeof value === 'string' && (THREAD_MODES as Set<string>).has(value)
}

export function normalizeThreadMode(value: unknown): LocalRuntimeThreadMode {
  return value === 'plan' ? 'plan' : 'agent'
}
