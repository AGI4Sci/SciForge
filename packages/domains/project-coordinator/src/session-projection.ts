import type { DomainMainOrdinarySessionIdentity } from '@sciforge/domain-sdk/host'
import type {
  WorkerSessionExecutionBinding,
  WorkerSessionProjectionService
} from '@sciforge/domain-collaboration/worker-session-projection'

import {
  projectCoordinatorCoordinatorSessionBindingRecordSchema,
  projectCoordinatorCoordinatorSessionBindingSchema,
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorWorkerSessionBindingSchema,
  type ProjectCoordinatorCoordinatorSessionBindingRecord,
  type ProjectCoordinatorProjectCreateReceipt,
  type ProjectCoordinatorSessionBinding,
  type ProjectCoordinatorSessionProjection,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

export type ProjectCoordinatorSessionAccess = 'coordinator' | 'member'

/**
 * Authorization returned for an explicit Project target.
 *
 * A Project target is intentionally independent from an ordinary Session
 * binding.  For an otherwise unbound Session, authorization is represented
 * directly by the current authenticated Principal's access.  Bound
 * Coordinator/Worker sessions retain their durable role and execution fences.
 */
export type ProjectCoordinatorSessionAuthorization = Readonly<{
  projectId: string
  principalUserId: string
  access: 'coordinator' | 'worker' | 'member' | 'read_only'
  fenceReason: ProjectCoordinatorSessionBinding['fenceReason']
}>

export type ProjectCoordinatorSessionProjectionPort = Readonly<{
  readProjection(
    session?: DomainMainOrdinarySessionIdentity
  ): Promise<ProjectCoordinatorSessionProjection>
  scopeWorkspaceRead(
    input: ProjectCoordinatorWorkspaceReadInput,
    session: DomainMainOrdinarySessionIdentity
  ): Promise<ProjectCoordinatorWorkspaceReadInput>
  authorize(
    projectId: string,
    session: DomainMainOrdinarySessionIdentity,
    requiredAccess: ProjectCoordinatorSessionAccess
  ): Promise<ProjectCoordinatorSessionAuthorization>
  authorizeInvitationAcceptance(
    projectId: string,
    session: DomainMainOrdinarySessionIdentity
  ): Promise<void>
}>

export function createProjectCoordinatorSessionProjectionPort(options: Readonly<{
  state: ProjectCoordinatorStateStore
  workspace: ProjectCoordinatorWorkspacePort
  workers: WorkerSessionProjectionService
  now?: () => Date
}>): ProjectCoordinatorSessionProjectionPort {
  const now = options.now ?? (() => new Date())

  /**
   * Find a durable binding only when it targets the explicit Project.  A
   * binding for another Project must not make an otherwise authorized Session
   * unable to operate the Project currently selected in the workbench.
   */
  const localBindingForProject = (
    session: DomainMainOrdinarySessionIdentity,
    projectId: string
  ): ProjectCoordinatorCoordinatorSessionBindingRecord | WorkerSessionExecutionBinding | undefined => {
    const coordinators = coordinatorSnapshot.get()
    const workers = options.workers.listBindings()
    const matches = [
      ...coordinators.filter((candidate) => (
        candidate.projectId === projectId && sameSession(candidate, session)
      )),
      ...workers.filter((candidate) => (
        candidate.projectId === projectId && sameSession(candidate, session)
      ))
    ]
    if (matches.length > 1) {
      throw new Error('The ordinary Session has conflicting Project bindings.')
    }
    return matches[0]
  }

  const coordinatorSnapshot = createCoordinatorBindingSnapshot(options.state)

  const readProjectWorkspace = async (
    projectId: string
  ): Promise<ProjectCoordinatorWorkspace | undefined> => {
    try {
      return await options.workspace.readWorkspace({ projectId })
    } catch {
      return undefined
    }
  }

  const readAuthorizedPrincipalProject = async (
    projectId: string
  ): Promise<Readonly<{
    workspace: ProjectCoordinatorWorkspace
    project: ProjectCoordinatorWorkspace['projects'][number]
    principalUserId: string
  }>> => {
    const workspace = await readProjectWorkspace(projectId)
    if (!workspace || workspace.connection.state !== 'ready') {
      throw new Error('The exact Project is not visible to the current authenticated Principal.')
    }
    const project = workspace.projects.find(({ project: candidate }) => (
      candidate.projectId === projectId
    ))
    if (!project) {
      throw new Error('The exact Project is not visible to the current authenticated Principal.')
    }
    const principalUserId = workspace.connection.userId
    return { workspace, project, principalUserId }
  }

  const principalAuthorization = (
    projectId: string,
    principalUserId: string,
    project: ProjectCoordinatorWorkspace['projects'][number]
  ): ProjectCoordinatorSessionAuthorization => {
    const membership = project.provisioning.memberships.find(({ userId }) => (
      userId === principalUserId
    ))
    const fenceReason = membership?.state !== 'active'
      ? 'membership_inactive' as const
      : ['completed', 'cancelled'].includes(project.project.status)
        ? 'project_terminal' as const
        : null
    return Object.freeze({
      projectId,
      principalUserId,
      access: fenceReason
        ? 'read_only' as const
        : project.project.ownerUserId === principalUserId
          ? 'coordinator' as const
          : 'member' as const,
      fenceReason
    })
  }

  const evaluate = (
    binding: ProjectCoordinatorCoordinatorSessionBindingRecord | WorkerSessionExecutionBinding,
    workspace: ProjectCoordinatorWorkspace | undefined
  ): ProjectCoordinatorSessionBinding => (
    isCoordinatorBinding(binding)
      ? evaluateCoordinatorBinding(binding, workspace)
      : evaluateWorkerBinding(binding, workspace)
  )

  const readProjection = async (
    session?: DomainMainOrdinarySessionIdentity
  ): Promise<ProjectCoordinatorSessionProjection> => {
    await coordinatorSnapshot.refresh()
    const identityWorkspace = await readProjectWorkspaceForIdentity(options.workspace)
    if (!identityWorkspace || identityWorkspace.connection.state !== 'ready') {
      return projectCoordinatorSessionProjectionSchema.parse({
        schemaVersion: 1,
        observedAt: now().toISOString(),
        bindings: [],
        pendingActivations: []
      })
    }
    const currentUserId = identityWorkspace.connection.userId
    const conflictFree = withoutSessionConflicts([
      ...coordinatorSnapshot.get(),
      ...options.workers.listBindings()
    ])
    const local = conflictFree.filter((binding) => (
      isCoordinatorBinding(binding)
        ? binding.principalUserId === currentUserId
        : binding.workerUserId === currentUserId
    )).filter((binding) => !session || sameSession(binding, session))
    const workspaces = new Map<string, ProjectCoordinatorWorkspace | undefined>()
    await Promise.all([...new Set(local.map(({ projectId }) => projectId))].map(
      async (projectId) => {
        workspaces.set(projectId, await readProjectWorkspace(projectId))
      }
    ))
    const visible = local.map((binding) => (
      evaluate(binding, workspaces.get(binding.projectId))
    )).filter(isPubliclyVisibleBinding)
    const visibleSessionKeys = new Set(visible.map(({ projectId, runtimeId, threadId }) => (
      `${projectId}\u0000${runtimeId}\u0000${threadId}`
    )))
    const pendingActivations = (await options.state.readPendingProjectActivations()).filter((activation) => (
      visibleSessionKeys.has(
        `${activation.projectId}\u0000${activation.coordinatorSession.runtimeId}\u0000${activation.coordinatorSession.threadId}`
      )
    ))
    return projectCoordinatorSessionProjectionSchema.parse({
      schemaVersion: 1,
      observedAt: now().toISOString(),
      bindings: visible,
      pendingActivations
    })
  }

  return Object.freeze({
    readProjection,
    scopeWorkspaceRead: async (input, session) => {
      await coordinatorSnapshot.refresh()
      if (!input.projectId) {
        // An unbound Session may enumerate the current Principal's visible
        // Projects.  The workspace port itself applies the authenticated
        // Principal's listing boundary; no Session binding is required.
        return Object.freeze({})
      }
      const { workspace } = await readAuthorizedPrincipalProject(
        input.projectId
      )
      const binding = localBindingForProject(session, input.projectId)
      // Read access remains available for a fenced/terminal binding.  The
      // workspace port returns current canonical facts; only write commands
      // below enforce Coordinator/Member authority.  Evaluate a matching
      // binding to preserve the exact target-project lookup and avoid using a
      // binding from another Project, but do not turn a read into a write gate.
      if (binding) evaluate(binding, workspace)
      return Object.freeze({ projectId: input.projectId })
    },
    authorize: async (projectId, session, requiredAccess) => {
      await coordinatorSnapshot.refresh()
      const { workspace, project, principalUserId } = await readAuthorizedPrincipalProject(projectId)
      const binding = localBindingForProject(session, projectId)
      const evaluated = binding
        ? evaluate(binding, workspace)
        : principalAuthorization(projectId, principalUserId, project)
      if (requiredAccess === 'coordinator' && evaluated.access !== 'coordinator') {
        throw new Error('The ordinary Session does not hold current Coordinator authority.')
      }
      if (requiredAccess === 'member' && evaluated.access === 'read_only') {
        throw new Error(`The ordinary Session is fenced: ${evaluated.fenceReason}.`)
      }
      return evaluated
    },
    authorizeInvitationAcceptance: async (projectId, _session) => {
      // Invitation acceptance is an explicit Project operation.  It is
      // authorized from the current authenticated Principal and does not
      // depend on whichever Project (if any) this Session previously ran.
      const workspace = await options.workspace.readWorkspace({ projectId })
      if (workspace.connection.state !== 'ready') {
        throw new Error('Project invitation acceptance requires the current authenticated Principal.')
      }
      const currentUserId = workspace.connection.userId
      const project = exactProject(workspace, projectId)
      const membership = project.provisioning.memberships.find(({ userId }) => (
        userId === currentUserId
      ))
      if (!membership || !['invited', 'pending_membership', 'active'].includes(membership.state)) {
        throw new Error('The current Principal has no invitation for this Project.')
      }
    }
  })
}

export function projectCoordinatorCreatedSessionBindingRecord(
  receipt: ProjectCoordinatorProjectCreateReceipt,
  session: DomainMainOrdinarySessionIdentity,
  now: Date = new Date()
): ProjectCoordinatorCoordinatorSessionBindingRecord {
  const projectId = receipt.createdProjectId
  const workspace = receipt.workspace
  if (workspace.connection.state !== 'ready') {
    throw new Error('Coordinator Session binding requires the current authenticated Principal.')
  }
  const currentUserId = workspace.connection.userId
  const project = exactProject(workspace, projectId)
  const membership = project.provisioning.memberships.find(({ userId }) => (
    userId === currentUserId
  ))
  if (
    project.project.ownerUserId !== currentUserId ||
    membership?.state !== 'active' ||
    ['completed', 'cancelled'].includes(project.project.status)
  ) {
    throw new Error('Only the active Project Owner can bind a Coordinator Session.')
  }
  return projectCoordinatorCoordinatorSessionBindingRecordSchema.parse({
    schemaVersion: 1,
    role: 'coordinator',
    projectId,
    principalUserId: currentUserId,
    coordinatorAgentId: project.project.coordinatorAgentId,
    coordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    runtimeId: session.runtimeId,
    threadId: session.threadId,
    boundAt: now.toISOString()
  })
}

function evaluateCoordinatorBinding(
  binding: ProjectCoordinatorCoordinatorSessionBindingRecord,
  workspace: ProjectCoordinatorWorkspace | undefined
) {
  if (!workspace || workspace.connection.state !== 'ready') {
    return projectCoordinatorCoordinatorSessionBindingSchema.parse({
      ...binding, access: 'read_only', fenceReason: 'project_unavailable'
    })
  }
  const currentUserId = workspace.connection.userId
  const project = workspace.projects.find(({ project }) => project.projectId === binding.projectId)
  if (!project) {
    return projectCoordinatorCoordinatorSessionBindingSchema.parse({
      ...binding, access: 'read_only', fenceReason: 'project_unavailable'
    })
  }
  const membership = project.provisioning.memberships.find(({ userId }) => (
    userId === currentUserId
  ))
  const reason = currentUserId !== binding.principalUserId ||
      project.project.ownerUserId !== binding.principalUserId
    ? 'principal_changed'
    : membership?.state !== 'active'
      ? 'membership_inactive'
      : ['completed', 'cancelled'].includes(project.project.status)
        ? 'project_terminal'
        : project.project.coordinatorAgentId !== binding.coordinatorAgentId ||
            project.project.coordinatorAuthorityEpoch !== binding.coordinatorAuthorityEpoch
          ? 'authority_changed'
          : null
  return projectCoordinatorCoordinatorSessionBindingSchema.parse({
    ...binding,
    access: reason ? 'read_only' : 'coordinator',
    fenceReason: reason
  })
}

function evaluateWorkerBinding(
  binding: WorkerSessionExecutionBinding,
  workspace: ProjectCoordinatorWorkspace | undefined
) {
  let reason: 'execution_fenced' | 'execution_not_current' | 'membership_inactive' |
    'principal_changed' | 'project_terminal' | 'project_unavailable' | null = null
  const project = workspace?.projects.find(({ project }) => (
    project.projectId === binding.projectId
  ))
  if (!workspace || workspace.connection.state !== 'ready' || !project) {
    reason = 'project_unavailable'
  } else if (workspace.connection.userId !== binding.workerUserId) {
    reason = 'principal_changed'
  } else if (project.provisioning.memberships.find(({ userId }) => (
    userId === binding.workerUserId
  ))?.state !== 'active') {
    reason = 'membership_inactive'
  } else if (['completed', 'cancelled'].includes(project.project.status)) {
    reason = 'project_terminal'
  } else {
    const task = project.tasks.find(({ task }) => task.taskId === binding.taskId)
    const execution = task?.executions.find(({ executionId }) => (
      executionId === binding.executionId
    ))
    if (
      !task || !execution ||
      task.task.currentExecutionId !== binding.executionId ||
      task.task.revision !== binding.taskRevision ||
      execution.revision !== binding.executionRevision ||
      execution.assigneeUserId !== binding.workerUserId ||
      execution.assigneeAgentId !== binding.assigneeAgentId ||
      execution.assigneeDeviceId !== binding.assigneeDeviceId ||
      execution.fence.projectExecutionAuthorityEpoch !==
        binding.projectExecutionAuthorityEpoch ||
      execution.fence.userTaskAuthorityEpoch !== binding.userTaskAuthorityEpoch ||
      project.project.executionAuthorityEpoch !== binding.projectExecutionAuthorityEpoch
    ) {
      reason = 'execution_not_current'
    } else if (execution.fence.status !== 'open' || binding.fenceStatus !== 'open') {
      reason = 'execution_fenced'
    } else if (execution.state !== binding.executionState) {
      reason = 'execution_not_current'
    }
  }
  return projectCoordinatorWorkerSessionBindingSchema.parse({
    schemaVersion: 1,
    role: 'worker',
    projectId: binding.projectId,
    taskId: binding.taskId,
    executionId: binding.executionId,
    principalUserId: binding.workerUserId,
    assigneeAgentId: binding.assigneeAgentId,
    assigneeDeviceId: binding.assigneeDeviceId,
    runtimeId: binding.runtimeId,
    threadId: binding.threadId,
    taskRevision: binding.taskRevision,
    executionRevision: binding.executionRevision,
    projectExecutionAuthorityEpoch: binding.projectExecutionAuthorityEpoch,
    userTaskAuthorityEpoch: binding.userTaskAuthorityEpoch,
    access: reason ? 'read_only' : 'worker',
    fenceReason: reason,
    updatedAt: binding.updatedAt
  })
}

function exactProject(workspace: ProjectCoordinatorWorkspace, projectId: string) {
  const project = workspace.projects.find(({ project }) => project.projectId === projectId)
  if (!project || workspace.focusedProjectId !== projectId) {
    throw new Error('The exact Project is not visible to the current authenticated Principal.')
  }
  return project
}

function isCoordinatorBinding(
  binding: ProjectCoordinatorCoordinatorSessionBindingRecord | WorkerSessionExecutionBinding
): binding is ProjectCoordinatorCoordinatorSessionBindingRecord {
  return 'role' in binding && binding.role === 'coordinator'
}

function sameSession(
  binding: Pick<ProjectCoordinatorCoordinatorSessionBindingRecord, 'runtimeId' | 'threadId'>,
  session: DomainMainOrdinarySessionIdentity
): boolean {
  return binding.runtimeId === session.runtimeId && binding.threadId === session.threadId
}

function withoutSessionConflicts<Binding extends Readonly<{
  runtimeId: string
  threadId: string
}>>(bindings: readonly Binding[]): readonly Binding[] {
  const counts = new Map<string, number>()
  for (const binding of bindings) {
    const key = `${binding.runtimeId}\u0000${binding.threadId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return bindings.filter((binding) => (
    counts.get(`${binding.runtimeId}\u0000${binding.threadId}`) === 1
  ))
}

function isPubliclyVisibleBinding(
  binding: ProjectCoordinatorSessionBinding
): boolean {
  return binding.fenceReason !== 'principal_changed' &&
    binding.fenceReason !== 'membership_inactive' &&
    binding.fenceReason !== 'project_unavailable'
}

async function readProjectWorkspaceForIdentity(
  workspace: ProjectCoordinatorWorkspacePort
): Promise<ProjectCoordinatorWorkspace | undefined> {
  try {
    return await workspace.readWorkspace({})
  } catch {
    return undefined
  }
}

function createCoordinatorBindingSnapshot(state: ProjectCoordinatorStateStore) {
  let records: readonly ProjectCoordinatorCoordinatorSessionBindingRecord[] = []
  return {
    get: () => records,
    refresh: async () => {
      records = await state.readCoordinatorSessionBindings()
      return records
    }
  }
}
