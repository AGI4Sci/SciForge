import { researchHumanReviewReceiptSchema, researchResultBindingSchema, type ResearchRecordView } from '../research-record-contract.js'
import type { ResearchRecordState } from './research-record-state.js'

export const bindingIdentity = (value: unknown): string => JSON.stringify(researchResultBindingSchema.parse(value))

/** History remains canonical; this bounded read model never changes old receipts. */
export function projectHumanReviews(state: ResearchRecordState, impacts: NonNullable<ResearchRecordView['resultImpact']>): void {
  const receipts = state.history.filter(item => item.kind === 'human-result-review').map(item => researchHumanReviewReceiptSchema.parse(item.value))
  for (const impact of impacts) {
    const history = receipts.filter(item => item.binding.id === impact.id).reverse()
    const latest = history[0] ?? null
    const { status: _status, reasons: _reasons, humanReview: _review, ...binding } = impact
    const subject = { ...binding, presentations: binding.presentations.map(({ status: _status, ...item }) => item) }
    const same = latest && bindingIdentity(latest.binding) === bindingIdentity(subject)
    const statuses = [impact.status, ...impact.presentations.map(item => item.status)]
    impact.humanReview = { latest, total: history.length, history: history.slice(0, 10), limited: history.length > 10,
      applicability: !latest ? 'none' : !same || statuses.includes('requires-review') ? 'stale' : statuses.includes('unknown') ? 'unknown' : 'current' }
  }
}
