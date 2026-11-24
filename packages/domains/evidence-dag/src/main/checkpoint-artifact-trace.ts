import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import { artifactVersionRefV1Schema, type ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import {
  RESEARCH_CHECKPOINT_CAPABILITY_IDS,
  researchCheckpointListInputV1Schema, researchCheckpointListResultV1Schema,
  researchCheckpointReadInputV1Schema, researchCheckpointReadResultV1Schema,
  researchCheckpointTurnStatusInputV1Schema, researchCheckpointTurnStatusResultV1Schema,
  type ResearchCheckpointRecordV1
} from '@sciforge/domain-research-checkpoints/contract'
import { verifyArtifactVersionRef } from './artifact-version-client.js'
import { artifactVersionReadPort } from './artifact-version-static-ports.js'

const listContract = { actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.list, effect: 'read' as const,
  inputSchema: researchCheckpointListInputV1Schema, outputSchema: researchCheckpointListResultV1Schema }
const readContract = { actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.read, effect: 'read' as const,
  inputSchema: researchCheckpointReadInputV1Schema, outputSchema: researchCheckpointReadResultV1Schema }
const turnStatusContract = { actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus, effect: 'read' as const,
  inputSchema: researchCheckpointTurnStatusInputV1Schema, outputSchema: researchCheckpointTurnStatusResultV1Schema }
const MAX_PAGES = 16
const PAGE_SIZE = 100
const MAX_REFS = 4096

type Scope = Readonly<{ runtimeId: string; threadId: string; workspaceRoot: string; knownTurnIds: readonly string[] }>
const sameRef = (left: ArtifactVersionRefV1, right: ArtifactVersionRefV1) =>
  JSON.stringify(artifactVersionRefV1Schema.parse(left)) === JSON.stringify(artifactVersionRefV1Schema.parse(right))

function assertScope(record: ResearchCheckpointRecordV1, scope: Scope): void {
  const { manifest, status } = record
  if (manifest.recording.runtimeId !== scope.runtimeId || manifest.recording.threadId !== scope.threadId ||
    status.runtimeId !== scope.runtimeId || status.threadId !== scope.threadId ||
    status.recordingId !== manifest.recording.recordingId || status.turnId !== manifest.turn.turnId) {
    throw new Error('Checkpoint owner returned a record outside the requested research scope.')
  }
}

/**
 * Bootstrap the first exact output references from their existing Checkpoint owner.
 * Lifecycle events deliberately contain no guessed thread identity. A failed or
 * bounded read must throw, so the lifecycle consumer cannot acknowledge its page.
 * No model, filesystem lookup or write is involved; workspace authorization is
 * enforced by the owner on each list/read and Artifact read invocation.
 */
export async function appendCheckpointArtifactTrace(
  context: DomainMainRuntimeLifecycleContext,
  scope: Scope,
  trace: readonly Readonly<Record<string, unknown>>[]
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  if (!scope.runtimeId.trim() || !scope.threadId.trim() || !scope.workspaceRoot.trim()) throw new Error('Checkpoint projection requires an exact research scope.')
  const options = { workspaceId: scope.workspaceRoot }
  const refs = new Map<string, { ref: ArtifactVersionRefV1; checkpoints: Set<string> }>()
  const checkpointRefs = new Map<string, ArtifactVersionRefV1>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let complete = false
  for (let page = 0; page < MAX_PAGES; page++) {
    context.signal?.throwIfAborted()
    const listed = researchCheckpointListResultV1Schema.parse(await context.capabilities.invoke(listContract, {
      runtimeId: scope.runtimeId, threadId: scope.threadId, limit: PAGE_SIZE, ...(cursor ? { cursor } : {})
    }, options))
    if (!listed.ok) throw new Error(`Checkpoint projection unavailable: ${listed.issue.message}`)
    for (const entry of listed.value.records) {
      assertScope(entry, scope)
      const sourceTurns = entry.manifest.recording.origin === 'legacy-import'
        ? entry.manifest.importedTurnIds ?? [] : [entry.manifest.turn.turnId]
      if (!sourceTurns.every(turnId => scope.knownTurnIds.includes(turnId))) {
        if (entry.manifest.recording.origin === 'legacy-import') continue
        throw new Error('Checkpoint belongs to a turn outside the fixed source scope; reread before acknowledging lifecycle events.')
      }
      const versionId = entry.status.artifactRef.versionId
      const previous = checkpointRefs.get(versionId)
      if (previous) {
        if (!sameRef(previous, entry.status.artifactRef)) throw new Error('Checkpoint pages conflict on an exact version reference.')
        continue
      }
      const read = researchCheckpointReadResultV1Schema.parse(await context.capabilities.invoke(readContract, { versionId }, options))
      if (!read.ok) throw new Error(`Checkpoint exact read unavailable: ${read.issue.message}`)
      const record = read.value
      assertScope(record, scope)
      if (!sameRef(entry.status.artifactRef, record.status.artifactRef) || entry.status.operationId !== record.status.operationId ||
        entry.manifest.recording.workspaceBindingDigest !== record.manifest.recording.workspaceBindingDigest) {
        throw new Error('Checkpoint exact read does not match its listed immutable record.')
      }
      checkpointRefs.set(versionId, record.status.artifactRef)
      const candidates = checkpointReferences(record)
      for (const ref of candidates) {
        const existing = refs.get(ref.versionId)
        if (existing) {
          if (!sameRef(existing.ref, ref)) throw new Error('Checkpoint references conflict on an exact Artifact version.')
          existing.checkpoints.add(versionId)
        } else {
          if (refs.size >= MAX_REFS) throw new Error('Checkpoint projection exceeds its reference budget; lifecycle coverage remains pending.')
          refs.set(ref.versionId, { ref, checkpoints: new Set([versionId]) })
        }
      }
    }
    const next = listed.value.nextCursor
    if (!next) { complete = true; break }
    if (seenCursors.has(next) || next === cursor) throw new Error('Checkpoint owner returned a repeated pagination cursor.')
    seenCursors.add(next)
    cursor = next
  }
  if (!complete) throw new Error('Checkpoint projection exceeds its page budget; lifecycle coverage remains pending.')
  if (scope.knownTurnIds.length > 1600) throw new Error('Checkpoint projection exceeds its turn budget; lifecycle coverage remains pending.')
  for (const turnId of new Set(scope.knownTurnIds)) {
    context.signal?.throwIfAborted()
    const current = researchCheckpointTurnStatusResultV1Schema.parse(await context.capabilities.invoke(turnStatusContract,
      { runtimeId: scope.runtimeId, threadId: scope.threadId, turnId }, options))
    if (!current.ok) throw new Error(`Checkpoint turn status unavailable: ${current.issue.message}`)
    const status = current.value
    if (status.runtimeId !== scope.runtimeId || status.threadId !== scope.threadId || status.turnId !== turnId) throw new Error('Checkpoint status returned another turn scope.')
    if (status.state === 'pending' || status.state === 'failed' && status.retryable) {
      throw new Error('Checkpoint archival has not settled; lifecycle coverage remains pending.')
    }
    if (status.state === 'committed') {
      const listed = checkpointRefs.get(status.artifactRef.versionId)
      if (!listed || !sameRef(listed, status.artifactRef)) throw new Error('Checkpoint changed during projection; reread before acknowledging lifecycle events.')
    }
  }
  const additions: Readonly<Record<string, unknown>>[] = []
  for (const { ref, checkpoints } of [...refs.values()].sort((a, b) => a.ref.versionId.localeCompare(b.ref.versionId))) {
    context.signal?.throwIfAborted()
    const verified = await verifyArtifactVersionRef(ref, scope.workspaceRoot, root => artifactVersionReadPort(context, root))
    if (!verified.ok) throw new Error(`Checkpoint Artifact verification unavailable: ${verified.issue.message}`)
    additions.push(Object.freeze({
      id: `research-checkpoint-artifact:${ref.versionId}`,
      source_item_id: `research-checkpoint-artifact:${ref.versionId}`,
      type: 'artifact',
      content: verified.record.artifact?.label || '已归档材料',
      artifactVersionRef: verified.record.ref,
      researchCheckpointVersions: [...checkpoints].sort(),
      evidenceArtifactVersions: { status: 'ready', versions: [verified.record], lifecycleEvents: [] }
    }))
  }
  const result = [...trace]
  for (const item of additions) {
    const existing = result.find(source => source.id === item.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error('Checkpoint projection trace identity conflicts with existing source data.')
    if (!existing) result.push(item)
  }
  context.signal?.throwIfAborted()
  return result
}

function checkpointReferences(record: ResearchCheckpointRecordV1): ArtifactVersionRefV1[] {
  const manifest = record.manifest
  return [record.status.artifactRef,
        ...manifest.declaredFiles.flatMap(file => file.artifactVersionRef ? [file.artifactVersionRef] : []),
        ...manifest.sources.flatMap(source => source.artifactVersionRef ? [source.artifactVersionRef] : []),
        ...manifest.artifactDependencies.map(dependency => dependency.ref),
        ...manifest.computeRuns.flatMap(run => [run.specRef, run.receiptRef].filter((ref): ref is ArtifactVersionRefV1 => Boolean(ref)))]
}

/** Bounded record-inspector bridge; an unavailable archive never replaces raw source content. */
export async function readCheckpointTurnArtifactReferences(
  context: DomainMainRuntimeLifecycleContext,
  scope: Scope,
  limit = 8
): Promise<{ refs: ArtifactVersionRefV1[]; limited: boolean }> {
  const refs = new Map<string, ArtifactVersionRefV1>()
  const turns = [...new Set(scope.knownTurnIds)]
  const budget = Math.min(8, Math.max(1, limit))
  let limited = turns.length > 8
  const options = { workspaceId: scope.workspaceRoot }
  for (const turnId of turns.slice(0, 8)) {
    try {
      context.signal?.throwIfAborted()
      const response = researchCheckpointTurnStatusResultV1Schema.parse(await context.capabilities.invoke(turnStatusContract,
        { runtimeId: scope.runtimeId, threadId: scope.threadId, turnId }, options))
      if (!response.ok) { limited = true; continue }
      const status = response.value
      if (status.runtimeId !== scope.runtimeId || status.threadId !== scope.threadId || status.turnId !== turnId) throw new Error('Checkpoint status returned another turn scope.')
      if (status.state === 'unrecorded') continue
      if (status.state !== 'committed') { limited = true; continue }
      const result = researchCheckpointReadResultV1Schema.parse(await context.capabilities.invoke(readContract,
        { versionId: status.artifactRef.versionId }, options))
      if (!result.ok) { limited = true; continue }
      const record = result.value
      assertScope(record, scope)
      if (record.manifest.turn.turnId !== turnId || !sameRef(status.artifactRef, record.status.artifactRef)) throw new Error('Checkpoint read returned another archived version.')
      const candidates = checkpointReferences(record)
      for (const ref of candidates) {
        const existing = refs.get(ref.versionId)
        if (existing) { if (!sameRef(existing, ref)) throw new Error('Conflicting Artifact identity'); continue }
        if (refs.size >= budget) { limited = true; continue }
        const verified = await verifyArtifactVersionRef(ref, scope.workspaceRoot, root => artifactVersionReadPort(context, root))
        if (!verified.ok) { limited = true; continue }
        refs.set(ref.versionId, verified.record.ref)
      }
    } catch {
      limited = true
    }
  }
  return { refs: [...refs.values()], limited }
}
