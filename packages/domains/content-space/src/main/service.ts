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
  contentSpaceAdministrationAddMemberReceiptSchema,
  contentSpaceAdministrationCreateSpaceInputSchema,
  contentSpaceAdministrationListMembersInputSchema,
  contentSpaceAdministrationListSpacesInputSchema,
  contentSpaceAdministrationMemberPageSchema,
  contentSpaceAdministrationMemberReferenceSchema,
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
  type ContentSpaceAdministrationOperation
} from '../administration-contract.js'
import {
  principalSnapshotSchema,
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import {
  ProviderCompositionError,
  providerInstanceRefSchema
} from '@sciforge/domain-sdk/provider-composition'

import {
  CONTENT_SPACE_LIMITS,
  CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS,
  ContentSpaceOperationError,
  artifactReferenceSchema,
  contentContainerReferenceSchema,
  contentFileReferenceSchema,
  contentSpaceAdmittedCapabilityStateListSchema,
  contentSpaceCapabilityListSchema,
  contentSpaceCapabilityStateListSchema,
  contentSpaceContainerPageSchema,
  contentSpaceEntryNameSchema,
  contentSpaceEntryObservationSchema,
  contentSpaceEntryPageSchema,
  contentSpaceExternalBindingAttestationSchema,
  contentSpaceFileDescendantProofEvidenceSchema,
  contentSpaceFileDescendantProofRequestSchema,
  contentSpaceImmutableVersionProofSchema,
  contentSpaceInvocationIdSchema,
  contentSpacePageRequestSchema,
  contentSpaceProviderEntryObservationSchema,
  contentSpaceProviderImmutableVersionObservationSchema,
  contentSpaceProviderInstanceListSchema,
  contentSpaceProviderUploadNewReceiptSchema,
  contentSpaceSha256Schema,
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
  type ContentSpaceSystemTransferPreflightStatus,
  type ContentSpaceUploadWriteAfterObservation,
  type ContentSpaceUploadSource,
  type DownloadReceipt,
  type UploadNewReceipt,
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
  defineContentSpaceProviderAdministrationBinding,
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
import {
  contentSpaceVerificationPolicyAdmits,
  contentSpaceVerificationPolicyHasExternalBindingCandidate,
  contentSpaceVerificationPolicyMatch,
  contentSpaceVerificationPolicyRequiresExternalBinding,
  defineContentSpaceVerificationPolicy,
  type ContentSpaceVerificationAuthority,
  type ContentSpaceVerificationOperation,
  type ContentSpaceVerificationPolicy,
  type ContentSpaceVerificationTransferLimits
} from '../verification-policy.js'

export type ContentSpaceServiceCallContext = Readonly<{
  /** Host-current Principal captured and revalidated at the invoking trust boundary. */
  reauthorizedPrincipal: PrincipalSnapshot
  /** Host-owned invocation lease check; packages never choose the current Principal. */
  assertPrincipalCurrent(): void | Promise<void>
  /** Trusted Broker audience; absent direct/internal calls cannot execute PoC operations. */
  audience?: 'ui' | 'agent' | 'system'
  /** Broker-owned root and exact issued resource; ordinary caller payloads cannot replace either. */
  verificationBinding?: Readonly<{
    root: ContentContainerReference
    reference: ContentEntryReference
  }>
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

export type ContentSpaceUploadTransferEvidence = Readonly<{
  receipt: UploadNewReceipt
  writeAfterObservation: ContentSpaceUploadWriteAfterObservation
  bytes: number
  sha256: string
}>

export type ContentSpaceDownloadTransferEvidence = Readonly<{
  receipt: DownloadReceipt
  bytes: number
  sha256: string
}>

export type ContentSpaceSystemTransferPreflightProbe = Readonly<{
  status: ContentSpaceSystemTransferPreflightStatus
  /**
   * Opaque digest of the current Provider session observation. This is advisory
   * evidence only: it is never accepted as transfer authority and is never cached.
   */
  providerObservationRevision: string
}>

type ContentSpaceSystemTransferPreflightInput =
  | Readonly<{
      operation: 'download'
      root: ContentContainerReference
      candidate: ContentFileReference
    }>
  | Readonly<{
      operation: 'upload-new'
      root: ContentContainerReference
    }>

type ContentSpaceUploadFileInput = Readonly<{
  parent: ContentContainerReference
  name: string
  includeTransferEvidence?: boolean
  openSource(signal: AbortSignal, maxBytes: number): Promise<
    ContentSpaceUploadSource & Readonly<{ close(): Promise<void> }>
  >
}>

type ContentSpaceDownloadFileInput = Readonly<{
  reference: ContentFileReference | ArtifactReference
  proofRoot?: ContentContainerReference
  includeTransferEvidence?: boolean
  openDestination(signal: AbortSignal, maxBytes: number): Promise<Readonly<{
    write(chunk: Uint8Array): Promise<void>
    commit(): Promise<void>
    abort(): Promise<void>
  }>>
}>

export type ContentSpacePlatformGates = Readonly<{
  fileTransfers: boolean
  externalNavigation: boolean
}>

export class ContentSpaceService {
  readonly #catalog: ContentSpaceProviderCatalog
  readonly #now: () => Date
  readonly #monotonicNow: () => number
  readonly #operationDeadlineMs: number
  readonly #featureOperationDeadlineMs: number
  readonly #platform: ContentSpacePlatformGates
  readonly #featureFileTransfers?: DomainMainFileTransferHost
  readonly #verificationPolicy?: ContentSpaceVerificationPolicy
  readonly #pinned = new Map<string, Promise<ContentSpaceProvider>>()

  constructor(input: Readonly<{
    catalog: ContentSpaceProviderCatalog
    platform: ContentSpacePlatformGates
    featureFileTransfers?: DomainMainFileTransferHost
    verificationPolicy?: ContentSpaceVerificationPolicy
    now?: () => Date
    monotonicNow?: () => number
    operationDeadlineMs?: number
    featureOperationDeadlineMs?: number
  }>) {
    this.#catalog = input.catalog
    this.#platform = Object.freeze({ ...input.platform })
    this.#featureFileTransfers = input.featureFileTransfers
    this.#verificationPolicy = input.verificationPolicy
      ? defineContentSpaceVerificationPolicy(input.verificationPolicy)
      : undefined
    this.#now = input.now ?? (() => new Date())
    this.#monotonicNow = input.monotonicNow ?? (() => performance.now())
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
      items: await this.#describe(provider, context, call)
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
    let { provider, context } = await this.#featureInvocation(
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
    const admittedContext = operationState
      ? await this.#admittedContext(
          provider,
          operationState,
          context,
          call,
          { family: 'native-document', operation: request.operation },
          verificationAuthorityForTarget(target),
          nativeDocumentTransferLimits(request.operation)
        )
      : undefined
    if (!admittedContext) {
      fail(
        'blocked_by_contract',
        `Native-document operation ${request.operation} is unavailable.`
      )
    }
    context = admittedContext

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
      assertNativeDocumentReceiptBinding(receipt, request, context.invocationId,
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
    let { provider, context } = await this.#featureInvocation(
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
    const admittedContext = operationState
      ? await this.#admittedContext(
          provider,
          operationState,
          context,
          call,
          { family: 'extended', operation: input.operation },
          verificationAuthorityForTarget(target),
          extendedOperationTransferLimits(input.operation)
        )
      : undefined
    if (!admittedContext) {
      fail(
        'blocked_by_contract',
        `Extended Content Space operation ${input.operation} is unavailable.`
      )
    }
    context = admittedContext
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
    let operationAvailable = false
    for (const state of operationStates) {
      if (await this.#admittedContext(
        provider,
        state,
        context,
        call,
        { family: 'administration', operation: state.operation },
        providerVerificationAuthority(parsedProvider),
        NO_VERIFICATION_TRANSFERS
      )) {
        operationAvailable = true
        break
      }
    }
    if (!operationAvailable) {
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
    let { provider, context } = await this.#featureInvocation(
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
    const admittedContext = operationState
      ? await this.#admittedContext(
          provider,
          operationState,
          context,
          call,
          { family: 'administration', operation: input.operation },
          verificationAuthorityForTarget(target),
          NO_VERIFICATION_TRANSFERS
        )
      : undefined
    if (!admittedContext) {
      fail(
        'blocked_by_contract',
        `Content Space administration operation ${input.operation} is unavailable.`
      )
    }
    context = admittedContext
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
    try {
      administration = defineContentSpaceProviderAdministrationBinding(bound).administration
    } catch {
      fail('provider_unavailable', 'Provider administration binding is invalid.')
    }
    const dispatch = () => boundedProviderCall(
      () => dispatchAdministrationOperation(
        input.operation,
        request,
        administration
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
    assertAdministrationOutputBinding(
      input.operation,
      request,
      output,
      providerInstanceRef,
      effect
    )
    return output
  }

  async listContainers(
    input: Readonly<{ providerInstanceRef: string; page: unknown }>,
    call: ContentSpaceServiceCallContext
  ) {
    const page = parseInput(contentSpacePageRequestSchema, input.page)
    let { provider, context } = await this.#authorizedProvider(
      input.providerInstanceRef,
      'list-containers',
      call,
      providerVerificationAuthority(input.providerInstanceRef)
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
    let { provider, context } = await this.#authorizedProvider(
      parent.providerInstanceRef,
      'list-entries',
      call,
      callVerificationAuthority(call, parent)
    )
    context = await this.#assertResourceReady(
      provider,
      context,
      parent,
      'list-entries',
      call,
      callVerificationAuthority(call, parent)
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
      call,
      callVerificationAuthority(call, reference)
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
      call,
      capabilities
    )
  }

  async createFolder(
    input: Readonly<{ parent: ContentContainerReference; name: string }>,
    call: ContentSpaceServiceWriteCallContext
  ) {
    const parent = parseInput(contentContainerReferenceSchema, input.parent)
    const name = parseInput(contentSpaceEntryNameSchema, input.name)
    let { provider, context } = await this.#authorizedWriteProvider(
      parent.providerInstanceRef,
      'create-folder',
      call,
      callVerificationAuthority(call, parent)
    )
    context = await this.#assertResourceReady(
      provider,
      context,
      parent,
      'create-folder',
      call,
      callVerificationAuthority(call, parent)
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

  /**
   * Reads one fresh, current-session Provider readiness fact for an exact
   * system-transfer intent. This method deliberately does not issue or retain a
   * Provider authorization, a download lease, a Token, or a transport target.
   * Every later transfer must repeat its full operation-time authorization.
   */
  async preflightSystemTransfer(
    rawInput: ContentSpaceSystemTransferPreflightInput,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<ContentSpaceSystemTransferPreflightProbe> {
    if (call.audience !== 'system') {
      fail('unauthorized', 'System transfer preflight requires the system audience.')
    }
    const root = parseInput(contentContainerReferenceSchema, rawInput.root)
    const operation = rawInput.operation
    const candidate = operation === 'download'
      ? parseInput(contentFileReferenceSchema, rawInput.candidate)
      : undefined
    if (candidate && candidate.providerInstanceRef !== root.providerInstanceRef) {
      fail('invalid_reference', 'System preflight root and candidate authority differ.')
    }

    let principalStale = false
    const probeCall: ContentSpaceServiceWriteCallContext = Object.freeze({
      ...call,
      assertPrincipalCurrent: async () => {
        try {
          await call.assertPrincipalCurrent()
        } catch (error) {
          principalStale = true
          throw error
        }
      }
    })
    let initialBinding: z.infer<typeof contentSpaceExternalBindingAttestationSchema> | undefined
    let finalBinding: z.infer<typeof contentSpaceExternalBindingAttestationSchema> | undefined
    let failureCode: ContentSpaceErrorCode | undefined

    try {
      const authorized = await this.#authorizedWriteProvider(
        root.providerInstanceRef,
        operation,
        probeCall,
        contentVerificationAuthority(root),
        {
          operationBoundObservation: true,
          requireExternalBinding: true,
          productionOnly: true
        }
      )
      let { provider, context } = authorized
      initialBinding = context.expectedExternalBinding
      if (!initialBinding) {
        fail('blocked_by_contract', 'System preflight requires an exact Provider binding.')
      }

      if (operation === 'upload-new') {
        context = (await this.#resourceReadiness(
          provider,
          context,
          root,
          operation,
          probeCall,
          contentVerificationAuthority(root),
          authorized.transferLimits
        )).context
      } else {
        context = await this.#assertSystemRootAuthorized(provider, context, root, probeCall)
        const candidateReadiness = await this.#resourceReadiness(
          provider,
          context,
          candidate!,
          operation,
          probeCall,
          contentVerificationAuthority(root),
          authorized.transferLimits
        )
        context = candidateReadiness.context
        if (candidateReadiness.observation.entry.kind !== 'file') {
          fail('provider_contract_violation', 'System preflight candidate is not a file.')
        }
        context = await this.#proveFileDescendant(
          provider,
          context,
          root,
          candidate!,
          probeCall
        )
      }

      finalBinding = parseOutput(
        contentSpaceExternalBindingAttestationSchema,
        await boundedProviderCall(
          () => provider.attestExternalBinding(context),
          context.signal,
          probeCall.assertPrincipalCurrent
        )
      )
      if (!sameExternalBindingAttestation(initialBinding, finalBinding)) {
        return systemTransferPreflightProbe({
          status: 'binding_stale',
          providerInstanceRef: root.providerInstanceRef,
          operation,
          initialBinding,
          finalBinding
        })
      }
      await assertCurrentPrincipal(
        probeCall.assertPrincipalCurrent,
        false,
        context.signal
      )
      return systemTransferPreflightProbe({
        status: 'ready',
        providerInstanceRef: root.providerInstanceRef,
        operation,
        initialBinding,
        finalBinding
      })
    } catch (error) {
      failureCode = error instanceof ContentSpaceOperationError
        ? error.detail.code
        : 'provider_unavailable'
      const bindingStale = initialBinding !== undefined && (
        failureCode === 'unauthorized' || failureCode === 'invalid_reference'
      )
      return systemTransferPreflightProbe({
        status: principalStale
          ? 'principal_stale'
          : bindingStale
            ? 'binding_stale'
            : 'provider_not_ready',
        providerInstanceRef: root.providerInstanceRef,
        operation,
        ...(initialBinding ? { initialBinding } : {}),
        ...(finalBinding ? { finalBinding } : {}),
        failureCode
      })
    }
  }

  async uploadNewFile(
    input: ContentSpaceUploadFileInput & Readonly<{ includeTransferEvidence: true }>,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<ContentSpaceUploadTransferEvidence>
  async uploadNewFile(
    input: ContentSpaceUploadFileInput,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<UploadNewReceipt>
  async uploadNewFile(
    input: ContentSpaceUploadFileInput,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<UploadNewReceipt | ContentSpaceUploadTransferEvidence> {
    const parent = parseInput(contentContainerReferenceSchema, input.parent)
    const name = parseInput(contentSpaceEntryNameSchema, input.name)
    let { provider, context, transferLimits } = await this.#authorizedWriteProvider(
      parent.providerInstanceRef,
      'upload-new',
      call,
      callVerificationAuthority(call, parent),
      call.audience === 'system'
        ? {
            operationBoundObservation: true,
            requireExternalBinding: true,
            productionOnly: true
          }
        : undefined
    )
    context = await this.#assertResourceReady(
      provider,
      context,
      parent,
      'upload-new',
      call,
      callVerificationAuthority(call, parent),
      transferLimits
    )
    let source: ContentSpaceUploadSource & Readonly<{ close(): Promise<void> }>
    try {
      source = await boundedProviderCall(
        () => input.openSource(context.signal, transferLimits.maxUploadBytes),
        context.signal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      throw transferError(error, 'source_unavailable')
    }
    if (!Number.isSafeInteger(source.size) || source.size < 0 ||
      source.size > transferLimits.maxUploadBytes ||
      typeof source.read !== 'function' || typeof source.close !== 'function') {
      abortBoundedOperationSignal(context.signal, new DOMException(
        'The Host upload source is invalid.',
        'AbortError'
      ))
      if (typeof source.close === 'function') void source.close().catch(() => undefined)
      fail('bounds_exceeded', 'Upload source is invalid or exceeds Content Space bounds.')
    }
    const sourceSha256 = contentSpaceSha256Schema.safeParse(source.sha256)
    if (input.includeTransferEvidence && !sourceSha256.success) {
      abortBoundedOperationSignal(context.signal, new DOMException(
        'The Host upload source digest is unavailable.',
        'AbortError'
      ))
      void source.close().catch(() => undefined)
      fail('source_unavailable', 'Host upload snapshot attestation is unavailable.')
    }
    let dispatched = false
    let receipt: z.infer<typeof uploadNewReceiptSchema> | undefined
    let writeAfterObservation: ContentSpaceUploadWriteAfterObservation | undefined
    let operationFailure: unknown
    try {
      dispatched = true
      const providerReceipt = parseWriteOutput(
        contentSpaceProviderUploadNewReceiptSchema,
        await writeDispatch(() => boundedProviderCall(
        () => provider.uploadNewFile({
          context,
          parent,
          name,
          source: Object.freeze({
            name: source.name,
            size: source.size,
            ...(sourceSha256.success ? { sha256: sourceSha256.data } : {}),
            read: (range) => source.read(range)
          })
        }),
        context.signal,
        call.assertPrincipalCurrent,
        true
      )))
      receipt = parseWriteOutput(uploadNewReceiptSchema, {
        invocationId: providerReceipt.invocationId,
        parent: providerReceipt.parent,
        name: providerReceipt.name,
        sourceSize: providerReceipt.sourceSize,
        reference: providerReceipt.reference
      })
      writeAfterObservation = providerReceipt.writeAfterObservation
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
    if (!receipt || !writeAfterObservation) {
      fail('outcome_unknown', 'The upload outcome cannot be proven.')
    }
    if (!input.includeTransferEvidence) return receipt
    if (!sourceSha256.success) {
      fail('source_unavailable', 'Host upload snapshot attestation is unavailable.')
    }
    return Object.freeze({
      receipt,
      writeAfterObservation,
      bytes: source.size,
      sha256: sourceSha256.data
    })
  }

  async downloadFile(
    input: ContentSpaceDownloadFileInput & Readonly<{
      proofRoot: ContentContainerReference
      includeTransferEvidence: true
    }>,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<ContentSpaceDownloadTransferEvidence>
  async downloadFile(
    input: ContentSpaceDownloadFileInput,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<DownloadReceipt>
  async downloadFile(
    input: ContentSpaceDownloadFileInput,
    call: ContentSpaceServiceWriteCallContext
  ): Promise<DownloadReceipt | ContentSpaceDownloadTransferEvidence> {
    const reference = parseInput(zDownloadReference, input.reference)
    const proofRoot = input.proofRoot
      ? parseInput(contentContainerReferenceSchema, input.proofRoot)
      : undefined
    if (proofRoot && (
      'immutableVersionId' in reference ||
      reference.providerInstanceRef !== proofRoot.providerInstanceRef ||
      call.audience !== 'system' ||
      input.includeTransferEvidence !== true
    )) {
      fail('invalid_reference', 'System download requires one exact live file under its root.')
    }
    const authority = proofRoot
      ? contentVerificationAuthority(proofRoot)
      : callVerificationAuthority(call, reference)
    let { provider, context, transferLimits } = await this.#authorizedWriteProvider(
      reference.providerInstanceRef,
      'download',
      call,
      authority,
      proofRoot
        ? {
            operationBoundObservation: true,
            requireExternalBinding: true,
            productionOnly: true
          }
        : undefined
    )
    if ('immutableVersionId' in reference) {
      await this.#assertArtifactStillProven(
        provider,
        context,
        reference,
        call.assertPrincipalCurrent
      )
    }
    if (proofRoot) {
      context = await this.#assertSystemRootAuthorized(
        provider,
        context,
        proofRoot,
        call
      )
    }
    const readiness = await this.#resourceReadiness(
      provider,
      context,
      reference,
      'download',
      call,
      authority,
      transferLimits
    )
    context = readiness.context
    if (readiness.observation.entry.kind !== 'file') {
      fail('provider_unavailable', 'Provider download observation is not a file.')
    }
    // An Artifact observation describes the current file entry, so its size is not
    // a valid oracle for a historical version. Artifact downloads retain their
    // immutable-version proof and optional digest checks below.
    const expectedByteLength = 'immutableVersionId' in reference
      ? undefined
      : readiness.observation.entry.size
    if (expectedByteLength !== undefined &&
      expectedByteLength > transferLimits.maxDownloadBytes) {
      fail('bounds_exceeded', 'Provider download exceeds the admitted profile byte limit.')
    }
    if (proofRoot) {
      // Complete paired authorization before touching the Workspace. Opening
      // the Host destination then reasserts the Principal on both sides of
      // that await, and the immediately following Provider dispatch rechecks
      // the same expected binding in the Provider adapter/current session.
      context = await this.#proveFileDescendant(
        provider,
        context,
        proofRoot,
        reference as ContentFileReference,
        call
      )
    }
    let downloadLease: Awaited<ReturnType<ContentSpaceProvider['authorizeDownload']>>
    try {
      downloadLease = await boundedProviderCall(
        () => provider.authorizeDownload({ context, reference }),
        context.signal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      if (error instanceof ContentSpaceOperationError) throw error
      throw transferError(error, 'provider_unavailable')
    }
    if (!isProviderDownloadLease(downloadLease)) {
      fail('provider_contract_violation', 'Provider download authorization is invalid.')
    }
    // DownloadCheck (or the equivalent Provider read authorization) is now
    // complete. Revalidate the exact Principal/execution lease before the Host
    // may create any private destination file.
    try {
      await assertCurrentPrincipal(call.assertPrincipalCurrent, false, context.signal)
    } catch (error) {
      await downloadLease.retire().catch(() => undefined)
      throw error
    }
    let destination: Awaited<ReturnType<typeof input.openDestination>>
    try {
      destination = await boundedProviderCall(
        () => input.openDestination(context.signal, transferLimits.maxDownloadBytes),
        context.signal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      await downloadLease.retire().catch(() => undefined)
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
          if (byteLength + ownedChunk.byteLength > transferLimits.maxDownloadBytes) {
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
        () => downloadLease.consume({ destination: providerDestination }),
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
        (expectedByteLength !== undefined && byteLength !== expectedByteLength) ||
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
      const canonicalReceipt = parseOutput(downloadReceiptSchema, {
        ...receipt,
        digest: Object.freeze({ algorithm: 'sha256' as const, value: actualDigest })
      })
      if (!input.includeTransferEvidence) return canonicalReceipt
      return Object.freeze({
        receipt: canonicalReceipt,
        bytes: byteLength,
        sha256: actualDigest
      })
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
    } finally {
      await downloadLease.retire().catch(() => undefined)
    }
  }

  async resolvePortalTarget(
    rawReference: ContentEntryReference,
    call: ContentSpaceServiceCallContext
  ) {
    const reference = parseInput(zContentEntryReference, rawReference)
    let { provider, context } = await this.#authorizedProvider(
      reference.providerInstanceRef,
      'portal-target',
      call,
      callVerificationAuthority(call, reference)
    )
    if ('immutableVersionId' in reference) {
      await this.#assertArtifactStillProven(
        provider,
        context,
        reference,
        call.assertPrincipalCurrent
      )
    }
    context = await this.#assertResourceReady(
      provider,
      context,
      reference,
      'portal-target',
      call,
      callVerificationAuthority(call, reference)
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
    let { provider, context } = await this.#authorizedProvider(
      reference.providerInstanceRef,
      'observe-immutable-version',
      call,
      callVerificationAuthority(call, reference)
    )
    context = await this.#assertResourceReady(
      provider,
      context,
      reference,
      'observe-immutable-version',
      call,
      callVerificationAuthority(call, reference)
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
    const capabilities = await this.#providerCapabilities(
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
      Object.freeze({
        reauthorizedPrincipal: context.principal,
        assertPrincipalCurrent
      }),
      contentVerificationAuthority(file)
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
    call: ContentSpaceServiceCallContext,
    globalCapabilities?: readonly z.infer<
      typeof contentSpaceAdmittedCapabilityStateListSchema
    >[number][]
  ) {
    const output = parseOutput(contentSpaceProviderEntryObservationSchema, await boundedProviderCall(
      () => provider.observeEntry({ context, reference }),
      context.signal,
      call.assertPrincipalCurrent
    ))
    assertObservationBinding(reference, output.entry.reference)
    const resourceCapabilities = await this.#admittedCapabilities(
      provider,
      output.capabilities,
      context,
      call,
      callVerificationAuthority(call, reference),
      false
    )
    return contentSpaceEntryObservationSchema.parse({
      ...output,
      capabilities: globalCapabilities
        ? resourceCapabilities.map((state) => {
            const globalState = globalCapabilities.find((candidate) =>
              candidate.operation === state.operation
            )
            return globalState?.admission.status === 'admitted'
              ? state
              : Object.freeze({
                  ...state,
                  admission: globalState?.admission ?? Object.freeze({
                    status: 'blocked' as const,
                    reasonCode: 'resource_capability_missing' as const
                  })
                })
          })
        : resourceCapabilities
    })
  }

  async #assertSystemRootAuthorized(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderWriteContext,
    root: ContentContainerReference,
    call: ContentSpaceServiceCallContext
  ): Promise<ContentSpaceProviderWriteContext> {
    if (!context.expectedExternalBinding) {
      fail('blocked_by_contract', 'System transfer requires an exact Provider binding.')
    }
    const observation = parseOutput(
      contentSpaceProviderEntryObservationSchema,
      await boundedProviderCall(
        () => provider.observeEntry({ context, reference: root }),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    assertObservationBinding(root, observation.entry.reference)
    if (observation.entry.kind !== 'container') {
      fail('provider_contract_violation', 'System transfer root is not a container.')
    }
    return context
  }

  async #proveFileDescendant(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderWriteContext,
    root: ContentContainerReference,
    candidate: ContentFileReference,
    call: ContentSpaceServiceCallContext
  ): Promise<ContentSpaceProviderWriteContext> {
    const expectedBinding = context.expectedExternalBinding
    if (!expectedBinding) {
      fail('blocked_by_contract', 'System download requires an exact Provider binding.')
    }
    const request = parseInput(contentSpaceFileDescendantProofRequestSchema, {
      root,
      candidate,
      limits: CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS
    })
    const proofStartedWallMs = this.#now().getTime()
    const startedAt = this.#monotonicNow()
    const remainingOperationMs = Date.parse(context.deadlineAt) - proofStartedWallMs
    if (!Number.isFinite(remainingOperationMs) || remainingOperationMs <= 0) {
      fail('bounds_exceeded', 'Descendant proof has no remaining invocation lease.')
    }
    const proofDurationMs = Math.min(
      CONTENT_SPACE_FILE_DESCENDANT_PROOF_LIMITS.deadlineMs,
      remainingOperationMs
    )
    const proofSignal = createBoundedOperationSignal(
      context.signal,
      proofDurationMs
    )
    const proofDeadlineAt = new Date(Math.min(
      Date.parse(context.deadlineAt),
      proofStartedWallMs + proofDurationMs
    )).toISOString()
    const proofContext: ContentSpaceProviderWriteContext = Object.freeze({
      ...context,
      deadlineAt: proofDeadlineAt,
      signal: proofSignal
    })
    let rawEvidence: unknown
    try {
      rawEvidence = await boundedProviderCall(
        () => provider.proveFileDescendant({
          context: proofContext,
          root: request.root,
          candidate: request.candidate,
          limits: request.limits
        }),
        proofSignal,
        call.assertPrincipalCurrent
      )
    } catch (error) {
      if (!context.signal.aborted && proofSignal.aborted) {
        fail('bounds_exceeded', 'Descendant proof exceeded its monotonic deadline.')
      }
      throw error
    }
    const proofCompletedWallMs = this.#now().getTime()
    const actualElapsedMs = this.#monotonicNow() - startedAt
    if (!Number.isFinite(actualElapsedMs) || actualElapsedMs < 0 ||
      actualElapsedMs > proofDurationMs) {
      fail('bounds_exceeded', 'Descendant proof exceeded its monotonic deadline.')
    }
    const parsedEvidence = contentSpaceFileDescendantProofEvidenceSchema.safeParse(rawEvidence)
    if (!parsedEvidence.success) {
      fail('provider_contract_violation', 'Provider descendant proof evidence is invalid.')
    }
    const evidence = parsedEvidence.data
    const provedAtMs = Date.parse(evidence.provedAt)
    if (evidence.invocationId !== context.invocationId ||
      evidence.providerInstanceRef !== context.providerInstanceRef ||
      evidence.authority !== context.providerInstanceRef ||
      !sameContainer(evidence.root, root) ||
      !sameFile(evidence.candidate, candidate) ||
      !sameExternalBindingAttestation(evidence.binding, expectedBinding) ||
      !Number.isFinite(proofStartedWallMs) ||
      !Number.isFinite(proofCompletedWallMs) ||
      provedAtMs < proofStartedWallMs ||
      provedAtMs > proofCompletedWallMs ||
      provedAtMs > Date.parse(context.deadlineAt) ||
      evidence.counts.elapsedMs > actualElapsedMs + 1) {
      fail('provider_contract_violation', 'Provider descendant proof changed invocation authority.')
    }
    await assertCurrentPrincipal(call.assertPrincipalCurrent, false, context.signal)
    return context
  }

  async #assertResourceReady<Context extends ContentSpaceProviderOperationContext>(
    provider: ContentSpaceProvider,
    context: Context,
    reference: ContentEntryReference,
    operation: ContentSpaceOperation,
    call: ContentSpaceServiceCallContext,
    authority: ContentSpaceVerificationAuthority,
    preauthorizedTransferLimits?: ContentSpaceVerificationTransferLimits
  ): Promise<Context> {
    return (await this.#resourceReadiness(
      provider,
      context,
      reference,
      operation,
      call,
      authority,
      preauthorizedTransferLimits
    )).context
  }

  async #resourceReadiness<Context extends ContentSpaceProviderOperationContext>(
    provider: ContentSpaceProvider,
    context: Context,
    reference: ContentEntryReference,
    operation: ContentSpaceOperation,
    call: ContentSpaceServiceCallContext,
    authority: ContentSpaceVerificationAuthority,
    preauthorizedTransferLimits?: ContentSpaceVerificationTransferLimits
  ) {
    const observation = parseOutput(
      contentSpaceProviderEntryObservationSchema,
      await boundedProviderCall(
        () => provider.observeEntry({ context, reference }),
        context.signal,
        call.assertPrincipalCurrent
      )
    )
    assertObservationBinding(reference, observation.entry.reference)
    const state = observation.capabilities.find((candidate) =>
      candidate.operation === operation
    )
    const admittedContext = state && preauthorizedTransferLimits
      ? (call.audience === 'system'
          ? operationReady(state)
          : transferResourceStateAdmitted(state))
        ? context
        : undefined
      : state
        ? await this.#admittedContext(
            provider,
            state,
            context,
            call,
            { family: 'ordinary', operation },
            authority,
            ordinaryOperationTransferLimits(operation)
          )
        : undefined
    if (!admittedContext) {
      fail('blocked_by_contract', `Content Space resource operation ${operation} is unavailable.`)
    }
    return Object.freeze({ context: admittedContext, observation })
  }

  async #authorizedProvider(
    providerInstanceRef: string,
    operation: ContentSpaceOperation,
    call: ContentSpaceServiceCallContext,
    authority: ContentSpaceVerificationAuthority,
    options?: Readonly<{
      operationBoundObservation?: boolean
      requireExternalBinding?: boolean
      productionOnly?: boolean
    }>
  ): Promise<Readonly<{
    provider: ContentSpaceProvider
    context: ContentSpaceProviderOperationContext
    transferLimits: ContentSpaceVerificationTransferLimits
    capabilities: readonly z.infer<
      typeof contentSpaceAdmittedCapabilityStateListSchema
    >[number][]
  }>> {
    let context = this.#operationContext(providerInstanceRef, call)
    const provider = await this.#providerForCall(
      providerInstanceRef,
      context,
      call.assertPrincipalCurrent
    )
    const providerCapabilities = await this.#providerCapabilities(
      provider,
      context,
      call.assertPrincipalCurrent
    )
    assertNotCancelled(context.signal)
    if ((!this.#platform.fileTransfers &&
        (operation === 'upload-new' || operation === 'download')) ||
      (!this.#platform.externalNavigation && operation === 'portal-target')) {
      fail('blocked_by_contract', `Content Space operation ${operation} is Host-gated.`)
    }
    const state = providerCapabilities.find((candidate) => candidate.operation === operation)
    const requestedTransferLimits = ordinaryOperationTransferLimits(operation)
    const admitted = state
      ? options?.productionOnly
        ? operationReady(state)
          ? Object.freeze({
              context,
              transferLimits: requestedTransferLimits
            })
          : undefined
        : operation === 'upload-new' || operation === 'download'
        ? await this.#admittedTransferContext(
            provider,
            state,
            context,
            call,
            operation,
            authority,
            requestedTransferLimits
          )
        : await this.#admittedContext(
            provider,
            state,
            context,
            call,
            { family: 'ordinary', operation },
            authority,
            requestedTransferLimits
          ).then((admittedContext) => admittedContext
            ? Object.freeze({
                context: admittedContext,
                transferLimits: requestedTransferLimits
              })
            : undefined)
      : undefined
    if (!admitted) {
      fail('blocked_by_contract', `Content Space operation ${operation} is unavailable.`)
    }
    context = admitted.context
    if (options?.requireExternalBinding && !context.expectedExternalBinding) {
      const rawAttestation = await boundedProviderCall(
        () => provider.attestExternalBinding(context),
        context.signal,
        call.assertPrincipalCurrent
      )
      const externalBinding = parseOutput(
        contentSpaceExternalBindingAttestationSchema,
        rawAttestation
      )
      if (externalBinding.providerInstanceRef !== context.providerInstanceRef ||
        !samePrincipalSnapshot(externalBinding.principal, context.principal)) {
        fail('unauthorized', 'The current Provider binding changed during authorization.')
      }
      context = Object.freeze({ ...context, expectedExternalBinding: externalBinding })
    }
    if (operationRequiresObservation(operation)) {
      const observationState = providerCapabilities.find((candidate) =>
        candidate.operation === 'observe-entry'
      )
      const observationContext = options?.operationBoundObservation
        ? observationState && (
            options.productionOnly
              ? operationReady(observationState)
              : transferResourceStateAdmitted(observationState)
          )
          ? context
          : undefined
        : observationState
          ? await this.#admittedContext(
              provider,
              observationState,
              context,
              call,
              { family: 'ordinary', operation: 'observe-entry' },
              authority,
              NO_VERIFICATION_TRANSFERS
            )
          : undefined
      if (!observationContext) {
        fail('blocked_by_contract', 'Content Space observation is unavailable.')
      }
      context = observationContext
    }
    return Object.freeze({
      provider,
      context,
      transferLimits: admitted.transferLimits,
      capabilities: await this.#admittedCapabilities(
        provider,
        providerCapabilities,
        context,
        call,
        authority,
        true
      )
    })
  }

  async #authorizedWriteProvider(
    providerInstanceRef: string,
    operation: ContentSpaceOperation,
    call: ContentSpaceServiceWriteCallContext,
    authority: ContentSpaceVerificationAuthority,
    options?: Readonly<{
      operationBoundObservation?: boolean
      requireExternalBinding?: boolean
      productionOnly?: boolean
    }>
  ): Promise<Readonly<{
    provider: ContentSpaceProvider
    context: ContentSpaceProviderWriteContext
    transferLimits: ContentSpaceVerificationTransferLimits
  }>> {
    const invocationId = parseInput(contentSpaceInvocationIdSchema, call.invocationId)
    if (!(call.signal instanceof AbortSignal)) {
      fail('invalid_input', 'A cancellable write signal is required.')
    }
    assertNotCancelled(call.signal)
    const result = await this.#authorizedProvider(providerInstanceRef, operation, {
      ...call
    }, authority, options)
    if (!result.context.signal) {
      fail('cancelled', 'The bounded Provider operation signal is unavailable.')
    }
    return Object.freeze({
      provider: result.provider,
      context: Object.freeze({
        ...result.context,
        invocationId,
        signal: result.context.signal
      }),
      transferLimits: result.transferLimits
    })
  }

  async #admittedTransferContext<Context extends ContentSpaceProviderOperationContext>(
    provider: ContentSpaceProvider,
    state: Readonly<{
      readiness: 'poc_only' | 'blocked_by_contract' | 'production_ready'
      reasonCode: ContentSpaceReadinessReason
    }>,
    context: Context,
    call: ContentSpaceServiceCallContext,
    operation: 'upload-new' | 'download',
    authority: ContentSpaceVerificationAuthority,
    productionLimits: ContentSpaceVerificationTransferLimits
  ): Promise<Readonly<{
    context: Context
    transferLimits: ContentSpaceVerificationTransferLimits
  }> | undefined> {
    if (operationReady(state)) {
      return Object.freeze({ context, transferLimits: productionLimits })
    }
    if (state.readiness === 'blocked_by_contract' ||
      (state.readiness === 'poc_only' &&
        state.reasonCode !== 'verification_profile_required')) return undefined

    const profileState = Object.freeze({
      readiness: 'poc_only' as const,
      reasonCode: 'verification_profile_required' as const
    })
    const facts = {
      state: profileState,
      providerInstanceRef: context.providerInstanceRef,
      principal: context.principal,
      audience: call.audience,
      authority,
      operation: { family: 'ordinary' as const, operation },
      ...(context.expectedExternalBinding
        ? { externalBinding: context.expectedExternalBinding }
        : {}),
      now: this.#now()
    }
    let match = contentSpaceVerificationPolicyMatch(this.#verificationPolicy, facts)
    if (match) {
      return Object.freeze({
        context,
        transferLimits: validatedProfileTransferLimits(operation, match.transferLimits)
      })
    }
    if (context.expectedExternalBinding ||
      !contentSpaceVerificationPolicyHasExternalBindingCandidate(
        this.#verificationPolicy,
        facts
      )) return undefined

    const rawAttestation = await boundedProviderCall(
      () => provider.attestExternalBinding(context),
      context.signal,
      call.assertPrincipalCurrent
    )
    if (rawAttestation === undefined) return undefined
    const externalBinding = parseOutput(
      contentSpaceExternalBindingAttestationSchema,
      rawAttestation
    )
    const boundContext = Object.freeze({
      ...context,
      expectedExternalBinding: externalBinding
    }) as Context
    match = contentSpaceVerificationPolicyMatch(this.#verificationPolicy, {
      ...facts,
      externalBinding
    })
    if (!match) return undefined
    return Object.freeze({
      context: boundContext,
      transferLimits: validatedProfileTransferLimits(operation, match.transferLimits)
    })
  }

  async #describe(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderOperationContext,
    call: ContentSpaceServiceCallContext
  ) {
    return this.#admittedCapabilities(
      provider,
      await this.#providerCapabilities(provider, context, call.assertPrincipalCurrent),
      context,
      call,
      providerVerificationAuthority(context.providerInstanceRef),
      true
    )
  }

  async #providerCapabilities(
    provider: ContentSpaceProvider,
    context: ContentSpaceProviderOperationContext,
    assertPrincipalCurrent: ContentSpaceServiceCallContext['assertPrincipalCurrent']
  ) {
    return parseOutput(
      contentSpaceCapabilityStateListSchema,
      await boundedProviderCall(
        () => provider.describeCapabilities(context),
        context.signal,
        assertPrincipalCurrent
      )
    )
  }

  async #admittedContext<Context extends ContentSpaceProviderOperationContext>(
    provider: ContentSpaceProvider,
    state: Readonly<{
      readiness: 'poc_only' | 'blocked_by_contract' | 'production_ready'
      reasonCode: ContentSpaceReadinessReason
    }>,
    context: Context,
    call: ContentSpaceServiceCallContext,
    operation: ContentSpaceVerificationOperation,
    authority: ContentSpaceVerificationAuthority,
    transferLimits: ContentSpaceVerificationTransferLimits
  ): Promise<Context | undefined> {
    if (operationReady(state)) return context
    if (state.readiness !== 'poc_only' ||
      state.reasonCode !== 'verification_profile_required') return undefined
    const admission = {
      state,
      providerInstanceRef: context.providerInstanceRef,
      principal: context.principal,
      audience: call.audience,
      authority,
      operation,
      transferLimits,
      ...(context.expectedExternalBinding
        ? { externalBinding: context.expectedExternalBinding }
        : {}),
      now: this.#now()
    }
    if (contentSpaceVerificationPolicyAdmits(this.#verificationPolicy, admission)) {
      return context
    }
    if (context.expectedExternalBinding ||
      !contentSpaceVerificationPolicyRequiresExternalBinding(
        this.#verificationPolicy,
        admission
      )) return undefined

    const rawAttestation = await boundedProviderCall(
      () => provider.attestExternalBinding(context),
      context.signal,
      call.assertPrincipalCurrent
    )
    if (rawAttestation === undefined) return undefined
    const externalBinding = parseOutput(
      contentSpaceExternalBindingAttestationSchema,
      rawAttestation
    )
    const boundContext = Object.freeze({
      ...context,
      expectedExternalBinding: externalBinding
    }) as Context
    return contentSpaceVerificationPolicyAdmits(this.#verificationPolicy, {
      ...admission,
      externalBinding
    })
      ? boundContext
      : undefined
  }

  async #admittedCapabilities(
    provider: ContentSpaceProvider,
    states: readonly z.infer<typeof contentSpaceCapabilityStateListSchema>[number][],
    context: ContentSpaceProviderOperationContext,
    call: ContentSpaceServiceCallContext,
    authority: ContentSpaceVerificationAuthority,
    requireObservationGate: boolean
  ) {
    const admittedStates: Array<
      z.input<typeof contentSpaceAdmittedCapabilityStateListSchema>[number]
    > = []
    let boundContext = context
    let observationAdmission: z.input<
      typeof contentSpaceAdmittedCapabilityStateListSchema
    >[number]['admission'] | undefined
    const observationState = states.find((state) => state.operation === 'observe-entry')
    if (observationState) {
      const result = await this.#ordinaryAdmission(
        provider,
        observationState,
        boundContext,
        call,
        authority
      )
      boundContext = result.context
      observationAdmission = result.admission
    }
    for (const state of states) {
      const result = state === observationState && observationAdmission
        ? { context: boundContext, admission: observationAdmission }
        : await this.#ordinaryAdmission(provider, state, boundContext, call, authority)
      boundContext = result.context
      const providerAdmission = result.admission
      const platformBlocked = state.readiness !== 'blocked_by_contract' && (
        (!this.#platform.fileTransfers &&
          (state.operation === 'upload-new' || state.operation === 'download')) ||
        (!this.#platform.externalNavigation && state.operation === 'portal-target')
      )
      const observationBlocked = requireObservationGate &&
        providerAdmission.status === 'admitted' &&
        operationRequiresObservation(state.operation) &&
        observationAdmission?.status !== 'admitted'
      admittedStates.push(Object.freeze({
        ...state,
        admission: platformBlocked
          ? Object.freeze({
              status: 'blocked' as const,
              reasonCode: 'platform_gate_blocked' as const
            })
          : observationBlocked
            ? Object.freeze({
                status: 'blocked' as const,
                reasonCode: 'resource_capability_missing' as const
              })
            : providerAdmission
      }))
    }
    return contentSpaceAdmittedCapabilityStateListSchema.parse(admittedStates)
  }

  async #ordinaryAdmission(
    provider: ContentSpaceProvider,
    state: z.infer<typeof contentSpaceCapabilityStateListSchema>[number],
    context: ContentSpaceProviderOperationContext,
    call: ContentSpaceServiceCallContext,
    authority: ContentSpaceVerificationAuthority
  ): Promise<Readonly<{
    context: ContentSpaceProviderOperationContext
    admission: z.input<typeof contentSpaceAdmittedCapabilityStateListSchema>[number]['admission']
  }>> {
    const admittedContext = await this.#admittedContext(
      provider,
      state,
      context,
      call,
      { family: 'ordinary', operation: state.operation },
      authority,
      ordinaryOperationTransferLimits(state.operation)
    )
    if (admittedContext && state.readiness === 'production_ready') {
      return Object.freeze({
        context: admittedContext,
        admission: Object.freeze({
        status: 'admitted' as const,
        reasonCode: 'production_ready' as const
        })
      })
    }
    if (state.readiness === 'blocked_by_contract') {
      return Object.freeze({
        context,
        admission: Object.freeze({
          status: 'blocked' as const,
          reasonCode: state.reasonCode === 'available'
            ? 'provider_contract_missing' as const
            : state.reasonCode
        })
      })
    }
    if (admittedContext) {
      return Object.freeze({
        context: admittedContext,
        admission: Object.freeze({
          status: 'admitted' as const,
          reasonCode: 'verification_profile_admitted' as const
        })
      })
    }
    return Object.freeze({
      context,
      admission: Object.freeze({
        status: 'blocked' as const,
        reasonCode: call.audience
          ? state.reasonCode === 'available'
            ? 'provider_contract_missing' as const
            : state.reasonCode
          : 'audience_policy_blocked' as const
      })
    })
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

