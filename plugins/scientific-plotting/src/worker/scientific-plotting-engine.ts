import { createHash } from 'node:crypto'

import { AsyncLocalStorage } from 'node:async_hooks'

import { spawn } from 'node:child_process'

import { stat } from 'node:fs/promises'

import { isAbsolute, join } from 'node:path'

import type { FigureStyleSpec, VisualStyleSimilarityMetric } from './types'

import { SCIENTIFIC_PLOTTING_TEMPLATES, SCIENTIFIC_PLOTTING_TEMPLATE_GUIDES, type DataSourceRef, type DerivedTableReceipt, type ScientificPlotMatplotlibParametersV1, type ScientificPlotTransformationV1, type ScientificPlottingDataMappingRequest, type ScientificPlottingDataMappingResult, type ScientificPlottingLabels, type ScientificPlottingPlanRequest, type ScientificPlottingReferenceProfile, type ScientificPlottingRenderRequest, type ScientificPlottingStatusResult, type ScientificPlottingStyleProfile, type ScientificPlottingStyleProfileMatch, type ScientificPlottingStyleProfileSummary, type ScientificPlottingTemplate, type ScientificPlottingTemplateAdvice, type ScientificPlottingTemplateGuide, type StatisticalDefinitionV1, type ScientificFigureRendererOptions } from './types'

import { scientificPlottingMapDataRequestSchema, scientificPlottingRenderRequestSchema } from './contract.js'

import { buildMatplotlibStyleAdapterFromFigureStyleSpec } from './matplotlib-style.js'

import { realpath } from 'node:fs/promises'

type DataSummary = Extract<ScientificPlottingDataMappingResult, { ok: true }>['dataSummary']

type DataMappingCandidate = {
  template: ScientificPlottingTemplate
  confidence: number
  data: unknown
  labels?: ScientificPlottingLabels
  inputShape: DataSummary['inputShape']
  dataSignals: ScientificPlottingTemplate[]
  reasons: string[]
  warnings: string[]
  summary: DataSummary
  aggregationApplied?: {
    method: 'mean'
    groupBy: string[]
  }
  inferredUncertainty?: {
    kind: 'sd' | 'sem' | 'ci' | 'ambiguous'
    sourceColumn: string
  }
}

type TabularColumnProfile = {
  key: string
  numericCount: number
  stringCount: number
  finiteValues: number[]
  uniqueValues: string[]
}

type InternalStyleProfileMatch = {
  profile: ScientificPlottingStyleProfile
  score: number
  reasons: string[]
  cautions: string[]
}

type PythonRunResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; stdout: string; stderr: string; message: string }

const rendererOptions = new AsyncLocalStorage<ScientificFigureRendererOptions>()

/** Freeze a template as ordinary Python code and parameters before execution. */
export async function prepareTemplateCode(request: ScientificPlottingRenderRequest) {
  scientificPlottingRenderRequestSchema.parse(request)
  const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
  validateRenderRequestShape(request); validateTemplateData(request.template, request.data); validateReproducibleStatisticalClaims(request)
  const profile = styleProfileForRender(request)
  const styleSpec = scaleStyleSpecForOutput(request.styleSpec ?? profile?.styleSpec ?? defaultFigureStyleSpec(request), normalizeOutputScale(request.outputScale))
  const matplotlib = resolveMatplotlibRenderParameters(request, styleSpec)
  await resolveAndVerifyDataSourceRefs(request, workspaceRoot)
  const parameters = { template: request.template, data: request.data, labels: request.labels ?? {}, outputPath: '', styleSpec, rcParams: matplotlib.rcParams, palette: matplotlib.palette,
    ...(matplotlib.heatmapCmap?.kind === 'named' ? { heatmapCmapName: matplotlib.heatmapCmap.name } : matplotlib.heatmapCmap?.kind === 'linear-segmented' ? { heatmapCmapColors: matplotlib.heatmapCmap.colors } : {}) }
  assertPortableJson(parameters)
  const code = PYTHON_RENDERER_SOURCE.replace('payload = json.load(sys.stdin)', 'payload = json.loads(os.environ["SCIENTIFIC_FIGURES_PARAMETERS_JSON"])')
    .replace('print(json.dumps({"ok": True, "imageBase64": base64.b64encode(image_buffer.getvalue()).decode("ascii"), "pythonVersion": platform.python_version(), "matplotlibVersion": mpl.__version__, "rendererDiagnostics": renderer_diagnostics}))', 'with open(os.path.join(os.environ["SCIENTIFIC_FIGURES_OUTPUT_DIR"], "figure.png"), "xb") as output_file:\n    output_file.write(image_buffer.getvalue())')
  return { entrypoint: 'main.py', files: [{ path: 'main.py', content: code }], parameters, inputPaths: [] }
}

/** Source JSON is portable and never records caller absolute paths or executable locations. */
function assertPortableJson(value: unknown): void {
  const visit = (item: unknown): void => {
    if (typeof item === 'string' && (/^(?:[/\\]|[A-Za-z]:[/\\]|file:)/.test(item))) throw new Error('Figure source JSON must not contain absolute paths.')
    if (Array.isArray(item)) item.forEach(visit)
    else if (item && typeof item === 'object') Object.values(item).forEach(visit)
  }
  visit(value)
}

const RENDERER_VERSION = '0.1.0'

const RENDER_TIMEOUT_MS = 45_000

// A cold `import matplotlib` on a busy machine (or a slow external volume) can
// take well past 30s. The probe runs once per service, so waiting costs one
// start; timing out reports a working plotting environment as unusable.
const MATPLOTLIB_PROBE_TIMEOUT_MS = 60_000

const MAX_SERIES = 12

const MAX_POINTS = 5000

const MAX_HEATMAP_CELLS = 40_000

const MAX_SCHEMATIC_NODES = 50

const MAX_SCHEMATIC_PRIMITIVES = 500

const MAX_FLOWCHART_NODES = 12

const MAX_FLOWCHART_LABEL_CHARS = 720

const MAX_DISTRIBUTION_GROUPS = 24

const MAX_DISTRIBUTION_POINTS = 6000

const MAX_MULTI_PANELS = 6

const STYLE_PROFILE_REGISTRY_VERSION = 1

export async function getScientificPlottingStatus(options: ScientificFigureRendererOptions = {}): Promise<ScientificPlottingStatusResult> {
  return rendererOptions.run(options, async () => {
    const run = await runPython(['-c', 'import importlib.metadata; print(importlib.metadata.version("matplotlib"))'], '', undefined, MATPLOTLIB_PROBE_TIMEOUT_MS)
    return { ok: true, serverName: 'scientific_plotting', version: RENDERER_VERSION,
      renderer: { kind: 'matplotlib', available: run.ok, ...(run.ok ? { version: run.stdout.trim() } : { message: run.message }) },
      supportedTemplates: [...SCIENTIFIC_PLOTTING_TEMPLATES], templateGuides: scientificPlottingTemplateGuides(),
      outputPolicy: { sourceRelativeDir: '.scientific-figures/documents/<documentId>/sources/<generationId>', returnsImageBytes: true, persistsImages: false },
      degraded: !run.ok, guardrails: ['Only controlled built-in templates execute.', 'All filesystem and subprocess access requires the adapter-owned confined process.', 'FigureStore alone persists documents, sources and images.'] }
  })
}

export async function mapScientificPlottingData(
  request: ScientificPlottingDataMappingRequest
): Promise<ScientificPlottingDataMappingResult> {
  const task = request.task.trim()
  const warnings: string[] = []
  if (!task) {
    return {
      ok: false,
      status: 'invalid_request',
      message: 'Task is required.',
      missingInputs: ['task'],
      warnings
    }
  }
  try {
    scientificPlottingMapDataRequestSchema.parse(request)
    const workspaceRoot = await resolveWorkspaceRoot(request.workspaceRoot)
    const styleProfile = styleProfileForPlanning(
      request.styleSpec ? undefined : request.styleProfileId,
      warnings
    )
    if (request.styleProfileId?.trim() && (request.styleSpec)) {
      warnings.push('styleProfileId was ignored because explicit styleSpec was provided.')
    }
    const styleSpec = await resolvePlanStyleSpec(request, workspaceRoot, warnings, styleProfile)
    const referenceProfile = styleProfile?.referenceProfile ?? (styleSpec
      ? inferReferenceProfileFromStyle(styleSpec, {
          task,
          templateHint: request.templateHint
        })
      : undefined)
    const styleProfileMatches = !styleProfile && styleSpec && referenceProfile
      ? rankStyleProfilesForStyleSpec(styleSpec, referenceProfile, task)
          .slice(0, 3)
          .map((match) => shapeStyleProfileMatchForResult(match, false))
      : undefined
    const recommendedProfile = styleProfile
      ? shapeStyleProfileForResult(styleProfile, false)
      : styleProfileMatches?.[0]?.profile
    const mappedInput = request.data
    const taskSignals = inferTemplateSignalsFromText(task)
    const taskTemplate = taskSignals[0] ?? 'line'
    const candidates = buildDataMappingCandidates(mappedInput, {
      task,
      labels: request.labels,
      taskTemplate,
      templateHint: request.templateHint,
      referenceProfile,
      reproducibilityMode: request.reproducibilityMode ?? 'standard',
      statistics: request.statistics
    })
    if (candidates.length === 0) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: 'Could not map the provided data to a controlled plotting template.',
        missingInputs: [
          'Provide template-ready data, rows/records with numeric columns, a matrix, grouped values, or explicit panels.'
        ],
        warnings
      }
    }
    const selected = selectDataMappingCandidate(candidates, {
      templateHint: request.templateHint,
      taskTemplate,
      referenceProfile
    })
    try {
      validateTemplateData(selected.template, selected.data)
    } catch (error) {
      return {
        ok: false,
        status: 'invalid_request',
        message: error instanceof Error ? error.message : String(error),
        missingInputs: requiredInputsForTemplate(selected.template),
        warnings: [...warnings, ...selected.warnings]
      }
    }

    const reproducibilityMode = request.reproducibilityMode ?? 'standard'
    if (
      reproducibilityMode === 'reproducible'
      && selected.aggregationApplied
      && !declaresAggregation(request.statistics, selected.aggregationApplied)
    ) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: 'Duplicate summary rows require an explicit matching statistics.aggregation declaration in reproducible mode.',
        missingInputs: ['statistics.aggregation.method=mean', `statistics.aggregation.groupBy=${selected.aggregationApplied.groupBy.join(',')}`],
        warnings: [...warnings, ...selected.warnings]
      }
    }
    if (
      reproducibilityMode === 'reproducible'
      && selected.inferredUncertainty?.kind === 'ambiguous'
      && !request.statistics?.uncertainty
    ) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: `Uncertainty column ${selected.inferredUncertainty.sourceColumn} is ambiguous; declare whether it is SD, SEM, or CI.`,
        missingInputs: ['statistics.uncertainty.kind'],
        warnings: [...warnings, ...selected.warnings]
      }
    }
    if (
      reproducibilityMode === 'reproducible'
      && selected.inferredUncertainty?.kind === 'ci'
      && (
        !request.statistics?.uncertainty
        || (
          request.statistics.uncertainty.kind === 'ci'
          && request.statistics.uncertainty.confidenceLevel === undefined
        )
      )
    ) {
      return {
        ok: false,
        status: 'needs_clarification',
        message: `CI column ${selected.inferredUncertainty.sourceColumn} requires an explicit confidenceLevel in reproducible mode.`,
        missingInputs: ['statistics.uncertainty.confidenceLevel'],
        warnings: [...warnings, ...selected.warnings]
      }
    }
    if (
      selected.inferredUncertainty
      && selected.inferredUncertainty.kind !== 'ambiguous'
      && request.statistics?.uncertainty
      && request.statistics.uncertainty.kind !== selected.inferredUncertainty.kind
    ) {
      return {
        ok: false,
        status: 'invalid_request',
        message: `Declared uncertainty kind ${request.statistics.uncertainty.kind} conflicts with column ${selected.inferredUncertainty.sourceColumn}.`,
        missingInputs: [],
        warnings: [...warnings, ...selected.warnings]
      }
    }

    const selectedBy = request.templateHint && selected.template === request.templateHint
      ? 'templateHint'
      : selected.template === taskTemplate
        ? 'task'
        : referenceProfile && selected.template === referenceProfile.recommendedTemplate
          ? 'referenceProfile'
          : 'dataShape'
    const labels = mergeLabels(request.labels, selected.labels)
    const templateAdvice = buildTemplateAdvice(selected.template, referenceProfile, undefined)
    const sourceInputHash = hashStableJson(mappedInput)
    const mappedOutputHash = hashStableJson(selected.data)
    const dataSources = request.dataSources?.length
      ? request.dataSources
      : [inlineDataSourceRef(sourceInputHash, 'scientific-plotting.map-data.data')]
    const mappingTransformation = buildMappingTransformation({
      inputHash: sourceInputHash,
      outputHash: mappedOutputHash,
      selected,
      selectedBy
    })
    const transformations = [...(request.transformations ?? []), mappingTransformation]
    const derivedTableReceipt = buildDerivedTableReceipt({
      selected,
      sourceIds: dataSources.map((source) => source.sourceId),
      transformation: mappingTransformation
    })
    const statistics = request.statistics ?? inferredStatisticsForCandidate(selected)
    const provenanceWarnings = uniqueStrings([...warnings, ...selected.warnings])
    const renderRequest: ScientificPlottingRenderRequest = {
      workspaceRoot,
      documentId: request.documentId,
      generationId: request.generationId,
      template: selected.template,
      data: selected.data,
      reproducibilityMode,
      dataSources,
      derivedTableReceipts: [...(request.derivedTableReceipts ?? []), derivedTableReceipt],
      transformations,
      ...(statistics ? { statistics } : {}),
      provenanceWarnings,
      reviewTask: task,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      ...(request.figureId ? { figureId: request.figureId } : {}),
      ...(request.styleSpec ? { styleSpec: request.styleSpec } : {}),
      ...(styleProfile && request.styleProfileId ? { styleProfileId: styleProfile.id } : {}),
      ...(!request.styleSpec && !styleProfile && recommendedProfile ? { styleProfileId: recommendedProfile.id } : {}),
      ...(request.outputScale ? { outputScale: request.outputScale } : {}),
    }
    return {
      ok: true,
      status: 'mapped',
      selectedTemplate: selected.template,
      confidence: Number(selected.confidence.toFixed(2)),
      renderRequest,
      ...(referenceProfile ? { referenceProfile } : {}),
      ...(templateAdvice ? { templateAdvice } : {}),
      ...(recommendedProfile ? {
        styleProfileId: recommendedProfile.id,
        styleProfile: recommendedProfile
      } : {}),
      ...(styleProfileMatches ? { styleProfileMatches } : {}),
      dataSummary: selected.summary,
      mappingBasis: {
        taskSignals,
        dataSignals: selected.dataSignals,
        selectedBy,
        reasons: selected.reasons
      },
      alternatives: candidates
        .filter((candidate) => candidate.template !== selected.template)
        .slice(0, 4)
        .map((candidate) => ({
          template: candidate.template,
          confidence: Number(candidate.confidence.toFixed(2)),
          reason: candidate.reasons[0] ?? 'Alternative data mapping.'
        })),
      warnings: [...warnings, ...selected.warnings, ...(templateAdvice?.messages ?? [])],
      guardrails: [
        'This tool maps data into a controlled render request; it does not render or write files.',
        'Mapping may reshape records into template JSON, but it must not execute user code.',
        'If duplicate summary rows are aggregated, review the mapping warning before rendering.',
        'Render the mapped request through the confined Scientific Figures renderer, then review and persist through the figure store.'
      ]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : 'invalid_request',
      message,
      missingInputs: [],
      warnings
    }
  }
}

function uniqueReviewStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

async function runPython(args: string[], stdin: string, workspaceRoot?: string, timeoutMs = RENDER_TIMEOUT_MS): Promise<PythonRunResult> {
  const options = rendererOptions.getStore() ?? {}
  const command = options.pythonCommand?.trim() || 'python3'
  return new Promise((resolvePromise) => {
    let stdout = '', stderr = '', settled = false
    const child = spawn(command, ['-I', ...args], { ...(workspaceRoot ? { cwd: workspaceRoot } : {}), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...(options.tempRoot ? { TMPDIR: options.tempRoot } : {}) } })
    const finish = (result: PythonRunResult): void => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(result) }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ ok: false, stdout, stderr, message: 'Python renderer timed out.' }) }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (Buffer.byteLength(stdout) > 96 * 1024 * 1024) { child.kill('SIGKILL'); finish({ ok: false, stdout: '', stderr: '', message: 'Renderer output exceeds the bounded transport limit.' }) } })
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-64_000) })
    child.stdin.on('error', () => { /* Process failure is reported by error/close. */ })
    child.on('error', (error) => finish({ ok: false, stdout, stderr, message: error.message }))
    child.on('close', (code) => finish(code === 0 ? { ok: true, stdout, stderr } : { ok: false, stdout, stderr, message: tail(stderr) || 'Python renderer failed.' }))
    child.stdin.end(stdin)
  })
}

async function resolveWorkspaceRoot(raw: string): Promise<string> {
  if (typeof raw !== 'string' || !isAbsolute(raw) || raw.includes('\0')) throw new Error('workspaceRoot must be an absolute directory path.')
  const workspaceRoot = await realpath(raw)
  if (!(await stat(workspaceRoot)).isDirectory()) throw new Error('workspaceRoot must be a directory.')
  return workspaceRoot
}

function normalizeOutputScale(outputScale: number | undefined): number {
  if (outputScale === undefined) return 1
  if (!Number.isFinite(outputScale) || outputScale < 1 || outputScale > 4) {
    throw new Error('outputScale must be a finite number between 1 and 4.')
  }
  return Number(outputScale.toFixed(3))
}

function scaleStyleSpecForOutput(styleSpec: FigureStyleSpec, outputScale: number): FigureStyleSpec {
  if (outputScale === 1) return styleSpec
  const scaled = JSON.parse(JSON.stringify(styleSpec)) as FigureStyleSpec
  const baseDpi = Number.isFinite(scaled.export.dpi) && scaled.export.dpi > 0
    ? scaled.export.dpi
    : 300
  scaled.export = {
    ...scaled.export,
    dpi: Math.round(baseDpi * outputScale)
  }
  return scaled
}

async function resolvePlanStyleSpec(request: ScientificPlottingPlanRequest, _workspaceRoot: string, _warnings: string[], styleProfile?: ScientificPlottingStyleProfile): Promise<FigureStyleSpec | undefined> {
  return request.styleSpec ?? styleProfile?.styleSpec
}

