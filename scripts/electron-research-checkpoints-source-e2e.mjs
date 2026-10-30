#!/usr/bin/env node

import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSourceSmokeConfiguration } from './electron-domain-smoke-support.mjs'
import { CAPABILITY_BROKER_CONTRACT_VERSION } from '../src/shared/capability-broker-contract-version.mjs'

const require = createRequire(import.meta.url)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = parseOptions(process.argv.slice(2))
const effectiveRepositoryRoot = options.repositoryRoot ?? repositoryRoot
const timeoutMs = options.timeoutMs ?? 120_000
const THREAD_TITLE = 'Source Electron Research Checkpoint E2E'
const RESPONSE_TEXT = 'The deterministic real Agent Runtime turn produced this research finding.'
const RUNTIME_ID = 'codex'
const API_KEY = 'sciforge-source-research-checkpoint-e2e-key'
const TEMP_PREFIX = 'sciforge-source-research-checkpoint-e2e-'
const WORKSPACE_PREFIX = '.sciforge-source-research-checkpoint-e2e-workspace-'
const REQUIRED_CAPABILITIES = Object.freeze([
  'research-checkpoints.status',
  'research-checkpoints.turn-status',
  'research-checkpoints.read',
  'artifact-versions.describe-v2',
  'artifact-versions.list-v2',
  'artifact-versions.content.read-range-v2'
])

const source = await createSourceSmokeConfiguration(effectiveRepositoryRoot)
const temporaryDirectory = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
const userDataDirectory = join(temporaryDirectory, 'user-data')
const workspaceParent = homedir()
const workspaceDirectory = await mkdtemp(join(workspaceParent, WORKSPACE_PREFIX))
let firstApp
let secondApp
let firstOutput = () => ''
let secondOutput = () => ''
let router

