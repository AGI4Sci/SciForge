import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHANGE_INSPECTOR_MAX_PATCH_BYTES,
  CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES,
  CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES,
  changeInspectorChangeSchema,
  changeInspectorChangeSummarySchema,
  changeInspectorSnapshotSchema
} from '../src/contract.js'
import {
  extractUnifiedDiffCandidates,
  projectSessionChangeSnapshot,
  projectSessionChangeSummaries
} from '../src/core/change-observation.js'

const HEADER = '@@ -1 +1 @@\n-old\n+'
const MARKER = '\n… patch truncated by SciForge …'
const bytes = (value: string) => Buffer.byteLength(value, 'utf8')
const artifact = (id: string, patch: string, extra: Record<string, unknown> = {}) => ({
  kind: 'tool', toolKind: 'file_change', id, detail: patch, ...extra
})
const snapshot = (patch: string, watermark = 'unchanged-watermark') =>
  projectSessionChangeSnapshot('session-a', { watermark, artifacts: [artifact('change-a', patch)] })

function assertBoundedPatch(patch: string, budget: number): void {
  assert.ok(bytes(patch) <= budget)
  assert.ok(!patch.includes('\uFFFD'), 'projection must not introduce replacement characters')
  assert.ok(patch.endsWith(MARKER), 'truncated content must carry an explicit explanation')
}

test('a multi-megabyte patch projects instead of failing at the marker boundary', () => {
  const original = `${HEADER}${'x'.repeat(2_000_001)}`
  const result = snapshot(original)
  const change = result.changes[0]!
  assert.equal(change.patchBytes, bytes(original))
  assert.equal(change.patchTruncated, true)
  assertBoundedPatch(change.patch, CHANGE_INSPECTOR_MAX_PATCH_BYTES)
  assert.equal(bytes(change.patch), CHANGE_INSPECTOR_MAX_PATCH_BYTES)
  assert.equal(result.truncated, true)
  assert.deepEqual(result.truncationReasons, ['patch-byte-limit'])
  assert.ok(bytes(JSON.stringify(result)) <= CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES)
  assert.deepEqual(changeInspectorSnapshotSchema.parse(result), result)
})

test('patches exactly at the byte budget remain unchanged; one byte over truncates', () => {
  const exact = `${HEADER}${'x'.repeat(CHANGE_INSPECTOR_MAX_PATCH_BYTES - bytes(HEADER))}`
  const atLimit = snapshot(exact)
  assert.equal(atLimit.changes[0]!.patch, exact)
  assert.equal(atLimit.changes[0]!.patchBytes, CHANGE_INSPECTOR_MAX_PATCH_BYTES)
  assert.equal(atLimit.changes[0]!.patchTruncated, false)
  assert.equal(atLimit.truncated, false)
  assert.deepEqual(atLimit.truncationReasons, [])
  assertBoundedPatch(snapshot(`${exact}x`).changes[0]!.patch, CHANGE_INSPECTOR_MAX_PATCH_BYTES)
})

test('UTF-8 truncation preserves complete 2-, 3-, and 4-byte scalars at every boundary', () => {
  for (const scalar of ['é', '汉', '🧬']) {
    for (let padding = 0; padding < bytes(scalar); padding += 1) {
      const original = `${HEADER}${'a'.repeat(padding)}${scalar.repeat(40_000)}`
      // These strings can be below 64Ki UTF-16 code units but over 64KiB UTF-8.
      const change = snapshot(original).changes[0]!
      assert.equal(change.patchBytes, bytes(original))
      assertBoundedPatch(change.patch, CHANGE_INSPECTOR_MAX_PATCH_BYTES)
      const head = change.patch.slice(0, -MARKER.length)
      assert.ok(original.startsWith(head))
      assert.ok(CHANGE_INSPECTOR_MAX_PATCH_BYTES - bytes(change.patch) < bytes(scalar))
      const summary = projectSessionChangeSummaries(snapshot(original), {}).changes[0]!
      assertBoundedPatch(summary.patch, CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES)
      assert.ok(original.startsWith(summary.patch.slice(0, -MARKER.length)))
      assert.equal(summary.patchBytes, bytes(original))
      assert.equal(summary.patchTruncated, true)
    }
  }
})