function inferReferenceProfileFromStyle(
  styleSpec: FigureStyleSpec,
  input: {
    task?: string
    templateHint?: ScientificPlottingTemplate
  }
): ScientificPlottingReferenceProfile {
  const scores = new Map<ScientificPlottingTemplate, number>()
  const reasons = new Map<ScientificPlottingTemplate, string[]>()
  const risks: string[] = []
  const add = (template: ScientificPlottingTemplate, score: number, reason: string): void => {
    scores.set(template, (scores.get(template) ?? 0) + score)
    const current = reasons.get(template) ?? []
    current.push(reason)
    reasons.set(template, current)
  }
  const text = [
    input.task,
    styleSpec.source.figureId,
    styleSpec.source.notes,
    styleSpec.source.path
  ].filter(Boolean).join(' ').toLowerCase()
  const traits = referenceTraitsFromStyle(styleSpec, text)
  for (const signal of traits.textSignals) {
    const weight = signal === 'attention-map'
      ? 0.78
      : signal === 'multi-panel'
        ? 0.68
        : signal === 'box-violin' || signal === 'histogram-density'
          ? 0.64
          : signal === 'heatmap'
            ? 0.46
            : 0.52
    add(signal, weight, `Text hint suggests ${signal}.`)
  }
  if (input.templateHint) add(input.templateHint, 0.08, `Caller provided ${input.templateHint} as a weak template hint.`)

  const aspect = styleSpec.canvas.aspectRatio
  const backgroundLum = hexLuminance(styleSpec.canvas.background)
  if (backgroundLum < 60 && styleSpec.palette.colorMode !== 'monochrome') {
    add('heatmap', 0.2, 'Dark canvas with colored foreground often indicates matrix or attention-style visualization.')
  }
  const hasVisibleMeasuredAxes = styleSpec.axes.spine !== 'none' && styleSpec.axes.spine !== 'minimal'
  const hasMeasuredGrid = styleSpec.axes.grid && hasVisibleMeasuredAxes
  const hasLightMeasuredCanvas = backgroundLum > 180 && hasVisibleMeasuredAxes
  if (styleSpec.marks.density === 'dense' && !hasLightMeasuredCanvas) {
    add('heatmap', 0.18, 'Dense foreground marks are compatible with matrix-style plots.')
  }
  if (styleSpec.marks.density === 'dense' && hasLightMeasuredCanvas) {
    add('bar', 0.28, 'Dense foreground marks on a light measured axis are closer to categorical or multi-panel chart styling.')
  }
  if (aspect > 1.75 && styleSpec.axes.grid && styleSpec.palette.colorMode !== 'monochrome') {
    add('schematic-grid', 0.14, 'Wide, color-rich reference with many light structural marks can be a schematic panel.')
  }
  if (aspect < 0.85 && styleSpec.axes.grid) {
    add('bar', 0.28, 'Tall chart with visible grid is compatible with categorical comparison panels.')
  }
  if (traits.panelGrid !== '1x1') {
    add('multi-panel', 0.38, `Reference layout reports panel grid ${traits.panelGrid}.`)
  }
  if (
    traits.aspect === 'wide' &&
    traits.markDensity === 'dense' &&
    traits.background === 'light' &&
    traits.axes !== 'none'
  ) {
    add('multi-panel', 0.1, 'Wide dense light reference may contain multiple chart panels.')
  }
  if (
    traits.textSignals.length === 0 &&
    traits.markDensity === 'dense' &&
    traits.axes === 'measured' &&
    styleSpec.annotations.legend !== 'none'
  ) {
    add('histogram-density', 0.08, 'Dense measured chart with legend may be a distribution comparison.')
  }
  if (hasMeasuredGrid) {
    add('bar', 0.08, 'Visible axes and grid indicate a measured chart rather than a freeform schematic.')
  }
  if (hasVisibleMeasuredAxes && !styleSpec.axes.grid) {
    add('bar', 0.06, 'Visible measured axes indicate a chart even when light grid lines are not detected.')
  }
  if (styleSpec.axes.spine === 'minimal' || styleSpec.axes.spine === 'none') {
    add('schematic-grid', 0.1, 'Minimal axes can indicate a schematic rather than a measured chart.')
  }
  if (styleSpec.source.path === 'sciforge-default') {
    risks.push('No external reference image or StyleSpec was provided; profile is based on the default SciForge style.')
  }
  if (styleSpec.confidence.typography < 0.5) {
    risks.push('Typography was inferred conservatively; exact font matching should be reviewed visually.')
  }
  if (
    traits.textSignals.includes('box-violin') ||
    traits.textSignals.includes('histogram-density') ||
    traits.textSignals.includes('multi-panel')
  ) {
    risks.push('Specialized template recognition combines visual traits with text hints; confirm the selected template visually.')
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1])
  const [recommendedTemplate, score] = ranked[0] ?? ['line', 0.24]
  const kind = kindForTemplate(recommendedTemplate, score)
  return {
    kind,
    recommendedTemplate,
    confidence: Number(clampNumber(score, 0.24, 0.92).toFixed(2)),
    detectedTraits: traits,
    reasons: (reasons.get(recommendedTemplate) ?? ['No strong visual-template evidence was detected.']).slice(0, 4),
    risks
  }
}

function referenceTraitsFromStyle(
  styleSpec: FigureStyleSpec,
  text: string
): NonNullable<ScientificPlottingReferenceProfile['detectedTraits']> {
  const aspect = styleSpec.canvas.aspectRatio > 1.45
    ? 'wide'
    : styleSpec.canvas.aspectRatio < 0.85
      ? 'tall'
      : 'balanced'
  const backgroundLum = hexLuminance(styleSpec.canvas.background)
  const background = backgroundLum > 190 ? 'light' : backgroundLum < 85 ? 'dark' : 'mid'
  const axes = styleSpec.axes.spine === 'left-bottom' || styleSpec.axes.spine === 'box'
    ? 'measured'
    : styleSpec.axes.spine === 'minimal'
      ? 'minimal'
      : styleSpec.axes.spine === 'none'
        ? 'none'
        : 'unknown'
  return {
    aspect,
    background,
    axes,
    grid: styleSpec.axes.gridTone,
    markDensity: styleSpec.marks.density,
    colorMode: styleSpec.palette.colorMode,
    panelGrid: styleSpec.layout.panelGrid,
    textSignals: inferTemplateSignalsFromText(text)
  }
}

function scientificPlottingTemplateGuides(): ScientificPlottingTemplateGuide[] {
  return SCIENTIFIC_PLOTTING_TEMPLATE_GUIDES.map((guide) => ({
    template: guide.template,
    useWhen: [...guide.useWhen],
    avoidWhen: [...guide.avoidWhen],
    expectedData: [...guide.expectedData],
    modelSelectionHint: guide.modelSelectionHint
  }))
}

function buildTemplateAdvice(
  selectedTemplate: ScientificPlottingTemplate | undefined,
  referenceProfile: ScientificPlottingReferenceProfile | undefined,
  score: VisualStyleSimilarityMetric | undefined
): ScientificPlottingTemplateAdvice | undefined {
  if (!selectedTemplate) return undefined
  const messages: string[] = []
  const nextActions: string[] = []
  let compatible = true
  if (
    referenceProfile &&
    referenceProfile.kind !== 'unknown' &&
    referenceProfile.confidence >= 0.48 &&
    referenceProfile.recommendedTemplate !== selectedTemplate
  ) {
    compatible = false
    messages.push(`Reference profile looks closer to ${referenceProfile.recommendedTemplate} than ${selectedTemplate}.`)
    nextActions.push(`Invoke capability scientific-plotting.render with template=${referenceProfile.recommendedTemplate} before manual style tuning.`)
  }
  if (score && score.marks < 0.62) {
    messages.push('Foreground mark density differs; this often requires a better template or semantic renderer, not another style-only repair.')
    nextActions.push('Keep the data unchanged and review whether the selected controlled template matches the reference figure type.')
  }
  if (score && (selectedTemplate === 'schematic-grid' || selectedTemplate === 'flowchart') && (score.axes < 0.62 || score.grid < 0.62)) {
    messages.push('Schematic and flowchart panels may score low on axes/grid because reference diagrams contain structural marks rather than measured axes.')
    nextActions.push('Treat axes/grid warnings as diagnostic context for schematic templates.')
  }
  if (score && (selectedTemplate === 'heatmap' || selectedTemplate === 'attention-map') && score.palette < 0.68) {
    messages.push('Heatmap palette differs; use the style-derived colormap when the user did not provide a domain-specific colormap.')
    nextActions.push('Prefer a dedicated attention/matrix template if the reference contains token alignments or block structure.')
  }
  return {
    selectedTemplate,
    ...(referenceProfile ? { referenceRecommendedTemplate: referenceProfile.recommendedTemplate } : {}),
    compatible,
    severity: compatible ? 'info' : 'warning',
    messages,
    nextActions: nextActions.length > 0 ? nextActions : ['Proceed with controlled rendering and visual review.']
  }
}

function resolveMatplotlibRenderParameters(
  request: ScientificPlottingRenderRequest,
  styleSpec: FigureStyleSpec,
  rcParamsPatch: Record<string, string | number | boolean> = {},
  paletteOverride?: string[]
): ScientificPlotMatplotlibParametersV1 {
  if (request.matplotlib) {
    return canonicalClone(request.matplotlib) as ScientificPlotMatplotlibParametersV1
  }
  const styleAdapter = buildMatplotlibStyleAdapterFromFigureStyleSpec(styleSpec)
  const palette = paletteOverride?.length
    ? [...paletteOverride]
    : styleAdapter.palette.length
      ? [...styleAdapter.palette]
      : ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000']
  const rcParams = enforceReadableTextColors(enforcePublicationTypography({
    ...styleAdapter.rcParams,
    ...rcParamsPatch
  }))
  return {
    schemaVersion: 1,
    rcParams,
    palette,
    ...resolveHeatmapCmap({
      template: request.template,
      data: request.data,
      styleSpec,
      palette,
      useStylePalette: Boolean(request.styleSpec)
    })
  }
}

function resolveHeatmapCmap(input: {
  template: ScientificPlottingTemplate
  data: unknown
  styleSpec: FigureStyleSpec
  palette: string[]
  useStylePalette: boolean
}): { heatmapCmap?: NonNullable<ScientificPlotMatplotlibParametersV1['heatmapCmap']> } {
  if (input.template !== 'heatmap' && input.template !== 'attention-map') return {}
  const data = isRecord(input.data) ? input.data : {}
  const requestedCmap = typeof data.cmap === 'string' && data.cmap.trim()
    ? data.cmap.trim()
    : input.template === 'attention-map'
      ? 'magma'
      : 'cividis'
  if (!input.useStylePalette || !['viridis', 'cividis', 'plasma', 'magma'].includes(requestedCmap.toLowerCase())) {
    return { heatmapCmap: { kind: 'named', name: requestedCmap } }
  }
  const background = input.styleSpec.canvas.background
  const accents = uniqueHexStrings(input.palette)
    .filter((color) => color.toLowerCase() !== background.toLowerCase())
    .filter((color) => hexDistance(color, background) > 34)
    .slice(0, 5)
  if (accents.length === 0) return { heatmapCmap: { kind: 'named', name: requestedCmap } }
  const colors = hexLuminance(background) < 88
    ? uniqueHexStrings([background, ...accents])
    : uniqueHexStrings(['#ffffff', ...accents])
  return colors.length >= 2
    ? {
        heatmapCmap: {
          kind: 'linear-segmented',
          name: input.template === 'attention-map' ? 'sciforge_attention_map' : 'sciforge_style_heatmap',
          colors
        }
      }
    : { heatmapCmap: { kind: 'named', name: requestedCmap } }
}

function buildDataMappingCandidates(
  data: unknown,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
    templateHint?: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
    reproducibilityMode: 'standard' | 'reproducible'
    statistics?: StatisticalDefinitionV1
  }
): DataMappingCandidate[] {
  const candidates: DataMappingCandidate[] = []
  const add = (candidate: DataMappingCandidate): void => {
    try {
      validateTemplateData(candidate.template, candidate.data)
    } catch {
      return
    }
    if (candidates.some((item) => item.template === candidate.template && JSON.stringify(item.data) === JSON.stringify(candidate.data))) {
      return
    }
    candidates.push(candidate)
  }

  for (const candidate of templateReadyCandidates(data, context)) add(candidate)
  for (const candidate of matrixAndVectorCandidates(data, context)) add(candidate)
  const rows = extractTabularRows(data)
  if (rows.length > 0) {
    for (const candidate of tabularMappingCandidates(rows, context)) add(candidate)
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      confidence: adjustedMappingConfidence(candidate, context)
    }))
    .sort((left, right) => right.confidence - left.confidence)
}

function selectDataMappingCandidate(
  candidates: DataMappingCandidate[],
  context: {
    templateHint?: ScientificPlottingTemplate
    taskTemplate: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
  }
): DataMappingCandidate {
  if (context.templateHint) {
    const hinted = candidates.find((candidate) => candidate.template === context.templateHint)
    if (hinted) return hinted
  }
  const taskMatched = candidates.find((candidate) => candidate.template === context.taskTemplate)
  if (taskMatched) return taskMatched
  if (context.referenceProfile && context.referenceProfile.confidence >= 0.58) {
    const referenceMatched = candidates.find((candidate) => candidate.template === context.referenceProfile?.recommendedTemplate)
    if (referenceMatched) return referenceMatched
  }
  return candidates[0]
}

function adjustedMappingConfidence(
  candidate: DataMappingCandidate,
  context: {
    taskTemplate: ScientificPlottingTemplate
    templateHint?: ScientificPlottingTemplate
    referenceProfile?: ScientificPlottingReferenceProfile
  }
): number {
  let confidence = candidate.confidence
  if (context.templateHint === candidate.template) confidence += 0.16
  if (context.taskTemplate === candidate.template) confidence += 0.12
  if (context.referenceProfile?.recommendedTemplate === candidate.template) {
    confidence += context.referenceProfile.confidence >= 0.58 ? 0.08 : 0.03
  }
  return clampNumber(confidence, 0.2, 0.96)
}

function templateReadyCandidates(
  data: unknown,
  context: { labels?: ScientificPlottingLabels }
): DataMappingCandidate[] {
  const candidates: DataMappingCandidate[] = []
  for (const template of SCIENTIFIC_PLOTTING_TEMPLATES) {
    try {
      validateTemplateData(template, data)
      candidates.push({
        template,
        confidence: template === 'multi-panel' ? 0.94 : 0.9,
        data,
        labels: context.labels,
        inputShape: template === 'multi-panel'
          ? 'multi-panel'
          : template === 'heatmap' || template === 'attention-map'
            ? 'matrix'
            : template === 'schematic-grid' || template === 'flowchart'
              ? 'network'
              : 'template-ready',
        dataSignals: [template],
        reasons: [`Input already matches the controlled ${template} schema.`],
        warnings: [],
        summary: summarizeTemplateReadyData(template, data)
      })
    } catch {
      // Try the next controlled template.
    }
  }
  return candidates
}

function matrixAndVectorCandidates(
  data: unknown,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
  }
): DataMappingCandidate[] {
  const candidates: DataMappingCandidate[] = []
  const matrix = rawMatrixFromData(data)
  if (matrix) {
    const template = context.taskTemplate === 'attention-map' ? 'attention-map' : 'heatmap'
    candidates.push({
      template,
      confidence: template === 'attention-map' ? 0.82 : 0.78,
      data: { matrix },
      labels: mergeLabels(context.labels, {
        title: inferTitle(context.task),
        x: context.taskTemplate === 'attention-map' ? 'Target' : undefined,
        y: context.taskTemplate === 'attention-map' ? 'Source' : undefined
      }),
      inputShape: 'matrix',
      dataSignals: [template],
      reasons: [`Input is a ${matrix.length}x${matrix[0]?.length ?? 0} numeric matrix.`],
      warnings: [],
      summary: {
        inputShape: 'matrix',
        matrixShape: [matrix.length, matrix[0]?.length ?? 0]
      }
    })
  }
  if (isFiniteNumberArray(data, 1, MAX_DISTRIBUTION_POINTS)) {
    candidates.push({
      template: 'histogram-density',
      confidence: 0.76,
      data: {
        series: [{ name: 'Values', values: data }],
        bins: defaultHistogramBins(data.length)
      },
      labels: mergeLabels(context.labels, {
        title: inferTitle(context.task),
        x: 'Value',
        y: 'Density',
        legend: false
      }),
      inputShape: 'vector',
      dataSignals: ['histogram-density'],
      reasons: ['Input is a numeric vector, which maps to a distribution plot.'],
      warnings: [],
      summary: {
        inputShape: 'vector',
        seriesCount: 1,
        pointCount: data.length
      }
    })
  }
  return candidates
}

function tabularMappingCandidates(
  rows: Array<Record<string, unknown>>,
  context: {
    task: string
    labels?: ScientificPlottingLabels
    taskTemplate: ScientificPlottingTemplate
    reproducibilityMode?: 'standard' | 'reproducible'
    statistics?: StatisticalDefinitionV1
  }
): DataMappingCandidate[] {
  const profiles = profileTabularColumns(rows)
  const numericColumns = profiles.filter((profile) => profile.numericCount > 0)
  const categoricalColumns = profiles.filter((profile) =>
    profile.stringCount > 0 || (profile.numericCount > 0 && profile.uniqueValues.length <= Math.min(24, Math.max(4, rows.length / 2)))
  )
  const baseSummary = {
    inputShape: 'tabular' as const,
    rowCount: rows.length,
    columnCount: profiles.length,
    numericColumns: numericColumns.map((profile) => profile.key),
    categoricalColumns: categoricalColumns.map((profile) => profile.key)
  }
  const candidates: DataMappingCandidate[] = []
  const valueKey = chooseColumn(numericColumns, [/^(value|score|response|measurement|metric|accuracy|auroc|f1|loss)$/i, /value|score|response|metric|measurement/i])
    ?? numericColumns.find((profile) => !/error|sem|sd|ci|stderr/i.test(profile.key))?.key
  const errorKey = chooseColumn(numericColumns, [/^(error|sem|sd|ci|stderr)$/i, /error|sem|sd|ci|stderr/i])
  const inferredUncertainty = errorKey
    ? { kind: uncertaintyKindForColumn(errorKey), sourceColumn: errorKey }
    : undefined
  const categoryKey = chooseColumn(categoricalColumns, [/^(condition|treatment|group|category|class|target|cohort)$/i, /condition|treatment|group|category|class|target|cohort/i])
    ?? categoricalColumns.find((profile) => profile.key !== valueKey)?.key
  const seriesKey = chooseColumn(
    categoricalColumns.filter((profile) => profile.key !== categoryKey),
    [/^(method|model|series|algorithm|variant)$/i, /method|model|series|algorithm|variant/i]
  )
  const xKey = chooseColumn(profiles, [/^(x|time|epoch|step|dose|position)$/i, /time|epoch|step|dose|position/i])
  const yKey = chooseColumn(
    numericColumns.filter((profile) => profile.key !== xKey && profile.key !== errorKey),
    [/^(y|value|score|response|measurement|metric|accuracy|loss)$/i, /value|score|response|metric|measurement|accuracy|loss/i]
  ) ?? valueKey
  const pointCount = rows.length

  if (categoryKey && valueKey) {
    const grouped = groupedValues(rows, categoryKey, valueKey)
    if (grouped.length > 0) {
      const duplicateCount = grouped.filter((group) => group.values.length > 1).length
      candidates.push({
        template: 'box-violin',
        confidence: duplicateCount > 0 ? 0.78 : 0.58,
        data: {
          groups: grouped,
          showPoints: true
        },
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(categoryKey),
          y: labelFromColumn(valueKey)
        }),
        inputShape: 'tabular',
        dataSignals: ['box-violin'],
        reasons: [`Rows contain categorical ${categoryKey} and numeric ${valueKey} values.`],
        warnings: duplicateCount === 0 ? ['Only one value per group was detected; a bar chart may be clearer than a distribution plot.'] : [],
        summary: {
          ...baseSummary,
          groupCount: grouped.length,
          pointCount
        }
      })
    }
  }

  if (valueKey) {
    const series = categoryKey && context.taskTemplate === 'histogram-density'
      ? groupedValues(rows, categoryKey, valueKey).slice(0, MAX_SERIES).map((group) => ({
          name: group.name,
          values: group.values
        }))
      : [{ name: labelFromColumn(valueKey), values: numericValuesForColumn(rows, valueKey).slice(0, MAX_DISTRIBUTION_POINTS) }]
    if (series.length > 0 && series.every((item) => item.values.length > 0)) {
      candidates.push({
        template: 'histogram-density',
        confidence: context.taskTemplate === 'histogram-density' ? 0.82 : 0.56,
        data: {
          series,
          bins: defaultHistogramBins(Math.max(...series.map((item) => item.values.length)))
        },
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(valueKey),
          y: 'Density',
          legend: series.length > 1
        }),
        inputShape: 'tabular',
        dataSignals: ['histogram-density'],
        reasons: [`Rows contain numeric ${valueKey} values suitable for distribution shape analysis.`],
        warnings: [],
        summary: {
          ...baseSummary,
          seriesCount: series.length,
          pointCount
        }
      })
    }
  }

  if (categoryKey && valueKey) {
    const bar = barDataFromRows(rows, {
      categoryKey,
      valueKey,
      seriesKey,
      errorKey
    })
    if (bar) {
      const template: ScientificPlottingTemplate = errorKey ? 'errorbar-bar' : 'bar'
      candidates.push({
        template,
        confidence: context.taskTemplate === template || context.taskTemplate === 'bar' ? 0.82 : 0.64,
        data: bar.data,
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(categoryKey),
          y: labelFromColumn(valueKey),
          legend: Boolean(seriesKey)
        }),
        inputShape: 'tabular',
        dataSignals: [template],
        reasons: [`Rows contain categorical ${categoryKey} and summary-like numeric ${valueKey} values.`],
        warnings: bar.warnings,
        ...(bar.aggregationApplied ? { aggregationApplied: bar.aggregationApplied } : {}),
        ...(inferredUncertainty ? { inferredUncertainty } : {}),
        summary: {
          ...baseSummary,
          seriesCount: bar.seriesCount,
          groupCount: bar.categoryCount
        }
      })
    }
  }

  if (xKey && yKey) {
    const grouped = seriesFromRows(rows, { xKey, yKey, seriesKey })
    if (grouped.length > 0) {
      const scatter = context.taskTemplate === 'scatter' || (!/time|epoch|step/i.test(xKey) && numericColumns.some((profile) => profile.key === xKey))
      const template: ScientificPlottingTemplate = scatter ? 'scatter' : 'line'
      candidates.push({
        template,
        confidence: context.taskTemplate === template ? 0.84 : 0.7,
        data: {
          series: grouped
        },
        labels: mergeLabels(context.labels, {
          title: inferTitle(context.task),
          x: labelFromColumn(xKey),
          y: labelFromColumn(yKey),
          legend: grouped.length > 1
        }),
        inputShape: 'tabular',
        dataSignals: [template],
        reasons: [`Rows contain x=${xKey} and y=${yKey} columns.`],
        warnings: [],
        summary: {
          ...baseSummary,
          seriesCount: grouped.length,
          pointCount
        }
      })
    }
  }

  return candidates
}

