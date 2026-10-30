import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ProcessExtensionHost } from '@sciforge/plugin-sdk'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'

const caller = { audience: 'agent' as const, callerId: 'synthetic' }
const source = `
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
 const tool = (name, execute, parameters = {}) => defineTool({name, description:name, parameters,
  output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute})
 let undo
 ctx.tools.register(tool('control', async ({op})=>{
  if(op==='add') undo = ctx.tools.register(tool('late', async ()=>'first'))
  if(op==='remove') undo()
  if(op==='replace') {undo(); undo = ctx.tools.register(tool('late', async ({value})=>'second:'+value, {value:{type:'string',required:true}}))}
  if(op==='crash') setImmediate(()=>process.exit(1))
  if(op==='duplicate') {ctx.emit('tools/change');ctx.emit('tools/change')}
  if(op==='scope') {const {createScope}=await import('@deepseek-ai/dsh-scope');const scoped=createScope(ctx,{});scoped.ctx.tools.register(tool('late',async ()=>'scoped'))}
  if(op==='invalid') ctx.tools.register({name:'late',description:'invalid',parameters:{bad:()=>null},output:{schema:{type:'string'},render:()=>[]},execute:async ()=>'bad'})
  if(op==='unknown') ctx.tools.register(tool('unknown', async ()=>'denied'))
  return 'ok'
 }, {op:{type:'string',required:true}}))
}
`
async function fixture(code = source, enable = true, duplicateGrants = false) {
 const root = await mkdtemp(join(tmpdir(), 'dsh-dynamic-'))
 const dir = join(root, 'plugins/dynamic')
 await mkdir(dir, {recursive:true})
 await writeFile(join(dir,'package.json'), JSON.stringify({name:'dynamic',version:'1.0.0',type:'module',exports:{'.':'./main.js'},dsh:{bundle:{patch:'./patch.yml'}}}))
 await writeFile(join(dir,'patch.yml'),'[]')
 await writeFile(join(dir,'main.js'),code)
 const contract: PluginAdapterContract = {approved:true,permissions:[],hostApiRange:'^1.0.0',dshAuthorization:{packageName:'dynamic',packageVersion:'1.0.0',dshRuntimeVersion:'0.2.0-rc.2',tools:{control:{id:'dynamic.control',effect:'compute'},late:{id:duplicateGrants ? 'dynamic.control' : 'dynamic.late',effect:'compute'}}}}
 const contracts = new Map([['dynamic',contract]])
 const registry = new CapabilityRegistry()
 const broker = new CapabilityBroker(registry)
 const service = new DevelopmentExternalPluginService({root:join(root,'plugins'),userDataPath:join(root,'data'),hostApiVersion:'1.0.0',dshRuntimeVersion:'0.2.0-rc.2',adapterContracts:contracts})
 await service.initialize()
 await service.attachCapabilityRegistry(registry)
 // Attaching the service publishes five Host-owned development capabilities.
 // Retain the whole descriptor set: plugin withdrawal must preserve every Host
 // descriptor and may not leave any unexpected contribution behind.
 const hostBaseline = broker.discover(caller)
 expect(hostBaseline.map(d=>d.id)).toEqual([
  'plugin.dev.check', 'plugin.dev.prepare', 'plugin.dev.submit',
  'plugin.update.request', 'plugin.update.status'
 ])
 if (enable) await service.setEnabled('dynamic',true)
 let seq=0
 const invoke = (id:string,input:CapabilityJsonValue={})=>broker.invoke(caller,{actionId:`dynamic.${id}`,invocationId:`call-${++seq}`,input})
 return {root,dir,service,registry,broker,hostBaseline,contracts,contract,invoke,close:async()=>{await service.dispose();await rm(root,{recursive:true,force:true})}}
}
it('initial real Cordis duplicate grants reject activation without residual Broker contributions', async()=>{
 const f = await fixture(source.replace('let undo', "ctx.tools.register(tool('late',async ()=>'startup'))\n let undo"), false, true)
 try {
  await expect(f.service.setEnabled('dynamic',true)).rejects.toThrow(/duplicate|already registered/i)
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
  await expect(f.invoke('control',{op:'noop'})).rejects.toThrow()
 } finally {await f.close()}
})
it('initial publication failure withdraws partial contributions and fences queued notifications', async()=>{
 const f = await fixture(source.replace('let undo', "ctx.tools.register(tool('late',async ()=>'startup'))\n let undo"), false)
 const register = f.registry.register.bind(f.registry)
 let registrations = 0
 f.registry.register = ((definition)=>{
  if (++registrations === 2) throw new Error('synthetic initial publication failure')
  return register(definition)
 }) as typeof f.registry.register
 try {
  await expect(f.service.setEnabled('dynamic',true)).rejects.toThrow(/initial publication failure/)
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
  // Ordered host queue must not republish after failure, even once registration recovers.
  f.registry.register = register
  await new Promise(resolve=>setImmediate(resolve))
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
  await f.service.setEnabled('dynamic',false)
  await f.service.setEnabled('dynamic',true)
  expect((await f.invoke('late')).output).toBe('startup')
 } finally {f.registry.register = register;await f.close()}
})
it('initial publication cleanup failure still disposes the failed generation', async()=>{
 const f = await fixture(source.replace('let undo', "ctx.tools.register(tool('late',async ()=>'startup'))\n let undo"), false)
 const register = f.registry.register.bind(f.registry)
 const unregister = f.registry.unregister.bind(f.registry)
 let saved: ReturnType<typeof f.registry.get>
 let registrations = 0
 f.registry.register = ((definition)=>{
  if (++registrations === 2) throw new Error('synthetic publication failure')
  saved = definition
  return register(definition)
 }) as typeof f.registry.register
 f.registry.unregister = ((id)=>{unregister(id);throw new Error('synthetic cleanup failure')}) as typeof f.registry.unregister
 try {
  await expect(f.service.setEnabled('dynamic',true)).rejects.toThrow(/failure/)
  await expect(saved!.handler({op:'noop'}, {caller} as never)).rejects.toThrow(/stale|not connected/)
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
 } finally {f.registry.register = register;f.registry.unregister = unregister;await f.close()}
})
it('full descriptor preflight rejects an invalid later definition before any Broker mutation', async()=>{
 const descriptor = {contractVersion:3,id:'dynamic.control',version:'1',title:'control',description:'control',audiences:['agent','ui'],scope:'global',resourceKinds:[],effect:'compute',approval:'none',concurrency:{revision:'none',idempotency:'required'},inputSchema:{type:'object'},outputSchema:{type:'string'},tags:[]}
 const f = await fixture(`export function activate(){};export function getCapabilityDefinitions(){return ${JSON.stringify([descriptor,{...descriptor,id:'dynamic.late',title:''}])}.map(descriptor=>({descriptor,handler:async()=>({output:'ok'})}))}`,false)
 const register = f.registry.register.bind(f.registry)
 let mutations = 0
 f.registry.register = ((definition)=>{mutations++;return register(definition)}) as typeof f.registry.register
 try {
  await expect(f.service.setEnabled('dynamic',true)).rejects.toThrow()
  expect(mutations).toBe(0)
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
 } finally {f.registry.register = register;await f.close()}
})
it('publishes tools registered after activation through the public Broker', async()=>{
 const f = await fixture()
 try {
  expect(f.broker.discover(caller).map(d=>d.id)).not.toContain('dynamic.late')
  await f.invoke('control',{op:'add'})
  await expect.poll(()=>f.broker.discover(caller).map(d=>d.id)).toContain('dynamic.late')
  expect((await f.invoke('late')).output).toBe('first')
 } finally {await f.close()}
})
it('same-name replacement rejects saved descriptors and publishes the new schema and body', async()=>{
 const f = await fixture()
 try {
  await f.invoke('control',{op:'add'})
  await expect.poll(()=>f.registry.has('dynamic.late')).toBe(true)
  const old = f.registry.get('dynamic.late')!
  await f.invoke('control',{op:'replace'})
  await expect(old.handler({value:'stale'}, {caller} as never)).rejects.toThrow(/stale|revision/)
  await expect(f.invoke('late')).rejects.toThrow()
  expect((await f.invoke('late',{value:'fresh'})).output).toBe('second:fresh')
 } finally {await f.close()}
})
it('duplicate change events preserve descriptor identity and revision', async()=>{
 const f = await fixture()
 try {
  const old = f.registry.get('dynamic.control')!
  await f.invoke('control',{op:'duplicate'})
  expect(f.registry.get('dynamic.control')).toBe(old)
  expect((await old.handler({op:'noop'}, {caller} as never)).output).toBe('ok')
 } finally {await f.close()}
})
it('crash withdraws the Broker contribution set', async()=>{
 const f = await fixture()
 try {
  await f.invoke('control',{op:'crash'})
  await expect.poll(()=>f.broker.discover(caller)).toEqual(f.hostBaseline)
  await expect(f.invoke('control',{op:'noop'})).rejects.toThrow()
 } finally {await f.close()}
})
it('invalid dynamic schema never publishes or interrupts approved tools', async()=>{
 const f = await fixture()
 try {
  await f.invoke('control',{op:'invalid'})
  expect(f.registry.has('dynamic.late')).toBe(false)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
 } finally {await f.close()}
})
it('scoped tool changes are explicitly rejected rather than flattened globally', async()=>{
 const f = await fixture()
 try {
  await f.invoke('control',{op:'scope'})
  expect(f.registry.has('dynamic.late')).toBe(false)
  expect((await f.service.list())[0]?.diagnostic).toMatch(/scope.*unsupported/i)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
 } finally {await f.close()}
})
it('dynamic publication rechecks current per-tool grants without dropping authorized peers', async()=>{
 const f = await fixture()
 try {
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,tools:{control:{id:'dynamic.control',effect:'compute'}}}})
  await f.invoke('control',{op:'add'})
  expect(f.registry.has('dynamic.late')).toBe(false)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
 } finally {await f.close()}
})
it('adding tools does not replace unchanged peer Broker definitions', async()=>{
 const f = await fixture()
 try {
  const original=f.registry.get('dynamic.control')
  await f.invoke('control',{op:'add'})
  expect(f.registry.get('dynamic.control')).toBe(original)
 } finally {await f.close()}
})
it('candidate contribution publication waits for commit and fences saved old handlers', async()=>{
 const f = await fixture()
 try {
  const old=f.registry.get('dynamic.control')!
  const candidate=join(f.root,'plugins','.candidates','candidate')
  await mkdir(candidate, {recursive:true})
  await writeFile(join(candidate,'package.json'),JSON.stringify({name:'dynamic',version:'1.0.1',type:'module',exports:{'.':'./main.js'},dsh:{bundle:{patch:'./patch.yml'}}}))
  await writeFile(join(candidate,'patch.yml'),'[]')
  await writeFile(join(candidate,'main.js'),source.replace("return 'ok'","return 'candidate'"))
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,packageVersion:'1.0.1'}})
  const unregister=f.registry.unregister.bind(f.registry)
  f.registry.unregister=(id)=>{
   if(id==='dynamic.control') expect(JSON.parse(readFileSync(join(f.root,'data/extensions/plugin-versions/active/dynamic.json'),'utf8')).version).toBe('1.0.1')
   return unregister(id)
  }
  const original=f.registry.register.bind(f.registry)
  f.registry.register=((definition)=>{
   expect(old===f.registry.get('dynamic.control') || !f.registry.has('dynamic.control')).toBe(true)
   return original(definition)
  }) as typeof f.registry.register
  await f.service.replacePlugin('dynamic',candidate)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('candidate')
  await expect(old.handler({op:'noop'}, {caller} as never)).rejects.toThrow()
  f.registry.unregister=unregister
 } finally {await f.close()}
})
it('startup duplicate grants dynamically withdraw both colliding IDs with a diagnostic', async()=>{
 const f=await fixture(source,true,true)
 try {
  await f.invoke('control',{op:'add'})
  await expect.poll(()=>f.broker.discover(caller)).toEqual(f.hostBaseline)
  expect((await f.service.list())[0]?.diagnostic).toMatch(/duplicate/i)
  await expect(f.invoke('control',{op:'noop'})).rejects.toThrow()
 }finally{await f.close()}
})
it('disable fences queued and saved generation handlers across re-enable', async()=>{
 const f=await fixture()
 try {
  const old=f.registry.get('dynamic.control')!
  await f.invoke('control',{op:'add'})
  await f.service.setEnabled('dynamic',false)
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
  await f.service.setEnabled('dynamic',true)
  await expect(old.handler({op:'add'}, {caller} as never)).rejects.toThrow()
  expect(f.registry.has('dynamic.late')).toBe(false)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
 }finally{await f.close()}
})
it('candidate publication failure rolls back when the old generation has no contributions', async()=>{
 const f=await fixture('export function apply() {}')
 const register=f.registry.register.bind(f.registry)
 try {
  const candidate=join(f.root,'plugins','.candidates','candidate')
  await mkdir(candidate, {recursive:true})
  await writeFile(join(candidate,'package.json'),JSON.stringify({name:'dynamic',version:'1.0.1',type:'module',exports:{'.':'./main.js'},dsh:{bundle:{patch:'./patch.yml'}}}))
  await writeFile(join(candidate,'patch.yml'),'[]')
  await writeFile(join(candidate,'main.js'),source.replace("return 'ok'","return 'candidate'"))
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,packageVersion:'1.0.1'}})
  let registrations=0
  f.registry.register=((definition)=>{
   if(++registrations===1) throw new Error('synthetic candidate publication failure')
   return register(definition)
  }) as typeof f.registry.register
  await expect(f.service.replacePlugin('dynamic',candidate)).rejects.toThrow(/candidate publication failure/)
  expect((await f.service.list())[0]?.version).toBe('1.0.0')
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
  expect(f.registry.has('dynamic.control')).toBe(false)
 }finally{f.registry.register=register;await f.close()}
})

