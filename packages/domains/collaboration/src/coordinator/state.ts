import {
  idempotencyKeySchema,
  projectIdSchema,
  revisionSchema,
  sha256Schema,
  userIdSchema,
  type ProjectRequirementsDocument
} from '@sciforge/collaboration-contracts'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type {
  DomainMainPackageSettingsHost,
  DomainMainPackageSettingsSnapshot
} from '@sciforge/domain-sdk/package-storage'
import {
  domainMainPackageSettingsSnapshotSchema
} from '@sciforge/domain-sdk/package-storage'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import {
  projectCoordinatorActivationRequestIdSchema,
  projectCoordinatorCoordinatorSessionBindingRecordSchema,
  projectCoordinatorOrdinarySessionSchema,
  projectCoordinatorPendingActivationSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateReceiptSchema,
  projectCoordinatorRequirementsCompletionFailureReasonSchema,
  projectCoordinatorTransferFeedbackSchema,
  type ProjectCoordinatorCoordinatorSessionBindingRecord,
  type ProjectCoordinatorOrdinarySession,
  type ProjectCoordinatorPendingActivation,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateReceipt,
  type ProjectCoordinatorRequirementsCompletionFailureReason,
  type ProjectCoordinatorRequirementsCompletion,
  type ProjectCoordinatorTransferFeedback
} from './contract.js'

const projectCreateIntentRecordSchema = z.object({
  createIntentId: projectCoordinatorProjectCreateInputSchema.unwrap().shape.createIntentId,
  principalUserId: userIdSchema,
  commandDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(['pending', 'succeeded']),
  createdProjectId: projectIdSchema.nullable(),
  coordinatorSession: projectCoordinatorOrdinarySessionSchema.nullable().default(null),
  activationRequestId: projectCoordinatorActivationRequestIdSchema.nullable().default(null)
}).strict().readonly()

const projectDeleteIntentRecordSchema = z.object({
  projectId: projectIdSchema,
  principalUserId: userIdSchema,
  idempotencyKey: idempotencyKeySchema,
  expectedRevision: revisionSchema,
  expectedCoordinatorAuthorityEpoch: revisionSchema,
  expectedExecutionAuthorityEpoch: revisionSchema,
  state: z.enum(['pending', 'succeeded'])
}).strict().readonly()

/**
 * One durable Coordinator completion directive per exact requirements draft.
 * The stable `clientDirectiveId` lets the Host reconcile concurrent and
 * post-restart attempts without a second model turn.
 */
const projectRequirementsCompletionAttemptRecordSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: projectIdSchema,
  requirementsDocumentId: z.string().regex(/^rqd_[A-Za-z0-9]{20,}$/u),
  expectedRequirementsRevision: revisionSchema,
  contentDigest: sha256Schema,
  coordinatorAuthorityEpoch: revisionSchema,
  clientDirectiveId: z.string().trim().min(1).max(256),
  retryOrdinal: z.number().int().min(0).max(1_000_000).default(0),
  state: z.enum(['running', 'failed', 'completed']).default('failed'),
  startedAt: z.string().trim().min(1).default('1970-01-01T00:00:00.000Z'),
  leaseExpiresAt: z.string().trim().min(1).default('1970-01-01T00:00:00.000Z'),
  failureReason: projectCoordinatorRequirementsCompletionFailureReasonSchema.nullable().default(null),
  failedAt: z.string().nullable().default(null),
  result: z.object({
    revision: revisionSchema,
    contentDigest: sha256Schema
  }).strict().readonly().nullable().default(null)
}).strict().refine((attempt) => attempt.state === 'completed'
  ? attempt.result !== null && attempt.result.revision === attempt.expectedRequirementsRevision + 1
  : attempt.result === null, 'Completion success requires its exact advancing Cloud result.').readonly()

const projectCoordinatorStateSchema = z.object({
  schemaVersion: z.literal(3),
  coordinatorSessionBindings: z.array(
    projectCoordinatorCoordinatorSessionBindingRecordSchema
  ).max(10_000).default([]),
  coordinatorTransferFeedback: z.array(projectCoordinatorTransferFeedbackSchema)
    .max(1_000)
    .default([]),
  projectCreateIntents: z.array(projectCreateIntentRecordSchema)
    .max(10_000)
    .default([]),
  requirementsCompletionAttempts: z.array(projectRequirementsCompletionAttemptRecordSchema)
    .max(10_000)
    .default([]),
  pendingProjectActivations: z.array(projectCoordinatorPendingActivationSchema)
    .max(10_000)
    .default([]),
  projectDeleteIntents: z.array(projectDeleteIntentRecordSchema)
    .max(10_000)
    .default([]),
  deletedProjectIds: z.array(projectIdSchema)
    .max(10_000)
    .default([])
}).superRefine((state, context) => {
  const intentProjectIds = state.projectDeleteIntents.map(({ projectId }) => projectId)
  if (new Set(intentProjectIds).size !== intentProjectIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['projectDeleteIntents'],
      message: 'Each Project has at most one durable delete intent.'
    })
  }
  if (new Set(state.deletedProjectIds).size !== state.deletedProjectIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['deletedProjectIds'],
      message: 'Deleted Project tombstones must be unique.'
    })
  }
  const attemptKeys = state.requirementsCompletionAttempts.map((attempt) => (
    `${attempt.projectId}\u0000${attempt.requirementsDocumentId}\u0000${attempt.expectedRequirementsRevision}`
  ))
  if (new Set(attemptKeys).size !== attemptKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['requirementsCompletionAttempts'],
      message: 'Each exact requirements draft has at most one completion attempt.'
    })
  }
}).readonly()

