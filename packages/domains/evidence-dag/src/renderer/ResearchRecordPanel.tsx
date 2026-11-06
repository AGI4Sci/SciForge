import { ResearchSourceRetention } from './ResearchSourceRetention'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type CSSProperties } from 'react'
import { ArrowUpRight, ChevronDown, ChevronRight, MessageSquare, RefreshCw, Settings2, X } from 'lucide-react'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost, DomainRendererVisibleContextHost, DomainRendererSelectionSnapshot } from '@sciforge/domain-sdk/host'
import { researchRecordContracts, type ResearchRecordNode, type ResearchRecordScope, type ResearchRecordView } from '../research-record-contract'
import { createResearchRecordPresentation, recordPageKey, recordDateLabel, recordNarrativeLayer, researchRecordDiscussionContext, type ResearchRecordPresentation } from './research-record-presentation'
import { researchRecordVisualTarget, useResearchRecordVisualTarget } from './research-record-visible-context'
import { ResearchRecordSelection } from './ResearchRecordSelection'
import { RecordCoverage, RecordSynthesis, RecordUnderstanding } from './ResearchRecordSummary'
import { RESEARCH_READING_SIZES, RESEARCH_READING_DEFAULT, researchRecordReadingStyles } from './research-record-reading'
import { recordVisualState, recordOperation, RecordOperationIcon, RecordStatus } from './research-record-visual'
import { RecordLongText } from './RecordLongText'
import { RecordWindow, useRecordSelectionLock } from './RecordWindow'
import { ResearchRecordCompact } from './ResearchRecordCompact'
import { ResearchRecordScientificReview } from './ResearchRecordScientificReview'
import { ResearchRecordMedia } from './ResearchRecordMedia'
import { ResearchRecordSearch } from './ResearchRecordSearch'
import { ResearchRecordPaging } from './ResearchRecordPaging'
import { RecordFields } from './ResearchRecordFields'
import { RecordReview } from './ResearchRecordReview'
import { ResearchRecordCheckpoint } from './ResearchRecordCheckpoint'
import { ResearchRecordSource, researchRecordSourceNavigation } from './ResearchRecordSource'

const button = 'rounded-lg border border-ds-border px-2 py-1 record-text text-ds-ink hover:bg-ds-hover disabled:opacity-50'
const field = 'w-full rounded-lg border border-ds-border bg-ds-main p-2 record-text text-ds-ink'
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const emptyQuery = Object.freeze({})
const statusLabels: Record<string, string> = { failed: '失败', error: '失败', cancelled: '已取消', aborted: '已终止', completed: '已完成', success: '成功', running: '进行中', pending: '等待中', complete: '已记录' }
const recordTitles: Record<string, string> = { user_message: '用户要求', 'user-message': '用户要求', assistant_message: '助手说明', 'assistant-message': '助手说明', command_execution: '终端执行', tool_call: '工具使用' }

function selectionAttributes(node: ResearchRecordNode) {
  const source = node.source
  return { 'data-selection-record-id': node.id, 'data-selection-record-label': node.title || '研究记录',
    ...(source ? { 'data-selection-source': JSON.stringify({ runtimeId: source.runtimeId, threadId: source.threadId, turnId: source.turnId, itemId: source.itemId }) } : {}) }
}

function containsSelection(element: HTMLElement): boolean {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && element.contains(selection.anchorNode))
}

type ResearchRecordPanelProps = {
  returnContributionId?: string
  scope: ResearchRecordScope; invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost;
  presentation?: ResearchRecordPresentation
  sourcePresentation?: 'right-panel' | 'global-overlay'
  visibleContext?: DomainRendererVisibleContextHost; active?: boolean
}

/** A scope owns every retained view, detail and visual registration. Remount
 * before rendering a new scope, rather than clearing old material in an effect. */
export function ResearchRecordPanel(props: ResearchRecordPanelProps): ReactElement {
  const { runtimeId, threadId, workspaceRoot } = props.scope
  return <ScopedResearchRecordPanel key={JSON.stringify([runtimeId, threadId, workspaceRoot])} {...props} />
}

