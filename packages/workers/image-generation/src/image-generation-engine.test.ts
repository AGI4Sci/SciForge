import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  editFrameworkComponentsWithImage2,
  editImageFromVisualReviewPacket,
  getImageGenerationStatus,
  planImageGeneration as planImageGenerationEngine,
  renderImageGeneration as renderImageGenerationEngine,
  reviewVisualArtifact,
  segmentImageGenerationComponents
} from './image-generation-engine'
import type { ImageGenerationPlanRequest, ImageGenerationRenderRequest } from './types'
import type { VisualProductionHandoff } from './visual-production-planner'

const modelVisualPlan: VisualProductionHandoff = {
  planId: 'test-model-plan',
  route: 'model',
  routeLocked: true,
  rationale: 'The image model owns the declared visual expression.',
  sourceArtifacts: [],
  reproducibleInputs: [],
  lockedElements: [],
  modelOwnedElements: ['visual composition'],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'publication_ready',
  fallbackPolicy: 'fail_closed'
}

const hybridVisualPlan: VisualProductionHandoff = {
  ...modelVisualPlan,
  planId: 'test-hybrid-plan',
  route: 'hybrid',
  rationale: 'Code owns exact content while the model owns visual expression.',
  sourceArtifacts: ['data/results.csv'],
  reproducibleInputs: ['data/results.csv'],
  lockedElements: ['labels, values, and relationships'],
  modelOwnedElements: ['background and visual style']
}

const codeVisualPlan: VisualProductionHandoff = {
  ...modelVisualPlan,
  planId: 'test-code-plan',
  route: 'code',
  rationale: 'Code owns the complete reproducible artifact.',
  sourceArtifacts: ['data/results.csv'],
  reproducibleInputs: ['data/results.csv'],
  lockedElements: ['all rendered values and labels'],
  modelOwnedElements: []
}

const draftVisualPlan: VisualProductionHandoff = {
  ...modelVisualPlan,
  planId: 'test-draft-plan',
  contextStatus: 'budget_exhausted',
  contextStopReason: 'cost_limit',
  unresolvedContext: ['Confirm the current external standard.'],
  releaseCeiling: 'draft_ready'
}

type PlanRequest = Omit<ImageGenerationPlanRequest, 'visualPlan'> & { visualPlan?: VisualProductionHandoff }
type RenderRequest = Omit<ImageGenerationRenderRequest, 'recipe'> & {
  recipe: Omit<ImageGenerationRenderRequest['recipe'], 'visualPlan'> & { visualPlan?: VisualProductionHandoff }
}

function planImageGeneration(
  request: PlanRequest
) {
  return planImageGenerationEngine({
    ...request,
    visualPlan: request.visualPlan ?? modelVisualPlan
  })
}

function renderImageGeneration(
  request: RenderRequest
) {
  return renderImageGenerationEngine({
    ...request,
    recipe: {
      ...request.recipe,
      visualPlan: request.recipe.visualPlan ?? modelVisualPlan
    }
  })
}

async function decodedPixels(path: string): Promise<Buffer> {
  const image = await loadImage(path)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return Buffer.from(context.getImageData(0, 0, image.width, image.height).data)
}

function writeReviewManifest(outputPath: string, visualPlan: VisualProductionHandoff = modelVisualPlan): string {
  const manifestPath = outputPath.replace(/\.[^.]+$/, '.manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    outputPath,
    outputHash: createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
    visualPlan
  }))
  return manifestPath
}

let workspaceRoot = ''
let previousAllowPlaceholder: string | undefined
let previousRouterApiKey: string | undefined
let previousRouterBaseUrl: string | undefined
let previousRouterImageModel: string | undefined
let previousComponentSegmentationRunner: string | undefined
let previousComponentSegmentationModel: string | undefined
let previousFastSamRunner: string | undefined
let previousFastSamModel: string | undefined
let previousFetch: typeof fetch | undefined

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'image-generation-'))
  previousAllowPlaceholder = process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER
  previousRouterApiKey = process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY
  previousRouterBaseUrl = process.env.SCIFORGE_MODEL_ROUTER_BASE_URL
  previousRouterImageModel = process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL
  previousComponentSegmentationRunner = process.env.SCIFORGE_COMPONENT_SEGMENTATION_RUNNER
  previousComponentSegmentationModel = process.env.SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH
  previousFastSamRunner = process.env.SCIFORGE_FASTSAM_RUNNER
  previousFastSamModel = process.env.SCIFORGE_FASTSAM_MODEL_PATH
  previousFetch = globalThis.fetch
  delete process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY
  delete process.env.SCIFORGE_MODEL_ROUTER_BASE_URL
  delete process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL
  delete process.env.SCIFORGE_COMPONENT_SEGMENTATION_RUNNER
  delete process.env.SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH
  delete process.env.SCIFORGE_FASTSAM_RUNNER
  delete process.env.SCIFORGE_FASTSAM_MODEL_PATH
})

afterEach(() => {
  vi.restoreAllMocks()
  if (previousFetch) globalThis.fetch = previousFetch
  if (previousAllowPlaceholder === undefined) delete process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER
  else process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = previousAllowPlaceholder
  if (previousRouterApiKey === undefined) delete process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY
  else process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = previousRouterApiKey
  if (previousRouterBaseUrl === undefined) delete process.env.SCIFORGE_MODEL_ROUTER_BASE_URL
  else process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = previousRouterBaseUrl
  if (previousRouterImageModel === undefined) delete process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL
  else process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = previousRouterImageModel
  if (previousComponentSegmentationRunner === undefined) delete process.env.SCIFORGE_COMPONENT_SEGMENTATION_RUNNER
  else process.env.SCIFORGE_COMPONENT_SEGMENTATION_RUNNER = previousComponentSegmentationRunner
  if (previousComponentSegmentationModel === undefined) delete process.env.SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH
  else process.env.SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH = previousComponentSegmentationModel
  if (previousFastSamRunner === undefined) delete process.env.SCIFORGE_FASTSAM_RUNNER
  else process.env.SCIFORGE_FASTSAM_RUNNER = previousFastSamRunner
  if (previousFastSamModel === undefined) delete process.env.SCIFORGE_FASTSAM_MODEL_PATH
  else process.env.SCIFORGE_FASTSAM_MODEL_PATH = previousFastSamModel
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = ''
})

