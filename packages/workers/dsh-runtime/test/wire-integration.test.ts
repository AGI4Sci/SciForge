import test from 'node:test'
import assert from 'node:assert/strict'
import { access, constants } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { type DshEvent, createDshRuntimeAdapter } from '../src/index.ts'

const accessAsync = promisify(access)

/**
 * Wire-level regression for the runtime safety patch, ported from the SciForge
 * runtime line (docs/research/dsh-runtime-feasibility-20261017.zh-CN.md §三,
 * §3.5): patch rows are silently ignored for unknown ids, so the model-visible
 * tool list must be asserted against the provider's own view by asking a real
 * model through a real dsh — never against the patch file or the composed
 * config alone.
 *
 * Gated: runs only when a real dsh executable and a real model credential are
 * both available; CI and normal `npm test` stay green without either.
 *
 *   - Executable resolution order:
 *       1. $DSH_WIRE_DSH_PATH (absolute, executable)
 *       2. the provisioned release artifact
 *          artifacts/0.2.0-rc.2/<platform>-<arch>/dsh[.exe] (canonical for
 *          release acceptance)
 *   - Credential: $DEEPSEEK_API_KEY (+ optional $DEEPSEEK_BASE_URL), taken
 *     from the environment only, never written anywhere.
 *
 * The reviewer below validates the probe executable's deployment metadata; it
 * is NOT the production policy — production composition must keep the compiled
 * pin + createPinnedDshDeployment from trusted-deployment.ts.
 */

const FORBIDDEN_BUILTIN_TOOLS = [
  /^bash$/i,
  /^pwsh$/i,
  /^fs_/i,
  /^fs$/i,
  /^read_file/i,
  /^write_file/i,
  /^edit_file/i,
  /^list_dir/i,
  /^web_search/i,
  /^web_fetch/i,
  /^subagent/i,
  /^exit_plan_mode$/i,
  /^list_mcp_resources/i,
  /^list_mcp_resource_templates/i,
  /^read_mcp_resource$/i,
  /^todo_write$/i
]

async function fileIsExecutable(path: string): Promise<boolean> {
  try {
    await accessAsync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveRealDsh(): Promise<string | null> {
  const envPath = process.env.DSH_WIRE_DSH_PATH?.trim()
  if (envPath && isAbsolute(envPath) && await fileIsExecutable(envPath)) return envPath
  const artifact = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', 'artifacts', '0.2.0-rc.2',
    `${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'dsh.exe' : 'dsh'
  )
  if (await fileIsExecutable(artifact)) return artifact
  return null
}

const executable = await resolveRealDsh()
const hasLlmKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim())
const skipReason = !executable
  ? 'real dsh executable unavailable (set DSH_WIRE_DSH_PATH or stage the release artifact)'
  : !hasLlmKey
    ? 'DEEPSEEK_API_KEY unavailable'
    : undefined

const context = { settings: {} }

test('exposes no built-in tools to the model under the safety patch (real dsh, real model)', { skip: skipReason, timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wire-integration-'))
  const events: DshEvent[] = []
  const controller = new AbortController()
  const adapter = createDshRuntimeAdapter({
    executable: executable!,
    stateDirectory: root,
    providerEnv: {
      ...(process.env.DEEPSEEK_API_KEY?.trim() ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY.trim() } : {}),
      ...(process.env.DEEPSEEK_BASE_URL?.trim() ? { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL.trim() } : {})
    },
    // Wire-test reviewer (not the production pin policy): refuse anything that
    // is not the audited 0.2.0-rc.2 composition shape.
    verifyDeployment: async (deployment) => {
      assert.equal(deployment.version, '0.2.0-rc.2', `unexpected dsh version: ${deployment.version}`)
      assert.equal(typeof deployment.configDigest, 'string')
      assert.ok(deployment.configDigest.length > 0)
    },
    requestTimeoutMs: 60_000,
    approvalTimeoutMs: 120_000
  })
  try {
    const collector = (async () => {
      for await (const event of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: 'wire-thread', signal: controller.signal })) {
        events.push(event)
      }
    })()
    const thread = await adapter.startThread(context, { runtimeId: 'dsh', workspace: root })
    const turn = await adapter.startTurn(context, {
      runtimeId: 'dsh',
      threadId: thread.id,
      text: 'Without calling any tool, list the exact names of every tool available to you, one per line. If you have no tools, reply with the single word NONE. Then stop.'
    })
    assert.equal(turn.identity.threadId, thread.id)

    const deadline = Date.now() + 150_000
    let replyText = ''
    while (Date.now() < deadline) {
      replyText = events
        .filter((event) => event.kind === 'assistant_delta')
        .map((event) => ('text' in event ? event.text : ''))
        .join('\n')
      const terminal = events.some((event) => event.kind === 'turn_lifecycle' && ['completed', 'failed', 'cancelled'].includes(String(event.state)))
      if (terminal && replyText.trim().length > 0) break
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }

    assert.ok(replyText.trim().length > 0, 'model returned an empty tool listing')
    const listedTools = replyText.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const name of listedTools) {
      if (name === 'NONE') continue
      for (const forbidden of FORBIDDEN_BUILTIN_TOOLS) {
        assert.doesNotMatch(name, forbidden, `built-in tool leaked to the model: ${name}`)
      }
    }
    controller.abort()
    await collector.catch(() => undefined)
  } finally {
    controller.abort()
    await adapter.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
