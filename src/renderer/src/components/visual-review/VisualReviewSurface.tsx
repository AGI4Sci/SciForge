import {
  ArrowUpRight,
  Check,
  Crop,
  Eraser,
  Hand,
  MapPin,
  MessageSquareText,
  MousePointer2,
  Pencil,
  RotateCcw,
  Send,
  SplitSquareHorizontal,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import './VisualReviewSurface.css'

export type VisualReviewTool = 'select' | 'pan' | 'box' | 'arrow' | 'freehand' | 'pin'
export type VisualComparisonMode = 'before' | 'after' | 'split' | 'overlay'
export type VisualReviewMode = 'annotate' | 'compare'
export type VisualReviewAnnotationStatus = 'open' | 'resolved'

export interface NormalizedPoint {
  x: number
  y: number
}

export interface NormalizedBox extends NormalizedPoint {
  width: number
  height: number
}

interface VisualReviewAnnotationBase {
  id: string
  comment: string
  status: VisualReviewAnnotationStatus
}

export interface VisualReviewBoxAnnotation extends VisualReviewAnnotationBase {
  kind: 'box'
  geometry: NormalizedBox
}

export interface VisualReviewArrowAnnotation extends VisualReviewAnnotationBase {
  kind: 'arrow'
  geometry: { start: NormalizedPoint; end: NormalizedPoint }
}

export interface VisualReviewFreehandAnnotation extends VisualReviewAnnotationBase {
  kind: 'freehand'
  geometry: { points: NormalizedPoint[] }
}

export interface VisualReviewPinAnnotation extends VisualReviewAnnotationBase {
  kind: 'pin'
  geometry: NormalizedPoint
}

export type VisualReviewAnnotation =
  | VisualReviewBoxAnnotation
  | VisualReviewArrowAnnotation
  | VisualReviewFreehandAnnotation
  | VisualReviewPinAnnotation

export interface VisualReviewImage {
  id?: string
  src: string
  alt?: string
  width: number
  height: number
}

export interface VisualReviewSurfaceProps {
  source: VisualReviewImage
  candidate?: VisualReviewImage
  annotations: VisualReviewAnnotation[]
  mode?: VisualReviewMode
  comparisonMode?: VisualComparisonMode
  activeTool?: VisualReviewTool
  readOnly?: boolean
  busy?: boolean
  acceptDisabled?: boolean
  className?: string
  onAnnotationsChange?: (annotations: VisualReviewAnnotation[]) => void
  onActiveToolChange?: (tool: VisualReviewTool) => void
  onComparisonModeChange?: (mode: VisualComparisonMode) => void
  onRequestRevision?: (annotations: VisualReviewAnnotation[]) => void
  onAccept?: () => void
  onReject?: () => void
  onContinueAnnotating?: () => void
}

interface ActiveGesture {
  pointerId: number
  tool: VisualReviewTool
  start: NormalizedPoint
  current: NormalizedPoint
  points: NormalizedPoint[]
  clientStart: { x: number; y: number }
  panStart: { x: number; y: number }
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 6
const ANNOTATION_COLOR = '#ef4444'

export function clampNormalizedPoint(point: NormalizedPoint): NormalizedPoint {
  return {
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y))
  }
}

export function normalizedPointFromRect(
  client: { x: number; y: number },
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
): NormalizedPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return clampNormalizedPoint({
    x: (client.x - rect.left) / rect.width,
    y: (client.y - rect.top) / rect.height
  })
}

export function normalizedBoxFromPoints(
  start: NormalizedPoint,
  end: NormalizedPoint
): NormalizedBox {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  return {
    x: left,
    y: top,
    width: Math.max(start.x, end.x) - left,
    height: Math.max(start.y, end.y) - top
  }
}

