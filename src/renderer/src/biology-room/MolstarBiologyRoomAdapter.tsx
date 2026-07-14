import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { AlertTriangle, Atom, Camera, Loader2 } from 'lucide-react'
import type {
  BiologyMolecularViewState,
  BiologyRoomSelection
} from '@shared/biology-room'
import type { BiologyRoomViewerAdapterProps } from './BiologyRoomViewerOutlet'
import { validateBiologyAssetSource } from './asset-sources'
import {
  biologyMolecularSelectionSignature,
  biologyMolecularVisualStateSignature,
  molecularMolstarFormatForPath,
  renderBiologyMolecularWorkbenchWithMolstar,
  type BiologyMolecularWorkbenchRendererHandle,
  type MolecularMolstarRenderableSource
} from '../workspace-preview/molecular-molstar'

type BiologyMolecularSelection = Extract<BiologyRoomSelection, { kind: 'molecular' }>

const REPRESENTATIONS: Array<{
  value: BiologyMolecularViewState['representation']
  label: string
}> = [
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'ball-and-stick', label: 'Ball & stick' },
  { value: 'surface', label: 'Surface' },
  { value: 'spacefill', label: 'Spacefill' },
  { value: 'line', label: 'Line' }
]

const COLOR_SCHEMES: Array<{
  value: BiologyMolecularViewState['colorScheme']
  label: string
}> = [
  { value: 'chain', label: 'Chain' },
  { value: 'element', label: 'Element' },
  { value: 'residue', label: 'Residue' },
  { value: 'uniform', label: 'Uniform' }
]

export function defaultBiologyMolecularViewState(assetId: string): BiologyMolecularViewState {
  return {
    assetId,
    representation: 'cartoon',
    colorScheme: 'chain'
  }
}

