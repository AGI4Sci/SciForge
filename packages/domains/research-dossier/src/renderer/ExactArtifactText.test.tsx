import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { ExactArtifactText } from './ExactArtifactText'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'

function fixture(text: string, versionId = 'artifact-version:a') {
  const bytes = Buffer.from(text), ref: ArtifactVersionRefV1 = {artifactId:'artifact:a',versionId,contentDigest:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,mediaType:'text/plain',retention:'snapshot',availability:'available',accessPolicy:{visibility:'workspace',principals:[],allowExport:false}}
  return {ref,value:{ref,artifact:{artifactId:ref.artifactId},version:{versionId,artifactId:ref.artifactId},dataBase64:bytes.toString('base64')}}
}
async function mount() {
  const window = new Window(), saved = new Map<string, PropertyDescriptor | undefined>()
  for (const [name,value] of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})) {saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value})}
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
  const render=async(element:React.ReactElement)=>{await act(async()=>{root.render(element)});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30))})}
  return {container,render,close:async()=>{await act(async()=>root.unmount());window.close();for(const [name,descriptor] of saved) {if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name)}}}

}

test('authorized exact text is inert and bounded; no receipt or other write is requested',async()=>{
  const f=fixture('<script>alert(1)</script>\n阴性结果仍保留。'),calls:unknown[]=[]
  const client={readArtifactVersion:async(...args:unknown[])=>{calls.push(args);return {ok:true,value:f.value}}} as never
  const m=await mount();try{await m.render(<ExactArtifactText reference={f.ref} client={client} workspaceRoot="/science" active />)
    assert.match(m.container.textContent!,/阴性结果仍保留/);assert.equal(m.container.querySelector('script'),null)
    assert.deepEqual(calls, [['/science',{versionId:f.ref.versionId,expectedRef:f.ref,maxBytes:256*1024}]])
  }finally{await m.close()}
})

test('late old version and revoked authority cannot replace current material text',async()=>{
  const first=fixture('旧内容'),second=fixture('当前内容','artifact-version:b');let finish!:(value:unknown)=>void
  const client={readArtifactVersion:async(_workspace:unknown,input:{versionId:string})=>input.versionId===first.ref.versionId?new Promise(resolve=>{finish=resolve}):{ok:true,value:second.value}} as never
  const m=await mount();try{await m.render(<ExactArtifactText reference={first.ref} client={client} workspaceRoot="/science" active />)
    await m.render(<ExactArtifactText reference={second.ref} client={client} workspaceRoot="/science" active />)
    await act(async()=>{finish({ok:true,value:first.value});await new Promise(resolve=>setTimeout(resolve,20))})
    assert.match(m.container.textContent!,/当前内容/);assert.doesNotMatch(m.container.textContent!,/旧内容/)
    const denied={readArtifactVersion:async()=>({ok:false,issue:{message:'访问已撤回'}})} as never
    await m.render(<ExactArtifactText reference={second.ref} client={denied} workspaceRoot="/science" active />)
    assert.doesNotMatch(m.container.textContent!,/当前内容/);assert.match(m.container.textContent!,/暂时无法显示/)
  }finally{await m.close()}
})

for(const kind of ['identity','bytes','digest'] as const)test(`mismatched ${kind} content is not shown`,async()=>{
  const f=fixture('必须拒绝这段内容'),value=structuredClone(f.value)
  if(kind==='identity')value.ref.accessPolicy.allowExport=true
  if(kind==='bytes')value.dataBase64=Buffer.from('短').toString('base64')
  if(kind==='digest')value.dataBase64=Buffer.from('X'.repeat(f.ref.byteLength)).toString('base64')
  const m=await mount();try{await m.render(<ExactArtifactText reference={f.ref} client={{readArtifactVersion:async()=>({ok:true,value})} as never} workspaceRoot="/science" active />)
    assert.doesNotMatch(m.container.textContent!,/必须拒绝这段内容/);assert.match(m.container.textContent!,/暂时无法显示/)
  }finally{await m.close()}
})

test('large files are not read inline and long allowed text is explicitly an excerpt',async()=>{
  const small=fixture('有效内容'.repeat(3000)),large={...small.ref,byteLength:256*1024+1};let calls=0
  const client={readArtifactVersion:async()=>{calls++;return {ok:true,value:small.value}}} as never
  const m=await mount();try{await m.render(<ExactArtifactText reference={large} client={client} workspaceRoot="/science" active />);assert.equal(calls,0);assert.match(m.container.textContent!,/较大/)
    await m.render(<ExactArtifactText reference={small.ref} client={client} workspaceRoot="/science" active />);assert.equal(calls,1);assert.match(m.container.textContent!,/内容节选/)
    await m.render(<ExactArtifactText reference={small.ref} client={client} workspaceRoot="/science" active={false} />);assert.equal(m.container.textContent,'')
  }finally{await m.close()}
})

