import { useCallback, useEffect, useState } from 'react'
import type { RegisteredWorkbenchMainAreaContribution } from '../domain-modules/workbench-main-area'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

export const PAGE_DOCK_STORAGE_KEY = 'sciforge.layout.pageDocks.v1'
export const PAGE_DOCK_EDGES = ['left', 'right', 'bottom'] as const
export type PageDockEdge = typeof PAGE_DOCK_EDGES[number]
export type PageDockPosition = PageDockEdge | 'main'
export type PageDockState = {
  pages: Record<string, { position: PageDockPosition; open: boolean }>
  selected: Partial<Record<PageDockEdge, string>>
  sizes: Record<PageDockEdge, number>
}

const isPosition = (value: unknown): value is PageDockPosition =>
  value === 'main' || PAGE_DOCK_EDGES.includes(value as PageDockEdge)
export const clampDockSize = (value: number, min: number, max: number): number =>
  Math.round(Math.max(min, Math.min(max, value)))

export function restorePageDockState(
  pages: readonly RegisteredWorkbenchMainAreaContribution[], raw: string | null
): PageDockState {
  let saved: Partial<PageDockState> = {}
  try { saved = JSON.parse(raw ?? '{}') ?? {} } catch { /* Use declared defaults. */ }
  const entries: PageDockState['pages'] = Object.create(null)
  for (const { id, contribution } of pages) {
    if (!contribution.docking) continue
    const entry = saved.pages?.[id]
    entries[id] = {
      position: isPosition(entry?.position) ? entry.position : contribution.docking.defaultPosition,
      open: entry?.open === true
    }
  }
  const selected: PageDockState['selected'] = {}
  const sizes = { left: 420, right: 480, bottom: 320 }
  for (const edge of PAGE_DOCK_EDGES) {
    const id = saved.selected?.[edge]
    if (typeof id === 'string' && entries[id]?.position === edge && entries[id].open) selected[edge] = id
    const size = saved.sizes?.[edge]
    if (typeof size === 'number' && Number.isFinite(size)) sizes[edge] = clampDockSize(size, edge === 'bottom' ? 180 : 280, edge === 'bottom' ? 900 : 1_200)
    else if (edge !== 'bottom') {
      sizes[edge] = pages.find(({ contribution }) => contribution.docking?.defaultPosition === edge)
        ?.contribution.docking?.preferredWidth ?? sizes[edge]
    }
  }
  return { pages: entries, selected, sizes }
}

/** Fit presentation to the window without replacing the user's saved sizes. */
export function fitPageDockSizes(sizes: PageDockState['sizes'], open: Record<PageDockEdge, boolean>, width: number, height: number) {
  const available = Math.max(0, width - Math.min(320, width * 0.45) - (Number(open.left) + Number(open.right)) * 6)
  const desired = (open.left ? sizes.left : 0) + (open.right ? sizes.right : 0)
  const scale = desired > available ? available / desired : 1
  return {
    left: open.left ? Math.floor(sizes.left * scale) : 0,
    right: open.right ? Math.floor(sizes.right * scale) : 0,
    bottom: open.bottom ? Math.min(sizes.bottom, Math.max(0, height - Math.min(240, height * 0.45) - 6)) : 0
  }
}

export function useWorkbenchPageLayout(
  pages: readonly RegisteredWorkbenchMainAreaContribution[],
  activePageId: string | null,
  setActivePageId: (id: string | null) => void
) {
  const [state, setState] = useState(() => restorePageDockState(pages, readBrowserStorageItem(PAGE_DOCK_STORAGE_KEY)))
  useEffect(() => { writeBrowserStorageItem(PAGE_DOCK_STORAGE_KEY, JSON.stringify(state)) }, [state])

  const openPage = useCallback((id: string): void => {
    if (!pages.some(page => page.id === id)) return
    const position = state.pages[id]?.position ?? 'main'
    setActivePageId(position === 'main' ? id : null)
    if (state.pages[id]) setState(current => ({
      ...current,
      pages: { ...current.pages, [id]: { position, open: true } },
      selected: position === 'main' ? current.selected : { ...current.selected, [position]: id }
    }))
  }, [pages, setActivePageId, state.pages])

  const closePage = useCallback((id: string): void => {
    if (activePageId === id) setActivePageId(null)
    setState(current => current.pages[id] ? {
      ...current, pages: { ...current.pages, [id]: { ...current.pages[id], open: false } }
    } : current)
  }, [activePageId, setActivePageId])

  const movePage = useCallback((id: string, position: PageDockPosition): void => {
    if (!isPosition(position) || !state.pages[id]) return
    if (position === 'main') setActivePageId(id)
    else if (activePageId === id) setActivePageId(null)
    setState(current => ({
      ...current,
      pages: { ...current.pages, [id]: { position, open: true } },
      selected: position === 'main' ? current.selected : { ...current.selected, [position]: id }
    }))
  }, [activePageId, setActivePageId, state.pages])

  const resize = useCallback((edge: PageDockEdge, size: number): void => {
    if (!Number.isFinite(size)) return
    setState(current => ({ ...current, sizes: { ...current.sizes,
      [edge]: clampDockSize(size, edge === 'bottom' ? 180 : 280, edge === 'bottom' ? 900 : 1_200) } }))
  }, [])

  const edgePages = (edge: PageDockEdge) => pages.filter(({ id }) => state.pages[id]?.position === edge && state.pages[id].open)
  const selectedPage = (edge: PageDockEdge): string | null => {
    const entries = edgePages(edge)
    return entries.find(({ id }) => state.selected[edge] === id)?.id ?? entries.at(-1)?.id ?? null
  }
  const isOpen = (id: string): boolean => activePageId === id ||
    Boolean(state.pages[id]?.open && state.pages[id].position !== 'main')

  return { state, openPage, closePage, movePage, resize, edgePages, selectedPage, isOpen }
}

export type WorkbenchPageLayout = ReturnType<typeof useWorkbenchPageLayout>
