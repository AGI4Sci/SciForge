import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  type TrustedDomainPackageDefinitionInput
} from './contract.js'
import { defineInstalledDomainPackageSet } from './installed-set.js'
import {
  TrustedDomainProcessEntryError,
  defineInstalledDomainProcessEntrySet
} from './process-entry.js'

const definition: TrustedDomainPackageDefinitionInput = {
  contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
  kind: 'trusted-compile-time',
  packageName: '@fixture/domain-process-probe',
  module: {
    id: 'fixture.domain-process-probe',
    displayName: 'Domain Process Probe',
    version: '1.0.0',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
    priority: 100
  },
  entrypoints: [
    {
      process: 'main',
      export: './main',
      contributions: [{
        id: 'fixture.domain-process-probe.handler',
        kind: 'fixture.callable-handler'
      }]
    },
    {
      process: 'renderer',
      export: './renderer',
      contributions: [{
        id: 'fixture.domain-process-probe.renderer',
        kind: 'fixture.callable-renderer'
      }]
    },
    {
      process: 'workspace-server',
      export: './workspace-server',
      contributions: [{
        id: 'fixture.domain-process-probe.workspace-server',
        kind: 'fixture.callable-workspace-server'
      }]
    }
  ]
}

describe('process-separated installed domain entries', () => {
  it('binds and calls actual values without a cross-process bundle', () => {
    const installed = defineInstalledDomainPackageSet([definition])
    const main = defineInstalledDomainProcessEntrySet(installed, 'main', [{
      definition,
      contributions: [{
        id: 'fixture.domain-process-probe.handler',
        kind: 'fixture.callable-handler',
        value: () => 'main-called'
      }]
    }])
    const renderer = defineInstalledDomainProcessEntrySet(installed, 'renderer', [{
      definition,
      contributions: [{
        id: 'fixture.domain-process-probe.renderer',
        kind: 'fixture.callable-renderer',
        value: (name: string) => ({ rendered: name })
      }]
    }])
    const workspaceServer = defineInstalledDomainProcessEntrySet(installed, 'workspace-server', [{
      definition,
      contributions: [{
        id: 'fixture.domain-process-probe.workspace-server',
        kind: 'fixture.callable-workspace-server',
        value: (path: string) => ({ observed: path })
      }]
    }])

    assert.equal(main.contributions[0]?.value(), 'main-called')
    assert.deepEqual(renderer.contributions[0]?.value('fixture'), { rendered: 'fixture' })
    assert.deepEqual(workspaceServer.contributions[0]?.value('/remote/data'), {
      observed: '/remote/data'
    })
    assert.equal(main.entries[0]?.process, 'main')
    assert.equal(renderer.entries[0]?.process, 'renderer')
    assert.equal(workspaceServer.entries[0]?.process, 'workspace-server')
  })

  it('removes each process projection when its authoritative definition is removed', () => {
    const removed = defineInstalledDomainPackageSet([])
    assert.deepEqual(defineInstalledDomainProcessEntrySet(removed, 'main', []).entries, [])
    assert.deepEqual(defineInstalledDomainProcessEntrySet(removed, 'renderer', []).entries, [])
    assert.deepEqual(
      defineInstalledDomainProcessEntrySet(removed, 'workspace-server', []).entries,
      []
    )
  })

  it('rejects missing, unexpected, or mismatched process entries', () => {
    const installed = defineInstalledDomainPackageSet([definition])
    assert.throws(
      () => defineInstalledDomainProcessEntrySet(installed, 'main', []),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'missing_process_entry'
    )
    assert.throws(
      () => defineInstalledDomainProcessEntrySet(defineInstalledDomainPackageSet([]), 'main', [{
        definition,
        contributions: [{
          id: 'fixture.domain-process-probe.handler',
          kind: 'fixture.callable-handler',
          value: () => 'unexpected'
        }]
      }]),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'unexpected_process_entry'
    )
    assert.throws(
      () => defineInstalledDomainProcessEntrySet(installed, 'main', [{
        definition,
        contributions: [{
          id: 'fixture.domain-process-probe.other-handler',
          kind: 'fixture.callable-handler',
          value: () => 'wrong'
        }]
      }]),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'runtime_contribution_mismatch'
    )
  })

  it('binds runtime values to the definition canonical contribution contract', () => {
    const canonicalDefinition: TrustedDomainPackageDefinitionInput = {
      ...definition,
      contributionContracts: {
        'fixture.domain-process-probe.handler': {
          slot: 'fixture',
          version: 1
        }
      }
    }
    const installed = defineInstalledDomainPackageSet([canonicalDefinition])
    const matchingContract = { version: 1, slot: 'fixture' }
    const entry = defineInstalledDomainProcessEntrySet(installed, 'main', [{
      definition: canonicalDefinition,
      contributions: [{
        id: 'fixture.domain-process-probe.handler',
        kind: 'fixture.callable-handler',
        contract: matchingContract,
        value: () => 'bound'
      }]
    }])

    assert.deepEqual(entry.contributions[0]?.contract, matchingContract)
    assert.throws(
      () => defineInstalledDomainProcessEntrySet(installed, 'main', [{
        definition: canonicalDefinition,
        contributions: [{
          id: 'fixture.domain-process-probe.handler',
          kind: 'fixture.callable-handler',
          contract: { slot: 'drifted', version: 1 },
          value: () => 'unbound'
        }]
      }]),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'runtime_contribution_contract_mismatch'
    )
  })

  it('rejects renderer entries that are incompatible with the host API', () => {
    const incompatibleDefinition: TrustedDomainPackageDefinitionInput = {
      ...definition,
      module: {
        ...definition.module,
        hostApi: { minimum: '2.0.0', maximumExclusive: '3.0.0' }
      }
    }
    const installed = defineInstalledDomainPackageSet([incompatibleDefinition])

    assert.throws(
      () => defineInstalledDomainProcessEntrySet(installed, 'renderer', [{
        definition: incompatibleDefinition,
        contributions: [{
          id: 'fixture.domain-process-probe.renderer',
          kind: 'fixture.callable-renderer',
          value: () => 'renderer'
        }]
      }]),
      (error) => error instanceof TrustedDomainProcessEntryError &&
        error.code === 'incompatible_host_api'
    )
  })
})
