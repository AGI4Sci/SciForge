import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'
import type { DomainRendererChatMessageRenderContext } from '@sciforge/domain-sdk/renderer'
import { workerTaskPrompt } from '../main/worker-runtime-result.js'
import type { WorkerDeliveryView } from '../worker-delivery.js'
import {
  createCollaborationChatMessageContribution,
  deliveryConfirmsWorkerResult,
  parseCollaborationTaskMessage
} from './chat-message.js'

const identity = { projectId: 'prj_chat000001', taskId: 'tsk_chat000001', executionId: 'exe_chat000001' }
const metadata = { source: 'collaboration.worker-task', ...identity }
const task = {
  title: '公开单细胞数据集简介', objective: '编写适合科研人员阅读的简介。',
  completionCriteria: ['说明来源和使用范围。', '列出已知局限。'],
  fileIntent: { inputs: [], output: { fileName: 'README.md', mediaType: 'text/markdown', maxBytes: 1024 } }
}
const prompt = workerTaskPrompt(task)
const summary = 'README 已生成并检查。\n数据使用范围已补充。'
const result = JSON.stringify({ result: { schemaVersion: 1, outcome: 'completed', summary } })
function context(overrides: Partial<DomainRendererChatMessageRenderContext> = {}): DomainRendererChatMessageRenderContext {
  return {
    contractVersion: '1.0.0', runtimeId: 'runtime-chat', threadId: 'thread-chat', turnId: 'turn-chat', streaming: false,
    message: { id: 'final-chat', role: 'assistant', rawText: result },
    relatedInput: { id: 'input-chat', rawText: prompt, metadata },
    turnLifecycle: { phase: 'settled', revision: '1', isLatest: true, status: 'completed' },
    ...overrides
  }
}
function delivery(overrides: Partial<WorkerDeliveryView> = {}): WorkerDeliveryView {
  return {
    ...identity, state: 'waiting_confirmation', confirmationTarget: null, candidate: null,
    history: [], operationId: null, deliveryManifestId: null, error: null, residuals: [],
    draft: { selectedMaterials: [], materialError: null, revision: 1, resultRevision: 1, basedOnResultRevision: null, summary, aiSummary: null,
      summaryEdited: false, sourceTurnId: 'turn-chat', sourceRound: 1,
      sourceUpdatedAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', changed: false, outputs: [] },
    ...overrides
  }
}
function contribution(read = async () => ({ delivery: delivery() })) {
  return createCollaborationChatMessageContribution({ readWorkerDelivery: read })
}

test('task card parses the existing canonical prompt without changing model input bytes', () => {
  const original = prompt
  const model = parseCollaborationTaskMessage(prompt)
  assert.deepEqual(model && { title: model.title, objective: model.objective, completionCriteria: model.completionCriteria },
    { title: task.title, objective: task.objective, completionCriteria: task.completionCriteria })
  assert.ok(model?.protocol.includes('Workspace file contract:'))
  assert.ok(model?.protocol.includes('Return exactly one JSON object and no Markdown fence.'))
  const html = renderToStaticMarkup(contribution().render(context({ message: { id: 'input-chat', role: 'user', rawText: prompt, metadata } }))!)
  assert.match(html, /协作任务说明.*标题.*公开单细胞数据集简介.*目标.*编写适合科研人员阅读的简介.*完成标准/su)
  assert.match(html, /<details[^>]*data-testid="collaboration-task-protocol"[^>]*><summary[^>]*>系统格式要求/u)
  assert.doesNotMatch(html.match(/<details[^>]*>/u)?.[0] ?? '', /\sopen(?:=|>)/u)
  assert.equal(prompt, original)
  assert.equal(context().relatedInput?.rawText, prompt)
})

test('revision task card displays the exact revision instruction in Chinese layout', () => {
  const revised = workerTaskPrompt({ ...task, revisionInstruction: '请补充适用范围，不删除原说明。' })
  const html = renderToStaticMarkup(contribution().render(context({ message: { id: 'input-chat', role: 'user', rawText: revised, metadata } }))!)
  assert.match(html, /返修意见.*请补充适用范围，不删除原说明/su)
})

test('multiline completion criteria remain in the task section for file and text-only tasks', () => {
  const completionCriteria = ['说明来源。\n\n补充使用范围。', '列出已知局限。\n逐条说明依据。']
  for (const fileIntent of [task.fileIntent, null]) {
    const input = workerTaskPrompt({ ...task, completionCriteria, fileIntent })
    const parsed = parseCollaborationTaskMessage(input)
    assert.deepEqual(parsed?.completionCriteria, completionCriteria)
    assert.ok(parsed?.protocol.includes('Return exactly one JSON object and no Markdown fence.'))
  }
})

test('task recognition fails closed on malformed, ambiguous and non-task inputs', () => {
  for (const value of ['你好', prompt.replace('Completion criteria:', 'Criteria:'), prompt.replace('2. 列出', '3. 列出'),
    prompt.replace(task.objective, `${task.objective}\n\nCompletion criteria:\n1. ambiguous`), prompt.replace('Return exactly one JSON object and no Markdown fence.', '')]) {
    assert.equal(parseCollaborationTaskMessage(value), null)
  }
  assert.equal(contribution().render(context({ message: { id: 'user', role: 'user', rawText: prompt } })), null)
  assert.equal(contribution().render(context({ message: { id: 'user', role: 'user', rawText: prompt, metadata: { ...metadata, executionId: '' } } })), null)
})

test('only completed strict Worker JSON in an exact related task turn replaces the body', () => {
  assert.ok(contribution().render(context()))
  for (const rawText of ['普通文字完成说明', result.slice(0, -2), `\`\`\`json\n${result}\n\`\`\``,
    JSON.stringify({ result: { schemaVersion: 1, outcome: 'completed', summary, extra: true } }),
    JSON.stringify({ result: { schemaVersion: 1, outcome: 'needs_human', question: '使用哪个数据集？', requiredAssurance: 'verified' } })]) {
    assert.equal(contribution().render(context({ message: { id: 'final-chat', role: 'assistant', rawText } })), null)
  }
  for (const next of [context({ streaming: true }), context({ turnId: undefined }), context({ runtimeId: undefined }),
    context({ threadId: undefined }), context({ relatedInput: undefined }), context({ turnLifecycle: undefined }),
    context({ turnLifecycle: { phase: 'active', revision: '1', isLatest: true } }),
    context({ relatedInput: { id: 'ordinary', rawText: prompt } })]) {
    assert.equal(contribution().render(next), null)
  }
})

test('the updated badge needs exact local draft identity, turn and received summary facts', () => {
  assert.equal(deliveryConfirmsWorkerResult(delivery(), identity, 'turn-chat', summary), true)
  const base = delivery().draft!
  assert.equal(deliveryConfirmsWorkerResult(delivery({ draft: { ...base, summary: '成员的修改', summaryEdited: true, aiSummary: summary } }), identity, 'turn-chat', summary), true)
  for (const view of [delivery({ taskId: 'tsk-other' }), delivery({ executionId: 'exe-other' }), delivery({ projectId: 'prj-other' }),
    delivery({ draft: null }), delivery({ draft: { ...base, sourceTurnId: 'turn-other' } }),
    delivery({ draft: { ...base, summary: '尚未写入', aiSummary: null } })]) {
    assert.equal(deliveryConfirmsWorkerResult(view, identity, 'turn-chat', summary), false)
  }
})

const browser = new Window({ url: 'https://sciforge.test/' })
const descriptors = new Map<string, PropertyDescriptor | undefined>()
before(() => {
  const globals: Record<string, unknown> = { window: browser, self: browser, document: browser.document,
    navigator: browser.navigator, Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
    Event: browser.Event, KeyboardEvent: browser.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true }
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})
after(() => {
  for (const [key, value] of descriptors) {
    if (value) Object.defineProperty(globalThis, key, value)
    else Reflect.deleteProperty(globalThis, key)
  }
  browser.close()
})
async function mount(element: React.ReactElement) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => { root.render(element) })
  return { container,
    rerender: async (next: React.ReactElement) => { await act(async () => { root.render(next) }) },
    unmount: async () => { await act(async () => { root.unmount() }); container.remove() } }
}

