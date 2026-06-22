import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import type { FigureStyleSpec } from '../shared/figure-style'
import {
  createScientificPlottingReviewPacket,
  getScientificPlottingStatus,
  listScientificPlottingStyleProfiles,
  mapScientificPlottingData,
  planScientificPlotting,
  prepareScientificPlottingReference,
  renderScientificPlot,
  reviewScientificPlottingOutput,
  runScientificPlottingStyleTransfer
} from './scientific-plotting-engine'

async function tempWorkspace(): Promise<string> {
  const root = join(tmpdir(), `scientific-plotting-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(root, { recursive: true })
  return root
}

async function writeSyntheticReferenceImage(path: string): Promise<void> {
  const canvas = createCanvas(420, 260)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 420, 260)
  context.strokeStyle = '#dddddd'
  context.lineWidth = 1
  for (let y = 50; y < 220; y += 32) {
    context.beginPath()
    context.moveTo(48, y)
    context.lineTo(380, y)
    context.stroke()
  }
  context.strokeStyle = '#222222'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(48, 220)
  context.lineTo(380, 220)
  context.moveTo(48, 40)
  context.lineTo(48, 220)
  context.stroke()
  context.fillStyle = '#4e9bd4'
  for (const [x, h] of [[88, 90], [150, 135], [212, 105], [274, 160]]) {
    context.fillRect(x, 220 - h, 34, h)
  }
  context.fillStyle = '#222222'
  context.font = '14px Arial'
  context.fillText('Synthetic reference', 62, 30)
  await writeFile(path, canvas.toBuffer('image/png'))
}

function referenceStyleSpec(figureId: string): FigureStyleSpec {
  return {
    version: 1,
    source: {
      path: `${figureId}.png`,
      type: 'image',
      figureId
    },
    canvas: {
      width: 720,
      height: 420,
      aspectRatio: 1.714,
      background: '#ffffff'
    },
    palette: {
      colors: ['#ffffff', '#2f6f9f', '#d95f02', '#222222'],
      background: '#ffffff',
      ink: '#222222',
      accent: ['#2f6f9f', '#d95f02'],
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
      panelLabels: 'unknown',
      margin: { left: 0.12, right: 0.08, top: 0.08, bottom: 0.14 },
      gutter: 'balanced'
    },
    axes: {
      spine: 'left-bottom',
      tickDirection: 'out',
      grid: true,
      gridTone: 'light',
      gridColor: '#dddddd',
      gridAlpha: 0.52,
      gridLineWidth: 0.35
    },
    marks: {
      lineWidth: 1,
      markerSize: 3,
      errorBarStyle: 'unknown',
      density: 'balanced'
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
    confidence: {
      overall: 0.72,
      palette: 0.72,
      layout: 0.68,
      axes: 0.7,
      typography: 0.35
    }
  }
}

describe('scientific plotting engine', () => {
  it('plans a controlled attention map without executable commands', async () => {
    await expect(planScientificPlotting({
      task: 'Draw an attention heatmap in the style of a NeurIPS paper.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'attention-map',
      controlledTool: 'scientific_plotting_render',
      templateAlternatives: expect.any(Array),
      planningWarnings: expect.any(Array)
    })
  })

  it('plans v1.14 statistical and multi-panel templates from user intent', async () => {
    await expect(planScientificPlotting({
      task: 'Create a violin plot comparing treatment distributions.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'box-violin',
      controlledTool: 'scientific_plotting_render'
    })

    await expect(planScientificPlotting({
      task: 'Draw a histogram density figure for model residual distribution.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'histogram-density',
      controlledTool: 'scientific_plotting_render'
    })

    await expect(planScientificPlotting({
      task: 'Make a multi-panel figure with a line panel and a heatmap panel.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'multi-panel',
      controlledTool: 'scientific_plotting_render'
    })
  })

  it('uses a StyleSpec reference profile when planning a vague style-transfer task', async () => {
    const plan = await planScientificPlotting({
      task: 'Make a figure like this paper panel.',
      styleSpec: {
        version: 1,
        source: {
          path: 'attention-reference.png',
          type: 'image',
          notes: 'Attention token alignment matrix'
        },
        canvas: {
          width: 560,
          height: 280,
          aspectRatio: 2,
          background: '#000000'
        },
        palette: {
          colors: ['#000000', '#301830', '#906048'],
          background: '#000000',
          ink: '#f5f5f5',
          accent: ['#301830', '#906048'],
          colorMode: 'multi-hue'
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
          panelLabels: 'unknown',
          margin: { left: 0.2, right: 0.08, top: 0.04, bottom: 0.12 },
          gutter: 'balanced'
        },
        axes: {
          spine: 'left-bottom',
          tickDirection: 'out',
          grid: false,
          gridTone: 'none',
          gridColor: '#000000',
          gridAlpha: 0,
          gridLineWidth: 0
        },
        marks: {
          lineWidth: 1,
          markerSize: 2.8,
          errorBarStyle: 'unknown',
          density: 'balanced'
        },
        annotations: {
          significance: 'unknown',
          legend: 'unknown'
        },
        export: {
          formats: ['png'],
          dpi: 300,
          transparent: false
        },
        confidence: {
          overall: 0.7,
          palette: 0.7,
          layout: 0.7,
          axes: 0.7,
          typography: 0.35
        }
      }
    })

    expect(plan).toMatchObject({
      ok: true,
      recommendedTemplate: 'attention-map',
      referenceProfile: {
        kind: 'matrix',
        recommendedTemplate: 'attention-map'
      }
    })
  })

  it('lists v1.20 built-in style profiles and plans from styleProfileId', async () => {
    const profiles = await listScientificPlottingStyleProfiles({
      query: 'neurips attention',
      includeStyleSpec: true
    })
    expect(profiles).toMatchObject({
      ok: true,
      status: 'listed',
      profiles: [
        expect.objectContaining({
          id: 'neurips-2017-attention',
          styleSpec: expect.objectContaining({
            version: 1,
            palette: expect.objectContaining({
              background: '#000000'
            })
          })
        })
      ]
    })

    await expect(planScientificPlotting({
      task: 'Draw a paper-style attention matrix.',
      styleProfileId: 'neurips-2017-attention'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'attention-map',
      styleProfileId: 'neurips-2017-attention',
      styleProfile: {
        name: 'NeurIPS 2017 Attention Visualization'
      },
      referenceProfile: {
        kind: 'matrix',
        recommendedTemplate: 'attention-map'
      }
    })
  })

  it('matches v1.21 style profiles from a reference image', async () => {
    const workspace = await tempWorkspace()
    try {
      await writeSyntheticReferenceImage(join(workspace, 'reference.png'))
      const profiles = await listScientificPlottingStyleProfiles({
        workspaceRoot: workspace,
        referencePath: 'reference.png',
        topK: 3
      })

      expect(profiles).toMatchObject({
        ok: true,
        status: 'matched',
        referenceProfile: {
          kind: 'chart',
          recommendedTemplate: 'bar'
        },
        selectedProfile: {
          id: expect.any(String)
        }
      })
      if (!profiles.ok) return
      expect(profiles.profileMatches?.[0]).toMatchObject({
        profileId: expect.any(String),
        score: expect.any(Number),
        reasons: expect.arrayContaining([
          expect.stringMatching(/template|Background|Grid|Axis|palette|Canvas/i)
        ])
      })
      expect(profiles.profileMatches?.[0]?.score).toBeGreaterThan(0.4)
      expect(profiles.profiles.map((profile) => profile.id)).toContain(profiles.selectedProfile?.id)

      const plan = await planScientificPlotting({
        workspaceRoot: workspace,
        task: 'Use the paper reference style to draw a benchmark comparison.',
        referencePath: 'reference.png'
      })
      expect(plan).toMatchObject({
        ok: true,
        recommendedTemplate: 'bar',
        styleProfileId: profiles.selectedProfile?.id
      })
      if (plan.ok) {
        expect(plan.styleProfileMatches?.[0]).toMatchObject({
          profileId: profiles.selectedProfile?.id
        })
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('uses v1.15 reference traits and text signals for specialized template planning', async () => {
    await expect(planScientificPlotting({
      task: 'Match this reference paper style.',
      styleSpec: referenceStyleSpec('supplementary violin boxplot treatment distribution')
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'box-violin',
      referenceProfile: {
        detectedTraits: {
          textSignals: expect.arrayContaining(['box-violin'])
        },
        risks: expect.arrayContaining([
          'Specialized template recognition combines visual traits with text hints; confirm the selected template visually.'
        ])
      }
    })

    await expect(planScientificPlotting({
      task: 'Match this reference paper style.',
      styleSpec: referenceStyleSpec('main histogram density residual distribution')
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'histogram-density',
      referenceProfile: {
        detectedTraits: {
          textSignals: expect.arrayContaining(['histogram-density'])
        }
      }
    })

    const multiPanelStyle = referenceStyleSpec('figure multi-panel heatmap violin summary')
    multiPanelStyle.layout.panelGrid = '2x2'
    await expect(planScientificPlotting({
      task: 'Use the visual style of this paper reference.',
      styleSpec: multiPanelStyle
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'multi-panel',
      referenceProfile: {
        kind: 'mixed',
        detectedTraits: {
          panelGrid: '2x2',
          textSignals: expect.arrayContaining(['multi-panel'])
        }
      }
    })
  })

  it('maps tabular rows to controlled v1.16 render requests', async () => {
    const workspace = await tempWorkspace()
    try {
      const distribution = await mapScientificPlottingData({
        workspaceRoot: workspace,
        task: 'Create a violin plot comparing treatment distributions.',
        figureId: 'mapped-violin',
        data: {
          rows: [
            { condition: 'Control', response: 0.9 },
            { condition: 'Control', response: 1.1 },
            { condition: 'Treatment', response: 1.35 },
            { condition: 'Treatment', response: 1.48 }
          ]
        }
      })
      expect(distribution).toMatchObject({
        ok: true,
        status: 'mapped',
        selectedTemplate: 'box-violin',
        renderRequest: {
          template: 'box-violin',
          data: {
            groups: [
              { name: 'Control', values: [0.9, 1.1] },
              { name: 'Treatment', values: [1.35, 1.48] }
            ],
            showPoints: true
          }
        },
        mappingBasis: {
          taskSignals: expect.arrayContaining(['box-violin']),
          dataSignals: expect.arrayContaining(['box-violin'])
        }
      })

      const trend = await mapScientificPlottingData({
        workspaceRoot: workspace,
        task: 'Draw a time series line plot.',
        data: [
          { epoch: 1, score: 0.2, method: 'A' },
          { epoch: 2, score: 0.4, method: 'A' },
          { epoch: 1, score: 0.16, method: 'B' },
          { epoch: 2, score: 0.35, method: 'B' }
        ]
      })
      expect(trend).toMatchObject({
        ok: true,
        selectedTemplate: 'line',
        renderRequest: {
          template: 'line',
          data: {
            series: [
              { name: 'A', x: [1, 2], y: [0.2, 0.4] },
              { name: 'B', x: [1, 2], y: [0.16, 0.35] }
            ]
          }
        },
        dataSummary: {
          inputShape: 'tabular',
          rowCount: 4
        }
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('maps matrices to attention templates and mapped requests can render', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const mapping = await mapScientificPlottingData({
        workspaceRoot: workspace,
        task: 'Render an attention token alignment matrix.',
        figureId: 'mapped-attention',
        labels: {
          title: 'Mapped attention'
        },
        data: [
          [0.9, 0.1, 0.05],
          [0.12, 0.82, 0.18],
          [0.03, 0.16, 0.88]
        ]
      })
      expect(mapping).toMatchObject({
        ok: true,
        selectedTemplate: 'attention-map',
        renderRequest: {
          template: 'attention-map',
          data: {
            matrix: [
              [0.9, 0.1, 0.05],
              [0.12, 0.82, 0.18],
              [0.03, 0.16, 0.88]
            ]
          }
        }
      })
      if (!mapping.ok) return
      const rendered = await renderScientificPlot(mapping.renderRequest)
      expect(rendered).toMatchObject({ ok: true, status: 'rendered' })
      if (!rendered.ok) return
      expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders v1.12 specialized templates as non-empty PNGs', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const errorbar = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'errorbar-bar',
        figureId: 'errorbar-bar-smoke',
        labels: {
          title: 'Benchmark with uncertainty',
          x: 'Group',
          y: 'Score',
          legend: true
        },
        data: {
          categories: ['A', 'B', 'C'],
          series: [
            { name: 'Method A', values: [0.71, 0.78, 0.82], error: [0.03, 0.02, 0.025] },
            { name: 'Method B', values: [0.64, 0.72, 0.76], error: [0.025, 0.03, 0.02] }
          ]
        }
      })
      expect(errorbar).toMatchObject({ ok: true, status: 'rendered' })
      if (!errorbar.ok) return
      expect((await stat(errorbar.outputPath)).size).toBeGreaterThan(1000)
      expect(errorbar.attempts[0]?.rendererDiagnostics).toMatchObject({
        legendPlacement: 'outside-right',
        categoryLabelRotation: expect.any(Number),
        savefigPadInches: expect.any(Number),
        layoutNotes: expect.arrayContaining([
          'Placed grouped bar legend outside the right edge to avoid covering data.'
        ])
      })
      const errorbarManifest = JSON.parse(await readFile(errorbar.manifestPath, 'utf8')) as {
        attempts: Array<{
          rendererDiagnostics?: {
            legendPlacement?: string
          }
        }>
      }
      expect(errorbarManifest.attempts[0]?.rendererDiagnostics?.legendPlacement).toBe('outside-right')

      const attention = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'attention-map',
        figureId: 'attention-map-smoke',
        labels: {
          title: 'Attention weights',
          x: 'Target',
          y: 'Source'
        },
        data: {
          matrix: [
            [0.9, 0.1, 0.05],
            [0.15, 0.82, 0.2],
            [0.05, 0.18, 0.88]
          ],
          xLabels: ['a', 'b', 'c'],
          yLabels: ['x', 'y', 'z']
        }
      })
      expect(attention).toMatchObject({ ok: true, status: 'rendered' })
      if (!attention.ok) return
      expect((await stat(attention.outputPath)).size).toBeGreaterThan(1000)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders v1.14 statistical and multi-panel templates as non-empty PNGs', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }
    expect(status.ok && status.supportedTemplates).toEqual(expect.arrayContaining([
      'box-violin',
      'histogram-density',
      'multi-panel'
    ]))

    const workspace = await tempWorkspace()
    try {
      const boxViolin = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'box-violin',
        figureId: 'box-violin-smoke',
        labels: {
          title: 'Treatment response distribution',
          x: 'Condition',
          y: 'Response'
        },
        data: {
          groups: [
            { name: 'Control', values: [0.9, 1.1, 1.0, 1.2, 0.95, 1.05] },
            { name: 'Low dose', values: [1.2, 1.35, 1.42, 1.3, 1.25, 1.48] },
            { name: 'High dose', values: [1.55, 1.7, 1.62, 1.8, 1.74, 1.68] }
          ],
          showPoints: true
        }
      })
      expect(boxViolin).toMatchObject({ ok: true, status: 'rendered' })
      if (!boxViolin.ok) return
      expect((await stat(boxViolin.outputPath)).size).toBeGreaterThan(1000)

      const histogram = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'histogram-density',
        figureId: 'histogram-density-smoke',
        labels: {
          title: 'Residual distribution',
          x: 'Residual',
          y: 'Density',
          legend: true
        },
        data: {
          bins: 12,
          series: [
            { name: 'Model A', values: [-1.1, -0.7, -0.2, 0.1, 0.25, 0.4, 0.65, 0.9, 1.2] },
            { name: 'Model B', values: [-0.9, -0.5, -0.1, 0.05, 0.18, 0.35, 0.5, 0.75, 1.0] }
          ]
        }
      })
      expect(histogram).toMatchObject({ ok: true, status: 'rendered' })
      if (!histogram.ok) return
      expect((await stat(histogram.outputPath)).size).toBeGreaterThan(1000)

      const multiPanel = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'multi-panel',
        figureId: 'multi-panel-smoke',
        labels: {
          title: 'Controlled multi-panel summary'
        },
        data: {
          columns: 2,
          panels: [
            {
              template: 'line',
              labels: { title: 'Trend', x: 'Time', y: 'Score' },
              data: { series: [{ name: 'A', y: [0.2, 0.4, 0.65, 0.8] }] }
            },
            {
              template: 'heatmap',
              labels: { title: 'Matrix' },
              data: { matrix: [[0.1, 0.4], [0.7, 0.2]], colorbar: false }
            },
            {
              template: 'box-violin',
              labels: { title: 'Groups', y: 'Value' },
              data: {
                groups: [
                  { name: 'A', values: [1, 1.2, 1.1] },
                  { name: 'B', values: [1.4, 1.6, 1.5] }
                ]
              }
            }
          ]
        }
      })
      expect(multiPanel).toMatchObject({ ok: true, status: 'rendered' })
      if (!multiPanel.ok) return
      expect((await stat(multiPanel.outputPath)).size).toBeGreaterThan(1000)
      expect(multiPanel.attempts[0]?.rendererDiagnostics).toMatchObject({
        multiPanelCount: 3,
        layoutNotes: expect.arrayContaining([
          'Rendered 3 controlled subpanels in a 2x2 layout.'
        ])
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders a non-empty PNG and can review the output against itself', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'line',
        figureId: 'line-smoke',
        labels: {
          title: 'Controlled line plot',
          x: 'Epoch',
          y: 'Score'
        },
        data: {
          series: [
            { name: 'Method A', x: [1, 2, 3, 4], y: [0.2, 0.45, 0.62, 0.76] },
            { name: 'Method B', x: [1, 2, 3, 4], y: [0.15, 0.32, 0.58, 0.71] }
          ]
        }
      })

      expect(result).toMatchObject({ ok: true, status: 'rendered' })
      if (!result.ok) return
      await expect(stat(result.outputPath)).resolves.toMatchObject({
        size: expect.any(Number)
      })
      expect((await stat(result.outputPath)).size).toBeGreaterThan(1000)
      await expect(stat(result.manifestPath)).resolves.toBeTruthy()
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
        referenceProfile?: unknown
        templateAdvice?: unknown
      }
      expect(manifest.referenceProfile).toBeTruthy()
      expect(manifest.templateAdvice).toBeTruthy()

      const review = await reviewScientificPlottingOutput({
        workspaceRoot: workspace,
        referencePath: result.outputPath,
        outputPath: result.outputPath,
        template: 'line'
      })
      expect(review).toMatchObject({
        ok: true,
        template: 'line',
        templateAdvice: expect.any(Object),
        score: {
          overall: expect.any(Number),
          palette: expect.any(Number),
          background: expect.any(Number),
          axes: expect.any(Number),
          grid: expect.any(Number),
          layout: expect.any(Number),
          marks: expect.any(Number),
          typography: expect.any(Number),
          warnings: expect.any(Array)
        }
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders with a v1.20 built-in style profile and records provenance', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }
    expect(status.ok && status.styleProfiles).toMatchObject({
      builtIn: expect.any(Number),
      acceptsStyleProfileId: true,
      defaultProfileIds: expect.arrayContaining(['nature-2021-alphafold-fig2'])
    })

    const workspace = await tempWorkspace()
    try {
      const mapping = await mapScientificPlottingData({
        workspaceRoot: workspace,
        task: 'Create a Nature-style response curve.',
        styleProfileId: 'nature-2021-alphafold-fig2',
        labels: {
          title: 'Profile driven trend',
          x: 'Epoch',
          y: 'Score'
        },
        data: {
          rows: [
            { epoch: 1, score: 0.18, method: 'A' },
            { epoch: 2, score: 0.36, method: 'A' },
            { epoch: 3, score: 0.58, method: 'A' },
            { epoch: 1, score: 0.14, method: 'B' },
            { epoch: 2, score: 0.31, method: 'B' },
            { epoch: 3, score: 0.49, method: 'B' }
          ]
        }
      })
      expect(mapping).toMatchObject({
        ok: true,
        styleProfileId: 'nature-2021-alphafold-fig2',
        renderRequest: {
          styleProfileId: 'nature-2021-alphafold-fig2'
        }
      })
      if (!mapping.ok) return
      const result = await renderScientificPlot({
        ...mapping.renderRequest,
        figureId: 'style-profile-smoke'
      })
      expect(result).toMatchObject({
        ok: true,
        status: 'rendered',
        styleProfileId: 'nature-2021-alphafold-fig2',
        styleProfile: {
          name: 'Nature 2021 AlphaFold Fig. 2'
        },
        referenceProfile: {
          recommendedTemplate: 'bar'
        }
      })
      if (!result.ok) return
      expect((await stat(result.outputPath)).size).toBeGreaterThan(1000)
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
        styleProfileId?: string
        styleProfile?: { id?: string; styleSpec?: unknown }
      }
      expect(manifest.styleProfileId).toBe('nature-2021-alphafold-fig2')
      expect(manifest.styleProfile?.id).toBe('nature-2021-alphafold-fig2')
      expect(manifest.styleProfile?.styleSpec).toBeUndefined()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('creates a v1.19 review packet from render manifests', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      await writeSyntheticReferenceImage(join(workspace, 'reference.png'))
      expect(status.ok && status.reviewPackets).toMatchObject({
        defaultRelativeDir: '.sciforge/figure-reviews',
        readsRenderManifests: true,
        writesMarkdownAndJson: true
      })

      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'bar',
        figureId: 'packet-bar-smoke',
        referencePath: 'reference.png',
        styleSpec: referenceStyleSpec('packet-style'),
        labels: {
          title: 'Packet smoke',
          x: 'Group',
          y: 'Score'
        },
        data: {
          categories: ['A', 'B', 'C'],
          series: [
            { name: 'Method A', values: [0.71, 0.78, 0.82] }
          ]
        },
        autoRepair: {
          enabled: false,
          maxAttempts: 0,
          minOverall: 0.82
        }
      })
      expect(result).toMatchObject({ ok: true })
      if (!result.ok) return

      const packet = await createScientificPlottingReviewPacket({
        workspaceRoot: workspace,
        manifestPaths: [result.manifestPath],
        packetId: 'packet-smoke',
        title: 'Packet Smoke'
      })
      expect(packet).toMatchObject({
        ok: true,
        status: 'created',
        packet: {
          itemCount: 1,
          items: [
            {
              template: 'bar',
              outputPath: result.outputPath,
              manifestPath: result.manifestPath,
              score: {
                overall: expect.any(Number)
              },
              recommendedActions: expect.any(Array)
            }
          ],
          summary: {
            rendered: 1
          }
        }
      })
      if (!packet.ok) return
      await expect(stat(packet.packetPath)).resolves.toBeTruthy()
      await expect(stat(packet.packetJsonPath)).resolves.toBeTruthy()
      const markdown = await readFile(packet.packetPath, 'utf8')
      expect(markdown).toContain('![bar output]')
      expect(markdown).toContain(result.outputPath)
      expect(markdown).toContain(result.manifestPath)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('clamps oversized typography and records v1.17 render diagnostics', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const oversizedStyle: FigureStyleSpec = {
        ...referenceStyleSpec('oversized-typography'),
        typography: {
          fontFamily: 'Arial',
          axisSize: 14,
          labelSize: 18,
          titleSize: 24,
          weight: 'bold'
        }
      }
      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'line',
        figureId: 'typography-clamp-smoke',
        styleSpec: oversizedStyle,
        labels: {
          title: 'A deliberately long scientific figure title',
          x: 'Epoch',
          y: 'Score'
        },
        data: {
          series: [
            { name: 'Method A', x: [1, 2, 3, 4], y: [0.2, 0.45, 0.62, 0.76] }
          ]
        }
      })

      expect(result).toMatchObject({ ok: true, status: 'rendered' })
      if (!result.ok) return
      const typography = result.attempts[0]?.rendererDiagnostics?.typography
      expect(typography).toMatchObject({
        publicationClampApplied: true
      })
      expect(typography?.titleSize).toBeLessThanOrEqual(8)
      expect(typography?.labelSize).toBeLessThanOrEqual(7.8)
      expect(typography?.tickSize).toBeLessThanOrEqual(6.8)
      expect(result.attempts[0]?.rendererDiagnostics?.layoutNotes).toContain(
        'Clamped typography to conservative publication-size ranges.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('moves dense legends outside the plot and records v1.18 layout QA diagnostics', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'line',
        figureId: 'legend-layout-qa-smoke',
        labels: {
          title: 'Dense legend layout check',
          x: 'Epoch',
          y: 'Score',
          legend: true
        },
        data: {
          series: [
            { name: 'SciForge calibrated model', x: [1, 2, 3, 4], y: [0.2, 0.45, 0.62, 0.76] },
            { name: 'Baseline long-context model', x: [1, 2, 3, 4], y: [0.18, 0.36, 0.55, 0.68] },
            { name: 'Ablated retrieval variant', x: [1, 2, 3, 4], y: [0.16, 0.31, 0.5, 0.61] },
            { name: 'Compact control variant', x: [1, 2, 3, 4], y: [0.12, 0.25, 0.41, 0.54] }
          ]
        }
      })

      expect(result).toMatchObject({ ok: true, status: 'rendered' })
      if (!result.ok) return
      const diagnostics = result.attempts[0]?.rendererDiagnostics
      expect(diagnostics).toMatchObject({
        legendPlacement: 'outside-right',
        layoutQuality: {
          legendItemCount: 4,
          legendColumnCount: 1,
          legendOutsidePlot: true,
          legendOverlapRisk: 'none',
          textOverflowRisk: expect.any(String),
          panelLabelAdjusted: false,
          warnings: []
        }
      })
      expect(diagnostics?.layoutNotes).toContain(
        'Moved long or dense legend outside the plot area to avoid covering data.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('prepares an image reference crop with StyleSpec and profile', async () => {
    const workspace = await tempWorkspace()
    try {
      await writeSyntheticReferenceImage(join(workspace, 'reference.png'))
      const result = await prepareScientificPlottingReference({
        workspaceRoot: workspace,
        sourcePath: 'reference.png',
        figureId: 'cropped-reference',
        cropBox: {
          unit: 'ratio',
          x: 0.08,
          y: 0.08,
          width: 0.84,
          height: 0.82
        }
      })

      expect(result).toMatchObject({
        ok: true,
        status: 'prepared',
        source: {
          type: 'image',
          width: 420,
          height: 260
        },
        cropBox: {
          unit: 'pixel',
          x: 33,
          y: 20
        },
        referenceProfile: {
          kind: 'chart',
          recommendedTemplate: 'bar'
        },
        recommendedStyleProfile: {
          id: expect.any(String)
        }
      })
      if (!result.ok) return
      await expect(stat(result.croppedImagePath)).resolves.toMatchObject({
        size: expect.any(Number)
      })
      expect((await stat(result.croppedImagePath)).size).toBeGreaterThan(1000)
      expect(result.styleSpecPath).toBeTruthy()
      await expect(stat(result.styleSpecPath!)).resolves.toBeTruthy()
      expect(result.styleSpec?.version).toBe(1)
      await expect(stat(result.referenceManifestPath)).resolves.toBeTruthy()
      expect(result.referenceManifest).toMatchObject({
        version: 1,
        tool: 'scientific_plotting_prepare_reference',
        croppedImagePath: result.croppedImagePath,
        styleSpecPath: result.styleSpecPath,
        nextWorkflow: {
          referencePath: result.croppedImagePath,
          suggestedPlanTool: 'scientific_plotting_plan',
          suggestedRenderTool: 'scientific_plotting_render',
          suggestedReviewTool: 'scientific_plotting_review'
        }
      })
      const manifest = JSON.parse(await readFile(result.referenceManifestPath, 'utf8')) as {
        requestHash?: string
        referenceProfile?: {
          detectedTraits?: {
            aspect?: string
            textSignals?: string[]
          }
        }
        recommendedStyleProfile?: {
          id?: string
        }
        styleProfileMatches?: Array<{
          profileId?: string
          score?: number
        }>
        nextWorkflow?: {
          referencePath?: string
          suggestedStyleProfileId?: string
          suggestedProfileTool?: string
        }
      }
      expect(manifest.requestHash).toMatch(/^[a-f0-9]{64}$/)
      expect(manifest.referenceProfile?.detectedTraits?.aspect).toBe('wide')
      expect(manifest.referenceProfile?.detectedTraits?.textSignals).toEqual([])
      expect(manifest.nextWorkflow?.referencePath).toBe(result.croppedImagePath)
      expect(manifest.nextWorkflow?.suggestedProfileTool).toBe('scientific_plotting_style_profiles')
      expect(manifest.nextWorkflow?.suggestedStyleProfileId).toBe(manifest.recommendedStyleProfile?.id)
      expect(result.styleProfileMatches?.[0]).toMatchObject({
        profileId: expect.any(String),
        score: expect.any(Number)
      })
      expect(manifest.styleProfileMatches?.[0]?.profileId).toBe(manifest.recommendedStyleProfile?.id)
      expect(manifest.styleProfileMatches?.[0]?.score).toBeGreaterThan(0.4)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('runs the v2 controlled style-transfer workflow with artifacts and review packet', async () => {
    const workspace = await tempWorkspace()
    try {
      await writeSyntheticReferenceImage(join(workspace, 'reference.png'))
      const result = await runScientificPlottingStyleTransfer({
        workspaceRoot: workspace,
        task: 'Use the reference paper style to draw a benchmark comparison bar chart.',
        figureId: 'v2-style-transfer-smoke',
        reference: {
          sourcePath: 'reference.png',
          figureId: 'v2-reference',
          cropBox: {
            unit: 'ratio',
            x: 0,
            y: 0,
            width: 1,
            height: 1
          }
        },
        labels: {
          title: 'Benchmark comparison',
          x: 'Model',
          y: 'Score',
          panel: 'V2'
        },
        data: {
          rows: [
            { model: 'Baseline', score: 0.61 },
            { model: 'SciForge', score: 0.78 },
            { model: 'Ablated', score: 0.69 }
          ]
        }
      })

      expect(result).toMatchObject({
        ok: true,
        status: 'completed',
        preparedReference: {
          status: 'prepared',
          recommendedStyleProfile: {
            id: expect.any(String)
          }
        },
        plan: {
          ok: true
        },
        mapping: {
          ok: true,
          selectedTemplate: 'bar'
        },
        render: {
          ok: true
        },
        reviewPacket: {
          ok: true
        },
        styleTransferManifest: {
          version: 2,
          tool: 'scientific_plotting_style_transfer',
          selectedTemplate: 'bar'
        }
      })
      if (!result.ok) return
      const reviewPacket = result.reviewPacket
      expect(reviewPacket?.ok).toBe(true)
      if (!reviewPacket?.ok) return
      await expect(stat(result.referenceImagePath!)).resolves.toBeTruthy()
      await expect(stat(result.outputPath!)).resolves.toBeTruthy()
      await expect(stat(result.renderManifestPath!)).resolves.toBeTruthy()
      await expect(stat(reviewPacket.packetPath)).resolves.toBeTruthy()
      await expect(stat(result.styleTransferManifestPath)).resolves.toBeTruthy()
      const manifest = JSON.parse(await readFile(result.styleTransferManifestPath, 'utf8')) as {
        version?: number
        requestHash?: string
        outputPath?: string
        renderManifestPath?: string
        reviewPacketPath?: string
      }
      expect(manifest.version).toBe(2)
      expect(manifest.requestHash).toMatch(/^[a-f0-9]{64}$/)
      expect(manifest.outputPath).toBe(result.outputPath)
      expect(manifest.renderManifestPath).toBe(result.renderManifestPath)
      expect(manifest.reviewPacketPath).toBe(reviewPacket.packetPath)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 90_000)

  it('fails style transfer fast for an unknown explicit style profile', async () => {
    const workspace = await tempWorkspace()
    try {
      const result = await runScientificPlottingStyleTransfer({
        workspaceRoot: workspace,
        task: 'Draw a paper-style benchmark line chart.',
        figureId: 'unknown-profile-style-transfer',
        styleProfileId: 'not-a-real-style-profile',
        labels: {
          title: 'Unknown profile',
          x: 'Step',
          y: 'Score'
        },
        data: {
          series: [
            {
              name: 'SciForge',
              x: [1, 2, 3],
              y: [0.2, 0.4, 0.7]
            }
          ]
        }
      })

      expect(result).toMatchObject({
        ok: false,
        status: 'invalid_request',
        message: 'Unknown scientific plotting style profile: not-a-real-style-profile.',
        styleProfiles: {
          ok: false,
          status: 'not_found'
        }
      })
      expect(result.warnings?.join(' ')).toContain('not-a-real-style-profile')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects output directories outside the workspace', async () => {
    const workspace = await tempWorkspace()
    try {
      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'line',
        outputDir: '../outside',
        data: {
          series: [
            { y: [1, 2, 3] }
          ]
        }
      })
      expect(result).toMatchObject({
        ok: false,
        status: 'invalid_workspace'
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects reference crop output directories outside the workspace', async () => {
    const workspace = await tempWorkspace()
    try {
      await writeSyntheticReferenceImage(join(workspace, 'reference.png'))
      const result = await prepareScientificPlottingReference({
        workspaceRoot: workspace,
        sourcePath: 'reference.png',
        outputDir: '../outside'
      })
      expect(result).toMatchObject({
        ok: false,
        status: 'invalid_workspace'
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
