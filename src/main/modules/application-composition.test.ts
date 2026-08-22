import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
  isDomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import { IDENTITY_ACCESS_DOMAIN_MODULE_ID } from '@sciforge/domain-identity-access/definition'
import { installedDomainPackages } from '../../shared/installed-domain-packages'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from './application-composition'
import {
  MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
  isAppCapabilityContributionFactory,
  listMainCapabilityDomainPolicies
} from './main-contributions'
import { createNonSecretPackageStorageForTest } from './domain-package-storage.test-helper'

describe('application domain composition', () => {
  it('composes explicit host-core and installed package capabilities through one catalog', () => {
    const packageInvokerOwners: Array<{ moduleId: string; moduleVersion: string }> = []
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => '/tmp/sciforge-domain-composition-test',
      packageStorageFor: createNonSecretPackageStorageForTest(),
      capabilityInvokerFor: (owner) => {
        packageInvokerOwners.push(owner)
        return Object.freeze({
          invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') }
        })
      }
    })
    const packages = catalog.listPackages()

    expect(packages.map((definition) => definition.packageName)).toEqual([
      '@sciforge/core-controlled-process',
      '@sciforge/core-surface',
      '@sciforge/core-version-control',
      '@sciforge/core-workspace-preview',
      ...installedDomainPackages.definitions
        .filter((definition) => definition.entrypoints.some(({ process }) => process === 'main'))
        .map((definition) => definition.packageName)
    ])
    expect([...packageInvokerOwners].sort((left, right) => left.moduleId.localeCompare(right.moduleId))).toEqual(
      installedDomainPackages.definitions
        .filter((definition) => definition.entrypoints.some(({ process }) => process === 'main'))
        .map((definition) => ({
          moduleId: definition.module.id,
          moduleVersion: definition.module.version
        }))
        .sort((left, right) => left.moduleId.localeCompare(right.moduleId))
    )
    expect(packageInvokerOwners.every((owner) => Object.isFrozen(owner))).toBe(true)
    expect(new Set(packageInvokerOwners.map(({ moduleId }) => moduleId)).size)
      .toBe(packageInvokerOwners.length)
    const factories = catalog.listContributions(
      MAIN_CAPABILITY_FACTORY_CONTRIBUTION_KIND,
      isAppCapabilityContributionFactory
    )
    expect(factories.every((contribution) =>
      contribution.owner.moduleId === contribution.value.moduleId
    )).toBe(true)

    const dependencies = unavailableDependencies()
    const expectedCapabilityIds = factories.flatMap(({ value }) =>
      value.createDefinitions(dependencies).map(({ descriptor }) => descriptor.id)
    ).sort()
    const registry = createApplicationCapabilityRegistry(catalog, dependencies)
    expect(registry.list().map((descriptor) => descriptor.id)).toEqual(
      expectedCapabilityIds
    )
    expect(listMainCapabilityDomainPolicies(catalog).map((policy) => policy.id)).toEqual(
      factories.map(({ value }) => value.policy.id)
    )

    catalog.dispose()
  })

  it('passes the canonical Host application version into packaged Identity activation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sciforge-domain-host-version-'))
    let appVersionReads = 0
    const catalog = createApplicationDomainCatalog({
      getUserDataDir: () => root,
      getDeviceId: () => 'device-composition-test',
      getAppVersion: () => {
        appVersionReads += 1
        return '9.8.7-host'
      },
      getAppRoot: () => join(root, 'missing-packaged-app-root'),
      isPackaged: () => true,
      packageStorageFor: createNonSecretPackageStorageForTest(),
      capabilityInvokerFor: () => ({
        invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') }
      })
    })
    const lifecycle = catalog.listContributions(
      MAIN_RUNTIME_LIFECYCLE_CONTRIBUTION_KIND,
      isDomainMainRuntimeLifecycleContribution
    ).find(({ owner }) => owner.moduleId === IDENTITY_ACCESS_DOMAIN_MODULE_ID)
    let dispose: (() => void | Promise<void>) | undefined

    try {
      expect(lifecycle).toBeDefined()
      dispose = await lifecycle!.value.activate({
        userDataDir: root,
        appRoot: join(root, 'missing-packaged-app-root'),
        environment: {},
        signal: new AbortController().signal
      } as never) as (() => void | Promise<void>) | undefined
      expect(appVersionReads).toBe(1)
    } finally {
      await dispose?.()
      catalog.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function unavailableDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, {
    get: () => unavailable
  }) as AppCapabilityDependencies
}
