import { z } from 'zod'

import type { PortableResourceReferenceEnvelope } from '@sciforge/domain-sdk/portable-resource-references'

import {
  contentSpacePageRequestSchema,
  contentSpaceReadinessReasonSchema,
  contentSpaceReadinessSchema,
  parsePortableContentContainerReference,
  toPortableContentContainerReference,
  type ContentSpacePageRequest
} from './contract.js'

export const CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION = '1.0.0' as const
export const PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION = '1.0.0' as const

export const CONTENT_SPACE_ADMINISTRATION_OPERATIONS = Object.freeze([
  'list-spaces',
  'create-space',
  'observe-space',
  'update-space',
  'pin-space',
  'unpin-space',
  'open-root',
  'list-members',
  'add-member',
  'remove-member',
  'provision-project'
] as const)

export const contentSpaceAdministrationOperationSchema = z.enum(
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS
)
export type ContentSpaceAdministrationOperation = z.infer<
  typeof contentSpaceAdministrationOperationSchema
>

export const contentSpaceAdministrationOperationStateSchema = z.object({
  operation: contentSpaceAdministrationOperationSchema,
  readiness: contentSpaceReadinessSchema,
  reasonCode: contentSpaceReadinessReasonSchema
}).strict().superRefine((state, context) => {
  const available = state.reasonCode === 'available'
  const ready = state.readiness === 'production_ready'
  if (available !== ready) {
    context.addIssue({
      code: 'custom',
      path: ['reasonCode'],
      message: 'Only production-ready administration operations may use the available reason.'
    })
  }
}).readonly()

export const contentSpaceAdministrationOperationStateListSchema = z.array(
  contentSpaceAdministrationOperationStateSchema
).length(CONTENT_SPACE_ADMINISTRATION_OPERATIONS.length).superRefine((states, context) => {
  const seen = new Set<ContentSpaceAdministrationOperation>()
  for (const [index, state] of states.entries()) {
    if (seen.has(state.operation)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'operation'],
        message: `Administration operation ${state.operation} is duplicated.`
      })
    }
    seen.add(state.operation)
  }
}).readonly()

export type ContentSpaceAdministrationOperationState = z.infer<
  typeof contentSpaceAdministrationOperationStateSchema
>

const consumerResourceIdSchema = z.string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)

const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^idem_[A-Za-z0-9._:-]+$/u)

const projectLabelSchema = z.string().trim().min(1).max(256)

export const projectContentSpaceProvisioningIntentSchema = z.object({
  projectId: consumerResourceIdSchema,
  projectLabel: projectLabelSchema,
  contentOwnerUserId: consumerResourceIdSchema,
  contentMemberUserIds: z.array(consumerResourceIdSchema)
    .max(1_000)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Content member users must be unique.'
    })
    .readonly(),
  coordinatorAgentId: consumerResourceIdSchema,
  intentRevision: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

export type ProjectContentSpaceProvisioningIntent = z.infer<
  typeof projectContentSpaceProvisioningIntentSchema
>

export const portableContentContainerReferenceEnvelopeSchema = z.unknown().transform(
  (input, context): PortableResourceReferenceEnvelope => {
    try {
      return toPortableContentContainerReference(
        parsePortableContentContainerReference(input)
      )
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Expected a portable Content Container reference.'
      })
      return z.NEVER
    }
  }
)

export const projectContentSpaceProvisioningStatusSchema = z.enum([
  'ready',
  'pending',
  'failed',
  'ownership_sync_required',
  'broken',
  'outcome_unknown'
])

export const projectContentSpaceMemberProvisioningReportSchema = z.object({
  contentUserId: consumerResourceIdSchema,
  status: z.enum(['ready', 'pending', 'failed']),
  reasonCode: z.string().trim().min(1).max(128)
    .regex(/^[a-z][a-z0-9_]*$/u)
    .optional()
}).strict().readonly()

export const projectContentSpaceProvisioningReportSchema = z.object({
  projectId: consumerResourceIdSchema,
  intentRevision: z.number().int().positive(),
  status: projectContentSpaceProvisioningStatusSchema,
  root: portableContentContainerReferenceEnvelopeSchema.optional(),
  contentOwnerUserId: consumerResourceIdSchema,
  members: z.array(projectContentSpaceMemberProvisioningReportSchema)
    .max(1_000)
    .refine((values) => new Set(values.map((value) => value.contentUserId)).size === values.length, {
      message: 'Content member reports must be unique.'
    })
    .readonly()
}).strict().superRefine((report, context) => {
  if (['ready', 'ownership_sync_required', 'broken'].includes(report.status) && !report.root) {
    context.addIssue({
      code: 'custom',
      path: ['root'],
      message: `A ${report.status} Project requires a portable Content Container root.`
    })
  }
  if (report.status === 'ready' && report.members.some((member) => member.status !== 'ready')) {
    context.addIssue({
      code: 'custom',
      path: ['members'],
      message: 'A ready Project requires every member to be ready.'
    })
  }
}).readonly()

