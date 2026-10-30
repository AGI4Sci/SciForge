import assert from 'node:assert/strict'
import test from 'node:test'

import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import { createResearchCheckpointsRendererClient } from './research-checkpoints-capability-client.js'

test('reads checkpoint status only through exact public turn scope', async () => {
  const calls: unknown[] = []
  const invoker = {
    invoke: async (contract: { actionId: string }, input: unknown, options: unknown) => {
      calls.push({ actionId: contract.actionId, input, options })
      return {
        ok: true,
        value: {
          state: 'unrecorded',
          runtimeId: 'codex',
          threadId: 'thread-1',
          turnId: 'turn-2'
        }
      }
    }
  } as unknown as DomainRendererCapabilityInvoker

  const result = await createResearchCheckpointsRendererClient(invoker).readTurnStatus(
    '/workspace/lab',
    { runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-2' }
  )
  await createResearchCheckpointsRendererClient(invoker).readExactOutput(
    '/workspace/lab',
    { versionId: 'artifact-version:output:penguins:2', maxBytes: 262_144 }
  )
  await createResearchCheckpointsRendererClient(invoker).startRecording(
    '/workspace/lab',
    {
      runtimeId: 'codex',
      threadId: 'thread-1',
      expectedPolicyRevision: 0,
      idempotencyKey: 'checkpoint-start:test-1'
    }
  )
  await createResearchCheckpointsRendererClient(invoker).stopRecording(
    '/workspace/lab',
    {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: 'research-recording:test-1',
      expectedPolicyRevision: 1,
      idempotencyKey: 'checkpoint-stop:test-1'
    }
  )
  await createResearchCheckpointsRendererClient(invoker).readStatus(
    '/workspace/lab',
    { runtimeId: 'codex', threadId: 'thread-1' }
  )
  await createResearchCheckpointsRendererClient(invoker).resolveStaleConflict(
    '/workspace/lab',
    {
      runtimeId: 'codex',
      threadId: 'thread-1',
      recordingId: 'research-recording:test-1',
      operationId: `research-checkpoint-operation:${'a'.repeat(64)}`,
      resolution: 'rebase',
      idempotencyKey: 'checkpoint-resolve:test-1'
    }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [
    {
      actionId: 'research-checkpoints.turn-status',
      input: { runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-2' },
      options: { workspaceId: '/workspace/lab' }
    },
    {
      actionId: 'artifact-versions.read',
      input: { versionId: 'artifact-version:output:penguins:2', maxBytes: 262_144 },
      options: { workspaceId: '/workspace/lab' }
    },
    {
      actionId: 'research-checkpoints.start',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        expectedPolicyRevision: 0,
        idempotencyKey: 'checkpoint-start:test-1'
      },
      options: { workspaceId: '/workspace/lab' }
    },
    {
      actionId: 'research-checkpoints.stop',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        recordingId: 'research-recording:test-1',
        expectedPolicyRevision: 1,
        idempotencyKey: 'checkpoint-stop:test-1'
      },
      options: { workspaceId: '/workspace/lab' }
    },
    {
      actionId: 'research-checkpoints.status',
      input: { runtimeId: 'codex', threadId: 'thread-1' },
      options: { workspaceId: '/workspace/lab' }
    },
    {
      actionId: 'research-checkpoints.resolve',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        recordingId: 'research-recording:test-1',
        operationId: `research-checkpoint-operation:${'a'.repeat(64)}`,
        resolution: 'rebase',
        idempotencyKey: 'checkpoint-resolve:test-1'
      },
      options: {
        workspaceId: '/workspace/lab',
        approval: { mode: 'confirmation' }
      }
    }
  ])
})
