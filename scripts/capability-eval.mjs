#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const {
  createAggregateReport,
  createSelfTestReport,
  createDeterministicSimulationExecutor,
  createDevBrowserBridgeRuntime,
  createIsolatedDevBrowserBridgeRuntime,
  createLiveWorkflowExecutor,
  loadEvalCasesFromJsonl,
  loadTraceEventsFromJsonl,
  parseCapabilityReferenceMarkdown,
  evalFinalStateEvidenceSchema,
  capabilityEvalTraceFromEvents,
  runEvalCases,
  terminalSummary,
  terminalSelfTestSummary,
  createCapabilityCoverageReport,
  writeCapabilityCoverageReport,
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
let liveRuntime
let liveTraceDirectory
if (args.trace && args.traceDir) {
  throw new Error('--trace and --trace-dir cannot be used together.')
}
if (args.live && (args.trace || args.traceDir)) {
  throw new Error('--live runs the Agent and cannot be combined with --trace or --trace-dir.')
}
if (args.live && args.selfTest) {
  throw new Error('--live is for golden workflow evaluation; evaluator self-tests use deterministic simulations.')
}
if (args.isolateGlobalState && !args.live) {
  throw new Error('--isolate-global-state requires --live.')
}
if (args.isolateGlobalState && args.concurrency && Number(args.concurrency) !== 1) {
  throw new Error('--isolate-global-state requires --concurrency 1 so each case can own one isolated Host process.')
}
if (args.isolateGlobalState && (args.bridgeUrl || args.devInstanceId)) {
  throw new Error('--isolate-global-state starts its own bridge and cannot use --bridge-url or --dev-instance-id.')
}
if (args.trace) {
  if (!args.caseId && cases.length !== 1) {
    throw new Error('--trace requires --case-id when the case file contains more than one case.')
  }
  const traceEvents = await loadTraceEventsFromJsonl(path.resolve(root, args.trace))
  selectedCases = args.caseId ? cases.filter((evalCase) => evalCase.id === args.caseId) : cases
  if (selectedCases.length !== 1) throw new Error(`Unknown or ambiguous --case-id ${args.caseId ?? ''}.`)
  const baseTrace = capabilityEvalTraceFromEvents(traceEvents, {
    knownActionIds: new Set(reference.entries.map((entry) => entry.id))
  })
  const trace = await enrichReplayTrace(baseTrace, path.dirname(path.resolve(root, args.trace)), selectedCases[0].id, args.finalStateDir)
  executor = { run: async () => ({ trace }) }
  executionMode = 'trace'
} else if (args.traceDir) {
  selectedCases = args.caseId ? cases.filter((evalCase) => evalCase.id === args.caseId) : cases
  if (selectedCases.length === 0) throw new Error(`Unknown --case-id ${args.caseId ?? ''}.`)
  const traces = new Map()
  for (const evalCase of selectedCases) {
    const tracePath = path.resolve(root, args.traceDir, `${evalCase.id}.jsonl`)
    const traceEvents = await loadTraceEventsFromJsonl(tracePath)
    const baseTrace = capabilityEvalTraceFromEvents(traceEvents, {
      knownActionIds: new Set(reference.entries.map((entry) => entry.id))
    })
    traces.set(evalCase.id, await enrichReplayTrace(baseTrace, path.resolve(root, args.traceDir), evalCase.id, args.finalStateDir))
  }
  executor = { run: async (evalCase) => ({ trace: traces.get(evalCase.id) }) }
  executionMode = 'trace'
} else if (args.live) {
  selectedCases = args.caseId ? cases.filter((evalCase) => evalCase.id === args.caseId) : cases
  if (selectedCases.length === 0) throw new Error(`Unknown --case-id ${args.caseId ?? ''}.`)
  const runtimeId = parseRuntimeId(args.runtimeId)
  liveTraceDirectory = path.resolve(root, args.traceOutputDir ?? path.join(outputDirectory, 'traces'))
  await mkdir(liveTraceDirectory, { recursive: true })
  const createLiveExecutor = (runtime) => createLiveWorkflowExecutor({
    runtime,
    runtimeId,
    knownActionIds: new Set(reference.entries.map((entry) => entry.id)),
    ...(args.timeoutMs ? { timeoutMs: parsePositiveNumber(args.timeoutMs, '--timeout-ms') } : {}),
    ...(args.pollIntervalMs ? { pollIntervalMs: parsePositiveNumber(args.pollIntervalMs, '--poll-interval-ms') } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.mode ? { mode: args.mode } : {}),
    ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
    ...(args.finalStateDir ? {
      inspectFinalState: createFinalStateInspector(path.resolve(root, args.finalStateDir))
    } : {}),
    onTrace: async (evalCase, traceEvents, trace) => {
      const tracePath = path.resolve(liveTraceDirectory, `${evalCase.id}.jsonl`)
      await writeFile(tracePath, `${traceEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8')
      await writeFile(
        path.resolve(liveTraceDirectory, `${evalCase.id}.trace.json`),
        `${JSON.stringify(trace, null, 2)}\n`,
        'utf8'
      )
    }
  })
  if (args.isolateGlobalState) {
    executor = {
      run: async (evalCase, context) => {
        const isolatedRuntime = await createIsolatedDevBrowserBridgeRuntime({ projectRoot: root })
        let execution
        let cleanupError
        try {
          execution = await createLiveExecutor(isolatedRuntime).run(evalCase, context)
        } finally {
          try {
            await isolatedRuntime.close()
          } catch (error) {
            cleanupError = error
          }
        }
        if (cleanupError && !execution) throw cleanupError
        if (cleanupError) {
          return {
            ...execution,
            trace: {
              ...execution.trace,
              executionStatus: 'failed',
              executionError: `Isolated Host cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
            }
          }
        }
        return execution
      }
    }
  } else {
    liveRuntime = await createDevBrowserBridgeRuntime({
      ...(args.bridgeUrl ? { bridgeUrl: args.bridgeUrl } : {}),
      ...(args.devInstanceId ? { instanceId: args.devInstanceId } : {}),
      projectRoot: root
    })
    executor = createLiveExecutor(liveRuntime)
  }
  executionMode = 'live-agent'
} else {
  const liveCases = cases.filter((evalCase) => !evalCase.simulation)
  if (liveCases.length > 0) {
    throw new Error(
      `Cases without deterministic simulations require --trace-dir <directory> or --trace <file> --case-id <id>: ${liveCases.map((evalCase) => evalCase.id).join(', ')}`
    )
  }
  executor = createDeterministicSimulationExecutor(reference)
}

