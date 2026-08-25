import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  evidenceDagCommittedFrameKey,
  evidenceDagPanelTarget,
  evidenceDagViewUrlWithNode
} from './EvidenceDagPanel'
import {
  evidenceDagPendingIsActive,
  evidenceDagPollInterval
} from './evidence-dag-progressive-view'

const timestamp = '2026-07-26T04:00:00.000Z'

test('uses generic session identity and validated activation overrides', () => {
  assert.deepEqual(evidenceDagPanelTarget({
    id: 'thread-session',
    runtimeId: 'codex',
    workspaceRoot: '/workspace/lab'
  }), {
    runtimeId: 'codex',
    threadId: 'thread-session',
    workspaceRoot: '/workspace/lab'
  })
  assert.deepEqual(evidenceDagPanelTarget(
    { id: 'thread-session', runtimeId: 'codex' },
    {
      contributionId: 'evidence-dag.workbench-right-panel',
      revision: 2,
      payload: {
        view: 'graph',
        runtimeId: 'claude',
        threadId: 'thread-activation',
        nodeId: 'source-1'
      }
    }
  ), {
    runtimeId: 'claude',
    threadId: 'thread-activation',
    nodeId: 'source-1'
  })
})

test('keys the iframe only by URL and committed snapshot digest', () => {
  assert.equal(
    evidenceDagCommittedFrameKey('http://127.0.0.1:8000/', 'sha256:committed'),
    'http://127.0.0.1:8000/:sha256:committed'
  )
  assert.equal(
    evidenceDagViewUrlWithNode('http://127.0.0.1:8000/', 'source-1', true),
    'http://127.0.0.1:8000/?node=source-1&preview=trusted'
  )
  const source = readFileSync(
    new URL('./EvidenceDagPanel.tsx', import.meta.url),
    'utf8'
  )
  assert.match(source, /<DagWorkbenchFrame/u)
  assert.match(source, /sandbox="allow-forms allow-same-origin allow-scripts"/u)
})

test('polls visible active and failed attempts without inventing progress', () => {
  const queued = {
    state: 'queued' as const,
    jobId: 'job-1',
    targetWatermark: 'turn-1',
    attempt: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const failed = {
    ...queued,
    state: 'failed' as const,
    error: {
      code: 'upstream_timeout' as const,
      message: 'timed out',
      retryable: true,
      occurredAt: timestamp
    }
  }
  assert.equal(evidenceDagPendingIsActive(queued), true)
  assert.equal(evidenceDagPendingIsActive(failed), false)
  assert.equal(evidenceDagPollInterval(true, queued), 5_000)
  assert.equal(evidenceDagPollInterval(true, failed), 10_000)
  assert.equal(evidenceDagPollInterval(false, failed), null)
})
