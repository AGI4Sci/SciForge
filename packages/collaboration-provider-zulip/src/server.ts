import {
  CURRENT_PROTOCOL_VERSION,
  providerDiagnosticSchema,
  type HumanEndpointProvider,
  type HumanEndpointProviderFactory,
  type HumanEndpointProviderFactoryContext,
  type ProviderSendRequest,
  type ProviderSendResult
} from '@sciforge/collaboration-contracts'
import {
  createZulipHumanEndpointProvider
} from './adapter.js'
import type {
  ZulipDeliveryLedger,
  ZulipDeliveryRecord,
  ZulipDeliveryReconciliation
} from './delivery.js'
import { ZulipProviderError } from './errors.js'
import type { ZulipProviderDiagnostic } from './http-client.js'
import { redactZulipDiagnostic } from './redaction.js'
import { createZulipCredentialResolver } from './secret-file.js'

class InMemoryDeliveryLedger implements ZulipDeliveryLedger {
  private readonly records = new Map<string, ZulipDeliveryRecord>()

  async get(idempotencyKey: string): Promise<ZulipDeliveryRecord | null> {
    return this.records.get(idempotencyKey) ?? null
  }

  async begin(record: ZulipDeliveryRecord): Promise<ZulipDeliveryRecord> {
    const current = this.records.get(record.idempotencyKey)
    if (current) return current
    this.records.set(record.idempotencyKey, record)
    return record
  }

  async update(record: ZulipDeliveryRecord): Promise<void> {
    this.records.set(record.idempotencyKey, record)
  }
}

function requiredConfiguration(context: HumanEndpointProviderFactoryContext, key: string): string {
  const value = context.configuration[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new ZulipProviderError('invalid_payload', `Missing Zulip provider configuration: ${key}.`)
  }
  return value.trim()
}

function optionalConfiguration(context: HumanEndpointProviderFactoryContext, key: string): string | undefined {
  const value = context.configuration[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new ZulipProviderError('invalid_payload', `Invalid Zulip provider configuration: ${key}.`)
  }
  return value.trim()
}

function factoryNow(context: HumanEndpointProviderFactoryContext): Date {
  const now = new Date(context.now())
  if (!Number.isFinite(now.valueOf())) throw new TypeError('Provider clock returned an invalid timestamp.')
  return now
}

function diagnosticFromLog(
  context: HumanEndpointProviderFactoryContext,
  diagnostic: ZulipProviderDiagnostic
): void {
  context.services.reportDiagnostic(providerDiagnosticSchema.parse({
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    type: 'provider.diagnostic',
    provider: 'zulip',
    status: diagnostic.level === 'error' ? 'degraded' : 'healthy',
    checkedAt: factoryNow(context).toISOString(),
    safeSummary: diagnostic.message.slice(0, 500),
    ...(diagnostic.detail === undefined
      ? {}
      : { details: redactZulipDiagnostic(diagnostic.detail) })
  }))
}

function wrapWithDurableProviderServices(
  context: HumanEndpointProviderFactoryContext,
  provider: HumanEndpointProvider,
  beforeSend: (request: ProviderSendRequest) => void
): HumanEndpointProvider {
  return {
    contract: provider.contract,
    verifyIdentity: (request) => provider.verifyIdentity(request),
    events: (request) => provider.events(request),
    send: async (request): Promise<ProviderSendResult> => {
      const existing = await context.services.readDelivery(request.clientMessageId)
      if (existing?.type === 'provider.send.succeeded') return existing
      if (
        existing?.type === 'provider.send.failed' &&
        existing.providerErrorCode === 'delivery_uncertain'
      ) {
        const reconciled = await context.services.reconcileDelivery(request)
        if (reconciled?.type === 'provider.send.succeeded') {
          await context.services.recordDelivery(request.clientMessageId, reconciled)
          return reconciled
        }
        if (!reconciled || reconciled.retryable) return existing
      }
      beforeSend(request)
      const result = await provider.send(request)
      await context.services.recordDelivery(request.clientMessageId, result)
      return result
    },
    listLocators: (request) => provider.listLocators(request),
    updateLocator: (request) => provider.updateLocator(request),
    manageContainer: (request) => provider.manageContainer!(request),
    lifecycle: (request) => provider.lifecycle(request),
    diagnose: () => provider.diagnose()
  }
}

export const createHumanEndpointProvider: HumanEndpointProviderFactory = async (context) => {
  if (context.provider !== 'zulip') {
    throw new ZulipProviderError('invalid_payload', 'Zulip factory received a different provider identifier.')
  }
  const realmUrl = requiredConfiguration(context, 'realmUrl')
  const botEmail = requiredConfiguration(context, 'botEmail')
  const credentialSecretReference = requiredConfiguration(context, 'credentialSecretReference')
  const provisioningEmail = optionalConfiguration(context, 'provisioningEmail')
  const provisioningCredentialSecretReference = optionalConfiguration(
    context,
    'provisioningCredentialSecretReference'
  )
  if (Boolean(provisioningEmail) !== Boolean(provisioningCredentialSecretReference)) {
    throw new ZulipProviderError(
      'invalid_payload',
      'Zulip provisioningEmail and provisioningCredentialSecretReference must be configured together.'
    )
  }
  const deliveryRequests = new Map<string, ProviderSendRequest>()
  const deliveryLedger = new InMemoryDeliveryLedger()
  const resolveCredential = await createZulipCredentialResolver(
    context.secretFileDirectory,
    credentialSecretReference
  )
  const resolveProvisioningCredential = provisioningCredentialSecretReference
    ? await createZulipCredentialResolver(
        context.secretFileDirectory,
        provisioningCredentialSecretReference
      )
    : undefined

  const reconcileDelivery = async (record: ZulipDeliveryRecord): Promise<ZulipDeliveryReconciliation> => {
    const existing = await context.services.readDelivery(record.idempotencyKey)
    if (existing?.type === 'provider.send.succeeded') {
      return { status: 'sent', remoteMessageId: existing.providerMessageId }
    }
    const request = deliveryRequests.get(record.idempotencyKey)
    if (!request) return { status: 'unknown' }
    const result = await context.services.reconcileDelivery(request)
    if (!result) return { status: 'unknown' }
    if (result.type === 'provider.send.succeeded') {
      return { status: 'sent', remoteMessageId: result.providerMessageId }
    }
    return { status: result.retryable ? 'unknown' : 'not_sent' }
  }

  const core = createZulipHumanEndpointProvider({
    realmUrl,
    botEmail,
    ...(provisioningEmail ? { provisioningEmail } : {})
  }, {
    resolveCredential,
    ...(resolveProvisioningCredential
      ? { resolveProvisioningCredential }
      : {}),
    deliveryLedger,
    reconcileDelivery,
    resolveLocator: async (coordinates) => {
      const locator = await context.services.resolveLocator(coordinates)
      if (!locator) {
        throw new ZulipProviderError('locator_missing', 'No saved binding matches the Zulip location.')
      }
      return locator
    },
    verifyIdentity: (request) => context.services.verifyChallenge(request),
    logger: (diagnostic) => diagnosticFromLog(context, diagnostic),
    now: () => factoryNow(context)
  })

  return wrapWithDurableProviderServices(
    context,
    core,
    (request) => { deliveryRequests.set(request.clientMessageId, request) }
  )
}
