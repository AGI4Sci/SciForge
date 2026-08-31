import { z } from 'zod'
import {
  agentIdSchema,
  agentInboxMessageSchema,
  humanNeededCreateCommandSchema,
  idempotencyKeySchema,
  projectCreateCommandSchema,
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema,
  projectPlanSubmitCommandSchema,
  restResponseSchema,
  taskOfferCreateCommandSchema,
  taskOfferExtendCommandSchema,
  taskOfferReassignCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskResultReviewCommandSchema,
  type AgentInboxMessage,
  type RestResponse
} from '@sciforge/collaboration-contracts'

export const COORDINATOR_CLOUD_COMMAND_SERVICE_ID =
  'sciforge.collaboration.coordinator-cloud-command' as const
export const COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION = '6.2.0' as const

/**
 * Agent-authored Project creation and Coordinator writes only. The current
 * local Agent identity is bound by the durable outbox; Owner/User commands and
 * Worker execution commands deliberately remain outside this service.
 */
export const coordinatorCloudCommandSchema = z.discriminatedUnion('type', [
  projectCreateCommandSchema,
  projectPlanSubmitCommandSchema,
  taskOfferCreateCommandSchema,
  taskOfferExtendCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskOfferReassignCommandSchema,
  humanNeededCreateCommandSchema,
  taskResultReviewCommandSchema,
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema
])

export type CoordinatorCloudCommand = z.infer<typeof coordinatorCloudCommandSchema>
export type CoordinatorAgentInboxHandler = (message: AgentInboxMessage) => Promise<void>
export type CoordinatorCloudCommandReplay = Readonly<{
  command: CoordinatorCloudCommand
  response: RestResponse
}>
export type CoordinatorCloudCommandReplayValidator = (
  command: CoordinatorCloudCommand
) => void

export type CoordinatorCloudCommandService = Readonly<{
  /** Exact active Agent owned by this local Collaboration runtime. */
  localAgentId(): string | undefined
  execute(command: CoordinatorCloudCommand): Promise<RestResponse>
  resume(
    idempotencyKey: string,
    validateCommand: CoordinatorCloudCommandReplayValidator
  ): Promise<CoordinatorCloudCommandReplay | null>
  subscribe(handler: CoordinatorAgentInboxHandler): () => void
}>

export function defineCoordinatorCloudCommandService(
  input: CoordinatorCloudCommandService
): CoordinatorCloudCommandService {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.localAgentId !== 'function' ||
      typeof input.execute !== 'function' || typeof input.resume !== 'function' ||
      typeof input.subscribe !== 'function') {
    throw new TypeError('Coordinator Cloud command service is invalid.')
  }
  return Object.freeze({
    localAgentId: () => {
      const localAgentId = input.localAgentId()
      return localAgentId === undefined ? undefined : agentIdSchema.parse(localAgentId)
    },
    execute: async (command) => restResponseSchema.parse(
      await input.execute(coordinatorCloudCommandSchema.parse(command))
    ),
    resume: async (rawIdempotencyKey, validateCommand) => {
      const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey)
      if (typeof validateCommand !== 'function') {
        throw new TypeError('Coordinator command replay validator is invalid.')
      }
      let validatedCommand: CoordinatorCloudCommand | null = null
      const replay = await input.resume(idempotencyKey, (rawCommand) => {
        if (validatedCommand !== null) {
          throw new Error('Coordinator command replay validated more than one command.')
        }
        const command = coordinatorCloudCommandSchema.parse(rawCommand)
        if (command.idempotencyKey !== idempotencyKey) {
          throw new Error('Coordinator command replay belongs to another idempotency key.')
        }
        validateCommand(command)
        validatedCommand = command
      })
      if (replay === null) {
        if (validatedCommand !== null) {
          throw new Error('Coordinator command replay validation did not return its command.')
        }
        return null
      }
      const command = coordinatorCloudCommandSchema.parse(replay.command)
      const response = restResponseSchema.parse(replay.response)
      if (validatedCommand === null ||
          JSON.stringify(command) !== JSON.stringify(validatedCommand)) {
        throw new Error('Coordinator command replay was not validated before resumption.')
      }
      if (response.requestId !== command.requestId) {
        throw new Error('Coordinator command replay response belongs to another request.')
      }
      return Object.freeze({ command, response })
    },
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
