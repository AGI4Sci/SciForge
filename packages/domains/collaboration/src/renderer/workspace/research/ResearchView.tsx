import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowUp, ArrowUpRight, FlaskConical, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import type { TaskCardModel } from '../workspace-types.js'
import { adoptedResearchResults, projectResearchSession, type ResearchQuestion } from './research-conversation.js'
import type { ProjectCoordinatorRendererClient } from '../../../coordinator/renderer/project-coordinator-capability-client.js'

const SESSION_CHECKING = 'checking'

export function ResearchView({ model, client, busy, onSend, onOpenTask, onPlan }: Readonly<{
  model: WorkspaceViewModel
  client: ProjectCoordinatorRendererClient
  busy: boolean
  onSend(input: ResearchQuestion): Promise<boolean>
  onOpenTask(card: TaskCardModel): void
  onPlan(): void
}>): ReactElement {
  useWorkspaceTranslation()
  const [question, setQuestion] = useState('')
  const [selected, setSelected] = useState<readonly string[]>([])
  const sending = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const results = model.project ? adoptedResearchResults(model.project) : []
  const owner = Boolean(model.currentUserId && model.currentUserId === model.currentProject.ownerUserId)
  // null = ready; 'checking' = reading the local binding; any other string is the blocking reason.
  const [sessionStatus, setSessionStatus] = useState<string | null>(SESSION_CHECKING)
  const projectRef = useRef(model.project)
  projectRef.current = model.project
  // Re-check only when the facts the session binding depends on change, or on demand.
  const sessionKey = model.project
    ? [model.project.project.projectId, model.project.project.ownerUserId, model.project.project.coordinatorAgentId, model.project.project.coordinatorAuthorityEpoch].join(':')
    : null
  const [recheck, setRecheck] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const project = projectRef.current
    if (!owner || !project) return () => controller.abort()
    setSessionStatus(SESSION_CHECKING)
    void Promise.resolve().then(() => client.readSessionProjection({ signal: controller.signal })).then(projection => {
      if (controller.signal.aborted) return
      projectResearchSession(project, projection)
      setSessionStatus(null)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setSessionStatus(error instanceof Error ? error.message : String(error))
    })
    return () => controller.abort()
  }, [client, owner, sessionKey, recheck])
  const send = async () => {
    if (!question.trim() || busy || sending.current || !model.projectId || !owner || sessionStatus) return
    sending.current = true
    try {
      if (await onSend({ projectId: model.projectId, question, deliveryManifestIds: selected })) setQuestion('')
    } finally { sending.current = false }
  }
  const suggest = (text: string) => { setQuestion(text); textarea.current?.focus() }
  return <section className="research-view" aria-label={cw("研究对话")}>
    <div className="research-greeting"><FlaskConical aria-hidden="true" /><span>{cw("从一个值得追问的问题开始")}</span></div>
    <h2>{cw("今天，想把研究推进到哪里？")}</h2>
    <p className="research-intro">{model.project?.project.goal || cw("和 Agent 一起探索问题、检验想法，让每一份结果成为下一步的起点。")}</p>
    {owner && sessionStatus ? <div className="research-session-card" data-state={sessionStatus === SESSION_CHECKING ? 'checking' : 'blocked'}
      role={sessionStatus === SESSION_CHECKING ? 'status' : 'alert'}>
      {sessionStatus === SESSION_CHECKING ? <LoaderCircle aria-hidden="true" className="research-session-spin" /> : <TriangleAlert aria-hidden="true" />}
      <div><strong>{sessionStatus === SESSION_CHECKING ? cw("正在检查项目研究会话…") : cw("研究会话未就绪")}</strong>
        {sessionStatus === SESSION_CHECKING ? null : <p>{sessionStatus}</p>}</div>
      {sessionStatus === SESSION_CHECKING ? null : <button type="button" onClick={() => setRecheck(value => value + 1)}>{cw("重新检查")}</button>}
    </div> : null}
    <form className="research-composer" data-unavailable={owner && sessionStatus ? 'true' : undefined} onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="collaboration-workspace-visually-hidden" htmlFor="research-question">{cw("研究问题")}</label>
      <textarea id="research-question" ref={textarea} value={question} maxLength={8000} disabled={busy || !owner}
        placeholder={owner ? cw("提出问题，补充想法，或从已有结果继续…") : cw("成员可打开下方分配给自己的任务，继续研究")}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <div className="research-composer-footer"><span>{owner && sessionStatus ? cw("草稿会保留，会话就绪后即可发送。") : <>{selected.length ? cw("带入 {{v0}} 份已采纳结果", { v0: selected.length }) : cw("使用当前项目上下文")} · Ctrl / ⌘ Enter</>}</span>
        <button type="submit" aria-label={cw("开始研究对话")} disabled={busy || !owner || Boolean(sessionStatus) || !question.trim()}><ArrowUp aria-hidden="true" /></button></div>
    </form>
    <div className="research-suggestions" aria-label={cw("问题建议")}>
      {[cw("梳理当前问题和未知之处"), cw("设计一个最有区分度的实验"), cw("结合所选结果，提出下一步")].map((text) => <button type="button" key={text} disabled={busy || !owner || Boolean(sessionStatus)} onClick={() => suggest(text)}>{text}<ArrowUpRight aria-hidden="true" /></button>)}
    </div>
    {owner && model.project?.resultAssessments?.length ? <section className="research-section" aria-label={cw("结果续作观察")}>
      <header><h3>{cw("结果续作观察")}</h3><span>{cw("仅建议，尚未授权新工作")}</span></header>
      <ul className="research-observations">{model.project.resultAssessments.map((entry) => <li key={entry.key}>
        <strong>{entry.state === 'completed' ? ({ no_action: cw("暂不行动"), update_context: cw("补充现有上下文"), propose_next_step: cw("建议下一步"), human_decision: cw("需要你的判断") }[entry.decision!.action]) : entry.state === 'queued' ? cw("等待观察") : entry.state === 'running' ? cw("评估中") : cw("评估未知或已过期")}</strong>
        <p>{entry.decision?.rationale ?? entry.detail}</p>
        {entry.decision?.suggestion ? <p>{entry.decision.suggestion}</p> : null}
        <button type="button" disabled={busy || !entry.decision} onClick={() => {
          const source = results.find(({ manifest }) => manifest.deliveryManifestId === entry.deliveryManifestId)
          if (source) setSelected([source.manifest.deliveryManifestId])
          suggest(cw("{{v0}}\n依据：{{v1}} / {{v2}} / {{v3}}", { v0: entry.decision?.suggestion || entry.decision?.rationale || '', v1: entry.projectResultId, v2: entry.deliveryManifestId, v3: entry.manifestDigest }))
        }}>{cw("带入研究问题")}</button>
        {results.find(({ manifest }) => manifest.deliveryManifestId === entry.deliveryManifestId) ? <button type="button" onClick={() => {
          const source = results.find(({ manifest }) => manifest.deliveryManifestId === entry.deliveryManifestId)
          const card = model.cards.find((candidate) => candidate.id === source?.taskId)
          if (card) onOpenTask(card)
        }} disabled={!model.cards.some((candidate) => candidate.id === results.find(({ manifest }) => manifest.deliveryManifestId === entry.deliveryManifestId)?.taskId)}>{cw("查看交付任务")}</button> : null}
        <small>{cw("结果 {{id}} · 项目第 {{version}} 版 · 交付 {{manifest}}", { id: entry.projectResultId, version: entry.projectVersion, manifest: entry.deliveryManifestId })}</small>
        <details><summary>{cw("依据与限制")}</summary><p>{cw("精确封存说明摘要；不代表完整证据审阅或科学验证。")}{entry.detail}</p><p>{cw("本地观察上限：每精确来源 {{source}} 次、每项目权限时期 {{authority}} 次；单次期限 {{deadline}} 秒，队列等待上限 {{queue}} 秒。不是云端任务或计算预算。", { source: entry.limits.perSourceAttempts, authority: entry.limits.perAuthorityAttempts, deadline: entry.limits.deadlineMs / 1000, queue: entry.limits.queueDeadlineMs / 1000 })}</p><p>Manifest SHA-256: {entry.manifestDigest}</p>
          {entry.decision?.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}</details>
      </li>)}</ul>
    </section> : null}
    <section className="research-section" aria-label={cw("工作与协作")}><header><h3>{cw("工作与协作")}</h3><button type="button" onClick={onPlan}>{cw("讨论协作需求")}<ArrowUpRight aria-hidden="true" /></button></header>
      {model.cards.length ? <ul className="research-work-list">{model.cards.map((card) => <li key={card.id}><button type="button" onClick={() => onOpenTask(card)}><span className={`research-state state-${card.status}`} aria-hidden="true" /><span><strong>{card.title}</strong><small>{card.assignee ?? cw("待分配")} · {card.stateLabel ?? card.status}</small></span><ArrowUpRight aria-hidden="true" /></button></li>)}</ul> : <p className="research-empty">{cw("先自由探索。需要其他人一起推进时，再安排协作。")}</p>}
    </section>
    <section className="research-section" aria-label={cw("可继续研究的结果")}><header><h3>{cw("从已有结果继续")}</h3><span>{cw("选择要带入下一轮的结果 · 最多 8 份")}{selected.length ? <button type="button" disabled={busy} onClick={() => setSelected([])}>{cw("清空选择")}</button> : null}</span></header>
      {results.length ? <ul className="research-results">{results.map(({ title, manifest }) => <li key={manifest.deliveryManifestId}><label><input type="checkbox" checked={selected.includes(manifest.deliveryManifestId)} disabled={busy || !owner || (selected.length >= 8 && !selected.includes(manifest.deliveryManifestId))} onChange={(event) => setSelected((current) => event.target.checked ? [...current, manifest.deliveryManifestId] : current.filter((id) => id !== manifest.deliveryManifestId))} /><span><strong>{title}</strong><small>{cw("第 {{revision}} 版 · 已采纳", { revision: manifest.resultRevision ?? '—' })}</small></span></label></li>)}</ul> : <p className="research-empty">{cw("协作交付被采纳后会出现在这里，可选择带入下一轮对话。")}</p>}
    </section>
  </section>
}
