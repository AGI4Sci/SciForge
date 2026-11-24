import { translateWorkspace as cw, useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import type { HumanNeeded } from '@sciforge/collaboration-contracts'
import type { HumanDecision } from '../human-request-decision.js'

const effects = { 'workspace-write': '修改工作区文件或数据', 'external-write': '向外部系统写入或发送内容', destructive: '删除或破坏性修改，可能无法撤销' }

/** Key by request/revision in the drawer: changed material cannot inherit a draft decision. */
export function HumanRequestForm({ request, currentUserId, targetName, busy, onAnswer, onDefer }: Readonly<{
  request: HumanNeeded
  currentUserId?: string | null
  targetName?: string
  busy: boolean
  onAnswer?(answer: string, decision?: HumanDecision, selectedOptionId?: string): Promise<boolean> | void
  onDefer?(reason: string): Promise<boolean> | void
}>): ReactElement {
  useWorkspaceTranslation()
  const [answer, setAnswer] = useState('')
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const choice = request.interaction.kind === 'choice' ? request.interaction : null
  const [now, setNow] = useState(Date.now)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const action = request.confirmableAction
  const projectDecision = action?.actionType === 'collaboration.project.decision'
  const approveLabel = projectDecision ? cw("批准提案") : cw("批准该动作")
  const rejectLabel = projectDecision ? cw("拒绝提案") : cw("拒绝该动作")
  const expired = Date.parse(request.expiresAt) <= now
  const own = request.targetUserId === currentUserId
  const unavailable = !own || expired || request.status !== 'pending'
  const disabled = unavailable || busy || sending || !onAnswer
  const send = async (decision?: HumanDecision) => {
    if (disabled || sendingRef.current || (choice ? !selectedOptionId : decision === 'approve' ? false : !answer.trim()) || Date.parse(request.expiresAt) <= Date.now()) return
    sendingRef.current = true
    setSending(true)
    try { if (await onAnswer?.(choice ? [choice.options.find(option => option.id === selectedOptionId)!.label, answer.trim()].filter(Boolean).join(' — ') : answer.trim() || approveLabel, decision, selectedOptionId || undefined) === true) setAnswer('') }
    finally { sendingRef.current = false; setSending(false) }
  }
  if (!own) return <section className="collaboration-workspace-task-drawer-action tone-warning" aria-label={cw("等待指定成员")}>
    <strong>{targetName ?? cw("成员")}{' '}{cw("的 Agent 在等成员")}{action ? cw("决定") : cw("回答")}</strong>
    <p>{cw("只有指定成员可以回答或决定。")}</p>
  </section>
  return <section className="collaboration-workspace-task-drawer-action tone-warning" aria-label={action ? cw("动作决定") : cw("Agent 提问")}>
    <strong>{action ? own ? projectDecision ? cw("请决定是否批准这份项目提案") : cw("请决定是否允许这个动作") : cw("等待指定成员决定") : own ? cw("Agent 在等你回答") : cw("Agent 在等成员回答")}</strong>
    <p style={{ whiteSpace: 'pre-wrap' }}>{request.prompt}</p>
    {action ? <>
      <p style={{ whiteSpace: 'pre-wrap' }}><strong>{cw("具体动作：")}</strong>{action.safeSummary}</p>
      <p><strong>{cw("影响：")}</strong>{cw(effects[action.effect])}</p>
      <p>{projectDecision ? cw("批准后仅记录这份项目提案的决定；派发或启动任务需要另行授权。") : cw("决定仅针对下面这个版本的动作。批准后交由 Agent 继续处理；拒绝后该动作不会获得本次授权，由 Agent 处理拒绝结果。")}</p>
    </> : null}
    <p>{cw("指定成员：")}{targetName ?? request.targetUserId}{' '}{cw("· 请求版本")}{' '}{request.revision}</p>
    <p>{cw("有效期至")}{' '}<time dateTime={request.expiresAt}>{new Date(request.expiresAt).toLocaleString()}</time></p>
    {action ? <details><summary>{cw("动作标识与版本详情")}</summary><p>{cw("动作类型：")}{action.actionType}</p><p style={{ overflowWrap: 'anywhere' }}>{cw("动作摘要标识：")}{action.actionDigest}</p><p>{cw("请求：")}{request.humanRequestId}</p></details> : null}
    {request.deferred ? <p>{cw("已暂缓")} · {request.deferred.reason}</p> : null}
    {choice ? <fieldset disabled={disabled}><legend>{cw("选择方案")}</legend>{choice.options.map(option => <label key={option.id} style={{ display: 'block' }}><input type="radio" name={request.humanRequestId} value={option.id} checked={selectedOptionId === option.id} onChange={() => setSelectedOptionId(option.id)} />{option.label}{choice.recommendedOptionId === option.id ? ` · ${cw("推荐")}` : ''}{option.description ? <p>{option.description}</p> : null}</label>)}</fieldset> : null}
    {unavailable ? <p role="status">{!own ? cw("只有指定成员可以回答或决定。") : expired ? cw("请求已过期，请等待 Agent 更新请求。") : cw("请求已处理，请查看任务进度。")}</p> : <>
      {action ? <label className="collaboration-workspace-revision-input">{cw("决定说明（拒绝时必填）")}<textarea aria-label={cw("决定说明")} maxLength={32000} rows={3} disabled={disabled} value={answer} onChange={event => setAnswer(event.target.value)} placeholder={cw("说明批准的依据或拒绝的原因")} /></label>
        : <input aria-label={cw("回答")} placeholder={cw("输入回答")} maxLength={32000} disabled={disabled} value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send() }} />}
      <div className="collaboration-workspace-task-drawer-action-controls">
        {action ? <>
          <button type="button" className="collaboration-workspace-button-primary" disabled={disabled} onClick={() => void send('approve')}>{approveLabel}</button>
          <button type="button" className="collaboration-workspace-button-secondary" disabled={disabled || !answer.trim()} onClick={() => void send('reject')}>{rejectLabel}</button>
        </> : <button type="button" className="collaboration-workspace-button-primary" disabled={disabled || (choice ? !selectedOptionId : !answer.trim())} onClick={() => void send()}>{cw("发送")}</button>}
        {onDefer ? <button type="button" disabled={disabled || !answer.trim()} onClick={() => { void onDefer(answer.trim()) }}>{cw("暂缓并记录原因")}</button> : null}
      </div>
      {busy || sending ? <p role="status">{cw("正在提交，请等待决定回执…")}</p> : null}
    </>}
  </section>
}
