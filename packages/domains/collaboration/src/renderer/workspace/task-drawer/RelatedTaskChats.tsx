import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import type { WorkerDeliveryView } from '../../../worker-delivery.js'
import { taskChatSegments } from './task-chat-segments.js'
import React, { useEffect, useState } from 'react'
import type { DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import type { TaskChatAssociation } from '../../../chat-association-contract.js'
import type { CollaborationRendererClient } from '../../collaboration-capability-client.js'

export function RelatedTaskChats({ taskId, client, workbench, delivery, active = true, revision }: Readonly<{
  taskId: string
  active?: boolean
  /** Existing collaboration snapshot revision; no independent polling loop. */
  revision?: number
  delivery?: WorkerDeliveryView | null
  client: Pick<CollaborationRendererClient, 'readTaskChats'>
  workbench?: Pick<DomainRendererWorkbenchHost, 'openSession'>
}>) {
  useWorkspaceTranslation()
  const [rows, setRows] = useState<TaskChatAssociation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void client.readTaskChats({ taskId }).then(result => {
      if (!cancelled) { setRows(result.associations); setLoading(false) }
    }).catch(() => { if (!cancelled) { setError(cw("暂时无法读取相关聊天。")); setLoading(false) } })
    return () => { cancelled = true }
  }, [active, client, revision, taskId])
  const sources = [
    ...(delivery?.state !== 'sealed' && delivery?.draft?.sourceChat ? [{ label: cw("当前草稿来源"), source: delivery.draft.sourceChat }] : []),
    ...(delivery?.history.flatMap(entry => entry.sourceChat ? [{ label: cw("第 {{value0}} 版交付来源", { value0: entry.bundle.resultRevision }), source: entry.sourceChat }] : []) ?? [])
  ]
  return <section aria-label={cw("相关聊天")} className="collaboration-workspace-task-drawer-activity">
    <h3>{cw("相关聊天")}</h3>
    <p className="collaboration-workspace-empty-copy">{cw("仅你可见的本机工作记录；打开聊天不会启动任务。")}</p>
    {error ? <p role="alert">{error}</p> : null}
    {sources.length ? <ul aria-label={cw("交付来源")}>{sources.map(({ label, source }) => <li key={`${label}:${source.turnId}`}><button type="button" className="collaboration-workspace-button-ghost" disabled={!workbench?.openSession} onClick={() => {
      void workbench?.openSession?.({ ...source, readOnly: true }).then(opened => { if (!opened) setError(cw("来源聊天暂时无法打开，交付内容仍然保留。")) }).catch(() => setError(cw("来源聊天暂时无法打开，交付内容仍然保留。")))
    }}>{label}</button></li>)}</ul> : null}
    {!rows.length ? loading ? <p role="status">{cw("正在读取相关聊天…")}</p> : !error ? <p>{cw("在聊天中 @ 此任务，发送后会自动记录在这里。")}</p> : null : <ol>{taskChatSegments(rows).map(({ first: row, last, messageCount }) => <li key={`${row.runtimeId}:${row.threadId}:${row.messageId}`}>
      <button type="button" className="collaboration-workspace-button-ghost" disabled={!workbench?.openSession} onClick={() => {
        void workbench?.openSession?.({ runtimeId: row.runtimeId, threadId: row.threadId, turnId: row.turnId, itemId: row.turnId ? row.messageId : undefined, readOnly: true }).then(opened => { if (!opened) setError(cw("聊天暂时无法打开。")) }).catch(() => setError(cw("聊天暂时无法打开。")))
      }}>{cw("查看讨论 ·")}{new Date(last.occurredAt).toLocaleString()} · {messageCount} {cw("条消息")}</button>
    </li>)}</ol>}
  </section>
}
