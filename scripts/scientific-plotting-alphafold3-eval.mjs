import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const workspaceRoot = process.cwd()
const outputDir = 'tmp/scientific-plotting-cns-quality-eval/alphafold3'
const outputRoot = join(workspaceRoot, outputDir)
const scientificEntry = join(workspaceRoot, 'out/main/scientific-plotting-mcp-node-entry.js')
const imageEntry = join(workspaceRoot, 'out/main/image-generation-mcp-node-entry.js')

const alphaFold3Paper = {
  title: 'Accurate structure prediction of biomolecular interactions with AlphaFold 3',
  venue: 'Nature',
  year: 2024,
  source: 'Nature article',
  url: 'https://www.nature.com/articles/s41586-024-07487-w',
  doi: '10.1038/s41586-024-07487-w',
  figureHints: [
    'model architecture and diffusion-based structure prediction workflow',
    'benchmark panels comparing biomolecular interaction tasks',
    'multi-panel summary combining modalities, metrics, and limitations'
  ],
  notes: 'Use as read-only evidence for figure intent and style. Do not copy original paper figures or claim exact extracted values.'
}

const benchmarkData = {
  categories: ['Protein-ligand', 'Protein-DNA/RNA', 'Protein-protein', 'Antibody-antigen'],
  series: [
    { name: 'AlphaFold 3', values: [0.76, 0.71, 0.82, 0.74], error: [0.035, 0.04, 0.025, 0.032] },
    { name: 'Task baselines', values: [0.57, 0.52, 0.68, 0.59], error: [0.045, 0.05, 0.04, 0.038] }
  ]
}

const confidenceSeries = {
  series: [
    {
      name: 'High-confidence complexes',
      x: [0.35, 0.48, 0.61, 0.73, 0.84, 0.92],
      y: [0.34, 0.29, 0.24, 0.18, 0.13, 0.09]
    },
    {
      name: 'Challenging interfaces',
      x: [0.32, 0.43, 0.57, 0.69, 0.8, 0.9],
      y: [0.46, 0.39, 0.31, 0.25, 0.19, 0.14]
    }
  ]
}

const modalityHeatmap = {
  matrix: [
    [0.86, 0.78, 0.74, 0.69],
    [0.81, 0.72, 0.66, 0.62],
    [0.74, 0.65, 0.61, 0.56],
    [0.68, 0.59, 0.54, 0.51]
  ],
  xLabels: ['Protein', 'Ligand', 'Nucleic acid', 'Modified residue'],
  yLabels: ['High evidence', 'Medium evidence', 'Low evidence', 'Out-of-distribution'],
  colorbar: true
}

const architectureDraft = {
  nodes: [
    { id: 'input', label: 'Sequences, ligands, ions, modifications' },
    { id: 'tokens', label: 'Token and pair representations' },
    { id: 'trunk', label: 'Interaction-aware trunk' },
    { id: 'diffusion', label: 'Diffusion structure module' },
    { id: 'coords', label: '3D atomic coordinates' },
    { id: 'confidence', label: 'Confidence and ranking heads' },
    { id: 'limits', label: 'Failure modes: disorder, rare chemistry, sparse evidence' }
  ],
  edges: [
    { from: 'input', to: 'tokens' },
    { from: 'tokens', to: 'trunk' },
    { from: 'trunk', to: 'diffusion' },
    { from: 'diffusion', to: 'coords' },
    { from: 'coords', to: 'confidence' },
    { from: 'confidence', to: 'limits' }
  ]
}

const commonBrief = [
  'scientific_plotting_research_brief evidence for AlphaFold 3:',
  `Reference paper: ${alphaFold3Paper.title}, ${alphaFold3Paper.venue} ${alphaFold3Paper.year}, DOI ${alphaFold3Paper.doi}.`,
  'Figure conclusion: AlphaFold 3 broadens structure prediction from single proteins to biomolecular interactions, while confidence and modality-specific limits must remain visible.',
  'Evidence logic: show input modality breadth, diffusion-based structure generation, benchmark gains with uncertainty, and explicit caveats for low-evidence or unusual complexes.',
  'User analysis angle: evaluate whether SciForge first render is only a structured draft and whether gpt-image-2 polish improves Nature-style multi-panel readability without changing data facts.',
  'Do not copy any original Nature panel; use synthetic normalized values only for visual pipeline testing.'
].join('\n')

