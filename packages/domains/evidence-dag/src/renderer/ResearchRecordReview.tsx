import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { researchRecordContracts, type ResearchRecordScope, type ResearchRecordReview, type ResearchRecordAudit } from '../research-record-contract'
import { recordReviewTone, RecordOperationIcon } from './research-record-visual'
import { RecordLongText } from './RecordLongText'
import { useRecordSelectionLock } from './RecordWindow'
import { ResearchRecordPaging } from './ResearchRecordPaging'
import type { ResearchRecordPresentation } from './research-record-presentation'

const button = 'rounded px-2 py-1 record-caption text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50'
const kinds: Record<string, string> = { open: '未决', negative: '负例', 'model-organization': '轮次更新', 'model-rejected': '整理未采纳', 'phase-synthesis': '阶段综合', 'human-fields': '手动修改', 'human-edit': '阶段调整', 'human-settings': '整理设置', 'human-retry': '恢复整理' }
const status = { matched: '与生成时一致', changed: '内容已变化', unavailable: '暂不可读', 'not-recorded': '旧记录未保存校验信息', 'not-applicable': '不涉及模型调用' }
const fields: Record<string, string> = { title: '标题', summary: '摘要', parentId: '阶段归属', locks: '字段固定', model: '整理模型', paused: '暂停状态' }
const show = (value: unknown) => value === null ? '未记录' : typeof value === 'string' ? value || '（空）' : JSON.stringify(value)