try {
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
    const coverage = createCapabilityCoverageReport(cases, reference)
    const coverageWritten = await writeCapabilityCoverageReport(coverage, outputDirectory)
    console.log(terminalSummary(report))
    console.log(`\nJSON report: ${written.jsonPath}`)
    console.log(`HTML report: ${written.htmlPath}`)
    console.log(`Coverage report: ${coverageWritten.markdownPath}`)
    if (liveTraceDirectory) console.log(`Trace exports: ${liveTraceDirectory}`)
    if (report.failed > 0 && !args.allowFailures) process.exitCode = 1
  }
} finally {
  await liveRuntime?.close()
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
    if (arg === '--live') {
      result.live = true
      continue
    }
    if (arg === '--isolate-global-state') {
      result.isolateGlobalState = true
      continue
    }
    if (arg.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase())
      result[key] = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`Unknown argument ${arg}`)
  }
  return result
}

function printHelp() {
  console.log('  --isolate-global-state     start one disposable isolated Host per live case')
  console.log(`SciForge Capability Eval\n\nUsage:\n  npm run eval:capability [options]\n\nOptions:\n  --cases <path>             JSONL eval case file (default: eval-cases/capability/golden.jsonl)\n  --reference <path>         generated capability reference\n  --output <directory>       report output directory\n  --trace <path>             evaluate one full-trace JSONL export\n  --trace-dir <directory>   evaluate <case-id>.jsonl traces for every selected case\n  --live                     submit natural-language cases to a running Agent Host\n  --trace-output-dir <dir>  save real live full-trace exports (default: <output>/traces)\n  --final-state-dir <dir>   read optional <case-id>.json final-state evidence\n  --bridge-url <url>         development bridge URL (default: http://127.0.0.1:5174)\n  --dev-instance-id <id>     development instance credential (auto-discovered by default)\n  --runtime-id <id>          Agent runtime: codex, claude, or sciforge (default: codex)\n  --model <id>               optional Agent model override\n  --mode <mode>              optional Agent mode override\n  --reasoning-effort <value> optional Agent reasoning effort\n  --timeout-ms <n>           live turn timeout\n  --poll-interval-ms <n>     live status polling interval\n  --case-id <id>             case to use with --trace or --live\n  --baseline <path>           previous golden JSON report for comparison\n  --concurrency <n>          isolated deterministic cases to run concurrently\n  --self-test                report evaluator detection results instead of capability metrics\n  --allow-failures           keep the command successful despite golden case failures`)
}

