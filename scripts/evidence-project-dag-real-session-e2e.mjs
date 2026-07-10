#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { toEvidenceDagTraceItems } = await tsImport(
  '../src/main/runtime/evidence-dag-feed.ts', import.meta.url)
const args = parseArgs(process.argv.slice(2))
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const outputRoot = resolve(args.outputDir || join(repoRoot, 'temp', 'evidence-project-dag-e2e', runId))
const storageRoot = join(outputRoot, 'isolated-storage')
const evidenceStore = join(storageRoot, 'evidence')
const projectDb = join(storageRoot, 'project', 'project.db')
const logRoot = join(storageRoot, 'logs')
const resultPath = join(outputRoot, 'result.json')
const evidenceUrl = `http://127.0.0.1:${args.evidencePort}`
const projectUrl = `http://127.0.0.1:${args.projectPort}`
const evidenceToken = `e2e-edag-${randomBytes(18).toString('hex')}`
const projectToken = `e2e-pdag-${randomBytes(18).toString('hex')}`
const children = new Set()
const report = {
  schemaVersion: 'evidence-project-dag-real-session-e2e.v1',
  runId,
  startedAt: new Date().toISOString(),
  input: {
    runtimeUrl: args.runtimeUrl,
    sessionId: args.sessionId,
    runtimeThreadId: args.runtimeThreadId,
    workspaceRoot: resolve(args.workspaceRoot),
    evidencePort: args.evidencePort,
    projectPort: args.projectPort,
    tracePolicy: 'canonical-visible-runtime-items',
  },
  isolation: {
    outputRoot,
    liveDagStorageRead: false,
    liveDagStorageWritten: false,
    workspaceWritten: false,
    storageRetained: Boolean(args.keepStorage),
  },
  config: {},
  checks: [],
  status: 'running',
}

main().catch((error) => {
  report.status = 'blocked'
  report.blocker = safeError(error)
  process.exitCode = 1
}).finally(async () => {
  for (const child of [...children]) await stopChild(child)
  report.completedAt = new Date().toISOString()
  mkdirSync(outputRoot, { recursive: true })
  if (!args.keepStorage) rmSync(storageRoot, { recursive: true, force: true })
  writeFileSync(resultPath, `${JSON.stringify(redact(report), null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ status: report.status, resultPath, checks: summarizeChecks(report.checks) })}\n`)
})

