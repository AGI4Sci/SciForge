import { auditSnapshot, artifactIdentityKey } from './audit-index.js'
import { resolve } from 'node:path'
import type {
  EvidenceDagAuditQueryOutput,
  EvidenceDagAuditQuerySubject,
  EvidenceDagSidechainRecordV1
} from '../contract.js'
import type { EvidenceDeltaChain } from './evidence-delta.js'

/** Result examination budget after exact indexing. Unrelated history spends
 * no query units. Truncated results carry scan_bounded and are never complete. */
export const EVIDENCE_DAG_AUDIT_SCAN_LIMIT = 1000

const AUDIT_FRESHNESS_ORDER = ['failed', 'stale', 'fresh', 'pending', 'unknown'] as const

/**
 * Cross-domain facets a subject kind would additionally need for a complete
 * `research-audit.query` answer. This action is the Evidence read port only;
 * the facet owner ports are aggregated later by the host, so each facet is
 * reported as unavailable instead of being silently omitted.
 */
const SUBJECT_FACET_GAP_CODES: Readonly<Record<string, readonly string[]>> = {
  closureDigest: ['source_unavailable:project'],
  artifactVersionRef: ['source_unavailable:checkpoint'],
  threadId: []
}

export type EvidenceDagAuditFreshness = EvidenceDagAuditQueryOutput['freshness']

export type EvidenceDagAuditQueryEvaluation = Readonly<{
  records: readonly EvidenceDagSidechainRecordV1[]
  complete: boolean
  gapCodes: readonly string[]
  freshness: EvidenceDagAuditFreshness
  totalRecords?: number
}>

type ArtifactVersionIdentity = Readonly<{
  artifactId: string
  versionId: string
  contentDigest: string
}>

type ScanBudget = {
  remaining: number
  projectionRemaining: number
  truncated: boolean
}

function createScanBudget(): ScanBudget {
  return { remaining: EVIDENCE_DAG_AUDIT_SCAN_LIMIT, projectionRemaining: 10000, truncated: false }
}

/** Consume one scan unit; false means the budget is exhausted. */
function consumeScan(budget: ScanBudget): boolean {
  if (budget.truncated) return false
  if (budget.remaining <= 0) {
    budget.truncated = true
    return false
  }
  budget.remaining -= 1
  return true
}

function consumeRecord(budget: ScanBudget, chain: EvidenceDeltaChain, record: EvidenceDagSidechainRecordV1): boolean {
  if (!consumeScan(budget)) return false
  const cost = auditSnapshot(chain).recordCosts.get(record.recordDigest) ?? 10001
  if (cost > budget.projectionRemaining) { budget.truncated = true; return false }
  budget.projectionRemaining -= cost; return true
}

/**
 * Evidence-side evaluation of one audit query subject over read-only chain
 * views. Pure: callers must supply chains obtained from a read path (for
 * example the canonical store-owned audit index); this function
 * never mutates and never persists.
 */
export function evidenceDagAuditQueryOverChains(input: Readonly<{
  chains: readonly EvidenceDeltaChain[]
  subject: EvidenceDagAuditQuerySubject
  workspaceRoot?: string
}>): EvidenceDagAuditQueryEvaluation {
  const subject = input.subject
  const scopedChains = input.chains.filter((chain) => chainInWorkspace(chain, input.workspaceRoot))
  const scopeUnknown = Boolean(input.workspaceRoot && input.chains.some(chain => !chain.workspaceRoot))
  const uncertain = scopedChains.some(chain => { const index = auditSnapshot(chain); return index.pending || index.extractionBounded })
  const metadataConflict = 'artifactVersionRef' in subject && scopedChains.some(chain => {
    const ref = subject.artifactVersionRef, index = auditSnapshot(chain), key = artifactIdentityKey(ref)
    const fingerprint = JSON.stringify([ref.byteLength, ref.accessPolicy.visibility, [...ref.accessPolicy.principals].sort(), ref.accessPolicy.allowExport])
    const known = index.metadataByIdentity.get(key)
    return index.identityConflicts.has(key) || Boolean(known?.size && !known.has(fingerprint))
  })
  const totalRecords = scopedChains.reduce((sum, chain) => {
    const index = auditSnapshot(chain)
    if ('threadId' in subject) return sum + (chain.head.threadId === subject.threadId ? index.records.length : 0)
    if ('closureDigest' in subject) return sum + (index.recordsByClosure.get(subject.closureDigest)?.length ?? 0)
    return sum + (index.recordsByArtifact.get(artifactIdentityKey(subject.artifactVersionRef))?.length ?? 0)
  }, 0)
  const finish = (result: EvidenceDagAuditQueryEvaluation): EvidenceDagAuditQueryEvaluation => {
    const gapCodes = [...new Set([...result.gapCodes, ...(uncertain ? ['scan_bounded'] : []), ...(metadataConflict ? ['identity_metadata_conflict'] : []), ...(scopeUnknown ? ['workspace_scope_unknown'] : [])])]
    return { ...result, totalRecords, complete: result.complete && !uncertain && !metadataConflict && !scopeUnknown, gapCodes }
  }
  if ('threadId' in subject) return finish(evaluateThreadSubject(scopedChains, subject))
  const budget = createScanBudget()
  if ('closureDigest' in subject) {
    return finish(evaluateClosureSubject(scopedChains, subject.closureDigest, budget))
  }
  return finish(evaluateArtifactVersionSubject(scopedChains, subject.artifactVersionRef, budget))
}

