import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDatasetApiCapabilityFactory,
  DATASET_API_CAPABILITY_IDS
} from './main.js'

test('publishes the complete Dataset API surface through governed capabilities', () => {
  const definitions = capabilityDefinitions()
  assert.deepEqual(
    definitions.map((definition) => definition.id),
    Object.values(DATASET_API_CAPABILITY_IDS)
  )
  assert.equal(definitions.length, 22)
  assert.ok(definitions.every((definition) => definition.audiences.includes('agent')))
  assert.ok(definitions.every((definition) => definition.scope === 'workspace'))
  assert.equal(findDefinition(definitions, DATASET_API_CAPABILITY_IDS.catalog).effect, 'read')
  assert.equal(findDefinition(definitions, DATASET_API_CAPABILITY_IDS.rawData).effect, 'workspace-write')
})

test('keeps workspace paths out of agent inputs and injects the caller workspace', async () => {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = []
  const definitions = capabilityDefinitions({
    api: {
      registerProvider: async (input: Record<string, unknown>) => {
        calls.push({ method: 'registerProvider', input })
        return { source: { id: 'uniprot' }, reused: false }
      }
    }
  })
  const capability = findDefinition(definitions, DATASET_API_CAPABILITY_IDS.registerProvider)

  assert.equal(capability.inputSchema.safeParse({
    workspaceRoot: '/untrusted',
    providerId: 'uniprot'
  }).success, false)

  await capability.handler(
    { providerId: 'uniprot' },
    { caller: { workspaceId: '/workspace/project' } }
  )

  assert.deepEqual(calls, [{
    method: 'registerProvider',
    input: {
      providerId: 'uniprot',
      workspaceRoot: '/workspace/project'
    }
  }])
})

test('authorizes planned metadata and raw-data access before the network service', async () => {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = []
  const definitions = capabilityDefinitions({
    api: {
      metadata: async (input: Record<string, unknown>) => {
        calls.push({ method: 'metadata', input })
        return { source: { id: 'uniprot' }, response: { bytes: 42 } }
      },
      rawData: async (input: Record<string, unknown>) => {
        calls.push({ method: 'rawData', input })
        return { source: { id: 'uniprot' }, response: { bytes: 84 } }
      }
    },
    processing: {
      authorizePlan: async (input: Record<string, unknown>) => {
        calls.push({ method: 'authorizePlan', input })
      }
    }
  })
  const context = { caller: { workspaceId: '/workspace/project' } }

  await findDefinition(definitions, DATASET_API_CAPABILITY_IDS.metadata).handler({
    planId: 'plan-0123456789abcdef',
    sourceId: 'uniprot',
    pathParameters: { accession: 'P04637' },
    responseMode: 'summary'
  }, context)
  await findDefinition(definitions, DATASET_API_CAPABILITY_IDS.rawData).handler({
    planId: 'plan-0123456789abcdef',
    sourceId: 'uniprot',
    pathParameters: { accession: 'P04637' },
    outputFileName: 'P04637.fasta',
    expectedFormat: 'fasta'
  }, context)

  assert.deepEqual(calls.map((call) => call.method), [
    'authorizePlan',
    'metadata',
    'authorizePlan',
    'rawData'
  ])
  assert.ok(calls.every((call) => call.input.workspaceRoot === '/workspace/project'))
})

type Definition = {
  id: string
  audiences: string[]
  scope: string
  effect: string
  inputSchema: { safeParse: (input: unknown) => { success: boolean } }
  handler: (
    input: Record<string, unknown>,
    context: { caller: { workspaceId?: string } }
  ) => Promise<{ output: unknown }>
}

function capabilityDefinitions(overrides: Record<string, unknown> = {}): Definition[] {
  const api = {
    catalog: async () => ({ providers: [] }),
    registerProvider: async () => ({ source: { id: 'test' }, reused: false }),
    list: async () => ({ sources: [] }),
    register: async () => ({ source: { id: 'test' }, reused: false }),
    metadata: async () => ({ source: { id: 'test' }, response: { bytes: 1 } }),
    rawData: async () => ({ source: { id: 'test' }, response: { bytes: 1 } }),
    ...(overrides.api as object | undefined)
  }
  const processing = {
    authorizePlan: async () => undefined,
    preparePlan: async () => ({}),
    profile: async () => ({}),
    filter: async () => ({}),
    selectColumns: async () => ({}),
    transform: async () => ({}),
    deduplicate: async () => ({}),
    mapIds: async () => ({}),
    providerIdMapping: async () => ({
      mappingArtifact: { path: '.sciforge/datasets/mapping.json' },
      mapping: { jobId: 'job', resultsUrl: 'https://rest.uniprot.org/', failedIds: [] }
    }),
    join: async () => ({}),
    structureProfile: async () => ({}),
    structureValidate: async () => ({}),
    organizeGraph: async () => ({}),
    validate: async () => ({}),
    publish: async () => ({}),
    ...(overrides.processing as object | undefined)
  }
  const factory = createDatasetApiCapabilityFactory<Definition>({
    defineCapability: (definition) => definition as unknown as Definition,
    getServices: () => ({
      api,
      processing,
      executor: {
        execute: async () => ({}),
        resume: async () => ({})
      }
    }) as never
  })
  return [...factory.createDefinitions()]
}

function findDefinition(definitions: Definition[], id: string): Definition {
  const definition = definitions.find((candidate) => candidate.id === id)
  assert.ok(definition, `Missing capability ${id}`)
  return definition
}
