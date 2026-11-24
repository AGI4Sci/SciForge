import { z } from 'zod'
import type { DomainCapabilityContract } from '@sciforge/domain-sdk/host'
import { projectSchema, remoteSessionProjectionSchema, projectIdSchema, userIdSchema,
  protocolVersionSchema, requestIdSchema, restProjectPageResponseSchema,
  codeConversationMutationResponseSchema, codeConversationPageResponseSchema, collaborationErrorSchema,
  projectListQuerySchema, codeConversationCommandSchemas } from '@sciforge/collaboration-contracts'
import { authenticatedCloudRequestSchema, authenticatedCloudResponseSchema, authenticatedCloudBindingSchema } from './authenticated-cloud-transport.js'

export const cloudHostStatusSchema = z.object({ ...authenticatedCloudBindingSchema.unwrap().shape, state: z.literal('ready') }).strict().readonly()
const envelope = { protocolVersion: protocolVersionSchema, requestId: requestIdSchema }
export const cloudHostCommandSchema = z.discriminatedUnion('type', [
  ...codeConversationCommandSchemas, projectListQuerySchema,
  z.object({ ...envelope, type: z.literal('project.get'), projectId: projectIdSchema }).strict(),
  z.object({ ...envelope, type: z.literal('projection.list'), ownerUserId: userIdSchema }).strict()
])
const hostEntitySchema = z.union([projectSchema, remoteSessionProjectionSchema])
const hostResponseBodySchema = z.union([
  restProjectPageResponseSchema, codeConversationMutationResponseSchema, codeConversationPageResponseSchema,
  z.object({ protocolVersion: protocolVersionSchema, requestId: requestIdSchema, type: z.literal('rest.error'), error: collaborationErrorSchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, requestId: requestIdSchema, type: z.literal('rest.entity'), entity: hostEntitySchema }).strict(),
  z.object({ protocolVersion: protocolVersionSchema, requestId: requestIdSchema, type: z.literal('rest.collection'),
    items: z.array(hostEntitySchema).max(10_000), nextCursor: z.string().min(1).max(2_048).optional() }).strict()
])
export const cloudHostResponseSchema = z.object({ contractVersion: z.literal(1),
  status: z.number().int().min(100).max(599), body: hostResponseBodySchema }).strict().superRefine((input, context) => {
  if (!authenticatedCloudResponseSchema.safeParse(input).success) context.addIssue({ code: 'custom', message: 'Invalid authenticated Cloud response.' })
})
export const cloudHostRequestSchema = z.object({
  contractVersion: z.literal(1), operationId: z.literal('sciforge.cloud.command'),
  payload: cloudHostCommandSchema, expectedBinding: authenticatedCloudBindingSchema
}).strict().superRefine((input, context) => {
  const { expectedBinding: _expected, ...request } = input
  const result = authenticatedCloudRequestSchema.safeParse(request)
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

export const AUTHENTICATED_CLOUD_HOST_SERVICE_ID = 'identity-access.authenticated-cloud' as const
export const AUTHENTICATED_CLOUD_CAPABILITY_IDS = Object.freeze({
  status: 'identity.cloud.host.status',
  read: 'identity.cloud.host.read',
  write: 'identity.cloud.host.execute'
})

export function authenticatedCloudCommandEffect(type: string): 'read' | 'external-write' {
  switch (type) {
    case 'projection.list':
    case 'project.get':
    case 'project.list':
    case 'project.code_conversation.pull':
      return 'read'
    case 'project.code_conversation.publish':
    case 'project.code_conversation.append':
    case 'project.code_conversation.fork':
    case 'project.code_conversation.set_status':
      return 'external-write'
    default:
      throw new Error(`Cloud Host command ${type} is not allowed.`)
  }
}

export const cloudHostStatusInputSchema = z.object({}).strict()
export const cloudHostReadInputSchema = cloudHostRequestSchema.refine(
  (input) => authenticatedCloudCommandEffect(input.payload.type) === 'read',
  'Cloud read capability requires a read command.'
)
export const cloudHostWriteInputSchema = cloudHostRequestSchema.refine(
  (input) => authenticatedCloudCommandEffect(input.payload.type) === 'external-write',
  'Cloud write capability requires an external-write command.'
)

export const AUTHENTICATED_CLOUD_CAPABILITY_CONTRACTS: Readonly<Record<'status' | 'read' | 'write', DomainCapabilityContract<unknown, unknown>>> = Object.freeze({
  status: { actionId: AUTHENTICATED_CLOUD_CAPABILITY_IDS.status, effect: 'read', inputSchema: cloudHostStatusInputSchema, outputSchema: cloudHostStatusSchema },
  read: { actionId: AUTHENTICATED_CLOUD_CAPABILITY_IDS.read, effect: 'read', inputSchema: cloudHostReadInputSchema, outputSchema: cloudHostResponseSchema },
  write: { actionId: AUTHENTICATED_CLOUD_CAPABILITY_IDS.write, effect: 'external-write', inputSchema: cloudHostWriteInputSchema, outputSchema: cloudHostResponseSchema }
})