const cases = [
  {
    id: 'architecture',
    label: 'Architecture schematic',
    firstKind: 'image_generation',
    size: { width: 1280, height: 896 },
    firstPrompt: [
      commonBrief,
      '',
      'Create the first-pass schematic draft for an AlphaFold 3 biomolecular interaction architecture figure.',
      'Use a clean but intentionally conservative scientific schematic: left-to-right flow, grouped modules, explicit labels, no decorative molecular art.',
      'Draft nodes and edges:',
      JSON.stringify(architectureDraft, null, 2)
    ].join('\n'),
    polishPromptExtra: 'Polish this into a Nature-style mechanism panel with clear module hierarchy, subtle molecular context, callouts for diffusion and confidence heads, and a small limitations inset.'
  },
  {
    id: 'benchmark',
    label: 'Benchmark data chart',
    firstKind: 'scientific_plotting',
    template: 'errorbar-bar',
    figureId: 'alphafold3-benchmark-first',
    labels: {
      title: 'AlphaFold 3 interaction benchmark (representative)',
      x: 'Interaction task',
      y: 'Normalized success score',
      legend: true,
      panel: 'B'
    },
    data: benchmarkData,
    size: { width: 1280, height: 896 },
    polishPromptExtra: 'Polish the controlled benchmark chart into a Nature-style data panel: preserve all categories, values, uncertainties, axis labels, and conclusion; improve spacing, callouts, panel label, and caption-like annotations.'
  },
  {
    id: 'multipanel',
    label: 'Multi-panel summary',
    firstKind: 'scientific_plotting',
    template: 'multi-panel',
    figureId: 'alphafold3-multipanel-first',
    labels: {
      title: 'AlphaFold 3 evaluation summary (representative multi-panel)'
    },
    data: {
      columns: 2,
      panels: [
        {
          template: 'errorbar-bar',
          labels: { title: 'Task success with uncertainty', x: 'Task', y: 'Score', legend: true, panel: 'a' },
          data: benchmarkData
        },
        {
          template: 'heatmap',
          labels: { title: 'Evidence/modality coverage', x: 'Modality', y: 'Evidence level', panel: 'b' },
          data: modalityHeatmap
        },
        {
          template: 'scatter',
          labels: { title: 'Confidence vs error', x: 'Predicted confidence', y: 'Relative structure error', legend: true, panel: 'c' },
          data: confidenceSeries
        },
        {
          template: 'line',
          labels: { title: 'Iterative refinement trend', x: 'Diffusion refinement step', y: 'Relative confidence', legend: true, panel: 'd' },
          data: {
            x: [0, 10, 20, 30, 40, 50],
            series: [
              { name: 'Complex ranking', y: [0.36, 0.49, 0.61, 0.7, 0.76, 0.79] },
              { name: 'Interface confidence', y: [0.3, 0.44, 0.57, 0.65, 0.71, 0.75] }
            ]
          }
        }
      ]
    },
    size: { width: 1536, height: 1024 },
    polishPromptExtra: 'Polish this into a cohesive Nature-style multi-panel figure. Preserve every numeric trend and label, add small panel letters, align panels, add explanatory callouts, and make a unified visual hierarchy.'
  }
]

