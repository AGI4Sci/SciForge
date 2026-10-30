import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createCodexAppServerClient } from '@sciforge/codex-runtime/app-server'
import { probeCodexRuntime } from '../src/main/runtime/codex/codex-config'
import { CodexRuntimeService } from '../src/main/runtime/codex/codex-service'
import { startModelRouterServer } from '../packages/workers/model-router/src/router'
import * as defaults from '../src/shared/app-settings'
import type { AppSettingsV1 } from '../src/shared/app-settings'

// Run explicitly: node --import tsx scripts/codex-router-catalog-smoke.ts /path/to/codex
// All inference is simulated locally; no existing Codex home or credentials are used.
await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
const discovery = await probeCodexRuntime(process.argv[2] || 'codex')
assert(discovery.available && discovery.executablePath, 'A supported local Codex app-server is required')
const root = await mkdtemp(join(process.cwd(), '.tmp/codex-router-catalog-smoke-'))
const workspace = join(root, 'workspace')
const codexHome = join(root, 'codex-home')
await mkdir(workspace)
const upstream: Record<string, unknown>[] = []
const requests: string[] = []
const router = await startModelRouterServer({
  port: 0,
  workspaceRoot: workspace,
  env: { TEST_RUNTIME_KEY: 'diagnostic-runtime-only', TEST_UPSTREAM_KEY: 'diagnostic-upstream-only' },
  config: {
    defaultProfile: 'default', publicModelAlias: defaults.DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
    runtimeApiKeyEnv: 'TEST_RUNTIME_KEY',
    profiles: { default: { textReasoner: { baseUrl: 'http://127.0.0.1:9/v1', apiKeyEnv: 'TEST_UPSTREAM_KEY', model: 'local-test-model' }, translators: {} } }
  },
  fetchImpl: async (url, options) => {
    const body = options?.body ? JSON.parse(String(options.body)) : {}
    upstream.push({ fields: ['reasoning', 'reasoning_effort', 'thinking'].filter((key) => Object.hasOwn(body, key)), url: String(url), reasoning: body.reasoning ?? null, reasoning_effort: body.reasoning_effort ?? null, thinking: body.thinking ?? null })
    return Response.json({
      id: 'resp_local_test', object: 'response', status: 'completed', model: 'local-test-model',
      output: [{ id: 'msg_local', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
      output_text: 'ok', usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 }
    })
  }
})
router.server.on('request', (req) => {
  requests.push(`${req.method} ${req.url}`)
})
const modelRouter = defaults.defaultModelRouterSettings()
modelRouter.baseUrl = `${router.url}/v1`
modelRouter.runtimeApiKey = 'diagnostic-runtime-only'
modelRouter.profiles.default.textReasoner = { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'diagnostic-upstream-only', model: 'local-test-model' }
const settings: AppSettingsV1 = {
  version: 1, locale: 'en', theme: 'system', uiFontScale: 'small', activeAgentRuntime: 'codex',
  modelAccess: { mode: 'api', planAdapterId: '' },
  agents: { sciforge: defaults.defaultLocalRuntimeSettings(), codex: { ...defaults.defaultCodexRuntimeSettings(), reasoningEffort: 'medium', command: discovery.executablePath, codexHome, sandboxMode: 'danger-full-access', approvalPolicy: 'never', extraArgs: [] } },
  modelRouter, workspaceRoot: workspace, log: { enabled: false, retentionDays: 7 }, notifications: { turnComplete: false },
  appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false }, keyboardShortcuts: defaults.defaultKeyboardShortcuts(),
  write: defaults.defaultWriteSettings(), skills: defaults.defaultSkillsSettings(), schedule: defaults.defaultScheduleSettings(), workflow: defaults.defaultWorkflowSettings(), guiUpdate: { channel: 'stable' }, codePromptPrefix: ''
}

