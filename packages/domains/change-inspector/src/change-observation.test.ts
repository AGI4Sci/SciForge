import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractUnifiedDiffCandidates,
  projectSessionChangeSnapshot
} from './change-observation.js'

test('projects only file-change artifacts into the package-owned snapshot', () => {
  const snapshot = projectSessionChangeSnapshot('thread-1', {
    watermark: '42',
    artifacts: [
      {
        kind: 'tool',
        id: 'command-1',
        toolKind: 'command_execution',
        status: 'success',
        detail: 'npm test'
      },
      {
        kind: 'tool',
        id: 'change-1',
        toolKind: 'file_change',
        status: 'success',
        filePath: '/repo/src/index.ts',
        createdAt: '2026-07-28T00:00:00.000Z',
        detail: [
          'diff --git a/src/index.ts b/src/index.ts',
          '--- a/src/index.ts',
          '+++ b/src/index.ts',
          '@@ -1 +1 @@',
          '-old',
          '+next'
        ].join('\n')
      }
    ]
  })

  assert.equal(snapshot.sessionId, 'thread-1')
  assert.equal(snapshot.revision, '42')
  assert.equal(snapshot.truncated, false)
  assert.deepEqual(snapshot.changes, [{
    id: 'change-1',
    status: 'success',
    filePath: '/repo/src/index.ts',
    patch: [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1 +1 @@',
      '-old',
      '+next'
    ].join('\n'),
    occurredAt: '2026-07-28T00:00:00.000Z'
  }])
})

test('extracts separate unified patches from structured runtime change arrays', () => {
  const candidates = extractUnifiedDiffCandidates(JSON.stringify([
    {
      path: 'src/a.ts',
      diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b'
    },
    {
      file_path: 'src/b.ts',
      patch: '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-c\n+d'
    }
  ]))

  assert.equal(candidates.length, 2)
  assert.equal(candidates[0]?.filePath, 'src/a.ts')
  assert.equal(candidates[1]?.filePath, 'src/b.ts')
})

test('falls back to turn artifacts when the aggregate artifact list is empty', () => {
  const snapshot = projectSessionChangeSnapshot('thread-turns', {
    watermark: 'turn-watermark',
    artifacts: [],
    turns: [{
      id: 'turn-1',
      artifacts: [{
        kind: 'tool',
        id: 'change-turn',
        toolKind: 'file_change',
        status: 'running',
        detail: '--- a/readme.md\n+++ b/readme.md\n@@ -1 +1 @@\n-old\n+new'
      }]
    }]
  })

  assert.equal(snapshot.changes.length, 1)
  assert.equal(snapshot.changes[0]?.status, 'running')
})
