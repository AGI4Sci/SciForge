import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type {
  FigureStyleSourceType,
  FigureStyleSpec,
  MatplotlibStyleAdapter,
  VisualStyleExtractDiagnostics,
  VisualStyleExtractRequest,
  VisualStyleExtractResult,
  VisualStyleProfile,
  VisualStyleRepairSuggestion,
  VisualStyleReviewIssue,
  VisualStyleReviewRequest,
  VisualStyleReviewResult,
  VisualStyleSimilarityMetric,
  VisualStyleSimilarityRequest,
  VisualStyleSimilarityResult
} from './types'
import { extensionFromName, resolveOpenTargetPath } from './workspace-paths'

type Rgb = {
  r: number
  g: number
  b: number
}

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type PixelPoint = {
  x: number
  y: number
  color: Rgb
}

type PixelSample = {
  points: PixelPoint[]
  colors: Rgb[]
  borderColors: Rgb[]
  width: number
  height: number
  transparentRatio: number
}

type PixelAnalysis = {
  background: Rgb
  palette: Rgb[]
  ink: Rgb
  foregroundBounds: Bounds
  foregroundRatio: number
  darkPixelRatio: number
  chromaRatio: number
  gridScore: number
  gridColor: Rgb
  axisScore: number
  diagnostics: VisualStyleExtractDiagnostics
}

const MAX_STYLE_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_ANALYSIS_DIMENSION = 900
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])

