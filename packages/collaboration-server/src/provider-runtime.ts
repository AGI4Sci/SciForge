import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import {
  CURRENT_PROTOCOL_VERSION,
  providerDiagnosticSchema,
  providerDirectRecipientSchema,
  providerLocatorSchema,
  providerSendResultSchema,
  type HumanEndpointProvider,
  type HumanEndpointProviderContract,
  type HumanEndpointProviderHttpRequest,
  type HumanEndpointProviderHttpResponse,
  type HumanEndpointProviderSecretReader,
  type HumanEndpointProviderServices,
  type ProviderEvent,
  type ProviderLocator,
  type ProviderSendRequest,
  type ProviderVerifyIdentityRequest,
  type ProviderVerifyIdentityResult
} from '@sciforge/collaboration-contracts'

import type { ProviderDirectory } from './api.js'
import type { AuthContext, HumanEndpointActor } from './auth.js'
import { AuthenticationService } from './auth.js'
import { stableDigest } from './crypto.js'
import { CollaborationServiceError } from './errors.js'
import {
  createInstalledHumanEndpointProviders,
  installedHumanEndpointProviderDefinitions,
  type InstalledHumanEndpointProviderDefinition
} from './generated/installed-human-endpoint-providers.js'
import type { StoredEndpoint, StoredInboxMessage } from './model.js'
import type { SqlPool } from './postgres.js'
import type { CollaborationRepository } from './repository.js'
import { ProviderRuntimeStore, type ProviderDeliveryState } from './provider-runtime-store.js'
import { CollaborationService, providerIdentityInboxId } from './service.js'

const MAX_PROVIDER_CONFIG_BYTES = 256 * 1024
const MAX_SECRET_BYTES = 64 * 1024
const MAX_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024
const DEFAULT_OUTBOX_POLL_MS = 1_000

export type ProviderConfiguration = Readonly<{
  providers: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>
}>

export interface CollaborationProviderRuntime extends ProviderDirectory {
  start(): Promise<void>
  stop(): Promise<void>
}

type ProviderRuntimePersistence = Pick<ProviderRuntimeStore,
  | 'claimEvent'
  | 'beginEvent'
  | 'completeEvent'
  | 'checkpointProcessedEvent'
  | 'releaseEvent'
  | 'readCursor'
  | 'resolveTarget'
  | 'resolveExactTarget'
  | 'readDelivery'
  | 'recordDelivery'
  | 'recordDiagnostic'
  | 'listPendingEndpointIds'
  | 'listPendingProviderIdentityIds'
>

type ProviderRuntimeService = Pick<CollaborationService,
  | 'verifyPairingFromProvider'
  | 'enqueueProviderCommandResult'
  | 'pullProviderIdentityInbox'
  | 'ackProviderIdentityInboxMessage'
  | 'acceptPersonalProviderMessage'
  | 'acceptProjectInput'
  | 'answerHumanNeeded'
  | 'applyProviderLocatorChange'
  | 'pullInbox'
  | 'ackInboxMessage'
  | 'recordRejectedBoundary'
>

type ProviderRuntimeRepository = Pick<CollaborationRepository, 'getEndpoint' | 'getInboxCursor'>
type ProviderRuntimeAuthentication = Pick<AuthenticationService, 'resolveProviderIdentity'>

export type ProviderRuntimeOptions = Readonly<{
  providers: readonly HumanEndpointProvider[]
  store: ProviderRuntimePersistence
  service: ProviderRuntimeService
  repository: ProviderRuntimeRepository
  authentication: ProviderRuntimeAuthentication
  pairingAssurance?: Readonly<Record<string, 'verified' | 'strong'>>
  now?: () => Date
  outboxPollMs?: number
}>

export class DefaultCollaborationProviderRuntime implements CollaborationProviderRuntime {
  private readonly providers: ReadonlyMap<string, HumanEndpointProvider>
  private readonly store: ProviderRuntimePersistence
  private readonly service: ProviderRuntimeService
  private readonly repository: ProviderRuntimeRepository
  private readonly authentication: ProviderRuntimeAuthentication
  private readonly pairingAssurance: Readonly<Record<string, 'verified' | 'strong'>>
  private readonly now: () => Date
  private readonly outboxPollMs: number
  private readonly pumpTasks = new Set<Promise<void>>()
  private abortController: AbortController | undefined

