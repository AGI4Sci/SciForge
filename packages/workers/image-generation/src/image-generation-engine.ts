import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  ImageEditIntent,
  ImageGenerationEditFromCanvasPacketRequest,
  ImageGenerationEditFromCanvasPacketResult,
  ImageGenerationManifest,
  ImageGenerationPlanRequest,
  ImageGenerationPlanResult,
  ImageGenerationRecipe,
  ImageGenerationRenderRequest,
  ImageGenerationRenderResult,
  ImageGenerationReviewPacketRequest,
  ImageGenerationReviewPacketResult,
  ImageGenerationReviewRequest,
  ImageGenerationReviewResult,
  ImageGenerationStatus,
  ImageGenerationUsagePolicy,
  ImageSize
} from './types'

const RENDERER_VERSION = '0.1.0'
const DEFAULT_SIZE: ImageSize = { width: 1024, height: 1024 }
const MAX_IMAGE_SIZE = 4096
const MIN_IMAGE_SIZE = 128
const ARTIFACT_DIR = '.sciforge/artifacts'
const IMAGE_DIR = '.sciforge/images'
const LOCAL_MODEL_ROUTER_BASE_URL_ERROR =
  'SCIFORGE_MODEL_ROUTER_BASE_URL must point to the local SciForge Model Router (http://127.0.0.1:<port>/v1, http://localhost:<port>/v1, or http://[::1]:<port>/v1).'
const SCIENTIFIC_BASE_IMAGE_WARNING =
  'Scientific figure image generation is for visual composition/base layers only. Overlay labels, axes, numeric data, citations, molecular annotations, and other scientific claims with deterministic scripts such as scientific_plotting.'
const SCIENTIFIC_BASE_IMAGE_PROVIDER_INSTRUCTION =
  'For scientific-figure use, render an unlabeled visual composition or background only. Leave clear space for scripted overlays. Do not include readable labels, axes, numeric values, data traces, citations, equations, tables, legends, scale bars, gene/protein names, or molecular identity claims in the raster image.'
const SCIENTIFIC_BASE_IMAGE_USAGE_POLICY: ImageGenerationUsagePolicy = {
  role: 'visual_composition_base',
  deterministicOverlayRequired: true,
  overlayToolchain: 'script_or_scientific_plotting',
  warning: SCIENTIFIC_BASE_IMAGE_WARNING
}
const SCIENTIFIC_IMAGE_REQUEST_PATTERN =
  /\b(scientific|figure|diagram|schematic|plot|chart|data|axis|axes|legend|label|labels|pathway|mechanism|molecular|protein|rna|dna|chromatin|meiosis|kinase|cell|cells|gene|genes|p-?value|pmid|citation|scale\s*bar|equation|manuscript|publication)\b/i

type ProviderRenderInput = {
  workspaceRoot: string
  outputPath: string
  recipe?: ImageGenerationRecipe
  editIntent?: ImageEditIntent
}

type ProviderRenderResult = {
  provider: 'image-endpoint' | 'placeholder'
  placeholder: boolean
  warnings: string[]
}

type ReviewPacketArtifact = {
  artifactKind?: string
  outputPath?: string
  sourcePath?: string
  path?: string
  shapeId?: string
  title?: string
}

type ReviewPacketSuggestion = {
  instruction?: string
  targetShapeId?: string
  annotationShapeId?: string
  artifactKind?: string
}

export async function getImageGenerationStatus(workspaceRoot?: string): Promise<ImageGenerationStatus> {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  const warnings: string[] = []
  const provider = providerKindForReadOnly(warnings)
  return {
    ok: true,
    provider,
    configured: provider === 'image-endpoint',
    supportedModes: ['text_to_image', 'image_to_image', 'variation'],
    supportedEditModes: ['inpaint', 'replace', 'erase', 'outpaint', 'upscale', 'style_transfer'],
    outputDir: root ? join(root, IMAGE_DIR) : IMAGE_DIR,
    artifactDir: root ? join(root, ARTIFACT_DIR) : ARTIFACT_DIR,
    warnings: [
      ...(provider === 'placeholder'
        ? ['No image model is configured. Other SciForge features are unaffected, but text-to-image and Canvas image edits require configuring an image model first.']
        : []),
      ...warnings
    ]
  }
}

