import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  createScientificPlottingCapabilityClient,
  scientificPlottingRendererCapabilityContracts
} from './scientific-plotting-capability-client.js'

function artifactRef(name: string, mediaType = 'application/json') {
  return {
    artifactId: `artifact:${name}`,
    versionId: `artifact-version:${name}`,
    contentDigest: 'a'.repeat(64),
    byteLength: 42,
    mediaType,
    availability: 'available' as const,
    retention: 'snapshot' as const,
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true }
  }
}

test('plot provenance renderer uses only workspace-scoped public capabilities', async () => {
  const calls: Array<Readonly<{ actionId: string; input: unknown; options: unknown }>> = []
  const invoker = {
    invoke: async (
      contract: Readonly<{ actionId: string }>,
      input: unknown,
      options: unknown
    ) => {
      calls.push({ actionId: contract.actionId, input, options })
      if (contract.actionId === 'artifact-versions.list') {
        return { ok: true, value: { items: [] } }
      }
      if (contract.actionId === 'artifact-versions.read') {
        return { ok: false, issue: { code: 'version-not-found', message: 'fixture' } }
      }
      return { ok: false, status: 'manifest_read_failed', message: 'fixture' }
    }
  } as unknown as DomainRendererCapabilityInvoker
  const client = createScientificPlottingCapabilityClient(invoker)
  const workspaceRoot = '/workspace'

  await client.listArtifactVersions(workspaceRoot, { limit: 10 })
  await client.readArtifactVersion(workspaceRoot, {
    versionId: 'artifact-version:manifest-v1'
  })
  await client.rerun(workspaceRoot, {
    operationId: 'fixture-rerun-operation-v1',
    baselineFigureVersionRef: artifactRef('figure-v1', 'image/png'),
    recipeVersionRef: artifactRef('recipe-v1'),
    expectedCurrentVersionId: 'artifact-version:figure-v2'
  })
  await client.compare(workspaceRoot, {
    baselineManifestVersionRef: artifactRef('manifest-v1'),
    candidateManifestVersionRef: artifactRef('manifest-v2')
  })

  assert.deepEqual(calls.map(({ actionId }) => actionId), [
    'artifact-versions.list',
    'artifact-versions.read',
    'scientific-plotting.rerun',
    'scientific-plotting.compare'
  ])
  assert.deepEqual(calls.map(({ options }) => options), [
    { workspaceId: workspaceRoot },
    { workspaceId: workspaceRoot },
    { workspaceId: workspaceRoot },
    { workspaceId: workspaceRoot }
  ])
  assert.deepEqual(
    Object.values(scientificPlottingRendererCapabilityContracts).map(({ effect }) => effect),
    ['read', 'read', 'workspace-write', 'read']
  )
})
