import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const MODEL_ROUTER_BASE_URL_ENV = 'SCIFORGE_MODEL_ROUTER_BASE_URL'
export const MODEL_ROUTER_RUNTIME_API_KEY_ENV = 'SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY'
export const MODEL_ROUTER_VISUAL_MODEL_ENV = 'SCIFORGE_MODEL_ROUTER_VISUAL_MODEL'

export const GUI_QUALITY_REVIEW_TASK = [
  'Review the visible interface using only evidence in the supplied image.',
  'Identify content, legibility, clipping, overlap, spacing, alignment, hierarchy, and contrast issues.',
  'State actionable corrections as recommendation claims and do not infer unsupported content.'
].join(' ')

const DEFAULT_VISUAL_INSPECTION_TIMEOUT_MS = 90_000
const MAX_VISUAL_ARTIFACTS = 8

export type VisualArtifactMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

export type NormalizedVisualRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type VisualInputRegion = NormalizedVisualRegion & {
  id: string
  label?: string
}

export type VisualOutputIntent = {
  kind: 'description' | 'ocr' | 'comparison' | 'quality-review' | 'structured-extraction' | 'custom'
  instructions?: string
}

export type VisualInspectionArtifact = {
  id: string
  imagePath: string
  mimeType: VisualArtifactMimeType
  regions?: VisualInputRegion[]
}

export type VisualInspectionRequest = {
  task: string
  artifacts: VisualInspectionArtifact[]
  truthLocks?: string[]
  outputIntent?: VisualOutputIntent
}

export type VisualArtifactEvidence = {
  id: string
  mimeType: VisualArtifactMimeType
  sha256: string
}

export type VisualEvidenceClaim = {
  kind: 'observation' | 'issue' | 'recommendation'
  text: string
  artifactId: string
  region?: NormalizedVisualRegion
  confidence: number
}

export type VisualInspectionEvidence = {
  status: 'inspected'
  provider: 'model-router'
  model: string
  inspectedAt: string
  task: string
  artifacts: VisualArtifactEvidence[]
  requestSha256: string
  evidenceSha256: string
  attestation: string
  summary: string
  claims: VisualEvidenceClaim[]
  uncertainties: string[]
  structuredResult?: unknown
}

export type VisualInspectionFailureCode =
  | 'visual_inspection_unavailable'
  | 'vision_evidence_unavailable'
  | 'visual_evidence_synthesis_unavailable'
  | 'visual_inspection_invalid'
  | 'visual_evidence_grounding_missing'

export type VisualInspectionFailureClass =
  | 'upstream_unavailable'
  | 'capability_unavailable'
  | 'contract_violation'
  | 'evidence_unverified'
  | 'invalid_arguments'

export type VisualInspectionRecovery = {
  action: 'retry_visual_inspection' | 'stop'
  instruction: string
}

