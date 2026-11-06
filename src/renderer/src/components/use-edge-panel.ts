import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

export type EdgePanelBehavior = 'pinned' | 'auto' | 'hidden'

export function normalizeEdgePanelBehavior(value: unknown): EdgePanelBehavior {
  return value === 'auto' || value === 'hidden' ? value : 'pinned'
}

/** Display preference only. Revealing a panel never creates or stops a Session. */
export function useEdgePanel({ storageKey, open, onOpenChange, panelRef: providedRef }: {
  storageKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
  panelRef?: RefObject<HTMLDivElement | null>
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const panelRef = providedRef ?? ownRef
  const [behavior, setBehaviorState] = useState<EdgePanelBehavior>(() =>
    normalizeEdgePanelBehavior(readBrowserStorageItem(storageKey)))
  const current = useRef({ behavior, open, onOpenChange })
  current.current = { behavior, open, onOpenChange }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  useEffect(() => {
    if (current.current.behavior !== 'pinned') current.current.onOpenChange(false)
    return clearTimer
  }, [clearTimer])
  const setBehavior = useCallback((value: EdgePanelBehavior) => {
    clearTimer()
    setBehaviorState(value)
    writeBrowserStorageItem(storageKey, value)
    current.current.onOpenChange(value === 'pinned')
  }, [clearTimer, storageKey])
  const reveal = useCallback(() => {
    clearTimer()
    current.current.onOpenChange(true)
  }, [clearTimer])
  const scheduleReveal = useCallback(() => {
    clearTimer()
    if (current.current.behavior !== 'auto') return
    timer.current = setTimeout(reveal, 180)
  }, [clearTimer, reveal])
  const scheduleHide = useCallback(() => {
    clearTimer()
    if (current.current.behavior !== 'auto') return
    timer.current = setTimeout(() => {
      const panel = panelRef.current
      const selection = window.getSelection()
      if (!panel || panel.contains(document.activeElement) || panel.matches(':hover') ||
        (selection && !selection.isCollapsed && panel.contains(selection.anchorNode))) return
      current.current.onOpenChange(false)
    }, 550)
  }, [clearTimer, panelRef])
  return {
    behavior,
    setBehavior,
    panelRef,
    edgeVisible: behavior === 'auto' && !open,
    panelProps: {
      onPointerEnter: clearTimer,
      onPointerLeave: scheduleHide,
      onFocusCapture: clearTimer,
      onBlurCapture: scheduleHide
    },
    edgeProps: {
      onPointerEnter: scheduleReveal,
      onPointerLeave: clearTimer,
      onClick: reveal
    }
  }
}
