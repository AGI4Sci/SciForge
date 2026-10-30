/**
 * Real host loading verification: the built dist/main.js is activated through
 * the actual ProcessExtensionHost + runner in an isolated child process, with
 * host-owned grants and a fixture config carrying a recorded session. Covers
 * activate → register → invoke → dispose → process exit, fail-closed grant
 * checks, argument schema enforcement, idempotent teardown and stale-
 * generation rejection.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from '../../../packages/plugin-sdk/src/process-extension-host.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'

const roots: string[] = []

const PACKAGE = { name: '@sciforge/plugin-change-inspector', version: '0.1.0' } as const
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

const WORKSPACE = '/repo'

/** A recorded session exercising JSON-nested diff extraction end to end. */
const FIXTURE_SESSIONS = Object.freeze({
  'thread-1': {
    workspaceRoot: WORKSPACE,
    watermark: 'wm-host-1',
    artifacts: [
      {
        kind: 'tool',
        toolKind: 'file_change',
        id: 'host-art-1',
        status: 'success',
        createdAt: '2026-07-28T10:00:00+08:00',
        detail: JSON.stringify({
          changes: [{ path: 'src/host.ts', diff: '--- a/src/host.ts\n+++ b/src/host.ts\n@@ -1 +1 @@\n-a\n+b' }]
        })
      }
    ]
  },
  'thread-foreign': {
    workspaceRoot: '/elsewhere',
    watermark: 'wm-host-2',
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
  try {
    await assert.rejects(
      host.replace({
        pluginId: 'change-inspector',
        packageName: PACKAGE.name,
        version: PACKAGE.version,
        entryPath: ENTRY_PATH,
        dshConfig: { sessions: {} }
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
    resolveDshConfig: () => ({ sessions: FIXTURE_SESSIONS, threads: [{ id: 'thread-1', runtimeId: 'test-runtime' }, { id: 'thread-foreign', runtimeId: 'test-runtime' }] }),
    authorizeDshTool: (request) => {
      authorizations.push(request.capabilityId)
    }
  })
  try {
    const snapshot = await host.replace({
      pluginId: 'change-inspector',
      packageName: PACKAGE.name,
      version: PACKAGE.version,
      entryPath: ENTRY_PATH,
      dshAgentResolver: { path: resolverPath }
    })
    assert.deepEqual(
      [...snapshot.capabilityIds].sort(),
      Object.values(CHANGE_INSPECTOR_CAPABILITY_IDS).sort()
    )
    const runtime = host.runtime(PACKAGE.name)
    assert.ok(runtime)

    const invoke = async (id: string, input: unknown): Promise<unknown> => {
      const result = await runtime.invoke(id, input, undefined, undefined, undefined, INVOCATION) as { output: unknown }
      return result.output
    }

    const opened = await invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {
      sessionId: 'thread-1',
      runtimeId: 'test-runtime',
      workspaceRoot: WORKSPACE
    }) as {
      sessionId: string
      resourceId: string
      snapshot: {
        revision: string
        changes: readonly { id: string; filePath?: string; patch: string; occurredAt?: string }[]
        truncated: boolean
      }
    }
    assert.equal(opened.sessionId, 'thread-1')
    assert.match(opened.resourceId, /^session-changes:[a-f0-9]{64}$/u)
    assert.equal(opened.snapshot.revision, 'wm-host-1')
    assert.equal(opened.snapshot.truncated, false)
    assert.deepEqual(opened.snapshot.changes, [{
      id: 'host-art-1',
      status: 'success',
      filePath: 'src/host.ts',
      patch: '--- a/src/host.ts\n+++ b/src/host.ts\n@@ -1 +1 @@\n-a\n+b',
      occurredAt: '2026-07-28T02:00:00.000Z'
    }])

    const listed = await invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges, { sessionId: 'thread-1', workspaceRoot: WORKSPACE }) as { changes: { id: string }[]; revision: string }
    assert.equal(listed.revision, 'wm-host-1')
    assert.equal(listed.changes[0]?.id, 'host-art-1')

    // Cross-workspace reads are rejected through the whole chain.
    await assert.rejects(
      invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {
        sessionId: 'thread-foreign',
        runtimeId: 'test-runtime',
        workspaceRoot: WORKSPACE
      }),
      /belongs to another workspace/u
    )

    // Unknown sessions surface the fixture port error.
    await assert.rejects(
      invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {
        sessionId: 'missing',
        runtimeId: 'test-runtime',
        workspaceRoot: WORKSPACE
      }),
      /no session 'missing'/u
    )

    // The invocation required and received host authorization with the envelope.
    assert.deepEqual(authorizations.sort(), [
      CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges,
      CHANGE_INSPECTOR_CAPABILITY_IDS.openSession,
      CHANGE_INSPECTOR_CAPABILITY_IDS.openSession,
      CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
    ].sort())

    // Input schema is enforced through the whole chain.
    await assert.rejects(
      invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {
        sessionId: 1,
        runtimeId: 'test-runtime',
        workspaceRoot: WORKSPACE
      }),
      /invalid|expected|string/i
    )

    // Idempotent teardown and stale-generation rejection.
    await runtime.dispose()
    await runtime.dispose()
    await assert.rejects(
      invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {
        sessionId: 'thread-1',
        runtimeId: 'test-runtime',
        workspaceRoot: WORKSPACE
      }),
      /disposed|stale|inactive/i
    )
  } finally {
    await host.disposeAll()
  }
  assert.equal(host.runtime(PACKAGE.name), undefined)
})
