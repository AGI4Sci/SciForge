import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants as fsConstants, type Dirent } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, delimiter, dirname, extname, join, relative as pathRelative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { segmentImageGenerationComponents } from '@sciforge/image-generation/engine'
import { generateKeyBetween } from 'fractional-indexing'
import type {
  SciforgeCanvasArtifactKind,
  SciforgeArtifactManifest,
  SciforgeCanvasArtifactMetadata,
  SciforgeCanvasBounds,
  SciforgeCanvasDrawioSnapshot,
  SciforgeCanvasImportRecentArtifactsRequest,
  SciforgeCanvasImportRecentArtifactsResult,
  SciforgeCanvasInsertArtifactRequest,
  SciforgeCanvasInsertArtifactResult,
  SciforgeCanvasOpenRequest,
  SciforgeCanvasRecentArtifact,
  SciforgeCanvasOpenResult,
  SciforgeCanvasReviewPacket,
  SciforgeCanvasReviewPacketAnnotation,
  SciforgeCanvasReviewPacketArtifact,
  SciforgeCanvasReviewPacketRequest,
  SciforgeCanvasReviewPacketResult,
  SciforgeCanvasSaveRequest,
  SciforgeCanvasSplitArtifactComponentsRequest,
  SciforgeCanvasSplitArtifactComponentsResult,
  SciforgeCanvasSaveResult,
  SciforgeCanvasSelectionSaveRequest,
  SciforgeCanvasSelectionState,
  SciforgeCanvasSelectedShape,
  SciforgeCanvasStatusResult
} from './types'
import {
  SCIFORGE_CANVAS_ARTIFACT_KINDS
} from './types'
import {
  canonicalPath,
  extensionFromName,
  resolveOpenTargetPath,
  resolveTargetPathWithinWorkspace
} from './workspace-paths'

type JsonRecord = Record<string, unknown>

type TldrawSnapshot = {
  store: Record<string, JsonRecord>
  schema: JsonRecord
}

type CanvasPaths = {
  workspaceRoot: string
  canvasId: string
  canvasDir: string
  canvasPath: string
  drawioPath: string
  assetsDir: string
  selectionPath: string
  packetPath: string
  rendersDir: string
}

type ImageDimensions = {
  width: number
  height: number
}

type PptRenderTools = {
  sofficePath?: string
  pdftoppmPath?: string
  qlmanagePath?: string
}

type PptxPreviewResult = {
  pngPath: string
  pdfPath: string
  slideIndex: number
  pageNumber: number
}

type DiagramLayerBounds = {
  x: number
  y: number
  w: number
  h: number
}

type DiagramLayer = {
  id: string
  type: string
  label?: string
  bbox?: DiagramLayerBounds
  zIndex?: number
  style?: Record<string, string | number | boolean>
  assetPath?: string | null
  editable?: boolean
  origin?: string
  from?: string
  to?: string
}

type FrameworkComponentManifest = {
  version: 1
  kind: 'sciforge_framework_components'
  sourceImagePath: string
  componentBasePath: string
  componentDir: string
  canvasSize: ImageDimensions
  blocks?: FrameworkComponentBlock[]
  components: FrameworkComponentLayer[]
  semanticLayerImages?: Array<{
    semanticLayer: string
    assetPath: string
    previewPath: string
    pixelCount: number
    coverage: number
    detectionMethod?: string
  }>
  warnings?: string[]
}

type FrameworkComponentBlock = {
  blockId: string
  title?: string
  blockType?: string
  pixelBbox: DiagramLayerBounds
  childComponentIds: string[]
  semanticLayers?: string[]
  detectionMethods?: string[]
  confidence?: number
}

type FrameworkComponentLayer = {
  componentId: string
  layerId?: string
  type: string
  title?: string
  pixelBbox: DiagramLayerBounds
  assetPath?: string
  transparentAssetPath?: string
  semanticLayer?: string
  parentComponentId?: string
  parentBlockId?: string
  children?: string[]
  detectionMethod?: string
  reusableTemplateId?: string
  placeholderId?: string
  sourcePrompt?: string
  confidence?: number
}

type FrameworkSplitTarget = {
  id: string
  title: string
  pixelBbox: DiagramLayerBounds
  meta: JsonRecord
}

type DiagramLayerManifest = {
  version: 1
  kind: 'sciforge_diagram_layers'
  canvas: {
    width: number
    height: number
    background?: string
    layout?: string
  }
  layers: DiagramLayer[]
}

const SERVER_VERSION = '0.1.0'
const DEFAULT_CANVAS_ID = 'default'
const CANVAS_ROOT_RELATIVE = '.sciforge/canvases'
const DEFAULT_PAGE_ID = 'page:sciforge-canvas'
const DEFAULT_PAGE_NAME = 'SciForge Canvas'
const DEFAULT_DRAWIO_PAGE_ID = 'sciforge-canvas'
const DEFAULT_PAGE_INDEX = 'a1'
const DEFAULT_IMAGE_WIDTH = 640
const PLACEHOLDER_WIDTH = 460
const PLACEHOLDER_HEIGHT = 260
const MAX_IMAGE_BYTES = 40 * 1024 * 1024
const DRAWIO_INLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024
const MAX_FRAMEWORK_BLOCK_HITBOXES = 36
const MAX_FINE_COMPONENT_HITBOXES = 80
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg'])
const RECENT_ARTIFACT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.pptx'])
const RECENT_ARTIFACT_DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_ARTIFACT_DEFAULT_LIMIT = 8
const RECENT_ARTIFACT_MAX_LIMIT = 20
const RECENT_ARTIFACT_MAX_DEPTH = 5
const RECENT_ARTIFACT_MAX_VISITED = 3000
const ARTIFACT_MANIFEST_RELATIVE_DIR = '.sciforge/artifacts'
const SKIPPED_SCAN_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.vite', '.turbo'])
const PPT_PREVIEW_DPI = 160
const DEFAULT_PPT_RENDER_TIMEOUT_MS = 8_000
const CURRENT_TLDRAW_NOTE_SCHEMA_VERSION = 10
const execFileAsync = promisify(execFile)

const EMPTY_TLDRAW_SCHEMA: JsonRecord = {
  schemaVersion: 2,
  sequences: {
    'com.tldraw.store': 5,
    'com.tldraw.asset': 1,
    'com.tldraw.camera': 1,
    'com.tldraw.document': 2,
    'com.tldraw.instance': 26,
    'com.tldraw.instance_page_state': 5,
    'com.tldraw.page': 1,
    'com.tldraw.instance_presence': 6,
    'com.tldraw.pointer': 1,
    'com.tldraw.shape': 4,
    'com.tldraw.user': 1,
    'com.tldraw.asset.image': 6,
    'com.tldraw.asset.video': 5,
    'com.tldraw.asset.bookmark': 2,
    'com.tldraw.shape.group': 0,
    'com.tldraw.shape.text': 4,
    'com.tldraw.shape.bookmark': 2,
    'com.tldraw.shape.draw': 4,
    'com.tldraw.shape.geo': 11,
    'com.tldraw.shape.note': CURRENT_TLDRAW_NOTE_SCHEMA_VERSION,
    'com.tldraw.shape.line': 5,
    'com.tldraw.shape.frame': 1,
    'com.tldraw.shape.arrow': 8,
    'com.tldraw.shape.highlight': 3,
    'com.tldraw.shape.embed': 4,
    'com.tldraw.shape.image': 5,
    'com.tldraw.shape.video': 4,
    'com.tldraw.binding.arrow': 1
  }
}

export async function getSciforgeCanvasStatus(
  workspaceRoot?: string
): Promise<SciforgeCanvasStatusResult> {
  const pptRenderTools = await detectPptRenderTools()
  return {
    ok: true,
    serverName: 'sciforge_canvas',
    version: SERVER_VERSION,
    ...(workspaceRoot?.trim() ? { workspaceRoot: await resolveWorkspaceRoot(workspaceRoot) } : {}),
    defaultRelativeDir: CANVAS_ROOT_RELATIVE,
    supportedArtifactKinds: [...SCIFORGE_CANVAS_ARTIFACT_KINDS],
    canvasEngine: 'drawio' as const,
    cowartCompatibility: {
      aiImageHolderMeta: 'cowartAiImageHolder',
      annotationArrowMeta: 'cowartAnnotationArrow',
      annotationEditMeta: 'cowartGeneratedFromAnnotationEdit',
      sourceShapeMeta: 'cowartAnnotationSourceShapeId',
      annotationScreenshotMeta: 'cowartAnnotationScreenshot'
    },
    guardrails: [
      'Canvas state and assets are written only inside the selected workspace.',
      'New canvases are stored as draw.io XML; legacy tldraw snapshots are retained for migration only.',
      'Cowart-compatible metadata is preserved for AI image holders, annotation arrows, and before/after edits.',
      'Scientific plot and ppt-master source artifacts are not overwritten.',
      'Canvas review packets describe requested adjustments; they do not directly mutate scientific data or ppt-master projects.'
    ],
    pptRendering: {
      svgSlidePreview: true,
      pptxPreview: (pptRenderTools.sofficePath && pptRenderTools.pdftoppmPath) || pptRenderTools.qlmanagePath
        ? 'available'
        : 'unavailable',
      ...(pptRenderTools.sofficePath ? { sofficePath: pptRenderTools.sofficePath } : {}),
      ...(pptRenderTools.pdftoppmPath ? { pdftoppmPath: pptRenderTools.pdftoppmPath } : {}),
      ...(pptRenderTools.qlmanagePath ? { qlmanagePath: pptRenderTools.qlmanagePath } : {})
    }
  }
}

export async function openOrCreateSciforgeCanvas(
  request: SciforgeCanvasOpenRequest
): Promise<SciforgeCanvasOpenResult> {
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    await mkdir(paths.assetsDir, { recursive: true })
    if (process.env.SCIFORGE_CANVAS_ENGINE === 'tldraw') {
      const existed = await fileExists(paths.canvasPath)
      const snapshot = existed ? await readCanvasSnapshot(paths) : createInitialCanvasSnapshot()
      if (!existed) await writeJsonAtomic(paths.canvasPath, snapshot)
      const selection = await readSelectionState(paths)
      return {
        ok: true,
        status: existed ? 'opened' : 'created',
        workspaceRoot: paths.workspaceRoot,
        canvasId: paths.canvasId,
        canvasDir: paths.canvasDir,
        canvasPath: paths.canvasPath,
        engine: 'tldraw',
        assetsDir: paths.assetsDir,
        selectionPath: paths.selectionPath,
        snapshot,
        selection,
        warnings: []
      }
    }
    const existed = await fileExists(paths.drawioPath)
    const diagramXml = await ensureDrawioXml(paths)
    const selection = await readSelectionState(paths)
    const snapshot: SciforgeCanvasDrawioSnapshot = {
      engine: 'drawio',
      diagramXml,
      diagramPath: paths.drawioPath,
      ...(await fileExists(paths.canvasPath) ? { legacySnapshotPath: paths.canvasPath } : {}),
      updatedAt: new Date().toISOString()
    }
    return {
      ok: true,
      status: existed ? 'opened' : 'created',
      workspaceRoot: paths.workspaceRoot,
      canvasId: paths.canvasId,
      canvasDir: paths.canvasDir,
      canvasPath: paths.canvasPath,
      engine: 'drawio',
      drawioPath: paths.drawioPath,
      assetsDir: paths.assetsDir,
      selectionPath: paths.selectionPath,
      snapshot,
      selection,
      warnings: []
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : message.includes('snapshot') ? 'invalid_snapshot' : 'invalid_request',
      message
    }
  }
}

export async function saveSciforgeCanvasSnapshot(
  request: SciforgeCanvasSaveRequest
): Promise<SciforgeCanvasSaveResult> {
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    if (isDrawioSnapshot(request.snapshot)) {
      await mkdir(paths.canvasDir, { recursive: true })
      const diagramXml = normalizeDrawioXml(request.snapshot.diagramXml)
      await writeTextAtomic(paths.drawioPath, diagramXml)
      return {
        ok: true,
        status: 'saved',
        canvasId: paths.canvasId,
        canvasPath: paths.canvasPath,
        engine: 'drawio',
        drawioPath: paths.drawioPath,
        updatedAt: new Date().toISOString()
      }
    }
    const snapshot = normalizeSnapshot(request.snapshot)
    await mkdir(paths.assetsDir, { recursive: true })
    await writeJsonAtomic(paths.canvasPath, snapshot)
    return {
      ok: true,
      status: 'saved',
      canvasId: paths.canvasId,
      canvasPath: paths.canvasPath,
      engine: 'tldraw',
      updatedAt: new Date().toISOString()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : message.includes('snapshot') ? 'invalid_snapshot' : 'invalid_request',
      message
    }
  }
}

export async function saveSciforgeCanvasSelection(
  request: SciforgeCanvasSelectionSaveRequest
): Promise<SciforgeCanvasSaveResult> {
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    const selection = normalizeSelection(request.selection)
    await mkdir(paths.canvasDir, { recursive: true })
    await writeJsonAtomic(paths.selectionPath, {
      ...selection,
      updatedAt: selection.updatedAt ?? new Date().toISOString()
    })
    return {
      ok: true,
      status: 'saved',
      canvasId: paths.canvasId,
      canvasPath: paths.selectionPath,
      updatedAt: new Date().toISOString()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : 'invalid_request',
      message
    }
  }
}

export async function insertSciforgeCanvasArtifact(
  request: SciforgeCanvasInsertArtifactRequest
): Promise<SciforgeCanvasInsertArtifactResult> {
  const warnings: string[] = []
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    await mkdir(paths.assetsDir, { recursive: true })
    let artifact = await buildArtifactMetadata(request, paths.workspaceRoot, warnings)
    artifact = await prepareCanvasArtifactPreview({
      artifact,
      request,
      paths,
      warnings
    })
    if (await shouldUseDrawioCanvas(paths)) {
      const result = await insertDrawioArtifact({
        paths,
        artifact,
        request,
        warnings
      })
      return {
        ...result,
        status: request.dryRun ? 'planned' : 'inserted',
        dryRun: Boolean(request.dryRun),
        warnings
      }
    }

    const snapshot = await ensureCanvasSnapshot(paths)
    const pageId = findPageId(snapshot) ?? DEFAULT_PAGE_ID
    ensurePageRecord(snapshot, pageId)
    const anchorShape = request.anchorShapeId ? snapshot.store[request.anchorShapeId] : null
    const parentId = anchorShape?.parentId && snapshot.store[String(anchorShape.parentId)]?.typeName === 'page'
      ? String(anchorShape.parentId)
      : pageId

    const shapeMeta = buildShapeMeta(request, artifact)
    let result: Extract<SciforgeCanvasInsertArtifactResult, { ok: true }>
    if (artifact.pptxPath && request.artifactKind === 'ppt_export' && !displayPathForArtifact(artifact)) {
      result = insertPlaceholderArtifact({
        snapshot,
        paths,
        artifact,
        request,
        pageId,
        parentId,
        anchorShape: asRecord(anchorShape),
        shapeMeta
      })
    } else {
      result = await insertImageArtifact({
        snapshot,
        paths,
        artifact,
        request,
        pageId,
        parentId,
        anchorShape: asRecord(anchorShape),
        shapeMeta,
        warnings
      })
    }

    if (!request.dryRun) {
      await writeJsonAtomic(paths.canvasPath, snapshot)
    }
    return {
      ...result,
      status: request.dryRun ? 'planned' : 'inserted',
      dryRun: Boolean(request.dryRun),
      warnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: statusForInsertError(message),
      message,
      warnings
    }
  }
}


export async function splitSciforgeCanvasArtifactComponents(
  request: SciforgeCanvasSplitArtifactComponentsRequest
): Promise<SciforgeCanvasSplitArtifactComponentsResult> {
  const warnings: string[] = []
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    await mkdir(paths.assetsDir, { recursive: true })
    let xml = await ensureDrawioXml(paths)
    const rawManifestPath = request.frameworkComponentManifestPath?.trim() ||
      findFrameworkComponentManifestPathInDrawioXml(xml)
    const generatedManifestPath = rawManifestPath
      ? undefined
      : await generateFrameworkComponentManifestFromCanvasImage({
          xml,
          paths,
          sourceShapeId: request.sourceShapeId,
          warnings
        })
    const manifestCandidatePath = rawManifestPath || generatedManifestPath
    if (!manifestCandidatePath) {
      return {
        ok: false,
        status: 'component_manifest_not_found',
        message: '当前画布没有可拆分的图片。请先把 framework/论文图 artifact 导入画布，然后再展开组件。',
        warnings
      }
    }
    const manifestPath = await resolveOpenTargetPath(manifestCandidatePath, paths.workspaceRoot, { allowBasenameFallback: false })
    if (!request.dryRun) {
      const cleaned = removeFrameworkComponentSplitCellsForManifest(xml, manifestPath)
      if (cleaned.removed > 0) {
        xml = cleaned.xml
        warnings.push(`Removed ${cleaned.removed} existing framework component cells before rebuilding selectable hitboxes.`)
      }
    }
    const manifest = parseFrameworkComponentManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown)
    const canvasWidth = Math.max(1, manifest.canvasSize.width)
    const canvasHeight = Math.max(1, manifest.canvasSize.height)
    const sourceArtifact = findCanvasArtifactForComponentSegmentation(xml, request.sourceShapeId)
    const sourceBounds = sourceArtifact?.bounds && sourceArtifact.bounds.w > 0 && sourceArtifact.bounds.h > 0
      ? sourceArtifact.bounds
      : null
    const width = finiteNumber(request.displayWidth, sourceBounds?.w ?? Math.min(canvasWidth, DEFAULT_IMAGE_WIDTH))
    const height = sourceBounds?.h ?? Math.round(width * canvasHeight / canvasWidth)
    const bounds = sourceBounds ?? chooseDrawioPlacement(xml, width, height, Math.max(0, finiteNumber(request.margin, 64)))
    const scaleX = bounds.w / canvasWidth
    const scaleY = bounds.h / canvasHeight
    const usedXmlParts: string[] = []
    const baseShapeId = sourceArtifact?.shapeId ?? uniqueDrawioCellId(xml, 'framework-component-base')
    const baseMeta: JsonRecord = {
      sciforgeFrameworkComponentBase: true,
      sciforgeCanvasLocked: true,
      frameworkComponentManifestPath: manifestPath,
      sciforgeFrameworkComponentManifestPath: manifestPath,
      sourceImagePath: manifest.sourceImagePath,
      componentBasePath: manifest.componentBasePath,
      componentCount: manifest.components.length,
      blockCount: manifest.blocks?.length ?? 0,
      semanticLayerCount: manifest.semanticLayerImages?.length ?? 0
    }
    if (sourceArtifact) {
      warnings.push('Using the existing canvas image as the component base; inserted selectable hitboxes only.')
    } else {
      let baseCell = await createDrawioImageCellFromFile({
        id: baseShapeId,
        title: 'Framework image base',
        path: await resolveComponentAssetPath(manifest.sourceImagePath || manifest.componentBasePath, paths.workspaceRoot),
        bounds,
        meta: baseMeta,
        warnings
      })
      baseCell = baseCell.replace(';html=1"', ';html=1;locked=1"')
      usedXmlParts.push(baseCell)
    }

    const componentShapeIds: string[] = []
    const splitTargets = frameworkSplitTargets({
      manifest,
      manifestPath,
      canvasWidth,
      canvasHeight,
      warnings
    })
    for (const target of splitTargets) {
      const cellId = uniqueDrawioCellId(xml + usedXmlParts.join('\n'), target.id || 'framework-component')
      const componentBounds = {
        x: bounds.x + target.pixelBbox.x * scaleX,
        y: bounds.y + target.pixelBbox.y * scaleY,
        w: Math.max(4, target.pixelBbox.w * scaleX),
        h: Math.max(4, target.pixelBbox.h * scaleY)
      }
      usedXmlParts.push(createDrawioFrameworkComponentHitboxCell({
        id: cellId,
        title: target.title,
        bounds: componentBounds,
        meta: target.meta
      }))
      componentShapeIds.push(cellId)
    }
    if (!request.dryRun) {
      await writeTextAtomic(paths.drawioPath, insertDrawioCellXml(xml, usedXmlParts.join('\n')))
    }
    return {
      ok: true,
      status: request.dryRun ? 'planned' : 'split',
      canvasId: paths.canvasId,
      canvasDir: paths.canvasDir,
      canvasPath: paths.canvasPath,
      frameworkComponentManifestPath: manifestPath,
      baseShapeId,
      componentShapeIds,
      componentCount: componentShapeIds.length,
      bounds,
      warnings,
      dryRun: Boolean(request.dryRun)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : message.includes('manifest') ? 'manifest_not_found' : message.includes('write') ? 'canvas_write_failed' : 'invalid_request',
      message,
      warnings
    }
  }
}

