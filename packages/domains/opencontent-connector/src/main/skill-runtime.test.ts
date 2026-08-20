import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import type {
  DomainMainHost,
  DomainMainInternalServiceRegistration
} from '@sciforge/domain-sdk/host'
import type {
  OpenContentCliProcessPort
} from '@sciforge/opencontent-skill-runtime/main/cli-runner'
import {
  assertOpenContentSkillBundledAssetsPresent
} from '@sciforge/opencontent-skill-runtime/main/bundled-assets'

import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  type OpenContentContentSpaceFacade,
  type OpenContentSkillRuntimeTransport
} from '../contract.js'
import type { OpenContentConnectionService } from './connection-service.js'
import { createDomainMainEntry } from './index.js'
import {
  createOpenContentSkillRuntimeSession,
  resolveOpenContentSkillRuntimeAssets
} from './skill-runtime.js'

const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'local-account-a',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-skill-runtime-test',
  identityVersion: 1
})
const assetFixture = createAssetFixture()
afterAll(() => assetFixture.dispose())

describe('OpenContent main-only skill runtime session', () => {
  it('activates a source repository overlay when the private package is not installed', () => {
    expect(existsSync(resolve(
      assetFixture.repositoryRoot,
      'node_modules/@sciforge-internal/opencontent-skill-assets'
    ))).toBe(false)
    const sourceAssets = resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => assetFixture.repositoryRoot,
      isPackaged: () => false
    })

    expect(sourceAssets).toEqual({
      mode: 'source',
      assetRoot: assetFixture.repositoryOverlayAssetRoot
    })
    expect(assertOpenContentSkillBundledAssetsPresent(sourceAssets!).cliEntrypoint)
      .toBe(resolve(assetFixture.repositoryOverlayAssetRoot, 'cli/bin/oc.js'))
  })

  it('publishes the source repository runtime through the Connector facade', () => {
    const entry = mainEntryFixture(assetFixture.repositoryRoot)

    createDomainMainEntry(entry.host, {
      skillRuntime: { processPort: { run: vi.fn() } }
    })

    expect(entry.registeredService()).toMatchObject({
      useSkillRuntime: expect.any(Function),
      useTeamAdministration: expect.any(Function),
      listRootFolders: expect.any(Function)
    })
  })

  it('leaves the optional source runtime disabled when the repository overlay is absent', () => {
    expect(resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => resolve(assetFixture.root, 'repository-without-overlay'),
      isPackaged: () => false
    })).toBeUndefined()
  })

  it('surfaces an incomplete source overlay to strict asset validation', () => {
    const sourceAssets = resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => assetFixture.incompleteRepositoryRoot,
      isPackaged: () => false
    })

    expect(sourceAssets).toEqual({
      mode: 'source',
      assetRoot: assetFixture.incompleteRepositoryOverlayAssetRoot
    })
    expect(() => assertOpenContentSkillBundledAssetsPresent(sourceAssets!))
      .toThrow('Bundled OpenContent assets are unavailable or invalid.')
  })

  it('fails Connector activation closed for an incomplete source overlay', () => {
    const entry = mainEntryFixture(assetFixture.incompleteRepositoryRoot)

    expect(() => createDomainMainEntry(entry.host, {
      skillRuntime: { processPort: { run: vi.fn() } }
    })).toThrow('Bundled OpenContent assets are unavailable or invalid.')
    expect(entry.registeredService()).toBeUndefined()
  })

  it('derives packaged assets only from the Host-injected Electron app root', () => {
    expect(resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => resolve(assetFixture.resourcesPath, 'app.asar'),
      isPackaged: () => true
    })).toEqual({
      mode: 'packaged',
      resourcesPath: assetFixture.resourcesPath
    })
    const sourceAssets = resolveOpenContentSkillRuntimeAssets({
      isPackaged: () => false
    }, {
      mode: 'source',
      assetRoot: assetFixture.assetRoot
    })
    expect(sourceAssets).toEqual({ mode: 'source', assetRoot: assetFixture.assetRoot })
    expect(assertOpenContentSkillBundledAssetsPresent(sourceAssets!).cliEntrypoint)
      .toBe(resolve(assetFixture.assetRoot, 'cli/bin/oc.js'))
    expect(resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => resolve(assetFixture.root, 'missing-resources', 'app.asar'),
      isPackaged: () => true
    })).toBeUndefined()
    expect(resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => resolve(assetFixture.repositoryRoot, 'app.asar'),
      isPackaged: () => true
    })).toBeUndefined()
    expect(() => resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => 'relative/app.asar',
      isPackaged: () => true
    })).toThrow(/absolute Electron app root/u)
  })

  it('fails Connector activation closed for incomplete packaged assets', () => {
    const entry = mainEntryFixture(
      resolve(assetFixture.incompleteResourcesPath, 'app.asar'),
      true
    )

    expect(() => createDomainMainEntry(entry.host, {
      skillRuntime: { processPort: { run: vi.fn() } }
    })).toThrow('Bundled OpenContent assets are unavailable or invalid.')
    expect(entry.registeredService()).toBeUndefined()
  })

  it('runs one fixed command with the current credential and expires the transport afterwards', async () => {
    const tokenCanary = 'skill-runtime-token-canary'
    const run = vi.fn<OpenContentCliProcessPort['run']>(async (request) => ({
      protocol: 'docflow-command-result:v1',
      command: request.invocation.command,
      ok: true,
      json: {},
      structuredDeliveryItems: [],
      managedDataFiles: []
    }))
    const connections = connectionService(tokenCanary)
    const session = createOpenContentSkillRuntimeSession({
      connections,
      processPort: { run },
      assets: { mode: 'source', assetRoot: assetFixture.assetRoot },
      site: 'https://provider.invalid'
    })
    let retainedTransport: OpenContentSkillRuntimeTransport | undefined

    const output = await session.useSkillRuntime({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_skill_runtime_0001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent: () => undefined
    }, async (transport) => {
      retainedTransport = transport
      return transport.invoke({
        invocationId: 'invocation_skill_runtime_read_0001',
        command: 'docflow-read',
        args: { fileId: 'file-a' },
        dataFiles: []
      })
    })

    expect(output).toMatchObject({ command: 'docflow-read', ok: true })
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0].connectionMaterial).toEqual({
      site: 'https://provider.invalid',
      systemUserToken: tokenCanary
    })
    expect(() => retainedTransport!.invoke({
      invocationId: 'invocation_skill_runtime_read_0002',
      command: 'docflow-read',
      args: { fileId: 'file-a' },
      dataFiles: []
    })).toThrow(expect.objectContaining({ code: 'unauthorized' }))
    expect(run).toHaveBeenCalledOnce()
  })

  it('rejects another Provider Instance before opening the credential session', async () => {
    const connections = connectionService('token-canary')
    const session = createOpenContentSkillRuntimeSession({
      connections,
      processPort: { run: vi.fn() },
      assets: { mode: 'source', assetRoot: assetFixture.assetRoot },
      site: 'https://provider.invalid'
    })

    await expect(session.useSkillRuntime({
      principal,
      providerInstanceRef: 'another-provider',
      invocationId: 'invocation_skill_runtime_0003',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent: () => undefined
    }, async () => undefined)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(connections.useCurrentSession).not.toHaveBeenCalled()
  })

  it('revalidates an async Host Principal lease before every CLI command and fails closed', async () => {
    const run = vi.fn<OpenContentCliProcessPort['run']>(async (request) => ({
      protocol: 'docflow-command-result:v1',
      command: request.invocation.command,
      ok: true,
      json: {},
      structuredDeliveryItems: [],
      managedDataFiles: []
    }))
    const session = createOpenContentSkillRuntimeSession({
      connections: connectionService('token-canary'),
      processPort: { run },
      assets: { mode: 'source', assetRoot: assetFixture.assetRoot },
      site: 'https://provider.invalid'
    })
    let principalIsCurrent = true
    const assertPrincipalCurrent = vi.fn(async () => {
      if (!principalIsCurrent) throw new Error('private Host Principal diagnostic')
    })

    const error = await session.useSkillRuntime({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_skill_runtime_principal_0001',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    }, async (transport) => {
      await transport.invoke({
        invocationId: 'invocation_skill_runtime_principal_read_0001',
        command: 'docflow-read',
        args: { fileId: 'file-a' },
        dataFiles: []
      })
      principalIsCurrent = false
      return transport.invoke({
        invocationId: 'invocation_skill_runtime_principal_write_0001',
        command: 'rename',
        args: { id: 'file-a', name: 'Renamed.mdoc' },
        dataFiles: []
      })
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'unauthorized' })
    expect(JSON.stringify(error)).not.toContain('private Host Principal diagnostic')
    expect(run).toHaveBeenCalledOnce()
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
  })
})

