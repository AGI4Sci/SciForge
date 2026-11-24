import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidCronExpression, nextCronAt, parseCronExpression } from './schedule-cron.js'

function local(iso: string): Date {
  return new Date(iso)
}

test('rejects expressions the scheduler cannot honour', () => {
  for (const expression of [
    '',
    '* * * *',
    '* * * * * *',
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * * 13 *',
    '* * * * 8',
    '*/0 * * * *',
    '*/61 * * * *',
    '1,,2 * * * *',
    'MON * * * *',
    '@daily',
    '5-1 * * * *',
    '1/2/3 * * * *'
  ]) {
    assert.equal(isValidCronExpression(expression), false, expression)
    assert.equal(nextCronAt(expression, local('2026-11-24T10:00:00')), '', expression)
  }
})

test('parses wildcard, list, range and step forms', () => {
  const spec = parseCronExpression('*/15 8-10 1,15 * 1-5')
  assert.ok(spec)
  assert.deepEqual([...spec.minutes].sort((a, b) => a - b), [0, 15, 30, 45])
  assert.deepEqual([...spec.hours].sort((a, b) => a - b), [8, 9, 10])
  assert.deepEqual([...spec.daysOfMonth].sort((a, b) => a - b), [1, 15])
  assert.deepEqual([...spec.daysOfWeek].sort((a, b) => a - b), [1, 2, 3, 4, 5])
  assert.equal(spec.dayOfMonthRestricted, true)
  assert.equal(spec.dayOfWeekRestricted, true)
})

test('treats 7 as Sunday', () => {
  const spec = parseCronExpression('0 9 * * 7')
  assert.ok(spec)
  assert.deepEqual([...spec.daysOfWeek], [0])
})

test('finds the next weekly occurrence strictly after the reference time', () => {
  // 2026-11-24 is a Tuesday; next Monday 09:00 is 2026-11-30.
  const next = nextCronAt('0 9 * * 1', local('2026-11-24T10:00:00'))
  const expected = new Date(2026, 10, 30, 9, 0, 0, 0).toISOString()
  assert.equal(next, expected)
})

test('returns the current minute only when it is still ahead', () => {
  const at = new Date(2026, 10, 30, 8, 59, 30)
  assert.equal(nextCronAt('0 9 * * 1', at), new Date(2026, 10, 30, 9, 0, 0, 0).toISOString())
  const justAfter = new Date(2026, 10, 30, 9, 0, 0)
  assert.equal(nextCronAt('0 9 * * 1', justAfter), new Date(2026, 11, 7, 9, 0, 0, 0).toISOString())
})

test('applies the classic day-of-month OR day-of-week rule', () => {
  // Any Friday, or the 13th of any month. 2026-11-01 is a Sunday, so the
  // first match is Friday 2026-11-06, before the 13th.
  const from = new Date(2026, 10, 1, 12, 0, 0)
  assert.equal(nextCronAt('0 0 13 * 5', from), new Date(2026, 10, 6, 0, 0, 0, 0).toISOString())
  assert.equal(nextCronAt('0 0 13 * 4', from), new Date(2026, 10, 5, 0, 0, 0, 0).toISOString())
})

test('requires both day fields when only one is restricted', () => {
  const next = new Date(nextCronAt('0 0 13 * *', new Date(2026, 10, 1, 12, 0, 0)))
  assert.equal(next.getDate(), 13)
})

test('crosses month and year boundaries', () => {
  const next = nextCronAt('30 6 1 1 *', local('2026-11-24T10:00:00'))
  assert.equal(next, new Date(2027, 0, 1, 6, 30, 0, 0).toISOString())
})

test('honours steps across an hour edge', () => {
  const next = nextCronAt('*/20 * * * *', new Date(2026, 10, 24, 10, 41, 0))
  assert.equal(next, new Date(2026, 10, 24, 11, 0, 0, 0).toISOString())
})

test('returns nothing for an expression that never occurs', () => {
  assert.equal(nextCronAt('0 0 31 2 *', local('2026-11-24T10:00:00')), '')
})

test('finds the next leap day', () => {
  const next = nextCronAt('0 12 29 2 *', local('2026-11-24T10:00:00'))
  assert.equal(next, new Date(2028, 1, 29, 12, 0, 0, 0).toISOString())
})

// Public safety regressions: local calendar scheduling is not numeric coercion.
test('requires decimal tokens and finds leap days across the Gregorian century gap', () => {
  for (const expression of ['0xA * * * *', '1e1 * * * *', '*/0x2 * * * *', '-1 * * * *', '1- * * * *', '1-/2 * * * *']) assert.equal(isValidCronExpression(expression), false, expression)
  assert.equal(nextCronAt('0 12 29 2 *', new Date(2028, 2, 1)), new Date(2032, 1, 29, 12).toISOString())
  assert.equal(nextCronAt('0 12 29 2 *', new Date(2096, 2, 1)), new Date(2104, 1, 29, 12).toISOString())
})
test('local DST policy skips missing minutes and uses the earlier repeated minute once', () => {
  const old = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    assert.equal(nextCronAt('30 2 * * *', new Date('2026-03-08T06:59:00Z')), '2026-03-09T06:30:00.000Z')
    assert.equal(nextCronAt('30 1 * * *', new Date('2026-11-01T04:59:00Z')), '2026-11-01T05:30:00.000Z')
    assert.equal(nextCronAt('30 1 * * *', new Date('2026-11-01T05:30:00Z')), '2026-11-02T06:30:00.000Z')
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old }
})