async function main() {
  requireArg(args.sessionId, '--session-id')
  requireArg(args.workspaceRoot, '--workspace-root')
  assertLocalUrl(args.runtimeUrl, '--runtime-url')
  assertPortAvailable(args.evidencePort)
  assertPortAvailable(args.projectPort)
  mkdirSync(evidenceStore, { recursive: true })
  mkdirSync(dirname(projectDb), { recursive: true })
  mkdirSync(logRoot, { recursive: true })

  const modelRouter = loadModelRouterConfig(args.settingsPath)
  report.config = {
    source: modelRouter.source,
    baseUrl: modelRouter.baseUrl,
    model: modelRouter.model,
    runtimeApiKeyConfigured: Boolean(modelRouter.apiKey),
  }
  check('model-router-config', Boolean(modelRouter.apiKey && modelRouter.baseUrl && modelRouter.model), {
    source: modelRouter.source,
  })

  const runtimeThread = await requestJson(
    `${args.runtimeUrl}/v1/threads/${encodeURIComponent(args.runtimeThreadId)}`)
  const runtimeWorkspace = resolve(String(runtimeThread.workspace || ''))
  check('runtime-session-readable', runtimeThread.id === args.runtimeThreadId, {
    threadId: runtimeThread.id,
    latestSeq: runtimeThread.latestSeq,
  })
  check('runtime-workspace-match', runtimeWorkspace === resolve(args.workspaceRoot), {
    runtimeWorkspace,
  })
  const runtimeItems = (runtimeThread.turns || []).flatMap((turn) => turn.items || [])
  const trace = toEvidenceDagTraceItems(runtimeItems)
  check('canonical-visible-runtime-trace', trace.length >= 2 &&
    trace.some((item) => item.type === 'tool_result'), {
    totalRuntimeItems: runtimeItems.length,
    runtimeKinds: counts(runtimeItems.map((item) => item.kind)),
    selectedItems: trace.length,
    selectedKinds: counts(trace.map((item) => item.type)),
    sourceReferences: trace.reduce((total, item) =>
      total + (Array.isArray(item.source_refs) ? item.source_refs.length : 0), 0),
  })
  const prefixTrace = trace.slice(0, 1)
  const projectKey = `path:${resolve(args.workspaceRoot).replaceAll('\\', '/')}`

  let evidence = startEvidence(modelRouter)
  await waitReady(`${evidenceUrl}/version`, evidenceToken, evidence)
  const prefixBody = evidenceUpdateBody({
    trace: prefixTrace,
    watermark: prefixTrace.at(-1).id,
    reason: 'manual_update',
    projectKey,
  })
  const prefixUpdate = await serviceRequest(evidenceUrl, evidenceToken, '/updates', {
    method: 'POST', body: prefixBody, timeoutMs: args.updateTimeoutMs,
  })
  const firstSnapshot = prefixUpdate.snapshot
  check('evidence-prefix-snapshot-committed', firstSnapshot?.status === 'committed', {
    version: firstSnapshot?.version, digest: firstSnapshot?.digest,
  })

  const fullBody = evidenceUpdateBody({
    trace,
    watermark: trace.at(-1).id,
    reason: 'manual_update',
    projectKey,
  })
  const fullUpdate = await serviceRequest(evidenceUrl, evidenceToken, '/updates', {
    method: 'POST', body: fullBody, timeoutMs: args.updateTimeoutMs,
  })
  const evidenceSnapshot = fullUpdate.snapshot
  check('evidence-full-snapshot-committed', evidenceSnapshot?.status === 'committed', {
    version: evidenceSnapshot?.version, digest: evidenceSnapshot?.digest,
    advancedFromPrefix: evidenceSnapshot?.digest !== firstSnapshot?.digest,
  })
  const replay = await serviceRequest(evidenceUrl, evidenceToken, '/updates', {
    method: 'POST', body: fullBody, timeoutMs: args.updateTimeoutMs,
  })
  check('evidence-update-idempotent', replay.idempotent === true &&
    replay.snapshot?.digest === evidenceSnapshot.digest, {
    idempotent: replay.idempotent, digest: replay.snapshot?.digest,
  })

  const prov = await serviceRequest(evidenceUrl, evidenceToken,
    `/threads/${encodeURIComponent(args.sessionId)}/prov-json`)
  const registry = prov['edag:artifactRegistry'] || {}
  const evidenceAssessments = prov['edag:assessments'] || []
  const artifacts = registry.artifacts || []
  const artifactVersions = registry.artifactVersions || []
  const sourceAnchors = registry.sourceAnchors || []
  const artifactById = new Map(artifacts.map((artifact) => [artifact.artifactId, artifact]))
  const versionById = new Map(artifactVersions.map((version) => [version.versionId, version]))
  const researchSourceAnchors = sourceAnchors.flatMap((anchor) => {
    const artifact = artifactById.get(anchor.artifactId)
    const version = versionById.get(anchor.artifactVersionId)
    if (!artifact || !version || artifact.kind === 'log' ||
      !isResolvableResearchLocator(version) || !anchor.selector?.type) return []
    return [{
      artifactKind: artifact.kind,
      locator: version.locator,
      locatorClass: locatorClass(version.locator),
      contentDigest: Boolean(version.contentDigest),
      selectorType: anchor.selector.type,
      anchorDigest: Boolean(anchor.anchorDigest),
    }]
  })
  const evidenceLevels = new Set(evidenceAssessments.map((item) => item.level))
  check('evidence-artifact-source-anchor', researchSourceAnchors.length > 0, {
    artifacts: artifacts.length,
    artifactKinds: counts(artifacts.map((item) => item.kind)),
    artifactVersions: artifactVersions.length,
    artifactLocators: artifactVersions.map((item) => ({
      kind: artifactById.get(item.artifactId)?.kind,
      locator: item.locator,
      locatorClass: locatorClass(item.locator),
      contentDigest: Boolean(item.contentDigest),
    })),
    sourceAnchors: sourceAnchors.length,
    resolvableResearchSourceAnchors: researchSourceAnchors,
  })
  check('evidence-a0-a2-ledger', ['A0', 'A1', 'A2'].every((level) => evidenceLevels.has(level)), {
    levels: [...evidenceLevels].sort(), assessments: evidenceAssessments.length,
  })
  const snapshotFiles = findFiles(evidenceStore, (path) => path.endsWith('.prov.json'))
  check('evidence-history-retained', snapshotFiles.length >= 3, {
    immutableProvFiles: snapshotFiles.length,
  })

  await stopChild(evidence)
  evidence = startEvidence(modelRouter)
  await waitReady(`${evidenceUrl}/version`, evidenceToken, evidence)
  const recoveredEvidence = await serviceRequest(evidenceUrl, evidenceToken,
    `/threads/${encodeURIComponent(args.sessionId)}/snapshot`)
  check('evidence-restart-recovery', recoveredEvidence.digest === evidenceSnapshot.digest, {
    digest: recoveredEvidence.digest,
  })

  let project = startProject(modelRouter)
  await waitReady(`${projectUrl}/version`, projectToken, project)
  await serviceRequest(projectUrl, projectToken, '/goals', {
    method: 'POST',
    body: {
      projectKey,
      title: 'Compile and audit evidence from a runtime research session',
      description: 'General real-session Evidence/Project DAG E2E goal.',
      actorType: 'human', actorId: 'e2e-harness',
    },
  })
  const projectUpdateBody = {
    projectKey,
    evidenceVector: [{ threadId: args.sessionId, digest: evidenceSnapshot.digest }],
    evidenceSnapshots: [evidenceSnapshot],
    capturedScope: {
      includedSessions: [args.sessionId], excludedSessions: [], isolatedSessions: [],
    },
    reason: 'evidence_snapshot_committed', priority: 10, autonomyMode: 'autonomous',
  }
  const queued = await serviceRequest(projectUrl, projectToken, '/updates', {
    method: 'POST', body: projectUpdateBody,
  })
  check('project-update-durable-enqueued', Boolean(queued.id && queued.status), {
    jobId: queued.id, status: queued.status,
  })
  const preRestart = await optionalServiceRequest(projectUrl, projectToken,
    `/updates/status?projectKey=${encodeURIComponent(projectKey)}`)
  await stopChild(project)
  project = startProject(modelRouter)
  await waitReady(`${projectUrl}/version`, projectToken, project)
  const projectStatus = await waitProjectFresh(projectKey, args.updateTimeoutMs)
  check('project-restart-recovery', projectStatus.state === 'fresh' && projectStatus.pending === 0, {
    preRestartState: preRestart?.state || 'unavailable',
    finalState: projectStatus.state,
    pending: projectStatus.pending,
  })
  const projectSnapshot = projectStatus.committedSnapshot
  check('project-exact-evidence-vector', sameJson(projectSnapshot?.evidenceVector,
    projectUpdateBody.evidenceVector), {
    projectDigest: projectSnapshot?.digest,
    evidenceVector: projectSnapshot?.evidenceVector,
  })
  const projectAssessments = await serviceRequest(projectUrl, projectToken,
    `/assessments?projectKey=${encodeURIComponent(projectKey)}&snapshotDigest=${encodeURIComponent(projectSnapshot.digest)}`)
  let projectLevels = new Set(projectAssessments.map((item) => item.level))
  check('project-a0-a2-ledger', ['A0', 'A1', 'A2'].every((level) => projectLevels.has(level)), {
    levels: [...projectLevels].sort(), assessments: projectAssessments.length,
  })

  const claims = await serviceRequest(projectUrl, projectToken,
    `/claims?projectKey=${encodeURIComponent(projectKey)}`)
  check('project-claims-compiled', claims.length > 0, { claims: claims.length })
  const claimId = claims[0]?.id
  const provenance = claimId ? await serviceRequest(projectUrl, projectToken,
    `/provenance/${encodeURIComponent(claimId)}?projectKey=${encodeURIComponent(projectKey)}` +
    `&snapshotDigest=${encodeURIComponent(projectSnapshot.digest)}`) : null
  const provenanceAssertions = (provenance?.paths || []).flatMap((path) =>
    path.sourceAssertions || [])
  const researchProvenance = provenanceAssertions.filter((assertion) =>
    assertion.artifact?.kind !== 'log' &&
    isResolvableResearchLocator(assertion.artifactVersion) &&
    assertion.sourceAnchor?.selector?.type)
  check('project-cross-layer-provenance', Boolean(provenance?.reachesArtifact &&
    provenance?.paths?.length && provenanceLevel(provenance.provenanceLevel) >= 2 &&
    researchProvenance.length > 0), {
    targetId: claimId,
    reachesArtifact: provenance?.reachesArtifact,
    provenanceLevel: provenance?.provenanceLevel,
    pathCount: provenance?.paths?.length || 0,
    resolvableResearchPaths: researchProvenance.map((assertion) => ({
      artifactKind: assertion.artifact?.kind,
      locator: assertion.artifactVersion?.locator,
      locatorClass: locatorClass(assertion.artifactVersion?.locator),
      selectorType: assertion.sourceAnchor?.selector?.type,
      level: assertion.level,
    })),
    breakpoints: (provenance?.breakpoints || []).map((item) => item.reason),
  })

  const l1Audit = await serviceRequest(projectUrl, projectToken, '/audits', {
    method: 'POST',
    body: { projectKey, targetDigest: projectSnapshot.digest, level: 'L1' },
    timeoutMs: args.updateTimeoutMs,
  })
  const completedAudit = await waitProjectAudit(l1Audit.id, args.updateTimeoutMs)
  const afterAudit = await waitProjectFresh(projectKey, args.updateTimeoutMs)
  const graphAfterAudit = await serviceRequest(projectUrl, projectToken,
    `/graph?projectKey=${encodeURIComponent(projectKey)}`)
  const decisions = graphAfterAudit.decisions || []
  const assessmentsAfterAudit = await serviceRequest(projectUrl, projectToken,
    `/assessments?projectKey=${encodeURIComponent(projectKey)}`)
  projectLevels = new Set(assessmentsAfterAudit.map((item) => item.level))
  const attention = await serviceRequest(projectUrl, projectToken,
    `/attention?projectKey=${encodeURIComponent(projectKey)}`)
  check('project-a3-autonomous-decision', projectLevels.has('A3') && decisions.some(
    (item) => item.decided_by === 'agent'), {
    auditId: l1Audit.id,
    auditStatus: completedAudit.status,
    a3Assessments: assessmentsAfterAudit.filter((item) => item.level === 'A3').length,
    agentDecisions: decisions.filter((item) => item.decided_by === 'agent').length,
    resultingSnapshot: afterAudit.committedSnapshot?.digest,
  })
  check('project-attention-frontier', attention.length > 0, {
    attentionCount: attention.length,
    blockingCount: attention.filter((item) => item.blocking).length,
  })

  const modeResults = {}
  for (const mode of ['checkpointed', 'supervised']) {
    await serviceRequest(projectUrl, projectToken, '/policy', {
      method: 'POST',
      body: {
        projectKey, autonomyMode: mode,
        checkpoints: ['audit_finding', 'claim_fragile'], actorId: 'e2e-harness',
      },
    })
    await serviceRequest(projectUrl, projectToken, '/updates', {
      method: 'POST', body: { ...projectUpdateBody, reason: 'policy_changed', autonomyMode: mode },
    })
    const status = await waitProjectFresh(projectKey, args.updateTimeoutMs)
    const reviews = await serviceRequest(projectUrl, projectToken,
      `/reviews?projectKey=${encodeURIComponent(projectKey)}&status=open`)
    modeResults[mode] = {
      state: status.state,
      policyMode: status.autonomy?.autonomy_mode,
      openReviews: reviews.length,
      snapshotDigest: status.committedSnapshot?.digest,
    }
  }
  check('project-shared-autonomy-mode-path', Object.entries(modeResults).every(
    ([mode, value]) => value.state === 'fresh' && value.policyMode === mode), modeResults)

  const historicalProject = await serviceRequest(projectUrl, projectToken,
    `/snapshots/${projectSnapshot.digest}`)
  check('project-history-retained', historicalProject.digest === projectSnapshot.digest, {
    historicalDigest: historicalProject.digest,
    latestDigest: (await serviceRequest(projectUrl, projectToken,
      `/snapshots/latest?projectKey=${encodeURIComponent(projectKey)}`)).digest,
  })
  report.status = report.checks.every((item) => item.status === 'passed') ? 'passed' : 'failed'

  function evidenceUpdateBody({ trace: selectedTrace, watermark, reason, projectKey: key }) {
    return {
      threadId: args.sessionId,
      targetWatermark: String(watermark),
      reason,
      priority: 'P2',
      workspaceRoot: resolve(args.workspaceRoot),
      projectRoot: resolve(args.workspaceRoot),
      projectKey: key,
      trace: selectedTrace,
      accessPolicy: { read: true, source: 'real-session-e2e' },
    }
  }

  function startEvidence(config) {
    return startSidecar({
      name: 'evidence', module: 'evidence_dag.server',
      pythonPath: join(repoRoot, 'packages', 'workers', 'evidence-dag', 'src'),
      env: {
        EDAG_HOST: '127.0.0.1', EDAG_PORT: String(args.evidencePort),
        EDAG_STORAGE_DIR: evidenceStore,
        SCIFORGE_EVIDENCE_DAG_API_KEY: evidenceToken,
        EDAG_MODEL_ROUTER_BASE_URL: config.baseUrl,
        EDAG_MODEL_ROUTER_API_KEY: config.apiKey,
        EDAG_MODEL_ROUTER_MODEL: config.model,
        EDAG_MODEL_ROUTER_TIMEOUT_S: String(args.modelTimeoutSeconds),
        EDAG_MODEL_ROUTER_MAX_ATTEMPTS: '2',
      },
    })
  }

  function startProject(config) {
    return startSidecar({
      name: 'project', module: 'project_dag.server',
      pythonPath: [
        join(repoRoot, 'packages', 'workers', 'project-dag', 'src'),
        join(repoRoot, 'packages', 'workers', 'evidence-dag', 'src'),
      ].join(':'),
      env: {
        PDAG_HOST: '127.0.0.1', PDAG_PORT: String(args.projectPort),
        PDAG_SESSION_DIR: evidenceStore, PDAG_DB_PATH: projectDb,
        SCIFORGE_PROJECT_DAG_API_KEY: projectToken,
        EDAG_MODEL_ROUTER_BASE_URL: config.baseUrl,
        EDAG_MODEL_ROUTER_API_KEY: config.apiKey,
        EDAG_MODEL_ROUTER_MODEL: config.model,
        EDAG_MODEL_ROUTER_TIMEOUT_S: String(args.modelTimeoutSeconds),
        EDAG_MODEL_ROUTER_MAX_ATTEMPTS: '2',
      },
    })
  }

  async function waitProjectFresh(key, timeoutMs) {
    const started = Date.now()
    let last
    while (Date.now() - started < timeoutMs) {
      last = await serviceRequest(projectUrl, projectToken,
        `/updates/status?projectKey=${encodeURIComponent(key)}`)
      if (last.state === 'fresh' && last.pending === 0) return last
      if (last.state === 'update_failed') {
        throw new Error(`Project update failed: ${last.jobs?.[0]?.last_error || 'unknown error'}`)
      }
      await delay(300)
    }
    throw new Error(`Project update did not become fresh (last state: ${last?.state || 'unknown'})`)
  }

  async function waitProjectAudit(auditId, timeoutMs) {
    const started = Date.now()
    let last
    while (Date.now() - started < timeoutMs) {
      last = await serviceRequest(projectUrl, projectToken,
        `/audits/${encodeURIComponent(auditId)}`)
      if (last.status === 'completed' || last.status === 'stale') return last
      if (last.status === 'failed') {
        throw new Error(`Project audit failed: ${last.error || 'unknown error'}`)
      }
      await delay(300)
    }
    throw new Error(`Project audit did not finish (last state: ${last?.status || 'unknown'})`)
  }
}