function summarizeTemplateReadyData(template: ScientificPlottingTemplate, data: unknown): DataSummary {
  if (isRecord(data) && template === 'multi-panel' && Array.isArray(data.panels)) {
    return { inputShape: 'multi-panel', seriesCount: data.panels.length }
  }
  if (isRecord(data) && (template === 'heatmap' || template === 'attention-map') && Array.isArray(data.matrix)) {
    const width = Array.isArray(data.matrix[0]) ? data.matrix[0].length : 0
    return { inputShape: 'matrix', matrixShape: [data.matrix.length, width] }
  }
  if (isRecord(data) && template === 'box-violin' && Array.isArray(data.groups)) {
    return {
      inputShape: 'template-ready',
      groupCount: data.groups.length,
      pointCount: data.groups.reduce((sum, group) => isRecord(group) && Array.isArray(group.values) ? sum + group.values.length : sum, 0)
    }
  }
  if (isRecord(data) && Array.isArray(data.series)) {
    return {
      inputShape: 'template-ready',
      seriesCount: data.series.length
    }
  }
  if (isRecord(data) && (template === 'schematic-grid' || template === 'flowchart') && Array.isArray(data.nodes)) {
    return { inputShape: 'network', groupCount: data.nodes.length }
  }
  return { inputShape: 'template-ready' }
}

function extractTabularRows(data: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.rows)
      ? data.rows
      : isRecord(data) && Array.isArray(data.records)
        ? data.records
        : isRecord(data) && Array.isArray(data.table)
          ? data.table
          : []
  return candidate.filter(isRecord).slice(0, MAX_POINTS)
}

function profileTabularColumns(rows: Array<Record<string, unknown>>): TabularColumnProfile[] {
  const keys = uniqueStrings(rows.flatMap((row) => Object.keys(row))).slice(0, 64)
  return keys.map((key) => {
    const finiteValues: number[] = []
    const uniqueValues: string[] = []
    let numericCount = 0
    let stringCount = 0
    for (const row of rows) {
      const value = row[key]
      const numeric = numberFromCell(value)
      if (numeric !== undefined) {
        numericCount += 1
        finiteValues.push(numeric)
      }
      const stringValue = stringFromCell(value)
      if (stringValue !== undefined) {
        stringCount += 1
        if (!uniqueValues.includes(stringValue)) uniqueValues.push(stringValue)
      }
    }
    return {
      key,
      numericCount,
      stringCount,
      finiteValues,
      uniqueValues: uniqueValues.slice(0, 250)
    }
  })
}

function chooseColumn(
  profiles: TabularColumnProfile[],
  patterns: RegExp[]
): string | undefined {
  for (const pattern of patterns) {
    const matched = profiles.find((profile) => pattern.test(profile.key))
    if (matched) return matched.key
  }
  return undefined
}

function groupedValues(
  rows: Array<Record<string, unknown>>,
  groupKey: string,
  valueKey: string
): Array<{ name: string; values: number[] }> {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const group = stringFromCell(row[groupKey])
    const value = numberFromCell(row[valueKey])
    if (group === undefined || value === undefined) continue
    const current = groups.get(group) ?? []
    current.push(value)
    groups.set(group, current)
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 0)
    .slice(0, MAX_DISTRIBUTION_GROUPS)
    .map(([name, values]) => ({
      name,
      values: values.slice(0, MAX_DISTRIBUTION_POINTS)
    }))
}

function numericValuesForColumn(rows: Array<Record<string, unknown>>, key: string): number[] {
  return rows
    .map((row) => numberFromCell(row[key]))
    .filter((value): value is number => value !== undefined)
}

function seriesFromRows(
  rows: Array<Record<string, unknown>>,
  input: {
    xKey: string
    yKey: string
    seriesKey?: string
  }
): Array<{ name?: string; x: Array<number | string>; y: number[] }> {
  const buckets = new Map<string, Array<{ x: number | string; y: number }>>()
  for (const row of rows) {
    const x = axisValueFromCell(row[input.xKey])
    const y = numberFromCell(row[input.yKey])
    if (x === undefined || y === undefined) continue
    const name = input.seriesKey ? stringFromCell(row[input.seriesKey]) ?? 'Series' : 'Series'
    const current = buckets.get(name) ?? []
    current.push({ x, y })
    buckets.set(name, current)
  }
  return [...buckets.entries()]
    .slice(0, MAX_SERIES)
    .map(([name, values]) => ({
      ...(name !== 'Series' ? { name } : {}),
      x: values.map((value) => value.x),
      y: values.map((value) => value.y)
    }))
    .filter((series) => series.y.length > 0)
}

function barDataFromRows(
  rows: Array<Record<string, unknown>>,
  input: {
    categoryKey: string
    valueKey: string
    seriesKey?: string
    errorKey?: string
  }
): {
  data: { categories: string[]; series: Array<{ name?: string; values: number[]; error?: number[] }> }
  seriesCount: number
  categoryCount: number
  warnings: string[]
  aggregationApplied?: { method: 'mean'; groupBy: string[] }
} | null {
  const warnings: string[] = []
  let aggregated = false
  const categories = uniqueStrings(
    rows
      .map((row) => stringFromCell(row[input.categoryKey]))
      .filter((value): value is string => value !== undefined)
  ).slice(0, 200)
  if (categories.length === 0) return null
  const seriesNames = input.seriesKey
    ? uniqueStrings(rows.map((row) => stringFromCell(row[input.seriesKey!])).filter((value): value is string => value !== undefined)).slice(0, MAX_SERIES)
    : ['Value']
  if (seriesNames.length === 0) return null
  const series: Array<{ name?: string; values: number[]; error?: number[] }> = []
  for (const seriesName of seriesNames) {
    const values: number[] = []
    const errors: number[] = []
    for (const category of categories) {
      const matching = rows.filter((row) =>
        stringFromCell(row[input.categoryKey]) === category &&
        (!input.seriesKey || stringFromCell(row[input.seriesKey]) === seriesName)
      )
      const finite = matching
        .map((row) => numberFromCell(row[input.valueKey]))
        .filter((value): value is number => value !== undefined)
      if (finite.length === 0) return null
      if (finite.length > 1) {
        aggregated = true
        warnings.push(`Averaged ${finite.length} rows for ${seriesName}/${category}; this aggregation must be declared for reproducible rendering.`)
      }
      values.push(mean(finite))
      if (input.errorKey) {
        const errorValues = matching
          .map((row) => numberFromCell(row[input.errorKey!]))
          .filter((value): value is number => value !== undefined)
        if (errorValues.length > 0) errors.push(mean(errorValues))
      }
    }
    series.push({
      ...(input.seriesKey ? { name: seriesName } : {}),
      values,
      ...(input.errorKey && errors.length === categories.length ? { error: errors } : {})
    })
  }
  return {
    data: {
      categories,
      series
    },
    seriesCount: series.length,
    categoryCount: categories.length,
    warnings: uniqueStrings(warnings).slice(0, 8),
    ...(aggregated ? {
      aggregationApplied: {
        method: 'mean' as const,
        groupBy: input.seriesKey ? [input.seriesKey, input.categoryKey] : [input.categoryKey]
      }
    } : {})
  }
}

function uncertaintyKindForColumn(column: string): 'sd' | 'sem' | 'ci' | 'ambiguous' {
  const normalized = column.trim().toLowerCase()
  if (/^(sd|std|standard[_\s-]?deviation)$/.test(normalized)) return 'sd'
  if (/^(sem|stderr|standard[_\s-]?error)$/.test(normalized)) return 'sem'
  if (/^(ci|confidence[_\s-]?interval)$/.test(normalized)) return 'ci'
  return 'ambiguous'
}

function rawMatrixFromData(data: unknown): number[][] | null {
  const candidate = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.matrix)
      ? data.matrix
      : null
  if (!Array.isArray(candidate) || candidate.length === 0 || !Array.isArray(candidate[0])) return null
  const width = candidate[0].length
  if (width === 0 || candidate.length * width > MAX_HEATMAP_CELLS) return null
  const matrix: number[][] = []
  for (const row of candidate) {
    if (!Array.isArray(row) || row.length !== width) return null
    const values = row.map(numberFromCell)
    if (values.some((value) => value === undefined)) return null
    matrix.push(values as number[])
  }
  return matrix
}

function numberFromCell(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringFromCell(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function axisValueFromCell(value: unknown): number | string | undefined {
  const numeric = numberFromCell(value)
  if (numeric !== undefined) return numeric
  return stringFromCell(value)
}

function mergeLabels(
  primary: ScientificPlottingLabels | undefined,
  inferred: ScientificPlottingLabels | undefined
): ScientificPlottingLabels {
  return {
    ...(inferred ?? {}),
    ...(primary ?? {})
  }
}

function inferTitle(task: string): string | undefined {
  const trimmed = task.trim()
  if (!trimmed || trimmed.length > 80) return undefined
  return trimmed
}

function labelFromColumn(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase())
}

function defaultHistogramBins(pointCount: number): number {
  return Math.max(5, Math.min(40, Math.ceil(Math.sqrt(Math.max(1, pointCount)))))
}

function declaresAggregation(
  statistics: StatisticalDefinitionV1 | undefined,
  applied: NonNullable<DataMappingCandidate['aggregationApplied']>
): boolean {
  if (statistics?.aggregation?.method !== applied.method) return false
  const declared = new Set(statistics.aggregation.groupBy.map((item) => item.trim()).filter(Boolean))
  const actual = new Set(applied.groupBy)
  return declared.size === actual.size && [...actual].every((item) => declared.has(item))
}

function inlineDataSourceRef(sha256: string, locator: string): DataSourceRef {
  return {
    schemaVersion: 1,
    sourceId: `inline-${sha256.slice(0, 16)}`,
    kind: 'inline',
    locator: `inline:${locator}`,
    sha256,
    mediaType: 'application/json'
  }
}

function buildMappingTransformation(input: {
  inputHash: string
  outputHash: string
  selected: DataMappingCandidate
  selectedBy: 'templateHint' | 'dataShape' | 'task' | 'referenceProfile'
}): ScientificPlotTransformationV1 {
  const kind: ScientificPlotTransformationV1['kind'] = input.selected.aggregationApplied
    ? 'group-aggregate'
    : input.selected.inputShape === 'tabular'
      ? 'tabular-map'
      : input.selected.inputShape === 'matrix'
        ? 'matrix-map'
        : input.selected.inputShape === 'vector'
          ? 'vector-map'
          : input.selected.inputShape === 'network'
            ? 'scene-map'
            : 'identity'
  const parameters = {
    template: input.selected.template,
    selectedBy: input.selectedBy,
    reasons: input.selected.reasons,
    ...(input.selected.aggregationApplied ? { aggregation: input.selected.aggregationApplied } : {})
  }
  return {
    schemaVersion: 1,
    transformationId: `transform-${hashStableJson({
      kind,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      parameters
    }).slice(0, 20)}`,
    kind,
    description: input.selected.aggregationApplied
      ? `Map tabular data to ${input.selected.template} and apply the explicitly declared group aggregation.`
      : `Map input data to the controlled ${input.selected.template} schema.`,
    parameters,
    inputHash: input.inputHash,
    outputHash: input.outputHash
  }
}

function buildDerivedTableReceipt(input: {
  selected: DataMappingCandidate
  sourceIds: string[]
  transformation: ScientificPlotTransformationV1
}): DerivedTableReceipt {
  const summary = input.selected.summary
  return {
    schemaVersion: 1,
    receiptId: `derived-${hashStableJson({
      sources: input.sourceIds,
      transformationId: input.transformation.transformationId
    }).slice(0, 20)}`,
    inputSourceIds: input.sourceIds,
    operation: input.transformation.kind,
    inputHash: input.transformation.inputHash,
    outputHash: input.transformation.outputHash,
    transformationIds: [input.transformation.transformationId],
    ...(summary.rowCount !== undefined ? { rowCount: summary.rowCount } : {}),
    ...(summary.columnCount !== undefined ? { columnCount: summary.columnCount } : {}),
    ...(summary.numericColumns || summary.categoricalColumns
      ? { columns: uniqueStrings([...(summary.numericColumns ?? []), ...(summary.categoricalColumns ?? [])]) }
      : {}),
    warnings: [...input.selected.warnings]
  }
}

function inferredStatisticsForCandidate(candidate: DataMappingCandidate): StatisticalDefinitionV1 | undefined {
  const statisticalTemplate = candidate.template === 'box-violin'
    || candidate.template === 'histogram-density'
    || candidate.template === 'errorbar-bar'
  if (!statisticalTemplate && !candidate.aggregationApplied && !candidate.inferredUncertainty) return undefined
  const estimator: StatisticalDefinitionV1['estimator'] = candidate.template === 'histogram-density'
    ? 'density'
    : candidate.aggregationApplied
      ? 'mean'
      : 'raw'
  return {
    schemaVersion: 1,
    estimator,
    ...(candidate.aggregationApplied ? {
      aggregation: {
        method: candidate.aggregationApplied.method,
        groupBy: [...candidate.aggregationApplied.groupBy]
      }
    } : {}),
    ...(candidate.inferredUncertainty?.kind && candidate.inferredUncertainty.kind !== 'ambiguous' ? {
      uncertainty: {
        kind: candidate.inferredUncertainty.kind,
        sourceColumn: candidate.inferredUncertainty.sourceColumn,
        suppliedBy: 'source' as const
      }
    } : {}),
    missingValues: 'reject',
    notes: ['Inferred from the controlled data mapping; provide an explicit definition to override.']
  }
}

function mean(values: number[]): number {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function validateRenderRequestShape(request: ScientificPlottingRenderRequest): void {
  if (!SCIENTIFIC_PLOTTING_TEMPLATES.includes(request.template)) {
    throw new Error(`Unsupported scientific plotting template: ${String(request.template)}.`)
  }
  if (request.styleSpec && !isFigureStyleSpec(request.styleSpec)) {
    throw new Error('styleSpec must be a FigureStyleSpec v1 object.')
  }
  if (request.matplotlib && !isScientificPlotMatplotlibParametersV1(request.matplotlib)) {
    throw new Error('matplotlib must contain finite rcParams, a non-empty palette, and a valid heatmap cmap.')
  }
  if (request.matplotlib) validatePinnedMatplotlibForTemplate(request.template, request.matplotlib)
  normalizeOutputScale(request.outputScale)
}

function validatePinnedMatplotlibForTemplate(
  template: ScientificPlottingTemplate,
  matplotlib: ScientificPlotMatplotlibParametersV1
): void {
  const isHeatmap = template === 'heatmap' || template === 'attention-map'
  if (isHeatmap && !matplotlib.heatmapCmap) {
    throw new Error(`Pinned Matplotlib parameters for ${template} require heatmapCmap.`)
  }
  if (!isHeatmap && matplotlib.heatmapCmap) {
    throw new Error(`Pinned Matplotlib parameters for ${template} cannot declare heatmapCmap.`)
  }
  if (matplotlib.heatmapCmap?.kind === 'linear-segmented') {
    const expected = template === 'attention-map' ? 'sciforge_attention_map' : 'sciforge_style_heatmap'
    if (matplotlib.heatmapCmap.name !== expected) {
      throw new Error(`Pinned Matplotlib heatmap cmap name must be ${expected} for ${template}.`)
    }
  }
}

function validateTemplateData(template: ScientificPlottingTemplate, data: unknown): void {
  if (!isRecord(data)) throw new Error('data must be a JSON object.')
  if (template === 'line' || template === 'scatter') {
    const series = data.series
    if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
      throw new Error(`${template} data.series must include 1-${MAX_SERIES} series.`)
    }
    for (const item of series) {
      if (!isRecord(item)) throw new Error(`${template} series entries must be objects.`)
      const y = item.y
      if (!isFiniteNumberArray(y, 1, MAX_POINTS)) {
        throw new Error(`${template} series.y must be a finite number array.`)
      }
      if (item.x !== undefined && !isAxisArray(item.x, y.length)) {
        throw new Error(`${template} series.x must match y length.`)
      }
      if (item.error !== undefined && !isFiniteNumberArray(item.error, y.length, y.length)) {
        throw new Error(`${template} series.error must match y length.`)
      }
    }
    return
  }
  if (template === 'bar' || template === 'errorbar-bar') {
    const categories = data.categories
    const series = data.series
    if (!isStringArray(categories, 1, 200)) throw new Error(`${template} data.categories must be a string array.`)
    if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
      throw new Error(`${template} data.series must include 1-${MAX_SERIES} series.`)
    }
    for (const item of series) {
      if (!isRecord(item) || !isFiniteNumberArray(item.values, categories.length, categories.length)) {
        throw new Error(`${template} series.values must match categories length.`)
      }
      if (
        item.error !== undefined &&
        !isFiniteNumberArray(item.error, categories.length, categories.length)
      ) {
        throw new Error(`${template} series.error must match categories length.`)
      }
    }
    return
  }
  if (template === 'heatmap' || template === 'attention-map') {
    const matrix = data.matrix
    if (!Array.isArray(matrix) || matrix.length === 0) throw new Error(`${template} data.matrix is required.`)
    const width = Array.isArray(matrix[0]) ? matrix[0].length : 0
    if (width <= 0 || matrix.length * width > MAX_HEATMAP_CELLS) {
      throw new Error(`${template} matrix must contain at most ${MAX_HEATMAP_CELLS} cells.`)
    }
    for (const row of matrix) {
      if (!isFiniteNumberArray(row, width, width)) {
        throw new Error(`${template} matrix rows must be equal-length finite number arrays.`)
      }
    }
    return
  }
  if (template === 'box-violin') {
    const groups = data.groups
    if (!Array.isArray(groups) || groups.length === 0 || groups.length > MAX_DISTRIBUTION_GROUPS) {
      throw new Error(`box-violin data.groups must include 1-${MAX_DISTRIBUTION_GROUPS} groups.`)
    }
    for (const group of groups) {
      if (
        !isRecord(group) ||
        typeof group.name !== 'string' ||
        !group.name.trim() ||
        !isFiniteNumberArray(group.values, 1, MAX_DISTRIBUTION_POINTS)
      ) {
        throw new Error('box-violin groups must include name and finite values.')
      }
    }
    return
  }
  if (template === 'histogram-density') {
    const series = data.series
    if (!Array.isArray(series) || series.length === 0 || series.length > MAX_SERIES) {
      throw new Error(`histogram-density data.series must include 1-${MAX_SERIES} series.`)
    }
    for (const item of series) {
      if (!isRecord(item) || !isFiniteNumberArray(item.values, 1, MAX_DISTRIBUTION_POINTS)) {
        throw new Error('histogram-density series entries must include finite values.')
      }
    }
    if (
      data.bins !== undefined &&
      (typeof data.bins !== 'number' || !Number.isInteger(data.bins) || data.bins < 5 || data.bins > 120)
    ) {
      throw new Error('histogram-density bins must be an integer from 5 to 120.')
    }
    return
  }
  if (template === 'multi-panel') {
    const panels = data.panels
    if (!Array.isArray(panels) || panels.length === 0 || panels.length > MAX_MULTI_PANELS) {
      throw new Error(`multi-panel data.panels must include 1-${MAX_MULTI_PANELS} panels.`)
    }
    if (
      data.columns !== undefined &&
      (typeof data.columns !== 'number' || !Number.isInteger(data.columns) || data.columns < 1 || data.columns > 3)
    ) {
      throw new Error('multi-panel columns must be an integer from 1 to 3.')
    }
    for (const panel of panels) {
      if (!isRecord(panel) || typeof panel.template !== 'string' || !isRecord(panel.data)) {
        throw new Error('multi-panel panels must include template and data.')
      }
      if (panel.template === 'multi-panel' || !SCIENTIFIC_PLOTTING_TEMPLATES.includes(panel.template as ScientificPlottingTemplate)) {
        throw new Error('multi-panel nested panels must use a supported non-multi-panel template.')
      }
      validateTemplateData(panel.template as ScientificPlottingTemplate, panel.data)
    }
    return
  }
  if (template === 'schematic-grid' || template === 'flowchart') {
    const nodes = data.nodes === undefined ? [] : data.nodes
    const primitives = template === 'schematic-grid' && data.primitives !== undefined
      ? data.primitives
      : []
    const maxNodes = template === 'flowchart' ? MAX_FLOWCHART_NODES : MAX_SCHEMATIC_NODES
    if (!Array.isArray(nodes) || nodes.length > maxNodes) {
      throw new Error(`${template} data.nodes must be an array with at most ${maxNodes} entries for the locked code route.`)
    }
    if (template === 'flowchart' && nodes.length === 0) {
      throw new Error(`flowchart data.nodes must include 1-${MAX_FLOWCHART_NODES} compact nodes for the locked code route.`)
    }
    if (template === 'schematic-grid') {
      if (!Array.isArray(primitives) || primitives.length > MAX_SCHEMATIC_PRIMITIVES) {
        throw new Error(`schematic-grid data.primitives must be an array with at most ${MAX_SCHEMATIC_PRIMITIVES} entries.`)
      }
      if (nodes.length === 0 && primitives.length === 0) {
        throw new Error('schematic-grid requires at least one node or vector primitive.')
      }
      validateSchematicPrimitives(primitives)
    }
    const labels: string[] = []
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.label !== 'string' || !node.label.trim()) {
        throw new Error(`${template} nodes must include labels.`)
      }
      labels.push(node.label.trim())
    }
    if (template === 'flowchart' && labels.join(' ').length > MAX_FLOWCHART_LABEL_CHARS) {
      throw new Error(`flowchart node labels must be compact and total at most ${MAX_FLOWCHART_LABEL_CHARS} characters for the locked code route.`)
    }
    if (template === 'flowchart' && data.edges !== undefined) {
      if (!Array.isArray(data.edges)) throw new Error('flowchart data.edges must be an array when provided.')
      for (const edge of data.edges) {
        if (!isRecord(edge) || edge.from === undefined || edge.to === undefined) {
          throw new Error('flowchart edges must include from and to.')
        }
      }
    }
  }
}

