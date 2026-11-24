import { useCallback, useEffect, useState } from 'react'
import type { RegisteredWorkbenchMainAreaContribution } from '../domain-modules/workbench-main-area'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

export const PAGE_DOCK_STORAGE_KEY = 'sciforge.layout.pageDocks.v1'
export const PAGE_DOCK_EDGES = ['left', 'right', 'bottom'] as const
export type PageDockEdge = typeof PAGE_DOCK_EDGES[number]
export type PageDockLocation = PageDockEdge | 'main'
export type PageDockPosition = PageDockLocation | 'floating' | 'window'
export type PageFloatingBounds = { x: number; y: number; width: number; height: number }
export type PageDockState = {
  pages: Record<string, { position: PageDockPosition; open: boolean }>
  selected: Partial<Record<PageDockEdge, string>>
  sizes: Record<PageDockEdge, number>
  floating: Record<string, PageFloatingBounds>
  windows: Record<string, PageFloatingBounds>
  docked: Record<string, PageDockLocation>
}

const isPosition = (value: unknown): value is PageDockPosition =>
  value === 'main' || value === 'floating' || value === 'window' || PAGE_DOCK_EDGES.includes(value as PageDockEdge)
export const isPageDockLocation = (value: PageDockPosition): value is PageDockLocation => value !== 'floating' && value !== 'window'
export const clampDockSize = (value: number, min: number, max: number): number =>
  Math.round(Math.max(min, Math.min(max, value)))

export function fitPageFloatingBounds(value: PageFloatingBounds, width: number, height: number): PageFloatingBounds {
  const w = clampDockSize(value.width, Math.min(320, width), Math.max(0, width))
  const h = clampDockSize(value.height, Math.min(200, height), Math.max(0, height))
  return { x: clampDockSize(value.x, 0, Math.max(0, width - w)), y: clampDockSize(value.y, 0, Math.max(0, height - h)), width: w, height: h }
}

/** Edge hot zones plus a compact docking guide in the middle of the workbench. */
export function pageDockDropTarget(x: number, y: number, width: number, height: number): PageDockLocation | null {
  if (x < 0 || y < 0 || x > width || y > height) return null
  const cx = width / 2, cy = height / 2
  for (const [position, dx, dy] of [['left', -52, 0], ['right', 52, 0], ['bottom', 0, 52], ['main', 0, 0]] as const) {
    if (Math.abs(x - cx - dx) <= 22 && Math.abs(y - cy - dy) <= 22) return position
  }
  if (y >= height - Math.min(64, height * 0.15)) return 'bottom'
  if (x <= Math.min(64, width * 0.15)) return 'left'
  if (x >= width - Math.min(64, width * 0.15)) return 'right'
  if (y <= Math.min(48, height * 0.12)) return 'main'
  return null
}

export function restorePageDockState(
  pages: readonly RegisteredWorkbenchMainAreaContribution[], raw: string | null
): PageDockState {
  let saved: Partial<PageDockState> = {}
  try { saved = JSON.parse(raw ?? '{}') ?? {} } catch { /* Use declared defaults. */ }
  const entries: PageDockState['pages'] = Object.create(null)
  const floating: PageDockState['floating'] = Object.create(null)
  const windows: PageDockState['windows'] = Object.create(null)
  const docked: PageDockState['docked'] = Object.create(null)
  for (const { id, contribution } of pages) {
    if (!contribution.docking) continue
    const entry = saved.pages?.[id]
    entries[id] = {
      position: isPosition(entry?.position) ? entry.position : contribution.docking.defaultPosition,
      open: entry?.open === true
    }
    const prior = saved.docked?.[id]
    docked[id] = isPosition(prior) && isPageDockLocation(prior) ? prior : contribution.docking.defaultPosition
    for (const [source, target] of [[saved.floating, floating], [saved.windows, windows]] as const) {
      const rect = source?.[id]
      if (rect && (['x', 'y', 'width', 'height'] as const).every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]))) {
        target[id] = { x: clampDockSize(rect.x, -32_768, 32_768), y: clampDockSize(rect.y, -32_768, 32_768),
          width: clampDockSize(rect.width, 320, 8_192), height: clampDockSize(rect.height, 200, 8_192) }
      }
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
  return { pages: entries, selected, sizes, floating, windows, docked }
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
    if (position !== 'window' && position !== 'floating') setActivePageId(position === 'main' ? id : null)
    if (state.pages[id]) setState(current => ({
      ...current,
      pages: { ...current.pages, [id]: { position, open: true } },
      selected: isPageDockLocation(position) && position !== 'main' ? { ...current.selected, [position]: id } : current.selected
    }))
  }, [pages, setActivePageId, state.pages])

  const closePage = useCallback((id: string): void => {
    if (activePageId === id) setActivePageId(null)
    setState(current => current.pages[id] ? {
      ...current, pages: { ...current.pages, [id]: { ...current.pages[id], open: false } }
    } : current)
  }, [activePageId, setActivePageId])

  const movePage = useCallback((id: string, position: PageDockPosition, rectangle?: PageFloatingBounds): void => {
    if (!isPosition(position) || !state.pages[id]) return
    if (position === 'main') setActivePageId(id)
    else if (activePageId === id) setActivePageId(null)
    setState(current => ({
      ...current,
      pages: { ...current.pages, [id]: { position, open: true } },
      selected: isPageDockLocation(position) && position !== 'main' ? { ...current.selected, [position]: id } : current.selected,
      docked: isPageDockLocation(position) ? { ...current.docked, [id]: position } : current.docked,
      ...(rectangle && position === 'floating' ? { floating: { ...current.floating, [id]: rectangle } } : {}),
      ...(rectangle && position === 'window' ? { windows: { ...current.windows, [id]: rectangle } } : {})
    }))
  }, [activePageId, setActivePageId, state.pages])

  const setFloatingBounds = useCallback((id: string, rectangle: PageFloatingBounds, external = false): void => {
    if (!Object.values(rectangle).every(Number.isFinite)) return
    const field = external ? 'windows' : 'floating'
    setState(current => current.pages[id] ? { ...current, [field]: { ...current[field], [id]: rectangle } } : current)
  }, [])

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

  /** Sidebar activation toggles visibility; programmatic navigation still opens explicitly. */
  const togglePage = (id: string): void => {
    if (isOpen(id)) closePage(id)
    else openPage(id)
  }

  return { state, openPage, closePage, togglePage, movePage, resize, edgePages, selectedPage, isOpen, setFloatingBounds }
}

export type WorkbenchPageLayout = ReturnType<typeof useWorkbenchPageLayout>
