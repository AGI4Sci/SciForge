import {
  CURRENT_PROTOCOL_VERSION,
  type HumanEndpointProvider,
  type ProviderEvent,
  type ProviderLifecycleRequest,
  type ProviderLifecycleResult,
  type ProviderDiagnostic,
  type ProviderSendRequest,
  type ProviderSendResult,
  type ProviderManagedContainerRequest,
  type ProviderManagedContainerResult,
  type ProviderLocatorListRequest,
  type ProviderLocatorListResult
} from '@sciforge/collaboration-contracts'
import { describe, expect, it } from 'vitest'
import { FakeCollaborationRepository } from '../../../test-fixtures/collaboration/fake-adapters.mjs'

import { DefaultCollaborationProviderRuntime } from './provider-runtime.js'
import { ProviderRuntimeStore } from './provider-runtime-store.js'
import { CollaborationServiceError } from './errors.js'
import { CollaborationService, providerIdentityInboxId } from './service.js'

const LOCATOR = {
  type: 'provider_locator' as const,
  provider: 'fake',
  realmId: 'realm-1',
  containerId: 'stream-1',
  topicId: 'topic-1',
  topicDisplayName: '固定 Session'
}

function managedContainerPolicy() {
  return {
    version: 1 as const, visibility: 'private' as const, history: 'protected' as const,
    membership: 'owner_and_message_bot' as const, memberManagement: 'provisioning_service_only' as const,
    channelManagement: 'provisioning_service_only' as const, ownerCanSend: true as const,
    ownerCanCreateTopics: true as const, messageBotCanSend: true as const,
    messageBotCreatesProjectTopics: false as const
  }
}

