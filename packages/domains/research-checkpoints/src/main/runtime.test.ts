import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionListResultV2Schema,
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
import { researchCheckpointRecordV1Schema } from '../contract.js'
import { canonicalJson, workspaceBindingDigest } from './crypto.js'
import {
  createArtifactVersionsCapabilityTestHarness,
  type ArtifactVersionsCapabilityTestHarness
} from './artifact-versions-capability-test-harness.js'
import { extractCheckpointFromTurn } from './extract.js'
import { ResearchCheckpointRuntime } from './runtime.js'
import { ResearchCheckpointStore } from './store.js'

const accessPolicy = { visibility: 'workspace' as const, principals: [], allowExport: true }
const TEST_ISSUER_EPOCH = 'test-issuer-epoch'

function emptyBoundarySnapshot() {
  return {
    issuerEpoch: TEST_ISSUER_EPOCH,
    nextDeliveryAttemptOrdinal: 1,
    retiredThroughOrdinal: 0,
    retiredOrdinalRanges: [],
    owners: []
  } as const
}

function boundarySnapshotForEvents(
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

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function turnEvent(
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

function completedThreadTurn(event: DomainTurnArtifactEvent): DomainAgentThreadTurn {
  return {
    id: event.turnId,
    status: 'completed',
    completedAt: event.occurredAt,
    messages: [],
    artifacts: event.artifacts
  }
}

function turnEventWithExactOutputs(
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

function wholeFileUpdateHunk(prior: string, next: string): string {
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

async function publishExactOutputBoundary(
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

class ArtifactHarness {
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

function replayResult(result: ArtifactVersionCommitResultV2): ArtifactVersionCommitResultV2 {
  return result.ok
    ? { ok: true, value: { ...result.value, idempotentReplay: true } }
    : result
}

type RuntimeTestContext = DomainMainRuntimeLifecycleContext & Readonly<{
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

function context(
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
        harness.invoke(contract.actionId, input)) as never
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

function realArtifactContext(
  userDataDir: string,
  workspaceRoot: string,
  artifactVersions: ArtifactVersionsCapabilityTestHarness,
  turns: DomainAgentThreadTurn[]
): RuntimeTestContext {
  const base = context(userDataDir, workspaceRoot, new ArtifactHarness(), turns)
  return {
    ...base,
    capabilities: {
      invoke: async (contract, input, options) => {
        if (contract.actionId === GIT_CHECKPOINTS_CAPABILITY_IDS.list) {
          return contract.outputSchema.parse({ ok: true, value: [] })
        }
        return artifactVersions.invoker.invoke(contract, input, {
          ...options,
          workspaceId: options?.workspaceId ?? workspaceRoot
        })
      }
    }
  }
}

async function startAtCurrentPolicy(
  runtime: ResearchCheckpointRuntime,
  workspaceRoot: string,
  input: Omit<Parameters<ResearchCheckpointRuntime['start']>[1], 'expectedPolicyRevision'>
) {
  const status = await runtime.checkpointStatus(workspaceRoot, input.runtimeId, input.threadId)
  return runtime.start(workspaceRoot, {
    ...input,
    expectedPolicyRevision: status.policyRevision
  })
}

async function stopAtCurrentPolicy(
  runtime: ResearchCheckpointRuntime,
  workspaceRoot: string,
  input: Omit<Parameters<ResearchCheckpointRuntime['stop']>[1], 'expectedPolicyRevision'>
) {
  const status = await runtime.checkpointStatus(workspaceRoot, input.runtimeId, input.threadId)
  return runtime.stop(workspaceRoot, {
    ...input,
    expectedPolicyRevision: status.policyRevision
  })
}

test('required before-turn boundary automatically records new work without importing history', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-automatic-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const oldTurn: DomainAgentThreadTurn = {
      id: 'turn-before-automatic-recording',
      status: 'completed',
      completedAt: '2020-01-01T00:00:00.000Z',
      messages: [],
      artifacts: []
    }
    const turns: DomainAgentThreadTurn[] = [oldTurn]
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate(lifecycle)

    await lifecycle.publishRequiredBeforeTurn({
      kind: 'before-turn',
      state: 'starting',
      boundaryLeaseId: 'directive-turn-first-automatic',
      deliveryAttemptId: 'directive-turn-first-automatic',
      clientDirectiveId: 'directive-turn-first-automatic',
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspaceRoot,
      occurredAt: '2099-08-11T08:00:00.000Z'
    })
    const firstRecording = await runtime.status(workspaceRoot, 'codex', 'thread-1')
    assert.equal(firstRecording?.state, 'active')
    assert.equal(firstRecording?.versionCount, 0)

    await runtime.consume(turnEvent(
      workspaceRoot,
      oldTurn.id,
      0,
      false,
      oldTurn.completedAt
    ))
    assert.equal(
      (await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', oldTurn.id)).state,
      'unrecorded'
    )

    const firstLive = turnEvent(workspaceRoot, 'turn-first-automatic', 1)
    turns.push(completedThreadTurn(firstLive))
    await runtime.consume(firstLive)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', firstLive.turnId)
    ).state === 'committed')
    const firstStatus = await runtime.turnStatus(
      workspaceRoot,
      'codex',
      'thread-1',
      firstLive.turnId
    )
    assert.equal(firstStatus.state, 'committed')
    if (firstStatus.state !== 'committed' || !firstRecording) assert.fail('expected automatic v1')
    assert.equal(firstStatus.ordinal, 1)

    await stopAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: firstRecording.recordingId,
      idempotencyKey: 'automatic-series-stop-1'
    })
    await lifecycle.publishRequiredBeforeTurn({
      kind: 'before-turn',
      state: 'starting',
      boundaryLeaseId: 'directive-after-stop',
      deliveryAttemptId: 'directive-after-stop',
      clientDirectiveId: 'directive-after-stop',
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspaceRoot,
      occurredAt: '2099-08-11T08:00:02.000Z'
    })
    const secondRecording = await runtime.status(workspaceRoot, 'codex', 'thread-1')
    assert.equal(secondRecording?.state, 'stopped')
    assert.equal(secondRecording?.recordingId, firstRecording.recordingId)
    assert.equal(await runtime.automaticRecordingEnabled(workspaceRoot, 'codex', 'thread-1'), false)

    const secondLive = turnEvent(workspaceRoot, 'turn-second-automatic-series', 2)
    turns.push(completedThreadTurn(secondLive))
    await runtime.consume(secondLive)
    assert.equal((await runtime.turnStatus(
      workspaceRoot,
      'codex',
      'thread-1',
      secondLive.turnId
    )).state, 'unrecorded')

    const restarted = await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'automatic-series-restart-2'
    })
    assert.equal(restarted.created, true)
    assert.notEqual(restarted.recording.recordingId, firstRecording.recordingId)
    assert.equal(await runtime.automaticRecordingEnabled(workspaceRoot, 'codex', 'thread-1'), true)

    const thirdLive = {
      ...turnEvent(workspaceRoot, 'turn-after-explicit-restart', 3),
      clientDirectiveId: 'directive-after-explicit-restart'
    }
    await publishExactOutputBoundary(lifecycle, thirdLive)
    turns.push(completedThreadTurn(thirdLive))
    await runtime.consume(thirdLive)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', thirdLive.turnId)
    ).state === 'committed')
    const thirdStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', thirdLive.turnId)
    assert.equal(thirdStatus.state, 'committed')
    if (thirdStatus.state !== 'committed') assert.fail('expected explicitly restarted v1')
    assert.notEqual(thirdStatus.artifactRef.artifactId, firstStatus.artifactRef.artifactId)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('stop before the first turn suppresses v1 until an explicit start re-enables the next turn', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-stop-before-first-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate(lifecycle)

    const stopped = await stopAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'runtime-stop-before-first'
    })
    assert.equal(stopped.recording, null)
    assert.deepEqual(await runtime.checkpointStatus(workspaceRoot, 'codex', 'thread-1'), {
      recordingMode: 'automatic', automaticEnabled: false, policyRevision: 1, recording: null
    })
    const skipped = turnEvent(workspaceRoot, 'turn-before-explicit-start', 1)
    await publishExactOutputBoundary(lifecycle, skipped)
    await runtime.consume(skipped)
    assert.equal((await runtime.turnStatus(
      workspaceRoot,
      'codex',
      'thread-1',
      skipped.turnId
    )).state, 'unrecorded')

    const started = await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'runtime-start-after-empty-stop'
    })
    assert.equal(started.created, true)
    const recorded = turnEvent(workspaceRoot, 'turn-after-explicit-start', 2)
    await publishExactOutputBoundary(lifecycle, recorded)
    await runtime.consume(recorded)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', recorded.turnId)
    ).state === 'committed')
    assert.equal((await runtime.turnStatus(
      workspaceRoot,
      'codex',
      'thread-1',
      recorded.turnId
    )).state, 'committed')
    await runtime.stop(workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', expectedPolicyRevision: 0,
      idempotencyKey: 'runtime-stop-before-first'
    })
    assert.equal((await runtime.checkpointStatus(
      workspaceRoot,
      'codex',
      'thread-1'
    )).automaticEnabled, true)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('automatic recording activation fails closed without the required Host boundary', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-no-barrier-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const incompleteContext = {
      ...context(userDataDir, workspaceRoot, harness, []),
      turnEvents: { subscribe: () => () => undefined }
    } as unknown as DomainMainRuntimeLifecycleContext
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    await assert.rejects(
      runtime.activate(incompleteContext),
      /requires the Host required before-turn boundary/u
    )
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('activation propagates required durable-boundary reconciliation failures', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-reconcile-failure-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const base = context(userDataDir, workspaceRoot, harness, [])
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    await assert.rejects(runtime.activate({
      ...base,
      turnEvents: {
        subscribe: base.turnEvents!.subscribe,
        subscribeRequiredBeforeTurn: base.turnEvents!.subscribeRequiredBeforeTurn!,
        readDurableTurnBoundarySnapshot: async () => { throw new Error('durable owner read failed') }
      }
    }), /durable owner read failed/u)
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('activation rejects a durable checkpoint store whose workspace identity is corrupt', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-corrupt-reconcile-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir })
    await store.start(workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', expectedPolicyRevision: 0,
      idempotencyKey: 'corrupt-reconcile-start'
    })
    await writeFile(store.pathFor(workspaceRoot), JSON.stringify({
      schemaVersion: 1,
      recordings: [],
      operations: [],
      automaticPolicyOperationOrdinal: 0
    }))
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    await assert.rejects(runtime.activate(context(
      userDataDir,
      workspaceRoot,
      new ArtifactHarness(),
      []
    )), (error: unknown) => (error as { code?: string }).code === 'scope-mismatch')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('activation ignores unrelated durable boundaries without a workspace binding', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-global-boundary-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const base = context(userDataDir, workspaceRoot, harness, [])
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate({
      ...base,
      turnEvents: {
        subscribe: base.turnEvents!.subscribe,
        subscribeRequiredBeforeTurn: base.turnEvents!.subscribeRequiredBeforeTurn!,
        readDurableTurnBoundarySnapshot: async () => ({
          issuerEpoch: TEST_ISSUER_EPOCH,
          nextDeliveryAttemptOrdinal: 2,
          retiredThroughOrdinal: 0,
          retiredOrdinalRanges: [],
          owners: [{
            issuerEpoch: TEST_ISSUER_EPOCH,
            deliveryAttemptOrdinal: 1,
            boundaryLeaseId: 'unrelated-boundary', deliveryAttemptId: 'unrelated-attempt',
            runtimeId: 'codex', threadId: 'chat-without-workspace', clientDirectiveId: 'unrelated-directive',
            phase: 'watching', occurredAt: '2099-08-11T08:00:00.000Z'
          }]
        })
      }
    })
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('turn artifact handoff without a workspace binding is acknowledged as an unrecorded no-op', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-no-workspace-artifact-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate(context(userDataDir, workspaceRoot, harness, []))
    const { workspaceRoot: _workspaceRoot, ...unscoped } = turnEvent(
      workspaceRoot,
      'turn-without-workspace',
      1
    )
    await runtime.consume(unscoped)
    assert.equal(harness.commitInputs.length, 0)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('turn boundary leases are consumed or released on every terminal disposition', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-leases-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const store = new ResearchCheckpointStore({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, [])
    const runtime = new ResearchCheckpointRuntime({ userDataDir, store })
    const deactivate = await runtime.activate(lifecycle)

    for (const [index, state] of (['failed', 'cancelled', 'rejected'] as const).entries()) {
      const leaseId = `directive-release-${index}`
      await lifecycle.publishRequiredBeforeTurn({
        kind: 'before-turn', state: 'starting', boundaryLeaseId: leaseId,
        deliveryAttemptId: leaseId,
        clientDirectiveId: leaseId, runtimeId: 'codex', threadId: 'thread-1',
        workspaceRoot, occurredAt: `2099-08-11T09:00:0${index}.000Z`
      })
      assert.equal(await store.turnBoundaryLeaseState(workspaceRoot, leaseId), 'open')
      const terminal: DomainMainTurnLifecycleEvent = state === 'rejected'
        ? {
            kind: 'after-turn', state, boundaryLeaseId: leaseId,
            deliveryAttemptId: leaseId,
            issuerEpoch: TEST_ISSUER_EPOCH,
            deliveryAttemptOrdinal: index + 1,
            clientDirectiveId: leaseId, runtimeId: 'codex', threadId: 'thread-1',
            workspaceRoot, occurredAt: `2099-08-11T09:01:0${index}.000Z`
          }
        : {
            kind: 'after-turn', state, boundaryLeaseId: leaseId,
            deliveryAttemptId: leaseId,
            issuerEpoch: TEST_ISSUER_EPOCH,
            deliveryAttemptOrdinal: index + 1,
            clientDirectiveId: leaseId, runtimeId: 'codex', threadId: 'thread-1',
            turnId: `turn-release-${index}`,
            workspaceRoot, occurredAt: `2099-08-11T09:01:0${index}.000Z`
          }
      await lifecycle.publishTurnLifecycle(terminal)
      assert.equal(await store.turnBoundaryLeaseState(workspaceRoot, leaseId), 'released')
    }

    const completed = turnEvent(workspaceRoot, 'turn-consumed-lease', 4)
    await publishExactOutputBoundary(lifecycle, completed)
    assert.equal(
      await store.turnBoundaryLeaseState(workspaceRoot, completed.boundaryLeaseId!),
      'open'
    )
    await lifecycle.publishTurnLifecycle({
      kind: 'after-turn', state: 'completed',
      boundaryLeaseId: completed.boundaryLeaseId!,
      deliveryAttemptId: completed.deliveryAttemptId!,
      clientDirectiveId: completed.clientDirectiveId!, runtimeId: 'codex', threadId: 'thread-1',
      turnId: completed.turnId, workspaceRoot, occurredAt: completed.occurredAt
    })
    assert.equal(
      await store.turnBoundaryLeaseState(workspaceRoot, completed.boundaryLeaseId!),
      'consumed'
    )
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('activation fails closed when the Host snapshot omits an open lease without retirement proof', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-orphan-lease-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const firstStore = new ResearchCheckpointStore({ userDataDir })
    const firstLifecycle = context(userDataDir, workspaceRoot, harness, [])
    const firstRuntime = new ResearchCheckpointRuntime({ userDataDir, store: firstStore })
    const deactivateFirst = await firstRuntime.activate(firstLifecycle)
    await firstLifecycle.publishRequiredBeforeTurn({
      kind: 'before-turn', state: 'starting', boundaryLeaseId: 'directive-orphaned',
      deliveryAttemptId: 'directive-orphaned',
      clientDirectiveId: 'directive-orphaned', runtimeId: 'codex', threadId: 'thread-1',
      workspaceRoot, occurredAt: '2099-08-11T10:00:00.000Z'
    })
    assert.equal(await firstStore.turnBoundaryLeaseState(workspaceRoot, 'directive-orphaned'), 'open')
    await deactivateFirst()

    const recoveredStore = new ResearchCheckpointStore({ userDataDir })
    const recoveredRuntime = new ResearchCheckpointRuntime({ userDataDir, store: recoveredStore })
    await assert.rejects(recoveredRuntime.activate(
      context(userDataDir, workspaceRoot, harness, [])
    ), (error: unknown) => (error as { code?: string }).code === 'content-mismatch')
    assert.equal(await recoveredStore.turnBoundaryLeaseState(
      workspaceRoot,
      'directive-orphaned'
    ), 'open')
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('Host delivery acks after local enqueue while commit is blocked; stop preserves queued work', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-ack-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    let release!: () => void
    harness.checkpointGate = new Promise<void>((resolve) => { release = resolve })
    const turns: DomainAgentThreadTurn[] = [{
      id: 'turn-old',
      status: 'completed',
      completedAt: '2020-01-01T00:00:00.000Z',
      messages: [],
      artifacts: []
    }]
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'runtime-start-ack'
    })
    await runtime.consume(turnEvent(workspaceRoot, 'turn-old', 0, false, '2020-01-01T00:00:00.000Z'))
    assert.equal((await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', 'turn-old')).state, 'unrecorded')

    const live = turnEvent(workspaceRoot, 'turn-live', 1)
    await publishExactOutputBoundary(lifecycle, live)
    turns.push(completedThreadTurn(live))
    await Promise.race([
      runtime.consume(live),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Host delivery remained blocked')), 250))
    ])
    await waitFor(() => harness.checkpointCommitStarted)
    assert.equal((await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', live.turnId)).state, 'pending')
    await stopAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'runtime-stop-ack'
    })
    harness.releaseCheckpointGate()
    release()
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', live.turnId)
    ).state === 'committed')

    const afterStop = turnEvent(workspaceRoot, 'turn-after-stop', 2)
    await runtime.consume(afterStop)
    assert.equal((await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', afterStop.turnId)).state, 'unrecorded')
    await assert.rejects(
      startAtCurrentPolicy(runtime, join(userDataDir, 'other-workspace'), {
        runtimeId: 'codex',
        threadId: 'thread-1',
        idempotencyKey: 'wrong-workspace-start'
      }),
      (error: unknown) => (error as { code?: string }).code === 'scope-mismatch'
    )
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('stop affects only future leases while an already open turn archives to its bound recording', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-inflight-stop-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate(lifecycle)
    const started = await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'inflight-stop-start'
    })
    const accepted = turnEvent(workspaceRoot, 'inflight-stop-turn', 1)
    await publishExactOutputBoundary(lifecycle, accepted)
    await stopAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', recordingId: started.recording.recordingId,
      idempotencyKey: 'inflight-stop-stop'
    })
    await runtime.consume(accepted)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', accepted.turnId)
    ).state === 'committed', 5_000)
    const status = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', accepted.turnId)
    if (status.state !== 'committed') assert.fail('expected accepted turn to commit')
    assert.equal(status.recordingId, started.recording.recordingId)
    assert.equal((await runtime.status(workspaceRoot, 'codex', 'thread-1'))?.state, 'stopped')
    assert.equal(await runtime.automaticRecordingEnabled(workspaceRoot, 'codex', 'thread-1'), false)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('a following turn freezes a locally verified pending output predecessor without waiting for commit', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-pending-parent-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    let release!: () => void
    harness.checkpointGate = new Promise<void>((resolve) => { release = resolve })
    const turns: DomainAgentThreadTurn[] = []
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'pending-parent-start'
    })

    const first = turnEventWithExactOutputs(workspaceRoot, 'pending-parent-v1', 1, [{
      path: 'outputs/result.csv', bytes: ''
    }])
    await publishExactOutputBoundary(lifecycle, first)
    await runtime.consume(first)
    await waitFor(() => harness.checkpointCommitStarted)

    const second = turnEventWithExactOutputs(workspaceRoot, 'pending-parent-v2', 2, [{
      path: 'outputs/result.csv', priorBytes: '', bytes: 'value\n2\n', kind: 'modified'
    }])
    await publishExactOutputBoundary(lifecycle, second)
    await Promise.race([
      runtime.consume(second),
      new Promise<never>((_, reject) => setTimeout(() => reject(
        new Error('Following turn waited for predecessor Artifact commit.')
      ), 250))
    ])
    assert.equal(harness.readVersionIds.length, 0)

    harness.releaseCheckpointGate()
    release()
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    ).state === 'committed', 5_000)
    const firstStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    const secondStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    if (firstStatus.state !== 'committed' || secondStatus.state !== 'committed') assert.fail('expected committed chain')
    assert.equal(
      harness.versionParents.get(secondStatus.outputArtifacts[0]!.ref.versionId),
      firstStatus.outputArtifacts[0]!.ref.versionId
    )
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('three pending same-path turns survive restart with the exact locally frozen parent chain', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-pending-chain-restart-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    harness.checkpointIoFailuresRemaining = 100
    const turns: DomainAgentThreadTurn[] = []
    const firstLifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const firstRuntime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivateFirst = await firstRuntime.activate(firstLifecycle)
    await startAtCurrentPolicy(firstRuntime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'pending-chain-start'
    })

    const first = turnEventWithExactOutputs(workspaceRoot, 'pending-chain-v1', 1, [{
      path: 'outputs/result.csv', bytes: 'value\n1\n'
    }])
    const second = turnEventWithExactOutputs(workspaceRoot, 'pending-chain-v2', 2, [{
      path: 'outputs/result.csv', priorBytes: 'value\n1\n', bytes: 'value\n2\n', kind: 'modified'
    }])
    const third = turnEventWithExactOutputs(workspaceRoot, 'pending-chain-v3', 3, [{
      path: 'outputs/result.csv', priorBytes: 'value\n2\n', bytes: 'value\n3\n', kind: 'modified'
    }])
    for (const event of [first, second, third]) {
      await publishExactOutputBoundary(firstLifecycle, event)
      turns.push(completedThreadTurn(event))
      await firstRuntime.consume(event)
      assert.equal((await firstRuntime.turnStatus(
        workspaceRoot,
        'codex',
        'thread-1',
        event.turnId
      )).state, 'pending')
    }
    assert.equal(harness.readVersionIds.length, 0)
    await deactivateFirst()

    harness.checkpointIoFailuresRemaining = 0
    const secondRuntime = new ResearchCheckpointRuntime({ userDataDir })
    const secondLifecycle = context(
      userDataDir,
      workspaceRoot,
      harness,
      turns,
      boundarySnapshotForEvents([first, second, third])
    )
    const deactivateSecond = await secondRuntime.activate(secondLifecycle)
    await waitForAsync(async () => (
      await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', third.turnId)
    ).state === 'committed', 8_000)

    const statuses = await Promise.all([first, second, third].map((event) => (
      secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    )))
    if (statuses.some((status) => status.state !== 'committed')) assert.fail('expected committed chain')
    const [firstStatus, secondStatus, thirdStatus] = statuses
    if (
      firstStatus?.state !== 'committed' ||
      secondStatus?.state !== 'committed' ||
      thirdStatus?.state !== 'committed'
    ) assert.fail('expected committed chain')
    const firstOutput = firstStatus.outputArtifacts[0]!.ref
    const secondOutput = secondStatus.outputArtifacts[0]!.ref
    const thirdOutput = thirdStatus.outputArtifacts[0]!.ref
    assert.equal(harness.versionParents.get(firstOutput.versionId), undefined)
    assert.equal(harness.versionParents.get(secondOutput.versionId), firstOutput.versionId)
    assert.equal(harness.versionParents.get(thirdOutput.versionId), secondOutput.versionId)
    assert.deepEqual(statuses.map((status) => status.state === 'committed' ? status.ordinal : null), [1, 2, 3])
    assert.equal(harness.readVersionIds.length, 0)
    await deactivateSecond()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('checkpoint response loss survives restart and preserves v1 to v2 identity without observing unauthenticated files', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-replay-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    harness.checkpointResponseLossesRemaining = 1
    harness.failGitAfterFirst = true
    const turns: DomainAgentThreadTurn[] = []
    const firstRuntime = new ResearchCheckpointRuntime({ userDataDir })
    const firstLifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivateFirst = await firstRuntime.activate(firstLifecycle)
    await startAtCurrentPolicy(firstRuntime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'runtime-start-replay'
    })
    const first = turnEvent(workspaceRoot, 'turn-1', 1, true)
    await publishExactOutputBoundary(firstLifecycle, first)
    turns.push(completedThreadTurn(first))
    await firstRuntime.consume(first)
    await waitFor(() => harness.checkpointResponseLossCount === 1, 8_000)
    assert.equal((await firstRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)).state, 'pending')
    await deactivateFirst()

    const secondRuntime = new ResearchCheckpointRuntime({ userDataDir })
    const secondLifecycle = context(
      userDataDir,
      workspaceRoot,
      harness,
      turns,
      boundarySnapshotForEvents([first])
    )
    const deactivateSecond = await secondRuntime.activate(secondLifecycle)
    await waitForAsync(async () => (
      await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const second = turnEvent(workspaceRoot, 'turn-2', 2, true)
    await publishExactOutputBoundary(secondLifecycle, second)
    turns.push(completedThreadTurn(second))
    await secondRuntime.consume(second)
    await waitForAsync(async () => (
      await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    ).state === 'committed', 5_000)

    const firstStatus = await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    const secondStatus = await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    assert.equal(firstStatus.state, 'committed')
    assert.equal(secondStatus.state, 'committed')
    if (firstStatus.state !== 'committed' || secondStatus.state !== 'committed') assert.fail('expected committed')
    assert.equal(firstStatus.artifactRef.artifactId, secondStatus.artifactRef.artifactId)
    assert.equal(firstStatus.ordinal, 1)
    assert.equal(secondStatus.ordinal, 2)
    assert.equal(firstStatus.provenance.status, 'incomplete')
    assert.equal(firstStatus.control.status, 'untracked')
    assert.equal(firstStatus.untrackedOperationCount, 1)
    assert.equal(harness.observeResponseLossCount, 0)
    assert.equal(harness.gitListCallCount, 2)

    const evidenceUnavailable = await secondRuntime.turnStatus(
      workspaceRoot,
      'codex',
      'thread-1',
      first.turnId
    )
    assert.equal(evidenceUnavailable.state, 'committed')
    if (evidenceUnavailable.state !== 'committed') assert.fail('expected committed checkpoint')
    assert.equal(evidenceUnavailable.evidence.status, 'unavailable')
    const evidenceRead = await secondRuntime.read(workspaceRoot, {
      versionId: firstStatus.artifactRef.versionId
    })
    assert.equal(evidenceRead.status.evidence.status, 'unavailable')
    const listWithoutEvidenceOwner = await secondRuntime.list(workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      limit: 20
    })
    assert.equal(
      listWithoutEvidenceOwner.records.every((record) =>
        record.status.evidence.status === 'unavailable' &&
        record.manifest.status.evidence === 'pending'),
      true
    )

    assert.deepEqual(harness.observeInputs, [])

    const checkpointGroups = new Map<string, ArtifactVersionCommitInputV2[]>()
    for (const input of harness.commitInputs) {
      const values = checkpointGroups.get(input.idempotencyKey) ?? []
      values.push(input)
      checkpointGroups.set(input.idempotencyKey, values)
    }
    assert.equal([...checkpointGroups.values()].some((values) => values.length >= 2), true)
    for (const values of checkpointGroups.values()) {
      assert.equal(new Set(values.map((value) => value.candidates[0]?.candidateId)).size, 1)
    }
    await deactivateSecond()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('Host-frozen dataset and plot outputs persist exact bytes, independent identities, and same-path v1 to v2', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-exact-outputs-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'exact-output-start'
    })

    const first = turnEventWithExactOutputs(workspaceRoot, 'output-turn-1', 1, [
      { path: 'outputs/penguins.csv', bytes: 'species,count\nAdelie,152\n' },
      { path: 'outputs/penguins.png', bytes: 'png-terminal-v1' }
    ])
    await publishExactOutputBoundary(lifecycle, first)
    turns.push(completedThreadTurn(first))
    await runtime.consume(first)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const firstStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    if (firstStatus.state !== 'committed') assert.fail('expected first committed output checkpoint')
    assert.deepEqual(firstStatus.outputArtifacts.map((item) => [item.path, item.artifactOrdinal]), [
      ['outputs/penguins.csv', 1],
      ['outputs/penguins.png', 1]
    ])
    assert.equal(firstStatus.untrackedOperationCount, 0)
    assert.equal(firstStatus.provenance.status, 'complete')
    assert.equal(firstStatus.artifactRef.accessPolicy.allowExport, false)
    const firstAtomicCommit = harness.commitInputs.find((input) => (
      input.candidates.some((candidate) => candidate.kind === 'research-output')
    ))
    assert.ok(firstAtomicCommit)
    assert.equal(
      firstAtomicCommit.candidates.every((candidate) => candidate.accessPolicy?.allowExport === false),
      true
    )
    const firstRecord = await runtime.read(workspaceRoot, { versionId: firstStatus.artifactRef.versionId })
    assert.equal(firstRecord.manifest.status.execution, 'not-applicable')
    assert.equal(firstRecord.manifest.breakpoints.some((item) => (
      item.code === 'editor-change-untracked'
    )), false)
    assert.notEqual(
      firstStatus.outputArtifacts[0]?.ref.artifactId,
      firstStatus.outputArtifacts[1]?.ref.artifactId
    )

    // The workspace path can already contain later bytes; the producer must
    // commit only the immutable terminal receipt embedded in the event.
    await mkdir(join(workspaceRoot, 'outputs'), { recursive: true })
    await writeFile(join(workspaceRoot, 'outputs', 'penguins.csv'), 'late-current-path-bytes')

    const second = turnEventWithExactOutputs(workspaceRoot, 'output-turn-2', 2, [
      {
        path: 'outputs/penguins.csv',
        priorBytes: 'species,count\nAdelie,152\n',
        bytes: 'species,count\nAdelie,153\n',
        kind: 'modified'
      }
    ])
    await publishExactOutputBoundary(lifecycle, second)
    turns.push(completedThreadTurn(second))
    await runtime.consume(second)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    ).state === 'committed', 5_000)
    const secondStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    if (secondStatus.state !== 'committed') assert.fail('expected second committed output checkpoint')
    const outputCommits = harness.commitInputs.flatMap((input) => input.candidates)
      .filter((candidate) => candidate.kind === 'research-output')
    assert.equal(outputCommits.length, 3)
    assert.equal(outputCommits.every((candidate) => candidate.kind === 'research-output'), true)
    assert.equal(secondStatus.outputArtifacts[0]?.artifactOrdinal, 2)
    assert.equal(
      secondStatus.outputArtifacts[0]?.ref.artifactId,
      firstStatus.outputArtifacts.find((item) => item.path.endsWith('.csv'))?.ref.artifactId
    )
    assert.equal(
      secondStatus.outputArtifacts[0]?.ref.contentDigest,
      digest('species,count\nAdelie,153\n')
    )
    assert.equal(secondStatus.untrackedOperationCount, 0)
    assert.equal(secondStatus.control.status, 'untracked')
    assert.equal(secondStatus.provenance.status, 'complete')
    assert.equal(
      (await runtime.read(workspaceRoot, { versionId: secondStatus.artifactRef.versionId }))
        .manifest.breakpoints.some((item) => item.code === 'host-file-effect-causality-unverified'),
      false
    )
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('same workspace output identity continues across separate research recordings', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-cross-recording-output-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const ids = ['research-recording:first', 'research-recording:second']
    const store = new ResearchCheckpointStore({
      userDataDir,
      createRecordingId: () => ids.shift() ?? 'research-recording:unexpected'
    })
    const runtime = new ResearchCheckpointRuntime({ userDataDir, store })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    const firstRecording = await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'cross-recording-start-1'
    })
    const first = turnEventWithExactOutputs(workspaceRoot, 'cross-recording-turn-1', 1, [
      { path: 'figures/result.svg', bytes: '<svg>v1</svg>' }
    ])
    await publishExactOutputBoundary(lifecycle, first)
    turns.push(completedThreadTurn(first))
    await runtime.consume(first)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const firstStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    if (firstStatus.state !== 'committed') assert.fail('expected first recording output')
    await stopAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1',
      recordingId: firstRecording.recording.recordingId,
      idempotencyKey: 'cross-recording-stop-1'
    })
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'cross-recording-start-2'
    })
    const second = turnEventWithExactOutputs(workspaceRoot, 'cross-recording-turn-2', 2, [
      { path: 'figures/result.svg', priorBytes: '<svg>v1</svg>', bytes: '<svg>v2</svg>', kind: 'modified' }
    ])
    await publishExactOutputBoundary(lifecycle, second)
    turns.push(completedThreadTurn(second))
    await runtime.consume(second)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    ).state === 'committed', 5_000)
    const secondStatus = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    if (secondStatus.state !== 'committed') assert.fail('expected second recording output')
    assert.equal(secondStatus.outputArtifacts[0]?.ref.artifactId, firstStatus.outputArtifacts[0]?.ref.artifactId)
    assert.equal(secondStatus.outputArtifacts[0]?.artifactOrdinal, 2)
    assert.equal(
      harness.versionParents.get(secondStatus.outputArtifacts[0]!.ref.versionId),
      firstStatus.outputArtifacts[0]?.ref.versionId
    )
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('an active directive keeps its original pre-turn output parent after a later directive advances current', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-original-directive-parent-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'original-parent-start'
    })

    const first = turnEventWithExactOutputs(workspaceRoot, 'original-parent-v1', 1, [
      { path: 'outputs/result.csv', bytes: 'value\n1\n' }
    ])
    await publishExactOutputBoundary(lifecycle, first)
    turns.push(completedThreadTurn(first))
    await runtime.consume(first)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const v1 = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    if (v1.state !== 'committed') assert.fail('expected output v1')
    const v1Output = v1.outputArtifacts[0]!

    const active = turnEventWithExactOutputs(workspaceRoot, 'original-parent-active', 2, [{
      path: 'outputs/result.csv', priorBytes: 'value\n1\n', bytes: 'value\nactive\n', kind: 'modified'
    }])
    // This is the one required barrier for the original user directive. A
    // later steer keeps the same clientDirectiveId and cannot refresh it.
    await publishExactOutputBoundary(lifecycle, active)

    const later = turnEventWithExactOutputs(workspaceRoot, 'original-parent-later', 3, [{
      path: 'outputs/result.csv', priorBytes: 'value\n1\n', bytes: 'value\n2\n', kind: 'modified'
    }])
    await publishExactOutputBoundary(lifecycle, later)
    turns.push(completedThreadTurn(later))
    await runtime.consume(later)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', later.turnId)
    ).state === 'committed', 5_000)

    turns.push(completedThreadTurn(active))
    await runtime.consume(active)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', active.turnId)
    ).state === 'stale-conflict', 5_000)
    assert.equal(harness.readVersionIds.at(-1), v1Output.ref.versionId)
    const activeBatch = harness.commitInputs.find((input) => input.candidates.some((candidate) => (
      candidate.metadata?.researchTurnId === active.turnId
    )))
    const activeOutput = activeBatch?.candidates.find((candidate) => candidate.kind === 'research-output')
    assert.equal(activeOutput?.expectedCurrentVersionId, v1Output.ref.versionId)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('an update without its exact boundary lease remains unrecorded without late-binding current', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-missing-directive-parent-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'missing-parent-start'
    })
    const first = turnEventWithExactOutputs(workspaceRoot, 'missing-parent-v1', 1, [
      { path: 'outputs/result.csv', bytes: 'value\n1\n' }
    ])
    await publishExactOutputBoundary(lifecycle, first)
    turns.push(completedThreadTurn(first))
    await runtime.consume(first)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const readsBefore = harness.readVersionIds.length

    const update = {
      ...turnEventWithExactOutputs(workspaceRoot, 'missing-parent-update', 2, [{
        path: 'outputs/result.csv', priorBytes: 'value\n1\n', bytes: 'value\n2\n', kind: 'modified'
      }]),
      clientDirectiveId: 'directive-never-captured'
    }
    turns.push(completedThreadTurn(update))
    await runtime.consume(update)
    const status = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', update.turnId)
    assert.equal(status.state, 'unrecorded')
    assert.equal(harness.readVersionIds.length, readsBefore)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('an atomic output/checkpoint failure leaves no output current or successful checkpoint', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-atomic-failure-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    harness.rejectNextAtomicBatch = {
      ok: false,
      issue: { code: 'invalid-input', message: 'one output candidate is invalid' }
    }
    const turns: DomainAgentThreadTurn[] = []
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'atomic-failure-start'
    })
    const failed = turnEventWithExactOutputs(workspaceRoot, 'atomic-failure-turn', 1, [
      { path: 'outputs/data.csv', bytes: 'x\n1\n' },
      { path: 'figures/result.svg', bytes: '<svg/>' }
    ])
    await publishExactOutputBoundary(lifecycle, failed)
    turns.push(completedThreadTurn(failed))
    await runtime.consume(failed)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', failed.turnId)
    ).state === 'failed', 5_000)
    const status = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', failed.turnId)
    assert.equal(status.state, 'failed')
    assert.equal(harness.refsByIdempotency.has(harness.commitInputs[0]!.idempotencyKey), false)
    assert.deepEqual([...await new ResearchCheckpointStore({ userDataDir }).fileBindings(workspaceRoot)], [])
    assert.equal(harness.commitInputs.length, 1)
    assert.deepEqual(harness.commitInputs[0]?.candidates.map((item) => item.kind), [
      'research-output', 'research-output', 'research-checkpoint'
    ])
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('an unbound checkpoint rebases an output stale batch and retries one whole transaction', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-unbound-output-stale-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    harness.staleNextAtomicBatch = true
    const turns: DomainAgentThreadTurn[] = []
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    const recording = await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'unbound-output-stale-start'
    })
    const event = turnEventWithExactOutputs(workspaceRoot, 'unbound-output-stale-turn', 1, [
      { path: 'figures/result.svg', bytes: '<svg>retry</svg>' }
    ])
    await publishExactOutputBoundary(lifecycle, event)
    turns.push(completedThreadTurn(event))
    await runtime.consume(event)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    ).state === 'stale-conflict', 5_000)
    const stale = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    if (stale.state !== 'stale-conflict') assert.fail('expected output stale conflict')
    assert.deepEqual([...await new ResearchCheckpointStore({ userDataDir }).fileBindings(workspaceRoot)], [])
    await runtime.resolve(workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: recording.recording.recordingId,
      operationId: stale.operationId,
      resolution: 'rebase',
      idempotencyKey: 'unbound-output-stale-rebase'
    })
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    ).state === 'committed', 5_000)
    const committed = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    if (committed.state !== 'committed') assert.fail('expected rebased output checkpoint')
    assert.equal(committed.outputArtifacts.length, 1)
    assert.equal(harness.commitInputs.length, 2)
    assert.notEqual(harness.commitInputs[0]?.idempotencyKey, harness.commitInputs[1]?.idempotencyKey)
    assert.deepEqual(harness.commitInputs[1]?.candidates.map((item) => item.kind), [
      'research-output', 'research-checkpoint'
    ])
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('real Artifact Versions service commits output candidates and checkpoint as one exact transaction', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-real-atomic-service-'))
  let artifactVersions: ArtifactVersionsCapabilityTestHarness | undefined
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const turns: DomainAgentThreadTurn[] = []
    const activeArtifactVersions = await createArtifactVersionsCapabilityTestHarness(userDataDir)
    artifactVersions = activeArtifactVersions
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = realArtifactContext(userDataDir, workspaceRoot, activeArtifactVersions, turns)
    const deactivate = await runtime.activate(lifecycle)
    await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex', threadId: 'thread-1', idempotencyKey: 'real-atomic-service-start'
    })
    const event = turnEventWithExactOutputs(workspaceRoot, 'real-atomic-service-turn', 1, [
      { path: 'outputs/data.csv', bytes: 'x\n1\n' },
      { path: 'figures/result.svg', bytes: '<svg/>' }
    ])
    await publishExactOutputBoundary(lifecycle, event)
    turns.push(completedThreadTurn(event))
    await runtime.consume(event)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    ).state === 'committed', 5_000)
    const status = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    if (status.state !== 'committed') assert.fail('expected real service checkpoint')
    assert.equal(status.outputArtifacts.length, 2)
    const history = await activeArtifactVersions.invokeAction<
      ReturnType<typeof artifactVersionListResultV2Schema.parse>
    >(ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2, {}, workspaceRoot)
    if (!history.ok) throw new Error('Expected real Artifact history.')
    assert.equal(history.value.items.length, 3)
    const transactionIds = new Set(history.value.items.map((item) => item.version.transactionId))
    assert.equal(transactionIds.size, 1)
    const checkpoint = history.value.items.find((item) => item.artifact.kind === 'research-checkpoint')
    assert.ok(checkpoint)
    assert.deepEqual(
      new Set(checkpoint.version.dependencies.map((item) => item.target.versionId)),
      new Set(status.outputArtifacts.map((item) => item.ref.versionId))
    )
    await deactivate()
  } finally {
    await artifactVersions?.dispose()
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('atomic multi-output response loss restarts from the durable journal without partial or duplicate versions', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-output-response-loss-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    // The Artifact owner commits both outputs and the checkpoint in one
    // transaction, then the response is lost before the local journal records
    // the receipt. Restart must replay that exact whole-batch receipt.
    harness.outputSnapshotResponseLossAtCommitNumber = 1
    const turns: DomainAgentThreadTurn[] = []
    const firstStore = new ResearchCheckpointStore({ userDataDir })
    const firstRuntime = new ResearchCheckpointRuntime({ userDataDir, store: firstStore })
    const firstLifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivateFirst = await firstRuntime.activate(firstLifecycle)
    await startAtCurrentPolicy(firstRuntime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'output-response-loss-start'
    })
    const event = turnEventWithExactOutputs(workspaceRoot, 'output-response-loss-turn', 1, [
      { path: 'outputs/lost.csv', bytes: 'species,count\nAdelie,152\n' },
      { path: 'outputs/lost.svg', bytes: '<svg></svg>' }
    ])
    await publishExactOutputBoundary(firstLifecycle, event)
    turns.push(completedThreadTurn(event))
    await firstRuntime.consume(event)
    await waitFor(() => harness.outputSnapshotResponseLossCount === 1, 5_000)
    assert.equal(
      (await firstRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)).state,
      'pending'
    )
    const partial = await firstStore.operationForEvent(
      workspaceRoot,
      'codex',
      'thread-1',
      event.turnId,
      event.targetWatermark
    )
    assert.deepEqual(partial?.observedPaths, ['outputs/lost.csv', 'outputs/lost.svg'])
    assert.equal(partial?.filePlans.every((plan) => Boolean(plan.terminalSnapshot)), true)
    assert.equal(
      harness.commitInputs.some((input) => input.candidates.some((candidate) => candidate.kind === 'research-checkpoint')),
      true
    )
    await deactivateFirst()

    const secondRuntime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivateSecond = await secondRuntime.activate(context(
      userDataDir,
      workspaceRoot,
      harness,
      turns,
      boundarySnapshotForEvents([event])
    ))
    await waitForAsync(async () => (
      await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    ).state === 'committed', 5_000)
    const status = await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', event.turnId)
    if (status.state !== 'committed') assert.fail('expected restarted multi-output checkpoint')
    assert.deepEqual(status.outputArtifacts.map((item) => [item.path, item.artifactOrdinal]), [
      ['outputs/lost.csv', 1],
      ['outputs/lost.svg', 1]
    ])
    assert.equal(harness.commitInputs.length, 2)
    assert.equal(harness.commitInputs[0]?.candidates.length, 3)
    assert.equal(new Set(harness.commitInputs.map((value) => JSON.stringify(value))).size, 1)
    assert.equal(new Set(harness.commitInputs.map((value) => value.idempotencyKey)).size, 1)
    await deactivateSecond()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('v1 to v2 restore v1 as v3, advance v4, then restore the projected v3 as v5', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-restore-v4-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const lifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivate = await runtime.activate(lifecycle)
    const started = await startAtCurrentPolicy(runtime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'restore-v4-start'
    })
    const first = turnEvent(workspaceRoot, 'restore-turn-1', 1)
    await publishExactOutputBoundary(lifecycle, first)
    turns.push(completedThreadTurn(first))
    await runtime.consume(first)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const v1 = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    if (v1.state !== 'committed') assert.fail('expected v1')

    const second = turnEvent(workspaceRoot, 'restore-turn-2', 2)
    await publishExactOutputBoundary(lifecycle, second)
    turns.push(completedThreadTurn(second))
    await runtime.consume(second)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    ).state === 'committed', 5_000)
    const v2 = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    if (v2.state !== 'committed') assert.fail('expected v2')

    const sourceRecord = await runtime.read(workspaceRoot, { versionId: v1.artifactRef.versionId })
    assert.equal(sourceRecord.status.evidence.status, 'unavailable')

    const restored = await runtime.restoreAsNew(workspaceRoot, {
      recordingId: started.recording.recordingId,
      artifactId: v1.artifactRef.artifactId,
      sourceVersionId: v1.artifactRef.versionId,
      expectedCurrentVersionId: v2.artifactRef.versionId,
      idempotencyKey: 'restore-v4-restore-v1'
    })
    assert.equal(restored.ordinal, 3)
    assert.equal(restored.restoredRef.artifactId, v1.artifactRef.artifactId)
    assert.equal(harness.versionParents.get(restored.restoredRef.versionId), v2.artifactRef.versionId)
    assert.deepEqual(harness.restoreInputs.at(-1)?.metadata, {
      researchCheckpointContractVersion: 1,
      researchRecordingId: sourceRecord.manifest.recording.recordingId,
      researchOrigin: sourceRecord.manifest.recording.origin,
      runtimeId: sourceRecord.manifest.recording.runtimeId,
      threadId: sourceRecord.manifest.recording.threadId,
      turnId: sourceRecord.manifest.turn.turnId,
      targetWatermark: sourceRecord.manifest.turn.targetWatermark,
      changeReason: sourceRecord.manifest.changeReason,
      manifestDigest: digest(canonicalJson(sourceRecord.manifest)),
      executionOutcome: sourceRecord.manifest.status.execution,
      provenanceStatus: sourceRecord.manifest.status.provenance,
      controlLevel: sourceRecord.manifest.status.control,
      replicationStatus: sourceRecord.manifest.status.reproduction,
      evidenceStatus: sourceRecord.manifest.status.evidence,
      breakpoints: sourceRecord.manifest.breakpoints.map((item) => ({
        code: item.code,
        blocking: item.blocking,
        message: item.message
      })),
      restoredBy: 'research-checkpoints',
      restoreOperationId: `research-checkpoint-restore:${digest([
        workspaceBindingDigest(workspaceRoot),
        started.recording.recordingId,
        'restore-v4-restore-v1'
      ].join('\0'))}`
    })
    const restoredRecord = await runtime.read(workspaceRoot, { versionId: restored.restoredRef.versionId })
    assert.equal(restoredRecord.manifest.narrative.contentDigest, sourceRecord.manifest.narrative.contentDigest)
    assert.equal(restoredRecord.status.artifactRef.versionId, restored.restoredRef.versionId)
    assert.equal(restoredRecord.status.ordinal, 3)
    assert.equal(restoredRecord.status.evidence.status, 'unavailable')
    assert.equal(restoredRecord.projection?.sourceVersionId, v1.artifactRef.versionId)
    assert.ok((await runtime.list(workspaceRoot, {
      recordingId: started.recording.recordingId
    })).records.some((record) => record.status.artifactRef.versionId === restored.restoredRef.versionId))
    const replay = await runtime.restoreAsNew(workspaceRoot, {
      recordingId: started.recording.recordingId,
      artifactId: v1.artifactRef.artifactId,
      sourceVersionId: v1.artifactRef.versionId,
      expectedCurrentVersionId: v2.artifactRef.versionId,
      idempotencyKey: 'restore-v4-restore-v1'
    })
    assert.equal(replay.restoredRef.versionId, restored.restoredRef.versionId)
    assert.equal(replay.idempotentReplay, true)

    const fourth = turnEvent(workspaceRoot, 'restore-turn-4', 4)
    await publishExactOutputBoundary(lifecycle, fourth)
    turns.push(completedThreadTurn(fourth))
    await runtime.consume(fourth)
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', fourth.turnId)
    ).state === 'committed', 5_000)
    const v4 = await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', fourth.turnId)
    if (v4.state !== 'committed') assert.fail('expected v4')
    assert.equal(v4.ordinal, 4)
    assert.equal(v4.artifactRef.artifactId, v1.artifactRef.artifactId)
    assert.equal(harness.versionParents.get(v4.artifactRef.versionId), restored.restoredRef.versionId)
    assert.notEqual(v4.state, 'stale-conflict')

    const restoredAgain = await runtime.restoreAsNew(workspaceRoot, {
      recordingId: started.recording.recordingId,
      artifactId: restored.restoredRef.artifactId,
      sourceVersionId: restored.restoredRef.versionId,
      expectedCurrentVersionId: v4.artifactRef.versionId,
      idempotencyKey: 'restore-v5-restore-projected-v3'
    })
    assert.equal(restoredAgain.ordinal, 5)
    assert.equal(harness.versionParents.get(restoredAgain.restoredRef.versionId), v4.artifactRef.versionId)
    assert.equal(harness.restoreInputs.at(-1)?.metadata?.researchRecordingId, started.recording.recordingId)
    assert.equal(harness.restoreInputs.at(-1)?.metadata?.runtimeId, first.runtimeId)
    assert.equal(harness.restoreInputs.at(-1)?.metadata?.threadId, first.threadId)
    assert.equal(harness.restoreInputs.at(-1)?.metadata?.turnId, first.turnId)
    const restoredAgainRecord = await runtime.read(workspaceRoot, {
      versionId: restoredAgain.restoredRef.versionId
    })
    assert.equal(restoredAgainRecord.projection?.sourceVersionId, restored.restoredRef.versionId)
    assert.equal(restoredAgainRecord.manifest.turn.turnId, first.turnId)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('restore response loss and restart recover one v3 before allowing v4 from v3', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-restore-crash-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = []
    const firstStore = new ResearchCheckpointStore({ userDataDir })
    const firstRuntime = new ResearchCheckpointRuntime({ userDataDir, store: firstStore })
    const firstLifecycle = context(userDataDir, workspaceRoot, harness, turns)
    const deactivateFirst = await firstRuntime.activate(firstLifecycle)
    const started = await startAtCurrentPolicy(firstRuntime, workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      idempotencyKey: 'restore-crash-start'
    })
    const first = turnEvent(workspaceRoot, 'restore-crash-turn-1', 1)
    await publishExactOutputBoundary(firstLifecycle, first)
    turns.push(completedThreadTurn(first))
    await firstRuntime.consume(first)
    await waitForAsync(async () => (
      await firstRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    ).state === 'committed', 5_000)
    const v1 = await firstRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', first.turnId)
    if (v1.state !== 'committed') assert.fail('expected v1')

    const second = turnEvent(workspaceRoot, 'restore-crash-turn-2', 2)
    await publishExactOutputBoundary(firstLifecycle, second)
    turns.push(completedThreadTurn(second))
    await firstRuntime.consume(second)
    await waitForAsync(async () => (
      await firstRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    ).state === 'committed', 5_000)
    const v2 = await firstRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', second.turnId)
    if (v2.state !== 'committed') assert.fail('expected v2')

    harness.restoreResponseLossesRemaining = 1
    await assert.rejects(firstRuntime.restoreAsNew(workspaceRoot, {
      recordingId: started.recording.recordingId,
      artifactId: v1.artifactRef.artifactId,
      sourceVersionId: v1.artifactRef.versionId,
      expectedCurrentVersionId: v2.artifactRef.versionId,
      idempotencyKey: 'restore-crash-v3'
    }), /transport failed/u)
    assert.equal(harness.restoreResponseLossCount, 1)

    const earlyFourth = {
      ...turnEvent(workspaceRoot, 'restore-crash-turn-4', 4),
      deliveryAttemptOrdinal: 3
    }
    await publishExactOutputBoundary(firstLifecycle, earlyFourth)
    turns.push(completedThreadTurn(earlyFourth))
    // Research Checkpoints durably accepts the event so the shared Host
    // handoff can be acknowledged, but it leaves the operation unprepared
    // while the restore predecessor remains pending.
    await firstRuntime.consume(earlyFourth)
    const queuedFourth = await firstStore.operationForEvent(
      workspaceRoot,
      'codex',
      'thread-1',
      earlyFourth.turnId,
      earlyFourth.targetWatermark
    )
    assert.ok(queuedFourth)
    assert.equal(queuedFourth.preparedAt, undefined)
    assert.equal(queuedFourth.artifactId, undefined)
    assert.equal(queuedFourth.expectedCurrentVersionId, null)
    assert.equal(
      (await firstRuntime.turnStatus(
        workspaceRoot,
        'codex',
        'thread-1',
        earlyFourth.turnId
      )).state,
      'pending'
    )
    await deactivateFirst()

    const secondRuntime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivateSecond = await secondRuntime.activate(context(
      userDataDir,
      workspaceRoot,
      harness,
      turns,
      boundarySnapshotForEvents([first, second, earlyFourth])
    ))
    await waitForAsync(async () => (
      (await secondRuntime.status(workspaceRoot, 'codex', 'thread-1'))?.currentOrdinal === 3
    ), 5_000)
    const restoredRecording = await secondRuntime.status(workspaceRoot, 'codex', 'thread-1')
    assert.equal(restoredRecording?.currentOrdinal, 3)
    const restoredVersionId = restoredRecording?.currentVersionId
    assert.ok(restoredVersionId)
    assert.equal(harness.versionParents.get(restoredVersionId), v2.artifactRef.versionId)
    const recoveredProjection = await secondRuntime.read(workspaceRoot, { versionId: restoredVersionId })
    assert.equal(recoveredProjection.status.artifactRef.versionId, restoredVersionId)
    assert.equal(recoveredProjection.status.ordinal, 3)
    assert.equal(recoveredProjection.projection?.sourceVersionId, v1.artifactRef.versionId)
    assert.equal(recoveredProjection.manifest.turn.turnId, first.turnId)
    assert.equal(recoveredProjection.status.evidence.status, 'unavailable')

    await waitForAsync(async () => (
      await secondRuntime.turnStatus(workspaceRoot, 'codex', 'thread-1', earlyFourth.turnId)
    ).state === 'committed', 5_000)
    const v4 = await secondRuntime.turnStatus(
      workspaceRoot,
      'codex',
      'thread-1',
      earlyFourth.turnId
    )
    if (v4.state !== 'committed') assert.fail('expected v4')
    assert.equal(v4.ordinal, 4)
    assert.equal(harness.versionParents.get(v4.artifactRef.versionId), restoredVersionId)
    assert.equal(harness.restoreInvocationCount, 2)
    assert.equal(harness.restoreInputs.length, 2)
    assert.deepEqual(harness.restoreInputs[1], harness.restoreInputs[0])
    const versionsForArtifact = [...harness.versionParents.keys()].filter((versionId) =>
      versionId.startsWith('artifact-version:'))
    assert.equal(new Set(versionsForArtifact).size, 4)
    await deactivateSecond()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('legacy preview lists only completed durable turns and binds digest to the exact selection', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-legacy-preview-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = [
      {
        id: 'turn-completed',
        status: 'completed',
        completedAt: '2026-08-11T08:00:01.000Z',
        messages: [],
        artifacts: [
          { kind: 'user_message', text: 'Compare the samples.' },
          { kind: 'assistant_message', text: 'The treatment group increased.' },
          { kind: 'tool', detail: '/private/host/transcript.json' }
        ]
      },
      {
        id: 'turn-running',
        status: 'running',
        messages: [],
        artifacts: [{ kind: 'user_message', text: 'Still running' }]
      }
    ]
    const runtime = new ResearchCheckpointRuntime({ userDataDir })
    const deactivate = await runtime.activate(context(userDataDir, workspaceRoot, harness, turns))
    const available = await runtime.previewLegacy(workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    assert.deepEqual(available.turns, [{
      turnId: 'turn-completed',
      status: 'completed',
      completedAt: '2026-08-11T08:00:01.000Z',
      summary: 'Compare the samples. · The treatment group increased.'
    }])
    assert.equal(available.selectedTranscriptDigest, null)
    assert.equal(JSON.stringify(available).includes('/private/host'), false)

    const selected = await runtime.previewLegacy(workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      selectedTurnIds: ['turn-completed']
    })
    assert.match(selected.selectedTranscriptDigest ?? '', /^[a-f0-9]{64}$/u)
    await assert.rejects(
      runtime.importLegacy(workspaceRoot, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        idempotencyKey: 'legacy-import-running-turn',
        title: 'Invalid running import',
        expectedTranscriptDigest: 'a'.repeat(64),
        selectedTurnIds: ['turn-running']
      }),
      (error: unknown) => (error as { code?: string }).code === 'content-mismatch'
    )
    await assert.rejects(
      runtime.previewLegacy(workspaceRoot, {
        runtimeId: 'codex',
        threadId: 'thread-1',
        selectedTurnIds: ['turn-running']
      }),
      (error: unknown) => (error as { code?: string }).code === 'not-found'
    )
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('activation recovers a stopped recording pending in the local journal', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'research-checkpoint-runtime-recovery-'))
  try {
    const workspaceRoot = join(userDataDir, 'workspace')
    const store = new ResearchCheckpointStore({ userDataDir })
    const started = await store.start(workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      expectedPolicyRevision: 0,
      idempotencyKey: 'recovery-start-1'
    }, { watermark: 'wm-start', knownTurnIds: [] })
    const queuedEvent = turnEvent(workspaceRoot, 'turn-recover', 1)
    await store.enqueue(
      workspaceRoot,
      started.recording.recordingId,
      extractCheckpointFromTurn(queuedEvent, started.recording, workspaceRoot, new Map()),
      'recovery-commit-key'
    )
    await store.stop(workspaceRoot, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      expectedPolicyRevision: 1,
      recordingId: started.recording.recordingId,
      idempotencyKey: 'recovery-stop-1'
    }, { watermark: 'wm-stop', knownTurnIds: [queuedEvent.turnId] })

    const harness = new ArtifactHarness()
    const turns: DomainAgentThreadTurn[] = [{
      id: queuedEvent.turnId,
      status: 'completed',
      completedAt: queuedEvent.occurredAt,
      messages: [],
      artifacts: queuedEvent.artifacts
    }]
    const runtime = new ResearchCheckpointRuntime({ userDataDir, store: new ResearchCheckpointStore({ userDataDir }) })
    const deactivate = await runtime.activate(context(userDataDir, workspaceRoot, harness, turns))
    await waitForAsync(async () => (
      await runtime.turnStatus(workspaceRoot, 'codex', 'thread-1', queuedEvent.turnId)
    ).state === 'committed', 5_000)
    await deactivate()
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