  constructor(options: ProviderRuntimeOptions) {
    const entries = options.providers.map((provider) => [provider.contract.provider, provider] as const)
    if (new Set(entries.map(([provider]) => provider)).size !== entries.length) {
      throw new CollaborationServiceError('identity_conflict', 'Installed provider identifiers must be unique.')
    }
    this.providers = new Map(entries)
    this.store = options.store
    this.service = options.service
    this.repository = options.repository
    this.authentication = options.authentication
    this.pairingAssurance = options.pairingAssurance ?? {}
    this.now = options.now ?? (() => new Date())
    this.outboxPollMs = Math.max(250, Math.min(options.outboxPollMs ?? DEFAULT_OUTBOX_POLL_MS, 60_000))
  }

  contracts(): readonly HumanEndpointProviderContract[] {
    return Object.freeze([...this.providers.values()].map((provider) => provider.contract))
  }

  async listLocators(input: {
    actor: AuthContext
    humanEndpointId: string
    query?: string
    cursor?: string
    limit: number
  }): Promise<{ locators: ProviderLocator[]; nextCursor?: string }> {
    if (input.actor.kind === 'system') throw new CollaborationServiceError('permission_denied', 'System context cannot discover human endpoint locators.')
    const endpoint = await this.repository.getEndpoint(input.humanEndpointId)
    if (!endpoint || endpoint.status !== 'active' || endpoint.userId !== input.actor.userId) {
      throw new CollaborationServiceError('permission_denied', 'Locator discovery requires an active endpoint owned by the authenticated user.')
    }
    const provider = this.providers.get(endpoint.provider)
    if (!provider) throw new CollaborationServiceError('resource_offline', 'The endpoint provider is not installed or configured.')
    const result = await provider.listLocators({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.locator.list',
      realmId: endpoint.realmId,
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit
    })
    return {
      locators: result.locators,
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor })
    }
  }

  async start(): Promise<void> {
    if (this.abortController) return
    const abortController = new AbortController()
    this.abortController = abortController
    for (const provider of this.providers.values()) {
      this.track(this.runEventPump(provider, abortController.signal))
    }
    this.track(this.runOutboxPump(abortController.signal))
  }

  async stop(): Promise<void> {
    const controller = this.abortController
    if (!controller) return
    this.abortController = undefined
    controller.abort()
    await Promise.allSettled([...this.providers.values()].map((provider) => provider.lifecycle({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.lifecycle.stop'
    })))
    await Promise.allSettled([...this.pumpTasks])
    this.pumpTasks.clear()
  }

  private track(task: Promise<void>): void {
    this.pumpTasks.add(task)
    void task.finally(() => this.pumpTasks.delete(task)).catch(() => undefined)
  }

  private async runEventPump(provider: HumanEndpointProvider, signal: AbortSignal): Promise<void> {
    let retryMs = 1_000
    while (!signal.aborted) {
      try {
        const afterCursor = await this.store.readCursor(provider.contract.provider)
        const request = {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          type: 'provider.lifecycle.start' as const,
          ...(afterCursor === undefined ? {} : { afterCursor })
        }
        for await (const event of provider.events(request)) {
          if (signal.aborted) break
          await this.handleEvent(event)
        }
        retryMs = 1_000
      } catch (error) {
        if (signal.aborted) break
        await this.recordRuntimeFailure(provider.contract.provider, error)
        await abortableDelay(retryMs, signal)
        retryMs = Math.min(retryMs * 2, 60_000)
      }
    }
  }

  private async handleEvent(event: ProviderEvent): Promise<void> {
    const realmId = eventRealmId(event)
    if (!realmId) return
    const claim = await this.store.beginEvent({
      provider: event.provider,
      realmId,
      eventId: event.eventId,
      eventCursor: event.eventCursor,
      dedupeKey: eventDedupeKey(event)
    })
    if (claim.status === 'processed') {
      await this.store.checkpointProcessedEvent({
        provider: event.provider,
        realmId,
        eventId: event.eventId,
        eventCursor: event.eventCursor
      })
      return
    }
    if (claim.status === 'in_progress') {
      throw new CollaborationServiceError('resource_offline', 'Provider event is already being handled by another runtime.', {
        retryable: true
      })
    }
    const claimEventId = claim.claimEventId
    try {
      if (event.type === 'provider.message.created') {
        await this.handleMessageCreated(event, claimEventId)
      } else if (event.type === 'provider.challenge.responded') {
        await this.handleChallengeResponded(event, claimEventId)
      } else if (event.type === 'provider.human_answer.responded') {
        await this.handleHumanAnswerResponded(event, claimEventId)
      } else if (event.type === 'provider.locator.changed') {
        await this.service.applyProviderLocatorChange({ previousLocator: event.previousLocator,
          currentLocator: event.currentLocator, providerEventId: claimEventId })
      }
      // Edits, deletes and reactions are intentionally append-only no-ops in v1.
      await this.store.completeEvent({
        provider: event.provider,
        realmId,
        eventId: claimEventId,
        eventCursor: event.eventCursor
      })
    } catch (error) {
      if (isRetryableProviderRuntimeError(error)) {
        await this.store.releaseEvent({ provider: event.provider, realmId, eventId: claimEventId })
        throw error
      }
      await this.store.completeEvent({
        provider: event.provider,
        realmId,
        eventId: claimEventId,
        eventCursor: event.eventCursor
      })
      if (error instanceof CollaborationServiceError) {
        await this.service.recordRejectedBoundary({ kind: 'system',
          actorKey: `provider:${event.provider}:${stableDigest(event.eventId)}` },
        `provider.${event.type}`, error).catch(() => undefined)
      }
      await this.recordRuntimeFailure(event.provider, error)
    }
  }

  private async handleMessageCreated(
    event: Extract<ProviderEvent, { type: 'provider.message.created' }>,
    claimEventId: string
  ): Promise<void> {
    if (event.isSelfEcho) return
    let actor: HumanEndpointActor
    try {
      actor = await this.authentication.resolveProviderIdentity(
        event.identity.provider,
        event.identity.realmId,
        event.identity.providerUserId
      )
    } catch (error) {
      if (!(error instanceof CollaborationServiceError) ||
          !['authentication_required', 'credential_revoked'].includes(error.code)) throw error
      throw error
    }
    const target = await this.store.resolveExactTarget(event.locator)
    if (!target) throw new CollaborationServiceError('not_found', 'The provider locator has no active collaboration target.')
    if (target.kind === 'personal_projection') {
      await this.service.acceptPersonalProviderMessage(actor, {
        locator: target.locator,
        providerMessageId: event.providerMessageId,
        text: event.text,
        occurredAt: event.occurredAt,
        providerEventId: claimEventId
      })
      return
    }
    await this.service.acceptProjectInput(actor, {
      locator: target.locator,
      providerMessageId: event.providerMessageId,
      text: event.text,
      occurredAt: event.occurredAt,
      providerEventId: claimEventId
    })
  }

  private async handleChallengeResponded(
    event: Extract<ProviderEvent, { type: 'provider.challenge.responded' }>,
    claimEventId: string
  ): Promise<void> {
    let result: 'success' | 'invalid_or_expired' | 'identity_conflict'
    try {
      await this.service.verifyPairingFromProvider({
        provider: event.identity.provider,
        realmId: event.identity.realmId,
        providerUserId: event.identity.providerUserId,
        ...(event.identity.displayName === undefined ? {} : { providerDisplayName: event.identity.displayName }),
        challengeId: event.challengeId,
        challengeCode: event.challengeResponse,
        providerEventId: claimEventId,
        assurance: this.pairingAssurance[event.provider] ?? 'verified'
      })
      result = 'success'
    } catch (error) {
      if (!(error instanceof CollaborationServiceError)) throw error
      if (['not_found', 'request_expired', 'validation_failed'].includes(error.code)) {
        result = 'invalid_or_expired'
      } else if (['identity_conflict', 'credential_revoked'].includes(error.code)) {
        result = 'identity_conflict'
      } else {
        throw error
      }
    }
    await this.service.enqueueProviderCommandResult({
      identity: event.identity,
      providerEventId: claimEventId,
      result
    })
  }

  private async handleHumanAnswerResponded(
    event: Extract<ProviderEvent, { type: 'provider.human_answer.responded' }>,
    claimEventId: string
  ): Promise<void> {
    const actor = await this.authentication.resolveProviderIdentity(
      event.identity.provider,
      event.identity.realmId,
      event.identity.providerUserId
    )
    await this.service.answerHumanNeeded(actor, {
      humanRequestId: event.humanRequestId,
      requestRevision: event.requestRevision,
      answer: event.answer,
      sourceLocator: event.locator,
      idempotencyKey: `idem_${stableDigest(claimEventId)}`
    })
  }

  private async runOutboxPump(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const endpointIds = await this.store.listPendingEndpointIds()
        for (const endpointId of endpointIds) {
          if (signal.aborted) break
          await this.flushEndpoint(endpointId)
        }
        const directRecipientIds = await this.store.listPendingProviderIdentityIds()
        for (const recipientId of directRecipientIds) {
          if (signal.aborted) break
          await this.flushProviderIdentity(recipientId)
        }
      } catch (error) {
        if (!signal.aborted) await this.recordRuntimeFailure('gateway', error)
      }
      await abortableDelay(this.outboxPollMs, signal)
    }
  }

  private async flushEndpoint(endpointId: string): Promise<void> {
    const endpoint = await this.repository.getEndpoint(endpointId)
    if (!endpoint || endpoint.status !== 'active' || endpoint.assurance === 'basic') return
    const provider = this.providers.get(endpoint.provider)
    if (!provider) return
    const actor = endpointActor(endpoint)
    const cursor = await this.repository.getInboxCursor({ kind: 'human_endpoint', id: endpoint.humanEndpointId })
    const page = await this.service.pullInbox(actor, { afterSequence: cursor?.ackedSequence ?? 0, limit: 100 })
    for (const message of page.messages) {
      const request = outboundRequest(message, provider.contract.limits.maxTextLength)
      if (!request) {
        await this.service.ackInboxMessage(actor, {
          inboxMessageId: message.messageId,
          sequence: message.sequence,
          idempotencyKey: `idem_provider_skip_${stableDigest(message.messageId)}`
        })
        continue
      }
      if (!('locator' in request) || request.locator.provider !== endpoint.provider || request.locator.realmId !== endpoint.realmId) {
        await this.recordRuntimeFailure(endpoint.provider,
          new CollaborationServiceError('permission_denied', 'Outbound locator does not match its verified endpoint realm.'))
        return
      }
      const prior = await this.store.readDelivery(endpoint.provider, request.clientMessageId)
      if (prior && !deliveryAttemptDue(prior, this.timestamp())) {
        if (prior.terminal) {
          await this.ackDeliveredMessage(actor, message)
          continue
        }
        return
      }
      const result = prior?.result.type === 'provider.send.succeeded'
        ? prior.result
        : providerSendResultSchema.parse(await provider.send(request))
      const persisted = await this.store.readDelivery(endpoint.provider, request.clientMessageId)
      if (!persisted || (prior && persisted.attemptCount === prior.attemptCount && result.type === 'provider.send.failed')) {
        await this.store.recordDelivery(endpoint.provider, request.clientMessageId, result)
      }
      if (result.type === 'provider.send.succeeded' || !result.retryable) {
        await this.ackDeliveredMessage(actor, message)
        continue
      }
      return
    }
  }

  private async flushProviderIdentity(recipientId: string): Promise<void> {
    const page = await this.service.pullProviderIdentityInbox({ recipientId, afterSequence: 0, limit: 100 })
    for (const message of page.messages.filter((candidate) => candidate.sequence > page.ackedSequence)) {
      const request = outboundRequest(message, Number.MAX_SAFE_INTEGER)
      if (!request || !('recipient' in request) || providerIdentityInboxId(request.recipient) !== recipientId) {
        await this.recordRuntimeFailure('gateway',
          new CollaborationServiceError('validation_failed', 'Direct provider outbox target is invalid.'))
        return
      }
      const provider = this.providers.get(request.recipient.provider)
      if (!provider || !provider.contract.capabilities.directMessages) return
      const prior = await this.store.readDelivery(request.recipient.provider, request.clientMessageId)
      if (prior && !deliveryAttemptDue(prior, this.timestamp())) {
        if (prior.terminal) {
          await this.service.ackProviderIdentityInboxMessage({
            recipientId,
            inboxMessageId: message.messageId,
            sequence: message.sequence
          })
          continue
        }
        return
      }
      const result = prior?.result.type === 'provider.send.succeeded'
        ? prior.result
        : providerSendResultSchema.parse(await provider.send(request))
      const persisted = await this.store.readDelivery(request.recipient.provider, request.clientMessageId)
      if (!persisted || (prior && persisted.attemptCount === prior.attemptCount && result.type === 'provider.send.failed')) {
        await this.store.recordDelivery(request.recipient.provider, request.clientMessageId, result)
      }
      if (result.type === 'provider.send.succeeded' || !result.retryable) {
        await this.service.ackProviderIdentityInboxMessage({
          recipientId,
          inboxMessageId: message.messageId,
          sequence: message.sequence
        })
        continue
      }
      return
    }
  }

  private ackDeliveredMessage(actor: HumanEndpointActor, message: StoredInboxMessage): Promise<unknown> {
    return this.service.ackInboxMessage(actor, {
      inboxMessageId: message.messageId,
      sequence: message.sequence,
      idempotencyKey: `idem_provider_ack_${stableDigest(message.messageId)}`
    })
  }

  private async recordRuntimeFailure(provider: string, error: unknown): Promise<void> {
    const classification = classifyProviderRuntimeError(error)
    const suffix = classification.errorClass ? `; ${classification.errorClass}` : ''
    await this.store.recordDiagnostic(providerDiagnosticSchema.parse({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.diagnostic',
      provider: safeProviderId(provider),
      status: 'degraded',
      checkedAt: this.timestamp(),
      safeSummary: `Provider runtime operation failed (${classification.errorCode}${suffix}).`,
      details: { errorCode: classification.errorCode,
        ...(classification.errorClass ? { errorClass: classification.errorClass } : {}) }
    }))
  }

  private timestamp(): string {
    const now = this.now()
    if (!Number.isFinite(now.valueOf())) throw new TypeError('Provider runtime clock returned an invalid timestamp.')
    return now.toISOString()
  }
}

