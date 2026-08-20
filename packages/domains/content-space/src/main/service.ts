import { createHash } from 'node:crypto'
import type { z } from 'zod'

import {
  DOMAIN_FILE_TRANSFER_LIMITS,
  DomainFileTransferError
} from '@sciforge/domain-sdk/file-transfer'
import type { DomainMainFileTransferHost } from '@sciforge/domain-sdk/host'
import { DomainExternalNavigationError } from '@sciforge/domain-sdk/external-navigation'
import {
  contentSpaceAdministrationOperationStateListSchema,
  contentSpaceAdministrationAddMemberInputSchema,
  contentSpaceAdministrationCreateSpaceInputSchema,
  contentSpaceAdministrationListMembersInputSchema,
  contentSpaceAdministrationListSpacesInputSchema,
  contentSpaceAdministrationMemberPageSchema,
  contentSpaceAdministrationMemberSummarySchema,
  contentSpaceAdministrationObserveSpaceInputSchema,
  contentSpaceAdministrationOpenRootInputSchema,
  contentSpaceAdministrationPinSpaceInputSchema,
  contentSpaceAdministrationRemoveMemberInputSchema,
  contentSpaceAdministrationRemoveMemberReceiptSchema,
  contentSpaceAdministrationRootOpenResultSchema,
  contentSpaceAdministrationSpacePageSchema,
  contentSpaceAdministrationSpaceSummarySchema,
  contentSpaceAdministrationUnpinSpaceInputSchema,
  contentSpaceAdministrationUpdateSpaceInputSchema,
  defineContentSpaceAdministrationPort,
  defineProjectContentSpaceProvisioningPort,
  projectContentSpaceProvisioningIntentSchema,
  projectContentSpaceProvisioningReportSchema,
  type ContentSpaceAdministrationOperation
} from '../administration-contract.js'
import {
  principalSnapshotSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  ProviderCompositionError,
  providerInstanceRefSchema
} from '@sciforge/domain-sdk/provider-composition'

import {
  CONTENT_SPACE_LIMITS,
  ContentSpaceOperationError,
  artifactReferenceSchema,
  contentContainerReferenceSchema,
  contentFileReferenceSchema,
  contentSpaceCapabilityListSchema,
  contentSpaceCapabilityStateListSchema,
  contentSpaceContainerPageSchema,
  contentSpaceEntryNameSchema,
  contentSpaceEntryObservationSchema,
  contentSpaceEntryPageSchema,
  contentSpaceImmutableVersionProofSchema,
  contentSpaceInvocationIdSchema,
  contentSpacePageRequestSchema,
  contentSpaceProviderImmutableVersionObservationSchema,
  contentSpaceProviderInstanceListSchema,
  createFolderReceiptSchema,
  downloadReceiptSchema,
  immutableVersionObservationSchema,
  uploadNewReceiptSchema,
  type ArtifactReference,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference,
  type ContentSpaceDownloadDestination,
  type ContentSpaceErrorCode,
  type ContentSpaceOperation,
  type ContentSpaceProvider,
  type ContentSpaceProviderOperationContext,
  type ContentSpaceProviderWriteContext,
  type ContentSpaceReadinessReason,
  type ContentSpaceUploadSource,
  type DownloadReceipt,
  parsePortableContentContainerReference
} from '../contract.js'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  contentSpaceAgentExtendedRequestSchema,
  type ContentSpaceExtendedOperationKey
} from '../extended-operations-contract.js'
import {
  agentNativeDocumentReceiptSchema,
  agentNativeDocumentRequestSchema,
  nativeDocumentReceiptSchema,
  nativeDocumentRequestSchema,
  type AgentNativeDocumentReceipt,
  type AgentNativeDocumentRequest,
  type NativeDocumentReceipt,
  type NativeDocumentRequest
} from '../native-document-contract.js'
import {
  collectContentEntryReferences,
  collectProviderInstanceRefs,
  contentSpaceExtendedOperationStateListSchema,
  contentSpaceNativeDocumentOperationStateListSchema,
  contentSpaceProviderNativeDocumentReceiptSchema,
  extendedOperationAuthority,
  extendedOperationEffect,
  nativeDocumentOperationEffect,
  nativeDocumentRequestTarget,
  sameContentEntryReference,
  type ContentSpaceProviderContentTarget,
  type ContentSpaceProviderFeatureEffect,
  type ContentSpaceProviderFeatureTarget
} from '../provider-features.js'
import { ContentSpaceProviderCatalog } from './provider-catalog.js'

export type ContentSpaceServiceCallContext = Readonly<{
  /** Host-current Principal captured and revalidated at the invoking trust boundary. */
  reauthorizedPrincipal: PrincipalSnapshot
  /** Host-owned invocation lease check; packages never choose the current Principal. */
  assertPrincipalCurrent(): void | Promise<void>
  /** Trusted Broker audience; absent direct/internal calls cannot execute PoC operations. */
  audience?: 'ui' | 'agent' | 'system'
  signal?: AbortSignal
}>

export type ContentSpaceServiceWriteCallContext = ContentSpaceServiceCallContext & Readonly<{
  invocationId: string
  signal: AbortSignal
}>

/** Feature reads need only a Host-issued receipt identity; the service owns their deadline. */
export type ContentSpaceServiceFeatureCallContext = ContentSpaceServiceCallContext & Readonly<{
  invocationId: string
}>

export type ContentSpacePlatformGates = Readonly<{
  fileTransfers: boolean
  externalNavigation: boolean
}>

export class ContentSpaceService {
  readonly #catalog: ContentSpaceProviderCatalog
  readonly #now: () => Date
  readonly #operationDeadlineMs: number
  readonly #featureOperationDeadlineMs: number
  readonly #platform: ContentSpacePlatformGates
  readonly #featureFileTransfers?: DomainMainFileTransferHost
  readonly #pinned = new Map<string, Promise<ContentSpaceProvider>>()

  constructor(input: Readonly<{
    catalog: ContentSpaceProviderCatalog
    platform: ContentSpacePlatformGates
    featureFileTransfers?: DomainMainFileTransferHost
    now?: () => Date
    operationDeadlineMs?: number
    featureOperationDeadlineMs?: number
  }>) {
    this.#catalog = input.catalog
    this.#platform = Object.freeze({ ...input.platform })
    this.#featureFileTransfers = input.featureFileTransfers
    this.#now = input.now ?? (() => new Date())
    this.#operationDeadlineMs = input.operationDeadlineMs ??
      CONTENT_SPACE_LIMITS.operationDeadlineMs
    if (!Number.isSafeInteger(this.#operationDeadlineMs) ||
      this.#operationDeadlineMs < 1 ||
      this.#operationDeadlineMs > CONTENT_SPACE_LIMITS.operationDeadlineMs) {
      fail('invalid_input', 'Content Space operation deadline is invalid.')
    }
    this.#featureOperationDeadlineMs = input.featureOperationDeadlineMs ??
      CONTENT_SPACE_LIMITS.featureOperationDeadlineMs
    if (!Number.isSafeInteger(this.#featureOperationDeadlineMs) ||
      this.#featureOperationDeadlineMs < 1 ||
      this.#featureOperationDeadlineMs > CONTENT_SPACE_LIMITS.featureOperationDeadlineMs) {
      fail('invalid_input', 'Content Space feature operation deadline is invalid.')
    }
  }

  async listProviderInstances(call: ContentSpaceServiceCallContext) {
    const signal = createBoundedOperationSignal(call.signal, this.#operationDeadlineMs)
    const items = await boundedProviderCall(
      () => this.#catalog.listProviderInstances().map((entry) => ({
        providerInstanceRef: entry.providerInstanceRef,
        providerKind: entry.providerKind,
        label: entry.displayName
      })),
      signal,
      call.assertPrincipalCurrent
    )
    return parseOutput(contentSpaceProviderInstanceListSchema, { items })
  }

