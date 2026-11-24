import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES, DELIVERY_MAX_TOTAL_BYTES } from '@sciforge/collaboration-contracts'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import { DeliveryMaterialPicker } from './DeliveryMaterialPicker.js'
import { useWorkerDeliveryDraft } from '../use-worker-delivery-draft.js'
import type { CollaborationRendererClient } from '../../collaboration-capability-client.js'
import { DeliveryDraft } from './DeliveryDraft.js'
import { TaskDrawer } from './TaskDrawer.js'
import type { TaskCardModel } from '../workspace-types.js'
import type { WorkerDeliveryView } from '../../../worker-delivery.js'
import type { DeliveryDraftData, DeliveryDraftFile } from './delivery-draft-types.js'
import { deliveryLimitError } from './DeliveryContent.js'
const browser=new Window({url:'https://sciforge.test/'})
const descriptors=new Map<string,PropertyDescriptor|undefined>()
before(()=>{
 const globals:Record<string,unknown>={window:browser,self:browser,document:browser.document,navigator:browser.navigator,Node:browser.Node,Element:browser.Element,HTMLElement:browser.HTMLElement,HTMLInputElement:browser.HTMLInputElement,HTMLTextAreaElement:browser.HTMLTextAreaElement,HTMLButtonElement:browser.HTMLButtonElement,SVGElement:browser.SVGElement,Event:browser.Event,KeyboardEvent:browser.KeyboardEvent,FocusEvent:browser.FocusEvent,MutationObserver:browser.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true}
 for(const [key,value]of Object.entries(globals)){descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value})}
})
after(()=>{for(const[key,value]of descriptors){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key)}browser.close()})
const output:DeliveryDraftFile={id:'output',name:'README.md',relativePath:'README.md',mediaType:'text/markdown',byteCount:1024,source:'ai'}
const attachment:DeliveryDraftFile={id:'attachment',name:'sample.csv',relativePath:'uploads/sample.csv',mediaType:'text/csv',byteCount:1024,source:'attachment'}
const member:DeliveryDraftFile={id:'member',name:'notes.pdf',relativePath:'notes.pdf',mediaType:'application/pdf',byteCount:2048,source:'member'}
const data:DeliveryDraftData={revision:1,summary:'成员撰写的说明',state:'ready',declaredFiles:[output],additionalFiles:[],source:{round:3,finishedAt:'2026-10-21T02:20:00.000Z'}}
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0))
async function mount(element:React.ReactElement){const {createRoot}=await import('react-dom/client');const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>{root.render(element);await tick()});return{container,rerender:async(next:React.ReactElement)=>{await act(async()=>{root.render(next);await tick()})},unmount:async()=>{await act(async()=>{root.unmount();await tick()});container.remove()}}}
function byTest<T extends HTMLElement=HTMLButtonElement>(container:HTMLElement,id:string):T{const element=container.querySelector(`[data-testid="${id}"]`);assert.ok(element,`missing ${id}`);return element as T}
async function click(element:HTMLElement){await act(async()=>{element.click();await tick()})}
async function setValue(element:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value')?.set?.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));await tick()})}

const drawerCard: TaskCardModel = { id: 'tsk_picker', projectId: 'prj_picker', executionId: 'exe_picker', executionState: 'running', reference: '#1', moduleType: '任务', title: '交付', assignee: '执行成员', assigneeUserId: 'usr_picker', date: '', status: 'in-progress', stateLabel: '待提交交付' }
function draftView(revision = 1, resultRevision = 2): WorkerDeliveryView {
 return { projectId: 'prj_picker', taskId: drawerCard.id, executionId: drawerCard.executionId!, state: 'waiting_confirmation', draft: { revision, resultRevision, basedOnResultRevision: 1, summary: data.summary, aiSummary: null, summaryEdited: false, sourceTurnId: null, sourceRound: 0, sourceUpdatedAt: null, updatedAt: '2026-11-14T03:00:00.000Z', changed: false, outputs: [], selectedMaterials: [], materialError: null }, confirmationTarget: null, history: [], candidate: null, operationId: null, deliveryManifestId: null, error: null, residuals: [] }
}

test('mounted drawer preserves the required file chooser and authored summary across same-result refresh and transient busy', async () => {
 let uploads = 0, replacements = 0
 const render = (view: WorkerDeliveryView, busy = false) => <TaskDrawer card={drawerCard} currentUserId={drawerCard.assigneeUserId} projectName="交付" delivery={view} deliveryDetail={{ ...data, revision: view.draft!.resultRevision }} busy={busy} materialSelection={{ files: [member], onUpload: async () => { uploads++; return [{ ...member, name: 'notes.md', mediaType: 'text/markdown' }] } }} onDeclaredMaterialChange={() => { replacements++ }} onSubmitDelivery={() => undefined} />
 const mounted = await mount(render(draftView()))
 try {
  const summary = byTest<HTMLTextAreaElement>(mounted.container, 'delivery-summary')
  await setValue(summary, '尚未保存的成员说明')
  await click(byTest(mounted.container, 'delivery-declared-replace'))
  const picker = byTest(mounted.container, 'delivery-material-picker')
  await mounted.rerender(render(draftView(2)))
  assert.equal(byTest(mounted.container, 'delivery-material-picker'), picker)
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container, 'delivery-summary'), summary)
  assert.equal(summary.value, '尚未保存的成员说明')
  await click(byTest(mounted.container, 'delivery-material-upload-tab'))
  const input = byTest<HTMLInputElement>(mounted.container, 'delivery-material-file-input')
  let chooserOpened = 0
  input.addEventListener('click', () => { chooserOpened++ })
  await click(byTest(mounted.container, 'delivery-material-upload'))
  assert.equal(chooserOpened, 1)
  await mounted.rerender(render(draftView(3), true))
  assert.equal(byTest(mounted.container, 'delivery-material-picker'), picker)
  assert.equal(byTest<HTMLInputElement>(mounted.container, 'delivery-material-file-input'), input)
  assert.equal(byTest(mounted.container, 'delivery-material-upload').matches(':disabled'), true)
  assert.equal(byTest(mounted.container, 'delivery-material-confirm').matches(':disabled'), true)
  await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [new browser.File(['notes'], 'notes.md', { type: 'text/markdown' })] }); input.dispatchEvent(new Event('change', { bubbles: true })); await tick() })
  assert.equal(uploads, 0)
  assert.equal(replacements, 0)
  await mounted.rerender(render(draftView(4)))
  assert.equal(byTest<HTMLInputElement>(mounted.container, 'delivery-material-file-input'), input)
  await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [new browser.File(['notes'], 'notes.md', { type: 'text/markdown' })] }); input.dispatchEvent(new Event('change', { bubbles: true })); await tick() })
  assert.equal(uploads, 1)
  await click(byTest(mounted.container, 'delivery-material-confirm'))
  assert.equal(replacements, 1)
 } finally { await mounted.unmount() }
})

