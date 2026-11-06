import { fileURLToPath } from 'node:url'
/**
 * Real host loading: the built `dist/main.js` is activated through the actual
 * `ProcessExtensionHost` + runner in an isolated child process, invoked through
 * the DSH tool surface, and disposed twice.
 *
 * This is the strongest claim the plugin's own suite makes. It is not a claim
 * that the plugin can be installed beside the built-in capability ids, and it
 * is not a claim about `DevelopmentExternalPluginService` projection (see
 * `tests/hotplug-*.test.ts`, where G7 is now fixed and the same ids register).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { HostServiceProviderRegistry, type HostServiceRequest } from '@sciforge/plugin-sdk'
import { VISUAL_CLIENT, unavailableVisualProvider } from './harness.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from '../../../packages/plugin-sdk/src/process-extension-host.js'
import packageJson from '../package.json' with { type: 'json' }
import { ANCHORED_COMMENT_CAPABILITY_IDS } from '../src/core/contract.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'
import { feedbackPacket, PNG_BYTES, productFeedbackThread, researchThread } from './fixtures.js'

const roots: string[] = []

const PACKAGE = { name: packageJson.name, version: packageJson.version } as const
const ENTRY_PATH = fileURLToPath(new URL('../dist/main.js', import.meta.url))

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), prefix))
  roots.push(path)
  return path
}

test('activation fails closed when the host grants no tool', async () => {
  const host = new ProcessExtensionHost({ resolveServiceClients: () => [VISUAL_CLIENT] })
  try {
    await assert.rejects(
      host.replace({
        pluginId: 'anchored-comments',
        packageName: PACKAGE.name,
        version: PACKAGE.version,
        entryPath: ENTRY_PATH
      }),
      /grant/i
    )
    assert.equal(host.runtime(PACKAGE.name), undefined)
  } finally {
    await host.disposeAll()
  }
})

test('full lifecycle through the real host, including workspace-explicit calls', { timeout: 120_000 }, async () => {
  const authorizations: string[] = []
  const workspaceRoot = await tempRoot('anchored-workspace-')
  const resolverDir = await tempRoot('anchored-resolver-')
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
  const serviceCalls: HostServiceRequest[] = []
  const caller = { audience: 'agent', callerId: 'host-loading-fixture', workspaceId: workspaceRoot }
  const ordinarySession = { runtimeId: 'test-runtime', threadId: 'thread-1', sessionId: 'session-1' }
  let leaseActive = true
  const hostServices = {
    authority: { caller, ordinarySession }, services: ['visualCapture'],
    assertCurrent() { assert.ok(leaseActive, 'fixture Host lease is inactive') }
  }
  const host = new ProcessExtensionHost({
    resolveServiceClients: () => [VISUAL_CLIENT],
    hostServices: new HostServiceProviderRegistry({ visualCapture: unavailableVisualProvider(serviceCalls, (request) => {
      assert.equal(request.owner.packageName, PACKAGE.name)
      assert.equal(request.owner.version, PACKAGE.version)
      assert.ok(['listTargets', 'captureRegisteredTarget'].includes(request.operation))
    }) }),
    resolveDshToolGrants: () => EXPECTED_HOST_GRANTS,
    resolveDshConfig: () => ({}),
    authorizeDshTool: (request) => {
      authorizations.push(request.capabilityId)
    }
  })
  try {
    const snapshot = await host.replace({
      pluginId: 'anchored-comments',
      packageName: PACKAGE.name,
      version: PACKAGE.version,
      entryPath: ENTRY_PATH,
      dshAgentResolver: { path: resolverPath }
    })
    assert.deepEqual(
      [...snapshot.capabilityIds].sort(),
      Object.values(ANCHORED_COMMENT_CAPABILITY_IDS).sort()
    )
    const runtime = host.runtime(PACKAGE.name)
    assert.ok(runtime)

    const invoke = async (id: string, input: unknown): Promise<unknown> => {
      const result = await runtime.invoke(id, input, undefined, undefined, undefined, undefined, hostServices) as {
        output: unknown
      }
      return result.output
    }

    const empty = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, { workspaceRoot }) as {
      threads: unknown[]
    }
    assert.deepEqual(empty, { threads: [] })

    // Seed one content-addressed screenshot so `asset.read` runs against real
    // bytes instead of a fixture stub.
    const digest = createHash('sha256').update(PNG_BYTES).digest('hex')
    const asset = {
      digest,
      mimeType: 'image/png' as const,
      byteLength: PNG_BYTES.byteLength,
      width: 2,
      height: 2
    }
    await mkdir(join(workspaceRoot, '.sciforge', 'anchored-comments', 'assets'), { recursive: true })
    await writeFile(
      join(workspaceRoot, '.sciforge', 'anchored-comments', 'assets', `${digest}.png`),
      PNG_BYTES
    )
    const base = researchThread('thread-host-1')
    const { unavailableReason: _unavailableReason, ...captureBundle } = base.capture
    const thread = { ...base, capture: { ...captureBundle, focusedScreenshot: asset } }
    assert.deepEqual(
      await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread, workspaceRoot }),
      thread
    )
    assert.deepEqual(
      await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, { asset, workspaceRoot }),
      {
        digest,
        mimeType: 'image/png',
        byteLength: PNG_BYTES.byteLength,
        width: 2,
        height: 2,
        integrityVerified: true,
        dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`
      }
    )
    assert.deepEqual(
      await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id, workspaceRoot }),
      { thread }
    )

    assert.deepEqual(await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.capture, {
      action: 'enumerate', workspaceRoot
    }), { targets: [] })
    const captureThread = researchThread('thread-capture')
    await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread: captureThread, workspaceRoot })
    const capture = await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.capture, {
      threadId: captureThread.id,
      targetRef: 'preview.figure:figure-2',
      targetBounds: { x: 10, y: 20, width: 120, height: 80 },
      targetLabel: 'Figure 2',
      viewport: { width: 1000, height: 800, scaleFactor: 2 },
      workspaceRoot
    }) as { ok: boolean; message?: string }
    assert.equal(capture.ok, false)
    assert.match(capture.message ?? '', /No authorized task view/)
    assert.deepEqual(serviceCalls.map((request) => request.operation), ['listTargets', 'captureRegisteredTarget'])
    assert.deepEqual((await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: captureThread.id, workspaceRoot })), { thread: captureThread })
    await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.delete, { threadId: captureThread.id, workspaceRoot })
    await assert.rejects(invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, { workspaceRoot: join(workspaceRoot, '..', 'foreign') }), /authenticated caller workspace/)
    await assert.rejects(runtime.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, { workspaceRoot }), /workspace-scoped caller/)
    leaseActive = false
    await assert.rejects(invoke(ANCHORED_COMMENT_CAPABILITY_IDS.capture, { action: 'enumerate', workspaceRoot }), /inactive|stale/)
    leaseActive = true

    await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, {
      thread: productFeedbackThread(),
      workspaceRoot
    })
    assert.deepEqual(
      await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus, {
        threadId: 'thread-feedback',
        workspaceRoot
      }),
      { ok: true, feedback: { state: 'local' } }
    )
    assert.deepEqual(
      await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback, {
        packet: feedbackPacket(),
        workspaceRoot
      }),
      { ok: false, message: 'SciForge feedback gateway is not configured.', retryable: false }
    )

    // The store is workspace-local, not plugin-private.
    const stored = JSON.parse(
      await readFile(join(workspaceRoot, '.sciforge', 'anchored-comments', 'comments.json'), 'utf8')
    ) as { threads: Array<{ id: string }> }
    assert.deepEqual(stored.threads.map((item) => item.id).sort(), ['thread-feedback', 'thread-host-1'])

    assert.deepEqual(
      await invoke(ANCHORED_COMMENT_CAPABILITY_IDS.delete, {
        threadId: 'thread-host-1',
        workspaceRoot
      }),
      { deleted: true }
    )

    assert.deepEqual(
      [...new Set(authorizations)].sort(),
      Object.values(ANCHORED_COMMENT_CAPABILITY_IDS).sort()
    )

    await runtime.dispose()
    await runtime.dispose()
    await assert.rejects(
      invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, { workspaceRoot }),
      /disposed|stale|inactive/i
    )
  } finally {
    await host.disposeAll()
  }
  assert.equal(host.runtime(PACKAGE.name), undefined)
})