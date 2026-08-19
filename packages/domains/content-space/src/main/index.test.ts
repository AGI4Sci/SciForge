import { describe, expect, it, vi } from 'vitest'

import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost,
  type DomainMainHost,
  type DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineContentSpaceProviderFactory,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import { DomainExternalNavigationError } from '@sciforge/domain-sdk/external-navigation'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import {
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_SPACE_CAPABILITY_IDS,
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  contentSpaceSuccess,
  defineContentSpaceProvider,
  type ContentSpaceProvider,
  type ContentSpaceResult
} from '../contract.js'
import {
  CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION,
  CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION
} from '../definition.js'
import * as mainExports from './index.js'
import { createDomainMainEntry } from './index.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const FILE = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  fileId: 'file-one'
})
const exactSignedUrl = 'https://provider.invalid/portal?sig=a%2Bb&token=opaque%2Fvalue'
const principal: PrincipalSnapshot = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection' as const,
  deviceId: 'content-space-main-test-device',
  identityVersion: 1
})

type CapabilityContext = Readonly<{
  caller: Readonly<{
    audience: 'ui' | 'agent' | 'system'
    callerId: string
    principal: typeof principal
    workspaceId?: string
  }>
  invocationId: string
  signal: AbortSignal
  assertPrincipalCurrent(): void
  resource?: Readonly<{ resourceId: string; resourceKind: string; workspaceId?: string }>
  issueResource(registration: any): unknown
}>

type CapabilityDefinition = Readonly<{
  id: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global' | 'resource'
  resourceKinds?: readonly string[]
  tags: readonly string[]
  effect: 'read' | 'external-write'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{ revision: 'none'; idempotency: 'none' | 'required' }>
  inputSchema: Readonly<{ safeParse(value: unknown): Readonly<{ success: boolean }> }>
  outputSchema: Readonly<{ safeParse(value: unknown): Readonly<{ success: boolean }> }>
  handler(input: unknown, context: CapabilityContext): Promise<Readonly<{
    output: ContentSpaceResult<unknown>
  }>>
}>

