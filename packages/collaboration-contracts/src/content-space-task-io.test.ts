import { describe, expect, it } from 'vitest'

import {
  contentSpaceAuthorizationProofSchema,
  portableContentSpaceLocatorSchema,
  projectContentSpaceBindingSchema,
  taskFileIntentSchema
} from './content-space-task-io.js'
import { restRequestSchema } from './protocol.js'
import { TEST_HASH, TEST_IDS, TEST_TIMESTAMP } from './testing.js'

const rootLocator = {
  contractVersion: 1 as const,
  kind: 'content-space.container-reference' as const,
  authority: 'opencontent.team.alpha',
  identity: { directoryId: 'team-alpha' }
}
const fileLocator = {
  contractVersion: 1 as const,
  kind: 'content-space.file-reference' as const,
  authority: 'opencontent.team.alpha',
  identity: { fileId: 'file-one' }
}

const fileIntent = {
  schemaVersion: 1 as const,
  bindingRevision: 3,
  inputs: [{
    kind: 'content-space.input-file' as const,
    locator: fileLocator,
    destinationName: 'input.csv',
    expectedSemanticRevision: null
  }],
  output: {
    kind: 'content-space.output-new' as const,
    target: 'project-binding-root' as const,
    mode: 'upload-new' as const
  }
}

describe('Project ContentSpace and Task file I/O contracts', () => {
  it('treats a portable envelope only as a bounded locator', () => {
    expect(portableContentSpaceLocatorSchema.parse(rootLocator)).toEqual(rootLocator)
    expect(portableContentSpaceLocatorSchema.safeParse({
      ...rootLocator,
      authorization: 'guessed'
    }).success).toBe(false)
  })

  it('requires an opaque Host authorization proof on binding commands', () => {
    const authorizationProof = contentSpaceAuthorizationProofSchema.parse({
      format: 'sciforge.content-space.authorization-proof.v1',
      issuer: 'sciforge.host',
      payload: 'signed-proof-payload-that-is-not-a-portable-locator'
    })
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_content_space_bind_01',
      type: 'project.content_space.bind',
      projectId: TEST_IDS.projectId,
      expectedRevision: 2,
      rootLocator,
      authorizationProof
    }).success).toBe(true)
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0',
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_content_space_bind_02',
      type: 'project.content_space.bind',
      projectId: TEST_IDS.projectId,
      expectedRevision: 2,
      rootLocator
    }).success).toBe(false)
  })

  it('makes typed fileIntent the only caller-authored file truth', () => {
    expect(taskFileIntentSchema.parse(fileIntent)).toEqual(fileIntent)
    const request = {
      protocolVersion: '1.0' as const,
      requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_file_task_create_01',
      type: 'task.create' as const,
      projectId: TEST_IDS.projectId,
      expectedRevision: 3,
      assigneeAgentId: TEST_IDS.secondAgentId,
      title: 'Analyze the selected file',
      objective: 'Read one input and create a new output.',
      completionCriteria: ['Return one output'],
      dependencyTaskIds: [],
      fileIntent
    }
    expect(restRequestSchema.safeParse(request).success).toBe(true)
    expect(restRequestSchema.safeParse({
      ...request,
      resourceRefIds: [TEST_IDS.resourceRefId]
    }).success).toBe(false)
  })

  it('rejects duplicate locators, unsafe destinations, and unknown execution fields', () => {
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      inputs: [fileIntent.inputs[0], { ...fileIntent.inputs[0], destinationName: 'other.csv' }]
    }).success).toBe(false)
    expect(taskFileIntentSchema.safeParse({
      ...fileIntent,
      inputs: [{ ...fileIntent.inputs[0], destinationName: '../escape' }]
    }).success).toBe(false)
    expect(restRequestSchema.safeParse({
      protocolVersion: '1.0', requestId: TEST_IDS.requestId,
      idempotencyKey: 'idem_task_transition_01', type: 'task.transition',
      taskId: TEST_IDS.taskId, executionId: TEST_IDS.executionId,
      legacyEpoch: 'epoch_legacy', expectedRevision: 1, status: 'accepted'
    }).success).toBe(false)
  })

  it('exposes sanitized proof metadata but never the raw proof payload', () => {
    const binding = projectContentSpaceBindingSchema.parse({
      schemaVersion: 1,
      type: 'project_content_space_binding',
      projectId: TEST_IDS.projectId,
      rootLocator,
      rootLocatorDigest: TEST_HASH,
      authorization: {
        proofId: 'csp_Proof00000001',
        issuer: 'sciforge.host',
        proofDigest: TEST_HASH,
        actorPrincipalDigest: TEST_HASH,
        principal: {
          authority: 'sciforge.identity',
          subject: TEST_IDS.userId,
          deviceId: 'device-host-alpha',
          identityVersion: 7
        },
        scopes: ['content-space.read', 'content-space.upload-new'],
        issuedAt: TEST_TIMESTAMP,
        expiresAt: '2026-08-15T08:05:00.000Z'
      },
      status: 'active',
      revision: 3,
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP
    })
    expect(JSON.stringify(binding)).not.toContain('signed-proof-payload')
  })
})
