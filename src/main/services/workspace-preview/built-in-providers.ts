import { readFile } from 'node:fs/promises'
import {
  DOMMatrix,
  ImageData,
  Path2D,
  createCanvas,
  loadImage
} from '@napi-rs/canvas'
import {
  VISUAL_SOURCE_MAX_FRAME_BYTES,
  type NormalizedVisualRegion,
  type VisualFrame
} from '@sciforge/domain-sdk/visual-source'
import { createWorkspaceTabularService } from '@sciforge/workspace-tabular/service'
import type { WorkspaceTabularPreviewResult } from '@sciforge/workspace-tabular/contract'
import { createWorkspaceDeckService } from '@sciforge/workspace-deck/service'
import type { WorkspaceDeckPreviewResult } from '@sciforge/workspace-deck/contract'
import {
  DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
  DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
  HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
  IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
  MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
  PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
  TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID
} from '../../../shared/workspace-preview'
import {
  type WorkspacePreviewProviderApplyEditInput,
  type WorkspacePreviewProviderApplyEditResult,
  type WorkspacePreviewProviderExportInput,
  type WorkspacePreviewProviderExportResult,
  type WorkspacePreviewProviderFileValidationInput,
  type WorkspacePreviewProviderFileValidationResult,
  type WorkspacePreviewProviderActionInput,
  type WorkspacePreviewProviderActionResult,
  type WorkspacePreviewProviderObservationInput,
  type WorkspacePreviewProviderObservationResult,
  type WorkspacePreviewProviderVisualInput,
  type WorkspacePreviewProvider,
  type WorkspacePreviewProviderRegistrationInput
} from './provider-registry'

export const BUILT_IN_WORKSPACE_PREVIEW_PROVIDER_OWNER_ID = 'sciforge.workspace-preview'
const DEFAULT_VISUAL_MAX_DIMENSION = 4_096
const MAX_VISUAL_MAX_DIMENSION = 8_192
const MAX_VISUAL_PIXELS = 40_000_000
const PDF_JS_MODULE_SPECIFIER: string = 'pdfjs-dist/legacy/build/pdf.mjs'

export type BuiltInWorkspaceTabularPreviewResult = WorkspaceTabularPreviewResult
export type BuiltInWorkspaceDeckPreviewResult = WorkspaceDeckPreviewResult

