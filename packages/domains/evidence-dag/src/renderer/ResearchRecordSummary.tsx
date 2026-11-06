import React, { useSyncExternalStore, type ReactElement } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ResearchRecordNode, ResearchRecordView } from '../research-record-contract'
import { recordCoverageSummary, recordSynthesisPresentation, type ResearchRecordPresentation } from './research-record-presentation'

import { RecordWindow } from './RecordWindow'
import { RecordOperationIcon } from './research-record-visual'
import { ResearchRecordPaging } from './ResearchRecordPaging'

const entryLabels = { goal: '目标', progress: '进展', negative: '负例', open: '未决' }

function SourceLinks({ ids, onInspect }: { ids: readonly string[]; onInspect: (id: string, ids?: readonly string[], title?: string) => void }): ReactElement {
  return <span className="ml-2 inline-flex flex-wrap gap-x-2 record-caption text-ds-muted">{[...new Set(ids)].map((id, index) => <button key={id} className="underline decoration-ds-border underline-offset-2 hover:text-ds-ink" onClick={() => onInspect(id, ids)}>来源 {index + 1}</button>)}</span>
}

export function RecordSynthesis({ node, presentation, onInspect, onOffset, disabled = false }: {
  node: ResearchRecordNode; presentation: ResearchRecordPresentation; onInspect: (id: string, ids?: readonly string[], title?: string) => void
  onOffset?: (offset: number) => void; disabled?: boolean
}): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot)
  const key = `synthesis:${node.id}`, open = state.expanded.has(key)
  const summary = recordSynthesisPresentation(node)
  const entries = node.synthesis?.entries ?? []
  const projection = node.summaryProjection
  const coverage = ['coveredChildRevisions', 'coveredEntryDigests', 'coveredChildMembership', 'coveredChildMetadata'] as const
  const members = [...new Set(coverage.flatMap(field => Object.keys(node.synthesis?.[field] ?? {})))]
  const label = node.kind === 'phase' ? '阶段综合' : '累计记录'
  const emptyText = node.organizationCoverage?.observed === 0 ? node.organizationCoverage.historical ? '暂无当前来源；历史记录仍保留。' : '暂无记录。' : summary.status === 'ready' ? '暂无综合条目，原始记录仍可查看。' : '综合尚未就绪，原始记录仍可查看。'
  return <div className="mt-1 record-text leading-relaxed" data-record-synthesis={node.id}>
    <button className="flex flex-wrap items-center gap-x-1 text-left record-caption text-ds-muted hover:text-ds-ink" aria-label={`${label} ${node.title}`} aria-expanded={open} onClick={() => presentation.toggle(key)}>
      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{label} · {summary.statusText}
      {summary.manual && <span>· 人工固定摘要</span>}{summary.limited && <span>· 摘要节选</span>}
      {summary.hasNegative && <span className="record-check-text">· 含负例{projection ? ` ${projection.negative}` : ''}</span>}{summary.hasOpen && <span>· 有未决问题{projection ? ` ${projection.open}` : ''}</span>}
    </button>
    {(!open || summary.manual || !entries.length) && (summary.summary ? <p className={`${open ? 'whitespace-pre-wrap' : 'record-description line-clamp-2'} mt-1 select-text text-ds-muted`}>{summary.summary}</p> : <p className="mt-1 text-ds-muted">{emptyText}</p>)}
    {open && <div className="mt-2 space-y-2 border-l border-ds-border pl-3">
      {summary.status !== 'ready' && <p className="record-caption text-ds-muted">{entries.length || summary.summary ? '保留此前内容；尚未确认与当前记录同步。' : `尚无${label}；下方记录不受整理进度影响。`}</p>}
      {summary.manual && entries.length > 0 && <p className="record-caption text-ds-muted">人工摘要保持固定；以下是独立更新的综合条目。</p>}
      {projection && <p className="record-caption text-ds-muted">全部综合 {projection.totalEntries} 条 · 覆盖映射 {projection.totalCoverageMembers} 个成员 · 来源覆盖 {projection.sourceCoverage === 'gaps' ? '有缺口' : projection.sourceCoverage === 'observed' ? '已观察' : '未知'}；计数不代表科学验证。</p>}
      {projection && onOffset && <ResearchRecordPaging label="综合" offset={projection.offset} count={Math.max(entries.length, ...coverage.map(field => Object.keys(node.synthesis?.[field] ?? {}).length))} total={Math.max(projection.totalEntries, projection.totalCoverageMembers)} hasPrevious={projection.offset > 0} hasNext={projection.nextOffset !== null} disabled={disabled} onPrevious={() => onOffset(Math.max(0, projection.offset - 48))} onNext={() => { if (projection.nextOffset !== null) onOffset(projection.nextOffset) }} />}
      {projection?.limited && !onOffset && <p className="record-caption text-ds-muted">当前仅为一页；进入此范围或查看详情后可读取更早综合与覆盖映射。</p>}
      <RecordWindow items={[...entries].reverse()} id={`${key}:${projection?.offset ?? 0}`} label="综合条目" presentation={presentation} pageSize={12} render={entry => <div key={entry.id} data-synthesis-entry={entry.id} className="record-state-entry" data-record-tone={entry.kind === 'negative' || entry.kind === 'open' && entry.status === 'active' ? 'check' : 'neutral'}>
        <span className={`mr-2 record-caption ${entry.kind === 'negative' ? 'record-check-text' : 'text-ds-muted'}`}><RecordOperationIcon kind={entry.kind === 'goal' ? 'goal' : entry.kind === 'negative' || entry.kind === 'open' ? 'attention' : 'step'} />{entry.kind === 'open' && entry.status === 'resolved' ? '已回应' : entryLabels[entry.kind]}</span>
        {entry.membership && entry.membership !== 'current' && <span className="mr-2 record-caption text-ds-muted">{entry.membership === 'historical' ? '已迁出历史' : '跨归属'}</span>}
        <span className="select-text whitespace-pre-wrap">{entry.text}</span><SourceLinks ids={entry.sourceIds} onInspect={onInspect} />
        {entry.resolution && <p className="mt-1 pl-3 text-ds-muted"><span className="select-text whitespace-pre-wrap">{entry.resolution.note}</span><SourceLinks ids={entry.resolution.sourceIds} onInspect={onInspect} /></p>}
      </div>} />
      {members.length > 0 && <details><summary className="cursor-pointer record-caption">本页覆盖映射（{members.length}）</summary><RecordWindow items={members} id={`mapping:${node.id}:${projection?.offset ?? 0}`} label="本页覆盖映射" presentation={presentation} pageSize={12} render={id => <div key={id} data-coverage-member={id} className="record-caption break-words"><button className="underline" onClick={() => onInspect(id)}>{id}</button>{coverage.map(field => node.synthesis?.[field]?.[id] !== undefined && <p key={field}>{field}：{String(node.synthesis[field]![id])}</p>)}</div>} /></details>}
      {!!node.synthesis?.legacySummary && <details className="text-ds-muted"><summary className="cursor-pointer record-caption">此前摘要</summary><p className="mt-1 select-text whitespace-pre-wrap">{node.synthesis.legacySummary}</p></details>}
      {summary.limited && <p className="record-caption text-ds-muted">摘要为有界节选；条目及其来源继续保留。</p>}
    </div>}
  </div>
}

