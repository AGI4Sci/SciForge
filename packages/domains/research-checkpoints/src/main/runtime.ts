import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  ARTIFACT_VERSION_READ_CONTRACT,
  artifactVersionListInputV2Schema,
  artifactVersionListResultV2Schema,
  artifactVersionRestoreAsNewInputV1Schema,
  artifactVersionCommitResultV1Schema as artifactVersionRestoreAsNewResultV1Schema,
  artifactVersionCommitResultV1Schema,
  createArtifactVersionCommitPortV2,
  type ArtifactVersionCommitCandidateV2,
  type ArtifactVersionCommitResultV1,
  type ArtifactVersionCommitResultV2,
  type ArtifactVersionListInputV2,
  type ArtifactVersionRefV1,
  type ArtifactVersionRestoreAsNewInputV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  GIT_CHECKPOINTS_CAPABILITY_IDS,
  gitCheckpointListInputSchema,
  gitCheckpointListResultSchema,
  type GitCheckpoint
} from '@sciforge/domain-git-checkpoints/contract'
import type {
  DomainAgentThreadDetail,
  DomainAgentThreadTurn,
  DomainArtifactEvent,
  DomainCapabilityContract,
  DomainMainDurableTurnBoundarySnapshot,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'
import {
  researchCheckpointCommittedTurnStatusV1Schema,
  researchCheckpointLegacyPreviewV1Schema,
  researchCheckpointListV1Schema,
  researchCheckpointManifestV1Schema,
  researchCheckpointRecordV1Schema,
  type ResearchCheckpointCommittedTurnStatusV1,
  type ResearchCheckpointLegacyImportInputV1,
  type ResearchCheckpointLegacyPreviewInputV1,
  type ResearchCheckpointLegacyPreviewV1,
  type ResearchCheckpointListInputV1,
  type ResearchCheckpointListV1,
  type ResearchCheckpointManifestV1,
  type ResearchCheckpointReadInputV1,
  type ResearchCheckpointRecordV1,
  type ResearchCheckpointResolveInputV1,
  type ResearchCheckpointResolveReceiptV1,
  type ResearchCheckpointRestoreAsNewInputV1,
  type ResearchCheckpointRestoreAsNewReceiptV1,
  type ResearchCheckpointStartInputV1,
  type ResearchCheckpointStartReceiptV1,
  type ResearchCheckpointStopInputV1,
  type ResearchCheckpointStopReceiptV1,
  type ResearchCheckpointStatusV1,
  type ResearchCheckpointTurnStatusV1,
  type ResearchRecordingStatusV1
} from '../contract.js'
import {
  canonicalJson,
  idempotencyKey,
  outputCandidateId,
  outputVersionId,
  sha256,
  workspaceBindingDigest
} from './crypto.js'
import {
  extractCheckpointFromTurn,
  finalizeManifest,
  withGitCheckpoints,
  withObservedFile,
  withVerifiedFileChangeAttribution,
  type CheckpointFilePlan,
  type ResearchCheckpointTextSanitizer
} from './extract.js'
import {
  CheckpointStoreError,
  ResearchCheckpointStore,
  type CheckpointRestoreOperation,
  type CheckpointOperation,
  type StoredCheckpointFilePlan
} from './store.js'
import {
  RESEARCH_CHECKPOINT_PATCH_LIMITS,
  replayUnifiedFilePatchChain
} from './unified-file-patch.js'

const ARTIFACT_LIST_CONTRACT: DomainCapabilityContract<
  ArtifactVersionListInputV2,
  ReturnType<typeof artifactVersionListResultV2Schema.parse>
> = Object.freeze({
  actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
  effect: 'read',
  inputSchema: artifactVersionListInputV2Schema,
  outputSchema: artifactVersionListResultV2Schema
})

const ARTIFACT_RESTORE_AS_NEW_CONTRACT: DomainCapabilityContract<
  ArtifactVersionRestoreAsNewInputV1,
  ArtifactVersionCommitResultV1
> = Object.freeze({
  actionId: ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew,
  effect: 'workspace-write',
  inputSchema: artifactVersionRestoreAsNewInputV1Schema,
  outputSchema: artifactVersionRestoreAsNewResultV1Schema
})

const GIT_CHECKPOINT_LIST_CONTRACT: DomainCapabilityContract<
  Parameters<typeof gitCheckpointListInputSchema.parse>[0],
  ReturnType<typeof gitCheckpointListResultSchema.parse>
> = Object.freeze({
  actionId: GIT_CHECKPOINTS_CAPABILITY_IDS.list,
  effect: 'read',
  inputSchema: gitCheckpointListInputSchema,
  outputSchema: gitCheckpointListResultSchema
})

export type ResearchCheckpointRuntimeOptions = Readonly<{
  userDataDir: string
  store?: ResearchCheckpointStore
  sanitizeText?: ResearchCheckpointTextSanitizer
  /** @deprecated Evidence projection is not available in the current host capability surface. */
  evidenceLookupTimeoutMs?: number
}>

type EvidenceStatus = ResearchCheckpointCommittedTurnStatusV1['evidence']['status']
const EVIDENCE_LIST_CONCURRENCY = 8

export class ResearchCheckpointRuntime {
  readonly #store: ResearchCheckpointStore
  readonly #consumeQueues = new Map<string, Promise<void>>()
  readonly #drains = new Map<string, Promise<void>>()
  readonly #drainRequested = new Set<string>()
  readonly #retryTimers = new Map<string, NodeJS.Timeout>()
  readonly #restoreDrains = new Map<string, Promise<void>>()
  readonly #sanitizeText?: ResearchCheckpointTextSanitizer
  #context: DomainMainRuntimeLifecycleContext | null = null
  #enabled = false
  #disposed = false

  constructor(options: ResearchCheckpointRuntimeOptions) {
    this.#sanitizeText = options.sanitizeText
    this.#store = options.store ?? new ResearchCheckpointStore({
      userDataDir: options.userDataDir,
      sanitizeText: options.sanitizeText
    })
  }

  async activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer> {
    if (this.#context && this.#context !== context) {
      throw new Error('Research Checkpoints runtime is already active for another lifecycle context.')
    }
    if (!context.turnEvents?.subscribeRequiredBeforeTurn) {
      throw new Error(
        'Research Checkpoints requires the Host required before-turn boundary for automatic recording.'
      )
    }
    this.#store.bindCommittedManifestLoader(async ({ workspaceRoot, ref }) => {
      const result = await context.capabilities.invoke(
        ARTIFACT_VERSION_READ_CONTRACT,
        { versionId: ref.versionId, maxBytes: 64 * 1024 * 1024 },
        { workspaceId: workspaceRoot }
      )
      if (!result.ok) {
        throw new CheckpointStoreError(
          'content-mismatch',
          `Committed checkpoint Artifact Version read failed: ${result.issue.message}`
        )
      }
      const exact = result.value
      if (
        exact.artifact.artifactId !== ref.artifactId ||
        exact.version.artifactId !== ref.artifactId ||
        exact.version.versionId !== ref.versionId ||
        exact.version.storage.mode !== 'snapshot' ||
        exact.version.storage.contentDigest !== ref.contentDigest ||
        exact.version.storage.byteLength !== ref.byteLength ||
        exact.version.storage.mediaType !== ref.mediaType ||
        canonicalJson(exact.version.accessPolicy) !== canonicalJson(ref.accessPolicy) ||
        exact.ref.artifactId !== ref.artifactId ||
        exact.ref.versionId !== ref.versionId ||
        exact.ref.contentDigest !== ref.contentDigest ||
        exact.ref.byteLength !== ref.byteLength ||
        exact.ref.mediaType !== ref.mediaType ||
        exact.ref.availability !== ref.availability ||
        exact.ref.retention !== ref.retention ||
        canonicalJson(exact.ref.accessPolicy) !== canonicalJson(ref.accessPolicy)
      ) {
        throw new CheckpointStoreError(
          'content-mismatch',
          'Committed checkpoint Artifact owner returned the wrong exact reference.'
        )
      }
      return Uint8Array.from(Buffer.from(exact.dataBase64, 'base64'))
    })
    this.#context = context
    this.#disposed = false
    let activationReady = false
    const applyEnablement = (enabled: boolean) => {
      this.#enabled = enabled
      if (activationReady && enabled) void this.#recoverPending()
      if (!enabled) this.#clearRetryTimers()
    }
    const unsubscribe = context.enablement.subscribe(applyEnablement)
    applyEnablement(await context.enablement.isEnabled())
    try {
      await this.#store.reconcileTurnBoundaryOwners(
        normalizeDurableTurnBoundarySnapshot(
          await context.turnEvents.readDurableTurnBoundarySnapshot()
        )
      )
    } catch (error) {
      await Promise.resolve(unsubscribe()).catch(() => undefined)
      await this.dispose()
      throw error
    }
    if (this.#enabled) void this.#recoverPending()
    activationReady = true
    const unsubscribeBeforeTurn = context.turnEvents.subscribeRequiredBeforeTurn(async (event) => {
      if (!this.#enabled || this.#disposed || context.signal.aborted) return
      await this.#ensureAutomaticRecording(event)
    })
    const unsubscribeTurnLifecycle = context.turnEvents.subscribe(async (event) => {
      if (
        event.kind !== 'after-turn' ||
        this.#disposed ||
        !event.boundaryLeaseId ||
        !event.deliveryAttemptId ||
        !event.clientDirectiveId ||
        !event.workspaceRoot
      ) return
      await this.#store.settleTurnBoundaryLease(event.workspaceRoot, {
        issuerEpoch: event.issuerEpoch,
        deliveryAttemptOrdinal: event.deliveryAttemptOrdinal,
        leaseId: event.boundaryLeaseId,
        deliveryAttemptId: event.deliveryAttemptId,
        clientDirectiveId: event.clientDirectiveId,
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        state: event.state === 'completed' ? 'consumed' : 'released',
        ...(event.turnId ? { turnId: event.turnId } : {})
      })
    })
    const onAbort = () => { void this.dispose() }
    context.signal.addEventListener('abort', onAbort, { once: true })
    return async () => {
      context.signal.removeEventListener('abort', onAbort)
      await Promise.allSettled([unsubscribe(), unsubscribeBeforeTurn(), unsubscribeTurnLifecycle()])
      await this.dispose()
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#enabled = false
    this.#clearRetryTimers()
    await Promise.allSettled([
      ...this.#consumeQueues.values(),
      ...this.#drains.values(),
      ...this.#restoreDrains.values()
    ])
    this.#context = null
  }

  async start(
    workspaceRoot: string,
    input: ResearchCheckpointStartInputV1
  ): Promise<ResearchCheckpointStartReceiptV1> {
    const context = this.#ready()
    const boundary = await this.#threadBoundary(context, workspaceRoot, input.runtimeId, input.threadId)
    return this.#store.start(workspaceRoot, input, boundary)
  }

  async #ensureAutomaticRecording(
    event: Readonly<{
      issuerEpoch: string
      deliveryAttemptOrdinal: number
      boundaryLeaseId: string
      deliveryAttemptId: string
      runtimeId: string
      threadId: string
      clientDirectiveId: string
      workspaceRoot?: string
      occurredAt: string
    }>
  ): Promise<void> {
    const workspaceRoot = event.workspaceRoot?.trim()
    if (!workspaceRoot) return
    const context = this.#ready()
    const boundary = await this.#threadBoundary(
      context,
      workspaceRoot,
      event.runtimeId,
      event.threadId
    )
    // This awaited journal write is part of the required Host barrier and
    // therefore completes before the provider can mutate the workspace.
    await this.#store.ensureAutomaticLease(workspaceRoot, {
      issuerEpoch: event.issuerEpoch,
      deliveryAttemptOrdinal: event.deliveryAttemptOrdinal,
      leaseId: event.boundaryLeaseId,
      deliveryAttemptId: event.deliveryAttemptId,
      clientDirectiveId: event.clientDirectiveId,
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      title: `Research ${event.threadId}`,
      boundary
    })
  }

  async stop(
    workspaceRoot: string,
    input: ResearchCheckpointStopInputV1
  ): Promise<ResearchCheckpointStopReceiptV1> {
    const context = this.#ready()
    const boundary = await this.#threadBoundary(context, workspaceRoot, input.runtimeId, input.threadId)
    return this.#store.stop(workspaceRoot, input, boundary)
  }

  async resolve(
    workspaceRoot: string,
    input: ResearchCheckpointResolveInputV1
  ): Promise<ResearchCheckpointResolveReceiptV1> {
    const context = this.#ready()
    await this.#threadBoundary(context, workspaceRoot, input.runtimeId, input.threadId)
    const operation = await this.#store.operation(workspaceRoot, input.operationId)
    if (!operation) throw new CheckpointRuntimeError('not-found', 'Checkpoint operation not found.', false)
    const resolutionReplay = operation.resolutionHistory.some((item) =>
      item.idempotencyKey === input.idempotencyKey
    )
    let current: Readonly<{ ref: ArtifactVersionRefV1; ordinal: number }> | undefined
    if (input.resolution === 'rebase' && !resolutionReplay) {
      // A stale candidate may be an output rather than the checkpoint itself.
      // For an existing checkpoint, refresh its exact current through the
      // Artifact owner. For an unbound v1 checkpoint there is no checkpoint
      // current to resolve: resetting preparation is sufficient because the
      // store will atomically refreeze every workspace output current.
      if (operation.artifactId) {
        const listed = await context.capabilities.invoke(
          ARTIFACT_LIST_CONTRACT,
          { artifactId: operation.artifactId, currentOnly: true, limit: 2 },
          { workspaceId: workspaceRoot }
        )
        if (!listed.ok) {
          throw new CheckpointRuntimeError(
            'artifact-unavailable',
            `Checkpoint current Version could not be resolved: ${listed.issue.message}`,
            listed.issue.code === 'io-failure'
          )
        }
        const item = listed.value.items.find((candidate) => candidate.isCurrent)
        if (!item || item.ref.artifactId !== operation.artifactId) {
          throw new CheckpointRuntimeError('artifact-unavailable', 'Checkpoint Artifact has no exact current Version.', false)
        }
        current = { ref: item.ref, ordinal: item.artifactOrdinal }
      }
    }
    const resolved = await this.#store.resolveConflict(workspaceRoot, input, current)
    this.#scheduleDrain(workspaceRoot, resolved.recordingId)
    return {
      resolution: input.resolution,
      status: await this.#store.turnStatus(
        workspaceRoot,
        resolved.runtimeId,
        resolved.threadId,
        resolved.turnId
      )
    }
  }

  async restoreAsNew(
    workspaceRoot: string,
    input: ResearchCheckpointRestoreAsNewInputV1
  ): Promise<ResearchCheckpointRestoreAsNewReceiptV1> {
    this.#ready()
    const operation = await this.#store.enqueueRestore(workspaceRoot, input)
    const journalReplay = operation.state === 'committed'
    const completed = operation.state === 'committed'
      ? operation
      : await this.#processRestore(workspaceRoot, operation)
    if (
      completed.state !== 'committed' ||
      !completed.restoredRef ||
      !completed.ordinal ||
      !completed.transactionId ||
      completed.idempotentReplay === undefined
    ) {
      throw new CheckpointRuntimeError(
        completed.retryable ? 'io-failure' : 'artifact-unavailable',
        completed.error ?? 'Artifact restore remains pending.',
        completed.retryable ?? true
      )
    }
    const recording = await this.#store.statusById(workspaceRoot, input.recordingId)
    if (!recording) throw new CheckpointRuntimeError('not-found', 'Research recording not found.', false)
    this.#scheduleDrain(workspaceRoot, input.recordingId)
    return {
      recording,
      restoredRef: completed.restoredRef,
      ordinal: completed.ordinal,
      transactionId: completed.transactionId,
      // Keep the owner receipt stored exactly as observed. A repeated public
      // request is nevertheless an idempotent replay of this durable journal.
      idempotentReplay: journalReplay || completed.idempotentReplay
    }
  }

  async #processRestore(
    workspaceRoot: string,
    operation: CheckpointRestoreOperation
  ): Promise<CheckpointRestoreOperation> {
    if (operation.state !== 'pending') return operation
    const context = this.#ready()
    await this.#store.markRestoreAttempt(workspaceRoot, operation.restoreOperationId)
    let sourceRecord: ResearchCheckpointRecordV1
    try {
      sourceRecord = await this.#store.read(workspaceRoot, {
        recordingId: operation.recordingId,
        versionId: operation.sourceVersionId
      })
    } catch (error) {
      return this.#store.failRestore(
        workspaceRoot,
        operation.restoreOperationId,
        `Restore source checkpoint could not be resolved exactly: ${errorMessage(error)}`,
        false
      )
    }
    if (
      sourceRecord.status.recordingId !== operation.recordingId ||
      sourceRecord.manifest.recording.recordingId !== operation.recordingId ||
      sourceRecord.status.runtimeId !== sourceRecord.manifest.recording.runtimeId ||
      sourceRecord.status.threadId !== sourceRecord.manifest.recording.threadId ||
      sourceRecord.status.turnId !== sourceRecord.manifest.turn.turnId ||
      sourceRecord.status.artifactRef.artifactId !== operation.artifactId ||
      sourceRecord.status.artifactRef.versionId !== operation.sourceVersionId
    ) {
      return this.#store.failRestore(
        workspaceRoot,
        operation.restoreOperationId,
        'Restore source checkpoint projection does not match the requested exact identity.',
        false
      )
    }
    const sourceManifestDigest = sha256(canonicalJson(sourceRecord.manifest))
    let result: ArtifactVersionCommitResultV1
    try {
      result = await context.capabilities.invoke(
        ARTIFACT_RESTORE_AS_NEW_CONTRACT,
        {
          idempotencyKey: operation.idempotencyKey,
          artifactId: operation.artifactId,
          sourceVersionId: operation.sourceVersionId,
          expectedCurrentVersionId: operation.expectedCurrentVersionId,
          metadata: {
            ...checkpointMetadata(sourceRecord.manifest, sourceManifestDigest),
            restoredBy: 'research-checkpoints',
            restoreOperationId: operation.restoreOperationId
          }
        },
        {
          workspaceId: workspaceRoot,
          idempotencyKey: operation.idempotencyKey
        }
      )
    } catch (error) {
      await this.#store.failRestore(
        workspaceRoot,
        operation.restoreOperationId,
        `Artifact restore transport failed: ${errorMessage(error)}`,
        true
      )
      throw new CheckpointRuntimeError(
        'io-failure',
        `Artifact restore transport failed: ${errorMessage(error)}`,
        true
      )
    }
    if (!result.ok) {
      const retryable = result.issue.code === 'io-failure'
      return this.#store.failRestore(
        workspaceRoot,
        operation.restoreOperationId,
        result.issue.message,
        retryable
      )
    }
    const item = result.value.versions.find((candidate) => (
      candidate.ref.artifactId === operation.artifactId &&
      candidate.version.metadata.restoredFromVersionId === operation.sourceVersionId
    ))
    if (
      !item ||
      item.artifact.currentVersionId !== item.ref.versionId ||
      item.version.parentVersionId !== operation.expectedCurrentVersionId
    ) {
      return this.#store.failRestore(
        workspaceRoot,
        operation.restoreOperationId,
        'Artifact restore receipt does not prove the requested exact identity transition.',
        false
      )
    }
    return this.#store.completeRestore(workspaceRoot, operation.restoreOperationId, {
      restoredRef: item.ref,
      ordinal: item.artifact.versionCount,
      transactionId: result.value.transactionId,
      idempotentReplay: result.value.idempotentReplay
    })
  }

  async status(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<ResearchRecordingStatusV1 | null> {
    this.#ready()
    return this.#store.status(workspaceRoot, runtimeId, threadId)
  }

  async checkpointStatus(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<ResearchCheckpointStatusV1> {
    this.#ready()
    return this.#store.checkpointStatus(workspaceRoot, runtimeId, threadId)
  }

  async automaticRecordingEnabled(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<boolean> {
    this.#ready()
    return this.#store.automaticRecordingEnabled(workspaceRoot, runtimeId, threadId)
  }

  async turnStatus(
    workspaceRoot: string,
    runtimeId: string,
    threadId: string,
    turnId: string
  ): Promise<ResearchCheckpointTurnStatusV1> {
    this.#ready()
    return this.#withCurrentEvidence(
      workspaceRoot,
      await this.#store.turnStatus(workspaceRoot, runtimeId, threadId, turnId)
    )
  }

  async read(
    workspaceRoot: string,
    input: ResearchCheckpointReadInputV1
  ): Promise<ResearchCheckpointRecordV1> {
    this.#ready()
    const record = await this.#store.read(workspaceRoot, input)
    return researchCheckpointRecordV1Schema.parse({
      manifest: record.manifest,
      status: await this.#withCurrentEvidence(workspaceRoot, record.status),
      ...(record.projection ? { projection: record.projection } : {})
    })
  }

  async list(
    workspaceRoot: string,
    input: ResearchCheckpointListInputV1
  ): Promise<ResearchCheckpointListV1> {
    this.#ready()
    const page = await this.#store.list(workspaceRoot, input)
    // A page is bounded to 200 records. A small worker pool prevents both a
    // sequential timeout waterfall and unbounded Evidence owner fanout.
    const records = await mapWithConcurrency(
      page.records,
      EVIDENCE_LIST_CONCURRENCY,
      async (record): Promise<ResearchCheckpointRecordV1> =>
        researchCheckpointRecordV1Schema.parse({
          manifest: record.manifest,
          status: await this.#withCurrentEvidence(workspaceRoot, record.status),
          ...(record.projection ? { projection: record.projection } : {})
        })
    )
    return researchCheckpointListV1Schema.parse({
      records,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
    })
  }

  async consume(event: DomainArtifactEvent): Promise<void> {
    if (event.kind !== 'turn-completed' || this.#disposed) return
    const workspaceRoot = event.workspaceRoot?.trim()
    if (!workspaceRoot) return
    const key = `${workspaceRoot}\0${event.runtimeId}\0${event.threadId}`
    const previous = this.#consumeQueues.get(key) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(() => this.#enqueueTurn(workspaceRoot, event))
    this.#consumeQueues.set(key, current)
    try {
      await current
    } finally {
      if (this.#consumeQueues.get(key) === current) this.#consumeQueues.delete(key)
    }
  }

  async importLegacy(
    workspaceRoot: string,
    input: ResearchCheckpointLegacyImportInputV1
  ): Promise<ResearchCheckpointCommittedTurnStatusV1> {
    const context = this.#ready()
    const detail = await readScopedDurableThread(
      context,
      workspaceRoot,
      input.runtimeId,
      input.threadId
    )
    const byId = new Map(detail.turns.map((turn) => [turn.id, turn]))
    const selected = input.selectedTurnIds.map((turnId) => {
      const turn = byId.get(turnId)
      if (!turn) throw new CheckpointRuntimeError('not-found', `Selected durable turn is missing: ${turnId}`, false)
      if (!isCompletedDurableTurn(turn.status)) {
        throw new CheckpointRuntimeError(
          'content-mismatch',
          `Selected durable turn is not complete: ${turnId}`,
          false
        )
      }
      return turn
    })
    const transcriptDigest = durableTranscriptDigest(selected)
    if (input.expectedTranscriptDigest !== transcriptDigest) {
      throw new CheckpointRuntimeError('content-mismatch', 'Durable transcript digest does not match the selected history.', false)
    }
    const recording = await this.#store.createLegacyRecording(workspaceRoot, {
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      title: input.title,
      idempotencyKey: input.idempotencyKey
    })
    const narrative = selected
      .flatMap((turn) => turn.artifacts)
      .flatMap((value) => {
        const item = record(value)
        if (!item) return []
        const kind = stringValue(item.kind)
        const text = stringValue(item.text)
        return text && (kind === 'user_message' || kind === 'assistant_message')
          ? [`${kind === 'user_message' ? 'User' : 'Assistant'}: ${text}`]
          : []
      })
      .join('\n\n')
    const occurredAt = [...selected]
      .map((turn) => turn.completedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? recording.createdAt
    const manifest = researchCheckpointManifestV1Schema.parse({
      contractVersion: 1,
      kind: 'sciforge.research-checkpoint-manifest.v1',
      recording: {
        recordingId: recording.recordingId,
        origin: 'legacy-import',
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        workspaceBindingDigest: workspaceBindingDigest(workspaceRoot)
      },
      turn: {
        turnId: `legacy:${transcriptDigest.slice(0, 32)}`,
        targetWatermark: transcriptDigest,
        occurredAt
      },
      title: input.title,
      changeReason: 'Explicitly imported selected historical turns as an incomplete legacy record.',
      narrative: {
        canonicalText: narrative,
        contentDigest: sha256(narrative)
      },
      sources: [],
      declaredFiles: [],
      artifactDependencies: [],
      computeRuns: [],
      gitCheckpoints: [],
      untrackedOperations: [{
        kind: 'unknown',
        summary: 'Historical execution boundaries and exact file observations were not captured.'
      }],
      breakpoints: [{
        code: 'legacy-provenance-incomplete',
        blocking: true,
        message: 'Legacy import cannot establish original execution, environment, file, or Evidence facts.'
      }],
      status: {
        execution: 'observed-untracked',
        provenance: 'incomplete',
        control: 'untracked',
        reproduction: 'not-run',
        evidence: 'unavailable'
      },
      importedTranscriptDigest: transcriptDigest,
      importedTurnIds: input.selectedTurnIds
    })
    const operation = await this.#store.enqueue(
      workspaceRoot,
      recording.recordingId,
      { manifest, filePlans: [], computeRunCandidates: [] },
      idempotencyKey('legacy-commit', [
        workspaceBindingDigest(workspaceRoot),
        input.idempotencyKey,
        transcriptDigest
      ])
    )
    const committed = await this.#processQueuedOperation(workspaceRoot, operation)
    const status = await this.#store.turnStatus(
      workspaceRoot,
      input.runtimeId,
      input.threadId,
      manifest.turn.turnId
    )
    if (committed.state !== 'committed' || status.state !== 'committed') {
      throw new CheckpointRuntimeError(
        committed.state === 'stale-conflict' ? 'stale-conflict' : 'artifact-unavailable',
        committed.error ?? 'Legacy checkpoint did not commit.',
        committed.state !== 'failed'
      )
    }
    return status
  }

  async previewLegacy(
    workspaceRoot: string,
    input: ResearchCheckpointLegacyPreviewInputV1
  ): Promise<ResearchCheckpointLegacyPreviewV1> {
    const context = this.#ready()
    const detail = await readScopedDurableThread(
      context,
      workspaceRoot,
      input.runtimeId,
      input.threadId
    )
    const turns = detail.turns
      .filter((turn) => isCompletedDurableTurn(turn.status))
      .map((turn) => ({
        turnId: turn.id,
        ...(turn.status ? { status: turn.status } : {}),
        ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
        summary: durableTurnSummary(turn.artifacts)
      }))
    if (new Set(turns.map((turn) => turn.turnId)).size !== turns.length) {
      throw new CheckpointRuntimeError(
        'content-mismatch',
        'Durable transcript contains duplicate turn IDs.',
        false
      )
    }
    const selectableIds = new Set(turns.map((turn) => turn.turnId))
    const selectedTurnIds = input.selectedTurnIds ?? []
    if (new Set(selectedTurnIds).size !== selectedTurnIds.length) {
      throw new CheckpointRuntimeError('invalid-input', 'Selected durable turn IDs must be unique.', false)
    }
    const missing = selectedTurnIds.find((turnId) => !selectableIds.has(turnId))
    if (missing) {
      throw new CheckpointRuntimeError('not-found', `Selected durable turn is missing or incomplete: ${missing}`, false)
    }
    const byId = new Map(detail.turns.map((turn) => [turn.id, turn]))
    const selected = selectedTurnIds.map((turnId) => byId.get(turnId)!)
    return researchCheckpointLegacyPreviewV1Schema.parse({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      turns,
      selectedTurnIds,
      selectedTranscriptDigest: selected.length ? durableTranscriptDigest(selected) : null
    })
  }

  async #enqueueTurn(workspaceRoot: string, event: DomainTurnArtifactEvent): Promise<void> {
    if (
      !event.issuerEpoch ||
      !Number.isSafeInteger(event.deliveryAttemptOrdinal) ||
      !event.deliveryAttemptOrdinal ||
      !event.boundaryLeaseId ||
      !event.deliveryAttemptId ||
      !event.clientDirectiveId
    ) return
    const replay = await this.#store.operationForEvent(
      workspaceRoot,
      event.runtimeId,
      event.threadId,
      event.turnId,
      event.targetWatermark
    )
    if (replay) {
      if (
        replay.issuerEpoch !== event.issuerEpoch ||
        replay.deliveryAttemptOrdinal !== event.deliveryAttemptOrdinal ||
        replay.boundaryLeaseId !== event.boundaryLeaseId ||
        replay.deliveryAttemptId !== event.deliveryAttemptId
      ) throw new CheckpointStoreError('content-mismatch', 'Artifact event replay changed its boundary identity.')
      if (replay.state === 'pending') {
        const locallyVerified = await this.#verifyPatchedFiles(workspaceRoot, replay)
        this.#scheduleDrain(workspaceRoot, locallyVerified.recordingId)
      }
      return
    }
    const recordingContext = await this.#store.recordingContextForLease(workspaceRoot, {
      issuerEpoch: event.issuerEpoch,
      deliveryAttemptOrdinal: event.deliveryAttemptOrdinal,
      leaseId: event.boundaryLeaseId,
      deliveryAttemptId: event.deliveryAttemptId,
      clientDirectiveId: event.clientDirectiveId,
      runtimeId: event.runtimeId,
      threadId: event.threadId
    })
    if (!recordingContext) return
    const recording = recordingContext.recording
    const extracted = extractCheckpointFromTurn(
      event,
      recording,
      workspaceRoot,
      new Map(),
      recordingContext.initialChangeReason,
      { sanitizeText: this.#sanitizeText }
    )
    const operation = await this.#store.enqueue(
      workspaceRoot,
      recording.recordingId,
      extracted,
      idempotencyKey('turn-commit', [
        workspaceBindingDigest(workspaceRoot),
        recording.recordingId,
        event.runtimeId,
        event.threadId,
        event.turnId,
        event.targetWatermark
      ]),
      {
        issuerEpoch: event.issuerEpoch,
        deliveryAttemptOrdinal: event.deliveryAttemptOrdinal,
        leaseId: event.boundaryLeaseId,
        deliveryAttemptId: event.deliveryAttemptId
      }
    )
    if (operation.state === 'pending') {
      // Persist verified terminal bytes before acknowledging Host delivery so
      // a following turn can freeze this uncommitted exact predecessor.
      const locallyVerified = await this.#verifyPatchedFiles(workspaceRoot, operation)
      this.#scheduleDrain(workspaceRoot, locallyVerified.recordingId)
    }
  }

  async #attachVerifiedCompute(
    _workspaceRoot: string,
    _event: Readonly<{ runtimeId: string; threadId: string }>,
    initial: ResearchCheckpointManifestV1,
    candidates: readonly string[]
  ): Promise<ResearchCheckpointManifestV1> {
    if (!candidates.length) return initial
    return researchCheckpointManifestV1Schema.parse({
      ...initial,
      breakpoints: [
        ...initial.breakpoints,
        {
          code: 'compute-owner-unavailable',
          blocking: true,
          message: `Formal Compute owner APIs are unavailable; ${candidates.length} Host-delivered candidate(s) remain unverified.`
        }
      ],
      status: {
        ...initial.status,
        provenance: 'incomplete',
        reproduction: 'inconclusive'
      }
    })
  }

  async #verifyPatchedFiles(
    workspaceRoot: string,
    initial: CheckpointOperation
  ): Promise<CheckpointOperation> {
    let operation = initial
    for (const plan of operation.filePlans) {
      if (operation.observedPaths.includes(plan.path)) continue
      let verifiedPlan: StoredCheckpointFilePlan = plan
      let deterministicFailure: string | undefined
      try {
        if (!plan.patchReceipts?.length || !plan.terminalEffect) {
          throw new Error('No durable executor patch chain and terminal identity were paired.')
        }
        if (!plan.preTurnBindingCaptured) {
          throw new Error('The Host directive had no durable before-turn output-binding snapshot.')
        }
        let priorBytes: Uint8Array | null = null
        if (plan.expectedCurrentVersionId) {
          if (!plan.expectedCurrentRef || plan.expectedCurrentRef.versionId !== plan.expectedCurrentVersionId) {
            throw new Error('The frozen output parent lacks its exact Artifact reference.')
          }
          if (plan.expectedCurrentDataBase64 !== undefined) {
            const decoded = Buffer.from(plan.expectedCurrentDataBase64, 'base64')
            if (
              decoded.byteLength !== plan.expectedCurrentRef.byteLength ||
              sha256(decoded) !== plan.expectedCurrentRef.contentDigest
            ) throw new Error('Local pending predecessor bytes failed exact reference verification.')
            priorBytes = decoded
          } else {
            let read
            try {
              read = await this.#ready().capabilities.invoke(
                ARTIFACT_VERSION_READ_CONTRACT,
                {
                  versionId: plan.expectedCurrentVersionId,
                  maxBytes: RESEARCH_CHECKPOINT_PATCH_LIMITS.maxOutputBytes
                },
                { workspaceId: workspaceRoot }
              )
            } catch (error) {
              throw new CheckpointTransientError(`Prior output Artifact read failed: ${errorMessage(error)}`)
            }
            if (!read.ok) {
              if (read.issue.code === 'io-failure') throw new CheckpointTransientError(read.issue.message)
              throw new Error(`Prior output Artifact is unavailable: ${read.issue.message}`)
            }
            if (!sameArtifactRef(read.value.ref, plan.expectedCurrentRef)) {
              throw new Error('Prior output Artifact read changed the frozen exact reference.')
            }
            const decoded = Buffer.from(read.value.dataBase64, 'base64')
            if (
              decoded.byteLength !== read.value.ref.byteLength ||
              sha256(decoded) !== read.value.ref.contentDigest
            ) throw new Error('Prior output Artifact bytes failed exact reference verification.')
            priorBytes = decoded
          }
        }
        const replayed = replayUnifiedFilePatchChain({
          path: plan.path,
          initialBytes: priorBytes,
          receipts: plan.patchReceipts
        })
        const effect = plan.terminalEffect
        if (effect.kind === 'deleted') {
          if (replayed.bytes !== null || replayed.lastOperation !== 'delete') {
            throw new Error('Executor deletion did not reproduce the terminal deleted identity.')
          }
          // Deletion is a tombstone gap in v1: no successful output Version or
          // current advance is minted until Artifact Versions owns tombstones.
          throw new Error('Verified deletion is preserved as a tombstone breakpoint; v1 does not mint deleted output Versions.')
        }
        if (!replayed.bytes || replayed.lastOperation === 'delete') {
          throw new Error('Executor patches did not reproduce terminal output bytes.')
        }
        const bytes = Buffer.from(replayed.bytes)
        const digest = sha256(bytes)
        if (
          effect.contentDigest !== digest ||
          effect.byteLength !== bytes.byteLength ||
          plan.declaredDigest !== digest
        ) throw new Error('Executor patch result does not match the Host terminal digest and byte length.')
        verifiedPlan = {
          ...plan,
          terminalSnapshot: {
            contentDigest: digest,
            byteLength: bytes.byteLength,
            ...(effect.mediaType ? { mediaType: effect.mediaType } : {}),
            dataBase64: bytes.toString('base64')
          }
        }
      } catch (error) {
        if (error instanceof CheckpointTransientError) throw error
        deterministicFailure = errorMessage(error)
      }
      const manifest = deterministicFailure
        ? withObservedFile(operation.manifest, { plan, error: deterministicFailure })
        : operation.manifest
      operation = await this.#store.completeFilePatchVerification(
        workspaceRoot,
        operation.operationId,
        plan.path,
        verifiedPlan,
        manifest
      )
    }
    return operation
  }

  async #attachGitCheckpoint(
    workspaceRoot: string,
    operation: CheckpointOperation
  ): Promise<CheckpointOperation> {
    if (operation.gitProjectionProcessed) return operation
    const context = this.#ready()
    let checkpoints: readonly GitCheckpoint[] = []
    let deterministicFailure: string | undefined
    try {
      const input = {
        runtimeId: operation.runtimeId,
        threadId: operation.threadId,
        workspaceRoot
      }
      const result = await context.capabilities.invoke(
        GIT_CHECKPOINT_LIST_CONTRACT,
        input,
        { workspaceId: workspaceRoot }
      )
      if (result.ok) {
        checkpoints = result.value.filter((item) => item.turnId === operation.turnId)
      } else {
        deterministicFailure = `Git Checkpoints unavailable (${result.reason}): ${result.message}`
      }
    } catch (error) {
      throw new CheckpointTransientError(`Git Checkpoints transport failed: ${errorMessage(error)}`)
    }
    if (deterministicFailure) {
      const manifest = finalizeManifest({
        ...operation.manifest,
        breakpoints: [
          ...operation.manifest.breakpoints.filter((item) => item.code !== 'git-checkpoint-unavailable'),
          {
            code: 'git-checkpoint-unavailable',
            blocking: true,
            message: deterministicFailure,
            itemId: `git:${operation.turnId}`
          }
        ]
      })
      return this.#store.completeGitProjection(workspaceRoot, operation.operationId, manifest)
    }
    if (!checkpoints.length) {
      return this.#store.completeGitProjection(
        workspaceRoot,
        operation.operationId,
        operation.manifest
      )
    }
    const manifest = withGitCheckpoints(operation.manifest, checkpoints.map((item) => ({
      checkpointId: item.checkpointId,
      provider: item.provider,
      revision: item.revision
    })))
    return this.#store.completeGitProjection(workspaceRoot, operation.operationId, manifest)
  }

  async #commitOperation(
    workspaceRoot: string,
    initial: CheckpointOperation
  ): Promise<CheckpointOperation> {
    if (initial.state !== 'pending') return initial
    const context = this.#ready()
    const defaultAccessPolicy = {
      visibility: 'workspace' as const,
      principals: [] as string[],
      allowExport: false
    }
    const atomicOutputPlans = initial.filePlans.filter((plan): plan is typeof plan & Readonly<{
      artifactId: string
      terminalSnapshot: NonNullable<typeof plan.terminalSnapshot> & Readonly<{ dataBase64: string }>
    }> => Boolean(plan.artifactId && plan.terminalSnapshot?.dataBase64 !== undefined))
    let manifestWithAtomicOutputs = initial.manifest
    for (const plan of atomicOutputPlans) {
      const versionId = outputVersionId(initial.operationId, plan.path)
      const priorOrdinal = plan.expectedCurrentOrdinal ?? 0
      manifestWithAtomicOutputs = withObservedFile(manifestWithAtomicOutputs, {
        plan,
        artifactOrdinal: priorOrdinal + 1,
        ref: {
          artifactId: plan.artifactId,
          versionId,
          contentDigest: plan.terminalSnapshot.contentDigest,
          byteLength: plan.terminalSnapshot.byteLength,
          ...(plan.terminalSnapshot.mediaType
            ? { mediaType: plan.terminalSnapshot.mediaType }
            : {}),
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: plan.accessPolicy ?? defaultAccessPolicy
        }
      })
    }
    manifestWithAtomicOutputs = withVerifiedFileChangeAttribution(
      manifestWithAtomicOutputs,
      initial.manifest,
      initial.filePlans,
      atomicOutputPlans
    )
    const manifest = finalizeManifest(manifestWithAtomicOutputs)
    let operation = manifest === initial.manifest
      ? initial
      : await this.#store.replaceManifest(workspaceRoot, initial.operationId, manifest)
    operation = await this.#store.markAttempt(workspaceRoot, operation.operationId)
    const bytes = Buffer.from(canonicalJson(operation.manifest), 'utf8')
    const atomicOutputVersionIds = new Map(atomicOutputPlans.map((plan) => [
      outputVersionId(operation.operationId, plan.path),
      outputCandidateId(operation.operationId, plan.path)
    ]))
    const dependencies = dependencyCandidates(operation.manifest, atomicOutputVersionIds)
    const checkpointCandidate: ArtifactVersionCommitCandidateV2 = {
      candidateId: operation.candidateId,
      ...(operation.artifactId ? { artifactId: operation.artifactId } : {}),
      expectedCurrentVersionId: operation.expectedCurrentVersionId,
      kind: 'research-checkpoint',
      label: operation.manifest.title,
      intent: operation.changeKind === 'new' ? 'save' : 'save',
      content: {
        mode: 'snapshot',
        dataBase64: bytes.toString('base64'),
        mediaType: 'application/vnd.sciforge.research-checkpoint+json'
      },
      accessPolicy: defaultAccessPolicy,
      ...(dependencies.length ? { dependencies } : {}),
      metadata: checkpointMetadata(operation.manifest, operation.manifestDigest)
    }
    const outputCandidates: ArtifactVersionCommitCandidateV2[] = atomicOutputPlans.map((plan) => ({
      candidateId: outputCandidateId(operation.operationId, plan.path),
      ...(plan.expectedCurrentVersionId
        ? { artifactId: plan.artifactId }
        : { requestedArtifactId: plan.artifactId }),
      requestedVersionId: outputVersionId(operation.operationId, plan.path),
      expectedCurrentVersionId: plan.expectedCurrentVersionId,
      kind: 'research-output',
      label: plan.path,
      intent: 'save',
      content: {
        mode: 'snapshot',
        dataBase64: plan.terminalSnapshot.dataBase64,
        ...(plan.terminalSnapshot.mediaType
          ? { mediaType: plan.terminalSnapshot.mediaType }
          : {})
      },
      accessPolicy: plan.accessPolicy ?? defaultAccessPolicy,
      metadata: {
        researchRecordingId: operation.recordingId,
        researchCheckpointOperationId: operation.operationId,
        researchTurnId: operation.turnId,
        workspaceRelativePath: plan.path,
        capture: 'host-turn-boundary-exact',
        causality: 'host-authenticated-executor-write'
      }
    }))
    const candidates = [...outputCandidates, checkpointCandidate]
    operation = await this.#store.freezeCommitDigest(
      workspaceRoot,
      operation.operationId,
      sha256(canonicalJson(candidates))
    )
    let result: ArtifactVersionCommitResultV2
    try {
      result = await createArtifactVersionCommitPortV2(context.capabilities, workspaceRoot).commit({
        idempotencyKey: operation.idempotencyKey,
        candidates
      })
    } catch (error) {
      await this.#store.markAttempt(workspaceRoot, operation.operationId, errorMessage(error))
      throw error
    }
    if (!result.ok) {
      if (result.issue.code === 'stale-base') {
        return this.#store.markTerminalFailure(
          workspaceRoot,
          operation.operationId,
          'stale-conflict',
          result.issue.message,
          true
        )
      }
      if (result.issue.code === 'io-failure') {
        await this.#store.markAttempt(workspaceRoot, operation.operationId, result.issue.message)
        throw new Error(`Artifact checkpoint commit failed: ${result.issue.message}`)
      }
      return this.#store.markTerminalFailure(
        workspaceRoot,
        operation.operationId,
        'failed',
        result.issue.message,
        false
      )
    }
    const item = result.value.versions.find((version) => version.candidateId === operation.candidateId)
    if (!item) throw new Error('Artifact checkpoint receipt omitted its declared candidate.')
    const outputReceipts = atomicOutputPlans.map((plan) => {
      const output = result.value.versions.find((version) => (
        version.candidateId === outputCandidateId(operation.operationId, plan.path)
      ))
      if (!output) throw new Error(`Artifact atomic receipt omitted output ${plan.path}.`)
      const predicted = operation.manifest.declaredFiles.find((file) => file.path === plan.path)
      if (
        !predicted?.artifactVersionRef ||
        !sameArtifactRef(predicted.artifactVersionRef, output.ref) ||
        predicted.artifactOrdinal !== output.artifact.versionCount
      ) throw new Error(`Artifact atomic receipt changed predicted output ref ${plan.path}.`)
      return { path: plan.path, item: output }
    })
    return this.#store.markCommitted(
      workspaceRoot,
      operation.operationId,
      item,
      result.value.transactionId,
      outputReceipts
    )
  }

  async #processQueuedOperation(
    workspaceRoot: string,
    initial: CheckpointOperation
  ): Promise<CheckpointOperation> {
    let operation = await this.#store.prepareOperation(workspaceRoot, initial.operationId)
    if (operation.state !== 'pending') return operation
    if (!operation.computeCandidatesProcessed) {
      const manifest = await this.#attachVerifiedCompute(
        workspaceRoot,
        operation,
        operation.manifest,
        operation.computeRunCandidates
      )
      operation = await this.#store.completeComputeVerification(
        workspaceRoot,
        operation.operationId,
        manifest
      )
    }
    operation = await this.#verifyPatchedFiles(workspaceRoot, operation)
    operation = operation.manifest.recording.origin === 'legacy-import'
      ? operation.gitProjectionProcessed
        ? operation
        : await this.#store.completeGitProjection(
            workspaceRoot,
            operation.operationId,
            operation.manifest
          )
      : await this.#attachGitCheckpoint(workspaceRoot, operation)
    return this.#commitOperation(workspaceRoot, operation)
  }

  #scheduleDrain(workspaceRoot: string, recordingId: string, delayMs = 0): void {
    if (this.#disposed || !this.#enabled) return
    const key = `${workspaceBindingDigest(workspaceRoot)}\0${recordingId}`
    if (delayMs > 0) {
      if (this.#retryTimers.has(key)) return
      const timer = setTimeout(() => {
        this.#retryTimers.delete(key)
        this.#scheduleDrain(workspaceRoot, recordingId)
      }, delayMs)
      timer.unref?.()
      this.#retryTimers.set(key, timer)
      return
    }
    if (this.#drains.has(key)) {
      this.#drainRequested.add(key)
      return
    }
    const drain = this.#drainRecording(workspaceRoot, recordingId)
      .finally(() => {
        if (this.#drains.get(key) === drain) this.#drains.delete(key)
        if (this.#drainRequested.delete(key)) this.#scheduleDrain(workspaceRoot, recordingId)
      })
    this.#drains.set(key, drain)
  }

  async #drainRecording(workspaceRoot: string, recordingId: string): Promise<void> {
    while (!this.#disposed && this.#enabled) {
      const operation = await this.#store.nextProcessable(workspaceRoot, recordingId)
      if (!operation) return
      try {
        const completed = await this.#processQueuedOperation(workspaceRoot, operation)
        if (completed.state === 'stale-conflict') return
      } catch {
        // The durable local journal owns retry after Host delivery. Never hold
        // or replay the shared DomainTurnArtifactEvent fanout for an Artifact
        // service outage or a response-loss window.
        this.#scheduleDrain(
          workspaceRoot,
          recordingId,
          Math.min(30_000, 500 * 2 ** Math.min(operation.attempts, 6))
        )
        return
      }
    }
  }

  async #recoverPending(): Promise<void> {
    if (this.#disposed || !this.#enabled) return
    try {
      const restores = await this.#store.recoverableRestores()
      for (const item of restores) {
        this.#scheduleRestoreRecovery(item.workspaceRoot, item.restoreOperation)
      }
      const recordings = await this.#store.recoverableRecordings()
      for (const item of recordings) this.#scheduleDrain(item.workspaceRoot, item.recordingId)
    } catch {
      // A later enablement transition or newly delivered turn retries the
      // bounded recovery scan. Individual valid stores remain untouched.
    }
  }

  #scheduleRestoreRecovery(
    workspaceRoot: string,
    operation: CheckpointRestoreOperation
  ): void {
    if (this.#disposed || !this.#enabled) return
    const key = `${workspaceBindingDigest(workspaceRoot)}\0${operation.restoreOperationId}`
    if (this.#restoreDrains.has(key)) return
    const recovery = this.#processRestore(workspaceRoot, operation)
      .then((completed) => {
        if (completed.state === 'committed') {
          this.#scheduleDrain(workspaceRoot, completed.recordingId)
        }
      })
      .catch(() => {
        const timerKey = `restore-retry:${key}`
        if (this.#retryTimers.has(timerKey) || this.#disposed || !this.#enabled) return
        const timer = setTimeout(() => {
          this.#retryTimers.delete(timerKey)
          void this.#store.pendingRestore(workspaceRoot, operation.recordingId).then((pending) => {
            if (pending) this.#scheduleRestoreRecovery(workspaceRoot, pending)
          })
        }, Math.min(30_000, 500 * 2 ** Math.min(operation.attempts, 6)))
        timer.unref?.()
        this.#retryTimers.set(timerKey, timer)
      })
      .finally(() => {
        if (this.#restoreDrains.get(key) === recovery) this.#restoreDrains.delete(key)
      })
    this.#restoreDrains.set(key, recovery)
  }

  #clearRetryTimers(): void {
    for (const timer of this.#retryTimers.values()) clearTimeout(timer)
    this.#retryTimers.clear()
  }

  #ready(): DomainMainRuntimeLifecycleContext {
    if (!this.#context || this.#disposed) throw new Error('Research Checkpoints runtime is not active.')
    return this.#context
  }

  async #withCurrentEvidence(
    _workspaceRoot: string,
    status: ResearchCheckpointTurnStatusV1
  ): Promise<ResearchCheckpointTurnStatusV1> {
    if (status.state !== 'committed' || status.evidence.status === 'unavailable') return status
    // The current upstream Evidence owner does not expose an exact dossier-summary
    // contract. Fail closed instead of inferring trust from unrelated receipts.
    return withEvidenceStatus(status, 'unavailable')
  }

  async #threadBoundary(
    context: DomainMainRuntimeLifecycleContext,
    workspaceRoot: string,
    runtimeId: string,
    threadId: string
  ): Promise<Readonly<{ watermark: string; knownTurnIds: readonly string[] }>> {
    let detail
    try {
      detail = await context.agentThreads.read({ runtimeId, threadId })
    } catch (error) {
      throw new CheckpointRuntimeError(
        'not-found',
        `The durable chat thread could not be resolved: ${errorMessage(error)}`,
        false
      )
    }
    if (detail.id !== threadId || detail.runtimeId !== runtimeId) {
      throw new CheckpointRuntimeError(
        'scope-mismatch',
        'The durable chat thread resolved to another runtime or thread.',
        false
      )
    }
    if (!detail.workspaceRoot || !sameWorkspace(detail.workspaceRoot, workspaceRoot)) {
      throw new CheckpointRuntimeError(
        'scope-mismatch',
        'The durable chat thread does not belong to the caller workspace.',
        false
      )
    }
    return {
      watermark: detail.watermark,
      knownTurnIds: detail.turns.map((turn) => turn.id)
    }
  }
}

