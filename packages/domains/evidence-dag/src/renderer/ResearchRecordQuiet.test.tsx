import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk/contract'
import { researchRecordSourceNavigation } from './ResearchRecordSource'
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { researchRecordContracts, researchRecordViewOutputSchema, type ResearchRecordView } from '../research-record-contract'
import { ResearchRecordPanel } from './ResearchRecordPanel'
import { EvidenceWorkspacePanel } from './EvidenceWorkspacePanel'
import { RecordReview } from './ResearchRecordReview'
import { ResearchSourceRetention } from './ResearchSourceRetention'
import { createResearchRecordPresentation } from './research-record-presentation'

const browser = new Window()
before(() => {
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'ResizeObserver'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
})
after(() => browser.close())
const scope = { runtimeId: 'codex', threadId: 'fixture', workspaceRoot: '/science' }
const source = { ...scope, turnId: 'turn', itemId: 'item', digest: 'a'.repeat(64) }
const view = researchRecordViewOutputSchema.parse({ revision: 17, node: null, ancestors: [], children: [], latestRecordPath: [], totalChildren: 0, messages: [], paused: false, model: '', pending: 2, failures: [{ nodeId: 'root', message: 'organizer connection interrupted; exact diagnostic', at: '' }], coverage: 'visible-session-snapshots', lastScanAt: null, organizationCoverage: { observed: 1, historical: 0, processed: 0, assigned: 0, fullExcerpt: 0, truncated: 0, unavailable: 0, changed: 0, unassigned: 1, pending: 2, blocked: 1 } })
const usage = { usageKnown: true, usedBytes: 40, maxBytes: 100, retainedEntries: 1, maxEntries: 5, referencedEntries: 1, inspectedEntries: 1, missingEntries: 0, corruptEntries: 0, rejectedEntries: 0, complete: true, reasons: [], policy: 'retain-referenced-no-auto-delete' as const, exportRequired: true }
const withSource: ResearchRecordView = { ...view, sourceRetention: usage, node: { id: 'source-node', parentId: 'root', kind: 'event', title: '实验批次 17', summary: '条件 A 下的阴性结果', origin: 'system', status: 'failed', createdAt: '', updatedAt: '', source } }
async function mount(element: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  await act(async () => root.render(element))
  const click = async (label: string) => { const target = [...container.querySelectorAll('button, summary')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); assert.ok(target, label); await act(async () => (target as HTMLElement).click()) }
  return { container, root, click, close: async () => { await act(async () => root.unmount()); container.remove() } }
}
// happy-dom does not compute closed-details visibility; inspect the native disclosure ancestry.
function disclosed(element: Element): boolean {
  let child: Element = element
  for (let parent = child.parentElement; parent; child = parent, parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && child.tagName !== 'SUMMARY') return false
  }
  return true
}
test('settings use native inline disclosures; reading controls remain focusable and do not write', async () => {
  const calls: string[] = [], presentation = createResearchRecordPresentation()
  const invoker = { invoke: async (contract: { actionId: string }) => { calls.push(contract.actionId); return view } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<ResearchRecordPanel scope={scope} invoker={invoker} presentation={presentation} />)
  try {
    const summary = m.container.querySelector('[aria-label="管理研究记录"]') as HTMLElement
    const settings = summary.parentElement!, region = settings.querySelector('[role="region"]')!
    assert.equal(settings.tagName, 'DETAILS'); assert.equal(settings.hasAttribute('open'), false)
    assert.equal(region.classList.contains('absolute'), false); assert.equal(settings.classList.contains('absolute'), false)
    summary.focus(); assert.equal(document.activeElement, summary)
    assert.equal(disclosed(m.container.querySelector('[aria-label="阶段名称"]')!), false)
    assert.equal(disclosed(m.container.querySelector('[aria-label="整理模型"]')!), false)
    await m.click('管理研究记录'); await m.click('阅读显示')
    const bigger = m.container.querySelector('[aria-label="放大研究文字"]') as HTMLButtonElement
    assert.equal(disclosed(bigger), true); bigger.focus(); assert.equal(document.activeElement, bigger)
    const oldSize = presentation.getSnapshot().readingSize
    await m.click('放大研究文字'); assert.ok(presentation.getSnapshot().readingSize > oldSize)
    assert.ok(calls.every(action => action === researchRecordContracts.view.actionId))
  } finally { await m.close() }
})
test('failure and blocked summaries survive closed settings; explicit retry is busy-guarded and errors remain visible', async () => {
  let finish!: () => void, writes = 0
  const invoker = { invoke: async (contract: { actionId: string }, input: unknown) => {
    if (contract.actionId.endsWith('.edit')) { writes++; assert.equal((input as { expectedRevision: number }).expectedRevision, 17); await new Promise<void>(done => { finish = done }); throw new Error('retry transport failed') }
    return view
  } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<ResearchRecordPanel scope={scope} invoker={invoker} />)
  try {
    const status = m.container.querySelector('[role="status"]')!
    assert.match(status.textContent!, /整理失败 1.*1 轮整理受阻/); assert.equal(disclosed(status), true)
    await m.click('查看整理问题与恢复方法'); assert.match(status.textContent!, /exact diagnostic/)
    assert.equal(disclosed(status.querySelector('p.mt-1')!), true)
    await m.click('管理研究记录'); await m.click('自动整理'); await m.click('重试整理')
    const retry = [...m.container.querySelectorAll('button')].find(button => button.textContent === '重试整理')!
    assert.equal(retry.disabled, true); await act(async () => retry.click()); assert.equal(writes, 1)
    await act(async () => finish()); await m.click('管理研究记录')
    const alert = m.container.querySelector('[role="alert"]')!
    assert.match(alert.textContent!, /retry transport failed/); assert.equal(disclosed(alert), true)
  } finally { await m.close() }
})
test('process preserves scientific batch titles and failure state; internal range identity requires technical disclosure', async () => {
  const presentation = createResearchRecordPresentation(); presentation.update({ recordView: 'process' })
  const node = { ...withSource.node!, id: 'internal-range-xyz', kind: 'round' as const, source: undefined }
  const invoker = { invoke: async () => ({ ...view, children: [node], totalChildren: 1 }) } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<ResearchRecordPanel scope={scope} invoker={invoker} presentation={presentation} />)
  try {
    await m.click('展开 实验批次 17')
    const preview = m.container.querySelector('[data-record-preview="internal-range-xyz"]')!
    const identity = [...preview.querySelectorAll('p')].find(p => p.textContent?.includes('范围 ID'))!
    assert.equal(disclosed(identity), false); assert.match(m.container.textContent!, /实验批次 17/)
    assert.ok(m.container.querySelector('[data-record-id="internal-range-xyz"]')!.textContent?.includes('失败'))
    await m.click('技术详情'); assert.equal(disclosed(identity), true)
  } finally { await m.close() }
})
test('source/export actions stay explicit and quota/raw identifiers are behind technical details', async () => {
  let requests = 0, finish!: (value: unknown) => void
  const invoker = { invoke: async () => { requests++; return new Promise(done => { finish = done }) } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<ResearchSourceRetention view={withSource} scope={scope} invoker={invoker} active />)
  try {
    const quota = [...m.container.querySelectorAll('p')].find(p => p.textContent?.includes('40 / 100 bytes'))!
    assert.equal(disclosed(quota), false)
    const request = [...m.container.querySelectorAll('button')][0]
    assert.equal(disclosed(request), true); assert.equal(requests, 0)
    await m.click('请求授权的单项保全来源'); assert.equal(request.disabled, true)
    await act(async () => request.click()); assert.equal(requests, 1)
    await act(async () => finish({ ...withSource, sourceExport: { version: 'research-source-export-v1', complete: true, ref: source, raw: { result: 'negative' }, reasons: [], strategy: 'page-authorized-record-nodes; export-one-retained-source-per-view; preserve-ref-and-digest; never-delete-originals' } }))
    const download = [...m.container.querySelectorAll('button')].find(button => button.textContent === '下载单项来源')!
    assert.ok(download); assert.equal(disclosed(download), true); assert.doesNotMatch(download.textContent!, /raw|ref|digest/)
    await m.click('技术详情：来源保全与容量'); assert.equal(disclosed(quota), true)
  } finally { await m.close() }
})
test('collapsed review keeps blocked work visible; audit sequence moves into technical details', async () => {
  const invoker = { invoke: async (contract: { actionId: string }) => contract.actionId.endsWith('.audit') ? { sequence: 71, at: '2026-11-10', kind: 'human-fields', origin: 'human', changes: [], sources: [], input: null, output: null, execution: null } : { revision: 17, latestSequence: 71, throughSequence: 71, items: [{ id: 'review', sequence: 71, nodeId: 'root', title: '实验批次 71', text: '仅在条件 A 下成立', kind: 'human-fields', sourceIds: [], origin: 'human' }], total: 1, nextOffset: null, pending: 1, blocked: 1, worker: 'idle' } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<RecordReview scope={scope} nodeId="root" revision={17} invoker={invoker} presentation={createResearchRecordPresentation()} active onInspect={() => {}} onDiscuss={async () => {}} />)
  try {
    const status = m.container.querySelector('[role="status"]')!; assert.match(status.textContent!, /1 轮待恢复/); assert.equal(disclosed(status), true)
    await m.click('展开回看'); await m.click('来源与修订')
    const audit = m.container.querySelector('[aria-label="修订依据"]')!
    const sequence = [...audit.querySelectorAll('p')].find(p => p.textContent === '修订 #71')!
    assert.ok(sequence); assert.equal(disclosed(sequence), false)
    assert.match(m.container.textContent!, /实验批次 71/)
    await m.click('技术详情'); assert.equal(disclosed(sequence), true)
  } finally { await m.close() }
})


