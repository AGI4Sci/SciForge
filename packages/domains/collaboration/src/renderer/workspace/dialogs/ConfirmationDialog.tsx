import React, { type ReactElement } from 'react'

export function ConfirmationDialog({ title, message, confirmLabel = '确认', busy = false, error, onConfirm, onCancel }: Readonly<{ title: string; message: string; confirmLabel?: string; busy?: boolean; error?: string | null; onConfirm(): void; onCancel(): void }>): ReactElement {
  return (
    <div className="collaboration-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel() }}>
      <section className="collaboration-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="collaboration-dialog-title" onKeyDown={(event) => { if (!busy && event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
        <h2 id="collaboration-dialog-title">{title}</h2>
        <p>{message}</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="collaboration-workspace-dialog-actions">
          <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="collaboration-workspace-button-primary" autoFocus disabled={busy} onClick={onConfirm}>{busy ? '处理中…' : confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}
