import assert from 'node:assert/strict'
import { test } from 'node:test'
import React, { act } from 'react'
import { Window } from 'happy-dom'
import { DeliveryDraft } from './DeliveryDraft.js'

test('explicit continuation dialog requires confirmation, receives the automatically dispatched handoff and opens the canonical Session', async () => {
  const browser = new Window({ url: 'https://sciforge.test/' })
  const saved = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window: browser, self: browser, document: browser.document,
    navigator: browser.navigator, Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
    HTMLTextAreaElement: browser.HTMLTextAreaElement, MutationObserver: browser.MutationObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const calls: string[] = []
  let opens = 0
  let resolveContinuation!: (context: string) => void
  const click = async (button: HTMLButtonElement) => { await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  try {
    await act(async () => { root.render(<DeliveryDraft data={{ revision: 1, summary: 'Existing negative finding', state: 'failed', declaredFiles: [] }}
      onContinueNew={async (reason) => { calls.push(reason); return await new Promise<string>((resolve) => { resolveContinuation = resolve }) }}
      onContinue={() => { opens += 1 }} />) })
    assert.equal(calls.length, 0)
    const trigger = container.querySelector('[data-testid="delivery-new-session"]') as HTMLButtonElement
    trigger.focus()
    await click(trigger)
    let dialog = document.querySelector('[data-testid="delivery-continuation-dialog"]')!
    assert.ok(dialog)
    assert.match(dialog.textContent ?? '', /会话已静止.*不代表原会话已丢失/u)
    assert.equal(calls.length, 0, 'opening the dialog must not create or dispatch a Session')
    assert.equal(document.activeElement?.getAttribute('aria-label'), '接续原因', 'reason textarea gets initial focus')
    await act(async () => { document.activeElement?.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event) })
    assert.equal(document.querySelector('[data-testid="delivery-continuation-dialog"]'), null)
    assert.equal(document.activeElement, trigger, 'Escape restores the original trigger')
    await click(trigger)
    dialog = document.querySelector('[data-testid="delivery-continuation-dialog"]')!
    await click([...dialog.querySelectorAll('button')].find((button) => button.textContent === '核对并接续任务') as HTMLButtonElement)
    assert.equal(calls.length, 1)
    assert.equal(dialog.getAttribute('aria-busy'), 'true')
    assert.equal(document.activeElement, dialog, 'pending state moves focus to panel when every control is disabled')
    assert.equal(document.activeElement?.matches(':disabled, [disabled]'), false)
    const outside = document.createElement('button'); container.append(outside)
    await act(async () => { outside.focus() })
    assert.equal(document.activeElement, dialog, 'focus trap resolves current controls instead of an old disabled button')
    for (const shiftKey of [false, true]) {
      await act(async () => { dialog.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }) as unknown as Event) })
      assert.equal(document.activeElement, dialog, 'Tab cannot escape a busy dialog without enabled controls')
    }
    await act(async () => { dialog.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event) })
    assert.equal(document.querySelector('[data-testid="delivery-continuation-dialog"]'), dialog, 'busy Escape retains modal')
    await act(async () => { resolveContinuation('Already dispatched through durable handoff directive.') })
    assert.match(dialog.textContent ?? '', /已随持久指令交给接续会话/u)
    assert.equal((dialog.querySelector('textarea[aria-label="交接说明"]') as HTMLTextAreaElement).value, 'Already dispatched through durable handoff directive.')
    await click([...dialog.querySelectorAll('button')].find((button) => button.textContent === '打开接续会话') as HTMLButtonElement)
    assert.equal(opens, 1)
    const controls = [...dialog.querySelectorAll<HTMLElement>('textarea, button')]
    controls.at(-1)!.focus()
    await act(async () => { controls.at(-1)!.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }) as unknown as Event) })
    assert.equal(document.activeElement, controls[0], 'ready Tab wraps to the first current control')
    await act(async () => { controls[0]!.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }) as unknown as Event) })
    assert.equal(document.activeElement, controls.at(-1), 'ready Shift+Tab wraps to the last current control')
    await act(async () => { document.activeElement?.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event) })
    assert.equal(document.querySelector('[data-testid="delivery-continuation-dialog"]'), null)
    assert.equal(document.activeElement, trigger)
  } finally {
    await act(async () => root.unmount())
    container.remove(); browser.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
