/**
 * Mid-turn steering queue. The renderer posts steering text while a
 * turn is running; the queue collects those messages and injects them
 * as user inputs at the next safe loop boundary. The queue is cleared
 * on turn completion or interruption.
 */
export class SteeringQueue {
  private readonly buffers = new Map<string, string[]>()
  private defaultTurnId: string | null = null

  setTurn(turnId: string | null): void {
    if (turnId === null) {
      this.clear()
      return
    }
    if (!this.buffers.has(turnId)) this.buffers.set(turnId, [])
    this.defaultTurnId = turnId
  }

  enqueue(turnId: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const buffer = this.buffers.get(turnId) ?? []
    buffer.push(trimmed)
    this.buffers.set(turnId, buffer)
    this.defaultTurnId = turnId
  }

  /**
   * Drain queued steering messages and return them. The loop calls
   * this at safe boundaries (after a model response, before the next
   * model request). Returns an empty array when nothing is pending.
   */
  drain(turnId = this.defaultTurnId): string[] {
    if (!turnId) return []
    const buffer = this.buffers.get(turnId)
    if (!buffer?.length) return []
    const out = [...buffer]
    buffer.length = 0
    return out
  }

  /**
   * Peek at the queued text without removing it. Used by the UI to
   * show pending steering in a "pending injection" indicator.
   */
  peek(turnId = this.defaultTurnId): string[] {
    if (!turnId) return []
    return [...(this.buffers.get(turnId) ?? [])]
  }

  clear(turnId?: string): void {
    if (turnId === undefined) {
      this.buffers.clear()
      this.defaultTurnId = null
      return
    }
    this.buffers.delete(turnId)
    if (this.defaultTurnId === turnId) {
      this.defaultTurnId = [...this.buffers.keys()].at(-1) ?? null
    }
  }
}
