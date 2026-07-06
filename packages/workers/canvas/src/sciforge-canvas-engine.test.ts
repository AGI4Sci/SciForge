import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  exportSciforgeCanvasReviewPacket,
  importRecentSciforgeCanvasArtifacts,
  insertSciforgeCanvasArtifact,
  openOrCreateSciforgeCanvas,
  saveSciforgeCanvasSelection
} from './sciforge-canvas-engine'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJHeWQAAAABJRU5ErkJggg==',
  'base64'
)

async function makeWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-canvas-test-'))
}

describe('SciForge Canvas engine', () => {
  beforeEach(() => {
    process.env.SCIFORGE_CANVAS_ENGINE = 'tldraw'
  })

  afterEach(() => {
    delete process.env.SCIFORGE_CANVAS_ENGINE
  })

  it('uses draw.io XML as the default canvas engine and exports review packets', async () => {
    delete process.env.SCIFORGE_CANVAS_ENGINE
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'plot.png')
    await writeFile(plotPath, PNG_1X1)

    const opened = await openOrCreateSciforgeCanvas({ workspaceRoot, canvasId: 'drawio-review' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.engine).toBe('drawio')
    expect(opened.drawioPath).toMatch(/canvas\.drawio\.xml$/)
    expect(JSON.stringify(opened.snapshot)).toContain('"engine":"drawio"')

    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      canvasId: 'drawio-review',
      artifactKind: 'scientific_plot',
      outputPath: plotPath,
      title: 'Drawio plot'
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    const xml = await readFile(join(inserted.canvasDir, 'canvas.drawio.xml'), 'utf8')
    expect(xml).toContain('mxfile')
    expect(xml).toContain('sciforgeMeta')
    expect(xml).toContain('Drawio plot')

    const packet = await exportSciforgeCanvasReviewPacket({
      workspaceRoot,
      canvasId: 'drawio-review',
      title: 'Drawio review'
    })
    expect(packet.ok).toBe(true)
    if (!packet.ok) return
    expect(packet.packet.artifacts).toHaveLength(1)
    expect(packet.packet.artifacts[0].artifactKind).toBe('scientific_plot')
  })

  it('creates a workspace canvas and inserts a scientific plot artifact with Cowart-compatible metadata', async () => {
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'plot.png')
    const manifestPath = join(workspaceRoot, 'plot.manifest.json')
    await writeFile(plotPath, PNG_1X1)
    await writeFile(manifestPath, JSON.stringify({
      tool: 'scientific_plotting_render',
      outputPath: plotPath
    }))

    const opened = await openOrCreateSciforgeCanvas({ workspaceRoot, canvasId: 'paper-review' })
    expect(opened.ok).toBe(true)

    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      canvasId: 'paper-review',
      artifactKind: 'scientific_plot',
      outputPath: plotPath,
      manifestPath,
      styleSpecPath: manifestPath,
      referencePath: plotPath,
      reviewScore: {
        overall: 0.82,
        palette: 0.9,
        background: 0.95,
        axes: 0.7,
        grid: 0.8,
        layout: 0.84,
        marks: 0.77,
        warnings: ['axis weight differs']
      },
      title: 'Styled plot'
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    expect(inserted.artifact.artifactKind).toBe('scientific_plot')
    expect(inserted.assetFile).toBeTruthy()
    await expect(stat(inserted.assetFile!)).resolves.toMatchObject({ size: PNG_1X1.length })

    const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
    const shape = snapshot.store[inserted.shapeId]
    const asset = snapshot.store[inserted.assetId!]
    expect(asset.typeName).toBe('asset')
    expect(asset.type).toBe('image')
    expect(asset.props.src).toBe('')
    expect(asset.meta.sciforgeCanvasAssetFile).toBe(inserted.assetFile)
    expect(asset.meta.sciforgeCanvasSourcePath).toMatch(/plot\.png$/)
    expect(shape.meta.sciforgeCanvasArtifact).toBe(true)
    expect(shape.meta.sciforgeArtifact.outputPath).toMatch(/plot\.png$/)
    expect(shape.meta.sciforgeArtifact.reviewScore.overall).toBe(0.82)
  })

  it('exports selected annotations and controlled next-tool recommendations', async () => {
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'plot.png')
    await writeFile(plotPath, PNG_1X1)
    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      artifactKind: 'scientific_plot',
      outputPath: plotPath
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
    snapshot.store['shape:annotation'] = {
      id: 'shape:annotation',
      typeName: 'shape',
      type: 'arrow',
      parentId: 'page:sciforge-canvas',
      index: 'b1',
      x: 12,
      y: 20,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {
        cowartAnnotationArrow: true,
        cowartAnnotationSourceShapeId: inserted.shapeId
      },
      props: {
        start: { x: 0, y: 0 },
        end: { x: 80, y: 20 },
        color: 'red',
        richText: { type: 'doc', content: [{ type: 'text', text: 'reduce marker size' }] }
      }
    }
    await writeFile(inserted.canvasPath, `${JSON.stringify(snapshot, null, 2)}\n`)
    await saveSciforgeCanvasSelection({
      workspaceRoot,
      selection: {
        selectedShapes: [{
          id: inserted.shapeId,
          type: 'image',
          isAiImageHolder: false
        }],
        updatedAt: '2026-06-22T00:00:00.000Z'
      }
    })

    const packet = await exportSciforgeCanvasReviewPacket({ workspaceRoot, title: 'Review' })
    expect(packet.ok).toBe(true)
    if (!packet.ok) return
    expect(packet.packet.artifacts).toHaveLength(1)
    expect(packet.packet.annotations[0]?.text).toBe('reduce marker size')
    expect(packet.packet.adjustmentRequests[0]).toMatchObject({
      artifactKind: 'scientific_plot',
      nextControlledTool: 'scientific_plotting_render'
    })
    expect(packet.packet.modificationSuggestions[0]).toMatchObject({
      annotationShapeId: 'shape:annotation',
      targetShapeId: inserted.shapeId,
      artifactKind: 'scientific_plot',
      instruction: 'reduce marker size',
      nextControlledTool: 'scientific_plotting_render',
      status: 'draft'
    })
  })

  it('routes visual redraw requests for scientific plots to image generation edits', async () => {
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'transformer-flowchart.png')
    await writeFile(plotPath, PNG_1X1)
    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      artifactKind: 'scientific_plot',
      outputPath: plotPath,
      title: 'Transformer flowchart draft'
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
    snapshot.store['shape:visual-redraw-annotation'] = {
      id: 'shape:visual-redraw-annotation',
      typeName: 'shape',
      type: 'arrow',
      parentId: 'page:sciforge-canvas',
      index: 'b1',
      x: 12,
      y: 20,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {
        cowartAnnotationArrow: true,
        cowartAnnotationSourceShapeId: inserted.shapeId
      },
      props: {
        start: { x: 0, y: 0 },
        end: { x: 80, y: 20 },
        color: 'red',
        richText: { type: 'doc', content: [{ type: 'text', text: '这个图画得太简单了，重新画成论文级流程图' }] }
      }
    }
    await writeFile(inserted.canvasPath, `${JSON.stringify(snapshot, null, 2)}\n`)

    const packet = await exportSciforgeCanvasReviewPacket({ workspaceRoot, title: 'Review' })
    expect(packet.ok).toBe(true)
    if (!packet.ok) return
    expect(packet.packet.modificationSuggestions[0]).toMatchObject({
      annotationShapeId: 'shape:visual-redraw-annotation',
      targetShapeId: inserted.shapeId,
      artifactKind: 'scientific_plot',
      instruction: '这个图画得太简单了，重新画成论文级流程图',
      nextControlledTool: 'image_generation_edit_from_canvas_packet',
      status: 'draft'
    })
    expect(packet.packet.modificationSuggestions[0]?.safety).toContain('visually enhanced')
  })

  it('exports box annotations as review packet area targets', async () => {
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'plot.png')
    await writeFile(plotPath, PNG_1X1)
    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      artifactKind: 'scientific_plot',
      outputPath: plotPath
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
    snapshot.store['shape:box-annotation'] = {
      id: 'shape:box-annotation',
      typeName: 'shape',
      type: 'geo',
      parentId: 'page:sciforge-canvas',
      index: 'b2',
      x: inserted.bounds.x + 12,
      y: inserted.bounds.y + 18,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {
        sciforgeCanvasAnnotation: true,
        sciforgeCanvasAnnotationBox: true,
        cowartAnnotationSourceShapeId: inserted.shapeId
      },
      props: {
        w: 96,
        h: 72,
        geo: 'rectangle',
        dash: 'draw',
        fill: 'none',
        color: 'blue',
        labelColor: 'blue',
        richText: { type: 'doc', content: [{ type: 'text', text: 'focus this region' }] }
      }
    }
    await writeFile(inserted.canvasPath, `${JSON.stringify(snapshot, null, 2)}\n`)

    const packet = await exportSciforgeCanvasReviewPacket({ workspaceRoot, title: 'Review' })
    expect(packet.ok).toBe(true)
    if (!packet.ok) return
    expect(packet.packet.annotations[0]).toMatchObject({
      shapeId: 'shape:box-annotation',
      annotationKind: 'box',
      text: 'focus this region',
      sourceShapeId: inserted.shapeId
    })
    expect(packet.packet.annotations[0]?.bounds).toMatchObject({
      x: inserted.bounds.x + 12,
      y: inserted.bounds.y + 18,
      w: 96,
      h: 72
    })
    expect(packet.packet.modificationSuggestions[0]).toMatchObject({
      annotationShapeId: 'shape:box-annotation',
      targetShapeId: inserted.shapeId,
      artifactKind: 'scientific_plot',
      instruction: 'focus this region',
      nextControlledTool: 'scientific_plotting_render',
      status: 'draft'
    })
  })

  it('falls back to selected annotation shapes when the canvas snapshot has not flushed them yet', async () => {
    const workspaceRoot = await makeWorkspace()
    const imagePath = join(workspaceRoot, 'cover.png')
    await writeFile(imagePath, PNG_1X1)
    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      artifactKind: 'generated_image',
      outputPath: imagePath,
      title: 'Generated cover'
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    await saveSciforgeCanvasSelection({
      workspaceRoot,
      selection: {
        selectedShapes: [{
          id: 'shape:selected-box-annotation',
          type: 'geo',
          parentId: 'page:sciforge-canvas',
          x: inserted.bounds.x + 24,
          y: inserted.bounds.y + 32,
          meta: {
            sciforgeCanvasAnnotation: true,
            sciforgeCanvasAnnotationBox: true,
            cowartAnnotationSourceShapeId: inserted.shapeId
          },
          props: {
            w: 160,
            h: 92,
            geo: 'rectangle',
            color: 'blue',
            richText: {
              type: 'doc',
              content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'repaint this region' }]
              }]
            }
          },
          bounds: {
            x: inserted.bounds.x + 24,
            y: inserted.bounds.y + 32,
            w: 160,
            h: 92
          },
          isAiImageHolder: false
        }],
        updatedAt: '2026-06-22T00:00:00.000Z'
      }
    })

    const packet = await exportSciforgeCanvasReviewPacket({ workspaceRoot, title: 'Review' })
    expect(packet.ok).toBe(true)
    if (!packet.ok) return
    expect(packet.packet.annotations).toHaveLength(1)
    expect(packet.packet.annotations[0]).toMatchObject({
      shapeId: 'shape:selected-box-annotation',
      annotationKind: 'box',
      text: 'repaint this region',
      sourceShapeId: inserted.shapeId
    })
    expect(packet.packet.modificationSuggestions[0]).toMatchObject({
      annotationShapeId: 'shape:selected-box-annotation',
      targetShapeId: inserted.shapeId,
      artifactKind: 'generated_image',
      instruction: 'repaint this region',
      nextControlledTool: 'image_generation_edit_from_canvas_packet',
      status: 'draft'
    })
  })

  it('sanitizes legacy arrow props before returning canvas snapshots', async () => {
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'plot.png')
    await writeFile(plotPath, PNG_1X1)
    const inserted = await insertSciforgeCanvasArtifact({
      workspaceRoot,
      artifactKind: 'scientific_plot',
      outputPath: plotPath
    })
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return

    const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
    snapshot.store['shape:legacy-annotation'] = {
      id: 'shape:legacy-annotation',
      typeName: 'shape',
      type: 'arrow',
      parentId: 'page:sciforge-canvas',
      index: 'b1',
      x: 12,
      y: 20,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {
        cowartAnnotationArrow: true,
        cowartAnnotationSourceShapeId: inserted.shapeId
      },
      props: {
        start: { type: 'point', x: 0, y: 0 },
        end: { type: 'point', x: 80, y: 20 },
        color: 'red',
        text: 'tighten layout'
      }
    }
    await writeFile(inserted.canvasPath, `${JSON.stringify(snapshot, null, 2)}\n`)

    const opened = await openOrCreateSciforgeCanvas({ workspaceRoot })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const openedSnapshot = opened.snapshot as { store: Record<string, { props?: Record<string, unknown> }> }
    const arrow = openedSnapshot.store['shape:legacy-annotation']
    const arrowProps = arrow.props ?? {}
    expect(arrowProps).not.toHaveProperty('text')
    expect(arrowProps.start as Record<string, unknown>).not.toHaveProperty('type')
    expect(arrowProps.end as Record<string, unknown>).not.toHaveProperty('type')
    expect(arrowProps.elbowMidPoint).toBe(0.5)

    const packet = await exportSciforgeCanvasReviewPacket({ workspaceRoot, title: 'Review' })
    expect(packet.ok).toBe(true)
    if (!packet.ok) return
    expect(packet.packet.modificationSuggestions[0]).toMatchObject({
      instruction: 'tighten layout',
      nextControlledTool: 'scientific_plotting_render'
    })
  })

  it('sanitizes historical tldraw note schema before returning canvas snapshots', async () => {
    const workspaceRoot = await makeWorkspace()
    const opened = await openOrCreateSciforgeCanvas({ workspaceRoot })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const snapshot = JSON.parse(await readFile(opened.canvasPath, 'utf8'))
    snapshot.schema.sequences['com.tldraw.shape.note'] = 12
    await writeFile(opened.canvasPath, `${JSON.stringify(snapshot, null, 2)}\n`)

    const reopened = await openOrCreateSciforgeCanvas({ workspaceRoot })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    const reopenedSnapshot = reopened.snapshot as { schema: { sequences: Record<string, number> } }
    expect(reopenedSnapshot.schema.sequences['com.tldraw.shape.note']).toBe(10)
  })

  it('renders PPTX export pages into canvas previews when local office tools are available', async () => {
    const workspaceRoot = await makeWorkspace()
    const deckDir = join(workspaceRoot, 'deck')
    const binDir = join(workspaceRoot, 'bin')
    await mkdir(deckDir)
    await mkdir(binDir)
    const pptxPath = join(workspaceRoot, 'deck.pptx')
    await writeFile(pptxPath, 'pptx-bytes')

    const fakeSoffice = join(binDir, 'soffice')
    const fakePdftoppm = join(binDir, 'pdftoppm')
    await writeFile(fakeSoffice, `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const outDir = args[args.indexOf('--outdir') + 1]
const source = args.at(-1)
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, path.basename(source, path.extname(source)) + '.pdf'), '%PDF-1.4\\n')
`)
    await writeFile(fakePdftoppm, `#!/usr/bin/env node
const fs = require('fs')
const png = '${PNG_1X1.toString('base64')}'
const prefix = process.argv.at(-1)
fs.writeFileSync(prefix + '-1.png', Buffer.from(png, 'base64'))
`)
    await chmod(fakeSoffice, 0o755)
    await chmod(fakePdftoppm, 0o755)

    const previousSoffice = process.env.SCIFORGE_SOFFICE_BIN
    const previousPdftoppm = process.env.SCIFORGE_PDFTOPPM_BIN
    const previousDisable = process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    process.env.SCIFORGE_SOFFICE_BIN = fakeSoffice
    process.env.SCIFORGE_PDFTOPPM_BIN = fakePdftoppm
    delete process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    try {
      const inserted = await insertSciforgeCanvasArtifact({
        workspaceRoot,
        artifactKind: 'ppt_export',
        pptxPath,
        projectPath: deckDir,
        slideIndex: 2,
        title: 'Exported deck'
      })
      expect(inserted.ok).toBe(true)
      if (!inserted.ok) return
      expect(inserted.assetId).toBeTruthy()
      expect(inserted.assetFile).toBeTruthy()
      expect(inserted.artifact.previewPath).toMatch(/slide-03\.png$/)
      expect(inserted.artifact.renderedSlideIndex).toBe(2)
      expect(inserted.warnings.join('\n')).toContain('rendered to PNG preview')
      const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
      expect(snapshot.store[inserted.shapeId].type).toBe('image')
      expect(snapshot.store[inserted.shapeId].meta.sciforgeArtifact.renderedPagePath).toMatch(/slide-03\.png$/)
    } finally {
      restoreEnv('SCIFORGE_SOFFICE_BIN', previousSoffice)
      restoreEnv('SCIFORGE_PDFTOPPM_BIN', previousPdftoppm)
      restoreEnv('SCIFORGE_CANVAS_DISABLE_PPT_RENDER', previousDisable)
    }
  })

  it('uses ppt-master SVG slide previews from artifact manifests before blank PPT placeholders', async () => {
    const workspaceRoot = await makeWorkspace()
    const deckDir = join(workspaceRoot, 'nature-ppt_ppt169_20260629')
    const svgPath = join(deckDir, 'svg_final', 'page_01.svg')
    const pptxPath = join(deckDir, 'exports', 'nature-ppt_20260629_135226.pptx')
    const artifactManifestPath = join(workspaceRoot, '.sciforge', 'artifacts', 'nature-ppt.artifact.json')
    await mkdir(dirname(svgPath), { recursive: true })
    await mkdir(dirname(pptxPath), { recursive: true })
    await mkdir(dirname(artifactManifestPath), { recursive: true })
    await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#fff"/><text x="80" y="120">Nature deck</text></svg>')
    await writeFile(pptxPath, 'pptx-bytes')
    await writeFile(artifactManifestPath, JSON.stringify({
      kind: 'sciforge_artifact',
      version: 1,
      sourceTool: 'ppt_master',
      artifactKind: 'ppt_export',
      path: pptxPath,
      pptxPath,
      projectPath: deckDir,
      title: 'Nature PPT'
    }))

    const previousDisable = process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER = '1'
    try {
      const inserted = await insertSciforgeCanvasArtifact({
        workspaceRoot,
        artifactKind: 'ppt_export',
        outputPath: pptxPath,
        sourcePath: pptxPath,
        pptxPath,
        manifestPath: artifactManifestPath,
        title: 'Nature PPT'
      })
      expect(inserted.ok).toBe(true)
      if (!inserted.ok) return
      expect(inserted.assetId).toBeTruthy()
      expect(inserted.artifact.previewPath).toMatch(/svg_final\/page_01\.svg$/)
      expect(inserted.artifact.renderedPagePath).toMatch(/svg_final\/page_01\.svg$/)
      expect(inserted.warnings.join('\n')).toContain('using ppt-master SVG preview')
      const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
      expect(snapshot.store[inserted.shapeId].type).toBe('image')
      expect(snapshot.store[inserted.shapeId].meta.sciforgeCanvasPlaceholder).toBeUndefined()
      expect(snapshot.store[inserted.shapeId].meta.sciforgeArtifact.previewPath).toMatch(/svg_final\/page_01\.svg$/)
    } finally {
      restoreEnv('SCIFORGE_CANVAS_DISABLE_PPT_RENDER', previousDisable)
    }
  })

  it('imports recent workspace plot and PPTX artifacts into the canvas', async () => {
    const workspaceRoot = await makeWorkspace()
    const plotPath = join(workspaceRoot, 'financial_chart.png')
    const pptxPath = join(workspaceRoot, '年度总结报告.pptx')
    await writeFile(plotPath, PNG_1X1)
    await writeFile(pptxPath, 'pptx-bytes')

    const previousDisable = process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER = '1'
    try {
      const imported = await importRecentSciforgeCanvasArtifacts({
        workspaceRoot,
        limit: 5
      })
      expect(imported.ok).toBe(true)
      if (!imported.ok) return
      expect(imported.imported).toBe(2)
      expect(imported.artifacts.map((artifact) => artifact.artifactKind).sort()).toEqual([
        'ppt_export',
        'scientific_plot'
      ])

      const snapshot = JSON.parse(await readFile(imported.canvasPath, 'utf8'))
      const shapes = Object.values(snapshot.store as Record<string, any>)
        .filter((record) => record.typeName === 'shape' && record.meta?.sciforgeCanvasArtifact)
      expect(shapes).toHaveLength(2)
      expect(shapes.some((shape) => String(shape.meta.sciforgeArtifact.outputPath).endsWith('financial_chart.png'))).toBe(true)
      expect(shapes.some((shape) => String(shape.meta.sciforgeArtifact.pptxPath).endsWith('年度总结报告.pptx'))).toBe(true)

      const second = await importRecentSciforgeCanvasArtifacts({
        workspaceRoot,
        limit: 5
      })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.imported).toBe(0)
    } finally {
      restoreEnv('SCIFORGE_CANVAS_DISABLE_PPT_RENDER', previousDisable)
    }
  })

  it('imports artifacts from the SciForge artifact manifest bus', async () => {
    const workspaceRoot = await makeWorkspace()
    const artifactsDir = join(workspaceRoot, '.sciforge', 'artifacts')
    await mkdir(artifactsDir, { recursive: true })
    const plotPath = join(workspaceRoot, 'plain-name.png')
    const pptxPath = join(workspaceRoot, 'deck-output.pptx')
    const plotManifestPath = join(workspaceRoot, 'plot-render.manifest.json')
    const pptManifestPath = join(workspaceRoot, 'presentations', 'deck', 'sources', 'sciforge_manifest.json')
    await mkdir(join(workspaceRoot, 'presentations', 'deck', 'sources'), { recursive: true })
    await writeFile(plotPath, PNG_1X1)
    await writeFile(pptxPath, 'pptx-bytes')
    await writeFile(plotManifestPath, '{}')
    await writeFile(pptManifestPath, '{}')
    await writeFile(join(artifactsDir, 'plot.artifact.json'), JSON.stringify({
      version: 1,
      kind: 'sciforge_artifact',
      sourceTool: 'scientific_plotting',
      artifactKind: 'scientific_plot',
      createdAt: new Date().toISOString(),
      path: plotPath,
      outputPath: plotPath,
      manifestPath: plotManifestPath,
      title: 'Manifest plot'
    }, null, 2))
    await writeFile(join(artifactsDir, 'ppt.artifact.json'), JSON.stringify({
      version: 1,
      kind: 'sciforge_artifact',
      sourceTool: 'ppt_master',
      artifactKind: 'ppt_export',
      createdAt: new Date().toISOString(),
      path: pptxPath,
      pptxPath,
      projectPath: join(workspaceRoot, 'presentations', 'deck'),
      manifestPath: pptManifestPath,
      title: 'Manifest deck'
    }, null, 2))

    const previousDisable = process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER = '1'
    try {
      const imported = await importRecentSciforgeCanvasArtifacts({ workspaceRoot, limit: 5 })
      expect(imported.ok).toBe(true)
      if (!imported.ok) return
      expect(imported.imported).toBe(2)
      expect(imported.artifacts.map((artifact) => artifact.sourceTool).sort()).toEqual([
        'ppt_master',
        'scientific_plotting'
      ])
      expect(imported.inserted.find((item) => item.artifact.sourceTool === 'scientific_plotting')?.result.artifact).toMatchObject({
        artifactKind: 'scientific_plot',
        title: 'Manifest plot'
      })
      const pptArtifact = imported.inserted.find((item) => item.artifact.sourceTool === 'ppt_master')?.result.artifact
      expect(pptArtifact).toMatchObject({
        artifactKind: 'ppt_export',
        title: 'Manifest deck'
      })
      expect(pptArtifact?.pptxPath).toMatch(/deck-output.pptx$/)
    } finally {
      restoreEnv('SCIFORGE_CANVAS_DISABLE_PPT_RENDER', previousDisable)
    }
  })

  it('imports only current canvas artifact-bus entries in current_canvas scope', async () => {
    const workspaceRoot = await makeWorkspace()
    const artifactsDir = join(workspaceRoot, '.sciforge', 'artifacts')
    await mkdir(artifactsDir, { recursive: true })
    const loosePlotPath = join(workspaceRoot, 'loose_workspace_plot.png')
    const currentPlotPath = join(workspaceRoot, 'current_canvas_plot.png')
    const otherPlotPath = join(workspaceRoot, 'other_canvas_plot.png')
    await writeFile(loosePlotPath, PNG_1X1)
    await writeFile(currentPlotPath, PNG_1X1)
    await writeFile(otherPlotPath, PNG_1X1)
    await writeFile(join(artifactsDir, 'current.artifact.json'), JSON.stringify({
      version: 1,
      kind: 'sciforge_artifact',
      sourceTool: 'scientific_plotting',
      artifactKind: 'scientific_plot',
      createdAt: new Date().toISOString(),
      path: currentPlotPath,
      outputPath: currentPlotPath,
      canvasId: 'thread-current',
      title: 'Current canvas plot'
    }, null, 2))
    await writeFile(join(artifactsDir, 'other.artifact.json'), JSON.stringify({
      version: 1,
      kind: 'sciforge_artifact',
      sourceTool: 'scientific_plotting',
      artifactKind: 'scientific_plot',
      createdAt: new Date().toISOString(),
      path: otherPlotPath,
      outputPath: otherPlotPath,
      canvasId: 'thread-other',
      title: 'Other canvas plot'
    }, null, 2))

    const imported = await importRecentSciforgeCanvasArtifacts({
      workspaceRoot,
      canvasId: 'thread-current',
      scope: 'current_canvas',
      limit: 5
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.imported).toBe(1)
    expect(imported.artifacts.map((artifact) => artifact.title)).toEqual(['Current canvas plot'])
    expect(imported.artifacts.some((artifact) => artifact.relativePath === 'loose_workspace_plot.png')).toBe(false)
  })

  it('falls back to the artifact bus manifest when a PPT source manifest is missing', async () => {
    const workspaceRoot = await makeWorkspace()
    const artifactsDir = join(workspaceRoot, '.sciforge', 'artifacts')
    await mkdir(artifactsDir, { recursive: true })
    const deckDir = join(workspaceRoot, 'presentations', 'deck')
    await mkdir(join(deckDir, 'exports'), { recursive: true })
    const pptxPath = join(deckDir, 'exports', 'deck-output.pptx')
    const artifactManifestPath = join(artifactsDir, 'ppt.artifact.json')
    await writeFile(pptxPath, 'pptx-bytes')
    await writeFile(artifactManifestPath, JSON.stringify({
      version: 1,
      kind: 'sciforge_artifact',
      sourceTool: 'ppt_master',
      artifactKind: 'ppt_export',
      createdAt: new Date().toISOString(),
      path: pptxPath,
      pptxPath,
      projectPath: deckDir,
      manifestPath: join(deckDir, 'sources', 'sciforge_manifest.json'),
      title: 'Manifest deck'
    }, null, 2))

    const previousDisable = process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER = '1'
    try {
      const imported = await importRecentSciforgeCanvasArtifacts({ workspaceRoot, limit: 5 })
      expect(imported.ok).toBe(true)
      if (!imported.ok) return
      expect(imported.imported).toBe(1)
      expect(imported.warnings.join('\n')).not.toContain('File not found')
      const pptArtifact = imported.inserted[0]?.result.artifact
      expect(pptArtifact).toMatchObject({
        artifactKind: 'ppt_export',
        title: 'Manifest deck'
      })
      expect(pptArtifact?.manifestPath).toMatch(/\.sciforge\/artifacts\/ppt\.artifact\.json$/)
    } finally {
      restoreEnv('SCIFORGE_CANVAS_DISABLE_PPT_RENDER', previousDisable)
    }
  })

  it('skips ppt-master backup directories when importing recent artifacts', async () => {
    const workspaceRoot = await makeWorkspace()
    const currentSvgPath = join(workspaceRoot, 'presentations', 'deck', 'svg_output', 'P1_smoke.svg')
    const backupSvgPath = join(workspaceRoot, 'presentations', 'deck', 'backup', '20260625_162030', 'svg_output', 'P1_smoke.svg')
    await mkdir(dirname(currentSvgPath), { recursive: true })
    await mkdir(dirname(backupSvgPath), { recursive: true })
    await writeFile(currentSvgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>')
    await writeFile(backupSvgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>')

    const imported = await importRecentSciforgeCanvasArtifacts({ workspaceRoot, limit: 5 })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.artifacts.map((artifact) => artifact.relativePath)).toEqual([
      'presentations/deck/svg_output/P1_smoke.svg'
    ])
    expect(imported.imported).toBe(1)
  })

  it('represents PPTX exports as placeholders without requiring slide rendering', async () => {
    const workspaceRoot = await makeWorkspace()
    const deckDir = join(workspaceRoot, 'deck')
    await mkdir(deckDir)
    const pptxPath = join(workspaceRoot, 'deck.pptx')
    await writeFile(pptxPath, 'pptx-bytes')

    const previousDisable = process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER
    process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER = '1'
    try {
      const inserted = await insertSciforgeCanvasArtifact({
        workspaceRoot,
        artifactKind: 'ppt_export',
        pptxPath,
        projectPath: deckDir,
        title: 'Exported deck'
      })
      expect(inserted.ok).toBe(true)
      if (!inserted.ok) return
      expect(inserted.assetId).toBeUndefined()
      expect(inserted.artifact.artifactKind).toBe('ppt_export')
      const snapshot = JSON.parse(await readFile(inserted.canvasPath, 'utf8'))
      expect(snapshot.store[inserted.shapeId].type).toBe('frame')
      expect(snapshot.store[inserted.shapeId].meta.sciforgeCanvasPlaceholder).toBe(true)
    } finally {
      restoreEnv('SCIFORGE_CANVAS_DISABLE_PPT_RENDER', previousDisable)
    }
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
