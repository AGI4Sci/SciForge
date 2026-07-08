import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_SPECTRA_ACTIONS,
  WORKSPACE_SPECTRA_CONTRACT_VERSION,
  WORKSPACE_SPECTRA_MAX_ITEMS,
  WORKSPACE_SPECTRA_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_SPECTRA_MAX_WARNINGS,
  WORKSPACE_SPECTRA_PLUGIN_ID,
  workspaceSpectraAnnotateRangeInputSchema,
  workspaceSpectraAnnotateRangeResultSchema,
  workspaceSpectraExportPeakListInputSchema,
  workspaceSpectraExportPeakListResultSchema,
  workspaceSpectraPeakSelectionResultSchema,
  workspaceSpectraPreviewResultSchema,
  workspaceSpectraSelectPeaksByRangeInputSchema,
  type NormalizedWorkspaceSpectraPreviewInput,
  type WorkspaceSpectraAnnotationRange,
  type WorkspaceSpectraAnnotateRangeInput,
  type WorkspaceSpectraAnnotateRangeResult,
  type WorkspaceSpectraExportPeakListInput,
  type WorkspaceSpectraExportPeakListResult,
  type WorkspaceSpectraFcsPopulationAnnotation,
  type WorkspaceFcsEventAxis,
  type WorkspaceFcsPlaceholderMetadata,
  type WorkspaceMgfSpectrumSummary,
  type WorkspaceSpectraNumericRange,
  type WorkspaceSpectraObservation,
  type WorkspaceSpectraPeakSample,
  type WorkspaceSpectraPeakSelectionRange,
  type WorkspaceSpectraPeakSelectionResult,
  type WorkspaceSpectraPreviewResult,
  type WorkspaceSpectraRangeAnnotationKind,
  type WorkspaceSpectraResolvedFormat,
  type WorkspaceSpectraSelectPeaksByRangeInput,
  type WorkspaceSpectraSelection,
  type WorkspaceSpectraScanMarker
} from './contract.js'

type RangeAccumulator = {
  min: number | undefined
  max: number | undefined
}

type SpectraSummary = {
  format: WorkspaceSpectraResolvedFormat
  spectrumCount: number
  peakCount: number
  scanCount: number
  mzRange?: WorkspaceSpectraNumericRange
  intensityRange?: WorkspaceSpectraNumericRange
  spectra: WorkspaceMgfSpectrumSummary[]
  scanMarkers: WorkspaceSpectraScanMarker[]
  sampledPeaks: WorkspaceSpectraPeakSample[]
  fcs?: WorkspaceFcsPlaceholderMetadata
  warnings: string[]
}

type ObservationBuildInput = {
  input: NormalizedWorkspaceSpectraPreviewInput
  summary: SpectraSummary
}

type ScanSelectionResult = {
  scanCount: number
  scanMarkers: WorkspaceSpectraScanMarker[]
  mzRange?: WorkspaceSpectraNumericRange
  intensityRange?: WorkspaceSpectraNumericRange
  indexRange?: WorkspaceSpectraNumericRange
  truncated: boolean
}

type FcsSegmentOffsets = NonNullable<WorkspaceFcsPlaceholderMetadata['segmentOffsets']>

const NUMBER_PATTERN = '[+-]?(?:(?:\\d+\\.?\\d*)|(?:\\.\\d+))(?:[eE][+-]?\\d+)?'
const MGF_PEAK_LINE_PATTERN = new RegExp(`^(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})(?:\\s|$)`)
const XML_ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const XML_CV_PARAM_PATTERN = /<cvParam\b[^>]*>/gi
const FCS_VERSION_PATTERN = /^FCS\d\.\d/
const FCS_KEYWORDS = ['$FIL', '$CYT', '$CYTSN', '$DATE', '$BTIM', '$ETIM'] as const

export function createWorkspaceSpectraPreview(
  input: NormalizedWorkspaceSpectraPreviewInput
): WorkspaceSpectraPreviewResult {
  const summary = summarizeSpectraText(input)

  return workspaceSpectraPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_SPECTRA_CONTRACT_VERSION,
    format: summary.format,
    spectrumCount: summary.spectrumCount,
    peakCount: summary.peakCount,
    scanCount: summary.scanCount,
    ...(summary.mzRange ? { mzRange: summary.mzRange } : {}),
    ...(summary.intensityRange ? { intensityRange: summary.intensityRange } : {}),
    spectra: summary.spectra,
    scanMarkers: summary.scanMarkers,
    sampledPeaks: summary.sampledPeaks,
    ...(summary.fcs ? { fcs: summary.fcs } : {}),
    warnings: boundedWarnings(summary.warnings),
    ...(input.includeObservation ? { observation: buildWorkspaceObservation({ input, summary }) } : {})
  })
}

export function selectPeaksByRange(input: WorkspaceSpectraSelectPeaksByRangeInput): WorkspaceSpectraPeakSelectionResult {
  const normalized = workspaceSpectraSelectPeaksByRangeInputSchema.parse(input)
  const spectrumIndexes = normalized.range.spectrumIndexes ? new Set(normalized.range.spectrumIndexes) : undefined
  const mzRange = createRangeAccumulator()
  const intensityRange = createRangeAccumulator()
  const peaks: WorkspaceSpectraPeakSample[] = []
  let peakCount = 0

  for (const peak of normalized.peaks) {
    if (spectrumIndexes && (peak.spectrumIndex === undefined || !spectrumIndexes.has(peak.spectrumIndex))) {
      continue
    }
    if (normalized.range.mzMin !== undefined && peak.mz < normalized.range.mzMin) continue
    if (normalized.range.mzMax !== undefined && peak.mz > normalized.range.mzMax) continue
    if (normalized.range.intensityMin !== undefined && peak.intensity < normalized.range.intensityMin) continue
    if (normalized.range.intensityMax !== undefined && peak.intensity > normalized.range.intensityMax) continue

    peakCount += 1
    addRangeValue(mzRange, peak.mz)
    addRangeValue(intensityRange, peak.intensity)
    if (peaks.length < normalized.maxPeaks) {
      peaks.push({ ...peak })
    }
  }

  return workspaceSpectraPeakSelectionResultSchema.parse({
    peakCount,
    peaks,
    ...(rangeFromAccumulator(mzRange) ? { mzRange: rangeFromAccumulator(mzRange) } : {}),
    ...(rangeFromAccumulator(intensityRange) ? { intensityRange: rangeFromAccumulator(intensityRange) } : {}),
    truncated: peaks.length < peakCount
  })
}