export async function planImageGeneration(request: ImageGenerationPlanRequest): Promise<ImageGenerationPlanResult> {
  const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
  const warnings: string[] = []
  if (providerKindForReadOnly(warnings) === 'placeholder' && !allowPlaceholderProvider()) {
    warnings.push('Image model is not configured; rendering will return provider_not_configured until an image model is configured in Settings.')
  }
  const size = normalizeSize(request.size, warnings)
  const recipe: ImageGenerationRecipe = {
    mode: request.modeHint ?? (request.referencePath ? 'image_to_image' : 'text_to_image'),
    prompt: request.task.trim(),
    size,
    ...(request.stylePreset?.trim() ? { stylePreset: request.stylePreset.trim() } : {}),
    ...(request.referencePath?.trim() ? { referencePath: request.referencePath.trim() } : {}),
    outputFormat: 'png'
  }
  const usagePolicy = scientificUsagePolicyForRecipe(recipe)
  pushUsagePolicyWarning(warnings, usagePolicy)
  void workspaceRoot
  return {
    ok: true,
    task: request.task.trim(),
    recipe,
    suggestedRenderTool: 'image_generation_render',
    suggestedReviewTool: 'image_generation_review',
    artifactPolicy: usagePolicy
      ? 'Render writes a PNG visual base layer plus .sciforge/artifacts/*.generated-image.artifact.json for Canvas import; publication labels and data must be added by deterministic scripts.'
      : 'Render writes PNG output plus .sciforge/artifacts/*.generated-image.artifact.json for Canvas import.',
    canvasWorkflow: [
      'Run image_generation_render with the planned recipe.',
      'Import the generated artifact into SciForge Canvas.',
      'Use Canvas annotations for non-destructive edits.',
      'Run image_generation_edit_from_canvas_packet to create a new before/after artifact.',
      ...(usagePolicy ? ['For scientific figures, script all labels, axes, data traces, citations, scale bars, and molecular annotations after rendering the base image.'] : [])
    ],
    warnings
  }
}

