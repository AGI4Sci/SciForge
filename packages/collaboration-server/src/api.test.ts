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

    const replayedChallenge = await postCommand(baseUrl, createBody, token)
    expect(replayedChallenge.status).toBe(409)
    await expect(replayedChallenge.json()).resolves.toMatchObject({
      type: 'rest.error', error: { code: 'idempotency_conflict' }
    })

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const withinWindow = await postCommand(baseUrl, {
        ...createBody,
        requestId: `req_EndpointRate000${attempt}`,
        idempotencyKey: `idem_endpoint_rate_000${attempt}`
      }, token)
      expect(withinWindow.status).toBe(200)
    }
    const rateLimited = await postCommand(baseUrl, {
      ...createBody,
      requestId: 'req_EndpointRate0006',
      idempotencyKey: 'idem_endpoint_rate_0006'
    }, token)
    expect(rateLimited.status).toBe(429)
    await expect(rateLimited.json()).resolves.toMatchObject({
      type: 'rest.error',
      requestId: 'req_EndpointRate0006',
      error: { code: 'rate_limited', retryable: true }
    })

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

  it('binds Inbox pages and durable idempotent ACKs to the authenticated recipient', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const owner = await seedOidcUserDevice(repository, 'http-inbox-owner', now())
    const outsider = await seedOidcUserDevice(repository, 'http-inbox-outsider', now())
    const ownerToken = 'ownerInboxHeader.ownerInboxPayload.ownerInboxSignature'
    const outsiderToken = 'otherInboxHeader.otherInboxPayload.otherInboxSignature'
    const authentication = new AuthenticationService(repository, now, {
      isCandidate: (candidate) => candidate === ownerToken || candidate === outsiderToken,
      resolve: async (candidate) => candidate === ownerToken ? owner.user : outsider.user
    })
    await repository.transaction(async (tx) => {
      await tx.appendInbox({
        recipient: { kind: 'user', id: owner.userId },
        messageId: 'ibx_OwnerInbox0001',
        messageType: 'collaboration.important_failure',
        payload: { protocolVersion: '1.0', safeMessage: 'Coordinator recovery needs an explicit owner decision.' },
        createdAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + 60_000).toISOString()
      })
      await tx.appendInbox({
        recipient: { kind: 'user', id: owner.userId },
        messageId: 'ibx_OwnerInbox0002',
        messageType: 'collaboration.important_failure',
        payload: { protocolVersion: '1.0', safeMessage: 'A later fact advances the durable cursor.' },
        createdAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + 60_000).toISOString()
      })
      await tx.appendInbox({
        recipient: { kind: 'user', id: outsider.userId },
        messageId: 'ibx_OtherInbox0001',
        messageType: 'collaboration.important_failure',
        payload: { protocolVersion: '1.0', safeMessage: 'This fact belongs only to the other principal.' },
        createdAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + 60_000).toISOString()
      })
    })
    const server = createCollaborationHttpServer({ service, authentication, readiness: async () => true })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const pull = {
      protocolVersion: '1.0', requestId: 'req_InboxPullOwner001', type: 'inbox.pull',
      recipientType: 'user', afterSequence: 0, limit: 200
    }

    expect((await postCommand(baseUrl, pull)).status).toBe(401)
    expect((await postCommand(baseUrl, { ...pull, recipientType: 'agent' }, ownerToken)).status).toBe(403)
    expect((await postCommand(baseUrl, { ...pull, limit: 201 }, ownerToken)).status).toBe(400)

    const firstPageResponse = await postCommand(baseUrl, pull, ownerToken)
    expect(firstPageResponse.status).toBe(200)
    const firstPage = await firstPageResponse.json() as {
      messages: Array<{ inboxMessageId: string; recipientUserId: string; payload: { safeMessage: string } }>
      nextSequence: number
    }
    expect(firstPage).toMatchObject({
      type: 'rest.inbox_page',
      nextSequence: 2,
      messages: [
        { inboxMessageId: 'ibx_OwnerInbox0001', recipientUserId: owner.userId },
        { inboxMessageId: 'ibx_OwnerInbox0002', recipientUserId: owner.userId }
      ]
    })
    expect(JSON.stringify(firstPage)).not.toContain('This fact belongs only to the other principal.')
    const duplicatePage = await (await postCommand(baseUrl, pull, ownerToken)).json()
    expect(duplicatePage).toEqual(firstPage)
    const emptyPage = await (await postCommand(baseUrl, {
      ...pull, requestId: 'req_InboxPullOwner002', afterSequence: 2
    }, ownerToken)).json()
    expect(emptyPage).toMatchObject({ type: 'rest.inbox_page', messages: [], nextSequence: 2 })

    const ack = {
      protocolVersion: '1.0', requestId: 'req_InboxAckOwner0001', type: 'inbox.ack',
      idempotencyKey: 'idem_inbox_ack_owner_0001', inboxMessageId: 'ibx_OwnerInbox0001', sequence: 1
    }
    expect((await postCommand(baseUrl, ack, outsiderToken)).status).toBe(404)
    expect((await postCommand(baseUrl, { ...ack, inboxMessageId: 'ibx_OtherInbox0001' }, ownerToken)).status).toBe(404)

    const firstAckResponse = await postCommand(baseUrl, ack, ownerToken)
    expect(firstAckResponse.status).toBe(200)
    const firstAck = await firstAckResponse.json()
    expect(firstAck).toMatchObject({
      type: 'rest.receipt',
      receipt: {
        type: 'inbox.receipt',
        inboxMessageId: 'ibx_OwnerInbox0001',
        recipientType: 'user',
        sequence: 1,
        acknowledgedAt: now().toISOString(),
        createdAt: now().toISOString()
      }
    })
    const duplicateAck = await (await postCommand(baseUrl, ack, ownerToken)).json()
    expect(duplicateAck).toEqual(firstAck)
    expect((await postCommand(baseUrl, { ...ack, sequence: 2 }, ownerToken)).status).toBe(409)

    const secondAck = {
      ...ack,
      requestId: 'req_InboxAckOwner0002',
      idempotencyKey: 'idem_inbox_ack_owner_0002',
      inboxMessageId: 'ibx_OwnerInbox0002',
      sequence: 2
    }
    expect((await postCommand(baseUrl, secondAck, ownerToken)).status).toBe(200)
    const staleAck = {
      ...ack,
      requestId: 'req_InboxAckOwnerStale1',
      idempotencyKey: 'idem_inbox_ack_owner_stale_0001'
    }
    expect((await postCommand(baseUrl, staleAck, ownerToken)).status).toBe(200)

    await expect(service.pullInbox(owner.user, { afterSequence: 0, limit: 200 })).resolves.toMatchObject({
      ackedSequence: 2,
      nextSequence: 3
    })
    await expect(repository.getReceipt(owner.user.actorKey, ack.idempotencyKey)).resolves.toMatchObject({
      operation: 'inbox.ack',
      resourceKind: 'inbox_message',
      resourceId: 'ibx_OwnerInbox0001',
      response: { inboxMessageId: 'ibx_OwnerInbox0001', acknowledgedAt: now().toISOString() }
    })
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

  it('returns the strict Worker availability entity after an Agent heartbeat commit', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now })
    const identity = await seedOidcUserDevice(repository, 'http-worker-availability', now())
    const bootstrap = createAgentCredentialBootstrap()
    const capabilities = ['agent-runtime.codex', 'model-access.coding-plan']
    const registered = await service.registerAgent(identity.user, {
      deviceId: identity.deviceId,
      displayName: 'HTTP Worker',
      nodeType: 'desktop',
      capabilities,
      credentialBootstrapPublicKey: bootstrap.publicKey,
      idempotencyKey: 'idem_http_worker_agent_register'
    })
    const agentCredential = bootstrap.open(registered.sealedCredential!)
    const server = createCollaborationHttpServer({
      service,
      authentication: new AuthenticationService(repository, now),
      readiness: async () => true
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const heartbeatResponse = await postCommand(baseUrl, {
      protocolVersion: '1.0',
      requestId: 'req_HttpWorkerHeartbeat1',
      type: 'agent.heartbeat',
      idempotencyKey: 'idem_http_worker_heartbeat_01',
      agentId: registered.agent.agentId,
      expectedRevision: registered.agent.revision,
      connectionStatus: 'online',
      capabilities
    }, agentCredential)
    expect(heartbeatResponse.status).toBe(200)
    const heartbeat = await heartbeatResponse.json() as {
      entity: { revision: number; lastSeenAt: string }
    }
    expect(heartbeat).toMatchObject({
      type: 'rest.entity',
      entity: {
        type: 'agent_node',
        agentId: registered.agent.agentId,
        connectionStatus: 'online'
      }
    })

    const availabilityResponse = await postCommand(baseUrl, {
      protocolVersion: '1.0',
      requestId: 'req_HttpWorkerAvailable1',
      type: 'worker.availability.publish',
      idempotencyKey: 'idem_http_worker_availability_01',
      agentId: registered.agent.agentId,
      expectedAgentRevision: heartbeat.entity.revision,
      connectionStatus: 'online',
      lastHeartbeatAt: heartbeat.entity.lastSeenAt,
      runtimeReadiness: 'ready',
      runtimeCapabilityTags: capabilities,
      acceptsNewOffers: true,
      activeTaskCount: 0,
      observedAt: now().toISOString()
    }, agentCredential)
    expect(availabilityResponse.status).toBe(200)
    await expect(availabilityResponse.json()).resolves.toMatchObject({
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: 'req_HttpWorkerAvailable1',
      entity: {
        type: 'worker_availability_projection',
        agentId: registered.agent.agentId,
        connectionStatus: 'online',
        lastHeartbeatAt: heartbeat.entity.lastSeenAt,
        runtimeCapabilityTags: capabilities,
        acceptsNewOffers: true
      }
    })
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