function transferResourceStateAdmitted(state: Readonly<{
  readiness: 'poc_only' | 'blocked_by_contract' | 'production_ready'
  reasonCode: ContentSpaceReadinessReason
}>): boolean {
  return state.readiness === 'production_ready' ||
    (state.readiness === 'poc_only' &&
      state.reasonCode === 'verification_profile_required')
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
  request: NativeDocumentRequest | AgentNativeDocumentRequest,
  invocationId: string,
  providerInstanceRef: string,
  effect: ContentSpaceProviderFeatureEffect
): void {
  const resultDocument = receipt.outcome === 'succeeded' &&
    'document' in receipt.result
    ? receipt.result.document.reference
    : undefined
  const requestedDocument = 'document' in request
    ? request.document.reference
    : undefined
  if (receipt.operation !== request.operation || receipt.invocationId !== invocationId ||
    (resultDocument !== undefined && resultDocument.providerInstanceRef !== providerInstanceRef) ||
    (requestedDocument !== undefined && resultDocument !== undefined &&
      !sameContentEntryReference(requestedDocument, resultDocument))) {
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
    'remove-member': contentSpaceAdministrationRemoveMemberInputSchema
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
    'add-member': contentSpaceAdministrationAddMemberReceiptSchema,
    'remove-member': contentSpaceAdministrationRemoveMemberReceiptSchema
  } as const
  return write ? parseWriteOutput(schemas[operation], value) : parseOutput(schemas[operation], value)
}

