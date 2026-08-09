import {
  isAgentRuntimeTerminalTurnState,
  normalizeAgentRuntimeTurnState,
  type AgentRuntimeChild
} from '@shared/agent-runtime-contract'
import type {
  ApprovalRequestPayload,
  ChatBlock,
  ThreadEventSink,
  UserInputRequestPayload,
  UserInputStatusPayload
} from '../../agent/types'

export type ChildAgentAttentionKind =
  | 'waiting_user_input'
  | 'waiting_approval'
  | 'failed'
  | 'unread'
  | 'running'
  | 'idle'

export type ChildAgentAttentionPathNode = {
  threadId: string
  label: string
}

export type ChildAgentAttentionSnapshot = {
  threadId: string
  blocks: ChatBlock[]
  /** Last event sequence already applied to `blocks`. */
  latestSeq: number
  threadStatus?: string
  unread?: boolean
}

export type ChildAgentAttentionTarget = {
  /** The thread whose child list contains this child. */
  parentThreadId: string
  childId: string
  /** Present when the runtime exposes the child as an independently readable thread. */
  threadId?: string
  runtimeId: AgentRuntimeChild['runtimeId']
  label: string
  path: ChildAgentAttentionPathNode[]
  attention: ChildAgentAttentionKind
  waitingUserInputBlockIds: string[]
  waitingApprovalBlockIds: string[]
  failed: boolean
  unread: boolean
  running: boolean
}

export type ChildAgentAttentionSummary = {
  targets: ChildAgentAttentionTarget[]
  actionableTargets: ChildAgentAttentionTarget[]
  counts: {
    total: number
    waitingUserInput: number
    waitingApproval: number
    failed: number
    unread: number
    running: number
  }
  /** The highest-priority destination for a global attention badge click. */
  primaryTarget: ChildAgentAttentionTarget | null
}

export type ChildAgentAttentionTreeLoadResult = {
  children: AgentRuntimeChild[]
  snapshots: Record<string, ChildAgentAttentionSnapshot>
  degraded: boolean
  errors: Array<{ threadId: string; operation: 'children' | 'detail' | 'status'; message: string }>
}

export type ChildAgentAttentionDataSource = {
  listThreadChildren: (
    threadId: string,
    options?: { limit?: number }
  ) => Promise<{ children?: AgentRuntimeChild[] }>
  getRecentThreadView: (threadId: string) => Promise<{
    blocks: ChatBlock[]
    latestSeq: number
    threadStatus?: string
  }>
  getThreadStatus?: (threadId: string) => Promise<{
    latestSeq: number
    threadStatus?: string
    latestTurnStatus?: string
  }>
  rememberThreadRuntime?: (threadId: string, runtimeId?: AgentRuntimeChild['runtimeId']) => void
}

const ATTENTION_PRIORITY: Record<ChildAgentAttentionKind, number> = {
  waiting_user_input: 0,
  waiting_approval: 1,
  failed: 2,
  unread: 3,
  running: 4,
  idle: 5
}

function childThreadId(child: AgentRuntimeChild): string | undefined {
  return child.openAsThreadRef?.threadId?.trim() || undefined
}

function childIdentity(child: AgentRuntimeChild): string {
  return childThreadId(child) ?? `${child.runtimeId}:${child.parentThreadId}:${child.id}`
}

function childLabel(child: AgentRuntimeChild): string {
  return child.label?.trim()
    || child.name?.trim()
    || child.openAsThreadRef?.title?.trim()
    || childThreadId(child)
    || child.id
}

function normalizedTerminalFailure(status: string | undefined): boolean {
  switch (status?.trim().toLowerCase()) {
    case 'failed':
    case 'error':
    case 'errored':
      return true
    default:
      return false
  }
}

function normalizedRunning(status: string | undefined): boolean {
  switch (status?.trim().toLowerCase()) {
    case 'queued':
    case 'running':
    case 'in_progress':
    case 'started':
      return true
    default:
      return false
  }
}

function pendingBlockIds(blocks: readonly ChatBlock[], kind: 'approval' | 'user_input'): string[] {
  return blocks
    .filter((block) => block.kind === kind && block.status === 'pending')
    .map((block) => block.id)
}

