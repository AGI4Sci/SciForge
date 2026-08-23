import { z } from 'zod'

import type {
  DomainCapabilityResourceHandle,
  DomainRendererCapabilityInvoker
} from '@sciforge/domain-sdk/host'

import {
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  ARTIFACT_RESOURCE_KIND,
  CONTENT_SPACE_CAPABILITY_IDS,
  contentSpaceCapabilityListResultSchema,
  contentSpaceContainerPageResultSchema,
  contentSpaceCreateFolderInputSchema,
  contentSpaceDownloadInputSchema,
  contentSpaceEntryObservationResultSchema,
  contentSpaceEntryPageResultSchema,
  contentSpaceListContainersInputSchema,
  contentSpaceListEntriesInputSchema,
  contentSpaceObserveEntryInputSchema,
  contentSpaceObserveImmutableVersionInputSchema,
  contentSpaceOpenPortalResultSchema,
  contentSpaceOpenPortalTargetInputSchema,
  contentSpacePortalTargetResultSchema,
  contentSpacePortableResourceStateSchema,
  contentSpaceProviderInstanceInputSchema,
  contentSpaceProviderInstanceListResultSchema,
  contentSpaceResolvePortalTargetInputSchema,
  contentSpaceUploadNewInputSchema,
  createFolderResultSchema,
  downloadResultSchema,
  immutableVersionObservationResultSchema,
  uploadNewResultSchema,
  type ArtifactReference,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference,
  type ContentSpaceAdmittedCapabilityState,
  type ContentSpaceResult
} from '../contract.js'

const emptyInputSchema = z.object({}).strict()

export const contentSpaceCapabilityContracts = Object.freeze({
  listProviderInstances: contract(
    CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances,
    'read',
    emptyInputSchema,
    contentSpaceProviderInstanceListResultSchema
  ),
  describeCapabilities: contract(
    CONTENT_SPACE_CAPABILITY_IDS.describeCapabilities,
    'read',
    contentSpaceProviderInstanceInputSchema,
    contentSpaceCapabilityListResultSchema
  ),
  listContainers: contract(
    CONTENT_SPACE_CAPABILITY_IDS.listContainers,
    'read',
    contentSpaceListContainersInputSchema,
    contentSpaceContainerPageResultSchema
  ),
  listEntries: contract(
    CONTENT_SPACE_CAPABILITY_IDS.listEntries,
    'read',
    contentSpaceListEntriesInputSchema,
    contentSpaceEntryPageResultSchema
  ),
  observeEntry: contract(
    CONTENT_SPACE_CAPABILITY_IDS.observeEntry,
    'read',
    contentSpaceObserveEntryInputSchema,
    contentSpaceEntryObservationResultSchema
  ),
  createFolder: contract(
    CONTENT_SPACE_CAPABILITY_IDS.createFolder,
    'external-write',
    contentSpaceCreateFolderInputSchema,
    createFolderResultSchema
  ),
  uploadNew: contract(
    CONTENT_SPACE_CAPABILITY_IDS.uploadNew,
    'external-write',
    contentSpaceUploadNewInputSchema,
    uploadNewResultSchema
  ),
  download: contract(
    CONTENT_SPACE_CAPABILITY_IDS.download,
    'external-write',
    contentSpaceDownloadInputSchema,
    downloadResultSchema
  ),
  resolvePortalTarget: contract(
    CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
    'read',
    contentSpaceResolvePortalTargetInputSchema,
    contentSpacePortalTargetResultSchema
  ),
  openPortalTarget: contract(
    CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget,
    'external-write',
    contentSpaceOpenPortalTargetInputSchema,
    contentSpaceOpenPortalResultSchema
  ),
  observeImmutableVersion: contract(
    CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
    'read',
    contentSpaceObserveImmutableVersionInputSchema,
    immutableVersionObservationResultSchema
  )
})

export type ContentSpaceReadOptions = Readonly<{ signal?: AbortSignal }>
export type ContentSpaceMutationOptions = Readonly<{
  approval: Readonly<{ mode: 'confirmation' }>
  signal?: AbortSignal
}>