try {
  await mkdir(userDataDirectory, { recursive: true })
  router = await startResponsesStub()
  const codexCommand = await resolveCodexCommand()
  await seedSettings({
    userDataDirectory,
    workspaceDirectory,
    baseUrl: router.baseUrl,
    codexCommand,
    codexHome: join(userDataDirectory, 'managed-codex-home')
  })
  phase(`using Codex app-server ${codexCommand}`)

  const first = await launchSourceElectron({
    source,
    userDataDirectory,
    processWorkingDirectory: temporaryDirectory,
    timeoutMs
  })
  firstApp = first.app
  firstOutput = first.output
  await requireCapabilities(first.window, workspaceDirectory)

  const thread = await rendererAgentCall(first.window, 'startThread', {
    runtimeId: RUNTIME_ID,
    workspace: workspaceDirectory,
    title: THREAD_TITLE,
    model: 'sciforge-router'
  })
  if (!thread?.id || thread.runtimeId !== RUNTIME_ID) {
    throw new Error(`Agent Runtime did not create a Codex thread: ${JSON.stringify(thread)}`)
  }
  phase(`real Agent Runtime thread created: ${thread.id}`)

  const before = checkpointValue(await invokeCapability(first.window, {
    workspaceDirectory,
    actionId: 'research-checkpoints.status',
    input: { runtimeId: RUNTIME_ID, threadId: thread.id }
  }), 'research-checkpoints.status')
  if (before.recordingMode !== 'automatic' || before.recording !== null) {
    throw new Error(`Automatic recording did not start at a clean boundary: ${JSON.stringify(before)}`)
  }

  const turn = await rendererAgentCall(first.window, 'startTurn', {
    runtimeId: RUNTIME_ID,
    threadId: thread.id,
    workspace: workspaceDirectory,
    model: 'sciforge-router',
    reasoningEffort: 'low',
    text: 'Return the deterministic research finding in one sentence.'
  })
  if (!turn?.turnId || turn.threadId !== thread.id) {
    throw new Error(`Agent Runtime did not start a real turn: ${JSON.stringify(turn)}`)
  }
  phase(`real Codex turn started: ${turn.turnId}`)

  const gatedResponse = await router.waitForTerminalGate(timeoutMs)
  phase(`Responses stub is holding terminal delivery for ${gatedResponse.responseId}`)
  await reloadSourceRenderer(first.window, source.expectedRendererUrl, timeoutMs)
  phase('renderer reloaded while the accepted turn was still non-terminal')
  if (await findDurableCompletionEventIfPresent(userDataDirectory, turn.turnId)) {
    throw new Error(`Turn ${turn.turnId} became terminal before the Responses gate was released.`)
  }
  router.releaseTerminal()

  const committed = await waitForCommittedTurn(first.window, {
    workspaceDirectory,
    threadId: thread.id,
    turnId: turn.turnId,
    timeoutMs
  })
  if (
    committed.ordinal !== 1 ||
    committed.changeKind !== 'new'
  ) {
    throw new Error(`Real Agent turn did not create an exact automatic v1: ${JSON.stringify(committed)}`)
  }

  const automatic = checkpointValue(await invokeCapability(first.window, {
    workspaceDirectory,
    actionId: 'research-checkpoints.status',
    input: { runtimeId: RUNTIME_ID, threadId: thread.id }
  }), 'research-checkpoints.status')
  if (
    automatic.recordingMode !== 'automatic' ||
    automatic.recording?.state !== 'active' ||
    automatic.recording.versionCount !== 1 ||
    automatic.recording.currentVersionId !== committed.artifactRef.versionId
  ) {
    throw new Error(`Default-on recording did not bind exact v1: ${JSON.stringify(automatic)}`)
  }

  const record = checkpointValue(await invokeCapability(first.window, {
    workspaceDirectory,
    actionId: 'research-checkpoints.read',
    input: { versionId: committed.artifactRef.versionId }
  }), 'research-checkpoints.read')
  const occurredAtMs = Date.parse(record.manifest.turn.occurredAt)
  if (
    record.manifest.turn.turnId !== turn.turnId ||
    !record.manifest.narrative.canonicalText.includes(RESPONSE_TEXT) ||
    !Number.isFinite(occurredAtMs)
  ) {
    throw new Error(`Research checkpoint lost its durable turn or narrative: ${JSON.stringify(record)}`)
  }

  const described = artifactValue(await invokeCapability(first.window, {
    workspaceDirectory,
    actionId: 'artifact-versions.describe-v2',
    input: { versionId: committed.artifactRef.versionId }
  }), 'artifact-versions.describe-v2')
  if (
    described.ref.versionId !== committed.artifactRef.versionId ||
    described.ref.contentDigest !== committed.artifactRef.contentDigest ||
    described.artifactOrdinal !== 1 ||
    described.isCurrent !== true
  ) {
    throw new Error(`Artifact Versions V2 describe lost the exact checkpoint: ${JSON.stringify(described)}`)
  }
  const history = artifactValue(await invokeCapability(first.window, {
    workspaceDirectory,
    actionId: 'artifact-versions.list-v2',
    input: { artifactId: committed.artifactRef.artifactId, limit: 10 }
  }), 'artifact-versions.list-v2')
  if (
    history.items.length !== 1 ||
    history.items[0]?.ref.versionId !== committed.artifactRef.versionId ||
    history.items[0]?.artifactOrdinal !== 1
  ) {
    throw new Error(`Artifact Versions V2 history was not exact: ${JSON.stringify(history)}`)
  }
  const firstRange = artifactValue(await invokeCapability(first.window, {
    workspaceDirectory,
    actionId: 'artifact-versions.content.read-range-v2',
    input: { versionId: committed.artifactRef.versionId, offset: 0, length: 64 }
  }), 'artifact-versions.content.read-range-v2')
  if (
    firstRange.ref.versionId !== committed.artifactRef.versionId ||
    firstRange.totalByteLength !== committed.artifactRef.byteLength ||
    firstRange.byteLength > 64
  ) {
    throw new Error(`Artifact Versions V2 ranged read was inconsistent: ${JSON.stringify(firstRange)}`)
  }
  phase('V2 exact describe, bounded history, and ranged content verified')

  await openCompactTimelineAndVerifyExact(first.window, {
    threadTitle: THREAD_TITLE,
    versionId: committed.artifactRef.versionId,
    expectedDigest: `sha256:${committed.artifactRef.contentDigest}`,
    timeoutMs
  })
  phase('compact chat entry opened the exact research dossier')
  await assertDigestMismatchFailsClosed(first.window, {
    threadId: thread.id,
    versionId: committed.artifactRef.versionId,
    timeoutMs
  })
  phase('wrong digest failed closed without resolving latest')

  await closeElectron(first.app)
  firstApp = undefined
  const durableEvent = await findDurableCompletionEvent(userDataDirectory, turn.turnId)
  if (durableEvent.event.createdAt !== durableEvent.createdAt) {
    throw new Error(`Durable completion envelope timestamp was not canonical: ${JSON.stringify(durableEvent)}`)
  }

  const second = await launchSourceElectron({
    source,
    userDataDirectory,
    processWorkingDirectory: temporaryDirectory,
    timeoutMs
  })
  secondApp = second.app
  secondOutput = second.output
  await requireCapabilities(second.window, workspaceDirectory)
  const persisted = checkpointValue(await invokeCapability(second.window, {
    workspaceDirectory,
    actionId: 'research-checkpoints.read',
    input: { versionId: committed.artifactRef.versionId }
  }), 'research-checkpoints.read')
  if (
    persisted.status.artifactRef.versionId !== committed.artifactRef.versionId ||
    persisted.status.artifactRef.contentDigest !== committed.artifactRef.contentDigest ||
    persisted.manifest.turn.occurredAt !== record.manifest.turn.occurredAt
  ) {
    throw new Error(`Exact v1 did not survive desktop restart: ${JSON.stringify(persisted)}`)
  }
  await openCompactTimelineAndVerifyExact(second.window, {
    threadTitle: THREAD_TITLE,
    versionId: committed.artifactRef.versionId,
    expectedDigest: `sha256:${committed.artifactRef.contentDigest}`,
    timeoutMs
  })
  phase('restart preserved the compact entry and exact artifact reference')

  const isolatedManagedCodexConfig = await readFile(
    join(temporaryDirectory, '.codex-runtime', 'codex-home', 'config.toml'),
    'utf8'
  )
  if (!isolatedManagedCodexConfig.includes(router.baseUrl)) {
    throw new Error('Codex app-server did not use the E2E-owned managed CODEX_HOME.')
  }

  console.log(JSON.stringify({
    ok: true,
    ingress: 'agentRuntime.startThread/startTurn',
    sourceElectron: true,
    smokeIngressDisabled: true,
    rendererReloadedBeforeTerminal: true,
    automaticRecordingVerified: true,
    artifactVersionsV2Verified: true,
    compactChatVerified: true,
    exactDossierVerified: true,
    noLatestFallbackVerified: true,
    restartPersistenceVerified: true,
    managedCodexHomeIsolated: true,
    threadId: thread.id,
    turnId: turn.turnId,
    recordingId: automatic.recording.recordingId,
    versionId: committed.artifactRef.versionId,
    digest: committed.artifactRef.contentDigest,
    routerRequests: router.requestCount()
  }, null, 2))
} catch (error) {
  const output = [firstOutput(), secondOutput()].filter(Boolean).join('\n--- Electron restart ---\n')
  const diagnostics = await collectFailureDiagnostics({
    userDataDirectory,
    workspaceDirectory
  }).catch((diagnosticError) => ({ diagnosticError: errorMessage(diagnosticError) }))
  console.error(
    `[electron-research-checkpoints-source-e2e] ${errorMessage(error)}` +
    `\nFailure diagnostics:\n${JSON.stringify(diagnostics, null, 2)}` +
    (output ? `\nRecent Electron output:\n${output}` : '')
  )
  process.exitCode = 1
} finally {
  await closeElectron(firstApp)
  await closeElectron(secondApp)
  await router?.close().catch(() => undefined)
  await removeWorkspaceDirectory(workspaceDirectory, workspaceParent)
  await removeTemporaryDirectory(temporaryDirectory)
}

