import {
  domainRendererComposerContextResultSchema,
  type DomainRendererComposerContextProvider
} from '@sciforge/domain-sdk/renderer'

import type {
  ProjectCoordinatorProject,
  ProjectCoordinatorSessionBinding
} from '../contract.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import { projectCoordinatorSessionBindingForOrdinarySession } from './session-binding.js'

export const PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS = 48_000

const MAX_COORDINATOR_TASKS = 12
const MAX_COORDINATOR_REVIEWS = 8
const MAX_COORDINATOR_RECORDS = 8
const MAX_COORDINATOR_RECOVERY_ACTIONS = 8
const MAX_COORDINATOR_HUMAN_REQUESTS = 8
const MAX_COORDINATOR_READINESS_FACTS = 16
const MAX_WORKER_ASSOCIATED_FACTS = 8
const MAX_OUTPUT_DIGESTS = 8
const MAX_TITLE_CHARS = 240
const MAX_GOAL_CHARS = 1_500
const MAX_SUMMARY_CHARS = 800
const MAX_BODY_CHARS = 800
const MAX_INSTRUCTION_CHARS = 800
const MAX_PROMPT_CHARS = 800
const AUTHORITY_NOTICE = 'This context is descriptive only and grants no authority. Every action must use the canonical Project Coordinator capability; its main handler re-reads the current Principal, Cloud membership, revisions, and authority or execution fences.'

export function createProjectCoordinatorComposerContextProvider(
  client: ProjectCoordinatorRendererClient
): DomainRendererComposerContextProvider {
  return Object.freeze({
    async provide(request) {
      try {
        const runtimeId = request.runtimeId?.trim()
        const threadId = request.sessionId?.trim()
        if (request.signal.aborted || !runtimeId || !threadId) return { items: [] }

        const projection = await client.readSessionProjection()
        if (request.signal.aborted) return { items: [] }
        const binding = projectCoordinatorSessionBindingForOrdinarySession(
          projection,
          runtimeId,
          threadId
        )
        if (!binding) return { items: [] }

        const workspace = await client.readWorkspace({ projectId: binding.projectId })
        if (request.signal.aborted || workspace.connection.state !== 'ready') {
          return { items: [] }
        }
        const project = workspace.projects.find(({ project }) => (
          project.projectId === binding.projectId
        ))
        if (!project || workspace.focusedProjectId !== binding.projectId) {
          return { items: [] }
        }

        const content = renderProjectSessionContext(project, binding)
        if (content.length > PROJECT_COORDINATOR_COMPOSER_CONTEXT_MAX_CHARS) {
          return { items: [] }
        }
        return domainRendererComposerContextResultSchema.parse({
          items: [{
            id: 'project-coordinator.context.current-session',
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
    evidenceAndReview: project.reviews
      .slice(0, MAX_COORDINATOR_REVIEWS)
      .map(reviewSummary),
    acceptedDecisionsAndRecords: project.records
      .slice(0, MAX_COORDINATOR_RECORDS)
      .map(recordSummary),
    pendingHumanNeeded: project.pendingHumanNeeded
      .slice(0, MAX_COORDINATOR_HUMAN_REQUESTS)
      .map(humanNeededSummary),
    content: {
      binding: project.provisioning.binding
        ? {
            projectContentBindingId:
              project.provisioning.binding.projectContentBindingId,
            status: project.provisioning.binding.status,
            bindingRevision: project.provisioning.binding.provisioningRevision
          }
        : null,
      readiness: project.provisioning.contentReadiness
        .slice(0, MAX_COORDINATOR_READINESS_FACTS)
        .map((readiness) => ({
          userId: readiness.userId,
          state: readiness.state,
          reason: readiness.reason,
          revision: readiness.revision
        })),
      recovery: project.provisioning.recoveryActions
        .slice(0, MAX_COORDINATOR_RECOVERY_ACTIONS)
        .map(recoverySummary)
    }
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
  const reviews = project.reviews.filter(({ submission }) => (
    submission.taskId === binding.taskId &&
    submission.executionId === binding.executionId
  )).slice(0, MAX_WORKER_ASSOCIATED_FACTS)
  const resultSubmissionIds = new Set(reviews.map(({ submission }) => (
    submission.resultSubmissionId
  )))
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
    evidenceAndReview: reviews.map(reviewSummary),
    associatedRecords: project.records.filter((record) => (
      record.sourceTaskId === binding.taskId &&
      record.sourceResultSubmissionId !== null &&
      resultSubmissionIds.has(record.sourceResultSubmissionId)
    )).slice(0, MAX_WORKER_ASSOCIATED_FACTS).map(recordSummary),
    pendingHumanNeeded: project.pendingHumanNeeded.filter((request) => (
      request.context.scope === 'worker_execution' &&
      request.context.taskId === binding.taskId &&
      request.context.executionId === binding.executionId
    )).slice(0, MAX_WORKER_ASSOCIATED_FACTS).map(humanNeededSummary),
    recovery: project.provisioning.recoveryActions.filter((action) => (
      action.taskId === binding.taskId && action.executionId === binding.executionId
    )).slice(0, MAX_WORKER_ASSOCIATED_FACTS).map(recoverySummary)
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
    executionAuthorityEpoch: project.project.executionAuthorityEpoch,
    contentMode: project.project.contentMode
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

function reviewSummary(review: ProjectCoordinatorProject['reviews'][number]) {
  return {
    resultSubmissionId: review.submission.resultSubmissionId,
    taskId: review.submission.taskId,
    executionId: review.submission.executionId,
    submissionDigest: review.submission.submissionDigest,
    summary: clipped(review.submission.summary, MAX_SUMMARY_CHARS),
    outputLocatorDigests: review.submission.outputs
      .slice(0, MAX_OUTPUT_DIGESTS)
      .map(({ locatorDigest }) => locatorDigest),
    decision: review.decision
      ? {
          reviewDecisionId: review.decision.reviewDecisionId,
          decision: review.decision.decision,
          instruction: nullableClipped(review.decision.instruction, MAX_INSTRUCTION_CHARS),
          acceptedProjectRecordId: review.decision.acceptedProjectRecordId,
          revision: review.decision.revision
        }
      : null
  }
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

function recoverySummary(
  action: ProjectCoordinatorProject['provisioning']['recoveryActions'][number]
) {
  return {
    recoveryActionId: action.recoveryActionId,
    taskId: action.taskId,
    executionId: action.executionId,
    action: action.action,
    status: action.status,
    safeSummary: clipped(action.safeSummary, MAX_SUMMARY_CHARS),
    revision: action.revision
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