export async function renderImageGeneration(request: ImageGenerationRenderRequest): Promise<ImageGenerationRenderResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const recipe = normalizeRecipe(request.recipe, warnings)
    const usagePolicy = scientificUsagePolicyForRecipe(recipe)
    pushUsagePolicyWarning(warnings, usagePolicy)
    const imageId = slugForId(request.imageId ?? 'generated-image-' + new Date().toISOString())
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const outputPath = join(outputDir, imageId + '.' + (recipe.outputFormat ?? 'png'))
    const providerResult = await renderWithProvider({ workspaceRoot, outputPath, recipe })
    warnings.push(...providerResult.warnings)
    const review = await reviewImageGenerationOutput({
      workspaceRoot,
      outputPath,
      ...(request.reviewReferencePath ? { referencePath: request.reviewReferencePath } : {})
    })
    const manifestPath = join(outputDir, imageId + '.manifest.json')
    const manifest: ImageGenerationManifest = {
      version: 1,
      renderer: 'sciforge-image-generation-mcp',
      rendererVersion: RENDERER_VERSION,
      tool: 'image_generation_render',
      createdAt: new Date().toISOString(),
      requestHash: hashValue({ recipe }),
      workspaceRoot,
      outputPath,
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      recipe,
      provider: providerResult.provider,
      review,
      ...(usagePolicy ? { usagePolicy } : {}),
      warnings
    }
    await writeJson(manifestPath, manifest)
    const artifactManifestPath = await writeImageArtifactManifest({
      workspaceRoot,
      artifactId: imageId,
      artifactKind: 'generated_image',
      sourceTool: 'image_generation',
      outputPath,
      manifestPath,
      title: recipe.prompt.slice(0, 90) || imageId,
      referencePath: recipe.referencePath,
      ...(request.canvasId ? { canvasId: request.canvasId } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(usagePolicy ? { usagePolicy } : {}),
      review
    })
    return {
      ok: true,
      status: providerResult.placeholder ? 'rendered_placeholder' : review.ok ? 'rendered' : 'review_failed',
      workspaceRoot,
      outputPath,
      manifestPath,
      artifactManifestPath,
      provider: providerResult.provider,
      review,
      ...(usagePolicy ? { usagePolicy } : {}),
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: renderErrorStatus(error),
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

export async function editImageFromCanvasPacket(
  request: ImageGenerationEditFromCanvasPacketRequest
): Promise<ImageGenerationEditFromCanvasPacketResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const packet = await loadReviewPacket(request, workspaceRoot)
    const packetRecord = asRecord(packet)
    const packetCanvasId = stringValue(packetRecord.canvasId)
    const packetThreadId = stringValue(packetRecord.threadId)
    const canvasId = request.canvasId ?? packetCanvasId
    const threadId = request.threadId ?? packetThreadId
    const intents = extractEditIntents(packet, workspaceRoot, warnings)
    if (intents.length === 0) {
      return {
        ok: false,
        status: 'no_edit_targets',
        message: 'No image edit targets were found in the Canvas review packet.',
        warnings
      }
    }
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir)
    await mkdir(outputDir, { recursive: true })
    const outputs: Array<{
      workspaceRoot: string
      outputPath: string
      manifestPath: string
      artifactManifestPath: string
      provider: 'image-endpoint' | 'placeholder'
    }> = []
    for (const [index, intent] of intents.entries()) {
      const imageId = slugForId(request.imageId ?? 'edited-image-' + new Date().toISOString() + '-' + (index + 1))
      const outputPath = join(outputDir, imageId + '.' + (intent.outputFormat ?? 'png'))
      const usagePolicy = scientificUsagePolicyForEditIntent(intent)
      pushUsagePolicyWarning(warnings, usagePolicy)
      const providerResult = await renderWithProvider({ workspaceRoot, outputPath, editIntent: intent })
      warnings.push(...providerResult.warnings)
      const review = await reviewImageGenerationOutput({ workspaceRoot, outputPath, referencePath: intent.sourcePath })
      const manifestPath = join(outputDir, imageId + '.manifest.json')
      const manifest: ImageGenerationManifest = {
        version: 1,
        renderer: 'sciforge-image-generation-mcp',
        rendererVersion: RENDERER_VERSION,
        tool: 'image_generation_edit_from_canvas_packet',
        createdAt: new Date().toISOString(),
        requestHash: hashValue({ intent }),
        workspaceRoot,
        outputPath,
        ...(canvasId ? { canvasId } : {}),
        ...(threadId ? { threadId } : {}),
        editIntent: intent,
        provider: providerResult.provider,
        review,
        ...(usagePolicy ? { usagePolicy } : {}),
        warnings
      }
      await writeJson(manifestPath, manifest)
      const artifactManifestPath = await writeImageArtifactManifest({
        workspaceRoot,
        artifactId: imageId,
        artifactKind: 'edited_image',
        sourceTool: 'image_generation',
        outputPath,
        manifestPath,
        sourcePath: intent.sourcePath,
        title: intent.instruction.slice(0, 90) || imageId,
        ...(canvasId ? { canvasId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(usagePolicy ? { usagePolicy } : {}),
        review
      })
      outputs.push({ workspaceRoot, outputPath, manifestPath, artifactManifestPath, provider: providerResult.provider })
    }
    return {
      ok: true,
      status: outputs.some((output) => output.provider === 'image-endpoint') ? 'edited' : 'edited_placeholder',
      intents,
      outputs,
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: editErrorStatus(error),
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

export async function reviewImageGenerationOutput(request: ImageGenerationReviewRequest): Promise<ImageGenerationReviewResult> {
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    const outputPath = await resolveWorkspacePath(workspaceRoot, request.outputPath)
    const image = await loadImage(outputPath)
    const warnings: string[] = []
    const sizeScore = image.width >= MIN_IMAGE_SIZE && image.height >= MIN_IMAGE_SIZE ? 1 : 0.35
    if (image.width < MIN_IMAGE_SIZE || image.height < MIN_IMAGE_SIZE) warnings.push('Image is smaller than the minimum recommended size.')
    const nonEmptyScore = await scoreNonEmpty(outputPath)
    if (nonEmptyScore < 0.75) warnings.push('Image appears mostly blank or extremely low contrast.')
    let referenceScore: number | undefined
    if (request.referencePath) {
      const referencePath = await resolveWorkspacePath(workspaceRoot, request.referencePath)
      const reference = await loadImage(referencePath)
      const outputRatio = image.width / Math.max(1, image.height)
      const referenceRatio = reference.width / Math.max(1, reference.height)
      referenceScore = Math.max(0, 1 - Math.min(1, Math.abs(outputRatio - referenceRatio) / Math.max(referenceRatio, 0.01)))
      if (referenceScore < 0.75) warnings.push('Output aspect ratio differs from the reference image.')
    }
    const overall = clamp01((sizeScore + nonEmptyScore + (referenceScore ?? 1)) / (referenceScore === undefined ? 2 : 3))
    return {
      ok: true,
      score: {
        overall,
        dimensions: sizeScore,
        nonEmpty: nonEmptyScore,
        background: nonEmptyScore,
        ...(referenceScore !== undefined ? { reference: referenceScore } : {}),
        warnings
      },
      repairable: overall < (request.minOverall ?? 0.72),
      warnings
    }
  } catch (error) {
    return {
      ok: false,
      status: 'image_unreadable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function createImageGenerationReviewPacket(
  request: ImageGenerationReviewPacketRequest
): Promise<ImageGenerationReviewPacketResult> {
  const warnings: string[] = []
  try {
    const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot)
    if (request.manifestPaths.length === 0) {
      return { ok: false, status: 'invalid_request', message: 'manifestPaths must contain at least one manifest path.' }
    }
    const outputDir = await resolveOutputDir(workspaceRoot, request.outputDir ?? join('.sciforge', 'image-review-packets'))
    await mkdir(outputDir, { recursive: true })
    const packetId = slugForId(request.packetId ?? 'image-review-' + new Date().toISOString())
    const items: unknown[] = []
    for (const manifestPath of request.manifestPaths) {
      try {
        const resolvedManifest = await resolveWorkspacePath(workspaceRoot, manifestPath)
        items.push(JSON.parse(await readFile(resolvedManifest, 'utf8')))
      } catch (error) {
        warnings.push('Could not read manifest ' + manifestPath + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    const packet = {
      version: 1,
      tool: 'image_generation_review_packet',
      createdAt: new Date().toISOString(),
      title: request.title ?? 'Image generation review packet',
      items,
      warnings
    }
    const packetPath = join(outputDir, packetId + '.json')
    const markdownPath = join(outputDir, packetId + '.md')
    await writeJson(packetPath, packet)
    await writeFile(markdownPath, renderReviewPacketMarkdown(packet.title, items, warnings), 'utf8')
    return { ok: true, packetPath, markdownPath, count: items.length, warnings }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof WorkspaceError ? 'invalid_workspace' : 'write_failed',
      message: error instanceof Error ? error.message : String(error),
      warnings
    }
  }
}

function providerKind(): 'image-endpoint' | 'placeholder' {
  return Boolean(configuredModelRouterImageEndpoint())
    ? 'image-endpoint'
    : 'placeholder'
}

function providerKindForReadOnly(warnings: string[]): 'image-endpoint' | 'placeholder' {
  try {
    return providerKind()
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error))
    return 'placeholder'
  }
}

async function renderWithProvider(input: ProviderRenderInput): Promise<ProviderRenderResult> {
  if (providerKind() === 'image-endpoint') {
    try {
      await renderWithConfiguredImageEndpoint(input)
      return { provider: 'image-endpoint', placeholder: false, warnings: [] }
    } catch (error) {
      throw new ProviderError(error instanceof Error ? error.message : String(error))
    }
  }
  if (!allowPlaceholderProvider()) {
    throw new ProviderNotConfiguredError(
      'Image model is not configured. Configure an image model in Settings before using text-to-image generation or Canvas image edits.'
    )
  }
  await renderPlaceholder(input)
  return {
    provider: 'placeholder',
    placeholder: true,
    warnings: ['Rendered with placeholder provider because SCIFORGE_IMAGE_ALLOW_PLACEHOLDER=1 is set and no Model Router image endpoint is configured.']
  }
}

function allowPlaceholderProvider(): boolean {
  return process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER === '1'
}

async function renderWithConfiguredImageEndpoint(input: ProviderRenderInput): Promise<void> {
  const endpoint = configuredModelRouterImageEndpoint()
  if (!endpoint) throw new ProviderError('Missing Model Router image endpoint configuration.')
  const prompt = input.recipe
    ? providerPromptForRecipe(input.recipe)
    : providerPromptForEditIntent(input.editIntent)
  const size = input.recipe?.size ?? DEFAULT_SIZE
  const errors: string[] = []
  for (const candidateBaseUrl of imageEndpointBaseUrlCandidates(endpoint.baseUrl)) {
    try {
      await renderWithImageEndpoint(candidateBaseUrl, {
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        prompt,
        size,
        outputPath: input.outputPath
      })
      return
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new ProviderError(errors.find(Boolean) ?? 'Image provider did not return an image.')
}

function configuredModelRouterImageEndpoint(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY?.trim()
  const rawBaseUrl = process.env.SCIFORGE_MODEL_ROUTER_BASE_URL?.trim()
  const baseUrl = rawBaseUrl ? normalizeLocalModelRouterV1BaseUrl(rawBaseUrl) : ''
  if (!apiKey || !baseUrl) return null
  return {
    apiKey,
    baseUrl,
    model: process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL?.trim() || 'sciforge-router'
  }
}

function imageEndpointBaseUrlCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '')
  if (!normalized) return []
  const candidates = normalized.endsWith('/v1')
    ? [normalized]
    : [normalized + '/v1', normalized]
  return [...new Set(candidates)]
}

function normalizeLocalModelRouterV1BaseUrl(rawBaseUrl: string): string {
  let url: URL
  try {
    url = new URL(rawBaseUrl)
  } catch {
    throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  if (url.username || url.password || url.search || url.hash) throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  if (!isAllowedLocalModelRouterHost(url.hostname)) throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  const path = url.pathname.replace(/\/+$/, '')
  if (path && path !== '/v1') throw new ProviderError(LOCAL_MODEL_ROUTER_BASE_URL_ERROR)
  return url.origin + '/v1'
}

function isAllowedLocalModelRouterHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

async function renderWithImageEndpoint(
  baseUrl: string,
  input: {
    apiKey: string
    model: string
    prompt: string
    size: ImageSize
    outputPath: string
  }
): Promise<void> {
  let response = await fetchOpenAiImagesEndpoint(baseUrl, input, 'prompt')
  let payload = await parseProviderJson(response, 'Image endpoint')

  if (!response.ok && shouldRetryImagesEndpointWithTextPayload(response.status, payload)) {
    response = await fetchOpenAiImagesEndpoint(baseUrl, input, 'text')
    payload = await parseProviderJson(response, 'Image endpoint')
  }

  if (!response.ok) throw new ProviderError(providerHttpError('Image endpoint', response.status, payload))
  const first = payload.data?.[0]
  if (await writeProviderImage(first, input.outputPath)) return
  throw new ProviderError('Image endpoint response did not include b64_json or a data URL.')
}

async function fetchOpenAiImagesEndpoint(
  baseUrl: string,
  input: {
    apiKey: string
    model: string
    prompt: string
    size: ImageSize
  },
  promptField: 'prompt' | 'text'
): Promise<Response> {
  return fetch(baseUrl + '/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + input.apiKey
    },
    body: JSON.stringify({
      model: input.model,
      [promptField]: input.prompt,
      size: input.size.width + 'x' + input.size.height,
      n: 1
    })
  })
}

function shouldRetryImagesEndpointWithTextPayload(status: number, payload: Record<string, any>): boolean {
  if (status !== 400) return false
  const message = (stringValue(asRecord(payload.error).message) ?? '').toLowerCase()
  return message.includes('text') && message.includes('image') && message.includes('provided')
}

async function parseProviderJson(
  response: Response,
  endpointName: string
): Promise<Record<string, any>> {
  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, any>
  } catch {
    const contentType = response.headers.get('content-type') ?? 'unknown content-type'
    throw new ProviderError(
      endpointName + ' returned non-JSON ' + contentType + ': ' + text.replace(/\s+/g, ' ').slice(0, 180)
    )
  }
}

function providerHttpError(endpointName: string, status: number, payload: Record<string, any>): string {
  const error = asRecord(payload.error)
  const message = stringValue(error.message) ?? JSON.stringify(payload).slice(0, 500)
  return endpointName + ' returned HTTP ' + status + ': ' + message
}

async function writeProviderImage(value: unknown, outputPath: string): Promise<boolean> {
  const record = asRecord(value)
  const b64Json = stringValue(record.b64_json)
  if (b64Json) {
    await writeFile(outputPath, Buffer.from(b64Json, 'base64'))
    return true
  }
  const url = stringValue(record.url) ??
    stringValue(asRecord(record.image_url).url) ??
    stringValue(asRecord(record.image).url)
  if (url) return writeProviderImageUrl(url, outputPath)

  const dataUri = findImageDataUri(value)
  if (dataUri) {
    await writeFile(outputPath, Buffer.from(dataUri.base64, 'base64'))
    return true
  }

  const content = record.content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (await writeProviderImage(item, outputPath)) return true
    }
  }
  const images = record.images
  if (Array.isArray(images)) {
    for (const item of images) {
      if (await writeProviderImage(item, outputPath)) return true
    }
  }
  return false
}