export function annotateRange(input: WorkspaceSpectraAnnotateRangeInput): WorkspaceSpectraAnnotateRangeResult {
  const normalized = workspaceSpectraAnnotateRangeInputSchema.parse(input)
  const preview = normalized.preview
  const warnings: string[] = []
  const peakSelection = selectPeaksByRange({
    peaks: preview.sampledPeaks,
    range: peakSelectionRangeFromAnnotationRange(normalized.range),
    maxPeaks: normalized.maxPeaks
  })
  const scanSelection = selectScanMarkersByAnnotationRange(
    preview.scanMarkers,
    normalized.range,
    normalized.maxScanMarkers
  )
  const fcsPopulation = preview.format === 'fcs' || preview.fcs
    ? buildFcsPopulationAnnotation(preview, normalized.range)
    : undefined
  const kind = annotationKindForPreview(preview, normalized.range, peakSelection.peakCount, scanSelection.scanCount)

  if (preview.peakCount > preview.sampledPeaks.length) {
    warnings.push(`Annotation peak matching uses ${preview.sampledPeaks.length} sampled/bounded peaks from preview, not all ${preview.peakCount} source peaks.`)
  }
  if (peakSelection.truncated) {
    warnings.push(`Annotation includes ${peakSelection.peaks.length} of ${peakSelection.peakCount} matching sampled peaks.`)
  }
  if (scanSelection.truncated) {
    warnings.push(`Annotation includes ${scanSelection.scanMarkers.length} of ${scanSelection.scanCount} matching scan markers.`)
  }
  if (fcsPopulation) {
    warnings.push('FCS gate annotation is placeholder-only; binary event matrices are not decoded by this worker.')
    const totalEvents = preview.fcs?.totalEvents
    if (totalEvents !== undefined && fcsPopulation.eventRange && fcsPopulation.eventRange.max >= totalEvents) {
      warnings.push(`Requested event range extends beyond the visible FCS $TOT value of ${totalEvents}.`)
    }
  }

  const bounded = preview.peakCount > preview.sampledPeaks.length ||
    peakSelection.truncated ||
    scanSelection.truncated ||
    Boolean(fcsPopulation)
  const summaryText = buildRangeAnnotationSummaryText({
    label: normalized.label,
    kind,
    peakCount: peakSelection.peakCount,
    scanCount: scanSelection.scanCount,
    eventCount: fcsPopulation?.estimatedEventCount,
    bounded
  })
  const selection = buildRangeAnnotationSelection({
    preview,
    range: normalized.range,
    peaks: peakSelection.peaks,
    peakMzRange: peakSelection.mzRange,
    peakIntensityRange: peakSelection.intensityRange,
    scanSelection,
    fcsPopulation
  })
  const annotationSummary = {
    id: annotationId(normalized.label),
    kind,
    label: normalized.label,
    ...(normalized.body ? { body: normalized.body } : {}),
    range: normalized.range,
    source: {
      format: preview.format,
      spectrumCount: preview.spectrumCount,
      peakCount: preview.peakCount,
      scanCount: preview.scanCount
    },
    peakCount: peakSelection.peakCount,
    scanCount: scanSelection.scanCount,
    ...(fcsPopulation?.estimatedEventCount !== undefined ? { eventCount: fcsPopulation.estimatedEventCount } : {}),
    sampledOnly: true,
    bounded,
    ...(fcsPopulation ? { fcsPopulation } : {}),
    summary: summaryText
  }

  return workspaceSpectraAnnotateRangeResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_SPECTRA_CONTRACT_VERSION,
    annotationSummary,
    selection,
    peaks: peakSelection.peaks,
    scanMarkers: scanSelection.scanMarkers,
    visibleText: buildRangeAnnotationVisibleText({
      summary: summaryText,
      body: normalized.body,
      peaks: peakSelection.peaks,
      scanMarkers: scanSelection.scanMarkers,
      fcsPopulation,
      warnings
    }),
    warnings: boundedWarnings(warnings)
  })
}

export function exportPeakList(input: WorkspaceSpectraExportPeakListInput): WorkspaceSpectraExportPeakListResult {
  const normalized = workspaceSpectraExportPeakListInputSchema.parse(input)
  const preview = normalized.preview
  const selection = selectPeaksByRange({
    peaks: preview.sampledPeaks,
    range: normalized.range,
    maxPeaks: normalized.maxPeaks
  })
  const warnings: string[] = []

  if (preview.format === 'fcs' || preview.fcs) {
    warnings.push('FCS previews do not decode binary event matrices; peak-list export can only return sampled peak data when present.')
  }
  if (preview.peakCount > preview.sampledPeaks.length) {
    warnings.push(`Peak-list export uses ${preview.sampledPeaks.length} sampled/bounded peaks from preview, not all ${preview.peakCount} source peaks.`)
  }
  if (selection.truncated) {
    warnings.push(`Peak-list export includes ${selection.peaks.length} of ${selection.peakCount} matching sampled peaks.`)
  }
  if (preview.sampledPeaks.length === 0) {
    warnings.push('Preview contains no sampled peaks to export.')
  }

  const summary = {
    sourceFormat: preview.format,
    sampledOnly: true as const,
    bounded: true as const,
    sourcePeakCount: preview.peakCount,
    totalSampledPeakCount: preview.sampledPeaks.length,
    selectedSampledPeakCount: selection.peakCount,
    exportedPeakCount: selection.peaks.length,
    truncated: selection.truncated,
    range: normalized.range,
    peaks: selection.peaks
  }

  return workspaceSpectraExportPeakListResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_SPECTRA_CONTRACT_VERSION,
    format: normalized.format,
    sampledOnly: true,
    bounded: true,
    ...(normalized.format === 'json'
      ? {}
      : { text: buildPeakListText(selection.peaks, normalized.format === 'csv' ? ',' : '\t', normalized.includeHeader) }),
    summary,
    warnings: boundedWarnings(warnings)
  })
}

function peakSelectionRangeFromAnnotationRange(range: WorkspaceSpectraAnnotationRange): WorkspaceSpectraPeakSelectionRange {
  const peakRange: WorkspaceSpectraPeakSelectionRange = {}
  if (range.mzMin !== undefined) peakRange.mzMin = range.mzMin
  if (range.mzMax !== undefined) peakRange.mzMax = range.mzMax
  if (range.intensityMin !== undefined) peakRange.intensityMin = range.intensityMin
  if (range.intensityMax !== undefined) peakRange.intensityMax = range.intensityMax
  if (range.spectrumIndexes !== undefined) peakRange.spectrumIndexes = range.spectrumIndexes
  return peakRange
}

