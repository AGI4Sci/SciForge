import type {
  FigureStyleExtractResult,
  FigureStyleSimilarityResult
} from '@shared/figure-style'
import {
  DEFAULT_FIGURE_STYLE_CROP_BOX_DRAFT,
  FIGURE_STYLE_IMAGE_SOURCE_EXTENSIONS,
  buildFigureStyleArtifactPath,
  extensionFromFigureStylePath as extensionFromPath,
  figureStyleSpecPayload,
  fileNameFromFigureStylePath as fileNameFromPath,
  inferFigureStyleSourceType,
  normalizeRatioCropBoxDraft,
  serializeFigureStyleSpecPayload,
  workspaceRelativeFigurePath,
  type FigureStyleCropBoxDraft
} from '@shared/figure-style-actions'
import type {
  ScientificPlottingPrepareReferenceResult,
  ScientificPlottingStatusResult
} from '@shared/scientific-plotting'
import {
  Check,
  Clipboard,
  Copy,
  Crop,
  FileCode2,
  FileImage,
  FolderOpen,
  Frame,
  Image as ImageIcon,
  Loader2,
  PanelRightClose,
  Palette,
  Radar,
  Save,
  SlidersHorizontal,
  TriangleAlert,
  UploadCloud
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  persistFigureStylePanelPage,
  readStoredFigureStylePanelPage,
  type FigureStylePanelPage
} from './figure-style-panel-state'

const SciforgeCanvasPanel = lazy(() =>
  import('../sciforge-canvas/SciforgeCanvasPanel').then((module) => ({ default: module.SciforgeCanvasPanel }))
)

type Props = {
  workspaceRoot: string
  canvasId?: string
  className?: string
  onCollapse: () => void
  onCanvasReviewRequest?: (text: string) => void
  preferredPage?: FigureStylePanelPage
  canvasRefreshKey?: number
  canvasFocusShapeId?: string
}

const COPY_RESET_MS = 1400

