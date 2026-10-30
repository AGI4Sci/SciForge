import {
  agentIdSchema,
  agentInboxMessageSchema,
  deliveryAdoptionCommandSchema,
  deliveryRevisionRequestCommandSchema,
  humanNeededCreateCommandSchema,
  idempotencyKeySchema,
  projectCreateCommandSchema,
  projectDecisionSubmitCommandSchema,
  projectFinalSummarySubmitCommandSchema,
  projectRequirementsCompletionSaveCommandSchema,
  projectResultPublishCommandSchema,
  restResponseSchema,
  taskOfferCreateCommandSchema,
  taskOfferExtendCommandSchema,
  taskOfferReassignCommandSchema,
  taskOfferWithdrawCommandSchema,
  type AgentInboxMessage,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { z } from 'zod'

export const COORDINATOR_CLOUD_COMMAND_SERVICE_ID =
  'sciforge.collaboration.coordinator-cloud-command' as const
export const COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION = '8.0.0' as const

/**
 * Coordinator orchestration and human Delivery decisions share one durable outbox.
 * Agent and User command schemas are disjoint; the transport binds their current
 * authenticated principal and never forwards User decisions with Agent credentials.
 */
export const coordinatorCloudCommandSchema = z.discriminatedUnion('type', [
  projectCreateCommandSchema,
  projectRequirementsCompletionSaveCommandSchema,
  taskOfferCreateCommandSchema,
  taskOfferExtendCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskOfferReassignCommandSchema,
  humanNeededCreateCommandSchema,
  projectDecisionSubmitCommandSchema
])


export const coordinatorUserCloudCommandSchema = z.discriminatedUnion('type', [
  deliveryAdoptionCommandSchema, deliveryRevisionRequestCommandSchema,
  projectResultPublishCommandSchema, projectFinalSummarySubmitCommandSchema
])
export type CoordinatorUserCloudCommand = z.infer<typeof coordinatorUserCloudCommandSchema>
export type CoordinatorUserCloudCommandReplay = Readonly<{ command: CoordinatorUserCloudCommand; response: RestResponse }>
export type CoordinatorUserCloudCommandReplayValidator = (command: CoordinatorUserCloudCommand) => void

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
  executeUser(command: CoordinatorUserCloudCommand): Promise<RestResponse>
  resumeUser(idempotencyKey: string, validateCommand: CoordinatorUserCloudCommandReplayValidator): Promise<CoordinatorUserCloudCommandReplay | null>
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
      typeof input.executeUser !== 'function' || typeof input.resumeUser !== 'function' ||
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
    executeUser: async (command) => restResponseSchema.parse(
      await input.executeUser(coordinatorUserCloudCommandSchema.parse(command))
    ),
    resumeUser: async (rawIdempotencyKey, validateCommand) => {
      const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey)
      if (typeof validateCommand !== 'function') {
        throw new TypeError('Coordinator command replay validator is invalid.')
      }
      let validatedCommand: CoordinatorUserCloudCommand | null = null
      const replay = await input.resumeUser(idempotencyKey, (rawCommand) => {
        if (validatedCommand !== null) {
          throw new Error('Coordinator command replay validated more than one command.')
        }
        const command = coordinatorUserCloudCommandSchema.parse(rawCommand)
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
      const command = coordinatorUserCloudCommandSchema.parse(replay.command)
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
