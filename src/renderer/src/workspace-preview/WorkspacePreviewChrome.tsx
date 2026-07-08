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
  onAction?: (action: WorkspacePreviewToolbarAction) => void
}

export function WorkspacePreviewChrome({
  model,
  input,
  children,
  className,
  onAction
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
      <header className="workspace-preview-chrome__header">
        {resolvedModel.breadcrumb.length ? (
          <nav className="workspace-preview-chrome__breadcrumb" aria-label="Workspace preview breadcrumb">
            {resolvedModel.breadcrumb.map((item, index) => (
              <span key={item.path} className="workspace-preview-chrome__breadcrumb-item">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <span aria-current={item.current ? 'page' : undefined}>{item.label}</span>
              </span>
            ))}
          </nav>
        ) : null}

        <div className="workspace-preview-chrome__title">
          <h2>{resolvedModel.title.text}</h2>
          {resolvedModel.title.subtitle ? <p>{resolvedModel.title.subtitle}</p> : null}
        </div>

        {resolvedModel.toolbar.actions.length ? (
          <div className="workspace-preview-chrome__toolbar" role="toolbar" aria-label="Workspace preview actions">
            {resolvedModel.toolbar.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                data-action-id={action.id}
                data-action-source={action.source}
                disabled={!action.enabled}
                title={action.reason ?? action.label}
                onClick={() => onAction?.(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </header>

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

      {resolvedModel.inspector.summary.length || resolvedModel.inspector.sections.length ? (
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
