import { createHash } from 'node:crypto'

import type { DomainMainPortableResourceReferencesHost } from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_REFERENCE_KIND,
  ARTIFACT_RESOURCE_KIND,
  CONTENT_FILE_REFERENCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '@sciforge/domain-content-space/contract'

import {
  projectCoordinatorArtifactReviewPrepareInputSchema,
  projectCoordinatorArtifactReviewPreparedSchema,
  type ProjectCoordinatorArtifactReviewPrepareInput,
  type ProjectCoordinatorArtifactReviewPrepared
} from './contract.js'
import type { ProjectCoordinatorWorkspacePort } from './ports.js'

export type ProjectCoordinatorArtifactReviewPort = Readonly<{
  prepare(
    input: ProjectCoordinatorArtifactReviewPrepareInput
  ): Promise<ProjectCoordinatorArtifactReviewPrepared>
}>

export function createProjectCoordinatorArtifactReviewPort(options: Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  portableResources: DomainMainPortableResourceReferencesHost
}>): ProjectCoordinatorArtifactReviewPort {
  return Object.freeze({
    prepare: async (rawInput) => {
      const input = projectCoordinatorArtifactReviewPrepareInputSchema.parse(rawInput)
      const workspace = await options.workspace.readWorkspace({ projectId: input.projectId })
      if (workspace.connection.state !== 'ready') {
        throw new Error(`Project coordination is ${workspace.connection.state}.`)
      }
      const currentUserId = workspace.connection.userId
      const project = workspace.projects.find(({ project }) => (
        project.projectId === input.projectId
      ))
      if (!project) throw new Error('The exact Project is not visible to the current OIDC User.')
      if (currentUserId !== project.project.ownerUserId) {
        throw new Error('Only the current Project Owner may prepare a result artifact review.')
      }
      if (project.project.contentMode !== 'required') {
        throw new Error('A content-free Project has no Content Space artifact review path.')
      }
      if (project.project.status !== 'active') {
        throw new Error('Only an active Project can prepare a pending result artifact review.')
      }

      const task = project.tasks.find(({ task }) => task.taskId === input.taskId)
      if (
        !task ||
        task.task.currentExecutionId !== input.executionId ||
        task.task.currentExecutionState !== 'result_submitted' ||
        task.task.status !== 'awaiting_review'
      ) {
        throw new Error('Artifact review requires the exact current result-submitted Task execution.')
      }
      const execution = task.executions.find(({ executionId }) => (
        executionId === input.executionId
      ))
      if (
        !execution ||
        execution.state !== 'result_submitted' ||
        execution.currentResultSubmissionId !== input.resultSubmissionId
      ) {
        throw new Error('Artifact review requires the exact current result submission fence.')
      }
      const review = project.reviews.find(({ submission }) => (
        submission.resultSubmissionId === input.resultSubmissionId
      ))
      if (
        !review ||
        review.decision !== null ||
        review.submission.projectId !== input.projectId ||
        review.submission.taskId !== input.taskId ||
        review.submission.executionId !== input.executionId ||
        review.submission.submissionDigest !== input.submissionDigest
      ) {
        throw new Error('Artifact review requires the exact immutable pending result submission.')
      }
      const output = review.submission.outputs[input.outputIndex]
      if (
        !output ||
        output.executionId !== input.executionId ||
        output.locatorDigest !== input.locatorDigest ||
        stableDigest(output.locator) !== output.locatorDigest
      ) {
        throw new Error('Artifact review output selection or portable locator digest drifted.')
      }
      const binding = project.provisioning.binding
      if (
        !binding ||
        binding.status !== 'active' ||
        binding.revision !== output.bindingRevision ||
        binding.rootLocatorDigest === null ||
        binding.rootLocatorDigest !== output.rootLocatorDigest
      ) {
        throw new Error('Artifact review requires the exact active Project Content binding.')
      }
      const ownerMembership = project.provisioning.memberships.find(({ userId }) => (
        userId === currentUserId
      ))
      const ownerReadiness = project.provisioning.contentReadiness.find(({ userId }) => (
        userId === currentUserId
      ))
      if (
        !ownerMembership ||
        ownerMembership.state !== 'active' ||
        !ownerReadiness ||
        ownerReadiness.state !== 'ready' ||
        ownerReadiness.bindingRevision !== binding.revision
      ) {
        throw new Error('Artifact review requires current Owner membership and Content readiness.')
      }

      const expectedResourceKind = output.locator.kind === CONTENT_FILE_REFERENCE_KIND
        ? CONTENT_FILE_RESOURCE_KIND
        : output.locator.kind === ARTIFACT_REFERENCE_KIND
          ? ARTIFACT_RESOURCE_KIND
          : null
      if (expectedResourceKind === null) {
        throw new Error('Artifact review accepts only Content Space file or artifact outputs.')
      }

      const materialized = await options.portableResources.materialize(output.locator)
      try {
        if (materialized.resourceKind !== expectedResourceKind) {
          throw new Error('Materialized artifact review resource kind does not match the Cloud locator.')
        }
        return projectCoordinatorArtifactReviewPreparedSchema.parse({
          projectId: input.projectId,
          taskId: input.taskId,
          executionId: input.executionId,
          resultSubmissionId: input.resultSubmissionId,
          outputIndex: input.outputIndex,
          locatorDigest: input.locatorDigest,
          resource: {
            kind: materialized.resourceKind,
            resourceRef: materialized.resourceRef
          }
        })
      } catch (error) {
        await options.portableResources.discard({ resourceRef: materialized.resourceRef })
        throw error
      }
    }
  })
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`
}
