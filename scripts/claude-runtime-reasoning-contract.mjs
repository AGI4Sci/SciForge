#!/usr/bin/env node
/**
 * Real Claude Code final-request-body probe (no paid calls — loopback mock).
 *
 * Runs the REAL Claude Code CLI (the binary shipped inside
 * @anthropic-ai/claude-agent-sdk-darwin-arm64, spawned by the real
 * @anthropic-ai/claude-agent-sdk) against a loopback Anthropic-API mock and
 * captures the FINAL /v1/messages request body for each reasoning mapping from
 * this repo's own `claudeCodeReasoningOptions`:
 *   A. no selection      → body must NOT carry a `thinking` field
 *   B. `off`             → body must carry thinking.type === 'disabled'
 *   C. `high`            → observation: what the adapter sends (thinking/effort)
 *   D. unsupported token → our mapper must refuse BEFORE any request is made
 *
 * Exit 1 on a must-hold assertion failure; exit 0 with SKIP when the artifact
 * or SDK is missing. Usage: node --import tsx scripts/…mjs
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeCodeReasoningOptions } from '../src/main/runtime/claude-code/claude-code-config.ts'

const CLI_BIN = new URL(
  '../node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
  import.meta.url
).pathname

if (!existsSync(CLI_BIN)) {
  console.log(JSON.stringify({ ok: false, skipped: true, reason: `claude artifact missing at ${CLI_BIN}` }))
  process.exit(0)
}

const captures = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    captures.push({ method: req.method, url: req.url, body })
    if (req.url?.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ input_tokens: 1 }))
      return
    }
    if (req.method === 'POST' && req.url?.includes('/v1/messages')) {
      const frame = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(
        frame({
          type: 'message_start',
          message: {
            id: 'msg_mock_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-mock',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 }
          }
        }) +
          frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
          frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
          frame({ type: 'content_block_stop', index: 0 }) +
          frame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }) +
          frame({ type: 'message_stop' })
      )
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

function cleanEnv() {
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_API_KEY: 'sk-ant-mock',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1'
  }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete env[key]
  }
  env.NO_PROXY = '127.0.0.1,localhost'
  env.no_proxy = '127.0.0.1,localhost'
  return env
}

const results = []

async function runVariant(name, reasoningEffort) {
  captures.length = 0
  let reasoningOptions
  try {
    reasoningOptions = claudeCodeReasoningOptions(reasoningEffort)
  } catch (error) {
    results.push({
      variant: name,
      mapperRefused: true,
      message: error instanceof Error ? error.message : String(error),
      requestsMade: captures.length
    })
    return
  }
  const result = { variant: name, mapperOptions: reasoningOptions, error: null, requestBody: null }
  try {
    const iterable = query({
      prompt: 'say hi',
      options: {
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        env: cleanEnv(),
        pathToClaudeCodeExecutable: CLI_BIN,
        ...reasoningOptions
      }
    })
    const timeout = setTimeout(() => iterable.interrupt?.(), 90_000)
    try {
      for await (const message of iterable) {
        if (message.type === 'result') break
      }
    } finally {
      clearTimeout(timeout)
    }
    const request = captures.find((capture) => capture.method === 'POST' && capture.url?.includes('/v1/messages'))
    if (request) {
      const parsed = JSON.parse(request.body)
      result.requestBody = {
        keys: Object.keys(parsed),
        thinking: parsed.thinking ?? null,
        effort: parsed.effort ?? null,
        model: parsed.model ?? null
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  results.push(result)
}

await runVariant('no-selection', undefined)
await runVariant('off', 'off')
await runVariant('high', 'high')
await runVariant('unsupported-token', 'turbo-9000')

server.close()
for (const result of results) console.log(JSON.stringify(result))

const failures = []
const byName = (name) => results.find((result) => result.variant === name)
const none = byName('no-selection')
if (none?.error) failures.push(`no-selection: ${none.error}`)
// Must-hold: with no selection our mapper adds nothing, and nothing we send
// disables thinking. The Claude Code CLI applies its own model default
// (observed: thinking enabled with a fixed budget) — that is the runtime's
// own default, not a value this host fabricated; it is recorded per-run above.
if (none?.mapperOptions && Object.keys(none.mapperOptions).length > 0) {
  failures.push(`no-selection: mapper produced ${JSON.stringify(none.mapperOptions)}`)
}
if (none?.requestBody?.thinking?.type === 'disabled') {
  failures.push('no-selection: wire unexpectedly disabled thinking')
}
const off = byName('off')
if (off?.error) failures.push(`off: ${off.error}`)
if (off?.requestBody && off.requestBody.thinking?.type !== 'disabled') {
  failures.push(`off: thinking=${JSON.stringify(off.requestBody?.thinking)}`)
}
const refused = byName('unsupported-token')
if (!refused?.mapperRefused) failures.push('unsupported-token: mapper did not refuse')
if (refused && refused.requestsMade > 0) failures.push('unsupported-token: a request was made before refusal')
// An explicit level must visibly reach the wire (display summarization from
// our mapping) — observation-grade, but it must at least not be dropped.
const high = byName('high')
if (high?.error) failures.push(`high: ${high.error}`)
if (high?.requestBody && high.requestBody.thinking?.display !== 'summarized') {
  failures.push(`high: thinking=${JSON.stringify(high.requestBody?.thinking)}`)
}
console.log(JSON.stringify({ contractFailures: failures }))
process.exit(failures.length > 0 ? 1 : 0)