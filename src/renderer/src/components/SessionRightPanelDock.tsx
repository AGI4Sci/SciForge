import {
  useEffect,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { ArrowLeft, ArrowRight, PanelRightOpen, X } from 'lucide-react'
import {
  SESSION_RIGHT_PANEL_MIN_WIDTH,
  type SessionRightPanelPane,
  type SessionRightPanelWorkspace
} from './session-right-panel-workspaces'
import { RightPanelSurfaceScope } from './right-panel-session-scope'

export type SessionRightPanelBindingDescriptor = Readonly<{
  id: SessionRightPanelPane['mode']
  label: string
  disabled?: boolean
  allowSplit?: boolean
}>

export type SessionRightPanelDockLabels = Readonly<{
  dock: string
  pane: (input: Readonly<{
    index: number
    bindingLabel: string
    focused: boolean
  }>) => string
  back: string
  forward: string
  binding: string
  switchPane: string
  resize: string
  split: string
  splitAction: string
  close: string
}>

export type SessionRightPanelPaneRenderContext = Readonly<{
  active: boolean
  focused: boolean
}>

export type SessionRightPanelDockProps = Readonly<{
  workspace: SessionRightPanelWorkspace
  active: boolean
  bindings: readonly SessionRightPanelBindingDescriptor[]
  labels: SessionRightPanelDockLabels
  className?: string
  onFocusPane: (sessionId: string, paneId: string) => void
  onNavigatePane: (sessionId: string, paneId: string, offset: -1 | 1) => void
  onRebindPane: (
    sessionId: string,
    paneId: string,
    bindingId: SessionRightPanelPane['mode']
  ) => void
  onBeginResizePane: (
    sessionId: string,
    paneId: string,
    event: ReactPointerEvent<HTMLDivElement>,
    edge: 'start' | 'end'
  ) => void
  onSplitPane: (sessionId: string, paneId: string) => void
  onClosePane: (sessionId: string, paneId: string) => void
  renderPane: (
    pane: SessionRightPanelPane,
    context: SessionRightPanelPaneRenderContext
  ) => ReactNode
}>

type PaneSurfaceProps = Readonly<{
  workspace: SessionRightPanelWorkspace
  pane: SessionRightPanelPane
  index: number
  sessionActive: boolean
  focused: boolean
  bindings: readonly SessionRightPanelBindingDescriptor[]
  labels: SessionRightPanelDockLabels
  onFocusPane: SessionRightPanelDockProps['onFocusPane']
  onSwitchPane: SessionRightPanelDockProps['onFocusPane']
  onNavigatePane: SessionRightPanelDockProps['onNavigatePane']
  onRebindPane: SessionRightPanelDockProps['onRebindPane']
  onBeginResizePane: SessionRightPanelDockProps['onBeginResizePane']
  onSplitPane: SessionRightPanelDockProps['onSplitPane']
  onClosePane: SessionRightPanelDockProps['onClosePane']
  renderPane: SessionRightPanelDockProps['renderPane']
}>

const chromeButtonClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:pointer-events-none disabled:opacity-30'
const RIGHT_PANEL_DIVIDER_WIDTH = 11

function PaneSurface({
  workspace,
  pane,
  index,
  sessionActive,
  focused,
  bindings,
  labels,
  onFocusPane,
  onSwitchPane,
  onNavigatePane,
  onRebindPane,
  onBeginResizePane,
  onSplitPane,
  onClosePane,
  renderPane
}: PaneSurfaceProps): ReactElement {
  const titleId = useId()
  const contentId = useId()
  const selectedBinding = bindings.find((binding) => binding.id === pane.mode)
  const allowSplit = selectedBinding?.allowSplit !== false
  const bindingLabel = selectedBinding?.label ?? pane.mode
  const paneLabel = labels.pane({ index, bindingLabel, focused })
  const canNavigateBack = pane.history.index > 0
  const canNavigateForward = pane.history.index < pane.history.entries.length - 1
  const active = sessionActive && focused
  const focusOwningPane = (): void => {
    if (sessionActive && !focused) onFocusPane(workspace.sessionId, pane.paneId)
  }

  return (
    <div
      className="contents"
      data-right-panel-pane-visibility={focused ? 'focused' : 'background'}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={labels.resize}
        aria-describedby={titleId}
        className="ds-workbench-divider ds-no-drag relative z-20 h-full shrink-0 cursor-col-resize"
        data-right-panel-pane-resizer={pane.paneId}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (!sessionActive) return
          focusOwningPane()
          onBeginResizePane(workspace.sessionId, pane.paneId, event, 'start')
        }}
      />
      <section
        role="region"
        aria-labelledby={titleId}
        className={`flex h-full min-h-0 flex-col bg-ds-sidebar ${workspace.panes.length > 1 ? 'min-w-0 flex-1' : 'shrink-0'} ${
          focused ? 'ring-1 ring-inset ring-accent/35' : ''
        }`}
        style={{
          width: workspace.panes.length > 1 ? undefined : pane.width,
          minWidth: workspace.panes.length > 1 ? 0 : SESSION_RIGHT_PANEL_MIN_WIDTH,
          maxWidth: workspace.panes.length > 1 ? undefined : `calc(100% - ${RIGHT_PANEL_DIVIDER_WIDTH}px)`
        }}
        data-session-right-panel-pane={pane.paneId}
        data-right-panel-pane-instance={pane.instanceKey}
        data-right-panel-mode={pane.mode}
        data-session-active={sessionActive ? 'true' : 'false'}
        data-viewport-visible={focused ? 'true' : 'false'}
        data-active={active ? 'true' : 'false'}
        data-focused={focused ? 'true' : 'false'}
        onPointerDown={focusOwningPane}
        onFocusCapture={focusOwningPane}
      >
        <header
          className="ds-no-drag flex h-9 shrink-0 items-center gap-1 border-b border-ds-border bg-ds-sidebar px-2"
          data-right-panel-pane-header
        >
          <h2 id={titleId} className="sr-only">{paneLabel}</h2>
          <button
            type="button"
            className={chromeButtonClass}
            disabled={!canNavigateBack}
            aria-label={labels.back}
            title={labels.back}
            onClick={() => onNavigatePane(workspace.sessionId, pane.paneId, -1)}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={chromeButtonClass}
            disabled={!canNavigateForward}
            aria-label={labels.forward}
            title={labels.forward}
            onClick={() => onNavigatePane(workspace.sessionId, pane.paneId, 1)}
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {focused && workspace.panes.length > 1 ? (
            <select
              value={pane.paneId}
              aria-label={labels.switchPane}
              title={labels.switchPane}
              className="h-7 w-20 max-w-[35%] shrink-0 truncate rounded-md border border-ds-border bg-ds-card px-1 text-[11.5px] font-medium text-ds-ink outline-none transition hover:bg-ds-hover focus:border-accent/40"
              data-right-panel-pane-switcher
              data-right-panel-pane-switcher-for={pane.paneId}
              onChange={(event) => {
                onSwitchPane(workspace.sessionId, event.currentTarget.value)
              }}
            >
              {workspace.panes.map((entry, paneIndex) => {
                const entryBinding = bindings.find((binding) => binding.id === entry.mode)
                return (
                  <option key={entry.paneId} value={entry.paneId}>
                    {labels.pane({
                      index: paneIndex,
                      bindingLabel: entryBinding?.label ?? entry.mode,
                      focused: false
                    })}
                  </option>
                )
              })}
            </select>
          ) : null}
          <select
            value={pane.mode}
            aria-label={labels.binding}
            aria-controls={contentId}
            className="h-7 min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-[11.5px] font-medium text-ds-muted outline-none transition hover:border-ds-border hover:bg-ds-hover hover:text-ds-ink focus:border-accent/40 focus:text-ds-ink"
            data-right-panel-binding-selector
            onChange={(event) => {
              onRebindPane(
                workspace.sessionId,
                pane.paneId,
                event.currentTarget.value as SessionRightPanelPane['mode']
              )
            }}
          >
            {selectedBinding ? null : (
              <option value={pane.mode}>{pane.mode}</option>
            )}
            {bindings.map((binding) => (
              <option key={binding.id} value={binding.id} disabled={binding.disabled}>
                {binding.label}
              </option>
            ))}
          </select>
          {allowSplit ? (
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={labels.split}
              title={labels.split}
              onClick={() => onSplitPane(workspace.sessionId, pane.paneId)}
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
              <span>{labels.splitAction}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={chromeButtonClass}
            aria-label={labels.close}
            title={labels.close}
            onClick={() => onClosePane(workspace.sessionId, pane.paneId)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div id={contentId} className="min-h-0 flex-1" data-right-panel-pane-content>
          <RightPanelSurfaceScope surfaceId={pane.paneId}>
            {renderPane(pane, { active, focused })}
          </RightPanelSurfaceScope>
        </div>
      </section>
    </div>
  )
}

/**
 * Renders one Session-owned horizontal dock. Pane identity, binding and all
 * mutations remain Host-owned; the callback contract always includes the
 * owning Session and pane identities so resident callbacks cannot retarget
 * whichever pane happens to be globally focused later.
 */
export function SessionRightPanelDock({
  workspace,
  active,
  bindings,
  labels,
  className = '',
  onFocusPane,
  onNavigatePane,
  onRebindPane,
  onBeginResizePane,
  onSplitPane,
  onClosePane,
  renderPane
}: SessionRightPanelDockProps): ReactElement {
  const dockRef = useRef<HTMLDivElement>(null)
  const restorePaneSwitcherFocusRef = useRef(false)
  const paneIdentityKey = workspace.panes
    .map((pane) => `${pane.paneId}:${pane.instanceKey}`)
    .join('\u0000')

  useEffect(() => {
    if (!active || !workspace.focusedPaneId) return
    const dock = dockRef.current
    const focusedPane = Array.from(
      dock?.querySelectorAll<HTMLElement>('[data-session-right-panel-pane]') ?? []
    ).find((element) =>
      element.dataset.sessionRightPanelPane === workspace.focusedPaneId
    )
    if (dock && workspace.panes.length === 1) dock.scrollLeft = 0
    focusedPane?.scrollIntoView?.({ block: 'nearest', inline: 'start' })
    if (restorePaneSwitcherFocusRef.current) {
      dock?.querySelector<HTMLSelectElement>(
        `[data-right-panel-pane-switcher-for="${workspace.focusedPaneId}"]`
      )?.focus()
      restorePaneSwitcherFocusRef.current = false
    }
  }, [active, paneIdentityKey, workspace, workspace.focusedPaneId])

  return (
    <div
      ref={dockRef}
      role="region"
      aria-label={labels.dock}
      className={`flex h-full min-h-0 w-full min-w-0 overflow-x-auto overflow-y-hidden ${className}`}
      data-session-right-panel-dock={workspace.sessionId}
      data-active={active ? 'true' : 'false'}
    >
      {workspace.panes.map((pane, index) => (
        <PaneSurface
          key={pane.instanceKey}
          workspace={workspace}
          pane={pane}
          index={index}
          sessionActive={active}
          focused={active && pane.paneId === workspace.focusedPaneId}
          bindings={bindings}
          labels={labels}
          onFocusPane={onFocusPane}
          onSwitchPane={(sessionId, paneId) => {
            restorePaneSwitcherFocusRef.current = true
            onFocusPane(sessionId, paneId)
          }}
          onNavigatePane={onNavigatePane}
          onRebindPane={onRebindPane}
          onBeginResizePane={onBeginResizePane}
          onSplitPane={onSplitPane}
          onClosePane={onClosePane}
          renderPane={renderPane}
        />
      ))}
    </div>
  )
}
