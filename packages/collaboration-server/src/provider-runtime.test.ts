import {
  CURRENT_PROTOCOL_VERSION,
  type HumanEndpointProvider,
  type ProviderEvent,
  type ProviderLifecycleRequest,
  type ProviderLifecycleResult,
  type ProviderDiagnostic,
  type ProviderSendRequest,
  type ProviderSendResult
} from '@sciforge/collaboration-contracts'
import { describe, expect, it } from 'vitest'

import { DefaultCollaborationProviderRuntime } from './provider-runtime.js'
import { ProviderRuntimeStore } from './provider-runtime-store.js'

const LOCATOR = {
  type: 'provider_locator' as const,
  provider: 'fake',
  realmId: 'realm-1',
  containerId: 'stream-1',
  topicId: 'topic-1',
  topicDisplayName: '固定 Session'
}

describe('provider runtime', () => {
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
    expect(acknowledgements).toEqual([1, 2])
    expect(provider.sendRequests).toHaveLength(sendsAfterDelivery)
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
      identityChallenge: true as const
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

  constructor(event: ProviderEvent | ProviderEvent[], private readonly sendResults: ProviderSendResult[] = []) {
    this.eventsToYield = Array.isArray(event) ? event : [event]
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
  async listLocators(): Promise<never> { throw new Error('not used') }
  async updateLocator(): Promise<never> { throw new Error('not used') }
  async diagnose(): Promise<never> { throw new Error('not used') }
}

class FakeRuntimeStore {
  cursor: string | undefined
  releases = 0
  completedEvents: string[] = []
  diagnostics: ProviderDiagnostic[] = []
  private readonly claimStates = new Map<string, 'available' | 'claimed' | 'processed'>()
  private initialInProgressConsumed = false
  private readonly deliveries = new Map<string, {
    result: ProviderSendResult
    attemptCount: number
    terminal: boolean
  }>()
  pendingEndpointIds: () => string[] = () => []

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
    this.claimStates.set(input.eventId, 'processed')
    this.cursor = input.eventCursor
    this.completedEvents.push(input.eventId)
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
    getInboxCursor: async () => null
  }
}

function emptyService() {
  return {
    verifyPairingFromProvider: async () => ({}),
    acceptPersonalProviderMessage: async () => ({}),
    acceptProjectInput: async () => ({}) as never,
    answerHumanNeeded: async () => ({}) as never,
    applyProviderLocatorChange: async () => ({ kind: 'personal_projection' as const, resourceId: 'projection-1' }),
    pullInbox: async () => ({ messages: [], ackedSequence: 0, nextSequence: 1 }),
    ackInboxMessage: async () => ({ ackedSequence: 0, nextSequence: 1 }),
    recordRejectedBoundary: async () => undefined
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
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
