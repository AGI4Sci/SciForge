import type {
  SciforgeCanvasDrawioSnapshot,
  SciforgeCanvasOpenResult,
  SciforgeCanvasReviewPacketModificationSuggestion,
  SciforgeCanvasReviewPacketResult
} from '@shared/sciforge-canvas'
import {
  Download,
  ExternalLink,
  FileInput,
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

const DEFAULT_CANVAS_ID = 'default'
const ONLINE_DRAWIO_EMBED_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=min&libraries=1&saveAndExit=0&noSaveBtn=1'

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

function buildReviewRequestText(input: {
  packetPath: string
  canvasId: string
  suggestions: SciforgeCanvasReviewPacketModificationSuggestion[]
}): string {
  const firstInstruction = input.suggestions
    .map((item) => item.instruction?.trim())
    .find(Boolean)
  return [
    firstInstruction || '请根据当前画布审改包生成修改版。',
    '',
    `Canvas: ${input.canvasId}`,
    `Review packet: ${input.packetPath}`,
    '请使用匹配 artifact 类型的 MCP 工具生成新版本并插入回当前画布；不要覆盖原始产物。'
  ].join('\n')
}

export function SciforgeCanvasPanel({
  workspaceRoot,
  canvasId = DEFAULT_CANVAS_ID,
  className = '',
  onCollapse,
  variant = 'standalone',
  onSendReviewRequest,
  refreshKey
}: Props): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingXmlRef = useRef<string | null>(null)
  const lastSavedXmlRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [packetPath, setPacketPath] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SciforgeCanvasReviewPacketModificationSuggestion[]>([])
  const [canvasSnapshot, setCanvasSnapshot] = useState<SciforgeCanvasDrawioSnapshot | null>(null)
  const [useOnlineDrawio, setUseOnlineDrawio] = useState(false)

  const embedded = variant === 'embedded'
  const configuredIframeSrc = useMemo(configuredDrawioUrl, [])
  const iframeSrc = configuredIframeSrc ?? (useOnlineDrawio ? ONLINE_DRAWIO_EMBED_URL : null)
  const iframeOrigin = useMemo(() => drawioTargetOrigin(iframeSrc), [iframeSrc])

  const postToDrawio = useCallback((payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), iframeOrigin)
  }, [iframeOrigin])

  const saveXml = useCallback(async (xml: string): Promise<boolean> => {
    if (!workspaceRoot.trim()) return false
    if (xml === lastSavedXmlRef.current) return true
    setSaving(true)
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
      setMessage('画布已保存。')
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }, [canvasId, workspaceRoot])

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
        postToDrawio({
          action: 'load',
          autosave: 1,
          xml: result.snapshot.diagramXml,
          title: canvasId
        })
      }
    } catch (error) {
      setCanvasSnapshot(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [canvasId, iframeSrc, postToDrawio, ready, workspaceRoot])

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
          postToDrawio({
            action: 'load',
            autosave: 1,
            xml,
            title: canvasId
          })
        }
        return
      }

      if (payload.event === 'autosave' || payload.event === 'save') {
        const xml = payload.xml ?? payload.data
        if (typeof xml === 'string' && xml.trim()) void saveXml(xml)
        return
      }

      if (payload.event === 'load') setReady(true)
      if (payload.event === 'error') setMessage(payload.message || 'draw.io 画布加载失败。')
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [canvasId, canvasSnapshot?.diagramXml, iframeSrc, postToDrawio, saveXml])

  const requestDrawioSave = useCallback(() => {
    postToDrawio({ action: 'save' })
  }, [postToDrawio])

  const importRecentArtifacts = useCallback(async () => {
    if (!workspaceRoot.trim()) return
    setImporting(true)
    setMessage(null)
    try {
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
  }, [canvasId, loadCanvas, workspaceRoot])

  const exportReviewPacket = useCallback(async (): Promise<Extract<SciforgeCanvasReviewPacketResult, { ok: true }> | null> => {
    if (!workspaceRoot.trim()) return null
    setExporting(true)
    setMessage(null)
    try {
      if (iframeSrc) requestDrawioSave()
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
      setMessage(`审改包已导出：${shortPath(result.packetPath)}`)
      return result
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setExporting(false)
    }
  }, [canvasId, iframeSrc, requestDrawioSave, workspaceRoot])

  const sendReviewRequest = useCallback(async () => {
    if (!onSendReviewRequest) return
    setSending(true)
    try {
      const result = packetPath
        ? null
        : await exportReviewPacket()
      const nextPacketPath = packetPath ?? result?.packetPath
      const nextSuggestions = packetPath ? suggestions : result?.packet.modificationSuggestions ?? []
      if (!nextPacketPath) return
      onSendReviewRequest(buildReviewRequestText({
        packetPath: nextPacketPath,
        canvasId,
        suggestions: nextSuggestions
      }))
      setMessage('已把简洁审改请求写入对话框。')
    } finally {
      setSending(false)
    }
  }, [canvasId, exportReviewPacket, onSendReviewRequest, packetPath, suggestions])

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
        <button type="button" onClick={requestDrawioSave} disabled={!iframeSrc || !ready || saving} title="保存 draw.io 画布">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>{saving ? '保存中' : '保存'}</span>
        </button>
        <button type="button" onClick={() => void loadCanvas()} disabled={loading} title="重新读取画布">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
        <button type="button" onClick={() => void importRecentArtifacts()} disabled={importing} title="导入当前对话生成的图片、SVG 或 PPTX">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileInput className="h-4 w-4" />}
          <span>{importing ? '导入中' : '导入产物'}</span>
        </button>
        <button type="button" onClick={() => void exportReviewPacket()} disabled={exporting} title="导出当前 draw.io 标注为审改包">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
          <span>审改包</span>
        </button>
        {onSendReviewRequest ? (
          <button type="button" onClick={() => void sendReviewRequest()} disabled={sending || !workspaceRoot.trim()} title="把审改请求写入对话框">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>{sending ? '发送中' : '发送修改'}</span>
          </button>
        ) : null}
      </div>

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
            <h3>需要配置本地 draw.io</h3>
            <p>为避免外发 workspace 数据，SciForge 不默认连接在线 diagrams.net。请设置本地或 self-host 地址：</p>
            <code>VITE_SCIFORGE_DRAWIO_EMBED_URL=http://localhost:PORT/?embed=1&amp;proto=json</code>
            <p>当前 Canvas worker 已使用 draw.io XML 存储，artifact 和审改包仍可导出。</p>
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
