import { describe, expect, it, vi } from 'vitest'

import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  defineAuthenticatedCloudTransport,
  type AuthenticatedCloudRequest,
  type AuthenticatedCloudResponse,
  type AuthenticatedCloudTransport,
  type AuthenticatedCloudTransportStatus
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { ProviderDirectoryPrincipalFact } from '@sciforge/collaboration-contracts'

import { createOpenContentProviderPrincipalPublisher } from './provider-principal-publisher.js'

const PROVIDER_INSTANCE_REF = 'opencontent-provider-alpha'
const USER_ID = 'usr_OpenContentUser01'
const DEVICE_ID = 'dev_OpenContentDevice01'
const DEVICE_REVISION = 7
const SECOND_DEVICE_ID = 'dev_OpenContentDevice02'
const SECOND_DEVICE_REVISION = 11
const OBSERVED_AT = '2026-08-29T01:00:00.000Z'
const BINDING_REVISION = 'b'.repeat(64)
const SECOND_BINDING_REVISION = 'c'.repeat(64)
const FACT_ID = 'ppf_OpenContentFact01'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: USER_ID,
  assurance: 'cloud-authenticated' as const,
  deviceId: DEVICE_ID,
  identityVersion: 4
})

const secondDevicePrincipal = Object.freeze({
  ...principal,
  deviceId: SECOND_DEVICE_ID
})