function validateSchematicPrimitives(primitives: unknown[]): void {
  const shapes = new Set(['circle', 'ellipse', 'rectangle', 'rect', 'triangle', 'polygon'])
  const linear = new Set(['line', 'arrow'])
  const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
  for (const primitive of primitives) {
    if (!isRecord(primitive)) throw new Error('schematic-grid primitives must be objects.')
    const type = typeof primitive.type === 'string'
      ? primitive.type.trim().toLowerCase()
      : typeof primitive.kind === 'string'
        ? primitive.kind.trim().toLowerCase()
        : ''
    if (type === 'text') {
      if (typeof primitive.text !== 'string' || !finite(primitive.x) || !finite(primitive.y)) {
        throw new Error('Text primitives require text and finite x/y coordinates.')
      }
      continue
    }
    if (linear.has(type)) {
      if (![primitive.x1, primitive.y1, primitive.x2, primitive.y2].every(finite)) {
        throw new Error(`${type} primitives require finite x1/y1/x2/y2 coordinates.`)
      }
      continue
    }
    if (!shapes.has(type) || !finite(primitive.x) || !finite(primitive.y)) {
      throw new Error('Shape primitives require a supported type and finite x/y coordinates.')
    }
    if (type === 'polygon') {
      if (!Array.isArray(primitive.points) || primitive.points.length < 3 || primitive.points.length > 256) {
        throw new Error('Polygon primitives require 3-256 points.')
      }
      if (!primitive.points.every((point) => isRecord(point) && finite(point.x) && finite(point.y))) {
        throw new Error('Polygon primitive points require finite x/y coordinates.')
      }
      continue
    }
    const hasPositiveSize = [primitive.radius, primitive.diameter, primitive.width, primitive.w]
      .some((value) => finite(value) && Number(value) > 0)
    if (!hasPositiveSize) {
      throw new Error(`${type} primitives require a positive radius, diameter, width, or w value.`)
    }
  }
}

function inferTemplateSignalsFromText(text: string): ScientificPlottingTemplate[] {
  const signals: ScientificPlottingTemplate[] = []
  const add = (template: ScientificPlottingTemplate, pattern: RegExp): void => {
    if (!pattern.test(text)) return
    if (!signals.includes(template)) signals.push(template)
  }
  add('multi-panel', /multi[-\s]?panel|多\s*panel|subplot|facet|figure panel|panel figure|组合图|复合图|拼接图|拼图|多面板|多子图/i)
  add('box-violin', /violin|box\s*plot|boxplot|strip\s*plot|swarm|distribution comparison|compare .*distributions?|distributions? (for|across|by) (conditions?|groups?|categories?|recipes?|arms?)|distribution by (condition|group|category)|grouped distribution|箱线图|小提琴图|组间分布/i)
  add('histogram-density', /histogram|density|kde|residual distribution|value distribution|分布图|直方图|密度图/i)
  add('flowchart', /flow\s*chart|flowchart|workflow|pipeline|process flow|decision tree|pathway|流程图|流程|工作流|管线|步骤|路径/i)
  add('schematic-grid', /schematic|diagram|mechanism|architecture|model structure|network structure|array programming|numpy|示意|机制|架构|模型结构|网络结构/i)
  add('attention-map', /attention\s*(?:map|matrix|heatmap|weights?)|token alignment|注意力(?:图|矩阵|热图|权重)/i)
  add('heatmap', /heatmap|matrix|correlation|表达矩阵|热图|矩阵/i)
  add('scatter', /scatter|embedding|umap|tsne|point cloud|散点|降维/i)
  add('errorbar-bar', /error\s*bar|confidence interval|ci\b|uncertainty|误差棒|置信区间|不确定性/i)
  add('bar', /bar|category|comparison|benchmark|柱状|条形|分类|基准/i)
  add('line', /line|curve|trend|time series|trajectory|折线|曲线|趋势|时间序列/i)
  return signals
}

function kindForTemplate(
  template: ScientificPlottingTemplate,
  score: number
): ScientificPlottingReferenceProfile['kind'] {
  if (score < 0.28) return 'unknown'
  if (template === 'heatmap' || template === 'attention-map') return 'matrix'
  if (template === 'schematic-grid' || template === 'flowchart') return 'schematic'
  if (template === 'multi-panel') return 'mixed'
  return 'chart'
}

function requiredInputsForTemplate(template: ScientificPlottingTemplate): string[] {
  if (template === 'bar') return ['categories', 'series[].values', 'optional labels']
  if (template === 'errorbar-bar') return ['categories', 'series[].values', 'optional series[].error', 'optional labels']
  if (template === 'heatmap') return ['matrix', 'optional xLabels/yLabels', 'optional labels']
  if (template === 'attention-map') return ['matrix', 'optional xLabels/yLabels', 'optional labels']
  if (template === 'box-violin') return ['groups[].name', 'groups[].values', 'optional showPoints/mode']
  if (template === 'histogram-density') return ['series[].values', 'optional bins/density']
  if (template === 'multi-panel') return ['panels[].template', 'panels[].data', 'optional columns and labels']
  if (template === 'flowchart') return ['nodes[].id', 'nodes[].label', 'optional edges[].from/to']
  if (template === 'schematic-grid') return ['nodes[].label', 'optional edges', 'optional labels']
  return ['series[].y', 'optional series[].x', 'optional labels']
}

function builtInStyleProfiles(): ScientificPlottingStyleProfile[] {
  return [
    {
      id: 'nature-2021-alphafold-fig2',
      name: 'Nature 2021 AlphaFold Fig. 2',
      venue: 'Nature',
      sourceLabel: 'AlphaFold style smoke reference',
      description: 'Tall, light-background comparison chart with pale blue accents, visible grid, compact typography, and outside legend handling.',
      recommendedTemplates: ['bar', 'errorbar-bar', 'line', 'box-violin'],
      tags: ['nature', 'biology', 'benchmark', 'light', 'grid', 'bar', 'errorbar'],
      styleSpec: profileStyleSpec({
        id: 'nature-2021-alphafold-fig2',
        width: 546,
        height: 900,
        background: '#ffffff',
        colors: ['#90d8f0', '#c0d8f0', '#90c0d8', '#78a8d8', '#4890c0', '#181818'],
        ink: '#000000',
        colorMode: 'multi-hue',
        axisSize: 8,
        labelSize: 9,
        titleSize: 11,
        panelLabels: 'unknown',
        margin: { left: 0.12, right: 0.04, top: 0.04, bottom: 0.1 },
        grid: true,
        gridTone: 'light',
        gridColor: '#f0f0ff',
        lineWidth: 1.1,
        markerSize: 3.8,
        density: 'balanced',
        confidence: { overall: 0.88, palette: 0.73, layout: 0.72, axes: 0.62, typography: 0.35 }
      }),
      referenceProfile: {
        kind: 'chart',
        recommendedTemplate: 'bar',
        confidence: 0.36,
        detectedTraits: {
          aspect: 'tall',
          background: 'light',
          axes: 'measured',
          grid: 'light',
          markDensity: 'balanced',
          colorMode: 'multi-hue',
          panelGrid: '1x1',
          textSignals: []
        },
        reasons: [
          'Tall chart with visible grid is compatible with categorical comparison panels.',
          'Visible axes and grid indicate a measured chart rather than a freeform schematic.'
        ],
        risks: ['Typography was inferred conservatively; exact font matching should be reviewed visually.']
      },
      cautions: [
        'Use for measured charts, not freeform illustrations.',
        'Legend and grid may need visual review for dense categorical panels.'
      ]
    },
    {
      id: 'nature-2020-numpy-fig1',
      name: 'Nature 2020 NumPy Fig. 1',
      venue: 'Nature',
      sourceLabel: 'NumPy paper schematic smoke reference',
      description: 'Clean explanatory schematic style with white background, minimal axes, muted blues/yellows, and compact labels.',
      recommendedTemplates: ['schematic-grid', 'flowchart', 'multi-panel', 'bar'],
      tags: ['nature', 'numpy', 'schematic', 'software', 'light', 'minimal'],
      styleSpec: profileStyleSpec({
        id: 'nature-2020-numpy-fig1',
        width: 900,
        height: 520,
        background: '#ffffff',
        colors: ['#4c78a8', '#f2cf5b', '#72b7b2', '#d9d9d9', '#333333'],
        ink: '#222222',
        colorMode: 'limited',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'unknown',
        margin: { left: 0.08, right: 0.08, top: 0.07, bottom: 0.12 },
        grid: false,
        gridTone: 'none',
        gridColor: '#ffffff',
        lineWidth: 0.9,
        markerSize: 3.2,
        density: 'balanced',
        confidence: { overall: 0.72, palette: 0.68, layout: 0.7, axes: 0.45, typography: 0.35 }
      }),
      referenceProfile: {
        kind: 'schematic',
        recommendedTemplate: 'schematic-grid',
        confidence: 0.66,
        detectedTraits: {
          aspect: 'wide',
          background: 'light',
          axes: 'minimal',
          grid: 'none',
          markDensity: 'balanced',
          colorMode: 'limited',
          panelGrid: '1x1',
          textSignals: ['schematic-grid']
        },
        reasons: ['Schematic reference emphasizes labeled regions and relationships rather than measured axes.'],
        risks: ['Semantic layout still needs human review because schematic matching is not a pixel-only problem.']
      },
      cautions: [
        'Use for conceptual diagrams and software architecture figures.',
        'Pixel similarity can under-score semantically correct schematics.'
      ]
    },
    {
      id: 'neurips-2017-attention',
      name: 'NeurIPS 2017 Attention Visualization',
      venue: 'NeurIPS',
      sourceLabel: 'Attention is All You Need style smoke reference',
      description: 'Dark matrix/attention-map profile with warm sequential colors, compact typography, and sparse axes.',
      recommendedTemplates: ['attention-map', 'heatmap'],
      tags: ['neurips', 'attention', 'machine-learning', 'heatmap', 'dark', 'matrix'],
      styleSpec: profileStyleSpec({
        id: 'neurips-2017-attention',
        width: 900,
        height: 420,
        background: '#000000',
        colors: ['#000000', '#2a1234', '#5f2c45', '#b05a3c', '#f2c66d'],
        ink: '#f5f5f5',
        colorMode: 'multi-hue',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'unknown',
        margin: { left: 0.18, right: 0.08, top: 0.06, bottom: 0.18 },
        grid: false,
        gridTone: 'none',
        gridColor: '#000000',
        lineWidth: 0.8,
        markerSize: 2.8,
        density: 'sparse',
        confidence: { overall: 0.78, palette: 0.8, layout: 0.64, axes: 0.5, typography: 0.35 }
      }),
      referenceProfile: {
        kind: 'matrix',
        recommendedTemplate: 'attention-map',
        confidence: 0.78,
        detectedTraits: {
          aspect: 'wide',
          background: 'dark',
          axes: 'measured',
          grid: 'none',
          markDensity: 'sparse',
          colorMode: 'multi-hue',
          panelGrid: '1x1',
          textSignals: ['attention-map']
        },
        reasons: ['Dark matrix with token labels and warm sequential palette fits attention-map rendering.'],
        risks: ['Typography and tick-label density should be checked visually for long token labels.']
      },
      cautions: [
        'Use only for matrix-like attention or alignment data.',
        'Axes/spine scoring can be harsh for dark heatmap references.'
      ]
    },
    {
      id: 'nature-publication-light',
      name: 'Nature Publication Light',
      venue: 'Nature-style generic',
      sourceLabel: 'SciForge first-party publication profile',
      description: 'General light-background publication chart style with colorblind-safe accents, compact typography, and restrained grid.',
      recommendedTemplates: ['line', 'scatter', 'bar', 'errorbar-bar', 'box-violin', 'histogram-density'],
      tags: ['nature', 'publication', 'generic', 'light', 'colorblind-safe'],
      styleSpec: profileStyleSpec({
        id: 'nature-publication-light',
        width: 900,
        height: 620,
        background: '#ffffff',
        colors: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000'],
        ink: '#222222',
        colorMode: 'limited',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'none',
        margin: { left: 0.13, right: 0.06, top: 0.08, bottom: 0.14 },
        grid: true,
        gridTone: 'light',
        gridColor: '#e8e8e8',
        lineWidth: 1,
        markerSize: 3,
        density: 'balanced',
        confidence: { overall: 0.7, palette: 0.75, layout: 0.7, axes: 0.7, typography: 0.65 }
      }),
      referenceProfile: {
        kind: 'chart',
        recommendedTemplate: 'line',
        confidence: 0.54,
        detectedTraits: {
          aspect: 'wide',
          background: 'light',
          axes: 'measured',
          grid: 'light',
          markDensity: 'balanced',
          colorMode: 'limited',
          panelGrid: '1x1',
          textSignals: ['line']
        },
        reasons: ['Generic publication profile supports measured charts with compact text and restrained colors.'],
        risks: ['This is a generic profile; use paper-specific profiles when a reference figure is available.']
      },
      cautions: ['Prefer extracted StyleSpec for exact journal figure matching.']
    },
    {
      id: 'cell-systems-statistical',
      name: 'Cell Systems Statistical',
      venue: 'Cell-style generic',
      sourceLabel: 'SciForge first-party statistical profile',
      description: 'Dense but readable statistical profile for distributions, summary bars, and multi-panel biomedical comparisons.',
      recommendedTemplates: ['box-violin', 'errorbar-bar', 'bar', 'multi-panel'],
      tags: ['cell', 'systems', 'biology', 'statistical', 'distribution', 'multi-panel'],
      styleSpec: profileStyleSpec({
        id: 'cell-systems-statistical',
        width: 900,
        height: 700,
        background: '#ffffff',
        colors: ['#3b6ea8', '#e07a5f', '#57a773', '#b56576', '#404040'],
        ink: '#1f1f1f',
        colorMode: 'limited',
        axisSize: 7,
        labelSize: 8,
        titleSize: 10,
        panelLabels: 'A/B/C',
        margin: { left: 0.14, right: 0.08, top: 0.08, bottom: 0.15 },
        grid: false,
        gridTone: 'none',
        gridColor: '#ffffff',
        lineWidth: 1.05,
        markerSize: 2.8,
        density: 'dense',
        confidence: { overall: 0.68, palette: 0.72, layout: 0.68, axes: 0.72, typography: 0.65 }
      }),
      referenceProfile: {
        kind: 'chart',
        recommendedTemplate: 'box-violin',
        confidence: 0.62,
        detectedTraits: {
          aspect: 'wide',
          background: 'light',
          axes: 'measured',
          grid: 'none',
          markDensity: 'dense',
          colorMode: 'limited',
          panelGrid: '1x1',
          textSignals: ['box-violin']
        },
        reasons: ['Dense statistical comparisons benefit from individual points, compact typography, and minimal grid.'],
        risks: ['Statistical annotations and sample sizes still need explicit user-provided semantics.']
      },
      cautions: ['Does not infer significance testing or sample-size labels.']
    }
  ]
}

function profileStyleSpec(input: {
  id: string
  width: number
  height: number
  background: string
  colors: string[]
  ink: string
  colorMode: FigureStyleSpec['palette']['colorMode']
  axisSize: number
  labelSize: number
  titleSize: number
  panelLabels: FigureStyleSpec['layout']['panelLabels']
  margin: FigureStyleSpec['layout']['margin']
  grid: boolean
  gridTone: FigureStyleSpec['axes']['gridTone']
  gridColor: string
  lineWidth: number
  markerSize: number
  density: FigureStyleSpec['marks']['density']
  confidence: FigureStyleSpec['confidence']
}): FigureStyleSpec {
  return {
    version: 1,
    source: {
      path: `builtin:${input.id}`,
      type: 'image',
      figureId: input.id,
      notes: `SciForge built-in style profile registry v${STYLE_PROFILE_REGISTRY_VERSION}`
    },
    canvas: {
      width: input.width,
      height: input.height,
      aspectRatio: Number((input.width / input.height).toFixed(3)),
      background: input.background
    },
    palette: {
      colors: input.colors,
      background: input.background,
      ink: input.ink,
      accent: input.colors.filter((color) => color.toLowerCase() !== input.background.toLowerCase()).slice(0, 6),
      colorMode: input.colorMode
    },
    typography: {
      fontFamily: 'Arial',
      axisSize: input.axisSize,
      labelSize: input.labelSize,
      titleSize: input.titleSize,
      weight: 'regular'
    },
    layout: {
      panelGrid: '1x1',
      panelLabels: input.panelLabels,
      margin: input.margin,
      gutter: 'balanced'
    },
    axes: {
      spine: input.grid ? 'left-bottom' : 'minimal',
      tickDirection: 'out',
      grid: input.grid,
      gridTone: input.gridTone,
      gridColor: input.gridColor,
      gridAlpha: input.grid ? 0.42 : 0,
      gridLineWidth: input.grid ? 0.35 : 0
    },
    marks: {
      lineWidth: input.lineWidth,
      markerSize: input.markerSize,
      errorBarStyle: 'unknown',
      density: input.density
    },
    annotations: {
      significance: 'unknown',
      legend: 'frameless'
    },
    export: {
      formats: ['png'],
      dpi: 300,
      transparent: false
    },
    confidence: input.confidence
  }
}

function shapeStyleProfileForResult(
  profile: ScientificPlottingStyleProfile,
  includeStyleSpec: boolean
): ScientificPlottingStyleProfileSummary {
  const { styleSpec, ...summary } = profile
  return {
    ...summary,
    ...(includeStyleSpec ? { styleSpec } : {})
  }
}

function shapeStyleProfileMatchForResult(
  match: InternalStyleProfileMatch,
  includeStyleSpec: boolean
): ScientificPlottingStyleProfileMatch {
  return {
    profileId: match.profile.id,
    profile: shapeStyleProfileForResult(match.profile, includeStyleSpec),
    score: match.score,
    reasons: match.reasons,
    cautions: match.cautions
  }
}

