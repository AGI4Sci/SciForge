import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GitCheckpointAutoCapture,
  type GitCheckpointTurnEvent
} from '../src/core/auto-capture.js'
import type { GitCheckpointService } from '../src/core/service.js'
import type { GitCheckpointResult, GitCheckpoint } from '../src/contract.js'

const BASE_EVENT: GitCheckpointTurnEvent = {
  kind: 'before-turn',
  state: 'starting',
  runtimeId: 'codex',
  threadId: 'thread-1',
  workspaceRoot: '/workspace',
  occurredAt: '2026-07-28T00:00:00.000Z'
}

function recordingService(
  created: unknown[],
  result?: GitCheckpointResult<GitCheckpoint>
): GitCheckpointService {
  return {
    create: async (input: unknown) => {
      created.push(input)
      return result ?? { ok: true, value: { checkpointId: `cp-${created.length}` } }
    }
  } as unknown as GitCheckpointService
}

test('auto capture captures before/terminal-after turn events once', async () => {
  const created: unknown[] = []
  const capture = new GitCheckpointAutoCapture()
  const service = recordingService(created)

  const first = await capture.captureForEvent(service, BASE_EVENT)
  assert.equal(first.captured, true)
  const duplicate = await capture.captureForEvent(service, BASE_EVENT)
  assert.deepEqual(duplicate, { captured: false, reason: 'duplicate' })

  const afterCompleted = await capture.captureForEvent(service, {
    ...BASE_EVENT,
    kind: 'after-turn',
    turnId: 'turn-1',
    state: 'completed',
    occurredAt: '2026-07-28T00:01:00.000Z'
  })
  assert.equal(afterCompleted.captured, true)

  const afterRunning = await capture.captureForEvent(service, {
    ...BASE_EVENT,
    kind: 'after-turn',
    turnId: 'turn-1',
    state: 'running',
    occurredAt: '2026-07-28T00:00:30.000Z'
  })
  assert.deepEqual(afterRunning, { captured: false, reason: 'skipped' })

  const childTurn = await capture.captureForEvent(service, {
    ...BASE_EVENT,
    kind: 'after-persistent-child-turn',
    turnId: 'turn-child',
    occurredAt: '2026-07-28T00:02:00.000Z'
  })
  assert.deepEqual(childTurn, { captured: false, reason: 'skipped' })

  const noWorkspace = await capture.captureForEvent(service, {
    ...BASE_EVENT,
    workspaceRoot: '',
    occurredAt: '2026-07-28T00:03:00.000Z'
  })
  assert.deepEqual(noWorkspace, { captured: false, reason: 'skipped' })

  assert.equal(created.length, 2)
  assert.deepEqual(
    created.map((input) => (input as { phase: string }).phase),
    ['before-turn', 'after-turn']
  )
  // Only terminal after-turn events carry the turn id.
  assert.equal((created[1] as { turnId?: string }).turnId, 'turn-1')
})

test('auto capture stops retrying workspaces without Git support', async () => {
  const created: unknown[] = []
  const capture = new GitCheckpointAutoCapture()
  const service = recordingService(created, {
    ok: false,
    reason: 'not_git_repo',
    message: 'The selected workspace is not a Git repository.'
  })

  const event: GitCheckpointTurnEvent = {
    ...BASE_EVENT,
    kind: 'after-turn',
    state: 'completed',
    turnId: 'turn-1',
    occurredAt: '2026-07-28T00:01:00.000Z'
  }
  const failed = await capture.captureForEvent(service, event)
  assert.equal(failed.captured, false)
  if (!failed.captured) {
    assert.equal(failed.reason, 'failed')
    assert.equal(failed.failureReason, 'not_git_repo')
  }
  const second = await capture.captureForEvent(service, {
    ...event,
    turnId: 'turn-2',
    occurredAt: '2026-07-28T00:02:00.000Z'
  })
  assert.deepEqual(second, { captured: false, reason: 'unsupported-workspace' })
  assert.equal(created.length, 1)

  capture.reset()
  const afterReset = await capture.captureForEvent(service, {
    ...event,
    turnId: 'turn-3',
    occurredAt: '2026-07-28T00:03:00.000Z'
  })
  assert.equal(afterReset.captured, false)
  assert.equal(created.length, 2)
})