it('post-commit registration failure rolls back the runtime and Broker descriptors', async()=>{
 const f=await fixture()
 const register=f.registry.register.bind(f.registry)
 try {
  const candidate=join(f.root,'plugins','.candidates','candidate')
  await mkdir(candidate, {recursive:true})
  await writeFile(join(candidate,'package.json'),JSON.stringify({name:'dynamic',version:'1.0.1',type:'module',exports:{'.':'./main.js'},dsh:{bundle:{patch:'./patch.yml'}}}))
  await writeFile(join(candidate,'patch.yml'),'[]')
  await writeFile(join(candidate,'main.js'),source.replace("return 'ok'","return 'candidate'"))
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,packageVersion:'1.0.1'}})
  f.registry.register=((definition)=>{
   f.contracts.set('dynamic',f.contract)
   f.registry.register=register
   throw new Error('synthetic publication rejected')
  }) as typeof f.registry.register
  await expect(f.service.replacePlugin('dynamic',candidate)).rejects.toThrow(/publication rejected/)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
 }finally{f.registry.register=register;await f.close()}
})
it('unchanged tools/change withdraws revoked grants while preserving approved peers', async()=>{
 const f=await fixture()
 try {
  await f.invoke('control',{op:'add'})
  await expect.poll(()=>f.registry.has('dynamic.late')).toBe(true)
  const peer=f.registry.get('dynamic.control')!
  const saved=f.registry.get('dynamic.late')!
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,tools:{control:{id:'dynamic.control',effect:'compute'}}}})
  await expect(saved.handler({}, {caller} as never)).rejects.toThrow(/grant|authoriz/)
  await f.invoke('control',{op:'duplicate'})
  await expect.poll(()=>f.registry.has('dynamic.late')).toBe(false)
  expect(f.registry.get('dynamic.control')).toBe(peer)
 }finally{await f.close()}
})
it('a grant for another tool name cannot authorize an existing capability ID', async()=>{
 const f=await fixture()
 try {
  await f.invoke('control',{op:'add'})
  await expect.poll(()=>f.registry.has('dynamic.late')).toBe(true)
  const saved=f.registry.get('dynamic.late')!
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,tools:{control:{id:'dynamic.control',effect:'compute'},unknown:{id:'dynamic.late',effect:'compute'}}}})
  await f.invoke('control',{op:'duplicate'})
  await expect.poll(()=>f.registry.has('dynamic.late')).toBe(false)
  await expect(saved.handler({}, {caller} as never)).rejects.toThrow(/grant|authoriz/)
 }finally{await f.close()}
})
it('scoped restrictions remain unsupported and never replace the global tool view', async()=>{
 const f=await fixture(source.replace('let undo', 'let undo, lift').replace("if(op==='scope')", "if(op==='restrict') {const {createScope}=await import('@deepseek-ai/dsh-scope');const scoped=createScope(ctx,{});lift=scoped.ctx.tools.restrict({deny:['control']})}\n if(op==='lift') lift()\n if(op==='scope')"))
 try {
  const peer=f.registry.get('dynamic.control')!
  expect((await f.invoke('control',{op:'restrict'})).output).toBe('ok')
  expect(f.registry.get('dynamic.control')).toBe(peer)
  expect((await f.service.list())[0]?.diagnostic).toMatch(/scope.*unsupported/i)
  expect((await f.invoke('control',{op:'lift'})).output).toBe('ok')
  expect(f.registry.get('dynamic.control')).toBe(peer)
  expect((await f.service.list())[0]?.diagnostic).toBeUndefined()
 }finally{await f.close()}
})
it('same-schema same-name replacement cannot execute through a saved descriptor', async()=>{
 const f=await fixture(source.replace("{value:{type:'string',required:true}}", "{}"))
 try {
  await f.invoke('control',{op:'add'})
  const saved=f.registry.get('dynamic.late')!
  await f.invoke('control',{op:'replace'})
  await expect(saved.handler({value:'stale'}, {caller} as never)).rejects.toThrow(/stale|revision/)
  expect((await f.invoke('late',{value:'fresh'})).output).toBe('second:fresh')
 }finally{await f.close()}
})
it('disposer immediately withdraws discovery and invocation', async()=>{
 const f = await fixture()
 try {
  await f.invoke('control',{op:'add'})
  await expect.poll(()=>f.registry.has('dynamic.late')).toBe(true)
  await f.invoke('control',{op:'remove'})
  expect(f.registry.has('dynamic.late')).toBe(false)
  await expect(f.invoke('late')).rejects.toThrow()
 } finally {await f.close()}
})
async function replacement(f: Awaited<ReturnType<typeof fixture>>, code = source) {
 const candidate=join(f.root,'plugins','.candidates','candidate')
 await mkdir(candidate, {recursive:true})
 await writeFile(join(candidate,'package.json'),JSON.stringify({name:'dynamic',version:'1.0.1',type:'module',exports:{'.':'./main.js'},dsh:{bundle:{patch:'./patch.yml'}}}))
 await writeFile(join(candidate,'patch.yml'),'[]')
 await writeFile(join(candidate,'main.js'),code.replace("return 'ok'","return 'candidate'"))
 f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,packageVersion:'1.0.1'}})
 return candidate
}

