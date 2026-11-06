import { auditSnapshot, spend, walkBounded, workBudget } from './audit-index.js'
import type { ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'
import type { EvidenceDeltaChain } from './evidence-delta.js'
type Review = NonNullable<ResearchAuditEvidenceAuditQueryOutput['scientificReview']>
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))

/** Bounded projection of recorded material and dependency links. No extraction
 * model, scientific scoring, or second impact engine. Reconcile observations
 * remain observations; changed material requires review, never falsification. */
export function scientificReview(chains: readonly EvidenceDeltaChain[], records: ResearchAuditEvidenceAuditQueryOutput['records']): Review {
  const queryBudget = workBudget()
  let bounded = false
  const totalRelevantDeltas = chains.reduce((sum, chain) => sum + auditSnapshot(chain).totalDeltas, 0)
  const walk = (value: unknown, visit: (v: Record<string, unknown>) => void) => walkBounded(value, queryBudget, visit)
  const conditions: Review['conditions'] = (['independence', 'controls', 'negative-results', 'reproduction', 'scope'] as const).map(axis => ({ axis, status: 'unknown', observations: [] }))
  const fields: Record<string, Review['conditions'][number]['axis']> = {
    independence: 'independence', independenceMetadata: 'independence', independenceStatus: 'independence',
    controls: 'controls', comparisonConditions: 'controls',
    negativeResults: 'negative-results', negative_results: 'negative-results',
    reproduction: 'reproduction', replication: 'reproduction', failed_replication: 'reproduction',
    limitations: 'scope', scientificScope: 'scope', unresolvedGaps: 'scope', gapCodes: 'scope'
  }
  const impacts: Review['impacts'] = []
  for (const chain of chains) {
    if (!spend(queryBudget)) { bounded = true; break }
    const relevant = records.filter(record => record.threadId === chain.head.threadId).slice(0, 100 - impacts.length)
    const index = auditSnapshot(chain)
    bounded ||= index.extractionBounded || index.pending
    if (!relevant.length) continue
    const material = index
    const { labels, downstream, changesBySource } = material
    for (const record of relevant) {
      if (!spend(queryBudget)) { bounded = true; break }
      const closure = index.closuresByDigest.get(record.closureDigest)
      const head = closure ? index.deltaByDigest.get(closure.headDigest) : undefined
      const targets = new Set<string>()
      for (const values of [closure?.policy.targetClaimIds ?? [], closure?.includedExternalRefs ?? []]) for (const target of values) { if (!spend(queryBudget)) break; targets.add(target) }
      // Only scientific owners inside this sealed boundary may contribute conditions.
      // Tool schemas, arbitrary nested objects and later branches are not holders.
      const scientificTargets = new Set(targets)
      const memberDeltas: NonNullable<ReturnType<typeof index.deltaByDigest.get>>[] = []
      const sourceIdentities = new Map<string, Set<string>>()
      const upstream = new Map<string, Set<string>>()
      for (const digest of closure?.includedDeltaDigests ?? []) {
        if (!spend(queryBudget)) break
        const delta = index.deltaByDigest.get(digest)
        if (!delta) { bounded = true; continue }
        memberDeltas.push(delta)
        for (const [source, identities] of index.sourceIdentitiesByDelta.get(digest) ?? []) { if (!spend(queryBudget)) break; const keys = sourceIdentities.get(source) ?? new Set<string>(); for (const identity of identities) { if (!spend(queryBudget)) break; keys.add(identity) } sourceIdentities.set(source, keys) }
        for (const edge of index.edgesByDelta.get(digest) ?? []) {
          if (!spend(queryBudget)) break
          const sources = upstream.get(edge.target) ?? new Set<string>(); sources.add(edge.source); upstream.set(edge.target, sources)
        }
      }
      const pendingTargets = [...scientificTargets]
      while (pendingTargets.length && queryBudget.remaining > 0) {
        const target = pendingTargets.pop()!
        for (const source of upstream.get(target) ?? []) {
          if (!spend(queryBudget)) { bounded = true; break }
          if (!scientificTargets.has(source)) { scientificTargets.add(source); pendingTargets.push(source) }
        }
      }
      if (pendingTargets.length || queryBudget.remaining <= 0) bounded = true
      const textValue = (value: unknown): string => {
        if (!spend(queryBudget)) return ''
        if (typeof value === 'string') { if (value.length > 2000) bounded = true; return value.slice(0, 2000).trim() }
        if (typeof value === 'number' || typeof value === 'boolean') return String(value)
        const before = queryBudget.visited, textBefore = queryBudget.textUnits
        let hasContent = false
        walkBounded(value, queryBudget, () => undefined, leaf => { if (typeof leaf === 'boolean' || typeof leaf === 'number' || typeof leaf === 'string' && leaf.slice(0, 2000).trim()) hasContent = true })
        if (!hasContent) return ''
        if (queryBudget.bounded || queryBudget.textUnits - textBefore > 2000 || queryBudget.visited - before > 200) { bounded = true; return value ? 'Recorded structured condition (projection limited)' : '' }
        return value === undefined || value === null ? '' : JSON.stringify(value).slice(0, 2000)

      }
      const meaningful = (value: unknown) => Boolean(textValue(value))
      const addConditions = (holder: Record<string, unknown>, targetId: string, digest: string) => {
        if (!scientificTargets.has(targetId)) return
        for (const [field, axis] of Object.entries(fields)) if (meaningful(holder[field])) {
          const condition = conditions.find(c => c.axis === axis)!
          const text = textValue(holder[field])
          condition.status = 'recorded'
          if (text.length > 2000) bounded = true
          if (condition.observations.length < 20) condition.observations.push({ digest, field, text: text.slice(0, 2000), targetId, recordDigest: record.recordDigest, closureDigest: record.closureDigest })
          else bounded = true
        }
      }
      for (const delta of memberDeltas) {
        const payload = object(delta.payload) ? delta.payload : {}
        if (payload.recordType === 'assessment' && object(payload.assessment)) addConditions(payload.assessment, string(payload.assessment.targetRecordId ?? payload.assessment.targetClaimId ?? payload.assessment.targetId ?? ''), delta.deltaDigest)
        for (const name of ['claims', 'sources', 'assessments', 'scientificConditions']) {
          const rows = Array.isArray(payload[name]) ? payload[name] : []
          for (const row of rows) { if (!spend(queryBudget)) break; if (object(row)) addConditions(row, string(row.targetId ?? row.target_id ?? row.id ?? ''), delta.deltaDigest) }
        }
      }
      walk(record.payload, value => {
        const targetId = string(value.target_id ?? value.targetId ?? '')
        if (!scientificTargets.has(targetId)) return
        const findingAxis: Record<string, Review['conditions'][number]['axis']> = { non_independent_support: 'independence', single_source_dependency: 'independence', failed_replication: 'reproduction', negative_result: 'negative-results' }
        const axis = findingAxis[string(value.finding_type)]
        if (!axis || !meaningful(value.rationale ?? value.title)) return
        const condition = conditions.find(c => c.axis === axis)!
        condition.status = 'recorded'
        if (condition.observations.length < 20) condition.observations.push({ digest: record.recordDigest, field: string(value.finding_type), text: string(value.rationale ?? value.title).slice(0, 2000), targetId, recordDigest: record.recordDigest, closureDigest: record.closureDigest })
        else bounded = true
      })
      const affected = new Set<string>(), matched: Review['impacts'][number]['changes'] = []
      const memberIdentities = new Set<string>(index.recordKeys.get(record.recordDigest))
      for (const delta of memberDeltas) for (const identity of index.deltaKeys.get(delta.deltaDigest) ?? []) { if (!spend(queryBudget)) break; memberIdentities.add(identity) }
      if ([...memberIdentities].some(key => index.identityConflicts.has(key))) bounded = true
      const relevantSources = new Set(targets), pendingSources = [...targets]
      while (pendingSources.length && queryBudget.remaining > 0) {
        const target = pendingSources.pop()!
        for (const source of material.upstream.get(target) ?? []) {
          if (!spend(queryBudget)) { bounded = true; break }
          if (!relevantSources.has(source)) { relevantSources.add(source); pendingSources.push(source) }
        }
      }
      if (pendingSources.length || queryBudget.remaining <= 0) bounded = true
      const relevantChanges: { change: import('./audit-index.js').MaterialChange; source: string }[] = []
      for (const source of relevantSources) {
        if (!spend(queryBudget)) break
        const keys = new Set([source])
        for (const identity of sourceIdentities.get(source) ?? []) { if (!spend(queryBudget)) break; keys.add((JSON.parse(identity) as string[])[1]) }
        // A version node is an alias only after checking its complete member identity.
        for (const identity of memberIdentities) { if (!spend(queryBudget)) break; const ref = JSON.parse(identity) as string[]; if (ref[1] === source) keys.add(ref[1]) }
        for (const key of keys) for (const change of changesBySource.get(key) ?? []) {
          if (!spend(queryBudget)) break
          if (!head || change.sequence <= head.sequence) continue
          if (change.lifecycle) {
            const refs: string[][] = []
            for (const identity of sourceIdentities.get(source) ?? memberIdentities) { if (!spend(queryBudget)) break; const ref = JSON.parse(identity) as string[]; if (ref[1] === change.sourceId) refs.push(ref) }
            if (refs.length > 1) { bounded = true; continue }
            const exact = refs.filter(ref => (!change.artifactId || ref[0] === change.artifactId) && (!change.contentDigest || ref[2] === change.contentDigest))
            if (!exact.length) { if (!refs.length) bounded = true; continue }
            if (!change.artifactId || !change.contentDigest) { bounded = true; continue }
          }
          relevantChanges.push({ change, source })
        }
      }
      for (const { change, source: changedSource } of relevantChanges) {
        if (!spend(queryBudget)) break
        const reach = new Set([changedSource])
        const pending = [changedSource]
        while (pending.length && queryBudget.remaining > 0) {
          const source = pending.pop()!
          for (const target of downstream.get(source) ?? []) {
            if (!spend(queryBudget)) { bounded = true; break }
            if (!reach.has(target)) { reach.add(target); pending.push(target) }
          }
        }
        if (pending.length || queryBudget.remaining <= 0) bounded = true
        const hits = [...targets].filter(id => reach.has(id))
        if (hits.length) { hits.forEach(id => affected.add(id)); matched.push({ digest: change.digest, sourceId: change.sourceId, reason: change.reason }) }
      }
      if (queryBudget.remaining <= 0) bounded = true
      if (affected.size > 20 || matched.length > 10) bounded = true
      impacts.push({ recordDigest: record.recordDigest, closureDigest: record.closureDigest,
        status: affected.size ? 'requires-review' : !head || bounded || !memberIdentities.size || !closure?.policy.targetClaimIds.length || !closure.policy.targetClaimIds.every(id => material.upstream.has(id)) ? 'unknown' : 'no-recorded-impact',
        affectedIds: [...affected].slice(0, 20), affected: [...affected].slice(0, 20).map(id => ({ id, title: labels.get(id) ?? id })), changes: matched.slice(0, 10) })
    }
  }
  bounded ||= queryBudget.bounded
  if (records.length > impacts.length) bounded = true
  if (bounded) for (const impact of impacts) if (impact.status === 'no-recorded-impact') impact.status = 'unknown'
  return { coverage: 'recorded-links-only', bounded, conditions, impacts, coverageDetails: { indexRevision: chains.reduce((max, chain) => Math.max(max, chain.auditRevision), 0), indexedChains: chains.length, indexedDeltas: chains.reduce((sum, chain) => sum + auditSnapshot(chain).deltas.length, 0), scannedDeltas: 0, totalRelevantDeltas, queryNodes: queryBudget.visited, extractionNodes: 0, omittedRecords: records.length - impacts.length, reasons: [...(chains.some(chain => auditSnapshot(chain).pending) ? ['index-bootstrap-incomplete'] : []), ...(chains.some(chain => auditSnapshot(chain).extractionBounded) ? ['index-extraction-bounded'] : []), ...(queryBudget.bounded ? ['query-budget-exhausted'] : []), ...(records.length > impacts.length ? ['impact-records-omitted'] : []), ...(bounded ? ['projection-incomplete; narrow the audit subject'] : [])] } }
}
