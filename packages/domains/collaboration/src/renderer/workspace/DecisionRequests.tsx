import React from 'react'
import type { HumanNeeded, ProjectRecord } from '@sciforge/collaboration-contracts'
import { HumanRequestForm } from './task-drawer/HumanRequestForm.js'
import type { HumanDecision } from './human-request-decision.js'
import { translateWorkspace as cw, useWorkspaceTranslation } from './workspace-i18n.js'

export function DecisionRequests({ requests, records, userId, busy, onAnswer, onDefer }: Readonly<{
  requests: readonly HumanNeeded[]; records: readonly ProjectRecord[]; userId: string | null; busy: boolean
  onAnswer(request: HumanNeeded, answer: string, decision?: HumanDecision, selectedOptionId?: string): Promise<boolean>
  onDefer(request: HumanNeeded, reason: string): Promise<boolean>
}>) {
  useWorkspaceTranslation()
  const pending = requests.filter(request => request.targetUserId === userId && request.status === 'pending')
  const history = records.filter(record => record.kind === 'decision')
  if (!pending.length && !history.length) return null
  return <section className="collaboration-workspace-project-controls" aria-label={cw('待我决策')}>
    <details open={pending.length > 0}><summary>{cw('待我决策')} · {pending.length}</summary>
      {pending.map(request => <HumanRequestForm key={`${request.humanRequestId}:${request.revision}`} request={request} currentUserId={userId} busy={busy}
        onAnswer={(answer, decision, selectedOptionId) => onAnswer(request, answer, decision, selectedOptionId)} onDefer={reason => onDefer(request, reason)} />)}
    </details>
    {history.length ? <details><summary>{cw('决策记录')} · {history.length}</summary>{history.map(record => <article key={record.projectRecordId}><p style={{ whiteSpace: 'pre-wrap' }}>{record.body}</p><small>{record.authorUserId} · <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time></small></article>)}</details> : null}
  </section>
}