export type ContentSpaceCapabilityClient = Readonly<{
  listProviderInstances(options?: ContentSpaceReadOptions): Promise<z.infer<
    typeof contentSpaceProviderInstanceListResultSchema
  >>
  describeCapabilities(providerInstanceRef: string, options?: ContentSpaceReadOptions): Promise<
    ContentSpaceResult<Readonly<{ items: readonly ContentSpaceAdmittedCapabilityState[] }>>
  >
  listContainers(input: z.input<typeof contentSpaceListContainersInputSchema>, options?: ContentSpaceReadOptions): Promise<z.infer<typeof contentSpaceContainerPageResultSchema>>
  listEntries(input: z.input<typeof contentSpaceListEntriesInputSchema>, options?: ContentSpaceReadOptions): Promise<z.infer<typeof contentSpaceEntryPageResultSchema>>
  observeEntry(reference: ContentEntryReference, options?: ContentSpaceReadOptions): Promise<z.infer<typeof contentSpaceEntryObservationResultSchema>>
  createFolder(input: z.input<typeof contentSpaceCreateFolderInputSchema>, options: ContentSpaceMutationOptions): Promise<z.infer<typeof createFolderResultSchema>>
  uploadNew(input: z.input<typeof contentSpaceUploadNewInputSchema>, options: ContentSpaceMutationOptions): Promise<z.infer<typeof uploadNewResultSchema>>
  download(input: z.input<typeof contentSpaceDownloadInputSchema>, options: ContentSpaceMutationOptions): Promise<z.infer<typeof downloadResultSchema>>
  openPortal(reference: ContentEntryReference, options: ContentSpaceMutationOptions): Promise<ContentSpaceResult<Readonly<{ opened: true }>>>
  observeImmutableVersion(reference: ContentFileReference, options?: ContentSpaceReadOptions): Promise<z.infer<typeof immutableVersionObservationResultSchema>>
  observeResource(input: Readonly<{
    resourceKind: typeof CONTENT_CONTAINER_RESOURCE_KIND | typeof CONTENT_FILE_RESOURCE_KIND | typeof ARTIFACT_RESOURCE_KIND
    resource: DomainCapabilityResourceHandle
  }>, options?: ContentSpaceReadOptions): Promise<
    z.infer<typeof contentSpacePortableResourceStateSchema> | null
  >
}>

export function createContentSpaceCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): ContentSpaceCapabilityClient {
  return Object.freeze({
    listProviderInstances: (options) => invoker.invoke(
      contentSpaceCapabilityContracts.listProviderInstances,
      {},
      options
    ),
    describeCapabilities: (providerInstanceRef, options) => invoker.invoke(
      contentSpaceCapabilityContracts.describeCapabilities,
      { providerInstanceRef },
      options
    ),
    listContainers: (input, options) => invoker.invoke(
      contentSpaceCapabilityContracts.listContainers,
      input,
      options
    ),
    listEntries: (input, options) => invoker.invoke(
      contentSpaceCapabilityContracts.listEntries,
      input,
      options
    ),
    observeEntry: (reference, options) => invoker.invoke(
      contentSpaceCapabilityContracts.observeEntry,
      { reference },
      options
    ),
    createFolder: (input, options) => invoker.invoke(
      contentSpaceCapabilityContracts.createFolder,
      input,
      options
    ),
    uploadNew: (input, options) => invoker.invoke(
      contentSpaceCapabilityContracts.uploadNew,
      input,
      options
    ),
    download: (input, options) => invoker.invoke(
      contentSpaceCapabilityContracts.download,
      input,
      options
    ),
    openPortal: async (reference, options) => {
      const resolved = await invoker.invoke(
        contentSpaceCapabilityContracts.resolvePortalTarget,
        { reference },
        { signal: options.signal }
      )
      if (!resolved.ok) return resolved
      return invoker.invoke(
        contentSpaceCapabilityContracts.openPortalTarget,
        { handle: resolved.value.handle },
        options
      )
    },
    observeImmutableVersion: (reference, options) => invoker.invoke(
      contentSpaceCapabilityContracts.observeImmutableVersion,
      { reference },
      options
    ),
    observeResource: async ({ resourceKind, resource }, options) => {
      const observation = await invoker.observe({
        resourceKind,
        stateSchema: contentSpacePortableResourceStateSchema
      }, resource, { signal: options?.signal })
      if (!observation.state) return null
      if (!resourceKindMatchesReference(resourceKind, observation.state.reference)) {
        throw new TypeError('Content Space resource observation kind drifted.')
      }
      return observation.state
    }
  })
}

function resourceKindMatchesReference(
  resourceKind: typeof CONTENT_CONTAINER_RESOURCE_KIND |
    typeof CONTENT_FILE_RESOURCE_KIND |
    typeof ARTIFACT_RESOURCE_KIND,
  reference: ContentContainerReference | ContentFileReference | ArtifactReference
): boolean {
  if (resourceKind === CONTENT_CONTAINER_RESOURCE_KIND) return 'containerId' in reference
  if (resourceKind === CONTENT_FILE_RESOURCE_KIND) {
    return 'fileId' in reference && !('immutableVersionId' in reference)
  }
  return 'immutableVersionId' in reference
}

function contract<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType
>(
  actionId: string,
  effect: 'read' | 'external-write',
  inputSchema: InputSchema,
  outputSchema: OutputSchema
) {
  return Object.freeze({ actionId, effect, inputSchema, outputSchema })
}