test('mounted drawer resets chooser and authored summary for a new result or execution', async () => {
 const render = (view: WorkerDeliveryView, card = drawerCard) => <TaskDrawer card={card} currentUserId={card.assigneeUserId} projectName="交付" delivery={view} deliveryDetail={{ ...data, revision: view.draft!.resultRevision }} materialSelection={{ files: [member] }} onDeclaredMaterialChange={() => undefined} onSubmitDelivery={() => undefined} />
 const mounted = await mount(render(draftView()))
 try {
  for (const next of [draftView(2, 3), { ...draftView(1, 3), executionId: 'exe_next' }]) {
   await setValue(byTest<HTMLTextAreaElement>(mounted.container, 'delivery-summary'), '旧结果说明')
   await click(byTest(mounted.container, 'delivery-declared-replace'))
   await mounted.rerender(render(next, { ...drawerCard, executionId: next.executionId }))
   assert.equal(mounted.container.querySelector('[data-testid="delivery-material-picker"]'), null)
   assert.equal(byTest<HTMLTextAreaElement>(mounted.container, 'delivery-summary').value, data.summary)
  }
 } finally { await mounted.unmount() }
})

test('frozen submission clears the picker intent instead of reopening it after unlock', async () => {
 const render = (editLocked: boolean) => <DeliveryDraft data={{ ...data, editLocked }} materialSelection={{ files: [member] }} onDeclaredMaterialChange={() => undefined} onSubmit={() => undefined} />
 const mounted = await mount(render(false))
 try {
  await click(byTest(mounted.container, 'delivery-declared-replace'))
  await mounted.rerender(render(true))
  assert.equal(mounted.container.querySelector('[data-testid="delivery-material-picker"]'), null)
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container, 'delivery-summary').disabled, true)
  await mounted.rerender(render(false))
  assert.equal(mounted.container.querySelector('[data-testid="delivery-material-picker"]'), null)
 } finally { await mounted.unmount() }
})

