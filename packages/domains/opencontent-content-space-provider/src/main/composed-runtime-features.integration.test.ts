import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  toPortableContentContainerReference,
  type ContentSpaceProvider
} from '@sciforge/domain-content-space/contract'
import type {
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor
} from '@sciforge/domain-content-space/provider-features'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type {
  DomainMainPackageSettingsHost,
  DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import {
  canonicalJson,
  createStaticFileInventory,
  digestInventory
} from '@sciforge/internal-runtime-integrity'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import {
  OPENCONTENT_PROVIDER_KIND
} from '@sciforge/domain-opencontent-connector/contract'
import type { OpenContentContentSpaceFacade } from '@sciforge/domain-opencontent-connector/main-contract'
import {
  createDomainMainEntry as createConnectorMainEntry
} from '@sciforge/domain-opencontent-connector/main'

import { createDomainMainEntry as createProviderMainEntry } from './index.js'

const OPENCONTENT_PROVIDER_INSTANCE_REF = 'opencontent-edoc2-demo'
const SYSTEM_USER_TOKEN = 'system-user-token-canary-00000001'
const SITE = 'https://tenant.example'
const DOCUMENT_HASH = 'a'.repeat(64)
const EXPECTED_OVERLAY_ARCHIVE_SHA256 =
  '5838c94033e467d7a9e3be6669c7e72390cd9cecfa4b2a7466690734e718b598'
const DEADLINE = '2099-08-20T12:00:00.000Z'
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'content-owner',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-composed-runtime-test',
  identityVersion: 1
})
const root = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  containerId: 'team-root-guid'
})
const file = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  fileId: 'document-one'
})
const document = Object.freeze({
  resourceType: 'native_document' as const,
  reference: file
})
const staleExternalBinding = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'c'.repeat(64),
  bindingRevision: 'd'.repeat(64)
})
const assetFixture = createAssetFixture()
afterAll(() => assetFixture.dispose())
afterEach(() => vi.unstubAllGlobals())

function activateConnectorWithGlobalFetch(
  host: DomainMainHost,
  fetchImplementation: typeof globalThis.fetch
): void {
  vi.stubGlobal('fetch', fetchImplementation)
  createConnectorMainEntry(host)
}