export function RecordReview({ scope, nodeId, revision, invoker, presentation, active, onInspect, onDiscuss, full = false }: {
  scope: ResearchRecordScope; nodeId: string; revision: number; invoker: DomainRendererCapabilityInvoker;
  presentation: ResearchRecordPresentation; active: boolean; full?: boolean; onInspect: (id: string, ids?: readonly string[], title?: string) => void; onDiscuss: (id: string) => Promise<void>
}): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const key = JSON.stringify([scope.runtimeId, scope.threadId, scope.workspaceRoot, nodeId]), position = state.review[key]
  const [review, setReview] = useState<ResearchRecordReview>()
  const [audit, setAudit] = useState<ResearchRecordAudit>()
  const [error, setError] = useState('')
  const root = useRef<HTMLElement>(null)
  const selected = useRecordSelectionLock(root)
  const pagingKey = JSON.stringify(['review', key, position?.mode, position?.baseline])
  const page = state.pages[pagingKey]
  const open = full || (position?.open ?? false)
  const expanded = full || (position?.expanded ?? false)
  const contentId = useId()
  const auditRequest = useRef(0)
  const clearAudit = () => { auditRequest.current++; setAudit(undefined) }
  useEffect(() => { presentation.reviewScope(key); clearAudit(); setReview(undefined); setError(''); return () => { auditRequest.current++ } }, [key, presentation])
  useEffect(() => {
    if (!active || !position || selected) return
    let live = true
    void invoker.invoke(researchRecordContracts.review, { ...scope, nodeId, mode: position.mode, sinceSequence: position.baseline,
      ...(position.through !== undefined ? { throughSequence: position.through } : {}), offset: 0, limit: 20, ...(page?.cursor ? { cursor: page.cursor } : {}) }, { workspaceId: scope.workspaceRoot })
      .then(result => { if (live) { setReview(result); setError(''); presentation.reviewScope(key, result.latestSequence) } })
      .catch(error => { if (live) setError(String(error)) })
    return () => { live = false }
  }, [active, invoker, key, nodeId, position, presentation, revision, scope, page?.cursor, selected])
  useEffect(() => { if (!active || !open) clearAudit() }, [active, open])
  const inspectAudit = async (sequence: number) => {
    const request = ++auditRequest.current
    setError(''); setAudit(undefined)
    try {
      const result = await invoker.invoke(researchRecordContracts.audit, { ...scope, sequence }, { workspaceId: scope.workspaceRoot })
      if (request === auditRequest.current) setAudit(result)
    } catch (error) { if (request === auditRequest.current) setError(String(error)) }
  }
  const mode = position?.mode ?? 'changes'
  const items = expanded ? review?.items : review?.items.slice(0, 3)
  const workerSummary = !review || (!review.pending && !review.blocked) ? '' : [
    review.worker === 'working' ? '整理中' : review.worker === 'foreground' ? '前台进行中' : review.worker === 'paused' ? '旁路已暂停' : review.worker === 'cooldown' ? '合并更新中' : `${review.pending} 轮待整理`,
    ...(review.blocked ? [`${review.blocked} 轮待恢复`] : [])
  ].join(' · ')
  return <section ref={root} className="mb-4 min-w-0 rounded-lg border border-ds-border px-3 py-2" aria-label="研究回看">
    <div className="flex flex-wrap items-center gap-1">
      {([['changes', '新增变化'], ['attention', '待关注'], ['history', '修订记录']] as const).map(([value, label]) => <button key={value} data-record-tone={value === 'attention' ? 'check' : 'neutral'} className={`record-review-tab ${button} ${mode === value ? 'bg-ds-hover font-medium text-ds-ink' : ''}`} aria-pressed={mode === value}
        disabled={selected} onClick={() => { presentation.resetPage(JSON.stringify(['review', key, value, position?.baseline])); presentation.setReview(key, { mode: value, offset: 0, through: undefined, open: true, expanded: false }); clearAudit() }}>{label}</button>)}
      {review && <span className="ml-auto record-caption text-ds-muted">{review.total} 条</span>}
      {!open && workerSummary && <span className="record-caption text-ds-muted">· {workerSummary}</span>}
      <button hidden={full} className={button} aria-expanded={open} aria-controls={contentId}
        onClick={() => { presentation.setReview(key, { open: !open }); if (open) clearAudit() }}>{open ? '收起回看' : '展开回看'}</button>
    </div>
    {!open && review && <div aria-label="本轮变化概览" className="mt-2 space-y-1 record-caption text-ds-muted"><p>自浏览基线 #{position?.baseline ?? 0} 的变化；不是正式审阅回执。</p>{review.items.slice(0, 3).map(item => <p key={item.id} data-record-tone={recordReviewTone(item)}><span>{kinds[item.kind] ?? item.kind} · </span><button className="text-left hover:underline" onClick={() => onInspect(item.nodeId)}>{item.title}</button><span className="record-description line-clamp-2">{item.text}</span></p>)}{!review.items.length && <p>暂无已整理的变化；覆盖缺口与原始过程仍需检查。</p>}</div>}
    {open && <div id={contentId}>
    {mode === 'changes' && <p className="mt-1 record-caption text-ds-muted">浏览基线 #{position?.baseline ?? 0} → #{review?.throughSequence ?? '未知'}；自上次打开此范围以来。打开和浏览不构成正式审阅、批准或科学认可。</p>}
    {mode === 'attention' && <p className="mt-1 record-caption text-ds-muted">未决问题与负例；保留来源，按需讨论，无需逐项确认。</p>}
    {review && (review.pending > 0 || review.blocked > 0) && <p className="mt-2 record-caption text-ds-muted">{review.worker === 'working' ? '正在整理新增内容。' : review.worker === 'foreground' ? '前台任务进行中，旁路稍后合并整理。' : review.worker === 'paused' ? '旁路已暂停，原始记录可查看。' : review.worker === 'cooldown' ? '正在合并更新，稍后整理。' : `${review.pending} 轮待整理。`}{review.blocked > 0 ? ` ${review.blocked} 轮需恢复，可在管理菜单重试；已有内容保留。` : ''}</p>}
    <div className="mt-2 space-y-2">
      {items?.map(item => <article key={item.id} className="record-review-item min-w-0 record-text" data-record-tone={recordReviewTone(item)}>
        <div className="flex flex-wrap items-center gap-2 record-caption text-ds-muted"><span><RecordOperationIcon kind={item.origin === 'human' ? 'human' : recordReviewTone(item) === 'check' ? 'attention' : 'summary'} />{kinds[item.kind] ?? item.kind}</span>{item.origin === 'model' && <span>模型整理</span>}{item.historical && <span>已迁出</span>}{item.limited && <span>节选</span>}</div>
        <button className="mt-1 block max-w-full truncate text-left font-medium hover:underline" onClick={() => mode === 'attention' && item.sourceIds.length ? onInspect(item.sourceIds[0], item.sourceIds, item.text) : item.nodeId === 'root' ? presentation.navigate('root') : onInspect(item.nodeId)}>{item.title}</button>
        <p className="record-description mt-1 line-clamp-2 select-text whitespace-pre-wrap record-text leading-relaxed text-ds-muted">{item.text}</p>
        <div className="mt-1 flex flex-wrap gap-1"><button className={button} onClick={() => void onDiscuss(item.nodeId)}>讨论此项</button>
          {item.sequence > 0 && <button className={button} onClick={() => void inspectAudit(item.sequence)}>来源与修订</button>}
          {item.sourceIds.length > 0 && <button className={button} onClick={() => onInspect(item.sourceIds[0], item.sourceIds, item.text)}>查看依据（{item.sourceIds.length}）</button>}
        </div>
      </article>)}
      {review && !review.items.length && <p className="py-1 record-caption text-ds-muted">{mode === 'attention' ? '当前没有已整理出的未决问题或负例；这不表示研究已验证。' : mode === 'changes' ? '此范围暂无新增整理；完整过程仍在下方。' : '此范围暂无修订记录。'}</p>}
    </div>
    {review && <div className="mt-1 flex flex-wrap gap-1">
      {!expanded && review.items.length > 3 && <button className={button} onClick={() => presentation.setReview(key, { expanded: true })}>展开本页</button>}
      {expanded && review.page && <ResearchRecordPaging label="回看" offset={page?.offset ?? 0} count={review.items.length} total={review.total} hasPrevious={!!page?.previous.length} hasNext={review.page.nextCursor !== null} disabled={selected || !!error} onPrevious={() => { clearAudit(); presentation.previousPage(pagingKey) }} onNext={() => { if (review.page?.nextCursor && review.page.nextOffset !== null) { clearAudit(); presentation.nextPage(pagingKey, review.page.nextCursor, review.page.nextOffset); presentation.setReview(key, { through: review.throughSequence }) } }} />}
      {error && <button className={button} disabled={selected} onClick={() => { presentation.resetPage(pagingKey); presentation.setReview(key, { offset: 0, through: undefined }) }}>刷新回看首页</button>}
      {position?.through !== undefined && review.latestSequence > position.through && <button className={button} disabled={selected} onClick={() => { presentation.resetPage(pagingKey); presentation.setReview(key, { offset: 0, through: undefined }) }}>查看新到更新</button>}
    </div>}
    {audit && <div className="mt-3 space-y-2 border-t border-ds-border pt-2 record-text" aria-label="修订依据">
      <div className="flex flex-wrap items-center gap-1"><strong>修订 #{audit.sequence}</strong><span className="text-ds-muted">{audit.at}</span><button className={`${button} ml-auto`} onClick={clearAudit}>收起依据</button></div>
      <p className="text-ds-muted">{audit.kind === 'model-rejected' ? '此模型结果未通过校验，未作为研究状态采纳。' : audit.origin === 'model' ? '模型归纳，科研结论仍须结合来源判断。' : '记录手动调整；不等于身份认证或科研验证。'}</p>
      {audit.changes.map(change => <RecordLongText key={change.field} id={`audit:${audit.sequence}:${change.field}`} label={`${fields[change.field] ?? change.field}变更`} text={`此前：${show(change.before)}\n此后：${show(change.after)}`} presentation={presentation} />)}
      <div className="flex flex-wrap gap-1">{audit.sources.map((source, i) => <button key={source.id} className={button} onClick={() => onInspect(source.id, audit.sources.map(item => item.id), '修订 #' + audit.sequence)}>来源 {i + 1} · {source.status === 'current' ? '内容一致' : source.status === 'changed' ? '已变化' : '不可读'}{source.rawOrigin === 'retained' ? ' · 历史观察已保全' : source.retainedSource === 'denied' ? ' · 原来源无权限' : ''}</button>)}</div>
      {audit.sourcesLimited && <p>本页来源为节选，不能当作全部证据覆盖。</p>}
      {audit.execution && <details><summary className="cursor-pointer">整理调用与校验</summary><p className="mt-1 break-all text-ds-muted">{audit.execution.runtimeId} · 请求模型：{audit.execution.requestedModel || '沿用配置'}</p><p className="break-all text-ds-muted">会话 {audit.execution.threadId} / 轮次 {audit.execution.turnId}</p><p>输入：{status[audit.inputStatus]}；输出：{status[audit.outputStatus]}</p>{audit.recipe && <p className="break-all text-ds-muted">整理规则 {audit.recipe.version} · 输入 {audit.recipe.dataChars} 字符<br />输入摘要值 {audit.recipe.inputDigest}<br />输出摘要值 {audit.recipe.outputDigest}</p>}</details>}
      {audit.input !== null && <RecordLongText id={`audit:${audit.sequence}:input`} label={audit.inputStatus === 'matched' ? '当次整理输入' : '当前可读输入（与记录不一致）'} text={audit.input} presentation={presentation} />}
      {audit.output !== null && <RecordLongText id={`audit:${audit.sequence}:output`} label={audit.outputStatus === 'matched' ? '当次模型输出' : '当前可读输出（与记录不一致）'} text={audit.output} presentation={presentation} />}
    </div>}
    </div>}
    {error && <p role="alert" className="mt-2 record-text text-ds-muted">{error}</p>}
  </section>
}
