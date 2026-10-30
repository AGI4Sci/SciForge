import React, { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { DeliveryContent, DeliveryTotal, deliveryLimitError, deliverySourceLabel } from './DeliveryContent.js'
import { DeliveryDialog } from './DeliveryDialog.js'
import { DeliveryMaterialPicker } from './DeliveryMaterialPicker.js'
import { formatBytes } from '../files/format-bytes.js'
import { formatWorkspaceTime } from '../format-time.js'
import type { DeliveryDraftData, DeliveryDraftFile, DeliveryDraftSnapshot, DeliveryMaterialSelection } from './delivery-draft-types.js'

export type DeliveryDraftProps = Readonly<{
  data: DeliveryDraftData
  busy?: boolean
  materialSelection?: DeliveryMaterialSelection
  returnControls?: ReactNode
  onContinue?(): void
  onReexecute?(): void
  onPreview?(file: DeliveryDraftFile): void
  onSubmit?(summary: string, files: readonly DeliveryDraftFile[]): Promise<boolean> | void
  onSummaryChange?(summary: string): void
  onMaterialsChange?(files: readonly DeliveryDraftFile[]): void
  onAiSummaryDecision?(decision: 'replace' | 'keep', summary: string): void
}>

function DeliverySnapshot({ snapshot, showAdditional, busy, onPreview }: Readonly<{
  snapshot: DeliveryDraftSnapshot
  showAdditional: boolean
  busy?: boolean
  onPreview?(file: DeliveryDraftFile): void
}>): ReactElement {
  return <div className="collaboration-workspace-delivery-snapshot" data-testid="delivery-snapshot">
    <p className="collaboration-workspace-delivery-meta" data-testid="delivery-submitter">{snapshot.submitter} 提交于 <time dateTime={snapshot.submittedAt} data-testid="delivery-submitted-at">{formatWorkspaceTime(snapshot.submittedAt)}</time></p>
    <div className="collaboration-workspace-delivery-summary" data-testid="delivery-snapshot-summary"><h4>结果说明</h4><p>{snapshot.summary}</p></div>
    <DeliveryContent declaredFiles={snapshot.declaredFiles} additionalFiles={snapshot.additionalFiles} showAdditional={showAdditional} readOnly busy={busy} onPreview={onPreview} />
  </div>
}

/** Member-owned renderer draft; external writes remain supplied canonical callbacks. */
export function DeliveryDraft({ data, busy = false, materialSelection, returnControls, onReexecute, onContinue, onPreview, onSubmit, onSummaryChange, onMaterialsChange, onAiSummaryDecision }: DeliveryDraftProps): ReactElement {
  const titleId = useId()
  const hintId = useId()
  const confirmTitleId = useId()
  const [text, setText] = useState(data.summary)
  const [additionalFiles, setAdditionalFiles] = useState<readonly DeliveryDraftFile[]>(data.additionalFiles ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conflictingSummary, setConflictingSummary] = useState<string | null>(null)
  const [resolvedAiSummary, setResolvedAiSummary] = useState<string | null>(null)
  const edited = useRef(false)
  const seed = useRef({ revision: data.revision, summary: data.summary, additionalFiles: data.additionalFiles })
  useEffect(() => {
    const previous = seed.current
    if (previous.revision !== data.revision) {
      edited.current = false
      setText(data.summary)
      setAdditionalFiles(data.additionalFiles ?? [])
      setResolvedAiSummary(null)
      setConflictingSummary(null)
      setSubmitError(null)
      setConfirmOpen(false)
    } else {
      if (previous.summary !== data.summary && data.summary !== text) {
        if (edited.current) setConflictingSummary(data.summary)
        else setText(data.summary)
      }
      if (JSON.stringify(previous.additionalFiles) !== JSON.stringify(data.additionalFiles)) setAdditionalFiles(data.additionalFiles ?? [])
    }
    seed.current = { revision: data.revision, summary: data.summary, additionalFiles: data.additionalFiles }
  }, [data.revision, data.summary, data.additionalFiles, text])
  const readOnly = data.state === 'submitted' || data.state === 'adopted'
  const submissionPending = submitting || data.state === 'submitting'
  const progressLabel = data.submissionProgress ? {
    preparing: '正在核对任务要求并保存交付快照…',
    signing: '正在验证当前设备并签署提交，请稍候…',
    staging: '正在上传交付文件…',
    candidate: '文件已上传，正在登记交付…',
    review: '正在记录本次提交确认…',
    seal: '正在云端封存交付…'
  }[data.submissionProgress] : '正在准备提交，请稍候…'
  const locked = busy || submissionPending
  const generating = data.state === 'generating'
  const editLocked = locked || Boolean(data.editLocked)
  const editingDisabled = editLocked || generating
  const visibleSubmitError = !locked && !readOnly ? data.submitError ?? submitError : null
  const aiFailed = data.state === 'failed' && !data.submitError && !submitError && !submissionPending
  const modifying = data.state === 'modifying'
  const source = data.source && (!data.revisionRequest || data.source.revision === data.revision) ? data.source : null
  const hasMaterialSelection = Boolean(materialSelection)
  const files = [...data.declaredFiles, ...(hasMaterialSelection ? additionalFiles : [])]
  const limitError = hasMaterialSelection ? deliveryLimitError(files) : null
  const suggestion = (data.aiSummary && data.aiSummary !== resolvedAiSummary ? data.aiSummary : null) ?? conflictingSummary
  const canSubmit = !locked && !data.materialError && !modifying && !generating && Boolean(text.trim()) && !limitError && Boolean(onSubmit)
  const stateLabel = data.state === 'adopted' ? '已采纳' : data.state === 'submitted' ? '已提交' : submissionPending ? '提交中…' : visibleSubmitError ? '提交失败' : generating ? 'AI 正在完成任务…' : modifying ? 'AI 正在修改…' : aiFailed ? 'AI 执行失败' : data.state === 'changed' ? '有新改动' : '草稿就绪'
  const updateText = (value: string): void => {
    edited.current = true
    setText(value)
    setSubmitError(null)
    onSummaryChange?.(value)
  }
  const updateFiles = (files: readonly DeliveryDraftFile[]): void => {
    setAdditionalFiles(files)
    setSubmitError(null)
    onMaterialsChange?.(files)
  }
  const submit = async (): Promise<void> => {
    if (!canSubmit || submittingRef.current || !onSubmit) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await onSubmit(text.trim(), files)
      if (result !== false) setConfirmOpen(false)
      else setSubmitError('提交未成功，草稿和所选资料已保留，请再次提交。')
    } catch {
      setSubmitError('提交失败，草稿和所选资料已保留。请稍后再次提交。')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  return <section className="collaboration-workspace-delivery-draft" data-testid="delivery-draft" aria-labelledby={titleId} aria-busy={locked}>
    {data.revisionRequest && !readOnly ? <aside className="collaboration-workspace-delivery-revision-request" data-testid="delivery-revision-request" aria-label="负责人返修意见">
      <strong>负责人要求返修</strong>
      <p className="collaboration-workspace-delivery-meta">{data.revisionRequest.author} · <time dateTime={data.revisionRequest.at}>{formatWorkspaceTime(data.revisionRequest.at)}</time></p>
      <p>{data.revisionRequest.instruction}</p>
    </aside> : null}
    <header className="collaboration-workspace-delivery-draft-header">
      <h3 id={titleId}>{readOnly ? '交付快照' : '交付草稿'}</h3>
      <span className="collaboration-workspace-delivery-version" data-testid="delivery-version">第 {data.revision} 版{readOnly ? '' : '草稿'}</span>
      <span className={`collaboration-workspace-delivery-status${aiFailed ? ' tone-warning' : data.state === 'adopted' ? ' tone-success' : ''}`} data-testid="delivery-status" role="status">{stateLabel}</span>
    </header>
    {!readOnly ? <>
      <div className="collaboration-workspace-delivery-source-row" data-testid="delivery-ai-source">
        <span className="collaboration-workspace-delivery-meta">{data.revisionRequest && modifying ? `基于第 ${data.revision - 1} 版 · AI 正在按返修意见修改…` : source ? <>来自 AI 第 {source.round} 轮{data.revisionRequest ? '（返修）' : ''} · <time dateTime={source.finishedAt}>{formatWorkspaceTime(source.finishedAt)}</time></> : data.revisionRequest ? `基于第 ${data.revision - 1} 版` : '等待 AI 生成草稿'}</span>
        <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-ask-ai" disabled={editLocked || !onContinue} onClick={onContinue}>让 AI 修改</button>
      </div>
      {generating ? <p className="collaboration-workspace-delivery-notice" data-testid="delivery-generating" role="status">AI 正在完成任务… 你可以去会话查看进度。</p> : null}
      {modifying ? <p className="collaboration-workspace-delivery-notice" data-testid="delivery-modifying" role="status">AI 正在修改… 你可以继续编辑结果说明，完成后再提交。</p> : null}
      {data.state === 'changed' ? <p className="collaboration-workspace-delivery-notice" data-testid="delivery-changed" role="status">有新改动，请预览后提交</p> : null}
      {aiFailed ? <div className="collaboration-workspace-delivery-failure" data-testid="delivery-failure" role="status">
        <strong>AI 执行失败</strong><p>{data.failureReason ?? '执行遇到问题，请在会话中查看详情。'}</p>
        <div className="collaboration-workspace-delivery-actions">
          {onReexecute ? <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-reexecute" disabled={editLocked} onClick={onReexecute}>重新执行</button> : null}
          <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-continue" disabled={editLocked || !onContinue} onClick={onContinue}>在会话中继续</button>
        </div><p>已有草稿已保留，你可以继续修改后提交。</p>
      </div> : null}
      <label className="collaboration-workspace-revision-input collaboration-workspace-delivery-summary">
        <span className="collaboration-workspace-delivery-group-header"><span>结果说明</span>{data.saveState ? <small className="collaboration-workspace-delivery-meta" data-testid="delivery-saved" role="status">{data.saveState === 'saving' ? '保存中…' : data.saveState === 'error' ? '保存失败，当前修改已保留在此页面' : '已保存'}</small> : null}</span>
        <textarea aria-label="结果说明" data-testid="delivery-summary" aria-describedby={!text.trim() && !generating ? hintId : undefined} rows={4} value={text} disabled={editingDisabled} onChange={(event) => updateText(event.target.value)} />
        {!text.trim() && !generating ? <small id={hintId} className="collaboration-workspace-delivery-meta" data-testid="delivery-summary-required">请填写结果说明</small> : null}
      </label>
      {suggestion ? <div className="collaboration-workspace-delivery-ai-update" data-testid="delivery-ai-update">
        <p>AI 有新的说明：<span className="collaboration-workspace-delivery-ai-excerpt">{suggestion}</span></p>
        <div className="collaboration-workspace-delivery-actions">
          <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-replace-summary" disabled={editingDisabled} onClick={() => { updateText(suggestion); setResolvedAiSummary(suggestion); setConflictingSummary(null); onAiSummaryDecision?.('replace', suggestion) }}>替换</button>
          <button type="button" className="collaboration-workspace-button-ghost" data-testid="delivery-keep-summary" disabled={editingDisabled} onClick={() => { setResolvedAiSummary(suggestion); setConflictingSummary(null); onAiSummaryDecision?.('keep', text) }}>保留我的修改</button>
        </div>
      </div> : null}
      <DeliveryContent declaredFiles={data.declaredFiles} additionalFiles={additionalFiles} showAdditional={hasMaterialSelection} busy={editingDisabled} onPreview={onPreview} onAdd={materialSelection ? () => setPickerOpen(true) : undefined} onRemove={materialSelection ? (file) => updateFiles(additionalFiles.filter((item) => item.id !== file.id)) : undefined} />
      {data.materialError ? <p role="alert" data-testid="delivery-material-error" className="collaboration-workspace-delivery-limit-error">{data.materialError}</p> : null}
      <div className="collaboration-workspace-delivery-actions">
        <button type="button" className="collaboration-workspace-button-primary" data-testid="delivery-submit" disabled={!canSubmit} onClick={() => { setSubmitError(null); setConfirmOpen(true) }}>{submissionPending ? '提交中…' : '提交'}</button>
        <span className="collaboration-workspace-delivery-meta">提交后打包封存，不能再改</span>
      </div>
      {visibleSubmitError && !confirmOpen ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-submit-error" role="alert">{visibleSubmitError}</p> : null}
      {returnControls}
    </> : <DeliverySnapshot snapshot={{ revision: data.revision, summary: data.summary, declaredFiles: data.declaredFiles, additionalFiles: data.additionalFiles, submitter: data.submitter ?? '成员', submittedAt: data.submittedAt ?? '', adopted: data.state === 'adopted' }} showAdditional={hasMaterialSelection} busy={busy} onPreview={onPreview} />}
    {data.history?.length ? <details className="collaboration-workspace-delivery-history" data-testid="delivery-history">
      <summary>历史版本（{data.history.length}）</summary>
      {data.history.map((snapshot) => <details key={snapshot.revision} className="collaboration-workspace-delivery-history-version" data-testid="delivery-history-version">
        <summary>第 {snapshot.revision} 版 · {snapshot.adopted ? '已采纳' : '已提交'} · {formatWorkspaceTime(snapshot.submittedAt)}</summary>
        <DeliverySnapshot snapshot={snapshot} showAdditional={hasMaterialSelection} busy={busy} onPreview={onPreview} />
      </details>)}
    </details> : null}
    {pickerOpen && materialSelection && !editingDisabled ? <DeliveryMaterialPicker selection={materialSelection} declaredFiles={data.declaredFiles} additionalFiles={additionalFiles} onClose={() => setPickerOpen(false)} onConfirm={(selected) => { updateFiles(selected); setPickerOpen(false) }} /> : null}
    {confirmOpen ? <DeliveryDialog titleId={confirmTitleId} testId="delivery-submit-confirmation" busy={locked} onClose={() => setConfirmOpen(false)}>
      <h2 id={confirmTitleId}>提交第 {data.revision} 版？</h2>
      <p>提交后打包封存，之后不能再修改。负责人会收到通知。</p>
      {submissionPending ? <p role="status" aria-live="polite" data-testid="delivery-submit-progress">{progressLabel}</p> : null}
      <div className="collaboration-workspace-delivery-confirm-summary"><h3>结果说明摘要</h3><p data-testid="delivery-confirm-summary">{text.trim().length > 240 ? `${text.trim().slice(0, 240)}…` : text.trim()}</p></div>
      <section className="collaboration-workspace-delivery-confirm-files" aria-label="全部提交文件">
        <h3>提交内容</h3>
        <ul>{files.map((file) => <li key={file.id} data-testid="delivery-confirm-file"><strong>{file.name}</strong><span>{data.declaredFiles.some((declared) => declared.id === file.id) ? '必交 · AI 产出' : deliverySourceLabel(file.source)}</span><small>{formatBytes(file.byteCount)}</small></li>)}</ul>
      </section>
      <DeliveryTotal files={files} showLimit={hasMaterialSelection} />
      {visibleSubmitError ? <p className="collaboration-workspace-delivery-limit-error" data-testid="delivery-submit-error" role="alert">{visibleSubmitError}</p> : null}
      <div className="collaboration-workspace-dialog-actions">
        <button type="button" className="collaboration-workspace-button-secondary" data-testid="delivery-submit-cancel" data-autofocus disabled={locked} onClick={() => setConfirmOpen(false)}>再看看</button>
        <button type="button" className="collaboration-workspace-button-primary" data-testid="delivery-submit-confirm" disabled={!canSubmit} onClick={() => { void submit() }}>{submissionPending ? '提交中…' : '提交'}</button>
      </div>
    </DeliveryDialog> : null}
  </section>
}
