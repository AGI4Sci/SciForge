import React, { useEffect, useState, type ReactElement } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { requirementsCompletenessViolation, requirementsDocumentPartsSchema, type ProjectRequirementsDocument } from '@sciforge/collaboration-contracts'
import { requirementsCompletionMessages } from '../../../coordinator/renderer/project-coordinator-capability-client.js'
import { useWorkspaceTranslation, translateWorkspace as cw } from '../workspace-i18n.js'
import { formatBytes } from '../files/format-bytes.js'
import type { WorkspaceViewModel, WorkspacePersonalItem } from '../workspace-view-model.js'
import { ConfirmationDialog } from '../dialogs/ConfirmationDialog.js'
import { RequirementsEditor, type RequirementsEdits } from './RequirementsEditor.js'

export type RequirementsDraftEdit = RequirementsEdits & Readonly<{
  expectedRequirementsRevision: number
  inputReferences: ProjectRequirementsDocument['inputReferences']
}>

function editsOf(document: ProjectRequirementsDocument | null | undefined): RequirementsEdits {
  return {
    workModules: (document?.workModules ?? []).map((module) => ({
      ...module,
      dependencyPlanItemIds: [...module.dependencyPlanItemIds],
      ...(module.output ? { output: { ...module.output } } : {}),
      ...(module.requiredCapabilityTags ? { requiredCapabilityTags: [...module.requiredCapabilityTags] } : {})
    })),
    acceptanceCriteria: (document?.acceptanceCriteria ?? []).map((criterion) => ({ ...criterion }))
  }
}

