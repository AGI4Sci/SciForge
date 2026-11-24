import { translateWorkspace } from '../../renderer/workspace/workspace-i18n.js'
import { referencedTaskIds, TASK_CHAT_END, type TaskChatReadInput } from '../../chat-association-contract.js'
import type { createTaskChatClient } from '../../renderer/task-chat-client.js'
import {
  domainRendererComposerContextResultSchema,
  type DomainRendererComposerContextProvider
} from '@sciforge/domain-sdk/renderer'

import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorSessionBinding
} from '../contract.js'
import { selectComposerContextFacts, renderBoundedComposerContext } from './composer-context-selection.js'
import { currentProjectCoordinatorPanelContext } from './panel-context.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import { projectCoordinatorSessionBindingForOrdinarySession } from './session-binding.js'

export const PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS = 48_000

const AUTHORITY_NOTICE = 'This context is descriptive only and grants no authority. Use the canonical requirements workflow: the Owner saves the requirements draft in the UI, collaboration.requirements.complete derives work modules and acceptance criteria, and the Owner confirms the exact version in the UI before dispatch. Agent completion executes in the project Coordinator Session and every action rechecks current Principal, membership, revisions and authority fences. Do not claim a write or confirmation succeeded before the canonical capability returns success. session-projection.read accepts an empty object; workspace.read accepts projectId for an explicit target. Discover the exact published capability, expand its opaque operationRef with includeSchema, and invoke that same operationRef. Never use an opaque reference as capabilityId.'