export class CheckpointRuntimeError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'CheckpointRuntimeError'
    this.code = code
    this.retryable = retryable
  }
}

class CheckpointTransientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckpointTransientError'
  }
}

function dependencyCandidates(
  manifest: ResearchCheckpointManifestV1,
  intraBatchCandidates: ReadonlyMap<string, string> = new Map()
): NonNullable<ArtifactVersionCommitCandidateV2['dependencies']> {
  const refs = new Map<string, ResearchCheckpointManifestV1['artifactDependencies'][number]['ref']>()
  for (const dependency of manifest.artifactDependencies) refs.set(dependency.ref.versionId, dependency.ref)
  for (const run of manifest.computeRuns) {
    if (run.specRef) refs.set(run.specRef.versionId, run.specRef)
    if (run.receiptRef) refs.set(run.receiptRef.versionId, run.receiptRef)
  }
  return [...refs.values()].map((ref, index) => ({
    role: `dependency-${String(index + 1).padStart(3, '0')}`,
    required: true,
    target: intraBatchCandidates.has(ref.versionId)
      ? { kind: 'candidate' as const, candidateId: intraBatchCandidates.get(ref.versionId)! }
      : { kind: 'version' as const, ref }
  }))
}

function checkpointMetadata(
  manifest: ResearchCheckpointManifestV1,
  manifestDigest: string
): ArtifactVersionCommitCandidateV2['metadata'] {
  return {
    researchCheckpointContractVersion: 1,
    researchRecordingId: manifest.recording.recordingId,
    researchOrigin: manifest.recording.origin,
    runtimeId: manifest.recording.runtimeId,
    threadId: manifest.recording.threadId,
    turnId: manifest.turn.turnId,
    targetWatermark: manifest.turn.targetWatermark,
    changeReason: manifest.changeReason,
    manifestDigest,
    executionOutcome: manifest.status.execution,
    provenanceStatus: manifest.status.provenance,
    controlLevel: manifest.status.control,
    replicationStatus: manifest.status.reproduction,
    evidenceStatus: manifest.status.evidence,
    breakpoints: manifest.breakpoints.map((item) => ({
      code: item.code,
      blocking: item.blocking,
      message: item.message
    }))
  }
}