export function RequirementsView({ model, busy, error, pendingAction, invitation, confirmOnOpen = false, creationNotice, onAcceptInvitation, onSave, onComplete, onConfirm, onOpenModule }: Readonly<{
  model: WorkspaceViewModel
  busy: boolean
  error?: string | null
  pendingAction?: string
  invitation?: WorkspacePersonalItem | null
  confirmOnOpen?: boolean
  creationNotice?: ReactElement
  onAcceptInvitation?(): void
  onSave(goals: string, inputs: string, draft: RequirementsDraftEdit): void | Promise<boolean | void>
  onComplete(): void
  onConfirm(): void | Promise<boolean>
  onOpenModule?(reference: string): void
}>): ReactElement {
  useWorkspaceTranslation()
  const document = model.requirements
  const owner = Boolean(model.currentUserId && model.project?.project.ownerUserId === model.currentUserId)
  const source = owner ? model.project?.requirementsDraft ?? model.project?.confirmedRequirements : model.project?.confirmedRequirements ?? model.project?.requirementsDraft
  const [goals, setGoals] = useState(document?.goalsDeliverables ?? '')
  const [inputs, setInputs] = useState(document?.inputsBoundaries ?? '')
  const [edits, setEdits] = useState(() => editsOf(source))
  const [inputReferences, setInputReferences] = useState(source?.inputReferences ?? [])
  const [baseRevision, setBaseRevision] = useState(document?.revision ?? 0)
  const [draftProjectId, setDraftProjectId] = useState(model.projectId)
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [completingConfirmation, setCompletingConfirmation] = useState(false)
  const locked = Boolean(document?.confirmed) || Boolean(invitation) || !owner
  const completing = document?.completion?.state === 'running'
  const failure = document?.completion?.state === 'failed' ? document.completion.reason : undefined
  const parsed = requirementsDocumentPartsSchema.safeParse({ goalsDeliverables: goals, inputsBoundaries: inputs, inputReferences, ...edits })
  const moduleIds = new Set(edits.workModules.map((item) => item.planItemId))
  const validDraft = parsed.success && edits.acceptanceCriteria.every((item) => item.target === '$project' || moduleIds.has(item.target))
  const savedParts = source ? requirementsDocumentPartsSchema.safeParse({ goalsDeliverables: source.goalsDeliverables, inputsBoundaries: source.inputsBoundaries, inputReferences: source.inputReferences, ...editsOf(source) }) : undefined
  const canConfirm = Boolean(document && !document.confirmed && savedParts?.success && requirementsCompletenessViolation(savedParts.data) === null)
  const outdated = dirty && baseRevision !== (document?.revision ?? 0)
  const reload = (): void => {
    setGoals(document?.goalsDeliverables ?? '')
    setInputs(document?.inputsBoundaries ?? '')
    setEdits(editsOf(source))
    setInputReferences(source?.inputReferences ?? [])
    setBaseRevision(document?.revision ?? 0)
    setDraftProjectId(model.projectId)
    setDirty(false)
  }
  useEffect(() => {
    // Refreshes and failed CAS writes retain unsaved edits on the same project.
    // A different project always loads its own document instead of the old form.
    if (dirty && draftProjectId === model.projectId) return
    setGoals(document?.goalsDeliverables ?? '')
    setInputs(document?.inputsBoundaries ?? '')
    setEdits(editsOf(source))
    setInputReferences(source?.inputReferences ?? [])
    setBaseRevision(document?.revision ?? 0)
    setDraftProjectId(model.projectId)
    setDirty(false)
  }, [document?.revision, document?.goalsDeliverables, document?.inputsBoundaries, dirty, draftProjectId, model.projectId, source])
  useEffect(() => {
    if (confirmOnOpen && canConfirm && !dirty && !locked) setConfirming(true)
  }, [confirmOnOpen, canConfirm, dirty, locked])
  if (!model.project || !model.projectId) return <section className="collaboration-workspace-page-panel"><EmptyState title={cw('请选择一个项目')} body={cw('从左侧选择项目后查看它的需求。')} /></section>
  const status = document?.confirmed ? cw('已确认 v{{v0}}', { v0: document.documentRevision ?? 0 }) : completing ? cw('正在补全…') : failure ? cw('补全失败：{{v0}}', { v0: cw(requirementsCompletionMessages[failure]) }) : busy ? cw('处理中…') : document?.workModules.length ? cw('草稿待确认') : cw('草稿')
  const tone = document?.confirmed ? 'tone-success' : completing ? 'tone-accent' : failure ? 'tone-danger' : busy ? 'tone-accent' : 'tone-neutral'
  if (!owner && !document?.confirmed && !invitation) return <section className="collaboration-workspace-page-panel collaboration-workspace-requirements-page"><EmptyState title={cw('负责人正在修改需求')} body={cw('需求确认后，你会在这里看到正式版本。')} /></section>
  const save = async (): Promise<void> => {
    if (locked || busy || completing || outdated || !validDraft || !parsed.success) return
    const succeeded = await onSave(goals, inputs, {
      workModules: parsed.data.workModules,
      acceptanceCriteria: parsed.data.acceptanceCriteria,
      expectedRequirementsRevision: baseRevision,
      inputReferences: parsed.data.inputReferences
    })
    if (succeeded !== false) setDirty(false)
  }
  return <section className="collaboration-workspace-page-panel collaboration-workspace-requirements-page">
    <header className="collaboration-workspace-page-header">
      <div><p className="collaboration-workspace-eyebrow">{cw('需求文档')}</p><h2>{document ? cw('版本 {{v0}}', { v0: document.documentRevision ?? 0 }) : cw('新建需求')}</h2></div>
      <span className={`collaboration-workspace-pill ${invitation ? 'tone-neutral' : tone}`}>{invitation ? (document?.confirmed ? cw('已确认版本 · 只读') : cw('邀请待接受')) : status}</span>
    </header>
    {creationNotice}
    {invitation ? <div className="collaboration-workspace-invitation-action">
      <div><strong>{model.currentProject.ownerName || cw('项目负责人')}{' '}{cw('邀请你加入此项目')}</strong><p>{document?.confirmed ? cw('请先阅读下面已确认的需求，再决定是否加入。') : cw('等待负责人确认需求后即可接受邀请。')}</p>{error ? <p role="alert">{error}</p> : null}</div>
      <button type="button" className="collaboration-workspace-button-primary" disabled={busy || !document?.confirmed || !onAcceptInvitation} onClick={onAcceptInvitation}>{busy && pendingAction === 'accept-invitation' ? cw('处理中…') : cw('接受邀请')}</button>
    </div> : null}
    <section className="collaboration-workspace-requirements-section">
      <h3>{cw('目标与交付')}</h3><label>
        {locked ? null : <span className="collaboration-workspace-field-hint">{cw('要做成什么、最后交付什么')}</span>}
        <span className="collaboration-workspace-visually-hidden">{cw('目标与交付')}</span>
        {locked ? <p className="collaboration-workspace-requirements-text">{goals || '—'}</p> : <textarea value={goals} disabled={busy || completing} maxLength={16000} rows={5} onChange={(event) => { setGoals(event.target.value); setDirty(true) }} placeholder={cw('例如：完成三组样本的质控，并交付质控报告与过滤后的数据')} />}
      </label>
    </section>
    <section className="collaboration-workspace-requirements-section">
      <h3>{cw('输入与边界')}</h3><label>
        {locked ? null : <span className="collaboration-workspace-field-hint">{cw('可用的数据、工具和不能越过的边界')}</span>}
        <span className="collaboration-workspace-visually-hidden">{cw('输入与边界')}</span>
        {locked ? <p className="collaboration-workspace-requirements-text">{inputs || '—'}</p> : <textarea value={inputs} disabled={busy || completing} maxLength={16000} rows={5} onChange={(event) => { setInputs(event.target.value); setDirty(true) }} placeholder={cw('例如：只使用项目共享资料中的原始数据；不修改上游流程')} />}
      </label>
    </section>
    {!locked ? <RequirementsEditor value={edits} disabled={busy || completing} onChange={(value) => { setEdits(value); setDirty(true) }} /> : <>
      <section className="collaboration-workspace-requirements-section">
        <h3>{cw('工作模块')}<small>{cw('可手动编辑，也可选择 AI 补全；每个模块对应一张任务卡')}</small></h3>
        {document?.workModules.length ? <ol className="collaboration-workspace-requirements-list">
          {document.workModules.map((item, index) => <li key={item.planItemId}>
            <button type="button" onClick={() => onOpenModule?.(`#${index + 1}`)} disabled={!onOpenModule}>
              <span className="collaboration-workspace-task-card-reference">#{index + 1}</span>
              <span><strong>{item.title}</strong><small>{item.objective}</small><small>{item.output ? cw('必交文件：{{v0}} · {{v1}} · 最大 {{v2}}', { v0: item.output.fileName, v1: item.output.mediaType, v2: formatBytes(item.output.maxBytes) }) : cw('待声明交付文件')}</small><small>{item.dependencyLabel}</small></span>
              {onOpenModule ? <ArrowUpRight aria-hidden="true" /> : null}
            </button>
          </li>)}
        </ol> : <p className="collaboration-workspace-section-empty">{completing ? cw('Coordinator 正在补全工作模块…') : cw('添加工作模块后保存，或保存目标与边界后选择 AI 补全。')}</p>}
      </section>
      <section className="collaboration-workspace-requirements-section">
        <h3>{cw('验收标准')}<small>{cw('只读')}</small></h3>
        {document?.acceptanceCriteria.length ? <ul className="collaboration-workspace-requirements-criteria">
          {document.acceptanceCriteria.map((item) => <li key={`${item.target}:${item.criteria}`}><strong>{item.target === '$project' ? cw('项目整体') : document.workModules.find((module) => module.planItemId === item.target)?.title || cw('未找到对应工作模块')}</strong><p>{item.criteria}</p><small>{cw('验证方式：')}{item.evidenceMethod}</small></li>)}
        </ul> : <p className="collaboration-workspace-section-empty">{cw('补全后显示验收标准。')}</p>}
      </section>
    </>}
    {!locked ? <div className="collaboration-workspace-requirements-actions">
      <button type="button" className="collaboration-workspace-button-secondary" onClick={() => { void save() }} disabled={busy || completing || outdated || !validDraft || !goals.trim() || !inputs.trim()}>{busy && pendingAction === 'save-requirements' ? cw('处理中…') : cw('保存需求')}</button>
      <button type="button" className={failure ? 'collaboration-workspace-button-primary' : 'collaboration-workspace-button-secondary'} onClick={() => { if (!dirty && !busy && !completing && !outdated && document?.revision) setCompletingConfirmation(true) }} disabled={busy || completing || dirty || outdated || !document?.revision}>{completing || (busy && pendingAction === 'complete-requirements') ? cw('正在补全…') : cw('AI 补全')}</button>
      {canConfirm ? <button type="button" className="collaboration-workspace-button-primary" onClick={() => setConfirming(true)} disabled={busy || completing || dirty || outdated}>{cw('确认需求')}</button> : null}
      {dirty ? <p role="status">{cw('存在未保存的修改，请先保存再补全或确认。')}</p> : null}
      {!validDraft ? <p role="alert">{cw('请填写有效的模块、文件与验收信息；依赖不得循环或引用已删除模块。')}</p> : null}
      {outdated ? <p role="alert">{cw('需求已有新版本，当前编辑保留在本页。请重新加载后再修改，避免覆盖他人内容。')}<button type="button" disabled={busy || completing} onClick={reload}>{cw('重新加载需求')}</button></p> : null}
    </div> : null}
    {completingConfirmation && !locked ? <ConfirmationDialog title={cw('AI 补全需求')} message={cw('AI 将根据已保存的目标与边界重新生成工作模块和验收标准，替换其中的手动内容。是否继续？')} confirmLabel={cw('继续 AI 补全')} busy={busy || completing} onCancel={() => setCompletingConfirmation(false)} onConfirm={() => { if (!dirty && !busy && !completing && !outdated && document?.revision) { setCompletingConfirmation(false); onComplete() } }} /> : null}
    {completing ? <p role="status">{cw('Coordinator 正在补全工作模块和验收标准，完成后将自动更新。')}</p> : null}
    {!invitation && !confirming && error ? <p role="alert">{error}</p> : null}
    {confirming && !locked ? <ConfirmationDialog title={cw('确认需求版本')} message={cw('确认版本 v{{v0}}？确认后，这一版会成为项目成员看到的正式需求；派发任务仍需要你的授权。', { v0: document?.documentRevision ?? 0 })} confirmLabel={cw('确认需求')} busy={busy || completing} error={error} onCancel={() => setConfirming(false)} onConfirm={() => { if (locked || dirty || busy || completing || outdated || !canConfirm) return; void Promise.resolve(onConfirm()).then((succeeded) => { if (succeeded !== false) setConfirming(false) }) }} /> : null}
  </section>
}

export function EmptyState({ title, body, action }: Readonly<{ title: string; body?: string; action?: ReactElement }>): ReactElement {
  useWorkspaceTranslation()
  return <div className="collaboration-workspace-empty-state" role="status"><strong>{title}</strong>{body ? <p>{body}</p> : null}{action}</div>
}
