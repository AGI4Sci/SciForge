import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { conversationView } from '../src/ui/conversation.js'
import { researchThread } from './fixtures.js'

function fixture() {
  const window = new Window()
  Object.assign(globalThis, { document: window.document })
  const thread = researchThread('code')
  thread.anchor.codeAnchor = { filePath: 'src/test.ts', side: 'new', line: 1, hunkHeader: '',
    code: 'value', baseRevision: 'abc', contentDigest: 'a'.repeat(64) }
  return { window, thread }
}
const flush = async () => { await new Promise<void>((resolve) => setImmediate(resolve)) }

test('message translation uses canonical operation and preserves original text', async () => {
  const { window, thread } = fixture()
  const calls: unknown[] = []
  const original = thread.messages[0]!.body
  const view = conversationView(thread, async (action, input) => {
    calls.push({ action, input })
    return { original, translation: '译文', targetLanguage: 'zh-CN', machineTranslated: true, runtimeId: 'runtime' }
  }, () => {})
  ;[...view.root.querySelectorAll('button')].find(button => button.textContent === '翻译说明')!.click()
  await flush()
  assert.deepEqual(calls, [{ action: 'anchored-comments.prose.translate', input: { text: original, targetLanguage: 'zh-CN' } }])
  assert.ok(view.root.textContent!.includes(original))
  assert.ok(view.root.textContent!.includes('机器翻译 · 译文'))
  view.dispose(); await window.happyDOM.close()
})

test('refresh updates stale warning while retaining conversation draft and scroll', async () => {
  const { window, thread } = fixture()
  const view = conversationView(thread, async () => undefined, () => {})
  view.root.querySelector('textarea')!.value = 'Unsent question'
  const history = view.root.querySelector<HTMLElement>('[role="log"]')!
  history.scrollTop = 51
  view.update({ ...thread, anchorResolution: 'needs_retargeting' })
  assert.match(view.root.querySelector('header')!.textContent!, /定位已过期/)
  assert.equal(view.root.querySelector('textarea')!.value, 'Unsent question')
  assert.equal(history.scrollTop, 51)
  view.dispose(); await window.happyDOM.close()
})

test('conversation preserves history scroll when a reply starts and finishes', async () => {
  const { window, thread } = fixture()
  let finish!: (value: unknown) => void
  const view = conversationView(thread, async () => await new Promise((resolve) => { finish = resolve }), () => {})
  document.body.append(view.root)
  const history = view.root.querySelector<HTMLElement>('[role="log"]')!
  history.scrollTop = 137
  view.root.querySelector('textarea')!.value = 'Question'
  ;[...view.root.querySelectorAll('button')].find((button) => button.textContent === '发送')!.click()
  assert.equal(history.scrollTop, 137)
  finish({ thread, state: 'completed', truncated: false })
  await flush()
  assert.equal(history.scrollTop, 137)
  view.dispose(); await window.happyDOM.close()
})

test('pending fork blocks another fork and reply until settlement', async () => {
  const { window, thread } = fixture()
  let finish!: (value: unknown) => void
  const calls: string[] = []
  const view = conversationView(thread, async (action) => {
    calls.push(action)
    return await new Promise((resolve) => { finish = resolve })
  }, () => {})
  view.root.querySelector('textarea')!.value = 'Alternative?'
  const buttons = [...view.root.querySelectorAll('button')]
  buttons.find((button) => button.textContent === '从这里分叉')!.click()
  buttons.find((button) => button.textContent === '发送')!.click()
  assert.deepEqual(calls, ['anchored-comments.conversation.fork'])
  view.dispose(false)
  finish(thread); await flush(); await window.happyDOM.close()
})

test('scope disposal fences a late fork without cancelling through another scope', async () => {
  const { window, thread } = fixture()
  let finish!: (value: unknown) => void
  let opened = 0
  const calls: string[] = []
  const view = conversationView(thread, async (action) => {
    calls.push(action)
    return await new Promise((resolve) => { finish = resolve })
  }, () => { opened++ })
  view.root.querySelector('textarea')!.value = 'Alternative?'
  ;[...view.root.querySelectorAll('button')].find((button) => button.textContent === '从这里分叉')!.click()
  view.dispose(false)
  finish(thread); await flush()
  assert.equal(opened, 0)
  assert.deepEqual(calls, ['anchored-comments.conversation.fork'])
  await window.happyDOM.close()
})

