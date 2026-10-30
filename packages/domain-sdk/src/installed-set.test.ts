import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinitionInput
} from './contract.js'
import {
  InstalledDomainPackageSetError,
  defineInstalledDomainPackageSet
} from './installed-set.js'
import { installedMainDomainContributions } from './main.js'
import { installedRendererDomainContributions } from './renderer.js'
import { installedWorkspaceServerDomainContributions } from './workspace-server.js'

const fixtureDefinition: TrustedDomainPackageDefinitionInput = {
  contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
  kind: 'trusted-compile-time',
  packageName: '@fixture/domain-probe',
  module: {
    id: 'fixture.domain-probe',
    displayName: 'Fixture Domain Probe',
    version: '1.2.3',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
    priority: 200
  },
  entrypoints: [
    {
      process: 'main',
      export: './main',
      contributions: [{
        id: 'fixture.domain-probe.main-probe',
        kind: 'fixture.unlisted-main-kind',
        priority: 20
      }]
    },
    {
      process: 'renderer',
      export: './renderer',
      contributions: [{
        id: 'fixture.domain-probe.renderer-probe',
        kind: 'fixture.unlisted-renderer-kind',
        priority: 10
      }]
    },
    {
      process: 'workspace-server',
      export: './workspace-server',
      contributions: [{
        id: 'fixture.domain-probe.workspace-server-probe',
        kind: 'fixture.unlisted-workspace-server-kind',
        priority: 5
      }]
    }
  ]
}

describe('trusted compile-time domain packages', () => {
  it('projects package addition and removal into both process sets without a feature map', () => {
    const withoutFixture = defineInstalledDomainPackageSet([])
    const withFixture = defineInstalledDomainPackageSet([fixtureDefinition])

    assert.deepEqual(installedMainDomainContributions(withoutFixture), [])
    assert.deepEqual(installedRendererDomainContributions(withoutFixture), [])
    assert.deepEqual(installedWorkspaceServerDomainContributions(withoutFixture), [])

    const main = installedMainDomainContributions(withFixture)
    const renderer = installedRendererDomainContributions(withFixture)
    const workspaceServer = installedWorkspaceServerDomainContributions(withFixture)
    assert.deepEqual(main.map((item) => item.declaration.kind), [
      'fixture.unlisted-main-kind'
    ])
    assert.deepEqual(renderer.map((item) => item.declaration.kind), [
      'fixture.unlisted-renderer-kind'
    ])
    assert.deepEqual(workspaceServer.map((item) => item.declaration.kind), [
      'fixture.unlisted-workspace-server-kind'
    ])
    assert.equal(main[0]?.entrypoint, './main')
    assert.equal(renderer[0]?.entrypoint, './renderer')
    assert.equal(workspaceServer[0]?.entrypoint, './workspace-server')
    assert.deepEqual(main[0]?.owner, {
      moduleId: 'fixture.domain-probe',
      moduleVersion: '1.2.3'
    })
    assert.deepEqual(renderer[0]?.owner, main[0]?.owner)
    assert.deepEqual(workspaceServer[0]?.owner, main[0]?.owner)
  })

  it('keeps definitions and projected metadata immutable', () => {
    const definition = defineTrustedDomainPackage(fixtureDefinition)
    const installed = defineInstalledDomainPackageSet([definition])

    assert.equal(Object.isFrozen(definition), true)
    assert.equal(Object.isFrozen(definition.entrypoints), true)
    assert.equal(Object.isFrozen(installed), true)
    assert.equal(Object.isFrozen(installed.definitions), true)
    assert.equal(Object.isFrozen(installedMainDomainContributions(installed)), true)
    assert.equal(Object.isFrozen(installedMainDomainContributions(installed)[0]?.owner), true)
  })

  it('requires fixed process-separated package exports', () => {
    assert.throws(
      () => defineTrustedDomainPackage({
        ...fixtureDefinition,
        entrypoints: [{
          process: 'main',
          export: './renderer',
          contributions: []
        }]
      } as unknown as TrustedDomainPackageDefinitionInput),
      z.ZodError
    )

    assert.throws(
      () => defineTrustedDomainPackage({
        ...fixtureDefinition,
        entrypoints: [
          fixtureDefinition.entrypoints[0]!,
          fixtureDefinition.entrypoints[0]!
        ]
      }),
      z.ZodError
    )
  })

  it('rejects duplicate modules and process contribution keys before projection', () => {
    const otherPackageSameModule: TrustedDomainPackageDefinitionInput = {
      ...fixtureDefinition,
      packageName: '@fixture/domain-probe-copy'
    }
    assert.throws(
      () => defineInstalledDomainPackageSet([
        fixtureDefinition,
        otherPackageSameModule
      ]),
      (error) => error instanceof InstalledDomainPackageSetError &&
        error.code === 'duplicate_module'
    )

    const otherModuleSameContribution: TrustedDomainPackageDefinitionInput = {
      ...fixtureDefinition,
      packageName: '@fixture/other-domain',
      module: {
        ...fixtureDefinition.module,
        id: 'fixture.other-domain',
        displayName: 'Other Fixture Domain'
      }
    }
    assert.throws(
      () => defineInstalledDomainPackageSet([
        fixtureDefinition,
        otherModuleSameContribution
      ]),
      (error) => error instanceof InstalledDomainPackageSetError &&
        error.code === 'duplicate_contribution'
    )
  })
})