it('reconciles registration notifications received during finalizeCommit without another change', async()=>{
 const f=await fixture()
 const finalize=ProcessExtensionHost.prototype.finalizeCommit
 const barrier=vi.spyOn(ProcessExtensionHost.prototype,'finalizeCommit').mockImplementation(async function(this: ProcessExtensionHost, packageName){
  await f.invoke('control',{op:'add'})
  // Invocation completion drains the real runner snapshot notification through the host queue.
  expect(this.runtime(packageName)!.capabilityDescriptors.map(d=>d.id)).toContain('dynamic.late')
  expect(f.registry.has('dynamic.late')).toBe(false)
  return finalize.call(this,packageName)
 })
 try {
  await f.service.replacePlugin('dynamic',await replacement(f))
  expect(f.registry.has('dynamic.late')).toBe(true)
  expect((await f.invoke('late')).output).toBe('first')
 }finally{barrier.mockRestore();await f.close()}
})

it('finalizeCommit revocation notifications withdraw grants without replacing approved peers', async()=>{
 const f=await fixture()
 const finalize=ProcessExtensionHost.prototype.finalizeCommit
 let peer: ReturnType<typeof f.registry.get>
 let revoked: ReturnType<typeof f.registry.get>
 const barrier=vi.spyOn(ProcessExtensionHost.prototype,'finalizeCommit').mockImplementation(async function(this: ProcessExtensionHost, packageName){
  peer=f.registry.get('dynamic.control')
  revoked=f.registry.get('dynamic.late')
  f.contracts.set('dynamic',{...f.contract,dshAuthorization:{...f.contract.dshAuthorization!,packageVersion:'1.0.1',tools:{control:{id:'dynamic.control',effect:'compute'}}}})
  await f.invoke('control',{op:'duplicate'})
  expect(f.registry.get('dynamic.late')).toBe(revoked)
  return finalize.call(this,packageName)
 })
 try {
  await f.service.replacePlugin('dynamic',await replacement(f,source.replace('let undo',"ctx.tools.register(tool('late',async ()=>'startup'))\n let undo")))
  expect(f.registry.has('dynamic.late')).toBe(false)
  expect(f.registry.get('dynamic.control')).toBe(peer)
  await expect(revoked!.handler({}, {caller} as never)).rejects.toThrow(/grant|authoriz/)
 }finally{barrier.mockRestore();await f.close()}
})

