import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { Crosshair, Tags, X } from 'lucide-react'
import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewByteRange,
  type WorkspacePreviewEditOperation,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { WorkspacePreviewReadRangeResult } from '@shared/sciforge-api'
import {
  molecularMolstarFormatForPath,
  renderMolecularWorkbenchWithMolstar,
  resolveMolecularMolstarSource,
  type MolecularMolstarRenderableSource,
  type MolecularWorkbenchRenderer,
  type MolecularWorkbenchRendererHandle
} from './molecular-molstar'

type MolecularStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>

export type MolecularWorkspaceViewerApplyEditOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'molecular.setSelection' }
>

export type MolecularWorkspaceViewerApplyEditHandler = (
  operation: MolecularWorkspaceViewerApplyEditOperation
) => Promise<void> | void

export type MolecularWorkspaceViewerReadRange = (
  range: WorkspacePreviewByteRange
) => Promise<WorkspacePreviewReadRangeResult>

export const MOLECULAR_WORKBENCH_MAX_DATA_BYTES = WORKSPACE_PREVIEW_MAX_RANGE_BYTES

export type MolecularWorkspaceViewerStatus =
  | { kind: 'ready'; title: string; message: string }
  | { kind: 'empty'; title: string; message: string }
  | { kind: 'unsupported'; title: string; message: string }

export type MolecularWorkspaceViewerRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type MolecularWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type MolecularWorkspaceViewerSelectionModel = {
  kind: 'none' | 'molecular' | 'unsupported'
  summary: string
  groups: MolecularWorkspaceViewerGroup[]
}

export type MolecularWorkspaceViewerCapabilities = {
  structure: boolean
  density: boolean
  trajectory: boolean
  selection: boolean
  measurements: boolean
  screenshot: boolean
}

export type MolecularWorkspaceViewerModel = {
  status: MolecularWorkspaceViewerStatus
  title: string
  subtitle?: string
  agentSummary: string
  structureRows: MolecularWorkspaceViewerRow[]
  selection: MolecularWorkspaceViewerSelectionModel
  capabilities: MolecularWorkspaceViewerCapabilities
}

export type MolecularWorkspaceViewerRenderState = {
  kind: 'idle' | 'loading' | 'ready' | 'fallback' | 'error'
  title: string
  message: string
}

export type MolecularWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: MolecularWorkspaceViewerModel
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  assetStatus?: 'idle' | 'loading' | 'ready' | 'error'
  assetError?: string | null
  sourceUrl?: string | null
  readRange?: MolecularWorkspaceViewerReadRange
  workbenchRenderer?: MolecularWorkbenchRenderer
  onApplyEdit?: MolecularWorkspaceViewerApplyEditHandler
  className?: string
}

export type MolecularRenderableAsset =
  | {
      ok: true
      source: MolecularMolstarRenderableSource
      byteLength: number
    }
  | {
      ok: false
      reason: string
      kind?: 'fallback' | 'error'
    }

