export type FigureStyleSourceType = 'image' | 'pdf'


export type VisualStyleScope = 'manuscript' | 'workspace' | 'artifact'


export type VisualStyleSource =
  | {
      type: 'reference'
      path: string
      figureId?: string
      notes?: string
    }
  | {
      type: 'preset'
      presetId: string
    }
  | {
      type: 'inherited'
      profileId: string
    }
  | {
      type: 'current'
      artifactPath?: string
    }


export type VisualStyleTokens = {
  canvas: {
    width: number
    height: number
    aspectRatio: number
    background: string
  }
  palette: {
    colors: string[]
    background: string
    ink: string
    accent: string[]
    colorMode: 'monochrome' | 'limited' | 'multi-hue'
  }
  typography: {
    fontFamily: string
    axisSize: number
    labelSize: number
    titleSize: number
    weight: 'regular' | 'medium' | 'bold'
  }
  strokes: {
    ink: string
    primaryWidth: number
    secondaryWidth: number
    lineCap: 'butt' | 'round' | 'square' | 'unknown'
  }
  spacing: {
    margin: {
      left: number
      right: number
      top: number
      bottom: number
    }
    gutter: 'compact' | 'balanced' | 'spacious'
    density: 'sparse' | 'balanced' | 'dense'
  }
  shapes: {
    fillMode: 'solid' | 'outlined' | 'mixed' | 'unknown'
    cornerRadius?: number
    borderWidth?: number
    shadow: 'none' | 'subtle' | 'prominent' | 'unknown'
  }
  plots?: {
    panelGrid: string
    panelLabels: 'none' | 'A/B/C' | 'a/b/c' | 'numeric' | 'unknown'
    axes: FigureStyleSpec['axes']
    marks: FigureStyleSpec['marks']
    annotations: FigureStyleSpec['annotations']
    export: FigureStyleSpec['export']
  }
  generatedAssets?: {
    visualTreatment: 'flat' | 'illustrative' | 'photorealistic' | 'mixed' | 'unknown'
    backgroundTreatment: 'transparent' | 'solid' | 'textured' | 'unknown'
    edgeTreatment: 'crisp' | 'soft' | 'mixed' | 'unknown'
    detailLevel: 'sparse' | 'balanced' | 'rich' | 'unknown'
  }
}


export type VisualStyleProfile = {
  version: 1
  id: string
  scope: VisualStyleScope
  source: VisualStyleSource
  tokens: VisualStyleTokens
  semanticDescription: string
  confidence: {
    overall: number
    palette: number
    spacing: number
    plots: number
    typography: number
    generatedAssets: number
  }
}


export type VisualStyleExtractRequest = {
  workspaceRoot: string
  sourcePath: string
  sourceType?: FigureStyleSourceType
  sourceKind?: 'reference' | 'current'
  scope?: VisualStyleScope
  figureId?: string
  notes?: string
}


export type VisualStyleSimilarityRequest = {
  workspaceRoot: string
  referencePath: string
  outputPath: string
}


export type VisualStyleReviewRequest = VisualStyleSimilarityRequest


