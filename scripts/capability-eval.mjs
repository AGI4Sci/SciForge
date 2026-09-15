#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const {
  createAggregateReport,
  createSelfTestReport,
  createDeterministicSimulationExecutor,
  loadEvalCasesFromJsonl,
  loadTraceEventsFromJsonl,
  parseCapabilityReferenceMarkdown,
  capabilityEvalTraceFromEvents,
  runEvalCases,
  terminalSummary,
  terminalSelfTestSummary,
  writeSelfTestReports,
  writeEvalReports
} = await import('../src/main/capability-eval/index.ts')

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  printHelp()
  process.exit(0)
}

const casesPath = path.resolve(root, args.cases ?? 'eval-cases/capability/golden.jsonl')
const referencePath = path.resolve(root, args.reference ?? 'docs/generated/capabilities.md')
const outputDirectory = path.resolve(root, args.output ?? (args.selfTest ? 'eval-results/self-test' : 'eval-results'))
const cases = await loadEvalCasesFromJsonl(casesPath)
const reference = parseCapabilityReferenceMarkdown(await readFile(referencePath, 'utf8'), referencePath)
validateCaseReferences(cases, reference)

let executionMode = 'deterministic-simulation'
let executor
let selectedCases = cases
if (args.trace) {
  if (!args.caseId && cases.length !== 1) {
    throw new Error('--trace requires --case-id when the case file contains more than one case.')
  }
  const traceEvents = await loadTraceEventsFromJsonl(path.resolve(root, args.trace))
  selectedCases = args.caseId ? cases.filter((evalCase) => evalCase.id === args.caseId) : cases
  if (selectedCases.length !== 1) throw new Error(`Unknown or ambiguous --case-id ${args.caseId ?? ''}.`)
  const trace = capabilityEvalTraceFromEvents(traceEvents)
  executor = { run: async () => ({ trace }) }
  executionMode = 'trace'
} else {
  executor = createDeterministicSimulationExecutor(reference)
}

const results = await runEvalCases(selectedCases, executor, {
  concurrency: args.concurrency ? Number(args.concurrency) : 1
})
if (args.selfTest) {
  if (args.baseline) throw new Error('--baseline is only supported for golden regression runs.')
  const report = createSelfTestReport(results, { executionMode })
  const written = await writeSelfTestReports(report, outputDirectory)
  console.log(terminalSelfTestSummary(report))
  console.log(`\nJSON report: ${written.jsonPath}`)
  console.log(`HTML report: ${written.htmlPath}`)
  if (report.missedFailures > 0) process.exitCode = 1
} else {
  let baseline
  if (args.baseline) {
    baseline = JSON.parse(await readFile(path.resolve(root, args.baseline), 'utf8'))
  }
  const report = createAggregateReport(results, {
    executionMode,
    capabilityReference: referencePath,
    ...(baseline ? { baseline } : {})
  })
  const written = await writeEvalReports(report, outputDirectory)
  console.log(terminalSummary(report))
  console.log(`\nJSON report: ${written.jsonPath}`)
  console.log(`HTML report: ${written.htmlPath}`)
  if (report.failed > 0 && !args.allowFailures) process.exitCode = 1
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      result.help = true
      continue
    }
    if (arg === '--allow-failures') {
      result.allowFailures = true
      continue
    }
    if (arg === '--self-test') {
      result.selfTest = true
      continue
    }
    if (arg.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      result[arg.slice(2)] = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`Unknown argument ${arg}`)
  }
  return result
}

function printHelp() {
  console.log(`SciForge Capability Eval\n\nUsage:\n  npm run eval:capability [options]\n\nOptions:\n  --cases <path>          JSONL eval case file (default: eval-cases/capability/golden.jsonl)\n  --reference <path>      generated capability reference\n  --output <directory>    report output directory\n  --trace <path>          evaluate one full-trace JSONL export\n  --case-id <id>          case to use with --trace\n  --baseline <path>       previous golden JSON report for comparison\n  --concurrency <n>       isolated deterministic cases to run concurrently\n  --self-test             report evaluator detection results instead of capability metrics\n  --allow-failures        keep the command successful despite golden case failures`)
}

function validateCaseReferences(cases, reference) {
  const ids = new Set()
  for (const evalCase of cases) {
    const actionIds = [
      ...evalCase.expected.mustDiscover,
      ...evalCase.expected.requiredActions,
      ...evalCase.expected.allowedActions,
      ...evalCase.expected.forbiddenActions,
      ...Object.keys(evalCase.expected.authorization),
      ...Object.keys(evalCase.expected.invocation),
      ...Object.keys(evalCase.expected.arguments),
      ...(evalCase.simulation?.discoveries.flatMap((entry) => entry.actions) ?? []),
      ...(evalCase.simulation?.authorizationEvents.map((entry) => entry.actionId) ?? []),
      ...(evalCase.simulation?.calls.map((entry) => entry.actionId) ?? [])
    ]
    for (const actionId of actionIds) {
      if (!reference.byId.has(actionId)) {
        throw new Error(`Eval case ${evalCase.id} references unknown generated capability ${actionId}.`)
      }
    }
    if (ids.has(evalCase.id)) throw new Error(`Duplicate eval case ${evalCase.id}.`)
    ids.add(evalCase.id)
  }
}