export type WorkspacePreviewBuiltInHostProviderAdapters = Readonly<{
  validateTextFile(input: WorkspacePreviewProviderFileValidationInput): Promise<WorkspacePreviewProviderFileValidationResult>
  observeSourceText(
    input: WorkspacePreviewProviderObservationInput,
    hostActions: readonly string[]
  ): Promise<WorkspacePreviewProviderObservationResult>
  observeDocx(input: WorkspacePreviewProviderObservationInput): Promise<WorkspacePreviewProviderObservationResult>
  applyTextEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyTabularEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyDeckEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyDocumentEdit(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyAnnotationUpsert(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyAnnotationThreadUpdate(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  applyAnnotationThreadDelete(input: WorkspacePreviewProviderApplyEditInput): Promise<WorkspacePreviewProviderApplyEditResult>
  exportSource(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult>
  exportAnnotationSidecar(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult>
  exportAnnotatedPdf(input: WorkspacePreviewProviderExportInput): Promise<WorkspacePreviewProviderExportResult>
  invokeHtmlPreview(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult>
  invokeMarkdownImage(input: WorkspacePreviewProviderActionInput): Promise<WorkspacePreviewProviderActionResult>
}>

export type WorkspacePreviewBuiltInProviderAdapters = Readonly<{
  host?: WorkspacePreviewBuiltInHostProviderAdapters
  observeTabular: (
    input: WorkspacePreviewProviderObservationInput,
    service: ReturnType<typeof createWorkspaceTabularService>
  ) => Promise<WorkspacePreviewProviderObservationResult>
  invokeTabularAction: (
    input: WorkspacePreviewProviderActionInput,
    service: ReturnType<typeof createWorkspaceTabularService>
  ) => Promise<WorkspacePreviewProviderActionResult>
  observeDeck: (
    input: WorkspacePreviewProviderObservationInput,
    service: ReturnType<typeof createWorkspaceDeckService>
  ) => Promise<WorkspacePreviewProviderObservationResult>
  invokeDeckAction: (
    input: WorkspacePreviewProviderActionInput,
    service: ReturnType<typeof createWorkspaceDeckService>
  ) => Promise<WorkspacePreviewProviderActionResult>
}>

type EditHandler = NonNullable<WorkspacePreviewProvider['applyEdit']>
type ExportHandler = NonNullable<WorkspacePreviewProvider['exportPreview']>

export function createBuiltInWorkspacePreviewProviderRegistrations(
  adapters: WorkspacePreviewBuiltInProviderAdapters
): readonly WorkspacePreviewProviderRegistrationInput[] {
  const ownerId = BUILT_IN_WORKSPACE_PREVIEW_PROVIDER_OWNER_ID
  const host = adapters.host
  const textEdit = host && whenEdit((kind) => kind === 'text.replaceRange', host.applyTextEdit)
  const tabularEdit = host && whenEdit((kind) => kind.startsWith('tabular.'), host.applyTabularEdit)
  const deckEdit = host && whenEdit((kind) => kind === 'deck.updateTextElement', host.applyDeckEdit)
  const documentEdit = host && whenEdit((kind) => kind === 'document.updateParagraph', host.applyDocumentEdit)
  const annotationUpsert = host && whenEdit((kind) => kind === 'annotation.upsert', host.applyAnnotationUpsert)
  const annotationThreadUpdate = host && whenEdit(
    (kind) => kind === 'annotation.thread.update',
    host.applyAnnotationThreadUpdate
  )
  const annotationThreadDelete = host && whenEdit(
    (kind) => kind === 'annotation.thread.delete',
    host.applyAnnotationThreadDelete
  )
  const annotationEdits = compactHandlers(annotationUpsert, annotationThreadUpdate, annotationThreadDelete)
  const sourceExport: ExportHandler | undefined = host && ((input) => host.exportSource(input))
  const annotationExport: ExportHandler | undefined = host && ((input) => input.target.format === 'sidecar'
    ? host.exportAnnotationSidecar(input)
    : host.exportSource(input))
  const pdfExport: ExportHandler | undefined = host && ((input) => {
    if (input.target.format === 'sidecar') return host.exportAnnotationSidecar(input)
    if (input.target.format === 'annotated-pdf') return host.exportAnnotatedPdf(input)
    return host.exportSource(input)
  })

  const registrations: readonly WorkspacePreviewProviderRegistrationInput[] = [
    registration(ownerId, 0, {
      pluginId: TABULAR_WORKSPACE_PREVIEW_PLUGIN_ID,
      observe: (input) => adapters.observeTabular(input, createWorkspaceTabularService()),
      invokeAction: (input) => adapters.invokeTabularAction(input, createWorkspaceTabularService()),
      ...hostOperations({
        applyEdit: chainEdits(tabularEdit),
        exportPreview: sourceExport
      })
    }),
    registration(ownerId, 1, {
      pluginId: DECK_WORKSPACE_PREVIEW_PLUGIN_ID,
      observe: (input) => adapters.observeDeck(input, createWorkspaceDeckService()),
      invokeAction: (input) => adapters.invokeDeckAction(input, createWorkspaceDeckService()),
      ...hostOperations({
        applyEdit: chainEdits(deckEdit, ...annotationEdits),
        exportPreview: sourceExport
      })
    }),
    registration(ownerId, 2, {
      pluginId: TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host
        ? {
            validateFile: host.validateTextFile,
            observe: (input: WorkspacePreviewProviderObservationInput) => host.observeSourceText(input, []),
            applyEdit: chainEdits(textEdit),
            exportPreview: sourceExport
          }
        : {})
    }),
    registration(ownerId, 3, {
      pluginId: MARKDOWN_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host
        ? {
            validateFile: host.validateTextFile,
            observe: (input: WorkspacePreviewProviderObservationInput) => host.observeSourceText(input, ['markdown.readImage']),
            applyEdit: chainEdits(textEdit, ...annotationEdits),
            exportPreview: annotationExport,
            invokeHostAction: (input: WorkspacePreviewProviderActionInput) => input.action.actionId === 'markdown.readImage'
              ? host.invokeMarkdownImage(input)
              : Promise.resolve(null)
          }
        : {})
    }),
    registration(ownerId, 4, {
      pluginId: HTML_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host
        ? {
            validateFile: host.validateTextFile,
            observe: (input: WorkspacePreviewProviderObservationInput) => host.observeSourceText(input, ['html.previewUrl']),
            applyEdit: chainEdits(textEdit),
            exportPreview: sourceExport,
            invokeHostAction: (input: WorkspacePreviewProviderActionInput) => input.action.actionId === 'html.previewUrl'
              ? host.invokeHtmlPreview(input)
              : Promise.resolve(null)
          }
        : {})
    }),
    registration(ownerId, 5, {
      pluginId: PDF_WORKSPACE_PREVIEW_PLUGIN_ID,
      renderVisual: renderPdfVisual,
      ...hostOperations({
        applyEdit: chainEdits(...annotationEdits),
        exportPreview: pdfExport
      })
    }),
    registration(ownerId, 6, {
      pluginId: DOCX_WORKSPACE_PREVIEW_PLUGIN_ID,
      ...(host ? { observe: host.observeDocx } : {}),
      ...hostOperations({
        applyEdit: chainEdits(documentEdit, ...annotationEdits),
        exportPreview: annotationExport
      })
    }),
    registration(ownerId, 7, {
      pluginId: IMAGE_WORKSPACE_PREVIEW_PLUGIN_ID,
      renderVisual: renderImageVisual,
      ...hostOperations({ exportPreview: sourceExport })
    })
  ]
  return registrations
}

function registration(
  ownerId: string,
  order: number,
  provider: WorkspacePreviewProvider
): WorkspacePreviewProviderRegistrationInput {
  return { ownerId, order, provider }
}

function hostOperations(input: Readonly<{
  applyEdit?: EditHandler
  exportPreview?: ExportHandler
}>): Pick<WorkspacePreviewProvider, 'applyEdit' | 'exportPreview'> {
  return {
    ...(input.applyEdit ? { applyEdit: input.applyEdit } : {}),
    ...(input.exportPreview ? { exportPreview: input.exportPreview } : {})
  }
}

function whenEdit(
  matches: (kind: WorkspacePreviewProviderApplyEditInput['operation']['kind']) => boolean,
  handler: (input: WorkspacePreviewProviderApplyEditInput) => Promise<WorkspacePreviewProviderApplyEditResult>
): EditHandler {
  return (input) => matches(input.operation.kind) ? handler(input) : Promise.resolve(null)
}

function compactHandlers(...handlers: readonly (EditHandler | undefined)[]): readonly EditHandler[] {
  return handlers.filter((handler): handler is EditHandler => Boolean(handler))
}

function chainEdits(...handlers: readonly (EditHandler | undefined)[]): EditHandler | undefined {
  const available = compactHandlers(...handlers)
  if (!available.length) return undefined
  return async (input) => {
    for (const handler of available) {
      const result = await handler(input)
      if (result) return result
    }
    return null
  }
}

async function renderImageVisual(
  input: WorkspacePreviewProviderVisualInput
): Promise<VisualFrame> {
  const bytes = await readVisualSourceBytes(input.file.path)
  const mimeType = detectVisualImageMimeType(bytes)
  const image = await loadImage(bytes)
  assertDecodedDimensions(image.width, image.height)
  const region = normalizedRegion(input)
  const crop = region
    ? pixelRegion(region, image.width, image.height)
    : { x: 0, y: 0, width: image.width, height: image.height }
  const output = boundedRasterDimensions(
    crop.width,
    crop.height,
    requestedMaxDimension(input),
    false
  )

  if (
    !region &&
    output.width === image.width &&
    output.height === image.height
  ) {
    return {
      bytes: new Uint8Array(bytes),
      mimeType,
      width: image.width,
      height: image.height,
      sourceRevision: input.request.resource.semanticRevision,
      anchor: {
        kind: 'workspace-preview-image'
      }
    }
  }

  const canvas = createCanvas(output.width, output.height)
  canvas.getContext('2d').drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    output.width,
    output.height
  )
  return {
    bytes: new Uint8Array(canvas.encodeSync('png')),
    mimeType: 'image/png',
    width: output.width,
    height: output.height,
    sourceRevision: input.request.resource.semanticRevision,
    anchor: {
      kind: region ? 'workspace-preview-image-region' : 'workspace-preview-image',
      ...(region ? { metadata: { region } } : {})
    }
  }
}

async function renderPdfVisual(
  input: WorkspacePreviewProviderVisualInput
): Promise<VisualFrame> {
  const bytes = await readVisualSourceBytes(input.file.path)
  ensurePdfJsNodePrimitives()
  const pdfjs = await import(PDF_JS_MODULE_SPECIFIER) as unknown as {
    getDocument(options: unknown): {
      promise: Promise<{
        numPages: number
        getPage(pageNumber: number): Promise<{
          getViewport(options: { scale: number }): {
            width: number
            height: number
          }
          render(options: unknown): { promise: Promise<unknown> }
          cleanup(): void
        }>
        destroy(): Promise<void>
      }>
    }
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true
  })
  const document = await loadingTask.promise
  const frameIndex = input.request.frameIndex ?? 1
  if (frameIndex > document.numPages) {
    await document.destroy()
    throw new Error(
      `Workspace preview visual frame ${frameIndex} exceeds the PDF page count ${document.numPages}.`
    )
  }

  try {
    const page = await document.getPage(frameIndex)
    try {
      const baseViewport = page.getViewport({ scale: 1 })
      assertDecodedDimensions(baseViewport.width, baseViewport.height)
      const region = normalizedRegion(input)
      const regionWidth = baseViewport.width * (region?.width ?? 1)
      const regionHeight = baseViewport.height * (region?.height ?? 1)
      const output = boundedRasterDimensions(
        regionWidth,
        regionHeight,
        requestedMaxDimension(input),
        true
      )
      const scale = Math.min(
        output.width / regionWidth,
        output.height / regionHeight
      )
      const viewport = page.getViewport({ scale })
      const crop = region
        ? pixelRegion(region, viewport.width, viewport.height)
        : {
            x: 0,
            y: 0,
            width: Math.max(1, Math.ceil(viewport.width)),
            height: Math.max(1, Math.ceil(viewport.height))
          }
      const canvas = createCanvas(crop.width, crop.height)
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        ...(region
          ? { transform: [1, 0, 0, 1, -crop.x, -crop.y] }
          : {})
      }).promise
      return {
        bytes: new Uint8Array(canvas.encodeSync('png')),
        mimeType: 'image/png',
        width: crop.width,
        height: crop.height,
        sourceRevision: input.request.resource.semanticRevision,
        anchor: {
          kind: region ? 'workspace-preview-document-region' : 'workspace-preview-document-frame',
          metadata: {
            frameIndex,
            ...(region ? { region } : {})
          }
        }
      }
    } finally {
      page.cleanup()
    }
  } finally {
    await document.destroy()
  }
}

