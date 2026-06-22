import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const workspaceRoot = process.cwd()
const entry = join(workspaceRoot, 'out/main/scientific-plotting-mcp-node-entry.js')
const outputDir = process.env.SCIFORGE_PLOTTING_REGRESSION_OUTPUT ?? 'tmp/scientific-plotting-style-regression'

const oversizedTypographyStyle = {
  version: 1,
  source: {
    path: 'v117-inline-style',
    type: 'image',
    figureId: 'v117-typography-clamp'
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
    axisSize: 14,
    labelSize: 18,
    titleSize: 24,
    weight: 'bold'
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

const cases = [
  {
    id: 'nature-2021-alphafold-fig2',
    label: 'Nature 2021 AlphaFold Fig. 2',
    template: 'errorbar-bar',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2021-alphafold-fig2-style.json',
    referencePath: 'tmp/figure-style-paper-smoke/references/nature-2021-alphafold-fig2.png',
    labels: {
      title: 'Structure prediction benchmark',
      x: 'Target class',
      y: 'Median score',
      legend: true,
      panel: 'A'
    },
    data: {
      categories: ['Free modeling', 'Template', 'Multimer', 'All'],
      series: [
        { name: 'SciForge', values: [74, 81, 68, 77], error: [2.4, 1.8, 3.1, 2.2] },
        { name: 'Baseline', values: [61, 72, 56, 66], error: [3.2, 2.5, 3.5, 2.8] }
      ]
    }
  },
  {
    id: 'nature-2020-numpy-fig1',
    label: 'Nature 2020 NumPy Fig. 1',
    template: 'schematic-grid',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2020-numpy-fig1-style.json',
    referencePath: 'tmp/figure-style-paper-smoke/references/nature-2020-numpy-fig1.png',
    labels: {
      title: 'Array workflow sketch',
      panel: 'B'
    },
    data: {
      nodes: [
        { id: 'raw', label: 'Raw arrays' },
        { id: 'clean', label: 'Vectorized ops' },
        { id: 'model', label: 'Model fit' },
        { id: 'figure', label: 'Publication figure' },
        { id: 'audit', label: 'Manifest' }
      ],
      edges: [
        { from: 'raw', to: 'clean' },
        { from: 'clean', to: 'model' },
        { from: 'model', to: 'figure' },
        { from: 'figure', to: 'audit' }
      ]
    }
  },
  {
    id: 'neurips-2017-attention-x1',
    label: 'NeurIPS 2017 Attention visualization',
    template: 'attention-map',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/neurips-2017-attention-x1-style.json',
    referencePath: 'tmp/figure-style-paper-smoke/references/neurips-2017-attention-x1.png',
    labels: {
      title: 'Attention weights',
      x: 'Target token',
      y: 'Source token',
      panel: 'C'
    },
    data: {
      matrix: [
        [0.92, 0.15, 0.08, 0.03, 0.01, 0.02],
        [0.12, 0.86, 0.22, 0.07, 0.03, 0.01],
        [0.05, 0.28, 0.78, 0.26, 0.08, 0.03],
        [0.02, 0.07, 0.31, 0.82, 0.24, 0.06],
        [0.01, 0.02, 0.08, 0.22, 0.87, 0.19],
        [0.01, 0.01, 0.03, 0.05, 0.21, 0.91]
      ],
      xLabels: ['the', 'cat', 'sat', 'on', 'the', 'mat'],
      yLabels: ['le', 'chat', 'assis', 'sur', 'le', 'tapis'],
      cmap: 'viridis'
    }
  },
  {
    id: 'v114-box-violin',
    label: 'v1.14 Controlled box/violin',
    template: 'box-violin',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2021-alphafold-fig2-style.json',
    labels: {
      title: 'Response distribution by condition',
      x: 'Condition',
      y: 'Response',
      panel: 'D'
    },
    data: {
      groups: [
        { name: 'Control', values: [0.82, 0.91, 0.94, 1.02, 1.08, 1.12, 0.99, 0.88] },
        { name: 'Treatment A', values: [1.12, 1.18, 1.25, 1.32, 1.41, 1.36, 1.29, 1.22] },
        { name: 'Treatment B', values: [1.35, 1.48, 1.55, 1.61, 1.72, 1.66, 1.58, 1.45] }
      ],
      showPoints: true
    }
  },
  {
    id: 'v114-histogram-density',
    label: 'v1.14 Controlled histogram/density',
    template: 'histogram-density',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2021-alphafold-fig2-style.json',
    labels: {
      title: 'Residual distribution',
      x: 'Residual',
      y: 'Density',
      legend: true,
      panel: 'E'
    },
    data: {
      bins: 14,
      series: [
        { name: 'Model A', values: [-1.18, -0.92, -0.67, -0.35, -0.16, 0.08, 0.22, 0.38, 0.51, 0.74, 0.95, 1.2] },
        { name: 'Model B', values: [-0.82, -0.61, -0.42, -0.22, -0.05, 0.12, 0.28, 0.39, 0.54, 0.69, 0.86, 1.02] }
      ]
    }
  },
  {
    id: 'v114-multi-panel',
    label: 'v1.14 Controlled multi-panel',
    template: 'multi-panel',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2021-alphafold-fig2-style.json',
    labels: {
      title: 'Integrated model audit'
    },
    data: {
      columns: 2,
      panels: [
        {
          template: 'line',
          labels: { title: 'Training curve', x: 'Epoch', y: 'Score' },
          data: {
            series: [
              { name: 'SciForge', y: [0.32, 0.48, 0.61, 0.73, 0.81] },
              { name: 'Baseline', y: [0.27, 0.39, 0.52, 0.63, 0.7] }
            ]
          }
        },
        {
          template: 'attention-map',
          labels: { title: 'Attention block' },
          data: {
            matrix: [
              [0.9, 0.1, 0.04],
              [0.18, 0.76, 0.22],
              [0.05, 0.26, 0.84]
            ],
            cmap: 'magma'
          }
        },
        {
          template: 'box-violin',
          labels: { title: 'Cohort spread', y: 'Value' },
          data: {
            groups: [
              { name: 'A', values: [0.9, 1.0, 1.1, 1.2] },
              { name: 'B', values: [1.3, 1.42, 1.5, 1.62] }
            ]
          }
        },
        {
          template: 'bar',
          labels: { title: 'Summary', y: 'Metric' },
          data: {
            categories: ['F1', 'AUROC', 'AUPRC'],
            series: [
              { name: 'SciForge', values: [0.82, 0.88, 0.79] }
            ]
          }
        }
      ]
    }
  },
  {
    id: 'v117-typography-clamp',
    label: 'v1.17 Typography clamp',
    template: 'line',
    styleSpec: oversizedTypographyStyle,
    labels: {
      title: 'Long scientific figure title before typography clamp',
      x: 'Epoch',
      y: 'Score',
      panel: 'G'
    },
    data: {
      series: [
        { name: 'SciForge', x: [1, 2, 3, 4, 5], y: [0.32, 0.48, 0.61, 0.73, 0.81] },
        { name: 'Baseline', x: [1, 2, 3, 4, 5], y: [0.27, 0.39, 0.52, 0.63, 0.7] }
      ]
    }
  },
  {
    id: 'v118-legend-layout-qa',
    label: 'v1.18 Legend layout QA',
    template: 'line',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2021-alphafold-fig2-style.json',
    labels: {
      title: 'Dense legend layout check',
      x: 'Epoch',
      y: 'Score',
      panel: 'H',
      legend: true
    },
    data: {
      series: [
        { name: 'SciForge calibrated model', x: [1, 2, 3, 4, 5], y: [0.22, 0.46, 0.62, 0.76, 0.84] },
        { name: 'Baseline long-context model', x: [1, 2, 3, 4, 5], y: [0.18, 0.36, 0.55, 0.68, 0.74] },
        { name: 'Ablated retrieval variant', x: [1, 2, 3, 4, 5], y: [0.15, 0.31, 0.5, 0.61, 0.68] },
        { name: 'Compact control variant', x: [1, 2, 3, 4, 5], y: [0.12, 0.25, 0.41, 0.54, 0.6] }
      ]
    }
  },
  {
    id: 'v120-style-profile-registry',
    label: 'v1.20 Style profile registry',
    template: 'line',
    styleProfileId: 'nature-2021-alphafold-fig2',
    labels: {
      title: 'Profile-driven response curve',
      x: 'Epoch',
      y: 'Score',
      panel: 'I',
      legend: true
    },
    data: {
      series: [
        { name: 'Profile A', x: [1, 2, 3, 4, 5], y: [0.24, 0.42, 0.61, 0.72, 0.83] },
        { name: 'Profile B', x: [1, 2, 3, 4, 5], y: [0.19, 0.35, 0.52, 0.66, 0.75] }
      ]
    }
  }
]

const referencePreparationChecks = [
  {
    id: 'v115-alphafold-reference-prep',
    label: 'v1.15 AlphaFold reference preparation',
    sourcePath: 'tmp/figure-style-paper-smoke/references/nature-2021-alphafold-fig2.png',
    sourceType: 'image',
    figureId: 'v115-alphafold-reference-prep',
    cropBox: {
      unit: 'ratio',
      x: 0,
      y: 0,
      width: 1,
      height: 1
    }
  }
]

const mappedRenderChecks = [
  {
    id: 'v116-tabular-distribution-map',
    label: 'v1.16 Tabular distribution mapping',
    task: 'Create a violin plot comparing treatment distributions.',
    styleSpecPath: 'tmp/figure-style-paper-smoke/styles/nature-2021-alphafold-fig2-style.json',
    labels: {
      title: 'Mapped response by treatment',
      x: 'Treatment',
      y: 'Response',
      panel: 'F'
    },
    data: {
      rows: [
        { treatment: 'Control', response: 0.82 },
        { treatment: 'Control', response: 0.91 },
        { treatment: 'Control', response: 1.03 },
        { treatment: 'Low dose', response: 1.16 },
        { treatment: 'Low dose', response: 1.24 },
        { treatment: 'Low dose', response: 1.31 },
        { treatment: 'High dose', response: 1.42 },
        { treatment: 'High dose', response: 1.55 },
        { treatment: 'High dose', response: 1.63 }
      ]
    }
  }
]

async function assertFile(relativePath) {
  try {
    await access(join(workspaceRoot, relativePath))
  } catch {
    throw new Error(`Required smoke asset is missing: ${relativePath}`)
  }
}

function scoreFrom(result) {
  return result?.review?.ok ? result.review.score : result?.attempts?.at(-1)?.review?.ok ? result.attempts.at(-1).review.score : null
}

function firstWarnings(result) {
  const score = scoreFrom(result)
  const layoutWarnings = result?.attempts?.at(-1)?.rendererDiagnostics?.layoutQuality?.warnings ?? []
  const warnings = [...(score?.warnings ?? result?.warnings ?? []), ...layoutWarnings]
  return warnings.slice(0, 3)
}

function typographyFrom(result) {
  return result?.attempts?.at(-1)?.rendererDiagnostics?.typography ?? null
}

function layoutQualityFrom(result) {
  return result?.attempts?.at(-1)?.rendererDiagnostics?.layoutQuality ?? null
}

function markdownSummary(payload) {
  const lines = [
    '# Scientific Plotting Style Regression',
    '',
    `Generated at: ${payload.generatedAt}`,
    '',
    `Tools: ${payload.toolNames.join(', ')}`,
    '',
    '| Case | Template | Status | Overall | Palette | Typography | Layout QA | Output | Manifest | Warnings |',
    '| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |'
  ]
  for (const item of payload.results) {
    const score = scoreFrom(item.result)
    const typography = typographyFrom(item.result)
    const layoutQuality = layoutQualityFrom(item.result)
    const outputPath = item.result?.ok ? item.result.outputPath : ''
    const manifestPath = item.result?.ok ? item.result.manifestPath : ''
    lines.push(`| ${[
      item.label,
      item.template,
      item.result?.status ?? 'failed',
      score ? score.overall.toFixed(3) : '',
      score ? score.palette.toFixed(3) : '',
      score?.typography !== undefined
        ? score.typography.toFixed(3)
        : typography
          ? `title ${typography.titleSize}, label ${typography.labelSize}, tick ${typography.tickSize}, clamp ${typography.publicationClampApplied}`
          : '',
      layoutQuality
        ? `legend ${layoutQuality.legendOutsidePlot ? 'outside' : 'inside'}, overlap ${layoutQuality.legendOverlapRisk}, text ${layoutQuality.textOverflowRisk}`
        : '',
      outputPath,
      manifestPath,
      firstWarnings(item.result).join('<br>')
    ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
  }
  if (payload.preparedReferences.length > 0) {
    lines.push('')
    lines.push('| Prepared Reference | Status | Cropped PNG | Reference Manifest | Recommended Template | Warnings |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const item of payload.preparedReferences) {
      const result = item.result
      lines.push(`| ${[
        item.label,
        result?.status ?? 'failed',
        result?.ok ? result.croppedImagePath : '',
        result?.ok ? result.referenceManifestPath : '',
        result?.ok ? result.referenceProfile?.recommendedTemplate ?? '' : '',
        result?.ok ? result.warnings.join('<br>') : result?.message ?? ''
      ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
    }
  }
  if (payload.mappedRenders.length > 0) {
    lines.push('')
    lines.push('| Mapped Render | Mapping Status | Selected Template | Confidence | Output | Warnings |')
    lines.push('| --- | --- | --- | ---: | --- | --- |')
    for (const item of payload.mappedRenders) {
      lines.push(`| ${[
        item.label,
        item.mapping?.status ?? 'failed',
        item.mapping?.ok ? item.mapping.selectedTemplate : '',
        item.mapping?.ok ? item.mapping.confidence.toFixed(2) : '',
        item.result?.ok ? item.result.outputPath : '',
        item.mapping?.ok ? item.mapping.warnings.slice(0, 3).join('<br>') : item.mapping?.message ?? ''
      ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
    }
  }
  if (payload.styleProfiles?.ok) {
    lines.push('')
    lines.push('| Style Profiles | Total | Returned | First Profile | Warnings |')
    lines.push('| --- | ---: | ---: | --- | --- |')
    lines.push(`| ${[
      payload.styleProfiles.status,
      payload.styleProfiles.total,
      payload.styleProfiles.profiles?.length ?? 0,
      payload.styleProfiles.profiles?.[0]?.id ?? '',
      payload.styleProfiles.warnings?.slice(0, 3).join('<br>') ?? ''
    ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
  }
  if (payload.referenceStyleProfiles?.ok) {
    lines.push('')
    lines.push('| Reference Style Match | Total | Selected Profile | Score | Reasons | Warnings |')
    lines.push('| --- | ---: | --- | ---: | --- | --- |')
    const topMatch = payload.referenceStyleProfiles.profileMatches?.[0]
    lines.push(`| ${[
      payload.referenceStyleProfiles.status,
      payload.referenceStyleProfiles.total,
      payload.referenceStyleProfiles.selectedProfile?.id ?? topMatch?.profileId ?? '',
      topMatch?.score?.toFixed?.(3) ?? '',
      topMatch?.reasons?.slice(0, 3).join('<br>') ?? '',
      payload.referenceStyleProfiles.warnings?.slice(0, 3).join('<br>') ?? ''
    ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
  }
  if (payload.v2StyleTransfer) {
    lines.push('')
    lines.push('| V2 Style Transfer | Status | Reference | Output | Render Manifest | Review Packet | V2 Manifest | Warnings |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
    lines.push(`| ${[
      payload.v2StyleTransfer.ok ? 'ok' : 'failed',
      payload.v2StyleTransfer.status ?? '',
      payload.v2StyleTransfer.referenceImagePath ?? '',
      payload.v2StyleTransfer.outputPath ?? '',
      payload.v2StyleTransfer.renderManifestPath ?? '',
      payload.v2StyleTransfer.reviewPacket?.ok ? payload.v2StyleTransfer.reviewPacket.packetPath : '',
      payload.v2StyleTransfer.styleTransferManifestPath ?? '',
      payload.v2StyleTransfer.warnings?.slice(0, 3).join('<br>') ?? payload.v2StyleTransfer.message ?? ''
    ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
  }
  if (payload.reviewPacket?.ok) {
    lines.push('')
    lines.push('| Review Packet | Items | Needs Attention | Average Overall | Markdown | JSON | Warnings |')
    lines.push('| --- | ---: | ---: | ---: | --- | --- | --- |')
    lines.push(`| ${[
      payload.reviewPacket.packet?.title ?? 'v1.19 Review Packet',
      payload.reviewPacket.packet?.itemCount ?? '',
      payload.reviewPacket.packet?.summary?.needsAttention ?? '',
      payload.reviewPacket.packet?.summary?.averageOverall?.toFixed?.(3) ?? '',
      payload.reviewPacket.packetPath,
      payload.reviewPacket.packetJsonPath,
      payload.reviewPacket.warnings?.slice(0, 3).join('<br>') ?? ''
    ].map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

for (const item of referencePreparationChecks) {
  await assertFile(item.sourcePath)
}
for (const item of cases) {
  if (item.referencePath) await assertFile(item.referencePath)
  if (item.styleSpecPath) await assertFile(item.styleSpecPath)
}
for (const item of mappedRenderChecks) {
  await assertFile(item.styleSpecPath)
}
await assertFile('out/main/scientific-plotting-mcp-node-entry.js')
await mkdir(join(workspaceRoot, outputDir), { recursive: true })

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    entry,
    '--scientific-plotting-mcp-server',
    '--workspace-root',
    workspaceRoot
  ],
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  },
  stderr: 'pipe'
})

const client = new Client({ name: 'scientific-plotting-style-regression', version: '0.1.0' })
await client.connect(transport, { timeout: 30_000 })

const tools = await client.listTools()
const status = await client.callTool({
  name: 'scientific_plotting_status',
  arguments: {}
})
const styleProfiles = await client.callTool({
  name: 'scientific_plotting_style_profiles',
  arguments: {
    query: 'nature neurips attention',
    topK: 5
  }
})
const referenceStyleProfiles = await client.callTool({
  name: 'scientific_plotting_style_profiles',
  arguments: {
    referencePath: 'tmp/figure-style-paper-smoke/references/nature-2021-alphafold-fig2.png',
    topK: 3
  }
}, undefined, { timeout: 60_000 })

const preparedReferences = []
for (const item of referencePreparationChecks) {
  const response = await client.callTool({
    name: 'scientific_plotting_prepare_reference',
    arguments: {
      sourcePath: item.sourcePath,
      sourceType: item.sourceType,
      figureId: item.figureId,
      cropBox: item.cropBox,
      outputDir,
      extractStyle: true
    }
  }, undefined, { timeout: 60_000 })
  preparedReferences.push({
    id: item.id,
    label: item.label,
    sourcePath: join(workspaceRoot, item.sourcePath),
    result: response.structuredContent?.result
  })
}

const v2StyleTransferResponse = await client.callTool({
  name: 'scientific_plotting_style_transfer',
  arguments: {
    task: 'Use the reference paper style to draw a benchmark comparison bar chart.',
    figureId: 'v2-scientific-plotting-style-transfer',
    reference: {
      sourcePath: 'tmp/figure-style-paper-smoke/references/nature-2021-alphafold-fig2.png',
      sourceType: 'image',
      figureId: 'v2-scientific-plotting-reference',
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
    },
    outputDir,
    autoRepair: {
      enabled: true,
      maxAttempts: 1,
      minOverall: 0.82
    },
    createReviewPacket: true
  }
}, undefined, { timeout: 120_000 })
const v2StyleTransfer = v2StyleTransferResponse.structuredContent?.result

const results = []
for (const item of cases) {
  const response = await client.callTool({
    name: 'scientific_plotting_render',
    arguments: {
      template: item.template,
      figureId: `regression-${item.id}`,
      labels: item.labels,
      data: item.data,
      ...(item.styleSpecPath ? { styleSpecPath: item.styleSpecPath } : {}),
      ...(item.styleSpec ? { styleSpec: item.styleSpec } : {}),
      ...(item.styleProfileId ? { styleProfileId: item.styleProfileId } : {}),
      ...(item.referencePath ? { referencePath: item.referencePath } : {}),
      outputDir,
      autoRepair: {
        enabled: true,
        maxAttempts: 1,
        minOverall: 0.82
      }
    }
  }, undefined, { timeout: 90_000 })
  results.push({
    id: item.id,
    label: item.label,
    template: item.template,
    ...(item.styleProfileId ? { styleProfileId: item.styleProfileId } : {}),
    ...(item.referencePath ? { referencePath: join(workspaceRoot, item.referencePath) } : {}),
    result: response.structuredContent?.result
  })
}

const mappedRenders = []
for (const item of mappedRenderChecks) {
  const mappingResponse = await client.callTool({
    name: 'scientific_plotting_map_data',
    arguments: {
      task: item.task,
      data: item.data,
      labels: item.labels,
      styleSpecPath: item.styleSpecPath,
      figureId: `regression-${item.id}`,
      outputDir
    }
  }, undefined, { timeout: 60_000 })
  const mapping = mappingResponse.structuredContent?.mapping
  let renderResult = null
  if (mapping?.ok) {
    const renderResponse = await client.callTool({
      name: 'scientific_plotting_render',
      arguments: {
        ...mapping.renderRequest,
        outputDir,
        autoRepair: {
          enabled: true,
          maxAttempts: 1,
          minOverall: 0.82
        }
      }
    }, undefined, { timeout: 90_000 })
    renderResult = renderResponse.structuredContent?.result
    results.push({
      id: item.id,
      label: item.label,
      template: mapping.selectedTemplate,
      result: renderResult
    })
  }
  mappedRenders.push({
    id: item.id,
    label: item.label,
    mapping,
    result: renderResult
  })
}

const reviewManifestPaths = results
  .filter((item) => item.result?.ok && item.result.manifestPath)
  .map((item) => item.result.manifestPath)
const reviewPacketResponse = await client.callTool({
  name: 'scientific_plotting_review_packet',
  arguments: {
    manifestPaths: reviewManifestPaths,
    packetId: 'v119-scientific-plotting-review-packet',
    title: 'v1.19 Scientific Plotting Review Packet',
    outputDir
  }
}, undefined, { timeout: 60_000 })
const reviewPacket = reviewPacketResponse.structuredContent?.packet

await client.close()

const payload = {
  generatedAt: new Date().toISOString(),
  outputDir: join(workspaceRoot, outputDir),
  toolNames: tools.tools.map((tool) => tool.name).sort(),
  status: status.structuredContent?.status,
  styleProfiles: styleProfiles.structuredContent?.profiles,
  referenceStyleProfiles: referenceStyleProfiles.structuredContent?.profiles,
  v2StyleTransfer,
  preparedReferences,
  mappedRenders,
  reviewPacket,
  results
}
const summaryPath = join(workspaceRoot, outputDir, 'summary.json')
const markdownPath = join(workspaceRoot, outputDir, 'summary.md')
await writeFile(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
await writeFile(markdownPath, markdownSummary(payload), 'utf8')

const failedPreparedReferences = preparedReferences.filter((item) => !item.result?.ok)
const failedMappedRenders = mappedRenders.filter((item) => !item.mapping?.ok || !item.result?.ok)
const failedStyleProfiles = !payload.styleProfiles?.ok
const failedReferenceStyleProfiles = !payload.referenceStyleProfiles?.ok
const failedV2StyleTransfer = !payload.v2StyleTransfer?.ok
const failedReviewPacket = !reviewPacket?.ok
const failed = results.filter((item) => !item.result?.ok)
console.log(JSON.stringify({
  summaryPath,
  markdownPath,
  failedPreparedReferences: failedPreparedReferences.map((item) => item.id),
  failedMappedRenders: failedMappedRenders.map((item) => item.id),
  failedStyleProfiles,
  failedReferenceStyleProfiles,
  failedV2StyleTransfer,
  failedReviewPacket,
  failed: failed.map((item) => item.id),
  preparedReferences,
  mappedRenders,
  styleProfiles: payload.styleProfiles,
  referenceStyleProfiles: payload.referenceStyleProfiles,
  v2StyleTransfer: payload.v2StyleTransfer,
  reviewPacket,
  results
}, null, 2))
if (failedPreparedReferences.length > 0 || failedMappedRenders.length > 0 || failedStyleProfiles || failedReferenceStyleProfiles || failedV2StyleTransfer || failedReviewPacket || failed.length > 0) {
  process.exitCode = 1
}
