import { z } from 'zod'
import {
  agentInboxMessageSchema,
  humanNeededCreateCommandSchema,
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema,
  projectPlanSubmitCommandSchema,
  restResponseSchema,
  taskOfferCreateCommandSchema,
  taskOfferReassignCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskResultReviewCommandSchema,
  type AgentInboxMessage,
  type RestResponse
} from '@sciforge/collaboration-contracts'

export const COORDINATOR_CLOUD_COMMAND_SERVICE_ID =
  'sciforge.collaboration.coordinator-cloud-command' as const
export const COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION = '3.0.0' as const

/**
 * Agent-authored Coordinator writes only. Owner/User commands and Worker
 * execution commands deliberately remain outside this service.
 */
export const coordinatorCloudCommandSchema = z.discriminatedUnion('type', [
  projectPlanSubmitCommandSchema,
  taskOfferCreateCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskOfferReassignCommandSchema,
  humanNeededCreateCommandSchema,
  taskResultReviewCommandSchema,
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema
])

export type CoordinatorCloudCommand = z.infer<typeof coordinatorCloudCommandSchema>
export type CoordinatorAgentInboxHandler = (message: AgentInboxMessage) => Promise<void>

export type CoordinatorCloudCommandService = Readonly<{
  execute(command: CoordinatorCloudCommand): Promise<RestResponse>
  subscribe(handler: CoordinatorAgentInboxHandler): () => void
}>

export function defineCoordinatorCloudCommandService(
  input: CoordinatorCloudCommandService
): CoordinatorCloudCommandService {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.execute !== 'function' || typeof input.subscribe !== 'function') {
    throw new TypeError('Coordinator Cloud command service is invalid.')
  }
  return Object.freeze({
    execute: async (command) => restResponseSchema.parse(
      await input.execute(coordinatorCloudCommandSchema.parse(command))
    ),
    subscribe: (handler) => {
      if (typeof handler !== 'function') {
        throw new TypeError('Coordinator Agent Inbox handler is invalid.')
      }
      const dispose = input.subscribe(async (message) => handler(
        agentInboxMessageSchema.parse(message)
      ))
      if (typeof dispose !== 'function') {
        throw new TypeError('Coordinator Agent Inbox subscription disposer is invalid.')
      }
      return dispose
    }
  })
}
