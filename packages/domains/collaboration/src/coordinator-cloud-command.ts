import { z } from 'zod'
import {
  projectPlanSubmitCommandSchema,
  restResponseSchema,
  taskOfferCreateCommandSchema,
  taskOfferReassignCommandSchema,
  taskOfferWithdrawCommandSchema,
  type RestResponse
} from '@sciforge/collaboration-contracts'

export const COORDINATOR_CLOUD_COMMAND_SERVICE_ID =
  'sciforge.collaboration.coordinator-cloud-command' as const
export const COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION = '1.0.0' as const

/**
 * Agent-authored Coordinator writes only. Owner/User commands and Worker
 * execution commands deliberately remain outside this service.
 */
export const coordinatorCloudCommandSchema = z.discriminatedUnion('type', [
  projectPlanSubmitCommandSchema,
  taskOfferCreateCommandSchema,
  taskOfferWithdrawCommandSchema,
  taskOfferReassignCommandSchema
])

export type CoordinatorCloudCommand = z.infer<typeof coordinatorCloudCommandSchema>

export type CoordinatorCloudCommandService = Readonly<{
  execute(command: CoordinatorCloudCommand): Promise<RestResponse>
}>

export function defineCoordinatorCloudCommandService(
  input: CoordinatorCloudCommandService
): CoordinatorCloudCommandService {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.execute !== 'function') {
    throw new TypeError('Coordinator Cloud command service is invalid.')
  }
  return Object.freeze({
    execute: async (command) => restResponseSchema.parse(
      await input.execute(coordinatorCloudCommandSchema.parse(command))
    )
  })
}
