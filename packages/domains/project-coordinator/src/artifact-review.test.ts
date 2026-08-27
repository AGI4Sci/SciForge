import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND
} from '@sciforge/domain-content-space/contract'

import { createProjectCoordinatorArtifactReviewPort } from './artifact-review.js'

const locator = Object.freeze({
  contractVersion: 1 as const,
  kind: 'content-space.file-reference' as const,
  authority: 'opencontent.run0',
  identity: Object.freeze({
    providerInstanceRef: 'opencontent.run0',
    fileId: 'provider-file-output-001'
  })
})
const locatorDigest = stableDigest(locator)
const rootLocatorDigest = 'a'.repeat(64)

test('artifact review rereads the exact current Cloud result before materializing one UI resource', async () => {
  const materialized: unknown[] = []
  const discarded: unknown[] = []
  const port = createProjectCoordinatorArtifactReviewPort({
    workspace: {
      readWorkspace: async () => workspaceFixture() as never
    },
    portableResources: {
      materialize: async (reference) => {
        materialized.push(reference)
        return {
          resource: {
            token: 'cap_artifact-review-resource',
            semanticRevision: 'provider-revision-7',
            expiresAt: '2026-08-26T02:08:00.000Z'
          },
          resourceRef: 'res_artifact-review-resource-001',
          resourceKind: CONTENT_FILE_RESOURCE_KIND
        }
      },
      discard: async (input) => { discarded.push(input) },
      export: async () => { throw new Error('artifact review does not export authority') }
    }
  })

  const result = await port.prepare({
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    submissionDigest: 'b'.repeat(64),
    outputIndex: 0,
    locatorDigest
  })

  assert.deepEqual(materialized, [locator])
  assert.deepEqual(discarded, [])
  assert.deepEqual(result, {
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    outputIndex: 0,
    locatorDigest,
    resource: {
      kind: CONTENT_FILE_RESOURCE_KIND,
      resourceRef: 'res_artifact-review-resource-001'
    }
  })
  assert.equal('resource' in result.resource, false)
})

test('artifact review fails closed before materialization for stale Cloud or caller-owned authority facts', async () => {
  let materializeCalls = 0
  const current = workspaceFixture()
  const stale = {
    ...current,
    connection: {
      ...current.connection,
      userId: 'usr_NotTheOwner001'
    }
  }
  const port = createProjectCoordinatorArtifactReviewPort({
    workspace: { readWorkspace: async () => stale as never },
    portableResources: {
      materialize: async () => {
        materializeCalls += 1
        throw new Error('must not materialize')
      },
      discard: async () => undefined,
      export: async () => { throw new Error('unused') }
    }
  })

  await assert.rejects(port.prepare({
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    submissionDigest: 'b'.repeat(64),
    outputIndex: 0,
    locatorDigest
  }), /Project Owner/u)
  assert.equal(materializeCalls, 0)
})

test('artifact review immediately discards a materialization whose resource kind drifts', async () => {
  const discarded: unknown[] = []
  const port = createProjectCoordinatorArtifactReviewPort({
    workspace: { readWorkspace: async () => workspaceFixture() as never },
    portableResources: {
      materialize: async () => ({
        resource: {
          token: 'cap_wrong-artifact-kind',
          semanticRevision: 'provider-revision-7',
          expiresAt: '2026-08-26T02:08:00.000Z'
        },
        resourceRef: 'res_wrong-artifact-kind-001',
        resourceKind: ARTIFACT_RESOURCE_KIND
      }),
      discard: async (input) => { discarded.push(input) },
      export: async () => { throw new Error('unused') }
    }
  })

  await assert.rejects(port.prepare({
    projectId: 'prj_ProjectCreated01',
    taskId: 'tsk_MeetingTask001',
    executionId: 'exe_MeetingExec001',
    resultSubmissionId: 'rsu_MeetingResult01',
    submissionDigest: 'b'.repeat(64),
    outputIndex: 0,
    locatorDigest
  }), /resource kind/u)
  assert.deepEqual(discarded, [{ resourceRef: 'res_wrong-artifact-kind-001' }])
})

function workspaceFixture() {
  return {
    connection: {
      state: 'ready' as const,
      userId: 'usr_Owner0000001',
      deviceId: 'dev_Device0000001'
    },
    observedAt: '2026-08-26T01:08:00.000Z',
    focusedProjectId: 'prj_ProjectCreated01',
    availableWorkerUsers: [],
    projects: [{
      project: {
        projectId: 'prj_ProjectCreated01',
        ownerUserId: 'usr_Owner0000001',
        coordinatorAgentId: 'agt_Coordinator01',
        contentMode: 'required' as const,
        status: 'active' as const
      },
      tasks: [{
        task: {
          taskId: 'tsk_MeetingTask001',
          currentExecutionId: 'exe_MeetingExec001',
          currentExecutionState: 'result_submitted' as const,
          status: 'awaiting_review' as const
        },
        executions: [{
          executionId: 'exe_MeetingExec001',
          state: 'result_submitted' as const,
          currentResultSubmissionId: 'rsu_MeetingResult01'
        }]
      }],
      reviews: [{
        submission: {
          resultSubmissionId: 'rsu_MeetingResult01',
          projectId: 'prj_ProjectCreated01',
          taskId: 'tsk_MeetingTask001',
          executionId: 'exe_MeetingExec001',
          submissionDigest: 'b'.repeat(64),
          outputs: [{
            executionId: 'exe_MeetingExec001',
            assignmentTaskRevision: 3,
            locator,
            locatorDigest,
            rootLocatorDigest,
            bindingRevision: 4,
            transferReceiptDigest: 'c'.repeat(64),
            observationDigest: 'd'.repeat(64),
            preflightObservationDigest: 'e'.repeat(64)
          }]
        },
        decision: null
      }],
      provisioning: {
        binding: {
          status: 'active' as const,
          revision: 4,
          rootLocatorDigest
        },
        memberships: [{
          userId: 'usr_Owner0000001',
          state: 'active' as const
        }],
        contentReadiness: [{
          userId: 'usr_Owner0000001',
          state: 'ready' as const,
          bindingRevision: 4
        }]
      }
    }]
  }
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