describe('composed OpenContent runtime features', () => {
  it('composes package-owned supplier reads and administration through the production Connector entry', async () => {
    const fetchImplementation = providerFetch()
    const internalServices = inMemoryInternalServices()
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      fetchImplementation
    )

    const provider = composedProvider(internalServices)
    const native = requiredNativeFeature(provider)
    const extended = requiredExtendedFeature(provider)
    const signal = new AbortController().signal

    const nativeRead = await native.execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_native_read_0001',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file
    }))
    const extendedRead = await extended.execute(extendedInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_extended_read_0001',
      operation: 'getEntryInfo',
      request: { reference: file }
    }))

    expect(nativeRead).toMatchObject({ outcome: 'failed' })
    expect(extendedRead).toMatchObject({
      ok: false,
      error: { code: 'blocked_by_contract' }
    })
    const operationContext = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    }
    const nativeOperations = await native.describeOperations(operationContext)
    expect(nativeOperations).toHaveLength(20)
    expect(nativeOperations.filter((state) => state.readiness === 'blocked_by_contract')
      .map((state) => state.operation).sort()).toEqual([
        'comment-create',
        'comment-delete',
        'comment-reopen',
        'comment-reply',
        'comment-solve',
        'edit',
        'import',
        'insert',
        'redo',
        'undo',
        'update'
      ])
    expect(nativeOperations.filter((state) => state.readiness === 'poc_only'))
      .toHaveLength(9)
    expect(nativeOperations.filter((state) => state.readiness === 'poc_only')
      .every((state) => state.reasonCode === 'verification_profile_required')).toBe(true)

    const extendedOperations = await extended.describeOperations(operationContext)
    expect(extendedOperations).toHaveLength(50)
    expect(extendedOperations.filter((state) => state.readiness === 'blocked_by_contract'))
      .toEqual([
        'resolveInternalLink',
        'listMetadataChoices',
        'updateFileVersion',
        'searchUsers',
        'searchDepartments',
        'searchPositions',
        'searchGroups',
        'resolveCollaborationInvitation',
        'listKnowledgeCollections',
        'searchKnowledgeCollections'
      ].map((operation) => ({
        operation,
        readiness: 'blocked_by_contract',
        reasonCode: 'provider_contract_missing'
      })))
    expect(extendedOperations.filter((state) => state.readiness === 'poc_only'))
      .toHaveLength(40)
    expect(extendedOperations.filter((state) => state.readiness === 'poc_only')
      .every((state) => (
        state.readiness === 'poc_only' &&
        state.reasonCode === 'verification_profile_required'
      ))).toBe(true)

    const administration = await provider.features?.administration?.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_administration_read_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    await expect(administration?.administration.listSpaces({
      page: { limit: 10 }
    })).resolves.toMatchObject({
      items: [{ label: 'Research Team', contentOwnerUserId: principal.subject }]
    })

    expect(JSON.stringify({ nativeRead, extendedRead }))
      .not.toMatch(/system-user-token-canary|test1\.edoc2\.com|entrypoint|executable|environment/u)
  })

  it('fails closed before transport when another Provider Instance is selected', async () => {
    const internalServices = inMemoryInternalServices()
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      providerFetch()
    )
    const native = requiredNativeFeature(composedProvider(internalServices))

    await expect(native.execute(nativeInput({
      effect: 'read',
      signal: new AbortController().signal,
      invocationId: 'invocation_wrong_provider_0001',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file,
      contextProviderInstanceRef: 'another-provider-instance'
    }))).rejects.toMatchObject({ detail: { code: 'invalid_input' } })
  })

  it('stops ordinary, supplier, and Team business calls when the expected binding is stale', async () => {
    const businessRequests: string[] = []
    const internalServices = inMemoryInternalServices()
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      providerFetch(businessRequests)
    )
    const provider = composedProvider(internalServices)
    const signal = new AbortController().signal
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: staleExternalBinding,
      invocationId: 'invocation_stale_binding_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    }

    await expect(provider.listContainers({ context, page: { limit: 20 } }))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    await expect(requiredNativeFeature(provider).execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_stale_binding_0002',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file,
      expectedExternalBinding: staleExternalBinding
    }))).resolves.toMatchObject({ outcome: 'failed', error: { code: 'unauthorized' } })
    await expect(requiredExtendedFeature(provider).execute(extendedInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_stale_binding_0003',
      operation: 'getEntryInfo',
      request: { reference: file },
      expectedExternalBinding: staleExternalBinding
    }))).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } })

    const binding = await provider.features!.administration!.bind(context)
    await expect(binding.administration.listSpaces({ page: { limit: 10 } }))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    expect(businessRequests).toEqual([])
  })

  it('blocks a hash-bound write before any DocFlow process invocation', async () => {
    const internalServices = inMemoryInternalServices()
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      providerFetch()
    )
    const native = requiredNativeFeature(composedProvider(internalServices))

    const receipt = await native.execute(nativeInput({
      effect: 'external-write',
      signal: new AbortController().signal,
      invocationId: 'invocation_principal_drift_write_0001',
      operation: 'update',
      request: {
        operation: 'update',
        document,
        baseHash: DOCUMENT_HASH,
        content: { encoding: 'json', value: { type: 'doc', children: [] } }
      },
      primary: file,
      assertPrincipalCurrent
    }))

    expect(receipt).toMatchObject({
      outcome: 'failed',
      error: { code: 'unsupported', retry: 'never' }
    })
    expect(assertPrincipalCurrent).toHaveBeenCalled()
  })

  it('routes an authoritative Provider user reference through canonical Team membership administration', async () => {
    const internalServices = inMemoryInternalServices()
    const membershipFetch = providerMembershipFetch()
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      membershipFetch.fetch
    )
    const provider = composedProvider(internalServices)
    const signal = new AbortController().signal
    const member = Object.freeze({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: '85'
    })
    const feature = provider.features?.administration
    if (!feature) throw new Error('Composed OpenContent administration feature is unavailable.')
    const { administration } = await feature.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_team_member_admin_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    const spaces = await administration.listSpaces({ page: { limit: 10 } })
    const space = spaces.items[0]
    if (!space) throw new Error('The composed OpenContent Team fixture is unavailable.')

    await expect(administration.addMember({
      root: space.root,
      member
    })).resolves.toEqual({ root: space.root, member })
    const listed = await administration.listMembers({
      root: space.root,
      page: { limit: 10 }
    })
    const listedMember = listed.items.find((item) => item.member.principalId === '85')
    expect(listedMember).toEqual({ member })
    if (!listedMember) throw new Error('The added Provider directory member was not listed.')

    await expect(administration.removeMember({
      root: space.root,
      member: listedMember.member
    })).resolves.toMatchObject({ member, removed: true })
    await expect(administration.listMembers({
      root: space.root,
      page: { limit: 10 }
    })).resolves.not.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ member })])
    })
    expect(membershipFetch.observedAddedIdentityIds).toEqual([85])
    expect(membershipFetch.observedRemovedIdentityIds).toEqual([85])
  })

  it('lists Team members from the actual teamUser collection without pagination metadata', async () => {
    const internalServices = inMemoryInternalServices()
    const fallbackFetch = providerFetch()
    const fetch = vi.fn<typeof globalThis.fetch>(async (rawUrl, init) => {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
      if (url.pathname.endsWith('/Team/GetTeamById')) {
        return jsonResponse({ result: 0, data: providerTeam(42) })
      }
      if (url.pathname.endsWith('/Team/GetTeamUserByTeamIdPaging')) {
        return jsonResponse({
          result: 0,
          data: {
            creatorName: 'Synthetic Owner',
            perm: true,
            teamUser: [{
              identityId: 42,
              userType: 1,
              displayName: 'Synthetic Owner'
            }]
          }
        })
      }
      return fallbackFetch(rawUrl, init)
    })
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      fetch
    )
    const provider = composedProvider(internalServices)
    const feature = provider.features?.administration
    if (!feature) throw new Error('Composed OpenContent administration feature is unavailable.')
    const signal = new AbortController().signal
    const { administration } = await feature.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_team_member_collection_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    const teamRoot = toPortableContentContainerReference(root)

    await expect(administration.listMembers({
      root: teamRoot,
      page: { limit: 10 }
    })).resolves.toEqual({
      root: teamRoot,
      items: [{
        member: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          kind: 'user',
          principalId: '42'
        }
      }]
    })
  })

  it('fails closed before a remove receipt when an unverified member collection hides pagination', async () => {
    const internalServices = inMemoryInternalServices()
    const fallbackFetch = providerFetch()
    const mutationRequests: unknown[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (rawUrl, init) => {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
      if (url.pathname.endsWith('/Team/GetTeamById')) {
        return jsonResponse({ result: 0, data: providerTeam(42) })
      }
      if (url.pathname.endsWith('/Team/GetTeamUserByTeamIdPaging')) {
        return jsonResponse({
          result: 0,
          data: {
            list: Array.from({ length: 100 }, (_, index) => ({
              identityId: index + 100,
              userType: 3
            }))
          }
        })
      }
      if (url.pathname.endsWith('/Team/SaveTeamUserList')) {
        mutationRequests.push(jsonBody(init?.body))
        return jsonResponse({ result: 0 })
      }
      return fallbackFetch(rawUrl, init)
    })
    activateConnectorWithGlobalFetch(
      connectorHost(internalServices, connectionSettings()),
      fetch
    )
    const provider = composedProvider(internalServices)
    const feature = provider.features?.administration
    if (!feature) throw new Error('Composed OpenContent administration feature is unavailable.')
    const signal = new AbortController().signal
    const { administration } = await feature.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_team_member_pagination_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    const space = (await administration.listSpaces({ page: { limit: 10 } })).items[0]
    if (!space) throw new Error('The composed OpenContent Team fixture is unavailable.')
    const hiddenMember = Object.freeze({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: '999'
    })

    await expect(administration.removeMember({
      root: space.root,
      member: hiddenMember
    })).rejects.toMatchObject({
      detail: { code: 'provider_contract_violation', retry: 'never' }
    })
    expect(mutationRequests).toEqual([])
  })
})

function createAssetFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'sciforge-composed-runtime-assets-'))
  const repositoryRoot = resolve(root, 'repository')
  const assetRoot = resolve(
    repositoryRoot,
    'internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1'
  )
  for (const relativePath of [
    'cli/bin/oc.js',
    'cli/docflow/docflow-node.cjs',
    'scripts/docflow-probe-compact.cjs',
    'package.json',
    'runtime-patches/cli-auth-retry-single-attempt.v1.json'
  ]) {
    const target = resolve(assetRoot, ...relativePath.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, relativePath.endsWith('.json') ? '{}\n' : 'module.exports = {}\n', {
      mode: 0o644
    })
  }
  writeOverlayReceipt(repositoryRoot)
  const deploymentPath = resolve(
    repositoryRoot,
    '.sciforge/private/deployments/opencontent-connector.json'
  )
  mkdirSync(dirname(deploymentPath), { recursive: true })
  writeFileSync(deploymentPath, JSON.stringify({
    contractVersion: 1,
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    origin: SITE
  }), 'utf8')
  return {
    repositoryRoot,
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}

function writeOverlayReceipt(repositoryRoot: string): void {
  const overlayId = 'opencontent-attachment-assets'
  const overlayRoot = 'internal/opencontent'
  const version = '1.0.1'
  const files = createStaticFileInventory({
    label: 'OpenContent Provider composed runtime fixture',
    rootPath: resolve(repositoryRoot, overlayRoot),
    rootPrefix: overlayRoot
  })
  const receiptPath = resolve(
    repositoryRoot,
    `.sciforge/internal-overlays/${overlayId}.json`
  )
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, canonicalJson({
    archiveRoot: `sciforge-internal-overlay-${overlayId}-${version}`,
    archiveSha256: EXPECTED_OVERLAY_ARCHIVE_SHA256,
    files,
    inventorySha256: digestInventory({ files, overlayId, overlayRoot, version }),
    overlayId,
    overlayRoot,
    schemaVersion: 2,
    version
  }), { mode: 0o644 })
}

