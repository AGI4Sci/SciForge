/**
 * Real host loading verification: the built dist/main.js is activated through
 * the actual ProcessExtensionHost + runner in an isolated child process, with
 * host-owned grants and a fixture config carrying the durable data directory
 * and recorded sessions. Covers activate → register → invoke (start → status
 * → stop → status) → dispose → process exit, fail-closed grant checks,
 * argument schema enforcement and idempotent teardown. The commit path needs
 * the host capability bridge (plugins/GAPS.md, G1) and is therefore covered
 * by the in-process parity tests instead.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from '../../../packages/plugin-sdk/src/process-extension-host.js'
import { RESEARCH_CHECKPOINT_CAPABILITY_IDS } from '../src/contract.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'

const roots: string[] = []

const PACKAGE = { name: '@sciforge/plugin-research-checkpoints', version: '0.1.0' } as const
const ENTRY_PATH = new URL('../dist/main.js', import.meta.url).pathname

const INVOCATION = Object.freeze({
  caller: {},
  ordinarySession: Object.freeze({
    runtimeId: 'test-runtime',
    threadId: 'thread-1',
    sessionId: 'session-1'
  }),
  context: {}
})

const WORKSPACE = '/workspace/host-loading'

const FIXTURE_SESSIONS = Object.freeze({
  'thread-1': {
    id: 'thread-1',
    runtimeId: 'test-runtime',
    workspaceRoot: WORKSPACE,
    watermark: 'wm-host-1',
    turns: [],
    artifacts: []
  }
})

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

test('activation fails closed when the host grants no tool', async () => {
  const host = new ProcessExtensionHost()
  const dataDir = await tempRoot('rc-data-')
  try {
    await assert.rejects(
      host.replace({
        pluginId: 'research-checkpoints',
        packageName: PACKAGE.name,
        version: PACKAGE.version,
        entryPath: ENTRY_PATH,
        dshConfig: { dataDir, sessions: {} }
      }),
      /grant/i
    )
    assert.equal(host.runtime(PACKAGE.name), undefined)
  } finally {
    await host.disposeAll()
  }
})

test('full lifecycle through the real host: activate, invoke, dispose', async () => {
  const authorizations: string[] = []
  const dataDir = await tempRoot('rc-data-')
  const resolverDir = await tempRoot('dsh-resolver-')
  const resolverPath = join(resolverDir, 'agent-resolver.mjs')
  await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`)
  const host = new ProcessExtensionHost({
    resolveDshToolGrants: () => EXPECTED_HOST_GRANTS,
    resolveDshConfig: () => ({ dataDir, sessions: FIXTURE_SESSIONS }),
    authorizeDshTool: (request) => {
      authorizations.push(request.capabilityId)
    }
  })
  try {
    const snapshot = await host.replace({
      pluginId: 'research-checkpoints',
      packageName: PACKAGE.name,
      version: PACKAGE.version,
      entryPath: ENTRY_PATH,
      dshAgentResolver: { path: resolverPath }
    })
    assert.deepEqual(
      [...snapshot.capabilityIds].sort(),
      Object.values(RESEARCH_CHECKPOINT_CAPABILITY_IDS).sort()
    )
    const runtime = host.runtime(PACKAGE.name)
    assert.ok(runtime)

    const invoke = async (id: string, input: unknown): Promise<unknown> => {
      const result = await runtime.invoke(id, input, undefined, undefined, undefined, INVOCATION) as { output: unknown }
      return result.output
    }

    const started = await invoke(RESEARCH_CHECKPOINT_CAPABILITY_IDS.start, {
      runtimeId: 'test-runtime',
      threadId: 'thread-1',
      expectedPolicyRevision: 0,
      idempotencyKey: 'host-loading-start-1',
      workspaceRoot: WORKSPACE
    }) as { ok: boolean; value: { created: boolean; policyRevision: number; recording: { state: string } } }
    assert.equal(started.ok, true)
    assert.equal(started.value.created, true)
    assert.equal(started.value.recording.state, 'active')

    const status = await invoke(RESEARCH_CHECKPOINT_CAPABILITY_IDS.status, {
      runtimeId: 'test-runtime',
      threadId: 'thread-1',
      workspaceRoot: WORKSPACE
    }) as { ok: boolean; value: { recordingMode: string; policyRevision: number; recording: { state: string } } }
    assert.equal(status.ok, true)
    assert.equal(status.value.recordingMode, 'automatic')
    assert.equal(status.value.recording.state, 'active')

    const stopped = await invoke(RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop, {
      runtimeId: 'test-runtime',
      threadId: 'thread-1',
      expectedPolicyRevision: status.value.policyRevision,
      idempotencyKey: 'host-loading-stop-1',
      workspaceRoot: WORKSPACE
    }) as { ok: boolean; value: { recording: { state: string } } }
    assert.equal(stopped.ok, true)
    assert.equal(stopped.value.recording.state, 'stopped')

    // Every invocation required and received host authorization with the envelope.
    assert.deepEqual(authorizations.sort(), [
      RESEARCH_CHECKPOINT_CAPABILITY_IDS.start,
      RESEARCH_CHECKPOINT_CAPABILITY_IDS.status,
      RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop
    ].sort())

    // Input schema is enforced at the runner's argument boundary before the
    // invocation reaches the plugin.
    await assert.rejects(
      invoke(RESEARCH_CHECKPOINT_CAPABILITY_IDS.start, {
        runtimeId: 'test-runtime',
        threadId: 'thread-1',
        expectedPolicyRevision: 'zero',
        idempotencyKey: 'host-loading-start-2',
        workspaceRoot: WORKSPACE
      }),
      /invalid|integer|expected/i
    )

    // Idempotent teardown and stale-generation rejection.
    await runtime.dispose()
    await runtime.dispose()
    await assert.rejects(
      invoke(RESEARCH_CHECKPOINT_CAPABILITY_IDS.status, {
        runtimeId: 'test-runtime',
        threadId: 'thread-1',
        workspaceRoot: WORKSPACE
      }),
      /disposed|stale|inactive/i
    )
  } finally {
    await host.disposeAll()
  }
  assert.equal(host.runtime(PACKAGE.name), undefined)
})
