import { defineTrustedDomainPackage } from '@sciforge/domain-sdk'
import { describe, expect, it, vi } from 'vitest'
import type {
  InstalledExtensionPackage,
  InstalledExtensionStatus
} from './types'
import { createDomainExtensionsApi } from './domain-extensions-api'

const bundledDefinition = defineTrustedDomainPackage({
  contractVersion: 1,
  kind: 'trusted-compile-time',
  packageName: '@sciforge/domain-bundled',
  publisher: { id: 'sciforge', displayName: 'SciForge' },
  module: {
    id: 'sciforge.bundled',
    displayName: 'Bundled',
    version: '1.0.0',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
    priority: 100
  },
  contributionContracts: {},
  entrypoints: [{
    process: 'renderer',
    export: './renderer',
    contributions: [{
      id: 'sciforge.bundled.panel',
      kind: 'renderer.workbench-right-panel',
      priority: 100
    }]
  }]
})

const installedRecord: InstalledExtensionPackage = {
  packageName: '@sciforge/domain-runtime',
  moduleId: 'sciforge.runtime',
  publisherId: 'sciforge',
  publisherDisplayName: 'SciForge',
  displayName: 'Runtime',
  enabled: true,
  activeVersion: '1.1.0',
  versions: [
    installedVersion('1.0.0'),
    installedVersion('1.1.0')
  ]
}

function installedVersion(version: string) {
  return {
    version,
    installedAt: '2026-07-27T00:00:00.000Z',
    integritySha256: 'a'.repeat(64),
    signer: {
      publisherId: 'sciforge',
      keyId: 'official-test-key',
      trust: 'official' as const,
      algorithm: 'ed25519' as const
    },
    executionSecurity: {
      trust: 'official' as const,
      codeIsolation: 'extension-host' as const,
      rendererIsolation: 'sandboxed-webview' as const,
      capabilityAccess: 'brokered' as const,
      thirdPartyReady: true as const
    },
    runtime: {
      kind: 'sandboxed-runtime' as const,
      requestedPermissions: [{
        id: 'host.workspace.read',
        process: 'main' as const,
        reason: 'Read selected workspace data.',
        required: true
      }],
      entrypoints: [{
        process: 'main' as const,
        isolation: 'extension-host' as const,
        entry: 'dist/main.mjs',
        format: 'module' as const,
        contributions: [{
          id: 'sciforge.runtime.capability',
          kind: 'main.capability-factory',
          priority: 100
        }]
      }]
    }
  }
}

function readyStatus(record = installedRecord): InstalledExtensionStatus {
  const active = record.versions.find((version) => version.version === record.activeVersion)!
  return {
    package: record,
    active,
    installPath: '/tmp/extensions/runtime',
    health: 'ready'
  }
}

function store(overrides: Record<string, unknown> = {}) {
  return {
    install: vi.fn(),
    list: vi.fn(async () => [installedRecord]),
    status: vi.fn(async () => readyStatus()),
    setEnabled: vi.fn(),
    rollback: vi.fn(),
    uninstall: vi.fn(),
    ...overrides
  }
}

describe('createDomainExtensionsApi', () => {
  it('combines publisher-owned bundled packages with verified installed records', async () => {
    const api = createDomainExtensionsApi({
      bundledDefinitions: [bundledDefinition],
      store: store() as never
    })

    await expect(api.list()).resolves.toEqual([
      expect.objectContaining({
        packageName: '@sciforge/domain-bundled',
        source: 'bundled',
        status: 'active',
        canRollback: false
      }),
      expect.objectContaining({
        packageName: '@sciforge/domain-runtime',
        source: 'user',
        verification: 'official-signed',
        status: 'installed',
        canRollback: true,
        contributionCount: 1,
        permissions: ['host.workspace.read']
      })
    ])
  })

  it('blocks configured installation failures before reading an artifact', async () => {
    const extensionStore = store()
    const api = createDomainExtensionsApi({
      bundledDefinitions: [bundledDefinition],
      store: extensionStore as never,
      installationBlockedReason: 'No official signing keys are configured.'
    })

    await expect(api.install({ path: '/tmp/example.sciforge-plugin' }))
      .rejects.toThrow('No official signing keys are configured.')
    expect(extensionStore.install).not.toHaveBeenCalled()
  })

  it('surfaces store rejection for a runtime artifact that collides with a bundled identity', async () => {
    const extensionStore = store({
      install: vi.fn(async () => {
        throw new Error('Extension package is reserved by the application bundle.')
      })
    })
    const api = createDomainExtensionsApi({
      bundledDefinitions: [bundledDefinition],
      store: extensionStore as never
    })

    await expect(api.install({ path: '/tmp/collision.sciforge-plugin' }))
      .rejects.toThrow('reserved by the application bundle')
    expect(extensionStore.install).toHaveBeenCalledOnce()
  })
})