function nativeInput(input: Readonly<{
  effect: 'read' | 'external-write'
  signal: AbortSignal
  invocationId: string
  operation: 'read' | 'create' | 'probe' | 'plan' | 'update'
  request: unknown
  primary: typeof root | typeof file
  contextProviderInstanceRef?: string
  assertPrincipalCurrent?: () => void | Promise<void>
  expectedExternalBinding?: typeof staleExternalBinding
}>): Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0] {
  return {
    effect: input.effect,
    context: {
      principal,
      providerInstanceRef: input.contextProviderInstanceRef ?? OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: input.invocationId,
      deadlineAt: DEADLINE,
      signal: input.signal,
      ...(input.expectedExternalBinding === undefined
        ? {}
        : { expectedExternalBinding: input.expectedExternalBinding }),
      assertPrincipalCurrent: input.assertPrincipalCurrent ?? (() => undefined)
    },
    target: {
      kind: 'content',
      root,
      primary: input.primary,
      authorized: [input.primary]
    },
    operation: input.operation,
    request: input.request
  }
}

function extendedInput(input: Readonly<{
  effect: 'read' | 'external-write'
  signal: AbortSignal
  invocationId: string
  operation: 'getEntryInfo' | 'renameEntry'
  request: unknown
  expectedExternalBinding?: typeof staleExternalBinding
}>): Parameters<ContentSpaceExtendedOperationsExecutor['execute']>[0] {
  return {
    effect: input.effect,
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: input.invocationId,
      deadlineAt: DEADLINE,
      signal: input.signal,
      ...(input.expectedExternalBinding === undefined
        ? {}
        : { expectedExternalBinding: input.expectedExternalBinding }),
      assertPrincipalCurrent: () => undefined
    },
    target: { kind: 'content', root, primary: file, authorized: [file] },
    operation: input.operation,
    request: input.request
  }
}

