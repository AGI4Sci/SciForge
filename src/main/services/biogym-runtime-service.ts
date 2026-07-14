import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import {
  getBioGymSettings,
  type AppSettingsV1,
  type BioGymSettingsV1
} from '../../shared/app-settings'
import {
  BIOGYM_RUN_EVENT_CHANNEL,
  type BioGymCandidateSummary,
  type BioGymDoctorResult,
  type BioGymRunEvent,
  type BioGymRunEventType,
  type BioGymRunSnapshot,
  type BioGymStageAttemptSnapshot,
  type BioGymStageKind,
  type BioGymWorkflow
} from '../../shared/biogym'
import type {
  BiologyRoomApplyResult,
  BiologyRoomManifest,
  BiologyRoomMutationOperation
} from '../../shared/biology-room'
import { BiologyRoomConflictError, BiologyRoomService } from './biology-room-service'
import {
  BioGymCliError,
  executeBioGymCli,
  parseBioGymCliJson,
  type BioGymCliExecution
} from './biogym-cli-executor'

export const BIOGYM_INTERNAL_DESIGN_PATH = '/v1/biogym/design'

const MAX_HTTP_BODY_BYTES = 1024 * 1024
const RUN_SCHEMA_VERSION = 1
const RUN_ID_PATTERN = /^design-[a-f0-9]{24}$/
const DEFAULT_MAX_WALLCLOCK_HOURS = 2
const DEFAULT_DISPLAY_CANDIDATES = 5
const HARD_MAX_GPU_JOBS = 20
const HARD_MAX_WALLCLOCK_HOURS = 12
const HARD_MAX_CANDIDATES = 20
const DEFAULT_OPERATION_TIMEOUT_MS = 90_000
const DEFAULT_WAIT_POLL_MS = 2_000
const DEFAULT_WAIT_TIMEOUT_MS = 12 * 60 * 60_000
const DEFAULT_CONTINUATION_RETRY_MS = 1_000
const MAX_CONTINUATION_RETRY_MS = 60_000
const TRANSIENT_READ_RETRY_DELAYS_MS = [250, 1_000] as const

type LegacyContinuationDisposition =
  | 'replay_selected'
  | 'suppressed_older'
  | 'suppressed_inactive'

export type BioGymContinuationFreshnessRequest = {
  runtimeId: 'sciforge'
  threadId: string
  workspaceRoot: string
  designRunId: string
  expectedRevision: number
  hostRequestId: string
  phase: 'ready' | 'stage' | 'diagnostic'
  stageAttemptId?: string
}

export type BioGymContinuationFreshnessDecision =
  | { allow: true }
  | {
      allow: false
      reason: string
      details?: Readonly<Record<string, unknown>>
    }

const workflowSchema = z.enum(['de_novo_scaffold', 'fixed_backbone', 'target_binder'])
const runIdSchema = z.string().regex(RUN_ID_PATTERN)
const expectedRevisionSchema = z.number().int().positive()
const relativeOrAbsolutePathSchema = z.string().trim().min(1).max(4_096)

const backboneStageSchema = z.object({
  kind: z.literal('backbone'),
  lengthRange: z.tuple([z.number().int().min(20).max(2_000), z.number().int().min(20).max(2_000)]),
  numBackbones: z.number().int().min(1).max(HARD_MAX_CANDIDATES)
}).strict().refine((value) => value.lengthRange[0] <= value.lengthRange[1], 'Invalid length range.')

const sequenceStageSchema = z.object({
  kind: z.literal('sequence'),
  backboneAssetId: z.string().trim().min(1).max(256),
  chainsToDesign: z.array(z.string().trim().min(1).max(32)).min(1).max(64).optional(),
  numSequences: z.number().int().min(1).max(HARD_MAX_CANDIDATES),
  samplingTemperature: z.number().positive().max(2).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional()
}).strict()

const verifyStageSchema = z.object({
  kind: z.literal('verify'),
  candidateSetId: z.string().trim().min(1).max(256).optional(),
  candidateIds: z.array(z.string().trim().min(1).max(256)).min(1).max(HARD_MAX_CANDIDATES).optional(),
  topN: z.number().int().min(1).max(HARD_MAX_CANDIDATES).optional()
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
      message: 'topN is only valid with candidateSetId'
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
  lengthRange: z.tuple([z.number().int().min(20).max(2_000), z.number().int().min(20).max(2_000)]),
  numTrajectories: z.number().int().min(1).max(HARD_MAX_CANDIDATES).optional(),
  numSequences: z.number().int().min(1).max(HARD_MAX_CANDIDATES).optional(),
  finalDesigns: z.number().int().min(1).max(HARD_MAX_CANDIDATES).optional()
}).strict().refine((value) => value.lengthRange[0] <= value.lengthRange[1], 'Invalid length range.')

const stageSchema = z.union([
  backboneStageSchema,
  sequenceStageSchema,
  verifyStageSchema,
  binderStageSchema
])

const designRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('capabilities') }).strict(),
  z.object({
    operation: z.literal('start'),
    workflow: workflowSchema,
    objective: z.string().trim().min(1).max(4_000),
    input: z.object({
      backbonePath: relativeOrAbsolutePathSchema.optional(),
      targetStructurePath: relativeOrAbsolutePathSchema.optional(),
      targetChain: z.string().trim().min(1).max(32).optional(),
      hotspotResidues: z.array(z.string().trim().min(1).max(64)).max(256).optional()
    }).strict().optional(),
    budget: z.object({
      maxGpuJobs: z.number().int().min(1).max(HARD_MAX_GPU_JOBS).optional(),
      maxWallclockHours: z.number().positive().max(HARD_MAX_WALLCLOCK_HOURS).optional(),
      maxCandidatesPerStage: z.number().int().min(1).max(HARD_MAX_CANDIDATES).optional()
    }).strict().optional()
  }).strict(),
  z.object({
    operation: z.literal('advance'),
    designRunId: runIdSchema,
    expectedRevision: expectedRevisionSchema,
    stage: stageSchema
  }).strict(),
  z.object({
    operation: z.literal('status'),
    designRunId: runIdSchema,
    sinceRevision: z.number().int().nonnegative().optional()
  }).strict(),
  z.object({
    operation: z.literal('extend_budget'),
    designRunId: runIdSchema,
    expectedRevision: expectedRevisionSchema,
    additionalGpuJobs: z.number().int().min(1).max(HARD_MAX_GPU_JOBS),
    reason: z.string().trim().min(1).max(2_000)
  }).strict(),
  z.object({
    operation: z.literal('cancel'),
    designRunId: runIdSchema,
    expectedRevision: expectedRevisionSchema
  }).strict(),
  z.object({
    operation: z.literal('finalize'),
    designRunId: runIdSchema,
    expectedRevision: expectedRevisionSchema,
    disposition: z.enum(['selected', 'no_viable_candidate']),
    selectedCandidateIds: z.array(z.string().trim().min(1).max(256)).min(1).max(20).optional(),
    summary: z.string().trim().min(1).max(8_000),
    caveats: z.array(z.string().trim().min(1).max(2_000)).min(1).max(32)
  }).strict(),
  z.object({
    operation: z.literal('cleanup'),
    designRunId: runIdSchema,
    expectedRevision: expectedRevisionSchema
  }).strict()
])

const envelopeSchema = z.object({
  version: z.literal(1),
  request: designRequestSchema,
  context: z.object({
    threadId: z.string().trim().min(1).max(512),
    turnId: z.string().trim().min(1).max(512),
    workspace: z.string().trim().min(1).max(4_096),
    project: z.string().trim().min(1).max(1_024).optional()
  }).strict()
}).strict()

type BioGymDesignEnvelope = z.infer<typeof envelopeSchema>
type BioGymDesignRequest = BioGymDesignEnvelope['request']
type BioGymStageRequest = z.infer<typeof stageSchema>

type StoredInputRef = {
  id: string
  localPath: string
  relativePath: string
  remotePath: string
  sha256: string
}

type StoredCandidateRef = BioGymCandidateSummary & {
  remotePath?: string
  sourceArtifactId?: string
  sourceSha256?: string
  candidateSetId?: string
  /** Internal-only sequence used to create an identity-preserving verification input. */
  sequence?: string
}

type StoredStageAttempt = BioGymStageAttemptSnapshot & {
  request: BioGymStageRequest
  outputDir: string
  capability: string
  callRequestId: string
  waitRequestId: string
  prepareRequestId?: string
  prepareOperationId?: string
  verificationCandidateIds?: string[]
  verificationInputRemotePath?: string
  verificationInputSha256?: string
  verificationSourceArtifactIds?: string[]
  callOperationId?: string
  waitOperationId?: string
  jobId?: string
  actorTurnId: string
  remoteArtifactIds: string[]
  continuationDelivered: boolean
  continuationDeliveryAttempts?: number
  continuationDeliveryError?: string
  continuationNextRetryAt?: string
  continuationTurnId?: string
  continuationSuppressedAt?: string
  continuationSuppressionReason?: string
  continuationLegacyDisposition?: LegacyContinuationDisposition
  recoveryAttempts?: number
  activeAssetPath?: string
}

type StoredRun = {
  schemaVersion: typeof RUN_SCHEMA_VERSION
  designRunId: string
  roomId: string
  owner: {
    runtimeId: 'sciforge'
    threadId: string
    workspaceRoot: string
    startTurnId: string
  }
  workflow: BioGymWorkflow
  objective: string
  input: {
    backbone?: StoredInputRef
    targetStructure?: StoredInputRef
    targetChain?: string
    hotspotResidues: string[]
  }
  status: BioGymRunSnapshot['status']
  revision: number
  createdAt: string
  updatedAt: string
  startedAtMs: number
  budget: {
    maxGpuJobs: number
    usedGpuJobs: number
    maxWallclockHours: number
    maxCandidatesPerStage: number
    extensions: Array<{ additionalGpuJobs: number; reason: string; turnId: string; createdAt: string }>
  }
  remote: {
    startRequestId: string
    sessionRequestId: string
    state: 'queued' | 'starting' | 'ready' | 'failed' | 'indeterminate' | 'cleaned'
    sessionId?: string
    runId?: string
    ref?: string
    error?: string
    readyContinuationDelivered?: boolean
    readyContinuationDeliveryAttempts?: number
    readyContinuationDeliveryError?: string
    readyContinuationNextRetryAt?: string
    readyContinuationTurnId?: string
    readyContinuationSuppressedAt?: string
    readyContinuationSuppressionReason?: string
    readyContinuationLegacyDisposition?: LegacyContinuationDisposition
    recoveryAttempts?: number
  }
  stages: StoredStageAttempt[]
  candidates: StoredCandidateRef[]
  candidateSets: Array<{
    id: string
    stageAttemptId: string
    remotePath: string
    candidateIds: string[]
    sourceSha256?: string
  }>
  lastActiveCandidateId?: string
  lastActiveAssetId?: string
  lastActiveAssetPath?: string
  finalized?: {
    attempt: number
    disposition: 'selected' | 'no_viable_candidate'
    selectedCandidateIds: string[]
    summary: string
    caveats: string[]
    recoveryAttempts?: number
  }
  finalizationError?: string
  cleanup: {
    requested: boolean
    completed: boolean
    requestId?: string
    error?: string
    recoveryAttempts?: number
  }
  continuationSuppressions?: Array<{
    hostRequestId: string
    phase: 'ready' | 'stage' | 'diagnostic'
    stageAttemptId?: string
    expectedRevision: number
    reason: string
    suppressedAt: string
  }>
}

type CliRunner = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; maxOutputBytes?: number }
) => Promise<BioGymCliExecution>

export type BioGymRuntimeServiceOptions = {
  userDataPath: string
  loadSettings: () => Promise<AppSettingsV1>
  biologyRoomService?: Pick<BiologyRoomService, 'create' | 'load' | 'apply'>
  emitRunEvent?: (channel: typeof BIOGYM_RUN_EVENT_CHANNEL, event: BioGymRunEvent) => void
  continueAgent?: (input: {
    runtimeId: 'sciforge'
    threadId: string
    workspace: string
    text: string
    metadata: Record<string, unknown>
    hostRequestId: string
    freshness: BioGymContinuationFreshnessRequest
  }) => Promise<{ threadId: string; turnId: string }>
  cliRunner?: CliRunner
  pollIntervalMs?: number
  waitTimeoutMs?: number
  continuationRetryMs?: number
  now?: () => Date
}

export type BioGymInternalServerInfo = {
  baseUrl: string
  token: string
}

export class BioGymRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'BioGymRuntimeError'
  }
}

export class BioGymRuntimeService {
  private readonly biologyRoomService: Pick<BiologyRoomService, 'create' | 'load' | 'apply'>
  private readonly cliRunner: CliRunner
  private readonly runQueues = new Map<string, Promise<unknown>>()
  private readonly activeMonitors = new Set<string>()
  private readonly continuationRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly activeRunIdsByOwner = new Map<string, Set<string>>()
  private readonly now: () => Date
  private server: ReturnType<typeof createServer> | null = null
  private serverInfo: BioGymInternalServerInfo | null = null
  private resumePersistedRunsTask: Promise<void> = Promise.resolve()
  private stopping = false

  constructor(private readonly options: BioGymRuntimeServiceOptions) {
    this.biologyRoomService = options.biologyRoomService ?? new BiologyRoomService()
    this.cliRunner = options.cliRunner ?? executeBioGymCli
    this.now = options.now ?? (() => new Date())
  }