test('list summaries preserve original byte counts through the second truncation', () => {
  for (const size of [200, 1_024, 1_025, 65_537]) {
    const original = `${HEADER}${'x'.repeat(size - bytes(HEADER))}`
    const summary = projectSessionChangeSummaries(snapshot(original), {}).changes[0]!
    assert.equal(summary.patchBytes, size)
    assert.equal(summary.patchTruncated, size > CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES)
    if (summary.patchTruncated) {
      assertBoundedPatch(summary.patch, CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES)
    } else {
      assert.equal(summary.patch, original)
    }
  }
})

test('aggregate snapshot budget counts JSON escaping and keeps a contiguous newest suffix', () => {
  for (const body of ['x'.repeat(50_000), '\u0000'.repeat(50_000), '汉'.repeat(15_000)]) {
    const artifacts = Array.from({ length: 12 }, (_, index) => artifact(`change-${index}`, `${HEADER}${body}`))
    const result = projectSessionChangeSnapshot('session-a', { watermark: 'same', artifacts })
    assert.ok(bytes(JSON.stringify(result)) <= CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES)
    assert.equal(result.truncated, true)
    assert.ok(result.truncationReasons.includes('snapshot-byte-limit'))
    assert.ok(result.changes.length < artifacts.length)
    assert.deepEqual(result.changes.map(change => change.id),
      artifacts.slice(artifacts.length - result.changes.length).map(change => change.id))
    if (bytes(JSON.stringify({ patch: `${HEADER}${body}` })) > CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES) {
      assert.equal(result.changes.length, 0)
    } else {
      assert.ok(result.changes.length > 0)
      assert.equal(result.changes.at(-1)!.id, 'change-11')
    }
  }
})

test('large change counts carry explicit count and aggregate explanations', () => {
  const artifacts = Array.from({ length: 5_001 }, (_, index) => artifact(`bulk-${index}`, `${HEADER}new`))
  const result = projectSessionChangeSnapshot('session-a', { watermark: 'same', artifacts })
  assert.ok(result.changes.length <= 5_000)
  assert.ok(bytes(JSON.stringify(result)) <= CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES)
  assert.ok(result.truncationReasons.includes('change-count-limit'))
  assert.equal(result.changes.at(-1)!.id, 'bulk-5000')
})

test('revision hashes full file-change content independently of watermark, including omitted patch tails', () => {
  const prefix = `${HEADER}${'x'.repeat(70_000)}`
  const first = snapshot(`${prefix}A`)
  const second = snapshot(`${prefix}B`)
  assert.equal(first.changes[0]!.patch, second.changes[0]!.patch)
  assert.notEqual(first.revision, second.revision)
  assert.match(first.revision, /^changes-[a-f0-9]{64}$/u)
  assert.equal(first.revision, snapshot(`${prefix}A`).revision)
  assert.equal(first.revision, snapshot(`${prefix}A`, 'other-watermark').revision)
  assert.notEqual(snapshot(`${HEADER}new`).revision, snapshot(`${HEADER}NEW`).revision)
})

test('revision includes normalized status/path/time metadata and discarded old changes', () => {
  const base = { watermark: 'same', artifacts: [artifact('a', `${HEADER}new`)] }
  const original = projectSessionChangeSnapshot('session-a', base)
  for (const extra of [{ status: 'error' }, { filePath: 'other.ts' }, { createdAt: '2026-11-03T00:00:00Z' }]) {
    assert.notEqual(original.revision, projectSessionChangeSnapshot('session-a', {
      ...base, artifacts: [artifact('a', `${HEADER}new`, extra)]
    }).revision)
  }
  const tail = Array.from({ length: 8 }, (_, index) => artifact(`tail-${index}`, `${HEADER}${'x'.repeat(60_000)}`))
  const left = projectSessionChangeSnapshot('session-a', { watermark: 'same', artifacts: [artifact('old', `${HEADER}A`), ...tail] })
  const right = projectSessionChangeSnapshot('session-a', { watermark: 'same', artifacts: [artifact('old', `${HEADER}B`), ...tail] })
  assert.deepEqual(left.changes, right.changes)
  assert.notEqual(left.revision, right.revision)
})

