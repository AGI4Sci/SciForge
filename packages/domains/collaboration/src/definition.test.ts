import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

import { domainMainRuntimeLifecycleContractSchema } from '@sciforge/domain-sdk/host'

import {
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT,
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

describe('Collaboration domain package definition', () => {
  it('requires the Session attachment Host API and Domain SDK release', async () => {
    assert.deepEqual(domainPackageDefinition.module.hostApi, {
      minimum: '1.13.0',
      maximumExclusive: '2.0.0'
    })
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { dependencies: Record<string, string> }
    assert.equal(packageJson.dependencies['@sciforge/domain-sdk'], '^0.2.24')
  })

  it('requests no Provider system capability grant through its packaged lifecycle contract', () => {
    assert.equal(
      COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION.kind,
      'main.runtime-lifecycle'
    )
    assert.deepEqual(
      domainMainRuntimeLifecycleContractSchema.parse(
        COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT
      ).requestedSystemCapabilityGrants,
      []
    )
    assert.equal(
      domainPackageDefinition.entrypoints
        .find(({ process }) => process === 'main')
        ?.contributions.some(({ id }) => (
          id === COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION.id
        )),
      true
    )
  })
})
