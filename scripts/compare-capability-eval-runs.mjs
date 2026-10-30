#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCapabilityEvalArgs } from './capability-eval-cli-utils.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
async function main() {
  const args = parseCapabilityEvalArgs(process.argv.slice(2), { booleanFlags: ['--allow-divergence'] })
  if (args.help || !args.live || !args.replay) {
    printHelp()
    if (!args.help) process.exitCode = 2
    return
  }
  const live = await readReport(args.live)
  const replay = await readReport(args.replay)
  const comparison = compareReports(live, replay)
  const serialized = `${JSON.stringify(comparison, null, 2)}\n`
  if (args.output) await writeFile(path.resolve(root, args.output), serialized, 'utf8')
  console.log(JSON.stringify(comparison.summary))
  if (args.output) console.log(`Comparison report: ${path.resolve(root, args.output)}`)
  if (comparison.summary.divergentCases > 0 && !args.allowDivergence) process.exitCode = 1
}

async function readReport(file) {
  const reportPath = path.resolve(root, file)
  const parsed = JSON.parse(await readFile(reportPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cases)) {
    throw new Error(`Evaluation report ${reportPath} does not contain a cases array.`)
  }
  return { path: reportPath, report: parsed }
}

function compareReports(left, right) {
  const leftCases = indexReportCases(left.report, 'left')
  const rightCases = indexReportCases(right.report, 'right')
  const identityKeys = [...new Set([...leftCases.entries.keys(), ...rightCases.entries.keys()])].sort()
  const cases = identityKeys.map((identityKey) => {
    const leftEntry = leftCases.entries.get(identityKey)
    const rightEntry = rightCases.entries.get(identityKey)
    return compareCase(
      leftEntry?.identity ?? rightEntry.identity,
      leftEntry?.entry,
      rightEntry?.entry
    )
  })
  const divergent = cases.filter((entry) => !entry.match)
  const aggregate = compareAggregateReports(left.report, right.report)
  return {
    schemaVersion: 'sciforge.capability-eval.comparison.v1',
    generatedAt: new Date().toISOString(),
    left: { path: left.path, executionMode: left.report.executionMode },
    right: { path: right.path, executionMode: right.report.executionMode },
    summary: {
      totalCases: cases.length,
      matchingCases: cases.length - divergent.length,
      divergentCases: divergent.length,
      aggregateMetricDrift: aggregate.metricDrift.length,
      aggregateCoverageDrift: aggregate.coverageDrift,
      pass: divergent.length === 0 && aggregate.metricDrift.length === 0 && !aggregate.coverageDrift
    },
    cases,
    aggregate,
    divergences: [
      ...divergent.map(({ caseId, runId, runIndex, reasons }) => ({
        caseId,
        ...(runId ? { runId } : {}),
        ...(runIndex !== undefined ? { runIndex } : {}),
        reasons
      })),
      ...aggregate.metricDrift.map((key) => ({ caseId: '__aggregate__', reasons: [`metric:${key}`] })),
      ...(aggregate.metricCoverageDrift ? [{ caseId: '__aggregate__', reasons: ['metric-coverage'] }] : []),
      ...(aggregate.evidenceCoverageDrift ? [{ caseId: '__aggregate__', reasons: ['evidence-coverage'] }] : [])
    ]
  }
}

function compareCase(identity, left, right) {
  if (!left || !right) {
    return {
      ...identity,
      match: false,
      reasons: [left ? 'missing-on-right' : 'missing-on-left']
    }
  }
  const reasons = []
  if (left.outcome !== right.outcome) reasons.push('outcome')
  if (left.passed !== right.passed) reasons.push('passed')
  const leftFailures = (left.failures ?? []).map((failure) => failure.type).sort()
  const rightFailures = (right.failures ?? []).map((failure) => failure.type).sort()
  if (JSON.stringify(leftFailures) !== JSON.stringify(rightFailures)) reasons.push('failure-types')
  const scoreDelta = {}
  const scoreKeys = [...new Set([...Object.keys(left.scores ?? {}), ...Object.keys(right.scores ?? {})])]
  for (const key of scoreKeys) {
    const delta = (right.scores?.[key] ?? 0) - (left.scores?.[key] ?? 0)
    scoreDelta[key] = delta
    if (delta !== 0) reasons.push(`score:${key}`)
  }
  const leftActions = invocationSignature(left)
  const rightActions = invocationSignature(right)
  if (JSON.stringify(leftActions) !== JSON.stringify(rightActions)) reasons.push('invocations-or-attempts')
  return {
    ...identity,
    match: reasons.length === 0,
    reasons,
    left: { outcome: left.outcome, passed: left.passed, failures: leftFailures, invocations: leftActions },
    right: { outcome: right.outcome, passed: right.passed, failures: rightFailures, invocations: rightActions },
    scoreDelta
  }
}