function selectScanMarkersByAnnotationRange(
  markers: WorkspaceSpectraScanMarker[],
  range: WorkspaceSpectraAnnotationRange,
  maxScanMarkers: number
): ScanSelectionResult {
  const scanIndexes = range.scanIndexes ? new Set(range.scanIndexes) : undefined
  const mzRange = createRangeAccumulator()
  const intensityRange = createRangeAccumulator()
  const indexRange = createRangeAccumulator()
  const scanMarkers: WorkspaceSpectraScanMarker[] = []
  let scanCount = 0

  for (const marker of markers) {
    if (scanIndexes && !scanIndexes.has(marker.index)) continue
    if (!rangeIntersectsFilter(marker.mzRange, range.mzMin, range.mzMax)) continue
    if (!rangeIntersectsFilter(marker.intensityRange, range.intensityMin, range.intensityMax)) continue

    scanCount += 1
    mergeRange(mzRange, marker.mzRange)
    mergeRange(intensityRange, marker.intensityRange)
    addRangeValue(indexRange, marker.index)
    if (scanMarkers.length < maxScanMarkers) {
      scanMarkers.push({ ...marker })
    }
  }

  return {
    scanCount,
    scanMarkers,
    ...(rangeFromAccumulator(mzRange) ? { mzRange: rangeFromAccumulator(mzRange) } : {}),
    ...(rangeFromAccumulator(intensityRange) ? { intensityRange: rangeFromAccumulator(intensityRange) } : {}),
    ...(rangeFromAccumulator(indexRange) ? { indexRange: rangeFromAccumulator(indexRange) } : {}),
    truncated: scanMarkers.length < scanCount
  }
}

function buildFcsPopulationAnnotation(
  preview: WorkspaceSpectraPreviewResult,
  range: WorkspaceSpectraAnnotationRange
): WorkspaceSpectraFcsPopulationAnnotation {
  const totalEvents = preview.fcs?.totalEvents
  const eventMin = range.eventMin ?? 0
  const eventMax = range.eventMax ?? (totalEvents !== undefined && totalEvents > 0 ? totalEvents - 1 : eventMin)
  const eventRange = {
    min: Math.min(eventMin, eventMax),
    max: Math.max(eventMin, eventMax)
  }
  const axes = range.axes && range.axes.length > 0
    ? range.axes
    : preview.fcs?.gating?.axes.length
      ? preview.fcs.gating.axes
      : (preview.fcs?.eventAxes ?? []).map(formatFcsAxisLabel)

  return {
    status: 'placeholder',
    binaryParsing: false,
    axes,
    eventRange,
    estimatedEventCount: Math.max(0, eventRange.max - eventRange.min + 1),
    notes: [
      'Population/gate annotation is generated from visible FCS metadata only.',
      'No FCS event matrix was decoded, filtered, or exported.'
    ]
  }
}

function annotationKindForPreview(
  preview: WorkspaceSpectraPreviewResult,
  range: WorkspaceSpectraAnnotationRange,
  peakCount: number,
  scanCount: number
): WorkspaceSpectraRangeAnnotationKind {
  if (preview.format === 'fcs' || preview.fcs) return 'population-gate'
  if (preview.scanMarkers.length > 0 && (range.scanIndexes !== undefined || preview.sampledPeaks.length === 0)) {
    return 'scan-range'
  }
  if (peakCount > 0 || preview.sampledPeaks.length > 0 || hasPeakAnnotationFilter(range)) {
    return 'peak-range'
  }
  if (scanCount > 0 || range.scanIndexes !== undefined) return 'scan-range'
  return 'range'
}

function hasPeakAnnotationFilter(range: WorkspaceSpectraAnnotationRange): boolean {
  return range.mzMin !== undefined ||
    range.mzMax !== undefined ||
    range.intensityMin !== undefined ||
    range.intensityMax !== undefined ||
    range.spectrumIndexes !== undefined
}

function buildRangeAnnotationSummaryText(input: {
  label: string
  kind: WorkspaceSpectraRangeAnnotationKind
  peakCount: number
  scanCount: number
  eventCount: number | undefined
  bounded: boolean
}): string {
  const scope = input.bounded ? 'sampled/bounded preview data' : 'preview data'
  if (input.kind === 'population-gate') {
    const events = input.eventCount !== undefined ? `${input.eventCount} placeholder events` : 'placeholder event range'
    return truncateText(`${input.label}: ${events} from ${scope}; FCS event matrices are not decoded.`, 1000)
  }
  if (input.kind === 'scan-range') {
    return truncateText(`${input.label}: ${input.scanCount} scan markers and ${input.peakCount} sampled peaks from ${scope}.`, 1000)
  }
  if (input.kind === 'peak-range') {
    return truncateText(`${input.label}: ${input.peakCount} sampled peaks and ${input.scanCount} scan markers from ${scope}.`, 1000)
  }
  return truncateText(`${input.label}: range annotation over ${scope}.`, 1000)
}

function buildRangeAnnotationSelection(input: {
  preview: WorkspaceSpectraPreviewResult
  range: WorkspaceSpectraAnnotationRange
  peaks: WorkspaceSpectraPeakSample[]
  peakMzRange: WorkspaceSpectraNumericRange | undefined
  peakIntensityRange: WorkspaceSpectraNumericRange | undefined
  scanSelection: ScanSelectionResult
  fcsPopulation: WorkspaceSpectraFcsPopulationAnnotation | undefined
}): WorkspaceSpectraSelection {
  if (input.fcsPopulation) {
    const eventRange = input.fcsPopulation.eventRange ?? { min: 0, max: 0 }
    return {
      kind: 'spectra',
      ranges: [{
        xStart: eventRange.min,
        xEnd: eventRange.max
      }]
    }
  }

  const xRange = rangeFromRequestedOrObserved(
    input.range.mzMin,
    input.range.mzMax,
    input.peakMzRange ?? input.scanSelection.mzRange ?? input.preview.mzRange,
    input.scanSelection.indexRange
  )
  const yRange = rangeFromRequestedOrObserved(
    input.range.intensityMin,
    input.range.intensityMax,
    input.peakIntensityRange ?? input.scanSelection.intensityRange ?? input.preview.intensityRange,
    undefined
  )
  const includeY = input.range.intensityMin !== undefined ||
    input.range.intensityMax !== undefined ||
    input.peakIntensityRange !== undefined ||
    input.scanSelection.intensityRange !== undefined ||
    input.preview.intensityRange !== undefined

  return {
    kind: 'spectra',
    ranges: [{
      xStart: xRange.min,
      xEnd: xRange.max,
      ...(includeY ? {
        yStart: yRange.min,
        yEnd: yRange.max
      } : {})
    }],
    ...(input.peaks.length > 0
      ? {
          peaks: input.peaks.map((peak) => ({
            mz: peak.mz,
            intensity: peak.intensity,
            ...(peak.label ? { label: peak.label } : {})
          }))
        }
      : {})
  }
}

