import { describe, expect, it, vi } from 'vitest'
import { DomainMainProviderCredentialError } from '@sciforge/domain-sdk/package-storage'

import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OpenContentConnectorError,
  openContentExternalBindingAttestationSchema,
  openContentConnectionStatusSchema,
  openContentUnbindOutputSchema
} from '../contract.js'
import {
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION
} from '../definition.js'
import {
  OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE,
  createOpenContentCapabilityFactory,
  type OpenContentCapabilityOptions
} from './index.js'
import * as openContentMainModule from './index.js'
import { createOpenContentContentSpaceFacade } from './facade.js'
import type { OpenContentConnectionService } from './connection-service.js'
import type { OpenContentClient } from './opencontent-client.js'
import type {
  OpenContentBoundTeamAdministration
} from '../team-administration-contract.js'
import type { OpenContentTeamAdministration } from './team-administration.js'

const principal = Object.freeze({
  authority: 'sciforge.local-account',
  subject: 'local-user-1',
  assurance: 'local-selection' as const,
  deviceId: 'device-1',
  identityVersion: 4
})
const bindingAttestation = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})

describe('OpenContent connection capabilities', () => {
  it('does not expose raw facade construction from the public main entrypoint', () => {
    expect(openContentMainModule).not.toHaveProperty('createOpenContentContentSpaceFacade')
  })

  it('keeps the v3 internal facade version aligned with its manifest contract', () => {
    expect(OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION).toBe('3.0.0')
    expect(OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT).toMatchObject({
      serviceId: 'opencontent.content-space',
      contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION
    })
    expect(OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION.version)
      .toBe(OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION)
  })

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
    expect(openContentExternalBindingAttestationSchema.safeParse({
      ...bindingAttestation,
      token: canary
    }).success).toBe(false)
  })
})

describe('OpenContent main-only Content Space facade', () => {
  it('keeps SDK and Team operations available when private attachment assets are absent', () => {
    const facade = createOpenContentContentSpaceFacade({
      client: {} as OpenContentClient,
      connections: connectionService(),
      teamAdministration: teamAdministration()
    })

    expect(facade.useSkillRuntime).toBeUndefined()
    expect(facade.attestExternalBinding).toBeTypeOf('function')
    expect(facade.useTeamAdministration).toBeTypeOf('function')
    expect(facade.listRootFolders).toBeTypeOf('function')
    expect(facade.uploadNewFile).toBeTypeOf('function')
  })

  it('binds Team administration to one verified session without exposing its Token', async () => {
    const tokenCanary = 'opaque-team-administration-token-0001'
    const rawAdministration = teamAdministration()
    const connections = connectionService()
    vi.mocked(connections.useCurrentSession).mockImplementation(async (_input, operation) => (
      operation(Object.freeze({
        token: tokenCanary,
        externalIdentityId: 9000041,
        bindingAttestation
      }))
    ))
    const facade = createOpenContentContentSpaceFacade({
      client: {} as OpenContentClient,
      connections,
      teamAdministration: rawAdministration,
      skillRuntime: {
        useSkillRuntime: async (_input, operation) => operation({
          invoke: async () => {
            throw new Error('The skill runtime is not used by this test.')
          }
        })
      }
    })

    let retainedAdministration: OpenContentBoundTeamAdministration | undefined
    const result = await facade.useTeamAdministration({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: bindingAttestation,
      signal: new AbortController().signal,
      assertPrincipalCurrent: () => undefined
    }, async (session) => {
      retainedAdministration = session.administration
      expect(session.externalIdentityId).toBe(9000041)
      expect(session).not.toHaveProperty('token')
      expect(session.administration).not.toHaveProperty('token')
      await session.administration.listTeams({ pageNumber: 1, pageSize: 100 })
      return 'completed' as const
    })

    expect(result).toBe('completed')
    expect(connections.useCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({ expectedBindingAttestation: bindingAttestation }),
      expect.any(Function)
    )
    expect(rawAdministration.listTeams).toHaveBeenCalledWith({
      pageNumber: 1,
      pageSize: 100,
      token: tokenCanary
    })
    await expect(retainedAdministration!.listTeams({ pageNumber: 1, pageSize: 100 }))
      .rejects.toMatchObject({ code: 'unauthorized' })
    expect(rawAdministration.listTeams).toHaveBeenCalledOnce()
  })

  it('exposes only the token-free external binding attestation from the current session', async () => {
    const connections = connectionService()
    const facade = createOpenContentContentSpaceFacade({
      client: {} as OpenContentClient,
      connections,
      teamAdministration: teamAdministration()
    })

    await expect(facade.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual(bindingAttestation)
    expect(connections.attestExternalBinding).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }))
    expect(JSON.stringify(bindingAttestation)).not.toMatch(/token|connectionId|identityId/u)
  })

  it('passes the live Principal assertion into ordinary invocation-scoped client requests', async () => {
    const connections = connectionService()
    vi.mocked(connections.useCurrentToken).mockImplementation(async (_input, operation) => (
      operation('opaque-content-space-token')
    ))
    const listFolderEntries = vi.fn<OpenContentClient['listFolderEntries']>(async (input) => {
      await input.assertPrincipalCurrent()
      return { parentFolderGuid: input.parentFolderGuid, entries: [] }
    })
    const facade = createOpenContentContentSpaceFacade({
      client: { listFolderEntries } as unknown as OpenContentClient,
      connections,
      teamAdministration: teamAdministration()
    })
    const assertPrincipalCurrent = vi.fn(async () => { await Promise.resolve() })

    await expect(facade.listFolderEntries({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: bindingAttestation,
      parentFolderGuid: 'folder-guid',
      page: 1,
      pageSize: 20,
      assertPrincipalCurrent
    })).resolves.toEqual({ parentFolderGuid: 'folder-guid', entries: [] })

    expect(listFolderEntries).toHaveBeenCalledWith(expect.objectContaining({
      assertPrincipalCurrent
    }))
    expect(connections.useCurrentToken).toHaveBeenCalledWith(
      expect.objectContaining({ expectedBindingAttestation: bindingAttestation }),
      expect.any(Function)
    )
    expect(assertPrincipalCurrent).toHaveBeenCalledOnce()
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
    attestExternalBinding: vi.fn(async () => bindingAttestation),
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
    useCurrentSession: vi.fn(),
    unbind: vi.fn(async () => ({
      state: 'disconnected' as const,
      remoteRevocation: 'unsupported' as const
    }))
  }
}

function teamAdministration(): OpenContentTeamAdministration {
  return {
    listTeams: vi.fn(async () => ({
      pageNumber: 1,
      pageSize: 100,
      totalCount: 0,
      teams: []
    })),
    createTeam: vi.fn(async () => undefined),
    observeTeam: vi.fn(),
    editTeam: vi.fn(async () => undefined),
    stickTeam: vi.fn(async () => undefined),
    unstickTeam: vi.fn(async () => undefined),
    listTeamUsers: vi.fn(),
    addTeamUsers: vi.fn(async () => undefined),
    removeTeamUsers: vi.fn(async () => undefined),
    resolveTeamRoot: vi.fn(),
    setTeamUserRole: vi.fn(async () => undefined),
    transferTeamOwner: vi.fn(async () => undefined)
  }
}
