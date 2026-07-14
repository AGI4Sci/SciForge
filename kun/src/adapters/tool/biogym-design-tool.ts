import { z } from 'zod'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const BIOGYM_DESIGN_TOOL_NAME = 'biogym_design'
export const BIOGYM_DESIGN_PROVIDER_ID = 'biogym-design'
export const BIOGYM_INTERNAL_PROTOCOL_VERSION = 1 as const
export const BIOGYM_INTERNAL_DESIGN_PATH = '/v1/biogym/design'

const BIOGYM_INTERNAL_TIMEOUT_MS = 10_000
const BIOGYM_INTERNAL_RESPONSE_MAX_BYTES = 1_048_576
const DESIGN_RUN_ID_PATTERN = /^design-[a-f0-9]{24}$/

const workflowSchema = z.enum([
  'de_novo_scaffold',
  'fixed_backbone',
  'target_binder'
])

const runInputSchema = z.object({
  backbonePath: z.string().trim().min(1).optional(),
  targetStructurePath: z.string().trim().min(1).optional(),
  targetChain: z.string().trim().min(1).max(32).optional(),
  hotspotResidues: z.array(z.string().trim().min(1).max(64)).max(256).optional()
}).strict()

const runBudgetSchema = z.object({
  maxGpuJobs: z.number().int().min(1).max(20).optional(),
  maxWallclockHours: z.number().positive().max(12).optional(),
  maxCandidatesPerStage: z.number().int().min(1).max(20).optional()
}).strict()

const backboneStageSchema = z.object({
  kind: z.literal('backbone'),
  lengthRange: z.tuple([
    z.number().int().min(20).max(2_000),
    z.number().int().min(20).max(2_000)
  ]).refine(([minimum, maximum]) => minimum <= maximum, {
    message: 'lengthRange minimum must not exceed maximum'
  }),
  numBackbones: z.number().int().min(1).max(20)
}).strict()

const sequenceStageSchema = z.object({
  kind: z.literal('sequence'),
  backboneAssetId: z.string().trim().min(1).max(256),
  chainsToDesign: z.array(z.string().trim().min(1).max(32)).min(1).max(64).optional(),
  numSequences: z.number().int().min(1).max(20),
  samplingTemperature: z.number().positive().max(2).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional()
}).strict()

const verifyStageSchema = z.object({
  kind: z.literal('verify'),
  candidateSetId: z.string().trim().min(1).max(256).optional(),
  candidateIds: z.array(z.string().trim().min(1).max(256)).min(1).max(20).optional(),
  topN: z.number().int().min(1).max(20).optional()
}).strict().superRefine((stage, context) => {
  const hasSet = Boolean(stage.candidateSetId)
  const hasCandidates = Boolean(stage.candidateIds?.length)
  if (hasSet === hasCandidates) {
    context.addIssue({
      code: 'custom',
      path: ['candidateIds'],
      message: 'verify requires exactly one of candidateSetId or candidateIds'
    })
  }
  if (hasCandidates && stage.topN !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['topN'],
      message: 'topN is only valid with candidateSetId; candidateIds are already an exact selection'
    })
  }
  if (stage.candidateIds && new Set(stage.candidateIds).size !== stage.candidateIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['candidateIds'],
      message: 'candidateIds must be unique'
    })
  }
})

const binderStageSchema = z.object({
  kind: z.literal('binder'),
  lengthRange: z.tuple([
    z.number().int().min(20).max(2_000),
    z.number().int().min(20).max(2_000)
  ]).refine(([minimum, maximum]) => minimum <= maximum, {
    message: 'lengthRange minimum must not exceed maximum'
  }),
  numTrajectories: z.number().int().min(1).max(20).optional(),
  numSequences: z.number().int().min(1).max(20).optional(),
  finalDesigns: z.number().int().min(1).max(20).optional()
}).strict()

const designRunMutationBase = {
  designRunId: z.string().regex(DESIGN_RUN_ID_PATTERN),
  expectedRevision: z.number().int().positive()
} as const

