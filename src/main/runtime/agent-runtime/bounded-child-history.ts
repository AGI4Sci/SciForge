import {
  filterAgentRuntimeThreadChildren,
  isAgentRuntimeChildActive,
  type AgentRuntimeChild,
  type AgentRuntimeListThreadChildrenResponse,
  type AgentRuntimeThreadChildFilter
} from '../../../shared/agent-runtime-contract'

export const AGENT_RUNTIME_RECENT_CHILD_LIMIT = 200
export const AGENT_RUNTIME_CHILD_PAGE_LIMIT = 100
export const AGENT_RUNTIME_CHILD_CACHE_THREAD_LIMIT = 32

export class BoundedAgentRuntimeChildHistory {
  private readonly active = new Map<string, AgentRuntimeChild>()
  private readonly terminal = new Map<string, AgentRuntimeChild>()
  private terminalHistoryTruncated = false

  constructor(private readonly terminalLimit = AGENT_RUNTIME_RECENT_CHILD_LIMIT) {}

  upsert(child: AgentRuntimeChild): void {
    this.active.delete(child.id)
    this.terminal.delete(child.id)
    if (isAgentRuntimeChildActive(child)) this.active.set(child.id, child)
    else this.terminal.set(child.id, child)
    this.trimTerminalHistory()
  }

  delete(childId: string): void {
    this.active.delete(childId)
    this.terminal.delete(childId)
  }

  get(childId: string): AgentRuntimeChild | null {
    return this.active.get(childId) ?? this.terminal.get(childId) ?? null
  }

  values(): AgentRuntimeChild[] {
    return [...this.active.values(), ...this.terminal.values()].sort(compareChildrenNewest)
  }

  page(input: {
    runtimeId?: AgentRuntimeChild['runtimeId']
    threadId: string
    parentTurnId?: string
    activeOnly?: boolean
    cursor?: string
    limit?: number
  }): AgentRuntimeListThreadChildrenResponse {
    const filter: AgentRuntimeThreadChildFilter = {
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
      parentThreadId: input.threadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {})
    }
    const active = filterAgentRuntimeThreadChildren([...this.active.values()], filter)
      .sort(compareChildrenNewest)
    if (input.activeOnly) {
      return response(input, active, null, this.terminalHistoryTruncated, this.terminal.size)
    }
    const cursor = decodeChildCursor(input.cursor)
    const limit = Math.min(AGENT_RUNTIME_CHILD_PAGE_LIMIT, Math.max(1, Math.floor(input.limit ?? 40)))
    const terminal = filterAgentRuntimeThreadChildren([...this.terminal.values()], filter)
      .sort(compareChildrenNewest)
      .filter((child) => !cursor || compareChildWithCursor(child, cursor) > 0)
    const terminalPage = terminal.slice(0, limit)
    const hasMore = terminal.length > terminalPage.length
    return response(
      input,
      [...active, ...terminalPage],
      hasMore && terminalPage.length > 0 ? encodeChildCursor(terminalPage.at(-1)!) : null,
      this.terminalHistoryTruncated || hasMore,
      this.terminal.size
    )
  }

  get activeSize(): number {
    return this.active.size
  }

  get terminalSize(): number {
    return this.terminal.size
  }

  private trimTerminalHistory(): void {
    if (this.terminal.size <= this.terminalLimit) return
    this.terminalHistoryTruncated = true
    const retained = [...this.terminal.values()].sort(compareChildrenNewest).slice(0, this.terminalLimit)
    this.terminal.clear()
    for (const child of retained) this.terminal.set(child.id, child)
  }
}

export function touchBoundedThreadCache<Value>(
  cache: Map<string, Value>,
  threadId: string,
  value: Value,
  limit = AGENT_RUNTIME_CHILD_CACHE_THREAD_LIMIT
): void {
  cache.delete(threadId)
  cache.set(threadId, value)
  while (cache.size > limit) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) return
    cache.delete(oldest)
  }
}

type ChildCursor = { updatedAt: string; id: string }

function response(
  input: { runtimeId?: AgentRuntimeChild['runtimeId']; threadId: string; parentTurnId?: string },
  children: AgentRuntimeChild[],
  nextCursor: string | null,
  historyTruncated: boolean,
  retainedTerminalCount: number
): AgentRuntimeListThreadChildrenResponse {
  return {
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    threadId: input.threadId,
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    children,
    ...(nextCursor ? { nextCursor } : {}),
    metadata: {
      retainedTerminalCount,
      terminalHistoryLimit: AGENT_RUNTIME_RECENT_CHILD_LIMIT,
      historyTruncated
    }
  }
}

function childTimestamp(child: AgentRuntimeChild): string {
  return child.updatedAt || child.completedAt || child.startedAt || child.createdAt || ''
}

function compareChildrenNewest(left: AgentRuntimeChild, right: AgentRuntimeChild): number {
  return childTimestamp(right).localeCompare(childTimestamp(left)) || right.id.localeCompare(left.id)
}

function compareChildWithCursor(child: AgentRuntimeChild, cursor: ChildCursor): number {
  return cursor.updatedAt.localeCompare(childTimestamp(child)) || cursor.id.localeCompare(child.id)
}

function encodeChildCursor(child: AgentRuntimeChild): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt: childTimestamp(child), id: child.id }), 'utf8')
    .toString('base64url')
}

function decodeChildCursor(value: string | undefined): ChildCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (parsed.v !== 1 || typeof parsed.updatedAt !== 'string' || typeof parsed.id !== 'string') throw new Error()
    return { updatedAt: parsed.updatedAt, id: parsed.id }
  } catch {
    throw Object.assign(new Error('Invalid Agent Runtime child history cursor.'), {
      code: 'invalid_child_history_cursor'
    })
  }
}
