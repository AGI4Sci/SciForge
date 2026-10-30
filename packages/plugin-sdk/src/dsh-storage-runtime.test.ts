import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProcessExtensionHost, ProcessExtensionRuntime } from './process-extension-host.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-storage-runtime-'))
  const entryPath = join(root, 'main.mjs')
  await writeFile(entryPath, 'export function apply() {}')
  return {root,entryPath}
}

test('storage root rejects relative profile roots, package path traversal, mismatched identity and symlink escape', async () => {
  const f = await fixture()
  await mkdir(join(f.root,'outside'))
  await mkdir(join(f.root,'profile'))
  await symlink(join(f.root,'outside'),join(f.root,'profile','extensions'))
  const grants = [
    {profileRoot:'relative-profile',packageName:'storage-test'},
    {profileRoot:f.root,packageName:'..'},
    {profileRoot:f.root,packageName:'../outside'},
    {profileRoot:f.root,packageName:'%2e%2e'},
    {profileRoot:f.root,packageName:'other-plugin'},
    {profileRoot:join(f.root,'profile'),packageName:'storage-test'}
  ]
  try {
    for (const dshStorage of grants) {
      const runtime = new ProcessExtensionRuntime({pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',generation:1,entryPath:f.entryPath,dshStorage})
      try {
        await assert.rejects(runtime.activate(), /storage|profile|identity|symlink/i)
      } finally {await runtime.dispose()}
    }
  } finally {await rm(f.root,{recursive:true,force:true})}
})

test('storage uses the canonical version-store npm identity validation without normalization', async () => {
  const f = await fixture()
  const invalid = ['.', '..', '_hidden', '.hidden', 'Uppercase', 'node_modules', 'favicon.ico', 'a'.repeat(215), '../escape', 'name/escape', '@scope/../escape', '@.scope/name', 'https://example.test/pkg', 'name%2fescape', '%2e%2e', '@scope%2fname', 'name\\escape', 'name\n', 'name\r\n', 'name ', '@scope/name\n']
  try {
    for (const packageName of invalid) {
      const runtime = new ProcessExtensionRuntime({pluginId:packageName,packageName,version:'1.0.0',generation:1,entryPath:f.entryPath,
        dshStorage:{profileRoot:f.root,packageName}})
      try { await assert.rejects(runtime.activate(), /Invalid DSH storage package identity/, JSON.stringify(packageName)) }
      finally { await runtime.dispose() }
    }
    // Exact identity is checked even when both names are individually canonical.
    const runtime = new ProcessExtensionRuntime({pluginId:'-plugin',packageName:'-plugin',version:'1.0.0',generation:1,entryPath:f.entryPath,
      dshStorage:{profileRoot:f.root,packageName:'@-scope/-plugin'}})
    try { await assert.rejects(runtime.activate(), /Invalid DSH storage package identity/) }
    finally { await runtime.dispose() }
    for (const packageName of ['a'.repeat(214), '@scope/' + 'a'.repeat(207)]) {
      const valid = new ProcessExtensionRuntime({pluginId:packageName,packageName,version:'1.0.0',generation:1,entryPath:f.entryPath,
        dshStorage:{profileRoot:f.root,packageName}})
      try { assert.equal((await valid.activate()).state, 'active') }
      finally { await valid.dispose() }
    }
  } finally { await rm(f.root,{recursive:true,force:true}) }
})

test('private storage is never combined with a compute tool grant', async () => {
  const f = await fixture()
  await writeFile(f.entryPath, `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {ctx.tools.register(defineTool({name:'state',description:'Read state',parameters:{},output:{schema:{type:'number'},render:()=>[]},execute:async()=>1}))}
`)
  const runtime = new ProcessExtensionRuntime({pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',generation:1,entryPath:f.entryPath,
    dshStorage:{profileRoot:f.root,packageName:'storage-test'},dshToolGrants:{state:{id:'storage.state',effect:'compute'}}})
  try {await assert.rejects(runtime.activate(), /storage.*compute|compute.*storage/i)}
  finally {await runtime.dispose();await rm(f.root,{recursive:true,force:true})}
})

test('private storage candidate cannot open the active generation medium', async () => {
  const f = await fixture()
  const host = new ProcessExtensionHost({resolveDshStorage:()=>({profileRoot:f.root,packageName:'storage-test'})})
  const options={pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',entryPath:f.entryPath}
  try {
    await host.replace(options)
    await assert.rejects(host.prepare({...options,version:'2.0.0'}), /storage.*restart|storage.*active/i)
    assert.equal(host.snapshot('storage-test')?.version,'1.0.0')
    assert.equal(host.pending('storage-test'),undefined)
  } finally {await host.disposeAll();await rm(f.root,{recursive:true,force:true})}
})

test('named runner hooks cannot claim native storage support', async () => {
  const f = await fixture()
  await writeFile(f.entryPath,'export function activate() {}')
  const runtime=new ProcessExtensionRuntime({pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',generation:1,entryPath:f.entryPath,dshStorage:{profileRoot:f.root,packageName:'storage-test'}})
  try {await assert.rejects(runtime.activate(), /storage.*native|native.*storage/)}
  finally {await runtime.dispose();await rm(f.root,{recursive:true,force:true})}
})