describe('provider runtime', () => {
  it('scopes locator discovery to the authenticated owner managed Channel', async () => {
    const repository = new FakeCollaborationRepository()
    const at = '2026-08-15T00:00:00.000Z'
    await repository.insertEndpoint({
      humanEndpointId: 'hep_123456789012', userId: 'usr_123456789012', provider: 'fake', realmId: 'realm-1',
      providerUserId: '42', displayName: 'Owner endpoint', assurance: 'verified', status: 'active',
      revision: 1, verifiedAt: at, updatedAt: at
    })
    await repository.insertManagedContainer({
      managedContainerId: 'mco_123456789012', ownerUserId: 'usr_123456789012',
      humanEndpointId: 'hep_123456789012', provider: 'fake', realmId: 'realm-1', ownerProviderUserId: '42',
      stableKey: 'managed-owner-realm', displayName: 'sciforge-owner', externalContainerId: 'owner-channel',
      policy: managedContainerPolicy(), status: 'active', revision: 2, createdAt: at, updatedAt: at
    })
    await repository.insertManagedContainer({
      managedContainerId: 'mco_123456789013', ownerUserId: 'usr_123456789013',
      humanEndpointId: 'hep_123456789013', provider: 'fake', realmId: 'realm-1', ownerProviderUserId: '43',
      stableKey: 'managed-other-realm', displayName: 'sciforge-other', externalContainerId: 'other-channel',
      policy: managedContainerPolicy(), status: 'active', revision: 2, createdAt: at, updatedAt: at
    })
    const provider = new FakeProvider([])
    provider.contract.capabilities.managedContainers = true
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: new FakeRuntimeStore(), repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: emptyService()
    })

    await expect(runtime.listLocators({
      actor: { kind: 'user', actorKey: 'user:usr_123456789012', userId: 'usr_123456789012',
        credentialId: 'credential-owner', assurance: 'verified' },
      humanEndpointId: 'hep_123456789012', limit: 50
    })).resolves.toEqual({ locators: [] })

    expect(provider.locatorListRequests).toHaveLength(1)
    expect(provider.locatorListRequests[0]).toMatchObject({
      container: { containerId: 'owner-channel' },
      containerDisplayName: 'sciforge-owner'
    })
    expect(JSON.stringify(provider.locatorListRequests)).not.toContain('other-channel')

    provider.locatorListResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.locator.page',
      locators: [{ ...LOCATOR, containerId: 'other-channel' }]
    }
    await expect(runtime.listLocators({
      actor: { kind: 'user', actorKey: 'user:usr_123456789012', userId: 'usr_123456789012',
        credentialId: 'credential-owner', assurance: 'verified' },
      humanEndpointId: 'hep_123456789012', limit: 50
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('preserves provider-neutral locator discovery for providers without managed containers', async () => {
    const repository = new FakeCollaborationRepository()
    const at = '2026-08-15T00:00:00.000Z'
    await repository.insertEndpoint({
      humanEndpointId: 'hep_123456789012', userId: 'usr_123456789012', provider: 'fake', realmId: 'realm-1',
      providerUserId: '42', displayName: 'Owner endpoint', assurance: 'verified', status: 'active',
      revision: 1, verifiedAt: at, updatedAt: at
    })
    const provider = new FakeProvider([])
    provider.locatorListResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.locator.page',
      locators: [LOCATOR]
    }
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: new FakeRuntimeStore(), repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: emptyService()
    })

    await expect(runtime.listLocators({
      actor: { kind: 'user', actorKey: 'user:usr_123456789012', userId: 'usr_123456789012',
        credentialId: 'credential-owner', assurance: 'verified' },
      humanEndpointId: 'hep_123456789012', limit: 50
    })).resolves.toEqual({ locators: [LOCATOR] })
    expect(provider.locatorListRequests[0]?.container).toBeUndefined()
  })

  it('fails queued managed jobs when no managed-container provider is installed', async () => {
    const repository = new FakeCollaborationRepository()
    const at = '2026-08-15T00:00:00.000Z'
    await repository.insertEndpoint({
      humanEndpointId: 'hep_123456789012', userId: 'usr_123456789012', provider: 'missing', realmId: 'realm-1',
      providerUserId: '42', displayName: 'Owner endpoint', assurance: 'verified', status: 'active',
      revision: 1, verifiedAt: at, updatedAt: at
    })
    await repository.insertManagedContainer({
      managedContainerId: 'mco_123456789012', ownerUserId: 'usr_123456789012',
      humanEndpointId: 'hep_123456789012', provider: 'missing', realmId: 'realm-1', ownerProviderUserId: '42',
      stableKey: 'managed-owner-realm', displayName: 'sciforge-owner', externalContainerId: 'owner-channel',
      policy: managedContainerPolicy(), status: 'active', revision: 2, createdAt: at, updatedAt: at
    })
    await repository.insertManagedContainerJob({
      jobId: 'mcj_123456789012', managedContainerId: 'mco_123456789012', operation: 'inspect',
      desiredRevision: 2, state: 'queued', attemptCount: 0, nextAttemptAt: at, createdAt: at, updatedAt: at
    })
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [], store: new FakeRuntimeStore(), repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: emptyService(), outboxPollMs: 20, now: () => new Date(at)
    })
    await runtime.start()
    await waitUntil(() => repository.state.managedContainerJobs.get('mcj_123456789012')?.state === 'failed', 1_500)
    await runtime.stop()
    expect(repository.state.managedContainerJobs.get('mcj_123456789012')).toMatchObject({
      state: 'failed', safeErrorCode: 'managed_container_provider_unavailable'
    })
  })

  it('rechecks the live endpoint identity before any managed external write', async () => {
    const repository = new FakeCollaborationRepository()
    const at = '2026-08-15T00:00:00.000Z'
    await repository.insertEndpoint({
      humanEndpointId: 'hep_123456789012', userId: 'usr_transferred_owner', provider: 'fake', realmId: 'realm-1',
      providerUserId: '42', displayName: 'Transferred endpoint', assurance: 'verified', status: 'active',
      revision: 2, verifiedAt: at, updatedAt: at
    })
    await repository.insertManagedContainer({
      managedContainerId: 'mco_123456789012', ownerUserId: 'usr_previous_owner',
      humanEndpointId: 'hep_123456789012', provider: 'fake', realmId: 'realm-1', ownerProviderUserId: '42',
      stableKey: 'managed-owner-realm', displayName: 'sciforge-owner', externalContainerId: 'owner-channel',
      policy: managedContainerPolicy(), status: 'active', revision: 2, createdAt: at, updatedAt: at
    })
    await repository.insertManagedContainerJob({
      jobId: 'mcj_123456789012', managedContainerId: 'mco_123456789012', operation: 'reconcile',
      desiredRevision: 2, state: 'queued', attemptCount: 0, nextAttemptAt: at, createdAt: at, updatedAt: at
    })
    const provider = new FakeProvider([], [], async () => { throw new Error('must not write') })
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: new FakeRuntimeStore(), repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: emptyService(), outboxPollMs: 20, now: () => new Date(at)
    })
    await runtime.start()
    await waitUntil(() => repository.state.managedContainerJobs.get('mcj_123456789012')?.state === 'failed', 1_500)
    await runtime.stop()
    expect(provider.managedContainerRequests).toHaveLength(0)
    expect(repository.state.managedContainerJobs.get('mcj_123456789012')).toMatchObject({
      state: 'failed', safeErrorCode: 'managed_container_owner_endpoint_invalid'
    })
  })

  it('leases managed jobs longer than the maximum single provider request timeout', async () => {
    let observedLeaseMilliseconds = 0
    const at = '2026-08-15T00:00:00.000Z'
    const repository = {
      ...emptyRepository(),
      claimManagedContainerJobs: async (_workerId: string, now: string, leaseExpiresAt: string) => {
        observedLeaseMilliseconds = new Date(leaseExpiresAt).getTime() - new Date(now).getTime()
        return []
      }
    }
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [], store: new FakeRuntimeStore(), repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: emptyService(), outboxPollMs: 20, now: () => new Date(at)
    })
    await runtime.start()
    await waitUntil(() => observedLeaseMilliseconds > 0, 1_500)
    await runtime.stop()
    expect(observedLeaseMilliseconds).toBeGreaterThan(75_000)
  })

  it('claims and completes a durable managed Channel provisioning job', async () => {
    const repository = new FakeCollaborationRepository()
    const at = '2026-08-15T00:00:00.000Z'
    const policy = { version: 1 as const, visibility: 'private' as const, history: 'protected' as const,
      membership: 'owner_and_message_bot' as const, memberManagement: 'provisioning_service_only' as const,
      channelManagement: 'provisioning_service_only' as const, ownerCanSend: true as const,
      ownerCanCreateTopics: true as const, messageBotCanSend: true as const,
      messageBotCreatesProjectTopics: false as const }
    await repository.insertEndpoint({
      humanEndpointId: 'hep_123456789012', userId: 'usr_123456789012', provider: 'fake', realmId: 'realm-1',
      providerUserId: '42', displayName: 'Owner endpoint', assurance: 'verified', status: 'active',
      revision: 1, verifiedAt: at, updatedAt: at
    })
    await repository.insertManagedContainer({ managedContainerId: 'mco_123456789012', ownerUserId: 'usr_123456789012',
      humanEndpointId: 'hep_123456789012', provider: 'fake', realmId: 'realm-1', ownerProviderUserId: '42',
      stableKey: 'managed-owner-realm', displayName: 'sciforge-user123', policy, status: 'requested',
      revision: 1, createdAt: at, updatedAt: at })
    await repository.insertManagedContainerJob({ jobId: 'mcj_123456789012', managedContainerId: 'mco_123456789012',
      operation: 'ensure', desiredRevision: 1, state: 'queued', attemptCount: 0, nextAttemptAt: at,
      createdAt: at, updatedAt: at })
    const provider = new FakeProvider([], [], async () => ({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.managed_container.result',
      container: { type: 'provider_managed_container_ref', provider: 'fake', realmId: 'realm-1', containerId: '123' },
      displayName: 'sciforge-user123', status: 'active', policyVersion: 1,
      checks: { private: true, protectedHistory: true, exactMembership: true, ownerCanSend: true,
        messageBotCanSend: true, ownerCanCreateTopics: true, memberManagementRestricted: true,
        channelManagementRestricted: true }, safeIssueCodes: [], observedAt: at
    }))
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: new FakeRuntimeStore(), repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: emptyService(), outboxPollMs: 20, now: () => new Date(at)
    })
    await runtime.start()
    await waitUntil(async () => (await repository.getManagedContainer('mco_123456789012'))?.status === 'active', 1_500)
    await runtime.stop()
    expect(await repository.getManagedContainer('mco_123456789012')).toMatchObject({
      externalContainerId: '123', status: 'active', revision: 2
    })
    expect(provider.managedContainerRequests).toHaveLength(1)

    await repository.insertManagedContainerJob({
      jobId: 'mcj_123456789013', managedContainerId: 'mco_123456789012',
      operation: 'inspect', desiredRevision: 2, state: 'queued', attemptCount: 0, nextAttemptAt: at,
      createdAt: at, updatedAt: at
    })
    await runtime.start()
    await waitUntil(async () => provider.managedContainerRequests.length === 2, 1_500)
    await waitUntil(async () => (await repository.getManagedContainer('mco_123456789012'))?.revision === 3, 1_500)
    await runtime.stop()
    expect(provider.managedContainerRequests[1]).toMatchObject({ type: 'provider.managed_container.inspect' })
  })
  it('preserves a provider-neutral safe code without reading credential-bearing error fields', async () => {
    const sensitiveMarker = ['INVALID', 'TEST', 'ONLY', 'CREDENTIAL'].join('_')
    const error = {
      code: 'invalid_payload',
      name: 'ZulipProviderError',
      message: sensitiveMarker,
      cause: { value: sensitiveMarker },
      headers: { value: sensitiveMarker },
      body: sensitiveMarker
    }
    const diagnostic = await runtimeDiagnosticFor(error)

    expect(diagnostic).toMatchObject({ status: 'degraded',
      safeSummary: 'Provider runtime operation failed (invalid_payload; ProviderError).',
      details: { errorCode: 'invalid_payload', errorClass: 'ProviderError' } })
    expect(JSON.stringify(diagnostic)).not.toContain(sensitiveMarker)
    expect(JSON.stringify(diagnostic)).not.toContain('ZulipProviderError')
  })

  it.each([
    null,
    'plain failure',
    42,
    { code: 'database_failure', name: 'DatabaseError' },
    Object.defineProperty({ name: 'Error' }, 'code', { get: () => { throw new Error('must not read accessor') } })
  ])('falls back safely for an abnormal provider error value', async (error) => {
    const diagnostic = await runtimeDiagnosticFor(error)
    expect(diagnostic).toMatchObject({ status: 'degraded',
      safeSummary: expect.stringContaining('provider_unavailable'),
      details: expect.objectContaining({ errorCode: 'provider_unavailable' }) })
  })

  it('reclaims an expired canonical claim by dedupe key even when the replay event id changed', async () => {
    const queries: string[] = []
    const connection = {
      query: async (sql: string) => {
        queries.push(sql)
        if (sql.includes('INSERT INTO sciforge_collaboration.provider_event_claims')) return { rows: [], rowCount: 0 }
        if (sql.includes('UPDATE sciforge_collaboration.provider_event_claims')) {
          return { rows: [{ event_id: 'event-crashed-original' }], rowCount: 1 }
        }
        return { rows: [], rowCount: null }
      },
      release: () => undefined
    }
    const pool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => connection,
      end: async () => undefined
    }
    const store = new ProviderRuntimeStore(pool)

    const claim = await store.beginEvent({
      provider: 'fake', realmId: 'realm-1', eventId: 'event-replayed-new',
      eventCursor: 'cursor-replayed-new', dedupeKey: 'same-remote-message'
    })

    expect(claim).toEqual({ status: 'claimed', claimEventId: 'event-crashed-original' })
    expect(queries.find((sql) => sql.includes('UPDATE sciforge_collaboration.provider_event_claims')))
      .toContain('(event_id=$3 OR dedupe_key=$6)')
  })

  it('checkpoints the newer cursor of an already-processed duplicate without reopening its claim', async () => {
    const queries: Array<{ sql: string; values?: readonly unknown[] }> = []
    const pool = {
      query: async (sql: string, values?: readonly unknown[]) => {
        queries.push({ sql, values })
        return { rows: [], rowCount: 1 }
      },
      connect: async () => { throw new Error('Processed duplicate checkpoint does not need a transaction.') },
      end: async () => undefined
    }
    const store = new ProviderRuntimeStore(pool, () => new Date('2026-08-15T00:00:00.000Z'))

    await store.checkpointProcessedEvent({
      provider: 'fake',
      realmId: 'realm-1',
      eventId: 'event-replayed-new',
      eventCursor: 'cursor-replayed-new'
    })

    expect(queries).toHaveLength(1)
    expect(queries[0]?.sql).toContain('INSERT INTO sciforge_collaboration.provider_event_cursors')
    expect(queries[0]?.values).toEqual([
      'fake', 'realm-1', 'cursor-replayed-new', 'event-replayed-new', '2026-08-15T00:00:00.000Z'
    ])
  })

  it('releases an interrupted claim and replays the event before checkpointing later work', async () => {
    const event: ProviderEvent = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'fake',
      type: 'provider.message.created',
      eventId: 'event-1',
      eventCursor: 'cursor-1',
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity',
        provider: 'fake',
        realmId: 'realm-1',
        providerUserId: 'remote-user-1'
      },
      locator: LOCATOR,
      providerMessageId: 'remote-message-1',
      text: '只执行一次',
      isSelfEcho: false
    }
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore()
    let attempts = 0
    let accepted = 0
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      authentication: {
        resolveProviderIdentity: async () => ({
          kind: 'human_endpoint',
          actorKey: 'endpoint:hep_1:revision:1',
          userId: 'usr_1',
          humanEndpointId: 'hep_1',
          assurance: 'verified'
        })
      },
      repository: emptyRepository(),
      service: {
        ...emptyService(),
        acceptPersonalProviderMessage: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('simulated process interruption')
          accepted += 1
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-1', 3_000)
    await runtime.stop()

    expect(attempts).toBe(2)
    expect(accepted).toBe(1)
    expect(ledger.releases).toBe(1)
    expect(ledger.completedEvents).toEqual(['event-1'])
    expect(provider.startCursors.slice(0, 2)).toEqual([undefined, undefined])
  })

  it('routes a strict challenge event with its challenge id and never requires a locator', async () => {
    const event: ProviderEvent = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'fake',
      type: 'provider.challenge.responded',
      eventId: 'event-pairing-1',
      eventCursor: 'cursor-pairing-1',
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity',
        provider: 'fake',
        realmId: 'realm-1',
        providerUserId: 'remote-user-1',
        displayName: '手机用户'
      },
      challengeId: 'chl_123456789012',
      challengeResponse: 'pairing-response-1234'
    }
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore()
    const verifications: Array<Record<string, unknown>> = []
    const commandResults: Array<Record<string, unknown>> = []
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      repository: emptyRepository(),
      pairingAssurance: { fake: 'strong' },
      service: {
        ...emptyService(),
        verifyPairingFromProvider: async (input) => {
          verifications.push(input)
          return { challengeId: input.challengeId }
        },
        enqueueProviderCommandResult: async (input) => {
          commandResults.push(input)
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-pairing-1', 1_500)
    await runtime.stop()

    expect(verifications).toEqual([expect.objectContaining({
      provider: 'fake',
      realmId: 'realm-1',
      providerUserId: 'remote-user-1',
      challengeId: 'chl_123456789012',
      challengeCode: 'pairing-response-1234',
      assurance: 'strong'
    })])
    expect(commandResults).toEqual([{
      identity: event.identity,
      providerEventId: 'event-pairing-1',
      result: 'success'
    }])
  })

  it('replies safely to a malformed private bind without invoking challenge verification', async () => {
    const event: ProviderEvent = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'fake',
      type: 'provider.challenge.invalid',
      eventId: 'event-pairing-malformed-1',
      eventCursor: 'cursor-pairing-malformed-1',
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity', provider: 'fake', realmId: 'realm-1', providerUserId: 'remote-user-1'
      }
    }
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore()
    const commandResults: Array<Record<string, unknown>> = []
    let verificationCount = 0
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: emptyRepository(),
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: {
        ...emptyService(),
        verifyPairingFromProvider: async () => {
          verificationCount += 1
          return {}
        },
        enqueueProviderCommandResult: async (input) => {
          commandResults.push(input)
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-pairing-malformed-1', 1_500)
    await runtime.stop()

    expect(verificationCount).toBe(0)
    expect(commandResults).toEqual([{
      identity: event.identity,
      providerEventId: 'event-pairing-malformed-1',
      result: 'invalid_or_expired'
    }])
  })

  it('emits one safe direct failure result when a duplicate challenge event is invalid', async () => {
    const event: ProviderEvent = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'fake',
      type: 'provider.challenge.responded',
      eventId: 'event-pairing-invalid-1',
      eventCursor: 'cursor-pairing-invalid-1',
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: {
        type: 'provider_identity', provider: 'fake', realmId: 'realm-1', providerUserId: 'remote-user-1'
      },
      challengeId: 'chl_123456789012',
      challengeResponse: 'invalid-response-1234'
    }
    const provider = new FakeProvider([event, { ...event, eventCursor: 'cursor-pairing-invalid-2' }])
    const ledger = new FakeRuntimeStore()
    const commandResults: Array<Record<string, unknown>> = []
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: emptyRepository(),
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: {
        ...emptyService(),
        verifyPairingFromProvider: async () => {
          throw new CollaborationServiceError('not_found', 'sensitive challenge detail')
        },
        enqueueProviderCommandResult: async (input) => {
          commandResults.push(input)
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-pairing-invalid-2', 1_500)
    await runtime.stop()

    expect(commandResults).toEqual([{
      identity: event.identity,
      providerEventId: 'event-pairing-invalid-1',
      result: 'invalid_or_expired'
    }])
  })

  it('runs private challenge verification through binding and the durable direct outbox', async () => {
    const repository = new FakeCollaborationRepository()
    const service = new CollaborationService({ repository, now: () => new Date('2026-08-15T00:00:00.000Z') })
    const begun = await service.beginPairing({
      provider: 'fake', realmId: 'realm-1', requestedDisplayName: 'Private bind user',
      idempotencyKey: 'idem_private_bind_begin_1'
    })
    const identity = {
      type: 'provider_identity' as const,
      provider: 'fake',
      realmId: 'realm-1',
      providerUserId: 'remote-private-user'
    }
    const event: ProviderEvent = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'fake',
      type: 'provider.challenge.responded',
      eventId: 'event-private-bind-e2e-1',
      eventCursor: 'cursor-private-bind-e2e-1',
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity,
      challengeId: String(begun.challengeId),
      challengeResponse: String(begun.challengeCode)
    }
    const provider = new FakeProvider(event)
    provider.send = async (request) => {
      provider.sendRequests.push(request)
      return {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.send.succeeded',
        clientMessageId: request.clientMessageId,
        providerMessageId: 'remote-private-result-1',
        sentAt: '2026-08-15T00:00:01.000Z'
      }
    }
    const ledger = new FakeRuntimeStore()
    const recipientId = providerIdentityInboxId({
      type: 'provider_direct_recipient',
      provider: identity.provider,
      realmId: identity.realmId,
      providerUserId: identity.providerUserId
    })
    ledger.pendingProviderIdentityIds = () => [recipientId]
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: ledger, repository, service,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      outboxPollMs: 20
    })

    await runtime.start()
    await waitUntil(() => provider.sendRequests.length === 1, 1_500)
    await runtime.stop()

    const endpoint = await repository.getEndpointByProviderIdentity('fake', 'realm-1', 'remote-private-user')
    expect(endpoint).toMatchObject({ status: 'active', assurance: 'verified' })
    expect(provider.sendRequests[0]).toMatchObject({
      type: 'provider.send.message',
      recipient: {
        type: 'provider_direct_recipient', provider: 'fake', realmId: 'realm-1', providerUserId: 'remote-private-user'
      },
      text: '绑定成功，可以返回 SciForge 继续使用。'
    })
    const cursor = await repository.getInboxCursor({ kind: 'provider_identity', id: recipientId })
    expect(cursor?.ackedSequence).toBe(1)
  })

  it('applies a confirmed locator change before checkpointing the provider cursor', async () => {
    const currentLocator = { ...LOCATOR, containerId: 'stream-2',
      containerDisplayName: '研究（新）', topicDisplayName: '固定 Session（新）' }
    const event: ProviderEvent = { protocolVersion: CURRENT_PROTOCOL_VERSION, provider: 'fake',
      type: 'provider.locator.changed', eventId: 'event-locator-1', eventCursor: 'cursor-locator-1',
      occurredAt: '2026-08-15T00:00:00.000Z', previousLocator: LOCATOR, currentLocator }
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore()
    const changes: Array<Record<string, unknown>> = []
    const runtime = new DefaultCollaborationProviderRuntime({ providers: [provider], store: ledger,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      repository: emptyRepository(), service: { ...emptyService(), applyProviderLocatorChange: async (input) => {
        changes.push(input)
        return { kind: 'personal_projection', resourceId: 'projection-1' }
      } } })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-locator-1', 1_500)
    await runtime.stop()

    expect(changes).toEqual([{ previousLocator: LOCATOR, currentLocator, providerEventId: 'event-locator-1' }])
    expect(ledger.completedEvents).toEqual(['event-locator-1'])
  })

  it('authenticates a canonical provider HumanAnswer and checkpoints only after the answer transaction', async () => {
    const event: ProviderEvent = { protocolVersion: CURRENT_PROTOCOL_VERSION, provider: 'fake',
      type: 'provider.human_answer.responded', eventId: 'event-answer-1', eventCursor: 'cursor-answer-1',
      occurredAt: '2026-08-15T00:00:00.000Z',
      identity: { type: 'provider_identity', provider: 'fake', realmId: 'realm-1',
        providerUserId: 'remote-user-1' },
      locator: LOCATOR,
      providerMessageId: 'provider-message-answer-1', humanRequestId: 'hrq_123456789012',
      requestRevision: 1, answer: '继续执行' }
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore()
    const answers: Array<Record<string, unknown>> = []
    const actor = { kind: 'human_endpoint' as const, actorKey: 'endpoint:hep_1:revision:1',
      userId: 'usr_123456789012', humanEndpointId: 'hep_123456789012', assurance: 'verified' as const }
    const runtime = new DefaultCollaborationProviderRuntime({ providers: [provider], store: ledger,
      authentication: { resolveProviderIdentity: async () => actor }, repository: emptyRepository(),
      service: { ...emptyService(), answerHumanNeeded: async (_actor, input) => {
        answers.push({ actor: _actor, ...input })
        return {} as never
      } } })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-answer-1', 1_500)
    await runtime.stop()

    expect(answers).toEqual([{ actor, humanRequestId: 'hrq_123456789012', requestRevision: 1,
      answer: '继续执行', sourceLocator: LOCATOR,
      idempotencyKey: expect.stringMatching(/^idem_[a-f0-9]{64}$/u) }])
    expect(ledger.completedEvents).toEqual(['event-answer-1'])
  })

  it('does not advance to a later event while a crashed claim is still in progress', async () => {
    const first = messageEvent('event-ordered-1', 'cursor-ordered-1', 'remote-ordered-1')
    const second = messageEvent('event-ordered-2', 'cursor-ordered-2', 'remote-ordered-2')
    const provider = new FakeProvider([first, second])
    const ledger = new FakeRuntimeStore('event-ordered-1')
    const accepted: string[] = []
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      authentication: {
        resolveProviderIdentity: async () => ({ kind: 'human_endpoint', actorKey: 'endpoint:hep_1:revision:1',
          userId: 'usr_1', humanEndpointId: 'hep_1', assurance: 'verified' })
      },
      repository: emptyRepository(),
      service: {
        ...emptyService(),
        acceptPersonalProviderMessage: async (_actor, input) => {
          accepted.push(input.providerEventId)
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-ordered-2', 3_000)
    await runtime.stop()

    expect(provider.yieldedEventIds).toEqual(['event-ordered-1', 'event-ordered-1', 'event-ordered-2'])
    expect(accepted).toEqual(['event-ordered-1', 'event-ordered-2'])
    expect(ledger.completedEvents).toEqual(['event-ordered-1', 'event-ordered-2'])
  })

  it('does not execute the same processed provider event twice', async () => {
    const event = messageEvent('event-duplicate-1', 'cursor-duplicate-1', 'remote-duplicate-1')
    const replay = messageEvent('event-duplicate-1', 'cursor-duplicate-2', 'remote-duplicate-1')
    const provider = new FakeProvider([event, replay])
    const ledger = new FakeRuntimeStore()
    let accepted = 0
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: emptyRepository(),
      authentication: {
        resolveProviderIdentity: async () => ({ kind: 'human_endpoint', actorKey: 'endpoint:hep_1:revision:1',
          userId: 'usr_1', humanEndpointId: 'hep_1', assurance: 'verified' })
      },
      service: {
        ...emptyService(),
        acceptPersonalProviderMessage: async () => {
          accepted += 1
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => provider.yieldedEventIds.length === 2, 1_500)
    await runtime.stop()

    expect(accepted).toBe(1)
    expect(ledger.completedEvents).toEqual(['event-duplicate-1'])
    expect(ledger.cursor).toBe('cursor-duplicate-2')
  })

  it('replays a checkpoint failure with the same identity while the canonical transaction stays idempotent', async () => {
    const event = messageEvent('event-checkpoint-1', 'cursor-checkpoint-1', 'remote-checkpoint-1')
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore()
    ledger.completeFailures = 1
    let attempts = 0
    let businessCommits = 0
    const committed = new Set<string>()
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: emptyRepository(),
      authentication: {
        resolveProviderIdentity: async () => ({ kind: 'human_endpoint', actorKey: 'endpoint:hep_1:revision:1',
          userId: 'usr_1', humanEndpointId: 'hep_1', assurance: 'verified' })
      },
      service: {
        ...emptyService(),
        acceptPersonalProviderMessage: async (_actor, input) => {
          attempts += 1
          if (!committed.has(input.providerEventId)) {
            committed.add(input.providerEventId)
            businessCommits += 1
          }
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-checkpoint-1', 3_000)
    await runtime.stop()

    expect(attempts).toBe(2)
    expect(businessCommits).toBe(1)
    expect(ledger.releases).toBe(1)
    expect(ledger.completedEvents).toEqual(['event-checkpoint-1'])
  })

  it('checkpoints a terminal rejected event, continues later work, and exposes the stale degraded diagnostic', async () => {
    const rejected = messageEvent('event-rejected-1', 'cursor-rejected-1', 'remote-rejected-1')
    const acceptedEvent = messageEvent('event-after-rejected-1', 'cursor-after-rejected-1', 'remote-after-rejected-1')
    const provider = new FakeProvider([rejected, acceptedEvent])
    const ledger = new FakeRuntimeStore()
    const accepted: string[] = []
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: emptyRepository(),
      authentication: {
        resolveProviderIdentity: async () => ({ kind: 'human_endpoint', actorKey: 'endpoint:hep_1:revision:1',
          userId: 'usr_1', humanEndpointId: 'hep_1', assurance: 'verified' })
      },
      service: {
        ...emptyService(),
        acceptPersonalProviderMessage: async (_actor, input) => {
          if (input.providerEventId === rejected.eventId) {
            throw new CollaborationServiceError('validation_failed', 'terminal test rejection')
          }
          accepted.push(input.providerEventId)
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-after-rejected-1', 1_500)
    await runtime.stop()

    expect(accepted).toEqual(['event-after-rejected-1'])
    expect(ledger.completedEvents).toEqual(['event-rejected-1', 'event-after-rejected-1'])
    expect(ledger.diagnostics).toHaveLength(1)
    expect(ledger.diagnostics[0]).toMatchObject({ status: 'degraded' })
    expect(provider.diagnoseCalls).toBe(0)
  })

  it('retries endpoint outbox in sequence, acks only durable outcomes, and does not resend after restart', async () => {
    const retryableFailure: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.failed',
      clientMessageId: 'msg-1',
      retryable: true,
      providerErrorCode: 'provider_unavailable',
      safeMessage: 'Temporarily unavailable.'
    }
    const sentOne: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.succeeded',
      clientMessageId: 'msg-1',
      providerMessageId: 'remote-out-1',
      sentAt: '2026-08-15T00:00:01.000Z'
    }
    const sentTwo: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.succeeded',
      clientMessageId: 'msg-2',
      providerMessageId: 'remote-out-2',
      sentAt: '2026-08-15T00:00:02.000Z'
    }
    const provider = new FakeProvider([], [retryableFailure, sentOne, sentTwo])
    const ledger = new FakeRuntimeStore()
    let ackedSequence = 0
    const acknowledgements: number[] = []
    ledger.pendingEndpointIds = () => ackedSequence < 2 ? ['hep_1'] : []
    const messages = [
      inboxMessage(1, 'msg-1', 'projection.message.outbound', {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'projection.message.outbound',
        locator: LOCATOR,
        kind: 'assistant_progress',
        text: '桌面消息'
      }),
      inboxMessage(2, 'msg-2', 'provider.notification.outbound', {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.notification.outbound',
        locator: LOCATOR,
        notificationKind: 'human_needed',
        resourceId: 'hrq_1',
        text: '需要你的决定'
      })
    ]
    const repository = {
      getEndpoint: async () => ({
        humanEndpointId: 'hep_1', userId: 'usr_1', provider: 'fake', realmId: 'realm-1',
        providerUserId: 'remote-user-1', assurance: 'verified' as const, status: 'active' as const,
        revision: 1, verifiedAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z'
      }),
      getInboxCursor: async () => ({
        recipient: { kind: 'human_endpoint' as const, id: 'hep_1' }, nextSequence: 3,
        ackedSequence, updatedAt: '2026-08-15T00:00:00.000Z'
      })
    }
    const service = {
      ...emptyService(),
      pullInbox: async (_actor: unknown, input: { afterSequence: number }) => ({
        messages: messages.filter((message) => message.sequence > input.afterSequence),
        ackedSequence,
        nextSequence: 3
      }),
      ackInboxMessage: async (_actor: unknown, input: { sequence: number }) => {
        ackedSequence = input.sequence
        acknowledgements.push(input.sequence)
        return { ackedSequence, nextSequence: 3 }
      }
    }
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: ledger, repository, service,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      outboxPollMs: 250
    })

    await runtime.start()
    await waitUntil(() => ackedSequence === 2, 2_000)
    const sendsAfterDelivery = provider.sendRequests.length
    await runtime.stop()
    await runtime.start()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await runtime.stop()

    expect(provider.sendRequests.map((request) => request.clientMessageId)).toEqual(['msg-1', 'msg-1', 'msg-2'])
    expect(provider.sendRequests.map((request) => request.text)).toEqual(['桌面消息', '桌面消息', '需要你的决定'])
    expect(provider.sendRequests.map((request) => (
      'presentation' in request ? request.presentation : undefined
    ))).toEqual([
      { disposition: 'collapsible', summary: '中间进展' },
      { disposition: 'collapsible', summary: '中间进展' },
      undefined
    ])
    expect(acknowledgements).toEqual([1, 2])
    expect(provider.sendRequests).toHaveLength(sendsAfterDelivery)
  })

  it('retries a direct provider result with a stable client message id and durable ack', async () => {
    const recipient = {
      type: 'provider_direct_recipient' as const,
      provider: 'fake',
      realmId: 'realm-1',
      providerUserId: 'remote-user-1'
    }
    const recipientId = providerIdentityInboxId(recipient)
    const retryable: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.failed',
      clientMessageId: 'msg-direct-1',
      retryable: true,
      providerErrorCode: 'provider_unavailable',
      safeMessage: 'Temporarily unavailable.'
    }
    const succeeded: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.succeeded',
      clientMessageId: 'msg-direct-1',
      providerMessageId: 'remote-direct-1',
      sentAt: '2026-08-15T00:00:01.000Z'
    }
    const provider = new FakeProvider([], [retryable, succeeded])
    const ledger = new FakeRuntimeStore()
    let ackedSequence = 0
    ledger.pendingProviderIdentityIds = () => ackedSequence ? [] : [recipientId]
    const message = {
      recipient: { kind: 'provider_identity' as const, id: recipientId },
      sequence: 1,
      messageId: 'msg-direct-1',
      messageType: 'provider.command.result.outbound',
      payload: {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.command.result.outbound',
        recipient,
        result: 'success',
        text: '绑定成功'
      },
      createdAt: '2026-08-15T00:00:00.000Z',
      expiresAt: '2026-09-15T00:00:00.000Z'
    }
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: emptyRepository(),
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      outboxPollMs: 20,
      service: {
        ...emptyService(),
        pullProviderIdentityInbox: async () => ({ messages: ackedSequence ? [] : [message], ackedSequence, nextSequence: 2 }),
        ackProviderIdentityInboxMessage: async () => {
          ackedSequence = 1
          return { ackedSequence, nextSequence: 2 }
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ackedSequence === 1, 1_500)
    await runtime.stop()

    expect(provider.sendRequests).toEqual([
      expect.objectContaining({ clientMessageId: 'msg-direct-1', recipient }),
      expect.objectContaining({ clientMessageId: 'msg-direct-1', recipient })
    ])
  })

  it('bounds a HumanNeeded notification to provider limits without truncating its reply command', async () => {
    const sent: ProviderSendResult = { protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.succeeded', clientMessageId: 'msg-human-long',
      providerMessageId: 'remote-human-long', sentAt: '2026-08-15T00:00:01.000Z' }
    const provider = new FakeProvider([], [sent])
    provider.contract.limits.maxTextLength = 120
    const ledger = new FakeRuntimeStore()
    let ackedSequence = 0
    ledger.pendingEndpointIds = () => ackedSequence < 1 ? ['hep_1'] : []
    const replyCommand = '\n\n回复命令：sciforge-answer hrq_123456789012 1 <answer>'
    const message = inboxMessage(1, 'msg-human-long', 'provider.notification.outbound', {
      protocolVersion: CURRENT_PROTOCOL_VERSION, type: 'provider.notification.outbound', locator: LOCATOR,
      notificationKind: 'human_needed', resourceId: 'hrq_123456789012', text: `${'很长的提示'.repeat(100)}${replyCommand}`
    })
    const repository = {
      getEndpoint: async () => ({ humanEndpointId: 'hep_1', userId: 'usr_1', provider: 'fake', realmId: 'realm-1',
        providerUserId: 'remote-user-1', assurance: 'verified' as const, status: 'active' as const,
        revision: 1, verifiedAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' }),
      getInboxCursor: async () => ({ recipient: { kind: 'human_endpoint' as const, id: 'hep_1' },
        nextSequence: 2, ackedSequence, updatedAt: '2026-08-15T00:00:00.000Z' })
    }
    const runtime = new DefaultCollaborationProviderRuntime({ providers: [provider], store: ledger, repository,
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } }, outboxPollMs: 20,
      service: { ...emptyService(), pullInbox: async () => ({ messages: ackedSequence ? [] : [message],
        ackedSequence, nextSequence: 2 }), ackInboxMessage: async () => {
        ackedSequence = 1
        return { ackedSequence, nextSequence: 2 }
      } } })

    await runtime.start()
    await waitUntil(() => ackedSequence === 1, 1_500)
    await runtime.stop()

    expect(provider.sendRequests).toHaveLength(1)
    expect(provider.sendRequests[0]?.text.length).toBeLessThanOrEqual(120)
    expect(provider.sendRequests[0]?.text.endsWith(replyCommand)).toBe(true)
  })

  it('retries a durable approval-card update and acknowledges it without replaying the decision', async () => {
    const retryable: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.failed',
      clientMessageId: 'msg-approval-update',
      retryable: true,
      providerErrorCode: 'provider_unavailable',
      safeMessage: 'Temporarily unavailable.'
    }
    const succeeded: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.succeeded',
      clientMessageId: 'msg-approval-update',
      providerMessageId: '31415',
      sentAt: '2026-08-15T00:00:01.000Z'
    }
    const provider = new FakeProvider([], [], undefined, [retryable, succeeded])
    const ledger = new FakeRuntimeStore()
    let ackedSequence = 0
    ledger.pendingEndpointIds = () => ackedSequence ? [] : ['hep_1']
    const message = inboxMessage(1, 'msg-approval-update', 'provider.message.update.outbound', {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.message.update.outbound',
      remoteApprovalId: 'rap_abcdefghijkl',
      locator: LOCATOR,
      providerMessageId: '31415',
      text: '本次权限审批已处理。',
      fallbackText: '本次权限审批已处理。'
    })
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider],
      store: ledger,
      repository: {
        getEndpoint: async () => ({
          humanEndpointId: 'hep_1', userId: 'usr_1', provider: 'fake', realmId: 'realm-1',
          providerUserId: 'remote-user-1', assurance: 'verified' as const, status: 'active' as const,
          revision: 1, verifiedAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z'
        }),
        getInboxCursor: async () => ({
          recipient: { kind: 'human_endpoint' as const, id: 'hep_1' },
          nextSequence: 2, ackedSequence, updatedAt: '2026-08-15T00:00:00.000Z'
        })
      },
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      outboxPollMs: 20,
      service: {
        ...emptyService(),
        pullInbox: async () => ({ messages: ackedSequence ? [] : [message], ackedSequence, nextSequence: 2 }),
        ackInboxMessage: async () => {
          ackedSequence = 1
          return { ackedSequence, nextSequence: 2 }
        }
      }
    })
    await runtime.start()
    await waitUntil(() => ackedSequence === 1, 1_500)
    await runtime.stop()
    expect(provider.updateRequests).toHaveLength(2)
    expect(provider.updateRequests[0]).toMatchObject({
      providerMessageId: '31415',
      clientMessageId: 'msg-approval-update'
    })
  })

  it('appends one safe fallback after a terminal approval-card edit failure', async () => {
    const failed: ProviderSendResult = {
      protocolVersion: CURRENT_PROTOCOL_VERSION, type: 'provider.send.failed',
      clientMessageId: 'msg-approval-update-terminal', retryable: false,
      providerErrorCode: 'message_not_editable', safeMessage: 'The provider rejected the edit.'
    }
    const provider = new FakeProvider([], [], undefined, [failed])
    const ledger = new FakeRuntimeStore()
    let ackedSequence = 0
    let fallbackCount = 0
    ledger.pendingEndpointIds = () => ackedSequence ? [] : ['hep_1']
    const message = inboxMessage(1, 'msg-approval-update-terminal', 'provider.message.update.outbound', {
      protocolVersion: CURRENT_PROTOCOL_VERSION, type: 'provider.message.update.outbound',
      remoteApprovalId: 'rap_abcdefghijkl', locator: LOCATOR, providerMessageId: '27182',
      text: '本次权限已拒绝。', fallbackText: '本次权限已拒绝。'
    })
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: ledger, outboxPollMs: 20,
      repository: {
        getEndpoint: async () => ({ humanEndpointId: 'hep_1', userId: 'usr_1', provider: 'fake',
          realmId: 'realm-1', providerUserId: 'remote-user-1', assurance: 'verified' as const,
          status: 'active' as const, revision: 1, verifiedAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z' }),
        getInboxCursor: async () => ({ recipient: { kind: 'human_endpoint' as const, id: 'hep_1' },
          nextSequence: 2, ackedSequence, updatedAt: '2026-08-15T00:00:00.000Z' })
      },
      authentication: { resolveProviderIdentity: async () => { throw new Error('not used') } },
      service: { ...emptyService(),
        pullInbox: async () => ({ messages: ackedSequence ? [] : [message], ackedSequence, nextSequence: 2 }),
        enqueueRemoteApprovalFallback: async () => { fallbackCount += 1 },
        ackInboxMessage: async () => { ackedSequence = 1; return { ackedSequence, nextSequence: 2 } }
      }
    })
    await runtime.start()
    await waitUntil(() => ackedSequence === 1, 1_500)
    await runtime.stop()
    expect(provider.updateRequests).toHaveLength(1)
    expect(fallbackCount).toBe(1)
  })

  it('uses the canonical crashed claim id when the same dedupe key is replayed with a new event id', async () => {
    const event = messageEvent('event-replayed-new', 'cursor-replayed-new', 'same-remote-message')
    const provider = new FakeProvider(event)
    const ledger = new FakeRuntimeStore('event-replayed-new', 'event-crashed-original')
    const providerEventIds: string[] = []
    const runtime = new DefaultCollaborationProviderRuntime({
      providers: [provider], store: ledger, repository: emptyRepository(),
      authentication: {
        resolveProviderIdentity: async () => ({ kind: 'human_endpoint', actorKey: 'endpoint:hep_1:revision:1',
          userId: 'usr_1', humanEndpointId: 'hep_1', assurance: 'verified' })
      },
      service: {
        ...emptyService(),
        acceptPersonalProviderMessage: async (_actor, input) => {
          providerEventIds.push(input.providerEventId)
          return {}
        }
      }
    })

    await runtime.start()
    await waitUntil(() => ledger.cursor === 'cursor-replayed-new', 3_000)
    await runtime.stop()

    expect(providerEventIds).toEqual(['event-crashed-original'])
    expect(ledger.completedEvents).toEqual(['event-crashed-original'])
    expect(provider.yieldedEventIds).toEqual(['event-replayed-new', 'event-replayed-new'])
  })
})

