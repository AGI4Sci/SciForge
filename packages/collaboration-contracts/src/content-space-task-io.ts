import { z } from 'zod'

import {
  agentIdSchema,
  contentSpaceAuthorizationProofIdSchema,
  entityMetadataShape,
  executionIdSchema,
  projectIdSchema,
  resourceRefIdSchema,
  revisionSchema,
  sha256Schema,
  taskIdSchema,
  timestampSchema
} from './core.js'

const canonicalOpaqueSchema = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value === value.trim(), 'Opaque values must be canonical.')
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Opaque values cannot contain control characters.')

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const portableIdentitySchema = z.record(z.string(), z.json())
  .superRefine((identity, context) => {
    const serialized = JSON.stringify(identity)
    if (utf8Length(serialized) > 6_144) {
      context.addIssue({ code: 'custom', message: 'Portable identity exceeds the bounded locator size.' })
    }
  })

/**
 * Provider-neutral locator only. It is never interpreted as proof of authorization.
 * E/Host remains the sole owner of decoding and materialization.
 */
export const portableContentSpaceLocatorSchema = z.object({
  contractVersion: z.literal(1),
  kind: z.enum([
    'content-space.file-reference',
    'content-space.container-reference',
    'content-space.artifact-reference'
  ]),
  authority: canonicalOpaqueSchema(256).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/u),
  identity: portableIdentitySchema
}).strict().superRefine((locator, context) => {
  if (utf8Length(JSON.stringify(locator)) > 8_192) {
    context.addIssue({ code: 'custom', message: 'Portable locator exceeds 8192 bytes.' })
  }
})
export type PortableContentSpaceLocator = z.infer<typeof portableContentSpaceLocatorSchema>

/** Opaque, signed/attested Host proof carrier. Cloud never stores its raw payload. */
export const contentSpaceAuthorizationProofSchema = z.object({
  format: z.literal('sciforge.content-space.authorization-proof.v1'),
  issuer: canonicalOpaqueSchema(128).regex(/^[a-z][a-z0-9._-]{2,127}$/u),
  payload: canonicalOpaqueSchema(16_384)
}).strict()
export type ContentSpaceAuthorizationProof = z.infer<typeof contentSpaceAuthorizationProofSchema>

export const contentSpacePrincipalBindingSchema = z.object({
  authority: canonicalOpaqueSchema(192),
  subject: canonicalOpaqueSchema(256),
  deviceId: canonicalOpaqueSchema(256),
  identityVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
}).strict()
export type ContentSpacePrincipalBinding = z.infer<typeof contentSpacePrincipalBindingSchema>

/** Sanitized result returned only by a trusted E/Host proof verifier. */
export const verifiedContentSpaceAuthorizationSchema = z.object({
  proofId: contentSpaceAuthorizationProofIdSchema,
  issuer: canonicalOpaqueSchema(128).regex(/^[a-z][a-z0-9._-]{2,127}$/u),
  proofDigest: sha256Schema,
  principal: contentSpacePrincipalBindingSchema,
  principalUserId: canonicalOpaqueSchema(128),
  rootLocatorDigest: sha256Schema,
  scopes: z.tuple([
    z.literal('content-space.read'),
    z.literal('content-space.upload-new')
  ]),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema
}).strict().superRefine((authorization, context) => {
  if (Date.parse(authorization.expiresAt) <= Date.parse(authorization.issuedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Authorization proof must have positive validity.' })
  }
})
export type VerifiedContentSpaceAuthorization = z.infer<typeof verifiedContentSpaceAuthorizationSchema>

export const projectContentSpaceBindingStatusSchema = z.enum(['active', 'closed'])

export const projectContentSpaceBindingSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_content_space_binding'),
  projectId: projectIdSchema,
  rootLocator: portableContentSpaceLocatorSchema.refine(
    (locator) => locator.kind === 'content-space.container-reference',
    'Project roots must be ContentSpace container locators.'
  ),
  rootLocatorDigest: sha256Schema,
  authorization: z.object({
    proofId: contentSpaceAuthorizationProofIdSchema,
    issuer: canonicalOpaqueSchema(128),
    proofDigest: sha256Schema,
    principal: contentSpacePrincipalBindingSchema,
    scopes: z.tuple([
      z.literal('content-space.read'),
      z.literal('content-space.upload-new')
    ]),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema
  }).strict(),
  status: projectContentSpaceBindingStatusSchema
}).strict()
export type ProjectContentSpaceBinding = z.infer<typeof projectContentSpaceBindingSchema>

