import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReports } from './compare-capability-eval-runs.mjs'

function makeEntry(runIndex, overrides = {}) {
  return {
    caseId: 'routing-case',
    outcome: 'PASS',
    passed: true,
    failures: [],
    scores: { taskSuccess: 1 },
    actual: {
      runId: `run-${runIndex}`,
      runIndex,
      invocations: [{ actionId: 'search', success: true }]
    },
    ...overrides
  }
}

function makeReport(cases) {
  return {
    executionMode: 'live-agent',
    metrics: { passRate: 1 },
    metricCoverage: { passRate: cases.length },
    evidenceCoverage: {},
    cases
  }
}

function wrapped(report) {
  return { path: 'fixture.json', report }
}

test('compares every repeated run by stable run identity', () => {
  const left = makeReport([makeEntry(1), makeEntry(2), makeEntry(3)])
  const right = makeReport([makeEntry(1), makeEntry(2), makeEntry(3)])

  const comparison = compareReports(wrapped(left), wrapped(right))

  assert.deepEqual(comparison.summary, {
    totalCases: 3,
    matchingCases: 3,
    divergentCases: 0,
    aggregateMetricDrift: 0,
    aggregateCoverageDrift: false,
    pass: true
  })
  assert.deepEqual(comparison.cases.map((entry) => entry.runId), ['run-1', 'run-2', 'run-3'])
})

test('attributes a repeated-run divergence to the changed run', () => {
  const left = makeReport([makeEntry(1), makeEntry(2), makeEntry(3)])
  const right = makeReport([
    makeEntry(1),
    makeEntry(2, { outcome: 'FAIL', passed: false, failures: [{ type: 'wrong_action' }] }),
    makeEntry(3)
  ])

  const comparison = compareReports(wrapped(left), wrapped(right))

  assert.equal(comparison.summary.totalCases, 3)
  assert.equal(comparison.summary.matchingCases, 2)
  assert.equal(comparison.summary.divergentCases, 1)
  assert.deepEqual(comparison.divergences[0], {
    caseId: 'routing-case',
    runId: 'run-2',
    runIndex: 2,
    reasons: ['outcome', 'passed', 'failure-types']
  })
})

test('retains compatibility with a single legacy case without run identity', () => {
  const left = makeReport([{ ...makeEntry(1), actual: { invocations: [] } }])
  const right = makeReport([{ ...makeEntry(1), actual: { invocations: [] } }])

  const comparison = compareReports(wrapped(left), wrapped(right))

  assert.equal(comparison.summary.totalCases, 1)
  assert.equal(comparison.cases[0].caseId, 'routing-case')
  assert.equal(comparison.cases[0].runId, undefined)
  assert.equal(comparison.summary.pass, true)
})

test('rejects ambiguous repeated cases instead of silently overwriting them', () => {
  const report = makeReport([
    { caseId: 'routing-case', outcome: 'PASS', passed: true, failures: [], scores: {} },
    { caseId: 'routing-case', outcome: 'FAIL', passed: false, failures: [], scores: {} }
  ])

  assert.throws(
    () => compareReports(wrapped(report), wrapped(report)),
    /duplicate run identities/
  )
})

test('detects evidence coverage drift even when case outcomes match', () => {
  const left = makeReport([makeEntry(1)])
  const right = makeReport([makeEntry(1)])
  right.evidenceCoverage = { completeTrace: { numerator: 0, denominator: 1 } }

  const comparison = compareReports(wrapped(left), wrapped(right))

  assert.equal(comparison.summary.divergentCases, 0)
  assert.equal(comparison.summary.aggregateCoverageDrift, true)
  assert.deepEqual(comparison.divergences, [{
    caseId: '__aggregate__',
    reasons: ['evidence-coverage']
  }])
  assert.equal(comparison.summary.pass, false)
})
