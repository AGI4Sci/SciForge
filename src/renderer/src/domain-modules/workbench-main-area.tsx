import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, MoveUpRight, RotateCcw, X } from 'lucide-react'
import {
  WORKBENCH_MAIN_AREA_LOCATION,
  type DomainRendererWorkbenchSession,
  type DomainRendererWorkbenchMainAreaContract,
  type DomainRendererWorkbenchMainAreaValue,
  type DomainRendererWorkbenchSurfaceActivation,
  type DomainRendererWorkbenchSessionDockRequest
} from '@sciforge/domain-sdk/renderer'

import {
  RendererSlotRegistry,
  type RegisteredRendererSlotContribution,
  type RendererSlotRegistrationDisposable
} from './renderer-slot-registry'
import {
  fitPageDockSizes, fitPageFloatingBounds, isPageDockLocation, PAGE_DOCK_EDGES, type PageDockEdge, type PageDockPosition,
  type WorkbenchPageLayout
} from '../components/workbench-page-layout'
import { WorkbenchPageSurface } from './workbench-page-surface'
import { useWorkbenchPageGestures } from './workbench-page-gestures'
import './workbench-page-dock.css'

export type WorkbenchMainAreaContribution =
  DomainRendererWorkbenchMainAreaContract &
  DomainRendererWorkbenchMainAreaValue<ReactElement | null> &
  Readonly<{ id: string }>

type WorkbenchMainAreaSlots = {
  [WORKBENCH_MAIN_AREA_LOCATION]: WorkbenchMainAreaContribution
}

export type RegisteredWorkbenchMainAreaContribution = RegisteredRendererSlotContribution<
  WorkbenchMainAreaSlots,
  typeof WORKBENCH_MAIN_AREA_LOCATION
>

export class WorkbenchMainAreaContributionRegistry {
  private readonly slots = new RendererSlotRegistry<WorkbenchMainAreaSlots>()

  register(input: Readonly<{
    id: string
    ownerId: string
    order?: number
    contract: DomainRendererWorkbenchMainAreaContract
    value: DomainRendererWorkbenchMainAreaValue<ReactElement | null>
  }>): RendererSlotRegistrationDisposable {
    return this.slots.register({
      slot: WORKBENCH_MAIN_AREA_LOCATION,
      id: input.id,
      ownerId: input.ownerId,
      order: input.order,
      contribution: Object.freeze({
        id: input.id,
        ...input.contract,
        render: input.value.render
      })
    })
  }

  list(): readonly RegisteredWorkbenchMainAreaContribution[] {
    return this.slots.list(WORKBENCH_MAIN_AREA_LOCATION)
  }

  dispose(): void {
    this.slots.dispose()
  }
}

export type WorkbenchSessionDockHost = Readonly<{
  /** Ids of the current principal's own Sessions; every other id is refused. */
  ownedSessionIds: ReadonlySet<string>
  activeSessionId: string | null
  /** The normal Session UI of the active Session. */
  sessionView: ReactElement
  activateSession: (sessionId: string) => void
  labels: Readonly<{ refused: string; close: string }>
}>

/**
 * Keeps every visited page mounted so its state survives a trip to Session
 * pages. Only the foreground page may dock a Session, so the Session UI is
 * never mounted twice.
 */