type ProjectCoordinatorState = z.infer<typeof projectCoordinatorStateSchema>

/**
 * Coordinator durable state is separate from Collaboration connection settings.
 *
 * The old implementation used the package settings host for both documents.
 * A Coordinator write therefore replaced `{schemaVersion: 2, baseUrl}` with
 * its own schema-3 state, and the next runtime restart failed while parsing
 * connection settings. This host keeps the same revision/CAS contract while
 * storing Coordinator state in its own file and migrating the one known legacy
 * collision exactly once.
 */
export function createProjectCoordinatorStateHost(
  statePath: string,
  legacySettings: DomainMainPackageSettingsHost
): DomainMainPackageSettingsHost {
  return new ProjectCoordinatorStateFileHost(statePath, legacySettings)
}

class ProjectCoordinatorStateFileHost implements DomainMainPackageSettingsHost {
  private migration: Promise<void> | null = null
  private writeTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly statePath: string,
    private readonly legacySettings: DomainMainPackageSettingsHost
  ) {}

  async read(): Promise<DomainMainPackageSettingsSnapshot> {
    await this.ensureMigrated()
    return this.readFileSnapshot()
  }

  async write(
    value: DomainPackageJsonValue,
    expectedRevision: number
  ): Promise<DomainMainPackageSettingsSnapshot> {
    await this.ensureMigrated()
    return this.serialize(async () => {
      const current = await this.readFileSnapshot()
      if (current.revision !== expectedRevision) {
        throw new Error('Project Coordinator state revision conflict.')
      }
      const next = { revision: current.revision + 1, value }
      await this.writeFileSnapshot(next)
      return next
    })
  }

  async clear(expectedRevision: number): Promise<DomainMainPackageSettingsSnapshot> {
    await this.ensureMigrated()
    return this.serialize(async () => {
      const current = await this.readFileSnapshot()
      if (current.revision !== expectedRevision) {
        throw new Error('Project Coordinator state revision conflict.')
      }
      const next = { revision: current.revision + 1, value: null }
      await this.writeFileSnapshot(next)
      return next
    })
  }

  private async ensureMigrated(): Promise<void> {
    this.migration ??= this.migrateLegacyCollision()
    return this.migration
  }

  private async migrateLegacyCollision(): Promise<void> {
    const existing = await this.tryReadFileSnapshot()
    const legacy = await this.legacySettings.read()
    const legacyState = legacy.value === null
      ? null
      : projectCoordinatorStateSchema.safeParse(legacy.value)

    if (!existing && legacyState?.success) {
      await this.writeFileSnapshot({ revision: 0, value: legacyState.data })
      // Only clear the old host when it still contains Coordinator state. A
      // concurrent connection configuration must never be deleted.
      const latestLegacy = await this.legacySettings.read()
      if (projectCoordinatorStateSchema.safeParse(latestLegacy.value).success) {
        await this.legacySettings.clear(latestLegacy.revision)
      }
      return
    }

    // A previous process may have completed the file copy before it was
    // interrupted while clearing the old host. Finish that cleanup on restart.
    if (existing && legacyState?.success) {
      await this.legacySettings.clear(legacy.revision)
    }
  }

  private async serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const run = this.writeTail.then(operation)
    this.writeTail = run.then(() => undefined, () => undefined)
    return run
  }

  private async readFileSnapshot(): Promise<DomainMainPackageSettingsSnapshot> {
    const snapshot = await this.tryReadFileSnapshot()
    return snapshot ?? { revision: 0, value: null }
  }

  private async tryReadFileSnapshot(): Promise<DomainMainPackageSettingsSnapshot | null> {
    try {
      const raw = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown
      return domainMainPackageSettingsSnapshotSchema.parse(raw)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw error
    }
  }

  private async writeFileSnapshot(snapshot: DomainMainPackageSettingsSnapshot): Promise<void> {
    const directoryPath = dirname(this.statePath)
    await mkdir(directoryPath, { recursive: true, mode: 0o700 })
    await chmod(directoryPath, 0o700)
    const temporaryPath = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, this.statePath)
      await chmod(this.statePath, 0o600)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

const EMPTY_STATE: ProjectCoordinatorState = {
  schemaVersion: 3,
  coordinatorSessionBindings: [],
  coordinatorTransferFeedback: [],
  projectCreateIntents: [],
  requirementsCompletionAttempts: [],
  pendingProjectActivations: [],
  projectDeleteIntents: [],
  deletedProjectIds: []
}

export type ProjectCoordinatorProjectDeleteIntent = z.infer<
  typeof projectDeleteIntentRecordSchema
>

export type ProjectCoordinatorProjectCreationCommit = Readonly<{
  projectId: string
  coordinatorSession: ProjectCoordinatorOrdinarySession
  activationRequestId: string
}>

