import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'

import { ProjectCoordinatorStateStore } from './state.js'

describe('ProjectCoordinatorStateStore schema boundary', () => {
  it('rejects schema v2 without rewriting package settings', async () => {
    const settings = memorySettings({
      schemaVersion: 2,
      planDrafts: [],
      coordinatorSessionBindings: [],
      coordinatorTransferFeedback: [],
      projectCreateIntents: [],
      pendingProjectActivations: []
    })
    const store = new ProjectCoordinatorStateStore(settings.host)

    await assert.rejects(
      store.readCoordinatorSessionBindings(),
      /not schema version 3; clear the obsolete local state before reconnecting to Cloud/u
    )
    assert.equal(settings.writes(), 0)
  })
})

function memorySettings(initial: unknown): Readonly<{
  host: DomainMainPackageSettingsHost
  writes(): number
}> {
  let revision = 1
  let value = structuredClone(initial) as Awaited<
    ReturnType<DomainMainPackageSettingsHost['read']>
  >['value']
  let writes = 0
  return {
    host: {
      read: async () => ({ revision, value }),
      write: async (next, expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = next
        revision += 1
        writes += 1
        return { revision, value }
      },
      clear: async (expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = null
        revision += 1
        writes += 1
        return { revision, value }
      }
    },
    writes: () => writes
  }
}