export async function createInstalledProviderRuntime(input: Readonly<{
  pool: SqlPool
  repository: CollaborationRepository
  service: CollaborationService
  authentication: AuthenticationService
  configuration: ProviderConfiguration
  secretReader: HumanEndpointProviderSecretReader
  now?: () => Date
}>): Promise<CollaborationProviderRuntime> {
  const now = input.now ?? (() => new Date())
  const store = new ProviderRuntimeStore(input.pool, now)
  const assurances: Record<string, 'verified' | 'strong'> = {}
  const services = new Map<string, HumanEndpointProviderServices>()
  const providers = await createInstalledHumanEndpointProviders((definition) => {
    const configuration = input.configuration.providers[definition.provider]
    if (!configuration) {
      throw new CollaborationServiceError('resource_offline', `Installed provider ${definition.provider} has no non-sensitive configuration.`)
    }
    assurances[definition.provider] = pairingAssurance(configuration)
    let providerServices = services.get(definition.provider)
    if (!providerServices) {
      providerServices = createProviderServices({ definition, store, service: input.service, now })
      services.set(definition.provider, providerServices)
    }
    return {
      provider: definition.provider,
      configuration,
      secretReader: input.secretReader,
      services: providerServices,
      now: () => timestamp(now)
    }
  })
  return new DefaultCollaborationProviderRuntime({
    providers,
    store,
    service: input.service,
    repository: input.repository,
    authentication: input.authentication,
    pairingAssurance: assurances,
    now
  })
}

