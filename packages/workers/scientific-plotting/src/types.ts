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

export const SCIENTIFIC_FIGURE_NEEDS = [
  'quantitative_chart',
  'statistical_comparison',
  'heatmap_matrix',
  'multi_panel_figure',
  'method_flow',
  'mechanism_schematic',
  'model_architecture',
  'pathway_network',
  'image_panel',
  'summary_figure'
] as const

export type ScientificFigureNeed = typeof SCIENTIFIC_FIGURE_NEEDS[number]

export type ScientificFigureRoute = 'needs_clarification'

export type ScientificExternalSkillSourceKind = 'kdense' | 'cns' | 'domain' | 'general' | 'compat'

export type ScientificExternalSkillCatalogItem = {
  skillId: string
  label: string
  sourceKind: ScientificExternalSkillSourceKind
  source: string
  repository?: string
  skillPath?: string
  status: 'installed' | 'remote-reference' | 'built-in-profile' | 'compatible-standard'
  priority: number
  appliesTo: ScientificFigureNeed[]
  roles: string[]
  readOnly: boolean
  executionPolicy: 'read-only-planning'
  notes: string[]
}

export type ScientificPlottingResearchPaper = {
  title: string
  venue?: string
  year?: number
  source?: string
  url?: string
  doi?: string
  figureHints?: string[]
  notes?: string
}

export type ScientificPlottingImagePolishDeltaPlan = {
  mode: 'delta_only'
  targetPanels: Array<{
    assetId: string
    reason: string
    allowedOperations: Array<
      | 'panel_stitching'
      | 'callout_overlay'
      | 'zoom_inset'
      | 'visual_unification'
      | 'typography_cleanup'
      | 'mechanism_visual_draft'
    >
  }>
  allowedOperations: Array<
    | 'panel_stitching'
    | 'callout_overlay'
    | 'zoom_inset'
    | 'visual_unification'
    | 'typography_cleanup'
    | 'mechanism_visual_draft'
  >
  lockedFacts: string[]
  handoffPrompt: string
}

export type ScientificPaperFigureCompositionPlan = {
  sourceWorkflow: 'controlled_subfigures_then_image2_composition_v1'
  stageOrder: ['controlled_subfigures', 'image2_composition', 'canvas_review_iteration']
  controlledSubfigures: Array<{
    assetId: string
    title: string
    claim: string
    recommendedTemplate:
      | ScientificPlottingTemplate
      | 'kaplan-meier'
      | 'cox-forest'
      | 'roc'
      | 'image_generation_composition'
    firstPassTool: 'scientific_visual_plan'
    requiredArtifact: 'png_manifest'
    factLocks: string[]
    polishAllowedOperations: Array<
      | 'crop'
      | 'resize'
      | 'align'
      | 'panel_stitching'
      | 'callout_overlay'
      | 'zoom_inset'
      | 'visual_unification'
      | 'typography_cleanup'
    >
  }>
  image2Composition: {
    nextControlledTool: 'scientific_visual_plan'
    inputArtifacts: string[]
    allowedOperations: Array<
      | 'panel_stitching'
      | 'callout_overlay'
      | 'zoom_inset'
      | 'visual_unification'
      | 'typography_cleanup'
    >
    forbiddenOperations: string[]
    handoffPrompt: string
    outputContract: string[]
  }
  imagePolishDeltaPlan: ScientificPlottingImagePolishDeltaPlan
  visualReview: {
    openInVisualReview: true
    preserveOriginalArtifacts: true
    reviewPacketRequired: true
    revisionPolicy: 'new_version_next_to_original'
  }
}

export type ScientificPaperFigureProductionPlan = {
  scope: 'paper_level'
  sourceWorkflow: 'paper_figures_data_first_v1'
  requiredInputs: string[]
  proposedAssets: Array<{
    id: string
    kind: 'figure' | 'table'
    title: string
    claim: string
    recommendedTemplate:
      | ScientificPlottingTemplate
      | 'kaplan-meier'
      | 'cox-forest'
      | 'roc'
      | 'three-line-table'
      | 'image_generation_composition'
    dataRequirements: string[]
    statistics: string[]
    firstPassTool: 'scientific_visual_plan' | 'table_generator'
    visualReview: boolean
    notes: string[]
  }>
  handoff: {
    firstPass: string[]
    imagePolish: string[]
    reviewLoop: string[]
  }
  compositionPlan?: ScientificPaperFigureCompositionPlan
  missingCapabilities: string[]
}