async function dispatchAdministrationOperation(
  operation: ContentSpaceAdministrationOperation,
  request: any,
  administration: ReturnType<typeof defineContentSpaceAdministrationPort>
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
  }
}

function assertAdministrationTarget(
  operation: ContentSpaceAdministrationOperation,
  request: any,
  target: ContentSpaceProviderFeatureTarget
): void {
  if (operation === 'list-spaces' || operation === 'create-space') {
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
  if ((operation === 'add-member' || operation === 'remove-member') &&
    request.member.providerInstanceRef !== requestRoot.providerInstanceRef) {
    fail('invalid_target', 'The administration member does not match the root Provider Instance.')
  }
}

function assertAdministrationOutputBinding(
  operation: ContentSpaceAdministrationOperation,
  request: any,
  output: any,
  providerInstanceRef: string,
  effect: ContentSpaceProviderFeatureEffect
): void {
  try {
    const parseRoot = (value: unknown): ContentContainerReference => {
      const root = parsePortableContentContainerReference(value)
      if (root.providerInstanceRef !== providerInstanceRef) throw new Error('Provider drift')
      return root
    }
    const parseMember = (value: unknown) => {
      const member = contentSpaceAdministrationMemberReferenceSchema.parse(value)
      if (member.providerInstanceRef !== providerInstanceRef) throw new Error('Provider drift')
      return member
    }
    const assertExactRoot = (actual: unknown, expected: unknown): void => {
      if (!sameContainer(parseRoot(actual), parseRoot(expected))) throw new Error('Root drift')
    }
    const assertExactMember = (actual: unknown, expected: unknown): void => {
      const returnedMember = parseMember(actual)
      const requestedMember = parseMember(expected)
      if (returnedMember.kind !== requestedMember.kind ||
        returnedMember.principalId !== requestedMember.principalId) {
        throw new Error('Member drift')
      }
    }
    const assertPage = (
      itemCount: number,
      nextCursor: string | undefined,
      page: Readonly<{ limit: number; cursor?: string }>
    ): void => {
      if (itemCount > page.limit ||
        (nextCursor !== undefined && nextCursor === page.cursor) ||
        (itemCount === 0 && nextCursor !== undefined)) {
        throw new Error('Page drift')
      }
    }

    switch (operation) {
      case 'list-spaces': {
        const roots: ContentContainerReference[] = output.items.map(
          (item: any) => parseRoot(item.root)
        )
        assertPage(output.items.length, output.nextCursor, request.page)
        if (!allUnique(roots.map((root) =>
          `${root.providerInstanceRef}\u0000${root.containerId}`
        ))) throw new Error('Duplicate roots')
        break
      }
      case 'create-space':
        parseRoot(output.root)
        if (output.label !== request.label ||
          output.contentOwnerUserId !== request.contentOwnerUserId) {
          throw new Error('Created space drift')
        }
        break
      case 'observe-space':
        assertExactRoot(output.root, request.root)
        break
      case 'update-space':
        assertExactRoot(output.root, request.root)
        if (output.label !== request.label) throw new Error('Updated label drift')
        break
      case 'pin-space':
        assertExactRoot(output.root, request.root)
        if (output.pinned !== true) throw new Error('Pinned state drift')
        break
      case 'unpin-space':
        assertExactRoot(output.root, request.root)
        if (output.pinned !== false) throw new Error('Unpinned state drift')
        break
      case 'open-root':
        assertExactRoot(output.root, request.root)
        break
      case 'list-members': {
        assertExactRoot(output.root, request.root)
        const members: Array<ReturnType<typeof parseMember>> = output.items.map(
          (item: any) => parseMember(item.member)
        )
        assertPage(output.items.length, output.nextCursor, request.page)
        if (!allUnique(members.map((member) =>
          `${member.providerInstanceRef}\u0000${member.kind}\u0000${member.principalId}`
        ))) throw new Error('Duplicate members')
        break
      }
      case 'add-member':
        assertExactRoot(output.root, request.root)
        assertExactMember(output.member, request.member)
        break
      case 'remove-member':
        assertExactRoot(output.root, request.root)
        assertExactMember(output.member, request.member)
        break
      default: {
        const exhaustive: never = operation
        throw new Error(`Unsupported administration operation: ${exhaustive}`)
      }
    }
  } catch {
    fail(
      effect === 'read' ? 'provider_unavailable' : 'outcome_unknown',
      'Provider administration output is not bound to the request or authority.',
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
      'cancelled',
      'The Provider operation was cancelled or exceeded its deadline.'
    )
  }
  await assertCurrentPrincipal(assertPrincipalCurrent, false, signal)
  let operationInvoked = false
  const invokeOperation = () => {
    operationInvoked = true
    return operation()
  }
  let result: Value | undefined
  let operationFailed = false
  let operationErrorValue: unknown
  try {
    result = signal
      ? await raceProviderOperation(invokeOperation, signal, outcomeUncertainOnAbort)
      : await invokeOperation()
  } catch (error) {
    operationFailed = true
    operationErrorValue = error
  }
  await assertCurrentPrincipal(
    assertPrincipalCurrent,
    outcomeUncertainOnAbort && operationInvoked,
    signal
  )
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
    let operationInvoked = false
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const complete = (action: () => void) => {
      if (completed) return
      completed = true
      signal.removeEventListener('abort', onAbort)
      if (deadlineTimer) clearTimeout(deadlineTimer)
      action()
    }
    const onAbort = () => complete(() => {
      const outcomeUncertain = outcomeUncertainOnAbort && operationInvoked
      reject(operationError(
        outcomeUncertain ? 'outcome_unknown' : 'cancelled',
        outcomeUncertain
          ? 'The Provider operation outcome cannot be proven.'
          : 'The Provider operation was cancelled or exceeded its deadline.'
      ))
    })
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
      operationInvoked = true
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

function sameExternalBindingAttestation(
  left: z.infer<typeof contentSpaceExternalBindingAttestationSchema>,
  right: z.infer<typeof contentSpaceExternalBindingAttestationSchema>
): boolean {
  return left.providerInstanceRef === right.providerInstanceRef &&
    samePrincipalSnapshot(left.principal, right.principal) &&
    left.externalSubject === right.externalSubject &&
    left.bindingRevision === right.bindingRevision
}

function systemTransferPreflightProbe(input: Readonly<{
  status: ContentSpaceSystemTransferPreflightStatus
  providerInstanceRef: string
  operation: 'download' | 'upload-new'
  initialBinding?: z.infer<typeof contentSpaceExternalBindingAttestationSchema>
  finalBinding?: z.infer<typeof contentSpaceExternalBindingAttestationSchema>
  failureCode?: ContentSpaceErrorCode
}>): ContentSpaceSystemTransferPreflightProbe {
  const parts = [
    'content-space.system-transfer-preflight.provider-observation.v1',
    input.status,
    input.providerInstanceRef,
    input.operation,
    input.initialBinding?.externalSubject ?? '',
    input.initialBinding?.bindingRevision ?? '',
    input.finalBinding?.externalSubject ?? '',
    input.finalBinding?.bindingRevision ?? '',
    input.failureCode ?? ''
  ]
  const digest = createHash('sha256')
  for (const part of parts) {
    digest.update(`${Buffer.byteLength(part, 'utf8')}:`)
    digest.update(part)
  }
  return Object.freeze({
    status: input.status,
    providerObservationRevision: digest.digest('hex')
  })
}

function isProviderDownloadLease(value: unknown): value is Awaited<
  ReturnType<ContentSpaceProvider['authorizeDownload']>
> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'consume,retire' &&
    typeof (value as { consume?: unknown }).consume === 'function' &&
    typeof (value as { retire?: unknown }).retire === 'function'
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

const NO_VERIFICATION_TRANSFERS = Object.freeze({
  maxUploadBytes: 0,
  maxDownloadBytes: 0
})
const UPLOAD_VERIFICATION_LIMITS = Object.freeze({
  maxUploadBytes: CONTENT_SPACE_LIMITS.maxUploadBytes,
  maxDownloadBytes: 0
})
const DOWNLOAD_VERIFICATION_LIMITS = Object.freeze({
  maxUploadBytes: 0,
  maxDownloadBytes: CONTENT_SPACE_LIMITS.maxFileBytes
})

function validatedProfileTransferLimits(
  operation: 'upload-new' | 'download',
  limits: ContentSpaceVerificationTransferLimits
): ContentSpaceVerificationTransferLimits {
  if ((operation === 'upload-new' && (
    limits.maxDownloadBytes !== 0 ||
    limits.maxUploadBytes > CONTENT_SPACE_LIMITS.maxUploadBytes
  )) || (operation === 'download' && (
    limits.maxUploadBytes !== 0 ||
    limits.maxDownloadBytes > CONTENT_SPACE_LIMITS.maxFileBytes
  ))) {
    fail('blocked_by_contract', 'Verification profile transfer limits are incompatible.')
  }
  return Object.freeze({ ...limits })
}

function providerVerificationAuthority(
  providerInstanceRef: string
): ContentSpaceVerificationAuthority {
  return Object.freeze({ kind: 'provider-instance', providerInstanceRef })
}

function contentVerificationAuthority(
  reference: ContentEntryReference
): ContentSpaceVerificationAuthority {
  const root = 'containerId' in reference
    ? Object.freeze({
        providerInstanceRef: reference.providerInstanceRef,
        containerId: reference.containerId
      })
    : Object.freeze({
        providerInstanceRef: reference.providerInstanceRef,
        fileId: reference.fileId
      })
  return Object.freeze({ kind: 'content-root', root })
}

function callVerificationAuthority(
  call: ContentSpaceServiceCallContext,
  fallback: ContentEntryReference
): ContentSpaceVerificationAuthority {
  const binding = call.verificationBinding
  if (!binding) return contentVerificationAuthority(fallback)
  const root = parseInput(contentContainerReferenceSchema, binding.root)
  const reference = parseInput(zContentEntryReference, binding.reference)
  if (!sameContentEntryReference(reference, fallback) ||
    root.providerInstanceRef !== fallback.providerInstanceRef) {
    fail('unauthorized', 'The Broker verification binding changed Content authority.')
  }
  return contentVerificationAuthority(root)
}

function verificationAuthorityForTarget(
  target: ContentSpaceProviderFeatureTarget
): ContentSpaceVerificationAuthority {
  return target.kind === 'provider-administration'
    ? providerVerificationAuthority(target.providerInstanceRef)
    : contentVerificationAuthority(target.root)
}

function ordinaryOperationTransferLimits(
  operation: ContentSpaceOperation
): ContentSpaceVerificationTransferLimits {
  if (operation === 'upload-new') return UPLOAD_VERIFICATION_LIMITS
  if (operation === 'download') return DOWNLOAD_VERIFICATION_LIMITS
  return NO_VERIFICATION_TRANSFERS
}

function nativeDocumentTransferLimits(
  operation: NativeDocumentRequest['operation']
): ContentSpaceVerificationTransferLimits {
  if (operation === 'image-upload' || operation === 'import') {
    return UPLOAD_VERIFICATION_LIMITS
  }
  if (operation === 'image-download' || operation === 'export') {
    return DOWNLOAD_VERIFICATION_LIMITS
  }
  return NO_VERIFICATION_TRANSFERS
}

function extendedOperationTransferLimits(
  operation: ContentSpaceExtendedOperationKey
): ContentSpaceVerificationTransferLimits {
  if (operation === 'updateFileVersion' || operation === 'addAttachment') {
    return UPLOAD_VERIFICATION_LIMITS
  }
  return NO_VERIFICATION_TRANSFERS
}

function operationRequiresObservation(operation: ContentSpaceOperation): boolean {
  return operation !== 'list-containers' && operation !== 'observe-entry'
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