  async start(): Promise<BioGymInternalServerInfo> {
    if (this.serverInfo) return this.serverInfo
    this.stopping = false
    const token = randomBytes(32).toString('base64url')
    const server = createServer((request, response) => {
      void this.handleHttpRequest(token, request, response)
    })
    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolvePromise())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('BioGym internal service did not receive a loopback TCP address.')
    }
    this.server = server
    this.serverInfo = { baseUrl: `http://127.0.0.1:${address.port}`, token }
    this.resumePersistedRunsTask = this.resumePersistedRuns()
    void this.resumePersistedRunsTask.catch(() => undefined)
    return this.serverInfo
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const timer of this.continuationRetryTimers.values()) clearTimeout(timer)
    this.continuationRetryTimers.clear()
    const server = this.server
    this.server = null
    this.serverInfo = null
    if (!server) return
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  }

  async doctor(): Promise<BioGymDoctorResult> {
    try {
      const settings = await this.requireConfiguredSettings({ allowDisabled: true })
      const details = await this.runCli(settings, this.options.userDataPath, ['doctor'], 90_000)
      return {
        ok: true,
        message: settings.enabled
          ? 'BioGym remote gateway and runtime are ready.'
          : 'BioGym doctor passed; enable the integration to use biogym_design.',
        details
      }
    } catch (error) {
      return {
        ok: false,
        message: safeErrorMessage(error),
        details: error instanceof BioGymRuntimeError ? error.details : undefined
      }
    }
  }

  /**
   * Return whether this exact native thread owns a durable run that may still
   * require BioGym operations. The cache is rebuilt from the global run index
   * on service startup and updated whenever a run journal is read or written.
   */
  async hasActiveDesignRun(input: {
    runtimeId: string
    threadId: string
    workspace: string
  }): Promise<boolean> {
    if (input.runtimeId !== 'sciforge' || !input.threadId.trim() || !input.workspace.trim()) return false
    await this.resumePersistedRunsTask.catch(() => undefined)
    const workspaceRoot = await canonicalWorkspace(input.workspace).catch(() => null)
    if (!workspaceRoot) return false
    return (this.activeRunIdsByOwner.get(runOwnerKey(workspaceRoot, input.threadId))?.size ?? 0) > 0
  }

  /**
   * Revalidate a queued host continuation immediately before AgentRuntimeHost
   * starts it. This closes the wait-behind-active-turn race: a foreground user
   * action can supersede an otherwise valid BioGym wake while it is queued.
   */
  async checkContinuationFreshness(
    input: BioGymContinuationFreshnessRequest
  ): Promise<BioGymContinuationFreshnessDecision> {
    const expectedHostRequestId = continuationHostRequestId(input)
    if (input.hostRequestId !== expectedHostRequestId) {
      return continuationRejected('host_request_id_mismatch', {
        expectedHostRequestId,
        receivedHostRequestId: input.hostRequestId
      })
    }
    const workspaceRoot = await canonicalWorkspace(input.workspaceRoot).catch(() => null)
    if (!workspaceRoot) return continuationRejected('workspace_unavailable')
    const run = await this.loadRun(workspaceRoot, input.designRunId).catch((error) => {
      if (error instanceof BioGymRuntimeError && error.code === 'biogym_run_not_found') return null
      throw error
    })
    if (!run) return continuationRejected('run_unavailable')
    if (run.owner.runtimeId !== input.runtimeId ||
        run.owner.threadId !== input.threadId ||
        run.owner.workspaceRoot !== workspaceRoot) {
      return continuationRejected('run_owner_changed')
    }
    if (run.revision !== input.expectedRevision) {
      return continuationRejected('run_revision_changed', {
        expectedRevision: input.expectedRevision,
        currentRevision: run.revision
      })
    }

    if (input.phase === 'ready') {
      const valid = run.status === 'awaiting_agent' &&
        run.remote.state === 'ready' &&
        Boolean(run.remote.ref) &&
        run.stages.length === 0 &&
        !run.finalized &&
        !run.cleanup.requested &&
        !run.remote.readyContinuationSuppressedAt &&
        this.now().getTime() < runWallclockDeadlineMs(run)
      return valid
        ? { allow: true }
        : continuationRejected('ready_phase_superseded', continuationStateDetails(run))
    }

    if (input.phase === 'stage') {
      const attempt = input.stageAttemptId
        ? run.stages.find((candidate) => candidate.id === input.stageAttemptId)
        : undefined
      const valid = Boolean(attempt && isTerminalStageAttempt(attempt) &&
        isStageContinuationPending(attempt) &&
        run.stages.at(-1)?.id === attempt.id) &&
        run.status === 'awaiting_agent' &&
        !run.stages.some((candidate) => candidate.status === 'queued' || candidate.status === 'running') &&
        !run.finalized &&
        !run.cleanup.requested &&
        this.now().getTime() < runWallclockDeadlineMs(run)
      return valid
        ? { allow: true }
        : continuationRejected('stage_phase_superseded', {
            ...continuationStateDetails(run),
            stageAttemptId: input.stageAttemptId,
            stageStatus: attempt?.status ?? 'missing'
          })
    }

    const diagnosticValid = run.status !== 'completed' &&
      run.status !== 'cancelled' &&
      !run.cleanup.requested &&
      (!input.stageAttemptId || run.stages.some((attempt) => attempt.id === input.stageAttemptId))
    return diagnosticValid
      ? { allow: true }
      : continuationRejected('diagnostic_superseded', continuationStateDetails(run))
  }

  async replayRunSnapshots(): Promise<{ replayed: number }> {
    const index = await readJsonIfExists(join(this.options.userDataPath, 'biogym-runs.json')) as {
      runs?: Array<{ workspaceRoot: string; designRunId: string }>
    } | null
    let replayed = 0
    for (const entry of index?.runs ?? []) {
      const run = await this.loadRun(entry.workspaceRoot, entry.designRunId).catch(() => null)
      if (!run) continue
      this.emit(run, 'snapshot')
      replayed += 1
    }
    return { replayed }
  }

  async handleEnvelope(value: unknown): Promise<unknown> {
    const parsed = envelopeSchema.safeParse(value)
    if (!parsed.success) {
      throw new BioGymRuntimeError('invalid_request', 'Invalid BioGym design request.', 400, {
        issues: parsed.error.issues.slice(0, 16).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      })
    }
    const envelope = parsed.data
    const workspaceRoot = await canonicalWorkspace(envelope.context.workspace)
    const context = { ...envelope.context, workspace: workspaceRoot }

    switch (envelope.request.operation) {
      case 'capabilities':
        return this.capabilities()
      case 'start':
        return this.startDesign(envelope.request, context)
      case 'status':
        return this.statusDesign(envelope.request.designRunId, context, envelope.request.sinceRevision)
      case 'advance':
        return this.advanceDesign(envelope.request, context)
      case 'extend_budget':
        return this.extendBudget(envelope.request, context)
      case 'cancel':
        return this.cancelDesign(envelope.request, context)
      case 'finalize':
        return this.finalizeDesign(envelope.request, context)
      case 'cleanup':
        return this.cleanupDesign(envelope.request, context)
    }
  }

  private async handleHttpRequest(
    token: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    try {
      if (request.method !== 'POST' || request.url !== BIOGYM_INTERNAL_DESIGN_PATH) {
        throw new BioGymRuntimeError('not_found', 'Internal endpoint not found.', 404)
      }
      if (!authorized(request.headers.authorization, token)) {
        throw new BioGymRuntimeError('unauthorized', 'Unauthorized.', 401)
      }
      const body = await readJsonBody(request)
      const data = await this.handleEnvelope(body)
      response.statusCode = 200
      response.end(JSON.stringify({ ok: true, data }))
    } catch (error) {
      const normalized = normalizeRuntimeError(error)
      response.statusCode = normalized.status
      response.end(JSON.stringify({
        ok: false,
        error: {
          code: normalized.code,
          message: normalized.message,
          ...(normalized.details !== undefined ? { details: normalized.details } : {})
        }
      }))
    }
  }

  private async capabilities(): Promise<unknown> {
    const configured = await this.requireConfiguredSettings({ allowDisabled: true }).then(
      (settings) => ({
        enabled: settings.enabled,
        configured: true,
        sshHost: settings.sshHost,
        remoteRoot: settings.remoteRoot
      }),
      (error) => ({ enabled: false, configured: false, error: safeErrorMessage(error) })
    )
    return {
      service: 'biogym_design',
      configured,
      workflows: {
        de_novo_scaffold: ['backbone', 'sequence', 'verify'],
        fixed_backbone: ['sequence', 'verify'],
        target_binder: ['binder']
      },
      defaults: {
        maxGpuJobs: {
          de_novo_scaffold: 6,
          fixed_backbone: 4,
          target_binder: 2
        },
        maxWallclockHours: DEFAULT_MAX_WALLCLOCK_HOURS,
        maxDisplayedCandidatesPerStage: DEFAULT_DISPLAY_CANDIDATES
      },
      hardLimits: {
        maxGpuJobs: HARD_MAX_GPU_JOBS,
        maxWallclockHours: HARD_MAX_WALLCLOCK_HOURS,
        maxCandidatesPerStage: HARD_MAX_CANDIDATES
      },
      canonicalCalls: {
        startDeNovo: {
          operation: 'start',
          workflow: 'de_novo_scaffold',
          objective: 'Design an 80-100 aa de novo protein scaffold.'
        },
        advanceBackbone: {
          operation: 'advance',
          designRunId: '<copy from snapshot>',
          expectedRevision: '<copy latest revision>',
          stage: { kind: 'backbone', lengthRange: [80, 100], numBackbones: 3 }
        }
      },
      argumentRules: [
        'Do not use a params wrapper or snake_case aliases.',
        'Do not add description inside stage.',
        'After start, wait for the host continuation instead of polling status.'
      ],
      evidenceNotice: 'Boltz-2 structures and confidence values are computational predictions, not proof of binding, stability, expression, safety, or wet-lab validation.'
    }
  }

  private async startDesign(
    request: Extract<BioGymDesignRequest, { operation: 'start' }>,
    context: BioGymDesignEnvelope['context']
  ): Promise<unknown> {
    await this.requireConfiguredSettings()
    assertStartInput(request)
    const designRunId = `design-${randomBytes(12).toString('hex')}`
    const roomId = `biogym-${designRunId.slice('design-'.length)}`
    const runDirectory = runRoot(context.workspace, designRunId)

    const backbone = request.input?.backbonePath
      ? await prepareInputRef(context.workspace, request.input.backbonePath, 'input-backbone', 'backbone_path')
      : undefined
    const targetStructure = request.input?.targetStructurePath
      ? await prepareInputRef(context.workspace, request.input.targetStructurePath, 'input-target', 'target_structure')
      : undefined
    if (backbone && !/\.pdb$/i.test(backbone.localPath)) {
      throw new BioGymRuntimeError('biogym_backbone_format', 'ProteinMPNN fixed-backbone input must be a PDB file.', 400)
    }
    if (targetStructure && !/\.pdb$/i.test(targetStructure.localPath)) {
      throw new BioGymRuntimeError('biogym_target_format', 'BindCraft target input must be a PDB file.', 400)
    }
    await createRunDirectories(runDirectory)

    const defaults = defaultGpuJobs(request.workflow)
    const now = this.now()
    const run: StoredRun = {
      schemaVersion: RUN_SCHEMA_VERSION,
      designRunId,
      roomId,
      owner: {
        runtimeId: 'sciforge',
        threadId: context.threadId,
        workspaceRoot: context.workspace,
        startTurnId: context.turnId
      },
      workflow: request.workflow,
      objective: request.objective,
      input: {
        ...(backbone ? { backbone } : {}),
        ...(targetStructure ? { targetStructure } : {}),
        ...(request.input?.targetChain ? { targetChain: request.input.targetChain } : {}),
        hotspotResidues: request.input?.hotspotResidues ?? []
      },
      status: 'starting',
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAtMs: now.getTime(),
      budget: {
        maxGpuJobs: request.budget?.maxGpuJobs ?? defaults,
        usedGpuJobs: 0,
        maxWallclockHours: request.budget?.maxWallclockHours ?? DEFAULT_MAX_WALLCLOCK_HOURS,
        maxCandidatesPerStage: request.budget?.maxCandidatesPerStage ?? DEFAULT_DISPLAY_CANDIDATES,
        extensions: []
      },
      remote: {
        startRequestId: requestId(designRunId, 'start'),
        sessionRequestId: requestId(designRunId, 'session'),
        state: 'queued'
      },
      stages: [],
      candidates: [
        ...(backbone ? [{
          id: backbone.id,
          label: basename(backbone.relativePath),
          relativePath: backbone.relativePath,
          remotePath: backbone.remotePath,
          sourceSha256: backbone.sha256
        }] : [])
      ],
      candidateSets: [],
      cleanup: { requested: false, completed: false }
    }

    const task = taskForRun(run)
    await atomicWriteJson(join(runDirectory, 'tasks', 'task.json'), task)
    await atomicWriteJson(runFilePath(context.workspace, designRunId), run)
    this.rememberRunActivity(run)
    await appendRunEvent(run, 'run_created', {
      actorTurnId: context.turnId,
      workflow: run.workflow,
      budget: run.budget
    })
    await this.addGlobalRunIndex(run)
    await this.biologyRoomService.create({
      workspaceRoot: context.workspace,
      roomId,
      title: `BioGym: ${request.objective.slice(0, 180)}`,
      assets: [],
      actor: { kind: 'system', taskId: designRunId, turnId: context.turnId }
    })
    this.emit(run, 'run_status')
    this.scheduleRemoteInitialization(run)
    return this.toolSnapshot(run, {
      message: 'Design run created. BioGym remote initialization is queued; the owning SciForge agent will be notified when it is ready.',
      nextAction: {
        kind: 'wait_for_host_continuation',
        callToolNow: false,
        instruction: 'Do not call status or advance yet. End this model step and wait for the BioGym ready continuation.'
      },
      inputAssets: backbone ? [{ id: backbone.id, path: backbone.relativePath }] : []
    })
  }

  private async statusDesign(
    designRunId: string,
    context: BioGymDesignEnvelope['context'],
    sinceRevision?: number
  ): Promise<unknown> {
    const run = await this.loadOwnedRun(context.workspace, designRunId, context.threadId)
    if (sinceRevision !== undefined && sinceRevision >= run.revision) {
      return {
        designRunId,
        unchanged: true,
        revision: run.revision,
        status: run.status
      }
    }
    return this.toolSnapshot(run)
  }

  private async advanceDesign(
    request: Extract<BioGymDesignRequest, { operation: 'advance' }>,
    context: BioGymDesignEnvelope['context']
  ): Promise<unknown> {
    await this.requireConfiguredSettings()
    const updated = await this.updateOwnedRun(
      context.workspace,
      request.designRunId,
      context.threadId,
      request.expectedRevision,
      'stage_queued',
      (run) => {
        assertCanAdvance(run, request.stage)
        if (run.budget.usedGpuJobs >= run.budget.maxGpuJobs) {
          throw new BioGymRuntimeError(
            'biogym_budget_exhausted',
            'The approved GPU-job budget is exhausted. Finalize or request an approved budget extension.',
            409
          )
        }
        assertWithinWallclock(run, this.now().getTime())
        const attemptNumber = run.stages.filter((attempt) => attempt.kind === request.stage.kind).length + 1
        const id = `${request.stage.kind}-${String(attemptNumber).padStart(2, '0')}-${randomUUID().slice(0, 8)}`
        const capability = capabilityForStage(request.stage.kind)
        const backend = backendForStage(request.stage.kind)
        const outputDir = `intermediate/${backend}/sciforge_${id}`
        validateStageReferences(run, request.stage)
        const verificationCandidateIds = request.stage.kind === 'verify'
          ? resolveVerificationCandidateIds(run, request.stage)
          : undefined
        const attempt: StoredStageAttempt = {
          id,
          kind: request.stage.kind,
          attempt: attemptNumber,
          status: 'queued',
          backend,
          candidateCount: 0,
          assetIds: [],
          candidates: [],
          request: request.stage,
          outputDir,
          capability,
          callRequestId: requestId(run.designRunId, `${id}-call`),
          waitRequestId: requestId(run.designRunId, `${id}-wait`),
          ...(verificationCandidateIds ? {
            prepareRequestId: requestId(run.designRunId, `${id}-prepare`),
            verificationCandidateIds,
            verificationInputRemotePath: `intermediate/sciforge_inputs/${id}-selected.csv`
          } : {}),
          actorTurnId: context.turnId,
          remoteArtifactIds: [],
          continuationDelivered: false
        }
        run.stages.push(attempt)
        run.budget.usedGpuJobs += 1
        run.status = 'running'
        return { stageAttemptId: id, actorTurnId: context.turnId }
      }
    )
    const attempt = updated.stages.at(-1)!
    this.emit(updated, 'run_status')
    this.scheduleStageMonitor(updated.designRunId, updated.owner.workspaceRoot, attempt.id)
    return this.toolSnapshot(updated, {
      message: `Stage ${attempt.kind} attempt ${attempt.attempt} was durably queued. Do not poll; SciForge will be resumed once it reaches a terminal state.`,
      queuedAttemptId: attempt.id
    })
  }

  private async extendBudget(
    request: Extract<BioGymDesignRequest, { operation: 'extend_budget' }>,
    context: BioGymDesignEnvelope['context']
  ): Promise<unknown> {
    const updated = await this.updateOwnedRun(
      context.workspace,
      request.designRunId,
      context.threadId,
      request.expectedRevision,
      'budget_extended',
      (run) => {
        const next = run.budget.maxGpuJobs + request.additionalGpuJobs
        if (next > HARD_MAX_GPU_JOBS) {
          throw new BioGymRuntimeError(
            'biogym_budget_hard_limit',
            `The total GPU-job budget cannot exceed ${HARD_MAX_GPU_JOBS}.`,
            400
          )
        }
        run.budget.maxGpuJobs = next
        run.budget.extensions.push({
          additionalGpuJobs: request.additionalGpuJobs,
          reason: request.reason,
          turnId: context.turnId,
          createdAt: this.now().toISOString()
        })
        return { additionalGpuJobs: request.additionalGpuJobs, reason: request.reason }
      }
    )
    this.emit(updated, 'run_status')
    return this.toolSnapshot(updated, { message: 'Approved GPU-job budget extension recorded.' })
  }

  private async cancelDesign(
    request: Extract<BioGymDesignRequest, { operation: 'cancel' }>,
    context: BioGymDesignEnvelope['context']
  ): Promise<unknown> {
    const updated = await this.updateOwnedRun(
      context.workspace,
      request.designRunId,
      context.threadId,
      request.expectedRevision,
      'run_cancelled',
      (run) => {
        if (run.status === 'completed') {
          throw new BioGymRuntimeError('biogym_run_terminal', 'Completed runs cannot be cancelled.', 409)
        }
        run.status = 'cancelled'
        for (const attempt of run.stages) {
          if (attempt.status === 'queued') attempt.status = 'cancelled'
        }
        return { actorTurnId: context.turnId }
      }
    )
    this.emit(updated, 'run_status')
    const running = updated.stages.find((attempt) => attempt.status === 'running' && attempt.jobId)
    if (running) void this.requestRemoteCancellation(updated, running).catch(() => undefined)
    return this.toolSnapshot(updated, {
      message: running
        ? 'Cancellation recorded. No new stages will start; the already-running receiver GPU task may continue until the backend acknowledges cancellation.'
        : 'Cancellation recorded. No new stages will start.'
    })
  }

  private async finalizeDesign(
    request: Extract<BioGymDesignRequest, { operation: 'finalize' }>,
    context: BioGymDesignEnvelope['context']
  ): Promise<unknown> {
    const updated = await this.updateOwnedRun(
      context.workspace,
      request.designRunId,
      context.threadId,
      request.expectedRevision,
      'finalize_queued',
      (run) => {
        if (run.status === 'finalizing' || run.status === 'completed' || run.status === 'cancelled' ||
            run.status === 'indeterminate' || run.cleanup.requested) {
          throw new BioGymRuntimeError('biogym_run_terminal', `Cannot finalize a run in ${run.status} state.`, 409)
        }
        if (run.stages.some((attempt) => attempt.status === 'queued' || attempt.status === 'running')) {
          throw new BioGymRuntimeError('biogym_stage_active', 'Wait for the active stage to finish before finalizing.', 409)
        }
        if (request.disposition === 'selected') {
          const known = new Set(run.candidates.map((candidate) => candidate.id))
          const unknown = (request.selectedCandidateIds ?? []).filter((id) => !known.has(id))
          if (!request.selectedCandidateIds?.length || unknown.length) {
            throw new BioGymRuntimeError(
              'biogym_unknown_candidate',
              unknown.length ? `Unknown selected candidate IDs: ${unknown.join(', ')}` : 'Selected disposition requires candidate IDs.',
              400
            )
          }
          const verified = new Set(
            run.stages
              .filter((attempt) => attempt.kind === 'verify' && attempt.status === 'succeeded')
              .flatMap((attempt) => attempt.candidates.map((candidate) => candidate.id))
          )
          const unverified = request.selectedCandidateIds.filter((id) => verified.size > 0 && !verified.has(id))
          if (unverified.length) {
            throw new BioGymRuntimeError(
              'biogym_candidate_not_verified',
              `Final selected candidates must match completed Boltz outputs: ${unverified.join(', ')}`,
              400
            )
          }
        } else if (request.selectedCandidateIds?.length) {
          throw new BioGymRuntimeError('biogym_invalid_finalization', 'No-viable-candidate disposition cannot select candidates.', 400)
        }
        run.status = 'finalizing'
        run.finalizationError = undefined
        run.finalized = {
          attempt: (run.finalized?.attempt ?? 0) + 1,
          disposition: request.disposition,
          selectedCandidateIds: request.selectedCandidateIds ?? [],
          summary: request.summary,
          caveats: request.caveats
        }
        return { disposition: request.disposition, actorTurnId: context.turnId }
      }
    )
    this.emit(updated, 'run_status')
    void this.runFinalization(updated.designRunId, updated.owner.workspaceRoot).catch(() => undefined)
    return this.toolSnapshot(updated, {
      message: 'Finalization is durably queued. Reports, validation, artifact synchronization, and isolated remote cleanup will continue in the background.'
    })
  }

  private async cleanupDesign(
    request: Extract<BioGymDesignRequest, { operation: 'cleanup' }>,
    context: BioGymDesignEnvelope['context']
  ): Promise<unknown> {
    const updated = await this.updateOwnedRun(
      context.workspace,
      request.designRunId,
      context.threadId,
      request.expectedRevision,
      'cleanup_queued',
      (run) => {
        if (run.status === 'indeterminate') {
          throw new BioGymRuntimeError('biogym_indeterminate_preserved', 'Indeterminate runs are preserved for diagnosis and cannot be cleaned.', 409)
        }
        if (run.stages.some((attempt) => attempt.status === 'queued' || attempt.status === 'running')) {
          throw new BioGymRuntimeError('biogym_stage_active', 'Cancel or wait for the active stage before cleanup.', 409)
        }
        run.cleanup.requested = true
        run.cleanup.requestId ??= requestId(run.designRunId, 'cleanup')
        return { actorTurnId: context.turnId }
      }
    )
    void this.cleanupRemoteSession(updated.designRunId, updated.owner.workspaceRoot).catch(() => undefined)
    return this.toolSnapshot(updated, { message: 'Isolated remote-session cleanup queued.' })
  }

  private scheduleRemoteInitialization(run: StoredRun): void {
    const monitorKey = `initialize:${run.designRunId}`
    if (this.stopping || this.activeMonitors.has(monitorKey)) return
    this.activeMonitors.add(monitorKey)
    void this.initializeRemoteRun(run.designRunId, run.owner.workspaceRoot)
      .catch(() => undefined)
      .finally(() => this.activeMonitors.delete(monitorKey))
  }

  private async initializeRemoteRun(designRunId: string, workspaceRoot: string): Promise<void> {
    let run = await this.updateRun(workspaceRoot, designRunId, 'remote_starting', (current) => {
      if (current.remote.state === 'ready') return { alreadyReady: true }
      if (current.status === 'cancelled') return { cancelled: true }
      current.remote.state = 'starting'
      current.remote.error = undefined
      return {}
    })
    if (run.remote.state === 'ready' || run.status === 'cancelled') return
    try {
      const settings = await this.requireConfiguredSettings()
      const taskPath = join(runRoot(workspaceRoot, designRunId), 'tasks', 'task.json')
      const result = asRecord(await this.runCliMutation(settings, workspaceRoot, [
        'start',
        taskPath,
        '--request-id', run.remote.startRequestId,
        '--session-request-id', run.remote.sessionRequestId
      ], 5 * 60_000))
      const sessionId = requiredString(result, 'session_id')
      const remoteRunId = requiredString(result, 'run_id')
      const ref = optionalString(result.ref) ?? `${sessionId}:${remoteRunId}`
      run = await this.updateRun(workspaceRoot, designRunId, 'remote_ready', (current) => {
        current.remote = {
          ...current.remote,
          state: 'ready',
          sessionId,
          runId: remoteRunId,
          ref,
          error: undefined,
          readyContinuationDelivered: false,
          recoveryAttempts: 0
        }
        if (current.status !== 'cancelled') current.status = 'awaiting_agent'
        return { sessionId, remoteRunId }
      })
      this.emit(run, 'run_status')
      // Agent continuation delivery is a separate durable control-plane
      // operation. A rejected/temporarily unavailable agent turn must never
      // rewrite a successfully initialized remote run as a BioGym failure.
      this.scheduleReadyContinuation(run)
    } catch (error) {
      const recoverable = isRecoverableControllerError(error)
      const terminalIndeterminate = error instanceof BioGymRuntimeError &&
        error.code === 'biogym_operation_indeterminate'
      const indeterminate = recoverable || terminalIndeterminate
      let recoveryAttempts = 0
      run = await this.updateRun(workspaceRoot, designRunId, 'remote_start_failed', (current) => {
        current.remote.state = indeterminate ? 'indeterminate' : 'failed'
        current.remote.error = safeErrorMessage(error)
        if (recoverable) {
          current.remote.recoveryAttempts = (current.remote.recoveryAttempts ?? 0) + 1
          recoveryAttempts = current.remote.recoveryAttempts
        }
        current.status = indeterminate ? 'indeterminate' : 'failed'
        return { error: safeErrorMessage(error), recoverable, indeterminate, recoveryAttempts }
      })
      this.emit(run, 'run_status')
      if (!recoverable || recoveryAttempts === 1) {
        this.scheduleDiagnosticContinuation(run, undefined, safeErrorMessage(error))
      }
      if (recoverable && recoveryAttempts <= 3 && !this.stopping) {
        const timer = setTimeout(() => {
          this.scheduleRemoteInitialization(run)
        }, Math.min(30_000, recoveryAttempts * 5_000))
        timer.unref()
      }
    }
  }

  private scheduleStageMonitor(designRunId: string, workspaceRoot: string, stageAttemptId: string): void {
    const monitorKey = `stage:${designRunId}:${stageAttemptId}`
    if (this.stopping || this.activeMonitors.has(monitorKey)) return
    this.activeMonitors.add(monitorKey)
    void this.runStage(designRunId, workspaceRoot, stageAttemptId)
      .catch(() => undefined)
      .finally(() => this.activeMonitors.delete(monitorKey))
  }

  private async prepareVerificationInput(
    run: StoredRun,
    attempt: StoredStageAttempt,
    settings: BioGymSettingsV1,
    budgetDeadlineMs: number
  ): Promise<StoredRun> {
    if (attempt.request.kind !== 'verify') return run
    if (!run.remote.ref) {
      throw new BioGymRuntimeError('biogym_protocol_error', 'Verification stage has no remote run.', 500)
    }
    const remoteRef = run.remote.ref
    const candidateIds = attempt.verificationCandidateIds ??
      resolveVerificationCandidateIds(run, attempt.request)
    const selected = await loadTrustedVerificationCandidates(run, candidateIds)
    const content = verificationCandidateCsv(selected)
    const contentSha256 = createHash('sha256').update(content).digest('hex')
    const remotePath = attempt.verificationInputRemotePath ??
      `intermediate/sciforge_inputs/${attempt.id}-selected.csv`
    const prepareRequestId = attempt.prepareRequestId ??
      requestId(run.designRunId, `${attempt.id}-prepare`)
    const derivedPath = join(
      runRoot(run.owner.workspaceRoot, run.designRunId),
      'derived',
      attempt.id,
      'selected-verification-candidates.csv'
    )
    await mkdir(resolve(derivedPath, '..'), { recursive: true })
    await atomicWriteText(derivedPath, content)

    run = await this.updateRun(
      run.owner.workspaceRoot,
      run.designRunId,
      'verification_input_prepared',
      (current) => {
        const currentAttempt = requireAttempt(current, attempt.id)
        if (current.status === 'cancelled' || currentAttempt.status === 'cancelled') {
          throw new BioGymRuntimeError(
            'biogym_stage_cancelled',
            'Verification input preparation was cancelled before upload.',
            409
          )
        }
        currentAttempt.prepareRequestId = prepareRequestId
        currentAttempt.verificationCandidateIds = candidateIds
        currentAttempt.verificationInputRemotePath = remotePath
        currentAttempt.verificationInputSha256 = contentSha256
        currentAttempt.verificationSourceArtifactIds = [...new Set(
          selected.flatMap((candidate) => candidate.sourceArtifactId ? [candidate.sourceArtifactId] : [])
        )]
        return {
          stageAttemptId: attempt.id,
          candidateIds,
          remotePath,
          sha256: contentSha256,
          sourceArtifactIds: currentAttempt.verificationSourceArtifactIds
        }
      }
    )
    attempt = requireAttempt(run, attempt.id)

    const actionPath = join(
      runRoot(run.owner.workspaceRoot, run.designRunId),
      'actions',
      `${attempt.id}-prepare.json`
    )
    await atomicWriteJson(actionPath, {
      type: 'WRITE_FILE',
      path: remotePath,
      content,
      kind: 'verification_input'
    })
    const submission = asRecord(await this.runCliMutation(settings, run.owner.workspaceRoot, [
      'act', remoteRef,
      '--file', actionPath,
      '--request-id', prepareRequestId
    ], DEFAULT_OPERATION_TIMEOUT_MS, budgetDeadlineMs))
    const prepareOperationId = operationIdFromSubmission(submission)
    run = await this.updateRun(
      run.owner.workspaceRoot,
      run.designRunId,
      'verification_input_submitted',
      (current) => {
        requireAttempt(current, attempt.id).prepareOperationId = prepareOperationId
        return { stageAttemptId: attempt.id, prepareOperationId }
      }
    )
    const operation = await this.waitForOperation(
      settings,
      run.owner.workspaceRoot,
      remoteRef,
      prepareOperationId,
      budgetDeadlineMs
    )
    const event = operationEvent(operation)
    if (event.status !== 'accepted') {
      throw new BioGymRuntimeError(
        'biogym_verification_input_rejected',
        optionalString(event.message) ?? 'BioGym rejected the exact verification candidate file.',
        502
      )
    }
    return run
  }

  private async runStage(designRunId: string, workspaceRoot: string, stageAttemptId: string): Promise<void> {
    let run = await this.loadRun(workspaceRoot, designRunId)
    let attempt = requireAttempt(run, stageAttemptId)
    if (run.status === 'cancelled' || attempt.status === 'cancelled') return
    if (attempt.status === 'succeeded' || attempt.status === 'failed' || attempt.status === 'indeterminate') return
    if (run.remote.state !== 'ready' || !run.remote.ref) {
      await this.failStage(run, attempt, 'BioGym remote run is not ready.', false)
      return
    }
    const remoteRef = run.remote.ref
    const budgetDeadlineMs = runWallclockDeadlineMs(run)

    if (this.now().getTime() >= budgetDeadlineMs) {
      await this.cancelExpiredAttemptBeforeFailure(run, attempt)
      await this.failStage(run, attempt, 'The approved wall-clock budget expired before this stage could start.', false)
      return
    }

    try {
      run = await this.updateRun(workspaceRoot, designRunId, 'stage_started', (current) => {
        const currentAttempt = requireAttempt(current, stageAttemptId)
        if (current.status === 'cancelled') {
          currentAttempt.status = 'cancelled'
          return { stageAttemptId, cancelled: true }
        }
        currentAttempt.status = 'running'
        currentAttempt.startedAt ??= this.now().toISOString()
        current.status = 'running'
        return { stageAttemptId }
      })
      attempt = requireAttempt(run, stageAttemptId)
      if (run.status === 'cancelled' || attempt.status === 'cancelled') return
      this.emit(run, 'run_status')
      const settings = await this.requireConfiguredSettings()
      run = await this.prepareVerificationInput(run, attempt, settings, budgetDeadlineMs)
      attempt = requireAttempt(run, stageAttemptId)
      const action = buildCallToolAction(run, attempt)
      const actionPath = join(runRoot(workspaceRoot, designRunId), 'actions', `${attempt.id}-call.json`)
      await atomicWriteJson(actionPath, action)
      const callSubmission = asRecord(await this.runCliMutation(settings, workspaceRoot, [
        'act', remoteRef,
        '--file', actionPath,
        '--request-id', attempt.callRequestId
      ], DEFAULT_OPERATION_TIMEOUT_MS, budgetDeadlineMs))
      const callOperationId = operationIdFromSubmission(callSubmission)
      run = await this.updateRun(workspaceRoot, designRunId, 'stage_call_submitted', (current) => {
        requireAttempt(current, stageAttemptId).callOperationId = callOperationId
        return { stageAttemptId, callOperationId }
      })
      const callOperation = await this.waitForOperation(
        settings, workspaceRoot, remoteRef, callOperationId, budgetDeadlineMs
      )
      const callEvent = operationEvent(callOperation)
      if (callEvent.status !== 'accepted') {
        throw new BioGymRuntimeError(
          'biogym_stage_rejected',
          optionalString(callEvent.message) ?? 'BioGym rejected the stage action.',
          502
        )
      }
      const jobId = jobIdFromCallEvent(callEvent)
      if (!jobId) throw new BioGymRuntimeError('biogym_protocol_error', 'CALL_TOOL did not return a job ID.', 502)
      run = await this.updateRun(workspaceRoot, designRunId, 'backend_job_queued', (current) => {
        const currentAttempt = requireAttempt(current, stageAttemptId)
        currentAttempt.jobId = jobId
        return { stageAttemptId, jobId }
      })
      if (run.status === 'cancelled') {
        const cancelledAttempt = requireAttempt(run, stageAttemptId)
        await this.requestRemoteCancellation(run, cancelledAttempt).catch(() => undefined)
        run = await this.updateRun(workspaceRoot, designRunId, 'stage_cancelled_before_wait', (current) => {
          const currentAttempt = requireAttempt(current, stageAttemptId)
          currentAttempt.status = 'cancelled'
          currentAttempt.completedAt = this.now().toISOString()
          return { stageAttemptId, jobId }
        })
        this.emit(run, 'run_status')
        return
      }

      const waitActionPath = join(runRoot(workspaceRoot, designRunId), 'actions', `${attempt.id}-wait.json`)
      await atomicWriteJson(waitActionPath, { type: 'WAIT_FOR_JOB', job_id: jobId })
      const waitSubmission = asRecord(await this.runCliMutation(settings, workspaceRoot, [
        'act', remoteRef,
        '--file', waitActionPath,
        '--request-id', attempt.waitRequestId
      ], DEFAULT_OPERATION_TIMEOUT_MS, budgetDeadlineMs))
      const waitOperationId = operationIdFromSubmission(waitSubmission)
      run = await this.updateRun(workspaceRoot, designRunId, 'stage_wait_submitted', (current) => {
        requireAttempt(current, stageAttemptId).waitOperationId = waitOperationId
        return { stageAttemptId, waitOperationId, jobId }
      })
      const waitOperation = await this.waitForOperation(
        settings, workspaceRoot, remoteRef, waitOperationId, budgetDeadlineMs
      )
      const waitEvent = operationEvent(waitOperation)
      const scientificStatus = nestedString(waitEvent, ['data', 'result', 'status']) ??
        nestedString(waitEvent, ['data', 'job', 'result', 'status']) ??
        nestedString(waitEvent, ['data', 'job', 'status'])
      if (waitEvent.status !== 'accepted' || scientificStatus !== 'succeeded') {
        const detail = nestedString(waitEvent, ['data', 'result', 'error']) ?? optionalString(waitEvent.message)
        throw new BioGymRuntimeError(
          'biogym_scientific_stage_failed',
          detail || `Backend job ${jobId} ended in ${scientificStatus ?? 'an unknown state'}.`,
          502
        )
      }

      run = await this.loadRun(workspaceRoot, designRunId)
      if (run.status === 'cancelled') {
        run = await this.updateRun(workspaceRoot, designRunId, 'stage_cancelled_after_backend', (current) => {
          const currentAttempt = requireAttempt(current, stageAttemptId)
          currentAttempt.status = 'cancelled'
          currentAttempt.completedAt = this.now().toISOString()
          return { stageAttemptId, jobId, backendMayHaveCompleted: true }
        })
        this.emit(run, 'run_status')
        return
      }
      attempt = requireAttempt(run, stageAttemptId)
      const imported = await this.importStageArtifacts(run, attempt, settings, budgetDeadlineMs)
      run = await this.updateRun(workspaceRoot, designRunId, 'stage_succeeded', (current) => {
        const currentAttempt = requireAttempt(current, stageAttemptId)
        currentAttempt.status = 'succeeded'
        currentAttempt.completedAt = this.now().toISOString()
        currentAttempt.remoteArtifactIds = imported.remoteArtifactIds
        currentAttempt.assetIds = imported.candidates.flatMap((candidate) => candidate.assetId ? [candidate.assetId] : [])
        currentAttempt.candidates = imported.candidates.map(publicCandidate)
        currentAttempt.candidateCount = imported.totalCandidateCount
        currentAttempt.activeCandidateId = imported.activeCandidateId
        currentAttempt.activeAssetPath = imported.activeAssetPath
        current.candidates.push(...imported.candidates)
        if (imported.candidateSet) current.candidateSets.push(imported.candidateSet)
        current.lastActiveCandidateId = imported.activeCandidateId
        current.lastActiveAssetId = imported.activeAssetId
        current.lastActiveAssetPath = imported.activeAssetPath
        if (current.status !== 'cancelled') current.status = 'awaiting_agent'
        return {
          stageAttemptId,
          jobId,
          candidateCount: imported.totalCandidateCount,
          displayedAssetIds: currentAttempt.assetIds
        }
      })
      if (run.status === 'cancelled') {
        this.emit(run, 'run_status')
      } else {
        this.emit(run, 'artifact_ready')
        this.emit(run, 'stage_terminal')
        // Scientific completion is already durable. Deliver the agent wake-up
        // independently so an agent-runtime failure cannot corrupt the stage.
        this.scheduleStageContinuation(run, stageAttemptId)
      }
    } catch (error) {
      run = await this.loadRun(workspaceRoot, designRunId).catch(() => run)
      attempt = requireAttempt(run, stageAttemptId)
      if (error instanceof BioGymRuntimeError && error.code === 'biogym_wallclock_exhausted') {
        await this.requestRemoteCancellation(run, attempt).catch(() => undefined)
      }
      if (isRecoverableControllerError(error) ||
          (error instanceof BioGymRuntimeError &&
            (error.code === 'biogym_operation_timeout' || error.code === 'biogym_service_stopping'))) {
        await this.preserveStageForRecovery(run, attempt, safeErrorMessage(error))
        return
      }
      const indeterminate = error instanceof BioGymRuntimeError && error.code === 'biogym_operation_indeterminate'
      await this.failStage(run, attempt, safeErrorMessage(error), indeterminate)
    }
  }

  private async preserveStageForRecovery(
    run: StoredRun,
    attempt: StoredStageAttempt,
    message: string
  ): Promise<void> {
    let recoveryAttempts = 0
    const updated = await this.updateRun(run.owner.workspaceRoot, run.designRunId, 'stage_recovery_required', (current) => {
      const currentAttempt = requireAttempt(current, attempt.id)
      if (current.status !== 'cancelled') {
        currentAttempt.status = 'running'
        currentAttempt.error = message.slice(0, 2_000)
        currentAttempt.recoveryAttempts = (currentAttempt.recoveryAttempts ?? 0) + 1
        recoveryAttempts = currentAttempt.recoveryAttempts
        current.status = 'indeterminate'
      }
      return { stageAttemptId: attempt.id, error: message, recoverable: true, recoveryAttempts }
    })
    this.emit(updated, 'run_status')
    if (!this.stopping) {
      if (recoveryAttempts === 1) {
        this.scheduleDiagnosticContinuation(updated, attempt.id, message)
      }
      if (recoveryAttempts <= 3) {
        const timer = setTimeout(() => {
          this.scheduleStageMonitor(updated.designRunId, updated.owner.workspaceRoot, attempt.id)
        }, Math.min(30_000, recoveryAttempts * 5_000))
        timer.unref()
      }
    }
  }

  private async failStage(
    run: StoredRun,
    attempt: StoredStageAttempt,
    message: string,
    indeterminate: boolean
  ): Promise<void> {
    const updated = await this.updateRun(run.owner.workspaceRoot, run.designRunId, 'stage_failed', (current) => {
      const currentAttempt = requireAttempt(current, attempt.id)
      currentAttempt.status = indeterminate ? 'indeterminate' : 'failed'
      currentAttempt.error = message.slice(0, 2_000)
      currentAttempt.completedAt = this.now().toISOString()
      if (current.status !== 'cancelled') current.status = indeterminate ? 'indeterminate' : 'failed'
      return { stageAttemptId: attempt.id, error: message, indeterminate }
    })
    this.emit(updated, 'stage_terminal')
    this.scheduleStageContinuation(updated, attempt.id)
  }

  private async waitForOperation(
    settings: BioGymSettingsV1,
    workspaceRoot: string,
    ref: string,
    operationId: string,
    budgetDeadlineMs?: number
  ): Promise<Record<string, unknown>> {
    const timeoutMs = this.options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
    const pollMs = this.options.pollIntervalMs ?? DEFAULT_WAIT_POLL_MS
    const operationDeadline = Date.now() + timeoutMs
    const deadline = budgetDeadlineMs === undefined
      ? operationDeadline
      : Math.min(operationDeadline, budgetDeadlineMs)
    while (!this.stopping) {
      if (Date.now() >= deadline) {
        if (budgetDeadlineMs !== undefined && budgetDeadlineMs <= operationDeadline) {
          throw new BioGymRuntimeError(
            'biogym_wallclock_exhausted',
            'The approved wall-clock budget expired while the backend stage was running; cancellation was requested.',
            409
          )
        }
        throw new BioGymRuntimeError('biogym_operation_timeout', 'Timed out waiting for the BioGym backend operation.', 504)
      }
      let row: Record<string, unknown>
      try {
        row = asRecord(await this.runCliRead(
          settings,
          workspaceRoot,
          ['op', ref, operationId],
          DEFAULT_OPERATION_TIMEOUT_MS,
          deadline
        ))
      } catch (error) {
        if (error instanceof BioGymRuntimeError && error.code === 'biogym_wallclock_exhausted' &&
            (budgetDeadlineMs === undefined || operationDeadline < budgetDeadlineMs)) {
          throw new BioGymRuntimeError(
            'biogym_operation_timeout',
            'Timed out waiting for the BioGym backend operation.',
            504
          )
        }
        throw error
      }
      if (budgetDeadlineMs !== undefined && Date.now() >= budgetDeadlineMs) {
        throw new BioGymRuntimeError(
          'biogym_wallclock_exhausted',
          'The approved wall-clock budget expired while the backend stage was running; cancellation was requested.',
          409
        )
      }
      const status = optionalString(row.status)
      if (status === 'done') return row
      if (status === 'failed') {
        throw new BioGymRuntimeError(
          'biogym_operation_failed',
          nestedString(row, ['error', 'message']) ?? 'BioGym transport operation failed.',
          502
        )
      }
      if (status === 'indeterminate') {
        throw new BioGymRuntimeError(
          'biogym_operation_indeterminate',
          'BioGym transport operation is indeterminate and was preserved for diagnosis.',
          502
        )
      }
      await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())))
    }
    throw new BioGymRuntimeError('biogym_service_stopping', 'BioGym service is stopping.', 503)
  }

  private async importStageArtifacts(
    run: StoredRun,
    attempt: StoredStageAttempt,
    settings: BioGymSettingsV1,
    budgetDeadlineMs?: number
  ): Promise<{
    remoteArtifactIds: string[]
    candidates: StoredCandidateRef[]
    totalCandidateCount: number
    activeCandidateId?: string
    activeAssetId?: string
    activeAssetPath?: string
    candidateSet?: StoredRun['candidateSets'][number]
  }> {
    if (!run.remote.ref || !attempt.jobId) {
      throw new BioGymRuntimeError('biogym_protocol_error', 'Stage is missing its remote run or backend job reference.', 500)
    }
    const registryRows = asArray(await this.runCliRead(settings, run.owner.workspaceRoot, [
      'artifacts', run.remote.ref
    ], DEFAULT_OPERATION_TIMEOUT_MS, budgetDeadlineMs)).map(asRecord)
    const selectedRows = registryRows.filter((row) => {
      const path = optionalString(row.path)
      const jobId = nestedString(row, ['provenance', 'job_id'])
      return Boolean(path && (jobId === attempt.jobId || path.startsWith(`${attempt.outputDir}/`)))
    })
    const artifactIds = selectedRows.map((row) => requiredString(row, 'artifact_id'))
    if (!artifactIds.length) {
      throw new BioGymRuntimeError('biogym_no_registered_artifacts', 'The backend succeeded but registered no stage artifacts.', 502)
    }

    const localArtifactRoot = join(runRoot(run.owner.workspaceRoot, run.designRunId), 'artifacts', attempt.id)
    await mkdir(localArtifactRoot, { recursive: true })
    const fetchArgs = ['fetch', run.remote.ref]
    for (const artifactId of artifactIds) fetchArgs.push('--artifact', artifactId)
    fetchArgs.push('--output', localArtifactRoot)
    const fetchedRows = asArray(await this.runCliRead(
      settings,
      run.owner.workspaceRoot,
      fetchArgs,
      30 * 60_000,
      budgetDeadlineMs
    )).map(asRecord)

    const artifacts: ImportedArtifact[] = []
    for (const row of fetchedRows) {
      const localPath = requiredString(row, 'local_path')
      const localCanonical = await realpath(localPath)
      assertPathInside(localArtifactRoot, localCanonical, 'Fetched artifact escaped its isolated stage directory.')
      const expectedSha = requiredString(row, 'sha256')
      const expectedSize = requiredNumber(row, 'size')
      const actual = await hashAndSize(localCanonical)
      if (actual.sha256 !== expectedSha || actual.size !== expectedSize) {
        throw new BioGymRuntimeError('biogym_artifact_hash_mismatch', `Artifact verification failed for ${basename(localPath)}.`, 502)
      }
      const remotePath = requiredString(row, 'relative_path')
      const workspaceRelativePath = toWorkspaceRelative(run.owner.workspaceRoot, localCanonical)
      const artifactId = requiredString(row, 'artifact_id')
      const registry = selectedRows.find((candidate) => candidate.artifact_id === artifactId)
      artifacts.push({
        artifactId,
        remotePath,
        localPath: localCanonical,
        workspaceRelativePath,
        sha256: actual.sha256,
        size: actual.size,
        ...(registry?.provenance !== undefined ? { provenance: registry.provenance } : {})
      })
    }

    const derivedRoot = join(runRoot(run.owner.workspaceRoot, run.designRunId), 'derived', attempt.id)
    await mkdir(derivedRoot, { recursive: true })
    const normalized = await normalizeStageCandidates(run, attempt, artifacts, derivedRoot)
    const modelProvenance = normalizeModelProvenance(artifacts)
    const sourceProvenance = stageSourceProvenance(run, attempt)
    await atomicWriteJson(join(derivedRoot, 'provenance.json'), {
      schemaVersion: 1,
      designRunId: run.designRunId,
      roomId: run.roomId,
      stageAttemptId: attempt.id,
      actor: {
        runtimeId: run.owner.runtimeId,
        threadId: run.owner.threadId,
        turnId: attempt.actorTurnId ?? run.owner.startTurnId
      },
      backend: attempt.backend,
      capability: attempt.capability,
      model: modelProvenance,
      sources: sourceProvenance,
      completeness: {
        modelCheckpointHash: modelProvenance.checkpointHashes.length
          ? 'recorded'
          : 'unavailable_from_backend',
        sourceHashes: sourceProvenance.every((source) => source.sha256 !== null)
          ? 'recorded'
          : 'unavailable_from_prior_run'
      },
      receiverJobId: attempt.jobId,
      ...(attempt.kind === 'verify' ? {
        verificationSelection: {
          candidateIds: attempt.verificationCandidateIds ?? [],
          inputRemotePath: attempt.verificationInputRemotePath,
          inputSha256: attempt.verificationInputSha256,
          sourceArtifactIds: attempt.verificationSourceArtifactIds ?? [],
          prepareOperationId: attempt.prepareOperationId
        }
      } : {}),
      artifacts: artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        remotePath: artifact.remotePath,
        localPath: artifact.workspaceRelativePath,
        sha256: artifact.sha256,
        size: artifact.size,
        ...(artifact.provenance !== undefined ? { remoteProvenance: artifact.provenance } : {})
      })),
      candidates: normalized.candidates,
      importedAt: this.now().toISOString()
    })

    const roomAssets = uniqueBy(
      normalized.candidates
        .filter((candidate): candidate is StoredCandidateRef & { assetId: string; relativePath: string } =>
          Boolean(candidate.assetId && candidate.relativePath)
        ),
      (candidate) => candidate.assetId
    )
    if (roomAssets.length) {
      await this.addRoomAssetsWithRetry(run, roomAssets.map((candidate) => ({
        type: 'addAsset' as const,
        asset: { id: candidate.assetId, path: candidate.relativePath, indexPaths: [] }
      })))
    }

    const active = normalized.candidates.find((candidate) => candidate.assetId && candidate.relativePath)
    return {
      remoteArtifactIds: artifactIds,
      candidates: normalized.candidates,
      totalCandidateCount: normalized.totalCandidateCount,
      ...(active ? {
        activeCandidateId: active.id,
        activeAssetId: active.assetId,
        activeAssetPath: active.relativePath
      } : {}),
      ...(normalized.candidateSet ? { candidateSet: normalized.candidateSet } : {})
    }
  }

  private async addRoomAssetsWithRetry(
    run: StoredRun,
    operations: BiologyRoomMutationOperation[]
  ): Promise<BiologyRoomApplyResult> {
    let lastConflict: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const room = await this.biologyRoomService.load({
        workspaceRoot: run.owner.workspaceRoot,
        roomId: run.roomId
      })
      const existing = new Set(room.assets.map((asset) => asset.id))
      const pending = operations.filter((operation) =>
        operation.type !== 'addAsset' || !operation.asset.id || !existing.has(operation.asset.id)
      )
      if (!pending.length) {
        return {
          dryRun: false,
          changed: false,
          previousRevision: room.revision,
          revision: room.revision,
          manifest: room,
          warnings: []
        }
      }
      try {
        return await this.biologyRoomService.apply({
          workspaceRoot: run.owner.workspaceRoot,
          roomId: run.roomId,
          baseRevision: room.revision,
          operations: pending,
          actor: { kind: 'system', taskId: run.designRunId }
        })
      } catch (error) {
        if (!(error instanceof BiologyRoomConflictError)) throw error
        lastConflict = error
      }
    }
    throw lastConflict ?? new Error('Biology Room remained conflicted while registering BioGym artifacts.')
  }

  private async requestRemoteCancellation(run: StoredRun, attempt: StoredStageAttempt): Promise<void> {
    if (!run.remote.ref || !attempt.jobId) return
    const settings = await this.requireConfiguredSettings()
    const actionPath = join(runRoot(run.owner.workspaceRoot, run.designRunId), 'actions', `${attempt.id}-cancel.json`)
    await atomicWriteJson(actionPath, { type: 'CANCEL_JOB', job_id: attempt.jobId })
    await this.runCliMutation(settings, run.owner.workspaceRoot, [
      'act', run.remote.ref,
      '--file', actionPath,
      '--request-id', requestId(run.designRunId, `${attempt.id}-cancel`)
    ])
  }

  /**
   * Resume can observe an attempt only after its approved wall-clock deadline.
   * Recover an already-accepted CALL_TOOL result with a read-only operation
   * lookup, persist the returned job ID, and issue the stable idempotent cancel
   * request before marking the attempt failed. Never replay CALL_TOOL here:
   * an unaccepted request must not allocate work after its approval expired.
   */
  private async cancelExpiredAttemptBeforeFailure(
    run: StoredRun,
    attempt: StoredStageAttempt
  ): Promise<void> {
    const remoteRef = run.remote.ref
    if (!remoteRef) return
    let currentRun = run
    let currentAttempt = attempt

    if (!currentAttempt.jobId && currentAttempt.callOperationId) {
      try {
        const callOperationId = currentAttempt.callOperationId
        const settings = await this.requireConfiguredSettings()
        const operation = asRecord(await this.runCliRead(
          settings,
          currentRun.owner.workspaceRoot,
          ['op', remoteRef, callOperationId],
          DEFAULT_OPERATION_TIMEOUT_MS
        ))
        const event = operationEvent(operation)
        const recoveredJobId = event.status === 'accepted'
          ? jobIdFromCallEvent(event)
          : undefined
        if (recoveredJobId) {
          currentRun = await this.updateRun(
            currentRun.owner.workspaceRoot,
            currentRun.designRunId,
            'backend_job_recovered_after_deadline',
            (stored) => {
              const storedAttempt = requireAttempt(stored, currentAttempt.id)
              storedAttempt.jobId ??= recoveredJobId
              return {
                stageAttemptId: storedAttempt.id,
                jobId: storedAttempt.jobId,
                callOperationId: storedAttempt.callOperationId
              }
            }
          )
          currentAttempt = requireAttempt(currentRun, currentAttempt.id)
        }
      } catch {
        // Recovery and cancellation are best-effort. The stage still becomes
        // terminal locally, while its durable request/operation IDs remain in
        // the journal for diagnosis rather than being resubmitted after expiry.
      }
    }

    if (currentAttempt.jobId) {
      await this.requestRemoteCancellation(currentRun, currentAttempt).catch(() => undefined)
    }
  }

  private async runFinalization(designRunId: string, workspaceRoot: string): Promise<void> {
    const monitorKey = `finalize:${designRunId}`
    if (this.activeMonitors.has(monitorKey) || this.stopping) return
    this.activeMonitors.add(monitorKey)
    try {
      let run = await this.loadRun(workspaceRoot, designRunId)
      if (run.status !== 'finalizing' || !run.finalized || !run.remote.ref) return
      const settings = await this.requireConfiguredSettings()
      const finalizeAttempt = run.finalized.attempt ?? 1
      const resultDirectory = join(runRoot(workspaceRoot, designRunId), 'derived', 'final')
      await mkdir(resultDirectory, { recursive: true })
      const qualityDecision = {
        schemaVersion: 1,
        designRunId,
        disposition: run.finalized.disposition,
        selectedCandidateIds: run.finalized.selectedCandidateIds,
        summary: run.finalized.summary,
        caveats: run.finalized.caveats,
        evidenceScope: 'computational_only',
        explicitNonClaims: [
          'No wet-lab validation was performed.',
          'Predicted structure confidence is not proof of binding affinity, stability, expression, solubility, safety, or efficacy.'
        ]
      }
      const report = finalReport(run, qualityDecision)
      const actions: Array<{ suffix: string; value: Record<string, unknown> }> = [
        {
          suffix: 'quality-decision',
          value: {
            type: 'WRITE_FILE',
            path: 'results/sciforge_design_decision.json',
            content: `${JSON.stringify(qualityDecision, null, 2)}\n`
          }
        },
        {
          suffix: 'report',
          value: { type: 'WRITE_REPORT', path: 'results/final_report.md', content: report }
        },
        {
          suffix: 'evaluation',
          value: { type: 'REQUEST_EVALUATION', output_path: 'results/evaluation.json' }
        },
        { suffix: 'submit', value: { type: 'SUBMIT_FINAL' } }
      ]
      for (const action of actions) {
        const path = join(
          runRoot(workspaceRoot, designRunId),
          'actions',
          `final-${finalizeAttempt}-${action.suffix}.json`
        )
        await atomicWriteJson(path, action.value)
        const submission = asRecord(await this.runCliMutation(settings, workspaceRoot, [
          'act', run.remote.ref,
          '--file', path,
          '--request-id', requestId(designRunId, `final-${finalizeAttempt}-${action.suffix}`)
        ]))
        const operation = await this.waitForOperation(
          settings,
          workspaceRoot,
          run.remote.ref,
          operationIdFromSubmission(submission)
        )
        const event = operationEvent(operation)
        if (event.status !== 'accepted') {
          throw new BioGymRuntimeError(
            'biogym_finalize_action_rejected',
            optionalString(event.message) ?? `BioGym rejected finalization action ${action.suffix}.`,
            502
          )
        }
      }
      const validation = asRecord(await this.runCliMutation(settings, workspaceRoot, [
        'validate', run.remote.ref,
        '--request-id', requestId(designRunId, `validate-${finalizeAttempt}`)
      ]))
      if (validation.status !== 'pass') {
        throw new BioGymRuntimeError(
          'biogym_validation_failed',
          'BioGym validation did not pass; the remote run was preserved for diagnosis.',
          502,
          { results: Array.isArray(validation.results) ? validation.results.slice(0, 50) : validation }
        )
      }
      const finish = asRecord(await this.runCliMutation(settings, workspaceRoot, [
        'finish', run.remote.ref,
        '--request-id', requestId(designRunId, `finish-${finalizeAttempt}`)
      ]))
      if (finish.status !== 'completed') {
        throw new BioGymRuntimeError(
          'biogym_finish_incomplete',
          'BioGym did not mark the remote run completed; the remote workspace was preserved.',
          502,
          finish
        )
      }
      await this.syncRemainingArtifacts(run, settings)
      run = await this.updateRun(workspaceRoot, designRunId, 'run_completed', (current) => {
        current.status = 'completed'
        current.finalizationError = undefined
        if (current.finalized) current.finalized.recoveryAttempts = 0
        current.cleanup.requested = true
        current.cleanup.requestId ??= requestId(current.designRunId, 'cleanup')
        return { disposition: current.finalized?.disposition }
      })
      this.emit(run, 'run_status')
      await this.cleanupRemoteSession(designRunId, workspaceRoot)
    } catch (error) {
      const recoverable = isRecoverableControllerError(error) ||
        (error instanceof BioGymRuntimeError &&
          (error.code === 'biogym_operation_timeout' || error.code === 'biogym_service_stopping'))
      let recoveryAttempts = 0
      const updated = await this.updateRun(workspaceRoot, designRunId, 'finalize_failed', (run) => {
        run.status = recoverable
          ? 'finalizing'
          : error instanceof BioGymRuntimeError && error.code === 'biogym_operation_indeterminate'
            ? 'indeterminate'
            : 'failed'
        run.finalizationError = safeErrorMessage(error)
        if (recoverable && run.finalized) {
          run.finalized.recoveryAttempts = (run.finalized.recoveryAttempts ?? 0) + 1
          recoveryAttempts = run.finalized.recoveryAttempts
        }
        return { error: safeErrorMessage(error), recoverable, recoveryAttempts }
      }).catch(() => null)
      if (updated) {
        this.emit(updated, 'run_status')
        if (!this.stopping && (!recoverable || recoveryAttempts === 1)) {
          this.scheduleDiagnosticContinuation(updated, undefined, safeErrorMessage(error))
        }
        if (recoverable && recoveryAttempts <= 3 && !this.stopping) {
          const timer = setTimeout(() => {
            void this.runFinalization(updated.designRunId, updated.owner.workspaceRoot)
          }, Math.min(30_000, recoveryAttempts * 5_000))
          timer.unref()
        }
      }
    } finally {
      this.activeMonitors.delete(monitorKey)
    }
  }

  private async syncRemainingArtifacts(run: StoredRun, settings: BioGymSettingsV1): Promise<void> {
    if (!run.remote.ref) return
    const output = join(runRoot(run.owner.workspaceRoot, run.designRunId), 'artifacts', 'final')
    await mkdir(output, { recursive: true })
    await this.runCliRead(settings, run.owner.workspaceRoot, ['fetch', run.remote.ref, '--output', output], 30 * 60_000)
  }

  private async cleanupRemoteSession(designRunId: string, workspaceRoot: string): Promise<void> {
    const monitorKey = `cleanup:${designRunId}`
    if (this.stopping || this.activeMonitors.has(monitorKey)) return
    this.activeMonitors.add(monitorKey)
    let run: StoredRun | null = null
    try {
      run = await this.loadRun(workspaceRoot, designRunId)
      if (run.status === 'indeterminate' || run.cleanup.completed || !run.cleanup.requested || !run.remote.sessionId) return
      const settings = await this.requireConfiguredSettings()
      const request = run.cleanup.requestId ?? requestId(designRunId, 'cleanup')
      await this.runCliMutation(settings, workspaceRoot, [
        'cleanup', run.remote.sessionId,
        '--request-id', request,
        '--yes'
      ], 5 * 60_000)
      run = await this.updateRun(workspaceRoot, designRunId, 'cleanup_completed', (current) => {
        current.cleanup.requested = true
        current.cleanup.completed = true
        current.cleanup.requestId = request
        current.cleanup.error = undefined
        current.cleanup.recoveryAttempts = 0
        current.remote.state = 'cleaned'
        current.remote.error = undefined
        delete current.remote.ref
        if (current.status !== 'completed' && current.status !== 'cancelled') current.status = 'cancelled'
        return {}
      })
      this.emit(run, 'run_status')
    } catch (error) {
      const recoverable = isRecoverableControllerError(error) ||
        (error instanceof BioGymRuntimeError &&
          (error.code === 'biogym_operation_timeout' || error.code === 'biogym_service_stopping'))
      const indeterminate = error instanceof BioGymRuntimeError && error.code === 'biogym_operation_indeterminate'
      let recoveryAttempts = 0
      run = await this.updateRun(workspaceRoot, designRunId, 'cleanup_failed', (current) => {
        current.cleanup.error = safeErrorMessage(error)
        if (recoverable) {
          current.cleanup.recoveryAttempts = (current.cleanup.recoveryAttempts ?? 0) + 1
          recoveryAttempts = current.cleanup.recoveryAttempts
        }
        if (indeterminate) {
          current.status = 'indeterminate'
          current.remote.error = safeErrorMessage(error)
        }
        return { error: safeErrorMessage(error), recoverable, indeterminate, recoveryAttempts }
      }).catch(() => null)
      if (run) this.emit(run, 'run_status')
      if (recoverable && recoveryAttempts <= 3 && !this.stopping) {
        const timer = setTimeout(() => {
          void this.cleanupRemoteSession(designRunId, workspaceRoot)
        }, Math.min(30_000, recoveryAttempts * 5_000))
        timer.unref()
      }
    } finally {
      this.activeMonitors.delete(monitorKey)
    }
  }

  private scheduleReadyContinuation(run: StoredRun): void {
    const monitorKey = `continuation:${run.designRunId}:ready`
    if (!this.options.continueAgent || this.stopping || this.activeMonitors.has(monitorKey) ||
        !isRunActionableForContinuation(run, this.now().getTime()) ||
        !isReadyContinuationPending(run)) return
    this.activeMonitors.add(monitorKey)
    void (async () => {
      let shouldRetry = false
      try {
        await this.deliverReadyContinuation(run)
      } catch {
        shouldRetry = true
      } finally {
        this.activeMonitors.delete(monitorKey)
      }
      if (shouldRetry) await this.retryContinuationDelivery(run, undefined)
    })().catch(() => undefined)
  }

  private scheduleStageContinuation(run: StoredRun, stageAttemptId: string): void {
    const monitorKey = `continuation:${run.designRunId}:${stageAttemptId}`
    const attempt = run.stages.find((candidate) => candidate.id === stageAttemptId)
    if (!this.options.continueAgent || this.stopping || this.activeMonitors.has(monitorKey) ||
        !attempt || !isRunActionableForContinuation(run, this.now().getTime()) ||
        !isStageContinuationPending(attempt)) return
    this.activeMonitors.add(monitorKey)
    void (async () => {
      let shouldRetry = false
      try {
        await this.deliverStageContinuation(run, stageAttemptId)
      } catch {
        shouldRetry = true
      } finally {
        this.activeMonitors.delete(monitorKey)
      }
      if (shouldRetry) await this.retryContinuationDelivery(run, stageAttemptId)
    })().catch(() => undefined)
  }

  private async retryContinuationDelivery(
    run: StoredRun,
    stageAttemptId: string | undefined
  ): Promise<void> {
    if (this.stopping) return
    const latest = await this.loadRun(run.owner.workspaceRoot, run.designRunId).catch(() => null)
    if (!latest || !isRunActionableForContinuation(latest, this.now().getTime())) return
    const attempt = stageAttemptId
      ? latest.stages.find((candidate) => candidate.id === stageAttemptId)
      : undefined
    if (stageAttemptId && (!attempt || !isStageContinuationPending(attempt))) return
    if (!stageAttemptId && !isReadyContinuationPending(latest)) return
    const attempts = attempt?.continuationDeliveryAttempts ??
      latest.remote.readyContinuationDeliveryAttempts ?? 0
    const baseDelay = Math.max(0, this.options.continuationRetryMs ?? DEFAULT_CONTINUATION_RETRY_MS)
    const exponentialDelay = Math.min(
      MAX_CONTINUATION_RETRY_MS,
      baseDelay * (2 ** Math.min(16, Math.max(0, attempts - 1)))
    )
    const remainingMs = runWallclockDeadlineMs(latest) - this.now().getTime()
    if (remainingMs <= 0) return
    const delay = Math.max(0, Math.min(exponentialDelay, remainingMs))
    const retryAt = new Date(this.now().getTime() + delay).toISOString()
    const scheduled = await this.updateRunMarker(
      latest.owner.workspaceRoot,
      latest.designRunId,
      'continuation_retry_scheduled',
      (stored) => {
        if (!isRunActionableForContinuation(stored, this.now().getTime())) return { skipped: true }
        if (stageAttemptId) {
          const storedAttempt = stored.stages.find((candidate) => candidate.id === stageAttemptId)
          if (!storedAttempt || !isStageContinuationPending(storedAttempt)) return { skipped: true }
          storedAttempt.continuationNextRetryAt = retryAt
        } else {
          if (!isReadyContinuationPending(stored)) return { skipped: true }
          stored.remote.readyContinuationNextRetryAt = retryAt
        }
        return { stageAttemptId, retryAt, attempts }
      }
    ).catch(() => null)
    if (!scheduled || !isRunActionableForContinuation(scheduled, this.now().getTime())) return
    this.schedulePersistedContinuationRetry(scheduled, stageAttemptId, delay)
  }

  private schedulePersistedContinuationRetry(
    run: StoredRun,
    stageAttemptId: string | undefined,
    requestedDelayMs?: number
  ): void {
    if (this.stopping) return
    const key = `continuation-retry:${run.designRunId}:${stageAttemptId ?? 'ready'}`
    if (this.continuationRetryTimers.has(key)) return
    const retryAt = stageAttemptId
      ? run.stages.find((attempt) => attempt.id === stageAttemptId)?.continuationNextRetryAt
      : run.remote.readyContinuationNextRetryAt
    const persistedDelay = retryAt
      ? Math.max(0, Date.parse(retryAt) - this.now().getTime())
      : 0
    const delay = requestedDelayMs === undefined ? persistedDelay : Math.max(requestedDelayMs, persistedDelay)
    const timer = setTimeout(() => {
      this.continuationRetryTimers.delete(key)
      if (this.stopping) return
      void this.loadRun(run.owner.workspaceRoot, run.designRunId)
        .then((current) => {
          if (!isRunActionableForContinuation(current, this.now().getTime())) return
          if (stageAttemptId) this.scheduleStageContinuation(current, stageAttemptId)
          else this.scheduleReadyContinuation(current)
        })
        .catch(() => undefined)
    }, delay)
    timer.unref()
    this.continuationRetryTimers.set(key, timer)
  }

  private async deliverReadyContinuation(run: StoredRun): Promise<void> {
    const continueAgent = this.options.continueAgent
    if (!continueAgent) return
    let claimed = false
    const current = await this.updateRunMarker(
      run.owner.workspaceRoot,
      run.designRunId,
      'ready_continuation_delivery_started',
      (stored) => {
        if (!isRunActionableForContinuation(stored, this.now().getTime()) ||
            !isReadyContinuationPending(stored)) {
          return { skipped: true }
        }
        claimed = true
        stored.remote.readyContinuationDeliveryAttempts =
          (stored.remote.readyContinuationDeliveryAttempts ?? 0) + 1
        stored.remote.readyContinuationNextRetryAt = undefined
        return {
          attempt: stored.remote.readyContinuationDeliveryAttempts,
          startedAt: this.now().toISOString()
        }
      }
    )
    if (!claimed) return
    const freshness = continuationFreshnessRequest(current, 'ready')
    try {
      const handle = await continueAgent({
      runtimeId: 'sciforge',
      threadId: current.owner.threadId,
      workspace: current.owner.workspaceRoot,
      text: [
        `[BioGym design run ${current.designRunId} is ready]`,
        `Workflow: ${current.workflow}`,
        `Objective: ${current.objective}`,
        `Revision: ${current.revision}`,
        `Allowed next stages: ${allowedNextStages(current).join(', ') || 'none'}`,
        current.input.backbone ? `Fixed-backbone reference ID: ${current.input.backbone.id}` : '',
        readyAdvanceShape(current),
        canonicalNextCallGuidance(current),
        'Use biogym_design.advance to launch exactly one scientifically appropriate next stage. Do not poll status while a stage is running.'
      ].filter(Boolean).join('\n'),
      metadata: {
        source: 'biogym_design',
        designRunId: current.designRunId,
        roomId: current.roomId,
        revision: current.revision,
        event: 'remote_ready'
      },
      hostRequestId: freshness.hostRequestId,
      freshness
      })
      await this.updateRunMarker(
        current.owner.workspaceRoot,
        current.designRunId,
        'ready_continuation_delivered',
        (stored) => {
          stored.remote.readyContinuationDelivered = true
          stored.remote.readyContinuationDeliveryError = undefined
          stored.remote.readyContinuationNextRetryAt = undefined
          if (handle?.turnId) stored.remote.readyContinuationTurnId = handle.turnId
          return { turnId: handle?.turnId, deliveredAt: this.now().toISOString() }
        }
      )
    } catch (error) {
      const suppression = agentRuntimeContinuationSuppression(error)
      if (suppression) {
        await this.persistContinuationSuppression(current, freshness, suppression.reason)
        return
      }
      const failed = await this.updateRunMarker(
        current.owner.workspaceRoot,
        current.designRunId,
        'ready_continuation_delivery_failed',
        (stored) => {
          stored.remote.readyContinuationDelivered = false
          stored.remote.readyContinuationDeliveryError = safeErrorMessage(error).slice(0, 2_000)
          return { error: stored.remote.readyContinuationDeliveryError }
        }
      ).catch(() => undefined)
      if (failed) this.emit(failed, 'run_status')
      throw error
    }
  }

  private async deliverStageContinuation(run: StoredRun, stageAttemptId: string): Promise<void> {
    const continueAgent = this.options.continueAgent
    if (!continueAgent) return
    let claimed = false
    const current = await this.updateRunMarker(
      run.owner.workspaceRoot,
      run.designRunId,
      'continuation_delivery_started',
      (stored) => {
        const attempt = requireAttempt(stored, stageAttemptId)
        if (!isRunActionableForContinuation(stored, this.now().getTime()) ||
            !isStageContinuationPending(attempt)) {
          return { stageAttemptId, skipped: true }
        }
        claimed = true
        attempt.continuationDeliveryAttempts = (attempt.continuationDeliveryAttempts ?? 0) + 1
        attempt.continuationNextRetryAt = undefined
        return {
          stageAttemptId,
          attempt: attempt.continuationDeliveryAttempts,
          startedAt: this.now().toISOString()
        }
      }
    )
    if (!claimed) return
    const currentAttempt = requireAttempt(current, stageAttemptId)
    const freshness = continuationFreshnessRequest(current, 'stage', stageAttemptId)
    const candidateLines = currentAttempt.candidates.slice(0, 5).map((candidate) => {
      const score = candidate.score !== undefined
        ? `; ${candidate.scoreLabel ?? 'score'}=${candidate.score}`
        : ''
      return `- ${candidate.id}: ${candidate.label}${score}${candidate.assetId ? `; Room asset=${candidate.assetId}` : ''}`
    })
    try {
      const handle = await continueAgent({
        runtimeId: 'sciforge',
        threadId: current.owner.threadId,
        workspace: current.owner.workspaceRoot,
        text: [
          `[BioGym stage terminal: ${currentAttempt.kind} attempt ${currentAttempt.attempt}]`,
          `Design run: ${current.designRunId}; revision: ${current.revision}; status: ${currentAttempt.status}`,
          currentAttempt.error ? `Diagnostic: ${currentAttempt.error}` : '',
          `Candidates: ${currentAttempt.candidateCount}; GPU jobs remaining: ${snapshotForRun(current, this.now()).budget.remainingGpuJobs}`,
          `Biology Room: ${current.roomId}`,
          ...candidateLines,
          `Allowed next stages: ${allowedNextStages(current).join(', ') || 'none'}`,
          canonicalNextCallGuidance(current),
          canonicalFinalizationCallGuidance(current),
          'Decide whether to advance, retry with changed scientific parameters, request a budget extension, or finalize. Boltz confidence is computational evidence, not proof of binding or wet-lab performance.'
        ].filter(Boolean).join('\n'),
        metadata: {
          source: 'biogym_design',
          designRunId: current.designRunId,
          roomId: current.roomId,
          stageAttemptId,
          revision: current.revision,
          event: 'stage_terminal'
        },
        hostRequestId: freshness.hostRequestId,
        freshness
      })
      await this.updateRunMarker(
        current.owner.workspaceRoot,
        current.designRunId,
        'continuation_delivered',
        (stored) => {
          const attempt = requireAttempt(stored, stageAttemptId)
          attempt.continuationDelivered = true
          attempt.continuationDeliveryError = undefined
          attempt.continuationNextRetryAt = undefined
          if (handle?.turnId) attempt.continuationTurnId = handle.turnId
          return { stageAttemptId, turnId: handle?.turnId, deliveredAt: this.now().toISOString() }
        }
      )
    } catch (error) {
      const suppression = agentRuntimeContinuationSuppression(error)
      if (suppression) {
        await this.persistContinuationSuppression(current, freshness, suppression.reason)
        return
      }
      const failed = await this.updateRunMarker(
        current.owner.workspaceRoot,
        current.designRunId,
        'continuation_delivery_failed',
        (stored) => {
          const attempt = requireAttempt(stored, stageAttemptId)
          attempt.continuationDelivered = false
          attempt.continuationDeliveryError = safeErrorMessage(error).slice(0, 2_000)
          return { stageAttemptId, error: attempt.continuationDeliveryError }
        }
      ).catch(() => undefined)
      if (failed) this.emit(failed, 'run_status')
      throw error
    }
  }

  private async deliverDiagnosticContinuation(
    run: StoredRun,
    stageAttemptId: string | undefined,
    diagnostic: string
  ): Promise<void> {
    if (!this.options.continueAgent || run.status === 'cancelled') return
    const freshness = continuationFreshnessRequest(run, 'diagnostic', stageAttemptId)
    try {
      await this.options.continueAgent({
        runtimeId: 'sciforge',
        threadId: run.owner.threadId,
        workspace: run.owner.workspaceRoot,
        text: [
          `[BioGym diagnostic for ${run.designRunId}]`,
          stageAttemptId ? `Stage attempt: ${stageAttemptId}` : 'Phase: remote initialization/finalization',
          `Status: ${run.status}`,
          `Diagnostic: ${diagnostic}`,
          'Do not silently retry a failed scientific stage. Explain the failure and decide whether changed parameters, cancellation, or finalization are appropriate. Preserve indeterminate operations for diagnosis.'
        ].join('\n'),
        metadata: {
          source: 'biogym_design',
          designRunId: run.designRunId,
          roomId: run.roomId,
          ...(stageAttemptId ? { stageAttemptId } : {}),
          revision: run.revision,
          event: 'diagnostic'
        },
        hostRequestId: freshness.hostRequestId,
        freshness
      })
    } catch (error) {
      const suppression = agentRuntimeContinuationSuppression(error)
      if (!suppression) throw error
      await this.persistContinuationSuppression(run, freshness, suppression.reason)
    }
  }

  private async persistContinuationSuppression(
    run: StoredRun,
    freshness: BioGymContinuationFreshnessRequest,
    reason: string
  ): Promise<void> {
    const suppressedAt = this.now().toISOString()
    const safeReason = reason.trim().slice(0, 512) || 'pre_start_guard_rejected'
    const suppressed = await this.updateRunMarker(
      run.owner.workspaceRoot,
      run.designRunId,
      'continuation_delivery_suppressed',
      (stored) => {
        if (freshness.phase === 'ready') {
          stored.remote.readyContinuationDelivered = false
          stored.remote.readyContinuationDeliveryError = undefined
          stored.remote.readyContinuationNextRetryAt = undefined
          stored.remote.readyContinuationSuppressedAt = suppressedAt
          stored.remote.readyContinuationSuppressionReason = safeReason
        } else if (freshness.phase === 'stage' && freshness.stageAttemptId) {
          const attempt = stored.stages.find((candidate) => candidate.id === freshness.stageAttemptId)
          if (attempt) {
            attempt.continuationDelivered = false
            attempt.continuationDeliveryError = undefined
            attempt.continuationNextRetryAt = undefined
            attempt.continuationSuppressedAt = suppressedAt
            attempt.continuationSuppressionReason = safeReason
          }
        }
        const existing = stored.continuationSuppressions ?? []
        stored.continuationSuppressions = [
          ...existing.filter((entry) => entry.hostRequestId !== freshness.hostRequestId),
          {
            hostRequestId: freshness.hostRequestId,
            phase: freshness.phase,
            ...(freshness.stageAttemptId ? { stageAttemptId: freshness.stageAttemptId } : {}),
            expectedRevision: freshness.expectedRevision,
            reason: safeReason,
            suppressedAt
          }
        ].slice(-100)
        return {
          hostRequestId: freshness.hostRequestId,
          phase: freshness.phase,
          stageAttemptId: freshness.stageAttemptId,
          expectedRevision: freshness.expectedRevision,
          reason: safeReason,
          suppressedAt
        }
      }
    )
    this.emit(suppressed, 'run_status')
  }

  private scheduleDiagnosticContinuation(
    run: StoredRun,
    stageAttemptId: string | undefined,
    diagnostic: string
  ): void {
    if (this.stopping) return
    // Diagnostics are advisory. Their delivery must never sit on the critical
    // path that schedules controller reconciliation, finalization, or cleanup.
    void this.deliverDiagnosticContinuation(run, stageAttemptId, diagnostic).catch(() => undefined)
  }

  private emit(run: StoredRun, type: BioGymRunEventType): void {
    if (!this.options.emitRunEvent) return
    const event: BioGymRunEvent = {
      type,
      eventId: `biogym-event-${randomUUID()}`,
      emittedAt: this.now().toISOString(),
      workspaceRoot: run.owner.workspaceRoot,
      threadId: run.owner.threadId,
      designRunId: run.designRunId,
      roomId: run.roomId,
      revision: run.revision,
      ...(run.lastActiveCandidateId ? { activeCandidateId: run.lastActiveCandidateId } : {}),
      ...(run.lastActiveAssetId ? { activeAssetId: run.lastActiveAssetId } : {}),
      ...(run.lastActiveAssetPath ? { activeAssetPath: run.lastActiveAssetPath } : {}),
      snapshot: snapshotForRun(run, this.now())
    }
    this.options.emitRunEvent(BIOGYM_RUN_EVENT_CHANNEL, event)
  }

  private toolSnapshot(run: StoredRun, extra: Record<string, unknown> = {}): unknown {
    return {
      ...extra,
      snapshot: snapshotForRun(run, this.now()),
      allowedNextStages: allowedNextStages(run),
      canonicalNextCalls: canonicalNextAdvanceCalls(run),
      canonicalFinalizationCalls: canonicalFinalizationCalls(run),
      candidateSets: run.candidateSets.slice(-10).map((set) => ({
        id: set.id,
        stageAttemptId: set.stageAttemptId,
        candidateIds: set.candidateIds.slice(0, HARD_MAX_CANDIDATES)
      })),
      errors: [
        ...(run.remote.error ? [{ phase: 'remote', message: run.remote.error }] : []),
        ...(run.remote.readyContinuationDeliveryError
          ? [{ phase: 'ready_continuation', message: run.remote.readyContinuationDeliveryError }]
          : []),
        ...(run.finalizationError ? [{ phase: 'finalize', message: run.finalizationError }] : []),
        ...run.stages.filter((attempt) => attempt.continuationDeliveryError).slice(-5).map((attempt) => ({
          phase: 'stage_continuation',
          stageAttemptId: attempt.id,
          message: attempt.continuationDeliveryError
        })),
        ...run.stages.filter((attempt) => attempt.error).slice(-5).map((attempt) => ({
          phase: attempt.kind,
          stageAttemptId: attempt.id,
          message: attempt.error
        }))
      ],
      continuationDelivery: {
        ready: {
          delivered: Boolean(run.remote.readyContinuationDelivered && run.remote.readyContinuationTurnId),
          attempts: run.remote.readyContinuationDeliveryAttempts ?? 0,
          ...(run.remote.readyContinuationSuppressedAt
            ? {
                suppressedAt: run.remote.readyContinuationSuppressedAt,
                suppressionReason: run.remote.readyContinuationSuppressionReason
              }
            : {}),
          ...(run.remote.readyContinuationDeliveryError
            ? { error: run.remote.readyContinuationDeliveryError }
            : {}),
          ...(run.remote.readyContinuationNextRetryAt
            ? { nextRetryAt: run.remote.readyContinuationNextRetryAt }
            : {})
        },
        stages: run.stages.filter((attempt) =>
          attempt.continuationDeliveryAttempts || attempt.continuationDeliveryError
        ).slice(-5).map((attempt) => ({
          stageAttemptId: attempt.id,
          delivered: Boolean(attempt.continuationDelivered && attempt.continuationTurnId),
          attempts: attempt.continuationDeliveryAttempts ?? 0,
          ...(attempt.continuationSuppressedAt
            ? {
                suppressedAt: attempt.continuationSuppressedAt,
                suppressionReason: attempt.continuationSuppressionReason
              }
            : {}),
          ...(attempt.continuationDeliveryError ? { error: attempt.continuationDeliveryError } : {}),
          ...(attempt.continuationNextRetryAt ? { nextRetryAt: attempt.continuationNextRetryAt } : {})
        }))
      }
    }
  }

  private async requireConfiguredSettings(
    options: { allowDisabled?: boolean } = {}
  ): Promise<BioGymSettingsV1> {
    const settings = getBioGymSettings(await this.options.loadSettings())
    if (!options.allowDisabled && !settings.enabled) {
      throw new BioGymRuntimeError('biogym_disabled', 'BioGym is disabled in Remote Resources settings.', 503)
    }
    if (!isAbsolute(settings.cliPath)) {
      throw new BioGymRuntimeError('biogym_cli_not_configured', 'Configure an absolute BioGym CLI path in Remote Resources.', 503)
    }
    const cli = await stat(settings.cliPath).catch(() => null)
    if (!cli?.isFile()) {
      throw new BioGymRuntimeError('biogym_cli_not_found', `Configured BioGym CLI does not exist: ${settings.cliPath}`, 503)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/.test(settings.sshHost)) {
      throw new BioGymRuntimeError('biogym_invalid_ssh_alias', 'Configured BioGym SSH alias is invalid.', 503)
    }
    if (!/^\/[A-Za-z0-9._/-]+$/.test(settings.remoteRoot) || settings.remoteRoot.includes('/../')) {
      throw new BioGymRuntimeError('biogym_invalid_remote_root', 'Configured BioGym remote root is invalid.', 503)
    }
    return settings
  }

  private async runCli(
    settings: BioGymSettingsV1,
    workspaceRoot: string,
    command: readonly string[],
    timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS
  ): Promise<unknown> {
    const controlWorkspace = join(workspaceRoot, '.sciforge', 'biogym', 'control')
    await mkdir(controlWorkspace, { recursive: true })
    const execution = await this.cliRunner(settings.cliPath, [
      '--workspace', controlWorkspace,
      'remote',
      '--ssh-host', settings.sshHost,
      '--remote-root', settings.remoteRoot,
      ...command
    ], {
      cwd: workspaceRoot,
      timeoutMs,
      env: process.env
    })
    return parseBioGymCliJson(execution)
  }

  private async runCliMutation(
    settings: BioGymSettingsV1,
    workspaceRoot: string,
    command: readonly string[],
    timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    deadlineAtMs?: number
  ): Promise<unknown> {
    await persistControllerRequestIds(workspaceRoot, command, this.now().toISOString())
    const boundedTimeout = (): number => {
      const remainingMs = deadlineAtMs === undefined ? timeoutMs : deadlineAtMs - Date.now()
      if (remainingMs <= 0) {
        throw new BioGymRuntimeError(
          'biogym_wallclock_exhausted',
          'The approved wall-clock budget expired before the BioGym mutation could be submitted.',
          409
        )
      }
      return Math.max(1, Math.min(timeoutMs, remainingMs))
    }
    try {
      return await this.runCli(settings, workspaceRoot, command, boundedTimeout())
    } catch (firstError) {
      throwIfCliOperationIndeterminate(firstError)
      if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
        throw new BioGymRuntimeError(
          'biogym_wallclock_exhausted',
          'The approved wall-clock budget expired while the BioGym mutation was being submitted.',
          409
        )
      }
      if (!isRecoverableCliMutationError(firstError)) throw firstError
      // Every mutating command carries a caller-persisted idempotency key. A
      // single replay recovers the accepted result without duplicating a job.
      try {
        return await this.runCli(settings, workspaceRoot, command, boundedTimeout())
      } catch (secondError) {
        throwIfCliOperationIndeterminate(secondError)
        if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
          throw new BioGymRuntimeError(
            'biogym_wallclock_exhausted',
            'The approved wall-clock budget expired while the BioGym mutation was being recovered.',
            409
          )
        }
        if (!isRecoverableCliMutationError(secondError)) throw secondError
        throw new BioGymRuntimeError(
          'biogym_mutation_outcome_unknown',
          'BioGym mutation outcome is not yet known. Its idempotency key and exact intent were preserved for restart recovery.',
          502,
          { cause: safeErrorMessage(secondError), command: command[0] }
        )
      }
    }
  }

  private async runCliRead(
    settings: BioGymSettingsV1,
    workspaceRoot: string,
    command: readonly string[],
    timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    deadlineAtMs?: number
  ): Promise<unknown> {
    let lastError: unknown
    for (let attempt = 0; attempt <= TRANSIENT_READ_RETRY_DELAYS_MS.length; attempt += 1) {
      const remainingMs = deadlineAtMs === undefined ? timeoutMs : deadlineAtMs - Date.now()
      if (remainingMs <= 0) {
        throw new BioGymRuntimeError(
          'biogym_wallclock_exhausted',
          'The approved wall-clock budget expired during BioGym result recovery.',
          409
        )
      }
      try {
        return await this.runCli(
          settings,
          workspaceRoot,
          command,
          Math.max(1, Math.min(timeoutMs, remainingMs))
        )
      } catch (error) {
        throwIfCliOperationIndeterminate(error)
        if (deadlineAtMs !== undefined && Date.now() >= deadlineAtMs) {
          throw new BioGymRuntimeError(
            'biogym_wallclock_exhausted',
            'The approved wall-clock budget expired during BioGym result recovery.',
            409
          )
        }
        if (!isRecoverableCliReadError(error)) throw error
        lastError = error
        const retryDelay = TRANSIENT_READ_RETRY_DELAYS_MS[attempt]
        if (retryDelay === undefined) break
        const boundedDelay = deadlineAtMs === undefined
          ? retryDelay
          : Math.min(retryDelay, Math.max(1, deadlineAtMs - Date.now()))
        await delay(boundedDelay)
      }
    }
    throw new BioGymRuntimeError(
      'biogym_read_outcome_unknown',
      'A transient BioGym read failed repeatedly. The current stage and stable request IDs were preserved for recovery.',
      502,
      { cause: safeErrorMessage(lastError), command: command[0] }
    )
  }

  private async loadOwnedRun(workspaceRoot: string, designRunId: string, threadId: string): Promise<StoredRun> {
    const run = await this.loadRun(workspaceRoot, designRunId)
    if (run.owner.workspaceRoot !== workspaceRoot || run.owner.threadId !== threadId || run.owner.runtimeId !== 'sciforge') {
      throw new BioGymRuntimeError('biogym_run_not_found', 'BioGym design run was not found for this native thread.', 404)
    }
    return run
  }

  private async loadRun(workspaceRoot: string, designRunId: string): Promise<StoredRun> {
    if (!RUN_ID_PATTERN.test(designRunId)) {
      throw new BioGymRuntimeError('biogym_invalid_run_id', 'Invalid BioGym design-run ID.', 400)
    }
    const text = await readFile(runFilePath(workspaceRoot, designRunId), 'utf8').catch(() => null)
    if (!text) throw new BioGymRuntimeError('biogym_run_not_found', 'BioGym design run was not found.', 404)
    const run = JSON.parse(text) as StoredRun
    if (run.schemaVersion !== RUN_SCHEMA_VERSION || run.designRunId !== designRunId) {
      throw new BioGymRuntimeError('biogym_run_corrupt', 'BioGym design-run journal is invalid.', 500)
    }
    this.rememberRunActivity(run)
    return run
  }

  private async updateOwnedRun(
    workspaceRoot: string,
    designRunId: string,
    threadId: string,
    expectedRevision: number,
    eventType: string,
    mutate: (run: StoredRun) => unknown
  ): Promise<StoredRun> {
    return this.enqueueRun(`${workspaceRoot}:${designRunId}`, async () => {
      const run = await this.loadOwnedRun(workspaceRoot, designRunId, threadId)
      if (run.revision !== expectedRevision) {
        throw new BioGymRuntimeError(
          'biogym_revision_conflict',
          `BioGym run revision conflict: expected ${expectedRevision}, current ${run.revision}.`,
          409,
          { expectedRevision, currentRevision: run.revision }
        )
      }
      const detail = mutate(run)
      await this.persistMutation(run, eventType, detail)
      return run
    })
  }

  private async updateRun(
    workspaceRoot: string,
    designRunId: string,
    eventType: string,
    mutate: (run: StoredRun) => unknown
  ): Promise<StoredRun> {
    return this.enqueueRun(`${workspaceRoot}:${designRunId}`, async () => {
      const run = await this.loadRun(workspaceRoot, designRunId)
      const detail = mutate(run)
      await this.persistMutation(run, eventType, detail)
      return run
    })
  }

  private async updateRunMarker(
    workspaceRoot: string,
    designRunId: string,
    eventType: string,
    mutate: (run: StoredRun) => unknown
  ): Promise<StoredRun> {
    return this.enqueueRun(`${workspaceRoot}:${designRunId}`, async () => {
      const run = await this.loadRun(workspaceRoot, designRunId)
      const detail = mutate(run)
      await atomicWriteJson(runFilePath(run.owner.workspaceRoot, run.designRunId), run)
      await appendRunEvent(run, eventType, detail)
      this.rememberRunActivity(run)
      return run
    })
  }

  private async persistMutation(run: StoredRun, eventType: string, detail: unknown): Promise<void> {
    run.revision += 1
    run.updatedAt = this.now().toISOString()
    await atomicWriteJson(runFilePath(run.owner.workspaceRoot, run.designRunId), run)
    await appendRunEvent(run, eventType, detail)
    this.rememberRunActivity(run)
  }

  private rememberRunActivity(run: StoredRun): void {
    const key = runOwnerKey(run.owner.workspaceRoot, run.owner.threadId)
    const active = run.status !== 'completed' && run.status !== 'cancelled'
    const current = this.activeRunIdsByOwner.get(key)
    if (active) {
      const next = current ?? new Set<string>()
      next.add(run.designRunId)
      this.activeRunIdsByOwner.set(key, next)
      return
    }
    if (!current) return
    current.delete(run.designRunId)
    if (current.size === 0) this.activeRunIdsByOwner.delete(key)
  }

  private enqueueRun<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.runQueues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.runQueues.set(key, current)
    void current.finally(() => {
      if (this.runQueues.get(key) === current) this.runQueues.delete(key)
    }).catch(() => undefined)
    return current
  }

  private async addGlobalRunIndex(run: StoredRun): Promise<void> {
    const indexPath = join(this.options.userDataPath, 'biogym-runs.json')
    await mkdir(this.options.userDataPath, { recursive: true })
    const current = await readJsonIfExists(indexPath) as { schemaVersion?: number; runs?: Array<{ workspaceRoot: string; designRunId: string }> } | null
    const runs = current?.runs ?? []
    if (!runs.some((entry) => entry.workspaceRoot === run.owner.workspaceRoot && entry.designRunId === run.designRunId)) {
      runs.push({ workspaceRoot: run.owner.workspaceRoot, designRunId: run.designRunId })
    }
    await atomicWriteJson(indexPath, { schemaVersion: 1, runs: runs.slice(-2_000) })
  }

  private async persistLegacyContinuationDispositions(runs: StoredRun[]): Promise<StoredRun[]> {
    const targets = runs.flatMap((run) => legacyContinuationTargets(run))
    if (!targets.length) return runs

    const selectedByOwner = new Map<string, LegacyContinuationTarget>()
    const nowMs = this.now().getTime()
    for (const target of targets) {
      if (!isLegacyContinuationTargetActionable(target, nowMs)) continue
      const ownerKey = runOwnerKey(target.run.owner.workspaceRoot, target.run.owner.threadId)
      const previous = selectedByOwner.get(ownerKey)
      if (!previous || compareLegacyContinuationTargets(target, previous) > 0) {
        selectedByOwner.set(ownerKey, target)
      }
    }

    const dispositionsByRun = new Map<string, Map<string, LegacyContinuationDisposition>>()
    for (const target of targets) {
      const ownerKey = runOwnerKey(target.run.owner.workspaceRoot, target.run.owner.threadId)
      const selected = selectedByOwner.get(ownerKey)
      const disposition: LegacyContinuationDisposition = !isLegacyContinuationTargetActionable(target, nowMs)
        ? 'suppressed_inactive'
        : selected?.key === target.key
          ? 'replay_selected'
          : 'suppressed_older'
      const runKey = persistedRunKey(target.run)
      const runDispositions = dispositionsByRun.get(runKey) ?? new Map<string, LegacyContinuationDisposition>()
      runDispositions.set(target.stageAttemptId ?? 'ready', disposition)
      dispositionsByRun.set(runKey, runDispositions)
    }

    const updatedByRun = new Map<string, StoredRun>()
    for (const run of runs) {
      const runKey = persistedRunKey(run)
      const dispositions = dispositionsByRun.get(runKey)
      if (!dispositions) continue
      const updated = await this.updateRunMarker(
        run.owner.workspaceRoot,
        run.designRunId,
        'legacy_continuation_migrated',
        (stored) => {
          const migrated: Array<{ stageAttemptId?: string; disposition: LegacyContinuationDisposition }> = []
          const readyDisposition = dispositions.get('ready')
          if (readyDisposition && isRawLegacyReadyContinuation(stored)) {
            stored.remote.readyContinuationLegacyDisposition = readyDisposition
            stored.remote.readyContinuationNextRetryAt = undefined
            migrated.push({ disposition: readyDisposition })
          }
          for (const attempt of stored.stages) {
            const disposition = dispositions.get(attempt.id)
            if (!disposition || !isRawLegacyStageContinuation(attempt)) continue
            attempt.continuationLegacyDisposition = disposition
            attempt.continuationNextRetryAt = undefined
            migrated.push({ stageAttemptId: attempt.id, disposition })
          }
          return { migrated }
        }
      )
      updatedByRun.set(runKey, updated)
    }
    return runs.map((run) => updatedByRun.get(persistedRunKey(run)) ?? run)
  }

  private async resumePersistedRuns(): Promise<void> {
    const index = await readJsonIfExists(join(this.options.userDataPath, 'biogym-runs.json')) as {
      runs?: Array<{ workspaceRoot: string; designRunId: string }>
    } | null
    const loaded = (await Promise.all((index?.runs ?? []).map(async (entry) =>
      this.loadRun(entry.workspaceRoot, entry.designRunId).catch(() => null)
    ))).filter((run): run is StoredRun => run !== null)
    const persisted = await this.persistLegacyContinuationDispositions(loaded)

    for (const run of persisted) {
      this.emit(run, 'snapshot')
      const controllerMayResume = isRunEligibleForControllerRecovery(run)
      const continuationMayResume = isRunActionableForContinuation(run, this.now().getTime())
      if (controllerMayResume &&
          (run.remote.state === 'queued' || run.remote.state === 'starting' || run.remote.state === 'indeterminate')) {
        this.scheduleRemoteInitialization(run)
      }
      if (run.remote.state === 'ready' && run.stages.length === 0 &&
          continuationMayResume && isReadyContinuationPending(run)) {
        if (hasFutureReadyContinuationRetry(run, this.now().getTime())) {
          this.schedulePersistedContinuationRetry(run, undefined)
        } else {
          this.scheduleReadyContinuation(run)
        }
      }
      for (const attempt of run.stages) {
        if (controllerMayResume && (attempt.status === 'queued' || attempt.status === 'running')) {
          this.scheduleStageMonitor(run.designRunId, run.owner.workspaceRoot, attempt.id)
        } else if (continuationMayResume && isStageContinuationPending(attempt)) {
          if (hasFutureStageContinuationRetry(attempt, this.now().getTime())) {
            this.schedulePersistedContinuationRetry(run, attempt.id)
          } else {
            this.scheduleStageContinuation(run, attempt.id)
          }
        }
      }
      if (run.status === 'finalizing') void this.runFinalization(run.designRunId, run.owner.workspaceRoot)
      if (run.cleanup.requested && !run.cleanup.completed && run.status !== 'indeterminate') {
        void this.cleanupRemoteSession(run.designRunId, run.owner.workspaceRoot)
      }
    }
  }
}

