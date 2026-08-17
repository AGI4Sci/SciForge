import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution
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
  domainPackageDefinition
} from '../definition.js'
import {
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  CONTENT_SPACE_CAPABILITY_IDS,
  CONTENT_SPACE_LIMITS,
  ContentSpaceOperationError,
  artifactReferenceCodec,
  contentContainerReferenceCodec,
  contentFileReferenceCodec,
  contentSpaceCapabilityListResultSchema,
  contentSpaceAgentCreateFolderInputSchema,
  contentSpaceAgentDownloadInputSchema,
  contentSpaceAgentEntryPageResultSchema,
  contentSpaceAgentListEntriesInputSchema,
  contentSpaceAgentRootAuthorizationResultSchema,
  contentSpaceAgentUploadNewInputSchema,
  contentSpaceAuthorizeAgentRootInputSchema,
  contentSpaceContainerPageResultSchema,
  contentSpaceCreateFolderInputSchema,
  contentSpaceDownloadInputSchema,
  contentSpaceEntryObservationResultSchema,
  contentSpaceEntryPageResultSchema,
  contentSpaceFailure,
  contentSpaceListContainersInputSchema,
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
  contentSpaceUploadNewInputSchema,
  createFolderResultSchema,
  downloadResultSchema,
  immutableVersionObservationResultSchema,
  uploadNewResultSchema,
  type ContentSpaceError,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference,
  type ContentSpaceResult
} from '../contract.js'
import { createContentSpacePortableAuthorityResolver } from './portable-authority-resolver.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'
import {
  ContentSpaceService,
  type ContentSpaceServiceCallContext,
  type ContentSpaceServiceWriteCallContext
} from './service.js'