export type ProjectCoordinatorProjectCreationPreparation = Readonly<{
  createdProjectId: string | null
  coordinatorSession: ProjectCoordinatorOrdinarySession | null
  activationRequestId: string | null
}>

export type ProjectCoordinatorRequirementsCompletionAttempt = z.infer<
  typeof projectRequirementsCompletionAttemptRecordSchema
>

export class ProjectCoordinatorStateStore {
  constructor(private readonly settings: DomainMainPackageSettingsHost) {}

  async readCoordinatorSessionBindings(): Promise<
    readonly ProjectCoordinatorCoordinatorSessionBindingRecord[]
  > {
    const { state } = await this.read()
    return state.coordinatorSessionBindings
  }

  /**
   * Binds one prepared Coordinator Runtime Session to the exact Project
   * authority epoch. This is the same durable binding shape created with the
   * Project; it only fills the one missing binding for an unbound Project.
   */
  async persistCoordinatorSessionBinding(
    rawBinding: ProjectCoordinatorCoordinatorSessionBindingRecord
  ): Promise<ProjectCoordinatorCoordinatorSessionBindingRecord> {
    const binding = projectCoordinatorCoordinatorSessionBindingRecordSchema.parse(rawBinding)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      assertProjectWritable(state, binding.projectId)
      const existing = state.coordinatorSessionBindings.find((candidate) => (
        candidate.runtimeId === binding.runtimeId && candidate.threadId === binding.threadId
      ))
      if (existing) {
        if (
          existing.projectId !== binding.projectId ||
          existing.principalUserId !== binding.principalUserId ||
          existing.coordinatorAgentId !== binding.coordinatorAgentId ||
          existing.coordinatorAuthorityEpoch !== binding.coordinatorAuthorityEpoch
        ) {
          throw new Error('The ordinary Session is already bound to different Project authority.')
        }
        return existing
      }
      const authorityBinding = state.coordinatorSessionBindings.find((candidate) => (
        candidate.projectId === binding.projectId &&
        candidate.coordinatorAuthorityEpoch === binding.coordinatorAuthorityEpoch
      ))
      if (authorityBinding) {
        if (
          authorityBinding.runtimeId !== binding.runtimeId ||
          authorityBinding.threadId !== binding.threadId
        ) {
          throw new Error('The Project authority already has a Coordinator Session binding.')
        }
        return authorityBinding
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        coordinatorSessionBindings: [...state.coordinatorSessionBindings, binding]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return binding
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to persist the Coordinator Session binding.')
  }

  async readRequirementsCompletionAttempt(input: Readonly<{
    projectId: string
    requirementsDocumentId: string
    expectedRequirementsRevision: number
  }>): Promise<ProjectCoordinatorRequirementsCompletionAttempt | null> {
    const { state } = await this.read()
    return state.requirementsCompletionAttempts.find((candidate) => (
      sameRequirementsCompletionAttempt(candidate, input)
    )) ?? null
  }

  /**
   * Atomically claims the one durable completion directive for an exact
   * requirements draft. A live lease makes a concurrent caller fail closed
   * instead of starting a second Runtime turn; an expired lease resumes the
   * same Host directive after a crash.
   */
  async claimRequirementsCompletionAttempt(rawAttempt: Readonly<{
    projectId: string
    requirementsDocumentId: string
    expectedRequirementsRevision: number
    contentDigest: string
    coordinatorAuthorityEpoch: number
    clientDirectiveId: string
    startedAt: string
    leaseExpiresAt: string
  }>): Promise<Readonly<{
    attempt: ProjectCoordinatorRequirementsCompletionAttempt
    claimed: boolean
  }>> {
    const candidate = projectRequirementsCompletionAttemptRecordSchema.parse({
      schemaVersion: 1,
      ...rawAttempt,
      retryOrdinal: 0,
      state: 'running',
      failureReason: null,
      failedAt: null
    })
    let snapshot = await this.settings.read()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const state = parseState(snapshot)
      assertProjectWritable(state, candidate.projectId)
      const existing = state.requirementsCompletionAttempts.find((attempt) => (
        sameRequirementsCompletionAttempt(attempt, candidate)
      ))
      if (!existing) {
        const value = projectCoordinatorStateSchema.parse({
          ...state,
          requirementsCompletionAttempts: [...state.requirementsCompletionAttempts, candidate]
        })
        try {
          await this.settings.write(value, snapshot.revision)
          return { attempt: candidate, claimed: true }
        } catch (error) {
          if (cycle >= 2) throw error
          snapshot = await this.settings.read()
          continue
        }
      }
      if (existing.clientDirectiveId !== candidate.clientDirectiveId) {
        throw new Error('The requirements completion attempt has a different directive identity.')
      }
      if (existing.state === 'completed' || (
        existing.state === 'running' &&
        Date.parse(existing.leaseExpiresAt) > Date.parse(candidate.startedAt)
      )) {
        return { attempt: existing, claimed: false }
      }
      const updated = projectRequirementsCompletionAttemptRecordSchema.parse({
        ...existing,
        retryOrdinal: existing.state === 'failed'
          ? existing.retryOrdinal + 1
          : existing.retryOrdinal,
        state: 'running',
        startedAt: candidate.startedAt,
        leaseExpiresAt: candidate.leaseExpiresAt,
        failureReason: null,
        failedAt: null,
        result: null
      })
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        requirementsCompletionAttempts: state.requirementsCompletionAttempts.map((attempt) => (
          sameRequirementsCompletionAttempt(attempt, existing) ? updated : attempt
        ))
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return { attempt: updated, claimed: true }
      } catch (error) {
        if (cycle >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to claim the requirements completion attempt.')
  }

  async recordRequirementsCompletionFailure(
    attempt: ProjectCoordinatorRequirementsCompletionAttempt,
    failure: Readonly<{
      reason: ProjectCoordinatorRequirementsCompletionFailureReason
      failedAt: string
    }>
  ): Promise<void> {
    const updated = projectRequirementsCompletionAttemptRecordSchema.parse({
      ...attempt,
      state: 'failed',
      failureReason: failure.reason,
      failedAt: failure.failedAt
    })
    await this.updateRequirementsCompletionAttempt(attempt, updated)
  }

  async recordRequirementsCompletionSuccess(
    attempt: ProjectCoordinatorRequirementsCompletionAttempt,
    document: ProjectRequirementsDocument
  ): Promise<void> {
    if (document.projectId !== attempt.projectId ||
        document.requirementsDocumentId !== attempt.requirementsDocumentId ||
        document.state !== 'draft') {
      throw new Error('Completion receipt belongs to a different requirements document.')
    }
    const updated = projectRequirementsCompletionAttemptRecordSchema.parse({
      ...attempt,
      state: 'completed',
      failureReason: null,
      failedAt: null,
      result: { revision: document.revision, contentDigest: document.contentDigest }
    })
    await this.updateRequirementsCompletionAttempt(attempt, updated)
  }

  async readRequirementsCompletion(input: Readonly<{
    projectId: string
    requirementsDocumentId: string
    expectedRequirementsRevision: number
    coordinatorAuthorityEpoch: number
    contentDigest: string
  }>): Promise<ProjectCoordinatorRequirementsCompletion | null> {
    const { state } = await this.read()
    const candidates = state.requirementsCompletionAttempts.filter((attempt) => (
      attempt.projectId === input.projectId &&
      attempt.requirementsDocumentId === input.requirementsDocumentId &&
      attempt.coordinatorAuthorityEpoch === input.coordinatorAuthorityEpoch
    ))
    const attempt = candidates.find((candidate) => (
      candidate.expectedRequirementsRevision === input.expectedRequirementsRevision &&
      candidate.contentDigest === input.contentDigest
    ))
    if (attempt?.state === 'running') {
      return Date.parse(attempt.leaseExpiresAt) > Date.now()
        ? { state: 'running', startedAt: attempt.startedAt }
        : null
    }
    if (attempt?.state === 'failed' && attempt.failureReason && attempt.failedAt) {
      return { state: 'failed', reason: attempt.failureReason, failedAt: attempt.failedAt }
    }
    const completed = candidates.find((candidate) => (
      candidate.state === 'completed' &&
      candidate.result?.revision === input.expectedRequirementsRevision &&
      candidate.result.contentDigest === input.contentDigest
    ))
    if (!completed?.result) return null
    return {
      state: 'completed',
      requirementsDocumentId: completed.requirementsDocumentId,
      sourceRevision: completed.expectedRequirementsRevision,
      sourceContentDigest: completed.contentDigest,
      resultRevision: completed.result.revision,
      resultContentDigest: completed.result.contentDigest
    }
  }

  private async updateRequirementsCompletionAttempt(
    previous: ProjectCoordinatorRequirementsCompletionAttempt,
    next: ProjectCoordinatorRequirementsCompletionAttempt
  ): Promise<void> {
    let snapshot = await this.settings.read()
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const state = parseState(snapshot)
      assertProjectWritable(state, previous.projectId)
      if (!state.requirementsCompletionAttempts.some((candidate) => (
        sameRequirementsCompletionAttempt(candidate, previous) &&
        candidate.clientDirectiveId === previous.clientDirectiveId &&
        candidate.retryOrdinal === previous.retryOrdinal &&
        candidate.startedAt === previous.startedAt &&
        candidate.leaseExpiresAt === previous.leaseExpiresAt &&
        candidate.state !== 'completed'
      ))) return
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        requirementsCompletionAttempts: state.requirementsCompletionAttempts.filter((candidate) => (
          next.state !== 'completed' || candidate.state !== 'completed' ||
          candidate.projectId !== next.projectId ||
          candidate.requirementsDocumentId !== next.requirementsDocumentId
        )).map((candidate) => (
          sameRequirementsCompletionAttempt(candidate, previous) ? next : candidate
        ))
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return
      } catch (error) {
        if (cycle >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to update the requirements completion attempt.')
  }

  async readPendingProjectActivations(): Promise<readonly ProjectCoordinatorPendingActivation[]> {
    const { state } = await this.read()
    return state.pendingProjectActivations
  }

  async readProjectDeleteIntent(
    rawPrincipalUserId: string,
    rawProjectId: string,
    rawIdempotencyKey: string
  ): Promise<ProjectCoordinatorProjectDeleteIntent | null> {
    const principalUserId = userIdSchema.parse(rawPrincipalUserId)
    const projectId = projectIdSchema.parse(rawProjectId)
    idempotencyKeySchema.parse(rawIdempotencyKey)
    const { state } = await this.read()
    const intent = state.projectDeleteIntents.find((candidate) => (
      candidate.projectId === projectId
    ))
    if (!intent) return null
    if (intent.principalUserId !== principalUserId) {
      throw new Error('The Project delete intent belongs to a different Principal.')
    }
    // A later UI invocation resumes the original business command. Its fresh
    // Host invocation key must never replace the persisted Cloud idempotency
    // key or CAS facts after an ambiguous response.
    return intent
  }

  async beginProjectDelete(
    rawIntent: Omit<ProjectCoordinatorProjectDeleteIntent, 'state'>
  ): Promise<ProjectCoordinatorProjectDeleteIntent> {
    const intent = projectDeleteIntentRecordSchema.parse({
      ...rawIntent,
      state: 'pending'
    })
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const existing = state.projectDeleteIntents.find((candidate) => (
        candidate.projectId === intent.projectId
      ))
      if (existing) {
        if (
          existing.principalUserId !== intent.principalUserId ||
          existing.idempotencyKey !== intent.idempotencyKey ||
          existing.expectedRevision !== intent.expectedRevision ||
          existing.expectedCoordinatorAuthorityEpoch !== intent.expectedCoordinatorAuthorityEpoch ||
          existing.expectedExecutionAuthorityEpoch !== intent.expectedExecutionAuthorityEpoch
        ) {
          throw new Error('The Project already has a different durable delete intent.')
        }
        return existing
      }
      if (state.deletedProjectIds.includes(intent.projectId)) {
        throw new Error('The Project was already deleted.')
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        projectDeleteIntents: [...state.projectDeleteIntents, intent]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return intent
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to persist the Project delete intent.')
  }

  async abandonProjectDelete(
    rawPrincipalUserId: string,
    rawProjectId: string,
    rawIdempotencyKey: string
  ): Promise<void> {
    const principalUserId = userIdSchema.parse(rawPrincipalUserId)
    const projectId = projectIdSchema.parse(rawProjectId)
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const intent = state.projectDeleteIntents.find((candidate) => (
        candidate.projectId === projectId
      ))
      if (!intent || intent.state === 'succeeded') return
      if (
        intent.principalUserId !== principalUserId ||
        intent.idempotencyKey !== idempotencyKey
      ) {
        throw new Error('The Project delete intent belongs to a different Principal or invocation.')
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        projectDeleteIntents: state.projectDeleteIntents.filter((candidate) => (
          candidate.projectId !== projectId
        ))
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to abandon the Project delete intent.')
  }

  async completeProjectDelete(
    rawPrincipalUserId: string,
    rawProjectId: string,
    rawIdempotencyKey: string
  ): Promise<void> {
    const principalUserId = userIdSchema.parse(rawPrincipalUserId)
    const projectId = projectIdSchema.parse(rawProjectId)
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const intent = state.projectDeleteIntents.find((candidate) => (
        candidate.projectId === projectId
      ))
      if (!intent) throw new Error('The Project delete receipt has no durable intent.')
      if (
        intent.principalUserId !== principalUserId ||
        intent.idempotencyKey !== idempotencyKey
      ) {
        throw new Error('The Project delete receipt belongs to a different Principal or invocation.')
      }
      const cleared = withoutProjectLocalState(state, projectId)
      const value = projectCoordinatorStateSchema.parse({
        ...cleared,
        projectDeleteIntents: cleared.projectDeleteIntents.map((candidate) => (
          candidate.projectId === projectId
            ? { ...candidate, state: 'succeeded' }
            : candidate
        )),
        deletedProjectIds: cleared.deletedProjectIds.includes(projectId)
          ? cleared.deletedProjectIds
          : [...cleared.deletedProjectIds, projectId]
      })
      if (
        intent.state === 'succeeded' &&
        JSON.stringify(value) === JSON.stringify(state)
      ) return
      try {
        await this.settings.write(value, snapshot.revision)
        return
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to commit the Project delete receipt.')
  }

  async clearProjectLocalState(rawProjectId: string): Promise<void> {
    const projectId = projectIdSchema.parse(rawProjectId)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const cleared = withoutProjectLocalState(state, projectId)
      const value = projectCoordinatorStateSchema.parse({
        ...cleared,
        projectDeleteIntents: cleared.projectDeleteIntents.map((intent) => (
          intent.projectId === projectId
            ? { ...intent, state: 'succeeded' }
            : intent
        )),
        deletedProjectIds: cleared.deletedProjectIds.includes(projectId)
          ? cleared.deletedProjectIds
          : [...cleared.deletedProjectIds, projectId]
      })
      if (JSON.stringify(value) === JSON.stringify(state)) return
      try {
        await this.settings.write(value, snapshot.revision)
        return
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to clear deleted Project local state.')
  }

  async readProjectCreationCommit(
    principalUserId: string,
    rawInput: ProjectCoordinatorProjectCreateInput
  ): Promise<ProjectCoordinatorProjectCreationCommit | null> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const owner = userIdSchema.parse(principalUserId)
    const commandDigest = projectCreateCommandDigest(input)
    const { state } = await this.read()
    const intent = state.projectCreateIntents.find(({ createIntentId }) => (
      createIntentId === input.createIntentId
    ))
    if (!intent) return null
    if (intent.principalUserId !== owner || intent.commandDigest !== commandDigest) {
      throw new Error('Project create intent was reused for a different Owner or business command.')
    }
    if (
      intent.state !== 'succeeded' ||
      !intent.createdProjectId ||
      !intent.coordinatorSession ||
      !intent.activationRequestId
    ) return null
    assertProjectWritable(state, intent.createdProjectId)
    const binding = state.coordinatorSessionBindings.find((candidate) => (
      candidate.projectId === intent.createdProjectId &&
      candidate.principalUserId === owner &&
      candidate.runtimeId === intent.coordinatorSession!.runtimeId &&
      candidate.threadId === intent.coordinatorSession!.threadId
    ))
    if (!binding) throw new Error('Committed Project creation is missing its Coordinator Session binding.')
    return Object.freeze({
      projectId: intent.createdProjectId,
      coordinatorSession: intent.coordinatorSession,
      activationRequestId: intent.activationRequestId
    })
  }

  async readProjectCreationPreparation(
    principalUserId: string,
    rawInput: ProjectCoordinatorProjectCreateInput
  ): Promise<ProjectCoordinatorProjectCreationPreparation | null> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const owner = userIdSchema.parse(principalUserId)
    const commandDigest = projectCreateCommandDigest(input)
    const { state } = await this.read()
    const intent = state.projectCreateIntents.find(({ createIntentId }) => (
      createIntentId === input.createIntentId
    ))
    if (!intent) return null
    if (intent.principalUserId !== owner || intent.commandDigest !== commandDigest) {
      throw new Error('Project create intent was reused for a different Owner or business command.')
    }
    if (intent.createdProjectId) assertProjectWritable(state, intent.createdProjectId)
    return Object.freeze({
      createdProjectId: intent.createdProjectId,
      coordinatorSession: intent.coordinatorSession,
      activationRequestId: intent.activationRequestId
    })
  }

  async persistProjectCreationPreparation(
    principalUserId: string,
    rawInput: ProjectCoordinatorProjectCreateInput,
    rawReceipt: ProjectCoordinatorProjectCreateReceipt,
    rawCoordinatorSession: ProjectCoordinatorOrdinarySession,
    rawActivationRequestId: string
  ): Promise<ProjectCoordinatorProjectCreationPreparation> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const receipt = projectCoordinatorProjectCreateReceiptSchema.parse(rawReceipt)
    const coordinatorSession = projectCoordinatorOrdinarySessionSchema.parse(rawCoordinatorSession)
    const activationRequestId = projectCoordinatorActivationRequestIdSchema.parse(
      rawActivationRequestId
    )
    const owner = userIdSchema.parse(principalUserId)
    const commandDigest = projectCreateCommandDigest(input)
    if (receipt.createIntentId !== input.createIntentId) {
      throw new Error('Project create receipt does not match its durable intent.')
    }
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const intent = state.projectCreateIntents.find(({ createIntentId }) => (
        createIntentId === input.createIntentId
      ))
      if (
        !intent ||
        intent.principalUserId !== owner ||
        intent.commandDigest !== commandDigest
      ) {
        throw new Error('Coordinator Session preparation does not match its durable Project create intent.')
      }
      if (intent.createdProjectId && intent.createdProjectId !== receipt.createdProjectId) {
        throw new Error('Project create intent resolved to a different Cloud Project.')
      }
      if (intent.coordinatorSession || intent.activationRequestId) {
        if (
          !intent.coordinatorSession ||
          !intent.activationRequestId
        ) {
          throw new Error('Project create intent contains an incomplete Coordinator Session preparation.')
        }
        return Object.freeze({
          createdProjectId: intent.createdProjectId,
          coordinatorSession: intent.coordinatorSession,
          activationRequestId: intent.activationRequestId
        })
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        projectCreateIntents: state.projectCreateIntents.map((candidate) => (
          candidate.createIntentId === input.createIntentId
            ? {
                ...candidate,
                createdProjectId: receipt.createdProjectId,
                coordinatorSession,
                activationRequestId
              }
            : candidate
        ))
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return Object.freeze({
          createdProjectId: receipt.createdProjectId,
          coordinatorSession,
          activationRequestId
        })
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to persist the Coordinator Session preparation.')
  }

  /**
   * Durably joins retries of the same unresolved business form to one create
   * intent. A reused intent with different business input fails closed.
   */
  async resolveProjectCreateIntent(
    principalUserId: string,
    rawInput: ProjectCoordinatorProjectCreateInput
  ): Promise<ProjectCoordinatorProjectCreateInput['createIntentId']> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const owner = userIdSchema.parse(principalUserId)
    const commandDigest = projectCreateCommandDigest(input)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const exact = state.projectCreateIntents.find(({ createIntentId }) => (
        createIntentId === input.createIntentId
      ))
      if (exact) {
        if (exact.principalUserId !== owner || exact.commandDigest !== commandDigest) {
          throw new Error('Project create intent was reused for a different Owner or business command.')
        }
        if (exact.createdProjectId) assertProjectWritable(state, exact.createdProjectId)
        return exact.createIntentId
      }
      const pending = state.projectCreateIntents.find((candidate) => (
        candidate.principalUserId === owner &&
        candidate.commandDigest === commandDigest &&
        candidate.state === 'pending'
      ))
      if (pending) return pending.createIntentId
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        projectCreateIntents: [...state.projectCreateIntents, {
          createIntentId: input.createIntentId,
          principalUserId: owner,
          commandDigest,
          state: 'pending',
          createdProjectId: null
        }]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return input.createIntentId
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to persist the Project create intent.')
  }

  /**
   * Commits the Cloud receipt, Coordinator Session binding, and pending UI
   * activation in one package-settings CAS.
   */
  async commitProjectCreation(
    principalUserId: string,
    rawInput: ProjectCoordinatorProjectCreateInput,
    rawReceipt: ProjectCoordinatorProjectCreateReceipt,
    rawBinding: ProjectCoordinatorCoordinatorSessionBindingRecord,
    rawActivation: ProjectCoordinatorPendingActivation
  ): Promise<ProjectCoordinatorProjectCreationCommit> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const receipt = projectCoordinatorProjectCreateReceiptSchema.parse(rawReceipt)
    const binding = projectCoordinatorCoordinatorSessionBindingRecordSchema.parse(rawBinding)
    const activation = projectCoordinatorPendingActivationSchema.parse(rawActivation)
    const owner = userIdSchema.parse(principalUserId)
    const commandDigest = projectCreateCommandDigest(input)
    if (
      receipt.createIntentId !== input.createIntentId ||
      receipt.createdProjectId !== binding.projectId ||
      binding.principalUserId !== owner ||
      activation.projectId !== binding.projectId ||
      activation.coordinatorSession.runtimeId !== binding.runtimeId ||
      activation.coordinatorSession.threadId !== binding.threadId
    ) {
      throw new Error('Project creation commit facts do not identify one exact Project Session.')
    }
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      assertProjectWritable(state, binding.projectId)
      const intent = state.projectCreateIntents.find(({ createIntentId }) => (
        createIntentId === input.createIntentId
      ))
      if (
        !intent ||
        intent.principalUserId !== owner ||
        intent.commandDigest !== commandDigest
      ) {
        throw new Error('Coordinator Session binding does not match its durable Project create intent.')
      }
      if (intent.createdProjectId !== null && intent.createdProjectId !== binding.projectId) {
        throw new Error('Project create intent resolved to a different Cloud Project.')
      }
      if (
        intent.state === 'succeeded' &&
        intent.createdProjectId &&
        intent.coordinatorSession &&
        intent.activationRequestId
      ) {
        return Object.freeze({
          projectId: intent.createdProjectId,
          coordinatorSession: intent.coordinatorSession,
          activationRequestId: intent.activationRequestId
        })
      }
      const existing = state.coordinatorSessionBindings.find((candidate) => (
        candidate.runtimeId === binding.runtimeId && candidate.threadId === binding.threadId
      ))
      if (existing && (
        existing.projectId !== binding.projectId ||
        existing.principalUserId !== binding.principalUserId ||
        existing.coordinatorAgentId !== binding.coordinatorAgentId ||
        existing.coordinatorAuthorityEpoch !== binding.coordinatorAuthorityEpoch
      )) {
        throw new Error('The ordinary Session is already bound to different Project authority.')
      }
      const authorityBinding = state.coordinatorSessionBindings.find((candidate) => (
        candidate.projectId === binding.projectId &&
        candidate.coordinatorAuthorityEpoch === binding.coordinatorAuthorityEpoch
      ))
      if (authorityBinding && (
        authorityBinding.runtimeId !== binding.runtimeId ||
        authorityBinding.threadId !== binding.threadId
      )) {
        throw new Error('The Project authority already has a Coordinator Session binding.')
      }
      const activationConflict = state.pendingProjectActivations.find((candidate) => (
        candidate.activationRequestId === activation.activationRequestId
      ))
      if (activationConflict && JSON.stringify(activationConflict) !== JSON.stringify(activation)) {
        throw new Error('Project activation request identity conflict.')
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        coordinatorSessionBindings: existing
          ? state.coordinatorSessionBindings
          : [...state.coordinatorSessionBindings, binding],
        projectCreateIntents: state.projectCreateIntents.map((candidate) => (
          candidate.createIntentId === input.createIntentId
            ? {
                ...candidate,
                state: 'succeeded',
                createdProjectId: binding.projectId,
                coordinatorSession: activation.coordinatorSession,
                activationRequestId: activation.activationRequestId
              }
            : candidate
        )),
        pendingProjectActivations: activationConflict
          ? state.pendingProjectActivations
          : [...state.pendingProjectActivations, activation]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return Object.freeze({
          projectId: binding.projectId,
          coordinatorSession: activation.coordinatorSession,
          activationRequestId: activation.activationRequestId
        })
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to atomically commit the created Project Session.')
  }

  async acknowledgeProjectActivation(
    principalUserId: string,
    rawActivationRequestId: string
  ): Promise<void> {
    const owner = userIdSchema.parse(principalUserId)
    const activationRequestId = projectCoordinatorActivationRequestIdSchema.parse(
      rawActivationRequestId
    )
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const intent = state.projectCreateIntents.find((candidate) => (
        candidate.activationRequestId === activationRequestId
      ))
      if (!intent) throw new Error('Project activation request is unknown.')
      if (intent.principalUserId !== owner) {
        throw new Error('Project activation request belongs to a different Principal.')
      }
      if (!state.pendingProjectActivations.some((candidate) => (
        candidate.activationRequestId === activationRequestId
      ))) return
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        pendingProjectActivations: state.pendingProjectActivations.filter((candidate) => (
          candidate.activationRequestId !== activationRequestId
        ))
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to acknowledge the Project activation request.')
  }

  async readCoordinatorTransferFeedback(
    projectId: string
  ): Promise<ProjectCoordinatorTransferFeedback | null> {
    const { state } = await this.read()
    return state.coordinatorTransferFeedback.find((feedback) => (
      feedback.projectId === projectId
    )) ?? null
  }

  async recordCoordinatorTransferFeedback(
    rawFeedback: ProjectCoordinatorTransferFeedback
  ): Promise<ProjectCoordinatorTransferFeedback> {
    const feedback = projectCoordinatorTransferFeedbackSchema.parse(rawFeedback)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = parseState(snapshot)
      assertProjectWritable(state, feedback.projectId)
      const existing = state.coordinatorTransferFeedback.find((candidate) => (
        candidate.projectId === feedback.projectId
      ))
      if (existing?.inboxMessageId === feedback.inboxMessageId) {
        if (JSON.stringify(existing) !== JSON.stringify(feedback)) {
          throw new Error('Coordinator transfer Inbox identity conflict.')
        }
        return existing
      }
      if (existing && existing.coordinatorAuthorityEpoch > feedback.coordinatorAuthorityEpoch) {
        return existing
      }
      if (existing && existing.coordinatorAuthorityEpoch === feedback.coordinatorAuthorityEpoch) {
        throw new Error('Coordinator transfer authority epoch conflict.')
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        coordinatorTransferFeedback: [
          ...state.coordinatorTransferFeedback.filter(({ projectId }) => (
            projectId !== feedback.projectId
          )),
          feedback
        ]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return feedback
      } catch (error) {
        if (attempt > 0) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to persist Coordinator transfer feedback.')
  }

  private async read(): Promise<Readonly<{
    snapshot: DomainMainPackageSettingsSnapshot
    state: ProjectCoordinatorState
  }>> {
    const snapshot = await this.settings.read()
    return Object.freeze({ snapshot, state: parseState(snapshot) })
  }
}

function sameRequirementsCompletionAttempt(
  left: Readonly<{
    projectId: string
    requirementsDocumentId: string
    expectedRequirementsRevision: number
  }>,
  right: Readonly<{
    projectId: string
    requirementsDocumentId: string
    expectedRequirementsRevision: number
  }>
): boolean {
  return left.projectId === right.projectId &&
    left.requirementsDocumentId === right.requirementsDocumentId &&
    left.expectedRequirementsRevision === right.expectedRequirementsRevision
}

function parseState(snapshot: DomainMainPackageSettingsSnapshot): ProjectCoordinatorState {
  if (snapshot.value === null) return EMPTY_STATE
  if (
    typeof snapshot.value !== 'object' ||
    Array.isArray(snapshot.value) ||
    snapshot.value.schemaVersion !== 3
  ) {
    throw new Error(
      'Project Coordinator local state is not schema version 3; clear the obsolete local state before reconnecting to Cloud.'
    )
  }
  return projectCoordinatorStateSchema.parse(snapshot.value)
}

function withoutProjectLocalState(
  state: ProjectCoordinatorState,
  projectId: string
): ProjectCoordinatorState {
  return projectCoordinatorStateSchema.parse({
    ...state,
    requirementsCompletionAttempts: state.requirementsCompletionAttempts.filter((attempt) => (
      attempt.projectId !== projectId
    )),
    coordinatorSessionBindings: state.coordinatorSessionBindings.filter((binding) => (
      binding.projectId !== projectId
    )),
    coordinatorTransferFeedback: state.coordinatorTransferFeedback.filter((feedback) => (
      feedback.projectId !== projectId
    )),
    pendingProjectActivations: state.pendingProjectActivations.filter((activation) => (
      activation.projectId !== projectId
    ))
  })
}

function assertProjectWritable(state: ProjectCoordinatorState, projectId: string): void {
  if (
    state.deletedProjectIds.includes(projectId) ||
    state.projectDeleteIntents.some((intent) => intent.projectId === projectId)
  ) {
    throw new Error('The Project is being deleted or was already deleted.')
  }
}

function projectCreateCommandDigest(input: ProjectCoordinatorProjectCreateInput): string {
  const { createIntentId: _createIntentId, ...businessCommand } = input
  return createHash('sha256').update(stableJson(businessCommand), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}
