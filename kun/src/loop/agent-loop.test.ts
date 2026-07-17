import { describe, expect, it, vi } from 'vitest'
import { AgentLoop } from './agent-loop.js'

type DispatchOutcome =
  | { kind: 'aborted' }
  | {
      kind: 'continue'
      executedCount: number
      successCount: number
      errorCount: number
      suppressedCount: number
    }
  | { kind: 'all_suppressed'; suppressedCount: number }

describe('AgentLoop tool-loop recovery state', () => {
  it('clears recovery after successful tool progress', async () => {
    const { handle, turns } = createToolLoopHarness()

    await expect(handle({ kind: 'all_suppressed', suppressedCount: 1 }, 1)).resolves.toBe('continue')
    await expect(handle(successfulToolOutcome(), 2)).resolves.toBe('continue')
    await expect(handle(successfulToolOutcome(), 4)).resolves.toBe('continue')

    expect(turns.applyItem).not.toHaveBeenCalled()
  })

  it('requests resumable finalization after repeated suppressed calls', async () => {
    const { handle, turns } = createToolLoopHarness()

    await expect(handle({ kind: 'all_suppressed', suppressedCount: 1 }, 1)).resolves.toBe('continue')
    await expect(handle({ kind: 'all_suppressed', suppressedCount: 1 }, 2)).resolves.toBe('continue')

    expect(turns.applyItem).toHaveBeenCalledTimes(1)
    expect(turns.applyItem).toHaveBeenCalledWith(
      'thread_1',
      expect.objectContaining({ code: 'tool_loop_recovery_paused', severity: 'warning' })
    )
  })
})

describe('AgentLoop tool-budget checkpoint continuation', () => {
  it('finalizes without tools when checkpoint parsing fails', async () => {
    const { run, health, events } = createCheckpointHarness('not json')

    await expect(run()).resolves.toBe('continue')

    expect(health.phase).toBe(1)
    expect(health.finalizationRequested).toBe(true)
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
      code: 'tool_budget_phase_finalizing',
      details: expect.objectContaining({ checkpointParsed: false })
    }))
  })

  it('finalizes without tools when no remaining work is declared', async () => {
    const { run, health } = createCheckpointHarness(JSON.stringify({
      decision: 'continue',
      summary: 'phase checked',
      evidenceDelta: ['result'],
      remaining: [],
      nextPlan: ['inspect B'],
      stopCondition: ['B checked']
    }))

    await expect(run()).resolves.toBe('continue')

    expect(health.phase).toBe(1)
    expect(health.finalizationRequested).toBe(true)
  })

  it('opens another phase only for a distinct concrete continuation', async () => {
    const { run, health } = createCheckpointHarness(JSON.stringify({
      decision: 'continue',
      summary: 'A checked',
      evidenceDelta: ['A result'],
      remaining: ['B'],
      nextPlan: ['inspect B'],
      stopCondition: ['B checked']
    }), {
      previousCheckpointPlan: ['inspect A']
    })

    await expect(run()).resolves.toBe('continue')

    expect(health.phase).toBe(2)
    expect(health.finalizationRequested).toBe(false)
    expect(health.previousCheckpointPlan).toEqual(['inspect B'])
  })

  it('finalizes when the configured total limit is reached', async () => {
    const { run, health } = createCheckpointHarness(JSON.stringify({
      decision: 'continue',
      summary: 'A checked',
      evidenceDelta: ['A result'],
      remaining: ['B'],
      nextPlan: ['inspect B'],
      stopCondition: ['B checked']
    }), {
      totalToolCalls: 2,
      totalLimit: 2
    })

    await expect(run()).resolves.toBe('continue')

    expect(health.phase).toBe(1)
    expect(health.finalizationRequested).toBe(true)
    expect(health.finalizationReason).toContain('total limit was reached')
  })

  it('finalizes when the configured automatic phase limit is reached', async () => {
    const { run, health } = createCheckpointHarness(JSON.stringify({
      decision: 'continue',
      summary: 'A checked',
      evidenceDelta: ['A result'],
      remaining: ['B'],
      nextPlan: ['inspect B'],
      stopCondition: ['B checked']
    }), {
      maxAutomaticPhases: 1
    })

    await expect(run()).resolves.toBe('continue')

    expect(health.phase).toBe(1)
    expect(health.finalizationRequested).toBe(true)
    expect(health.finalizationReason).toContain('automatic limit was reached')
  })
})