class FakeProvider implements HumanEndpointProvider {
  readonly contract = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    type: 'human_endpoint_provider_contract' as const,
    provider: 'fake',
    displayName: 'Fake',
    capabilities: {
      textMessages: true as const,
      stableLocators: true as const,
      eventCursor: true as const,
      locatorRename: false,
      locatorMove: false,
      locatorDiscovery: false,
      identityChallenge: true as const,
      directMessages: true,
      managedContainers: false
    },
    onboarding: {
      realmLabel: 'Realm',
      accountLabel: 'Account',
      containerLabel: 'Container',
      topicLabel: 'Topic'
    },
    limits: { maxTextLength: 32_000, maxLocatorDisplayLength: 200 }
  }
  readonly startCursors: Array<string | undefined> = []
  readonly yieldedEventIds: string[] = []
  private stopped = false
  private stopWaiters: Array<() => void> = []

  private readonly eventsToYield: ProviderEvent[]

  readonly sendRequests: ProviderSendRequest[] = []
  readonly managedContainerRequests: ProviderManagedContainerRequest[] = []
  readonly locatorListRequests: ProviderLocatorListRequest[] = []
  locatorListResult: ProviderLocatorListResult = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    type: 'provider.locator.page',
    locators: []
  }
  readonly updateRequests: ProviderUpdateMessageRequest[] = []
  diagnoseCalls = 0

  constructor(
    event: ProviderEvent | ProviderEvent[],
    private readonly sendResults: ProviderSendResult[] = [],
    private readonly managedContainerHandler?: (
      request: ProviderManagedContainerRequest
    ) => Promise<ProviderManagedContainerResult>,
    private readonly updateResults: ProviderSendResult[] = []
  ) {
    this.eventsToYield = Array.isArray(event) ? event : [event]
    this.contract.capabilities.managedContainers = Boolean(managedContainerHandler)
  }

  async updateMessage(request: ProviderUpdateMessageRequest): Promise<ProviderSendResult> {
    this.updateRequests.push(structuredClone(request))
    return this.updateResults.shift() ?? {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.succeeded',
      clientMessageId: request.clientMessageId,
      providerMessageId: request.providerMessageId,
      sentAt: '2026-08-15T00:00:01.000Z'
    }
  }

  async *events(request: Extract<ProviderLifecycleRequest, { type: 'provider.lifecycle.start' }>): AsyncIterable<ProviderEvent> {
    this.startCursors.push(request.afterCursor)
    const startIndex = request.afterCursor
      ? this.eventsToYield.findIndex((event) => event.eventCursor === request.afterCursor) + 1
      : 0
    if (startIndex >= this.eventsToYield.length) {
      await new Promise<void>((resolve) => this.stopWaiters.push(resolve))
      return
    }
    for (const event of this.eventsToYield.slice(startIndex)) {
      this.yieldedEventIds.push(event.eventId)
      yield event
    }
  }

  async lifecycle(request: ProviderLifecycleRequest): Promise<ProviderLifecycleResult> {
    if (request.type === 'provider.lifecycle.stop') {
      this.stopped = true
      for (const resolve of this.stopWaiters.splice(0)) resolve()
    }
    return {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.lifecycle.status',
      status: this.stopped ? 'disconnected' : 'connected',
      checkedAt: '2026-08-15T00:00:00.000Z'
    }
  }

  async verifyIdentity(): Promise<never> { throw new Error('not used') }
  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    this.sendRequests.push(request)
    const result = this.sendResults.shift()
    if (!result) throw new Error('No fake provider send result is configured.')
    return result
  }
  async listLocators(request: ProviderLocatorListRequest): Promise<ProviderLocatorListResult> {
    this.locatorListRequests.push(request)
    return this.locatorListResult
  }
  async updateLocator(): Promise<never> { throw new Error('not used') }
  async manageContainer(request: ProviderManagedContainerRequest): Promise<ProviderManagedContainerResult> {
    this.managedContainerRequests.push(request)
    if (!this.managedContainerHandler) throw new Error('not used')
    return this.managedContainerHandler(request)
  }
  async diagnose(): Promise<ProviderDiagnostic> {
    this.diagnoseCalls += 1
    return {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.diagnostic',
      provider: 'fake',
      status: 'healthy',
      checkedAt: '2026-08-15T00:00:00.000Z',
      safeSummary: 'Fake provider is healthy.'
    }
  }
}

