import type { ReactNode } from 'react'
import type {
  LifeScienceStructuredSelection as WorkspaceStructuredSelection,
  LifeScienceWorkspaceObservation as WorkspaceObservation
} from '../wire'

type SpectraStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'spectra' }>
type SpectraSampledPeak = NonNullable<NonNullable<WorkspaceObservation['spectra']>['sampledPeaks']>[number]
type SpectraScanMarker = NonNullable<NonNullable<WorkspaceObservation['spectra']>['scanMarkers']>[number]
type SpectraSelectionRange = NonNullable<SpectraStructuredSelection['ranges']>[number]

export type SpectraWorkspaceViewerPeakPlotPeak = {
  id: string
  label: string
  mz: number
  intensity: number
  x: number
  y: number
  lineHeight: number
  selected: boolean
}

export type SpectraWorkspaceViewerPeakPlotRange = {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
}

export type SpectraWorkspaceViewerScanMarker = {
  id: string
  label: string
  x: number
  width: number
  peakCount?: number
}

export type SpectraWorkspaceViewerPeakPlot =
  | {
      kind: 'plot'
      title: string
      message: string
      xAxis: string
      xRange: { min: number; max: number }
      intensityRange: { min: number; max: number }
      peaks: SpectraWorkspaceViewerPeakPlotPeak[]
      ranges: SpectraWorkspaceViewerPeakPlotRange[]
    }
  | {
      kind: 'scan-markers'
      title: string
      message: string
      xAxis: string
      xRange: { min: number; max: number }
      markers: SpectraWorkspaceViewerScanMarker[]
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }

export type SpectraWorkspaceViewerStatus =
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

export type SpectraWorkspaceViewerRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type SpectraWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type SpectraWorkspaceViewerActionKind = 'select' | 'annotate' | 'export' | 'inspect' | 'other'

export type SpectraWorkspaceViewerAction = {
  id: string
  label: string
  kind: SpectraWorkspaceViewerActionKind
}

export type SpectraWorkspaceViewerSelectionModel = {
  kind: 'none' | 'spectra' | 'unsupported'
  summary: string
  groups: SpectraWorkspaceViewerGroup[]
}

export type SpectraWorkspaceViewerModel = {
  status: SpectraWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: SpectraWorkspaceViewerPeakPlot
  agentSummary: string
  spectrumRows: SpectraWorkspaceViewerRow[]
  selection: SpectraWorkspaceViewerSelectionModel
  actions: SpectraWorkspaceViewerAction[]
}

export type SpectraWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: SpectraWorkspaceViewerModel
  className?: string
}

const SPECTRA_ACTION_LABELS: Record<string, string> = {
  'workspace.setSelection': 'Select Range',
  'spectra.preview': 'Preview Spectra',
  'spectra.inspectScans': 'Inspect Scans',
  'spectra.selectPeaksByRange': 'Select Peaks',
  'spectra.annotateRange': 'Annotate Range',
  'spectra.exportPeakList': 'Export Peaks'
}

