import React, { useState, type ReactElement } from 'react'
import { X } from 'lucide-react'

export function NewProjectDialog({ busy, waiting, error, onSubmit, onCancel }: Readonly<{ busy: boolean; waiting?: string; error?: string | null; onSubmit(name: string, description: string): void; onCancel(): void }>): ReactElement {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div className="collaboration-workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel() }}>
      <section className="collaboration-workspace-dialog collaboration-workspace-new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onKeyDown={(event) => { if (!busy && event.key === 'Escape') { event.preventDefault(); onCancel() } }}>
        <header>
          <div><p className="collaboration-workspace-eyebrow">协作项目</p><h2 id="new-project-title">新建项目</h2></div>
          <button type="button" className="collaboration-workspace-icon-button" aria-label="关闭" disabled={busy} onClick={onCancel}><X aria-hidden="true" /></button>
        </header>
        <label>项目名称<input disabled={busy} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：单细胞 RNA-seq 质控" /></label>
        <label>项目说明<textarea disabled={busy} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="一两句话说明目标；详细需求创建后在「需求」里填写" /></label>
        {busy && waiting ? <p role="status">{waiting}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="collaboration-workspace-dialog-actions">
          <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !name.trim() || !description.trim()} onClick={() => onSubmit(name.trim(), description.trim())}>{busy ? (waiting ? '等待发送…' : '处理中…') : '创建项目'}</button>
        </div>
      </section>
    </div>
  )
}