export type VisualInspectionFailure = {
  status: 'visual_inspection_unavailable' | 'visual_inspection_invalid'
  code: VisualInspectionFailureCode
  message: string
  failureClass: VisualInspectionFailureClass
  retryable: boolean
  recovery: VisualInspectionRecovery
  providerStage?: string
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
  const baseUrl = normalizedLocalModelRouterBaseUrl(options.baseUrl)
  const apiKey = options.apiKey.trim()
  const model = options.model.trim()
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_VISUAL_INSPECTION_TIMEOUT_MS)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())

  return async (request) => {
    if (!baseUrl || !apiKey || !model) {
      return {
        status: 'visual_inspection_unavailable',
        code: 'visual_inspection_unavailable',
        message: baseUrl === null
          ? 'Visual understanding requires a local SciForge Model Router URL at http(s)://<loopback>/v1.'
          : 'Visual understanding requires a configured SciForge Model Router.',
        failureClass: 'capability_unavailable',
        retryable: false,
        recovery: {
          action: 'stop',
          instruction: 'Configure the local SciForge Model Router and its vision translator before trying again.'
        }
      }
    }
    const normalized = normalizeRequest(request)
    if (!normalized) {
      return {
        status: 'visual_inspection_invalid',
        code: 'visual_inspection_invalid',
        message: 'Visual inspection requires a task and between 1 and 8 valid image artifacts.',
        failureClass: 'invalid_arguments',
        retryable: false,
        recovery: {
          action: 'stop',
          instruction: 'Correct the visual inspection task and artifact inputs before trying again.'
        }
      }
    }
    let loadedArtifacts: Array<VisualInspectionArtifact & { bytes: Buffer; sha256: string }>
    try {
      loadedArtifacts = await Promise.all(normalized.artifacts.map(async (artifact) => {
        const bytes = await readFile(artifact.imagePath)
        return {
          ...artifact,
          bytes,
          sha256: sha256(bytes)
        }
      }))
    } catch {
      return {
        status: 'visual_inspection_unavailable',
        code: 'visual_inspection_unavailable',
        message: 'A visual artifact could not be read.',
        failureClass: 'capability_unavailable',
        retryable: false,
        recovery: {
          action: 'stop',
          instruction: 'Restore the visual artifact and ensure it is readable before trying again.'
        }
      }
    }
    const artifactEvidence = loadedArtifacts.map(({ id, mimeType, sha256: artifactSha256 }) => ({
      id,
      mimeType,
      sha256: artifactSha256
    }))
    const requestDescriptor = {
      task: normalized.task,
      artifacts: loadedArtifacts.map(({ id, mimeType, regions, sha256: artifactSha256 }) => ({
        id,
        mimeType,
        sha256: artifactSha256,
        ...(regions?.length ? { regions } : {})
      })),
      truthLocks: normalized.truthLocks,
      outputIntent: normalized.outputIntent
    }
    const requestSha256 = sha256(stableJson(requestDescriptor))
    try {
      const response = await fetchImpl(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'x-sciforge-model-router-evidence-policy': 'required'
        },
        body: JSON.stringify({
          model,
          input: [{
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: visualInspectionInstruction(requestDescriptor)
              },
              ...loadedArtifacts.flatMap((artifact) => [
                {
                  type: 'input_text',
                  text: `Artifact ${JSON.stringify(artifact.id)} follows.`
                },
                {
                  type: 'input_image',
                  image_url: `data:${artifact.mimeType};base64,${artifact.bytes.toString('base64')}`,
                  mime_type: artifact.mimeType
                }
              ])
            ]
          }]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      const raw = await response.text()
      if (!response.ok) {
        return parseModelRouterFailure(raw, response.status)
      }
      const payload = tryParseJsonRecord(raw)
      if (!payload) return invalidEvidenceFailure()
      const observationText = responseOutputText(payload)
      const parsedObservation = parseVisualEvidence(
        observationText,
        new Set(artifactEvidence.map(({ id }) => id))
      )
      if (!parsedObservation.ok) {
        return parsedObservation.reason === 'grounding_missing'
          ? groundingFailure()
          : invalidEvidenceFailure()
      }
      const observation = parsedObservation.evidence
      const inspectedAt = now().toISOString()
      const evidenceSha256 = sha256(stableJson(observation))
      return {
        status: 'inspected',
        provider: 'model-router',
        model,
        inspectedAt,
        task: normalized.task,
        artifacts: artifactEvidence,
        requestSha256,
        evidenceSha256,
        attestation: `sha256:${sha256(`${requestSha256}\0${evidenceSha256}`)}`,
        ...observation
      }
    } catch {
      return {
        status: 'visual_inspection_unavailable',
        code: 'visual_inspection_unavailable',
        message: 'Model Router visual inspection could not be reached.',
        failureClass: 'upstream_unavailable',
        retryable: true,
        recovery: {
          action: 'retry_visual_inspection',
          instruction: 'Retry the visual inspection after Model Router connectivity recovers.'
        },
        providerStage: 'model_router_transport'
      }
    }
  }
}

function normalizedLocalModelRouterBaseUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.includes('?') || raw.includes('#')) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    !isLoopbackHostname(url.hostname)
  ) return null
  const pathname = url.pathname.replace(/\/+$/u, '')
  if (pathname !== '/v1') return null
  return `${url.origin}/v1`
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/gu, '')
  if (hostname === 'localhost' || hostname === '::1') return true
  const octets = hostname.split('.')
  return octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
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

function normalizeRequest(request: VisualInspectionRequest): VisualInspectionRequest | null {
  const task = request.task.trim().slice(0, 16_000)
  if (!task || request.artifacts.length < 1 || request.artifacts.length > MAX_VISUAL_ARTIFACTS) return null
  const artifactIds = new Set<string>()
  const artifacts: VisualInspectionArtifact[] = []
  for (const artifact of request.artifacts) {
    const id = artifact.id.trim().slice(0, 128)
    if (!id || artifactIds.has(id) || !artifact.imagePath || !isSupportedMimeType(artifact.mimeType)) return null
    artifactIds.add(id)
    if ((artifact.regions?.length ?? 0) > 64) return null
    const regionIds = new Set<string>()
    const regions = artifact.regions?.map((region) => {
      const label = region.label?.trim().slice(0, 512)
      return {
        ...region,
        id: region.id.trim().slice(0, 128),
        ...(label ? { label } : {})
      }
    })
    for (const region of regions ?? []) {
      if (!isValidInputRegion(region) || regionIds.has(region.id)) return null
      regionIds.add(region.id)
    }
    artifacts.push({
      id,
      imagePath: artifact.imagePath,
      mimeType: artifact.mimeType,
      ...(regions?.length ? { regions } : {})
    })
  }
  return {
    task,
    artifacts,
    ...(request.truthLocks?.length
      ? { truthLocks: request.truthLocks.map((lock) => lock.trim().slice(0, 1_000)).filter(Boolean).slice(0, 64) }
      : {}),
    ...(request.outputIntent ? { outputIntent: request.outputIntent } : {})
  }
}