function createAnnotationId(): string {
  return `visual-annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function annotationLabel(annotation: VisualReviewAnnotation, index: number): string {
  const kind = annotation.kind === 'box'
    ? '区域'
    : annotation.kind === 'arrow'
      ? '箭头'
      : annotation.kind === 'freehand'
        ? '画笔'
        : '图钉'
  return `${index + 1}. ${kind}`
}

function pointsToSvgPath(points: NormalizedPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function annotationAnchor(annotation: VisualReviewAnnotation): NormalizedPoint {
  if (annotation.kind === 'box') {
    return { x: annotation.geometry.x, y: annotation.geometry.y }
  }
  if (annotation.kind === 'arrow') return annotation.geometry.end
  if (annotation.kind === 'freehand') return annotation.geometry.points[0] ?? { x: 0, y: 0 }
  return annotation.geometry
}

function toolLabel(tool: VisualReviewTool): string {
  const labels: Record<VisualReviewTool, string> = {
    select: '选择',
    pan: '平移',
    box: '框选',
    arrow: '箭头',
    freehand: '画笔',
    pin: '图钉'
  }
  return labels[tool]
}

const TOOL_ICONS = {
  select: MousePointer2,
  pan: Hand,
  box: Crop,
  arrow: ArrowUpRight,
  freehand: Pencil,
  pin: MapPin
} satisfies Record<VisualReviewTool, typeof MousePointer2>

export function VisualReviewSurface({
  source,
  candidate,
  annotations,
  mode = 'annotate',
  comparisonMode: controlledComparisonMode,
  activeTool: controlledActiveTool,
  readOnly = false,
  busy = false,
  acceptDisabled = false,
  className,
  onAnnotationsChange,
  onActiveToolChange,
  onComparisonModeChange,
  onRequestRevision,
  onAccept,
  onReject,
  onContinueAnnotating
}: VisualReviewSurfaceProps): React.JSX.Element {
  const [internalTool, setInternalTool] = useState<VisualReviewTool>('box')
  const [internalComparisonMode, setInternalComparisonMode] = useState<VisualComparisonMode>('split')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [gesture, setGesture] = useState<ActiveGesture | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [splitPosition, setSplitPosition] = useState(50)
  const [overlayOpacity, setOverlayOpacity] = useState(55)
  const activeTool = controlledActiveTool ?? internalTool
  const comparisonMode = controlledComparisonMode ?? internalComparisonMode
  const stageRef = useRef<HTMLDivElement>(null)

  const openAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.status === 'open'),
    [annotations]
  )

  const selectTool = (tool: VisualReviewTool): void => {
    if (readOnly) return
    setInternalTool(tool)
    onActiveToolChange?.(tool)
  }

  const selectComparisonMode = (nextMode: VisualComparisonMode): void => {
    setInternalComparisonMode(nextMode)
    onComparisonModeChange?.(nextMode)
  }

  const updateAnnotation = (id: string, patch: Partial<Pick<VisualReviewAnnotation, 'comment' | 'status'>>): void => {
    onAnnotationsChange?.(annotations.map((annotation) => annotation.id === id
      ? { ...annotation, ...patch } as VisualReviewAnnotation
      : annotation))
  }

  const removeAnnotation = (id: string): void => {
    onAnnotationsChange?.(annotations.filter((annotation) => annotation.id !== id))
    if (selectedAnnotationId === id) setSelectedAnnotationId(null)
  }

  const pointForPointer = (event: ReactPointerEvent<SVGSVGElement>): NormalizedPoint =>
    normalizedPointFromRect({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect())

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (readOnly || event.button !== 0) return
    const point = pointForPointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    setGesture({
      pointerId: event.pointerId,
      tool: activeTool,
      start: point,
      current: point,
      points: [point],
      clientStart: { x: event.clientX, y: event.clientY },
      panStart: pan
    })
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.tool === 'pan' || gesture.tool === 'select') {
      setPan({
        x: gesture.panStart.x + event.clientX - gesture.clientStart.x,
        y: gesture.panStart.y + event.clientY - gesture.clientStart.y
      })
      return
    }
    const point = pointForPointer(event)
    setGesture((current) => current && current.pointerId === event.pointerId
      ? {
          ...current,
          current: point,
          points: current.tool === 'freehand' ? [...current.points, point] : current.points
        }
      : current)
  }

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const completed = gesture
    setGesture(null)
    if (completed.tool === 'pan' || completed.tool === 'select') return

    let annotation: VisualReviewAnnotation | null = null
    const base = { id: createAnnotationId(), comment: '', status: 'open' as const }
    if (completed.tool === 'box') {
      const geometry = normalizedBoxFromPoints(completed.start, completed.current)
      if (geometry.width > 0.003 && geometry.height > 0.003) {
        annotation = { ...base, kind: 'box', geometry }
      }
    } else if (completed.tool === 'arrow') {
      annotation = {
        ...base,
        kind: 'arrow',
        geometry: { start: completed.start, end: completed.current }
      }
    } else if (completed.tool === 'freehand' && completed.points.length > 1) {
      annotation = { ...base, kind: 'freehand', geometry: { points: completed.points } }
    } else if (completed.tool === 'pin') {
      annotation = { ...base, kind: 'pin', geometry: completed.start }
    }
    if (annotation) {
      onAnnotationsChange?.([...annotations, annotation])
      setSelectedAnnotationId(annotation.id)
    }
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * (event.deltaY > 0 ? 0.9 : 1.1))))
  }

  const resetViewport = (): void => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const candidateVisible = Boolean(candidate && comparisonMode !== 'before')
  const canvasStyle = {
    '--visual-review-aspect': `${source.width} / ${source.height}`,
    '--visual-review-zoom': zoom,
    '--visual-review-pan-x': `${pan.x}px`,
    '--visual-review-pan-y': `${pan.y}px`,
    '--visual-review-split': `${splitPosition}%`,
    '--visual-review-overlay': overlayOpacity / 100
  } as CSSProperties

  return (
    <section className={`visual-review-surface${className ? ` ${className}` : ''}`} aria-label="图像审改">
      <header className="visual-review-header">
        <div>
          <h2>图像审改</h2>
          <p>{candidate ? '检查候选版本并决定是否替换原图' : '在图中标注区域并描述修改建议'}</p>
        </div>
        <div className="visual-review-zoom-controls" aria-label="视图缩放">
          <button type="button" aria-label="缩小" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value / 1.2))}><ZoomOut size={15} /></button>
          <output aria-label="当前缩放比例">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="放大" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value * 1.2))}><ZoomIn size={15} /></button>
          <button type="button" aria-label="重置视图" onClick={resetViewport}><RotateCcw size={15} /></button>
        </div>
      </header>

      <div className="visual-review-toolbar">
        {mode === 'annotate' && (
          <div className="visual-review-tool-group" role="toolbar" aria-label="批注工具">
            {(Object.keys(TOOL_ICONS) as VisualReviewTool[]).map((tool) => {
              const Icon = TOOL_ICONS[tool]
              return (
                <button
                  key={tool}
                  type="button"
                  className={activeTool === tool ? 'is-active' : undefined}
                  aria-pressed={activeTool === tool}
                  disabled={readOnly}
                  onClick={() => selectTool(tool)}
                >
                  <Icon size={15} /> {toolLabel(tool)}
                </button>
              )
            })}
          </div>
        )}
        {candidate && (
          <div className="visual-review-tool-group visual-review-comparison-tabs" role="tablist" aria-label="对比方式">
            {(['before', 'after', 'split', 'overlay'] as VisualComparisonMode[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={comparisonMode === item}
                className={comparisonMode === item ? 'is-active' : undefined}
                onClick={() => selectComparisonMode(item)}
              >
                {item === 'before' ? '修改前' : item === 'after' ? '修改后' : item === 'split' ? '分割对比' : '叠加对比'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="visual-review-workspace">
        <div className="visual-review-viewport" ref={stageRef} onWheel={handleWheel}>
          <div className="visual-review-canvas" style={canvasStyle}>
            <div className="visual-review-image-stack">
              <img src={source.src} alt={source.alt ?? '修改前图片'} draggable={false} />
              {candidateVisible && candidate && (
                <div
                  className={`visual-review-candidate visual-review-candidate-${comparisonMode}`}
                  aria-hidden={comparisonMode === 'after' ? undefined : true}
                >
                  <img src={candidate.src} alt={candidate.alt ?? '修改后图片'} draggable={false} />
                </div>
              )}
              {candidate && comparisonMode === 'split' && (
                <div className="visual-review-split-line" aria-hidden="true" />
              )}
            </div>

            <svg
              className={`visual-review-annotation-layer tool-${activeTool}`}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              aria-label="图片批注层"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setGesture(null)}
            >
              <defs>
                <marker id="visual-review-arrowhead" markerWidth="0.025" markerHeight="0.025" refX="0.02" refY="0.0125" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M 0 0 L 0.025 0.0125 L 0 0.025 z" fill={ANNOTATION_COLOR} />
                </marker>
              </defs>
              {annotations.map((annotation, index) => (
                <g
                  key={annotation.id}
                  className={`visual-review-mark${annotation.status === 'resolved' ? ' is-resolved' : ''}${selectedAnnotationId === annotation.id ? ' is-selected' : ''}`}
                  onPointerDown={(event) => {
                    if (activeTool !== 'select') return
                    event.stopPropagation()
                    setSelectedAnnotationId(annotation.id)
                  }}
                >
                  {annotation.kind === 'box' && (
                    <rect {...annotation.geometry} fill="transparent" vectorEffect="non-scaling-stroke" />
                  )}
                  {annotation.kind === 'arrow' && (
                    <line
                      x1={annotation.geometry.start.x}
                      y1={annotation.geometry.start.y}
                      x2={annotation.geometry.end.x}
                      y2={annotation.geometry.end.y}
                      markerEnd="url(#visual-review-arrowhead)"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {annotation.kind === 'freehand' && (
                    <path d={pointsToSvgPath(annotation.geometry.points)} fill="none" vectorEffect="non-scaling-stroke" />
                  )}
                  {annotation.kind === 'pin' && (
                    <circle cx={annotation.geometry.x} cy={annotation.geometry.y} r="0.012" vectorEffect="non-scaling-stroke" />
                  )}
                  <g transform={`translate(${annotationAnchor(annotation).x} ${annotationAnchor(annotation).y})`}>
                    <circle className="visual-review-mark-index" cx="0" cy="0" r="0.014" vectorEffect="non-scaling-stroke" />
                    <text x="0" y="0" dy="0.004" textAnchor="middle">{index + 1}</text>
                  </g>
                </g>
              ))}
              {gesture?.tool === 'box' && (
                <rect className="visual-review-draft" {...normalizedBoxFromPoints(gesture.start, gesture.current)} fill="transparent" vectorEffect="non-scaling-stroke" />
              )}
              {gesture?.tool === 'arrow' && (
                <line className="visual-review-draft" x1={gesture.start.x} y1={gesture.start.y} x2={gesture.current.x} y2={gesture.current.y} markerEnd="url(#visual-review-arrowhead)" vectorEffect="non-scaling-stroke" />
              )}
              {gesture?.tool === 'freehand' && (
                <path className="visual-review-draft" d={pointsToSvgPath(gesture.points)} fill="none" vectorEffect="non-scaling-stroke" />
              )}
              {gesture?.tool === 'pin' && (
                <circle className="visual-review-draft" cx={gesture.start.x} cy={gesture.start.y} r="0.012" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          </div>
          {candidate && comparisonMode === 'split' && (
            <label className="visual-review-floating-control">
              <span>分割位置</span>
              <input type="range" min="0" max="100" value={splitPosition} onChange={(event) => setSplitPosition(Number(event.target.value))} />
            </label>
          )}
          {candidate && comparisonMode === 'overlay' && (
            <label className="visual-review-floating-control">
              <span>候选图透明度</span>
              <input type="range" min="0" max="100" value={overlayOpacity} onChange={(event) => setOverlayOpacity(Number(event.target.value))} />
            </label>
          )}
        </div>

        <aside className="visual-review-comments" aria-label="修改建议">
          <div className="visual-review-comments-heading">
            <div><MessageSquareText size={16} /><strong>修改建议</strong></div>
            <span>{openAnnotations.length} 条待处理</span>
          </div>
          <div className="visual-review-comment-list">
            {annotations.length === 0 && (
              <div className="visual-review-empty">
                <Pencil size={18} />
                <p>在图片上框选、画箭头或放置图钉，然后填写修改建议。</p>
              </div>
            )}
            {annotations.map((annotation, index) => (
              <article
                key={annotation.id}
                className={`visual-review-comment${selectedAnnotationId === annotation.id ? ' is-selected' : ''}${annotation.status === 'resolved' ? ' is-resolved' : ''}`}
                onClick={() => setSelectedAnnotationId(annotation.id)}
              >
                <header>
                  <button type="button" className="visual-review-comment-target" onClick={() => setSelectedAnnotationId(annotation.id)}>
                    {annotationLabel(annotation, index)}
                  </button>
                  {!readOnly && (
                    <div>
                      <button
                        type="button"
                        title={annotation.status === 'resolved' ? '重新打开' : '标记为已解决'}
                        aria-label={annotation.status === 'resolved' ? '重新打开批注' : '解决批注'}
                        onClick={(event) => {
                          event.stopPropagation()
                          updateAnnotation(annotation.id, { status: annotation.status === 'resolved' ? 'open' : 'resolved' })
                        }}
                      ><Check size={14} /></button>
                      <button
                        type="button"
                        title="删除"
                        aria-label="删除批注"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeAnnotation(annotation.id)
                        }}
                      ><Eraser size={14} /></button>
                    </div>
                  )}
                </header>
                <textarea
                  aria-label={`${annotationLabel(annotation, index)}的修改建议`}
                  placeholder="描述希望怎样修改……"
                  value={annotation.comment}
                  readOnly={readOnly}
                  onChange={(event) => updateAnnotation(annotation.id, { comment: event.target.value })}
                />
              </article>
            ))}
          </div>
          <div className="visual-review-actions">
            {!candidate && (
              <button
                type="button"
                className="is-primary"
                disabled={busy || openAnnotations.length === 0 || openAnnotations.every((annotation) => !annotation.comment.trim())}
                onClick={() => onRequestRevision?.(annotations)}
              >
                <Send size={15} /> {busy ? '正在生成……' : '生成修改版'}
              </button>
            )}
            {candidate && (
              <>
                <button type="button" disabled={busy} onClick={onReject}><X size={15} />拒绝</button>
                <button type="button" disabled={busy} onClick={onContinueAnnotating}><Pencil size={15} />继续批注</button>
                <button type="button" className="is-primary" disabled={busy || acceptDisabled} onClick={onAccept}><Check size={15} />接受并替换</button>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
