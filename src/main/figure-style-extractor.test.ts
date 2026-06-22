import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildFigureStyleApplyPlan,
  evaluateFigureStyleSimilarity,
  extractFigureStyle,
  reviewFigureStyleOutput
} from './figure-style-extractor'

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

describe('figure style extractor', () => {
  it('extracts a reusable style spec and plotting plan from a reference plot image', async () => {
    const figurePath = join(workspaceRoot, 'reference-plot.png')
    writeReferencePlot(figurePath)

    const result = await extractFigureStyle({
      workspaceRoot,
      sourcePath: 'reference-plot.png',
      figureId: 'Fig. 2A',
      notes: 'reference style'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.spec.version).toBe(1)
    expect(result.spec.source).toMatchObject({
      type: 'image',
      figureId: 'Fig. 2A',
      notes: 'reference style'
    })
    expect(result.spec.source.path.endsWith('/reference-plot.png')).toBe(true)
    expect(result.spec.canvas).toMatchObject({
      width: 640,
      height: 420,
      background: '#ffffff'
    })
    expect(result.spec.palette.colors.length).toBeGreaterThan(1)
    expect(result.spec.palette.accent.length).toBeGreaterThan(0)
    expect(
      result.spec.palette.accent.every((color) => hexChroma(color) >= 36 || hexLuminance(color) < 135)
    ).toBe(true)
    expect(result.spec.typography.axisSize).toBeGreaterThanOrEqual(7)
    expect(result.spec.typography.axisSize).toBeLessThanOrEqual(8)
    expect(result.spec.typography.labelSize).toBeLessThanOrEqual(9)
    expect(result.spec.typography.titleSize).toBeLessThanOrEqual(11)
    expect(result.spec.marks.lineWidth).toBeLessThanOrEqual(1.6)
    expect(result.spec.marks.markerSize).toBeLessThanOrEqual(3.8)
    expect(result.spec.axes.grid).toBe(true)
    expect(result.spec.axes.gridColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(result.spec.axes.gridAlpha).toBeGreaterThan(0)
    expect(result.spec.axes.gridLineWidth).toBeGreaterThan(0)
    expect(result.spec.axes.spine).toBe('left-bottom')
    expect(result.spec.export.transparent).toBe(false)
    expect(result.diagnostics.sampledPixels).toBeGreaterThan(10_000)

    const plan = buildFigureStyleApplyPlan(result.spec)
    expect(result.applyPlan).toMatchObject({
      plottingWorkflow: {
        nextControlledTool: 'SciForge DataFigure Engine'
      }
    })
    expect(plan.plottingWorkflow).toMatchObject({
      nextControlledTool: 'SciForge DataFigure Engine',
      recommendedSkills: expect.arrayContaining(['scientific-visualization', 'matplotlib'])
    })
    expect(plan.matplotlibHints.rcParams).toMatchObject({
      'axes.grid': true,
      'grid.color': result.spec.axes.gridColor,
      'grid.alpha': result.spec.axes.gridAlpha,
      'grid.linewidth': result.spec.axes.gridLineWidth,
      'lines.linewidth': result.spec.marks.lineWidth,
      'lines.markersize': result.spec.marks.markerSize,
      'legend.frameon': false,
      'savefig.transparent': false
    })
    expect(plan.matplotlibHints.palette.length).toBeGreaterThan(0)
  })

  it('scores similar generated figures higher than visibly different figures', async () => {
    writeReferencePlot(join(workspaceRoot, 'reference-plot.png'))
    writeReferencePlot(join(workspaceRoot, 'styled-output.png'))
    writeDivergentPlot(join(workspaceRoot, 'divergent-output.png'))

    const similar = await evaluateFigureStyleSimilarity({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'styled-output.png'
    })
    const divergent = await evaluateFigureStyleSimilarity({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'divergent-output.png'
    })

    expect(similar.ok).toBe(true)
    expect(divergent.ok).toBe(true)
    if (!similar.ok) throw new Error(similar.message)
    if (!divergent.ok) throw new Error(divergent.message)
    expect(similar.score.overall).toBeGreaterThan(0.9)
    expect(similar.score.palette).toBeGreaterThan(0.9)
    expect(divergent.score.overall).toBeLessThan(0.7)
    expect(divergent.score.background).toBeLessThan(0.5)
    expect(divergent.score.warnings.length).toBeGreaterThan(0)
  })

  it('returns a conservative auto-repair plan for mismatched styled output', async () => {
    writeReferencePlot(join(workspaceRoot, 'reference-plot.png'))
    writeDivergentPlot(join(workspaceRoot, 'divergent-output.png'))

    const result = await reviewFigureStyleOutput({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'divergent-output.png',
      minOverall: 0.82
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.status).toBe('manual_review')
    expect(result.score.overall).toBeLessThan(0.82)
    expect(result.issues.some((issue) => issue.id === 'background' && issue.autoRepairable)).toBe(true)
    expect(result.autoRepair.shouldRerender).toBe(true)
    expect(result.autoRepair.rcParamsPatch).toMatchObject({
      'figure.facecolor': '#ffffff',
      'axes.facecolor': '#ffffff',
      'savefig.transparent': false
    })
    expect(result.autoRepair.guardrails.join(' ')).toContain('Do not change source data')
  })

  it('flags oversized typography as repairable style mismatch', async () => {
    writeReferencePlot(join(workspaceRoot, 'reference-plot.png'))
    writeOversizedTypographyPlot(join(workspaceRoot, 'oversized-text-output.png'))

    const result = await reviewFigureStyleOutput({
      workspaceRoot,
      referencePath: 'reference-plot.png',
      outputPath: 'oversized-text-output.png',
      minOverall: 0.82
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.score.typography).toBeLessThan(0.62)
    expect(result.score.warnings).toContain('Typography weight or label-area density differs from the reference figure.')
    expect(result.issues.some((issue) => issue.id === 'typography' && issue.autoRepairable)).toBe(true)
    expect(result.autoRepair.shouldRerender).toBe(true)
    expect(result.autoRepair.rcParamsPatch).toMatchObject({
      'axes.titlesize': expect.any(Number),
      'axes.labelsize': expect.any(Number),
      'xtick.labelsize': expect.any(Number),
      'ytick.labelsize': expect.any(Number)
    })
    expect(Number(result.autoRepair.rcParamsPatch['axes.titlesize'])).toBeLessThanOrEqual(8.8)
  })

  it('composites transparent reference images before sampling style', async () => {
    writeTransparentAttentionPlot(join(workspaceRoot, 'attention-transparent.png'))

    const result = await extractFigureStyle({
      workspaceRoot,
      sourcePath: 'attention-transparent.png',
      sourceType: 'image'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.spec.canvas.background).toBe('#000000')
    expect(result.diagnostics.warnings).toContain('Transparent reference image was composited before style sampling.')
    expect(result.spec.palette.accent.length).toBeGreaterThan(0)
  })

  it('keeps v1.3 PDF extraction degraded instead of trying to parse PDFs', async () => {
    const pdfDir = join(workspaceRoot, 'papers')
    mkdirSync(pdfDir, { recursive: true })
    writeFileSync(join(pdfDir, 'paper.pdf'), '%PDF-1.7\n')

    const result = await extractFigureStyle({
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
