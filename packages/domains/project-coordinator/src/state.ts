import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  projectIdSchema,
  userIdSchema,
  type ProjectPlan
} from '@sciforge/collaboration-contracts'
import type {
  DomainMainPackageSettingsHost,
  DomainMainPackageSettingsSnapshot
} from '@sciforge/domain-sdk/package-storage'

import {
  projectCoordinatorPlanDraftSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreateReceiptSchema,
  projectCoordinatorCoordinatorSessionBindingRecordSchema,
  projectCoordinatorActivationRequestIdSchema,
  projectCoordinatorOrdinarySessionSchema,
  projectCoordinatorPendingActivationSchema,
  projectCoordinatorTransferFeedbackSchema,
  type ProjectCoordinatorCoordinatorSessionBindingRecord,
  type ProjectCoordinatorOrdinarySession,
  type ProjectCoordinatorPendingActivation,
  type ProjectCoordinatorPlanDraft,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateReceipt,
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

const projectCoordinatorStateSchema = z.object({
  schemaVersion: z.literal(3),
  planDrafts: z.array(projectCoordinatorPlanDraftSchema).max(1_000),
  coordinatorSessionBindings: z.array(
    projectCoordinatorCoordinatorSessionBindingRecordSchema
  ).max(10_000).default([]),
  coordinatorTransferFeedback: z.array(projectCoordinatorTransferFeedbackSchema)
    .max(1_000)
    .default([]),
  projectCreateIntents: z.array(projectCreateIntentRecordSchema)
    .max(10_000)
    .default([]),
  pendingProjectActivations: z.array(projectCoordinatorPendingActivationSchema)
    .max(10_000)
    .default([])
}).strict().readonly()

type ProjectCoordinatorState = z.infer<typeof projectCoordinatorStateSchema>

const EMPTY_STATE: ProjectCoordinatorState = {
  schemaVersion: 3,
  planDrafts: [],
  coordinatorSessionBindings: [],
  coordinatorTransferFeedback: [],
  projectCreateIntents: [],
  pendingProjectActivations: []
}

export type ProjectCoordinatorProjectCreationCommit = Readonly<{
  projectId: string
  coordinatorSession: ProjectCoordinatorOrdinarySession
  activationRequestId: string
}>

export class ProjectCoordinatorStateStore {
  constructor(private readonly settings: DomainMainPackageSettingsHost) {}

  async readDraft(projectId: string): Promise<ProjectCoordinatorPlanDraft | null> {
    const { state } = await this.read()
    return state.planDrafts.find((draft) => draft.projectId === projectId) ?? null
  }

  async readCoordinatorSessionBindings(): Promise<
    readonly ProjectCoordinatorCoordinatorSessionBindingRecord[]
  > {
    const { state } = await this.read()
    return state.coordinatorSessionBindings
  }

  async readPendingProjectActivations(): Promise<readonly ProjectCoordinatorPendingActivation[]> {
    const { state } = await this.read()
    return state.pendingProjectActivations
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

  async writeDraft(
    next: ProjectCoordinatorPlanDraft,
    expectedDraftRevision: number | null
  ): Promise<ProjectCoordinatorPlanDraft> {
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = parseState(snapshot)
      const current = state.planDrafts.find((draft) => draft.projectId === next.projectId) ?? null
      if ((current?.draftRevision ?? null) !== expectedDraftRevision) {
        throw new Error('Plan draft revision conflict.')
      }
      const draft = projectCoordinatorPlanDraftSchema.parse(next)
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        planDrafts: [
          ...state.planDrafts.filter(({ projectId }) => projectId !== draft.projectId),
          draft
        ]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return draft
      } catch (error) {
        if (attempt > 0) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to persist the Plan draft.')
  }

  async completeSubmittedDraft(
    plan: ProjectPlan,
    expectedDraftRevision: number
  ): Promise<void> {
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = parseState(snapshot)
      const current = state.planDrafts.find((draft) => draft.projectId === plan.projectId) ?? null
      if (!current) return
      if (current.draftRevision !== expectedDraftRevision) {
        throw new Error('Plan draft revision conflict.')
      }
      const planTasksById = new Map(plan.tasks.map((task) => [task.planItemId, task]))
      if (
        current.assignments.length !== planTasksById.size ||
        current.assignments.some(({ planItemId, workerUserId }) => (
          workerUserId === null || planTasksById.get(planItemId)?.workerUserId !== workerUserId
        ))
      ) {
        throw new Error('Submitted Plan does not match the exact selected Worker Users.')
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        planDrafts: state.planDrafts.filter((draft) => draft.projectId !== plan.projectId)
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return
      } catch (error) {
        if (attempt > 0) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to clear the submitted Plan draft.')
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

function parseState(snapshot: DomainMainPackageSettingsSnapshot): ProjectCoordinatorState {
  return snapshot.value === null
    ? EMPTY_STATE
    : projectCoordinatorStateSchema.parse(migrateState(snapshot.value))
}

/**
 * State v2 stored the then-canonical v1 file declaration and did not retain
 * the Session/activation identity on a succeeded create intent. Recover that
 * identity only when the intent has one exact Owner/Project binding. All
 * migrated facts remain subject to the strict current schema.
 */
function migrateState(value: unknown): unknown {
  if (!isRecord(value) || value.schemaVersion !== 2) return value
  const bindings = Array.isArray(value.coordinatorSessionBindings)
    ? value.coordinatorSessionBindings
    : []
  const creationMigrations = Array.isArray(value.projectCreateIntents)
    ? value.projectCreateIntents.map((intent) => migrateProjectCreateIntent(intent, bindings))
    : null
  return {
    ...value,
    schemaVersion: 3,
    planDrafts: Array.isArray(value.planDrafts)
      ? value.planDrafts.map(migratePlanDraft)
      : value.planDrafts,
    projectCreateIntents: creationMigrations
      ? creationMigrations.map(({ intent }) => intent)
      : value.projectCreateIntents,
    pendingProjectActivations: creationMigrations
      ? creationMigrations.flatMap(({ activation }) => activation ? [activation] : [])
      : []
  }
}

function migrateProjectCreateIntent(
  value: unknown,
  bindings: readonly unknown[]
): Readonly<{ intent: unknown; activation: unknown | null }> {
  if (
    !isRecord(value) ||
    value.state !== 'succeeded' ||
    typeof value.createdProjectId !== 'string' ||
    typeof value.principalUserId !== 'string' ||
    typeof value.createIntentId !== 'string'
  ) return { intent: value, activation: null }
  const matchingBindings = bindings.filter((binding) => (
    isRecord(binding) &&
    binding.projectId === value.createdProjectId &&
    binding.principalUserId === value.principalUserId
  ))
  if (matchingBindings.length > 1) {
    throw new Error('Legacy Project creation has ambiguous Coordinator Session bindings.')
  }
  const binding = matchingBindings[0]
  if (!binding || !isRecord(binding)) return { intent: value, activation: null }
  const coordinatorSession = {
    runtimeId: binding.runtimeId,
    threadId: binding.threadId
  }
  const activationRequestId = migratedActivationRequestId(value, binding)
  return {
    intent: {
      ...value,
      coordinatorSession,
      activationRequestId
    },
    activation: {
      activationRequestId,
      projectId: value.createdProjectId,
      coordinatorSession,
      requestedAt: binding.boundAt
    }
  }
}

function migratedActivationRequestId(
  intent: Record<string, unknown>,
  binding: Record<string, unknown>
): string {
  const stableFacts = {
    createIntentId: intent.createIntentId,
    principalUserId: intent.principalUserId,
    projectId: intent.createdProjectId,
    runtimeId: binding.runtimeId,
    threadId: binding.threadId
  }
  return `pca_${createHash('sha256')
    .update(stableJson(stableFacts), 'utf8')
    .digest('hex')
    .slice(0, 32)}`
}

function migratePlanDraft(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.tasks)) return value
  return {
    ...value,
    tasks: value.tasks.map((task) => {
      if (!isRecord(task) || !isRecord(task.fileIntent)) return task
      if (
        task.fileIntent.schemaVersion !== 1 ||
        Object.hasOwn(task.fileIntent, 'dependencyInputs')
      ) return task
      return {
        ...task,
        fileIntent: {
          ...task.fileIntent,
          schemaVersion: 2,
          dependencyInputs: []
        }
      }
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
