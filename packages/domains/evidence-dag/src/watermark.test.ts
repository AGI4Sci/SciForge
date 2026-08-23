import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evidenceDagWatermarkCoversValue,
  laterEvidenceDagWatermark
} from './contract.js'

test('proves coverage only for canonical comparable Evidence watermarks', () => {
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:1/4', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:2/4', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:4/4', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('187', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('185:batch:4/4', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('turn:4', 'turn:3'), false)
  assert.equal(
    evidenceDagWatermarkCoversValue('turn:3:batch:4/4', 'turn:3'),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue('opaque:event-9:batch:4/4', 'opaque:event-9'),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      'opaque:event-9:batch:2/4',
      'opaque:event-9:batch:1/2'
    ),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue('opaque:event-10', 'opaque:event-9'),
    false
  )
  assert.equal(evidenceDagWatermarkCoversValue('20:event-b', '20:event-a'), false)
  assert.equal(evidenceDagWatermarkCoversValue('20:event-a', '20:event-b'), false)
})

test('keeps lifecycle receipts in independent coverage families', () => {
  assert.equal(evidenceDagWatermarkCoversValue('8', '7:artifact-lifecycle:1'), false)
  assert.equal(evidenceDagWatermarkCoversValue('7:artifact-lifecycle:1', '7'), false)
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '7:artifact-lifecycle:1:batch:4/4',
      '7:artifact-lifecycle:1'
    ),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '7:artifact-lifecycle:2',
      '7:artifact-lifecycle:1'
    ),
    false
  )
})

test('compares strict timestamps without calendar normalization or precision loss', () => {
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '2026-01-01T00:00:00.0001Z',
      '2026-01-01T00:00:00.0009Z'
    ),
    false
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '2026-01-01T00:00:00.0009Z',
      '2026-01-01T00:00:00.0001Z'
    ),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '2026-02-30T00:00:00Z',
      '2026-02-28T00:00:00Z'
    ),
    false
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '2026-01-01T01:00:00+01:00',
      '2026-01-01T00:00:00Z'
    ),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '0001-01-01T00:00:00+23:00',
      '0001-01-01T00:00:00Z'
    ),
    false
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '9999-12-31T23:59:59-23:00',
      '9999-12-31T23:59:59Z'
    ),
    false
  )
})

test('refuses to choose a later watermark when ordering is not provable', () => {
  assert.equal(laterEvidenceDagWatermark('19:event-a', '20:event-b'), '20:event-b')
  assert.equal(laterEvidenceDagWatermark('20:event-b', '19:event-a'), '20:event-b')
  assert.equal(laterEvidenceDagWatermark('20:event-a', '20:event-b'), undefined)
  assert.equal(laterEvidenceDagWatermark('turn:3', 'turn:4'), undefined)
})
