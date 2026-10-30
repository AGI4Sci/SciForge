import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildMatplotlibStyleAdapter,
  evaluateVisualStyleSimilarity,
  extractVisualStyleProfile,
  figureStyleSpecFromVisualStyleProfile,
  reviewVisualStyleSimilarity
} from './visual-style-extractor'

let workspaceRoot = ''

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'figure-style-'))
})

afterEach(() => {
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = ''
})

function writeReferencePlot(path: string): void {
  const canvas = createCanvas(640, 420)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fbfbfa'
  context.fillRect(0, 0, 640, 420)

  context.strokeStyle = '#ddddda'
  context.lineWidth = 1
  for (let x = 140; x <= 560; x += 70) {
    context.beginPath()
    context.moveTo(x, 58)
    context.lineTo(x, 344)
    context.stroke()
  }
  for (let y = 92; y <= 320; y += 38) {
    context.beginPath()
    context.moveTo(78, y)
    context.lineTo(566, y)
    context.stroke()
  }

  context.strokeStyle = '#222222'
  context.lineWidth = 3
  context.beginPath()
  context.moveTo(78, 344)
  context.lineTo(566, 344)
  context.moveTo(78, 58)
  context.lineTo(78, 344)
  context.stroke()

  context.strokeStyle = '#d24b4b'
  context.lineWidth = 4
  context.beginPath()
  context.moveTo(92, 302)
  context.bezierCurveTo(190, 242, 256, 220, 340, 182)
  context.bezierCurveTo(420, 145, 498, 126, 548, 92)
  context.stroke()

  context.strokeStyle = '#2f72b7'
  context.lineWidth = 4
  context.beginPath()
  context.moveTo(92, 268)
  context.bezierCurveTo(178, 210, 260, 232, 338, 160)
  context.bezierCurveTo(430, 76, 500, 120, 548, 136)
  context.stroke()

  context.fillStyle = '#d24b4b'
  for (const [x, y] of [[170, 250], [330, 185], [510, 118]]) {
    context.beginPath()
    context.arc(x, y, 5, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = '#2f72b7'
  for (const [x, y] of [[150, 230], [330, 158], [500, 126]]) {
    context.beginPath()
    context.arc(x, y, 5, 0, Math.PI * 2)
    context.fill()
  }

  writeFileSync(path, canvas.toBuffer('image/png'))
}

function writeDivergentPlot(path: string): void {
  const canvas = createCanvas(640, 420)
  const context = canvas.getContext('2d')
  context.fillStyle = '#171a22'
  context.fillRect(0, 0, 640, 420)

  context.strokeStyle = '#f1c84b'
  context.lineWidth = 7
  context.beginPath()
  context.moveTo(78, 344)
  context.lineTo(566, 344)
  context.moveTo(78, 58)
  context.lineTo(78, 344)
  context.stroke()

  context.strokeStyle = '#76d275'
  context.lineWidth = 8
  context.beginPath()
  context.moveTo(92, 104)
  context.bezierCurveTo(190, 160, 280, 300, 548, 244)
  context.stroke()

  context.fillStyle = '#76d275'
  for (const [x, y] of [[170, 146], [330, 260], [510, 248]]) {
    context.fillRect(x - 9, y - 9, 18, 18)
  }

  writeFileSync(path, canvas.toBuffer('image/png'))
}

function writeOversizedTypographyPlot(path: string): void {
  const canvas = createCanvas(640, 420)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fbfbfa'
  context.fillRect(0, 0, 640, 420)

  context.strokeStyle = '#ddddda'
  context.lineWidth = 1
  for (let y = 92; y <= 320; y += 38) {
    context.beginPath()
    context.moveTo(78, y)
    context.lineTo(566, y)
    context.stroke()
  }

  context.strokeStyle = '#222222'
  context.lineWidth = 3
  context.beginPath()
  context.moveTo(78, 344)
  context.lineTo(566, 344)
  context.moveTo(78, 58)
  context.lineTo(78, 344)
  context.stroke()

  context.strokeStyle = '#d24b4b'
  context.lineWidth = 4
  context.beginPath()
  context.moveTo(92, 302)
  context.bezierCurveTo(190, 242, 256, 220, 340, 182)
  context.bezierCurveTo(420, 145, 498, 126, 548, 92)
  context.stroke()

  context.fillStyle = '#111111'
  context.font = 'bold 44px Arial'
  context.fillText('Oversized title', 118, 48)
  context.font = '36px Arial'
  context.fillText('X label', 272, 408)
  context.save()
  context.translate(32, 266)
  context.rotate(-Math.PI / 2)
  context.fillText('Y label', 0, 0)
  context.restore()

  writeFileSync(path, canvas.toBuffer('image/png'))
}

function writeTransparentAttentionPlot(path: string): void {
  const canvas = createCanvas(420, 220)
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, 420, 220)

  context.strokeStyle = 'rgba(227, 119, 194, 0.62)'
  context.lineWidth = 6
  for (const target of [80, 145, 230, 320]) {
    context.beginPath()
    context.moveTo(210, 42)
    context.lineTo(target, 172)
    context.stroke()
  }

  context.fillStyle = 'rgba(148, 103, 189, 0.72)'
  for (const x of [62, 128, 214, 302]) {
    context.fillRect(x, 176, 48, 16)
  }
  context.fillStyle = 'rgba(210, 210, 210, 1)'
  context.fillText('making', 206, 30)

  writeFileSync(path, canvas.toBuffer('image/png'))
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const value = color.replace(/^#/, '')
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  }
}

function hexChroma(color: string): number {
  const { r, g, b } = hexToRgb(color)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

function hexLuminance(color: string): number {
  const { r, g, b } = hexToRgb(color)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('visual style profile extractor', () => {
  it('extracts a reusable visual style profile and adapts it for deterministic plotting', async () => {
    const figurePath = join(workspaceRoot, 'reference-plot.png')
    writeReferencePlot(figurePath)

    const result = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: 'reference-plot.png',
      scope: 'manuscript',
      figureId: 'Fig. 2A',
      notes: 'reference style'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.profile).toMatchObject({
      version: 1,
      scope: 'manuscript',
      source: {
        type: 'reference',
        figureId: 'Fig. 2A',
        notes: 'reference style'
      }
    })
    expect(result.profile.id).toMatch(/^visual-style-[0-9a-f]{12}$/)
    expect(result.profile.source).toMatchObject({
      type: 'reference',
      figureId: 'Fig. 2A',
      notes: 'reference style'
    })
    expect(result.profile.source.type === 'reference' && result.profile.source.path.endsWith('/reference-plot.png')).toBe(true)
    expect(result.profile.tokens.canvas).toMatchObject({
      width: 640,
      height: 420,
      background: '#ffffff'
    })
    expect(result.profile.tokens.palette.colors.length).toBeGreaterThan(1)
    expect(result.profile.tokens.palette.accent.length).toBeGreaterThan(0)
    expect(
      result.profile.tokens.palette.accent.every((color) => hexChroma(color) >= 36 || hexLuminance(color) < 135)
    ).toBe(true)
    expect(result.profile.tokens.typography.axisSize).toBeGreaterThanOrEqual(7)
    expect(result.profile.tokens.typography.axisSize).toBeLessThanOrEqual(8)
    expect(result.profile.tokens.strokes.primaryWidth).toBeLessThanOrEqual(1.6)
    expect(result.profile.tokens.plots?.axes.grid).toBe(true)
    expect(result.profile.tokens.plots?.axes.gridColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(result.profile.tokens.generatedAssets?.visualTreatment).toBe('unknown')
    expect(result.profile.semanticDescription).toContain('palette')
    expect(result.profile.confidence.generatedAssets).toBe(0)
    expect(result.diagnostics.sampledPixels).toBeGreaterThan(10_000)

    const plotStyle = figureStyleSpecFromVisualStyleProfile(result.profile)
    const adapter = buildMatplotlibStyleAdapter(result.profile)
    expect(plotStyle.axes.grid).toBe(true)
    expect(adapter.rcParams).toMatchObject({
      'axes.grid': true,
      'grid.color': plotStyle.axes.gridColor,
      'grid.alpha': plotStyle.axes.gridAlpha,
      'grid.linewidth': plotStyle.axes.gridLineWidth,
      'lines.linewidth': plotStyle.marks.lineWidth,
      'lines.markersize': plotStyle.marks.markerSize,
      'legend.frameon': false,
      'savefig.transparent': false
    })
    expect(adapter.palette.length).toBeGreaterThan(0)
  })

  it('scores similar generated figures higher than visibly different figures', async () => {
    writeReferencePlot(join(workspaceRoot, 'reference-plot.png'))
    writeReferencePlot(join(workspaceRoot, 'styled-output.png'))
    writeDivergentPlot(join(workspaceRoot, 'divergent-output.png'))

    const similar = await evaluateVisualStyleSimilarity({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'styled-output.png'
    })
    const divergent = await evaluateVisualStyleSimilarity({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'divergent-output.png'
    })

    expect(similar.ok).toBe(true)
    expect(divergent.ok).toBe(true)
    if (!similar.ok) throw new Error(similar.message)
    if (!divergent.ok) throw new Error(divergent.message)
    expect(similar.metric.overall).toBeGreaterThan(0.9)
    expect(similar.metric.palette).toBeGreaterThan(0.9)
    expect(divergent.metric.overall).toBeLessThan(0.7)
    expect(divergent.metric.background).toBeLessThan(0.5)
    expect(divergent.metric.warnings.length).toBeGreaterThan(0)
  })

  it('returns a conservative auto-repair plan for mismatched styled output', async () => {
    writeReferencePlot(join(workspaceRoot, 'reference-plot.png'))
    writeDivergentPlot(join(workspaceRoot, 'divergent-output.png'))

    const result = await reviewVisualStyleSimilarity({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'divergent-output.png'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result).not.toHaveProperty('status')
    expect(result.metric.overall).toBeLessThan(0.82)
    expect(result.issues.some((issue) => issue.id === 'background' && issue.autoRepairable)).toBe(true)
    expect(result.repairSuggestion.shouldRerender).toBe(true)
    expect(result.repairSuggestion.rcParamsPatch).toMatchObject({
      'figure.facecolor': '#ffffff',
      'axes.facecolor': '#ffffff',
      'savefig.transparent': false
    })
    expect(result.repairSuggestion.guardrails.join(' ')).toContain('Do not change source data')
  })

  it('flags oversized typography as repairable style mismatch', async () => {
    writeReferencePlot(join(workspaceRoot, 'reference-plot.png'))
    writeOversizedTypographyPlot(join(workspaceRoot, 'oversized-text-output.png'))

    const result = await reviewVisualStyleSimilarity({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'oversized-text-output.png'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.metric.typography).toBeLessThan(0.62)
    expect(result.metric.warnings).toContain('Typography weight or label-area density differs from the reference figure.')
    expect(result.issues.some((issue) => issue.id === 'typography' && issue.autoRepairable)).toBe(true)
    expect(result.repairSuggestion.shouldRerender).toBe(true)
    expect(result.repairSuggestion.rcParamsPatch).toMatchObject({
      'axes.titlesize': expect.any(Number),
      'axes.labelsize': expect.any(Number),
      'xtick.labelsize': expect.any(Number),
      'ytick.labelsize': expect.any(Number)
    })
    expect(Number(result.repairSuggestion.rcParamsPatch['axes.titlesize'])).toBeLessThanOrEqual(8.8)
  })

  it('composites transparent reference images before sampling style', async () => {
    writeTransparentAttentionPlot(join(workspaceRoot, 'attention-transparent.png'))

    const result = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: 'attention-transparent.png',
      sourceType: 'image'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.profile.tokens.canvas.background).toBe('#000000')
    expect(result.diagnostics.warnings).toContain('Transparent reference image was composited before style sampling.')
    expect(result.profile.tokens.palette.accent.length).toBeGreaterThan(0)
  })

  it('records current-artifact provenance without changing content-derived profile identity', async () => {
    writeReferencePlot(join(workspaceRoot, 'current-artifact.png'))

    const first = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: 'current-artifact.png',
      sourceKind: 'current',
      scope: 'artifact'
    })
    const second = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: 'current-artifact.png',
      sourceKind: 'current',
      scope: 'workspace'
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    if (!second.ok) throw new Error(second.message)
    expect(first.profile.source).toMatchObject({
      type: 'current',
      artifactPath: expect.stringContaining('/current-artifact.png')
    })
    expect(first.profile.id).toBe(second.profile.id)
    expect(first.profile.scope).toBe('artifact')
    expect(second.profile.scope).toBe('workspace')
  })

  it('keeps v1.3 PDF extraction degraded instead of trying to parse PDFs', async () => {
    const pdfDir = join(workspaceRoot, 'papers')
    mkdirSync(pdfDir, { recursive: true })
    writeFileSync(join(pdfDir, 'paper.pdf'), '%PDF-1.7\n')

    const result = await extractVisualStyleProfile({
      workspaceRoot,
      sourcePath: 'papers/paper.pdf',
      sourceType: 'pdf'
    })

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('PDF figure style extraction is not enabled')
    })
  })
})