function withEvidenceStatus(
  status: ResearchCheckpointCommittedTurnStatusV1,
  evidenceStatus: EvidenceStatus
): ResearchCheckpointCommittedTurnStatusV1 {
  return researchCheckpointCommittedTurnStatusV1Schema.parse({
    ...status,
    evidence: { status: evidenceStatus }
  })
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      output[index] = await mapper(values[index]!, index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return output
}

function sameArtifactRef(left: ArtifactVersionRefV1, right: ArtifactVersionRefV1): boolean {
  return left.artifactId === right.artifactId &&
    left.versionId === right.versionId &&
    left.contentDigest === right.contentDigest &&
    left.byteLength === right.byteLength &&
    left.mediaType === right.mediaType &&
    left.availability === right.availability &&
    left.retention === right.retention
}

function dedupeRefs(refs: readonly ArtifactVersionRefV1[]): ArtifactVersionRefV1[] {
  return [...new Map(refs.map((ref) => [ref.versionId, ref])).values()]
}

function sameWorkspace(left: string, right: string): boolean {
  return workspaceBindingDigest(left) === workspaceBindingDigest(right)
}

async function readScopedDurableThread(
  context: DomainMainRuntimeLifecycleContext,
  workspaceRoot: string,
  runtimeId: string,
  threadId: string
): Promise<DomainAgentThreadDetail> {
  const detail = await context.agentThreads.read({ runtimeId, threadId })
  if (detail.id !== threadId || detail.runtimeId !== runtimeId) {
    throw new CheckpointRuntimeError(
      'scope-mismatch',
      'Durable transcript resolved to another runtime or thread.',
      false
    )
  }
  if (!detail.workspaceRoot || !sameWorkspace(detail.workspaceRoot, workspaceRoot)) {
    throw new CheckpointRuntimeError(
      'scope-mismatch',
      'Durable transcript does not belong to the caller workspace.',
      false
    )
  }
  return detail
}

function durableTranscriptProjection(turns: readonly DomainAgentThreadTurn[]) {
  return turns.map((turn) => ({
    id: turn.id,
    ...(turn.status ? { status: turn.status } : {}),
    ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
    artifacts: turn.artifacts
  }))
}

function durableTranscriptDigest(turns: readonly DomainAgentThreadTurn[]): string {
  return sha256(canonicalJson(durableTranscriptProjection(turns)))
}

function normalizeDurableTurnBoundarySnapshot(
  snapshot: DomainMainDurableTurnBoundarySnapshot
): DomainMainDurableTurnBoundarySnapshot {
  return {
    ...snapshot,
    owners: snapshot.owners.map((owner) => {
      const workspaceRoot = owner.workspaceRoot?.trim()
      if (workspaceRoot) return { ...owner, workspaceRoot }
      const { workspaceRoot: _workspaceRoot, ...unbound } = owner
      return unbound
    })
  }
}

function durableTurnSummary(artifacts: readonly unknown[]): string {
  const narrative = artifacts.flatMap((value) => {
    const item = record(value)
    if (!item) return []
    const kind = stringValue(item.kind)
    const text = stringValue(item.text)
    return text && (kind === 'user_message' || kind === 'assistant_message') ? [text] : []
  })
  const compact = narrative.join(' · ').replace(/\s+/gu, ' ').trim()
  if (!compact) return 'Completed turn without a durable narrative preview.'
  return compact.length <= 600 ? compact : `${compact.slice(0, 599)}…`
}

function isCompletedDurableTurn(status?: string): boolean {
  return status === 'completed'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function checkpointErrorResult(error: unknown): Readonly<{
  code: 'invalid-input' | 'not-found' | 'scope-mismatch' | 'recording-stopped' |
    'stale-conflict' | 'artifact-unavailable' | 'content-mismatch' | 'io-failure' | 'internal'
  message: string
  retryable: boolean
}> {
  if (error instanceof CheckpointRuntimeError) {
    return {
      code: allowedErrorCode(error.code),
      message: error.message,
      retryable: error.retryable
    }
  }
  if (error instanceof CheckpointStoreError) {
    return { code: error.code, message: error.message, retryable: false }
  }
  return {
    code: 'internal',
    message: errorMessage(error),
    retryable: false
  }
}

function allowedErrorCode(value: string): ReturnType<typeof checkpointErrorResult>['code'] {
  const allowed = new Set([
    'invalid-input',
    'not-found',
    'scope-mismatch',
    'recording-stopped',
    'stale-conflict',
    'artifact-unavailable',
    'content-mismatch',
    'io-failure',
    'internal'
  ])
  return allowed.has(value)
    ? value as ReturnType<typeof checkpointErrorResult>['code']
    : 'internal'
}
