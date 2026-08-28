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
  projectCoordinatorCoordinatorSessionBindingRecordSchema,
  projectCoordinatorTransferFeedbackSchema,
  type ProjectCoordinatorCoordinatorSessionBindingRecord,
  type ProjectCoordinatorPlanDraft,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorTransferFeedback
} from './contract.js'

const projectCreateIntentRecordSchema = z.object({
  createIntentId: projectCoordinatorProjectCreateInputSchema.unwrap().shape.createIntentId,
  principalUserId: userIdSchema,
  commandDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(['pending', 'succeeded']),
  createdProjectId: projectIdSchema.nullable()
}).strict().readonly()

const projectCoordinatorStateSchema = z.object({
  schemaVersion: z.literal(2),
  planDrafts: z.array(projectCoordinatorPlanDraftSchema).max(1_000),
  coordinatorSessionBindings: z.array(
    projectCoordinatorCoordinatorSessionBindingRecordSchema
  ).max(10_000).default([]),
  coordinatorTransferFeedback: z.array(projectCoordinatorTransferFeedbackSchema)
    .max(1_000)
    .default([]),
  projectCreateIntents: z.array(projectCreateIntentRecordSchema)
    .max(10_000)
    .default([])
}).strict().readonly()

type ProjectCoordinatorState = z.infer<typeof projectCoordinatorStateSchema>

const EMPTY_STATE: ProjectCoordinatorState = {
  schemaVersion: 2,
  planDrafts: [],
  coordinatorSessionBindings: [],
  coordinatorTransferFeedback: [],
  projectCreateIntents: []
}

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

  async recordProjectCreateSucceeded(
    principalUserId: string,
    rawInput: ProjectCoordinatorProjectCreateInput,
    projectId: string
  ): Promise<void> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const owner = userIdSchema.parse(principalUserId)
    const createdProjectId = projectIdSchema.parse(projectId)
    const commandDigest = projectCreateCommandDigest(input)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const current = state.projectCreateIntents.find(({ createIntentId }) => (
        createIntentId === input.createIntentId
      ))
      if (!current || current.principalUserId !== owner || current.commandDigest !== commandDigest) {
        throw new Error('Project create success does not match its durable business intent.')
      }
      if (current.state === 'succeeded') {
        if (current.createdProjectId !== createdProjectId) {
          throw new Error('Project create intent resolved to a different Cloud Project.')
        }
        return
      }
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        projectCreateIntents: state.projectCreateIntents.map((candidate) => (
          candidate.createIntentId === input.createIntentId
            ? { ...candidate, state: 'succeeded', createdProjectId }
            : candidate
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
    throw new Error('Unable to persist the successful Project create intent.')
  }

  async bindCoordinatorSession(
    rawBinding: ProjectCoordinatorCoordinatorSessionBindingRecord
  ): Promise<ProjectCoordinatorCoordinatorSessionBindingRecord> {
    const binding = projectCoordinatorCoordinatorSessionBindingRecordSchema.parse(rawBinding)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const existing = state.coordinatorSessionBindings.find((candidate) => (
        candidate.runtimeId === binding.runtimeId &&
        candidate.threadId === binding.threadId
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
    throw new Error('Unable to persist the ordinary Coordinator Session binding.')
  }

  /**
   * Commits the canonical create receipt and its ordinary Coordinator Session
   * binding in one package-settings CAS. There is no durable state where the
   * intent is terminal but the exact Session is still unbound.
   */
  async bindCoordinatorSessionForCreatedProject(
    rawInput: ProjectCoordinatorProjectCreateInput,
    rawBinding: ProjectCoordinatorCoordinatorSessionBindingRecord
  ): Promise<ProjectCoordinatorCoordinatorSessionBindingRecord> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    const binding = projectCoordinatorCoordinatorSessionBindingRecordSchema.parse(rawBinding)
    const commandDigest = projectCreateCommandDigest(input)
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = parseState(snapshot)
      const intent = state.projectCreateIntents.find(({ createIntentId }) => (
        createIntentId === input.createIntentId
      ))
      if (
        !intent ||
        intent.principalUserId !== binding.principalUserId ||
        intent.commandDigest !== commandDigest
      ) {
        throw new Error('Coordinator Session binding does not match its durable Project create intent.')
      }
      if (intent.createdProjectId !== null && intent.createdProjectId !== binding.projectId) {
        throw new Error('Project create intent resolved to a different Cloud Project.')
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
      if (existing && intent.state === 'succeeded') return existing
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        coordinatorSessionBindings: existing
          ? state.coordinatorSessionBindings
          : [...state.coordinatorSessionBindings, binding],
        projectCreateIntents: state.projectCreateIntents.map((candidate) => (
          candidate.createIntentId === input.createIntentId
            ? { ...candidate, state: 'succeeded', createdProjectId: binding.projectId }
            : candidate
        ))
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return existing ?? binding
      } catch (error) {
        if (attempt >= 2) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to atomically bind the created Project Session.')
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
    : projectCoordinatorStateSchema.parse(snapshot.value)
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