test('result body waits for the real draft read and leaves raw JSON in a closed native disclosure', async () => {
  let resolve!: (value: { delivery: WorkerDeliveryView }) => void
  const read = new Promise<{ delivery: WorkerDeliveryView }>((done) => { resolve = done })
  const calls: unknown[] = []
  const renderer = createCollaborationChatMessageContribution({ readWorkerDelivery: async (input) => { calls.push(input); return read } })
  const mounted = await mount(renderer.render(context())!)
  try {
    assert.match(mounted.container.textContent ?? '', /结果说明.*README 已生成并检查/su)
    assert.equal(mounted.container.querySelector('[data-testid="collaboration-result-updated"]'), null)
    assert.deepEqual(calls, [identity])
    await act(async () => { resolve({ delivery: delivery() }); await read })
    assert.equal(mounted.container.querySelector('[data-testid="collaboration-result-updated"]')?.textContent, '已更新交付草稿')
    const details = mounted.container.querySelector<HTMLDetailsElement>('[data-testid="collaboration-result-json"]')!
    assert.equal(details.open, false)
    assert.equal(details.querySelector('pre')?.textContent, result)
    assert.equal(details.querySelector('summary')?.textContent, '原始 JSON')
    assert.equal(context().message.rawText, result)
  } finally { await mounted.unmount() }
})

