type Waiter = {
  labId: string
  targetId: string
  labLimit: number
  targetLimit: number
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export class RemoteSshConcurrencyController {
  private activeGlobal = 0
  private readonly activeByLab = new Map<string, number>()
  private readonly activeByTarget = new Map<string, number>()
  private readonly waiters: Waiter[] = []
  private closed = false

  constructor(private readonly globalLimit: number) {
    if (!Number.isSafeInteger(globalLimit) || globalLimit < 1) {
      throw new Error('Global SSH concurrency limit must be a positive integer.')
    }
  }

  async run<T>(input: Readonly<{
    labId: string
    targetId: string
    labLimit: number
    targetLimit: number
    signal?: AbortSignal
  }>, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(input)
    try {
      return await task()
    } finally {
      release()
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const error = abortError('Remote SSH service is closed.')
    for (const waiter of this.waiters.splice(0)) {
      this.detachAbort(waiter)
      waiter.reject(error)
    }
  }

  private acquire(input: Omit<Waiter, 'resolve' | 'reject' | 'onAbort'>): Promise<() => void> {
    if (this.closed) return Promise.reject(abortError('Remote SSH service is closed.'))
    if (input.signal?.aborted) return Promise.reject(abortError())

    return new Promise((resolve, reject) => {
      const waiter: Waiter = { ...input, resolve, reject }
      if (input.signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          this.detachAbort(waiter)
          reject(abortError())
          this.drain()
        }
        input.signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
      this.drain()
    })
  }

  private drain(): void {
    if (this.closed) return
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index]
      if (!waiter) break
      if (waiter.signal?.aborted) {
        this.waiters.splice(index, 1)
        this.detachAbort(waiter)
        waiter.reject(abortError())
        continue
      }
      if (!this.canAcquire(waiter)) {
        index += 1
        continue
      }

      this.waiters.splice(index, 1)
      this.detachAbort(waiter)
      this.activeGlobal += 1
      this.activeByLab.set(waiter.labId, (this.activeByLab.get(waiter.labId) ?? 0) + 1)
      this.activeByTarget.set(waiter.targetId, (this.activeByTarget.get(waiter.targetId) ?? 0) + 1)
      let released = false
      waiter.resolve(() => {
        if (released) return
        released = true
        this.activeGlobal -= 1
        decrement(this.activeByLab, waiter.labId)
        decrement(this.activeByTarget, waiter.targetId)
        this.drain()
      })
    }
  }

  private canAcquire(waiter: Waiter): boolean {
    return this.activeGlobal < this.globalLimit &&
      (this.activeByLab.get(waiter.labId) ?? 0) < waiter.labLimit &&
      (this.activeByTarget.get(waiter.targetId) ?? 0) < waiter.targetLimit
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
  }
}

function decrement(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 1) - 1
  if (next <= 0) counts.delete(key)
  else counts.set(key, next)
}

function abortError(message = 'The operation was cancelled.'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
