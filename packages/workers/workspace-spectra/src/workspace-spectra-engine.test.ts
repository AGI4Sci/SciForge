import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WORKSPACE_SPECTRA_MAX_TEXT_CHARS,
  WorkspaceSpectraService,
  annotateRange,
  createWorkspaceSpectraPreview,
  exportPeakList,
  selectPeaksByRange,
  workspaceSpectraObservationSchema,
  workspaceSpectraPreviewInputSchema
} from './index.js'

const mgf = [
  'BEGIN IONS',
  'TITLE=sample scan 1',
  'PEPMASS=445.34 1200',
  'CHARGE=2+',
  '100.10 200',
  '101.10 300',
  'END IONS',
  'BEGIN IONS',
  'TITLE=sample scan 2',
  '200.20 400',
  'END IONS'
].join('\n')

const fcsText = (() => {
  const header = [
    'FCS3.1',
    '    ',
    '58'.padStart(8, ' '),
    '180'.padStart(8, ' '),
    '181'.padStart(8, ' '),
    '240'.padStart(8, ' '),
    '0'.padStart(8, ' '),
    '0'.padStart(8, ' ')
  ].join('')
  return `${header}/$TOT/123/$PAR/2/$P1N/FSC-A/$P1S/Forward Scatter/$P1R/262144/$P2N/SSC-A/$P2R/131072/$FIL/sample.fcs/$CYT/Example Cytometer/`
})()

test('summarizes MGF spectra and peak counts', () => {
  const service = new WorkspaceSpectraService()
  const result = service.preview({
    text: mgf,
    path: 'proteomics/run.mgf',
    mimeType: 'application/vnd.proteomics.mgf'
  })

  assert.equal(result.format, 'mgf')
  assert.equal(result.spectrumCount, 2)
  assert.equal(result.peakCount, 3)
  assert.equal(result.scanCount, 0)
  assert.equal(result.spectra[0]?.title, 'sample scan 1')
  assert.equal(result.spectra[0]?.precursorMz, 445.34)
  assert.equal(result.spectra[0]?.charge, '2+')
  assert.deepEqual(result.mzRange, { min: 100.1, max: 200.2 })
  assert.deepEqual(result.intensityRange, { min: 200, max: 400 })
  assert.deepEqual(result.spectra[0]?.mzRange, { min: 100.1, max: 101.1 })
  assert.equal(result.sampledPeaks.length, 3)
  assert.deepEqual(result.sampledPeaks[2], {
    spectrumIndex: 1,
    peakIndex: 0,
    mz: 200.2,
    intensity: 400
  })
  const observation = workspaceSpectraObservationSchema.parse(result.observation)
  assert.equal(observation.view.pluginId, 'spectra')
  assert.equal(observation.spectra.xAxis, 'm/z')
  assert.deepEqual(observation.spectra.mzRange, { min: 100.1, max: 200.2 })
  assert.deepEqual(observation.selection?.ranges[0], {
    xStart: 100.1,
    xEnd: 200.2,
    yStart: 200,
    yEnd: 400
  })
  assert.match(result.observation?.visibleText ?? '', /Peaks: 3/)
  assert.match(result.observation?.visibleText ?? '', /Range summary: m\/z 100.1-200.2, intensity 200-400/)
  assert.deepEqual(result.observation?.actions, [
    'spectra.preview',
    'spectra.inspectScans',
    'spectra.selectPeaksByRange',
    'spectra.annotateRange',
    'spectra.exportPeakList'
  ])
})

test('extracts mzML scan markers from spectrum tags', () => {
  const input = workspaceSpectraPreviewInputSchema.parse({
    text: [
      '<mzML>',
      '<spectrum index="0" id="controllerType=0 controllerNumber=1 scan=27" defaultArrayLength="1234">',
      '<cvParam accession="MS:1000511" name="ms level" value="2"/>',
      '<cvParam accession="MS:1000528" name="lowest observed m/z" value="50.5"/>',
      '<cvParam accession="MS:1000527" name="highest observed m/z" value="1000.5"/>',
      '<cvParam accession="MS:1000505" name="base peak intensity" value="2000"/>',
      '</spectrum>',
      '<spectrum index="1" id="scan=28" defaultArrayLength="10">',
      '<cvParam accession="MS:1000528" name="lowest observed m/z" value="75"/>',
      '<cvParam accession="MS:1000527" name="highest observed m/z" value="900"/>',
      '<cvParam accession="MS:1000505" name="base peak intensity" value="150"/>',
      '</spectrum>',
      '</mzML>'
    ].join('\n'),
    path: 'raw/run.mzML'
  })
  const result = createWorkspaceSpectraPreview(input)

  assert.equal(result.format, 'mzml')
  assert.equal(result.spectrumCount, 2)
  assert.equal(result.scanCount, 2)
  assert.equal(result.peakCount, 1244)
  assert.deepEqual(result.scanMarkers.map((marker) => marker.scanNumber), ['27', '28'])
  assert.equal(result.scanMarkers[0]?.msLevel, '2')
  assert.equal(result.scanMarkers[0]?.peakCount, 1234)
  assert.deepEqual(result.scanMarkers[0]?.mzRange, { min: 50.5, max: 1000.5 })
  assert.deepEqual(result.mzRange, { min: 50.5, max: 1000.5 })
  assert.deepEqual(result.intensityRange, { min: 150, max: 2000 })
})

