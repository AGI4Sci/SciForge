/**
 * Real host loading verification — and the G4 evidence for this group: the
 * built dist/main.js (which inlines the TypeScript engine and keeps the
 * native @napi-rs/canvas addon external) is activated through the actual
 * ProcessExtensionHost + runner in an isolated child process. The test drives
 * status and map_data against the real engine and finishes with a real
 * degraded-mode render, proving the native canvas addon and the Python
 * matplotlib renderer both work inside the isolated runner process. Until the
 * host capability bridge exists (G1), renders stay unversioned with the
 * engine's own warning — the static package's published fallback contract.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from '../../../packages/plugin-sdk/src/process-extension-host.js'
import { SCIENTIFIC_PLOTTING_CAPABILITY_IDS } from '../src/contract.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'

const roots: string[] = []

const PACKAGE = { name: '@sciforge/plugin-scientific-plotting', version: '0.1.0' } as const
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

const CONTROLLED_PLAN = Object.freeze({
  planId: 'plan-host-loading-1',
  route: 'code',
  routeLocked: true,
  rationale: 'host-loading',
  sourceArtifacts: [],
  reproducibleInputs: ['inline-data'],
  lockedElements: ['all'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'draft_ready',
  fallbackPolicy: 'fail_closed'
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
        pluginId: 'scientific-plotting',
        packageName: PACKAGE.name,
        version: PACKAGE.version,
        entryPath: ENTRY_PATH,
        dshConfig: {}
      }),
      /grant/i
    )
    assert.equal(host.runtime(PACKAGE.name), undefined)
  } finally {
    await host.disposeAll()
  }
})

test('full lifecycle through the real host, including a native degraded render', {
  timeout: 180_000
}, async () => {
  const authorizations: string[] = []
  const workspaceRoot = await tempRoot('plotting-workspace-')
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
    pluginRuntimeEnv: Object.fromEntries(['HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'SCIFORGE_PYTHON', 'PYTHONDONTWRITEBYTECODE'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])),
    resolveDshToolGrants: () => EXPECTED_HOST_GRANTS,
    resolveDshConfig: () => ({}),
    authorizeDshTool: (request) => {
      authorizations.push(request.capabilityId)
    }
  })
  try {
    const snapshot = await host.replace({
      pluginId: 'scientific-plotting',
      packageName: PACKAGE.name,
      version: PACKAGE.version,
      entryPath: ENTRY_PATH,
      dshAgentResolver: { path: resolverPath }
    })
    assert.deepEqual(
      [...snapshot.capabilityIds].sort(),
      Object.values(SCIENTIFIC_PLOTTING_CAPABILITY_IDS).sort()
    )
    const runtime = host.runtime(PACKAGE.name)
    assert.ok(runtime)

    const invoke = async (id: string, input: unknown): Promise<unknown> => {
      const result = await runtime.invoke(id, input, undefined, undefined, undefined, INVOCATION) as { output: unknown }
      return result.output
    }

    const status = await invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status, {}) as {
      ok: boolean
      serverName: string
      supportedTemplates: readonly string[]
      degraded: boolean
    }
    assert.equal(status.ok, true)
    assert.equal(status.serverName, 'scientific_plotting')
    assert.ok(status.supportedTemplates.includes('scatter'))

    const mapped = await invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData, {
      operationId: 'host-loading-map-001',
      task: 'Host-loading mapping',
      visualPlan: CONTROLLED_PLAN,
      data: { series: [{ name: 'S1', x: [1, 2, 3], y: [2, 4, 9] }] },
      templateHint: 'scatter',
      workspaceRoot
    }) as { ok: boolean; status: string; selectedTemplate?: string }
    assert.equal(mapped.ok, true)
    assert.equal(mapped.status, 'mapped')
    assert.equal(mapped.selectedTemplate, 'scatter')

    // G4: a real degraded-mode render inside the isolated runner process —
    // the native @napi-rs/canvas addon loads and matplotlib produces a PNG.
    const rendered = await invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render, {
      operationId: 'host-loading-render-1',
      visualPlan: CONTROLLED_PLAN,
      data: { series: [{ name: 'S1', x: [1, 2, 3], y: [2, 4, 9] }] },
      template: 'scatter',
      workspaceRoot
    }) as { ok: boolean; status: string; warnings?: readonly string[] }
    assert.equal(rendered.ok, true, JSON.stringify(rendered))
    assert.equal(rendered.status, 'rendered')
    assert.ok(
      rendered.warnings?.some((warning) => warning.includes('unversioned')),
      `expected the degraded-mode unversioned warning, got ${JSON.stringify(rendered.warnings)}`
    )
    const figures = await readdir(join(workspaceRoot, '.sciforge', 'figures'), {
      recursive: true
    })
    assert.ok(
      figures.some((entry) => String(entry).endsWith('.png')),
      `expected a rendered PNG under the workspace, got ${JSON.stringify(figures)}`
    )

    // rerun/compare fail closed with the engine's own capability error (G1),
    // surfaced through the engine's result contract rather than a throw.
    const ref = {
      artifactId: 'artifact:m',
      versionId: 'artifact-version:m',
      contentDigest: 'a'.repeat(64),
      byteLength: 1,
      mediaType: 'application/json',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
    }
    const rerun = await invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun, {
      operationId: 'host-loading-rerun-01',
      baselineFigureVersionRef: ref,
      recipeVersionRef: ref,
      expectedCurrentVersionId: 'artifact-version:m',
      workspaceRoot
    }) as { ok: boolean; status: string; message: string }
    assert.equal(rerun.ok, false)
    assert.match(rerun.message, /Artifact Versions read and commit capabilities/u)

    // Every invocation required and received host authorization with the envelope.
    assert.deepEqual(authorizations.sort(), [
      SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status,
      SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
      SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
      SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun
    ].sort())

    // Idempotent teardown and stale-generation rejection.
    await runtime.dispose()
    await runtime.dispose()
    await assert.rejects(
      invoke(SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status, {}),
      /disposed|stale|inactive/i
    )
  } finally {
    await host.disposeAll()
  }
  assert.equal(host.runtime(PACKAGE.name), undefined)
})