const capabilitiesRequestSchema = z.object({
  operation: z.literal('capabilities')
}).strict()

const startRequestSchema = z.object({
  operation: z.literal('start'),
  workflow: workflowSchema,
  objective: z.string().trim().min(1).max(4_000),
  input: runInputSchema.optional(),
  budget: runBudgetSchema.optional()
}).strict().superRefine((request, context) => {
  if (request.workflow === 'fixed_backbone' && !request.input?.backbonePath) {
    context.addIssue({
      code: 'custom',
      path: ['input', 'backbonePath'],
      message: 'fixed_backbone requires input.backbonePath'
    })
  }
  if (request.workflow === 'target_binder') {
    if (!request.input?.targetStructurePath) {
      context.addIssue({
        code: 'custom',
        path: ['input', 'targetStructurePath'],
        message: 'target_binder requires input.targetStructurePath'
      })
    }
    if (!request.input?.targetChain) {
      context.addIssue({
        code: 'custom',
        path: ['input', 'targetChain'],
        message: 'target_binder requires input.targetChain'
      })
    }
  }
})

const advanceRequestSchema = z.object({
  operation: z.literal('advance'),
  ...designRunMutationBase,
  stage: z.discriminatedUnion('kind', [
    backboneStageSchema,
    sequenceStageSchema,
    verifyStageSchema,
    binderStageSchema
  ])
}).strict()

const statusRequestSchema = z.object({
  operation: z.literal('status'),
  designRunId: designRunMutationBase.designRunId,
  sinceRevision: z.number().int().min(0).optional()
}).strict()

const extendBudgetRequestSchema = z.object({
  operation: z.literal('extend_budget'),
  ...designRunMutationBase,
  additionalGpuJobs: z.number().int().min(1).max(20),
  reason: z.string().trim().min(1).max(2_000)
}).strict()

const cancelRequestSchema = z.object({
  operation: z.literal('cancel'),
  ...designRunMutationBase
}).strict()

const finalizeRequestSchema = z.object({
  operation: z.literal('finalize'),
  ...designRunMutationBase,
  disposition: z.enum(['selected', 'no_viable_candidate']),
  selectedCandidateIds: z.array(z.string().trim().min(1).max(256)).min(1).max(20).optional(),
  summary: z.string().trim().min(1).max(8_000),
  caveats: z.array(z.string().trim().min(1).max(2_000)).min(1).max(32)
}).strict().superRefine((request, context) => {
  if (request.disposition === 'selected' && !request.selectedCandidateIds?.length) {
    context.addIssue({
      code: 'custom',
      path: ['selectedCandidateIds'],
      message: 'selected disposition requires selectedCandidateIds'
    })
  }
  if (request.disposition === 'no_viable_candidate' && request.selectedCandidateIds) {
    context.addIssue({
      code: 'custom',
      path: ['selectedCandidateIds'],
      message: 'no_viable_candidate must not include selectedCandidateIds'
    })
  }
})

const cleanupRequestSchema = z.object({
  operation: z.literal('cleanup'),
  ...designRunMutationBase
}).strict()

export const BioGymDesignRequestSchema = z.discriminatedUnion('operation', [
  capabilitiesRequestSchema,
  startRequestSchema,
  advanceRequestSchema,
  statusRequestSchema,
  extendBudgetRequestSchema,
  cancelRequestSchema,
  finalizeRequestSchema,
  cleanupRequestSchema
])

export type BioGymDesignRequest = z.infer<typeof BioGymDesignRequestSchema>

export type BioGymInternalDesignEnvelope = {
  version: typeof BIOGYM_INTERNAL_PROTOCOL_VERSION
  request: BioGymDesignRequest
  context: {
    threadId: string
    turnId: string
    workspace: string
    project?: string
  }
}

type BioGymInternalClientConfig = {
  endpoint: string
  token: string
}

export type BioGymPrivateBridgeConfig = {
  baseUrl: string
  token: string
}

