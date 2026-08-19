import { createHash } from 'node:crypto'
import {
  CURRENT_PROTOCOL_VERSION,
  decodePairingBindCode,
  providerDiagnosticSchema,
  providerEventSchema,
  providerLifecycleResultSchema,
  providerLocatorListResultSchema,
  providerLocatorMutationResultSchema,
  providerSendResultSchema,
  providerVerifyIdentityResultSchema,
  type HumanEndpointProvider,
  type HumanEndpointProviderContract,
  type ProviderDiagnostic,
  type ProviderDirectRecipient,
  type ProviderEvent,
  type ProviderLifecycleRequest,
  type ProviderLifecycleResult,
  type ProviderLocator,
  type ProviderLocatorListRequest,
  type ProviderLocatorListResult,
  type ProviderLocatorMutationRequest,
  type ProviderLocatorMutationResult,
  type ProviderSendRequest,
  type ProviderSendResult,
  type ProviderVerifyIdentityRequest,
  type ProviderVerifyIdentityResult
} from '@sciforge/collaboration-contracts'
import { ZulipDeliveryCoordinator, type ZulipDeliveryLedger, type ZulipDeliveryReconciler } from './delivery.js'
import { ZulipProviderError, isZulipProviderError } from './errors.js'
import { ZulipHttpClient, type ZulipCredentialResolver, type ZulipDiagnosticLogger, type ZulipFetch } from './http-client.js'
import type { ZulipLocator } from './locator.js'
import { shouldSendZulipNotification, type ZulipNotification } from './notifications.js'
import { ZulipProviderRateLimiter } from './rate-limit.js'
import { redactZulipDiagnostic } from './redaction.js'
import {
  zulipEventsResponseSchema,
  zulipMessagesResponseSchema,
  zulipRegisterResponseSchema,
  zulipSendResponseSchema,
  zulipSubscriptionsResponseSchema,
  zulipTopicsResponseSchema,
  zulipUpdateMessageResponseSchema,
  zulipUserResponseSchema,
  type ZulipMessage,
  type ZulipMessageEvent,
  type ZulipRawEvent,
  type ZulipUpdateMessageEvent
} from './schemas.js'

const MAX_INBOUND_TEXT_BYTES = 32_000
const MAX_OUTBOUND_TEXT_BYTES = 40_000
const DEFAULT_EVENT_TIMEOUT_SECONDS = 60

export type ZulipProviderConfig = {
  realmUrl: string
  botEmail: string
}

export type ZulipProviderDependencies = {
  fetch?: ZulipFetch
  resolveCredential: ZulipCredentialResolver
  deliveryLedger: ZulipDeliveryLedger
  reconcileDelivery: ZulipDeliveryReconciler
  resolveLocator: ZulipStableLocatorResolver
  verifyIdentity: ZulipIdentityVerifier
  logger?: ZulipDiagnosticLogger
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  rateLimiter?: ZulipProviderRateLimiter
}

export type ZulipBotIdentity = {
  provider: 'zulip'
  realmId: string
  providerUserId: string
  botEmail: string
  displayName: string
}

export type ZulipEventCursor = {
  queueId: string
  lastEventId: number
  registeredAt: string
}

export type ZulipCanonicalMessageEvent = Extract<ProviderEvent, { type: 'provider.message.created' }>

export type ZulipStableLocatorResolver = (coordinates: {
  provider: 'zulip'
  realmId: string
  containerId: string
  topicDisplayName: string
}) => Promise<ProviderLocator>

export type ZulipIdentityVerifier = (
  request: ProviderVerifyIdentityRequest
) => Promise<ProviderVerifyIdentityResult>

export type ZulipPollResult = {
  cursor: ZulipEventCursor
  events: ProviderEvent[]
}

export type ZulipStream = { id: string; name: string }
export type ZulipTopic = { name: string; maxMessageId?: string }

type ZulipLocatorCoordinates = {
  provider: 'zulip'
  realmId: string
  containerId: string
  topicDisplayName: string
}

type ZulipLocatorOverlay = Map<string, ProviderLocator | null>

export const ZULIP_HUMAN_ENDPOINT_PROVIDER_CONTRACT: HumanEndpointProviderContract = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  type: 'human_endpoint_provider_contract',
  provider: 'zulip',
  displayName: 'Zulip',
  capabilities: {
    textMessages: true,
    stableLocators: true,
    eventCursor: true,
    locatorRename: true,
    locatorMove: true,
    locatorDiscovery: true,
    identityChallenge: true,
    directMessages: true
  },
  onboarding: {
    realmLabel: 'Zulip server URL',
    accountLabel: 'Bot email',
    containerLabel: 'Stream',
    topicLabel: 'Topic'
  },
  limits: {
    maxTextLength: 10_000,
    maxLocatorDisplayLength: 200
  }
}

function encodeEventCursor(cursor: ZulipEventCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeEventCursor(raw: string): ZulipEventCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<ZulipEventCursor>
    if (
      typeof parsed.queueId !== 'string' || !parsed.queueId.trim() ||
      typeof parsed.lastEventId !== 'number' || !Number.isSafeInteger(parsed.lastEventId) ||
      typeof parsed.registeredAt !== 'string' || !Number.isFinite(Date.parse(parsed.registeredAt))
    ) throw new Error('invalid cursor')
    return {
      queueId: parsed.queueId,
      lastEventId: parsed.lastEventId,
      registeredAt: parsed.registeredAt
    }
  } catch (error) {
    throw new ZulipProviderError('invalid_payload', 'Zulip event cursor is invalid.', { cause: error })
  }
}

