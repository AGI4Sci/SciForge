import React, { useRef, useState, type ReactElement } from 'react'
import { ArrowUp, ArrowUpRight, FlaskConical } from 'lucide-react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import type { TaskCardModel } from '../workspace-types.js'
import { adoptedResearchResults, type ResearchQuestion } from './research-conversation.js'

export function ResearchView({ model, busy, onSend, onOpenTask, onPlan }: Readonly<{
  model: WorkspaceViewModel
  busy: boolean
  onSend(input: ResearchQuestion): Promise<boolean>
  onOpenTask(card: TaskCardModel): void
  onPlan(): void
}>): ReactElement {
  const [question, setQuestion] = useState('')
  const [selected, setSelected] = useState<readonly string[]>([])
  const sending = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const results = model.project ? adoptedResearchResults(model.project) : []
  const owner = Boolean(model.currentUserId && model.currentUserId === model.currentProject.ownerUserId)
  const send = async () => {
    if (!question.trim() || busy || sending.current || !model.projectId || !owner) return
    sending.current = true
    try {
      if (await onSend({ projectId: model.projectId, question, deliveryManifestIds: selected })) setQuestion('')
    } finally { sending.current = false }
  }
  const suggest = (text: string) => { setQuestion(text); textarea.current?.focus() }
  return <section className="research-view" aria-label="研究对话">
    <div className="research-greeting"><FlaskConical aria-hidden="true" /><span>从一个值得追问的问题开始</span></div>
    <h2>今天，想把研究推进到哪里？</h2>
    <p className="research-intro">{model.project?.project.goal || '和 Agent 一起探索问题、检验想法，让每一份结果成为下一步的起点。'}</p>
    <form className="research-composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="collaboration-workspace-visually-hidden" htmlFor="research-question">研究问题</label>
      <textarea id="research-question" ref={textarea} value={question} maxLength={8000} disabled={busy || !owner}
        placeholder={owner ? '提出问题，补充想法，或从已有结果继续…' : '成员可打开下方分配给自己的任务，继续研究'}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      <div className="research-composer-footer"><span>{selected.length ? `带入 ${selected.length} 份已采纳结果` : '使用当前项目上下文'} · Ctrl / ⌘ Enter</span>
        <button type="submit" aria-label="开始研究对话" disabled={busy || !owner || !question.trim()}><ArrowUp aria-hidden="true" /></button></div>
    </form>
    <div className="research-suggestions" aria-label="问题建议">
      {['梳理当前问题和未知之处', '设计一个最有区分度的实验', '结合所选结果，提出下一步'].map((text) => <button type="button" key={text} disabled={busy || !owner} onClick={() => suggest(text)}>{text}<ArrowUpRight aria-hidden="true" /></button>)}
    </div>
    <section className="research-section" aria-label="工作与协作"><header><h3>工作与协作</h3><button type="button" onClick={onPlan}>讨论协作需求 <ArrowUpRight aria-hidden="true" /></button></header>
      {model.cards.length ? <ul className="research-work-list">{model.cards.map((card) => <li key={card.id}><button type="button" onClick={() => onOpenTask(card)}><span className={`research-state state-${card.status}`} aria-hidden="true" /><span><strong>{card.title}</strong><small>{card.assignee ?? '待分配'} · {card.stateLabel ?? card.status}</small></span><ArrowUpRight aria-hidden="true" /></button></li>)}</ul> : <p className="research-empty">先自由探索。需要其他人一起推进时，再安排协作。</p>}
    </section>
    <section className="research-section" aria-label="可继续研究的结果"><header><h3>从已有结果继续</h3><span>选择要带入下一轮的结果 · 最多 8 份{selected.length ? <button type="button" disabled={busy} onClick={() => setSelected([])}>清空选择</button> : null}</span></header>
      {results.length ? <ul className="research-results">{results.map(({ title, manifest }) => <li key={manifest.deliveryManifestId}><label><input type="checkbox" checked={selected.includes(manifest.deliveryManifestId)} disabled={busy || !owner || (selected.length >= 8 && !selected.includes(manifest.deliveryManifestId))} onChange={(event) => setSelected((current) => event.target.checked ? [...current, manifest.deliveryManifestId] : current.filter((id) => id !== manifest.deliveryManifestId))} /><span><strong>{title}</strong><small>第 {manifest.resultRevision} 版 · 已采纳</small></span></label></li>)}</ul> : <p className="research-empty">协作交付被采纳后会出现在这里，可选择带入下一轮对话。</p>}
    </section>
  </section>
}