function confidenceLabel(value: number): string {
  if (value >= 0.75) return 'high'
  if (value >= 0.55) return 'medium'
  return 'low'
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function firstDroppedFile(event: DragEvent): File | null {
  const files = Array.from(event.dataTransfer.files ?? [])
  return files[0] ?? null
}

function rcParamRows(result: Extract<FigureStyleExtractResult, { ok: true }>): Array<[string, string]> {
  return Object.entries(result.applyPlan.matplotlibHints.rcParams)
    .slice(0, 12)
    .map(([key, value]) => [key, String(value)])
}

export function FigureStylePanel({
  workspaceRoot,
  canvasId,
  className = '',
  onCollapse,
  onCanvasReviewRequest,
  preferredPage,
  canvasRefreshKey,
  canvasFocusShapeId
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [activePage, setActivePage] = useState<FigureStylePanelPage>(() => readStoredFigureStylePanelPage())
  const [sourcePath, setSourcePath] = useState('')
  const [sourceType, setSourceType] = useState<'image' | 'pdf'>('image')
  const [figureId, setFigureId] = useState('')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<FigureStyleExtractResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [savedPath, setSavedPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [scoreResult, setScoreResult] = useState<FigureStyleSimilarityResult | null>(null)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewMessage, setPreviewMessage] = useState('')
  const [plottingStatus, setPlottingStatus] = useState<ScientificPlottingStatusResult | null>(null)
  const [prepareBusy, setPrepareBusy] = useState(false)
  const [preparedReference, setPreparedReference] = useState<ScientificPlottingPrepareReferenceResult | null>(null)
  const [pdfPage, setPdfPage] = useState('1')
  const [referenceDpi, setReferenceDpi] = useState('160')
  const [cropBoxDraft, setCropBoxDraft] = useState<FigureStyleCropBoxDraft>(
    DEFAULT_FIGURE_STYLE_CROP_BOX_DRAFT
  )
  const copyResetRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    },
    []
  )

  useEffect(() => {
    if (!preferredPage) return
    setActivePage(preferredPage)
  }, [preferredPage, canvasRefreshKey])

  useEffect(() => {
    persistFigureStylePanelPage(activePage)
  }, [activePage])

  useEffect(() => {
    let cancelled = false
    setPreviewUrl('')
    setPreviewMessage('')
    if (!workspaceRoot.trim() || !sourcePath.trim() || sourceType !== 'image') return () => {
      cancelled = true
    }
    if (typeof window.sciforge?.readWorkspaceImage !== 'function') return () => {
      cancelled = true
    }
    void window.sciforge
      .readWorkspaceImage({ workspaceRoot, path: sourcePath.trim() })
      .then((image) => {
        if (cancelled) return
        if (image.ok) {
          setPreviewUrl(image.dataUrl)
          setPreviewMessage('')
        } else {
          setPreviewMessage(image.message)
        }
      })
      .catch((error) => {
        if (!cancelled) setPreviewMessage(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [sourcePath, sourceType, workspaceRoot])

  const loadPlottingStatus = async (): Promise<void> => {
    if (typeof window.sciforge?.getScientificPlottingStatus !== 'function') return
    try {
      setPlottingStatus(await window.sciforge.getScientificPlottingStatus(workspaceRoot))
    } catch (error) {
      setPlottingStatus({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  useEffect(() => {
    void loadPlottingStatus()
  }, [workspaceRoot])

  const okResult = result?.ok ? result : null
  const canExtract =
    Boolean(workspaceRoot.trim()) &&
    Boolean(sourcePath.trim()) &&
    !busy &&
    typeof window.sciforge?.extractFigureStyleReference === 'function'
  const canPrepareReference =
    Boolean(workspaceRoot.trim()) &&
    Boolean(sourcePath.trim()) &&
    !prepareBusy &&
    typeof window.sciforge?.prepareScientificPlottingReference === 'function'
  const pdfCropUnavailable = sourceType === 'pdf' && plottingStatus?.ok && !plottingStatus.referencePreparation.pdfCrop.available
  const canPrimaryAction = canExtract && (sourceType !== 'pdf' || (!prepareBusy && !pdfCropUnavailable))
  const canExport = Boolean(okResult) && !busy
  const canEvaluate =
    Boolean(okResult) &&
    Boolean(workspaceRoot.trim()) &&
    Boolean(sourcePath.trim()) &&
    Boolean(outputPath.trim()) &&
    !scoreBusy &&
    typeof window.sciforge?.evaluateFigureStyle === 'function'
  const palette = okResult?.spec.palette.accent.length
    ? okResult.spec.palette.accent
    : okResult?.spec.palette.colors ?? []
  const rcRows = useMemo(() => (okResult ? rcParamRows(okResult) : []), [okResult])
  const artifactPath = useMemo(
    () => (okResult ? buildFigureStyleArtifactPath(okResult.spec) : ''),
    [okResult]
  )

  const acceptReferencePath = (path: string): void => {
    const relativePath = workspaceRelativeFigurePath(path, workspaceRoot)
    if (!relativePath) {
      setMessage(t('figureStyleWorkspaceOnly'))
      return
    }
    const ext = extensionFromPath(relativePath)
    if (ext !== '.pdf' && !FIGURE_STYLE_IMAGE_SOURCE_EXTENSIONS.has(ext)) {
      setMessage(t('figureStyleUnsupportedReference'))
      return
    }
    setSourcePath(relativePath)
    setSourceType(inferFigureStyleSourceType(relativePath))
    setSavedPath('')
    setScoreResult(null)
    setPreparedReference(null)
    setMessage('')
    if (!figureId.trim()) {
      setFigureId(fileNameFromPath(relativePath).replace(/\.[^.]+$/g, ''))
    }
  }

  const chooseReferenceFile = async (): Promise<void> => {
    if (typeof window.sciforge?.pickWorkspaceFile !== 'function') {
      setMessage(t('figureStylePickUnavailable'))
      return
    }
    const picked = await window.sciforge.pickWorkspaceFile(workspaceRoot)
    if (picked.canceled || !picked.path) return
    acceptReferencePath(picked.path)
  }

  const acceptOutputPath = (path: string): void => {
    const relativePath = workspaceRelativeFigurePath(path, workspaceRoot)
    if (!relativePath) {
      setMessage(t('figureStyleWorkspaceOnly'))
      return
    }
    const ext = extensionFromPath(relativePath)
    if (!FIGURE_STYLE_IMAGE_SOURCE_EXTENSIONS.has(ext)) {
      setMessage(t('figureStyleUnsupportedOutput'))
      return
    }
    setOutputPath(relativePath)
    setScoreResult(null)
    setMessage('')
  }

  const chooseOutputFile = async (): Promise<void> => {
    if (typeof window.sciforge?.pickWorkspaceFile !== 'function') {
      setMessage(t('figureStylePickUnavailable'))
      return
    }
    const picked = await window.sciforge.pickWorkspaceFile(workspaceRoot)
    if (picked.canceled || !picked.path) return
    acceptOutputPath(picked.path)
  }

  const handleDragOver = (event: DragEvent): void => {
    if (!Array.from(event.dataTransfer.types ?? []).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragActive(false)
    const file = firstDroppedFile(event)
    if (!file) return
    if (typeof window.sciforge?.getPathForFile !== 'function') {
      setMessage(t('figureStylePickUnavailable'))
      return
    }
    const path = window.sciforge.getPathForFile(file)
    if (!path.trim()) {
      setMessage(t('figureStyleDroppedPathUnavailable'))
      return
    }
    acceptReferencePath(path)
  }

  const updateCropBoxDraft = (key: keyof FigureStyleCropBoxDraft, value: string): void => {
    setCropBoxDraft((current) => ({ ...current, [key]: value }))
  }

  const prepareReference = async (): Promise<void> => {
    if (!sourcePath.trim()) {
      setMessage(t('figureStyleSourceRequired'))
      return
    }
    if (!workspaceRoot.trim()) {
      setMessage(t('figureStyleWorkspaceRequired'))
      return
    }
    if (typeof window.sciforge?.prepareScientificPlottingReference !== 'function') {
      setMessage(t('figureStylePrepareUnavailable'))
      return
    }
    const cropBox = normalizeRatioCropBoxDraft(cropBoxDraft)
    if (!cropBox) {
      setMessage(t('figureStyleCropInvalid'))
      return
    }
    const page = Math.max(1, Math.trunc(Number(pdfPage) || 1))
    const dpi = Math.min(600, Math.max(72, Math.trunc(Number(referenceDpi) || 160)))
    setPrepareBusy(true)
    setMessage('')
    setSavedPath('')
    setScoreResult(null)
    setResult(null)
    try {
      const prepared = await window.sciforge.prepareScientificPlottingReference({
        workspaceRoot,
        sourcePath: sourcePath.trim(),
        sourceType,
        ...(sourceType === 'pdf' ? { page, dpi } : {}),
        cropBox,
        ...(figureId.trim() ? { figureId: figureId.trim() } : {}),
        extractStyle: true
      })
      setPreparedReference(prepared)
      if (!prepared.ok) {
        setResult(null)
        setMessage(prepared.message)
        return
      }

      const relativeCrop = workspaceRelativeFigurePath(prepared.croppedImagePath, workspaceRoot)
      if (!relativeCrop) {
        setResult(null)
        setMessage(t('figureStylePreparedPathOutsideWorkspace'))
        return
      }
      setSourcePath(relativeCrop)
      setSourceType('image')
    } catch (error) {
      setPreparedReference(null)
      setResult(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPrepareBusy(false)
    }
  }

  const extract = async (): Promise<void> => {
    if (!sourcePath.trim()) {
      setMessage(t('figureStyleSourceRequired'))
      return
    }
    if (!workspaceRoot.trim()) {
      setMessage(t('figureStyleWorkspaceRequired'))
      return
    }
    if (typeof window.sciforge?.extractFigureStyleReference !== 'function') {
      setMessage(t('figureStyleUnavailable'))
      return
    }
    const trimmedSourcePath = sourcePath.trim()
    const trimmedFigureId = figureId.trim()
    const trimmedNotes = notes.trim()
    const pdfCropBox = sourceType === 'pdf' ? normalizeRatioCropBoxDraft(cropBoxDraft) : undefined
    if (sourceType === 'pdf' && !pdfCropBox) {
      setMessage(t('figureStyleCropInvalid'))
      return
    }
    const page = Math.max(1, Math.trunc(Number(pdfPage) || 1))
    const dpi = Math.min(600, Math.max(72, Math.trunc(Number(referenceDpi) || 160)))
    setBusy(true)
    if (sourceType === 'pdf') setPrepareBusy(true)
    setMessage('')
    setSavedPath('')
    setScoreResult(null)
    try {
      const next = sourceType === 'pdf'
        ? await window.sciforge.extractFigureStyleReference({
            workspaceRoot,
            sourcePath: trimmedSourcePath,
            sourceType: 'pdf',
            page,
            dpi,
            cropBox: pdfCropBox ?? undefined,
            ...(trimmedFigureId ? { figureId: trimmedFigureId } : {}),
            ...(trimmedNotes ? { notes: trimmedNotes } : {})
          })
        : await window.sciforge.extractFigureStyleReference({
            workspaceRoot,
            sourcePath: trimmedSourcePath,
            sourceType: 'image',
            ...(trimmedFigureId ? { figureId: trimmedFigureId } : {}),
            ...(trimmedNotes ? { notes: trimmedNotes } : {})
          })
      setPreparedReference(next.preparedReference ?? null)
      if (!next.ok) {
        setResult(next.extraction ?? null)
        setMessage(next.message)
        return
      }
      setSourcePath(next.sourcePath)
      setSourceType(next.sourceType)
      setResult(next.extraction)
    } catch (error) {
      setResult(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPrepareBusy(false)
      setBusy(false)
    }
  }

  const copySpec = async (): Promise<void> => {
    if (!okResult || !navigator?.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(serializeFigureStyleSpecPayload(figureStyleSpecPayload(okResult)))
      setCopied(true)
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const saveSpec = async (): Promise<void> => {
    if (!okResult) return
    if (typeof window.sciforge?.saveFigureStyleSpec !== 'function') {
      setMessage(t('figureStyleSaveUnavailable'))
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const path = buildFigureStyleArtifactPath(okResult.spec)
      const saved = await window.sciforge.saveFigureStyleSpec({
        workspaceRoot,
        path,
        ...figureStyleSpecPayload(okResult)
      })
      if (!saved.ok) {
        setMessage(saved.message)
        return
      }
      setSavedPath(saved.path)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const evaluateOutput = async (): Promise<void> => {
    if (!okResult) return
    if (!outputPath.trim()) {
      setMessage(t('figureStyleOutputRequired'))
      return
    }
    if (typeof window.sciforge?.evaluateFigureStyle !== 'function') {
      setMessage(t('figureStyleEvaluateUnavailable'))
      return
    }
    setScoreBusy(true)
    setMessage('')
    try {
      const score = await window.sciforge.evaluateFigureStyle({
        workspaceRoot,
        referencePath: sourcePath.trim(),
        outputPath: outputPath.trim()
      })
      setScoreResult(score)
      if (!score.ok) setMessage(score.message)
    } catch (error) {
      setScoreResult(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setScoreBusy(false)
    }
  }

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-ds-surface-subtle px-3 py-1.5 dark:bg-white/8">
            <Palette className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
              {t('figureStylePanelTitle')}
            </span>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="grid grid-cols-2 gap-1 rounded-[8px] border border-ds-border-muted bg-[var(--ds-chip-muted-bg)] p-1 shadow-[var(--ds-shadow-chip)]">
            {[
              { page: 'style' as const, label: t('figureStyleTabStyle'), icon: SlidersHorizontal },
              { page: 'canvas' as const, label: t('figureStyleTabCanvas'), icon: Frame }
            ].map((item) => {
              const active = activePage === item.page
              const Icon = item.icon
              return (
                <button
                  key={item.page}
                  type="button"
                  onClick={() => setActivePage(item.page)}
                  className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-[12.5px] font-semibold transition ${
                    active
                      ? 'border-accent/35 bg-[var(--ds-chip-active)] text-ds-ink shadow-[var(--ds-shadow-chip)]'
                      : 'border-transparent bg-transparent text-ds-muted hover:bg-[var(--ds-chip-hover)] hover:text-ds-ink'
                  }`}
                  aria-pressed={active}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.85} />
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {activePage === 'style' ? (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          <section className="rounded-[8px] border border-ds-border-muted bg-ds-surface-subtle p-3 dark:bg-white/5">
            <div className="mb-3 flex items-center gap-2">
              <FileImage className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ds-ink">{t('figureStyleSourceTitle')}</div>
                <div className="text-[11.5px] text-ds-faint">{t('figureStyleSourceHint')}</div>
              </div>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => void chooseReferenceFile()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void chooseReferenceFile()
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mb-3 grid min-h-[112px] cursor-pointer grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-[8px] border border-dashed px-3 py-3 transition ${
                dragActive
                  ? 'border-accent bg-accent/8'
                  : 'border-ds-border bg-white/70 hover:border-accent/70 dark:bg-white/5'
              }`}
            >
              <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[7px] border border-ds-border-muted bg-white dark:bg-ds-card">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <UploadCloud className="h-6 w-6 text-ds-faint" strokeWidth={1.7} />
                )}
              </div>
              <div className="flex min-w-0 flex-col justify-center">
                <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-ds-ink">
                  {previewUrl ? (
                    <ImageIcon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
                  ) : (
                    <FolderOpen className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
                  )}
                  <span className="truncate">
                    {sourcePath.trim() ? fileNameFromPath(sourcePath) : t('figureStyleDropTitle')}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11.5px] text-ds-faint">
                  {sourcePath.trim() || t('figureStyleDropHint')}
                </div>
                {previewMessage ? (
                  <div className="mt-2 line-clamp-2 text-[11px] text-amber-700 dark:text-amber-300">
                    {previewMessage}
                  </div>
                ) : null}
              </div>
            </div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
              {t('figureStyleSourcePath')}
            </label>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
              <input
                value={sourcePath}
                onChange={(event) => {
                  setSourcePath(event.target.value)
                  setSourceType(inferFigureStyleSourceType(event.target.value))
                }}
                placeholder={t('figureStyleSourcePlaceholder')}
                className="w-full rounded-[8px] border border-ds-border bg-white px-3 py-2 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent dark:bg-white/5"
              />
              <button
                type="button"
                onClick={() => void chooseReferenceFile()}
                className="inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-white px-2 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover dark:bg-white/5 dark:hover:bg-white/10"
              >
                <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                {t('figureStyleBrowse')}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_112px] gap-2">
              <input
                value={figureId}
                onChange={(event) => setFigureId(event.target.value)}
                placeholder={t('figureStyleFigureIdPlaceholder')}
                className="w-full rounded-[8px] border border-ds-border bg-white px-3 py-2 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent dark:bg-white/5"
              />
              <select
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as 'image' | 'pdf')}
                className="w-full rounded-[8px] border border-ds-border bg-white px-2 py-2 text-[13px] text-ds-ink outline-none transition focus:border-accent dark:bg-white/5"
                aria-label={t('figureStyleSourceType')}
              >
                <option value="image">{t('figureStyleTypeImage')}</option>
                <option value="pdf">{t('figureStyleTypePdf')}</option>
              </select>
            </div>
            <div className="mt-2 rounded-[8px] border border-ds-border bg-white p-2 dark:bg-white/5">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-ds-ink">
                <Crop className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
                {t('figureStylePrepareReferenceTitle')}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
                    {t('figureStylePdfPage')}
                  </span>
                  <input
                    value={pdfPage}
                    onChange={(event) => setPdfPage(event.target.value)}
                    disabled={sourceType !== 'pdf'}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-[7px] border border-ds-border bg-ds-surface-subtle px-2 py-1.5 text-[12.5px] text-ds-ink outline-none transition focus:border-accent disabled:opacity-45 dark:bg-white/6"
                  />
                </label>
                <label className="block">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
                    {t('figureStyleReferenceDpi')}
                  </span>
                  <input
                    value={referenceDpi}
                    onChange={(event) => setReferenceDpi(event.target.value)}
                    disabled={sourceType !== 'pdf'}
                    inputMode="numeric"
                    className="mt-1 w-full rounded-[7px] border border-ds-border bg-ds-surface-subtle px-2 py-1.5 text-[12.5px] text-ds-ink outline-none transition focus:border-accent disabled:opacity-45 dark:bg-white/6"
                  />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={key} className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-ds-faint">
                      {t(`figureStyleCrop_${key}`)}
                    </span>
                    <input
                      value={cropBoxDraft[key]}
                      onChange={(event) => updateCropBoxDraft(key, event.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-[7px] border border-ds-border bg-ds-surface-subtle px-2 py-1.5 text-[12px] text-ds-ink outline-none transition focus:border-accent dark:bg-white/6"
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void prepareReference()}
                disabled={!canPrepareReference || pdfCropUnavailable}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[8px] border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6 dark:hover:bg-white/10"
              >
                {prepareBusy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Crop className="h-4 w-4" strokeWidth={1.8} />}
                {sourceType === 'pdf' ? t('figureStylePreparePdf') : t('figureStylePrepareImage')}
              </button>
              {preparedReference?.ok ? (
                <div className="mt-2 truncate rounded-[6px] bg-emerald-500/10 px-2 py-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300" title={preparedReference.croppedImagePath}>
                  {t('figureStylePreparedPath', { path: fileNameFromPath(preparedReference.croppedImagePath) })}
                </div>
              ) : null}
            </div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={t('figureStyleNotesPlaceholder')}
              className="mt-2 min-h-20 w-full resize-none rounded-[8px] border border-ds-border bg-white px-3 py-2 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent dark:bg-white/5"
            />
            <button
              type="button"
              onClick={() => void extract()}
              disabled={!canPrimaryAction}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[8px] bg-ds-ink px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-ds-ink/90 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white dark:text-ds-canvas dark:hover:bg-white/90"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />}
              {sourceType === 'pdf' ? t('figureStylePrepareAndExtract') : t('figureStyleExtract')}
            </button>
          </section>

          {message ? (
            <div className="flex gap-2 rounded-[8px] border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-100">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.85} />
              <span className="min-w-0">{message}</span>
            </div>
          ) : null}

          {okResult ? (
            <>
              <section className="rounded-[8px] border border-ds-border-muted bg-white p-3 dark:bg-white/5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ds-ink">{t('figureStyleStatusReady')}</div>
                    <div className="mt-1 truncate text-[11.5px] text-ds-faint" title={okResult.spec.source.path}>
                      {fileNameFromPath(okResult.spec.source.path)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-[6px] bg-emerald-500/12 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {t(`figureStyleConfidence_${confidenceLabel(okResult.spec.confidence.overall)}`)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    [t('figureStyleMetricPalette'), formatPercent(okResult.spec.confidence.palette)],
                    [t('figureStyleMetricLayout'), formatPercent(okResult.spec.confidence.layout)],
                    [t('figureStyleMetricAxes'), formatPercent(okResult.spec.confidence.axes)]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[7px] bg-ds-surface-subtle px-2 py-2 dark:bg-white/6">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">{label}</div>
                      <div className="mt-1 text-[15px] font-semibold text-ds-ink">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {palette.map((color) => (
                    <span
                      key={color}
                      className="h-6 w-6 rounded-[6px] border border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.32)]"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </section>

              <section className="rounded-[8px] border border-ds-border-muted bg-white p-3 dark:bg-white/5">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                  <Clipboard className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
                  {t('figureStyleApplyPlanTitle')}
                </div>
                <div className="space-y-1.5">
                  {rcRows.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-2 rounded-[6px] bg-ds-surface-subtle px-2 py-1.5 text-[11.5px] dark:bg-white/6">
                      <code className="min-w-0 truncate text-ds-muted">{key}</code>
                      <code className="min-w-0 truncate text-right text-ds-ink">{value}</code>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5 text-[12px] text-ds-muted">
                  {okResult.applyPlan.matplotlibHints.layoutNotes.map((note) => (
                    <div key={note} className="rounded-[6px] bg-ds-surface-subtle px-2 py-1.5 dark:bg-white/6">
                      {note}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[8px] border border-ds-border-muted bg-white p-3 dark:bg-white/5">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                  <FileCode2 className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
                  {t('figureStyleControlledWorkflowTitle')}
                </div>
                <div className="space-y-1.5 text-[12px]">
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-[6px] bg-ds-surface-subtle px-2 py-1.5 dark:bg-white/6">
                    <span className="text-ds-faint">{t('figureStyleNextTool')}</span>
                    <span className="min-w-0 truncate font-semibold text-ds-ink">
                      {okResult.applyPlan.plottingWorkflow.nextControlledTool}
                    </span>
                  </div>
                  <div className="rounded-[6px] bg-ds-surface-subtle px-2 py-1.5 dark:bg-white/6">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">
                      {t('figureStyleRecommendedSkills')}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {okResult.applyPlan.plottingWorkflow.recommendedSkills.map((skill) => (
                        <span key={skill} className="rounded-[5px] border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-muted">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                  {okResult.applyPlan.plottingWorkflow.guardrails.slice(0, 2).map((guardrail) => (
                    <div key={guardrail} className="rounded-[6px] bg-ds-surface-subtle px-2 py-1.5 text-ds-muted dark:bg-white/6">
                      {guardrail}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[8px] border border-ds-border-muted bg-white p-3 dark:bg-white/5">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
                  <Radar className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
                  {t('figureStyleScoreTitle')}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                  <input
                    value={outputPath}
                    onChange={(event) => {
                      setOutputPath(event.target.value)
                      setScoreResult(null)
                    }}
                    placeholder={t('figureStyleOutputPlaceholder')}
                    className="w-full rounded-[8px] border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[13px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent dark:bg-white/6"
                  />
                  <button
                    type="button"
                    onClick={() => void chooseOutputFile()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-surface-subtle px-2 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover dark:bg-white/6 dark:hover:bg-white/10"
                  >
                    <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
                    {t('figureStyleBrowse')}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void evaluateOutput()}
                  disabled={!canEvaluate}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[8px] border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6 dark:hover:bg-white/10"
                >
                  {scoreBusy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Radar className="h-4 w-4" strokeWidth={1.8} />}
                  {t('figureStyleEvaluate')}
                </button>
                {scoreResult?.ok ? (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        [t('figureStyleScoreOverall'), formatPercent(scoreResult.score.overall)],
                        [t('figureStyleMetricPalette'), formatPercent(scoreResult.score.palette)],
                        [t('figureStyleScoreGrid'), formatPercent(scoreResult.score.grid)],
                        [t('figureStyleMetricAxes'), formatPercent(scoreResult.score.axes)]
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-[7px] bg-ds-surface-subtle px-2 py-2 dark:bg-white/6">
                          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.04em] text-ds-faint">{label}</div>
                          <div className="mt-1 text-[13px] font-semibold text-ds-ink">{value}</div>
                        </div>
                      ))}
                    </div>
                    {scoreResult.score.warnings.length ? (
                      <div className="space-y-1">
                        {scoreResult.score.warnings.slice(0, 3).map((warning) => (
                          <div key={warning} className="rounded-[6px] bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[6px] bg-emerald-500/10 px-2 py-1.5 text-[11.5px] text-emerald-700 dark:text-emerald-300">
                        {t('figureStyleScoreNoWarnings')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 text-[11.5px] text-ds-faint">
                    {t('figureStyleScoreHint')}
                  </div>
                )}
              </section>

              <section className="rounded-[8px] border border-ds-border-muted bg-white p-3 dark:bg-white/5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void copySpec()}
                    disabled={!canExport}
                    className="inline-flex items-center justify-center gap-2 rounded-[8px] border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6 dark:hover:bg-white/10"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={1.8} />}
                    {copied ? t('copySuccess') : t('figureStyleCopySpec')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveSpec()}
                    disabled={!canExport || !workspaceRoot.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-[8px] border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6 dark:hover:bg-white/10"
                  >
                    <Save className="h-4 w-4" strokeWidth={1.8} />
                    {t('figureStyleSaveSpec')}
                  </button>
                </div>
                <div className="mt-2 text-[11.5px] text-ds-faint">
                  {savedPath
                    ? t('figureStyleSavedPath', { path: savedPath })
                    : t('figureStyleArtifactHint', { path: artifactPath })}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-ds-muted">
                <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
              </div>
            }
          >
            <SciforgeCanvasPanel
              workspaceRoot={workspaceRoot}
              canvasId={canvasId}
              variant="embedded"
              className="h-full max-h-full w-full"
              onSendReviewRequest={onCanvasReviewRequest}
              refreshKey={canvasRefreshKey}
              focusShapeId={canvasFocusShapeId}
            />
          </Suspense>
        </div>
      )}
    </aside>
  )
}
