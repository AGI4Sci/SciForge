import {
  agentEnsuredResponseFixture,
  invalidTestOnlyValue,
  TEST_HASH,
  TEST_IDS,
  TEST_TIMESTAMP
} from '@sciforge/collaboration-contracts/testing'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  describe,
  expect,
  it
} from 'vitest'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  authenticatedCloudRequestSchema,
  authenticatedCloudResponseSchema,
  defineAuthenticatedCloudTransport
} from './authenticated-cloud-transport.js'

const FORBIDDEN_TEST_VALUE = invalidTestOnlyValue('SECRET_VALUE')
const FORBIDDEN_TEST_BEARER = ['Bearer', FORBIDDEN_TEST_VALUE].join(' ')

describe('authenticated Cloud transport contract', () => {
  it('accepts a canonical current command while rejecting undeclared secret-bearing object metadata', () => {
    const payload = requirementsDraftPayload({})
    const valid = {
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload
    } as const
    expect(authenticatedCloudRequestSchema.parse(valid)).toEqual(valid)

    for (const forbiddenIdentity of [
      { nested: [{ token: FORBIDDEN_TEST_VALUE }] },
      { nested: [{ access_token: FORBIDDEN_TEST_VALUE }] },
      { nested: [{ refreshToken: FORBIDDEN_TEST_VALUE }] },
      { nested: [{ agentCredential: FORBIDDEN_TEST_VALUE }] },
      { nested: [{ providerCredential: FORBIDDEN_TEST_VALUE }] },
      { nested: [{ apiKey: FORBIDDEN_TEST_VALUE }] },
      { nested: [{ headers: { Authorization: FORBIDDEN_TEST_BEARER } }] },
      { nested: [{ token: '[REDACTED]' }] },
      { nested: [{ safeLabel: FORBIDDEN_TEST_BEARER }] }
    ]) {
      expect(authenticatedCloudRequestSchema.safeParse({
        ...valid,
        payload: requirementsDraftPayload(forbiddenIdentity)
      }).success).toBe(false)
    }

    expect(payload.expectedRequirementsRevision).toBe(0)
    expect(payload.inputReferences[0]?.kind).toBe('collaboration.object-reference')
  })

  it('rejects non-contract transport surfaces and private Agent credential lifecycle envelopes', () => {
    const valid = {
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: projectListPayload()
    } as const

    for (const forbidden of [
      { accessToken: FORBIDDEN_TEST_VALUE },
      { authorization: FORBIDDEN_TEST_BEARER },
      { headers: { authorization: FORBIDDEN_TEST_VALUE } },
      { path: '/v1/commands' },
      { url: 'https://cloud.example.test/v1/commands' },
      { credential: FORBIDDEN_TEST_VALUE }
    ]) {
      expect(authenticatedCloudRequestSchema.safeParse({ ...valid, ...forbidden }).success).toBe(false)
    }

    expect(authenticatedCloudResponseSchema.safeParse({
      contractVersion: 1,
      status: 200,
      body: agentEnsuredResponseFixture
    }).success).toBe(false)
    expect(authenticatedCloudRequestSchema.safeParse({
      ...valid,
      payload: {
        protocolVersion: '1.0',
        requestId: TEST_IDS.requestId,
        type: 'agent.revoke',
        idempotencyKey: 'idem_agent_revoke_public_0001',
        agentId: TEST_IDS.agentId,
        expectedRevision: 1
      }
    }).success).toBe(false)
  })

  it('uses strict bounded JSON response envelopes', () => {
    const response = {
      contractVersion: 1,
      status: 200,
      body: {
        protocolVersion: '1.0',
        requestId: TEST_IDS.requestId,
        type: 'rest.entity',
        entity: resourceRef({})
      }
    } as const
    expect(authenticatedCloudResponseSchema.parse(response)).toEqual(response)
    expect(authenticatedCloudResponseSchema.safeParse({
      ...response,
      body: {
        ...response.body,
        entity: resourceRef({ nested: [{ api_key: FORBIDDEN_TEST_VALUE }] })
      }
    }).success).toBe(false)
    expect(authenticatedCloudResponseSchema.safeParse({
      ...response,
      authorization: FORBIDDEN_TEST_VALUE
    }).success).toBe(false)
    expect(authenticatedCloudResponseSchema.safeParse({
      contractVersion: 1,
      status: 401,
      body: {
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: TEST_IDS.requestId,
        error: {
          protocolVersion: '1.0',
          type: 'error',
          requestId: TEST_IDS.requestId,
          code: 'authentication_required',
          category: 'authentication',
          httpStatus: 401,
          retryable: false,
          message: 'Authentication is required.',
          details: { nested: [{ refreshToken: '[REDACTED]' }] }
        }
      }
    }).success).toBe(true)
    expect(authenticatedCloudResponseSchema.safeParse({
      contractVersion: 1,
      status: 401,
      body: {
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: TEST_IDS.requestId,
        error: {
          protocolVersion: '1.0',
          type: 'error',
          requestId: TEST_IDS.requestId,
          code: 'authentication_required',
          category: 'authentication',
          httpStatus: 401,
          retryable: false,
          message: 'Authentication is required.',
          details: { nested: [{ refreshToken: FORBIDDEN_TEST_VALUE }] }
        }
      }
    }).success).toBe(false)
    expect(authenticatedCloudResponseSchema.safeParse({
      contractVersion: 1,
      status: 401,
      body: {
        protocolVersion: '1.0',
        type: 'rest.error',
        requestId: TEST_IDS.requestId,
        error: {
          protocolVersion: '1.0',
          type: 'error',
          requestId: TEST_IDS.requestId,
          code: 'authentication_required',
          category: 'authentication',
          httpStatus: 401,
          retryable: false,
          message: 'A valid bearer credential is required.'
        }
      }
    }).success).toBe(true)
  })

  it('validates provider status and provider output', async () => {
    const transport = defineAuthenticatedCloudTransport({
      stageObject: async () => { throw new Error('Not exercised in JSON transport contract test.') },
      readObject: async () => { throw new Error('Not exercised in JSON transport contract test.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.example.test',
        userId: 'usr_CloudUser000001',
        deviceId: 'dev_CloudDevice0001',
        deviceRevision: 1
      }),
      execute: async (request) => ({
        contractVersion: 1,
        status: 200,
        body: {
          protocolVersion: '1.0',
          requestId: request.payload.requestId,
          type: 'rest.entity',
          entity: resourceRef({})
        }
      })
    })
    expect(transport.status()).toEqual({
      state: 'ready',
      baseUrl: 'https://cloud.example.test',
      userId: 'usr_CloudUser000001',
      deviceId: 'dev_CloudDevice0001',
      deviceRevision: 1
    })
    await expect(transport.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: projectListPayload()
    })).resolves.toMatchObject({ status: 200, body: { type: 'rest.entity' } })

    const drifted = defineAuthenticatedCloudTransport({
      stageObject: async () => { throw new Error('Not exercised in JSON transport contract test.') },
      readObject: async () => { throw new Error('Not exercised in JSON transport contract test.') },
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.example.test',
        userId: 'usr_CloudUser000001',
        deviceId: 'dev_CloudDevice0001',
        deviceRevision: 1
      }),
      execute: async () => ({
        contractVersion: 1,
        status: 200,
        body: null,
        token: FORBIDDEN_TEST_VALUE
      } as never)
    })
    await expect(drifted.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: projectListPayload()
    })).rejects.toBeDefined()
  })
})