  async describeCapabilities(
    providerInstanceRef: string,
    call: ContentSpaceServiceCallContext
  ) {
    const context = this.#operationContext(providerInstanceRef, call)
    const provider = await this.#providerForCall(
      providerInstanceRef,
      context,
      call.assertPrincipalCurrent
    )
    return parseOutput(contentSpaceCapabilityListSchema, {
      items: await this.#describe(provider, context, call.assertPrincipalCurrent)
    })
  }

  async executeNativeDocument(
    input: Readonly<{
      target: ContentSpaceProviderContentTarget
      request: unknown
    }>,
    call: ContentSpaceServiceFeatureCallContext
  ): Promise<NativeDocumentReceipt | AgentNativeDocumentReceipt> {
    const agentTransfer = call.audience === 'agent'
    const request: NativeDocumentRequest | AgentNativeDocumentRequest = agentTransfer
      ? parseInput(agentNativeDocumentRequestSchema, input.request)
      : parseInput(nativeDocumentRequestSchema, input.request)
    const target = parseContentFeatureTarget(input.target)
    if (!sameContentEntryReference(nativeDocumentRequestTarget(request), target.primary)) {
      fail('invalid_target', 'The native-document request does not match Broker authority.')
    }
    const effect = nativeDocumentOperationEffect(request.operation)
    const { provider, context } = await this.#featureInvocation(
      target.primary.providerInstanceRef,
      effect,
      call
    )
    const executor = provider.features?.nativeDocuments
    if (!executor) {
      fail('blocked_by_contract', 'Native documents are unavailable for this Content Space.')
    }
    const operationStates = parseOutput(
      contentSpaceNativeDocumentOperationStateListSchema,
      await boundedProviderCall(
        () => executor.describeOperations(context),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    const operationState = operationStates.find((candidate) =>
      candidate.operation === request.operation
    )
    if (!operationState || !operationReady(operationState)) {
      fail(
        'blocked_by_contract',
        `Native-document operation ${request.operation} is unavailable.`
      )
    }

    const prepared = await this.#prepareNativeDocumentTransfer(
      request,
      context,
      call.assertPrincipalCurrent
    )
    let receipt: z.output<typeof contentSpaceProviderNativeDocumentReceiptSchema>
    try {
      const dispatched = () => boundedProviderCall(
        () => executor.execute({
          ...providerFeatureExecutionContext(effect, context),
          target,
          operation: request.operation,
          request: prepared.request,
          ...(prepared.source ? { source: prepared.source.provider } : {}),
          ...(prepared.destination ? { destination: prepared.destination.provider } : {})
        }),
        context.signal,
        call.assertPrincipalCurrent,
        effect !== 'read'
      )
      const rawReceipt = effect === 'read'
        ? await dispatched()
        : await writeDispatch(dispatched)
      receipt = effect === 'read'
        ? parseOutput(contentSpaceProviderNativeDocumentReceiptSchema, rawReceipt)
        : parseWriteOutput(contentSpaceProviderNativeDocumentReceiptSchema, rawReceipt)
      assertNativeDocumentReceiptBinding(receipt, request.operation, context.invocationId,
        target.primary.providerInstanceRef, effect)

      if (prepared.destination) {
        if (receipt.outcome !== 'succeeded') {
          await prepared.destination.abort()
          return parseOutput(
            agentTransfer ? agentNativeDocumentReceiptSchema : nativeDocumentReceiptSchema,
            receipt
          )
        }
        if (receipt.result.kind !== 'artifact') {
          fail('outcome_unknown', 'Provider transfer receipt is not an artifact.', 'never')
        }
        await prepared.destination.commit({
          bytesWritten: receipt.result.bytesWritten,
          digest: receipt.result.digest?.value
        })
        const { digest: _digest, ...providerArtifact } = receipt.result
        return parseOutput(
          agentTransfer ? agentNativeDocumentReceiptSchema : nativeDocumentReceiptSchema,
          {
            ...receipt,
            result: {
              ...providerArtifact,
              ...(prepared.destination.locator.kind === 'workspace'
                ? { workspaceRelativePath: prepared.destination.locator.relativePath }
                : { transferHandle: prepared.destination.locator.handle })
            }
          }
        )
      }
      return effect === 'read'
        ? parseOutput(
          agentTransfer ? agentNativeDocumentReceiptSchema : nativeDocumentReceiptSchema,
          receipt
        )
        : parseWriteOutput(
          agentTransfer ? agentNativeDocumentReceiptSchema : nativeDocumentReceiptSchema,
          receipt
        )
    } finally {
      await prepared.destination?.abort()
      await prepared.source?.close(effect !== 'read')
    }
  }

  async executeExtendedOperation(
    input: Readonly<{
      target: ContentSpaceProviderFeatureTarget
      operation: ContentSpaceExtendedOperationKey
      request: unknown
    }>,
    call: ContentSpaceServiceFeatureCallContext
  ): Promise<unknown> {
    const contract = CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS[input.operation]
    if (!contract) fail('invalid_input', 'The extended Content Space operation is invalid.')
    const request = parseInput(
      call.audience === 'agent'
        ? contentSpaceAgentExtendedRequestSchema(input.operation)
        : contract.requestSchema,
      input.request
    )
    const target = parseFeatureTarget(input.target)
    const providerInstanceRef = featureTargetProvider(target)
    assertExtendedFeatureAuthority(input.operation, request, target)
    assertContentRootMutationAllowed(input.operation, request, target)
    if (collectProviderInstanceRefs(request).some((candidate) =>
      candidate !== providerInstanceRef
    )) {
      fail('invalid_target', 'The extended request attempted to change Provider authority.')
    }
    if (target.kind === 'content') {
      const authorized = target.authorized
      if (collectContentEntryReferences(request).some((reference) =>
        !authorized.some((candidate) => sameContentEntryReference(candidate, reference))
      )) {
        fail('unauthorized', 'An extended request references an unauthorized Content resource.')
      }
    }

    const effect = extendedOperationEffect(input.operation)
    const { provider, context } = await this.#featureInvocation(
      providerInstanceRef,
      effect,
      call
    )
    const executor = provider.features?.extendedOperations
    if (!executor) {
      fail('blocked_by_contract', 'Extended operations are unavailable for this Content Space.')
    }
    const operationStates = parseOutput(
      contentSpaceExtendedOperationStateListSchema,
      await boundedProviderCall(
        () => executor.describeOperations(context),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    const operationState = operationStates.find((candidate) =>
      candidate.operation === input.operation
    )
    if (!operationState || !operationReady(operationState)) {
      fail(
        'blocked_by_contract',
        `Extended Content Space operation ${input.operation} is unavailable.`
      )
    }
    const prepared = await this.#prepareExtendedOperationTransfer(
      input.operation,
      request,
      context,
      call.assertPrincipalCurrent
    )
    try {
      const dispatched = () => boundedProviderCall(
        () => executor.execute({
          ...providerFeatureExecutionContext(effect, context),
          target,
          operation: input.operation,
          request: prepared.request,
          ...(prepared.source ? { source: prepared.source.provider } : {}),
          ...(prepared.destination ? { destination: prepared.destination.provider } : {})
        }),
        context.signal,
        call.assertPrincipalCurrent,
        effect !== 'read'
      )
      const rawResult = effect === 'read'
        ? await dispatched()
        : await writeDispatch(dispatched)
      const attestedResult = attestExtendedUploadReceipt(
        input.operation,
        rawResult,
        prepared.source,
        request
      )
      let result = effect === 'read'
        ? parseOutput(contract.resultSchema, attestedResult)
        : parseWriteOutput(contract.resultSchema, attestedResult)
      result = normalizeExtendedPortalResult(input.operation, result, this.#now())
      if (collectProviderInstanceRefs(result).some((candidate) =>
        candidate !== providerInstanceRef
      )) {
        fail(
          effect === 'read' ? 'provider_unavailable' : 'outcome_unknown',
          'Extended Provider output changed authority.',
          'never'
        )
      }
      if (prepared.destination) {
        if (!isRecord(result) || result.ok !== true || !isRecord(result.value)) {
          await prepared.destination.abort()
          return result
        }
        const digest = isRecord(result.value.digest) &&
          typeof result.value.digest.value === 'string'
          ? result.value.digest.value
          : undefined
        await prepared.destination.commit({
          ...(typeof result.value.bytesWritten === 'number'
            ? { bytesWritten: result.value.bytesWritten }
            : {}),
          ...(digest ? { digest } : {})
        })
      }
      return result
    } finally {
      await prepared.destination?.abort()
      await prepared.source?.close(effect !== 'read')
    }
  }

  async authorizeProviderAdministration(
    providerInstanceRef: string,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<Readonly<{ providerInstanceRef: string }>> {
    const parsedProvider = parseInput(providerInstanceRefSchema, providerInstanceRef)
    const { provider, context } = await this.#featureInvocation(
      parsedProvider,
      'external-write',
      call
    )
    const feature = provider.features?.administration
    if (!feature) {
      fail('blocked_by_contract', 'Provider administration is unavailable for this Content Space.')
    }
    const operationStates = parseOutput(
      contentSpaceAdministrationOperationStateListSchema,
      await boundedProviderCall(
        () => feature.describeOperations(context),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    if (!operationStates.some(operationReady)) {
      fail('blocked_by_contract', 'Provider administration has no available Agent operation.')
    }
    return Object.freeze({ providerInstanceRef: parsedProvider })
  }

  async executeAdministration(
    input: Readonly<{
      target: ContentSpaceProviderFeatureTarget
      operation: ContentSpaceAdministrationOperation
      request: unknown
    }>,
    call: ContentSpaceServiceFeatureCallContext
  ): Promise<unknown> {
    const target = parseFeatureTarget(input.target)
    const providerInstanceRef = featureTargetProvider(target)
    const request = parseAdministrationRequest(input.operation, input.request)
    assertAdministrationTarget(input.operation, request, target)
    const effect = administrationOperationEffect(input.operation)
    const { provider, context } = await this.#featureInvocation(
      providerInstanceRef,
      effect,
      call
    )
    const feature = provider.features?.administration
    if (!feature) {
      fail('blocked_by_contract', 'Provider administration is unavailable for this Content Space.')
    }
    const operationStates = parseOutput(
      contentSpaceAdministrationOperationStateListSchema,
      await boundedProviderCall(
        () => feature.describeOperations(context),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    const operationState = operationStates.find((candidate) =>
      candidate.operation === input.operation
    )
    if (!operationState || !operationReady(operationState)) {
      fail(
        'blocked_by_contract',
        `Content Space administration operation ${input.operation} is unavailable.`
      )
    }
    let bound: Awaited<ReturnType<typeof feature.bind>>
    try {
      bound = await boundedProviderCall(
        () => feature.bind(context),
        context.signal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      if (error instanceof ContentSpaceOperationError) throw error
      fail('provider_unavailable', 'Provider administration binding is unavailable.')
    }
    let administration
    let projectProvisioning
    try {
      administration = defineContentSpaceAdministrationPort(bound.administration)
      projectProvisioning = bound.projectProvisioning
        ? defineProjectContentSpaceProvisioningPort(bound.projectProvisioning)
        : undefined
    } catch {
      fail('provider_unavailable', 'Provider administration binding is invalid.')
    }
    const dispatch = () => boundedProviderCall(
      () => dispatchAdministrationOperation(
        input.operation,
        request,
        administration,
        projectProvisioning
      ),
      context.signal,
      call.assertPrincipalCurrent,
      effect !== 'read'
    )
    const rawOutput = effect === 'read'
      ? await dispatch()
      : await writeDispatch(dispatch)
    const output = effect === 'read'
      ? parseAdministrationOutput(input.operation, rawOutput, false)
      : parseAdministrationOutput(input.operation, rawOutput, true)
    assertAdministrationOutputProvider(input.operation, output, providerInstanceRef, effect)
    return output
  }

  async listContainers(
    input: Readonly<{ providerInstanceRef: string; page: unknown }>,
    call: ContentSpaceServiceCallContext
  ) {
    const page = parseInput(contentSpacePageRequestSchema, input.page)
    const { provider, context } = await this.#authorizedProvider(
      input.providerInstanceRef,
      'list-containers',
      call
    )
    const output = parseOutput(contentSpaceContainerPageSchema, await boundedProviderCall(
      () => provider.listContainers({ context, page }),
      context.signal,
      call.assertPrincipalCurrent
    ))
    if (output.providerInstanceRef !== input.providerInstanceRef ||
      output.items.length > page.limit ||
      (output.nextCursor !== undefined && output.nextCursor === page.cursor) ||
      (output.items.length === 0 && output.nextCursor !== undefined) ||
      !allUnique(output.items.map(({ reference }) => reference.containerId)) ||
      output.items.some(({ reference }) =>
        reference.providerInstanceRef !== input.providerInstanceRef
      )) {
      fail('provider_unavailable', 'Provider container page is not bound to the request.')
    }
    return output
  }

  async listEntries(
    input: Readonly<{ parent: ContentContainerReference; page: unknown }>,
    call: ContentSpaceServiceCallContext
  ) {
    const parent = parseInput(contentContainerReferenceSchema, input.parent)
    const page = parseInput(contentSpacePageRequestSchema, input.page)
    const { provider, context } = await this.#authorizedProvider(
      parent.providerInstanceRef,
      'list-entries',
      call
    )
    await this.#assertResourceReady(
      provider,
      context,
      parent,
      'list-entries',
      call.assertPrincipalCurrent
    )
    const output = parseOutput(contentSpaceEntryPageSchema, await boundedProviderCall(
      () => provider.listEntries({ context, parent, page }),
      context.signal,
      call.assertPrincipalCurrent
    ))
    const identityKeys = output.items.map((item) => item.kind === 'container'
      ? `container:${item.reference.containerId}`
      : `file:${item.reference.fileId}`)
    if (!sameContainer(output.parent, parent) ||
      output.items.length > page.limit ||
      (output.nextCursor !== undefined && output.nextCursor === page.cursor) ||
      (output.items.length === 0 && output.nextCursor !== undefined) ||
      !allUnique(identityKeys) ||
      output.items.some(({ reference }) =>
        reference.providerInstanceRef !== parent.providerInstanceRef
      )) {
      fail('provider_unavailable', 'Provider entry page is not bound to the request.')
    }
    return output
  }

  async observeEntry(
    rawReference: ContentEntryReference,
    call: ContentSpaceServiceCallContext
  ) {
    const reference = parseInput(
      zContentEntryReference,
      rawReference
    )
    const { provider, context, capabilities } = await this.#authorizedProvider(
      reference.providerInstanceRef,
      'observe-entry',
      call
    )
    if ('immutableVersionId' in reference) {
      await this.#assertArtifactStillProven(
        provider,
        context,
        reference,
        call.assertPrincipalCurrent
      )
    }
    return this.#observeBoundEntry(
      provider,
      context,
      reference,
      call.assertPrincipalCurrent,
      capabilities
    )
  }

  async createFolder(
    input: Readonly<{ parent: ContentContainerReference; name: string }>,
    call: ContentSpaceServiceWriteCallContext
  ) {
    const parent = parseInput(contentContainerReferenceSchema, input.parent)
    const name = parseInput(contentSpaceEntryNameSchema, input.name)
    const { provider, context } = await this.#authorizedWriteProvider(
      parent.providerInstanceRef,
      'create-folder',
      call
    )
    await this.#assertResourceReady(
      provider,
      context,
      parent,
      'create-folder',
      call.assertPrincipalCurrent
    )
    const receipt = parseWriteOutput(createFolderReceiptSchema, await writeDispatch(() => boundedProviderCall(
      () => provider.createFolder({ context, parent, name }),
      context.signal,
      call.assertPrincipalCurrent,
      true
    )))
    if (receipt.invocationId !== context.invocationId ||
      !sameContainer(receipt.parent, parent) ||
      receipt.name !== name ||
      receipt.reference.providerInstanceRef !== parent.providerInstanceRef) {
      fail('outcome_unknown', 'Provider folder receipt is not bound to the write.', 'never')
    }
    return receipt
  }

  async uploadNewFile(
    input: Readonly<{
      parent: ContentContainerReference
      name: string
      openSource(signal: AbortSignal): Promise<
        ContentSpaceUploadSource & Readonly<{ close(): Promise<void> }>
      >
    }>,
    call: ContentSpaceServiceWriteCallContext
  ) {
    const parent = parseInput(contentContainerReferenceSchema, input.parent)
    const name = parseInput(contentSpaceEntryNameSchema, input.name)
    const { provider, context } = await this.#authorizedWriteProvider(
      parent.providerInstanceRef,
      'upload-new',
      call
    )
    await this.#assertResourceReady(
      provider,
      context,
      parent,
      'upload-new',
      call.assertPrincipalCurrent
    )
    let source: ContentSpaceUploadSource & Readonly<{ close(): Promise<void> }>
    try {
      source = await boundedProviderCall(
        () => input.openSource(context.signal),
        context.signal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      throw transferError(error, 'source_unavailable')
    }
    if (!Number.isSafeInteger(source.size) || source.size < 0 ||
      source.size > CONTENT_SPACE_LIMITS.maxUploadBytes ||
      typeof source.read !== 'function' || typeof source.close !== 'function') {
      abortBoundedOperationSignal(context.signal, new DOMException(
        'The Host upload source is invalid.',
        'AbortError'
      ))
      if (typeof source.close === 'function') void source.close().catch(() => undefined)
      fail('bounds_exceeded', 'Upload source is invalid or exceeds Content Space bounds.')
    }
    let dispatched = false
    let receipt: z.infer<typeof uploadNewReceiptSchema> | undefined
    let operationFailure: unknown
    try {
      dispatched = true
      receipt = parseWriteOutput(uploadNewReceiptSchema, await writeDispatch(() => boundedProviderCall(
        () => provider.uploadNewFile({
          context,
          parent,
          name,
          source: Object.freeze({
            name: source.name,
            size: source.size,
            read: (range) => source.read(range)
          })
        }),
        context.signal,
        call.assertPrincipalCurrent,
        true
      )))
      if (receipt.invocationId !== context.invocationId ||
        !sameContainer(receipt.parent, parent) ||
        receipt.name !== name || receipt.sourceSize !== source.size ||
        receipt.reference.providerInstanceRef !== parent.providerInstanceRef) {
        fail('outcome_unknown', 'Provider upload receipt is not bound to the write.')
      }
    } catch (error) {
      operationFailure = error instanceof ContentSpaceOperationError
        ? error
        : dispatched
          ? operationError('outcome_unknown', 'The upload outcome cannot be proven.')
          : error
    }

    let cleanupFailure: unknown
    if (context.signal.aborted) {
      // The same signal already asked the Host grant to clean itself up.
      // Reassert close best-effort without allowing slow cleanup to replace
      // an authoritative post-dispatch outcome_unknown result.
      void source.close().catch(() => undefined)
    } else {
      try {
        await boundedProviderCall(
          () => source.close(),
          context.signal,
          call.assertPrincipalCurrent,
          dispatched
        )
      } catch (error) {
        cleanupFailure = error instanceof ContentSpaceOperationError
          ? error
          : !dispatched
            ? transferError(error, 'source_unavailable')
            : undefined
      }
    }
    if (operationFailure !== undefined) throw operationFailure
    if (cleanupFailure !== undefined) throw cleanupFailure
    if (!receipt) fail('outcome_unknown', 'The upload outcome cannot be proven.')
    return receipt
  }

  async downloadFile(
    input: Readonly<{
      reference: ContentFileReference | ArtifactReference
      openDestination(signal: AbortSignal): Promise<Readonly<{
        write(chunk: Uint8Array): Promise<void>
        commit(): Promise<void>
        abort(): Promise<void>
      }>>
    }>,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<DownloadReceipt> {
    const reference = parseInput(zDownloadReference, input.reference)
    const { provider, context } = await this.#authorizedWriteProvider(
      reference.providerInstanceRef,
      'download',
      call
    )
    if ('immutableVersionId' in reference) {
      await this.#assertArtifactStillProven(
        provider,
        context,
        reference,
        call.assertPrincipalCurrent
      )
    }
    await this.#assertResourceReady(
      provider,
      context,
      reference,
      'download',
      call.assertPrincipalCurrent
    )
    let destination: Awaited<ReturnType<typeof input.openDestination>>
    try {
      destination = await boundedProviderCall(
        () => input.openDestination(context.signal),
        context.signal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      throw transferError(error, 'destination_unavailable')
    }
    let settled = false
    let acceptingWrites = true
    let byteLength = 0
    const digest = createHash('sha256')
    let inFlightWrite: Promise<void> | undefined
    let writeViolation: unknown
    const rejectProviderWrite = (message: string): Promise<void> => {
      writeViolation ??= operationError('provider_unavailable', message)
      const rejected = Promise.reject(writeViolation)
      void rejected.catch(() => undefined)
      return rejected
    }
    const providerDestination: ContentSpaceDownloadDestination = Object.freeze({
      write: (chunk: Uint8Array) => {
        if (!acceptingWrites) {
          return rejectProviderWrite('Provider wrote after completing the download operation.')
        }
        if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1 ||
          chunk.byteLength > DOMAIN_FILE_TRANSFER_LIMITS.maxChunkBytes) {
          return rejectProviderWrite('Provider returned an invalid download chunk.')
        }
        if (inFlightWrite) {
          return rejectProviderWrite('Provider attempted concurrent destination writes.')
        }
        const ownedChunk = Uint8Array.from(chunk)
        const pending = (async () => {
          assertNotCancelled(context.signal)
          if (byteLength + ownedChunk.byteLength > CONTENT_SPACE_LIMITS.maxFileBytes) {
            fail('bounds_exceeded', 'Provider download exceeded the bounded destination.')
          }
          await destination.write(ownedChunk)
          byteLength += ownedChunk.byteLength
          digest.update(ownedChunk)
        })().catch((error: unknown) => {
          writeViolation ??= error instanceof ContentSpaceOperationError
            ? error
            : transferError(error, 'destination_unavailable')
          throw error
        })
        inFlightWrite = pending
        void pending.then(
          () => { if (inFlightWrite === pending) inFlightWrite = undefined },
          () => { if (inFlightWrite === pending) inFlightWrite = undefined }
        )
        return pending
      }
    })
    try {
      const rawReceipt = await boundedProviderCall(
        () => provider.downloadFile({ context, reference, destination: providerDestination }),
        context.signal,
        call.assertPrincipalCurrent,
        true
      )
      acceptingWrites = false
      // Give writes queued by the Provider before its return a chance to expose
      // a contract violation before the Host-owned destination can be committed.
      await Promise.resolve()
      const pendingWrite = inFlightWrite
      if (pendingWrite) {
        await boundedProviderCall(
          () => pendingWrite,
          context.signal,
          call.assertPrincipalCurrent
        )
      }
      if (writeViolation !== undefined) throw writeViolation
      const receipt = parseOutput(downloadReceiptSchema, rawReceipt)
      const actualDigest = digest.digest('hex')
      if (receipt.invocationId !== context.invocationId ||
        !sameDownloadReference(receipt.reference, reference) ||
        receipt.bytesWritten !== byteLength ||
        (receipt.digest && receipt.digest.value !== actualDigest) ||
        ('digest' in reference && reference.digest && reference.digest.value !== actualDigest)) {
        fail('provider_unavailable', 'Provider download output is not bound to written bytes.')
      }
      assertNotCancelled(context.signal)
      try {
        await boundedProviderCall(
          () => destination.commit(),
          context.signal,
          call.assertPrincipalCurrent,
          true
        )
        settled = true
      } catch (error) {
        if (error instanceof DomainFileTransferError &&
          error.code === 'destination_conflict') {
          fail('conflict', 'The selected destination already exists.', 'after-human-action')
        }
        fail('outcome_unknown', 'The destination commit outcome cannot be proven.')
      }
      return receipt
    } catch (error) {
      acceptingWrites = false
      if (!settled) {
        if (context.signal.aborted) {
          // The Host grant owns cancellation cleanup for this same signal. Do
          // not let a slow filesystem cleanup hide the already-bounded result.
          void destination.abort().catch(() => undefined)
        } else {
        try {
          await boundedProviderCall(
            () => destination.abort(),
            context.signal,
            call.assertPrincipalCurrent,
            true
          )
          settled = true
        } catch {
          fail('outcome_unknown', 'The download destination could not be settled.')
        }
        }
      }
      if (error instanceof ContentSpaceOperationError) throw error
      throw transferError(error, 'destination_unavailable')
    }
  }

  async resolvePortalTarget(
    rawReference: ContentEntryReference,
    call: ContentSpaceServiceCallContext
  ) {
    const reference = parseInput(zContentEntryReference, rawReference)
    const { provider, context } = await this.#authorizedProvider(
      reference.providerInstanceRef,
      'portal-target',
      call
    )
    if ('immutableVersionId' in reference) {
      await this.#assertArtifactStillProven(
        provider,
        context,
        reference,
        call.assertPrincipalCurrent
      )
    }
    await this.#assertResourceReady(
      provider,
      context,
      reference,
      'portal-target',
      call.assertPrincipalCurrent
    )
    const target = await boundedProviderCall(
      () => provider.resolvePortalTarget({ context, reference }),
      context.signal,
      call.assertPrincipalCurrent
    )
    return safeProviderPortalTarget(target, this.#now())
  }

  async openPortalTarget(
    openTarget: (signal: AbortSignal) => Promise<void>,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<void> {
    if (!this.#platform.externalNavigation) {
      fail('blocked_by_contract', 'The Host external-navigation gate is unavailable.')
    }
    parseInput(contentSpaceInvocationIdSchema, call.invocationId)
    if (!(call.signal instanceof AbortSignal)) {
      fail('invalid_input', 'A cancellable portal invocation is required.')
    }
    const signal = createBoundedOperationSignal(call.signal, this.#operationDeadlineMs)
    try {
      await boundedProviderCall(
        () => openTarget(signal),
        signal,
        call.assertPrincipalCurrent,
        true
      )
    } catch (error) {
      if (error instanceof ContentSpaceOperationError) throw error
      if (error instanceof DomainExternalNavigationError) {
        if (error.code === 'cancelled') {
          fail('cancelled', 'The portal open was cancelled before dispatch.')
        }
        if (error.code === 'principal_changed') {
          fail('unauthorized', 'The Host Principal changed before portal dispatch.')
        }
        if (error.code === 'outcome_unknown' || error.code === 'open_failed') {
          fail('outcome_unknown', 'The portal open outcome cannot be proven.')
        }
      }
      fail('unsafe_portal_target', 'The Host portal target is unavailable.')
    }
  }

  async observeImmutableVersion(
    rawReference: ContentFileReference,
    call: ContentSpaceServiceCallContext
  ) {
    const reference = parseInput(contentFileReferenceSchema, rawReference)
    const { provider, context } = await this.#authorizedProvider(
      reference.providerInstanceRef,
      'observe-immutable-version',
      call
    )
    await this.#assertResourceReady(
      provider,
      context,
      reference,
      'observe-immutable-version',
      call.assertPrincipalCurrent
    )
    const observation = parseOutput(
      contentSpaceProviderImmutableVersionObservationSchema,
      await boundedProviderCall(
        () => provider.observeImmutableVersion({ context, reference }),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    if (!observation.proven) return immutableVersionObservationSchema.parse(observation)
    const proof = contentSpaceImmutableVersionProofSchema.parse(observation.proof)
    if (!sameFile(proof.reference, reference)) {
      fail('immutable_version_unproven', 'Immutable proof is not bound to the pinned file.')
    }
    return immutableVersionObservationSchema.parse({
      proven: true,
      artifact: artifactReferenceSchema.parse({
        providerInstanceRef: reference.providerInstanceRef,
        fileId: reference.fileId,
        immutableVersionId: proof.immutableVersionId,
        ...(proof.digest ? { digest: proof.digest } : {})
      })
    })
  }

  async #featureInvocation(
    providerInstanceRef: string,
    effect: ContentSpaceProviderFeatureEffect,
    call: ContentSpaceServiceFeatureCallContext
  ): Promise<Readonly<{
    provider: ContentSpaceProvider
    context: ContentSpaceProviderWriteContext
  }>> {
    const invocationId = parseInput(contentSpaceInvocationIdSchema, call.invocationId)
    if (effect !== 'read' && !(call.signal instanceof AbortSignal)) {
      fail('invalid_input', 'A cancellable feature invocation is required.')
    }
    const operationContext = this.#operationContext(
      providerInstanceRef,
      call,
      this.#featureOperationDeadlineMs
    )
    if (!(operationContext.signal instanceof AbortSignal)) {
      fail('cancelled', 'The bounded feature invocation signal is unavailable.')
    }
    const provider = await this.#providerForCall(
      providerInstanceRef,
      operationContext,
      call.assertPrincipalCurrent
    )
    return Object.freeze({
      provider,
      context: Object.freeze({
        ...operationContext,
        invocationId,
        signal: operationContext.signal
      })
    })
  }

  async #prepareNativeDocumentTransfer(
    request: NativeDocumentRequest | AgentNativeDocumentRequest,
    context: ContentSpaceProviderWriteContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<PreparedNativeDocumentTransfer> {
    if (request.operation === 'image-upload' || request.operation === 'import') {
      const providerRequest = withoutTransferLocator(request)
      const locator: FeatureUploadLocator = 'workspaceRelativePath' in request
        ? Object.freeze({ kind: 'workspace', relativePath: request.workspaceRelativePath })
        : Object.freeze({ kind: 'handle', handle: request.sourceHandle })
      return Object.freeze({
        request: Object.freeze(providerRequest),
        source: await this.#openFeatureSource(
          locator,
          context,
          assertPrincipalCurrent
        )
      })
    }

    if (request.operation === 'image-download' || request.operation === 'export') {
      const providerRequest = withoutTransferLocator(request)
      const locator: FeatureDownloadLocator = 'workspaceRelativePath' in request
        ? Object.freeze({ kind: 'workspace', relativePath: request.workspaceRelativePath })
        : Object.freeze({ kind: 'handle', handle: request.destinationHandle })
      return Object.freeze({
        request: Object.freeze(providerRequest),
        destination: await this.#openFeatureDestination(
          locator,
          context,
          assertPrincipalCurrent
        )
      })
    }

    return Object.freeze({ request })
  }

  async #prepareExtendedOperationTransfer(
    operation: ContentSpaceExtendedOperationKey,
    request: any,
    context: ContentSpaceProviderWriteContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<PreparedNativeDocumentTransfer> {
    if (operation === 'updateFileVersion' || operation === 'addAttachment') {
      const providerRequest = withoutTransferLocator(request)
      const locator: FeatureUploadLocator = 'workspaceRelativePath' in request
        ? Object.freeze({ kind: 'workspace', relativePath: request.workspaceRelativePath })
        : Object.freeze({ kind: 'handle', handle: request.sourceHandle })
      return Object.freeze({
        request: Object.freeze(providerRequest),
        source: await this.#openFeatureSource(
          locator,
          context,
          assertPrincipalCurrent
        )
      })
    }
    if (operation === 'exportFileAsPdf') {
      const providerRequest = withoutTransferLocator(request)
      const locator: FeatureDownloadLocator = 'workspaceRelativePath' in request
        ? Object.freeze({ kind: 'workspace', relativePath: request.workspaceRelativePath })
        : Object.freeze({ kind: 'handle', handle: request.destinationHandle })
      return Object.freeze({
        request: Object.freeze(providerRequest),
        destination: await this.#openFeatureDestination(
          locator,
          context,
          assertPrincipalCurrent
        )
      })
    }
    return Object.freeze({ request })
  }

  async #openFeatureSource(
    locator: FeatureUploadLocator,
    context: ContentSpaceProviderWriteContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<NonNullable<PreparedNativeDocumentTransfer['source']>> {
    const transfers = this.#featureFileTransfers
    if (!transfers) fail('source_unavailable', 'Host file transfer is unavailable.')
    let source: Awaited<ReturnType<DomainMainFileTransferHost['openUploadSource']>>
    try {
      source = await boundedProviderCall(
        () => locator.kind === 'workspace'
          ? transfers.openWorkspaceUploadSource({
            relativePath: locator.relativePath,
            maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
            signal: context.signal
          })
          : transfers.openUploadSource({
            handle: locator.handle,
            maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
            signal: context.signal
          }),
        context.signal,
        assertPrincipalCurrent
      )
    } catch (error) {
      throw transferError(error, 'source_unavailable')
    }
    const sha256 = source.sha256
    if (!Number.isSafeInteger(source.size) || source.size < 0 ||
      source.size > CONTENT_SPACE_LIMITS.maxUploadBytes) {
      void source.close().catch(() => undefined)
      fail('bounds_exceeded', 'Feature source exceeds Content Space bounds.')
    }
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
      void source.close().catch(() => undefined)
      fail('source_unavailable', 'Host upload snapshot attestation is unavailable.')
    }
    let closed = false
    return Object.freeze({
      provider: Object.freeze({
        name: source.name,
        size: source.size,
        sha256,
        read: (range: Readonly<{ offset: number; length: number }>) => source.read(range)
      }),
      byteLength: source.size,
      sha256,
      close: async (outcomeUncertain: boolean) => {
        if (closed) return
        closed = true
        try {
          await boundedProviderCall(
            () => source.close(),
            context.signal,
            assertPrincipalCurrent,
            outcomeUncertain
          )
        } catch (error) {
          if (outcomeUncertain) {
            fail('outcome_unknown', 'Feature source cleanup is uncertain.', 'never')
          }
          throw transferError(error, 'source_unavailable')
        }
      }
    })
  }

  async #openFeatureDestination(
    locator: FeatureDownloadLocator,
    context: ContentSpaceProviderWriteContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<NonNullable<PreparedNativeDocumentTransfer['destination']>> {
    const transfers = this.#featureFileTransfers
    if (!transfers) fail('destination_unavailable', 'Host file transfer is unavailable.')
    let destination: Awaited<ReturnType<DomainMainFileTransferHost['openDownloadDestination']>>
    try {
      destination = await boundedProviderCall(
        () => locator.kind === 'workspace'
          ? transfers.openWorkspaceDownloadDestination({
            relativePath: locator.relativePath,
            maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes,
            signal: context.signal
          })
          : transfers.openDownloadDestination({
            handle: locator.handle,
            maxBytes: CONTENT_SPACE_LIMITS.maxFileBytes,
            signal: context.signal
          }),
        context.signal,
        assertPrincipalCurrent
      )
    } catch (error) {
      throw transferError(error, 'destination_unavailable')
    }
    let byteLength = 0
    let writing = false
    let accepting = true
    let settled = false
    let actualDigest: string | undefined
    const digest = createHash('sha256')
    const providerDestination: ContentSpaceDownloadDestination = Object.freeze({
      write: async (chunk) => {
        if (!accepting || writing || !(chunk instanceof Uint8Array) ||
          chunk.byteLength < 1 ||
          chunk.byteLength > DOMAIN_FILE_TRANSFER_LIMITS.maxChunkBytes ||
          byteLength + chunk.byteLength > CONTENT_SPACE_LIMITS.maxFileBytes) {
          fail('provider_unavailable', 'Provider returned an invalid transfer chunk.')
        }
        writing = true
        try {
          const owned = Uint8Array.from(chunk)
          await destination.write(owned)
          byteLength += owned.byteLength
          digest.update(owned)
        } catch (error) {
          throw transferError(error, 'destination_unavailable')
        } finally {
          writing = false
        }
      }
    })
    const abort = async () => {
      if (settled) return
      accepting = false
      try {
        await boundedProviderCall(
          () => destination.abort(),
          context.signal,
          assertPrincipalCurrent,
          true
        )
        settled = true
      } catch {
        fail('outcome_unknown', 'Feature destination could not be settled.', 'never')
      }
    }
    return Object.freeze({
      locator,
      provider: providerDestination,
      abort,
      commit: async (expected: Readonly<{
        bytesWritten?: number
        digest?: string
      }>) => {
        if (settled) fail('outcome_unknown', 'Feature destination is already settled.')
        accepting = false
        actualDigest ??= digest.digest('hex')
        if ((expected.bytesWritten !== undefined && expected.bytesWritten !== byteLength) ||
          (expected.digest !== undefined && expected.digest !== actualDigest)) {
          await abort()
          fail('outcome_unknown', 'Provider transfer receipt does not match written bytes.')
        }
        try {
          await boundedProviderCall(
            () => destination.commit(),
            context.signal,
            assertPrincipalCurrent,
            true
          )
          settled = true
        } catch {
          fail('outcome_unknown', 'Feature destination commit is uncertain.', 'never')
        }
      }
    })
  }

  async #assertArtifactStillProven(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderOperationContext,
    artifact: ArtifactReference,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<void> {
    const file = contentFileReferenceSchema.parse({
      providerInstanceRef: artifact.providerInstanceRef,
      fileId: artifact.fileId
    })
    const capabilities = await this.#describe(
      provider,
      context,
      assertPrincipalCurrent
    )
    const immutableState = capabilities.find((candidate) =>
      candidate.operation === 'observe-immutable-version'
    )
    if (!immutableState || immutableState.readiness !== 'production_ready') {
      fail('blocked_by_contract', 'Immutable-version proof is unavailable by Provider policy.')
    }
    await this.#assertResourceReady(
      provider,
      context,
      file,
      'observe-immutable-version',
      assertPrincipalCurrent
    )
    const observation = parseOutput(
      contentSpaceProviderImmutableVersionObservationSchema,
      await boundedProviderCall(
        () => provider.observeImmutableVersion({ context, reference: file }),
        context.signal,
        assertPrincipalCurrent
      )
    )
    if (!observation.proven ||
      observation.proof.immutableVersionId !== artifact.immutableVersionId ||
      !sameFile(observation.proof.reference, file) ||
      (artifact.digest && observation.proof.digest?.value !== artifact.digest.value)) {
      fail('immutable_version_unproven', 'Artifact version proof is no longer exact.')
    }
  }

  async #observeBoundEntry(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderOperationContext,
    reference: ContentEntryReference,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent'],
    globalCapabilities?: readonly z.infer<
      typeof contentSpaceCapabilityStateListSchema
    >[number][]
  ) {
    const output = parseOutput(contentSpaceEntryObservationSchema, await boundedProviderCall(
      () => provider.observeEntry({ context, reference }),
      context.signal,
      assertPrincipalCurrent
    ))
    assertObservationBinding(reference, output.entry.reference)
    const resourceCapabilities = this.#effectiveCapabilities(output.capabilities, false)
    return contentSpaceEntryObservationSchema.parse({
      ...output,
      capabilities: globalCapabilities
        ? resourceCapabilities.map((state) => {
            const globalState = globalCapabilities.find((candidate) =>
              candidate.operation === state.operation
            )
            return globalState && operationReady(globalState)
              ? state
              : Object.freeze({
                  operation: state.operation,
                  readiness: 'blocked_by_contract' as const,
                  reasonCode: globalState?.reasonCode ?? 'provider_contract_missing'
                })
          })
        : resourceCapabilities
    })
  }

  async #assertResourceReady(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderOperationContext,
    reference: ContentEntryReference,
    operation: ContentSpaceOperation,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<void> {
    const observation = await this.#observeBoundEntry(
      provider,
      context,
      reference,
      assertPrincipalCurrent
    )
    const state = observation.capabilities.find((candidate) =>
      candidate.operation === operation
    )
    if (!state || !operationReady(state)) {
      fail('blocked_by_contract', `Content Space resource operation ${operation} is unavailable.`)
    }
  }

  async #authorizedProvider(
    providerInstanceRef: string,
    operation: ContentSpaceOperation,
    call: ContentSpaceServiceCallContext
  ): Promise<Readonly<{
    provider: ContentSpaceProvider
    context: ContentSpaceProviderOperationContext
    capabilities: readonly z.infer<
      typeof contentSpaceCapabilityStateListSchema
    >[number][]
  }>> {
    const context = this.#operationContext(providerInstanceRef, call)
    const provider = await this.#providerForCall(
      providerInstanceRef,
      context,
      call.assertPrincipalCurrent
    )
    const capabilities = await this.#describe(
      provider,
      context,
      call.assertPrincipalCurrent
    )
    assertNotCancelled(context.signal)
    const state = capabilities.find((candidate) => candidate.operation === operation)
    if (!state || !operationReady(state)) {
      fail('blocked_by_contract', `Content Space operation ${operation} is unavailable.`)
    }
    return Object.freeze({ provider, context, capabilities })
  }

  async #authorizedWriteProvider(
    providerInstanceRef: string,
    operation: ContentSpaceOperation,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<Readonly<{
    provider: ContentSpaceProvider
    context: ContentSpaceProviderWriteContext
  }>> {
    const invocationId = parseInput(contentSpaceInvocationIdSchema, call.invocationId)
    if (!(call.signal instanceof AbortSignal)) {
      fail('invalid_input', 'A cancellable write signal is required.')
    }
    assertNotCancelled(call.signal)
    const result = await this.#authorizedProvider(providerInstanceRef, operation, {
      ...call
    })
    if (!result.context.signal) {
      fail('cancelled', 'The bounded Provider operation signal is unavailable.')
    }
    return Object.freeze({
      provider: result.provider,
      context: Object.freeze({
        ...result.context,
        invocationId,
        signal: result.context.signal
      })
    })
  }

  async #describe(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderOperationContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ) {
    return this.#effectiveCapabilities(
      parseOutput(
        contentSpaceCapabilityStateListSchema,
        await boundedProviderCall(
          () => provider.describeCapabilities(context),
          context.signal,
          assertPrincipalCurrent
        )
      ),
      true
    )
  }

  #effectiveCapabilities(
    states: readonly z.infer<typeof contentSpaceCapabilityStateListSchema>[number][],
    requireObservationGate: boolean
  ) {
    const observationState = states.find((state) => state.operation === 'observe-entry')
    const observationReady = observationState
      ? operationReady(observationState)
      : false
    return contentSpaceCapabilityStateListSchema.parse(states.map((state) => {
      const pocBlocked = state.readiness === 'poc_only'
      const observationBlocked = requireObservationGate && !observationReady && [
        'list-entries',
        'create-folder',
        'upload-new',
        'download',
        'portal-target',
        'observe-immutable-version'
      ].includes(state.operation)
      const platformBlocked =
        (!this.#platform.fileTransfers &&
          (state.operation === 'upload-new' || state.operation === 'download')) ||
        (!this.#platform.externalNavigation && state.operation === 'portal-target')
      return platformBlocked
        ? Object.freeze({
            operation: state.operation,
            readiness: 'blocked_by_contract' as const,
            reasonCode: 'platform_gate_blocked' as const
          })
        : observationBlocked
          ? Object.freeze({
              operation: state.operation,
              readiness: 'blocked_by_contract' as const,
              reasonCode: observationState?.reasonCode ?? 'provider_contract_missing'
            })
          : pocBlocked
            ? Object.freeze({
                operation: state.operation,
                readiness: 'blocked_by_contract' as const,
                reasonCode: state.reasonCode
              })
            : state
    }))
  }

  #provider(providerInstanceRef: string): Promise<ContentSpaceProvider> {
    let pinned = this.#pinned.get(providerInstanceRef)
    if (!pinned) {
      pinned = this.#pin(providerInstanceRef)
      this.#pinned.set(providerInstanceRef, pinned)
      void pinned.catch(() => {
        if (this.#pinned.get(providerInstanceRef) === pinned) {
          this.#pinned.delete(providerInstanceRef)
        }
      })
    }
    return pinned
  }

  async #providerForCall(
    providerInstanceRef: string,
    context: ContentSpaceProviderOperationContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ): Promise<ContentSpaceProvider> {
    const pending = this.#provider(providerInstanceRef)
    // A caller's cancellation ends only that caller's wait. The pending pin is
    // shared runtime state and must remain available to concurrent or later
    // callers; evicting it here can instantiate two Providers for one exact
    // ProviderInstanceRef. Actual factory rejection is handled by #provider.
    return boundedProviderCall(
      () => pending,
      context.signal,
      assertPrincipalCurrent
    )
  }

  async #pin(providerInstanceRef: string): Promise<ContentSpaceProvider> {
    try {
      return (await this.#catalog.pin(providerInstanceRef)).provider
    } catch (error) {
      if (error instanceof ProviderCompositionError) {
        const code: ContentSpaceErrorCode = error.code === 'unknown_provider_instance'
          ? 'unknown_provider_instance'
          : error.code === 'missing_provider'
            ? 'missing_provider'
            : error.code === 'composition_not_ready'
              ? 'composition_not_ready'
              : error.code === 'invalid_contribution' ||
                  error.code === 'duplicate_provider_kind' ||
                  error.code === 'duplicate_provider_instance' ||
                  error.code === 'invalid_provider_instance'
                ? 'invalid_contribution'
                : error.code === 'incompatible_contract_version'
                  ? 'incompatible_contract_version'
                  : 'provider_unavailable'
        fail(code, error.message)
      }
      fail('provider_unavailable', 'The pinned Content Space Provider is unavailable.')
    }
  }

  #operationContext(
    providerInstanceRef: string,
    call: ContentSpaceServiceCallContext,
    deadlineMs = this.#operationDeadlineMs
  ): ContentSpaceProviderOperationContext {
    const principal = parseInput(principalSnapshotSchema, call.reauthorizedPrincipal)
    assertNotCancelled(call.signal)
    const signal = createBoundedOperationSignal(call.signal, deadlineMs)
    return Object.freeze({
      principal,
      providerInstanceRef,
      assertPrincipalCurrent: call.assertPrincipalCurrent,
      deadlineAt: new Date(
        this.#now().getTime() + deadlineMs
      ).toISOString(),
      signal
    })
  }

}