class FakeRuntimeStore {
  cursor: string | undefined
  releases = 0
  completedEvents: string[] = []
  diagnostics: ProviderDiagnostic[] = []
  completeFailures = 0
  private readonly claimStates = new Map<string, 'available' | 'claimed' | 'processed'>()
  private initialInProgressConsumed = false
  private readonly deliveries = new Map<string, {
    result: ProviderSendResult
    attemptCount: number
    terminal: boolean
  }>()
  pendingEndpointIds: () => string[] = () => []
  pendingProviderIdentityIds: () => string[] = () => []

  constructor(
    private readonly initiallyInProgressEventId?: string,
    private readonly canonicalClaimEventId?: string
  ) {}

  async beginEvent(input: { eventId: string }): Promise<
    | { status: 'claimed'; claimEventId: string }
    | { status: 'processed' }
    | { status: 'in_progress' }
  > {
    if (input.eventId === this.initiallyInProgressEventId && !this.initialInProgressConsumed) {
      this.initialInProgressConsumed = true
      return { status: 'in_progress' }
    }
    const state = this.claimStates.get(input.eventId) ?? 'available'
    if (state === 'processed') return { status: 'processed' }
    if (state === 'claimed') return { status: 'in_progress' }
    const claimEventId = this.canonicalClaimEventId ?? input.eventId
    this.claimStates.set(claimEventId, 'claimed')
    return { status: 'claimed', claimEventId }
  }

