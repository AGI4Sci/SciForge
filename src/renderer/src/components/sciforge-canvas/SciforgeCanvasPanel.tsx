import type {
  SciforgeCanvasDrawioSnapshot,
  SciforgeCanvasOpenResult,
  SciforgeCanvasReviewPacketModificationSuggestion,
  SciforgeCanvasReviewPacketResult
} from '@shared/sciforge-canvas'
import {
  ExternalLink,
  FileInput,
  Layers,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldAlert,
  X
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import './SciforgeCanvasPanel.css'

type Props = {
  workspaceRoot: string
  canvasId?: string
  className?: string
  onCollapse?: () => void
  variant?: 'standalone' | 'embedded'
  onSendReviewRequest?: (text: string) => void
  refreshKey?: number
  focusShapeId?: string
}

type DrawioMessage = {
  event?: string
  action?: string
  xml?: string
  data?: string
  message?: string
}

type PendingDrawioSave = {
  resolvers: Array<(ok: boolean) => void>
  timeoutId: number
}

const DEFAULT_CANVAS_ID = 'default'
const ONLINE_DRAWIO_EMBED_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=min&libraries=1&saveAndExit=0&noSaveBtn=1'
const DRAWIO_SAVE_TIMEOUT_MS = 4000
const DRAWIO_FOCUS_PADDING = 96

function isDrawioSnapshot(value: unknown): value is SciforgeCanvasDrawioSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SciforgeCanvasDrawioSnapshot>
  return record.engine === 'drawio' && typeof record.diagramXml === 'string'
}

function configuredDrawioUrl(): string | null {
  const raw = import.meta.env.VITE_SCIFORGE_DRAWIO_EMBED_URL
  if (typeof raw !== 'string' || !raw.trim()) return null
  const url = raw.trim()
  if (
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://localhost') ||
    url.startsWith('https://127.0.0.1') ||
    url.startsWith('https://localhost') ||
    url.startsWith('file://') ||
    url.startsWith('app://')
  ) {
    return url
  }
  if (
    import.meta.env.VITE_SCIFORGE_ALLOW_REMOTE_DRAWIO === 'true' &&
    url.startsWith('https://embed.diagrams.net/')
  ) {
    return url
  }
  return null
}

function drawioTargetOrigin(url: string | null): string {
  if (!url || url.startsWith('file://') || url.startsWith('app://')) return '*'
  try {
    return new URL(url).origin
  } catch {
    return '*'
  }
}

function parseDrawioMessage(data: unknown): DrawioMessage | null {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as DrawioMessage
    } catch {
      return null
    }
  }
  if (data && typeof data === 'object') return data as DrawioMessage
  return null
}

function shortPath(path: string | null): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.slice(-4).join('/')
}

function xmlAttribute(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)
  return match?.[1]
    ?.replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') ?? null
}