function startSidecar({ name, module, pythonPath, env }) {
  const logPath = join(logRoot, `${name}.log`)
  const child = spawn(args.python, ['-u', '-m', module], {
    cwd: repoRoot,
    env: minimalEnv({ ...env, PYTHONPATH: pythonPath }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  const chunks = []
  const capture = (chunk) => {
    chunks.push(String(chunk))
    if (chunks.join('').length > 100_000) chunks.shift()
    writeFileSync(logPath, redactText(chunks.join('')))
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.once('exit', () => children.delete(child))
  child._e2e = { name, logPath, chunks }
  return child
}

async function waitReady(url, token, child, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(
      `${child._e2e.name} sidecar exited before ready: ${redactText(child._e2e.chunks.join('')).slice(-1200)}`)
    try {
      await requestJson(url, { headers: authHeaders(token), timeoutMs: 1500 })
      return
    } catch {
      // Readiness is eventually consistent; the bounded loop retries below.
    }
    await delay(150)
  }
  throw new Error(`${child._e2e.name} sidecar readiness timeout`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolveStop() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolveStop() })
    child.kill('SIGTERM')
  })
}

async function serviceRequest(baseUrl, token, path, options = {}) {
  const method = options.method || 'GET'
  const attempts = method === 'GET' || path === '/updates' ? 3 : 1
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const body = await requestJson(`${baseUrl}${path}`, {
        method,
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        timeoutMs: options.timeoutMs,
      })
      if (body?.ok !== true) throw new Error(body?.error?.message || `ServiceResult failed for ${path}`)
      return body.data
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const transient = /fetch failed|timeout|socket|ECONN|HTTP 5\d\d/i.test(message)
      if (!transient || attempt === attempts) throw error
      await delay(250 * (2 ** (attempt - 1)))
    }
  }
  throw lastError
}