test('embedded production evidence workspace has no second tab row and retains source process actions', async () => {
  const actions: string[] = []
  const invoker = { invoke: async (contract: { actionId: string }) => { actions.push(contract.actionId); return view } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<EvidenceWorkspacePanel session={{ id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot }} active surfaceId="audit" onCollapse={() => undefined} embedded client={{} as never} invoker={invoker} activation={{ contributionId: 'fixture', revision: 1, payload: { view: 'record' } }} />)
  try {
    assert.equal(m.container.querySelectorAll('[role=tablist], [role=tab], nav[aria-label="研究视图"]').length, 0)
    assert.match(m.container.textContent!, /整理失败 1 项/)
    await m.click('查看过程与来源'); await m.click('查看研究过程')
    assert.ok([...m.container.querySelectorAll('button')].some(button => button.textContent === '返回研究摘要'))
    await m.click('返回研究摘要')
    assert.ok(actions.every(action => action === researchRecordContracts.view.actionId))
  } finally { await m.close() }
})

test('embedded exact graph rejects an invalid full reference before any current graph read', async () => {
  let reads = 0
  const m = await mount(<EvidenceWorkspacePanel session={{ id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot }} active surfaceId="audit" onCollapse={() => undefined} embedded client={{ view: async () => { reads++; throw new Error('must not read') } } as never} invoker={{} as never} activation={{ contributionId: 'fixture', revision: 1, payload: { view: 'graph', runtimeId: scope.runtimeId, threadId: scope.threadId, artifactVersionRef: { versionId: 'incomplete-reference' } } }} />)
  try {
    assert.equal(reads, 0); assert.equal(m.container.querySelectorAll('iframe').length, 0)
    assert.match(m.container.textContent!, /精确版本/)
  } finally { await m.close() }
})


