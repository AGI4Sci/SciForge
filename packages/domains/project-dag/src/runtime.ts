import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagCommittedSnapshotSchema,
  evidenceDagViewInputSchema,
  evidenceDagViewOutputSchema,
  type EvidenceDagCommittedSnapshot,
  type EvidenceDagSnapshotIdentity
} from '@sciforge/domain-evidence-dag/contract'
import type {
  DomainAgentArtifactEvent,
  DomainAgentThread,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import {
  projectDagCapturedScopeSchema,
  projectDagCommittedSnapshotSchema,
  projectDagDurableReceiptSchema,
  projectDagErrorSchema,
  projectDagGoalSchema,
  projectDagResolveEvidencePreviewOutputSchema,
  projectDagStatusSchema,
  projectDagUiUrl,
  projectDagUpdateOutputSchema,
  projectDagViewOutputSchema,
  type ProjectDagCapturedScope,
  type ProjectDagDurableReceipt,
  type ProjectDagError,
  type ProjectDagErrorCode,
  type ProjectDagResolveEvidencePreviewInput,
  type ProjectDagResolveEvidencePreviewOutput,
  type ProjectDagSaveGoalInput,
  type ProjectDagSaveGoalOutput,
  type ProjectDagStatus,
  type ProjectDagTarget,
  type ProjectDagUpdateInput,
  type ProjectDagUpdateOutput,
  type ProjectDagViewInput,
  type ProjectDagViewOutput
} from './contract.js'
import {
  ProjectDagHandoffOutbox,
  evidenceWatermarkCovers,
  type ProjectDagHandoffRecord
} from './handoff-outbox.js'
import {
  ProjectDagPreviewError,
  resolveProjectDagEvidencePreview
} from './preview.js'
import {
  ProjectDagSidecar,
  type ProjectDagSidecarConfig
} from './sidecar.js'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

type ServiceResult =
  | { ok: true; data: unknown }
  | { ok: false; error?: unknown }

export type ProjectDagEvidenceSnapshotReader = (
  engineThreadId: string,
  context: DomainMainRuntimeLifecycleContext
) => Promise<EvidenceDagCommittedSnapshot>

export type ProjectDagRuntimeOptions = Readonly<{
  sidecar?: ProjectDagSidecar
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
  readEvidenceSnapshot?: ProjectDagEvidenceSnapshotReader
  userDataDir?: string
  handoffOutbox?: ProjectDagHandoffOutbox
  autoProcessHandoffs?: boolean
}>

export class ProjectDagRuntimeError extends Error {
  readonly error: ProjectDagError

  constructor(error: ProjectDagError) {
    super(error.message)
    this.name = 'ProjectDagRuntimeError'
    this.error = error
  }
}

export class ProjectDagRuntime {
  readonly #sidecar: ProjectDagSidecar
  readonly #fetchImpl: typeof fetch
  readonly #requestTimeoutMs: number
  readonly #readEvidenceSnapshotImpl: ProjectDagEvidenceSnapshotReader
  readonly #outbox: ProjectDagHandoffOutbox | null
  readonly #autoProcessHandoffs: boolean
  #context: DomainMainRuntimeLifecycleContext | null = null
  #enabled = false
  #disposed = false
  #transition: Promise<void> = Promise.resolve()
  #handoffTimer: ReturnType<typeof setTimeout> | null = null
  #drainingHandoffs: Promise<void> | null = null

  constructor(options: ProjectDagRuntimeOptions = {}) {
    this.#sidecar = options.sidecar ?? new ProjectDagSidecar({
      fetchImpl: options.fetchImpl
    })
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.#readEvidenceSnapshotImpl = options.readEvidenceSnapshot ??
      ((threadId, context) => this.#readEvidenceSnapshot(threadId, context))
    this.#outbox = options.handoffOutbox ??
      (options.userDataDir ? new ProjectDagHandoffOutbox(options.userDataDir) : null)
    this.#autoProcessHandoffs = options.autoProcessHandoffs !== false
  }

  async activate(
    context: DomainMainRuntimeLifecycleContext
  ): Promise<DomainMainRuntimeDisposer> {
    if (this.#context && this.#context !== context) {
      throw projectError(
        'internal_error',
        'Project DAG runtime is already active for another lifecycle context.',
        false
      )
    }
    this.#context = context
    this.#disposed = false
    await this.#outbox?.load()
    const applyEnablement = (enabled: boolean) => {
      this.#transition = this.#transition
        .catch(() => undefined)
        .then(() => this.#setEnabled(enabled))
      void this.#transition.catch((error) => {
        context.log({
          level: 'error',
          message: 'Project DAG lifecycle transition failed.',
          detail: error
        })
      })
    }
    const unsubscribe = context.enablement.subscribe(applyEnablement)
    applyEnablement(await context.enablement.isEnabled())
    await this.#transition
    const onAbort = () => {
      void this.dispose()
    }
    context.signal.addEventListener('abort', onAbort, { once: true })
    return async () => {
      context.signal.removeEventListener('abort', onAbort)
      await unsubscribe()
      await this.dispose()
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#enabled = false
    if (this.#handoffTimer) {
      clearTimeout(this.#handoffTimer)
      this.#handoffTimer = null
    }
    await this.#transition.catch(() => undefined)
    await this.#sidecar.stop()
    this.#context = null
  }

  async consumeTurnCompleted(event: DomainAgentArtifactEvent): Promise<void> {
    if (!event.workspaceRoot?.trim() || !this.#outbox) return
    await this.#outbox.enqueue({
      workspaceRoot: event.workspaceRoot,
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      targetWatermark: event.targetWatermark
    })
    if (this.#autoProcessHandoffs) this.#scheduleHandoffDrain(0)
  }

  async drainHandoffs(): Promise<void> {
    if (this.#drainingHandoffs) return this.#drainingHandoffs
    const pending = this.#drainHandoffsOnce()
    this.#drainingHandoffs = pending
    try {
      await pending
    } finally {
      if (this.#drainingHandoffs === pending) this.#drainingHandoffs = null
      if (this.#autoProcessHandoffs) this.#scheduleNextHandoffDrain()
    }
  }

  async view(input: ProjectDagViewInput): Promise<ProjectDagViewOutput> {
    const { context, config } = await this.#ready()
    const [statusValue, goalsValue] = await Promise.all([
      this.#requestProject(config, `/updates/status${projectQuery(input)}`, 'GET'),
      this.#requestProject(config, `/goals${projectQuery(input)}`, 'GET')
    ])
    const status = normalizeProjectDagStatus(statusValue)
    const goal = firstGoal(goalsValue)
    return projectDagViewOutputSchema.parse({
      url: projectDagUiUrl({
        serviceUrl: config.baseUrl,
        apiKey: config.runtimeToken,
        view: input.view === 'attention' ? 'home' : input.view ?? 'graph',
        embed: true,
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot,
        project: input.project,
        sessionIds: status.scope.includedSessions
      }),
      status,
      ...(goal ? { goal } : {})
    })
  }

  async update(input: ProjectDagUpdateInput): Promise<ProjectDagUpdateOutput> {
    const { context, config } = await this.#ready()
    const currentValue = await this.#requestProject(
      config,
      `/updates/status${projectQuery(input)}`,
      'GET'
    )
    const current = normalizeProjectDagStatus(currentValue)
    const candidateSessions = await projectSessionsForUpdate(input, current, context)
    const excludedSessions = uniqueSorted(input.excludedSessions ?? [])
    const isolatedSessions = uniqueSorted(input.isolatedSessions ?? [])
    const overlap = excludedSessions.filter((sessionId) =>
      isolatedSessions.includes(sessionId)
    )
    if (overlap.length > 0) {
      throw projectError(
        'invalid_request',
        `Project sessions cannot be both excluded and isolated: ${overlap.join(', ')}`,
        false
      )
    }
    const candidateSet = new Set(candidateSessions)
    const outsideScope = [...excludedSessions, ...isolatedSessions]
      .filter((sessionId) => !candidateSet.has(sessionId))
    if (outsideScope.length > 0) {
      throw projectError(
        'invalid_request',
        `Project session dispositions are outside the captured scope: ${outsideScope.join(', ')}`,
        false
      )
    }
    const unavailable = new Set([...excludedSessions, ...isolatedSessions])
    const includedSessions = candidateSessions
      .filter((sessionId) => !unavailable.has(sessionId))
    if (includedSessions.length === 0) {
      throw projectError(
        'invalid_request',
        'Project DAG update captured no included sessions.',
        false
      )
    }
    const evidenceSnapshots = await Promise.all(includedSessions.map((sessionId) =>
      this.#readEvidenceSnapshotImpl(sessionId, context).catch((error) => {
        if (error instanceof ProjectDagRuntimeError) throw error
        throw projectError(
          'evidence_snapshot_unavailable',
          `No committed Evidence Snapshot is available for ${sessionId}.`,
          false,
          { sessionId, cause: error instanceof Error ? error.message : String(error) }
        )
      })
    ))
    const evidenceVector: EvidenceDagSnapshotIdentity[] = evidenceSnapshots.map(
      ({ threadId, digest }) => ({ threadId, digest })
    )
    const capturedScope = projectDagCapturedScopeSchema.parse({
      includedSessions,
      excludedSessions,
      isolatedSessions
    })
    const receiptValue = await this.#requestProject(config, '/updates', 'POST', {
      ...projectRoutingBody(input),
      reason: 'manual_immediate',
      priority: 3,
      ...(input.autonomyMode ? { autonomyMode: input.autonomyMode } : {}),
      evidenceVector,
      capturedScope
    })
    const receipt = normalizeReceipt(receiptValue)
    const status = normalizeProjectDagStatus(await this.#requestProject(
      config,
      `/updates/status${projectQuery(input)}`,
      'GET'
    ))
    return projectDagUpdateOutputSchema.parse({
      url: projectDagUiUrl({
        serviceUrl: config.baseUrl,
        apiKey: config.runtimeToken,
        view: 'graph',
        embed: true,
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot,
        project: input.project,
        sessionIds: includedSessions
      }),
      receipt,
      status
    })
  }

  async saveGoal(input: ProjectDagSaveGoalInput): Promise<ProjectDagSaveGoalOutput> {
    const { config } = await this.#ready()
    const route = input.rootGoalId
      ? `/goals/${encodeURIComponent(input.rootGoalId)}/update`
      : '/goals'
    const goalValue = await this.#requestProject(config, route, 'POST', {
      ...projectRoutingBody(input),
      title: input.title,
      description: input.description ?? '',
      actorType: 'human',
      actorId: 'sciforge-project-dag-domain:user',
      ...(input.rootGoalId ? { reframe: false } : {})
    })
    const goal = goalFromValue(goalValue)
    if (!goal) {
      throw projectError(
        'internal_error',
        'Project DAG goal command did not return a valid goal.',
        false
      )
    }
    const status = normalizeProjectDagStatus(await this.#requestProject(
      config,
      `/updates/status${projectQuery(input)}`,
      'GET'
    ))
    return {
      goal,
      status
    }
  }

  async resolveEvidencePreview(
    input: ProjectDagResolveEvidencePreviewInput
  ): Promise<ProjectDagResolveEvidencePreviewOutput> {
    const { config } = await this.#ready()
    const query = new URLSearchParams(projectQueryValues(input))
    query.set('snapshot', input.snapshotDigest)
    const claim = await this.#requestProject(
      config,
      `/claims/${encodeURIComponent(input.claimId)}?${query.toString()}`,
      'GET'
    )
    try {
      return projectDagResolveEvidencePreviewOutputSchema.parse(
        await resolveProjectDagEvidencePreview(input, claim)
      )
    } catch (error) {
      if (error instanceof ProjectDagPreviewError) {
        throw projectError(error.code, error.message, false)
      }
      throw error
    }
  }

  async #setEnabled(enabled: boolean): Promise<void> {
    this.#enabled = enabled && !this.#disposed
    if (!this.#enabled) {
      await this.#sidecar.stop()
      return
    }
    const context = this.#context
    if (!context) return
    try {
      await this.#sidecar.ensure(context)
      if (this.#autoProcessHandoffs) this.#scheduleHandoffDrain(0)
    } catch (error) {
      context.log({
        level: 'error',
        message: 'Project DAG sidecar is not ready.',
        detail: error
      })
    }
  }

  async #ready(): Promise<{
    context: DomainMainRuntimeLifecycleContext
    config: ProjectDagSidecarConfig
  }> {
    const context = this.#context
    if (!context || this.#disposed) {
      throw projectError(
        'upstream_unavailable',
        'Project DAG runtime lifecycle is not active.',
        true
      )
    }
    this.#enabled = await context.enablement.isEnabled()
    if (!this.#enabled) {
      throw projectError(
        'upstream_unavailable',
        'Project DAG is disabled.',
        false
      )
    }
    await this.#transition.catch(() => undefined)
    try {
      return { context, config: await this.#sidecar.ensure(context) }
    } catch (error) {
      throw normalizeRuntimeError(error, 'upstream_unavailable', true)
    }
  }

  async #requestProject(
    config: ProjectDagSidecarConfig,
    route: string,
    method: 'GET' | 'POST',
    body?: unknown
  ): Promise<unknown> {
    return requestServiceJson({
      baseUrl: config.baseUrl,
      apiKey: config.runtimeToken,
      route,
      method,
      body,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#requestTimeoutMs,
      serviceName: 'Project DAG'
    })
  }

  async #readEvidenceSnapshot(
    engineThreadId: string,
    context: DomainMainRuntimeLifecycleContext
  ): Promise<EvidenceDagCommittedSnapshot> {
    const separator = engineThreadId.indexOf(':')
    if (separator <= 0 || separator === engineThreadId.length - 1) {
      throw projectError(
        'evidence_snapshot_unavailable',
        `Project session ${engineThreadId} is not a canonical runtime/thread identity.`,
        false
      )
    }
    const runtimeId = engineThreadId.slice(0, separator)
    const threadId = engineThreadId.slice(separator + 1)
    const thread = await context.agentThreads.read({ runtimeId, threadId })
    const view = await context.capabilities.invoke(
      {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.view,
        effect: 'read',
        inputSchema: evidenceDagViewInputSchema,
        outputSchema: evidenceDagViewOutputSchema
      },
      { runtimeId, threadId },
      {
        ...(thread.workspaceRoot ? { workspaceId: thread.workspaceRoot } : {})
      }
    )
    const parsed = evidenceDagCommittedSnapshotSchema.safeParse(view.status.committed)
    if (!parsed.success) {
      throw projectError(
        'evidence_snapshot_unavailable',
        `No committed Evidence Snapshot is available for ${engineThreadId}.`,
        false
      )
    }
    if (parsed.data.threadId !== engineThreadId) {
      throw projectError(
        'evidence_snapshot_unavailable',
        `Evidence Snapshot identity does not match ${engineThreadId}.`,
        false
      )
    }
    return parsed.data
  }

  async #drainHandoffsOnce(): Promise<void> {
    const outbox = this.#outbox
    const context = this.#context
    if (!outbox || !context || this.#disposed || !this.#enabled) return
    for (const record of outbox.ready()) {
      try {
        await this.#acceptHandoff(record, context)
      } catch (error) {
        const normalized = normalizeRuntimeError(
          error,
          'upstream_unavailable',
          true
        )
        if (normalized.error.retryable) {
          await outbox.markRetry(
            record.id,
            normalized.error.message,
            retryDelayMs(record.attempts)
          )
        } else {
          await outbox.markFailed(record.id, normalized.error.message)
        }
      }
    }
  }

  async #acceptHandoff(
    record: ProjectDagHandoffRecord,
    context: DomainMainRuntimeLifecycleContext
  ): Promise<void> {
    const triggerId = `${record.runtimeId}:${record.threadId}`
    const trigger = await this.#readEvidenceSnapshotImpl(triggerId, context)
    if (!evidenceWatermarkCovers(trigger.inputWatermark, record.targetWatermark)) {
      throw projectError(
        'evidence_snapshot_unavailable',
        `Evidence Snapshot for ${triggerId} has not committed watermark ` +
        `${record.targetWatermark}.`,
        true
      )
    }
    const threads = await context.agentThreads.list({
      limit: 500,
      includeArchived: false,
      includeSide: false
    })
    const workspaceThreads = threads.filter((thread) =>
      thread.workspaceRoot === record.workspaceRoot
    )
    const snapshots = await Promise.all(workspaceThreads.map(async (thread) => {
      const threadId = engineThreadId(thread)
      try {
        return await this.#readEvidenceSnapshotImpl(threadId, context)
      } catch (error) {
        if (
          error instanceof ProjectDagRuntimeError &&
          error.error.code === 'evidence_snapshot_unavailable'
        ) {
          return null
        }
        throw error
      }
    }))
    const byThread = new Map(
      snapshots
        .filter((snapshot): snapshot is EvidenceDagCommittedSnapshot => snapshot !== null)
        .map((snapshot) => [snapshot.threadId, snapshot] as const)
    )
    byThread.set(trigger.threadId, trigger)
    const evidenceVector = [...byThread.values()]
      .map(({ threadId, digest }) => ({ threadId, digest }))
      .sort((left, right) => left.threadId.localeCompare(right.threadId))
    const includedSessions = evidenceVector.map(({ threadId }) => threadId)
    const { config } = await this.#ready()
    const receipt = normalizeReceipt(await this.#requestProject(
      config,
      '/updates',
      'POST',
      {
        workspaceRoot: record.workspaceRoot,
        reason: 'evidence_snapshot_committed',
        priority: 1,
        evidenceVector,
        capturedScope: {
          includedSessions,
          excludedSessions: [],
          isolatedSessions: []
        }
      }
    ))
    await this.#outbox!.markAccepted(record.id, receipt)
  }

  #scheduleHandoffDrain(delayMs: number): void {
    if (
      this.#handoffTimer ||
      this.#disposed ||
      !this.#enabled ||
      !this.#outbox
    ) {
      return
    }
    this.#handoffTimer = setTimeout(() => {
      this.#handoffTimer = null
      void this.drainHandoffs()
    }, Math.max(0, delayMs))
    this.#handoffTimer.unref?.()
  }

  #scheduleNextHandoffDrain(): void {
    const outbox = this.#outbox
    if (!outbox || this.#handoffTimer || this.#disposed || !this.#enabled) return
    const active = outbox.active()
    if (active.length === 0) return
    const next = Math.min(...active.map((record) =>
      record.state === 'pending'
        ? Date.now()
        : Date.parse(record.nextAttemptAt ?? '') || Date.now()
    ))
    this.#scheduleHandoffDrain(Math.max(0, next - Date.now()))
  }
}

