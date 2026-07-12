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

function planImageGeneration(
  request: Parameters<typeof planImageGenerationEngine>[0]
) {
  return planImageGenerationEngine({
    ...request,
    ...(!request.scientificVisualPlan && !request.creativeDirect ? { creativeDirect: true as const } : {})
  })
}

function renderImageGeneration(
  request: Parameters<typeof renderImageGenerationEngine>[0]
) {
  return renderImageGenerationEngine({
    ...request,
    recipe: {
      ...request.recipe,
      ...(!request.recipe.scientificVisualPlan && !request.recipe.creativeDirect ? { creativeDirect: true as const } : {})
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
  const generativeScientificPlan = {
    route: 'generative_visual' as const,
    routeLocked: true as const,
    rationale: 'The requested artifact explains scientific concepts rather than encoding numeric data.',
    reproducibleInputs: [],
    truthLockedElements: ['scientific labels and relationships'],
    fallbackPolicy: 'fail_closed' as const
  }

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

    const review = await reviewVisualArtifact({
      workspaceRoot,
      outputPath,
      task: 'Review a publication figure.',
      truthLockedElements: ['all labels remain legible']
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
      task: 'Create a clean publication pipeline figure.',
      truthLockedElements: ['pipeline stage labels']
    })

    expect(review).toMatchObject({
      ok: true,
      reviewedArtifactPath: outputPath,
      reviewedArtifactHash: createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
      repairable: true,
      semantic: {
        pass: false,
        violations: ['Large overlapping shapes obscure the content.']
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

  it('plans semantic flowcharts from prose as image-generation work', async () => {
    const plan = await planImageGeneration({
      workspaceRoot,
      task: '根据以下内容建一张流程图：One goal in reinforcement learning is to understand simulator usage from a paper excerpt.',
      scientificVisualPlan: generativeScientificPlan
    })

    expect(plan.ok).toBe(true)
    expect(plan.recipe.mode).toBe('text_to_image')
    expect(plan.suggestedRenderTool).toBe('image_generation_render')
    expect(plan.upstreamResearchWorkflow).toMatchObject({
      recommended: true,
      suggestedBriefTool: 'scientific_plotting_research_brief',
      suggestedSearchTool: 'research_search'
    })
    expect(plan.scientificVisualPlan).toEqual(generativeScientificPlan)
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
      scientificVisualPlan: generativeScientificPlan
    })

    expect(plan.ok).toBe(true)
    expect(plan.recipe.size).toEqual({ width: 1280, height: 896 })
    expect(plan.warnings.join(' ')).toContain('1280x896')
  })

  it('blocks ungrounded scientific semantic figure rendering until research brief evidence exists', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'transformer-flowchart',
      recipe: {
        mode: 'text_to_image',
        prompt: '新建一张流程图，介绍 Transformer 框架和 Attention 数据流。',
        size: { width: 1024, height: 768 },
        outputFormat: 'png',
        scientificVisualPlan: generativeScientificPlan
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected render to require research first')
    expect(result.status).toBe('research_required')
    expect(result.upstreamResearchWorkflow).toMatchObject({
      recommended: true,
      suggestedBriefTool: 'scientific_plotting_research_brief'
    })
  })

  it('does not treat an unconfirmed research brief prompt as grounding evidence', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'ungrounded-brief-flowchart',
      recipe: {
        mode: 'text_to_image',
        prompt: [
          'Task: 新建一张论文级 Transformer 流程图。',
          'Figure need: Method flow (diagram_spec_or_image_generation).',
          'Reference papers and figure evidence:',
          'No reference papers confirmed yet. Search related CNS/top-conference/domain papers before rendering.',
          'Next controlled tool: research_search first, then scientific_plotting_research_brief again.'
        ].join('\n'),
        size: { width: 1024, height: 768 },
        outputFormat: 'png',
        scientificVisualPlan: generativeScientificPlan
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected render to require research first')
    expect(result.status).toBe('research_required')
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

  it('records scientific generated images as visual base layers requiring scripted overlays', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const plan = await planImageGeneration({
      workspaceRoot,
      task: 'A Nature Methods scientific diagram of meiotic entry with labeled TF and kinase data traces',
      stylePreset: 'scientific_diagram',
      referencePath: 'research-briefs/meiotic-entry-figure-evidence.json',
      size: { width: 768, height: 512 },
      scientificVisualPlan: generativeScientificPlan
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.message)
    expect(plan.artifactPolicy).toContain('visual base layer')
    expect(plan.visualReviewWorkflow.join(' ')).toMatch(/script all labels/)
    expect(plan.warnings.join(' ')).toMatch(/deterministic scripts/)

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'scientific-base-layer',
      recipe: plan.recipe
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.usagePolicy).toMatchObject({
      role: 'visual_composition_base',
      deterministicOverlayRequired: true,
      overlayToolchain: 'script_or_scientific_plotting'
    })
    expect(result.warnings.join(' ')).toMatch(/scientific_plotting/)
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      usagePolicy: {
        role: 'visual_composition_base',
        deterministicOverlayRequired: true
      }
    })
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      usagePolicy: {
        role: 'visual_composition_base',
        deterministicOverlayRequired: true
      }
    })
  })

  it('requires a locked unified visual plan for scientific image preparation', async () => {
    const result = await planImageGenerationEngine({
      workspaceRoot,
      task: 'A scientific mechanism diagram explaining protein regulation'
    })

    expect(result).toMatchObject({
      ok: false,
      status: 'scientific_visual_plan_required',
      suggestedPlanTool: 'scientific_visual_plan'
    })
  })

  it('allows grounded scientific delta polish and records locked facts in manifests', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:3892/v1/images/generations')
      const body = JSON.parse(String(init?.body ?? '{}'))
      expect(body.prompt).toContain('Scientific delta-only polish mode')
      expect(body.prompt).toContain('Locked scientific facts: numeric values; axes labels; p-values')
      expect(body.prompt).toContain('Source controlled artifacts: .sciforge/figures/benchmark.manifest.json')
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
        mode: 'text_to_image',
        prompt: 'Polish this scientific paper figure with callouts and panel stitching.',
        size: { width: 512, height: 512 },
        outputFormat: 'png',
        controlledSubfigureManifests: ['.sciforge/figures/benchmark.manifest.json'],
        scientificPolishDeltaPlan: {
          mode: 'delta_only',
          allowedOperations: ['panel_stitching', 'callout_overlay', 'visual_unification'],
          lockedFacts: ['numeric values', 'axes labels', 'p-values'],
          handoffPrompt: 'Use visual delta polish only; do not replace scientific panels.'
        },
        scientificVisualPlan: {
          ...generativeScientificPlan,
          route: 'hybrid_composite',
          reproducibleInputs: ['.sciforge/figures/benchmark.manifest.json']
        }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.usagePolicy).toMatchObject({
      role: 'visual_composition_base',
      lockedFacts: ['numeric values', 'axes labels', 'p-values'],
      sourceControlledArtifacts: ['.sciforge/figures/benchmark.manifest.json']
    })
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      scientificPolishDeltaPlan: {
        mode: 'delta_only',
        lockedFacts: ['numeric values', 'axes labels', 'p-values']
      },
      controlledSubfigureManifests: ['.sciforge/figures/benchmark.manifest.json'],
      lockedFacts: ['numeric values', 'axes labels', 'p-values'],
      sourceControlledArtifacts: ['.sciforge/figures/benchmark.manifest.json'],
      usagePolicy: {
        role: 'visual_composition_base',
        deterministicOverlayRequired: true,
        lockedFacts: ['numeric values', 'axes labels', 'p-values']
      }
    })
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      lockedFacts: ['numeric values', 'axes labels', 'p-values'],
      sourceControlledArtifacts: ['.sciforge/figures/benchmark.manifest.json']
    })
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

  it('asks the image endpoint for unlabeled scientific base images', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY = 'router-runtime-key'
    process.env.SCIFORGE_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
    process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL = 'sciforge-router'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'http://127.0.0.1:3892/v1/images/generations') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        expect(String(body.prompt)).toContain('render an unlabeled visual composition')
        expect(String(body.prompt)).toContain('Do not include readable labels')
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
      imageId: 'unlabeled-science-base',
      recipe: {
        mode: 'text_to_image',
        prompt: 'Scientific figure showing meiotic entry labels and quantitative data tracks',
        referencePath: 'research-briefs/meiotic-entry-figure-evidence.json',
        size: { width: 512, height: 512 },
        outputFormat: 'png',
        scientificVisualPlan: generativeScientificPlan
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

  it('keeps visual-review color edits source-preserving instead of running unrelated text-to-image generation', async () => {
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

    const result = await editImageFromVisualReviewPacket({
      workspaceRoot,
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
    expect(result.outputs[0]?.provider).toBe('controlled-edit')
    expect(existsSync(result.outputs[0]!.outputPath)).toBe(true)
    expect(readFileSync(result.outputs[0]!.outputPath).equals(readFileSync(sourcePath))).toBe(false)
    expect(result.warnings.join(' ')).toContain('source-preserving controlled color edit')

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