for (const payload of [{ view: 'record' }, { view: 'record', recordScope: { runtimeId: 'codex', threadId: 'explicit-record', workspaceRoot: '/explicit-science' } }, { recordScope: { runtimeId: 'codex', threadId: 'explicit-record', workspaceRoot: '/explicit-science' } }]) test('record route retains its legitimate scope beside a strict graph parser: ' + JSON.stringify(payload), async () => {
  const reads: Array<{ runtimeId: string; threadId: string; workspaceRoot: string }> = []
  const invoker = { invoke: async (_contract: unknown, input: { runtimeId: string; threadId: string; workspaceRoot: string }) => { reads.push(input); return view } } as unknown as DomainRendererCapabilityInvoker
  const m = await mount(<EvidenceWorkspacePanel session={{ id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot }} active embedded surfaceId="record-route" onCollapse={() => undefined} client={{} as never} invoker={invoker} activation={{ contributionId: 'fixture', revision: 1, payload: domainPackageJsonValueSchema.parse(payload) }} />)
  try {
    assert.ok(reads.length > 0)
    const expected = 'recordScope' in payload && payload.recordScope ? payload.recordScope : scope
    assert.equal(reads[0].runtimeId, expected.runtimeId); assert.equal(reads[0].threadId, expected.threadId); assert.equal(reads[0].workspaceRoot, expected.workspaceRoot)
    assert.doesNotMatch(m.container.textContent!, /选择带工作区的会话/)
  } finally { await m.close() }
})