function rankStyleProfilesForStyleSpec(
  styleSpec: FigureStyleSpec,
  referenceProfile: ScientificPlottingReferenceProfile,
  query?: string
): InternalStyleProfileMatch[] {
  const sourceProfileId = styleSpec.source.path.startsWith('builtin:')
    ? styleSpec.source.path.slice('builtin:'.length)
    : undefined
  return builtInStyleProfiles()
    .map((profile) => scoreStyleProfileAgainstReference(profile, styleSpec, referenceProfile, sourceProfileId, query))
    .filter((match) => !query || scoreStyleProfileMatch(match.profile, query) > 0 || match.score >= 0.46)
    .sort((left, right) => right.score - left.score)
}

function scoreStyleProfileAgainstReference(
  profile: ScientificPlottingStyleProfile,
  styleSpec: FigureStyleSpec,
  referenceProfile: ScientificPlottingReferenceProfile,
  sourceProfileId?: string,
  query?: string
): InternalStyleProfileMatch {
  let score = 0.12
  const reasons: string[] = []
  const cautions = [...profile.cautions]
  const profileTraits = profile.referenceProfile.detectedTraits
  const referenceTraits = referenceProfile.detectedTraits
  const add = (amount: number, reason: string): void => {
    score += amount
    reasons.push(reason)
  }

  if (sourceProfileId === profile.id) {
    add(0.45, 'Reference StyleSpec was generated from this built-in profile.')
  }
  if (profile.referenceProfile.recommendedTemplate === referenceProfile.recommendedTemplate) {
    add(0.16, `Both reference and profile suggest ${referenceProfile.recommendedTemplate}.`)
  } else if (profile.recommendedTemplates.includes(referenceProfile.recommendedTemplate)) {
    add(0.12, `Profile supports the reference-recommended ${referenceProfile.recommendedTemplate} template.`)
  }
  if (profile.referenceProfile.kind === referenceProfile.kind && referenceProfile.kind !== 'unknown') {
    add(0.1, `Both are ${referenceProfile.kind} style references.`)
  }
  if (profileTraits && referenceTraits) {
    if (profileTraits.background === referenceTraits.background) add(0.09, `Background tone matches: ${referenceTraits.background}.`)
    if (profileTraits.grid === referenceTraits.grid) add(0.08, `Grid tone matches: ${referenceTraits.grid}.`)
    if (profileTraits.axes === referenceTraits.axes) add(0.08, `Axis treatment matches: ${referenceTraits.axes}.`)
    if (profileTraits.aspect === referenceTraits.aspect) add(0.06, `Aspect category matches: ${referenceTraits.aspect}.`)
    if (profileTraits.colorMode === referenceTraits.colorMode) add(0.05, `Color mode matches: ${referenceTraits.colorMode}.`)
    if (profileTraits.panelGrid === referenceTraits.panelGrid) add(0.04, `Panel grid matches: ${referenceTraits.panelGrid}.`)
    if (profileTraits.markDensity === referenceTraits.markDensity) add(0.04, `Mark density matches: ${referenceTraits.markDensity}.`)
  }

  const backgroundSimilarity = hexSimilarity(styleSpec.canvas.background, profile.styleSpec.canvas.background, 140)
  score += backgroundSimilarity * 0.1
  if (backgroundSimilarity >= 0.88) reasons.push('Canvas/background color is close.')

  const paletteScore = paletteHexSimilarity(
    styleSpec.palette.accent.length > 0 ? styleSpec.palette.accent : styleSpec.palette.colors,
    profile.styleSpec.palette.accent.length > 0 ? profile.styleSpec.palette.accent : profile.styleSpec.palette.colors
  )
  score += paletteScore * 0.12
  if (paletteScore >= 0.62) reasons.push('Accent palette is reasonably close.')

  const layoutDelta = Math.abs(styleSpec.canvas.aspectRatio - profile.styleSpec.canvas.aspectRatio)
  const layoutScore = clampNumber(1 - layoutDelta / 1.4, 0, 1)
  score += layoutScore * 0.06

  if (query) {
    const queryScore = scoreStyleProfileMatch(profile, query)
    if (queryScore > 0) add(Math.min(0.08, queryScore * 0.02), 'Query text matches profile metadata.')
  }

  if (referenceProfile.risks.length > 0) cautions.push(...referenceProfile.risks)
  if (reasons.length === 0) reasons.push('No strong profile match was detected; this profile is a fallback candidate.')
  return {
    profile,
    score: Number(clampNumber(score, 0, 0.98).toFixed(3)),
    reasons: uniqueReviewStrings(reasons).slice(0, 6),
    cautions: uniqueReviewStrings(cautions).slice(0, 6)
  }
}

function paletteHexSimilarity(referenceColors: string[], profileColors: string[]): number {
  const reference = uniqueHexStrings(referenceColors).slice(0, 5)
  const profile = uniqueHexStrings(profileColors).slice(0, 5)
  if (reference.length === 0 || profile.length === 0) return 0
  const scores = reference.map((color) =>
    Math.max(...profile.map((candidate) => hexSimilarity(color, candidate, 185)))
  )
  return scores.reduce((sum, value) => sum + value, 0) / scores.length
}

function hexSimilarity(left: string, right: string, tolerance: number): number {
  return Number(clampNumber(1 - hexDistance(left, right) / tolerance, 0, 1).toFixed(3))
}

function findStyleProfile(profileId: string): ScientificPlottingStyleProfile | undefined {
  return builtInStyleProfiles().find((profile) => profile.id === profileId.trim())
}