test('picker searches task files, prioritizes attachments and commits an explicit selection',async()=>{
 const mounted=await mount(<DeliveryDraft data={data} materialSelection={{files:[member,output,attachment]}} onContinue={()=>undefined} onSubmit={()=>undefined}/> )
 try{
  await click(byTest(mounted.container,'delivery-add-materials'))
  const options=byTest(mounted.container,'delivery-material-options');assert.match(options.querySelector('li')?.textContent??'',/sample.csv/u);assert.doesNotMatch(options.textContent??'',/README.md/u)
  await setValue(byTest<HTMLInputElement>(mounted.container,'delivery-material-search'),'notes')
  assert.equal(byTest(mounted.container,'delivery-material-options').querySelectorAll('li').length,1)
  await click(byTest(mounted.container,'delivery-material-checkbox'));await click(byTest(mounted.container,'delivery-material-confirm'))
  assert.equal(mounted.container.querySelector('[role="dialog"]'),null)
  assert.match(byTest(mounted.container,'delivery-additional-files').textContent??'',/notes.pdf.*成员添加/su)
  await click(byTest(mounted.container,'delivery-file-remove'))
  assert.match(byTest(mounted.container,'delivery-materials-empty').textContent??'',/还没有附加资料/u)
 }finally{await mounted.unmount()}
})

test('uploaded files use the supplied import callback and are selected automatically',async()=>{
 let uploads=0
 const mounted=await mount(<DeliveryDraft data={data} materialSelection={{files:[output],onUpload:async()=>{uploads++;return[member]}}} onSubmit={()=>undefined}/> )
 try{
  await click(byTest(mounted.container,'delivery-add-materials'));await click(byTest(mounted.container,'delivery-material-upload-tab'));await click(byTest(mounted.container,'delivery-material-upload'))
  const input=byTest<HTMLInputElement>(mounted.container,'delivery-material-file-input')
  await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[new browser.File(['notes'],'notes.pdf',{type:'application/pdf'})]});input.dispatchEvent(new Event('change',{bubbles:true}));await tick()})
  assert.equal(uploads,1);assert.match(byTest(mounted.container,'delivery-material-upload-complete').textContent??'',/已上传并勾选 1 项/u)
  await click(byTest(mounted.container,'delivery-material-confirm'));assert.match(byTest(mounted.container,'delivery-additional-files').textContent??'',/notes.pdf/u)
 }finally{await mounted.unmount()}
})

test('required ZIP picker accepts import while the additional picker does not advertise ZIP',async()=>{
 let uploads=0
 const zip={...output,id:'zip',name:'required.zip',relativePath:'required.zip',mediaType:'application/zip',maxBytes:20*1024*1024}
 const mounted=await mount(<DeliveryMaterialPicker requiredOutput={zip} declaredFiles={[]} additionalFiles={[]} selection={{files:[],onUpload:async()=>{uploads++;return[zip]}}} onConfirm={()=>undefined} onClose={()=>undefined}/>)
 try{
  await click(byTest(mounted.container,'delivery-material-upload-tab'))
  const input=byTest<HTMLInputElement>(mounted.container,'delivery-material-file-input')
  assert.match(input.accept,/application\/zip/u)
  await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[new browser.File(['PK'],'required.zip',{type:'application/zip'})]});input.dispatchEvent(new Event('change',{bubbles:true}));await tick()})
  assert.equal(uploads,1)
 }finally{await mounted.unmount()}
})