export function buildMolecularWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): MolecularWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No molecular observation',
      message: 'Open a molecular workspace preview to activate the Mol* workbench.'
    })
  }

  const hasMolecularContext = observation.view.modality === 'molecular' ||
    Boolean(observation.molecular) ||
    observation.selection?.kind === 'molecular'

  if (!hasMolecularContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the molecular workbench.`
    }, observation)
  }

  const selection = buildMolecularSelectionModel(observation.selection)
  const structureRows = buildMolecularStructureRows(observation, selection)
  const capabilities = buildMolecularCapabilities(observation)

  return {
    status: {
      kind: 'ready',
      title: 'Mol* workbench ready',
      message: 'Interactive molecular workbench is available.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Molecular structure',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    agentSummary: buildAgentSummary({ observation, selection, capabilities }),
    structureRows,
    selection,
    capabilities
  }
}

export function MolecularWorkspaceViewer({
  observation,
  model,
  asset,
  assetStatus = 'idle',
  assetError,
  sourceUrl,
  readRange,
  workbenchRenderer = renderMolecularWorkbenchWithMolstar,
  onApplyEdit,
  className
}: MolecularWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildMolecularWorkspaceViewerModel(observation)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const renderContainerRef = useRef<HTMLDivElement | null>(null)

  const renderState = useMolecularWorkbenchRender({
    containerRef: renderContainerRef,
    observation,
    asset,
    assetStatus,
    assetError,
    sourceUrl,
    readRange,
    workbenchRenderer,
    enabled: resolvedModel.status.kind === 'ready'
  })

  return (
    <section
      className={compactClassName('workspace-preview-molecular-viewer flex h-full min-h-0 flex-col gap-3', className)}
      data-workspace-preview-molecular-viewer
      data-molecular-workbench
      data-status={resolvedModel.status.kind}
      data-molecular-render-state={renderState.kind}
      data-molecular-capability-structure={resolvedModel.capabilities.structure ? 'true' : 'false'}
      data-molecular-capability-density={resolvedModel.capabilities.density ? 'true' : 'false'}
      data-molecular-capability-trajectory={resolvedModel.capabilities.trajectory ? 'true' : 'false'}
      data-molecular-capability-selection={resolvedModel.capabilities.selection ? 'true' : 'false'}
      data-molecular-capability-measurements={resolvedModel.capabilities.measurements ? 'true' : 'false'}
      data-molecular-capability-screenshot={resolvedModel.capabilities.screenshot ? 'true' : 'false'}
    >
      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-molecular-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <div className="grid h-full min-h-0 flex-1 grid-rows-[minmax(18rem,1fr)_minmax(8rem,14rem)] overflow-hidden gap-3">
          <div
            className="workspace-preview-molecular-viewer__viewport relative h-full min-h-0 overflow-hidden rounded-md border border-ds-border bg-white"
            data-webgl-viewport
            role="img"
            aria-label="Mol* molecular structure workbench"
          >
            <div
              ref={renderContainerRef}
              className="absolute inset-0 min-h-0 overflow-hidden"
              data-molecular-render-container
            />
            {renderState.kind !== 'ready' ? (
              <div className="absolute inset-0 flex flex-col justify-center gap-2 bg-ds-panel/90 p-4 text-sm text-ds-text">
                <strong>{renderState.title}</strong>
                <p>{renderState.message}</p>
              </div>
            ) : (
              <span className="sr-only">{renderState.message}</span>
            )}
          </div>

          <aside
            className="workspace-preview-molecular-viewer__inspector flex min-h-0 flex-col gap-3 overflow-auto rounded-md border border-ds-border bg-ds-surface p-3"
            aria-label="Molecular workbench inspector"
            data-molecular-workbench-inspector
          >
            <p
              className="workspace-preview-molecular-viewer__agent-summary text-[12px] leading-5 text-ds-muted"
              data-molecular-agent-summary
            >
              {resolvedModel.agentSummary}
            </p>
            <MolecularStructureSummary rows={resolvedModel.structureRows} />
            <MolecularSelectionSummary
              selection={resolvedModel.selection}
              observation={observation}
              onApplyEdit={onApplyEdit}
            />
            <MolecularCapabilitySummary capabilities={resolvedModel.capabilities} />
          </aside>
        </div>
      )}
    </section>
  )
}

export function createMolecularSelectionOperation(
  observation: WorkspaceObservation,
  selection: MolecularStructuredSelection
): MolecularWorkspaceViewerApplyEditOperation {
  return {
    kind: 'molecular.setSelection',
    path: observation.file.path,
    selection
  }
}

export function createMolecularChainSelectionOperation(
  observation: WorkspaceObservation,
  chain: string
): MolecularWorkspaceViewerApplyEditOperation {
  return createMolecularSelectionOperation(observation, {
    kind: 'molecular',
    chains: [chain]
  })
}

export function createMolecularLigandSelectionOperation(
  observation: WorkspaceObservation,
  ligand: string
): MolecularWorkspaceViewerApplyEditOperation {
  return createMolecularSelectionOperation(observation, {
    kind: 'molecular',
    ligands: [ligand]
  })
}

export function createMolecularClearSelectionOperation(
  observation: WorkspaceObservation
): MolecularWorkspaceViewerApplyEditOperation {
  return createMolecularSelectionOperation(observation, {
    kind: 'molecular'
  })
}

export function resolveMolecularRenderableAsset(input: {
  asset: WorkspacePreviewAssetTransportDescriptor
  observation?: WorkspaceObservation | null
  sourceUrl?: string | null
  maxBytes?: number
}): MolecularRenderableAsset {
  const path = input.asset.file.relativePath || input.asset.file.name || input.observation?.file.path || ''
  const resolved = resolveMolecularMolstarSource({
    path,
    byteLength: input.asset.range.size,
    rangeAvailable: input.sourceUrl ? true : input.asset.range.available,
    maxStructureBytes: input.sourceUrl ? Number.MAX_SAFE_INTEGER : input.maxBytes ?? MOLECULAR_WORKBENCH_MAX_DATA_BYTES
  })

  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      kind: resolved.reason.includes('paired topology') ? 'fallback' : undefined
    }
  }

  if (input.sourceUrl) {
    return {
      ok: true,
      byteLength: resolved.byteLength,
      source: {
        kind: 'url',
        url: input.sourceUrl,
        label: basename(path),
        format: resolved.format
      }
    }
  }

  if (resolved.format.kind !== 'structure') {
    return {
      ok: false,
      kind: 'fallback',
      reason: 'Mol* density and trajectory loading requires a workspace asset URL for binary transport.'
    }
  }

  return {
    ok: true,
    byteLength: resolved.byteLength,
    source: {
      kind: 'data',
      text: '',
      label: basename(path),
      format: resolved.format
    }
  }
}

export function molecularWorkbenchSourceIdentity(input: {
  observationPath?: string
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  sourceUrl?: string | null
  rangeReaderAvailable: boolean
}): string {
  const { asset } = input
  return JSON.stringify([
    input.observationPath ?? null,
    asset?.sessionId ?? null,
    asset?.assetId ?? null,
    asset?.file.relativePath ?? null,
    asset?.file.name ?? null,
    asset?.file.mimeType ?? null,
    asset?.range.available ?? false,
    asset?.range.size ?? null,
    input.sourceUrl ?? null,
    input.rangeReaderAvailable
  ])
}

export function activateMolecularWorkbenchRendererHandle(
  handleRef: { current: MolecularWorkbenchRendererHandle | null },
  handle: MolecularWorkbenchRendererHandle,
  selection?: MolecularStructuredSelection
): void {
  handleRef.current = handle
  handle.setSelection(selection)
}

export async function readMolecularRenderableAssetText(input: {
  byteLength: number
  readRange: MolecularWorkspaceViewerReadRange
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const result = await input.readRange({
    offset: 0,
    length: input.byteLength
  })
  if (!result.ok) {
    return {
      ok: false,
      reason: result.message
    }
  }
  if (result.length < input.byteLength) {
    return {
      ok: false,
      reason: `Only ${result.length} of ${input.byteLength} bytes were read; refusing to load a truncated molecular model.`
    }
  }
  return {
    ok: true,
    text: decodeWorkspacePreviewBase64Text(result.dataBase64)
  }
}

export function decodeWorkspacePreviewBase64Text(dataBase64: string): string {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function useMolecularWorkbenchRender(input: {
  containerRef: RefObject<HTMLDivElement | null>
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  assetStatus: MolecularWorkspaceViewerProps['assetStatus']
  assetError?: string | null
  sourceUrl?: string | null
  readRange?: MolecularWorkspaceViewerReadRange
  workbenchRenderer: MolecularWorkbenchRenderer
  enabled: boolean
}): MolecularWorkspaceViewerRenderState {
  const {
    containerRef,
    observation,
    asset,
    assetStatus,
    assetError,
    sourceUrl,
    readRange,
    workbenchRenderer,
    enabled
  } = input
  const [renderState, setRenderState] = useState<MolecularWorkspaceViewerRenderState>({
    kind: 'idle',
    title: 'Mol* workbench viewport',
    message: 'Waiting for a molecular workspace asset.'
  })
  const rendererHandleRef = useRef<MolecularWorkbenchRendererHandle | null>(null)
  const latestSelectionRef = useRef<MolecularStructuredSelection | undefined>(
    molecularSelectionFromObservation(observation)
  )

  const assetRef = useRef(asset)
  const observationRef = useRef(observation)
  const readRangeRef = useRef(readRange)
  const workbenchRendererRef = useRef(workbenchRenderer)
  assetRef.current = asset
  observationRef.current = observation
  readRangeRef.current = readRange
  workbenchRendererRef.current = workbenchRenderer
  const selection = molecularSelectionFromObservation(observation)
  const selectionSignature = JSON.stringify(selection ?? null)
  latestSelectionRef.current = selection
  const sourceIdentity = molecularWorkbenchSourceIdentity({
    observationPath: observation?.file.path,
    asset,
    sourceUrl,
    rangeReaderAvailable: Boolean(readRange)
  })

  useEffect(() => {
    rendererHandleRef.current?.setSelection(latestSelectionRef.current)
  }, [selectionSignature])

  useEffect(() => {
    const container = containerRef.current
    if (!enabled) {
      setRenderState({
        kind: 'idle',
        title: 'Mol* workbench viewport',
        message: 'Waiting for a molecular observation.'
      })
      return undefined
    }

    if (assetStatus === 'error') {
      setRenderState({
        kind: 'error',
        title: 'Molecular asset unavailable',
        message: assetError || 'The molecular asset could not be described.'
      })
      return undefined
    }

    if (assetStatus !== 'ready') {
      setRenderState({
        kind: 'loading',
        title: 'Loading molecular asset',
        message: 'Waiting for workspace asset transport before starting Mol*.'
      })
      return undefined
    }

    const activeAsset = assetRef.current
    const activeReadRange = readRangeRef.current
    const activeWorkbenchRenderer = workbenchRendererRef.current
    if (!activeAsset || (!sourceUrl && !activeReadRange)) {
      setRenderState({
        kind: 'fallback',
        title: 'Molecular summary only',
        message: 'The molecular summary is available, but source transport for Mol* is not connected.'
      })
      return undefined
    }

    if (!container) {
      setRenderState({
        kind: 'loading',
        title: 'Preparing Mol* viewport',
        message: 'Waiting for the workbench container to mount.'
      })
      return undefined
    }

    const renderable = resolveMolecularRenderableAsset({
      asset: activeAsset,
      observation: observationRef.current,
      sourceUrl
    })
    if (!renderable.ok) {
      setRenderState({
        kind: renderable.kind ?? 'fallback',
        title: 'Mol* workbench unavailable',
        message: renderable.reason
      })
      return undefined
    }

    let cancelled = false
    let handle: MolecularWorkbenchRendererHandle | null = null
    let resizeObserver: ResizeObserver | null = null
    const mount = document.createElement('div')
    mount.className = 'absolute inset-0 min-h-0 overflow-hidden'
    mount.dataset.molecularMolstarMount = 'true'
    container.replaceChildren(mount)
    setRenderState({
      kind: 'loading',
      title: 'Starting Mol* workbench',
      message: `Loading ${renderable.byteLength} bytes through workspace preview transport.`
    })

    void loadRenderableSource({
      renderable,
      readRange: activeReadRange
    })
      .then(async (source) => {
        if (cancelled) return
        if (!source.ok) {
          setRenderState({
            kind: 'error',
            title: 'Mol* source load failed',
            message: source.reason
          })
          return
        }

        setRenderState({
          kind: 'loading',
          title: 'Initializing Mol*',
          message: 'Mol* is creating the molecular workbench.'
        })
        handle = await activeWorkbenchRenderer({
          element: mount,
          source: source.source,
          selection: latestSelectionRef.current
        })
        if (cancelled) {
          handle.dispose()
          return
        }
        // Selection may change while the async Mol* renderer is initializing.
        // The selection effect cannot reach the handle until this point, so
        // replay the latest value once the handle becomes active.
        activateMolecularWorkbenchRendererHandle(
          rendererHandleRef,
          handle,
          latestSelectionRef.current
        )
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => handle?.resize())
          resizeObserver.observe(container)
        }
        setRenderState({
          kind: 'ready',
          title: 'Mol* workbench rendered',
          message: 'Interactive molecular workbench rendered with Mol*.'
        })
      })
      .catch((error) => {
        if (cancelled) return
        setRenderState({
          kind: 'error',
          title: 'Mol* render failed',
          message: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      if (rendererHandleRef.current === handle) {
        rendererHandleRef.current = null
      }
      handle?.dispose()
      mount.remove()
    }
  }, [
    assetError,
    assetStatus,
    containerRef,
    enabled,
    sourceIdentity,
    sourceUrl,
  ])

  return renderState
}

async function loadRenderableSource(input: {
  renderable: Extract<MolecularRenderableAsset, { ok: true }>
  readRange?: MolecularWorkspaceViewerReadRange
}): Promise<{ ok: true; source: MolecularMolstarRenderableSource } | { ok: false; reason: string }> {
  const { source } = input.renderable
  if (source.kind === 'url') return { ok: true, source }

  if (!input.readRange) {
    return {
      ok: false,
      reason: 'No byte-range reader is available for the molecular source.'
    }
  }

  const text = await readMolecularRenderableAssetText({
    byteLength: input.renderable.byteLength,
    readRange: input.readRange
  })
  if (!text.ok) return text

  return {
    ok: true,
    source: {
      ...source,
      text: text.text
    }
  }
}

function MolecularStructureSummary({
  rows
}: {
  rows: MolecularWorkspaceViewerRow[]
}): ReactNode {
  return (
    <section
      className="workspace-preview-molecular-viewer__section rounded-[8px] border border-ds-border-muted p-2"
      aria-label="Molecular structure summary"
      data-molecular-structure-summary
    >
      <h4 className="mb-2 text-[12px] font-semibold text-ds-ink">Structure</h4>
      <dl className="grid gap-1.5">
        {rows.map((row) => (
          <div key={row.id} data-molecular-structure-row={row.id}>
            <dt className="text-[11px] font-semibold uppercase text-ds-faint">{row.label}</dt>
            <dd className="text-[12px] text-ds-ink">
              {row.value}
              {row.description ? <small className="block text-[11.5px] text-ds-muted">{row.description}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function MolecularSelectionSummary({
  selection,
  observation,
  onApplyEdit
}: {
  selection: MolecularWorkspaceViewerSelectionModel
  observation?: WorkspaceObservation | null
  onApplyEdit?: MolecularWorkspaceViewerApplyEditHandler
}): ReactNode {
  return (
    <section
      className="workspace-preview-molecular-viewer__section rounded-[8px] border border-ds-border-muted p-2"
      aria-label="Molecular selection"
      data-selection-kind={selection.kind}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold text-ds-ink">Selection</h4>
        <MolecularSelectionControls
          observation={observation}
          onApplyEdit={onApplyEdit}
        />
      </div>
      <p className="text-[12px] text-ds-muted">{selection.summary}</p>
      {selection.groups.length ? (
        <dl className="mt-2 grid gap-1.5">
          {selection.groups.map((group) => (
            <div key={group.id}>
              <dt className="text-[11px] font-semibold uppercase text-ds-faint">{group.title}</dt>
              <dd className="text-[12px] text-ds-ink">
                {group.items.join(', ')}
                <small className="block text-[11.5px] text-ds-muted">{group.summary}</small>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

function MolecularSelectionControls({
  observation,
  onApplyEdit
}: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: MolecularWorkspaceViewerApplyEditHandler
}): ReactNode {
  const chains = compactStrings(observation?.molecular?.chains)
  const ligands = compactStrings(observation?.molecular?.ligands)
  const hasSelection = hasMolecularSelection(observation?.selection)

  if (!chains.length && !ligands.length && !hasSelection) return null

  const disabled = !observation || !onApplyEdit
  const applyOperation = (operation: MolecularWorkspaceViewerApplyEditOperation) => {
    if (disabled) return
    void onApplyEdit?.(operation)
  }

  return (
    <div
      className="workspace-preview-molecular-viewer__selection-controls flex flex-wrap justify-end gap-1"
      data-molecular-selection-controls
    >
      {chains.map((chain) => (
        <button
          key={`chain:${chain}`}
          type="button"
          className="inline-flex items-center gap-1 rounded border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-ink disabled:opacity-60"
          disabled={disabled}
          data-molecular-select-chain={chain}
          onClick={() => {
            if (!observation) return
            applyOperation(createMolecularChainSelectionOperation(observation, chain))
          }}
        >
          <Crosshair aria-hidden="true" size={12} />
          <span>Chain {chain}</span>
        </button>
      ))}
      {ligands.map((ligand) => (
        <button
          key={`ligand:${ligand}`}
          type="button"
          className="inline-flex items-center gap-1 rounded border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-ink disabled:opacity-60"
          disabled={disabled}
          data-molecular-select-ligand={ligand}
          onClick={() => {
            if (!observation) return
            applyOperation(createMolecularLigandSelectionOperation(observation, ligand))
          }}
        >
          <Tags aria-hidden="true" size={12} />
          <span>{ligand}</span>
        </button>
      ))}
      {hasSelection ? (
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-ds-border-muted text-ds-ink disabled:opacity-60"
          aria-label="Clear molecular selection"
          disabled={disabled}
          data-molecular-clear-selection
          onClick={() => {
            if (!observation) return
            applyOperation(createMolecularClearSelectionOperation(observation))
          }}
        >
          <X aria-hidden="true" size={13} />
        </button>
      ) : null}
    </div>
  )
}

function MolecularCapabilitySummary({
  capabilities
}: {
  capabilities: MolecularWorkspaceViewerCapabilities
}): ReactNode {
  const rows: Array<{ id: keyof MolecularWorkspaceViewerCapabilities; label: string; active: boolean }> = [
    { id: 'structure', label: 'Structure', active: capabilities.structure },
    { id: 'density', label: 'Density', active: capabilities.density },
    { id: 'trajectory', label: 'Trajectory', active: capabilities.trajectory },
    { id: 'selection', label: 'Selection', active: capabilities.selection },
    { id: 'measurements', label: 'Measurements', active: capabilities.measurements },
    { id: 'screenshot', label: 'Screenshot', active: capabilities.screenshot }
  ]

  return (
    <section
      className="workspace-preview-molecular-viewer__section rounded-[8px] border border-ds-border-muted p-2"
      aria-label="Mol* capabilities"
      data-molecular-capability-summary
    >
      <h4 className="mb-2 text-[12px] font-semibold text-ds-ink">Mol*</h4>
      <ul className="grid grid-cols-2 gap-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded border border-ds-border-muted px-1.5 py-1 text-[11px] text-ds-ink"
            data-molecular-capability={row.id}
            data-enabled={row.active ? 'true' : 'false'}
          >
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function molecularSelectionFromObservation(
  observation: WorkspaceObservation | null | undefined
): MolecularStructuredSelection | undefined {
  return observation?.selection?.kind === 'molecular' ? observation.selection : undefined
}

function hasMolecularSelection(selection: WorkspaceStructuredSelection | undefined): boolean {
  if (selection?.kind !== 'molecular') return false
  return Boolean(
    selection.chains?.length ||
    selection.residues?.length ||
    selection.atoms?.length ||
    selection.ligands?.length
  )
}

function createInactiveModel(
  status: Extract<MolecularWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): MolecularWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Molecular workbench',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    agentSummary: status.message,
    structureRows: [],
    selection: {
      kind: 'none',
      summary: 'File opened at whole-structure scope; no precise molecular selection was provided.',
      groups: []
    },
    capabilities: {
      structure: false,
      density: false,
      trajectory: false,
      selection: false,
      measurements: false,
      screenshot: false
    }
  }
}

function buildMolecularCapabilities(observation: WorkspaceObservation): MolecularWorkspaceViewerCapabilities {
  const format = molecularMolstarFormatForPath(observation.file.path)
  const hasStructureSummary = Boolean(observation.molecular) ||
    observation.selection?.kind === 'molecular' ||
    observation.view.modality === 'molecular'
  const structure = format ? format.kind === 'structure' : hasStructureSummary
  const density = format?.kind === 'volume'
  const trajectory = format?.kind === 'trajectory-coordinates'

  return {
    structure,
    density,
    trajectory,
    selection: structure,
    measurements: structure,
    screenshot: structure || density || trajectory
  }
}

function buildMolecularStructureRows(
  observation: WorkspaceObservation,
  selection: MolecularWorkspaceViewerSelectionModel
): MolecularWorkspaceViewerRow[] {
  const molecular = observation.molecular
  const molecularSelection = observation.selection?.kind === 'molecular' ? observation.selection : undefined
  const selectedChains = molecularSelection?.chains ?? []
  const selectedResidues = molecularSelection?.residues?.map(formatResidue) ?? []
  const selectedLigands = molecularSelection?.ligands ?? []
  const selectedElements = collectSelectedElements(molecularSelection)
  const rows: MolecularWorkspaceViewerRow[] = []

  if (typeof molecular?.modelCount === 'number') {
    rows.push(row('models', 'Models', String(molecular.modelCount)))
  }

  rows.push(row(
    'chains',
    'Chains',
    joinList(molecular?.chains),
    selectedChains.length ? `Selected: ${joinList(selectedChains)}` : undefined
  ))
  rows.push(row(
    'residues',
    'Residues',
    selectedResidues.length ? formatCount(selectedResidues.length, 'selected residue') : 'Not reported',
    selectedResidues.length ? selectedResidues.join(', ') : undefined
  ))
  rows.push(row(
    'ligands',
    'Ligands',
    joinList(molecular?.ligands),
    selectedLigands.length ? `Selected: ${joinList(selectedLigands)}` : undefined
  ))
  rows.push(row(
    'elements',
    'Elements',
    selectedElements.length ? joinList(selectedElements) : 'Not reported',
    selectedElements.length ? 'From selected atoms.' : undefined
  ))

  if (molecular?.representations?.length) {
    rows.push(row('representations', 'Representations', joinList(molecular.representations)))
  }

  if (!molecular && selection.kind === 'none') {
    rows.push(row('summary', 'Summary', 'No molecular structure summary reported yet.'))
  }

  return rows
}

function buildMolecularSelectionModel(
  selection: WorkspaceStructuredSelection | undefined
): MolecularWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'File opened at whole-structure scope; no precise molecular selection was provided.',
      groups: []
    }
  }

  if (selection.kind !== 'molecular') {
    return {
      kind: 'unsupported',
      summary: `File opened, but the ${titleCase(selection.kind)} anchor cannot be mapped to chains, residues, atoms, or ligands.`,
      groups: []
    }
  }

  const selectedElements = collectSelectedElements(selection)
  const groups = compactGroups([
    createSelectionGroup('chains', 'Selected chains', selection.chains),
    createSelectionGroup('residues', 'Selected residues', selection.residues?.map(formatResidue)),
    createSelectionGroup('atoms', 'Selected atoms', selection.atoms?.map(formatAtom)),
    createSelectionGroup('ligands', 'Selected ligands', selection.ligands),
    createSelectionGroup('elements', 'Selected elements', selectedElements)
  ])
  const summaryParts = compactStrings([
    selection.chains?.length ? formatCount(selection.chains.length, 'chain') : undefined,
    selection.residues?.length ? formatCount(selection.residues.length, 'residue') : undefined,
    selection.atoms?.length ? formatCount(selection.atoms.length, 'atom') : undefined,
    selection.ligands?.length ? formatCount(selection.ligands.length, 'ligand') : undefined,
    selectedElements.length ? formatCount(selectedElements.length, 'element') : undefined
  ])

  return {
    kind: 'molecular',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Molecular selection is empty.',
    groups
  }
}

function buildAgentSummary(input: {
  observation: WorkspaceObservation
  selection: MolecularWorkspaceViewerSelectionModel
  capabilities: MolecularWorkspaceViewerCapabilities
}): string {
  const { observation, selection, capabilities } = input
  const molecular = observation.molecular
  const enabledCapabilities = Object.entries(capabilities)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)

  const parts = compactStrings([
    typeof molecular?.modelCount === 'number' ? formatCount(molecular.modelCount, 'model') : undefined,
    molecular?.chains?.length ? `${formatCount(molecular.chains.length, 'chain')}: ${joinList(molecular.chains)}` : undefined,
    molecular?.ligands?.length ? `${formatCount(molecular.ligands.length, 'ligand')}: ${joinList(molecular.ligands)}` : undefined,
    selection.kind === 'molecular' ? `selection: ${selection.summary}` : undefined,
    enabledCapabilities.length ? `Mol* capabilities: ${enabledCapabilities.join(', ')}` : undefined
  ])

  return parts.length ? parts.join('; ') : 'Molecular observation ready without reported structure details.'
}

function createSelectionGroup(
  id: string,
  title: string,
  items: readonly string[] | undefined
): MolecularWorkspaceViewerGroup | null {
  const normalized = compactStrings(items)
  if (!normalized.length) return null

  return {
    id,
    title,
    summary: formatCount(normalized.length, title.replace(/^Selected /, '').replace(/s$/, '')),
    items: normalized
  }
}

function collectSelectedElements(selection: MolecularStructuredSelection | undefined): string[] {
  return uniqueStrings(selection?.atoms?.map((atom) => atom.element).filter(Boolean) ?? [])
}

function formatResidue(residue: NonNullable<MolecularStructuredSelection['residues']>[number]): string {
  const index = `${residue.index}${residue.insertionCode ?? ''}`
  const location = residue.chain ? `${residue.chain}:${index}` : index
  return compactStrings([residue.name, location]).join(' ')
}

function formatAtom(atom: NonNullable<MolecularStructuredSelection['atoms']>[number]): string {
  const parts = compactStrings([
    atom.element,
    typeof atom.index === 'number' ? `#${atom.index}` : undefined,
    atom.id
  ])
  return parts.length ? parts.join(' ') : 'Unlabeled atom'
}

function row(
  id: string,
  label: string,
  value: string,
  description?: string
): MolecularWorkspaceViewerRow {
  return { id, label, value, description }
}

function compactGroups(
  groups: Array<MolecularWorkspaceViewerGroup | null | undefined>
): MolecularWorkspaceViewerGroup[] {
  return groups.filter((group): group is MolecularWorkspaceViewerGroup => Boolean(group))
}

function compactStrings(values: readonly (string | null | undefined | false)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(compactStrings(values))]
}

function joinList(values: readonly string[] | undefined): string {
  const compacted = compactStrings(values)
  return compacted.length ? compacted.join(', ') : 'Not reported'
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatModality(modality: string): string {
  return titleCase(modality.replace(/[-_]/g, ' '))
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function compactClassName(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
