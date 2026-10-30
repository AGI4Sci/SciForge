import React, { useState, type ReactElement } from 'react'

export function CompleteProjectDialog({ projectName, adopted, requirementsVersion, error, busy, onConfirm, onCancel }: Readonly<{ projectName: string; adopted: number; requirementsVersion: number; error: string | null; busy: boolean; onConfirm(summary: string): void; onCancel(): void }>): ReactElement {
  const [summary, setSummary] = useState('')
  return (
    <div className="collaboration-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className="collaboration-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="collaboration-complete-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
        <h2 id="collaboration-complete-title">结项「{projectName}」</h2>
        <p>依据已确认的需求 v{requirementsVersion}：{adopted} 个工作模块的交付都已采纳。结项后项目标记为已完成，不再派出新任务。</p>
        <label>结项总结<textarea autoFocus rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="一句话说明项目成果，例如：三组样本质控与注释完成，报告已归档" /></label>
        {error ? <p className="collaboration-workspace-dialog-error" role="alert">{error}</p> : null}
        <div className="collaboration-workspace-dialog-actions">
          <button type="button" className="collaboration-workspace-button-secondary" onClick={onCancel}>取消</button>
          <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !summary.trim()} onClick={() => onConfirm(summary.trim())}>{busy ? '正在结项…' : '确认结项'}</button>
        </div>
      </section>
    </div>
  )
}
