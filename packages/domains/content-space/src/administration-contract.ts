import { z } from 'zod'

import {
  domainCapabilityResourceHandleSchema,
  type DomainCapabilityContract
} from '@sciforge/domain-sdk/host'
import type { PortableResourceReferenceEnvelope } from '@sciforge/domain-sdk/portable-resource-references'

import {
  CONTENT_SPACE_CAPABILITY_IDS,
  contentSpacePageRequestSchema,
  contentSpaceDirectoryUserReferenceSchema,
  contentSpacePortableContainerReferenceEnvelopeSchema,
  contentSpaceProviderInstanceInputSchema,
  contentSpaceReadinessReasonSchema,
  contentSpaceReadinessSchema,
  contentSpaceResultSchema,
  parsePortableContentContainerReference,
  toPortableContentContainerReference,
  type ContentSpacePageRequest
} from './contract.js'

export const CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION = '3.0.0' as const

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
  'remove-member'
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

const administrationSpaceLabelSchema = z.string().trim().min(1).max(256)

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

export const contentSpaceAdministrationSpaceSummarySchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  label: administrationSpaceLabelSchema,
  contentOwnerUserId: consumerResourceIdSchema,
  pinned: z.boolean()
}).strict().readonly()

export const contentSpaceAdministrationSpacePageSchema = z.object({
  items: z.array(contentSpaceAdministrationSpaceSummarySchema).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()

export const contentSpaceAdministrationListSpacesInputSchema = z.object({
  page: contentSpacePageRequestSchema
}).strict().readonly()

const administrationCreateSpaceInputShape = Object.freeze({
  label: administrationSpaceLabelSchema
})

/** Agent business input omits owner and invocation identity; Broker context supplies both. */
export const contentSpaceAgentAdministrationCreateSpaceInputSchema = z.object({
  ...administrationCreateSpaceInputShape
}).strict().readonly()

export const contentSpaceAdministrationCreateSpaceInputSchema = z.object({
  ...administrationCreateSpaceInputShape,
  contentOwnerUserId: consumerResourceIdSchema
}).strict().readonly()

export const contentSpaceAdministrationObserveSpaceInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema
}).strict().readonly()

export const contentSpaceAdministrationUpdateSpaceInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  label: administrationSpaceLabelSchema
}).strict().readonly()

const contentSpaceAdministrationRootMutationInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema
}).strict().readonly()

export const contentSpaceAdministrationPinSpaceInputSchema =
  contentSpaceAdministrationRootMutationInputSchema
export const contentSpaceAdministrationUnpinSpaceInputSchema =
  contentSpaceAdministrationRootMutationInputSchema

export const contentSpaceAdministrationOpenRootInputSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema
}).strict().readonly()

export const contentSpaceAdministrationRootOpenResultSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema
}).strict().readonly()

export const contentSpaceAdministrationMemberReferenceSchema =
  contentSpaceDirectoryUserReferenceSchema

export const contentSpaceAdministrationMemberSummarySchema = z.object({
  member: contentSpaceAdministrationMemberReferenceSchema
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
  member: contentSpaceAdministrationMemberReferenceSchema
}).strict().readonly()

export const contentSpaceAdministrationAddMemberInputSchema =
  contentSpaceAdministrationMemberMutationInputSchema
export const contentSpaceAdministrationRemoveMemberInputSchema =
  contentSpaceAdministrationMemberMutationInputSchema

export const contentSpaceAdministrationAddMemberReceiptSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  member: contentSpaceAdministrationMemberReferenceSchema
}).strict().readonly()

export const contentSpaceAdministrationRemoveMemberReceiptSchema = z.object({
  root: portableContentContainerReferenceEnvelopeSchema,
  member: contentSpaceAdministrationMemberReferenceSchema,
  removed: z.literal(true)
}).strict().readonly()

export const contentSpaceAgentProviderAdministrationAuthorizationSchema = z.object({
  providerInstanceRef: contentSpaceProviderInstanceInputSchema.unwrap().shape.providerInstanceRef,
  resource: domainCapabilityResourceHandleSchema
}).strict().readonly()

export const contentSpaceAgentAdministrationSpaceSummarySchema = z.object({
  root: contentSpacePortableContainerReferenceEnvelopeSchema,
  label: administrationSpaceLabelSchema,
  contentOwnerUserId: consumerResourceIdSchema,
  pinned: z.boolean()
}).strict().readonly()

export const contentSpaceAgentAdministrationCreateSpaceResultSchema = z.object({
  space: contentSpaceAgentAdministrationSpaceSummarySchema,
  resource: domainCapabilityResourceHandleSchema
}).strict().readonly()