function requiredNativeFeature(provider: ContentSpaceProvider): ContentSpaceNativeDocumentExecutor {
  const feature = provider.features?.nativeDocuments
  if (!feature) throw new Error('Composed OpenContent native-document feature is unavailable.')
  return feature
}

function requiredExtendedFeature(
  provider: ContentSpaceProvider
): ContentSpaceExtendedOperationsExecutor {
  const feature = provider.features?.extendedOperations
  if (!feature) throw new Error('Composed OpenContent extended-operation feature is unavailable.')
  return feature
}

function composedProvider(
  internalServices: NonNullable<DomainMainHost['internalServices']>
): ContentSpaceProvider {
  const host: DomainMainHost = Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-opencontent-provider-test',
    defineCapability: (options: unknown) => options,
    internalServices
  })
  const factory = createProviderMainEntry(host).contributions[0]!.value
  const instance = defineProviderInstanceDirectoryEntry({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    providerKind: OPENCONTENT_PROVIDER_KIND,
    displayName: 'OpenContent'
  })
  return factory.createProvider({
    owner: Object.freeze({
      packageName: '@sciforge/domain-opencontent-content-space-provider',
      moduleId: 'sciforge.opencontent-content-space-provider',
      moduleVersion: '1.0.0',
      contributionId: 'opencontent-content-space.provider-factory'
    }),
    instance,
    ports: Object.freeze({})
  }) as ContentSpaceProvider
}

function connectorHost(
  internalServices: NonNullable<DomainMainHost['internalServices']>,
  settings: DomainMainPackageSettingsHost
): DomainMainHost {
  const credentials: DomainMainProviderCredentialStoreHost = Object.freeze({
    status: vi.fn(async () => ({ state: 'available' as const, recordVersion: 1 as const })),
    replace: vi.fn(async () => undefined),
    use: async (_access, operation) => operation(SYSTEM_USER_TOKEN),
    remove: vi.fn(async () => undefined)
  })
  return Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-opencontent-connector-test',
    getAppRoot: () => assetFixture.repositoryRoot,
    getExecutablePath: () => process.execPath,
    isPackaged: () => false,
    defineCapability: (options: unknown) => options,
    packageSettings: settings,
    packageSecrets: Object.freeze({
      has: vi.fn(async () => false),
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      providerCredentials: credentials
    }),
    internalServices
  })
}

function connectionSettings(): DomainMainPackageSettingsHost {
  const value = {
    version: 1,
    connections: [{
      principal: {
        authority: principal.authority,
        subject: principal.subject,
        assurance: principal.assurance,
        deviceId: principal.deviceId
      },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connectionId: 'connection-composed-runtime',
      externalAccount: {
        id: 'external-account-42',
        identityId: 42,
        account: 'content-owner',
        name: 'Content Owner'
      },
      state: 'connected',
      updatedAt: '2026-08-20T00:00:00.000Z'
    }]
  } satisfies DomainPackageJsonValue
  return Object.freeze({
    read: vi.fn(async () => ({ revision: 1, value })),
    write: vi.fn(async (next: DomainPackageJsonValue) => ({ revision: 2, value: next })),
    clear: vi.fn(async () => ({ revision: 2, value: null }))
  })
}

function inMemoryInternalServices(): NonNullable<DomainMainHost['internalServices']> {
  let facade: OpenContentContentSpaceFacade | undefined
  return Object.freeze({
    register: (registration) => {
      facade = registration.service as OpenContentContentSpaceFacade
    },
    acquire: <Service extends object>() => {
      if (!facade) throw new Error('The OpenContent facade has not been registered.')
      return facade as unknown as Service
    }
  })
}