export function WorkbenchMainAreaOutlet({ session, pages, activePageId, activations, dock, layout, children, rightPanel, visible = true, centerRef }: {
  session?: DomainRendererWorkbenchSession
  pages: readonly RegisteredWorkbenchMainAreaContribution[]
  activePageId: string | null
  activations?: Readonly<Record<string, DomainRendererWorkbenchSurfaceActivation>>
  dock: WorkbenchSessionDockHost
  layout?: WorkbenchPageLayout
  children?: ReactNode
  rightPanel?: ReactNode
  visible?: boolean
  centerRef?: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const [visited, setVisited] = useState<readonly string[]>([])
  const newlyVisited = pages.filter(({ id }) => (id === activePageId || layout?.isOpen(id)) && !visited.includes(id))
  if (newlyVisited.length) setVisited([...visited, ...newlyVisited.map(({ id }) => id)])
  const root = useRef<HTMLDivElement>(null)
  const gestures = useWorkbenchPageGestures(root, layout)
  const [frontPage, setFrontPage] = useState<string | null>(null)
  const [windowError, setWindowError] = useState(false)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = root.current!
    const update = () => setBounds({ width: element.clientWidth, height: element.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const openEdges = Object.fromEntries(PAGE_DOCK_EDGES.map(edge => [edge, Boolean(layout?.selectedPage(edge))])) as Record<PageDockEdge, boolean>
  const sizes = fitPageDockSizes(layout?.state.sizes ?? { left: 420, right: 480, bottom: 320 }, openEdges, bounds.width, bounds.height)
  const [resizing, setResizing] = useState<PageDockEdge | null>(null)
  const drag = useRef<{ x: number; y: number; size: number; target: HTMLElement; pointerId: number } | null>(null)
  const resize = layout?.resize
  useEffect(() => {
    if (!resizing || !resize || !drag.current) return
    const start = drag.current
    const previousCursor = document.body.style.cursor
    const previousSelection = document.body.style.userSelect
    document.body.style.cursor = resizing === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return
      const delta = resizing === 'bottom' ? start.y - event.clientY
        : (event.clientX - start.x) * (resizing === 'right' ? -1 : 1)
      resize(resizing, start.size + delta)
    }
    const end = (event: PointerEvent) => { if (event.pointerId === start.pointerId) setResizing(null) }
    const cancel = () => setResizing(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', cancel)
      if (start.target.hasPointerCapture?.(start.pointerId)) start.target.releasePointerCapture(start.pointerId)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelection
    }
  }, [resize, resizing])
  return (
    <div ref={root} className="workbench-page-dock" data-page-dock
      style={{ gridTemplateColumns: `${sizes.left}px ${openEdges.left ? 6 : 0}px minmax(0, 1fr) auto ${openEdges.right ? 6 : 0}px ${sizes.right}px`,
        gridTemplateRows: `minmax(0, 1fr) ${openEdges.bottom ? 6 : 0}px ${sizes.bottom}px` }}>
      <div ref={centerRef} className="workbench-page-dock-center-measure" aria-hidden="true" />
      <div hidden={activePageId !== null} className={activePageId ? 'hidden' : 'workbench-page-dock-center'}>{children}</div>
      <div className="workbench-page-dock-previews">{rightPanel}</div>
      {pages.filter(({ id }) => visited.includes(id)).map(({ id, contribution }) => {
        const position = layout?.state.pages[id]?.position ?? 'main'
        const floating = position === 'floating'
        const external = position === 'window'
        const shown = external ? Boolean(layout?.state.pages[id]?.open)
          : visible && (position === 'main' ? id === activePageId : floating ? layout?.isOpen(id) : layout?.selectedPage(position) === id)
        const active = Boolean(shown)
        const tabs = isPageDockLocation(position) && position !== 'main' ? layout?.edgePages(position) ?? [] : pages.filter(page => page.id === id)
        const floatBounds = fitPageFloatingBounds(layout?.state.floating[id] ?? { x: 60, y: 44, width: 600, height: 460 }, bounds.width, bounds.height)
        const movePage = (next: PageDockPosition) => {
          layout?.movePage(id, next, next === 'floating' ? floatBounds : undefined)
          setFrontPage(id)
        }
        return (
          <WorkbenchPageSurface key={id} id={id} title={t(contribution.label)} external={external && Boolean(shown)} hidden={!shown}
            focusKey={layout?.state.pages[id]}
            bounds={layout?.state.windows[id]} onBounds={next => layout?.setFloatingBounds(id, next, true)}
            onReturn={() => layout?.movePage(id, layout.state.docked[id] ?? contribution.docking?.defaultPosition ?? 'main')}
            onError={() => setWindowError(true)}
            style={floating ? { position: 'absolute', left: floatBounds.x, top: floatBounds.y,
              width: floatBounds.width, height: floatBounds.height, zIndex: id === frontPage ? 42 : 40 } : { gridArea: isPageDockLocation(position) ? position : undefined }}>
          {ownerDocument => (
          <div key={id} hidden={!shown} className={shown ? 'workbench-page-dock-page' : 'hidden'}
            data-dock-page={id} data-dock-position={position} onPointerDownCapture={() => { if (floating) setFrontPage(id) }}>
            {contribution.docking && layout ? (
              <header className="workbench-page-dock-header ds-no-drag" title={t('pageDockDragHint')}
                onPointerDown={event => {
                  const target = event.target as HTMLElement
                  const tab = target.closest<HTMLElement>('[data-page-drag-id]')
                  if (!tab && target.closest('button, select')) return
                  gestures.start(event, tab?.dataset.pageDragId ?? id)
                }}
                onDoubleClick={event => {
                  if ((event.target as HTMLElement).closest('button, select')) return
                  movePage(floating || external ? layout.state.docked[id] ?? contribution.docking!.defaultPosition : 'floating')
                }}>
                <GripVertical className="workbench-page-dock-grip h-3.5 w-3.5" aria-hidden="true" />
                <div className="workbench-page-dock-tabs" role="tablist" aria-label={t('pageDockPanels')}>
                  {tabs.map(page => <button key={page.id} type="button" role="tab"
                    data-page-drag-id={page.id}
                    aria-selected={page.id === id} tabIndex={page.id === id ? 0 : -1}
                    aria-controls={`dock-page-${page.id}`} onClick={() => {
                      if (gestures.suppressClick.current) { gestures.suppressClick.current = false; return }
                      layout.openPage(page.id)
                    }}
                    onKeyDown={event => {
                      const index = tabs.findIndex(tab => tab.id === page.id)
                      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                        : event.key === 'ArrowRight' ? (index + 1) % tabs.length
                          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1
                      if (next < 0) return
                      event.preventDefault()
                      layout.openPage(tabs[next].id)
                      requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-dock-page="${tabs[next].id}"] [role="tab"][aria-selected="true"]`)?.focus())
                    }}>{t(page.contribution.label)}</button>)}
                </div>
                <select aria-label={t('pageDockPosition')} title={t('pageDockPosition')} value={position}
                  onChange={event => movePage(event.target.value as PageDockPosition)}>
                  {(['left', 'right', 'bottom', 'main', 'floating', 'window'] as const).map(value => <option key={value} value={value}>{t(`pageDockPosition_${value}`)}</option>)}
                </select>
                {floating || external ? <button type="button" aria-label={t('pageDockReturn')} title={t('pageDockReturn')}
                  onClick={() => movePage(layout.state.docked[id] ?? contribution.docking!.defaultPosition)}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
                {!external ? <button type="button" aria-label={t('pageDockPopOut')} title={t('pageDockPopOut')}
                  onClick={() => movePage('window')}><MoveUpRight className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
                <button type="button" aria-label={t('close')} title={t('close')} onClick={() => layout.closePage(id)}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </header>
            ) : null}
            <div className="workbench-page-dock-content" id={`dock-page-${id}`}>
            {contribution.render({
              active,
              session,
              ownerDocument,
              ...(activations?.[id] ? { activation: activations[id] } : {}),
              className: 'flex min-h-0 min-w-0 flex-1',
              renderSessionDock: (request) =>
                <WorkbenchSessionDock request={request} dock={active && position === 'main' ? dock : null} />
            })}
            </div>
            {floating ? <button type="button" className="workbench-page-float-resize ds-no-drag" aria-label={t('pageDockResizeFloating')}
              onPointerDown={event => gestures.start(event, id, 'resize')}
              onKeyDown={event => {
                const dx = event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0
                const dy = event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0
                if (!dx && !dy) return
                event.preventDefault()
                layout?.setFloatingBounds(id, fitPageFloatingBounds({ ...floatBounds, width: floatBounds.width + dx, height: floatBounds.height + dy }, bounds.width, bounds.height))
              }} /> : null}
          </div>
          )}
          </WorkbenchPageSurface>
        )
      })}
      {PAGE_DOCK_EDGES.filter(edge => openEdges[edge]).map(edge => <div key={edge}
        className={`workbench-page-dock-separator is-${edge} ds-no-drag`} style={{ gridArea: `${edge}Resize` }}
        role="separator" tabIndex={0} aria-label={t('pageDockResize', { position: t(`pageDockPosition_${edge}`) })}
        aria-orientation={edge === 'bottom' ? 'horizontal' : 'vertical'} aria-valuenow={sizes[edge]}
        aria-valuemin={Math.min(sizes[edge], edge === 'bottom' ? 180 : 280)} aria-valuemax={edge === 'bottom' ? 900 : 1_200}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          drag.current = { x: event.clientX, y: event.clientY, size: sizes[edge], target: event.currentTarget, pointerId: event.pointerId }
          event.currentTarget.setPointerCapture?.(event.pointerId)
          setResizing(edge)
        }}
        onKeyDown={event => {
          const delta = edge === 'bottom' ? (event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0)
            : (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0) * (edge === 'right' ? -1 : 1)
          if (!delta) return
          event.preventDefault()
          layout?.resize(edge, sizes[edge] + delta)
        }} />)}
      {resizing ? <div data-native-view-occluder="true" className="workbench-page-dock-resize-shield" style={{ cursor: resizing === 'bottom' ? 'row-resize' : 'col-resize' }} aria-hidden="true" /> : null}
      {gestures.preview ? <div className="workbench-page-drag-overlay" data-native-view-occluder="true" role="dialog" aria-label={t('pageDockDragHint')}>
        {gestures.preview.target ? <div className={`workbench-page-drop-preview is-${gestures.preview.target}`} /> : null}
        <div className="workbench-page-drag-ghost" style={{ left: gestures.preview.x, top: gestures.preview.y,
          width: gestures.preview.width, height: gestures.preview.height }}>{t(pages.find(page => page.id === gestures.preview!.id)!.contribution.label)}</div>
        <div className="workbench-page-drag-hint">{t('pageDockDragHint')}</div>
      </div> : null}
      {windowError ? <div className="workbench-page-window-error" role="alert">{t('pageDockWindowError')} <button type="button" onClick={() => setWindowError(false)}>{t('close')}</button></div> : null}
    </div>
  )
}

function WorkbenchSessionDock({ request, dock }: {
  request: DomainRendererWorkbenchSessionDockRequest<ReactElement | null>
  dock: WorkbenchSessionDockHost | null
}): ReactElement {
  const { sessionId } = request
  const owned = sessionId !== null && dock !== null && dock.ownedSessionIds.has(sessionId)
  const shown = owned && dock?.activeSessionId === sessionId
  const activateSession = dock?.activateSession
  useEffect(() => {
    if (owned && !shown) activateSession?.(sessionId!)
  }, [activateSession, owned, sessionId, shown])
  const close = sessionId === null ? request.onClose : request.onCloseSession
  return (
    <div
      className="workbench-session-dock"
      data-native-view-occluder="true" role="dialog"
      aria-modal="true"
      aria-label={request.label}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.stopPropagation()
        close()
      }}
    >
      <div className="workbench-session-dock-track" data-has-session={sessionId !== null}>
        <div className="workbench-session-dock-surface">{request.companion}</div>
        <div className="workbench-session-dock-surface flex flex-col" inert={sessionId === null}>
          {sessionId !== null && dock !== null ? (
            <>
              <div className="flex shrink-0 justify-end px-2 pt-2">
                <button
                  type="button"
                  className="ds-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  aria-label={dock.labels.close}
                  title={dock.labels.close}
                  onClick={request.onCloseSession}
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
              {!owned ? (
                <p role="alert" className="m-4 text-ds-md text-ds-ink">{dock.labels.refused}</p>
              ) : shown ? dock.sessionView : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
