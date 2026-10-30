#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCapabilityEvalArgs } from './capability-eval-cli-utils.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseCapabilityEvalArgs(process.argv.slice(2), { booleanFlags: ['--metadata-only'] })

const {
  capabilityEvalTraceFromEvents,
  evalTraceCalibrationCaseSchema,
  evaluateCase,
  loadEvalCasesFromJsonl,
  loadTraceEventsFromJsonl,
  parseCapabilityReferenceMarkdown
} = await import('../src/main/capability-eval/index.ts')

if (args.help) {
  printHelp()
} else {
  await runCalibration(args)
}

async function runCalibration(options) {
  const manifestPath = resolveRepoPath(options.manifest ?? 'eval-cases/capability/trace-calibration.jsonl')
  const rows = await loadCalibrationManifest(manifestPath)
  if (options.metadataOnly) {
    console.log(`Validated ${rows.length} trace calibration labels.`)
    return
  }

  const referencePath = resolveRepoPath(options.reference ?? 'docs/generated/capabilities.md')
  const reference = parseCapabilityReferenceMarkdown(await readFile(referencePath, 'utf8'), referencePath)
  const traceRoot = options.traceRoot ? path.resolve(options.traceRoot) : root
  const casesByFile = new Map()
  const calibrationRows = []
  for (const row of rows) {
    const casePath = resolveRepoPath(row.caseFile)
    let cases = casesByFile.get(casePath)
    if (!cases) {
      cases = await loadEvalCasesFromJsonl(casePath)
      casesByFile.set(casePath, cases)
    }
    const evalCase = cases.find((candidate) => candidate.id === row.caseId)
    if (!evalCase) {
      throw new Error(`Calibration case ${row.caseId} is not present in ${row.caseFile}.`)
    }
    const rawTracePath = resolveTraceArtifactPath(row.rawTraceFile, traceRoot)
    const normalizedTracePath = resolveTraceArtifactPath(row.normalizedTraceFile, traceRoot)
    const rawEvents = await loadTraceEventsFromJsonl(rawTracePath, { allowEmpty: true })
    const derivedTrace = capabilityEvalTraceFromEvents(rawEvents, {
      knownActionIds: new Set(reference.entries.map((entry) => entry.id))
    })
    const normalizedTrace = JSON.parse(await readFile(normalizedTracePath, 'utf8'))
    const trace = mergeIndependentTraceMetadata(derivedTrace, normalizedTrace)
    const result = evaluateCase(evalCase, { trace })
    const actualFailureTypes = [...new Set(result.failures.map((failure) => failure.type))].sort()
    const expectedFailureTypes = [...new Set(row.humanLabel.failureTypes)].sort()
    const outcomeMatch = result.outcome === row.humanLabel.outcome
    const failureTypeMatch = sameValues(actualFailureTypes, expectedFailureTypes)
    calibrationRows.push({
      id: row.id,
      caseId: row.caseId,
      split: row.split,
      label: row.humanLabel.outcome,
      evaluatorOutcome: result.outcome,
      outcomeMatch,
      failureTypeMatch,
      expectedFailureTypes,
      actualFailureTypes,
      scores: result.scores,
      rawEventCount: rawEvents.length,
      evidenceStatus: trace.evidenceStatus ?? 'unavailable',
      source: {
        caseFile: row.caseFile,
        rawTraceFile: row.rawTraceFile,
        normalizedTraceFile: row.normalizedTraceFile,
        ...(row.sourceReport ? { sourceReport: row.sourceReport } : {})
      }
    })
  }

  const metrics = createCalibrationMetrics(calibrationRows)
  const acceptance = {
    minimumHoldoutCases: 8,
    minimumHoldoutOutcomeAccuracy: 0.9,
    maximumFalsePasses: 0,
    pass: metrics.holdout.total >= 8 &&
      metrics.holdout.outcomeAccuracy >= 0.9 &&
      metrics.falsePassCount === 0
  }
  const report = {
    schemaVersion: 'sciforge.capability-eval.trace-calibration.v1',
    generatedAt: new Date().toISOString(),
    runKind: 'real-agent-trace-calibration',
    labelPolicy: 'Maintainer adjudication from independent package oracles; evaluator output is excluded from labels.',
    reviewer: 'evaluator-maintainer',
    totalCases: calibrationRows.length,
    trainCases: calibrationRows.filter((row) => row.split === 'train').length,
    holdoutCases: calibrationRows.filter((row) => row.split === 'holdout').length,
    metrics,
    acceptance,
    judgeCalibration: {
      status: 'pending',
      reason: 'No external LLM Judge sidecars were supplied. Deterministic trace calibration does not establish LLM Judge scoring quality.'
    },
    cases: calibrationRows
  }
  const outputDirectory = path.resolve(options.output ?? path.join(root, 'eval-results/trace-calibration'))
  await mkdir(outputDirectory, { recursive: true })
  const reportPath = path.join(outputDirectory, 'latest.json')
  const markdownPath = path.join(outputDirectory, 'latest.md')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderMarkdown(report), 'utf8')
  console.log(`Real-trace calibration: ${acceptance.pass ? 'INITIAL PASS' : 'FAILED'}`)
  console.log(`Cases: ${report.totalCases} (${report.trainCases} train, ${report.holdoutCases} holdout)`)
  console.log(`Outcome accuracy: ${(metrics.outcomeAccuracy * 100).toFixed(1)}%; holdout: ${(metrics.holdout.outcomeAccuracy * 100).toFixed(1)}%`)
  console.log(`False passes: ${metrics.falsePassCount}; false fails: ${metrics.falseFailCount}`)
  console.log(`Report: ${reportPath}`)
  if (!acceptance.pass) process.exitCode = 1
}