async function startResponsesStub() {
  let requests = 0
  let releaseTerminalGate
  let reachTerminalGate
  let terminalReleased = false
  const terminalGate = new Promise((resolvePromise) => { releaseTerminalGate = resolvePromise })
  const terminalGateReached = new Promise((resolvePromise) => { reachTerminalGate = resolvePromise })
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method !== 'POST' || url.pathname !== '/v1/responses') {
        sendJson(response, 404, { error: { message: 'not found' } })
        return
      }
      if (request.headers.authorization !== `Bearer ${API_KEY}`) {
        sendJson(response, 401, { error: { message: 'unauthorized' } })
        return
      }
      const body = JSON.parse(await readBoundedBody(request))
      requests += 1
      const responseId = `resp_source_checkpoint_${requests}`
      const messageId = `msg_source_checkpoint_${requests}`
      const model = typeof body.model === 'string' ? body.model : 'sciforge-router'
      const usage = {
        input_tokens: 12,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 12,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 24
      }
      const message = {
        id: messageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: RESPONSE_TEXT, annotations: [] }]
      }
      const completed = {
        id: responseId,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model,
        status: 'completed',
        output: [message],
        output_text: RESPONSE_TEXT,
        usage
      }
      if (body.stream !== true) {
        sendJson(response, 200, completed)
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      writeSse(response, 'response.created', {
        type: 'response.created',
        response: { id: responseId, object: 'response', model, status: 'in_progress' }
      })
      writeSse(response, 'response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 0,
        item: { id: messageId, type: 'message', status: 'in_progress', role: 'assistant', content: [] }
      })
      writeSse(response, 'response.content_part.added', {
        type: 'response.content_part.added',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] }
      })
      writeSse(response, 'response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta: RESPONSE_TEXT
      })
      reachTerminalGate({ requestNumber: requests, responseId })
      await terminalGate
      writeSse(response, 'response.output_text.done', {
        type: 'response.output_text.done',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        text: RESPONSE_TEXT
      })
      writeSse(response, 'response.content_part.done', {
        type: 'response.content_part.done',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: RESPONSE_TEXT, annotations: [] }
      })
      writeSse(response, 'response.output_item.done', {
        type: 'response.output_item.done',
        output_index: 0,
        item: message
      })
      writeSse(response, 'response.completed', { type: 'response.completed', response: completed })
      response.write('data: [DONE]\n\n')
      response.end()
    } catch (error) {
      if (!response.headersSent) sendJson(response, 400, { error: { message: errorMessage(error) } })
      else response.destroy(error instanceof Error ? error : new Error(String(error)))
    }
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Responses stub did not bind a TCP port.')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    waitForTerminalGate: (timeout) => withTimeout(
      terminalGateReached,
      timeout,
      `Responses stub did not reach its terminal gate within ${timeout}ms.`
    ),
    releaseTerminal: () => {
      if (terminalReleased) return
      terminalReleased = true
      releaseTerminalGate()
    },
    close: async () => {
      if (!terminalReleased) {
        terminalReleased = true
        releaseTerminalGate()
      }
      server.closeAllConnections?.()
      await new Promise((resolvePromise) => server.close(resolvePromise))
    }
  }
}