export type FigureStyleSpec = {
  version: 1
  source: {
    path: string
    type: FigureStyleSourceType
    figureId?: string
    notes?: string
  }
  canvas: {
    width: number
    height: number
    aspectRatio: number
    background: string
  }
  palette: {
    colors: string[]
    background: string
    ink: string
    accent: string[]
    colorMode: 'monochrome' | 'limited' | 'multi-hue'
  }
  typography: {
    fontFamily: string
    axisSize: number
    labelSize: number
    titleSize: number
    weight: 'regular' | 'medium' | 'bold'
  }
  layout: {
    panelGrid: string
    panelLabels: 'none' | 'A/B/C' | 'a/b/c' | 'numeric' | 'unknown'
    margin: {
      left: number
      right: number
      top: number
      bottom: number
    }
    gutter: 'compact' | 'balanced' | 'spacious'
  }
  axes: {
    spine: 'none' | 'left-bottom' | 'box' | 'minimal' | 'unknown'
    tickDirection: 'in' | 'out' | 'none' | 'unknown'
    grid: boolean
    gridTone: 'none' | 'light' | 'medium'
    gridColor: string
    gridAlpha: number
    gridLineWidth: number
  }
  marks: {
    lineWidth: number
    markerSize: number
    errorBarStyle: 'none' | 'caps' | 'unknown'
    density: 'sparse' | 'balanced' | 'dense'
  }
  annotations: {
    significance: 'none' | 'stars' | 'brackets' | 'unknown'
    legend: 'none' | 'frameless' | 'boxed' | 'unknown'
  }
  export: {
    formats: Array<'pdf' | 'svg' | 'png'>
    dpi: number
    transparent: boolean
  }
  confidence: {
    overall: number
    palette: number
    layout: number
    axes: number
    typography: number
  }
}


export type VisualStyleExtractDiagnostics = {
  analyzedAt: string
  sampledPixels: number
  foregroundRatio: number
  darkPixelRatio: number
  chromaRatio: number
  warnings: string[]
}


export type VisualStyleExtractResult =
  | {
      ok: true
      profile: VisualStyleProfile
      diagnostics: VisualStyleExtractDiagnostics
    }
  | { ok: false; message: string }


export type VisualStyleSimilarityMetric = {
  overall: number
  palette: number
  background: number
  axes: number
  grid: number
  layout: number
  marks: number
  typography?: number
  warnings: string[]
}


export type VisualStyleSimilarityResult =
  | {
      ok: true
      metric: VisualStyleSimilarityMetric
      diagnostics: {
        reference: VisualStyleExtractDiagnostics
        output: VisualStyleExtractDiagnostics
      }
    }
  | { ok: false; message: string }


export type VisualStyleReviewIssue = {
  id: 'background' | 'palette' | 'axes' | 'grid' | 'layout' | 'marks' | 'typography' | 'diagnostics'
  severity: 'info' | 'warning' | 'error'
  metric?: keyof Omit<VisualStyleSimilarityMetric, 'warnings'>
  score?: number
  message: string
  autoRepairable: boolean
}


export type VisualStyleRepairSuggestion = {
  shouldRerender: boolean
  reason: string
  rcParamsPatch: Record<string, string | number | boolean>
  palette?: string[]
  layoutHints: string[]
  guardrails: string[]
}


export type VisualStyleReviewResult =
  | {
      ok: true
      metric: VisualStyleSimilarityMetric
      issues: VisualStyleReviewIssue[]
      repairSuggestion: VisualStyleRepairSuggestion
      diagnostics: {
        reference: VisualStyleExtractDiagnostics
        output: VisualStyleExtractDiagnostics
      }
    }
  | { ok: false; message: string }


export type MatplotlibStyleAdapter = {
  rcParams: Record<string, string | number | boolean>
  palette: string[]
  layoutNotes: string[]
}


export const SCIENTIFIC_PLOTTING_TEMPLATES = [
  'line',
  'scatter',
  'bar',
  'errorbar-bar',
  'heatmap',
  'attention-map',
  'box-violin',
  'histogram-density',
  'multi-panel',
  'flowchart',
  'schematic-grid'
] as const


export type ScientificPlottingTemplate = typeof SCIENTIFIC_PLOTTING_TEMPLATES[number]


export type ScientificPlottingTemplateGuide = {
  template: ScientificPlottingTemplate
  useWhen: readonly string[]
  avoidWhen: readonly string[]
  expectedData: readonly string[]
  modelSelectionHint: string
}