type ImportedArtifact = {
  artifactId: string
  remotePath: string
  localPath: string
  workspaceRelativePath: string
  sha256: string
  size: number
  provenance?: unknown
}

function continuationFreshnessRequest(
  run: StoredRun,
  phase: BioGymContinuationFreshnessRequest['phase'],
  stageAttemptId?: string
): BioGymContinuationFreshnessRequest {
  const request: BioGymContinuationFreshnessRequest = {
    runtimeId: 'sciforge',
    threadId: run.owner.threadId,
    workspaceRoot: run.owner.workspaceRoot,
    designRunId: run.designRunId,
    expectedRevision: run.revision,
    hostRequestId: '',
    phase,
    ...(stageAttemptId ? { stageAttemptId } : {})
  }
  request.hostRequestId = continuationHostRequestId(request)
  return request
}

function continuationHostRequestId(input: Pick<
  BioGymContinuationFreshnessRequest,
  'designRunId' | 'expectedRevision' | 'phase' | 'stageAttemptId'
>): string {
  if (input.phase === 'ready') return `biogym:${input.designRunId}:ready:${input.expectedRevision}`
  if (input.phase === 'stage') return `biogym:${input.designRunId}:stage:${input.stageAttemptId ?? 'missing'}`
  return `biogym:${input.designRunId}:diagnostic:${input.expectedRevision}`
}