async function writeProviderImageUrl(url: string, outputPath: string): Promise<boolean> {
  if (url.startsWith('data:')) {
    const dataUri = findImageDataUri(url)
    if (!dataUri) return false
    await writeFile(outputPath, Buffer.from(dataUri.base64, 'base64'))
    return true
  }
  throw new ProviderError('Model Router returned a non-normalized image URL. Image workers only accept b64_json or data URLs.')
}

function findImageDataUri(value: unknown): { base64: string } | null {
  if (typeof value === 'string') {
    const match = value.match(/data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)/i)
    return match ? { base64: match[1] } : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageDataUri(item)
      if (found) return found
    }
    return null
  }
  const record = asRecord(value)
  for (const item of Object.values(record)) {
    const found = findImageDataUri(item)
    if (found) return found
  }
  return null
}

async function renderPlaceholder(input: ProviderRenderInput): Promise<void> {
  const size = input.recipe?.size ?? DEFAULT_SIZE
  const canvas = createCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, size.width, size.height)
  gradient.addColorStop(0, '#f8fafc')
  gradient.addColorStop(0.48, '#dbeafe')
  gradient.addColorStop(1, '#eef2ff')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.fillStyle = '#1e293b'
  ctx.font = '700 ' + Math.max(24, Math.floor(size.width / 26)) + 'px sans-serif'
  ctx.fillText(input.editIntent ? 'SciForge Image Edit' : 'SciForge Image Generation', 48, 82)
  ctx.font = Math.max(16, Math.floor(size.width / 52)) + 'px sans-serif'
  ctx.fillStyle = '#334155'
  const text = input.recipe?.prompt ?? input.editIntent?.instruction ?? 'No prompt supplied.'
  drawWrappedText(ctx, text, 48, 140, size.width - 96, Math.max(24, Math.floor(size.width / 36)))
  if (input.editIntent?.sourcePath) {
    try {
      const sourcePath = await resolveWorkspacePath(input.workspaceRoot, input.editIntent.sourcePath)
      const source = await loadImage(sourcePath)
      const thumbW = Math.floor(size.width * 0.34)
      const thumbH = Math.floor(thumbW * source.height / Math.max(1, source.width))
      ctx.globalAlpha = 0.86
      ctx.drawImage(source, size.width - thumbW - 48, size.height - thumbH - 48, thumbW, thumbH)
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 3
      ctx.strokeRect(size.width - thumbW - 48, size.height - thumbH - 48, thumbW, thumbH)
    } catch {
      // Source thumbnails are best-effort only for placeholder renders.
    }
  }
  const buffer = canvas.toBuffer('image/png')
  await writeFile(input.outputPath, buffer)
}

