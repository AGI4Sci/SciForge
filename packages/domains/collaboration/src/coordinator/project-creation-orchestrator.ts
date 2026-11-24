import { randomUUID } from 'node:crypto'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/agent-execution'

import {
  projectCoordinatorActivationRequestIdSchema,
  projectCoordinatorProjectCreateInputSchema,
  projectCoordinatorProjectCreatePendingReasonSchema,
  projectCoordinatorProjectCreateReceiptSchema,
  projectCoordinatorProjectCreateResultSchema,
  type ProjectCoordinatorOrdinarySession,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorProjectCreateResult
} from './contract.js'
import type { ProjectCoordinatorCloudWorkspacePort } from './ports.js'
import {
  projectCoordinatorCreatedSessionBindingRecord
} from './session-projection.js'
import { ProjectCoordinatorStateStore } from './state.js'
import { projectCoordinatorSessionTitle } from './session-title.js'

export type ProjectCreationRequestContext = Readonly<{
  preferredRuntimeId?: string
  assertPrincipalCurrent: () => void
}>

function projectCreationPreparationFailure(error: unknown) {
  if (!(error instanceof Error)) return null
  // Hosts expose stable failure identity through code or Error.name. Never parse
  // arbitrary messages/serialized handler JSON or treat unknown exceptions as success.
  const code = 'code' in error ? error.code : error.name
  const parsed = projectCoordinatorProjectCreatePendingReasonSchema.safeParse(code)
  return parsed.success ? parsed.data : null
}

export class ProjectCreationOrchestrator {
  private readonly now: () => Date
  private readonly activationRequestId: () => string
  private readonly pendingCreations = new Map<string, Promise<ProjectCoordinatorProjectCreateResult>>()
  private readonly preparedCreations = new Map<string, Promise<Readonly<{
    coordinatorSession: ProjectCoordinatorOrdinarySession
    activationRequestId: string
  }>>>()

  constructor(private readonly options: Readonly<{
    state: ProjectCoordinatorStateStore
    workspace: ProjectCoordinatorCloudWorkspacePort
    getAgentExecution: () => DomainMainAgentExecutionHost | undefined
    currentPrincipalUserId: () => string
    now?: () => Date
    activationRequestId?: () => string
  }>) {
    this.now = options.now ?? (() => new Date())
    this.activationRequestId = options.activationRequestId ?? (() => (
      `pca_${randomUUID().replaceAll('-', '')}`
    ))
  }

  async create(
    rawInput: ProjectCoordinatorProjectCreateInput,
    context: ProjectCreationRequestContext
  ): Promise<ProjectCoordinatorProjectCreateResult> {
    const input = projectCoordinatorProjectCreateInputSchema.parse(rawInput)
    context.assertPrincipalCurrent()
    const principalUserId = this.options.currentPrincipalUserId()
    const createIntentId = await this.options.state.resolveProjectCreateIntent(
      principalUserId,
      input
    )
    context.assertPrincipalCurrent()
    const canonicalInput = projectCoordinatorProjectCreateInputSchema.parse({
      ...input,
      createIntentId
    })
    const key = `${principalUserId}\u0000${createIntentId}`
    const pending = this.pendingCreations.get(key)
    if (pending) {
      const result = await pending
      context.assertPrincipalCurrent()
      return result
    }
    const creation = this.createOnce(canonicalInput, context, principalUserId)
    this.pendingCreations.set(key, creation)
    try {
      return await creation
    } finally {
      if (this.pendingCreations.get(key) === creation) this.pendingCreations.delete(key)
    }
  }