function scoreStyleProfileMatch(profile: ScientificPlottingStyleProfile, query: string): number {
  const haystack = [
    profile.id,
    profile.name,
    profile.venue,
    profile.sourceLabel,
    profile.description,
    ...profile.recommendedTemplates,
    ...profile.tags
  ].join(' ').toLowerCase()
  const terms = query.split(/\s+/).filter(Boolean)
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function styleProfileForPlanning(profileId: string | undefined, warnings: string[]): ScientificPlottingStyleProfile | undefined {
  const id = profileId?.trim()
  if (!id) return undefined
  const profile = findStyleProfile(id)
  if (!profile) warnings.push(`Unknown styleProfileId: ${id}.`)
  return profile
}

function styleProfileForRender(request: ScientificPlottingRenderRequest): ScientificPlottingStyleProfile | undefined {
  if (request.styleSpec) return undefined
  const id = request.styleProfileId?.trim()
  if (!id) return undefined
  const profile = findStyleProfile(id)
  if (!profile) {
    throw new Error(`Unknown styleProfileId: ${id}.`)
  }
  return profile
}

function defaultFigureStyleSpec(request: ScientificPlottingRenderRequest): FigureStyleSpec {
  return {
    version: 1,
    source: {
      path: 'sciforge-default',
      type: 'image',
      ...(request.figureId ? { figureId: request.figureId } : {})
    },
    canvas: {
      width: 900,
      height: 620,
      aspectRatio: 1.452,
      background: '#ffffff'
    },
    palette: {
      colors: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#000000'],
      background: '#ffffff',
      ink: '#222222',
      accent: ['#0072b2', '#d55e00', '#009e73', '#cc79a7'],
      colorMode: 'limited'
    },
    typography: {
      fontFamily: 'Arial',
      axisSize: 7,
      labelSize: 8,
      titleSize: 10,
      weight: 'regular'
    },
    layout: {
      panelGrid: '1x1',
      panelLabels: 'none',
      margin: { left: 0.13, right: 0.05, top: 0.08, bottom: 0.14 },
      gutter: 'balanced'
    },
    axes: {
      spine: 'left-bottom',
      tickDirection: 'out',
      grid: false,
      gridTone: 'none',
      gridColor: '#e5e5e5',
      gridAlpha: 0,
      gridLineWidth: 0
    },
    marks: {
      lineWidth: 1,
      markerSize: 3,
      errorBarStyle: 'none',
      density: 'balanced'
    },
    annotations: {
      significance: 'none',
      legend: 'frameless'
    },
    export: {
      formats: ['png'],
      dpi: 300,
      transparent: false
    },
    confidence: {
      overall: 0.6,
      palette: 0.6,
      layout: 0.6,
      axes: 0.6,
      typography: 0.6
    }
  }
}

function isFigureStyleSpec(value: unknown): value is FigureStyleSpec {
  return isRecord(value) && value.version === 1 && isRecord(value.canvas) && isRecord(value.palette)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScientificPlotMatplotlibParametersV1(
  value: unknown
): value is ScientificPlotMatplotlibParametersV1 {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.rcParams)) return false
  if (!Object.entries(value.rcParams).every(([key, item]) =>
    key.trim().length > 0
    && (typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
  )) return false
  if (!isStringArray(value.palette, 1, 256)) return false
  if (value.heatmapCmap === undefined) return true
  if (!isRecord(value.heatmapCmap)) return false
  if (value.heatmapCmap.kind === 'named') {
    return typeof value.heatmapCmap.name === 'string' && value.heatmapCmap.name.trim().length > 0
  }
  return value.heatmapCmap.kind === 'linear-segmented'
    && (value.heatmapCmap.name === 'sciforge_style_heatmap' || value.heatmapCmap.name === 'sciforge_attention_map')
    && isStringArray(value.heatmapCmap.colors, 2, 256)
}

function isFiniteNumberArray(value: unknown, minLength: number, maxLength: number): value is number[] {
  return Array.isArray(value) &&
    value.length >= minLength &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function isStringArray(value: unknown, minLength: number, maxLength: number): value is string[] {
  return Array.isArray(value) &&
    value.length >= minLength &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
}

function isAxisArray(value: unknown, expectedLength: number): value is Array<number | string> {
  return Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((item) =>
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && item.length <= 200)
    )
}

function validateReproducibleStatisticalClaims(request: ScientificPlottingRenderRequest): void {
  if ((request.reproducibilityMode ?? 'standard') !== 'reproducible') return
  if (!request.dataSources?.length) {
    throw new Error('reproducible mode requires at least one content-bound dataSources entry.')
  }
  const statisticsRequired = request.template === 'box-violin'
    || request.template === 'histogram-density'
    || request.template === 'errorbar-bar'
    || dataContainsErrorBars(request.data)
    || collectRenderedComparisons(request.data).length > 0
  if (statisticsRequired && !request.statistics) {
    throw new Error(`reproducible ${request.template} rendering requires statistics.`)
  }
  if (dataContainsErrorBars(request.data) && !request.statistics?.uncertainty) {
    throw new Error('reproducible error bars require statistics.uncertainty.kind=sd|sem|ci.')
  }
  if (request.statistics?.uncertainty?.kind === 'ci') {
    const level = request.statistics.uncertainty.confidenceLevel
    if (level === undefined || !Number.isFinite(level) || level <= 0 || level >= 1) {
      throw new Error('CI uncertainty requires a confidenceLevel between 0 and 1.')
    }
  }
  const renderedComparisons = collectRenderedComparisons(request.data)
  for (const comparison of renderedComparisons) {
    if (!isSignificanceLabel(comparison.label)) continue
    const definition = request.statistics?.comparisons?.find((candidate) => {
      const expected = new Set(candidate.groups.map(normalizeComparisonGroup))
      return expected.has(normalizeComparisonGroup(comparison.from))
        && expected.has(normalizeComparisonGroup(comparison.to))
    })
    if (!definition?.resultRef) {
      throw new Error(`Significance label ${comparison.label} for ${comparison.from}/${comparison.to} requires a statistics.comparisons resultRef.`)
    }
    const resultSource = request.dataSources.find((source) => source.sourceId === definition.resultRef.sourceId)
    if (!resultSource) {
      throw new Error(`Statistical result source ${definition.resultRef.sourceId} is not declared in dataSources.`)
    }
    if (resultSource.sha256 !== definition.resultRef.sha256) {
      throw new Error(`Statistical result ${definition.resultRef.sourceId} digest does not match its declared data source.`)
    }
    if (resultSource.locator !== definition.resultRef.locator) {
      throw new Error(`Statistical result ${definition.resultRef.sourceId} locator does not match its declared data source.`)
    }
  }
}

function dataContainsErrorBars(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (Array.isArray(data.series) && data.series.some((series) => (
    isRecord(series) && (Array.isArray(series.error) || Array.isArray(series.xerr) || Array.isArray(series.yerr))
  ))) return true
  if (Array.isArray(data.panels)) {
    return data.panels.some((panel) => isRecord(panel) && dataContainsErrorBars(panel.data))
  }
  return false
}

function collectRenderedComparisons(data: unknown): Array<{ from: string; to: string; label: string }> {
  if (!isRecord(data)) return []
  const comparisons = Array.isArray(data.comparisons)
    ? data.comparisons.flatMap((value) => {
        if (!isRecord(value)) return []
        const from = comparisonGroupValue(value.from ?? value.a ?? value.left ?? value.groupA)
        const to = comparisonGroupValue(value.to ?? value.b ?? value.right ?? value.groupB)
        const label = typeof (value.label ?? value.text ?? value.p) === 'string'
          ? String(value.label ?? value.text ?? value.p).trim()
          : ''
        return from && to ? [{ from, to, label }] : []
      })
    : []
  if (!Array.isArray(data.panels)) return comparisons
  return [
    ...comparisons,
    ...data.panels.flatMap((panel) => isRecord(panel) ? collectRenderedComparisons(panel.data) : [])
  ]
}

function comparisonGroupValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function normalizeComparisonGroup(value: string): string {
  return value.trim().toLowerCase()
}

function isSignificanceLabel(value: string): boolean {
  return /\*|\bp\s*(?:[<=>]|≤|≥)|significant/i.test(value)
}

async function resolveAndVerifyDataSourceRefs(request: ScientificPlottingRenderRequest, _workspaceRoot: string): Promise<DataSourceRef[]> {
  const sources = request.dataSources?.length ? structuredClone(request.dataSources) : [inlineDataSourceRef(hashStableJson(request.data), 'inputs.json')]
  const seen = new Set<string>()
  for (const source of sources) {
    if (seen.has(source.sourceId)) throw new Error('Duplicate data source id.')
    seen.add(source.sourceId)
    if (source.kind !== 'inline' || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Renderer sources must be inline snapshots with SHA-256 digests.')
    const transformations = request.transformations ?? []
    const actualHash = hashStableJson(request.data)
    const direct = source.sha256 === actualHash
    const mapped = transformations.length > 0 && transformations[0]!.inputHash === source.sha256 && transformations.at(-1)!.outputHash === actualHash && transformations.every((step, index) => index === 0 || transformations[index - 1]!.outputHash === step.inputHash)
    if (!direct && !mapped) throw new Error('Inline source digest does not match the actual rendering data or declared transformation chain.')
  }
  validateProvenanceChain(request, sources)
  return sources
}

function validateProvenanceChain(request: ScientificPlottingRenderRequest, sources: DataSourceRef[]): void {
  const sourceIds = new Set(sources.map((source) => source.sourceId))
  const receiptIds = new Set<string>()
  for (const receipt of request.derivedTableReceipts ?? []) {
    if (receiptIds.has(receipt.receiptId)) throw new Error(`Duplicate derived table receipt id: ${receipt.receiptId}`)
    receiptIds.add(receipt.receiptId)
    for (const sourceId of receipt.inputSourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Derived table receipt references undeclared source ${sourceId}.`)
    }
  }
  const transformationsById = new Map<string, ScientificPlotTransformationV1>()
  for (const transformation of request.transformations ?? []) {
    if (transformationsById.has(transformation.transformationId)) {
      throw new Error(`Duplicate transformation id: ${transformation.transformationId}`)
    }
    if (!/^[a-f0-9]{64}$/.test(transformation.inputHash) || !/^[a-f0-9]{64}$/.test(transformation.outputHash)) {
      throw new Error(`Transformation ${transformation.transformationId} requires lowercase SHA-256 input/output hashes.`)
    }
    transformationsById.set(transformation.transformationId, transformation)
  }
  for (const receipt of request.derivedTableReceipts ?? []) {
    if (receipt.transformationIds.length === 0) {
      throw new Error(`Derived table receipt ${receipt.receiptId} requires at least one transformation.`)
    }
    const receiptTransformations: ScientificPlotTransformationV1[] = []
    for (const transformationId of receipt.transformationIds) {
      const transformation = transformationsById.get(transformationId)
      if (!transformation) {
        throw new Error(`Derived table receipt references unknown transformation ${transformationId}.`)
      }
      receiptTransformations.push(transformation)
    }
    for (let index = 1; index < receiptTransformations.length; index += 1) {
      if (receiptTransformations[index - 1]!.outputHash !== receiptTransformations[index]!.inputHash) {
        throw new Error(`Derived table receipt ${receipt.receiptId} contains a disconnected transformation chain.`)
      }
    }
    if (receiptTransformations[0]!.inputHash !== receipt.inputHash) {
      throw new Error(`Derived table receipt ${receipt.receiptId} input hash does not match its first transformation.`)
    }
    if (receiptTransformations.at(-1)!.outputHash !== receipt.outputHash) {
      throw new Error(`Derived table receipt ${receipt.receiptId} output hash does not match its final transformation.`)
    }
  }
  if ((request.reproducibilityMode ?? 'standard') !== 'reproducible') return
  const dataHash = hashStableJson(request.data)
  const terminalOutputs = new Set([
    ...(request.transformations ?? []).map((item) => item.outputHash),
    ...(request.derivedTableReceipts ?? []).map((item) => item.outputHash),
    ...sources.map((source) => source.sha256)
  ])
  if (!terminalOutputs.has(dataHash)) {
    throw new Error('Reproducible data does not match any declared source or transformation output hash.')
  }
}

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalClone<T>(value: T): unknown {
  return JSON.parse(canonicalJson(value)) as unknown
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Scientific plotting provenance only accepts finite JSON numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  throw new Error(`Scientific plotting provenance cannot serialize ${typeof value}.`)
}

function enforceReadableTextColors(
  rcParams: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const background = typeof rcParams['axes.facecolor'] === 'string'
    ? rcParams['axes.facecolor']
    : typeof rcParams['figure.facecolor'] === 'string'
      ? rcParams['figure.facecolor']
      : '#ffffff'
  const text = typeof rcParams['text.color'] === 'string' ? rcParams['text.color'] : '#222222'
  const backgroundLum = hexLuminance(background)
  const textLum = hexLuminance(text)
  if (backgroundLum < 60 && textLum < 120) {
    return {
      ...rcParams,
      'text.color': '#f5f5f5',
      'axes.labelcolor': '#f5f5f5',
      'xtick.color': '#f5f5f5',
      'ytick.color': '#f5f5f5',
      'legend.edgecolor': '#f5f5f5'
    }
  }
  if (backgroundLum > 220 && textLum > 205) {
    return {
      ...rcParams,
      'text.color': '#222222',
      'axes.labelcolor': '#222222',
      'xtick.color': '#222222',
      'ytick.color': '#222222',
      'legend.edgecolor': '#222222'
    }
  }
  return rcParams
}

function enforcePublicationTypography(
  rcParams: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  const next = {
    'font.size': clampRcNumber(rcParams['font.size'], 6.8, 6.2, 7.2),
    'axes.labelsize': clampRcNumber(rcParams['axes.labelsize'], 7, 6.5, 7.2),
    'axes.titlesize': clampRcNumber(rcParams['axes.titlesize'], 7.6, 6.8, 8.2),
    'xtick.labelsize': clampRcNumber(rcParams['xtick.labelsize'], 6, 5.6, 6.2),
    'ytick.labelsize': clampRcNumber(rcParams['ytick.labelsize'], 6, 5.6, 6.2),
    'legend.fontsize': clampRcNumber(rcParams['legend.fontsize'], 6, 5.6, 6.2)
  }
  const clampApplied = Object.entries(next).some(([key, value]) =>
    Math.abs(clampRcNumber(rcParams[key], value, -1000, 1000) - value) > 0.05
  )
  return {
    ...rcParams,
    ...next,
    '__sciforge.typographyClampApplied': clampApplied
  }
}

function clampRcNumber(value: string | number | boolean | undefined, fallback: number, low: number, high: number): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  return Number(clampNumber(Number.isFinite(numeric) ? numeric : fallback, low, high).toFixed(2))
}

function hexLuminance(hex: string): number {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return 255
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hexDistance(left: string, right: string): number {
  const leftRgb = hexToRgb(left)
  const rightRgb = hexToRgb(right)
  if (!leftRgb || !rightRgb) return 0
  return Math.sqrt(
    (leftRgb.red - rightRgb.red) ** 2 +
    (leftRgb.green - rightRgb.green) ** 2 +
    (leftRgb.blue - rightRgb.blue) ** 2
  )
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } | null {
  const normalized = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16)
  }
}

function uniqueHexStrings(colors: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const color of colors) {
    const normalized = color.trim().toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function tail(value: string, max = 4000): string {
  return value.length <= max ? value : value.slice(value.length - max)
}

const PYTHON_RENDERER_SOURCE = String.raw`
import atexit, os, tempfile, io, base64, platform
_scientific_figures_tmp = tempfile.TemporaryDirectory(prefix="scientific-figures-")
atexit.register(_scientific_figures_tmp.cleanup)
os.environ["MPLCONFIGDIR"] = _scientific_figures_tmp.name
os.environ["XDG_CACHE_HOME"] = _scientific_figures_tmp.name

import json
import math
import os
import sys
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.colors import LinearSegmentedColormap, to_rgb
from matplotlib.patches import Rectangle, FancyArrowPatch, Ellipse, Polygon

payload = json.load(sys.stdin)

def as_float(value, fallback):
    try:
        number = float(value)
        if math.isfinite(number):
            return number
    except Exception:
        pass
    return fallback

def clamp(value, low, high):
    return max(low, min(high, value))

def rc_value(value):
    return value

style = payload.get("styleSpec") or {}
layout_style = style.get("layout") or {}
plan_rc = {}
palette = []
try:
    # The TypeScript side applies the VisualStyleProfile plotting adapter; this Python side
    # receives only concrete values and never evaluates user code.
    canvas = style.get("canvas") or {}
    palette_spec = style.get("palette") or {}
    typo = style.get("typography") or {}
    axes = style.get("axes") or {}
    marks = style.get("marks") or {}
    annotations = style.get("annotations") or {}
    export = style.get("export") or {}
    background = canvas.get("background") or palette_spec.get("background") or "#ffffff"
    ink = palette_spec.get("ink") or "#222222"
    plan_rc = {
        "figure.facecolor": background,
        "axes.facecolor": background,
        "axes.edgecolor": ink,
        "axes.linewidth": max(0.6, as_float(marks.get("lineWidth"), 1.0) * 0.9),
        "axes.axisbelow": True,
        "axes.grid": bool(axes.get("grid")),
        "grid.color": axes.get("gridColor") or "#e5e5e5",
        "grid.alpha": as_float(axes.get("gridAlpha"), 0.0),
        "grid.linewidth": as_float(axes.get("gridLineWidth"), 0.4),
        "grid.linestyle": "-",
        "axes.spines.left": axes.get("spine") != "none",
        "axes.spines.bottom": axes.get("spine") != "none",
        "axes.spines.top": axes.get("spine") == "box",
        "axes.spines.right": axes.get("spine") == "box",
        "font.family": typo.get("fontFamily") or "Arial",
        "font.size": as_float(typo.get("labelSize"), 8),
        "text.color": ink,
        "axes.labelcolor": ink,
        "axes.labelsize": as_float(typo.get("labelSize"), 8),
        "axes.titlesize": as_float(typo.get("titleSize"), 10),
        "xtick.color": ink,
        "ytick.color": ink,
        "xtick.labelsize": as_float(typo.get("axisSize"), 7),
        "ytick.labelsize": as_float(typo.get("axisSize"), 7),
        "xtick.direction": "out",
        "ytick.direction": "out",
        "xtick.major.width": clamp(as_float(marks.get("lineWidth"), 1.0) * 0.65, 0.45, 0.9),
        "ytick.major.width": clamp(as_float(marks.get("lineWidth"), 1.0) * 0.65, 0.45, 0.9),
        "xtick.major.size": 2.5,
        "ytick.major.size": 2.5,
        "lines.linewidth": as_float(marks.get("lineWidth"), 1.0),
        "lines.markersize": as_float(marks.get("markerSize"), 3.0),
        "legend.frameon": annotations.get("legend") == "boxed",
        "legend.fontsize": as_float(typo.get("axisSize"), 7),
        "legend.facecolor": background,
        "legend.edgecolor": ink,
        "savefig.dpi": int(as_float(export.get("dpi"), 300)),
        "savefig.facecolor": background,
        "savefig.transparent": bool(export.get("transparent", False)),
    }
    palette = palette_spec.get("accent") or palette_spec.get("colors") or []
except Exception:
    plan_rc = {}
    palette = []

if isinstance(payload.get("rcParams"), dict):
    plan_rc = payload.get("rcParams") or {}
if isinstance(payload.get("palette"), list) and payload.get("palette"):
    palette = payload.get("palette")
rc_patch = payload.get("rcParamsPatch") or {}
plan_rc.update(rc_patch)
for key, value in plan_rc.items():
    try:
        mpl.rcParams[key] = rc_value(value)
    except Exception:
        pass

palette_override = payload.get("paletteOverride")
if isinstance(palette_override, list) and palette_override:
    palette = palette_override
if not palette:
    palette = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#000000"]
def payload_contains_cjk(value):
    try:
        text = json.dumps(value, ensure_ascii=False)
    except Exception:
        text = str(value)
    for char in text:
        code = ord(char)
        if (0x3400 <= code <= 0x4DBF) or (0x4E00 <= code <= 0x9FFF) or (0xF900 <= code <= 0xFAFF) or (0x3040 <= code <= 0x30FF) or (0xAC00 <= code <= 0xD7AF):
            return True
    return False

def configure_cjk_font_if_needed():
    mpl.rcParams["axes.unicode_minus"] = False
    if not payload_contains_cjk(payload):
        return None
    candidates = [
        "PingFang SC",
        "Hiragino Sans GB",
        "Heiti SC",
        "STHeiti",
        "Songti SC",
        "Noto Sans CJK SC",
        "Source Han Sans SC",
        "Microsoft YaHei",
        "SimHei",
        "Arial Unicode MS",
        "WenQuanYi Zen Hei",
    ]
    available = {font.name for font in font_manager.fontManager.ttflist}
    selected = next((name for name in candidates if name in available), None)
    if selected is None:
        return None
    existing = mpl.rcParams.get("font.sans-serif", [])
    if isinstance(existing, str):
        existing = [existing]
    requested = mpl.rcParams.get("font.family", [])
    if isinstance(requested, str):
        requested = [requested]
    mpl.rcParams["font.family"] = "sans-serif"
    mpl.rcParams["font.sans-serif"] = [selected] + [name for name in requested + list(existing) if name and name != selected]
    return selected

selected_cjk_font = configure_cjk_font_if_needed()

try:
    from cycler import cycler
    mpl.rcParams["axes.prop_cycle"] = cycler(color=palette)
except Exception:
    pass

template = payload["template"]
data = payload["data"]
labels = payload.get("labels") or {}
output_path = payload["outputPath"]

canvas = style.get("canvas") or {}
aspect = clamp(as_float(canvas.get("aspectRatio"), 1.45), 0.55, 2.4)
if aspect >= 1:
    fig_w = clamp(4.2, 2.6, 7.2)
    fig_h = clamp(fig_w / aspect, 2.2, 5.5)
else:
    fig_h = clamp(3.4, 2.2, 5.5)
    fig_w = clamp(fig_h * aspect, 2.6, 7.2)
fig, ax = plt.subplots(figsize=(fig_w, fig_h), constrained_layout=True)
raw_title = str(labels.get("title") or "")
requested_title_size = as_float(mpl.rcParams.get("axes.titlesize", 7.6), 7.6)
requested_label_size = as_float(mpl.rcParams.get("axes.labelsize", 7.0), 7.0)
requested_tick_size = as_float(mpl.rcParams.get("xtick.labelsize", 6.0), 6.0)
requested_legend_size = as_float(mpl.rcParams.get("legend.fontsize", 6.0), 6.0)
title_size = clamp(requested_title_size, 6.8, 8.2)
if len(raw_title) > 30:
    title_size = min(title_size, 6.9)
elif len(raw_title) > 22:
    title_size = min(title_size, 7.3)
label_size = clamp(requested_label_size, 6.5, 7.2)
tick_size = clamp(requested_tick_size, 5.6, 6.2)
legend_size = clamp(requested_legend_size, 5.6, 6.2)
panel_size = clamp(title_size + 0.4, 7.8, 8.4)
publication_clamp_applied = any([
    abs(title_size - requested_title_size) > 0.05,
    abs(label_size - requested_label_size) > 0.05,
    abs(tick_size - requested_tick_size) > 0.05,
    abs(legend_size - requested_legend_size) > 0.05,
]) or bool(plan_rc.get("__sciforge.typographyClampApplied", False))
renderer_diagnostics = {
    "layoutNotes": [],
    "fontFallback": {
        "cjk": selected_cjk_font,
    },
    "typography": {
        "titleSize": round(title_size, 2),
        "labelSize": round(label_size, 2),
        "tickSize": round(tick_size, 2),
        "legendSize": round(legend_size, 2),
        "panelSize": round(panel_size, 2),
        "publicationClampApplied": bool(publication_clamp_applied),
    },
    "layoutQuality": {
        "legendItemCount": 0,
        "legendColumnCount": 0,
        "legendOutsidePlot": False,
        "legendOverlapRisk": "none",
        "textOverflowRisk": "none",
        "panelLabelAdjusted": False,
        "warnings": [],
    }
}
savefig_pad_inches = 0.035
legend_artists = []
panel_label_artist = None

def add_layout_note(note):
    if note not in renderer_diagnostics["layoutNotes"]:
        renderer_diagnostics["layoutNotes"].append(note)

def add_layout_warning(message):
    warnings = renderer_diagnostics["layoutQuality"]["warnings"]
    if message not in warnings:
        warnings.append(message)

def risk_max(left, right):
    order = {"none": 0, "low": 1, "medium": 2, "high": 3}
    return left if order.get(left, 0) >= order.get(right, 0) else right

if publication_clamp_applied:
    add_layout_note("Clamped typography to conservative publication-size ranges.")

def set_common_labels(axis):
    if labels.get("title"):
        axis.set_title(labels.get("title"), pad=3, fontsize=title_size)
    if labels.get("x"):
        axis.set_xlabel(labels.get("x"), fontsize=label_size)
    if labels.get("y"):
        axis.set_ylabel(labels.get("y"), fontsize=label_size)

def maybe_legend(axis):
    if labels.get("legend", True):
        handles, legend_labels = axis.get_legend_handles_labels()
        if handles:
            legend_font = legend_size
            visible_labels = [str(label) for label in legend_labels if label and not str(label).startswith("_")]
            longest_label = max([len(label) for label in visible_labels] or [0])
            force_outside = bool(plan_rc.get("__sciforge.forceOutsideLegend", False))
            should_place_outside = (
                force_outside or
                template in ("bar", "errorbar-bar", "histogram-density") or
                len(handles) >= 3 or
                longest_label > 14
            )
            if should_place_outside:
                columns = 1 if len(handles) <= 3 or longest_label > 14 else 2
                legend = axis.legend(
                    loc="upper left",
                    bbox_to_anchor=(1.01, 1.0),
                    borderaxespad=0.0,
                    frameon=False,
                    fontsize=legend_font,
                    ncol=columns,
                    handlelength=1.1,
                    handletextpad=0.35,
                    columnspacing=0.75,
                    labelspacing=0.32,
                )
                legend.set_in_layout(True)
                legend_artists.append(legend)
                renderer_diagnostics["legendPlacement"] = "outside-right"
                renderer_diagnostics["layoutQuality"]["legendItemCount"] = len(handles)
                renderer_diagnostics["layoutQuality"]["legendColumnCount"] = columns
                renderer_diagnostics["layoutQuality"]["legendOutsidePlot"] = True
                if template == "histogram-density":
                    add_layout_note("Placed distribution legend outside the right edge to avoid covering density marks.")
                elif template in ("bar", "errorbar-bar"):
                    add_layout_note("Placed grouped bar legend outside the right edge to avoid covering data.")
                else:
                    add_layout_note("Moved long or dense legend outside the plot area to avoid covering data.")
            else:
                legend = axis.legend(loc="best", fontsize=legend_font, frameon=bool(mpl.rcParams.get("legend.frameon", False)))
                legend_artists.append(legend)
                renderer_diagnostics["legendPlacement"] = "inside"
                renderer_diagnostics["layoutQuality"]["legendItemCount"] = len(handles)
                renderer_diagnostics["layoutQuality"]["legendColumnCount"] = 1
                if len(handles) >= 3 or longest_label > 12:
                    renderer_diagnostics["layoutQuality"]["legendOverlapRisk"] = "medium"
                    add_layout_warning("Legend may overlap plotted data; consider outside-right placement.")
    else:
        renderer_diagnostics["legendPlacement"] = "none"

def x_values(series):
    y = series.get("y") or []
    return series.get("x") or list(range(1, len(y) + 1))

def optional_error_values(series, key):
    values = series.get(key)
    if isinstance(values, list):
        return [abs(as_float(value, 0)) for value in values]
    value = as_float(values, None)
    return value if value is not None else None

def apply_axis_limits(axis, data_source):
    data_source = data_source or {}
    xlim = data_source.get("xlim") or data_source.get("xLim") or data_source.get("xRange")
    ylim = data_source.get("ylim") or data_source.get("yLim") or data_source.get("yRange")
    if isinstance(xlim, list) and len(xlim) == 2:
        left = as_float(xlim[0], None)
        right = as_float(xlim[1], None)
        if left is not None and right is not None and left != right:
            axis.set_xlim(left, right)
    if isinstance(ylim, list) and len(ylim) == 2:
        bottom = as_float(ylim[0], None)
        top = as_float(ylim[1], None)
        if bottom is not None and top is not None and bottom != top:
            axis.set_ylim(bottom, top)

def finite_list(values):
    result = []
    for value in values or []:
        number = as_float(value, None)
        if number is not None and math.isfinite(number):
            result.append(number)
    return result

def resolve_group_position(reference, names, positions):
    if reference is None:
        return None
    if isinstance(reference, bool):
        return None
    if isinstance(reference, (int, float)) and math.isfinite(reference):
        number = int(reference)
        if abs(float(reference) - number) > 1e-9:
            return None
        if 0 <= number < len(positions):
            return positions[number]
        if number in positions:
            return number
        return None
    text = str(reference).strip()
    if not text:
        return None
    lowered = text.lower()
    for index, name in enumerate(names):
        if lowered == str(name).strip().lower():
            return positions[index]
    try:
        return resolve_group_position(int(text), names, positions)
    except Exception:
        return None

def draw_group_comparisons(axis, comparisons, names, positions, grouped_values, font_scale=1.0):
    if not isinstance(comparisons, list) or not comparisons:
        return 0
    resolved = []
    for comparison in comparisons[:8]:
        if not isinstance(comparison, dict):
            continue
        start = resolve_group_position(
            comparison.get("from", comparison.get("a", comparison.get("left", comparison.get("groupA")))),
            names,
            positions,
        )
        end = resolve_group_position(
            comparison.get("to", comparison.get("b", comparison.get("right", comparison.get("groupB")))),
            names,
            positions,
        )
        if start is None or end is None or start == end:
            continue
        label = str(comparison.get("label", comparison.get("text", comparison.get("p", "")))).strip()
        resolved.append((min(start, end), max(start, end), label))
    if not resolved:
        return 0
    all_values = [value for values_for_group in grouped_values for value in values_for_group]
    if not all_values:
        return 0
    y_min, y_max = axis.get_ylim()
    data_min = min(all_values)
    data_max = max(all_values)
    y_min = min(y_min, data_min)
    y_max = max(y_max, data_max)
    y_range = y_max - y_min
    if not math.isfinite(y_range) or y_range <= 0:
        y_range = 1.0
    base = y_max + y_range * 0.06
    step = y_range * 0.085
    height = y_range * 0.025
    top = base + step * max(0, len(resolved) - 1) + y_range * 0.08
    axis.set_ylim(y_min - y_range * 0.04, top)
    color = mpl.rcParams.get("text.color", "#222222")
    for index, (start, end, label) in enumerate(resolved):
        y = base + index * step
        axis.plot([start, start, end, end], [y, y + height, y + height, y], color=color, linewidth=0.72, clip_on=False)
        if label:
            axis.text((start + end) / 2, y + height + y_range * 0.01, label, ha="center", va="bottom", fontsize=max(5.2, tick_size * font_scale), color=color, clip_on=False)
    add_layout_note("Rendered compact group-comparison brackets for distribution panels.")
    return len(resolved)

def set_labels_from(axis, label_source):
    label_source = label_source or {}
    if label_source.get("title"):
        axis.set_title(label_source.get("title"), pad=3, fontsize=title_size)
    if label_source.get("x"):
        axis.set_xlabel(label_source.get("x"), fontsize=label_size)
    if label_source.get("y"):
        axis.set_ylabel(label_source.get("y"), fontsize=label_size)

def gaussian_density(values, points):
    values = finite_list(values)
    if len(values) < 2 or not points:
        return []
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / max(1, len(values) - 1)
    std = math.sqrt(max(variance, 1e-9))
    bandwidth = max(1.06 * std * (len(values) ** -0.2), 1e-6)
    scale = 1 / (len(values) * bandwidth * math.sqrt(2 * math.pi))
    density = []
    for point in points:
        total = sum(math.exp(-0.5 * ((point - value) / bandwidth) ** 2) for value in values)
        density.append(total * scale)
    return density

if template == "line":
    for index, series in enumerate(data.get("series", [])):
        name = series.get("name") or f"Series {index + 1}"
        y = series.get("y") or []
        x = x_values(series)
        error = series.get("error")
        marker = "o" if len(y) <= 80 else None
        if error:
            ax.errorbar(x, y, yerr=error, marker=marker, label=name, capsize=2)
        else:
            ax.plot(x, y, marker=marker, label=name)
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "scatter":
    for index, series in enumerate(data.get("series", [])):
        name = series.get("name") or f"Series {index + 1}"
        y = series.get("y") or []
        x = x_values(series)
        xerr = optional_error_values(series, "xerr")
        yerr = optional_error_values(series, "yerr")
        if xerr is not None or yerr is not None:
            ax.errorbar(
                x,
                y,
                xerr=xerr,
                yerr=yerr,
                fmt="o",
                label=name,
                markersize=max(2.2, mpl.rcParams.get("lines.markersize", 3)),
                capsize=2,
                elinewidth=max(0.45, mpl.rcParams.get("lines.linewidth", 1) * 0.7),
                capthick=max(0.45, mpl.rcParams.get("lines.linewidth", 1) * 0.7),
                alpha=0.9,
            )
        else:
            ax.scatter(x, y, label=name, s=max(10, mpl.rcParams.get("lines.markersize", 3) ** 2), alpha=0.86, linewidths=0.3)
    apply_axis_limits(ax, data)
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "bar" or template == "errorbar-bar":
    categories = data.get("categories") or []
    series = data.get("series") or []
    orientation = str(data.get("orientation") or payload.get("orientation") or "").strip().lower()
    horizontal = orientation in ("horizontal", "barh", "h")
    show_values = bool(data.get("showValues") or payload.get("showValues"))
    x = list(range(len(categories)))
    group_width = 0.68 if len(categories) >= 4 else 0.72
    width = clamp(group_width / max(1, len(series)), 0.08, 0.34)
    positive_baseline = True
    bar_tops = []
    bar_label_artists = []
    for index, item in enumerate(series):
        offset = (index - (len(series) - 1) / 2) * width
        values = item.get("values") or []
        errors = item.get("error") if template == "errorbar-bar" else None
        name = item.get("name") or f"Series {index + 1}"
        colors = item.get("colors") or item.get("color")
        if isinstance(colors, list):
            renderer_diagnostics["barColorMode"] = "per-bar"
        elif colors:
            renderer_diagnostics["barColorMode"] = "series"
        positive_baseline = positive_baseline and all(as_float(value, 0) >= 0 for value in values)
        if values:
            for value_index, value in enumerate(values):
                error_value = 0
                if isinstance(errors, list) and value_index < len(errors):
                    error_value = abs(as_float(errors[value_index], 0))
                bar_tops.append(as_float(value, 0) + error_value)
        if horizontal:
            bars = ax.barh(
                [v + offset for v in x],
                values,
                xerr=errors,
                height=width,
                label=name,
                color=colors,
                linewidth=0,
                capsize=clamp(1.6 + width * 3.0, 1.7, 2.6) if errors else 0,
                error_kw={
                    "elinewidth": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "capthick": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "ecolor": mpl.rcParams.get("text.color", "#222222"),
                } if errors else None,
            )
            if show_values:
                bar_label_artists.extend([(bar, as_float(value, 0)) for bar, value in zip(bars, values)])
        else:
            bars = ax.bar(
                [v + offset for v in x],
                values,
                yerr=errors,
                width=width,
                label=name,
                color=colors,
                linewidth=0,
                capsize=clamp(1.6 + width * 3.0, 1.7, 2.6) if errors else 0,
                error_kw={
                    "elinewidth": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "capthick": clamp(as_float(mpl.rcParams.get("lines.linewidth", 1), 1) * 0.68, 0.45, 0.8),
                    "ecolor": mpl.rcParams.get("text.color", "#222222"),
                } if errors else None,
            )
            if show_values:
                bar_label_artists.extend([(bar, as_float(value, 0)) for bar, value in zip(bars, values)])
    if horizontal:
        ax.set_yticks(x, categories)
        ax.invert_yaxis()
        ax.tick_params(axis="x", pad=1.5)
        ax.tick_params(axis="y", pad=1.5)
        renderer_diagnostics["barOrientation"] = "horizontal"
        renderer_diagnostics["categoryLabelRotation"] = 0
    else:
        max_category_len = max([len(str(value)) for value in categories] or [0])
        rotation = 28 if max_category_len > 12 else 18 if max_category_len > 8 or len(categories) > 4 else 0
        ax.set_xticks(x, categories, rotation=rotation, ha="right" if rotation else "center")
        ax.tick_params(axis="x", pad=1.5)
        ax.tick_params(axis="y", pad=1.5)
        renderer_diagnostics["barOrientation"] = "vertical"
        renderer_diagnostics["categoryLabelRotation"] = rotation
    if positive_baseline:
        if horizontal:
            ax.set_xlim(left=0)
        else:
            ax.set_ylim(bottom=0)
    if bar_tops:
        top = max(bar_tops)
        if top > 0:
            if horizontal:
                ax.set_xlim(right=top * (1.22 if show_values else 1.16))
            else:
                ax.set_ylim(top=top * (1.22 if show_values else 1.16))
            add_layout_note("Reserved extra y-axis headroom for error bars and panel labels.")
    if show_values and bar_label_artists:
        label_offset = max(bar_tops or [1]) * 0.02
        for bar, value in bar_label_artists:
            if horizontal:
                ax.text(
                    bar.get_width() + label_offset,
                    bar.get_y() + bar.get_height() / 2,
                    f"{value:g}",
                    va="center",
                    ha="left",
                    fontsize=tick_size,
                    color=mpl.rcParams.get("text.color", "#222222"),
                )
            else:
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + label_offset,
                    f"{value:g}",
                    va="bottom",
                    ha="center",
                    fontsize=tick_size,
                    color=mpl.rcParams.get("text.color", "#222222"),
                )
        add_layout_note("Added compact value labels to categorical bars.")
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "heatmap":
    matrix = data.get("matrix") or []
    heatmap_colors = payload.get("heatmapCmapColors")
    if isinstance(heatmap_colors, list) and len(heatmap_colors) >= 2:
        cmap = LinearSegmentedColormap.from_list("sciforge_style_heatmap", heatmap_colors)
    else:
        cmap = payload.get("heatmapCmapName") or data.get("cmap") or "cividis"
    im = ax.imshow(matrix, aspect="auto", cmap=cmap)
    x_labels = data.get("xLabels") or data.get("colLabels") or data.get("columnLabels") or data.get("columns") or data.get("x")
    y_labels = data.get("yLabels") or data.get("rowLabels") or data.get("row_labels") or data.get("targets") or data.get("y")
    if x_labels:
        x_labels = [str(value) for value in x_labels]
        rotation = 36 if max([len(value) for value in x_labels] or [0]) > 6 or len(x_labels) > 4 else 0
        ax.set_xticks(list(range(len(x_labels))), x_labels, rotation=rotation, ha="right" if rotation else "center")
        renderer_diagnostics["categoryLabelRotation"] = rotation
    if y_labels:
        y_labels = [str(value) for value in y_labels]
        ax.set_yticks(list(range(len(y_labels))), y_labels)
    set_common_labels(ax)
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.ax.tick_params(labelsize=mpl.rcParams.get("xtick.labelsize", 7))
elif template == "attention-map":
    matrix = data.get("matrix") or []
    heatmap_colors = payload.get("heatmapCmapColors")
    if isinstance(heatmap_colors, list) and len(heatmap_colors) >= 2:
        cmap = LinearSegmentedColormap.from_list("sciforge_attention_map", heatmap_colors)
    else:
        cmap = payload.get("heatmapCmapName") or data.get("cmap") or "magma"
    im = ax.imshow(matrix, aspect="auto", cmap=cmap, interpolation="nearest")
    x_labels = data.get("xLabels") or data.get("colLabels") or data.get("columnLabels") or data.get("columns") or data.get("x")
    y_labels = data.get("yLabels") or data.get("rowLabels") or data.get("row_labels") or data.get("targets") or data.get("y")
    if x_labels:
        x_labels = [str(value) for value in x_labels]
        rotation = 36 if max([len(value) for value in x_labels] or [0]) > 6 or len(x_labels) > 4 else 0
        ax.set_xticks(list(range(len(x_labels))), x_labels, rotation=rotation, ha="right" if rotation else "center")
        renderer_diagnostics["categoryLabelRotation"] = rotation
    if y_labels:
        y_labels = [str(value) for value in y_labels]
        ax.set_yticks(list(range(len(y_labels))), y_labels)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(length=2.5, width=0.7)
    set_common_labels(ax)
    if data.get("colorbar", False):
        cbar = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.025)
        cbar.outline.set_visible(False)
        cbar.ax.tick_params(labelsize=mpl.rcParams.get("xtick.labelsize", 7))
elif template == "box-violin":
    groups = data.get("groups") or []
    values = [finite_list(group.get("values") or []) for group in groups]
    names = [str(group.get("name") or f"Group {index + 1}") for index, group in enumerate(groups)]
    positions = list(range(1, len(values) + 1))
    mode = str(data.get("mode") or "box+violin").lower()
    if "violin" in mode:
        violins = ax.violinplot(values, positions=positions, widths=0.74, showmeans=False, showmedians=False, showextrema=False)
        for index, body in enumerate(violins.get("bodies", [])):
            body.set_facecolor(palette[index % len(palette)])
            body.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
            body.set_alpha(0.22)
            body.set_linewidth(0.7)
    if "box" in mode:
        box = ax.boxplot(
            values,
            positions=positions,
            widths=0.28,
            patch_artist=True,
            showfliers=False,
            medianprops={"color": mpl.rcParams.get("text.color", "#222222"), "linewidth": 0.95},
            whiskerprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.75},
            capprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.75},
        )
        for index, patch in enumerate(box.get("boxes", [])):
            patch.set_facecolor(palette[index % len(palette)])
            patch.set_alpha(0.34)
            patch.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
            patch.set_linewidth(0.75)
    if data.get("showPoints", True):
        for index, group_values in enumerate(values):
            color = palette[index % len(palette)]
            jittered = [positions[index] + math.sin((point_index + 1) * 12.9898) * 0.055 for point_index in range(len(group_values))]
            ax.scatter(jittered, group_values, s=7, color=color, alpha=0.42, linewidths=0, zorder=3)
        add_layout_note("Overlayed deterministic jitter points for distribution transparency.")
    max_name_len = max([len(name) for name in names] or [0])
    rotation = 28 if max_name_len > 10 or len(names) > 4 else 0
    ax.set_xticks(positions, names, rotation=rotation, ha="right" if rotation else "center")
    renderer_diagnostics["categoryLabelRotation"] = rotation
    ax.margins(x=0.04)
    comparison_count = draw_group_comparisons(ax, data.get("comparisons"), names, positions, values)
    if comparison_count:
        renderer_diagnostics["distributionComparisonCount"] = comparison_count
    set_common_labels(ax)
elif template == "histogram-density":
    series = data.get("series") or []
    bins = int(data.get("bins") or 24)
    density = bool(data.get("density", True))
    all_values = []
    for item in series:
        all_values.extend(finite_list(item.get("values") or []))
    if all_values:
        minimum = min(all_values)
        maximum = max(all_values)
        if minimum == maximum:
            minimum -= 0.5
            maximum += 0.5
        density_points = [minimum + (maximum - minimum) * index / 79 for index in range(80)]
    else:
        density_points = []
    for index, item in enumerate(series):
        values = finite_list(item.get("values") or [])
        name = item.get("name") or f"Series {index + 1}"
        color = palette[index % len(palette)]
        ax.hist(values, bins=bins, density=density, alpha=0.22, color=color, edgecolor=color, linewidth=0.45, label=name)
        if density and data.get("densityLine", True) and density_points:
            smooth = gaussian_density(values, density_points)
            if smooth:
                ax.plot(density_points, smooth, color=color, linewidth=max(0.85, mpl.rcParams.get("lines.linewidth", 1.0)), label="_nolegend_")
    add_layout_note("Rendered histogram with optional first-party Gaussian KDE overlay.")
    set_common_labels(ax)
    maybe_legend(ax)
elif template == "multi-panel":
    panels = data.get("panels") or []
    columns = int(data.get("columns") or min(2, max(1, len(panels))))
    columns = int(clamp(columns, 1, 3))
    rows = int(math.ceil(len(panels) / columns))
    fig.clear()
    fig.set_size_inches(clamp(3.15 * columns, 3.2, 7.2), clamp(2.35 * rows, 2.4, 6.8), forward=True)
    axes_grid = fig.subplots(rows, columns, squeeze=False)
    panel_letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    default_panel_labels = str(layout_style.get("panelLabels") or "unknown")
    def draw_small_panel(axis, panel, panel_index):
        panel_template = panel.get("template")
        panel_data = panel.get("data") or {}
        panel_labels = panel.get("labels") or {}
        if panel_template == "line":
            for series_index, series in enumerate(panel_data.get("series") or []):
                name = series.get("name") or f"Series {series_index + 1}"
                y = series.get("y") or []
                x = series.get("x") or panel_data.get("x") or list(range(1, len(y) + 1))
                axis.plot(x, y, marker="o" if len(y) <= 24 else None, linewidth=mpl.rcParams.get("lines.linewidth", 1.0), markersize=2.4, label=name)
        elif panel_template == "scatter":
            for series_index, series in enumerate(panel_data.get("series") or []):
                name = series.get("name") or f"Series {series_index + 1}"
                y = series.get("y") or []
                x = series.get("x") or list(range(1, len(y) + 1))
                xerr = optional_error_values(series, "xerr")
                yerr = optional_error_values(series, "yerr")
                if xerr is not None or yerr is not None:
                    axis.errorbar(
                        x,
                        y,
                        xerr=xerr,
                        yerr=yerr,
                        fmt="o",
                        label=name,
                        markersize=2.8,
                        capsize=2,
                        elinewidth=0.62,
                        capthick=0.62,
                        alpha=0.9,
                    )
                else:
                    axis.scatter(x, y, s=10, alpha=0.82, linewidths=0.25, label=name)
            apply_axis_limits(axis, panel_data)
        elif panel_template == "bar" or panel_template == "errorbar-bar":
            categories = panel_data.get("categories") or []
            series = panel_data.get("series") or []
            x = list(range(len(categories)))
            width = clamp(0.68 / max(1, len(series)), 0.08, 0.34)
            for series_index, item in enumerate(series):
                offset = (series_index - (len(series) - 1) / 2) * width
                errors = item.get("error") if panel_template == "errorbar-bar" else None
                axis.bar([value + offset for value in x], item.get("values") or [], yerr=errors, width=width, label=item.get("name") or f"Series {series_index + 1}", linewidth=0, capsize=1.8 if errors else 0)
            axis.set_xticks(x, categories, rotation=24 if len(categories) > 3 else 0, ha="right" if len(categories) > 3 else "center")
        elif panel_template == "heatmap" or panel_template == "attention-map":
            cmap = panel_data.get("cmap") or ("magma" if panel_template == "attention-map" else "cividis")
            image = axis.imshow(panel_data.get("matrix") or [], aspect="auto", cmap=cmap, interpolation="nearest")
            if panel_template == "heatmap" and panel_data.get("colorbar", False):
                fig.colorbar(image, ax=axis, fraction=0.046, pad=0.035)
            panel_x_labels = panel_data.get("xLabels") or panel_data.get("colLabels") or panel_data.get("columnLabels") or panel_data.get("columns") or panel_data.get("x")
            panel_y_labels = panel_data.get("yLabels") or panel_data.get("rowLabels") or panel_data.get("row_labels") or panel_data.get("targets") or panel_data.get("y")
            if panel_x_labels:
                panel_x_labels = [str(value) for value in panel_x_labels]
                rotation = 36 if max([len(value) for value in panel_x_labels] or [0]) > 6 or len(panel_x_labels) > 4 else 0
                axis.set_xticks(list(range(len(panel_x_labels))), panel_x_labels, rotation=rotation, ha="right" if rotation else "center")
            else:
                axis.set_xticks([])
            if panel_y_labels:
                panel_y_labels = [str(value) for value in panel_y_labels]
                axis.set_yticks(list(range(len(panel_y_labels))), panel_y_labels)
            else:
                axis.set_yticks([])
            axis.grid(False)
            if panel_template == "attention-map":
                for spine in axis.spines.values():
                    spine.set_visible(False)
        elif panel_template == "box-violin":
            groups = panel_data.get("groups") or []
            group_values = [finite_list(group.get("values") or []) for group in groups]
            names = [str(group.get("name") or f"G{index + 1}") for index, group in enumerate(groups)]
            positions = list(range(1, len(group_values) + 1))
            mode = str(panel_data.get("mode") or "box+violin").lower()
            if "violin" in mode:
                violins = axis.violinplot(group_values, positions=positions, widths=0.65, showmeans=False, showmedians=False, showextrema=False)
                for group_index, body in enumerate(violins.get("bodies", [])):
                    body.set_facecolor(palette[group_index % len(palette)])
                    body.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
                    body.set_alpha(0.18)
                    body.set_linewidth(0.55)
            if "box" in mode:
                box = axis.boxplot(
                    group_values,
                    positions=positions,
                    widths=0.24,
                    patch_artist=True,
                    showfliers=False,
                    medianprops={"color": mpl.rcParams.get("text.color", "#222222"), "linewidth": 0.72},
                    whiskerprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.58},
                    capprops={"color": mpl.rcParams.get("axes.edgecolor", "#222222"), "linewidth": 0.58},
                )
                for group_index, patch in enumerate(box.get("boxes", [])):
                    patch.set_facecolor(palette[group_index % len(palette)])
                    patch.set_alpha(0.3)
                    patch.set_edgecolor(mpl.rcParams.get("axes.edgecolor", "#222222"))
                    patch.set_linewidth(0.58)
            if panel_data.get("showPoints", True):
                for group_index, values_for_group in enumerate(group_values):
                    color = palette[group_index % len(palette)]
                    jittered = [positions[group_index] + math.sin((point_index + 1) * 12.9898) * 0.052 for point_index in range(len(values_for_group))]
                    axis.scatter(jittered, values_for_group, s=5.5, color=color, alpha=0.48, linewidths=0, zorder=3)
            comparison_count = draw_group_comparisons(axis, panel_data.get("comparisons"), names, positions, group_values, font_scale=0.9)
            if comparison_count:
                renderer_diagnostics["distributionComparisonCount"] = renderer_diagnostics.get("distributionComparisonCount", 0) + comparison_count
            axis.set_xticks(positions, names, rotation=24 if len(names) > 3 else 0, ha="right" if len(names) > 3 else "center")
        elif panel_template == "histogram-density":
            for series_index, item in enumerate(panel_data.get("series") or []):
                values = finite_list(item.get("values") or [])
                axis.hist(values, bins=int(panel_data.get("bins") or 18), density=bool(panel_data.get("density", True)), alpha=0.25, label=item.get("name") or f"Series {series_index + 1}")
        elif panel_template == "schematic-grid" or panel_template == "flowchart":
            axis.axis("off")
            nodes = panel_data.get("nodes") or []
            for node_index, node in enumerate(nodes[:4]):
                axis.text(0.5, 0.84 - node_index * 0.22, str(node.get("label") or ""), ha="center", va="center", fontsize=min(label_size, 7.5), bbox={"boxstyle": "round,pad=0.18", "facecolor": palette[node_index % len(palette)], "alpha": 0.12, "edgecolor": mpl.rcParams.get("axes.edgecolor", "#222222")})
                if panel_template == "flowchart" and node_index < min(len(nodes), 4) - 1:
                    axis.annotate("", xy=(0.5, 0.76 - node_index * 0.22), xytext=(0.5, 0.70 - node_index * 0.22), arrowprops={"arrowstyle": "-|>", "lw": 0.55, "color": mpl.rcParams.get("axes.edgecolor", "#222222"), "alpha": 0.65})
        set_labels_from(axis, panel_labels)
        if panel_labels.get("legend", False):
            handles, legend_labels = axis.get_legend_handles_labels()
            if handles:
                axis.legend(loc="best", fontsize=6.2, frameon=False)
        panel_label = panel.get("panel")
        if panel_label is None and default_panel_labels != "none":
            panel_label = panel_letters[panel_index]
        if panel_label:
            axis.text(-0.16, 1.08, panel_label, transform=axis.transAxes, fontweight="bold", va="top", fontsize=9.2, clip_on=False)
    for panel_index, panel in enumerate(panels):
        row = panel_index // columns
        col = panel_index % columns
        draw_small_panel(axes_grid[row][col], panel, panel_index)
    for empty_index in range(len(panels), rows * columns):
        row = empty_index // columns
        col = empty_index % columns
        axes_grid[row][col].axis("off")
    if labels.get("title"):
        fig.suptitle(labels.get("title"), fontsize=title_size)
        add_layout_note("Reserved constrained-layout space for the multi-panel title.")
    renderer_diagnostics["multiPanelCount"] = len(panels)
    add_layout_note(f"Rendered {len(panels)} controlled subpanels in a {rows}x{columns} layout.")
