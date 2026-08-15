import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { artifactVersionListV1Schema } from '../contract.js'
import {
  defaultBundleDestination,
  defaultMaterializeDestination,
  stableUiActionKey,
  uniqueRestoreActionKey
} from './artifact-version-actions.js'
import {
  artifactVersionsCapabilityContracts,
  createArtifactVersionsCapabilityClient
} from './artifact-versions-capability-client.js'

test('renderer actions use only the scoped capability broker', async () => {
  const calls: Array<Readonly<{
    actionId: string
    input: unknown
    options: unknown
  }>> = []
  const invoker = {
    invoke: async (
      contract: Readonly<{ actionId: string }>,
      input: unknown,
      options: unknown
    ) => {
      calls.push({ actionId: contract.actionId, input, options })
      return { ok: false, issue: { code: 'io-failure', message: 'fixture' } }
    }
  } as unknown as DomainRendererCapabilityInvoker
  const client = createArtifactVersionsCapabilityClient(invoker)
  const workspace = '/workspace'

  await client.list(workspace, { limit: 5 })
  await client.refresh(workspace)
  await client.compare(workspace, {
    fromVersionId: 'artifact-version:from',
    toVersionId: 'artifact-version:to'
  })
  await client.materialize(workspace, {
    idempotencyKey: 'materialize-fixture',
    versionId: 'artifact-version:from',
    destinationPath: '.sciforge/artifact-versions/materialized/result.csv'
  })
  await client.restoreAsNew(workspace, {
    idempotencyKey: 'restore-fixture',
    artifactId: 'artifact:data',
    sourceVersionId: 'artifact-version:from',
    expectedCurrentVersionId: 'artifact-version:to'
  })
  await client.exportBundle(workspace, {
    idempotencyKey: 'bundle-export-fixture',
    artifactIds: ['artifact:data'],
    destinationPath: '.sciforge/artifact-versions/bundles/data.json'
  })
  await client.verifyBundle(workspace, {
    bundlePath: '.sciforge/artifact-versions/bundles/data.json'
  })

  assert.deepEqual(calls.map(({ actionId }) => actionId), [
    'artifact-versions.list',
    'artifact-versions.lifecycle.refresh',
    'artifact-versions.compare',
    'artifact-versions.materialize',
    'artifact-versions.restore-as-new',
    'artifact-versions.bundle.export',
    'artifact-versions.bundle.verify'
  ])
  assert.deepEqual(calls.map(({ options }) => options), [
    { workspaceId: workspace },
    { workspaceId: workspace },
    { workspaceId: workspace },
    { workspaceId: workspace, approval: { mode: 'confirmation' } },
    { workspaceId: workspace },
    { workspaceId: workspace },
    { workspaceId: workspace }
  ])
  assert.deepEqual(
    Object.values(artifactVersionsCapabilityContracts).map(({ effect }) => effect),
    ['read', 'compute', 'read', 'workspace-write', 'workspace-write', 'workspace-write', 'read']
  )
})
test('action defaults stay relative to the caller workspace and remain stable', () => {
  const item = artifactVersionListV1Schema.parse({
    items: [{
      artifact: {
        artifactId: 'artifact:dataset-1234567890',
        kind: 'dataset',
        label: 'Treatment response',
        createdAt: '2026-08-06T01:00:00.000Z',
        updatedAt: '2026-08-06T02:00:00.000Z',
        currentVersionId: 'artifact-version:dataset-v2',
        versionCount: 2
      },
      version: {
        schemaVersion: 1,
        versionId: 'artifact-version:dataset-v2',
        artifactId: 'artifact:dataset-1234567890',
        parentVersionId: 'artifact-version:dataset-v1',
        sequence: 2,
        transactionId: 'artifact-commit:fixture',
        createdAt: '2026-08-06T02:00:00.000Z',
        intent: 'save',
        storage: {
          mode: 'snapshot',
          contentDigest: 'a'.repeat(64),
          byteLength: 42,
          mediaType: 'text/csv'
        },
        dependencies: [],
        accessPolicy: {
          visibility: 'workspace',
          principals: [],
          allowExport: true
        },
        metadata: {}
      },
      ref: {
        artifactId: 'artifact:dataset-1234567890',
        versionId: 'artifact-version:dataset-v2',
        contentDigest: 'a'.repeat(64),
        byteLength: 42,
        mediaType: 'text/csv',
        availability: 'available',
        retention: 'snapshot',
        accessPolicy: {
          visibility: 'workspace',
          principals: [],
          allowExport: true
        }
      }
    }]
  }).items[0]!

  const materialized = defaultMaterializeDestination(item)
  const bundle = defaultBundleDestination(item)
  assert.match(materialized, /^\.sciforge\/artifact-versions\/materialized\//)
  assert.match(materialized, /v2-a{12}\.csv$/)
  assert.match(bundle, /^\.sciforge\/artifact-versions\/bundles\//)
  assert.match(bundle, /-v2\.artifact-bundle\.json$/)
  assert.equal(materialized.startsWith('/'), false)
  assert.equal(bundle.startsWith('/'), false)
  assert.equal(materialized.includes('..'), false)
  assert.equal(bundle.includes('..'), false)
  assert.equal(
    stableUiActionKey('materialize', item),
    stableUiActionKey('materialize', item)
  )
  assert.match(uniqueRestoreActionKey(item.version.versionId), /^artifact-version-ui:restore:/)
})