async function main() {
  await assertFile(scientificEntry)
  await assertFile(imageEntry)
  await mkdir(outputRoot, { recursive: true })

  const scientific = await connectMcp(scientificEntry, '--scientific-plotting-mcp-server', 'alphafold3-scientific-plotting-eval')
  const image = await connectMcp(imageEntry, '--image-generation-mcp-server', 'alphafold3-image-polish-eval')

  const startedAt = new Date().toISOString()
  const summary = {
    startedAt,
    workspaceRoot,
    outputDir: outputRoot,
    paper: alphaFold3Paper,
    status: {},
    brief: null,
    cases: [],
    contactSheetPath: null,
    warnings: []
  }

  try {
    summary.status.scientificPlotting = await callStructured(scientific.client, 'scientific_plotting_status', {}, 'status', 30_000)
    summary.status.imageGeneration = await callStructured(image.client, 'image_generation_status', {}, 'status', 30_000)
    summary.brief = await callStructured(scientific.client, 'scientific_plotting_research_brief', {
      workspaceRoot,
      task: 'Evaluate SciForge publication-figure generation for AlphaFold 3 Nature paper: architecture schematic, benchmark data chart, and multi-panel summary.',
      domain: 'structural biology and computational biology',
      targetVenue: 'Nature',
      dataSummary: 'Representative synthetic normalized values only; no exact paper data extraction. Use AlphaFold 3 paper as figure-intent and style evidence.',
      referenceFigureNotes: 'Nature-style combination figures: compact multi-panel layouts, model pipeline diagrams, benchmark score panels, uncertainty, and explanatory callouts.',
      candidatePapers: [alphaFold3Paper],
      maxPapers: 1
    }, 'brief', 60_000)
    await writeJson(join(outputRoot, 'alphafold3-research-brief.json'), summary.brief)

    for (const item of cases) {
      const first = item.firstKind === 'scientific_plotting'
        ? await renderScientificFirst(scientific.client, item)
        : await renderImageFirst(image.client, item)

      const polish = await renderPolish(image.client, item, first)
      const review = first.ok && polish.ok
        ? await reviewPair(scientific.client, first.outputPath, polish.outputPath, item.template ?? 'multi-panel')
        : null

      summary.cases.push({
        id: item.id,
        label: item.label,
        first,
        polish,
        review,
        observations: observeCase(item, first, polish, review)
      })
    }

    const contactSheetPath = join(outputRoot, 'alphafold3-before-after-contact-sheet.png')
    await drawContactSheet(summary.cases, contactSheetPath)
    summary.contactSheetPath = contactSheetPath

    await writeJson(join(outputRoot, 'alphafold3-eval-results.json'), summary)
    await writeMarkdownSummary(join(outputRoot, 'alphafold3-eval-results.md'), summary)
    console.log(JSON.stringify({
      ok: true,
      outputDir: outputRoot,
      resultJson: join(outputRoot, 'alphafold3-eval-results.json'),
      resultMarkdown: join(outputRoot, 'alphafold3-eval-results.md'),
      contactSheetPath
    }, null, 2))
  } finally {
    await Promise.allSettled([scientific.client.close(), image.client.close()])
  }
}

async function connectMcp(entry, flag, name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, flag, '--workspace-root', workspaceRoot],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    stderr: 'pipe'
  })
  const client = new Client({ name, version: '0.1.0' })
  await client.connect(transport, { timeout: 30_000 })
  return { client, transport }
}

async function renderScientificFirst(client, item) {
  const response = await callStructured(client, 'scientific_plotting_render', {
    workspaceRoot,
    template: item.template,
    figureId: item.figureId,
    labels: item.labels,
    data: item.data,
    styleProfileId: 'nature-2021-alphafold-fig2',
    outputDir,
    autoRepair: {
      enabled: true,
      maxAttempts: 1,
      minOverall: 0.8
    }
  }, 'result', 120_000)
  return normalizeRenderResult(response)
}

async function renderImageFirst(client, item) {
  const recipe = {
    mode: 'text_to_image',
    model: 'gpt-image-2',
    prompt: item.firstPrompt,
    size: item.size,
    stylePreset: 'nature-publication-schematic',
    outputFormat: 'png'
  }
  const response = await callStructured(client, 'image_generation_render', {
    workspaceRoot,
    recipe,
    imageId: `alphafold3-${item.id}-first`,
    outputDir
  }, 'result', 180_000)
  return normalizeRenderResult(response)
}

