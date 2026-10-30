import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'

for (const [shape, source] of [
  ['named apply', 'export function apply() { throw new Error("native apply must not run") }'],
  ['default function', 'export default function plugin() { throw new Error("native function must not run") }'],
  ['default object', 'export default { apply() { throw new Error("native apply must not run") } }'],
  ['service class', 'export default class Plugin { constructor() { throw new Error("native constructor must not run") } }']
]) {
  test(`named runner contract remains active alongside Cordis ${shape} exports`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mixed-entry-'))
    const host = new ProcessExtensionHost()
    try {
      const entryPath = join(root, 'plugin.mjs')
      await writeFile(entryPath, `
let active = false
export function activate() { active = true }
export function getCapabilityDefinitions() {
  return [{ descriptor: { id: 'contract.echo' }, handler: async (input) => {
    if (!active) throw new Error('runner activation did not run')
    return { output: input }
  } }]
}
${source}
`)
      const snapshot = await host.replace({ pluginId: 'contract', packageName: 'contract', version: '1.0.0', entryPath })
      assert.equal(snapshot.state, 'active')
      assert.deepEqual(snapshot.capabilityIds, ['contract.echo'])
      assert.deepEqual(await host.runtime('contract')!.invoke('contract.echo', { value: 7 }), { output: { value: 7 } })
    } finally {
      await host.dispose('contract')
      await host.rollbackPrepared('contract')
      await rm(root, { recursive: true, force: true })
    }
  })
}

for (const [shape, source] of [
  ['named apply', 'export function apply(ctx) { ctx.tools.register({}) }'],
  ['default function', 'export default function plugin(ctx) { ctx.tools.register({}) }'],
  ['default object', 'export default { apply(ctx) { ctx.tools.register({}) } }'],
  ['service class', 'export default class Plugin { constructor(ctx) { ctx.tools.register({}) } }']
]) {
  test(`unsupported Cordis ${shape} cannot masquerade as an active empty plugin`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-unsupported-entry-'))
    const host = new ProcessExtensionHost()
    try {
      const entryPath = join(root, 'plugin.mjs')
      await writeFile(entryPath, source)
      await assert.rejects(host.prepare({ pluginId: 'contract', packageName: 'contract', version: '1.0.0', entryPath }), /DSH Cordis entrypoint requires a supported Context runtime/)
      assert.equal(host.pending('contract'), undefined)
      assert.equal(host.runtime('contract'), undefined)
    } finally {
      await host.rollbackPrepared('contract')
      await rm(root, { recursive: true, force: true })
    }
  })
}