export type BioGymDesignProviderBuild = {
  provider: CapabilityToolProvider
  diagnostic: {
    available: boolean
    reason?: string
  }
}

/**
 * Build the native provider from an already-private bootstrap value. Production
 * receives this value through a one-shot inherited pipe, never argv or env.
 */
export function buildBioGymDesignToolProviderFromConfig(
  bridge: BioGymPrivateBridgeConfig | undefined
): BioGymDesignProviderBuild {
  const resolved = resolveInternalClientConfig(bridge)
  if (!resolved.ok) {
    return {
      provider: {
        id: BIOGYM_DESIGN_PROVIDER_ID,
        kind: 'built-in',
        enabled: true,
        available: false,
        reason: resolved.reason,
        tools: []
      },
      diagnostic: { available: false, reason: resolved.reason }
    }
  }
  return {
    provider: {
      id: BIOGYM_DESIGN_PROVIDER_ID,
      kind: 'built-in',
      enabled: true,
      available: true,
      tools: [createBioGymDesignTool(resolved.config)]
    },
    diagnostic: { available: true }
  }
}

export function isProteinDesignIntent(requestText: string | undefined): boolean {
  if (!requestText?.trim()) return false
  return /\b(?:biogym|protein\s*(?:design|engineering)|design(?:ing)?\s+(?:a\s+)?(?:new\s+)?protein|de[ -]?novo\s+(?:protein|scaffold|backbone)|(?:scaffold|backbone|binder|enzyme|peptide|sequence)\s*(?:design|generation)|design(?:ing)?\s+(?:a\s+)?(?:binder|scaffold|backbone|enzyme|peptide|protein\s+sequence)|inverse\s+folding|proteinmpnn|rf\s*diffusion|rfdiffusion|bindcraft)\b/i.test(requestText) ||
    /(?:BioGym|蛋白(?:质)?(?:从头)?设计|从头设计(?:一个)?(?:蛋白|骨架|蛋白骨架)|蛋白工程|蛋白序列设计|骨架设计|主链设计|结合蛋白设计|设计(?:一个)?(?:结合蛋白|蛋白|骨架|主链|多肽|酶)|逆折叠|蛋白MPNN)/iu.test(requestText)
}

export function bioGymDesignRequiresApproval(args: Record<string, unknown>): boolean {
  const parsed = BioGymDesignRequestSchema.safeParse(args)
  if (!parsed.success) return false
  const operation = parsed.data.operation
  if (operation === 'start' || operation === 'extend_budget') return true
  return false
}

function createBioGymDesignTool(config: BioGymInternalClientConfig): LocalTool {
  return LocalToolHost.defineTool({
    name: BIOGYM_DESIGN_TOOL_NAME,
    description: [
      'Run bounded computational protein-design workflows through BioGym.',
      'Use it for de novo scaffolds, fixed-backbone sequence design, target binders, and predicted-structure verification.',
      'Call start once to create an approved run, advance one legal scientific stage at a time, and finalize when a candidate is selected or no candidate is viable.',
      'Background monitoring and Biology Room synchronization are handled by SciForge; do not poll while a stage is running.',
      'BioGym is a backend tool, not another agent. Results are computational predictions and are not wet-lab validation.',
      'Exact de novo start: {"operation":"start","workflow":"de_novo_scaffold","objective":"Design an 80-100 aa scaffold"}.',
      'Exact backbone advance: {"operation":"advance","designRunId":"<id>","expectedRevision":3,"stage":{"kind":"backbone","lengthRange":[80,100],"numBackbones":3}}.',
      'Use the latest returned revision. Never invent a params wrapper, snake_case aliases, or a stage description field.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'on-request',
    approvalMode: 'mandatory',
    inputSchema: BIOGYM_DESIGN_INPUT_JSON_SCHEMA,
    metadata: {
      firstParty: true,
      nativeOnly: true,
      protocolVersion: BIOGYM_INTERNAL_PROTOCOL_VERSION
    },
    advertisementScope: 'request',
    shouldAdvertise: (context) =>
      isProteinDesignIntent(context.requestText) ||
      context.activeNativeToolNames?.includes(BIOGYM_DESIGN_TOOL_NAME) === true,
    requiresApproval: (args) => bioGymDesignRequiresApproval(args),
    execute: async (args, context) => {
      const parsed = BioGymDesignRequestSchema.safeParse(args)
      if (!parsed.success) {
        return {
          output: {
            code: 'invalid_biogym_design_request',
            error: 'Invalid biogym_design request',
            issues: parsed.error.issues.slice(0, 12).map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message
            })),
            correction: correctionForInvalidRequest(args)
          },
          isError: true
        }
      }
      if (!context.workspace.trim()) {
        return {
          output: {
            code: 'biogym_workspace_required',
            error: 'BioGym design requires a workspace-backed SciForge thread'
          },
          isError: true
        }
      }
      return callBioGymInternalService(config, parsed.data, context)
    }
  })
}