export type ScientificPlottingSelectedSkillProfile = {
  profileId:
    | 'controlled-data-plot-v1'
    | 'paper-figure-cns-life-science-v1'
    | 'paper-figure-cns-domain-v1'
    | 'mechanism-diagram-image-delta-v1'
    | 'general-paper-figure-v1'
  selectedSkillIds: string[]
  selectionReason: string
  skillPriority: ['kdense', 'cns', 'domain', 'image-delta']
  readOnlyExternalSkills: true
}

export type ScientificFigureNeedClassification = {
  primaryNeed: ScientificFigureNeed
  secondaryNeeds: ScientificFigureNeed[]
  confidence: number
  route: ScientificFigureRoute
  routeReason: string
  domain: 'life-science' | 'chemistry' | 'materials' | 'ai-ml' | 'geo-climate' | 'general'
  recommendedNextTool: 'scientific_visual_plan'
  requiredInputs: string[]
  avoidTemplates: ScientificPlottingTemplate[]
  warnings: string[]
}

export type ScientificPlottingResearchBriefRequest = {
  workspaceRoot?: string
  task: string
  domain?: string
  targetVenue?: string
  dataSummary?: string
  referenceFigureNotes?: string
  candidatePapers?: ScientificPlottingResearchPaper[]
  maxPapers?: number
}

export type ScientificPlottingResearchBriefResult =
  | {
      ok: true
      task: string
      domain: ScientificFigureNeedClassification['domain']
      targetVenue?: string
      figureNeed: ScientificFigureNeedClassification
      selectedSkillProfile: ScientificPlottingSelectedSkillProfile
      skillCatalog: ScientificExternalSkillCatalogItem[]
      recommendedSkillLayers: Array<{
        sourceKind: ScientificExternalSkillSourceKind
        skillIds: string[]
        reason: string
      }>
      literatureStrategy: {
        suggestedQueries: string[]
        preferredSources: string[]
        nextControlledTool: 'research_search' | 'scientific_plotting_research_brief'
        notes: string[]
      }
      candidatePapers: ScientificPlottingResearchPaper[]
      figureContract: {
        figureConclusion: string
        evidenceLogic: string[]
        archetype: ScientificFigureNeed
        journalExportContract: string[]
        reviewRisks: string[]
      }
      paperFigureProductionPlan?: ScientificPaperFigureProductionPlan
      promptSpecDraft: {
        task: string
        figureNeed: ScientificFigureNeed
        referencePapers: ScientificPlottingResearchPaper[]
        visualPlan: string[]
        dataRequirements: string[]
        styleGuidance: string[]
        fullPrompt: string
        codeGenerationPlan: {
          target: 'scientific_visual_plan_request'
          nextControlledTool: string
          notes: string[]
        }
        nextControlledTool: string
      }
      confirmationCard: {
        title: string
        proposedRoute: ScientificFigureRoute
        analysisAngle: string
        questions: string[]
        requiredInputs: string[]
        availableSkillIds: string[]
      }
      guardrails: string[]
      warnings: string[]
    }
  | { ok: false; message: string; warnings: string[] }

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
    modelSelectionHint: 'Choose flowchart only for controlled compact node-edge diagrams; choose image_generation for prose-to-visual flowcharts, infographics, or illustrative diagrams.'
  },
  {
    template: 'schematic-grid',
    useWhen: ['conceptual schematics', 'module or mechanism diagrams', 'labeled blocks without a strict direction'],
    avoidWhen: ['the user asks for a flowchart/workflow/pipeline', 'data needs axes or measured values'],
    expectedData: ['nodes[] with labels and optional groups; edges are not emphasized'],
    modelSelectionHint: 'Choose schematic-grid for conceptual layouts; choose flowchart instead when arrows or sequence are required.'
  }
] as const satisfies readonly ScientificPlottingTemplateGuide[]