test('retry after an unknown reply result preserves request identity', async () => {
  const { window, thread } = fixture()
  const requests: unknown[] = []
  const view = conversationView(thread, async (_action, input) => {
    requests.push(input)
    throw new Error('Host response timed out')
  }, () => {})
  view.root.querySelector('textarea')!.value = 'Question'
  const send = [...view.root.querySelectorAll('button')].find((button) => button.textContent === '发送')!
  send.click(); await flush()
  send.click(); await flush()
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1], requests[0])
  view.dispose(); await window.happyDOM.close()
})

test('normal close cancels the matching reply and ignores its late response', async () => {
  const { window, thread } = fixture()
  let finish!: (value: unknown) => void
  const calls: { action: string; input: unknown }[] = []
  const view = conversationView(thread, async (action, input) => {
    calls.push({ action, input })
    if (action.endsWith('.cancel')) return { cancelled: true }
    return await new Promise((resolve) => { finish = resolve })
  }, () => {})
  document.body.append(view.root)
  view.root.querySelector('textarea')!.value = 'Question'
  ;[...view.root.querySelectorAll('button')].find((button) => button.textContent === '发送')!.click()
  view.root.querySelector<HTMLButtonElement>('[aria-label="关闭代码讨论"]')!.click()
  assert.equal(calls[1].action, 'anchored-comments.conversation.cancel')
  const input = calls[0].input as { requestId: string; threadId: string }
  assert.deepEqual(calls[1].input, { threadId: input.threadId, requestId: input.requestId })
  finish({ thread, state: 'completed', truncated: false }); await flush()
  assert.equal(view.root.isConnected, false)
  await window.happyDOM.close()
})

test('unknown reply cannot be retried with a different question', async () => {
  const { window, thread } = fixture()
  let calls = 0
  const view = conversationView(thread, async () => { calls++; throw new Error('timeout') }, () => {})
  const draft = view.root.querySelector('textarea')!
  draft.value = 'Original question'
  const send = [...view.root.querySelectorAll('button')].find((button) => button.textContent === '发送')!
  send.click(); await flush()
  draft.value = 'Changed question'
  send.click(); await flush()
  assert.equal(calls, 1)
  assert.match(view.root.querySelector('.conversation-notice')!.textContent!, /恢复原问题/)
  view.dispose(); await window.happyDOM.close()
})

test('retry after an unknown fork result preserves child identity', async () => {
  const { window, thread } = fixture()
  const requests: unknown[] = []
  const view = conversationView(thread, async (_action, input) => {
    requests.push(input); throw new Error('timeout')
  }, () => {})
  view.root.querySelector('textarea')!.value = 'Alternative?'
  const fork = () => [...view.root.querySelectorAll('button')].find((button) => button.textContent === '从这里分叉')!
  fork().click(); await flush()
  fork().click(); await flush()
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1], requests[0])
  view.dispose(); await window.happyDOM.close()
})

test('wrong child identity is rejected even when parent references match', async () => {
  const { window, thread } = fixture()
  let opened = 0
  const view = conversationView(thread, async () => ({
    ...thread, id: 'wrong-child',
    fork: { parentThreadId: thread.id, parentMessageId: thread.messages[0].id,
      messages: thread.messages, truncated: false }
  }), () => { opened++ })
  view.root.querySelector('textarea')!.value = 'Alternative?'
  ;[...view.root.querySelectorAll('button')].find((button) => button.textContent === '从这里分叉')!.click()
  await flush()
  assert.equal(opened, 0)
  assert.match(view.root.querySelector('.conversation-notice')!.textContent!, /身份不匹配/)
  assert.equal(view.root.querySelector('textarea')!.value, 'Alternative?')
  view.dispose(); await window.happyDOM.close()
})

test('two mounted conversations keep independent drafts and scroll positions', async () => {
  const { window, thread } = fixture()
  const first = conversationView(thread, async () => { throw new Error('unused') }, () => {})
  const second = conversationView({ ...thread, id: 'other' }, async () => { throw new Error('unused') }, () => {})
  first.root.querySelector('textarea')!.value = 'First draft'
  second.root.querySelector('textarea')!.value = 'Second draft'
  first.root.querySelector<HTMLElement>('[role="log"]')!.scrollTop = 42
  second.root.querySelector<HTMLElement>('[role="log"]')!.scrollTop = 91
  first.dispose()
  assert.equal(second.root.querySelector('textarea')!.value, 'Second draft')
  assert.equal(second.root.querySelector<HTMLElement>('[role="log"]')!.scrollTop, 91)
  second.dispose(); await window.happyDOM.close()
})