it('finalizeCommit snapshot publication failures retain a diagnostic and allow later retry', async()=>{
 const f=await fixture()
 const finalize=ProcessExtensionHost.prototype.finalizeCommit
 const register=f.registry.register.bind(f.registry)
 const barrier=vi.spyOn(ProcessExtensionHost.prototype,'finalizeCommit').mockImplementation(async function(this: ProcessExtensionHost, packageName){
  await f.invoke('control',{op:'add'})
  f.registry.register=((definition)=>{
   if(definition.descriptor.id==='dynamic.late') throw new Error('finalization publication failure')
   return register(definition)
  }) as typeof f.registry.register
  return finalize.call(this,packageName)
 })
 try {
  await f.service.replacePlugin('dynamic',await replacement(f))
  expect((await f.service.list())[0]?.diagnostic).toMatch(/finalization publication failure/)
  expect(f.registry.has('dynamic.late')).toBe(false)
  f.registry.register=register
  await f.invoke('control',{op:'duplicate'})
  expect((await f.invoke('late')).output).toBe('first')
 }finally{barrier.mockRestore();f.registry.register=register;await f.close()}
})

it('rollback release reconciles the restored generation rather than deferred candidate notifications', async()=>{
 const f=await fixture()
 const barrier=vi.spyOn(ProcessExtensionHost.prototype,'finalizeCommit').mockImplementation(async()=>{
  await f.invoke('control',{op:'add'})
  f.contracts.set('dynamic',f.contract)
  throw new Error('finalization rejected')
 })
 try {
  await expect(f.service.replacePlugin('dynamic',await replacement(f))).rejects.toThrow(/finalization rejected/)
  expect(f.registry.has('dynamic.late')).toBe(false)
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
  await f.invoke('control',{op:'add'})
  expect((await f.invoke('late')).output).toBe('first')
 }finally{barrier.mockRestore();await f.close()}
})