function targetAttention(input: Omit<ChildAgentAttentionTarget, 'attention'>): ChildAgentAttentionKind {
  if (input.waitingUserInputBlockIds.length > 0) return 'waiting_user_input'
  if (input.waitingApprovalBlockIds.length > 0) return 'waiting_approval'
  if (input.failed) return 'failed'
  if (input.unread) return 'unread'
  if (input.running) return 'running'
  return 'idle'
}

function compareTargets(left: ChildAgentAttentionTarget, right: ChildAgentAttentionTarget): number {
  const priority = ATTENTION_PRIORITY[left.attention] - ATTENTION_PRIORITY[right.attention]
  if (priority !== 0) return priority
  const depth = right.path.length - left.path.length
  if (depth !== 0) return depth
  return left.label.localeCompare(right.label)
}

/**
 * Computes attention state from runtime child status plus the child's real normalized
 * chat blocks. In particular, a running child is never treated as waiting for the
 * user unless a pending `approval` or `user_input` block exists.
 */
export function buildChildAgentAttentionSummary(input: {
  rootThreadId: string
  rootLabel?: string
  children: readonly AgentRuntimeChild[]
  snapshots?: Readonly<Record<string, ChildAgentAttentionSnapshot | undefined>>
  unreadThreadIds?: Readonly<Record<string, boolean>>
}): ChildAgentAttentionSummary {
  const rootThreadId = input.rootThreadId.trim()
  if (!rootThreadId) {
    return {
      targets: [],
      actionableTargets: [],
      counts: { total: 0, waitingUserInput: 0, waitingApproval: 0, failed: 0, unread: 0, running: 0 },
      primaryTarget: null
    }
  }

  const childrenByParent = new Map<string, AgentRuntimeChild[]>()
  const seenIdentities = new Set<string>()
  for (const child of input.children) {
    const parentThreadId = child.parentThreadId.trim()
    if (!parentThreadId) continue
    const identity = childIdentity(child)
    if (seenIdentities.has(identity)) continue
    seenIdentities.add(identity)
    const siblings = childrenByParent.get(parentThreadId)
    if (siblings) siblings.push(child)
    else childrenByParent.set(parentThreadId, [child])
  }

  const targets: ChildAgentAttentionTarget[] = []
  const visitedThreads = new Set<string>([rootThreadId])
  const visit = (parentThreadId: string, path: ChildAgentAttentionPathNode[]): void => {
    for (const child of childrenByParent.get(parentThreadId) ?? []) {
      const threadId = childThreadId(child)
      const label = childLabel(child)
      const nextPath = threadId ? [...path, { threadId, label }] : path
      const snapshot = threadId ? input.snapshots?.[threadId] : undefined
      const blocks = snapshot?.blocks ?? []
      const waitingUserInputBlockIds = pendingBlockIds(blocks, 'user_input')
      const waitingApprovalBlockIds = pendingBlockIds(blocks, 'approval')
      const failed = child.status === 'failed' || normalizedTerminalFailure(snapshot?.threadStatus)
      const unread = Boolean(threadId && (snapshot?.unread || input.unreadThreadIds?.[threadId]))
      const running = child.status === 'queued'
        || child.status === 'running'
        || normalizedRunning(snapshot?.threadStatus)
      const targetBase = {
        parentThreadId,
        childId: child.id,
        ...(threadId ? { threadId } : {}),
        runtimeId: child.runtimeId,
        label,
        path: nextPath,
        waitingUserInputBlockIds,
        waitingApprovalBlockIds,
        failed,
        unread,
        running
      }
      targets.push({ ...targetBase, attention: targetAttention(targetBase) })

      if (threadId && !visitedThreads.has(threadId)) {
        visitedThreads.add(threadId)
        visit(threadId, nextPath)
      }
    }
  }

  visit(rootThreadId, [{ threadId: rootThreadId, label: input.rootLabel?.trim() || rootThreadId }])
  const actionableTargets = targets.filter((target) => target.attention !== 'idle').sort(compareTargets)
  return {
    targets,
    actionableTargets,
    counts: {
      total: targets.length,
      waitingUserInput: targets.filter((target) => target.waitingUserInputBlockIds.length > 0).length,
      waitingApproval: targets.filter((target) => target.waitingApprovalBlockIds.length > 0).length,
      failed: targets.filter((target) => target.failed).length,
      unread: targets.filter((target) => target.unread).length,
      running: targets.filter((target) => target.running).length
    },
    primaryTarget: actionableTargets[0] ?? null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function settlePendingInteractions(blocks: readonly ChatBlock[]): ChatBlock[] {
  let changed = false
  const next = blocks.map((block): ChatBlock => {
    if (block.kind === 'approval' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'error' }
    }
    if (block.kind === 'user_input' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'cancelled' }
    }
    return block
  })
  return changed ? next : blocks as ChatBlock[]
}