const zContentEntryReference = artifactReferenceSchema.or(
  contentContainerReferenceSchema
).or(contentFileReferenceSchema)
const zDownloadReference = artifactReferenceSchema.or(contentFileReferenceSchema)

type FeatureUploadLocator =
  | Readonly<{ kind: 'handle'; handle: string }>
  | Readonly<{ kind: 'workspace'; relativePath: string }>

type FeatureDownloadLocator = FeatureUploadLocator

function withoutTransferLocator(
  request: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const {
    sourceHandle: _sourceHandle,
    destinationHandle: _destinationHandle,
    workspaceRelativePath: _workspaceRelativePath,
    ...providerRequest
  } = request
  return providerRequest
}

type PreparedNativeDocumentTransfer = Readonly<{
  request: unknown
  source?: Readonly<{
    provider: ContentSpaceUploadSource
    byteLength: number
    sha256: string
    close(outcomeUncertain: boolean): Promise<void>
  }>
  destination?: Readonly<{
    locator: FeatureDownloadLocator
    provider: ContentSpaceDownloadDestination
    commit(expected: Readonly<{
      bytesWritten?: number
      digest?: string
    }>): Promise<void>
    abort(): Promise<void>
  }>
}>

function attestExtendedUploadReceipt(
  operation: ContentSpaceExtendedOperationKey,
  rawResult: unknown,
  source: PreparedNativeDocumentTransfer['source'],
  request: unknown
): unknown {
  if (operation !== 'updateFileVersion' || !source ||
    !isRecord(rawResult) || rawResult.ok !== true || !isRecord(rawResult.value)) {
    return rawResult
  }
  const receipt = rawResult.value
  if (!isRecord(request) || !isRecord(request.reference) ||
    !isRecord(receipt.reference) ||
    receipt.reference.providerInstanceRef !== request.reference.providerInstanceRef ||
    receipt.reference.fileId !== request.reference.fileId ||
    receipt.versionId === request.expectedVersionId ||
    receipt.strategy !== request.strategy) {
    fail(
      'outcome_unknown',
      'Provider version receipt does not prove the requested same-file update.'
    )
  }
  const returnedByteLength = receipt.byteLength
  const returnedDigest = receipt.digest
  if ((returnedByteLength !== undefined && returnedByteLength !== source.byteLength) ||
    (returnedDigest !== undefined && (!isRecord(returnedDigest) ||
      returnedDigest.algorithm !== 'sha256' || returnedDigest.value !== source.sha256))) {
    fail('outcome_unknown', 'Provider version receipt disagrees with the Host upload snapshot.')
  }
  return Object.freeze({
    ...rawResult,
    value: Object.freeze({
      ...receipt,
      byteLength: source.byteLength,
      digest: Object.freeze({ algorithm: 'sha256' as const, value: source.sha256 })
    })
  })
}

