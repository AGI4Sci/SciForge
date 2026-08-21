import { z } from 'zod'

import {
  agentIdSchema,
  entityMetadataShape,
  projectionIdSchema,
  providerOpaqueIdSchema,
  remoteApprovalIdSchema,
  runtimeIdSchema,
  runtimeTurnIdSchema,
  threadIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import { providerLocatorSchema } from './provider.js'

export const remoteApprovalDecisionSchema = z.enum(['allow_once', 'deny_once'])
export const remoteApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'denied',
  'expired',
  'superseded',
  'desktop_only',
  'delivery_pending',
  'completed'
])

export const remoteCapabilityApprovalSchema = z.object({
  type: z.literal('remote_capability_approval'),
  remoteApprovalId: remoteApprovalIdSchema,
  ownerUserId: userIdSchema,
  agentId: agentIdSchema,
  projectionId: projectionIdSchema,
  locator: providerLocatorSchema,
  runtimeId: runtimeIdSchema,
  threadId: threadIdSchema,
  turnId: runtimeTurnIdSchema,
  capabilityRequestId: providerOpaqueIdSchema,
  desktopApprovalId: providerOpaqueIdSchema,
  safeSummary: z.string().trim().min(1).max(500),
  effect: z.enum(['workspace-write', 'external-write', 'destructive']),
  remoteEligible: z.boolean(),
  status: remoteApprovalStatusSchema,
  expiresAt: timestampSchema,
  providerCardMessageId: providerOpaqueIdSchema.optional(),
  ...entityMetadataShape
}).strict()

export type RemoteCapabilityApproval = z.infer<typeof remoteCapabilityApprovalSchema>
export type RemoteApprovalDecision = z.infer<typeof remoteApprovalDecisionSchema>
export type RemoteApprovalStatus = z.infer<typeof remoteApprovalStatusSchema>