describe('Content Space main composition', () => {
  it('exports only the standard process entry, not raw catalog/service/Provider paths', () => {
    expect(Object.keys(mainExports).sort()).toEqual(['createDomainMainEntry'])
  })

  it('stays lazy through composition and lists instances without creating a Provider', async () => {
    const createProvider = vi.fn(() => providerFixture())
    const defineCapability = vi.fn((options: unknown) => options)
    const host = mainHost({ defineCapability })
    const entry = createDomainMainEntry(host)
    expect(defineCapability).not.toHaveBeenCalled()
    expect(createProvider).not.toHaveBeenCalled()

    const definitions = await activateDefinitions(entry.contributions, contributionHost(
      providerContributions(createProvider)
    ))
    const expectedCapabilityIds = Object.values(CONTENT_SPACE_CAPABILITY_IDS).sort()
    expect(definitions.map(({ id }) => id).sort()).toEqual(expectedCapabilityIds)
    expect(defineCapability).toHaveBeenCalledTimes(expectedCapabilityIds.length)
    const list = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances)
    const result = await list.handler({}, capabilityContext())
    expect(result.output).toEqual(contentSpaceSuccess({
      items: [{
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        providerKind: 'fixture-content-space',
        label: 'Fixture Content Space'
      }]
    }))
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('fails Provider Instance discovery when the Host Principal lease is stale', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const list = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances)
    const result = await list.handler({}, capabilityContext(() => {
      throw new Error('Principal changed')
    }))
    expect(result.output).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('keeps signed Provider query text inside Host navigation and returns only an opaque handle', async () => {
    const handle = `portal_${'a'.repeat(32)}`
    const issueTarget = vi.fn((_input: Readonly<{ url: string; expiresAt: string }>) => ({
      handle,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }))
    const openTarget = vi.fn(async (_input: Readonly<{
      handle: string
      signal?: AbortSignal
    }>) => undefined)
    const host = mainHost({ externalNavigation: { issueTarget, openTarget } })
    const entry = createDomainMainEntry(host)
    const definitions = await activateDefinitions(
      entry.contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const resolved = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget
    ).handler({ reference: FILE }, capabilityContext())
    expect(resolved.output).toMatchObject({ ok: true, value: { handle } })
    expect(JSON.stringify(resolved.output)).not.toContain('token=')
    expect(JSON.stringify(resolved.output)).not.toContain('opaque%2Fvalue')
    expect(issueTarget.mock.calls[0]?.[0].url).toBe(exactSignedUrl)

    const opened = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget
    ).handler({ handle }, capabilityContext())
    expect(opened.output).toEqual(contentSpaceSuccess({ opened: true }))
    expect(openTarget).toHaveBeenCalledTimes(1)
    expect(openTarget.mock.calls[0]?.[0]).toMatchObject({ handle })
    expect(openTarget.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['principal_changed', 'unauthorized'],
    ['invalid_target', 'unsafe_portal_target'],
    ['capacity_exceeded', 'bounds_exceeded']
  ] as const)('maps Host issueTarget %s without leaking Host details', async (hostCode, domainCode) => {
    const host = mainHost({
      externalNavigation: {
        issueTarget: () => {
          throw new DomainExternalNavigationError(hostCode, 'signed token=do-not-leak')
        },
        openTarget: vi.fn(async () => undefined)
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget
    ).handler({ reference: FILE }, capabilityContext())

    expect(result.output).toMatchObject({ ok: false, error: { code: domainCode } })
    expect(JSON.stringify(result.output)).not.toContain('do-not-leak')
  })

  it('projects typed errors with domain-owned messages so Provider secrets cannot escape', async () => {
    const provider = providerFixture({
      resolvePortalTarget: async () => {
        throw new ContentSpaceOperationError({
          code: 'provider_unavailable',
          message: 'signed token=do-not-leak',
          retry: 'never'
        })
      }
    })
    const host = mainHost({
      externalNavigation: {
        issueTarget: vi.fn((_input: Readonly<{ url: string; expiresAt: string }>) => ({
          handle: `portal_${'b'.repeat(32)}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString()
        })),
        openTarget: vi.fn(async (_input: Readonly<{
          handle: string
          signal?: AbortSignal
        }>) => undefined)
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => provider))
    )
    const result = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget
    ).handler({ reference: FILE }, capabilityContext())
    expect(result.output).toMatchObject({
      ok: false,
      error: {
        code: 'provider_unavailable',
        message: 'The selected Provider is unavailable.'
      }
    })
    expect(JSON.stringify(result.output)).not.toContain('do-not-leak')
  })

  it('declares every write as confirmation + required idempotency', async () => {
    const entry = createDomainMainEntry(mainHost())
    const definitions = await activateDefinitions(
      entry.contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const writeIds = new Set<string>([
      CONTENT_SPACE_CAPABILITY_IDS.createFolder,
      CONTENT_SPACE_CAPABILITY_IDS.uploadNew,
      CONTENT_SPACE_CAPABILITY_IDS.download,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
      CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
      CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
      CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
      CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget
    ])
    for (const capability of definitions) {
      if (writeIds.has(capability.id)) {
        expect(capability).toMatchObject({
          effect: 'external-write',
          approval: 'confirmation',
          concurrency: { idempotency: 'required' }
        })
      } else {
        expect(capability.effect).toBe('read')
        expect(capability.approval).toBe('none')
      }
    }
  })

  it('keeps Human browsing global while Agent content access starts from a confirmed resource root', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.listContainers)).toMatchObject({
      audiences: ['ui'],
      scope: 'global'
    })
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)).toMatchObject({
      audiences: ['agent'],
      scope: 'global',
      effect: 'external-write',
      approval: 'confirmation'
    })
    expect(definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries)).toMatchObject({
      audiences: ['agent'],
      scope: 'resource',
      resourceKinds: [CONTENT_CONTAINER_RESOURCE_KIND],
      effect: 'read'
    })
  })

  it('routes Agent upload input through the active Workspace transfer port only', async () => {
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'input.txt',
      size: 5,
      read: async () => new TextEncoder().encode('input'),
      close: async () => undefined
    }))
    const host = mainHost({
      fileTransfers: {
        openUploadSource: vi.fn(async () => { throw new Error('UI handle path was used') }),
        openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
        openWorkspaceUploadSource,
        openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unused') })
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    let registration: any
    const resource = { token: `cap_${'a'.repeat(32)}`, semanticRevision: 'live:root', expiresAt: '2026-08-17T17:00:00.000Z' }
    const authorization = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ).handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      label: 'Root'
    }, capabilityContext(undefined, 'agent', {
      workspaceId: '/workspace',
      issueResource: (value) => {
        registration = value
        return resource
      }
    }))
    expect(authorization.output).toMatchObject({ ok: true })

    const result = await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew).handler({
      name: 'input.txt',
      workspaceRelativePath: 'results/input.txt'
    }, capabilityContext(undefined, 'agent', {
      workspaceId: '/workspace',
      resource: {
        resourceId: registration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))

    expect(result.output).toMatchObject({ ok: true })
    expect(openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'results/input.txt',
      maxBytes: 16 * 1024 * 1024
    }))
  })

  it('rejects raw GUIDs and Agent resources outside the exact Principal, caller, Workspace, and kind', async () => {
    const listEntries = vi.fn(async ({ parent }: Parameters<ContentSpaceProvider['listEntries']>[0]) => ({
      parent,
      items: []
    }))
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listEntries })))
    )
    let registration: any
    await definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot).handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      label: 'Root'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:thread-1',
      workspaceId: '/workspace-a',
      issueResource: (value) => {
        registration = value
        return {
          token: `cap_${'b'.repeat(32)}`,
          semanticRevision: 'live:root',
          expiresAt: '2026-08-17T17:00:00.000Z'
        }
      }
    }))

    const validResource = Object.freeze({
      resourceId: registration.resourceId as string,
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace-a'
    })
    const attempts = [
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        workspaceId: '/workspace-a',
        resource: { ...validResource, resourceId: 'raw-team-folder-guid' }
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-2',
        workspaceId: '/workspace-a',
        resource: validResource
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        principal: { ...principal, subject: '123e4567-e89b-42d3-a456-426614174001' },
        workspaceId: '/workspace-a',
        resource: validResource
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        workspaceId: '/workspace-b',
        resource: validResource
      }),
      capabilityContext(undefined, 'agent', {
        callerId: 'agent:thread-1',
        workspaceId: '/workspace-a',
        resource: { ...validResource, resourceKind: 'content-space.file' }
      })
    ]
    const list = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries)
    for (const context of attempts) {
      await expect(list.handler({ page: { limit: 20 } }, context)).resolves.toMatchObject({
        output: { ok: false, error: { code: 'unauthorized' } }
      })
    }
    expect(listEntries).not.toHaveBeenCalled()

    await expect(list.handler({ page: { limit: 20 } }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:thread-1',
      workspaceId: '/workspace-a',
      resource: validResource
    }))).resolves.toMatchObject({ output: { ok: true } })
    expect(listEntries).toHaveBeenCalledTimes(1)
  })

  it('resolves a Human-named Agent root from the complete live container listing', async () => {
    const listContainers = vi.fn(async ({ context, page }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => page.cursor
      ? {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'team-root'
            },
            scope: 'shared' as const,
            label: 'SciForge Test'
          }]
        }
      : {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'personal-root'
            },
            scope: 'personal' as const,
            label: 'Personal library'
          }],
          nextCursor: 'team-page'
        })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listContainers })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResource = vi.fn(() => ({
      token: `cap_${'c'.repeat(32)}`,
      semanticRevision: 'live:authorized-root',
      expiresAt: '2026-08-17T17:00:00.000Z'
    }))

    const result = await authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      label: 'sciforge test'
    }, capabilityContext(undefined, 'agent', {
      workspaceId: '/workspace',
      issueResource
    }))

    expect(result.output).toMatchObject({
      ok: true,
      value: { resource: { token: expect.stringMatching(/^cap_/u) } }
    })
    expect(JSON.stringify(result.output)).not.toContain('team-root')
    expect(listContainers).toHaveBeenCalledTimes(2)
    expect(issueResource).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace'
    }))
  })

  it('derives the Provider Instance from discovery and pages scope-filtered Agent root labels without identities', async () => {
    const listContainers = vi.fn(async ({ context, page }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => page.cursor
      ? {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'team-folder-guid'
            },
            scope: 'shared' as const,
            label: 'SciForge Research'
          }]
        }
      : {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'personal-folder-guid'
            },
            scope: 'personal' as const,
            label: 'Personal library'
          }],
          nextCursor: 'team-page'
        })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listContainers })))
    )
    const providers = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    ).handler({}, capabilityContext(undefined, 'agent'))
    const providerInstanceRef = successValue<{
      items: Array<{ providerInstanceRef: string; label: string }>
    }>(providers.output).items[0]?.providerInstanceRef
    expect(providerInstanceRef).toBe(PROVIDER_INSTANCE_REF)

    const listCandidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )

    const first = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { limit: 20 }
    }, capabilityContext(undefined, 'agent'))
    const second = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { cursor: 'team-page', limit: 20 }
    }, capabilityContext(undefined, 'agent'))

    expect(first.output).toEqual(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      items: [],
      nextCursor: 'team-page'
    }))
    expect(second.output).toEqual(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      items: [{ libraryLabel: 'SciForge Research' }]
    }))
    expect(JSON.stringify([first.output, second.output])).not.toContain('folder-guid')
    expect(JSON.stringify([first.output, second.output])).not.toMatch(
      /containerId|folderId|folderGuid|teamId|reference/iu
    )
    expect(listCandidates).toMatchObject({
      audiences: ['agent'],
      scope: 'global',
      effect: 'read',
      approval: 'none'
    })
    expect(listCandidates.inputSchema.safeParse({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      page: { limit: 20 },
      folderGuid: 'raw-team-folder-guid'
    }).success).toBe(false)
    expect(listCandidates.outputSchema.safeParse(contentSpaceSuccess({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      items: [{
        libraryLabel: 'SciForge Research',
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-team-root' }
      }]
    })).success).toBe(false)
    expect(listContainers.mock.calls.map(([input]) => input.page.cursor)).toEqual([
      undefined,
      'team-page'
    ])
  })

  it.each([
    {
      name: 'the listed Team label becomes stale',
      liveTeamItems: []
    },
    {
      name: 'the listed Team label becomes canonically ambiguous',
      liveTeamItems: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'live-team-a' },
        scope: 'shared' as const,
        label: 'SciForge Research'
      }, {
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'live-team-b' },
        scope: 'shared' as const,
        label: 'sciforge research'
      }]
    }
  ])('freshly re-enumerates authorization when $name', async ({ liveTeamItems }) => {
    let phase: 'candidate' | 'authorization' = 'candidate'
    const listContainers = vi.fn(async ({ context, page }:
      Parameters<ContentSpaceProvider['listContainers']>[0]) => page.cursor
      ? {
          providerInstanceRef: context.providerInstanceRef,
          items: phase === 'candidate'
            ? [{
                reference: {
                  providerInstanceRef: context.providerInstanceRef,
                  containerId: 'candidate-team-root'
                },
                scope: 'shared' as const,
                label: 'SciForge Research'
              }]
            : liveTeamItems
        }
      : {
          providerInstanceRef: context.providerInstanceRef,
          items: [{
            reference: {
              providerInstanceRef: context.providerInstanceRef,
              containerId: 'personal-root'
            },
            scope: 'personal' as const,
            label: 'Personal library'
          }],
          nextCursor: 'team-page'
        })
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({ listContainers })))
    )
    const providers = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    ).handler({}, capabilityContext(undefined, 'agent'))
    const providerInstanceRef = successValue<{
      items: Array<{ providerInstanceRef: string }>
    }>(providers.output).items[0]?.providerInstanceRef
    const listCandidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )
    const first = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { limit: 20 }
    }, capabilityContext(undefined, 'agent'))
    const second = await listCandidates.handler({
      providerInstanceRef,
      scope: 'shared',
      page: { cursor: successValue<{ nextCursor?: string }>(first.output).nextCursor, limit: 20 }
    }, capabilityContext(undefined, 'agent'))
    const libraryLabel = successValue<{
      items: Array<{ libraryLabel: string }>
    }>(second.output).items[0]?.libraryLabel
    expect(libraryLabel).toBe('SciForge Research')

    phase = 'authorization'
    const issueResource = vi.fn()
    const authorized = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ).handler({
      providerInstanceRef,
      scope: 'shared',
      label: libraryLabel
    }, capabilityContext(undefined, 'agent', { issueResource }))

    expect(authorized.output).toMatchObject({
      ok: false,
      error: { code: 'invalid_target' }
    })
    expect(issueResource).not.toHaveBeenCalled()
    expect(listContainers.mock.calls.map(([input]) => input.page.cursor)).toEqual([
      undefined,
      'team-page',
      undefined,
      'team-page'
    ])
  })

  it('creates, re-lists the exact child resource, and uploads without using the create receipt as authority', async () => {
    const root = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'team-root'
    })
    const child = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'reports-folder'
    })
    let created = false
    const createFolder = vi.fn(async ({ context, parent, name }:
      Parameters<ContentSpaceProvider['createFolder']>[0]) => {
      created = true
      return {
        invocationId: context.invocationId,
        parent,
        name,
        reference: child
      }
    })
    const listEntries = vi.fn(async ({ parent }:
      Parameters<ContentSpaceProvider['listEntries']>[0]) => ({
      parent,
      items: created
        ? [{ kind: 'container' as const, reference: child, label: 'Reports' }]
        : []
    }))
    const uploadNewFile = vi.fn(async ({ context, parent, name, source }:
      Parameters<ContentSpaceProvider['uploadNewFile']>[0]) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'report-file' }
    }))
    const close = vi.fn(async () => undefined)
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'report.md',
      size: 6,
      read: async () => new TextEncoder().encode('report'),
      close
    }))
    const host = mainHost({
      fileTransfers: {
        openUploadSource: vi.fn(async () => { throw new Error('UI handle path was used') }),
        openDownloadDestination: vi.fn(async () => { throw new Error('unused') }),
        openWorkspaceUploadSource,
        openWorkspaceDownloadDestination: vi.fn(async () => { throw new Error('unused') })
      }
    })
    const definitions = await activateDefinitions(
      createDomainMainEntry(host).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [{ reference: root, scope: 'shared', label: 'SciForge Research' }]
        }),
        createFolder,
        listEntries,
        uploadNewFile
      })))
    )
    const providers = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
    ).handler({}, capabilityContext(undefined, 'agent'))
    const providerInstanceRef = successValue<{
      items: Array<{ providerInstanceRef: string }>
    }>(providers.output).items[0]?.providerInstanceRef
    let rootRegistration: any
    const authorized = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ).handler({
      providerInstanceRef,
      scope: 'shared',
      label: 'SciForge Research'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      issueResource: (registration) => {
        rootRegistration = registration
        return {
          token: `cap_${'r'.repeat(32)}`,
          semanticRevision: 'live:root',
          expiresAt: '2026-08-17T17:00:00.000Z'
        }
      }
    }))
    expect(authorized.output).toMatchObject({ ok: true })
    const rootResource = Object.freeze({
      resourceId: rootRegistration.resourceId as string,
      resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
      workspaceId: '/workspace'
    })

    const createdFolder = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder
    ).handler({ name: 'Reports' }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      resource: rootResource
    }))
    expect(createdFolder.output).toMatchObject({
      ok: true,
      value: { reference: child }
    })
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ parent: root, name: 'Reports' }))

    let childRegistration: any
    const listed = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentListEntries
    ).handler({ page: { limit: 20 } }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      resource: rootResource,
      issueResource: (registration) => {
        childRegistration = registration
        return {
          token: `cap_${'c'.repeat(32)}`,
          semanticRevision: 'live:child',
          expiresAt: '2026-08-17T17:00:00.000Z'
        }
      }
    }))
    expect(listed.output).toMatchObject({
      ok: true,
      value: {
        items: [{
          entry: { kind: 'container', label: 'Reports' },
          resource: { token: expect.stringMatching(/^cap_/u) }
        }]
      }
    })
    expect(childRegistration).toMatchObject({ resourceKind: CONTENT_CONTAINER_RESOURCE_KIND })

    const uploaded = await definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew
    ).handler({
      name: 'report.md',
      workspaceRelativePath: 'reports/report.md'
    }, capabilityContext(undefined, 'agent', {
      callerId: 'agent:content-flow',
      workspaceId: '/workspace',
      resource: {
        resourceId: childRegistration.resourceId,
        resourceKind: CONTENT_CONTAINER_RESOURCE_KIND,
        workspaceId: '/workspace'
      }
    }))

    expect(uploaded.output).toMatchObject({ ok: true, value: { parent: child } })
    expect(uploadNewFile).toHaveBeenCalledWith(expect.objectContaining({
      parent: child,
      name: 'report.md'
    }))
    expect(uploadNewFile).not.toHaveBeenCalledWith(expect.objectContaining({ parent: root }))
    expect(openWorkspaceUploadSource).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: 'reports/report.md'
    }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'wrong scope',
      items: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root' },
        scope: 'shared' as const,
        label: 'SciForge Test'
      }],
      selection: { scope: 'personal' as const, label: 'SciForge Test' }
    },
    {
      name: 'missing label',
      items: [{
        reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root' },
        scope: 'shared' as const,
        label: 'SciForge Test'
      }],
      selection: { scope: 'shared' as const, label: 'Unknown Team' }
    },
    {
      name: 'ambiguous canonical label',
      items: [
        {
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root-a' },
          scope: 'shared' as const,
          label: 'SciForge Test'
        },
        {
          reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'team-root-b' },
          scope: 'shared' as const,
          label: 'sciforge test'
        }
      ],
      selection: { scope: 'shared' as const, label: 'SCIFORGE TEST' }
    }
  ])('does not issue an Agent root for $name', async ({ items, selection }) => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items
        })
      })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResource = vi.fn()

    await expect(authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      ...selection
    }, capabilityContext(undefined, 'agent', { issueResource }))).resolves.toMatchObject({
      output: { ok: false, error: { code: 'invalid_target' } }
    })
    expect(issueResource).not.toHaveBeenCalled()
  })

  it('does not authorize from an incomplete cyclic container listing', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture({
        listContainers: async ({ context }) => ({
          providerInstanceRef: context.providerInstanceRef,
          items: [],
          nextCursor: 'repeated-page'
        })
      })))
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const issueResource = vi.fn()

    await expect(authorize.handler({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      label: 'SciForge Test'
    }, capabilityContext(undefined, 'agent', { issueResource }))).resolves.toMatchObject({
      output: { ok: false, error: { code: 'provider_unavailable' } }
    })
    expect(issueResource).not.toHaveBeenCalled()
  })

  it('rejects raw parent, reference, and Provider identities from every Agent operation schema', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const candidates = definition(
      definitions,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
    )
    const authorize = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot)
    const listEntries = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentListEntries)
    const createFolder = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder)
    const uploadNew = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew)
    const download = definition(definitions, CONTENT_SPACE_CAPABILITY_IDS.agentDownload)
    const rawIdentityFields = [{
      parent: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-parent-guid' }
    }, {
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-reference-guid' }
    }, {
      root: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'raw-root-guid' }
    }, {
      containerId: 'raw-container-guid'
    }, {
      fileId: 'raw-file-guid'
    }, {
      resourceId: 'raw-provider-resource-id'
    }, {
      resourceRef: `res_${'x'.repeat(26)}`
    }, {
      folderId: 42
    }, {
      folderGuid: 'raw-folder-guid'
    }, {
      teamId: 9
    }]
    const schemas = [{
      capability: candidates,
      valid: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        scope: 'shared',
        page: { limit: 20 }
      }
    }, {
      capability: authorize,
      valid: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        scope: 'personal',
        label: 'Root'
      }
    }, {
      capability: listEntries,
      valid: { page: { limit: 20 } }
    }, {
      capability: createFolder,
      valid: { name: 'Reports' }
    }, {
      capability: uploadNew,
      valid: { name: 'report.md', workspaceRelativePath: 'reports/report.md' }
    }, {
      capability: download,
      valid: { workspaceRelativePath: 'downloads/report.md' }
    }]

    for (const { capability, valid } of schemas) {
      expect(capability.inputSchema.safeParse(valid).success).toBe(true)
      for (const rawIdentity of rawIdentityFields) {
        expect(capability.inputSchema.safeParse({ ...valid, ...rawIdentity }).success).toBe(false)
      }
    }
    expect(candidates.inputSchema.safeParse({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'shared',
      page: { limit: 20 },
      label: 'OpenContent'
    }).success).toBe(false)
    expect(authorize.inputSchema.safeParse({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      scope: 'personal',
      label: 'Root'
    }).success).toBe(true)

    const rawContainerReference = Object.freeze({
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      containerId: 'raw-container-guid'
    })
    const agentCapabilitiesAcceptingRawReferences = definitions
      .filter(({ audiences }) => audiences.includes('agent'))
      .filter(({ inputSchema }) =>
        inputSchema.safeParse({ reference: FILE }).success ||
        inputSchema.safeParse({ reference: rawContainerReference }).success
      )
      .map(({ id }) => id)
    expect(agentCapabilitiesAcceptingRawReferences).toEqual([])
  })

  it('keeps Human portal and immutable-reference operations out of the Agent audience', async () => {
    const definitions = await activateDefinitions(
      createDomainMainEntry(mainHost()).contributions,
      contributionHost(providerContributions(() => providerFixture()))
    )
    const humanGlobalIds = [
      CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
      CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
      CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget
    ]
    for (const id of humanGlobalIds) {
      expect(definition(definitions, id)).toMatchObject({
        audiences: ['ui'],
        scope: 'global'
      })
    }

    const agentGlobalAllowlist = new Set<string>([
      CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances,
      CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates,
      CONTENT_SPACE_CAPABILITY_IDS.describeCapabilities,
      CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
    ])
    const unexpectedAgentGlobalIds = definitions
      .filter(({ audiences, scope }) => audiences.includes('agent') && scope === 'global')
      .map(({ id }) => id)
      .filter((id) => !agentGlobalAllowlist.has(id))
    expect(unexpectedAgentGlobalIds).toEqual([])
  })
})

function mainHost(overrides: Partial<DomainMainHost> = {}): DomainMainHost {
  return Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-content-space-main-test',
    defineCapability: (options: unknown) => options,
    ...overrides
  })
}

async function activateDefinitions(
  contributions: readonly Readonly<{ id: string; value: unknown }>[],
  composed: DomainMainContributionHost
): Promise<readonly CapabilityDefinition[]> {
  const lifecycle = contributions.find(({ id }) =>
    id === CONTENT_SPACE_RUNTIME_LIFECYCLE_CONTRIBUTION.id
  )?.value as DomainMainRuntimeLifecycleContribution | undefined
  const factory = contributions.find(({ id }) =>
    id === CONTENT_SPACE_CAPABILITY_FACTORY_CONTRIBUTION.id
  )?.value as Readonly<{ createDefinitions(): readonly unknown[] }> | undefined
  if (!lifecycle || !factory) throw new Error('Content Space composition is incomplete')
  await lifecycle.activate({
    contributions: composed
  } as unknown as Parameters<DomainMainRuntimeLifecycleContribution['activate']>[0])
  return factory.createDefinitions() as readonly CapabilityDefinition[]
}

function definition(
  definitions: readonly CapabilityDefinition[],
  id: string
): CapabilityDefinition {
  const found = definitions.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Missing capability ${id}`)
  return found
}

function successValue<Value>(result: ContentSpaceResult<unknown>): Value {
  if (!result.ok) throw new Error(`Expected Content Space success, received ${result.error.code}`)
  return result.value as Value
}

function capabilityContext(
  assertPrincipalCurrent: (() => void) | undefined = () => undefined,
  audience: 'ui' | 'agent' | 'system' = 'ui',
  options: Readonly<{
    callerId?: string
    principal?: typeof principal
    workspaceId?: string
    resource?: CapabilityContext['resource']
    issueResource?: CapabilityContext['issueResource']
  }> = {}
): CapabilityContext {
  return Object.freeze({
    caller: Object.freeze({
      audience,
      callerId: options.callerId ?? 'renderer:test',
      principal: options.principal ?? principal,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {})
    }),
    invocationId: 'invocation_content_space_main_0001',
    signal: new AbortController().signal,
    assertPrincipalCurrent: assertPrincipalCurrent ?? (() => undefined),
    ...(options.resource ? { resource: options.resource } : {}),
    issueResource: options.issueResource ?? (() => {
      throw new Error('Unexpected resource issuance')
    })
  })
}

function providerFixture(overrides: Partial<ContentSpaceProvider> = {}): ContentSpaceProvider {
  const ready = ([
    'list-containers',
    'list-entries',
    'observe-entry',
    'create-folder',
    'upload-new',
    'download',
    'portal-target',
    'observe-immutable-version'
  ] as const).map((operation) => ({
    operation,
    readiness: 'production_ready' as const,
    reasonCode: 'available' as const
  }))
  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    describeCapabilities: async () => ready,
    listContainers: async ({ context }) => ({
      providerInstanceRef: context.providerInstanceRef,
      items: [{
        reference: { providerInstanceRef: context.providerInstanceRef, containerId: 'root' },
        scope: 'personal',
        label: 'Root'
      }]
    }),
    listEntries: async ({ parent }) => ({ parent, items: [] }),
    observeEntry: async ({ reference }) => ({
      entry: 'containerId' in reference
        ? { kind: 'container' as const, reference, label: 'Container' }
        : {
            kind: 'file' as const,
            reference: {
              providerInstanceRef: reference.providerInstanceRef,
              fileId: reference.fileId
            },
            label: 'File',
            size: 0
          },
      capabilities: ready
    }),
    createFolder: async ({ context, parent, name }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, containerId: 'created' }
    }),
    uploadNewFile: async ({ context, parent, name, source }) => ({
      invocationId: context.invocationId,
      parent,
      name,
      sourceSize: source.size,
      reference: { providerInstanceRef: PROVIDER_INSTANCE_REF, fileId: 'uploaded' }
    }),
    downloadFile: async ({ context, reference }) => ({
      invocationId: context.invocationId,
      reference,
      bytesWritten: 0
    }),
    resolvePortalTarget: async () => ({
      url: exactSignedUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }),
    observeImmutableVersion: async () => ({
      proven: false,
      reasonCode: 'resource_capability_missing'
    }),
    ...overrides
  })
}

function providerContributions(
  createProvider: () => ContentSpaceProvider | Promise<ContentSpaceProvider>
): readonly DomainMainContribution[] {
  return Object.freeze([
    contribution('fixture.factory', {
      location: MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-content-space'
    }, defineContentSpaceProviderFactory({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerKind: 'fixture-content-space',
      createProvider
    })),
    contribution('fixture.instance', {
      location: MAIN_PROVIDER_INSTANCE_DIRECTORY_ENTRY_LOCATION,
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: 'fixture-content-space',
      displayName: 'Fixture Content Space'
    }, defineProviderInstanceDirectoryEntry({
      contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      providerKind: 'fixture-content-space',
      displayName: 'Fixture Content Space'
    }))
  ])
}

function contribution(
  id: string,
  contract: DomainPackageJsonValue,
  value: unknown
): DomainMainContribution {
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/content-space-provider',
    owner: Object.freeze({ moduleId: 'fixture.content-space', moduleVersion: '1.0.0' }),
    version: PROVIDER_FACTORY_CONTRACT_VERSION,
    contract,
    value
  })
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({ list: () => contributions })
}
