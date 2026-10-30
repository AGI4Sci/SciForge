import { describe, expect, it } from 'vitest'
import {
  CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS,
  CLAUDE_CODE_MAX_CONCURRENT_TURNS_ENV,
  ClaudeCodeTurnConcurrencyGate,
  resolveClaudeCodeMaxConcurrentTurns
} from './claude-code-turn-concurrency'

describe('resolveClaudeCodeMaxConcurrentTurns', () => {
  it('defaults to 3 and honors a positive integer environment override', () => {
    expect(resolveClaudeCodeMaxConcurrentTurns({})).toBe(CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS)
    expect(CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS).toBe(3)
    expect(resolveClaudeCodeMaxConcurrentTurns({
      [CLAUDE_CODE_MAX_CONCURRENT_TURNS_ENV]: '5'
    })).toBe(5)
  })

  it('falls back to the default for missing or invalid overrides', () => {
    for (const value of ['', '0', '-2', '2.5', 'many']) {
      expect(resolveClaudeCodeMaxConcurrentTurns({
        [CLAUDE_CODE_MAX_CONCURRENT_TURNS_ENV]: value
      })).toBe(CLAUDE_CODE_DEFAULT_MAX_CONCURRENT_TURNS)
    }
  })
})

describe('ClaudeCodeTurnConcurrencyGate', () => {
  it('admits up to the limit, queues the rest in FIFO order, and ignores double release', async () => {
    const gate = new ClaudeCodeTurnConcurrencyGate(2)
    const first = await gate.acquire()
    const second = await gate.acquire()
    expect(gate.active).toBe(2)
    expect(gate.saturated).toBe(true)

    const order: string[] = []
    const third = gate.acquire().then((slot) => {
      order.push('third')
      return slot
    })
    const fourth = gate.acquire().then((slot) => {
      order.push('fourth')
      return slot
    })
    expect(gate.queued).toBe(2)

    first.release()
    const thirdSlot = await third
    expect(order).toEqual(['third'])
    expect(gate.active).toBe(2)

    first.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['third'])
    expect(gate.active).toBe(2)

    second.release()
    await fourth
    expect(order).toEqual(['third', 'fourth'])
    thirdSlot.release()
    expect(gate.active).toBe(1)
    expect(gate.queued).toBe(0)
  })
})
