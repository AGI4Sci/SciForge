export const CLAUDE_CODE_MAX_CONCURRENT_TURNS_ENV = 'SCIFORGE_CLAUDE_CODE_MAX_CONCURRENT_TURNS'
export const CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS = 3

export function resolveClaudeCodeMaxConcurrentTurns(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env[CLAUDE_CODE_MAX_CONCURRENT_TURNS_ENV]?.trim()
  if (!raw) return CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS
}

export type ClaudeCodeTurnSlot = {
  /** Idempotent: extra release calls are no-ops. */
  release(): void
}

/**
 * Bounds how many Claude Code turns (each backed by a CLI subprocess) run at
 * once. Callers beyond the cap wait in FIFO order until a slot is released.
 */
export class ClaudeCodeTurnConcurrencyGate {
  private activeCount = 0
  private readonly waiters: Array<() => void> = []

  constructor(readonly maxConcurrent: number) {}

  get active(): number {
    return this.activeCount
  }

  get queued(): number {
    return this.waiters.length
  }

  get saturated(): boolean {
    return this.activeCount >= this.maxConcurrent
  }

  async acquire(): Promise<ClaudeCodeTurnSlot> {
    if (this.saturated) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
    this.activeCount += 1
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.activeCount -= 1
        this.waiters.shift()?.()
      }
    }
  }
}