function continuationRejected(
  reason: string,
  details?: Readonly<Record<string, unknown>>
): BioGymContinuationFreshnessDecision {
  return {
    allow: false,
    reason,
    ...(details ? { details } : {})
  }
}

function continuationStateDetails(run: StoredRun): Readonly<Record<string, unknown>> {
  return {
    currentRevision: run.revision,
    status: run.status,
    remoteState: run.remote.state,
    stageCount: run.stages.length,
    activeStageAttemptId: run.stages.find((attempt) =>
      attempt.status === 'queued' || attempt.status === 'running'
    )?.id,
    finalizationStarted: Boolean(run.finalized),
    cleanupRequested: run.cleanup.requested
  }
}

function agentRuntimeContinuationSuppression(error: unknown): { reason: string } | null {
  if (!error || typeof error !== 'object' ||
      (error as { code?: unknown }).code !== 'agent_runtime_continuation_suppressed') return null
  const reason = (error as { reason?: unknown }).reason
  return {
    reason: typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, 512)
      : 'pre_start_guard_rejected'
  }
}

type LegacyContinuationTarget = {
  key: string
  run: StoredRun
  stageAttemptId?: string
  order: number
  tieBreaker: string
}

function legacyContinuationTargets(run: StoredRun): LegacyContinuationTarget[] {
  const targets: LegacyContinuationTarget[] = []
  if (isRawLegacyReadyContinuation(run) &&
      run.remote.readyContinuationLegacyDisposition !== 'suppressed_older' &&
      run.remote.readyContinuationLegacyDisposition !== 'suppressed_inactive') {
    targets.push({
      key: `${persistedRunKey(run)}:ready`,
      run,
      order: Date.parse(run.updatedAt) || run.startedAtMs,
      tieBreaker: `${run.updatedAt}:${run.designRunId}:ready`
    })
  }
  for (const [index, attempt] of run.stages.entries()) {
    if (!isRawLegacyStageContinuation(attempt) ||
        attempt.continuationLegacyDisposition === 'suppressed_older' ||
        attempt.continuationLegacyDisposition === 'suppressed_inactive') continue
    targets.push({
      key: `${persistedRunKey(run)}:${attempt.id}`,
      run,
      stageAttemptId: attempt.id,
      order: Date.parse(attempt.completedAt ?? attempt.startedAt ?? run.updatedAt) || run.startedAtMs + index,
      tieBreaker: `${attempt.completedAt ?? attempt.startedAt ?? run.updatedAt}:${run.designRunId}:${String(index).padStart(6, '0')}:${attempt.id}`
    })
  }
  return targets
}

