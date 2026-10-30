import React, { useEffect, useState, type ReactElement } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { requirementsCompletionMessages } from '../../../coordinator/renderer/project-coordinator-capability-client.js'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import { ConfirmationDialog } from '../dialogs/ConfirmationDialog.js'
import type { WorkspacePersonalItem } from '../workspace-view-model.js'

export function RequirementsView({ model, busy, error, pendingAction, invitation, confirmOnOpen = false, onAcceptInvitation, onSave, onComplete, onConfirm, onOpenModule }: Readonly<{ model: WorkspaceViewModel; busy: boolean; error?: string | null; pendingAction?: string; invitation?: WorkspacePersonalItem | null; confirmOnOpen?: boolean; onAcceptInvitation?(): void; onSave(goals: string, inputs: string): void; onComplete(): void; onConfirm(): void | Promise<boolean>; onOpenModule?(reference: string): void }>): ReactElement {
  const document = model.requirements
  const [goals, setGoals] = useState(document?.goalsDeliverables ?? '')
  const [inputs, setInputs] = useState(document?.inputsBoundaries ?? '')
  const canConfirm = Boolean(document && !document.confirmed && document.workModules.length && document.acceptanceCriteria.length)
  const [confirming, setConfirming] = useState(confirmOnOpen && canConfirm)
  useEffect(() => { setGoals(document?.goalsDeliverables ?? ''); setInputs(document?.inputsBoundaries ?? '') }, [document?.revision])
  if (!model.project || !model.projectId) return <section className="collaboration-workspace-page-panel"><EmptyState title="请选择一个项目" body="从左侧选择项目后查看它的需求。" /></section>
  const owner = model.currentUserId == null || model.project.project.ownerUserId === model.currentUserId
  const locked = Boolean(document?.confirmed) || Boolean(invitation) || !owner
  const completing = document?.completion?.state === 'running'
  const failure = document?.completion?.state === 'failed' ? document.completion.reason : undefined
  const status = document?.confirmed ? `已确认 v${document.documentRevision}` : completing ? '正在补全…' : failure ? `补全失败：${requirementsCompletionMessages[failure]}` : busy ? '处理中…' : document?.workModules.length ? '已补全待确认' : '草稿'
  const tone = document?.confirmed ? 'tone-success' : completing ? 'tone-accent' : failure ? 'tone-danger' : busy ? 'tone-accent' : 'tone-neutral'
  if (!owner && !document?.confirmed && !invitation) return <section className="collaboration-workspace-page-panel collaboration-workspace-requirements-page"><EmptyState title="负责人正在修改需求" body="需求确认后，你会在这里看到正式版本。" /></section>
  return (
    <section className="collaboration-workspace-page-panel collaboration-workspace-requirements-page">
      <header className="collaboration-workspace-page-header">
        <div>
          <p className="collaboration-workspace-eyebrow">需求文档</p>
          <h2>{document ? `版本 ${document.documentRevision}` : '新建需求'}</h2>
        </div>
        <span className={`collaboration-workspace-pill ${invitation ? 'tone-neutral' : tone}`}>{invitation ? (document?.confirmed ? '已确认版本 · 只读' : '邀请待接受') : status}</span>
      </header>
      {invitation ? (
        <div className="collaboration-workspace-invitation-action">
          <div><strong>{model.currentProject.ownerName || '项目负责人'} 邀请你加入此项目</strong><p>{document?.confirmed ? '请先阅读下面已确认的需求，再决定是否加入。' : '接受后即可查看项目需求并参与协作。'}</p>{error ? <p role="alert">{error}</p> : null}</div>
          <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={onAcceptInvitation}>{busy && pendingAction === 'accept-invitation' ? '处理中…' : '接受邀请'}</button>
        </div>
      ) : null}
      <section className="collaboration-workspace-requirements-section">
        <h3>目标与交付</h3>
        <label>
          {locked ? null : <span className="collaboration-workspace-field-hint">要做成什么、最后交付什么</span>}
          <span className="collaboration-workspace-visually-hidden">目标与交付</span>
          {locked ? <p className="collaboration-workspace-requirements-text">{goals || '—'}</p> : <textarea value={goals} disabled={busy} rows={5} onChange={(event) => setGoals(event.target.value)} placeholder="例如：完成三组样本的质控，并交付质控报告与过滤后的数据" />}
        </label>
      </section>
      <section className="collaboration-workspace-requirements-section">
        <h3>输入与边界</h3>
        <label>
          {locked ? null : <span className="collaboration-workspace-field-hint">可用的数据、工具和不能越过的边界</span>}
          <span className="collaboration-workspace-visually-hidden">输入与边界</span>
          {locked ? <p className="collaboration-workspace-requirements-text">{inputs || '—'}</p> : <textarea value={inputs} disabled={busy} rows={5} onChange={(event) => setInputs(event.target.value)} placeholder="例如：只使用项目共享资料中的原始数据；不修改上游流程" />}
        </label>
      </section>
      {!invitation && owner && !document?.confirmed ? (
        <div className="collaboration-workspace-requirements-actions">
          <button type="button" className="collaboration-workspace-button-secondary" onClick={() => onSave(goals, inputs)} disabled={busy || !goals.trim() || !inputs.trim()}>{busy && pendingAction === 'save-requirements' ? '处理中…' : '保存需求'}</button>
          <button type="button" className={failure ? 'collaboration-workspace-button-primary' : 'collaboration-workspace-button-secondary'} onClick={onComplete} disabled={busy || completing || !document?.revision}>{completing || (busy && pendingAction === 'complete-requirements') ? '正在补全…' : '重新补全'}</button>
          {canConfirm ? <button type="button" className="collaboration-workspace-button-primary" onClick={() => setConfirming(true)} disabled={busy || completing}>确认需求</button> : null}
        </div>
      ) : null}
      {completing ? <p role="status">Coordinator 正在补全工作模块和验收标准，完成后将自动更新。</p> : null}
      {!invitation && !confirming && error ? <p role="alert">{error}</p> : null}
      <section className="collaboration-workspace-requirements-section">
        <h3>工作模块 <small>由 Coordinator 补全，每个模块对应看板上的一张任务卡</small></h3>
        {document?.workModules.length ? (
          <ol className="collaboration-workspace-requirements-list">
            {document.workModules.map((item, index) => (
              <li key={item.planItemId}>
                <button type="button" onClick={() => onOpenModule?.(`#${index + 1}`)} disabled={!onOpenModule}>
                  <span className="collaboration-workspace-task-card-reference">#{index + 1}</span>
                  <span><strong>{item.title}</strong><small>{item.objective}</small><small>{item.dependencyLabel}</small></span>
                  {onOpenModule ? <ArrowUpRight aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ol>
        ) : <p className="collaboration-workspace-section-empty">{completing ? 'Coordinator 正在补全工作模块…' : '保存需求后，Coordinator 会把它拆成工作模块。'}</p>}
      </section>
      <section className="collaboration-workspace-requirements-section">
        <h3>验收标准 <small>只读</small></h3>
        {document?.acceptanceCriteria.length ? (
          <ul className="collaboration-workspace-requirements-criteria">
            {document.acceptanceCriteria.map((item) => <li key={`${item.target}:${item.criteria}`}><strong>{item.target}</strong><p>{item.criteria}</p><small>验证方式：{item.evidenceMethod}</small></li>)}
          </ul>
        ) : <p className="collaboration-workspace-section-empty">补全后显示验收标准。</p>}
      </section>
      {confirming ? <ConfirmationDialog title="确认需求版本" message={`确认版本 v${document?.documentRevision} 并开始协作？确认后，这一版会成为项目成员看到的正式需求，任务会按工作模块派给成员。`} confirmLabel="确认需求" busy={busy || completing} error={error} onCancel={() => setConfirming(false)} onConfirm={() => { void Promise.resolve(onConfirm()).then((succeeded) => { if (succeeded !== false) setConfirming(false) }) }} /> : null}
    </section>
  )
}

export function EmptyState({ title, body, action }: Readonly<{ title: string; body?: string; action?: ReactElement }>): ReactElement {
  return <div className="collaboration-workspace-empty-state" role="status"><strong>{title}</strong>{body ? <p>{body}</p> : null}{action}</div>
}
