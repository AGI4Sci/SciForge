import { describe, expect, it, vi } from 'vitest'
import { EventDrivenAgentRunner } from '../src/loop/event-driven-agent-runner.js'

describe('EventDrivenAgentRunner', () => {
  it('re-enters through the safe boundary before each atomic step', async () => {
    const order: string[] = []
    const runner = new EventDrivenAgentRunner({
      signal: new AbortController().signal,
      maxIterations: 4,
      beforeStep: async (step) => {
        order.push(`before:${step}`)
      },
      step: async (step) => {
        order.push(`step:${step}`)
        return step === 1 ? 'stop' : 'continue'
      },
      onIterationLimit: vi.fn()
    })

    await expect(runner.run()).resolves.toBe('completed')
    expect(order).toEqual(['before:0', 'step:0', 'before:1', 'step:1'])
  })

  it('terminates without another model step when a boundary guard fires', async () => {
    const step = vi.fn(async () => 'continue' as const)
    const runner = new EventDrivenAgentRunner({
      signal: new AbortController().signal,
      maxIterations: 4,
      beforeStep: async () => ({ kind: 'terminate', status: 'failed' }),
      step,
      onIterationLimit: vi.fn()
    })

    await expect(runner.run()).resolves.toBe('failed')
    expect(step).not.toHaveBeenCalled()
  })

  it('reports the explicit iteration limit instead of silently completing', async () => {
    const onIterationLimit = vi.fn(async () => undefined)
    const runner = new EventDrivenAgentRunner({
      signal: new AbortController().signal,
      maxIterations: 2,
      step: async () => 'continue',
      onIterationLimit
    })

    await expect(runner.run()).resolves.toBe('failed')
    expect(onIterationLimit).toHaveBeenCalledWith(2)
  })

  it('honors interruption at a safe boundary', async () => {
    const controller = new AbortController()
    const step = vi.fn(async () => 'continue' as const)
    const runner = new EventDrivenAgentRunner({
      signal: controller.signal,
      maxIterations: 2,
      beforeStep: async () => {
        controller.abort()
      },
      step,
      onIterationLimit: vi.fn()
    })

    await expect(runner.run()).resolves.toBe('aborted')
    expect(step).not.toHaveBeenCalled()
  })

  it('lets an abort win when it races with a final step result', async () => {
    const controller = new AbortController()
    const runner = new EventDrivenAgentRunner({
      signal: controller.signal,
      maxIterations: 2,
      step: async () => {
        controller.abort()
        return 'stop'
      },
      onIterationLimit: vi.fn()
    })

    await expect(runner.run()).resolves.toBe('aborted')
  })
})