function indexReportCases(report, side) {
  const entries = new Map()
  const duplicates = []
  for (const entry of report.cases) {
    const identity = entryIdentity(entry)
    if (entries.has(identity.key)) {
      duplicates.push(identity)
      continue
    }
    entries.set(identity.key, { entry, identity })
  }
  if (duplicates.length > 0) {
    const formatted = duplicates.map((identity) => formatIdentity(identity)).join(', ')
    throw new Error(`${side} report contains duplicate run identities: ${formatted}`)
  }
  return { entries }
}

function entryIdentity(entry) {
  const caseId = entry?.caseId ?? '__missing-case-id__'
  const actual = entry?.actual ?? {}
  const runId = actual.runId ?? entry?.runId
  const runIndex = actual.runIndex ?? entry?.runIndex
  if (typeof runId === 'string' && runId.length > 0) {
    return { key: JSON.stringify([caseId, 'runId', runId]), caseId, runId, runIndex }
  }
  if (Number.isInteger(runIndex)) {
    return { key: JSON.stringify([caseId, 'runIndex', runIndex]), caseId, runIndex }
  }
  return { key: JSON.stringify([caseId, 'caseId']), caseId }
}

function formatIdentity(identity) {
  return [
    `caseId=${identity.caseId}`,
    identity.runId ? `runId=${identity.runId}` : undefined,
    identity.runIndex !== undefined ? `runIndex=${identity.runIndex}` : undefined
  ].filter(Boolean).join(' ')
}

function compareAggregateReports(left, right) {
  const metricKeys = [...new Set([...Object.keys(left.metrics ?? {}), ...Object.keys(right.metrics ?? {})])]
  const metricDrift = metricKeys
    .filter((key) => (left.metrics?.[key] ?? null) !== (right.metrics?.[key] ?? null))
  const metricCoverageDrift = JSON.stringify(left.metricCoverage ?? {}) !== JSON.stringify(right.metricCoverage ?? {})
  const evidenceCoverageDrift = JSON.stringify(left.evidenceCoverage ?? {}) !== JSON.stringify(right.evidenceCoverage ?? {})
  return {
    metricDrift,
    metricDelta: Object.fromEntries(metricKeys.map((key) => [
      key,
      (right.metrics?.[key] ?? 0) - (left.metrics?.[key] ?? 0)
    ])),
    coverageDrift: metricCoverageDrift || evidenceCoverageDrift,
    metricCoverageDrift,
    evidenceCoverageDrift,
    left: {
      metrics: left.metrics ?? {},
      metricCoverage: left.metricCoverage ?? {},
      evidenceCoverage: left.evidenceCoverage ?? {}
    },
    right: {
      metrics: right.metrics ?? {},
      metricCoverage: right.metricCoverage ?? {},
      evidenceCoverage: right.evidenceCoverage ?? {}
    }
  }
}

function invocationSignature(result) {
  return (result.actual?.invocations ?? result.invocations ?? []).map((invocation) => ({
    actionId: invocation.actionId,
    success: invocation.success,
    errorCode: invocation.errorCode ?? null,
    retryCount: invocation.retryCount ?? 0,
    attempts: (invocation.providerAttempts ?? []).map((attempt) => ({
      attempt: attempt.attempt,
      success: attempt.success,
      errorCode: attempt.errorCode ?? null
    }))
  }))
}

function printHelp() {
  console.log('Compare the outcomes of a live capability run and its trace replay.')
  console.log('Usage: npm run capability:eval:compare -- --live <report.json> --replay <report.json> [--output <path>] [--allow-divergence]')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}

export { compareAggregateReports, compareCase, compareReports, entryIdentity }