async function loadCalibrationManifest(manifestPath) {
  const content = await readFile(manifestPath, 'utf8')
  const rows = []
  const ids = new Set()
  const caseIds = new Set()
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    let raw
    try {
      raw = JSON.parse(trimmed)
    } catch (error) {
      throw new Error(`Invalid calibration JSONL at ${manifestPath}:${index + 1}: ${error.message}`)
    }
    const parsed = evalTraceCalibrationCaseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Invalid calibration row at ${manifestPath}:${index + 1}: ${parsed.error.message}`)
    }
    if (ids.has(parsed.data.id)) throw new Error(`Duplicate calibration row id ${parsed.data.id}.`)
    if (caseIds.has(parsed.data.caseId)) throw new Error(`Duplicate calibration case ${parsed.data.caseId}.`)
    ids.add(parsed.data.id)
    caseIds.add(parsed.data.caseId)
    rows.push(parsed.data)
  }
  if (rows.length === 0) throw new Error(`Calibration manifest ${manifestPath} is empty.`)
  return rows
}

function mergeIndependentTraceMetadata(derived, normalized) {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('Normalized trace sidecar must be a JSON object.')
  }
  const metadataKeys = [
    'runId', 'preflight', 'assistantMessages', 'finalAnswer', 'executionStatus', 'executionError',
    'taskLatencyMs', 'approvalCount', 'attemptEvidence', 'evidenceStatus', 'expectedLatestSeq',
    'observedLatestSeq', 'traceSequenceWarning', 'traceStatusWarning', 'traceCollectionError',
    'tracePersistenceError', 'workspaceSnapshotDirectory', 'finalStateSource', 'evidence',
    'llmJudgeResults', 'verifiedActionIds', 'faultMatches', 'finalState', 'taskSuccess', 'unsupported'
  ]
  const metadata = {}
  for (const key of metadataKeys) {
    if (key in normalized) metadata[key] = normalized[key]
  }
  return { ...derived, ...metadata, rawEventCount: derived.rawEventCount }
}

function createCalibrationMetrics(rows) {
  const total = rows.length
  const matches = rows.filter((row) => row.outcomeMatch).length
  const exactFailureTypes = rows.filter((row) => row.failureTypeMatch).length
  const falsePassCount = rows.filter((row) => row.label !== 'PASS' && row.evaluatorOutcome === 'PASS').length
  const falseFailCount = rows.filter((row) => row.label === 'PASS' && row.evaluatorOutcome !== 'PASS').length
  const splitMetrics = (split) => {
    const selected = rows.filter((row) => row.split === split)
    const selectedMatches = selected.filter((row) => row.outcomeMatch).length
    return {
      total: selected.length,
      outcomeMatches: selectedMatches,
      outcomeAccuracy: selected.length === 0 ? 0 : selectedMatches / selected.length,
      falsePassCount: selected.filter((row) => row.label !== 'PASS' && row.evaluatorOutcome === 'PASS').length,
      falseFailCount: selected.filter((row) => row.label === 'PASS' && row.evaluatorOutcome !== 'PASS').length
    }
  }
  return {
    total,
    outcomeMatches: matches,
    outcomeAccuracy: total === 0 ? 0 : matches / total,
    exactFailureTypeMatches: exactFailureTypes,
    exactFailureTypeAccuracy: total === 0 ? 0 : exactFailureTypes / total,
    falsePassCount,
    falseFailCount,
    train: splitMetrics('train'),
    holdout: splitMetrics('holdout')
  }
}

function renderMarkdown(report) {
  const lines = [
    '# Real Agent Trace Calibration',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Initial status: **${report.acceptance.pass ? 'PASS' : 'FAILED'}**`,
    '',
    `This calibration replays ${report.totalCases} historical live Agent traces through the current evaluator. Labels come from independent package oracles and maintainer adjudication; evaluator outcomes are excluded from labels.`,
    '',
    `- Train cases: ${report.trainCases}`,
    `- Holdout cases: ${report.holdoutCases}`,
    `- Outcome accuracy: ${(report.metrics.outcomeAccuracy * 100).toFixed(1)}%`,
    `- Holdout outcome accuracy: ${(report.metrics.holdout.outcomeAccuracy * 100).toFixed(1)}%`,
    `- False passes: ${report.metrics.falsePassCount}`,
    `- False fails: ${report.metrics.falseFailCount}`,
    `- Exact failure-type agreement: ${(report.metrics.exactFailureTypeAccuracy * 100).toFixed(1)}%`,
    '',
    'LLM Judge calibration: **pending**. This run does not contain external model scores, so it cannot establish judge scoring quality.',
    ''
  ]
  return `${lines.join('\n')}\n`
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function resolveRepoPath(value) {
  const resolved = path.resolve(root, value)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path must stay inside the repository: ${value}`)
  }
  return resolved
}

function resolveTraceArtifactPath(value, traceRoot) {
  if (traceRoot === root) return resolveRepoPath(value)
  const archivePrefix = 'eval-results/'
  if (!value.startsWith(archivePrefix)) {
    throw new Error(`External trace roots only remap ${archivePrefix} paths: ${value}`)
  }
  const resolved = path.resolve(traceRoot, value.slice(archivePrefix.length))
  const relative = path.relative(traceRoot, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Trace artifact must stay inside --trace-root: ${value}`)
  }
  return resolved
}

function printHelp() {
  console.log('Re-score independently labelled live Agent traces and report initial evaluator calibration.')
  console.log('Usage: npm run capability:eval:calibrate -- [--manifest <path>] [--reference <path>] [--trace-root <dir>] [--output <dir>]')
  console.log('       npm run capability:eval:calibrate -- --metadata-only')
}
