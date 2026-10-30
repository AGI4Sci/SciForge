import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagCommittedSnapshotSchema,
  evidenceDagSnapshotStatusInputSchema,
  evidenceDagSnapshotStatusOutputSchema,
  type EvidenceDagCommittedSnapshot
} from '@sciforge/domain-evidence-dag/contract'
import type {
  DomainArtifactEvent,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import { domainArtifactEventScope } from '@sciforge/domain-sdk/host'
import { resolve } from 'node:path'
import {
  projectDagErrorSchema,
  projectDagGoalSchema,
  projectDagGovernanceRecordSchema,
  projectDagReadRecordsOutputSchema,
  projectDagResolveEvidencePreviewOutputSchema,
  projectDagUiUrl,
  projectDagViewOutputSchema,
  type ProjectDagErrorCode,
  type ProjectDagReadRecordsInput,
  type ProjectDagReadRecordsOutput,
  type ProjectDagResolveEvidencePreviewInput,
  type ProjectDagResolveEvidencePreviewOutput,
  type ProjectDagSaveGoalInput,
  type ProjectDagSaveGoalOutput,
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

import { ProjectDagCore, ProjectDagRuntimeError, normalizeProjectDagStatus, normalizeReceipt } from './core/index.js'

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

export { ProjectDagRuntimeError, normalizeProjectDagStatus, normalizeReceipt } from './core/index.js'

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
    const { config } = await this.#ready()
    const result = await (await this.#staticCore()).update(input)
    // UI authentication belongs solely to this trusted static adapter. Neither
    // the reusable core nor the plugin-facing port receives the runtime token.
    const url = new URL(result.url)
    url.hash = new URL(projectDagUiUrl({
      serviceUrl: config.baseUrl, apiKey: config.runtimeToken
    })).hash
    return { ...result, url: url.toString() }
  }

  async saveGoal(input: ProjectDagSaveGoalInput): Promise<ProjectDagSaveGoalOutput> {
    return (await this.#staticCore()).saveGoal(input)
  }

  async #staticCore(): Promise<ProjectDagCore> {
    const { context, config } = await this.#ready()
    return new ProjectDagCore({
      serviceUrl: config.baseUrl,
      readSession: async (identity) => {
        const thread = await context.agentThreads.read(identity)
        return { id: thread.id, runtimeId: thread.runtimeId, workspaceRoot: thread.workspaceRoot }
      },
      readCommittedSnapshot: (identity) => this.#readEvidenceSnapshotImpl(
        identity.engineId, context, identity),
      request: (route, method, body) => this.#requestProject(config, route, method, body)
    })
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

  /**
   * Bounded read-only port over the governance records owned by the Python
   * sidecar. Write authority stays with the Python workflow; when the service
   * is absent this fails closed with a typed `service_unreachable` error.
   */
  async readRecords(
    input: ProjectDagReadRecordsInput & Readonly<{ workspaceRoot: string }>
  ): Promise<ProjectDagReadRecordsOutput> {
    let config: ProjectDagSidecarConfig
    try {
      config = (await this.#ready()).config
    } catch (error) {
      throw asServiceUnreachable(error)
    }
    const query = new URLSearchParams({ workspaceRoot: input.workspaceRoot })
    if (input.limit !== undefined) query.set('limit', String(input.limit))
    if (input.cursor) query.set('cursor', input.cursor)
    let data: unknown
    try {
      data = await this.#requestProject(
        config,
        `/${input.recordType}s?${query.toString()}`,
        'GET'
      )
    } catch (error) {
      throw asServiceUnreachable(error)
    }
    const page = recordPage(data)
    const recordSchema = projectDagGovernanceRecordSchema(input.recordType)
    return projectDagReadRecordsOutputSchema.parse({
      records: page.records.map((record) => recordSchema.parse(record)),
      nextCursor: page.nextCursor
    })
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
      { runtimeId, threadId, ...(capturedWorkspaceRoot ? { workspaceRoot: capturedWorkspaceRoot } : {}) },
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

function asServiceUnreachable(error: unknown): ProjectDagRuntimeError {
  if (error instanceof ProjectDagRuntimeError) {
    // Errors carrying an httpStatus detail came from a live service response
    // and keep their canonical code; only absent transports and unreachable
    // services are reported as service_unreachable.
    if (error.error.code === 'upstream_unavailable' &&
        error.error.details?.httpStatus === undefined) {
      return projectError('service_unreachable', error.error.message, true)
    }
    return error
  }
  return projectError(
    'service_unreachable',
    error instanceof Error ? error.message : String(error),
    true
  )
}

function recordPage(value: unknown): {
  records: unknown[]
  nextCursor: string | null
} {
  const page = record(value)
  const records = page && Array.isArray(page.records) ? page.records : null
  const nextCursor = page?.nextCursor
  if (!records || (nextCursor !== null && typeof nextCursor !== 'string')) {
    throw projectError(
      'service_unreachable',
      'Project DAG governance read returned an unreadable page.',
      true
    )
  }
  return { records, nextCursor: nextCursor ?? null }
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