function buildRangeAnnotationVisibleText(input: {
  summary: string
  body: string | undefined
  peaks: WorkspaceSpectraPeakSample[]
  scanMarkers: WorkspaceSpectraScanMarker[]
  fcsPopulation: WorkspaceSpectraFcsPopulationAnnotation | undefined
  warnings: string[]
}): string {
  const lines = [input.summary]

  if (input.body) {
    lines.push(input.body)
  }

  if (input.fcsPopulation) {
    const eventRange = input.fcsPopulation.eventRange
    if (eventRange) {
      lines.push(`FCS population placeholder range: events ${formatRange(eventRange)}.`)
    }
    if (input.fcsPopulation.axes.length > 0) {
      lines.push(`Gate axes: ${input.fcsPopulation.axes.slice(0, 12).join(', ')}.`)
    }
    lines.push(...input.fcsPopulation.notes)
  }

  if (input.peaks.length > 0) {
    lines.push('Sampled peaks:')
    lines.push(...input.peaks.slice(0, 20).map(formatPeakSampleLine))
  }

  if (input.scanMarkers.length > 0) {
    lines.push('Scan markers:')
    lines.push(...input.scanMarkers.slice(0, 20).map(formatScanMarkerLine))
  }

  if (input.warnings.length > 0) {
    lines.push('Warnings:')
    lines.push(...input.warnings.slice(0, WORKSPACE_SPECTRA_MAX_WARNINGS).map((warning) => `- ${warning}`))
  }

  return truncateText(lines.join('\n'), WORKSPACE_SPECTRA_MAX_VISIBLE_TEXT_CHARS)
}

function buildPeakListText(peaks: WorkspaceSpectraPeakSample[], delimiter: ',' | '\t', includeHeader: boolean): string {
  const columns = ['spectrumIndex', 'scanIndex', 'peakIndex', 'mz', 'intensity', 'label'] as const
  const rows = includeHeader ? [columns.join(delimiter)] : []

  for (const peak of peaks) {
    rows.push([
      peak.spectrumIndex,
      peak.scanIndex,
      peak.peakIndex,
      peak.mz,
      peak.intensity,
      peak.label
    ].map((value) => serializeDelimitedValue(value, delimiter)).join(delimiter))
  }

  return rows.join('\n')
}

function serializeDelimitedValue(value: string | number | undefined, delimiter: ',' | '\t'): string {
  if (value === undefined) return ''
  const text = String(value)
  if (delimiter === '\t') return text.replace(/[\t\r\n]+/g, ' ')
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function rangeIntersectsFilter(
  observedRange: WorkspaceSpectraNumericRange | undefined,
  filterMin: number | undefined,
  filterMax: number | undefined
): boolean {
  if (filterMin === undefined && filterMax === undefined) return true
  if (!observedRange) return false
  if (filterMin !== undefined && observedRange.max < filterMin) return false
  if (filterMax !== undefined && observedRange.min > filterMax) return false
  return true
}

function rangeFromRequestedOrObserved(
  requestedMin: number | undefined,
  requestedMax: number | undefined,
  observedRange: WorkspaceSpectraNumericRange | undefined,
  fallbackRange: WorkspaceSpectraNumericRange | undefined
): WorkspaceSpectraNumericRange {
  const min = requestedMin ?? observedRange?.min ?? fallbackRange?.min ?? 0
  const max = requestedMax ?? observedRange?.max ?? fallbackRange?.max ?? min
  return {
    min: Math.min(min, max),
    max: Math.max(min, max)
  }
}

function annotationId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return truncateText(`annotation-${slug || 'range'}`, 256)
}

function formatPeakSampleLine(peak: WorkspaceSpectraPeakSample): string {
  const scope = [
    peak.spectrumIndex !== undefined ? `spectrum ${peak.spectrumIndex}` : undefined,
    peak.scanIndex !== undefined ? `scan ${peak.scanIndex}` : undefined,
    peak.peakIndex !== undefined ? `peak ${peak.peakIndex}` : undefined
  ].filter(Boolean).join(', ')
  return `- ${scope ? `${scope}: ` : ''}m/z ${peak.mz}, intensity ${peak.intensity}${peak.label ? `, ${peak.label}` : ''}.`
}

function formatScanMarkerLine(marker: WorkspaceSpectraScanMarker): string {
  const label = marker.scanNumber ?? marker.id ?? `${marker.index}`
  const details = [
    marker.msLevel ? `msLevel ${marker.msLevel}` : undefined,
    marker.peakCount !== undefined ? `${marker.peakCount} peaks` : undefined,
    marker.mzRange ? `m/z ${formatRange(marker.mzRange)}` : undefined,
    marker.intensityRange ? `intensity ${formatRange(marker.intensityRange)}` : undefined
  ].filter(Boolean).join(', ')
  return `- ${label}${details ? `: ${details}` : ''}.`
}

function formatFcsAxisLabel(axis: WorkspaceFcsEventAxis): string {
  if (axis.label && axis.name && axis.label !== axis.name) return `${axis.name} (${axis.label})`
  return axis.label ?? axis.name ?? `P${axis.index}`
}

function summarizeSpectraText(input: NormalizedWorkspaceSpectraPreviewInput): SpectraSummary {
  const format = resolveFormat(input)

  if (format === 'mgf') return summarizeMgf(input.text)
  if (format === 'mzml') return summarizeXmlScans(input.text, 'mzml')
  if (format === 'mzxml') return summarizeXmlScans(input.text, 'mzxml')
  if (format === 'fcs') return summarizeFcs(input.text)

  return {
    format: 'unknown',
    spectrumCount: 0,
    peakCount: 0,
    scanCount: 0,
    spectra: [],
    scanMarkers: [],
    sampledPeaks: [],
    warnings: ['Unable to infer spectra format from path or visible text.']
  }
}

