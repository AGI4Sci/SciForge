import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDomainMainEntry,
  type PaperRadarCapabilityOptions,
  type PaperRadarWorkerService
} from './main.js'
import { domainPackageDefinition } from './definition.js'

test('creates raw main domain input with lazy service ownership and all Paper Radar actions', async () => {
  const definitions: PaperRadarCapabilityOptions[] = []
  let created = 0
  let closed = 0
  const service: PaperRadarWorkerService = {
    status: async () => ({ ok: true }),
    syncArxiv: async () => ({ ok: true, data: { source: 'arxiv', fetched: 0, upserted: 0, skipped: 0 } }),
    syncBiorxiv: async () => ({ ok: true, data: { source: 'biorxiv', fetched: 0, upserted: 0, skipped: 0 } }),
    syncProfile: async () => ({ ok: true, data: { profile: 'default', results: [] } }),
    listProfiles: async () => ({ ok: true, data: { profiles: [] } }),
    saveProfile: async (profile) => ({ ok: true, data: { profile } }),
    review: async () => ({ ok: true, data: { profile: 'default', count: 0, papers: [], generatedAt: '' , syncResults: [] } }),
    search: async () => ({ ok: true, data: { papers: [], count: 0 } }),
    rank: async () => ({ ok: true, data: { profile: 'default', count: 0, papers: [] } }),
    digest: async () => ({ ok: true, data: { profile: 'default', count: 0, papers: [], generatedAt: '' } }),
    close: () => { closed += 1 }
  }
  const entry = createDomainMainEntry({
    defineCapability: (value) => {
      const definition = value as PaperRadarCapabilityOptions
      definitions.push(definition)
      return definition
    },
    getUserDataDir: () => '/tmp/paper-radar-test',
    createWorkerService: () => {
      created += 1
      return service
    }
  })

  assert.equal(entry.definition, domainPackageDefinition)
  assert.deepEqual(entry.contributions.map(({ kind, id }) => `${kind}:${id}`), [
    'main.capability-factory:paper-radar.capabilities'
  ])
  const factory = entry.contributions[0]!.value as {
    createDefinitions(): readonly PaperRadarCapabilityOptions[]
  }
  assert.equal(created, 0)
  assert.equal(factory.createDefinitions().length, 10)
  assert.equal(definitions.length, 10)
  assert.ok(definitions.every((definition) => definition.audiences.includes('agent')))
  const mutationIds = new Set([
    'paper-radar.sync-arxiv',
    'paper-radar.sync-biorxiv',
    'paper-radar.sync-profile',
    'paper-radar.profiles.save',
    'paper-radar.review'
  ])
  for (const definition of definitions) {
    if (mutationIds.has(definition.id)) {
      assert.equal(definition.effect, 'external-write')
      assert.equal(definition.approval, 'confirmation')
    } else {
      assert.equal(definition.effect, 'read')
      assert.equal(definition.approval, 'none')
    }
  }

  await definitions[0]!.handler({})
  assert.equal(created, 1)
  entry.contributions[0]!.onDispose?.()
  assert.equal(closed, 1)
})
