export type FigureStyleSourceType = 'image' | 'pdf'

export type FigureStyleExtractRequest = {
  workspaceRoot: string
  sourcePath: string
  sourceType?: FigureStyleSourceType
  figureId?: string
  notes?: string
}

export type FigureStyleSimilarityRequest = {
  workspaceRoot: string
  referencePath: string
  outputPath: string
}

export type FigureStyleReviewRequest = FigureStyleSimilarityRequest & {
  minOverall?: number
}

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

export type FigureStyleExtractDiagnostics = {
  analyzedAt: string
  sampledPixels: number
  foregroundRatio: number
  darkPixelRatio: number
  chromaRatio: number
  warnings: string[]
}

export type FigureStyleExtractResult =
  | {
      ok: true
      spec: FigureStyleSpec
      applyPlan: FigureStyleApplyPlan
      diagnostics: FigureStyleExtractDiagnostics
    }
  | { ok: false; message: string }

export type FigureStyleSimilarityScore = {
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

export type FigureStyleSimilarityResult =
  | {
      ok: true
      score: FigureStyleSimilarityScore
      diagnostics: {
        reference: FigureStyleExtractDiagnostics
        output: FigureStyleExtractDiagnostics
      }
    }
  | { ok: false; message: string }

export type FigureStyleReviewIssue = {
  id: 'background' | 'palette' | 'axes' | 'grid' | 'layout' | 'marks' | 'typography' | 'diagnostics'
  severity: 'info' | 'warning' | 'error'
  metric?: keyof Omit<FigureStyleSimilarityScore, 'warnings'>
  score?: number
  message: string
  autoRepairable: boolean
}

export type FigureStyleAutoRepairPlan = {
  shouldRerender: boolean
  reason: string
  rcParamsPatch: Record<string, string | number | boolean>
  palette?: string[]
  layoutHints: string[]
  guardrails: string[]
}

export type FigureStyleReviewResult =
  | {
      ok: true
      status: 'pass' | 'repairable' | 'manual_review'
      score: FigureStyleSimilarityScore
      issues: FigureStyleReviewIssue[]
      autoRepair: FigureStyleAutoRepairPlan
      diagnostics: {
        reference: FigureStyleExtractDiagnostics
        output: FigureStyleExtractDiagnostics
      }
    }
  | { ok: false; message: string }

export type FigureStyleApplyPlan = {
  styleSpec: FigureStyleSpec
  plottingWorkflow: {
    recommendedSkills: string[]
    recommendedLibraries: string[]
    nextControlledTool: string
    guardrails: string[]
  }
  matplotlibHints: {
    rcParams: Record<string, string | number | boolean>
    palette: string[]
    layoutNotes: string[]
  }
}
