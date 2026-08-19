import { describe, expect, it, vi } from 'vitest'
import { DomainMainProviderCredentialError } from '@sciforge/domain-sdk/package-storage'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError,
  openContentConnectionStatusSchema,
  openContentUnbindOutputSchema
} from '../contract.js'
import {
  OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE,
  createOpenContentCapabilityFactory,
  type OpenContentCapabilityOptions
} from './index.js'
import type { OpenContentConnectionService } from './connection-service.js'

const principal = Object.freeze({
  authority: 'sciforge.local-account',
  subject: 'local-user-1',
  assurance: 'local-selection' as const,
  deviceId: 'device-1',
  identityVersion: 4
})

describe('OpenContent connection capabilities', () => {
  it('ships one stable compile-time verification profile', () => {
    expect(OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE).toEqual({
      id: 'edoc2-test1-verification',
      providerInstanceRef: 'opencontent-edoc2-demo',
      displayName: 'OpenContent',
      origin: 'https://test1.edoc2.com'
    })
    expect(Object.isFrozen(OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE)).toBe(true)
  })

  it('keeps enrollment UI-only and marks credential input as sensitive', () => {
    const definitions = capabilityDefinitions(connectionService())
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)
    const status = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)

    expect(bind).toMatchObject({
      audiences: ['ui'],
      effect: 'external-write',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect(bind?.tags).toContain('sensitive-input')
    expect(status).toMatchObject({
      audiences: ['ui'],
      effect: 'read',
      concurrency: { revision: 'none', idempotency: 'none' }
    })
  })

  it('returns status through a typed success envelope', async () => {
    const definitions = capabilityDefinitions(connectionService())
    const status = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)!

    await expect(status.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, {
      caller: { audience: 'ui', principal },
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      output: {
        outcome: 'success',
        status: { state: 'disconnected' }
      }
    })
  })

  it('returns a successful account binding through the same typed envelope', async () => {
    const definitions = capabilityDefinitions(connectionService())
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!

    await expect(bind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'scientist',
      password: 'fixture-password'
    }, {
      caller: { audience: 'ui', principal },
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({
      output: {
        outcome: 'success',
        status: { state: 'connected' }
      }
    })
  })

  it('returns unbind through a typed success envelope', async () => {
    const definitions = capabilityDefinitions(connectionService())
    const unbind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind)!

    await expect(unbind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, {
      caller: { audience: 'ui', principal },
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      output: {
        outcome: 'success',
        state: 'disconnected',
        remoteRevocation: 'unsupported'
      }
    })
  })

  it('returns an unknown Provider Instance as a bounded result before touching connections', async () => {
    const connections = connectionService()
    const definitions = capabilityDefinitions(connections)
    const status = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)!

    await expect(status.handler({
      providerInstanceRef: 'opencontent-unknown'
    }, {
      caller: { audience: 'ui', principal },
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      output: {
        outcome: 'error',
        error: {
          code: 'invalid_provider_instance',
          action: 'select_provider'
        }
      }
    })
    expect(connections.status).not.toHaveBeenCalled()
  })

  it.each([
    [new OpenContentConnectorError('unauthorized', 'raw account rejection'), 'invalid_credentials', 'check_credentials'],
    [new OpenContentConnectorError('reauthentication_required', 'raw invalid post-login session'), 'invalid_credentials', 'check_credentials'],
    [new OpenContentConnectorError('provider_unavailable', 'raw endpoint failure'), 'provider_unavailable', 'retry'],
    [new OpenContentConnectorError('rate_limited', 'raw throttle detail'), 'rate_limited', 'retry_later'],
    [new OpenContentConnectorError('provider_contract_violation', 'raw response body'), 'provider_contract_violation', 'contact_support'],
    [new OpenContentConnectorError('cancelled', 'raw cancellation detail'), 'cancelled', 'none'],
    [new DomainMainProviderCredentialError('secure_storage_unavailable', 'raw keychain detail'), 'secure_storage_unavailable', 'repair_secure_storage']
  ] as const)('maps an expected bind failure to bounded code %s', async (failure, code, action) => {
    const connections = connectionService()
    vi.mocked(connections.bindExistingAccount).mockRejectedValueOnce(failure)
    const definitions = capabilityDefinitions(connections)
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!

    const result = await bind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'scientist',
      password: 'secret-password-canary'
    }, {
      caller: { audience: 'ui', principal },
      assertPrincipalCurrent: () => undefined
    })

    expect(result).toEqual({
      output: { outcome: 'error', error: { code, action } }
    })
    expect(JSON.stringify(result)).not.toMatch(/secret-password-canary|raw |test1\.edoc2\.com/u)
  })

  it('always binds the current Host Principal and never accepts one in input', async () => {
    const connections = connectionService()
    const definitions = capabilityDefinitions(connections)
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!
    const assertPrincipalCurrent = vi.fn()

    await bind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'scientist',
      password: 'fixture-password'
    }, {
      caller: { audience: 'ui', principal },
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })

    expect(connections.bindExistingAccount).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      username: 'scientist',
      password: 'fixture-password',
      assertPrincipalCurrent
    }))
  })

  it('rejects a Token canary from every renderer-visible capability output', () => {
    const canary = 'opaque-capability-canary-2a81'
    expect(openContentConnectionStatusSchema.safeParse({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      externalAccount: {
        id: 'external-user-1',
        identityId: 1,
        account: 'scientist',
        name: 'Scientist'
      },
      token: canary
    }).success).toBe(false)
    expect(openContentUnbindOutputSchema.safeParse({
      outcome: 'success',
      state: 'disconnected',
      remoteRevocation: 'unsupported',
      token: canary
    }).success).toBe(false)
  })
})

function capabilityDefinitions(connections: OpenContentConnectionService) {
  return createOpenContentCapabilityFactory<OpenContentCapabilityOptions>({
    defineCapability: (options) => options,
    connections
  }).createDefinitions()
}

function connectionService(): OpenContentConnectionService {
  return {
    status: vi.fn(async () => ({ state: 'disconnected' as const })),
    bindExistingAccount: vi.fn(async () => ({
      state: 'connected' as const,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      externalAccount: {
        id: 'external-user-1',
        identityId: 1,
        account: 'scientist',
        name: 'Scientist'
      }
    })),
    useCurrentToken: vi.fn(),
    unbind: vi.fn(async () => ({
      state: 'disconnected' as const,
      remoteRevocation: 'unsupported' as const
    }))
  }
}
