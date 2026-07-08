import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import {
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewByteRange,
  type WorkspacePreviewEditOperation,
  type WorkspaceObservation,
  type WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { WorkspacePreviewReadRangeResult } from '@shared/sciforge-api'
import {
  molecular3DmolFormatForPath,
  molecularRepresentationModeForObservation,
  MOLECULAR_REPRESENTATION_MODES,
  renderMolecularStructureWith3Dmol,
  type Molecular3DmolFormat,
  type MolecularRepresentationMode,
  type MolecularStructureRenderer,
  type MolecularStructureRendererHandle
} from './molecular-3dmol'

type MolecularStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
export type MolecularWorkspaceViewerApplyEditOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'molecular.setSelection' }
>
export type MolecularWorkspaceViewerApplyEditHandler = (
  operation: MolecularWorkspaceViewerApplyEditOperation
) => Promise<void> | void

export const MOLECULAR_VIEWER_MAX_SOURCE_BYTES = Math.min(WORKSPACE_PREVIEW_MAX_RANGE_BYTES, 2_000_000)

export type MolecularWorkspaceViewerStatus =
  | {
      kind: 'ready'
      title: string
      message: string
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }
  | {
      kind: 'unsupported'
      title: string
      message: string
    }

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

export type MolecularWorkspaceViewerActionKind = 'select' | 'measure' | 'other'

export type MolecularWorkspaceViewerAction = {
  id: string
  label: string
  kind: MolecularWorkspaceViewerActionKind
}

export type MolecularWorkspaceViewerSelectionModel = {
  kind: 'none' | 'molecular' | 'unsupported'
  summary: string
  groups: MolecularWorkspaceViewerGroup[]
}

export type MolecularWorkspaceViewerModel = {
  status: MolecularWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: {
    title: string
    message: string
  }
  agentSummary: string
  structureRows: MolecularWorkspaceViewerRow[]
  selection: MolecularWorkspaceViewerSelectionModel
  actions: MolecularWorkspaceViewerAction[]
}

export type MolecularWorkspaceViewerReadRange = (
  range: WorkspacePreviewByteRange
) => Promise<WorkspacePreviewReadRangeResult>

export type MolecularWorkspaceViewerRenderState =
  | {
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
  readRange?: MolecularWorkspaceViewerReadRange
  structureRenderer?: MolecularStructureRenderer
  onApplyEdit?: MolecularWorkspaceViewerApplyEditHandler
  className?: string
}

export type MolecularRenderableAsset =
  | {
      ok: true
      format: Molecular3DmolFormat
      byteLength: number
    }
  | {
      ok: false
      reason: string
    }

const MOLECULAR_ACTION_LABELS: Record<string, string> = {
  'workspace.setSelection': 'Select',
  'molecular.select': 'Select Structure',
  'molecular.measureDistance': 'Measure Distance'
}

