/**
 * Workspace-preview contribution channel tests (gap-1b reference
 * implementation): declaration schema governance, runner round trips over a
 * real child process, the three-layer negatives, and an end-to-end
 * prepareArtifact byte transport.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, describe, type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'

import { ProcessExtensionHost } from './process-extension-host.js'
import { pluginAdapterDeclarationSchema } from './manifest.js'
import {
  workspacePreviewSlotWireSchema,
  decodeWorkspacePreviewWireResult,
  encodeWorkspacePreviewWireResult,
  WORKSPACE_PREVIEW_MAX_WIRE_BYTES
} from './workspace-preview-channel.js'

const runnerPath = fileURLToPath(new URL('./process-extension-runner.mjs', import.meta.url))

const manifest = {
  contractVersion: 1,
  id: 'probe-slot',
  displayName: 'Probe Slot',
  version: '1.0.0',
  modality: 'unknown',
  lifecycle: 'worker',
  priority: 500,
  extensions: ['.probe'],
  mimeTypes: [],
  capabilities: { preview: true, edit: false, inspect: true, structuredSelection: false }
}

describe('workspace-preview adapter declaration schema', () => {
  test('accepts kind workspace-preview with declared preview slots', () => {
    const parsed = pluginAdapterDeclarationSchema.parse({
      schemaVersion: 1,
      kind: 'workspace-preview',
      namespace: 'probe',
      hostApiRange: '^1.0.0',
      permissions: [],
      reloadPolicy: 'live',
      previewSlots: [{ slotId: 'probe-slot', artifactKinds: ['thumbnail'] }]
    })
    assert.equal(parsed.previewSlots?.length, 1)
    assert.equal(parsed.previewSlots?.[0]?.slotId, 'probe-slot')
  })

  test('rejects workspace-preview adapters without slots and slots on other kinds', () => {
    assert.equal(pluginAdapterDeclarationSchema.safeParse({
      schemaVersion: 1, kind: 'workspace-preview', namespace: 'probe', hostApiRange: '^1.0.0',
      permissions: [], reloadPolicy: 'live'
    }).success, false)
    assert.equal(pluginAdapterDeclarationSchema.safeParse({
      schemaVersion: 1, kind: 'capability', namespace: 'probe', hostApiRange: '^1.0.0',
      permissions: [], reloadPolicy: 'live',
      previewSlots: [{ slotId: 'probe-slot', artifactKinds: ['thumbnail'] }]
    }).success, false)
  })

  test('rejects undeclared artifact kinds and unknown slot shapes', () => {
    const base = {
      schemaVersion: 1, kind: 'workspace-preview', namespace: 'probe', hostApiRange: '^1.0.0',
      permissions: [], reloadPolicy: 'live'
    }
    assert.equal(pluginAdapterDeclarationSchema.safeParse({
      ...base, previewSlots: [{ slotId: 'probe-slot', artifactKinds: ['pixel-data'] }]
    }).success, false)
    assert.equal(pluginAdapterDeclarationSchema.safeParse({
      ...base, previewSlots: [{ slotId: '', artifactKinds: [] }]
    }).success, false)
  })

  test('wire codecs round-trip artifact bytes as base64 and cap oversized payloads', () => {
    const encoded = encodeWorkspacePreviewWireResult('prepareArtifact', {
      ok: true, kind: 'thumbnail', mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 250]),
      thumbnail: { width: 1, height: 1 }, bytesRead: 4, truncated: false
    })
    assert.equal(encoded.ok, true)
    if (!encoded.ok) return
    assert.equal('bytes' in (encoded.result as Record<string, unknown>), false)
    const decoded = decodeWorkspacePreviewWireResult('prepareArtifact', encoded.result) as { bytes: Uint8Array }
    assert.deepEqual([...decoded.bytes], [1, 2, 3, 250])
    const oversized = encodeWorkspacePreviewWireResult('prepareArtifact', {
      ok: true, kind: 'thumbnail', mimeType: 'image/png',
      bytes: new Uint8Array(WORKSPACE_PREVIEW_MAX_WIRE_BYTES + 1),
      thumbnail: { width: 1, height: 1 }, bytesRead: 1, truncated: false
    })
    assert.equal(oversized.ok, false)
    if (oversized.ok) return
    assert.equal(oversized.error.code, 'artifact_too_large')
  })

  test('slot wire schema parses a full manifest and rejects drift', () => {
    assert.equal(workspacePreviewSlotWireSchema.safeParse({
      slotId: 'probe-slot', artifactKinds: ['thumbnail'], manifest
    }).success, true)
    assert.equal(workspacePreviewSlotWireSchema.safeParse({
      slotId: 'probe-slot', artifactKinds: ['thumbnail'], manifest: { ...manifest, capabilities: { preview: 'yes' } }
    }).success, false)
  })
})

const previewEntry = `
const manifest = ${JSON.stringify(manifest)}
export function getWorkspacePreviewProviders() {
  return [{
    slotId: 'probe-slot',
    artifactKinds: ['thumbnail'],
    manifest,
    provider: {
      observe: async (input) => ({
        ok: true,
        bytesRead: 1,
        truncated: false,
        observation: {
          schemaVersion: 1,
          file: { path: input.file.path, workspaceRoot: input.file.workspaceRoot },
          view: { pluginId: 'probe-slot', modality: 'unknown', mode: input.session.mode, title: 'probe' },
          actions: ['observe']
        },
        echo: { workspaceRoot: input.file.workspaceRoot, slotSeen: input.manifest.id }
      }),
      prepareArtifact: async (input) => ({
        ok: true,
        kind: input.request.kind,
        mimeType: 'image/png',
        bytes: new Uint8Array([137, 80, 78, 71, 13]),
        thumbnail: { width: input.request.width, height: input.request.height },
        bytesRead: 5,
        truncated: false
      }),
      applyEdit: async () => null
    }
  }]
}
`

async function spawnPreviewRunner(t: TestContext, source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-preview-runner-'))
  const entryPath = join(directory, 'main.mjs')
  await writeFile(entryPath, source)
  const child = spawn(process.execPath, [runnerPath, entryPath, '1'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ELECTRON_RUN_AS_NODE: '1' }
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
      child.kill('SIGKILL')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  })
  await once(child, 'message', { signal: AbortSignal.timeout(5000) })
  return child
}

function request(child: ChildProcess, command: string, payload: unknown): Promise<{
  ok: boolean
  result?: unknown
  error?: { message?: string; code?: string }
}> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage)
      reject(new Error(`Runner ${command} request timed out.`))
    }, 8000)
    function onMessage(message: unknown) {
      const response = message as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: { message?: string; code?: string } }
      if (response.type !== 'response' || response.requestId !== requestId) return
      clearTimeout(timer)
      child.off('message', onMessage)
      resolve({ ok: response.ok === true, result: response.result, error: response.error })
    }
    child.on('message', onMessage)
    child.send({ type: 'request', requestId, command, payload })
  })
}

function previewPayload(method: string, input: unknown, workspaceRoot = '/ws/target') {
  return {
    protocol: 'sciforge-preview.v1',
    requestId: randomUUID(),
    slotId: 'probe-slot',
    method,
    workspaceRoot,
    input
  }
}

const observationInput = {
  session: { id: 's1', pluginId: 'probe-slot', workspaceRoot: '/ws/target', path: '/ws/target/a.probe', modality: 'unknown', mode: 'preview', openedAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' },
  manifest,
  file: { workspaceRoot: '/ws/target', path: '/ws/target/a.probe' }
}

describe('runner workspace-preview channel (real child process)', () => {
  test('round-trips observe, prepares artifact bytes as base64, and passes applyEdit null', async (t) => {
    const child = await spawnPreviewRunner(t, previewEntry)
    const activated = await request(child, 'activate', { packageName: 'probe-plugin' })
    assert.equal(activated.ok, true)

    const slots = await request(child, 'preview-slots', undefined)
    assert.equal(slots.ok, true)
    assert.deepEqual((slots.result as Array<{ slotId: string }>).map((slot) => slot.slotId), ['probe-slot'])

    const observed = await request(child, 'preview', previewPayload('observe', observationInput))
    assert.equal(observed.ok, true)
    assert.deepEqual((observed.result as { echo: unknown }).echo, { workspaceRoot: '/ws/target', slotSeen: 'probe-slot' })

    const artifact = await request(child, 'preview', previewPayload('prepareArtifact', {
      ...observationInput,
      request: { kind: 'thumbnail', width: 4, height: 4 }
    }))
    assert.equal(artifact.ok, true)
    const decoded = decodeWorkspacePreviewWireResult('prepareArtifact', artifact.result) as { bytes: Uint8Array; kind: string }
    assert.equal(decoded.kind, 'thumbnail')
    assert.deepEqual([...decoded.bytes], [137, 80, 78, 71, 13])

    const edit = await request(child, 'preview', previewPayload('applyEdit', { ...observationInput, now: '2026-10-17T00:00:00.000Z', operation: { kind: 'workspace.setSelection', path: '/ws/target/a.probe', selection: { kind: 'text', ranges: [] } } }))
    assert.equal(edit.ok, true)
    assert.equal(edit.result, null)
  })

  test('rejects workspace mismatches and missing render targets child-side', async (t) => {
    const child = await spawnPreviewRunner(t, previewEntry)
    assert.equal((await request(child, 'activate', { packageName: 'probe-plugin' })).ok, true)

    const mismatched = await request(child, 'preview', previewPayload('observe', observationInput, '/ws/other'))
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error?.code, 'workspace_mismatch')

    const missing = await request(child, 'preview', { ...previewPayload('observe', observationInput), workspaceRoot: '' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error?.code, 'workspace_required')
  })

  test('rejects unknown slots, unsupported methods, and non-lossless provider results', async (t) => {
    const child = await spawnPreviewRunner(t, previewEntry)
    assert.equal((await request(child, 'activate', { packageName: 'probe-plugin' })).ok, true)

    const unknownSlot = await request(child, 'preview', { ...previewPayload('observe', observationInput), slotId: 'nope' })
    assert.equal(unknownSlot.ok, false)
    assert.equal(unknownSlot.error?.code, 'unsupported_slot')

    const badMethod = await request(child, 'preview', { ...previewPayload('observe', observationInput), method: 'renderVisual' })
    assert.equal(badMethod.ok, false)
    assert.equal(badMethod.error?.code, 'unsupported_method')

    const lossyEntry = previewEntry.replace(
      'observe: async (input) => ({',
      'observe: async (input) => ({ fn: () => 1,'
    )
    const lossyChild = await spawnPreviewRunner(t, lossyEntry)
    assert.equal((await request(lossyChild, 'activate', { packageName: 'probe-plugin' })).ok, true)
    const lossy = await request(lossyChild, 'preview', previewPayload('observe', observationInput))
    assert.equal(lossy.ok, false)
    assert.equal(lossy.error?.code, 'invalid_result')
  })

  test('rejects artifact payloads over the wire byte cap', async (t) => {
    const bigEntry = previewEntry.replace(
      'bytes: new Uint8Array([137, 80, 78, 71, 13]),',
      `bytes: new Uint8Array(${WORKSPACE_PREVIEW_MAX_WIRE_BYTES} + 1),`
    )
    const child = await spawnPreviewRunner(t, bigEntry)
    assert.equal((await request(child, 'activate', { packageName: 'probe-plugin' })).ok, true)
    const artifact = await request(child, 'preview', previewPayload('prepareArtifact', {
      ...observationInput,
      request: { kind: 'thumbnail', width: 4, height: 4 }
    }))
    assert.equal(artifact.ok, false)
    assert.equal(artifact.error?.code, 'artifact_too_large')
  })

  test('fences preview admission during deactivation', async (t) => {
    const blockedEntry = `
const manifest = ${JSON.stringify(manifest)}
export function getWorkspacePreviewProviders() {
  return [{
    slotId: 'probe-slot',
    artifactKinds: ['thumbnail'],
    manifest,
    provider: {
      observe: async (input) => {
        process.send({ probe: 'preview-started' })
        await new Promise((resolve) => {
          const release = (message) => { if (message.type === 'release') { process.off('message', release); resolve() } }
          process.on('message', release)
        })
        return {
          ok: true,
          bytesRead: 1,
          truncated: false,
          observation: {
            schemaVersion: 1,
            file: { path: input.file.path, workspaceRoot: input.file.workspaceRoot },
            view: { pluginId: 'probe-slot', modality: 'unknown', mode: input.session.mode, title: 'probe' },
            actions: ['observe']
          }
        }
      }
    }
  }]
}
`
    const child = await spawnPreviewRunner(t, blockedEntry)
    assert.equal((await request(child, 'activate', { packageName: 'probe-plugin' })).ok, true)
    const probes: string[] = []
    child.on('message', (message: { probe?: string }) => { if (message.probe) probes.push(message.probe) })
    const inFlight = request(child, 'preview', previewPayload('observe', observationInput))
    const deadline = AbortSignal.timeout(5000)
    while (!probes.includes('preview-started')) {
      deadline.throwIfAborted()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const deactivated = request(child, 'deactivate', {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    const rejected = await request(child, 'preview', previewPayload('observe', observationInput))
    assert.equal(rejected.ok, false)
    assert.match(rejected.error?.message ?? '', /deactivat|disabled/i)
    child.send({ type: 'release' })
    assert.equal((await inFlight).ok, true)
    await deactivated
    const after = await request(child, 'preview', previewPayload('observe', observationInput))
    assert.equal(after.ok, false)
  })

  test('rejects a stalled preview provider with request_timeout under an injected short timeout', async (t) => {
    // Mutation-check gap #7: the 30s preview budget had no automated negative.
    // The timeout is injectable per runtime (previewTimeoutMs); the stalled
    // handler resolves via an in-child timer so disposal stays inside the
    // default 5s request budget without any IPC release valve.
    const stalledManifest = { ...manifest, id: 'slow-slot', displayName: 'Slow Slot' }
    const stalledEntry = `
const manifest = ${JSON.stringify(stalledManifest)}
export function getWorkspacePreviewProviders() {
  return [{
    slotId: 'slow-slot',
    artifactKinds: [],
    manifest,
    provider: {
      observe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return { ok: true, bytesRead: 0, truncated: false }
      }
    }
  }]
}
`
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-preview-timeout-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, stalledEntry)
    const host = new ProcessExtensionHost()
    await host.prepare({ pluginId: 'slow-plugin', packageName: 'slow-plugin', version: '1.0.0', entryPath, previewTimeoutMs: 60 })
    await host.commit('slow-plugin')
    const runtime = host.runtime('slow-plugin')
    assert.ok(runtime)
    const started = Date.now()
    const error = await runtime.workspacePreviewRequest('slow-slot', 'observe', '/ws/target', {
      session: { id: 's', pluginId: 'slow-slot', workspaceRoot: '/ws/target', path: '/ws/target/a.probe', modality: 'unknown', mode: 'preview', openedAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' },
      manifest: stalledManifest,
      file: { workspaceRoot: '/ws/target', path: '/ws/target/a.probe' }
    }).then(() => null, (cause: unknown) => cause)
    const elapsed = Date.now() - started
    assert.ok(error instanceof Error, 'expected the stalled preview call to reject')
    assert.equal((error as { code?: string }).code, 'request_timeout')
    assert.ok(elapsed < 5_000, `timeout rejection took ${elapsed}ms`)
    await host.dispose('slow-plugin')
  })

  test('ProcessExtensionRuntime exposes slot listing and governed requests with generation checks', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'sciforge-preview-host-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const entryPath = join(directory, 'main.mjs')
    await writeFile(entryPath, previewEntry)
    const host = new ProcessExtensionHost()
    await host.prepare({ pluginId: 'probe-plugin', packageName: 'probe-plugin', version: '1.0.0', entryPath })
    await host.commit('probe-plugin')
    const runtime = host.runtime('probe-plugin')
    assert.ok(runtime)
    const generation = runtime.snapshot.generation

    const slots = await runtime.workspacePreviewSlots(generation) as Array<{ slotId: string }>
    assert.deepEqual(slots.map((slot) => slot.slotId), ['probe-slot'])

    const observed = await runtime.workspacePreviewRequest('probe-slot', 'observe', '/ws/target', observationInput, generation) as { ok: boolean }
    assert.equal(observed.ok, true)

    await assert.rejects(
      runtime.workspacePreviewRequest('probe-slot', 'observe', '/ws/target', observationInput, generation + 1),
      /stale/
    )
    await assert.rejects(
      host.runtime('probe-plugin')!.workspacePreviewRequest('probe-slot', 'notAMethod' as never, '/ws/target', observationInput, generation),
      /not supported/
    )
    await host.dispose('probe-plugin')
    await assert.rejects(
      runtime.workspacePreviewRequest('probe-slot', 'observe', '/ws/target', observationInput, generation),
      /stale/
    )
  })
})
