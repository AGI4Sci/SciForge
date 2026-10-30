import {
  evidenceDagCommittedSnapshotSchema,
  type EvidenceDagSnapshotIdentity
} from '@sciforge/domain-evidence-dag/contract'
import { resolve } from 'node:path'
import {
  projectDagCapturedScopeSchema,
  projectDagCommittedSnapshotSchema,
  projectDagDurableReceiptSchema,
  projectDagErrorSchema,
  projectDagGoalSchema,
  projectDagInvalidationSchema,
  projectDagStatusSchema,
  projectDagUiUrl,
  projectDagUpdateOutputSchema,
  type ProjectDagDurableReceipt,
  type ProjectDagError,
  type ProjectDagErrorCode,
  type ProjectDagSaveGoalInput,
  type ProjectDagSaveGoalOutput,
  type ProjectDagStatus,
  type ProjectDagTarget,
  type ProjectDagUpdateInput,
  type ProjectDagUpdateOutput
} from '../contract.js'
import type { ProjectDagPorts } from "../ports/index.js"
// A Goal save is one composite command, not two independently interleavable
// draft/apply requests. Share the lane across core instances (static calls
// create fresh cores); unrelated canonical Projects retain independent lanes.
const goalCommands = new Map<string, Promise<ProjectDagSaveGoalOutput>>()
export class ProjectDagRuntimeError extends Error {
  readonly error: ProjectDagError

  constructor(error: ProjectDagError) {
    super(error.message)
    this.name = 'ProjectDagRuntimeError'
    this.error = error
  }
}

export class ProjectDagCore {
  readonly #ports: ProjectDagPorts
  constructor(ports: ProjectDagPorts) { this.#ports = ports }
  async update(input: ProjectDagUpdateInput, signal?: AbortSignal): Promise<ProjectDagUpdateOutput> {
    signal?.throwIfAborted()
    const context = this.#ports
    const candidateSessionRecords = await projectSessionsForUpdate(input, context)
    signal?.throwIfAborted()
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
      return this.#ports.readCommittedSnapshot({
        engineId: sessionId,
        runtimeId: session.runtimeId,
        threadId: session.threadId,
        workspaceRoot: session.workspaceRoot
      }).then((value) => {
        const committed = evidenceDagCommittedSnapshotSchema.parse(value)
        if (committed.threadId !== sessionId) {
          throw projectError('evidence_snapshot_unavailable',
            `Evidence Snapshot identity does not match ${sessionId}.`, false)
        }
        return committed
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
    // Preparation has no write admission. Recheck after every preparation await
    // chain at the first irreversible dispatch, not merely at authorization.
    signal?.throwIfAborted()
    const receiptValue = await this.#ports.request( '/updates', 'POST', {
      ...projectRoutingBody(input),
      reason: 'manual_immediate',
      priority: 3,
      ...(input.autonomyMode ? { autonomyMode: input.autonomyMode } : {}),
      evidenceVector,
      capturedScope
    })
    const receipt = normalizeReceipt(receiptValue)
    const status = normalizeProjectDagStatus(await this.#ports.request(
      `/updates/status${projectQuery(input)}`,
      'GET'
    ))
    signal?.throwIfAborted()
    return projectDagUpdateOutputSchema.parse({
      url: projectDagUiUrl({
        serviceUrl: this.#ports.serviceUrl,
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

  async saveGoal(input: ProjectDagSaveGoalInput, signal?: AbortSignal): Promise<ProjectDagSaveGoalOutput> {
    const key = resolve(projectWorkspaceRoot(input) ?? '.')
    const previous = goalCommands.get(key) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(() => this.#saveGoalOnce(input, signal))
    goalCommands.set(key, task)
    const release = () => { if (goalCommands.get(key) === task) goalCommands.delete(key) }
    void task.then(release, release)
    return task
  }

  async #saveGoalOnce(input: ProjectDagSaveGoalInput, signal?: AbortSignal): Promise<ProjectDagSaveGoalOutput> {
    signal?.throwIfAborted()
    await this.#ports.request( '/goals/draft', 'POST', {
      ...projectRoutingBody(input),
      title: input.title,
      description: input.description ?? '',
      ...(input.rootGoalId ? { rootGoalId: input.rootGoalId } : {})
    })
    const goalValue = await this.#ports.request( '/goals/apply', 'POST', {
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
    const status = normalizeProjectDagStatus(await this.#ports.request(
      `/updates/status${projectQuery(input)}`,
      'GET'
    ))
    // Once draft was dispatched, apply/readback must settle before reporting
    // cancellation: never strand or erase an admitted durable draft.
    signal?.throwIfAborted()
    return {
      goal,
      status
    }
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
  context: ProjectDagPorts
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
  context: ProjectDagPorts
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
      const thread = await context.readSession(identity)
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

function sameWorkspace(left: string | undefined, right: string | undefined): boolean {
  if (!left?.trim() || !right?.trim()) return false
  return resolve(left.trim()) === resolve(right.trim())
}

export function normalizeRuntimeError(
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

export function projectError(
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