export const SCIENTIFIC_PLOTTING_TEMPLATE_GUIDES = [
  {
    template: 'line',
    useWhen: ['trends over an ordered x-axis', 'time series or dose-response curves', 'multiple comparable series'],
    avoidWhen: ['categorical summaries without ordering', 'directed workflow diagrams'],
    expectedData: ['series[] with x/y points or rows containing x and one or more y columns'],
    modelSelectionHint: 'Choose line when the main relation is change along an ordered axis.'
  },
  {
    template: 'scatter',
    useWhen: ['point clouds', 'correlation or embedding plots', 'x/y observations with optional groups'],
    avoidWhen: ['aggregated category bars', 'matrix heatmaps'],
    expectedData: ['points[] with x/y values or tabular numeric x and y columns'],
    modelSelectionHint: 'Choose scatter when individual observations matter more than connected trends.'
  },
  {
    template: 'bar',
    useWhen: ['categorical comparisons', 'ranked or grouped summary values', 'counts or totals by class'],
    avoidWhen: ['distribution shape is important', 'uncertainty is central'],
    expectedData: ['categories with numeric values or grouped tabular summaries'],
    modelSelectionHint: 'Choose bar for simple category-level summaries.'
  },
  {
    template: 'errorbar-bar',
    useWhen: ['categorical summaries with uncertainty', 'mean plus standard error or confidence interval'],
    avoidWhen: ['raw distribution display', 'no uncertainty values are available'],
    expectedData: ['categories with value and error/ci fields'],
    modelSelectionHint: 'Choose errorbar-bar instead of bar when uncertainty is part of the claim.'
  },
  {
    template: 'heatmap',
    useWhen: ['generic numeric matrices', 'feature-by-sample tables', 'correlation or intensity grids'],
    avoidWhen: ['token attention maps', 'freeform diagrams'],
    expectedData: ['matrix as number[][] with optional rowLabels and colLabels'],
    modelSelectionHint: 'Choose heatmap for a numeric matrix where color encodes value.'
  },
  {
    template: 'attention-map',
    useWhen: ['token attention or alignment matrices', 'model-head or sequence-to-sequence attention panels'],
    avoidWhen: ['generic heatmaps without token/model semantics'],
    expectedData: ['matrix with source/target labels or attention-specific row/column labels'],
    modelSelectionHint: 'Choose attention-map only when the matrix represents attention, alignment, or token interactions.'
  },
  {
    template: 'box-violin',
    useWhen: ['distribution comparison by category', 'raw sample values should remain visible', 'box, violin, or swarm-like statistical panels'],
    avoidWhen: ['only summary values are available', 'ordered time trends'],
    expectedData: ['groups[] with values[] or tabular category plus numeric value columns'],
    modelSelectionHint: 'Choose box-violin when spread, outliers, or sample distributions matter.'
  },
  {
    template: 'histogram-density',
    useWhen: ['single or grouped distribution shape', 'residuals or score distributions', 'histogram/KDE style panels'],
    avoidWhen: ['category means', 'node-link workflows'],
    expectedData: ['values[] or groups[] with values[]'],
    modelSelectionHint: 'Choose histogram-density when the question is the shape of a numeric distribution.'
  },
  {
    template: 'multi-panel',
    useWhen: ['a figure composed of several coordinated panels', 'mixed chart types in one publication figure'],
    avoidWhen: ['a single standalone chart is enough', 'a directed process should be one flowchart'],
    expectedData: ['panels[] where each panel has a controlled template and data'],
    modelSelectionHint: 'Choose multi-panel to combine several controlled plots into one figure.'
  },
  {
    template: 'flowchart',
    useWhen: ['compact directed workflows with explicit nodes/edges', 'process steps connected by arrows', 'decision trees, pathways, or cause-effect chains with already-structured steps'],
    avoidWhen: ['unordered concept maps', 'module layouts without direction', 'ordinary categorical data', 'long prose or paper excerpts that need semantic visual design'],
    expectedData: ['nodes[] with id and label', 'optional edges[] with from/to; if omitted, compact steps are connected sequentially'],
    modelSelectionHint: 'Choose flowchart for compact node-edge diagrams with code-owned layout. Route dense prose-to-visual work through visual_generate before selecting an executor.'
  },
  {
    template: 'schematic-grid',
    useWhen: ['conceptual schematics', 'module or mechanism diagrams', 'labeled blocks without a strict direction'],
    avoidWhen: ['the user asks for a flowchart/workflow/pipeline', 'data needs axes or measured values'],
    expectedData: ['nodes[] with labels and optional groups; edges are not emphasized'],
    modelSelectionHint: 'Choose schematic-grid for conceptual layouts; choose flowchart instead when arrows or sequence are required.'
  }
] as const satisfies readonly ScientificPlottingTemplateGuide[]