function isRawLegacyReadyContinuation(run: StoredRun): boolean {
  return run.remote.state === 'ready' &&
    run.stages.length === 0 &&
    run.remote.readyContinuationDelivered === true &&
    !run.remote.readyContinuationTurnId
}

function isRawLegacyStageContinuation(attempt: StoredStageAttempt): boolean {
  return isTerminalStageAttempt(attempt) &&
    attempt.continuationDelivered === true &&
    !attempt.continuationTurnId
}

function compareLegacyContinuationTargets(left: LegacyContinuationTarget, right: LegacyContinuationTarget): number {
  if (left.order !== right.order) return left.order - right.order
  return left.tieBreaker.localeCompare(right.tieBreaker)
}

function persistedRunKey(run: StoredRun): string {
  return JSON.stringify([run.owner.workspaceRoot, run.designRunId])
}

function isRunEligibleForControllerRecovery(run: StoredRun): boolean {
  return run.status !== 'completed' &&
    run.status !== 'cancelled' &&
    run.status !== 'finalizing' &&
    !run.cleanup.requested
}

function isRunActionableForContinuation(run: StoredRun, nowMs: number): boolean {
  return isRunEligibleForControllerRecovery(run) &&
    nowMs < runWallclockDeadlineMs(run) &&
    !run.stages.some((attempt) => attempt.status === 'queued' || attempt.status === 'running')
}

