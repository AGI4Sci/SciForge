import React, { type ReactElement } from 'react'
import type { ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'

type Decisions = ResearchAuditEvidenceAuditQueryOutput['reviewDecisions']
const actionLabels = { approve: '认可此范围', reject: '不认可', request_evidence: '请求补充材料', defer: '暂缓判断' }
const readableTime = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未记录' : date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Read-only presentation of owner decisions. Browsing never creates a receipt. */
export function AuditReviewHistory({ decisions }: { decisions: Decisions }): ReactElement {
  const records = decisions?.records ?? []
  const entry = (record: NonNullable<Decisions>['records'][number]) => <li key={record.eventId} className="border-l border-ds-border pl-3 py-1">
    <div className="flex flex-wrap items-baseline gap-x-3"><strong className="text-ds-ink">{actionLabels[record.action]}</strong><time className="text-ds-muted" dateTime={record.occurredAt}>{readableTime(record.occurredAt)}</time></div>
    <p className="whitespace-pre-wrap break-words">{record.rationale || '未记录理由。'}</p>
    <p className="text-ds-muted">{record.reviewReceipt.scope.kind === 'review-packet' ? `适用于当时的 ${record.reviewReceipt.scope.targetIds.length} 项材料` : '当时的审阅范围未记录'} · 审阅身份未核实</p>
    {record.reviewReceipt.previousDecisionEventId && <p className="text-ds-muted">这是一次后续判断，先前意见仍保留。</p>}
  </li>
  return <section aria-label="审阅意见" className="space-y-2 text-ds-sm" data-audit-review-history>
    <h3 className="font-medium text-ds-ink">审阅意见</h3>
    {!decisions || decisions.status === 'unavailable' ? <p className="text-ds-muted">暂时无法读取此范围的审阅意见。</p>
      : decisions.status === 'partial' ? <p className="text-ds-muted">目前只能读取部分审阅意见。</p>
      : !records.length ? <p className="text-ds-muted">此范围尚无已记录的审阅意见。</p> : null}
    {!!records.length && <><p className="text-ds-muted">{decisions?.asOf ? `截至 ${readableTime(decisions.asOf)} 的已记录意见。` : '按实际发生时间显示；其中可能包含材料形成后的判断。'}</p>
      <ol className="space-y-3">{records.slice(0, 3).map(entry)}</ol>
      {records.length > 3 && <details><summary className="cursor-pointer text-ds-muted">其余 {records.length - 3} 条意见</summary><ol className="mt-3 space-y-3">{records.slice(3).map(entry)}</ol></details>}
    </>}
  </section>
}

