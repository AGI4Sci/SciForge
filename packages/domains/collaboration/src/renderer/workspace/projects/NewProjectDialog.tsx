import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { ProjectCreationRecovery } from './ProjectCreationRecovery.js'
import type { ProjectCreationRecovery as Recovery } from './project-creation.js'

export function NewProjectDialog({ busy, waiting, error, defaultName = '', recovery, onSubmit, onRetry, onOpenDraft, onCreateOther, onCancel }: Readonly<{
  busy: boolean
  defaultName?: string
  waiting?: string
  error?: string | null
  recovery?: Recovery | null
  onSubmit(name: string, description: string): void
  onRetry?(): void
  onOpenDraft?(): void
  onCreateOther?(): void
  onCancel(): void
}>): ReactElement {
  useWorkspaceTranslation()
  const recoveredProject = recovery?.workspace.projects.find(({ project }) => project.projectId === recovery.createdProjectId)?.project
  const [name, setName] = useState(recoveredProject?.displayName ?? defaultName)
  const [description, setDescription] = useState(recoveredProject?.goal ?? '')
  return (
    <div className="collaboration-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel() }}>
      <section className="collaboration-workspace-dialog collaboration-workspace-new-project-dialog" role="dialog" data-native-view-occluder="true" aria-modal="true" aria-labelledby="new-project-title" onKeyDown={(event) => { if (!busy && event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
        <header>
          <div><p className="collaboration-workspace-eyebrow">{cw("协作项目")}</p><h2 id="new-project-title">{cw("新建项目")}</h2></div>
          <button type="button" className="collaboration-workspace-icon-button" aria-label={cw("关闭")} disabled={busy} onClick={onCancel}><X aria-hidden="true" /></button>
        </header>
        <label>{cw("项目名称")}<input disabled={busy || Boolean(recovery)} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={cw("例如：单细胞 RNA-seq 质控")} /></label>
        <label>{cw("项目说明（选填）")}<textarea disabled={busy || Boolean(recovery)} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={cw("可留空；详细需求创建后在「需求」里填写")} /></label>
        {recovery ? <ProjectCreationRecovery recovery={recovery} busy={busy} onRetry={onRetry} onOpenDraft={onOpenDraft} onCreateOther={onCreateOther ? () => { setName(defaultName); setDescription(''); onCreateOther() } : undefined} /> : <>
          {busy && waiting ? <p role="status">{waiting}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="collaboration-workspace-dialog-actions">
            <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onCancel}>{cw("取消")}</button>
            <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !name.trim()} onClick={() => onSubmit(name.trim(), description.trim())}>{busy ? (waiting ? cw("等待发送…") : cw("处理中…")) : cw("创建项目")}</button>
          </div>
        </>}
        {recovery && error ? <p role="alert">{cw('本次准备未完成，请检查协作连接和运行时设置后重试。')}</p> : null}
      </section>
    </div>
  )
}
