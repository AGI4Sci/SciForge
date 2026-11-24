import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import { TaskDiscussionComposer, type TaskDiscussionMentionableUser } from './TaskDiscussionComposer.js'

const browser = new Window({ url: 'https://sciforge.test/' })
const descriptors = new Map<string, PropertyDescriptor | undefined>()
before(() => {
  for (const [key, value] of Object.entries({ window: browser, self: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement, Node: browser.Node, Event: browser.Event, KeyboardEvent: browser.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})
after(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  browser.close()
})

const users = [
  { userId: 'usr_Alice000001', displayName: 'Alice' },
  { userId: 'usr_Ada00000001', displayName: 'Ada Lovelace' },
  { userId: 'usr_Complete0001', displayName: 'ad_team_b_20261113' },
  { userId: 'usr_ShortAda001', displayName: 'Ada' }
]
const duplicates = [
  { userId: 'usr_AlexFirst001', displayName: 'Alex' },
  { userId: 'usr_AlexSecond01', displayName: 'Alex' }
]

async function mount(directory: readonly TaskDiscussionMentionableUser[] = users, cloudTaskId: string | null = 'tsk_ActualCloudTask01') {
  const { createRoot } = await import('react-dom/client')
  const container = browser.document.createElement('div') as unknown as HTMLElement
  browser.document.body.append(container as never)
  const root = createRoot(container)
  const calls: Array<{ text: string; ids: readonly string[] }> = []
  const render = async (nextUsers = directory, busy = false, taskId = cloudTaskId) => act(async () => {
    root.render(<TaskDiscussionComposer cloudTaskId={taskId ?? undefined} busy={busy} mentionableUsers={nextUsers} onComment={(text, ids) => calls.push({ text, ids })} />)
  })
  await render()
  return {
    container, calls, render,
    input: () => container.querySelector('input')!,
    options: () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')],
    send: () => click(container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!),
    close: async () => { await act(async () => root.unmount()); container.remove() }
  }
}
async function value(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, text)
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => { button.click() })
}
async function key(input: HTMLInputElement, key: string, composing = false): Promise<void> {
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: composing })) })
}

test('typing @ lists real members; clicking a space-containing name sends its exact identity and visible name', async () => {
  const view = await mount()
  try {
    await value(view.input(), '@')
    assert.equal(view.input().getAttribute('aria-expanded'), 'true')
    assert.equal(view.options().length, users.length)
    await click(view.options().find((option) => option.textContent === 'Ada Lovelace')!)
    assert.equal(view.input().value, '@Ada Lovelace ')
    assert.equal(view.calls.length, 0)
    await value(view.input(), view.input().value + '请复核附件')
    await view.send()
    assert.deepEqual(view.calls, [{ text: '@Ada Lovelace 请复核附件', ids: ['usr_Ada00000001'] }])
    assert.equal(view.input().value, '')
  } finally { await view.close() }
})

test('complete names and punctuation resolve exact members, without prefix, email, or hyphen false positives', async () => {
  const view = await mount()
  try {
    await value(view.input(), '@ad_team_b_20261113，@Ada Lovelace。 @AliceX @Alice-other x@Alice @Alice!')
    await view.send()
    assert.deepEqual(view.calls[0]?.ids, ['usr_Complete0001', 'usr_Ada00000001', 'usr_Alice000001'])
    // Matching the longest real name must not additionally notify the member "Ada".
    assert.equal(view.calls[0]?.ids.includes('usr_ShortAda001'), false)
  } finally { await view.close() }
})

test('duplicate names never auto-select an identity; explicit options distinguish IDs and preserve the chosen recipient', async () => {
  const view = await mount(duplicates)
  try {
    await value(view.input(), '@Alex 请看')
    assert.match(view.container.textContent!, /同名成员须从建议中选择/u)
    await view.send()
    assert.deepEqual(view.calls[0], { text: '@Alex 请看', ids: [] })
    await value(view.input(), '@Al')
    assert.equal(view.options().length, 2)
    await click(view.options().find((option) => option.textContent?.includes('usr_AlexSecond01'))!)
    await value(view.input(), '注意 ' + view.input().value)
    await value(view.input(), view.input().value + '请看')
    await view.send()
    assert.deepEqual(view.calls[1], { text: '注意 @Alex 请看', ids: ['usr_AlexSecond01'] })
  } finally { await view.close() }
})