function ScopedResearchRecordPanel({ scope, invoker, workbench, presentation: providedPresentation, visibleContext, active = true, sourcePresentation = 'right-panel', returnContributionId }: ResearchRecordPanelProps): ReactElement {
  const [localPresentation] = useState(createResearchRecordPresentation)
  const presentation = providedPresentation ?? localPresentation
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const [view, setView] = useState<ResearchRecordView>()
  const [detail, setDetail] = useState<ResearchRecordView>()
  const [detailError, setDetailError] = useState('')
  const [detailRetry, setDetailRetry] = useState(0)
  const [detailTab, setDetailTab] = useState<'summary' | 'source' | 'media'>('summary')
  useEffect(() => setDetailTab('summary'), [state.selectedId])
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [phaseTitle, setPhaseTitle] = useState('')
  const [parentId, setParentId] = useState('root')
  const [model, setModel] = useState('')
  const [phaseOptions, setPhaseOptions] = useState<ResearchRecordNode[]>([])
  const componentId = `research-record:${useId()}`
  const surfaceRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const restoringScroll = useRef(true)
  const acceptedView = useRef<{ key: string; revision: number } | null>(null)
  const focusId = state.focusId
  const selected = useRecordSelectionLock(surfaceRef)
  const query = state.queries[focusId] ?? emptyQuery
  const synthesisOffset = state.offsets[`server-synthesis:${focusId}`] ?? 0
  const messageOffset = state.offsets[`server-messages:${focusId}`] ?? 0
  const pageKey = recordPageKey(focusId, query, synthesisOffset, messageOffset)
  const page = state.pages[pageKey]
  const offset = page?.offset ?? 0
  const scopeKey = JSON.stringify([scope.runtimeId, scope.threadId, scope.workspaceRoot])
  const requestKey = JSON.stringify([scopeKey, pageKey, page?.cursor, offset])
  const detailSynthesisOffset = state.offsets[`server-synthesis:${state.selectedId}`] ?? 0
  const detailMessageOffset = state.offsets[`server-messages:${state.selectedId}`] ?? 0
  const viewInput = { ...scope, nodeId: focusId, offset: 0, limit: 100, query,
    ...(page?.cursor ? { cursor: page.cursor } : {}), synthesisOffset, messageOffset }
  useEffect(() => { setView(undefined); setDetail(undefined); acceptedView.current = null }, [scopeKey])
  useEffect(() => visibleContext?.registerComponent({
    id: componentId, region: 'workspace', component: 'ResearchRecordPanel', title: view?.node?.title || '研究记录',
    visible: active, priority: 70, updatedAt: new Date().toISOString(), summary: (view?.node?.summary || '按阶段查看研究记录').slice(0, 2000),
    state: { runtimeId: scope.runtimeId, threadId: scope.threadId, workspaceRoot: scope.workspaceRoot, nodeId: focusId }
  }), [active, componentId, focusId, scope.runtimeId, scope.threadId, scope.workspaceRoot, view?.node?.summary, view?.node?.title, visibleContext])
  useResearchRecordVisualTarget({ visibleContext, componentId, target: researchRecordVisualTarget(scope, view?.node ?? null, 'record-overview'), element: surfaceRef, active })
  useResearchRecordVisualTarget({ visibleContext, componentId, target: researchRecordVisualTarget(scope, detail?.node ?? null, 'record-detail'), element: detailRef, active: active && Boolean(detail?.node && state.selectedId) })
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const rememberPhases = useCallback((nodes: ResearchRecordNode[]) => setPhaseOptions(previous => {
    const phases = nodes.filter(node => node.kind === 'phase')
    if (!phases.length) return previous
    const next = [...new Map([...previous, ...phases].map(node => [node.id, node])).values()]
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
  }), [])
  useEffect(() => {
    if (!active) return
    let alive = true, reading = false, failed = false
    const read = async () => {
      if (reading || failed || document.hidden) return
      reading = true
      try {
        const result = await invoker.invoke(researchRecordContracts.view, { ...scope, nodeId: focusId, offset: 0, limit: 100, query, ...(page?.cursor ? { cursor: page.cursor } : {}), synthesisOffset, messageOffset }, { workspaceId: scope.workspaceRoot })
        if (!alive) return
        const key = requestKey
        if (acceptedView.current?.key === key && (acceptedView.current.revision !== result.revision || result.node?.source) && surfaceRef.current && containsSelection(surfaceRef.current)) {
          setUpdateAvailable(true)
          return
        }
        setUpdateAvailable(false)
        const sameRequest = acceptedView.current?.key === key
        acceptedView.current = { key, revision: result.revision }
        setView(previous => sameRequest && !result.node?.source && previous?.revision === result.revision && previous.node?.id === result.node?.id && previous.pending === result.pending && previous.paused === result.paused && previous.children[0]?.id === result.children[0]?.id ? previous : result); setError(''); rememberPhases([...result.ancestors, ...(result.node ? [result.node] : []), ...result.children])
        presentation.initialize(focusId, result.children, result.latestRecordPath)
      } catch (error) { if (alive) { failed = true; setError(errorText(error)) } }
      finally { reading = false }
    }
    void read()
    const timer = setInterval(() => void read(), 3500)
    const visible = () => { if (!document.hidden) void read() }
    document.addEventListener('visibilitychange', visible)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [active, scope, invoker, revision, offset, focusId, presentation, rememberPhases, requestKey, query, page?.cursor, synthesisOffset, messageOffset])
  useEffect(() => {
    if (!active || !updateAvailable) return
    const resume = () => {
      if (!surfaceRef.current || !containsSelection(surfaceRef.current)) { setUpdateAvailable(false); refresh() }
    }
    document.addEventListener('selectionchange', resume)
    return () => document.removeEventListener('selectionchange', resume)
  }, [active, updateAvailable, refresh])
  useEffect(() => { setModel(view?.model ?? '') }, [view?.model])
  const hasView = Boolean(view)
  useLayoutEffect(() => {
    const element = scrollRef.current
    // Hidden panels and loading chapters can clamp scrollTop to zero. Their
    // synthetic scroll events must not replace the saved reading position.
    restoringScroll.current = true
    if (!element || !active || !hasView) return
    const top = presentation.getSnapshot().scrollPositions[`${focusId}:${state.recordView}`] ?? 0
    const stop = () => { observer.disconnect(); restoringScroll.current = false }
    const restore = () => { element.scrollTop = top }
    const observer = new ResizeObserver(restore)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    restore()
    // Several nested chapters can load and temporarily shrink in sequence. Keep
    // restoring through those layout changes, until the user's first interaction.
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    events.forEach(name => element.addEventListener(name, stop, { passive: true }))
    return () => { stop(); events.forEach(name => element.removeEventListener(name, stop)) }
  }, [active, focusId, state.recordView, hasView, presentation])
  useEffect(() => {
    let alive = true
    setDetail(undefined); setDetailError('')
    if (active && state.selectedId) void invoker.invoke(researchRecordContracts.view, { ...scope, nodeId: state.selectedId, includeScientificReview: true, offset: 0, synthesisOffset: detailSynthesisOffset, messageOffset: detailMessageOffset }, { workspaceId: scope.workspaceRoot })
      .then(result => { if (alive) { setDetail(result); if (!result.node) setDetailError('此记录当前不可用；来源引用仍保留。') } }).catch(error => { if (alive) setDetailError(errorText(error)) })
    return () => { alive = false }
  }, [active, state.selectedId, scope, invoker, view?.revision, detailSynthesisOffset, detailMessageOffset, detailRetry])
  const rememberPosition = () => { if (scrollRef.current) presentation.rememberScroll(`${focusId}:${state.recordView}`, scrollRef.current.scrollTop) }
  const navigate = (id: string) => { if (id === focusId) return; rememberPosition(); setView(undefined); presentation.navigate(id) }
  const changeView = (recordView: typeof state.recordView) => { rememberPosition(); presentation.update({ recordView }) }
  const focusSource = (id: string) => {
    rememberPosition()
    if (id !== focusId) setView(undefined)
    presentation.focusSource(id)
  }
  const edit = async (change: import('../research-record-contract').ResearchRecordEdit['change']) => {
    if (!view) return false
    setBusy(true); setError('')
    try {
      await invoker.invoke(researchRecordContracts.edit, { ...scope, requestId: crypto.randomUUID(), expectedRevision: view.revision, change }, { workspaceId: scope.workspaceRoot })
      const result = await invoker.invoke(researchRecordContracts.view, viewInput, { workspaceId: scope.workspaceRoot })
      setView(result); refresh()
      return true
    } catch (error) { setError(errorText(error)); return false }
    finally { setBusy(false) }
  }
  const discuss = async (id: string, selection?: DomainRendererSelectionSnapshot) => {
    if (!workbench?.openSideConversation) { setError('当前工作台尚未提供原生侧聊入口。'); return }
    setBusy(true); setError('')
    try {
      const result = await invoker.invoke(researchRecordContracts.view, { ...scope, nodeId: id, offset: 0, includeDiscussionContext: true }, { workspaceId: scope.workspaceRoot })
      if (!await workbench.openSideConversation(researchRecordDiscussionContext(scope, result, selection))) throw new Error('无法打开侧聊，请检查当前 Agent 连接。')
    } catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  const openSource = async (sourceView: ResearchRecordView) => {
    const request = researchRecordSourceNavigation(scope, sourceView, sourcePresentation, returnContributionId)
    if (!request || !workbench?.openSession) { setError('当前工作台无法打开原始会话。'); return }
    if (scrollRef.current) presentation.rememberScroll(`${focusId}:${state.recordView}`, scrollRef.current.scrollTop)
    setBusy(true); setError('')
    try {
      if (!await workbench.openSession(request)) setError('原始会话当前不可用或读取超时；研究记录仍保留。')
    } catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  const currentRound = async () => {
    const id = view?.latestRecordPath.at(-1)
    if (!id) return
    setBusy(true); setError('')
    try {
      const result = await invoker.invoke(researchRecordContracts.view, { ...scope, nodeId: id, offset: 0 }, { workspaceId: scope.workspaceRoot })
      const round = [...result.ancestors, ...(result.node ? [result.node] : [])].reverse().find(node => node.kind === 'round')
      changeView('process'); navigate(round?.id ?? id)
    } catch (error) { setError(errorText(error)) }
    finally { setBusy(false) }
  }
  const currentPath = useMemo(() => new Set(view?.latestRecordPath ?? []), [view?.latestRecordPath])
  const editableNode = [detail?.node, view?.node].find(node => node && ['phase', 'round'].includes(node.kind))
  return <div ref={surfaceRef} className="sf-research-reading relative flex h-full min-h-0 min-w-0 flex-col bg-ds-main text-ds-ink" style={{ '--record-reading-size': `${state.readingSize}px` } as CSSProperties} data-research-record-surface="true">
    <style>{researchRecordReadingStyles}</style>
    <div className="record-panel-header shrink-0 space-y-3 border-b border-ds-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="record-title font-medium">科研审计</strong><span className="ml-auto record-caption text-ds-muted">{view?.paused ? '整理已暂停' : ''}</span>
        <div className="record-reading-controls flex items-center gap-1 rounded border border-ds-border" role="group" aria-label="研究阅读字号">
          <button className="rounded hover:bg-ds-hover disabled:opacity-40" aria-label="缩小研究文字" disabled={state.readingSize <= RESEARCH_READING_SIZES[0]} onClick={() => presentation.setReadingSize(RESEARCH_READING_SIZES[Math.max(0, RESEARCH_READING_SIZES.findIndex(size => size === state.readingSize) - 1)])}>A−</button>
          <button className="rounded px-1 hover:bg-ds-hover" title="恢复默认阅读字号，不改变界面或图片缩放" aria-label="恢复默认研究字号" onClick={() => presentation.setReadingSize(RESEARCH_READING_DEFAULT)}>{state.readingSize}</button>
          <button className="rounded hover:bg-ds-hover disabled:opacity-40" aria-label="放大研究文字" disabled={state.readingSize >= RESEARCH_READING_SIZES.at(-1)!} onClick={() => presentation.setReadingSize(RESEARCH_READING_SIZES[Math.min(RESEARCH_READING_SIZES.length - 1, RESEARCH_READING_SIZES.findIndex(size => size === state.readingSize) + 1)])}>A+</button>
        </div>
        <button className="rounded px-2 py-1 record-caption text-ds-muted hover:bg-ds-hover" disabled={busy || !view?.latestRecordPath.length} onClick={() => void currentRound()}>定位当前轮次</button>
        <button className="rounded p-1 text-ds-muted hover:bg-ds-hover" disabled={selected} onClick={() => { presentation.resetPage(pageKey); refresh() }} aria-label="刷新研究记录"><RefreshCw size={13} /></button>
        <details className="relative"><summary aria-label="管理研究记录" className="cursor-pointer list-none rounded p-1 text-ds-muted hover:bg-ds-hover"><Settings2 size={14} /></summary>
          <div className="absolute right-0 top-8 z-20 max-h-[65vh] w-72 max-w-[80vw] space-y-2 overflow-auto rounded-xl border border-ds-border bg-ds-main p-3 shadow-lg">
            <input className={field} aria-label="阶段名称" placeholder="长期阶段或子阶段名称" value={phaseTitle} onChange={event => setPhaseTitle(event.target.value)} />
            <select className={field} aria-label="父阶段" value={parentId} onChange={event => setParentId(event.target.value)}><option value="root">整个课题</option>{phaseOptions.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
            <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !phaseTitle.trim()} onClick={() => void edit({ kind: 'phase', parentId, title: phaseTitle, summary: '' })}>新增阶段</button><button className={button} disabled={busy || !editableNode} onClick={() => void edit({ kind: 'move', nodeId: editableNode!.id, parentId })}>归入该阶段</button></div>
            {editableNode && <RecordFields node={editableNode} busy={busy} presentation={presentation} onEdit={edit} />}
            <input className={field} aria-label="整理模型" placeholder="旁路模型，留空沿用 Agent 配置" value={model} onChange={event => setModel(event.target.value)} />
            <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !view} onClick={() => void edit({ kind: 'settings', paused: !view?.paused, model })}>{view?.paused ? '继续整理' : '暂停整理'}</button><button className={button} disabled={busy || !view} onClick={() => void edit({ kind: 'settings', paused: view?.paused ?? false, model })}>保存模型</button><button className={button} disabled={busy} onClick={() => void edit({ kind: 'retry' })}>重试整理</button></div>
            <p className="record-caption text-ds-muted">复用来源 Agent 接入。摘要来自可见会话快照，原始行为按需读取。</p>
            {!!view?.failures.length && <details><summary className="cursor-pointer record-text text-ds-muted">整理失败记录（{view.failures.length}）</summary>{view.failures.map((failure, index) => <p key={index} className="mt-1 record-text">{failure.message}</p>)}</details>}
          </div>
        </details>
      </div>
      <nav aria-label="研究阶段路径" className="flex flex-wrap items-center gap-1 record-caption text-ds-muted"><button className="hover:text-ds-ink aria-[current=page]:font-medium aria-[current=page]:text-ds-ink" aria-current={focusId === 'root' ? 'page' : undefined} onClick={() => navigate('root')}>整个课题</button>{[...(view?.ancestors ?? []), ...(view?.node ? [view.node] : [])].map(node => <span key={node.id} className="flex min-w-0 items-center gap-1"><ChevronRight size={11} /><button className="max-w-48 truncate hover:text-ds-ink aria-[current=page]:font-medium aria-[current=page]:text-ds-ink" title={node.title} aria-current={node.id === focusId ? 'page' : undefined} onClick={() => navigate(node.id)}>{node.title}</button></span>)}</nav>
      <nav aria-label="研究视图" className="record-view-tabs flex flex-wrap gap-1">{([['overview', '精简列表'], ['changes', '审查变化'], ['process', '局部过程']] as const).map(([value, label]) => <button key={value} className={`${button} ${state.recordView === value ? 'bg-ds-hover font-medium' : ''}`} aria-pressed={state.recordView === value} onClick={() => changeView(value)}>{label}</button>)}{state.navigation.length > 0 && <button className={button} onClick={() => { rememberPosition(); setView(undefined); presentation.back() }}>返回上一范围</button>}</nav>
      {error && <p role="alert" className="record-text text-ds-ink">{error}</p>}
      {updateAvailable && <p role="status" className="record-caption text-ds-muted">自动读取暂缓；保留当前选区与其版本，取消选区后核对来源和新修订。</p>}
    </div>
    <ResearchRecordSelection key={`${focusId}:${state.recordView}`} root={surfaceRef} scope={scope} workbench={workbench} revision={view?.revision ?? 0} active={active} onDiscuss={selection => discuss(selection.resourceId, selection)} />
    <div className="record-body">
    <div ref={scrollRef} onScroll={event => { if (active && !restoringScroll.current) presentation.rememberScroll(`${focusId}:${state.recordView}`, event.currentTarget.scrollTop) }} className="record-scroll min-h-0 min-w-0 flex-1 overflow-auto px-5 pb-8 pt-3" aria-label="阶段与推进过程"><div className="mx-auto min-w-0 max-w-4xl [overflow-wrap:anywhere]">
      {!view?.node?.source && <ResearchRecordSearch key={`${scopeKey}:${focusId}`} query={query} disabled={selected} onQuery={value => { presentation.query(focusId, value); presentation.resetPage(recordPageKey(focusId, value, synthesisOffset, messageOffset)); setView(undefined) }} />}
      {view && !view.node?.source && state.recordView === 'changes' && <RecordReview scope={scope} nodeId={focusId} revision={view.revision} invoker={invoker} presentation={presentation} active={active}
        onInspect={presentation.inspect} onDiscuss={discuss} full={state.recordView === 'changes'} />}
      {state.recordView !== 'overview' && <div className="mb-2 flex flex-wrap items-center gap-2 record-caption text-ds-muted"><span>{view?.node?.source ? '原始依据' : state.recordView === 'changes' ? '版本变化与来源核对' : '仅显示当前范围的直接成员'}</span><span className="ml-auto flex shrink-0 gap-1">{!view?.node?.source && <button className="rounded px-1 py-1 hover:bg-ds-hover" onClick={() => presentation.collapseLevel(view?.children ?? [])}>收起本层</button>}{!!state.collapsedGroups[focusId]?.length && <button className="rounded px-1 py-1 hover:bg-ds-hover" onClick={presentation.restoreLevel}>恢复本层展开</button>}<button className="rounded px-1 py-1 hover:bg-ds-hover" disabled={busy} onClick={() => void discuss(focusId)}>讨论此范围</button></span></div>}
      {view?.node?.source && <section className="mb-3 space-y-3" aria-label="原始依据" {...selectionAttributes(view.node)}><div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 flex-1 select-text break-words record-title font-medium">{view.node.title}</h2>{state.sourceReturnId !== null && <button className={button} onClick={() => navigate(state.sourceReturnId!)}>返回之前范围</button>}</div><ResearchRecordSource view={view} onOpen={value => void openSource(value)} busy={busy} presentation={presentation} /></section>}
      {state.recordView !== 'overview' && view?.node && ['phase', 'round'].includes(view.node.kind) && <ResearchRecordCheckpoint node={view.node} scope={scope} invoker={invoker} workbench={workbench} />}
      {view && <ResearchSourceRetention view={view} scope={scope} invoker={invoker} active={active} />}
      {view?.organizationCoverage && !view.node?.source && <RecordCoverage coverage={view.organizationCoverage} scopeId={focusId} presentation={presentation} />}

      {view?.node && ['phase', 'round'].includes(view.node.kind) && state.recordView === 'process' && <div className="mb-3"><RecordSynthesis node={view.node} presentation={presentation} onInspect={presentation.inspect} disabled={selected} onOffset={value => presentation.offset(`server-synthesis:${focusId}`, value)} /></div>}
      {state.recordView !== 'overview' && !view?.children.length && !view?.node?.source && <p className="py-6 record-text text-ds-muted">{view?.node ? Object.keys(query).length ? '本范围无匹配；未加载不表示没有记录。' : '该阶段暂无记录' : '等待研究记录…'}</p>}
      {view && state.recordView !== 'overview' && <RecordMessages view={view} nodeId={focusId} offset={messageOffset} presentation={presentation} selected={selected} />}
      {view && state.recordView === 'process' && !view.node?.source && <p className="mb-2 record-caption text-ds-muted">本范围 {view.totalChildren} 个{Object.keys(query).length ? '匹配结果（含后代）' : '直接成员'}；当前读取 {view.children.length} 个{view.totalChildren > view.children.length ? '，其余未加载' : ''}。成组展示保留原始 ID，不合并实验。</p>}
      {state.recordView === 'process' && !!view?.children.some(node => node.kind === 'event') && <button className={`${button} mb-2`} aria-expanded={state.expanded.has(`raw:${focusId}`)} onClick={() => presentation.toggle(`raw:${focusId}`)}>原始行为 · 本页 {view.children.filter(node => node.kind === 'event').length} 项 · 含失败的原始结果保留</button>}
      {state.recordView === 'overview' && view && !view.node?.source && <ResearchRecordCompact view={view} presentation={presentation} onNavigate={navigate} scope={scope} componentId={componentId} active={active} visibleContext={visibleContext} />}
      {state.recordView === 'process' && <RecordWindow items={(view?.children ?? []).filter(node => Object.keys(query).length > 0 || node.kind !== 'event' || state.expanded.has(`raw:${focusId}`))} id={`${focusId}:${offset}:${state.recordView}`} label="当前范围成员" presentation={presentation} render={(node, index) => <RecordChapter key={node.id} node={node} ancestorIds={Object.keys(query).length ? view?.locations?.find(location => location.nodeId === node.id)?.ancestorIds : undefined} index={index + offset} currentPath={currentPath} scope={scope} presentation={presentation} onInspect={presentation.inspect} onDiscuss={discuss} onNavigate={navigate} visibleContext={visibleContext} componentId={componentId} active={active} overview={state.recordView === 'overview'} /> } />}
      {!!view?.page && state.recordView !== 'changes' && <ResearchRecordPaging label="范围成员" offset={offset} count={view.children.length} total={view.page.total} hasPrevious={!!page?.previous.length} hasNext={view.page.nextCursor !== null} disabled={selected || !!error} onPrevious={() => presentation.previousPage(pageKey)} onNext={() => { if (view.page?.nextCursor && view.page.nextOffset !== null) presentation.nextPage(pageKey, view.page.nextCursor, view.page.nextOffset) }} />}

    </div></div>
    {state.selectedId && <section ref={detailRef} {...(detail?.node ? selectionAttributes(detail.node) : {})} className="record-inspector min-w-0 space-y-3 overflow-auto [overflow-wrap:anywhere] border-ds-border bg-ds-main p-4" aria-label="记录详情" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); presentation.closeInspection() } }}>
      <div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words record-text">{detail?.node?.title ?? (detailError ? '详情暂不可用' : '正在读取…')}</strong><button className="rounded p-1 hover:bg-ds-hover" onClick={presentation.closeInspection} aria-label="关闭记录详情"><X size={14} /></button></div>
      {detailError && <div className="record-detail-error"><p role="alert" className="record-caption record-check-text">{detailError}</p><button type="button" className={button} onClick={() => setDetailRetry(value => value + 1)}>重试读取详情</button></div>}
      {state.inspection && state.inspection.ids.length > 1 && <nav aria-label="依据浏览" className="flex flex-wrap items-center gap-2 record-caption text-ds-muted"><span className="w-full break-words">{state.inspection.title}</span><button className={button} disabled={state.inspection.ids.indexOf(state.selectedId) <= 0} onClick={() => presentation.update({ selectedId: state.inspection!.ids[state.inspection!.ids.indexOf(state.selectedId!) - 1] })}>上一项依据</button><span>{state.inspection.ids.indexOf(state.selectedId) + 1} / {state.inspection.ids.length}</span><button className={button} disabled={state.inspection.ids.indexOf(state.selectedId) >= state.inspection.ids.length - 1} onClick={() => presentation.update({ selectedId: state.inspection!.ids[state.inspection!.ids.indexOf(state.selectedId!) + 1] })}>下一项依据</button><button className={button} onClick={presentation.closeInspection}>返回回看位置</button></nav>}
      <nav aria-label="记录详情视图" className="record-inspector-tabs">{([['summary', '摘要'], ['source', '原始依据'], ['media', '图片 / 图表']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={detailTab === value} onClick={() => setDetailTab(value)}>{label}</button>)}</nav>
      {detailTab === 'summary' && <div className="space-y-3">
      {!!detail?.ancestors.length && <nav className="flex flex-wrap items-center gap-1 record-caption text-ds-muted" aria-label="依据路径">{detail.ancestors.map(node => <span key={node.id} className="flex min-w-0 items-center gap-1"><button className="max-w-48 truncate hover:text-ds-ink" title={node.title} onClick={() => navigate(node.id)}>{node.title}</button><ChevronRight size={10} /></span>)}<span className="min-w-0 break-words text-ds-ink" aria-current="location">{detail.node?.title}</span></nav>}
      {detail?.node && ['phase', 'round'].includes(detail.node.kind) ? <RecordSynthesis node={detail.node} presentation={presentation} onInspect={presentation.inspect} disabled={selected} onOffset={value => presentation.offset(`server-synthesis:${state.selectedId}`, value)} /> : detail?.node?.summary && <p className="whitespace-pre-wrap record-text text-ds-muted">{detail.node.summary}</p>}
      {detail?.node && ['phase', 'round'].includes(detail.node.kind) && <ResearchRecordCheckpoint node={detail.node} scope={scope} invoker={invoker} workbench={workbench} />}
      </div>}
      {detail && <ResearchSourceRetention view={detail} scope={scope} invoker={invoker} active={active} />}
      {detailTab === 'summary' && detail && <ResearchRecordScientificReview view={detail} scope={scope} active={active} invoker={invoker} workbench={workbench} />}
      {detailTab === 'source' && detail && <ResearchRecordSource view={detail} onOpen={value => void openSource(value)} busy={busy} presentation={presentation} />}
      {detailTab === 'media' && detail && <ResearchRecordMedia key={state.selectedId} sourceStatus={detail.sourceStatus} raw={detail.raw} rawOrigin={detail.rawOrigin} retainedSource={detail.retainedSource} scope={scope} invoker={invoker} workbench={workbench} {...(detail.node?.source ? { onSource: () => void openSource(detail) } : {})} />}
      {detailTab === 'summary' && detail && state.selectedId && <RecordMessages view={detail} nodeId={state.selectedId} offset={detailMessageOffset} presentation={presentation} selected={selected} />}

      <button className={button} disabled={busy || !detail} onClick={() => void discuss(state.selectedId!)}>在侧聊中讨论</button>
      {detail?.node?.source && <button className={`${button} ml-2`} onClick={() => focusSource(detail.node!.id)}>聚焦此依据</button>}
    </section>}
    </div>
  </div>
}