function summarizeMgf(text: string): SpectraSummary {
  const spectra: WorkspaceMgfSpectrumSummary[] = []
  const sampledPeaks: WorkspaceSpectraPeakSample[] = []
  const warnings: string[] = []
  let current: WorkspaceMgfSpectrumSummary | undefined
  let totalPeakCount = 0
  let spectrumIndex = 0
  const mzRange = createRangeAccumulator()
  const intensityRange = createRangeAccumulator()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^BEGIN\s+IONS\b/i.test(line)) {
      if (current) {
        warnings.push(`Spectrum ${current.index} started before a matching END IONS marker; closed best-effort.`)
        spectra.push(current)
      }
      current = {
        index: spectrumIndex,
        peakCount: 0
      }
      spectrumIndex += 1
      continue
    }

    if (/^END\s+IONS\b/i.test(line)) {
      if (current) {
        spectra.push(current)
        current = undefined
      } else {
        warnings.push('Encountered END IONS without a matching BEGIN IONS marker.')
      }
      continue
    }

    if (!current) continue

    const assignmentIndex = line.indexOf('=')
    if (assignmentIndex > 0) {
      applyMgfMetadata(current, line.slice(0, assignmentIndex), line.slice(assignmentIndex + 1))
      continue
    }

    const peak = parseMgfPeakLine(line)
    if (peak) {
      const peakIndex = current.peakCount
      current.peakCount += 1
      totalPeakCount += 1
      current.mzRange = extendRange(current.mzRange, peak.mz)
      current.intensityRange = extendRange(current.intensityRange, peak.intensity)
      addRangeValue(mzRange, peak.mz)
      addRangeValue(intensityRange, peak.intensity)
      if (sampledPeaks.length < WORKSPACE_SPECTRA_MAX_ITEMS) {
        sampledPeaks.push({
          spectrumIndex: current.index,
          peakIndex,
          mz: peak.mz,
          intensity: peak.intensity
        })
      }
    }
  }

  if (current) {
    warnings.push(`Spectrum ${current.index} ended without an END IONS marker; included best-effort.`)
    spectra.push(current)
  }

  const boundedSpectra = spectra.slice(0, WORKSPACE_SPECTRA_MAX_ITEMS)
  if (boundedSpectra.length < spectra.length) {
    warnings.push(`MGF summary includes ${boundedSpectra.length} of ${spectra.length} spectra.`)
  }
  if (sampledPeaks.length < totalPeakCount) {
    warnings.push(`Sampled peaks include ${sampledPeaks.length} of ${totalPeakCount} visible MGF peaks.`)
  }

  return {
    format: 'mgf',
    spectrumCount: spectra.length,
    peakCount: totalPeakCount,
    scanCount: 0,
    ...(rangeFromAccumulator(mzRange) ? { mzRange: rangeFromAccumulator(mzRange) } : {}),
    ...(rangeFromAccumulator(intensityRange) ? { intensityRange: rangeFromAccumulator(intensityRange) } : {}),
    spectra: boundedSpectra,
    scanMarkers: [],
    sampledPeaks,
    warnings
  }
}

function applyMgfMetadata(spectrum: WorkspaceMgfSpectrumSummary, rawKey: string, rawValue: string): void {
  const key = rawKey.trim().toUpperCase()
  const value = truncateText(rawValue.trim(), 1000)

  if (key === 'TITLE' && value) {
    spectrum.title = value
    return
  }

  if (key === 'PEPMASS') {
    const precursorMz = Number.parseFloat(value.split(/\s+/)[0] ?? '')
    if (Number.isFinite(precursorMz) && precursorMz >= 0) {
      spectrum.precursorMz = precursorMz
    }
    return
  }

  if (key === 'CHARGE' && value) {
    spectrum.charge = value
  }
}

function summarizeXmlScans(text: string, format: 'mzml' | 'mzxml'): SpectraSummary {
  const markerTagName = format === 'mzml' ? 'spectrum' : 'scan'
  const markers: WorkspaceSpectraScanMarker[] = []
  let totalPeakCount = 0
  let markerCount = 0
  const mzRange = createRangeAccumulator()
  const intensityRange = createRangeAccumulator()

  for (const element of iterateXmlElements(text, markerTagName)) {
    const attributes = parseXmlAttributes(element.tag)
    const marker = format === 'mzml'
      ? markerFromMzMlSpectrum(markerCount, attributes, element.block)
      : markerFromMzXmlScan(markerCount, attributes)

    markerCount += 1
    if (marker.peakCount !== undefined) {
      totalPeakCount += marker.peakCount
    }
    mergeRange(mzRange, marker.mzRange)
    mergeRange(intensityRange, marker.intensityRange)
    if (markers.length < WORKSPACE_SPECTRA_MAX_ITEMS) {
      markers.push(marker)
    }
  }

  const warnings = markers.length < markerCount
    ? [`${format} summary includes ${markers.length} of ${markerCount} scan markers.`]
    : []

  return {
    format,
    spectrumCount: markerCount,
    peakCount: totalPeakCount,
    scanCount: markerCount,
    ...(rangeFromAccumulator(mzRange) ? { mzRange: rangeFromAccumulator(mzRange) } : {}),
    ...(rangeFromAccumulator(intensityRange) ? { intensityRange: rangeFromAccumulator(intensityRange) } : {}),
    spectra: [],
    scanMarkers: markers,
    sampledPeaks: [],
    warnings
  }
}

function markerFromMzMlSpectrum(index: number, attributes: Record<string, string>, block: string): WorkspaceSpectraScanMarker {
  const id = cleanOptionalText(attributes.id)
  const scanNumber = extractScanNumber(id) ?? cleanOptionalText(attributes.index)
  const msLevel = cleanOptionalText(findMzMlCvParamValue(block, ['MS:1000511', 'ms level']))
  const peakCount = parseNonNegativeInteger(attributes.defaultArrayLength)
  const lowMz = findMzMlCvParamNumber(block, ['MS:1000528', 'lowest observed m/z'])
  const highMz = findMzMlCvParamNumber(block, ['MS:1000527', 'highest observed m/z'])
  const basePeakMz = findMzMlCvParamNumber(block, ['MS:1000504', 'base peak m/z'])
  const basePeakIntensity = findMzMlCvParamNumber(block, ['MS:1000505', 'base peak intensity'])
  const mzRange = rangeFromBounds(lowMz, highMz) ?? rangeFromPoint(basePeakMz)
  const intensityRange = rangeFromPoint(basePeakIntensity)

  return {
    index,
    ...(id ? { id } : {}),
    ...(scanNumber ? { scanNumber } : {}),
    ...(msLevel ? { msLevel } : {}),
    ...(peakCount !== undefined ? { peakCount } : {}),
    ...(mzRange ? { mzRange } : {}),
    ...(intensityRange ? { intensityRange } : {})
  }
}