test('cursors paginate repeated artifact ids and reject stale round and cross-session reuse', () => {
  const source = { watermark: 'same', artifacts: [
    artifact('repeated', `${HEADER}a`), artifact('repeated', `${HEADER}b`), artifact('third', `${HEADER}c`)
  ] }
  const firstSnapshot = projectSessionChangeSnapshot('session-a', source)
  const page1 = projectSessionChangeSummaries(firstSnapshot, { limit: 1 })
  assert.ok(page1.nextCursor)
  assert.ok(page1.nextCursor.length <= 512)
  const page2 = projectSessionChangeSummaries(firstSnapshot, { limit: 1, cursor: page1.nextCursor })
  assert.equal(page2.changes[0]!.patch, `${HEADER}b`)
  assert.ok(page2.nextCursor)
  const page3 = projectSessionChangeSummaries(firstSnapshot, { limit: 1, cursor: page2.nextCursor })
  assert.equal(page3.changes[0]!.id, 'third')
  assert.equal(page3.nextCursor, null)
  const nextRound = projectSessionChangeSnapshot('session-a', {
    ...source, artifacts: [...source.artifacts, artifact('fourth', `${HEADER}d`)]
  })
  assert.throws(() => projectSessionChangeSummaries(nextRound, { cursor: page1.nextCursor! }), /cursor does not match/u)
  assert.throws(() => projectSessionChangeSummaries(projectSessionChangeSnapshot('session-b', source), {
    cursor: page1.nextCursor!
  }), /cursor does not match/u)
})

test('watermark and non-change tools preserve revision and pagination, including fallback identities', () => {
  const changes = [
    artifact('price-edit', `${HEADER}price`, { filePath: 'price.js' }),
    { kind: 'tool', toolKind: 'file_change', detail: `${HEADER}test`, filePath: 'price.test.js' }
  ]
  const first = projectSessionChangeSnapshot('session-a', { watermark: 'before-list', artifacts: changes })
  const page1 = projectSessionChangeSummaries(first, { limit: 1 })
  assert.ok(page1.nextCursor)
  const afterRead = projectSessionChangeSnapshot('session-a', {
    watermark: 'after-list-and-read',
    artifacts: [
      { kind: 'tool', toolKind: 'read', id: 'read-before', detail: 'read price.js' },
      changes[0],
      { kind: 'message', detail: 'inspecting changes' },
      { kind: 'tool', toolKind: 'file_read', detail: 'read price.test.js' },
      changes[1],
      { kind: 'tool', toolKind: 'plugin', detail: 'change_inspector.list_changes' }
    ]
  })
  assert.equal(afterRead.revision, first.revision)
  assert.deepEqual(afterRead.changes, first.changes)
  const page2 = projectSessionChangeSummaries(afterRead, { limit: 1, cursor: page1.nextCursor })
  assert.equal(page2.changes[0]!.filePath, 'price.test.js')
  assert.equal(page2.nextCursor, null)
  assert.equal(
    projectSessionChangeSnapshot('session-a', { watermark: 'empty-1', artifacts: [] }).revision,
    projectSessionChangeSnapshot('session-a', {
      watermark: 'empty-2', artifacts: [{ kind: 'tool', toolKind: 'read', detail: 'read' }]
    }).revision
  )
  for (const added of [
    artifact('new-edit', `${HEADER}new`),
    artifact('same-content-new-identity', changes[0]!.detail),
    artifact('pending-edit', 'waiting for diff', { status: 'running' }),
    artifact('no-diff-yet', '')
  ]) {
    const next = projectSessionChangeSnapshot('session-a', {
      watermark: 'after-list-and-read', artifacts: [...changes, added]
    })
    assert.notEqual(next.revision, first.revision)
    assert.throws(() => projectSessionChangeSummaries(next, { cursor: page1.nextCursor! }), /cursor does not match/u)
  }
})