function visualInspectionInstruction(request: {
  task: string
  artifacts: Array<Omit<VisualInspectionArtifact, 'imagePath'> & { sha256: string }>
  truthLocks?: string[]
  outputIntent?: VisualOutputIntent
}): string {
  return [
    'You are the visual understanding stage of SciForge. All model inference is mediated by the SciForge Model Router.',
    `Task: ${request.task}`,
    `Artifacts: ${JSON.stringify(request.artifacts)}`,
    `Truth locks: ${JSON.stringify(request.truthLocks ?? [])}`,
    `Output intent: ${JSON.stringify(request.outputIntent ?? { kind: 'description' })}`,
    'Use only evidence visibly supported by the supplied artifacts. Never invent an artifact id.',
    'A successful inspection must include at least one visibly grounded claim for every supplied artifact. If an artifact could not be inspected, return no claim for it; the caller will reject the inspection.',
    'Regions use normalized image coordinates from 0 to 1. Omit a region when the claim applies to the whole artifact.',
    'Return JSON only with this schema:',
    '{"summary":string,"claims":[{"kind":"observation"|"issue"|"recommendation","text":string,"artifactId":string,"region"?:{"x":number,"y":number,"width":number,"height":number},"confidence":number}],"uncertainties":string[],"structuredResult"?:any}',
    'Each confidence must be between 0 and 1. Use empty arrays when there are no claims or uncertainties.'
  ].join('\n')
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

type ParsedVisualEvidence = {
  summary: string
  claims: VisualEvidenceClaim[]
  uncertainties: string[]
  structuredResult?: unknown
}

function parseVisualEvidence(text: string, artifactIds: Set<string>): {
  ok: true
  evidence: ParsedVisualEvidence
} | {
  ok: false
  reason: 'invalid_payload' | 'grounding_missing'
} {
  const parsed = parseEmbeddedJson(text)
  if (!parsed) return { ok: false, reason: 'invalid_payload' }
  const summary = stringValue(parsed.summary)
  if (!summary || !Array.isArray(parsed.claims) || !Array.isArray(parsed.uncertainties)) {
    return { ok: false, reason: 'invalid_payload' }
  }
  const claims: VisualEvidenceClaim[] = []
  const claimedArtifactIds = new Set<string>()
  for (const item of parsed.claims) {
    const record = asRecord(item)
    const kind = stringValue(record.kind)
    const claimText = stringValue(record.text)
    const artifactId = stringValue(record.artifactId)
    const confidence = numberValue(record.confidence)
    if (
      !isClaimKind(kind) ||
      !claimText ||
      !artifactIds.has(artifactId) ||
      confidence === null ||
      confidence < 0 ||
      confidence > 1
    ) return { ok: false, reason: 'invalid_payload' }
    const region = record.region === undefined ? undefined : normalizedRegion(record.region)
    if (record.region !== undefined && !region) return { ok: false, reason: 'invalid_payload' }
    claims.push({ kind, text: claimText, artifactId, ...(region ? { region } : {}), confidence })
    claimedArtifactIds.add(artifactId)
  }
  if ([...artifactIds].some((artifactId) => !claimedArtifactIds.has(artifactId))) {
    return { ok: false, reason: 'grounding_missing' }
  }
  const uncertainties = stringArray(parsed.uncertainties)
  if (uncertainties.length !== parsed.uncertainties.length) {
    return { ok: false, reason: 'invalid_payload' }
  }
  return {
    ok: true,
    evidence: {
      summary,
      claims,
      uncertainties,
      ...(Object.prototype.hasOwnProperty.call(parsed, 'structuredResult')
        ? { structuredResult: parsed.structuredResult }
        : {})
    }
  }
}

function parseModelRouterFailure(raw: string, httpStatus: number): VisualInspectionFailure {
  const payload = tryParseJsonRecord(raw)
  const error = asRecord(payload?.error)
  const code = stringValue(error.code)
  const message = stringValue(error.message)
  const failureClass = stringValue(error.failureClass)
  const retryable = error.retryable
  const recovery = asRecord(error.recovery)
  const recoveryAction = stringValue(recovery.action)
  const recoveryInstruction = stringValue(recovery.instruction)
  const providerStage = stringValue(error.stage)
  if (
    code &&
    message &&
    isVisualInspectionFailureClass(failureClass) &&
    typeof retryable === 'boolean' &&
    isVisualInspectionRecoveryAction(recoveryAction) &&
    recoveryInstruction
  ) {
    return {
      status: typedFailureStatus(code, failureClass),
      code: typedFailureCode(code, failureClass),
      message,
      failureClass,
      retryable,
      recovery: {
        action: recoveryAction,
        instruction: recoveryInstruction
      },
      ...(providerStage ? { providerStage } : {})
    }
  }
  return httpFailure(httpStatus)
}

function typedFailureStatus(
  code: string,
  failureClass: VisualInspectionFailureClass
): VisualInspectionFailure['status'] {
  return code === 'visual_inspection_invalid' ||
    code === 'visual_evidence_grounding_missing' ||
    failureClass === 'contract_violation' ||
    failureClass === 'evidence_unverified' ||
    failureClass === 'invalid_arguments'
    ? 'visual_inspection_invalid'
    : 'visual_inspection_unavailable'
}

function typedFailureCode(
  code: string,
  failureClass: VisualInspectionFailureClass
): VisualInspectionFailureCode {
  if (code === 'vision_evidence_unavailable' || code === 'visual_evidence_synthesis_unavailable') {
    return code
  }
  if (code === 'visual_evidence_grounding_missing' || failureClass === 'evidence_unverified') {
    return 'visual_evidence_grounding_missing'
  }
  return typedFailureStatus(code, failureClass) === 'visual_inspection_invalid'
    ? 'visual_inspection_invalid'
    : 'visual_inspection_unavailable'
}

function httpFailure(httpStatus: number): VisualInspectionFailure {
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    return {
      status: 'visual_inspection_unavailable',
      code: 'visual_inspection_unavailable',
      message: `Model Router visual inspection failed with HTTP ${httpStatus}.`,
      failureClass: 'upstream_unavailable',
      retryable: true,
      recovery: {
        action: 'retry_visual_inspection',
        instruction: 'Retry the visual inspection after the Model Router or upstream provider recovers.'
      },
      providerStage: 'model_router_transport'
    }
  }
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404 || httpStatus === 405) {
    return {
      status: 'visual_inspection_unavailable',
      code: 'visual_inspection_unavailable',
      message: `Model Router visual inspection failed with HTTP ${httpStatus}.`,
      failureClass: 'capability_unavailable',
      retryable: false,
      recovery: {
        action: 'stop',
        instruction: 'Restore Model Router authorization and visual capability configuration before trying again.'
      },
      providerStage: 'model_router_transport'
    }
  }
  return {
    status: 'visual_inspection_invalid',
    code: 'visual_inspection_invalid',
    message: `Model Router rejected the visual inspection request with HTTP ${httpStatus}.`,
    failureClass: 'invalid_arguments',
    retryable: false,
    recovery: {
      action: 'stop',
      instruction: 'Correct the visual inspection request before trying again.'
    },
    providerStage: 'model_router_transport'
  }
}