function providerFeatureExecutionContext(
  effect: ContentSpaceProviderFeatureEffect,
  context: ContentSpaceProviderWriteContext
) {
  return effect === 'read'
    ? Object.freeze({
        effect: 'read' as const,
        context: context as ContentSpaceProviderOperationContext
      })
    : Object.freeze({ effect, context })
}

function parseContentFeatureTarget(value: unknown): ContentSpaceProviderContentTarget {
  if (!isRecord(value) || value.kind !== 'content' || !Array.isArray(value.authorized)) {
    fail('invalid_input', 'The Content Space feature target is invalid.')
  }
  const root = parseInput(contentContainerReferenceSchema, value.root)
  const primary = parseInput(zContentEntryReference, value.primary)
  const authorized = Object.freeze(value.authorized.map((reference) =>
    parseInput(zContentEntryReference, reference)
  ))
  if (authorized.length < 1 || authorized.length > 2_048 ||
    primary.providerInstanceRef !== root.providerInstanceRef ||
    authorized.some((reference) => reference.providerInstanceRef !== root.providerInstanceRef) ||
    !authorized.some((reference) => sameContentEntryReference(reference, primary))) {
    fail('invalid_target', 'The Content Space feature target is not Broker-bound.')
  }
  return Object.freeze({ kind: 'content', root, primary, authorized })
}

