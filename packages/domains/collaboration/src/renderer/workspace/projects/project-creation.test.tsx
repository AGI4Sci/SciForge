import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import { retainProjectCreationAttempt, type ProjectCreationRecovery } from './project-creation.js'
import { NewProjectDialog } from './NewProjectDialog.js'

const form = {
  displayName: 'Recovery Project', goal: 'Review and repair one draft.',
  budget: { maxTasks: 8, maxTasksPerRound: 2, maxTaskRetries: 1, maxCoordinationRounds: 4 }
}

test('retry retains the exact input/intent, while an explicitly changed form requires a new intent', () => {
  let ids = 0
  const newId = () => `pct_CreationIntent00${++ids}`
  const attempt = retainProjectCreationAttempt(null, 'usr_ProjectOwner001', form, newId)
  assert.equal(retainProjectCreationAttempt(attempt, attempt.principalUserId, { ...form }, newId), attempt)
  assert.equal(ids, 1)
  const changed = retainProjectCreationAttempt(attempt, attempt.principalUserId, { ...form, goal: 'A separate project.' }, newId)
  assert.notEqual(changed.input.createIntentId, attempt.input.createIntentId)
  assert.throws(() => retainProjectCreationAttempt(attempt, 'usr_OtherOwner0001', form, newId), /changing Principal/u)
})

const browser = new Window()
const descriptors = new Map<string, PropertyDescriptor | undefined>()
before(() => {
  for (const [key, value] of Object.entries({ window: browser, self: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Node: browser.Node, Event: browser.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
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

test('a pending creation freezes the original form and offers draft opening/retry without raw handler JSON', async () => {
  const { createRoot } = await import('react-dom/client')
  const projectId = 'prj_CreationPending01'
  // The recovery view consumes an already validated capability result; the focused
  // fixture needs only the public fields this component displays.
  const recovery = {
    initializationState: 'session_pending', reason: 'runtime_not_found', createIntentId: 'pct_CreationIntent001', createdProjectId: projectId,
    workspace: { projects: [{ project: { projectId, displayName: form.displayName, goal: form.goal } }] }
  } as ProjectCreationRecovery
  const calls: string[] = []
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const render = async (busy: boolean, failed = false) => act(async () => {
    root.render(<NewProjectDialog busy={busy} recovery={recovery} error={failed ? 'Handler failed: {"code":"runtime_not_found"}' : null} onRetry={() => calls.push('retry')} onOpenDraft={() => calls.push('open')} onCreateOther={() => calls.push('other')} onCancel={() => calls.push('close')} onSubmit={() => calls.push('new-create')} />)
  })
  try {
    await render(false)
    const input = container.querySelector('input')!
    assert.equal(input.value, form.displayName)
    assert.equal(input.disabled, true)
    assert.equal(container.querySelector('textarea')!.disabled, true)
    assert.match(container.textContent, /云端草稿已创建/u)
    assert.doesNotMatch(container.textContent, /Handler|runtime_not_found|新建失败/u)
    assert.equal(container.querySelector('[role="alert"]'), null)
    const button = (label: string) => [...container.querySelectorAll('button')].find((entry) => entry.textContent === label)!
    await act(async () => { button('打开已有草稿').click(); button('重试准备会话').click() })
    assert.deepEqual(calls, ['open', 'retry'])
    await render(false, true)
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /本次准备未完成/u)
    assert.doesNotMatch(container.textContent, /Handler|runtime_not_found/u)
    await render(true)
    assert.equal(button('重试准备会话').disabled, true)
    assert.equal(button('打开已有草稿').disabled, true)
    assert.equal(button('创建其他项目').disabled, true)
    assert.match(container.textContent, /正在为已有草稿准备研究会话/u)
    await render(false)
    await act(async () => { button('创建其他项目').click() })
    assert.deepEqual(calls, ['open', 'retry', 'other'])
    assert.equal(input.value, '')
    assert.equal(container.querySelector('textarea')!.value, '')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
