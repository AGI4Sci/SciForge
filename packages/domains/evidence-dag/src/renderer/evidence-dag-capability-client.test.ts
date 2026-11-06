import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  createEvidenceDagCapabilityClient,
  evidenceDagCapabilityContracts
} from './evidence-dag-capability-client'

const timestamp = '2026-07-26T04:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`

test('rerun reads use canonical contracts with explicit workspace and immutable identities', async () => {
  const calls: unknown[] = []
  const client = createEvidenceDagCapabilityClient({ invoke: async (contract: unknown, input: unknown, options: unknown) => { calls.push({ contract, input, options }); return {} } } as unknown as DomainRendererCapabilityInvoker)
  const spec = { runtimeId: 'codex', threadId: 'thread', closureDigest: digest, conclusionId: 'claim', workspaceRoot: '/workspace' }
  const compare = { runtimeId: 'codex', threadId: 'thread', baselineDigest: digest, baselineConclusionId: 'claim', candidateDigest: digest, candidateConclusionId: 'candidate', workspaceRoot: '/workspace' }
  await client.rerunSpec(spec); await client.rerunCompare(compare)
  assert.deepEqual(calls, [{ contract: evidenceDagCapabilityContracts.rerunSpec, input: spec, options: { workspaceId: '/workspace' } }, { contract: evidenceDagCapabilityContracts.rerunCompare, input: compare, options: { workspaceId: '/workspace' } }])
  await assert.rejects(client.rerunSpec({ ...spec, workspaceRoot: undefined }), /explicit caller workspace/)
  await assert.rejects(client.rerunCompare({ ...compare, workspaceRoot: undefined }), /explicit caller workspace/)
  assert.equal(calls.length, 2)
})

test('invokes only the package-owned Evidence DAG capability contracts', async () => {
  const calls: Array<{ actionId: string; input: unknown; workspaceId?: string }> = []
  const invoke: DomainRendererCapabilityInvoker['invoke'] =
    async <TInput, TOutput>(
      contract: { actionId: string },
      input: TInput,
      options?: { workspaceId?: string }
    ): Promise<TOutput> => {
      calls.push({ actionId: contract.actionId, input, workspaceId: options?.workspaceId })
      const status = { committed: null, pending: null, updatedAt: timestamp }
      const output = contract.actionId === evidenceDagCapabilityContracts.view.actionId
        ? { url: 'http://127.0.0.1:8000/', status }
        : contract.actionId === evidenceDagCapabilityContracts.update.actionId
          ? {
              url: 'http://127.0.0.1:8000/',
              threadId: 'thread-1',
              itemCount: 3,
              deltaDigest: digest,
              idempotent: false,
              status
            }
          : contract.actionId === evidenceDagCapabilityContracts.priority.actionId
            ? status
            : {
                ok: false,
                code: 'snapshot_mismatch',
                message: 'stale'
              }
      return output as TOutput
    }
  const client = createEvidenceDagCapabilityClient({
    invoke,
    observe: async () => {
      throw new Error('not observed')
    }
  })

  await client.view({ workspaceRoot: '/workspace' })
  await client.update({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace'
  })
  await client.priority({
    runtimeId: 'codex',
    threadId: 'thread-1',
    surfaceId: 'surface-evidence-a',
    workspaceRoot: '/workspace',
    visible: true
  })
  await client.resolvePreview({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    snapshotDigest: digest,
    sourceAssertionId: 'source-1',
    artifactVersionId: 'artifact-v1',
    sourceAnchorId: 'anchor-1'
  })

  assert.deepEqual(calls.map((call) => call.actionId), [
    'evidence-dag.view',
    'evidence-dag.update',
    'evidence-dag.priority',
    'evidence-dag.resolve-evidence-preview'
  ])
  assert.deepEqual(calls[1]?.input, {
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace'
  })
  assert.equal(evidenceDagCapabilityContracts.view.effect, 'read')
  assert.equal(evidenceDagCapabilityContracts.update.effect, 'compute')
  assert.equal(evidenceDagCapabilityContracts.priority.effect, 'compute')
  assert.equal(evidenceDagCapabilityContracts.resolvePreview.effect, 'read')
  assert.deepEqual(calls.map(call => call.workspaceId), Array(4).fill('/workspace'))
})

test('all renderer Evidence operations carry explicit caller workspace authority and never inherit a previous scope', async () => {
  const calls: Array<{ actionId: string; workspaceId: string }> = []
  // Mirrors the Broker workspace-scope requirement; input.workspaceRoot alone
  // cannot authorize an invocation and the actual contract still validates input.
  const invoke: DomainRendererCapabilityInvoker['invoke'] = async (contract, input, options) => {
    if (!options?.workspaceId) throw new Error('Workspace capability requires caller workspace scope.')
    const parsed = contract.inputSchema.parse(input) as { workspaceRoot?: string }
    assert.equal(options.workspaceId, parsed.workspaceRoot)
    calls.push({ actionId: contract.actionId, workspaceId: options.workspaceId })
    return {} as never
  }
  const client = createEvidenceDagCapabilityClient({ invoke, observe: async () => { throw new Error('not observed') } })
  const scoped = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace/owner' }
  await client.view(scoped)
  await client.update(scoped)
  await client.priority({ ...scoped, surfaceId: 'surface-evidence-a', visible: true })
  await client.snapshotStatus(scoped)
  await client.resolvePreview({ ...scoped, snapshotDigest: digest, sourceAssertionId: 'source-1', artifactVersionId: 'artifact-v1', sourceAnchorId: 'anchor-1' })
  await client.sealClosure({ ...scoped, idempotencyKey: 'seal-test-1', policy: {
    version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim-1'], expectedHeadDigest: digest, barrierWatermark: 'turn-1',
    edgeFamilies: [], directions: ['inbound'], maxDepth: 1, termination: 'depth', expandEquivalent: false,
    expandRefinement: false, cycleHandling: 'record_gap', unknownEdgeHandling: 'record_gap', requiredRecords: [], requiredExternalRefs: []
  } })
  assert.equal(calls.length, 6)
  assert.ok(calls.every(call => call.workspaceId === scoped.workspaceRoot))
  await client.view({ ...scoped, workspaceRoot: '/workspace/another-owner' })
  assert.equal(calls.at(-1)!.workspaceId, '/workspace/another-owner')
  const before = calls.length
  await assert.rejects(client.view({ runtimeId: 'codex', threadId: 'thread-1' }), /explicit caller workspace scope/)
  await assert.rejects(client.update({ ...scoped, workspaceRoot: ' ' }), /explicit caller workspace scope/)
  assert.equal(calls.length, before, 'missing scope must not invoke or reuse an earlier workspace')
})