async function renderPolish(client, item, first) {
  const referencePath = first.outputPath ? toWorkspaceRelative(first.outputPath) : undefined
  const prompt = [
    commonBrief,
    '',
    `Polish target: ${item.label}.`,
    item.polishPromptExtra,
    referencePath ? `Reference first render path inside workspace: ${referencePath}.` : 'No first-render PNG was produced; create a conservative polished figure from the brief.',
    'Hard guardrails: do not change data values, category names, axis labels, sample-size claims, statistics, or paper facts. If the source is a data chart, preserve the data semantics exactly.',
    'Final output should be a single high-resolution PNG suitable for SciForge Canvas review.'
  ].join('\n')

  const plan = await callStructured(client, 'image_generation_plan', {
    workspaceRoot,
    task: prompt,
    modeHint: referencePath ? 'image_to_image' : 'text_to_image',
    size: item.size,
    stylePreset: 'nature-cns-polish',
    ...(referencePath ? { referencePath } : {})
  }, 'plan', 60_000).catch((error) => ({
    ok: false,
    status: 'plan_failed',
    message: error instanceof Error ? error.message : String(error)
  }))

  const recipe = {
    mode: referencePath ? 'image_to_image' : 'text_to_image',
    model: 'gpt-image-2',
    prompt,
    size: item.size,
    stylePreset: 'nature-cns-polish',
    ...(referencePath ? { referencePath } : {}),
    outputFormat: 'png'
  }
  const response = await callStructured(client, 'image_generation_render', {
    workspaceRoot,
    recipe,
    imageId: `alphafold3-${item.id}-polished`,
    outputDir,
    ...(referencePath ? { reviewReferencePath: referencePath } : {})
  }, 'result', 240_000).catch((error) => ({
    ok: false,
    status: 'tool_call_failed',
    message: error instanceof Error ? error.message : String(error)
  }))
  return {
    ...normalizeRenderResult(response),
    plan
  }
}

async function reviewPair(client, referencePath, outputPath, template) {
  return callStructured(client, 'scientific_plotting_review', {
    workspaceRoot,
    referencePath: toWorkspaceRelative(referencePath),
    outputPath: toWorkspaceRelative(outputPath),
    template,
    minOverall: 0.72
  }, 'review', 60_000).catch((error) => ({
    ok: false,
    status: 'review_failed',
    message: error instanceof Error ? error.message : String(error)
  }))
}

async function callStructured(client, name, args, key, timeout) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout })
  if (response.structuredContent && key in response.structuredContent) return response.structuredContent[key]
  if (response.structuredContent) return response.structuredContent
  const text = Array.isArray(response.content)
    ? response.content.map((part) => typeof part.text === 'string' ? part.text : '').join('\n')
    : ''
  throw new Error(`Tool ${name} did not return structuredContent.${key}. ${text}`.trim())
}

function normalizeRenderResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, status: 'invalid_result', message: 'Tool returned an empty or non-object result.' }
  }
  const normalized = { ...result }
  if (typeof normalized.outputPath === 'string') normalized.outputPath = resolvePathMaybe(normalized.outputPath)
  if (typeof normalized.manifestPath === 'string') normalized.manifestPath = resolvePathMaybe(normalized.manifestPath)
  if (typeof normalized.artifactManifestPath === 'string') normalized.artifactManifestPath = resolvePathMaybe(normalized.artifactManifestPath)
  return normalized
}

function observeCase(item, first, polish, review) {
  const observations = []
  if (!first.ok) observations.push(`First render failed: ${first.status}${first.message ? ` — ${first.message}` : ''}.`)
  if (!polish.ok) observations.push(`gpt-image-2 polish failed: ${polish.status}${polish.message ? ` — ${polish.message}` : ''}.`)
  if (first.ok && polish.ok) observations.push('Before/after artifacts were produced for visual inspection.')
  const score = review?.score ?? review?.review?.score
  if (score && typeof score.overall === 'number') {
    observations.push(`Similarity score between first and polished output: ${score.overall.toFixed(2)}.`)
  }
  if (item.id === 'architecture') observations.push('Mechanism figures need image generation for final composition; scientific plotting is only useful for the draft structure and evidence prompt.')
  if (item.id === 'benchmark') observations.push('Numeric data must remain controlled; image polish is useful only for annotation, typography, spacing, and callouts.')
  if (item.id === 'multipanel') observations.push('Nature-style figures require panel assembly and hierarchy; single-template rendering is insufficient for final CNS-grade output.')
  return observations
}