function parseFeatureTarget(value: unknown): ContentSpaceProviderFeatureTarget {
  if (isRecord(value) && value.kind === 'provider-administration') {
    const providerInstanceRef = parseInput(providerInstanceRefSchema, value.providerInstanceRef)
    if (Object.keys(value).sort().join(',') !== 'kind,providerInstanceRef') {
      fail('invalid_input', 'The Provider administration target is invalid.')
    }
    return Object.freeze({ kind: 'provider-administration', providerInstanceRef })
  }
  return parseContentFeatureTarget(value)
}

function featureTargetProvider(target: ContentSpaceProviderFeatureTarget): string {
  return target.kind === 'content'
    ? target.primary.providerInstanceRef
    : target.providerInstanceRef
}

function assertExtendedFeatureAuthority(
  operation: ContentSpaceExtendedOperationKey,
  request: unknown,
  target: ContentSpaceProviderFeatureTarget
): void {
  const authority = extendedOperationAuthority(operation, request)
  if (authority.kind === 'provider') {
    if (target.kind !== 'provider-administration' ||
      target.providerInstanceRef !== authority.providerInstanceRef) {
      fail('unauthorized', 'Provider-scoped operations require explicit administration authority.')
    }
    return
  }
  if (target.kind !== 'content' ||
    !sameContentEntryReference(target.primary, authority.reference)) {
    fail('invalid_target', 'The extended operation does not match Broker authority.')
  }
}

