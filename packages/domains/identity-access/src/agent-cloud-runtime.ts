import { z } from 'zod'

import {
  agentIdSchema,
  agentNodeSchema,
  deviceIdSchema,
  idempotencyKeySchema,
  inboxMessageSchema,
  restRequestSchema,
  restResponseSchema,
  revisionSchema,
  userIdSchema,
  webSocketMessageSchema,
  type AgentNode,
  type InboxMessage,
  type RestRequest,
  type RestResponse,
  type WebSocketMessage
} from '@sciforge/collaboration-contracts'

export const AGENT_CLOUD_RUNTIME_SERVICE_ID = 'sciforge.agent-cloud-runtime' as const
export const AGENT_CLOUD_RUNTIME_CONTRACT_VERSION = '1.0.0' as const

const capabilitiesSchema = z.array(
  z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)
).max(256).transform((values) => [...new Set(values)].sort()).readonly()

export const agentCloudRegisterInputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  nodeType: z.enum(['desktop', 'server']),
  capabilities: capabilitiesSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

export const agentCloudRotateInputSchema = z.object({
  agentId: agentIdSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

export const agentCloudRevokeInputSchema = agentCloudRotateInputSchema

export const agentCloudAuthorityStatusSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ready'),
    agentId: agentIdSchema,
    userId: userIdSchema,
    deviceId: deviceIdSchema,
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
  }).strict().readonly(),
  z.object({ state: z.literal('identity_required') }).strict().readonly(),
  z.object({ state: z.literal('device_required') }).strict().readonly(),
  z.object({ state: z.literal('agent_required'), agentId: agentIdSchema }).strict().readonly(),
  z.object({
    state: z.literal('unavailable'),
    reason: z.string().trim().min(1).max(512)
  }).strict().readonly()
])

export const agentCloudExecuteInputSchema = z.object({
  agentId: agentIdSchema,
  request: restRequestSchema
}).strict().superRefine(({ request }, context) => {
  if (request.type === 'agent.register' || request.type === 'agent.rotate_credential' ||
      request.type === 'agent.revoke' || request.type === 'inbox.pull') {
    context.addIssue({
      code: 'custom',
      path: ['request', 'type'],
      message: 'Agent lifecycle and Inbox pull use their bounded service methods.'
    })
  }
}).readonly()

export const agentCloudPullInputSchema = z.object({
  agentId: agentIdSchema,
  afterSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().min(1).max(1_000).default(100)
}).strict().readonly()

export const agentCloudInboxPageSchema = z.object({
  messages: z.array(inboxMessageSchema).max(1_000).readonly(),
  nextSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
}).strict().readonly()

export type AgentCloudRegisterInput = z.input<typeof agentCloudRegisterInputSchema>
export type AgentCloudRotateInput = z.input<typeof agentCloudRotateInputSchema>
export type AgentCloudRevokeInput = z.input<typeof agentCloudRevokeInputSchema>
export type AgentCloudAuthorityStatus = z.infer<typeof agentCloudAuthorityStatusSchema>
export type AgentCloudInboxPage = z.infer<typeof agentCloudInboxPageSchema>

export type AgentCloudRuntime = Readonly<{
  authorityStatus(agentId: string): Promise<AgentCloudAuthorityStatus>
  registerAgent(input: AgentCloudRegisterInput): Promise<AgentNode>
  rotateAgent(input: AgentCloudRotateInput): Promise<AgentNode>
  revokeAgent(input: AgentCloudRevokeInput): Promise<AgentNode>
  fenceAgent(agentId: string): Promise<void>
  execute(
    input: Readonly<{ agentId: string; request: RestRequest }>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<RestResponse>
  pullAgentInbox(
    input: Readonly<{ agentId: string; afterSequence: number; limit?: number }>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<AgentCloudInboxPage>
  observeAgentInbox(
    agentId: string,
    signal: AbortSignal
  ): AsyncIterable<WebSocketMessage>
}>

export type AgentCloudRuntimeErrorCode =
  | 'runtime_unavailable'
  | 'identity_required'
  | 'device_required'
  | 'agent_required'
  | 'agent_authority_invalid'
  | 'operation_not_allowed'
  | 'cloud_unavailable'
  | 'cloud_response_invalid'
  | 'conflict'

export class AgentCloudRuntimeError extends Error {
  constructor(
    readonly code: AgentCloudRuntimeErrorCode,
    message: string,
    readonly cloudCode?: string,
    options?: ErrorOptions
  ) {
    super(message.slice(0, 512), options)
    this.name = 'AgentCloudRuntimeError'
  }
}

export function defineAgentCloudRuntime(input: AgentCloudRuntime): AgentCloudRuntime {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Agent Cloud runtime is invalid.')
  }
  for (const method of [
    'authorityStatus',
    'registerAgent',
    'rotateAgent',
    'revokeAgent',
    'fenceAgent',
    'execute',
    'pullAgentInbox',
    'observeAgentInbox'
  ] as const) {
    if (typeof input[method] !== 'function') {
      throw new TypeError(`Agent Cloud runtime method ${method} is unavailable.`)
    }
  }
  return Object.freeze({
    authorityStatus: async (agentId) => agentCloudAuthorityStatusSchema.parse(
      await input.authorityStatus(agentIdSchema.parse(agentId))
    ),
    registerAgent: async (value) => agentNodeSchema.parse(
      await input.registerAgent(agentCloudRegisterInputSchema.parse(value))
    ),
    rotateAgent: async (value) => agentNodeSchema.parse(
      await input.rotateAgent(agentCloudRotateInputSchema.parse(value))
    ),
    revokeAgent: async (value) => agentNodeSchema.parse(
      await input.revokeAgent(agentCloudRevokeInputSchema.parse(value))
    ),
    fenceAgent: async (agentId) => input.fenceAgent(agentIdSchema.parse(agentId)),
    execute: async (value, options) => restResponseSchema.parse(
      await input.execute(agentCloudExecuteInputSchema.parse(value), options)
    ),
    pullAgentInbox: async (value, options) => agentCloudInboxPageSchema.parse(
      await input.pullAgentInbox(agentCloudPullInputSchema.parse(value), options)
    ),
    observeAgentInbox: (agentId, signal) => validateEventStream(
      input.observeAgentInbox(agentIdSchema.parse(agentId), signal)
    )
  })
}

async function* validateEventStream(
  source: AsyncIterable<WebSocketMessage>
): AsyncIterable<WebSocketMessage> {
  for await (const event of source) yield webSocketMessageSchema.parse(event)
}

export function isAgentInboxMessage(
  message: InboxMessage,
  agentId: string
): boolean {
  return message.recipientType === 'agent' && message.recipientAgentId === agentId
}

