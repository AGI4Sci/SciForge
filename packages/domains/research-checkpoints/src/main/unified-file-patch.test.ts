import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  RESEARCH_CHECKPOINT_PATCH_LIMITS,
  replayUnifiedFilePatchChain,
  type StrictFilePatchReceipt
} from './unified-file-patch.js'

function receipt(
  sequence: number,
  operation: StrictFilePatchReceipt['operation'],
  patchText: string,
  path = 'outputs/result.csv'
): StrictFilePatchReceipt {
  return {
    callId: `apply-patch-${sequence}`,
    executorSequence: sequence,
    path,
    operation,
    patchFormat: operation === 'add' ? 'full-content' : 'unified-hunks',
    patchText,
    patchDigest: createHash('sha256').update(patchText).digest('hex')
  }
}

test('replays the real Codex shape: add full content then ordered raw update hunks', () => {
  const updated = [
    '@@ -1,2 +1,2 @@',
    ' species,count',
    '-Adelie,152',
    '+Adelie,153'
  ].join('\n')
  const appended = [
    '@@ -2,1 +2,2 @@',
    ' Adelie,153',
    '+Gentoo,124'
  ].join('\n')
  const replayed = replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: null,
    receipts: [
      receipt(1, 'add', 'species,count\nAdelie,152\n'),
      receipt(2, 'update', updated),
      receipt(3, 'update', appended)
    ]
  })
  assert.equal(Buffer.from(replayed.bytes!).toString('utf8'), 'species,count\nAdelie,153\nGentoo,124\n')
})

test('applies a real offset raw hunk and preserves missing final newline markers', () => {
  const lines = Array.from({ length: 51 }, (_, index) => `line-${index + 1}`)
  lines[49] = 'old'
  const patch = [
    '@@ -49,3 +49,3 @@ context',
    ' line-49',
    '-old',
    '+new',
    ' line-51',
    '\\ No newline at end of file'
  ].join('\n')
  const replayed = replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from(lines.join('\n')),
    receipts: [receipt(4, 'update', patch)]
  })
  assert.equal(Buffer.from(replayed.bytes!).toString('utf8'), lines.with(49, 'new').join('\n'))
})

test('rejects a no-newline marker in the middle but accepts genuine final old/new markers', () => {
  const middle = [
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
    '\\ No newline at end of file',
    ' tail'
  ].join('\n')
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('old\ntail\n'),
    receipts: [receipt(10, 'update', middle)]
  }), /final output line|context/u)

  const final = [
    '@@ -1 +1 @@',
    '-old',
    '\\ No newline at end of file',
    '+new',
    '\\ No newline at end of file'
  ].join('\n')
  const replayed = replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('old'),
    receipts: [receipt(11, 'update', final)]
  })
  assert.equal(Buffer.from(replayed.bytes!).toString('utf8'), 'new')
})

test('allows an empty full-content add but requires prior identity for update', () => {
  const empty = replayUnifiedFilePatchChain({
    path: 'outputs/result.csv', initialBytes: null, receipts: [receipt(1, 'add', '')]
  })
  assert.equal(empty.bytes?.byteLength, 0)
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: null,
    receipts: [receipt(2, 'update', '@@ -1 +1 @@\n-old\n+new')]
  }), /requires an exact prior Artifact Version/u)
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('old\n'),
    receipts: [receipt(1, 'add', 'new\n')]
  }), /requires the output path to have no prior/u)
})

test('fails closed on digest, path, context, count, format, order, and binary base', () => {
  const valid = '@@ -1 +1 @@\n-old\n+new'
  const base = receipt(2, 'update', valid)
  const cases: Array<readonly [StrictFilePatchReceipt, Uint8Array, RegExp]> = [
    [{ ...base, patchDigest: '0'.repeat(64) }, Buffer.from('old\n'), /digest/u],
    [{ ...base, path: 'outputs/other.csv' }, Buffer.from('old\n'), /path/u],
    [receipt(2, 'update', valid.replace('-old', '-other')), Buffer.from('old\n'), /context/u],
    [receipt(2, 'update', valid.replace('@@ -1 +1 @@', '@@ -1,2 +1 @@')), Buffer.from('old\n'), /line counts/u],
    [{ ...base, patchFormat: 'full-content' }, Buffer.from('old\n'), /format/u],
    [base, Uint8Array.from([0xff]), /strict UTF-8/u]
  ]
  for (const [candidate, bytes, expected] of cases) {
    assert.throws(() => replayUnifiedFilePatchChain({
      path: 'outputs/result.csv', initialBytes: bytes, receipts: [candidate]
    }), expected)
  }
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('old\n'),
    receipts: [receipt(3, 'update', valid), receipt(2, 'update', valid)]
  }), /order/u)
})

test('deletes only by raw hunks that remove the complete exact prior Version', () => {
  const deleted = '@@ -1,2 +0,0 @@\n-a\n-b'
  const replayed = replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('a\nb\n'),
    receipts: [receipt(5, 'delete', deleted)]
  })
  assert.equal(replayed.bytes, null)
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('a\nb\n'),
    receipts: [receipt(5, 'delete', '@@ -1 +0,0 @@\n-a')]
  }), /complete prior file/u)
})

test('rejects git file headers because authenticated receipt path owns targeting', () => {
  const withHeaders = [
    '--- a/outputs/result.csv',
    '+++ b/outputs/result.csv',
    '@@ -1 +1 @@',
    '-old',
    '+new'
  ].join('\n')
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv',
    initialBytes: Buffer.from('old\n'),
    receipts: [receipt(1, 'update', withHeaders)]
  }), /hunk header/u)
})

test('enforces bounded patch and output sizes before allocation grows unbounded', () => {
  const tooLarge = 'x'.repeat(RESEARCH_CHECKPOINT_PATCH_LIMITS.maxPatchBytes + 1)
  assert.throws(() => replayUnifiedFilePatchChain({
    path: 'outputs/result.csv', initialBytes: null, receipts: [receipt(1, 'add', tooLarge)]
  }), /supported bound/u)
})