function invalidEvidenceFailure(): VisualInspectionFailure {
  return {
    status: 'visual_inspection_invalid',
    code: 'visual_inspection_invalid',
    message: 'Model Router visual inspection returned an invalid evidence payload.',
    failureClass: 'contract_violation',
    retryable: false,
    recovery: {
      action: 'stop',
      instruction: 'Stop retrying this result and inspect the Model Router visual evidence trace.'
    },
    providerStage: 'evidence_validation'
  }
}

function groundingFailure(): VisualInspectionFailure {
  return {
    status: 'visual_inspection_invalid',
    code: 'visual_evidence_grounding_missing',
    message: 'Model Router visual evidence is missing a grounded claim for an input artifact.',
    failureClass: 'evidence_unverified',
    retryable: false,
    recovery: {
      action: 'stop',
      instruction: 'Stop retrying this result because the returned visual evidence could not be verified.'
    },
    providerStage: 'evidence_validation'
  }
}

function parseEmbeddedJson(value: string): Record<string, unknown> | null {
  const candidate = value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  try {
    return parseJsonRecord(candidate)
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/u)
    if (!match) return null
    try {
      return parseJsonRecord(match[0])
    } catch {
      return null
    }
  }
}

function normalizedRegion(value: unknown): NormalizedVisualRegion | null {
  const record = asRecord(value)
  const x = numberValue(record.x)
  const y = numberValue(record.y)
  const width = numberValue(record.width)
  const height = numberValue(record.height)
  if (
    x === null || y === null || width === null || height === null ||
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x + width > 1 || y + height > 1
  ) return null
  return { x, y, width, height }
}

function isValidInputRegion(region: VisualInputRegion): boolean {
  return Boolean(region.id.trim()) && normalizedRegion(region) !== null
}

function isSupportedMimeType(value: string): value is VisualArtifactMimeType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp'
}

function isClaimKind(value: string): value is VisualEvidenceClaim['kind'] {
  return value === 'observation' || value === 'issue' || value === 'recommendation'
}

function isVisualInspectionFailureClass(value: string): value is VisualInspectionFailureClass {
  return value === 'upstream_unavailable' ||
    value === 'capability_unavailable' ||
    value === 'contract_violation' ||
    value === 'evidence_unverified' ||
    value === 'invalid_arguments'
}

function isVisualInspectionRecoveryAction(
  value: string
): value is VisualInspectionRecovery['action'] {
  return value === 'retry_visual_inspection' || value === 'stop'
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return parseJsonRecord(value)
  } catch {
    return null
  }
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
