import { describe, expect, it } from 'vitest'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  defineInstalledDomainPackageSet,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk'
import {
  defineInstalledMainDomainEntrySet,
  installedMainDomainContributions
} from '@sciforge/domain-sdk/main'
import {
  defineInstalledRendererDomainEntrySet,
  installedRendererDomainContributions
} from '@sciforge/domain-sdk/renderer'
import { installedDomainPackages } from './installed-domain-packages'

const fixtureDomain: TrustedDomainPackageDefinitionInput = {
  contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
  kind: 'trusted-compile-time',
  packageName: '@fixture/domain-installation-probe',
  module: {
    id: 'fixture.domain-installation-probe',
    displayName: 'Domain Installation Probe',
    version: '1.0.0',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
    priority: 100
  },
  entrypoints: [
    {
      process: 'main',
      export: './main',
      contributions: [{
        id: 'fixture.domain-installation-probe.main',
        kind: 'fixture.unlisted-main-kind'
      }]
    },
    {
      process: 'renderer',
      export: './renderer',
      contributions: [{
        id: 'fixture.domain-installation-probe.renderer',
        kind: 'fixture.unlisted-renderer-kind'
      }]
    }
  ]
}

describe('installed domain package selection', () => {
  it('exposes one process-neutral source to main and renderer projections', () => {
    expect(installedDomainPackages.definitions.length).toBeGreaterThan(0)
    expect(new Set(installedDomainPackages.definitions.map(({ packageName }) => packageName)).size)
      .toBe(installedDomainPackages.definitions.length)
    for (const process of ['main', 'renderer'] as const) {
      const projected = process === 'main'
        ? installedMainDomainContributions(installedDomainPackages)
        : installedRendererDomainContributions(installedDomainPackages)
      const expected = installedDomainPackages.definitions.flatMap((definition) =>
        definition.entrypoints
          .filter((entrypoint) => entrypoint.process === process)
          .flatMap((entrypoint) => entrypoint.contributions.map((declaration) =>
            `${definition.module.id}:${declaration.kind}:${declaration.id}`
          ))
      ).sort()
      expect(projected.map(({ owner, declaration }) =>
        `${owner.moduleId}:${declaration.kind}:${declaration.id}`
      ).sort()).toEqual(expected)
    }
    expect(Object.isFrozen(installedDomainPackages)).toBe(true)
  })

  it('adds and removes package-owned main and renderer declarations together', () => {
    const installed = defineInstalledDomainPackageSet([fixtureDomain])
    const removed = defineInstalledDomainPackageSet([])

    expect(installedMainDomainContributions(installed).map(
      ({ declaration }) => declaration.kind
    )).toEqual(['fixture.unlisted-main-kind'])
    expect(installedRendererDomainContributions(installed).map(
      ({ declaration }) => declaration.kind
    )).toEqual(['fixture.unlisted-renderer-kind'])
    expect(installedMainDomainContributions(removed)).toEqual([])
    expect(installedRendererDomainContributions(removed)).toEqual([])
  })

  it('binds callable values independently in each process', () => {
    type MainValue = () => string
    type RendererValue = () => string
    const definitions = defineInstalledDomainPackageSet([fixtureDomain])
    const main = defineInstalledMainDomainEntrySet<MainValue>(definitions, [{
      definition: fixtureDomain,
      contributions: [{
        id: 'fixture.domain-installation-probe.main',
        kind: 'fixture.unlisted-main-kind',
        value: () => 'main-value'
      }]
    }])
    const renderer = defineInstalledRendererDomainEntrySet<RendererValue>(definitions, [{
      definition: fixtureDomain,
      contributions: [{
        id: 'fixture.domain-installation-probe.renderer',
        kind: 'fixture.unlisted-renderer-kind',
        value: () => 'renderer-value'
      }]
    }])
    const removed = defineInstalledDomainPackageSet([])

    expect(main.contributions[0]?.value()).toBe('main-value')
    expect(renderer.contributions[0]?.value()).toBe('renderer-value')
    expect(defineInstalledMainDomainEntrySet<MainValue>(removed, []).contributions).toEqual([])
    expect(defineInstalledRendererDomainEntrySet<RendererValue>(removed, []).contributions).toEqual([])
  })
})