elif template == "flowchart":
    nodes = data.get("nodes") or []
    raw_edges = data.get("edges") or []
    node_ids = []
    for index, node in enumerate(nodes):
        node_ids.append(str(node.get("id") or node.get("key") or index))
    node_id_set = set(node_ids)
    auto_edges = False
    if not raw_edges and len(node_ids) > 1:
        auto_edges = True
        raw_edges = [{"from": node_ids[index], "to": node_ids[index + 1]} for index in range(len(node_ids) - 1)]
    edges = []
    for edge in raw_edges:
        start_id = str(edge.get("from"))
        end_id = str(edge.get("to"))
        if start_id in node_id_set and end_id in node_id_set:
            edges.append({"from": start_id, "to": end_id, "label": edge.get("label")})
    positions = {}
    box_width = 1.18
    box_height = 0.42
    if auto_edges and len(nodes) > 6:
        columns = int(math.ceil(math.sqrt(len(nodes) * 1.6)))
        rows = int(math.ceil(len(nodes) / max(1, columns)))
        for index, node_id in enumerate(node_ids):
            row_index = index // columns
            col_index = index % columns
            col = col_index if row_index % 2 == 0 else columns - 1 - col_index
            row = rows - 1 - row_index
            positions[node_id] = (col * 1.65 + 0.85, row * 0.92 + 0.62)
        ax.set_xlim(0, columns * 1.65)
        ax.set_ylim(0, rows * 0.92 + 0.45)
    else:
        levels = {node_id: 0 for node_id in node_ids}
        for _ in range(max(1, len(node_ids))):
            changed = False
            for edge in edges:
                start_level = levels.get(edge["from"], 0)
                next_level = min(len(node_ids) - 1, start_level + 1)
                if levels.get(edge["to"], 0) < next_level:
                    levels[edge["to"]] = next_level
                    changed = True
            if not changed:
                break
        grouped = {}
        for node_id in node_ids:
            grouped.setdefault(levels.get(node_id, 0), []).append(node_id)
        columns = max(grouped.keys(), default=0) + 1
        rows = max([len(items) for items in grouped.values()] or [1])
        for level, items in grouped.items():
            for item_index, node_id in enumerate(items):
                y_offset = (rows - len(items)) * 0.5
                positions[node_id] = (level * 1.75 + 0.85, (rows - 1 - item_index - y_offset) * 0.92 + 0.62)
        ax.set_xlim(0, max(1, columns) * 1.75)
        ax.set_ylim(0, max(1, rows) * 0.92 + 0.45)
    ax.axis("off")
    def wrap_flow_label(value):
        text = str(value or "")
        if len(text) <= 13 or " " not in text:
            return text
        words = text.split()
        lines = []
        current = ""
        for word in words:
            candidate = word if not current else current + " " + word
            if len(candidate) <= 12:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return "\n".join(lines[:3])
    def flow_font_size(label):
        base = as_float(mpl.rcParams.get("font.size", 8), 8)
        longest = max([len(part) for part in str(label).split("\n")] or [0])
        if longest > 15:
            return min(base, 6.4)
        if longest > 11:
            return min(base, 7.0)
        return min(base, 8.0)
    def boundary_points(start, end):
        sx, sy = start
        ex, ey = end
        dx = ex - sx
        dy = ey - sy
        if abs(dx) >= abs(dy):
            start_offset = (box_width / 2 + 0.04 if dx >= 0 else -box_width / 2 - 0.04, 0)
            end_offset = (-box_width / 2 - 0.04 if dx >= 0 else box_width / 2 + 0.04, 0)
        else:
            start_offset = (0, box_height / 2 + 0.04 if dy >= 0 else -box_height / 2 - 0.04)
            end_offset = (0, -box_height / 2 - 0.04 if dy >= 0 else box_height / 2 + 0.04)
        return (sx + start_offset[0], sy + start_offset[1]), (ex + end_offset[0], ey + end_offset[1])
    for edge in edges:
        start = positions.get(edge["from"])
        end = positions.get(edge["to"])
        if not start or not end:
            continue
        start_edge, end_edge = boundary_points(start, end)
        arrow = FancyArrowPatch(
            start_edge,
            end_edge,
            arrowstyle="-|>",
            mutation_scale=11,
            linewidth=0.85,
            color=mpl.rcParams.get("axes.edgecolor", "#222222"),
            alpha=0.76,
            connectionstyle="arc3,rad=0.04",
            zorder=1,
        )
        ax.add_patch(arrow)
        if edge.get("label"):
            ax.text((start_edge[0] + end_edge[0]) / 2, (start_edge[1] + end_edge[1]) / 2 + 0.08, str(edge.get("label")), ha="center", va="center", fontsize=min(label_size, 6.4), color=mpl.rcParams.get("text.color", "#222222"), zorder=4)
    for index, node in enumerate(nodes):
        node_id = node_ids[index]
        x, y = positions.get(node_id, (0, 0))
        color = node.get("color") or palette[index % len(palette)]
        rect = Rectangle((x - box_width / 2, y - box_height / 2), box_width, box_height, facecolor=color, edgecolor=mpl.rcParams.get("axes.edgecolor", "#222222"), linewidth=0.85, alpha=0.16, zorder=2)
        ax.add_patch(rect)
        label = wrap_flow_label(node.get("label", ""))
        ax.text(x, y, label, ha="center", va="center", fontsize=flow_font_size(label), color=mpl.rcParams.get("text.color", "#222222"), wrap=True, linespacing=0.94, zorder=3)
    renderer_diagnostics["flowchartNodeCount"] = len(nodes)
    renderer_diagnostics["flowchartEdgeCount"] = len(edges)
    if auto_edges:
        add_layout_note("Rendered directed flowchart with inferred sequential arrows because no edges were provided.")
    else:
        add_layout_note("Rendered directed flowchart with explicit arrows.")
    if labels.get("title"):
        ax.set_title(labels.get("title"), pad=4, fontsize=title_size)