function providerFetch(businessRequests: string[] = []): typeof fetch {
  return vi.fn(async (rawUrl, init) => {
    const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
    if (url.pathname.endsWith('/Auth/CheckUserTokenValidity')) {
      expect(url.searchParams.get('token')).toBe(SYSTEM_USER_TOKEN)
      return jsonResponse({ result: 0, msg: '', data: true })
    }
    if (url.pathname.endsWith('/User/GetUserInfoByToken')) {
      expect(body).toEqual({ token: SYSTEM_USER_TOKEN })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 'external-account-42',
          identityId: 42,
          account: 'content-owner',
          name: 'Content Owner',
          topPersonalFolderId: 1001
        }
      })
    }
    if (url.pathname.endsWith('/Team/GetMyTeamList')) {
      businessRequests.push(url.pathname)
      expect(body).toMatchObject({ token: SYSTEM_USER_TOKEN, pageNum: 1, pageSize: 100 })
      return jsonResponse({
        result: 0,
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: 1,
          teamList: [{
            teamId: 7,
            folderId: 8,
            teamName: 'Research Team',
            teamStatus: 1,
            teamOwner: 42,
            permission: 1,
            teamType: 2,
            isStick: false
          }]
        }
      })
    }
    if (url.pathname.endsWith('/DocList/GetFolderChildren')) {
      businessRequests.push(url.pathname)
      expect(body).toMatchObject({
        token: SYSTEM_USER_TOKEN,
        fid: root.containerId,
        noCalcPerm: false
      })
      if (typeof body !== 'object' || body === null ||
        !('argsXml' in body) || typeof body.argsXml !== 'string') {
        throw new Error('The create parent postcondition requires bounded folder pagination.')
      }
      const argsXml = decodeURIComponent(body.argsXml)
      expect(argsXml).toContain('<PageNum>1</PageNum>')
      expect(argsXml).toContain('<PageSize>100</PageSize>')
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          folderId: 8,
          thisFolder: { id: 8, folderGuid: root.containerId, permission: 7 },
          docListInfo: {
            foldersInfo: [],
            filesInfo: [{
              id: 10888,
              fileGuid: 'created-document',
              name: 'Draft.mdoc',
              parentFolderId: 8,
              size: 128,
              permission: 7
            }],
            settings: {
              pageNum: 1,
              pageSize: 100,
              totalCount: 1,
              fileCount: 1,
              folderCount: 0
            }
          }
        }
      })
    }
    if (url.pathname.endsWith('/DocList/GetFolderInfoById')) {
      businessRequests.push(url.pathname)
      expect(body).toMatchObject({ token: SYSTEM_USER_TOKEN, folderId: 8 })
      return jsonResponse({
        result: 0,
        data: {
          id: 8,
          folderGuid: root.containerId,
          parentFolderId: 0,
          folderType: 1,
          teamId: 7,
          permission: 15,
          childFolderCount: 0,
          childFileCount: 1
        }
      })
    }
    throw new Error(`Unexpected OpenContent integration request: ${url.pathname}`)
  }) as typeof fetch
}