function stableId(value: number | string): string {
  return String(value).trim()
}

function stableMessageEventId(realmId: string, remoteMessageId: string): string {
  const realmHash = createHash('sha256').update(realmId, 'utf8').digest('hex').slice(0, 24)
  return `zulip:${realmHash}:message:${remoteMessageId}`
}

function stableLocatorEventId(realmId: string, event: ZulipUpdateMessageEvent): string {
  const realmHash = createHash('sha256').update(realmId, 'utf8').digest('hex').slice(0, 24)
  const operationHash = createHash('sha256').update(JSON.stringify({
    messageId: stableId(event.message_id),
    editTimestamp: event.edit_timestamp ?? null,
    streamId: event.stream_id === undefined ? null : stableId(event.stream_id),
    originalTopic: event.orig_subject ?? null,
    newStreamId: event.new_stream_id === undefined ? null : stableId(event.new_stream_id),
    newTopic: event.subject ?? null,
    propagateMode: event.propagate_mode ?? null
  }), 'utf8').digest('hex').slice(0, 32)
  return `zulip:${realmHash}:locator:${operationHash}`
}

function stableDiscoveredTopicId(realmId: string, streamId: string, topicName: string): string {
  const identity = [
    realmId.trim(),
    streamId.trim(),
    topicName.normalize('NFC').trim().toLocaleLowerCase('und')
  ].join('\u0000')
  return `zulip-topic-${createHash('sha256').update(identity, 'utf8').digest('hex')}`
}

function normalizedTopic(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('und')
}

function locatorCoordinatesKey(coordinates: ZulipLocatorCoordinates): string {
  return [
    coordinates.realmId.trim(),
    coordinates.containerId.trim(),
    normalizedTopic(coordinates.topicDisplayName)
  ].join('\u0000')
}

function assertResolvedLocator(
  locator: ProviderLocator,
  coordinates: ZulipLocatorCoordinates
): ProviderLocator {
  if (
    locator.provider !== 'zulip' ||
    locator.realmId !== coordinates.realmId ||
    locator.containerId !== coordinates.containerId ||
    !locator.topicId.trim() ||
    typeof locator.topicDisplayName !== 'string' ||
    normalizedTopic(locator.topicDisplayName) !== normalizedTopic(coordinates.topicDisplayName)
  ) {
    throw new ZulipProviderError(
      'invalid_locator',
      'Resolved Zulip locator does not match the requested stable coordinates.'
    )
  }
  return locator
}

const PAIRING_COMMAND = /^sciforge-pair (chl_[A-Za-z0-9]{12,64}) ([A-Za-z0-9._~:-]{8,128})$/u
const BIND_COMMAND = /^\/bind (\S+)$/u
const HUMAN_ANSWER_COMMAND = /^sciforge-answer (hrq_[A-Za-z0-9]{12,64}) ([1-9][0-9]{0,15}) ([\s\S]+)$/u

function pairingResponse(text: string): { challengeId: string; challengeResponse: string } | null {
  const match = PAIRING_COMMAND.exec(text)
  if (!match) return null
  return { challengeId: match[1]!, challengeResponse: match[2]! }
}

function bindPairingResponse(text: string): { challengeId: string; challengeResponse: string } | null {
  const match = BIND_COMMAND.exec(text)
  if (!match) return null
  try {
    return decodePairingBindCode(match[1]!)
  } catch {
    return null
  }
}

function humanAnswerResponse(text: string): {
  humanRequestId: string
  requestRevision: number
  answer: string
} | null {
  const match = HUMAN_ANSWER_COMMAND.exec(text)
  if (!match) return null
  const requestRevision = Number(match[2])
  const answer = match[3]!.trim()
  if (!Number.isSafeInteger(requestRevision) || requestRevision < 1 || !answer || answer.length > 32_000) {
    return null
  }
  return { humanRequestId: match[1]!, requestRevision, answer }
}

function boundedText(raw: string): string {
  const text = raw.trim()
  if (!text) throw new ZulipProviderError('invalid_payload', 'Zulip message text is empty.')
  if (Buffer.byteLength(text, 'utf8') > MAX_INBOUND_TEXT_BYTES) {
    throw new ZulipProviderError('payload_too_large', 'Zulip message exceeds the inbound text limit.')
  }
  return text
}

function boundedOutboundText(raw: string): string {
  const text = raw.trim()
  if (!text) throw new ZulipProviderError('invalid_payload', 'Zulip outbound message is empty.')
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTBOUND_TEXT_BYTES || text.length > 10_000) {
    throw new ZulipProviderError('payload_too_large', 'Zulip message exceeds the outbound text limit.')
  }
  return text
}

function requireLocator(locator: ZulipLocator, realmId: string): ZulipLocator {
  if (
    locator.provider !== 'zulip' ||
    locator.realmId !== realmId ||
    !locator.containerId.trim() ||
    !locator.topicId.trim() ||
    !locator.topicDisplayName.trim()
  ) {
    throw new ZulipProviderError('invalid_locator', 'Zulip locator is invalid for this realm.')
  }
  return locator
}