function frameworkSplitTargets(input: {
  manifest: FrameworkComponentManifest
  manifestPath: string
  canvasWidth: number
  canvasHeight: number
  warnings: string[]
}): FrameworkSplitTarget[] {
  const blocks = (input.manifest.blocks ?? [])
    .filter((block) => validSplitBounds(block.pixelBbox, input.canvasWidth, input.canvasHeight))
    .sort((a, b) => {
      const areaA = a.pixelBbox.w * a.pixelBbox.h
      const areaB = b.pixelBbox.w * b.pixelBbox.h
      if (Math.abs(areaA - areaB) > input.canvasWidth * input.canvasHeight * 0.01) return areaB - areaA
      if (Math.abs(a.pixelBbox.y - b.pixelBbox.y) > 6) return a.pixelBbox.y - b.pixelBbox.y
      return a.pixelBbox.x - b.pixelBbox.x
    })
  if (blocks.length > 0) {
    if (input.manifest.components.length > blocks.length) {
      input.warnings.push(`Inserted ${blocks.length} block-level selectable hitboxes instead of ${input.manifest.components.length} fine local components, so text fragments stay hidden on the canvas.`)
    }
    if (blocks.length > MAX_FRAMEWORK_BLOCK_HITBOXES) {
      input.warnings.push(`Framework segmentation produced ${blocks.length} block-level hitboxes; inserted the largest ${MAX_FRAMEWORK_BLOCK_HITBOXES} only to keep the canvas usable.`)
    }
    return blocks.slice(0, MAX_FRAMEWORK_BLOCK_HITBOXES).map((block): FrameworkSplitTarget => ({
      id: block.blockId,
      title: block.title || block.blockId,
      pixelBbox: block.pixelBbox,
      meta: {
        sciforgeFrameworkComponent: true,
        sciforgeFrameworkBlock: true,
        blockId: block.blockId,
        parentBlockId: block.blockId,
        parentBlockTitle: block.title,
        parentBlockType: block.blockType,
        parentBlockChildComponentIds: block.childComponentIds,
        childComponentIds: block.childComponentIds,
        parentBlockSemanticLayers: block.semanticLayers,
        detectionMethod: (block.detectionMethods ?? []).join(',') || 'framework_block',
        frameworkComponentManifestPath: input.manifestPath,
        sciforgeFrameworkComponentManifestPath: input.manifestPath,
        confidence: block.confidence
      }
    }))
  }

  const blockById = new Map((input.manifest.blocks ?? []).map((block) => [block.blockId, block]))
  const fineComponents = [...input.manifest.components]
    .filter((component) => validSplitBounds(component.pixelBbox, input.canvasWidth, input.canvasHeight))
    .sort((a, b) => {
      const areaA = a.pixelBbox.w * a.pixelBbox.h
      const areaB = b.pixelBbox.w * b.pixelBbox.h
      if (Math.abs(areaA - areaB) > input.canvasWidth * input.canvasHeight * 0.006) return areaB - areaA
      if (Math.abs(a.pixelBbox.y - b.pixelBbox.y) > 6) return a.pixelBbox.y - b.pixelBbox.y
      return a.pixelBbox.x - b.pixelBbox.x
    })
  if (fineComponents.length > MAX_FINE_COMPONENT_HITBOXES) {
    input.warnings.push(`Local segmentation produced ${fineComponents.length} fine components; inserted the largest ${MAX_FINE_COMPONENT_HITBOXES} selectable hitboxes only. Configure a component segmentation runner for finer scientific component masks.`)
  }
  return fineComponents.slice(0, MAX_FINE_COMPONENT_HITBOXES).map((component): FrameworkSplitTarget => {
    const parentBlock = component.parentBlockId ? blockById.get(component.parentBlockId) : undefined
    return {
      id: component.componentId || component.layerId || 'framework-component',
      title: component.title || component.componentId,
      pixelBbox: component.pixelBbox,
      meta: {
        sciforgeFrameworkComponent: true,
        componentId: component.componentId,
        sciforgeFrameworkComponentId: component.componentId,
        layerId: component.layerId,
        componentType: component.type,
        semanticLayer: component.semanticLayer,
        parentComponentId: component.parentComponentId,
        parentBlockId: component.parentBlockId,
        childComponentIds: component.children,
        detectionMethod: component.detectionMethod,
        reusableTemplateId: component.reusableTemplateId,
        parentBlockTitle: parentBlock?.title,
        parentBlockType: parentBlock?.blockType,
        parentBlockChildComponentIds: parentBlock?.childComponentIds,
        parentBlockSemanticLayers: parentBlock?.semanticLayers,
        placeholderId: component.placeholderId,
        sourcePrompt: component.sourcePrompt,
        frameworkComponentManifestPath: input.manifestPath,
        sciforgeFrameworkComponentManifestPath: input.manifestPath,
        confidence: component.confidence
      }
    }
  })
}

function validSplitBounds(bounds: DiagramLayerBounds, canvasWidth: number, canvasHeight: number): boolean {
  if (bounds.w <= 0 || bounds.h <= 0) return false
  const areaRatio = (bounds.w * bounds.h) / Math.max(1, canvasWidth * canvasHeight)
  return areaRatio > 0.0003 && areaRatio < 0.98
}

async function generateFrameworkComponentManifestFromCanvasImage(input: {
  xml: string
  paths: CanvasPaths
  sourceShapeId?: string
  warnings: string[]
}): Promise<string | undefined> {
  const target = findCanvasArtifactForComponentSegmentation(input.xml, input.sourceShapeId)
  if (!target) return undefined
  const rawImagePath = displayPathForArtifact(target)
  if (!rawImagePath?.trim()) return undefined
  const sourceImagePath = await resolveOpenTargetPath(rawImagePath, input.paths.workspaceRoot, { allowBasenameFallback: false })
  const ext = extensionFromName(sourceImagePath)
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error(`当前 artifact 不是可拆分的 raster 图片：${relativePath(input.paths.workspaceRoot, sourceImagePath)}`)
  }
  input.warnings.push('No framework component manifest was found on the selected canvas image; generated one from the current image with the image-generation component segmentation pipeline.')
  const result = await segmentImageGenerationComponents({
    workspaceRoot: input.paths.workspaceRoot,
    sourceImagePath,
    outputDir: join(input.paths.canvasDir, 'components'),
    imageId: sanitizeId(`${target.shapeId}-components`, 'canvas-components'),
    ...(target.frameworkDesignPlanPath ? { frameworkDesignPlanPath: target.frameworkDesignPlanPath } : {})
  })
  if (!result.ok) {
    throw new Error(result.message)
  }
  if (result.warnings?.length) input.warnings.push(...result.warnings)
  return result.frameworkComponentManifestPath
}


export async function importRecentSciforgeCanvasArtifacts(
  request: SciforgeCanvasImportRecentArtifactsRequest
): Promise<SciforgeCanvasImportRecentArtifactsResult> {
  const warnings: string[] = []
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    await mkdir(paths.assetsDir, { recursive: true })
    const existingPaths = request.includeExisting
      ? new Set<string>()
      : await artifactPathsForCanvas(paths)
    const limit = Math.min(
      RECENT_ARTIFACT_MAX_LIMIT,
      Math.max(1, Math.floor(request.limit ?? RECENT_ARTIFACT_DEFAULT_LIMIT))
    )
    const maxAgeMs = Math.max(0, Math.floor(request.maxAgeMs ?? RECENT_ARTIFACT_DEFAULT_MAX_AGE_MS))
    const scope = request.scope ?? 'workspace_recent'
    const discovered = await discoverRecentCanvasArtifacts({
      workspaceRoot: paths.workspaceRoot,
      canvasId: paths.canvasId,
      canvasDir: paths.canvasDir,
      existingPaths,
      maxAgeMs,
      limit,
      scope,
      warnings
    })
    const inserted: Extract<SciforgeCanvasImportRecentArtifactsResult, { ok: true }>['inserted'] = []

    for (const artifact of discovered.artifacts.slice(0, limit)) {
      if (artifact.alreadyOnCanvas && !request.includeExisting) continue
      const result = await insertSciforgeCanvasArtifact({
        workspaceRoot: paths.workspaceRoot,
        canvasId: paths.canvasId,
        artifactKind: artifact.artifactKind,
        ...(artifact.artifactKind === 'ppt_export'
          ? { pptxPath: artifact.pptxPath ?? artifact.path, slideIndex: artifact.slideIndex ?? 0 }
          : artifact.artifactKind === 'ppt_slide'
            ? { svgPath: artifact.svgPath ?? artifact.path, slideIndex: artifact.slideIndex }
            : artifact.artifactKind === 'scientific_plot'
              ? { outputPath: artifact.outputPath ?? artifact.path }
              : { sourcePath: artifact.sourcePath ?? artifact.path }),
        ...(artifact.manifestPath ? { manifestPath: artifact.manifestPath } : {}),
        ...(artifact.previewPath ? { previewPath: artifact.previewPath } : {}),
        ...(artifact.styleSpecPath ? { styleSpecPath: artifact.styleSpecPath } : {}),
        ...(artifact.diagramSpecPath ? { diagramSpecPath: artifact.diagramSpecPath } : {}),
        ...(artifact.frameworkDesignPlanPath ? { frameworkDesignPlanPath: artifact.frameworkDesignPlanPath } : {}),
        ...(artifact.diagramLayerManifestPath ? { diagramLayerManifestPath: artifact.diagramLayerManifestPath } : {}),
        ...(artifact.fastSamSegmentationPath ? { fastSamSegmentationPath: artifact.fastSamSegmentationPath } : {}),
        ...(artifact.fastSamBoxlibPath ? { fastSamBoxlibPath: artifact.fastSamBoxlibPath } : {}),
        ...(artifact.fastSamPreviewPath ? { fastSamPreviewPath: artifact.fastSamPreviewPath } : {}),
        ...(artifact.frameworkComponentManifestPath ? { frameworkComponentManifestPath: artifact.frameworkComponentManifestPath } : {}),
        ...(artifact.componentBasePath ? { componentBasePath: artifact.componentBasePath } : {}),
        ...(artifact.componentAssetPaths?.length ? { componentAssetPaths: artifact.componentAssetPaths } : {}),
        ...(artifact.referencePath ? { referencePath: artifact.referencePath } : {}),
        ...(artifact.projectPath ? { projectPath: artifact.projectPath } : {}),
        ...(artifact.caption ? { caption: artifact.caption } : {}),
        ...(artifact.reviewScore ? { reviewScore: artifact.reviewScore } : {}),
        title: artifact.title,
        sourceTool: artifact.sourceTool ?? 'workspace_artifact_import',
        placement: 'below',
        margin: 56,
        dryRun: request.dryRun
      })
      if (result.ok) {
        inserted.push({ artifact, result })
        warnings.push(...result.warnings)
      } else {
        warnings.push(`Skipped ${artifact.relativePath}: ${result.message}`)
      }
    }

    return {
      ok: true,
      status: request.dryRun ? 'planned' : inserted.length > 0 ? 'imported' : 'empty',
      canvasId: paths.canvasId,
      canvasPath: paths.canvasPath,
      scanned: discovered.scanned,
      imported: inserted.length,
      skipped: Math.max(0, discovered.artifacts.length - inserted.length),
      artifacts: discovered.artifacts,
      inserted,
      warnings: [...new Set(warnings)],
      dryRun: Boolean(request.dryRun)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : message.includes('write') ? 'canvas_write_failed' : 'scan_failed',
      message,
      warnings
    }
  }
}

export async function exportSciforgeCanvasReviewPacket(
  request: SciforgeCanvasReviewPacketRequest
): Promise<SciforgeCanvasReviewPacketResult> {
  const warnings: string[] = []
  try {
    const paths = await resolveCanvasPaths(request.workspaceRoot, request.canvasId)
    if (await fileExists(paths.drawioPath)) {
      const xml = normalizeDrawioXml(await readFile(paths.drawioPath, 'utf8'))
      const selection = await readSelectionState(paths)
      const packet = buildDrawioReviewPacket({
        canvasId: paths.canvasId,
        title: request.title?.trim() || `SciForge Canvas Review ${paths.canvasId}`,
        xml,
        selection
      })
      const packetPath = request.packetId?.trim()
        ? join(paths.canvasDir, `${sanitizeId(request.packetId, 'review-packet')}.json`)
        : paths.packetPath
      await writeJsonAtomic(packetPath, packet)
      return {
        ok: true,
        status: 'created',
        canvasId: paths.canvasId,
        packetPath,
        packet,
        warnings
      }
    }
    const snapshot = await readCanvasSnapshot(paths)
    const selection = await readSelectionState(paths)
    const packet = buildReviewPacket({
      canvasId: paths.canvasId,
      title: request.title?.trim() || `SciForge Canvas Review ${paths.canvasId}`,
      snapshot,
      selection
    })
    const packetPath = request.packetId?.trim()
      ? join(paths.canvasDir, `${sanitizeId(request.packetId, 'review-packet')}.json`)
      : paths.packetPath
    await writeJsonAtomic(packetPath, packet)
    return {
      ok: true,
      status: 'created',
      canvasId: paths.canvasId,
      packetPath,
      packet,
      warnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      status: message.includes('workspace') ? 'invalid_workspace' : message.includes('snapshot') ? 'canvas_read_failed' : 'invalid_request',
      message,
      warnings
    }
  }
}

async function resolveCanvasPaths(workspaceRoot: string, canvasId?: string): Promise<CanvasPaths> {
  const resolvedWorkspace = await resolveWorkspaceRoot(workspaceRoot)
  const normalizedCanvasId = sanitizeId(canvasId, DEFAULT_CANVAS_ID)
  const canvasDir = join(resolvedWorkspace, CANVAS_ROOT_RELATIVE, normalizedCanvasId)
  return {
    workspaceRoot: resolvedWorkspace,
    canvasId: normalizedCanvasId,
    canvasDir,
    canvasPath: join(canvasDir, 'canvas.json'),
    drawioPath: join(canvasDir, 'canvas.drawio.xml'),
    assetsDir: join(canvasDir, 'assets'),
    selectionPath: join(canvasDir, 'selection.json'),
    packetPath: join(canvasDir, 'review-packet.json'),
    rendersDir: join(canvasDir, 'renders')
  }
}

async function resolveWorkspaceRoot(raw: string): Promise<string> {
  const workspaceRoot = await canonicalPath(resolve(raw))
  const info = await stat(workspaceRoot)
  if (!info.isDirectory()) throw new Error('workspaceRoot must be a directory.')
  return workspaceRoot
}

function sanitizeId(raw: string | undefined, fallback: string): string {
  const value = String(raw || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  if (!value || value === '.' || value === '..') return fallback
  return value
}

function isDrawioSnapshot(value: unknown): value is SciforgeCanvasDrawioSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SciforgeCanvasDrawioSnapshot>
  return record.engine === 'drawio' && typeof record.diagramXml === 'string'
}

function normalizeDrawioXml(value: string): string {
  const xml = value.trim()
  if (!xml) throw new Error('Expected draw.io XML.')
  if (!xml.includes('<mxfile') && !xml.includes('<mxGraphModel')) {
    throw new Error('Expected a draw.io mxfile or mxGraphModel document.')
  }
  return xml
}

function createInitialDrawioXml(canvasId: string): string {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="SciForge" modified="${escapeXmlAttribute(now)}" agent="SciForge Canvas" version="1.0">
  <diagram id="${escapeXmlAttribute(DEFAULT_DRAWIO_PAGE_ID)}" name="${escapeXmlAttribute(canvasId || DEFAULT_PAGE_NAME)}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
}

function createInitialCanvasSnapshot(): TldrawSnapshot {
  return {
    schema: structuredClone(EMPTY_TLDRAW_SCHEMA),
    store: {
      [DEFAULT_PAGE_ID]: {
        id: DEFAULT_PAGE_ID,
        typeName: 'page',
        name: DEFAULT_PAGE_NAME,
        index: DEFAULT_PAGE_INDEX,
        meta: {
          sciforgeCanvas: true
        }
      }
    }
  }
}