test('extracts mzXML scan markers from scan tags', () => {
  const service = new WorkspaceSpectraService()
  const result = service.preview({
    text: [
      '<mzXML>',
      '<scan num="101" msLevel="1" peaksCount="42" lowMz="90.5" highMz="1200" basePeakIntensity="8000">',
      '</scan>',
      '<scan num="102" msLevel="2" peaksCount="7" basePeakMz="445.2" basePeakIntensity="120">',
      '</scan>',
      '</mzXML>'
    ].join('\n'),
    path: 'raw/run.mzXML'
  })

  assert.equal(result.format, 'mzxml')
  assert.equal(result.scanCount, 2)
  assert.equal(result.peakCount, 49)
  assert.deepEqual(result.scanMarkers.map((marker) => marker.msLevel), ['1', '2'])
  assert.deepEqual(result.scanMarkers.map((marker) => marker.scanNumber), ['101', '102'])
  assert.deepEqual(result.scanMarkers[0]?.mzRange, { min: 90.5, max: 1200 })
  assert.deepEqual(result.scanMarkers[1]?.mzRange, { min: 445.2, max: 445.2 })
  assert.deepEqual(result.mzRange, { min: 90.5, max: 1200 })
  assert.deepEqual(result.intensityRange, { min: 120, max: 8000 })
})

test('emits FCS placeholder metadata without binary event parsing', () => {
  const result = new WorkspaceSpectraService().preview({
    text: fcsText,
    path: 'flow/sample.fcs'
  })

  assert.equal(result.format, 'fcs')
  assert.equal(result.fcs?.metadataStatus, 'placeholder')
  assert.equal(result.fcs?.binaryParsing, false)
  assert.equal(result.fcs?.version, 'FCS3.1')
  assert.equal(result.fcs?.totalEvents, 123)
  assert.equal(result.fcs?.parameterCount, 2)
  assert.equal(result.fcs?.segmentOffsets?.textStartByte, 58)
  assert.deepEqual(result.fcs?.eventAxes?.map((axis) => axis.name), ['FSC-A', 'SSC-A'])
  assert.equal(result.fcs?.eventAxes?.[0]?.label, 'Forward Scatter')
  assert.deepEqual(result.fcs?.eventAxes?.[1]?.range, { min: 0, max: 131072 })
  assert.equal(result.fcs?.gating?.status, 'placeholder')
  assert.equal(result.fcs?.keywords.find((keyword) => keyword.key === '$FIL')?.value, 'sample.fcs')
  assert.equal(result.observation?.spectra.xAxis, 'event')
  assert.deepEqual(result.observation?.selection?.ranges[0], {
    xStart: 0,
    xEnd: 122
  })
  assert.match(result.observation?.visibleText ?? '', /binary event matrices are not parsed/)
  assert.match(result.observation?.visibleText ?? '', /Event axes: FSC-A \(Forward Scatter\) 0-262144, SSC-A 0-131072/)
})

test('annotates an MGF sampled peak range with structured selection text', () => {
  const service = new WorkspaceSpectraService()
  const preview = service.preview({
    text: mgf,
    path: 'proteomics/run.mgf'
  })
  const result = service.annotateRange({
    preview,
    range: {
      mzMin: 100.5,
      mzMax: 150,
      intensityMin: 250
    },
    label: 'Fragment window',
    body: 'Review the mid-intensity fragment cluster.'
  })

  assert.equal(result.annotationSummary.kind, 'peak-range')
  assert.equal(result.annotationSummary.sampledOnly, true)
  assert.equal(result.annotationSummary.peakCount, 1)
  assert.equal(result.peaks.length, 1)
  assert.deepEqual(result.peaks[0], {
    spectrumIndex: 0,
    peakIndex: 1,
    mz: 101.1,
    intensity: 300
  })
  assert.deepEqual(result.selection.ranges[0], {
    xStart: 100.5,
    xEnd: 150,
    yStart: 250,
    yEnd: 300
  })
  assert.match(result.annotationSummary.summary, /Fragment window: 1 sampled peaks/)
  assert.match(result.visibleText, /Review the mid-intensity fragment cluster/)
  assert.match(result.visibleText, /m\/z 101.1, intensity 300/)
})