export async function loadProviderConfiguration(filePath: string): Promise<ProviderConfiguration> {
  const info = await stat(filePath)
  if (!info.isFile() || info.size > MAX_PROVIDER_CONFIG_BYTES) {
    throw new CollaborationServiceError('validation_failed', 'Provider configuration must be a bounded regular file.')
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    throw new CollaborationServiceError('validation_failed', 'Provider configuration is not valid JSON.')
  }
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== 'providers') || !isRecord(raw.providers)) {
    throw new CollaborationServiceError('validation_failed', 'Provider configuration must contain only a providers object.')
  }
  const providers: Record<string, Readonly<Record<string, string | number | boolean>>> = {}
  const installed = new Set(installedHumanEndpointProviderDefinitions.map((definition) => definition.provider))
  for (const [provider, value] of Object.entries(raw.providers)) {
    if (!installed.has(provider) || !isRecord(value)) {
      throw new CollaborationServiceError('validation_failed', 'Provider configuration contains an unknown provider or invalid value.')
    }
    const configuration: Record<string, string | number | boolean> = {}
    for (const [key, item] of Object.entries(value)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) ||
          (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')) {
        throw new CollaborationServiceError('validation_failed', 'Provider configuration keys and scalar values are invalid.')
      }
      if (looksLikeInlineSecret(key)) {
        throw new CollaborationServiceError('validation_failed', 'Provider credentials must be supplied by secret reference, never inline configuration.')
      }
      configuration[key] = item
    }
    providers[provider] = Object.freeze(configuration)
  }
  for (const definition of installedHumanEndpointProviderDefinitions) {
    if (!providers[definition.provider]) {
      throw new CollaborationServiceError('validation_failed', `Provider configuration is missing installed provider ${definition.provider}.`)
    }
  }
  return Object.freeze({ providers: Object.freeze(providers) })
}

