/**
 * A package may contribute tools (native Cordis entry) and preview slots at the same
 * time. Before this test the runner treated `getWorkspacePreviewProviders` as a legacy
 * hook, so any package that also exported `apply` was forced down the named-runner lane
 * and its tools were never registered.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionRuntime } from './process-extension-host.js'

const SLOT_MANIFEST = {
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

test('a native Cordis entry registers tools and preview slots together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-preview-'))
  const entryPath = join(root, 'main.mjs')
  await writeFile(entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'ping',
    description: 'Ping',
    parameters: {},
    output: { schema: { type: 'number' }, render: () => [] },
    execute: async () => 1
  }))
}
export function getWorkspacePreviewProviders() {
  return [{
    slotId: 'probe-slot',
    artifactKinds: ['thumbnail'],
    manifest: ${JSON.stringify(SLOT_MANIFEST)},
    provider: { observe: async () => ({ ok: true }) }
  }]
}
`)
  const runtime = new ProcessExtensionRuntime({
    pluginId: 'native-preview',
    packageName: 'native-preview',
    version: '1.0.0',
    generation: 1,
    entryPath,
    dshToolGrants: { ping: { id: 'native.ping', effect: 'compute' } }
  })
  try {
    const snapshot = await runtime.activate()
    assert.equal(snapshot.state, 'active')
    assert.ok(runtime.capabilityDescriptors.some((descriptor) => descriptor.id === 'native.ping'))
    const slots = await runtime.workspacePreviewSlots(1) as Array<{ slotId: string }>
    assert.deepEqual(slots.map((slot) => slot.slotId), ['probe-slot'])
  } finally {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  }
})