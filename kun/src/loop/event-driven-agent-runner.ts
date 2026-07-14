export type AgentRunStatus = 'completed' | 'failed' | 'aborted'

export type AtomicAgentStepResult = 'continue' | 'stop' | 'failed' | 'aborted'

export type BeforeAgentStepResult =
  | { kind: 'continue' }
  | { kind: 'terminate'; status: AgentRunStatus }

export type EventDrivenAgentRunnerOptions = {
  signal: AbortSignal
  maxIterations: number
  /**
   * Safe boundary for pending user steering and trajectory guards. It runs
   * before every atomic model/tool step, including the first one.
   */
  beforeStep?: (stepIndex: number) => Promise<BeforeAgentStepResult | void>
  /** One stateless decision step: rebuild context, query the model, then execute its actions. */
  step: (stepIndex: number) => Promise<AtomicAgentStepResult>
  onIterationLimit: (maxIterations: number) => Promise<void>
}

/**
 * Event-driven run controller adapted from the public OpenHands Software
 * Agent SDK architecture (https://docs.openhands.dev/sdk/arch/agent).
 *
 * The controller intentionally owns no conversation state. Persisted events
 * are the source of truth and `step` reconstructs its input on every call.
 * This gives pause, steering, interruption, and stuck detection one explicit
 * boundary between otherwise atomic model/tool decisions.
 */
export class EventDrivenAgentRunner {
  constructor(private readonly options: EventDrivenAgentRunnerOptions) {}

  async run(): Promise<AgentRunStatus> {
    const maxIterations = positiveInteger(this.options.maxIterations)

    for (let stepIndex = 0; stepIndex < maxIterations; stepIndex += 1) {
      if (this.options.signal.aborted) return 'aborted'

      const guard = await this.options.beforeStep?.(stepIndex)
      if (this.options.signal.aborted) return 'aborted'
      if (guard?.kind === 'terminate') return guard.status

      const result = await this.options.step(stepIndex)
      if (result === 'aborted' || this.options.signal.aborted) return 'aborted'
      if (result === 'stop') return 'completed'
      if (result === 'failed') return 'failed'
    }

    await this.options.onIterationLimit(maxIterations)
    return this.options.signal.aborted ? 'aborted' : 'failed'
  }
}

function positiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  return Math.max(1, Math.floor(value))
}
