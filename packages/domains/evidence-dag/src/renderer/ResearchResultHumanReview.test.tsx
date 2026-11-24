import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { ResearchResultHumanReview } from './ResearchResultHumanReview'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

test('optional review stays hidden when off, skip is explicit and duplicate submissions cannot create approvals', async () => {
  const browser = new Window()
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const scope = { workspaceRoot: '/review', runtimeId: 'codex', threadId: 'review' }
  const ref = { artifactId: 'artifact:one', versionId: 'artifact-version:one', contentDigest: 'a'.repeat(64), byteLength: 1, availability: 'available' as const, retention: 'snapshot' as const, accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true } }
  const result = { id: 'result', nodeId: 'root', title: 'Mean', result: ref, inputs: [ref], presentations: [], status: 'no-recorded-impact' as const, reasons: [] }
  const calls: any[] = [], options: any[] = []
  let resolve!: (value: { revision: number }) => void
  let reject!: (reason: Error) => void
  const invoker = { invoke: async (_contract: unknown, input: unknown, option: unknown) => { calls.push(input); options.push(option); return new Promise<{ revision: number }>((done, fail) => { resolve = done; reject = fail }) } } as DomainRendererCapabilityInvoker
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const props = { scope, result, revision: 2, invoker, active: true, onSaved: () => {} }
  try {
    await act(async () => root.render(<ResearchResultHumanReview {...props} enabled={false} />))
    assert.equal(container.querySelector('button'), null)
    await act(async () => root.render(<ResearchResultHumanReview {...props} enabled />))
    const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent === label)!
    await act(async () => button('复核此结果').click())
    assert.ok(container.querySelector('textarea'))
    assert.equal(button('提交复核…').disabled, true)
    await act(async () => { button('跳过复核…').click(); button('跳过复核…').click() })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].target.decision, 'skipped')
    assert.equal(calls[0].target.principal, undefined)
    assert.deepEqual(options[0], { workspaceId: scope.workspaceRoot, approval: { mode: 'confirmation' } })
    assert.deepEqual(calls[0].target.binding.result, ref)
    await act(async () => { resolve({ revision: 3 }) })
    assert.match(container.textContent!, /已记录/)
    await act(async () => root.render(<ResearchResultHumanReview {...props} revision={3} enabled />))
    await act(async () => button('复核此结果').click())
    await act(async () => button('跳过复核…').click())
    await act(async () => reject(new Error('Lost response')))
    assert.match(container.textContent!, /Lost response/)
    await act(async () => button('跳过复核…').click())
    assert.deepEqual(calls[1], calls[2])
    await act(async () => root.render(<ResearchResultHumanReview {...props} scope={{ ...scope, threadId: 'different' }} enabled />))
    await act(async () => reject(new Error('Old scope error')))
    assert.doesNotMatch(container.textContent!, /Old scope error|Lost response|已记录/)
    await act(async () => root.render(<ResearchResultHumanReview {...props} active={false} enabled />))
    assert.equal(button('复核此结果').disabled, true)
  } finally { await act(async () => root.unmount()); await browser.happyDOM.close() }
})
