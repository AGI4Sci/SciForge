import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { measureNativeViewViewport } from '@sciforge/domain-sdk/renderer'

import { siyuanEditorPresentResultSchema } from '../editor-contract.js'
import type { SiYuanEditorViewport } from '../editor-contract.js'

/** Measure the explicit active panel and registered Host overlays in its window. */
export function measureSiYuanViewport(element: HTMLElement, active: boolean): SiYuanEditorViewport {
  const window = element.ownerDocument.defaultView!
  const viewport = measureNativeViewViewport(element, active)
  return {
    ...viewport,
    x: Math.round(viewport.x), y: Math.round(viewport.y),
    width: Math.round(viewport.width), height: Math.round(viewport.height),
    ...(window !== globalThis.window ? { windowName: window.name } : {})
  }
}

/**
 * Keeps the package-owned native editor synchronized with its slot. The Host
 * keeps every visited page mounted, so inactive pages hide their native view
 * without discarding the editor's draft, selection or navigation state.
 */
export function useNativeSiYuanPresentation(options: Readonly<{
  active: boolean
  ownerDocument?: Document
  url: string | null
  sessionKey?: string
  reloadRevision?: number
  viewportRef: RefObject<HTMLDivElement | null>
  present: (input: Readonly<{ url: string | null; sessionId?: string; reloadRevision?: number; viewport: SiYuanEditorViewport }>) => Promise<unknown>
  onReady: () => void
  onError: (message: string) => void
}>): void {
  const { active, ownerDocument, url, sessionKey, reloadRevision, viewportRef, present, onReady, onError } = options
  const settled = useRef('')
  const report = useCallback((message: string) => { onError(message) }, [onError])
  useEffect(() => () => {
    void Promise.resolve(present({ url: null, sessionId: sessionKey, viewport: { x: 0, y: 0, width: 0, height: 0, visible: false } }))
      .catch(() => undefined)
  }, [present, sessionKey])
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const document = ownerDocument ?? element.ownerDocument
    const window = document.defaultView!
    let frame = 0
    let disposed = false
    const update = (): void => {
      frame = 0
      if (disposed) return
      // Inactive sessions must use the hide path, not claim the active native
      // surface with an invisible viewport and hide another session's editor.
      const presentedUrl = active ? url : null
      const viewport = presentedUrl === null
        ? { x: 0, y: 0, width: 0, height: 0, visible: false }
        : measureSiYuanViewport(element, active)
      const key = JSON.stringify({ url: presentedUrl, viewport, sessionKey, reloadRevision })
      if (settled.current === key) return
      settled.current = key
      void Promise.resolve(present({ url: presentedUrl, sessionId: sessionKey, reloadRevision, viewport })).then(result => {
        if (!disposed && presentedUrl !== null && viewport.visible) {
          if (siyuanEditorPresentResultSchema.parse(result).presented) onReady()
          else report('editor_unavailable')
        }
      }).catch((failure: unknown) => {
        // Keep this request settled on failure: DOM changes caused by error UI
        // must not immediately resubmit the same failed presentation.
        if (!disposed) report(failure instanceof Error ? failure.message : String(failure))
      })
    }
    const schedule = (): void => { if (!frame && !disposed) frame = window.requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'open', 'data-state', 'data-native-view-occluder'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    update()
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      settled.current = ''
    }
  }, [active, ownerDocument, url, sessionKey, reloadRevision, viewportRef, present, onReady, report])
}
