import {
  MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
  PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  type PortableResourceAuthorityResolver,
  type PortableResourceExportContext,
  type PortableResourceIdentity,
  type PortableResourceObservation,
  type PortableResourceResolution,
  type PortableResourceUseContext
} from '@sciforge/domain-sdk/portable-resource-references'
import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk/contract'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

import {
  ARTIFACT_REFERENCE_KIND,
  ARTIFACT_RESOURCE_KIND,
  CONTENT_CONTAINER_REFERENCE_KIND,
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_REFERENCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID,
  CONTENT_SPACE_PORTABLE_EXPORT_CONSUMER_MODULE_IDS,
  artifactReferenceSchema,
  contentContainerReferenceSchema,
  contentFileReferenceSchema,
  contentSpacePortableResourceStateSchema,
  parsePortableContentContainerReference,
  parsePortableContentFileReference,
  type ContentSpacePortableContainerReferenceEnvelope,
  type ContentSpacePortableFileReferenceEnvelope,
  type ArtifactReference,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference
} from '../contract.js'
import type { ContentSpaceProviderCatalog } from './provider-catalog.js'
import type { ContentSpaceService } from './service.js'

const CONTENT_SPACE_PORTABLE_KINDS = Object.freeze([
  ARTIFACT_REFERENCE_KIND,
  CONTENT_CONTAINER_REFERENCE_KIND,
  CONTENT_FILE_REFERENCE_KIND
] as const)

type ContentSpaceAuthorityContext = Readonly<{
  providerInstanceRef: string
}>

export function createContentSpacePortableAuthorityResolver(input: Readonly<{
  getCatalog(): ContentSpaceProviderCatalog
  getService(): ContentSpaceService
}>): PortableResourceAuthorityResolver<ContentSpaceAuthorityContext> {
  return Object.freeze({
    location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
    contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
    id: CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID,
    kinds: CONTENT_SPACE_PORTABLE_KINDS,
    lookupAuthority: ({ reference, kind }) => {
      if (!(CONTENT_SPACE_PORTABLE_KINDS as readonly string[]).includes(kind)) return undefined
      const parsed = providerInstanceRefSchema.safeParse(reference)
      if (!parsed.success || !input.getCatalog().hasProviderInstance(parsed.data)) {
        return undefined
      }
      return Object.freeze({
        reference: parsed.data,
        resolverId: CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID,
        kind,
        context: Object.freeze({ providerInstanceRef: parsed.data })
      })
    },
    resolve: async ({
      envelope,
      identity,
      resourceKind,
      authority,
      principal,
      assertPrincipalCurrent,
      signal
    }) => {
      if (authority.resolverId !== CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID ||
        authority.reference !== envelope.authority || authority.kind !== envelope.kind ||
        authority.context?.providerInstanceRef !== envelope.authority) {
        throw new TypeError('Content Space portable authority binding is invalid.')
      }
      const reference = contentReference(resourceKind, envelope.authority, identity)
      const service = input.getService()
      const initial = await service.observeEntry(reference, {
        reauthorizedPrincipal: principal,
        assertPrincipalCurrent,
        ...(signal ? { signal } : {})
      })
      return resolution(reference, resourceKind, service, initial.entry)
    }
  })
}

/**
 * Resolves an owner-coded envelope to its domain identity for one active
 * Content Space invocation. This deliberately performs no Host materialization
 * and issues no Broker resource: the decoded identity becomes authority only
 * after the service reauthorizes the exact root/pair under the current
 * Principal and Provider binding.
 */
export function resolveContentSpacePortableInvocationReference(
  resolver: PortableResourceAuthorityResolver<ContentSpaceAuthorityContext>,
  envelope: ContentSpacePortableContainerReferenceEnvelope
): ContentContainerReference
export function resolveContentSpacePortableInvocationReference(
  resolver: PortableResourceAuthorityResolver<ContentSpaceAuthorityContext>,
  envelope: ContentSpacePortableFileReferenceEnvelope
): ContentFileReference
export function resolveContentSpacePortableInvocationReference(
  resolver: PortableResourceAuthorityResolver<ContentSpaceAuthorityContext>,
  envelope:
    | ContentSpacePortableContainerReferenceEnvelope
    | ContentSpacePortableFileReferenceEnvelope
): ContentContainerReference | ContentFileReference {
  const authority = resolver.lookupAuthority({
    reference: envelope.authority,
    kind: envelope.kind
  })
  if (!authority ||
    authority.resolverId !== CONTENT_SPACE_PORTABLE_AUTHORITY_RESOLVER_ID ||
    authority.reference !== envelope.authority ||
    authority.kind !== envelope.kind ||
    authority.context?.providerInstanceRef !== envelope.authority) {
    throw new TypeError('Content Space portable authority is unavailable.')
  }
  return envelope.kind === CONTENT_CONTAINER_REFERENCE_KIND
    ? parsePortableContentContainerReference(envelope)
    : parsePortableContentFileReference(envelope)
}

