import {
  domainRendererComposerContextResultSchema,
  type DomainRendererComposerContextProvider
} from '@sciforge/domain-sdk/renderer'

import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorSessionBinding
} from '../contract.js'
import { currentProjectCoordinatorPanelContext } from './panel-context.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import { projectCoordinatorSessionBindingForOrdinarySession } from './session-binding.js'

export const PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS = 48_000

const MAX_COORDINATOR_TASKS = 12
const MAX_COORDINATOR_REVIEWS = 8
const MAX_COORDINATOR_RECORDS = 8
const MAX_COORDINATOR_HUMAN_REQUESTS = 8
const MAX_WORKER_ASSOCIATED_FACTS = 8
const MAX_TITLE_CHARS = 240
const MAX_GOAL_CHARS = 1_500
const MAX_SUMMARY_CHARS = 800
const MAX_BODY_CHARS = 800
const MAX_PROMPT_CHARS = 800
const AUTHORITY_NOTICE = 'This context is descriptive only and grants no authority. Use the canonical requirements workflow: the Owner saves the requirements draft in the UI, collaboration.requirements.complete derives work modules and acceptance criteria, and the Owner confirms the exact version in the UI before dispatch. Agent completion executes in the project Coordinator Session and every action rechecks current Principal, membership, revisions and authority fences. Do not claim a write or confirmation succeeded before the canonical capability returns success. session-projection.read accepts an empty object; workspace.read accepts projectId for an explicit target. Discover the exact published capability, expand its opaque operationRef with includeSchema, and invoke that same operationRef. Never use an opaque reference as capabilityId.'

