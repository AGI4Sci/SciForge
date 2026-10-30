import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  WorkspacePreviewArtifactDescriptor,
  WorkspacePreviewAssetTransportDescriptor,
  WorkspacePreviewPrepareArtifactRequest
} from '@sciforge/domain-sdk/workspace-preview'
import type {
  LifeScienceStructuredSelection as WorkspaceStructuredSelection,
  LifeScienceWorkspaceObservation as WorkspaceObservation
} from '../wire'
import type { WorkspacePreviewAssetTransportClient } from './transport'

type BioimagingStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'bioimaging' }>

export type BioimagingWorkspaceViewerStatus =
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

export type BioimagingWorkspaceViewerRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type BioimagingWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type BioimagingWorkspaceViewerActionKind =
  | 'select-region'
  | 'select-channels'
  | 'annotate'
  | 'export'
  | 'inspect'
  | 'other'

export type BioimagingWorkspaceViewerAction = {
  id: string
  label: string
  kind: BioimagingWorkspaceViewerActionKind
}

export type BioimagingWorkspaceViewerAnnotation = {
  id: string
  kind: string
  label: string
  summary: string
}

export type BioimagingWorkspaceViewerSelectionModel = {
  kind: 'none' | 'bioimaging' | 'unsupported'
  summary: string
  groups: BioimagingWorkspaceViewerGroup[]
}

export type BioimagingWorkspaceViewerRoiOverlay = {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  z?: number
  t?: number
}

export type BioimagingWorkspaceViewerTileOverview =
  | {
      kind: 'overview'
      title: string
      message: string
      imageWidth: number
      imageHeight: number
      tileWidth: number
      tileHeight: number
      columns: number
      rows: number
      levelCount: number
      source: string
      pixelDecoding: boolean
      tileRendererImplemented: boolean
      channelCount: number
      selectedChannelCount: number
      gridPath: string
      roiOverlays: BioimagingWorkspaceViewerRoiOverlay[]
    }
  | {
      kind: 'placeholder'
      title: string
      message: string
    }

export type BioimagingWorkspaceViewerModel = {
  status: BioimagingWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: BioimagingWorkspaceViewerTileOverview
  agentSummary: string
  imageRows: BioimagingWorkspaceViewerRow[]
  selection: BioimagingWorkspaceViewerSelectionModel
  annotations: BioimagingWorkspaceViewerAnnotation[]
  actions: BioimagingWorkspaceViewerAction[]
}

export type BioimagingRenderedTileState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready'
      dataUrl: string
      artifactId: string
      width: number
      height: number
      mimeType: string
    }
  | {
      kind: 'fallback'
      message: string
    }

type BioimagingTileArtifactRequest = Extract<WorkspacePreviewPrepareArtifactRequest, { kind: 'tile' }>
type BioimagingArtifactLoadFailure = { ok: false; message: string }

const bioimagingArtifactResourceCache = new Map<string, Promise<BioimagingRenderedTileState>>()

export type BioimagingWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: BioimagingWorkspaceViewerModel
  transport?: WorkspacePreviewAssetTransportClient | null
  renderedTile?: BioimagingRenderedTileState
  className?: string
}

const BIOIMAGING_ACTION_LABELS: Record<string, string> = {
  'workspace.setSelection': 'Select Region',
  'bioimaging.observeMetadata': 'Observe Metadata',
  'bioimaging.inspectHeader': 'Inspect Header',
  'bioimaging.describeTilePlan': 'Describe Tile Plan',
  'bioimaging.selectRegion': 'Select Region',
  'bioimaging.selectChannels': 'Select Channels',
  'bioimaging.annotateRegion': 'Annotate Region',
  'bioimaging.exportRoiSet': 'Export ROI Set'
}

const MAX_GRID_LINES_PER_AXIS = 32