elif template == "schematic-grid":
    nodes = data.get("nodes") or []
    edges = data.get("edges") or []
    primitives = data.get("primitives") or []
    columns = int(math.ceil(math.sqrt(len(nodes))))
    rows = int(math.ceil(len(nodes) / max(1, columns)))
    positions = {}
    node_sizes = {}
    explicit_positions = all(isinstance(node.get("x"), (int, float)) and isinstance(node.get("y"), (int, float)) for node in nodes)
    if explicit_positions:
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        add_layout_note("Used explicit schematic node coordinates.")
    else:
        ax.set_xlim(0, columns)
        ax.set_ylim(0, rows)
    ax.axis("off")
    if primitives or any(str(node.get("shape") or "rectangle").lower() not in ("rectangle", "rect") for node in nodes):
        ax.set_aspect("equal", adjustable="box")
    def first_present(mapping, *keys):
        for key in keys:
            value = mapping.get(key)
            if value is not None:
                return value
        return None
    def wrap_node_label(value, max_line_length=None, max_lines=None, target_width=None):
        text = str(value or "")
        paragraphs = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        width_limit = int(clamp(round(as_float(target_width, 0.24) * 56), 8, 24))
        requested_limit = int(clamp(as_float(max_line_length, width_limit), 8, 24))
        line_limit = min(requested_limit, width_limit)
        default_line_count = max(3, min(5, len(paragraphs)))
        line_count_limit = int(clamp(as_float(max_lines, default_line_count), 1, 5))
        lines = []
        for paragraph in paragraphs:
            paragraph = str(paragraph).strip()
            if not paragraph:
                continue
            wrapped = textwrap.wrap(
                paragraph,
                width=line_limit,
                break_long_words=False,
                break_on_hyphens=False,
            )
            if not wrapped and paragraph:
                wrapped = [paragraph]
            if len(wrapped) == 1 and len(wrapped[0]) > line_limit * 1.35:
                wrapped = textwrap.wrap(
                    wrapped[0],
                    width=line_limit,
                    break_long_words=True,
                    break_on_hyphens=False,
                )
            lines.extend(wrapped)
        if not lines:
            return text
        truncated = len(lines) > line_count_limit
        lines = lines[:line_count_limit]
        if truncated and lines:
            lines[-1] = (lines[-1][:max(1, line_limit - 3)] + "...") if len(lines[-1]) > line_limit - 3 else lines[-1] + "..."
        return "\n".join(lines)
    def contrast_text_color(facecolor, alpha=0.18, fallback=None):
        fallback = fallback or mpl.rcParams.get("text.color", "#222222")
        try:
            face_rgb = to_rgb(facecolor)
            bg_rgb = to_rgb(mpl.rcParams.get("axes.facecolor", "#ffffff"))
            effective = tuple(alpha * face_rgb[i] + (1 - alpha) * bg_rgb[i] for i in range(3))
            def channel(value):
                return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4
            luminance = 0.2126 * channel(effective[0]) + 0.7152 * channel(effective[1]) + 0.0722 * channel(effective[2])
            return fallback if luminance >= 0.48 else "#ffffff"
        except Exception:
            return fallback
    def add_shape(shape, center_x, center_y, width, height, facecolor, edgecolor, linewidth, alpha, zorder, points=None):
        kind = str(shape or "rectangle").strip().lower()
        if kind in ("circle", "ellipse"):
            if kind == "circle":
                width = height = min(width, height)
            patch = Ellipse((center_x, center_y), width=width, height=height, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif kind == "triangle":
            patch = Polygon([
                (center_x, center_y + height / 2),
                (center_x - width / 2, center_y - height / 2),
                (center_x + width / 2, center_y - height / 2),
            ], closed=True, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif kind == "polygon" and isinstance(points, list) and len(points) >= 3:
            vertices = [
                (as_float(point.get("x"), 0), as_float(point.get("y"), 0))
                for point in points
                if isinstance(point, dict)
            ]
            if len(vertices) < 3:
                raise ValueError("Polygon primitives require at least three valid points.")
            patch = Polygon(vertices, closed=True, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif kind in ("rectangle", "rect"):
            patch = Rectangle((center_x - width / 2, center_y - height / 2), width, height, facecolor=facecolor, edgecolor=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        else:
            raise ValueError("Unsupported vector primitive shape: " + kind)
        ax.add_patch(patch)
    for primitive in primitives:
        if not isinstance(primitive, dict):
            continue
        primitive_type = str(primitive.get("type") or primitive.get("kind") or "").strip().lower()
        color = primitive.get("fill") or primitive.get("color") or "none"
        edgecolor = primitive.get("stroke") or mpl.rcParams.get("axes.edgecolor", "#222222")
        linewidth = clamp(as_float(primitive.get("strokeWidth"), 1.0), 0.0, 12.0)
        alpha = clamp(as_float(primitive.get("opacity"), 1.0), 0.0, 1.0)
        zorder = as_float(primitive.get("z"), 2)
        if primitive_type in ("line", "arrow"):
            x1 = as_float(first_present(primitive, "x1", "x"), 0)
            y1 = as_float(first_present(primitive, "y1", "y"), 0)
            x2 = as_float(primitive.get("x2"), x1)
            y2 = as_float(primitive.get("y2"), y1)
            if primitive_type == "arrow":
                ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=11, linewidth=linewidth, color=edgecolor, alpha=alpha, zorder=zorder))
            else:
                ax.plot([x1, x2], [y1, y2], color=edgecolor, linewidth=linewidth, alpha=alpha, zorder=zorder)
        elif primitive_type == "text":
            ax.text(
                as_float(primitive.get("x"), 0.5),
                as_float(primitive.get("y"), 0.5),
                str(primitive.get("text") or ""),
                ha=str(primitive.get("horizontalAlign") or "center"),
                va=str(primitive.get("verticalAlign") or "center"),
                fontsize=clamp(as_float(primitive.get("fontSize"), mpl.rcParams.get("font.size", 8)), 4, 72),
                color=primitive.get("textColor") or edgecolor,
                alpha=alpha,
                zorder=zorder,
            )
        else:
            width = clamp(as_float(first_present(primitive, "width", "w", "diameter"), 0.18), 0.001, 2.0)
            height = clamp(as_float(first_present(primitive, "height", "h", "diameter"), width), 0.001, 2.0)
            if primitive_type == "circle" and isinstance(primitive.get("radius"), (int, float)):
                width = height = clamp(float(primitive.get("radius")) * 2, 0.001, 2.0)
            add_shape(
                primitive_type,
                as_float(primitive.get("x"), 0.5),
                as_float(primitive.get("y"), 0.5),
                width,
                height,
                color,
                edgecolor,
                linewidth,
                alpha,
                zorder,
                primitive.get("points"),
            )
    def has_wrapped_label(original, wrapped):
        original_text = str(original or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        wrapped_text = str(wrapped or "").strip()
        return "\n" in original_text or wrapped_text.replace("\n", " ") != " ".join(original_text.split())
    def node_font_size(label):
        base = as_float(mpl.rcParams.get("font.size", 8), 8)
        parts = str(label).split("\n")
        longest = max([len(part) for part in parts] or [0])
        if len(parts) >= 4:
            return min(base, 5.6)
        if len(parts) >= 3:
            return min(base, 6.2)
        if longest > 13:
            return min(base, 6.8)
        if longest > 10:
            return min(base, 7.4)
        return min(base, 8.4)
    wrapped_node_labels = 0
    for index, node in enumerate(nodes):
        requested_width = first_present(node, "width", "w")
        requested_height = first_present(node, "height", "h")
        raw_label = node.get("label", "")
        label = wrap_node_label(raw_label, node.get("maxLineLength"), node.get("maxLines"), requested_width)
        if has_wrapped_label(raw_label, label):
            wrapped_node_labels += 1
        if explicit_positions:
            center_x = clamp(float(node.get("x")), 0.08, 0.92)
            center_y = clamp(float(node.get("y")), 0.10, 0.90)
            longest = max([len(part) for part in str(label).split("\n")] or [0])
            width = clamp(as_float(requested_width, 0.13 + longest * 0.0055), 0.12, 0.42)
            height = clamp(as_float(requested_height, 0.14 if "\n" not in str(label) else 0.10 + 0.038 * len(str(label).split("\n"))), 0.10, 0.34)
            x = center_x - width / 2
            y = center_y - height / 2
        else:
            row_index = index // columns
            col_index = index % columns
            col = col_index if row_index % 2 == 0 else columns - 1 - col_index
            row = rows - 1 - row_index
            x = col + 0.12
            y = row + 0.25
            width = 0.76
            height = 0.5
            center_x = x + width / 2
            center_y = y + height / 2
        color = node.get("color") or node.get("fill") or palette[index % len(palette)]
        alpha = clamp(as_float(first_present(node, "alpha", "opacity"), 0.18), 0.08, 1.0)
        text_color = first_present(node, "textColor", "labelColor", "fontColor") or contrast_text_color(color, alpha)
        add_shape(
            node.get("shape") or "rectangle",
            center_x,
            center_y,
            width,
            height,
            color,
            node.get("stroke") or mpl.rcParams.get("axes.edgecolor", "#222222"),
            clamp(as_float(node.get("strokeWidth"), 0.9), 0.0, 12.0),
            alpha,
            2,
            node.get("points"),
        )
        ax.text(center_x, center_y, label, ha="center", va="center", fontsize=node_font_size(label), color=text_color, wrap=True, linespacing=0.95, zorder=3)
        node_id = str(node.get("id") or str(index))
        positions[node_id] = (center_x, center_y)
        node_sizes[node_id] = (width, height)
    if wrapped_node_labels:
        add_layout_note("Preserved and wrapped schematic node labels within node bounds.")
    def edge_points(start_id, end_id):
        start = positions[start_id]
        end = positions[end_id]
        sx, sy = start
        ex, ey = end
        dx = ex - sx
        dy = ey - sy
        start_w, start_h = node_sizes.get(start_id, (0.76, 0.5))
        end_w, end_h = node_sizes.get(end_id, (0.76, 0.5))
        if abs(dx) >= abs(dy):
            start_offset = ((start_w / 2 + 0.012) if dx > 0 else -(start_w / 2 + 0.012), 0)
            end_offset = (-(end_w / 2 + 0.012) if dx > 0 else (end_w / 2 + 0.012), 0)
        else:
            start_offset = (0, (start_h / 2 + 0.012) if dy > 0 else -(start_h / 2 + 0.012))
            end_offset = (0, -(end_h / 2 + 0.012) if dy > 0 else (end_h / 2 + 0.012))
        return (sx + start_offset[0], sy + start_offset[1]), (ex + end_offset[0], ey + end_offset[1])
    drawn_edges = 0
    for edge in edges:
        start_id = first_present(edge, "from", "source", "start")
        end_id = first_present(edge, "to", "target", "end")
        if start_id is None or end_id is None:
            continue
        start_key = str(start_id)
        end_key = str(end_id)
        if start_key in positions and end_key in positions:
            start_edge, end_edge = edge_points(start_key, end_key)
            edge_style = str(edge.get("style") or edge.get("type") or "").lower()
            linestyle = "--" if "dash" in edge_style or "inhibit" in edge_style else "-"
            edge_color = edge.get("color") or mpl.rcParams.get("axes.edgecolor", "#222222")
            arrow = FancyArrowPatch(
                start_edge,
                end_edge,
                arrowstyle="-|>",
                mutation_scale=14,
                linewidth=1.15,
                color=edge_color,
                alpha=0.9,
                linestyle=linestyle,
                connectionstyle="arc3,rad=0.0" if explicit_positions else "angle3,angleA=0,angleB=90",
                shrinkA=2,
                shrinkB=2,
                zorder=2.6,
            )
            ax.add_patch(arrow)
            edge_label = edge.get("label")
            if edge_label:
                label_x = (start_edge[0] + end_edge[0]) / 2
                label_y = (start_edge[1] + end_edge[1]) / 2
                ax.text(label_x, label_y, str(edge_label).replace("\n", " "), ha="center", va="center", fontsize=min(label_size, 5.8), color=mpl.rcParams.get("text.color", "#222222"), bbox={"boxstyle": "round,pad=0.16", "facecolor": "white", "alpha": 0.82, "edgecolor": "none"}, zorder=4)
            drawn_edges += 1
    add_layout_note(f"Rendered {drawn_edges} of {len(edges)} schematic edges.")
    renderer_diagnostics["schematicNodeCount"] = len(nodes)
    renderer_diagnostics["schematicEdgeCount"] = drawn_edges
    renderer_diagnostics["schematicPrimitiveCount"] = len(primitives)
    renderer_diagnostics["schematicExplicitPositions"] = bool(explicit_positions)
    if drawn_edges < len(edges):
        add_layout_note("Skipped schematic edges with missing source or target ids.")
    if labels.get("title"):
        ax.set_title(labels.get("title"), pad=4, fontsize=title_size)
else:
    raise ValueError(f"Unsupported template: {template}")

for figure_axis in fig.axes:
    try:
        figure_axis.tick_params(axis="both", labelsize=tick_size, pad=1.2)
        for tick_label in figure_axis.get_xticklabels() + figure_axis.get_yticklabels():
            tick_label.set_fontsize(tick_size)
    except Exception:
        pass

if template not in ("schematic-grid", "flowchart", "heatmap", "attention-map", "multi-panel"):
    if mpl.rcParams.get("axes.grid"):
        ax.grid(True)
    for spine in ("top", "right"):
        try:
            ax.spines[spine].set_visible(bool(mpl.rcParams.get(f"axes.spines.{spine}", False)))
        except Exception:
            pass

if labels.get("panel") and template != "multi-panel":
    panel_x = -0.24 if labels.get("title") else -0.1
    panel_y = 1.075 if labels.get("title") else 1.06
    panel_label_artist = ax.text(panel_x, panel_y, labels.get("panel"), transform=ax.transAxes, fontweight="bold", va="top", fontsize=panel_size, clip_on=False)
    renderer_diagnostics["layoutQuality"]["panelLabelAdjusted"] = bool(labels.get("title"))
    if labels.get("title"):
        add_layout_note("Offset panel label away from title to avoid overlap.")

def bbox_area(bbox):
    return max(0, bbox.width) * max(0, bbox.height)

def bbox_intersection_area(first, second):
    x0 = max(first.x0, second.x0)
    x1 = min(first.x1, second.x1)
    y0 = max(first.y0, second.y0)
    y1 = min(first.y1, second.y1)
    return max(0, x1 - x0) * max(0, y1 - y0)

def finalize_layout_quality():
    try:
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
        axes_bboxes = [
            figure_axis.get_window_extent(renderer)
            for figure_axis in fig.axes
            if figure_axis.get_visible()
        ]
        legend_risk = renderer_diagnostics["layoutQuality"]["legendOverlapRisk"]
        for legend in legend_artists:
            legend_bbox = legend.get_window_extent(renderer)
            for axes_bbox in axes_bboxes:
                overlap = bbox_intersection_area(legend_bbox, axes_bbox)
                if overlap <= 0:
                    continue
                axes_fraction = overlap / max(1.0, bbox_area(axes_bbox))
                legend_fraction = overlap / max(1.0, bbox_area(legend_bbox))
                if axes_fraction > 0.2 or (legend_fraction > 0.95 and axes_fraction > 0.14):
                    legend_risk = risk_max(legend_risk, "high")
                elif axes_fraction > 0.09:
                    legend_risk = risk_max(legend_risk, "medium")
                elif axes_fraction > 0.035:
                    legend_risk = risk_max(legend_risk, "low")
        renderer_diagnostics["layoutQuality"]["legendOverlapRisk"] = legend_risk
        if legend_risk in ("medium", "high"):
            add_layout_warning("Legend overlaps the plotting region; rerender with outside-right legend placement.")

        text_risk = renderer_diagnostics["layoutQuality"]["textOverflowRisk"]
        if len(raw_title) > 52:
            text_risk = risk_max(text_risk, "medium")
            add_layout_warning("Title is long enough to require wrapping or a shorter caption-style title.")
        elif len(raw_title) > 38:
            text_risk = risk_max(text_risk, "low")
        if len(str(labels.get("x") or "")) > 30 or len(str(labels.get("y") or "")) > 30:
            text_risk = risk_max(text_risk, "low")
        if panel_label_artist is not None:
            panel_bbox = panel_label_artist.get_window_extent(renderer)
            fig_bbox = fig.bbox
            if panel_bbox.x0 < fig_bbox.x0 - 4 or panel_bbox.y1 > fig_bbox.y1 + 4:
                renderer_diagnostics["layoutQuality"]["panelLabelAdjusted"] = True
                text_risk = risk_max(text_risk, "low")
        renderer_diagnostics["layoutQuality"]["textOverflowRisk"] = text_risk
    except Exception:
        add_layout_warning("Layout QA could not inspect text and legend bounding boxes.")

image_buffer = io.BytesIO()
dpi = int(mpl.rcParams.get("savefig.dpi", 300))
finalize_layout_quality()
renderer_diagnostics["savefigPadInches"] = savefig_pad_inches
fig.savefig(
    image_buffer,
    format="png",
    dpi=dpi,
    facecolor=mpl.rcParams.get("savefig.facecolor", "white"),
    transparent=bool(mpl.rcParams.get("savefig.transparent", False)),
    bbox_inches="tight",
    pad_inches=savefig_pad_inches,
)
plt.close(fig)
print(json.dumps({"ok": True, "imageBase64": base64.b64encode(image_buffer.getvalue()).decode("ascii"), "pythonVersion": platform.python_version(), "matplotlibVersion": mpl.__version__, "rendererDiagnostics": renderer_diagnostics}))
`
