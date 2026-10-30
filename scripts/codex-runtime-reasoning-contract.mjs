#!/usr/bin/env node
/**
 * Real-codex wire contract probe (no paid calls — mock upstream on loopback).
 *
 * Spawns the real Codex CLI (default: the ChatGPT.app-bundled binary) against
 * an in-process mock upstream and captures the exact final request bodies for:
 *   A. no reasoning configured        → the wire must carry NO reasoning field
 *   B. `model_reasoning_effort=high`  → the wire must carry reasoning effort high
 *   C. `model_reasoning_effort=off`   → observation only (off transport fidelity)
 *
 * Prints one JSON line per variant to stdout. Exit 1 if a must-hold assertion
 * fails; exit 0 with "SKIP" line when the codex artifact is missing.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CODEX_BIN =
  process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'

if (!existsSync(CODEX_BIN)) {
  console.log(JSON.stringify({ ok: false, skipped: true, reason: `codex artifact missing at ${CODEX_BIN}` }))
  process.exit(0)
}

const captures = []
let modelsQueried = false
// Mirrors the exact /v1/models payload shape the real Model Router publishes
// for the public alias; variants swap reasoning/context fields to model each
// catalog situation (declared-empty / unknown / declared list).
const ROUTER_MODEL_ENTRY = (overrides = {}) => ({
  slug: 'sciforge-router',
  display_name: 'sciforge-router',
  description: 'SciForge Model Router public alias',
  default_reasoning_level: null,
  supported_reasoning_levels: [],
  shell_type: 'shell_command',
  visibility: 'list',
  supported_in_api: true,
  priority: 1,
  additional_speed_tiers: [],
  service_tiers: [],
  default_service_tier: null,
  supports_reasoning_summary_parameter: false,
  support_verbosity: false,
  apply_patch_tool_type: 'freeform',
  supports_parallel_tool_calls: false,
  truncation_policy: { mode: 'tokens', limit: 128000 },
  supports_image_detail_original: false,
  context_window: 128000,
  max_context_window: 128000,
  auto_compact_token_limit: 100000,
  effective_context_window_percent: 95,
  experimental_supported_tools: [],
  input_modalities: ['text', 'image'],
  supports_search_tool: false,
  use_responses_lite: false,
  id: 'sciforge-router',
  object: 'model',
  owned_by: 'sciforge',
  ...overrides
})
const DEFAULT_MODELS_PAYLOAD = {
  object: 'list',
  data: [{ id: 'sciforge-router', object: 'model' }],
  models: [{ id: 'sciforge-router', object: 'model' }]
}
let modelsPayload = DEFAULT_MODELS_PAYLOAD
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    captures.push({ method: req.method, url: req.url, body })
    if (req.method === 'GET' && req.url?.includes('/models')) {
      modelsQueried = true
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(modelsPayload))
      return
    }
    const id = 'resp_mock_1'
    const item = {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        id: 'msg_mock_1',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok', annotations: [] }]
      }
    }
    const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      frame({ type: 'response.created', response: { id, status: 'in_progress', output: [] } }) +
        frame(item) +
        frame({
          type: 'response.completed',
          response: {
            id,
            status: 'completed',
            output: [item.item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
          }
        })
    )
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

function runCodex(home, extraArgs) {
  return new Promise((resolve) => {
    const env = { ...process.env, CODEX_HOME: home, MOCK_KEY: 'sk-mock' }
    // Loopback must bypass any system proxy (a local proxy answers 502 otherwise).
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      delete env[key]
    }
    env.NO_PROXY = '127.0.0.1,localhost'
    env.no_proxy = '127.0.0.1,localhost'
    const child = spawn(
      CODEX_BIN,
      ['exec', '--skip-git-repo-check', '-C', home, ...extraArgs, 'say hi'],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderrTail: stderr.slice(-400) })
    })
  })
}

function writeHome(name) {
  const home = mkdtempSync(join(tmpdir(), `codex-${name}-`))
  writeFileSync(
    join(home, 'config.toml'),
    [
      'model = "sciforge-router"',
      'model_provider = "mock"',
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      '',
      '[model_providers.mock]',
      'name = "mock"',
      `base_url = "http://127.0.0.1:${port}/v1"`,
      'env_key = "MOCK_KEY"',
      'wire_api = "responses"',
      ''
    ].join('\n')
  )
  return home
}

const results = []
async function variant(name, extraArgs, mustHaveReasoning, models) {
  const home = writeHome(name)
  captures.length = 0
  modelsQueried = false
  modelsPayload = models
    ? { object: 'list', data: [models], models: [models] }
    : DEFAULT_MODELS_PAYLOAD
  const run = await runCodex(home, extraArgs)
  const post = captures.find((entry) => entry.method === 'POST')
  let parsed = null
  try {
    parsed = post ? JSON.parse(post.body) : null
  } catch {
    parsed = null
  }
  const reasoning = parsed?.reasoning ?? null
  results.push({
    variant: name,
    exitCode: run.code,
    model: parsed?.model ?? null,
    hasReasoningField: Boolean(parsed && 'reasoning' in parsed),
    reasoning,
    modelsRequested: modelsQueried,
    stderrTail: run.code === 0 ? undefined : run.stderrTail
  })
  return { parsed, reasoning }
}

await variant('no-effort', [], false)
await variant('effort-high', ['-c', 'model_reasoning_effort="high"'], true)
await variant('effort-off', ['-c', 'model_reasoning_effort="off"'], null)
// Catalog situations — the mock serves exactly what the router publishes:
await variant('catalog-empty-levels', [], null, ROUTER_MODEL_ENTRY())
await variant('catalog-unknown-shape', [], null, { id: 'sciforge-router', object: 'model' })
await variant(
  'catalog-declared-levels',
  ['-c', 'model_reasoning_effort="high"'],
  null,
  ROUTER_MODEL_ENTRY({
    supported_reasoning_levels: [
      { effort: 'high', description: 'Declared reasoning effort for this connection' },
      { effort: 'low', description: 'Declared reasoning effort for this connection' }
    ]
  })
)

for (const result of results) console.log(JSON.stringify(result))
server.close()

// Observed on the real wire: codex always adds its own `reasoning.summary`
// (not an effort). The contract that matters is about `reasoning.effort`.
const noEffort = results.find((r) => r.variant === 'no-effort')
const high = results.find((r) => r.variant === 'effort-high')
const failures = []
if (noEffort && noEffort.model !== 'sciforge-router') {
  failures.push(`no-effort variant model=${JSON.stringify(noEffort.model)}`)
}
if (noEffort && noEffort.reasoning && 'effort' in noEffort.reasoning) {
  failures.push(`no-effort variant carried reasoning.effort=${JSON.stringify(noEffort.reasoning.effort)}`)
}
if (high && high.reasoning?.effort !== 'high') {
  failures.push(`effort-high variant sent reasoning.effort=${JSON.stringify(high.reasoning?.effort)}`)
}

// Catalog situations: a declared-EMPTY level list and an entry without any
// capability fields (unknown) must both keep reasoning.effort off the wire —
// no invented defaults; a declared list transmits the explicit level exactly.
const catalogEmpty = results.find((r) => r.variant === 'catalog-empty-levels')
const catalogUnknown = results.find((r) => r.variant === 'catalog-unknown-shape')
const catalogDeclared = results.find((r) => r.variant === 'catalog-declared-levels')
if (catalogEmpty && catalogEmpty.exitCode !== 0) {
  failures.push(`catalog-empty-levels exit=${catalogEmpty.exitCode}`)
}
if (catalogEmpty?.reasoning && 'effort' in catalogEmpty.reasoning) {
  failures.push(`catalog-empty-levels carried effort=${JSON.stringify(catalogEmpty.reasoning.effort)}`)
}
if (catalogUnknown && catalogUnknown.exitCode !== 0) {
  failures.push(`catalog-unknown-shape exit=${catalogUnknown.exitCode}`)
}
if (catalogUnknown?.reasoning && 'effort' in catalogUnknown.reasoning) {
  failures.push(`catalog-unknown-shape carried effort=${JSON.stringify(catalogUnknown.reasoning.effort)}`)
}
if (catalogDeclared && catalogDeclared.exitCode !== 0) {
  failures.push(`catalog-declared-levels exit=${catalogDeclared.exitCode}`)
}
if (catalogDeclared && catalogDeclared.reasoning?.effort !== 'high') {
  failures.push(`catalog-declared-levels effort=${JSON.stringify(catalogDeclared.reasoning?.effort)}`)
}
console.log(JSON.stringify({ contractFailures: failures }))
process.exit(failures.length > 0 ? 1 : 0)