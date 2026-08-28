import type { DomainMainOrdinarySessionIdentity } from '@sciforge/domain-sdk/host'
import type {
  WorkerSessionExecutionBinding,
  WorkerSessionProjectionService
} from '@sciforge/domain-collaboration/worker-session-projection'

import {
  projectCoordinatorCoordinatorSessionBindingRecordSchema,
  projectCoordinatorCoordinatorSessionBindingSchema,
  projectCoordinatorSessionBindingSchema,
  projectCoordinatorSessionProjectionSchema,
  projectCoordinatorWorkerSessionBindingSchema,
  type ProjectCoordinatorCoordinatorSessionBindingRecord,
  type ProjectCoordinatorProjectCreateResult,
  type ProjectCoordinatorProjectCreateInput,
  type ProjectCoordinatorSessionBinding,
  type ProjectCoordinatorSessionProjection,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'
import { ProjectCoordinatorStateStore } from './state.js'

export type ProjectCoordinatorSessionAccess = 'coordinator' | 'member'

export type ProjectCoordinatorSessionProjectionPort = Readonly<{
  readProjection(
    session?: DomainMainOrdinarySessionIdentity
  ): Promise<ProjectCoordinatorSessionProjection>
  scopeWorkspaceRead(
    input: ProjectCoordinatorWorkspaceReadInput,
    session: DomainMainOrdinarySessionIdentity
  ): Promise<ProjectCoordinatorWorkspaceReadInput>
  withUnboundSession<Result>(
    session: DomainMainOrdinarySessionIdentity,
    operation: () => Promise<Result>
  ): Promise<Result>
  bindCreatedProject(
    result: ProjectCoordinatorProjectCreateResult,
    session: DomainMainOrdinarySessionIdentity,
    input: ProjectCoordinatorProjectCreateInput
  ): Promise<ProjectCoordinatorSessionBinding>
  authorize(
    projectId: string,
    session: DomainMainOrdinarySessionIdentity,
    requiredAccess: ProjectCoordinatorSessionAccess
  ): Promise<ProjectCoordinatorSessionBinding>
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
  const sessionLocks = new Map<string, Promise<void>>()

  const localBinding = (
    session: DomainMainOrdinarySessionIdentity
  ): ProjectCoordinatorCoordinatorSessionBindingRecord | WorkerSessionExecutionBinding | undefined => {
    const coordinators = coordinatorSnapshot.get()
    const workers = options.workers.listBindings()
    const matches = [
      ...coordinators.filter((candidate) => sameSession(candidate, session)),
      ...workers.filter((candidate) => sameSession(candidate, session))
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
        bindings: []
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
    return projectCoordinatorSessionProjectionSchema.parse({
      schemaVersion: 1,
      observedAt: now().toISOString(),
      bindings: visible
    })
  }

  const bindFromWorkspace = async (
    projectId: string,
    workspace: ProjectCoordinatorWorkspace,
    session: DomainMainOrdinarySessionIdentity,
    createInput?: ProjectCoordinatorProjectCreateInput
  ): Promise<ProjectCoordinatorSessionBinding> => {
    const record = coordinatorBindingRecord(projectId, workspace, session, now())
    if (createInput) {
      await options.state.bindCoordinatorSessionForCreatedProject(createInput, record)
    } else {
      await options.state.bindCoordinatorSession(record)
    }
    await coordinatorSnapshot.refresh()
    return projectCoordinatorSessionBindingSchema.parse({
      ...record,
      access: 'coordinator',
      fenceReason: null
    })
  }

  return Object.freeze({
    readProjection,
    scopeWorkspaceRead: async (input, session) => {
      await coordinatorSnapshot.refresh()
      const binding = localBinding(session)
      if (!binding) {
        throw new Error('The ordinary Session is not bound to a Cloud Project.')
      }
      if (input.projectId && input.projectId !== binding.projectId) {
        throw new Error('The ordinary Session is bound to a different Cloud Project.')
      }
      const evaluated = evaluate(
        binding,
        await readProjectWorkspace(binding.projectId)
      )
      if (evaluated.access === 'read_only') {
        throw new Error(`The ordinary Session is fenced: ${evaluated.fenceReason}.`)
      }
      return Object.freeze({ projectId: binding.projectId })
    },
    withUnboundSession: async (session, operation) => withSessionLock(
      sessionLocks,
      session,
      async () => {
        await coordinatorSnapshot.refresh()
        if (localBinding(session)) {
          throw new Error('The ordinary Session is already bound to a Cloud Project.')
        }
        return operation()
      }
    ),
    bindCreatedProject: (result, session, input) => bindFromWorkspace(
      result.createdProjectId,
      result.workspace,
      session,
      { ...input, createIntentId: result.createIntentId }
    ),
    authorize: async (projectId, session, requiredAccess) => {
      await coordinatorSnapshot.refresh()
      const binding = localBinding(session)
      if (!binding || binding.projectId !== projectId) {
        throw new Error('The ordinary Session is not bound to this Cloud Project.')
      }
      const evaluated = evaluate(
        binding,
        await readProjectWorkspace(projectId)
      )
      if (requiredAccess === 'coordinator' && evaluated.access !== 'coordinator') {
        throw new Error('The ordinary Session does not hold current Coordinator authority.')
      }
      if (requiredAccess === 'member' && evaluated.access === 'read_only') {
        throw new Error(`The ordinary Session is fenced: ${evaluated.fenceReason}.`)
      }
      return evaluated
    },
    authorizeInvitationAcceptance: async (projectId, session) => {
      await coordinatorSnapshot.refresh()
      const binding = localBinding(session)
      if (binding && binding.projectId !== projectId) {
        throw new Error('The ordinary Session is bound to a different Cloud Project.')
      }
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

function coordinatorBindingRecord(
  projectId: string,
  workspace: ProjectCoordinatorWorkspace,
  session: DomainMainOrdinarySessionIdentity,
  now: Date
): ProjectCoordinatorCoordinatorSessionBindingRecord {
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

async function withSessionLock<Result>(
  locks: Map<string, Promise<void>>,
  session: DomainMainOrdinarySessionIdentity,
  operation: () => Promise<Result>
): Promise<Result> {
  const key = `${session.runtimeId}\u0000${session.threadId}`
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  locks.set(key, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(key) === tail) locks.delete(key)
  }
}
