import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'

import {
  domainMainPowerLeaseRequestSchema,
  type DomainMainPowerHost
} from './power.js'

describe('power lease host contract', () => {
  it('acquires and releases a package-owned keep-awake lease', async () => {
    let releases = 0
    const host: DomainMainPowerHost = {
      acquire: async (request) => {
        assert.equal(request.reason, 'Create Loop workflow is running')
        return {
          release: () => {
            releases += 1
          }
        }
      }
    }

    const lease = await host.acquire(domainMainPowerLeaseRequestSchema.parse({
      reason: 'Create Loop workflow is running'
    }))
    await lease.release()
    assert.equal(releases, 1)
  })

  it('rejects a blank reason and package-selected blocker implementation', () => {
    assert.throws(() => domainMainPowerLeaseRequestSchema.parse({
      reason: '  '
    }), z.ZodError)
    assert.throws(() => domainMainPowerLeaseRequestSchema.parse({
      reason: 'Workflow is running',
      blockerType: 'prevent-display-sleep'
    }), z.ZodError)
  })
})
