export type RightPanelContextStateKeyInput = {
  mode: string
  workspaceRoot?: string | null
  threadId?: string | null
  resourceId?: string | null
}

export type RememberedPdfViewState = {
  currentPage: number
  scale: number
  searchQuery: string
  scrollTop?: number
}

export type RememberedChildAgentsViewState = {
  parentThreadPath: string[]
  selectedChildId: string | null
  draftByThreadId?: Record<string, string>
  scrollTopByThreadId?: Record<string, number>
}

export type RememberedFileViewState = {
  targetPath: string | null
  directoryPath?: string | null
  scrollTop?: number
  selection?: string | null
}

type StoredState = object

const DEFAULT_CONTEXT_STATE_LIMIT = 120

function normalizedPart(value: string | null | undefined): string {
  return encodeURIComponent(value?.trim() || '-')
}

export function rightPanelContextStateKey(input: RightPanelContextStateKeyInput): string {
  return [
    normalizedPart(input.mode),
    normalizedPart(input.workspaceRoot),
    normalizedPart(input.threadId),
    normalizedPart(input.resourceId)
  ].join('|')
}

/**
 * An in-memory, bounded context cache intentionally shared across panel mounts.
 * Right-panel modes are conditionally rendered, so component-local state otherwise
 * disappears every time the user checks a file, a child agent, or another context.
 *
 * State is not written to localStorage: drafts, selections, and paths may be
 * sensitive and only need to survive view switching within the current app session.
 */
export class RightPanelContextStateMemory {
  private readonly states = new Map<string, StoredState>()

  constructor(private readonly limit = DEFAULT_CONTEXT_STATE_LIMIT) {}

  read<T extends StoredState>(key: string | null | undefined): T | null {
    const normalizedKey = key?.trim()
    if (!normalizedKey) return null
    const value = this.states.get(normalizedKey)
    if (!value) return null
    // Refresh insertion order so actively used contexts survive bounded eviction.
    this.states.delete(normalizedKey)
    this.states.set(normalizedKey, value)
    return { ...value } as T
  }

  remember<T extends StoredState>(key: string | null | undefined, patch: Partial<T>): T | null {
    const normalizedKey = key?.trim()
    if (!normalizedKey) return null
    const current = this.states.get(normalizedKey) ?? {}
    const next = { ...current, ...patch } as StoredState
    this.states.delete(normalizedKey)
    this.states.set(normalizedKey, next)
    this.evictOverflow()
    return { ...next } as T
  }

  forget(key: string | null | undefined): void {
    const normalizedKey = key?.trim()
    if (normalizedKey) this.states.delete(normalizedKey)
  }

  forgetThread(threadId: string | null | undefined): void {
    const normalizedThread = normalizedPart(threadId)
    if (normalizedThread === '-') return
    for (const key of this.states.keys()) {
      if (key.split('|')[2] === normalizedThread) this.states.delete(key)
    }
  }

  moveThread(
    previousThreadId: string | null | undefined,
    nextThreadId: string | null | undefined
  ): void {
    const previousThread = normalizedPart(previousThreadId)
    const nextThread = normalizedPart(nextThreadId)
    if (previousThread === '-' || nextThread === '-' || previousThread === nextThread) return
    for (const [key, value] of [...this.states.entries()]) {
      const parts = key.split('|')
      if (parts[2] !== previousThread) continue
      parts[2] = nextThread
      this.states.delete(key)
      this.states.set(parts.join('|'), value)
    }
    this.evictOverflow()
  }

  clear(): void {
    this.states.clear()
  }

  get size(): number {
    return this.states.size
  }

  private evictOverflow(): void {
    const boundedLimit = Math.max(1, Math.floor(this.limit))
    while (this.states.size > boundedLimit) {
      const oldest = this.states.keys().next().value
      if (typeof oldest !== 'string') break
      this.states.delete(oldest)
    }
  }
}

export const rightPanelContextStateMemory = new RightPanelContextStateMemory()

export function readRightPanelContextState<T extends StoredState>(
  key: string | null | undefined
): T | null {
  return rightPanelContextStateMemory.read<T>(key)
}

export function rememberRightPanelContextState<T extends StoredState>(
  key: string | null | undefined,
  patch: Partial<T>
): T | null {
  return rightPanelContextStateMemory.remember<T>(key, patch)
}

export function forgetRightPanelContextStateForSession(sessionId: string): void {
  rightPanelContextStateMemory.forgetThread(sessionId)
}

export function moveRightPanelContextStateOwner(
  previousSessionId: string,
  nextSessionId: string
): void {
  rightPanelContextStateMemory.moveThread(previousSessionId, nextSessionId)
}