function RecordMessages({ view, nodeId, offset, presentation, selected }: { view: ResearchRecordView; nodeId: string; offset: number; presentation: ResearchRecordPresentation; selected: boolean }): ReactElement | null {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const total = view.messageTotal ?? view.messages.length, key = `messages:${nodeId}`
  if (!total) return null
  return <details className="mb-3 record-text text-ds-muted" open={state.expanded.has(key)} onToggle={event => { if (event.currentTarget.open !== state.expanded.has(key)) presentation.toggle(key) }}>
    <summary className="cursor-pointer">此前节点讨论（{total}）</summary>
    {state.expanded.has(key) && <>
      <ResearchRecordPaging label="讨论" offset={offset} count={view.messages.length} total={total} hasPrevious={offset > 0} hasNext={view.messageNextOffset != null} disabled={selected} onPrevious={() => presentation.offset(`server-messages:${nodeId}`, Math.max(0, offset - 20))} onNext={() => { if (view.messageNextOffset != null) presentation.offset(`server-messages:${nodeId}`, view.messageNextOffset) }} />
      <RecordWindow items={view.messages} id={`${key}:${offset}`} label="本页讨论" presentation={presentation} pageSize={12} render={message => <RecordLongText key={message.id} id={message.id} label={message.role === 'user' ? '你的讨论' : '讨论助手'} text={message.text} presentation={presentation} />} />
    </>}
  </details>
}