function normalizeSnapshot(value: unknown): TldrawSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Expected a tldraw snapshot object.')
  const snapshot = value as Partial<TldrawSnapshot>
  if (!snapshot.store || typeof snapshot.store !== 'object') throw new Error('Expected snapshot.store.')
  if (!snapshot.schema || typeof snapshot.schema !== 'object') throw new Error('Expected snapshot.schema.')
  const normalized = {
    store: snapshot.store as Record<string, JsonRecord>,
    schema: snapshot.schema as JsonRecord
  }
  sanitizeSnapshotSchemaForTldraw(normalized)
  sanitizeSnapshotForTldraw(normalized)
  return normalized
}

function sanitizeSnapshotSchemaForTldraw(snapshot: TldrawSnapshot): void {
  const schema = asRecord(snapshot.schema)
  const sequences = asRecord(schema?.sequences)
  if (!sequences) return

  if (sequences['com.tldraw.shape.note'] === 12) {
    sequences['com.tldraw.shape.note'] = CURRENT_TLDRAW_NOTE_SCHEMA_VERSION
  }
}

function sanitizeSnapshotForTldraw(snapshot: TldrawSnapshot): void {
  for (const record of Object.values(snapshot.store)) {
    if (record?.typeName !== 'shape' || record.type !== 'arrow') continue
    const props = asRecord(record.props)
    if (!props) continue

    const legacyText = typeof props.text === 'string' ? props.text.trim() : ''
    if (!props.richText && legacyText) {
      props.richText = richTextFromPlainText(legacyText)
    }
    delete props.text

    sanitizeArrowEndpoint(props.start)
    sanitizeArrowEndpoint(props.end)

    if (typeof props.elbowMidPoint !== 'number') {
      props.elbowMidPoint = 0.5
    }
  }
}

function sanitizeArrowEndpoint(value: unknown): void {
  const endpoint = asRecord(value)
  if (!endpoint) return
  delete endpoint.type
}

function richTextFromPlainText(text: string): JsonRecord {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'text',
        text
      }]
    }]
  }
}

async function ensureCanvasSnapshot(paths: CanvasPaths): Promise<TldrawSnapshot> {
  if (await fileExists(paths.canvasPath)) return readCanvasSnapshot(paths)
  const snapshot = createInitialCanvasSnapshot()
  await writeJsonAtomic(paths.canvasPath, snapshot)
  return snapshot
}

async function readCanvasSnapshot(paths: CanvasPaths): Promise<TldrawSnapshot> {
  const snapshot = normalizeSnapshot(JSON.parse(await readFile(paths.canvasPath, 'utf8')))
  ensurePageRecord(snapshot, findPageId(snapshot) ?? DEFAULT_PAGE_ID)
  return snapshot
}

async function shouldUseDrawioCanvas(paths: CanvasPaths): Promise<boolean> {
  if (process.env.SCIFORGE_CANVAS_ENGINE === 'tldraw') return false
  if (await fileExists(paths.drawioPath)) return true
  return true
}

async function ensureDrawioXml(paths: CanvasPaths): Promise<string> {
  if (await fileExists(paths.drawioPath)) {
    const xml = normalizeDrawioXml(await readFile(paths.drawioPath, 'utf8'))
    const hydrated = await hydrateDrawioImagePlaceholders(xml, paths.workspaceRoot)
    if (hydrated !== xml) {
      await writeTextAtomic(paths.drawioPath, hydrated)
    }
    return hydrated
  }
  const xml = createInitialDrawioXml(paths.canvasId)
  await mkdir(paths.canvasDir, { recursive: true })
  await writeTextAtomic(paths.drawioPath, xml)
  return xml
}

async function hydrateDrawioImagePlaceholders(xml: string, workspaceRoot: string): Promise<string> {
  const cellPattern = /<mxCell\b[^>]*\bsciforgeMeta="([^"]+)"[^>]*>[\s\S]*?<\/mxCell>/g
  let changed = false
  const replacements: Array<{ from: string; to: string }> = []
  let match: RegExpExecArray | null

  while ((match = cellPattern.exec(xml))) {
    const cellXml = match[0]
    const meta = decodeJsonAttribute(match[1])
    if (!meta?.sciforgeCanvasPlaceholder) continue
    const artifact = asRecord(meta.sciforgeArtifact)
    if (!artifact || !isImageArtifactKind(artifact.artifactKind)) continue
    const imagePath = await resolveHydratableDrawioImagePath(artifact, workspaceRoot)
    if (!imagePath) continue
    const imageDataUri = await readDrawioImageDataUri(imagePath)
    if (!imageDataUri) continue

    const hydratedMeta = {
      ...meta,
      sciforgeCanvasPlaceholder: false,
      sciforgeCanvasDrawioImageHydrated: true
    }
    let nextCellXml = replaceXmlAttribute(cellXml, 'style', drawioImageStyle(imageDataUri))
    nextCellXml = replaceXmlAttribute(nextCellXml, 'sciforgeMeta', encodeJsonAttribute(hydratedMeta))
    replacements.push({ from: cellXml, to: nextCellXml })
    changed = true
  }

  if (!changed) return xml
  let next = xml
  for (const replacement of replacements) {
    next = next.replace(replacement.from, replacement.to)
  }
  return next
}

function isImageArtifactKind(value: unknown): boolean {
  return value === 'generated_image'
    || value === 'edited_image'
    || value === 'scientific_plot'
    || value === 'ppt_slide'
}

