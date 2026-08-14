export type EphemeralThreadOwnershipSnapshot = Readonly<{
  roots: number
  threads: number
  pendingCreations: number
  backgroundTasks: number
}>

type Ownership = {
  state: 'active' | 'closing'
  parentByThread: Map<string, string | null>
  pendingCreations: Set<Promise<void>>
  backgroundTasks: Set<Promise<void>>
}

export class EphemeralThreadOwnershipRegistry {
  private readonly ownershipByRoot = new Map<string, Ownership>()
  private readonly rootByThread = new Map<string, string>()

  registerRoot(threadId: string): void {
    const id = requiredId(threadId)
    if (this.rootByThread.has(id)) throw new Error(`Ephemeral thread ${id} is already owned.`)
    this.ownershipByRoot.set(id, {
      state: 'active',
      parentByThread: new Map([[id, null]]),
      pendingCreations: new Set(),
      backgroundTasks: new Set()
    })
    this.rootByThread.set(id, id)
  }

  owns(threadId: string): boolean {
    return this.rootByThread.has(threadId.trim())
  }

  assertAcceptingWork(threadId: string): void {
    const rootId = this.rootByThread.get(requiredId(threadId))
    if (!rootId) return
    if (this.requireOwnership(rootId).state !== 'active') {
      throw new Error(`Ephemeral ownership ${rootId} is closing and cannot start background work.`)
    }
  }

  beginChildCreation(parentThreadId: string): Readonly<{
    register: (threadId: string) => void
    trackBackgroundTask: (task: Promise<unknown>) => void
    settle: () => void
  }> | null {
    const parentId = requiredId(parentThreadId)
    const rootId = this.rootByThread.get(parentId)
    if (!rootId) return null
    const ownership = this.requireOwnership(rootId)
    if (ownership.state !== 'active') {
      throw new Error(`Ephemeral ownership ${rootId} is closing and cannot create another child.`)
    }
    let resolvePending!: () => void
    const pending = new Promise<void>((resolve) => { resolvePending = resolve })
    ownership.pendingCreations.add(pending)
    let settled = false
    return Object.freeze({
      register: (threadId: string): void => {
        const id = requiredId(threadId)
        if (this.rootByThread.has(id)) throw new Error(`Ephemeral thread ${id} is already owned.`)
        ownership.parentByThread.set(id, parentId)
        this.rootByThread.set(id, rootId)
      },
      trackBackgroundTask: (task: Promise<unknown>): void => {
        this.rememberBackgroundTask(ownership, task)
      },
      settle: (): void => {
        if (settled) return
        settled = true
        ownership.pendingCreations.delete(pending)
        resolvePending()
      }
    })
  }

  trackBackgroundTask(threadId: string, task: Promise<unknown>): void {
    const rootId = this.rootByThread.get(requiredId(threadId))
    if (!rootId) return
    const ownership = this.requireOwnership(rootId)
    if (ownership.state !== 'active') {
      throw new Error(`Ephemeral ownership ${rootId} is closing and cannot start background work.`)
    }
    this.rememberBackgroundTask(ownership, task)
  }

  async beginReclaim(rootThreadId: string): Promise<Readonly<{
    rootThreadId: string
    childThreadIds: readonly string[]
    backgroundTasks: readonly Promise<void>[]
  }>> {
    const rootId = requiredId(rootThreadId)
    if (this.rootByThread.get(rootId) !== rootId) {
      throw new Error(`Thread ${rootId} is not a runtime-owned ephemeral root.`)
    }
    const ownership = this.requireOwnership(rootId)
    ownership.state = 'closing'
    await Promise.allSettled([...ownership.pendingCreations])
    const depth = (threadId: string): number => {
      let current = ownership.parentByThread.get(threadId)
      let value = 0
      while (current) {
        value += 1
        current = ownership.parentByThread.get(current) ?? null
      }
      return value
    }
    const childThreadIds = [...ownership.parentByThread.keys()]
      .filter((threadId) => threadId !== rootId)
      .sort((left, right) => depth(right) - depth(left))
    return Object.freeze({
      rootThreadId: rootId,
      childThreadIds,
      backgroundTasks: [...ownership.backgroundTasks]
    })
  }

  completeReclaim(rootThreadId: string): void {
    const rootId = requiredId(rootThreadId)
    const ownership = this.requireOwnership(rootId)
    for (const threadId of ownership.parentByThread.keys()) this.rootByThread.delete(threadId)
    this.ownershipByRoot.delete(rootId)
  }

  snapshot(): EphemeralThreadOwnershipSnapshot {
    let threads = 0
    let pendingCreations = 0
    let backgroundTasks = 0
    for (const ownership of this.ownershipByRoot.values()) {
      threads += ownership.parentByThread.size
      pendingCreations += ownership.pendingCreations.size
      backgroundTasks += ownership.backgroundTasks.size
    }
    return Object.freeze({ roots: this.ownershipByRoot.size, threads, pendingCreations, backgroundTasks })
  }

  private requireOwnership(rootId: string): Ownership {
    const ownership = this.ownershipByRoot.get(rootId)
    if (!ownership) throw new Error(`Ephemeral ownership ${rootId} does not exist.`)
    return ownership
  }

  private rememberBackgroundTask(ownership: Ownership, task: Promise<unknown>): void {
    const settled = task.then(() => undefined, () => undefined)
    ownership.backgroundTasks.add(settled)
    void settled.finally(() => ownership.backgroundTasks.delete(settled))
  }
}

function requiredId(value: string): string {
  const id = value.trim()
  if (!id) throw new Error('Ephemeral ownership requires a non-empty thread id.')
  return id
}
