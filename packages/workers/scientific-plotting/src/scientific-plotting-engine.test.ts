import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import type { FigureStyleSpec, VisualProductionHandoff } from './types'
import {
  buildScientificFigureNeedClassification,
  createScientificPlottingReviewPacket,
  getScientificPlottingStatus,
  listScientificPlottingStyleProfiles,
  mapScientificPlottingData as mapScientificPlottingDataEngine,
  planScientificPlotting,
  prepareScientificPlottingReference,
  compositeScientificPlotLayers,
  renderScientificPlot as renderScientificPlotEngine,
  reviewScientificPlottingOutput
} from './scientific-plotting-engine'

const CONTROLLED_PLOT_PLAN: VisualProductionHandoff = {
  planId: 'test-code-plan',
  route: 'code',
  routeLocked: true,
  rationale: 'Test exercises the controlled deterministic plotting route.',
  sourceArtifacts: [],
  reproducibleInputs: ['test fixture data'],
  lockedElements: ['all fixture values and labels'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'publication_ready',
  fallbackPolicy: 'fail_closed'
}

function mapScientificPlottingData(
  request: Omit<Parameters<typeof mapScientificPlottingDataEngine>[0], 'visualPlan'>
) {
  return mapScientificPlottingDataEngine({ ...request, visualPlan: CONTROLLED_PLOT_PLAN })
}

function renderScientificPlot(
  request: Omit<Parameters<typeof renderScientificPlotEngine>[0], 'visualPlan'>
) {
  return renderScientificPlotEngine({ ...request, visualPlan: CONTROLLED_PLOT_PLAN })
}

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
  it('fails closed when deterministic mapping bypasses visual_generate', async () => {
    const result = await mapScientificPlottingDataEngine({
      workspaceRoot: '/tmp',
      task: 'Draw a data plot.',
      data: { categories: ['A'], values: [1] }
    } as never)

    expect(result).toMatchObject({
      ok: false,
      status: 'invalid_request',
      missingInputs: ['visualPlan']
    })
  })

  it('plans a controlled attention map without executable commands', async () => {
    await expect(planScientificPlotting({
      task: 'Draw an attention heatmap from a token-by-token attention matrix.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'attention-map',
      controlledTool: 'scientific_plotting_render',
      templateAlternatives: expect.any(Array),
      planningWarnings: expect.any(Array)
    })
  })

  it('keeps style planning behind the unified visual plan', async () => {
    await expect(planScientificPlotting({
      task: 'Draw an attention heatmap in the style of a NeurIPS paper.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'attention-map',
      controlledTool: 'scientific_plotting_render',
      figureNeed: expect.objectContaining({
        recommendedNextTool: 'visual_generate'
      })
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
      task: 'Compare tensile strength distributions for three alloy recipes.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'box-violin',
      controlledTool: 'scientific_plotting_render'
    })

    await expect(planScientificPlotting({
      task: 'Make a multi-panel figure with a line panel and a heatmap panel.'
    })).resolves.toMatchObject({
      ok: true,
      recommendedTemplate: 'multi-panel',
      controlledTool: 'scientific_plotting_render'
    })

    const flowchartPlan = await planScientificPlotting({
      task: 'Draw a flowchart explaining the reinforcement learning workflow.'
    })
    expect(flowchartPlan).toMatchObject({
      ok: true,
      recommendedTemplate: 'flowchart',
      controlledTool: 'scientific_plotting_render',
      templateSelection: expect.objectContaining({
        selectedTemplate: 'flowchart',
        selectedBy: 'taskIntent',
        modelSelectionHint: expect.stringContaining('compact node-edge')
      }),
      templateGuides: expect.arrayContaining([
        expect.objectContaining({
          template: 'flowchart',
          modelSelectionHint: expect.stringContaining('visual_generate')
        }),
        expect.objectContaining({
          template: 'schematic-grid',
          avoidWhen: expect.arrayContaining([expect.stringContaining('flowchart')])
        })
      ])
    })

    const transformerPlan = await planScientificPlotting({
      task: '新建一张流程图，介绍 Transformer 架构和 Attention 数据流。',
      domain: 'AI/ML',
      targetVenue: 'NeurIPS'
    })
    expect(transformerPlan).toMatchObject({
      ok: true,
      recommendedTemplate: 'flowchart',
      controlledTool: 'scientific_plotting_render',
      figureNeed: expect.objectContaining({
        primaryNeed: 'model_architecture',
        route: 'needs_clarification',
        recommendedNextTool: 'visual_generate'
      })
    })

    const cellLineStatsPlan = await planScientificPlotting({
      task: 'Compare drug response distributions for four cell-line groups with significance.',
      domain: 'life science'
    })
    expect(cellLineStatsPlan).toMatchObject({
      ok: true,
      recommendedTemplate: 'box-violin',
      controlledTool: 'scientific_plotting_render',
      figureNeed: expect.objectContaining({
        primaryNeed: 'statistical_comparison',
        route: 'needs_clarification',
        recommendedNextTool: 'visual_generate'
      })
    })

    const plainBarPlan = await planScientificPlotting({
      task: '把季度收入数据画成柱状图。'
    })
    expect(plainBarPlan).toMatchObject({
      ok: true,
      recommendedTemplate: 'bar',
      controlledTool: 'scientific_plotting_render'
    })
    if (plainBarPlan.ok) {
      expect(plainBarPlan.externalSkillCatalog?.recommendedSkillIds).not.toContain('nature-figure')
      expect(plainBarPlan.externalSkillCatalog?.primarySources).not.toContain('cns')
    }

    const annotatedBarPlan = await planScientificPlotting({
      task: '把季度收入数据画成柱状图，并放大最高点加说明。'
    })
    expect(annotatedBarPlan).toMatchObject({
      ok: true,
      recommendedTemplate: 'bar',
      controlledTool: 'scientific_plotting_render'
    })

    const proseFlowchartPlan = await planScientificPlotting({
      task: '根据以下内容建一张流程图：One goal in reinforcement learning is to understand simulator use. In this paper, we argue that researchers need to distinguish simulator use cases and discuss several misleading conclusions from long prose.'
    })
    expect(proseFlowchartPlan).toMatchObject({
      ok: true,
      recommendedTemplate: 'flowchart',
      controlledTool: 'scientific_plotting_render'
    })
  })

  it('classifies paper-figure needs before choosing a renderer', async () => {
    const proseNeed = buildScientificFigureNeedClassification(
      '根据以下内容建一张流程图：One goal in reinforcement learning is to understand simulator use. In this paper, we argue that researchers need to distinguish simulator use cases and discuss several misleading conclusions from long prose about learning, deployment, benchmarking, evaluation metrics, and simulator access.',
      { domain: 'AI/ML' }
    )

    expect(proseNeed).toMatchObject({
      domain: 'ai-ml',
      route: 'needs_clarification',
      recommendedNextTool: 'visual_generate',
      avoidTemplates: ['flowchart']
    })
    expect(['method_flow', 'model_architecture']).toContain(proseNeed.primaryNeed)
    expect(proseNeed.warnings.join(' ')).toContain('Long prose')

    const cnsPlan = await planScientificPlotting({
      task: '根据一篇 Nature paper 设计肿瘤免疫机制图，突出 figure conclusion 和 evidence logic。',
      domain: 'life science',
      targetVenue: 'Nature'
    })

    expect(cnsPlan).toMatchObject({
      ok: true,
      controlledTool: 'scientific_plotting_render',
      figureNeed: expect.objectContaining({
        primaryNeed: 'mechanism_schematic',
        route: 'needs_clarification',
        recommendedNextTool: 'visual_generate'
      })
    })
    if (cnsPlan.ok) {
      expect(cnsPlan.externalSkillCatalog?.recommendedSkillIds).toContain('pathway-enrichment')
      expect(cnsPlan.externalSkillCatalog?.excludedSources.join(' ')).toContain('SciVisAgentSkills')
    }
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

  it('maps the route-locked VisualScene through the same schematic renderer', async () => {
    const workspace = await tempWorkspace()
    try {
      const scene = {
        version: 1 as const,
        coordinateSystem: 'normalized' as const,
        canvas: { width: 1200, height: 700 },
        layers: [{
          id: 'truth',
          owner: 'code' as const,
          primitives: [
            { id: 'start', type: 'circle' as const, x: 0.25, y: 0.5, radius: 0.1, fill: '#3366CC' },
            { id: 'end', type: 'triangle' as const, x: 0.75, y: 0.5, width: 0.2, height: 0.2, fill: '#DC3912' },
            { id: 'flow', type: 'arrow' as const, x1: 0.38, y1: 0.5, x2: 0.62, y2: 0.5 }
          ]
        }]
      }
      const mapping = await mapScientificPlottingDataEngine({
        workspaceRoot: workspace,
        task: 'Render the supplied exact vector scene.',
        data: scene,
        visualPlan: {
          ...CONTROLLED_PLOT_PLAN,
          reproducibleInputs: [],
          lockedElements: [],
          scene
        }
      })

      expect(mapping).toMatchObject({
        ok: true,
        selectedTemplate: 'schematic-grid',
        renderRequest: {
          template: 'schematic-grid',
          data: {
            primitives: expect.arrayContaining([
              expect.objectContaining({ id: 'start', type: 'circle' }),
              expect.objectContaining({ id: 'flow', type: 'arrow' })
            ])
          },
          reviewTask: 'Render the supplied exact vector scene.'
        }
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects raw vector-scene data outside the unified VisualScene handoff', async () => {
    const workspace = await tempWorkspace()
    try {
      const mapping = await mapScientificPlottingData({
        workspaceRoot: workspace,
        task: 'Render a vector scene.',
        data: { primitives: [{ type: 'circle', x: 0.5, y: 0.5, radius: 0.1 }] }
      })
      expect(mapping).toMatchObject({
        ok: false,
        status: 'invalid_request',
        missingInputs: ['visualPlan.scene']
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('renders print-scale PNGs without changing the plotting data contract', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const rendered = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'bar',
        figureId: 'scaled-bar',
        outputScale: 2,
        styleProfileId: 'nature-publication-light',
        labels: {
          title: 'Scaled output',
          x: 'Tier',
          y: 'Count'
        },
        data: {
          categories: ['Tier 0', 'Tier 1', 'Tier 2'],
          series: [{ name: 'Gene count', values: [6, 4, 3] }]
        }
      })
      expect(rendered).toMatchObject({ ok: true, status: 'rendered' })
      if (!rendered.ok) return
      const dimensions = await loadImage(rendered.outputPath)
      expect(dimensions.width).toBeGreaterThanOrEqual(2400)
      const outputHash = createHash('sha256').update(await readFile(rendered.outputPath)).digest('hex')
      const manifest = JSON.parse(await readFile(rendered.manifestPath, 'utf8')) as {
        outputScale?: number
        outputHash?: string
        visualPlan?: { planId?: string }
        warnings?: string[]
      }
      expect(manifest.outputScale).toBe(2)
      expect(manifest.outputHash).toBe(outputHash)
      expect(manifest.visualPlan?.planId).toBe(CONTROLLED_PLOT_PLAN.planId)
      expect(manifest.warnings?.join('\n')).toContain('outputScale=2')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders horizontal bar charts for long category labels', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }

    const workspace = await tempWorkspace()
    try {
      const rendered = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'bar',
        figureId: 'horizontal-bar',
        styleProfileId: 'nature-publication-light',
        labels: {
          title: 'Evidence categories',
          x: 'Candidate genes',
          y: 'Functional role',
          legend: false
        },
        data: {
          orientation: 'horizontal',
          showValues: true,
          categories: ['Context visibility', 'Competence chromatin', 'Post-transcriptional'],
          series: [{
            name: 'Gene count',
            values: [6, 5, 4],
            colors: ['#0072B2', '#009E73', '#D55E00']
          }]
        }
      })
      expect(rendered).toMatchObject({ ok: true, status: 'rendered' })
      if (!rendered.ok) return
      expect((await stat(rendered.outputPath)).size).toBeGreaterThan(1000)
      const manifest = JSON.parse(await readFile(rendered.manifestPath, 'utf8')) as {
        attempts: Array<{
          rendererDiagnostics?: {
            barOrientation?: string
            barColorMode?: string
            categoryLabelRotation?: number
            layoutNotes?: string[]
          }
        }>
      }
      expect(manifest.attempts[0]?.rendererDiagnostics).toMatchObject({
        barOrientation: 'horizontal',
        barColorMode: 'per-bar',
        categoryLabelRotation: 0
      })
      expect(manifest.attempts[0]?.rendererDiagnostics?.layoutNotes).toContain('Added compact value labels to categorical bars.')
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

      const flowchart = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'flowchart',
        figureId: 'flowchart-smoke',
        labels: {
          title: 'Controlled workflow'
        },
        data: {
          nodes: [
            { id: 'goal', label: 'Research goal' },
            { id: 'data', label: 'Collect data' },
            { id: 'train', label: 'Train model' },
            { id: 'eval', label: 'Evaluate result' }
          ],
          edges: [
            { from: 'goal', to: 'data' },
            { from: 'data', to: 'train' },
            { from: 'train', to: 'eval' }
          ]
        }
      })
      expect(flowchart).toMatchObject({ ok: true, status: 'rendered' })
      if (!flowchart.ok) return
      expect((await stat(flowchart.outputPath)).size).toBeGreaterThan(1000)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('fails closed within the code route for oversized flowcharts', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }
    const workspace = await tempWorkspace()
    try {
      const result = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'flowchart',
        figureId: 'dense-flowchart',
        data: {
          nodes: Array.from({ length: 13 }, (_, index) => ({
            id: `n${index}`,
            label: `Long prose-derived concept ${index}`
          }))
        }
      })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected dense flowchart to fail')
      expect(result.message).toContain('locked code route')
      expect(result.message).not.toContain('image_generation')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('deterministically composites model layers below code-owned truth layers', async () => {
    const workspace = await tempWorkspace()
    try {
      const modelPath = join(workspace, 'model.png')
      const truthPath = join(workspace, 'truth.png')
      const model = createCanvas(100, 80)
      const modelContext = model.getContext('2d')
      modelContext.fillStyle = '#1d4ed8'
      modelContext.fillRect(0, 0, 100, 80)
      await writeFile(modelPath, model.toBuffer('image/png'))
      const truth = createCanvas(20, 20)
      const truthContext = truth.getContext('2d')
      truthContext.fillStyle = '#16a34a'
      truthContext.fillRect(0, 0, 20, 20)
      await writeFile(truthPath, truth.toBuffer('image/png'))

      const result = await compositeScientificPlotLayers({
        workspaceRoot: workspace,
        reviewTask: 'Review the composed hybrid artifact.',
        visualPlan: {
          ...CONTROLLED_PLOT_PLAN,
          route: 'hybrid',
          modelOwnedElements: ['background color and texture']
        },
        layers: [
          { path: truthPath, owner: 'code', bounds: { unit: 'pixel', x: 10, y: 10, width: 40, height: 40 } },
          { path: modelPath, owner: 'model' }
        ],
        canvas: { width: 128, height: 128 },
        figureId: 'hybrid-composite-test'
      })

      expect(result).toMatchObject({
        ok: true,
        status: 'composed',
        layers: [
          { owner: 'model', sha256: expect.any(String) },
          { owner: 'code', opacity: 1, sha256: expect.any(String) }
        ]
      })
      if (!result.ok) return
      const output = await loadImage(result.outputPath)
      const outputCanvas = createCanvas(output.width, output.height)
      const outputContext = outputCanvas.getContext('2d')
      outputContext.drawImage(output, 0, 0)
      expect([...outputContext.getImageData(20, 20, 1, 1).data].slice(0, 3)).toEqual([22, 163, 74])
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'))
      const outputHash = createHash('sha256').update(await readFile(result.outputPath)).digest('hex')
      expect(manifest).toMatchObject({
        tool: 'scientific_plotting_composite',
        outputHash,
        visualPlan: { planId: CONTROLLED_PLOT_PLAN.planId, route: 'hybrid' },
        layers: [
          { owner: 'model', sha256: expect.any(String) },
          { owner: 'code', sha256: expect.any(String) }
        ]
      })
      await expect(stat(result.artifactManifestPath)).resolves.toBeTruthy()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('renders v1.14 statistical and multi-panel templates as non-empty PNGs', async () => {
    const status = await getScientificPlottingStatus()
    if (!status.ok || !status.renderer.available) {
      expect(status.ok && status.degraded).toBe(true)
      return
    }
    expect(status.ok && status.supportedTemplates).toEqual(expect.arrayContaining([
      'box-violin',
      'flowchart',
      'histogram-density',
      'multi-panel'
    ]))
    expect(status.ok && status.templateGuides).toEqual(expect.arrayContaining([
      expect.objectContaining({
        template: 'flowchart',
        useWhen: expect.arrayContaining([expect.stringContaining('workflows')])
      }),
      expect.objectContaining({
        template: 'schematic-grid',
        modelSelectionHint: expect.stringContaining('flowchart instead')
      })
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
          showPoints: true,
          comparisons: [
            { from: 'Control', to: 'High dose', label: '***' }
          ]
        }
      })
      expect(boxViolin).toMatchObject({ ok: true, status: 'rendered' })
      if (!boxViolin.ok) return
      expect((await stat(boxViolin.outputPath)).size).toBeGreaterThan(1000)
      expect(boxViolin.attempts[0]?.rendererDiagnostics).toMatchObject({
        layoutNotes: expect.arrayContaining([
          'Rendered compact group-comparison brackets for distribution panels.'
        ])
      })

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

      const heatmapWithAliasLabels = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'heatmap',
        figureId: 'heatmap-alias-labels-smoke',
        labels: {
          title: 'Structure evidence',
          x: 'Evidence dimension',
          y: 'Gene target'
        },
        data: {
          matrix: [
            [1, 0.9, 0.7],
            [0.8, 0.65, 0.5]
          ],
          rowLabels: ['STRA8', 'MEIOSIN'],
          colLabels: ['AF2 monomer', 'Disorder', 'PAE matrix']
        }
      })
      expect(heatmapWithAliasLabels).toMatchObject({ ok: true, status: 'rendered' })
      if (!heatmapWithAliasLabels.ok) return
      expect((await stat(heatmapWithAliasLabels.outputPath)).size).toBeGreaterThan(1000)
      expect(heatmapWithAliasLabels.attempts[0]?.rendererDiagnostics?.categoryLabelRotation).toBeGreaterThan(0)

      const schematicWithAliasEdges = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'schematic-grid',
        figureId: 'schematic-source-target-smoke',
        labels: {
          title: 'Trigger hierarchy'
        },
        data: {
          nodes: [
            { id: 'ra', label: 'RA gradient', x: 0.18, y: 0.5, shape: 'circle', color: '#2166AC' },
            {
              id: 'rar',
              label: 'RAR/RXR\nlicensing context\nnode',
              x: 0.48,
              y: 0.5,
              width: 0.28,
              height: 0.18,
              maxLineLength: 12,
              maxLines: 4,
              color: '#4DAF4A'
            },
            { id: 'stra8', label: 'STRA8/MEIOSIN trigger', x: 0.78, y: 0.5, shape: 'triangle', color: '#D6604D' }
          ],
          primitives: [
            { type: 'ellipse', x: 0.5, y: 0.18, width: 0.22, height: 0.08, fill: '#F0F0F0', stroke: '#333333' },
            { type: 'line', x1: 0.3, y1: 0.82, x2: 0.7, y2: 0.82, stroke: '#333333', strokeWidth: 1.5 },
            { type: 'text', x: 0.5, y: 0.88, text: 'Regulatory axis', fontSize: 8 }
          ],
          edges: [
            { source: 'ra', target: 'rar', label: 'binds' },
            { source: 'rar', target: 'stra8', label: 'activates', style: 'dashed' }
          ]
        }
      })
      expect(schematicWithAliasEdges).toMatchObject({ ok: true, status: 'rendered' })
      if (!schematicWithAliasEdges.ok) return
      expect((await stat(schematicWithAliasEdges.outputPath)).size).toBeGreaterThan(1000)
      expect(schematicWithAliasEdges.attempts[0]?.rendererDiagnostics?.layoutNotes).toEqual(expect.arrayContaining([
        'Used explicit schematic node coordinates.',
        'Preserved and wrapped schematic node labels within node bounds.',
        'Rendered 2 of 2 schematic edges.'
      ]))
      expect(schematicWithAliasEdges.attempts[0]?.rendererDiagnostics).toMatchObject({
        schematicNodeCount: 3,
        schematicEdgeCount: 2,
        schematicPrimitiveCount: 3,
        schematicExplicitPositions: true
      })

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
              data: { x: [10, 20, 30, 40], series: [{ name: 'A', y: [0.2, 0.4, 0.65, 0.8] }] }
            },
            {
              template: 'heatmap',
              labels: { title: 'Matrix' },
              data: { matrix: [[0.1, 0.4], [0.7, 0.2]], x: ['gene_a', 'gene_b'], y: ['cell_1', 'cell_2'], colorbar: false }
            },
            {
              template: 'box-violin',
              labels: { title: 'Groups', y: 'Value' },
              data: {
                groups: [
                  { name: 'A', values: [1, 1.2, 1.1] },
                  { name: 'B', values: [1.4, 1.6, 1.5] }
                ],
                comparisons: [
                  { from: 'A', to: 'B', label: '*' }
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
          'Rendered compact group-comparison brackets for distribution panels.',
          'Rendered 3 controlled subpanels in a 2x2 layout.'
        ])
      })

      const scatterWithErrors = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'scatter',
        figureId: 'scatter-errorbar-smoke',
        labels: {
          title: 'Isotope summary',
          x: 'delta 13C',
          y: 'delta 15N',
          legend: true
        },
        data: {
          xlim: [-26.5, -24.5],
          ylim: [8.2, 9.25],
          series: [
            { name: 'Male', x: [-25.8], y: [8.72], xerr: [0.18], yerr: [0.08] },
            { name: 'Female', x: [-25.35], y: [8.86], xerr: [0.16], yerr: [0.07] }
          ]
        }
      })
      expect(scatterWithErrors).toMatchObject({ ok: true, status: 'rendered' })
      if (!scatterWithErrors.ok) return
      expect((await stat(scatterWithErrors.outputPath)).size).toBeGreaterThan(1000)

      const multiPanelScatterWithErrors = await renderScientificPlot({
        workspaceRoot: workspace,
        template: 'multi-panel',
        figureId: 'multi-panel-scatter-errorbar-smoke',
        styleSpec: {
          ...referenceStyleSpec('multi-panel-scatter-errorbar'),
          layout: {
            ...referenceStyleSpec('multi-panel-scatter-errorbar').layout,
            panelGrid: '1x2',
            panelLabels: 'none'
          }
        },
        labels: {
          title: 'Summary scatter with uncertainty'
        },
        data: {
          columns: 2,
          panels: [
            {
              template: 'scatter',
              labels: { title: '2007', x: 'delta 13C', y: 'delta 15N' },
              data: {
                xlim: [-26.5, -24.5],
                ylim: [8.2, 9.25],
                series: [
                  { name: 'Male', x: [-25.8], y: [8.72], xerr: [0.18], yerr: [0.08] },
                  { name: 'Female', x: [-25.35], y: [8.86], xerr: [0.16], yerr: [0.07] }
                ]
              }
            },
            {
              template: 'scatter',
              labels: { title: '2008', x: 'delta 13C', y: 'delta 15N' },
              data: {
                xlim: [-26.5, -24.5],
                ylim: [8.2, 9.25],
                series: [
                  { name: 'Male', x: [-25.75], y: [8.62], xerr: [0.12], yerr: [0.06] },
                  { name: 'Female', x: [-25.42], y: [8.78], xerr: [0.15], yerr: [0.07] }
                ]
              }
            }
          ]
        }
      })
      expect(multiPanelScatterWithErrors).toMatchObject({ ok: true, status: 'rendered' })
      if (!multiPanelScatterWithErrors.ok) return
      expect((await stat(multiPanelScatterWithErrors.outputPath)).size).toBeGreaterThan(1000)
      expect(multiPanelScatterWithErrors.attempts[0]?.rendererDiagnostics).toMatchObject({
        multiPanelCount: 2
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 60_000)

  it('renders CJK labels with a font fallback instead of tofu boxes', async () => {
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
        figureId: 'cjk-label-smoke',
        labels: {
          title: '气候异常趋势',
          x: '月份',
          y: '温度异常值',
          legend: true
        },
        data: {
          series: [
            { name: '二氧化碳异常', x: ['一月', '二月', '三月', '四月'], y: [0.2, 0.35, 0.31, 0.48] },
            { name: '海温异常', x: ['一月', '二月', '三月', '四月'], y: [0.12, 0.18, 0.22, 0.27] }
          ]
        }
      })

      expect(result).toMatchObject({ ok: true, status: 'rendered' })
      if (!result.ok) return
      expect((await stat(result.outputPath)).size).toBeGreaterThan(1000)
      const fontFallback = result.attempts[0]?.rendererDiagnostics?.fontFallback
      expect(fontFallback).toHaveProperty('cjk')
      if (process.platform === 'darwin') {
        expect(fontFallback?.cjk).toEqual(expect.any(String))
      }
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as {
        attempts: Array<{
          rendererDiagnostics?: {
            fontFallback?: { cjk?: string | null }
          }
        }>
      }
      expect(manifest.attempts[0]?.rendererDiagnostics?.fontFallback).toHaveProperty('cjk')
      if (process.platform === 'darwin') {
        expect(manifest.attempts[0]?.rendererDiagnostics?.fontFallback?.cjk).toEqual(expect.any(String))
      }
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
        metric: {
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
              styleSimilarity: {
                overall: expect.any(Number)
              },
              styleRepairSuggested: expect.any(Boolean),
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
          suggestedPlanTool: 'visual_generate',
          suggestedRenderTool: 'scientific_plotting_render',
          suggestedReviewTool: 'visual_artifact_review'
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
