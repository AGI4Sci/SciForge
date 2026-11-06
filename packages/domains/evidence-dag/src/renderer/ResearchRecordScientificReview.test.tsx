import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { ResearchRecordScientificReview } from './ResearchRecordScientificReview'
import { researchAuditEvidenceAuditQueryOutputSchema } from '@sciforge/domain-sdk/research-audit'
import type { ResearchRecordView } from '../research-record-contract'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

test('exact scientific review rejects mismatched subjects and isolates revision, session and inactive reads', async () => {
 const browser = new Window()
 for (const name of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'] as const) Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?browser:browser[name]})
 Object.assign(globalThis,{React,IS_REACT_ACT_ENVIRONMENT:true})
 const scope={runtimeId:'codex',threadId:'first',workspaceRoot:'/isolated'}
 const ref={artifactId:'artifact:one',versionId:'artifact-version:one',contentDigest:'a'.repeat(64),byteLength:9,availability:'available' as const,retention:'reference' as const,accessPolicy:{visibility:'workspace' as const,principals:[],allowExport:false}}
 const makeView=(revision=1)=>({revision,node:{id:'selected-record'},auditReferences:{refs:[ref],limited:false},synthesisImpact:[]}) as unknown as ResearchRecordView
 const response=(subjectRef:typeof ref,marker:string)=>researchAuditEvidenceAuditQueryOutputSchema.parse({subject:{artifactVersionRef:subjectRef},records:[],completeness:{complete:false,gapCodes:[]},freshness:'fresh',source:'evidence-dag',scientificReview:{coverage:'recorded-links-only',bounded:false,impacts:[],conditions:['independence','controls','negative-results','reproduction','scope'].map(axis=>({axis,status:axis==='controls'?'recorded':'unknown',observations:axis==='controls'?[{digest:'sha256:'+'b'.repeat(64),field:'controls',text:marker,targetId:'claim:one',recordDigest:'sha256:'+'c'.repeat(64),closureDigest:'sha256:'+'d'.repeat(64)}]:[]}))}})
 type Root = ReturnType<typeof createRoot>
 async function probe(name:string,fn:(mounted:Root,container:HTMLDivElement)=>Promise<{pass:boolean}>) {
  const container=document.createElement('div');document.body.append(container);const mounted=createRoot(container)
  try{assert.equal((await fn(mounted,container)).pass,true,name)}finally{await act(async()=>mounted.unmount());container.remove()}
 }
 function render(mounted:Root,props:Record<string,unknown>){return act(async()=>mounted.render(React.createElement(ResearchRecordScientificReview,{view:makeView(),scope,invoker:{invoke:async()=>response(ref,'')} as unknown as DomainRendererCapabilityInvoker,...props})))}
 try {
await probe('reject-schema-valid-wrong-exact-subject',async(mounted,container)=>{
 const invoker={invoke:async()=>response({...ref,artifactId:'artifact:other',versionId:'artifact-version:other',contentDigest:'e'.repeat(64)},'WRONG_SUBJECT_MUST_NEVER_DISPLAY')};
 await render(mounted,{invoker});
 return {pass:!container.textContent.includes('WRONG_SUBJECT_MUST_NEVER_DISPLAY')&&Boolean(container.querySelector('[role=alert]')),text:container.textContent};
});
await probe('cancel-late-result-on-same-workspace-session-change',async(mounted,container)=>{
 let resolveFirst!: (value: unknown) => void;let calls=0;const pending=new Promise(resolve=>resolveFirst=resolve);
 const invoker={invoke:async()=>++calls===1?pending:response(ref,'NEW_SESSION_RESULT')};
 await render(mounted,{invoker});
 await render(mounted,{invoker,scope:{...scope,threadId:'second'}});
 await act(async()=>resolveFirst(response(ref,'OLD_SESSION_RESULT')));
 return {pass:!container.textContent.includes('OLD_SESSION_RESULT')&&calls>=2,calls,text:container.textContent};
});
await probe('refresh-review-on-record-revision',async(mounted,container)=>{
 let calls=0;const invoker={invoke:async()=>response(ref,++calls===1?'OLD_REVIEW':'NEW_REVIEW')};
 await render(mounted,{invoker});await render(mounted,{invoker,view:makeView(2)});
 return {pass:calls>=2&&container.textContent.includes('NEW_REVIEW')&&!container.textContent.includes('OLD_REVIEW'),calls,text:container.textContent};
});
await probe('inactive-component-does-not-query',async(mounted,container)=>{
 let calls=0;await render(mounted,{active:false,invoker:{invoke:async()=>{calls++;return response(ref,'HIDDEN_RESULT')}}});
 return {pass:calls===0,calls,text:container.textContent};
});
await probe('denied-response-clears-old-review',async(mounted,container)=>{
 let calls=0;const invoker={invoke:async()=>{if(++calls>1)throw new Error('access-restricted');return response(ref,'OLD_REVIEW')}};
 await render(mounted,{invoker});await render(mounted,{invoker,view:{...makeView(2),auditReferences:{refs:[{...ref,versionId:'artifact-version:next'}],limited:false}}});
 return {pass:!container.textContent.includes('OLD_REVIEW')&&Boolean(container.querySelector('[role=alert]')),calls,text:container.textContent};
});

 } finally { browser.close() }
})
