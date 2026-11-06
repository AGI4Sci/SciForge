import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import type { HumanNeeded } from '@sciforge/collaboration-contracts'
import type { HumanDecision } from '../human-request-decision.js'

const effects = { 'workspace-write': '修改工作区文件或数据', 'external-write': '向外部系统写入或发送内容', destructive: '删除或破坏性修改，可能无法撤销' }

/** Key by request/revision in the drawer: changed material cannot inherit a draft decision. */
export function HumanRequestForm({ request, currentUserId, targetName, busy, onAnswer }: Readonly<{
  request: HumanNeeded
  currentUserId?: string | null
  targetName?: string
  busy: boolean
  onAnswer?(answer: string, decision?: HumanDecision): Promise<boolean> | void
}>): ReactElement {
  const [answer, setAnswer] = useState('')
  const [now, setNow] = useState(Date.now)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const action = request.confirmableAction
  const expired = Date.parse(request.expiresAt) <= now
  const own = request.targetUserId === currentUserId
  const unavailable = !own || expired || request.status !== 'pending'
  const disabled = unavailable || busy || sending || !onAnswer
  const send = async (decision?: HumanDecision) => {
    if (disabled || sendingRef.current || !answer.trim() || Date.parse(request.expiresAt) <= Date.now()) return
    sendingRef.current = true
    setSending(true)
    try { if (await onAnswer?.(answer.trim(), decision) === true) setAnswer('') }
    finally { sendingRef.current = false; setSending(false) }
  }
  if (!own) return <section className="collaboration-workspace-task-drawer-action tone-warning" aria-label="等待指定成员">
    <strong>{targetName ?? '成员'} 的 Agent 在等成员{action ? '决定' : '回答'}</strong>
    <p>只有指定成员可以回答或决定。</p>
  </section>
  return <section className="collaboration-workspace-task-drawer-action tone-warning" aria-label={action ? '动作决定' : 'Agent 提问'}>
    <strong>{action ? own ? '请决定是否允许这个动作' : '等待指定成员决定' : own ? 'Agent 在等你回答' : 'Agent 在等成员回答'}</strong>
    <p style={{ whiteSpace: 'pre-wrap' }}>{request.prompt}</p>
    {action ? <>
      <p style={{ whiteSpace: 'pre-wrap' }}><strong>具体动作：</strong>{action.safeSummary}</p>
      <p><strong>影响：</strong>{effects[action.effect]}</p>
      <p>决定仅针对下面这个版本的动作。批准后交由 Agent 继续处理；拒绝后该动作不会获得本次授权，由 Agent 处理拒绝结果。</p>
    </> : null}
    <p>指定成员：{targetName ?? request.targetUserId} · 请求版本 {request.revision}</p>
    <p>有效期至 <time dateTime={request.expiresAt}>{new Date(request.expiresAt).toLocaleString()}</time></p>
    {action ? <details><summary>动作标识与版本详情</summary><p>动作类型：{action.actionType}</p><p style={{ overflowWrap: 'anywhere' }}>动作摘要标识：{action.actionDigest}</p><p>请求：{request.humanRequestId}</p></details> : null}
    {unavailable ? <p role="status">{!own ? '只有指定成员可以回答或决定。' : expired ? '请求已过期，请等待 Agent 更新请求。' : '请求已处理，请查看任务进度。'}</p> : <>
      {action ? <label className="collaboration-workspace-revision-input">决定说明（必填）<textarea aria-label="决定说明" required maxLength={32000} rows={3} disabled={disabled} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="说明批准的依据或拒绝的原因" /></label>
        : <input aria-label="回答" placeholder="输入回答" maxLength={32000} disabled={disabled} value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send() }} />}
      <div className="collaboration-workspace-task-drawer-action-controls">
        {action ? <>
          <button type="button" className="collaboration-workspace-button-primary" disabled={disabled || !answer.trim()} onClick={() => void send('approve')}>批准该动作</button>
          <button type="button" className="collaboration-workspace-button-secondary" disabled={disabled || !answer.trim()} onClick={() => void send('reject')}>拒绝该动作</button>
        </> : <button type="button" className="collaboration-workspace-button-primary" disabled={disabled || !answer.trim()} onClick={() => void send()}>发送</button>}
      </div>
      {busy || sending ? <p role="status">正在提交，请等待决定回执…</p> : null}
    </>}
  </section>
}