export class FileProviderSecretReader implements HumanEndpointProviderSecretReader {
  private constructor(private readonly root: string) {}

  static async create(directory: string): Promise<FileProviderSecretReader> {
    const root = await realpath(directory)
    const info = await stat(root)
    if (!info.isDirectory()) throw new CollaborationServiceError('validation_failed', 'Provider secret path must be a directory.')
    return new FileProviderSecretReader(root)
  }

  async readSecret(secretReference: string): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(secretReference) || secretReference === '.' || secretReference === '..') {
      throw new CollaborationServiceError('validation_failed', 'Provider secret reference must be a safe file basename.')
    }
    const candidate = await realpath(resolve(this.root, secretReference))
    const pathFromRoot = relative(this.root, candidate)
    if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
      throw new CollaborationServiceError('permission_denied', 'Provider secret reference escapes the configured secret directory.')
    }
    const info = await stat(candidate)
    if (!info.isFile() || info.size === 0 || info.size > MAX_SECRET_BYTES) {
      throw new CollaborationServiceError('validation_failed', 'Provider secret must be a bounded non-empty regular file.')
    }
    if ((info.mode & 0o007) !== 0) {
      throw new CollaborationServiceError('permission_denied', 'Provider secret file must not be accessible to other users.')
    }
    const value = (await readFile(candidate, 'utf8')).trim()
    if (!value) throw new CollaborationServiceError('validation_failed', 'Provider secret file is empty.')
    return value
  }
}