async function resolveHydratableDrawioImagePath(artifact: JsonRecord, workspaceRoot: string): Promise<string | null> {
  const candidates = [
    artifact.previewPath,
    artifact.outputPath,
    artifact.sourcePath,
    artifact.renderedPagePath,
    artifact.svgPath
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  for (const candidate of candidates) {
    try {
      const resolved = await resolveTargetPathWithinWorkspace(candidate, workspaceRoot)
      const info = await stat(resolved)
      if (info.isFile()) return resolved
    } catch {
      // Try the next recorded artifact path.
    }
  }
  return null
}

async function readDrawioImageDataUri(filePath: string): Promise<string | null> {
  const info = await stat(filePath)
  if (!info.isFile() || info.size > DRAWIO_INLINE_IMAGE_MAX_BYTES) return null
  const mimeType = mimeTypeForExtension(extensionFromName(filePath))
  if (!mimeType) return null
  const bytes = await readFile(filePath)
  return drawioImageDataUri(mimeType, bytes)
}

function ensurePageRecord(snapshot: TldrawSnapshot, pageId: string): void {
  if (snapshot.store[pageId]?.typeName === 'page') return
  snapshot.store[pageId] = {
    id: pageId,
    typeName: 'page',
    name: DEFAULT_PAGE_NAME,
    index: DEFAULT_PAGE_INDEX,
    meta: {
      sciforgeCanvas: true
    }
  }
}

async function readSelectionState(paths: CanvasPaths): Promise<SciforgeCanvasSelectionState> {
  try {
    return normalizeSelection(JSON.parse(await readFile(paths.selectionPath, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { selectedShapes: [], updatedAt: null }
    }
    throw error
  }
}

function normalizeSelection(value: unknown): SciforgeCanvasSelectionState {
  if (!value || typeof value !== 'object') return { selectedShapes: [], updatedAt: null }
  const selectedShapes = Array.isArray((value as SciforgeCanvasSelectionState).selectedShapes)
    ? (value as SciforgeCanvasSelectionState).selectedShapes
    : []
  return {
    selectedShapes,
    updatedAt: typeof (value as SciforgeCanvasSelectionState).updatedAt === 'string'
      ? (value as SciforgeCanvasSelectionState).updatedAt
      : null
  }
}

async function buildArtifactMetadata(
  request: SciforgeCanvasInsertArtifactRequest,
  workspaceRoot: string,
  warnings: string[]
): Promise<SciforgeCanvasArtifactMetadata> {
  if (!SCIFORGE_CANVAS_ARTIFACT_KINDS.includes(request.artifactKind)) {
    throw new Error(`Unsupported artifactKind: ${request.artifactKind}`)
  }
  const sourcePath = await resolveOptionalPath(request.sourcePath, workspaceRoot)
  const outputPath = await resolveOptionalPath(request.outputPath, workspaceRoot)
  const previewPath = await resolveOptionalPath(request.previewPath, workspaceRoot)
  const renderedPagePath = await resolveOptionalPath(request.renderedPagePath, workspaceRoot)
  const renderedFromPptxPath = await resolveOptionalPath(request.renderedFromPptxPath, workspaceRoot)
  const manifestPath = await resolveOptionalPath(request.manifestPath, workspaceRoot)
  const styleSpecPath = await resolveOptionalPath(request.styleSpecPath, workspaceRoot)
  const diagramSpecPath = await resolveOptionalPath(request.diagramSpecPath, workspaceRoot)
  const frameworkDesignPlanPath = await resolveOptionalPath(request.frameworkDesignPlanPath, workspaceRoot)
  const diagramLayerManifestPath = await resolveOptionalPath(request.diagramLayerManifestPath, workspaceRoot)
  const fastSamSegmentationPath = await resolveOptionalPath(request.fastSamSegmentationPath, workspaceRoot)
  const fastSamBoxlibPath = await resolveOptionalPath(request.fastSamBoxlibPath, workspaceRoot)
  const fastSamPreviewPath = await resolveOptionalPath(request.fastSamPreviewPath, workspaceRoot)
  const frameworkComponentManifestPath = await resolveOptionalPath(request.frameworkComponentManifestPath, workspaceRoot)
  const componentBasePath = await resolveOptionalPath(request.componentBasePath, workspaceRoot)
  const componentAssetPaths = await resolveOptionalPaths(request.componentAssetPaths, workspaceRoot)
  const referencePath = await resolveOptionalPath(request.referencePath, workspaceRoot)
  const projectPath = await resolveOptionalExistingDirectory(request.projectPath, workspaceRoot)
  const svgPath = await resolveOptionalPath(request.svgPath, workspaceRoot)
  const pptxPath = await resolveOptionalPath(request.pptxPath, workspaceRoot)
  const reviewPacketPath = await resolveOptionalPath(request.reviewPacketPath, workspaceRoot)

  const artifact: SciforgeCanvasArtifactMetadata = {
    artifactKind: request.artifactKind,
    workspaceRoot,
    ...(sourcePath ? { sourcePath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(previewPath ? { previewPath } : {}),
    ...(renderedPagePath ? { renderedPagePath } : {}),
    ...(renderedFromPptxPath ? { renderedFromPptxPath } : {}),
    ...(request.renderedSlideIndex !== undefined ? { renderedSlideIndex: request.renderedSlideIndex } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(styleSpecPath ? { styleSpecPath } : {}),
    ...(diagramSpecPath ? { diagramSpecPath } : {}),
    ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
    ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
    ...(fastSamSegmentationPath ? { fastSamSegmentationPath } : {}),
    ...(fastSamBoxlibPath ? { fastSamBoxlibPath } : {}),
    ...(fastSamPreviewPath ? { fastSamPreviewPath } : {}),
    ...(frameworkComponentManifestPath ? { frameworkComponentManifestPath } : {}),
    ...(componentBasePath ? { componentBasePath } : {}),
    ...(componentAssetPaths.length ? { componentAssetPaths } : {}),
    ...(referencePath ? { referencePath } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(svgPath ? { svgPath } : {}),
    ...(pptxPath ? { pptxPath } : {}),
    ...(request.slideIndex !== undefined ? { slideIndex: request.slideIndex } : {}),
    ...(request.title?.trim() ? { title: request.title.trim() } : {}),
    ...(request.caption?.trim() ? { caption: request.caption.trim() } : {}),
    ...(request.sourceTool?.trim() ? { sourceTool: request.sourceTool.trim() } : {}),
    ...(request.reviewScore ? { reviewScore: request.reviewScore } : {}),
    ...(reviewPacketPath ? { reviewPacketPath } : {})
  }

  if (request.artifactKind === 'scientific_plot' && !artifact.outputPath && !artifact.sourcePath) {
    throw new Error('scientific_plot artifacts require outputPath or sourcePath.')
  }
  if (request.artifactKind === 'ppt_slide' && !artifact.svgPath && !artifact.sourcePath && !artifact.outputPath) {
    throw new Error('ppt_slide artifacts require svgPath, outputPath, or sourcePath.')
  }
  if (request.artifactKind === 'ppt_export' && !artifact.pptxPath && !artifact.sourcePath) {
    throw new Error('ppt_export artifacts require pptxPath or sourcePath.')
  }

  const displayPath = displayPathForArtifact(artifact)
  if (displayPath && !IMAGE_EXTENSIONS.has(extensionFromName(displayPath))) {
    if (request.artifactKind !== 'ppt_export') {
      throw new Error(`Canvas can display PNG/JPEG/WebP/SVG artifacts only in v1: ${displayPath}`)
    }
    warnings.push('ppt_export will be represented as a canvas placeholder unless a PNG/SVG preview can be produced.')
  }

  return artifact
}

async function resolveOptionalPath(raw: string | undefined, workspaceRoot: string): Promise<string | undefined> {
  if (!raw?.trim()) return undefined
  return resolveOpenTargetPath(raw, workspaceRoot, { allowBasenameFallback: false })
}

async function resolveOptionalPaths(raw: string[] | undefined, workspaceRoot: string): Promise<string[]> {
  if (!raw?.length) return []
  const resolved: string[] = []
  for (const item of raw) {
    const path = await resolveOptionalPath(item, workspaceRoot)
    if (path) resolved.push(path)
  }
  return resolved
}

async function resolveOptionalExistingDirectory(raw: string | undefined, workspaceRoot: string): Promise<string | undefined> {
  if (!raw?.trim()) return undefined
  const target = await resolveTargetPathWithinWorkspace(raw, workspaceRoot)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error('projectPath must be a directory.')
  return target
}

function displayPathForArtifact(artifact: SciforgeCanvasArtifactMetadata): string | undefined {
  if (artifact.artifactKind === 'ppt_export') {
    return imageDisplayPath(artifact.previewPath)
      ?? imageDisplayPath(artifact.renderedPagePath)
      ?? imageDisplayPath(artifact.svgPath)
      ?? imageDisplayPath(artifact.outputPath)
      ?? imageDisplayPath(artifact.sourcePath)
  }
  if (artifact.previewPath) return artifact.previewPath
  if (artifact.renderedPagePath) return artifact.renderedPagePath
  if (artifact.artifactKind === 'ppt_slide') return artifact.svgPath ?? artifact.outputPath ?? artifact.sourcePath
  if (artifact.artifactKind === 'scientific_plot') return artifact.outputPath ?? artifact.sourcePath
  if (
    artifact.artifactKind === 'image' ||
    artifact.artifactKind === 'generated_image' ||
    artifact.artifactKind === 'edited_image'
  ) {
    return artifact.outputPath ?? artifact.sourcePath
  }
  return artifact.outputPath ?? artifact.sourcePath
}

function imageDisplayPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  return IMAGE_EXTENSIONS.has(extensionFromName(path)) ? path : undefined
}

async function prepareCanvasArtifactPreview(input: {
  artifact: SciforgeCanvasArtifactMetadata
  request: SciforgeCanvasInsertArtifactRequest
  paths: CanvasPaths
  warnings: string[]
}): Promise<SciforgeCanvasArtifactMetadata> {
  if (input.artifact.artifactKind !== 'ppt_export') return input.artifact
  if (!input.artifact.pptxPath) return input.artifact
  if (displayPathForArtifact(input.artifact)) return input.artifact

  const svgPreview = await findPptMasterSvgPreview(input)
  if (svgPreview) {
    input.warnings.push(`ppt_export slide ${svgPreview.pageNumber} using ppt-master SVG preview for canvas review.`)
    return {
      ...input.artifact,
      previewPath: svgPreview.svgPath,
      renderedPagePath: svgPreview.svgPath,
      renderedFromPptxPath: input.artifact.pptxPath,
      renderedSlideIndex: svgPreview.slideIndex
    }
  }

  if (process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER === '1') {
    input.warnings.push('ppt_export will be represented as a canvas placeholder because PPTX preview rendering is disabled.')
    return input.artifact
  }

  try {
    const preview = await renderPptxSlidePreview({
      pptxPath: input.artifact.pptxPath,
      slideIndex: slideIndexForPptArtifact(input.artifact, input.request),
      paths: input.paths
    })
    input.warnings.push(`ppt_export slide ${preview.pageNumber} rendered to PNG preview for canvas review.`)
    return {
      ...input.artifact,
      previewPath: preview.pngPath,
      renderedPagePath: preview.pngPath,
      renderedFromPptxPath: input.artifact.pptxPath,
      renderedSlideIndex: preview.slideIndex
    }
  } catch (error) {
    input.warnings.push(`ppt_export preview rendering unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return input.artifact
  }
}

type PptMasterSvgPreview = {
  svgPath: string
  slideIndex: number
  pageNumber: number
}

async function findPptMasterSvgPreview(input: {
  artifact: SciforgeCanvasArtifactMetadata
  request: SciforgeCanvasInsertArtifactRequest
  paths: CanvasPaths
}): Promise<PptMasterSvgPreview | null> {
  const slideIndex = slideIndexForPptArtifact(input.artifact, input.request)
  const pageNumber = slideIndex + 1
  const pageFileName = `page_${String(pageNumber).padStart(2, '0')}.svg`
  const projectPaths = await collectPptProjectPathCandidates(input.artifact, input.paths.workspaceRoot)

  for (const projectPath of projectPaths) {
    for (const relativePath of [join('svg_final', pageFileName), join('svg_output', pageFileName)]) {
      const svgPath = join(projectPath, relativePath)
      try {
        const info = await stat(svgPath)
        if (info.isFile()) return { svgPath, slideIndex, pageNumber }
      } catch {
        // Try the next ppt-master export location.
      }
    }
  }
  return null
}

function slideIndexForPptArtifact(
  artifact: SciforgeCanvasArtifactMetadata,
  request: SciforgeCanvasInsertArtifactRequest
): number {
  return Math.max(0, Math.floor(request.slideIndex ?? artifact.slideIndex ?? 0))
}

async function collectPptProjectPathCandidates(
  artifact: SciforgeCanvasArtifactMetadata,
  workspaceRoot: string
): Promise<string[]> {
  const rawCandidates: string[] = []
  if (artifact.projectPath) rawCandidates.push(artifact.projectPath)
  if (artifact.manifestPath) {
    rawCandidates.push(...await readPptProjectCandidatesFromManifest(artifact.manifestPath, workspaceRoot))
  }
  if (artifact.pptxPath) {
    rawCandidates.push(dirname(artifact.pptxPath))
    if (basename(dirname(artifact.pptxPath)) === 'exports') rawCandidates.push(dirname(dirname(artifact.pptxPath)))
  }

  const resolved: string[] = []
  const seen = new Set<string>()
  for (const candidate of rawCandidates) {
    const projectPath = await resolveExistingPptProjectPath(candidate, workspaceRoot)
    if (!projectPath || seen.has(projectPath)) continue
    seen.add(projectPath)
    resolved.push(projectPath)
  }
  return resolved
}

async function readPptProjectCandidatesFromManifest(
  manifestPath: string,
  workspaceRoot: string
): Promise<string[]> {
  try {
    const resolvedManifestPath = await resolveOpenTargetPath(manifestPath, workspaceRoot, { allowBasenameFallback: false })
    const parsed = JSON.parse(await readFile(resolvedManifestPath, 'utf8')) as unknown
    const manifest = parseSciforgeArtifactManifest(parsed)
    const record = asRecord(parsed)
    const candidates: string[] = []
    if (manifest?.projectPath) candidates.push(manifest.projectPath)
    if (typeof record?.projectPath === 'string') candidates.push(record.projectPath)
    if (typeof record?.pptxPath === 'string') {
      candidates.push(dirname(record.pptxPath))
      if (basename(dirname(record.pptxPath)) === 'exports') candidates.push(dirname(dirname(record.pptxPath)))
    }
    if (typeof record?.path === 'string') {
      candidates.push(dirname(record.path))
      if (basename(dirname(record.path)) === 'exports') candidates.push(dirname(dirname(record.path)))
    }
    return candidates
  } catch {
    return []
  }
}

async function resolveExistingPptProjectPath(rawPath: string, workspaceRoot: string): Promise<string | null> {
  if (!rawPath.trim()) return null
  try {
    const resolvedPath = await resolveTargetPathWithinWorkspace(rawPath, workspaceRoot)
    const info = await stat(resolvedPath)
    return info.isDirectory() ? resolvedPath : null
  } catch {
    return null
  }
}

function buildShapeMeta(
  request: SciforgeCanvasInsertArtifactRequest,
  artifact: SciforgeCanvasArtifactMetadata
): JsonRecord {
  const meta: JsonRecord = {
    ...(request.shapeMeta ?? {}),
    sciforgeCanvasArtifact: true,
    sciforgeCanvasArtifactVersion: 1,
    artifactKind: artifact.artifactKind,
    sciforgeArtifact: artifact
  }
  if (request.anchorShapeId && !meta.cowartAnnotationSourceShapeId) {
    meta.cowartAnnotationSourceShapeId = request.anchorShapeId
  }
  if (request.annotationScreenshot?.trim() && !meta.cowartAnnotationScreenshot) {
    meta.cowartAnnotationScreenshot = request.annotationScreenshot.trim()
  }
  if (request.annotationScreenshot?.trim()) {
    meta.cowartGeneratedFromAnnotationEdit = true
  }
  return meta
}

async function insertDrawioArtifact(input: {
  paths: CanvasPaths
  artifact: SciforgeCanvasArtifactMetadata
  request: SciforgeCanvasInsertArtifactRequest
  warnings: string[]
}): Promise<Extract<SciforgeCanvasInsertArtifactResult, { ok: true }>> {
  const xml = await ensureDrawioXml(input.paths)
  if (input.artifact.diagramLayerManifestPath && input.request.insertionMode === 'editable_layers') {
    return insertDrawioDiagramLayers({
      ...input,
      xml
    })
  }
  if (input.artifact.diagramLayerManifestPath && input.request.insertionMode !== 'editable_layers') {
    input.warnings.push('Framework/diagram sidecar metadata was preserved; inserted as a single visual image. Use sciforge_canvas_split_artifact_components to expand component cells.')
  }
  const sourcePath = displayPathForArtifact(input.artifact)
  const isPlaceholder = input.artifact.pptxPath && input.request.artifactKind === 'ppt_export' && !sourcePath
  let sourceStat: Awaited<ReturnType<typeof stat>> | null = null
  let assetFile: string | undefined
  let imageSize: ImageDimensions = {
    width: finiteNumber(input.request.displayWidth, isPlaceholder ? PLACEHOLDER_WIDTH : DEFAULT_IMAGE_WIDTH),
    height: finiteNumber(input.request.displayHeight, isPlaceholder ? PLACEHOLDER_HEIGHT : Math.round(DEFAULT_IMAGE_WIDTH * 0.65))
  }
  let imageDataUri: string | null = null
  let mimeType: string | undefined

  if (!isPlaceholder) {
    if (!sourcePath) throw new Error('No displayable artifact path was provided.')
    sourceStat = await stat(sourcePath)
    if (!sourceStat.isFile()) throw new Error(`Artifact path is not a file: ${sourcePath}`)
    if (sourceStat.size > MAX_IMAGE_BYTES) throw new Error(`Artifact is too large for canvas insertion: ${sourcePath}`)
    const ext = extensionFromName(sourcePath)
    mimeType = mimeTypeForExtension(ext) ?? undefined
    if (!mimeType) throw new Error(`Unsupported image artifact extension: ${ext}`)
    const bytes = await readFile(sourcePath)
    imageSize = readImageDimensions(sourcePath, bytes)
    if (sourceStat.size <= DRAWIO_INLINE_IMAGE_MAX_BYTES) {
      imageDataUri = drawioImageDataUri(mimeType, bytes)
    } else {
      input.warnings.push('Artifact is too large to inline in draw.io XML; inserted as a metadata placeholder.')
    }
    const unique = await uniqueFilePath(input.paths.assetsDir, input.request.fileName || basename(sourcePath))
    assetFile = unique.filePath
    if (!input.request.dryRun) {
      await mkdir(input.paths.assetsDir, { recursive: true })
      await copyFile(sourcePath, assetFile)
    }
  }

  const width = finiteNumber(
    input.request.displayWidth,
    Math.min(imageSize.width, isPlaceholder ? PLACEHOLDER_WIDTH : DEFAULT_IMAGE_WIDTH)
  )
  const height = finiteNumber(
    input.request.displayHeight,
    isPlaceholder ? PLACEHOLDER_HEIGHT : Math.round(width * (imageSize.height / Math.max(1, imageSize.width)))
  )
  const bounds = chooseDrawioPlacement(xml, width, height, Math.max(0, finiteNumber(input.request.margin, 64)))
  const shapeId = uniqueDrawioCellId(xml, input.artifact.title || input.request.fileName || 'artifact')
  const artifact = {
    ...input.artifact,
    ...(assetFile ? { previewPath: input.artifact.previewPath ?? assetFile } : {})
  }
  const meta = buildShapeMeta(input.request, artifact)
  const title = input.artifact.title || input.request.fileName || basename(sourcePath || input.artifact.pptxPath || 'SciForge artifact')
  const cellXml = imageDataUri
    ? createDrawioImageCell({
      id: shapeId,
      title,
      imageDataUri,
      bounds,
      meta
    })
    : createDrawioPlaceholderCell({
      id: shapeId,
      title,
      subtitle: isPlaceholder
        ? 'PPTX export preview unavailable'
        : sourcePath
          ? basename(sourcePath)
          : 'SciForge artifact',
      bounds,
      meta
    })

  if (!input.request.dryRun) {
    await writeTextAtomic(input.paths.drawioPath, insertDrawioCellXml(xml, cellXml))
  }

  return {
    ok: true,
    status: 'inserted',
    canvasId: input.paths.canvasId,
    canvasDir: input.paths.canvasDir,
    canvasPath: input.paths.canvasPath,
    assetFile,
    assetId: assetFile ? `asset:${basename(assetFile)}` : undefined,
    shapeId,
    pageId: DEFAULT_DRAWIO_PAGE_ID,
    parentId: '1',
    bounds,
    artifact,
    warnings: input.warnings,
    dryRun: Boolean(input.request.dryRun)
  }
}

async function insertDrawioDiagramLayers(input: {
  paths: CanvasPaths
  artifact: SciforgeCanvasArtifactMetadata
  request: SciforgeCanvasInsertArtifactRequest
  warnings: string[]
  xml: string
}): Promise<Extract<SciforgeCanvasInsertArtifactResult, { ok: true }>> {
  if (!input.artifact.diagramLayerManifestPath) throw new Error('diagramLayerManifestPath is required.')
  const manifest = parseDiagramLayerManifest(JSON.parse(await readFile(input.artifact.diagramLayerManifestPath, 'utf8')) as unknown)
  const sourcePath = displayPathForArtifact(input.artifact)
  const manifestWidth = Math.max(1, manifest.canvas.width)
  const manifestHeight = Math.max(1, manifest.canvas.height)
  const requestedWidth = finiteNumber(input.request.displayWidth, Math.min(manifestWidth, DEFAULT_IMAGE_WIDTH))
  const requestedHeight = finiteNumber(input.request.displayHeight, Math.round(requestedWidth * manifestHeight / manifestWidth))
  const bounds = chooseDrawioPlacement(input.xml, requestedWidth, requestedHeight, Math.max(0, finiteNumber(input.request.margin, 64)))
  const scaleX = bounds.w / manifestWidth
  const scaleY = bounds.h / manifestHeight
  const metaBase = buildShapeMeta(input.request, input.artifact)
  const usedXmlParts: string[] = []
  const layerIdMap = new Map<string, string>()
  const sortedLayers = [...manifest.layers].sort((a, b) => finiteNumber(a.zIndex, 0) - finiteNumber(b.zIndex, 0))

  for (const layer of sortedLayers) {
    if (layer.type === 'edge') continue
    const layerBounds = scaledLayerBounds(layer.bbox, bounds, scaleX, scaleY)
    if (!layerBounds) continue
    const cellId = uniqueDrawioCellId(input.xml + usedXmlParts.join('\n'), layer.id || 'diagram-layer')
    layerIdMap.set(layer.id, cellId)
    const layerMeta = {
      ...metaBase,
      sciforgeDiagramLayer: true,
      sciforgeDiagramLayerId: layer.id,
      sciforgeDiagramLayerType: layer.type,
      sciforgeDiagramLayerEditable: layer.editable !== false,
      sciforgeDiagramLayerManifestPath: input.artifact.diagramLayerManifestPath
    }
    const assetPath = await resolveDiagramLayerAsset(layer, input.paths.workspaceRoot, sourcePath)
    if (layer.type === 'image' && assetPath) {
      const imageCell = await createDrawioImageCellFromFile({
        id: cellId,
        title: layer.label || input.artifact.title || 'Diagram preview',
        path: assetPath,
        bounds: layerBounds,
        meta: layerMeta,
        warnings: input.warnings
      })
      usedXmlParts.push(imageCell)
      continue
    }
    usedXmlParts.push(createDrawioDiagramVertexCell({
      id: cellId,
      layer,
      bounds: layerBounds,
      meta: layerMeta
    }))
  }

  for (const layer of sortedLayers.filter((item) => item.type === 'edge')) {
    const source = layer.from ? layerIdMap.get(layer.from) : undefined
    const target = layer.to ? layerIdMap.get(layer.to) : undefined
    if (!source || !target) continue
    const cellId = uniqueDrawioCellId(input.xml + usedXmlParts.join('\n'), layer.id || 'diagram-edge')
    usedXmlParts.push(createDrawioEdgeCell({
      id: cellId,
      value: layer.label || '',
      source,
      target,
      meta: {
        ...metaBase,
        sciforgeDiagramLayer: true,
        sciforgeDiagramLayerId: layer.id,
        sciforgeDiagramLayerType: layer.type,
        sciforgeDiagramLayerEditable: layer.editable !== false,
        sciforgeDiagramLayerManifestPath: input.artifact.diagramLayerManifestPath
      }
    }))
  }

  if (!input.request.dryRun && usedXmlParts.length) {
    await writeTextAtomic(input.paths.drawioPath, insertDrawioCellXml(input.xml, usedXmlParts.join('\n')))
  }

  const shapeId = usedXmlParts.length ? [...layerIdMap.values()][0] ?? uniqueDrawioCellId(input.xml, 'diagram') : uniqueDrawioCellId(input.xml, 'diagram')
  return {
    ok: true,
    status: 'inserted',
    canvasId: input.paths.canvasId,
    canvasDir: input.paths.canvasDir,
    canvasPath: input.paths.canvasPath,
    shapeId,
    pageId: DEFAULT_DRAWIO_PAGE_ID,
    parentId: '1',
    bounds,
    artifact: input.artifact,
    warnings: input.warnings,
    dryRun: Boolean(input.request.dryRun)
  }
}

async function insertImageArtifact(input: {
  snapshot: TldrawSnapshot
  paths: CanvasPaths
  artifact: SciforgeCanvasArtifactMetadata
  request: SciforgeCanvasInsertArtifactRequest
  pageId: string
  parentId: string
  anchorShape: JsonRecord | null
  shapeMeta: JsonRecord
  warnings: string[]
}): Promise<Extract<SciforgeCanvasInsertArtifactResult, { ok: true }>> {
  const sourcePath = displayPathForArtifact(input.artifact)
  if (!sourcePath) throw new Error('No displayable artifact path was provided.')
  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile()) throw new Error(`Artifact path is not a file: ${sourcePath}`)
  if (sourceStat.size > MAX_IMAGE_BYTES) throw new Error(`Artifact is too large for canvas insertion: ${sourcePath}`)

  const ext = extensionFromName(sourcePath)
  const mimeType = mimeTypeForExtension(ext)
  if (!mimeType) throw new Error(`Unsupported image artifact extension: ${ext}`)
  const bytes = await readFile(sourcePath)
  const imageSize = readImageDimensions(sourcePath, bytes)
  const anchorBounds = input.anchorShape ? pageBoundsForShape(input.snapshot.store, input.anchorShape) : null
  const matchAnchor = input.request.matchAnchor !== false && anchorBounds
  const width = finiteNumber(input.request.displayWidth, matchAnchor ? anchorBounds.w : Math.min(imageSize.width, DEFAULT_IMAGE_WIDTH))
  const height = finiteNumber(
    input.request.displayHeight,
    matchAnchor ? anchorBounds.h : Math.round(width * (imageSize.height / imageSize.width))
  )
  const bounds = choosePlacement({
    store: input.snapshot.store,
    pageId: input.pageId,
    parentId: input.parentId,
    anchorShape: input.anchorShape,
    width,
    height,
    margin: Math.max(0, finiteNumber(input.request.margin, 40)),
    placement: input.request.placement ?? 'right'
  })

  const { fileName, filePath } = await uniqueFilePath(input.paths.assetsDir, input.request.fileName || basename(sourcePath))
  const assetId = uniqueRecordId(input.snapshot.store, 'asset', fileName)
  const shapeId = uniqueRecordId(input.snapshot.store, 'shape', fileName)
  const index = chooseIndex(input.snapshot.store, input.parentId)
  const assetMeta = {
    ...(input.request.assetMeta ?? {}),
    sciforgeCanvasAssetFile: filePath,
    sciforgeCanvasSourcePath: sourcePath
  }

  input.snapshot.store[assetId] = {
    id: assetId,
    typeName: 'asset',
    type: 'image',
    props: {
      name: fileName,
      src: '',
      w: imageSize.width,
      h: imageSize.height,
      fileSize: sourceStat.size,
      mimeType,
      isAnimated: false
    },
    meta: assetMeta
  }
  input.snapshot.store[shapeId] = {
    id: shapeId,
    typeName: 'shape',
    type: 'image',
    parentId: input.parentId,
    index,
    x: bounds.x,
    y: bounds.y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: input.shapeMeta,
    props: {
      w: bounds.w,
      h: bounds.h,
      assetId,
      playing: true,
      url: '',
      crop: null,
      flipX: false,
      flipY: false,
      altText: input.request.altText?.trim() || input.artifact.title || 'SciForge canvas artifact'
    }
  }

  if (!input.request.dryRun) {
    await mkdir(input.paths.assetsDir, { recursive: true })
    await copyFile(sourcePath, filePath)
  }

  return {
    ok: true,
    status: 'inserted',
    canvasId: input.paths.canvasId,
    canvasDir: input.paths.canvasDir,
    canvasPath: input.paths.canvasPath,
    assetFile: filePath,
    assetId,
    shapeId,
    pageId: input.pageId,
    parentId: input.parentId,
    bounds,
    artifact: input.artifact,
    warnings: input.warnings,
    dryRun: Boolean(input.request.dryRun)
  }
}

function insertPlaceholderArtifact(input: {
  snapshot: TldrawSnapshot
  paths: CanvasPaths
  artifact: SciforgeCanvasArtifactMetadata
  request: SciforgeCanvasInsertArtifactRequest
  pageId: string
  parentId: string
  anchorShape: JsonRecord | null
  shapeMeta: JsonRecord
}): Extract<SciforgeCanvasInsertArtifactResult, { ok: true }> {
  const width = finiteNumber(input.request.displayWidth, PLACEHOLDER_WIDTH)
  const height = finiteNumber(input.request.displayHeight, PLACEHOLDER_HEIGHT)
  const bounds = choosePlacement({
    store: input.snapshot.store,
    pageId: input.pageId,
    parentId: input.parentId,
    anchorShape: input.anchorShape,
    width,
    height,
    margin: Math.max(0, finiteNumber(input.request.margin, 40)),
    placement: input.request.placement ?? 'right'
  })
  const shapeId = uniqueRecordId(input.snapshot.store, 'shape', input.artifact.title || 'ppt-export')
  input.snapshot.store[shapeId] = {
    id: shapeId,
    typeName: 'shape',
    type: 'frame',
    parentId: input.parentId,
    index: chooseIndex(input.snapshot.store, input.parentId),
    x: bounds.x,
    y: bounds.y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {
      ...input.shapeMeta,
      sciforgeCanvasPlaceholder: true
    },
    props: {
      w: bounds.w,
      h: bounds.h,
      name: input.artifact.title || 'PPTX export',
      color: 'violet'
    }
  }
  return {
    ok: true,
    status: 'inserted',
    canvasId: input.paths.canvasId,
    canvasDir: input.paths.canvasDir,
    canvasPath: input.paths.canvasPath,
    shapeId,
    pageId: input.pageId,
    parentId: input.parentId,
    bounds,
    artifact: input.artifact,
    warnings: ['ppt_export is represented as a canvas placeholder because no PPTX page preview is available.'],
    dryRun: Boolean(input.request.dryRun)
  }
}

function createDrawioImageCell(input: {
  id: string
  title: string
  imageDataUri: string
  bounds: SciforgeCanvasBounds
  meta: JsonRecord
}): string {
  return createDrawioVertexCell({
    id: input.id,
    value: input.title,
    style: drawioImageStyle(input.imageDataUri),
    bounds: input.bounds,
    meta: input.meta
  })
}

function drawioImageDataUri(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType},${bytes.toString('base64')}`
}

function drawioImageStyle(imageDataUri: string): string {
  return [
    'shape=image',
    `image=${imageDataUri}`,
    'imageAspect=1',
    'aspect=fixed',
    'verticalLabelPosition=bottom',
    'verticalAlign=top',
    'fillColor=none',
    'strokeColor=none',
    'html=1'
  ].join(';')
}


function parseFrameworkComponentManifest(value: unknown): FrameworkComponentManifest {
  const record = asRecord(value)
  if (!record || record.kind !== 'sciforge_framework_components' || record.version !== 1) {
    throw new Error('Invalid framework component manifest.')
  }
  const canvasSize = asRecord(record.canvasSize)
  if (!canvasSize) throw new Error('Framework component manifest is missing canvasSize.')
  const width = finiteNumber(canvasSize.width, 0)
  const height = finiteNumber(canvasSize.height, 0)
  const components = Array.isArray(record.components) ? record.components.map(parseFrameworkComponentLayer).filter((item): item is FrameworkComponentLayer => item !== null) : []
  const blocks = Array.isArray(record.blocks) ? record.blocks.map(parseFrameworkComponentBlock).filter((item): item is FrameworkComponentBlock => item !== null) : []
  const componentById = new Map(components.map((component) => [component.componentId, component]))
  for (const block of blocks) {
    for (const componentId of block.childComponentIds) {
      const component = componentById.get(componentId)
      if (component && !component.parentBlockId) component.parentBlockId = block.blockId
    }
  }
  const semanticLayerImages = Array.isArray(record.semanticLayerImages)
    ? record.semanticLayerImages.map(parseFrameworkSemanticLayerImage).filter((item): item is NonNullable<FrameworkComponentManifest['semanticLayerImages']>[number] => item !== null)
    : []
  if (!width || !height || typeof record.componentBasePath !== 'string') throw new Error('Framework component manifest is missing canvasSize or componentBasePath.')
  return {
    version: 1,
    kind: 'sciforge_framework_components',
    sourceImagePath: typeof record.sourceImagePath === 'string' ? record.sourceImagePath : '',
    componentBasePath: record.componentBasePath,
    componentDir: typeof record.componentDir === 'string' ? record.componentDir : dirname(record.componentBasePath),
    canvasSize: { width, height },
    ...(blocks.length ? { blocks } : {}),
    components,
    ...(semanticLayerImages.length ? { semanticLayerImages } : {}),
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : []
  }
}

function parseFrameworkComponentBlock(value: unknown): FrameworkComponentBlock | null {
  const record = asRecord(value)
  if (!record) return null
  const blockId = typeof record.blockId === 'string' && record.blockId.trim() ? record.blockId.trim() : undefined
  const bboxRecord = asRecord(record.pixelBbox)
  const rawChildComponentIds = Array.isArray(record.childComponentIds)
    ? record.childComponentIds
    : Array.isArray(record.componentIds)
      ? record.componentIds
      : []
  const childComponentIds = rawChildComponentIds.map(String).filter(Boolean)
  if (!blockId || !bboxRecord || !childComponentIds.length) return null
  const pixelBbox = {
    x: finiteNumber(bboxRecord.x, 0),
    y: finiteNumber(bboxRecord.y, 0),
    w: finiteNumber(bboxRecord.w, 0),
    h: finiteNumber(bboxRecord.h, 0)
  }
  if (pixelBbox.w <= 0 || pixelBbox.h <= 0) return null
  return {
    blockId,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.blockType === 'string' ? { blockType: record.blockType } : {}),
    pixelBbox,
    childComponentIds,
    ...(Array.isArray(record.semanticLayers) ? { semanticLayers: record.semanticLayers.map(String).filter(Boolean) } : {}),
    ...(Array.isArray(record.detectionMethods) ? { detectionMethods: record.detectionMethods.map(String).filter(Boolean) } : {}),
    ...(Number.isFinite(Number(record.confidence)) ? { confidence: Number(record.confidence) } : {})
  }
}

function parseFrameworkSemanticLayerImage(value: unknown): NonNullable<FrameworkComponentManifest['semanticLayerImages']>[number] | null {
  const record = asRecord(value)
  if (!record || typeof record.semanticLayer !== 'string' || typeof record.assetPath !== 'string' || typeof record.previewPath !== 'string') return null
  return {
    semanticLayer: record.semanticLayer,
    assetPath: record.assetPath,
    previewPath: record.previewPath,
    pixelCount: finiteNumber(record.pixelCount, 0),
    coverage: finiteNumber(record.coverage, 0),
    ...(typeof record.detectionMethod === 'string' ? { detectionMethod: record.detectionMethod } : {})
  }
}

function parseFrameworkComponentLayer(value: unknown): FrameworkComponentLayer | null {
  const record = asRecord(value)
  if (!record) return null
  const componentId = typeof record.componentId === 'string' && record.componentId.trim() ? record.componentId.trim() : undefined
  const bboxRecord = asRecord(record.pixelBbox)
  if (!componentId || !bboxRecord) return null
  const pixelBbox = {
    x: finiteNumber(bboxRecord.x, 0),
    y: finiteNumber(bboxRecord.y, 0),
    w: finiteNumber(bboxRecord.w, 0),
    h: finiteNumber(bboxRecord.h, 0)
  }
  if (pixelBbox.w <= 0 || pixelBbox.h <= 0) return null
  return {
    componentId,
    ...(typeof record.layerId === 'string' ? { layerId: record.layerId } : {}),
    type: typeof record.type === 'string' ? record.type : 'visual_component',
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    pixelBbox,
    ...(typeof record.assetPath === 'string' ? { assetPath: record.assetPath } : {}),
    ...(typeof record.transparentAssetPath === 'string' ? { transparentAssetPath: record.transparentAssetPath } : {}),
    ...(typeof record.semanticLayer === 'string' ? { semanticLayer: record.semanticLayer } : {}),
    ...(typeof record.parentComponentId === 'string' ? { parentComponentId: record.parentComponentId } : {}),
    ...(typeof record.parentBlockId === 'string' ? { parentBlockId: record.parentBlockId } : {}),
    ...(Array.isArray(record.children) ? { children: record.children.map(String).filter(Boolean) } : {}),
    ...(typeof record.detectionMethod === 'string' ? { detectionMethod: record.detectionMethod } : {}),
    ...(typeof record.reusableTemplateId === 'string' ? { reusableTemplateId: record.reusableTemplateId } : {}),
    ...(typeof record.placeholderId === 'string' ? { placeholderId: record.placeholderId } : {}),
    ...(typeof record.sourcePrompt === 'string' ? { sourcePrompt: record.sourcePrompt } : {}),
    ...(Number.isFinite(Number(record.confidence)) ? { confidence: Number(record.confidence) } : {})
  }
}

async function resolveComponentAssetPath(rawPath: string, workspaceRoot: string): Promise<string> {
  if (!rawPath.trim()) throw new Error('Component asset path is missing.')
  return resolveOpenTargetPath(rawPath, workspaceRoot, { allowBasenameFallback: false })
}

function enrichDrawioSelectionShapes(cells: DrawioCellRecord[], selectedShapes: SciforgeCanvasSelectionState['selectedShapes']): SciforgeCanvasSelectionState['selectedShapes'] {
  const byId = new Map(cells.map((cell) => [cell.id, cell]))
  return selectedShapes.map((shape) => {
    const cell = byId.get(shape.id)
    if (!cell) return shape
    return {
      ...shape,
      type: shape.type ?? (cell.edge ? 'edge' : cell.vertex ? 'vertex' : undefined),
      meta: {
        ...(cell.meta ?? {}),
        ...(shape.meta ?? {})
      },
      bounds: shape.bounds ?? cell.bounds ?? null
    }
  })
}

function selectedFrameworkComponentsFromShapes(selectedShapes: SciforgeCanvasSelectionState['selectedShapes']): NonNullable<SciforgeCanvasReviewPacket['selectedComponents']> {
  const selected: NonNullable<SciforgeCanvasReviewPacket['selectedComponents']> = []
  for (const shape of selectedShapes) {
    const meta = asRecord(shape.meta)
    if (!meta) continue
    const componentId = typeof meta.componentId === 'string'
      ? meta.componentId
      : typeof meta.sciforgeFrameworkComponentId === 'string'
        ? meta.sciforgeFrameworkComponentId
        : undefined
    const blockId = typeof meta.blockId === 'string'
      ? meta.blockId
      : typeof meta.parentBlockId === 'string'
        ? meta.parentBlockId
        : undefined
    const manifestPath = typeof meta.frameworkComponentManifestPath === 'string'
      ? meta.frameworkComponentManifestPath
      : typeof meta.sciforgeFrameworkComponentManifestPath === 'string'
        ? meta.sciforgeFrameworkComponentManifestPath
        : undefined
    if ((!componentId && !blockId) || !manifestPath) continue
    selected.push({
      shapeId: shape.id,
      ...(componentId ? { componentId } : {}),
      frameworkComponentManifestPath: manifestPath,
      ...(blockId ? { blockId } : {}),
      ...(typeof meta.semanticLayer === 'string' ? { semanticLayer: meta.semanticLayer } : {}),
      ...(typeof meta.parentBlockId === 'string' ? { parentBlockId: meta.parentBlockId } : blockId ? { parentBlockId: blockId } : {}),
      ...(typeof meta.parentBlockTitle === 'string' ? { parentBlockTitle: meta.parentBlockTitle } : {}),
      ...(typeof meta.parentBlockType === 'string' ? { parentBlockType: meta.parentBlockType } : {}),
      ...(Array.isArray(meta.childComponentIds)
        ? { childComponentIds: meta.childComponentIds.map(String).filter(Boolean) }
        : Array.isArray(meta.parentBlockChildComponentIds)
          ? { childComponentIds: meta.parentBlockChildComponentIds.map(String).filter(Boolean) }
          : {}),
      ...(typeof meta.detectionMethod === 'string' ? { detectionMethod: meta.detectionMethod } : {}),
      ...(typeof meta.reusableTemplateId === 'string' ? { reusableTemplateId: meta.reusableTemplateId } : {})
    })
  }
  return selected
}


function parseDiagramLayerManifest(value: unknown): DiagramLayerManifest {
  const record = asRecord(value)
  const canvas = asRecord(record?.canvas)
  const layers = Array.isArray(record?.layers) ? record.layers : []
  if (record?.kind !== 'sciforge_diagram_layers' || record.version !== 1 || !canvas) {
    throw new Error('Invalid diagram layer manifest.')
  }
  const width = finiteNumber(canvas.width, 0)
  const height = finiteNumber(canvas.height, 0)
  if (width <= 0 || height <= 0) throw new Error('Diagram layer manifest is missing canvas size.')
  return {
    version: 1,
    kind: 'sciforge_diagram_layers',
    canvas: {
      width,
      height,
      ...(typeof canvas.background === 'string' ? { background: canvas.background } : {}),
      ...(typeof canvas.layout === 'string' ? { layout: canvas.layout } : {})
    },
    layers: layers
      .map((item): DiagramLayer | null => {
        const layer = asRecord(item)
        if (!layer) return null
        const id = typeof layer.id === 'string' && layer.id.trim() ? layer.id.trim() : undefined
        const type = typeof layer.type === 'string' && layer.type.trim() ? layer.type.trim() : undefined
        if (!id || !type) return null
        const bboxRecord = asRecord(layer.bbox)
        const bbox = bboxRecord
          ? {
            x: finiteNumber(bboxRecord.x, 0),
            y: finiteNumber(bboxRecord.y, 0),
            w: finiteNumber(bboxRecord.w, 0),
            h: finiteNumber(bboxRecord.h, 0)
          }
          : undefined
        const style = asRecord(layer.style)
        return {
          id,
          type,
          ...(typeof layer.label === 'string' ? { label: layer.label } : {}),
          ...(bbox && bbox.w > 0 && bbox.h > 0 ? { bbox } : {}),
          ...(Number.isFinite(Number(layer.zIndex)) ? { zIndex: Number(layer.zIndex) } : {}),
          ...(style ? { style: normalizeDiagramLayerStyle(style) } : {}),
          ...(typeof layer.assetPath === 'string' ? { assetPath: layer.assetPath } : {}),
          ...(typeof layer.editable === 'boolean' ? { editable: layer.editable } : {}),
          ...(typeof layer.origin === 'string' ? { origin: layer.origin } : {}),
          ...(typeof layer.from === 'string' ? { from: layer.from } : {}),
          ...(typeof layer.to === 'string' ? { to: layer.to } : {})
        }
      })
      .filter((item): item is DiagramLayer => item !== null)
  }
}

function normalizeDiagramLayerStyle(style: JsonRecord): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value
    }
  }
  return normalized
}

function scaledLayerBounds(
  bbox: DiagramLayerBounds | undefined,
  canvasBounds: SciforgeCanvasBounds,
  scaleX: number,
  scaleY: number
): SciforgeCanvasBounds | null {
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return null
  return {
    x: canvasBounds.x + bbox.x * scaleX,
    y: canvasBounds.y + bbox.y * scaleY,
    w: Math.max(8, bbox.w * scaleX),
    h: Math.max(8, bbox.h * scaleY)
  }
}

async function resolveDiagramLayerAsset(
  layer: DiagramLayer,
  workspaceRoot: string,
  fallbackPath: string | undefined
): Promise<string | null> {
  if (typeof layer.assetPath === 'string' && layer.assetPath.trim()) {
    try {
      return await resolveTargetPathWithinWorkspace(layer.assetPath, workspaceRoot)
    } catch {
      return null
    }
  }
  if (layer.type === 'image' && fallbackPath) return fallbackPath
  return null
}

async function createDrawioImageCellFromFile(input: {
  id: string
  title: string
  path: string
  bounds: SciforgeCanvasBounds
  meta: JsonRecord
  warnings: string[]
}): Promise<string> {
  const info = await stat(input.path)
  if (!info.isFile()) throw new Error(`Diagram layer asset is not a file: ${input.path}`)
  const mimeType = mimeTypeForExtension(extensionFromName(input.path))
  if (!mimeType || info.size > DRAWIO_INLINE_IMAGE_MAX_BYTES) {
    if (info.size > DRAWIO_INLINE_IMAGE_MAX_BYTES) {
      input.warnings.push(`Diagram layer asset is too large to inline: ${relativePath(dirname(input.path), input.path)}`)
    }
    return createDrawioPlaceholderCell({
      id: input.id,
      title: input.title,
      subtitle: basename(input.path),
      bounds: input.bounds,
      meta: input.meta
    })
  }
  const imageDataUri = drawioImageDataUri(mimeType, await readFile(input.path))
  return createDrawioImageCell({
    id: input.id,
    title: input.title,
    imageDataUri,
    bounds: input.bounds,
    meta: input.meta
  })
}

function createDrawioFrameworkComponentHitboxCell(input: {
  id: string
  title: string
  bounds: SciforgeCanvasBounds
  meta: JsonRecord
}): string {
  return createDrawioVertexCell({
    id: input.id,
    value: '',
    style: [
      'rounded=1',
      'whiteSpace=wrap',
      'html=1',
      'fillColor=#60a5fa',
      'fillOpacity=3',
      'strokeColor=#2563eb',
      'strokeOpacity=0',
      'fontColor=none',
      'spacing=0',
      'pointerEvents=1',
      'resizable=1',
      'rotatable=0'
    ].join(';') + ';',
    bounds: input.bounds,
    meta: {
      ...input.meta,
      sciforgeFrameworkComponentHitbox: true,
      title: input.title
    }
  })
}

function createDrawioDiagramVertexCell(input: {
  id: string
  layer: DiagramLayer
  bounds: SciforgeCanvasBounds
  meta: JsonRecord
}): string {
  const style = styleForDiagramLayer(input.layer)
  return createDrawioVertexCell({
    id: input.id,
    value: escapeHtml(input.layer.label || ''),
    style,
    bounds: input.bounds,
    meta: input.meta
  })
}

function createDrawioEdgeCell(input: {
  id: string
  value: string
  source: string
  target: string
  meta: JsonRecord
}): string {
  const style = [
    'edgeStyle=orthogonalEdgeStyle',
    'rounded=1',
    'orthogonalLoop=1',
    'jettySize=auto',
    'html=1',
    'strokeWidth=1.8',
    'strokeColor=#334155',
    'endArrow=block',
    'endFill=1',
    'fontSize=11',
    'fontColor=#334155'
  ].join(';')
  return [
    `        <mxCell id="${escapeXmlAttribute(input.id)}" value="${escapeXmlAttribute(input.value)}" style="${escapeXmlAttribute(style)}" edge="1" parent="1" source="${escapeXmlAttribute(input.source)}" target="${escapeXmlAttribute(input.target)}" sciforgeMeta="${escapeXmlAttribute(encodeJsonAttribute(input.meta))}">`,
    '          <mxGeometry relative="1" as="geometry"/>',
    '        </mxCell>'
  ].join('\n')
}

function styleForDiagramLayer(layer: DiagramLayer): string {
  const style = layer.style ?? {}
  const fillColor = stringStyle(style.fillColor) ?? stringStyle(style.fill) ?? defaultFillForDiagramLayer(layer.type)
  const strokeColor = stringStyle(style.strokeColor) ?? stringStyle(style.stroke) ?? defaultStrokeForDiagramLayer(layer.type)
  const fontColor = stringStyle(style.fontColor) ?? '#0f172a'
  const strokeWidth = numberStyle(style.strokeWidth, 1.4)
  const fontSize = numberStyle(style.fontSize, layer.type === 'label' ? 12 : 11)
  if (layer.type === 'label' || layer.type === 'text') {
    return [
      'text',
      'html=1',
      'whiteSpace=wrap',
      'strokeColor=none',
      'fillColor=none',
      `fontColor=${fontColor}`,
      `fontSize=${fontSize}`,
      'align=center',
      'verticalAlign=middle',
      'resizable=1'
    ].join(';')
  }
  const dashed = Boolean(style.dashed) || layer.type === 'group' || layer.type === 'panel'
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fillColor}`,
    `strokeColor=${strokeColor}`,
    `strokeWidth=${strokeWidth}`,
    `fontColor=${fontColor}`,
    `fontSize=${fontSize}`,
    'spacing=8',
    'align=center',
    'verticalAlign=middle',
    ...(dashed ? ['dashed=1'] : [])
  ].join(';')
}

function defaultFillForDiagramLayer(type: string): string {
  if (type === 'group' || type === 'panel') return '#f8fafc'
  if (type === 'input') return '#dbeafe'
  if (type === 'output') return '#dcfce7'
  if (type === 'operation') return '#fed7aa'
  if (type === 'attention') return '#e0e7ff'
  return '#f1f5f9'
}

function defaultStrokeForDiagramLayer(type: string): string {
  if (type === 'group' || type === 'panel') return '#94a3b8'
  if (type === 'input') return '#60a5fa'
  if (type === 'output') return '#4ade80'
  if (type === 'operation') return '#fb923c'
  if (type === 'attention') return '#818cf8'
  return '#64748b'
}

function stringStyle(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberStyle(value: unknown, fallback: number): number {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function createDrawioPlaceholderCell(input: {
  id: string
  title: string
  subtitle: string
  bounds: SciforgeCanvasBounds
  meta: JsonRecord
}): string {
  return createDrawioVertexCell({
    id: input.id,
    value: `<b>${escapeHtml(input.title)}</b><br><font color="#64748b">${escapeHtml(input.subtitle)}</font>`,
    style: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8fafc;strokeColor=#94a3b8;dashed=1;spacing=16;fontColor=#0f172a;',
    bounds: input.bounds,
    meta: {
      ...input.meta,
      sciforgeCanvasPlaceholder: true
    }
  })
}

function createDrawioVertexCell(input: {
  id: string
  value: string
  style: string
  bounds: SciforgeCanvasBounds
  meta: JsonRecord
}): string {
  return [
    `        <mxCell id="${escapeXmlAttribute(input.id)}" value="${escapeXmlAttribute(input.value)}" style="${escapeXmlAttribute(input.style)}" vertex="1" parent="1" sciforgeMeta="${escapeXmlAttribute(encodeJsonAttribute(input.meta))}">`,
    `          <mxGeometry x="${roundForXml(input.bounds.x)}" y="${roundForXml(input.bounds.y)}" width="${roundForXml(input.bounds.w)}" height="${roundForXml(input.bounds.h)}" as="geometry"/>`,
    '        </mxCell>'
  ].join('\n')
}

function insertDrawioCellXml(xml: string, cellXml: string): string {
  const rootClose = '</root>'
  const index = xml.lastIndexOf(rootClose)
  if (index === -1) throw new Error('Invalid draw.io XML: missing root close tag.')
  return `${xml.slice(0, index)}${cellXml}\n      ${xml.slice(index)}`
}

function uniqueDrawioCellId(xml: string, label: string): string {
  const base = `shape:${sanitizeId(label, 'artifact').toLowerCase()}`
  let candidate = base
  let counter = 1
  while (xml.includes(`id="${escapeXmlAttribute(candidate)}"`)) {
    candidate = `${base}-${counter}`
    counter += 1
  }
  return candidate
}

function chooseDrawioPlacement(xml: string, width: number, height: number, margin: number): SciforgeCanvasBounds {
  const bounds = parseDrawioBounds(xml)
  if (bounds.length === 0) {
    return { x: 80, y: 80, w: width, h: height }
  }
  const maxY = Math.max(...bounds.map((item) => item.y + item.h))
  return {
    x: 80,
    y: Math.ceil((maxY + margin) / 20) * 20,
    w: width,
    h: height
  }
}

function parseDrawioBounds(xml: string): SciforgeCanvasBounds[] {
  const results: SciforgeCanvasBounds[] = []
  const pattern = /<mxGeometry\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bwidth="([^"]+)"[^>]*\bheight="([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) {
    const x = Number(match[1])
    const y = Number(match[2])
    const w = Number(match[3])
    const h = Number(match[4])
    if ([x, y, w, h].every(Number.isFinite)) results.push({ x, y, w, h })
  }
  return results
}

function encodeJsonAttribute(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeJsonAttribute(value: string | undefined): JsonRecord | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function replaceXmlAttribute(xml: string, name: string, value: string): string {
  const escaped = escapeXmlAttribute(value)
  const pattern = new RegExp(`\\b${name}="[^"]*"`)
  if (pattern.test(xml)) return xml.replace(pattern, `${name}="${escaped}"`)
  return xml.replace(/<mxCell\b/, `<mxCell ${name}="${escaped}"`)
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtml(value: string): string {
  return escapeXmlAttribute(value).replace(/'/g, '&#39;')
}

function roundForXml(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

async function discoverRecentCanvasArtifacts(input: {
  workspaceRoot: string
  canvasId: string
  canvasDir: string
  existingPaths: Set<string>
  maxAgeMs: number
  limit: number
  scope: 'current_canvas' | 'workspace_recent'
  warnings: string[]
}): Promise<{ scanned: number; artifacts: SciforgeCanvasRecentArtifact[] }> {
  const cutoff = input.maxAgeMs > 0 ? Date.now() - input.maxAgeMs : 0
  const artifacts: SciforgeCanvasRecentArtifact[] = []
  let scanned = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > RECENT_ARTIFACT_MAX_DEPTH || scanned >= RECENT_ARTIFACT_MAX_VISITED) return
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      input.warnings.push(`Could not scan ${relativePath(input.workspaceRoot, dir)}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    for (const entry of entries) {
      if (scanned >= RECENT_ARTIFACT_MAX_VISITED) break
      const entryPath = join(dir, entry.name)
      const relative = relativePath(input.workspaceRoot, entryPath)
      if (entry.isDirectory()) {
        if (shouldSkipRecentArtifactDir(input.workspaceRoot, input.canvasDir, entryPath, entry.name)) continue
        await walk(entryPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      scanned += 1
      const ext = extensionFromName(entry.name)
      if (!RECENT_ARTIFACT_EXTENSIONS.has(ext)) continue
      let info: Awaited<ReturnType<typeof stat>>
      try {
        info = await stat(entryPath)
      } catch {
        continue
      }
      if (cutoff > 0 && info.mtimeMs < cutoff) continue
      const artifact = await buildRecentArtifact(entryPath, relative, info.size, info.mtimeMs, input.existingPaths)
      artifacts.push(artifact)
    }
  }

  const manifestArtifacts = await discoverArtifactManifestBus(
    input.workspaceRoot,
    input.existingPaths,
    cutoff,
    input.warnings,
    input.scope === 'current_canvas' ? input.canvasId : undefined
  )
  artifacts.push(...manifestArtifacts.artifacts)
  scanned += manifestArtifacts.scanned

  if (input.scope === 'workspace_recent') {
    await walk(input.workspaceRoot, 0)
  }
  artifacts.splice(0, artifacts.length, ...dedupeRecentArtifacts(artifacts))
  artifacts.sort((left, right) => {
    if (left.alreadyOnCanvas !== right.alreadyOnCanvas) return left.alreadyOnCanvas ? 1 : -1
    return right.mtimeMs - left.mtimeMs
  })
  return {
    scanned,
    artifacts: artifacts.slice(0, input.limit)
  }
}

async function discoverArtifactManifestBus(
  workspaceRoot: string,
  existingPaths: Set<string>,
  cutoff: number,
  warnings: string[],
  canvasScopeId?: string
): Promise<{ scanned: number; artifacts: SciforgeCanvasRecentArtifact[] }> {
  const manifestsDir = join(workspaceRoot, ARTIFACT_MANIFEST_RELATIVE_DIR)
  let entries: Dirent[]
  try {
    entries = await readdir(manifestsDir, { withFileTypes: true })
  } catch {
    return { scanned: 0, artifacts: [] }
  }

  const artifacts: SciforgeCanvasRecentArtifact[] = []
  let scanned = 0
  for (const entry of entries) {
    if (!entry.isFile() || extensionFromName(entry.name) !== '.json') continue
    scanned += 1
    const manifestFilePath = join(manifestsDir, entry.name)
    try {
      const info = await stat(manifestFilePath)
      if (cutoff > 0 && info.mtimeMs < cutoff) continue
      const parsed = JSON.parse(await readFile(manifestFilePath, 'utf8')) as unknown
      const artifact = await artifactFromManifest(parsed, manifestFilePath, workspaceRoot, existingPaths, info.mtimeMs)
      if (artifact && artifactMatchesCanvasScope(artifact, canvasScopeId)) artifacts.push(artifact)
    } catch (error) {
      warnings.push(`Could not read artifact manifest ${relativePath(workspaceRoot, manifestFilePath)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { scanned, artifacts }
}

async function artifactFromManifest(
  value: unknown,
  artifactManifestPath: string,
  workspaceRoot: string,
  existingPaths: Set<string>,
  fallbackMtimeMs: number
): Promise<SciforgeCanvasRecentArtifact | null> {
  const manifest = parseSciforgeArtifactManifest(value)
  if (!manifest) return null
  const rawPath = manifest.outputPath ?? manifest.pptxPath ?? manifest.svgPath ?? manifest.sourcePath ?? manifest.path
  if (!rawPath?.trim()) return null
  const artifactPath = await resolveOpenTargetPath(rawPath, workspaceRoot, { allowBasenameFallback: false })
  const info = await stat(artifactPath)
  if (!info.isFile()) return null
  return {
    path: artifactPath,
    relativePath: relativePath(workspaceRoot, artifactPath),
    artifactKind: manifest.artifactKind,
    title: manifest.title ?? titleFromArtifactPath(artifactPath),
    size: info.size,
    mtimeMs: Math.max(info.mtimeMs, fallbackMtimeMs),
    sourceTool: manifest.sourceTool,
    manifestPath: await existingManifestPathOrFallback(manifest.manifestPath, artifactManifestPath, workspaceRoot),
    outputPath: manifest.outputPath,
    sourcePath: manifest.sourcePath,
    previewPath: manifest.previewPath,
    styleSpecPath: manifest.styleSpecPath,
    diagramSpecPath: manifest.diagramSpecPath,
    frameworkDesignPlanPath: manifest.frameworkDesignPlanPath,
    diagramLayerManifestPath: manifest.diagramLayerManifestPath,
    fastSamSegmentationPath: manifest.fastSamSegmentationPath,
    fastSamBoxlibPath: manifest.fastSamBoxlibPath,
    fastSamPreviewPath: manifest.fastSamPreviewPath,
    frameworkComponentManifestPath: manifest.frameworkComponentManifestPath,
    componentBasePath: manifest.componentBasePath,
    componentAssetPaths: manifest.componentAssetPaths,
    referencePath: manifest.referencePath,
    projectPath: manifest.projectPath,
    svgPath: manifest.svgPath,
    pptxPath: manifest.pptxPath,
    slideIndex: manifest.slideIndex,
    caption: manifest.caption,
    reviewScore: manifest.reviewScore,
    canvasId: manifest.canvasId,
    threadId: manifest.threadId,
    alreadyOnCanvas: existingPaths.has(artifactPath)
  }
}

function artifactMatchesCanvasScope(artifact: SciforgeCanvasRecentArtifact, canvasScopeId: string | undefined): boolean {
  const scope = canvasScopeId?.trim()
  if (!scope) return true
  const canvasId = artifact.canvasId?.trim()
  if (canvasId) return canvasId === scope
  const threadId = artifact.threadId?.trim()
  if (threadId) return threadId === scope || `thread-${threadId}` === scope
  return false
}

function parseSciforgeArtifactManifest(value: unknown): SciforgeArtifactManifest | null {
  const record = asRecord(value)
  if (!record || record.kind !== 'sciforge_artifact' || record.version !== 1) return null
  if (!SCIFORGE_CANVAS_ARTIFACT_KINDS.includes(record.artifactKind as SciforgeCanvasArtifactKind)) return null
  if (typeof record.path !== 'string') return null
  return record as SciforgeArtifactManifest
}

async function existingManifestPathOrFallback(
  manifestPath: string | undefined,
  artifactManifestPath: string,
  workspaceRoot: string
): Promise<string> {
  if (!manifestPath?.trim()) return artifactManifestPath
  try {
    const resolved = await resolveOpenTargetPath(manifestPath, workspaceRoot, { allowBasenameFallback: false })
    if (await fileExists(resolved)) return resolved
  } catch {
    // Artifact-bus manifests are the authoritative fallback for Canvas import.
  }
  return artifactManifestPath
}

function dedupeRecentArtifacts(artifacts: SciforgeCanvasRecentArtifact[]): SciforgeCanvasRecentArtifact[] {
  const seen = new Map<string, SciforgeCanvasRecentArtifact>()
  for (const artifact of artifacts) {
    const existing = seen.get(artifact.path)
    if (!existing || artifact.mtimeMs >= existing.mtimeMs || artifact.sourceTool === 'scientific_plotting' || artifact.sourceTool === 'ppt_master') {
      seen.set(artifact.path, artifact)
    }
  }
  return [...seen.values()]
}

function shouldSkipRecentArtifactDir(
  workspaceRoot: string,
  canvasDir: string,
  dirPath: string,
  dirName: string
): boolean {
  if (SKIPPED_SCAN_DIRS.has(dirName)) return true
  const relative = relativePath(workspaceRoot, dirPath)
  if (relative === '.sciforge/canvases' || relative.startsWith('.sciforge/canvases/')) return true
  if (/(^|\/)backup(\/|$)/.test(relative)) return true
  if (dirPath === canvasDir || dirPath.startsWith(`${canvasDir}/`)) return true
  return false
}

async function buildRecentArtifact(
  artifactPath: string,
  relative: string,
  size: number,
  mtimeMs: number,
  existingPaths: Set<string>
): Promise<SciforgeCanvasRecentArtifact> {
  const artifactKind = recentArtifactKind(artifactPath, relative)
  const manifestPath = await findRecentArtifactManifest(artifactPath)
  return {
    path: artifactPath,
    relativePath: relative,
    artifactKind,
    title: titleFromArtifactPath(artifactPath),
    size,
    mtimeMs,
    sourceTool: sourceToolForRecentArtifact(artifactKind, relative),
    ...(manifestPath ? { manifestPath } : {}),
    alreadyOnCanvas: existingPaths.has(artifactPath)
  }
}

function recentArtifactKind(artifactPath: string, relative: string): SciforgeCanvasArtifactKind {
  const ext = extensionFromName(artifactPath)
  const searchable = `${relative} ${basename(artifactPath)}`.toLowerCase()
  if (ext === '.pptx') return 'ppt_export'
  if (ext === '.svg' && /(?:ppt|slide|deck|presentation|幻灯|页面)/i.test(searchable)) return 'ppt_slide'
  if (/(?:chart|plot|figure|fig|heatmap|scatter|bar|line|graph|科研|图表|柱状|折线)/i.test(searchable)) {
    return 'scientific_plot'
  }
  if (relative.startsWith('.sciforge/figures/')) return 'scientific_plot'
  return 'image'
}

function sourceToolForRecentArtifact(kind: SciforgeCanvasArtifactKind, relative: string): string {
  if (kind === 'scientific_plot') return 'scientific_plotting_or_workspace_import'
  if (kind === 'ppt_slide' || kind === 'ppt_export') return 'ppt_master_or_workspace_import'
  if (relative.startsWith('.sciforge/')) return 'sciforge_workspace_import'
  return 'workspace_artifact_import'
}

async function findRecentArtifactManifest(artifactPath: string): Promise<string | undefined> {
  const ext = extname(artifactPath)
  const base = artifactPath.slice(0, artifactPath.length - ext.length)
  for (const candidate of [`${base}.manifest.json`, `${base}.json`, join(dirname(artifactPath), 'manifest.json')]) {
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}

function titleFromArtifactPath(artifactPath: string): string {
  return basename(artifactPath, extname(artifactPath)).replace(/[-_]+/g, ' ').trim() || basename(artifactPath)
}

function relativePath(root: string, target: string): string {
  return pathRelative(root, target).split('\\').join('/') || '.'
}

function artifactPathsInSnapshot(snapshot: TldrawSnapshot): Set<string> {
  const paths = new Set<string>()
  for (const record of Object.values(snapshot.store)) {
    if (record?.typeName !== 'shape') continue
    const artifact = asRecord(asRecord(record.meta)?.sciforgeArtifact)
    if (!artifact) continue
    for (const key of [
      'outputPath',
      'sourcePath',
      'previewPath',
      'renderedPagePath',
      'renderedFromPptxPath',
      'manifestPath',
      'styleSpecPath',
      'diagramSpecPath',
      'frameworkDesignPlanPath',
      'diagramLayerManifestPath',
      'fastSamSegmentationPath',
      'fastSamBoxlibPath',
      'fastSamPreviewPath',
      'frameworkComponentManifestPath',
      'componentBasePath',
      'componentAssetPaths',
      'referencePath',
      'svgPath',
      'pptxPath'
    ]) {
      const value = artifact[key]
      if (typeof value === 'string' && value.trim()) paths.add(value)
    }
  }
  return paths
}

async function artifactPathsForCanvas(paths: CanvasPaths): Promise<Set<string>> {
  if (await fileExists(paths.drawioPath)) return artifactPathsInDrawioXml(await readFile(paths.drawioPath, 'utf8'))
  const snapshot = await ensureCanvasSnapshot(paths)
  return artifactPathsInSnapshot(snapshot)
}

function artifactPathsInDrawioXml(xml: string): Set<string> {
  const paths = new Set<string>()
  for (const artifact of artifactsInDrawioXml(xml)) {
    for (const key of [
      'outputPath',
      'sourcePath',
      'previewPath',
      'renderedPagePath',
      'renderedFromPptxPath',
      'manifestPath',
      'styleSpecPath',
      'diagramSpecPath',
      'frameworkDesignPlanPath',
      'diagramLayerManifestPath',
      'fastSamSegmentationPath',
      'fastSamBoxlibPath',
      'fastSamPreviewPath',
      'frameworkComponentManifestPath',
      'componentBasePath',
      'componentAssetPaths',
      'referencePath',
      'svgPath',
      'pptxPath'
    ]) {
      const value = (artifact as unknown as JsonRecord)[key]
      if (typeof value === 'string' && value.trim()) paths.add(value)
    }
  }
  return paths
}

type DrawioCellRecord = {
  id: string
  value?: string
  style?: string
  vertex?: boolean
  edge?: boolean
  meta?: JsonRecord | null
  bounds?: SciforgeCanvasBounds | null
}

function parseDrawioCells(xml: string): DrawioCellRecord[] {
  const cells: DrawioCellRecord[] = []
  const pattern = /<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) {
    const attrs = parseXmlAttributes(match[1] ?? '')
    const id = attrs.id
    if (!id || id === '0' || id === '1') continue
    const body = match[2] ?? ''
    const boundsMatch = /<mxGeometry\b([^>]*)\/?>/.exec(body)
    const geoAttrs = boundsMatch ? parseXmlAttributes(boundsMatch[1] ?? '') : {}
    const x = Number(geoAttrs.x ?? 0)
    const y = Number(geoAttrs.y ?? 0)
    const w = Number(geoAttrs.width ?? 0)
    const h = Number(geoAttrs.height ?? 0)
    cells.push({
      id,
      value: attrs.value,
      style: attrs.style,
      vertex: attrs.vertex === '1',
      edge: attrs.edge === '1',
      meta: decodeJsonAttribute(attrs.sciforgeMeta),
      bounds: [x, y, w, h].every(Number.isFinite) && (w > 0 || h > 0)
        ? { x, y, w, h }
        : null
    })
  }
  return cells
}

function parseXmlAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][\w:.-]*)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) {
    attrs[match[1]] = decodeXmlAttribute(match[2])
  }
  return attrs
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
}

function artifactsInDrawioXml(xml: string): Array<SciforgeCanvasArtifactMetadata & {
  shapeId: string
  bounds?: SciforgeCanvasBounds | null
}> {
  return parseDrawioCells(xml)
    .filter((cell) => cell.meta?.sciforgeCanvasArtifact === true)
    .map((cell) => {
      const artifact = asRecord(cell.meta?.sciforgeArtifact) as SciforgeCanvasArtifactMetadata | null
      return {
        ...(artifact ?? { artifactKind: 'image' as const }),
        shapeId: cell.id,
        bounds: cell.bounds ?? null
      }
    })
}

function findCanvasArtifactForComponentSegmentation(
  xml: string,
  sourceShapeId: string | undefined
): (SciforgeCanvasArtifactMetadata & { shapeId: string; bounds?: SciforgeCanvasBounds | null }) | undefined {
  const artifacts = artifactsInDrawioXml(xml)
    .filter((artifact) => {
      const displayPath = displayPathForArtifact(artifact)
      if (!displayPath) return false
      const ext = extensionFromName(displayPath)
      return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)
    })
  if (sourceShapeId?.trim()) {
    const exact = artifacts.find((artifact) => artifact.shapeId === sourceShapeId.trim())
    if (exact) return exact
  }
  const withManifest = artifacts.find((artifact) => artifact.frameworkComponentManifestPath)
  if (withManifest) return withManifest
  return [...artifacts].sort((left, right) => {
    const leftArea = (left.bounds?.w ?? 0) * (left.bounds?.h ?? 0)
    const rightArea = (right.bounds?.w ?? 0) * (right.bounds?.h ?? 0)
    return rightArea - leftArea
  })[0]
}

function findFrameworkComponentManifestPathInDrawioXml(xml: string): string | undefined {
  for (const cell of parseDrawioCells(xml)) {
    const meta = asRecord(cell.meta)
    if (!meta) continue
    const direct = typeof meta.frameworkComponentManifestPath === 'string'
      ? meta.frameworkComponentManifestPath
      : typeof meta.sciforgeFrameworkComponentManifestPath === 'string'
        ? meta.sciforgeFrameworkComponentManifestPath
        : undefined
    if (direct?.trim()) return direct
    const artifact = asRecord(meta.sciforgeArtifact)
    const artifactManifest = typeof artifact?.frameworkComponentManifestPath === 'string'
      ? artifact.frameworkComponentManifestPath
      : typeof artifact?.sciforgeFrameworkComponentManifestPath === 'string'
        ? artifact.sciforgeFrameworkComponentManifestPath
        : undefined
    if (artifactManifest?.trim()) return artifactManifest
  }
  return undefined
}

function removeFrameworkComponentSplitCellsForManifest(xml: string, manifestPath: string): { xml: string; removed: number } {
  const normalizedManifestPath = resolve(manifestPath)
  const removeIds: string[] = []
  for (const cell of parseDrawioCells(xml)) {
    const meta = asRecord(cell.meta)
    if (!meta?.sciforgeFrameworkComponentBase && !meta?.sciforgeFrameworkComponent) continue
    const rawPath = typeof meta.frameworkComponentManifestPath === 'string'
      ? meta.frameworkComponentManifestPath
      : typeof meta.sciforgeFrameworkComponentManifestPath === 'string'
        ? meta.sciforgeFrameworkComponentManifestPath
        : undefined
    if (!rawPath) continue
    try {
      if (resolve(rawPath) === normalizedManifestPath) removeIds.push(cell.id)
    } catch {
      if (rawPath === manifestPath) removeIds.push(cell.id)
    }
  }
  if (removeIds.length === 0) return { xml, removed: 0 }
  return {
    xml: removeDrawioCellsById(xml, removeIds),
    removed: removeIds.length
  }
}

function removeDrawioCellsById(xml: string, ids: string[]): string {
  let nextXml = xml
  for (const id of ids) {
    const escapedId = escapeRegExp(escapeXmlAttribute(id))
    nextXml = nextXml.replace(new RegExp(`\\n?\\s*<mxCell\\b(?=[^>]*\\bid="${escapedId}")[\\s\\S]*?<\\/mxCell>`, 'g'), '')
    nextXml = nextXml.replace(new RegExp(`\\n?\\s*<mxCell\\b(?=[^>]*\\bid="${escapedId}")[^>]*/>`, 'g'), '')
  }
  return nextXml
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildDrawioReviewPacket(input: {
  canvasId: string
  title: string
  xml: string
  selection: SciforgeCanvasSelectionState
}): SciforgeCanvasReviewPacket {
  const cells = parseDrawioCells(input.xml)
  const enrichedSelectedShapes = enrichDrawioSelectionShapes(cells, input.selection.selectedShapes)
  const selectedComponents = selectedFrameworkComponentsFromShapes(enrichedSelectedShapes)
  const artifacts = artifactsInDrawioXml(input.xml)
  const annotationsFromXml = cells
    .filter((cell) => !cell.meta?.sciforgeCanvasArtifact && isDrawioAnnotationCell(cell))
    .map<SciforgeCanvasReviewPacketAnnotation>((cell) => ({
      shapeId: cell.id,
      annotationKind: cell.edge || (cell.style ?? '').includes('endArrow=') ? 'arrow' : 'box',
      bounds: cell.bounds ?? null,
      text: cleanDrawioValue(cell.value),
      color: colorFromDrawioStyle(cell.style),
      sourceShapeId: typeof cell.meta?.cowartAnnotationSourceShapeId === 'string'
        ? cell.meta.cowartAnnotationSourceShapeId
        : undefined
    }))
  const annotations = mergeReviewAnnotations(
    annotationsFromXml,
    input.selection.selectedShapes
      .filter(isReviewAnnotationSelectedShape)
      .map(annotationFromSelectedShape)
  )
  const modificationSuggestions = buildModificationSuggestions({ artifacts, annotations })
  return {
    version: 1,
    tool: 'sciforge_canvas_export_review_packet',
    createdAt: new Date().toISOString(),
    canvasId: input.canvasId,
    ...(input.canvasId.startsWith('thread-') && input.canvasId.length > 'thread-'.length
      ? { threadId: input.canvasId.slice('thread-'.length) }
      : {}),
    title: input.title,
    artifacts,
    annotations,
    selectedShapes: enrichedSelectedShapes,
    ...(selectedComponents.length ? { selectedComponents } : {}),
    modificationSuggestions,
    adjustmentRequests: artifacts.map((artifact) => ({
      artifactKind: artifact.artifactKind,
      shapeId: artifact.shapeId,
      nextControlledTool: nextControlledToolForArtifact(artifact.artifactKind, {
        artifact
      }),
      reason: reasonForAdjustment(artifact.artifactKind)
    })),
    guardrails: [
      'Canvas review packets are advisory and do not mutate original artifacts.',
      'draw.io cells are interpreted as review annotations unless they carry SciForge artifact metadata.',
      'Use image_generation_edit_from_canvas_packet for visual redraw, beautification, schematic, flowchart, architecture, and summary-figure edits.',
      'Use scientific_plotting_render for numeric/statistical chart adjustments that preserve data semantics.',
      'PPT adjustments should remain review annotations in v1 unless a later SVG white-list edit path is enabled.'
    ]
  }
}

function isDrawioAnnotationCell(cell: DrawioCellRecord): boolean {
  if (cell.edge) return true
  const value = cleanDrawioValue(cell.value)
  const style = cell.style ?? ''
  return Boolean(value) ||
    style.includes('shape=callout') ||
    style.includes('rounded=') ||
    style.includes('ellipse') ||
    style.includes('endArrow=')
}

function cleanDrawioValue(value: string | undefined): string | undefined {
  if (!value) return undefined
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return text || undefined
}

function colorFromDrawioStyle(style: string | undefined): string | undefined {
  if (!style) return undefined
  const match = /(?:strokeColor|fontColor|fillColor)=([^;]+)/.exec(style)
  return match?.[1]
}

function buildReviewPacket(input: {
  canvasId: string
  title: string
  snapshot: TldrawSnapshot
  selection: SciforgeCanvasSelectionState
}): SciforgeCanvasReviewPacket {
  const artifacts = Object.values(input.snapshot.store)
    .filter((record) => record?.typeName === 'shape' && asRecord(record.meta)?.sciforgeCanvasArtifact === true)
    .map((shape) => {
      const meta = asRecord(shape.meta)
      const artifact = asRecord(meta?.sciforgeArtifact) as SciforgeCanvasArtifactMetadata
      return {
        ...artifact,
        shapeId: String(shape.id),
        bounds: pageBoundsForShape(input.snapshot.store, shape)
      }
    })
  const annotationsFromSnapshot = Object.values(input.snapshot.store)
    .filter((record) => record?.typeName === 'shape' && isReviewAnnotationShape(record))
    .map((shape) => {
      const meta = asRecord(shape.meta)
      const props = asRecord(shape.props)
      const annotationKind = annotationKindForShape(shape)
      return {
        shapeId: String(shape.id),
        annotationKind,
        bounds: pageBoundsForShape(input.snapshot.store, shape),
        text: plainTextFromRichText(props?.richText),
        color: typeof props?.color === 'string' ? props.color : undefined,
        sourceShapeId: typeof meta?.cowartAnnotationSourceShapeId === 'string'
          ? meta.cowartAnnotationSourceShapeId
          : undefined
      }
    })
  const annotations = mergeReviewAnnotations(
    annotationsFromSnapshot,
    input.selection.selectedShapes
      .filter(isReviewAnnotationSelectedShape)
      .map(annotationFromSelectedShape)
  )
  const modificationSuggestions = buildModificationSuggestions({ artifacts, annotations })
  return {
    version: 1,
    tool: 'sciforge_canvas_export_review_packet',
    createdAt: new Date().toISOString(),
    canvasId: input.canvasId,
    ...(input.canvasId.startsWith('thread-') && input.canvasId.length > 'thread-'.length
      ? { threadId: input.canvasId.slice('thread-'.length) }
      : {}),
    title: input.title,
    artifacts,
    annotations,
    selectedShapes: input.selection.selectedShapes,
    modificationSuggestions,
    adjustmentRequests: artifacts.map((artifact) => ({
      artifactKind: artifact.artifactKind,
      shapeId: artifact.shapeId,
      nextControlledTool: nextControlledToolForArtifact(artifact.artifactKind, {
        artifact
      }),
      reason: reasonForAdjustment(artifact.artifactKind)
    })),
    guardrails: [
      'Canvas review packets are advisory and do not mutate original artifacts.',
      'Use image_generation_edit_from_canvas_packet for visual redraw, beautification, schematic, flowchart, architecture, and summary-figure edits.',
      'Use scientific_plotting_render for numeric/statistical chart adjustments that preserve data semantics.',
      'PPT adjustments should remain review annotations in v1 unless a later SVG white-list edit path is enabled.'
    ]
  }
}

function mergeReviewAnnotations(
  primary: SciforgeCanvasReviewPacketAnnotation[],
  fallback: SciforgeCanvasReviewPacketAnnotation[]
): SciforgeCanvasReviewPacketAnnotation[] {
  const seen = new Set(primary.map((annotation) => annotation.shapeId))
  const merged = [...primary]
  for (const annotation of fallback) {
    if (seen.has(annotation.shapeId)) continue
    seen.add(annotation.shapeId)
    merged.push(annotation)
  }
  return merged
}

function isReviewAnnotationSelectedShape(shape: SciforgeCanvasSelectedShape): boolean {
  const meta = asRecord(shape.meta)
  const props = asRecord(shape.props)
  if (shape.type === 'arrow') {
    return meta?.cowartAnnotationArrow === true || meta?.sciforgeCanvasAnnotation === true
  }
  if (shape.type === 'geo') {
    return meta?.sciforgeCanvasAnnotationBox === true ||
      (meta?.sciforgeCanvasAnnotation === true && props?.geo === 'rectangle')
  }
  return false
}

function annotationFromSelectedShape(shape: SciforgeCanvasSelectedShape): SciforgeCanvasReviewPacketAnnotation {
  const meta = asRecord(shape.meta)
  const props = asRecord(shape.props)
  return {
    shapeId: shape.id,
    annotationKind: shape.type === 'geo' ? 'box' : 'arrow',
    bounds: shape.bounds ?? null,
    text: plainTextFromRichText(props?.richText) ??
      (typeof props?.text === 'string' ? props.text : undefined),
    color: typeof props?.color === 'string' ? props.color : undefined,
    sourceShapeId: typeof meta?.cowartAnnotationSourceShapeId === 'string'
      ? meta.cowartAnnotationSourceShapeId
      : undefined
  }
}

function buildModificationSuggestions(input: {
  artifacts: Array<SciforgeCanvasArtifactMetadata & { shapeId: string; bounds?: SciforgeCanvasBounds | null }>
    annotations: Array<{
      shapeId: string
      annotationKind?: 'arrow' | 'box'
      bounds?: SciforgeCanvasBounds | null
      text?: string
      color?: string
    sourceShapeId?: string
  }>
}): SciforgeCanvasReviewPacket['modificationSuggestions'] {
  return input.annotations.map((annotation) => {
    const target = findAnnotationTargetArtifact(annotation, input.artifacts)
    const instruction = annotation.text?.trim() && annotation.text.trim() !== '批注'
      ? annotation.text.trim()
      : target
        ? `Review the annotated area on ${labelForArtifact(target)} and propose a controlled visual/content adjustment.`
        : 'Review this annotation and ask the user to attach it to a specific canvas artifact before applying changes.'
    return {
      annotationShapeId: annotation.shapeId,
      ...(target ? {
        targetShapeId: target.shapeId,
        artifactKind: target.artifactKind,
        ...(target.slideIndex !== undefined ? { slideIndex: target.slideIndex } : {}),
        nextControlledTool: nextControlledToolForArtifact(target.artifactKind, {
          artifact: target,
          instruction
        }),
        safety: safetyForModification(target.artifactKind, instruction, target)
      } : {
        nextControlledTool: 'sciforge_canvas_get_selection',
        safety: 'No source artifact is linked yet; keep this as a review note until the user selects or anchors the intended target.'
      }),
      instruction,
      status: 'draft'
    }
  })
}

function isReviewAnnotationShape(shape: JsonRecord): boolean {
  const meta = asRecord(shape.meta)
  if (shape.type === 'arrow') {
    return meta?.cowartAnnotationArrow === true || meta?.sciforgeCanvasAnnotation === true
  }
  if (shape.type === 'geo') {
    return meta?.sciforgeCanvasAnnotationBox === true ||
      (meta?.sciforgeCanvasAnnotation === true && asRecord(shape.props)?.geo === 'rectangle')
  }
  return false
}

function annotationKindForShape(shape: JsonRecord): 'arrow' | 'box' {
  return shape.type === 'geo' ? 'box' : 'arrow'
}

function findAnnotationTargetArtifact(
  annotation: {
    sourceShapeId?: string
    bounds?: SciforgeCanvasBounds | null
  },
  artifacts: Array<SciforgeCanvasArtifactMetadata & { shapeId: string; bounds?: SciforgeCanvasBounds | null }>
): (SciforgeCanvasArtifactMetadata & { shapeId: string; bounds?: SciforgeCanvasBounds | null }) | null {
  if (annotation.sourceShapeId) {
    const direct = artifacts.find((artifact) => artifact.shapeId === annotation.sourceShapeId)
    if (direct) return direct
  }
  if (artifacts.length === 1) return artifacts[0]
  if (!annotation.bounds) return null
  const ranked = artifacts
    .filter((artifact) => artifact.bounds)
    .map((artifact) => ({
      artifact,
      distance: rectDistance(annotation.bounds!, artifact.bounds!)
    }))
    .sort((a, b) => a.distance - b.distance)
  return ranked[0]?.artifact ?? null
}

function labelForArtifact(artifact: SciforgeCanvasArtifactMetadata): string {
  if (artifact.artifactKind === 'ppt_slide' || artifact.artifactKind === 'ppt_export') {
    return artifact.slideIndex !== undefined ? `PPT slide ${artifact.slideIndex + 1}` : 'the PPT page'
  }
  if (artifact.artifactKind === 'scientific_plot') return 'the scientific plot'
  if (artifact.artifactKind === 'generated_image') return 'the generated image'
  if (artifact.artifactKind === 'edited_image') return 'the edited image'
  return 'the image artifact'
}

function safetyForModification(
  kind: SciforgeCanvasArtifactKind,
  instruction?: string,
  artifact?: SciforgeCanvasReviewPacketArtifact
): string {
  if (kind === 'scientific_plot' && shouldUseImageGenerationForScientificPlot(instruction, artifact)) {
    return 'Create a new visually enhanced before/after image artifact; keep the original scientific plot unchanged.'
  }
  if (kind === 'scientific_plot') return 'Use controlled plotting tools only; do not change data semantics.'
  if (kind === 'generated_image' || kind === 'edited_image' || kind === 'image') return 'Create a new before/after image artifact; do not overwrite the original.'
  if (kind === 'ppt_slide' || kind === 'ppt_export') return 'Keep this as a review packet in v1; do not automatically rewrite ppt-master source files.'
  return 'Create a new before/after artifact; do not overwrite the original.'
}

function nextControlledToolForArtifact(
  kind: SciforgeCanvasArtifactKind,
  context?: {
    artifact?: SciforgeCanvasReviewPacketArtifact
    instruction?: string
  }
): string {
  if (kind === 'scientific_plot') {
    return shouldUseImageGenerationForScientificPlot(context?.instruction, context?.artifact)
      ? 'image_generation_edit_from_canvas_packet'
      : 'scientific_plotting_render'
  }
  if (kind === 'generated_image' || kind === 'edited_image' || kind === 'image') return 'image_generation_edit_from_canvas_packet'
  if (kind === 'ppt_slide' || kind === 'ppt_export') return 'ppt_master_review_or_regenerate'
  return 'sciforge_canvas_insert_artifact'
}

function reasonForAdjustment(kind: SciforgeCanvasArtifactKind): string {
  if (kind === 'scientific_plot') return 'Route data-chart adjustments to scientific_plotting_render and visual redraw/beautification requests to image_generation_edit_from_canvas_packet.'
  if (kind === 'generated_image' || kind === 'edited_image' || kind === 'image') return 'Convert Canvas annotations into a non-destructive image edit and insert the new artifact beside the original.'
  if (kind === 'ppt_slide' || kind === 'ppt_export') return 'Keep annotations as a review packet in v1; do not automatically rewrite ppt-master source files.'
  return 'Use as before/after visual context.'
}

function shouldUseImageGenerationForScientificPlot(
  instruction?: string,
  artifact?: SciforgeCanvasReviewPacketArtifact
): boolean {
  const text = [
    instruction,
    artifact?.title,
    artifact?.caption,
    artifact?.sourceTool,
    artifact?.outputPath,
    artifact?.sourcePath,
    artifact?.manifestPath
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!text) return false
  if (/\b(axis|axes|tick|legend|grid|marker|line width|linewidth|font size|font|scale|bar|scatter|heatmap|error bar|p[-\s]?value)\b/.test(text)) {
    return false
  }
  return /太简单|简单了|美化|重画|重新画|重绘|好看|漂亮|视觉|风格|示意|机制|流程图|架构|结构图|模型图|总结图|综述图|论文图|diagram|flowchart|schematic|architecture|redraw|beautify|polish|too simple|make it better|visual|summary figure|graphical abstract/.test(text)
}

function plainTextFromRichText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  const text: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const record = node as JsonRecord
    if (typeof record.text === 'string') text.push(record.text)
    if (Array.isArray(record.content)) record.content.forEach(walk)
  }
  walk(value)
  const joined = text.join(' ').replace(/\s+/g, ' ').trim()
  return joined || undefined
}