export function updateChildAgentAttentionStatus(
  snapshot: ChildAgentAttentionSnapshot,
  status: string | undefined
): ChildAgentAttentionSnapshot {
  const normalized = normalizeAgentRuntimeTurnState(status)
  const blocks = isAgentRuntimeTerminalTurnState(normalized)
    ? settlePendingInteractions(snapshot.blocks)
    : snapshot.blocks
  return {
    ...snapshot,
    blocks,
    ...(status ? { threadStatus: status } : {})
  }
}

function upsertApproval(
  blocks: readonly ChatBlock[],
  request: ApprovalRequestPayload
): ChatBlock[] {
  const status = request.status ?? 'pending'
  const existingIndex = blocks.findIndex(
    (block) => block.kind === 'approval' && block.approvalId === request.approvalId
  )
  if (existingIndex < 0) {
    return [...blocks, {
      kind: 'approval',
      id: `approval-${request.approvalId}`,
      approvalId: request.approvalId,
      summary: request.summary,
      toolName: request.toolName,
      status,
      errorMessage: request.errorMessage,
      meta: request.meta
    }]
  }
  const existing = blocks[existingIndex]
  if (existing.kind !== 'approval') return blocks as ChatBlock[]
  const next = [...blocks]
  next[existingIndex] = {
    ...existing,
    summary: request.summary || existing.summary,
    toolName: request.toolName ?? existing.toolName,
    status,
    errorMessage: request.errorMessage ?? existing.errorMessage,
    meta: request.meta ?? existing.meta
  }
  return next
}

function upsertUserInput(
  blocks: readonly ChatBlock[],
  request: UserInputRequestPayload
): ChatBlock[] {
  const existingIndex = blocks.findIndex(
    (block) => block.kind === 'user_input' && block.requestId === request.requestId
  )
  if (existingIndex < 0) {
    return [...blocks, {
      kind: 'user_input',
      id: request.itemId,
      requestId: request.requestId,
      questions: request.questions,
      status: 'pending'
    }]
  }
  const existing = blocks[existingIndex]
  if (existing.kind !== 'user_input') return blocks as ChatBlock[]
  const next = [...blocks]
  next[existingIndex] = {
    ...existing,
    id: request.itemId,
    questions: request.questions.length > 0 ? request.questions : existing.questions
  }
  return next
}

function updateUserInputStatus(
  blocks: readonly ChatBlock[],
  event: UserInputStatusPayload
): ChatBlock[] {
  let changed = false
  const next = blocks.map((block): ChatBlock => {
    if (block.kind !== 'user_input'
      || (block.id !== event.itemId && block.requestId !== event.itemId)) return block
    changed = true
    return {
      ...block,
      status: event.status,
      answers: event.answers ?? block.answers,
      errorMessage: event.errorMessage ?? block.errorMessage
    }
  })
  return changed ? next : blocks as ChatBlock[]
}

/**
 * Builds a narrow event sink for child-attention state. The sink never accumulates
 * assistant/tool output; it only advances the replay cursor and updates interaction
 * or lifecycle state that can change the global attention badge.
 */
export function createChildAgentAttentionEventSink(input: {
  threadId: string
  getSnapshot: () => ChildAgentAttentionSnapshot | undefined
  updateSnapshot: (
    snapshot: ChildAgentAttentionSnapshot,
    attentionChanged: boolean
  ) => void
  onChildChanged?: () => void
  onError?: (error: Error) => void
}): ThreadEventSink {
  const update = (
    updater: (snapshot: ChildAgentAttentionSnapshot) => ChildAgentAttentionSnapshot,
    attentionChanged: boolean
  ): void => {
    const snapshot = input.getSnapshot()
    if (!snapshot) return
    input.updateSnapshot(updater(snapshot), attentionChanged)
  }

  return {
    onSeq: (seq) => update(
      (snapshot) => ({ ...snapshot, latestSeq: Math.max(snapshot.latestSeq, seq) }),
      false
    ),
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: (request) => update(
      (snapshot) => ({ ...snapshot, blocks: upsertApproval(snapshot.blocks, request) }),
      true
    ),
    onUserInput: (request) => update(
      (snapshot) => ({ ...snapshot, blocks: upsertUserInput(snapshot.blocks, request) }),
      true
    ),
    onUserInputStatus: (event) => update(
      (snapshot) => ({ ...snapshot, blocks: updateUserInputStatus(snapshot.blocks, event) }),
      true
    ),
    onTurnLifecycle: (event) => update(
      (snapshot) => updateChildAgentAttentionStatus(snapshot, event.state),
      true
    ),
    onChild: () => input.onChildChanged?.(),
    onGoal: () => undefined,
    onTurnComplete: () => update(
      (snapshot) => updateChildAgentAttentionStatus(snapshot, 'completed'),
      true
    ),
    onError: (error) => input.onError?.(error)
  }
}