function finiteXmlNumber(attrs: string, name: string): number | null {
  const raw = xmlAttribute(attrs, name)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function focusRectForDrawioCell(xml: string, cellId: string | undefined): Record<string, number> | null {
  const id = cellId?.trim()
  if (!id) return null
  const cellPattern = new RegExp(`<mxCell\\b(?=[^>]*\\bid="${escapeRegExp(id)}")[\\s\\S]*?<mxGeometry\\b([^>]*)`, 'm')
  const match = cellPattern.exec(xml)
  if (!match) return null
  const attrs = match[1] ?? ''
  const x = finiteXmlNumber(attrs, 'x')
  const y = finiteXmlNumber(attrs, 'y')
  const width = finiteXmlNumber(attrs, 'width')
  const height = finiteXmlNumber(attrs, 'height')
  if (x === null || y === null || width === null || height === null) return null
  return {
    x: Math.max(0, x - DRAWIO_FOCUS_PADDING),
    y: Math.max(0, y - DRAWIO_FOCUS_PADDING),
    width: Math.max(160, width + DRAWIO_FOCUS_PADDING * 2),
    height: Math.max(120, height + DRAWIO_FOCUS_PADDING * 2)
  }
}

function drawioLoadPayload(input: {
  xml: string
  canvasId: string
  focusShapeId?: string
}): Record<string, unknown> {
  const rect = focusRectForDrawioCell(input.xml, input.focusShapeId)
  return {
    action: 'load',
    autosave: 1,
    xml: input.xml,
    title: input.canvasId,
    ...(rect ? { rect } : {})
  }
}

function buildReviewRequestText(input: {
  packetPath: string
  canvasId: string
  workspaceRoot: string
  suggestions: SciforgeCanvasReviewPacketModificationSuggestion[]
  userInstruction?: string
}): string {
  const typedInstruction = input.userInstruction?.trim()
  const firstInstruction = input.suggestions
    .map((item) => item.instruction?.trim())
    .find(Boolean)
  const annotationText = typedInstruction || firstInstruction || '请根据我在画布上的标注生成修改版。'
  return [
    '请根据当前画布审改包修改生成结果。',
    `用户批注：${annotationText}`,
    `工作区：${input.workspaceRoot}`,
    `画布 ID：${input.canvasId}`,
    `审改包：${input.packetPath}`,
    '请优先调用 image_generation_edit_from_canvas_packet，使用上述 workspaceRoot、canvasId 和 reviewPacketPath。',
    '不要用 bash/read 手动读取审改包；不要凭空重画不相关图片。',
    '若审改包包含 selectedComponents，请只做局部重绘；否则基于标注做非破坏式 delta 修改，并把新版本插入回当前画布。'
  ].join('\n')
}

export function SciforgeCanvasPanel({
  workspaceRoot,
  canvasId = DEFAULT_CANVAS_ID,
  className = '',
  onCollapse,
  variant = 'standalone',
  onSendReviewRequest,
  refreshKey,
  focusShapeId
}: Props): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingXmlRef = useRef<string | null>(null)
  const lastSavedXmlRef = useRef<string | null>(null)
  const pendingSaveRef = useRef<PendingDrawioSave | null>(null)
  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [importing, setImporting] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [annotationEditorOpen, setAnnotationEditorOpen] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [packetPath, setPacketPath] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SciforgeCanvasReviewPacketModificationSuggestion[]>([])
  const [canvasSnapshot, setCanvasSnapshot] = useState<SciforgeCanvasDrawioSnapshot | null>(null)
  const [useOnlineDrawio, setUseOnlineDrawio] = useState(false)
  const [localDrawioUrl, setLocalDrawioUrl] = useState<string | null>(null)
  const [localDrawioMessage, setLocalDrawioMessage] = useState<string | null>(null)

  const embedded = variant === 'embedded'
  const configuredIframeSrc = useMemo(configuredDrawioUrl, [])
  const iframeSrc = configuredIframeSrc ?? localDrawioUrl ?? (useOnlineDrawio ? ONLINE_DRAWIO_EMBED_URL : null)
  const iframeOrigin = useMemo(() => drawioTargetOrigin(iframeSrc), [iframeSrc])

  const postToDrawio = useCallback((payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), iframeOrigin)
  }, [iframeOrigin])

  const completePendingDrawioSave = useCallback((ok: boolean) => {
    const pending = pendingSaveRef.current
    if (!pending) return
    window.clearTimeout(pending.timeoutId)
    pendingSaveRef.current = null
    for (const resolve of pending.resolvers) resolve(ok)
  }, [])

  useEffect(() => {
    if (configuredIframeSrc) return
    let cancelled = false
    async function loadLocalDrawioUrl() {
      try {
        const result = await window.sciforge.getLocalDrawioUrl()
        if (cancelled) return
        if (result.ok) {
          setLocalDrawioUrl(result.url)
          setLocalDrawioMessage(null)
        } else {
          setLocalDrawioUrl(null)
          setLocalDrawioMessage(result.checkedPaths.length > 0
            ? `${result.message} Checked: ${result.checkedPaths.map(shortPath).join(', ')}`
            : result.message)
        }
      } catch (error) {
        if (cancelled) return
        setLocalDrawioUrl(null)
        setLocalDrawioMessage(error instanceof Error ? error.message : String(error))
      }
    }
    void loadLocalDrawioUrl()
    return () => {
      cancelled = true
    }
  }, [configuredIframeSrc])

  const markPacketStale = useCallback(() => {
    setPacketPath(null)
    setSuggestions([])
  }, [])

  const saveXmlNow = useCallback(async (xml: string): Promise<boolean> => {
    if (!workspaceRoot.trim()) return false
    if (xml === lastSavedXmlRef.current) return true
    try {
      const result = await window.sciforge.saveSciforgeCanvas({
        workspaceRoot,
        canvasId,
        snapshot: {
          engine: 'drawio',
          diagramXml: xml
        }
      })
      if (!result.ok) {
        setMessage(result.message)
        return false
      }
      lastSavedXmlRef.current = xml
      pendingXmlRef.current = xml
      setCanvasSnapshot((current) => current
        ? {
            ...current,
            diagramXml: xml,
            updatedAt: result.updatedAt
          }
        : current)
      markPacketStale()
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return false
    }
  }, [canvasId, markPacketStale, workspaceRoot])

  const saveXml = useCallback((xml: string): Promise<boolean> => {
    const queued = saveChainRef.current.then(() => saveXmlNow(xml))
    saveChainRef.current = queued.catch(() => false)
    return queued
  }, [saveXmlNow])

  const loadCanvas = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    setPacketPath(null)
    setSuggestions([])
    if (!workspaceRoot.trim()) {
      setCanvasSnapshot(null)
      setMessage('请先打开一个工作区，然后再使用画布审改。')
      setLoading(false)
      return
    }
    try {
      const result: SciforgeCanvasOpenResult = await window.sciforge.openSciforgeCanvas({ workspaceRoot, canvasId })
      if (!result.ok) {
        setCanvasSnapshot(null)
        setMessage(result.message)
        return
      }
      if (!isDrawioSnapshot(result.snapshot)) {
        setCanvasSnapshot(null)
        setMessage('当前画布仍是旧 tldraw snapshot；请重新导入产物以创建 draw.io 画布。')
        return
      }
      setCanvasSnapshot(result.snapshot)
      lastSavedXmlRef.current = result.snapshot.diagramXml
      pendingXmlRef.current = result.snapshot.diagramXml
      if (ready && iframeSrc) {
        postToDrawio(drawioLoadPayload({
          xml: result.snapshot.diagramXml,
          canvasId,
          focusShapeId
        }))
      }
    } catch (error) {
      setCanvasSnapshot(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [canvasId, focusShapeId, iframeSrc, postToDrawio, ready, workspaceRoot])

  useEffect(() => {
    void loadCanvas()
  }, [loadCanvas])

  useEffect(() => {
    if (refreshKey === undefined) return
    void loadCanvas()
  }, [loadCanvas, refreshKey])

  useEffect(() => {
    if (!iframeSrc) return undefined
    const handleMessage = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) return
      const payload = parseDrawioMessage(event.data)
      if (!payload) return

      if (payload.event === 'init') {
        setReady(true)
        const xml = pendingXmlRef.current ?? canvasSnapshot?.diagramXml
        if (xml) {
          postToDrawio(drawioLoadPayload({
            xml,
            canvasId,
            focusShapeId
          }))
        }
        return
      }

      if (payload.event === 'autosave' || payload.event === 'save') {
        const xml = payload.xml ?? payload.data
        if (typeof xml === 'string' && xml.trim()) {
          void saveXml(xml).then(completePendingDrawioSave)
        } else if (payload.event === 'save') {
          completePendingDrawioSave(false)
        }
        return
      }

      if (payload.event === 'load') setReady(true)
      if (payload.event === 'error') setMessage(payload.message || 'draw.io 画布加载失败。')
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [canvasId, canvasSnapshot?.diagramXml, completePendingDrawioSave, focusShapeId, iframeSrc, postToDrawio, saveXml])

  const requestDrawioSave = useCallback(async (): Promise<boolean> => {
    if (!iframeSrc || !ready) return true
    return new Promise((resolve) => {
      const pending = pendingSaveRef.current
      if (pending) {
        pending.resolvers.push(resolve)
        postToDrawio({ action: 'save' })
        return
      }
      const timeoutId = window.setTimeout(() => {
        pendingSaveRef.current = null
        setMessage('draw.io 保存超时，请稍后重试。')
        resolve(false)
      }, DRAWIO_SAVE_TIMEOUT_MS)
      pendingSaveRef.current = {
        resolvers: [resolve],
        timeoutId
      }
      postToDrawio({ action: 'save' })
    })
  }, [iframeSrc, postToDrawio, ready])

  useEffect(() => {
    return () => {
      completePendingDrawioSave(false)
    }
  }, [completePendingDrawioSave])

  const importRecentArtifacts = useCallback(async () => {
    if (!workspaceRoot.trim()) return
    setImporting(true)
    setMessage(null)
    try {
      if (iframeSrc && !(await requestDrawioSave())) return
      const result = await window.sciforge.importRecentSciforgeCanvasArtifacts({
        workspaceRoot,
        canvasId,
        scope: 'current_canvas',
        includeExisting: false,
        limit: 12
      })
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setMessage(result.imported > 0
        ? `已导入 ${result.imported} 个当前对话产物。`
        : '没有找到可导入的当前对话图片、SVG 或 PPTX 产物。')
      await loadCanvas()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setImporting(false)
    }
  }, [canvasId, iframeSrc, loadCanvas, requestDrawioSave, workspaceRoot])

  const exportReviewPacket = useCallback(async (): Promise<Extract<SciforgeCanvasReviewPacketResult, { ok: true }> | null> => {
    if (!workspaceRoot.trim()) return null
    setMessage(null)
    try {
      if (iframeSrc && !(await requestDrawioSave())) return null
      const result = await window.sciforge.exportSciforgeCanvasReviewPacket({
        workspaceRoot,
        canvasId,
        title: `SciForge Canvas Review ${canvasId}`
      })
      if (!result.ok) {
        setMessage(result.message)
        return null
      }
      setPacketPath(result.packetPath)
      setSuggestions(result.packet.modificationSuggestions ?? [])
      return result
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [canvasId, iframeSrc, requestDrawioSave, workspaceRoot])

  const splitArtifactComponents = useCallback(async () => {
    if (!workspaceRoot.trim()) return
    setSplitting(true)
    setMessage(null)
    try {
      if (iframeSrc && !(await requestDrawioSave())) return
      const result = await window.sciforge.splitSciforgeCanvasArtifactComponents({
        workspaceRoot,
        canvasId,
        margin: 56
      })
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      await loadCanvas()
      const usedFallback = result.warnings.some((warning) => /segmentation runner|coarse local|local fallback|local segmentation/i.test(warning))
      setMessage(`已展开 ${result.componentCount} 个可选区域。画面不会重复显示切片；选中区域并添加批注后，可发送修改进行局部重绘。${usedFallback ? ' 当前未配置组件切分 runner/model（SCIFORGE_COMPONENT_SEGMENTATION_RUNNER / SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH），已使用本地粗粒度区域 fallback。' : ''}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSplitting(false)
    }
  }, [canvasId, iframeSrc, loadCanvas, requestDrawioSave, workspaceRoot])

  const showAnnotationHelp = useCallback(() => {
    setAnnotationEditorOpen((open) => !open)
    setMessage(null)
    iframeRef.current?.focus()
  }, [])

  const sendReviewRequest = useCallback(async (instructionOverride?: string) => {
    if (!onSendReviewRequest) return
    const typedInstruction = instructionOverride?.trim() || annotationDraft.trim()
    if (!typedInstruction && suggestions.length === 0 && !packetPath) {
      setAnnotationEditorOpen(true)
      setMessage('请先输入批注内容，或在画布中添加标注后再发送修改。')
      return
    }
    setSending(true)
    try {
      const result = await exportReviewPacket()
      const nextPacketPath = result?.packetPath
      const nextSuggestions = result?.packet.modificationSuggestions ?? []
      if (!nextPacketPath) return
      onSendReviewRequest(buildReviewRequestText({
        packetPath: nextPacketPath,
        canvasId,
        workspaceRoot,
        suggestions: nextSuggestions,
        userInstruction: typedInstruction
      }))
      setAnnotationDraft('')
      setAnnotationEditorOpen(false)
      setMessage('已发送画布批注修改请求。')
    } finally {
      setSending(false)
    }
  }, [annotationDraft, canvasId, exportReviewPacket, onSendReviewRequest, packetPath, suggestions.length, workspaceRoot])

  return (
    <aside className={`sciforge-canvas-panel ${embedded ? 'embedded' : 'standalone'} ${className}`}>
      {!embedded && (
        <div className="sciforge-canvas-header">
          <div>
            <h2>SciForge Canvas</h2>
            <p>draw.io 画布审改</p>
          </div>
          {onCollapse ? (
            <button type="button" className="sciforge-canvas-icon-button" onClick={onCollapse} title="关闭画布">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}

      <div className="sciforge-canvas-toolbar">
        <button type="button" onClick={showAnnotationHelp} disabled={!iframeSrc || !ready} title="打开批注输入栏">
          <MessageSquarePlus className="h-4 w-4" />
          <span>批注</span>
        </button>
        <button type="button" onClick={() => void loadCanvas()} disabled={loading} title="重新读取画布">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
        <button type="button" onClick={() => void importRecentArtifacts()} disabled={importing} title="导入当前对话生成的图片、SVG 或 PPTX">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileInput className="h-4 w-4" />}
          <span>{importing ? '导入中' : '导入产物'}</span>
        </button>
        <button
          type="button"
          className={`sciforge-canvas-split-button ${splitting ? 'is-splitting' : ''}`}
          onClick={() => void splitArtifactComponents()}
          disabled={splitting || !workspaceRoot.trim()}
          title="把带组件 manifest 的 framework 图片展开成可单独选择、删除、移动和局部重绘的 draw.io 对象"
        >
          {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
          <span>{splitting ? '展开中' : '展开组件'}</span>
        </button>
        {onSendReviewRequest ? (
          <button type="button" onClick={() => void sendReviewRequest()} disabled={sending || !workspaceRoot.trim()} title="发送画布审改请求">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>{sending ? '发送中' : '发送修改'}</span>
          </button>
        ) : null}
      </div>

      {annotationEditorOpen ? (
        <form
          className="sciforge-canvas-annotation-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void sendReviewRequest(annotationDraft)
          }}
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          <input
            value={annotationDraft}
            onChange={(event) => setAnnotationDraft(event.target.value)}
            placeholder="输入批注内容，例如：把这里换成绿色、放大这个模块、重画这个区域"
            aria-label="批注内容"
          />
          <button type="submit" disabled={sending || !annotationDraft.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>{sending ? '发送中' : '发送修改'}</span>
          </button>
        </form>
      ) : null}

      {message ? <div className="sciforge-canvas-message">{message}</div> : null}

      <div className="sciforge-canvas-drawio-shell">
        {loading ? (
          <div className="sciforge-canvas-loading">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>正在打开 draw.io 画布…</span>
          </div>
        ) : null}
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            title="SciForge draw.io canvas"
            className="sciforge-canvas-drawio-frame"
            src={iframeSrc}
            sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms"
          />
        ) : (
          <div className="sciforge-canvas-drawio-placeholder">
            <h3>本地 draw.io 还没有就绪</h3>
            <p>请先安装 SciForge 内置 draw.io webapp，或设置本地/self-host 地址：</p>
            <code>VITE_SCIFORGE_DRAWIO_EMBED_URL=http://localhost:PORT/?embed=1&amp;proto=json</code>
            {localDrawioMessage ? <p>{localDrawioMessage}</p> : null}
            <p>Canvas worker 已使用 draw.io XML 存储，artifact 仍可导出。</p>
            <div className="sciforge-canvas-drawio-remote">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <span>本地测试时可临时使用在线 draw.io；画布 XML 会加载到 diagrams.net iframe 中。</span>
            </div>
            <button
              type="button"
              className="sciforge-canvas-drawio-online-button"
              onClick={() => {
                setUseOnlineDrawio(true)
                setMessage('已临时启用在线 draw.io。建议正式使用时配置本地/self-host draw.io。')
              }}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span>本次使用在线 draw.io</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
