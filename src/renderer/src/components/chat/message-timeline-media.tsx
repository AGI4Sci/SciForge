import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, FileText, ImageIcon, Loader2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  hasSafeEmbeddedMediaExtension,
  isSafeEmbeddedMediaMimeType,
  normalizeSafeEmbeddedMediaUrl,
  normalizeSafeRemoteEmbeddedMediaUrl
} from '@shared/external-url-policy'
import type { AttachmentReference, RuntimeDisclosureMetadata } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { openSafeExternalUrl } from '../../lib/open-external'
import { useChatStore } from '../../store/chat-store'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { ImagePreviewLightbox } from './ImagePreviewLightbox'

export type TimelineImageReference = {
  id?: string
  name?: string
  fileName?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  previewUrl?: string
  dataUrl?: string
  url?: string
  path?: string
  relativePath?: string
  absolutePath?: string
  outputPath?: string
  sourcePath?: string
  manifestPath?: string
  artifactManifestPath?: string
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  fastSamSegmentationPath?: string
  fastSamBoxlibPath?: string
  fastSamPreviewPath?: string
  frameworkComponentManifestPath?: string
  componentBasePath?: string
  componentAssetPaths?: string[]
  artifactKind?: string
  sourceTool?: string
  canvasId?: string
  threadId?: string
  workspaceRoot?: string
  caption?: string
  source: 'attachment' | 'generated'
}

export type TimelineImageCanvasArtifact = {
  artifactKind: 'image' | 'generated_image' | 'edited_image' | 'scientific_plot' | 'ppt_slide' | 'ppt_export'
  outputPath?: string
  sourcePath?: string
  previewPath?: string
  renderedPagePath?: string
  manifestPath?: string
  artifactManifestPath?: string
  diagramSpecPath?: string
  frameworkDesignPlanPath?: string
  diagramLayerManifestPath?: string
  fastSamSegmentationPath?: string
  fastSamBoxlibPath?: string
  fastSamPreviewPath?: string
  frameworkComponentManifestPath?: string
  componentBasePath?: string
  componentAssetPaths?: string[]
  projectPath?: string
  svgPath?: string
  pptxPath?: string
  slideIndex?: number
  title?: string
  caption?: string
  sourceTool?: string
  canvasId?: string
  threadId?: string
  workspaceRoot?: string
}

type TimelineCanvasArtifactReference = TimelineImageCanvasArtifact & {
  id?: string
  name?: string
  path?: string
  byteSize?: number
}

type TimelineToolImageBlock = {
  id: string
  summary?: string
  detail?: string
  meta?: Record<string, unknown>
}

type TimelineImageGalleryVariant = 'user' | 'tool' | 'conversation' | 'assistant'

type MarkdownImageArtifactContextValue = {
  images: TimelineImageReference[]
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
}

const MarkdownImageArtifactContext = createContext<MarkdownImageArtifactContextValue>({ images: [] })

type PreviewState = {
  urls: Record<string, string>
  failures: Record<string, string>
  paths: Record<string, string>
}

type PreviewRequest =
  | { key: string; id: string; mode: 'attachment' }
  | { key: string; path: string; mode: 'workspace-image'; workspaceRoot?: string }

type ImageActionState = 'idle' | 'busy' | 'done' | 'error'

const ACTION_RESET_MS = 1600

function readString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readStringArray(raw: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    return value
      .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      .map((item) => item.trim())
  }
  return []
}

function readNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeWorkspaceCandidate(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  return normalized || undefined
}

function inferWorkspaceRootFromSciforgePath(value: string | undefined): string | undefined {
  const normalized = normalizeWorkspaceCandidate(value)
  if (!normalized) return undefined
  const marker = '/.sciforge/'
  const index = normalized.lastIndexOf(marker)
  return index > 0 ? normalized.slice(0, index) : undefined
}

function hasAbsolutePathPrefix(value: string | undefined): boolean {
  return Boolean(value && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value)))
}

function parentWorkspaceRootFromSciforgeRoot(workspaceRoot: string | undefined): string | undefined {
  const normalized = normalizeWorkspaceCandidate(workspaceRoot)
  if (!normalized) return undefined
  if (normalized.endsWith('/.sciforge')) {
    const parent = normalized.slice(0, -'/.sciforge'.length)
    return parent || undefined
  }
  const marker = '/.sciforge/'
  const index = normalized.indexOf(marker)
  if (index <= 0) return undefined
  const parent = normalized.slice(0, index)
  return parent || undefined
}

function workspaceRootForPath(path: string | undefined, workspaceRoot: string | undefined): string | undefined {
  const normalizedRoot = normalizeWorkspaceCandidate(workspaceRoot)
  const normalizedPath = normalizeWorkspaceCandidate(path)
  if (!normalizedPath) return normalizedRoot

  const inferredFromSciforgePath = inferWorkspaceRootFromSciforgePath(normalizedPath)
  if (inferredFromSciforgePath) return inferredFromSciforgePath

  if (!normalizedRoot) return undefined

  const sciforgeParent = parentWorkspaceRootFromSciforgeRoot(normalizedRoot)
  if (sciforgeParent) {
    if (!hasAbsolutePathPrefix(normalizedPath)) return sciforgeParent
    if (normalizedPath === sciforgeParent || normalizedPath.startsWith(`${sciforgeParent}/`)) return sciforgeParent
  }

  return normalizedRoot
}

