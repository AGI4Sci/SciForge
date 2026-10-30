import { resolve } from 'node:path'
import type {
  EvidenceDagAuditQueryOutput,
  EvidenceDagAuditQuerySubject,
  EvidenceDagSealedClosure,
  EvidenceDagSidechainRecordV1
} from '../contract.js'
import type { EvidenceDeltaChain } from './evidence-delta.js'

/**
 * Hard budget for the cross-thread audit scan. One unit is consumed per
 * closure examined (including its membership/policy object), per member-delta
 * payload examined, and per sidechain record examined. When the budget is
 * exhausted the scan stops, everything not yet examined is dropped, and the
 * result carries the 'scan_bounded' gap code instead of pretending the scan
 * was exhaustive.
 */
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
}>

type ArtifactVersionIdentity = Readonly<{
  artifactId: string
  versionId: string
  contentDigest: string
}>

type ScanBudget = {
  remaining: number
  truncated: boolean
}

function createScanBudget(): ScanBudget {
  return { remaining: EVIDENCE_DAG_AUDIT_SCAN_LIMIT, truncated: false }
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

/**
 * Evidence-side evaluation of one audit query subject over read-only chain
 * views. Pure: callers must supply chains obtained from a read path (for
 * example `EvidenceDagDeltaStore.chain()` / `auditChains()`); this function
 * never mutates and never persists.
 */
export function evidenceDagAuditQueryOverChains(input: Readonly<{
  chains: readonly EvidenceDeltaChain[]
  subject: EvidenceDagAuditQuerySubject
  workspaceRoot?: string
}>): EvidenceDagAuditQueryEvaluation {
  const subject = input.subject
  const scopedChains = input.chains.filter((chain) => chainInWorkspace(chain, input.workspaceRoot))
  if ('threadId' in subject) return evaluateThreadSubject(scopedChains, subject)
  const budget = createScanBudget()
  if ('closureDigest' in subject) {
    return evaluateClosureSubject(scopedChains, subject.closureDigest, budget)
  }
  return evaluateArtifactVersionSubject(scopedChains, subject.artifactVersionRef, budget)
}

function evaluateThreadSubject(
  chains: readonly EvidenceDeltaChain[],
  subject: Readonly<{ threadId: string; headDigest?: string }>
): EvidenceDagAuditQueryEvaluation {
  const chain = chains.find((candidate) => candidate.head.threadId === subject.threadId)
  if (!chain) {
    return { records: [], freshness: 'unknown', ...facetCompleteness('threadId', false) }
  }
  return {
    records: sortAuditRecords(chain.sidechainRecords()),
    freshness: deriveFreshness(chain, subject.headDigest ?? null),
    ...facetCompleteness('threadId', false)
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
    let closure: EvidenceDagSealedClosure | undefined
    for (const candidate of chain.closures()) {
      if (!consumeScan(budget)) break
      if (candidate.closureDigest === closureDigest) {
        closure = candidate
        break
      }
    }
    if (!closure) continue
    records = sortAuditRecords(chain.sidechainRecords().filter(
      (record) => record.closureDigest === closureDigest
    ))
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
    const deltas = new Map(chain.list().map((record) => [record.deltaDigest, record]))
    let chainContributed = false
    for (const closure of chain.closures()) {
      if (!consumeScan(budget)) break
      const closureReferences = closureReferencesArtifactVersion(closure, ref) ||
        closure.includedDeltaDigests.some((deltaDigest) => {
          if (!consumeScan(budget)) return false
          const record = deltas.get(deltaDigest)
          return Boolean(record && valueReferencesArtifactVersion(record.payload, ref))
        })
      if (!closureReferences) continue
      for (const record of chain.sidechainRecords()) {
        if (!consumeScan(budget)) break
        if (record.closureDigest !== closure.closureDigest) continue
        recordsByDigest.set(record.recordDigest, record)
        chainContributed = true
      }
    }
    for (const record of chain.sidechainRecords()) {
      if (!consumeScan(budget)) break
      if (!valueReferencesArtifactVersion(record.payload, ref)) continue
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
  return chain.provisionalView?.summary.freshness ?? (head.headDigest ? 'pending' : 'unknown')
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
  const first = chain.list()[0]
  // Legacy-only chains bind no delta workspace scope; their workspace is
  // unknown, so a workspace filter must not silently claim their records.
  if (!first) return true
  return resolve(first.scope.workspaceRoot) === resolve(workspaceRoot)
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

/**
 * A closure references an Artifact Version when its own structures carry the
 * exact identity: a structured ref object must match the full artifactId +
 * versionId + contentDigest triple, while a bare identity string in the
 * closure's declared membership/policy ref arrays matches on the version
 * identity — the only pin those index structures carry.
 */
function closureReferencesArtifactVersion(
  closure: EvidenceDagSealedClosure,
  ref: ArtifactVersionIdentity
): boolean {
  if (valueReferencesArtifactVersion(closure, ref)) return true
  const identities = [ref.artifactId, ref.versionId, ref.contentDigest]
  return [...closure.includedExternalRefs, ...closure.policy.requiredExternalRefs]
    .some((entry) => identities.includes(entry))
}

/**
 * Exact Artifact Version identity match over arbitrary JSON: a payload value
 * matches only when it contains an object carrying the exact artifactId +
 * versionId + contentDigest triple. No prefix, fuzzy, or per-field guess —
 * an honest scan, not a fabricated index. Closure-level string references are
 * matched separately, by exact membership of the ref identity in the
 * closure's declared ref arrays.
 */
function valueReferencesArtifactVersion(value: unknown, ref: ArtifactVersionIdentity): boolean {
  if (Array.isArray(value)) return value.some((item) => valueReferencesArtifactVersion(item, ref))
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (
      record['artifactId'] === ref.artifactId &&
      record['versionId'] === ref.versionId &&
      record['contentDigest'] === ref.contentDigest
    ) return true
    return Object.values(record).some((item) => valueReferencesArtifactVersion(item, ref))
  }
  return false
}