  async claimEvent(): Promise<'claimed' | 'duplicate'> { return 'claimed' }
  async readCursor(): Promise<string | undefined> { return this.cursor }
  async completeEvent(input: { eventId: string; eventCursor: string }): Promise<void> {
    if (this.completeFailures > 0) {
      this.completeFailures -= 1
      throw new Error('simulated checkpoint failure')
    }
    this.claimStates.set(input.eventId, 'processed')
    this.cursor = input.eventCursor
    this.completedEvents.push(input.eventId)
  }
  async checkpointProcessedEvent(input: { eventCursor: string }): Promise<void> {
    this.cursor = input.eventCursor
  }
  async releaseEvent(input: { eventId: string }): Promise<void> {
    this.claimStates.set(input.eventId, 'available')
    this.releases += 1
  }
  async resolveExactTarget() { return { kind: 'personal_projection' as const, resourceId: 'projection-1', locator: LOCATOR } }
  async resolveTarget() { return undefined }
  async hasPendingChallenge() { return false }
  async readDelivery(_provider: string, clientMessageId: string) { return this.deliveries.get(clientMessageId) }
  async recordDelivery(_provider: string, clientMessageId: string, result: ProviderSendResult) {
    const current = this.deliveries.get(clientMessageId)
    this.deliveries.set(clientMessageId, {
      result,
      attemptCount: (current?.attemptCount ?? 0) + 1,
      terminal: result.type === 'provider.send.succeeded' || !result.retryable
    })
  }
  async recordDiagnostic(diagnostic: ProviderDiagnostic) { this.diagnostics.push(diagnostic) }
  async listPendingEndpointIds() { return this.pendingEndpointIds() }
  async listPendingProviderIdentityIds() { return this.pendingProviderIdentityIds() }
}

