import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import { taskFileOutputIntentSchema, type ProjectStatus, type Task } from '@sciforge/collaboration-contracts'
import type { z } from 'zod'
import React, { useState, type ReactElement } from 'react'

type Output = z.infer<typeof taskFileOutputIntentSchema>
type Content = Readonly<{ title: string; objective: string; completionCriteria: readonly string[]; output?: Output }>
type TaskState = Pick<Task, 'revision' | 'status' | 'currentExecutionId' | 'currentExecutionState'>
export function TaskContentEditor({ content, task, projectStatus = 'active', pending, canDecide, busy, onSave, onDecide, editOutput = false, output }: Readonly<{ content: Content; task?: TaskState; projectStatus?: ProjectStatus; editOutput?: boolean; output?: Output; pending?: Content | null; canDecide: boolean; busy: boolean; onSave(content: Content, expectedTaskRevision?: number): Promise<boolean>; onDecide(decision: 'approve' | 'reject'): void }>): ReactElement {
  useWorkspaceTranslation()
  const canEditTask = !task || (projectStatus === 'active' && !['completed', 'cancelled'].includes(task.status))
  const canEditRequirements = !task?.currentExecutionId || ['accepted', 'running', 'needs_human'].includes(task.currentExecutionState ?? '')
  const canEdit = canEditTask && !pending
  const [editing, setEditing] = useState(false)
  // The open draft belongs to this revision, even when a background refresh
  // replaces task/content and the parent save callback with newer props.
  const [expectedTaskRevision, setExpectedTaskRevision] = useState<number>()
  const [title, setTitle] = useState(content.title)
  const [objective, setObjective] = useState(content.objective)
  const [criteria, setCriteria] = useState(content.completionCriteria.join('\n'))
  const [fileName, setFileName] = useState(output?.fileName ?? '')
  const [mediaType, setMediaType] = useState(output?.mediaType ?? 'text/plain')
  const [maxBytes, setMaxBytes] = useState(output?.maxBytes ?? 10_485_760)
  const parsedOutput = taskFileOutputIntentSchema.safeParse({ kind: 'delivery.output', fileName, mediaType, maxBytes })
  const outputValid = !editOutput || parsedOutput.success
  const save = async (): Promise<void> => { if (!canEdit || busy || !outputValid) return; if (await onSave({ ...(editOutput ? { output: parsedOutput.success ? parsedOutput.data : undefined } : {}), title: title.trim(), objective: canEditRequirements ? objective.trim() : content.objective, completionCriteria: canEditRequirements ? criteria.split('\n').map((line) => line.trim()).filter(Boolean) : content.completionCriteria }, expectedTaskRevision)) setEditing(false) }
  return <section className="collaboration-workspace-task-content-editor">
    {pending ? <div role="status"><strong>{cw("任务要求变更待确认")}</strong><p>{pending.title}</p><p>{pending.objective}</p><ul>{pending.completionCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul><p>{cw("批准后将结束旧执行，需要按新要求重新派发并接受。")}</p>{canEditTask && canDecide ? <>{canEditRequirements ? <button disabled={busy} onClick={() => onDecide('approve')}>{cw("批准变更")}</button> : null}<button disabled={busy} onClick={() => onDecide('reject')}>{cw("保留原要求")}</button></> : <p>{cw("等待另一方确认。")}</p>}</div> : null}
    {canEdit ? editing ? <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="collaboration-workspace-revision-input">{cw("任务标题")}<input required maxLength={200} disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="collaboration-workspace-revision-input">{cw("任务说明")}<textarea required rows={5} readOnly={!canEditRequirements} disabled={busy} value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
      <label className="collaboration-workspace-revision-input">{cw("验收要求（每行一项）")}<textarea required rows={4} readOnly={!canEditRequirements} disabled={busy} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></label>
      {editOutput ? <fieldset disabled={busy}><legend>{cw("交付文件要求")}</legend>
        <p>{cw("派发前请明确交付文件，执行人可自行上传或让 AI 生成。")}</p>
          <label className="collaboration-workspace-revision-input">{cw("交付文件名")}<input required value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder={cw("例如 data.csv")} /></label>
          <label className="collaboration-workspace-revision-input">{cw("文件媒体类型")}<input required value={mediaType} onChange={(event) => setMediaType(event.target.value)} placeholder={cw("例如 text/csv")} /></label>
          <label className="collaboration-workspace-revision-input">{cw("最大字节数")}<input type="number" required min={1} max={1_073_741_824} step={1} value={maxBytes} onChange={(event) => setMaxBytes(Number(event.target.value))} /></label>
          {!outputValid ? <p role="alert">{cw("请填写有效文件名、媒体类型和大小限制。")}</p> : null}

      </fieldset> : null}
      <p>{cw("已接受的任务修改说明或验收要求，需要另一方确认。")}</p>
      <button type="submit" disabled={busy || !outputValid || !title.trim() || !objective.trim() || !criteria.trim()}>{cw("保存任务")}</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>{cw("取消")}</button>
    </form> : <button type="button" className="collaboration-workspace-button-ghost" disabled={busy} onClick={() => { setExpectedTaskRevision(task?.revision); setTitle(content.title); setObjective(content.objective); setCriteria(content.completionCriteria.join('\n')); setFileName(output?.fileName ?? ''); setMediaType(output?.mediaType ?? 'text/plain'); setMaxBytes(output?.maxBytes ?? 10_485_760); setEditing(true) }}>{cw("编辑任务内容")}</button> : null}
  </section>
}
