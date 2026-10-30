import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagCommittedSnapshotSchema,
  evidenceDagSnapshotStatusInputSchema,
  evidenceDagSnapshotStatusOutputSchema,
  type EvidenceDagCommittedSnapshot,
  type EvidenceDagSnapshotIdentity
} from '@sciforge/domain-evidence-dag/contract'
import type {
  DomainArtifactEvent,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import { domainArtifactEventScope } from '@sciforge/domain-sdk/host'
import { resolve } from 'node:path'
import {
  projectDagCapturedScopeSchema,
  projectDagCommittedSnapshotSchema,
  projectDagDurableReceiptSchema,
  projectDagErrorSchema,
  projectDagGoalSchema,
  projectDagInvalidationSchema,
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
  context: DomainMainRuntimeLifecycleContext,
  scope?: Readonly<{
    runtimeId: string
    threadId: string
    workspaceRoot: string
  }>
) => Promise<EvidenceDagCommittedSnapshot>

export type ProjectDagRuntimeOptions = Readonly<{
  sidecar?: ProjectDagSidecar
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
  readEvidenceSnapshot?: ProjectDagEvidenceSnapshotReader
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
  #context: DomainMainRuntimeLifecycleContext | null = null
  #enabled = false
  #disposed = false
  #transition: Promise<void> = Promise.resolve()
  #disposePromise: Promise<void> | null = null
  readonly #staleNotifications = new Map<string, Promise<void>>()

  constructor(options: ProjectDagRuntimeOptions = {}) {
    this.#sidecar = options.sidecar ?? new ProjectDagSidecar({
      fetchImpl: options.fetchImpl
    })
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.#readEvidenceSnapshotImpl = options.readEvidenceSnapshot ??
      ((threadId, context, scope) => this.#readEvidenceSnapshot(threadId, context, scope))
  }

  async activate(
    context: DomainMainRuntimeLifecycleContext
  ): Promise<DomainMainRuntimeDisposer> {
    if (this.#disposePromise) await this.#disposePromise
    this.#disposePromise = null
    if (this.#context && this.#context !== context) {
      throw projectError(
        'internal_error',
        'Project DAG runtime is already active for another lifecycle context.',
        false
      )
    }
    this.#context = context
    this.#disposed = false
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
    if (this.#disposePromise) return this.#disposePromise
    const pending = this.#disposeOnce()
    this.#disposePromise = pending
    return pending
  }

  async #disposeOnce(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#enabled = false
    await this.#transition.catch(() => undefined)
    await this.#sidecar.stop()
    this.#context = null
  }

  async consumeArtifact(event: DomainArtifactEvent): Promise<void> {
    const context = this.#context
    if (!context || this.#disposed || !this.#enabled) return
    const scope = domainArtifactEventScope(event)
    if (event.kind === 'execution-completed' && !scope.workspaceRoot?.trim()) {
      if (event.hostBinding?.workspaceBinding === 'unbound') {
        return
      }
      throw projectError('access_restricted',
        'Package execution event has no authoritative Host workspace binding.', false)
    }
    const workspaceRoot = scope.workspaceRoot?.trim()
    if (!workspaceRoot) return
    if (event.kind === 'execution-completed') {
      assertExecutionWorkspaceBinding(event, workspaceRoot)
    }
    // Upstream events only invalidate the Project read model. Compilation is
    // initiated by an explicit Project command and retried by its service.
    void this.#markStale(workspaceRoot, context)
  }

  async view(input: ProjectDagViewInput): Promise<ProjectDagViewOutput> {
    const { config } = await this.#ready()
    let statusValue = await this.#requestProject(
      config, `/updates/status${projectQuery(input)}`, 'GET')
    let status = normalizeProjectDagStatus(statusValue)
    if (status.invalidation?.stale || (!status.committed && status.latestReceipt)) {
      await this.#requestProject(config, '/updates/open', 'POST', projectRoutingBody(input))
      statusValue = await this.#requestProject(
        config, `/updates/status${projectQuery(input)}`, 'GET')
      status = normalizeProjectDagStatus(statusValue)
    }
    const goalsValue = await this.#requestProject(
      config, `/goals${projectQuery(input)}`, 'GET')
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
    const candidateSessionRecords = await projectSessionsForUpdate(input, context)
    const candidateSessions = candidateSessionRecords.map(({ engineId }) => engineId)
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
    const sessionRecordsById = new Map(
      candidateSessionRecords.map((record) => [record.engineId, record])
    )
    const evidenceSnapshots = await Promise.all(includedSessions.map((sessionId) => {
      const session = sessionRecordsById.get(sessionId)
      if (!session) {
        throw projectError(
          'access_restricted',
          `Project session ${sessionId} is not an authoritative captured Session.`,
          false
        )
      }
      return this.#readEvidenceSnapshotImpl(sessionId, context, {
        runtimeId: session.runtimeId,
        threadId: session.threadId,
        workspaceRoot: session.workspaceRoot
      }).catch((error) => {
        if (error instanceof ProjectDagRuntimeError) throw error
        throw projectError(
          'evidence_snapshot_unavailable',
          `No committed Evidence Snapshot is available for ${sessionId}.`,
          false,
          { sessionId, cause: error instanceof Error ? error.message : String(error) }
        )
      })
    }))
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
    await this.#requestProject(config, '/goals/draft', 'POST', {
      ...projectRoutingBody(input),
      title: input.title,
      description: input.description ?? '',
      ...(input.rootGoalId ? { rootGoalId: input.rootGoalId } : {})
    })
    const goalValue = await this.#requestProject(config, '/goals/apply', 'POST', {
      ...projectRoutingBody(input),
      actorType: 'human',
      actorId: 'sciforge-project-dag-domain:user',
      reframe: false
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
    } catch (error) {
      context.log({
        level: 'error',
        message: 'Project DAG sidecar is not ready.',
        detail: error
      })
    }
  }

  #markStale(
    workspaceRoot: string,
    context: DomainMainRuntimeLifecycleContext
  ): void {
    const existing = this.#staleNotifications.get(workspaceRoot)
    if (existing) return
    let pending!: Promise<void>
    pending = (async () => {
      try {
        const { config } = await this.#ready()
        await this.#requestProject(config, '/invalidation', 'POST', {
          workspaceRoot,
          reason: 'upstream_changed',
          changedFields: ['evidenceVector']
        })
      } catch (error) {
        // Freshness observation is best-effort and must not block artifact
        // delivery from the Host.
        context.log({
          level: 'warn',
          message: 'Project DAG could not record upstream invalidation.',
          detail: error
        })
      } finally {
        if (this.#staleNotifications.get(workspaceRoot) === pending) {
          this.#staleNotifications.delete(workspaceRoot)
        }
      }
    })()
    this.#staleNotifications.set(workspaceRoot, pending)
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
    context: DomainMainRuntimeLifecycleContext,
    scope?: Readonly<{
      runtimeId: string
      threadId: string
      workspaceRoot: string
    }>
  ): Promise<EvidenceDagCommittedSnapshot> {
    let runtimeId = scope?.runtimeId.trim()
    let threadId = scope?.threadId.trim()
    if (!runtimeId || !threadId) {
      const separator = engineThreadId.indexOf(':')
      if (separator <= 0 || separator === engineThreadId.length - 1) {
        throw projectError(
          'evidence_snapshot_unavailable',
          `Project session ${engineThreadId} is not a canonical runtime/thread identity.`,
          false
        )
      }
      runtimeId = engineThreadId.slice(0, separator)
      threadId = engineThreadId.slice(separator + 1)
    }
    const capturedWorkspaceRoot = scope?.workspaceRoot.trim() || (
      await context.agentThreads.read({ runtimeId, threadId })
    ).workspaceRoot
    const status = await context.capabilities.invoke(
      {
        actionId: EVIDENCE_DAG_CAPABILITY_IDS.snapshotStatus,
        effect: 'read',
        inputSchema: evidenceDagSnapshotStatusInputSchema,
        outputSchema: evidenceDagSnapshotStatusOutputSchema
      },
      { runtimeId, threadId },
      {
        ...(capturedWorkspaceRoot ? { workspaceId: capturedWorkspaceRoot } : {})
      }
    )
    const committed = status.committed
    const parsed = evidenceDagCommittedSnapshotSchema.safeParse(committed)
    if (!parsed.success) {
      throw projectError(
        'evidence_snapshot_unavailable',
        `No committed Evidence Snapshot is available for ${engineThreadId}.`,
        scope !== undefined && committed === null
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
  const invalidationValue = record(source.invalidation)
  const invalidation = invalidationValue
    ? projectDagInvalidationSchema.parse({
        projectKey: invalidationValue.projectKey,
        desiredFingerprint: invalidationValue.desiredFingerprint,
        appliedFingerprint: invalidationValue.appliedFingerprint,
        stale: invalidationValue.stale,
        reason: invalidationValue.reason ?? null,
        changedFields: invalidationValue.changedFields,
        updatedAt: invalidationValue.updatedAt ?? invalidationValue.updated_at
      })
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
    ...(invalidation ? { invalidation } : {}),
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

type ProjectSessionIdentity = Readonly<{
  engineId: string
  runtimeId: string
  threadId: string
  workspaceRoot: string
}>

async function projectSessionsForUpdate(
  input: ProjectDagUpdateInput,
  context: DomainMainRuntimeLifecycleContext
): Promise<readonly ProjectSessionIdentity[]> {
  const workspaceRoot = projectWorkspaceRoot(input)
  if (!workspaceRoot) {
    throw projectError(
      'invalid_request',
      'Project DAG update requires a caller-bound workspaceRoot or projectRoot.',
      false
    )
  }
  const explicit = Array.isArray(input.scope)
    ? uniqueSorted(input.scope)
    : input.sessions?.length
      ? uniqueSorted(input.sessions)
      : null
  if (!explicit || explicit.length === 0) {
    throw projectError(
      'invalid_request',
      'Project DAG update requires an explicit Session scope list; workspace-wide discovery is disabled.',
      false
    )
  }
  return Promise.all(explicit.map((sessionId) =>
    authoritativeProjectSession(sessionId, workspaceRoot, context)
  ))
}

function projectWorkspaceRoot(input: ProjectDagTarget): string | undefined {
  const workspaceRoot = input.workspaceRoot?.trim()
  const projectRoot = input.projectRoot?.trim()
  if (workspaceRoot && projectRoot && !sameWorkspace(workspaceRoot, projectRoot)) {
    throw projectError(
      'invalid_request',
      'Project DAG workspaceRoot and projectRoot must identify the same workspace.',
      false
    )
  }
  return workspaceRoot || projectRoot
}

async function authoritativeProjectSession(
  engineId: string,
  workspaceRoot: string,
  context: DomainMainRuntimeLifecycleContext
): Promise<ProjectSessionIdentity> {
  const normalized = engineId.trim()
  if (!normalized) {
    throw projectError('invalid_request', 'Project Session identity cannot be empty.', false)
  }

  // The canonical identity is a display-safe `runtimeId:threadId` string, but
  // both components may contain colons (for example `domain:sciforge.foo`).
  // Try every delimiter candidate and let the Host-owned read validate the
  // complete runtime/thread/workspace tuple. This keeps explicit Scope checks
  // bounded to the selected Sessions and never scans the whole Workspace.
  const matches: ProjectSessionIdentity[] = []
  let workspaceMismatch = false
  for (const identity of candidateSessionIdentities(normalized)) {
    try {
      const thread = await context.agentThreads.read(identity)
      if (
        thread.runtimeId.trim() === identity.runtimeId &&
        thread.id.trim() === identity.threadId
      ) {
        if (!sameWorkspace(thread.workspaceRoot, workspaceRoot)) {
          workspaceMismatch = true
          continue
        }
        matches.push({
          engineId: normalized,
          runtimeId: identity.runtimeId,
          threadId: identity.threadId,
          workspaceRoot: thread.workspaceRoot!.trim()
        })
      }
    } catch {
      // Try the next delimiter candidate. The Host read is the authority.
    }
  }
  if (workspaceMismatch) {
    throw projectError(
      'access_restricted',
      `Project session ${engineId} does not belong to the requested workspace.`,
      false
    )
  }
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    throw projectError(
      'access_restricted',
      `Project session ${engineId} is ambiguous; use a structured Session identity.`,
      false
    )
  }
  throw projectError(
    'access_restricted',
    `Project session ${engineId} has no authoritative Agent thread binding.`,
    false
  )
}

function candidateSessionIdentities(value: string): readonly { runtimeId: string; threadId: string }[] {
  const candidates: { runtimeId: string; threadId: string }[] = []
  for (let separator = value.indexOf(':'); separator >= 0; separator = value.indexOf(':', separator + 1)) {
    if (separator === 0 || separator === value.length - 1) continue
    candidates.push({
      runtimeId: value.slice(0, separator),
      threadId: value.slice(separator + 1)
    })
  }
  if (candidates.length === 0) {
    throw projectError(
      'invalid_request',
      `Project session ${value} is not a canonical runtime/thread identity.`,
      false
    )
  }
  return candidates
}

function assertExecutionWorkspaceBinding(
  event: Extract<DomainArtifactEvent, { kind: 'execution-completed' }>,
  workspaceRoot: string
): void {
  const binding = event.hostBinding
  if (
    binding?.contractVersion !== 1 ||
    binding.workspaceBinding !== 'capability-caller' ||
    !binding.workspaceRoot?.trim() ||
    !event.workspaceRoot?.trim() ||
    !sameWorkspace(binding.workspaceRoot, event.workspaceRoot) ||
    !sameWorkspace(binding.workspaceRoot, workspaceRoot)
  ) {
    throw projectError('access_restricted',
      'Package execution event has no valid authoritative Host workspace binding.', false)
  }
}

function sameWorkspace(left: string | undefined, right: string | undefined): boolean {
  if (!left?.trim() || !right?.trim()) return false
  return resolve(left.trim()) === resolve(right.trim())
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