async function callBioGymInternalService(
  config: BioGymInternalClientConfig,
  request: BioGymDesignRequest,
  context: ToolHostContext
): Promise<{ output: unknown; isError?: boolean }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('internal BioGym request timed out'), BIOGYM_INTERNAL_TIMEOUT_MS)
  const onAbort = (): void => controller.abort(context.abortSignal.reason)
  context.abortSignal.addEventListener('abort', onAbort, { once: true })
  const envelope: BioGymInternalDesignEnvelope = {
    version: BIOGYM_INTERNAL_PROTOCOL_VERSION,
    request,
    context: {
      threadId: context.threadId,
      turnId: context.turnId,
      workspace: context.workspace,
      ...(context.project?.trim() ? { project: context.project } : {})
    }
  }
  try {
    if (context.abortSignal.aborted) throw new Error('BioGym request aborted before dispatch')
    const response = await fetch(config.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelope)
    })
    const responseBody = await readBoundedJson(response)
    if (!response.ok) {
      const serviceError = internalServiceError(responseBody)
      return {
        output: serviceError ?? {
          code: 'biogym_internal_http_error',
          error: `BioGym internal service returned HTTP ${response.status}`
        },
        isError: true
      }
    }
    if (!isObjectRecord(responseBody) || typeof responseBody.ok !== 'boolean') {
      return {
        output: {
          code: 'biogym_internal_protocol_error',
          error: 'BioGym internal service returned an invalid response envelope'
        },
        isError: true
      }
    }
    if (responseBody.ok === false) {
      return {
        output: internalServiceError(responseBody) ?? {
          code: 'biogym_internal_error',
          error: 'BioGym internal service rejected the request'
        },
        isError: true
      }
    }
    return { output: responseBody.data ?? {} }
  } catch (error) {
    if (context.abortSignal.aborted) throw new Error('BioGym request aborted')
    if (controller.signal.aborted) {
      throw new Error(`BioGym internal service timed out after ${BIOGYM_INTERNAL_TIMEOUT_MS}ms`)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`BioGym internal service request failed: ${message}`)
  } finally {
    clearTimeout(timeout)
    context.abortSignal.removeEventListener('abort', onAbort)
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > BIOGYM_INTERNAL_RESPONSE_MAX_BYTES) {
    throw new Error('BioGym internal service response exceeded the 1 MiB limit')
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > BIOGYM_INTERNAL_RESPONSE_MAX_BYTES) {
      await reader.cancel()
      throw new Error('BioGym internal service response exceeded the 1 MiB limit')
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('BioGym internal service returned invalid JSON')
  }
}

function internalServiceError(value: unknown): Record<string, unknown> | null {
  if (!isObjectRecord(value)) return null
  const raw = isObjectRecord(value.error) ? value.error : value
  const message = typeof raw.message === 'string'
    ? raw.message
    : typeof raw.error === 'string'
      ? raw.error
      : null
  if (!message) return null
  return {
    code: typeof raw.code === 'string' ? raw.code : 'biogym_internal_error',
    error: message,
    ...(raw.details !== undefined ? { details: raw.details } : {})
  }
}

