// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { useErrorPresentationStore } from '../../store/error-presentation-store'
import { FloatingComposerSessionFailure } from './FloatingComposerSessionFailure'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  useErrorPresentationStore.setState({ dismissed: {} })
})

it('hides only the dismissed failure across refresh and remount, with session and runtime isolation', async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const receipt = { clientDirectiveId: 'input', revision: 3, payloadDigest: 'a'.repeat(64),
    mode: 'direct' as const, delivery: 'delivered' as const, execution: 'failed' as const, turnId: 'turn-1' }
  const render = async (sessionId = 'A', runtimeId = 'codex', turnId = 'turn-1', revision = 3): Promise<void> => {
    await act(async () => root?.render(<FloatingComposerSessionFailure runtimeId={runtimeId} sessionId={sessionId}
      failure={{ receipt: { ...receipt, turnId, revision } }} busy={false} />))
  }
  await render()
  expect(container.querySelector('[data-testid="session-input-failure"]')).not.toBeNull()
  await act(async () => container?.querySelector<HTMLButtonElement>('[data-testid="session-input-failure-dismiss"]')?.click())
  expect(container.textContent).toBe('')
  await render('A', 'codex', 'turn-1', 4)
  expect(container.textContent).toBe('')
  await act(async () => root?.unmount())
  root = createRoot(container)
  await render()
  expect(container.textContent).toBe('')
  await render('B')
  expect(container.textContent).not.toBe('')
  await render('A', 'dsh')
  expect(container.textContent).not.toBe('')
  await render('A', 'codex', 'turn-2')
  expect(container.textContent).not.toBe('')
  expect(receipt.execution).toBe('failed')
})
