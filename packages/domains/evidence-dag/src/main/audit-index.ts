import { resolve } from 'node:path'
import type { EvidenceDeltaChain } from './evidence-delta.js'
import type { EvidenceDagAuditQuerySubject } from '../contract.js'
import { evidenceDagAuditQueryOverChains } from './audit-query.js'
import { scientificReview } from './scientific-review.js'

export const artifactIdentityKey = (ref: { artifactId: string; versionId: string; contentDigest: string }) => JSON.stringify([ref.artifactId, ref.versionId, ref.contentDigest])

export type WorkBudget = { remaining: number; visited: number; textUnits: number; bounded: boolean }
export const workBudget = (remaining = 10000): WorkBudget => ({ remaining, visited: 0, textUnits: 0, bounded: false })
export function spend(budget: WorkBudget): boolean {
  if (budget.remaining <= 0) { budget.bounded = true; return false }
  budget.remaining--; budget.visited++; return true
}
/** Lazy traversal bounds depth and every value, including scalar and array entries. */
export function walkBounded(value: unknown, budget: WorkBudget, visit: (v: Record<string, unknown>) => void, leaf?: (v: unknown) => void): void {
  function* children(item: object): Generator<unknown> {
    if (Array.isArray(item)) { for (let i = 0; i < item.length; i++) yield item[i]; return }
    for (const key in item) if (Object.hasOwn(item, key)) { budget.textUnits += key.length; yield (item as Record<string, unknown>)[key] }
  }
  const stack: { iterator: Iterator<unknown>; depth: number }[] = [{ iterator: [value][Symbol.iterator](), depth: 0 }]
  while (stack.length) {
    const frame = stack[stack.length - 1], next = frame.iterator.next()
    if (next.done) { stack.pop(); continue }
    if (!spend(budget)) return
    const item = next.value
    if (typeof item === 'string') { budget.textUnits += item.length; if (item.length > 16000 || budget.textUnits > 640000) budget.bounded = true }
    if (!item || typeof item !== 'object') { leaf?.(item); continue }
    if (frame.depth > 64) { budget.bounded = true; continue }
    if (!Array.isArray(item)) visit(item as Record<string, unknown>)
    stack.push({ iterator: children(item), depth: frame.depth + 1 })
  }
}

