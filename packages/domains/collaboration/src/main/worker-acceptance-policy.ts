import {
  CollaborationLocalStore,
  collaborationWorkerAcceptanceModeSchema,
  type CollaborationWorkerAcceptanceMode
} from './store.js'

/**
 * Local-only Worker admission policy. The Cloud never receives this value;
 * every offer still produces an explicit accepted/rejected Cloud fact.
 */
export class WorkerAcceptancePolicyService {
  constructor(
    private readonly store: CollaborationLocalStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  read(agentId: string): CollaborationWorkerAcceptanceMode {
    return this.store.snapshot().workerAcceptancePolicies.find((policy) => (
      policy.agentId === agentId
    ))?.mode ?? 'manual'
  }

  async update(
    agentId: string,
    mode: CollaborationWorkerAcceptanceMode
  ): Promise<CollaborationWorkerAcceptanceMode> {
    const parsedMode = collaborationWorkerAcceptanceModeSchema.parse(mode)
    return this.store.transact((draft) => {
      const agent = draft.agents.find((candidate) => candidate.agentId === agentId)
      if (!agent || agent.lifecycleStatus !== 'active') {
        throw new Error('Worker acceptance policy requires this Device active Agent.')
      }
      const updatedAt = this.now().toISOString()
      const existing = draft.workerAcceptancePolicies.find((policy) => (
        policy.agentId === agentId
      ))
      if (existing) {
        existing.mode = parsedMode
        existing.updatedAt = updatedAt
      } else {
        draft.workerAcceptancePolicies.push({
          agentId,
          mode: parsedMode,
          updatedAt
        })
      }
      return parsedMode
    })
  }
}