function markerFromMzXmlScan(index: number, attributes: Record<string, string>): WorkspaceSpectraScanMarker {
  const scanNumber = cleanOptionalText(attributes.num)
  const id = cleanOptionalText(attributes.id) ?? (scanNumber ? `scan ${scanNumber}` : undefined)
  const msLevel = cleanOptionalText(attributes.msLevel)
  const peakCount = parseNonNegativeInteger(attributes.peaksCount)
  const lowMz = parseNonNegativeNumber(attributes.lowMz)
  const highMz = parseNonNegativeNumber(attributes.highMz)
  const basePeakMz = parseNonNegativeNumber(attributes.basePeakMz)
  const basePeakIntensity = parseNonNegativeNumber(attributes.basePeakIntensity)
  const mzRange = rangeFromBounds(lowMz, highMz) ?? rangeFromPoint(basePeakMz)
  const intensityRange = rangeFromPoint(basePeakIntensity)

  return {
    index,
    ...(id ? { id } : {}),
    ...(scanNumber ? { scanNumber } : {}),
    ...(msLevel ? { msLevel } : {}),
    ...(peakCount !== undefined ? { peakCount } : {}),
    ...(mzRange ? { mzRange } : {}),
    ...(intensityRange ? { intensityRange } : {})
  }
}

function summarizeFcs(text: string): SpectraSummary {
  const version = FCS_VERSION_PATTERN.exec(text.slice(0, 16))?.[0]
  const segmentOffsets = parseFcsSegmentOffsets(text)
  const totalEvents = parseFcsKeywordInteger(text, '$TOT')
  const parameterCount = parseFcsKeywordInteger(text, '$PAR')
  const eventAxes = buildFcsEventAxes(text, parameterCount)
  const keywords: Array<{ key: string, value: string }> = FCS_KEYWORDS
    .map((key): { key: string, value: string } | undefined => {
      const value = readFcsKeywordValue(text, key)
      return value ? { key, value } : undefined
    })
    .filter((keyword): keyword is { key: string, value: string } => keyword !== undefined)

  const fcs: WorkspaceFcsPlaceholderMetadata = {
    metadataStatus: 'placeholder',
    binaryParsing: false,
    ...(version ? { version } : {}),
    ...(totalEvents !== undefined ? { totalEvents } : {}),
    ...(parameterCount !== undefined ? { parameterCount } : {}),
    ...(segmentOffsets ? { segmentOffsets } : {}),
    keywords,
    ...(eventAxes.length > 0 ? { eventAxes } : {}),
    gating: {
      status: 'placeholder',
      implemented: false,
      axes: eventAxes.map((axis) => axis.label ?? axis.name ?? `P${axis.index}`),
      notes: ['Interactive FCS gating is reserved for the full event-matrix parser.']
    },
    notes: ['FCS preview reads visible header and keyword text only; binary event matrices are not parsed.']
  }

  return {
    format: 'fcs',
    spectrumCount: 0,
    peakCount: 0,
    scanCount: 0,
    spectra: [],
    scanMarkers: [],
    sampledPeaks: [],
    fcs,
    warnings: version ? [] : ['FCS version marker was not visible in the text preview.']
  }
}

function buildWorkspaceObservation({ input, summary }: ObservationBuildInput): WorkspaceSpectraObservation {
  const title = titleForPath(input.path, summary.format)
  const selection = buildSpectraSelection(summary)
  const annotations = summary.warnings.map((warning, index) => ({
    id: `warning-${index + 1}`,
    kind: 'warning',
    summary: warning
  }))

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.path?.trim() || defaultPathForFormat(summary.format),
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
      mimeType: input.mimeType ?? defaultMimeType(summary.format),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.mtimeMs !== undefined ? { mtimeMs: input.mtimeMs } : {})
    },
    view: {
      pluginId: WORKSPACE_SPECTRA_PLUGIN_ID,
      modality: 'spectra',
      mode: 'preview',
      title
    },
    ...(selection ? { selection } : {}),
    visibleText: buildVisibleText(summary),
    spectra: {
      format: summary.format,
      spectrumCount: summary.spectrumCount,
      peakCount: summary.peakCount,
      scanCount: summary.scanCount,
      xAxis: summary.format === 'fcs' ? 'event' : 'm/z',
      ...(summary.mzRange ? { mzRange: summary.mzRange } : {}),
      ...(summary.intensityRange ? { intensityRange: summary.intensityRange } : {}),
      ...(summary.sampledPeaks.length > 0 ? { sampledPeaks: summary.sampledPeaks } : {}),
      ...(summary.scanMarkers.length > 0 ? { scanMarkers: summary.scanMarkers } : {}),
      ...(summary.fcs ? { fcs: summary.fcs } : {})
    },
    ...(annotations.length > 0 ? { annotations } : {}),
    actions: [...WORKSPACE_SPECTRA_ACTIONS]
  }
}

function buildSpectraSelection(summary: SpectraSummary): WorkspaceSpectraObservation['selection'] {
  if (summary.format === 'fcs') {
    if (summary.fcs?.totalEvents === undefined || summary.fcs.totalEvents === 0) return undefined

    return {
      kind: 'spectra',
      ranges: [{
        xStart: 0,
        xEnd: Math.max(0, summary.fcs.totalEvents - 1)
      }]
    }
  }

  if (!summary.mzRange) return undefined

  return {
    kind: 'spectra',
    ranges: [{
      xStart: summary.mzRange.min,
      xEnd: summary.mzRange.max,
      ...(summary.intensityRange ? {
        yStart: summary.intensityRange.min,
        yEnd: summary.intensityRange.max
      } : {})
    }],
    ...(summary.sampledPeaks.length > 0
      ? {
          peaks: summary.sampledPeaks.map((peak) => ({
            mz: peak.mz,
            intensity: peak.intensity,
            ...(peak.label ? { label: peak.label } : {})
          }))
        }
      : {})
  }
}