export type ProjectContentSpaceProvisioningStatus = z.infer<
  typeof projectContentSpaceProvisioningStatusSchema
>
export type ProjectContentSpaceMemberProvisioningReport = z.infer<
  typeof projectContentSpaceMemberProvisioningReportSchema
>
export type ProjectContentSpaceProvisioningReport = z.infer<
  typeof projectContentSpaceProvisioningReportSchema
>

const administrationRevisionSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)

export const contentSpaceAdministrationSpaceSummarySchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  label: projectLabelSchema,
  contentOwnerUserId: consumerResourceIdSchema,
  pinned: z.boolean(),
  revision: administrationRevisionSchema
}).strict().readonly()

export const contentSpaceAdministrationSpacePageSchema = z.object({
  items: z.array(contentSpaceAdministrationSpaceSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()

export const contentSpaceAdministrationListSpacesInputSchema = z.object({
  page: contentSpacePageRequestSchema
}).strict().readonly()

export const contentSpaceAdministrationCreateSpaceInputSchema = z.object({
  label: projectLabelSchema,
  contentOwnerUserId: consumerResourceIdSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

export const contentSpaceAdministrationObserveSpaceInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema
}).strict().readonly()

export const contentSpaceAdministrationUpdateSpaceInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  expectedRevision: administrationRevisionSchema,
  label: projectLabelSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

const contentSpaceAdministrationRootMutationInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  expectedRevision: administrationRevisionSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

export const contentSpaceAdministrationPinSpaceInputSchema =
  contentSpaceAdministrationRootMutationInputSchema
export const contentSpaceAdministrationUnpinSpaceInputSchema =
  contentSpaceAdministrationRootMutationInputSchema

export const contentSpaceAdministrationOpenRootInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema
}).strict().readonly()

export const contentSpaceAdministrationRootOpenResultSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  revision: administrationRevisionSchema
}).strict().readonly()

export const contentSpaceAdministrationMemberRoleSchema = z.enum([
  'owner',
  'manager',
  'internal',
  'external'
])

export const contentSpaceAdministrationMemberSummarySchema = z.object({
  contentUserId: consumerResourceIdSchema,
  role: contentSpaceAdministrationMemberRoleSchema,
  revision: administrationRevisionSchema
}).strict().readonly()

export const contentSpaceAdministrationMemberPageSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  items: z.array(contentSpaceAdministrationMemberSummarySchema).max(1_000).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()

export const contentSpaceAdministrationListMembersInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  page: contentSpacePageRequestSchema
}).strict().readonly()

const contentSpaceAdministrationMemberMutationInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  contentUserId: consumerResourceIdSchema,
  expectedRevision: administrationRevisionSchema,
  idempotencyKey: idempotencyKeySchema
}).strict().readonly()

export const contentSpaceAdministrationAddMemberInputSchema =
  contentSpaceAdministrationMemberMutationInputSchema
export const contentSpaceAdministrationRemoveMemberInputSchema =
  contentSpaceAdministrationMemberMutationInputSchema

export const contentSpaceAdministrationRemoveMemberReceiptSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  contentUserId: consumerResourceIdSchema,
  removed: z.literal(true),
  revision: administrationRevisionSchema
}).strict().readonly()

export type ContentSpaceAdministrationSpaceSummary = z.infer<
  typeof contentSpaceAdministrationSpaceSummarySchema
>
export type ContentSpaceAdministrationSpacePage = z.infer<
  typeof contentSpaceAdministrationSpacePageSchema
>
export type ContentSpaceAdministrationCreateSpaceInput = z.infer<
  typeof contentSpaceAdministrationCreateSpaceInputSchema
>
export type ContentSpaceAdministrationObserveSpaceInput = z.infer<
  typeof contentSpaceAdministrationObserveSpaceInputSchema
>
export type ContentSpaceAdministrationUpdateSpaceInput = z.infer<
  typeof contentSpaceAdministrationUpdateSpaceInputSchema
>
export type ContentSpaceAdministrationPinSpaceInput = z.infer<
  typeof contentSpaceAdministrationPinSpaceInputSchema
>
export type ContentSpaceAdministrationUnpinSpaceInput = z.infer<
  typeof contentSpaceAdministrationUnpinSpaceInputSchema