export function buildMolecularWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): MolecularWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No molecular observation',
      message: 'Open a molecular workspace preview to populate this baseline viewer.'
    })
  }

  const hasMolecularContext = observation.view.modality === 'molecular' ||
    Boolean(observation.molecular) ||
    observation.selection?.kind === 'molecular'

  if (!hasMolecularContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the molecular viewer.`
    }, observation)
  }

  const selection = buildMolecularSelectionModel(observation.selection)
  const structureRows = buildMolecularStructureRows(observation, selection)
  const actions = buildMolecularActions(observation.actions)
  const agentSummary = buildAgentSummary({ observation, selection, actions })

  return {
    status: {
      kind: 'ready',
      title: 'Molecular baseline ready',
      message: 'A future WebGL structure renderer can mount into the placeholder viewport.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Molecular structure',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport: {
      title: 'WebGL viewer mount point',
      message: observation.molecular
        ? 'Structure metadata is ready; 3Dmol/WebGL rendering is intentionally not loaded in this baseline.'
        : 'Waiting for molecular summary metadata from the preview worker.'
    },
    agentSummary,
    structureRows,
    selection,
    actions
  }
}

export function MolecularWorkspaceViewer({
  observation,
  model,
  asset,
  assetStatus = 'idle',
  assetError,
  readRange,
  structureRenderer = renderMolecularStructureWith3Dmol,
  onApplyEdit,
  className
}: MolecularWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildMolecularWorkspaceViewerModel(observation)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const [representation, setRepresentation] = useState<MolecularRepresentationMode>(() =>
    defaultMolecularRepresentationMode(observation)
  )
  const renderContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setRepresentation(defaultMolecularRepresentationMode(observation))
  }, [observation?.file.path])

  const renderState = useMolecularStructureRender({
    containerRef: renderContainerRef,
    observation,
    asset,
    assetStatus,
    assetError,
    readRange,
    structureRenderer,
    representation,
    enabled: resolvedModel.status.kind === 'ready'
  })

  return (
    <section
      className={compactClassName('workspace-preview-molecular-viewer', className)}
      data-workspace-preview-molecular-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-molecular-viewer__header">
        <div>
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

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
        <>
          <MolecularRepresentationControls
            value={representation}
            onChange={setRepresentation}
          />

          <div
            className="workspace-preview-molecular-viewer__viewport relative min-h-80 overflow-hidden rounded-md border border-ds-border bg-white"
            data-webgl-viewport
            data-molecular-render-state={renderState.kind}
            data-molecular-representation={representation}
            role="img"
            aria-label="Molecular structure viewport"
          >
            <div
              ref={renderContainerRef}
              className="absolute inset-0"
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

          <p className="workspace-preview-molecular-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-molecular-viewer__section"
            aria-label="Molecular structure summary"
          >
            <h4>Structure</h4>
            <dl>
              {resolvedModel.structureRows.map((row) => (
                <div key={row.id}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.value}
                    {row.description ? <small>{row.description}</small> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section
            className="workspace-preview-molecular-viewer__section"
            aria-label="Molecular selection"
            data-selection-kind={resolvedModel.selection.kind}
          >
            <h4>Selection</h4>
            <p>{resolvedModel.selection.summary}</p>
            <MolecularSelectionControls
              observation={observation}
              onApplyEdit={onApplyEdit}
            />
            {resolvedModel.selection.groups.length ? (
              <dl>
                {resolvedModel.selection.groups.map((group) => (
                  <div key={group.id}>
                    <dt>{group.title}</dt>
                    <dd>
                      {group.items.join(', ')}
                      <small>{group.summary}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          <section
            className="workspace-preview-molecular-viewer__section"
            aria-label="Molecular actions"
          >
            <h4>Actions</h4>
            {resolvedModel.actions.length ? (
              <ul>
                {resolvedModel.actions.map((action) => (
                  <li
                    key={action.id}
                    data-action-id={action.id}
                    data-action-kind={action.kind}
                  >
                    {action.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No select, measure, or snapshot actions are available.</p>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export function defaultMolecularRepresentationMode(
  observation: WorkspaceObservation | null | undefined
): MolecularRepresentationMode {
  const format = observation ? molecular3DmolFormatForPath(observation.file.path) : null
  return molecularRepresentationModeForObservation(format, observation?.molecular?.representations)
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

function MolecularRepresentationControls({
  value,
  onChange
}: {
  value: MolecularRepresentationMode
  onChange: (value: MolecularRepresentationMode) => void
}): ReactNode {
  return (
    <section
      className="workspace-preview-molecular-viewer__controls"
      aria-label="Molecular representation"
      data-molecular-representation-controls
    >
      {MOLECULAR_REPRESENTATION_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === value}
          data-molecular-representation-option={mode}
          data-selected={mode === value ? 'true' : 'false'}
          onClick={() => onChange(mode)}
        >
          {formatRepresentationModeLabel(mode)}
        </button>
      ))}
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
      className="workspace-preview-molecular-viewer__selection-controls"
      data-molecular-selection-controls
    >
      {chains.map((chain) => (
        <button
          key={`chain:${chain}`}
          type="button"
          disabled={disabled}
          data-molecular-select-chain={chain}
          onClick={() => {
            if (!observation) return
            applyOperation(createMolecularChainSelectionOperation(observation, chain))
          }}
        >
          Chain {chain}
        </button>
      ))}
      {ligands.map((ligand) => (
        <button
          key={`ligand:${ligand}`}
          type="button"
          disabled={disabled}
          data-molecular-select-ligand={ligand}
          onClick={() => {
            if (!observation) return
            applyOperation(createMolecularLigandSelectionOperation(observation, ligand))
          }}
        >
          Ligand {ligand}
        </button>
      ))}
      {hasSelection ? (
        <button
          type="button"
          disabled={disabled}
          data-molecular-clear-selection
          onClick={() => {
            if (!observation) return
            applyOperation(createMolecularClearSelectionOperation(observation))
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
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

function formatRepresentationModeLabel(mode: MolecularRepresentationMode): string {
  switch (mode) {
    case 'cartoon-stick':
      return 'Cartoon + Stick'
    case 'cartoon':
      return 'Cartoon'
    case 'stick':
      return 'Stick'
    case 'ball-stick':
      return 'Ball + Stick'
  }
}

function useMolecularStructureRender(input: {
  containerRef: RefObject<HTMLDivElement | null>
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  assetStatus: MolecularWorkspaceViewerProps['assetStatus']
  assetError?: string | null
  readRange?: MolecularWorkspaceViewerReadRange
  structureRenderer: MolecularStructureRenderer
  representation: MolecularRepresentationMode
  enabled: boolean
}): MolecularWorkspaceViewerRenderState {
  const [renderState, setRenderState] = useState<MolecularWorkspaceViewerRenderState>({
    kind: 'idle',
    title: 'Molecular structure viewport',
    message: 'Waiting for a molecular structure asset.'
  })
  const rendererHandleRef = useRef<MolecularStructureRendererHandle | null>(null)
  const latestRepresentationRef = useRef<MolecularRepresentationMode>(input.representation)
  const latestSelectionRef = useRef<MolecularStructuredSelection | undefined>(
    molecularSelectionFromObservation(input.observation)
  )

  useEffect(() => {
    latestRepresentationRef.current = input.representation
    rendererHandleRef.current?.setRepresentation(input.representation, latestSelectionRef.current)
  }, [input.representation])

  useEffect(() => {
    const selection = molecularSelectionFromObservation(input.observation)
    latestSelectionRef.current = selection
    rendererHandleRef.current?.setSelection(selection, latestRepresentationRef.current)
  }, [input.observation?.selection])

  useEffect(() => {
    if (!input.enabled) {
      setRenderState({
        kind: 'idle',
        title: 'Molecular structure viewport',
        message: 'Waiting for a molecular structure observation.'
      })
      return undefined
    }

    if (input.assetStatus === 'error') {
      setRenderState({
        kind: 'error',
        title: 'Molecular asset unavailable',
        message: input.assetError || 'The molecular structure asset could not be described.'
      })
      return undefined
    }

    if (input.assetStatus !== 'ready') {
      setRenderState({
        kind: 'loading',
        title: 'Loading molecular asset',
        message: 'Waiting for bounded asset transport before rendering the structure.'
      })
      return undefined
    }

    if (!input.asset || !input.readRange) {
      setRenderState({
        kind: 'fallback',
        title: 'Molecular summary only',
        message: 'The structure summary is available, but byte-range rendering is not connected.'
      })
      return undefined
    }

    const renderable = resolveMolecularRenderableAsset({
      asset: input.asset,
      observation: input.observation
    })
    if (!renderable.ok) {
      setRenderState({
        kind: 'fallback',
        title: 'Molecular summary only',
        message: renderable.reason
      })
      return undefined
    }

    const container = input.containerRef.current
    if (!container) {
      setRenderState({
        kind: 'loading',
        title: 'Preparing molecular viewport',
        message: 'Waiting for the WebGL container to mount.'
      })
      return undefined
    }

    let cancelled = false
    let handle: MolecularStructureRendererHandle | null = null
    setRenderState({
      kind: 'loading',
      title: 'Rendering molecular structure',
      message: `Loading ${renderable.byteLength} bytes through workspace preview range transport.`
    })

    void readMolecularRenderableAssetText({
      renderable,
      readRange: input.readRange
    })
      .then(async (source) => {
        if (cancelled) return
        if (!source.ok) {
          setRenderState({
            kind: 'error',
            title: 'Molecular render failed',
            message: source.reason
          })
          return
        }

        handle = await input.structureRenderer({
          element: container,
          source: source.text,
          format: renderable.format,
          representation: latestRepresentationRef.current,
          selection: latestSelectionRef.current
        })
        if (cancelled) {
          handle.dispose()
          return
        }
        rendererHandleRef.current = handle
        setRenderState({
          kind: 'ready',
          title: 'Molecular structure rendered',
          message: 'Interactive molecular structure rendered with 3Dmol.'
        })
      })
      .catch((error) => {
        if (cancelled) return
        setRenderState({
          kind: 'error',
          title: 'Molecular render failed',
          message: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      cancelled = true
      if (rendererHandleRef.current === handle) {
        rendererHandleRef.current = null
      }
      handle?.dispose()
    }
  }, [
    input.asset,
    input.assetError,
    input.assetStatus,
    input.containerRef,
    input.enabled,
    input.observation?.file.path,
    input.readRange,
    input.structureRenderer
  ])

  return renderState
}

export function resolveMolecularRenderableAsset(input: {
  asset: WorkspacePreviewAssetTransportDescriptor
  observation?: WorkspaceObservation | null
  maxBytes?: number
}): MolecularRenderableAsset {
  if (!input.asset.range.available) {
    return {
      ok: false,
      reason: 'This molecular asset does not expose byte-range transport.'
    }
  }

  const path = input.observation?.file.path || input.asset.file.relativePath || input.asset.file.path
  const format = molecular3DmolFormatForPath(path)
  if (!format) {
    return {
      ok: false,
      reason: `3D structure rendering is not available for ${basename(path)}.`
    }
  }

  const byteLength = input.asset.range.size
  if (byteLength <= 0) {
    return {
      ok: false,
      reason: 'The molecular asset is empty.'
    }
  }

  const maxBytes = input.maxBytes ?? MOLECULAR_VIEWER_MAX_SOURCE_BYTES
  if (byteLength > maxBytes) {
    return {
      ok: false,
      reason: `The molecular asset is ${byteLength} bytes; interactive rendering is limited to ${maxBytes} bytes in this first pass.`
    }
  }

  return {
    ok: true,
    format,
    byteLength
  }
}

export async function readMolecularRenderableAssetText(input: {
  renderable: Extract<MolecularRenderableAsset, { ok: true }>
  readRange: MolecularWorkspaceViewerReadRange
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const result = await input.readRange({
    offset: 0,
    length: input.renderable.byteLength
  })
  if (!result.ok) {
    return {
      ok: false,
      reason: result.message
    }
  }
  if (result.length < input.renderable.byteLength) {
    return {
      ok: false,
      reason: `Only ${result.length} of ${input.renderable.byteLength} bytes were read; refusing to render a truncated molecular model.`
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

function createInactiveModel(
  status: Extract<MolecularWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): MolecularWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Molecular viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      title: 'WebGL viewer mount point',
      message: 'No molecular viewport is active.'
    },
    agentSummary: status.message,
    structureRows: [],
    selection: {
      kind: 'none',
      summary: 'No molecular selection.',
      groups: []
    },
    actions: []
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
      summary: 'No molecular selection.',
      groups: []
    }
  }

  if (selection.kind !== 'molecular') {
    return {
      kind: 'unsupported',
      summary: `${titleCase(selection.kind)} selection is active outside the molecular viewer.`,
      groups: []
    }
  }

  const groups = compactGroups([
    createSelectionGroup('chains', 'Selected chains', selection.chains),
    createSelectionGroup('residues', 'Selected residues', selection.residues?.map(formatResidue)),
    createSelectionGroup('atoms', 'Selected atoms', selection.atoms?.map(formatAtom)),
    createSelectionGroup('ligands', 'Selected ligands', selection.ligands),
    createSelectionGroup('elements', 'Selected elements', collectSelectedElements(selection))
  ])
  const summaryParts = compactStrings([
    selection.chains?.length ? formatCount(selection.chains.length, 'chain') : undefined,
    selection.residues?.length ? formatCount(selection.residues.length, 'residue') : undefined,
    selection.atoms?.length ? formatCount(selection.atoms.length, 'atom') : undefined,
    selection.ligands?.length ? formatCount(selection.ligands.length, 'ligand') : undefined,
    collectSelectedElements(selection).length ? formatCount(collectSelectedElements(selection).length, 'element') : undefined
  ])

  return {
    kind: 'molecular',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Molecular selection is empty.',
    groups
  }
}

function buildMolecularActions(actions: readonly string[]): MolecularWorkspaceViewerAction[] {
  const resolved = new Map<string, MolecularWorkspaceViewerAction>()

  for (const actionId of actions) {
    const kind = classifyMolecularAction(actionId)
    if (!kind) continue

    resolved.set(actionId, {
      id: actionId,
      label: MOLECULAR_ACTION_LABELS[actionId] ?? formatActionLabel(actionId),
      kind
    })
  }

  return [...resolved.values()]
}

function classifyMolecularAction(actionId: string): MolecularWorkspaceViewerActionKind | null {
  if (actionId === 'workspace.setSelection' || /(^|[.:])select/i.test(actionId) || /selection/i.test(actionId)) {
    return 'select'
  }
  if (/measure|distance/i.test(actionId)) return 'measure'
  if (actionId.startsWith('molecular.')) return 'other'
  return null
}

function buildAgentSummary(input: {
  observation: WorkspaceObservation
  selection: MolecularWorkspaceViewerSelectionModel
  actions: MolecularWorkspaceViewerAction[]
}): string {
  const { observation, selection, actions } = input
  const molecular = observation.molecular
  const parts = compactStrings([
    typeof molecular?.modelCount === 'number' ? formatCount(molecular.modelCount, 'model') : undefined,
    molecular?.chains?.length ? `${formatCount(molecular.chains.length, 'chain')}: ${joinList(molecular.chains)}` : undefined,
    molecular?.ligands?.length ? `${formatCount(molecular.ligands.length, 'ligand')}: ${joinList(molecular.ligands)}` : undefined,
    selection.kind === 'molecular' ? `selection: ${selection.summary}` : undefined,
    actions.length ? `actions: ${actions.map((action) => action.label).join(', ')}` : undefined
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

function formatActionLabel(actionId: string): string {
  const actionName = actionId.split(/[.:]/).filter(Boolean).at(-1) ?? actionId
  return titleCase(actionName.replace(/([a-z])([A-Z])/g, '$1 $2'))
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