function createProviderServices(input: Readonly<{
  definition: InstalledHumanEndpointProviderDefinition
  store: ProviderRuntimeStore
  service: CollaborationService
  now: () => Date
}>): HumanEndpointProviderServices {
  const { definition, store } = input
  return {
    resolveLocator: async (coordinates) => {
      const target = await store.resolveTarget(coordinates)
      if (target) return target.locator
      return undefined
    },
    claimEvent: (claim) => store.claimEvent(claim),
    readDelivery: async (clientMessageId) => (await store.readDelivery(definition.provider, clientMessageId))?.result,
    reconcileDelivery: async (request) => {
      const current = await store.readDelivery(definition.provider, request.clientMessageId)
      return current?.result.type === 'provider.send.succeeded' ? current.result : undefined
    },
    recordDelivery: (clientMessageId, result) => store.recordDelivery(definition.provider, clientMessageId, result),
    verifyChallenge: (request) => verifyChallenge(input.service, request, definition.provider),
    http: providerHttp,
    reportDiagnostic: (diagnostic) => {
      void store.recordDiagnostic(diagnostic).catch(() => undefined)
    }
  }
}

async function verifyChallenge(
  service: CollaborationService,
  request: ProviderVerifyIdentityRequest,
  provider: string
): Promise<ProviderVerifyIdentityResult> {
  try {
    const result = await service.verifyPairingFromProvider({
      provider,
      realmId: request.expectedIdentity.realmId,
      providerUserId: request.expectedIdentity.providerUserId,
      ...(request.expectedIdentity.displayName === undefined ? {} : { providerDisplayName: request.expectedIdentity.displayName }),
      challengeId: request.challengeId,
      challengeCode: request.challengeResponse,
      providerEventId: `identity-verification:${request.challengeId}`,
      assurance: 'verified'
    })
    if (result.challengeId !== request.challengeId) {
      return { protocolVersion: CURRENT_PROTOCOL_VERSION, type: 'provider.identity.rejected', reason: 'invalid' }
    }
    return {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.identity.verified',
      identity: request.expectedIdentity,
      assurance: 'verified',
      verifiedAt: timestamp(() => new Date())
    }
  } catch (error) {
    const reason = error instanceof CollaborationServiceError && error.code === 'request_expired'
      ? 'expired'
      : error instanceof CollaborationServiceError && error.code === 'identity_conflict'
        ? 'identity_mismatch'
        : 'invalid'
    return { protocolVersion: CURRENT_PROTOCOL_VERSION, type: 'provider.identity.rejected', reason }
  }
}

