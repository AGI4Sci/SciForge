import { useEffect, useState, type ReactElement } from 'react'
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
export function WorkbenchMainAreaOutlet({ pages, activePageId, activations, dock }: {
  pages: readonly RegisteredWorkbenchMainAreaContribution[]
  activePageId: string | null
  activations?: Readonly<Record<string, DomainRendererWorkbenchSurfaceActivation>>
  dock: WorkbenchSessionDockHost
}): ReactElement {
  const [visited, setVisited] = useState<readonly string[]>([])
  if (activePageId && !visited.includes(activePageId)) setVisited([...visited, activePageId])
  return (
    <>
      {pages.filter(({ id }) => visited.includes(id)).map(({ id, contribution }) => {
        const active = id === activePageId
        return (
          <div key={id} hidden={!active} className={active ? 'relative flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            {contribution.render({
              active,
              ...(activations?.[id] ? { activation: activations[id] } : {}),
              className: 'flex min-h-0 min-w-0 flex-1',
              renderSessionDock: (request) =>
                <WorkbenchSessionDock request={request} dock={active ? dock : null} />
            })}
          </div>
        )
      })}
    </>
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