describe('OpenContent Provider principal publisher', () => {
  it('publishes with the exact current Device revision and a deterministic idempotency key', async () => {
    const execute = vi.fn<AuthenticatedCloudTransport['execute']>(async (request) => (
      cloudResponse(request)
    ))
    const transport = defineAuthenticatedCloudTransport({
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.example.test',
        userId: USER_ID,
        deviceId: DEVICE_ID,
        deviceRevision: DEVICE_REVISION
      }),
      execute
    })
    const publisher = createOpenContentProviderPrincipalPublisher(() => transport)
    const signal = new AbortController().signal

    await publisher.synchronize({
      principal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: {
        state: 'connected',
        providerInstanceRef: PROVIDER_INSTANCE_REF
      },
      connected: {
        externalIdentityId: 9000041,
        bindingAttestation: {
          providerInstanceRef: PROVIDER_INSTANCE_REF,
          principal,
          externalSubject: 'a'.repeat(64),
          bindingRevision: BINDING_REVISION
        },
        observedAt: OBSERVED_AT
      },
      signal,
      assertPrincipalCurrent: vi.fn()
    })

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: {
        type: 'provider_directory_principal.publish',
        idempotencyKey: `idem_opencontent-principal.${BINDING_REVISION}.0.ready`,
        providerPrincipalFactId: null,
        expectedFactRevision: null,
        deviceId: DEVICE_ID,
        expectedDeviceRevision: DEVICE_REVISION,
        principalIdentityRevision: principal.identityVersion,
        providerBindingAttestationDigest: BINDING_REVISION,
        readiness: 'ready',
        readinessReason: null,
        observedAt: OBSERVED_AT
      }
    })
    expect(execute.mock.calls[1]?.[1]).toEqual({ signal })
  })

  it('fails closed before Cloud access when a ready authority omits deviceRevision', async () => {
    const execute = vi.fn<AuthenticatedCloudTransport['execute']>()
    const transport = defineAuthenticatedCloudTransport({
      status: () => ({
        state: 'ready',
        baseUrl: 'https://cloud.example.test',
        userId: USER_ID,
        deviceId: DEVICE_ID
      } as unknown as AuthenticatedCloudTransportStatus),
      execute
    })
    const publisher = createOpenContentProviderPrincipalPublisher(() => transport)

    await expect(publisher.synchronize({
      principal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: { state: 'disconnected' },
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['disconnected', { state: 'disconnected' }],
    ['provider authorization is no longer valid', {
      state: 'reauthentication_required',
      providerInstanceRef: PROVIDER_INSTANCE_REF
    }]
  ] as const)(
    'CAS-degrades an existing ready fact when OpenContent is %s',
    async (_label, status) => {
      const existing = readyFact()
      const cloud = statefulCloud(existing)
      const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)

      await publisher.synchronize({
        principal,
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        status,
        assertPrincipalCurrent: vi.fn()
      })

      expect(cloud.execute).toHaveBeenCalledTimes(2)
      expect(cloud.execute.mock.calls[0]?.[0]).toMatchObject({
        payload: {
          type: 'provider_directory_principal.list',
          userIds: [USER_ID],
          providerInstance: {
            providerInstanceRef: PROVIDER_INSTANCE_REF
          },
          includeDegraded: true,
          limit: 1
        }
      })
      expect(cloud.execute.mock.calls[1]?.[0]).toMatchObject({
        payload: {
          type: 'provider_directory_principal.publish',
          idempotencyKey: `idem_opencontent-principal.${BINDING_REVISION}.3.degraded`,
          providerPrincipalFactId: FACT_ID,
          expectedFactRevision: 3,
          deviceId: DEVICE_ID,
          expectedDeviceRevision: DEVICE_REVISION,
          providerPrincipal: existing.providerPrincipal,
          principalIdentityRevision: principal.identityVersion,
          providerBindingAttestationDigest: BINDING_REVISION,
          readiness: 'degraded',
          readinessReason: 'provider_unauthorized'
        }
      })
      expect(cloud.current()).toMatchObject({
        providerPrincipalFactId: FACT_ID,
        userId: USER_ID,
        providerPrincipal: existing.providerPrincipal,
        publishedByDeviceId: DEVICE_ID,
        readiness: 'degraded',
        readinessReason: 'provider_unauthorized',
        revision: 4
      })
    }
  )

  it('does not degrade a ready fact published by another Device', async () => {
    const cloud = statefulCloud(readyFact({ publishedByDeviceId: SECOND_DEVICE_ID }))
    const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)

    await publisher.synchronize({
      principal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: { state: 'disconnected' },
      assertPrincipalCurrent: vi.fn()
    })

    expect(cloud.execute).toHaveBeenCalledOnce()
    expect(cloud.execute.mock.calls[0]?.[0].payload.type).toBe(
      'provider_directory_principal.list'
    )
    expect(cloud.current()).toMatchObject({
      publishedByDeviceId: SECOND_DEVICE_ID,
      readiness: 'ready',
      readinessReason: null,
      revision: 3
    })
  })

  it('does not replace another Device ready fact for the same external principal', async () => {
    const existing = readyFact()
    const cloud = statefulCloud(existing, {
      authority: {
        deviceId: SECOND_DEVICE_ID,
        deviceRevision: SECOND_DEVICE_REVISION
      }
    })
    const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)

    await publisher.synchronize({
      principal: secondDevicePrincipal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: {
        state: 'connected',
        providerInstanceRef: PROVIDER_INSTANCE_REF
      },
      connected: {
        externalIdentityId: 9000041,
        bindingAttestation: {
          providerInstanceRef: PROVIDER_INSTANCE_REF,
          principal: secondDevicePrincipal,
          externalSubject: 'a'.repeat(64),
          bindingRevision: SECOND_BINDING_REVISION
        },
        observedAt: '2026-08-29T01:01:00.000Z'
      },
      assertPrincipalCurrent: vi.fn()
    })

    expect(cloud.execute).toHaveBeenCalledOnce()
    expect(cloud.execute.mock.calls[0]?.[0].payload.type).toBe(
      'provider_directory_principal.list'
    )
    expect(cloud.current()).toEqual(existing)
  })

  it('CAS-replaces another Device ready fact when the external principal changes', async () => {
    const cloud = statefulCloud(readyFact(), {
      authority: {
        deviceId: SECOND_DEVICE_ID,
        deviceRevision: SECOND_DEVICE_REVISION
      }
    })
    const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)

    await publisher.synchronize({
      principal: secondDevicePrincipal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: {
        state: 'connected',
        providerInstanceRef: PROVIDER_INSTANCE_REF
      },
      connected: {
        externalIdentityId: 9000042,
        bindingAttestation: {
          providerInstanceRef: PROVIDER_INSTANCE_REF,
          principal: secondDevicePrincipal,
          externalSubject: 'd'.repeat(64),
          bindingRevision: SECOND_BINDING_REVISION
        },
        observedAt: '2026-08-29T01:02:00.000Z'
      },
      assertPrincipalCurrent: vi.fn()
    })

    expect(cloud.execute).toHaveBeenCalledTimes(2)
    expect(cloud.execute.mock.calls[1]?.[0]).toMatchObject({
      payload: {
        type: 'provider_directory_principal.publish',
        providerPrincipalFactId: FACT_ID,
        expectedFactRevision: 3,
        deviceId: SECOND_DEVICE_ID,
        expectedDeviceRevision: SECOND_DEVICE_REVISION,
        providerPrincipal: {
          principalId: '9000042'
        },
        providerBindingAttestationDigest: SECOND_BINDING_REVISION,
        readiness: 'ready',
        readinessReason: null
      }
    })
    expect(cloud.current()).toMatchObject({
      providerPrincipal: { principalId: '9000042' },
      providerBindingAttestationDigest: SECOND_BINDING_REVISION,
      publishedByDeviceId: SECOND_DEVICE_ID,
      readiness: 'ready',
      readinessReason: null,
      revision: 4
    })
  })

  it.each([
    ['User', readyFact({ userId: 'usr_OpenContentUser02' })],
    ['Provider', readyFact({
      providerInstanceRef: 'opencontent-provider-beta',
      factId: 'ppf_OpenContentFact02'
    })]
  ] as const)('rejects a ready fact from the wrong %s slot without writing it', async (
    _slot,
    returnedFact
  ) => {
    const cloud = statefulCloud(readyFact(), { listItems: [returnedFact] })
    const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)

    await expect(publisher.synchronize({
      principal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: { state: 'disconnected' },
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })

    expect(cloud.execute).toHaveBeenCalledOnce()
    expect(cloud.execute.mock.calls[0]?.[0].payload.type).toBe(
      'provider_directory_principal.list'
    )
  })

  it('rejects a stale-ready publication receipt after issuing the exact degraded write', async () => {
    const cloud = statefulCloud(readyFact(), {
      responseFact: (stored) => ({
        ...stored,
        readiness: 'ready',
        readinessReason: null
      })
    })
    const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)

    await expect(publisher.synchronize({
      principal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: { state: 'disconnected' },
      assertPrincipalCurrent: vi.fn()
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })

    expect(cloud.execute.mock.calls[1]?.[0]).toMatchObject({
      payload: {
        type: 'provider_directory_principal.publish',
        providerPrincipalFactId: FACT_ID,
        expectedFactRevision: 3,
        expectedDeviceRevision: DEVICE_REVISION,
        readiness: 'degraded',
        readinessReason: 'provider_unauthorized'
      }
    })
    expect(cloud.current()).toMatchObject({
      readiness: 'degraded',
      readinessReason: 'provider_unauthorized',
      revision: 4
    })
  })

  it('fails closed on current-Principal drift after the degraded write without retaining ready state', async () => {
    const cloud = statefulCloud(readyFact())
    const publisher = createOpenContentProviderPrincipalPublisher(() => cloud.transport)
    const principalChanged = new Error('current Principal changed')
    let assertionCount = 0

    await expect(publisher.synchronize({
      principal,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      status: { state: 'disconnected' },
      assertPrincipalCurrent: vi.fn(() => {
        assertionCount += 1
        if (assertionCount === 3) throw principalChanged
      })
    })).rejects.toBe(principalChanged)

    expect(cloud.execute).toHaveBeenCalledTimes(2)
    expect(cloud.current()).toMatchObject({
      readiness: 'degraded',
      readinessReason: 'provider_unauthorized',
      revision: 4
    })
  })
})