export type ScientificPlottingTemplateSelection = {
  selectedTemplate: ScientificPlottingTemplate
  selectedBy: 'templateHint' | 'referenceProfile' | 'taskIntent'
  useWhen: string[]
  avoidWhen: string[]
  expectedData: string[]
  modelSelectionHint: string
}

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

export type ScientificPlottingAutoRepairOptions = {
  enabled?: boolean
  maxAttempts?: 0 | 1
  minOverall?: number
}

export type ScientificPlottingVisualPlanHandoff = {
  route: 'deterministic_plot' | 'hybrid_composite'
  routeLocked: true
  rationale: string
  reproducibleInputs: string[]
  truthLockedElements: string[]
  fallbackPolicy: 'fail_closed'
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

export type ScientificPlottingStyleProfilesRequest = {
  workspaceRoot?: string
  profileId?: string
  query?: string
  referencePath?: string
  styleSpecPath?: string
  styleSpec?: FigureStyleSpec
  includeStyleSpec?: boolean
  topK?: number
}

export type ScientificPlottingStyleProfilesResult =
  | {
      ok: true
      status: 'listed' | 'found' | 'matched'
      profiles: ScientificPlottingStyleProfileSummary[]
      total: number
      selectedProfile?: ScientificPlottingStyleProfileSummary
      profileMatches?: ScientificPlottingStyleProfileMatch[]
      referenceProfile?: ScientificPlottingReferenceProfile
      recommendedNextTools: Array<
        | 'scientific_visual_plan'
        | 'scientific_plotting_map_data'
        | 'scientific_plotting_render'
        | 'visual_artifact_review'
      >
      warnings: string[]
    }
  | {
      ok: false
      status: 'not_found' | 'invalid_request'
      message: string
      availableProfileIds: string[]
      warnings: string[]
    }

export type ScientificPlottingCropBox = {
  unit?: 'ratio' | 'pixel'
  x: number
  y: number
  width: number
  height: number
}

export type ScientificPlottingPrepareReferenceRequest = {
  workspaceRoot: string
  sourcePath: string
  sourceType?: 'image' | 'pdf'
  page?: number
  cropBox?: ScientificPlottingCropBox
  figureId?: string
  outputDir?: string
  dpi?: number
  extractStyle?: boolean
}

export type ScientificPlottingReferenceManifest = {
  version: 1
  tool: 'scientific_plotting_prepare_reference'
  createdAt: string
  requestHash: string
  source: {
    path: string
    type: 'image' | 'pdf'
    page?: number
    width: number
    height: number
  }
  cropBox: ScientificPlottingCropBox & {
    unit: 'pixel'
  }
  croppedImagePath: string
  styleSpecPath?: string
  referenceProfile?: ScientificPlottingReferenceProfile
  styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
  recommendedStyleProfile?: ScientificPlottingStyleProfileSummary
  warnings: string[]
  nextWorkflow: {
    styleSpecPath?: string
    referencePath: string
    suggestedStyleProfileId?: string
    suggestedProfileTool: 'scientific_plotting_style_profiles'
    suggestedPlanTool: 'scientific_visual_plan'
    suggestedRenderTool: 'scientific_plotting_render'
    suggestedReviewTool: 'visual_artifact_review'
    guardrails: string[]
  }
}

export type ScientificPlottingPrepareReferenceResult =
  | {
      ok: true
      status: 'prepared'
      source: {
        path: string
        type: 'image' | 'pdf'
        page?: number
        width: number
        height: number
      }
      cropBox: ScientificPlottingCropBox & {
        unit: 'pixel'
      }
      croppedImagePath: string
      styleSpecPath?: string
      referenceManifestPath: string
      referenceManifest: ScientificPlottingReferenceManifest
      styleSpec?: FigureStyleSpec
      referenceProfile?: ScientificPlottingReferenceProfile
      styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
      recommendedStyleProfile?: ScientificPlottingStyleProfileSummary
      warnings: string[]
    }
  | {
      ok: false
      status:
        | 'invalid_request'
        | 'invalid_workspace'
        | 'unsupported_source'
        | 'pdf_renderer_unavailable'
        | 'crop_failed'
      message: string
      stdoutTail?: string
      stderrTail?: string
      warnings?: string[]
    }

export type ScientificPlottingRenderRequest = {
  workspaceRoot: string
  scientificVisualPlan: ScientificPlottingVisualPlanHandoff
  template: ScientificPlottingTemplate
  data: unknown
  labels?: ScientificPlottingLabels
  figureId?: string
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  referencePath?: string
  reviewReferencePath?: string
  outputDir?: string
  /**
   * Multiplies the effective export DPI while preserving the same physical
   * layout and typography. Use this for print-ready raster outputs when the
   * default publication profile is visually correct but needs more pixels.
   */
  outputScale?: number
  visualDocumentId?: string
  threadId?: string
  autoRepair?: ScientificPlottingAutoRepairOptions
}

export type ScientificPlottingDraftHandoff = {
  kind: 'diagram_draft_handoff'
  draftRole: 'structure_only'
  sourceTemplate: ScientificPlottingTemplate
  recommendedNextTools: ['image_generation_prepare', 'image_generation_render']
  imageGenerationTask: string
  promptGuidance: string[]
  draftSpec: {
    template: ScientificPlottingTemplate
    title?: string
    nodes?: Array<{ id?: string; label: string; group?: string }>
    edges?: Array<{ from: string; to: string; label?: string }>
    panels?: Array<{ template?: string; title?: string; nodeCount?: number }>
  }
  guardrails: string[]
}

export type ScientificPlottingPlanRequest = {
  workspaceRoot?: string
  task: string
  domain?: string
  targetVenue?: string
  templateHint?: ScientificPlottingTemplate
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  referencePath?: string
}

export type ScientificPlottingDataMappingRequest = {
  workspaceRoot: string
  scientificVisualPlan: ScientificPlottingVisualPlanHandoff
  task: string
  data: unknown
  labels?: ScientificPlottingLabels
  templateHint?: ScientificPlottingTemplate
  styleSpec?: FigureStyleSpec
  styleSpecPath?: string
  styleProfileId?: string
  referencePath?: string
  reviewReferencePath?: string
  figureId?: string
  outputDir?: string
  outputScale?: number
  visualDocumentId?: string
  threadId?: string
  autoRepair?: ScientificPlottingAutoRepairOptions
}

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

export type ScientificPlottingPlanResult =
  | {
      ok: true
      recommendedTemplate: ScientificPlottingTemplate
      reason: string
      supportedTemplates: ScientificPlottingTemplate[]
      referenceProfile?: ScientificPlottingReferenceProfile
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      styleProfileMatches?: ScientificPlottingStyleProfileMatch[]
      templateSelection: ScientificPlottingTemplateSelection
      templateGuides: ScientificPlottingTemplateGuide[]
      figureNeed?: ScientificFigureNeedClassification
      researchBriefRecommendation?: {
        recommended: boolean
        reason: string
        nextControlledTool: 'scientific_plotting_research_brief'
        useWhen: string[]
        requiresUserConfirmation: true
      }
      externalSkillCatalog?: {
        recommendedSkillIds: string[]
        primarySources: ScientificExternalSkillSourceKind[]
        excludedSources: string[]
      }
      templateAlternatives: Array<{
        template: ScientificPlottingTemplate
        reason: string
      }>
      requiredInputs: string[]
      styleInputs: string[]
      controlledTool: string
      planningWarnings: string[]
      guardrails: string[]
      skillHints: {
        recommendedSkills: string[]
        recommendedLibraries: string[]
      }
    }
  | { ok: false; message: string }

export type ScientificPlottingStatusResult =
  | {
      ok: true
      serverName: 'scientific_plotting'
      version: string
      renderer: {
        kind: 'matplotlib'
        pythonCommand: string
        available: boolean
        version?: string
        message?: string
      }
      referencePreparation: {
        imageCrop: true
        pdfCrop: {
          available: boolean
          command: string
          message?: string
        }
        defaultRelativeDir: '.sciforge/figure-references'
      }
      reviewPackets: {
        defaultRelativeDir: '.sciforge/figure-reviews'
        readsRenderManifests: true
        writesMarkdownAndJson: true
      }
      styleProfiles: {
        builtIn: number
        acceptsStyleProfileId: true
        defaultProfileIds: string[]
      }
      supportedTemplates: ScientificPlottingTemplate[]
      templateGuides: ScientificPlottingTemplateGuide[]
      outputPolicy: {
        defaultRelativeDir: string
        writesOnlyInsideWorkspace: true
        formats: ['png']
      }
      degraded: boolean
      guardrails: string[]
    }
  | { ok: false; message: string }

export type ScientificPlottingReviewRequest = {
  workspaceRoot: string
  referencePath: string
  outputPath: string
  template?: ScientificPlottingTemplate
  minOverall?: number
}

export type ScientificPlottingReviewResult =
  | (Extract<VisualStyleReviewResult, { ok: true }> & {
      template?: ScientificPlottingTemplate
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
    })
  | Extract<VisualStyleReviewResult, { ok: false }>

export type ScientificPlottingReviewPacketRequest = {
  workspaceRoot: string
  manifestPaths: string[]
  packetId?: string
  outputDir?: string
  title?: string
  maxItems?: number
}

export type ScientificPlottingReviewPacketItem = {
  manifestPath: string
  outputPath: string
  template: ScientificPlottingTemplate
  status: 'rendered' | 'repaired' | 'review_failed' | 'unknown'
  createdAt?: string
  styleSimilarity?: VisualStyleSimilarityMetric
  styleRepairSuggested: boolean
  repairAttempted: boolean
  attempts: number
  warnings: string[]
  layoutQuality?: NonNullable<ScientificPlottingAttempt['rendererDiagnostics']>['layoutQuality']
  typography?: NonNullable<ScientificPlottingAttempt['rendererDiagnostics']>['typography']
  notes: string[]
  recommendedActions: string[]
}

export type ScientificPlottingReviewPacket = {
  version: 1
  tool: 'scientific_plotting_review_packet'
  createdAt: string
  title: string
  itemCount: number
  items: ScientificPlottingReviewPacketItem[]
  summary: {
    rendered: number
    repaired: number
    reviewFailed: number
    needsAttention: number
    styleRepairSuggested: number
    bestOverall?: number
    worstOverall?: number
    averageOverall?: number
    warnings: string[]
  }
  guardrails: string[]
}

export type ScientificPlottingReviewPacketResult =
  | {
      ok: true
      status: 'created'
      packetPath: string
      packetJsonPath: string
      packet: ScientificPlottingReviewPacket
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_request' | 'invalid_workspace' | 'manifest_read_failed'
      message: string
      warnings?: string[]
    }

export type ScientificPlottingAttempt = {
  attempt: number
  outputPath: string
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

export type ScientificPlottingManifest = {
  version: 1
  renderer: 'sciforge-scientific-plotting-mcp'
  rendererVersion: string
  tool: 'scientific_plotting_render'
  template: ScientificPlottingTemplate
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      createdAt: string
  requestHash: string
  outputPath: string
  visualDocumentId?: string
  threadId?: string
  outputScale?: number
  artifactManifestPath?: string
  styleSpecPath?: string
  referencePath?: string
  attempts: ScientificPlottingAttempt[]
  finalReview?: VisualStyleReviewResult
  warnings: string[]
}

export type ScientificPlottingRenderResult =
  | {
      ok: true
      status: 'rendered' | 'repaired' | 'review_failed'
      outputPath: string
      manifestPath: string
      artifactManifestPath?: string
      attempts: ScientificPlottingAttempt[]
      review?: ScientificPlottingReviewResult
      referenceProfile?: ScientificPlottingReferenceProfile
      templateAdvice?: ScientificPlottingTemplateAdvice
      styleProfileId?: string
      styleProfile?: ScientificPlottingStyleProfileSummary
      warnings: string[]
    }
  | {
      ok: false
      status:
        | 'invalid_request'
        | 'invalid_workspace'
        | 'diagram_requires_image_generation'
        | 'renderer_unavailable'
        | 'render_failed'
        | 'review_failed'
      message: string
      draftHandoff?: ScientificPlottingDraftHandoff
      stdoutTail?: string
      stderrTail?: string
      warnings?: string[]
    }