export function normalizeProjectDagStatus(value: unknown): ProjectDagStatus {
  const source = requiredRecord(value, 'Project DAG status must be an object.')
  const committedValue = record(source.committedSnapshot)
  const committed = committedValue
    ? projectDagCommittedSnapshotSchema.parse({
        version: committedValue.version,
        digest: committedValue.digest,
        evidenceVector: committedValue.evidenceVector,
        createdAt: committedValue.createdAt ?? committedValue.created_at
      })
    : null
  const latestReceipt = source.latestReceipt
    ? normalizeReceipt(source.latestReceipt)
    : null
  const activeReceipt = source.activeReceipt
    ? normalizeReceipt(source.activeReceipt)
    : null
  const serviceState = text(source.state)
  const pendingState = serviceState === 'updating'
    ? 'running'
    : serviceState === 'retry_scheduled'
      ? 'retry_scheduled'
      : serviceState === 'update_failed'
        ? 'failed'
        : serviceState === 'pending'
          ? 'queued'
          : null
  const pending = pendingState && activeReceipt
    ? {
        state: pendingState,
        receipt: activeReceipt,
        attempts: nonnegativeInteger(record(source.activeReceipt)?.attempts) ?? 0,
        updatedAt: activeReceipt.updatedAt,
        ...(text(record(source.activeReceipt)?.nextAttemptAt)
          ? { nextAttemptAt: text(record(source.activeReceipt)?.nextAttemptAt) }
          : {}),
        ...(pendingState === 'failed'
          ? {
              error: projectDagErrorSchema.parse({
                code: 'project_compile_failed',
                message: text(record(source.activeReceipt)?.lastError) ??
                  'Project DAG compilation failed.',
                retryable: false
              })
            }
          : {})
      }
    : null
  const scope = activeReceipt?.capturedScope ??
    latestReceipt?.capturedScope ??
    projectDagCapturedScopeSchema.parse({
      includedSessions: committed?.evidenceVector.map(({ threadId }) => threadId) ?? [],
      excludedSessions: stringArray(committedValue?.excludedSessions),
      isolatedSessions: stringArray(committedValue?.isolatedSessions)
    })
  const autonomy = record(source.autonomy)
  return projectDagStatusSchema.parse({
    projectKey: source.projectKey,
    committed,
    pending,
    latestReceipt,
    scope,
    autonomyMode: text(autonomy?.autonomy_mode) ??
      text(autonomy?.autonomyMode) ??
      'checkpointed',
    attentionCount: nonnegativeInteger(source.attentionCount) ?? 0,
    ...(text(source.auditTargetDigest)
      ? { auditTargetDigest: text(source.auditTargetDigest) }
      : {}),
    ...(typeof source.auditStale === 'boolean'
      ? { auditStale: source.auditStale }
      : {})
  })
}