test('unknown, malformed and out-of-range cursors fail closed; direct limits are bounded', () => {
  const result = projectSessionChangeSnapshot('session-a', {
    watermark: 'same', artifacts: [artifact('a', `${HEADER}a`), artifact('b', `${HEADER}b`)]
  })
  const cursor = projectSessionChangeSummaries(result, { limit: 1 }).nextCursor!
  const prefix = cursor.slice(0, cursor.lastIndexOf(':') + 1)
  for (const invalid of ['a', 'unknown', `${prefix}0`, `${prefix}-1`, `${prefix}01`, `${prefix}2`, `${prefix}NaN`, `${prefix}9007199254740993`]) {
    assert.throws(() => projectSessionChangeSummaries(result, { cursor: invalid }), /cursor does not match/u)
  }
  for (const limit of [0, -1, 1.5, 501, NaN, Infinity]) {
    assert.throws(() => projectSessionChangeSummaries(result, { limit }), /limit/u)
  }
})

test('candidate extraction retains full original normalized data until canonical projection', () => {
  const original = `${HEADER}${'汉'.repeat(30_000)}`
  assert.equal(extractUnifiedDiffCandidates(original)[0]!.patch, original)
  assert.equal(extractUnifiedDiffCandidates(JSON.stringify({ path: '汉.ts', patch: original }))[0]!.patch, original)
  const change = projectSessionChangeSnapshot('session-a', {
    watermark: 'same', artifacts: [artifact('a', JSON.stringify({ path: '汉.ts', patch: original }))]
  }).changes[0]!
  assert.equal(change.filePath, '汉.ts')
  assert.equal(change.patchBytes, bytes(original))
  assertBoundedPatch(change.patch, CHANGE_INSPECTOR_MAX_PATCH_BYTES)
})

test('plain and JSON patches retain exact spaces, LF and CRLF bytes', () => {
  for (const ending of ['   \n', '  \r\n', '\n', '\r\n', '   ']) {
    const original = `--- a\r\n+++ a\r\n@@ -1 +1 @@\r\n-before\r\n+after${ending}`
    for (const detail of [original, JSON.stringify({ changes: [{ path: 'a', diff: original }] })]) {
      const result = snapshot(detail)
      assert.equal(result.changes[0]!.patch, original)
      assert.equal(result.changes[0]!.patchBytes, bytes(original))
      assert.equal(result.changes[0]!.patchTruncated, false)
      assert.deepEqual(result.truncationReasons, [])
      assert.equal(projectSessionChangeSummaries(result, {}).changes[0]!.patch, original)
    }
  }
})

test('whitespace at 65536 and 65537 bytes participates in original budgets and revisions', () => {
  for (const ending of [' \n', '\r\n', '  ']) {
    for (const size of [65_536, 65_537]) {
      const original = `${HEADER}${'x'.repeat(size - bytes(HEADER) - bytes(ending))}${ending}`
      for (const detail of [original, JSON.stringify({ patch: original })]) {
        const result = snapshot(detail)
        assert.equal(result.changes[0]!.patchBytes, size)
        assert.equal(result.changes[0]!.patchTruncated, size > 65_536)
        assert.deepEqual(result.truncationReasons, size > 65_536 ? ['patch-byte-limit'] : [])
        if (size === 65_536) assert.equal(result.changes[0]!.patch, original)
        else assertBoundedPatch(result.changes[0]!.patch, 65_536)
      }
    }
  }
  for (const wrap of [(value: string) => value, (value: string) => JSON.stringify({ diff: value })]) {
    const first = snapshot(wrap(`${HEADER}after \n`))
    for (const changed of [`${HEADER}after  \n`, `${HEADER}after \r\n`, `${HEADER}after `]) {
      assert.notEqual(first.revision, snapshot(wrap(changed)).revision)
    }
  }
})

test('contract enforces UTF-8 patch and summary budgets, not UTF-16 lengths', () => {
  const change = snapshot(`${HEADER}new`).changes[0]!
  assert.throws(() => changeInspectorChangeSchema.parse({ ...change, patch: '汉'.repeat(22_000) }), /byte budget/u)
  assert.throws(() => changeInspectorChangeSummarySchema.parse({ ...change, patch: '汉'.repeat(400) }), /byte budget/u)
})
