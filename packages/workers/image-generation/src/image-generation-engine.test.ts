import { createCanvas, loadImage } from '@napi-rs/canvas'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  editFrameworkComponentsWithImage2,
  editImageFromCanvasPacket,
  getImageGenerationStatus,
  planImageGeneration,
  renderImageGeneration,
  segmentImageGenerationComponents
} from './image-generation-engine'

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
    expect(status.defaultModel).toBe('gpt-image-2')
    expect(status.warnings.length).toBeGreaterThan(0)
  })

  it('plans semantic flowcharts from prose as image-generation work', async () => {
    const plan = await planImageGeneration({
      workspaceRoot,
      task: '根据以下内容建一张流程图：One goal in reinforcement learning is to understand simulator usage from a paper excerpt.'
    })

    expect(plan.ok).toBe(true)
    expect(plan.recipe.mode).toBe('text_to_image')
    expect(plan.suggestedRenderTool).toBe('image_generation_render')
    expect(plan.upstreamResearchWorkflow).toMatchObject({
      recommended: true,
      suggestedBriefTool: 'scientific_plotting_research_brief',
      suggestedSearchTool: 'research_search'
    })
    expect(plan.visualRouting.modelSelectionHint).toContain('prose-to-visual flowcharts')
    expect(plan.visualRouting.useScientificPlottingWhen.join(' ')).toContain('structured numeric data charts')
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
      size: { width: 1280, height: 900 }
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
        outputFormat: 'png'
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
      size: { width: 768, height: 512 }
    })

    expect(plan.artifactPolicy).toContain('visual base layer')
    expect(plan.canvasWorkflow.join(' ')).toMatch(/script all labels/)
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

  it('records Canvas handoff metadata without mutating Canvas state directly', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'canvas-handoff',
      canvasId: 'canvas-123',
      threadId: 'thread-456',
      insertToCanvas: true,
      recipe: {
        mode: 'text_to_image',
        prompt: 'A Canvas handoff image',
        size: { width: 512, height: 320 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(JSON.parse(readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      canvasId: 'canvas-123',
      threadId: 'thread-456'
    })
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      canvasId: 'canvas-123',
      threadId: 'thread-456'
    })
    expect(existsSync(join(workspaceRoot, '.sciforge/canvases/canvas-123'))).toBe(false)
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
        outputFormat: 'png'
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

  it('keeps Canvas color edits source-preserving instead of running unrelated text-to-image generation', async () => {
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

    const result = await editImageFromCanvasPacket({
      workspaceRoot,
      imageId: 'color-edited-diagram',
      reviewPacket: {
        version: 1,
        canvasId: 'thread-test',
        artifacts: [
          {
            shapeId: 'shape:diagram',
            artifactKind: 'generated_image',
            outputPath: 'source-diagram.png',
            title: 'Diagram'
          }
        ],
        modificationSuggestions: [
          {
            targetShapeId: 'shape:diagram',
            annotationShapeId: 'shape:annotation',
            instruction: '换个颜色'
          }
        ]
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.status).toBe('edited')
    expect(result.outputs[0]?.provider).toBe('controlled-edit')
    expect(existsSync(result.outputs[0]!.outputPath)).toBe(true)
    expect(readFileSync(result.outputs[0]!.outputPath).equals(readFileSync(sourcePath))).toBe(false)
    expect(result.warnings.join(' ')).toContain('source-preserving controlled color edit')

    const output = await loadImage(result.outputs[0]!.outputPath)
    expect(output.width).toBe(240)
    expect(output.height).toBe(160)
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

})