function drawWrappedText(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let cursorY = y
  for (const word of words) {
    const next = line ? line + ' ' + word : word
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY)
      line = word
      cursorY += lineHeight
    } else {
      line = next
    }
  }
  if (line) ctx.fillText(line, x, cursorY)
}

function normalizeRecipe(recipe: ImageGenerationRecipe, warnings: string[]): ImageGenerationRecipe {
  if (!recipe || typeof recipe !== 'object') throw new Error('recipe is required.')
  const prompt = recipe.prompt?.trim()
  if (!prompt) throw new Error('recipe.prompt is required.')
  return {
    mode: recipe.mode ?? 'text_to_image',
    prompt,
    ...(recipe.negativePrompt?.trim() ? { negativePrompt: recipe.negativePrompt.trim() } : {}),
    size: normalizeSize(recipe.size, warnings),
    ...(recipe.stylePreset?.trim() ? { stylePreset: recipe.stylePreset.trim() } : {}),
    ...(recipe.referencePath?.trim() ? { referencePath: recipe.referencePath.trim() } : {}),
    outputFormat: recipe.outputFormat ?? 'png'
  }
}

function scientificUsagePolicyForRecipe(recipe: ImageGenerationRecipe | undefined): ImageGenerationUsagePolicy | undefined {
  if (!recipe) return undefined
  return isScientificImageRequest([recipe.prompt, recipe.stylePreset]) ? SCIENTIFIC_BASE_IMAGE_USAGE_POLICY : undefined
}