function canonicalOccurredAt(message: ZulipMessage, fallback: Date): string {
  return typeof message.timestamp === 'number'
    ? new Date(message.timestamp * 1_000).toISOString()
    : fallback.toISOString()
}

export class ZulipHumanEndpointProvider implements HumanEndpointProvider {
  readonly provider = 'zulip' as const
  readonly contract = ZULIP_HUMAN_ENDPOINT_PROVIDER_CONTRACT
  readonly realmId: string
  private readonly client: ZulipHttpClient
  private readonly delivery: ZulipDeliveryCoordinator
  private readonly resolveStableLocator: ZulipStableLocatorResolver
  private readonly verifyProviderIdentity: ZulipIdentityVerifier
  private readonly logger: ZulipDiagnosticLogger | undefined
  private readonly now: () => Date
  private readonly rateLimiter: ZulipProviderRateLimiter
  private readonly sleep: (milliseconds: number) => Promise<void>
  private botIdentity: ZulipBotIdentity | null = null
  private lifecycleAbort: AbortController | null = null
  private lifecycleStatus: 'connected' | 'disconnected' | 'degraded' = 'disconnected'
  private lifecycleCursor: string | undefined

  constructor(config: ZulipProviderConfig, dependencies: ZulipProviderDependencies) {
    this.logger = dependencies.logger
    this.now = dependencies.now ?? (() => new Date())
    this.client = new ZulipHttpClient({
      realmUrl: config.realmUrl,
      botEmail: config.botEmail,
      resolveCredential: dependencies.resolveCredential,
      ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
      ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
      ...(dependencies.logger ? { logger: dependencies.logger } : {})
    })
    this.realmId = this.client.realmId
    this.delivery = new ZulipDeliveryCoordinator({
      ledger: dependencies.deliveryLedger,
      reconcile: dependencies.reconcileDelivery,
      now: this.now,
      ...(dependencies.sleep ? { sleep: dependencies.sleep } : {})
    })
    this.resolveStableLocator = dependencies.resolveLocator
    this.verifyProviderIdentity = dependencies.verifyIdentity
    this.rateLimiter = dependencies.rateLimiter ?? new ZulipProviderRateLimiter({
      maxEvents: 120,
      windowMs: 60_000
    })
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  async authenticate(): Promise<ZulipBotIdentity> {
    const user = await this.client.request('api/v1/users/me', {
      schema: zulipUserResponseSchema,
      retry: 'safe'
    })
    if (!user.is_bot) throw new ZulipProviderError('authentication_failed', 'Configured Zulip identity is not a bot.')
    const identity: ZulipBotIdentity = {
      provider: 'zulip',
      realmId: this.realmId,
      providerUserId: stableId(user.user_id),
      botEmail: user.email.trim(),
      displayName: user.full_name.trim()
    }
    this.botIdentity = identity
    return identity
  }

  async verifyIdentity(request: ProviderVerifyIdentityRequest): Promise<ProviderVerifyIdentityResult> {
    if (
      request.expectedIdentity.provider !== 'zulip' ||
      request.expectedIdentity.realmId !== this.realmId
    ) {
      return {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.identity.rejected',
        reason: 'identity_mismatch'
      }
    }
    return providerVerifyIdentityResultSchema.parse(await this.verifyProviderIdentity(request))
  }

  async *events(
    request: Extract<ProviderLifecycleRequest, { type: 'provider.lifecycle.start' }>
  ): AsyncIterable<ProviderEvent> {
    await this.lifecycle(request)
    const signal = this.lifecycleAbort!.signal
    if (!this.botIdentity) await this.authenticate()
    let current: ZulipPollResult
    if (request.afterCursor) {
      const resumedCursor = decodeEventCursor(request.afterCursor)
      try {
        current = await this.pollEvents(resumedCursor, { signal })
      } catch (error) {
        if (!isZulipProviderError(error) || (!error.retryable && error.code !== 'queue_expired')) throw error
        current = await this.registerEventQueue(signal)
      }
    } else {
      current = await this.registerEventQueue(signal)
    }

    while (!signal.aborted) {
      this.lifecycleStatus = 'connected'
      this.lifecycleCursor = encodeEventCursor(current.cursor)
      for (const event of current.events) yield providerEventSchema.parse(event)
      try {
        current = await this.pollEvents(current.cursor, { signal })
      } catch (error) {
        if (signal.aborted) break
        this.lifecycleStatus = 'degraded'
        this.emitFailure('zulip.events.poll_failed', 'Zulip event polling failed; registering a new queue.', {
          errorCode: isZulipProviderError(error) ? error.code : 'provider_unavailable',
          status: isZulipProviderError(error) ? error.status : undefined
        })
        if (isZulipProviderError(error) && !error.retryable && error.code !== 'queue_expired') throw error
        await this.sleep(2_500)
        current = await this.registerEventQueue(signal)
      }
    }
  }

  async listStreams(signal?: AbortSignal): Promise<ZulipStream[]> {
    const response = await this.client.request('api/v1/users/me/subscriptions', {
      schema: zulipSubscriptionsResponseSchema,
      retry: 'safe',
      ...(signal ? { signal } : {})
    })
    return response.subscriptions
      .filter((stream) => stream.is_archived !== true)
      .map((stream) => ({ id: stableId(stream.stream_id), name: stream.name.trim() }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async listTopics(streamId: string, signal?: AbortSignal): Promise<ZulipTopic[]> {
    const target = streamId.trim()
    if (!target) throw new ZulipProviderError('invalid_locator', 'Zulip stream ID is required.')
    const response = await this.client.request(`api/v1/users/me/${encodeURIComponent(target)}/topics`, {
      schema: zulipTopicsResponseSchema,
      retry: 'safe',
      ...(signal ? { signal } : {})
    })
    return response.topics
      .map((topic) => ({
        name: topic.name.trim(),
        ...(topic.max_id === undefined ? {} : { maxMessageId: stableId(topic.max_id) })
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async listLocators(request: ProviderLocatorListRequest): Promise<ProviderLocatorListResult> {
    if (request.realmId !== this.realmId) {
      throw new ZulipProviderError('invalid_locator', 'Requested realm does not match this Zulip provider.')
    }
    let offset = 0
    if (request.cursor) {
      const decoded = Buffer.from(request.cursor, 'base64url').toString('utf8')
      offset = Number(decoded)
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new ZulipProviderError('invalid_payload', 'Zulip locator cursor is invalid.')
      }
    }
    const query = request.query?.normalize('NFC').trim().toLocaleLowerCase('und') ?? ''
    const discovered: ProviderLocator[] = []
    for (const stream of await this.listStreams()) {
      for (const topic of await this.listTopics(stream.id)) {
        if (query && !`${stream.name}\n${topic.name}`.normalize('NFC').toLocaleLowerCase('und').includes(query)) {
          continue
        }
        const coordinates = {
          provider: 'zulip' as const,
          realmId: this.realmId,
          containerId: stream.id,
          topicDisplayName: topic.name
        }
        const existing = await this.resolveStableLocator(coordinates)
          .catch((error) => {
            if (isZulipProviderError(error) && error.code === 'locator_missing') return undefined
            throw error
          })
        discovered.push(existing ?? {
          type: 'provider_locator',
          provider: 'zulip',
          realmId: this.realmId,
          containerId: stream.id,
          topicId: stableDiscoveredTopicId(this.realmId, stream.id, topic.name),
          containerDisplayName: stream.name.slice(0, 200),
          topicDisplayName: topic.name.slice(0, 200)
        })
      }
    }
    const locators = discovered.slice(offset, offset + request.limit)
    const nextOffset = offset + locators.length
    return providerLocatorListResultSchema.parse({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.locator.page',
      locators,
      ...(nextOffset < discovered.length
        ? { nextCursor: Buffer.from(String(nextOffset), 'utf8').toString('base64url') }
        : {})
    })
  }

  async registerEventQueue(signal?: AbortSignal): Promise<ZulipPollResult> {
    const response = await this.client.request('api/v1/register', {
      method: 'POST',
      body: new URLSearchParams({
        event_types: JSON.stringify(['message', 'update_message']),
        fetch_event_types: JSON.stringify([]),
        apply_markdown: 'false',
        client_gravatar: 'false',
        all_public_streams: 'false'
      }),
      schema: zulipRegisterResponseSchema,
      retry: 'never',
      ...(signal ? { signal } : {})
    })
    const cursor: ZulipEventCursor = {
      queueId: response.queue_id,
      lastEventId: response.last_event_id,
      registeredAt: this.now().toISOString()
    }
    return this.consumeRawEvents(cursor, response.events ?? [])
  }

  async pollEvents(
    cursor: ZulipEventCursor,
    options: { timeoutSeconds?: number; signal?: AbortSignal } = {}
  ): Promise<ZulipPollResult> {
    const queueId = cursor.queueId.trim()
    if (!queueId || !Number.isSafeInteger(cursor.lastEventId)) {
      throw new ZulipProviderError('invalid_payload', 'A valid Zulip event cursor is required.')
    }
    const timeoutSeconds = Math.max(1, Math.min(90, options.timeoutSeconds ?? DEFAULT_EVENT_TIMEOUT_SECONDS))
    const response = await this.client.request('api/v1/events', {
      query: new URLSearchParams({
        queue_id: queueId,
        last_event_id: String(cursor.lastEventId),
        dont_block: 'false',
        timeout: String(timeoutSeconds)
      }),
      schema: zulipEventsResponseSchema,
      retry: 'safe',
      ...(options.signal ? { signal: options.signal } : {})
    })
    return this.consumeRawEvents(cursor, response.events)
  }

  async closeEventQueue(cursor: ZulipEventCursor, signal?: AbortSignal): Promise<void> {
    await this.client.request('api/v1/events', {
      method: 'DELETE',
      query: new URLSearchParams({ queue_id: cursor.queueId }),
      schema: zulipUpdateMessageResponseSchema,
      retry: 'never',
      ...(signal ? { signal } : {})
    })
  }

  async backfillMessages(input: {
    locator: ZulipLocator
    afterRemoteMessageId?: string
    limit?: number
    signal?: AbortSignal
  }): Promise<ProviderEvent[]> {
    const locator = requireLocator(input.locator, this.realmId)
    const limit = Math.max(1, Math.min(1_000, input.limit ?? 100))
    const narrow = JSON.stringify([
      ['stream', locator.containerId],
      ['topic', locator.topicDisplayName]
    ])
    const query = new URLSearchParams({
      anchor: input.afterRemoteMessageId?.trim() || 'oldest',
      num_before: '0',
      num_after: String(limit),
      narrow,
      apply_markdown: 'false'
    })
    const response = await this.client.request('api/v1/messages', {
      query,
      schema: zulipMessagesResponseSchema,
      retry: 'safe',
      ...(input.signal ? { signal: input.signal } : {})
    })
    const events: ProviderEvent[] = []
    for (const message of response.messages) {
      if (message.type !== 'stream') continue
      const synthetic: ZulipMessageEvent = {
        id: Number(message.id),
        type: 'message',
        message
      }
      const backfillCursor = `backfill:${stableId(message.id)}`
      const canonical = await this.toCanonicalMessageEvent(
        synthetic,
        backfillCursor
      )
      if (canonical) events.push(canonical)
    }
    return events
  }

  async sendMessage(input: {
    locator: ZulipLocator
    content: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<{ remoteMessageId: string; duplicate: boolean; reconciled: boolean; attempts: number }> {
    const locator = requireLocator(input.locator, this.realmId)
    const content = boundedOutboundText(input.content)
    return this.delivery.deliver({
      idempotencyKey: input.idempotencyKey,
      locator,
      content,
      send: async () => {
        const response = await this.client.request('api/v1/messages', {
          method: 'POST',
          body: new URLSearchParams({
            type: 'stream',
            to: locator.containerId,
            topic: locator.topicDisplayName,
            content
          }),
          schema: zulipSendResponseSchema,
          retry: 'never',
          ...(input.signal ? { signal: input.signal } : {})
        })
        return { remoteMessageId: stableId(response.id) }
      }
    })
  }

  async sendDirectMessage(input: {
    recipient: ProviderDirectRecipient
    content: string
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<{ remoteMessageId: string; duplicate: boolean; reconciled: boolean; attempts: number }> {
    if (input.recipient.provider !== 'zulip' || input.recipient.realmId !== this.realmId) {
      throw new ZulipProviderError('invalid_payload', 'The Zulip direct recipient does not belong to this provider instance.')
    }
    if (!/^(?:0|[1-9][0-9]*)$/u.test(input.recipient.providerUserId)) {
      throw new ZulipProviderError('invalid_payload', 'The Zulip direct recipient requires an authenticated numeric user ID.')
    }
    const content = boundedOutboundText(input.content)
    return this.delivery.deliver({
      idempotencyKey: input.idempotencyKey,
      directRecipient: input.recipient,
      content,
      send: async () => {
        const response = await this.client.request('api/v1/messages', {
          method: 'POST',
          body: new URLSearchParams({
            type: 'direct',
            to: `[${input.recipient.providerUserId}]`,
            content
          }),
          schema: zulipSendResponseSchema,
          retry: 'never',
          ...(input.signal ? { signal: input.signal } : {})
        })
        return { remoteMessageId: stableId(response.id) }
      }
    })
  }

  async sendNotification(input: {
    locator: ZulipLocator
    notification: ZulipNotification
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<{ remoteMessageId: string; duplicate: boolean; reconciled: boolean; attempts: number } | null> {
    if (!shouldSendZulipNotification(input.notification)) return null
    return this.sendMessage({
      locator: input.locator,
      content: input.notification.content,
      idempotencyKey: input.idempotencyKey,
      ...(input.signal ? { signal: input.signal } : {})
    })
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    const target = 'recipient' in request ? request.recipient : request.locator
    if (target.provider !== 'zulip' || target.realmId !== this.realmId) {
      return providerSendResultSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.send.failed',
        clientMessageId: request.clientMessageId,
        retryable: false,
        providerErrorCode: 'invalid_locator',
        safeMessage: 'The Zulip locator does not belong to this provider instance.'
      })
    }
    try {
      const result = 'recipient' in request
        ? await this.sendDirectMessage({
            recipient: request.recipient,
            content: request.text,
            idempotencyKey: request.clientMessageId
          })
        : await this.sendMessage({
            locator: request.locator as ZulipLocator,
            content: request.text,
            idempotencyKey: request.clientMessageId
          })
      return providerSendResultSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.send.succeeded',
        clientMessageId: request.clientMessageId,
        providerMessageId: result.remoteMessageId,
        sentAt: this.now().toISOString()
      })
    } catch (error) {
      const providerError = isZulipProviderError(error) ? error : null
      return providerSendResultSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.send.failed',
        clientMessageId: request.clientMessageId,
        retryable: providerError?.retryable ?? false,
        providerErrorCode: providerError?.code ?? 'provider_unavailable',
        safeMessage: providerError?.message ?? 'Zulip provider operation failed.'
      })
    }
  }

  async updateLocator(request: ProviderLocatorMutationRequest): Promise<ProviderLocatorMutationResult> {
    if (request.locator.provider !== 'zulip' || request.locator.realmId !== this.realmId) {
      throw new ZulipProviderError('invalid_locator', 'Zulip locator does not belong to this provider instance.')
    }
    const locator = request.locator as ZulipLocator
    const topics = await this.listTopics(locator.containerId)
    const anchor = topics.find((topic) =>
      topic.name.normalize('NFC').toLocaleLowerCase('und') ===
      (locator.topicDisplayName ?? '').normalize('NFC').toLocaleLowerCase('und')
    )?.maxMessageId
    if (!anchor) {
      throw new ZulipProviderError('locator_missing', 'Zulip topic has no anchor message for mutation.')
    }
    const updated = request.type === 'provider.locator.rename'
      ? await this.renameTopic({
          locator,
          anchorMessageId: anchor,
          newTopicName: request.newTopicDisplayName
        })
      : await this.moveTopic({
          locator,
          anchorMessageId: anchor,
          newStreamId: request.destinationContainerId,
          newStreamName: request.destinationContainerDisplayName ?? request.destinationContainerId
        })
    return providerLocatorMutationResultSchema.parse({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.locator.updated',
      locator: updated,
      updatedAt: this.now().toISOString()
    })
  }

  async lifecycle(request: ProviderLifecycleRequest): Promise<ProviderLifecycleResult> {
    if (request.type === 'provider.lifecycle.start') {
      this.lifecycleAbort?.abort()
      this.lifecycleAbort = new AbortController()
      this.lifecycleStatus = 'connected'
      if (request.afterCursor) {
        decodeEventCursor(request.afterCursor)
        this.lifecycleCursor = request.afterCursor
      }
    } else if (request.type === 'provider.lifecycle.stop') {
      this.lifecycleAbort?.abort()
      this.lifecycleAbort = null
      this.lifecycleStatus = 'disconnected'
      this.lifecycleCursor = undefined
    }
    return providerLifecycleResultSchema.parse({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.lifecycle.status',
      status: this.lifecycleStatus,
      ...(this.lifecycleCursor ? { cursor: this.lifecycleCursor } : {}),
      checkedAt: this.now().toISOString()
    })
  }

  async diagnose(): Promise<ProviderDiagnostic> {
    try {
      await this.authenticate()
      return providerDiagnosticSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.diagnostic',
        provider: 'zulip',
        status: 'healthy',
        checkedAt: this.now().toISOString(),
        safeSummary: 'Zulip provider authentication succeeded.',
        details: this.diagnosticStatus()
      })
    } catch (error) {
      return providerDiagnosticSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        type: 'provider.diagnostic',
        provider: 'zulip',
        status: 'unavailable',
        checkedAt: this.now().toISOString(),
        safeSummary: 'Zulip provider authentication failed.',
        details: redactZulipDiagnostic({
          errorCode: isZulipProviderError(error) ? error.code : 'provider_unavailable'
        })
      })
    }
  }

  async renameTopic(input: {
    locator: ZulipLocator
    anchorMessageId: string
    newTopicName: string
    signal?: AbortSignal
  }): Promise<ZulipLocator> {
    const locator = requireLocator(input.locator, this.realmId)
    const topic = input.newTopicName.trim()
    if (!topic || topic.length > 60) throw new ZulipProviderError('invalid_locator', 'Zulip topic name is invalid.')
    await this.updateTopic({
      anchorMessageId: input.anchorMessageId,
      body: new URLSearchParams({ topic, propagate_mode: 'change_all' }),
      ...(input.signal ? { signal: input.signal } : {})
    })
    return { ...locator, topicDisplayName: topic }
  }

  async moveTopic(input: {
    locator: ZulipLocator
    anchorMessageId: string
    newStreamId: string
    newStreamName: string
    newTopicName?: string
    signal?: AbortSignal
  }): Promise<ZulipLocator> {
    const locator = requireLocator(input.locator, this.realmId)
    const streamId = input.newStreamId.trim()
    const streamName = input.newStreamName.trim()
    const topic = input.newTopicName?.trim() || locator.topicDisplayName
    if (!streamId || !streamName || !topic || topic.length > 60) {
      throw new ZulipProviderError('invalid_locator', 'Zulip move target is invalid.')
    }
    await this.updateTopic({
      anchorMessageId: input.anchorMessageId,
      body: new URLSearchParams({
        stream_id: streamId,
        topic,
        propagate_mode: 'change_all'
      }),
      ...(input.signal ? { signal: input.signal } : {})
    })
    return {
      ...locator,
      containerId: streamId,
      containerDisplayName: streamName,
      topicDisplayName: topic
    }
  }

  diagnosticStatus(): { provider: 'zulip'; realmId: string; botUserId?: string; authenticated: boolean } {
    return {
      provider: 'zulip',
      realmId: this.realmId,
      ...(this.botIdentity ? { botUserId: this.botIdentity.providerUserId } : {}),
      authenticated: this.botIdentity !== null
    }
  }

  private async consumeRawEvents(
    cursor: ZulipEventCursor,
    rawEvents: readonly ZulipRawEvent[]
  ): Promise<ZulipPollResult> {
    const events: ProviderEvent[] = []
    const locatorOverlay: ZulipLocatorOverlay = new Map()
    let lastEventId = cursor.lastEventId
    for (const event of rawEvents) {
      lastEventId = Math.max(lastEventId, event.id)
      const eventCursor = encodeEventCursor({ ...cursor, lastEventId: event.id })
      const canonical = event.type === 'message'
        ? await this.toCanonicalMessageEvent(event, eventCursor, locatorOverlay)
        : event.type === 'update_message'
          ? await this.toCanonicalLocatorChangedEvent(event, eventCursor, locatorOverlay)
          : null
      if (canonical) events.push(canonical)
    }
    return { cursor: { ...cursor, lastEventId }, events }
  }

  private async toCanonicalMessageEvent(
    event: ZulipMessageEvent,
    eventCursor: string,
    locatorOverlay?: ZulipLocatorOverlay
  ): Promise<ProviderEvent | null> {
    const message = event.message
    const remoteMessageId = stableId(message.id)
    const eventId = stableMessageEventId(this.realmId, remoteMessageId)
    const senderId = stableId(message.sender_id)
    if (!remoteMessageId || !senderId) {
      throw new ZulipProviderError('invalid_payload', 'Zulip message lacks a stable identity.')
    }
    const text = boundedText(message.raw_content ?? message.content)
    this.rateLimiter.consume(`${this.realmId}\u0000${senderId}`)
    const receivedAt = this.now()
    const bot = this.botIdentity
    const isSelfEcho = message.is_me_message === true || (
      bot !== null && senderId === bot.providerUserId
    )
    if (isSelfEcho) return null
    if (message.type === 'private') {
      const pairing = bindPairingResponse(text)
      if (!pairing) return null
      return providerEventSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        provider: 'zulip',
        type: 'provider.challenge.responded',
        eventId,
        eventCursor,
        occurredAt: canonicalOccurredAt(message, receivedAt),
        identity: {
          type: 'provider_identity',
          provider: 'zulip',
          realmId: this.realmId,
          providerUserId: senderId,
          displayName: message.sender_full_name.trim().slice(0, 200)
        },
        challengeId: pairing.challengeId,
        challengeResponse: pairing.challengeResponse
      })
    }
    const streamId = stableId(message.stream_id ?? '')
    const topic = (message.topic ?? message.subject ?? '').trim()
    if (!remoteMessageId || !senderId || !streamId || !topic) {
      throw new ZulipProviderError('invalid_payload', 'Zulip stream message lacks a stable identity or locator.')
    }
    const pairing = pairingResponse(text)
    if (pairing) {
      return providerEventSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        provider: 'zulip',
        type: 'provider.challenge.responded',
        eventId,
        eventCursor,
        occurredAt: canonicalOccurredAt(message, receivedAt),
        identity: {
          type: 'provider_identity',
          provider: 'zulip',
          realmId: this.realmId,
          providerUserId: senderId,
          displayName: message.sender_full_name.trim().slice(0, 200)
        },
        challengeId: pairing.challengeId,
        challengeResponse: pairing.challengeResponse
      })
    }
    const answer = humanAnswerResponse(text)
    if (answer) {
      const locator = await this.resolveLocatorAt({
        provider: 'zulip',
        realmId: this.realmId,
        containerId: streamId,
        topicDisplayName: topic
      }, locatorOverlay)
      return providerEventSchema.parse({
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        provider: 'zulip',
        type: 'provider.human_answer.responded',
        eventId,
        eventCursor,
        occurredAt: canonicalOccurredAt(message, receivedAt),
        identity: {
          type: 'provider_identity',
          provider: 'zulip',
          realmId: this.realmId,
          providerUserId: senderId,
          displayName: message.sender_full_name.trim().slice(0, 200)
        },
        locator,
        providerMessageId: remoteMessageId,
        humanRequestId: answer.humanRequestId,
        requestRevision: answer.requestRevision,
        answer: answer.answer
      })
    }
    const locator = await this.resolveLocatorAt({
      provider: 'zulip',
      realmId: this.realmId,
      containerId: streamId,
      topicDisplayName: topic
    }, locatorOverlay)
    if (
      locator.provider !== 'zulip' ||
      locator.realmId !== this.realmId ||
      locator.containerId !== streamId ||
      !locator.topicId.trim()
    ) {
      throw new ZulipProviderError('invalid_locator', 'Resolved Zulip locator is not stable or does not match the event.')
    }
    return providerEventSchema.parse({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'zulip',
      type: 'provider.message.created',
      eventId,
      eventCursor,
      occurredAt: canonicalOccurredAt(message, receivedAt),
      identity: {
        type: 'provider_identity',
        provider: 'zulip',
        realmId: this.realmId,
        providerUserId: senderId,
        displayName: message.sender_full_name.trim().slice(0, 200)
      },
      locator,
      providerMessageId: remoteMessageId,
      text,
      isSelfEcho: false
    })
  }

  private async toCanonicalLocatorChangedEvent(
    event: ZulipUpdateMessageEvent,
    eventCursor: string,
    locatorOverlay: ZulipLocatorOverlay
  ): Promise<ProviderEvent | null> {
    const isLocationChange = event.orig_subject !== undefined ||
      event.subject !== undefined || event.new_stream_id !== undefined || event.propagate_mode !== undefined
    if (!isLocationChange || event.rendering_only === true) return null
    if (event.propagate_mode !== 'change_all') return null
    if (event.stream_id === undefined || event.orig_subject === undefined || !event.stream_name) {
      throw new ZulipProviderError(
        'invalid_payload',
        'Zulip location update lacks its authoritative previous stream or topic.'
      )
    }
    const remoteMessageId = stableId(event.message_id)
    if (!event.message_ids.some((messageId) => stableId(messageId) === remoteMessageId)) {
      throw new ZulipProviderError(
        'invalid_payload',
        'Zulip location update does not include its anchor message in the moved message set.'
      )
    }
    const previousCoordinates: ZulipLocatorCoordinates = {
      provider: 'zulip',
      realmId: this.realmId,
      containerId: stableId(event.stream_id),
      topicDisplayName: event.orig_subject.trim()
    }
    const currentCoordinates: ZulipLocatorCoordinates = {
      provider: 'zulip',
      realmId: this.realmId,
      containerId: event.new_stream_id === undefined
        ? previousCoordinates.containerId
        : stableId(event.new_stream_id),
      topicDisplayName: (event.subject ?? event.orig_subject).trim()
    }
    if (
      previousCoordinates.containerId === currentCoordinates.containerId &&
      normalizedTopic(previousCoordinates.topicDisplayName) === normalizedTopic(currentCoordinates.topicDisplayName)
    ) return null

    const previousResolved = await this.resolveOptionalLocator(previousCoordinates, locatorOverlay)
    const currentResolved = await this.resolveOptionalLocator(currentCoordinates, locatorOverlay)
    if (!previousResolved && !currentResolved) {
      throw new ZulipProviderError(
        'locator_missing',
        'No stable binding matches either side of the Zulip location update.'
      )
    }
    if (previousResolved && currentResolved && previousResolved.topicId !== currentResolved.topicId) {
      throw new ZulipProviderError(
        'locator_ambiguous',
        'The Zulip location update collides with a different stable binding.'
      )
    }
    const stableBinding = previousResolved ?? currentResolved!
    let currentContainerDisplayName = previousCoordinates.containerId === currentCoordinates.containerId
      ? event.stream_name
      : currentResolved?.containerDisplayName
    if (!currentContainerDisplayName) {
      currentContainerDisplayName = (await this.listStreams())
        .find((stream) => stream.id === currentCoordinates.containerId)?.name
    }
    if (!currentContainerDisplayName) {
      throw new ZulipProviderError(
        'locator_missing',
        'The destination Zulip stream is not uniquely visible to the provider.'
      )
    }
    const previousLocator: ProviderLocator = {
      type: 'provider_locator',
      provider: 'zulip',
      realmId: this.realmId,
      containerId: previousCoordinates.containerId,
      topicId: stableBinding.topicId,
      containerDisplayName: event.stream_name,
      topicDisplayName: previousCoordinates.topicDisplayName
    }
    const currentLocator: ProviderLocator = {
      type: 'provider_locator',
      provider: 'zulip',
      realmId: this.realmId,
      containerId: currentCoordinates.containerId,
      topicId: stableBinding.topicId,
      containerDisplayName: currentContainerDisplayName,
      topicDisplayName: currentCoordinates.topicDisplayName
    }
    locatorOverlay.set(locatorCoordinatesKey(previousCoordinates), null)
    locatorOverlay.set(locatorCoordinatesKey(currentCoordinates), currentLocator)
    return providerEventSchema.parse({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      provider: 'zulip',
      type: 'provider.locator.changed',
      eventId: stableLocatorEventId(this.realmId, event),
      eventCursor,
      occurredAt: event.edit_timestamp === undefined
        ? this.now().toISOString()
        : new Date(event.edit_timestamp * 1_000).toISOString(),
      previousLocator,
      currentLocator
    })
  }

  private async resolveLocatorAt(
    coordinates: ZulipLocatorCoordinates,
    locatorOverlay?: ZulipLocatorOverlay
  ): Promise<ProviderLocator> {
    const key = locatorCoordinatesKey(coordinates)
    if (locatorOverlay?.has(key)) {
      const locator = locatorOverlay.get(key)
      if (!locator) {
        throw new ZulipProviderError('locator_missing', 'No active binding matches the Zulip location.')
      }
      return assertResolvedLocator(locator, coordinates)
    }
    return assertResolvedLocator(await this.resolveStableLocator(coordinates), coordinates)
  }

  private async resolveOptionalLocator(
    coordinates: ZulipLocatorCoordinates,
    locatorOverlay: ZulipLocatorOverlay
  ): Promise<ProviderLocator | undefined> {
    try {
      return await this.resolveLocatorAt(coordinates, locatorOverlay)
    } catch (error) {
      if (isZulipProviderError(error) && error.code === 'locator_missing') return undefined
      throw error
    }
  }

  private async updateTopic(input: {
    anchorMessageId: string
    body: URLSearchParams
    signal?: AbortSignal
  }): Promise<void> {
    const anchor = input.anchorMessageId.trim()
    if (!anchor) throw new ZulipProviderError('invalid_payload', 'A topic anchor message is required.')
    await this.client.request(`api/v1/messages/${encodeURIComponent(anchor)}`, {
      method: 'PATCH',
      body: input.body,
      schema: zulipUpdateMessageResponseSchema,
      retry: 'never',
      ...(input.signal ? { signal: input.signal } : {})
    })
  }

  private emitFailure(code: string, message: string, detail?: unknown): void {
    if (!this.logger) return
    this.logger({
      level: 'error',
      code,
      message,
      ...(detail === undefined ? {} : { detail: redactZulipDiagnostic(detail) })
    })
  }
}

export function createZulipHumanEndpointProvider(
  config: ZulipProviderConfig,
  dependencies: ZulipProviderDependencies
): ZulipHumanEndpointProvider {
  return new ZulipHumanEndpointProvider(config, dependencies)
}