async function optionalServiceRequest(...input) {
  try { return await serviceRequest(...input) } catch { return null }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET', headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 15_000),
  })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = {} }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}: ${body.message || body.error?.message || 'request failed'}`)
  return body
}

function loadModelRouterConfig(explicitPath) {
  const candidates = [
    explicitPath,
    join(homedir(), 'Library', 'Application Support', 'SciForge', 'sciforge-settings.json'),
  ].filter(Boolean)
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const config = parsed.modelRouter || {}
    const apiKey = process.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY || config.runtimeApiKey || ''
    const baseUrl = process.env.SCIFORGE_MODEL_ROUTER_BASE_URL || config.baseUrl || ''
    const model = process.env.SCIFORGE_MODEL_ROUTER_MODEL || config.publicModelAlias || ''
    if (apiKey && baseUrl && model) {
      assertLocalUrl(baseUrl, 'Model Router base URL')
      return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), model, source: basename(path) }
    }
  }
  throw new Error('No configured local Model Router runtime boundary was found')
}

function minimalEnv(extra) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || homedir(),
    TMPDIR: process.env.TMPDIR || tmpdir(), LANG: process.env.LANG || 'C.UTF-8',
    PYTHONUNBUFFERED: '1', NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1', ...extra,
  }
}

function check(name, condition, details = {}) {
  const item = { name, status: condition ? 'passed' : 'failed', details: redact(details) }
  report.checks.push(item)
  if (!condition && !args.continueOnFailure) throw new Error(`E2E check failed: ${name}`)
  return item
}

function findFiles(root, predicate) {
  if (!existsSync(root)) return []
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (predicate(path)) found.push(path)
    }
  }
  walk(root)
  return found
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /(api[-_]?key|authorization|bearer|password|secret|token)/i.test(key)
      ? (item ? '<redacted-configured>' : item)
      : redact(item),
  ]))
}

function redactText(value) {
  return String(value)
    .replace(/(authorization|api[-_]?key|runtime[-_]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
}

function safeError(error) {
  return { name: error instanceof Error ? error.name : 'Error',
    message: redactText(error instanceof Error ? error.message : String(error)) }
}

function counts(values) {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [
    value, values.filter((item) => item === value).length,
  ]))
}

function locatorClass(value) {
  const locator = typeof value === 'string' ? value.trim() : ''
  if (/^https?:\/\//i.test(locator)) return 'url'
  if (/^doi:/i.test(locator)) return 'doi'
  if (/^citation:/i.test(locator)) return 'citation'
  if (/^(?:swh|swhid):/i.test(locator)) return 'software-heritage'
  return locator ? 'file' : 'missing'
}

function isResolvableResearchLocator(version) {
  if (!version || typeof version !== 'object') return false
  const kind = locatorClass(version.locator)
  if (kind === 'url' || kind === 'doi') return true
  return kind === 'file' && Boolean(version.contentDigest) &&
    (version.availability === 'available' || version.availability === 'moved')
}

function provenanceLevel(value) {
  const match = /^L([0-4])$/.exec(typeof value === 'string' ? value : '')
  return match ? Number(match[1]) : -1
}

function summarizeChecks(checks) {
  return counts(checks.map((item) => item.status))
}

function sameJson(left, right) { return canonicalJson(left) === canonicalJson(right) }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function authHeaders(token) { return { Accept: 'application/json', Authorization: `Bearer ${token}` } }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)) }
function requireArg(value, name) { if (!value) throw new Error(`${name} is required`) }
function assertLocalUrl(value, name) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(`${name} must use local HTTP`)
  }
}
function assertPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`invalid sidecar port: ${port}`)
}

function parseArgs(argv) {
  const values = {
    runtimeUrl: 'http://127.0.0.1:8900', sessionId: '', runtimeThreadId: '',
    workspaceRoot: '', evidencePort: 4397, projectPort: 4398,
    python: process.env.PYTHON || 'python3', settingsPath: '', outputDir: '',
    updateTimeoutMs: 12 * 60_000, modelTimeoutSeconds: 240,
    keepStorage: false, continueOnFailure: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--keep-storage') { values.keepStorage = true; continue }
    if (arg === '--continue-on-failure') { values.continueOnFailure = true; continue }
    const next = argv[++index]
    if (next === undefined) throw new Error(`missing value for ${arg}`)
    const key = {
      '--runtime-url': 'runtimeUrl', '--session-id': 'sessionId',
      '--runtime-thread-id': 'runtimeThreadId', '--workspace-root': 'workspaceRoot',
      '--evidence-port': 'evidencePort', '--project-port': 'projectPort',
      '--python': 'python', '--settings': 'settingsPath', '--output-dir': 'outputDir',
      '--timeout-ms': 'updateTimeoutMs', '--model-timeout-seconds': 'modelTimeoutSeconds',
    }[arg]
    if (!key) throw new Error(`unknown argument: ${arg}`)
    values[key] = ['evidencePort', 'projectPort', 'updateTimeoutMs', 'modelTimeoutSeconds'].includes(key)
      ? Number(next) : next
  }
  if (!values.runtimeThreadId) {
    values.runtimeThreadId = values.sessionId.startsWith('sciforge:')
      ? values.sessionId.slice('sciforge:'.length) : values.sessionId
  }
  return values
}