function scientificUsagePolicyForEditIntent(intent: ImageEditIntent | undefined): ImageGenerationUsagePolicy | undefined {
  if (!intent) return undefined
  return isScientificImageRequest([intent.instruction]) ? SCIENTIFIC_BASE_IMAGE_USAGE_POLICY : undefined
}

function isScientificImageRequest(values: Array<string | undefined>): boolean {
  return values.some((value) => SCIENTIFIC_IMAGE_REQUEST_PATTERN.test(value ?? ''))
}

function pushUsagePolicyWarning(warnings: string[], usagePolicy: ImageGenerationUsagePolicy | undefined): void {
  if (!usagePolicy || warnings.includes(usagePolicy.warning)) return
  warnings.push(usagePolicy.warning)
}

function providerPromptForRecipe(recipe: ImageGenerationRecipe): string {
  const prompt = recipe.prompt.trim()
  return scientificUsagePolicyForRecipe(recipe)
    ? prompt + '\n\n' + SCIENTIFIC_BASE_IMAGE_PROVIDER_INSTRUCTION
    : prompt
}

function providerPromptForEditIntent(intent: ImageEditIntent | undefined): string {
  const instruction = intent?.instruction.trim() ?? ''
  return scientificUsagePolicyForEditIntent(intent)
    ? instruction + '\n\n' + SCIENTIFIC_BASE_IMAGE_PROVIDER_INSTRUCTION
    : instruction
}