describe('image generation engine', () => {
  it('reports a degraded placeholder provider when no Model Router image endpoint is configured', async () => {
    const status = await getImageGenerationStatus(workspaceRoot)

    expect(status.ok).toBe(true)
    expect(status.provider).toBe('placeholder')
    expect(status.configured).toBe(false)
    expect(status.defaultModel).toBe('sciforge-router')
    expect(status.warnings.length).toBeGreaterThan(0)
  })

  it('fails closed when semantic visual review cannot reach Model Router vision', async () => {
    const outputPath = join(workspaceRoot, 'review.png')
    const canvas = createCanvas(256, 256)
    writeFileSync(outputPath, canvas.toBuffer('image/png'))
    const manifestPath = writeReviewManifest(outputPath)

    const review = await reviewVisualArtifact({
      workspaceRoot,
      outputPath,
      manifestPath,
      task: 'Review a publication figure.',
    })

    expect(review).toMatchObject({ ok: false, status: 'vision_review_unavailable' })
  })

  it('uses Model Router vision for semantic overlap and legibility review', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const outputPath = join(workspaceRoot, 'broken-layout.png')
    const canvas = createCanvas(256, 256)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 256, 256)
    context.fillStyle = '#111827'
    context.fillRect(20, 20, 210, 210)
    writeFileSync(outputPath, canvas.toBuffer('image/png'))
    const manifestPath = writeReviewManifest(outputPath, hybridVisualPlan)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        pass: false,
        score: 0.12,
        summary: 'Major elements overlap and labels are illegible.',
        violations: ['Large overlapping shapes obscure the content.'],
        repairInstructions: ['Rebuild the layout with non-overlapping regions.']
      })
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    globalThis.fetch = fetchMock as typeof fetch

    const review = await reviewVisualArtifact({
      workspaceRoot,
      outputPath,
      manifestPath,
      task: 'Create a clean publication pipeline figure.',
    })

    expect(review).toMatchObject({
      ok: true,
      status: 'repair_required',
      reviewedArtifactPath: outputPath,
      reviewedArtifactHash: createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
      repairable: true,
      semantic: {
        pass: false,
        needsContext: false,
        violations: ['Large overlapping shapes obscure the content.']
      },
      nextAction: {
        kind: 'same_route_repair',
        route: 'hybrid',
        maxAttempts: 2,
        instructions: ['Rebuild the layout with non-overlapping regions.']
      },
      score: { semantic: 0.12 }
    })
    if (!review.ok) throw new Error(review.message)
    expect(Date.parse(review.reviewedAt)).not.toBeNaN()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:3892/v1/responses')
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(String(request.body)).toContain('input_image')
  })

  it('returns needs_context only when semantic review identifies missing external information', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const outputPath = join(workspaceRoot, 'context-blocked.png')
    const canvas = createCanvas(256, 256)
    writeFileSync(outputPath, canvas.toBuffer('image/png'))
    const manifestPath = writeReviewManifest(outputPath, draftVisualPlan)
    globalThis.fetch = vi.fn(async () => Response.json({
      output_text: JSON.stringify({
        pass: false,
        needsContext: true,
        score: 0.5,
        summary: 'The unresolved source value is required to verify the visual.',
        violations: ['A required source value is unresolved.'],
        repairInstructions: []
      })
    })) as unknown as typeof fetch

    const review = await reviewVisualArtifact({
      workspaceRoot,
      outputPath,
      manifestPath,
      task: 'Review a context-limited visual.'
    })

    expect(review).toMatchObject({
      ok: true,
      status: 'needs_context',
      repairable: false,
      semantic: { needsContext: true }
    })
  })

  it.each([
    ['publication_ready', modelVisualPlan],
    ['publication_ready', codeVisualPlan],
    ['draft_ready', draftVisualPlan]
  ] as const)('caps a passing unified review at %s', async (expectedStatus, visualPlan) => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const outputPath = join(workspaceRoot, `${expectedStatus}.png`)
    const canvas = createCanvas(256, 256)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 256, 256)
    context.fillStyle = '#2563eb'
    context.fillRect(32, 32, 192, 192)
    writeFileSync(outputPath, canvas.toBuffer('image/png'))
    const manifestPath = writeReviewManifest(outputPath, visualPlan)
    globalThis.fetch = vi.fn(async () => Response.json({
      output_text: JSON.stringify({
        pass: true,
        score: 1,
        summary: 'The artifact is release-quality.',
        violations: [],
        repairInstructions: []
      })
    })) as unknown as typeof fetch

    const review = await reviewVisualArtifact({
      workspaceRoot,
      outputPath,
      manifestPath,
      task: 'Review the release candidate.'
    })

    expect(review).toMatchObject({ ok: true, status: expectedStatus, repairable: false })
  })

  it('fails review closed when artifact bytes no longer match the render manifest', async () => {
    const outputPath = join(workspaceRoot, 'tampered.png')
    const canvas = createCanvas(256, 256)
    writeFileSync(outputPath, canvas.toBuffer('image/png'))
    const manifestPath = writeReviewManifest(outputPath)
    writeFileSync(outputPath, Buffer.concat([readFileSync(outputPath), Buffer.from('tampered')]))

    const review = await reviewVisualArtifact({
      workspaceRoot,
      outputPath,
      manifestPath,
      task: 'Review a tampered artifact.'
    })

    expect(review).toMatchObject({ ok: false, status: 'invalid_manifest' })
  })

  it('plans semantic flowcharts from prose as image-generation work', async () => {
    const plan = await planImageGeneration({
      workspaceRoot,
      task: '根据以下内容建一张流程图：One goal in reinforcement learning is to understand simulator usage from a paper excerpt.',
      visualPlan: modelVisualPlan
    })

    expect(plan.ok).toBe(true)
    expect(plan.recipe.mode).toBe('text_to_image')
    expect(plan.suggestedRenderTool).toBe('image_generation_render')
    expect(plan.visualPlan).toEqual(modelVisualPlan)
    expect(plan.recipe.prompt).toContain('SciForge semantic visual brief')
    expect(plan.recipe.prompt).toContain('full-canvas composition')
  })

  it('does not expand ordinary image prompts with semantic diagram instructions', async () => {
    const task = 'A clean science illustration with several labeled regions'
    const plan = await planImageGeneration({
      workspaceRoot,
      task
    })

    expect(plan.ok).toBe(true)
    expect(plan.recipe.prompt).toBe(task)
  })

  it('normalizes requested image size to provider-compatible multiples of 16', async () => {
    const plan = await planImageGeneration({
      workspaceRoot,
      task: 'A clean scientific cover-style illustration',
      size: { width: 1280, height: 900 },
      visualPlan: modelVisualPlan
    })

    expect(plan.ok).toBe(true)
    expect(plan.recipe.size).toEqual({ width: 1280, height: 896 })
    expect(plan.warnings.join(' ')).toContain('1280x896')
  })

  it('does not reclassify or block a terminal visual plan from prompt keywords', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'transformer-flowchart',
      recipe: {
        mode: 'text_to_image',
        prompt: '新建一张流程图，介绍 Transformer 框架和 Attention 数据流。',
        size: { width: 1024, height: 768 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.status).toBe('rendered_placeholder')
  })

  it('renders a budget-exhausted plan as a draft that remains review-bound', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'ungrounded-brief-flowchart',
      recipe: {
        mode: 'text_to_image',
        prompt: 'Create a standards-aligned workflow without inventing the unresolved standard.',
        size: { width: 1024, height: 768 },
        outputFormat: 'png',
        visualPlan: draftVisualPlan
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      visualPlan: {
        contextStatus: 'budget_exhausted',
        releaseCeiling: 'draft_ready'
      }
    })
    expect(result.warnings.join(' ')).toContain('draft_ready')
  })

  it('renders a non-destructive placeholder artifact when explicitly enabled for local tests', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'demo-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A clean science illustration with several labeled regions',
        size: { width: 512, height: 320 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.status).toBe('rendered_placeholder')
    expect(existsSync(result.outputPath)).toBe(true)
    expect(existsSync(result.manifestPath)).toBe(true)
    expect(existsSync(result.artifactManifestPath)).toBe(true)
    expect(readFileSync(result.outputPath).byteLength).toBeGreaterThan(1024)
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      kind: 'sciforge_artifact',
      sourceTool: 'image_generation',
      artifactKind: 'generated_image'
    })
  })

  it('records hybrid ownership directly from the unified visual plan', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const plan = await planImageGeneration({
      workspaceRoot,
      task: 'A Nature Methods scientific diagram of meiotic entry with labeled TF and kinase data traces',
      stylePreset: 'scientific_diagram',
      referencePath: 'research-briefs/meiotic-entry-figure-evidence.json',
      size: { width: 768, height: 512 },
      visualPlan: hybridVisualPlan
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.message)
    expect(plan.visualReviewWorkflow.join(' ')).toContain('deterministic composition')
    expect(plan.warnings.join(' ')).toContain('Hybrid ownership is locked')

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'scientific-base-layer',
      recipe: plan.recipe
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      visualPlan: hybridVisualPlan
    })
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      visualPlan: hybridVisualPlan
    })
  })

  it('requires the terminal handoff from visual_generate for image preparation', async () => {
    const result = await planImageGenerationEngine({
      workspaceRoot,
      task: 'A scientific mechanism diagram explaining protein regulation'
    } as ImageGenerationPlanRequest)

    expect(result).toMatchObject({
      ok: false,
      status: 'visual_plan_required',
      suggestedPlanTool: 'visual_generate'
    })
  })

  it('uploads hybrid source pixels through the image edit endpoint and records unified ownership', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    const sourcePath = join(workspaceRoot, 'controlled-source.png')
    const sourceBytes = Buffer.from(pngBase64, 'base64')
    writeFileSync(sourcePath, sourceBytes)
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3892/v1/images/edits')
      const body = init?.body as FormData
      expect(body.get('model')).toBe('sciforge-router')
      expect(body.get('input_fidelity')).toBe('high')
      expect(String(body.get('prompt'))).toContain('Hybrid visual-layer mode')
      expect(String(body.get('prompt'))).toContain('labels, values, and relationships')
      const uploaded = body.get('image') as File
      expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(sourceBytes)
      return new Response(JSON.stringify({
        data: [{ b64_json: pngBase64 }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'delta-polish',
      recipe: {
        mode: 'image_to_image',
        prompt: 'Add the model-owned background and visual style around the controlled source.',
        referencePath: sourcePath,
        size: { width: 512, height: 512 },
        outputFormat: 'png',
        visualPlan: {
          ...hybridVisualPlan,
          sourceArtifacts: [sourcePath],
          reproducibleInputs: [sourcePath]
        }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      visualPlan: {
        route: 'hybrid',
        sourceArtifacts: [sourcePath],
        lockedElements: hybridVisualPlan.lockedElements,
        modelOwnedElements: hybridVisualPlan.modelOwnedElements
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('records VisualDocument review metadata without mutating review state directly', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'visual-review-handoff',
      visualDocumentId: 'visual-document-123',
      threadId: 'thread-456',
      stageForVisualReview: true,
      recipe: {
        mode: 'text_to_image',
        prompt: 'A VisualDocument review image',
        size: { width: 512, height: 320 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      visualDocumentId: 'visual-document-123',
      threadId: 'thread-456',
      stageForVisualReview: true
    })
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      visualDocumentId: 'visual-document-123',
      threadId: 'thread-456',
      stageForVisualReview: true
    })
    expect(existsSync(join(workspaceRoot, '.sciforge/visual-documents/visual-document-123'))).toBe(false)
  })

  it('rejects output directories outside the workspace', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      outputDir: join(workspaceRoot, '..', 'escaped-images'),
      recipe: {
        mode: 'text_to_image',
        prompt: 'Path safety test',
        size: { width: 256, height: 256 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected render to fail')
    expect(result.status).toBe('invalid_workspace')
  })

  it('renders through the configured Model Router image endpoint', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://localhost:3892'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://localhost:3892/v1/images/generations') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer router-runtime-key')
        expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({ model: 'sciforge-router' })
        return new Response(JSON.stringify({
          data: [{ b64_json: pngBase64 }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('Unexpected URL ' + url)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'gemini-chat-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A tiny generated image',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.provider).toBe('image-endpoint')
    expect(existsSync(result.outputPath)).toBe(true)
    expect(readFileSync(result.outputPath).toString('base64')).toBe(pngBase64)
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://localhost:3892/v1/images/generations'
    ])
  })

  it('rejects external Model Router image base URLs before calling fetch', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'https://api.openai.example/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'external-router-base-url',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A tiny generated image',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected render to fail')
    expect(result.status).toBe('provider_failed')
    expect(result.message).toMatch(/SCIFORGE_MODEL_ROUTER_BASE_URL must point to the local SciForge Model Router/)
    expect(result.message).not.toContain('router-runtime-key')
    expect(result.message).not.toContain('api.openai.example')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed on image provider errors without creating a substitute artifact', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'upstream unavailable' }
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'provider-failure-no-fallback',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A conceptual landscape illustration',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result).toMatchObject({ ok: false, status: 'provider_failed' })
    expect(existsSync(join(workspaceRoot, '.sciforge/images/provider-failure-no-fallback.png'))).toBe(false)
    expect(existsSync(join(workspaceRoot, '.sciforge/images/provider-failure-no-fallback.manifest.json'))).toBe(false)
  })

  it('tells the model not to invent unresolved context in draft-only rendering', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:3892/v1/images/generations') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        expect(String(body.prompt)).toContain('Context-limited draft mode')
        expect(String(body.prompt)).toContain('Confirm the current external standard')
        return new Response(JSON.stringify({
          data: [{ b64_json: pngBase64 }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('Unexpected URL ' + url)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'context-limited-draft',
      recipe: {
        mode: 'text_to_image',
        prompt: 'Create a draft while preserving unresolved context explicitly.',
        size: { width: 512, height: 512 },
        outputFormat: 'png',
        visualPlan: draftVisualPlan
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.provider).toBe('image-endpoint')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch external provider image URLs returned by Model Router', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:3892/v1/images/generations') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer router-runtime-key')
        return new Response(JSON.stringify({
          data: [{ url: 'https://cdn.example/generated.png' }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('Unexpected URL ' + url)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'non-normalized-url-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A tiny generated image',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected render to fail')
    expect(result.status).toBe('provider_failed')
    expect(result.message).toMatch(/non-normalized image URL/)
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://127.0.0.1:3892/v1/images/generations'
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'sciforge-router'
    })
  })

  it('defaults configured Model Router image endpoint requests to the router model alias', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:3892/v1/images/generations') {
        return new Response(JSON.stringify({
          data: [{ b64_json: pngBase64 }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('Unexpected URL ' + url)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'default-model-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A tiny generated image',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'sciforge-router'
    })
  })

  it('retries the images endpoint with a text field for providers that do not accept prompt', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url !== 'http://127.0.0.1:3892/v1/images/generations') throw new Error('Unexpected URL ' + url)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if ('prompt' in body) {
        return new Response(JSON.stringify({
          error: { message: "Either 'text' or 'image' must be provided, but not both." }
        }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (body.text === 'A tiny generated image') {
        return new Response(JSON.stringify({
          data: [
            {
              b64_json: pngBase64
            }
          ]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('Unexpected request body ' + JSON.stringify(body))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'qwen-text-payload-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A tiny generated image',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.provider).toBe('image-endpoint')
    expect(readFileSync(result.outputPath).toString('base64')).toBe(pngBase64)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ prompt: 'A tiny generated image' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ text: 'A tiny generated image' })
  })

  it('routes visual-review color edits through the same Model Router image-edit path', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const sourcePath = join(workspaceRoot, 'source-diagram.png')
    const canvas = createCanvas(240, 160)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 240, 160)
    ctx.fillStyle = '#93c5fd'
    ctx.fillRect(24, 30, 76, 44)
    ctx.fillStyle = '#86efac'
    ctx.fillRect(138, 30, 76, 44)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(100, 52)
    ctx.lineTo(138, 52)
    ctx.stroke()
    ctx.fillStyle = '#111827'
    ctx.font = '16px sans-serif'
    ctx.fillText('A', 56, 58)
    ctx.fillText('B', 170, 58)
    writeFileSync(sourcePath, canvas.toBuffer('image/png'))

    const edited = createCanvas(240, 160)
    const editedContext = edited.getContext('2d')
    editedContext.drawImage(canvas, 0, 0)
    editedContext.fillStyle = '#c4b5fd'
    editedContext.fillRect(24, 30, 76, 44)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3892/v1/images/edits')
      const form = init?.body as FormData
      expect(form).toBeInstanceOf(FormData)
      expect(String(form.get('prompt'))).toContain('换个颜色')
      return Response.json({ data: [{ b64_json: edited.toBuffer('image/png').toString('base64') }] })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      imageId: 'color-edited-diagram',
      reviewPacket: {
        schemaVersion: 1,
        documentId: 'visual-document-test',
        sourceArtifact: {
          kind: 'generated_image',
          sourcePath: 'source-diagram.png',
          workingCopyPath: 'source-diagram.png'
        },
        annotations: [{
          id: 'annotation-color',
          kind: 'box',
          geometry: { kind: 'box', bounds: { x: 0.05, y: 0.1, width: 0.9, height: 0.7 } },
          instruction: '换个颜色',
          targetNodeIds: ['diagram-root'],
          status: 'open'
        }],
        truthLocks: [{ description: 'Preserve labels A and B' }],
        styleProfileRef: '.sciforge/visual-styles/manuscript-default.json'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.status).toBe('edited')
    expect(result.intents).toHaveLength(1)
    expect(result.intents[0]).toMatchObject({
      annotationIds: ['annotation-color'],
      targetNodeIds: ['diagram-root']
    })
    expect(result.intents[0]?.instruction).toContain('Preserve labels A and B')
    expect(result.intents[0]?.instruction).toContain('.sciforge/visual-styles/manuscript-default.json')
    expect(result.outputs[0]?.provider).toBe('image-endpoint')
    expect(existsSync(result.outputs[0]!.outputPath)).toBe(true)
    expect(readFileSync(result.outputs[0]!.outputPath).equals(readFileSync(sourcePath))).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const output = await loadImage(result.outputs[0]!.outputPath)
    expect(output.width).toBe(240)
    expect(output.height).toBe(160)
  })

  it('routes non-color visual-review edits through image-to-image with source pixels', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const sourcePath = join(workspaceRoot, 'arrow-source.png')
    const sourceCanvas = createCanvas(240, 160)
    const sourceContext = sourceCanvas.getContext('2d')
    sourceContext.fillStyle = '#ffffff'
    sourceContext.fillRect(0, 0, 240, 160)
    sourceContext.fillStyle = '#93c5fd'
    sourceContext.fillRect(24, 48, 72, 48)
    sourceContext.fillStyle = '#86efac'
    sourceContext.fillRect(144, 48, 72, 48)
    writeFileSync(sourcePath, sourceCanvas.toBuffer('image/png'))

    const editedCanvas = createCanvas(240, 160)
    const editedContext = editedCanvas.getContext('2d')
    editedContext.drawImage(sourceCanvas, 0, 0)
    const lightlyReencoded = editedContext.getImageData(0, 0, 240, 160)
    for (let index = 0; index < lightlyReencoded.data.length; index += 4) {
      lightlyReencoded.data[index] = Math.min(255, lightlyReencoded.data[index] + 4)
      lightlyReencoded.data[index + 1] = Math.min(255, lightlyReencoded.data[index + 1] + 4)
      lightlyReencoded.data[index + 2] = Math.min(255, lightlyReencoded.data[index + 2] + 4)
    }
    editedContext.putImageData(lightlyReencoded, 0, 0)
    editedContext.strokeStyle = '#111827'
    editedContext.lineWidth = 4
    editedContext.beginPath()
    editedContext.moveTo(96, 72)
    editedContext.lineTo(144, 72)
    editedContext.stroke()
    const editedBase64 = editedCanvas.toBuffer('image/png').toString('base64')

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3892/v1/images/edits')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer router-runtime-key')
      expect(init?.body).toBeInstanceOf(FormData)
      const form = init?.body as FormData
      expect(form.get('model')).toBe('sciforge-router')
      expect(form.get('size')).toBe('240x160')
      expect(form.get('input_fidelity')).toBe('high')
      expect(form.get('quality')).toBe('high')
      expect(String(form.get('prompt'))).toContain('Connect the arrow cleanly between both blocks')
      const sourceFile = form.get('image')
      expect(sourceFile).toBeInstanceOf(File)
      expect(Buffer.from(await (sourceFile as File).arrayBuffer()).equals(readFileSync(sourcePath))).toBe(true)
      const maskFile = form.get('mask')
      expect(maskFile).toBeInstanceOf(File)
      const maskImage = await loadImage(Buffer.from(await (maskFile as File).arrayBuffer()))
      expect({ width: maskImage.width, height: maskImage.height }).toEqual({ width: 240, height: 160 })
      const maskCanvas = createCanvas(maskImage.width, maskImage.height)
      const maskContext = maskCanvas.getContext('2d')
      maskContext.drawImage(maskImage, 0, 0)
      const alphaAt = (x: number, y: number) => maskContext.getImageData(x, y, 1, 1).data[3]
      expect(alphaAt(120, 72)).toBe(0) // arrow
      expect(alphaAt(30, 20)).toBe(0) // box
      expect(alphaAt(65, 126)).toBe(0) // freehand
      expect(alphaAt(204, 128)).toBe(0) // pin
      expect(alphaAt(120, 8)).toBe(255) // preserved background
      return Response.json({ data: [{ b64_json: editedBase64 }] })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      imageId: 'arrow-edited-diagram',
      reviewPacket: {
        schemaVersion: 1,
        documentId: 'visual-document-arrow-test',
        sourceArtifact: {
          kind: 'generated_image',
          sourcePath: 'arrow-source.png',
          workingCopyPath: 'arrow-source.png'
        },
        annotations: [{
          id: 'annotation-arrow',
          kind: 'arrow',
          geometry: { kind: 'arrow', from: { x: 0.4, y: 0.45 }, to: { x: 0.6, y: 0.45 } },
          instruction: 'Connect the arrow cleanly between both blocks.',
          targetNodeIds: ['connection'],
          status: 'open'
        }, {
          id: 'annotation-box',
          kind: 'box',
          geometry: { kind: 'box', bounds: { x: 0.1, y: 0.08, width: 0.08, height: 0.1 } },
          instruction: 'Align this component with the surrounding grid.',
          status: 'open'
        }, {
          id: 'annotation-freehand',
          kind: 'freehand',
          geometry: { kind: 'freehand', points: [{ x: 0.22, y: 0.75 }, { x: 0.3, y: 0.82 }] },
          instruction: 'Clean up the marked contour.',
          status: 'open'
        }, {
          id: 'annotation-pin',
          kind: 'pin',
          geometry: { kind: 'pin', point: { x: 0.85, y: 0.8 } },
          instruction: 'Correct the small artifact at this point.',
          status: 'open'
        }],
        truthLocks: [{ description: 'Preserve all existing text and colors' }]
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.outputs[0]?.provider).toBe('image-endpoint')
    expect(result.intents[0]?.selectedRegions?.map((region) => region.kind)).toEqual([
      'arrow', 'box', 'freehand', 'pin'
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [sourcePixels, outputPixels] = await Promise.all([
      decodedPixels(sourcePath),
      decodedPixels(result.outputs[0]!.outputPath)
    ])
    expect(outputPixels.equals(sourcePixels)).toBe(false)
    expect(existsSync(join(workspaceRoot, '.sciforge/images/visual-review-mask.png'))).toBe(false)
  })

  it('rejects a pixel-identical semantic edit even when the provider re-encodes the source', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    const sourcePath = join(workspaceRoot, 'no-op-source.png')
    const canvas = createCanvas(192, 128)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 192, 128)
    context.fillStyle = '#2563eb'
    context.fillRect(24, 32, 64, 40)
    const sourceBytes = canvas.toBuffer('image/png')
    // Valid PNG decoders ignore trailing provider metadata, so file bytes differ
    // while the decoded pixels remain exactly the same.
    const reencodedBytes = Buffer.concat([sourceBytes, Buffer.from('provider-metadata')])
    writeFileSync(sourcePath, sourceBytes)
    expect(reencodedBytes.equals(sourceBytes)).toBe(false)
    globalThis.fetch = vi.fn(async () => Response.json({
      data: [{ b64_json: reencodedBytes.toString('base64') }]
    })) as unknown as typeof fetch

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      imageId: 'no-op-semantic-edit',
      reviewPacket: {
        schemaVersion: 1,
        documentId: 'visual-document-no-op-test',
        sourceArtifact: {
          kind: 'generated_image',
          sourcePath: 'no-op-source.png',
          workingCopyPath: 'no-op-source.png'
        },
        annotations: [{
          id: 'annotation-layout',
          kind: 'box',
          geometry: { kind: 'box', bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
          instruction: 'Increase spacing between the diagram elements.',
          status: 'open'
        }]
      }
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'provider_failed',
      message: expect.stringMatching(/pixel-identical/i)
    })
    expect(existsSync(join(workspaceRoot, '.sciforge/images/no-op-semantic-edit.png'))).toBe(false)
  })

  it('rejects semantic edits whose output dimensions differ from the source contract', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    const sourcePath = join(workspaceRoot, 'dimension-source.png')
    const sourceCanvas = createCanvas(192, 128)
    const sourceContext = sourceCanvas.getContext('2d')
    sourceContext.fillStyle = '#ffffff'
    sourceContext.fillRect(0, 0, 192, 128)
    sourceContext.fillStyle = '#2563eb'
    sourceContext.fillRect(24, 32, 64, 40)
    writeFileSync(sourcePath, sourceCanvas.toBuffer('image/png'))
    const wrongSizeCanvas = createCanvas(128, 128)
    wrongSizeCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, 128, 128)
    globalThis.fetch = vi.fn(async (_input, init) => {
      const form = init?.body as FormData
      expect(form.get('size')).toBe('192x128')
      return Response.json({ data: [{ b64_json: wrongSizeCanvas.toBuffer('image/png').toString('base64') }] })
    }) as unknown as typeof fetch

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      imageId: 'wrong-size-semantic-edit',
      reviewPacket: {
        schemaVersion: 1,
        documentId: 'visual-document-dimension-test',
        sourceArtifact: {
          kind: 'generated_image',
          sourcePath: 'dimension-source.png',
          workingCopyPath: 'dimension-source.png'
        },
        annotations: [{
          id: 'annotation-spacing',
          kind: 'box',
          geometry: { kind: 'box', bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
          instruction: 'Move the right component farther from the left component.',
          status: 'open'
        }]
      }
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'provider_failed',
      message: expect.stringMatching(/expected the source size 192x128/i)
    })
    expect(existsSync(join(workspaceRoot, '.sciforge/images/wrong-size-semantic-edit.png'))).toBe(false)
  })

  it('gives an explicit mask precedence and rejects it when its dimensions do not match', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    const sourcePath = join(workspaceRoot, 'explicit-mask-source.png')
    const sourceCanvas = createCanvas(192, 128)
    const sourceContext = sourceCanvas.getContext('2d')
    sourceContext.fillStyle = '#ffffff'
    sourceContext.fillRect(0, 0, 192, 128)
    writeFileSync(sourcePath, sourceCanvas.toBuffer('image/png'))
    const explicitMaskPath = join(workspaceRoot, 'explicit-mask.png')
    const explicitMaskCanvas = createCanvas(32, 32)
    explicitMaskCanvas.getContext('2d').fillRect(0, 0, 32, 32)
    const explicitMaskBytes = explicitMaskCanvas.toBuffer('image/png')
    writeFileSync(explicitMaskPath, explicitMaskBytes)
    const editedCanvas = createCanvas(192, 128)
    editedCanvas.getContext('2d').fillRect(0, 0, 192, 128)
    globalThis.fetch = vi.fn(async (_input, init) => {
      const uploadedMask = (init?.body as FormData).get('mask') as File
      expect(Buffer.from(await uploadedMask.arrayBuffer()).equals(explicitMaskBytes)).toBe(true)
      return Response.json({ data: [{ b64_json: editedCanvas.toBuffer('image/png').toString('base64') }] })
    }) as unknown as typeof fetch

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      imageId: 'explicit-mask-mismatch',
      maskPath: 'explicit-mask.png',
      reviewPacket: {
        schemaVersion: 1,
        documentId: 'visual-document-explicit-mask-test',
        sourceArtifact: {
          kind: 'generated_image',
          sourcePath: 'explicit-mask-source.png',
          workingCopyPath: 'explicit-mask-source.png'
        },
        annotations: [{
          id: 'annotation-explicit-mask',
          kind: 'pin',
          geometry: { kind: 'pin', point: { x: 0.5, y: 0.5 } },
          instruction: 'Repair the marked point.',
          status: 'open'
        }]
      }
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'provider_failed',
      message: expect.stringMatching(/mask is 32x32.*expected the source size 192x128/i)
    })
    expect(existsSync(join(workspaceRoot, '.sciforge/images/explicit-mask-mismatch.png'))).toBe(false)
  })

  it('deterministically removes a provider whole-image redraw outside the padded mask', async () => {
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    const sourcePath = join(workspaceRoot, 'protected-region-source.png')
    const sourceCanvas = createCanvas(200, 160)
    const sourceContext = sourceCanvas.getContext('2d')
    sourceContext.fillStyle = '#ffffff'
    sourceContext.fillRect(0, 0, 200, 160)
    sourceContext.fillStyle = '#2563eb'
    sourceContext.fillRect(18, 18, 44, 36)
    writeFileSync(sourcePath, sourceCanvas.toBuffer('image/png'))

    const redrawnCanvas = createCanvas(200, 160)
    const redrawnContext = redrawnCanvas.getContext('2d')
    redrawnContext.drawImage(sourceCanvas, 0, 0)
    redrawnContext.fillStyle = '#111827'
    redrawnContext.fillRect(0, 0, 200, 160)
    globalThis.fetch = vi.fn(async () => Response.json({
      data: [{ b64_json: redrawnCanvas.toBuffer('image/png').toString('base64') }]
    })) as unknown as typeof fetch

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      imageId: 'protected-region-redraw',
      reviewPacket: {
        schemaVersion: 1,
        documentId: 'visual-document-protected-region-test',
        sourceArtifact: {
          kind: 'generated_image',
          sourcePath: 'protected-region-source.png',
          workingCopyPath: 'protected-region-source.png'
        },
        annotations: [{
          id: 'annotation-pin',
          kind: 'pin',
          geometry: { kind: 'pin', point: { x: 0.2, y: 0.22 } },
          instruction: 'Repair the small artifact at this point.',
          status: 'open'
        }]
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    const outputPath = result.outputs[0]!.outputPath
    const [sourceImage, outputImage] = await Promise.all([loadImage(sourcePath), loadImage(outputPath)])
    const inspectCanvas = createCanvas(200, 160)
    const inspectContext = inspectCanvas.getContext('2d')
    inspectContext.drawImage(sourceImage, 0, 0)
    const sourcePixels = inspectContext.getImageData(0, 0, 200, 160).data
    inspectContext.clearRect(0, 0, 200, 160)
    inspectContext.drawImage(outputImage, 0, 0)
    const outputPixels = inspectContext.getImageData(0, 0, 200, 160).data
    const pixel = (pixels: Uint8ClampedArray, x: number, y: number) => (
      Array.from(pixels.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 4))
    )
    expect(pixel(outputPixels, 40, 35)).not.toEqual(pixel(sourcePixels, 40, 35))
    expect(pixel(outputPixels, 160, 120)).toEqual(pixel(sourcePixels, 160, 120))
    expect(pixel(outputPixels, 100, 80)).toEqual(pixel(sourcePixels, 100, 80))
  })

  it('rejects packets outside the VisualDocument review schema', async () => {
    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      reviewPacket: { schemaVersion: 0 }
    })

    expect(result).toMatchObject({ ok: false, status: 'invalid_packet' })
  })

  it('segments generated framework images into component assets and edits selected component IDs', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'
    const sourcePath = join(workspaceRoot, 'framework-source.png')
    const canvas = createCanvas(360, 220)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 360, 220)
    ctx.fillStyle = '#bfdbfe'
    ctx.fillRect(28, 42, 112, 62)
    ctx.fillStyle = '#bbf7d0'
    ctx.fillRect(216, 42, 112, 62)
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(142, 73)
    ctx.lineTo(214, 73)
    ctx.stroke()
    ctx.fillStyle = '#111827'
    ctx.font = '18px sans-serif'
    ctx.fillText('Input', 58, 79)
    ctx.fillText('Model', 246, 79)
    writeFileSync(sourcePath, canvas.toBuffer('image/png'))
    const designPlanPath = join(workspaceRoot, 'framework-design-plan.json')
    writeFileSync(designPlanPath, JSON.stringify({
      version: 1,
      kind: 'sciforge_framework_design_plan',
      canvas: { width: 360, height: 220, background: '#ffffff', layout: 'test' },
      layoutSummary: 'Two module framework test',
      panels: [],
      regions: [{
        id: 'input-module',
        title: 'Input module',
        kind: 'module',
        purpose: 'Input processing',
        bbox: { x: 20, y: 34, w: 132, h: 82 },
        placeholderId: 'placeholder-input',
        assetPolicy: 'none',
        prompt: 'Input module',
        editable: true,
        sourceSpecRef: 'module.input'
      }],
      arrowStrategy: 'local',
      textStrategy: 'local',
      styleStrategy: 'local',
      confirmationSummary: 'test',
      checklist: []
    }, null, 2))

    const segmented = await segmentImageGenerationComponents({
      workspaceRoot,
      sourceImagePath: sourcePath,
      frameworkDesignPlanPath: designPlanPath,
      imageId: 'framework-source'
    })

    expect(segmented.ok).toBe(true)
    if (!segmented.ok) throw new Error(segmented.message)
    expect(existsSync(segmented.frameworkComponentManifestPath)).toBe(true)
    expect(existsSync(segmented.componentBasePath)).toBe(true)
    expect(segmented.componentAssetPaths.length).toBeGreaterThan(0)
    const componentManifest = JSON.parse(readFileSync(segmented.frameworkComponentManifestPath, 'utf8'))
    expect(componentManifest.components.length).toBeGreaterThan(0)
    const inputBlock = componentManifest.blocks?.find((block: { blockId?: string }) => block.blockId === 'block-region-input-module')
    expect(inputBlock).toMatchObject({
      blockId: 'block-region-input-module',
      blockType: 'module',
      sourceSpecRef: 'module.input'
    })
    expect(componentManifest.semanticLayerImages?.length).toBeGreaterThan(0)

    const edited = await editFrameworkComponentsWithImage2({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      componentManifestPath: segmented.frameworkComponentManifestPath,
      componentIds: [componentManifest.components[0].componentId],
      instruction: 'redraw this module as a darker blue method block',
      imageId: 'framework-source-edit'
    })

    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(edited.message)
    expect(existsSync(edited.outputPath)).toBe(true)
    expect(existsSync(edited.contactSheetPath)).toBe(true)
    expect(edited.target.componentIds).toContain(componentManifest.components[0].componentId)
  })

  it('uses the generic component segmentation runner protocol when configured', async () => {
    const sourcePath = join(workspaceRoot, 'generic-segmentation-source.png')
    const canvas = createCanvas(240, 160)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 240, 160)
    ctx.fillStyle = '#bfdbfe'
    ctx.fillRect(32, 36, 96, 64)
    ctx.fillStyle = '#111827'
    ctx.fillText('Block', 58, 72)
    writeFileSync(sourcePath, canvas.toBuffer('image/png'))

    const runnerPath = join(workspaceRoot, 'component-runner.cjs')
    writeFileSync(runnerPath, `#!/usr/bin/env node
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  if (process.argv[2] !== '--sciforge-component-json') {
    console.error('unexpected protocol arg ' + process.argv[2])
    process.exit(2)
  }
  const request = JSON.parse(input)
  if (request.kind !== 'sciforge_component_segmentation_request') {
    console.error('unexpected request kind ' + request.kind)
    process.exit(3)
  }
  process.stdout.write(JSON.stringify({
    components: [{
      id: 'runner-module',
      title: 'Runner module',
      semanticLayer: 'shape',
      type: 'module',
      role: 'primary',
      bbox: { x: 32, y: 36, w: 96, h: 64 },
      confidence: 0.97
    }]
  }))
})
`, 'utf8')
    chmodSync(runnerPath, 0o755)
    process.env.SCIFORGE_COMPONENT_SEGMENTATION_RUNNER = runnerPath
    process.env.SCIFORGE_COMPONENT_SEGMENTATION_MODEL_PATH = join(workspaceRoot, 'mock-component-model.pt')

    const segmented = await segmentImageGenerationComponents({
      workspaceRoot,
      sourceImagePath: sourcePath,
      imageId: 'generic-segmentation-source'
    })

    expect(segmented.ok).toBe(true)
    if (!segmented.ok) throw new Error(segmented.message)
    expect(existsSync(segmented.componentSegmentationPath)).toBe(true)
    expect(existsSync(segmented.componentSegmentationPreviewPath)).toBe(true)
    expect(segmented.fastSamSegmentationPath).toBe(segmented.componentSegmentationPath)
    const segmentation = JSON.parse(readFileSync(segmented.componentSegmentationPath, 'utf8'))
    expect(segmentation.kind).toBe('sciforge_framework_component_segmentation')
    expect(segmentation.prompts).toContain('external-component-segmentation-runner')
    const componentManifest = JSON.parse(readFileSync(segmented.frameworkComponentManifestPath, 'utf8'))
    expect(componentManifest).toMatchObject({
      componentSegmentationPath: segmented.componentSegmentationPath,
      fastSamSegmentationPath: segmented.componentSegmentationPath
    })
    expect(componentManifest.components.some((component: { detectionMethod?: string }) => component.detectionMethod === 'component_segmentation')).toBe(true)
  })

  it('edits legacy block manifests that use componentIds instead of childComponentIds', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'
    const sourcePath = join(workspaceRoot, 'legacy-block-source.png')
    const canvas = createCanvas(220, 140)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 220, 140)
    ctx.fillStyle = '#bfdbfe'
    ctx.fillRect(32, 30, 120, 70)
    writeFileSync(sourcePath, canvas.toBuffer('image/png'))

    const componentDir = join(workspaceRoot, 'legacy-components')
    const componentPath = join(componentDir, 'component-001.png')
    const basePath = join(workspaceRoot, 'legacy-base.png')
    mkdirSync(componentDir, { recursive: true })
    writeFileSync(componentPath, canvas.toBuffer('image/png'))
    writeFileSync(basePath, canvas.toBuffer('image/png'))
    const manifestPath = join(workspaceRoot, 'legacy-framework-components.json')
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      kind: 'sciforge_framework_components',
      createdAt: '2026-07-09T00:00:00.000Z',
      sourceImagePath: sourcePath,
      componentBasePath: basePath,
      componentDir,
      canvasSize: { width: 220, height: 140 },
      blocks: [{
        blockId: 'legacy-block',
        title: 'Legacy block',
        blockType: 'module',
        bbox: { x: 32, y: 30, w: 120, h: 70 },
        pixelBbox: { x: 32, y: 30, w: 120, h: 70 },
        role: 'primary',
        componentIds: ['component-001'],
        semanticLayers: ['shape'],
        detectionMethods: ['local_visual_subcomponent'],
        confidence: 0.8
      }],
      components: [{
        componentId: 'component-001',
        layerId: 'layer-001',
        type: 'module',
        title: 'Legacy module',
        bbox: { x: 32, y: 30, w: 120, h: 70 },
        pixelBbox: { x: 32, y: 30, w: 120, h: 70 },
        assetPath: componentPath,
        transparentAssetPath: componentPath,
        role: 'primary',
        qualityScore: 0.8,
        semanticLayer: 'shape',
        parentBlockId: 'legacy-block',
        detectionMethod: 'local_visual_subcomponent',
        confidence: 0.8
      }],
      warnings: []
    }, null, 2))

    const edited = await editFrameworkComponentsWithImage2({
      workspaceRoot,
      visualPlan: hybridVisualPlan,
      componentManifestPath: manifestPath,
      blockIds: ['legacy-block'],
      instruction: 'make this legacy block green',
      imageId: 'legacy-block-edit'
    })

    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(edited.message)
    expect(edited.target.componentIds).toContain('component-001')
  })

})
