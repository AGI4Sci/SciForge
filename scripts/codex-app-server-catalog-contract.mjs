#!/usr/bin/env node
/**
 * Real end-to-end catalog contract probe (no paid calls).
 *
 * Chain under test: a REAL Model Router instance (this repo's code) →
 * a recording loopback proxy → the REAL codex app-server (`model/list`, the
 * exact path the SciForge host consumes) driven by the real Codex binary.
 *
 * Situations (what a connection can look like):
 *   1. catalog-empty-levels   router with no declaration → ROUTER payload
 *   2. catalog-declared       router with [high, low] declaration → ROUTER payload
 *   3. catalog-unknown-shape  a hypothetical upstream that publishes only an ID
 *
 * Asserts per situation: the app-server actually fetched /v1/models, it listed
 * the router alias without error, and the reasoning levels it reports back
 * match exactly what was declared (never invented, never expanded).
 *
 * Exit 1 on a must-hold assertion failure; exit 0 with SKIP when the codex
 * artifact is missing. Usage: node --import tsx scripts/…mjs
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexAppServerClient } from '../packages/workers/codex-runtime/src/app-server/json-rpc-client.ts'
import { startModelRouterServer } from '../packages/workers/model-router/src/router.ts'

const CODEX_BIN =
  process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'

if (!existsSync(CODEX_BIN)) {
  console.log(JSON.stringify({ ok: false, skipped: true, reason: `codex artifact missing at ${CODEX_BIN}` }))
  process.exit(0)
}

const RUNTIME_KEY = 'sk-mock-runtime'
const routerEnv = {
  SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY: RUNTIME_KEY,
  SCIFORGE_TEXT_API_KEY: 'text-secret',
  SCIFORGE_VISION_API_KEY: 'vision-secret'
}

/** Recording proxy: forwards to the router target and records every request. */
function startRecordingProxy() {
  const hits = []
  let target = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      hits.push(`${req.method} ${req.url}`)
      if (!target) {
        res.writeHead(503)
        res.end('{}')
        return
      }
      try {
        const upstream = await fetch(`${target}${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
        res.end(text)
      } catch (error) {
        res.writeHead(502)
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    })
  })
  return {
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    setTarget: (value) => {
      target = value
    },
    hits,
    reset: () => {
      hits.length = 0
    },
    close: () => server.close()
  }
}

async function startRouter(declaredLevels) {
  const config = {
    defaultProfile: 'default',
    publicModelAlias: 'sciforge-router',
    profiles: {
      default: {
        textReasoner: {
          baseUrl: 'https://text.example/v1',
          apiKeyEnv: 'SCIFORGE_TEXT_API_KEY',
          model: 'text-model',
          ...(declaredLevels
            ? { compatibility: { reasoningEfforts: declaredLevels } }
            : {})
        },
        translators: {
          vision: {
            baseUrl: 'https://vision.example/v1',
            apiKeyEnv: 'SCIFORGE_VISION_API_KEY',
            model: 'vision-model'
          }
        }
      }
    }
  }
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-router-catalog-'))
  return startModelRouterServer({ port: 0, config, env: routerEnv, workspaceRoot })
}

function cleanEnv(home) {
  const env = { ...process.env, CODEX_HOME: home, MOCK_KEY: RUNTIME_KEY }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete env[key]
  }
  env.NO_PROXY = '127.0.0.1,localhost'
  env.no_proxy = '127.0.0.1,localhost'
  return env
}

function writeHome(proxyPort, name) {
  const home = mkdtempSync(join(tmpdir(), `codex-appserver-${name}-`))
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
      `base_url = "http://127.0.0.1:${proxyPort}/v1"`,
      'env_key = "MOCK_KEY"',
      'wire_api = "responses"',
      `model_catalog_url = "http://127.0.0.1:${proxyPort}/v1/models"`,
      ''
    ].join('\n')
  )
  return home
}

const proxy = startRecordingProxy()
const proxyPort = await proxy.listen()

/** Minimal ID-only upstream: no capability fields at all (unknown). */
function startIdOnlyUpstream() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'sciforge-router', object: 'model' }], models: [{ id: 'sciforge-router', object: 'model' }] }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })
}

const results = []
async function probe(name, target, cleanup) {
  proxy.setTarget(target)
  proxy.reset()
  const home = writeHome(proxyPort, name)
  const client = createCodexAppServerClient({ command: CODEX_BIN, cwd: home, env: cleanEnv(home) })
  const result = { situation: name, modelsFetched: false, entryCount: null, entry: null, error: null }
  try {
    client.start()
    await client.initialize({})
    const page = await client.listModels({ limit: 100 })
    result.entryCount = page.data.length
    const entry = page.data.find((model) => model.model === 'sciforge-router' || model.id === 'sciforge-router')
    if (entry) {
      result.entry = {
        id: entry.id,
        model: entry.model,
        displayName: entry.displayName,
        supportedReasoningEfforts: entry.supportedReasoningEfforts,
        defaultReasoningEffort: entry.defaultReasoningEffort
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  } finally {
    try {
      await client.stop()
    } catch {
      // best effort
    }
    if (cleanup) await cleanup()
  }
  result.modelsFetched = proxy.hits.some((hit) => hit.includes('/models'))
  result.proxyHits = [...proxy.hits]
  results.push(result)
  return result
}

// 1. Router with no declaration (levels stay empty / null).
const routerEmpty = await startRouter(undefined)
await probe('catalog-empty-levels', routerEmpty.url, () => routerEmpty.close())

// 2. Router with a [high, low] declaration.
const routerDeclared = await startRouter(['high', 'low'])
await probe('catalog-declared', routerDeclared.url, () => routerDeclared.close())

// 3. A hypothetical upstream that publishes no capability fields.
const idOnly = await startIdOnlyUpstream()
await probe('catalog-unknown-shape', idOnly.url, async () => {
  idOnly.server.close()
})

proxy.close()
for (const result of results) console.log(JSON.stringify(result))

const failures = []
const byName = (name) => results.find((result) => result.situation === name)
for (const result of results) {
  if (result.error) failures.push(`${result.situation}: app-server error ${result.error}`)
  if (!result.modelsFetched) failures.push(`${result.situation}: app-server never fetched /v1/models`)
}
const empty = byName('catalog-empty-levels')
if (empty && !empty.entry) failures.push('catalog-empty-levels: router entry missing from decoded catalog')
if (empty?.entry && (empty.entry.supportedReasoningEfforts ?? []).length !== 0) {
  failures.push(`catalog-empty-levels: decoded ${JSON.stringify(empty.entry.supportedReasoningEfforts)}`)
}
const declared = byName('catalog-declared')
const declaredLevels = (declared?.entry?.supportedReasoningEfforts ?? [])
  .map((item) => item.reasoningEffort ?? item.effort ?? item.id ?? JSON.stringify(item))
  .sort()
if (declared && !declared.entry) failures.push('catalog-declared: router entry missing from decoded catalog')
if (declared?.entry && declaredLevels.join(',') !== 'high,low') {
  failures.push(`catalog-declared: decoded ${JSON.stringify(declared.entry.supportedReasoningEfforts)}`)
}
console.log(JSON.stringify({ contractFailures: failures }))
process.exit(failures.length > 0 ? 1 : 0)