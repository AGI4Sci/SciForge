import React, { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode, type RefObject } from 'react'
import type { ResearchRecordPresentation } from './research-record-presentation'

export function useRecordSelectionLock(root: RefObject<HTMLElement | null>): boolean {
  const [selected, setSelected] = useState(false)
  useEffect(() => {
    const inspect = () => {
      const selection = window.getSelection()
      setSelected(Boolean(selection && !selection.isCollapsed && root.current?.contains(selection.anchorNode)))
    }
    document.addEventListener('selectionchange', inspect)
    return () => document.removeEventListener('selectionchange', inspect)
  }, [root])
  return selected
}

/** A bounded page replaces its predecessor. No hidden rows or cumulative mounting. */
export function RecordWindow<T>({ items, id, label, presentation, render, pageSize = 20 }: {
  items: readonly T[]; id: string; label: string; presentation: ResearchRecordPresentation
  render: (item: T, index: number) => ReactNode; pageSize?: number
}): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot)
  const key = `window:${id}`
  const offset = Math.min(state.offsets[key] ?? 0, Math.max(0, Math.ceil(items.length / pageSize) - 1) * pageSize)
  const root = useRef<HTMLDivElement>(null)
  const selected = useRecordSelectionLock(root)
  return <div ref={root} data-record-window={id}>
    {items.length > pageSize && <nav aria-label={`${label}显示窗口`} className="my-2 flex flex-wrap items-center gap-2 record-caption text-ds-muted">
      <button className="rounded border border-ds-border px-2 py-1 disabled:opacity-40" disabled={selected || offset === 0} onClick={() => presentation.offset(key, offset - pageSize)}>前一组</button>
      <span>{offset + 1}–{Math.min(offset + pageSize, items.length)} / {items.length} 项</span>
      <button className="rounded border border-ds-border px-2 py-1 disabled:opacity-40" disabled={selected || offset + pageSize >= items.length} onClick={() => presentation.offset(key, offset + pageSize)}>后一组</button>
      {selected && <span role="status">保留活动选区；取消选区后可切换显示组。</span>}
    </nav>}
    {items.slice(offset, offset + pageSize).map((item, index) => render(item, offset + index))}
  </div>
}
