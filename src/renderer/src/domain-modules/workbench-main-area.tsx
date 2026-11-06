import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import {
  WORKBENCH_MAIN_AREA_LOCATION,
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
  fitPageDockSizes, PAGE_DOCK_EDGES, type PageDockEdge, type PageDockPosition,
  type WorkbenchPageLayout
} from '../components/workbench-page-layout'
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
export function WorkbenchMainAreaOutlet({ pages, activePageId, activations, dock, layout, children, rightPanel, visible = true, centerRef }: {
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
        const active = visible && (position === 'main' ? id === activePageId : layout?.selectedPage(position) === id)
        const tabs = position === 'main' ? pages.filter(page => page.id === id) : layout?.edgePages(position) ?? []
        return (
          <div key={id} hidden={!active} className={active ? 'workbench-page-dock-page' : 'hidden'}
            style={{ gridArea: position }} data-dock-page={id} data-dock-position={position}>
            {contribution.docking && layout ? (
              <header className="workbench-page-dock-header ds-no-drag">
                <div className="workbench-page-dock-tabs" role="tablist" aria-label={t('pageDockPanels')}>
                  {tabs.map(page => <button key={page.id} type="button" role="tab"
                    aria-selected={page.id === id} tabIndex={page.id === id ? 0 : -1}
                    aria-controls={`dock-page-${page.id}`} onClick={() => layout.openPage(page.id)}
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
                  onChange={event => layout.movePage(id, event.target.value as PageDockPosition)}>
                  {(['left', 'right', 'bottom', 'main'] as const).map(value => <option key={value} value={value}>{t(`pageDockPosition_${value}`)}</option>)}
                </select>
                <button type="button" aria-label={t('close')} title={t('close')} onClick={() => layout.closePage(id)}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </header>
            ) : null}
            <div className="workbench-page-dock-content" id={`dock-page-${id}`}>
            {contribution.render({
              active,
              ...(activations?.[id] ? { activation: activations[id] } : {}),
              className: 'flex min-h-0 min-w-0 flex-1',
              renderSessionDock: (request) =>
                <WorkbenchSessionDock request={request} dock={active && position === 'main' ? dock : null} />
            })}
            </div>
          </div>
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
      {resizing ? <div className="workbench-page-dock-resize-shield" style={{ cursor: resizing === 'bottom' ? 'row-resize' : 'col-resize' }} aria-hidden="true" /> : null}
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
      role="dialog"
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
                <p role="alert" className="m-4 text-[13px] text-ds-ink">{dock.labels.refused}</p>
              ) : shown ? dock.sessionView : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
