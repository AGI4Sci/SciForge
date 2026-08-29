import { randomUUID } from 'node:crypto'

import {
  CURRENT_PROTOCOL_VERSION,
  providerDirectoryPrincipalFactSchema,
  type ProviderDirectoryPrincipalFact,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

import {
  OpenContentConnectorError,
  type OpenContentConnectionStatus,
  type OpenContentExternalBindingAttestation
} from '../contract.js'

type ConnectedPrincipalObservation = Readonly<{
  externalIdentityId: number
  bindingAttestation: OpenContentExternalBindingAttestation
  observedAt: string
}>

export type OpenContentProviderPrincipalPublisher = Readonly<{
  synchronize(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    status: OpenContentConnectionStatus
    connected?: ConnectedPrincipalObservation
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<void>
}>

export function createOpenContentProviderPrincipalPublisher(
  acquireTransport: () => AuthenticatedCloudTransport
): OpenContentProviderPrincipalPublisher {
  return Object.freeze({
    synchronize: async (input) => {
      input.assertPrincipalCurrent()
      if (input.principal.assurance === 'local-selection') return
      if (input.principal.assurance !== 'cloud-authenticated') {
        throw retryablePublicationFailure(
          'OpenContent Provider principal publication requires a Cloud-authenticated Principal.'
        )
      }
      let transport: AuthenticatedCloudTransport
      try {
        transport = acquireTransport()
      } catch (error) {
        throw retryablePublicationFailure(
          'The authenticated SciForge Cloud transport is unavailable.',
          error
        )
      }
      let authority: ReturnType<AuthenticatedCloudTransport['status']>
      try {
        authority = transport.status()
      } catch (error) {
        throw retryablePublicationFailure(
          'The authenticated SciForge Cloud authority is unavailable.',
          error
        )
      }
      if (authority.state !== 'ready') {
        throw retryablePublicationFailure(
          `The authenticated SciForge Cloud transport is not ready (${authority.state}).`
        )
      }
      if (
        input.principal.subject !== authority.userId ||
        input.principal.deviceId !== authority.deviceId
      ) {
        throw retryablePublicationFailure(
          'The OpenContent Principal does not match the authenticated SciForge Cloud authority.'
        )
      }

      if (
        'providerInstanceRef' in input.status &&
        input.status.providerInstanceRef !== input.providerInstanceRef
      ) {
        throw publicationContractFailure(
          'OpenContent connection status belongs to a different Provider Instance.'
        )
      }
      const current = await readCurrentFact(
        transport,
        authority.userId,
        input.providerInstanceRef,
        input.signal
      )
      input.assertPrincipalCurrent()
      if (input.status.state === 'connected') {
        if (
          input.connected === undefined ||
          input.connected.bindingAttestation.providerInstanceRef !== input.providerInstanceRef ||
          !samePrincipalSnapshot(
            input.connected.bindingAttestation.principal,
            input.principal
          )
        ) {
          throw publicationContractFailure(
            'Connected OpenContent status requires its exact Provider principal observation.'
          )
        }
        const providerPrincipal = {
          schemaVersion: 1 as const,
          type: 'provider_directory_principal_reference' as const,
          providerInstance: {
            schemaVersion: 1 as const,
            type: 'provider_instance_reference' as const,
            providerInstanceRef: input.providerInstanceRef
          },
          principalKind: 'user' as const,
          principalId: String(input.connected.externalIdentityId)
        }
        if (
          current?.readiness === 'ready' &&
          current.publishedByDeviceId !== authority.deviceId &&
          sameProviderPrincipal(current.providerPrincipal, providerPrincipal)
        ) return
        if (
          current?.providerPrincipal.principalId === providerPrincipal.principalId &&
          current.providerPrincipal.providerInstance.providerInstanceRef === input.providerInstanceRef &&
          current.principalIdentityRevision ===
            input.connected.bindingAttestation.principal.identityVersion &&
          current.providerBindingAttestationDigest ===
            input.connected.bindingAttestation.bindingRevision &&
          current.publishedByDeviceId === authority.deviceId &&
          current.readiness === 'ready'
        ) return

        await publishFact(transport, {
          current,
          userId: authority.userId,
          deviceId: authority.deviceId,
          deviceRevision: authority.deviceRevision,
          providerPrincipal,
          principalIdentityRevision:
            input.connected.bindingAttestation.principal.identityVersion,
          providerBindingAttestationDigest: input.connected.bindingAttestation.bindingRevision,
          readiness: 'ready',
          readinessReason: null,
          observedAt: input.connected.observedAt,
          signal: input.signal
        })
        input.assertPrincipalCurrent()
        return
      }

      if (input.connected !== undefined) {
        throw publicationContractFailure(
          'A disconnected OpenContent status cannot include a Provider principal observation.'
        )
      }

      if (!current) return
      if (current.publishedByDeviceId !== authority.deviceId) return
      const readinessReason = 'provider_unauthorized' as const
      if (
        current.principalIdentityRevision === input.principal.identityVersion &&
        current.publishedByDeviceId === authority.deviceId &&
        current.readiness === 'degraded' &&
        current.readinessReason === readinessReason
      ) return
      await publishFact(transport, {
        current,
        userId: authority.userId,
        deviceId: authority.deviceId,
        deviceRevision: authority.deviceRevision,
        providerPrincipal: current.providerPrincipal,
        principalIdentityRevision: input.principal.identityVersion,
        providerBindingAttestationDigest: current.providerBindingAttestationDigest,
        readiness: 'degraded',
        readinessReason,
        observedAt: new Date().toISOString(),
        signal: input.signal
      })
      input.assertPrincipalCurrent()
    }
  })
}

async function readCurrentFact(
  transport: AuthenticatedCloudTransport,
  userId: string,
  providerInstanceRef: string,
  signal?: AbortSignal
): Promise<ProviderDirectoryPrincipalFact | undefined> {
  const response = await execute(transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: requestId(),
    type: 'provider_directory_principal.list',
    userIds: [userId],
    providerInstance: {
      schemaVersion: 1,
      type: 'provider_instance_reference',
      providerInstanceRef
    },
    includeDegraded: true,
    limit: 1
  }, signal)
  if (response.type !== 'rest.provider_directory_principal_page') {
    throw publicationContractFailure(`Provider principal lookup returned ${response.type}.`)
  }
  if (response.nextFactId !== undefined || response.items.length > 1) {
    throw publicationContractFailure(
      'Provider principal lookup returned more than one fact for an exact User and Provider slot.'
    )
  }
  const current = response.items[0]
  if (
    current !== undefined &&
    (
      current.userId !== userId ||
      current.providerPrincipal.providerInstance.providerInstanceRef !== providerInstanceRef
    )
  ) {
    throw publicationContractFailure(
      'Provider principal lookup returned a fact outside the requested User and Provider slot.'
    )
  }
  return current
}

async function publishFact(
  transport: AuthenticatedCloudTransport,
  input: Readonly<{
    current: ProviderDirectoryPrincipalFact | undefined
    userId: string
    deviceId: string
    deviceRevision: number
    providerPrincipal: ProviderDirectoryPrincipalFact['providerPrincipal']
    principalIdentityRevision: number
    providerBindingAttestationDigest: string
    readiness: ProviderDirectoryPrincipalFact['readiness']
    readinessReason: ProviderDirectoryPrincipalFact['readinessReason']
    observedAt: string
    signal?: AbortSignal
  }>
): Promise<void> {
  const response = await execute(transport, {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    requestId: requestId(),
    type: 'provider_directory_principal.publish',
    idempotencyKey: providerPrincipalIdempotencyKey(input),
    providerPrincipalFactId: input.current?.providerPrincipalFactId ?? null,
    expectedFactRevision: input.current?.revision ?? null,
    deviceId: input.deviceId,
    expectedDeviceRevision: input.deviceRevision,
    providerPrincipal: input.providerPrincipal,
    principalIdentityRevision: input.principalIdentityRevision,
    providerBindingAttestationDigest: input.providerBindingAttestationDigest,
    readiness: input.readiness,
    readinessReason: input.readinessReason,
    observedAt: input.observedAt
  }, input.signal)
  if (response.type !== 'rest.entity') {
    throw publicationContractFailure(`Provider principal publication returned ${response.type}.`)
  }
  const parsed = providerDirectoryPrincipalFactSchema.safeParse(response.entity)
  if (!parsed.success) {
    throw publicationContractFailure('Provider principal publication returned an invalid fact.')
  }
  const fact = parsed.data
  if (
    fact.userId !== input.userId ||
    (input.current !== undefined &&
      fact.providerPrincipalFactId !== input.current.providerPrincipalFactId) ||
    !sameProviderPrincipal(fact.providerPrincipal, input.providerPrincipal) ||
    fact.principalIdentityRevision !== input.principalIdentityRevision ||
    fact.providerBindingAttestationDigest !== input.providerBindingAttestationDigest ||
    fact.publishedByDeviceId !== input.deviceId ||
    fact.readiness !== input.readiness ||
    fact.readinessReason !== input.readinessReason ||
    fact.observedAt !== input.observedAt ||
    fact.revision !== (input.current?.revision ?? 0) + 1
  ) {
    throw publicationContractFailure(
      'Provider principal publication returned a fact that does not match the exact write.'
    )
  }
}

function providerPrincipalIdempotencyKey(input: Readonly<{
  current: ProviderDirectoryPrincipalFact | undefined
  providerBindingAttestationDigest: string
  readiness: ProviderDirectoryPrincipalFact['readiness']
}>): string {
  return `idem_opencontent-principal.${input.providerBindingAttestationDigest}.${
    input.current?.revision ?? 0
  }.${input.readiness}`
}

async function execute(
  transport: AuthenticatedCloudTransport,
  payload: Parameters<AuthenticatedCloudTransport['execute']>[0]['payload'],
  signal?: AbortSignal
): Promise<RestResponse> {
  let response: Awaited<ReturnType<AuthenticatedCloudTransport['execute']>>
  try {
    response = await transport.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload
    }, { signal })
  } catch (error) {
    if (error instanceof OpenContentConnectorError) throw error
    throw retryablePublicationFailure('SciForge Cloud could not complete the request.', error)
  }
  if (response.body.requestId !== payload.requestId) {
    throw publicationContractFailure('SciForge Cloud returned a mismatched request receipt.')
  }
  if (response.status < 200 || response.status >= 300 || response.body.type === 'rest.error') {
    const detail = response.body.type === 'rest.error'
      ? `${response.body.error.code}: ${response.body.error.message}`
      : `HTTP ${response.status}`
    throw retryablePublicationFailure(`SciForge Cloud request failed: ${detail}`)
  }
  return response.body
}

function sameProviderPrincipal(
  left: ProviderDirectoryPrincipalFact['providerPrincipal'],
  right: ProviderDirectoryPrincipalFact['providerPrincipal']
): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.type === right.type &&
    left.principalKind === right.principalKind &&
    left.principalId === right.principalId &&
    left.providerInstance.schemaVersion === right.providerInstance.schemaVersion &&
    left.providerInstance.type === right.providerInstance.type &&
    left.providerInstance.providerInstanceRef === right.providerInstance.providerInstanceRef
}

function retryablePublicationFailure(message: string, cause?: unknown): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'provider_unavailable',
    message,
    cause === undefined ? undefined : { cause }
  )
}

function publicationContractFailure(message: string): OpenContentConnectorError {
  return new OpenContentConnectorError('provider_contract_violation', message)
}

function requestId(): `req_${string}` {
  return `req_${randomUUID().replaceAll('-', '')}`
}
