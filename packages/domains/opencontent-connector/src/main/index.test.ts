import { describe, expect, it, vi } from 'vitest'

import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OpenContentConnectorError,
  openContentBindInputSchema,
  openContentExternalBindingAttestationSchema,
  openContentConnectionStatusSchema,
  openContentUnbindOutputSchema
} from '../contract.js'
import {
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION
} from '../definition.js'
import type { OpenContentContentSpaceFacade } from '../main-contract.js'
import { createDomainMainEntry } from './index.js'
import * as openContentMainModule from './index.js'
import { createOpenContentCapabilityFactory } from './connection-capabilities.js'
import { createOpenContentContentSpaceFacade } from './facade.js'
import type { OpenContentConnectionService } from './connection-service.js'
import { OpenContentPrivateAccountError } from './private-account-runtime.js'
import {
  createOpenContentClient,
  type OpenContentClient
} from './opencontent-client.js'
import type {
  OpenContentBoundTeamAdministration
} from '../team-administration-contract.js'
import type { OpenContentSupplierRuntimeSession } from './skill-runtime.js'
import {
  createOpenContentTeamAdministration,
  type OpenContentTeamAdministration
} from './team-administration.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo' as const

const principal = Object.freeze({
  authority: 'sciforge.local-account',
  subject: 'local-user-1',
  assurance: 'local-selection' as const,
  deviceId: 'device-1',
  identityVersion: 4
})
const cloudPrincipal = Object.freeze({
  ...principal,
  authority: 'sciforge.identity-access',
  subject: 'cloud-user-1',
  assurance: 'cloud-authenticated' as const,
  deviceId: 'cloud-device-1'
})
const bindingAttestation = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})

