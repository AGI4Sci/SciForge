import { useCallback, useEffect, useRef, type RefObject } from 'react'

import type { SiYuanEditorViewport } from '../editor-contract.js'

/**
 * Mirrors the Host's own native-view hit testing (see the Browser Preview
 * package): a native child view sits above all HTML, so it must hide itself
 * whenever the page is inactive, occluded by a Host overlay, or scrolled out of
 * its clipping ancestors.
 */
export function measureSiYuanViewport(element: HTMLElement, active: boolean): SiYuanEditorViewport {
  const rect = element.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right)
  let bottom = Math.min(window.innerHeight, rect.bottom)
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    if (/(hidden|clip|auto|scroll)/u.test(style.overflowX)) {
      left = Math.max(left, bounds.left)
      right = Math.min(right, bounds.right)
    }
    if (/(hidden|clip|auto|scroll)/u.test(style.overflowY)) {
      top = Math.max(top, bounds.top)
      bottom = Math.min(bottom, bounds.bottom)
    }
  }
  const overlayIntersects = Array.from(document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="tooltip"], dialog[open], [data-radix-popper-content-wrapper]'
  )).some((overlay) => {
    if (overlay.contains(element) || element.contains(overlay)) return false
    const bounds = overlay.getBoundingClientRect()
    const style = getComputedStyle(overlay)
    return style.visibility !== 'hidden' && style.display !== 'none' && bounds.width > 0 && bounds.height > 0 &&
      bounds.right > left && bounds.left < right && bounds.bottom > top && bounds.top < bottom
  })
  const covered = [
    [left + 1, top + 1], [right - 1, top + 1],
    [left + 1, bottom - 1], [right - 1, bottom - 1],
    [(left + right) / 2, (top + bottom) / 2]
  ].some(([x, y]) => {
    const hit = document.elementFromPoint(x, y)
    // Part of this page's own scaffold — the loading and error overlay. It is
    // not a Host overlay, and the native view paints above it, so treating it as
    // occluding would hide the view forever and keep the overlay that caused it.
    if (hit?.closest('[data-siyuan-scaffold]')) return false
    return !element.contains(hit)
  })
  const visible = active && !document.hidden && !overlayIntersects && !covered &&
    element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    right > left && bottom > top
  return {
    x: Math.min(32_768, Math.max(0, Math.round(left))),
    y: Math.min(32_768, Math.max(0, Math.round(top))),
    width: Math.min(8_192, Math.max(0, Math.round(right - left))),
    height: Math.min(8_192, Math.max(0, Math.round(bottom - top))),
    visible
  }
}

/**
 * Keeps the package-owned native editor synchronized with its slot. The Host
 * keeps every visited main-area page mounted, so an inactive page must detach
 * rather than merely hide behind HTML.
 */
export function useNativeSiYuanPresentation(options: Readonly<{
  active: boolean
  url: string | null
  viewportRef: RefObject<HTMLDivElement | null>
  present: (input: Readonly<{ url: string | null; viewport: SiYuanEditorViewport }>) => Promise<unknown>
  onReady: () => void
  onError: (message: string) => void
}>): void {
  const { active, url, viewportRef, present, onReady, onError } = options
  const settled = useRef('')
  const report = useCallback((message: string) => { onError(message) }, [onError])
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    let frame = 0
    let disposed = false
    const update = (): void => {
      frame = 0
      if (disposed) return
      const viewport = url === null
        ? { x: 0, y: 0, width: 0, height: 0, visible: false }
        : measureSiYuanViewport(element, active)
      const key = JSON.stringify({ url, viewport })
      if (settled.current === key) return
      settled.current = key
      void Promise.resolve(present({ url, viewport })).then(() => {
        if (!disposed && url !== null && viewport.visible) onReady()
      }).catch((failure: unknown) => {
        settled.current = ''
        if (!disposed) report(failure instanceof Error ? failure.message : String(failure))
      })
    }
    const schedule = (): void => { if (!frame && !disposed) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'open', 'data-state'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    update()
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      settled.current = ''
      void Promise.resolve(present({ url: null, viewport: { x: 0, y: 0, width: 0, height: 0, visible: false } }))
        .catch(() => undefined)
    }
  }, [active, url, viewportRef, present, onReady, report])
}