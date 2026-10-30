#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCapabilityEvalArgs } from './capability-eval-cli-utils.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseCapabilityEvalArgs(process.argv.slice(2), { booleanFlags: ['--allow-drift', '--allow-failures', '--allow-dirty'] })
if (args.help) {
  printHelp()
} else {
  await runBaseline(args)
}

async function runBaseline(options) {
  const runs = Number(options.runs ?? 3)
  if (!Number.isInteger(runs) || runs < 2 || runs > 100) throw new Error('--runs must be an integer between 2 and 100.')
  const repositoryStatus = await readRepositoryStatus()
  if (repositoryStatus.trim() && !options.allowDirty) {
    throw new Error('Formal capability evaluation requires a clean worktree. Commit changes first or pass --allow-dirty only for a diagnostic run.')
  }
  const outputRoot = path.resolve(root, options.outputRoot ?? 'eval-results/baseline')
  await mkdir(outputRoot, { recursive: true })
  const reports = []
  for (let index = 1; index <= runs; index += 1) {
    const output = path.join(outputRoot, `run-${String(index).padStart(2, '0')}`)
    const cliArgs = [
      '--import', 'tsx', path.join(root, 'scripts/capability-eval.mjs'),
      '--cases', options.cases ?? 'eval-cases/capability/golden.jsonl',
      '--output', output
    ]
    if (options.traceDir) cliArgs.push('--trace-dir', options.traceDir)
    if (options.llmJudgeResultsDir) cliArgs.push('--llm-judge-results-dir', options.llmJudgeResultsDir)
    if (options.allowFailures) cliArgs.push('--allow-failures')
    await execFileAsync(process.execPath, cliArgs, { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    const reportPath = path.join(output, 'latest.json')
    reports.push({ path: reportPath, report: JSON.parse(await readFile(reportPath, 'utf8')) })
  }
  const comparison = compareBaselineReports(reports)
  const manifest = {
    schemaVersion: 'sciforge.capability-eval.reproducibility-check.v1',
    runKind: 'reproducibility-stability-check',
    notPerformanceBaseline: true,
    generatedAt: new Date().toISOString(),
    runs,
    cases: path.resolve(root, options.cases ?? 'eval-cases/capability/golden.jsonl'),
    executionMode: reports[0].report.executionMode,
    repository: {
      dirty: repositoryStatus.trim().length > 0,
      statusSha256: sha256(repositoryStatus)
    },
    reports: reports.map((entry) => entry.path),
    ...comparison
  }
  const manifestPath = path.join(outputRoot, 'reproducibility-manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`${runs}-run baseline: ${comparison.pass ? 'stable' : 'drift detected'}`)
  console.log(`Reproducibility manifest: ${manifestPath}`)
  if (!comparison.pass && !options.allowDrift) process.exitCode = 1
}

function compareBaselineReports(reports) {
  const first = reports[0].report
  const caseById = new Map(first.cases.map((entry) => [entry.caseId, entry]))
  const drift = []
  for (const [index, { report }] of reports.slice(1).entries()) {
    const currentById = new Map(report.cases.map((entry) => [entry.caseId, entry]))
    const ids = [...new Set([...caseById.keys(), ...currentById.keys()])]
    for (const caseId of ids) {
      const expected = caseById.get(caseId)
      const actual = currentById.get(caseId)
      if (!expected || !actual || expected.outcome !== actual.outcome || expected.passed !== actual.passed) {
        drift.push({ run: index + 2, caseId, reason: 'outcome' })
        continue
      }
      for (const key of Object.keys(expected.scores ?? {})) {
        if ((expected.scores?.[key] ?? 0) !== (actual.scores?.[key] ?? 0)) {
          drift.push({ run: index + 2, caseId, reason: `score:${key}` })
        }
      }
    }
  }
  return {
    pass: drift.length === 0,
    drift,
    summary: reports.map(({ report }) => ({
      executionMode: report.executionMode,
      totalCases: report.totalCases,
      passed: report.passed,
      failed: report.failed,
      inconclusive: report.inconclusive,
      passRate: report.passRate
    }))
  }
}

function printHelp() {
  console.log('Run a fixed evaluator configuration repeatedly and fail on case/score drift.')
  console.log('The command requires a clean worktree unless --allow-dirty is supplied for diagnostics.')
  console.log('Usage: npm run capability:eval:baseline -- [--runs 3] [--cases <path>] [--trace-dir <dir>] [--output-root <dir>] [--allow-dirty]')
}

async function readRepositoryStatus() {
  try {
    return (await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: root })).stdout
  } catch {
    return ''
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
