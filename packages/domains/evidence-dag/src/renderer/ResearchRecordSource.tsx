import React, { useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DomainWorkbenchOpenSessionInput } from '@sciforge/domain-sdk/host'
import type { ResearchRecordScope, ResearchRecordView } from '../research-record-contract'
import { EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION, EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION } from '../definition'
import { createResearchRecordPresentation, type ResearchRecordPresentation } from './research-record-presentation'
import { readableRecordOutput, researchRecordSourceContent, researchRecordSourceFacts, sourceTextPage } from './research-record-source-content'
export { researchRecordSourceContent } from './research-record-source-content'

type SourcePresentation = 'right-panel' | 'global-overlay'
export function researchRecordSourceNavigation(scope: ResearchRecordScope, view: ResearchRecordView, presentation: SourcePresentation, returnContributionId?: string): DomainWorkbenchOpenSessionInput | null {
  const source = view.node?.source
  if (!source) return null
  return {
    runtimeId: source.runtimeId, threadId: source.threadId, workspaceRoot: source.workspaceRoot,
    turnId: source.turnId, itemId: source.itemId, readOnly: true, focusComposer: false,
    returnTo: {
      contributionId: presentation === 'global-overlay' ? EVIDENCE_DAG_RENDERER_GLOBAL_OVERLAY_CONTRIBUTION.id : returnContributionId ?? EVIDENCE_DAG_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
      label: '返回研究记录', presentation,
      session: { runtimeId: scope.runtimeId, threadId: scope.threadId },
      activation: { revision: Date.now(), payload: { recordScope: scope, ...(returnContributionId ? { returnContributionId } : {}) } }
    }
  }
}


const button = 'rounded border border-ds-border px-2 py-1 record-caption hover:bg-ds-hover disabled:opacity-50'
const statuses: Record<string, string> = { unknown: '未知', failed: '失败', error: '失败', cancelled: '已取消', canceled: '已取消', aborted: '已终止', interrupted: '已中断', running: '进行中', pending: '等待中', completed: '已完成', success: '成功' }

function SourceText({ value, label, sourceKey, presentation, output = false }: { value: string; label: string; sourceKey: string; presentation: ResearchRecordPresentation; output?: boolean }): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot)
  const [copyStatus, setCopyStatus] = useState('')
  const readable = useMemo(() => output ? readableRecordOutput(value) : value, [output, value])
  const { text, page, pages } = sourceTextPage(readable, state.offsets[sourceKey] ?? 0)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopyStatus('已复制原文') }
    catch { setCopyStatus('复制失败，请选中文字复制') }
  }
  return <section className="min-w-0" aria-label={label}>
    <div className="flex flex-wrap items-center gap-2"><span className="record-caption text-ds-muted">{label}</span><button className={button} onClick={() => void copy()}>复制{label === '命令' ? '命令' : '原文'}</button><span role="status" className="record-caption text-ds-muted">{copyStatus}</span></div>
    {readable !== value && <p className="record-caption text-ds-muted">阅读视图已去除 ANSI 控制序列；复制与技术 JSON 保留原文。</p>}
    <pre tabIndex={0} className="mt-1 max-h-64 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ds-sidebar p-3 font-mono record-code" data-source-text={label}>{text}</pre>
    {pages > 1 && <div className="mt-1 flex flex-wrap items-center gap-2 record-caption text-ds-muted"><span>分段阅读 · {page + 1}/{pages} · 当前来源 {value.length} 字符</span><button className={button} disabled={page === 0} onClick={() => presentation.offset(sourceKey, page - 1)}>上一段</button><button className={button} disabled={page + 1 === pages} onClick={() => presentation.offset(sourceKey, page + 1)}>下一段</button></div>}
  </section>
}

function SourceDisclosure({ label, sourceKey, presentation, children }: { label: string; sourceKey: string; presentation: ResearchRecordPresentation; children: () => ReactElement }): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot)
  const open = state.expanded.has(sourceKey)
  return <details open={open} onToggle={event => { if (event.currentTarget.open !== open) presentation.toggle(sourceKey) }}>
    <summary className="cursor-pointer break-words record-caption text-ds-muted">{label}</summary>{open && <div className="mt-2 space-y-3">{children()}</div>}
  </details>
}

