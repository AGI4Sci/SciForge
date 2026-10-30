import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProcessExtensionHost, type ProcessExtensionRuntime } from './process-extension-host.js'

const source = `
import {defineTool} from '@deepseek-ai/dsh-tools'
export const inject=['tools']
export function apply(ctx){
 let registered=false
 const tool=(name)=>defineTool({name,description:name,parameters:{},output:{schema:{type:'string'},render:()=>[]},execute:async()=>name})
 ctx.tools.register(tool('initial'))
 ctx.tools.register(defineTool({name:'control',description:'control',parameters:{},output:{schema:{type:'string'},render:()=>[]},execute:async()=>{if(registered) ctx.emit('tools/change');else {ctx.tools.register(tool('late'));registered=true}return 'ok'}}))
}
`
const grants={initial:{id:'dynamic.initial',effect:'compute' as const},control:{id:'dynamic.control',effect:'compute' as const},late:{id:'dynamic.late',effect:'compute' as const}}
test('stale snapshot revisions and wrong generation messages cannot replace current tools',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-stale-snapshot-'))
 const host=new ProcessExtensionHost({resolveDshToolGrants:()=>grants})
 try {
  const entryPath=join(root,'main.mjs')
  await writeFile(entryPath,source.replace("if(registered) ctx.emit('tools/change');else {ctx.tools.register(tool('late'));registered=true}return 'ok'","process.send({type:'capabilities',generation:Number(process.argv[3])+1,revision:999,descriptors:[]});process.send({type:'capabilities',generation:Number(process.argv[3]),revision:0,descriptors:[]});return 'ok'"))
  await host.replace({entryPath,pluginId:'dynamic',packageName:'dynamic',version:'1.0.0'})
  const runtime=host.runtime('dynamic')!
  await runtime.invoke('dynamic.control',{})
  assert.deepEqual(runtime.snapshot.capabilityIds,['dynamic.initial','dynamic.control'])
 }finally{await host.disposeAll();await rm(root,{recursive:true,force:true})}
})

test('duplicate IDs in dynamic snapshots fail closed with an explicit diagnostic',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-duplicate-snapshot-'))
 const host=new ProcessExtensionHost({resolveDshToolGrants:()=>grants})
 try {
  const entryPath=join(root,'main.mjs')
  const descriptor={contractVersion:3,id:'duplicate.id',version:'1',title:'control',description:'control',audiences:['agent','ui'],scope:'global',resourceKinds:[],effect:'compute',approval:'none',concurrency:{revision:'none',idempotency:'required'},inputSchema:{type:'object'},outputSchema:{type:'string'},tags:['dsh-tool'],runtimeRevision:1}
  const descriptors=[{...descriptor,id:'dynamic.initial',title:'initial'},descriptor,descriptor]
  await writeFile(entryPath,source.replace("if(registered) ctx.emit('tools/change');else {ctx.tools.register(tool('late'));registered=true}return 'ok'",`process.send({type:'capabilities',generation:Number(process.argv[3]),revision:999,descriptors:${JSON.stringify(descriptors)}});return 'ok'`))
  await host.replace({entryPath,pluginId:'dynamic',packageName:'dynamic',version:'1.0.0'})
  const runtime=host.runtime('dynamic')!
  await runtime.invoke('dynamic.control',{})
  assert.equal(runtime.snapshot.capabilityIds.includes('duplicate.id'),false)
  assert.deepEqual(runtime.snapshot.capabilityIds,['dynamic.initial'])
  assert.match(runtime.snapshot.diagnostics?.join(';') ?? '',/duplicate|invalid/i)
 }finally{await host.disposeAll();await rm(root,{recursive:true,force:true})}
})

test('late capability notifications after failure cannot republish a runtime',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-late-failed-'))
 const publications: ProcessExtensionRuntime[]=[]
 const host=new ProcessExtensionHost({resolveDshToolGrants:()=>grants,onCapabilitiesChanged:r=>publications.push(r)})
 try {
  const entryPath=join(root,'main.mjs')
  const descriptor={contractVersion:3,id:'dynamic.initial',version:'1',title:'initial',description:'initial',audiences:['agent','ui'],scope:'global',resourceKinds:[],effect:'compute',approval:'none',concurrency:{revision:'none',idempotency:'required'},inputSchema:{type:'object'},outputSchema:{type:'string'},tags:['dsh-tool'],runtimeRevision:1}
  const body=`process.send({type:'crash',error:{message:'synthetic crash'}});process.send({type:'capabilities',generation:Number(process.argv[3]),revision:999,descriptors:[${JSON.stringify(descriptor)}]});setImmediate(()=>process.exit(1));return 'ok'`
  await writeFile(entryPath,source.replace("if(registered) ctx.emit('tools/change');else {ctx.tools.register(tool('late'));registered=true}return 'ok'",body))
  await host.replace({entryPath,pluginId:'dynamic',packageName:'dynamic',version:'1.0.0'})
  const runtime=host.runtime('dynamic')!
  await assert.rejects(runtime.invoke('dynamic.control',{}),/synthetic crash/)
  // Exit follows the late message in the ordered IPC stream; wait for host exit handling.
  const deadline=Date.now()+2000
  while(runtime.snapshot.pid && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(runtime.snapshot.pid,undefined)
  assert.equal(runtime.snapshot.state,'failed')
  assert.deepEqual(runtime.snapshot.capabilityIds,[])
  assert.deepEqual(publications.at(-1)?.snapshot.capabilityIds,[])
 }finally{await host.disposeAll();await rm(root,{recursive:true,force:true})}
})

test('prepared snapshots cache changes; commit publishes current only and rollback restores previous',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-dynamic-host-'))
 const publications: ProcessExtensionRuntime[]=[]
 const host=new ProcessExtensionHost({resolveDshToolGrants:()=>grants,onCapabilitiesChanged:r=>publications.push(r)})
 try {
  const entryPath=join(root,'main.mjs');await writeFile(entryPath,source)
  const options={entryPath,pluginId:'dynamic',packageName:'dynamic',version:'1.0.0'}
  await host.prepare(options)
  const first=host.pending('dynamic')!
  await first.invoke('dynamic.control',{})
  assert.deepEqual(first.snapshot.capabilityIds,['dynamic.initial','dynamic.control','dynamic.late'])
  assert.equal(publications.length,0)
  await host.commit('dynamic')
  assert.equal(publications.at(-1),first)
  await host.prepare(options)
  const candidate=host.pending('dynamic')!
  await candidate.invoke('dynamic.control',{})
  assert.equal(publications.at(-1),first)
  await host.commit('dynamic')
  assert.equal(publications.at(-1),candidate)
  const committedPublications=publications.length
  await first.invoke('dynamic.control',{})
  assert.equal(publications.length,committedPublications)
  assert.equal(host.runtime('dynamic'),candidate)
  await host.rollbackCommitted('dynamic')
  assert.equal(publications.at(-1),first)
 }finally{await host.disposeAll();await rm(root,{recursive:true,force:true})}
})
