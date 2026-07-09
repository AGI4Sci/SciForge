import type { ReactNode } from 'react'
import { createWorkspacePreviewHostState } from './host'
import {
  buildWorkspacePreviewChromeModel,
  type WorkspacePreviewChromeInput,
  type WorkspacePreviewChromeModel,
  type WorkspacePreviewToolbarAction
} from './chrome-model'

export type WorkspacePreviewChromeProps = {
  model?: WorkspacePreviewChromeModel
  input?: WorkspacePreviewChromeInput
  children?: ReactNode
  className?: string
  showInspector?: boolean
  onAction?: (action: WorkspacePreviewToolbarAction) => void
}

export function WorkspacePreviewChrome({
  model,
  input,
  children,
  className,
  showInspector = false
}: WorkspacePreviewChromeProps): ReactNode {
  const resolvedModel = model ?? buildWorkspacePreviewChromeModel(input ?? {
    state: createWorkspacePreviewHostState()
  })
  const statusRole = resolvedModel.status.kind === 'error' ? 'alert' : 'status'

  return (
    <section
      className={compactClassName('workspace-preview-chrome', className)}
      data-workspace-preview-chrome
      data-status={resolvedModel.status.kind}
    >
      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-chrome__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
          data-state-variant={resolvedModel.status.kind === 'error' ? resolvedModel.status.variant : undefined}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : null}

      <div className="workspace-preview-chrome__body">{children}</div>

      {showInspector && (resolvedModel.inspector.summary.length || resolvedModel.inspector.sections.length) ? (
        <aside className="workspace-preview-chrome__inspector" aria-label="Workspace preview inspector">
          {resolvedModel.inspector.summary.length ? (
            <dl className="workspace-preview-chrome__inspector-summary">
              {resolvedModel.inspector.summary.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {resolvedModel.inspector.sections.map((section) => (
            <section key={section.id} className="workspace-preview-chrome__inspector-section">
              <h3>{section.title}</h3>
              {section.summary ? <p>{section.summary}</p> : null}
              <dl>
                {section.rows.map((row) => (
                  <div key={row.id}>
                    <dt>{row.label}</dt>
                    <dd>
                      {row.value}
                      {row.description ? <small>{row.description}</small> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </aside>
      ) : null}
    </section>
  )
}

function compactClassName(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