type Delta = ReturnType<EvidenceDeltaChain['list']>[number]
type Closure = ReturnType<EvidenceDeltaChain['closures']>[number]
type RecordRow = ReturnType<EvidenceDeltaChain['sidechainRecords']>[number]
export type MaterialChange = { sequence: number; digest: string; sourceId: string; reason: string; artifactId?: string; contentDigest?: string; lifecycle?: boolean }
function empty() {
  return { revision: -1, records: [] as RecordRow[], deltas: [] as Delta[],
    deltaByDigest: new Map<string, Delta>(), closuresByDigest: new Map<string, Closure>(),
    recordsByClosure: new Map<string, RecordRow[]>(), recordsByArtifact: new Map<string, RecordRow[]>(),
    deltaKeys: new Map<string, Set<string>>(), closureKeys: new Map<string, Set<string>>(),
    recordKeys: new Map<string, Set<string>>(),
    downstream: new Map<string, Set<string>>(), upstream: new Map<string, Set<string>>(),
    edgesByDelta: new Map<string, { source: string; target: string }[]>(),
    sourceIdentitiesByDelta: new Map<string, Map<string, Set<string>>>(), changesBySource: new Map<string, MaterialChange[]>(),
    labels: new Map<string, string>(), seenEvents: new Set<string>(),
    addedArtifactKeys: new Set<string>(), addedClosureKeys: new Set<string>(), recordCosts: new Map<string, number>(), metadataByIdentity: new Map<string, Set<string>>(), identityConflicts: new Set<string>(), extractionBounded: false, pending: false, extractionNodes: 0, totalDeltas: 0 }
}
const snapshots = new WeakMap<EvidenceDeltaChain, ReturnType<typeof empty>>()
export function auditSnapshot(chain: EvidenceDeltaChain, advance = false, limit = 2048) {
  let index = snapshots.get(chain)
  if (!index) { index = empty(); snapshots.set(chain, index) }
  if (index.revision === chain.auditRevision && (!advance || !index.pending)) return index
  const suffix = chain.auditSuffix({ deltas: index.deltas.length, closures: index.closuresByDigest.size, records: index.records.length }, limit)
  index.extractionNodes = 0; index.addedArtifactKeys.clear(); index.addedClosureKeys.clear()
  const addRecord = (key: string, record: RecordRow) => { const rows = index.recordsByArtifact.get(key) ?? []; index.addedArtifactKeys.add(key); rows.push(record); index.recordsByArtifact.set(key, rows) }
  let extractedNodes: Record<string, unknown>[] = []
  const extract = (value: unknown, digest: string) => {
    const budget = workBudget(), keys = new Set<string>()
    extractedNodes = []
    walkBounded(value, budget, row => {
      if (['id', 'source', 'src', 'from', 'target', 'dst', 'to', 'targetRecordId', 'eventId', 'versionId', 'previousVersionId', 'artifactId'].some(key => typeof row[key] === 'string' && (row[key] as string).length > 512)) { budget.bounded = true; return }
      extractedNodes.push(row)
      if (typeof row.artifactId === 'string' && typeof row.versionId === 'string' && typeof row.contentDigest === 'string') {
        if (row.artifactId.length > 512 || row.versionId.length > 512 || row.contentDigest.length > 128) { budget.bounded = true; return }
        const key = artifactIdentityKey(row as { artifactId: string; versionId: string; contentDigest: string })
        keys.add(key)
        if (typeof row.byteLength === 'number' && row.accessPolicy && typeof row.accessPolicy === 'object') {
          const policy = row.accessPolicy as Record<string, unknown>
          const principals = Array.isArray(policy.principals) ? policy.principals : []
          if (typeof policy.visibility !== 'string' || policy.visibility.length > 64 || typeof policy.allowExport !== 'boolean' || principals.length > 100 || principals.some(p => typeof p !== 'string' || p.length > 512)) { budget.bounded = true; return }
          const fingerprint = JSON.stringify([row.byteLength, policy.visibility, [...principals].sort(), policy.allowExport])
          const seen = index.metadataByIdentity.get(key) ?? new Set<string>(); seen.add(fingerprint); index.metadataByIdentity.set(key, seen)
          if (seen.size > 1) index.identityConflicts.add(key)
        }
      }
    })
    index.extractionNodes += budget.visited; index.extractionBounded ||= budget.bounded
    index.recordCosts.set(digest, budget.bounded ? 10001 : budget.visited + Math.ceil(budget.textUnits / 64)); return keys
  }
  for (const delta of suffix.deltas) {
    index.deltas.push(delta); index.deltaByDigest.set(delta.deltaDigest, delta)
    index.deltaKeys.set(delta.deltaDigest, extract(delta.payload, delta.deltaDigest))
    const edges: { source: string; target: string }[] = []
    const sourceIdentities = new Map<string, Set<string>>()
    const change = (value: MaterialChange) => { const rows = index.changesBySource.get(value.sourceId) ?? []; rows.push(value); index.changesBySource.set(value.sourceId, rows) }
    for (const row of extractedNodes) {
      if (typeof row.id === 'string') {
        const label = row.title ?? row.content ?? row.text ?? row.id
        index.labels.set(row.id, typeof label === 'string' ? label.slice(0, 300) : row.id)
        const ref = row.ref ?? row.artifactVersionRef
        if (ref && typeof ref === 'object') {
          const value = ref as Record<string, unknown>
          if (typeof value.artifactId === 'string' && value.artifactId.length <= 512 && typeof value.versionId === 'string' && value.versionId.length <= 512 && typeof value.contentDigest === 'string' && value.contentDigest.length <= 128) { const keys = sourceIdentities.get(row.id) ?? new Set<string>(); keys.add(artifactIdentityKey(value as { artifactId: string; versionId: string; contentDigest: string })); sourceIdentities.set(row.id, keys) }
        }
      }
      const source = row.source ?? row.src ?? row.from, target = row.target ?? row.dst ?? row.to, family = row.family ?? row.edgeFamily ?? row.rel ?? row.type
      if (typeof source === 'string' && typeof target === 'string' && ['supports', 'provenance', 'derived_from'].includes((typeof family === 'string' ? family : ''))) {
        edges.push({ source, target })
        const down = index.downstream.get(source) ?? new Set<string>(); down.add(target); index.downstream.set(source, down)
        const up = index.upstream.get(target) ?? new Set<string>(); up.add(source); index.upstream.set(target, up)
      }
      if (typeof row.targetRecordId === 'string' && ['corrects', 'supersedes', 'invalidates', 'retracts', 'refines'].includes((typeof row.relation === 'string' ? row.relation : ''))) change({ sequence: delta.sequence, digest: delta.deltaDigest, sourceId: row.targetRecordId, reason: (typeof row.reason === 'string' ? row.reason : typeof row.relation === 'string' ? row.relation : '').slice(0, 4000) })
      if (typeof row.eventId === 'string' && !index.seenEvents.has(row.eventId)) {
        index.seenEvents.add(row.eventId)
        const sourceId = row.previousVersionId ?? row.versionId
        const detail = row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : {}
        // Current/new bytes cannot identify the previous version in a change event.
        // Canonical lifecycle digest metadata belongs to event.detail.
        const contentDigest = row.previousVersionId
          ? detail.previousContentDigest ?? row.previousContentDigest
          : detail.contentDigest ?? row.contentDigest
        if (typeof sourceId === 'string' && ['current-changed', 'artifact-content-changed', 'artifact-missing', 'availability-changed'].includes((typeof row.type === 'string' ? row.type : ''))) change({ sequence: delta.sequence, digest: delta.deltaDigest, sourceId, reason: (typeof row.type === 'string' ? row.type : ''), lifecycle: true,
          ...(typeof row.artifactId === 'string' ? { artifactId: row.artifactId } : {}), ...(typeof contentDigest === 'string' ? { contentDigest } : {}) })
      }
      if (typeof row.id === 'string' && ['invalidated', 'weakened', 'now-conflicted'].includes((typeof row.effect === 'string' ? row.effect : ''))) change({ sequence: delta.sequence, digest: delta.deltaDigest, sourceId: row.id, reason: 'Formal reconcile: ' + (typeof row.effect === 'string' ? row.effect : '') })
    }
    index.edgesByDelta.set(delta.deltaDigest, edges); index.sourceIdentitiesByDelta.set(delta.deltaDigest, sourceIdentities)
  }
  for (const closure of suffix.closures) {
    index.closuresByDigest.set(closure.closureDigest, closure); index.addedClosureKeys.add(closure.closureDigest)
    const keys = extract(closure, closure.closureDigest)
    const membershipBudget = workBudget()
    for (const digest of closure.includedDeltaDigests) { if (!spend(membershipBudget)) break; for (const key of index.deltaKeys.get(digest) ?? []) { if (!spend(membershipBudget)) break; keys.add(key) } }
    index.extractionBounded ||= membershipBudget.bounded; index.extractionNodes += membershipBudget.visited
    index.closureKeys.set(closure.closureDigest, keys)
  }
  for (const record of suffix.records) {
    index.records.push(record)
    const rows = index.recordsByClosure.get(record.closureDigest) ?? []; rows.push(record); index.recordsByClosure.set(record.closureDigest, rows)
    const keys = extract(record.payload, record.recordDigest); index.recordKeys.set(record.recordDigest, keys)
    for (const key of new Set([...keys, ...index.closureKeys.get(record.closureDigest) ?? []])) addRecord(key, record)
  }
  index.totalDeltas = suffix.totals.deltas
  index.pending = index.deltas.length < suffix.totals.deltas || index.records.length < suffix.totals.records || index.closuresByDigest.size < suffix.totals.closures
  index.revision = chain.auditRevision
  return index
}