async function seedSettings({ userDataDirectory, workspaceDirectory, baseUrl, codexCommand, codexHome }) {
  await writeFile(join(userDataDirectory, 'sciforge-settings.json'), JSON.stringify({
    version: 1,
    activeAgentRuntime: RUNTIME_ID,
    workspaceRoot: workspaceDirectory,
    modelAccess: { mode: 'api', planAdapterId: '' },
    modelRouter: {
      enabled: true,
      autoStart: false,
      baseUrl,
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: API_KEY,
      profiles: {
        default: {
          textReasoner: { baseUrl, apiKey: API_KEY, model: 'sciforge-router', protocol: 'responses' }
        }
      }
    },
    agents: {
      codex: {
        command: codexCommand,
        autoStart: true,
        codexHome,
        profile: '',
        model: '',
        modelProvider: '',
        approvalPolicy: 'never',
        sandboxMode: 'workspace-write',
        extraArgs: []
      }
    }
  }, null, 2), 'utf8')
}

async function resolveCodexCommand() {
  const candidates = [
    process.env.SCIFORGE_CODEX_COMMAND?.trim(),
    process.platform === 'darwin' ? '/Applications/ChatGPT.app/Contents/Resources/codex' : undefined
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      return resolve(candidate)
    } catch {
      // Continue to the next explicit or bundled candidate.
    }
  }
  return 'codex'
}

