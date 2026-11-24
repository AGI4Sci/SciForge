import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import { formatBytes } from '../files/format-bytes.js'
import React, { useState, type ReactElement } from 'react'
import type { WorkspaceViewModel } from '../workspace-view-model.js'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts'
import { capabilityRequirementsSatisfied } from '../../../capability-requirements.js'

type Assignment = Readonly<{ planItemId: string; workerUserId: string }>
type Props = Readonly<{
  model: WorkspaceViewModel
  busy: boolean
  onMode(mode: 'manual' | 'ai_leader', pauseLocal?: boolean): void
  canPauseLocal?: boolean
  onAuthorize(assignments: readonly Assignment[]): void
  onDefer?(key: string): void
  onRetry?(): void
  onOpenResearch(): void
}>

export function ProjectExecutionControls({ model, busy, onMode, onAuthorize, onDefer, onRetry, onOpenResearch, canPauseLocal = false }: Props): ReactElement | null {
  useWorkspaceTranslation()
  const [pauseLocal, setPauseLocal] = useState(false)
  const [switchingToManual, setSwitchingToManual] = useState(false)
  const project = model.project?.project
  if (!project) return null
  const owner = model.currentUserId === project.ownerUserId
  const mode = project.executionMode
  const proposal = model.project?.leaderProposal
  const planning = model.project?.leaderPlanningStatus
  const canPlan = mode === 'ai_leader' && owner && ['draft', 'paused', 'active'].includes(project.status)
  return <section className="collaboration-workspace-project-controls" aria-label={cw("项目推进方式")}>
    <div className="collaboration-workspace-project-controls-header">
    <label>{cw("推进方式")}<select aria-label={cw("推进方式")} disabled={busy || !owner} value={mode} onChange={(event) => { if (event.target.value === 'manual') setSwitchingToManual(true); else onMode('ai_leader') }}><option value="manual">{cw("人工推进")}</option><option value="ai_leader">{cw("AI 领队")}</option></select></label>
    <p>{mode === 'ai_leader' ? cw("AI 主动整理进展和下一步建议；派发任务和关键决定需要你的授权。") : cw("由成员安排工作。切换模式保留工作历史，已授权执行的任务继续进行。")}</p>
    {mode === 'ai_leader' ? <button type="button" className="collaboration-workspace-button-secondary" disabled={!model.project?.leaderSession} onClick={onOpenResearch}>{cw("查看领队会话")}</button> : null}
    </div>
    {switchingToManual ? <div role="group" aria-label={cw("切换为人工推进")}>
      <strong>{cw("切换后由你安排下一步")}</strong><p>{cw("以下已接受的工作会继续，AI 领队不再主动发起新的推进动作。")}</p>
      <ul>{model.cards.filter((card) => card.executionId && card.status === 'in-progress').map((card) => <li key={card.id}>{card.title} · {card.assignee ?? cw("成员")}</li>)}</ul>
      {canPauseLocal ? <label><input type="checkbox" checked={pauseLocal} disabled={busy} onChange={(event) => setPauseLocal(event.target.checked)} />{cw("同时暂停我在本机运行的 AI 任务")}</label> : null}
      <button type="button" className="collaboration-workspace-button-primary" disabled={busy} onClick={() => { onMode('manual', pauseLocal); setSwitchingToManual(false) }}>{pauseLocal ? cw("切换并暂停我的 AI 任务") : cw("切换并保留当前执行")}</button><button type="button" className="collaboration-workspace-button-ghost" disabled={busy} onClick={() => setSwitchingToManual(false)}>{cw("取消")}</button>
    </div> : null}
    {owner && (mode === 'ai_leader' && proposal || mode === 'manual' && project.status === 'paused') ? <ProposalBatch key={mode === 'manual' ? 'manual-start' : proposal!.key} model={model} busy={busy} onAuthorize={onAuthorize} onDefer={onDefer} /> : null}
    {mode === 'ai_leader' && owner && planning ? <div role={planning.state === 'failed' ? 'alert' : 'status'}>
      <p>{planning.state === 'running' ? cw("AI 领队正在整理建议…") : cw("AI 领队暂未生成建议")} {planning.message}</p>
      {canPlan && planning.state === 'failed' && onRetry ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onRetry}>{cw("重新生成领队建议")}</button> : null}
    </div> : null}
    {canPlan && !proposal && !planning ? <div role="status">
      <p>{cw("当前没有待决策的领队建议；有新建议时会显示在这里。已有任务仍可在看板中安排。")}</p>
      {onRetry ? <button type="button" className="collaboration-workspace-button-secondary" disabled={busy} onClick={onRetry}>{project.status === 'draft' || project.status === 'paused' ? cw("生成启动建议") : cw("生成下一步建议")}</button> : null}
    </div> : null}
    {canPlan ? <p>{cw("生成仅整理建议，不会激活项目、派发或执行任务；后续行动仍需对应授权。")}</p> : null}
  </section>
}

