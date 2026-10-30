import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  projectDagCommittedFrameKey,
  projectDagEvidenceActivation,
  projectDagFrameUrl,
  projectDagPanelTarget,
  projectDagUpdateScope
} from './ProjectDagPanel'
import { projectDagCanonicalSessionId } from './project-dag-session'
import {
  projectDagPendingIsActive,
  projectDagPollInterval
} from './project-dag-progressive-view'

const timestamp = '2026-07-26T04:00:00.000Z'

test('derives the Project target from generic session and activation context', () => {
  assert.deepEqual(projectDagPanelTarget({
    id: 'session-1',
    workspaceRoot: '/workspace/lab'
  }), {
    workspaceRoot: '/workspace/lab',
    projectRoot: '/workspace/lab',
    view: 'home'
  })
  assert.deepEqual(projectDagPanelTarget(
    { id: 'session-1', workspaceRoot: '/workspace/lab' },
    {
      contributionId: 'project-dag.workbench-right-panel',
      revision: 3,
      payload: {
        project: 'paper-reading',
        view: 'graph',
        focus: { claimId: 'claim-1', nodeId: 'node-1' }
      }
    }
  ), {
    workspaceRoot: '/workspace/lab',
    projectRoot: '/workspace/lab',
    project: 'paper-reading',
    view: 'graph',
    focus: { claimId: 'claim-1', nodeId: 'node-1' }
  })
})

test('builds cross-panel Evidence activation through public domain contracts', () => {
  const digest = `sha256:${'d'.repeat(64)}`
  assert.deepEqual(projectDagEvidenceActivation('codex:thread-1', digest, 4), {
    contributionId: 'evidence-dag.workbench-right-panel',
    revision: 4,
    payload: {
      view: 'graph',
      runtimeId: 'codex',
      threadId: 'thread-1',
      snapshotDigest: digest
    }
  })
  assert.equal(projectDagEvidenceActivation('invalid', digest, 4), null)
})

test('uses only URL and committed digest for iframe remounts', () => {
  assert.equal(
    projectDagCommittedFrameKey('http://127.0.0.1:9000/', 'sha256:committed'),
    'http://127.0.0.1:9000/:sha256:committed'
  )
  assert.equal(
    projectDagFrameUrl('http://127.0.0.1:9000/', 'claim-1', 'node-1'),
    'http://127.0.0.1:9000/?claim=claim-1&node=node-1'
  )
  const source = readFileSync(
    new URL('./ProjectDagPanel.tsx', import.meta.url),
    'utf8'
  )
  assert.match(
    source,
    /sandbox="allow-downloads allow-forms allow-same-origin allow-scripts"/u
  )
})

test('derives update scope and polls failed attempts only while visible', () => {
  const receipt = {
    projectKey: 'lab',
    jobId: 'job-1',
    acceptedRequestVersion: 1,
    desiredFingerprint: `sha256:${'a'.repeat(64)}`,
    desiredEvidenceVector: [],
    capturedScope: {
      includedSessions: ['session-2', 'session-1'],
      excludedSessions: ['session-3'],
      isolatedSessions: []
    },
    state: 'failed' as const,
    acceptedAt: timestamp,
    updatedAt: timestamp
  }
  const failed = {
    state: 'failed' as const,
    receipt,
    attempts: 5,
    updatedAt: timestamp,
    error: {
      code: 'upstream_timeout' as const,
      message: 'timed out',
      retryable: true
    }
  }
  assert.deepEqual(projectDagUpdateScope({
    projectKey: 'lab',
    committed: null,
    pending: failed,
    scope: receipt.capturedScope,
    autonomyMode: 'autonomous',
    attentionCount: 0
  }), ['session-1', 'session-2', 'session-3'])
  assert.equal(projectDagPendingIsActive(failed), false)
  assert.equal(projectDagPollInterval(true, failed), 10_000)
  assert.equal(projectDagPollInterval(false, failed), null)
})

test('initializes Project updates with the current canonical Session', () => {
  assert.equal(
    projectDagCanonicalSessionId('thread-1', 'codex'),
    'codex:thread-1'
  )
  assert.equal(
    projectDagCanonicalSessionId('codex:thread-1', 'codex'),
    'codex:codex:thread-1'
  )
  assert.equal(
    projectDagCanonicalSessionId('workflow:stable', 'sciforge'),
    'sciforge:workflow:stable'
  )
  assert.equal(
    projectDagCanonicalSessionId('codex:thread-1', 'runtime-with-colon'),
    'runtime-with-colon:codex:thread-1'
  )
  assert.equal(projectDagCanonicalSessionId('thread-1'), null)
  assert.equal(projectDagCanonicalSessionId('thread:with:colon'), null)
  assert.deepEqual(projectDagUpdateScope(undefined, 'codex:thread-1'), [
    'codex:thread-1'
  ])
  assert.deepEqual(projectDagUpdateScope({
    projectKey: 'lab',
    committed: null,
    pending: null,
    scope: {
      includedSessions: [],
      excludedSessions: [],
      isolatedSessions: []
    },
    autonomyMode: 'autonomous',
    attentionCount: 0
  }, 'codex:thread-1'), ['codex:thread-1'])
  assert.deepEqual(projectDagUpdateScope(undefined), [])
})

test('keeps durable receipt state in the progressive update view', () => {
  const source = readFileSync(
    new URL('./ProjectDagPanel.tsx', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(source, /setSummary\(result\.data\.receipt\.state\)/u)
  assert.match(source, /setView\(result\.data\)\s+setSummary\(null\)/u)
  assert.match(source, /<ProjectDagProgressiveView status=\{status\}/u)
})
