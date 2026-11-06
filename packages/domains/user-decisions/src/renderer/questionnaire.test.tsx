// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DecisionQuestionnaire } from './questionnaire.js'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  sessionStorage.clear()
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
const questions = [{ id: 'q', header: '', question: 'Which scope?', options: [{ id: 'a', label: 'All', description: '', recommended: true }] }]
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(text))
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function type(text: string) {
  await act(async () => {
    const area = document.querySelector('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
    area.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
it('requires an explicit choice and preserves a draft when closed without cancelling', async () => {
  const submit = vi.fn(async () => {})
  const cancel = vi.fn(async () => {})
  await act(async () => root.render(<DecisionQuestionnaire requestId="request" questions={questions} status="pending" autoOpen={false} onSubmit={submit} onCancel={cancel} />))
  await click(button('Answer questions'))
  expect(document.querySelector('[role=dialog]')?.getAttribute('aria-modal')).toBe('false')
  expect(button('Submit and continue').disabled).toBe(true)
  await click(document.querySelector('input[type=radio]')!)
  await click(button('Later'))
  expect(cancel).not.toHaveBeenCalled()
  expect(submit).not.toHaveBeenCalled()
  await click(button('Answer questions'))
  expect(document.querySelector<HTMLInputElement>('input[type=radio]')?.checked).toBe(true)
  await click(button('Submit and continue'))
  expect(submit).toHaveBeenCalledWith([{ id: 'q', label: 'All', value: 'All' }])
})
it('accepts Other text, keeps a failed submission editable, and retries', async () => {
  const submit = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(undefined)
  await act(async () => root.render(<DecisionQuestionnaire requestId="other" questions={questions} status="pending" autoOpen={false} onSubmit={submit} onCancel={async () => {}} />))
  await click(button('Answer questions'))
  await click(document.querySelectorAll<HTMLInputElement>('input[type=radio]')[1])
  await type('Only validated structures')
  await click(button('Submit and continue'))
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Disconnected')
  expect(document.querySelector('[role=dialog]')?.getAttribute('aria-modal')).toBe('false')
  await click(button('Submit and continue'))
  expect(submit).toHaveBeenLastCalledWith([{ id: 'q', label: 'Other', value: 'Only validated structures' }])
})

it('opens without stealing focus or blocking background interaction, and can be dragged', async () => {
  const outside = document.createElement('input')
  document.body.append(outside)
  outside.focus()
  const rect = { x: 600, y: 100, left: 600, top: 100, right: 1060, bottom: 500, width: 460, height: 400, toJSON: () => ({}) }
  const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
  try {
    await act(async () => root.render(<DecisionQuestionnaire requestId="floating" questions={questions} status="pending" autoOpen={true} onSubmit={async () => {}} onCancel={async () => {}} />))
    expect(document.querySelector('[role=dialog]')).not.toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.value = 'Still editing the conversation'
    expect(outside.disabled).toBe(false)
    expect(outside.closest('[inert]')).toBeNull()
    const header = document.querySelector<HTMLElement>('[aria-label="Move questionnaire window with arrow keys"]')!
    header.setPointerCapture = vi.fn()
    header.hasPointerCapture = () => true
    header.releasePointerCapture = vi.fn()
    await act(async () => {
      header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 650, clientY: 120 }))
      header.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 400, clientY: 220 }))
      header.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    })
    const panel = document.querySelector<HTMLElement>('[role=dialog]')!
    expect(panel.style.left).toBe('350px')
    expect(panel.style.top).toBe('200px')
    expect(document.activeElement).toBe(outside)
    expect(JSON.parse(sessionStorage.getItem('sciforge:user-input:window-position')!)).toEqual({ left: 350, top: 200 })
  } finally { rects.mockRestore(); bounds.mockRestore(); outside.remove() }
})

it.each(['pending', 'error'] as const)('submits every answer and additional context from a %s two-question dialog', async (status) => {
  const submit = vi.fn(async () => {})
  const multi = [...questions, { id: 'q2', header: '', question: 'What else?', options: [] }]
  await act(async () => root.render(<DecisionQuestionnaire requestId="multi" questions={multi} status={status} autoOpen={false} onSubmit={submit} onCancel={async () => {}} />))
  await click(button('Answer questions'))
  await click(document.querySelector('input[type=radio]')!)
  await type('Include controls')
  await click(button('Next'))
  await type('Compare overlapping contributions')
  await click(button('Submit and continue'))
  expect(submit).toHaveBeenCalledExactlyOnceWith([
    { id: 'q', label: 'All', value: 'All\n\nInclude controls' },
    { id: 'q2', label: 'Answer', value: 'Compare overlapping contributions' }
  ])
  expect(document.querySelector('[role=dialog]')).toBeNull()
})
