import type {
  AgentRuntimeContextState,
  AgentRuntimeEvent,
  AgentRuntimeId
} from '../../shared/agent-runtime-contract'

export class RuntimeContextStateService {
  private readonly states = new Map<string, AgentRuntimeContextState>()

  reset(input: { runtimeId: AgentRuntimeId; threadId: string }): void {
    this.states.delete(key(input.runtimeId, input.threadId))
  }

  get(input: {
    runtimeId: AgentRuntimeId
    threadId: string
  }): AgentRuntimeContextState {
    return this.ensure(input.runtimeId, input.threadId)
  }

  peek(input: {
    runtimeId: AgentRuntimeId
    threadId: string
  }): AgentRuntimeContextState | null {
    return this.states.get(key(input.runtimeId, input.threadId)) ?? null
  }

  recordCompaction(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    summary?: string
    summarySource?: AgentRuntimeContextState['summarySource']
    triggerReason?: string
    rawHistoryItems?: number
    effectiveHistoryItems?: number
    estimatedTokens?: number
    replacedTokens?: number
    sourceDigest?: string
    digestMarker?: string
    sourceItemIds?: string[]
  }): AgentRuntimeContextState {
    const current = this.ensure(input.runtimeId, input.threadId)
    const next: AgentRuntimeContextState = {
      ...current,
      rawHistoryItems: input.rawHistoryItems ?? current.rawHistoryItems,
      effectiveHistoryItems: input.effectiveHistoryItems ?? current.effectiveHistoryItems,
      summary: input.summary ?? current.summary,
      summarySource: input.summarySource ?? current.summarySource ?? 'heuristic',
      estimatedTokens: input.estimatedTokens ?? current.estimatedTokens,
      triggerReason: input.triggerReason ?? current.triggerReason,
      replacedTokens: input.replacedTokens ?? current.replacedTokens,
      sourceDigest: input.sourceDigest ?? current.sourceDigest,
      digestMarker: input.digestMarker ?? current.digestMarker,
      sourceItemIds: input.sourceItemIds ?? current.sourceItemIds,
      updatedAt: new Date().toISOString()
    }
    this.states.set(key(input.runtimeId, input.threadId), next)
    return next
  }

  updateGoalResume(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    objective?: string
    status?: NonNullable<AgentRuntimeContextState['goalResume']>['status']
    lastFailureReason?: string
    incrementResumeCount?: boolean
    resumeCount?: number
  }): AgentRuntimeContextState {
    const current = this.ensure(input.runtimeId, input.threadId)
    const previous = current.goalResume
    const now = new Date().toISOString()
    const resumeCount = input.resumeCount ?? (
      (previous?.resumeCount ?? 0) + (input.incrementResumeCount ? 1 : 0)
    )
    const next: AgentRuntimeContextState = {
      ...current,
      goalResume: {
        objective: input.objective ?? previous?.objective,
        status: input.status ?? previous?.status ?? 'active',
        resumeCount,
        lastFailureReason: input.lastFailureReason ?? previous?.lastFailureReason,
        updatedAt: now
      },
      updatedAt: now
    }
    this.states.set(key(input.runtimeId, input.threadId), next)
    return next
  }

  observeEvent(event: AgentRuntimeEvent): void {
    if (!event.runtimeId) return
    const current = this.ensure(event.runtimeId, event.threadId)
    if (event.kind === 'compaction_event') {
      if (event.status !== 'success') return
      this.recordCompaction({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        summary: event.summary,
        summarySource: 'runtime',
        triggerReason: event.detail,
        rawHistoryItems: event.messagesBefore,
        effectiveHistoryItems: event.messagesAfter,
        replacedTokens: event.replacedTokens,
        sourceDigest: event.sourceDigest,
        digestMarker: event.digestMarker,
        sourceItemIds: event.sourceItemIds
      })
      return
    }
    if (event.kind === 'goal_event') {
      if (event.cleared) {
        const next: AgentRuntimeContextState = {
          ...current,
          updatedAt: new Date().toISOString()
        }
        delete next.goalResume
        this.states.set(key(event.runtimeId, event.threadId), next)
        return
      }
      this.updateGoalResume({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        objective: event.objective,
        status: event.status,
        lastFailureReason: event.lastFailureReason,
        incrementResumeCount: event.status === 'active' && current.goalResume?.status === 'blocked'
      })
      return
    }
    if (
      event.kind === 'turn_lifecycle' &&
      (event.state === 'failed' || event.state === 'aborted' || event.state === 'cancelled') &&
      current.goalResume
    ) {
      this.updateGoalResume({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        objective: current.goalResume.objective,
        status: 'blocked',
        resumeCount: current.goalResume.resumeCount,
        lastFailureReason: event.message ?? `turn ${event.state}`
      })
      return
    }
  }

  private ensure(runtimeId: AgentRuntimeId, threadId: string): AgentRuntimeContextState {
    const stateKey = key(runtimeId, threadId)
    const existing = this.states.get(stateKey)
    if (existing) return existing
    const created: AgentRuntimeContextState = {
      runtimeId,
      threadId,
      rawHistoryItems: 0,
      effectiveHistoryItems: 0,
      summarySource: 'none',
      estimatedTokens: 0,
      updatedAt: new Date().toISOString()
    }
    this.states.set(stateKey, created)
    return created
  }
}

function key(runtimeId: AgentRuntimeId, threadId: string): string {
  return `${runtimeId}:${threadId}`
}
