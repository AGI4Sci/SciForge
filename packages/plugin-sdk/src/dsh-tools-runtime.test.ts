import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'

const source = `
import { Context } from '@deepseek-ai/cordis'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
 if (!Context.is(ctx) || !(ctx.tools instanceof ToolRuntime)) throw new Error('tools identity mismatch')
 let calls = 0
 ctx.tools.register(defineTool({name:'echo', description:'Echo a finite number',
 parameters: {value:{type:'number', required:true}},
 output: {schema:{type:'object', properties:{value:{type:'number',required:true},calls:{type:'number',required:true}}, additionalProperties:false}, render:(_args,v)=>[{type:'text',text:String(v.value)}]},
 execute: async (args)=>({value:args.value,calls:++calls})}))
}
`

for (const [name, extra] of [
  ['missing service', `export const inject = ['unavailable']; export function apply() { throw new Error('must never run') }`],
  ['unapproved runtime import', `import '@deepseek-ai/dsh-workspace'; export function apply() {}`],
  ['missing tool grant', source]
]) {
  test(`native activation fails closed for ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-reject-'))
    const host = new ProcessExtensionHost()
    try {
      const entryPath = join(root, 'main.mjs')
      await writeFile(entryPath, extra)
      await assert.rejects(host.prepare({ pluginId: 'example', packageName: 'example', version: '1.0.0', entryPath }), /dependencies are not ready|Unapproved DSH runtime package|requires an explicit host compute grant/)
      assert.equal(host.pending('example'), undefined)
    } finally { await host.disposeAll(); await rm(root, { recursive: true, force: true }) }
  })
}

test('official ToolRuntime retains callable closures behind RPC and validates schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-'))
  const host = new ProcessExtensionHost({ resolveDshToolGrants: () => ({ echo: { id: 'example.echo', effect: 'compute' } }) })
  try {
    const entryPath = join(root, 'main.mjs')
    await writeFile(entryPath, source)
    const state = await host.replace({ pluginId: 'example', packageName: 'example', version: '1.0.0', entryPath })
    assert.deepEqual(state.capabilityIds, ['example.echo'])
    const runtime = host.runtime('example')!
    assert.deepEqual(await runtime.invoke('example.echo', { value: 5 }), { output: { value: 5, calls: 1 } })
    assert.deepEqual(await runtime.invoke('example.echo', { value: 6 }), { output: { value: 6, calls: 2 } })
    await assert.rejects(runtime.invoke('example.echo', { value: 'invalid' }), /number|argument/i)
  } finally {
    await host.disposeAll()
    await rm(root, { recursive: true, force: true })
  }
})

for (const effect of ['read', 'compute', 'workspace-write', 'external-write', 'destructive'] as const) {
  test(`native ${effect} projection retains the host-required approval level`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tool-approval-'))
    const host = new ProcessExtensionHost({ resolveDshToolGrants: () => ({ echo: { id: 'ordinary.echo', effect } }) })
    try {
      const entryPath = join(root, 'main.mjs')
      await writeFile(entryPath, source)
      await host.replace({ pluginId: 'ordinary', packageName: 'ordinary', version: '1.0.0', entryPath })
      const [descriptor] = host.runtime('ordinary')!.capabilityDescriptors
      assert.equal(descriptor!.effect, effect)
      assert.equal(descriptor!.approval, effect === 'external-write' || effect === 'destructive' ? 'confirmation' : 'none')
    } finally { await host.disposeAll(); await rm(root, { recursive: true, force: true }) }
  })
}