function parseRuntimeId(value) {
  const runtimeId = value ?? 'codex'
  if (runtimeId !== 'codex' && runtimeId !== 'claude' && runtimeId !== 'sciforge') {
    throw new Error(`Unsupported --runtime-id ${runtimeId}. Expected codex, claude, or sciforge.`)
  }
  return runtimeId
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number.`)
  return parsed
}

function createFinalStateInspector(directory) {
  return async (evalCase) => {
    return readFinalStateEvidence(directory, evalCase.id)
  }
}

async function enrichReplayTrace(trace, traceDirectory, caseId, finalStateDirectory) {
  let enriched = trace
  const persistedPath = path.resolve(traceDirectory, `${caseId}.trace.json`)
  try {
    const persisted = JSON.parse(await readFile(persistedPath, 'utf8'))
    if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
      enriched = {
        ...enriched,
        ...(typeof persisted.taskSuccess === 'boolean' ? { taskSuccess: persisted.taskSuccess } : {}),
        ...(typeof persisted.executionStatus === 'string' ? { executionStatus: persisted.executionStatus } : {}),
        ...(typeof persisted.executionError === 'string' ? { executionError: persisted.executionError } : {}),
        ...(typeof persisted.taskLatencyMs === 'number' ? { taskLatencyMs: persisted.taskLatencyMs } : {}),
        ...(typeof persisted.finalStateSource === 'string' ? { finalStateSource: persisted.finalStateSource } : {}),
        ...(Object.hasOwn(persisted, 'finalState') ? { finalState: persisted.finalState } : {}),
        ...(Array.isArray(persisted.evidence) ? { evidence: persisted.evidence.filter((entry) => typeof entry === 'string') } : {}),
        ...(Array.isArray(persisted.unsupported) ? { unsupported: persisted.unsupported.filter((entry) => typeof entry === 'string') } : {})
      }
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw new Error(`Unable to read persisted trace metadata ${persistedPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (finalStateDirectory) {
    const inspected = await readFinalStateEvidence(path.resolve(root, finalStateDirectory), caseId)
    enriched = {
      ...enriched,
      ...(Object.hasOwn(inspected, 'finalState') ? { finalState: inspected.finalState, finalStateSource: 'inspector' } : {}),
      ...(typeof inspected.taskSuccess === 'boolean' ? { taskSuccess: inspected.taskSuccess } : {}),
      ...(inspected.evidence?.length ? { evidence: inspected.evidence } : {})
    }
  }
  return enriched
}

async function readFinalStateEvidence(directory, caseId) {
  const source = path.resolve(directory, `${caseId}.json`)
  let raw
  try {
    raw = JSON.parse(await readFile(source, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read final-state evidence ${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = evalFinalStateEvidenceSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Final-state evidence ${source} does not match the oracle contract: ${parsed.error.message}`)
  }
  const evidence = parsed.data.evidence
  return {
    ...(parsed.data.finalState !== undefined ? { finalState: parsed.data.finalState } : {}),
    ...(parsed.data.taskSuccess !== undefined ? { taskSuccess: parsed.data.taskSuccess } : {}),
    ...(evidence.length > 0 ? { evidence } : {})
  }
}

function isMissingFile(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'ENOENT')
}

function validateCaseReferences(cases, reference) {
  const ids = new Set()
  for (const evalCase of cases) {
    const actionIds = [
      ...evalCase.expected.mustDiscover,
      ...evalCase.expected.requiredActions,
      ...evalCase.expected.alternativeActionGroups.flat(),
      ...evalCase.expected.allowedActions,
      ...evalCase.expected.forbiddenActions,
      ...evalCase.expected.unnecessaryActions,
      ...evalCase.expected.ordering.flatMap((constraint) => [constraint.before, constraint.after]),
      ...Object.keys(evalCase.expected.authorization),
      ...Object.keys(evalCase.expected.invocation),
      ...Object.keys(evalCase.expected.arguments),
      ...(evalCase.simulation?.discoveries.flatMap((entry) => entry.actions) ?? []),
      ...(evalCase.simulation?.authorizationEvents.map((entry) => entry.actionId) ?? []),
      ...(evalCase.simulation?.calls.map((entry) => entry.actionId) ?? []),
      ...(evalCase.expectedFailure ? [evalCase.expectedFailure.actionId] : [])
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
