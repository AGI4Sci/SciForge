import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import type {
  DomainMainHost,
  DomainMainInternalServiceRegistration
} from '@sciforge/domain-sdk/host'
import {
  canonicalJson,
  createStaticFileInventory,
  digestInventory
} from '@sciforge/internal-runtime-integrity'
import type {
  OpenContentCliProcessPort
} from '@sciforge/opencontent-skill-runtime/main/cli-runner'
import {
  assertOpenContentSkillBundledAssetsPresent,
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR
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
const bindingAttestation = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})
const assetFixture = createAssetFixture()
afterAll(() => assetFixture.dispose())

describe('OpenContent main-only skill runtime session', () => {
  it('prefers the fixed source repository overlay over a shadow private package', () => {
    expect(existsSync(resolve(
      assetFixture.repositoryRoot,
      'node_modules/@sciforge-internal/opencontent-skill-assets'
    ))).toBe(true)
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

  it('revalidates the source receipt before the first attachment dispatch', async () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-dispatch-drift-'))
    const run = vi.fn()
    try {
      cpSync(assetFixture.repositoryRoot, repositoryRoot, { recursive: true })
      const entry = mainEntryFixture(repositoryRoot)
      createDomainMainEntry(entry.host, { skillRuntime: { processPort: { run } } })
      writeFileSync(resolve(
        repositoryRoot,
        'internal/opencontent/packages/opencontent-skill-assets/assets/',
        'opencontent-base-1.0.1/cli/bin/oc.js'
      ), 'module.exports = { driftedAfterActivation: true }\n', { mode: 0o644 })

      await expect(entry.registeredService()!.useSkillRuntime!({
        principal,
        providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
        invocationId: 'invocation_skill_runtime_dispatch_drift_0001',
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        signal: new AbortController().signal,
        assertPrincipalCurrent: () => undefined
      }, async (transport) => transport.invoke({
        invocationId: 'invocation_skill_runtime_dispatch_drift_read_0001',
        command: 'docflow-read',
        args: { fileId: 'file-a' },
        dataFiles: []
      }))).rejects.toThrow(/changed file/u)
      expect(run).not.toHaveBeenCalled()
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('leaves the optional source runtime disabled when the repository overlay is absent', () => {
    expect(resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => assetFixture.shadowOnlyRepositoryRoot,
      isPackaged: () => false
    })).toBeUndefined()
  })

  it('fails source resolution closed when the optional overlay path is a broken symlink', () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-broken-link-'))
    try {
      mkdirSync(resolve(repositoryRoot, 'internal'), { recursive: true })
      symlinkSync(
        resolve(repositoryRoot, 'missing-opencontent-overlay'),
        resolve(repositoryRoot, 'internal/opencontent'),
        'dir'
      )

      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => repositoryRoot,
        isPackaged: () => false
      })).toThrow()
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails source resolution closed when the fixed repository overlay is unreceipted', () => {
    expect(() => resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => assetFixture.unreceiptedRepositoryRoot,
      isPackaged: () => false
    })).toThrow(/receipt/u)
  })

  it('fails source resolution closed when a receipted runtime byte changes', () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-changed-'))
    try {
      cpSync(assetFixture.repositoryRoot, repositoryRoot, { recursive: true })
      writeFileSync(resolve(
        repositoryRoot,
        'internal/opencontent/packages/opencontent-skill-assets/assets/',
        'opencontent-base-1.0.1/cli/bin/oc.js'
      ), 'module.exports = { changed: true }\n', { mode: 0o644 })

      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => repositoryRoot,
        isPackaged: () => false
      })).toThrow(/changed file/u)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails Connector activation closed when a receipted asset package is missing', () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-missing-'))
    try {
      cpSync(assetFixture.repositoryRoot, repositoryRoot, { recursive: true })
      rmSync(resolve(
        repositoryRoot,
        'internal/opencontent/packages/opencontent-skill-assets'
      ), { recursive: true })
      const entry = mainEntryFixture(repositoryRoot)

      expect(() => createDomainMainEntry(entry.host, {
        skillRuntime: { processPort: { run: vi.fn() } }
      })).toThrow(/missing file/u)
      expect(entry.registeredService()).toBeUndefined()
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails source resolution closed when the overlay gains an unreceipted file', () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-extra-'))
    try {
      cpSync(assetFixture.repositoryRoot, repositoryRoot, { recursive: true })
      writeFileSync(
        resolve(repositoryRoot, 'internal/opencontent/unreceipted.txt'),
        'unreceipted\n',
        { mode: 0o644 }
      )

      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => repositoryRoot,
        isPackaged: () => false
      })).toThrow(/unreceipted file/u)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('fails source resolution closed when the receipt version changes', () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-version-'))
    try {
      cpSync(assetFixture.repositoryRoot, repositoryRoot, { recursive: true })
      writeOverlayReceipt(repositoryRoot, '1.0.2')

      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => repositoryRoot,
        isPackaged: () => false
      })).toThrow(/package-owned provenance/u)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('rejects a self-consistent rewritten overlay receipt without pinned provenance', () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-forged-receipt-'))
    try {
      cpSync(assetFixture.repositoryRoot, repositoryRoot, { recursive: true })
      writeFileSync(resolve(
        repositoryRoot,
        'internal/opencontent/packages/opencontent-skill-assets/assets/',
        'opencontent-base-1.0.1/cli/bin/oc.js'
      ), 'module.exports = { rewritten: true }\n', { mode: 0o644 })
      writeOverlayReceipt(repositoryRoot, '1.0.1', 'f'.repeat(64))

      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => repositoryRoot,
        isPackaged: () => false
      })).toThrow(/provenance/u)
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('requires the Host-injected source repository root to be absolute', () => {
    expect(() => resolveOpenContentSkillRuntimeAssets({
      getAppRoot: () => 'relative/repository',
      isPackaged: () => false
    })).toThrow(/absolute repository root/u)
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

  it('fails packaged resolution closed for a residual or dangling runtime namespace', () => {
    const resourcesPath = mkdtempSync(resolve(tmpdir(), 'sciforge-opencontent-packaged-residue-'))
    try {
      mkdirSync(resolve(resourcesPath, 'opencontent'), { recursive: true })
      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => resolve(resourcesPath, 'app.asar'),
        isPackaged: () => true
      })).toThrow('Bundled OpenContent assets are unavailable or invalid.')

      rmSync(resolve(resourcesPath, 'opencontent'), { recursive: true, force: true })
      symlinkSync(
        resolve(resourcesPath, 'missing-opencontent-runtime'),
        resolve(resourcesPath, 'opencontent'),
        'dir'
      )
      expect(() => resolveOpenContentSkillRuntimeAssets({
        getAppRoot: () => resolve(resourcesPath, 'app.asar'),
        isPackaged: () => true
      })).toThrow('Bundled OpenContent assets are unavailable or invalid.')
    } finally {
      rmSync(resourcesPath, { recursive: true, force: true })
    }
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
      expectedBindingAttestation: bindingAttestation,
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
    expect(connections.useCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({ expectedBindingAttestation: bindingAttestation }),
      expect.any(Function)
    )
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
    attestExternalBinding: vi.fn(async () => bindingAttestation),
    bindExistingAccount: vi.fn(),
    useCurrentToken: vi.fn(),
    useCurrentSession: vi.fn(async (_input, operation) => operation({
      token,
      externalIdentityId: 42,
      bindingAttestation
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
  const repositoryShadowAssetRoot = resolve(
    repositoryRoot,
    'node_modules/@sciforge-internal/opencontent-skill-assets/assets/opencontent-base-1.0.1'
  )
  const shadowOnlyRepositoryRoot = resolve(root, 'repository-with-shadow-only')
  const shadowOnlyAssetRoot = resolve(
    shadowOnlyRepositoryRoot,
    'node_modules/@sciforge-internal/opencontent-skill-assets/assets/opencontent-base-1.0.1'
  )
  const unreceiptedRepositoryRoot = resolve(root, 'unreceipted-repository')
  const unreceiptedRepositoryAssetRoot = resolve(
    unreceiptedRepositoryRoot,
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
  const privatePackageManifest = JSON.stringify({
    name: '@sciforge-internal/opencontent-skill-assets',
    version: '1.0.1',
    private: true,
    sciforgeInternal: {
      distribution: 'internal-only',
      activation: { process: 'main' },
      installationEvidence: {
        overlayId: 'opencontent-attachment-assets',
        overlayRoot: 'internal/opencontent'
      },
      packaging: {
        assets: [{
          root: 'assets/opencontent-base-1.0.1',
          packagedResourcesPath: 'opencontent/opencontent-base-1.0.1',
          requiredPaths: [
            'package.json',
            'cli/bin/oc.js',
            'cli/docflow/docflow-node.cjs',
            'scripts/docflow-probe-compact.cjs',
            'runtime-patches/cli-auth-retry-single-attempt.v1.json'
          ]
        }]
      }
    }
  })
  writeFileSync(resolve(repositoryOverlayPackageRoot, 'package.json'), privatePackageManifest, {
    mode: 0o644
  })
  writeFileSync(resolve(incompleteRepositoryPackageRoot, 'package.json'), privatePackageManifest, {
    mode: 0o644
  })
  writeOverlayReceipt(incompleteRepositoryRoot)
  for (const shadowAssetRoot of [repositoryShadowAssetRoot, shadowOnlyAssetRoot]) {
    const shadowPackageRoot = resolve(shadowAssetRoot, '../..')
    mkdirSync(shadowPackageRoot, { recursive: true })
    writeFileSync(resolve(shadowPackageRoot, 'package.json'), privatePackageManifest, {
      mode: 0o644
    })
  }
  for (const base of [
    assetRoot,
    repositoryOverlayAssetRoot,
    repositoryShadowAssetRoot,
    shadowOnlyAssetRoot,
    unreceiptedRepositoryAssetRoot,
    packagedRoot
  ]) {
    for (const relativePath of [
      'package.json',
      'cli/bin/oc.js',
      'cli/docflow/docflow-node.cjs',
      'scripts/docflow-probe-compact.cjs',
      'runtime-patches/cli-auth-retry-single-attempt.v1.json'
    ]) {
      const target = resolve(base, ...relativePath.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, relativePath.endsWith('.json')
        ? '{"type":"commonjs"}\n'
        : 'module.exports = {}\n', {
        mode: 0o644
      })
    }
  }
  writeOverlayReceipt(repositoryRoot)
  return {
    assetRoot,
    repositoryRoot,
    repositoryOverlayAssetRoot,
    shadowOnlyRepositoryRoot,
    unreceiptedRepositoryRoot,
    incompleteRepositoryRoot,
    incompleteRepositoryOverlayAssetRoot,
    resourcesPath,
    incompleteResourcesPath,
    root,
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}

function writeOverlayReceipt(
  repositoryRoot: string,
  version = '1.0.1',
  archiveSha256 = OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.installation.archiveSha256
): void {
  const overlayId = 'opencontent-attachment-assets'
  const overlayRoot = 'internal/opencontent'
  const files = createStaticFileInventory({
    label: 'OpenContent Connector source fixture',
    rootPath: resolve(repositoryRoot, overlayRoot),
    rootPrefix: overlayRoot
  })
  const inventorySha256 = digestInventory({ files, overlayId, overlayRoot, version })
  const receiptPath = resolve(
    repositoryRoot,
    `.sciforge/internal-overlays/${overlayId}.json`
  )
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, canonicalJson({
    archiveRoot: `sciforge-internal-overlay-${overlayId}-${version}`,
    archiveSha256,
    files,
    inventorySha256,
    overlayId,
    overlayRoot,
    schemaVersion: 2,
    version
  }), { mode: 0o644 })
}