test('additional ZIP is rejected before invoking the import callback',async()=>{
 let uploads=0
 const mounted=await mount(<DeliveryDraft data={data} materialSelection={{files:[output],onUpload:async()=>{uploads++;return[]}}} onSubmit={()=>undefined}/>)
 try{
  await click(byTest(mounted.container,'delivery-add-materials'));await click(byTest(mounted.container,'delivery-material-upload-tab'))
  const file=new browser.File(['PK'],'large.zip',{type:'application/zip'})
  Object.defineProperty(file,'size',{value:DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES+1})
  const input=byTest<HTMLInputElement>(mounted.container,'delivery-material-file-input')
  await act(async()=>{Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));await tick()})
  assert.equal(uploads,0)
  assert.match(mounted.container.textContent??'',/附加资料不支持 ZIP/u)
 }finally{await mounted.unmount()}
})

test('submission confirmation preserves edits, traps keyboard focus and restores it on cancellation',async()=>{
 const calls:unknown[]=[]
 const mounted=await mount(<DeliveryDraft data={{...data,additionalFiles:[attachment]}} materialSelection={{files:[output,attachment]}} onSubmit={(summary,files)=>{calls.push({summary,files})}}/> )
 try{
  await setValue(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary'),'我确认的最终说明')
  const trigger=byTest(mounted.container,'delivery-submit');trigger.focus();await click(trigger)
  const dialog=byTest(mounted.container,'delivery-submit-confirmation');assert.match(dialog.textContent??'',/我确认的最终说明.*README.md.*AI 产出.*sample.csv.*会话附件/su)
  assert.equal(dialog.querySelectorAll('[data-testid="delivery-confirm-file"]').length,2)
  const cancel=byTest(mounted.container,'delivery-submit-cancel');const confirm=byTest(mounted.container,'delivery-submit-confirm')
  assert.equal(document.activeElement,cancel)
  confirm.focus();await act(async()=>{confirm.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));await tick()});assert.equal(document.activeElement,cancel)
  await act(async()=>{cancel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick()})
  assert.equal(mounted.container.querySelector('[role="dialog"]'),null);assert.equal(document.activeElement,trigger);assert.equal(calls.length,0)
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,'我确认的最终说明')
 }finally{await mounted.unmount()}
})

test('confirmation without material selection contains only supported files and adaptive bytes',async()=>{
 const smallOutput={...output,byteCount:152}
 const submissions:unknown[]=[]
 const mounted=await mount(<DeliveryDraft data={{...data,declaredFiles:[smallOutput],additionalFiles:[attachment]}} onSubmit={(summary,files)=>{submissions.push({summary,files})}}/> )
 try{
  await click(byTest(mounted.container,'delivery-submit'))
  const dialog=byTest(mounted.container,'delivery-submit-confirmation')
  assert.doesNotMatch(dialog.textContent??'',/附加资料|sample.csv|200 MiB|0\.0 MB/u)
  assert.equal(dialog.querySelectorAll('[data-testid="delivery-confirm-file"]').length,1)
  assert.equal(byTest(mounted.container,'delivery-total').textContent,'共 1 项 · 152 B')
  assert.equal(dialog.querySelector('[data-testid="delivery-total"]')?.textContent,'共 1 项 · 152 B')
  await click(byTest(mounted.container,'delivery-submit-confirm'))
  assert.deepEqual(submissions,[{summary:data.summary,files:[smallOutput]}])
 }finally{await mounted.unmount()}
})

