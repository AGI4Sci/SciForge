// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkbenchPageSurface } from './workbench-page-surface'

let root: Root
let container: HTMLElement
let auxiliary: Window & { Event: typeof Event }
let frame: HTMLIFrameElement
let external: (value: boolean) => void
let mounts: number
const error = vi.fn()
function Page({ document }: { document: Document }) {
  const [count, setCount] = useState(0)
  useEffect(() => { mounts += 1 }, [])
  return <button data-owner={document === globalThis.document ? 'main' : 'auxiliary'} onClick={() => setCount(count + 1)}>{count}</button>
}
function Harness() {
  const [popped, setPopped] = useState(false)
  external = setPopped
  return <WorkbenchPageSurface id="fixture.page" title="Fixture" external={popped} onReturn={() => setPopped(false)} onBounds={() => {}} onError={error}>
    {document => <Page document={document} />}
  </WorkbenchPageSurface>
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mounts = 0
  error.mockClear()
  frame = document.createElement('iframe')
  document.body.append(frame)
  auxiliary = frame.contentWindow as typeof auxiliary
  vi.spyOn(auxiliary, 'close').mockImplementation(() => {})
  vi.spyOn(window, 'open').mockReturnValue(auxiliary as unknown as Window)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  frame.remove()
  vi.restoreAllMocks()
})

it('moves the original DOM and React state across windows without remounting', async () => {
  const original = container.querySelector('button')!
  await act(async () => original.click())
  await act(async () => external(true))
  const moved = auxiliary.document.querySelector('button')!
  expect(moved).toBe(original)
  expect(moved.textContent).toBe('1')
  expect(moved.getAttribute('data-owner')).toBe('auxiliary')
  expect(auxiliary.document.title).toBe('Fixture — SciForge')
  await act(async () => moved.click())
  await act(async () => external(false))
  expect(container.querySelector('button')).toBe(original)
  expect(original.textContent).toBe('2')
  expect(original.dataset.owner).toBe('main')
  expect(mounts).toBe(1)
  expect(error).not.toHaveBeenCalled()
})

it('adopts the page back before the auxiliary document unloads', async () => {
  const original = container.querySelector('button')!
  await act(async () => external(true))
  await act(async () => auxiliary.dispatchEvent(new auxiliary.Event('beforeunload')))
  expect(container.querySelector('button')).toBe(original)
  expect(original.dataset.owner).toBe('main')
  expect(mounts).toBe(1)
})

it('returns to the original surface if the platform refuses the new window', async () => {
  vi.mocked(window.open).mockReturnValue(null)
  await act(async () => external(true))
  expect(container.querySelector('button')).not.toBeNull()
  expect(error).toHaveBeenCalledOnce()
  expect(mounts).toBe(1)
})

it('mirrors lazily loaded styles and theme changes into an already open window', async () => {
  await act(async () => external(true))
  const style = document.createElement('style')
  style.textContent = '.late-workspace-style { display: flex; }'
  try {
    await act(async () => { document.head.append(style); await Promise.resolve() })
    expect(auxiliary.document.head.textContent).toContain('late-workspace-style')
    await act(async () => { style.textContent = '.late-workspace-style { display: grid; }'; await Promise.resolve() })
    expect(auxiliary.document.head.textContent).toContain('display: grid')
    await act(async () => { document.documentElement.setAttribute('data-test-theme', 'dark'); await Promise.resolve() })
    expect(auxiliary.document.documentElement.getAttribute('data-test-theme')).toBe('dark')
    await act(async () => { document.documentElement.removeAttribute('data-test-theme'); style.remove(); await Promise.resolve() })
    expect(auxiliary.document.documentElement.hasAttribute('data-test-theme')).toBe(false)
    expect(auxiliary.document.head.textContent).not.toContain('late-workspace-style')
  } finally { style.remove(); document.documentElement.removeAttribute('data-test-theme') }
  expect(mounts).toBe(1)
})