function assertContentRootMutationAllowed(
  operation: ContentSpaceExtendedOperationKey,
  request: any,
  target: ContentSpaceProviderFeatureTarget
): void {
  if (target.kind !== 'content') return
  const protectedTargets: readonly ContentEntryReference[] = (() => {
    switch (operation) {
      case 'renameEntry':
      case 'updateEntryProperties':
      case 'changePermissions':
        return [request.target]
      case 'copyEntries':
      case 'moveEntries':
      case 'deleteEntries':
        return request.entries
      case 'createShortcut':
        return [request.target]
      default:
        return []
    }
  })()
  if (protectedTargets.some((reference) =>
    sameContentEntryReference(reference, target.root)
  )) {
    fail(
      'invalid_target',
      'A Content Space root may only be changed through Content Space administration.'
    )
  }
}

function assertNativeDocumentReceiptBinding(
  receipt: z.output<typeof contentSpaceProviderNativeDocumentReceiptSchema>,
  operation: z.output<typeof nativeDocumentRequestSchema>['operation'],
  invocationId: string,
  providerInstanceRef: string,
  effect: ContentSpaceProviderFeatureEffect
): void {
  const resultProvider = receipt.outcome === 'succeeded' &&
    'document' in receipt.result
    ? receipt.result.document.reference.providerInstanceRef
    : providerInstanceRef
  if (receipt.operation !== operation || receipt.invocationId !== invocationId ||
    resultProvider !== providerInstanceRef) {
    fail(
      effect === 'read' ? 'provider_unavailable' : 'outcome_unknown',
      'Native-document Provider receipt is not bound to the invocation.',
      'never'
    )
  }
}