function pathBelongsToWorkspace(path: string | undefined, workspaceRoot: string | undefined): boolean {
  const normalizedPath = normalizeWorkspaceCandidate(path)
  const normalizedRoot = normalizeWorkspaceCandidate(workspaceRoot)
  if (!normalizedPath || !normalizedRoot) return false
  if (!hasAbsolutePathPrefix(normalizedPath)) return true
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function inferWorkspaceRootFromRecord(
  raw: Record<string, unknown>,
  fallback?: Partial<Pick<TimelineImageReference, 'workspaceRoot'>>
): string | undefined {
  const explicit = normalizeWorkspaceCandidate(readString(raw, 'workspaceRoot', 'workspace_root') ?? fallback?.workspaceRoot)
  const pathCandidate = [
    'artifactManifestPath',
    'artifact_manifest_path',
    'canvasDir',
    'canvasPath',
    'assetFile',
    'manifestPath',
    'manifest_path',
    'outputPath',
    'output_path',
    'sourcePath',
    'source_path',
    'previewPath',
    'preview_path',
    'renderedPagePath',
    'rendered_page_path',
    'svgPath',
    'svg_path',
    'pptxPath',
    'pptx_path',
    'path',
    'file'
  ]
    .map((key) => readString(raw, key))
    .find(Boolean)

  const normalizedExplicit = workspaceRootForPath(pathCandidate, explicit)
  if (normalizedExplicit) return normalizedExplicit

  for (const key of [
    'artifactManifestPath',
    'artifact_manifest_path',
    'canvasDir',
    'canvasPath',
    'assetFile',
    'manifestPath',
    'manifest_path'
  ]) {
    const inferred = inferWorkspaceRootFromSciforgePath(readString(raw, key))
    if (inferred) return inferred
  }
  return undefined
}

function readCanvasArtifactKind(raw: Record<string, unknown>): TimelineImageCanvasArtifact['artifactKind'] | undefined {
  const value = readString(raw, 'artifactKind', 'artifact_kind')
  return value === 'image' ||
    value === 'generated_image' ||
    value === 'edited_image' ||
    value === 'scientific_plot' ||
    value === 'ppt_slide' ||
    value === 'ppt_export'
    ? value
    : undefined
}

function readImageArtifactKind(raw: Record<string, unknown>): TimelineImageReference['artifactKind'] | undefined {
  const value = readCanvasArtifactKind(raw)
  return value === 'image' || value === 'generated_image' || value === 'edited_image' || value === 'scientific_plot'
    ? value
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeGeneratedFileReference(entry: unknown): TimelineImageReference | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const id = readString(raw, 'id', 'attachmentId')
  const name = readString(raw, 'name', 'fileName', 'filename')
  const fileName = readString(raw, 'fileName', 'filename')
  const mimeType = readString(raw, 'mimeType', 'type', 'mediaType')
  const previewUrl = readString(raw, 'previewUrl', 'dataUrl', 'url')
  const dataUrl = readString(raw, 'dataUrl')
  const url = readString(raw, 'url')
  const outputPath = readString(raw, 'outputPath', 'output_path')
  const sourcePath = readString(raw, 'sourcePath', 'source_path')
  const path = readString(raw, 'path', 'file') ?? outputPath ?? sourcePath
  const relativePath = readString(raw, 'relativePath', 'relative_path')
  const absolutePath = readString(raw, 'absolutePath', 'absolute_path')
  const manifestPath = readString(raw, 'manifestPath', 'manifest_path')
  const artifactManifestPath = readString(raw, 'artifactManifestPath', 'artifact_manifest_path')
  const diagramSpecPath = readString(raw, 'diagramSpecPath', 'diagram_spec_path')
  const frameworkDesignPlanPath = readString(raw, 'frameworkDesignPlanPath', 'framework_design_plan_path')
  const diagramLayerManifestPath = readString(raw, 'diagramLayerManifestPath', 'diagram_layer_manifest_path')
  const fastSamSegmentationPath = readString(raw, 'fastSamSegmentationPath', 'fast_sam_segmentation_path')
  const fastSamBoxlibPath = readString(raw, 'fastSamBoxlibPath', 'fast_sam_boxlib_path')
  const fastSamPreviewPath = readString(raw, 'fastSamPreviewPath', 'fast_sam_preview_path')
  const frameworkComponentManifestPath = readString(raw, 'frameworkComponentManifestPath', 'framework_component_manifest_path')
  const componentBasePath = readString(raw, 'componentBasePath', 'component_base_path')
  const componentAssetPaths = readStringArray(raw, 'componentAssetPaths', 'component_asset_paths')
  const artifactKind = readImageArtifactKind(raw)
  const sourceTool = readString(raw, 'sourceTool', 'source_tool')
  const canvasId = readString(raw, 'canvasId', 'canvas_id')
  const threadId = readString(raw, 'threadId', 'thread_id')
  const workspaceRoot = inferWorkspaceRootFromRecord(raw)
  const caption = readString(raw, 'caption')
  const byteSize = readNumber(raw, 'byteSize')
  const width = readNumber(raw, 'width')
  const height = readNumber(raw, 'height')
  const normalized: TimelineImageReference = {
    source: 'generated',
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(byteSize ? { byteSize } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(absolutePath ? { absolutePath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(artifactManifestPath ? { artifactManifestPath } : {}),
    ...(diagramSpecPath ? { diagramSpecPath } : {}),
    ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
    ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
    ...(fastSamSegmentationPath ? { fastSamSegmentationPath } : {}),
    ...(fastSamBoxlibPath ? { fastSamBoxlibPath } : {}),
    ...(fastSamPreviewPath ? { fastSamPreviewPath } : {}),
    ...(frameworkComponentManifestPath ? { frameworkComponentManifestPath } : {}),
    ...(componentBasePath ? { componentBasePath } : {}),
    ...(componentAssetPaths.length ? { componentAssetPaths } : {}),
    ...(artifactKind ? { artifactKind } : {}),
    ...(sourceTool ? { sourceTool } : {}),
    ...(canvasId ? { canvasId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(caption ? { caption } : {})
  }
  return isImageReference(normalized) ? normalized : null
}

function normalizeAttachmentReference(entry: AttachmentReference): TimelineImageReference | null {
  const normalized: TimelineImageReference = {
    source: 'attachment',
    id: entry.id,
    ...(entry.name ? { name: entry.name } : {}),
    ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
    ...(entry.byteSize ? { byteSize: entry.byteSize } : {}),
    ...(entry.width ? { width: entry.width } : {}),
    ...(entry.height ? { height: entry.height } : {}),
    ...(entry.previewUrl ? { previewUrl: entry.previewUrl } : {}),
    ...(entry.path ? { path: entry.path } : {}),
    ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
    ...(entry.absolutePath ? { absolutePath: entry.absolutePath } : {})
  }
  return isImageReference(normalized) || !normalized.mimeType ? normalized : null
}

function arrayFromMeta(meta: Record<string, unknown> | undefined, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = meta?.[key]
    if (Array.isArray(value)) return value
  }
  return []
}

export function imageAttachmentsFromMeta(meta: RuntimeDisclosureMetadata | undefined): AttachmentReference[] {
  const byId = new Map<string, AttachmentReference>()
  for (const entry of meta?.attachments ?? []) {
    if (entry.id?.trim()) byId.set(entry.id.trim(), entry)
  }
  for (const id of meta?.attachmentIds ?? []) {
    const normalizedId = id.trim()
    if (normalizedId && !byId.has(normalizedId)) byId.set(normalizedId, { id: normalizedId })
  }
  return [...byId.values()]
}


function maybeImageGenerationToolName(meta: Record<string, unknown> | undefined): boolean {
  const toolName = typeof meta?.toolName === 'string' ? meta.toolName.trim() : ''
  return toolName === 'image_generation_render' ||
    toolName === 'image_generation_edit_from_canvas_packet' ||
    toolName.endsWith('_image_generation_render') ||
    toolName.endsWith('_image_generation_edit_from_canvas_packet')
}

function maybeScientificPlottingToolName(meta: Record<string, unknown> | undefined): boolean {
  const toolName = typeof meta?.toolName === 'string' ? meta.toolName.trim() : ''
  return toolName === 'scientific_plotting_render' || toolName.endsWith('_scientific_plotting_render')
}

function maybePptMasterExportToolName(meta: Record<string, unknown> | undefined): boolean {
  const toolName = typeof meta?.toolName === 'string' ? meta.toolName.trim() : ''
  return toolName === 'ppt_master_export_pptx' || toolName.endsWith('_ppt_master_export_pptx')
}

function chooseWorkspaceRootForMergedImage(
  existing: TimelineImageReference,
  incoming: TimelineImageReference,
  path: string | undefined
): string | undefined {
  const existingRoot = normalizeWorkspaceCandidate(existing.workspaceRoot)
  const incomingRoot = normalizeWorkspaceCandidate(incoming.workspaceRoot)
  if (!existingRoot) return incomingRoot
  if (!incomingRoot) return existingRoot
  const existingMatches = pathBelongsToWorkspace(path, existingRoot)
  const incomingMatches = pathBelongsToWorkspace(path, incomingRoot)
  if (incomingMatches && !existingMatches) return incomingRoot
  return existingRoot
}

function mergeTimelineImageReference(
  existing: TimelineImageReference,
  incoming: TimelineImageReference
): TimelineImageReference {
  const merged = { ...existing, ...incoming }
  const mergedPath = imagePath(merged) ?? imagePath(incoming) ?? imagePath(existing)
  const workspaceRoot = chooseWorkspaceRootForMergedImage(existing, incoming, mergedPath)
  return {
    ...merged,
    ...(workspaceRoot ? { workspaceRoot } : {})
  }
}

function addUniqueImage(images: TimelineImageReference[], indexByKey: Map<string, number>, image: TimelineImageReference | null): void {
  if (!image) return
  const key = imageKey(image)
  const existing = indexByKey.get(key)
  if (existing !== undefined) {
    images[existing] = mergeTimelineImageReference(images[existing], image)
    return
  }
  indexByKey.set(key, images.length)
  images.push(image)
}

function addUniqueCanvasArtifact(
  artifacts: TimelineCanvasArtifactReference[],
  indexByKey: Map<string, number>,
  artifact: TimelineCanvasArtifactReference | null
): void {
  if (!artifact) return
  const key = canvasArtifactKey(artifact)
  const existing = indexByKey.get(key)
  if (existing !== undefined) {
    artifacts[existing] = { ...artifacts[existing], ...artifact }
    return
  }
  indexByKey.set(key, artifacts.length)
  artifacts.push(artifact)
}

function artifactImageFromRecord(record: Record<string, unknown>, fallback: Partial<TimelineImageReference> = {}): TimelineImageReference | null {
  const artifactKind = readImageArtifactKind(record) ?? fallback.artifactKind
  const isImageArtifact = artifactKind === 'image' ||
    artifactKind === 'generated_image' ||
    artifactKind === 'edited_image' ||
    artifactKind === 'scientific_plot'
  const outputPath = readString(record, 'outputPath', 'output_path') ?? fallback.outputPath
  const sourcePath = readString(record, 'sourcePath', 'source_path') ?? fallback.sourcePath
  const path = readString(record, 'path', 'file') ?? outputPath ?? sourcePath ?? fallback.path
  const manifestPath = readString(record, 'manifestPath', 'manifest_path') ?? fallback.manifestPath
  const artifactManifestPath = readString(record, 'artifactManifestPath', 'artifact_manifest_path') ?? fallback.artifactManifestPath
  const diagramSpecPath = readString(record, 'diagramSpecPath', 'diagram_spec_path') ?? fallback.diagramSpecPath
  const frameworkDesignPlanPath =
    readString(record, 'frameworkDesignPlanPath', 'framework_design_plan_path') ?? fallback.frameworkDesignPlanPath
  const diagramLayerManifestPath =
    readString(record, 'diagramLayerManifestPath', 'diagram_layer_manifest_path') ?? fallback.diagramLayerManifestPath
  const fastSamSegmentationPath =
    readString(record, 'fastSamSegmentationPath', 'fast_sam_segmentation_path') ?? fallback.fastSamSegmentationPath
  const fastSamBoxlibPath =
    readString(record, 'fastSamBoxlibPath', 'fast_sam_boxlib_path') ?? fallback.fastSamBoxlibPath
  const fastSamPreviewPath =
    readString(record, 'fastSamPreviewPath', 'fast_sam_preview_path') ?? fallback.fastSamPreviewPath
  const frameworkComponentManifestPath =
    readString(record, 'frameworkComponentManifestPath', 'framework_component_manifest_path') ?? fallback.frameworkComponentManifestPath
  const componentBasePath =
    readString(record, 'componentBasePath', 'component_base_path') ?? fallback.componentBasePath
  const componentAssetPaths = readStringArray(record, 'componentAssetPaths', 'component_asset_paths')
  const nextComponentAssetPaths = componentAssetPaths.length ? componentAssetPaths : fallback.componentAssetPaths
  const workspaceRoot = inferWorkspaceRootFromRecord(record, fallback)
  const id = readString(record, 'id') ?? fallback.id
  const name = readString(record, 'title', 'name', 'fileName', 'filename') ?? fallback.name
  const fileName = readString(record, 'fileName', 'filename') ?? fallback.fileName
  const mimeType = readString(record, 'mimeType', 'type', 'mediaType') ?? fallback.mimeType
  const caption = readString(record, 'caption') ?? fallback.caption
  const sourceTool = readString(record, 'sourceTool', 'source_tool') ?? fallback.sourceTool ?? 'image_generation'
  const canvasId = readString(record, 'canvasId', 'canvas_id') ?? fallback.canvasId
  const threadId = readString(record, 'threadId', 'thread_id') ?? fallback.threadId
  const byteSize = readNumber(record, 'byteSize') ?? fallback.byteSize
  const width = readNumber(record, 'width') ?? fallback.width
  const height = readNumber(record, 'height') ?? fallback.height
  if (!path && !outputPath && !sourcePath) return null
  if (!isImageArtifact && !artifactManifestPath && !manifestPath) return null
  const normalizedPath = path ?? outputPath ?? sourcePath
  const image: TimelineImageReference = {
    source: 'generated',
    ...fallback,
    artifactKind: artifactKind ?? 'image',
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(byteSize ? { byteSize } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(normalizedPath ? { path: normalizedPath } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(artifactManifestPath ? { artifactManifestPath } : {}),
    ...(diagramSpecPath ? { diagramSpecPath } : {}),
    ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
    ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
    ...(fastSamSegmentationPath ? { fastSamSegmentationPath } : {}),
    ...(fastSamBoxlibPath ? { fastSamBoxlibPath } : {}),
    ...(fastSamPreviewPath ? { fastSamPreviewPath } : {}),
    ...(frameworkComponentManifestPath ? { frameworkComponentManifestPath } : {}),
    ...(componentBasePath ? { componentBasePath } : {}),
    ...(nextComponentAssetPaths?.length ? { componentAssetPaths: nextComponentAssetPaths } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    sourceTool,
    ...(caption ? { caption } : {}),
    ...(canvasId ? { canvasId } : {}),
    ...(threadId ? { threadId } : {})
  }
  return isImageReference(image) ? image : null
}

function collectImageArtifactsFromValue(
  value: unknown,
  images: TimelineImageReference[],
  indexByKey: Map<string, number>,
  options: { imageGenerationTool: boolean; scientificPlottingTool: boolean; fallbackKind?: 'generated_image' | 'edited_image' | 'scientific_plot' },
  depth = 0
): void {
  if (depth > 5) return
  if (Array.isArray(value)) {
    for (const entry of value) collectImageArtifactsFromValue(entry, images, indexByKey, options, depth + 1)
    return
  }
  const record = asRecord(value)
  if (!record) return

  const artifactKind = readImageArtifactKind(record) ?? options.fallbackKind
  const outputPath = readString(record, 'outputPath', 'output_path')
  const artifactManifestPath = readString(record, 'artifactManifestPath', 'artifact_manifest_path')
  const manifestPath = readString(record, 'manifestPath', 'manifest_path')
  if (
    artifactKind === 'generated_image' ||
    artifactKind === 'edited_image' ||
    artifactKind === 'scientific_plot' ||
    artifactKind === 'image' ||
    (options.imageGenerationTool && (outputPath || artifactManifestPath || manifestPath)) ||
    (options.scientificPlottingTool && (outputPath || artifactManifestPath || manifestPath))
  ) {
    addUniqueImage(images, indexByKey, artifactImageFromRecord(record, {
      artifactKind: artifactKind ?? options.fallbackKind ?? (options.scientificPlottingTool ? 'scientific_plot' : 'generated_image'),
      sourceTool: options.scientificPlottingTool ? 'scientific_plotting' : 'image_generation',
      workspaceRoot: inferWorkspaceRootFromRecord(record)
    }))
  }

  const parentWorkspaceRoot = inferWorkspaceRootFromRecord(record)

  const result = record.result
  if (result !== undefined) collectImageArtifactsFromValue(result, images, indexByKey, options, depth + 1)
  const structuredContent = record.structuredContent
  if (structuredContent !== undefined) collectImageArtifactsFromValue(structuredContent, images, indexByKey, options, depth + 1)
  const output = record.output
  if (output !== undefined) collectImageArtifactsFromValue(output, images, indexByKey, options, depth + 1)
  const content = record.content
  if (content !== undefined) collectImageArtifactsFromValue(content, images, indexByKey, options, depth + 1)
  const generatedFiles = record.generatedFiles
  if (generatedFiles !== undefined) collectImageArtifactsFromValue(generatedFiles, images, indexByKey, options, depth + 1)
  const generatedImages = record.generatedImages
  if (generatedImages !== undefined) collectImageArtifactsFromValue(generatedImages, images, indexByKey, options, depth + 1)
  const outputs = record.outputs
  if (outputs !== undefined) collectImageArtifactsFromValue(outputs, images, indexByKey, { ...options, fallbackKind: 'edited_image' }, depth + 1)
  const artifact = record.artifact
  const artifactRecord = asRecord(artifact)
  if (artifactRecord) {
    addUniqueImage(images, indexByKey, artifactImageFromRecord(artifactRecord, {
      canvasId: readString(record, 'canvasId', 'canvas_id'),
      threadId: readString(record, 'threadId', 'thread_id'),
      sourceTool: readString(record, 'sourceTool', 'source_tool'),
      workspaceRoot: parentWorkspaceRoot
    }))
  }
  if (artifact !== undefined) collectImageArtifactsFromValue(artifact, images, indexByKey, options, depth + 1)
  const artifacts = record.artifacts
  if (Array.isArray(artifacts)) {
    const fallback = {
      canvasId: readString(record, 'canvasId', 'canvas_id'),
      threadId: readString(record, 'threadId', 'thread_id'),
      sourceTool: readString(record, 'sourceTool', 'source_tool'),
      workspaceRoot: parentWorkspaceRoot
    }
    for (const entry of artifacts) {
      const entryRecord = asRecord(entry)
      if (entryRecord) addUniqueImage(images, indexByKey, artifactImageFromRecord(entryRecord, fallback))
    }
  }
  if (artifacts !== undefined) collectImageArtifactsFromValue(artifacts, images, indexByKey, options, depth + 1)

  if (typeof record.text === 'string') {
    for (const parsed of parseJsonValuesFromText(record.text)) {
      collectImageArtifactsFromValue(parsed, images, indexByKey, options, depth + 1)
    }
  }
}

function canvasArtifactFromRecord(
  record: Record<string, unknown>,
  fallback: Partial<TimelineCanvasArtifactReference> = {},
  options: { pptMasterTool: boolean }
): TimelineCanvasArtifactReference | null {
  const explicitKind = readCanvasArtifactKind(record)
  const pptxPath = readString(record, 'pptxPath', 'pptx_path') ?? fallback.pptxPath
  const svgPath = readString(record, 'svgPath', 'svg_path') ?? fallback.svgPath
  const outputPath = readString(record, 'outputPath', 'output_path') ?? fallback.outputPath
  const sourcePath = readString(record, 'sourcePath', 'source_path') ?? fallback.sourcePath
  const previewPath = readString(record, 'previewPath', 'preview_path') ?? fallback.previewPath
  const renderedPagePath = readString(record, 'renderedPagePath', 'rendered_page_path') ?? fallback.renderedPagePath
  const artifactManifestPath = readString(record, 'artifactManifestPath', 'artifact_manifest_path') ?? fallback.artifactManifestPath
  const manifestPath = readString(record, 'manifestPath', 'manifest_path') ?? fallback.manifestPath
  const diagramSpecPath = readString(record, 'diagramSpecPath', 'diagram_spec_path') ?? fallback.diagramSpecPath
  const frameworkDesignPlanPath =
    readString(record, 'frameworkDesignPlanPath', 'framework_design_plan_path') ?? fallback.frameworkDesignPlanPath
  const diagramLayerManifestPath =
    readString(record, 'diagramLayerManifestPath', 'diagram_layer_manifest_path') ?? fallback.diagramLayerManifestPath
  const projectPath = readString(record, 'projectPath', 'project_path') ?? fallback.projectPath
  const workspaceRoot = inferWorkspaceRootFromRecord(record, fallback)
  const path = readString(record, 'path', 'file') ?? fallback.path ?? outputPath ?? sourcePath ?? previewPath ?? renderedPagePath ?? svgPath ?? pptxPath
  const id = readString(record, 'id')
  const caption = readString(record, 'caption') ?? fallback.caption
  const sourceTool = readString(record, 'sourceTool', 'source_tool') ?? fallback.sourceTool ?? 'ppt_master'
  const canvasId = readString(record, 'canvasId', 'canvas_id') ?? fallback.canvasId
  const threadId = readString(record, 'threadId', 'thread_id') ?? fallback.threadId
  const inferredKind =
    explicitKind ??
    fallback.artifactKind ??
    (options.pptMasterTool && (pptxPath || artifactManifestPath || path?.toLowerCase().endsWith('.pptx'))
      ? 'ppt_export'
      : undefined)

  if (inferredKind !== 'ppt_export' && inferredKind !== 'ppt_slide') return null
  if (inferredKind === 'ppt_export' && !pptxPath && !sourcePath && !path) return null
  if (inferredKind === 'ppt_slide' && !svgPath && !outputPath && !sourcePath && !path) return null

  const title = readString(record, 'title', 'name', 'fileName', 'filename') ??
    fallback.title ??
    fallback.name ??
    path?.split(/[\\/]/).filter(Boolean).at(-1) ??
    (inferredKind === 'ppt_export' ? 'PPT export' : 'PPT slide')
  const slideIndex = readNumber(record, 'slideIndex') ?? fallback.slideIndex

  return {
    artifactKind: inferredKind,
    ...(path ? { path } : {}),
    ...(id ? { id } : {}),
    ...(title ? { title, name: title } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(previewPath ? { previewPath } : {}),
    ...(renderedPagePath ? { renderedPagePath } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(artifactManifestPath ? { artifactManifestPath } : {}),
    ...(diagramSpecPath ? { diagramSpecPath } : {}),
    ...(frameworkDesignPlanPath ? { frameworkDesignPlanPath } : {}),
    ...(diagramLayerManifestPath ? { diagramLayerManifestPath } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(svgPath ? { svgPath } : {}),
    ...(pptxPath ? { pptxPath } : {}),
    ...(slideIndex !== undefined ? { slideIndex } : {}),
    ...(caption ? { caption } : {}),
    sourceTool,
    ...(canvasId ? { canvasId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {})
  }
}

function collectCanvasArtifactsFromValue(
  value: unknown,
  artifacts: TimelineCanvasArtifactReference[],
  indexByKey: Map<string, number>,
  options: { pptMasterTool: boolean },
  depth = 0
): void {
  if (depth > 5) return
  if (Array.isArray(value)) {
    for (const entry of value) collectCanvasArtifactsFromValue(entry, artifacts, indexByKey, options, depth + 1)
    return
  }
  const record = asRecord(value)
  if (!record) return

  addUniqueCanvasArtifact(artifacts, indexByKey, canvasArtifactFromRecord(record, {}, options))

  for (const key of ['result', 'structuredContent', 'output', 'content', 'generatedFiles', 'outputs', 'artifact', 'artifacts']) {
    const nested = record[key]
    if (nested !== undefined) collectCanvasArtifactsFromValue(nested, artifacts, indexByKey, options, depth + 1)
  }

  if (typeof record.text === 'string') {
    for (const parsed of parseJsonValuesFromText(record.text)) {
      collectCanvasArtifactsFromValue(parsed, artifacts, indexByKey, options, depth + 1)
    }
  }
}

function parseJsonValuesFromText(text: string | undefined): unknown[] {
  if (!text?.trim()) return []
  const trimmed = text.trim()
  const values: unknown[] = []
  try {
    values.push(JSON.parse(trimmed))
    return values
  } catch {
    // Tool text often contains a short sentence followed by a formatted JSON object.
  }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try {
      values.push(JSON.parse(trimmed.slice(first, last + 1)))
    } catch {
      // Ignore non-JSON tool prose.
    }
  }
  return values
}

export function timelineImagesFromToolBlock(block: TimelineToolImageBlock): TimelineImageReference[] {
  const images: TimelineImageReference[] = []
  const indexByKey = new Map<string, number>()
  for (const image of timelineImagesFromMeta(block.meta)) addUniqueImage(images, indexByKey, image)
  const imageGenerationTool = maybeImageGenerationToolName(block.meta)
  const scientificPlottingTool = maybeScientificPlottingToolName(block.meta)
  collectImageArtifactsFromValue(block.meta, images, indexByKey, { imageGenerationTool, scientificPlottingTool })
  for (const parsed of parseJsonValuesFromText(block.detail)) {
    collectImageArtifactsFromValue(parsed, images, indexByKey, { imageGenerationTool, scientificPlottingTool })
  }
  for (const parsed of parseJsonValuesFromText(block.summary)) {
    collectImageArtifactsFromValue(parsed, images, indexByKey, { imageGenerationTool, scientificPlottingTool })
  }
  return images.filter((image) => isImageReference(image) || (image.source === 'attachment' && Boolean(image.id)))
}

export function timelineImagesFromToolBlocks(blocks: TimelineToolImageBlock[]): TimelineImageReference[] {
  const images: TimelineImageReference[] = []
  const indexByKey = new Map<string, number>()
  for (const block of blocks) {
    for (const image of timelineImagesFromToolBlock(block)) {
      addUniqueImage(images, indexByKey, image)
    }
  }
  return images
}

export function timelineCanvasArtifactsFromToolBlock(block: TimelineToolImageBlock): TimelineImageCanvasArtifact[] {
  const artifacts: TimelineCanvasArtifactReference[] = []
  const indexByKey = new Map<string, number>()
  const pptMasterTool = maybePptMasterExportToolName(block.meta)

  collectCanvasArtifactsFromValue(block.meta, artifacts, indexByKey, { pptMasterTool })
  for (const parsed of parseJsonValuesFromText(block.detail)) {
    collectCanvasArtifactsFromValue(parsed, artifacts, indexByKey, { pptMasterTool })
  }
  for (const parsed of parseJsonValuesFromText(block.summary)) {
    collectCanvasArtifactsFromValue(parsed, artifacts, indexByKey, { pptMasterTool })
  }

  return artifacts.map(({ id: _id, name: _name, path: _path, byteSize: _byteSize, ...artifact }) => artifact)
}

export function timelineImagesFromMeta(meta: Record<string, unknown> | undefined): TimelineImageReference[] {
  const runtimeMeta = meta as RuntimeDisclosureMetadata | undefined
  const images: TimelineImageReference[] = []
  const indexByKey = new Map<string, number>()
  const add = (image: TimelineImageReference | null): void => {
    addUniqueImage(images, indexByKey, image)
  }

  for (const attachment of imageAttachmentsFromMeta(runtimeMeta)) {
    add(normalizeAttachmentReference(attachment))
  }
  for (const entry of [
    ...arrayFromMeta(meta, 'generatedFiles'),
    ...arrayFromMeta(meta, 'generatedImages'),
    ...arrayFromMeta(meta, 'images')
  ]) {
    add(normalizeGeneratedFileReference(entry))
  }
  return images.filter((image) => isImageReference(image) || (image.source === 'attachment' && Boolean(image.id)))
}

function normalizeImageLookupPath(value: string | undefined): string | undefined {
  const normalized = normalizeWorkspaceCandidate(value)
  if (!normalized) return undefined
  return normalized.replace(/^file:\/\//i, '').replace(/^\.\//, '')
}

function imageLookupCandidates(image: TimelineImageReference): string[] {
  const values = [
    image.absolutePath,
    image.path,
    image.outputPath,
    image.sourcePath,
    image.relativePath,
    image.manifestPath,
    image.artifactManifestPath,
    image.name,
    image.fileName
  ]
  return [...new Set(values.map(normalizeImageLookupPath).filter((value): value is string => Boolean(value)))]
}

function pathBaseName(path: string | undefined): string | undefined {
  const normalized = normalizeImageLookupPath(path)
  return normalized?.split('/').filter(Boolean).at(-1)
}

function findMarkdownImageArtifactMatch(
  markdownPath: string | undefined,
  images: TimelineImageReference[]
): TimelineImageReference | null {
  const normalizedPath = normalizeImageLookupPath(markdownPath)
  if (!normalizedPath || hasAbsolutePathPrefix(normalizedPath)) return null
  const exactOrSuffix = images.find((image) =>
    imageLookupCandidates(image).some((candidate) =>
      candidate === normalizedPath || candidate.endsWith(`/${normalizedPath}`)
    )
  )
  if (exactOrSuffix) return exactOrSuffix

  const markdownBaseName = pathBaseName(normalizedPath)
  if (!markdownBaseName) return null
  const basenameMatches = images.filter((image) =>
    imageLookupCandidates(image).some((candidate) => pathBaseName(candidate) === markdownBaseName)
  )
  return basenameMatches.length === 1 ? basenameMatches[0] : null
}

export function resolveMarkdownImageReference(
  image: TimelineImageReference,
  contextImages: TimelineImageReference[]
): TimelineImageReference {
  const src = imagePath(image)
  if (!src || rawPreviewUrl(image) || hasAbsolutePathPrefix(src)) return image
  const matched = findMarkdownImageArtifactMatch(src, contextImages)
  if (!matched) return image
  const matchedPath = imagePath(matched)
  return mergeTimelineImageReference(
    matched,
    {
      ...image,
      ...(image.name ? { name: image.name } : matched.name ? { name: matched.name } : {}),
      ...(image.fileName ? { fileName: image.fileName } : matched.fileName ? { fileName: matched.fileName } : {}),
      ...(matchedPath ? { path: matchedPath } : {})
    }
  )
}

function imageKey(image: TimelineImageReference): string {
  return (
    image.id ||
    image.absolutePath ||
    image.path ||
    image.relativePath ||
    image.previewUrl ||
    image.dataUrl ||
    image.url ||
    image.name ||
    image.fileName ||
    'image'
  )
}

function canvasArtifactKey(artifact: TimelineCanvasArtifactReference | TimelineImageCanvasArtifact): string {
  return (
    artifact.artifactManifestPath ||
    artifact.diagramLayerManifestPath ||
    artifact.diagramSpecPath ||
    artifact.frameworkDesignPlanPath ||
    artifact.manifestPath ||
    artifact.previewPath ||
    artifact.renderedPagePath ||
    artifact.outputPath ||
    artifact.sourcePath ||
    artifact.svgPath ||
    artifact.pptxPath ||
    artifact.title ||
    artifact.caption ||
    artifact.artifactKind
  )
}

function canvasArtifactTitle(artifact: TimelineImageCanvasArtifact): string {
  const fromPath = [
    artifact.pptxPath,
    artifact.svgPath,
    artifact.outputPath,
    artifact.sourcePath,
    artifact.previewPath,
    artifact.renderedPagePath,
    artifact.manifestPath,
    artifact.artifactManifestPath,
    artifact.diagramLayerManifestPath,
    artifact.diagramSpecPath,
    artifact.frameworkDesignPlanPath
  ].find(Boolean)?.split(/[\\/]/).filter(Boolean).at(-1)
  return artifact.title || fromPath || (artifact.artifactKind === 'ppt_export' ? 'PPT export' : 'artifact')
}

function canvasArtifactSubtitle(artifact: TimelineImageCanvasArtifact): string {
  if (artifact.artifactKind === 'ppt_export') return 'PPTX export'
  if (artifact.artifactKind === 'ppt_slide') return 'PPT slide'
  if (artifact.artifactKind === 'scientific_plot') return 'Scientific plot'
  if (artifact.artifactKind === 'generated_image') return 'Generated image'
  if (artifact.artifactKind === 'edited_image') return 'Edited image'
  return 'Canvas artifact'
}

function imageTitle(image: TimelineImageReference): string {
  const fromPath = imagePath(image)?.split(/[\\/]/).filter(Boolean).at(-1)
  return image.name || image.fileName || fromPath || image.id || 'image'
}

function imagePath(image: TimelineImageReference): string | undefined {
  return image.absolutePath || image.path || image.outputPath || image.sourcePath || image.relativePath
}

function imageCanvasArtifact(image: TimelineImageReference, resolvedPath?: string): TimelineImageCanvasArtifact | null {
  const artifactKind = image.artifactKind === 'generated_image' ||
    image.artifactKind === 'edited_image' ||
    image.artifactKind === 'scientific_plot' ||
    image.artifactKind === 'image'
    ? image.artifactKind
    : image.source === 'generated'
      ? 'image'
      : null
  const source = resolvedPath || image.outputPath || image.sourcePath || imagePath(image)
  if (!artifactKind || !source) return null
  const workspaceRoot = workspaceRootForPath(source, image.workspaceRoot)
  return {
    artifactKind,
    outputPath: image.outputPath || source,
    sourcePath: image.sourcePath,
    manifestPath: image.manifestPath,
    artifactManifestPath: image.artifactManifestPath,
    diagramSpecPath: image.diagramSpecPath,
    frameworkDesignPlanPath: image.frameworkDesignPlanPath,
    diagramLayerManifestPath: image.diagramLayerManifestPath,
    title: imageTitle(image),
    caption: image.caption,
    sourceTool: image.sourceTool,
    canvasId: image.canvasId,
    threadId: image.threadId,
    workspaceRoot
  }
}

function rawPreviewUrl(image: TimelineImageReference): string | undefined {
  return image.previewUrl || image.dataUrl || image.url
}

function isSafePreviewUrl(value: string | undefined): boolean {
  return normalizeSafeEmbeddedMediaUrl(value) !== null
}

function isImageReference(image: TimelineImageReference): boolean {
  if (isSafeEmbeddedMediaMimeType(image.mimeType)) return true
  const sources = [
    image.name,
    image.fileName,
    image.path,
    image.outputPath,
    image.sourcePath,
    image.relativePath,
    image.absolutePath,
    image.url
  ]
  if (sources.some((source) => hasSafeEmbeddedMediaExtension(source))) return true
  return isSafePreviewUrl(rawPreviewUrl(image))
}

function formatByteSize(byteSize: number | undefined): string {
  if (typeof byteSize !== 'number' || !Number.isFinite(byteSize) || byteSize <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = byteSize
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

async function downloadMediaUrl(url: string, fileName: string): Promise<void> {
  if (typeof document === 'undefined') throw new Error('Document is unavailable.')
  let href = url
  let revokeObjectUrl: (() => void) | undefined
  if (url.startsWith('data:') && typeof fetch === 'function' && typeof URL !== 'undefined') {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      href = URL.createObjectURL(blob)
      revokeObjectUrl = () => URL.revokeObjectURL(href)
    } catch {
      href = url
    }
  }
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => revokeObjectUrl?.(), 1000)
}

function usePreviewState(images: TimelineImageReference[]): PreviewState {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const globalWorkspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadWorkspace = useChatStore((s) =>
    s.activeThreadId ? s.threads.find((thread) => thread.id === s.activeThreadId)?.workspace ?? '' : ''
  )
  const workspaceRoot = activeThreadWorkspace || globalWorkspaceRoot
  const [state, setState] = useState<PreviewState>({ urls: {}, failures: {}, paths: {} })
  const requests = useMemo(() => {
    return images
      .map((image): PreviewRequest | null => {
        const key = imageKey(image)
        if (rawPreviewUrl(image) || state.urls[key] || state.failures[key]) return null
        const path = imagePath(image)
        if (path) {
          return {
            key,
            path,
            mode: 'workspace-image',
            workspaceRoot: workspaceRootForPath(path, image.workspaceRoot || workspaceRoot)
          }
        }
        if (image.source === 'attachment' && image.id) return { key, id: image.id, mode: 'attachment' }
        return null
      })
      .filter((request): request is PreviewRequest => request !== null)
  }, [images, state.failures, state.urls, workspaceRoot])
  const requestKey = requests
    .map((request) => request.mode === 'attachment' ? `attachment:${request.id}` : `path:${request.workspaceRoot ?? ''}:${request.path}`)
    .join('\n')

  useEffect(() => {
    if (!requestKey) return
    const provider = getProvider()
    let cancelled = false
    void Promise.all(requests.map(async (request) => {
      try {
        if (request.mode === 'attachment') {
          if (typeof provider.getAttachmentContent !== 'function') {
            return { key: request.key, failed: 'Attachment content is unavailable.' }
          }
          const content = await provider.getAttachmentContent(request.id, {
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspaceRoot ? { workspace: workspaceRoot } : {})
          })
          if (!isSafeEmbeddedMediaMimeType(content.attachment.mimeType)) {
            return { key: request.key, failed: 'Attachment is not an image.' }
          }
          const previewUrl = normalizeSafeEmbeddedMediaUrl(`data:${content.attachment.mimeType};base64,${content.dataBase64}`)
          if (!previewUrl) {
            return { key: request.key, failed: 'Attachment image type is not supported.' }
          }
          return {
            key: request.key,
            previewUrl,
            path: content.attachment.localFilePath
          }
        }

        if (typeof window.sciforge?.readWorkspaceImage !== 'function') {
          return { key: request.key, failed: 'Image reader is unavailable.' }
        }
        const result = await window.sciforge.readWorkspaceImage({
          path: request.path,
          ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {})
        })
        if (!result.ok) return { key: request.key, failed: result.message }
        return { key: request.key, previewUrl: result.dataUrl, path: result.path }
      } catch (error) {
        return {
          key: request.key,
          failed: error instanceof Error ? error.message : String(error)
        }
      }
    })).then((results) => {
      if (cancelled) return
      setState((current) => {
        const next: PreviewState = {
          urls: { ...current.urls },
          failures: { ...current.failures },
          paths: { ...current.paths }
        }
        for (const result of results) {
          if ('previewUrl' in result && typeof result.previewUrl === 'string') {
            next.urls[result.key] = result.previewUrl
            delete next.failures[result.key]
          }
          if ('path' in result && typeof result.path === 'string') {
            next.paths[result.key] = result.path
          }
          if ('failed' in result && typeof result.failed === 'string') {
            next.failures[result.key] = result.failed
          }
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeThreadId, requestKey, requests, workspaceRoot])

  return state
}

function TimelineImageTile({
  image,
  previewUrl,
  resolvedPath,
  failure,
  variant,
  onOpenCanvas
}: {
  image: TimelineImageReference
  previewUrl?: string
  resolvedPath?: string
  failure?: string
  variant: TimelineImageGalleryVariant
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [downloadState, setDownloadState] = useState<ImageActionState>('idle')
  const [copyState, setCopyState] = useState<ImageActionState>('idle')
  const [openState, setOpenState] = useState<ImageActionState>('idle')
  const title = imageTitle(image)
  const sourcePath = resolvedPath || imagePath(image)
  const sourceUrl = normalizeSafeRemoteEmbeddedMediaUrl(image.url) ?? undefined
  const rawUrl = rawPreviewUrl(image)
  const safeRawUrl = normalizeSafeEmbeddedMediaUrl(rawUrl) ?? undefined
  const src = safeRawUrl || previewUrl
  const copyValue = sourcePath || sourceUrl
  const byteSize = formatByteSize(image.byteSize)
  const metadata = [image.mimeType, byteSize].filter(Boolean).join(' | ')
  const canOpenOriginal = Boolean(sourcePath || sourceUrl)
  const canDownload = Boolean(src)
  const canCopy = Boolean(copyValue)
  const canvasArtifact = imageCanvasArtifact(image, resolvedPath)
  const canOpenCanvas = Boolean(canvasArtifact && onOpenCanvas)
  const tileClass =
    variant === 'conversation' || variant === 'assistant'
      ? 'h-48 w-full overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm sm:h-56'
      : variant === 'tool'
        ? 'h-32 w-40 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
        : 'h-28 w-36 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
  const iconButtonClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border-muted bg-ds-card/92 text-ds-muted shadow-sm backdrop-blur transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'

  useEffect(() => {
    if (downloadState === 'idle' && copyState === 'idle' && openState === 'idle') return
    const timer = window.setTimeout(() => {
      setDownloadState('idle')
      setCopyState('idle')
      setOpenState('idle')
    }, ACTION_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [copyState, downloadState, openState])

  const handleDownload = async (): Promise<void> => {
    if (!src) {
      setDownloadState('error')
      return
    }
    setDownloadState('busy')
    try {
      await downloadMediaUrl(src, title)
      setDownloadState('done')
    } catch {
      setDownloadState('error')
    }
  }

  const handlePrimaryOpen = (): void => {
    if (canvasArtifact && onOpenCanvas) {
      onOpenCanvas(canvasArtifact)
      return
    }
    setPreviewOpen(true)
  }

  const handleOpenOriginal = async (): Promise<void> => {
    if (!sourcePath && !sourceUrl) return
    setOpenState('busy')
    try {
      if (sourcePath) {
        const result = await openWorkspacePathInEditor(
          { path: sourcePath },
          workspaceRootForPath(sourcePath, image.workspaceRoot || workspaceRoot)
        )
        setOpenState(result.ok ? 'done' : 'error')
        return
      }
      if (await openSafeExternalUrl(sourceUrl)) {
        setOpenState('done')
        return
      }
      setOpenState('error')
    } catch {
      setOpenState('error')
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!copyValue || typeof navigator?.clipboard?.writeText !== 'function') {
      setCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(copyValue)
      setCopyState('done')
    } catch {
      setCopyState('error')
    }
  }

  const actionIcon = (state: ImageActionState, fallback: ReactElement): ReactElement => {
    if (state === 'busy') return <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
    if (state === 'done') return <Check className="h-3.5 w-3.5" strokeWidth={2} />
    return fallback
  }

  if (src) {
    return (
      <figure className={`${tileClass} group/image relative`} title={title}>
        <button
          type="button"
          onClick={handlePrimaryOpen}
          className={`block h-full w-full ${canOpenCanvas ? 'cursor-pointer' : 'cursor-zoom-in'} bg-ds-subtle`}
          title={canOpenCanvas ? t('imageOpenCanvasReview') : t('imagePreviewOpen', { name: title })}
          aria-label={canOpenCanvas ? t('imageOpenCanvasReview') : t('imagePreviewOpen', { name: title })}
        >
          <img src={src} alt={title} className="h-full w-full object-contain" loading="lazy" />
        </button>
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover/image:opacity-100 group-focus-within/image:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleDownload()
            }}
            disabled={!canDownload}
            title={t('generatedFileDownload')}
            aria-label={t('generatedFileDownload')}
            className={iconButtonClass}
          >
            {actionIcon(downloadState, <Download className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleOpenOriginal()
            }}
            disabled={!canOpenOriginal || openState === 'busy'}
            title={t('imageOpenOriginal')}
            aria-label={t('imageOpenOriginal')}
            className={iconButtonClass}
          >
            {actionIcon(openState, <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleCopy()
            }}
            disabled={!canCopy}
            title={copyState === 'done' ? t('copySuccess') : t('artifactCopyFilePath')}
            aria-label={copyState === 'done' ? t('copySuccess') : t('artifactCopyFilePath')}
            className={iconButtonClass}
          >
            {actionIcon(copyState, <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
        </div>
        {metadata ? (
          <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-ds-card/90 px-2 py-1 text-[11px] text-ds-faint opacity-0 transition group-hover/image:opacity-100">
            {metadata}
          </figcaption>
        ) : null}
        <ImagePreviewLightbox
          open={previewOpen}
          src={src}
          alt={title}
          title={title}
          downloadDisabled={!canDownload}
          downloadLabel={t('generatedFileDownload')}
          onDownload={handleDownload}
          onClose={() => setPreviewOpen(false)}
        />
      </figure>
    )
  }

  return (
    <div className={`${tileClass} flex flex-col justify-between p-3`} title={failure || title}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-subtle text-ds-muted">
          {failure ? (
            <TriangleAlert className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-[12.5px] font-semibold leading-5 text-ds-ink">
            {title}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-ds-faint">
            {failure || t('generatedFilePreviewUnavailable')}
          </div>
        </div>
      </div>
      {copyValue ? (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="mt-3 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-card/90 px-2 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {actionIcon(copyState, <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          {copyState === 'done' ? t('copySuccess') : t('artifactCopyFilePath')}
        </button>
      ) : null}
    </div>
  )
}

function TimelineCanvasArtifactTile({
  artifact,
  onOpenCanvas
}: {
  artifact: TimelineImageCanvasArtifact
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const [copyState, setCopyState] = useState<ImageActionState>('idle')
  const [openState, setOpenState] = useState<ImageActionState>('idle')
  const title = canvasArtifactTitle(artifact)
  const subtitle = canvasArtifactSubtitle(artifact)
  const sourcePath = artifact.pptxPath || artifact.svgPath || artifact.outputPath || artifact.sourcePath || artifact.previewPath || artifact.renderedPagePath
  const copyValue = artifact.artifactManifestPath || artifact.manifestPath || sourcePath
  const canOpenCanvas = Boolean(onOpenCanvas)
  const canOpenOriginal = Boolean(sourcePath) && artifact.artifactKind !== 'ppt_export'
  const iconButtonClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border-muted bg-ds-card/92 text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'

  useEffect(() => {
    if (copyState === 'idle' && openState === 'idle') return
    const timer = window.setTimeout(() => {
      setCopyState('idle')
      setOpenState('idle')
    }, ACTION_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [copyState, openState])

  const actionIcon = (state: ImageActionState, fallback: ReactElement): ReactElement => {
    if (state === 'busy') return <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
    if (state === 'done') return <Check className="h-3.5 w-3.5" strokeWidth={2} />
    return fallback
  }

  const handleOpenOriginal = async (): Promise<void> => {
    if (!sourcePath) return
    setOpenState('busy')
    try {
      const result = await openWorkspacePathInEditor(
        { path: sourcePath },
        workspaceRootForPath(sourcePath, artifact.workspaceRoot || workspaceRoot)
      )
      setOpenState(result.ok ? 'done' : 'error')
    } catch {
      setOpenState('error')
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!copyValue || typeof navigator?.clipboard?.writeText !== 'function') {
      setCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(copyValue)
      setCopyState('done')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <article className="group/artifact relative w-full max-w-2xl overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm">
      <button
        type="button"
        onClick={() => onOpenCanvas?.(artifact)}
        disabled={!canOpenCanvas}
        title={t('artifactOpenCanvasReview')}
        aria-label={t('artifactOpenCanvasReview')}
        className="flex w-full min-w-0 items-center gap-3 p-3 text-left transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-subtle text-ds-muted">
          <FileText className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ds-ink">{title}</span>
          <span className="mt-0.5 block truncate text-[12px] text-ds-faint">{subtitle}</span>
          {sourcePath ? (
            <span className="mt-1 block truncate font-mono text-[11px] text-ds-faint">{sourcePath}</span>
          ) : null}
        </span>
      </button>
      <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover/artifact:opacity-100 group-focus-within/artifact:opacity-100">
        {canOpenOriginal ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleOpenOriginal()
            }}
            disabled={openState === 'busy'}
            title={t('imageOpenOriginal')}
            aria-label={t('imageOpenOriginal')}
            className={iconButtonClass}
          >
            {actionIcon(openState, <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void handleCopy()
          }}
          disabled={!copyValue}
          title={copyState === 'done' ? t('copySuccess') : t('artifactCopyFilePath')}
          aria-label={copyState === 'done' ? t('copySuccess') : t('artifactCopyFilePath')}
          className={iconButtonClass}
        >
          {actionIcon(copyState, <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />)}
        </button>
      </div>
    </article>
  )
}

export function TimelineImageGallery({
  images,
  variant,
  onOpenCanvas
}: {
  images: TimelineImageReference[]
  variant: TimelineImageGalleryVariant
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
}): ReactElement | null {
  const previewState = usePreviewState(images)
  if (images.length === 0) return null
  const wrapperClass =
    variant === 'conversation'
      ? `grid w-full max-w-2xl grid-cols-1 gap-2 ${images.length > 1 ? 'sm:grid-cols-2' : ''}`
      : variant === 'assistant'
        ? `mt-3 grid w-full max-w-2xl grid-cols-1 gap-2 ${images.length > 1 ? 'sm:grid-cols-2' : ''}`
        : variant === 'tool'
          ? 'flex min-w-0 flex-wrap gap-2 border-t border-ds-border-muted/60 px-4 py-3'
          : 'flex max-w-[80%] flex-wrap justify-end gap-2'

  return (
    <div className={wrapperClass}>
      {images.map((image) => {
        const key = imageKey(image)
        return (
          <TimelineImageTile
            key={key}
            image={image}
            previewUrl={previewState.urls[key]}
            resolvedPath={previewState.paths[key]}
            failure={previewState.failures[key]}
            variant={variant}
            onOpenCanvas={onOpenCanvas}
          />
        )
      })}
    </div>
  )
}

export function TimelineImagesFromMeta({
  meta,
  variant,
  onOpenCanvas
}: {
  meta?: Record<string, unknown>
  variant: TimelineImageGalleryVariant
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
}): ReactElement | null {
  const images = useMemo(() => timelineImagesFromMeta(meta), [meta])
  return <TimelineImageGallery images={images} variant={variant} onOpenCanvas={onOpenCanvas} />
}

export function MarkdownImageArtifactProvider({
  images,
  onOpenCanvas,
  children
}: {
  images: TimelineImageReference[]
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
  children: ReactNode
}): ReactElement {
  const value = useMemo(() => ({ images, onOpenCanvas }), [images, onOpenCanvas])
  return (
    <MarkdownImageArtifactContext.Provider value={value}>
      {children}
    </MarkdownImageArtifactContext.Provider>
  )
}

export function TimelineImageResultsPanel({
  blocks,
  onOpenCanvas
}: {
  blocks: TimelineToolImageBlock[]
  onOpenCanvas?: (artifact: TimelineImageCanvasArtifact) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const images = useMemo(() => timelineImagesFromToolBlocks(blocks), [blocks])
  const artifacts = useMemo(() => {
    const byKey = new Map<string, TimelineImageCanvasArtifact>()
    for (const block of blocks) {
      for (const artifact of timelineCanvasArtifactsFromToolBlock(block)) {
        byKey.set(canvasArtifactKey(artifact), artifact)
      }
    }
    return [...byKey.values()]
  }, [blocks])

  if (images.length === 0 && artifacts.length === 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {images.length > 0 ? (
        <>
          <div className="text-[12px] font-semibold text-ds-faint">{t('generatedFilesTitle')}</div>
          <TimelineImageGallery images={images} variant="conversation" onOpenCanvas={onOpenCanvas} />
        </>
      ) : null}
      {artifacts.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="text-[12px] font-semibold text-ds-faint">{t('generatedArtifactsTitle')}</div>
          {artifacts.map((artifact) => (
            <TimelineCanvasArtifactTile
              key={canvasArtifactKey(artifact)}
              artifact={artifact}
              onOpenCanvas={onOpenCanvas}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

type MarkdownImageProps = ComponentPropsWithRef<'img'> & { node?: unknown }

export function AssistantMarkdownImage({
  src,
  alt,
  title,
  className
}: MarkdownImageProps): ReactElement {
  const image = useMemo<TimelineImageReference | null>(() => {
    if (!src) return null
    const value = String(src)
    const base: TimelineImageReference = {
      source: 'generated',
      ...(typeof alt === 'string' && alt.trim() ? { name: alt.trim() } : {}),
      ...(isSafePreviewUrl(value) ? { previewUrl: value } : { path: value })
    }
    return isImageReference(base) ? base : null
  }, [alt, src])
  const { images, onOpenCanvas } = useContext(MarkdownImageArtifactContext)
  const resolvedImage = useMemo(
    () => image ? resolveMarkdownImageReference(image, images) : null,
    [image, images]
  )

  if (!resolvedImage) {
    return <span className={className}>{alt || title || 'image'}</span>
  }

  return (
    <div className="my-3">
      <TimelineImageGallery images={[resolvedImage]} variant="assistant" onOpenCanvas={onOpenCanvas} />
    </div>
  )
}