export type ScientificPlottingReferenceProfile = {
  kind: 'chart' | 'matrix' | 'schematic' | 'mixed' | 'unknown'
  recommendedTemplate: ScientificPlottingTemplate
  confidence: number
  detectedTraits?: {
    aspect: 'wide' | 'tall' | 'balanced'
    background: 'light' | 'dark' | 'mid'
    axes: 'measured' | 'minimal' | 'none' | 'unknown'
    grid: 'none' | 'light' | 'medium'
    markDensity: 'sparse' | 'balanced' | 'dense'
    colorMode: FigureStyleSpec['palette']['colorMode']
    panelGrid: string
    textSignals: ScientificPlottingTemplate[]
  }
  reasons: string[]
  risks: string[]
}


export type ScientificPlottingTemplateAdvice = {
  selectedTemplate: ScientificPlottingTemplate
  referenceRecommendedTemplate?: ScientificPlottingTemplate
  compatible: boolean
  severity: 'info' | 'warning'
  messages: string[]
  nextActions: string[]
}


export type ScientificPlottingLabels = {
  title?: string
  x?: string
  y?: string
  legend?: boolean
  panel?: string
}


export type ScientificPlottingReproducibilityMode = 'standard' | 'reproducible'


type DataSourceRefBase = {
  schemaVersion: 1
  sourceId: string
  locator: string
  sha256: string
  datasetVersion?: string
  mediaType?: string
  selection?: {
    sheet?: string
    columns?: string[]
    rowFilter?: string
  }
}

export type DataSourceRef = DataSourceRefBase & { kind: 'inline' }



export type ScientificPlotTransformationV1 = {
  schemaVersion: 1
  transformationId: string
  kind:
    | 'identity'
    | 'tabular-map'
    | 'matrix-map'
    | 'vector-map'
    | 'scene-map'
    | 'group-aggregate'
    | 'caller-supplied'
  description: string
  parameters: Record<string, unknown>
  inputHash: string
  outputHash: string
}


export type DerivedTableReceipt = {
  schemaVersion: 1
  receiptId: string
  inputSourceIds: string[]
  operation: ScientificPlotTransformationV1['kind']
  inputHash: string
  outputHash: string
  transformationIds: string[]
  rowCount?: number
  columnCount?: number
  columns?: string[]
  warnings: string[]
}


export type StatisticalResultRefV1 = {
  sourceId: string
  locator: string
  sha256: string
  resultKey?: string
}


export type StatisticalComparisonV1 = {
  comparisonId: string
  groups: [string, string]
  test: string
  alternative: 'two-sided' | 'less' | 'greater'
  correction?: string
  alpha?: number
  resultRef: StatisticalResultRefV1
}


export type StatisticalDefinitionV1 = {
  schemaVersion: 1
  estimator: 'none' | 'raw' | 'mean' | 'median' | 'count' | 'density'
  aggregation?: {
    method: 'none' | 'mean' | 'median' | 'sum' | 'count'
    groupBy: string[]
  }
  uncertainty?: {
    kind: 'sd' | 'sem' | 'ci'
    confidenceLevel?: number
    sourceColumn?: string
    suppliedBy: 'source' | 'computed'
  }
  comparisons?: StatisticalComparisonV1[]
  missingValues: 'reject' | 'drop' | 'explicit'
  sampleUnit?: string
  seed?: number
  notes?: string[]
}