function isLegacyContinuationTargetActionable(target: LegacyContinuationTarget, nowMs: number): boolean {
  if (!isRunActionableForContinuation(target.run, nowMs)) return false
  return Boolean(target.stageAttemptId) || target.run.status === 'awaiting_agent'
}

function isReadyContinuationPending(run: StoredRun): boolean {
  if (run.remote.readyContinuationLegacyDisposition === 'suppressed_older' ||
      run.remote.readyContinuationLegacyDisposition === 'suppressed_inactive' ||
      run.remote.readyContinuationSuppressedAt) return false
  return run.remote.readyContinuationDelivered !== true ||
    (!run.remote.readyContinuationTurnId &&
      run.remote.readyContinuationLegacyDisposition === 'replay_selected')
}

function isStageContinuationPending(attempt: StoredStageAttempt): boolean {
  if (!isTerminalStageAttempt(attempt) ||
      attempt.continuationLegacyDisposition === 'suppressed_older' ||
      attempt.continuationLegacyDisposition === 'suppressed_inactive' ||
      attempt.continuationSuppressedAt) return false
  return attempt.continuationDelivered !== true ||
    (!attempt.continuationTurnId && attempt.continuationLegacyDisposition === 'replay_selected')
}

function isTerminalStageAttempt(attempt: StoredStageAttempt): boolean {
  return attempt.status === 'succeeded' || attempt.status === 'failed' || attempt.status === 'indeterminate'
}

function hasFutureReadyContinuationRetry(run: StoredRun, nowMs: number): boolean {
  return Boolean(run.remote.readyContinuationNextRetryAt &&
    Date.parse(run.remote.readyContinuationNextRetryAt) > nowMs)
}

function hasFutureStageContinuationRetry(attempt: StoredStageAttempt, nowMs: number): boolean {
  return Boolean(attempt.continuationNextRetryAt && Date.parse(attempt.continuationNextRetryAt) > nowMs)
}

function normalizeModelProvenance(artifacts: ImportedArtifact[]): {
  names: string[]
  checkpointHashes: string[]
} {
  const names = new Set<string>()
  const checkpointHashes = new Set<string>()
  for (const artifact of artifacts) {
    const provenance = recordOrUndefined(artifact.provenance)
    const runtime = recordOrUndefined(provenance?.runtime)
    const modelName = optionalString(runtime?.model_name)
    const checkpointHash = optionalString(runtime?.model_checkpoint_hash)
    if (modelName) names.add(modelName)
    if (checkpointHash) checkpointHashes.add(checkpointHash)
  }
  return {
    names: [...names].sort(),
    checkpointHashes: [...checkpointHashes].sort()
  }
}

