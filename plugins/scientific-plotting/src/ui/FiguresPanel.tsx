import { useEffect, useRef, useState } from 'react'
import type {
  FigureDocument, FigureMutation, FigureOperationResult
} from '../figure-store/index.js'
type VisualReviewImage = { src: string; width: number; height: number }
import { SCIENTIFIC_PLOTTING_TEMPLATES } from '../worker/types.js'
import { CodeRunsPanel, type CodeRunsTransport, type CodeRunSelection } from './CodeRunsPanel.js'
import type { PlotChatRequest } from '../sciforge/plot-request.js'
import './FiguresPanel.css'

export type FigureCandidateMutation = FigureMutation & { baselineRevisionId: string; baselineHash: string }
export type FigureRenderInput = FigureMutation & {
  request: Record<string, unknown>
  baselineRevisionId?: string
  baselineHash?: string
}

/** A host-owned, authorized client. The panel never supplies a workspace or confirmation token.
 * image returns a browser-safe URL and intrinsic dimensions; its lifetime belongs to the client.
 * acceptCandidate MUST invoke native DSH acceptance and await its decision in the backend.
 * A cancelled decision returns the store's cancelled operation receipt.
 */
export interface FiguresClient {
  list(): Promise<Array<{ documentId: string; path?: string }>>
  read(documentId: string): Promise<FigureDocument>
  image(documentId: string, revisionId: string): Promise<VisualReviewImage>
  importOriginal(path: string, input: FigureMutation): Promise<FigureOperationResult>
  addCandidate(path: string, input: FigureCandidateMutation): Promise<FigureOperationResult>
  acceptCandidate(input: FigureMutation & { revisionId: string }): Promise<FigureOperationResult>
  rejectCandidate(input: FigureMutation & { revisionId: string }): Promise<FigureOperationResult>
  render(input: FigureRenderInput): Promise<FigureOperationResult>
}

export interface FiguresPanelProps {
  client: FiguresClient
  initialDocumentId?: string
  initialRequest?: Record<string, unknown>
  className?: string
  codeRunsCall?: CodeRunsTransport
  onRequestAcceptance?: (input: FigureMutation & { revisionId: string }) => Promise<void>
  onSendRequest?: (input: PlotChatRequest) => Promise<void>
  onPickFile?: () => Promise<string | undefined>
}

