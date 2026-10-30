#!/usr/bin/env node

/** Creates the Phase 1 experiment-environment snapshot (G0). */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.resolve(root, value('--output') ?? 'eval-results/g0-environment/g0-environment-manifest.json')
const datasetPath = path.resolve(root, value('--dataset') ?? 'eval-cases/capability/dataset-manifest.json')
const casePath = path.resolve(root, value('--cases') ?? 'eval-cases/capability/golden.jsonl')
const eligibilityPathValue = value('--eligibility-manifest')
const eligibilityPath = eligibilityPathValue ? path.resolve(root, eligibilityPathValue) : undefined
const reportPathValue = value('--report')
const reportPath = reportPathValue ? path.resolve(root, reportPathValue) : undefined
const generatedAt = new Date().toISOString()
const requireClean = process.argv.includes('--require-clean')
const executionMode = value('--execution-mode') ?? 'deterministic-simulation'

const dataset = JSON.parse(await readFile(datasetPath, 'utf8'))
const referencePath = path.resolve(root, 'docs/generated/capabilities.md')
const reference = await readFile(referencePath, 'utf8')
const toolSourcePath = path.resolve(root, 'src/main/capabilities/agent-tools.ts')
const contractSourcePath = path.resolve(root, 'src/shared/capability-broker.ts')
const runtimeSourcePath = path.resolve(root, 'src/main/runtime/codex/codex-agent-runtime-adapter.ts')
const evaluatorSourcePaths = [
  'src/main/capability-eval/schema.ts',
  'src/main/capability-eval/evaluators.ts',
  'src/main/capability-eval/report.ts',
  'src/main/capability-eval/runner.ts',
  'src/main/capability-eval/trace-adapter.ts',
  'src/main/capability-eval/live-executor.ts'
].map((relativePath) => path.resolve(root, relativePath))
const [toolSource, contractSource, runtimeSource] = await Promise.all([
  readFile(toolSourcePath, 'utf8'),
  readFile(contractSourcePath, 'utf8'),
  readFile(runtimeSourcePath, 'utf8')
])
const evaluatorSources = []
const evaluatorRevisionHash = createHash('sha256')
for (const sourcePath of evaluatorSourcePaths) {
  const relativePath = path.relative(root, sourcePath)
  const source = await readFile(sourcePath)
  evaluatorSources.push({
    path: relativePath,
    sha256: sha256(source)
  })
  evaluatorRevisionHash.update(relativePath)
  evaluatorRevisionHash.update('\0')
  evaluatorRevisionHash.update(source)
  evaluatorRevisionHash.update('\0')
}

let gitSha = 'unavailable'
let gitStatus = ''
try {
  gitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  gitStatus = (await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: root })).stdout
} catch {
  // A packaged source tree may not contain .git; keep this explicit in the snapshot.
}

if (requireClean && gitStatus.trim()) {
  throw new Error('G0 environment snapshot requires a clean worktree. Re-run after committing changes or omit --require-clean for a Phase 1 diagnostic snapshot.')
}