/** Store-owned suffix index; membership updates and eviction affect only that chain.
 * Bounded bootstrap is explicit; immutable history is never copied on warm reads. */
export class OwnerAuditIndex {
  private members = new Map<string, { chain: EvidenceDeltaChain; revision: number; stamp: number; artifactKeys: Set<string>; closureKeys: Set<string> }>()
  private artifacts = new Map<string, EvidenceDeltaChain[]>()
  private closures = new Map<string, EvidenceDeltaChain[]>()
  private results = new Map<string, { evaluation: ReturnType<typeof evidenceDagAuditQueryOverChains>; review: ReturnType<typeof scientificReview> }>()
  private revision = 0
  query(chains: ReadonlyMap<string, EvidenceDeltaChain>, subject: EvidenceDagAuditQuerySubject, workspaceRoot?: string) {
    let indexedWork = 0, extractionNodes = 0, remainingIndexItems = 2048
    const remove = (member: { chain: EvidenceDeltaChain; artifactKeys: Set<string>; closureKeys: Set<string> }) => {
      for (const [map, keys] of [[this.artifacts, member.artifactKeys], [this.closures, member.closureKeys]] as const) for (const key of keys) {
        const rest = (map.get(key) ?? []).filter(c => c !== member.chain); if (rest.length) map.set(key, rest); else map.delete(key)
      }
    }
    for (const [id, member] of this.members) if (chains.get(id) !== member.chain) { remove(member); this.members.delete(id) }
    for (const [id, chain] of chains) {
      const prior = this.members.get(id), before = snapshots.get(chain), priorRecords = before?.records.length ?? 0, priorDeltas = before?.deltas.length ?? 0, priorClosures = before?.closuresByDigest.size ?? 0
      const didRefresh = !before || before.revision !== chain.auditRevision || before.pending
      if (prior?.chain === chain && prior.revision === chain.auditRevision && !before?.pending) continue
      const index = auditSnapshot(chain, true, remainingIndexItems)
      remainingIndexItems -= index.closuresByDigest.size - priorClosures + index.deltas.length - priorDeltas + index.records.length - priorRecords
      indexedWork += index.deltas.length - priorDeltas; extractionNodes += didRefresh ? index.extractionNodes : 0
      const member = prior ?? { chain, revision: chain.auditRevision, stamp: 0, artifactKeys: new Set<string>(), closureKeys: new Set<string>() }
      member.revision = chain.auditRevision; member.stamp = ++this.revision
      this.members.set(id, member)
      for (const key of prior ? index.addedArtifactKeys : index.recordsByArtifact.keys()) { const members = this.artifacts.get(key) ?? []; if (!members.includes(chain)) members.push(chain); this.artifacts.set(key, members); member.artifactKeys.add(key) }
      for (const key of prior ? index.addedClosureKeys : index.closuresByDigest.keys()) { const members = this.closures.get(key) ?? []; if (!members.includes(chain)) members.push(chain); this.closures.set(key, members); member.closureKeys.add(key) }
    }
    const candidates = ('threadId' in subject ? [chains.get(subject.threadId)].filter((c): c is EvidenceDeltaChain => Boolean(c))
      : 'closureDigest' in subject ? this.closures.get(subject.closureDigest) ?? [] : this.artifacts.get(artifactIdentityKey(subject.artifactVersionRef)) ?? [])
      .filter(chain => !workspaceRoot || Boolean(chain.workspaceRoot && resolve(chain.workspaceRoot) === resolve(workspaceRoot)))
    // Incomplete identity extraction is a conservative candidate, never authoritative absence.
    if (!('threadId' in subject)) for (const chain of chains.values()) {
      const index = snapshots.get(chain)
      if ((index?.pending || index?.extractionBounded) && (!workspaceRoot || chain.workspaceRoot && resolve(chain.workspaceRoot) === resolve(workspaceRoot)) && !candidates.includes(chain)) candidates.push(chain)
    }
    const scopeUnknown = Boolean(workspaceRoot && [...chains.values()].some(chain => !chain.workspaceRoot && ('threadId' in subject ? chain.head.threadId === subject.threadId : true)))
    const key = JSON.stringify([scopeUnknown, subject, workspaceRoot ? resolve(workspaceRoot) : null, candidates.map(chain => this.members.get(chain.head.threadId)?.stamp)])
    const previous = this.results.get(key)
    if (previous) {
      const result = structuredClone(previous)
      if (result.review.coverageDetails) { result.review.coverageDetails.queryNodes = 0; result.review.coverageDetails.scannedDeltas = indexedWork; result.review.coverageDetails.extractionNodes = extractionNodes }
      return result
    }
    let evaluation = evidenceDagAuditQueryOverChains({ chains: candidates, subject, workspaceRoot })
    if (scopeUnknown) evaluation = { ...evaluation, complete: false, gapCodes: [...evaluation.gapCodes, 'workspace_scope_unknown'] }
    const review = scientificReview(candidates, [...evaluation.records])
    if (evaluation.gapCodes.includes('scan_bounded') || evaluation.gapCodes.includes('identity_metadata_conflict')) {
      review.bounded = true
      review.coverageDetails!.reasons.push(...evaluation.gapCodes.filter(code => code === 'scan_bounded' || code === 'identity_metadata_conflict'))
      for (const impact of review.impacts) if (impact.status === 'no-recorded-impact') impact.status = 'unknown'
    }
    review.coverageDetails!.omittedRecords += Math.max(0, (evaluation.totalRecords ?? evaluation.records.length) - evaluation.records.length)
    review.coverageDetails = { ...review.coverageDetails!, indexRevision: this.revision, scannedDeltas: indexedWork, extractionNodes }
    const result = { evaluation, review }
    if (this.results.size >= 32) this.results.delete(this.results.keys().next().value!)
    this.results.set(key, result)
    return structuredClone(result)
  }
}
