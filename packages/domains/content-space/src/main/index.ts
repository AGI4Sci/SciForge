import { createHash, randomUUID } from 'node:crypto'

import { z } from 'zod'

import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution,
  DomainMainSystemCapabilityGrant
} from '@sciforge/domain-sdk/host'
import {
  defineDomainMainSystemCapabilityGrant,
  domainCapabilityResourceHandleSchema
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import type { PortableResourceAuthorityResolver } from '@sciforge/domain-sdk/portable-resource-references'
import { DomainExternalNavigationError } from '@sciforge/domain-sdk/external-navigation'

import {
  CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRIBUTION,
  CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRACT,
  CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
  CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRIBUTION,
  CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRACT,
  CONTENT_SPACE_DOMAIN_MODULE_ID,
  CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRIBUTION,
  CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRACT,
  CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRIBUTION,
  CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRACT,
  CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION,
  CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION,
  CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_CONTAINER_REFERENCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND,
  CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND,
  CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
  CONTENT_SPACE_CAPABILITY_IDS,
  CONTENT_SPACE_LIMITS,
  CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID,
  ContentSpaceOperationError,
  artifactReferenceCodec,
  contentContainerReferenceCodec,
  contentFileReferenceCodec,
  contentSpaceCapabilityListResultSchema,
  contentSpaceAgentRootCandidatePageResultSchema,
  contentSpaceAgentCreateFolderInputSchema,
  contentSpaceAgentDownloadInputSchema,
  contentSpaceAgentEntryPageResultSchema,
  contentSpaceAgentListEntriesInputSchema,
  contentSpaceAgentRootAuthorizationResultSchema,
  contentSpaceAgentUploadNewInputSchema,
  contentSpaceAuthorizeAgentRootInputSchema,
  contentSpaceContainerPageResultSchema,
  contentContainerReferenceSchema,
  contentSpaceCreateFolderInputSchema,
  contentSpaceDownloadInputSchema,
  contentSpaceEntryObservationResultSchema,
  contentSpaceEntryPageResultSchema,
  contentSpaceFailure,
  contentSpaceListContainersInputSchema,
  contentSpaceListAgentRootCandidatesInputSchema,
  contentSpaceListEntriesInputSchema,
  contentSpaceObserveEntryInputSchema,
  contentSpaceObserveImmutableVersionInputSchema,
  contentSpaceOpenPortalResultSchema,
  contentSpaceOpenPortalTargetInputSchema,
  contentSpaceOpenPortalTargetResultSchema,
  contentSpacePortalTargetResultSchema,
  contentSpacePortableResourceStateSchema,
  contentSpaceProviderInstanceInputSchema,
  contentSpaceProviderInstanceListResultSchema,
  contentSpaceResolvePortalTargetInputSchema,
  contentSpaceSuccess,
  contentSpaceResultSchema,
  contentSpaceSystemDownloadInputSchema,
  contentSpaceSystemExecutionBindingSchema,
  contentSpaceSystemDownloadReceiptSchema,
  contentSpaceSystemDownloadResultSchema,
  contentSpaceSystemTransferPreflightInputSchema,
  contentSpaceSystemTransferPreflightObservationSchema,
  contentSpaceSystemTransferPreflightResultSchema,
  contentSpaceSystemUploadNewInputSchema,
  contentSpaceSystemUploadNewReceiptSchema,
  contentSpaceSystemUploadNewResultSchema,
  contentSpaceUploadNewInputSchema,
  createFolderResultSchema,
  downloadResultSchema,
  immutableVersionObservationResultSchema,
  uploadNewResultSchema,
  parsePortableContentContainerReference,
  toPortableContentContainerReference,
  toPortableContentFileReference,
  type ContentSpaceError,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference,
  type ContentSpacePortableContainerReferenceEnvelope,
  type ContentSpacePortableFileReferenceEnvelope,
  type ContentSpaceSystemTransferPreflightStatus,
  type ContentSpaceResult
} from '../contract.js'
import {
  contentSpaceAgentAdministrationAddMemberReceiptSchema,
  contentSpaceAgentAdministrationCreateSpaceInputSchema,
  contentSpaceAgentAdministrationCreateSpaceResultSchema,
  contentSpaceAgentAdministrationListMembersInputSchema,
  contentSpaceAgentAdministrationMemberMutationInputSchema,
  contentSpaceAgentAdministrationMemberPageSchema,
  contentSpaceAgentProviderAdministrationAuthorizationSchema,
  contentSpaceAdministrationListSpacesInputSchema,
  contentSpaceAdministrationRemoveMemberReceiptSchema,
  contentSpaceAdministrationSpacePageSchema,
  contentSpaceAdministrationSpaceSummarySchema,
  contentSpaceAdministrationUnpinSpaceInputSchema,
  contentSpaceAdministrationUpdateSpaceInputSchema,
  type ContentSpaceAdministrationOperation
} from '../administration-contract.js'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  contentSpaceAgentExtendedRequestSchema,
  type ContentSpaceExtendedOperationKey
} from '../extended-operations-contract.js'
import {
  agentNativeDocumentReceiptSchema,
  agentNativeDocumentRequestSchema
} from '../native-document-contract.js'
import {
  collectContentEntryReferences,
  extendedOperationAuthority,
  extendedOperationEffect,
  nativeDocumentOperationEffect,
  sameContentEntryReference,
  type ContentSpaceProviderFeatureEffect,
  type ContentSpaceProviderFeatureTarget
} from '../provider-features.js'
import {
  createContentSpacePortableAuthorityResolver,
  resolveContentSpacePortableInvocationReference
} from './portable-authority-resolver.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'
import { composeContentSpaceVerificationPolicy } from './verification-policy-catalog.js'
import {
  ContentSpaceService,
  type ContentSpaceServiceCallContext,
  type ContentSpaceServiceFeatureCallContext,
  type ContentSpaceServiceWriteCallContext
} from './service.js'

type ContentSpaceCapabilityContext = Readonly<{
  caller: Readonly<{
    audience: 'ui' | 'agent' | 'system'
    callerId: string
    principal?: PrincipalSnapshot
    workspaceId?: string
    capabilityGrants?: readonly string[]
    principalSnapshotDigest?: string
    executionContextDigest?: string
  }>
  invocationId?: string
  signal?: AbortSignal
  assertPrincipalCurrent(): void
  resource?: Readonly<{
    resourceId: string
    resourceKind: string
    workspaceId?: string
  }>
  issueResource(registration: Readonly<{
    resourceId: string
    resourceKind: string
    workspaceId?: string
    audiences?: readonly ('ui' | 'agent' | 'system')[]
    semanticRevision: string
    observe(
      caller: ContentSpaceCapabilityContext['caller'],
      context: Readonly<{ signal?: AbortSignal }>
    ): unknown | Promise<unknown>
    dispose?: () => void | Promise<void>
    retireAfterLastHandleExpires?: boolean
    expiresInMs?: number
  }>): unknown
}>

type ContentSpaceCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global' | 'workspace' | 'resource'
  resourceKinds?: readonly string[]
  producedResourceKinds?: readonly string[]
  effect: 'read' | 'workspace-write' | 'external-write' | 'destructive'
  approval: 'none' | 'confirmation'
  delegatedBatchGrant?: string
  autonomousWrite?: 'resource-authorized'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler(
    input: any,
    context: ContentSpaceCapabilityContext
  ): Promise<Readonly<{
    output: unknown
    changed?: boolean
    semanticRevision?: string
  }>>
}>

type ContentSpaceCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof CONTENT_SPACE_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'content-space'
    title: 'Content Space'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions(): readonly CapabilityDefinition[]
}>

type ContentSpaceRuntime = Readonly<{
  catalog: ContentSpaceProviderCatalog
  service: ContentSpaceService
}>

type ContentSpaceMainContribution =
  | ContentSpaceCapabilityFactory
  | DomainMainRuntimeLifecycleContribution
  | DomainMainSystemCapabilityGrant
  | typeof contentContainerReferenceCodec
  | typeof contentFileReferenceCodec
  | typeof artifactReferenceCodec
  | PortableResourceAuthorityResolver

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<ContentSpaceMainContribution> {
  let runtime: ContentSpaceRuntime | undefined
  const getRuntime = (): ContentSpaceRuntime => {
    if (!runtime) {
      throw operationError('composition_not_ready', 'Content Space runtime is not activated.')
    }
    return runtime
  }
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: ({ contributions }) => {
      if (!contributions) {
        throw new Error('Content Space requires complete main extension composition.')
      }
      const catalog = new ContentSpaceProviderCatalog(contributions)
      const verificationPolicy = composeContentSpaceVerificationPolicy(contributions)
      runtime = Object.freeze({
        catalog,
        service: new ContentSpaceService({
          catalog,
          platform: Object.freeze({
            fileTransfers: Boolean(host.fileTransfers),
            externalNavigation: Boolean(host.externalNavigation)
          }),
          ...(host.fileTransfers ? { featureFileTransfers: host.fileTransfers } : {}),
          ...(verificationPolicy ? { verificationPolicy } : {})
        })
      })
      return () => {
        runtime = undefined
      }
    }
  })
  const resolver = createContentSpacePortableAuthorityResolver({
    getCatalog: () => getRuntime().catalog,
    getService: () => getRuntime().service
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createContentSpaceCapabilityFactory({
          defineCapability: host.defineCapability as (
            options: ContentSpaceCapabilityOptions
          ) => unknown,
          getService: () => getRuntime().service,
          portableResolver: resolver,
          fileTransfers: host.fileTransfers,
          externalNavigation: host.externalNavigation
        })
      },
      {
        ...CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle
      },
      {
        ...CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_CONTRIBUTION,
        value: defineDomainMainSystemCapabilityGrant({
          id: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID,
          eligibility: 'trusted-domain-runtime',
          description: 'Transfer files through Content Space under exact Workspace and Provider authority.'
        })
      },
      {
        ...CONTENT_SPACE_PROVISIONING_BATCH_GRANT_CONTRIBUTION,
        value: defineDomainMainSystemCapabilityGrant({
          id: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
          eligibility: 'trusted-domain-runtime',
          description: 'Execute one exact Human-confirmed Content Space provisioning batch.'
        })
      },
      {
        ...CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRIBUTION,
        contract: CONTENT_SPACE_CONTAINER_REFERENCE_CODEC_CONTRACT,
        value: contentContainerReferenceCodec
      },
      {
        ...CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRIBUTION,
        contract: CONTENT_SPACE_FILE_REFERENCE_CODEC_CONTRACT,
        value: contentFileReferenceCodec
      },
      {
        ...CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRIBUTION,
        contract: CONTENT_SPACE_ARTIFACT_REFERENCE_CODEC_CONTRACT,
        value: artifactReferenceCodec
      },
      {
        ...CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRIBUTION,
        contract: CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_CONTRACT,
        value: resolver
      }
    ]
  }
}

function createContentSpaceCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability(options: ContentSpaceCapabilityOptions): CapabilityDefinition
  getService(): ContentSpaceService
  portableResolver: ReturnType<typeof createContentSpacePortableAuthorityResolver>
  fileTransfers?: NonNullable<DomainMainHost['fileTransfers']>
  externalNavigation?: NonNullable<DomainMainHost['externalNavigation']>
}>): ContentSpaceCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<ContentSpaceCapabilityOptions, 'version' | 'audiences' | 'scope' | 'tags'> &
      Readonly<{
        audiences?: ContentSpaceCapabilityOptions['audiences']
        scope?: ContentSpaceCapabilityOptions['scope']
        tags?: ContentSpaceCapabilityOptions['tags']
        version?: ContentSpaceCapabilityOptions['version']
      }>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: input.version ?? '1.0.0',
    audiences: input.audiences ?? ['ui', 'agent', 'system'],
    scope: input.scope ?? 'global',
    tags: Object.freeze(Array.from(new Set([
      'content-space',
      'provider-neutral',
      ...(input.tags ?? [])
    ])))
  })

  type AgentResourceRecord = Readonly<{
    resourceId: string
    root: ContentContainerReference
    reference: ContentEntryReference
    callerId: string
    principal: PrincipalSnapshot
    workspaceId?: string
    revisionState: {
      observedRevision: string
      writeInvocationId?: string
    }
  }>
  const agentResources = new Map<string, AgentResourceRecord>()
  const verificationBinding = (record: AgentResourceRecord) => Object.freeze({
    root: record.root,
    reference: record.reference
  })
  type AgentAdministrationResourceRecord = Readonly<{
    resourceId: string
    providerInstanceRef: string
    callerId: string
    principal: PrincipalSnapshot
    workspaceId?: string
    revisionState: {
      observedRevision: string
      writeInvocationId?: string
    }
  }>
  const agentAdministrationResources = new Map<string, AgentAdministrationResourceRecord>()
  type AgentFeatureSelectionRecord = Readonly<{
    resourceId: string
    root: ContentContainerReference
    primary: AgentResourceRecord
    constituents: readonly Readonly<{
      record: AgentResourceRecord
      semanticRevision: string
    }>[]
    operation: ContentSpaceExtendedOperationKey
    requestDigest: string
    callerId: string
    principal: PrincipalSnapshot
    workspaceId?: string
    revisionState: {
      observedRevision: string
      writeInvocationId?: string
    }
  }>
  const agentFeatureSelections = new Map<string, AgentFeatureSelectionRecord>()
  const resolveSelectableAgentRoot = async (
    selection: Readonly<{
      providerInstanceRef: string
      scope: 'personal' | 'shared'
      label: string
    }>,
    context: ContentSpaceCapabilityContext
  ): Promise<ContentContainerReference> => {
    let cursor: string | undefined
    const seen = new Set<string>()
    const matches: ContentContainerReference[] = []
    const requestedLabel = canonicalLibraryLabel(selection.label)
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await options.getService().listContainers({
        providerInstanceRef: selection.providerInstanceRef,
        page: { limit: CONTENT_SPACE_LIMITS.maxPageItems, ...(cursor ? { cursor } : {}) }
      }, call(context))
      for (const item of page.items) {
        if (
          item.reference.providerInstanceRef === selection.providerInstanceRef &&
          item.scope === selection.scope &&
          canonicalLibraryLabel(item.label) === requestedLabel
        ) {
          matches.push(item.reference)
          if (matches.length > 1) {
            throw operationError(
              'invalid_target',
              'Multiple accessible Content Space roots match that library label and scope.'
            )
          }
        }
      }
      if (!page.nextCursor) {
        if (matches.length === 1) return matches[0]!
        throw operationError(
          'invalid_target',
          'No accessible Content Space root matches that library label and scope.'
        )
      }
      if (seen.has(page.nextCursor)) {
        throw operationError(
          'provider_unavailable',
          'Content Space root discovery returned a cyclic page cursor.'
        )
      }
      seen.add(page.nextCursor)
      cursor = page.nextCursor
    }
    throw operationError(
      'provider_unavailable',
      'Content Space root discovery exceeded the bounded page limit.'
    )
  }
  const requireAgentResource = (
    context: ContentSpaceCapabilityContext,
    kind: 'container' | 'file'
  ): AgentResourceRecord => {
    const resourceId = context.resource?.resourceId
    const record = resourceId ? agentResources.get(resourceId) : undefined
    if (
      context.caller.audience !== 'agent' || !record ||
      record.callerId !== context.caller.callerId ||
      !samePrincipalSnapshot(record.principal, context.caller.principal) ||
      record.workspaceId !== context.caller.workspaceId ||
      context.resource?.resourceKind !== (kind === 'container'
        ? CONTENT_CONTAINER_RESOURCE_KIND
        : CONTENT_FILE_RESOURCE_KIND) ||
      context.resource?.workspaceId !== record.workspaceId ||
      (kind === 'container' ? !('containerId' in record.reference) : !('fileId' in record.reference))
    ) {
      throw operationError('unauthorized', 'The Agent Content Space scope is unavailable.')
    }
    return record
  }
  const issueAgentResource = (
    context: ContentSpaceCapabilityContext,
    root: ContentContainerReference,
    reference: ContentEntryReference
  ) => {
    if (context.caller.audience !== 'agent' || !context.caller.principal) {
      throw operationError('unauthorized', 'Only a current Agent Principal can receive this scope.')
    }
    if (agentResources.size >= MAX_AGENT_RESOURCE_RECORDS) {
      throw operationError('bounds_exceeded', 'The Agent Content Space scope table is full.')
    }
    const resourceId = `content-space-agent-${randomUUID()}`
    const revisionState = {
      observedRevision: contentSpaceResourceRevision(reference)
    }
    const record: AgentResourceRecord = Object.freeze({
      resourceId,
      root,
      reference,
      callerId: context.caller.callerId,
      principal: context.caller.principal,
      revisionState,
      ...(context.caller.workspaceId ? { workspaceId: context.caller.workspaceId } : {})
    })
    agentResources.set(resourceId, record)
    const assertPrincipalCurrent = context.assertPrincipalCurrent
    try {
      return context.issueResource({
        resourceId,
        resourceKind: 'containerId' in reference
          ? CONTENT_CONTAINER_RESOURCE_KIND
          : CONTENT_FILE_RESOURCE_KIND,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
        audiences: ['agent'],
        semanticRevision: agentResourceRevision(record),
        expiresInMs: 15 * 60_000,
        retireAfterLastHandleExpires: true,
        observe: async (caller, observationContext) => {
          if (
            caller.audience !== 'agent' || caller.callerId !== record.callerId ||
            caller.workspaceId !== record.workspaceId ||
            !caller.principal ||
            !samePrincipalSnapshot(caller.principal, record.principal)
          ) {
            throw operationError('unauthorized', 'The Agent Content Space scope changed.')
          }
          const observation = await options.getService().observeEntry(record.reference, {
            reauthorizedPrincipal: caller.principal,
            assertPrincipalCurrent,
            audience: 'agent',
            verificationBinding: verificationBinding(record),
            ...(observationContext.signal ? { signal: observationContext.signal } : {})
          })
          record.revisionState.observedRevision = contentSpaceResourceRevision(
            record.reference,
            observation.entry
          )
          return Object.freeze({
            state: contentSpacePortableResourceStateSchema.parse({
              reference: record.reference,
              entry: observation.entry,
              capabilities: observation.capabilities
            }),
            semanticRevision: agentResourceRevision(record)
          })
        },
        dispose: () => {
          if (agentResources.get(resourceId) === record) agentResources.delete(resourceId)
        }
      })
    } catch (error) {
      agentResources.delete(resourceId)
      throw error
    }
  }
  const requireAgentFeatureResource = (
    context: ContentSpaceCapabilityContext
  ): AgentResourceRecord => {
    if (context.resource?.resourceKind === CONTENT_CONTAINER_RESOURCE_KIND) {
      return requireAgentResource(context, 'container')
    }
    if (context.resource?.resourceKind === CONTENT_FILE_RESOURCE_KIND) {
      return requireAgentResource(context, 'file')
    }
    throw operationError('unauthorized', 'The Agent Content Space feature scope is unavailable.')
  }
  const featureTarget = (
    record: AgentResourceRecord
  ): Extract<ContentSpaceProviderFeatureTarget, { kind: 'content' }> => {
    return Object.freeze({
      kind: 'content',
      root: record.root,
      primary: record.reference,
      authorized: Object.freeze([record.reference])
    })
  }
  const resolveFeatureSelectionRecords = (
    primary: AgentResourceRecord,
    operation: ContentSpaceExtendedOperationKey,
    request: unknown
  ): readonly AgentResourceRecord[] => {
    const authority = extendedOperationAuthority(operation, request)
    if (authority.kind !== 'entry') {
      throw operationError(
        'unauthorized',
        'Provider-scoped operations require explicit Provider administration authority.'
      )
    }
    if (!sameContentEntryReference(primary.reference, authority.reference)) {
      throw operationError('invalid_target', 'The feature selection does not match Broker authority.')
    }
    const references = collectContentEntryReferences(request)
    const records = references.map((reference) => {
      if (sameContentEntryReference(reference, primary.reference)) return primary
      const match = [...agentResources.values()].find((candidate) =>
        candidate.callerId === primary.callerId &&
        candidate.workspaceId === primary.workspaceId &&
        samePrincipalSnapshot(candidate.principal, primary.principal) &&
        sameContentEntryReference(candidate.root, primary.root) &&
        sameContentEntryReference(candidate.reference, reference)
      )
      if (!match) {
        throw operationError(
          'unauthorized',
          'Every feature-selection reference requires its own live Broker resource.'
        )
      }
      return match
    })
    const uniqueRecords = [...new Map(records.map((record) => [record.resourceId, record])).values()]
    if (uniqueRecords.length < 2 || !uniqueRecords.includes(primary)) {
      throw operationError(
        'invalid_target',
        'A composite feature selection requires at least two exact Broker resources.'
      )
    }
    return Object.freeze(uniqueRecords)
  }
  const issueAgentFeatureSelection = (
    context: ContentSpaceCapabilityContext,
    primary: AgentResourceRecord,
    operation: ContentSpaceExtendedOperationKey,
    request: unknown,
    records: readonly AgentResourceRecord[]
  ) => {
    if (context.caller.audience !== 'agent' || !context.caller.principal) {
      throw operationError('unauthorized', 'Only a current Agent Principal can receive this scope.')
    }
    if (agentFeatureSelections.size >= MAX_AGENT_RESOURCE_RECORDS) {
      throw operationError('bounds_exceeded', 'The Agent feature-selection scope table is full.')
    }
    const constituents = Object.freeze(records.map((record) => Object.freeze({
      record,
      semanticRevision: agentResourceRevision(record)
    })))
    const requestDigest = extendedFeatureSelectionDigest({
      operation,
      root: primary.root,
      primary: primary.reference,
      records: constituents.map(({ record, semanticRevision }) => Object.freeze({
        reference: record.reference,
        semanticRevision
      })),
      request
    })
    const resourceId = `content-space-feature-selection-${randomUUID()}`
    const record: AgentFeatureSelectionRecord = Object.freeze({
      resourceId,
      root: primary.root,
      primary,
      constituents,
      operation,
      requestDigest,
      callerId: primary.callerId,
      principal: primary.principal,
      revisionState: {
        observedRevision: `selection:${requestDigest}`
      },
      ...(primary.workspaceId ? { workspaceId: primary.workspaceId } : {})
    })
    agentFeatureSelections.set(resourceId, record)
    try {
      const resource = context.issueResource({
        resourceId,
        resourceKind: CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
        audiences: ['agent'],
        semanticRevision: agentResourceRevision(record),
        expiresInMs: AGENT_FEATURE_SELECTION_TTL_MS,
        retireAfterLastHandleExpires: true,
        observe: (caller) => {
          if (caller.audience !== 'agent' || caller.callerId !== record.callerId ||
            caller.workspaceId !== record.workspaceId || !caller.principal ||
            !samePrincipalSnapshot(caller.principal, record.principal) ||
            agentFeatureSelections.get(resourceId) !== record ||
            record.constituents.some(({ record: candidate, semanticRevision }) =>
              agentResources.get(candidate.resourceId) !== candidate ||
              agentResourceRevision(candidate) !== semanticRevision
            )) {
            throw operationError('unauthorized', 'The Agent feature selection is no longer current.')
          }
          return Object.freeze({
            state: Object.freeze({
              operation: record.operation,
              requestDigest: record.requestDigest,
              referenceCount: record.constituents.length
            }),
            semanticRevision: agentResourceRevision(record)
          })
        },
        dispose: () => {
          if (agentFeatureSelections.get(resourceId) === record) {
            agentFeatureSelections.delete(resourceId)
          }
        }
      })
      return Object.freeze({ operation, requestDigest, resource })
    } catch (error) {
      agentFeatureSelections.delete(resourceId)
      throw error
    }
  }
  const requireAgentFeatureSelection = (
    context: ContentSpaceCapabilityContext,
    operation: ContentSpaceExtendedOperationKey,
    request: unknown
  ): AgentFeatureSelectionRecord => {
    const resourceId = context.resource?.resourceId
    const record = resourceId ? agentFeatureSelections.get(resourceId) : undefined
    if (context.caller.audience !== 'agent' || !record ||
      context.resource?.resourceKind !== CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND ||
      context.resource.workspaceId !== record.workspaceId ||
      record.callerId !== context.caller.callerId ||
      record.workspaceId !== context.caller.workspaceId ||
      !samePrincipalSnapshot(record.principal, context.caller.principal) ||
      record.constituents.some(({ record: candidate, semanticRevision }) =>
        agentResources.get(candidate.resourceId) !== candidate ||
        agentResourceRevision(candidate) !== semanticRevision
      )) {
      throw operationError('unauthorized', 'The Agent feature selection is unavailable.')
    }
    const requestDigest = extendedFeatureSelectionDigest({
      operation,
      root: record.root,
      primary: record.primary.reference,
      records: record.constituents.map(({ record: candidate, semanticRevision }) => ({
        reference: candidate.reference,
        semanticRevision
      })),
      request
    })
    if (record.operation !== operation || record.requestDigest !== requestDigest) {
      throw operationError('invalid_target', 'The Agent feature selection does not match this request.')
    }
    return record
  }
  const featureSelectionTarget = (
    record: AgentFeatureSelectionRecord
  ): Extract<ContentSpaceProviderFeatureTarget, { kind: 'content' }> => Object.freeze({
    kind: 'content',
    root: record.root,
    primary: record.primary.reference,
    authorized: Object.freeze(record.constituents.map(({ record: candidate }) =>
      candidate.reference
    ))
  })
  const issueAgentAdministrationResource = (
    context: ContentSpaceCapabilityContext,
    providerInstanceRef: string
  ) => {
    if (context.caller.audience !== 'agent' || !context.caller.principal) {
      throw operationError('unauthorized', 'Only a current Agent Principal can receive this scope.')
    }
    if (agentAdministrationResources.size >= MAX_AGENT_RESOURCE_RECORDS) {
      throw operationError('bounds_exceeded', 'The Provider administration scope table is full.')
    }
    const resourceId = `content-space-admin-${randomUUID()}`
    const record: AgentAdministrationResourceRecord = Object.freeze({
      resourceId,
      providerInstanceRef,
      callerId: context.caller.callerId,
      principal: context.caller.principal,
      revisionState: {
        observedRevision: `provider-admin:${createHash('sha256')
          .update(providerInstanceRef)
          .digest('hex')}`
      },
      ...(context.caller.workspaceId ? { workspaceId: context.caller.workspaceId } : {})
    })
    agentAdministrationResources.set(resourceId, record)
    try {
      return context.issueResource({
        resourceId,
        resourceKind: CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND,
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
        audiences: ['agent'],
        semanticRevision: agentResourceRevision(record),
        expiresInMs: 15 * 60_000,
        retireAfterLastHandleExpires: true,
        observe: (caller) => {
          if (caller.audience !== 'agent' || caller.callerId !== record.callerId ||
            caller.workspaceId !== record.workspaceId || !caller.principal ||
            !samePrincipalSnapshot(caller.principal, record.principal)) {
            throw operationError('unauthorized', 'The Provider administration scope changed.')
          }
          return Object.freeze({
            state: Object.freeze({ providerInstanceRef: record.providerInstanceRef }),
            semanticRevision: agentResourceRevision(record)
          })
        },
        dispose: () => {
          if (agentAdministrationResources.get(resourceId) === record) {
            agentAdministrationResources.delete(resourceId)
          }
        }
      })
    } catch (error) {
      agentAdministrationResources.delete(resourceId)
      throw error
    }
  }
  const requireAgentAdministrationResource = (
    context: ContentSpaceCapabilityContext
  ): AgentAdministrationResourceRecord => {
    const resourceId = context.resource?.resourceId
    const record = resourceId ? agentAdministrationResources.get(resourceId) : undefined
    if (context.caller.audience !== 'agent' || !record ||
      context.resource?.resourceKind !== CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND ||
      context.resource?.workspaceId !== record.workspaceId ||
      record.callerId !== context.caller.callerId ||
      record.workspaceId !== context.caller.workspaceId ||
      !samePrincipalSnapshot(record.principal, context.caller.principal)) {
      throw operationError('unauthorized', 'The Provider administration scope is unavailable.')
    }
    return record
  }
  const requireAgentRootAdministrationResource = (
    context: ContentSpaceCapabilityContext
  ): AgentResourceRecord => {
    const record = requireAgentResource(context, 'container')
    if (!sameContentEntryReference(record.reference, record.root)) {
      throw operationError('unauthorized', 'Content Space administration requires the exact root.')
    }
    return record
  }
  const administrationTarget = (
    record: AgentAdministrationResourceRecord
  ): Extract<ContentSpaceProviderFeatureTarget, { kind: 'provider-administration' }> =>
    Object.freeze({
      kind: 'provider-administration',
      providerInstanceRef: record.providerInstanceRef
    })
  const markAgentResourceWrite = (
    record: AgentResourceRecord | AgentAdministrationResourceRecord,
    context: ContentSpaceCapabilityContext
  ) => {
    if (!context.invocationId) {
      throw operationError('invalid_input', 'A Broker-issued invocation identity is required.')
    }
    record.revisionState.writeInvocationId = context.invocationId
    return Object.freeze({
      changed: true,
      semanticRevision: agentResourceRevision(record)
    })
  }
  const executeAgentAdministration = (
    target: ContentSpaceProviderFeatureTarget,
    operation: ContentSpaceAdministrationOperation,
    request: unknown,
    effect: ContentSpaceProviderFeatureEffect,
    context: ContentSpaceCapabilityContext
  ) => options.getService().executeAdministration(
    { target, operation, request },
    featureCall(context, effect)
  )

  return Object.freeze({
    moduleId: CONTENT_SPACE_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'content-space',
      title: 'Content Space',
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => Object.freeze([
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances,
        title: 'List Content Space Provider Instances',
        description: 'First lists explicit trusted Provider Instances; use its returned providerInstanceRef before listing or authorizing an external personal or shared library root.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: [
          'external-content',
          'provider',
          'provider-instance',
          'personal-library',
          'shared-library',
          'root-selection',
          'browse',
          'folder',
          'create',
          'upload',
          'download',
          'authorize'
        ],
        inputSchema: zEmptyObject,
        outputSchema: contentSpaceProviderInstanceListResultSchema,
        handler: async (_input, context) => capabilityResult(() =>
          options.getService().listProviderInstances(call(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates,
        title: 'List Agent Content Space Root Candidates',
        description: 'After listing Provider Instances, lists one bounded page of Human-visible personal or shared library labels for Agent root selection. Follow nextCursor before concluding the set; output is selection data only and never authority or a Provider resource identity.',
        audiences: ['agent'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: [
          'external-content',
          'provider',
          'personal-library',
          'shared-library',
          'root-selection',
          'browse',
          'folder',
          'create',
          'upload',
          'download',
          'authorize'
        ],
        inputSchema: contentSpaceListAgentRootCandidatesInputSchema,
        outputSchema: contentSpaceAgentRootCandidatePageResultSchema,
        handler: async ({ providerInstanceRef, scope, page }, context) => capabilityResult(async () => {
          const listed = await options.getService().listContainers({
            providerInstanceRef,
            page
          }, call(context))
          return Object.freeze({
            providerInstanceRef,
            scope,
            items: Object.freeze(listed.items
              .filter((item) => item.scope === scope)
              .map((item) => Object.freeze({ libraryLabel: item.label }))),
            ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {})
          })
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.describeCapabilities,
        title: 'Describe Content Space Capabilities',
        description: 'Reads operation readiness for one pinned Provider Instance.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceProviderInstanceInputSchema,
        outputSchema: contentSpaceCapabilityListResultSchema,
        handler: async ({ providerInstanceRef }, context) => capabilityResult(() =>
          options.getService().describeCapabilities(providerInstanceRef, call(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.listContainers,
        audiences: ['ui'],
        title: 'List Content Space Containers',
        description: 'Lists one bounded container page from an explicit Provider Instance.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceListContainersInputSchema,
        outputSchema: contentSpaceContainerPageResultSchema,
        handler: async (input, context) => capabilityResult(() =>
          options.getService().listContainers(input, call(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.listEntries,
        audiences: ['ui'],
        title: 'List Content Space Entries',
        description: 'Lists one bounded page of direct children for an explicit container.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceListEntriesInputSchema,
        outputSchema: contentSpaceEntryPageResultSchema,
        handler: async (input, context) => capabilityResult(() =>
          options.getService().listEntries(input, call(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.observeEntry,
        audiences: ['ui'],
        title: 'Observe Content Space Entry',
        description: 'Reads provider-neutral metadata for an exact Content Space reference.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceObserveEntryInputSchema,
        outputSchema: contentSpaceEntryObservationResultSchema,
        handler: async ({ reference }, context) => capabilityResult(() =>
          options.getService().observeEntry(reference, call(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.createFolder,
        audiences: ['ui'],
        title: 'Create Content Space Folder',
        description: 'Creates one new folder without overwrite at an explicit parent.',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceCreateFolderInputSchema,
        outputSchema: createFolderResultSchema,
        handler: async (input, context) => capabilityResult(() =>
          options.getService().createFolder(input, writeCall(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.uploadNew,
        audiences: ['ui'],
        title: 'Upload New Content Space File',
        description: 'Uploads one bounded Host-selected file without overwrite.',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceUploadNewInputSchema,
        outputSchema: uploadNewResultSchema,
        handler: async ({ parent, name, sourceHandle }, context) => capabilityResult(async () => {
          const invocation = writeCall(context)
          return options.getService().uploadNewFile({
            parent,
            name,
            openSource: (signal, maxBytes) => {
              const fileTransfers = options.fileTransfers
              if (!fileTransfers) {
                throw operationError('source_unavailable', 'Host file transfer is unavailable.')
              }
              return fileTransfers.openUploadSource({
                handle: sourceHandle,
                maxBytes,
                signal
              })
            }
          }, invocation)
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.download,
        audiences: ['ui'],
        title: 'Download Content Space File',
        description: 'Downloads bytes only to a Host-owned no-overwrite destination.',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceDownloadInputSchema,
        outputSchema: downloadResultSchema,
        handler: async ({ reference, destinationHandle }, context) => capabilityResult(async () => {
          const invocation = writeCall(context)
          return options.getService().downloadFile({
            reference,
            openDestination: (signal, maxBytes) => {
              const fileTransfers = options.fileTransfers
              if (!fileTransfers) {
                throw operationError(
                  'destination_unavailable',
                  'Host file transfer is unavailable.'
                )
              }
              return fileTransfers.openDownloadDestination({
                handle: destinationHandle,
                maxBytes,
                signal
              })
            }
          }, invocation)
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.systemTransferPreflight,
        audiences: ['system'],
        scope: 'workspace',
        title: 'Preflight System Content Space Transfer',
        description: 'Reads a fresh token-free current-session readiness fact for one exact transfer intent without granting transfer authority.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['system-transfer', 'preflight', 'advisory', 'non-authorizing'],
        inputSchema: contentSpaceSystemTransferPreflightInputSchema,
        outputSchema: contentSpaceSystemTransferPreflightResultSchema,
        handler: async (rawInput, context) => capabilityResult(async () => {
          requireSystemTransferAuthority(context)
          const execution = systemExecutionBinding(context)
          const input = contentSpaceSystemTransferPreflightInputSchema.parse(rawInput)
          const intentDigest = canonicalDigest(input)
          let probe: Awaited<ReturnType<ContentSpaceService['preflightSystemTransfer']>>
          try {
            if (input.operation === 'download') {
              probe = await options.getService().preflightSystemTransfer({
                operation: input.operation,
                root: resolveSystemPortableReference(
                  options.portableResolver,
                  input.input.root
                ),
                candidate: resolveSystemPortableReference(
                  options.portableResolver,
                  input.input.candidate
                )
              }, systemWriteCall(context))
            } else {
              probe = await options.getService().preflightSystemTransfer({
                operation: input.operation,
                root: resolveSystemPortableReference(
                  options.portableResolver,
                  input.input.root
                )
              }, systemWriteCall(context))
            }
          } catch (error) {
            let principalStale = false
            try {
              await context.assertPrincipalCurrent()
            } catch {
              principalStale = true
            }
            const status: ContentSpaceSystemTransferPreflightStatus = principalStale
              ? 'principal_stale'
              : 'provider_not_ready'
            probe = Object.freeze({
              status,
              providerObservationRevision: canonicalDigest({
                contract: 'content-space.system-transfer-preflight.provider-observation.v1',
                status,
                providerInstanceRef: input.input.root.authority,
                operation: input.operation,
                failureCode: error instanceof ContentSpaceOperationError
                  ? error.detail.code
                  : 'provider_unavailable'
              })
            })
          }

          let status = probe.status
          try {
            await context.assertPrincipalCurrent()
          } catch {
            status = 'principal_stale'
          }
          const observationRevision = canonicalDigest({
            contract: 'content-space.system-transfer-preflight.observation.v1',
            status,
            intentDigest,
            providerObservationRevision: probe.providerObservationRevision,
            callerId: execution.callerId,
            principalSnapshotDigest: execution.principalSnapshotDigest,
            workspaceId: execution.workspaceId,
            executionContextDigest: execution.executionContextDigest
          })
          return contentSpaceSystemTransferPreflightObservationSchema.parse({
            execution,
            status,
            intentDigest,
            observationRevision,
            authorization: 'not_granted',
            cacheable: false
          })
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.systemDownload,
        audiences: ['system'],
        scope: 'workspace',
        title: 'System Download Content Space File',
        description: 'Downloads one freshly proven file to a new Workspace-relative destination.',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['system-transfer', 'paired-authority', 'download'],
        inputSchema: contentSpaceSystemDownloadInputSchema,
        outputSchema: contentSpaceSystemDownloadResultSchema,
        handler: async (rawInput, context) => systemCapabilityResult(context, async () => {
            requireSystemTransferAuthority(context)
            const {
              root: rootEnvelope,
              candidate: candidateEnvelope,
              workspaceRelativePath
            } = contentSpaceSystemDownloadInputSchema.parse(rawInput)
            const root = resolveSystemPortableReference(
              options.portableResolver,
              rootEnvelope
            )
            const candidate = resolveSystemPortableReference(
              options.portableResolver,
              candidateEnvelope
            )
            const transfer = await options.getService().downloadFile({
              reference: candidate,
              proofRoot: root,
              includeTransferEvidence: true,
              openDestination: (signal, maxBytes) => {
                if (!options.fileTransfers) {
                  throw operationError(
                    'destination_unavailable',
                    'Host file transfer is unavailable.'
                  )
                }
                return options.fileTransfers.openWorkspaceDownloadDestination({
                  relativePath: workspaceRelativePath,
                  maxBytes,
                  systemAuthorization: {
                    requiredSystemCapabilityGrant: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID
                  },
                  signal
                })
              }
            }, systemWriteCall(context))
            const readAfterObservation = Object.freeze({
              reference: toPortableContentFileReference(transfer.receipt.reference as ContentFileReference),
              bytes: transfer.bytes,
              sha256: transfer.sha256
            })
            return contentSpaceSystemDownloadReceiptSchema.parse({
              execution: systemExecutionBinding(context),
              receipt: transfer.receipt,
              readAfterObservation,
              workspaceRelativePath,
              bytes: transfer.bytes,
              sha256: transfer.sha256,
              transferReceiptDigest: canonicalDigest(transfer.receipt),
              observationDigest: canonicalDigest(readAfterObservation),
              providerDigest: deferredProviderDigest()
            })
          })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.systemUploadNew,
        audiences: ['system'],
        scope: 'workspace',
        title: 'System Upload New Content Space File',
        description: 'Uploads one real Workspace file as a new entry in an exact authorized root.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['system-transfer', 'root-authority', 'upload'],
        inputSchema: contentSpaceSystemUploadNewInputSchema,
        outputSchema: contentSpaceSystemUploadNewResultSchema,
        handler: async (rawInput, context) => systemCapabilityResult(context, async () => {
            requireSystemTransferAuthority(context)
            const { root: rootEnvelope, name, workspaceRelativePath } =
              contentSpaceSystemUploadNewInputSchema.parse(rawInput)
            const root = resolveSystemPortableReference(
              options.portableResolver,
              rootEnvelope
            )
            const transfer = await options.getService().uploadNewFile({
              parent: root,
              name,
              includeTransferEvidence: true,
              openSource: (signal, maxBytes) => {
                if (!options.fileTransfers) {
                  throw operationError('source_unavailable', 'Host file transfer is unavailable.')
                }
                return options.fileTransfers.openWorkspaceUploadSource({
                  relativePath: workspaceRelativePath,
                  maxBytes,
                  systemAuthorization: {
                    requiredSystemCapabilityGrant: CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID
                  },
                  signal
                })
              }
            }, systemWriteCall(context))
            const portableReference = toPortableContentFileReference(
              transfer.receipt.reference
            )
            const writeAfterObservation = Object.freeze({
              parent: toPortableContentContainerReference(
                transfer.writeAfterObservation.parent
              ),
              reference: toPortableContentFileReference(
                transfer.writeAfterObservation.reference
              ),
              name: transfer.writeAfterObservation.name,
              size: transfer.writeAfterObservation.size
            })
            return contentSpaceSystemUploadNewReceiptSchema.parse({
              execution: systemExecutionBinding(context),
              receipt: transfer.receipt,
              portableReference,
              writeAfterObservation,
              workspaceRelativePath,
              bytes: transfer.bytes,
              sha256: transfer.sha256,
              transferReceiptDigest: canonicalDigest(transfer.receipt),
              observationDigest: canonicalDigest(writeAfterObservation),
              providerDigest: deferredProviderDigest()
            })
          })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        title: 'Authorize Agent Content Space Root',
        description: 'After Provider Instance and optional candidate-label discovery, confirms one exact Human-visible personal or shared library label and re-enumerates live state to establish the bounded root for this Agent context.',
        audiences: ['agent'],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: [
          'external-content',
          'personal-library',
          'shared-library',
          'folder',
          'file',
          'create',
          'upload',
          'download',
          'authorize'
        ],
        producedResourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        inputSchema: contentSpaceAuthorizeAgentRootInputSchema,
        outputSchema: contentSpaceAgentRootAuthorizationResultSchema,
        handler: async (selection, context) => capabilityResult(async () => {
          const root = await resolveSelectableAgentRoot(selection, context)
          const observation = await options.getService().observeEntry(root, call(context))
          if (observation.entry.kind !== 'container') {
            throw operationError('invalid_target', 'The authorized Agent root must be a directory.')
          }
          return Object.freeze({ resource: issueAgentResource(context, root, root) })
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        title: 'List Authorized Agent Content Space Entries',
        description: 'Lists direct children beneath one Human-authorized Agent directory scope. Use each returned Broker resource, never its descriptive Provider reference, as authority for child operations.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        producedResourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND, CONTENT_FILE_RESOURCE_KIND],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceAgentListEntriesInputSchema,
        outputSchema: contentSpaceAgentEntryPageResultSchema,
        handler: async ({ page }, context) => capabilityResult(async () => {
          const record = requireAgentResource(context, 'container')
          const parent = record.reference as ContentContainerReference
          const listed = await options.getService().listEntries(
            { parent, page },
            call(context, verificationBinding(record))
          )
          return Object.freeze({
            parent: listed.parent,
            items: Object.freeze(listed.items.map((entry) => Object.freeze({
              entry,
              resource: issueAgentResource(context, record.root, entry.reference)
            }))),
            ...(listed.nextCursor ? { nextCursor: listed.nextCursor } : {})
          })
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        title: 'Create Folder in Authorized Agent Content Space',
        description: 'Creates one folder beneath the exact authorized Agent directory. Before operating inside it, re-list this parent and use the exact new child Broker resource.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'none',
        autonomousWrite: 'resource-authorized',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentCreateFolderInputSchema,
        outputSchema: createFolderResultSchema,
        handler: async ({ name }, context) => {
          const record = requireAgentResource(context, 'container')
          return capabilityMutationResult(
            () => options.getService().createFolder({
              parent: record.reference as ContentContainerReference,
              name
            }, writeCall(context, verificationBinding(record))),
            (receipt) => {
              record.revisionState.writeInvocationId = receipt.invocationId
              return Object.freeze({
                changed: true,
                semanticRevision: agentResourceRevision(record)
              })
            }
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        title: 'Upload Workspace File to Authorized Content Space',
        description: 'Uploads one confirmed Workspace-relative file beneath the exact Agent directory.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'none',
        autonomousWrite: 'resource-authorized',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentUploadNewInputSchema,
        outputSchema: uploadNewResultSchema,
        handler: async ({ name, workspaceRelativePath }, context) => {
          const record = requireAgentResource(context, 'container')
          return capabilityMutationResult(
            () => options.getService().uploadNewFile({
              parent: record.reference as ContentContainerReference,
              name,
              openSource: (signal, maxBytes) => {
                if (!options.fileTransfers) {
                  throw operationError('source_unavailable', 'Host file transfer is unavailable.')
                }
                return options.fileTransfers.openWorkspaceUploadSource({
                  relativePath: workspaceRelativePath,
                  maxBytes,
                  signal
                })
              }
            }, writeCall(context, verificationBinding(record))),
            (receipt) => {
              record.revisionState.writeInvocationId = receipt.invocationId
              return Object.freeze({
                changed: true,
                semanticRevision: agentResourceRevision(record)
              })
            }
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        title: 'Download Authorized Content Space File to Workspace',
        description: 'Downloads one authorized file to a confirmed new Workspace-relative destination.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_FILE_RESOURCE_KIND],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentDownloadInputSchema,
        outputSchema: downloadResultSchema,
        handler: async ({ workspaceRelativePath }, context) => {
          const record = requireAgentResource(context, 'file')
          return capabilityMutationResult(
            () => options.getService().downloadFile({
              reference: record.reference as ContentFileReference,
              openDestination: (signal, maxBytes) => {
                if (!options.fileTransfers) {
                  throw operationError(
                    'destination_unavailable',
                    'Host file transfer is unavailable.'
                  )
                }
                return options.fileTransfers.openWorkspaceDownloadDestination({
                  relativePath: workspaceRelativePath,
                  maxBytes,
                  signal
                })
              }
            }, writeCall(context, verificationBinding(record))),
            () => Object.freeze({ changed: false })
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.authorizeFeatureSelection,
        title: 'Authorize Agent Content Space Feature Selection',
        description: 'Creates one short-lived Broker selection for an exact typed multi-resource extended operation. Every referenced Content resource must already have its own live Agent resource.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND, CONTENT_FILE_RESOURCE_KIND],
        producedResourceKinds: [CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['external-content', 'feature-selection', 'authorize'],
        inputSchema: AGENT_FEATURE_SELECTION_INPUT_SCHEMA,
        outputSchema: contentSpaceResultSchema(AGENT_FEATURE_SELECTION_AUTHORIZATION_SCHEMA),
        handler: async ({ operation, request }, context) => capabilityResult(() => {
          const primary = requireAgentFeatureResource(context)
          const parsedRequest = parseExtendedFeatureRequest(operation, request)
          const records = resolveFeatureSelectionRecords(primary, operation, parsedRequest)
          return issueAgentFeatureSelection(
            context,
            primary,
            operation,
            parsedRequest,
            records
          )
        })
      }),
      ...CONTENT_SPACE_PROVIDER_FEATURE_EFFECTS.map((effect) => define({
        id: NATIVE_DOCUMENT_CAPABILITY_ID_BY_EFFECT[effect],
        title: `Use Authorized Native Document (${effect})`,
        description: 'Executes one provider-native document operation against the exact Broker-authorized Content Space file or container. Selecting the Content Space automatically enables this feature when the Provider supports it.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND, CONTENT_FILE_RESOURCE_KIND],
        effect,
        approval: effect === 'destructive' ? 'confirmation' : 'none',
        ...(effect === 'external-write'
          ? { autonomousWrite: 'resource-authorized' as const }
          : {}),
        concurrency: {
          revision: 'none',
          idempotency: effect === 'read' ? 'none' : 'required'
        },
        inputSchema: AGENT_NATIVE_DOCUMENT_INPUT_SCHEMA_BY_EFFECT[effect],
        outputSchema: contentSpaceResultSchema(agentNativeDocumentReceiptSchema),
        handler: async ({ request }, context) => {
          const record = requireAgentFeatureResource(context)
          return capabilityMutationResult(
            () => options.getService().executeNativeDocument({
              target: featureTarget(record),
              request
            }, featureCall(context, effect)),
            (receipt) => {
              const changed = (effect === 'external-write' || effect === 'destructive') &&
                receipt.outcome === 'succeeded'
              if (changed) record.revisionState.writeInvocationId = receipt.invocationId
              return changed
                ? Object.freeze({
                    changed: true,
                    semanticRevision: agentResourceRevision(record)
                  })
                : Object.freeze({ changed: false })
            }
          )
        }
      })),
      ...CONTENT_SPACE_EXTENDED_FEATURE_EFFECTS.map((effect) => define({
        id: EXTENDED_CAPABILITY_ID_BY_EFFECT[effect],
        ...(effect === 'read' || effect === 'external-write'
          ? { version: '2.0.0' as const }
          : {}),
        title: `Use Authorized Extended Content Space Operation (${effect})`,
        description: 'Executes one contracted extended operation against the exact Broker-authorized Content Space resource. Provider-scoped operations require a separate explicit Provider administration grant.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [
          CONTENT_CONTAINER_RESOURCE_KIND,
          CONTENT_FILE_RESOURCE_KIND,
          CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND,
          CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND
        ],
        effect,
        approval: effect === 'destructive' ? 'confirmation' : 'none',
        ...(effect === 'external-write'
          ? { autonomousWrite: 'resource-authorized' as const }
          : {}),
        concurrency: {
          revision: 'none',
          idempotency: effect === 'read' ? 'none' : 'required'
        },
        inputSchema: AGENT_EXTENDED_INPUT_SCHEMA_BY_EFFECT[effect],
        outputSchema: contentSpaceResultSchema(z.json()),
        handler: async ({ operation, request }, context) => {
          let admin: AgentAdministrationResourceRecord | undefined
          let selection: AgentFeatureSelectionRecord | undefined
          let content: AgentResourceRecord | undefined
          return capabilityMutationResult(
            async () => {
              const parsedRequest = parseExtendedFeatureRequest(operation, request)
              admin = context.resource?.resourceKind ===
                CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND
                ? requireAgentAdministrationResource(context)
                : undefined
              selection = context.resource?.resourceKind ===
                CONTENT_SPACE_FEATURE_SELECTION_RESOURCE_KIND
                ? requireAgentFeatureSelection(context, operation, parsedRequest)
                : undefined
              content = admin || selection ? undefined : requireAgentFeatureResource(context)
              const target: ContentSpaceProviderFeatureTarget = admin
                ? Object.freeze({
                    kind: 'provider-administration',
                    providerInstanceRef: admin.providerInstanceRef
                  })
                : selection
                  ? featureSelectionTarget(selection)
                  : featureTarget(content!)
              return issueExtendedPortalTarget(
                operation,
                await options.getService().executeExtendedOperation({
                  target,
                  operation,
                  request: parsedRequest
                }, featureCall(context, effect)),
                options.externalNavigation
              )
            },
            (result) => {
              const changed = (effect === 'external-write' || effect === 'destructive') &&
                isSuccessfulExtendedResult(result)
              const revisionRecord = admin ?? selection ?? content!
              if (changed) {
                revisionRecord.revisionState.writeInvocationId = context.invocationId
                if (selection) {
                  for (const { record: selected } of selection.constituents) {
                    selected.revisionState.writeInvocationId = context.invocationId
                  }
                }
              }
              return changed
                ? Object.freeze({
                    changed: true,
                    semanticRevision: agentResourceRevision(revisionRecord)
                  })
                : Object.freeze({ changed: false })
            }
          )
        }
      })),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
        title: 'Authorize Content Space Provider Administration',
        description: 'Confirms one Provider administration scope for this Agent and Principal. Root update, pin, unpin, add-member, and remove-member mutations still require fresh per-operation confirmation.',
        audiences: ['agent'],
        effect: 'external-write',
        approval: 'confirmation',
        delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
        concurrency: { revision: 'none', idempotency: 'required' },
        producedResourceKinds: [CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND],
        inputSchema: contentSpaceProviderInstanceInputSchema,
        outputSchema: contentSpaceResultSchema(
          contentSpaceAgentProviderAdministrationAuthorizationSchema
        ),
        handler: async ({ providerInstanceRef }, context) => capabilityMutationResult(
          async () => {
            await options.getService().authorizeProviderAdministration(
              providerInstanceRef,
              writeCall(context)
            )
            return Object.freeze({
              providerInstanceRef,
              resource: issueAgentAdministrationResource(context, providerInstanceRef)
            })
          },
          () => Object.freeze({ changed: false })
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminListSpaces,
        title: 'List Authorized Provider Content Spaces',
        description: 'Lists personal and shared content spaces through the exact authorized Provider administration resource.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceAdministrationListSpacesInputSchema,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_SPACE_PAGE_WIRE_SCHEMA),
        handler: async (input, context) => {
          const record = requireAgentAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              administrationTarget(record),
              'list-spaces',
              input,
              'read',
              context
            ),
            () => Object.freeze({ changed: false })
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace,
        title: 'Create Content Space',
        description: 'Creates one personal or shared content space through the authorized Provider and returns an exact root resource.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_SPACE_PROVIDER_ADMINISTRATION_RESOURCE_KIND],
        producedResourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'none',
        delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
        autonomousWrite: 'resource-authorized',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentAdministrationCreateSpaceInputSchema,
        outputSchema: contentSpaceResultSchema(
          contentSpaceAgentAdministrationCreateSpaceResultSchema
        ),
        handler: async (input, context) => {
          const record = requireAgentAdministrationResource(context)
          return capabilityMutationResult(
            async () => {
              const space = contentSpaceAdministrationSpaceSummarySchema.parse(
                await executeAgentAdministration(
                  administrationTarget(record),
                  'create-space',
                  Object.freeze({
                    ...input,
                    contentOwnerUserId: record.principal.subject
                  }),
                  'external-write',
                  context
                )
              )
              const root = parsePortableContentContainerReference(space.root)
              return Object.freeze({
                space,
                resource: issueAgentResource(context, root, root)
              })
            },
            () => markAgentResourceWrite(record, context)
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminObserveSpace,
        title: 'Observe Authorized Content Space Administration State',
        description: 'Reads administration state for the exact authorized Content Space root.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: zEmptyObject,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_SPACE_SUMMARY_WIRE_SCHEMA),
        handler: async (_input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'observe-space',
              { root: toPortableContentContainerReference(record.root) },
              'read',
              context
            ),
            () => Object.freeze({ changed: false })
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminUpdateSpace,
        title: 'Update Authorized Content Space',
        description: 'Updates the exact authorized root without allowing the request to replace its Provider or root.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: AGENT_ADMINISTRATION_UPDATE_SPACE_INPUT_SCHEMA,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_SPACE_SUMMARY_WIRE_SCHEMA),
        handler: async (input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'update-space',
              { root: toPortableContentContainerReference(record.root), ...input },
              'external-write',
              context
            ),
            () => markAgentResourceWrite(record, context)
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminPinSpace,
        title: 'Pin Authorized Content Space',
        description: 'Pins the exact authorized root through its Provider administration feature.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: zEmptyObject,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_SPACE_SUMMARY_WIRE_SCHEMA),
        handler: async (input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'pin-space',
              { root: toPortableContentContainerReference(record.root), ...input },
              'external-write',
              context
            ),
            () => markAgentResourceWrite(record, context)
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminUnpinSpace,
        title: 'Unpin Authorized Content Space',
        description: 'Unpins the exact authorized root through its Provider administration feature.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: zEmptyObject,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_SPACE_SUMMARY_WIRE_SCHEMA),
        handler: async (input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'unpin-space',
              { root: toPortableContentContainerReference(record.root), ...input },
              'external-write',
              context
            ),
            () => markAgentResourceWrite(record, context)
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminOpenRoot,
        title: 'Open Authorized Content Space Root',
        description: 'Resolves the exact authorized Content Space root through Provider administration.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: zEmptyObject,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_ROOT_OPEN_WIRE_SCHEMA),
        handler: async (_input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'open-root',
              { root: toPortableContentContainerReference(record.root) },
              'read',
              context
            ),
            () => Object.freeze({ changed: false })
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminListMembers,
        version: '2.0.0',
        title: 'List Authorized Content Space Members',
        description: 'Lists members for the exact authorized shared-content root.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'read',
        approval: 'none',
        delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceAgentAdministrationListMembersInputSchema,
        outputSchema: contentSpaceResultSchema(contentSpaceAgentAdministrationMemberPageSchema),
        handler: async (input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'list-members',
              { root: toPortableContentContainerReference(record.root), ...input },
              'read',
              context
            ),
            () => Object.freeze({ changed: false })
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminAddMember,
        version: '2.0.0',
        title: 'Add Authorized Content Space Member',
        description: 'Adds one Provider directory user to the exact authorized shared root.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        delegatedBatchGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentAdministrationMemberMutationInputSchema,
        outputSchema: contentSpaceResultSchema(contentSpaceAgentAdministrationAddMemberReceiptSchema),
        handler: async (input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'add-member',
              { root: toPortableContentContainerReference(record.root), ...input },
              'external-write',
              context
            ),
            () => markAgentResourceWrite(record, context)
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember,
        version: '2.0.0',
        title: 'Remove Authorized Content Space Member',
        description: 'Removes one Provider directory user from the exact authorized shared root.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentAdministrationMemberMutationInputSchema,
        outputSchema: contentSpaceResultSchema(ADMINISTRATION_REMOVE_MEMBER_WIRE_SCHEMA),
        handler: async (input, context) => {
          const record = requireAgentRootAdministrationResource(context)
          return capabilityMutationResult(
            () => executeAgentAdministration(
              featureTarget(record),
              'remove-member',
              { root: toPortableContentContainerReference(record.root), ...input },
              'destructive',
              context
            ),
            () => markAgentResourceWrite(record, context)
          )
        }
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
        title: 'Observe Immutable Content Version',
        description: 'Issues an ArtifactReference only from exact Provider proof.',
        audiences: ['ui'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceObserveImmutableVersionInputSchema,
        outputSchema: immutableVersionObservationResultSchema,
        handler: async ({ reference }, context) => capabilityResult(() =>
          options.getService().observeImmutableVersion(reference, call(context))
        )
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
        title: 'Resolve Content Space Portal Target',
        description: 'Converts a bounded HTTPS Provider target into a Host-owned handle.',
        audiences: ['ui'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: contentSpaceResolvePortalTargetInputSchema,
        outputSchema: contentSpacePortalTargetResultSchema,
        handler: async ({ reference }, context) => capabilityResult(async () => {
          const target = await options.getService().resolvePortalTarget(reference, call(context))
          const externalNavigation = options.externalNavigation
          if (!externalNavigation) {
            throw operationError('unsafe_portal_target', 'Safe external navigation is unavailable.')
          }
          try {
            return externalNavigation.issueTarget(target)
          } catch (error) {
            if (error instanceof DomainExternalNavigationError) {
              const code: ContentSpaceError['code'] = error.code === 'principal_changed'
                ? 'unauthorized'
                : error.code === 'capacity_exceeded'
                  ? 'bounds_exceeded'
                  : error.code === 'cancelled'
                    ? 'cancelled'
                    : error.code === 'outcome_unknown' || error.code === 'open_failed'
                      ? 'provider_unavailable'
                      : 'unsafe_portal_target'
              throw operationError(code, 'Host navigation rejected the portal target.')
            }
            throw error
          }
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget,
        title: 'Open Content Space Portal Target',
        description: 'Opens one short-lived Host-validated target in the system browser.',
        audiences: ['ui'],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceOpenPortalTargetInputSchema,
        outputSchema: contentSpaceOpenPortalResultSchema,
        handler: async ({ handle }, context) => capabilityResult(async () => {
          const invocation = writeCall(context)
          const externalNavigation = options.externalNavigation
          await options.getService().openPortalTarget(
            (signal) => {
              if (!externalNavigation) {
                throw operationError(
                  'unsafe_portal_target',
                  'Safe external navigation is unavailable.'
                )
              }
              return externalNavigation.openTarget({ handle, signal })
            },
            invocation
          )
          return contentSpaceOpenPortalTargetResultSchema.parse({ opened: true })
        })
      })
    ])
  })
}

function call(
  context: ContentSpaceCapabilityContext,
  verificationBinding?: ContentSpaceServiceCallContext['verificationBinding']
): ContentSpaceServiceCallContext {
  if (!context.caller.principal) {
    throw operationError('unauthorized', 'A Host-reauthorized Principal is required.')
  }
  return Object.freeze({
    reauthorizedPrincipal: context.caller.principal,
    assertPrincipalCurrent: context.assertPrincipalCurrent,
    audience: context.caller.audience,
    ...(verificationBinding ? { verificationBinding } : {}),
    ...(context.signal ? { signal: context.signal } : {})
  })
}

function contentSpaceResourceRevision(
  reference: ContentEntryReference,
  entry?: Readonly<{ kind: string; modifiedAt?: string }>
): string {
  const identity = 'containerId' in reference ? reference.containerId : reference.fileId
  const revision = entry?.modifiedAt ? `live:${identity}:${entry.modifiedAt}` : `live:${identity}`
  return revision.length <= 256
    ? revision
    : `live:sha256:${createHash('sha256').update(revision).digest('hex')}`
}

function agentResourceRevision(record: Readonly<{
  revisionState: Readonly<{ observedRevision: string; writeInvocationId?: string }>
}>): string {
  const invocationId = record.revisionState.writeInvocationId
  if (!invocationId) return record.revisionState.observedRevision
  const writeMarker = `:write:${createHash('sha256').update(invocationId).digest('hex').slice(0, 32)}`
  const observed = record.revisionState.observedRevision
  return observed.length + writeMarker.length <= 256
    ? `${observed}${writeMarker}`
    : `live:sha256:${createHash('sha256').update(observed).digest('hex')}${writeMarker}`
}

function writeCall(
  context: ContentSpaceCapabilityContext,
  verificationBinding?: ContentSpaceServiceCallContext['verificationBinding']
): ContentSpaceServiceWriteCallContext {
  const base = call(context, verificationBinding)
  if (!context.invocationId || !(context.signal instanceof AbortSignal)) {
    throw operationError(
      'invalid_input',
      'A Broker-issued invocation identity and cancellation signal are required.'
    )
  }
  return Object.freeze({ ...base, invocationId: context.invocationId, signal: context.signal })
}

function requireSystemTransferAuthority(context: ContentSpaceCapabilityContext): void {
  if (context.caller.audience !== 'system' ||
    !context.caller.principal ||
    !context.caller.workspaceId?.trim() ||
    !context.caller.principalSnapshotDigest ||
    !context.caller.executionContextDigest ||
    context.resource !== undefined ||
    !context.caller.capabilityGrants?.includes(CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID) ||
    !context.invocationId ||
    !(context.signal instanceof AbortSignal)) {
    throw operationError(
      'unauthorized',
      'The Content Space system transfer grant and Workspace scope are required.'
    )
  }
  try {
    context.assertPrincipalCurrent()
  } catch {
    throw operationError('unauthorized', 'The Host Principal is no longer current.')
  }
}

function systemExecutionBinding(
  context: ContentSpaceCapabilityContext
) {
  requireSystemTransferAuthority(context)
  return contentSpaceSystemExecutionBindingSchema.parse({
    callerId: context.caller.callerId,
    principal: context.caller.principal,
    principalSnapshotDigest: context.caller.principalSnapshotDigest,
    workspaceId: context.caller.workspaceId,
    executionContextDigest: context.caller.executionContextDigest,
    invocationId: context.invocationId
  })
}

function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function deferredProviderDigest() {
  return Object.freeze({
    status: 'deferred' as const,
    reason: 'provider_digest_not_in_run0_contract' as const
  })
}

function systemWriteCall(
  context: ContentSpaceCapabilityContext
): ContentSpaceServiceWriteCallContext {
  requireSystemTransferAuthority(context)
  return Object.freeze({
    ...writeCall(context)
  })
}

function resolveSystemPortableReference(
  resolver: ReturnType<typeof createContentSpacePortableAuthorityResolver>,
  envelope: ContentSpacePortableContainerReferenceEnvelope
): ContentContainerReference
function resolveSystemPortableReference(
  resolver: ReturnType<typeof createContentSpacePortableAuthorityResolver>,
  envelope: ContentSpacePortableFileReferenceEnvelope
): ContentFileReference
function resolveSystemPortableReference(
  resolver: ReturnType<typeof createContentSpacePortableAuthorityResolver>,
  envelope:
    | ContentSpacePortableContainerReferenceEnvelope
    | ContentSpacePortableFileReferenceEnvelope
): ContentContainerReference | ContentFileReference {
  try {
    return envelope.kind === CONTENT_CONTAINER_REFERENCE_KIND
      ? resolveContentSpacePortableInvocationReference(resolver, envelope)
      : resolveContentSpacePortableInvocationReference(resolver, envelope)
  } catch {
    throw operationError(
      'unknown_provider_instance',
      'The portable Content Space authority is unavailable.'
    )
  }
}

function featureCall(
  context: ContentSpaceCapabilityContext,
  effect: ContentSpaceProviderFeatureEffect
): ContentSpaceServiceFeatureCallContext {
  if (effect !== 'read') return writeCall(context)
  return Object.freeze({
    ...call(context),
    invocationId: `read_${randomUUID().replaceAll('-', '')}`
  })
}

async function capabilityResult<Value>(
  operation: () => Value | Promise<Value>
): Promise<Readonly<{ output: ContentSpaceResult<Value> }>> {
  try {
    return Object.freeze({ output: contentSpaceSuccess(await operation()) })
  } catch (error) {
    return Object.freeze({ output: contentSpaceFailure(contentSpaceFailureDetail(error)) })
  }
}

async function systemCapabilityResult<Value>(
  context: ContentSpaceCapabilityContext,
  operation: () => Value | Promise<Value>
): Promise<Readonly<{ output: ContentSpaceResult<Value> }>> {
  try {
    const value = await operation()
    try {
      await context.assertPrincipalCurrent()
    } catch {
      throw operationError(
        'outcome_unknown',
        'The Principal changed before the system transfer result was accepted.'
      )
    }
    return Object.freeze({ output: contentSpaceSuccess(value) })
  } catch (error) {
    let failure = error
    if (context.signal?.aborted) {
      try {
        await context.assertPrincipalCurrent()
      } catch {
        if (!(error instanceof ContentSpaceOperationError) ||
          error.detail.code !== 'outcome_unknown') {
          failure = operationError(
            'unauthorized',
            'The Host Principal changed before Provider dispatch.'
          )
        }
      }
    }
    return Object.freeze({ output: contentSpaceFailure(contentSpaceFailureDetail(failure)) })
  }
}

function contentSpaceFailureDetail(error: unknown): ContentSpaceError {
  return error instanceof ContentSpaceOperationError
    ? sanitizeContentSpaceError(error.detail)
    : Object.freeze({
        code: 'provider_unavailable',
        message: 'Content Space operation failed.',
        retry: 'never'
      })
}

async function capabilityMutationResult<Value>(
  operation: () => Value | Promise<Value>,
  onSuccess: (value: Value) => Readonly<{
    changed: boolean
    semanticRevision?: string
  }>
): Promise<Readonly<{
  output: ContentSpaceResult<Value>
  changed: boolean
  semanticRevision?: string
}>> {
  const result = await capabilityResult(operation)
  if (!result.output.ok) return Object.freeze({ ...result, changed: false })
  return Object.freeze({ ...result, ...onSuccess(result.output.value) })
}

function sanitizeContentSpaceError(error: ContentSpaceError): ContentSpaceError {
  return Object.freeze({
    code: error.code,
    message: SAFE_ERROR_MESSAGES[error.code],
    retry: error.retry
  })
}

function canonicalLibraryLabel(label: string): string {
  return label.normalize('NFKC').toLocaleLowerCase('und')
}

function operationError(
  code: ContentSpaceError['code'],
  message: string
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({ code, message, retry: 'never' })
}

const CONTENT_SPACE_PROVIDER_FEATURE_EFFECTS = Object.freeze([
  'read',
  'workspace-write',
  'external-write',
  'destructive'
] as const satisfies readonly ContentSpaceProviderFeatureEffect[])

const CONTENT_SPACE_EXTENDED_FEATURE_EFFECTS = Object.freeze([
  'read',
  'external-write',
  'destructive'
] as const satisfies readonly ContentSpaceProviderFeatureEffect[])

const MAX_AGENT_RESOURCE_RECORDS = 2_048
const AGENT_FEATURE_SELECTION_TTL_MS = 2 * 60_000
const EXTENDED_OPERATION_KEYS = Object.freeze(
  Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS) as ContentSpaceExtendedOperationKey[]
)

const AGENT_FEATURE_SELECTION_INPUT_SCHEMA = agentExtendedOperationsInputSchema(
  EXTENDED_OPERATION_KEYS
)

const AGENT_FEATURE_SELECTION_AUTHORIZATION_SCHEMA = z.object({
  operation: z.enum(EXTENDED_OPERATION_KEYS as [
    ContentSpaceExtendedOperationKey,
    ...ContentSpaceExtendedOperationKey[]
  ]),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  resource: domainCapabilityResourceHandleSchema
}).strict().readonly()

function parseExtendedFeatureRequest(
  operation: ContentSpaceExtendedOperationKey,
  request: unknown
): unknown {
  const parsed = contentSpaceAgentExtendedRequestSchema(operation).safeParse(request)
  if (!parsed.success) {
    throw operationError('invalid_input', 'The extended operation request is invalid.')
  }
  return parsed.data
}

function extendedFeatureSelectionDigest(input: Readonly<{
  operation: ContentSpaceExtendedOperationKey
  root: ContentContainerReference
  primary: ContentEntryReference
  records: readonly Readonly<{
    reference: ContentEntryReference
    semanticRevision: string
  }>[]
  request: unknown
}>): string {
  const references = input.records
    .map(({ reference, semanticRevision }) => Object.freeze({
      reference,
      semanticRevision
    }))
    .sort((left, right) => {
      const leftKey = canonicalJson(left)
      const rightKey = canonicalJson(right)
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
  return createHash('sha256').update(canonicalJson({
    domain: 'sciforge.content-space.feature-selection',
    contractVersion: 1,
    operation: input.operation,
    root: input.root,
    primary: input.primary,
    references,
    request: input.request
  })).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`
  }
  throw operationError('invalid_input', 'The extended operation request is not canonical JSON.')
}

const NATIVE_DOCUMENT_CAPABILITY_ID_BY_EFFECT = Object.freeze({
  read: CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentRead,
  'workspace-write': CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWorkspaceWrite,
  'external-write': CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentWrite,
  destructive: CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentDestructive
} satisfies Readonly<Record<
  ContentSpaceProviderFeatureEffect,
  string
>>)

const EXTENDED_CAPABILITY_ID_BY_EFFECT = Object.freeze({
  read: CONTENT_SPACE_CAPABILITY_IDS.agentExtendedRead,
  'external-write': CONTENT_SPACE_CAPABILITY_IDS.agentExtendedWrite,
  destructive: CONTENT_SPACE_CAPABILITY_IDS.agentExtendedDestructive
} satisfies Readonly<Record<
  (typeof CONTENT_SPACE_EXTENDED_FEATURE_EFFECTS)[number],
  string
>>)

function agentNativeDocumentInputSchema(effect: ContentSpaceProviderFeatureEffect) {
  return z.object({
    request: agentNativeDocumentRequestSchema.refine(
      (request) => nativeDocumentOperationEffect(request.operation) === effect,
      `Native-document operation must have ${effect} effect.`
    )
  }).strict().readonly()
}

const AGENT_NATIVE_DOCUMENT_INPUT_SCHEMA_BY_EFFECT = Object.freeze({
  read: agentNativeDocumentInputSchema('read'),
  'workspace-write': agentNativeDocumentInputSchema('workspace-write'),
  'external-write': agentNativeDocumentInputSchema('external-write'),
  destructive: agentNativeDocumentInputSchema('destructive')
})

function agentExtendedInputSchema(effect: ContentSpaceProviderFeatureEffect) {
  const operations = Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS)
    .filter((operation) => extendedOperationEffect(
      operation as ContentSpaceExtendedOperationKey
    ) === effect) as ContentSpaceExtendedOperationKey[]
  if (operations.length < 1) throw new Error(`No extended ${effect} operations are contracted.`)
  return agentExtendedOperationsInputSchema(operations)
}

function agentExtendedOperationsInputSchema(
  operations: readonly ContentSpaceExtendedOperationKey[]
): z.ZodType {
  const schemas = operations.map((operation) => z.object({
    operation: z.literal(operation),
    request: contentSpaceAgentExtendedRequestSchema(operation)
  }).strict().readonly())
  if (schemas.length < 1) throw new Error('At least one extended operation is required.')
  if (schemas.length === 1) return schemas[0]!
  return z.union(schemas as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])
}

const AGENT_EXTENDED_INPUT_SCHEMA_BY_EFFECT = Object.freeze({
  read: agentExtendedInputSchema('read'),
  'external-write': agentExtendedInputSchema('external-write'),
  destructive: agentExtendedInputSchema('destructive')
})

const administrationUpdateShape = contentSpaceAdministrationUpdateSpaceInputSchema.unwrap().shape
const contentContainerReferenceShape = contentContainerReferenceSchema.unwrap().shape
const administrationSpaceSummaryShape = contentSpaceAdministrationSpaceSummarySchema.unwrap().shape
const administrationRemoveMemberShape = contentSpaceAdministrationRemoveMemberReceiptSchema
  .unwrap().shape

const PORTABLE_CONTENT_CONTAINER_WIRE_SCHEMA = z.object({
  contractVersion: z.literal(1),
  kind: z.literal(CONTENT_CONTAINER_REFERENCE_KIND),
  authority: contentContainerReferenceShape.providerInstanceRef,
  identity: z.object({
    containerId: contentContainerReferenceShape.containerId
  }).strict().readonly()
}).strict().readonly()

const ADMINISTRATION_SPACE_SUMMARY_WIRE_SCHEMA = z.object({
  root: PORTABLE_CONTENT_CONTAINER_WIRE_SCHEMA,
  label: administrationSpaceSummaryShape.label,
  contentOwnerUserId: administrationSpaceSummaryShape.contentOwnerUserId,
  pinned: administrationSpaceSummaryShape.pinned
}).strict().readonly()

const ADMINISTRATION_SPACE_PAGE_WIRE_SCHEMA = z.object({
  items: z.array(ADMINISTRATION_SPACE_SUMMARY_WIRE_SCHEMA).max(200).readonly(),
  nextCursor: z.string().trim().min(1).max(256).optional()
}).strict().readonly()

const ADMINISTRATION_ROOT_OPEN_WIRE_SCHEMA = z.object({
  root: PORTABLE_CONTENT_CONTAINER_WIRE_SCHEMA
}).strict().readonly()

const ADMINISTRATION_REMOVE_MEMBER_WIRE_SCHEMA = z.object({
  root: PORTABLE_CONTENT_CONTAINER_WIRE_SCHEMA,
  member: administrationRemoveMemberShape.member,
  removed: administrationRemoveMemberShape.removed
}).strict().readonly()

const AGENT_ADMINISTRATION_UPDATE_SPACE_INPUT_SCHEMA = z.object({
  label: administrationUpdateShape.label
}).strict().readonly()

async function issueExtendedPortalTarget(
  operation: ContentSpaceExtendedOperationKey,
  rawResult: unknown,
  externalNavigation: NonNullable<DomainMainHost['externalNavigation']> | undefined
): Promise<unknown> {
  if (operation !== 'resolveInternalLink' &&
    operation !== 'resolveCollaborationInvitation') return rawResult
  if (!isRecord(rawResult) || rawResult.ok !== true || !isRecord(rawResult.value) ||
    !isRecord(rawResult.value.target)) return rawResult
  if (!externalNavigation) {
    throw operationError('unsafe_portal_target', 'Safe external navigation is unavailable.')
  }
  try {
    return Object.freeze({
      ...rawResult,
      value: Object.freeze({
        ...rawResult.value,
        target: externalNavigation.issueTarget({
          url: rawResult.value.target.url,
          expiresAt: rawResult.value.target.expiresAt
        })
      })
    })
  } catch (error) {
    if (error instanceof DomainExternalNavigationError) {
      throw operationError(
        error.code === 'principal_changed' ? 'unauthorized' : 'unsafe_portal_target',
        'Host navigation rejected the extended portal target.'
      )
    }
    throw error
  }
}

function isSuccessfulExtendedResult(value: unknown): boolean {
  return isRecord(value) && value.ok === true
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const zEmptyObject = z.object({}).strict()

const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_input: 'The Content Space request is invalid.',
  invalid_reference: 'The Content Space reference is invalid.',
  invalid_target: 'The Content Space target is invalid.',
  composition_not_ready: 'Content Space composition is not ready.',
  invalid_contribution: 'A trusted Content Space contribution is invalid.',
  incompatible_contract_version: 'A Content Space contract version is incompatible.',
  unknown_provider_instance: 'The selected Provider Instance is unknown.',
  missing_provider: 'The selected Provider is not installed.',
  provider_unavailable: 'The selected Provider is unavailable.',
  rate_limited: 'The selected Provider is temporarily rate limited.',
  provider_contract_violation: 'The selected Provider returned an unsupported response.',
  unauthorized: 'The current Principal is not authorized for this operation.',
  blocked_by_contract: 'The selected Provider does not enable this operation.',
  bounds_exceeded: 'The Content Space operation exceeded a configured bound.',
  conflict: 'The target already exists; choose another target.',
  outcome_unknown: 'The operation outcome is unknown; verify state before any retry.',
  cancelled: 'The Content Space operation was cancelled.',
  source_unavailable: 'The selected upload source is unavailable.',
  destination_unavailable: 'The selected download destination is unavailable.',
  unsafe_portal_target: 'The Provider portal target is unavailable or unsafe.',
  immutable_version_unproven: 'The immutable version proof could not be verified.'
} satisfies Readonly<Record<ContentSpaceError['code'], string>>)