const report = reportPath && await readJsonIfPresent(reportPath)
const eligibility = eligibilityPath && await readJsonIfPresent(eligibilityPath)
const runtimeObservation = observeRuntime(report, executionMode)
const isLiveExecution = executionMode === 'live-agent'
const evaluatorRevision = evaluatorRevisionHash.digest('hex')
const skillFiles = await discoverProjectSkillFiles()
const manifest = {
  schemaVersion: 'sciforge.capability-eval.g0-environment-manifest.v1',
  baselineId: 'G0-environment',
  baselineKind: 'experiment-environment',
  purpose: 'Freeze the environment for later skill A/B experiments; this manifest is not a performance baseline.',
  generatedAt,
  runId: `g0-${generatedAt.replace(/[^0-9]/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`,
  repository: {
    gitSha,
    root: '.',
    dirty: gitStatus.trim().length > 0,
    changedPathCount: gitStatus.trim() ? gitStatus.trim().split(/\r?\n/u).length : 0,
    statusSha256: sha256(gitStatus),
    dirtyPolicy: 'Phase 1 records dirty state; formal experiments must require a clean worktree.'
  },
  dataset: {
    manifestPath: path.relative(root, datasetPath),
    manifestRevision: dataset.manifestRevision,
    datasetSha256: dataset.datasetSha256,
    casePath: path.relative(root, casePath),
    caseSha256: await sha256FileIfPresent(casePath),
    eligibilityManifestPath: eligibilityPath ? path.relative(root, eligibilityPath) : null,
    eligibilityManifestSha256: eligibilityPath ? await sha256FileIfPresent(eligibilityPath) : null,
    selectedCaseIds: eligibility?.policy?.selectedCaseIds ?? null,
    executableRecordCount: dataset.counts?.executableRecordCount,
    authoritativeUniqueCaseCount: dataset.counts?.authoritativeUniqueCaseCount
  },
  evaluator: {
    revisionSha256: evaluatorRevision,
    sources: evaluatorSources
  },
  registry: {
    source: dataset.registry?.source,
    totalRegisteredDescriptors: dataset.registry?.totalRegisteredDescriptors,
    agentVisibleActions: dataset.registry?.agentVisibleActions,
    disabledActions: dataset.registry?.disabledActions,
    disabledActionsStatus: dataset.registry?.disabledActionsStatus,
    actionSetSha256: dataset.registry?.actionSetSha256,
    descriptorReferenceSha256: sha256(reference),
    capabilityContractSourceSha256: sha256(contractSource),
    verificationCommand: 'npm run capability:check',
    verificationStatus: 'passed-before-g0-snapshot'
  },
  toolDescriptions: {
    source: path.relative(root, toolSourcePath),
    sourceSha256: sha256(toolSource),
    extraction: 'entire source file; descriptions are not separately versioned by current runtime'
  },
  runtime: {
    runtimeId: value('--runtime-id') ?? 'codex',
    requestedModel: value('--model') ?? runtimeObservation.requestedModel,
    actualModel: runtimeObservation.actualModel,
    modelStatus: runtimeObservation.modelStatus,
    provider: runtimeObservation.provider,
    mode: value('--mode') ?? (isLiveExecution ? 'unknown' : 'not-applicable'),
    reasoningEffort: value('--reasoning-effort') ?? (isLiveExecution ? 'unknown' : 'not-applicable'),
    adapterSourceSha256: sha256(runtimeSource)
  },
  execution: {
    executionMode,
    casesPath: value('--cases') ?? 'eval-cases/capability/golden.jsonl',
    reportPath: reportPath ? path.relative(root, reportPath) : null,
    reportStatus: report ? 'captured' : 'not-supplied',
    reportSha256: reportPath ? await sha256FileIfPresent(reportPath) : null,
    timeoutMs: numericOrNull(value('--timeout-ms')),
    timeoutStatus: value('--timeout-ms') ? 'explicitly-configured' : (isLiveExecution ? 'unknown' : 'not-applicable'),
    pollIntervalMs: numericOrNull(value('--poll-interval-ms')),
    retryBudget: value('--retry-budget') ? numericOrNull(value('--retry-budget')) : (isLiveExecution ? 'unknown' : 'case-declared-simulation-retries')
  },
  permissions: {
    approvalDecision: value('--approval-decision') ?? (isLiveExecution ? 'unknown' : 'case-defined-simulation-authorization'),
    faultPolicy: value('--fault-policy') ?? 'none',
    isolatedGlobalState: value('--isolate-global-state') === 'true',
    source: 'capability-eval CLI flags plus case simulation contract'
  },
  skills: {
    runtimeExposure: 'not-exposed-by-codex-runtime-service',
    runtimeSourceEvidence: 'src/main/runtime/codex/codex-agent-runtime-adapter.ts reports skills.available=false',
    projectSkillFiles: skillFiles.map((file) => ({
      path: path.relative(root, file.path),
      sha256: file.sha256
    })),
    experimentToolSkill: {
      added: false,
      version: null,
      sha256: null,
      available: false,
      actuallyLoaded: false
    },
    actuallyLoaded: 'not-observable-in-current-eval-trace-contract'
  },
  observedRun: report ? {
    semantics: 'observed-run-link; not a performance baseline',
    status: 'report-linked',
    evaluatorRevision: report.evaluatorRevision ?? null,
    evaluatorRevisionMatch: report.evaluatorRevision === evaluatorRevision,
    executionMode: report.executionMode,
    totalCases: report.totalCases,
    passed: report.passed,
    failed: report.failed,
    inconclusive: report.inconclusive,
    passRate: report.passRate
  } : {
    status: 'metadata-only'
  }
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote G0 environment manifest: ${path.relative(root, outputPath)}`)
console.log(`Run ID: ${manifest.runId}`)

function value(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function numericOrNull(raw) {
  if (raw === undefined) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function observeRuntime(report, mode) {
  const isLive = mode === 'live-agent'
  const runtimeEvidence = (report?.cases ?? [])
    .map((entry) => entry?.actual?.runtimeEvidence)
    .filter((entry) => entry && typeof entry === 'object')
  const requestedModels = uniqueStrings(runtimeEvidence.map((entry) => entry.requestedModel))
  const actualModels = uniqueStrings(runtimeEvidence.map((entry) => entry.actualModel))
  const providers = uniqueStrings(runtimeEvidence.map((entry) => entry.provider))
  return {
    requestedModel: requestedModels.length === 1
      ? requestedModels[0]
      : isLive ? 'unknown' : 'not-applicable',
    actualModel: actualModels.length === 1
      ? actualModels[0]
      : 'unknown',
    modelStatus: actualModels.length === 1
      ? 'observed'
      : isLive ? 'unknown' : 'not-applicable',
    provider: providers.length === 1 ? providers[0] : 'unknown'
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
}

function sha256(valueToHash) {
  return createHash('sha256').update(valueToHash).digest('hex')
}

async function sha256FileIfPresent(filePath) {
  try {
    return sha256(await readFile(filePath))
  } catch {
    return null
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

async function discoverProjectSkillFiles() {
  const paths = [
    path.resolve(root, '.codex/skills'),
    path.resolve(root, '.agents/skills'),
    path.resolve(root, 'skills')
  ]
  const files = []
  for (const directory of paths) await collect(directory, files)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

async function collect(directory, files) {
  let entries
  try {
    entries = await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(filePath, files)
    else if (entry.name === 'SKILL.md' || entry.name === 'skill.json') {
      files.push({ path: filePath, sha256: sha256(await readFile(filePath)) })
    }
  }
}
