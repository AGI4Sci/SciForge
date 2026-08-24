import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { createCollaborationHttpServer } from './api.js'
import { AuthenticationService } from './auth.js'
import { IdentityService } from './identity-service.js'
import { CollaborationService } from './service.js'
import { createDeviceFixture } from './test-fixtures/device-fixture.mjs'
import { IdentityFakeRepository } from './test-fixtures/identity-repository.js'

const at = new Date('2026-08-18T12:00:00.000Z')
const now = () => new Date(at)
const servers: ReturnType<typeof createCollaborationHttpServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('A identity HTTP boundary', () => {
  it('serves only strict OIDC me and Device routes with body/header idempotency binding', async () => {
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, now)
    const seconds = Math.floor(at.getTime() / 1_000)
    const actor = await identities.resolveOidcUser({
      issuer: 'https://login-test.sciforge.cn/realms/SciForge', subject: 'identity-api-owner',
      audience: ['sciforge-cloud-api'], authorizedParty: 'sciforge-desktop', issuedAt: seconds,
      notBefore: seconds - 1, expiresAt: seconds + 300, authTime: seconds, preferredUsername: 'api-owner'
    })
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: () => true,
      resolve: async () => actor
    })
    const server = createCollaborationHttpServer({
      service: new CollaborationService({ repository, now }), authentication, identities,
      readiness: async () => true, now
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const headers = { authorization: ['Bearer', 'header.payload.signature'].join(' ') }

    expect((await fetch(`${baseUrl}/v1/me`, { headers })).status).toBe(200)
    expect((await fetch(`${baseUrl}/v1/me`)).status).toBe(401)

    const enrollmentBody = {
      installationId: 'ins_identity_api_0001', idempotencyKey: 'idem_identity_api_enrollment'
    }
    const missingHeader = await jsonRequest(`${baseUrl}/v1/device-enrollments`, enrollmentBody, headers)
    expect(missingHeader.status).toBe(400)
    const enrollmentResponse = await jsonRequest(`${baseUrl}/v1/device-enrollments`, enrollmentBody, {
      ...headers, 'idempotency-key': enrollmentBody.idempotencyKey
    })
    expect(enrollmentResponse.status).toBe(200)
    const enrollment = await enrollmentResponse.json() as { enrollmentId: string; nonce: string; expiresAt: string }
    const fixture = createDeviceFixture({ ...enrollment, userId: actor.userId,
      installationId: enrollmentBody.installationId })
    const deviceBody = {
      ...fixture.deviceRequest, nonce: enrollment.nonce, idempotencyKey: 'idem_identity_api_device'
    }
    const deviceResponse = await jsonRequest(`${baseUrl}/v1/devices`, deviceBody, {
      ...headers, 'idempotency-key': deviceBody.idempotencyKey
    })
    expect(deviceResponse.status).toBe(200)
    const created = await deviceResponse.json() as { device: { deviceId: string } }

    const devices = await fetch(`${baseUrl}/v1/me/devices`, { headers })
    expect(devices.status).toBe(200)
    await expect(devices.json()).resolves.toMatchObject({ devices: [{ deviceId: created.device.deviceId }] })

    const revokeBody = { deviceId: created.device.deviceId, idempotencyKey: 'idem_identity_api_revoke' }
    const wrongPath = await jsonRequest(`${baseUrl}/v1/me/devices/dev_wrong00000001`, revokeBody, {
      ...headers, 'idempotency-key': revokeBody.idempotencyKey
    }, 'DELETE')
    expect(wrongPath.status).toBe(400)
    const revoked = await jsonRequest(`${baseUrl}/v1/me/devices/${created.device.deviceId}`, revokeBody, {
      ...headers, 'idempotency-key': revokeBody.idempotencyKey
    }, 'DELETE')
    expect(revoked.status).toBe(200)
    await expect(revoked.json()).resolves.toMatchObject({ device: { status: 'revoked' } })
  })

  it('accepts an execution-fenced confirmable HumanNeeded decision only from the target OIDC User', async () => {
    const repository = new IdentityFakeRepository()
    const identities = new IdentityService(repository, now)
    const seconds = Math.floor(at.getTime() / 1_000)
    const actor = await identities.resolveOidcUser({
      issuer: 'https://login-test.sciforge.cn/realms/SciForge', subject: 'human-approval-target',
      audience: ['sciforge-cloud-api'], authorizedParty: 'sciforge-desktop', issuedAt: seconds,
      notBefore: seconds - 1, expiresAt: seconds + 300, authTime: seconds, preferredUsername: 'approval-target'
    })
    const projectId = 'prj_ApprovalProj001'
    const taskId = 'tsk_ApprovalTask001'
    const executionId = 'exe_ApprovalExec001'
    const agentId = 'agt_ApprovalAgent01'
    const humanRequestId = 'hrq_ApprovalReq001'
    repository.state.projects.set(projectId, {
      projectId, ownerUserId: actor.userId, displayName: 'Approval project', goal: 'Approve action',
      status: 'active', coordinatorAgentId: agentId, budget: { maxTasks: 2, maxTasksPerRound: 2,
        maxTaskRetries: 1, maxCoordinationRounds: 2 }, tasksCreated: 1, coordinationRound: 1,
      revision: 1, createdAt: at.toISOString(), updatedAt: at.toISOString()
    })
    repository.state.tasks.set(taskId, {
      taskId, projectId, title: 'Approval task', objective: 'Await decision', completionCriteria: ['decision'],
      dependencyTaskIds: [], assigneeAgentId: agentId, status: 'needs_human', retryCount: 0,
      coordinationRound: 1, executionFence: { executionId, assigneeAgentId: agentId, taskRevision: 1,
        bindingRevision: 1, intentDigest: 'a'.repeat(64) }, fileIntent: null, revision: 1,
      createdAt: at.toISOString(), updatedAt: at.toISOString()
    })
    repository.state.humanRequests.set(humanRequestId, {
      humanRequestId, projectId, taskId, executionId, targetUserId: actor.userId, requestedByAgentId: agentId,
      requiredAssurance: 'verified', prompt: 'Approve deletion?', confirmableAction: {
        actionType: 'workspace.delete_output', safeSummary: 'Delete generated output.',
        effect: 'destructive', actionDigest: 'b'.repeat(64)
      }, status: 'pending', revision: 1, expiresAt: new Date(at.getTime() + 60_000).toISOString(),
      createdAt: at.toISOString(), updatedAt: at.toISOString()
    })
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: () => true, resolve: async () => actor
    })
    const server = createCollaborationHttpServer({
      service: new CollaborationService({ repository, now }), authentication, identities,
      readiness: async () => true, now
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
    const response = await jsonRequest(`${baseUrl}/v1/commands`, command, {
      authorization: ['Bearer', 'header.payload.signature'].join(' '), 'idempotency-key': command.idempotencyKey
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ entity: {
      answeredFromHumanEndpointId: null, answeredFromOidcIdentityId: actor.identityId,
      decision: 'approve', confirmationId: expect.stringMatching(/^cfm_/u)
    } })
  })
})

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  method = 'POST'
): Promise<Response> {
  return fetch(url, {
    method,
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}