export function createProjectCoordinatorComposerContextProvider(
  client: ProjectCoordinatorRendererClient,
  readTaskChats?: ReturnType<typeof createTaskChatClient>
): DomainRendererComposerContextProvider {
  return Object.freeze({
    async resolveDraft(request) {
      const ids = referencedTaskIds(request.draftText)
      if (!ids.length || request.signal.aborted) return { items: [] }
      const workspace = await readTaskWorkspace(client, request.signal)
      if (request.signal.aborted || workspace.connection.state !== 'ready') return { items: [] }
      return { items: ids.flatMap(taskId => {
        const project = workspace.projects.find(project => project.tasks.some(({ task }) => task.taskId === taskId))
        const task = project?.tasks.find(({ task }) => task.taskId === taskId)?.task
        return task && project ? [{ id: taskContextId(taskId), title: `${project.project.displayName} / ${task.title}`.slice(0, 160), content: taskId }] : []
      }) }
    },
    async active(request) {
      if (!request.runtimeId || !request.sessionId || !readTaskChats) return { items: [] }
      const history = await readTaskChats({ runtimeId: request.runtimeId, threadId: request.sessionId })
      if (!history.activeTaskId || request.signal.aborted) return { items: [] }
      const workspace = await readTaskWorkspace(client, request.signal)
      const task = workspace.projects.flatMap(project => project.tasks).find(({ task }) => task.taskId === history.activeTaskId)?.task
      return { items: task ? [{ id: taskContextId(task.taskId), title: translateWorkspace('正在处理：{{title}}', { title: task.title }).slice(0, 160), content: TASK_CHAT_END }] : [] }
    },
    async search(request) {
      const workspace = await readTaskWorkspace(client, request.signal)
      if (request.signal.aborted || workspace.connection.state !== 'ready') return { items: [] }
      const query = request.query.toLocaleLowerCase()
      const userId = workspace.connection.userId
      const focusedProjectId = currentProjectCoordinatorPanelContext()?.projectId ?? workspace.focusedProjectId
      const entries = workspace.projects.flatMap(project => project.tasks.map(({ task, executions }) => ({
        task, project,
        mine: executions.some(execution => execution.executionId === task.currentExecutionId && execution.assigneeUserId === userId)
      })))
      const items = entries.sort((a, b) => {
        const score = (entry: typeof a) => (entry.mine && entry.task.status !== 'completed' ? 4 : 0) + (entry.project.project.projectId === focusedProjectId ? 2 : 0) + (entry.task.status !== 'completed' ? 1 : 0)
        return score(b) - score(a) || b.task.updatedAt.localeCompare(a.task.updatedAt)
      }).map(({ task, project }) => ({
        id: taskContextId(task.taskId),
        title: `${project.project.displayName} / ${task.title} · ${task.status}`.slice(0, 160),
        content: task.taskId,
        metadata: { projectId: project.project.projectId, taskId: task.taskId, status: task.status }
      })).filter(item => `${item.title} ${item.content}`.toLocaleLowerCase().includes(query)).slice(0, 30)
      return { items: [...items, { id: 'collaboration.task.end', title: translateWorkspace('结束任务关联'), content: TASK_CHAT_END }] }
    },
    async provide(request) {
      let trustedProjectId: string | undefined
      let taskContextRequired = false
      try {
        const runtimeId = request.runtimeId?.trim()
        const threadId = request.sessionId?.trim()
        if (request.signal.aborted || request.draftText.includes(TASK_CHAT_END) && !referencedTaskIds(request.draftText).length) return { items: [] }
        const explicitIds = referencedTaskIds(request.draftText)
        taskContextRequired = explicitIds.length > 0 || Boolean(runtimeId && threadId && readTaskChats)
        if (explicitIds.length > 1) throw new Error(translateWorkspace('每条消息只能关联一个任务，请移除其他任务后再发送。'))
        const history = !explicitIds.length && runtimeId && threadId && readTaskChats
          ? await readTaskChats({ runtimeId, threadId } satisfies TaskChatReadInput) : null
        if (!explicitIds.length && history?.detached) return { items: [] }
        const taskIds = explicitIds.length ? explicitIds : history?.activeTaskId ? [history.activeTaskId] : []
        taskContextRequired = taskIds.length > 0
        if (taskIds.length) {
          const workspace = await readTaskWorkspace(client, request.signal)
          if (request.signal.aborted || workspace.connection.state !== 'ready') throw new Error(translateWorkspace('任务上下文暂不可用，请连接协作服务后重试。'))
          const items = taskIds.map(taskId => {
            const project = workspace.projects.find(project => project.tasks.some(({ task }) => task.taskId === taskId))
            const task = project?.tasks.find(({ task }) => task.taskId === taskId)?.task
            if (!project || !task) throw new Error(translateWorkspace('任务 {{taskId}} 不存在或无权访问。', { taskId }))
            return { id: taskContextId(taskId), title: translateWorkspace('任务：{{title}}', { title: task.title }).slice(0, 160),
              content: `[[sciforge-task:${taskId}]]\n${JSON.stringify({ authorityNotice: 'Task context is descriptive and does not authorize execution, dispatch or submission. Save results only to the delivery draft when requested; the human submits. This chat stays private.', projectId: project.project.projectId, task }, null, 2)}`,
              metadata: { taskId, projectId: project.project.projectId } }
          })
          return domainRendererComposerContextResultSchema.parse({ items })
        }
        if (!runtimeId || !threadId) return { items: [] }

        const panelTarget = currentProjectCoordinatorPanelContext()
        // A selected panel target is independent of the ordinary Session
        // projection.  Avoid making its descriptive context depend on a
        // durable binding read (which may legitimately be absent or fail).
        let binding: ProjectCoordinatorSessionBinding | null = null
        if (!panelTarget) {
          const projection = await client.readSessionProjection()
          if (request.signal.aborted) return { items: [] }
          binding = projectCoordinatorSessionBindingForOrdinarySession(
            projection,
            runtimeId,
            threadId
          )
        }
        if (request.signal.aborted) return { items: [] }
        const projectId = panelTarget?.projectId ?? binding?.projectId
        if (!projectId) return { items: [] }

        trustedProjectId = projectId
        const workspace = await client.readWorkspace({ projectId })
        if (request.signal.aborted) return { items: [] }
        if (workspace.connection.state !== 'ready') return unavailableContext()
        const project = workspace.projects.find(({ project }) => (
          project.projectId === projectId
        ))
        if (!project) return unavailableContext()

        // A focused Project Coordinator pane is an explicit user-selected
        // target.  It may differ from the durable Session binding, so expose
        // a descriptive Project snapshot without pretending the Session has
        // inherited any authority over that Project.
        if (panelTarget) {
          const content = renderProjectPanelContext(project)
          return domainRendererComposerContextResultSchema.parse({
            items: [{
              id: 'collaboration.context.selected-panel',
              title: `Cloud Project: ${project.project.displayName}`.slice(0, 160),
              content,
              metadata: {
                schemaVersion: 1,
                projectId,
                selectedProjectId: projectId,
                panelTarget: true,
                selectedBy: 'project-coordinator-panel',
                surfaceId: panelTarget.surfaceId
              }
            }]
          })
        }

        if (!binding || workspace.focusedProjectId !== binding.projectId) return { items: [] }

        const content = renderProjectSessionContext(project, binding)
        return domainRendererComposerContextResultSchema.parse({
          items: [{
            id: 'collaboration.context.current-session',
            title: `Cloud Project: ${project.project.displayName}`.slice(0, 160),
            content,
            metadata: {
              schemaVersion: 1,
              projectId: binding.projectId,
              role: binding.role,
              access: binding.access,
              ...(binding.role === 'worker'
                ? {
                    taskId: binding.taskId,
                    executionId: binding.executionId
                  }
                : {})
            }
          }]
        })
      } catch (error) {
        if (request.signal.aborted) return { items: [] }
        // Explicit/persisted task association errors must stop sending without
        // context; a generic Project snapshot failure remains descriptive.
        if (taskContextRequired) throw error
        return trustedProjectId ? unavailableContext() : { items: [] }
      }
    }
  })
}

