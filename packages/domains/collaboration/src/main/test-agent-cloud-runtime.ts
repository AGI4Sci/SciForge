import type {
  AgentCloudAuthorityStatus,
  AgentCloudRegisterInput,
  AgentCloudRevokeInput,
  AgentCloudRotateInput,
  AgentCloudRuntime
} from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type {
  AgentNode,
  RestRequest,
  RestResponse,
  WebSocketMessage
} from '@sciforge/collaboration-contracts'

export function createTestAgentCloudRuntime(input: Readonly<{
  authorityStatus?: (agentId: string) => Promise<AgentCloudAuthorityStatus>
  registerAgent?: (value: AgentCloudRegisterInput) => Promise<AgentNode>
  rotateAgent?: (value: AgentCloudRotateInput) => Promise<AgentNode>
  revokeAgent?: (value: AgentCloudRevokeInput) => Promise<AgentNode>
  fenceAgent?: (agentId: string) => Promise<void>
  execute?: (agentId: string, request: RestRequest) => Promise<RestResponse>
  pullAgentInbox?: AgentCloudRuntime['pullAgentInbox']
  observeAgentInbox?: AgentCloudRuntime['observeAgentInbox']
}>): AgentCloudRuntime {
  const unavailable = async (): Promise<never> => {
    throw new Error('Test Agent Cloud operation was not configured.')
  }
  return {
    authorityStatus: input.authorityStatus ?? (async (agentId) => ({
      state: 'agent_required',
      agentId
    })),
    registerAgent: input.registerAgent ?? unavailable,
    rotateAgent: input.rotateAgent ?? unavailable,
    revokeAgent: input.revokeAgent ?? unavailable,
    fenceAgent: input.fenceAgent ?? unavailable,
    execute: ({ agentId, request }) => (input.execute ?? unavailable)(agentId, request),
    pullAgentInbox: input.pullAgentInbox ?? (async () => ({ messages: [], nextSequence: 0 })),
    observeAgentInbox: input.observeAgentInbox ?? ((_agentId, signal) => idleEvents(signal))
  }
}

async function* idleEvents(signal: AbortSignal): AsyncIterable<WebSocketMessage> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
  yield* [] as WebSocketMessage[]
}