async function launchSourceElectron({ source, userDataDirectory, processWorkingDirectory, timeoutMs }) {
  const playwright = await import('playwright-core')
  const app = await playwright._electron.launch({
    executablePath: resolve(require('electron')),
    cwd: resolve(processWorkingDirectory),
    args: [resolve(source.applicationPath), `--user-data-dir=${userDataDirectory}`, '--hidden'],
    env: {
      ...process.env,
      SCIFORGE_DEV_BROWSER_BRIDGE: '0',
      SCIFORGE_ELECTRON_SMOKE: '0',
      SCIFORGE_STARTUP_TRACE: '1'
    },
    timeout: timeoutMs
  })
  const output = collectProcessOutput(app.process())
  try {
    const window = await app.firstWindow({ timeout: timeoutMs })
    await window.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
    await window.waitForFunction(
      () => document.readyState === 'complete' &&
        typeof globalThis.sciforge?.agentRuntime?.startTurn === 'function' &&
        typeof globalThis.sciforge?.capabilities?.invoke === 'function',
      undefined,
      { timeout: timeoutMs }
    )
    window.on('crash', () => phase('renderer crashed'))
    window.on('pageerror', (error) => phase(`renderer page error: ${errorMessage(error)}`))
    app.on('close', () => phase('Electron closed'))
    if (window.url() !== source.expectedRendererUrl) {
      throw new Error(`Source Electron loaded ${window.url()}; expected ${source.expectedRendererUrl}.`)
    }
    return { app, window, output }
  } catch (error) {
    await closeElectron(app)
    throw new Error(`${errorMessage(error)}${output() ? `\nElectron output:\n${output()}` : ''}`)
  }
}

async function reloadSourceRenderer(window, expectedRendererUrl, timeoutMs) {
  await window.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs })
  await window.waitForFunction(
    () => document.readyState === 'complete' &&
      typeof globalThis.sciforge?.agentRuntime?.listThreads === 'function' &&
      typeof globalThis.sciforge?.capabilities?.invoke === 'function',
    undefined,
    { timeout: timeoutMs }
  )
  if (window.url() !== expectedRendererUrl) {
    throw new Error(`Reloaded Electron renderer at ${window.url()}; expected ${expectedRendererUrl}.`)
  }
}