for (const payload of [{ recordScope: scope, returnContributionId: 17 }, { recordScope: scope, returnContributionId: '' }, { recordScope: scope, unknownSelector: 'ignored' }, { view: 'record', recordScope: null }, { view: 'record', runtimeId: 'codex', threadId: 'ignored-other' }, { view: 'record', recordScope: { runtimeId: 'codex' } }, { view: 'record', snapshotDigest: 'bad-snapshot' }, { view: 'graph', snapshotDigest: 'bad-snapshot' }]) test('invalid scope or graph selector never falls back into readable record scope: ' + JSON.stringify(payload), async () => {
  let reads = 0
  const m = await mount(<EvidenceWorkspacePanel session={{ id: scope.threadId, runtimeId: scope.runtimeId, workspaceRoot: scope.workspaceRoot }} active embedded surfaceId="invalid-route" onCollapse={() => undefined} client={{} as never} invoker={{invoke:async()=>{reads++;return view}} as never} activation={{ contributionId: 'fixture', revision: 1, payload: domainPackageJsonValueSchema.parse(payload) }} />)
  try { assert.equal(reads,0); assert.equal(m.container.querySelectorAll('[data-research-record-surface]').length,0) }
  finally { await m.close() }
})


test('the actual source-view return activation keeps its original scope and known return owner', async () => {
  const navigation = researchRecordSourceNavigation(scope, withSource, 'right-panel', 'research-dossier.workbench-right-panel')
  assert.ok(navigation?.returnTo?.activation)
  const inputs: Array<{threadId: string; workspaceRoot: string}> = []
  const m = await mount(<EvidenceWorkspacePanel session={{id:'other-session',runtimeId:'codex',workspaceRoot:'/other-science'}} active surfaceId="source-return" onCollapse={() => undefined} client={{} as never} invoker={{invoke:async(_contract:unknown,input:{threadId:string;workspaceRoot:string})=>{inputs.push(input);return view}} as never} activation={{contributionId:'fixture',...navigation.returnTo.activation}} />)
  try {
    assert.ok(inputs.length > 0)
    assert.equal(inputs[0].threadId,scope.threadId);assert.equal(inputs[0].workspaceRoot,scope.workspaceRoot)
    assert.doesNotMatch(m.container.textContent!,/选择带工作区的会话/)
  } finally { await m.close() }
})