test('exports bounded MGF sampled peaks as CSV text and JSON summary', () => {
  const preview = createWorkspaceSpectraPreview(workspaceSpectraPreviewInputSchema.parse({
    text: mgf,
    path: 'proteomics/run.mgf'
  }))
  const csv = exportPeakList({
    preview,
    range: {
      intensityMin: 250
    },
    format: 'csv',
    maxPeaks: 2
  })
  const json = exportPeakList({
    preview,
    range: {
      mzMin: 100,
      mzMax: 102
    },
    format: 'json'
  })

  assert.equal(csv.sampledOnly, true)
  assert.equal(csv.bounded, true)
  assert.equal(csv.summary.sourcePeakCount, 3)
  assert.equal(csv.summary.totalSampledPeakCount, 3)
  assert.equal(csv.summary.selectedSampledPeakCount, 2)
  assert.equal(csv.summary.exportedPeakCount, 2)
  assert.equal(csv.summary.truncated, false)
  assert.match(csv.text ?? '', /^spectrumIndex,scanIndex,peakIndex,mz,intensity,label/)
  assert.match(csv.text ?? '', /0,,1,101.1,300,/)
  assert.match(csv.text ?? '', /1,,0,200.2,400,/)
  assert.equal(json.text, undefined)
  assert.equal(json.summary.exportedPeakCount, 2)
  assert.deepEqual(json.summary.peaks.map((peak) => peak.mz), [100.1, 101.1])
})

test('creates placeholder FCS population gate annotations without event decoding', () => {
  const service = new WorkspaceSpectraService()
  const preview = service.preview({
    text: fcsText,
    path: 'flow/sample.fcs'
  })
  const result = annotateRange({
    preview,
    range: {
      eventMin: 10,
      eventMax: 19,
      axes: ['FSC-A', 'SSC-A']
    },
    label: 'Live gate'
  })

  assert.equal(result.annotationSummary.kind, 'population-gate')
  assert.equal(result.annotationSummary.eventCount, 10)
  assert.equal(result.annotationSummary.fcsPopulation?.status, 'placeholder')
  assert.equal(result.annotationSummary.fcsPopulation?.binaryParsing, false)
  assert.deepEqual(result.annotationSummary.fcsPopulation?.axes, ['FSC-A', 'SSC-A'])
  assert.deepEqual(result.selection.ranges[0], {
    xStart: 10,
    xEnd: 19
  })
  assert.equal(result.peaks.length, 0)
  assert.match(result.annotationSummary.summary, /FCS event matrices are not decoded/)
  assert.match(result.visibleText, /No FCS event matrix was decoded/)
  assert.match(result.warnings.join('\n'), /placeholder-only/)
})

test('selects in-memory sampled peaks by spectrum, mz, and intensity ranges', () => {
  const peaks = [
    { spectrumIndex: 0, peakIndex: 0, mz: 100.1, intensity: 200 },
    { spectrumIndex: 0, peakIndex: 1, mz: 101.1, intensity: 300 },
    { spectrumIndex: 1, peakIndex: 0, mz: 200.2, intensity: 400 }
  ]
  const result = selectPeaksByRange({
    peaks,
    range: {
      mzMin: 100.5,
      mzMax: 250,
      intensityMin: 250,
      spectrumIndexes: [0, 1]
    },
    maxPeaks: 1
  })

  assert.equal(result.peakCount, 2)
  assert.equal(result.peaks.length, 1)
  assert.equal(result.truncated, true)
  assert.deepEqual(result.mzRange, { min: 101.1, max: 200.2 })
  assert.deepEqual(result.intensityRange, { min: 300, max: 400 })
  assert.notEqual(result.peaks[0], peaks[1])
  assert.deepEqual(result.peaks[0], peaks[1])
})

test('validates preview inputs with zod contracts', () => {
  const service = new WorkspaceSpectraService()

  assert.throws(() => {
    service.preview({
      text: 'x'.repeat(WORKSPACE_SPECTRA_MAX_TEXT_CHARS + 1)
    })
  }, { name: 'ZodError' })
})