const coverageLabels: ReadonlyArray<[keyof ResearchRecordView['organizationCoverage'], string]> = [
  ['observed', '已记录来源'], ['processed', '已处理'], ['assigned', '已归类'], ['unassigned', '未归类'],
  ['fullExcerpt', '未截断节选'], ['truncated', '已截断节选'], ['unavailable', '来源不可读'], ['changed', '来源已变化'],
  ['pending', '待处理'], ['blocked', '整理阻塞'], ['historical', '历史来源版本']
]

export function RecordCoverage({ coverage, scopeId, presentation }: {
  coverage: ResearchRecordView['organizationCoverage']; scopeId: string; presentation: ResearchRecordPresentation
}): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const key = `coverage:${scopeId}`, open = state.expanded.has(key)
  return <div className="mb-3 record-caption text-ds-muted" data-record-coverage={scopeId}>
    <button className="flex items-start gap-1 text-left hover:text-ds-ink" aria-label="查看记录覆盖" aria-expanded={open} onClick={() => presentation.toggle(key)}>
      {open ? <ChevronDown size={11} className="mt-0.5 shrink-0" /> : <ChevronRight size={11} className="mt-0.5 shrink-0" />}<span>{recordCoverageSummary(coverage)}</span>
    </button>
    {open && <div className="mt-2 space-y-2 border-l border-ds-border pl-3">
      <dl className="grid grid-cols-2 gap-x-5 gap-y-1">{coverageLabels.map(([key, label]) => <div key={key} className="flex justify-between gap-3"><dt>{label}</dt><dd>{coverage[key]}</dd></div>)}</dl>
      <p>计数来自已观察的会话快照；来源暂时不可读时仍保留，旧内容版本单独计数。“已处理”不等于已归类或科学验证；各状态可重叠，未截断节选也不代表完整会话。</p>
    </div>}
  </div>
}