function RecordChapter({ node, ancestorIds, index, currentPath, scope, presentation, onInspect, onDiscuss, onNavigate, visibleContext, componentId, active, overview }: {
  node: ResearchRecordNode; ancestorIds?: string[]; index: number; currentPath: ReadonlySet<string>; scope: ResearchRecordScope;
  presentation: ResearchRecordPresentation; onInspect: (id: string, ids?: readonly string[], title?: string) => void;
  onDiscuss: (id: string) => Promise<void>; onNavigate: (id: string) => void
  visibleContext?: DomainRendererVisibleContextHost; componentId: string; active: boolean; overview: boolean
}): ReactElement {
  const headerRef = useRef<HTMLDivElement>(null)
  useResearchRecordVisualTarget({ visibleContext, componentId, target: researchRecordVisualTarget(scope, node), element: headerRef, active })
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const open = state.expanded.has(node.id)
  const phase = node.kind === 'phase', capability = node.kind === 'capability', event = node.kind === 'event'
  const failed = ['failed', 'error', 'cancelled', 'aborted'].includes(node.status)
  const current = currentPath.has(node.id)
  const visualState = recordVisualState(node)
  return <section className={phase ? 'border-t border-ds-border py-3' : capability || event ? 'my-1' : 'record-chapter relative mb-3 border-l border-ds-border pb-2 pl-4'} data-record-kind={node.kind} data-record-id={node.id} data-narrative-layer={recordNarrativeLayer(node)}>
    {ancestorIds && <nav aria-label="搜索结果路径" className="flex flex-wrap gap-2 record-caption text-ds-muted">{ancestorIds.map(id => <button key={id} className="break-all underline" onClick={() => onNavigate(id)}>{id}</button>)}</nav>}
    {!phase && !capability && !event && <span className={`absolute -left-[4px] top-2 h-[7px] w-[7px] rounded-full border ${current ? 'border-accent bg-accent' : 'border-ds-border-strong bg-ds-main'}`} />}
    <div ref={headerRef} {...selectionAttributes(node)} className="record-node-head min-w-0" data-record-tone={visualState.tone}><div className="record-step-header flex min-w-0 items-start gap-1.5">
      {!event && <button className="mt-0.5 shrink-0 rounded p-1 text-ds-muted hover:bg-ds-hover" aria-label={`${open ? '收起' : '展开'} ${node.title}`} aria-expanded={open} onClick={() => presentation.toggle(node.id)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>}
      {phase && <span className={`record-index mt-1 shrink-0 record-caption ${current ? 'text-accent' : 'text-ds-muted'}`}>{String(index + 1).padStart(2, '0')}</span>}
      <div className="record-step-title min-w-0 flex-1">
      <button className={`w-full min-w-0 py-0.5 text-left ${capability ? 'record-text text-ds-ink' : event ? 'record-caption' : 'record-text'}`} aria-label={`${event ? '查看' : '展开内容'} ${node.title}`} onClick={click => {
        // Completing a text selection for an annotation must retain the selected DOM.
        if (containsSelection(click.currentTarget)) return
        event ? onInspect(node.id) : presentation.toggle(node.id)
      }}>
        <span className={`select-text ${capability ? 'inline-block rounded-md border border-ds-border px-2 py-0.5' : phase ? 'record-title font-medium' : 'font-medium'}`}><RecordOperationIcon kind={recordOperation(node)} />{capability && recordNarrativeLayer(node) === 'behavior' && <span className="font-normal">原始来源 · </span>}{recordTitles[node.title] ?? (node.title || '原始行为')}</span>
        <RecordStatus value={visualState} />
        {phase && current && <span className="ml-2 whitespace-nowrap record-caption font-normal text-accent">最近推进</span>}
        {phase && node.counts && <span className="ml-2 whitespace-nowrap record-caption font-normal text-ds-muted">{node.counts.rounds} 轮</span>}
        {!!node.summary && !capability && <span className="record-description mt-1 block line-clamp-2 select-text record-text font-normal leading-relaxed text-ds-muted">{node.summary}</span>}
        {!!node.behaviorCounts && (node.behaviorCounts.failed > 0 || node.behaviorCounts.cancelled > 0) && <span className="mt-1 block record-caption record-check-text" data-record-behavior-alert>{[node.behaviorCounts.failed ? `${node.behaviorCounts.failed} 条失败记录` : '', node.behaviorCounts.cancelled ? `${node.behaviorCounts.cancelled} 条取消或中断记录` : ''].filter(Boolean).join(' · ')}</span>}
        {(failed || !!node.counts?.failedRounds) && <span className="mt-1 block record-caption record-check-text">{node.counts?.failedRounds ? `${node.counts.failedRounds} 轮失败或取消` : statusLabels[node.status]}</span>}
      </button>
      </div>
      {(phase || node.kind === 'round') && <span title={node.recordedRange ? '已记录行为的时间范围' : '记录时间'} className="mt-1 shrink-0 whitespace-nowrap record-caption text-ds-muted">{recordDateLabel(node)}</span>}
      {!event && <button className="shrink-0 rounded p-1 text-ds-muted hover:bg-ds-hover" aria-label={`进入 ${node.title}`} onClick={() => onNavigate(node.id)}><ArrowUpRight size={13} /></button>}
      <button className="shrink-0 rounded p-1 text-ds-muted hover:bg-ds-hover" onClick={() => void onDiscuss(node.id)} aria-label={`讨论 ${node.title}`}><MessageSquare size={13} /></button>
    </div>{overview && (phase || node.kind === 'round') && <RecordUnderstanding node={node} onInspect={onInspect} />}</div>
    {open && <div className="my-2 space-y-2 border-l border-ds-border pl-3" data-record-preview={node.id}>
      <p className="record-caption text-ds-muted">范围 ID：{node.id} · 原始成员按层级保留，进入后查看；展开不会挂载后代。</p>
      {(phase || node.kind === 'round') && <RecordSynthesis node={node} presentation={presentation} onInspect={onInspect} />}
      {!event && <button className={button} onClick={() => onNavigate(node.id)}>进入此范围</button>}
      <button className={button} onClick={() => onInspect(node.id)}>查看详情与来源</button>
    </div>}
  </section>
}