  private async createOnce(
    input: ProjectCoordinatorProjectCreateInput,
    context: ProjectCreationRequestContext,
    principalUserId: string
  ): Promise<ProjectCoordinatorProjectCreateResult> {
    const committed = await this.options.state.readProjectCreationCommit(
      principalUserId,
      input
    )
    if (committed) {
      const workspace = await this.options.workspace.readWorkspace({
        projectId: committed.projectId
      })
      context.assertPrincipalCurrent()
      if (workspace.connection.state !== 'ready' || workspace.connection.userId !== principalUserId) {
        throw new Error('Project creation receipt does not belong to the current Principal.')
      }
      return projectCoordinatorProjectCreateResultSchema.parse({
        createIntentId: input.createIntentId,
        createdProjectId: committed.projectId,
        workspace,
        initializationState: 'ready',
        coordinatorSession: {
          projectId: committed.projectId,
          ...committed.coordinatorSession
        },
        activationRequestId: committed.activationRequestId
      })
    }

    const preparation = await this.options.state.readProjectCreationPreparation(
      principalUserId,
      input
    )
    context.assertPrincipalCurrent()
    const receipt = projectCoordinatorProjectCreateReceiptSchema.parse(preparation?.createdProjectId
      ? {
          createIntentId: input.createIntentId,
          createdProjectId: preparation.createdProjectId,
          workspace: await this.options.workspace.readWorkspace({ projectId: preparation.createdProjectId })
        }
      : await this.options.workspace.createProject(input))
    context.assertPrincipalCurrent()
    if (receipt.workspace.connection.state !== 'ready' || receipt.workspace.connection.userId !== principalUserId) {
      throw new Error('Project creation receipt does not belong to the current Principal.')
    }
    await this.options.state.persistProjectCreationReceipt(principalUserId, input, receipt)
    context.assertPrincipalCurrent()
    let coordinatorSession = preparation?.createdProjectId === receipt.createdProjectId
      ? preparation.coordinatorSession
      : null
    let activationRequestId = preparation?.createdProjectId === receipt.createdProjectId
      ? preparation.activationRequestId
      : null
    if (!coordinatorSession || !activationRequestId) {
      const preparationKey = `${principalUserId}\u0000${input.createIntentId}`
      let pendingPreparation = this.preparedCreations.get(preparationKey)
      if (!pendingPreparation) {
        const prepareSession = this.options.getAgentExecution()?.prepareSession
        if (!prepareSession) {
          context.assertPrincipalCurrent()
          return projectCoordinatorProjectCreateResultSchema.parse({
            ...receipt,
            initializationState: 'session_pending',
            reason: 'session_preparation_unavailable'
          })
        }
        const createdPreparation = (async (): Promise<Readonly<{
          coordinatorSession: ProjectCoordinatorOrdinarySession
          activationRequestId: string
        }>> => {
          const preparedSession = await prepareSession({
            ...(context.preferredRuntimeId
              ? { runtimeId: context.preferredRuntimeId }
              : {}),
            title: projectCoordinatorSessionTitle(input.displayName, '项目协调'),
            interaction: 'reviewable',
            mode: 'agent'
          })
          context.assertPrincipalCurrent()
          return Object.freeze({
            coordinatorSession: preparedSession,
            activationRequestId: this.activationRequestId()
          })
        })()
        pendingPreparation = createdPreparation
        this.preparedCreations.set(preparationKey, createdPreparation)
      }
      const preparationPromise = pendingPreparation
      if (!preparationPromise) {
        throw new Error('Project creation preparation was not scheduled.')
      }
      let pendingValues: Awaited<typeof preparationPromise>
      try {
        pendingValues = await preparationPromise
      } catch (error) {
        if (this.preparedCreations.get(preparationKey) === preparationPromise) {
          this.preparedCreations.delete(preparationKey)
        }
        // A Principal change always wins over a recoverable local failure.
        context.assertPrincipalCurrent()
        const reason = projectCreationPreparationFailure(error)
        if (!reason) throw error
        return projectCoordinatorProjectCreateResultSchema.parse({
          ...receipt,
          initializationState: 'session_pending',
          reason
        })
      }
      coordinatorSession = pendingValues.coordinatorSession
      activationRequestId = pendingValues.activationRequestId
      const persisted = await this.options.state.persistProjectCreationPreparation(
        principalUserId,
        input,
        receipt,
        coordinatorSession,
        activationRequestId
      )
      coordinatorSession = persisted.coordinatorSession
      activationRequestId = persisted.activationRequestId
      if (!coordinatorSession || !activationRequestId) {
        throw new Error('Project creation preparation was not persisted completely.')
      }
      context.assertPrincipalCurrent()
    }
    const canonicalInput = projectCoordinatorProjectCreateInputSchema.parse({
      ...input,
      createIntentId: receipt.createIntentId
    })
    const binding = projectCoordinatorCreatedSessionBindingRecord(
      receipt,
      coordinatorSession,
      this.now()
    )
    const canonicalActivationRequestId = projectCoordinatorActivationRequestIdSchema.parse(
      activationRequestId
    )
    const commit = await this.options.state.commitProjectCreation(
      principalUserId,
      canonicalInput,
      receipt,
      binding,
      {
        activationRequestId: canonicalActivationRequestId,
        projectId: receipt.createdProjectId,
        coordinatorSession,
        requestedAt: this.now().toISOString()
      }
    )
    context.assertPrincipalCurrent()
    this.preparedCreations.delete(`${principalUserId}\u0000${input.createIntentId}`)
    return projectCoordinatorProjectCreateResultSchema.parse({
      ...receipt,
      initializationState: 'ready',
      coordinatorSession: {
        projectId: commit.projectId,
        ...commit.coordinatorSession
      },
      activationRequestId: commit.activationRequestId
    })
  }

  async acknowledgeActivation(
    activationRequestId: string,
    assertPrincipalCurrent: () => void
  ): Promise<void> {
    assertPrincipalCurrent()
    await this.options.state.acknowledgeProjectActivation(
      this.options.currentPrincipalUserId(),
      activationRequestId
    )
    assertPrincipalCurrent()
  }
}
