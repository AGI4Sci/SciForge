import { resolve } from 'node:path'
import type { EvidenceDeltaChain } from './evidence-delta.js'
import { artifactIdentityKey, auditSnapshot } from './audit-index.js'
import type { EvidenceDagAuditQuerySubject } from '../contract.js'

export type AuditReadScope = { runtimeId: string; threadId: string; engineThreadId: string; snapshotDigest: string }
/** Scope selection uses the existing owner index and persisted closure bindings.
 * No thread-name inference, global sidecar discovery, or latest fallback for fixed heads. */
export function auditReadBindings(chains: readonly EvidenceDeltaChain[], subject: EvidenceDagAuditQuerySubject, workspaceRoot?: string) {
  const scopes: AuditReadScope[] = [], reasons = new Set<string>()
  if (!workspaceRoot) return { scopes, reasons: ['workspace_scope_unknown'] }
  let budget = 1000
  for (const chain of chains) {
    if (--budget < 0) { reasons.add('binding_scan_bounded'); break }
    if (!chain.workspaceRoot || resolve(chain.workspaceRoot) !== resolve(workspaceRoot)) continue
    const index = auditSnapshot(chain), identity = index.deltas[0]?.scope
    if (!identity) { reasons.add('thread_scope_unknown'); continue }
    if (index.pending || index.extractionBounded) reasons.add('binding_index_bounded')
    const add = (digest: string) => {
      if (scopes.some(scope => scope.engineThreadId === chain.head.threadId && scope.snapshotDigest === digest)) return
      if (scopes.length >= 32) { reasons.add('binding_scan_bounded'); return }
      scopes.push({ runtimeId: identity.runtimeId, threadId: identity.threadId, engineThreadId: chain.head.threadId, snapshotDigest: digest })
    }
    for (const [closureDigest, digest] of chain.committedSnapshotClosureEntries(budget + 1)) {
      if (--budget < 0) { reasons.add('binding_scan_bounded'); break }
      const closure = index.closuresByDigest.get(closureDigest)
      if (!closure) { reasons.add('binding_index_bounded'); continue }
      if ('closureDigest' in subject && subject.closureDigest !== closureDigest) continue
      if ('threadId' in subject && (subject.threadId !== chain.head.threadId || subject.headDigest && subject.headDigest !== closure.headDigest)) continue
      if ('artifactVersionRef' in subject && !index.closureKeys.get(closureDigest)?.has(artifactIdentityKey(subject.artifactVersionRef))) continue
      add(digest)
    }
    if ('artifactVersionRef' in subject && chain.committedEvidenceSnapshot) add(chain.committedEvidenceSnapshot.digest)
    if ('threadId' in subject && !subject.headDigest && subject.threadId === chain.head.threadId && chain.committedEvidenceSnapshot) add(chain.committedEvidenceSnapshot.digest)
  }
  if (!scopes.length) reasons.add('snapshot_binding_missing')
  if (!('closureDigest' in subject) && scopes.length) reasons.add('snapshot_history_coverage_limited')
  return { scopes, reasons: [...reasons].sort() }
}