describe('OpenContent connection capabilities', () => {
  it('keeps transport and supplier runtime construction outside the public main-entry contract', () => {
    type MainEntryArguments = Parameters<typeof createDomainMainEntry>
    const hasOnlyHostArgument:
      Extract<MainEntryArguments['length'], 2> extends never ? true : false = true

    expect(hasOnlyHostArgument).toBe(true)
  })

  it('publishes only the canonical package activation function from the public main entrypoint', () => {
    expect(Object.keys(openContentMainModule)).toEqual(['createDomainMainEntry'])
  })

  it('keeps the v4 internal facade version aligned with its manifest contract', () => {
    expect(OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION).toBe('4.0.0')
    expect(OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT).toMatchObject({
      serviceId: 'opencontent.content-space',
      contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION
    })
    expect(OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION.version)
      .toBe(OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION)
  })

  it('keeps one schema-validated sensitive enrollment capability UI-only', () => {
    const definitions = capabilityDefinitions(connectionService())
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)
    const status = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)
    const unbind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind)

    expect(bind).toMatchObject({
      version: '2.0.0',
      audiences: ['ui'],
      effect: 'external-write',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect(bind?.tags).toContain('sensitive-input')
    expect(bind?.tags).not.toContain('native-enrollment')
    expect(openContentBindInputSchema.safeParse(bindInput()).success).toBe(true)
    expect(openContentBindInputSchema.safeParse({
      ...bindInput(),
      token: 'must-not-cross'
    }).success).toBe(false)
    expect(status).toMatchObject({
      version: '2.0.0',
      audiences: ['ui'],
      effect: 'read',
      concurrency: { revision: 'none', idempotency: 'none' }
    })
    expect(unbind).toMatchObject({
      version: '2.0.0',
      audiences: ['ui'],
      effect: 'external-write',
      concurrency: { revision: 'none', idempotency: 'required' }
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
      ...bindInput()
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
    const connections = connectionService()
    const definitions = capabilityDefinitions(connections)
    const unbind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind)!
    const controller = new AbortController()

    await expect(unbind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, {
      caller: { audience: 'ui', principal },
      signal: controller.signal,
      assertPrincipalCurrent: () => undefined
    })).resolves.toEqual({
      output: {
        outcome: 'success',
        state: 'disconnected',
        remoteRevocation: 'unsupported'
      }
    })
    expect(connections.unbind).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal
    }))
  })

  it('admits the current Cloud Principal for UI bind, status, and unbind', async () => {
    const connections = connectionService()
    const definitions = capabilityDefinitions(connections)
    const context = {
      caller: { audience: 'ui' as const, principal: cloudPrincipal },
      assertPrincipalCurrent: vi.fn()
    }
    const status = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)!
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!
    const unbind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind)!

    await status.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, context)
    await bind.handler({
      ...bindInput()
    }, context)
    await unbind.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, context)

    expect(connections.status).toHaveBeenCalledWith(expect.objectContaining({
      principal: cloudPrincipal
    }))
    expect(connections.enroll).toHaveBeenCalledWith(expect.objectContaining({
      principal: cloudPrincipal
    }))
    expect(connections.unbind).toHaveBeenCalledWith(expect.objectContaining({
      principal: cloudPrincipal
    }))
    expect(context.assertPrincipalCurrent).toHaveBeenCalledTimes(3)
  })

  it.each(['agent', 'system'] as const)(
    'rejects %s callers from every connection-management capability',
    async (audience) => {
      const connections = connectionService()
      const definitions = capabilityDefinitions(connections)
      const context = {
        caller: { audience, principal: cloudPrincipal },
        assertPrincipalCurrent: vi.fn()
      }

      for (const definition of definitions) {
        const input = definition.id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind
          ? bindInput()
          : { providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF }
        await expect(definition.handler(input, context)).rejects.toThrow(
          'A current UI Principal is required'
        )
      }

      expect(connections.status).not.toHaveBeenCalled()
      expect(connections.enroll).not.toHaveBeenCalled()
      expect(connections.unbind).not.toHaveBeenCalled()
      expect(context.assertPrincipalCurrent).not.toHaveBeenCalled()
    }
  )

  it('rejects connection management when the UI has no current Principal', async () => {
    const connections = connectionService()
    const definitions = capabilityDefinitions(connections)
    const status = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.status)!
    const assertPrincipalCurrent = vi.fn()

    await expect(status.handler({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    }, {
      caller: { audience: 'ui' },
      assertPrincipalCurrent
    })).rejects.toThrow('A current UI Principal is required')
    expect(connections.status).not.toHaveBeenCalled()
    expect(assertPrincipalCurrent).not.toHaveBeenCalled()
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
    [new OpenContentConnectorError('conflict', 'raw concurrent enrollment detail'), 'enrollment_in_progress', 'retry'],
    [new OpenContentConnectorError('cancelled', 'raw cancellation detail'), 'cancelled', 'none'],
    [new OpenContentPrivateAccountError('cancelled', 'raw Principal detail'), 'cancelled', 'none'],
    [new OpenContentPrivateAccountError('secure_storage_unavailable', 'raw secure storage detail'), 'secure_storage_unavailable', 'repair_secure_storage']
  ] as const)('maps an expected bind failure to bounded code %s', async (failure, code, action) => {
    const connections = connectionService()
    vi.mocked(connections.enroll).mockRejectedValueOnce(failure)
    const definitions = capabilityDefinitions(connections)
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!

    const result = await bind.handler({
      ...bindInput()
    }, {
      caller: { audience: 'ui', principal },
      assertPrincipalCurrent: () => undefined
    })

    expect(result).toEqual({
      output: { outcome: 'error', error: { code, action } }
    })
    expect(JSON.stringify(result)).not.toMatch(/raw |test1\.edoc2\.com/u)
  })

  it('always binds the current Host Principal and never accepts one in input', async () => {
    const connections = connectionService()
    vi.mocked(connections.enroll).mockImplementationOnce(async (input) => {
      expect(input.credentials).toEqual({
        account: 'fixture-opencontent-account',
        password: 'fixture-opencontent-password'
      })
      return {
        state: 'connected' as const,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
      }
    })
    const definitions = capabilityDefinitions(connections)
    const bind = definitions.find(({ id }) => id === OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind)!
    const assertPrincipalCurrent = vi.fn()

    await bind.handler({
      ...bindInput()
    }, {
      caller: { audience: 'ui', principal },
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })

    expect(connections.enroll).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent
    }))
  })

  it('rejects Provider profile fields, credential fields, and Token canaries from renderer-visible output', () => {
    const canary = 'opaque-capability-canary-2a81'
    expect(openContentConnectionStatusSchema.safeParse({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      externalAccount: {
        name: 'provider-controlled-value'
      }
    }).success).toBe(false)
    expect(openContentConnectionStatusSchema.safeParse({
      state: 'connected',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
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
  it('binds runtime access to the installed Provider Instance without a demo-ID fallback', async () => {
    const providerInstanceRef = 'opencontent-installed-instance'
    const connections = connectionService()
    vi.mocked(connections.attestExternalBinding).mockResolvedValue(Object.freeze({
      ...bindingAttestation,
      providerInstanceRef
    }))
    const facade = createOpenContentContentSpaceFacade({
      providerInstanceRef,
      connections,
      getRuntime: facadeRuntime({} as OpenContentClient, teamAdministration())
    })

    await expect(facade.attestExternalBinding({
      principal,
      providerInstanceRef,
      assertPrincipalCurrent: () => undefined
    })).resolves.toMatchObject({ providerInstanceRef })
    await expect(facade.attestExternalBinding({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      assertPrincipalCurrent: () => undefined
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(connections.attestExternalBinding).toHaveBeenCalledOnce()
  })

  it('keeps SDK and Team operations available when private attachment assets are absent', () => {
    const facade = createOpenContentContentSpaceFacade({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections: connectionService(),
      getRuntime: facadeRuntime({} as OpenContentClient, teamAdministration())
    })

    expect(facade.useSupplierTransport).toBeUndefined()
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
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections,
      getRuntime: facadeRuntime({} as OpenContentClient, rawAdministration, {
        useSupplierTransport: async (_input, operation) => operation({
          invoke: async () => {
            throw new Error('The skill runtime is not used by this test.')
          }
        })
      })
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
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections,
      getRuntime: facadeRuntime({} as OpenContentClient, teamAdministration())
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
    vi.mocked(connections.useCurrentSession).mockImplementation(async (_input, operation) => (
      operation(Object.freeze({
        token: 'opaque-content-space-token',
        externalIdentityId: 9000041,
        bindingAttestation
      }))
    ))
    const listFolderEntries = vi.fn<OpenContentClient['listFolderEntries']>(async (input) => {
      await input.assertPrincipalCurrent()
      return { parentFolderGuid: input.parentFolderGuid, entries: [] }
    })
    const facade = createOpenContentContentSpaceFacade({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections,
      getRuntime: facadeRuntime(
        { listFolderEntries } as unknown as OpenContentClient,
        teamAdministration()
      )
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
    expect(connections.useCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({ expectedBindingAttestation: bindingAttestation }),
      expect.any(Function)
    )
    expect(assertPrincipalCurrent).toHaveBeenCalledOnce()
  })

  it('returns an opaque one-use download lease and consumes it in a fresh current session', async () => {
    const connections = connectionService()
    let sessionNumber = 0
    vi.mocked(connections.useCurrentSession).mockImplementation(async (_input, operation) => (
      operation(Object.freeze({
        token: `opaque-current-token-${++sessionNumber}`,
        externalIdentityId: 9000041,
        bindingAttestation
      }))
    ))
    const authorizeDownload = vi.fn<OpenContentClient['authorizeDownload']>(async ({ fileGuid }) => ({
      fileGuid,
      regionType: 1,
      regionHash: 'opaque-region-hash',
      regionUrl: ''
    }))
    const bytes = Uint8Array.of(1, 2, 3)
    const downloadAuthorizedFile = vi.fn<OpenContentClient['downloadAuthorizedFile']>(async ({
      token,
      authorization,
      write
    }) => {
      expect(token).toBe('opaque-current-token-2')
      expect(authorization.fileGuid).toBe('file-guid')
      await write(bytes)
      return { bytesWritten: bytes.byteLength }
    })
    const facade = createOpenContentContentSpaceFacade({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections,
      getRuntime: facadeRuntime(
        { authorizeDownload, downloadAuthorizedFile } as unknown as OpenContentClient,
        teamAdministration()
      )
    })
    const writes: Uint8Array[] = []
    const lease = await facade.authorizeDownload({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: bindingAttestation,
      fileGuid: 'file-guid',
      signal: new AbortController().signal,
      assertPrincipalCurrent: () => undefined
    })

    expect(Object.keys(lease).sort()).toEqual(['consume', 'retire'])
    expect(JSON.stringify(lease)).not.toMatch(/token|region|file-guid/u)
    expect(authorizeDownload).toHaveBeenCalledWith(expect.objectContaining({
      token: 'opaque-current-token-1',
      fileGuid: 'file-guid'
    }))
    expect(downloadAuthorizedFile).not.toHaveBeenCalled()

    await expect(lease.consume({
      write: async (chunk) => { writes.push(Uint8Array.from(chunk)) }
    })).resolves.toEqual({ bytesWritten: bytes.byteLength })
    await expect(lease.consume({ write: async () => undefined }))
      .rejects.toMatchObject({ code: 'unauthorized' })
    await lease.retire()

    expect(Buffer.concat(writes)).toEqual(Buffer.from(bytes))
    expect(downloadAuthorizedFile).toHaveBeenCalledOnce()
    expect(connections.useCurrentSession).toHaveBeenCalledTimes(2)
    for (const [sessionInput] of vi.mocked(connections.useCurrentSession).mock.calls) {
      expect(sessionInput).toMatchObject({
        expectedBindingAttestation: bindingAttestation
      })
    }
  })

  it.each(['regionHash', 'regionUrl', 'providerExtension'] as const)(
    'rejects a download authorization whose %s retains the Session Token',
    async (echoField) => {
      const sessionToken = 'opaque-download-session-token-value'
      const connections = connectionService()
      vi.mocked(connections.useCurrentSession).mockImplementation(async (_input, operation) => (
        operation(Object.freeze({
          token: sessionToken,
          externalIdentityId: 9000041,
          bindingAttestation
        }))
      ))
      const authorizeDownload = vi.fn<OpenContentClient['authorizeDownload']>(async ({ fileGuid }) => {
        const authorization: Record<string, unknown> = {
          fileGuid,
          regionType: 1,
          regionHash: 'opaque-region-hash',
          regionUrl: ''
        }
        if (echoField === 'regionHash') {
          authorization.regionHash = `opaque-${sessionToken}-hash`
        } else if (echoField === 'regionUrl') {
          authorization.regionUrl = `https://download.invalid/${sessionToken}`
        } else {
          authorization.providerExtension = {
            opaqueLeaseState: `retained-${sessionToken}`
          }
        }
        return authorization as Awaited<ReturnType<OpenContentClient['authorizeDownload']>>
      })
      const downloadAuthorizedFile = vi.fn<OpenContentClient['downloadAuthorizedFile']>()
      const facade = createOpenContentContentSpaceFacade({
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        connections,
        getRuntime: facadeRuntime(
          { authorizeDownload, downloadAuthorizedFile } as unknown as OpenContentClient,
          teamAdministration()
        )
      })

      const failure = await facade.authorizeDownload({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        expectedBindingAttestation: bindingAttestation,
        fileGuid: 'file-guid',
        signal: new AbortController().signal,
        assertPrincipalCurrent: () => undefined
      }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(OpenContentConnectorError)
      expect(failure).toMatchObject({ code: 'provider_contract_violation' })
      expect(String(failure)).not.toContain(sessionToken)
      expect(JSON.stringify(failure)).not.toContain(sessionToken)
      expect(downloadAuthorizedFile).not.toHaveBeenCalled()
    }
  )

  it('keeps every token-free hierarchy proof observation in one exact current binding session', async () => {
    const connections = connectionService()
    vi.mocked(connections.useCurrentSession).mockImplementation(async (_input, operation) => (
      operation(Object.freeze({
        token: 'opaque-content-space-token',
        externalIdentityId: 9000041,
        bindingAttestation
      }))
    ))
    const observeEntryParent = vi.fn<OpenContentClient['observeEntryParent']>()
      .mockResolvedValue({
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'parent-folder-guid' }
      })
    const observeEntry = vi.fn<OpenContentClient['observeEntry']>()
      .mockResolvedValue({
        kind: 'container',
        folderGuid: 'parent-folder-guid',
        label: 'Authorized root'
      })
    const facade = createOpenContentContentSpaceFacade({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections,
      getRuntime: facadeRuntime(
        { observeEntry, observeEntryParent } as unknown as OpenContentClient,
        teamAdministration()
      )
    })
    const assertPrincipalCurrent = vi.fn(async () => { await Promise.resolve() })
    const signal = new AbortController().signal
    let retainedSession: Parameters<Parameters<
      OpenContentContentSpaceFacade['useHierarchyProofSession']
    >[1]>[0] | undefined

    await expect(facade.useHierarchyProofSession({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: bindingAttestation,
      signal,
      assertPrincipalCurrent
    }, async (session) => {
      retainedSession = session
      expect(session).not.toHaveProperty('token')
      expect(Object.keys(session).sort()).toEqual([
        'bindingAttestation',
        'observeContainer',
        'observeEntryParent'
      ])
      return {
        binding: session.bindingAttestation,
        parent: await session.observeEntryParent({
          kind: 'file',
          resourceGuid: 'candidate-file-guid'
        }),
        root: await session.observeContainer({
          resourceGuid: 'parent-folder-guid'
        })
      }
    })).resolves.toEqual({
      binding: bindingAttestation,
      parent: {
        child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
        parent: { kind: 'container', resourceGuid: 'parent-folder-guid' }
      },
      root: {
        kind: 'container',
        folderGuid: 'parent-folder-guid',
        label: 'Authorized root'
      }
    })
    expect(connections.useCurrentSession).toHaveBeenCalledOnce()
    expect(connections.useCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        expectedBindingAttestation: bindingAttestation,
        signal,
        assertPrincipalCurrent: expect.any(Function)
      }),
      expect.any(Function)
    )
    expect(observeEntryParent).toHaveBeenCalledWith({
      token: 'opaque-content-space-token',
      kind: 'file',
      resourceGuid: 'candidate-file-guid',
      signal,
      assertPrincipalCurrent: expect.any(Function)
    })
    expect(observeEntry).toHaveBeenCalledWith({
      token: 'opaque-content-space-token',
      kind: 'container',
      resourceGuid: 'parent-folder-guid',
      signal,
      assertPrincipalCurrent: expect.any(Function)
    })
    expect(JSON.stringify(await observeEntryParent.mock.results[0]?.value))
      .not.toMatch(/token|parentFolderId/u)
    await expect(retainedSession!.observeEntryParent({
      kind: 'file',
      resourceGuid: 'candidate-file-guid'
    })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(observeEntryParent).toHaveBeenCalledOnce()
  })

  it('lists ordinary Team roots through the canonical Team administration receipt contract', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (rawUrl: string | URL | Request) => {
      const url = new URL(String(rawUrl))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/Team/GetMyTeamList')) {
        return new Response(JSON.stringify({
          result: 0,
          msg: '',
          data: {
            pageNum: 1,
            pageSize: 1,
            totalCount: 2,
            teamList: [{
              teamId: 9000019,
              folderId: 9002213,
              teamName: 'SciForge Research',
              teamStatus: 1,
              teamOwner: 9000041,
              permission: 15,
              teamType: 0,
              isStick: false
            }],
            sortName: 'team_name',
            sortDesc: false
          }
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        return new Response(JSON.stringify({
          result: 0,
          msg: '',
          data: {
            id: 9002213,
            folderGuid: '11111111-2222-4333-8444-555555555555',
            parentFolderId: 0,
            folderType: 1,
            teamId: 9000019,
            permission: 15,
            childFolderCount: 0,
            childFileCount: 0
          }
        }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected OpenContent request: ${url.pathname}`)
    })
    const connections = connectionService()
    vi.mocked(connections.useCurrentSession).mockImplementation(async (_input, operation) => (
      operation(Object.freeze({
        token: 'opaque-content-space-token',
        externalIdentityId: 9000041,
        bindingAttestation
      }))
    ))
    const facade = createOpenContentContentSpaceFacade({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connections,
      getRuntime: facadeRuntime(
        createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch }),
        createOpenContentTeamAdministration({
          baseUrl: 'https://opencontent.invalid',
          fetch
        })
      )
    })
    const assertPrincipalCurrent = vi.fn(async () => { await Promise.resolve() })

    await expect(facade.listRootFolders({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedBindingAttestation: bindingAttestation,
      teamPage: 1,
      teamPageSize: 1,
      includePersonal: false,
      includeTeams: true,
      assertPrincipalCurrent
    })).resolves.toEqual({
      roots: [{
        source: 'team-root',
        folderGuid: '11111111-2222-4333-8444-555555555555',
        label: 'SciForge Research'
      }],
      nextTeamPage: 2
    })
    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/Team/GetMyTeamList',
      '/flatsdk/api/services/DocList/GetFolderInfoById'
    ])
    expect(connections.useCurrentSession).toHaveBeenCalledOnce()
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
  })
})

function capabilityDefinitions(connections: OpenContentConnectionService) {
  return createOpenContentCapabilityFactory({
    defineCapability: (options) => options,
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    connections
  }).createDefinitions()
}

function bindInput() {
  return {
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    account: 'fixture-opencontent-account',
    password: 'fixture-opencontent-password'
  }
}

function connectionService(): OpenContentConnectionService {
  return {
    status: vi.fn(async () => ({ state: 'disconnected' as const })),
    attestExternalBinding: vi.fn(async () => bindingAttestation),
    enroll: vi.fn(async () => ({
      state: 'connected' as const,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    })),
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
    resolveTeamRoot: vi.fn()
  }
}

function facadeRuntime(
  client: OpenContentClient,
  teamAdministration: OpenContentTeamAdministration,
  supplierRuntime?: OpenContentSupplierRuntimeSession
) {
  const runtime = Object.freeze({
    client,
    teamAdministration,
    ...(supplierRuntime ? { supplierRuntime } : {})
  })
  return () => runtime
}