function messageEvent(eventId: string, eventCursor: string, providerMessageId: string): ProviderEvent {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    provider: 'fake',
    type: 'provider.message.created',
    eventId,
    eventCursor,
    occurredAt: '2026-08-15T00:00:00.000Z',
    identity: { type: 'provider_identity', provider: 'fake', realmId: 'realm-1', providerUserId: 'remote-user-1' },
    locator: LOCATOR,
    providerMessageId,
    text: providerMessageId,
    isSelfEcho: false
  }
}

function inboxMessage(
  sequence: number,
  messageId: string,
  messageType: string,
  payload: Record<string, unknown>
) {
  return {
    recipient: { kind: 'human_endpoint' as const, id: 'hep_1' },
    sequence,
    messageId,
    messageType,
    payload,
    createdAt: '2026-08-15T00:00:00.000Z',
    expiresAt: '2026-09-15T00:00:00.000Z'
  }
}

function emptyRepository() {
  return {
    getEndpoint: async () => null,
    getInboxCursor: async () => null,
    getManagedContainer: async () => null,
    getManagedContainerForOwner: async () => null,
    claimManagedContainerJobs: async () => [],
    completeManagedContainerJob: async () => undefined,
    failManagedContainerJob: async () => undefined
  }
}

function emptyService() {
  return {
    verifyPairingFromProvider: async () => ({}),
    enqueueProviderCommandResult: async () => ({}),
    pullProviderIdentityInbox: async () => ({ messages: [], ackedSequence: 0, nextSequence: 1 }),
    ackProviderIdentityInboxMessage: async () => ({ ackedSequence: 0, nextSequence: 1 }),
    acceptPersonalProviderMessage: async () => ({}),
    acceptProjectInput: async () => ({}) as never,
    answerHumanNeeded: async () => ({}) as never,
    applyProviderLocatorChange: async () => ({ kind: 'personal_projection' as const, resourceId: 'projection-1' }),
    pullInbox: async () => ({ messages: [], ackedSequence: 0, nextSequence: 1 }),
    ackInboxMessage: async () => ({ ackedSequence: 0, nextSequence: 1 }),
    recordRejectedBoundary: async () => undefined,
    decideRemoteCapabilityApproval: async () => ({}),
    confirmRemoteApprovalCard: async () => undefined,
    enqueueRemoteApprovalFallback: async () => undefined,
    expireRemoteCapabilityApprovals: async () => 0
  }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for provider runtime condition.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function runtimeDiagnosticFor(error: unknown): Promise<ProviderDiagnostic> {
  const provider = new FakeProvider(messageEvent('event-diagnostic-1', 'cursor-diagnostic-1', 'message-diagnostic-1'))
  const ledger = new FakeRuntimeStore()
  const runtime = new DefaultCollaborationProviderRuntime({
    providers: [provider],
    store: ledger,
    authentication: { resolveProviderIdentity: async () => ({
      kind: 'human_endpoint', actorKey: 'endpoint:hep_1:revision:1', userId: 'usr_1',
      humanEndpointId: 'hep_1', assurance: 'verified'
    }) },
    repository: emptyRepository(),
    service: { ...emptyService(), acceptPersonalProviderMessage: async () => { throw error } }
  })
  await runtime.start()
  await waitUntil(() => ledger.diagnostics.length > 0, 1_500)
  await runtime.stop()
  const diagnostic = ledger.diagnostics[0]
  if (!diagnostic) throw new Error('Expected a provider diagnostic.')
  return diagnostic
}
