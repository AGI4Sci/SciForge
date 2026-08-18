import type { ReactElement, ReactNode } from 'react'
import type { SessionRightPanelWorkspace } from './session-right-panel-workspaces'
import { RightPanelSessionScope } from './right-panel-session-scope'

type Props = {
  activeSessionId: string | null
  workspaces: readonly SessionRightPanelWorkspace[]
  renderWorkspace: (workspace: SessionRightPanelWorkspace, active: boolean) => ReactNode
}

/**
 * Keeps one stable right-panel subtree per Session. Session focus changes only
 * foreground semantics; a workspace is unmounted only when it is closed or
 * removed from the registry.
 */
export function SessionRightPanelStack({
  activeSessionId,
  workspaces,
  renderWorkspace
}: Props): ReactElement {
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden" data-session-right-panel-stack>
      {workspaces.filter((workspace) => workspace.panes.length > 0).map((workspace) => {
        const active = workspace.sessionId === activeSessionId
        return (
          <section
            key={workspace.instanceKey}
            className={`absolute inset-0 min-h-0 ${active ? '' : 'invisible pointer-events-none'}`}
            aria-hidden={!active}
            inert={!active}
            data-session-right-panel-workspace={workspace.sessionId}
            data-right-panel-pane-count={workspace.panes.length}
            data-right-panel-focused-pane-id={workspace.focusedPaneId ?? undefined}
            data-active={active ? 'true' : 'false'}
          >
            <RightPanelSessionScope sessionId={workspace.sessionId}>
              {renderWorkspace(workspace, active)}
            </RightPanelSessionScope>
          </section>
        )
      })}
    </div>
  )
}
