import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  createEvidenceDagCapabilityClient,
  evidenceDagCapabilityContracts
} from './evidence-dag-capability-client'

const timestamp = '2026-07-26T04:00:00.000Z'
const digest = `sha256:${'a'.repeat(64)}`

test('invokes only the package-owned Evidence DAG capability contracts', async () => {
  const calls: Array<{ actionId: string; input: unknown }> = []
  const invoke: DomainRendererCapabilityInvoker['invoke'] =
    async <TInput, TOutput>(
      contract: { actionId: string },
      input: TInput
    ): Promise<TOutput> => {
      calls.push({ actionId: contract.actionId, input })
      const status = { committed: null, pending: null, updatedAt: timestamp }
      const output = contract.actionId === evidenceDagCapabilityContracts.view.actionId
        ? { url: 'http://127.0.0.1:8000/', status }
        : contract.actionId === evidenceDagCapabilityContracts.update.actionId
          ? {
              url: 'http://127.0.0.1:8000/',
              threadId: 'thread-1',
              itemCount: 3,
              jobId: 'job-1',
              coalesced: false,
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

  await client.view({})
  await client.update({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace',
    operation: 'update'
  })
  await client.priority({
    runtimeId: 'codex',
    threadId: 'thread-1',
    visible: true
  })
  await client.resolvePreview({
    runtimeId: 'codex',
    threadId: 'thread-1',
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
    workspaceRoot: '/workspace',
    operation: 'update'
  })
  assert.equal(evidenceDagCapabilityContracts.view.effect, 'read')
  assert.equal(evidenceDagCapabilityContracts.update.effect, 'compute')
  assert.equal(evidenceDagCapabilityContracts.priority.effect, 'compute')
  assert.equal(evidenceDagCapabilityContracts.resolvePreview.effect, 'read')
})