function findPageId(snapshot: TldrawSnapshot): string | null {
  return Object.values(snapshot.store).find((record) => record?.typeName === 'page')?.id as string | null ?? null
}

function pageBoundsForShape(store: Record<string, JsonRecord>, shape: JsonRecord | null): SciforgeCanvasBounds | null {
  if (!shape || shape.typeName !== 'shape') return null
  const local = localBoundsForShape(shape)
  if (!local) return null
  let x = finiteNumber(shape.x, 0) + local.x
  let y = finiteNumber(shape.y, 0) + local.y
  let parent = store[String(shape.parentId ?? '')]
  const visited = new Set([String(shape.id)])
  while (parent?.typeName === 'shape' && !visited.has(String(parent.id))) {
    visited.add(String(parent.id))
    x += finiteNumber(parent.x, 0)
    y += finiteNumber(parent.y, 0)
    parent = store[String(parent.parentId ?? '')]
  }
  return { x, y, w: local.w, h: local.h }
}

function localBoundsForShape(shape: JsonRecord): SciforgeCanvasBounds | null {
  if (!shape || shape.typeName !== 'shape') return null
  const props = asRecord(shape.props)
  if (shape.type === 'arrow') {
    const start = asRecord(props?.start) ?? { x: 0, y: 0 }
    const end = asRecord(props?.end) ?? { x: 1, y: 0 }
    const minX = Math.min(finiteNumber(start.x, 0), finiteNumber(end.x, 0))
    const minY = Math.min(finiteNumber(start.y, 0), finiteNumber(end.y, 0))
    const maxX = Math.max(finiteNumber(start.x, 0), finiteNumber(end.x, 0))
    const maxY = Math.max(finiteNumber(start.y, 0), finiteNumber(end.y, 0))
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
  }
  return {
    x: 0,
    y: 0,
    w: finiteNumber(props?.w, shape.type === 'text' ? 160 : 1),
    h: finiteNumber(props?.h, shape.type === 'text' ? 40 : 1)
  }
}