function normalizeSize(size: Partial<ImageSize> | undefined, warnings: string[]): ImageSize {
  const width = clampInteger(size?.width ?? DEFAULT_SIZE.width, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE)
  const height = clampInteger(size?.height ?? DEFAULT_SIZE.height, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE)
  if (size?.width !== undefined && width !== size.width) warnings.push('Requested width was clamped to supported range.')
  if (size?.height !== undefined && height !== size.height) warnings.push('Requested height was clamped to supported range.')
  return { width, height }
}

async function resolveOutputDir(workspaceRoot: string, outputDir?: string): Promise<string> {
  const dir = outputDir?.trim() || IMAGE_DIR
  const resolved = isAbsolute(dir) ? resolve(dir) : resolve(workspaceRoot, dir)
  ensureInsideWorkspace(workspaceRoot, resolved)
  return resolved
}

async function resolveWorkspacePath(workspaceRoot: string, rawPath: string): Promise<string> {
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceRoot, rawPath)
  ensureInsideWorkspace(workspaceRoot, resolved)
  return resolved
}

function assertWorkspaceRoot(workspaceRoot: string | undefined): string {
  const root = normalizeWorkspaceRoot(workspaceRoot)
  if (!root) throw new WorkspaceError('workspaceRoot is required.')
  return root
}

function normalizeWorkspaceRoot(workspaceRoot: string | undefined): string | undefined {
  const root = workspaceRoot?.trim()
  return root ? resolve(root) : undefined
}

function ensureInsideWorkspace(workspaceRoot: string, path: string): void {
  const relativePath = relative(workspaceRoot, path)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new WorkspaceError('Path escapes workspaceRoot: ' + path)
  }
}

