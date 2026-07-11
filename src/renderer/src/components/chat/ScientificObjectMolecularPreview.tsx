import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import type { ScientificObjectRef } from '@shared/scientific-objects'
import type { WorkspacePreviewOpenInput } from '@shared/sciforge-api'
import {
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import {
  MOLECULAR_WORKBENCH_MAX_DATA_BYTES,
  readMolecularRenderableAssetText,
  resolveMolecularRenderableAsset
} from '../../workspace-preview/MolecularWorkspaceViewer'
import {
  molecularMolstarFormatForPath,
  renderMolecularWorkbenchWithMolstar,
  type MolecularMolstarRenderableSource,
  type MolecularWorkbenchRenderer,
  type MolecularWorkbenchRendererHandle
} from '../../workspace-preview/molecular-molstar'
import {
  createWorkspacePreviewHost,
  type WorkspacePreviewHost
} from '../../workspace-preview/host'

type MolecularSelection = Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>

export type ScientificObjectMolecularPreviewProps = {
  object: ScientificObjectRef
  selection?: WorkspaceStructuredSelection
  onSelectionChange?: (selection: WorkspaceStructuredSelection) => void
  className?: string
  /** Test and embedding seam; normal chat cards use the shared workspace-preview host. */
  host?: WorkspacePreviewHost
  /** Test seam; normal chat cards lazily import the existing Mol* workbench renderer. */
  workbenchRenderer?: MolecularWorkbenchRenderer
}

export type ScientificObjectMolecularPreviewTarget =
  | {
      ok: true
      path: string
      workspaceRoot: string
      mimeType?: string
    }
  | {
      ok: false
      reason: string
    }

export type ScientificObjectMolecularPreviewState =
  | {
      kind: 'loading'
      title: string
      message: string
    }
  | {
      kind: 'ready'
      title: string
      message: string
      sessionId: string
      asset: WorkspacePreviewAssetTransportDescriptor
      observation: WorkspaceObservation | null
      sourceUrl: string | null
    }
  | {
      kind: 'fallback' | 'error'
      title: string
      message: string
    }

type ScientificObjectMolecularPreviewRenderState = {
  kind: 'loading' | 'ready' | 'fallback' | 'error'
  title: string
  message: string
}

export function resolveScientificObjectMolecularPreviewTarget(
  object: ScientificObjectRef
): ScientificObjectMolecularPreviewTarget {
  if (object.modality !== 'molecular') {
    return {
      ok: false,
      reason: 'This inline preview only renders molecular scientific objects.'
    }
  }

  const path = object.path.trim()
  const workspaceRoot = object.workspaceRoot.trim()
  if (!path || !workspaceRoot) {
    return {
      ok: false,
      reason: 'A workspace path and workspace root are required for a safe molecular preview.'
    }
  }
  if (!molecularMolstarFormatForPath(path)) {
    return {
      ok: false,
      reason: `Mol* does not support the molecular format for ${basename(path)}.`
    }
  }

  return {
    ok: true,
    path,
    workspaceRoot,
    ...(object.mimeType ? { mimeType: object.mimeType } : {})
  }
}

export function resolveScientificObjectMolecularSelection(
  object: ScientificObjectRef,
  selection?: WorkspaceStructuredSelection | null
): MolecularSelection | undefined {
  if (selection?.kind === 'molecular') return selection
  if (object.selection?.kind === 'molecular') return object.selection
  if (object.observation?.selection?.kind === 'molecular') {
    return object.observation.selection
  }
  return undefined
}

export function createScientificObjectMolecularPreviewOpenInput(
  object: ScientificObjectRef,
  selection?: WorkspaceStructuredSelection | null
): WorkspacePreviewOpenInput | null {
  const target = resolveScientificObjectMolecularPreviewTarget(object)
  if (!target.ok) return null

  return {
    path: target.path,
    workspaceRoot: target.workspaceRoot,
    mimeType: target.mimeType,
    mode: 'inspect',
    selection: resolveScientificObjectMolecularSelection(object, selection),
    integrity: {
      algorithm: 'sha256',
      expectedDigest: object.hash.digest
    }
  }
}

export function createScientificObjectMolecularChainSelection(chain: string): MolecularSelection {
  return {
    kind: 'molecular',
    chains: [chain]
  }
}

export function createScientificObjectMolecularLigandSelection(ligand: string): MolecularSelection {
  return {
    kind: 'molecular',
    ligands: [ligand]
  }
}

export function ScientificObjectMolecularPreview({
  object,
  selection,
  onSelectionChange,
  className,
  host: providedHost,
  workbenchRenderer = renderMolecularWorkbenchWithMolstar
}: ScientificObjectMolecularPreviewProps): ReactElement {
  const target = useMemo(
    () => resolveScientificObjectMolecularPreviewTarget(object),
    [object]
  )
  const [fallbackHost] = useState(() => createWorkspacePreviewHost())
  const host = providedHost ?? fallbackHost
  const preferredSelection = resolveScientificObjectMolecularSelection(object, selection)
  const [localSelection, setLocalSelection] = useState<MolecularSelection | undefined>(preferredSelection)
  const [connectionState, setConnectionState] = useState<ScientificObjectMolecularPreviewState>(() => (
    target.ok
      ? createLoadingState('Connecting molecular preview', 'Opening a bounded workspace preview session.')
      : createFallbackState(target.reason)
  ))
  const [renderState, setRenderState] = useState<ScientificObjectMolecularPreviewRenderState>(() => (
    target.ok
      ? createLoadingState('Connecting molecular preview', 'Opening a bounded workspace preview session.')
      : createFallbackState(target.reason)
  ))
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const rendererHandleRef = useRef<MolecularWorkbenchRendererHandle | null>(null)
  const latestSelectionRef = useRef<MolecularSelection | undefined>(preferredSelection)

  useEffect(() => {
    setLocalSelection(preferredSelection)
  }, [preferredSelection])

  useEffect(() => {
    latestSelectionRef.current = localSelection
    rendererHandleRef.current?.setSelection(localSelection)
  }, [localSelection])

  useEffect(() => {
    if (!target.ok) {
      const fallback = createFallbackState(target.reason)
      setConnectionState(fallback)
      setRenderState(fallback)
      return undefined
    }

    let cancelled = false
    let ownedSessionId: string | null = null
    const loading = createLoadingState(
      'Connecting molecular preview',
      'Opening a bounded workspace preview session.'
    )
    setConnectionState(loading)
    setRenderState(loading)

    const connect = async (): Promise<void> => {
      const referencedSessionId = object.sessionId?.trim() || null
      if (referencedSessionId) {
        const connected = await describeScientificObjectMolecularSession({
          host,
          sessionId: referencedSessionId,
          expectedPath: target.path
        })
        if (connected.ok) {
          if (!cancelled) setConnectionState(connected.state)
          return
        }
      }

      const openInput = createScientificObjectMolecularPreviewOpenInput(
        object,
        latestSelectionRef.current
      )
      if (!openInput) throw new Error('The scientific object cannot be opened as a molecular preview.')
      const opened = await host.open(openInput)
      if (!opened.ok) throw new Error(opened.message)
      ownedSessionId = opened.session.id
      if (cancelled) {
        void host.releaseSession(opened.session.id)
        return
      }

      const connected = await describeScientificObjectMolecularSession({
        host,
        sessionId: opened.session.id,
        expectedPath: target.path
      })
      if (!connected.ok) throw new Error(connected.message)
      if (!cancelled) setConnectionState(connected.state)
    }

    void connect().catch((error) => {
      if (cancelled) return
      const failed: ScientificObjectMolecularPreviewState = {
        kind: 'error',
        title: 'Molecular preview unavailable',
        message: messageFromError(error)
      }
      setConnectionState(failed)
      setRenderState(failed)
    })

    return () => {
      cancelled = true
      if (ownedSessionId) void host.releaseSession(ownedSessionId)
    }
  }, [host, object, target])

  useEffect(() => {
    const viewport = viewportRef.current
    if (connectionState.kind !== 'ready' || !viewport) return undefined

    const renderable = resolveMolecularRenderableAsset({
      asset: connectionState.asset,
      observation: connectionState.observation,
      sourceUrl: connectionState.sourceUrl,
      maxBytes: MOLECULAR_WORKBENCH_MAX_DATA_BYTES
    })
    if (!renderable.ok) {
      setRenderState({
        kind: renderable.kind ?? 'fallback',
        title: 'Interactive preview unavailable',
        message: renderable.reason
      })
      return undefined
    }

    let cancelled = false
    let handle: MolecularWorkbenchRendererHandle | null = null
    let resizeObserver: ResizeObserver | null = null
    const mount = document.createElement('div')
    mount.className = 'absolute inset-0 min-h-0 overflow-hidden'
    mount.dataset.scientificObjectMolstarMount = 'true'
    viewport.replaceChildren(mount)
    setRenderState(createLoadingState(
      'Starting Mol*',
      `Loading ${renderable.byteLength} bytes through workspace preview transport.`
    ))

    void loadScientificObjectMolecularSource({
      renderable,
      host,
      sessionId: connectionState.sessionId
    })
      .then(async (source) => {
        if (cancelled) return
        if (!source.ok) throw new Error(source.message)
        handle = await workbenchRenderer({
          element: mount,
          source: source.source,
          selection: latestSelectionRef.current
        })
        if (cancelled) {
          handle.dispose()
          return
        }
        rendererHandleRef.current = handle
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => handle?.resize())
          resizeObserver.observe(viewport)
        }
        setRenderState({
          kind: 'ready',
          title: 'Interactive molecular preview',
          message: 'Interactive Mol* preview ready.'
        })
      })
      .catch((error) => {
        if (cancelled) return
        setRenderState({
          kind: 'error',
          title: 'Mol* render failed',
          message: messageFromError(error)
        })
      })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      if (rendererHandleRef.current === handle) rendererHandleRef.current = null
      handle?.dispose()
      mount.remove()
    }
  }, [connectionState, host, workbenchRenderer])

  const chains = compactStrings(
    connectionState.kind === 'ready'
      ? connectionState.observation?.molecular?.chains
      : object.observation?.molecular?.chains
  )
  const ligands = compactStrings(
    connectionState.kind === 'ready'
      ? connectionState.observation?.molecular?.ligands
      : object.observation?.molecular?.ligands
  )
  const showOverlay = renderState.kind !== 'ready'

  const chooseSelection = (nextSelection: MolecularSelection): void => {
    setLocalSelection(nextSelection)
    onSelectionChange?.(nextSelection)
  }

  return (
    <section
      className={compactClassName(
        'scientific-object-molecular-preview overflow-hidden rounded-md border border-ds-border bg-white',
        className
      )}
      aria-label={`Interactive molecular preview for ${object.title}`}
      data-scientific-object-molecular-preview
      data-preview-state={renderState.kind}
    >
      <div
        className="relative h-64 min-h-48 overflow-hidden"
        role="img"
        aria-label={`Mol* structure preview for ${object.title}`}
        data-scientific-object-molecular-viewport
      >
        <div ref={viewportRef} className="absolute inset-0" />
        {showOverlay ? (
          <div
            className="absolute inset-0 flex flex-col justify-center gap-1 bg-ds-panel/95 p-4 text-sm text-ds-text"
            role={renderState.kind === 'error' ? 'alert' : 'status'}
          >
            <strong>{renderState.title}</strong>
            <span>{renderState.message}</span>
          </div>
        ) : (
          <span className="sr-only">{renderState.message}</span>
        )}
      </div>

      {chains.length || ligands.length ? (
        <div
          className="flex flex-wrap items-center gap-1 border-t border-ds-border-muted bg-ds-surface px-2 py-1.5"
          aria-label="Molecular quick selection"
          data-scientific-object-molecular-selection-controls
        >
          {chains.map((chain) => (
            <button
              key={`chain:${chain}`}
              type="button"
              className="rounded border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-ink"
              aria-pressed={localSelection?.chains?.includes(chain) ?? false}
              data-molecular-select-chain={chain}
              onClick={() => chooseSelection(createScientificObjectMolecularChainSelection(chain))}
            >
              Chain {chain}
            </button>
          ))}
          {ligands.map((ligand) => (
            <button
              key={`ligand:${ligand}`}
              type="button"
              className="rounded border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-ink"
              aria-pressed={localSelection?.ligands?.includes(ligand) ?? false}
              data-molecular-select-ligand={ligand}
              onClick={() => chooseSelection(createScientificObjectMolecularLigandSelection(ligand))}
            >
              {ligand}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

async function describeScientificObjectMolecularSession(input: {
  host: WorkspacePreviewHost
  sessionId: string
  expectedPath: string
}): Promise<
  | { ok: true; state: Extract<ScientificObjectMolecularPreviewState, { kind: 'ready' }> }
  | { ok: false; message: string }
> {
  const [observed, described] = await Promise.all([
    input.host.observe(input.sessionId),
    input.host.describeAsset(input.sessionId)
  ])
  if (!described.ok) return described
  if (!observed.ok) return observed
  if (described.descriptor.modality !== 'molecular') {
    return {
      ok: false,
      message: 'The referenced workspace preview session is not molecular.'
    }
  }
  if (observed.observation.file.path !== input.expectedPath) {
    return {
      ok: false,
      message: 'The referenced workspace preview session points to a different file.'
    }
  }

  return {
    ok: true,
    state: {
      kind: 'ready',
      title: 'Molecular preview ready',
      message: 'Preparing the interactive Mol* viewport.',
      sessionId: input.sessionId,
      asset: described.descriptor,
      observation: observed.observation,
      sourceUrl: input.host.assetSourceUrl(input.sessionId)
    }
  }
}

async function loadScientificObjectMolecularSource(input: {
  renderable: Extract<ReturnType<typeof resolveMolecularRenderableAsset>, { ok: true }>
  host: WorkspacePreviewHost
  sessionId: string
}): Promise<
  | { ok: true; source: MolecularMolstarRenderableSource }
  | { ok: false; message: string }
> {
  if (input.renderable.source.kind === 'url') {
    return { ok: true, source: input.renderable.source }
  }

  const text = await readMolecularRenderableAssetText({
    byteLength: input.renderable.byteLength,
    readRange: (range) => input.host.readRange(input.sessionId, range)
  })
  if (!text.ok) return { ok: false, message: text.reason }

  return {
    ok: true,
    source: {
      ...input.renderable.source,
      text: text.text
    }
  }
}

function createLoadingState(title: string, message: string): ScientificObjectMolecularPreviewState {
  return { kind: 'loading', title, message }
}

function createFallbackState(message: string): ScientificObjectMolecularPreviewState {
  return {
    kind: 'fallback',
    title: 'Static molecular card',
    message
  }
}

function compactStrings(values: string[] | null | undefined): string[] {
  return Array.from(new Set(
    (values ?? []).map((value) => value.trim()).filter(Boolean)
  ))
}

function compactClassName(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'The molecular preview could not be loaded.'
}

export default ScientificObjectMolecularPreview