/** Existing sourced synthesis only: no inferred scientific claims or new owner. */
export function RecordUnderstanding({ node, onInspect }: {
  node: ResearchRecordNode; onInspect: (id: string, ids?: readonly string[], title?: string) => void
}): ReactElement {
  const summary = recordSynthesisPresentation(node)
  const entries = node.synthesis?.entries ?? []
  const current = entries.filter(entry => entry.membership !== 'historical')
  const recent = [...current].reverse()
  const goal = recent.find(entry => entry.kind === 'goal')
  const progress = recent.find(entry => entry.kind === 'progress')
  const concerns = current.filter(entry => (entry.kind === 'open' && entry.status === 'active') || entry.kind === 'negative')
  const failed = node.behaviorCounts?.failed ?? node.counts?.failedRounds ?? (['failed', 'error'].includes(node.status) ? 1 : 0)
  const cancelled = node.behaviorCounts?.cancelled ?? (['cancelled', 'aborted'].includes(node.status) ? 1 : 0)
  return <div className="mt-2 space-y-1 record-text" data-record-understanding={node.id}>
    <p className="record-caption text-ds-muted">已有综合 · {summary.statusText}{summary.limited ? ' · 节选' : ''}{summary.manual ? ' · 人工固定摘要' : ''}</p>
    {goal && <p><span className="text-ds-muted">目标：</span><span className="select-text">{goal.text}</span><SourceLinks ids={goal.sourceIds} onInspect={onInspect} /></p>}
    {progress && <p><span className="text-ds-muted">当前认识：</span><span className="select-text">{progress.text}</span><SourceLinks ids={progress.sourceIds} onInspect={onInspect} /></p>}
    {!progress && <p className="record-caption text-ds-muted">当前结论尚未单独整理；范围与适用条件需回读来源。</p>}
    {(summary.hasOpen || summary.hasNegative) && <p className="record-caption record-check-text">{node.summaryProjection?.open ?? node.concernCounts?.open ?? concerns.filter(entry => entry.kind === 'open').length} 项未决 · {node.summaryProjection?.negative ?? node.concernCounts?.negative ?? concerns.filter(entry => entry.kind === 'negative').length} 项负例 · 查看综合可逐项回读</p>}
    {concerns.slice(-2).map(entry => <p key={entry.id} className="record-caption record-check-text"><span className="select-text">{entry.text}</span><SourceLinks ids={entry.sourceIds} onInspect={onInspect} /></p>)}
    {entries.some(entry => entry.membership === 'historical' && (entry.kind === 'negative' || entry.kind === 'open')) && <p className="record-caption text-ds-muted">含历史负例或未决记录，原条目及回应保留。</p>}
    {(failed > 0 || cancelled > 0) && <p className="record-caption record-check-text">失败 {failed} · 取消/中断 {cancelled}；解释状态未知，请回读依据。</p>}
    {node.organizationCoverage && (node.organizationCoverage.unavailable > 0 || node.organizationCoverage.changed > 0 || node.organizationCoverage.unassigned > 0) && <p className="record-caption record-check-text">来源不可读 {node.organizationCoverage.unavailable} · 变化 {node.organizationCoverage.changed} · 未归类 {node.organizationCoverage.unassigned}</p>}
    {summary.status !== 'ready' && <p className="record-caption text-ds-muted">已有认识尚未确认覆盖当前记录；原始成员继续保留。</p>}
  </div>
}