function successfulToolOutcome(): DispatchOutcome {
  return {
    kind: 'continue',
    executedCount: 1,
    successCount: 1,
    errorCount: 0,
    suppressedCount: 0
  }
}

function createToolLoopHarness() {
  const events = { record: vi.fn(async () => undefined) }
  const turns = { applyItem: vi.fn(async () => undefined) }
  const loop = new AgentLoop({
    threadStore: {},
    sessionStore: {},
    approvalGate: {},
    userInputGate: {},
    model: {},
    toolHost: {},
    usage: {},
    events,
    turns,
    inflight: {},
    steering: {},
    compactor: {},
    prefix: { systemPrompt: '', fewShots: [] },
    ids: { next: vi.fn(() => 'item_error_1') },
    nowIso: () => '2026-07-03T00:00:00.000Z',
    executionGovernance: {
      enabled: true,
      maxRecoverySteps: 1,
      nonProgressThreshold: 3,
      maxStepsAfterRecovery: 2
    }
  } as never)

  const signal = new AbortController().signal
  const handle = (outcome: DispatchOutcome, stepIndex: number) =>
    (loop as unknown as {
      handleToolDispatchOutcome(input: {
        outcome: DispatchOutcome
        threadId: string
        turnId: string
        stepIndex: number
        signal: AbortSignal
      }): Promise<'continue' | 'failed' | 'aborted'>
    }).handleToolDispatchOutcome({
      outcome,
      threadId: 'thread_1',
      turnId: 'turn_1',
      stepIndex,
      signal
    })

  return { handle, events, turns }
}

type CheckpointHealth = {
  totalToolCalls: number
  phaseToolCalls: number
  phaseSuccessfulCalls: number
  phase: number
  finalizationRequested: boolean
  finalizationReason?: string
  previousCheckpointPlan?: string[]
}

function createCheckpointHarness(
  checkpointText: string,
  overrides: {
    totalToolCalls?: number
    totalLimit?: number
    maxAutomaticPhases?: number
    previousCheckpointPlan?: string[]
  } = {}
) {
  const events = { record: vi.fn(async () => undefined) }
  const signal = new AbortController().signal
  const loop = new AgentLoop({
    threadStore: {},
    sessionStore: {},
    approvalGate: {},
    userInputGate: {},
    model: {
      async *stream() {
        yield { kind: 'assistant_text_delta', text: checkpointText }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    },
    toolHost: {},
    usage: {},
    events,
    turns: {},
    inflight: {},
    steering: {},
    compactor: {},
    prefix: { systemPrompt: '', fewShots: [] },
    ids: { next: vi.fn(() => 'item_error_1') },
    nowIso: () => '2026-07-03T00:00:00.000Z',
    toolBudget: {
      profiles: {
        long: {
          softLimit: 1,
          hardLimit: 1,
          maxAutomaticPhases: overrides.maxAutomaticPhases ?? 3,
          totalLimit: overrides.totalLimit ?? 3
        }
      }
    }
  } as never)
  const internals = loop as unknown as {
    configureToolBudget(profileName: 'long', turnId: string): CheckpointHealth
    runToolBudgetCheckpoint(input: {
      request: Record<string, unknown>
      threadId: string
      turnId: string
      health: CheckpointHealth
      signal: AbortSignal
    }): Promise<'continue' | 'stop' | 'failed' | 'aborted'>
  }
  const health = internals.configureToolBudget('long', 'turn_1')
  health.totalToolCalls = overrides.totalToolCalls ?? 1
  health.phaseToolCalls = 1
  health.phaseSuccessfulCalls = 1
  health.phase = 1
  health.previousCheckpointPlan = overrides.previousCheckpointPlan
  const run = () => internals.runToolBudgetCheckpoint({
    request: {
      threadId: 'thread_1',
      turnId: 'turn_1',
      model: 'checkpoint-model',
      prefix: [],
      history: [],
      tools: [],
      abortSignal: signal
    },
    threadId: 'thread_1',
    turnId: 'turn_1',
    health,
    signal
  })

  return { run, health, events }
}
