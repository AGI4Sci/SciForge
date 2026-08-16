import { ZulipProviderError } from './errors.js'

export type ZulipRateLimitOptions = {
  maxEvents: number
  windowMs: number
  maxSubjects?: number
  now?: () => number
}

type Window = { startedAt: number; count: number; lastSeenAt: number }

export class ZulipProviderRateLimiter {
  private readonly windows = new Map<string, Window>()
  private readonly maxEvents: number
  private readonly windowMs: number
  private readonly maxSubjects: number
  private readonly now: () => number

  constructor(options: ZulipRateLimitOptions) {
    if (!Number.isSafeInteger(options.maxEvents) || options.maxEvents < 1) {
      throw new TypeError('maxEvents must be a positive integer.')
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new TypeError('windowMs must be a positive integer.')
    }
    this.maxEvents = options.maxEvents
    this.windowMs = options.windowMs
    this.maxSubjects = options.maxSubjects ?? 10_000
    this.now = options.now ?? Date.now
  }

  consume(subject: string): void {
    const stableSubject = subject.trim()
    if (!stableSubject) throw new TypeError('A stable rate-limit subject is required.')
    const now = this.now()
    let window = this.windows.get(stableSubject)
    if (!window || now - window.startedAt >= this.windowMs) {
      window = { startedAt: now, count: 0, lastSeenAt: now }
      this.windows.set(stableSubject, window)
    }
    window.lastSeenAt = now
    if (window.count >= this.maxEvents) {
      throw new ZulipProviderError('rate_limited', 'Provider event rate limit exceeded.', {
        retryable: true,
        retryAfterMs: Math.max(1, this.windowMs - (now - window.startedAt))
      })
    }
    window.count += 1
    this.prune()
  }

  private prune(): void {
    if (this.windows.size <= this.maxSubjects) return
    const oldest = [...this.windows.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, this.windows.size - this.maxSubjects)
    for (const [subject] of oldest) this.windows.delete(subject)
  }
}
