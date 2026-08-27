import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { domainMainRuntimeLifecycleContractSchema } from '@sciforge/domain-sdk/host'
import { CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID } from '@sciforge/domain-content-space/contract'

import {
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT,
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

describe('Collaboration domain package definition', () => {
  it('requests only the Content Space transfer grant through its packaged lifecycle contract', () => {
    assert.equal(
      COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION.kind,
      'main.runtime-lifecycle'
    )
    assert.deepEqual(
      domainMainRuntimeLifecycleContractSchema.parse(
        COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT
      ).requestedSystemCapabilityGrants,
      [CONTENT_SPACE_SYSTEM_TRANSFER_GRANT_ID]
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