function administrationOperationEffect(
  operation: ContentSpaceAdministrationOperation
): ContentSpaceProviderFeatureEffect {
  if (operation === 'remove-member') return 'destructive'
  if (operation === 'list-spaces' || operation === 'observe-space' ||
    operation === 'open-root' || operation === 'list-members') return 'read'
  return 'external-write'
}

function parseAdministrationRequest(
  operation: ContentSpaceAdministrationOperation,
  value: unknown
): any {
  const schemas = {
    'list-spaces': contentSpaceAdministrationListSpacesInputSchema,
    'create-space': contentSpaceAdministrationCreateSpaceInputSchema,
    'observe-space': contentSpaceAdministrationObserveSpaceInputSchema,
    'update-space': contentSpaceAdministrationUpdateSpaceInputSchema,
    'pin-space': contentSpaceAdministrationPinSpaceInputSchema,
    'unpin-space': contentSpaceAdministrationUnpinSpaceInputSchema,
    'open-root': contentSpaceAdministrationOpenRootInputSchema,
    'list-members': contentSpaceAdministrationListMembersInputSchema,
    'add-member': contentSpaceAdministrationAddMemberInputSchema,
    'remove-member': contentSpaceAdministrationRemoveMemberInputSchema,
    'provision-project': projectContentSpaceProvisioningIntentSchema
  } as const
  return parseInput(schemas[operation], value)
}

function parseAdministrationOutput(
  operation: ContentSpaceAdministrationOperation,
  value: unknown,
  write: boolean
): any {
  const schemas = {
    'list-spaces': contentSpaceAdministrationSpacePageSchema,
    'create-space': contentSpaceAdministrationSpaceSummarySchema,
    'observe-space': contentSpaceAdministrationSpaceSummarySchema,
    'update-space': contentSpaceAdministrationSpaceSummarySchema,
    'pin-space': contentSpaceAdministrationSpaceSummarySchema,
    'unpin-space': contentSpaceAdministrationSpaceSummarySchema,
    'open-root': contentSpaceAdministrationRootOpenResultSchema,
    'list-members': contentSpaceAdministrationMemberPageSchema,
    'add-member': contentSpaceAdministrationMemberSummarySchema,
    'remove-member': contentSpaceAdministrationRemoveMemberReceiptSchema,
    'provision-project': projectContentSpaceProvisioningReportSchema
  } as const
  return write ? parseWriteOutput(schemas[operation], value) : parseOutput(schemas[operation], value)
}

async function dispatchAdministrationOperation(
  operation: ContentSpaceAdministrationOperation,
  request: any,
  administration: ReturnType<typeof defineContentSpaceAdministrationPort>,
  projectProvisioning: ReturnType<typeof defineProjectContentSpaceProvisioningPort> | undefined
): Promise<unknown> {
  switch (operation) {
    case 'list-spaces': return administration.listSpaces(request)
    case 'create-space': return administration.createSpace(request)
    case 'observe-space': return administration.observeSpace(request)
    case 'update-space': return administration.updateSpace(request)
    case 'pin-space': return administration.pinSpace(request)
    case 'unpin-space': return administration.unpinSpace(request)
    case 'open-root': return administration.openRoot(request)
    case 'list-members': return administration.listMembers(request)
    case 'add-member': return administration.addMember(request)
    case 'remove-member': return administration.removeMember(request)
    case 'provision-project': {
      if (!projectProvisioning) {
        fail('blocked_by_contract', 'Project Content Space provisioning is unavailable.')
      }
      return projectProvisioning.provisionProjectContentSpace(request)
    }
  }
}

function assertAdministrationTarget(
  operation: ContentSpaceAdministrationOperation,
  request: any,
  target: ContentSpaceProviderFeatureTarget
): void {
  if (operation === 'list-spaces' || operation === 'create-space' ||
    operation === 'provision-project') {
    if (target.kind !== 'provider-administration') {
      fail('unauthorized', 'This administration operation requires Provider authority.')
    }
    return
  }
  if (target.kind !== 'content' || !('containerId' in target.primary) ||
    !sameContentEntryReference(target.primary, target.root)) {
    fail('unauthorized', 'This administration operation requires an authorized root.')
  }
  let requestRoot: ContentContainerReference
  try {
    requestRoot = parsePortableContentContainerReference(request.root)
  } catch {
    fail('invalid_target', 'The administration root is invalid.')
  }
  if (!sameContentEntryReference(requestRoot, target.primary)) {
    fail('invalid_target', 'The administration request does not match Broker authority.')
  }
}

function assertAdministrationOutputProvider(
  operation: ContentSpaceAdministrationOperation,
  output: any,
  providerInstanceRef: string,
  effect: ContentSpaceProviderFeatureEffect
): void {
  const roots: unknown[] = []
  if (operation === 'list-spaces') {
    roots.push(...output.items.map((item: any) => item.root))
  } else if (operation === 'add-member') {
    return
  } else if (operation === 'provision-project') {
    if (output.root) roots.push(output.root)
  } else if (output.root) {
    roots.push(output.root)
  }
  try {
    if (roots.some((root) =>
      parsePortableContentContainerReference(root).providerInstanceRef !== providerInstanceRef
    )) throw new Error('Provider drift')
  } catch {
    fail(
      effect === 'read' ? 'provider_unavailable' : 'outcome_unknown',
      'Provider administration output changed authority.',
      'never'
    )
  }
}

function normalizeExtendedPortalResult(
  operation: ContentSpaceExtendedOperationKey,
  result: unknown,
  now: Date
): any {
  if (operation !== 'resolveInternalLink' &&
    operation !== 'resolveCollaborationInvitation') return result
  if (!isRecord(result) || result.ok !== true || !isRecord(result.value)) return result
  return Object.freeze({
    ...result,
    value: Object.freeze({
      ...result.value,
      target: safeProviderPortalTarget(result.value.target, now)
    })
  })
}

function safeProviderPortalTarget(
  target: unknown,
  nowValue: Date
): Readonly<{ url: string; expiresAt: string }> {
  if (!isRecord(target) || typeof target.url !== 'string' ||
    typeof target.expiresAt !== 'string') {
    fail('unsafe_portal_target', 'Provider portal target is invalid.')
  }
  let url: URL
  try {
    url = new URL(target.url)
  } catch {
    fail('unsafe_portal_target', 'Provider portal target is invalid.')
  }
  const expiresAt = Date.parse(target.expiresAt)
  const now = nowValue.getTime()
  if (target.url.length > 2_048 || target.url !== target.url.trim() ||
    target.url.includes('\\') || target.url.includes('#') ||
    hasRawAuthorityUserInfo(target.url) || hasControlOrSpaceCharacter(target.url) ||
    url.protocol !== 'https:' || Boolean(url.username || url.password || url.hash) ||
    !Number.isFinite(expiresAt) || expiresAt <= now ||
    expiresAt - now > CONTENT_SPACE_LIMITS.maxPortalLifetimeMs) {
    fail('unsafe_portal_target', 'Provider portal target is not safe and bounded.')
  }
  return Object.freeze({
    // Preserve the exact Provider string: HTTPS query parameters may be signed.
    url: target.url,
    expiresAt: new Date(expiresAt).toISOString()
  })
}