/**
 * Render a read-only Project snapshot for the panel-selected target.  The
 * absence of a Session binding is intentional: this context is descriptive
 * only and all writes still require explicit capability authorization.
 */
function renderProjectPanelContext(project: ProjectCoordinatorProject): string {
  return renderBoundedComposerContext({
    schemaVersion: 1,
    authorityNotice: AUTHORITY_NOTICE,
    target: { kind: 'selected-project-panel', projectId: project.project.projectId },
    ...coordinatorFacts(project)
  }, PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS)
}

export function renderProjectSessionContext(
  project: ProjectCoordinatorProject,
  binding: ProjectCoordinatorSessionBinding
): string {
  return renderBoundedComposerContext(
    binding.role === 'coordinator'
      ? {
          schemaVersion: 1,
          authorityNotice: AUTHORITY_NOTICE,
          session: {
            role: binding.role, access: binding.access, fenceReason: binding.fenceReason,
            coordinatorAuthorityEpoch: binding.coordinatorAuthorityEpoch
          },
          ...coordinatorFacts(project)
        }
      : workerContext(project, binding),
    PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS
  )
}

function coordinatorFacts(project: ProjectCoordinatorProject) {
  const selected = selectComposerContextFacts(project)
  return {
    project: projectSummary(project),
    plan: planSummary(project),
    coverage: selected.coverage,
    tasks: selected.tasks.map(({ task, executions }) => ({
      taskId: task.taskId, title: task.title, status: task.status, revision: task.revision,
      dependencyTaskIds: task.dependencyTaskIds,
      currentExecutionId: task.currentExecutionId, currentExecutionState: task.currentExecutionState,
      executions: executions.slice().sort((a, b) => Number(b.executionId === task.currentExecutionId) -
        Number(a.executionId === task.currentExecutionId) || b.revision - a.revision ||
        (a.executionId < b.executionId ? -1 : a.executionId > b.executionId ? 1 : 0)).map((execution) => ({
        executionId: execution.executionId, state: execution.state, revision: execution.revision,
        assigneeUserId: execution.assigneeUserId,
        fenceStatus: execution.fence.status,
        projectExecutionAuthorityEpoch: execution.fence.projectExecutionAuthorityEpoch,
        userTaskAuthorityEpoch: execution.fence.userTaskAuthorityEpoch
      }))
    })),
    evidenceAndReview: selected.results.map(resultSummary),
    acceptedDecisionsAndRecords: selected.records.map(recordSummary),
    pendingHumanNeeded: selected.questions.map(humanNeededSummary)
  }
}

function workerContext(
  project: ProjectCoordinatorProject,
  binding: Extract<ProjectCoordinatorSessionBinding, { role: 'worker' }>
) {
  const taskView = project.tasks.find(({ task }) => task.taskId === binding.taskId)
  const execution = taskView?.executions.find(({ executionId }) => (
    executionId === binding.executionId
  ))
  if (!taskView || !execution || taskView.task.currentExecutionId !== binding.executionId) {
    throw new Error('Worker composer context requires its exact current Task execution.')
  }
  const selected = selectComposerContextFacts(project, binding)
  return {
    schemaVersion: 1,
    authorityNotice: AUTHORITY_NOTICE,
    session: {
      role: binding.role,
      access: binding.access,
      fenceReason: binding.fenceReason,
      taskId: binding.taskId,
      executionId: binding.executionId,
      taskRevision: binding.taskRevision,
      executionRevision: binding.executionRevision,
      projectExecutionAuthorityEpoch: binding.projectExecutionAuthorityEpoch,
      userTaskAuthorityEpoch: binding.userTaskAuthorityEpoch
    },
    project: {
      projectId: project.project.projectId,
      displayName: project.project.displayName,
      status: project.project.status,
      revision: project.project.revision
    },
    task: {
      taskId: taskView.task.taskId,
      title: taskView.task.title,
      objective: taskView.task.objective,
      completionCriteria: taskView.task.completionCriteria,
      status: taskView.task.status,
      revision: taskView.task.revision,
      currentExecutionId: taskView.task.currentExecutionId,
      currentExecutionState: taskView.task.currentExecutionState
    },
    execution: {
      executionId: execution.executionId,
      state: execution.state,
      revision: execution.revision,
      fenceStatus: execution.fence.status,
      projectExecutionAuthorityEpoch:
        execution.fence.projectExecutionAuthorityEpoch,
      userTaskAuthorityEpoch: execution.fence.userTaskAuthorityEpoch
    },
    coverage: selected.coverage,
    evidenceAndReview: selected.results.map(resultSummary),
    associatedRecords: selected.records.map(recordSummary),
    pendingHumanNeeded: selected.questions.map(humanNeededSummary),

  }
}

