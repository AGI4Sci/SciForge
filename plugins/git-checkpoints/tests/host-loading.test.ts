/**
 * Real host loading verification: the built dist/main.js is activated through
 * the actual ProcessExtensionHost + runner in an isolated child process, with
 * host-owned grants and config. Covers activate → register → invoke →
 * deactivate → dispose → process exit, fail-closed grant checks, argument
 * schema enforcement, idempotent teardown and stale-generation rejection.
 *
 * The child process inherits no environment (the runner spawns it with only
 * ELECTRON_RUN_AS_NODE), so the Git fixture relies on the system default
 * command lookup (`/usr/bin/git` on this platform).
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { ProcessExtensionHost } from '../../../packages/plugin-sdk/src/process-extension-host.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'
import { GIT_CHECKPOINTS_CAPABILITY_IDS } from '../src/contract.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []

const PACKAGE = { name: '@sciforge/plugin-git-checkpoints', version: '0.1.0' } as const
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

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

async function initGitWorkspace(): Promise<string> {
  const workspace = await tempRoot('dsh-workspace-')
  await execFileAsync('git', ['init', '-q'], { cwd: workspace })
  await execFileAsync('git', ['config', 'user.email', 'eval@sciforge.local'], { cwd: workspace })
  await execFileAsync('git', ['config', 'user.name', 'SciForge Evaluation'], { cwd: workspace })
  await writeFile(join(workspace, 'checkpoint.txt'), 'snapshot-state\n', 'utf8')
  await execFileAsync('git', ['add', 'checkpoint.txt'], { cwd: workspace })
  await execFileAsync('git', ['commit', '-qm', 'baseline'], { cwd: workspace })
  return workspace
}

test('activation fails closed when the host grants no tool', async () => {
  const host = new ProcessExtensionHost()
  try {
    await assert.rejects(
      host.replace({
        pluginId: 'git-checkpoints',
        packageName: PACKAGE.name,
        version: PACKAGE.version,
        entryPath: ENTRY_PATH,
        dshConfig: { dataDir: await tempRoot('dsh-data-') }
      }),
      /grant/i
    )
    assert.equal(host.runtime(PACKAGE.name), undefined)
  } finally {
    await host.disposeAll()
  }
})

test('full lifecycle through the real host: activate, invoke, dispose', async (t) => {
  if (process.platform === 'win32') {
    // The fixture relies on POSIX git lookup; the static module covers Windows.
    return t.skip('POSIX-only fixture')
  }
  const dataDir = await tempRoot('dsh-data-')
  const workspace = await initGitWorkspace()
  const authorizations: string[] = []
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
    resolveDshConfig: () => ({ dataDir }),
    authorizeDshTool: (request) => {
      authorizations.push(request.capabilityId)
    }
  })
  try {
    const snapshot = await host.replace({
      pluginId: 'git-checkpoints',
      packageName: PACKAGE.name,
      version: PACKAGE.version,
      entryPath: ENTRY_PATH,
      dshAgentResolver: { path: resolverPath }
    })
    assert.deepEqual(
      [...snapshot.capabilityIds].sort(),
      Object.values(GIT_CHECKPOINTS_CAPABILITY_IDS).sort()
    )
    const runtime = host.runtime(PACKAGE.name)
    assert.ok(runtime)

    const invoke = async (id: string, input: unknown): Promise<unknown> => {
      const result = await runtime.invoke(id, input, undefined, undefined, undefined, INVOCATION) as { output: unknown }
      return result.output
    }

    const created = await invoke(GIT_CHECKPOINTS_CAPABILITY_IDS.create, {
      runtimeId: 'test-runtime',
      threadId: 'thread-1',
      workspaceRoot: workspace
    }) as { ok: boolean; value?: { checkpointId: string; status: string } }
    assert.equal(created.ok, true)
    const checkpointId = created.value!.checkpointId

    const listed = await invoke(GIT_CHECKPOINTS_CAPABILITY_IDS.list, {
      workspaceRoot: workspace
    }) as { ok: boolean; value?: readonly { checkpointId: string }[] }
    assert.equal(listed.ok, true)
    assert.equal(listed.value!.length, 1)

    // Change the tracked file, then restore the checkpoint through the plugin.
    await writeFile(join(workspace, 'checkpoint.txt'), 'working-tree-state\n', 'utf8')
    const restored = await invoke(GIT_CHECKPOINTS_CAPABILITY_IDS.restore, {
      checkpointId,
      workspaceRoot: workspace
    }) as { ok: boolean; value?: { status: string; rescueCheckpointId: string } }
    assert.equal(restored.ok, true)
    assert.equal(restored.value!.status, 'restored')
    assert.match(restored.value!.rescueCheckpointId, /^rescue_/u)
    assert.equal(await readFile(join(workspace, 'checkpoint.txt'), 'utf8'), 'snapshot-state\n')

    const preview = await invoke(GIT_CHECKPOINTS_CAPABILITY_IDS.preview, {
      checkpointId,
      workspaceRoot: workspace
    }) as { ok: boolean; value?: { truncated: boolean } }
    assert.equal(preview.ok, true)

    // Every invoke required and received host authorization with the envelope.
    assert.deepEqual(
      authorizations.sort(),
      [
        GIT_CHECKPOINTS_CAPABILITY_IDS.create,
        GIT_CHECKPOINTS_CAPABILITY_IDS.list,
        GIT_CHECKPOINTS_CAPABILITY_IDS.preview,
        GIT_CHECKPOINTS_CAPABILITY_IDS.restore
      ].sort()
    )

    // Input schema is enforced through the whole chain.
    await assert.rejects(
      invoke(GIT_CHECKPOINTS_CAPABILITY_IDS.create, { runtimeId: 1, workspaceRoot: workspace }),
      /invalid|expected|string/i
    )

    // Idempotent teardown and stale-generation rejection.
    await runtime.dispose()
    await runtime.dispose()
    await assert.rejects(
      invoke(GIT_CHECKPOINTS_CAPABILITY_IDS.list, { workspaceRoot: workspace }),
      /disposed|stale|inactive/i
    )
  } finally {
    await host.disposeAll()
  }
  assert.equal(host.runtime(PACKAGE.name), undefined)
})