export function createProjectCoordinatorComposerContextProvider(
  client: ProjectCoordinatorRendererClient
): DomainRendererComposerContextProvider {
  return Object.freeze({
    async provide(request) {
      try {
        const runtimeId = request.runtimeId?.trim()
        const threadId = request.sessionId?.trim()
        if (request.signal.aborted || !runtimeId || !threadId) return { items: [] }

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

        const workspace = await client.readWorkspace({ projectId })
        if (request.signal.aborted || workspace.connection.state !== 'ready') {
          return { items: [] }
        }
        const project = workspace.projects.find(({ project }) => (
          project.projectId === projectId
        ))
        if (!project) return { items: [] }

        // A focused Project Coordinator pane is an explicit user-selected
        // target.  It may differ from the durable Session binding, so expose
        // a descriptive Project snapshot without pretending the Session has
        // inherited any authority over that Project.
        if (panelTarget) {
          const content = renderProjectPanelContext(project)
          if (content.length > PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS) {
            return { items: [] }
          }
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
        if (content.length > PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS) {
          return { items: [] }
        }
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
      } catch {
        return { items: [] }
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
  return JSON.stringify({
    schemaVersion: 1,
    authorityNotice: AUTHORITY_NOTICE,
    target: {
      kind: 'selected-project-panel',
      projectId: project.project.projectId
    },
    project: projectSummary(project),
    plan: planSummary(project),
    tasks: project.tasks.slice(0, MAX_COORDINATOR_TASKS).map(({ task, executions }) => ({
      taskId: task.taskId,
      title: clipped(task.title, MAX_TITLE_CHARS),
      status: task.status,
      revision: task.revision,
      currentExecutionId: task.currentExecutionId,
      currentExecutionState: task.currentExecutionState,
      executions: executions.slice(-3).map((execution) => ({
        executionId: execution.executionId,
        state: execution.state,
        revision: execution.revision,
        assigneeUserId: execution.assigneeUserId
      }))
    })),
    evidenceAndReview: (project.deliveryDrive?.projectResults ?? []).slice(0, MAX_COORDINATOR_REVIEWS).map(resultSummary),
    acceptedDecisionsAndRecords: project.records.slice(0, MAX_COORDINATOR_RECORDS).map(recordSummary),
    pendingHumanNeeded: project.pendingHumanNeeded
      .slice(0, MAX_COORDINATOR_HUMAN_REQUESTS)
      .map(humanNeededSummary)
  }, null, 2)
}

export function renderProjectSessionContext(
  project: ProjectCoordinatorProject,
  binding: ProjectCoordinatorSessionBinding
): string {
  const content = JSON.stringify(
    binding.role === 'coordinator'
      ? coordinatorContext(project, binding)
      : workerContext(project, binding),
    null,
    2
  )
  if (content.length > PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS) {
    throw new Error('Project composer context exceeds its package-owned character budget.')
  }
  return content
}

function coordinatorContext(
  project: ProjectCoordinatorProject,
  binding: Extract<ProjectCoordinatorSessionBinding, { role: 'coordinator' }>
) {
  return {
    schemaVersion: 1,
    authorityNotice: AUTHORITY_NOTICE,
    session: {
      role: binding.role,
      access: binding.access,
      fenceReason: binding.fenceReason,
      coordinatorAuthorityEpoch: binding.coordinatorAuthorityEpoch
    },
    project: projectSummary(project),
    plan: planSummary(project),
    tasks: project.tasks.slice(0, MAX_COORDINATOR_TASKS).map(({ task, executions }) => ({
      taskId: task.taskId,
      title: clipped(task.title, MAX_TITLE_CHARS),
      status: task.status,
      revision: task.revision,
      currentExecutionId: task.currentExecutionId,
      currentExecutionState: task.currentExecutionState,
      executions: executions.slice(-3).map((execution) => ({
        executionId: execution.executionId,
        state: execution.state,
        revision: execution.revision,
        assigneeUserId: execution.assigneeUserId,
        fenceStatus: execution.fence.status,
        projectExecutionAuthorityEpoch:
          execution.fence.projectExecutionAuthorityEpoch,
        userTaskAuthorityEpoch: execution.fence.userTaskAuthorityEpoch
      }))
    })),
    evidenceAndReview: (project.deliveryDrive?.projectResults ?? []).slice(0, MAX_COORDINATOR_REVIEWS).map(resultSummary),
    acceptedDecisionsAndRecords: project.records
      .slice(0, MAX_COORDINATOR_RECORDS)
      .map(recordSummary),
    pendingHumanNeeded: project.pendingHumanNeeded
      .slice(0, MAX_COORDINATOR_HUMAN_REQUESTS)
      .map(humanNeededSummary),

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
  if (!taskView || !execution) {
    throw new Error('Worker composer context requires its exact current Task execution.')
  }
  const results = (project.deliveryDrive?.projectResults ?? []).filter((result) => project.deliveryDrive?.taskDeliveries.some((manifest) => manifest.deliveryManifestId === result.deliveryManifestId && manifest.taskId === binding.taskId))
    .slice(0, MAX_WORKER_ASSOCIATED_FACTS)
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
      displayName: clipped(project.project.displayName, MAX_TITLE_CHARS),
      status: project.project.status,
      revision: project.project.revision
    },
    task: {
      taskId: taskView.task.taskId,
      title: clipped(taskView.task.title, MAX_TITLE_CHARS),
      objective: clipped(taskView.task.objective, MAX_GOAL_CHARS),
      completionCriteria: taskView.task.completionCriteria
        .slice(0, MAX_WORKER_ASSOCIATED_FACTS)
        .map((criterion) => clipped(criterion, MAX_SUMMARY_CHARS)),
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
    evidenceAndReview: results.map(resultSummary),
    associatedRecords: project.records.filter((record) => (
      record.sourceTaskId === binding.taskId
    )).slice(0, MAX_WORKER_ASSOCIATED_FACTS).map(recordSummary),
    pendingHumanNeeded: project.pendingHumanNeeded.filter((request) => (
      request.context.scope === 'worker_execution' &&
      request.context.taskId === binding.taskId &&
      request.context.executionId === binding.executionId
    )).slice(0, MAX_WORKER_ASSOCIATED_FACTS).map(humanNeededSummary),

  }
}

function projectSummary(project: ProjectCoordinatorProject) {
  return {
    projectId: project.project.projectId,
    displayName: clipped(project.project.displayName, MAX_TITLE_CHARS),
    goal: clipped(project.project.goal, MAX_GOAL_CHARS),
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
    projectVersion: result.projectVersion }
}

function recordSummary(record: ProjectCoordinatorProject['records'][number]) {
  return {
    projectRecordId: record.projectRecordId,
    kind: record.kind,
    body: clipped(record.body, MAX_BODY_CHARS),
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
    prompt: clipped(request.prompt, MAX_PROMPT_CHARS),
    confirmableAction: request.confirmableAction
      ? {
          actionType: request.confirmableAction.actionType,
          safeSummary: clipped(
            request.confirmableAction.safeSummary,
            MAX_SUMMARY_CHARS
          ),
          effect: request.confirmableAction.effect,
          actionDigest: request.confirmableAction.actionDigest
        }
      : null,
    status: request.status,
    revision: request.revision
  }
}


function nullableClipped(value: string | null, maxChars: number): string | null {
  return value === null ? null : clipped(value, maxChars)
}

function clipped(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 1))}…`
}
