#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evaluatorRevision = await computeEvaluatorRevision()
const {
  createAggregateReport,
  createSelfTestReport,
  createDeterministicSimulationExecutor,
  createDevBrowserBridgeRuntime,
  createIsolatedDevBrowserBridgeRuntime,
  createLiveWorkflowExecutor,
  CAPABILITY_BROKER_CONTRACT_VERSION,
  CapabilityEvalPreflightError,
  CAPABILITY_EVAL_FAULT_POLICY_ENV,
  scopeCapabilityEvalFaultPolicy,
  loadEvalCasesFromJsonl,
  loadTraceEventsFromJsonl,
  parseCapabilityReferenceMarkdown,
  parseCapabilityEvalFaultPolicy,
  evalFinalStateEvidenceSchema,
  evalLlmJudgeResultSchema,
  inspectWorkspaceFinalState,
  capabilityEvalTraceFromEvents,
  runEvalCases,
  terminalSummary,
  terminalSelfTestSummary,
  createCapabilityCoverageReport,
  writeCapabilityCoverageReport,
  writeSelfTestReports,
  writeEvalReports,
  CAPABILITY_EVAL_FAULT_MATCH_LOG_ENV
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
const casesSha256 = createHash('sha256').update(await readFile(casesPath)).digest('hex')
const eligibilityManifest = args.eligibilityManifest
  ? JSON.parse(await readFile(path.resolve(root, args.eligibilityManifest), 'utf8'))
  : undefined
if (eligibilityManifest && eligibilityManifest.dataset?.sha256 !== casesSha256) {
  throw new Error(`Eligibility manifest does not match ${casesPath}: expected ${casesSha256}, got ${eligibilityManifest.dataset?.sha256 ?? 'missing'}.`)
}
const requestedCaseIds = args.caseIds
  ? String(args.caseIds).split(',').map((value) => value.trim()).filter(Boolean)
  : args.caseId ? [args.caseId] : undefined
const selectCases = (sourceCases) => {
  const ids = requestedCaseIds ?? eligibilityManifest?.policy?.selectedCaseIds
  const selected = ids ? sourceCases.filter((evalCase) => ids.includes(evalCase.id)) : sourceCases
  if (ids && selected.length !== ids.length) {
    const selectedIds = new Set(selected.map((evalCase) => evalCase.id))
    throw new Error(`Unknown eval case ID(s): ${ids.filter((caseId) => !selectedIds.has(caseId)).join(', ')}`)
  }
  if (eligibilityManifest && args.live) {
    const records = new Map(eligibilityManifest.cases?.map((record) => [record.caseId, record]) ?? [])
    const blocked = selected
      .map((evalCase) => records.get(evalCase.id))
      .filter((record) => !record || record.status !== 'eligible')
    if (blocked.length > 0) {
      throw new Error(`Live selection contains ineligible cases: ${blocked.map((record) => `${record?.caseId ?? 'unknown'}:${record?.status ?? 'missing'}`).join(', ')}`)
    }
  }
  return selected
}

let executionMode = 'deterministic-simulation'
let executor
let selectedCases = cases
let liveRuntime
let liveRuntimeId
let liveTraceDirectory
let liveWorkspaceSnapshotDirectory
let replayRunIndices
let replayRunIds
let replayTracesByRunId
const repeatCount = args.repeat === undefined ? 1 : parsePositiveInteger(args.repeat, '--repeat')
if (repeatCount > 1 && !args.live) throw new Error('--repeat is only supported for --live runs.')
let experimentId = args.experimentId ?? randomUUID()
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
if (args.approvalDecision && !args.live) {
  throw new Error('--approval-decision requires --live.')
}
if (args.faultPolicy && !args.live) {
  throw new Error('--fault-policy requires --live.')
}
if (args.faultPolicy && !args.isolateGlobalState) {
  throw new Error('--fault-policy requires --isolate-global-state so the policy cannot affect an existing Host.')
}
const approvalDecision = args.approvalDecision ? parseApprovalDecision(args.approvalDecision) : undefined
const faultPolicy = args.faultPolicy
  ? parseCapabilityEvalFaultPolicy(JSON.parse(await readFile(path.resolve(root, args.faultPolicy), 'utf8')))
  : undefined
if (args.trace) {
  if (!args.caseId && cases.length !== 1) {
    throw new Error('--trace requires --case-id when the case file contains more than one case.')
  }
  const traceEvents = await loadTraceEventsFromJsonl(path.resolve(root, args.trace), { allowEmpty: true })
  selectedCases = selectCases(cases)
  if (selectedCases.length !== 1) throw new Error(`Unknown or ambiguous --case-id ${args.caseId ?? ''}.`)
  const baseTrace = capabilityEvalTraceFromEvents(traceEvents, {
    knownActionIds: new Set(reference.entries.map((entry) => entry.id))
  })
  const trace = await enrichReplayTrace(baseTrace, path.dirname(path.resolve(root, args.trace)), selectedCases[0].id, args.finalStateDir)
  executor = { run: async () => ({ trace }) }
  executionMode = 'trace'
} else if (args.traceDir) {
  selectedCases = selectCases(cases)
  if (selectedCases.length === 0) throw new Error(`Unknown --case-id ${args.caseId ?? ''}.`)
  const traceDirectory = path.resolve(root, args.traceDir)
  const runManifestPath = args.runManifest ? path.resolve(root, args.runManifest) : undefined
  if (runManifestPath) {
    const replayManifest = JSON.parse(await readFile(runManifestPath, 'utf8'))
    if (!Array.isArray(replayManifest.runs)) {
      throw new Error(`Replay run manifest ${runManifestPath} does not contain a runs array.`)
    }
    const selectedIds = new Set(selectedCases.map((evalCase) => evalCase.id))
    const caseById = new Map(selectedCases.map((evalCase) => [evalCase.id, evalCase]))
    const replayRuns = replayManifest.runs
      .filter((run) => selectedIds.has(run.caseId))
      .sort((left, right) => left.runIndex - right.runIndex)
    if (replayRuns.length === 0) {
      throw new Error(`Replay run manifest ${runManifestPath} has no runs for the selected cases.`)
    }
    const traceEntries = await Promise.all(replayRuns.map(async (run) => {
      if (typeof run.runId !== 'string' || typeof run.caseId !== 'string' || !Number.isInteger(run.runIndex)) {
        throw new Error(`Replay run manifest ${runManifestPath} contains an invalid run identity.`)
      }
      const tracePath = run.rawTracePath
        ? path.isAbsolute(run.rawTracePath)
          ? run.rawTracePath
          : path.resolve(path.dirname(runManifestPath), run.rawTracePath)
        : await locateTracePath(traceDirectory, run.caseId)
      const traceEvents = await loadTraceEventsFromJsonl(tracePath, { allowEmpty: true })
      const baseTrace = capabilityEvalTraceFromEvents(traceEvents, {
        knownActionIds: new Set(reference.entries.map((entry) => entry.id))
      })
      return {
        run,
        evalCase: caseById.get(run.caseId),
        trace: await enrichReplayTrace(baseTrace, path.dirname(tracePath), run.caseId, args.finalStateDir)
      }
    }))
    replayRunIndices = traceEntries.map(({ run }) => run.runIndex)
    replayRunIds = traceEntries.map(({ run }) => run.runId)
    replayTracesByRunId = new Map(traceEntries.map(({ run, trace }) => [run.runId, trace]))
    selectedCases = traceEntries.map(({ evalCase }) => evalCase)
    if (!args.experimentId && typeof replayManifest.experimentId === 'string') {
      experimentId = replayManifest.experimentId
    }
  } else {
    const traces = new Map()
    for (const evalCase of selectedCases) {
      const tracePath = await locateTracePath(traceDirectory, evalCase.id)
      const traceEvents = await loadTraceEventsFromJsonl(tracePath, { allowEmpty: true })
      const baseTrace = capabilityEvalTraceFromEvents(traceEvents, {
        knownActionIds: new Set(reference.entries.map((entry) => entry.id))
      })
      traces.set(evalCase.id, await enrichReplayTrace(baseTrace, path.dirname(tracePath), evalCase.id, args.finalStateDir))
    }
    replayTracesByRunId = traces
  }
  executor = { run: async (evalCase, context) => ({
    trace: replayTracesByRunId.get(context.runId) ?? replayTracesByRunId.get(evalCase.id)
  }) }
  executionMode = 'trace'
} else if (args.live) {
  selectedCases = selectCases(cases)
  if (selectedCases.length === 0) throw new Error(`Unknown --case-id ${args.caseId ?? ''}.`)
  const runtimeId = parseRuntimeId(args.runtimeId)
  liveRuntimeId = runtimeId
  const preflightRequest = {
    expectedCapabilityContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
    referenceActions: reference.entries
      .filter((entry) => entry.audiences.includes('agent'))
      .map(({ id, version }) => ({ id, version })),
    requiredContributionActionIds: [...new Set(selectedCases.flatMap((evalCase) => [
      ...evalCase.expected.requiredActions,
      ...evalCase.expected.expectedActions,
      ...evalCase.expected.acceptableActions,
      ...evalCase.expected.mustDiscover
    ]))]
  }
  liveTraceDirectory = path.resolve(root, args.traceOutputDir ?? path.join(outputDirectory, 'traces'))
  liveWorkspaceSnapshotDirectory = path.resolve(outputDirectory, 'workspaces')
  await mkdir(liveTraceDirectory, { recursive: true })
  const createLiveExecutor = (runtime, onPhase) => {
    const executor = createLiveWorkflowExecutor({
      runtime,
      runtimeId,
      knownActionIds: new Set(reference.entries.map((entry) => entry.id)),
      ...(args.timeoutMs ? { timeoutMs: parsePositiveNumber(args.timeoutMs, '--timeout-ms') } : {}),
      ...(args.pollIntervalMs ? { pollIntervalMs: parsePositiveNumber(args.pollIntervalMs, '--poll-interval-ms') } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
      ...(approvalDecision ? { approvalDecision } : {}),
      inspectFinalState: createFinalStateInspector(
        args.finalStateDir ? path.resolve(root, args.finalStateDir) : undefined,
        runtime
      ),
      onTrace: async (evalCase, traceEvents, trace) => {
        const paths = liveTracePaths(liveTraceDirectory, evalCase.id, trace)
        await persistLiveTrace(paths.rawTracePath, paths.normalizedTracePath, traceEvents, trace)
      }
    })
    return {
      run: async (evalCase, context) => {
        onPhase?.('prepare')
        let prepared
        if (runtime.prepareCapabilityEvalCase) {
          prepared = await runtime.prepareCapabilityEvalCase({
            caseId: evalCase.id,
            runId: context.runId,
            workspaceDirectory: context.directory,
            ...(runtime.isolatedUserDataDirectory
              ? { userDataDirectory: runtime.isolatedUserDataDirectory }
              : {}),
            requiredActionIds: [...new Set([
              ...evalCase.expected.requiredActions,
              ...evalCase.expected.expectedActions,
              ...evalCase.expected.acceptableActions,
              ...evalCase.expected.mustDiscover
            ])],
            ...(evalCase.fixtureProfile ? { fixtureProfile: evalCase.fixtureProfile } : {})
          })
        }
        onPhase?.('execute')
        const visibleContexts = prepared?.fixtures
          ?.map((fixture) => fixture.visibleContext)
          ?.filter((value) => value !== undefined) ?? []
        return executor.run(evalCase, {
          ...context,
          ...(visibleContexts.length > 0 ? { capabilityEvalVisibleContext: visibleContexts } : {})
        })
      }
    }
  }
  if (args.isolateGlobalState) {
    executor = {
      run: async (evalCase, context) => {
        const paths = liveTracePaths(liveTraceDirectory, evalCase.id, context)
        const { rawTracePath: tracePath, normalizedTracePath: metadataPath } = paths
        const faultMatchPath = paths.faultMatchPath
        let isolatedRuntime
        let execution
        let cleanupError
        let isolatedPhase = 'startup'
        try {
          if (faultPolicy) await writeFile(faultMatchPath, '', 'utf8')
          isolatedRuntime = await createIsolatedDevBrowserBridgeRuntime({
            projectRoot: root,
            ...(args.modelAccessBootstrap ? {
              modelAccessBootstrap: parseModelAccessBootstrap(args.modelAccessBootstrap)
            } : {}),
            ...(faultPolicy ? {
              env: {
                [CAPABILITY_EVAL_FAULT_POLICY_ENV]: JSON.stringify(
                  scopeCapabilityEvalFaultPolicy(faultPolicy, evalCase.id)
                ),
                [CAPABILITY_EVAL_FAULT_MATCH_LOG_ENV]: faultMatchPath
              }
            } : {})
          })
          isolatedPhase = 'preflight'
          const preflight = await isolatedRuntime.readCapabilityEvalPreflight(preflightRequest)
          if (preflight.status !== 'ready') throw new CapabilityEvalPreflightError(preflight)
          isolatedPhase = 'execute'
          execution = await createLiveExecutor(isolatedRuntime, (phase) => {
            isolatedPhase = phase
          }).run(evalCase, context)
          execution = await attachFaultMatches(execution, faultMatchPath, Boolean(faultPolicy))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const trace = {
            ...capabilityEvalTraceFromEvents([], {
              knownActionIds: new Set(reference.entries.map((entry) => entry.id))
            }),
            experimentId,
            runId: context.runId,
            runIndex: context.runIndex,
            executionStatus: 'failed',
            evidenceStatus: 'unavailable',
            executionError: `${isolatedPhase}: ${message}`,
            ...(error instanceof CapabilityEvalPreflightError ? { preflight: error.snapshot } : {}),
            taskLatencyMs: 0
          }
          const traceWithFaultMatches = await attachFaultMatches({ trace }, faultMatchPath, Boolean(faultPolicy))
          try {
            await persistLiveTrace(tracePath, metadataPath, [], traceWithFaultMatches.trace)
          } catch (persistenceError) {
            return {
              trace: {
                ...traceWithFaultMatches.trace,
                evidenceStatus: 'partial',
                tracePersistenceError: persistenceError instanceof Error
                  ? persistenceError.message
                  : String(persistenceError),
                executionError: `${isolatedPhase}: ${message}; live trace persistence failed`
              }
            }
          }
          return { trace: traceWithFaultMatches.trace }
        } finally {
          try {
            await isolatedRuntime?.close()
          } catch (error) {
            cleanupError = error
          }
        }
        if (cleanupError && !execution) throw cleanupError
        if (cleanupError) {
          const trace = {
            ...execution.trace,
            experimentId,
            runId: context.runId,
            runIndex: context.runIndex,
            executionStatus: 'failed',
            executionError: `Isolated Host cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
          }
          await persistLiveTraceMetadata(metadataPath, trace)
          return {
            ...execution,
            trace
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
    const preflight = await liveRuntime.readCapabilityEvalPreflight(preflightRequest)
    if (preflight.status !== 'ready') {
      const blocked = new CapabilityEvalPreflightError(preflight)
      executor = {
        run: async (evalCase, context) => {
          // Preserve the raw-trace artifact even though no Agent thread was
          // started. The normalized runner trace carries the structured block.
          const paths = liveTracePaths(liveTraceDirectory, evalCase.id, context)
          await mkdir(path.dirname(paths.rawTracePath), { recursive: true })
          await writeFile(paths.rawTracePath, '', 'utf8')
          throw blocked
        }
      }
    } else {
      executor = createLiveExecutor(liveRuntime)
    }
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

const scheduledCases = args.live && repeatCount > 1
  ? Array.from({ length: repeatCount }, () => selectedCases).flat()
  : selectedCases
const runIndices = replayRunIndices ?? scheduledCases.map((_, index) => index + 1)
const runIds = replayRunIds
const runStates = new Map()
const persistRunState = args.live
  ? async (state) => {
      runStates.set(state.runId, state)
      await persistEvalRunManifest(outputDirectory, {
        casesPath,
        casesSha256,
        referencePath,
        evaluatorRevision,
        executionMode,
        experimentId,
        runtimeId: liveRuntimeId,
        traceDirectory: liveTraceDirectory,
        eligibilityManifestPath: args.eligibilityManifest ? path.resolve(root, args.eligibilityManifest) : undefined,
        runStates: [...runStates.values()],
        results: []
      })
    }
  : undefined

try {
  const results = await runEvalCases(scheduledCases, executor, {
    concurrency: args.concurrency ? Number(args.concurrency) : 1,
    experimentId,
    runIndices,
    ...(runIds ? { runIds } : {}),
    ...(persistRunState ? { onRunState: persistRunState } : {}),
    ...(liveWorkspaceSnapshotDirectory ? { workspaceSnapshotDirectory: liveWorkspaceSnapshotDirectory } : {}),
    ...(args.llmJudgeResultsDir
      ? { llmJudgeResultsDirectory: path.resolve(root, args.llmJudgeResultsDir) }
      : {})
  })
  const runManifestPath = args.live
      ? await persistEvalRunManifest(outputDirectory, {
        casesPath,
        casesSha256,
        referencePath,
        evaluatorRevision,
        executionMode,
        experimentId,
        runtimeId: liveRuntimeId,
        traceDirectory: liveTraceDirectory,
        eligibilityManifestPath: args.eligibilityManifest ? path.resolve(root, args.eligibilityManifest) : undefined,
        runStates: [...runStates.values()],
        results
      })
    : undefined
  if (liveTraceDirectory) {
    await Promise.all(results.map((result) => {
      const paths = liveTracePaths(liveTraceDirectory, result.caseId, result.actual)
      return persistLiveTraceMetadata(paths.normalizedTracePath, result.actual)
    }))
  }
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
      evaluatorRevision,
      ...(baseline ? { baseline } : {})
    })
    const written = await writeEvalReports(report, outputDirectory)
    const coverage = createCapabilityCoverageReport(selectedCases, reference, {
      results,
      executionMode
    })
    const coverageWritten = await writeCapabilityCoverageReport(coverage, outputDirectory)
    console.log(terminalSummary(report))
    console.log(`\nJSON report: ${written.jsonPath}`)
    console.log(`HTML report: ${written.htmlPath}`)
    console.log(`Coverage report: ${coverageWritten.markdownPath}`)
    if (runManifestPath) console.log(`Run manifest: ${runManifestPath}`)
    if (liveTraceDirectory) console.log(`Trace exports: ${liveTraceDirectory}`)
    if (liveWorkspaceSnapshotDirectory) console.log(`Workspace snapshots: ${liveWorkspaceSnapshotDirectory}`)
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
  console.log('  --approval-decision <value> auto-resolve live approval requests: allowed or denied')
  console.log('  --fault-policy <path>      inject explicit provider faults into isolated live Hosts')
  console.log('  --model-access-bootstrap <mode:adapter> seed non-secret Model access for an isolated Host (for example coding-plan:codex)')
  console.log('  --eligibility-manifest <path> require the hashed live-eligible case manifest')
  console.log('  --case-ids <id,...>        select a comma-separated case set')
  console.log('  --repeat <n>               repeat each live case with a unique run identity')
  console.log('  --experiment-id <id>       stable experiment identity for the run manifest')
  console.log('  --run-manifest <path>      replay every persisted run identity listed in a run manifest')
  console.log(`SciForge Capability Eval\n\nUsage:\n  npm run eval:capability [options]\n\nOptions:\n  --cases <path>             JSONL eval case file (default: eval-cases/capability/golden.jsonl)\n  --reference <path>         generated capability reference\n  --output <directory>       report output directory\n  --trace <path>             evaluate one full-trace JSONL export\n  --trace-dir <directory>   evaluate <case-id>.jsonl traces for every selected case\n  --live                     submit natural-language cases to a running Agent Host\n  --trace-output-dir <dir>  save real live full-trace exports (default: <output>/traces)\n  --final-state-dir <dir>   read optional <case-id>.json final-state evidence\n  --llm-judge-results-dir <dir> read optional <case-id>.json LLM Judge sidecars\n  --bridge-url <url>         development bridge URL (default: http://127.0.0.1:5174)\n  --dev-instance-id <id>     development instance credential (auto-discovered by default)\n  --runtime-id <id>          Agent runtime: codex, claude, or dsh (default: codex)\n  --model <id>               optional Agent model override\n  --mode <mode>              optional Agent mode override\n  --reasoning-effort <value> optional Agent reasoning effort\n  --timeout-ms <n>           live turn timeout\n  --poll-interval-ms <n>     live status polling interval\n  --case-id <id>             case to use with --trace or --live\n  --baseline <path>           previous golden JSON report for comparison\n  --concurrency <n>          isolated deterministic cases to run concurrently\n  --self-test                report evaluator detection results instead of capability metrics\n  --allow-failures           keep the command successful despite golden case failures`)
}

function parseRuntimeId(value) {
  const runtimeId = value ?? 'codex'
  if (runtimeId !== 'codex' && runtimeId !== 'claude' && runtimeId !== 'dsh') {
    throw new Error(`Unsupported --runtime-id ${runtimeId}. Expected codex, claude, or dsh.`)
  }
  return runtimeId
}

function parseApprovalDecision(value) {
  if (value !== 'allowed' && value !== 'denied') {
    throw new Error(`Unsupported --approval-decision ${value}. Expected allowed or denied.`)
  }
  return value
}

function parseModelAccessBootstrap(value) {
  const [mode, planAdapterId, ...extra] = String(value).split(':')
  if (mode !== 'coding-plan' || !planAdapterId || extra.length > 0) {
    throw new Error(`Unsupported --model-access-bootstrap ${value}. Expected coding-plan:<adapter>.`)
  }
  return { mode, planAdapterId }
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number.`)
  return parsed
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`)
  return parsed
}

function createFinalStateInspector(directory, runtime) {
  return async (evalCase, context, input) => {
    const oracle = directory ? await readFinalStateEvidence(directory, evalCase.id) : {}
    const workspaceInspection = await inspectWorkspaceFinalState(evalCase, context.directory, oracle, input.trace)
    if (!runtime.inspectCapabilityEvalCase) return workspaceInspection
    const packageInspection = await runtime.inspectCapabilityEvalCase({
      caseId: evalCase.id,
      runId: context.runId,
      workspaceDirectory: context.directory,
      ...(runtime.isolatedUserDataDirectory
        ? { userDataDirectory: runtime.isolatedUserDataDirectory }
        : {}),
      requiredActionIds: [...new Set([
        ...evalCase.expected.requiredActions,
        ...evalCase.expected.expectedActions,
        ...evalCase.expected.acceptableActions,
        ...evalCase.expected.mustDiscover
      ])],
      ...(evalCase.fixtureProfile ? { fixtureProfile: evalCase.fixtureProfile } : {}),
      invocations: input.trace.invocations.map((invocation) => ({
        ...(invocation.actionId ? { actionId: invocation.actionId } : {}),
        args: invocation.args,
        success: invocation.success,
        ...(invocation.logicalInvocationId ? { logicalInvocationId: invocation.logicalInvocationId } : {}),
        ...(invocation.sequence !== undefined ? { sequence: invocation.sequence } : {}),
        ...(invocation.output !== undefined ? { output: invocation.output } : {}),
        ...(invocation.errorCode ? { errorCode: invocation.errorCode } : {})
      }))
    })
    return {
      ...(mergeFinalState(workspaceInspection.finalState, packageInspection.finalState) !== undefined
        ? { finalState: mergeFinalState(workspaceInspection.finalState, packageInspection.finalState) }
        : {}),
      ...(packageInspection.taskSuccess !== undefined
        ? { taskSuccess: packageInspection.taskSuccess }
        : workspaceInspection.taskSuccess !== undefined
          ? { taskSuccess: workspaceInspection.taskSuccess }
          : {}),
      evidence: [...workspaceInspection.evidence, ...packageInspection.evidence],
      verifiedActions: [...new Set([
        ...workspaceInspection.verifiedActions,
        ...packageInspection.verifiedActions
      ])],
      verifiedDimensions: [...new Set(packageInspection.verifiedDimensions ?? [])],
      unsupported: [...workspaceInspection.unsupported, ...packageInspection.unsupported]
    }
  }
}

function mergeFinalState(left, right) {
  if (left === undefined) return right
  if (right === undefined) return left
  if (isRecord(left) && isRecord(right)) return { ...left, ...right }
  return right
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

async function enrichReplayTrace(trace, traceDirectory, caseId, finalStateDirectory) {
  let enriched = trace
  const persistedPaths = [
    path.resolve(traceDirectory, `${caseId}.trace.json`),
    path.resolve(traceDirectory, 'trace.json')
  ]
  for (const persistedPath of persistedPaths) {
    try {
      const persisted = JSON.parse(await readFile(persistedPath, 'utf8'))
      if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
        enriched = {
        ...enriched,
        ...(typeof persisted.taskSuccess === 'boolean' ? { taskSuccess: persisted.taskSuccess } : {}),
        ...(typeof persisted.executionStatus === 'string' ? { executionStatus: persisted.executionStatus } : {}),
        ...(typeof persisted.executionError === 'string' ? { executionError: persisted.executionError } : {}),
        ...(typeof persisted.taskLatencyMs === 'number' ? { taskLatencyMs: persisted.taskLatencyMs } : {}),
        ...(typeof persisted.evidenceStatus === 'string' ? { evidenceStatus: persisted.evidenceStatus } : {}),
        ...(typeof persisted.discoveryEvidenceStatus === 'string' ? { discoveryEvidenceStatus: persisted.discoveryEvidenceStatus } : {}),
        ...(typeof persisted.expectedLatestSeq === 'number' ? { expectedLatestSeq: persisted.expectedLatestSeq } : {}),
        ...(typeof persisted.observedLatestSeq === 'number' ? { observedLatestSeq: persisted.observedLatestSeq } : {}),
        ...(typeof persisted.traceSequenceWarning === 'string' ? { traceSequenceWarning: persisted.traceSequenceWarning } : {}),
        ...(typeof persisted.traceStatusWarning === 'string' ? { traceStatusWarning: persisted.traceStatusWarning } : {}),
        ...(typeof persisted.traceCollectionError === 'string' ? { traceCollectionError: persisted.traceCollectionError } : {}),
        ...(typeof persisted.tracePersistenceError === 'string' ? { tracePersistenceError: persisted.tracePersistenceError } : {}),
        ...(typeof persisted.workspaceSnapshotDirectory === 'string' ? { workspaceSnapshotDirectory: persisted.workspaceSnapshotDirectory } : {}),
        ...(typeof persisted.finalStateSource === 'string' ? { finalStateSource: persisted.finalStateSource } : {}),
        ...(Object.hasOwn(persisted, 'finalState') ? { finalState: persisted.finalState } : {}),
        ...(Object.hasOwn(persisted, 'llmJudgeResults')
          ? { llmJudgeResults: parsePersistedJudgeResults(persisted.llmJudgeResults, persistedPath) }
          : {}),
        ...(Array.isArray(persisted.evidence) ? { evidence: persisted.evidence.filter((entry) => typeof entry === 'string') } : {}),
        ...(Array.isArray(persisted.verifiedActionIds) ? { verifiedActionIds: persisted.verifiedActionIds.filter((entry) => typeof entry === 'string') } : {}),
        ...(Array.isArray(persisted.verifiedDimensions) ? { verifiedDimensions: persisted.verifiedDimensions.filter((entry) => typeof entry === 'string') } : {}),
        ...(Array.isArray(persisted.faultMatches) ? { faultMatches: persisted.faultMatches.filter(isFaultMatch) } : {}),
        ...(Array.isArray(persisted.unsupported) ? { unsupported: persisted.unsupported.filter((entry) => typeof entry === 'string') } : {})
        }
      }
      break
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new Error(`Unable to read persisted trace metadata ${persistedPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (finalStateDirectory) {
    const inspected = await readFinalStateEvidence(path.resolve(root, finalStateDirectory), caseId)
    enriched = {
      ...enriched,
      ...(Object.hasOwn(inspected, 'finalState') ? { finalState: inspected.finalState, finalStateSource: 'inspector' } : {}),
      ...(typeof inspected.taskSuccess === 'boolean' ? { taskSuccess: inspected.taskSuccess } : {}),
      ...(inspected.evidence?.length ? { evidence: inspected.evidence } : {}),
      ...(inspected.verifiedActionIds?.length ? { verifiedActionIds: inspected.verifiedActionIds } : {}),
      ...(inspected.verifiedDimensions?.length ? { verifiedDimensions: inspected.verifiedDimensions } : {})
    }
  }
  return enriched
}

function parsePersistedJudgeResults(value, sourcePath) {
  if (!Array.isArray(value)) throw new Error(`Persisted LLM Judge results ${sourcePath} must be an array.`)
  return value.map((entry, index) => {
    const parsed = evalLlmJudgeResultSchema.safeParse(entry)
    if (!parsed.success) throw new Error(`Persisted LLM Judge result ${sourcePath}[${index}] is invalid: ${parsed.error.message}`)
    return parsed.data
  })
}

async function attachFaultMatches(execution, faultMatchPath, enabled) {
  if (!enabled) return execution
  const faultMatches = await readFaultMatches(faultMatchPath)
  return faultMatches.length > 0
    ? { ...execution, trace: { ...execution.trace, faultMatches } }
    : execution
}

async function readFaultMatches(filePath) {
  let content
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
  return content.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return undefined }
    })
    .filter(isFaultMatch)
}

function isFaultMatch(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.actionId === 'string' && typeof value.callerId === 'string' &&
    Number.isSafeInteger(value.attempt) && typeof value.injected === 'boolean' &&
    typeof value.errorCode === 'string'
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
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(parsed.data.verifiedActions.length > 0 ? { verifiedActionIds: parsed.data.verifiedActions } : {}),
    ...(parsed.data.verifiedDimensions.length > 0 ? { verifiedDimensions: parsed.data.verifiedDimensions } : {})
  }
}

function isMissingFile(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'ENOENT')
}

async function persistLiveTrace(tracePath, metadataPath, traceEvents, trace) {
  const suffix = `.tmp-${process.pid}`
  const temporaryTracePath = `${tracePath}${suffix}`
  const temporaryMetadataPath = `${metadataPath}${suffix}`
  try {
    await mkdir(path.dirname(tracePath), { recursive: true })
    await writeFile(temporaryTracePath, traceEvents.map((event) => JSON.stringify(event)).join('\n') + (traceEvents.length ? '\n' : ''), 'utf8')
    await writeFile(temporaryMetadataPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
    await rename(temporaryTracePath, tracePath)
    await rename(temporaryMetadataPath, metadataPath)
  } finally {
    await rm(temporaryTracePath, { force: true }).catch(() => undefined)
    await rm(temporaryMetadataPath, { force: true }).catch(() => undefined)
  }
}

async function persistLiveTraceMetadata(metadataPath, trace) {
  const temporaryMetadataPath = `${metadataPath}.tmp-${process.pid}`
  try {
    await mkdir(path.dirname(metadataPath), { recursive: true })
    await writeFile(temporaryMetadataPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')
    await rename(temporaryMetadataPath, metadataPath)
  } finally {
    await rm(temporaryMetadataPath, { force: true }).catch(() => undefined)
  }
}

async function persistEvalRunManifest(outputDirectory, input) {
  await mkdir(outputDirectory, { recursive: true })
  const manifestPath = path.resolve(outputDirectory, 'run-manifest.json')
  const runEntries = await Promise.all((input.runStates ?? []).map(async (state) => {
    const paths = input.traceDirectory ? liveTracePaths(input.traceDirectory, state.caseId, state) : undefined
    const rawTraceSha256 = paths ? await hashIfPresent(paths.rawTracePath) : undefined
    const normalizedTraceSha256 = paths ? await hashIfPresent(paths.normalizedTracePath) : undefined
    return {
      caseId: state.caseId,
      runId: state.runId,
      runIndex: state.runIndex,
      status: state.status,
      ...(state.outcome ? { outcome: state.outcome } : {}),
      ...(state.executionStatus ? { executionStatus: state.executionStatus } : {}),
      ...(state.failureStages ? { failureStages: state.failureStages } : {}),
      ...(paths ? {
        rawTracePath: paths.rawTracePath,
        normalizedTracePath: paths.normalizedTracePath,
        ...(rawTraceSha256 ? { rawTraceSha256 } : {}),
        ...(normalizedTraceSha256 ? { normalizedTraceSha256 } : {})
      } : {}),
      ...(state.trace?.workspaceSnapshotDirectory
        ? { workspaceSnapshotDirectory: state.trace.workspaceSnapshotDirectory }
        : {}),
      oracleEvidence: state.trace?.evidence ?? [],
      verifiedActionIds: state.trace?.verifiedActionIds ?? [],
      evidenceStatus: state.trace?.evidenceStatus ?? 'unavailable',
      ...(state.trace?.faultMatches ? { faultMatches: state.trace.faultMatches } : {})
    }
  }))
  const caseEntries = await Promise.all(input.results.map(async (result) => {
    const paths = input.traceDirectory ? liveTracePaths(input.traceDirectory, result.caseId, result.actual) : undefined
    const rawTraceSha256 = paths ? await hashIfPresent(paths.rawTracePath) : undefined
    const normalizedTraceSha256 = paths ? await hashIfPresent(paths.normalizedTracePath) : undefined
    return {
      caseId: result.caseId,
      outcome: result.outcome,
      ...(result.actual.runId ? { runId: result.actual.runId } : {}),
      ...(result.actual.runIndex !== undefined ? { runIndex: result.actual.runIndex } : {}),
      ...(result.failureStages ? { failureStages: result.failureStages } : {}),
      ...(paths ? {
        rawTracePath: paths.rawTracePath,
        normalizedTracePath: paths.normalizedTracePath,
        ...(rawTraceSha256 ? { rawTraceSha256 } : {}),
        ...(normalizedTraceSha256 ? { normalizedTraceSha256 } : {})
      } : {}),
      ...(result.actual.workspaceSnapshotDirectory
        ? { workspaceSnapshotDirectory: result.actual.workspaceSnapshotDirectory }
        : {}),
      ...(result.actual.preflight ? { preflight: result.actual.preflight } : {}),
      oracleEvidence: result.actual.evidence ?? [],
      verifiedActionIds: result.actual.verifiedActionIds ?? [],
      evidenceStatus: result.actual.evidenceStatus ?? 'unavailable',
      ...(result.actual.faultMatches ? { faultMatches: result.actual.faultMatches } : {})
    }
  }))
  const manifest = {
    schemaVersion: 'sciforge.capability-eval.run-manifest.v2',
    generatedAt: new Date().toISOString(),
    executionMode: input.executionMode,
    casesPath: input.casesPath,
    casesSha256: input.casesSha256,
    referencePath: input.referencePath,
    evaluatorRevision: input.evaluatorRevision,
    ...(input.experimentId ? { experimentId: input.experimentId } : {}),
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.eligibilityManifestPath ? { eligibilityManifestPath: input.eligibilityManifestPath } : {}),
    runs: runEntries,
    cases: caseEntries
  }
  const temporaryPath = `${manifestPath}.tmp-${process.pid}`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, manifestPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return manifestPath
}

async function hashIfPresent(filePath) {
  try {
    return createHash('sha256').update(await readFile(filePath)).digest('hex')
  } catch (error) {
    if (isMissingFile(error)) return undefined
    throw error
  }
}

function liveTracePaths(traceDirectory, caseId, run) {
  const safeCaseId = String(caseId).replace(/[^A-Za-z0-9._-]/gu, '_') || 'unknown'
  const safeRunId = String(run.runId ?? 'unbound').replace(/[^A-Za-z0-9._-]/gu, '_') || 'unbound'
  const runIndex = Number.isInteger(run.runIndex) ? run.runIndex : 0
  const directory = path.resolve(traceDirectory, `case-${safeCaseId}`, `run-${runIndex}-${safeRunId}`)
  return {
    directory,
    rawTracePath: path.join(directory, 'trace.jsonl'),
    normalizedTracePath: path.join(directory, 'trace.json'),
    faultMatchPath: path.join(directory, 'faults.jsonl')
  }
}

async function computeEvaluatorRevision() {
  const relativePaths = [
    'src/main/capability-eval/schema.ts',
    'src/main/capability-eval/evaluators.ts',
    'src/main/capability-eval/report.ts',
    'src/main/capability-eval/runner.ts',
    'src/main/capability-eval/trace-adapter.ts',
    'src/main/capability-eval/live-executor.ts'
  ]
  const hash = createHash('sha256')
  for (const relativePath of relativePaths) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(path.resolve(root, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function locateTracePath(traceDirectory, caseId) {
  const flatPath = path.resolve(traceDirectory, `${caseId}.jsonl`)
  try {
    await readFile(flatPath)
    return flatPath
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  const safeCaseId = String(caseId).replace(/[^A-Za-z0-9._-]/gu, '_') || 'unknown'
  const caseDirectory = path.resolve(traceDirectory, `case-${safeCaseId}`)
  const entries = await readdir(caseDirectory, { withFileTypes: true })
  const runDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => entry.name)
    .sort()
  const nestedPath = runDirectories.length > 0
    ? path.join(caseDirectory, runDirectories[0], 'trace.jsonl')
    : undefined
  if (!nestedPath) throw new Error(`No trace export found for ${caseId} under ${traceDirectory}.`)
  return nestedPath
}

function validateCaseReferences(cases, reference) {
  const ids = new Set()
  for (const evalCase of cases) {
    const actionIds = [
      ...evalCase.expected.mustDiscover,
      ...evalCase.expected.requiredActions,
      ...evalCase.expected.expectedActions,
      ...evalCase.expected.acceptableActions,
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
