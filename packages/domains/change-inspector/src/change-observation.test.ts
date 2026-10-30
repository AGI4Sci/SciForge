import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractUnifiedDiffCandidates,
  projectSessionChangeSnapshot,
  projectSessionChangeSummaries
} from './change-observation.js'
import { CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES } from './contract.js'

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

test('summarizes an empty session into one empty bounded page', () => {
  const snapshot = projectSessionChangeSnapshot('thread-empty', {
    watermark: 'revision-3',
    artifacts: []
  })
  const page = projectSessionChangeSummaries(snapshot, {})
  assert.deepEqual(page.changes, [])
  assert.equal(page.nextCursor, null)
})

test('paginates bounded summaries forward through the canonical snapshot', () => {
  const snapshot = projectSessionChangeSnapshot('thread-many', {
    watermark: 'revision-4',
    artifacts: Array.from({ length: 205 }, (_, index) => ({
      kind: 'tool',
      id: `change-${index}`,
      toolKind: 'file_change',
      status: 'success',
      detail: '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b'
    }))
  })

  const first = projectSessionChangeSummaries(snapshot, { limit: 100 })
  assert.equal(first.changes.length, 100)
  assert.equal(first.changes[0]?.id, 'change-0')
  assert.equal(first.changes.at(-1)?.id, 'change-99')
  assert.equal(first.nextCursor, 'change-99')

  const second = projectSessionChangeSummaries(snapshot, {
    limit: 100,
    cursor: first.nextCursor ?? ''
  })
  assert.equal(second.changes.length, 100)
  assert.equal(second.changes[0]?.id, 'change-100')
  assert.equal(second.nextCursor, 'change-199')

  const third = projectSessionChangeSummaries(snapshot, {
    limit: 100,
    cursor: second.nextCursor ?? ''
  })
  assert.equal(third.changes.length, 5)
  assert.equal(third.nextCursor, null)
})

test('rejects an unknown cursor instead of restarting the walk', () => {
  const snapshot = projectSessionChangeSnapshot('thread-many', {
    watermark: 'revision-4',
    artifacts: [{
      kind: 'tool',
      id: 'change-1',
      toolKind: 'file_change',
      status: 'success',
      detail: '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b'
    }]
  })
  assert.throws(
    () => projectSessionChangeSummaries(snapshot, { cursor: 'change-missing' }),
    /does not match this session/u
  )
})

test('bounds patch summaries to 1KB and flags truncation with byte length', () => {
  const largePatch = [
    'diff --git a/big.txt b/big.txt',
    '--- a/big.txt',
    '+++ b/big.txt',
    `@@ -1 +1 @@`,
    `-${'a'.repeat(4_000)}`,
    `+${'b'.repeat(4_000)}`
  ].join('\n')
  const snapshot = projectSessionChangeSnapshot('thread-large', {
    watermark: 'revision-5',
    artifacts: [{
      kind: 'tool',
      id: 'change-large',
      toolKind: 'file_change',
      status: 'error',
      filePath: 'big.txt',
      createdAt: '2026-10-26T00:00:00.000Z',
      detail: largePatch
    }]
  })

  const page = projectSessionChangeSummaries(snapshot, {})
  const summary = page.changes[0]!
  assert.equal(summary.patchTruncated, true)
  assert.equal(summary.patchBytes, Buffer.byteLength(largePatch))
  assert.ok(summary.patchBytes > CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES)
  assert.ok(
    Buffer.byteLength(summary.patch) <= CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES
  )
  assert.match(summary.patch, /patch truncated by SciForge/u)
  assert.equal(summary.status, 'error')
  assert.equal(summary.filePath, 'big.txt')
  assert.equal(summary.occurredAt, '2026-10-26T00:00:00.000Z')
})

test('passes small patches through untouched with an untruncated flag', () => {
  const smallPatch = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+b'
  const snapshot = projectSessionChangeSnapshot('thread-small', {
    watermark: 'revision-6',
    artifacts: [{
      kind: 'tool',
      id: 'change-small',
      toolKind: 'file_change',
      status: 'success',
      detail: smallPatch
    }]
  })
  const page = projectSessionChangeSummaries(snapshot, {})
  assert.deepEqual(page.changes, [{
    id: 'change-small',
    status: 'success',
    patch: smallPatch,
    patchBytes: Buffer.byteLength(smallPatch),
    patchTruncated: false
  }])
  assert.equal(page.nextCursor, null)
})
