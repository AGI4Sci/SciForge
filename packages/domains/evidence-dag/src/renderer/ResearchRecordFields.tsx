import { useSyncExternalStore, type ReactElement } from 'react'
import type { ResearchRecordEdit, ResearchRecordNode } from '../research-record-contract'
import type { ResearchRecordPresentation } from './research-record-presentation'

const field = 'w-full rounded-lg border border-ds-border bg-ds-main p-2 record-text text-ds-ink'
const button = 'rounded-lg border border-ds-border px-2 py-1 record-text text-ds-ink hover:bg-ds-hover disabled:opacity-50'
const lockLabels = { placement: '固定归属', title: '固定标题', summary: '固定摘要' }

export function RecordFields({ node, busy, presentation, onEdit }: {
  node: ResearchRecordNode; busy: boolean; presentation: ResearchRecordPresentation;
  onEdit: (change: ResearchRecordEdit['change']) => Promise<boolean>
}): ReactElement {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const draft = state.fieldDrafts[node.id]
  const title = draft?.title ?? node.title, summary = draft?.summary ?? node.summary
  const save = async (name: 'title' | 'summary', value: string) => {
    if (await onEdit({ kind: 'fields', nodeId: node.id, [name]: value })) presentation.clearFieldDraft(node.id, name)
  }
  return <div className="space-y-2 border-t border-ds-border pt-2">
    <p className="record-caption text-ds-muted">当前范围：{node.title}</p>
    <fieldset disabled={busy} className="flex flex-wrap gap-x-3 gap-y-1" aria-label="独立字段锁定">
      {(Object.keys(lockLabels) as Array<keyof typeof lockLabels>).map(name => <label key={name} className="flex items-center gap-1 record-caption text-ds-muted"><input type="checkbox" checked={node.locks?.[name] ?? false} onChange={event => void onEdit({ kind: 'fields', nodeId: node.id, locks: { [name]: event.target.checked } })} />{lockLabels[name]}</label>)}
    </fieldset>
    <p className="record-caption text-ds-muted">归入阶段只固定归属；标题和摘要可继续整理。</p>
    <details><summary className="cursor-pointer record-caption text-ds-muted">编辑标题或摘要</summary><div className="mt-2 space-y-2">
      <input className={field} aria-label="当前节点标题" value={title} maxLength={512} onChange={event => presentation.draftField(node.id, 'title', event.target.value)} />
      <button className={button} disabled={busy || !title.trim() || title === node.title} onClick={() => void save('title', title)}>保存标题</button>
      <textarea className={field} aria-label="当前节点摘要" rows={3} maxLength={8000} value={summary} onChange={event => presentation.draftField(node.id, 'summary', event.target.value)} />
      <button className={button} disabled={busy || summary === node.summary} onClick={() => void save('summary', summary)}>保存摘要</button>
      <p className="record-caption text-ds-muted">保存后固定该字段；解除固定后可恢复自动更新。</p>
    </div></details>
  </div>
}