function stageSourceProvenance(
  run: StoredRun,
  attempt: StoredStageAttempt
): Array<{ role: string; referenceId: string; sha256: string | null }> {
  if (attempt.request.kind === 'sequence') {
    const request = attempt.request
    const source = run.candidates.find((candidate) =>
      candidate.id === request.backboneAssetId ||
      candidate.assetId === request.backboneAssetId
    )
    return [{
      role: 'backbone',
      referenceId: request.backboneAssetId,
      sha256: source?.sourceSha256 ?? null
    }]
  }
  if (attempt.request.kind === 'verify') {
    const request = attempt.request
    const selectedIds = attempt.verificationCandidateIds ?? resolveVerificationCandidateIds(run, request)
    return selectedIds.map((candidateId) => {
      const candidate = run.candidates.find((entry) =>
        entry.id === candidateId && Boolean(entry.candidateSetId)
      )
      return {
        role: 'sequence_candidate',
        referenceId: candidateId,
        sha256: candidate?.sourceSha256 ?? null
      }
    })
  }
  if (attempt.request.kind === 'binder' && run.input.targetStructure) {
    return [{
      role: 'target_structure',
      referenceId: run.input.targetStructure.id,
      sha256: run.input.targetStructure.sha256
    }]
  }
  return []
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

type TrustedVerificationCandidate = {
  candidateId: string
  sequence: string
  proteinMpnnScore?: number
  candidateSetId: string
  stageAttemptId: string
  sourceArtifactId?: string
  sourceSha256: string
}

async function loadTrustedVerificationCandidates(
  run: StoredRun,
  candidateIds: string[]
): Promise<TrustedVerificationCandidate[]> {
  const sourceRows = new Map<string, Array<Record<string, string>>>()
  const selected: TrustedVerificationCandidate[] = []
  for (const candidateId of candidateIds) {
    const candidate = run.candidates.find((entry) =>
      entry.id === candidateId && Boolean(entry.candidateSetId)
    )
    const candidateSet = candidate?.candidateSetId
      ? run.candidateSets.find((entry) => entry.id === candidate.candidateSetId)
      : undefined
    if (!candidate || !candidateSet) {
      throw new BioGymRuntimeError(
        'biogym_unknown_candidate',
        `Verification candidate is not a trusted ProteinMPNN output: ${candidateId}`,
        400
      )
    }
    let records = sourceRows.get(candidateSet.id)
    if (!records) {
      const artifactRoot = join(
        runRoot(run.owner.workspaceRoot, run.designRunId),
        'artifacts',
        candidateSet.stageAttemptId
      )
      const canonicalRoot = await realpath(artifactRoot)
      const sourcePath = await realpath(resolve(artifactRoot, candidateSet.remotePath)).catch(() => '')
      if (!sourcePath) {
        throw new BioGymRuntimeError(
          'biogym_candidate_source_missing',
          `Trusted candidate source is missing for ${candidateSet.id}.`,
          409
        )
      }
      assertPathInside(canonicalRoot, sourcePath, 'Candidate source escaped its isolated stage directory.')
      const expectedSha256 = candidateSet.sourceSha256 ?? candidate.sourceSha256
      if (!expectedSha256) {
        throw new BioGymRuntimeError(
          'biogym_candidate_source_unverified',
          `Candidate source has no registered SHA-256 for ${candidateSet.id}.`,
          409
        )
      }
      const actual = await hashAndSize(sourcePath)
      if (actual.sha256 !== expectedSha256) {
        throw new BioGymRuntimeError(
          'biogym_candidate_source_changed',
          `Candidate source changed after import for ${candidateSet.id}.`,
          409
        )
      }
      if (/\.csv$/i.test(sourcePath)) {
        records = await readCsv(sourcePath)
      } else {
        records = (await readFasta(sourcePath)).map((record, index) => ({
          candidate_id: record.header.split(/\s+/, 1)[0] || `${candidateSet.stageAttemptId}-candidate-${index + 1}`,
          sequence: record.sequence
        }))
      }
      sourceRows.set(candidateSet.id, records)
    }
    const record = records.find((entry) => entry.candidate_id === candidateId)
    if (!record) {
      throw new BioGymRuntimeError(
        'biogym_candidate_identity_missing',
        `Candidate ${candidateId} is absent from its hash-verified source artifact.`,
        409
      )
    }
    const sequence = normalizeProteinSequence(record.sequence)
    if (candidate.sequence && normalizeProteinSequence(candidate.sequence) !== sequence) {
      throw new BioGymRuntimeError(
        'biogym_candidate_identity_mismatch',
        `Candidate ${candidateId} no longer matches its imported sequence.`,
        409
      )
    }
    const sourceScore = optionalFiniteNumber(record.score)
    if (candidate.score !== undefined && sourceScore !== undefined &&
        Math.abs(candidate.score - sourceScore) > 1e-9) {
      throw new BioGymRuntimeError(
        'biogym_candidate_score_mismatch',
        `Candidate ${candidateId} no longer matches its imported ProteinMPNN score.`,
        409
      )
    }
    selected.push({
      candidateId,
      sequence,
      ...(sourceScore !== undefined ? { proteinMpnnScore: sourceScore } : {}),
      candidateSetId: candidateSet.id,
      stageAttemptId: candidateSet.stageAttemptId,
      ...(candidate.sourceArtifactId ? { sourceArtifactId: candidate.sourceArtifactId } : {}),
      sourceSha256: candidateSet.sourceSha256 ?? candidate.sourceSha256!
    })
  }
  return selected
}

function verificationCandidateCsv(candidates: TrustedVerificationCandidate[]): string {
  const headers = [
    'candidate_id',
    'sequence',
    'score',
    'source_candidate_set_id',
    'source_stage_attempt_id',
    'source_artifact_id',
    'source_sha256'
  ]
  const rows = candidates.map((candidate) => [
    candidate.candidateId,
    candidate.sequence,
    candidate.proteinMpnnScore?.toString() ?? '',
    candidate.candidateSetId,
    candidate.stageAttemptId,
    candidate.sourceArtifactId ?? '',
    candidate.sourceSha256
  ])
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

async function normalizeStageCandidates(
  run: StoredRun,
  attempt: StoredStageAttempt,
  artifacts: ImportedArtifact[],
  derivedRoot: string
): Promise<{
  candidates: StoredCandidateRef[]
  totalCandidateCount: number
  candidateSet?: StoredRun['candidateSets'][number]
}> {
  const limit = Math.min(run.budget.maxCandidatesPerStage, DEFAULT_DISPLAY_CANDIDATES)
  if (attempt.kind === 'backbone') {
    const structures = artifacts.filter((artifact) => /\.pdb$/i.test(artifact.remotePath))
      .sort((left, right) => left.remotePath.localeCompare(right.remotePath, 'en', { numeric: true }))
    return {
      totalCandidateCount: structures.length,
      candidates: structures.slice(0, limit).map((artifact, index) => ({
        id: `${attempt.id}-candidate-${String(index + 1).padStart(3, '0')}`,
        label: basename(artifact.remotePath),
        assetId: assetId(attempt.id, index + 1),
        relativePath: artifact.workspaceRelativePath,
        remotePath: artifact.remotePath,
        sourceArtifactId: artifact.artifactId,
        sourceSha256: artifact.sha256
      }))
    }
  }

  if (attempt.kind === 'sequence') {
    const csvArtifact = artifacts.find((artifact) => /designed_sequences\.csv$/i.test(artifact.remotePath))
    const fastaArtifact = artifacts.find((artifact) => /designed_sequences\.(?:fa|fasta|faa)$/i.test(artifact.remotePath))
    let records: Array<Record<string, string>> = []
    if (csvArtifact) records = await readCsv(csvArtifact.localPath)
    if (!records.length && fastaArtifact) {
      records = (await readFasta(fastaArtifact.localPath)).map((record, index) => ({
        candidate_id: `${attempt.id}-candidate-${String(index + 1).padStart(3, '0')}`,
        sequence: record.sequence,
        source_header: record.header
      }))
    }
    const ordered = records.map((record, index) => ({ record, index }))
      .sort((left, right) => compareOptionalNumbers(left.record.score, right.record.score) || left.index - right.index)
      .map((entry) => entry.record)
    const displayed = ordered.slice(0, limit)
    const viewerPath = join(derivedRoot, 'viewer-top-candidates.fasta')
    const viewerText = displayed.map((record, index) => {
      const id = record.candidate_id || `${attempt.id}-candidate-${String(index + 1).padStart(3, '0')}`
      return `>${sanitizeFastaHeader(id)}\n${normalizeProteinSequence(record.sequence)}\n`
    }).join('')
    if (viewerText) await atomicWriteText(viewerPath, viewerText)
    const workspacePath = viewerText ? toWorkspaceRelative(run.owner.workspaceRoot, viewerPath) : undefined
    const sharedAssetId = viewerText ? assetId(attempt.id, 1, 'sequences') : undefined
    const candidateSetId = `set:${attempt.id}`
    const sequenceSourceArtifact = csvArtifact ?? fastaArtifact
    const candidates = displayed.map((record, index): StoredCandidateRef => {
      const score = optionalFiniteNumber(record.score)
      return {
        id: record.candidate_id || `${attempt.id}-candidate-${String(index + 1).padStart(3, '0')}`,
        label: record.candidate_id || `Sequence ${index + 1}`,
        sequence: normalizeProteinSequence(record.sequence),
        ...(sharedAssetId ? { assetId: sharedAssetId } : {}),
        ...(workspacePath ? { relativePath: workspacePath } : {}),
        ...(score !== undefined ? { score, scoreLabel: 'ProteinMPNN score (lower is better)' } : {}),
        metrics: compactMetrics(record, ['score', 'global_score', 'seq_recovery', 'temperature']),
        candidateSetId,
        ...(sequenceSourceArtifact ? {
          sourceArtifactId: sequenceSourceArtifact.artifactId,
          sourceSha256: sequenceSourceArtifact.sha256
        } : {})
      }
    })
    const remotePath = csvArtifact?.remotePath ?? fastaArtifact?.remotePath
    return {
      candidates,
      totalCandidateCount: ordered.length,
      ...(remotePath ? {
        candidateSet: {
          id: candidateSetId,
          stageAttemptId: attempt.id,
          remotePath,
          candidateIds: candidates.map((candidate) => candidate.id),
          ...(sequenceSourceArtifact ? { sourceSha256: sequenceSourceArtifact.sha256 } : {})
        }
      } : {})
    }
  }

  if (attempt.kind === 'verify') {
    const csvArtifact = artifacts.find((artifact) => /verified_candidates\.csv$/i.test(artifact.remotePath))
    const records = csvArtifact ? await readCsv(csvArtifact.localPath) : []
    const expectedIds = attempt.verificationCandidateIds ??
      (attempt.request.kind === 'verify' ? resolveVerificationCandidateIds(run, attempt.request) : [])
    const returnedIds = records.map((record) => record.candidate_id).filter(Boolean)
    if (new Set(returnedIds).size !== returnedIds.length ||
        returnedIds.length !== expectedIds.length ||
        expectedIds.some((candidateId) => !returnedIds.includes(candidateId))) {
      throw new BioGymRuntimeError(
        'biogym_verification_identity_mismatch',
        `Boltz returned candidates [${returnedIds.join(', ')}], expected exactly [${expectedIds.join(', ')}].`,
        502
      )
    }
    const ordered = records.map((record, index) => ({ record, index }))
      .sort((left, right) => compareOptionalNumbers(right.record.confidence_score, left.record.confidence_score) || left.index - right.index)
      .map((entry) => entry.record)
    const structures = artifacts.filter((artifact) => /\.(?:cif|mmcif|pdb)$/i.test(artifact.remotePath))
    const candidates = ordered.slice(0, limit).flatMap((record, index): StoredCandidateRef[] => {
      const structure = matchArtifactPath(structures, record.structure_path)
      if (!structure) return []
      const score = optionalFiniteNumber(record.confidence_score)
      const sourceCandidate = run.candidates.find((candidate) =>
        candidate.id === record.candidate_id && Boolean(candidate.candidateSetId)
      )
      const metrics = compactMetrics(record, [
        'confidence_score', 'ptm', 'iptm', 'complex_plddt',
        'affinity_pred_value', 'affinity_probability_binary'
      ]) ?? {}
      if (sourceCandidate?.score !== undefined) metrics.proteinmpnn_score = sourceCandidate.score
      if (sourceCandidate?.candidateSetId) metrics.source_candidate_set_id = sourceCandidate.candidateSetId
      return [{
        id: record.candidate_id || `${attempt.id}-candidate-${String(index + 1).padStart(3, '0')}`,
        label: record.candidate_id || basename(structure.remotePath),
        assetId: assetId(attempt.id, index + 1),
        relativePath: structure.workspaceRelativePath,
        remotePath: structure.remotePath,
        sourceArtifactId: structure.artifactId,
        sourceSha256: structure.sha256,
        ...(score !== undefined ? { score, scoreLabel: 'Boltz confidence_score' } : {}),
        metrics
      }]
    })
    return {
      candidates,
      totalCandidateCount: ordered.length || structures.length
    }
  }

  const acceptedCsv = artifacts.find((artifact) => /accepted_candidates\.csv$/i.test(artifact.remotePath))
  const accepted = acceptedCsv ? await readCsv(acceptedCsv.localPath) : []
  const structures = artifacts.filter((artifact) => /\.pdb$/i.test(artifact.remotePath))
    .sort((left, right) => left.remotePath.localeCompare(right.remotePath, 'en', { numeric: true }))
  const orderedStructures = accepted.length
    ? uniqueBy(accepted.flatMap((row, index) => {
        const candidatePath = rowValue(row, ['structure_path', 'pdb_path', 'complex_path', 'design_path', 'filename'])
        const candidateName = rowValue(row, ['candidate_id', 'design_name', 'design', 'name'])
        const matched = matchArtifactPath(structures, candidatePath) ??
          (candidateName
            ? structures.find((artifact) => basename(artifact.remotePath, extname(artifact.remotePath)) === candidateName ||
                basename(artifact.remotePath).includes(candidateName))
            : undefined) ??
          structures[index]
        return matched ? [matched] : []
      }), (artifact) => artifact.remotePath)
    : structures
  return {
    totalCandidateCount: accepted.length || structures.length,
    candidates: orderedStructures.slice(0, limit).map((artifact, index) => ({
      id: rowValue(accepted[index], ['candidate_id', 'design_name', 'design', 'name']) || `${attempt.id}-candidate-${String(index + 1).padStart(3, '0')}`,
      label: rowValue(accepted[index], ['design_name', 'design', 'name']) || basename(artifact.remotePath),
      assetId: assetId(attempt.id, index + 1),
      relativePath: artifact.workspaceRelativePath,
      remotePath: artifact.remotePath,
      sourceArtifactId: artifact.artifactId,
      sourceSha256: artifact.sha256,
      metrics: accepted[index] ? compactMetrics(accepted[index], Object.keys(accepted[index]).slice(0, 12)) : undefined
    }))
  }
}

function buildCallToolAction(run: StoredRun, attempt: StoredStageAttempt): Record<string, unknown> {
  if (attempt.request.kind === 'backbone') {
    return {
      type: 'CALL_TOOL',
      capability: attempt.capability,
      backend: attempt.backend,
      args: {
        binder_length_range: attempt.request.lengthRange,
        num_backbones: attempt.request.numBackbones,
        output_dir: attempt.outputDir
      }
    }
  }
  if (attempt.request.kind === 'sequence') {
    const request = attempt.request
    const backbone = run.candidates.find((candidate) => candidate.id === request.backboneAssetId || candidate.assetId === request.backboneAssetId)
    if (!backbone?.remotePath) throw new BioGymRuntimeError('biogym_unknown_backbone', 'Backbone asset has no trusted remote source.', 400)
    return {
      type: 'CALL_TOOL',
      capability: attempt.capability,
      backend: attempt.backend,
      args: {
        backbone_path: backbone.remotePath,
        chains_to_design: request.chainsToDesign ?? [],
        num_sequences_per_backbone: request.numSequences,
        sampling_temperature: request.samplingTemperature ?? 0.2,
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
        output_dir: attempt.outputDir
      }
    }
  }
  if (attempt.request.kind === 'verify') {
    const candidateIds = attempt.verificationCandidateIds ?? resolveVerificationCandidateIds(run, attempt.request)
    const candidateSequences = attempt.verificationInputRemotePath
    if (!candidateSequences) {
      throw new BioGymRuntimeError(
        'biogym_verification_input_missing',
        'The exact verification candidate file has not been prepared.',
        500
      )
    }
    return {
      type: 'CALL_TOOL',
      capability: attempt.capability,
      backend: attempt.backend,
      args: {
        candidate_sequences: candidateSequences,
        top_n: candidateIds.length,
        output_dir: attempt.outputDir
      }
    }
  }
  if (!run.input.targetStructure) {
    throw new BioGymRuntimeError('biogym_target_required', 'Target-binder workflow is missing its trusted target structure.', 400)
  }
  return {
    type: 'CALL_TOOL',
    capability: attempt.capability,
    backend: attempt.backend,
    args: {
      target_structure: run.input.targetStructure.remotePath,
      target_chain: run.input.targetChain,
      hotspot_residues: run.input.hotspotResidues,
      binder_length_range: attempt.request.lengthRange,
      num_design_trajectories: attempt.request.numTrajectories ?? 1,
      num_mpnn_sequences: attempt.request.numSequences ?? 1,
      number_of_final_designs: attempt.request.finalDesigns ?? 1,
      output_dir: attempt.outputDir
    }
  }
}

function taskForRun(run: StoredRun): Record<string, unknown> {
  const inputs: Record<string, string> = {}
  if (run.input.backbone) inputs.backbone_path = run.input.backbone.localPath
  if (run.input.targetStructure) inputs.target_structure = run.input.targetStructure.localPath
  return {
    id: run.designRunId.replaceAll('-', '_'),
    domain: 'protein_design',
    objective: run.objective,
    inputs,
    constraints: {
      workflow: run.workflow,
      target_chain: run.input.targetChain,
      hotspot_residues: run.input.hotspotResidues
    },
    allowed_capabilities: capabilitiesForWorkflow(run.workflow),
    budgets: {
      // BioGym's immutable task is provisioned to the service hard ceiling;
      // the smaller user-approved envelope is enforced by this durable
      // controller. This allows a separately approved extension without
      // replacing the remote run or weakening the 20-job/12-hour ceiling.
      max_steps: HARD_MAX_GPU_JOBS * 4 + 20,
      max_gpu_jobs: HARD_MAX_GPU_JOBS,
      max_wallclock_hours: HARD_MAX_WALLCLOCK_HOURS
    },
    required_outputs: [
      'results/sciforge_design_decision.json',
      'results/evaluation.json',
      'results/final_report.md'
    ],
    evaluators: ['artifact_completeness', 'provenance_completeness', 'candidate_count']
  }
}

function assertStartInput(request: Extract<BioGymDesignRequest, { operation: 'start' }>): void {
  if (request.workflow === 'fixed_backbone' && !request.input?.backbonePath) {
    throw new BioGymRuntimeError('biogym_backbone_required', 'Fixed-backbone design requires input.backbonePath.', 400)
  }
  if (request.workflow === 'target_binder' && (!request.input?.targetStructurePath || !request.input.targetChain)) {
    throw new BioGymRuntimeError(
      'biogym_target_required',
      'Target-binder design requires input.targetStructurePath and input.targetChain.',
      400
    )
  }
  if (request.workflow !== 'fixed_backbone' && request.input?.backbonePath) {
    throw new BioGymRuntimeError('biogym_input_not_allowed', 'backbonePath is only accepted for fixed-backbone design.', 400)
  }
  if (request.workflow !== 'target_binder' && request.input?.targetStructurePath) {
    throw new BioGymRuntimeError('biogym_input_not_allowed', 'targetStructurePath is only accepted for target-binder design.', 400)
  }
}

function assertCanAdvance(run: StoredRun, stage: BioGymStageRequest): void {
  if (run.remote.state !== 'ready' || !run.remote.ref) {
    throw new BioGymRuntimeError('biogym_run_not_ready', 'BioGym remote initialization has not completed.', 409)
  }
  if (run.cleanup.requested) {
    throw new BioGymRuntimeError('biogym_cleanup_pending', 'The isolated remote session is being cleaned and cannot accept new stages.', 409)
  }
  if (run.status === 'cancelled' || run.status === 'completed' || run.status === 'finalizing' || run.status === 'indeterminate') {
    throw new BioGymRuntimeError('biogym_run_terminal', `Cannot advance a run in ${run.status} state.`, 409)
  }
  if (run.stages.some((attempt) => attempt.status === 'queued' || attempt.status === 'running')) {
    throw new BioGymRuntimeError('biogym_stage_active', 'Only one BioGym stage may run at a time.', 409)
  }
  const legal = stage.kind === 'binder'
    ? run.workflow === 'target_binder'
    : stage.kind === 'backbone'
      ? run.workflow === 'de_novo_scaffold'
      : stage.kind === 'sequence'
        ? run.workflow === 'de_novo_scaffold' || run.workflow === 'fixed_backbone'
        : run.workflow !== 'target_binder'
  if (!legal) {
    throw new BioGymRuntimeError(
      'biogym_illegal_stage',
      `Stage ${stage.kind} is not legal for workflow ${run.workflow}.`,
      400
    )
  }
}

function validateStageReferences(run: StoredRun, stage: BioGymStageRequest): void {
  if (stage.kind === 'sequence') {
    const candidate = run.candidates.find((row) => row.id === stage.backboneAssetId || row.assetId === stage.backboneAssetId)
    if (!candidate?.remotePath || !/\.pdb$/i.test(candidate.remotePath)) {
      throw new BioGymRuntimeError(
        'biogym_unknown_backbone',
        'backboneAssetId must reference a structure produced by this run or the trusted fixed-backbone input.',
        400
      )
    }
  }
  if (stage.kind === 'verify') {
    if (stage.candidateSetId) {
      const candidateSet = run.candidateSets.find((set) => set.id === stage.candidateSetId)
      if (!candidateSet) {
        throw new BioGymRuntimeError(
          'biogym_unknown_candidate_set',
          'candidateSetId must reference a sequence-stage result from this run.',
          400
        )
      }
      if ((stage.topN ?? candidateSet.candidateIds.length) > candidateSet.candidateIds.length) {
        throw new BioGymRuntimeError(
          'biogym_candidate_count_exceeded',
          'topN exceeds the number of trusted candidates in this candidate set.',
          400
        )
      }
      return
    }
    const unknown = (stage.candidateIds ?? []).filter((candidateId) =>
      !run.candidates.some((candidate) => candidate.id === candidateId && candidate.candidateSetId)
    )
    if (unknown.length) {
      throw new BioGymRuntimeError(
        'biogym_unknown_candidate',
        `candidateIds must reference ProteinMPNN candidates from this run: ${unknown.slice(0, 5).join(', ')}`,
        400
      )
    }
  }
}

function resolveVerificationCandidateIds(
  run: StoredRun,
  stage: Extract<BioGymStageRequest, { kind: 'verify' }>
): string[] {
  if (stage.candidateIds?.length) return [...stage.candidateIds]
  const candidateSet = run.candidateSets.find((set) => set.id === stage.candidateSetId)
  if (!candidateSet) {
    throw new BioGymRuntimeError(
      'biogym_unknown_candidate_set',
      'Candidate set is not part of this run.',
      400
    )
  }
  const count = stage.topN ?? Math.min(candidateSet.candidateIds.length, run.budget.maxCandidatesPerStage)
  return candidateSet.candidateIds.slice(0, count)
}

function assertWithinWallclock(run: StoredRun, nowMs: number): void {
  if (nowMs >= runWallclockDeadlineMs(run)) {
    throw new BioGymRuntimeError('biogym_wallclock_exhausted', 'The approved wall-clock budget is exhausted.', 409)
  }
}

function runWallclockDeadlineMs(run: StoredRun): number {
  return run.startedAtMs + run.budget.maxWallclockHours * 3_600_000
}

function readyAdvanceShape(run: StoredRun): string {
  const prefix = `Exact call shape: {"operation":"advance","designRunId":"${run.designRunId}","expectedRevision":${run.revision},"stage":`
  if (run.workflow === 'target_binder') {
    return `${prefix}{"kind":"binder","lengthRange":[<minimum>,<maximum>],"finalDesigns":<count>}}}.`
  }
  if (run.workflow === 'fixed_backbone') {
    return `${prefix}{"kind":"sequence","backboneAssetId":"input-backbone","numSequences":<count>}}}.`
  }
  return `${prefix}{"kind":"backbone","lengthRange":[<minimum>,<maximum>],"numBackbones":<count>}}}. Do not use params or add stage.description.`
}

function canonicalNextAdvanceCalls(run: StoredRun): Array<Record<string, unknown>> {
  const allowed = new Set(allowedNextStages(run))
  const calls: Array<Record<string, unknown>> = []
  const common = {
    operation: 'advance',
    designRunId: run.designRunId,
    expectedRevision: run.revision
  }

  if (allowed.has('sequence')) {
    const latestBackboneAttempt = [...run.stages]
      .reverse()
      .find((attempt) => attempt.kind === 'backbone' && attempt.status === 'succeeded')
    const eligibleBackbones = latestBackboneAttempt?.candidates.length
      ? latestBackboneAttempt.candidates
      : run.input.backbone
        ? [{ id: run.input.backbone.id }]
        : []
    const numSequences = Math.min(5, run.budget.maxCandidatesPerStage)
    for (const candidate of eligibleBackbones.slice(0, DEFAULT_DISPLAY_CANDIDATES)) {
      calls.push({
        ...common,
        stage: {
          kind: 'sequence',
          backboneAssetId: candidate.id,
          numSequences
        }
      })
    }
  }

  if (allowed.has('verify')) {
    const globallyRanked = uniqueBy(
      run.candidates
        .filter((candidate) => candidate.candidateSetId && candidate.score !== undefined)
        .sort((left, right) =>
          (left.score ?? Number.POSITIVE_INFINITY) - (right.score ?? Number.POSITIVE_INFINITY) ||
          left.id.localeCompare(right.id, 'en', { numeric: true })
        ),
      (candidate) => candidate.id
    )
    const exactCandidateIds = globallyRanked
      .slice(0, Math.max(1, Math.min(2, globallyRanked.length)))
      .map((candidate) => candidate.id)
    if (exactCandidateIds.length) {
      calls.push({
        ...common,
        stage: {
          kind: 'verify',
          candidateIds: exactCandidateIds
        }
      })
    } else {
      const candidateSet = run.candidateSets.at(-1)
      if (candidateSet) {
        calls.push({
          ...common,
          stage: {
            kind: 'verify',
            candidateSetId: candidateSet.id,
            topN: Math.max(1, Math.min(2, candidateSet.candidateIds.length))
          }
        })
      }
    }
  }
  return calls
}

function canonicalNextCallGuidance(run: StoredRun): string {
  const calls = canonicalNextAdvanceCalls(run)
  if (!calls.length) return ''
  return `Valid ready-to-send next-stage calls (choose exactly one; do not wrap or add fields): ${JSON.stringify(calls)}`
}

function canonicalFinalizationCalls(run: StoredRun): Array<Record<string, unknown>> {
  if (
    run.remote.state !== 'ready' ||
    run.status === 'cancelled' ||
    run.status === 'completed' ||
    run.status === 'finalizing' ||
    run.status === 'indeterminate' ||
    run.cleanup.requested ||
    run.stages.some((attempt) => attempt.status === 'queued' || attempt.status === 'running')
  ) return []

  const finalEvidenceKind: BioGymStageKind = run.workflow === 'target_binder' ? 'binder' : 'verify'
  const finalEvidence = [...run.stages]
    .reverse()
    .find((attempt) => attempt.kind === finalEvidenceKind && attempt.status === 'succeeded')
  if (!finalEvidence) return []

  const caveats = [
    'These are computational predictions, not wet-lab validation.',
    run.workflow === 'target_binder'
      ? 'Predicted binder designs do not establish binding affinity, specificity, expression, stability, or safety.'
      : 'Boltz-2 confidence does not establish binding affinity, expression, stability, solubility, or safety.'
  ]
  const selectedCandidateIds = [...finalEvidence.candidates]
    .sort((left, right) =>
      (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY) ||
      left.id.localeCompare(right.id, 'en', { numeric: true })
    )
    .slice(0, Math.min(2, HARD_MAX_CANDIDATES))
    .map((candidate) => candidate.id)
  const common = {
    operation: 'finalize',
    designRunId: run.designRunId,
    expectedRevision: run.revision
  }
  return [
    ...(selectedCandidateIds.length
      ? [{
          ...common,
          disposition: 'selected',
          selectedCandidateIds,
          summary: `Selected ${selectedCandidateIds.join(', ')} from the completed computational design workflow.`,
          caveats
        }]
      : []),
    {
      ...common,
      disposition: 'no_viable_candidate',
      summary: 'No candidate met the current computational selection criteria.',
      caveats
    }
  ]
}

function canonicalFinalizationCallGuidance(run: StoredRun): string {
  const calls = canonicalFinalizationCalls(run)
  if (!calls.length) return ''
  return `Valid ready-to-send finalization calls (choose one only after analyzing the evidence; every required field is included): ${JSON.stringify(calls)}`
}

function allowedNextStages(run: StoredRun): BioGymStageKind[] {
  if (run.remote.state !== 'ready' || run.status === 'cancelled' || run.status === 'completed' ||
      run.status === 'finalizing' || run.status === 'indeterminate' ||
      run.cleanup.requested ||
      run.stages.some((attempt) => attempt.status === 'queued' || attempt.status === 'running') ||
      run.budget.usedGpuJobs >= run.budget.maxGpuJobs) return []
  if (run.workflow === 'target_binder') return ['binder']
  const stages: BioGymStageKind[] = []
  if (run.workflow === 'de_novo_scaffold') stages.push('backbone')
  const hasBackbone = Boolean(run.input.backbone) || run.candidates.some((candidate) =>
    candidate.remotePath && /\.(?:pdb|cif|mmcif)$/i.test(candidate.remotePath)
  )
  if (hasBackbone) stages.push('sequence')
  if (run.candidateSets.length) stages.push('verify')
  return stages
}

function snapshotForRun(run: StoredRun, now: Date): BioGymRunSnapshot {
  const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - run.startedAtMs) / 1_000))
  return {
    designRunId: run.designRunId,
    roomId: run.roomId,
    workflow: run.workflow,
    objective: run.objective,
    status: run.status,
    revision: run.revision,
    ...(run.stages.find((attempt) => attempt.status === 'queued' || attempt.status === 'running')
      ? { currentStageAttemptId: run.stages.find((attempt) => attempt.status === 'queued' || attempt.status === 'running')!.id }
      : {}),
    stages: run.stages.map((attempt) => ({
      id: attempt.id,
      kind: attempt.kind,
      attempt: attempt.attempt,
      status: attempt.status,
      ...(attempt.backend ? { backend: attempt.backend } : {}),
      ...(attempt.startedAt ? { startedAt: attempt.startedAt } : {}),
      ...(attempt.completedAt ? { completedAt: attempt.completedAt } : {}),
      candidateCount: attempt.candidateCount,
      ...(attempt.activeCandidateId ? { activeCandidateId: attempt.activeCandidateId } : {}),
      assetIds: attempt.assetIds.slice(0, DEFAULT_DISPLAY_CANDIDATES),
      candidates: attempt.candidates.slice(0, DEFAULT_DISPLAY_CANDIDATES),
      ...(attempt.error ? { error: attempt.error.slice(0, 2_000) } : {})
    })),
    budget: {
      maxGpuJobs: run.budget.maxGpuJobs,
      usedGpuJobs: run.budget.usedGpuJobs,
      remainingGpuJobs: Math.max(0, run.budget.maxGpuJobs - run.budget.usedGpuJobs),
      maxWallclockHours: run.budget.maxWallclockHours,
      elapsedSeconds
    },
    updatedAt: run.updatedAt
  }
}