export function buildBioimagingWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): BioimagingWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No bioimaging observation',
      message: 'Open a bioimaging workspace preview to populate this baseline viewer.'
    })
  }

  const hasBioimagingContext = observation.view.modality === 'bioimaging' ||
    Boolean(observation.bioimaging) ||
    observation.selection?.kind === 'bioimaging'

  if (!hasBioimagingContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the bioimaging viewer.`
    }, observation)
  }

  const selection = buildBioimagingSelectionModel(observation.selection)
  const annotations = buildBioimagingAnnotations(observation.annotations)
  const actions = buildBioimagingActions(observation.actions)
  const viewport = buildBioimagingTileOverviewModel(observation)
  const imageRows = buildBioimagingRows(observation)
  const agentSummary = buildAgentSummary({ observation, selection, annotations, actions, viewport })

  return {
    status: {
      kind: 'ready',
      title: viewport.kind === 'overview'
        ? 'Bioimaging tile overview ready'
        : 'Bioimaging baseline ready',
      message: viewport.kind === 'overview'
        ? 'A metadata-only virtual tile grid is available without decoding image pixels.'
        : 'A future tile and pixel renderer can mount into the placeholder viewport.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Bioimaging preview',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport,
    agentSummary,
    imageRows,
    selection,
    annotations,
    actions
  }
}

export function BioimagingWorkspaceViewer({
  observation,
  model,
  transport,
  renderedTile,
  className
}: BioimagingWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildBioimagingWorkspaceViewerModel(observation)
  const transportTile = useBioimagingRenderedTile(resolvedModel.viewport, transport, !renderedTile)
  const resolvedRenderedTile = renderedTile ?? transportTile
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'

  return (
    <section
      className={compactClassName('workspace-preview-bioimaging-viewer', className)}
      data-workspace-preview-bioimaging-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-bioimaging-viewer__header">
        <div>
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-bioimaging-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <>
          {resolvedModel.viewport.kind === 'overview'
            ? renderTileOverview(resolvedModel.viewport, resolvedRenderedTile)
            : (
                <div
                  className="workspace-preview-bioimaging-viewer__viewport"
                  data-metadata-only-viewport-placeholder
                  role="img"
                  aria-label="Bioimaging metadata-only viewport placeholder"
                >
                  <strong>{resolvedModel.viewport.title}</strong>
                  <p>{resolvedModel.viewport.message}</p>
                </div>
              )}

          <p className="workspace-preview-bioimaging-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-bioimaging-viewer__section"
            aria-label="Bioimaging dimensions and channels"
          >
            <h4>Image Summary</h4>
            <dl>
              {resolvedModel.imageRows.map((row) => (
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
            className="workspace-preview-bioimaging-viewer__section"
            aria-label="Bioimaging ROI and channel selection"
            data-selection-kind={resolvedModel.selection.kind}
          >
            <h4>Selection</h4>
            <p>{resolvedModel.selection.summary}</p>
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
            className="workspace-preview-bioimaging-viewer__section"
            aria-label="Bioimaging annotations"
          >
            <h4>Annotations</h4>
            {resolvedModel.annotations.length ? (
              <ul>
                {resolvedModel.annotations.map((annotation) => (
                  <li
                    key={annotation.id}
                    data-annotation-id={annotation.id}
                    data-annotation-kind={annotation.kind}
                  >
                    <strong>{annotation.label}</strong>
                    <span>{annotation.summary}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No ROI or channel annotations are reported.</p>
            )}
          </section>

          <section
            className="workspace-preview-bioimaging-viewer__section"
            aria-label="Bioimaging actions"
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
              <p>No select, annotate, export, or inspect actions are available.</p>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export function buildBioimagingTileArtifactRequest(
  viewport: BioimagingWorkspaceViewerTileOverview
): BioimagingTileArtifactRequest | null {
  if (viewport.kind !== 'overview') return null
  return {
    kind: 'tile',
    level: 0,
    x: 0,
    y: 0,
    width: Math.max(1, Math.min(viewport.tileWidth, viewport.imageWidth)),
    height: Math.max(1, Math.min(viewport.tileHeight, viewport.imageHeight))
  }
}

function useBioimagingRenderedTile(
  viewport: BioimagingWorkspaceViewerTileOverview,
  transport?: WorkspacePreviewAssetTransportClient | null,
  enabled = true
): BioimagingRenderedTileState {
  const requestKey = viewport.kind === 'overview'
    ? `overview:${viewport.imageWidth}:${viewport.imageHeight}:${viewport.tileWidth}:${viewport.tileHeight}`
    : viewport.kind
  const request = useMemo(
    () => buildBioimagingTileArtifactRequest(viewport),
    [requestKey]
  )
  const [state, setState] = useState<BioimagingRenderedTileState>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    if (!enabled || !request || !transport) {
      setState({ kind: 'idle' })
      return () => {
        cancelled = true
      }
    }

    setState({ kind: 'loading' })
    void (async () => {
      try {
        const state = await loadBioimagingArtifactDataUrl(transport, request)
        if (cancelled) return
        setState(state)
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: 'fallback',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, request, transport])

  return state
}

export async function loadBioimagingArtifactDataUrl(
  transport: WorkspacePreviewAssetTransportClient,
  request: BioimagingTileArtifactRequest
): Promise<BioimagingRenderedTileState> {
  const cacheKey = buildBioimagingArtifactResourceCacheKey(transport.descriptor, request)
  const cached = bioimagingArtifactResourceCache.get(cacheKey)
  if (cached) return cached

  const promise = (async (): Promise<BioimagingRenderedTileState> => {
    const existingArtifact = findMatchingBioimagingTileArtifact(transport.descriptor, request)
    const artifactOrFailure = existingArtifact ?? await (async (): Promise<
      WorkspacePreviewArtifactDescriptor | BioimagingArtifactLoadFailure
    > => {
      const prepared = await transport.prepareArtifact(request)
      if (!prepared.ok) return prepared
      return prepared.artifact
    })()
    if (isBioimagingArtifactLoadFailure(artifactOrFailure)) {
      return { kind: 'fallback', message: artifactOrFailure.message }
    }
    const artifact = artifactOrFailure

    const bytes = await transport.readArtifactRange({
      artifactId: artifact.artifactId,
      range: { offset: 0, length: artifact.byteLength }
    })
    if (!bytes.ok) return { kind: 'fallback', message: bytes.message }
    return {
      kind: 'ready',
      dataUrl: `data:${bytes.mimeType};base64,${bytes.dataBase64}`,
      artifactId: artifact.artifactId,
      width: artifact.tile?.width ?? request.width,
      height: artifact.tile?.height ?? request.height,
      mimeType: bytes.mimeType
    }
  })()
  bioimagingArtifactResourceCache.set(cacheKey, promise)
  return promise
}

function isBioimagingArtifactLoadFailure(
  value: WorkspacePreviewArtifactDescriptor | BioimagingArtifactLoadFailure
): value is BioimagingArtifactLoadFailure {
  return 'ok' in value && value.ok === false
}

function buildBioimagingArtifactResourceCacheKey(
  descriptor: WorkspacePreviewAssetTransportDescriptor | null,
  request: BioimagingTileArtifactRequest
): string {
  return JSON.stringify({
    sessionId: descriptor?.sessionId ?? null,
    assetId: descriptor?.assetId ?? null,
    size: descriptor?.file.size ?? null,
    mtimeMs: descriptor?.file.mtimeMs ?? null,
    request
  })
}

function findMatchingBioimagingTileArtifact(
  descriptor: WorkspacePreviewAssetTransportDescriptor | null,
  request: BioimagingTileArtifactRequest
): NonNullable<WorkspacePreviewAssetTransportDescriptor['artifacts']>[number] | null {
  return descriptor?.artifacts?.find((artifact) => (
    artifact.kind === 'tile' &&
    artifact.tile?.level === request.level &&
    artifact.tile.x === request.x &&
    artifact.tile.y === request.y &&
    artifact.tile.width === request.width &&
    artifact.tile.height === request.height
  )) ?? null
}

function createInactiveModel(
  status: Extract<BioimagingWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): BioimagingWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Bioimaging viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      kind: 'placeholder',
      title: 'Metadata-only viewport placeholder',
      message: 'No bioimaging viewport is active.'
    },
    agentSummary: status.message,
    imageRows: [],
    selection: {
      kind: 'none',
      summary: 'No bioimaging selection.',
      groups: []
    },
    annotations: [],
    actions: []
  }
}

export function buildBioimagingTileOverviewModel(
  observation: WorkspaceObservation | null | undefined
): BioimagingWorkspaceViewerTileOverview {
  const bioimaging = observation?.bioimaging
  const dimensions = bioimaging?.dimensions
  const tilePlan = bioimaging?.tilePlan
  const tileSize = tilePlan?.tileSize

  if (!dimensions || !tilePlan || !tileSize) {
    return {
      kind: 'placeholder',
      title: 'Metadata-only viewport placeholder',
      message: bioimaging
        ? 'Dimensions, channels, ROI metadata, and annotations are summarized; tile and pixel rendering is intentionally not loaded in this baseline.'
        : 'Waiting for bioimaging summary metadata from the preview worker.'
    }
  }

  const columns = Math.max(1, Math.ceil(dimensions.width / tileSize.width))
  const rows = Math.max(1, Math.ceil(dimensions.height / tileSize.height))
  const selection = observation?.selection?.kind === 'bioimaging' ? observation.selection : undefined
  const channelCount = bioimaging.channels?.length ?? 0
  const selectedChannelCount = selection?.channels?.length ?? 0
  const pixelDecoding = tilePlan.pixelDecoding === true
  const tileRendererImplemented = tilePlan.tileRendererImplemented === true

  return {
    kind: 'overview',
    title: 'Metadata-only tile overview',
    message: compactStrings([
      `${formatCount(columns * rows, 'virtual tile')} at ${formatInteger(tileSize.width)} x ${formatInteger(tileSize.height)}`,
      formatCount(tilePlan.levelCount ?? 1, 'pyramid level'),
      pixelDecoding ? 'pixel decoding reported' : 'no pixel decoding',
      tileRendererImplemented ? 'tile renderer reported' : 'tile renderer not implemented'
    ]).join('; '),
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    tileWidth: tileSize.width,
    tileHeight: tileSize.height,
    columns,
    rows,
    levelCount: tilePlan.levelCount ?? 1,
    source: tilePlan.source ?? 'metadata',
    pixelDecoding,
    tileRendererImplemented,
    channelCount,
    selectedChannelCount,
    gridPath: buildVirtualTileGridPath({
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      tileWidth: tileSize.width,
      tileHeight: tileSize.height,
      columns,
      rows
    }),
    roiOverlays: buildRoiOverlays(selection, dimensions)
  }
}

function buildBioimagingRows(observation: WorkspaceObservation): BioimagingWorkspaceViewerRow[] {
  const bioimaging = observation.bioimaging
  const selection = observation.selection?.kind === 'bioimaging' ? observation.selection : undefined
  const selectedChannels = selection?.channels ?? []
  const selectedRois = selection?.roiIds ?? []
  const selectedRegions = selection?.regions?.map(formatRegion) ?? []
  const rows: BioimagingWorkspaceViewerRow[] = [
    row(
      'dimensions',
      'Dimensions',
      formatDimensions(bioimaging?.dimensions),
      bioimaging?.dimensions ? 'From metadata; pixels are not decoded in this baseline.' : undefined
    ),
    row(
      'channels',
      'Channels',
      joinList(bioimaging?.channels),
      selectedChannels.length ? `Selected: ${joinList(selectedChannels)}` : undefined
    ),
    row(
      'roi-selection',
      'ROI Selection',
      selectedRois.length || selectedRegions.length
        ? compactStrings([
            selectedRois.length ? formatCount(selectedRois.length, 'ROI', 'ROIs') : undefined,
            selectedRegions.length ? formatCount(selectedRegions.length, 'region') : undefined
          ]).join(', ')
        : 'Not selected',
      compactStrings([
        selectedRois.length ? `ROIs: ${joinList(selectedRois)}` : undefined,
        selectedRegions.length ? `Regions: ${selectedRegions.join('; ')}` : undefined
      ]).join(' | ') || undefined
    ),
    row(
      'tile-plan',
      'Tile Plan',
      formatTilePlan(bioimaging?.tilePlan, bioimaging?.dimensions),
      bioimaging?.tilePlan ? 'Metadata-only transport plan; pixels are not decoded.' : undefined
    )
  ]

  if (!bioimaging && observation.selection?.kind !== 'bioimaging') {
    rows.push(row('summary', 'Summary', 'No bioimaging metadata reported yet.'))
  }

  return rows
}

function buildBioimagingSelectionModel(
  selection: WorkspaceStructuredSelection | undefined
): BioimagingWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'No bioimaging selection.',
      groups: []
    }
  }

  if (selection.kind !== 'bioimaging') {
    return {
      kind: 'unsupported',
      summary: `${titleCase(selection.kind)} selection is active outside the bioimaging viewer.`,
      groups: []
    }
  }

  const formattedRegions = selection.regions?.map(formatRegion) ?? []
  const groups = compactGroups([
    createSelectionGroup('rois', 'Selected ROIs', selection.roiIds, 'ROI', 'ROIs'),
    createSelectionGroup('channels', 'Selected channels', selection.channels, 'channel'),
    createSelectionGroup('regions', 'Selected regions', formattedRegions, 'region')
  ])
  const summaryParts = compactStrings([
    selection.roiIds?.length ? formatCount(selection.roiIds.length, 'ROI', 'ROIs') : undefined,
    selection.channels?.length ? formatCount(selection.channels.length, 'channel') : undefined,
    selection.regions?.length ? formatCount(selection.regions.length, 'region') : undefined
  ])

  return {
    kind: 'bioimaging',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Bioimaging selection is empty.',
    groups
  }
}

function buildBioimagingAnnotations(
  annotations: WorkspaceObservation['annotations']
): BioimagingWorkspaceViewerAnnotation[] {
  return (annotations ?? []).map((annotation) => ({
    id: annotation.id,
    kind: annotation.kind,
    label: titleCase(annotation.kind),
    summary: annotation.summary || annotation.id
  }))
}

function buildBioimagingActions(actions: readonly string[]): BioimagingWorkspaceViewerAction[] {
  const resolved = new Map<string, BioimagingWorkspaceViewerAction>()

  for (const actionId of actions) {
    const kind = classifyBioimagingAction(actionId)
    if (!kind) continue

    resolved.set(actionId, {
      id: actionId,
      label: BIOIMAGING_ACTION_LABELS[actionId] ?? formatActionLabel(actionId),
      kind
    })
  }

  return [...resolved.values()]
}

function classifyBioimagingAction(actionId: string): BioimagingWorkspaceViewerActionKind | null {
  if (actionId === 'bioimaging.selectChannels' || /select.*channel|channel.*select/i.test(actionId)) {
    return 'select-channels'
  }
  if (actionId === 'workspace.setSelection' || actionId === 'bioimaging.selectRegion' || /select.*(region|roi)/i.test(actionId)) {
    return 'select-region'
  }
  if (/annotate|annotation/i.test(actionId)) return 'annotate'
  if (/export|download/i.test(actionId)) return 'export'
  if (/observe|inspect|metadata|tile/i.test(actionId)) return 'inspect'
  if (actionId.startsWith('bioimaging.')) return 'other'
  return null
}

function buildAgentSummary(input: {
  observation: WorkspaceObservation
  selection: BioimagingWorkspaceViewerSelectionModel
  annotations: BioimagingWorkspaceViewerAnnotation[]
  actions: BioimagingWorkspaceViewerAction[]
  viewport: BioimagingWorkspaceViewerTileOverview
}): string {
  const { observation, selection, annotations, actions, viewport } = input
  const bioimaging = observation.bioimaging
  const parts = compactStrings([
    bioimaging?.dimensions ? `dimensions: ${formatDimensions(bioimaging.dimensions)}` : undefined,
    bioimaging?.channels?.length ? `${formatCount(bioimaging.channels.length, 'channel')}: ${joinList(bioimaging.channels)}` : undefined,
    viewport.kind === 'overview'
      ? `tile overview: ${viewport.columns} x ${viewport.rows} metadata tiles, ${formatCount(viewport.levelCount, 'pyramid level')}`
      : undefined,
    selection.kind === 'bioimaging' ? `selection: ${selection.summary}` : undefined,
    annotations.length ? formatCount(annotations.length, 'annotation') : undefined,
    actions.length ? `actions: ${actions.map((action) => action.label).join(', ')}` : undefined,
    viewport.kind === 'overview' ? 'viewport: metadata-only tile grid' : 'viewport: metadata-only placeholder'
  ])

  return parts.join('; ')
}

function renderTileOverview(
  viewport: Extract<BioimagingWorkspaceViewerTileOverview, { kind: 'overview' }>,
  renderedTile: BioimagingRenderedTileState
): ReactNode {
  return (
    <figure
      className="workspace-preview-bioimaging-viewer__viewport workspace-preview-bioimaging-viewer__tile-overview"
      data-bioimaging-metadata-tile-overview="true"
      data-bioimaging-rendered-tile-state={renderedTile.kind}
      data-pixel-decoding={String(viewport.pixelDecoding)}
      data-tile-renderer-implemented={String(viewport.tileRendererImplemented)}
      data-tile-source={viewport.source}
      data-tile-level-count={viewport.levelCount}
      data-tile-columns={viewport.columns}
      data-tile-rows={viewport.rows}
      data-image-width={viewport.imageWidth}
      data-image-height={viewport.imageHeight}
      data-channel-count={viewport.channelCount}
      data-selected-channel-count={viewport.selectedChannelCount}
      role="img"
      aria-label={`${viewport.title}: ${viewport.message}`}
    >
      <svg
        viewBox={`0 0 ${viewport.imageWidth} ${viewport.imageHeight}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {renderedTile.kind === 'ready' ? (
          <image
            href={renderedTile.dataUrl}
            x="0"
            y="0"
            width={renderedTile.width}
            height={renderedTile.height}
            preserveAspectRatio="none"
            data-bioimaging-rendered-tile="true"
            data-artifact-id={renderedTile.artifactId}
            data-mime-type={renderedTile.mimeType}
          />
        ) : null}
        <rect
          x="0"
          y="0"
          width={viewport.imageWidth}
          height={viewport.imageHeight}
          fill="none"
          stroke="currentColor"
          vectorEffect="non-scaling-stroke"
        />
        {viewport.gridPath ? (
          <path
            d={viewport.gridPath}
            fill="none"
            stroke="currentColor"
            opacity="0.32"
            vectorEffect="non-scaling-stroke"
            data-bioimaging-virtual-tile-grid="true"
          />
        ) : null}
        {viewport.roiOverlays.map((overlay) => (
          <g
            key={overlay.id}
            data-bioimaging-roi-overlay="true"
            data-roi-id={overlay.id}
          >
            <title>{overlay.label}</title>
            <rect
              x={overlay.x}
              y={overlay.y}
              width={overlay.width}
              height={overlay.height}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      <figcaption>
        <strong>{viewport.title}</strong>
        <p>{viewport.message}</p>
        {renderedTile.kind === 'ready' ? (
          <small data-bioimaging-rendered-tile-caption>
            Rendered tile artifact {renderedTile.artifactId}
          </small>
        ) : null}
        {renderedTile.kind === 'loading' ? (
          <small data-bioimaging-rendered-tile-loading>
            Preparing bounded tile artifact...
          </small>
        ) : null}
        {renderedTile.kind === 'fallback' ? (
          <small data-bioimaging-rendered-tile-fallback>
            Tile artifact fallback: {renderedTile.message}
          </small>
        ) : null}
      </figcaption>
    </figure>
  )
}

function buildVirtualTileGridPath(input: {
  imageWidth: number
  imageHeight: number
  tileWidth: number
  tileHeight: number
  columns: number
  rows: number
}): string {
  const xBoundaries = sampledTileBoundaries(input.columns, input.tileWidth, input.imageWidth)
  const yBoundaries = sampledTileBoundaries(input.rows, input.tileHeight, input.imageHeight)
  const verticalLines = xBoundaries.map((x) => `M ${formatSvgNumber(x)} 0 V ${formatSvgNumber(input.imageHeight)}`)
  const horizontalLines = yBoundaries.map((y) => `M 0 ${formatSvgNumber(y)} H ${formatSvgNumber(input.imageWidth)}`)

  return [...verticalLines, ...horizontalLines].join(' ')
}

function sampledTileBoundaries(tileCount: number, tileSize: number, extent: number): number[] {
  if (tileCount <= 1) return []

  const step = Math.max(1, Math.ceil((tileCount - 1) / MAX_GRID_LINES_PER_AXIS))
  const boundaries: number[] = []

  for (let index = step; index < tileCount; index += step) {
    const boundary = Math.min(extent, index * tileSize)
    if (boundary > 0 && boundary < extent) boundaries.push(boundary)
  }

  return boundaries
}

function buildRoiOverlays(
  selection: BioimagingStructuredSelection | undefined,
  dimensions: NonNullable<WorkspaceObservation['bioimaging']>['dimensions']
): BioimagingWorkspaceViewerRoiOverlay[] {
  if (!selection?.regions?.length || !dimensions) return []

  return selection.regions.flatMap((region, index) => {
    const clamped = clampRegionToDimensions(region, dimensions)
    if (!clamped) return []

    const id = selection.roiIds?.[index] ?? `region-${index + 1}`
    return [{
      ...clamped,
      id,
      label: compactStrings([
        id,
        `x ${formatNumber(clamped.x)}`,
        `y ${formatNumber(clamped.y)}`,
        `${formatNumber(clamped.width)} x ${formatNumber(clamped.height)}`,
        clamped.z !== undefined ? `z ${formatNumber(clamped.z)}` : undefined,
        clamped.t !== undefined ? `t ${formatNumber(clamped.t)}` : undefined
      ]).join(', ')
    }]
  })
}

function clampRegionToDimensions(
  region: NonNullable<BioimagingStructuredSelection['regions']>[number],
  dimensions: NonNullable<WorkspaceObservation['bioimaging']>['dimensions']
): Omit<BioimagingWorkspaceViewerRoiOverlay, 'id' | 'label'> | null {
  if (!dimensions) return null

  const x = clamp(region.x, 0, dimensions.width)
  const y = clamp(region.y, 0, dimensions.height)
  const right = clamp(region.x + region.width, 0, dimensions.width)
  const bottom = clamp(region.y + region.height, 0, dimensions.height)
  const width = right - x
  const height = bottom - y

  if (width <= 0 || height <= 0) return null

  return {
    x,
    y,
    width,
    height,
    ...(region.z !== undefined ? { z: region.z } : {}),
    ...(region.t !== undefined ? { t: region.t } : {})
  }
}

function createSelectionGroup(
  id: string,
  title: string,
  items: readonly string[] | undefined,
  singular: string,
  plural = `${singular}s`
): BioimagingWorkspaceViewerGroup | null {
  const normalized = compactStrings(items)
  if (!normalized.length) return null

  return {
    id,
    title,
    summary: formatCount(normalized.length, singular, plural),
    items: normalized
  }
}

function formatDimensions(dimensions: NonNullable<WorkspaceObservation['bioimaging']>['dimensions']): string {
  if (!dimensions) return 'Not reported'

  return compactStrings([
    `${dimensions.width} x ${dimensions.height}`,
    dimensions.z ? `Z ${dimensions.z}` : undefined,
    dimensions.t ? `T ${dimensions.t}` : undefined
  ]).join(', ')
}

function formatTilePlan(
  tilePlan: NonNullable<WorkspaceObservation['bioimaging']>['tilePlan'],
  dimensions: NonNullable<WorkspaceObservation['bioimaging']>['dimensions']
): string {
  if (!tilePlan) return 'Not reported'

  const tileSize = tilePlan.tileSize
  const tileSummary = tileSize && dimensions
    ? `${Math.max(1, Math.ceil(dimensions.width / tileSize.width))} x ${Math.max(1, Math.ceil(dimensions.height / tileSize.height))} virtual tiles`
    : 'virtual tile grid'

  return compactStrings([
    tilePlan.status ?? 'metadata-only',
    tileSummary,
    tileSize ? `${formatInteger(tileSize.width)} x ${formatInteger(tileSize.height)}` : undefined,
    tilePlan.levelCount !== undefined ? formatCount(tilePlan.levelCount, 'level') : undefined,
    tilePlan.source
  ]).join(', ')
}

function formatRegion(region: NonNullable<BioimagingStructuredSelection['regions']>[number]): string {
  return compactStrings([
    `x ${formatNumber(region.x)}`,
    `y ${formatNumber(region.y)}`,
    `${formatNumber(region.width)} x ${formatNumber(region.height)}`,
    region.z !== undefined ? `z ${formatNumber(region.z)}` : undefined,
    region.t !== undefined ? `t ${formatNumber(region.t)}` : undefined
  ]).join(', ')
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
): BioimagingWorkspaceViewerRow {
  return { id, label, value, description }
}

function compactGroups(
  groups: Array<BioimagingWorkspaceViewerGroup | null | undefined>
): BioimagingWorkspaceViewerGroup[] {
  return groups.filter((group): group is BioimagingWorkspaceViewerGroup => Boolean(group))
}

function compactStrings(values: readonly (string | null | undefined | false)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
}

function joinList(values: readonly string[] | undefined): string {
  const compacted = compactStrings(values)
  return compacted.length ? compacted.join(', ') : 'Not reported'
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
}

function formatSvgNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