test('confirmation calls the canonical submit callback once and preserves the draft after rejection',async()=>{
 let finish:(value:boolean)=>void=()=>undefined;let calls=0
 const pending=new Promise<boolean>(resolve=>{finish=resolve})
 const mounted=await mount(<DeliveryDraft data={{...data,additionalFiles:[attachment]}} onSubmit={()=>{calls++;return pending}}/> )
 try{
  await click(byTest(mounted.container,'delivery-submit'));const confirm=byTest(mounted.container,'delivery-submit-confirm')
  await act(async()=>{confirm.click();confirm.click();await tick()});assert.equal(calls,1);assert.equal(confirm.disabled,true)
  await act(async()=>{finish(false);await tick()})
  assert.ok(byTest(mounted.container,'delivery-submit-confirmation'));assert.match(byTest(mounted.container,'delivery-submit-error').textContent??'',/草稿和所选资料已保留/u)
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,data.summary)
 }finally{await mounted.unmount()}
})

test('AI changes leave manual edits intact until the member replaces or keeps them',async()=>{
 const mounted=await mount(<DeliveryDraft data={data} onSubmit={()=>undefined}/> )
 try{
  await setValue(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary'),'我的修改')
  await mounted.rerender(<DeliveryDraft data={{...data,state:'changed',aiSummary:'AI 新说明'}} onSubmit={()=>undefined}/> )
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,'我的修改')
  await click(byTest(mounted.container,'delivery-keep-summary'));assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,'我的修改');assert.equal(mounted.container.querySelector('[data-testid="delivery-ai-update"]'),null)
  await mounted.rerender(<DeliveryDraft data={{...data,state:'changed',aiSummary:'AI 第二次新说明'}} onSubmit={()=>undefined}/> )
  await click(byTest(mounted.container,'delivery-replace-summary'));assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,'AI 第二次新说明')
 }finally{await mounted.unmount()}
})

test('AI modification invokes the existing task-session callback without submitting',async()=>{
 let opened=0,submitted=0
 const mounted=await mount(<DeliveryDraft data={data} onContinue={()=>{opened++}} onSubmit={()=>{submitted++}}/> )
 try{await click(byTest(mounted.container,'delivery-ask-ai'));assert.equal(opened,1);assert.equal(submitted,0)}finally{await mounted.unmount()}
})

test('limit checks identify the twenty-first file and the file crossing the byte limit',()=>{
 const files=Array.from({length:21},(_,index)=>({...member,id:`f${index}`,name:`file-${index}.pdf`}))
 assert.match(deliveryLimitError(files)??'',/file-20.pdf.*第 21 项/u)
 assert.match(deliveryLimitError([output,{...member,byteCount:DELIVERY_MAX_TOTAL_BYTES+1}])??'',/notes.pdf.*单文件上限/u)
 assert.equal(deliveryLimitError([output,member]),null)
 assert.match(deliveryLimitError([{...output,maxBytes:1024,byteCount:1025}])??'',/有效上限 1024 字节/u)
 assert.match(deliveryLimitError([{...output,maxBytes:1024*1024*1024,byteCount:DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES+1}])??'',new RegExp(`有效上限 ${DEFAULT_DELIVERY_ADMISSION_MAX_FILE_BYTES} 字节`, 'u'))
})