function ProposalBatch({ model, busy, onAuthorize, onDefer }: Pick<Props, 'model' | 'busy' | 'onAuthorize' | 'onDefer'>): ReactElement | null {
  useWorkspaceTranslation()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const project = model.project
  const manual = project?.project.executionMode === 'manual'
  const proposal = manual ? null : project?.leaderProposal
  const requirements = project?.confirmedRequirements
  if (!manual && !proposal) return null
  // Batch authorization is the canonical activation path for a paused AI-led project.
  // Single-card assignment intentionally remains active-only.
  const readyOwner = model.connection.tone === 'ready' && model.currentUserId === project?.project.ownerUserId
  const modules = readyOwner && project && requirements?.state === 'confirmed' &&
    requirements.projectId === project.project.projectId && ['paused', 'active'].includes(project.project.status)
    ? requirements.workModules.flatMap((module) => {
      const taskId = canonicalTaskIdForRequirementsModule(requirements.requirementsDocumentId, module.planItemId)
      if (!module.output || project.tasks.some(({ task }) => task.taskId === taskId) || project.offers.some((offer) => offer.taskId === taskId) ||
          !module.dependencyPlanItemIds.every((id) => {
            const dependencyId = canonicalTaskIdForRequirementsModule(requirements.requirementsDocumentId, id)
            return project.tasks.some(({ task, delivery }) => task.projectId === project.project.projectId &&
              task.taskId === dependencyId && task.status === 'completed' && delivery?.receipt?.disposition === 'adopted')
          })) return []
      const requiredTags = module.requiredCapabilityTags ?? []
      const workers = model.members.filter((member) => member.state === 'active' &&
        (requiredTags.length === 0 || project.workerGroups.some((group) => group.userId === member.userId && group.agents.some(({ projectAvailability }) =>
          projectAvailability.availability.agentActive && projectAvailability.availability.deviceActive &&
          capabilityRequirementsSatisfied(requiredTags, projectAvailability.availability.runtimeCapabilityTags)))))
      return [{ module, taskId, workers }]
    }) : []
  const selected = modules.flatMap(({ module, workers }) => {
    const planItemId = module.planItemId
    const workerUserId = overrides[planItemId] ?? proposal?.assignments.find((item) => item.planItemId === planItemId)?.workerUserId
    return workerUserId && workers.some((worker) => worker.userId === workerUserId) ? [{ planItemId, workerUserId }] : []
  })
  if (manual && modules.length === 0) return null
  return <section className="collaboration-workspace-leader-proposal" aria-label={manual ? cw("启动人工推进项目") : cw("AI 领队建议")}>
    <h3>{manual ? cw("启动人工推进项目") : proposal!.title}</h3>{!manual && proposal ? <details><summary>{cw("分析与建议")}</summary><p>{proposal.rationale}</p>
    {proposal.blockers.length ? <><strong>{cw("当前阻塞")}</strong><ul>{proposal.blockers.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
    {proposal.decisions.length ? <><strong>{cw("需要你决定")}</strong><ul>{proposal.decisions.map((item, index) => <li key={index}>{item.prompt}</li>)}</ul></> : null}
    </details> : null}
    {requirements && modules.length ? <>
      <p>{manual ? cw("选择当前需求的模块和成员以授权启动项目。此操作只将项目恢复为进行中，不会派发任务或启动 AI；启动后请在看板逐项核对并派发。") : cw("以下执行人已按 AI 建议预选，可调整或取消本批任务。授权仅适用于当前需求版本及所选人员，对方接受后自行选择执行方式。")}</p>
      <p>{cw("项目目标：")}{requirements.goalsDeliverables}</p><p>{cw("输入与边界：")}{requirements.inputsBoundaries}</p>
      {modules.map(({ module, taskId, workers }) => {
        const output = module.output
        const suggested = proposal?.assignments.find((item) => item.planItemId === module.planItemId)
        const value = overrides[module.planItemId] ?? suggested?.workerUserId ?? ''
        return <label key={taskId} className="collaboration-workspace-revision-input">
          {module.title}<span>{module.objective}</span><span>{output ? cw("必交文件：{{v0}} · {{v1}} · 最大 {{v2}}", { v0: output.fileName, v1: output.mediaType, v2: formatBytes(output.maxBytes) }) : cw("待声明交付文件")}</span>{suggested ? <span>{cw("推荐理由：")}{suggested.rationale}</span> : null}
          <ul>{requirements.acceptanceCriteria.filter((item) => item.target === module.planItemId || item.target === '$project').map((item, index) => <li key={index}>{item.criteria}{cw("· 验证：")}{item.evidenceMethod}</li>)}</ul>
          <select aria-label={cw("执行人：{{v0}}", { v0: module.title })} disabled={busy} value={workers.some((worker) => worker.userId === value) ? value : ''} onChange={(event) => setOverrides((current) => ({ ...current, [module.planItemId]: event.target.value }))}>
            <option value="">{cw("本批暂不启动")}</option>
            {workers.map((member) => <option value={member.userId} key={member.userId}>{member.name}</option>)}
          </select>
        </label>
      })}
      <button type="button" className="collaboration-workspace-button-primary" disabled={busy || selected.length === 0} onClick={() => onAuthorize(selected)}>{manual ? cw("授权并启动项目") : cw("批准并派发 {{count}} 项任务", { count: selected.length || '' })}</button>
    </> : null}
    {!manual && onDefer && proposal ? <button type="button" className="collaboration-workspace-button-ghost" disabled={busy} onClick={() => onDefer(proposal.key)}>{cw("暂缓此建议")}</button> : null}
  </section>
}