function resolution(
  reference: ContentEntryReference,
  resourceKind: string,
  service: ContentSpaceService,
  initialEntry: Awaited<ReturnType<ContentSpaceService['observeEntry']>>['entry']
): PortableResourceResolution {
  const semanticRevision = revisionFor(reference, initialEntry)
  const observe = async (
    currentPrincipal: Parameters<ContentSpaceService['observeEntry']>[1]['reauthorizedPrincipal'],
    assertPrincipalCurrent: PortableResourceUseContext['assertPrincipalCurrent'],
    currentSignal?: AbortSignal
  ): Promise<PortableResourceObservation> => {
    const observation = await service.observeEntry(reference, {
      reauthorizedPrincipal: currentPrincipal,
      assertPrincipalCurrent,
      ...(currentSignal ? { signal: currentSignal } : {})
    })
    return Object.freeze({
      state: domainPackageJsonValueSchema.parse(contentSpacePortableResourceStateSchema.parse({
        reference,
        entry: observation.entry,
        capabilities: observation.capabilities
      })),
      semanticRevision: revisionFor(reference, observation.entry)
    })
  }
  return Object.freeze({
    registration: Object.freeze({
      resourceKind,
      audiences: Object.freeze(['ui', 'agent', 'system'] as const),
      semanticRevision,
      expiresInMs: 5 * 60_000,
      observe: ({
        principal: currentPrincipal,
        assertPrincipalCurrent,
        signal: currentSignal
      }: PortableResourceUseContext) =>
        observe(currentPrincipal, assertPrincipalCurrent, currentSignal)
    }),
    exportProjection: Object.freeze({
      consumerModuleIds: CONTENT_SPACE_PORTABLE_EXPORT_CONSUMER_MODULE_IDS,
      project: async ({
        principal: currentPrincipal,
        assertPrincipalCurrent,
        signal: currentSignal
      }: PortableResourceExportContext) => {
        await observe(currentPrincipal, assertPrincipalCurrent, currentSignal)
        return portableIdentity(reference)
      }
    })
  })
}

function contentReference(
  resourceKind: string,
  providerInstanceRef: string,
  identity: unknown
): ContentEntryReference {
  const candidate = { providerInstanceRef, ...identityRecord(identity) }
  if (resourceKind === CONTENT_CONTAINER_RESOURCE_KIND) {
    return contentContainerReferenceSchema.parse(candidate)
  }
  if (resourceKind === CONTENT_FILE_RESOURCE_KIND) {
    return contentFileReferenceSchema.parse(candidate)
  }
  if (resourceKind === ARTIFACT_RESOURCE_KIND) {
    return artifactReferenceSchema.parse(candidate)
  }
  throw new TypeError('Content Space portable resource kind is unsupported.')
}

function portableIdentity(reference: ContentEntryReference): PortableResourceIdentity {
  if ('containerId' in reference) {
    return Object.freeze({ containerId: reference.containerId })
  }
  if ('immutableVersionId' in reference) {
    return Object.freeze({
      fileId: reference.fileId,
      immutableVersionId: reference.immutableVersionId,
      ...(reference.digest ? { digest: reference.digest } : {})
    })
  }
  return Object.freeze({ fileId: reference.fileId })
}

function revisionFor(
  reference: ContentEntryReference,
  observed?: Awaited<ReturnType<ContentSpaceService['observeEntry']>>['entry']
): string {
  if ('immutableVersionId' in reference) return `immutable:${reference.immutableVersionId}`
  const identity = 'containerId' in reference ? reference.containerId : reference.fileId
  const modifiedAt = observed && 'modifiedAt' in observed ? observed.modifiedAt : undefined
  return modifiedAt ? `live:${identity}:${modifiedAt}` : `live:${identity}`
}

function identityRecord(identity: unknown): Record<string, unknown> {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new TypeError('Content Space portable identity is invalid.')
  }
  return identity as Record<string, unknown>
}

export type ContentSpacePortableReference =
  | ContentContainerReference
  | ContentFileReference
  | ArtifactReference
