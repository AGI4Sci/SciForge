import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { useState, type ReactElement } from 'react'

export function RenameProjectDialog({ name, busy, error, onSave, onCancel }: Readonly<{ name: string; busy: boolean; error?: string | null; onSave(name: string): void; onCancel(): void }>): ReactElement {
  useWorkspaceTranslation()
  const [value, setValue] = useState(name)
  return <div className="collaboration-workspace-dialog-backdrop">
    <form className="collaboration-workspace-dialog" role="dialog" data-native-view-occluder="true" aria-modal="true" aria-labelledby="rename-project-title" onSubmit={(event) => { event.preventDefault(); if (!busy && value.trim()) onSave(value.trim()) }} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel() }}>
      <h2 id="rename-project-title">{cw("重命名项目")}</h2>
      <label>{cw("项目名称")}<input autoFocus required maxLength={200} value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} /></label>
      <p>{cw("所有成员将看到更新后的项目名称。")}</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="collaboration-workspace-dialog-actions"><button type="button" disabled={busy} onClick={onCancel}>{cw("取消")}</button><button type="submit" disabled={busy || !value.trim() || value.trim() === name}>{busy ? cw("保存中…") : cw("保存")}</button></div>
    </form>
  </div>
}