type ContentSpaceCapabilityContext = Readonly<{
  caller: Readonly<{
    audience: 'ui' | 'agent' | 'system'
    callerId: string
    principal?: PrincipalSnapshot
    workspaceId?: string
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
  scope: 'global' | 'resource'
  resourceKinds?: readonly string[]
  producedResourceKinds?: readonly string[]
  effect: 'read' | 'external-write'
  approval: 'none' | 'confirmation'
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
  ): Promise<Readonly<{ output: unknown }>>
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
      runtime = Object.freeze({
        catalog,
        service: new ContentSpaceService({
          catalog,
          platform: Object.freeze({
            fileTransfers: Boolean(host.fileTransfers),
            externalNavigation: Boolean(host.externalNavigation)
          })
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
          fileTransfers: host.fileTransfers,
          externalNavigation: host.externalNavigation
        })
      },
      {
        ...CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle
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
  fileTransfers?: NonNullable<DomainMainHost['fileTransfers']>
  externalNavigation?: NonNullable<DomainMainHost['externalNavigation']>
}>): ContentSpaceCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<ContentSpaceCapabilityOptions, 'version' | 'audiences' | 'scope' | 'tags'> &
      Readonly<{
        audiences?: ContentSpaceCapabilityOptions['audiences']
        scope?: ContentSpaceCapabilityOptions['scope']
      }>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    audiences: input.audiences ?? ['ui', 'agent', 'system'],
    scope: input.scope ?? 'global',
    tags: ['content-space', 'provider-neutral']
  })

  type AgentResourceRecord = Readonly<{
    resourceId: string
    root: ContentContainerReference
    reference: ContentEntryReference
    callerId: string
    principal: PrincipalSnapshot
    workspaceId?: string
  }>
  const agentResources = new Map<string, AgentResourceRecord>()
  const assertSelectableAgentRoot = async (
    root: ContentContainerReference,
    context: ContentSpaceCapabilityContext
  ): Promise<void> => {
    let cursor: string | undefined
    const seen = new Set<string>()
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await options.getService().listContainers({
        providerInstanceRef: root.providerInstanceRef,
        page: { limit: CONTENT_SPACE_LIMITS.maxPageItems, ...(cursor ? { cursor } : {}) }
      }, call(context))
      if (page.items.some((item) => (
        item.reference.providerInstanceRef === root.providerInstanceRef &&
        item.reference.containerId === root.containerId
      ))) return
      if (!page.nextCursor || seen.has(page.nextCursor)) break
      seen.add(page.nextCursor)
      cursor = page.nextCursor
    }
    throw operationError(
      'unauthorized',
      'The selected Agent root is not an accessible personal or Team library root.'
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
    if (agentResources.size >= 2_048) {
      throw operationError('bounds_exceeded', 'The Agent Content Space scope table is full.')
    }
    const resourceId = `content-space-agent-${randomUUID()}`
    const record: AgentResourceRecord = Object.freeze({
      resourceId,
      root,
      reference,
      callerId: context.caller.callerId,
      principal: context.caller.principal,
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
        semanticRevision: contentSpaceResourceRevision(reference),
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
            ...(observationContext.signal ? { signal: observationContext.signal } : {})
          })
          return Object.freeze({
            state: contentSpacePortableResourceStateSchema.parse({
              reference: record.reference,
              entry: observation.entry,
              capabilities: observation.capabilities
            }),
            semanticRevision: contentSpaceResourceRevision(record.reference, observation.entry)
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
        description: 'Lists explicit trusted Provider Instances supported by Content Space.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: zEmptyObject,
        outputSchema: contentSpaceProviderInstanceListResultSchema,
        handler: async (_input, context) => capabilityResult(() =>
          options.getService().listProviderInstances(call(context))
        )
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
            openSource: (signal) => {
              const fileTransfers = options.fileTransfers
              if (!fileTransfers) {
                throw operationError('source_unavailable', 'Host file transfer is unavailable.')
              }
              return fileTransfers.openUploadSource({
                handle: sourceHandle,
                maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
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
            openDestination: (signal) => {
              const fileTransfers = options.fileTransfers
              if (!fileTransfers) {
                throw operationError(
                  'destination_unavailable',
                  'Host file transfer is unavailable.'
                )
              }
              return fileTransfers.openDownloadDestination({
                handle: destinationHandle,
                maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes,
                signal
              })
            }
          }, invocation)
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        title: 'Authorize Agent Content Space Root',
        description: 'Confirms one exact Content Space directory as the bounded root for this Agent context.',
        audiences: ['agent'],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        producedResourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        inputSchema: contentSpaceAuthorizeAgentRootInputSchema,
        outputSchema: contentSpaceAgentRootAuthorizationResultSchema,
        handler: async ({ root }, context) => capabilityResult(async () => {
          await assertSelectableAgentRoot(root, context)
          const observation = await options.getService().observeEntry(root, call(context))
          if (observation.entry.kind !== 'container') {
            throw operationError('invalid_target', 'The authorized Agent root must be a directory.')
          }
          return Object.freeze({ root, resource: issueAgentResource(context, root, root) })
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        title: 'List Authorized Agent Content Space Entries',
        description: 'Lists direct children beneath one Human-authorized Agent directory scope.',
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
          const listed = await options.getService().listEntries({ parent, page }, call(context))
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
        description: 'Creates one folder beneath the exact authorized Agent directory.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentCreateFolderInputSchema,
        outputSchema: createFolderResultSchema,
        handler: async ({ name }, context) => capabilityResult(() => {
          const record = requireAgentResource(context, 'container')
          return options.getService().createFolder({
            parent: record.reference as ContentContainerReference,
            name
          }, writeCall(context))
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        title: 'Upload Workspace File to Authorized Content Space',
        description: 'Uploads one confirmed Workspace-relative file beneath the exact Agent directory.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentUploadNewInputSchema,
        outputSchema: uploadNewResultSchema,
        handler: async ({ name, workspaceRelativePath }, context) => capabilityResult(() => {
          const record = requireAgentResource(context, 'container')
          return options.getService().uploadNewFile({
            parent: record.reference as ContentContainerReference,
            name,
            openSource: (signal) => {
              if (!options.fileTransfers) {
                throw operationError('source_unavailable', 'Host file transfer is unavailable.')
              }
              return options.fileTransfers.openWorkspaceUploadSource({
                relativePath: workspaceRelativePath,
                maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
                signal
              })
            }
          }, writeCall(context))
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        title: 'Download Authorized Content Space File to Workspace',
        description: 'Downloads one authorized file to a confirmed new Workspace-relative destination.',
        audiences: ['agent'],
        scope: 'resource',
        resourceKinds: [CONTENT_FILE_RESOURCE_KIND],
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: contentSpaceAgentDownloadInputSchema,
        outputSchema: downloadResultSchema,
        handler: async ({ workspaceRelativePath }, context) => capabilityResult(() => {
          const record = requireAgentResource(context, 'file')
          return options.getService().downloadFile({
            reference: record.reference as ContentFileReference,
            openDestination: (signal) => {
              if (!options.fileTransfers) {
                throw operationError(
                  'destination_unavailable',
                  'Host file transfer is unavailable.'
                )
              }
              return options.fileTransfers.openWorkspaceDownloadDestination({
                relativePath: workspaceRelativePath,
                maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes,
                signal
              })
            }
          }, writeCall(context))
        })
      }),
      define({
        id: CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
        title: 'Observe Immutable Content Version',
        description: 'Issues an ArtifactReference only from exact Provider proof.',
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

function call(context: ContentSpaceCapabilityContext): ContentSpaceServiceCallContext {
  if (!context.caller.principal) {
    throw operationError('unauthorized', 'A Host-reauthorized Principal is required.')
  }
  return Object.freeze({
    reauthorizedPrincipal: context.caller.principal,
    assertPrincipalCurrent: context.assertPrincipalCurrent,
    audience: context.caller.audience,
    ...(context.signal ? { signal: context.signal } : {})
  })
}

function contentSpaceResourceRevision(
  reference: ContentEntryReference,
  entry?: Readonly<{ kind: string; modifiedAt?: string }>
): string {
  const identity = 'containerId' in reference ? reference.containerId : reference.fileId
  return entry?.modifiedAt ? `live:${identity}:${entry.modifiedAt}` : `live:${identity}`
}

function writeCall(context: ContentSpaceCapabilityContext): ContentSpaceServiceWriteCallContext {
  const base = call(context)
  if (!context.invocationId || !(context.signal instanceof AbortSignal)) {
    throw operationError(
      'invalid_input',
      'A Broker-issued invocation identity and cancellation signal are required.'
    )
  }
  return Object.freeze({ ...base, invocationId: context.invocationId, signal: context.signal })
}

async function capabilityResult<Value>(
  operation: () => Value | Promise<Value>
): Promise<Readonly<{ output: ContentSpaceResult<Value> }>> {
  try {
    return Object.freeze({ output: contentSpaceSuccess(await operation()) })
  } catch (error) {
    const detail: ContentSpaceError = error instanceof ContentSpaceOperationError
      ? sanitizeContentSpaceError(error.detail)
      : Object.freeze({
          code: 'provider_unavailable',
          message: 'Content Space operation failed.',
          retry: 'never'
        })
    return Object.freeze({ output: contentSpaceFailure(detail) })
  }
}

function sanitizeContentSpaceError(error: ContentSpaceError): ContentSpaceError {
  return Object.freeze({
    code: error.code,
    message: SAFE_ERROR_MESSAGES[error.code],
    retry: error.retry
  })
}

function operationError(
  code: ContentSpaceError['code'],
  message: string
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({ code, message, retry: 'never' })
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