async function readVisualSourceBytes(path: string): Promise<Buffer> {
  const bytes = await readFile(path)
  if (bytes.byteLength < 1) {
    throw new Error('Workspace preview visual source is empty.')
  }
  if (bytes.byteLength > VISUAL_SOURCE_MAX_FRAME_BYTES) {
    throw new Error(
      `Workspace preview visual source exceeds the ${VISUAL_SOURCE_MAX_FRAME_BYTES} byte limit.`
    )
  }
  return bytes
}

function requestedMaxDimension(input: WorkspacePreviewProviderVisualInput): number {
  return Math.min(
    input.request.maxDimension ?? DEFAULT_VISUAL_MAX_DIMENSION,
    MAX_VISUAL_MAX_DIMENSION
  )
}

function normalizedRegion(
  input: WorkspacePreviewProviderVisualInput
): NormalizedVisualRegion | undefined {
  const target = input.request.target
  if (!target) return undefined
  if (target.kind !== 'region') {
    throw new Error(
      `Workspace preview provider ${input.manifest.id} does not resolve opaque visual targets.`
    )
  }
  return target.region
}

function boundedRasterDimensions(
  width: number,
  height: number,
  maxDimension: number,
  allowUpscale: boolean
): { width: number; height: number } {
  assertDecodedDimensions(width, height)
  let scale = Math.min(
    maxDimension / Math.max(width, height),
    Math.sqrt(MAX_VISUAL_PIXELS / (width * height))
  )
  if (!allowUpscale) scale = Math.min(1, scale)
  const outputWidth = Math.max(1, Math.floor(width * scale))
  const outputHeight = Math.max(1, Math.floor(height * scale))
  if (
    outputWidth > MAX_VISUAL_MAX_DIMENSION ||
    outputHeight > MAX_VISUAL_MAX_DIMENSION ||
    outputWidth * outputHeight > MAX_VISUAL_PIXELS
  ) {
    throw new Error('Workspace preview visual output exceeds the raster safety limit.')
  }
  return { width: outputWidth, height: outputHeight }
}

function assertDecodedDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('Workspace preview visual source has invalid decoded dimensions.')
  }
}

function pixelRegion(
  region: NormalizedVisualRegion,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(Math.ceil(width) - 1, Math.floor(region.x * width)))
  const y = Math.max(0, Math.min(Math.ceil(height) - 1, Math.floor(region.y * height)))
  const right = Math.max(x + 1, Math.min(Math.ceil(width), Math.ceil((region.x + region.width) * width)))
  const bottom = Math.max(y + 1, Math.min(Math.ceil(height), Math.ceil((region.y + region.height) * height)))
  return { x, y, width: right - x, height: bottom - y }
}

function detectVisualImageMimeType(
  bytes: Uint8Array
): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  throw new Error('Workspace preview image provider supports only PNG, JPEG, and WebP sources.')
}

function ensurePdfJsNodePrimitives(): void {
  const target = globalThis as unknown as Record<string, unknown>
  target.DOMMatrix ??= DOMMatrix
  target.ImageData ??= ImageData
  target.Path2D ??= Path2D
}