export function normalizeReceipt(value: unknown): ProjectDagDurableReceipt {
  const source = requiredRecord(value, 'Project DAG receipt must be an object.')
  return projectDagDurableReceiptSchema.parse({
    projectKey: source.projectKey,
    jobId: source.jobId ?? source.id,
    acceptedRequestVersion: source.acceptedRequestVersion,
    desiredFingerprint: source.desiredFingerprint,
    desiredEvidenceVector: source.desiredEvidenceVector,
    capturedScope: source.capturedScope,
    state: source.state,
    acceptedAt: source.acceptedAt,
    updatedAt: source.updatedAt
  })
}

async function projectSessionsForUpdate(
  input: ProjectDagUpdateInput,
  current: ProjectDagStatus,
  context: DomainMainRuntimeLifecycleContext
): Promise<string[]> {
  if (Array.isArray(input.scope)) return uniqueSorted(input.scope)
  if (input.sessions?.length) return uniqueSorted(input.sessions)
  const workspaceRoot = input.workspaceRoot ?? input.projectRoot
  const threads = await context.agentThreads.list({
    limit: 500,
    includeArchived: false,
    includeSide: false
  })
  const matching = threads.filter((thread) =>
    !workspaceRoot || thread.workspaceRoot === workspaceRoot
  )
  const discovered = uniqueSorted(matching.map(engineThreadId))
  if (discovered.length > 0) return discovered
  return current.scope.includedSessions
}