function choosePlacement(input: {
  store: Record<string, JsonRecord>
  pageId: string
  parentId: string
  anchorShape: JsonRecord | null
  width: number
  height: number
  margin: number
  placement: 'right' | 'left' | 'below'
}): SciforgeCanvasBounds {
  const anchorBounds = pageBoundsForShape(input.store, input.anchorShape)
  let x = anchorBounds ? anchorBounds.x + anchorBounds.w + input.margin : 0
  let y = anchorBounds ? anchorBounds.y : 0
  if (input.placement === 'left' && anchorBounds) x = anchorBounds.x - input.width - input.margin
  if (input.placement === 'below' && anchorBounds) {
    x = anchorBounds.x
    y = anchorBounds.y + anchorBounds.h + input.margin
  }
  const obstacles = getPageShapes(input.store, input.pageId)
    .filter((shape) => shape.parentId === input.parentId && shape.id !== input.anchorShape?.id)
    .map((shape) => pageBoundsForShape(input.store, shape))
    .filter((bounds): bounds is SciforgeCanvasBounds => Boolean(bounds))
  const stepX = Math.max(input.width + input.margin, 1)
  const stepY = Math.max(input.height + input.margin, 1)
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const candidate = { x, y, w: input.width, h: input.height }
    if (!obstacles.some((bounds) => rectsOverlap(candidate, bounds, input.margin / 2))) return candidate
    if (input.placement === 'below') y += stepY
    else if (input.placement === 'left') x -= stepX
    else x += stepX
  }
  return { x, y, w: input.width, h: input.height }
}

