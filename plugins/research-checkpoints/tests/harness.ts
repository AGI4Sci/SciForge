/**
 * Shared test harness copied verbatim from the static
 * `packages/domains/research-checkpoints/src/main/runtime.test.ts` (only
 * `export` keywords added). The ported runtime.test.ts stays self-contained;
 * this module serves the baseline scenario and any future scenario tests.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitResultV1,
  type ArtifactVersionCommitInputV2,
  type ArtifactVersionCommitResultV2,
  type ArtifactVersionObserveInputV1,
  type ArtifactVersionRestoreAsNewInputV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { GIT_CHECKPOINTS_CAPABILITY_IDS } from '@sciforge/domain-git-checkpoints/contract'
import type {
  DomainAgentThreadTurn,
  DomainMainBeforeTurnEvent,
  DomainMainDurableTurnBoundarySnapshot,
  DomainMainRuntimeLifecycleContext,
  DomainMainTurnLifecycleEvent,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'

export const accessPolicy = { visibility: 'workspace' as const, principals: [], allowExport: true }
export const TEST_ISSUER_EPOCH = 'test-issuer-epoch'

export function emptyBoundarySnapshot() {
  return {
    issuerEpoch: TEST_ISSUER_EPOCH,
    nextDeliveryAttemptOrdinal: 1,
    retiredThroughOrdinal: 0,
    retiredOrdinalRanges: [],
    owners: []
  } as const
}

export function boundarySnapshotForEvents(
  events: readonly DomainTurnArtifactEvent[]
): DomainMainDurableTurnBoundarySnapshot {
  const owners = events.map((event) => ({
    issuerEpoch: event.issuerEpoch ?? TEST_ISSUER_EPOCH,
    deliveryAttemptOrdinal: event.deliveryAttemptOrdinal ?? assert.fail('missing attempt ordinal'),
    boundaryLeaseId: event.boundaryLeaseId ?? assert.fail('missing boundary lease'),
    deliveryAttemptId: event.deliveryAttemptId ?? assert.fail('missing delivery attempt'),
    runtimeId: event.runtimeId,
    threadId: event.threadId,
    clientDirectiveId: event.clientDirectiveId ?? assert.fail('missing client directive'),
    ...(event.workspaceRoot ? { workspaceRoot: event.workspaceRoot } : {}),
    phase: 'completed-intent' as const,
    turnId: event.turnId,
    occurredAt: event.occurredAt
  }))
  const nextDeliveryAttemptOrdinal = Math.max(
    1,
    ...owners.map((owner) => owner.deliveryAttemptOrdinal + 1)
  )
  const ownerOrdinals = new Set(owners.map((owner) => owner.deliveryAttemptOrdinal))
  const retiredOrdinalRanges: Array<{ first: number, last: number }> = []
  for (let ordinal = 1; ordinal < nextDeliveryAttemptOrdinal; ordinal += 1) {
    if (ownerOrdinals.has(ordinal)) continue
    const previous = retiredOrdinalRanges.at(-1)
    if (previous?.last === ordinal - 1) previous.last = ordinal
    else retiredOrdinalRanges.push({ first: ordinal, last: ordinal })
  }
  return {
    issuerEpoch: TEST_ISSUER_EPOCH,
    nextDeliveryAttemptOrdinal,
    retiredThroughOrdinal: retiredOrdinalRanges[0]?.first === 1
      ? retiredOrdinalRanges[0].last
      : 0,
    retiredOrdinalRanges,
    owners
  }
}

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function turnEvent(
  workspaceRoot: string,
  turnId: string,
  sequence: number,
  withFile = false,
  occurredAt = `2099-08-11T08:00:0${sequence}.000Z`
): DomainTurnArtifactEvent {
  return {
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId,
    issuerEpoch: TEST_ISSUER_EPOCH,
    deliveryAttemptOrdinal: Math.max(1, sequence),
    boundaryLeaseId: `directive-${turnId}`,
    deliveryAttemptId: `directive-${turnId}`,
    clientDirectiveId: `directive-${turnId}`,
    targetWatermark: `wm-${sequence}`,
    sequence,
    workspaceRoot,
    occurredAt,
    artifacts: [
      { kind: 'user_message', text: `request ${turnId}` },
      { kind: 'assistant_message', text: `result ${turnId}` },
      ...(withFile ? [{
        kind: 'tool',
        itemId: `file-change-${turnId}`,
        toolKind: 'file_change',
        status: 'success',
        summary: 'File changes',
        detail: JSON.stringify([{ path: 'reports/result.md', kind: sequence === 1 ? 'add' : 'update' }])
      }] : [])
    ]
  }
}

export function completedThreadTurn(event: DomainTurnArtifactEvent): DomainAgentThreadTurn {
  return {
    id: event.turnId,
    status: 'completed',
    completedAt: event.occurredAt,
    messages: [],
    artifacts: event.artifacts
  }
}

export function turnEventWithExactOutputs(
  workspaceRoot: string,
  turnId: string,
  sequence: number,
  outputs: readonly Readonly<{
    path: string
    bytes: string
    kind?: 'created' | 'modified'
    priorBytes?: string
    patches?: readonly Readonly<{
      operation: 'add' | 'update'
      patchFormat: 'full-content' | 'unified-hunks'
      patchText: string
    }>[]
  }>[]
): DomainTurnArtifactEvent {
  const occurredAt = `2099-08-11T08:00:${String(sequence).padStart(2, '0')}.000Z`
  const clientDirectiveId = `directive-${turnId}`
  const filePatchReceipts = outputs.flatMap((output, outputIndex) => {
    const patches = output.patches ?? (output.kind === 'modified'
      ? [{
          operation: 'update' as const,
          patchFormat: 'unified-hunks' as const,
          patchText: wholeFileUpdateHunk(output.priorBytes ?? '', output.bytes)
        }]
      : [{
          operation: 'add' as const,
          patchFormat: 'full-content' as const,
          patchText: output.bytes
        }])
    return patches.map((patch, patchIndex) => ({
      contractVersion: 1 as const,
      kind: 'host-authenticated-file-patch' as const,
      issuer: 'sciforge.agent-runtime-host' as const,
      source: 'codex-app-server-file-change' as const,
      callId: `file-change-${turnId}-${outputIndex + 1}-${patchIndex + 1}`,
      executorSequence: outputIndex * 100 + patchIndex + 1,
      path: output.path,
      operation: patch.operation,
      patchFormat: patch.patchFormat,
      patchText: patch.patchText,
      patchDigest: digest(patch.patchText)
    }))
  })
  return {
    ...turnEvent(workspaceRoot, turnId, sequence, false, occurredAt),
    clientDirectiveId,
    artifacts: [
      { kind: 'user_message', text: `request ${turnId}` },
      { kind: 'assistant_message', text: `result ${turnId}` },
      ...filePatchReceipts.map((receipt) => ({
        kind: 'tool',
        itemId: receipt.callId,
        toolKind: 'file_change',
        status: 'success',
        summary: 'File changes',
        detail: JSON.stringify([{ path: receipt.path, kind: receipt.operation }])
      }))
    ],
    fileEffects: {
      contractVersion: 1,
      capture: 'host-turn-boundary',
      baselineDigest: digest(`baseline-${sequence}`),
      baselineCapturedAt: '2099-08-11T07:59:00.000Z',
      terminalCapturedAt: occurredAt,
      effects: outputs.map((output) => {
        const bytes = Buffer.from(output.bytes)
        return {
          contractVersion: 1 as const,
          kind: output.kind ?? 'created' as const,
          path: output.path,
          contentDigest: digest(bytes),
          byteLength: bytes.byteLength,
          mediaType: output.path.endsWith('.png') ? 'image/png' : 'text/csv',
          dataBase64: bytes.toString('base64')
        }
      }),
      issues: []
    },
    filePatchReceipts
  }
}

export function wholeFileUpdateHunk(prior: string, next: string): string {
  const oldLines = prior.endsWith('\n') ? prior.slice(0, -1).split('\n') : prior ? prior.split('\n') : []
  const newLines = next.endsWith('\n') ? next.slice(0, -1).split('\n') : next ? next.split('\n') : []
  const lines = [`@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`]
  oldLines.forEach((line, index) => {
    lines.push(`-${line}`)
    if (index === oldLines.length - 1 && !prior.endsWith('\n')) lines.push('\\ No newline at end of file')
  })
  newLines.forEach((line, index) => {
    lines.push(`+${line}`)
    if (index === newLines.length - 1 && !next.endsWith('\n')) lines.push('\\ No newline at end of file')
  })
  return lines.join('\n')
}

export async function publishExactOutputBoundary(
  lifecycle: RuntimeTestContext,
  event: DomainTurnArtifactEvent
): Promise<void> {
  assert.ok(event.clientDirectiveId)
  assert.ok(event.issuerEpoch)
  assert.ok(event.deliveryAttemptOrdinal)
  await lifecycle.publishRequiredBeforeTurn({
    kind: 'before-turn',
    state: 'starting',
    boundaryLeaseId: event.boundaryLeaseId ?? event.clientDirectiveId,
    deliveryAttemptId: event.deliveryAttemptId ?? event.clientDirectiveId,
    issuerEpoch: event.issuerEpoch,
    deliveryAttemptOrdinal: event.deliveryAttemptOrdinal,
    runtimeId: event.runtimeId,
    threadId: event.threadId,
    clientDirectiveId: event.clientDirectiveId,
    workspaceRoot: event.workspaceRoot,
    occurredAt: event.occurredAt
  })
}

export class ArtifactHarness {
  readonly commitInputs: ArtifactVersionCommitInputV2[] = []
  readonly observeInputs: ArtifactVersionObserveInputV1[] = []
  readonly restoreInputs: ArtifactVersionRestoreAsNewInputV1[] = []
  readonly refsByIdempotency = new Map<string, ArtifactVersionRefV1>()
  readonly commitInputByIdempotency = new Map<string, ArtifactVersionCommitInputV2>()
  readonly observeInputByIdempotency = new Map<string, ArtifactVersionObserveInputV1>()
  readonly restoreInputByIdempotency = new Map<string, ArtifactVersionRestoreAsNewInputV1>()
  readonly #results = new Map<string, ArtifactVersionCommitResultV2>()
  readonly #versionBytes = new Map<string, Buffer>()
  readonly #versionRefs = new Map<string, ArtifactVersionRefV1>()
  readonly #artifacts = new Map<string, Readonly<{
    currentVersionId: string
    versionCount: number
    ref: ArtifactVersionRefV1
  }>>()
  readonly versionParents = new Map<string, string | undefined>()
  readonly readVersionIds: string[] = []
  checkpointResponseLossesRemaining = 0
  outputSnapshotResponseLossAtCommitNumber: number | null = null
  outputSnapshotCommitCount = 0
  outputSnapshotResponseLossCount = 0
  restoreResponseLossesRemaining = 0
  restoreResponseLossCount = 0
  restoreInvocationCount = 0
  observeResponseLossesRemaining = 0
  observeIoFailuresRemaining = 0
  checkpointIoFailuresRemaining = 0
  checkpointResponseLossCount = 0
  observeResponseLossCount = 0
  checkpointGate: Promise<void> | null = null
  checkpointCommitStarted = false
  rejectNextAtomicBatch: ArtifactVersionCommitResultV2 | null = null
  staleNextAtomicBatch = false
  gitListCallCount = 0
  failGitAfterFirst = false
  #sequence = 0

  releaseCheckpointGate(): void {
    this.checkpointGate = null
  }

  async invoke(actionId: string, raw: unknown): Promise<unknown> {
    if (actionId === GIT_CHECKPOINTS_CAPABILITY_IDS.list) {
      this.gitListCallCount += 1
      return this.failGitAfterFirst && this.gitListCallCount > 1
        ? { ok: false, reason: 'temporarily-unavailable', message: 'Git projection changed after commit.' }
        : { ok: true, value: [] }
    }
    if (actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.observe) {
      return this.#observe(raw as ArtifactVersionObserveInputV1)
    }
    if (actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2) {
      return this.#commit(raw as ArtifactVersionCommitInputV2)
    }
    if (actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.read) {
      const input = raw as { versionId: string; maxBytes?: number }
      this.readVersionIds.push(input.versionId)
      const bytes = this.#versionBytes.get(input.versionId)
      const ref = this.#versionRefs.get(input.versionId)
      if (!bytes || !ref) return { ok: false, issue: { code: 'version-not-found', message: 'mock version missing' } }
      if (input.maxBytes !== undefined && bytes.byteLength > input.maxBytes) {
        return { ok: false, issue: { code: 'invalid-input', message: 'mock version exceeds max bytes' } }
      }
      return {
        ok: true,
        value: {
          artifact: {
            artifactId: ref.artifactId,
            kind: 'research-checkpoint',
            createdAt: '2026-08-11T08:00:00.000Z',
            updatedAt: '2026-08-11T08:00:00.000Z',
            currentVersionId: ref.versionId,
            versionCount: 1
          },
          version: {
            schemaVersion: 1,
            versionId: ref.versionId,
            artifactId: ref.artifactId,
            sequence: 1,
            transactionId: 'artifact-commit:mock-read',
            createdAt: '2026-08-11T08:00:00.000Z',
            intent: 'save',
            storage: {
              mode: 'snapshot',
              contentDigest: ref.contentDigest,
              byteLength: ref.byteLength,
              ...(ref.mediaType ? { mediaType: ref.mediaType } : {})
            },
            dependencies: [],
            accessPolicy: ref.accessPolicy,
            metadata: {}
          },
          ref,
          dataBase64: bytes.toString('base64')
        }
      }
    }
    if (actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew) {
      return this.#restore(raw as ArtifactVersionRestoreAsNewInputV1)
    }
    if (actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2) {
      const input = raw as { artifactId?: string }
      const state = input.artifactId ? this.#artifacts.get(input.artifactId) : undefined
      return {
        ok: true,
        value: {
          items: state ? [{
            artifact: {
              artifactId: state.ref.artifactId,
              kind: 'research-checkpoint',
              createdAt: '2026-08-11T08:00:00.000Z',
              updatedAt: '2026-08-11T08:00:00.000Z',
              currentVersionId: state.currentVersionId,
              versionCount: state.versionCount
            },
            version: {},
            ref: state.ref,
            artifactOrdinal: state.versionCount,
            isCurrent: true
          }] : []
        }
      }
    }
    throw new Error(`Unexpected capability: ${actionId}`)
  }

  async #observe(input: ArtifactVersionObserveInputV1): Promise<ArtifactVersionCommitResultV1> {
    this.observeInputs.push(structuredClone(input))
    const frozenInput = this.observeInputByIdempotency.get(input.idempotencyKey)
    if (frozenInput) assert.deepEqual(input, frozenInput)
    else this.observeInputByIdempotency.set(input.idempotencyKey, structuredClone(input))
    if (this.observeIoFailuresRemaining > 0) {
      this.observeIoFailuresRemaining -= 1
      return { ok: false, issue: { code: 'io-failure', message: 'temporary observe outage' } }
    }
    const replay = this.#results.get(input.idempotencyKey)
    if (replay) return replayResult(replay) as ArtifactVersionCommitResultV1
    const artifactId = input.artifactId ?? `artifact:file-${digest(input.path).slice(0, 16)}`
    const result = this.#result({
      idempotencyKey: input.idempotencyKey,
      candidateId: input.candidateId,
      artifactId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      kind: input.kind,
      contentDigest: digest(`observed:${input.path}`),
      byteLength: 24,
      mediaType: input.mediaType ?? 'application/octet-stream',
      intent: 'observe'
    })
    this.#results.set(input.idempotencyKey, result)
    this.refsByIdempotency.set(input.idempotencyKey, result.ok ? result.value.versions[0]!.ref : assert.fail())
    if (this.observeResponseLossesRemaining > 0) {
      this.observeResponseLossesRemaining -= 1
      this.observeResponseLossCount += 1
      throw new Error('observe response lost after commit')
    }
    return result
  }

  async #commit(input: ArtifactVersionCommitInputV2): Promise<ArtifactVersionCommitResultV2> {
    this.commitInputs.push(structuredClone(input))
    const frozenInput = this.commitInputByIdempotency.get(input.idempotencyKey)
    if (frozenInput) assert.deepEqual(input, frozenInput)
    else this.commitInputByIdempotency.set(input.idempotencyKey, structuredClone(input))
    const replay = this.#results.get(input.idempotencyKey)
    if (replay) return replayResult(replay) as ArtifactVersionCommitResultV1
    if (this.rejectNextAtomicBatch) {
      const rejected = this.rejectNextAtomicBatch
      this.rejectNextAtomicBatch = null
      return rejected
    }
    if (this.staleNextAtomicBatch) {
      this.staleNextAtomicBatch = false
      return {
        ok: false,
        issue: { code: 'stale-base', message: 'A workspace output current advanced concurrently.' }
      }
    }
    const isOutputSnapshot = input.candidates.some((candidate) => (
      candidate.kind === 'research-output' || candidate.kind === 'research-file'
    ))
    if (isOutputSnapshot) this.outputSnapshotCommitCount += 1
    if (input.candidates.some((candidate) => candidate.kind === 'research-checkpoint')) {
      this.checkpointCommitStarted = true
      const gate = this.checkpointGate
      if (gate) await gate
      if (this.checkpointIoFailuresRemaining > 0) {
        this.checkpointIoFailuresRemaining -= 1
        return { ok: false, issue: { code: 'io-failure', message: 'temporary checkpoint outage' } }
      }
    }
    const result = this.#batchResult(input)
    this.#results.set(input.idempotencyKey, result)
    this.refsByIdempotency.set(input.idempotencyKey, result.ok ? result.value.versions[0]!.ref : assert.fail())
    if (
      isOutputSnapshot &&
      this.outputSnapshotResponseLossAtCommitNumber === this.outputSnapshotCommitCount
    ) {
      this.outputSnapshotResponseLossCount += 1
      throw new Error('output snapshot response lost after commit')
    }
    if (input.candidates.some((candidate) => candidate.kind === 'research-checkpoint') && this.checkpointResponseLossesRemaining > 0) {
      this.checkpointResponseLossesRemaining -= 1
      this.checkpointResponseLossCount += 1
      throw new Error('checkpoint response lost after commit')
    }
    return result
  }

  #batchResult(input: ArtifactVersionCommitInputV2): ArtifactVersionCommitResultV2 {
    const snapshots = input.candidates.map((candidate) => {
      const artifactId = candidate.artifactId ?? candidate.requestedArtifactId ?? `artifact:${candidate.candidateId}`
      const previous = this.#artifacts.get(artifactId)
      if (previous && previous.currentVersionId !== candidate.expectedCurrentVersionId) {
        return { issue: { code: 'stale-base' as const, message: 'mock current changed' } }
      }
      if (!previous && candidate.expectedCurrentVersionId !== null) {
        return { issue: { code: 'stale-base' as const, message: 'mock artifact is new' } }
      }
      const bytes = candidate.content.mode === 'snapshot'
        ? Buffer.from(candidate.content.dataBase64, 'base64')
        : Buffer.from(candidate.candidateId)
      const mediaType = candidate.content.mode === 'staged-object'
        ? candidate.content.stagedObject.mediaType
        : candidate.content.mediaType
      return { candidate, artifactId, previous, bytes, mediaType }
    })
    const failed = snapshots.find((item) => 'issue' in item)
    if (failed && 'issue' in failed && failed.issue) return { ok: false, issue: failed.issue }
    const transactionSequence = ++this.#sequence
    const transactionId = `artifact-commit:${transactionSequence}`
    const timestamp = `2026-08-11T09:00:${String(transactionSequence).padStart(2, '0')}.000Z`
    const versions = snapshots.map((snapshot) => {
      if ('issue' in snapshot) assert.fail('failed snapshot escaped batch validation')
      const { candidate, artifactId, previous, bytes, mediaType } = snapshot
      const candidateAccessPolicy = candidate.accessPolicy ?? accessPolicy
      const ordinal = (previous?.versionCount ?? 0) + 1
      const versionId = candidate.requestedVersionId ??
        `artifact-version:${digest(`${artifactId}:${ordinal}`).slice(0, 24)}`
      const ref: ArtifactVersionRefV1 = {
        artifactId,
        versionId,
        contentDigest: digest(bytes),
        byteLength: bytes.byteLength,
        mediaType: mediaType ?? 'application/octet-stream',
        availability: 'available',
        retention: 'snapshot',
        accessPolicy: candidateAccessPolicy
      }
      this.#artifacts.set(artifactId, { currentVersionId: versionId, versionCount: ordinal, ref })
      this.#versionBytes.set(versionId, Buffer.from(bytes))
      this.#versionRefs.set(versionId, ref)
      this.versionParents.set(versionId, previous?.currentVersionId)
      return {
        candidateId: candidate.candidateId,
        artifact: {
          artifactId,
          kind: candidate.kind,
          createdAt: previous ? '2026-08-11T09:00:01.000Z' : timestamp,
          updatedAt: timestamp,
          currentVersionId: versionId,
          versionCount: ordinal
        },
        version: {
          schemaVersion: 1 as const,
          versionId,
          artifactId,
          ...(previous ? { parentVersionId: previous.currentVersionId } : {}),
          sequence: ++this.#sequence,
          transactionId,
          createdAt: timestamp,
          intent: candidate.intent,
          storage: {
            mode: 'snapshot' as const,
            contentDigest: digest(bytes),
            byteLength: bytes.byteLength,
            mediaType: mediaType ?? 'application/octet-stream'
          },
          dependencies: [],
          accessPolicy: candidateAccessPolicy,
          metadata: candidate.metadata ?? {}
        },
        ref
      }
    })
    return { ok: true, value: { transactionId, committedAt: timestamp, idempotentReplay: false, versions, events: [] } }
  }

  async #restore(input: ArtifactVersionRestoreAsNewInputV1): Promise<ArtifactVersionCommitResultV1> {
    this.restoreInvocationCount += 1
    this.restoreInputs.push(structuredClone(input))
    const frozenInput = this.restoreInputByIdempotency.get(input.idempotencyKey)
    if (frozenInput) assert.deepEqual(input, frozenInput)
    else this.restoreInputByIdempotency.set(input.idempotencyKey, structuredClone(input))
    const replay = this.#results.get(input.idempotencyKey)
    if (replay) return replayResult(replay) as ArtifactVersionCommitResultV1
    const source = [...this.refsByIdempotency.values()].find((ref) => ref.versionId === input.sourceVersionId)
    if (!source) return { ok: false, issue: { code: 'version-not-found', message: 'mock restore source missing' } }
    const sourceBytes = this.#versionBytes.get(input.sourceVersionId)
    if (!sourceBytes) return { ok: false, issue: { code: 'version-not-found', message: 'mock restore bytes missing' } }
    const result = this.#result({
      idempotencyKey: input.idempotencyKey,
      candidateId: `restore:${input.sourceVersionId}`,
      artifactId: input.artifactId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      kind: 'research-checkpoint',
      contentDigest: source.contentDigest,
      byteLength: source.byteLength,
      mediaType: source.mediaType ?? 'application/octet-stream',
      intent: 'restore',
      metadata: {
        ...(input.metadata ?? {}),
        restoredFromVersionId: input.sourceVersionId
      },
      accessPolicy: source.accessPolicy
    })
    this.#results.set(input.idempotencyKey, result)
    if (result.ok) {
      const restored = result.value.versions[0]!.ref
      this.refsByIdempotency.set(input.idempotencyKey, restored)
      this.#versionBytes.set(restored.versionId, Buffer.from(sourceBytes))
      this.#versionRefs.set(restored.versionId, restored)
    }
    if (result.ok && this.restoreResponseLossesRemaining > 0) {
      this.restoreResponseLossesRemaining -= 1
      this.restoreResponseLossCount += 1
      throw new Error('restore response lost after Artifact commit')
    }
    return result
  }

  #result(input: Readonly<{
    idempotencyKey: string
    candidateId: string
    artifactId: string
    expectedCurrentVersionId: string | null
    kind: string
    contentDigest: string
    byteLength: number
    mediaType: string
    intent: 'save' | 'observe' | 'rerun' | 'restore' | 'import' | 'publish'
    metadata?: Record<string, DomainPackageJsonValue>
    accessPolicy?: ArtifactVersionRefV1['accessPolicy']
  }>): ArtifactVersionCommitResultV1 {
    const previous = this.#artifacts.get(input.artifactId)
    if (previous && previous.currentVersionId !== input.expectedCurrentVersionId) {
      return { ok: false, issue: { code: 'stale-base', message: 'mock current changed' } }
    }
    if (!previous && input.expectedCurrentVersionId !== null) {
      return { ok: false, issue: { code: 'stale-base', message: 'mock artifact is new' } }
    }
    const ordinal = (previous?.versionCount ?? 0) + 1
    const sequence = ++this.#sequence
    const versionId = `artifact-version:${digest(`${input.artifactId}:${ordinal}`).slice(0, 24)}`
    const transactionId = `artifact-commit:${sequence}`
    const timestamp = `2026-08-11T09:00:${String(sequence).padStart(2, '0')}.000Z`
    const ref: ArtifactVersionRefV1 = {
      artifactId: input.artifactId,
      versionId,
      contentDigest: input.contentDigest,
      byteLength: input.byteLength,
      mediaType: input.mediaType,
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: input.accessPolicy ?? accessPolicy
    }
    this.#artifacts.set(input.artifactId, { currentVersionId: versionId, versionCount: ordinal, ref })
    this.versionParents.set(versionId, previous?.currentVersionId)
    return {
      ok: true,
      value: {
        transactionId,
        committedAt: timestamp,
        idempotentReplay: false,
        versions: [{
          candidateId: input.candidateId,
          artifact: {
            artifactId: input.artifactId,
            kind: input.kind,
            createdAt: previous ? '2026-08-11T09:00:01.000Z' : timestamp,
            updatedAt: timestamp,
            currentVersionId: versionId,
            versionCount: ordinal
          },
          version: {
            schemaVersion: 1,
            versionId,
            artifactId: input.artifactId,
            ...(previous ? { parentVersionId: previous.currentVersionId } : {}),
            sequence,
            transactionId,
            createdAt: timestamp,
            intent: input.intent,
            storage: {
              mode: 'snapshot',
              contentDigest: input.contentDigest,
              byteLength: input.byteLength,
              mediaType: input.mediaType
            },
            dependencies: [],
            accessPolicy: input.accessPolicy ?? accessPolicy,
            metadata: input.metadata ?? {}
          },
          ref
        }],
        events: []
      }
    }
  }
}

export function replayResult(result: ArtifactVersionCommitResultV2): ArtifactVersionCommitResultV2 {
  return result.ok
    ? { ok: true, value: { ...result.value, idempotentReplay: true } }
    : result
}

export type RuntimeTestContext = DomainMainRuntimeLifecycleContext & Readonly<{
  publishRequiredBeforeTurn: (event: Omit<DomainMainBeforeTurnEvent,
    'issuerEpoch' | 'deliveryAttemptOrdinal'> & Partial<Pick<DomainMainBeforeTurnEvent,
      'issuerEpoch' | 'deliveryAttemptOrdinal'>>) => Promise<void>
  publishTurnLifecycle: (event: Readonly<{
    kind: 'after-turn'
    state: 'completed' | 'failed' | 'cancelled' | 'rejected'
    boundaryLeaseId: string
    deliveryAttemptId: string
    clientDirectiveId?: string
    runtimeId: string
    threadId: string
    workspaceRoot?: string
    occurredAt: string
    turnId?: string
    issuerEpoch?: string
    deliveryAttemptOrdinal?: number
  }>) => Promise<void>
}>

export function context(
  userDataDir: string,
  workspaceRoot: string,
  harness: ArtifactHarness,
  turns: DomainAgentThreadTurn[],
  durableBoundarySnapshot: DomainMainDurableTurnBoundarySnapshot = emptyBoundarySnapshot()
): RuntimeTestContext {
  const requiredBeforeTurnListeners = new Set<
    (event: DomainMainBeforeTurnEvent) => void | Promise<void>
  >()
  const turnLifecycleListeners = new Set<
    (event: DomainMainTurnLifecycleEvent) => void | Promise<void>
  >()
  const boundaryIdentities = new Map<string, Readonly<{
    issuerEpoch: string
    deliveryAttemptOrdinal: number
  }>>()
  let nextDeliveryAttemptOrdinal = 1
  return {
    owner: { moduleId: 'sciforge.research-checkpoints', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    userDataDir,
    appRoot: '/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async ({ runtimeId, threadId }) => {
        if (runtimeId !== 'codex' || threadId !== 'thread-1') throw new Error('thread not found')
        return {
          id: 'thread-1',
          runtimeId: 'codex',
          workspaceRoot,
          watermark: `thread-wm-${turns.length}`,
          turns: [...turns],
          artifacts: []
        }
      },
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    turnEvents: {
      subscribe: (listener) => {
        turnLifecycleListeners.add(listener)
        return () => { turnLifecycleListeners.delete(listener) }
      },
      subscribeRequiredBeforeTurn: (listener) => {
        requiredBeforeTurnListeners.add(listener)
        return () => { requiredBeforeTurnListeners.delete(listener) }
      },
      readDurableTurnBoundarySnapshot: async () => durableBoundarySnapshot
    },
    capabilities: {
      invoke: ((contract: { actionId: string }, input: unknown) =>
        harness.invoke(contract.actionId, input)) as never,
      createApprovedBatch: () => {
        throw new Error('Unexpected approved capability batch.')
      }
    },
    modelAccess: { textReasoner: async () => null },
    executionEvents: { publish: async () => { throw new Error('unexpected execution event') } },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined,
    publishRequiredBeforeTurn: async (event) => {
      const deliveryAttemptOrdinal = event.deliveryAttemptOrdinal ?? nextDeliveryAttemptOrdinal
      nextDeliveryAttemptOrdinal = Math.max(nextDeliveryAttemptOrdinal, deliveryAttemptOrdinal + 1)
      const exact = {
        ...event,
        issuerEpoch: event.issuerEpoch ?? TEST_ISSUER_EPOCH,
        deliveryAttemptOrdinal
      } as DomainMainBeforeTurnEvent
      boundaryIdentities.set(event.boundaryLeaseId, exact)
      for (const listener of requiredBeforeTurnListeners) await listener(exact)
    },
    publishTurnLifecycle: async (event) => {
      const boundary = boundaryIdentities.get(event.boundaryLeaseId)
      const exact = {
        ...event,
        issuerEpoch: event.issuerEpoch ?? boundary?.issuerEpoch ?? TEST_ISSUER_EPOCH,
        deliveryAttemptOrdinal: event.deliveryAttemptOrdinal ??
          boundary?.deliveryAttemptOrdinal ?? nextDeliveryAttemptOrdinal++
      } as DomainMainTurnLifecycleEvent
      for (const listener of turnLifecycleListeners) await listener(exact)
    }
  }
}

export async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
