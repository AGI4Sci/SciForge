import { z } from 'zod'

import type { DocflowCommandInvocation } from './docflow-native-document-adapter.js'
import type { OpenContentExtendedCommandInvocation } from './extended-operation-adapter.js'

export const OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID =
  'sciforge.opencontent-connector' as const
export const OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID =
  'sciforge.opencontent-content-space-provider' as const
export const OPENCONTENT_SKILL_SOURCE_ZIP_SHA256 =
  '2147c0ab8b571fd973575f04f0fd21537fb1918287f117cbe5c1e1959e083ae4' as const

const boundedIdSchema = z.string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Identifiers must be canonical.')

const ownerModuleVersionSchema = z.string().trim().min(1).max(128)
export const openContentSkillRuntimeOwnerSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('transport-owner'),
    moduleId: z.literal(OPENCONTENT_SKILL_RUNTIME_TRANSPORT_OWNER_MODULE_ID),
    moduleVersion: ownerModuleVersionSchema
  }).strict().readonly(),
  z.object({
    role: z.literal('adapter-owner'),
    moduleId: z.literal(OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID),
    moduleVersion: ownerModuleVersionSchema
  }).strict().readonly()
])
export type OpenContentSkillRuntimeOwner = z.infer<typeof openContentSkillRuntimeOwnerSchema>

export const openContentSkillErrorSchema = z.object({
  code: z.enum([
    'invalid-input',
    'unauthorized',
    'human-action-required',
    'blocked-by-contract',
    'revision-conflict',
    'provider-contract-violation',
    'outcome-unknown',
    'cancelled'
  ]),
  message: z.string().trim().min(1).max(256),
  retry: z.enum(['never', 'after-human-action', 'same-invocation'])
}).strict().superRefine((error, context) => {
  if (error.code === 'outcome-unknown' && error.retry !== 'never') {
    context.addIssue({
      code: 'custom',
      path: ['retry'],
      message: 'An unknown mutation outcome must never be retried automatically.'
    })
  }
}).readonly()
export type OpenContentSkillError = z.infer<typeof openContentSkillErrorSchema>

/** Minimal core-issued execution identity; credentials and invented leases are rejected. */
export const openContentSkillExecutionBindingSchema = z.object({
  providerInstanceRef: boundedIdSchema,
  invocationId: boundedIdSchema.optional(),
  deadlineAt: z.string().datetime({ offset: true })
}).strict().readonly()
export type OpenContentSkillExecutionBinding = z.infer<
  typeof openContentSkillExecutionBindingSchema
>

export type OpenContentSkillMainExecutionContext = OpenContentSkillExecutionBinding & Readonly<{
  signal: AbortSignal
  assertPrincipalCurrent(): void | Promise<void>
}>

/**
 * The Node-free command boundary shared by the Connector contract and the
 * main-process runner. Executable paths, credentials, and subprocess details
 * deliberately remain outside this public transport contract.
 */
export type OpenContentCliInvocation =
  | DocflowCommandInvocation
  | OpenContentExtendedCommandInvocation

export interface OpenContentCliCommandTransport {
  invoke(invocation: OpenContentCliInvocation): Promise<unknown>
}

export function admitOpenContentSkillRuntimeOwner(
  value: unknown
): OpenContentSkillRuntimeOwner {
  return Object.freeze(openContentSkillRuntimeOwnerSchema.parse(value))
}
