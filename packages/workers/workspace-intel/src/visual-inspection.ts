import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const MODEL_ROUTER_BASE_URL_ENV = 'SCIFORGE_MODEL_ROUTER_BASE_URL'
export const MODEL_ROUTER_RUNTIME_API_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY'
export const MODEL_ROUTER_VISUAL_MODEL_ENV = 'SCIFORGE_MODEL_ROUTER_VISUAL_MODEL'

const DEFAULT_VISUAL_INSPECTION_TIMEOUT_MS = 90_000
const DEFAULT_VISUAL_INSPECTION_PROMPT = [
  'Inspect this captured SciForge interface as visual QA evidence.',
  'Describe the visible content and identify layout problems such as clipping, overlap, illegible text, poor spacing, alignment, hierarchy, or contrast.',
  'Recommend concrete corrections. Do not infer content that is not visibly supported.'
].join(' ')

export type VisualInspectionRequest = {
  imagePath: string
  prompt?: string
  truthLockedElements?: string[]
}

export type VisualInspectionEvidence = {
  status: 'inspected'
  provider: 'model-router-vision'
  model: string
  inspectedAt: string
  captureSha256: string
  observationSha256: string
  attestation: string
  prompt: string
  summary: string
  visibleFacts: string[]
  layoutIssues: string[]
  recommendedActions: string[]
  confidence: number
}

export type VisualInspectionFailure = {
  status: 'visual_inspection_unavailable' | 'visual_inspection_invalid'
  message: string
}

export type VisualInspectionResult = VisualInspectionEvidence | VisualInspectionFailure

export type VisualInspector = (request: VisualInspectionRequest) => Promise<VisualInspectionResult>

export type ModelRouterVisualInspectorOptions = {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => Date
}

export function createModelRouterVisualInspector(
  options: ModelRouterVisualInspectorOptions
): VisualInspector {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, '')
  const apiKey = options.apiKey.trim()
  const model = options.model.trim()
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_VISUAL_INSPECTION_TIMEOUT_MS)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())

  return async (request) => {
    if (!baseUrl || !apiKey || !model) {
      return {
        status: 'visual_inspection_unavailable',
        message: 'Semantic visual inspection requires a configured local SciForge Model Router.'
      }
    }
    try {
      const image = await readFile(request.imagePath)
      const captureSha256 = sha256(image)
      const prompt = normalizedPrompt(request.prompt)
      const response = await fetchImpl(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          input: [{
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: visualInspectionInstruction(prompt, request.truthLockedElements ?? [])
              },
              {
                type: 'input_image',
                image_url: `data:image/png;base64,${image.toString('base64')}`,
                mime_type: 'image/png'
              }
            ]
          }]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      const raw = await response.text()
      if (!response.ok) {
        return {
          status: 'visual_inspection_unavailable',
          message: `Model Router visual inspection failed with HTTP ${response.status}.`
        }
      }
      const payload = parseJsonRecord(raw)
      const observationText = responseOutputText(payload)
      const observation = parseVisualObservation(observationText)
      if (!observation) {
        return {
          status: 'visual_inspection_invalid',
          message: 'Model Router visual inspection returned an invalid observation payload.'
        }
      }
      const inspectedAt = now().toISOString()
      const observationJson = JSON.stringify(observation)
      const observationSha256 = sha256(observationJson)
      return {
        status: 'inspected',
        provider: 'model-router-vision',
        model,
        inspectedAt,
        captureSha256,
        observationSha256,
        attestation: `sha256:${sha256(`${captureSha256}\0${prompt}\0${observationSha256}`)}`,
        prompt,
        ...observation
      }
    } catch (error) {
      return {
        status: 'visual_inspection_unavailable',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function modelRouterVisualInspectorFromEnv(
  env: NodeJS.ProcessEnv = process.env
): VisualInspector | undefined {
  const baseUrl = env[MODEL_ROUTER_BASE_URL_ENV]?.trim() ?? ''
  const apiKey = env[MODEL_ROUTER_RUNTIME_API_KEY_ENV]?.trim() ?? ''
  const model = env[MODEL_ROUTER_VISUAL_MODEL_ENV]?.trim() ?? ''
  if (!baseUrl || !apiKey || !model) return undefined
  return createModelRouterVisualInspector({ baseUrl, apiKey, model })
}

function visualInspectionInstruction(prompt: string, truthLockedElements: string[]): string {
  return [
    'You are the semantic vision stage of a fail-closed GUI visual QA workflow.',
    `Inspection task: ${prompt}`,
    `Truth-locked elements: ${JSON.stringify(truthLockedElements.slice(0, 64))}`,
    'Inspect only what is visibly supported by the supplied screenshot.',
    'Return JSON only with this schema:',
    '{"summary":string,"visibleFacts":string[],"layoutIssues":string[],"recommendedActions":string[],"confidence":number}',
    'confidence must be between 0 and 1. Use empty arrays when no issue is visible.'
  ].join('\n')
}

function normalizedPrompt(value: string | undefined): string {
  const trimmed = value?.trim().slice(0, 16_000)
  return trimmed || DEFAULT_VISUAL_INSPECTION_PROMPT
}

function responseOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const chunks: string[] = []
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    const record = asRecord(item)
    for (const content of Array.isArray(record.content) ? record.content : []) {
      const part = asRecord(content)
      const text = typeof part.text === 'string'
        ? part.text
        : typeof part.output_text === 'string'
          ? part.output_text
          : ''
      if (text) chunks.push(text)
    }
  }
  return chunks.join('\n')
}

function parseVisualObservation(text: string): {
  summary: string
  visibleFacts: string[]
  layoutIssues: string[]
  recommendedActions: string[]
  confidence: number
} | null {
  const candidate = text.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  let parsed: Record<string, unknown>
  try {
    parsed = parseJsonRecord(candidate)
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/u)
    if (!match) return null
    try {
      parsed = parseJsonRecord(match[0])
    } catch {
      return null
    }
  }
  const summary = stringValue(parsed.summary)
  const confidence = numberValue(parsed.confidence)
  if (!summary || confidence === null) return null
  return {
    summary,
    visibleFacts: stringArray(parsed.visibleFacts),
    layoutIssues: stringArray(parsed.layoutIssues),
    recommendedActions: stringArray(parsed.recommendedActions),
    confidence: Math.max(0, Math.min(1, confidence))
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