export type ScientificPlotEnvironmentV1 = { schemaVersion: 1; pythonVersion: string; packages: Record<string, string> }


export type ScientificPlotExecutionV1 = { schemaVersion: 1; renderer: 'scientific-figures-matplotlib'; rendererVersion: string; rendererCodeSha256: string; codePath: 'code.py'; inputsPath: 'inputs.json'; timeoutMs: number }



export type ScientificPlotMatplotlibParametersV1 = {
  schemaVersion: 1
  rcParams: Record<string, string | number | boolean>
  palette: string[]
  heatmapCmap?:
    | {
        kind: 'named'
        name: string
      }
    | {
        kind: 'linear-segmented'
        name: 'sciforge_style_heatmap' | 'sciforge_attention_map'
        colors: string[]
      }
}

export type ScientificPlotRecipeV1 = {
  schemaVersion: 1; recipeId: string; figureId: string; generationId: string; template: ScientificPlottingTemplate; dataHash: string;
  labels: ScientificPlottingLabels; dataSources: DataSourceRef[]; derivedTables: DerivedTableReceipt[]; transformations: ScientificPlotTransformationV1[];
  statistics?: StatisticalDefinitionV1; style: { resolvedSpec: FigureStyleSpec; resolvedSpecHash: string; styleProfileId?: string };
  render: { outputScale: number; matplotlib: ScientificPlotMatplotlibParametersV1 }; environment: ScientificPlotEnvironmentV1; execution: ScientificPlotExecutionV1;
  reproducibilityMode: ScientificPlottingReproducibilityMode; provenanceWarnings: string[]
}


export type ScientificPlottingStyleProfile = {
  id: string
  name: string
  venue: string
  sourceLabel: string
  description: string
  recommendedTemplates: ScientificPlottingTemplate[]
  tags: string[]
  styleSpec: FigureStyleSpec
  referenceProfile: ScientificPlottingReferenceProfile
  cautions: string[]
}


export type ScientificPlottingStyleProfileSummary = Omit<ScientificPlottingStyleProfile, 'styleSpec'> & {
  styleSpec?: FigureStyleSpec
}


export type ScientificPlottingStyleProfileMatch = {
  profileId: string
  profile: ScientificPlottingStyleProfileSummary
  score: number
  reasons: string[]
  cautions: string[]
}

export type ScientificPlottingRenderRequest = {
  workspaceRoot: string; documentId: string; generationId: string; template: ScientificPlottingTemplate; data: unknown;
  reproducibilityMode?: ScientificPlottingReproducibilityMode; dataSources?: DataSourceRef[]; derivedTableReceipts?: DerivedTableReceipt[];
  transformations?: ScientificPlotTransformationV1[]; statistics?: StatisticalDefinitionV1; provenanceWarnings?: string[];
  reviewTask?: string; labels?: ScientificPlottingLabels; figureId?: string; styleSpec?: FigureStyleSpec; styleProfileId?: string;
  matplotlib?: ScientificPlotMatplotlibParametersV1; outputScale?: number
}

export type ScientificPlottingPlanRequest = { workspaceRoot?: string; task: string; templateHint?: ScientificPlottingTemplate; styleSpec?: FigureStyleSpec; styleProfileId?: string }


export type ScientificPlottingDataMappingRequest = Omit<ScientificPlottingRenderRequest, 'template'> & { task: string; templateHint?: ScientificPlottingTemplate }



