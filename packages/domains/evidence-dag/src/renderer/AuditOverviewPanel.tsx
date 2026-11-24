import React, { useRef, useState, type ReactElement } from 'react'
import type { ResearchRecordNode, ResearchRecordView, ResearchRecordScope } from '../research-record-contract'

import type { DomainRendererVisibleContextHost } from '@sciforge/domain-sdk/host'
import { researchRecordVisualTarget, useResearchRecordVisualTarget } from './research-record-visible-context'

type VisualContext = { scope?: ResearchRecordScope; componentId?: string; active?: boolean; visibleContext?: DomainRendererVisibleContextHost }
type Entry = NonNullable<ResearchRecordNode['synthesis']>['entries'][number]
type Item = { entry: Entry; nodes: ResearchRecordNode[]; sourceIds: string[] }
const labels = { goal: '研究目标', progress: '已记录进展', negative: '负结果与反例', open: '未解决问题' } as const

/** Read-only presentation of recorded synthesis. Operations never become conclusions. */
export function AuditOverviewPanel({ view, onInspect, onProcess, ...context }: {
  view: ResearchRecordView; onInspect: (id: string, ids?: readonly string[], title?: string) => void; onProcess?: () => void
} & VisualContext): ReactElement {
  return <ScopedOverview key={view.node?.id ?? 'root'} view={view} onInspect={onInspect} onProcess={onProcess} {...context} />
}
function ScopedOverview({ view, onInspect, onProcess, ...context }: Parameters<typeof AuditOverviewPanel>[0]): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const nodes = [...(view.node ? [view.node] : []), ...(view.children ?? [])]
  const grouped = new Map<string, Item>()
  for (const node of nodes) for (const entry of [...node.synthesis?.entries ?? []].reverse()) {
    if (entry.membership === 'historical' || !entry.sourceIds.length || entry.kind === 'open' && entry.status !== 'active') continue
    const key = JSON.stringify([entry.kind, entry.status, entry.membership, entry.text.trim().replace(/\s+/g, ' '), entry.resolution])
    const existing = grouped.get(key)
    if (existing) { existing.sourceIds = [...new Set([...existing.sourceIds, ...entry.sourceIds])]; existing.nodes.push(node) }
    else grouped.set(key, { entry, nodes: [node], sourceIds: [...new Set(entry.sourceIds)] })
  }
  const items = [...grouped.values()]
  const partial = view.totalChildren > (view.children?.length ?? 0) || nodes.some(node => node.summaryProjection?.limited || node.synthesis?.summaryLimited)
  const warnings = nodes.filter(node => node.synthesis && (node.synthesisStatus !== 'ready' || node.sourceStatus === 'changed' || node.sourceStatus === 'unavailable' || node.organizationCoverage?.changed || node.organizationCoverage?.unavailable))
  return <section className="mb-5 space-y-4" aria-label="当前研究内容" data-audit-overview>
    <h2 className="record-title font-medium">{view.node?.title || '研究摘要'}</h2>
    <p className="record-caption text-ds-muted">仅展示当前范围本页已记录、带来源的综合；不代表科学验证。未整理内容与下级范围的其余记录请进入完整过程查看。</p>
    {!items.length && <p className="record-text text-ds-muted">当前范围尚无带来源的科研摘要。可查看完整过程与原始依据；操作完成不等于科研结论成立。</p>}
    {!!warnings.length && <p className="record-caption record-check-text">材料有更新或来源状态未确认，这份摘要尚待同步。来源变化、缺失与适用范围请回读依据。</p>}
    {(['goal', 'progress', 'negative', 'open'] as const).map(kind => {
      const entries = items.filter(item => item.entry.kind === kind).sort((a, b) => Math.max(...b.nodes.map(node => Date.parse(node.updatedAt) || 0)) - Math.max(...a.nodes.map(node => Date.parse(node.updatedAt) || 0)))
      if (!entries.length) return null
      const open = expanded.has(kind), shown = open ? entries : entries.slice(0, kind === 'progress' ? 2 : 1)
      return <div key={kind} className="space-y-2" data-summary-group={kind}><h3 className="record-caption font-medium">{labels[kind]} · {entries.length}</h3>{shown.map(item => <SummaryItem key={JSON.stringify([item.entry.id, item.nodes[0].id])} item={item} onInspect={onInspect} {...context} />)}{entries.length > shown.length || open ? <button className="record-caption underline text-ds-muted" aria-expanded={open} onClick={() => setExpanded(previous => { const next = new Set(previous); if (open) next.delete(kind); else next.add(kind); return next })}>{open ? `收起${labels[kind]}` : `展开其余${labels[kind]}（${entries.length - shown.length}）`}</button> : null}</div>
    })}
    {partial && <p className="record-caption record-check-text">摘要覆盖不完整：当前成员页或综合条目尚有未加载内容，可能包含更早的负结果与未解决问题。请翻页或进入完整过程逐项查看。</p>}
    {(view.organizationCoverage?.unassigned > 0 || view.organizationCoverage?.unavailable > 0 || view.organizationCoverage?.changed > 0) && <p className="record-caption record-check-text">当前范围：未归类 {view.organizationCoverage.unassigned} · 来源不可读 {view.organizationCoverage.unavailable} · 来源变化 {view.organizationCoverage.changed}。</p>}
    {onProcess && <button className="rounded-lg border border-ds-border px-3 py-2 record-text hover:bg-ds-hover" onClick={onProcess}>查看完整过程与来源</button>}
  </section>
}