// The legacy runtime preference above must not become an automatic execution default.
let nativeClient: ReturnType<typeof createCodexAppServerClient> | undefined
let eventCollection: Promise<void> | undefined
const completed = new Map<string, string[]>()
const service = new CodexRuntimeService({
  settings: async () => settings,
  managedCodexHome: codexHome,
  storageRoot: join(root, 'runtime-storage'),
  probeRuntime: async () => discovery,
  createClient: (options) => {
    nativeClient = createCodexAppServerClient(options)
    const client = nativeClient
    eventCollection = (async () => {
      for await (const event of client.subscribe()) {
        if (event.type !== 'event') continue
        const notification = event.payload as { method?: string; params?: unknown }
        if (notification.method !== 'turn/completed') continue
        const params = notification.params as { threadId: string; turn: { status: string } }
        const turns = completed.get(params.threadId) ?? []
        turns.push(params.turn.status)
        completed.set(params.threadId, turns)
      }
    })()
    return nativeClient
  }
})
async function waitForTurn(threadId: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const status = completed.get(threadId)?.shift()
    if (status) {
      assert.equal(status, 'completed', 'Simulated turn must complete successfully')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for the isolated Codex turn')
}
let rejectedCode: string | undefined
try {
  const catalog = await service.modelCatalog()
  assert(catalog.available)
  const model = catalog.models.find(({ id }) => id === defaults.DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)
  assert(model, 'Router model must be recognized without auth.json')
  assert.deepEqual(model.reasoningEfforts, [])

  const ordinary = await service.startThread({ workspace, title: 'Ordinary catalog check' })
  assert(ordinary.ok, ordinary.ok ? undefined : ordinary.message)
  const turn = await service.startTurn({ threadId: ordinary.thread.id, text: 'Reply ok. Do not use tools.', workspace })
  assert(turn.ok, turn.ok ? undefined : turn.message)
  await waitForTurn(ordinary.thread.id)
  assert.deepEqual(upstream.at(-1)?.fields, [])

  const beforeRejected = upstream.length
  const rejected = await service.startTurn({ threadId: ordinary.thread.id, text: 'Must not reach upstream.', workspace, reasoningEffort: 'medium' })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) rejectedCode = rejected.code
  assert.equal(rejectedCode, 'unsupported_reasoning_effort')
  assert.equal(upstream.length, beforeRejected)

  // Same programmatic metadata used by the domain Agent execution Host for workers.
  const automatic = await service.startThread({ workspace, title: 'Automatic Worker catalog check', relation: 'side', threadSource: 'domain-runtime', sidebarVisibility: 'hidden' })
  assert(automatic.ok, automatic.ok ? undefined : automatic.message)
  const workerTurn = await service.startTurn({ threadId: automatic.thread.id, text: 'Reply ok. Do not use tools.', workspace })
  assert(workerTurn.ok, workerTurn.ok ? undefined : workerTurn.message)
  await waitForTurn(automatic.thread.id)
  assert.deepEqual(upstream.at(-1)?.fields, [])

  // Fixture only: seed the native state an older app could have persisted.
  // This intentionally uses the official native API, bypassing the NEW Host rejection.
  await nativeClient!.startTurn({ threadId: ordinary.thread.id, input: [{ type: 'text', text: 'Reply ok.', text_elements: [] }], effort: 'medium', cwd: workspace })
  await waitForTurn(ordinary.thread.id)
  assert.deepEqual(upstream.at(-1)?.reasoning, { effort: 'medium' })

  const cleared = await service.startTurn({ threadId: ordinary.thread.id, text: 'Reply ok without the old effort.', workspace })
  assert(cleared.ok, cleared.ok ? undefined : cleared.message)
  await waitForTurn(ordinary.thread.id)
  assert.deepEqual(upstream.at(-1)?.fields, [])
} finally {
  await service.stop()
  await eventCollection
  await router.close()
}
async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]))).flat()
}
const turnContexts: Array<{ model: string; effort: string | null }> = []
for (const path of (await files(join(codexHome, 'sessions'))).filter((path) => path.endsWith('.jsonl'))) {
  for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
    const record = JSON.parse(line)
    if (record.type === 'turn_context') turnContexts.push({ model: record.payload.model, effort: record.payload.effort ?? null })
  }
}
assert.equal(turnContexts.length, 4)
assert.equal(turnContexts.filter(({ effort }) => effort === null).length, 3)
assert.equal(turnContexts.filter(({ effort }) => effort === 'medium').length, 1)
assert.equal(await stat(join(codexHome, 'auth.json')).then(() => true, () => false), false)
assert.equal(await stat(join(codexHome, 'models_cache.json')).then(() => true, () => false), false)
const result = { root, version: discovery.version, authExists: false, cacheExists: false,
  ordinaryAndAutomaticAndClearedEfforts: turnContexts.filter(({ effort }) => effort === null),
  nativeLegacyFixture: turnContexts.filter(({ effort }) => effort !== null),
  rejectedCode, requestPaths: requests,
  upstreamParameterFields: upstream.map(({ fields }) => fields) }
await writeFile(join(root, 'summary.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
