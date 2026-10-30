/**
 * Unit tests pinning the projection behaviour with literal expectations.
 * They are the post-migration guard for the truncation and hashing rules
 * once the static module (and with it the parity test's reference) is gone.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractUnifiedDiffCandidates,
  projectSessionChangeSnapshot
} from '../src/core/change-observation.js'
import {
  hugePatchSession,
  manyChangesSession
} from './cases.js'

const DIFF_A = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new'
const DIFF_B = '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-x\n+y'

test('plain diff detail uses the artifact fallback filePath', () => {
  const [candidate] = extractUnifiedDiffCandidates(DIFF_A, 'src/a.ts')
  assert.deepEqual(candidate, { patch: DIFF_A, filePath: 'src/a.ts' })
  const [noPath] = extractUnifiedDiffCandidates(DIFF_A)
  assert.deepEqual(noPath, { patch: DIFF_A })
})

test('JSON detail: path beats filePath beats file_path beats fallback; first diff key wins', () => {
  const [byPath] = extractUnifiedDiffCandidates(
    JSON.stringify({ path: 'p.ts', filePath: 'fp.ts', file_path: 'f_p.ts', diff: DIFF_A })
  )
  assert.equal(byPath?.filePath, 'p.ts')
  const [byFilePath] = extractUnifiedDiffCandidates(
    JSON.stringify({ filePath: 'fp.ts', file_path: 'f_p.ts', patch: DIFF_B })
  )
  assert.equal(byFilePath?.filePath, 'fp.ts')
  const [bySnake] = extractUnifiedDiffCandidates(
    JSON.stringify({ file_path: 'f_p.ts', unified_diff: DIFF_A })
  )
  assert.equal(bySnake?.filePath, 'f_p.ts')
  const [byFallback] = extractUnifiedDiffCandidates(
    JSON.stringify({ unifiedDiff: DIFF_B }),
    'fallback.ts'
  )
  assert.equal(byFallback?.filePath, 'fallback.ts')
  const [firstKey] = extractUnifiedDiffCandidates(
    JSON.stringify({ diff: DIFF_A, patch: DIFF_B })
  )
  assert.equal(firstKey?.patch, DIFF_A)
})

test('non-string, empty, prose and diff-less JSON details produce no candidates', () => {
  assert.deepEqual(extractUnifiedDiffCandidates(undefined), [])
  assert.deepEqual(extractUnifiedDiffCandidates({ diff: DIFF_A }), [])
  assert.deepEqual(extractUnifiedDiffCandidates('   '), [])
  assert.deepEqual(extractUnifiedDiffCandidates('just prose'), [])
  assert.deepEqual(extractUnifiedDiffCandidates('{"foo": "bar"}'), [])
  assert.deepEqual(extractUnifiedDiffCandidates('{broken json'), [])
})

test('nested changes recurse and inherit the outer filePath', () => {
  const candidates = extractUnifiedDiffCandidates(
    JSON.stringify({
      path: 'outer.ts',
      changes: [{ diff: DIFF_A }, { filePath: 'inner.ts', patch: DIFF_B }]
    })
  )
  assert.deepEqual(candidates, [
    { patch: DIFF_A, filePath: 'outer.ts' },
    { patch: DIFF_B, filePath: 'inner.ts' }
  ])
})

test('status mapping keeps running/error, maps everything else to success', () => {
  const artifact = (status: unknown) => ({
    kind: 'tool',
    toolKind: 'file_change',
    id: 'a',
    ...(status === undefined ? {} : { status }),
    detail: DIFF_A
  })
  const snapshot = projectSessionChangeSnapshot('s', {
    watermark: 'wm',
    artifacts: [artifact('running'), artifact('error'), artifact('cancelled'), artifact(undefined)]
  })
  assert.deepEqual(
    snapshot.changes.map((change) => change.status),
    ['running', 'error', 'success', 'success']
  )
})

test('occurredAt normalizes valid datetimes to ISO and drops invalid ones', () => {
  const snapshot = projectSessionChangeSnapshot('s', {
    watermark: 'wm',
    artifacts: [
      { kind: 'tool', toolKind: 'file_change', id: 'a', createdAt: '2026-07-28T10:00:00+08:00', detail: DIFF_A },
      { kind: 'tool', toolKind: 'file_change', id: 'b', createdAt: 'not-a-date', detail: DIFF_A },
      { kind: 'tool', toolKind: 'file_change', id: 'c', createdAt: 123, detail: DIFF_A }
    ]
  })
  assert.equal(snapshot.changes[0]?.occurredAt, '2026-07-28T02:00:00.000Z')
  assert.equal(snapshot.changes[1]?.occurredAt, undefined)
  assert.equal(snapshot.changes[2]?.occurredAt, undefined)
})

test('artifact id falls back to file-change-<index>; extra candidates get :n suffixes', () => {
  const snapshot = projectSessionChangeSnapshot('s', {
    watermark: 'wm',
    artifacts: [
      { kind: 'tool', toolKind: 'file_change', detail: DIFF_A },
      {
        kind: 'tool',
        toolKind: 'file_change',
        id: 'multi',
        detail: JSON.stringify([{ diff: DIFF_A }, { patch: DIFF_B }])
      }
    ]
  })
  assert.deepEqual(
    snapshot.changes.map((change) => change.id),
    ['file-change-0', 'multi', 'multi:1']
  )
})

test('turn artifacts are used only when top-level artifacts are empty', () => {
  const source = (artifacts: readonly unknown[]) => ({
    watermark: 'wm',
    artifacts,
    turns: [
      { id: 'turn-1', artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 't1', detail: DIFF_A }] },
      { id: 'turn-2', artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 't2', detail: DIFF_B }] }
    ]
  })
  const fromTurns = projectSessionChangeSnapshot('s', source([]))
  assert.deepEqual(fromTurns.changes.map((change) => change.id), ['t1', 't2'])
  const fromTop = projectSessionChangeSnapshot('s', source([
    { kind: 'tool', toolKind: 'file_change', id: 'top', detail: DIFF_A }
  ]))
  assert.deepEqual(fromTop.changes.map((change) => change.id), ['top'])
})

test('more than 5000 changes truncate to the LAST 5000', () => {
  const snapshot = projectSessionChangeSnapshot('s', manyChangesSession(5_001))
  assert.equal(snapshot.truncated, true)
  assert.equal(snapshot.changes.length, 5_000)
  assert.equal(snapshot.changes[0]?.id, 'bulk-1')
  assert.equal(snapshot.changes.at(-1)?.id, 'bulk-5000')
})

test('a patch over 2MB is rejected by the contract, exactly like the static module', () => {
  // The truncation marker is 31 characters while truncatePatch reserves only
  // 30, so a truncated patch lands at 2,000,001 characters and the snapshot
  // schema rejects it. This is the static module's observed behaviour; the
  // plugin keeps it byte-exact (fixing it is a contract change, not part of
  // the runtime-plugin migration).
  assert.throws(
    () => projectSessionChangeSnapshot('s', hugePatchSession()),
    (error: unknown) => {
      assert.match(
        (error as Error).message,
        /Too big: expected string to have <=2000000 characters/u
      )
      return true
    }
  )
})

test('revision passes short watermarks through and hashes long or empty ones', () => {
  const short = projectSessionChangeSnapshot('s', { watermark: 'wm-7', artifacts: [] })
  assert.equal(short.revision, 'wm-7')
  const long = projectSessionChangeSnapshot('s', {
    watermark: 'w'.repeat(300),
    artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 'a', detail: DIFF_A }]
  })
  assert.match(long.revision, /^changes-[0-9a-f]{1,8}$/u)
  const empty = projectSessionChangeSnapshot('s', { watermark: '', artifacts: [] })
  assert.match(empty.revision, /^changes-[0-9a-f]{1,8}$/u)
  assert.notEqual(long.revision, empty.revision)
  // Deterministic for identical inputs.
  const again = projectSessionChangeSnapshot('s', {
    watermark: 'w'.repeat(300),
    artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 'a', detail: DIFF_A }]
  })
  assert.equal(again.revision, long.revision)
})
