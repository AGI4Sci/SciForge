import { z } from 'zod'
import { projectPlanSchema, type ProjectPlan } from '@sciforge/collaboration-contracts'
import type {
  DomainMainPackageSettingsHost,
  DomainMainPackageSettingsSnapshot
} from '@sciforge/domain-sdk/package-storage'

import {
  projectCoordinatorPlanAssignmentSchema,
  projectCoordinatorPlanDraftSchema,
  type ProjectCoordinatorPlanAssignment,
  type ProjectCoordinatorPlanDraft
} from './contract.js'

const submittedPlanSelectionSchema = z.object({
  projectId: projectPlanSchema.shape.projectId,
  projectPlanId: projectPlanSchema.shape.projectPlanId,
  planDigest: projectPlanSchema.shape.planDigest,
  assignments: z.array(projectCoordinatorPlanAssignmentSchema).min(1).max(1_000)
}).strict().readonly()

const projectCoordinatorStateSchema = z.object({
  schemaVersion: z.literal(1),
  planDrafts: z.array(projectCoordinatorPlanDraftSchema).max(1_000),
  submittedPlanSelections: z.array(submittedPlanSelectionSchema).max(1_000)
}).strict().readonly()

type ProjectCoordinatorState = z.infer<typeof projectCoordinatorStateSchema>

const EMPTY_STATE: ProjectCoordinatorState = {
  schemaVersion: 1,
  planDrafts: [],
  submittedPlanSelections: []
}

export class ProjectCoordinatorStateStore {
  constructor(private readonly settings: DomainMainPackageSettingsHost) {}

  async readDraft(projectId: string): Promise<ProjectCoordinatorPlanDraft | null> {
    const { state } = await this.read()
    return state.planDrafts.find((draft) => draft.projectId === projectId) ?? null
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

  async commitSubmittedDraft(
    plan: ProjectPlan,
    expectedDraftRevision: number
  ): Promise<readonly ProjectCoordinatorPlanAssignment[]> {
    let snapshot = await this.settings.read()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const state = parseState(snapshot)
      const existing = state.submittedPlanSelections.find(
        ({ projectPlanId }) => projectPlanId === plan.projectPlanId
      )
      if (existing) {
        if (existing.planDigest !== plan.planDigest || existing.projectId !== plan.projectId) {
          throw new Error('Submitted Plan selection identity conflict.')
        }
        return existing.assignments
      }
      const current = state.planDrafts.find((draft) => draft.projectId === plan.projectId) ?? null
      if (!current) throw new Error('Plan draft was not found.')
      if (current.draftRevision !== expectedDraftRevision) {
        throw new Error('Plan draft revision conflict.')
      }
      const planItemIds = new Set(plan.tasks.map(({ planItemId }) => planItemId))
      if (
        current.assignments.length !== planItemIds.size ||
        current.assignments.some(({ planItemId }) => !planItemIds.has(planItemId))
      ) {
        throw new Error('Submitted Plan does not match the exact local assignment projection.')
      }
      const selection = submittedPlanSelectionSchema.parse({
        projectId: plan.projectId,
        projectPlanId: plan.projectPlanId,
        planDigest: plan.planDigest,
        assignments: current.assignments
      })
      const value = projectCoordinatorStateSchema.parse({
        ...state,
        planDrafts: state.planDrafts.filter((draft) => draft.projectId !== plan.projectId),
        submittedPlanSelections: [
          ...state.submittedPlanSelections.filter(({ projectId }) => projectId !== plan.projectId),
          selection
        ]
      })
      try {
        await this.settings.write(value, snapshot.revision)
        return selection.assignments
      } catch (error) {
        if (attempt > 0) throw error
        snapshot = await this.settings.read()
      }
    }
    throw new Error('Unable to retain the submitted Plan assignment projection.')
  }

  async readPlanAssignments(
    projectPlanId: string,
    planDigest: string
  ): Promise<readonly ProjectCoordinatorPlanAssignment[]> {
    const { state } = await this.read()
    const selection = state.submittedPlanSelections.find((candidate) => (
      candidate.projectPlanId === projectPlanId && candidate.planDigest === planDigest
    ))
    return selection?.assignments ?? []
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
