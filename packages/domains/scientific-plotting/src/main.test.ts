import assert from 'node:assert/strict'
import test from 'node:test'
import type { ScientificPlottingService } from '@sciforge/scientific-plotting/service'
import {
  SCIENTIFIC_PLOTTING_CAPABILITY_IDS
} from './contract.js'
import {
  createScientificPlottingCapabilityFactory,
  type ScientificPlottingCapabilityOptions
} from './main.js'

function artifactRef(name: string) {
  return {
    artifactId: `artifact:${name}`,
    versionId: `artifact-version:${name}`,
    contentDigest: 'a'.repeat(64),
    byteLength: 42,
    mediaType: 'application/json',
    availability: 'available' as const,
    retention: 'snapshot' as const,
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true }
  }
}

function service(calls: Array<{ operation: string; input?: unknown }>): ScientificPlottingService {
  return {
    status: async () => {
      calls.push({ operation: 'status' })
      return {
        ok: true,
        serverName: 'scientific_plotting',
        version: 'test',
        degraded: false,
        supportedTemplates: []
      } as never
    },
    mapData: async (input) => {
      calls.push({ operation: 'mapData', input })
      return { ok: false, status: 'invalid_request', message: 'fixture' } as never
    },
    render: async (input) => {
      calls.push({ operation: 'render', input })
      return { ok: false, status: 'invalid_request', message: 'fixture' }
    },
    rerun: async (input) => {
      calls.push({ operation: 'rerun', input })
      return {
        ok: false,
        status: 'rerun_failed',
        message: 'fixture',
        provenanceBreakpoints: [{
          schemaVersion: 1,
          code: 'exact-rerun-failed',
          stage: 'baseline',
          message: 'fixture',
          retryable: false
        }]
      }
    },
    compare: async (input) => {
      calls.push({ operation: 'compare', input })
      return { ok: false, status: 'manifest_read_failed', message: 'fixture' }
    }
  }
}

test('publishes the canonical plotting capability surface without direct transports', () => {
  const calls: Array<{ operation: string; input?: unknown }> = []
  const definitions = createScientificPlottingCapabilityFactory<ScientificPlottingCapabilityOptions>({
    defineCapability: (definition) => definition,
    statusService: service(calls),
    serviceFor: () => service(calls)
  }).createDefinitions()
  assert.deepEqual(
    new Set(definitions.map(({ id }) => id)),
    new Set(Object.values(SCIENTIFIC_PLOTTING_CAPABILITY_IDS))
  )
  const render = definitions.find(({ id }) => id === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render)!
  const rerun = definitions.find(({ id }) => id === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun)!
  assert.equal(render.effect, 'workspace-write')
  assert.equal(render.concurrency.idempotency, 'required')
  assert.equal(rerun.effect, 'workspace-write')
  assert.equal(rerun.concurrency.idempotency, 'required')
})

test('derives workspace ownership from the caller and ignores spoofed input roots', async () => {
  const calls: Array<{ operation: string; input?: unknown }> = []
  const definitions = createScientificPlottingCapabilityFactory<ScientificPlottingCapabilityOptions>({
    defineCapability: (definition) => definition,
    statusService: service(calls),
    serviceFor: () => service(calls)
  }).createDefinitions()
  const compare = definitions.find(({ id }) => id === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare)!

  await compare.handler({
    workspaceRoot: '/spoofed',
    baselineManifestVersionRef: artifactRef('manifest-v1'),
    candidateManifestVersionRef: artifactRef('manifest-v2')
  }, { caller: { workspaceId: '/owned' } })

  assert.deepEqual(calls.at(-1), {
    operation: 'compare',
    input: {
      workspaceRoot: '/owned',
      baselineManifestVersionRef: artifactRef('manifest-v1'),
      candidateManifestVersionRef: artifactRef('manifest-v2')
    }
  })
  await assert.rejects(
    compare.handler({
      baselineManifestVersionRef: artifactRef('manifest-v1'),
      candidateManifestVersionRef: artifactRef('manifest-v2')
    }, { caller: {} }),
    /workspace-scoped caller/u
  )
})

test('workspace mutations do not report resource revisions to the broker', async () => {
  const calls: Array<{ operation: string; input?: unknown }> = []
  const definitions = createScientificPlottingCapabilityFactory<ScientificPlottingCapabilityOptions>({
    defineCapability: (definition) => definition,
    statusService: service(calls),
    serviceFor: () => service(calls)
  }).createDefinitions()
  const render = definitions.find(({ id }) => id === SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render)!
  const result = await render.handler({
    data: [],
    visualPlan: { route: 'code', template: 'scatter' }
  }, { caller: { workspaceId: '/owned' } })

  assert.equal('changed' in result, false)
})