export function MolstarBiologyRoomAdapter({
  room,
  asset,
  source,
  onApply
}: BiologyRoomViewerAdapterProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<BiologyMolecularWorkbenchRendererHandle | null>(null)
  const onApplyRef = useRef(onApply)
  const persistedSelection = room.selection?.kind === 'molecular' && room.selection.assetId === asset.id
    ? room.selection
    : null
  const persistedViewState = useMemo(() =>
    room.viewerStates.molecular?.assetId === asset.id
      ? room.viewerStates.molecular
      : defaultBiologyMolecularViewState(asset.id), [asset.id, room.viewerStates.molecular])
  const persistedSelectionRef = useRef<BiologyMolecularSelection | null>(persistedSelection)
  const persistedViewStateRef = useRef<BiologyMolecularViewState>(persistedViewState)
  const currentSelectionRef = useRef<BiologyMolecularSelection | null>(persistedSelection)
  const currentViewStateRef = useRef<BiologyMolecularViewState>(persistedViewState)
  const [viewState, setViewState] = useState<BiologyMolecularViewState>(persistedViewState)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  onApplyRef.current = onApply

  const persistedSelectionSignature = biologyMolecularSelectionSignature(persistedSelection)
  const persistedViewStateSignature = biologyMolecularRoomViewStateSignature(persistedViewState)

  const applyViewStateToViewer = useCallback((next: BiologyMolecularViewState): void => {
    const pending = handleRef.current?.setViewState(next)
    if (!pending) return
    void pending.catch((cause) => {
      setStatus('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])

  useEffect(() => {
    persistedSelectionRef.current = persistedSelection
    currentSelectionRef.current = persistedSelection
    handleRef.current?.setSelection(persistedSelection)
  }, [persistedSelection, persistedSelectionSignature])

  useEffect(() => {
    persistedViewStateRef.current = persistedViewState
    currentViewStateRef.current = persistedViewState
    setViewState(persistedViewState)
    applyViewStateToViewer(persistedViewState)
  }, [applyViewStateToViewer, persistedViewState, persistedViewStateSignature])

  const commitSelection = useCallback((selection: BiologyMolecularSelection | null): void => {
    if (biologyMolecularSelectionSignature(selection) ===
      biologyMolecularSelectionSignature(currentSelectionRef.current)) return
    const previous = persistedSelectionRef.current
    currentSelectionRef.current = selection
    const apply = onApplyRef.current
    if (!apply) return
    void Promise.resolve(apply({ type: 'setSelection', selection }))
      .then((accepted) => {
        if (accepted !== false) return
        currentSelectionRef.current = previous
        handleRef.current?.setSelection(previous)
      })
      .catch(() => {
        currentSelectionRef.current = previous
        handleRef.current?.setSelection(previous)
      })
  }, [])

  const commitViewState = useCallback((next: BiologyMolecularViewState, applyToViewer: boolean): void => {
    if (biologyMolecularRoomViewStateSignature(next) ===
      biologyMolecularRoomViewStateSignature(currentViewStateRef.current)) return
    const previous = persistedViewStateRef.current
    currentViewStateRef.current = next
    setViewState(next)
    if (applyToViewer) applyViewStateToViewer(next)
    const apply = onApplyRef.current
    if (!apply) return
    void Promise.resolve(apply({ type: 'setMolecularView', state: next }))
      .then((accepted) => {
        if (accepted !== false) return
        currentViewStateRef.current = previous
        setViewState(previous)
        applyViewStateToViewer(previous)
      })
      .catch(() => {
        currentViewStateRef.current = previous
        setViewState(previous)
        applyViewStateToViewer(previous)
      })
  }, [applyViewStateToViewer])

  const sourceUrl = source?.sourceUrl
  const validation = validateBiologyAssetSource(source)
  const validationReason = validation.ok ? null : validation.reason
  const sourceIdentity = `${asset.id}:${asset.sha256}:${sourceUrl ?? ''}`

  useEffect(() => {
    const container = containerRef.current
    if (!container || !sourceUrl || validationReason) {
      setStatus('error')
      setError(validationReason ?? 'The host did not provide a local molecular source URL.')
      return undefined
    }
    const format = molecularMolstarFormatForPath(asset.path)
    if (!format || format.kind !== 'structure') {
      setStatus('error')
      setError(`Mol* Biology Room rendering is unavailable for ${asset.path}.`)
      return undefined
    }

    const renderSource: MolecularMolstarRenderableSource = {
      kind: 'url',
      url: sourceUrl,
      label: basename(asset.path),
      format
    }
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null
    let handle: BiologyMolecularWorkbenchRendererHandle | null = null
    // Mol* owns a React root internally. Give each effect run a distinct target so
    // React StrictMode's setup/cleanup replay cannot start two async roots on the
    // same container while the first Viewer.create call is still resolving.
    const mount = document.createElement('div')
    mount.className = 'absolute inset-0 min-h-0 overflow-hidden'
    mount.dataset.biologyMolstarMount = 'true'
    container.replaceChildren(mount)
    setStatus('loading')
    setError(null)

    void renderBiologyMolecularWorkbenchWithMolstar({
      element: mount,
      source: renderSource,
      assetId: asset.id,
      selection: currentSelectionRef.current,
      viewState: currentViewStateRef.current,
      onSelectionChange: commitSelection,
      onViewStateChange: (next) => commitViewState(next, false)
    }).then(async (nextHandle) => {
      if (cancelled) {
        nextHandle.dispose()
        return
      }
      handle = nextHandle
      handleRef.current = nextHandle
      nextHandle.setSelection(currentSelectionRef.current)
      await nextHandle.setViewState(currentViewStateRef.current)
      if (cancelled) return
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => nextHandle.resize())
        resizeObserver.observe(container)
      }
      setStatus('ready')
    }).catch((cause) => {
      if (cancelled) return
      setStatus('error')
      setError(cause instanceof Error ? cause.message : String(cause))
    })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      if (handleRef.current === handle) handleRef.current = null
      handle?.dispose()
      mount.remove()
    }
  }, [asset.id, asset.path, commitSelection, commitViewState, sourceIdentity, sourceUrl, validationReason])

  const updateViewState = (patch: Partial<BiologyMolecularViewState>): void => {
    const next: BiologyMolecularViewState = {
      ...currentViewStateRef.current,
      ...patch,
      assetId: asset.id
    }
    if (next.colorScheme !== 'uniform') delete next.uniformColor
    if (next.colorScheme === 'uniform' && !next.uniformColor) next.uniformColor = '#4f86c6'
    commitViewState(next, true)
  }

  return (
    <section
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-ds-canvas"
      data-molstar-biology-room-adapter
      data-molecular-render-state={status}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ds-border bg-ds-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Atom className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={1.7} />
          <span className="truncate text-[11.5px] font-medium text-ds-ink">{basename(asset.path)}</span>
          {viewState.camera ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-ds-faint" title="Camera is persisted in this room revision">
              <Camera className="h-3 w-3" /> Camera saved
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={viewState.representation}
            onChange={(event) => updateViewState({
              representation: event.currentTarget.value as BiologyMolecularViewState['representation']
            })}
            className="rounded-md border border-ds-border bg-ds-canvas px-2 py-1 text-[10.5px] text-ds-ink"
            aria-label="Molecular representation"
          >
            {REPRESENTATIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={viewState.colorScheme}
            onChange={(event) => updateViewState({
              colorScheme: event.currentTarget.value as BiologyMolecularViewState['colorScheme']
            })}
            className="rounded-md border border-ds-border bg-ds-canvas px-2 py-1 text-[10.5px] text-ds-ink"
            aria-label="Molecular color scheme"
          >
            {COLOR_SCHEMES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {viewState.colorScheme === 'uniform' ? (
            <input
              type="color"
              value={viewState.uniformColor ?? '#4f86c6'}
              onChange={(event) => updateViewState({ uniformColor: event.currentTarget.value })}
              className="h-7 w-8 cursor-pointer rounded border border-ds-border bg-transparent p-0.5"
              aria-label="Uniform molecular color"
            />
          ) : null}
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-white" />
      {status !== 'ready' ? (
        <div
          className="absolute inset-x-0 bottom-0 top-[45px] flex flex-col items-center justify-center bg-ds-canvas/90 px-8 text-center"
          role={status === 'error' ? 'alert' : 'status'}
        >
          {status === 'loading'
            ? <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            : <AlertTriangle className="h-6 w-6 text-amber-500" />}
          <p className="mt-3 max-w-md text-[12px] leading-5 text-ds-muted">
            {status === 'loading' ? 'Loading the local structure into Mol*…' : error}
          </p>
        </div>
      ) : null}
      <span className="sr-only">Mol* screenshot controls are available in the viewer toolbar.</span>
    </section>
  )
}

function biologyMolecularRoomViewStateSignature(state: BiologyMolecularViewState): string {
  return JSON.stringify([
    biologyMolecularVisualStateSignature(state),
    state.camera?.position ?? null,
    state.camera?.target ?? null,
    state.camera?.up ?? null
  ])
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}