test('close and reopen retain draft and scroll without accepting a late closed request', async () => {
  const { window, thread } = fixture()
  let finish!: (value: unknown) => void
  const view = conversationView(thread, async (action) => action.endsWith('.cancel') ? { cancelled: true } : await new Promise(resolve => { finish = resolve }), () => {})
  document.body.append(view.root)
  view.root.querySelector('textarea')!.value = 'Unsent draft'
  view.root.querySelector<HTMLElement>('[role="log"]')!.scrollTop = 83
  ;[...view.root.querySelectorAll('button')].find(button => button.textContent === '发送')!.click()
  view.root.querySelector<HTMLButtonElement>('[aria-label="关闭代码讨论"]')!.click()
  view.reopen(document.body)
  finish({ thread: { ...thread, messages: [] }, state: 'completed', truncated: false }); await flush()
  assert.equal(view.root.querySelector('textarea')!.value, 'Unsent draft')
  assert.equal(view.root.querySelector<HTMLElement>('[role="log"]')!.scrollTop, 83)
  assert.equal(view.root.querySelectorAll('article').length, thread.messages.length)
  view.dispose(false); await window.happyDOM.close()
})

test('navigation restores history after browser layout resets during rendering and reparenting', async () => {
  const { window, thread } = fixture()
  const view = conversationView(thread, async () => {}, () => {})
  document.body.append(view.root)
  const history = view.root.querySelector<HTMLElement>('[role="log"]')!
  const replaceChildren = history.replaceChildren.bind(history)
  history.replaceChildren = (...nodes) => { replaceChildren(...nodes); history.scrollTop = 0 }
  const container = document.createElement('main')
  document.body.append(container)
  const append = container.append.bind(container)
  container.append = (...nodes) => { append(...nodes); history.scrollTop = 0 }
  view.root.querySelector('textarea')!.value = 'Retained navigation draft'
  history.scrollTop = 900
  view.update(thread)
  view.reopen(container)
  assert.equal(history.scrollTop, 900)
  view.root.querySelector<HTMLButtonElement>('[aria-label="关闭代码讨论"]')!.click()
  view.reopen(container)
  assert.equal(history.scrollTop, 900)
  assert.equal(view.root.querySelector('textarea')!.value, 'Retained navigation draft')
  view.dispose(false); await window.happyDOM.close()
})

test('navigation keeps an active reply cancellable and prevents another submission', async () => {
  const { window, thread } = fixture()
  let finish!: (value: unknown) => void
  const view = conversationView(thread, async () => await new Promise(resolve => { finish = resolve }), () => {})
  document.body.append(view.root)
  view.root.querySelector('textarea')!.value = 'Pending question'
  const buttons = [...view.root.querySelectorAll('button')]
  const send = buttons.find(button => button.textContent === '发送')!
  const cancel = buttons.find(button => button.textContent === '停止')!
  send.click()
  view.update(thread)
  view.reopen(document.body)
  assert.equal(send.disabled, true)
  assert.equal(cancel.disabled, false)
  finish({ thread, state: 'completed', truncated: false }); await flush()
  assert.equal(send.disabled, false)
  assert.equal(cancel.disabled, true)
  view.dispose(false); await window.happyDOM.close()
})

test('fork navigation opens exact parent and listed child identities', async () => {
  const { window, thread } = fixture()
  const opened: string[] = []
  thread.fork = { parentThreadId: 'parent', parentMessageId: 'm', messages: [], truncated: false }
  const view = conversationView(thread, async () => {}, () => {}, id => opened.push(id))
  view.setChildren([{ ...thread, id: 'child' }])
  ;[...view.root.querySelectorAll('button')].find(button => button.textContent === '父讨论')!.click()
  ;[...view.root.querySelectorAll('button')].find(button => button.textContent === '分叉 1')!.click()
  assert.deepEqual(opened, ['parent', 'child'])
  view.dispose(false); await window.happyDOM.close()
})
