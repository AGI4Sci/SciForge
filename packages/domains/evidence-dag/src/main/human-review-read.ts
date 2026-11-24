import { researchAuditReviewDecisionsSchema, type ResearchAuditReviewDecisions, type ResearchAuditSubject } from '@sciforge/domain-sdk/research-audit'
import type { AuditReadScope } from './audit-read-binding.js'
import type { EvidenceDagServiceClient } from './client.js'

/** One bounded read: late responses never mutate the returned projection. */
export async function readHumanReviews(input: {
  bindings: { scopes: AuditReadScope[]; reasons: string[] }; subject: ResearchAuditSubject; asOf?: string;
  client: Pick<EvidenceDagServiceClient, 'humanReviews'>; authorize: (scope: AuditReadScope) => Promise<void>;
  budgetMs?: number
}): Promise<ResearchAuditReviewDecisions> {
  const reasons = new Set(input.bindings.reasons), records = new Map<string, ResearchAuditReviewDecisions['records'][number]>()
  const scopes = [...new Map(input.bindings.scopes.map(scope => [JSON.stringify([scope.engineThreadId, scope.snapshotDigest]), scope])).values()]
  const controller = new AbortController(), deadline = Date.now() + Math.max(1, Math.min(input.budgetMs ?? 6000, 6000))
  let available = 0, offset = 0, finished = false
  const worker = async () => {
    while (!finished && offset < scopes.length) {
      const scope = scopes[offset++]
      try {
        await input.authorize(scope)
        if (finished || Date.now() >= deadline) return
        const result = await input.client.humanReviews(scope.engineThreadId, scope.snapshotDigest,
          'artifactVersionRef' in input.subject ? input.subject.artifactVersionRef : undefined, input.asOf,
          { signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now()) })
        if (finished) return
        if (result.status !== 'unavailable') available++
        for (const reason of result.reasons) reasons.add(reason)
        if (result.status !== 'available') reasons.add('review_source_partial')
        for (const row of result.records) {
          const key = JSON.stringify([row.threadId, row.eventId])
          const previous = records.get(key)
          if (previous && JSON.stringify(previous) !== JSON.stringify(row)) { reasons.add('duplicate_event_conflict'); continue }
          if (records.size >= 1000 && !previous) { reasons.add('review_output_bounded'); continue }
          records.set(key, row)
        }
      } catch {
        if (!finished) reasons.add('review_source_unavailable')
      }
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), Math.max(1, deadline - Date.now())) })
  const completed = Promise.all(Array.from({ length: Math.min(4, scopes.length) }, worker)).then(() => 'complete' as const)
  const outcome = await Promise.race([completed, timeout])
  finished = true
  if (timer) clearTimeout(timer)
  if (outcome === 'timeout') { reasons.add('review_read_time_bounded'); controller.abort() }
  return researchAuditReviewDecisionsSchema.parse({
    status: available ? reasons.size ? 'partial' : 'available' : 'unavailable',
    ...(input.asOf ? { asOf: input.asOf } : {}),
    records: [...records.values()].sort((a, b) => a.sequence - b.sequence || a.threadId.localeCompare(b.threadId) || a.eventId.localeCompare(b.eventId)),
    reasons: [...reasons].sort()
  })
}