export type ScientificPlottingDataMappingResult =
  | {
      ok: true
      status: 'mapped'
      selectedTemplate: ScientificPlottingTemplate
      confidence: number
      renderRequest: ScientificPlottingRenderRequest
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
      dataSummary: {
        inputShape: 'template-ready' | 'tabular' | 'matrix' | 'vector' | 'multi-panel' | 'network' | 'unknown'
        rowCount?: number
        columnCount?: number
        numericColumns?: string[]
        categoricalColumns?: string[]
        seriesCount?: number
        groupCount?: number
        pointCount?: number
        matrixShape?: [number, number]
      }
      mappingBasis: {
        taskSignals: ScientificPlottingTemplate[]
        dataSignals: ScientificPlottingTemplate[]
        selectedBy: 'templateHint' | 'dataShape' | 'task' | 'referenceProfile'
        reasons: string[]
      }
      alternatives: Array<{
        template: ScientificPlottingTemplate
        confidence: number
        reason: string
      }>
      warnings: string[]
      guardrails: string[]
    }
  | {
      ok: false
      status: 'needs_clarification' | 'invalid_request' | 'invalid_workspace'
      message: string
      missingInputs: string[]
      warnings: string[]
    }

export type ScientificPlottingStatusResult = { ok: true; serverName: 'scientific_plotting'; version: string;
  renderer: { kind: 'matplotlib'; available: boolean; version?: string; message?: string }; supportedTemplates: ScientificPlottingTemplate[];
  templateGuides: ScientificPlottingTemplateGuide[]; outputPolicy: { sourceRelativeDir: string; returnsImageBytes: true; persistsImages: false }; degraded: boolean; guardrails: string[] }


export type ScientificPlottingReviewResult =
  | (Extract<VisualStyleReviewResult, { ok: true }> & {
      template?: ScientificPlottingTemplate
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
    })
  | Extract<VisualStyleReviewResult, { ok: false }>


export type ScientificPlottingAttempt = {
  attempt: number
  outputPath: string
  outputHash: string
  executedAt: string
  repaired: boolean
  review?: ScientificPlottingReviewResult
  rcParamsPatch?: Record<string, string | number | boolean>
  rendererDiagnostics?: {
    fontFallback?: {
      cjk: string | null
    }
    legendPlacement?: 'inside' | 'outside-right' | 'none'
    barOrientation?: 'vertical' | 'horizontal'
    barColorMode?: 'series' | 'per-bar'
    categoryLabelRotation?: number
    savefigPadInches?: number
    multiPanelCount?: number
    schematicNodeCount?: number
    schematicEdgeCount?: number
    schematicPrimitiveCount?: number
    schematicExplicitPositions?: boolean
    typography?: {
      titleSize: number
      labelSize: number
      tickSize: number
      legendSize: number
      panelSize: number
      publicationClampApplied: boolean
    }
    layoutQuality?: {
      legendItemCount: number
      legendColumnCount: number
      legendOutsidePlot: boolean
      legendOverlapRisk: 'none' | 'low' | 'medium' | 'high'
      textOverflowRisk: 'none' | 'low' | 'medium' | 'high'
      panelLabelAdjusted: boolean
      warnings: string[]
    }
    layoutNotes: string[]
  }
  warnings: string[]
}

export type ScientificPlottingRenderResult =
 | { ok: true; status: 'rendered'; imageBytes: Uint8Array; mediaType: 'image/png'; imageHash: string; width: number; height: number;
     recipe: ScientificPlotRecipeV1; code: string; inputs: unknown; paths: { recipe: string; code: string; inputs: string };
     rendererDiagnostics?: NonNullable<ScientificPlottingAttempt['rendererDiagnostics']>; warnings: string[] }
 | { ok: false; status: 'invalid_request' | 'invalid_workspace' | 'renderer_unavailable' | 'render_failed'; message: string; stderrTail?: string; warnings: string[] }



/** Trusted adapter configuration, deliberately absent from model-facing request schemas. */
export type ScientificFigureRendererOptions = Readonly<{ pythonCommand?: string; tempRoot?: string }>
