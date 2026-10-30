import { useLayoutEffect, useMemo, type RefObject } from 'react'
import type { DomainCapabilityResourceHandle } from '@sciforge/domain-sdk/host'
import type { BrowserPresentationInput } from '../contract'
import type { BrowserPreviewCapabilityClient } from './browser-preview-capability-client'
import { createNativePresentationQueue } from './native-presentation-queue'
import { measureNativeBrowserViewport } from './native-viewport-layout'

/** Native child views sit above HTML. Hide them when inactive or occluded by
 * host dialogs/menus, and keep their DIP bounds synchronized with the slot. */
export function useNativeBrowserPresentation(options: Readonly<{
  active: boolean
  fullscreen: boolean
  ready: boolean
  client: BrowserPreviewCapabilityClient
  viewportRef: RefObject<HTMLDivElement | null>
  resourceRef: RefObject<DomainCapabilityResourceHandle | null>
  workspaceRoot: string
  onError: (message: string) => void
}>): void {
  const { active, fullscreen, ready, client, viewportRef, resourceRef, workspaceRoot, onError } = options
  const enqueue = useMemo(() => createNativePresentationQueue((input, resource) => client.present(input, {
    resource, ...(workspaceRoot ? { workspaceId: workspaceRoot } : {})
  })), [client, workspaceRoot])
  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!ready || !element) return
    let frame = 0
    let previous = ''
    let disposed = false
    const present = (input: BrowserPresentationInput): void => {
      const resource = resourceRef.current
      if (!resource) return
      const key = JSON.stringify(input)
      if (previous === key) return
      previous = key
      enqueue({ input, resource, onError: error => {
        previous = ''
        if (!disposed) onError(error instanceof Error ? error.message : String(error))
      } })
    }
    const update = (): void => {
      frame = 0
      if (disposed) return
      present(measureNativeBrowserViewport(element, active))
    }
    const schedule = (): void => { if (!frame && !disposed) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'open', 'data-state'] })
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
      present({ x: 0, y: 0, width: 0, height: 0, visible: false })
    }
  }, [active, fullscreen, ready, enqueue, viewportRef, resourceRef, onError])
}