test('a rejected draft read never claims an update or changes the result body', async () => {
  const mounted = await mount(contribution(async () => { throw new Error('not this worker') }).render(context())!)
  try {
    assert.match(mounted.container.textContent ?? '', /结果说明.*README 已生成并检查/su)
    assert.equal(mounted.container.querySelector('[data-testid="collaboration-result-updated"]'), null)
  } finally { await mounted.unmount() }
})

test('a final message preceding Adapter postflight retries the same existing read and then confirms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let reads = 0
  const renderer = contribution(async () => ({ delivery: ++reads === 1 ? delivery({ state: 'executing', draft: null }) : delivery() }))
  const mounted = await mount(renderer.render(context())!)
  try {
    assert.equal(reads, 1)
    assert.equal(mounted.container.querySelector('[data-testid="collaboration-result-updated"]'), null)
    await act(async () => { t.mock.timers.tick(500) })
    assert.equal(reads, 2)
    assert.equal(mounted.container.querySelector('[data-testid="collaboration-result-updated"]')?.textContent, '已更新交付草稿')
    await act(async () => { t.mock.timers.tick(30_000) })
    assert.equal(reads, 2)
  } finally { await mounted.unmount(); t.mock.timers.reset() }
})

test('changing exact task turn aborts the old read and ignores its late successful response', async () => {
  let resolve!: (value: { delivery: WorkerDeliveryView }) => void
  const old = new Promise<{ delivery: WorkerDeliveryView }>((done) => { resolve = done })
  const signals: (AbortSignal | undefined)[] = []
  const renderer = createCollaborationChatMessageContribution({ readWorkerDelivery: async (_input, options) => {
    signals.push(options?.signal)
    if (signals.length === 1) return old
    throw new Error('new turn not received')
  } })
  const mounted = await mount(renderer.render(context())!)
  try {
    await mounted.rerender(renderer.render(context({ turnId: 'turn-next' }))!)
    assert.equal(signals[0]?.aborted, true)
    assert.equal(signals[1]?.aborted, false)
    await act(async () => { resolve({ delivery: delivery() }); await old })
    assert.equal(mounted.container.querySelector('[data-testid="collaboration-result-updated"]'), null)
    assert.match(mounted.container.textContent ?? '', /结果说明/u)
  } finally { await mounted.unmount() }
  assert.equal(signals[1]?.aborted, true)
})
