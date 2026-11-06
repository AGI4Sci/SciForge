// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { canDockSideConversation, useSideConversationDock } from './side-conversation-layout'

describe('side conversation reading space', () => {
  it('leaves a readable main surface after the fixed chat and its margins', () => {
    expect(canDockSideConversation(1024)).toBe(true)
    expect(canDockSideConversation(1023)).toBe(false)
    expect(canDockSideConversation(760)).toBe(false)
  })

  it('accounts for an existing right dock, while a full workspace canvas uses the whole stage', () => {
    expect(canDockSideConversation(1280, 400)).toBe(false)
    expect(canDockSideConversation(1280, 0)).toBe(true)
    expect(canDockSideConversation(1500, 400)).toBe(true)
  })

  it('does not dock before the stage has a usable measurement', () => {
    expect(canDockSideConversation(0)).toBe(false)
    expect(canDockSideConversation(Number.NaN)).toBe(false)
    expect(canDockSideConversation(1500, Number.NaN)).toBe(false)
  })

  it('rechecks actual stage space on navigation and window resize, then releases its observer', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let resize!: () => void
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe = observe
      disconnect = disconnect
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let layout!: ReturnType<typeof useSideConversationDock>
    function Harness({ occupied }: { occupied: number }) {
      layout = useSideConversationDock(occupied)
      return <main ref={layout.stageRef} />
    }
    try {
      act(() => root.render(<Harness occupied={0} />))
      const stage = container.querySelector('main')!
      expect(observe).toHaveBeenCalledWith(stage)
      let width = 1280
      Object.defineProperty(stage, 'clientWidth', { get: () => width })
      act(resize)
      expect(layout.dockAvailable).toBe(true)
      act(() => root.render(<Harness occupied={400} />))
      expect(layout.dockAvailable).toBe(false)
      width = 1500
      act(resize)
      expect(layout.dockAvailable).toBe(true)
      width = 980
      act(resize)
      expect(layout.dockAvailable).toBe(false)
    } finally {
      act(() => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