const defaultRequest = { template: 'line', data: { series: [{ name: 'Series', x: [1, 2, 3], y: [1, 4, 9] }] } }
const mutation = (documentId: string, expectedDocumentRevision: number): FigureMutation => ({
  documentId, expectedDocumentRevision, operationId: crypto.randomUUID()
})
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Plugin-owned chat, immutable code, runs and figure preview. */
export function FiguresPanel({ client, initialDocumentId, initialRequest, className, codeRunsCall, onRequestAcceptance, onSendRequest, onPickFile }: FiguresPanelProps): React.JSX.Element {
  const [chatText, setChatText] = useState('')
  const [filePath, setFilePath] = useState('')
  const [startMode, setStartMode] = useState<'data' | 'code'>('data')
  const [codePath, setCodePath] = useState('')
  const [imagePath, setImagePath] = useState('')
  const [historyId, setHistoryId] = useState('')
  const [view, setView] = useState<'figures' | 'code' | 'new'>('figures')
  const [documents, setDocuments] = useState<Array<{ documentId: string; path?: string }>>([])
  const [selectedId, setSelectedId] = useState(initialDocumentId ?? '')
  const [document, setDocument] = useState<FigureDocument | null>(null)
  const [candidateId, setCandidateId] = useState('')
  const [images, setImages] = useState<Record<string, VisualReviewImage>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [originalPath, setOriginalPath] = useState('')
  const [candidatePath, setCandidatePath] = useState('')
  const [requestJson, setRequestJson] = useState(() => JSON.stringify(initialRequest ?? defaultRequest, null, 2))
  const [generateCandidate, setGenerateCandidate] = useState(false)
  const [runSelection, setRunSelection] = useState<CodeRunSelection>()
  const [queuedAcceptance, setQueuedAcceptance] = useState('')
  const selectedIdRef = useRef(selectedId)
  // Async publications consult the latest local selection/draft, not the render that started them.
  selectedIdRef.current = selectedId
  const requestEditor = useRef<HTMLTextAreaElement>(null)
  const inFlight = useRef(false)
  const loadSequence = useRef(0)
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadSequence.current++ } }, [])

  const load = async (id: string): Promise<void> => {
    const sequence = ++loadSequence.current
    setDocument(null)
    setImages({})
    if (!id) return
    const next = await client.read(id)
    const visible = next.revisions
    const loaded = await Promise.all(visible.map(async item => [item.metadata.revisionId, await client.image(id, item.metadata.revisionId)] as const))
    if (!mounted.current || sequence !== loadSequence.current) return
    setDocument(next)
    setImages(Object.fromEntries(loaded))
    setHistoryId('')
    setCandidateId(next.revisions.findLast(item => item.status === 'candidate')?.metadata.revisionId ?? '')
  }

  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    void client.list().then(async entries => {
      if (!active) return
      setDocuments(entries)
      const id = initialDocumentId ?? ''
      setSelectedId(id)
      await load(id)
    }).catch(reason => { if (active) setError(message(reason)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false; loadSequence.current++ }
  }, [client, initialDocumentId])

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (inFlight.current || busy) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() } catch (reason) { if (mounted.current) setError(message(reason)) }
    finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }

  const refresh = async (id: string): Promise<void> => {
    const entries = await client.list()
    if (!mounted.current) return
    setDocuments(entries)
    setSelectedId(id)
    await load(id)
  }

  const refreshPublished = async (result: FigureOperationResult): Promise<void> => {
    if (inFlight.current) return
    await refresh(result.documentId)
    setNotice('运行输出已发布。')
  }

  const historical = document?.revisions.find(item => item.metadata.revisionId === historyId)?.metadata
  const current = document?.revisions.find(item => item.metadata.revisionId === document.currentRevisionId)?.metadata
  const candidates = document?.revisions.filter(item => item.status === 'candidate') ?? []
  const candidate = candidates.find(item => item.metadata.revisionId === candidateId)?.metadata
  const baseline = () => {
    if (!current) throw new Error('请先选择当前文档。')
    return { baselineRevisionId: current.revisionId, baselineHash: current.image.sha256 }
  }
  const save = async (): Promise<number> => document?.documentRevision ?? 0
  const generate = async (): Promise<void> => {
    const request: unknown = JSON.parse(requestJson)
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('生成请求必须为 JSON 对象。')
    const value = request as Record<string, unknown>
    if (!SCIENTIFIC_PLOTTING_TEMPLATES.some(template => template === value.template)) throw new Error('请选择支持的绘图模板。')
    const asCandidate = generateCandidate && document !== null

    const expected = asCandidate ? await save() : 0
    const result = await client.render({ ...mutation(asCandidate ? document.documentId : crypto.randomUUID(), expected), request: value, ...(asCandidate ? baseline() : {}) })
    await refresh(result.documentId)
    setNotice('生成结果已保存。'); setView('figures')
  }
  const decide = async (accept: boolean): Promise<void> => {
    if (!document || !candidate) throw new Error('请选择候选版本。')
    const expected = await save()
    const input = { ...mutation(document.documentId, expected), revisionId: candidate.revisionId }
    if (accept && onRequestAcceptance) {
      const key = `${document.documentId}:${candidate.revisionId}:${expected}`
      if (queuedAcceptance === key) return
      await onRequestAcceptance(input)
      setQueuedAcceptance(key)
      setNotice('审批请求已发送，请在会话中确认。完成后点击刷新。')
      return
    }
    const result = await (accept ? client.acceptCandidate(input) : client.rejectCandidate(input))
    await refresh(result.documentId)
    setNotice(result.status === 'cancelled' ? '已取消接受，当前版本保持不变。' : accept ? '候选版本已接受。' : '候选版本已拒绝。')
  }

  return <section className={`figures-panel${className ? ` ${className}` : ''}`} aria-label="科研图件">
    <header className="figures-panel-heading"><h1>科研图件</h1><button type="button" disabled={busy} onClick={() => void run(async () => { await refresh(selectedId) })}>刷新</button></header>
    {error && <div className="figures-panel-error" role="alert">{error}</div>}
    {notice && <div role="status" className="figures-panel-notice">{notice}</div>}
    {busy && <div role="status">正在处理……</div>}
    <nav className="figures-panel-tabs" aria-label="图件功能">
      <button type="button" aria-pressed={view === 'figures'} onClick={() => setView('figures')}>图件</button>
      {codeRunsCall && <button type="button" aria-pressed={view === 'code'} onClick={() => setView('code')}>代码与运行</button>}
      <button type="button" aria-pressed={view === 'new'} onClick={() => { setView('new'); setFilePath(''); setCodePath(''); setImagePath(''); setChatText('') }}>新建</button>
    </nav>
    <div hidden={view !== 'new'}>
    {onSendRequest && <div className="figures-chat">
      <div role="group" aria-label="开始方式"><button type="button" aria-pressed={startMode === 'data'} onClick={() => setStartMode('data')}>从数据开始</button><button type="button" aria-pressed={startMode === 'code'} onClick={() => setStartMode('code')}>已有数据和代码</button></div>
      <label>数据文件<input aria-label="新建数据文件" value={filePath} onChange={event => setFilePath(event.target.value)} placeholder="data/experiment.csv" /></label>
      {onPickFile && <button type="button" onClick={() => void run(async () => { const path = await onPickFile(); if (path) setFilePath(path) })}>选择数据</button>}
      {startMode === 'code' && <><label>Python 代码<input aria-label="已有代码文件" value={codePath} onChange={event => setCodePath(event.target.value)} placeholder="scripts/plot.py" /></label><details><summary>已有图片（可选对照）</summary><input aria-label="已有图片文件" value={imagePath} onChange={event => setImagePath(event.target.value)} placeholder="figures/original.png" /></details></>}
      <textarea aria-label="新建绘图要求" value={chatText} onChange={event => setChatText(event.target.value)} placeholder="告诉 AI 数据含义、坐标轴和绘图要求。" />
      <button type="button" disabled={busy || !chatText.trim() || !filePath.trim() || (startMode === 'code' && !codePath.trim())} onClick={() => void run(async () => {
        await onSendRequest({ mode: startMode, text: chatText.trim(), filePath: filePath.trim(), ...(startMode === 'code' ? { codePath: codePath.trim(), ...(imagePath.trim() ? { imagePath: imagePath.trim() } : {}) } : {}) })
        setChatText(''); setNotice('已发送新建请求，数据与代码将保存为版本。')
      })}>开始绘图</button>
    </div>}
    <details><summary>其他导入与模板</summary>
    <fieldset disabled={busy} className="figures-panel-controls">
      <legend>生成 / 导入</legend>
      <label>原图路径<input value={originalPath} onChange={event => setOriginalPath(event.target.value)} placeholder="工作区中已授权的图片路径" /></label>
      <button type="button" disabled={!originalPath.trim()} onClick={() => void run(async () => {

         const result = await client.importOriginal(originalPath.trim(), mutation(crypto.randomUUID(), 0))
        await refresh(result.documentId)
        setOriginalPath('')
        setNotice('原图已导入。'); setView('figures')
      })}>导入为新文档</button>
      <details><summary>生成绘图</summary>
        <p>编辑绘图请求 JSON；Python 运行环境由后端配置。</p>
        <label>模板<select defaultValue="" onChange={event => {
          try {
            const parsed: unknown = JSON.parse(requestJson)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('生成请求必须为 JSON 对象。')
            setRequestJson(JSON.stringify({ ...parsed, template: event.target.value }, null, 2))
            setError('')
          } catch (reason) { setError(message(reason)) }
        }}><option value="" disabled>将模板写入请求</option>{SCIENTIFIC_PLOTTING_TEMPLATES.map(template => <option key={template}>{template}</option>)}</select></label>
        <label>生成请求 JSON<textarea ref={requestEditor} className="figures-panel-json" value={requestJson} onChange={event => setRequestJson(event.target.value)} spellCheck={false} /></label>
        <label><input type="checkbox" checked={generateCandidate} disabled={!document} onChange={event => setGenerateCandidate(event.target.checked)} />生成为当前文档的候选版本</label>
        <button type="button" onClick={() => void run(generate)}>生成并保存</button>
      </details>
    </fieldset>
    </details>
    </div>
    {codeRunsCall && <div hidden={view !== 'code'}><CodeRunsPanel call={codeRunsCall} client={client} onPublished={refreshPublished} selection={runSelection} /></div>}
    <div hidden={view !== 'figures'} className="figures-panel-main">
    <p className="figures-panel-hint">{onSendRequest ? '添加文件，告诉 AI 你想怎么画、怎么改。' : candidate ? '查看修改前后，满意后申请接受。' : '选择图片后继续。'}</p>
    <fieldset disabled={busy} className="figures-panel-controls">
      <legend>当前图件</legend>
      <label>图件<select aria-label="图件" value={selectedId} onChange={event => { const id = event.target.value; void run(async () => { await load(id); if (mounted.current) setSelectedId(id) }) }}><option value="">选择文档</option>{documents.map(item => <option key={item.documentId} value={item.documentId}>{item.documentId}</option>)}</select></label>
      {document && <>
        <span>文档修订 {document.documentRevision}</span>

        <label>候选<select aria-label="候选" value={candidateId} onChange={event => { setCandidateId(event.target.value) }}><option value="">无候选</option>{candidates.map(item => <option key={item.metadata.revisionId} value={item.metadata.revisionId}>{item.metadata.originalFilename} · {item.metadata.revisionId}</option>)}</select></label>
        <details><summary>导入候选图片</summary><label>候选图片路径<input value={candidatePath} onChange={event => setCandidatePath(event.target.value)} /></label>
        <button type="button" disabled={!candidatePath.trim()} onClick={() => void run(async () => {
          const expected = await save()
          const result = await client.addCandidate(candidatePath.trim(), { ...mutation(document.documentId, expected), ...baseline() })
          await refresh(result.documentId)
          setCandidatePath('')
          setNotice('候选图已导入。')
        })}>导入候选图</button></details>
        <label>历史版本<select aria-label="历史图件版本" value={historyId} onChange={event => setHistoryId(event.target.value)}><option value="">查看当前图</option>{document.revisions.map((item, index) => <option key={item.metadata.revisionId} value={item.metadata.revisionId}>{index + 1} · {item.status} · {item.metadata.revisionId}</option>)}</select></label>
        <details><summary>所有版本与来源</summary>
          <dl>{document.revisions.map(item => <div key={item.metadata.revisionId}>
            <dt>{item.metadata.revisionId === document.originalRevisionId ? '原图' : item.metadata.revisionId === document.currentRevisionId ? '当前图' : '候选图'} · {item.metadata.originalFilename}</dt>
            <dd>{item.metadata.revisionId} · {item.status}{item.metadata.execution ? ' · Python 运行输出' : item.metadata.generation ? ` · 生成来源 ${item.metadata.generation.generationId}` : ' · 导入图片'}</dd>
            {item.metadata.generation && <dd>Recipe: {item.metadata.generation.recipe.path}<br />Python: {item.metadata.generation.code.path}<br />Inputs: {item.metadata.generation.inputs.path}</dd>}
            {item.metadata.execution && <dd>代码版本：{item.metadata.execution.codeRevisionId}<br />运行：{item.metadata.execution.runId}<br />输出：{item.metadata.execution.output.path}<br />SHA-256: {item.metadata.execution.output.sha256}<br />运行记录：{item.metadata.execution.run.path}
              {codeRunsCall && <button type="button" onClick={() => {
                const execution = item.metadata.execution!
                setView('code')
                setRunSelection({ runId: execution.runId, codeRevisionId: execution.codeRevisionId, requestId: crypto.randomUUID() })
              }}>查看代码与运行详情</button>}
            </dd>}
          </div>)}</dl>
          {document.originalRevisionId !== document.currentRevisionId && images[document.originalRevisionId] && <img className="figures-panel-original" src={images[document.originalRevisionId].src} alt="不可变原图" />}
        </details>
      </>}
    </fieldset>
    {onSendRequest && <div className="figures-chat">
      <label>文件<input aria-label="输入文件" value={filePath} onChange={event => setFilePath(event.target.value)} placeholder="工作区中的数据、代码或图片路径" /></label>
      {onPickFile && <button type="button" disabled={busy} onClick={() => void run(async () => { const path = await onPickFile(); if (path) setFilePath(path) })}>选择文件</button>}
      <textarea aria-label="给 AI 的要求" placeholder="例如：用这个表格画折线图，把标题改成中文，颜色用蓝色。" value={chatText} onChange={event => setChatText(event.target.value)} />
      <button type="button" disabled={busy || !chatText.trim()} onClick={() => void run(async () => {
      await onSendRequest({ mode: document ? 'continue' : 'data', text: chatText.trim(), ...(filePath.trim() ? { filePath: filePath.trim() } : {}), ...(document ? { documentId: document.documentId } : {}) })
      setChatText(''); setNotice('已发送给 AI，请在左侧会话查看回复。')
    })}>发送给 AI</button>
    </div>}
    {historical && images[historical.revisionId] && <figure><figcaption>历史版本 · {historical.revisionId}</figcaption><img className="figures-panel-original" src={images[historical.revisionId].src} alt="历史图件" /></figure>}
    {onSendRequest && document && current && images[current.revisionId] && <div className="figures-chat-preview">
      <figure><figcaption>{candidate ? '当前图' : '图片预览'}</figcaption><img src={images[current.revisionId].src} alt="当前图件" /></figure>
      {candidate && images[candidate.revisionId] && <><figure><figcaption>修改后</figcaption><img src={images[candidate.revisionId].src} alt="候选图件" /></figure>
      <div><button type="button" disabled={busy || queuedAcceptance === `${document.documentId}:${candidate.revisionId}:${document.documentRevision}`} onClick={() => void run(() => decide(true))}>申请接受</button><button type="button" disabled={busy} onClick={() => void run(() => decide(false))}>保留当前图</button></div></>}
    </div>}

    </div>
  </section>
}