type BoundedOperationSignalLease = Readonly<{
  deadlineAt: number
  abort(reason?: unknown): void
}>

const boundedOperationSignalLeases = new WeakMap<AbortSignal, BoundedOperationSignalLease>()

function createBoundedOperationSignal(
  parent: AbortSignal | undefined,
  durationMs: number
): AbortSignal {
  const deadlineController = new AbortController()
  const signal = parent
    ? AbortSignal.any([parent, deadlineController.signal])
    : deadlineController.signal
  boundedOperationSignalLeases.set(signal, Object.freeze({
    deadlineAt: Date.now() + durationMs,
    abort: (reason = new DOMException(
      'Content Space operation deadline exceeded.',
      'TimeoutError'
    )) => deadlineController.abort(reason)
  }))
  return signal
}

function expireBoundedOperationSignal(signal: AbortSignal | undefined): void {
  if (!signal || signal.aborted) return
  const lease = boundedOperationSignalLeases.get(signal)
  if (lease && Date.now() >= lease.deadlineAt) lease.abort()
}

function abortBoundedOperationSignal(signal: AbortSignal, reason: unknown): void {
  boundedOperationSignalLeases.get(signal)?.abort(reason)
}

async function boundedProviderCall<Value>(
  operation: () => Value | Promise<Value>,
  signal: AbortSignal | undefined,
  assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent'],
  outcomeUncertainOnAbort = false
): Promise<Value> {
  expireBoundedOperationSignal(signal)
  if (signal?.aborted) {
    fail(
      outcomeUncertainOnAbort ? 'outcome_unknown' : 'cancelled',
      outcomeUncertainOnAbort
        ? 'The Provider operation outcome cannot be proven.'
        : 'The Provider operation was cancelled or exceeded its deadline.'
    )
  }
  await assertCurrentPrincipal(assertPrincipalCurrent, false, signal)
  let result: Value | undefined
  let operationFailed = false
  let operationErrorValue: unknown
  try {
    result = signal
      ? await raceProviderOperation(operation, signal, outcomeUncertainOnAbort)
      : await operation()
  } catch (error) {
    operationFailed = true
    operationErrorValue = error
  }
  await assertCurrentPrincipal(assertPrincipalCurrent, outcomeUncertainOnAbort, signal)
  if (operationFailed) throw operationErrorValue
  return result as Value
}

function raceProviderOperation<Value>(
  operation: () => Value | Promise<Value>,
  signal: AbortSignal,
  outcomeUncertainOnAbort: boolean
): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    let completed = false
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const complete = (action: () => void) => {
      if (completed) return
      completed = true
      signal.removeEventListener('abort', onAbort)
      if (deadlineTimer) clearTimeout(deadlineTimer)
      action()
    }
    const onAbort = () => complete(() => reject(operationError(
      outcomeUncertainOnAbort ? 'outcome_unknown' : 'cancelled',
      outcomeUncertainOnAbort
        ? 'The Provider operation outcome cannot be proven.'
        : 'The Provider operation was cancelled or exceeded its deadline.'
    )))
    signal.addEventListener('abort', onAbort, { once: true })
    const lease = boundedOperationSignalLeases.get(signal)
    if (lease) {
      const remainingMs = lease.deadlineAt - Date.now()
      if (remainingMs <= 0) {
        lease.abort()
      } else {
        // A ref'd timer keeps an otherwise idle worker alive only while this
        // concrete await is pending; complete() clears it immediately.
        deadlineTimer = setTimeout(() => lease.abort(), remainingMs)
      }
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    let dispatched: Value | Promise<Value>
    try {
      // Invoke synchronously after the final abort check so an already-cancelled
      // write cannot be queued for a later microtask dispatch.
      dispatched = operation()
    } catch (error) {
      complete(() => reject(error))
      return
    }
    Promise.resolve(dispatched).then(
      (value) => complete(() => resolve(value)),
      (error: unknown) => complete(() => reject(error))
    )
  })
}

async function assertCurrentPrincipal(
  assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent'],
  outcomeUncertain: boolean,
  signal?: AbortSignal
): Promise<void> {
  try {
    if (signal) {
      await raceProviderOperation(assertPrincipalCurrent, signal, outcomeUncertain)
    } else {
      await assertPrincipalCurrent()
    }
  } catch {
    expireBoundedOperationSignal(signal)
    if (signal?.aborted) {
      fail(
        outcomeUncertain ? 'outcome_unknown' : 'cancelled',
        outcomeUncertain
          ? 'The operation lease expired after dispatch; the outcome cannot be proven.'
          : 'The operation was cancelled or exceeded its deadline.'
      )
    }
    fail(
      outcomeUncertain ? 'outcome_unknown' : 'unauthorized',
      outcomeUncertain
        ? 'The Principal changed after Provider dispatch; the outcome cannot be proven.'
        : 'The Host Principal is no longer current.'
    )
  }
}

async function writeDispatch<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ContentSpaceOperationError) throw error
    fail('outcome_unknown', 'The Provider write outcome cannot be proven.')
  }
}

function assertObservationBinding(
  requested: ContentEntryReference,
  observed: ContentContainerReference | ContentFileReference
): void {
  if (requested.providerInstanceRef !== observed.providerInstanceRef) {
    fail('provider_unavailable', 'Provider observation authority drifted.')
  }
  if ('containerId' in requested) {
    if (!('containerId' in observed) || requested.containerId !== observed.containerId) {
      fail('provider_unavailable', 'Provider container observation identity drifted.')
    }
    return
  }
  if ('containerId' in observed || requested.fileId !== observed.fileId) {
    fail('provider_unavailable', 'Provider file observation identity drifted.')
  }
}

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) fail('invalid_input', 'Content Space input is invalid.')
  return parsed.data
}

function parseOutput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) fail('provider_unavailable', 'Content Space Provider output is invalid.')
  return parsed.data
}

function parseWriteOutput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    fail('outcome_unknown', 'Provider write receipt is invalid.', 'never')
  }
  return parsed.data
}

function transferError(error: unknown, fallback: ContentSpaceErrorCode): ContentSpaceOperationError {
  if (error instanceof ContentSpaceOperationError) return error
  if (error instanceof DomainFileTransferError) {
    if (error.code === 'cancelled') {
      return operationError('cancelled', 'The Host file transfer was cancelled.')
    }
    if (error.code === 'principal_changed') {
      return operationError('unauthorized', 'The Host Principal changed.')
    }
    if (error.code === 'bound_exceeded' || error.code === 'capacity_exceeded') {
      return operationError('bounds_exceeded', 'The Host file transfer exceeded its bounds.')
    }
    if (error.code === 'destination_conflict') {
      return operationError('conflict', 'The selected destination already exists.', 'after-human-action')
    }
  }
  return operationError(fallback, 'The Host file transfer is unavailable.')
}

function assertNotCancelled(signal?: AbortSignal): void {
  expireBoundedOperationSignal(signal)
  if (signal?.aborted) fail('cancelled', 'The Content Space operation was cancelled.')
}

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function sameContainer(left: ContentContainerReference, right: ContentContainerReference): boolean {
  return left.providerInstanceRef === right.providerInstanceRef &&
    left.containerId === right.containerId
}

function sameFile(left: ContentFileReference, right: ContentFileReference): boolean {
  return left.providerInstanceRef === right.providerInstanceRef && left.fileId === right.fileId
}

function sameDownloadReference(
  left: ContentFileReference | ArtifactReference,
  right: ContentFileReference | ArtifactReference
): boolean {
  if (!sameFile(left, right)) return false
  const leftVersion = 'immutableVersionId' in left ? left.immutableVersionId : undefined
  const rightVersion = 'immutableVersionId' in right ? right.immutableVersionId : undefined
  const leftDigest = 'digest' in left ? left.digest?.value : undefined
  const rightDigest = 'digest' in right ? right.digest?.value : undefined
  return leftVersion === rightVersion && leftDigest === rightDigest
}

function operationReady(
  state: Readonly<{
    readiness: 'poc_only' | 'blocked_by_contract' | 'production_ready'
    reasonCode: ContentSpaceReadinessReason
  }>
): boolean {
  // `poc_only` is descriptive until composition installs a separately
  // reviewed, trusted PoC policy/audience gate. No such gate exists here.
  return state.readiness === 'production_ready' && state.reasonCode === 'available'
}

function operationError(
  code: ContentSpaceErrorCode,
  message: string,
  retry: 'never' | 'after-human-action' | 'safe-with-same-invocation' = 'never'
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({ code, message, retry })
}

function fail(
  code: ContentSpaceErrorCode,
  message: string,
  retry: 'never' | 'after-human-action' | 'safe-with-same-invocation' = 'never'
): never {
  throw operationError(code, message, retry)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasControlOrSpaceCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x20 || codePoint === 0x7f) return true
  }
  return false
}

function hasRawAuthorityUserInfo(value: string): boolean {
  const authorityStart = value.indexOf('//') + 2
  if (authorityStart < 2) return true
  const authorityEndCandidates = [
    value.indexOf('/', authorityStart),
    value.indexOf('?', authorityStart),
    value.indexOf('#', authorityStart)
  ].filter((index) => index >= 0)
  const authorityEnd = authorityEndCandidates.length > 0
    ? Math.min(...authorityEndCandidates)
    : value.length
  return value.slice(authorityStart, authorityEnd).includes('@')
}