async function writeImageArtifactManifest(input: {
  workspaceRoot: string
  artifactId: string
  artifactKind: 'generated_image' | 'edited_image'
  sourceTool: 'image_generation'
  outputPath: string
  manifestPath: string
  sourcePath?: string
  referencePath?: string
  canvasId?: string
  threadId?: string
  usagePolicy?: ImageGenerationUsagePolicy
  title: string
  review?: ImageGenerationReviewResult
}): Promise<string> {
  const artifactsDir = join(input.workspaceRoot, ARTIFACT_DIR)
  await mkdir(artifactsDir, { recursive: true })
  const artifactManifestPath = join(artifactsDir, input.artifactId + '.' + input.artifactKind.replace('_', '-') + '.artifact.json')
  await writeJson(artifactManifestPath, {
    version: 1,
    kind: 'sciforge_artifact',
    createdAt: new Date().toISOString(),
    sourceTool: input.sourceTool,
    artifactKind: input.artifactKind,
    workspaceRoot: input.workspaceRoot,
    path: input.outputPath,
    outputPath: input.outputPath,
    manifestPath: input.manifestPath,
    ...(input.canvasId ? { canvasId: input.canvasId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    ...(input.referencePath ? { referencePath: input.referencePath } : {}),
    title: input.title,
    ...(input.usagePolicy ? { usagePolicy: input.usagePolicy } : {}),
    ...(input.review?.ok ? { reviewScore: input.review.score } : {})
  })
  return artifactManifestPath
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

async function loadReviewPacket(request: ImageGenerationEditFromCanvasPacketRequest, workspaceRoot: string): Promise<unknown> {
  if (request.reviewPacket) return request.reviewPacket
  if (!request.reviewPacketPath?.trim()) throw new Error('reviewPacket or reviewPacketPath is required.')
  const packetPath = await resolveWorkspacePath(workspaceRoot, request.reviewPacketPath)
  return JSON.parse(await readFile(packetPath, 'utf8'))
}

function extractEditIntents(packet: unknown, workspaceRoot: string, warnings: string[]): ImageEditIntent[] {
  const record = asRecord(packet)
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts.map(asRecord) : []
  const suggestions = Array.isArray(record.modificationSuggestions) ? record.modificationSuggestions.map(asRecord) : []
  const intents: ImageEditIntent[] = []
  for (const suggestion of suggestions) {
    const targetShapeId = typeof suggestion.targetShapeId === 'string' ? suggestion.targetShapeId : undefined
    const target = artifacts.find((artifact) => typeof artifact.shapeId === 'string' && artifact.shapeId === targetShapeId)
      ?? artifacts.find((artifact) => isImageArtifactKind(String(artifact.artifactKind ?? '')))
    if (!target) continue
    const sourcePath = stringValue(target.outputPath) ?? stringValue(target.sourcePath) ?? stringValue(target.path)
    if (!sourcePath) continue
    const instruction = stringValue(suggestion.instruction) ?? 'Apply the canvas annotation as a non-destructive image edit.'
    try {
      ensureInsideWorkspace(workspaceRoot, isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(workspaceRoot, sourcePath))
      intents.push({
        mode: 'replace',
        sourcePath,
        instruction,
        ...(typeof suggestion.annotationShapeId === 'string' ? { annotationShapeId: suggestion.annotationShapeId } : {}),
        ...(targetShapeId ? { targetShapeId } : {}),
        preserve: ['composition', 'layout']
      })
    } catch (error) {
      warnings.push('Skipped image edit target outside workspace: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  return intents
}

function isImageArtifactKind(kind: string): boolean {
  return kind === 'image' || kind === 'generated_image' || kind === 'edited_image'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function scoreNonEmpty(path: string): Promise<number> {
  const image = await loadImage(path)
  const canvas = createCanvas(64, 64)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, 64, 64)
  const data = ctx.getImageData(0, 0, 64, 64).data
  let min = 255
  let max = 0
  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
    min = Math.min(min, luminance)
    max = Math.max(max, luminance)
  }
  return clamp01((max - min) / 64)
}

function renderReviewPacketMarkdown(title: string, items: unknown[], warnings: string[]): string {
  const lines = ['# ' + title, '', 'Items: ' + items.length, '']
  if (warnings.length) {
    lines.push('## Warnings', '', ...warnings.map((warning) => '- ' + warning), '')
  }
  lines.push('## Manifests', '')
  for (const item of items) {
    const record = asRecord(item)
    lines.push('- ' + (stringValue(record.outputPath) ?? stringValue(record.path) ?? 'unknown output'))
  }
  lines.push('')
  return lines.join('\n')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function slugForId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return slug || 'image-artifact'
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

class WorkspaceError extends Error {}
class ProviderError extends Error {}
class ProviderNotConfiguredError extends ProviderError {}

function renderErrorStatus(
  error: unknown
): Extract<ImageGenerationRenderResult, { ok: false }>['status'] {
  if (error instanceof WorkspaceError) return 'invalid_workspace'
  if (error instanceof ProviderNotConfiguredError) return 'provider_not_configured'
  if (error instanceof ProviderError) return 'provider_failed'
  return 'write_failed'
}

function editErrorStatus(
  error: unknown
): Extract<ImageGenerationEditFromCanvasPacketResult, { ok: false }>['status'] {
  if (error instanceof WorkspaceError) return 'invalid_workspace'
  if (error instanceof ProviderNotConfiguredError) return 'provider_not_configured'
  if (error instanceof ProviderError) return 'provider_failed'
  return 'write_failed'
}