export function ResearchRecordSource({ view, onOpen, busy, presentation: provided }: { view: ResearchRecordView; onOpen: (view: ResearchRecordView) => void; busy: boolean; presentation?: ResearchRecordPresentation }): ReactElement | null {
  const [local] = useState(createResearchRecordPresentation)
  const presentation = provided ?? local
  const content = useMemo(() => view.sourceStatus === 'unavailable' && view.retainedSource !== 'retained' ? [] : researchRecordSourceContent(view.raw), [view.raw, view.sourceStatus, view.retainedSource])
  const facts = useMemo(() => researchRecordSourceFacts(view.sourceStatus === 'unavailable' && view.retainedSource !== 'retained' ? undefined : view.raw), [view.raw, view.sourceStatus, view.retainedSource])
  if (!view.sourceStatus) return null
  const sourceKey = 'source:' + view.node?.id
  const status = facts.status ?? view.node?.status
  const command = content.find(entry => entry.label === '命令')
  const results = content.filter(entry => !['命令', '消息', '执行说明'].includes(entry.label))
  const alert = facts.exitCode !== undefined && facts.exitCode !== 0 || ['failed', 'error', 'cancelled', 'canceled', 'aborted', 'interrupted'].includes(status ?? '')
  return <div className="min-w-0 space-y-3" data-record-source={view.node?.id}>
    <div className="flex flex-wrap items-center gap-2">
      <p className="record-caption text-ds-muted">{view.sourceStatus === 'current' ? '来源一致' : view.sourceStatus === 'changed' ? '来源已变化；需要重新审阅，不代表科学反驳' : '来源不可用；此前记录与引用仍保留'}</p>
      {view.node?.source && <button className={button} disabled={busy} onClick={() => onOpen(view)}>查看原始过程</button>}
    </div>
    {view.retainedSource && <p className="record-caption text-ds-muted">{view.retainedSource === 'retained' ? '下方为当时保全原文 · 摘要校验通过；当前来源状态单独显示。' : view.retainedSource === 'corrupt' ? '保全原文损坏；未替换为最新内容。' : view.retainedSource === 'denied' ? '原会话无法授权；保全原文不可读。' : '未保全历史原文；不能恢复未观察到的内容。'}</p>}
    <p className="record-source-status record-text" data-record-tone={alert ? 'check' : status === 'running' ? 'active' : ['completed', 'success'].includes(status ?? '') ? 'done' : 'neutral'} data-source-status="true">{view.rawOrigin === 'retained' ? '当时来源状态：' : facts.status ? '来源状态：' : '记录状态：'}{statuses[status ?? ''] ?? status ?? '未记录'}{facts.exitCode !== undefined ? ' · 退出码 ' + facts.exitCode + (facts.exitCode !== 0 ? '（非零）' : '') : command ? ' · 退出码未记录' : ''}</p>
    {facts.status && view.node?.status && facts.status !== view.node.status && <p className="record-text record-check-text">此前记录状态：{statuses[view.node.status] ?? view.node.status}；当前来源状态单独显示。</p>}
    {facts.truncated && <p className="record-text record-check-text">来源已截断；当前内容不代表完整输出或全部归档。</p>}
    {facts.invalidArguments && <p className="record-text record-check-text">参数 JSON 无法解析；原始字段保留在技术 JSON 中。</p>}
    {command && <SourceText key={sourceKey + ':command'} label="命令" value={command.text} sourceKey={sourceKey + ':command'} presentation={presentation} />}
    {!command && (view.node?.title === 'command_execution' || content.some(entry => entry.label === '执行说明')) && <p className="record-caption text-ds-muted">未记录可提取的命令原文；执行说明不作为命令。</p>}
    {(facts.shell || facts.workdir) && <p className="break-all font-mono record-caption text-ds-muted">{facts.shell && 'Shell：' + facts.shell}{facts.shell && facts.workdir ? ' · ' : ''}{facts.workdir && '工作目录：' + facts.workdir}</p>}
    {content.filter(entry => entry.label === '消息').map(entry => <SourceText key={sourceKey + entry.label} {...{ label: entry.label, value: entry.text, sourceKey: sourceKey + entry.label, presentation }} />)}
    {results.length > 0 && <SourceDisclosure label={'结果与输出（' + results.length + ' 项）'} sourceKey={sourceKey + ':results'} presentation={presentation}>{() => <>{results.map(entry => <SourceText key={sourceKey + entry.label} label={entry.label} value={entry.text} sourceKey={sourceKey + entry.label} presentation={presentation} output />)}</>}</SourceDisclosure>}
    {content.some(entry => entry.label === '执行说明') && <SourceDisclosure label="执行说明（非命令原文）" sourceKey={sourceKey + ':description'} presentation={presentation}>{() => <>{content.filter(entry => entry.label === '执行说明').map(entry => <SourceText key={entry.label} label={entry.label} value={entry.text} sourceKey={sourceKey + entry.label} presentation={presentation} />)}</>}</SourceDisclosure>}
    {!content.length && view.sourceStatus !== 'unavailable' && <p className="record-text text-ds-muted">此来源没有可读正文，可展开原始数据核对。</p>}
    <SourceDisclosure label="技术字段与原始 JSON" sourceKey={sourceKey + ':json'} presentation={presentation}>{() => <SourceText label="原始 JSON" value={JSON.stringify({ source: view.node?.source, raw: view.raw }, null, 2)} sourceKey={sourceKey + ':json-page'} presentation={presentation} />}</SourceDisclosure>
    <p className="record-caption text-ds-muted">原文保全、执行状态与科研判断分别核对；浏览不代表科研结论已验证。</p>
  </div>
}