export async function extractVisualStyleProfile(
  request: VisualStyleExtractRequest
): Promise<VisualStyleExtractResult> {
  try {
    const sourcePath = await resolveOpenTargetPath(request.sourcePath, request.workspaceRoot, {
      allowBasenameFallback: true
    })
    const sourceType = inferSourceType(sourcePath, request.sourceType)
    if (sourceType === 'pdf') {
      return {
        ok: false,
        message: 'PDF figure style extraction is not enabled in v1.3. Export or crop the target figure as an image first.'
      }
    }
    const info = await stat(sourcePath)
    if (info.isDirectory()) return { ok: false, message: 'Figure style source must be an image file.' }
    if (info.size > MAX_STYLE_IMAGE_BYTES) return { ok: false, message: 'Figure style source image is too large.' }
    const ext = extensionFromName(sourcePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return { ok: false, message: `Unsupported figure style image type: ${ext || '(none)'}.` }
    }

    const sample = await loadPixelSample(sourcePath)
    const analysis = analyzePixelSample(sample)
    const plotStyle = buildFigureStyleSpec({
      request,
      sourcePath,
      sourceType,
      sample,
      analysis
    })

    return {
      ok: true,
      profile: buildVisualStyleProfile(plotStyle, request),
      diagnostics: analysis.diagnostics
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function evaluateVisualStyleSimilarity(
  request: VisualStyleSimilarityRequest
): Promise<VisualStyleSimilarityResult> {
  try {
    const referencePath = await resolveStyleImagePath(request.referencePath, request.workspaceRoot)
    const outputPath = await resolveStyleImagePath(request.outputPath, request.workspaceRoot)
    const reference = await analyzeStyleImage(referencePath)
    const output = await analyzeStyleImage(outputPath)
    return {
      ok: true,
      metric: compareFigureStyleAnalyses(reference, output),
      diagnostics: {
        reference: reference.analysis.diagnostics,
        output: output.analysis.diagnostics
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function reviewVisualStyleSimilarity(
  request: VisualStyleReviewRequest
): Promise<VisualStyleReviewResult> {
  try {
    const referencePath = await resolveStyleImagePath(request.referencePath, request.workspaceRoot)
    const outputPath = await resolveStyleImagePath(request.outputPath, request.workspaceRoot)
    const reference = await analyzeStyleImage(referencePath)
    const output = await analyzeStyleImage(outputPath)
    const referencePlotStyle = buildFigureStyleSpec({
      request: {
        workspaceRoot: request.workspaceRoot,
        sourcePath: request.referencePath,
        sourceType: 'image',
        figureId: 'style-review-reference'
      },
      sourcePath: referencePath,
      sourceType: 'image',
      sample: reference.sample,
      analysis: reference.analysis
    })
    const referenceProfile = buildVisualStyleProfile(referencePlotStyle, {
      workspaceRoot: request.workspaceRoot,
      sourcePath: request.referencePath,
      sourceKind: 'reference'
    })
    const metric = compareFigureStyleAnalyses(reference, output)
    const issues = buildVisualStyleReviewIssues(metric, reference.analysis, output.analysis)
    const repairSuggestion = buildAutoRepairPlan(referenceProfile, metric, issues)

    return {
      ok: true,
      metric,
      issues,
      repairSuggestion,
      diagnostics: {
        reference: reference.analysis.diagnostics,
        output: output.analysis.diagnostics
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function buildMatplotlibStyleAdapter(profile: VisualStyleProfile): MatplotlibStyleAdapter {
  return buildMatplotlibStyleAdapterFromFigureStyleSpec(figureStyleSpecFromVisualStyleProfile(profile))
}

export function buildMatplotlibStyleAdapterFromFigureStyleSpec(
  styleSpec: FigureStyleSpec
): MatplotlibStyleAdapter {
  return {
    rcParams: {
        'figure.facecolor': styleSpec.canvas.background,
        'axes.facecolor': styleSpec.canvas.background,
        'axes.edgecolor': styleSpec.palette.ink,
        'axes.linewidth': Math.max(0.6, Number((styleSpec.marks.lineWidth * 0.9).toFixed(2))),
        'axes.axisbelow': true,
        'axes.grid': styleSpec.axes.grid,
        'grid.color': styleSpec.axes.gridColor,
        'grid.alpha': styleSpec.axes.gridAlpha,
        'grid.linewidth': styleSpec.axes.gridLineWidth,
        'grid.linestyle': '-',
        'axes.spines.left': styleSpec.axes.spine !== 'none',
        'axes.spines.bottom': styleSpec.axes.spine !== 'none',
        'axes.spines.top': styleSpec.axes.spine === 'box',
        'axes.spines.right': styleSpec.axes.spine === 'box',
        'font.family': styleSpec.typography.fontFamily,
        'font.size': styleSpec.typography.labelSize,
        'text.color': styleSpec.palette.ink,
        'axes.labelcolor': styleSpec.palette.ink,
        'axes.labelsize': styleSpec.typography.labelSize,
        'axes.titlesize': styleSpec.typography.titleSize,
        'xtick.color': styleSpec.palette.ink,
        'ytick.color': styleSpec.palette.ink,
        'xtick.labelsize': styleSpec.typography.axisSize,
        'ytick.labelsize': styleSpec.typography.axisSize,
        'xtick.direction': tickDirectionForMatplotlib(styleSpec.axes.tickDirection),
        'ytick.direction': tickDirectionForMatplotlib(styleSpec.axes.tickDirection),
        'xtick.major.width': tickWidthForStyle(styleSpec),
        'ytick.major.width': tickWidthForStyle(styleSpec),
        'xtick.major.size': tickSizeForStyle(styleSpec),
        'ytick.major.size': tickSizeForStyle(styleSpec),
        'lines.linewidth': styleSpec.marks.lineWidth,
        'lines.markersize': styleSpec.marks.markerSize,
        'errorbar.capsize': errorbarCapsizeForStyle(styleSpec),
        'legend.frameon': styleSpec.annotations.legend === 'boxed',
        'legend.fontsize': styleSpec.typography.axisSize,
        'legend.facecolor': styleSpec.canvas.background,
        'legend.edgecolor': styleSpec.palette.ink,
        'savefig.dpi': styleSpec.export.dpi,
        'savefig.facecolor': styleSpec.canvas.background,
        'savefig.transparent': styleSpec.export.transparent
    },
    palette: styleSpec.palette.accent.length > 0 ? styleSpec.palette.accent : styleSpec.palette.colors,
    layoutNotes: [
        `Use ${styleSpec.layout.panelGrid} panel layout unless the target data requires a different grid.`,
        `Approximate margins as left=${styleSpec.layout.margin.left}, right=${styleSpec.layout.margin.right}, top=${styleSpec.layout.margin.top}, bottom=${styleSpec.layout.margin.bottom}.`,
        `Use ${styleSpec.axes.spine} axes and ${styleSpec.layout.gutter} gutters.`
    ]
  }
}

async function resolveStyleImagePath(rawPath: string, workspaceRoot: string): Promise<string> {
  const sourcePath = await resolveOpenTargetPath(rawPath, workspaceRoot, {
    allowBasenameFallback: true
  })
  const info = await stat(sourcePath)
  if (info.isDirectory()) throw new Error('Figure style source must be an image file.')
  if (info.size > MAX_STYLE_IMAGE_BYTES) throw new Error('Figure style source image is too large.')
  const ext = extensionFromName(sourcePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported figure style image type: ${ext || '(none)'}.`)
  }
  return sourcePath
}

async function analyzeStyleImage(sourcePath: string): Promise<{ sample: PixelSample; analysis: PixelAnalysis }> {
  const sample = await loadPixelSample(sourcePath)
  return {
    sample,
    analysis: analyzePixelSample(sample)
  }
}

function inferSourceType(path: string, explicit?: FigureStyleSourceType): FigureStyleSourceType {
  if (explicit) return explicit
  return extensionFromName(path).toLowerCase() === '.pdf' ? 'pdf' : 'image'
}

async function loadPixelSample(sourcePath: string): Promise<PixelSample> {
  const image = await loadImage(sourcePath)
  const scale = Math.min(1, MAX_ANALYSIS_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const rawCanvas = createCanvas(width, height)
  const rawContext = rawCanvas.getContext('2d')
  rawContext.drawImage(image, 0, 0, width, height)
  let data = rawContext.getImageData(0, 0, width, height).data
  const transparency = inferTransparencyMatte(data)
  if (transparency) {
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.fillStyle = rgbToHex(transparency.matte)
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    data = context.getImageData(0, 0, width, height).data
  }
  const points: PixelPoint[] = []
  const colors: Rgb[] = []
  const borderColors: Rgb[] = []
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 70_000)))
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.04))
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const index = (y * width + x) * 4
      const alpha = data[index + 3] ?? 255
      if (alpha < 12) continue
      const color = {
        r: data[index] ?? 0,
        g: data[index + 1] ?? 0,
        b: data[index + 2] ?? 0
      }
      points.push({ x, y, color })
      colors.push(color)
      if (x < border || y < border || x >= width - border || y >= height - border) {
        borderColors.push(color)
      }
    }
  }
  return { points, colors, borderColors, width, height, transparentRatio: transparency?.ratio ?? 0 }
}

function analyzePixelSample(sample: PixelSample): PixelAnalysis {
  const background = dominantColor(sample.borderColors.length > 20 ? sample.borderColors : sample.colors)
  const foreground = sample.colors.filter((color) => colorDistance(color, background) > 28)
  const darkPixels = sample.colors.filter((color) => luminance(color) < 95)
  const chromaPixels = foreground.filter((color) => chroma(color) > 28)
  const palette = dominantPalette(foreground, background)
  const ink = darkPixels.length > 0 ? dominantColor(darkPixels) : { r: 32, g: 32, b: 32 }
  const foregroundBounds = estimateForegroundBounds(sample, background)
  const foregroundRatio = safeRatio(foreground.length, sample.colors.length)
  const darkPixelRatio = safeRatio(darkPixels.length, sample.colors.length)
  const chromaRatio = safeRatio(chromaPixels.length, sample.colors.length)
  const gridPixels = gridLikeColors(sample, background)
  const gridScore = safeRatio(gridPixels.length, sample.colors.length)
  const gridColor = gridPixels.length > 0 ? dominantColor(gridPixels) : mixColors(background, ink, 0.12)
  const axisScore = estimateAxisScore(sample, background)
  const warnings: string[] = []
  if (sample.width < 240 || sample.height < 180) {
    warnings.push('Reference image is small; typography and line-width estimates may be noisy.')
  }
  if (sample.transparentRatio > 0.35) {
    warnings.push('Transparent reference image was composited before style sampling.')
  }
  if (foregroundRatio < 0.015) {
    warnings.push('Very little foreground was detected; crop the figure panel more tightly if the style looks weak.')
  }

  return {
    background,
    palette,
    ink,
    foregroundBounds,
    foregroundRatio,
    darkPixelRatio,
    chromaRatio,
    gridScore,
    gridColor,
    axisScore,
    diagnostics: {
      analyzedAt: new Date().toISOString(),
      sampledPixels: sample.colors.length,
      foregroundRatio: Number(foregroundRatio.toFixed(4)),
      darkPixelRatio: Number(darkPixelRatio.toFixed(4)),
      chromaRatio: Number(chromaRatio.toFixed(4)),
      warnings
    }
  }
}

function buildFigureStyleSpec(input: {
  request: VisualStyleExtractRequest
  sourcePath: string
  sourceType: FigureStyleSourceType
  sample: PixelSample
  analysis: ReturnType<typeof analyzePixelSample>
}): FigureStyleSpec {
  const { request, sourcePath, sourceType, sample, analysis } = input
  const margin = marginRatios(analysis.foregroundBounds, sample.width, sample.height)
  const paletteColors = uniqueHexColors(analysis.palette.map(rgbToHex)).slice(0, 8)
  const inkHex = rgbToHex(analysis.ink)
  const accentCandidates = uniqueHexColors(
    analysis.palette
      .filter((color) => isLikelyAccentColor(color, analysis.background, analysis.ink))
      .map(rgbToHex)
  )
  const fallbackAccent = paletteColors.filter((color) => color.toLowerCase() !== inkHex.toLowerCase())
  const accent = (accentCandidates.length > 0 ? accentCandidates : fallbackAccent).slice(0, 6)
  const colorMode = accent.length <= 1
    ? 'monochrome'
    : accent.length <= 4
      ? 'limited'
      : 'multi-hue'
  const grid = analysis.gridScore > 0.012
  const gridTone = grid ? (analysis.gridScore > 0.035 ? 'medium' : 'light') : 'none'
  const spine = analysis.axisScore > 0.035
    ? 'left-bottom'
    : analysis.darkPixelRatio > 0.06
      ? 'box'
      : 'minimal'

  return {
    version: 1,
    source: {
      path: sourcePath,
      type: sourceType,
      ...(request.figureId?.trim() ? { figureId: request.figureId.trim() } : {}),
      ...(request.notes?.trim() ? { notes: request.notes.trim() } : {})
    },
    canvas: {
      width: sample.width,
      height: sample.height,
      aspectRatio: Number((sample.width / sample.height).toFixed(3)),
      background: rgbToHex(analysis.background)
    },
    palette: {
      colors: paletteColors.length > 0 ? paletteColors : [rgbToHex(analysis.ink)],
      background: rgbToHex(analysis.background),
      ink: inkHex,
      accent,
      colorMode
    },
    typography: {
      fontFamily: 'sans-serif',
      axisSize: inferAxisFontSize(sample),
      labelSize: inferAxisFontSize(sample) + 1,
      titleSize: inferAxisFontSize(sample) + 3,
      weight: analysis.darkPixelRatio > 0.08 ? 'medium' : 'regular'
    },
    layout: {
      panelGrid: '1x1',
      panelLabels: 'unknown',
      margin,
      gutter: margin.left + margin.right + margin.top + margin.bottom < 0.36 ? 'compact' : 'balanced'
    },
    axes: {
      spine,
      tickDirection: spine === 'minimal' ? 'none' : 'out',
      grid,
      gridTone,
      gridColor: grid ? rgbToHex(analysis.gridColor) : rgbToHex(analysis.background),
      gridAlpha: gridAlphaForTone(gridTone),
      gridLineWidth: gridLineWidthForTone(gridTone, inferLineWidth(analysis.darkPixelRatio, sample))
    },
    marks: {
      lineWidth: inferLineWidth(analysis.darkPixelRatio, sample),
      markerSize: inferMarkerSize(analysis.foregroundRatio, sample),
      errorBarStyle: 'unknown',
      density: analysis.foregroundRatio > 0.18 ? 'dense' : analysis.foregroundRatio > 0.06 ? 'balanced' : 'sparse'
    },
    annotations: {
      significance: 'unknown',
      legend: inferLegend(sample, analysis)
    },
    export: {
      formats: ['pdf', 'svg', 'png'],
      dpi: 300,
      transparent: false
    },
    confidence: {
      overall: confidenceScore(analysis.foregroundRatio, sample),
      palette: Math.min(0.95, 0.55 + Math.min(analysis.chromaRatio * 2.2, 0.35)),
      layout: Math.min(0.9, 0.5 + Math.min(analysis.foregroundRatio * 1.6, 0.35)),
      axes: Math.min(0.9, 0.45 + analysis.axisScore),
      typography: 0.35
    }
  }
}

function buildVisualStyleProfile(
  plotStyle: FigureStyleSpec,
  request: VisualStyleExtractRequest
): VisualStyleProfile {
  const source = request.sourceKind === 'current'
    ? {
        type: 'current' as const,
        artifactPath: plotStyle.source.path
      }
    : {
        type: 'reference' as const,
        path: plotStyle.source.path,
        ...(request.figureId?.trim() ? { figureId: request.figureId.trim() } : {}),
        ...(request.notes?.trim() ? { notes: request.notes.trim() } : {})
      }
  const tokens: VisualStyleProfile['tokens'] = {
    canvas: plotStyle.canvas,
    palette: plotStyle.palette,
    typography: plotStyle.typography,
    strokes: {
      ink: plotStyle.palette.ink,
      primaryWidth: plotStyle.marks.lineWidth,
      secondaryWidth: plotStyle.axes.gridLineWidth,
      lineCap: 'unknown'
    },
    spacing: {
      margin: plotStyle.layout.margin,
      gutter: plotStyle.layout.gutter,
      density: plotStyle.marks.density
    },
    shapes: {
      fillMode: 'unknown',
      borderWidth: plotStyle.marks.lineWidth,
      shadow: 'unknown'
    },
    plots: {
      panelGrid: plotStyle.layout.panelGrid,
      panelLabels: plotStyle.layout.panelLabels,
      axes: plotStyle.axes,
      marks: plotStyle.marks,
      annotations: plotStyle.annotations,
      export: plotStyle.export
    },
    generatedAssets: {
      visualTreatment: 'unknown',
      backgroundTreatment: plotStyle.export.transparent ? 'transparent' : 'solid',
      edgeTreatment: 'unknown',
      detailLevel: plotStyle.marks.density === 'dense' ? 'rich' : plotStyle.marks.density
    }
  }
  const id = `visual-style-${createHash('sha256')
    .update(JSON.stringify(tokens))
    .digest('hex')
    .slice(0, 12)}`
  return {
    version: 1,
    id,
    scope: request.scope ?? 'artifact',
    source,
    tokens,
    semanticDescription: describeVisualStyle(tokens),
    confidence: {
      overall: plotStyle.confidence.overall,
      palette: plotStyle.confidence.palette,
      spacing: plotStyle.confidence.layout,
      plots: plotStyle.confidence.axes,
      typography: plotStyle.confidence.typography,
      generatedAssets: 0
    }
  }
}

function describeVisualStyle(tokens: VisualStyleProfile['tokens']): string {
  const background = tokens.canvas.background.toLowerCase()
  const plotSummary = tokens.plots
    ? `${tokens.plots.axes.spine} axes, ${tokens.plots.axes.gridTone} grid, ${tokens.plots.marks.density} marks`
    : 'no plot-specific treatment'
  return [
    `${tokens.palette.colorMode} palette on ${background} canvas`,
    `${tokens.spacing.gutter} spacing with ${tokens.spacing.density} visual density`,
    `${tokens.typography.weight} ${tokens.typography.fontFamily} typography`,
    plotSummary
  ].join('; ')
}

export function figureStyleSpecFromVisualStyleProfile(profile: VisualStyleProfile): FigureStyleSpec {
  const { tokens } = profile
  const plots = tokens.plots
  const sourcePath = profile.source.type === 'reference'
    ? profile.source.path
    : profile.source.type === 'current' && profile.source.artifactPath
      ? profile.source.artifactPath
      : `visual-style-profile:${profile.id}`
  return {
    version: 1,
    source: {
      path: sourcePath,
      type: 'image',
      ...(profile.source.type === 'reference' && profile.source.figureId
        ? { figureId: profile.source.figureId }
        : {}),
      ...(profile.source.type === 'reference' && profile.source.notes
        ? { notes: profile.source.notes }
        : {})
    },
    canvas: tokens.canvas,
    palette: tokens.palette,
    typography: tokens.typography,
    layout: {
      panelGrid: plots?.panelGrid ?? '1x1',
      panelLabels: plots?.panelLabels ?? 'unknown',
      margin: tokens.spacing.margin,
      gutter: tokens.spacing.gutter
    },
    axes: plots?.axes ?? {
      spine: 'minimal',
      tickDirection: 'out',
      grid: false,
      gridTone: 'none',
      gridColor: tokens.canvas.background,
      gridAlpha: 0,
      gridLineWidth: tokens.strokes.secondaryWidth
    },
    marks: plots?.marks ?? {
      lineWidth: tokens.strokes.primaryWidth,
      markerSize: Math.max(2.4, tokens.strokes.primaryWidth * 2.5),
      errorBarStyle: 'unknown',
      density: tokens.spacing.density
    },
    annotations: plots?.annotations ?? {
      significance: 'unknown',
      legend: 'unknown'
    },
    export: plots?.export ?? {
      formats: ['pdf', 'svg', 'png'],
      dpi: 300,
      transparent: false
    },
    confidence: {
      overall: profile.confidence.overall,
      palette: profile.confidence.palette,
      layout: profile.confidence.spacing,
      axes: profile.confidence.plots,
      typography: profile.confidence.typography
    }
  }
}

function dominantColor(colors: Rgb[]): Rgb {
  const buckets = new Map<string, { color: Rgb; count: number }>()
  for (const color of colors) {
    const quantized = quantizeColor(color, 16)
    const key = `${quantized.r},${quantized.g},${quantized.b}`
    const current = buckets.get(key)
    if (current) current.count += 1
    else buckets.set(key, { color: quantized, count: 1 })
  }
  return [...buckets.values()].sort((left, right) => right.count - left.count)[0]?.color ?? { r: 255, g: 255, b: 255 }
}

function dominantPalette(colors: Rgb[], background: Rgb): Rgb[] {
  const buckets = new Map<string, { color: Rgb; count: number; chroma: number }>()
  for (const color of colors) {
    if (colorDistance(color, background) < 28) continue
    if (luminance(color) > 242 && chroma(color) < 16) continue
    const quantized = quantizeColor(color, 24)
    const key = `${quantized.r},${quantized.g},${quantized.b}`
    const current = buckets.get(key)
    if (current) current.count += 1
    else buckets.set(key, { color: quantized, count: 1, chroma: chroma(quantized) })
  }
  return [...buckets.values()]
    .sort((left, right) => right.count + right.chroma * 0.2 - (left.count + left.chroma * 0.2))
    .map((bucket) => bucket.color)
    .slice(0, 10)
}

function isLikelyAccentColor(color: Rgb, background: Rgb, ink: Rgb): boolean {
  if (isNearWhite(color)) return false
  if (colorDistance(color, background) < 52) return false
  if (colorDistance(color, ink) < 18) return false
  if (chroma(color) >= 36) return true
  return luminance(color) < 135 && colorDistance(color, background) > 70
}

function estimateForegroundBounds(sample: PixelSample, background: Rgb): Bounds {
  const syntheticWidth = Math.max(1, sample.width)
  const syntheticHeight = Math.max(1, sample.height)
  const bounds: Bounds = {
    minX: syntheticWidth - 1,
    minY: syntheticHeight - 1,
    maxX: 0,
    maxY: 0
  }
  for (const point of sample.points) {
    if (colorDistance(point.color, background) <= 28) continue
    bounds.minX = Math.min(bounds.minX, point.x)
    bounds.minY = Math.min(bounds.minY, point.y)
    bounds.maxX = Math.max(bounds.maxX, point.x)
    bounds.maxY = Math.max(bounds.maxY, point.y)
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    return { minX: 0, minY: 0, maxX: syntheticWidth - 1, maxY: syntheticHeight - 1 }
  }
  return bounds
}

function gridLikeColors(sample: PixelSample, background: Rgb): Rgb[] {
  return sample.colors.filter((color) =>
    colorDistance(color, background) > 14 &&
    colorDistance(color, background) < 96 &&
    luminance(color) > 132 &&
    chroma(color) < 34
  )
}

function inferTransparencyMatte(data: Uint8ClampedArray): { matte: Rgb; ratio: number } | null {
  let transparentCount = 0
  let red = 0
  let green = 0
  let blue = 0
  const totalPixels = data.length / 4
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] ?? 255
    if (alpha >= 12) continue
    transparentCount += 1
    red += data[index] ?? 0
    green += data[index + 1] ?? 0
    blue += data[index + 2] ?? 0
  }
  const ratio = safeRatio(transparentCount, totalPixels)
  if (ratio < 0.35 || transparentCount === 0) return null
  const transparentRgb = {
    r: red / transparentCount,
    g: green / transparentCount,
    b: blue / transparentCount
  }
  return {
    matte: luminance(transparentRgb) < 128 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
    ratio: Number(ratio.toFixed(4))
  }
}

function estimateAxisScore(sample: PixelSample, background: Rgb): number {
  const darkForeground = sample.colors.filter((color) =>
    colorDistance(color, background) > 40 && luminance(color) < 120
  )
  return Math.min(0.6, safeRatio(darkForeground.length, sample.colors.length) * 5)
}

function marginRatios(bounds: Bounds, width: number, height: number): FigureStyleSpec['layout']['margin'] {
  return {
    left: Number((bounds.minX / width).toFixed(3)),
    right: Number(((width - bounds.maxX - 1) / width).toFixed(3)),
    top: Number((bounds.minY / height).toFixed(3)),
    bottom: Number(((height - bounds.maxY - 1) / height).toFixed(3))
  }
}

function inferAxisFontSize(sample: PixelSample): number {
  return Math.min(sample.width, sample.height) < 360 ? 7 : 8
}

function inferLineWidth(darkPixelRatio: number, sample: PixelSample): number {
  const scale = Math.min(sample.width, sample.height) / 480
  const width = 0.75 + darkPixelRatio * 3.2 + scale * 0.25
  return Number(clamp(width, 0.8, 1.6).toFixed(1))
}

function inferMarkerSize(foregroundRatio: number, sample: PixelSample): number {
  const base = Math.min(sample.width, sample.height) / 120
  const size = base + (foregroundRatio > 0.12 ? -0.8 : 0.1)
  return Number(clamp(size, 2.4, 3.8).toFixed(1))
}

function gridAlphaForTone(tone: FigureStyleSpec['axes']['gridTone']): number {
  if (tone === 'medium') return 0.72
  if (tone === 'light') return 0.52
  return 0
}

function gridLineWidthForTone(
  tone: FigureStyleSpec['axes']['gridTone'],
  markLineWidth: number
): number {
  if (tone === 'medium') return Number(clamp(markLineWidth * 0.42, 0.45, 0.7).toFixed(2))
  if (tone === 'light') return Number(clamp(markLineWidth * 0.32, 0.32, 0.55).toFixed(2))
  return 0
}

function tickDirectionForMatplotlib(direction: FigureStyleSpec['axes']['tickDirection']): string {
  if (direction === 'in') return 'in'
  return 'out'
}

function tickWidthForStyle(styleSpec: FigureStyleSpec): number {
  if (styleSpec.axes.tickDirection === 'none') return 0
  return Number(clamp(styleSpec.marks.lineWidth * 0.65, 0.45, 0.9).toFixed(2))
}

function tickSizeForStyle(styleSpec: FigureStyleSpec): number {
  if (styleSpec.axes.tickDirection === 'none') return 0
  return styleSpec.axes.spine === 'box' ? 3 : 2.5
}

function errorbarCapsizeForStyle(styleSpec: FigureStyleSpec): number {
  if (styleSpec.marks.errorBarStyle === 'none') return 0
  return Number(clamp(styleSpec.marks.markerSize * 0.7, 1.6, 2.8).toFixed(1))
}

function inferLegend(sample: PixelSample, analysis: ReturnType<typeof analyzePixelSample>): FigureStyleSpec['annotations']['legend'] {
  const hasWhitespace = isNearWhite(analysis.background)
  if (analysis.palette.length >= 3 && sample.width / sample.height > 1.15) return hasWhitespace ? 'frameless' : 'unknown'
  return 'unknown'
}

function confidenceScore(foregroundRatio: number, sample: PixelSample): number {
  const sizeBoost = Math.min(0.2, Math.min(sample.width, sample.height) / 2000)
  return Number(clamp(0.48 + foregroundRatio * 1.6 + sizeBoost, 0.35, 0.88).toFixed(2))
}

function compareFigureStyleAnalyses(
  reference: { sample: PixelSample; analysis: PixelAnalysis },
  output: { sample: PixelSample; analysis: PixelAnalysis }
): VisualStyleSimilarityMetric {
  const background = colorSimilarity(reference.analysis.background, output.analysis.background, 110)
  const palette = paletteSimilarity(reference.analysis, output.analysis)
  const axes = normalizedDifferenceScore(reference.analysis.axisScore, output.analysis.axisScore, 0.18)
  const grid = gridSimilarity(reference.analysis, output.analysis)
  const layout = layoutSimilarity(reference, output)
  const marks = marksSimilarity(reference.analysis, output.analysis)
  const typography = typographySimilarity(reference, output)
  const overall = weightedScore([
    [palette, 0.25],
    [background, 0.15],
    [axes, 0.15],
    [grid, 0.13],
    [layout, 0.13],
    [marks, 0.09],
    [typography, 0.1]
  ])
  const warnings: string[] = []
  if (palette < 0.68) warnings.push('Primary palette differs from the reference figure.')
  if (background < 0.72) warnings.push('Canvas or axes background differs from the reference figure.')
  if (axes < 0.62) warnings.push('Axis/spine darkness does not match the reference figure.')
  if (grid < 0.62) warnings.push('Grid visibility differs from the reference figure.')
  if (layout < 0.62) warnings.push('Plot aspect ratio or margins differ from the reference figure.')
  if (marks < 0.62) warnings.push('Foreground mark density differs from the reference figure.')
  if (typography < 0.62) warnings.push('Typography weight or label-area density differs from the reference figure.')
  return {
    overall,
    palette,
    background,
    axes,
    grid,
    layout,
    marks,
    typography,
    warnings
  }
}

function buildVisualStyleReviewIssues(
  score: VisualStyleSimilarityMetric,
  reference: PixelAnalysis,
  output: PixelAnalysis
): VisualStyleReviewIssue[] {
  const issues: VisualStyleReviewIssue[] = []
  if (score.background < 0.72) {
    issues.push({
      id: 'background',
      severity: score.background < 0.45 ? 'error' : 'warning',
      metric: 'background',
      score: score.background,
      message: 'Canvas or axes background differs from the reference; rerender with the reference facecolor.',
      autoRepairable: true
    })
  }
  if (score.palette < 0.68) {
    issues.push({
      id: 'palette',
      severity: score.palette < 0.45 ? 'error' : 'warning',
      metric: 'palette',
      score: score.palette,
      message: 'Primary palette differs from the reference; rerender with the extracted accent palette.',
      autoRepairable: true
    })
  }
  if (score.axes < 0.62) {
    issues.push({
      id: 'axes',
      severity: 'warning',
      metric: 'axes',
      score: score.axes,
      message: 'Axis or spine darkness differs from the reference; rerender with the extracted ink color and spine style.',
      autoRepairable: true
    })
  }
  if (score.grid < 0.62) {
    issues.push({
      id: 'grid',
      severity: 'warning',
      metric: 'grid',
      score: score.grid,
      message: 'Grid visibility differs from the reference; rerender with the extracted grid color, alpha and line width.',
      autoRepairable: true
    })
  }
  if (score.layout < 0.62) {
    issues.push({
      id: 'layout',
      severity: 'warning',
      metric: 'layout',
      score: score.layout,
      message: 'Plot aspect ratio or margins differ from the reference; rerender with adjusted figure size, constrained layout and saved bbox.',
      autoRepairable: true
    })
  }
  if (score.marks < 0.62) {
    issues.push({
      id: 'marks',
      severity: 'warning',
      metric: 'marks',
      score: score.marks,
      message: 'Foreground mark density differs from the reference; tune line width, marker size or alpha without changing data values.',
      autoRepairable: false
    })
  }
  if ((score.typography ?? 1) < 0.62) {
    issues.push({
      id: 'typography',
      severity: 'warning',
      metric: 'typography',
      score: score.typography,
      message: 'Typography appears too heavy or too large relative to the reference; rerender with conservative publication font sizes.',
      autoRepairable: true
    })
  }
  for (const warning of [...reference.diagnostics.warnings, ...output.diagnostics.warnings]) {
    issues.push({
      id: 'diagnostics',
      severity: 'info',
      message: warning,
      autoRepairable: false
    })
  }
  return issues
}

function buildAutoRepairPlan(
  referenceProfile: VisualStyleProfile,
  score: VisualStyleSimilarityMetric,
  issues: VisualStyleReviewIssue[]
): VisualStyleRepairSuggestion {
  const referenceSpec = figureStyleSpecFromVisualStyleProfile(referenceProfile)
  const referenceAdapter = buildMatplotlibStyleAdapter(referenceProfile)
  const referenceRc = referenceAdapter.rcParams
  const rcParamsPatch: Record<string, string | number | boolean> = {}
  const palette = referenceAdapter.palette
  const issueIds = new Set(issues.filter((issue) => issue.autoRepairable).map((issue) => issue.id))

  const copyKeys = (keys: string[]): void => {
    for (const key of keys) {
      const value = referenceRc[key]
      if (value !== undefined) rcParamsPatch[key] = value
    }
  }

  if (issueIds.has('background')) {
    copyKeys([
      'figure.facecolor',
      'axes.facecolor',
      'savefig.facecolor',
      'savefig.transparent'
    ])
  }
  if (issueIds.has('palette')) {
    copyKeys([
      'text.color',
      'axes.labelcolor',
      'xtick.color',
      'ytick.color'
    ])
  }
  if (issueIds.has('axes')) {
    copyKeys([
      'axes.edgecolor',
      'axes.linewidth',
      'axes.spines.left',
      'axes.spines.bottom',
      'axes.spines.top',
      'axes.spines.right',
      'xtick.direction',
      'ytick.direction',
      'xtick.major.width',
      'ytick.major.width',
      'xtick.major.size',
      'ytick.major.size'
    ])
  }
  if (issueIds.has('grid')) {
    copyKeys([
      'axes.axisbelow',
      'axes.grid',
      'grid.color',
      'grid.alpha',
      'grid.linewidth',
      'grid.linestyle'
    ])
  }
  if (issueIds.has('layout')) {
    copyKeys([
      'font.size',
      'axes.labelsize',
      'axes.titlesize',
      'xtick.labelsize',
      'ytick.labelsize',
      'legend.fontsize'
    ])
  }
  if (issueIds.has('typography')) {
    Object.assign(rcParamsPatch, publicationTypographyRepairPatch(referenceRc))
  }

  const shouldRerender = Object.keys(rcParamsPatch).length > 0 || issueIds.has('layout') || issueIds.has('palette')
  return {
    shouldRerender,
    reason: shouldRerender
      ? `Style review found ${issueIds.size} repairable issue(s); rerender once with this patch before showing the final figure.`
      : score.overall >= 0.82
        ? 'Output passes the current style review threshold.'
        : 'Output needs manual review because the remaining mismatch may involve data marks or plot semantics.',
    rcParamsPatch,
    ...(issueIds.has('palette') ? { palette } : {}),
    layoutHints: issueIds.has('layout')
      ? [
          `Match reference aspect ratio ${referenceSpec.canvas.aspectRatio}.`,
          'Use constrained_layout or tight_layout before export.',
          'Save with bbox_inches="tight" and the extracted facecolor.'
        ]
      : issueIds.has('typography')
        ? [
            'Clamp title, axis label, tick and legend sizes to conservative final-print publication ranges.',
            'Prefer compact title padding and tick padding before changing the plotted data region.'
          ]
      : [],
    guardrails: [
      'Do not change source data, statistical calculations, axis labels or units during auto-repair.',
      'Only adjust rendering parameters such as colors, fonts, grid, spine, layout and export options.',
      'Run figure-style review again after rerendering; stop after a small bounded number of attempts.'
    ]
  }
}

function gridSimilarity(reference: PixelAnalysis, output: PixelAnalysis): number {
  const referenceVisible = reference.gridScore > 0.012
  const outputVisible = output.gridScore > 0.012
  if (!referenceVisible && !outputVisible) return 1
  if (referenceVisible !== outputVisible) return 0.22
  return weightedScore([
    [normalizedDifferenceScore(reference.gridScore, output.gridScore, 0.14), 0.58],
    [colorSimilarity(reference.gridColor, output.gridColor, 150), 0.42]
  ])
}

function paletteSimilarity(reference: PixelAnalysis, output: PixelAnalysis): number {
  const referenceAccent = accentColorsForSimilarity(reference)
  const outputAccent = accentColorsForSimilarity(output)
  if (referenceAccent.length === 0 || outputAccent.length === 0) {
    return normalizedDifferenceScore(reference.chromaRatio, output.chromaRatio, 0.08)
  }
  const scores = referenceAccent.map((color) =>
    Math.max(...outputAccent.map((candidate) => colorSimilarity(color, candidate, 180)))
  )
  return Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3))
}

function accentColorsForSimilarity(analysis: PixelAnalysis): Rgb[] {
  const accent = analysis.palette.filter((color) => isLikelyAccentColor(color, analysis.background, analysis.ink))
  return (accent.length > 0 ? accent : analysis.palette).slice(0, 5)
}

function layoutSimilarity(
  reference: { sample: PixelSample; analysis: PixelAnalysis },
  output: { sample: PixelSample; analysis: PixelAnalysis }
): number {
  const referenceMargins = marginRatios(
    reference.analysis.foregroundBounds,
    reference.sample.width,
    reference.sample.height
  )
  const outputMargins = marginRatios(
    output.analysis.foregroundBounds,
    output.sample.width,
    output.sample.height
  )
  const marginScore = average([
    normalizedDifferenceScore(referenceMargins.left, outputMargins.left, 0.22),
    normalizedDifferenceScore(referenceMargins.right, outputMargins.right, 0.22),
    normalizedDifferenceScore(referenceMargins.top, outputMargins.top, 0.22),
    normalizedDifferenceScore(referenceMargins.bottom, outputMargins.bottom, 0.22)
  ])
  const aspectScore = normalizedDifferenceScore(
    reference.sample.width / reference.sample.height,
    output.sample.width / output.sample.height,
    0.55
  )
  return Number((marginScore * 0.7 + aspectScore * 0.3).toFixed(3))
}

function marksSimilarity(reference: PixelAnalysis, output: PixelAnalysis): number {
  return Number(average([
    normalizedDifferenceScore(reference.foregroundRatio, output.foregroundRatio, 0.16),
    normalizedDifferenceScore(reference.darkPixelRatio, output.darkPixelRatio, 0.1),
    normalizedDifferenceScore(reference.chromaRatio, output.chromaRatio, 0.1)
  ]).toFixed(3))
}

function typographySimilarity(
  reference: { sample: PixelSample; analysis: PixelAnalysis },
  output: { sample: PixelSample; analysis: PixelAnalysis }
): number {
  const referencePressure = labelBandInkPressure(reference.sample, reference.analysis)
  const outputPressure = labelBandInkPressure(output.sample, output.analysis)
  const tolerance = Math.max(0.012, referencePressure * 0.9 + 0.01)
  const pressureScore = normalizedDifferenceScore(referencePressure, outputPressure, tolerance)
  const oversizePenalty = outputPressure > Math.max(0.018, referencePressure * 1.55)
    ? clamp(1 - (outputPressure - referencePressure) / Math.max(0.025, referencePressure * 1.8), 0, 1)
    : 1
  return Number(Math.min(pressureScore, oversizePenalty).toFixed(3))
}

function labelBandInkPressure(sample: PixelSample, analysis: PixelAnalysis): number {
  const top = sample.height * 0.18
  const bottom = sample.height * 0.82
  const left = sample.width * 0.18
  const right = sample.width * 0.92
  const labelBandPoints = sample.points.filter((point) =>
    point.y <= top ||
    point.y >= bottom ||
    point.x <= left ||
    point.x >= right
  )
  const inkLike = labelBandPoints.filter((point) =>
    colorDistance(point.color, analysis.background) > 36 &&
    luminance(point.color) < 135 &&
    chroma(point.color) < 96
  )
  return safeRatio(inkLike.length, sample.colors.length)
}

function publicationTypographyRepairPatch(
  referenceRc: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  return {
    'font.size': clampNumberRc(referenceRc['font.size'], 6.8, 6.2, 7.2),
    'axes.labelsize': clampNumberRc(referenceRc['axes.labelsize'], 7, 6.5, 7.2),
    'axes.titlesize': clampNumberRc(referenceRc['axes.titlesize'], 7.6, 6.8, 8.2),
    'xtick.labelsize': clampNumberRc(referenceRc['xtick.labelsize'], 6, 5.6, 6.2),
    'ytick.labelsize': clampNumberRc(referenceRc['ytick.labelsize'], 6, 5.6, 6.2),
    'legend.fontsize': clampNumberRc(referenceRc['legend.fontsize'], 6, 5.6, 6.2)
  }
}

function clampNumberRc(value: string | number | boolean | undefined, fallback: number, low: number, high: number): number {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : Number.NaN
  return Number(clamp(Number.isFinite(number) ? number : fallback, low, high).toFixed(2))
}

function colorSimilarity(left: Rgb, right: Rgb, tolerance: number): number {
  return Number(clamp(1 - colorDistance(left, right) / tolerance, 0, 1).toFixed(3))
}

function normalizedDifferenceScore(left: number, right: number, tolerance: number): number {
  return Number(clamp(1 - Math.abs(left - right) / tolerance, 0, 1).toFixed(3))
}

function weightedScore(entries: Array<[score: number, weight: number]>): number {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0)
  if (totalWeight <= 0) return 0
  const total = entries.reduce((sum, [score, weight]) => sum + score * weight, 0)
  return Number((total / totalWeight).toFixed(3))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantizeColor(color: Rgb, step: number): Rgb {
  return {
    r: clamp(Math.round(color.r / step) * step, 0, 255),
    g: clamp(Math.round(color.g / step) * step, 0, 255),
    b: clamp(Math.round(color.b / step) * step, 0, 255)
  }
}

function rgbToHex(color: Rgb): string {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

function uniqueHexColors(colors: string[]): string[] {
  const seen = new Set<string>()
  return colors.filter((color) => {
    const key = color.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function luminance(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}

function chroma(color: Rgb): number {
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
}

function colorDistance(left: Rgb, right: Rgb): number {
  return Math.sqrt(
    (left.r - right.r) ** 2 +
    (left.g - right.g) ** 2 +
    (left.b - right.b) ** 2
  )
}

function mixColors(left: Rgb, right: Rgb, rightWeight: number): Rgb {
  const weight = clamp(rightWeight, 0, 1)
  return {
    r: Math.round(left.r * (1 - weight) + right.r * weight),
    g: Math.round(left.g * (1 - weight) + right.g * weight),
    b: Math.round(left.b * (1 - weight) + right.b * weight)
  }
}

function isNearWhite(color: Rgb): boolean {
  return luminance(color) > 236 && chroma(color) < 18
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