function readyFact(input: Readonly<{
  userId?: string
  providerInstanceRef?: string
  factId?: string
  publishedByDeviceId?: string
}> = {}): ProviderDirectoryPrincipalFact {
  const providerInstanceRef = input.providerInstanceRef ?? PROVIDER_INSTANCE_REF
  return {
    schemaVersion: 1,
    type: 'provider_directory_principal_fact',
    providerPrincipalFactId: input.factId ?? FACT_ID,
    userId: input.userId ?? USER_ID,
    providerPrincipal: {
      schemaVersion: 1,
      type: 'provider_directory_principal_reference',
      providerInstance: {
        schemaVersion: 1,
        type: 'provider_instance_reference',
        providerInstanceRef
      },
      principalKind: 'user',
      principalId: '9000041'
    },
    principalIdentityRevision: principal.identityVersion,
    providerBindingAttestationDigest: BINDING_REVISION,
    publishedByDeviceId: input.publishedByDeviceId ?? DEVICE_ID,
    readiness: 'ready',
    readinessReason: null,
    observedAt: OBSERVED_AT,
    revision: 3,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT
  }
}

function statefulCloud(
  initial: ProviderDirectoryPrincipalFact,
  options: Readonly<{
    listItems?: readonly ProviderDirectoryPrincipalFact[]
    responseFact?(stored: ProviderDirectoryPrincipalFact): ProviderDirectoryPrincipalFact
    authority?: Readonly<{
      deviceId: string
      deviceRevision: number
    }>
  }> = {}
): Readonly<{
  transport: AuthenticatedCloudTransport
  execute: ReturnType<typeof vi.fn<AuthenticatedCloudTransport['execute']>>
  current(): ProviderDirectoryPrincipalFact
}> {
  let current = initial
  const execute = vi.fn<AuthenticatedCloudTransport['execute']>(async (request) => {
    const payload = request.payload
    if (payload.type === 'provider_directory_principal.list') {
      return providerPrincipalPageResponse(request, options.listItems ?? [current])
    }
    if (payload.type === 'provider_directory_principal.publish') {
      current = {
        ...current,
        providerPrincipal: payload.providerPrincipal,
        principalIdentityRevision: payload.principalIdentityRevision,
        providerBindingAttestationDigest: payload.providerBindingAttestationDigest,
        publishedByDeviceId: payload.deviceId,
        readiness: payload.readiness,
        readinessReason: payload.readinessReason,
        observedAt: payload.observedAt,
        revision: current.revision + 1,
        updatedAt: payload.observedAt
      }
      return providerPrincipalEntityResponse(
        request,
        options.responseFact?.(current) ?? current
      )
    }
    throw new Error(`Unexpected Cloud request: ${payload.type}`)
  })
  const transport = defineAuthenticatedCloudTransport({
    status: () => ({
      state: 'ready',
      baseUrl: 'https://cloud.example.test',
      userId: USER_ID,
      deviceId: options.authority?.deviceId ?? DEVICE_ID,
      deviceRevision: options.authority?.deviceRevision ?? DEVICE_REVISION
    }),
    execute
  })
  return Object.freeze({ transport, execute, current: () => current })
}