async function drawContactSheet(results, outputPath) {
  const cellW = 620
  const cellH = 430
  const labelH = 56
  const margin = 32
  const width = margin * 3 + cellW * 2
  const height = margin + results.length * (cellH + labelH + margin)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f7f8fb'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1f2937'
  ctx.font = 'bold 22px Arial'
  ctx.fillText('AlphaFold 3 Nature Figure Quality Eval: first render vs gpt-image-2 polish', margin, 28)

  for (let i = 0; i < results.length; i += 1) {
    const item = results[i]
    const y = margin + 26 + i * (cellH + labelH + margin)
    drawPanelLabel(ctx, margin, y, `${item.label} · First render`)
    drawPanelLabel(ctx, margin * 2 + cellW, y, `${item.label} · gpt-image-2 polish`)
    await drawImageOrPlaceholder(ctx, item.first?.outputPath, margin, y + labelH, cellW, cellH, item.first)
    await drawImageOrPlaceholder(ctx, item.polish?.outputPath, margin * 2 + cellW, y + labelH, cellW, cellH, item.polish)
  }
  await writeFile(outputPath, canvas.toBuffer('image/png'))
}

function drawPanelLabel(ctx, x, y, label) {
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y + 8, 620, 40, 8)
  ctx.fill()
  ctx.strokeStyle = '#d5dae4'
  ctx.stroke()
  ctx.fillStyle = '#111827'
  ctx.font = 'bold 16px Arial'
  ctx.fillText(label, x + 14, y + 34)
}

async function drawImageOrPlaceholder(ctx, imagePath, x, y, w, h, result) {
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, w, h, 10)
  ctx.fill()
  ctx.strokeStyle = '#cdd5e1'
  ctx.stroke()
  if (imagePath && await fileExists(imagePath)) {
    const image = await loadImage(imagePath)
    const scale = Math.min((w - 28) / image.width, (h - 28) / image.height)
    const iw = image.width * scale
    const ih = image.height * scale
    ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
    return
  }
  ctx.fillStyle = '#eff4ff'
  roundRect(ctx, x + 20, y + 20, w - 40, h - 40, 8)
  ctx.fill()
  ctx.fillStyle = '#334155'
  ctx.font = 'bold 18px Arial'
  ctx.fillText(result?.ok === false ? `Failed: ${result.status}` : 'No image produced', x + 44, y + 62)
  ctx.font = '14px Arial'
  wrapText(ctx, result?.message ?? 'See alphafold3-eval-results.json for details.', x + 44, y + 96, w - 88, 22)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/)
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y)
      line = word
      y += lineHeight
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, y)
}

async function writeMarkdownSummary(path, summary) {
  const lines = [
    '# AlphaFold 3 Scientific Plotting Quality Eval',
    '',
    `- Paper: ${summary.paper.title} (${summary.paper.venue} ${summary.paper.year})`,
    `- Output dir: \`${relative(workspaceRoot, summary.outputDir)}\``,
    `- Contact sheet: \`${relative(workspaceRoot, summary.contactSheetPath)}\``,
    `- Image provider: \`${summary.status.imageGeneration?.provider ?? 'unknown'}\`; configured: \`${summary.status.imageGeneration?.configured ?? 'unknown'}\`; default model: \`${summary.status.imageGeneration?.defaultModel ?? 'unknown'}\``,
    '',
    '| Case | First render | gpt-image-2 polish | Review | Observations |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const item of summary.cases) {
    const first = item.first?.outputPath ? relative(workspaceRoot, item.first.outputPath) : `${item.first?.status ?? 'missing'}`
    const polish = item.polish?.outputPath ? relative(workspaceRoot, item.polish.outputPath) : `${item.polish?.status ?? 'missing'}`
    const score = item.review?.score?.overall ?? item.review?.review?.score?.overall
    lines.push(`| ${item.label} | \`${first}\` | \`${polish}\` | ${typeof score === 'number' ? score.toFixed(2) : 'n/a'} | ${item.observations.join('<br>')} |`)
  }
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push('- Values are representative synthetic data for pipeline testing, not extracted Nature source data.')
  lines.push('- `gpt-image-2` is used only as a visual polish step; it must not alter scientific facts or controlled numeric semantics.')
  lines.push('- If polish failed, inspect the provider status and error in `alphafold3-eval-results.json`.')
  await writeFile(path, lines.join('\n') + '\n')
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n')
}

async function assertFile(path) {
  await access(path)
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function resolvePathMaybe(path) {
  return isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path)
}

function toWorkspaceRelative(path) {
  const absolute = resolvePathMaybe(path)
  const rel = relative(workspaceRoot, absolute)
  if (rel.startsWith('..')) return absolute
  return rel || basename(absolute)
}

process.on('unhandledRejection', (error) => {
  console.error(error)
  process.exitCode = 1
})

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