export function buildSpectraWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): SpectraWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No spectra observation',
      message: 'Open a spectra workspace preview to populate this baseline viewer.'
    })
  }

  const hasSpectraContext = observation.view.modality === 'spectra' ||
    Boolean(observation.spectra) ||
    observation.selection?.kind === 'spectra'

  if (!hasSpectraContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the spectra viewer.`
    }, observation)
  }

  const xAxis = observation.spectra?.xAxis || 'x'
  const selection = buildSpectraSelectionModel(observation.selection, xAxis)
  const actions = buildSpectraActions(observation.actions)
  const spectrumRows = buildSpectraRows(observation, selection)
  const viewport = buildSpectraPeakPlot(observation, xAxis)
  const agentSummary = buildAgentSummary({ observation, selection, actions, viewport })

  return {
    status: {
      kind: 'ready',
      title: 'Spectra preview ready',
      message: viewport.kind === 'plot'
        ? 'Bounded sampled peaks are rendered from the preview observation.'
        : viewport.kind === 'scan-markers'
          ? 'Bounded scan markers are rendered from the preview observation.'
        : viewport.message
    },
    title: observation.view.title || basename(observation.file.path) || 'Spectra preview',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport,
    agentSummary,
    spectrumRows,
    selection,
    actions
  }
}

export function SpectraWorkspaceViewer({
  observation,
  model,
  className
}: SpectraWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildSpectraWorkspaceViewerModel(observation)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'

  return (
    <section
      className={compactClassName('workspace-preview-spectra-viewer', className)}
      data-workspace-preview-spectra-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-spectra-viewer__header">
        <div>
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-spectra-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <>
          <SpectraPeakPlotViewport viewport={resolvedModel.viewport} />

          <p className="workspace-preview-spectra-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-spectra-viewer__section"
            aria-label="Spectra summary"
          >
            <h4>Spectrum Summary</h4>
            <dl>
              {resolvedModel.spectrumRows.map((row) => (
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
            className="workspace-preview-spectra-viewer__section"
            aria-label="Spectra ranges and peaks selection"
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
            className="workspace-preview-spectra-viewer__section"
            aria-label="Spectra actions"
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

function createInactiveModel(
  status: Extract<SpectraWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): SpectraWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Spectra viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      kind: 'empty',
      title: 'Bounded peak plot',
      message: 'No spectra viewport is active.'
    },
    agentSummary: status.message,
    spectrumRows: [],
    selection: {
      kind: 'none',
      summary: 'No spectra selection.',
      groups: []
    },
    actions: []
  }
}

function buildSpectraRows(
  observation: WorkspaceObservation,
  selection: SpectraWorkspaceViewerSelectionModel
): SpectraWorkspaceViewerRow[] {
  const spectra = observation.spectra
  const rows: SpectraWorkspaceViewerRow[] = [
    row(
      'spectrum-count',
      'Spectra',
      typeof spectra?.spectrumCount === 'number' ? String(spectra.spectrumCount) : 'Not reported',
      typeof spectra?.spectrumCount === 'number' ? formatCount(spectra.spectrumCount, 'spectrum', 'spectra') : undefined
    ),
    row(
      'peak-count',
      'Peaks',
      typeof spectra?.peakCount === 'number' ? String(spectra.peakCount) : 'Not reported',
      typeof spectra?.peakCount === 'number' ? formatCount(spectra.peakCount, 'peak') : undefined
    ),
    row(
      'x-axis',
      'X Axis',
      spectra?.xAxis || 'Not reported'
    ),
    row(
      'sampled-peaks',
      'Sampled Peaks',
      typeof spectra?.sampledPeaks?.length === 'number' ? String(spectra.sampledPeaks.length) : '0',
      spectra?.sampledPeaks?.length ? formatCount(spectra.sampledPeaks.length, 'sampled peak') : undefined
    ),
    row(
      'scan-markers',
      'Scan Markers',
      typeof spectra?.scanMarkers?.length === 'number' ? String(spectra.scanMarkers.length) : '0',
      spectra?.scanMarkers?.length ? formatCount(spectra.scanMarkers.length, 'scan marker') : undefined
    ),
    row(
      'selection',
      'Selection',
      selection.kind === 'spectra' ? selection.summary : 'No spectra range selected'
    )
  ]

  if (!spectra && selection.kind === 'none') {
    rows.push(row('summary', 'Summary', 'No spectra summary reported yet.'))
  }

  return rows
}

function buildSpectraSelectionModel(
  selection: WorkspaceStructuredSelection | undefined,
  xAxis: string
): SpectraWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'No spectra selection.',
      groups: []
    }
  }

  if (selection.kind !== 'spectra') {
    return {
      kind: 'unsupported',
      summary: `${titleCase(selection.kind)} selection is active outside the spectra viewer.`,
      groups: []
    }
  }

  const ranges = selection.ranges.map((range) => formatSpectraRange(range, xAxis))
  const peaks = selection.peaks?.map(formatPeak) ?? []
  const groups = compactGroups([
    createSelectionGroup('ranges', 'Selected ranges', ranges, 'range'),
    createSelectionGroup('peaks', 'Selected peaks', peaks, 'peak')
  ])
  const summaryParts = compactStrings([
    selection.ranges.length ? formatCount(selection.ranges.length, 'range') : undefined,
    peaks.length ? formatCount(peaks.length, 'peak') : undefined
  ])

  return {
    kind: 'spectra',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Spectra selection is empty.',
    groups
  }
}

function buildSpectraActions(actions: readonly string[]): SpectraWorkspaceViewerAction[] {
  const resolved = new Map<string, SpectraWorkspaceViewerAction>()

  for (const actionId of actions) {
    const kind = classifySpectraAction(actionId)
    if (!kind) continue

    resolved.set(actionId, {
      id: actionId,
      label: SPECTRA_ACTION_LABELS[actionId] ?? formatActionLabel(actionId),
      kind
    })
  }

  return [...resolved.values()]
}

function classifySpectraAction(actionId: string): SpectraWorkspaceViewerActionKind | null {
  if (/annotate|annotation/i.test(actionId)) return 'annotate'
  if (/export|download/i.test(actionId)) return 'export'
  if (actionId === 'workspace.setSelection' || /select|selection|range/i.test(actionId)) return 'select'
  if (/inspect|preview|scan/i.test(actionId)) return 'inspect'
  if (actionId.startsWith('spectra.')) return 'other'
  return null
}

function buildAgentSummary(input: {
  observation: WorkspaceObservation
  selection: SpectraWorkspaceViewerSelectionModel
  actions: SpectraWorkspaceViewerAction[]
  viewport: SpectraWorkspaceViewerPeakPlot
}): string {
  const { observation, selection, actions, viewport } = input
  const spectra = observation.spectra
  const parts = compactStrings([
    typeof spectra?.spectrumCount === 'number' ? formatCount(spectra.spectrumCount, 'spectrum', 'spectra') : undefined,
    typeof spectra?.peakCount === 'number' ? formatCount(spectra.peakCount, 'peak') : undefined,
    viewport.kind === 'plot' ? `sampled plot: ${formatCount(viewport.peaks.length, 'peak')}` : undefined,
    viewport.kind === 'scan-markers' ? `scan preview: ${formatCount(viewport.markers.length, 'marker')}` : undefined,
    spectra?.xAxis ? `x-axis: ${spectra.xAxis}` : undefined,
    selection.kind === 'spectra' ? `selection: ${selection.summary}` : undefined,
    actions.length ? `actions: ${actions.map((action) => action.label).join(', ')}` : undefined,
    viewport.kind === 'plot'
      ? 'preview: bounded peak plot'
      : viewport.kind === 'scan-markers'
        ? 'preview: bounded scan marker strip'
        : 'preview: no sampled peaks'
  ])

  return parts.join('; ')
}

function SpectraPeakPlotViewport({
  viewport
}: {
  viewport: SpectraWorkspaceViewerPeakPlot
}): ReactNode {
  if (viewport.kind === 'empty') {
    return (
      <div
        className="workspace-preview-spectra-viewer__viewport"
        data-spectra-peak-plot-empty
        role="img"
        aria-label="Spectra bounded peak plot"
      >
        <strong>{viewport.title}</strong>
        <p>{viewport.message}</p>
      </div>
    )
  }

  if (viewport.kind === 'scan-markers') {
    return (
      <div
        className="workspace-preview-spectra-viewer__viewport"
        data-spectra-scan-marker-preview
        data-scan-marker-count={viewport.markers.length}
        role="img"
        aria-label={`${viewport.title}: ${viewport.message}`}
      >
        <strong>{viewport.title}</strong>
        <p>{viewport.message}</p>
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          data-spectra-scan-marker-svg
          aria-hidden="true"
        >
          <line x1="5" y1="30" x2="95" y2="30" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.5" />
          {viewport.markers.map((marker, index) => (
            <rect
              key={marker.id}
              data-spectra-scan-marker={marker.id}
              x={5 + marker.x * 90}
              y={10 + (index % 3) * 4}
              width={Math.max(marker.width * 90, 0.85)}
              height={16 - (index % 3) * 2}
              fill="currentColor"
              fillOpacity="0.4"
            />
          ))}
        </svg>
        <dl data-spectra-scan-marker-domain>
          <div>
            <dt>{viewport.xAxis}</dt>
            <dd>{formatNumber(viewport.xRange.min)}-{formatNumber(viewport.xRange.max)}</dd>
          </div>
        </dl>
      </div>
    )
  }

  return (
    <div
      className="workspace-preview-spectra-viewer__viewport"
      data-spectra-peak-plot
      data-peak-count={viewport.peaks.length}
      role="img"
      aria-label={`${viewport.title}: ${viewport.message}`}
    >
      <strong>{viewport.title}</strong>
      <p>{viewport.message}</p>
      <svg
        viewBox="0 0 100 70"
        preserveAspectRatio="none"
        data-spectra-peak-plot-svg
        aria-hidden="true"
      >
        <line x1="5" y1="60" x2="95" y2="60" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.5" />
        {viewport.ranges.map((range) => (
          <rect
            key={range.id}
            data-spectra-selected-range={range.id}
            x={5 + range.x * 90}
            y={8 + range.y * 52}
            width={Math.max(range.width * 90, 0.75)}
            height={Math.max(range.height * 52, 1)}
            fill="currentColor"
            fillOpacity="0.08"
            stroke="currentColor"
            strokeOpacity="0.18"
            strokeWidth="0.35"
          />
        ))}
        {viewport.peaks.map((peak) => (
          <g
            key={peak.id}
            data-spectra-peak={peak.id}
            data-selected={peak.selected ? 'true' : 'false'}
          >
            <line
              x1={5 + peak.x * 90}
              y1={60 - peak.lineHeight * 52}
              x2={5 + peak.x * 90}
              y2="60"
              stroke="currentColor"
              strokeOpacity={peak.selected ? 0.95 : 0.65}
              strokeWidth={peak.selected ? 0.9 : 0.45}
            />
            <circle
              cx={5 + peak.x * 90}
              cy={peak.y}
              r={peak.selected ? 1.05 : 0.65}
              fill="currentColor"
              fillOpacity={peak.selected ? 0.95 : 0.65}
            />
          </g>
        ))}
      </svg>
      <dl data-spectra-peak-plot-domain>
        <div>
          <dt>{viewport.xAxis}</dt>
          <dd>{formatNumber(viewport.xRange.min)}-{formatNumber(viewport.xRange.max)}</dd>
        </div>
        <div>
          <dt>Intensity</dt>
          <dd>{formatNumber(viewport.intensityRange.min)}-{formatNumber(viewport.intensityRange.max)}</dd>
        </div>
      </dl>
    </div>
  )
}

function buildSpectraPeakPlot(
  observation: WorkspaceObservation,
  xAxis: string
): SpectraWorkspaceViewerPeakPlot {
  const spectra = observation.spectra
  const sampledPeaks = spectra?.sampledPeaks?.filter(isFinitePeak) ?? []
  if (!sampledPeaks.length) {
    const scanMarkers = spectra?.scanMarkers?.filter(hasScanMarkerRange) ?? []
    if (scanMarkers.length) {
      const xRange = normalizedRange(
        spectra?.mzRange,
        scanMarkers.flatMap((marker) => marker.mzRange ? [marker.mzRange.min, marker.mzRange.max] : []),
        { zeroFloor: false }
      )
      const markers = scanMarkers.slice(0, 512).map((marker, index) => scanMarkerPreview(marker, index, xRange))
      return {
        kind: 'scan-markers',
        title: 'Bounded scan marker preview',
        message: `${formatCount(markers.length, 'scan marker')} rendered from scan range metadata.`,
        xAxis,
        xRange,
        markers
      }
    }

    return {
      kind: 'empty',
      title: 'Bounded peak plot',
      message: spectra
        ? 'No sampled peaks were reported by this bounded preview.'
        : 'Waiting for spectra summary metadata from the preview worker.'
    }
  }

  const xRange = normalizedRange(
    spectra?.mzRange,
    sampledPeaks.map((peak) => peak.mz),
    { zeroFloor: false }
  )
  const intensityRange = normalizedRange(
    spectra?.intensityRange,
    sampledPeaks.map((peak) => peak.intensity),
    { zeroFloor: true }
  )
  const selectedPeaks = observation.selection?.kind === 'spectra' ? observation.selection.peaks ?? [] : []
  const peaks = sampledPeaks.slice(0, 512).map((peak, index) => {
    const x = normalizeInRange(peak.mz, xRange)
    const lineHeight = normalizeInRange(peak.intensity, intensityRange)
    return {
      id: peakPlotId(peak, index),
      label: formatSampledPeakLabel(peak, index),
      mz: peak.mz,
      intensity: peak.intensity,
      x,
      y: 60 - lineHeight * 52,
      lineHeight,
      selected: selectedPeaks.some((selected) => sampledPeakMatchesSelection(peak, selected))
    }
  })
  const ranges = observation.selection?.kind === 'spectra'
    ? observation.selection.ranges.map((range, index) => peakPlotRange(range, index, xAxis, xRange, intensityRange))
    : []

  return {
    kind: 'plot',
    title: 'Bounded peak plot',
    message: `${formatCount(peaks.length, 'sampled peak')} rendered from the workspace observation.`,
    xAxis,
    xRange,
    intensityRange,
    peaks,
    ranges
  }
}

function hasScanMarkerRange(
  marker: SpectraScanMarker
): marker is SpectraScanMarker & { mzRange: { min: number; max: number } } {
  return Boolean(marker.mzRange &&
    Number.isFinite(marker.mzRange.min) &&
    Number.isFinite(marker.mzRange.max) &&
    marker.mzRange.max >= marker.mzRange.min)
}

function scanMarkerPreview(
  marker: SpectraScanMarker & { mzRange: { min: number; max: number } },
  index: number,
  xRange: { min: number; max: number }
): SpectraWorkspaceViewerScanMarker {
  const xStart = normalizeInRange(marker.mzRange.min, xRange)
  const xEnd = normalizeInRange(marker.mzRange.max, xRange)
  return {
    id: scanMarkerId(marker, index),
    label: formatScanMarkerLabel(marker, index),
    x: Math.min(xStart, xEnd),
    width: Math.abs(xEnd - xStart),
    ...(marker.peakCount !== undefined ? { peakCount: marker.peakCount } : {})
  }
}

function scanMarkerId(marker: SpectraScanMarker, index: number): string {
  return compactStrings([
    marker.id,
    marker.scanNumber ? `scan${marker.scanNumber}` : undefined,
    `i${index}`
  ]).join('-').replace(/[^a-zA-Z0-9_-]/g, '-')
}

function formatScanMarkerLabel(marker: SpectraScanMarker, index: number): string {
  return compactStrings([
    marker.id || marker.scanNumber || `scan marker ${index + 1}`,
    marker.msLevel ? `MS level ${marker.msLevel}` : undefined,
    marker.peakCount !== undefined ? formatCount(marker.peakCount, 'peak') : undefined,
    marker.mzRange ? `m/z ${formatNumber(marker.mzRange.min)}-${formatNumber(marker.mzRange.max)}` : undefined
  ]).join(', ')
}

function isFinitePeak(peak: SpectraSampledPeak): boolean {
  return Number.isFinite(peak.mz) && Number.isFinite(peak.intensity) && peak.mz >= 0 && peak.intensity >= 0
}

function peakPlotRange(
  range: SpectraSelectionRange,
  index: number,
  xAxis: string,
  xRange: { min: number; max: number },
  intensityRange: { min: number; max: number }
): SpectraWorkspaceViewerPeakPlotRange {
  const xStart = normalizeInRange(Math.min(range.xStart, range.xEnd), xRange)
  const xEnd = normalizeInRange(Math.max(range.xStart, range.xEnd), xRange)
  const yStart = range.yStart === undefined ? 0 : normalizeInRange(range.yStart, intensityRange)
  const yEnd = range.yEnd === undefined ? 1 : normalizeInRange(range.yEnd, intensityRange)
  const yLow = Math.min(yStart, yEnd)
  const yHigh = Math.max(yStart, yEnd)

  return {
    id: `range-${index}`,
    label: formatSpectraRange(range, xAxis),
    x: xStart,
    y: 1 - yHigh,
    width: xEnd - xStart,
    height: yHigh - yLow
  }
}

function peakPlotId(peak: SpectraSampledPeak, index: number): string {
  return compactStrings([
    peak.spectrumIndex !== undefined ? `s${peak.spectrumIndex}` : undefined,
    peak.scanIndex !== undefined ? `scan${peak.scanIndex}` : undefined,
    peak.peakIndex !== undefined ? `p${peak.peakIndex}` : undefined,
    `i${index}`
  ]).join('-')
}

function formatSampledPeakLabel(peak: SpectraSampledPeak, index: number): string {
  return compactStrings([
    peak.label,
    peak.spectrumIndex !== undefined ? `spectrum ${peak.spectrumIndex}` : undefined,
    peak.scanIndex !== undefined ? `scan ${peak.scanIndex}` : undefined,
    peak.peakIndex !== undefined ? `peak ${peak.peakIndex}` : `sample ${index + 1}`,
    `m/z ${formatNumber(peak.mz)}`,
    `intensity ${formatNumber(peak.intensity)}`
  ]).join(', ')
}

function sampledPeakMatchesSelection(
  peak: SpectraSampledPeak,
  selected: NonNullable<SpectraStructuredSelection['peaks']>[number]
): boolean {
  const mzMatches = selected.mz === undefined || nearlyEqual(peak.mz, selected.mz)
  const intensityMatches = selected.intensity === undefined || nearlyEqual(peak.intensity, selected.intensity)
  const labelMatches = !selected.label || selected.label === peak.label
  return mzMatches && intensityMatches && labelMatches
}

function normalizedRange(
  explicitRange: { min: number; max: number } | undefined,
  values: readonly number[],
  options: { zeroFloor: boolean }
): { min: number; max: number } {
  const finiteValues = values.filter((value) => Number.isFinite(value))
  const explicitMin = explicitRange && Number.isFinite(explicitRange.min) ? explicitRange.min : undefined
  const explicitMax = explicitRange && Number.isFinite(explicitRange.max) ? explicitRange.max : undefined
  const valueMin = finiteValues.length ? Math.min(...finiteValues) : 0
  const valueMax = finiteValues.length ? Math.max(...finiteValues) : 1
  let min = explicitMin ?? valueMin
  let max = explicitMax ?? valueMax

  if (options.zeroFloor) min = Math.min(0, min)
  if (max <= min) {
    const pad = Math.max(Math.abs(max || min) * 0.05, 1)
    min = options.zeroFloor ? 0 : min - pad
    max += pad
  }

  return { min, max }
}

function normalizeInRange(value: number, range: { min: number; max: number }): number {
  if (range.max <= range.min) return 0
  return clamp((value - range.min) / (range.max - range.min), 0, 1)
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.0001, Math.abs(right) * 0.000001)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createSelectionGroup(
  id: string,
  title: string,
  items: readonly string[] | undefined,
  singular: string,
  plural = `${singular}s`
): SpectraWorkspaceViewerGroup | null {
  const normalized = compactStrings(items)
  if (!normalized.length) return null

  return {
    id,
    title,
    summary: formatCount(normalized.length, singular, plural),
    items: normalized
  }
}

function formatSpectraRange(
  range: NonNullable<SpectraStructuredSelection['ranges']>[number],
  xAxis: string
): string {
  return compactStrings([
    `${xAxis} ${formatNumber(range.xStart)}-${formatNumber(range.xEnd)}`,
    formatOptionalRange('intensity', range.yStart, range.yEnd)
  ]).join(', ')
}

function formatOptionalRange(label: string, start: number | undefined, end: number | undefined): string | undefined {
  if (start !== undefined && end !== undefined) return `${label} ${formatNumber(start)}-${formatNumber(end)}`
  if (start !== undefined) return `${label} >= ${formatNumber(start)}`
  if (end !== undefined) return `${label} <= ${formatNumber(end)}`
  return undefined
}

function formatPeak(peak: NonNullable<SpectraStructuredSelection['peaks']>[number]): string {
  const parts = compactStrings([
    peak.label,
    peak.mz !== undefined ? `m/z ${formatNumber(peak.mz)}` : undefined,
    peak.intensity !== undefined ? `intensity ${formatNumber(peak.intensity)}` : undefined
  ])

  return parts.length ? parts.join(', ') : 'Unlabeled peak'
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
): SpectraWorkspaceViewerRow {
  return { id, label, value, description }
}

function compactGroups(
  groups: Array<SpectraWorkspaceViewerGroup | null | undefined>
): SpectraWorkspaceViewerGroup[] {
  return groups.filter((group): group is SpectraWorkspaceViewerGroup => Boolean(group))
}

function compactStrings(values: readonly (string | null | undefined | false)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)))
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