function buildVisibleText(summary: SpectraSummary): string {
  const lines = [
    `Spectra preview: ${summary.format.toUpperCase()}.`,
    `Spectra: ${summary.spectrumCount}. Peaks: ${summary.peakCount}. Scans: ${summary.scanCount}.`
  ]

  if (summary.mzRange || summary.intensityRange) {
    const mzRange = summary.mzRange ? `m/z ${formatRange(summary.mzRange)}` : undefined
    const intensityRange = summary.intensityRange ? `intensity ${formatRange(summary.intensityRange)}` : undefined
    lines.push(`Range summary: ${[mzRange, intensityRange].filter(Boolean).join(', ')}.`)
  }

  if (summary.spectra.length > 0) {
    lines.push('MGF spectra:')
    for (const spectrum of summary.spectra.slice(0, 20)) {
      const title = spectrum.title ? ` ${spectrum.title}` : ''
      const precursor = spectrum.precursorMz !== undefined ? ` precursor ${spectrum.precursorMz}` : ''
      const charge = spectrum.charge ? ` charge ${spectrum.charge}` : ''
      const ranges = [
        spectrum.mzRange ? `m/z ${formatRange(spectrum.mzRange)}` : undefined,
        spectrum.intensityRange ? `intensity ${formatRange(spectrum.intensityRange)}` : undefined
      ].filter(Boolean).join(', ')
      lines.push(`- #${spectrum.index}${title}: ${spectrum.peakCount} peaks.${precursor}${charge}${ranges ? ` ${ranges}.` : ''}`)
    }
  }

  if (summary.scanMarkers.length > 0) {
    lines.push('Scan markers:')
    for (const marker of summary.scanMarkers.slice(0, 20)) {
      const label = marker.scanNumber ?? marker.id ?? `${marker.index}`
      const msLevel = marker.msLevel ? ` msLevel ${marker.msLevel}` : ''
      const peaks = marker.peakCount !== undefined ? ` ${marker.peakCount} peaks` : ''
      const ranges = [
        marker.mzRange ? `m/z ${formatRange(marker.mzRange)}` : undefined,
        marker.intensityRange ? `intensity ${formatRange(marker.intensityRange)}` : undefined
      ].filter(Boolean).join(', ')
      lines.push(`- ${label}.${msLevel}${peaks}${ranges ? ` ${ranges}.` : ''}`)
    }
  }

  if (summary.fcs) {
    const details = [
      summary.fcs.version ? `version ${summary.fcs.version}` : undefined,
      summary.fcs.totalEvents !== undefined ? `${summary.fcs.totalEvents} events` : undefined,
      summary.fcs.parameterCount !== undefined ? `${summary.fcs.parameterCount} parameters` : undefined
    ].filter(Boolean).join(', ')
    lines.push(`FCS metadata placeholder${details ? `: ${details}` : '.'}`)
    if (summary.fcs.eventAxes && summary.fcs.eventAxes.length > 0) {
      const axes = summary.fcs.eventAxes.slice(0, 12).map((axis) => {
        const label = axis.label && axis.name && axis.label !== axis.name
          ? `${axis.name} (${axis.label})`
          : axis.label ?? axis.name ?? `P${axis.index}`
        return axis.range ? `${label} ${formatRange(axis.range)}` : label
      })
      lines.push(`Event axes: ${axes.join(', ')}.`)
    }
    if (summary.fcs.gating) {
      lines.push('Gating placeholder: event populations are not parsed until binary event matrices are available.')
    }
    lines.push(...summary.fcs.notes)
  }

  if (summary.warnings.length > 0) {
    lines.push('Warnings:')
    lines.push(...summary.warnings.slice(0, WORKSPACE_SPECTRA_MAX_WARNINGS).map((warning) => `- ${warning}`))
  }

  return truncateText(lines.join('\n'), WORKSPACE_SPECTRA_MAX_VISIBLE_TEXT_CHARS)
}

function parseMgfPeakLine(line: string): { mz: number, intensity: number } | undefined {
  const match = MGF_PEAK_LINE_PATTERN.exec(line)
  if (!match) return undefined

  const mz = parseNonNegativeNumber(match[1])
  const intensity = parseNonNegativeNumber(match[2])
  return mz !== undefined && intensity !== undefined ? { mz, intensity } : undefined
}

function createRangeAccumulator(): RangeAccumulator {
  return {
    min: undefined,
    max: undefined
  }
}

function addRangeValue(range: RangeAccumulator, value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value)) return
  range.min = range.min === undefined ? value : Math.min(range.min, value)
  range.max = range.max === undefined ? value : Math.max(range.max, value)
}

function mergeRange(range: RangeAccumulator, value: WorkspaceSpectraNumericRange | undefined): void {
  if (!value) return
  addRangeValue(range, value.min)
  addRangeValue(range, value.max)
}

function rangeFromAccumulator(range: RangeAccumulator): WorkspaceSpectraNumericRange | undefined {
  return range.min !== undefined && range.max !== undefined
    ? { min: range.min, max: range.max }
    : undefined
}

function rangeFromPoint(value: number | undefined): WorkspaceSpectraNumericRange | undefined {
  return value !== undefined ? { min: value, max: value } : undefined
}

function rangeFromBounds(
  first: number | undefined,
  second: number | undefined
): WorkspaceSpectraNumericRange | undefined {
  if (first === undefined || second === undefined) return undefined
  return {
    min: Math.min(first, second),
    max: Math.max(first, second)
  }
}

function extendRange(
  range: WorkspaceSpectraNumericRange | undefined,
  value: number
): WorkspaceSpectraNumericRange {
  return range
    ? {
        min: Math.min(range.min, value),
        max: Math.max(range.max, value)
      }
    : { min: value, max: value }
}

