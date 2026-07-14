import { describe, expect, it } from 'vitest'
import type { BiologyRoomManifest } from '@shared/biology-room'
import type { BioGymRunEvent } from '@shared/biogym'
import {
  bioGymEventHasDisplayableAsset,
  groupBioGymAssets,
  mergeBioGymRunEvent,
  resolveBioGymDisplayedAssetId,
  shouldMarkBioGymEventPending,
  shouldOpenPendingBioGymRun,
  shouldResetBioGymFollowRun
} from './biogym-run-ui'

const NOW = '2026-07-12T10:00:00.000Z'

describe('BioGym Biology Room event model', () => {
  it('ignores stale revisions and keeps the active result on status-only updates', () => {
    const artifact = event({
      eventId: 'event-2',
      revision: 2,
      activeAssetId: 'structure-1',
      activeAssetPath: '.sciforge/biogym/runs/run-1/artifacts/verify/structure.cif'
    })
    const stale = event({ eventId: 'event-1', revision: 1 })
    const status = event({
      eventId: 'event-3',
      revision: 3,
      type: 'run_status',
      emittedAt: '2026-07-12T10:01:00.000Z'
    })

    expect(mergeBioGymRunEvent(artifact, stale)).toBe(artifact)
    expect(mergeBioGymRunEvent(artifact, status)).toMatchObject({
      eventId: 'event-3',
      activeAssetId: 'structure-1',
      activeAssetPath: artifact.activeAssetPath
    })
    expect(bioGymEventHasDisplayableAsset(status)).toBe(false)
    expect(bioGymEventHasDisplayableAsset(artifact)).toBe(true)
    expect(shouldMarkBioGymEventPending(artifact)).toBe(true)
    expect(shouldMarkBioGymEventPending({ ...artifact, type: 'run_status' })).toBe(false)
    expect(shouldMarkBioGymEventPending({ ...artifact, type: 'stage_terminal' })).toBe(false)
    expect(shouldMarkBioGymEventPending({ ...artifact, type: 'snapshot' })).toBe(true)
  })

  it('groups viewer assets by stage attempt without duplicating assets', () => {
    const room: BiologyRoomManifest = {
      schemaVersion: 1,
      roomId: 'room-1',
      title: 'Protein design',
      revision: 3,
      assets: [asset('backbone', 'backbone.pdb'), asset('sequence', 'designs.fa'), asset('notes', 'notes.fa')],
      viewerStates: {},
      annotations: [],
      createdAt: NOW,
      updatedAt: NOW
    }
    const groups = groupBioGymAssets(room, event().snapshot)

    expect(groups.map((group) => group.label)).toEqual([
      'Backbone · attempt 1',
      'Sequence design · attempt 1',
      'Other assets'
    ])
    expect(groups.flatMap((group) => group.assets.map((item) => item.id))).toEqual([
      'backbone', 'sequence', 'notes'
    ])
  })

  it('opens only pending results for the owning active thread', () => {
    const result = event({ threadId: 'thread-2' })
    expect(shouldOpenPendingBioGymRun({
      event: result,
      activeThreadId: 'thread-2',
      route: 'chat',
      pendingThreadIds: new Set(['thread-2'])
    })).toBe(true)
    expect(shouldOpenPendingBioGymRun({
      event: result,
      activeThreadId: 'thread-1',
      route: 'chat',
      pendingThreadIds: new Set(['thread-2'])
    })).toBe(false)
  })

  it('keeps a manually pinned asset until follow mode resumes', () => {
    const room: BiologyRoomManifest = {
      schemaVersion: 1,
      roomId: 'room-1',
      title: 'Protein design',
      revision: 3,
      activeAssetId: 'new-result',
      assets: [asset('pinned', 'pinned.pdb'), asset('new-result', 'new-result.pdb')],
      viewerStates: {},
      annotations: [],
      createdAt: NOW,
      updatedAt: NOW
    }
    expect(resolveBioGymDisplayedAssetId({
      room,
      followRun: false,
      preferredAssetId: 'new-result',
      pinnedAssetId: 'pinned'
    })).toBe('pinned')
    expect(resolveBioGymDisplayedAssetId({
      room,
      followRun: true,
      preferredAssetId: 'new-result',
      pinnedAssetId: 'pinned'
    })).toBe('new-result')
    expect(shouldResetBioGymFollowRun('run-1', 'run-1')).toBe(false)
    expect(shouldResetBioGymFollowRun('run-1', 'run-2')).toBe(true)
    expect(shouldResetBioGymFollowRun('run-1', undefined)).toBe(true)
  })
})

function event(overrides: Partial<BioGymRunEvent> = {}): BioGymRunEvent {
  return {
    type: 'artifact_ready',
    eventId: 'event-2',
    emittedAt: NOW,
    workspaceRoot: '/workspace',
    threadId: 'thread-1',
    designRunId: 'run-1',
    roomId: 'room-1',
    revision: 2,
    snapshot: {
      designRunId: 'run-1',
      roomId: 'room-1',
      workflow: 'de_novo_scaffold',
      objective: 'Design a compact scaffold',
      status: 'running',
      revision: 2,
      currentStageAttemptId: 'sequence-1',
      stages: [{
        id: 'backbone-1',
        kind: 'backbone',
        attempt: 1,
        status: 'succeeded',
        candidateCount: 1,
        activeCandidateId: 'candidate-backbone',
        assetIds: ['backbone'],
        candidates: [{ id: 'candidate-backbone', label: 'Backbone 1', assetId: 'backbone' }]
      }, {
        id: 'sequence-1',
        kind: 'sequence',
        attempt: 1,
        status: 'succeeded',
        candidateCount: 1,
        activeCandidateId: 'candidate-sequence',
        assetIds: ['sequence'],
        candidates: [{ id: 'candidate-sequence', label: 'Sequence 1', assetId: 'sequence' }]
      }],
      budget: {
        maxGpuJobs: 6,
        usedGpuJobs: 2,
        remainingGpuJobs: 4,
        maxWallclockHours: 2,
        elapsedSeconds: 90
      },
      updatedAt: NOW
    },
    ...overrides
  }
}

function asset(id: string, path: string): BiologyRoomManifest['assets'][number] {
  return {
    id,
    path,
    format: path.endsWith('.pdb') ? 'pdb' : 'fasta',
    modality: path.endsWith('.pdb') ? 'structure' : 'sequence',
    sha256: 'a'.repeat(64),
    sizeBytes: 10,
    mtimeMs: 1,
    indexPaths: [],
    createdAt: NOW,
    updatedAt: NOW
  }
}