function projectListPayload() {
  return {
    protocolVersion: '1.0' as const,
    requestId: TEST_IDS.requestId,
    type: 'project.list' as const,
    limit: 50
  }
}

function requirementsDraftPayload(identity: Record<string, DomainPackageJsonValue>) {
  return {
    protocolVersion: '1.0' as const, requestId: TEST_IDS.requestId,
    type: 'project.requirements.draft.save' as const, idempotencyKey: 'idem_requirements_save_0001',
    projectId: TEST_IDS.projectId, expectedProjectRevision: 3, expectedRequirementsRevision: 0,
    goalsDeliverables: 'One bounded report.', inputsBoundaries: 'Use the exact authorized object.',
    inputReferences: [objectLocator(identity)]
  }
}

function resourceRef(identity: Record<string, DomainPackageJsonValue>) {
  return {
    schemaVersion: 1 as const,
    revision: 1,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    type: 'resource_ref' as const,
    resourceRefId: TEST_IDS.resourceRefId,
    projectId: TEST_IDS.projectId,
    taskId: TEST_IDS.taskId,
    executionId: TEST_IDS.executionId,
    assignmentTaskRevision: 1,
    intentDigest: TEST_HASH,
    role: 'input-file' as const,
    ordinal: 0,
    locator: objectLocator(identity),
    locatorDigest: TEST_HASH,
    status: 'available' as const,
    invalidatedAt: null
  }
}

function objectLocator(extra: Record<string, DomainPackageJsonValue>) {
  return {
    kind: 'collaboration.object-reference' as const,
    source: { kind: 'shared_material' as const, materialRevisionId: 'mat_Material000001' },
    object: {
      objectId: 'obj_Object000001', objectKey: 'projects/test/immutable/object-one', revision: 1,
      sha256: TEST_HASH, byteCount: 12, mediaType: 'text/plain', projectId: TEST_IDS.projectId,
      visibility: 'project_public' as const, ownerUserId: TEST_IDS.userId, retentionUntil: null,
      ...extra
    }
  }
}