/** Broker resource authority supplies the exact root; callers supply only bounded paging. */
export const contentSpaceAgentAdministrationListMembersInputSchema = z.object({
  page: contentSpacePageRequestSchema
}).strict().readonly()

/** Broker resource authority supplies the exact root; callers supply only a directory User. */
export const contentSpaceAgentAdministrationMemberMutationInputSchema = z.object({
  member: contentSpaceAdministrationMemberReferenceSchema
}).strict().readonly()

export const contentSpaceAgentAdministrationMemberPageSchema = z.object({
  root: contentSpacePortableContainerReferenceEnvelopeSchema,
  items: z.array(contentSpaceAdministrationMemberSummarySchema).max(1_000).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()

export const contentSpaceAgentAdministrationAddMemberReceiptSchema = z.object({
  root: contentSpacePortableContainerReferenceEnvelopeSchema,
  member: contentSpaceAdministrationMemberReferenceSchema
}).strict().readonly()

export const contentSpaceAgentAdministrationRemoveMemberReceiptSchema = z.object({
  root: contentSpacePortableContainerReferenceEnvelopeSchema,
  member: contentSpaceAdministrationMemberReferenceSchema,
  removed: z.literal(true)
}).strict().readonly()

export const contentSpaceAgentProviderAdministrationAuthorizationResultSchema =
  contentSpaceResultSchema(contentSpaceAgentProviderAdministrationAuthorizationSchema)
export const contentSpaceAgentAdministrationCreateSpaceCapabilityResultSchema =
  contentSpaceResultSchema(contentSpaceAgentAdministrationCreateSpaceResultSchema)
export const contentSpaceAgentAdministrationListMembersResultSchema =
  contentSpaceResultSchema(contentSpaceAgentAdministrationMemberPageSchema)
export const contentSpaceAgentAdministrationAddMemberResultSchema =
  contentSpaceResultSchema(contentSpaceAgentAdministrationAddMemberReceiptSchema)
export const contentSpaceAgentAdministrationRemoveMemberResultSchema =
  contentSpaceResultSchema(contentSpaceAgentAdministrationRemoveMemberReceiptSchema)

export const CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT: DomainCapabilityContract<
  z.infer<typeof contentSpaceProviderInstanceInputSchema>,
  z.infer<typeof contentSpaceAgentProviderAdministrationAuthorizationResultSchema>
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
  effect: 'external-write',
  inputSchema: contentSpaceProviderInstanceInputSchema,
  outputSchema: contentSpaceAgentProviderAdministrationAuthorizationResultSchema
})

export const CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT: DomainCapabilityContract<
  z.infer<typeof contentSpaceAgentAdministrationCreateSpaceInputSchema>,
  z.infer<typeof contentSpaceAgentAdministrationCreateSpaceCapabilityResultSchema>
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace,
  effect: 'external-write',
  inputSchema: contentSpaceAgentAdministrationCreateSpaceInputSchema,
  outputSchema: contentSpaceAgentAdministrationCreateSpaceCapabilityResultSchema
})

export const CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT: DomainCapabilityContract<
  z.infer<typeof contentSpaceAgentAdministrationListMembersInputSchema>,
  z.infer<typeof contentSpaceAgentAdministrationListMembersResultSchema>
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminListMembers,
  effect: 'read',
  inputSchema: contentSpaceAgentAdministrationListMembersInputSchema,
  outputSchema: contentSpaceAgentAdministrationListMembersResultSchema
})

export const CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT: DomainCapabilityContract<
  z.infer<typeof contentSpaceAgentAdministrationMemberMutationInputSchema>,
  z.infer<typeof contentSpaceAgentAdministrationAddMemberResultSchema>
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminAddMember,
  effect: 'external-write',
  inputSchema: contentSpaceAgentAdministrationMemberMutationInputSchema,
  outputSchema: contentSpaceAgentAdministrationAddMemberResultSchema
})

export const CONTENT_SPACE_AGENT_ADMIN_REMOVE_MEMBER_CONTRACT: DomainCapabilityContract<
  z.infer<typeof contentSpaceAgentAdministrationMemberMutationInputSchema>,
  z.infer<typeof contentSpaceAgentAdministrationRemoveMemberResultSchema>
> = Object.freeze({
  actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember,
  effect: 'destructive',
  inputSchema: contentSpaceAgentAdministrationMemberMutationInputSchema,
  outputSchema: contentSpaceAgentAdministrationRemoveMemberResultSchema
})

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
export type ContentSpaceAdministrationAddMemberReceipt = z.infer<
  typeof contentSpaceAdministrationAddMemberReceiptSchema
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
  ): Promise<ContentSpaceAdministrationAddMemberReceipt>
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

function isExactPort(input: unknown, expectedKeys: readonly string[]): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) &&
    Object.keys(input).sort().join(',') === [...expectedKeys].sort().join(',')
}