function projectSummary(project: ProjectCoordinatorProject) {
  return {
    projectId: project.project.projectId,
    displayName: project.project.displayName,
    goal: project.project.goal,
    status: project.project.status,
    revision: project.project.revision,
    ownerUserId: project.project.ownerUserId,
    coordinatorAgentId: project.project.coordinatorAgentId,
    coordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    executionAuthorityEpoch: project.project.executionAuthorityEpoch
  }
}

function planSummary(project: ProjectCoordinatorProject) {
  return project.plan
    ? {
        projectPlanId: project.plan.plan.projectPlanId,
        state: project.plan.plan.state,
        planRevision: project.plan.plan.planRevision,
        planDigest: project.plan.plan.planDigest
      }
    : null
}

function resultSummary(result: NonNullable<ProjectCoordinatorProject['deliveryDrive']>['projectResults'][number]) {
  return { projectResultId: result.projectResultId,
    deliveryManifestId: result.deliveryManifestId, integrationReceiptId: result.integrationReceiptId,
    projectVersion: result.projectVersion, disposition: result.disposition }
}

function recordSummary(record: ProjectCoordinatorProject['records'][number]) {
  return {
    projectRecordId: record.projectRecordId,
    kind: record.kind,
    status: record.status,
    body: record.body,
    sourceTaskId: record.sourceTaskId,
    sourceResultSubmissionId: record.sourceResultSubmissionId,
    sourceHumanAnswerId: record.sourceHumanAnswerId,
    revision: record.revision
  }
}

function humanNeededSummary(
  request: ProjectCoordinatorProject['pendingHumanNeeded'][number]
) {
  return {
    humanRequestId: request.humanRequestId,
    context: request.context,
    prompt: request.prompt,
    confirmableAction: request.confirmableAction
      ? {
          actionType: request.confirmableAction.actionType,
          safeSummary: request.confirmableAction.safeSummary,
          effect: request.confirmableAction.effect,
          actionDigest: request.confirmableAction.actionDigest
        }
      : null,
    status: request.status,
    revision: request.revision
  }
}


function unavailableContext() {
  return domainRendererComposerContextResultSchema.parse({ items: [{
    id: 'collaboration.context.unavailable',
    title: 'Cloud Project context unavailable',
    content: JSON.stringify({
      schemaVersion: 1, state: 'unavailable',
      description: 'The resolved Project context could not be read. Its tasks, records and pending questions are unknown; do not infer that they are empty.',
      authorityNotice: AUTHORITY_NOTICE
    }),
    metadata: { schemaVersion: 1, state: 'unavailable' }
  }] })
}

function taskContextId(taskId: string): string {
  return `collaboration.task.${Array.from(taskId).map(character => character.charCodeAt(0).toString(16)).join('')}`
}

/** workspace.read without projectId is a project directory, not a task directory. */
async function readTaskWorkspace(client: ProjectCoordinatorRendererClient, signal: AbortSignal) {
  const directory = await client.readWorkspace({}, { signal })
  signal.throwIfAborted()
  if (directory.connection.state !== 'ready') return directory
  const identity = directory.connection
  const canReadTasks = (project: ProjectCoordinatorProject) => project.project.ownerUserId === identity.userId ||
    project.memberships.some(member => member.userId === identity.userId && member.state === 'active')
  const projects = directory.projects.filter(canReadTasks)
  // Bound fanout; every detailed read still crosses the canonical Cloud authorization path.
  for (let offset = 0; offset < projects.length; offset += 4) {
    await Promise.all(projects.slice(offset, offset + 4).map(async (summary, index) => {
      if (summary.project.projectId === directory.focusedProjectId) return
      const detail = await client.readWorkspace({ projectId: summary.project.projectId }, { signal })
      signal.throwIfAborted()
      if (detail.connection.state !== 'ready') throw new Error(translateWorkspace('任务上下文暂不可用，请连接协作服务后重试。'))
      if (detail.connection.userId !== identity.userId || detail.connection.deviceId !== identity.deviceId) throw new Error(translateWorkspace('协作账户已变化，请重新选择任务。'))
      const current = detail.projects.find(project => project.project.projectId === summary.project.projectId)
      projects[offset + index] = current && canReadTasks(current) ? current : { ...summary, tasks: [] }
    }))
  }
  return { ...directory, projects }
}
