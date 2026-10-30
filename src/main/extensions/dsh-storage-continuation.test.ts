import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-storage-host-'))
  const contracts = new Map<string, PluginAdapterContract>()
  for (const name of ['storage-one', 'storage-two']) {
    const dir = join(root, 'plugins', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(dir, 'patch.yml'), '[]')
    await writeFile(join(dir, 'main.js'), `
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
export const inject = ['storage', 'storageDomain']
export async function apply(ctx) {
 const spec = defineDomain({name:'private_state',version:1,global:{schema:z.number().int(),initial:0},tables:{rows:domainTable(z.object({count:z.number().int()}))}})
 const domain = await ctx.storage.domain.open(spec)
 const count = domain.global.get() + 1
 await domain.global.set(count)
 await domain.table('rows').put('startup', {count})
 ctx.effect(()=>async()=>{await domain.table('rows').put('closed',{count});await domain.close()})
}
`)
    contracts.set(name, { approved: true, permissions: [], hostApiRange: '^1.0.0', dshAuthorization: { packageName: name, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', storage: 'plugin-private' } } as PluginAdapterContract)
  }
  const create = (profile = 'profile-a') => new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, profile), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts })
  const medium = (name: string, profile = 'profile-a') => join(root, profile, 'extensions', 'dsh-storage', encodeURIComponent(name), 'private_state.json')
  const read = async (name: string, profile = 'profile-a') => JSON.parse(await readFile(medium(name, profile), 'utf8'))
  return { root, contracts, create, medium, read }
}

it('official domain global and tables persist on restart and are isolated by host package/profile roots', async () => {
  const f = await fixture()
  const first = f.create()
  const restart = f.create()
  const other = f.create('profile-b')
  try {
    await first.initialize()
    await first.setEnabled('storage-one', true)
    expect(await f.read('storage-one')).toMatchObject({ global: 1, tables: {rows: {startup: {count: 1}}} })
    await first.setEnabled('storage-two', true)
    expect(await f.read('storage-two')).toMatchObject({ global: 1 })
    await first.dispose()
    expect(await f.read('storage-one')).toMatchObject({tables:{rows:{closed:{count:1}}}})
    await restart.initialize()
    expect(await f.read('storage-one')).toMatchObject({global:2})
    expect(await f.read('storage-two')).toMatchObject({global:2})
    await other.initialize()
    await other.setEnabled('storage-one', true)
    expect(await f.read('storage-one', 'profile-b')).toMatchObject({global:1})
    expect(await f.read('storage-one')).toMatchObject({global:2})
  } finally {
    await Promise.all([first.dispose(), restart.dispose(), other.dispose()])
    await rm(f.root, {recursive:true,force:true})
  }
}, 20_000)

it('host reconciliation revokes a live private storage runtime and restart cannot reopen it', async () => {
  const f = await fixture()
  const service = f.create()
  const restart = f.create()
  try {
    await service.initialize()
    await service.setEnabled('storage-one', true)
    const before = await f.read('storage-one')
    const contract = f.contracts.get('storage-one')!
    f.contracts.set('storage-one', {...contract, dshAuthorization:{...contract.dshAuthorization!,storage:undefined}})
    await service.reconcileDshAuthorization('storage-one')
    expect((await service.updateStatus('storage-one')).enabled).toBe(false)
    await service.dispose()
    await restart.initialize()
    await restart.attachCapabilityRegistry(new CapabilityRegistry())
    await expect(restart.setEnabled('storage-one', true)).rejects.toThrow(/dependencies|storage/i)
    expect(await f.read('storage-one')).toMatchObject({global:before.global})
  } finally {
    await service.dispose();await restart.dispose();await rm(f.root,{recursive:true,force:true})
  }
})

it('host refuses a relative profile directory rather than resolving storage against cwd', () => {
  expect(() => new DevelopmentExternalPluginService({root:join(tmpdir(),'synthetic-plugins'),userDataPath:'relative-profile',hostApiVersion:'1.0.0'})).toThrow(/profile.*absolute|user.*absolute/i)
})

// Additional official-contract regressions; first-pass green is not a new RED cycle.
it.each(['global','record'])('official durable boundary rejects invalid %s schema without changing the medium', async (kind) => {
  const f = await fixture()
  const service = f.create()
  const restart = f.create()
  try {
    await service.initialize();await service.setEnabled('storage-one',true);await service.dispose()
    const invalid = await f.read('storage-one')
    if (kind === 'global') invalid.global = 'not-a-number'
    else invalid.tables.rows.startup = {count:'not-a-number'}
    const bytes = JSON.stringify(invalid)
    await writeFile(f.medium('storage-one'),bytes)
    await restart.initialize()
    await expect(restart.attachCapabilityRegistry(new CapabilityRegistry())).rejects.toThrow(/schema|invalid-record/)
    expect(await readFile(f.medium('storage-one'),'utf8')).toBe(bytes)
  } finally {await service.dispose();await restart.dispose();await rm(f.root,{recursive:true,force:true})}
}, 20_000)

it('official domain names reject traversal even when built without defineDomain', async () => {
  const f = await fixture()
  await writeFile(join(f.root,'plugins','storage-one','main.js'), `
export const inject=['storage','storageDomain']
export async function apply(ctx) {await ctx.storage.domain.open({name:'../escape',version:1,tables:{}})}
`)
  const service=f.create()
  try {
    await service.initialize()
    await expect(service.setEnabled('storage-one',true)).rejects.toThrow(/invalid unit name|malformed/)
    await expect(readFile(join(f.root,'profile-a','extensions','dsh-storage','escape.json'))).rejects.toThrow()
  } finally {await service.dispose();await rm(f.root,{recursive:true,force:true})}
})

it('close drains already-queued official writes before process shutdown', async () => {
  const f = await fixture()
  await writeFile(join(f.root,'plugins','storage-one','main.js'), `
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
export const inject=['storage','storageDomain']
export async function apply(ctx) {
 const domain=await ctx.storage.domain.open(defineDomain({name:'private_state',version:1,global:{schema:z.number(),initial:0},tables:{}}))
 ctx.effect(()=>async()=>{
   const writes=[]
   for(let i=1;i<=20;i++) writes.push(domain.global.set(i))
   const close=domain.close()
   let rejected=false
   try {await domain.global.set(99)} catch(error) {rejected=error.code==='closed'}
   await Promise.all(writes);await close
   if(!rejected) throw new Error('post-close write accepted')
 })
}
`)
  const service=f.create()
  try {
    await service.initialize();await service.setEnabled('storage-one',true);await service.dispose()
    expect(await f.read('storage-one')).toMatchObject({global:20})
  } finally {await service.dispose();await rm(f.root,{recursive:true,force:true})}
})