it('failed rollback generation stays non-active and unpublished until real cleanup retry', async()=>{
 const f=await fixture(source+`
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
export async function deactivate() {
 const marker=new URL('./cleanup-attempts',import.meta.url)
 const attempts=existsSync(marker) ? Number(readFileSync(marker,'utf8'))+1 : 1
 writeFileSync(marker,String(attempts))
 if(attempts===1) throw new Error('real old cleanup failure')
}
`)
 const saved=f.registry.get('dynamic.control')!
 const generation=(await f.service.list())[0]!.generation
 const finalize=ProcessExtensionHost.prototype.finalizeCommit
 const rollback=ProcessExtensionHost.prototype.rollbackCommitted
 let host: ProcessExtensionHost | undefined
 let owner: ReturnType<ProcessExtensionHost['runtime']>
 const finalizeSpy=vi.spyOn(ProcessExtensionHost.prototype,'finalizeCommit').mockImplementation(async function(this:ProcessExtensionHost,name){
  try {return await finalize.call(this,name)}
  catch(error) {
   // Restore the old exact-version Host approval, not the failed runner's admission fence.
   f.contracts.set('dynamic',f.contract)
   throw error
  }
 })
 const rollbackSpy=vi.spyOn(ProcessExtensionHost.prototype,'rollbackCommitted').mockImplementation(async function(this:ProcessExtensionHost,name){
  const result=await rollback.call(this,name)
  host=this
  owner=this.runtime(name)
  return result
 })
 try {
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
  await expect(f.service.replacePlugin('dynamic',await replacement(f))).rejects.toThrow(/real old cleanup failure/)
  expect(owner?.snapshot.state).toBe('failed')
  expect(owner?.snapshot.generation).toBe(generation)
  expect(readFileSync(join(f.dir,'cleanup-attempts'),'utf8')).toBe('1')
  await expect(saved.handler({op:'noop'},{caller} as never)).rejects.toThrow()
  await expect(f.invoke('control',{op:'noop'})).rejects.toThrow()
  const summary=(await f.service.list())[0]!
  expect.soft(summary.activationState).toBe('failed')
  expect(summary.status).toBe('invalid')
  expect(summary.diagnostic).toMatch(/real old cleanup failure/)
  expect(summary.generation).toBe(generation)
  expect(summary.version).toBe('1.0.0')
  expect.soft(f.broker.discover(caller)).toEqual(f.hostBaseline)
  expect.soft(f.registry.has('dynamic.control')).toBe(false)
  // The actual failed owner remains reachable and the public disable retries child cleanup.
  expect(host?.runtime('dynamic')).toBe(owner)
  const disabled=await f.service.setEnabled('dynamic',false)
  expect(readFileSync(join(f.dir,'cleanup-attempts'),'utf8')).toBe('2')
  expect(owner?.snapshot.state).toBe('disposed')
  expect(host?.runtime('dynamic')).toBeUndefined()
  expect(disabled.activationState).toBe('disposed')
  expect(f.broker.discover(caller)).toEqual(f.hostBaseline)
  await expect(f.invoke('control',{op:'noop'})).rejects.toThrow()
 } finally {finalizeSpy.mockRestore();rollbackSpy.mockRestore();await f.close()}
})

it('unknown dynamic tools fail closed without interrupting approved tools', async()=>{
 const f = await fixture()
 try {
  await f.invoke('control',{op:'unknown'})
  expect((await f.invoke('control',{op:'noop'})).output).toBe('ok')
  expect(f.broker.discover(caller).map(d=>d.id)).toEqual(['dynamic.control', ...f.hostBaseline.map(d=>d.id)])
  await expect(f.invoke('unknown')).rejects.toThrow()
 } finally {await f.close()}
})