function providerMembershipFetch(): Readonly<{
  fetch: typeof globalThis.fetch
  observedAddedIdentityIds: number[]
  observedRemovedIdentityIds: number[]
}> {
  const observedAddedIdentityIds: number[] = []
  const observedRemovedIdentityIds: number[] = []
  const teamUsers = new Map<number, Readonly<{ userType: number; displayName: string }>>([
    [84, Object.freeze({ userType: 3, displayName: 'Ada' })],
    [91, Object.freeze({ userType: 3, displayName: 'Grace' })]
  ])
  const currentOwnerIdentityId = 42
  const fetch = vi.fn<typeof globalThis.fetch>(async (rawUrl, init) => {
    const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
    const body = jsonBody(init?.body)
    if (url.pathname.endsWith('/Auth/CheckUserTokenValidity')) {
      return jsonResponse({ result: 0, msg: '', data: true })
    }
    if (url.pathname.endsWith('/User/GetUserInfoByToken')) {
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 'external-account-42',
          identityId: 42,
          account: 'content-owner',
          name: 'Content Owner',
          topPersonalFolderId: 1001
        }
      })
    }
    if (url.pathname.endsWith('/Team/GetMyTeamList')) {
      return jsonResponse({
        result: 0,
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: 1,
          teamList: [providerTeam(currentOwnerIdentityId)]
        }
      })
    }
    if (url.pathname.endsWith('/DocList/GetFolderInfoById')) {
      return jsonResponse({
        result: 0,
        data: {
          id: 8,
          folderGuid: root.containerId,
          parentFolderId: 0,
          folderType: 1,
          teamId: 7,
          permission: 15,
          childFolderCount: 0,
          childFileCount: 1
        }
      })
    }
    if (url.pathname.endsWith('/Team/GetTeamUserByTeamIdPaging')) {
      const users = [...teamUsers].map(([identityId, user]) => ({
        identityId,
        userType: user.userType,
        displayName: user.displayName
      }))
      return jsonResponse({
        result: 0,
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: users.length,
          teamUser: users
        }
      })
    }
    if (url.pathname.endsWith('/Team/SaveTeamUserList')) {
      const additions = requiredRecordArrayField(body, 'addUserInfo')
      const deletions = requiredNumberArrayField(body, 'deleteUserInfo')
      for (const addition of additions) {
        const identityId = requiredNumberField(addition, 'userId')
        const userType = requiredNumberField(addition, 'userType')
        observedAddedIdentityIds.push(identityId)
        teamUsers.set(identityId, Object.freeze({ userType, displayName: `User ${identityId}` }))
      }
      for (const identityId of deletions) {
        observedRemovedIdentityIds.push(identityId)
        teamUsers.delete(identityId)
      }
      return jsonResponse({ result: 0 })
    }
    if (url.pathname.endsWith('/Team/GetTeamById')) {
      return jsonResponse({ result: 0, data: providerTeam(currentOwnerIdentityId) })
    }
    throw new Error(`Unexpected OpenContent Team integration request: ${url.pathname}`)
  })
  return Object.freeze({
    fetch: fetch as typeof globalThis.fetch,
    observedAddedIdentityIds,
    observedRemovedIdentityIds
  })
}

function providerTeam(ownerIdentityId: number) {
  return {
    teamId: 7,
    folderId: 8,
    teamName: 'Research Team',
    teamStatus: 1,
    teamOwner: ownerIdentityId,
    permission: 1,
    teamType: 2,
    isStick: false
  }
}

function jsonBody(body: BodyInit | null | undefined): unknown {
  return body === undefined || body === null ? undefined : JSON.parse(String(body)) as unknown
}

function requiredNumberField(value: unknown, field: string): number {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected numeric field ${field}.`)
  }
  const candidate = (value as Record<string, unknown>)[field]
  if (typeof candidate !== 'number') throw new Error(`Expected numeric field ${field}.`)
  return candidate
}

function requiredNumberArrayField(value: unknown, field: string): number[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected numeric array field ${field}.`)
  }
  const candidate = (value as Record<string, unknown>)[field]
  if (!Array.isArray(candidate) || candidate.some((item: unknown) => typeof item !== 'number')) {
    throw new Error(`Expected numeric array field ${field}.`)
  }
  return candidate as number[]
}

function requiredRecordArrayField(value: unknown, field: string): Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected object array field ${field}.`)
  }
  const candidate = (value as Record<string, unknown>)[field]
  if (!Array.isArray(candidate) || candidate.some((item: unknown) =>
    typeof item !== 'object' || item === null || Array.isArray(item))) {
    throw new Error(`Expected object array field ${field}.`)
  }
  return candidate as Record<string, unknown>[]
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