function resolveInternalClientConfig(bridge: BioGymPrivateBridgeConfig | undefined):
  | { ok: true; config: BioGymInternalClientConfig }
  | { ok: false; reason: string } {
  const rawBaseUrl = bridge?.baseUrl.trim()
  const token = bridge?.token.trim()
  if (!rawBaseUrl || !token) {
    return {
      ok: false,
      reason: 'BioGym private bridge baseUrl and token must both be configured'
    }
  }
  let baseUrl: URL
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch {
    return { ok: false, reason: 'BioGym private bridge baseUrl is not a valid URL' }
  }
  if (baseUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(baseUrl.hostname)) {
    return {
      ok: false,
      reason: 'BioGym private bridge baseUrl must be an HTTP loopback URL'
    }
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    return {
      ok: false,
      reason: 'BioGym private bridge baseUrl must not contain credentials, query, or fragment'
    }
  }
  if (baseUrl.pathname !== '/' && baseUrl.pathname !== '') {
    return {
      ok: false,
      reason: 'BioGym private bridge baseUrl must not contain a path'
    }
  }
  return {
    ok: true,
    config: {
      endpoint: new URL(BIOGYM_INTERNAL_DESIGN_PATH, baseUrl).toString(),
      token
    }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])
export const BIOGYM_DESIGN_INPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  description: [
    'One bounded BioGym protein-design operation.',
    'For start, provide only operation, workflow, objective, and optional input/budget.',
    'For advance, provide designRunId, the latest expectedRevision, and one typed stage object.',
    'Do not use params, snake_case aliases, or extra description fields.'
  ].join(' '),
  properties: {
    operation: {
      type: 'string',
      enum: ['capabilities', 'start', 'advance', 'status', 'extend_budget', 'cancel', 'finalize', 'cleanup'],
      description: 'Operation to perform. Use start once, then one advance per stage.'
    },
    workflow: {
      type: 'string',
      enum: ['de_novo_scaffold', 'fixed_backbone', 'target_binder'],
      description: 'Required only for start.'
    },
    objective: {
      type: 'string',
      minLength: 1,
      description: 'Required only for start. Plain-language scientific objective.'
    },
    input: {
      type: 'object',
      additionalProperties: false,
      description: 'Optional start inputs. De novo scaffold needs no input file.',
      properties: {
        backbonePath: { type: 'string', description: 'Workspace-relative backbone file for fixed_backbone.' },
        targetStructurePath: { type: 'string', description: 'Workspace-relative target structure for target_binder.' },
        targetChain: { type: 'string', description: 'Target chain for target_binder.' },
        hotspotResidues: { type: 'array', items: { type: 'string' }, maxItems: 256 }
      }
    },
    budget: {
      type: 'object',
      additionalProperties: false,
      description: 'Optional approved run budget for start.',
      properties: {
        maxGpuJobs: { type: 'integer', minimum: 1, maximum: 20 },
        maxWallclockHours: { type: 'number', exclusiveMinimum: 0, maximum: 12 },
        maxCandidatesPerStage: { type: 'integer', minimum: 1, maximum: 20 }
      }
    },
    designRunId: {
      type: 'string',
      minLength: 1,
      pattern: '^design-[a-f0-9]{24}$',
      description: 'Required after start; copy exactly from the latest snapshot.'
    },
    expectedRevision: {
      type: 'integer',
      minimum: 1,
      description: 'Required for mutations after start; copy the latest snapshot revision.'
    },
    sinceRevision: { type: 'integer', minimum: 0, description: 'Optional status delta cursor.' },
    stage: {
      type: 'object',
      additionalProperties: false,
      description: [
        'Required only for advance.',
        'Backbone exact shape: {"kind":"backbone","lengthRange":[80,100],"numBackbones":3}.',
        'Sequence exact shape: {"kind":"sequence","backboneAssetId":"<asset-id>","numSequences":5}.',
        'Preferred verify shape for exact, cross-stage identity: {"kind":"verify","candidateIds":["<candidate-id-1>","<candidate-id-2>"]}.',
        'Legacy single-set verify shape: {"kind":"verify","candidateSetId":"<set-id>","topN":2}.'
      ].join(' '),
      properties: {
        kind: { type: 'string', enum: ['backbone', 'sequence', 'verify', 'binder'] },
        lengthRange: integerRangeSchema(),
        numBackbones: boundedCountSchema(),
        backboneAssetId: { type: 'string', minLength: 1 },
        chainsToDesign: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
        numSequences: boundedCountSchema(),
        samplingTemperature: { type: 'number', exclusiveMinimum: 0, maximum: 2 },
        seed: { type: 'integer', minimum: 0, maximum: 2_147_483_647 },
        candidateSetId: { type: 'string', minLength: 1 },
        candidateIds: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', minLength: 1 }
        },
        topN: boundedCountSchema(),
        numTrajectories: boundedCountSchema(),
        finalDesigns: boundedCountSchema()
      },
      required: ['kind']
    },
    additionalGpuJobs: boundedCountSchema(),
    reason: { type: 'string', minLength: 1 },
    disposition: { type: 'string', enum: ['selected', 'no_viable_candidate'] },
    selectedCandidateIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
    summary: { type: 'string', minLength: 1 },
    caveats: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string' } }
  },
  required: ['operation']
}