function capabilityForStage(kind: BioGymStageKind): string {
  if (kind === 'backbone') return 'protein.backbone.generate'
  if (kind === 'sequence') return 'protein.sequence.design_fixed_backbone'
  if (kind === 'verify') return 'protein.structure_or_affinity.verify'
  return 'protein.binder.design_denovo'
}

function backendForStage(kind: BioGymStageKind): string {
  if (kind === 'backbone') return 'rfdiffusion'
  if (kind === 'sequence') return 'proteinmpnn'
  if (kind === 'verify') return 'boltz2'
  return 'bindcraft'
}

function capabilitiesForWorkflow(workflow: BioGymWorkflow): string[] {
  if (workflow === 'target_binder') return ['protein.binder.design_denovo']
  if (workflow === 'fixed_backbone') {
    return ['protein.sequence.design_fixed_backbone', 'protein.structure_or_affinity.verify']
  }
  return [
    'protein.backbone.generate',
    'protein.sequence.design_fixed_backbone',
    'protein.structure_or_affinity.verify'
  ]
}

function defaultGpuJobs(workflow: BioGymWorkflow): number {
  if (workflow === 'de_novo_scaffold') return 6
  if (workflow === 'fixed_backbone') return 4
  return 2
}

function operationIdFromSubmission(value: Record<string, unknown>): string {
  return optionalString(value.operation_id) ??
    nestedString(value, ['operation', 'operation_id']) ??
    nestedString(value, ['operation', 'op_id']) ??
    (() => { throw new BioGymRuntimeError('biogym_protocol_error', 'BioGym did not return an operation ID.', 502) })()
}

function operationEvent(operation: Record<string, unknown>): Record<string, unknown> {
  if (optionalString(operation.status) !== 'done') {
    throw new BioGymRuntimeError('biogym_protocol_error', 'BioGym operation was not complete.', 502)
  }
  return asRecord(operation.result)
}

function jobIdFromCallEvent(event: Record<string, unknown>): string | undefined {
  return nestedString(event, ['data', 'job_id']) ?? nestedString(event, ['data', 'job', 'job_id'])
}

function publicCandidate(candidate: StoredCandidateRef): BioGymCandidateSummary {
  return {
    id: candidate.id,
    label: candidate.label,
    ...(candidate.assetId ? { assetId: candidate.assetId } : {}),
    ...(candidate.relativePath ? { relativePath: candidate.relativePath } : {}),
    ...(candidate.score !== undefined ? { score: candidate.score } : {}),
    ...(candidate.scoreLabel ? { scoreLabel: candidate.scoreLabel } : {}),
    ...(candidate.metrics ? { metrics: candidate.metrics } : {})
  }
}

function requireAttempt(run: StoredRun, id: string): StoredStageAttempt {
  const attempt = run.stages.find((entry) => entry.id === id)
  if (!attempt) throw new BioGymRuntimeError('biogym_stage_not_found', `Unknown stage attempt: ${id}`, 404)
  return attempt
}

function requestId(designRunId: string, suffix: string): string {
  return `${designRunId.replaceAll('-', '_')}_${suffix.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 128)
}

function assetId(stageAttemptId: string, index: number, suffix = 'candidate'): string {
  return `bg:${stageAttemptId}:${suffix}:${String(index).padStart(3, '0')}`
}

function finalReport(run: StoredRun, decision: Record<string, unknown>): string {
  const selected = run.finalized?.selectedCandidateIds.join(', ') || 'none'
  return [
    `# BioGym Protein Design Report`,
    '',
    `- Design run: ${run.designRunId}`,
    `- Workflow: ${run.workflow}`,
    `- Objective: ${run.objective}`,
    `- Disposition: ${run.finalized?.disposition}`,
    `- Selected computational candidates: ${selected}`,
    `- GPU jobs used: ${run.budget.usedGpuJobs}/${run.budget.maxGpuJobs}`,
    '',
    '## Decision summary',
    '',
    run.finalized?.summary ?? '',
    '',
    '## Caveats',
    '',
    ...(run.finalized?.caveats.map((caveat) => `- ${caveat}`) ?? []),
    '- All results are computational predictions.',
    '- No wet-lab validation was performed.',
    '- Predicted structure/confidence is not proof of binding affinity, stability, expression, solubility, safety, or efficacy.',
    '',
    '## Provenance',
    '',
    `The durable decision object is embedded below and linked to registered BioGym artifacts.`,
    '',
    '```json',
    JSON.stringify(decision, null, 2),
    '```',
    ''
  ].join('\n')
}

async function prepareInputRef(
  workspaceRoot: string,
  rawPath: string,
  id: string,
  remoteInputKey: string
): Promise<StoredInputRef> {
  const requested = isAbsolute(rawPath) ? rawPath : resolve(workspaceRoot, rawPath)
  const canonical = await realpath(requested).catch(() => null)
  if (!canonical) throw new BioGymRuntimeError('biogym_input_not_found', `Input file does not exist: ${rawPath}`, 400)
  assertPathInside(workspaceRoot, canonical, 'BioGym inputs must remain inside the trusted SciForge workspace.')
  const info = await stat(canonical)
  if (!info.isFile()) throw new BioGymRuntimeError('biogym_input_not_file', `BioGym input is not a regular file: ${rawPath}`, 400)
  const hashed = await hashAndSize(canonical)
  const suffix = safeBundledSuffix(canonical)
  return {
    id,
    localPath: canonical,
    relativePath: toWorkspaceRelative(workspaceRoot, canonical),
    remotePath: `input/${remoteInputKey}-${hashed.sha256.slice(0, 12)}${suffix}`,
    sha256: hashed.sha256
  }
}

function safeBundledSuffix(path: string): string {
  const suffixes = basename(path).match(/\.[A-Za-z0-9_-]+/g) ?? []
  const suffix = suffixes.slice(-2).join('').toLowerCase()
  return /^(?:\.[a-z0-9_-]+){1,2}$/.test(suffix) ? suffix : ''
}

async function canonicalWorkspace(rawPath: string): Promise<string> {
  const canonical = await realpath(rawPath).catch(() => null)
  if (!canonical) throw new BioGymRuntimeError('biogym_workspace_not_found', 'SciForge workspace does not exist.', 400)
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new BioGymRuntimeError('biogym_workspace_invalid', 'SciForge workspace is not a directory.', 400)
  return canonical
}

function runRoot(workspaceRoot: string, designRunId: string): string {
  if (!RUN_ID_PATTERN.test(designRunId)) throw new BioGymRuntimeError('biogym_invalid_run_id', 'Invalid BioGym run ID.', 400)
  return join(workspaceRoot, '.sciforge', 'biogym', 'runs', designRunId)
}

function runOwnerKey(workspaceRoot: string, threadId: string): string {
  return JSON.stringify([workspaceRoot, threadId.trim()])
}

function runFilePath(workspaceRoot: string, designRunId: string): string {
  return join(runRoot(workspaceRoot, designRunId), 'run.json')
}

async function createRunDirectories(root: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, 'requests'), { recursive: true }),
    mkdir(join(root, 'tasks'), { recursive: true }),
    mkdir(join(root, 'actions'), { recursive: true }),
    mkdir(join(root, 'artifacts'), { recursive: true }),
    mkdir(join(root, 'derived'), { recursive: true })
  ])
}

async function appendRunEvent(run: StoredRun, type: string, detail: unknown): Promise<void> {
  const event = {
    schemaVersion: 1,
    eventId: `event-${randomUUID()}`,
    type,
    designRunId: run.designRunId,
    revision: run.revision,
    status: run.status,
    detail,
    createdAt: run.updatedAt
  }
  await appendFile(
    join(runRoot(run.owner.workspaceRoot, run.designRunId), 'events.ndjson'),
    `${JSON.stringify(event)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function atomicWriteText(path: string, text: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

async function readJsonIfExists(path: string): Promise<unknown | null> {
  const text = await readFile(path, 'utf8').catch(() => null)
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function persistControllerRequestIds(
  workspaceRoot: string,
  command: readonly string[],
  createdAt: string
): Promise<void> {
  const requestIds: string[] = []
  for (let index = 0; index < command.length - 1; index += 1) {
    if (command[index] === '--request-id' || command[index] === '--session-request-id') {
      const value = command[index + 1]
      if (value) requestIds.push(value)
    }
  }
  if (!requestIds.length) return
  const directory = join(workspaceRoot, '.sciforge', 'biogym', 'requests')
  await mkdir(directory, { recursive: true })
  const filePaths: string[] = []
  if (command[0] === 'start' && command[1]) {
    filePaths.push(command[1])
    const task = await readJsonIfExists(command[1]) as { inputs?: Record<string, unknown> } | null
    for (const value of Object.values(task?.inputs ?? {})) {
      if (typeof value === 'string' && isAbsolute(value)) filePaths.push(value)
    }
  }
  for (let index = 0; index < command.length - 1; index += 1) {
    if (command[index] === '--file' && command[index + 1]) filePaths.push(command[index + 1])
  }
  const files = await Promise.all(uniqueBy(filePaths, (path) => path).map(async (path) => ({
    path,
    ...(await hashAndSize(path))
  })))
  const intentSha256 = createHash('sha256')
    .update(JSON.stringify({ command, files }))
    .digest('hex')
  for (const id of requestIds) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
      throw new BioGymRuntimeError('biogym_invalid_request_id', 'Controller generated an invalid request ID.', 500)
    }
    const path = join(directory, `${id}.json`)
    const existing = await readJsonIfExists(path) as { intentSha256?: string } | null
    if (existing) {
      if (existing.intentSha256 !== intentSha256) {
        throw new BioGymRuntimeError('biogym_request_id_collision', 'A BioGym request ID was reused for another intent.', 500)
      }
      continue
    }
    await atomicWriteJson(path, {
      schemaVersion: 1,
      requestId: id,
      command: command[0],
      intentSha256,
      createdAt
    })
  }
}

async function hashAndSize(path: string): Promise<{ sha256: string; size: number }> {
  const digest = createHash('sha256')
  let size = 0
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      digest.update(buffer)
    })
    stream.once('error', reject)
    stream.once('end', resolvePromise)
  })
  return { sha256: digest.digest('hex'), size }
}

function assertPathInside(root: string, candidate: string, message: string): void {
  const rel = relative(resolve(root), resolve(candidate))
  if (!rel || rel === '.') return
  if (rel.startsWith('..') || isAbsolute(rel)) throw new BioGymRuntimeError('biogym_path_escape', message, 400)
}

function toWorkspaceRelative(workspaceRoot: string, path: string): string {
  assertPathInside(workspaceRoot, path, 'BioGym artifact escaped the trusted SciForge workspace.')
  return relative(workspaceRoot, path).replaceAll('\\', '/')
}

async function readCsv(path: string): Promise<Array<Record<string, string>>> {
  const text = await readFile(path, 'utf8')
  const rows = parseCsv(text)
  const headers = rows.shift()?.map((header) => header.trim()) ?? []
  return rows.filter((row) => row.some((value) => value.trim())).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
  )
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }
  return rows
}

async function readFasta(path: string): Promise<Array<{ header: string; sequence: string }>> {
  const records: Array<{ header: string; sequence: string }> = []
  let header = ''
  let sequence = ''
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (header) records.push({ header, sequence })
      header = line.slice(1).trim()
      sequence = ''
    } else if (header) sequence += line.trim()
  }
  if (header) records.push({ header, sequence })
  return records
}

function matchArtifactPath(artifacts: ImportedArtifact[], rawPath: string | undefined): ImportedArtifact | undefined {
  if (!rawPath) return undefined
  const normalized = rawPath.replaceAll('\\', '/')
  return artifacts.find((artifact) => artifact.remotePath === normalized) ??
    artifacts.find((artifact) => basename(artifact.remotePath) === basename(normalized))
}

function normalizeProteinSequence(value: string | undefined): string {
  const sequence = (value ?? '').toUpperCase().replace(/[^A-Z*.-]/g, '')
  if (!sequence) throw new BioGymRuntimeError('biogym_invalid_sequence_output', 'ProteinMPNN produced an empty sequence.', 502)
  return sequence
}

function sanitizeFastaHeader(value: string): string {
  return value.replace(/[\r\n>]/g, '_').slice(0, 1_024) || 'candidate'
}

function compactMetrics(
  record: Record<string, string>,
  keys: string[]
): Record<string, number | string | null> | undefined {
  const entries: Array<[string, number | string | null]> = []
  for (const key of keys.slice(0, 16)) {
    const raw = record[key]
    if (raw === undefined || raw === '') continue
    const numeric = optionalFiniteNumber(raw)
    entries.push([key, numeric ?? raw.slice(0, 256)])
  }
  return entries.length ? Object.fromEntries(entries) : undefined
}

function rowValue(record: Record<string, string> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase())
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

function compareOptionalNumbers(left: unknown, right: unknown): number {
  const a = optionalFiniteNumber(left)
  const b = optionalFiniteNumber(right)
  if (a === undefined && b === undefined) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  return a - b
}

function uniqueBy<T>(values: T[], key: (value: T) => string | undefined): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const candidate = key(value)
    if (!candidate || seen.has(candidate)) return false
    seen.add(candidate)
    return true
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BioGymRuntimeError('biogym_protocol_error', 'BioGym returned an unexpected response shape.', 502)
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new BioGymRuntimeError('biogym_protocol_error', 'BioGym returned an unexpected response list.', 502)
  }
  return value
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = optionalString(value[key])
  if (!result) throw new BioGymRuntimeError('biogym_protocol_error', `BioGym response is missing ${key}.`, 502)
  return result
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  const numeric = optionalFiniteNumber(value[key])
  if (numeric === undefined || numeric < 0) {
    throw new BioGymRuntimeError('biogym_protocol_error', `BioGym response has invalid ${key}.`, 502)
  }
  return numeric
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return optionalString(current)
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_BODY_BYTES) {
    throw new BioGymRuntimeError('request_too_large', 'BioGym internal request exceeds 1 MiB.', 413)
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_HTTP_BODY_BYTES) throw new BioGymRuntimeError('request_too_large', 'BioGym internal request exceeds 1 MiB.', 413)
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new BioGymRuntimeError('invalid_json', 'BioGym internal request is not valid JSON.', 400)
  }
}

function normalizeRuntimeError(error: unknown): BioGymRuntimeError {
  if (error instanceof BioGymRuntimeError) return error
  if (error instanceof BioGymCliError) {
    return new BioGymRuntimeError(error.code, safeErrorMessage(error), 502)
  }
  return new BioGymRuntimeError('biogym_internal_error', safeErrorMessage(error), 500)
}

function isRecoverableCliMutationError(error: unknown): boolean {
  return isRecoverableCliTransportError(error)
}

function isRecoverableCliReadError(error: unknown): boolean {
  return isRecoverableCliTransportError(error)
}

function isRecoverableCliTransportError(error: unknown): boolean {
  if (!(error instanceof BioGymCliError)) return false
  if ([
    'biogym_cli_timeout',
    'biogym_cli_protocol_error',
    'biogym_cli_output_limit'
  ].includes(error.code)) return true
  if (error.code !== 'biogym_cli_failed') return false
  return error.failure?.code === 'remote_transport_error' ||
    error.failure?.code === 'remote_protocol_error' ||
    error.failure?.code === 'request_in_progress' ||
    error.failure?.outcomeUnknown === true
}

function throwIfCliOperationIndeterminate(error: unknown): void {
  if (!(error instanceof BioGymCliError) || error.failure?.code !== 'indeterminate') return
  throw new BioGymRuntimeError(
    'biogym_operation_indeterminate',
    'BioGym reported an indeterminate remote operation. The isolated session was preserved for diagnosis.',
    502,
    {
      requestId: error.failure.requestId,
      remoteCode: error.failure.code
    }
  )
}

function isRecoverableControllerError(error: unknown): boolean {
  return error instanceof BioGymRuntimeError && [
    'biogym_mutation_outcome_unknown',
    'biogym_read_outcome_unknown'
  ].includes(error.code)
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|token|secret)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 4_000)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
