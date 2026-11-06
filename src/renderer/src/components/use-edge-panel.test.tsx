// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEdgePanel } from './use-edge-panel'

let root: Root
let container: HTMLDivElement
let panel: ReturnType<typeof useEdgePanel>
let visible = false

beforeEach(() => {
  vi.useFakeTimers()
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  function Harness() {
    const [open, setOpen] = useState(false)
    visible = open
    panel = useEdgePanel({ storageKey: 'test.edge', open, onOpenChange: setOpen })
    return <div ref={panel.panelRef} {...panel.panelProps}><textarea aria-label="draft" /><p>Selected evidence</p></div>
  }
  act(() => root.render(<Harness />))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.getSelection()?.removeAllRanges()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('edge panel behavior', () => {
  it('waits for deliberate proximity and cancels a passing pointer', () => {
    act(() => panel.setBehavior('auto'))
    act(() => { panel.edgeProps.onPointerEnter(); vi.advanceTimersByTime(100); panel.edgeProps.onPointerLeave(); vi.advanceTimersByTime(500) })
    expect(visible).toBe(false)
    act(() => { panel.edgeProps.onPointerEnter(); vi.advanceTimersByTime(200) })
    expect(visible).toBe(true)
    act(() => { panel.panelProps.onPointerLeave(); vi.advanceTimersByTime(600) })
    expect(visible).toBe(false)
  })
  it('does not hide while editing or selecting evidence', () => {
    act(() => { panel.setBehavior('auto'); panel.edgeProps.onClick() })
    const input = container.querySelector('textarea')!
    act(() => input.focus())
    act(() => { panel.panelProps.onPointerLeave(); vi.advanceTimersByTime(600) })
    expect(visible).toBe(true)
    act(() => input.blur())
    const range = document.createRange()
    range.selectNodeContents(container.querySelector('p')!)
    window.getSelection()?.addRange(range)
    act(() => { panel.panelProps.onPointerLeave(); vi.advanceTimersByTime(600) })
    expect(visible).toBe(true)
  })
  it('makes manual and pinned panels independent of pointer proximity', () => {
    act(() => panel.setBehavior('pinned'))
    act(() => { panel.panelProps.onPointerLeave(); vi.advanceTimersByTime(1000) })
    expect(visible).toBe(true)
    act(() => panel.setBehavior('hidden'))
    act(() => { panel.edgeProps.onPointerEnter(); vi.advanceTimersByTime(1000) })
    expect(visible).toBe(false)
    act(() => panel.edgeProps.onClick())
    expect(visible).toBe(true)
  })
})