>
export type ContentSpaceAdministrationOpenRootInput = z.infer<
  typeof contentSpaceAdministrationOpenRootInputSchema
>
export type ContentSpaceAdministrationRootOpenResult = z.infer<
  typeof contentSpaceAdministrationRootOpenResultSchema
>
export type ContentSpaceAdministrationMemberRole = z.infer<
  typeof contentSpaceAdministrationMemberRoleSchema
>
export type ContentSpaceAdministrationMemberSummary = z.infer<
  typeof contentSpaceAdministrationMemberSummarySchema
>
export type ContentSpaceAdministrationMemberPage = z.infer<
  typeof contentSpaceAdministrationMemberPageSchema
>
export type ContentSpaceAdministrationListMembersInput = z.infer<
  typeof contentSpaceAdministrationListMembersInputSchema
>
export type ContentSpaceAdministrationAddMemberInput = z.infer<
  typeof contentSpaceAdministrationAddMemberInputSchema
>
export type ContentSpaceAdministrationRemoveMemberInput = z.infer<
  typeof contentSpaceAdministrationRemoveMemberInputSchema
>
export type ContentSpaceAdministrationRemoveMemberReceipt = z.infer<
  typeof contentSpaceAdministrationRemoveMemberReceiptSchema
>

export type ContentSpaceAdministrationPort = Readonly<{
  contractVersion: typeof CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION
  listSpaces(input: Readonly<{
    page: ContentSpacePageRequest
  }>): Promise<ContentSpaceAdministrationSpacePage>
  createSpace(
    input: ContentSpaceAdministrationCreateSpaceInput
  ): Promise<ContentSpaceAdministrationSpaceSummary>
  observeSpace(
    input: ContentSpaceAdministrationObserveSpaceInput
  ): Promise<ContentSpaceAdministrationSpaceSummary>
  updateSpace(
    input: ContentSpaceAdministrationUpdateSpaceInput
  ): Promise<ContentSpaceAdministrationSpaceSummary>
  pinSpace(
    input: ContentSpaceAdministrationPinSpaceInput
  ): Promise<ContentSpaceAdministrationSpaceSummary>
  unpinSpace(
    input: ContentSpaceAdministrationUnpinSpaceInput
  ): Promise<ContentSpaceAdministrationSpaceSummary>
  openRoot(
    input: ContentSpaceAdministrationOpenRootInput
  ): Promise<ContentSpaceAdministrationRootOpenResult>
  listMembers(
    input: ContentSpaceAdministrationListMembersInput
  ): Promise<ContentSpaceAdministrationMemberPage>
  addMember(
    input: ContentSpaceAdministrationAddMemberInput
  ): Promise<ContentSpaceAdministrationMemberSummary>
  removeMember(
    input: ContentSpaceAdministrationRemoveMemberInput
  ): Promise<ContentSpaceAdministrationRemoveMemberReceipt>
}>

export function defineContentSpaceAdministrationPort(
  input: ContentSpaceAdministrationPort
): ContentSpaceAdministrationPort {
  const methods = [
    'addMember',
    'createSpace',
    'listMembers',
    'listSpaces',
    'observeSpace',
    'openRoot',
    'pinSpace',
    'removeMember',
    'unpinSpace',
    'updateSpace'
  ] as const
  if (!isExactPort(input, ['contractVersion', ...methods]) ||
    input.contractVersion !== CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION ||
    methods.some((method) => typeof input[method] !== 'function')) {
    throw new TypeError('Content Space administration port is invalid.')
  }
  return Object.freeze(input)
}

export type ProjectContentSpaceProvisioningPort = Readonly<{
  contractVersion: typeof PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION
  provisionProjectContentSpace(
    intent: ProjectContentSpaceProvisioningIntent
  ): Promise<ProjectContentSpaceProvisioningReport>
}>

export function defineProjectContentSpaceProvisioningPort(
  input: ProjectContentSpaceProvisioningPort
): ProjectContentSpaceProvisioningPort {
  if (!isExactPort(input, ['contractVersion', 'provisionProjectContentSpace']) ||
    input.contractVersion !== PROJECT_CONTENT_SPACE_PROVISIONING_CONTRACT_VERSION ||
    typeof input.provisionProjectContentSpace !== 'function') {
    throw new TypeError('Project Content Space provisioning port is invalid.')
  }
  return Object.freeze(input)
}

function isExactPort(input: unknown, expectedKeys: readonly string[]): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) &&
    Object.keys(input).sort().join(',') === [...expectedKeys].sort().join(',')
}