/**
 * Loads every reachable child level without assuming a fixed depth. Safety limits
 * bound corrupt/cyclic runtime data; normal recursion is limited only by `maxThreads`.
 */
export async function loadChildAgentAttentionTree(input: {
  rootThreadId: string
  source: ChildAgentAttentionDataSource
  cachedSnapshots?: Readonly<Record<string, ChildAgentAttentionSnapshot | undefined>>
  detailAttemptedThreadIds?: Set<string>
  maxThreads?: number
  childrenPerThread?: number
  shouldReadDetail?: (child: AgentRuntimeChild) => boolean
}): Promise<ChildAgentAttentionTreeLoadResult> {
  const rootThreadId = input.rootThreadId.trim()
  const maxThreads = Math.max(1, Math.floor(input.maxThreads ?? 250))
  const childrenPerThread = Math.max(1, Math.floor(input.childrenPerThread ?? 100))
  const queue = rootThreadId ? [rootThreadId] : []
  const visited = new Set<string>()
  const children: AgentRuntimeChild[] = []
  const snapshots: Record<string, ChildAgentAttentionSnapshot> = {}
  const errors: ChildAgentAttentionTreeLoadResult['errors'] = []

  while (queue.length > 0 && visited.size < maxThreads) {
    const parentThreadId = queue.shift()
    if (!parentThreadId || visited.has(parentThreadId)) continue
    visited.add(parentThreadId)

    let directChildren: AgentRuntimeChild[] = []
    try {
      const response = await input.source.listThreadChildren(parentThreadId, { limit: childrenPerThread })
      directChildren = response.children ?? []
      children.push(...directChildren)
    } catch (error) {
      errors.push({ threadId: parentThreadId, operation: 'children', message: errorMessage(error) })
      continue
    }

    for (const child of directChildren) {
      const threadId = childThreadId(child)
      if (!threadId || visited.has(threadId) || queue.includes(threadId)) continue
      input.source.rememberThreadRuntime?.(threadId, child.openAsThreadRef?.runtimeId ?? child.runtimeId)
      const cachedSnapshot = input.cachedSnapshots?.[threadId]
      if (cachedSnapshot) {
        snapshots[threadId] = updateChildAgentAttentionStatus(cachedSnapshot, child.status)
      }
      if (!input.shouldReadDetail || input.shouldReadDetail(child)) {
        if (!cachedSnapshot && !input.detailAttemptedThreadIds?.has(threadId)) {
          input.detailAttemptedThreadIds?.add(threadId)
          try {
            const detail = await input.source.getRecentThreadView(threadId)
            snapshots[threadId] = {
              threadId,
              blocks: detail.blocks,
              latestSeq: detail.latestSeq,
              threadStatus: detail.threadStatus
            }
          } catch (error) {
            errors.push({ threadId, operation: 'detail', message: errorMessage(error) })
          }
        } else if (cachedSnapshot && input.source.getThreadStatus) {
          try {
            const status = await input.source.getThreadStatus(threadId)
            snapshots[threadId] = updateChildAgentAttentionStatus(
              snapshots[threadId] ?? cachedSnapshot,
              status.latestTurnStatus ?? status.threadStatus
            )
          } catch (error) {
            errors.push({ threadId, operation: 'status', message: errorMessage(error) })
          }
        }
      }
      queue.push(threadId)
    }
  }

  return {
    children,
    snapshots,
    degraded: errors.length > 0 || queue.length > 0,
    errors
  }
}