function getPageShapes(store: Record<string, JsonRecord>, pageId: string): JsonRecord[] {
  const shapes: JsonRecord[] = []
  const byParent = new Map<string, JsonRecord[]>()
  for (const record of Object.values(store)) {
    if (record?.typeName !== 'shape') continue
    const parentId = String(record.parentId ?? '')
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), record])
  }
  const queue = [...(byParent.get(pageId) ?? [])]
  while (queue.length > 0) {
    const shape = queue.shift()!
    shapes.push(shape)
    queue.push(...(byParent.get(String(shape.id)) ?? []))
  }
  return shapes
}

function rectsOverlap(a: SciforgeCanvasBounds, b: SciforgeCanvasBounds, padding = 0): boolean {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  )
}

function rectDistance(a: SciforgeCanvasBounds, b: SciforgeCanvasBounds): number {
  if (rectsOverlap(a, b)) return 0
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const bx = b.x + b.w / 2
  const by = b.y + b.h / 2
  return Math.hypot(ax - bx, ay - by)
}

function chooseIndex(store: Record<string, JsonRecord>, parentId: string): string {
  const indexes = Object.values(store)
    .filter((record) => record?.typeName === 'shape' && record.parentId === parentId && typeof record.index === 'string')
    .map((record) => String(record.index))
    .sort()
  return generateKeyBetween(indexes.at(-1) ?? null, null)
}

