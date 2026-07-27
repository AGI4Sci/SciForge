import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ProjectDagHandoffOutbox,
  evidenceWatermarkCovers
} from './handoff-outbox.js'

const now = '2026-07-26T05:30:20.000Z'
const digest = `sha256:${'a'.repeat(64)}`
const fingerprint = `project-update-desired:${'b'.repeat(64)}`

test('outbox coalesces duplicate turn events and persists accepted receipt across restart', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-outbox-'))
  try {
    const first = new ProjectDagHandoffOutbox(userDataDir)
    const input = {
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      targetWatermark: '186'
    }
    const left = await first.enqueue(input)
    const right = await first.enqueue(input)
    assert.equal(left.id, right.id)
    assert.equal(first.all().length, 1)

    await first.markAccepted(left.id, {
      projectKey: 'path:/workspace',
      jobId: 'pjob_0123456789ab',
      acceptedRequestVersion: 1,
      desiredFingerprint: fingerprint,
      desiredEvidenceVector: [
        { threadId: 'codex:thread-1', digest }
      ],
      capturedScope: {
        includedSessions: ['codex:thread-1'],
        excludedSessions: [],
        isolatedSessions: []
      },
      state: 'queued',
      acceptedAt: now,
      updatedAt: now
    })

    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal(recovered.all()[0]?.state, 'accepted')
    assert.equal(recovered.ready().length, 0)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('pending record remains actionable after crash-style reload', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'project-handoff-recovery-'))
  try {
    const first = new ProjectDagHandoffOutbox(userDataDir)
    await first.enqueue({
      workspaceRoot: '/workspace',
      runtimeId: 'codex',
      threadId: 'thread-1',
      targetWatermark: '186'
    })
    const recovered = new ProjectDagHandoffOutbox(userDataDir)
    await recovered.load()
    assert.equal(recovered.ready().length, 1)
    assert.equal(recovered.ready()[0]?.attempts, 0)
  } finally {
    await rm(userDataDir, { recursive: true })
  }
})

test('Evidence watermark coverage handles completed adaptive batches monotonically', () => {
  assert.equal(evidenceWatermarkCovers('186:batch:4/4', '186'), true)
  assert.equal(evidenceWatermarkCovers('187', '186'), true)
  assert.equal(evidenceWatermarkCovers('185:batch:4/4', '186'), false)
  assert.equal(evidenceWatermarkCovers('turn:4', 'turn:3'), false)
})
