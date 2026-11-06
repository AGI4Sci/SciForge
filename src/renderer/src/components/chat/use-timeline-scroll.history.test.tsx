// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useTimelineScroll, type UseTimelineScrollResult } from './use-timeline-scroll'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('reveals server history across the collapse threshold and retains the viewport', async () => {
  const mount = document.createElement('div')
  const viewport = document.createElement('div')
  const ref = createRef<HTMLDivElement>()
  ref.current = viewport
  viewport.scrollTo = vi.fn()
  let height = 1000
  Object.defineProperty(viewport, 'scrollHeight', { get: () => height })
  viewport.scrollTop = 20
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let controls!: UseTimelineScrollResult
  const root = createRoot(mount)
  function Harness({ total, content }: { total: number; content: string }) {
    controls = useTimelineScroll({ containerRef: ref, activeThreadId: 'thread', pageSize: 18,
      autoCollapseThreshold: 30, totalTurns: total, busy: true,
      scrollDeps: { contentKey: content, streaming: false, userTurnKey: 'latest' } })
    return <span>{controls.hiddenTurnCount}</span>
  }
  try {
    await act(async () => root.render(<Harness total={20} content="recent" />))
    frames.splice(0)
    let resolve!: () => void
    const pending = new Promise<void>(done => { resolve = done })
    let load!: Promise<void>
    await act(async () => { load = controls.loadEarlierHistory(() => pending) })
    await act(async () => {
      height = 2000
      root.render(<Harness total={40} content="older" />)
      resolve()
      await load
    })
    expect(controls.hiddenTurnCount).toBe(0)
    for (const cb of frames.splice(0)) cb(0)
    expect(viewport.scrollTop).toBe(1020)
    // A further page can extend the same turn without changing its count.
    await act(async () => {
      await controls.loadEarlierHistory(async () => {
        height = 2400
        root.render(<Harness total={40} content="first-message" />)
      })
    })
    for (const cb of frames.splice(0)) cb(0)
    expect(controls.hiddenTurnCount).toBe(0)
    expect(viewport.scrollTop).toBe(1420)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