async function rendererAgentCall(window, method, input) {
  return window.evaluate(async ({ method, input, timeoutMs }) => new Promise((resolvePromise, reject) => {
    const operation = globalThis.sciforge.agentRuntime?.[method]
    if (typeof operation !== 'function') {
      reject(new Error(`Agent Runtime method ${method} is unavailable.`))
      return
    }
    const timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs}ms.`)), timeoutMs)
    void operation(input).then((value) => {
      clearTimeout(timer)
      resolvePromise(value)
    }, (error) => {
      clearTimeout(timer)
      reject(error)
    })
  }), { method, input, timeoutMs: 30_000 })
}

async function requireCapabilities(window, workspaceDirectory) {
  const result = await window.evaluate(({ expectedContractVersion, workspaceId, requiredCapabilityIds }) => (
    globalThis.sciforge.capabilities.readiness({
      workspaceId,
      expectedContractVersion,
      requiredCapabilityIds
    })
  ), {
    expectedContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
    workspaceId: workspaceDirectory,
    requiredCapabilityIds: REQUIRED_CAPABILITIES
  })
  if (result.status !== 'ready') throw new Error(`Required capabilities are not ready: ${result.message}`)
}

async function invokeCapability(window, { workspaceDirectory, actionId, input }) {
  return window.evaluate(async ({ workspaceDirectory, actionId, input }) => (
    globalThis.sciforge.capabilities.invoke({
      workspaceId: workspaceDirectory,
      request: { actionId, input }
    })
  ), { workspaceDirectory, actionId, input })
}

function checkpointValue(result, actionId) {
  if (!result || result.actionId !== actionId || !result.output?.ok) {
    throw new Error(`Capability ${actionId} failed: ${JSON.stringify(result)}`)
  }
  return result.output.value
}

function artifactValue(result, actionId) {
  if (!result || result.actionId !== actionId || !result.output?.ok) {
    throw new Error(`Capability ${actionId} failed: ${JSON.stringify(result)}`)
  }
  return result.output.value
}

async function waitForCommittedTurn(window, { workspaceDirectory, threadId, turnId, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let latest
  let recording
  while (Date.now() < deadline) {
    latest = checkpointValue(await invokeCapability(window, {
      workspaceDirectory,
      actionId: 'research-checkpoints.turn-status',
      input: { runtimeId: RUNTIME_ID, threadId, turnId }
    }), 'research-checkpoints.turn-status')
    recording = checkpointValue(await invokeCapability(window, {
      workspaceDirectory,
      actionId: 'research-checkpoints.status',
      input: { runtimeId: RUNTIME_ID, threadId }
    }), 'research-checkpoints.status')
    if (latest.state === 'committed') return latest
    if (latest.state === 'failed' || latest.state === 'stale-conflict') {
      throw new Error(`Checkpoint reached ${latest.state}: ${latest.error}`)
    }
    await delay(100)
  }
  const diagnostics = await window.evaluate(() => ({
    body: document.body.innerText.slice(0, 12_000),
    url: window.location.href
  })).catch(() => undefined)
  throw new Error(`Real Agent turn did not commit before timeout: ${JSON.stringify({ latest, recording, diagnostics })}`)
}

async function collectFailureDiagnostics({ userDataDirectory, workspaceDirectory }) {
  const roots = [
    ['researchCheckpoints', join(userDataDirectory, 'research-checkpoints')],
    ['turnArtifactOutbox', join(userDataDirectory, 'turn-artifact-outbox')],
    ['codexEvents', join(userDataDirectory, 'codex-runtime', 'events')],
    ['logs', join(userDataDirectory, 'logs')]
  ]
  const collected = { userDataDirectory, workspaceDirectory }
  for (const [key, root] of roots) collected[key] = await readDiagnosticTree(root)
  return collected
}

async function readDiagnosticTree(root) {
  const files = []
  await visit(root, '')
  return files

  async function visit(directory, relativeDirectory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= 80) return
      const relativePath = join(relativeDirectory, entry.name)
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      const bytes = await readFile(absolutePath)
      files.push({
        path: relativePath,
        byteLength: bytes.byteLength,
        text: bytes.subarray(0, 32 * 1024).toString('utf8')
      })
    }
  }
}

async function openCompactTimelineAndVerifyExact(window, { threadTitle, versionId, expectedDigest, timeoutMs }) {
  const uiTimeoutMs = Math.min(timeoutMs, 15_000)
  const threadButton = window.locator(`button[aria-label*="${threadTitle}"]`).first()
  try {
    await threadButton.waitFor({ state: 'visible', timeout: uiTimeoutMs })
    await threadButton.click({ timeout: uiTimeoutMs })
    const timeline = window.locator('.ds-message-timeline-content').first()
    await timeline.waitFor({ state: 'visible', timeout: uiTimeoutMs })
    const entry = timeline.locator(
      `[data-research-checkpoint-state="committed"]` +
      `[data-research-checkpoint-version-id="${versionId}"]`
    ).first()
    await entry.waitFor({ state: 'visible', timeout: uiTimeoutMs })
    const button = entry.getByRole('button', { name: /Open research dossier|打开科研档案/u, exact: true })
    await button.waitFor({ state: 'visible', timeout: uiTimeoutMs })
    if ((await entry.innerText()).trim().match(/^(?:Open research dossier|打开科研档案)$/u) === null) {
      throw new Error(`Compact entry exposed details: ${(await entry.innerText()).trim()}`)
    }
    if (await entry.locator('button').count() !== 1) throw new Error('Compact entry has more than one action.')
    if (await timeline.locator('[data-research-checkpoint-output-artifacts]').count() !== 0) {
      throw new Error('Chat timeline still exposes output artifacts.')
    }
    if (await timeline.locator('[data-research-checkpoint-untracked]').count() !== 0) {
      throw new Error('Chat timeline still exposes provenance detail.')
    }
    await button.click({ timeout: uiTimeoutMs })
    await waitForExactDossier(window, { versionId, expectedDigest, timeoutMs: uiTimeoutMs })
    const narrative = window.locator('[data-research-checkpoint-narrative]').first()
    await narrative.waitFor({ state: 'visible', timeout: uiTimeoutMs })
    if (!(await narrative.innerText()).includes(RESPONSE_TEXT)) {
      throw new Error('Exact research dossier omitted the immutable checkpoint narrative.')
    }
  } catch (error) {
    const diagnostic = await window.evaluate(() => ({
      body: document.body.innerText.slice(0, 12_000),
      entries: [...document.querySelectorAll('[data-research-checkpoint-state]')].map((element) => ({
        state: element.getAttribute('data-research-checkpoint-state'),
        versionId: element.getAttribute('data-research-checkpoint-version-id'),
        text: element.textContent?.slice(0, 2_000)
      }))
    })).catch(() => undefined)
    throw new Error(`Compact timeline/Dossier verification failed: ${JSON.stringify(diagnostic)}`, { cause: error })
  }
}

async function assertDigestMismatchFailsClosed(window, { threadId, versionId, timeoutMs }) {
  const wrongDigest = `sha256:${'0'.repeat(64)}`
  await dispatchDossierActivation(window, { threadId, versionId, expectedDigest: wrongDigest })
  await window.waitForFunction(
    () => (
      /does not match the expected digest|不匹配/u.test(document.body.innerText) &&
      document.querySelector('[data-research-checkpoint-narrative]') === null
    ),
    undefined,
    { timeout: Math.min(timeoutMs, 10_000) }
  )
}

async function waitForExactDossier(window, { versionId, expectedDigest, timeoutMs }) {
  await window.waitForFunction(
    ({ versionId, expectedDigest }) => (
      (document.body.textContent ?? '').includes(versionId) &&
      (document.body.textContent ?? '').includes(expectedDigest) &&
      !/does not match the expected digest|不匹配/u.test(document.body.innerText)
    ),
    { versionId, expectedDigest },
    { timeout: timeoutMs }
  )
}

async function dispatchDossierActivation(window, { threadId, versionId, expectedDigest }) {
  await window.evaluate(({ threadId, versionId, expectedDigest }) => {
    const contributionId = 'research-dossier.workbench-right-panel'
    window.dispatchEvent(new CustomEvent('sciforge:domain-workbench-open-right-panel', {
      detail: {
        contributionId,
        sessionId: threadId,
        activation: {
          contributionId,
          revision: Date.now(),
          payload: {
            contractVersion: 1,
            target: { kind: 'artifact-version', versionId },
            page: 'overview',
            expectedDigest
          }
        }
      }
    }))
  }, { threadId, versionId, expectedDigest })
}

async function findDurableCompletionEvent(userDataDirectory, turnId) {
  const event = await findDurableCompletionEventIfPresent(userDataDirectory, turnId)
  if (event) return event
  throw new Error(`No durable Codex completion envelope was found for ${turnId}.`)
}

async function findDurableCompletionEventIfPresent(userDataDirectory, turnId) {
  const eventsDirectory = join(userDataDirectory, 'codex-runtime', 'events')
  let files
  try {
    files = await readdir(eventsDirectory)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
  for (const file of files.filter((name) => name.endsWith('.jsonl'))) {
    const lines = (await readFile(join(eventsDirectory, file), 'utf8')).split('\n').filter(Boolean)
    for (const line of lines) {
      const record = JSON.parse(line)
      if (record.event?.turnId === turnId && record.event?.turnComplete === true) return record
    }
  }
  return undefined
}

function writeSse(response, event, data) {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(data))
}

async function readBoundedBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > 4 * 1024 * 1024) throw new Error('Responses request exceeded 4 MiB.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function collectProcessOutput(child) {
  let output = ''
  const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1_000_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return () => output.trim()
}

async function closeElectron(app) {
  if (!app) return
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), delay(5_000)])
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await delay(1_000)
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function removeTemporaryDirectory(path) {
  const resolved = resolve(path)
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith(TEMP_PREFIX)) {
    throw new Error(`Refusing to remove unsafe E2E directory: ${resolved}`)
  }
  await rm(resolved, { recursive: true, force: true })
}

async function removeWorkspaceDirectory(path, expectedParent) {
  const resolved = resolve(path)
  if (dirname(resolved) !== resolve(expectedParent) || !basename(resolved).startsWith(WORKSPACE_PREFIX)) {
    throw new Error(`Refusing to remove unsafe E2E workspace: ${resolved}`)
  }
  await rm(resolved, { recursive: true, force: true })
}

function parseOptions(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--repository-root', '--timeout-ms'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
    const value = argv[index + 1]?.trim()
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    index += 1
    if (flag === '--repository-root') parsed.repositoryRoot = resolve(value)
    else {
      const number = Number(value)
      if (!Number.isSafeInteger(number) || number < 10_000 || number > 300_000) {
        throw new Error('--timeout-ms must be between 10000 and 300000.')
      }
      parsed.timeoutMs = number
    }
  }
  return parsed
}

function withTimeout(promise, milliseconds, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })
  ]).finally(() => clearTimeout(timer))
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function phase(message) {
  console.error(`[electron-research-checkpoints-source-e2e] ${message}`)
}