function connectionService(token: string): OpenContentConnectionService {
  return {
    status: vi.fn(),
    bindExistingAccount: vi.fn(),
    useCurrentToken: vi.fn(),
    useCurrentSession: vi.fn(async (_input, operation) => operation({
      token,
      externalIdentityId: 42
    })),
    unbind: vi.fn()
  }
}

function mainEntryFixture(appRoot: string, isPackaged = false): Readonly<{
  host: DomainMainHost
  registeredService(): OpenContentContentSpaceFacade | undefined
}> {
  let registeredService: OpenContentContentSpaceFacade | undefined
  const host: DomainMainHost = Object.freeze({
    getUserDataDir: () => resolve(appRoot, '.sciforge-test'),
    getAppRoot: () => appRoot,
    getExecutablePath: () => process.execPath,
    isPackaged: () => isPackaged,
    defineCapability: (options: unknown) => options,
    packageSettings: Object.freeze({
      read: vi.fn(async () => ({ revision: 0, value: null })),
      write: vi.fn(async (value) => ({ revision: 1, value })),
      clear: vi.fn(async () => ({ revision: 1, value: null }))
    }),
    packageSecrets: Object.freeze({
      has: vi.fn(async () => false),
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      providerCredentials: Object.freeze({
        status: vi.fn(async () => ({ state: 'absent' as const })),
        replace: vi.fn(async () => undefined),
        use: vi.fn(async () => {
          throw new Error('Credential access is outside this activation test.')
        }),
        remove: vi.fn(async () => undefined)
      })
    }),
    internalServices: Object.freeze({
      register<Service extends object>(
        registration: DomainMainInternalServiceRegistration<Service>
      ): void {
        registeredService = registration.service as OpenContentContentSpaceFacade
      },
      acquire<Service extends object>(): Service {
        throw new Error('Service acquisition is outside this activation test.')
      }
    })
  })
  return Object.freeze({
    host,
    registeredService: () => registeredService
  })
}

function createAssetFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-connector-assets-'))
  const assetRoot = resolve(root, 'source', 'opencontent-base-1.0.1')
  const repositoryRoot = resolve(root, 'repository')
  const repositoryOverlayAssetRoot = resolve(
    repositoryRoot,
    'internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1'
  )
  const incompleteRepositoryRoot = resolve(root, 'incomplete-repository')
  const incompleteRepositoryPackageRoot = resolve(
    incompleteRepositoryRoot,
    'internal/opencontent/packages/opencontent-skill-assets'
  )
  const incompleteRepositoryOverlayAssetRoot = resolve(
    incompleteRepositoryPackageRoot,
    'assets/opencontent-base-1.0.1'
  )
  mkdirSync(incompleteRepositoryPackageRoot, { recursive: true })
  const resourcesPath = resolve(root, 'resources')
  const packagedRoot = resolve(resourcesPath, 'opencontent', 'opencontent-base-1.0.1')
  const incompleteResourcesPath = resolve(root, 'incomplete-resources')
  mkdirSync(resolve(
    incompleteResourcesPath,
    'opencontent/opencontent-base-1.0.1'
  ), { recursive: true })
  const repositoryOverlayPackageRoot = resolve(
    repositoryRoot,
    'internal/opencontent/packages/opencontent-skill-assets'
  )
  mkdirSync(repositoryOverlayPackageRoot, { recursive: true })
  writeFileSync(resolve(repositoryOverlayPackageRoot, 'package.json'), JSON.stringify({
    name: '@sciforge-internal/opencontent-skill-assets',
    version: '1.0.1',
    private: true
  }), { mode: 0o644 })
  for (const base of [assetRoot, repositoryOverlayAssetRoot, packagedRoot]) {
    for (const relativePath of [
      'cli/bin/oc.js',
      'cli/docflow/docflow-node.cjs',
      'scripts/docflow-probe-compact.cjs',
      'runtime-patches/cli-auth-retry-single-attempt.v1.json'
    ]) {
      const target = resolve(base, ...relativePath.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, relativePath.endsWith('.json') ? '{}\n' : 'module.exports = {}\n', {
        mode: 0o644
      })
    }
  }
  return {
    assetRoot,
    repositoryRoot,
    repositoryOverlayAssetRoot,
    incompleteRepositoryRoot,
    incompleteRepositoryOverlayAssetRoot,
    resourcesPath,
    incompleteResourcesPath,
    root,
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}