function SummaryItem({ item: { entry, sourceIds, nodes: owners }, onInspect, scope, componentId = 'research-summary', active = false, visibleContext }: {
  item: Item; onInspect: Parameters<typeof AuditOverviewPanel>[0]['onInspect']
} & VisualContext): ReactElement {
  const owner = owners[0]
  const element = useRef<HTMLDivElement>(null)
  useResearchRecordVisualTarget({ visibleContext, componentId, element, active: active && Boolean(scope),
    target: researchRecordVisualTarget(scope ?? owner.scope ?? { runtimeId: '', threadId: '', workspaceRoot: '' }, owner, `summary:${owner.id}:${entry.id}`) })
  return <div ref={element} className="border-l-2 border-ds-border pl-3" data-summary-entry={entry.kind}
    data-record-id={owner.id} data-record-kind={owner.kind} data-selection-record-id={owner.id} data-selection-record-label={owner.title}
    {...(owner.source ? { 'data-selection-source': JSON.stringify({ runtimeId: owner.source.runtimeId, threadId: owner.source.threadId, turnId: owner.source.turnId, itemId: owner.source.itemId }) } : {})}>
    {entry.text.length > 240 ? <details><summary className="record-text cursor-pointer select-text">{entry.text.slice(0, 240)}… <span className="record-caption text-ds-muted">展开全文</span></summary><p className="record-text whitespace-pre-wrap select-text">{entry.text}</p></details> : <p className="record-text whitespace-pre-wrap select-text">{entry.text}</p>}
    <div className="flex flex-wrap gap-2 record-caption text-ds-muted">{entry.status === 'resolved' && <span>已回应，原记录保留</span>}<button className="underline" onClick={() => onInspect(sourceIds[0], sourceIds, '摘要相关依据')}>查看相关依据（{sourceIds.length}）</button><button className="underline" onClick={() => onInspect(owner.id)}>查看所属记录</button></div>
    {entry.resolution && <details className="record-caption text-ds-muted"><summary className="cursor-pointer">查看已记录回应</summary><p className="whitespace-pre-wrap">{entry.resolution.note}</p><button className="underline" onClick={() => onInspect(entry.resolution!.sourceIds[0], entry.resolution!.sourceIds, '回应依据')}>查看回应依据</button></details>}
  </div>
}