async function providerHttp(request: HumanEndpointProviderHttpRequest): Promise<HumanEndpointProviderHttpResponse> {
  const url = new URL(request.url)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CollaborationServiceError('validation_failed', 'Provider HTTP transport requires an HTTP(S) URL.')
  }
  const timeoutMs = Math.max(250, Math.min(request.timeoutMs, 120_000))
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error'
  })
  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > MAX_HTTP_RESPONSE_BYTES) {
    throw new CollaborationServiceError('payload_too_large', 'Provider response exceeded the transport limit.')
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: body.toString('utf8')
  }
}

function outboundRequest(message: StoredInboxMessage, maxTextLength: number): ProviderSendRequest | undefined {
  const payload = message.payload
  if (message.messageType === 'provider.command.result.outbound' &&
      payload.type === 'provider.command.result.outbound' && typeof payload.text === 'string') {
    const recipient = providerDirectRecipientSchema.safeParse(payload.recipient)
    if (!recipient.success) return undefined
    return {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      type: 'provider.send.message',
      recipient: recipient.data,
      clientMessageId: message.messageId,
      text: payload.text
    }
  }
  if (message.messageType !== 'projection.message.outbound' &&
      message.messageType !== 'provider.notification.outbound') return undefined
  if ((payload.type !== 'projection.message.outbound' && payload.type !== 'provider.notification.outbound') ||
      typeof payload.text !== 'string') return undefined
  const locator = providerLocatorSchema.safeParse(payload.locator)
  if (!locator.success) return undefined
  let text = payload.text
  if (message.messageType === 'provider.notification.outbound' &&
      payload.notificationKind === 'human_needed' && text.length > maxTextLength) {
    const commandMarker = '\n\n回复命令：sciforge-answer '
    const commandOffset = text.lastIndexOf(commandMarker)
    if (commandOffset < 0 || text.length - commandOffset > maxTextLength) {
      throw new CollaborationServiceError('validation_failed',
        'The provider text limit cannot carry the complete HumanNeeded reply command.')
    }
    const command = text.slice(commandOffset)
    text = `${text.slice(0, Math.max(0, maxTextLength - command.length))}${command}`
  }
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    type: 'provider.send.message',
    locator: locator.data,
    clientMessageId: message.messageId,
    text
  }
}

function eventRealmId(event: ProviderEvent): string | undefined {
  switch (event.type) {
    case 'provider.message.created':
    case 'provider.message.edited':
    case 'provider.message.deleted':
    case 'provider.message.reaction':
    case 'provider.challenge.responded':
    case 'provider.human_answer.responded': return event.identity.realmId
    case 'provider.locator.changed': return event.currentLocator.realmId
    case 'provider.lifecycle.changed': return undefined
  }
}