test('file information has two rows without repeating a root filename or exposing attachment paths',async()=>{
 const hiddenAttachment={...attachment,relativePath:'.attachments/internal-session-token/sample.csv'}
 const nestedMember={...member,relativePath:'research/notes.pdf'}
 const mounted=await mount(<DeliveryDraft data={{...data,additionalFiles:[hiddenAttachment,nestedMember]}} materialSelection={{files:[output,hiddenAttachment,nestedMember]}} onSubmit={()=>undefined}/>)
 try{
  const information=Array.from(mounted.container.querySelectorAll('.collaboration-workspace-delivery-file-info'))
  assert.equal(information.length,3)
  for(const info of information)assert.equal(info.children.length,2)
  assert.equal((information[0].textContent?.match(/README.md/gu)??[]).length,1)
  assert.match(information[2].children[1].textContent??'',/research\/notes.pdf · application\/pdf · 2.0 KB/u)
  assert.doesNotMatch(mounted.container.innerHTML,/internal-session-token|\.attachments\//u)
  await click(byTest(mounted.container,'delivery-add-materials'))
  const picker=byTest(mounted.container,'delivery-material-picker')
  for(const info of picker.querySelectorAll('.collaboration-workspace-delivery-file-info'))assert.equal(info.children.length,2)
  assert.doesNotMatch(picker.innerHTML,/internal-session-token|\.attachments\//u)
 }finally{await mounted.unmount()}
})

test('material picker provides one explicit cancellation action and retains keyboard dismissal',async()=>{
 const mounted=await mount(<DeliveryDraft data={data} materialSelection={{files:[output,attachment]}} onSubmit={()=>undefined}/>)
 try{
  const trigger=byTest(mounted.container,'delivery-add-materials');trigger.focus();await click(trigger)
  const picker=byTest(mounted.container,'delivery-material-picker')
  assert.equal(Array.from(picker.querySelectorAll('button')).filter(button=>['取消','关闭'].includes(button.textContent??'')).length,1)
  assert.equal(picker.querySelector('[data-testid="delivery-material-picker-close"]'),null)
  await act(async()=>{picker.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick()})
  assert.equal(mounted.container.querySelector('[data-testid="delivery-material-picker"]'),null)
  assert.equal(document.activeElement,trigger)
 }finally{await mounted.unmount()}
})

test('AI summary decisions persist keep and replacement through their explicit callbacks',async()=>{
 const decisions:unknown[]=[]
 const handlers={onSubmit:()=>undefined,onSummaryChange:(summary:string)=>{decisions.push(['summary',summary])},onAiSummaryDecision:(decision:'replace'|'keep',summary:string)=>{decisions.push([decision,summary])}}
 const mounted=await mount(<DeliveryDraft data={{...data,state:'changed',aiSummary:'AI 第一次新说明'}} {...handlers}/>)
 try{
  await click(byTest(mounted.container,'delivery-keep-summary'))
  assert.deepEqual(decisions,[['keep',data.summary]])
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,data.summary)
  await mounted.rerender(<DeliveryDraft data={{...data,state:'changed',aiSummary:'AI 第二次新说明'}} {...handlers}/>)
  await click(byTest(mounted.container,'delivery-replace-summary'))
  assert.deepEqual(decisions,[['keep',data.summary],['summary','AI 第二次新说明'],['replace','AI 第二次新说明']])
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').value,'AI 第二次新说明')
 }finally{await mounted.unmount()}
})

test('a failed approved submission locks editing while preserving the canonical retry action',async()=>{
 const submissions:unknown[]=[]
 let finish:(value:boolean)=>void=()=>undefined
 const pending=new Promise<boolean>(resolve=>{finish=resolve})
 const mounted=await mount(<DeliveryDraft data={{...data,state:'failed',editLocked:true,submitError:'文件上传暂时失败，请再次提交。',aiSummary:'待处理的新说明',additionalFiles:[attachment]}} materialSelection={{files:[output,attachment]}} onContinue={()=>undefined} onPreview={()=>undefined} onSubmit={(summary,files)=>{submissions.push({summary,files});return pending}}/>)
 try{
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').disabled,true)
  for(const id of ['delivery-ask-ai','delivery-replace-summary','delivery-keep-summary','delivery-add-materials','delivery-file-remove'])assert.equal(byTest(mounted.container,id).disabled,true,id)
  for(const button of mounted.container.querySelectorAll<HTMLButtonElement>('[data-testid="delivery-file-preview"]'))assert.equal(button.disabled,true)
  assert.equal(byTest(mounted.container,'delivery-submit').disabled,false)
  assert.equal(byTest(mounted.container,'delivery-status').textContent,'提交失败')
  assert.match(byTest(mounted.container,'delivery-submit-error').textContent??'',/文件上传暂时失败/u)
  assert.equal(mounted.container.querySelector('[data-testid="delivery-failure"]'),null)
  await click(byTest(mounted.container,'delivery-submit'))
  await click(byTest(mounted.container,'delivery-submit-confirm'))
  assert.deepEqual(submissions,[{summary:data.summary,files:[output,attachment]}])
  assert.equal(byTest(mounted.container,'delivery-status').textContent,'提交中…')
  assert.equal(byTest(mounted.container,'delivery-submit-confirm').disabled,true)
  assert.equal(mounted.container.querySelector('[data-testid="delivery-failure"]'),null)
  await act(async()=>{finish(true);await tick()})
 }finally{await mounted.unmount()}
})

test('initial AI generation disables the summary and submission while showing progress in text',async()=>{
 const mounted=await mount(<DeliveryDraft data={{...data,summary:'',state:'generating',source:undefined}} onContinue={()=>undefined} onSubmit={()=>undefined}/>)
 try{
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').disabled,true)
  assert.equal(byTest(mounted.container,'delivery-submit').disabled,true)
  assert.equal(byTest(mounted.container,'delivery-status').textContent,'AI 正在完成任务…')
  assert.match(byTest(mounted.container,'delivery-generating').textContent??'',/AI 正在完成任务…/u)
  await mounted.rerender(<DeliveryDraft data={{...data,state:'modifying'}} onContinue={()=>undefined} onSubmit={()=>undefined}/>)
  assert.equal(byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary').disabled,false)
  assert.equal(byTest(mounted.container,'delivery-submit').disabled,true)
 }finally{await mounted.unmount()}
})


test('picker retains selected task files across distinct searches before confirmation', async () => {
 const mounted=await mount(<DeliveryDraft data={data} materialSelection={{files:[],onList:async({query})=>({files:query==='notes'?[member]:[attachment],nextCursor:null})}} onSubmit={()=>undefined}/>)
 try{
  await click(byTest(mounted.container,'delivery-add-materials'))
  await click(byTest(mounted.container,'delivery-material-checkbox'))
  await setValue(byTest<HTMLInputElement>(mounted.container,'delivery-material-search'),'notes')
  await click(byTest(mounted.container,'delivery-material-checkbox'))
  assert.match(byTest(mounted.container,'delivery-material-confirm').textContent??'',/（2）/u)
  await click(byTest(mounted.container,'delivery-material-confirm'))
  const content=byTest(mounted.container,'delivery-additional-files').textContent??''
  assert.match(content,/sample.csv/u);assert.match(content,/notes.pdf/u)
 }finally{await mounted.unmount()}
})

for (const reason of ['本轮执行已中断，可重新执行或编辑草稿后提交。', '本轮执行已取消。', '模型服务当前繁忙，请稍后重新执行。']) {
 test(`ended AI turn unlocks explanation, preview, materials, submit and reexecution: ${reason}`,async()=>{
  let retried=0,previewed=0,submitted=0
  const mounted=await mount(<DeliveryDraft data={{...data,state:'failed',failureReason:reason}} materialSelection={{files:[output,member]}} onReexecute={()=>{retried++}} onPreview={()=>{previewed++}} onSubmit={()=>{submitted++}}/> )
  try{
   assert.match(byTest(mounted.container,'delivery-failure').textContent??'',new RegExp(reason,'u'))
   const summary=byTest<HTMLTextAreaElement>(mounted.container,'delivery-summary')
   assert.equal(summary.disabled,false)
   await setValue(summary,'成员已补充并核对内容')
   await click(byTest(mounted.container,'delivery-reexecute'));assert.equal(retried,1)
   const preview=mounted.container.querySelector<HTMLButtonElement>('[data-testid="delivery-file-preview"]')
   assert.ok(preview);assert.equal(preview.disabled,false);await click(preview);assert.equal(previewed,1)
   const add=byTest(mounted.container,'delivery-add-materials');assert.equal(add.disabled,false);await click(add)
   await click(byTest(mounted.container,'delivery-material-checkbox'));await click(byTest(mounted.container,'delivery-material-confirm'))
   assert.match(byTest(mounted.container,'delivery-additional-files').textContent??'',/notes.pdf/u)
   const submit=byTest(mounted.container,'delivery-submit');assert.equal(submit.disabled,false);await click(submit)
   await click(byTest(mounted.container,'delivery-submit-confirm'));assert.equal(submitted,1)
  }finally{await mounted.unmount()}
 })
}

for (const [source, label] of [['member', '成员添加'], ['attachment', '会话附件']] as const) {
 test(`required ${source} output keeps its provenance in the actual submit confirmation`, async () => {
  const file = { ...output, name: 'data.csv', relativePath: 'data.csv', mediaType: 'text/csv', source }
  const submissions: unknown[] = []
  const mounted = await mount(<DeliveryDraft data={{ ...data, declaredFiles: [file] }} onSubmit={(_summary, files) => { submissions.push(files) }} />)
  try {
   assert.match(byTest(mounted.container, 'delivery-file-required').textContent ?? '', new RegExp(label, 'u'))
   await click(byTest(mounted.container, 'delivery-submit'))
   assert.equal(byTest(mounted.container, 'delivery-confirm-file').querySelector('span')?.textContent, `必交 · ${label}`)
   await click(byTest(mounted.container, 'delivery-submit-confirm'))
   assert.deepEqual(submissions, [[file]])
  } finally { await mounted.unmount() }
 })
}

test('required chooser rejects incompatible MIME and empty files before import and filters task candidates', async () => {
 let uploads = 0
 const required = { ...output, name: 'required.csv', mediaType: 'text/csv', maxBytes: 1024 }
 const eligible = { ...attachment, byteCount: 10 }
 const mounted = await mount(<DeliveryMaterialPicker requiredOutput={required} declaredFiles={[]} additionalFiles={[]} selection={{ files: [member, eligible, { ...eligible, id: 'empty', byteCount: 0 }], onUpload: async () => { uploads++; return [] } }} onConfirm={() => undefined} onClose={() => undefined} />)
 try {
  assert.equal(byTest(mounted.container, 'delivery-material-options').querySelectorAll('li').length, 1)
  await click(byTest(mounted.container, 'delivery-material-upload-tab'))
  const input = byTest<HTMLInputElement>(mounted.container, 'delivery-material-file-input')
  for (const file of [new browser.File(['abc'], 'notes.pdf'), new browser.File([], 'empty.csv')]) {
   await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true })); await tick() })
   assert.equal(uploads, 0)
   assert.match(byTest(mounted.container, 'delivery-material-upload-error').textContent ?? '', /格式|不能为空/u)
  }
 } finally { await mounted.unmount() }
})

