import { useLayoutEffect, useRef, useState } from 'react'

export const SIDE_CONVERSATION_WIDTH = 440
const SIDE_CONVERSATION_GAP = 24
const MAIN_READING_WIDTH = 560

/** Use the actual stage width, after navigation, rather than viewport breakpoints. */
export function canDockSideConversation(stageWidth: number, occupiedRightWidth = 0): boolean {
  return Number.isFinite(stageWidth) && Number.isFinite(occupiedRightWidth) &&
    stageWidth - Math.max(0, occupiedRightWidth) >= MAIN_READING_WIDTH + SIDE_CONVERSATION_WIDTH + SIDE_CONVERSATION_GAP
}

export function useSideConversationDock(occupiedRightWidth: number) {
  const stageRef = useRef<HTMLElement>(null)
  const [stageWidth, setStageWidth] = useState(0)
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => setStageWidth(stage.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  return { stageRef, dockAvailable: canDockSideConversation(stageWidth, occupiedRightWidth) }
}
