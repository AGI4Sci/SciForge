import assert from 'node:assert/strict'
import test from 'node:test'

import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { ResearchCheckpointStopReceiptV1 } from '@sciforge/domain-research-checkpoints/contract'
import { createResearchDossierCapabilityClient } from './research-dossier-capability-client.js'

test('dossier reads exact owner identities and controls recording policy only through public capabilities', async () => {
  const stopBeforeFirstRecording = {
    recording: null,
    policyRevision: 1
  } satisfies ResearchCheckpointStopReceiptV1
  assert.equal(stopBeforeFirstRecording.recording, null)

  const calls: Array<{
    actionId: string
    input: unknown
    workspaceId?: string
    approval?: { mode: string }
  }> = []
  const invoker = {
    invoke: async (
      contract: { actionId: string },
      input: unknown,
      options?: { workspaceId?: string; approval?: { mode: string } }
    ) => {
      calls.push({
        actionId: contract.actionId,
        input,
        workspaceId: options?.workspaceId,
        ...(options?.approval ? { approval: options.approval } : {})
      })
      return { ok: false, issue: { code: 'version-not-found', message: 'missing' } }
    }
  } as unknown as DomainRendererCapabilityInvoker
  const client = createResearchDossierCapabilityClient(invoker)

  await client.describeArtifactVersion('/workspace/lab', 'artifact-version:figure:2')
  await client.listArtifactVersions('/workspace/lab', {
    artifactId: 'artifact:figure',
    limit: 25,
    beforeSequence: 20
  })
  await client.readResearchRecordingStatus('/workspace/lab', {
    runtimeId: 'codex',
    threadId: 'thread-1'
  })
  await client.readResearchCheckpoint('/workspace/lab', {
    versionId: 'artifact-version:research:2'
  })
  await client.startResearchRecording('/workspace/lab', {
    runtimeId: 'codex',
    threadId: 'thread-1',
    expectedPolicyRevision: 0,
    idempotencyKey: 'research-dossier:start:test-1'
  })
  await client.restoreResearchCheckpointAsNew('/workspace/lab', {
    recordingId: 'research-recording:test-1',
    artifactId: 'artifact:figure',
    sourceVersionId: 'artifact-version:figure:1',
    expectedCurrentVersionId: 'artifact-version:figure:2',
    idempotencyKey: 'research-dossier:restore:test-1'
  })
  await client.stopResearchRecording('/workspace/lab', {
    runtimeId: 'codex',
    threadId: 'thread-1',
    expectedPolicyRevision: 1,
    idempotencyKey: 'research-dossier:stop:test-1'
  })
  await client.previewLegacyResearchTurns('/workspace/lab', {
    runtimeId: 'codex',
    threadId: 'thread-1',
    selectedTurnIds: ['turn-1']
  })
  await client.importLegacyResearchTurns('/workspace/lab', {
    runtimeId: 'codex',
    threadId: 'thread-1',
    idempotencyKey: 'research-dossier:legacy:test-1',
    title: 'Imported research',
    expectedTranscriptDigest: 'a'.repeat(64),
    selectedTurnIds: ['turn-1']
  })

  assert.deepEqual(calls, [
    {
      actionId: 'artifact-versions.describe-v2',
      input: { versionId: 'artifact-version:figure:2' },
      workspaceId: '/workspace/lab'
    },
    {
      actionId: 'artifact-versions.list-v2',
      input: { artifactId: 'artifact:figure', limit: 25, beforeSequence: 20 },
      workspaceId: '/workspace/lab'
    },
    {
      actionId: 'research-checkpoints.status',
      input: { runtimeId: 'codex', threadId: 'thread-1' },
      workspaceId: '/workspace/lab'
    },
    {
      actionId: 'research-checkpoints.read',
      input: { versionId: 'artifact-version:research:2' },
      workspaceId: '/workspace/lab'
    },
    {
      actionId: 'research-checkpoints.start',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        expectedPolicyRevision: 0,
        idempotencyKey: 'research-dossier:start:test-1'
      },
      workspaceId: '/workspace/lab',
      approval: { mode: 'confirmation' }
    },
    {
      actionId: 'research-checkpoints.restore-as-new',
      input: {
        recordingId: 'research-recording:test-1',
        artifactId: 'artifact:figure',
        sourceVersionId: 'artifact-version:figure:1',
        expectedCurrentVersionId: 'artifact-version:figure:2',
        idempotencyKey: 'research-dossier:restore:test-1'
      },
      workspaceId: '/workspace/lab',
      approval: { mode: 'confirmation' }
    },
    {
      actionId: 'research-checkpoints.stop',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        expectedPolicyRevision: 1,
        idempotencyKey: 'research-dossier:stop:test-1'
      },
      workspaceId: '/workspace/lab',
      approval: { mode: 'confirmation' }
    },
    {
      actionId: 'research-checkpoints.legacy.preview',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        selectedTurnIds: ['turn-1']
      },
      workspaceId: '/workspace/lab'
    },
    {
      actionId: 'research-checkpoints.legacy.import',
      input: {
        runtimeId: 'codex',
        threadId: 'thread-1',
        idempotencyKey: 'research-dossier:legacy:test-1',
        title: 'Imported research',
        expectedTranscriptDigest: 'a'.repeat(64),
        selectedTurnIds: ['turn-1']
      },
      workspaceId: '/workspace/lab',
      approval: { mode: 'confirmation' }
    }
  ])
})
