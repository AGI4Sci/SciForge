import { useRef, useSyncExternalStore, type ReactElement } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { DomainRendererVisibleContextHost } from '@sciforge/domain-sdk/host'
import { researchRecordVisualTarget, useResearchRecordVisualTarget } from './research-record-visible-context'
import type { ResearchRecordScope, ResearchRecordNode, ResearchRecordView } from '../research-record-contract'
import type { ResearchRecordPresentation } from './research-record-presentation'
import { compactRecord, recordKindLabels } from './research-record-compact'
import { RecordOperationIcon, recordOperation, recordVisualState } from './research-record-visual'
import { RecordWindow } from './RecordWindow'

type CompactContext = { scope: ResearchRecordScope; componentId: string; active: boolean; visibleContext?: DomainRendererVisibleContextHost }

export function ResearchRecordCompact({ view, presentation, onNavigate, ...context }: {
  view: ResearchRecordView; presentation: ResearchRecordPresentation; onNavigate: (id: string) => void
} & CompactContext): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot)
  const windowId = JSON.stringify(['compact', state.focusId, state.queries[state.focusId] ?? {}, view.children[0]?.id ?? 'empty'])
  const selected = state.selectedId
  const groupSize = Math.max(1, Math.ceil(view.children.length / 24))
  const groups = Array.from({ length: Math.ceil(view.children.length / groupSize) }, (_, index) => ({ start: index * groupSize, members: view.children.slice(index * groupSize, (index + 1) * groupSize) }))
  const inspect = (node: ResearchRecordNode, index: number) => {
    presentation.offset(`window:${windowId}`, Math.floor(index / 20) * 20)
    presentation.inspect(node.id)
  }
  return <section aria-label="紧凑审计列表" className="record-compact">
    <div className="record-compact-caption"><span>{view.totalChildren} 项 · 本页 {view.children.length} 项</span><span title="仅表示本页记录顺序，不表示执行耗时或全部历史">分组位置 · 非耗时</span></div>
    <div className="record-position-strip" aria-label="本页记录位置">{groups.map(({ start, members }) => <button key={members[0].id} type="button" data-tone={members.some(node => compactRecord(node).alerts.length) ? 'check' : 'neutral'} aria-label={`定位 ${compactRecord(members[0]).title}`} aria-pressed={members.some(node => selected === node.id)} title={`${start + 1}–${start + members.length} 项；点击定位本组首项`} onClick={() => inspect(members[0], start)} />)}</div>
    <RecordWindow items={view.children} id={windowId} label="审计记录" presentation={presentation} render={node => <CompactRow key={node.id} node={node} selected={selected === node.id} presentation={presentation} onNavigate={onNavigate} {...context} />} />
    {!view.children.length && <p className="record-caption py-6 text-ds-muted">当前范围暂无匹配记录。</p>}
  </section>
}

function CompactRow({ node, selected, presentation, onNavigate, scope, componentId, active, visibleContext }: {
  node: ResearchRecordNode; selected: boolean; presentation: ResearchRecordPresentation; onNavigate: (id: string) => void
} & CompactContext): ReactElement {
  const targetRef = useRef<HTMLButtonElement>(null)
  useResearchRecordVisualTarget({ visibleContext, componentId, target: researchRecordVisualTarget(scope, node), element: targetRef, active })
      const item = compactRecord(node)
      return <div className="record-compact-row" data-record-id={node.id} data-record-kind={node.kind} data-selection-record-id={node.id} data-selection-record-label={node.title} {...(node.source ? { 'data-selection-source': JSON.stringify({ runtimeId: node.source.runtimeId, threadId: node.source.threadId, turnId: node.source.turnId, itemId: node.source.itemId }) } : {})} data-tone={item.alerts.length ? 'check' : recordVisualState(node).tone} data-selected={selected}>
        <button ref={targetRef} className="record-compact-open" type="button" aria-label={`查看 ${item.title}`} aria-expanded={selected} onClick={event => { const selection = window.getSelection(); if (!selection || selection.isCollapsed || !event.currentTarget.contains(selection.anchorNode)) presentation.inspect(node.id) }}>
          <span className="record-compact-kind"><RecordOperationIcon kind={recordOperation(node)} />{recordKindLabels[node.kind]}</span>
          <span className="record-compact-copy"><span className="record-compact-title select-text">{item.title}</span>{item.summary && <span className="record-compact-summary select-text">{item.summary}</span>}</span>
          {item.alerts.length ? <span className="record-compact-alert" title={item.alerts.join(' · ')}>{item.alerts.join(' · ')}</span> : <span className="record-compact-status">{recordVisualState(node).label}</span>}
        </button>
        {node.kind !== 'event' && <button type="button" className="record-compact-enter" aria-label={`进入 ${item.title}`} title="进入此范围" onClick={() => onNavigate(node.id)}><ArrowUpRight size={15} /></button>}
      </div>

}
