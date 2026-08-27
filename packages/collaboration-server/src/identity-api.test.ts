import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import type { AgentActor, OidcUserActor, UserActor } from './actor.js'
import { createCollaborationHttpServer } from './api.js'
import { AuthenticationService } from './auth.js'
import { CollaborationServiceError } from './errors.js'
import { IdentityService } from './identity-service.js'
import { CollaborationService } from './service.js'
import { createDeviceFixture } from './test-fixtures/device-fixture.mjs'
import { IdentityFakeRepository } from './test-fixtures/identity-repository.js'

const timestamp = '2026-08-18T12:00:00.000Z'
const now = () => new Date(timestamp)
const servers: ReturnType<typeof createCollaborationHttpServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('production HTTP identity security boundary', () => {
  it('binds enrollment, Device list, and revoke to the exact OIDC owner with bounded idempotent requests', async () => {
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, now)
    const owner = await identities.resolveOidcUser(verifiedIdentity('owner'))
    const foreign = await identities.resolveOidcUser(verifiedIdentity('foreign'))
    const staleOwner = { ...owner, authTime: owner.authTime - 301 }
    const agent: AgentActor = {
      kind: 'agent_device', actorKey: 'agent:agt_identity_http_0001:credential:test',
      userId: owner.userId, agentId: 'agt_identity_http_0001', deviceId: 'dev_identity_http_0001',
      credentialId: 'credential_identity_http_0001', credentialGeneration: 1, assurance: 'device'
    }
    const actors = new Map<string, UserActor | AgentActor>([
      ['owner-token', owner], ['foreign-token', foreign], ['stale-owner-token', staleOwner], ['agent-token', agent]
    ])
    const server = createCollaborationHttpServer({
      service: new CollaborationService({ repository, now }),
      identities,
      authentication: {
        resolveRequestActor: async (request) => {
          const header = request.headers.authorization
          const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
          const actor = actors.get(token)
          if (!actor) throw new CollaborationServiceError('authentication_required', 'Authentication is required.')
          return actor
        }
      },
      readiness: async () => true,
      maxBodyBytes: 1_024
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    expect((await get(baseUrl, '/v1/me')).status).toBe(401)
    expect((await get(baseUrl, '/v1/me', 'agent-token')).status).toBe(403)
    const me = await json(await get(baseUrl, '/v1/me', 'owner-token'))
    expect(me).toMatchObject({ type: 'me', userId: owner.userId, status: 'active', revision: 1 })
    expect(JSON.stringify(me)).not.toMatch(/owner-subject|access.?token|refresh.?token/u)

    const enrollmentRequest = {
      installationId: 'ins_http_identity_stage3_0001',
      idempotencyKey: 'idem_http_identity_enrollment_0001'
    }
    expect((await post(baseUrl, '/v1/device-enrollments', enrollmentRequest)).status).toBe(401)
    const enrollmentResponse = await post(baseUrl, '/v1/device-enrollments', enrollmentRequest, 'owner-token')
    expect(enrollmentResponse.status).toBe(200)
    const enrollment = await json(enrollmentResponse) as { enrollmentId: string; nonce: string; expiresAt: string }
    expect(enrollment).toMatchObject({ expiresAt: '2026-08-18T12:05:00.000Z' })

    const replayedEnrollment = await post(baseUrl, '/v1/device-enrollments', enrollmentRequest, 'owner-token')
    expect(replayedEnrollment.status).toBe(409)
    await expectErrorCode(replayedEnrollment, 'idempotency_conflict')
    expect(repository.state.deviceEnrollments).toHaveLength(1)

    const headerMismatch = await post(baseUrl, '/v1/device-enrollments', enrollmentRequest, 'owner-token',
      'idem_http_identity_wrong_header')
    expect(headerMismatch.status).toBe(400)
    await expectErrorCode(headerMismatch, 'validation_error')
    expect(repository.state.deviceEnrollments).toHaveLength(1)

    const fixture = createDeviceFixture({
      ...enrollment,
      now: now(),
      userId: owner.userId,
      installationId: enrollmentRequest.installationId,
      capabilitySummary: ['agent-runtime', 'local-files']
    })
    const deviceRequest = {
      ...fixture.deviceRequest,
      nonce: enrollment.nonce,
      idempotencyKey: 'idem_http_identity_device_0001'
    }
    const createdResponse = await post(baseUrl, '/v1/devices', deviceRequest, 'owner-token')
    expect(createdResponse.status).toBe(200)
    const created = await json(createdResponse) as { device: { deviceId: string; revision: number } }
    expect(created.device).toMatchObject({ userId: owner.userId, status: 'active', revision: 1 })
    expect(JSON.stringify(created)).not.toMatch(/signature|nonce|private|credential|token/u)

    const duplicateDevice = await post(baseUrl, '/v1/devices', deviceRequest, 'owner-token')
    expect(duplicateDevice.status).toBe(200)
    expect(await json(duplicateDevice)).toEqual(created)
    expect(repository.state.devices).toHaveLength(1)

    const ownerDevices = await json(await get(baseUrl, '/v1/me/devices', 'owner-token')) as {
      devices: Array<{ deviceId: string }>
    }
    const foreignDevices = await json(await get(baseUrl, '/v1/me/devices', 'foreign-token'))
    expect(ownerDevices.devices.map(({ deviceId }) => deviceId)).toEqual([created.device.deviceId])
    expect(foreignDevices).toEqual({ devices: [] })

    const revokeBody = {
      deviceId: created.device.deviceId,
      idempotencyKey: 'idem_http_identity_revoke_0001'
    }
    const foreignRevoke = await del(baseUrl, `/v1/me/devices/${created.device.deviceId}`, revokeBody, 'foreign-token')
    expect(foreignRevoke.status).toBe(404)
    await expectErrorCode(foreignRevoke, 'not_found')

    const pathMismatch = await del(baseUrl, '/v1/me/devices/dev_identity_http_wrong', revokeBody, 'owner-token')
    expect(pathMismatch.status).toBe(400)
    await expectErrorCode(pathMismatch, 'validation_error')

    const staleRevoke = await del(baseUrl, `/v1/me/devices/${created.device.deviceId}`,
      { ...revokeBody, idempotencyKey: 'idem_http_identity_stale_revoke' }, 'stale-owner-token')
    expect(staleRevoke.status).toBe(403)
    await expectErrorCode(staleRevoke, 'assurance_insufficient')

    const revokedResponse = await del(baseUrl, `/v1/me/devices/${created.device.deviceId}`, revokeBody, 'owner-token')
    expect(revokedResponse.status).toBe(200)
    const revoked = await json(revokedResponse)
    expect(revoked).toMatchObject({ device: { deviceId: created.device.deviceId, status: 'revoked', revision: 2 } })

    const staleReplay = await del(baseUrl, `/v1/me/devices/${created.device.deviceId}`,
      revokeBody, 'stale-owner-token')
    expect(staleReplay.status).toBe(200)
    expect(await json(staleReplay)).toEqual(revoked)
    expect(repository.state.devices).toHaveLength(1)

    const secretMarker = 'must-not-reflect-oversized-identity-material'
    const oversized = await post(baseUrl, '/v1/device-enrollments', {
      installationId: `ins_${secretMarker.repeat(80)}`,
      idempotencyKey: 'idem_http_identity_oversized_0001'
    }, 'owner-token')
    expect(oversized.status).toBe(413)
    expect(await oversized.text()).not.toContain(secretMarker)
  })

  it('accepts an execution-fenced confirmable HumanNeeded decision only from the target OIDC User', async () => {
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, now)
    const actor = await identities.resolveOidcUser({
      ...verifiedIdentity('human-approval-target'),
      issuer: 'https://login-test.sciforge.cn/realms/SciForge'
    })
    const projectId = 'prj_ApprovalProj001'
    const taskId = 'tsk_ApprovalTask001'
    const executionId = 'exe_ApprovalExec001'
    const agentId = 'agt_ApprovalAgent01'
    const humanRequestId = 'hrq_ApprovalReq001'
    repository.state.projects.set(projectId, {
      projectId, ownerUserId: actor.userId, displayName: 'Approval project', goal: 'Approve action',
      contentMode: 'none', status: 'active', coordinatorAgentId: agentId,
      coordinatorAuthorityEpoch: 1, executionAuthorityEpoch: 1, contentOwnerUserId: null,
      budget: { maxTasks: 2, maxTasksPerRound: 2,
        maxTaskRetries: 1, maxCoordinationRounds: 2 }, coordinationRound: 1,
      revision: 1, createdAt: timestamp, updatedAt: timestamp
    })
    repository.state.tasks.set(taskId, {
      taskId, projectId, createdByCoordinatorAgentId: agentId, title: 'Approval task',
      objective: 'Await decision', completionCriteria: ['decision'], dependencyTaskIds: [],
      fileIntent: null, currentExecutionId: executionId, currentExecutionState: 'needs_human',
      status: 'needs_human', executionCount: 1, maxRetries: 1, coordinationRound: 1,
      revision: 1, createdAt: timestamp, updatedAt: timestamp, completedAt: null
    })
    repository.state.taskExecutions.set(executionId, {
      executionId, taskId, projectId, attempt: 1, offeredByCoordinatorAgentId: agentId,
      assigneeUserId: actor.userId, assigneeAgentId: agentId, assigneeDeviceId: 'dev_ApprovalDevice01',
      state: 'needs_human', stateRevision: 1,
      fence: { schemaVersion: 1, executionId, assigneeUserId: actor.userId,
        assigneeAgentId: agentId, assigneeDeviceId: 'dev_ApprovalDevice01', assignmentTaskRevision: 1,
        projectExecutionAuthorityEpoch: 1, userTaskAuthorityEpoch: 1, bindingRevision: null,
        status: 'open', reason: null, fencedAt: null },
      fileIntent: null, currentResultSubmissionId: null,
      offeredAt: timestamp, acceptedAt: timestamp, startedAt: timestamp, terminalAt: null,
      revision: 1, createdAt: timestamp, updatedAt: timestamp
    })
    repository.state.humanRequests.set(humanRequestId, {
      humanRequestId, projectId,
      context: { scope: 'worker_execution', taskId, executionId },
      targetUserId: actor.userId, requestedByAgentId: agentId,
      requiredAssurance: 'verified', prompt: 'Approve deletion?', confirmableAction: {
        actionType: 'workspace.delete_output', safeSummary: 'Delete generated output.',
        effect: 'destructive', actionDigest: 'b'.repeat(64)
      }, status: 'pending', revision: 1, expiresAt: new Date(now().getTime() + 60_000).toISOString(),
      createdAt: timestamp, updatedAt: timestamp
    })
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: () => true, resolve: async () => actor
    })
    const server = createCollaborationHttpServer({
      service: new CollaborationService({ repository, now }), authentication, identities,
      readiness: async () => true
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const command = { protocolVersion: '1.0', requestId: 'req_ApprovalAnswer01', type: 'human.answer',
      idempotencyKey: 'idem_identity_api_human_approval', humanRequestId, requestRevision: 1,
      answer: 'Approved', decision: 'approve' }
    const response = await post(baseUrl, '/v1/commands', command, 'header.payload.signature')
    expect(response.status, await response.clone().text()).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ entity: {
      answeredFrom: { type: 'oidc_user', oidcIdentityId: actor.identityId },
      decision: 'approve', confirmationId: expect.stringMatching(/^cfm_/u)
    } })
  })
})

function verifiedIdentity(label: string) {
  const epoch = Math.floor(now().getTime() / 1_000)
  return {
    issuer: 'https://identity.sciforge.test',
    subject: `${label}-subject`,
    audience: ['sciforge-cloud-api'],
    authorizedParty: 'sciforge-desktop',
    issuedAt: epoch,
    notBefore: epoch - 1,
    expiresAt: epoch + 3_600,
    authTime: epoch,
    preferredUsername: `${label}-user`
  }
}

function get(baseUrl: string, path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
}

function post(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token?: string,
  idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
): Promise<Response> {
  return request(baseUrl, path, 'POST', body, token, idempotencyKey)
}

function del(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token: string
): Promise<Response> {
  return request(baseUrl, path, 'DELETE', body, token,
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined)
}

function request(
  baseUrl: string,
  path: string,
  method: string,
  body: Record<string, unknown>,
  token?: string,
  idempotencyKey?: string
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
    },
    body: JSON.stringify(body)
  })
}

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>
}

async function expectErrorCode(response: Response, code: string): Promise<void> {
  await expect(json(response)).resolves.toMatchObject({ type: 'rest.error', error: { code } })
}