function uniqueRecordId(store: Record<string, JsonRecord>, prefix: 'shape' | 'asset', seed: string): string {
  const cleanSeed = sanitizeId(seed.replace(/\.[^.]+$/, ''), prefix)
  let candidate = `${prefix}:${cleanSeed}`
  let counter = 2
  while (store[candidate]) {
    candidate = `${prefix}:${cleanSeed}-${counter}`
    counter += 1
  }
  return candidate
}

async function uniqueFilePath(dir: string, requestedName: string): Promise<{ fileName: string; filePath: string }> {
  const safeName = sanitizeFileName(requestedName)
  const ext = extname(safeName)
  const base = safeName.slice(0, safeName.length - ext.length)
  let candidate = safeName
  let counter = 2
  while (true) {
    const filePath = join(dir, candidate)
    if (!(await fileExists(filePath))) return { fileName: candidate, filePath }
    candidate = `${base}-v${counter}${ext}`
    counter += 1
  }
}

function sanitizeFileName(name: string): string {
  const rawName = basename(name || 'artifact')
  const extension = extname(rawName) || '.png'
  const base = rawName
    .slice(0, rawName.length - extname(rawName).length)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'artifact'}${extension}`
}

function readImageDimensions(filePath: string, buffer: Buffer): ImageDimensions {
  const ext = extensionFromName(filePath)
  if (ext === '.png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if ((ext === '.jpg' || ext === '.jpeg') && buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      const size = buffer.readUInt16BE(offset + 2)
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      offset += 2 + size
    }
  }
  if (ext === '.webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    if (buffer.toString('ascii', 12, 16) === 'VP8X') {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
    }
  }
  if (ext === '.svg') {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 20_000))
    const width = parseSvgLength(text.match(/\bwidth=["']?([0-9.]+)/i)?.[1])
    const height = parseSvgLength(text.match(/\bheight=["']?([0-9.]+)/i)?.[1])
    if (width && height) return { width, height }
    const viewBox = text.match(/\bviewBox=["']?([0-9.\s-]+)/i)?.[1]?.trim().split(/\s+/).map(Number)
    if (viewBox && viewBox.length === 4 && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3])) {
      return { width: Math.max(1, Math.round(viewBox[2])), height: Math.max(1, Math.round(viewBox[3])) }
    }
  }
  return { width: DEFAULT_IMAGE_WIDTH, height: Math.round(DEFAULT_IMAGE_WIDTH * 0.62) }
}

function parseSvgLength(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function mimeTypeForExtension(ext: string): string | null {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return null
  }
}

async function renderPptxSlidePreview(input: {
  pptxPath: string
  slideIndex: number
  paths: CanvasPaths
}): Promise<PptxPreviewResult> {
  const tools = await detectPptRenderTools()
  let officeError: Error | null = null
  if (tools.sofficePath && tools.pdftoppmPath) {
    try {
      return await renderPptxSlidePreviewWithOffice(input, tools.sofficePath, tools.pdftoppmPath)
    } catch (error) {
      officeError = error instanceof Error ? error : new Error(String(error))
    }
  }

  if (tools.qlmanagePath) {
    try {
      return await renderPptxSlidePreviewWithQuickLook(input, tools.qlmanagePath)
    } catch (quickLookError) {
      if (officeError) {
        throw new Error(`LibreOffice preview failed: ${officeError.message}\nQuickLook preview failed: ${quickLookError instanceof Error ? quickLookError.message : String(quickLookError)}`)
      }
      throw quickLookError
    }
  }

  if (officeError) throw officeError
  throw new Error('requires soffice/libreoffice + pdftoppm, or macOS qlmanage for first-slide preview.')
}

async function renderPptxSlidePreviewWithOffice(
  input: {
    pptxPath: string
    slideIndex: number
    paths: CanvasPaths
  },
  sofficePath: string,
  pdftoppmPath: string
): Promise<PptxPreviewResult> {
  const render = await buildPptRenderPaths(input, 'office')
  if (await fileExists(render.pngPath)) {
    return {
      pngPath: render.pngPath,
      pdfPath: render.pdfPath,
      slideIndex: input.slideIndex,
      pageNumber: render.pageNumber
    }
  }

  await mkdir(render.renderDir, { recursive: true })
  await runBinary(sofficePath, [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    render.renderDir,
    input.pptxPath
  ])

  const generatedPdf = await findFirstFileWithExtension(render.renderDir, '.pdf')
  if (!generatedPdf) throw new Error('soffice did not produce a PDF preview.')

  const prefix = join(render.renderDir, 'slide')
  await runBinary(pdftoppmPath, [
    '-png',
    '-r',
    String(PPT_PREVIEW_DPI),
    '-f',
    String(render.pageNumber),
    '-l',
    String(render.pageNumber),
    generatedPdf,
    prefix
  ])

  const generatedPng = await findGeneratedPng(render.renderDir)
  if (!generatedPng) throw new Error(`pdftoppm did not produce a PNG for slide ${render.pageNumber}.`)
  if (generatedPng !== render.pngPath) await rename(generatedPng, render.pngPath)
  return {
    pngPath: render.pngPath,
    pdfPath: generatedPdf,
    slideIndex: input.slideIndex,
    pageNumber: render.pageNumber
  }
}

async function renderPptxSlidePreviewWithQuickLook(
  input: {
    pptxPath: string
    slideIndex: number
    paths: CanvasPaths
  },
  qlmanagePath: string
): Promise<PptxPreviewResult> {
  if (input.slideIndex > 0) {
    throw new Error('QuickLook fallback only supports first-slide PPTX preview.')
  }
  const render = await buildPptRenderPaths(input, 'quicklook')
  if (await fileExists(render.pngPath)) {
    return {
      pngPath: render.pngPath,
      pdfPath: render.pdfPath,
      slideIndex: input.slideIndex,
      pageNumber: render.pageNumber
    }
  }

  await mkdir(render.renderDir, { recursive: true })
  await runBinary(qlmanagePath, [
    '-t',
    '-s',
    '1200',
    '-o',
    render.renderDir,
    input.pptxPath
  ])

  const generatedPng = await findGeneratedPng(render.renderDir)
  if (!generatedPng) throw new Error('qlmanage did not produce a PNG thumbnail.')
  if (generatedPng !== render.pngPath) await rename(generatedPng, render.pngPath)
  return {
    pngPath: render.pngPath,
    pdfPath: render.pdfPath,
    slideIndex: input.slideIndex,
    pageNumber: render.pageNumber
  }
}

async function buildPptRenderPaths(
  input: {
    pptxPath: string
    slideIndex: number
    paths: CanvasPaths
  },
  renderer: 'office' | 'quicklook'
): Promise<{
  renderDir: string
  pdfPath: string
  pngPath: string
  pageNumber: number
}> {
  const pptxInfo = await stat(input.pptxPath)
  if (!pptxInfo.isFile()) throw new Error(`PPTX path is not a file: ${input.pptxPath}`)

  const pageNumber = input.slideIndex + 1
  const basenameWithoutExt = basename(input.pptxPath, extname(input.pptxPath))
  const renderHash = createHash('sha1')
    .update(`${input.pptxPath}:${pptxInfo.mtimeMs}:${pptxInfo.size}:${pageNumber}:${renderer}`)
    .digest('hex')
    .slice(0, 12)
  const renderDir = join(
    input.paths.rendersDir,
    `${sanitizeId(basenameWithoutExt, 'deck')}-slide-${pageNumber}-${renderer}-${renderHash}`
  )
  return {
    renderDir,
    pdfPath: join(renderDir, `${basenameWithoutExt}.pdf`),
    pngPath: join(renderDir, `slide-${String(pageNumber).padStart(2, '0')}.png`),
    pageNumber
  }
}

async function detectPptRenderTools(): Promise<PptRenderTools> {
  if (process.env.SCIFORGE_CANVAS_DISABLE_PPT_RENDER === '1') return {}
  const sofficePath = await findExecutable([
    process.env.SCIFORGE_SOFFICE_BIN,
    process.env.SOFFICE_BIN,
    ...pathExecutableCandidates('soffice'),
    ...pathExecutableCandidates('libreoffice'),
    '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  ])
  const pdftoppmPath = await findExecutable([
    process.env.SCIFORGE_PDFTOPPM_BIN,
    process.env.PDFTOPPM_BIN,
    ...pathExecutableCandidates('pdftoppm'),
    '/opt/homebrew/bin/pdftoppm',
    '/usr/local/bin/pdftoppm'
  ])
  const qlmanagePath = await findExecutable([
    process.env.SCIFORGE_QLMANAGE_BIN,
    process.env.QLMANAGE_BIN,
    ...pathExecutableCandidates('qlmanage'),
    '/usr/bin/qlmanage'
  ])
  return {
    ...(sofficePath ? { sofficePath } : {}),
    ...(pdftoppmPath ? { pdftoppmPath } : {}),
    ...(qlmanagePath ? { qlmanagePath } : {})
  }
}

function pathExecutableCandidates(name: string): string[] {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, name))
}

async function findExecutable(candidates: Array<string | undefined>): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // Try next candidate.
    }
  }
  return undefined
}

async function runBinary(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, {
      timeout: pptRenderTimeoutMs(),
      maxBuffer: 2 * 1024 * 1024
    })
  } catch (error) {
    if (error && typeof error === 'object') {
      const record = error as { message?: string; stdout?: string; stderr?: string }
      const tail = [record.stdout, record.stderr]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.slice(-800))
        .join('\n')
      throw new Error(`${record.message ?? 'command failed'}${tail ? `\n${tail}` : ''}`)
    }
    throw error
  }
}

function pptRenderTimeoutMs(): number {
  const raw = Number(process.env.SCIFORGE_CANVAS_PPT_RENDER_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw >= 500) return Math.min(raw, 30_000)
  return DEFAULT_PPT_RENDER_TIMEOUT_MS
}

async function findFirstFileWithExtension(dir: string, extension: string): Promise<string | null> {
  const entries = await readdir(dir)
  const match = entries.find((entry) => extensionFromName(entry) === extension)
  return match ? join(dir, match) : null
}

async function findGeneratedPng(dir: string): Promise<string | null> {
  const entries = await readdir(dir)
  const pngs = entries
    .filter((entry) => extensionFromName(entry) === '.png')
    .sort((a, b) => a.localeCompare(b))
  return pngs[0] ? join(dir, pngs[0]) : null
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempFile, filePath)
}

async function writeTextAtomic(filePath: string, value: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempFile, value, 'utf8')
  await rename(tempFile, filePath)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' ? value as JsonRecord : null
}

function statusForInsertError(message: string): Extract<SciforgeCanvasInsertArtifactResult, { ok: false }>['status'] {
  if (message.includes('workspace')) return 'invalid_workspace'
  if (message.includes('not found') || message.includes('ENOENT')) return 'artifact_not_found'
  if (message.includes('Unsupported') || message.includes('display')) return 'unsupported_artifact'
  if (message.includes('write') || message.includes('save')) return 'canvas_write_failed'
  return 'invalid_request'
}

export const _sciforgeCanvasInternals = {
  createInitialCanvasSnapshot,
  readImageDimensions,
  sanitizeId,
  choosePlacement,
  pageBoundsForShape,
  buildReviewPacket,
  CANVAS_ROOT_RELATIVE
}