test('Arrow keys and Enter choose a member without sending, and IME Enter never sends', async () => {
  const view = await mount()
  try {
    await value(view.input(), '@')
    await key(view.input(), 'ArrowDown')
    assert.equal(view.options()[1]?.getAttribute('aria-selected'), 'true')
    await key(view.input(), 'Enter')
    assert.equal(view.input().value, '@Ada Lovelace ')
    assert.equal(view.calls.length, 0)
    await key(view.input(), 'Enter', true)
    assert.equal(view.calls.length, 0)
    await key(view.input(), 'Enter')
    assert.deepEqual(view.calls, [{ text: '@Ada Lovelace', ids: ['usr_Ada00000001'] }])
  } finally { await view.close() }
})

test('editing a selected token or removing its recipient cannot notify another member with the same name', async () => {
  const view = await mount(duplicates)
  try {
    await value(view.input(), '@')
    await click(view.options()[1]!)
    await value(view.input(), '@Alexx ')
    await value(view.input(), '@Alex ')
    await view.send()
    assert.deepEqual(view.calls[0]?.ids, [])
    await value(view.input(), '@')
    await click(view.options()[1]!)
    await view.render([duplicates[0]!])
    await view.send()
    assert.deepEqual(view.calls[1]?.ids, [])
  } finally { await view.close() }
})

test('an invalidated explicit mention cannot become an automatic unique-name recipient without a new selection', async () => {
  const view = await mount(duplicates)
  try {
    await value(view.input(), '@')
    await click(view.options()[1]!)
    await value(view.input(), '@Ales ')
    await value(view.input(), '@Alex ')
    // The previously chosen member disappears. The remaining same-name member
    // is unique now, but editing the text back is not consent to notify them.
    await view.render([duplicates[0]!])
    await view.send()
    assert.deepEqual(view.calls[0]?.ids, [])

    await view.render(duplicates)
    await value(view.input(), '@')
    await click(view.options()[1]!)
    await view.render([duplicates[0]!])
    await view.render(duplicates)
    await view.send()
    assert.deepEqual(view.calls[1]?.ids, [], 'a removed then restored directory entry still requires a new explicit selection')

    // An entirely new occurrence typed without a prior selection retains normal
    // automatic exact-name behavior for a unique directory entry.
    await view.render([duplicates[0]!])
    await value(view.input(), '@Alex，请看')
    await view.send()
    assert.deepEqual(view.calls[2]?.ids, ['usr_AlexFirst001'])

    await view.render(duplicates)
    await value(view.input(), '@')
    await click(view.options()[1]!)
    await value(view.input(), '@Alexx ')
    await value(view.input(), '@Alex')
    await click(view.options()[0]!)
    await view.send()
    assert.deepEqual(view.calls[3]?.ids, ['usr_AlexFirst001'], 'explicit reselection clears the unresolved marker')
  } finally { await view.close() }
})

test('busy and missing Cloud Task states disable input, selection, and sending', async () => {
  const view = await mount()
  try {
    await value(view.input(), '@Alice 请看')
    await view.render(users, true)
    assert.equal(view.input().disabled, true)
    assert.equal(view.options().length, 0)
    await key(view.input(), 'Enter')
    await view.send()
    assert.equal(view.calls.length, 0)
  } finally { await view.close() }
  const unassigned = await mount(users, null)
  try {
    assert.equal(unassigned.input().disabled, true)
    assert.match(unassigned.container.querySelector('[data-testid="discussion-unavailable"]')?.textContent ?? '', /还没有云端任务/u)
    await key(unassigned.input(), 'Enter')
    await unassigned.send()
    assert.equal(unassigned.calls.length, 0)
  } finally { await unassigned.close() }
})
