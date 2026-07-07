import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getImageGenerationStatus,
  planImageGeneration,
  renderImageGeneration
} from './image-generation-engine'

let workspaceRoot = ''
let previousAllowPlaceholder: string | undefined
let previousRouterApiKey: string | undefined
let previousRouterBaseUrl: string | undefined
let previousRouterImageModel: string | undefined
let previousFetch: typeof fetch | undefined

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'image-generation-'))
  previousAllowPlaceholder = process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER
  previousRouterApiKey = process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY
  previousRouterBaseUrl = process.env.SCIFORGE_MODEL_ROUTER_BASE_URL
  previousRouterImageModel = process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL
  previousFetch = globalThis.fetch
  delete process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY
  delete process.env.SCIFORGE_MODEL_ROUTER_BASE_URL
  delete process.env.SCIFORGE_MODEL_ROUTER_IMAGE_MODEL
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
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = ''
})

describe('image generation engine', () => {
  it('reports a degraded placeholder provider when no Model Router image endpoint is configured', async () => {
    const status = await getImageGenerationStatus(workspaceRoot)

    expect(status.ok).toBe(true)
    expect(status.provider).toBe('placeholder')
    expect(status.configured).toBe(false)
    expect(status.warnings.length).toBeGreaterThan(0)
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
})