export const taskFileDestinationNameSchema = z.string().trim().min(1).max(128)
  .refine((value) => value !== '.' && value !== '..', 'Destination names cannot be traversal segments.')
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/u.test(value), 'Destination names must be one safe path component.')

export const taskFileInputIntentSchema = z.object({
  kind: z.literal('content-space.input-file'),
  locator: portableContentSpaceLocatorSchema.refine(
    (locator) => locator.kind === 'content-space.file-reference',
    'Task inputs must be ContentSpace file locators.'
  ),
  destinationName: taskFileDestinationNameSchema,
  expectedSemanticRevision: canonicalOpaqueSchema(256).nullable()
}).strict()

export const taskFileOutputIntentSchema = z.object({
  kind: z.literal('content-space.output-new'),
  target: z.literal('project-binding-root'),
  mode: z.literal('upload-new')
}).strict()

export const taskFileIntentSchema = z.object({
  schemaVersion: z.literal(1),
  bindingRevision: revisionSchema,
  inputs: z.array(taskFileInputIntentSchema).min(1).max(100),
  output: taskFileOutputIntentSchema
}).strict().superRefine((intent, context) => {
  const destinations = intent.inputs.map((input) => input.destinationName)
  if (new Set(destinations).size !== destinations.length) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Task input destination names must be unique.' })
  }
  const locators = intent.inputs.map((input) => JSON.stringify(input.locator))
  if (new Set(locators).size !== locators.length) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: 'Task input locators must be unique.' })
  }
})
export type TaskFileIntent = z.infer<typeof taskFileIntentSchema>

export const taskExecutionFenceSchema = z.object({
  executionId: executionIdSchema,
  assigneeAgentId: agentIdSchema,
  taskRevision: revisionSchema,
  bindingRevision: revisionSchema.nullable(),
  intentDigest: sha256Schema
}).strict()
export type TaskExecutionFence = z.infer<typeof taskExecutionFenceSchema>

export const cloudResourceRefRoleSchema = z.enum(['input-file', 'output-container'])
export const cloudResourceRefStatusSchema = z.enum(['available', 'invalidated', 'revoked'])

export const cloudResourceRefSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('resource_ref'),
  resourceRefId: resourceRefIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  taskRevision: revisionSchema,
  bindingRevision: revisionSchema,
  intentDigest: sha256Schema,
  role: cloudResourceRefRoleSchema,
  ordinal: z.number().int().min(0).max(100),
  locator: portableContentSpaceLocatorSchema,
  locatorDigest: sha256Schema,
  status: cloudResourceRefStatusSchema,
  invalidatedAt: timestampSchema.nullable()
}).strict().superRefine((resource, context) => {
  const expectedKind = resource.role === 'input-file'
    ? 'content-space.file-reference'
    : 'content-space.container-reference'
  if (resource.locator.kind !== expectedKind) {
    context.addIssue({ code: 'custom', path: ['locator', 'kind'], message: 'Resource role and locator kind disagree.' })
  }
  if ((resource.status === 'available') !== (resource.invalidatedAt === null)) {
    context.addIssue({ code: 'custom', path: ['invalidatedAt'], message: 'Only unavailable ResourceRefs have an invalidation time.' })
  }
})
export type CloudResourceRef = z.infer<typeof cloudResourceRefSchema>
