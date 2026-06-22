import { describe, expect, it } from 'vitest'
import type { FigureStyleSpec } from '@shared/figure-style'
import {
  buildFigureStyleArtifactPath,
  inferFigureStyleSourceType,
  normalizeRatioCropBoxDraft,
  workspaceRelativeFigurePath
} from './FigureStylePanel'

const baseSpec: FigureStyleSpec = {
  version: 1,
  source: {
    path: '/workspace/figures/Figure 2A reference.png',
    type: 'image',
    figureId: 'Fig. 2A / reference'
  },
  canvas: {
    width: 640,
    height: 420,
    aspectRatio: 1.524,
    background: '#ffffff'
  },
  palette: {
    colors: ['#222222', '#d24b4b'],
    background: '#ffffff',
    ink: '#222222',
    accent: ['#d24b4b'],
    colorMode: 'limited'
  },
  typography: {
    fontFamily: 'Arial',
    axisSize: 8,
    labelSize: 9,
    titleSize: 11,
    weight: 'regular'
  },
  layout: {
    panelGrid: '1x1',
    panelLabels: 'unknown',
    margin: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1 },
    gutter: 'balanced'
  },
  axes: {
    spine: 'left-bottom',
    tickDirection: 'out',
    grid: true,
    gridTone: 'light',
    gridColor: '#e2e2df',
    gridAlpha: 0.52,
    gridLineWidth: 0.4
  },
  marks: {
    lineWidth: 1.2,
    markerSize: 3,
    errorBarStyle: 'unknown',
    density: 'balanced'
  },
  annotations: {
    significance: 'unknown',
    legend: 'frameless'
  },
  export: {
    formats: ['pdf', 'svg', 'png'],
    dpi: 300,
    transparent: false
  },
  confidence: {
    overall: 0.72,
    palette: 0.8,
    layout: 0.7,
    axes: 0.75,
    typography: 0.35
  }
}

describe('FigureStylePanel helpers', () => {
  it('builds stable sanitized style artifact paths', () => {
    expect(
      buildFigureStyleArtifactPath(baseSpec, new Date('2026-06-21T08:30:05.000Z'))
    ).toBe('.sciforge/figure-styles/20260621T083005-Fig.-2A-reference.json')
  })

  it('falls back to the source file name when figure id is absent', () => {
    const spec = {
      ...baseSpec,
      source: {
        path: '/workspace/figures/My Reference Image.png',
        type: 'image' as const
      }
    }

    expect(
      buildFigureStyleArtifactPath(spec, new Date('2026-06-21T08:30:05.000Z'))
    ).toBe('.sciforge/figure-styles/20260621T083005-My-Reference-Image.json')
  })

  it('converts selected workspace files to relative figure paths', () => {
    expect(
      workspaceRelativeFigurePath(
        '/Users/yhh/project/figures/reference.png',
        '/Users/yhh/project'
      )
    ).toBe('figures/reference.png')
  })

  it('rejects selected files outside the workspace', () => {
    expect(
      workspaceRelativeFigurePath(
        '/Users/yhh/Downloads/reference.png',
        '/Users/yhh/project'
      )
    ).toBeNull()
  })

  it('infers PDF references separately from images', () => {
    expect(inferFigureStyleSourceType('figures/paper.pdf')).toBe('pdf')
    expect(inferFigureStyleSourceType('figures/reference.webp')).toBe('image')
  })

  it('normalizes ratio crop boxes for reference preparation', () => {
    expect(
      normalizeRatioCropBoxDraft({
        x: '0.1',
        y: '0.2',
        width: '0.7',
        height: '0.5'
      })
    ).toEqual({
      unit: 'ratio',
      x: 0.1,
      y: 0.2,
      width: 0.7,
      height: 0.5
    })

    expect(
      normalizeRatioCropBoxDraft({
        x: '0.9',
        y: '0.95',
        width: '0.7',
        height: '0.5'
      })
    ).toEqual({
      unit: 'ratio',
      x: 0.9,
      y: 0.95,
      width: 0.09999999999999998,
      height: 0.050000000000000044
    })
  })
})
