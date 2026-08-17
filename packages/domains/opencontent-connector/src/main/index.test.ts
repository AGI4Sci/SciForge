import { describe, expect, it, vi } from 'vitest'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  openContentConnectionStatusSchema,
  openContentUnbindOutputSchema
} from '../contract.js'
import { createOpenContentCapabilityFactory, type OpenContentCapabilityOptions } from './index.js'
import type { OpenContentConnectionService } from './connection-service.js'

const principal = Object.freeze({
  authority: 'sciforge.local-account',
  subject: 'local-user-1',
  assurance: 'local-selection' as const,
  deviceId: 'device-1',
  identityVersion: 4
})

describe('OpenContent connection capabilities', () => {
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

  it('always binds the current Host Principal and never accepts one in input', async () => {
    const connections = connectionService()
    const definitions = capabilityDefinitions(connections)
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!
    const assertPrincipalCurrent = vi.fn()

    await bind.handler({ username: 'scientist', password: 'fixture-password' }, {
      caller: { audience: 'ui', principal },
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })

    expect(connections.bindExistingAccount).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      username: 'scientist',
      password: 'fixture-password',
      assertPrincipalCurrent
    }))
  })

  it('rejects a Token canary from every renderer-visible capability output', () => {
    const canary = 'opaque-capability-canary-2a81'
    expect(openContentConnectionStatusSchema.safeParse({
      state: 'connected',
      providerInstanceRef: 'opencontent-edoc2-demo',
      externalAccount: {
        id: 'external-user-1',
        identityId: 1,
        account: 'scientist',
        name: 'Scientist'
      },
      token: canary
    }).success).toBe(false)
    expect(openContentUnbindOutputSchema.safeParse({
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
      providerInstanceRef: 'opencontent-edoc2-demo',
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
