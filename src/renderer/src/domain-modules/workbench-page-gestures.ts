import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { fitPageFloatingBounds, pageDockDropTarget, type PageDockLocation, type WorkbenchPageLayout } from '../components/workbench-page-layout'

type Gesture = {
  id: string; kind: 'move' | 'resize'; pointerId: number; target: HTMLElement; owner: Window
  startX: number; startY: number; offsetX: number; offsetY: number; width: number; height: number
}
export type PageDragPreview = { id: string; x: number; y: number; width: number; height: number; target: PageDockLocation | null }

const mainPoint = (event: PointerEvent, source: Window) => {
  if (source === window) return { x: event.clientX, y: event.clientY }
  const scale = window.outerWidth / window.innerWidth || 1
  return { x: (event.screenX - window.screenX) / scale,
    y: (event.screenY - window.screenY - window.outerHeight + window.innerHeight * scale) / scale }
}

export function useWorkbenchPageGestures(root: RefObject<HTMLDivElement | null>, layout?: WorkbenchPageLayout) {
  const latest = useRef(layout)
  useLayoutEffect(() => { latest.current = layout })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [preview, setPreview] = useState<PageDragPreview | null>(null)
  const suppressClick = useRef(false)
  const start = (event: ReactPointerEvent<HTMLElement>, id: string, kind: Gesture['kind'] = 'move') => {
    if (event.button !== 0 || !layout) return
    const page = event.currentTarget.closest<HTMLElement>('[data-dock-page]')
    if (!page) return
    event.preventDefault()
    suppressClick.current = false
    const rect = page.getBoundingClientRect()
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-page-drag-id]') ?? event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    setGesture({ id, kind, pointerId: event.pointerId, target: handle, owner: event.currentTarget.ownerDocument.defaultView!,
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top, width: rect.width, height: rect.height })
  }
  useEffect(() => {
    if (!gesture) return
    let moved = false
    let last: PageDragPreview | null = null
    const owner = gesture.owner
    const cursor = owner.document.body.style.cursor, selection = owner.document.body.style.userSelect
    owner.document.body.style.cursor = gesture.kind === 'move' ? 'grabbing' : 'nwse-resize'
    owner.document.body.style.userSelect = 'none'
    const position = (event: PointerEvent) => {
      const rootBounds = root.current!.getBoundingClientRect()
      const point = mainPoint(event, owner)
      const x = point.x - rootBounds.left, y = point.y - rootBounds.top
      return { x, y, bounds: rootBounds, outside: point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) return
      if (!moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 6) return
      moved = true
      const { x, y, bounds } = position(event)
      if (gesture.kind === 'resize') {
        const previous = latest.current?.state.floating[gesture.id]
        if (!previous) return
        latest.current?.setFloatingBounds(gesture.id, fitPageFloatingBounds({ ...previous,
          width: gesture.width + event.clientX - gesture.startX, height: gesture.height + event.clientY - gesture.startY }, bounds.width, bounds.height))
      } else {
        last = { id: gesture.id, x: x - gesture.offsetX, y: y - gesture.offsetY, width: gesture.width, height: gesture.height,
          target: event.ctrlKey ? null : pageDockDropTarget(x, y, bounds.width, bounds.height) }
        setPreview(last)
      }
    }
    const stop = () => { setGesture(null); setPreview(null) }
    const end = (event: PointerEvent) => {
      if (event.pointerId !== gesture.pointerId) return
      if (moved && gesture.kind === 'move' && last) {
        suppressClick.current = true
        window.setTimeout(() => { suppressClick.current = false }, 0)
        const { bounds, outside } = position(event)
        const layout = latest.current
        if (outside) layout?.movePage(gesture.id, 'window', { x: event.screenX - 40, y: event.screenY - 18,
          width: Math.max(400, gesture.width), height: Math.max(320, gesture.height) })
        else if (last.target && !event.ctrlKey) layout?.movePage(gesture.id, last.target)
        else layout?.movePage(gesture.id, 'floating', fitPageFloatingBounds({ x: last.x, y: last.y,
          width: Math.max(400, last.width), height: Math.max(300, last.height) }, bounds.width, bounds.height))
      }
      stop()
    }
    const cancel = (event: PointerEvent) => { if (event.pointerId === gesture.pointerId) stop() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); stop() } }
    owner.addEventListener('pointermove', move)
    owner.addEventListener('pointerup', end)
    owner.addEventListener('pointercancel', cancel)
    owner.addEventListener('blur', stop)
    owner.addEventListener('keydown', escape)
    return () => {
      owner.removeEventListener('pointermove', move)
      owner.removeEventListener('pointerup', end)
      owner.removeEventListener('pointercancel', cancel)
      owner.removeEventListener('blur', stop)
      owner.removeEventListener('keydown', escape)
      if (gesture.target.hasPointerCapture?.(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId)
      owner.document.body.style.cursor = cursor
      owner.document.body.style.userSelect = selection
    }
  }, [gesture, root])
  return { preview, start, suppressClick }
}