function engineThreadId(thread: DomainAgentThread): string {
  return `${thread.runtimeId.trim()}:${thread.id.trim()}`
}

async function requestServiceJson(input: {
  baseUrl: string
  apiKey: string
  route: string
  method: 'GET' | 'POST'
  body?: unknown
  fetchImpl: typeof fetch
  timeoutMs: number
  serviceName: string
}): Promise<unknown> {
  let response: Response
  try {
    response = await input.fetchImpl(`${input.baseUrl}${input.route}`, {
      method: input.method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(input.timeoutMs)
    })
  } catch (error) {
    throw normalizeRuntimeError(
      error,
      error instanceof Error && error.name === 'TimeoutError'
        ? 'upstream_timeout'
        : 'upstream_unavailable',
      true
    )
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw projectError(
      'upstream_unavailable',
      `${input.serviceName} returned a non-JSON response.`,
      response.status >= 500,
      { httpStatus: response.status }
    )
  }
  const result = record(value) as ServiceResult | null
  if (!response.ok || !result || result.ok !== true) {
    const upstreamError = record(result && 'error' in result ? result.error : undefined)
    throw projectError(
      mapServiceErrorCode(text(upstreamError?.code), response.status),
      text(upstreamError?.message) ??
        `${input.serviceName} request failed with HTTP ${response.status}.`,
      response.status >= 500 && upstreamError?.retryable !== false,
      { httpStatus: response.status }
    )
  }
  return result.data
}

