import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'

for (const shape of ['named apply', 'default function', 'default object', 'Service']) {
  test(`real Cordis ${shape} preserves Context/Service identity and disposes effects once`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-context-'))
    const marker = join(root, 'events.jsonl')
    const host = new ProcessExtensionHost()
    let pid: number | undefined
    try {
      const body = `
import { Context, Service } from '@deepseek-ai/cordis'
import { appendFileSync } from 'node:fs'
function record(event) { appendFileSync(${JSON.stringify(marker)}, JSON.stringify(event)+'\\n') }
function setup(ctx) {
 if (!Context.is(ctx) || ctx.root === ctx || !Context.is(ctx.root)) throw new Error('wrong Context identity')
 class Local extends Service { constructor(c) { super(c, 'local'); this.value = 37 } }
 new Local(ctx)
 if (!(ctx.local instanceof Local) || ctx.local.value !== 37) throw new Error('wrong Service identity')
 ctx.effect(() => { record('apply'); return () => record('dispose') })
}
`
      const exports = shape === 'named apply' ? 'export function apply(ctx) { setup(ctx) }'
        : shape === 'default function' ? 'export default function plugin(ctx) { setup(ctx) }'
        : shape === 'default object' ? 'export default { apply(ctx) { setup(ctx) } }'
        : 'export default class Plugin extends Service { constructor(ctx) { super(ctx, "example"); setup(ctx) } }'
      const entryPath = join(root, 'main.mjs')
      await writeFile(entryPath, body + exports)
      const snapshot = await host.replace({ pluginId: 'context', packageName: 'context', version: '1.0.0', entryPath })
      pid = snapshot.pid
      assert.equal(snapshot.state, 'active')
      assert.deepEqual((await readFile(marker, 'utf8')).trim().split('\n').map((x) => JSON.parse(x)), ['apply'])
      await host.disposeAll()
      assert.deepEqual((await readFile(marker, 'utf8')).trim().split('\n').map((x) => JSON.parse(x)), ['apply', 'dispose'])
      await host.disposeAll()
      for (let i = 0; i < 100; i++) {
        try { process.kill(pid!, 0) } catch { pid = undefined; break }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(pid, undefined, 'child must actually exit')
    } finally {
      await host.disposeAll()
      if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* exited */ } }
      await rm(root, { recursive: true, force: true })
    }
  })
}