function providerPrincipalPageResponse(
  request: AuthenticatedCloudRequest,
  items: readonly ProviderDirectoryPrincipalFact[]
): AuthenticatedCloudResponse {
  return {
    contractVersion: 1,
    status: 200,
    body: {
      protocolVersion: '1.0',
      type: 'rest.provider_directory_principal_page',
      requestId: request.payload.requestId,
      items: [...items]
    }
  }
}

function providerPrincipalEntityResponse(
  request: AuthenticatedCloudRequest,
  entity: ProviderDirectoryPrincipalFact
): AuthenticatedCloudResponse {
  return {
    contractVersion: 1,
    status: 200,
    body: {
      protocolVersion: '1.0',
      type: 'rest.entity',
      requestId: request.payload.requestId,
      entity
    }
  }
}

function cloudResponse(request: AuthenticatedCloudRequest): AuthenticatedCloudResponse {
  const payload = request.payload
  if (payload.type === 'provider_directory_principal.list') {
    return {
      contractVersion: 1,
      status: 200,
      body: {
        protocolVersion: '1.0',
        type: 'rest.provider_directory_principal_page',
        requestId: payload.requestId,
        items: []
      }
    }
  }
  if (payload.type === 'provider_directory_principal.publish') {
    return {
      contractVersion: 1,
      status: 200,
      body: {
        protocolVersion: '1.0',
        type: 'rest.entity',
        requestId: payload.requestId,
        entity: {
          schemaVersion: 1,
          type: 'provider_directory_principal_fact',
          providerPrincipalFactId: 'ppf_OpenContentFact01',
          userId: USER_ID,
          providerPrincipal: payload.providerPrincipal,
          principalIdentityRevision: payload.principalIdentityRevision,
          providerBindingAttestationDigest: payload.providerBindingAttestationDigest,
          publishedByDeviceId: payload.deviceId,
          readiness: payload.readiness,
          readinessReason: payload.readinessReason,
          observedAt: payload.observedAt,
          revision: 1,
          createdAt: OBSERVED_AT,
          updatedAt: OBSERVED_AT
        }
      }
    }
  }
  throw new Error(`Unexpected Cloud request: ${payload.type}`)
}
