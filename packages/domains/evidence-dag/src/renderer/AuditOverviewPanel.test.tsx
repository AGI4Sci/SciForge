import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import type { DomainRendererVisibleContextHost } from '@sciforge/domain-sdk/host'
import { AuditOverviewPanel } from './AuditOverviewPanel'
import type { ResearchRecordView } from '../research-record-contract'

test('audit overview presents existing content and unresolved negative evidence without internal labels',()=>{
  const view={node:{id:'internal-phase',kind:'phase',title:'实验批次 B 的比较',summary:'仅在匹配条件下观察到改善。',origin:'model',synthesisStatus:'stale',synthesis:{entries:[{id:'internal-entry',kind:'negative',text:'独立对照中没有观察到改善。',status:'active',sourceIds:['internal-source']}]}}} as unknown as ResearchRecordView
  const html=renderToStaticMarkup(<AuditOverviewPanel view={view} onInspect={()=>assert.fail('render is read-only')} />)
  assert.match(html,/实验批次 B/);assert.match(html,/独立对照中没有观察到改善/);assert.match(html,/摘要尚待同步/)
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''),/internal-|已验证|已通过|轮次/)
})
test('absent overview data never produces a fabricated conclusion',()=>{
  const html = renderToStaticMarkup(<AuditOverviewPanel view={{node:null} as ResearchRecordView} onInspect={()=>{}} />)
  assert.match(html, /尚无带来源的科研摘要/)
  assert.doesNotMatch(html, /已验证/)
})

test('root uses sourced child synthesis, bounds noise and text, expands old concerns with exact sources and process entry', async () => {
  const browser = new Window()
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const node = { id: 'round', parentId: 'root', kind: 'round', title: '科学比较', origin: 'model', updatedAt: '2026-11-11', synthesisStatus: 'stale', synthesis: { summaryLimited: true, entries: [
    ...Array.from({length: 8}, (_, i) => ({ id: `n${i}`, kind: 'negative', text: `负结果${i}：对照没有改善`, status: 'active', sourceIds: [`source${i}`] })),
    { id:'goal', kind:'goal', text:'研究目标'.repeat(150), status:'active', sourceIds:['goal-source'] },
    { id:'progress', kind:'progress', text:'仅在匹配条件下观察到差异', status:'active', sourceIds:['progress-source'] },
    { id:'duplicate', kind:'progress', text:'仅在匹配条件下观察到差异', status:'active', sourceIds:['other-source'] },
    { id:'historical', kind:'open', text:'已迁出不应污染当前范围', status:'active', membership:'historical', sourceIds:['old-source'] }
  ] } }
  const view = { node:null, children:[...Array.from({length:60}, (_, i) => ({ id:`event${i}`, title:'无价值终端成功噪声', kind:'event' })), node], totalChildren:120 } as unknown as ResearchRecordView
  const calls: unknown[] = []; let process = 0
  const targets: { target: { metadata?: Record<string, unknown> }; element: () => HTMLElement | null }[] = []
  const visibleContext = { registerVisualTarget: (target: typeof targets[number]) => { targets.push(target); return () => {} } } as unknown as DomainRendererVisibleContextHost
  const scope = { runtimeId:'codex', threadId:'owning-thread', workspaceRoot:'/science' }
  const container = browser.document.createElement('div'); browser.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  try {
    await act(async () => root.render(<AuditOverviewPanel view={view} onInspect={(...args) => calls.push(args)} onProcess={() => process++} scope={scope} componentId="summary-test" active visibleContext={visibleContext} />))
    assert.equal(container.querySelectorAll('[data-summary-entry]').length, 3)
    assert.equal(targets.length, 3)
    assert.ok(targets.every(item => item.target.metadata?.resourceId === 'round' && item.target.metadata?.threadId === scope.threadId))
    assert.ok(targets.every(item => item.element()?.getAttribute('data-selection-record-id') === 'round'))
    assert.ok([...container.querySelectorAll('[data-summary-entry]')].every(item => item.getAttribute('data-record-kind') === 'round' && item.getAttribute('data-selection-record-label') === '科学比较'))
    assert.doesNotMatch(container.textContent!, /无价值终端成功噪声|已迁出不应污染/)
    assert.match(container.textContent!, /摘要覆盖不完整|摘要尚待同步/)
    assert.equal(container.querySelector('details')!.hasAttribute('open'), false)
    assert.ok(container.querySelector('details summary')!.textContent!.length < 280)
    const expand = [...container.querySelectorAll('button')].find(button => button.textContent!.includes('展开其余负结果'))!
    await act(async () => expand.click())
    assert.equal(container.querySelectorAll('[data-summary-entry="negative"]').length, 8)
    const oldest = [...container.querySelectorAll('[data-summary-entry="negative"]')].find(item => item.textContent!.includes('负结果7'))!
    await act(async () => (oldest.querySelector('button') as unknown as HTMLElement).click())
    assert.deepEqual(calls[0], ['source7', ['source7'], '摘要相关依据'])
    const progress = container.querySelector('[data-summary-entry="progress"]')!
    await act(async () => (progress.querySelector('button') as unknown as HTMLElement).click())
    assert.deepEqual(calls[1], ['other-source', ['other-source', 'progress-source'], '摘要相关依据'])
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '查看完整过程与来源')!.click())
    assert.equal(process, 1)
    await act(async () => root.render(<AuditOverviewPanel view={{node:{...node, id:'another', synthesis:undefined}, children:[], totalChildren:0} as unknown as ResearchRecordView} onInspect={()=>{}} />))
    assert.equal(container.querySelectorAll('[data-summary-entry]').length, 0)
    assert.match(container.textContent!, /尚无带来源/)
  } finally { await act(async () => root.unmount()); await browser.close() }
})
