import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { useState, type ReactElement } from 'react'

export function CompleteProjectDialog({ projectName, adopted, requirementsVersion, error, busy, onConfirm, onCancel }: Readonly<{ projectName: string; adopted: number; requirementsVersion: number; error: string | null; busy: boolean; onConfirm(summary: string): void; onCancel(): void }>): ReactElement {
  useWorkspaceTranslation()
  const [summary, setSummary] = useState('')
  return (
    <div className="collaboration-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="collaboration-workspace-dialog" role="dialog" data-native-view-occluder="true" aria-modal="true" aria-labelledby="collaboration-complete-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
        <h2 id="collaboration-complete-title">{cw("结项「{{name}}」", { name: projectName })}</h2>
        <p>{cw("依据已确认的需求 v{{version}}：{{count}} 个工作模块的交付都已采纳。结项后项目标记为已完成，不再派出新任务。", { version: requirementsVersion, count: adopted })}</p>
        <label>{cw("结项总结")}<textarea autoFocus rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={cw("一句话说明项目成果，例如：三组样本质控与注释完成，报告已归档")} /></label>
        {error ? <p className="collaboration-workspace-dialog-error" role="alert">{error}</p> : null}
        <div className="collaboration-workspace-dialog-actions">
          <button type="button" className="collaboration-workspace-button-secondary" onClick={onCancel}>{cw("取消")}</button>
          <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !summary.trim()} onClick={() => onConfirm(summary.trim())}>{busy ? cw("正在结项…") : cw("确认结项")}</button>
        </div>
      </section>
    </div>
  )
}
