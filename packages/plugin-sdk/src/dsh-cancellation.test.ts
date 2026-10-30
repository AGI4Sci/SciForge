import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'

async function fixture(timeoutMs = 5000) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cancel-'))
  const marker = join(root, 'events')
  const entryPath = join(root, 'main.mjs')
  await writeFile(entryPath, `
import { appendFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
 ctx.tools.register(defineTool({ name: 'wait', description: 'Wait for a synthetic computation',
 parameters: { delay: {type:'number', required:true} },
 output: {schema:{type:'string'}, render:(_a,v)=>[{type:'text',text:v}]},
 execute: async (args, exec) => {
  appendFileSync(${JSON.stringify(marker)}, 'started\\n')
  exec.signal.addEventListener('abort',()=>appendFileSync(${JSON.stringify(marker)}, 'aborted\\n'),{once:true})
  await new Promise(r=>setTimeout(r,args.delay))
  appendFileSync(${JSON.stringify(marker)}, 'completed\\n')
  return 'late'
 } }))
}
`)
  const host = new ProcessExtensionHost({ resolveDshToolGrants: () => ({ wait: { id: 'example.wait', effect: 'compute' } }) })
  const snapshot = await host.replace({ pluginId: 'example', packageName: 'example', version: '1.0.0', entryPath, timeoutMs })
  return { root, marker, host, snapshot, runtime: host.runtime('example')! }
}
async function waitFor(marker: string, event: string) {
  for (let i = 0; i < 200; i++) {
    if ((await readFile(marker, 'utf8').catch(() => '')).includes(event)) return
    await new Promise(r => setTimeout(r, 10))
  }
  assert.fail(`missing child event ${event}`)
}
async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await f.host.disposeAll()
  let alive = true
  for (let i = 0; i < 100; i++) {
    try { process.kill(f.snapshot.pid!, 0) } catch { alive = false; break }
    await new Promise(r => setTimeout(r, 10))
  }
  assert.equal(alive, false, 'real child must exit')
  await rm(f.root, { recursive: true, force: true })
}

test('request timeout is distinct from explicit cancellation and does not claim child abort', async () => {
  const f = await fixture(2000)
  try {
    const controller = new AbortController()
    await assert.rejects(f.runtime.invoke('example.wait', { delay: 2400 }, f.snapshot.generation, controller.signal), { code: 'request_timeout' })
    controller.abort()
    await waitFor(f.marker, 'completed')
    assert.equal((await readFile(f.marker, 'utf8')).includes('aborted'), false)
    assert.deepEqual(await f.runtime.invoke('example.wait', { delay: 0 }), { output: 'late' })
  } finally { await cleanup(f) }
})

test('explicit abort reaches official Tool execution and discards a late successful result without killing the generation', async () => {
  const f = await fixture()
  try {
    const controller = new AbortController()
    const pending = f.runtime.invoke('example.wait', { delay: 250 }, f.snapshot.generation, controller.signal)
    const rejection = assert.rejects(pending, { code: 'request_cancelled' })
    await waitFor(f.marker, 'started')
    controller.abort()
    await rejection
    await waitFor(f.marker, 'aborted')
    await waitFor(f.marker, 'completed')
    assert.deepEqual(await f.runtime.invoke('example.wait', { delay: 0 }), { output: 'late' })
    assert.equal(f.runtime.snapshot.state, 'active')
  } finally { await cleanup(f) }
})
