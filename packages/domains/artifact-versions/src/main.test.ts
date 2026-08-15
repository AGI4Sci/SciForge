import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainCapabilityContract,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS,
  createArtifactVersionCommitPortV1,
  createArtifactVersionCommitPortV2,
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
  const v2 = createArtifactVersionCommitPortV2(invoker, '/workspace')
  await v2.commit({
    idempotencyKey: 'checkpoint:commit:v2',
    candidates: [{
      candidateId: 'checkpoint',
      requestedArtifactId: 'artifact:checkpoint',
      requestedVersionId: 'artifact-version:checkpoint',
      expectedCurrentVersionId: null,
      kind: 'research-checkpoint',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  })
  assert.equal((calls[2] as { contract: { actionId: string } }).contract.actionId,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2)
})
test('capability factory exposes one governed path for every package operation', async () => {
  const definitions: ArtifactVersionsCapabilityOptions[] = []
  const listCalls: unknown[] = []
  const service = {
    commit: async () => ({
      ok: false,
      issue: { code: 'io-failure', message: 'fixture' }
    }),
    commitV2: async () => ({ ok: false, issue: { code: 'io-failure', message: 'fixture' } }),
    listV1: async (...args: unknown[]) => {
      listCalls.push(args)
      return { ok: true, value: { items: [] } }
    },
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

  const commitV2 = definitions.find(({ id }) => id === ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2)!
  await assert.rejects(
    commitV2.handler({
      idempotencyKey: 'artifact-test-requested-identity',
      candidates: [{
        candidateId: 'figure',
        requestedArtifactId: 'artifact:requested',
        requestedVersionId: 'artifact-version:requested',
        expectedCurrentVersionId: null,
        kind: 'figure',
        intent: 'save',
        content: { mode: 'snapshot', dataBase64: 'YQ==' }
      }]
    }, {
      caller: { audience: 'system', callerId: 'domain-runtime:other', workspaceId: '/workspace' }
    }),
    /identity-selection grant/u
  )

  await commitV2.handler({
    idempotencyKey: 'artifact-test-granted-requested-identity',
    candidates: [{
      candidateId: 'figure',
      requestedArtifactId: 'artifact:granted',
      requestedVersionId: 'artifact-version:granted',
      expectedCurrentVersionId: null,
      kind: 'figure',
      intent: 'save',
      content: { mode: 'snapshot', dataBase64: 'YQ==' }
    }]
  }, {
    caller: {
      audience: 'system',
      callerId: 'domain-runtime:granted-package',
      workspaceId: '/workspace',
      capabilityGrants: [ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities]
    }
  })

  for (const id of [
    ARTIFACT_VERSIONS_CAPABILITY_IDS.stageBeginV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.stageAppendV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.stageSealV2,
    ARTIFACT_VERSIONS_CAPABILITY_IDS.stageAbortV2
  ]) {
    assert.deepEqual(definitions.find((definition) => definition.id === id)?.audiences, ['system'])
  }

  const materialize = definitions.find(
    ({ id }) => id === ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize
  )!
  assert.equal(materialize.effect, 'workspace-write')
  assert.equal(materialize.approval, 'confirmation')
})