for (const reason of ['必交文件需要 text/csv 格式。', '文件 bad.zip：ZIP 文件结构不完整或不符合格式要求。']) {
 test(`canonical draft save displays its exact content failure: ${reason}`, async () => {
  let saves = 0
  const view = draftView()
  const client = { saveWorkerDeliveryDraft: async () => { saves++; throw new Error(`Handler for collaboration.worker-delivery.draft.save failed: handler_failed: ${reason}`) }, readWorkerDelivery: async () => ({ delivery: { ...view, draft: { ...view.draft!, revision: view.draft!.revision + 1 } } }) } as unknown as CollaborationRendererClient
  function Harness() {
   const local = useWorkerDeliveryDraft(client, view, () => undefined)
   return <><button data-testid="queue-invalid-binding" onClick={() => { local.onDeclaredMaterialChange({ relativePath: 'bad.zip' }); void local.flush(data.summary).catch(() => undefined) }}>bind</button><DeliveryDraft data={{ ...data, summary: local.summary ?? '', saveState: local.saveState, saveError: local.saveError }} onSubmit={() => undefined} /></>
  }
  const mounted = await mount(<Harness />)
  try {
   await click(byTest(mounted.container, 'queue-invalid-binding'))
   assert.equal(saves, 1, 'a content failure must not retry merely because the draft revision changed')
   assert.equal(byTest(mounted.container, 'delivery-save-error').textContent, reason)
   assert.doesNotMatch(mounted.container.textContent ?? '', /Handler for|handler_failed/u)
   assert.equal(byTest<HTMLTextAreaElement>(mounted.container, 'delivery-summary').value, data.summary)
   assert.equal(byTest<HTMLButtonElement>(mounted.container, 'delivery-submit').disabled, true)
  } finally { await mounted.unmount() }
 })
}