function mapServiceErrorCode(code: string | undefined, status: number): ProjectDagErrorCode {
  const normalized = code?.toUpperCase()
  if (normalized === 'NOT_FOUND') return 'project_not_found'
  if (normalized === 'BAD_REQUEST' || normalized === 'INVALID_ARGUMENT') {
    return 'invalid_request'
  }
  if (normalized === 'UNAUTHORIZED' || normalized === 'RUNTIME_PERMISSION_REQUIRED') {
    return 'access_restricted'
  }
  if (normalized === 'UNAVAILABLE') return 'upstream_unavailable'
  if (status === 404) return 'project_not_found'
  if (status === 400) return 'invalid_request'
  if (status === 401 || status === 403) return 'access_restricted'
  return status >= 500 ? 'upstream_unavailable' : 'internal_error'
}

function normalizeRuntimeError(
  error: unknown,
  code: ProjectDagErrorCode,
  retryable: boolean
): ProjectDagRuntimeError {
  if (error instanceof ProjectDagRuntimeError) return error
  return projectError(
    code,
    error instanceof Error ? error.message : String(error),
    retryable
  )
}

function projectError(
  code: ProjectDagErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, string | number | boolean | null>
): ProjectDagRuntimeError {
  return new ProjectDagRuntimeError(projectDagErrorSchema.parse({
    code,
    message,
    retryable,
    ...(details ? { details } : {})
  }))
}

function projectQuery(target: ProjectDagTarget): string {
  const query = new URLSearchParams(projectQueryValues(target))
  return query.size > 0 ? `?${query.toString()}` : ''
}

function projectQueryValues(target: ProjectDagTarget): Record<string, string> {
  return {
    ...(target.workspaceRoot ? { workspaceRoot: target.workspaceRoot } : {}),
    ...(target.projectRoot ? { projectRoot: target.projectRoot } : {}),
    ...(target.project ? { project: target.project } : {})
  }
}

function projectRoutingBody(target: ProjectDagTarget): Record<string, string> {
  return projectQueryValues(target)
}

function firstGoal(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return goalFromValue(value[0])
}

function goalFromValue(value: unknown) {
  const source = record(value)
  if (!source) return undefined
  const parsed = projectDagGoalSchema.safeParse({
    id: source.root_id ?? source.rootId ?? source.id,
    title: source.title,
    ...(text(source.description) ? { description: text(source.description) } : {}),
    version: source.version
  })
  return parsed.success ? parsed.data : undefined
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  const parsed = record(value)
  if (!parsed) throw projectError('internal_error', message, false)
  return parsed
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort()
}

function retryDelayMs(attempts: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.min(6, attempts)))
}