function eventDedupeKey(event: ProviderEvent): string {
  switch (event.type) {
    case 'provider.message.created':
    case 'provider.message.edited':
    case 'provider.message.deleted':
    case 'provider.message.reaction':
    case 'provider.human_answer.responded': return event.providerMessageId
    case 'provider.locator.changed':
    case 'provider.challenge.responded':
    case 'provider.lifecycle.changed': return event.eventId
  }
}

function isRetryableProviderRuntimeError(error: unknown): boolean {
  if (!(error instanceof CollaborationServiceError)) return true
  return error.retryable || error.code === 'resource_offline' || error.code === 'internal_error'
}

function endpointActor(endpoint: StoredEndpoint): HumanEndpointActor {
  if (endpoint.assurance === 'basic') {
    throw new CollaborationServiceError('assurance_insufficient', 'Provider outbox requires a verified endpoint.')
  }
  return {
    kind: 'human_endpoint',
    actorKey: `endpoint:${endpoint.humanEndpointId}:revision:${endpoint.revision}`,
    userId: endpoint.userId,
    humanEndpointId: endpoint.humanEndpointId,
    assurance: endpoint.assurance
  }
}

function deliveryAttemptDue(delivery: ProviderDeliveryState, now: string): boolean {
  if (delivery.terminal) return false
  return delivery.nextAttemptAt === undefined || delivery.nextAttemptAt <= now
}

function pairingAssurance(configuration: Readonly<Record<string, string | number | boolean>>): 'verified' | 'strong' {
  const value = configuration.pairingAssurance
  if (value === undefined || value === 'verified') return 'verified'
  if (value === 'strong') return 'strong'
  throw new CollaborationServiceError('validation_failed', 'Provider pairingAssurance must be verified or strong.')
}

function looksLikeInlineSecret(key: string): boolean {
  if (/reference$/iu.test(key)) return false
  return /(secret|token|password|passphrase|privatekey|apikey|credential)$/iu.test(key)
}

function safeProviderId(value: string): string {
  return /^[a-z][a-z0-9.-]{0,63}$/u.test(value) ? value : 'gateway'
}

const SAFE_PROVIDER_ERROR_CODES = new Set([
  'aborted',
  'authentication_failed',
  'delivery_uncertain',
  'invalid_locator',
  'invalid_payload',
  'locator_ambiguous',
  'locator_missing',
  'locator_revision_mismatch',
  'not_found',
  'payload_too_large',
  'permission_denied',
  'provider_unavailable',
  'queue_expired',
  'rate_limited',
  'retry_exhausted'
])

const SAFE_ERROR_CLASSES = new Set([
  'AbortError',
  'AggregateError',
  'CollaborationServiceError',
  'Error',
  'ProviderError',
  'RangeError',
  'SyntaxError',
  'TypeError'
])

function classifyProviderRuntimeError(error: unknown): { errorCode: string; errorClass?: string } {
  if (error instanceof CollaborationServiceError) {
    return { errorCode: error.code, errorClass: 'CollaborationServiceError' }
  }
  const code = ownDataString(error, 'code')
  const errorCode = code && /^[a-z][a-z0-9_]{0,63}$/u.test(code) && SAFE_PROVIDER_ERROR_CODES.has(code)
    ? code
    : 'provider_unavailable'
  const name = ownDataString(error, 'name')
  if (!name || !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name)) return { errorCode }
  const errorClass = SAFE_ERROR_CLASSES.has(name)
    ? name
    : /^[A-Za-z][A-Za-z0-9]{0,47}ProviderError$/u.test(name)
      ? 'ProviderError'
      : undefined
  return { errorCode, ...(errorClass ? { errorClass } : {}) }
}

function ownDataString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined
  } catch {
    return undefined
  }
}

function timestamp(now: () => Date): string {
  const value = now()
  if (!Number.isFinite(value.valueOf())) throw new TypeError('Provider runtime clock returned an invalid timestamp.')
  return value.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolveDelay) => {
    const timeout = setTimeout(done, milliseconds)
    function done(): void {
      clearTimeout(timeout)
      signal.removeEventListener('abort', done)
      resolveDelay()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