function evaluateThreadSubject(
  chains: readonly EvidenceDeltaChain[],
  subject: Readonly<{ threadId: string; headDigest?: string }>
): EvidenceDagAuditQueryEvaluation {
  const chain = chains.find((candidate) => candidate.head.threadId === subject.threadId)
  if (!chain) {
    return { records: [], freshness: 'unknown', ...facetCompleteness('threadId', false) }
  }
  const budget = createScanBudget(), selected: EvidenceDagSidechainRecordV1[] = []
  for (const record of auditSnapshot(chain).records) { if (!consumeRecord(budget, chain, record)) break; selected.push(record) }
  return {
    records: sortAuditRecords(selected),
    freshness: deriveFreshness(chain, subject.headDigest ?? null),
    ...facetCompleteness('threadId', budget.truncated)
  }
}

function evaluateClosureSubject(
  chains: readonly EvidenceDeltaChain[],
  closureDigest: string,
  budget: ScanBudget
): EvidenceDagAuditQueryEvaluation {
  let records: readonly EvidenceDagSidechainRecordV1[] = []
  let freshness: EvidenceDagAuditFreshness = 'unknown'
  for (const chain of chains) {
    if (budget.truncated) break
    if (!consumeScan(budget)) break
    const closure = auditSnapshot(chain).closuresByDigest.get(closureDigest)
    if (!closure) continue
    const candidates = auditSnapshot(chain).recordsByClosure.get(closureDigest) ?? []
    const selected: EvidenceDagSidechainRecordV1[] = []
    for (const record of candidates) { if (!consumeRecord(budget, chain, record)) break; selected.push(record) }
    records = sortAuditRecords(selected)
    freshness = deriveFreshness(chain, closure.headDigest)
    break
  }
  return {
    records,
    freshness,
    ...facetCompleteness('closureDigest', budget.truncated)
  }
}

function evaluateArtifactVersionSubject(
  chains: readonly EvidenceDeltaChain[],
  ref: ArtifactVersionIdentity,
  budget: ScanBudget
): EvidenceDagAuditQueryEvaluation {
  const recordsByDigest = new Map<string, EvidenceDagSidechainRecordV1>()
  const contributingChains = new Set<EvidenceDeltaChain>()
  for (const chain of chains) {
    if (budget.truncated) break
    let chainContributed = false
    for (const record of auditSnapshot(chain).recordsByArtifact.get(artifactIdentityKey(ref)) ?? []) {
      if (recordsByDigest.has(record.recordDigest)) continue
      if (!consumeRecord(budget, chain, record)) break
      recordsByDigest.set(record.recordDigest, record)
      chainContributed = true
    }
    if (chainContributed) contributingChains.add(chain)
  }
  return {
    records: sortAuditRecords([...recordsByDigest.values()]),
    freshness: rollupFreshness([...contributingChains].map((chain) => deriveFreshness(chain, null))),
    ...facetCompleteness('artifactVersionRef', budget.truncated)
  }
}

function facetCompleteness(kind: string, truncated: boolean): Readonly<{
  complete: boolean
  gapCodes: readonly string[]
}> {
  const gapCodes = [...(SUBJECT_FACET_GAP_CODES[kind] ?? [])]
  if (truncated) gapCodes.push('scan_bounded')
  return { complete: gapCodes.length === 0, gapCodes }
}

/**
 * Freshness reuses the existing five-value derivation: a caller-declared head
 * that differs from the authoritative head is stale, otherwise the chain's
 * provisional summary freshness applies, falling back to pending for a known
 * head and unknown for an empty one (same rule as the canonical status read).
 */
function deriveFreshness(
  chain: EvidenceDeltaChain,
  expectedHeadDigest: string | null
): EvidenceDagAuditFreshness {
  const head = chain.head
  if (expectedHeadDigest && expectedHeadDigest !== head.headDigest) return 'stale'
  return chain.auditFreshness ?? (head.headDigest ? 'pending' : 'unknown')
}

function rollupFreshness(values: readonly EvidenceDagAuditFreshness[]): EvidenceDagAuditFreshness {
  if (!values.length) return 'unknown'
  for (const candidate of AUDIT_FRESHNESS_ORDER) {
    if (values.includes(candidate)) return candidate
  }
  return 'unknown'
}

function chainInWorkspace(chain: EvidenceDeltaChain, workspaceRoot?: string): boolean {
  if (!workspaceRoot) return true
  const workspace = chain.workspaceRoot
  // Legacy-only chains bind no delta workspace scope; their workspace is
  // unknown, so a workspace filter must not silently claim their records.
  if (!workspace) return false
  return resolve(workspace) === resolve(workspaceRoot)
}

function sortAuditRecords(
  records: readonly EvidenceDagSidechainRecordV1[]
): readonly EvidenceDagSidechainRecordV1[] {
  const unique = new Map<string, EvidenceDagSidechainRecordV1>()
  for (const record of records) unique.set(record.recordDigest, record)
  return [...unique.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.sequence - right.sequence ||
    left.recordDigest.localeCompare(right.recordDigest)
  )
}