function boundedCountSchema(): Record<string, unknown> {
  return { type: 'integer', minimum: 1, maximum: 20 }
}

function integerRangeSchema(): Record<string, unknown> {
  return {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: { type: 'integer', minimum: 20, maximum: 2_000 }
  }
}

function correctionForInvalidRequest(args: Record<string, unknown>): Record<string, unknown> {
  const operation = typeof args.operation === 'string' ? args.operation : undefined
  if (operation === 'advance') {
    return {
      instruction: 'Use the latest snapshot revision and one exact typed stage object. Do not use params or extra stage fields.',
      backboneExample: {
        operation: 'advance',
        designRunId: '<designRunId>',
        expectedRevision: 3,
        stage: { kind: 'backbone', lengthRange: [80, 100], numBackbones: 3 }
      }
    }
  }
  if (operation === 'start') {
    return {
      instruction: 'Start creates the run only; stage parameters belong in the later advance call.',
      example: {
        operation: 'start',
        workflow: 'de_novo_scaffold',
        objective: 'Design an 80-100 aa de novo protein scaffold.'
      }
    }
  }
  if (operation === 'finalize') {
    const disposition = args.disposition === 'no_viable_candidate'
      ? 'no_viable_candidate'
      : 'selected'
    const selectedCandidateIds = Array.isArray(args.selectedCandidateIds)
      ? args.selectedCandidateIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : []
    return {
      instruction: 'Finalization requires the latest revision, a summary, and at least one explicit computational caveat. Copy candidate IDs exactly from the completed verification stage.',
      example: {
        operation: 'finalize',
        designRunId: typeof args.designRunId === 'string' ? args.designRunId : '<designRunId>',
        expectedRevision: typeof args.expectedRevision === 'number' ? args.expectedRevision : 3,
        disposition,
        ...(disposition === 'selected'
          ? { selectedCandidateIds: selectedCandidateIds.length ? selectedCandidateIds : ['<verifiedCandidateId>'] }
          : {}),
        summary: typeof args.summary === 'string' && args.summary.trim()
          ? args.summary
          : 'Summarize the computational selection decision.',
        caveats: Array.isArray(args.caveats) && args.caveats.length
          ? args.caveats
          : ['Computational prediction only; no wet-lab validation.']
      }
    }
  }
  return {
    instruction: 'Choose one operation. Query capabilities only when workflow support is genuinely unknown.',
    example: { operation: 'capabilities' }
  }
}