function formatRange(range: WorkspaceSpectraNumericRange): string {
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`
}

function iterateXmlElements(text: string, tagName: 'spectrum' | 'scan'): Array<{ tag: string, block: string }> {
  const markerPattern = new RegExp(`<${tagName}\\b[^>]*>`, 'gi')
  const closePattern = new RegExp(`</${tagName}>`, 'i')
  const elements: Array<{ tag: string, block: string }> = []
  let match: RegExpExecArray | null

  while ((match = markerPattern.exec(text)) !== null) {
    const tag = match[0] ?? ''
    const afterTagIndex = markerPattern.lastIndex
    const closeMatch = closePattern.exec(text.slice(afterTagIndex))
    const block = closeMatch
      ? text.slice(match.index, afterTagIndex + closeMatch.index + closeMatch[0].length)
      : tag
    elements.push({ tag, block })
  }

  return elements
}

function findMzMlCvParamNumber(block: string, identifiers: readonly string[]): number | undefined {
  return parseNonNegativeNumber(findMzMlCvParamValue(block, identifiers))
}

function findMzMlCvParamValue(block: string, identifiers: readonly string[]): string | undefined {
  XML_CV_PARAM_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = XML_CV_PARAM_PATTERN.exec(block)) !== null) {
    const attributes = parseXmlAttributes(match[0] ?? '')
    const accession = attributes.accession ?? ''
    const name = attributes.name ?? ''
    if (identifiers.some((identifier) => {
      const normalizedIdentifier = identifier.toLowerCase()
      return accession.toLowerCase() === normalizedIdentifier || name.toLowerCase() === normalizedIdentifier
    })) {
      return cleanOptionalText(attributes.value)
    }
  }
  return undefined
}

function buildFcsEventAxes(text: string, parameterCount: number | undefined): WorkspaceFcsEventAxis[] {
  if (parameterCount === undefined || parameterCount === 0) return []

  const axes: WorkspaceFcsEventAxis[] = []
  const boundedParameterCount = Math.min(parameterCount, 64)
  for (let index = 1; index <= boundedParameterCount; index += 1) {
    const name = readFcsKeywordValue(text, `$P${index}N`)
    const label = readFcsKeywordValue(text, `$P${index}S`)
    const rangeMax = parseNonNegativeNumber(readFcsKeywordValue(text, `$P${index}R`))
    if (!name && !label && rangeMax === undefined) continue

    axes.push({
      index,
      ...(name ? { name } : {}),
      ...(label ? { label } : {}),
      ...(rangeMax !== undefined ? { range: { min: 0, max: rangeMax } } : {})
    })
  }

  return axes
}

function resolveFormat(input: NormalizedWorkspaceSpectraPreviewInput): WorkspaceSpectraResolvedFormat {
  if (input.format !== 'auto') return input.format

  const path = input.path?.trim().toLowerCase() ?? ''
  if (path.endsWith('.mgf')) return 'mgf'
  if (path.endsWith('.mzml')) return 'mzml'
  if (path.endsWith('.mzxml')) return 'mzxml'
  if (path.endsWith('.fcs')) return 'fcs'

  const sample = input.text.slice(0, 8192)
  if (/BEGIN\s+IONS/i.test(sample)) return 'mgf'
  if (/<mzML\b/i.test(sample) || /<spectrum\b/i.test(sample)) return 'mzml'
  if (/<mzXML\b/i.test(sample) || /<scan\b/i.test(sample)) return 'mzxml'
  if (FCS_VERSION_PATTERN.test(sample)) return 'fcs'
  return 'unknown'
}

function parseXmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(XML_ATTRIBUTE_PATTERN)) {
    const name = match[1]
    const value = match[2] ?? match[3] ?? ''
    if (name) attributes[name] = value
  }
  return attributes
}

function extractScanNumber(id: string | undefined): string | undefined {
  if (!id) return undefined
  return cleanOptionalText(/\bscan=([^\s"]+)/i.exec(id)?.[1])
}

function parseFcsSegmentOffsets(text: string): FcsSegmentOffsets | undefined {
  if (!FCS_VERSION_PATTERN.test(text.slice(0, 16)) || text.length < 58) return undefined

  const offsets: FcsSegmentOffsets = {
    ...(parseHeaderInteger(text.slice(10, 18)) !== undefined ? { textStartByte: parseHeaderInteger(text.slice(10, 18)) } : {}),
    ...(parseHeaderInteger(text.slice(18, 26)) !== undefined ? { textEndByte: parseHeaderInteger(text.slice(18, 26)) } : {}),
    ...(parseHeaderInteger(text.slice(26, 34)) !== undefined ? { dataStartByte: parseHeaderInteger(text.slice(26, 34)) } : {}),
    ...(parseHeaderInteger(text.slice(34, 42)) !== undefined ? { dataEndByte: parseHeaderInteger(text.slice(34, 42)) } : {}),
    ...(parseHeaderInteger(text.slice(42, 50)) !== undefined ? { analysisStartByte: parseHeaderInteger(text.slice(42, 50)) } : {}),
    ...(parseHeaderInteger(text.slice(50, 58)) !== undefined ? { analysisEndByte: parseHeaderInteger(text.slice(50, 58)) } : {})
  }

  return Object.keys(offsets).length > 0 ? offsets : undefined
}

function parseFcsKeywordInteger(text: string, key: string): number | undefined {
  return parseNonNegativeInteger(readFcsKeywordValue(text, key))
}

function readFcsKeywordValue(text: string, key: string): string | undefined {
  const upperText = text.toUpperCase()
  const keyIndex = upperText.indexOf(key.toUpperCase())
  if (keyIndex < 0) return undefined

  const afterKey = keyIndex + key.length
  const delimiter = text[afterKey]
  if (delimiter && isFcsDelimiter(delimiter)) {
    const valueStart = afterKey + 1
    const valueEnd = text.indexOf(delimiter, valueStart)
    const rawValue = valueEnd >= 0 ? text.slice(valueStart, valueEnd) : text.slice(valueStart, valueStart + 256)
    return cleanOptionalText(rawValue)
  }

  const fallbackPattern = new RegExp(`${escapeRegExp(key)}\\s*(?:=|:)?\\s*([^\\r\\n\\t;|/\\\\]+)`, 'i')
  return cleanOptionalText(fallbackPattern.exec(text)?.[1])
}

function isFcsDelimiter(value: string): boolean {
  return !/[A-Za-z0-9$_.+-]/.test(value)
}

function parseHeaderInteger(rawValue: string): number | undefined {
  return parseNonNegativeInteger(rawValue.trim())
}

function parseNonNegativeInteger(rawValue: string | undefined): number | undefined {
  if (!rawValue) return undefined
  const parsed = Number.parseInt(rawValue.trim(), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseNonNegativeNumber(rawValue: string | undefined): number | undefined {
  if (!rawValue) return undefined
  const parsed = Number.parseFloat(rawValue.trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function cleanOptionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = truncateText(value.replace(/[^\x20-\x7E]+/g, ' ').trim(), 1000)
  return cleaned.length > 0 ? cleaned : undefined
}

function defaultPathForFormat(format: WorkspaceSpectraResolvedFormat): string {
  if (format === 'mgf') return 'spectra.mgf'
  if (format === 'mzml') return 'spectra.mzML'
  if (format === 'mzxml') return 'spectra.mzXML'
  if (format === 'fcs') return 'flow.fcs'
  return 'spectra-data'
}

function defaultMimeType(format: WorkspaceSpectraResolvedFormat): string {
  if (format === 'mgf') return 'application/vnd.proteomics.mgf'
  if (format === 'mzml') return 'application/mzml+xml'
  if (format === 'mzxml') return 'application/mzxml+xml'
  if (format === 'fcs') return 'application/vnd.isac.fcs'
  return 'text/plain'
}

function titleForPath(path: string | undefined, format: WorkspaceSpectraResolvedFormat): string {
  const trimmed = path?.trim()
  if (!trimmed) return format === 'unknown' ? 'Spectra data' : defaultPathForFormat(format)
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
}

function boundedWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => truncateText(warning.trim(), 1000)).filter(Boolean).slice(0, WORKSPACE_SPECTRA_MAX_WARNINGS)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
