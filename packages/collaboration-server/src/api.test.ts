import type { AddressInfo } from 'node:net'

import type { HumanEndpointProviderContract } from '@sciforge/collaboration-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'
import { createCollaborationHttpServer } from './api.js'
import { AuthenticationService } from './auth.js'
import { CollaborationService } from './service.js'
import { createAgentCredentialBootstrap, seedOidcUserDevice } from './test-fixtures/collaboration-identity.js'

const now = () => new Date('2026-08-15T02:00:00.000Z')
const servers: ReturnType<typeof createCollaborationHttpServer>[] = []

const providerContract: HumanEndpointProviderContract = {
  protocolVersion: '1.0',
  type: 'human_endpoint_provider_contract',
  provider: 'fake-im',
  displayName: 'Fake IM',
  capabilities: {
    textMessages: true,
    stableLocators: true,
    eventCursor: true,
    locatorRename: true,
    locatorMove: true,
    locatorDiscovery: true,
    identityChallenge: true,
    directMessages: true,
    managedContainers: false
  },
  onboarding: { realmLabel: 'Realm', accountLabel: 'Account', containerLabel: 'Stream', topicLabel: 'Topic' },
  limits: { maxTextLength: 10_000, maxLocatorDisplayLength: 200 }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('production HTTP OIDC-only boundary', () => {
  it('requires OIDC for catalog and endpoint binding while never returning a second User credential', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = await seedOidcUserDevice(repository, 'http-oidc-user', now())
    const token = 'header.payload.signature'
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: (candidate) => candidate === token,
      resolve: async () => identity.user
    })
    const server = createCollaborationHttpServer({
      service,
      authentication,
      readiness: async () => true,
      maxBodyBytes: 1_024,
      providers: {
        contracts: () => [providerContract],
        listLocators: async () => ({ locators: [] })
      }
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    const anonymousCatalog = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_BootstrapCatalog01', type: 'endpoint.catalog.get'
    })
    expect(anonymousCatalog.status).toBe(401)

    const catalog = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_BootstrapCatalog02', type: 'endpoint.catalog.get'
    }, token)
    expect(catalog.status).toBe(200)
    await expect(catalog.json()).resolves.toMatchObject({
      type: 'endpoint.catalog', providers: [{ provider: 'fake-im' }]
    })

    const createBody = {
      protocolVersion: '1.0', requestId: 'req_EndpointChallenge01', type: 'endpoint.challenge.create',
      idempotencyKey: 'idem_endpoint_challenge_01',
      expectedIdentity: { provider: 'fake-im', realmId: 'fake-realm', providerUserId: 'provider-user-01' }
    }
    expect((await postCommand(baseUrl, createBody)).status).toBe(401)
    const createdResponse = await postCommand(baseUrl, createBody, token)
    expect(createdResponse.status).toBe(200)
    const created = await createdResponse.json() as { challengeId: string }
    expect(created).toMatchObject({ type: 'endpoint.challenge.created' })
    expect(JSON.stringify(created)).not.toMatch(/pollSecret|userCredential/u)

    const pending = await postCommand(baseUrl, { protocolVersion: '1.0', requestId: 'req_EndpointChallenge02',
      type: 'endpoint.challenge.get', challengeId: created.challengeId }, token)
    expect(pending.status).toBe(200)
    await expect(pending.json()).resolves.toMatchObject({ type: 'endpoint.challenge.pending' })

    const legacy = await postCommand(baseUrl, { protocolVersion: '1.0', requestId: 'req_LegacyPairing01',
      type: 'pairing.begin', idempotencyKey: 'idem_legacy_pairing_01', provider: 'fake-im',
      realmId: 'fake-realm', requestedDisplayName: 'Legacy' }, token)
    expect(legacy.status).toBe(400)

    const oversized = await fetch(`${baseUrl}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: '1.0', requestId: 'req_BootstrapOversize1',
        type: 'endpoint.catalog.get', padding: 'x'.repeat(2_000) })
    })
    expect(oversized.status).toBe(413)
    const oversizedText = await oversized.text()
    expect(oversizedText).not.toContain('x'.repeat(64))
  })

  it('preserves parsed command request IDs across validation, actor, and service errors only', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = await seedOidcUserDevice(repository, 'http-error-correlation', now())
    const token = 'header.error-correlation.signature'
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: (candidate) => candidate === token,
      resolve: async () => identity.user
    })
    const server = createCollaborationHttpServer({ service, authentication, readiness: async () => true })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const challenge = {
      protocolVersion: '1.0',
      requestId: 'req_ErrorValidation001',
      type: 'endpoint.challenge.create',
      idempotencyKey: 'idem_error_validation_001',
      expectedIdentity: {
        provider: 'fake-im',
        realmId: 'fake-realm',
        providerUserId: 'provider-error-user'
      }
    }
    const validation = await fetch(`${baseUrl}/v1/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem_wrong_header_value'
      },
      body: JSON.stringify(challenge)
    })
    await expect(validation.json()).resolves.toMatchObject({
      type: 'rest.error',
      requestId: challenge.requestId,
      error: { code: 'validation_error' }
    })

    const actor = await postCommand(baseUrl, {
      ...challenge,
      requestId: 'req_ErrorActor000001',
      idempotencyKey: 'idem_error_actor_001'
    })
    await expect(actor.json()).resolves.toMatchObject({
      type: 'rest.error',
      requestId: 'req_ErrorActor000001',
      error: { code: 'authentication_required' }
    })

    const serviceFailure = await postCommand(baseUrl, {
      protocolVersion: '1.0',
      requestId: 'req_ErrorService0001',
      type: 'project.get',
      projectId: 'prj_MissingProject01'
    }, token)
    await expect(serviceFailure.json()).resolves.toMatchObject({
      type: 'rest.error',
      requestId: 'req_ErrorService0001',
      error: { code: 'not_found' }
    })

    const unparsedRequestId = 'req_ErrorUnparsed001'
    const secretMarker = 'must-not-leak-private-command-material'
    const unparsed = await postCommand(baseUrl, {
      protocolVersion: '1.0',
      requestId: unparsedRequestId,
      type: 'project.get',
      projectId: 'prj_MissingProject01',
      privateMaterial: secretMarker
    }, token)
    const unparsedBody = await unparsed.json() as {
      requestId: string
      error: { message: string }
    }
    expect(unparsedBody.requestId).toMatch(/^req_[A-Za-z0-9]{12,64}$/u)
    expect(unparsedBody.requestId).not.toBe(unparsedRequestId)
    expect(JSON.stringify(unparsedBody)).not.toContain(secretMarker)
  })

  it('serves the canonical Provider directory and OIDC-derived atomic Project create responses', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = await seedOidcUserDevice(repository, 'http-cloud-owner', now())
    const coordinator = await service.registerAgent(identity.user, {
      deviceId: identity.deviceId, displayName: 'HTTP Coordinator', nodeType: 'desktop',
      capabilities: ['project.coordinate'],
      credentialBootstrapPublicKey: createAgentCredentialBootstrap().publicKey,
      idempotencyKey: 'idem_http_cloud_coordinator'
    })
    const token = 'header.cloud.signature'
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: (candidate) => candidate === token,
      resolve: async () => identity.user
    })
    const server = createCollaborationHttpServer({ service, authentication, readiness: async () => true })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const providerFact = {
      protocolVersion: '1.0', requestId: 'req_HttpProviderFact01',
      type: 'provider_directory_principal.publish', idempotencyKey: 'idem_http_provider_fact_01',
      providerPrincipalFactId: null, expectedFactRevision: null,
      deviceId: identity.deviceId, expectedDeviceRevision: 1,
      providerPrincipal: { schemaVersion: 1, type: 'provider_directory_principal_reference',
        providerInstance: { schemaVersion: 1, type: 'provider_instance_reference',
          providerInstanceRef: 'opencontent.run0' },
        principalKind: 'user', principalId: 'provider-http-owner' },
      principalIdentityRevision: 1, providerBindingAttestationDigest: 'a'.repeat(64),
      readiness: 'ready', readinessReason: null, observedAt: now().toISOString()
    }
    const published = await postCommand(baseUrl, providerFact, token)
    expect(published.status).toBe(200)
    await expect(published.json()).resolves.toMatchObject({ type: 'rest.entity',
      entity: { type: 'provider_directory_principal_fact', userId: identity.userId } })
    const page = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_HttpProviderPage01',
      type: 'provider_directory_principal.list', userIds: [identity.userId],
      providerInstance: providerFact.providerPrincipal.providerInstance,
      includeDegraded: false, limit: 10
    }, token)
    expect(page.status).toBe(200)
    await expect(page.json()).resolves.toMatchObject({ type: 'rest.provider_directory_principal_page',
      items: [{ userId: identity.userId }] })
    const project = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_HttpProjectCreate1', type: 'project.create',
      idempotencyKey: 'idem_http_project_create_01', displayName: 'HTTP meeting',
      goal: 'Verify the canonical atomic response.', coordinatorAgentId: coordinator.agent.agentId,
      expectedCoordinatorAgentRevision: coordinator.agent.revision,
      budget: { maxTasks: 5, maxTasksPerRound: 5, maxTaskRetries: 1, maxCoordinationRounds: 2 },
      content: { mode: 'none', members: [{ userId: identity.userId }] }
    }, token)
    expect(project.status).toBe(200)
    const projectBody = await project.json() as { project: { projectId: string } }
    expect(projectBody).toMatchObject({ type: 'rest.project_created',
      project: { ownerUserId: identity.userId, status: 'paused', contentMode: 'none' },
      memberships: [{ userId: identity.userId, state: 'active' }], provisioningIntent: null })

    const projects = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_HttpProjectPage001', type: 'project.list', limit: 10
    }, token)
    expect(projects.status).toBe(200)
    await expect(projects.json()).resolves.toMatchObject({ type: 'rest.project_page', limit: 10,
      projects: [{ projectId: projectBody.project.projectId, ownerUserId: identity.userId }] })

    const coordination = await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_HttpProjectRead001', type: 'project.coordination.read',
      projectId: projectBody.project.projectId,
      collections: [{ collection: 'memberships', limit: 10 }]
    }, token)
    expect(coordination.status).toBe(200)
    await expect(coordination.json()).resolves.toMatchObject({ type: 'rest.project_coordination',
      project: { projectId: projectBody.project.projectId },
      pages: [{ collection: 'memberships', limit: 10,
        items: [{ userId: identity.userId, state: 'active' }] }], finalSummary: null })

    const coordinatorOnlyCommands: Record<string, unknown>[] = [{
      protocolVersion: '1.0', requestId: 'req_HttpDecision00001',
      type: 'project.decision.submit', idempotencyKey: 'idem_http_decision_owner_bypass',
      projectId: projectBody.project.projectId,
      humanRequestId: 'hrq_Request000001', humanAnswerId: 'han_Answer0000001',
      expectedProjectRevision: 1, expectedCoordinatorAuthorityEpoch: 1,
      expectedHumanRequestRevision: 2, expectedHumanAnswerRevision: 1,
      decision: 'Owner HCI must not write this record directly.'
    }, {
      protocolVersion: '1.0', requestId: 'req_HttpReview000001',
      type: 'task.result.review', idempotencyKey: 'idem_http_review_owner_bypass',
      projectId: projectBody.project.projectId,
      taskId: 'tsk_Task00000001', executionId: 'exe_Exec00000001',
      resultSubmissionId: 'rsu_Result000001', expectedProjectRevision: 1,
      expectedTaskRevision: 1, expectedExecutionRevision: 1, expectedResultRevision: 1,
      expectedCoordinatorAuthorityEpoch: 1, decision: 'accept', instruction: null,
      nextAssigneeAgentId: null, expectedNextAssigneeAvailabilityRevision: null,
      nextOfferExpiresAt: null, nextFileIntent: null
    }, {
      protocolVersion: '1.0', requestId: 'req_HttpSummary00001',
      type: 'project.final_summary.submit', idempotencyKey: 'idem_http_summary_owner_bypass',
      projectId: projectBody.project.projectId, expectedProjectRevision: 1,
      expectedCoordinatorAuthorityEpoch: 1, expectedExecutionAuthorityEpoch: 1,
      projectPlanId: 'pln_ProjectPlan01', confirmedPlanRevision: 1,
      acceptedResultSubmissionIds: ['rsu_Result000001'],
      summary: 'Owner HCI must not complete the Project directly.'
    }]
    for (const command of coordinatorOnlyCommands) {
      expect((await postCommand(baseUrl, command, token)).status).toBe(403)
    }

    expect((await postCommand(baseUrl, {
      protocolVersion: '1.0', requestId: 'req_HttpLegacyRecord1',
      type: 'project_record.submit', idempotencyKey: 'idem_http_legacy_record_bypass',
      projectId: projectBody.project.projectId, kind: 'observation',
      sourceTaskId: 'tsk_Task00000001', sourceRevision: 1, body: 'Bypass'
    }, token)).status).toBe(400)
  })
})

function postCommand(baseUrl: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
  return fetch(`${baseUrl}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
}
