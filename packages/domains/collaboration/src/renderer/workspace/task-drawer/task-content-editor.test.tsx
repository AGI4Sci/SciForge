import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import { TaskContentEditor } from './TaskContentEditor.js'

const browser = new Window({ url: 'https://sciforge.test/' })
const descriptors = new Map<string, PropertyDescriptor | undefined>()
before(() => {
  for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
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

const content = { title: 'Evidence review', objective: 'Compare evidence', completionCriteria: ['Cite original sources'] }
const pending = { title: 'Expanded review', objective: 'Compare additional evidence', completionCriteria: ['Cite new sources'] }
const activeTask = { revision: 10, status: 'in_progress', currentExecutionId: 'exe_review', currentExecutionState: 'running' } as const
async function mount(props: React.ComponentProps<typeof TaskContentEditor>) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const rerender = async (next: typeof props) => { await act(async () => { root.render(<TaskContentEditor {...next} />) }) }
  await rerender(props)
  return { container, rerender, async unmount() { await act(async () => root.unmount()); container.remove() } }
}
async function click(button: HTMLButtonElement) { await act(async () => button.click()) }
async function setTitle(container: HTMLElement, value: string) {
  const input = container.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event)
  })
}
async function submit(container: HTMLElement) {
  await act(async () => { container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

test('completed and cancelled tasks expose no editor or mutation controls and send no request', async () => {
  const requests: unknown[] = []
  for (const status of ['completed', 'cancelled'] as const) {
    for (const proposal of [undefined, pending]) {
      const mounted = await mount({ content, task: { ...activeTask, status }, pending: proposal, canDecide: true, busy: false, onSave: async (value) => { requests.push(value); return true }, onDecide: (value) => requests.push(value) })
      try {
        if (proposal) assert.match(mounted.container.textContent!, /Expanded review/)
        assert.equal(mounted.container.querySelectorAll('button, form, input, textarea').length, 0)
        await submit(mounted.container)
      } finally { await mounted.unmount() }
    }
  }
  assert.deepEqual(requests, [])
})

test('terminal or inactive state received while editing removes the form without saving', async () => {
  const requests: unknown[] = []
  for (const update of [{ task: { ...activeTask, status: 'completed' as const } }, { projectStatus: 'paused' as const }]) {
    const props = { content, task: activeTask, canDecide: false, busy: false, onSave: async (value: unknown) => { requests.push(value); return true }, onDecide: () => assert.fail('no decision') }
    const mounted = await mount(props)
    try {
      await click(mounted.container.querySelector('button')!)
      assert.ok(mounted.container.querySelector('form'))
      await mounted.rerender({ ...props, ...update })
      assert.equal(mounted.container.querySelectorAll('button, form, input, textarea').length, 0)
      await submit(mounted.container)
    } finally { await mounted.unmount() }
  }
  assert.deepEqual(requests, [])
})

test('unfinished task with a sealed execution permits title only and preserves exact requirements', async () => {
  const requests: unknown[] = []
  const original = { ...content, objective: ' Original spacing ', completionCriteria: [' Original criterion '] }
  const mounted = await mount({ content: original, task: { ...activeTask, status: 'awaiting_review', currentExecutionState: 'completed' }, canDecide: false, busy: false, onSave: async (value) => { requests.push(value); return true }, onDecide: () => assert.fail('no decision') })
  try {
    await click(mounted.container.querySelector('button')!)
    assert.ok([...mounted.container.querySelectorAll('textarea')].every((input) => input.readOnly))
    await setTitle(mounted.container, 'Renamed review')
    await submit(mounted.container)
    assert.deepEqual(requests, [{ ...original, title: 'Renamed review' }])
  } finally { await mounted.unmount() }
})

test('active requirements stay editable and title revision refresh preserves an open draft', async () => {
  const requests: unknown[] = []
  const props = { content, task: activeTask, canDecide: false, busy: false, onSave: async (value: unknown) => { requests.push(value); return true }, onDecide: () => assert.fail('no decision') }
  const mounted = await mount(props)
  try {
    await click(mounted.container.querySelector('button')!)
    assert.ok([...mounted.container.querySelectorAll('textarea')].every((input) => !input.readOnly))
    await setTitle(mounted.container, 'Unsaved draft')
    await mounted.rerender({ ...props, content: { ...content, title: 'Remote title revision' } })
    assert.equal(mounted.container.querySelector('input')!.value, 'Unsaved draft')
    await submit(mounted.container)
    assert.deepEqual(requests, [{ ...content, title: 'Unsaved draft' }])
    await mounted.rerender({ ...props, content: { ...content, title: 'Latest saved title' } })
    await click(mounted.container.querySelector('button')!)
    assert.equal(mounted.container.querySelector('input')!.value, 'Latest saved title')
  } finally { await mounted.unmount() }
})

test('an open draft keeps its baseline revision after refresh and reopening captures the latest revision', async () => {
  const requests: unknown[] = []
  const props = { content, task: activeTask, canDecide: false, busy: false, onSave: async (value: unknown, revision?: number) => { requests.push({ value, revision }); return false }, onDecide: () => assert.fail('no decision') }
  const mounted = await mount(props)
  try {
    await click(mounted.container.querySelector('button')!)
    await setTitle(mounted.container, 'Unsaved draft')
    const refreshed = { ...props, task: { ...activeTask, revision: 11 }, content: { ...content, title: 'Remote title' } }
    await mounted.rerender(refreshed)
    await submit(mounted.container)
    assert.deepEqual(requests, [{ value: { ...content, title: 'Unsaved draft' }, revision: 10 }])
    assert.equal(mounted.container.querySelector('input')!.value, 'Unsaved draft')
    await click(mounted.container.querySelector('button[type="button"]')!)
    await click(mounted.container.querySelector('button')!)
    await submit(mounted.container)
    assert.deepEqual(requests[1], { value: refreshed.content, revision: 11 })
  } finally { await mounted.unmount() }
})

test('pending proposal remains read only with counterpart decisions available', async () => {
  const decisions: string[] = []
  const props = { content, pending, task: activeTask, canDecide: false, busy: false, onSave: async () => { assert.fail('proposal must be decided first') }, onDecide: (decision: 'approve' | 'reject') => decisions.push(decision) }
  const mounted = await mount(props)
  try {
    assert.match(mounted.container.textContent!, /Compare additional evidence/)
    assert.equal(mounted.container.querySelectorAll('button, form').length, 0)
    await mounted.rerender({ ...props, canDecide: true })
    assert.equal(mounted.container.querySelectorAll('button').length, 2)
    await click(mounted.container.querySelectorAll('button')[0]!)
    await click(mounted.container.querySelectorAll('button')[1]!)
    assert.deepEqual(decisions, ['approve', 'reject'])
    await mounted.rerender({ ...props, canDecide: true, task: { ...activeTask, currentExecutionState: 'completed' } })
    assert.equal(mounted.container.querySelectorAll('button').length, 1)
    assert.equal(mounted.container.querySelector('button')!.textContent, '保留原要求')
  } finally { await mounted.unmount() }
})
