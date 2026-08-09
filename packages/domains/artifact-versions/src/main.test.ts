import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainCapabilityContract,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  createArtifactVersionCommitPortV1,
  createArtifactVersionEventListPortV1
} from './contract.js'
import {
  createArtifactVersionsCapabilityFactory,
  type ArtifactVersionsCapabilityOptions
} from './main.js'
import type { ArtifactVersionService } from './main/service.js'

test('commit port invokes the single broker contract with workspace and idempotency scope', async () => {
  const calls: unknown[] = []
  const invoker = {
    invoke: async <TInput, TOutput>(
      contract: DomainCapabilityContract<TInput, TOutput>,
      input: TInput,
      options: unknown
    ): Promise<TOutput> => {
      calls.push({ contract, input, options })
      return { ok: false, issue: { code: 'io-failure', message: 'test' } } as TOutput
    }
  } as DomainMainSystemCapabilityInvoker
  const port = createArtifactVersionCommitPortV1(invoker, '/workspace')
  await port.commit({
    idempotencyKey: 'plot:commit:1',
    candidates: [{
      candidateId: 'figure',
      expectedCurrentVersionId: null,
      kind: 'figure',
      intent: 'rerun',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  })
  assert.equal(calls.length, 1)
  assert.deepEqual((calls[0] as { options: unknown }).options, {
    workspaceId: '/workspace',
    idempotencyKey: 'plot:commit:1'
  })
  const events = createArtifactVersionEventListPortV1(invoker, '/workspace')
  await events.listEvents({ afterSequence: 0, limit: 100 })
  assert.deepEqual((calls[1] as { options: unknown }).options, {
    workspaceId: '/workspace'
  })
})

test('capability factory exposes one governed path for every package operation', async () => {
  const definitions: ArtifactVersionsCapabilityOptions[] = []
  const listCalls: unknown[] = []
  const service = {
    commit: async () => ({
      ok: false,
      issue: { code: 'io-failure', message: 'fixture' }
    }),
    list: async (...args: unknown[]) => {
      listCalls.push(args)
      return { ok: true, value: { items: [] } }
    }
  } as unknown as ArtifactVersionService
  const factory = createArtifactVersionsCapabilityFactory({
    defineCapability: (definition) => {
      definitions.push(definition)
      return definition
    },
    getService: () => service
  })
  factory.createDefinitions()
  assert.deepEqual(
    new Set(definitions.map(({ id }) => id)),
    new Set(Object.values(ARTIFACT_VERSIONS_CAPABILITY_IDS))
  )
  assert.deepEqual(factory.policy.directTransportPrefixes, [])
  assert.deepEqual(factory.policy.allowedDirectTransports, [])

  const list = definitions.find(({ id }) => id === ARTIFACT_VERSIONS_CAPABILITY_IDS.list)!
  await list.handler({}, {
    caller: { audience: 'agent', callerId: 'research-agent', workspaceId: '/workspace' }
  })
  assert.deepEqual(listCalls, [[
    '/workspace',
    {},
    { audience: 'agent', callerId: 'research-agent' }
  ]])
  await assert.rejects(
    list.handler({}, { caller: { audience: 'agent', callerId: 'research-agent' } }),
    /requires caller workspace scope/u
  )

  const commit = definitions.find(({ id }) => id === ARTIFACT_VERSIONS_CAPABILITY_IDS.commit)!
  const commitResult = await commit.handler({
    idempotencyKey: 'artifact-test-commit',
    candidates: [{
      candidateId: 'figure',
      expectedCurrentVersionId: null,
      kind: 'figure',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  }, {
    caller: { audience: 'system', callerId: 'domain-runtime', workspaceId: '/workspace' }
  })
  assert.equal('changed' in commitResult, false)

  const materialize = definitions.find(
    ({ id }) => id === ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize
  )!
  assert.equal(materialize.effect, 'workspace-write')
  assert.equal(materialize.approval, 'confirmation')
})
