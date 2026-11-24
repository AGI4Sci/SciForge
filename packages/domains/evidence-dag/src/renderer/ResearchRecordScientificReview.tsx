import { AuditReviewHistory } from './AuditReviewHistory'
import { EvidenceRerunReview, EvidenceReviewCoverage } from './EvidenceRerunReview'
import { ResearchResultHumanReview } from './ResearchResultHumanReview'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { FileSearch, MessageSquare, RotateCcw } from 'lucide-react'
import { artifactVersionRefV1Schema, type ArtifactVersionRefV1, type ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import type { ResearchRecordScope, ResearchRecordView } from '../research-record-contract'
import { evidenceDagAuditQueryInputSchema, evidenceDagAuditQueryOutputSchema, EVIDENCE_DAG_CAPABILITY_IDS } from '../contract'
import { materialReviewDiscussion, materialReviewStatus, reviewAxes } from './material-review-discussion'

const contract = { actionId: EVIDENCE_DAG_CAPABILITY_IDS.auditQuery, effect: 'read' as const, inputSchema: evidenceDagAuditQueryInputSchema, outputSchema: evidenceDagAuditQueryOutputSchema }
const button = 'inline-flex items-center gap-1 rounded px-2 py-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50'
/** Existing exact-version read port; no additional review database or write path. */
export function ResearchRecordScientificReview({ view, scope, invoker, workbench, active = true, onSaved }: { view: ResearchRecordView; scope: ResearchRecordScope; active?: boolean; invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost; onSaved?: () => void }): ReactElement {
  const [issue, setIssue] = useState('')
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [visibilityEpoch, setVisibilityEpoch] = useState(0)
  const refs = view.auditReferences?.refs ?? []
  const identity = JSON.stringify(refs)
  const requestKey = JSON.stringify([scope.runtimeId, scope.threadId, scope.workspaceRoot, view.node?.id, view.revision, identity])
  const schedule = useMemo(() => reviewQueue(3), [requestKey, invoker, active, visible, visibilityEpoch])
  useEffect(() => {
    const changed = () => { setVisibilityEpoch(value => value + 1); setVisible(!document.hidden) }
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => { setIssue('') }, [requestKey, invoker, active, visible, visibilityEpoch])
  const authority = useRef(0)
  useEffect(() => { authority.current++; return () => { authority.current++ } }, [requestKey, workbench, active, visible, visibilityEpoch])
  const open = async (kind: string, id: string, digest: string) => {
    const token = authority.current
    try { if (!await workbench?.openResource?.({ sessionId: scope.threadId, resource: { resourceKind: kind, resourceId: id, integrity: { algorithm: 'sha256', expectedDigest: digest } } }) && token === authority.current) setIssue('精确版本导航当前不可用。') }
    catch (error) { if (token === authority.current) setIssue(String(error)) }
  }
  const impacts = view.synthesisImpact ?? []
  const pending = impacts.filter(item => item.status === 'requires-review').length
  return <section aria-label="科学审查与材料影响" className="space-y-2 record-caption">
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium text-ds-ink">材料核查</h3><span className="text-ds-muted">{refs.length} 份材料{pending ? ` · ${pending} 项摘要待复核` : ''}</span></div>
    <p className="text-ds-muted">变化需复核；有记录不等于已验证。</p>
    {!!view.resultImpact?.length && <div aria-label="结果与报告展示" className="space-y-2">
      {view.resultImpact.map(result => <article key={result.id} data-result-impact={result.status} className="rounded border border-ds-border p-2">
        <p className="font-medium">{result.title} · {result.status === 'requires-review' ? '待复核' : result.status === 'unknown' ? '状态未知' : '未见已记录变化'}</p>
        <p className="break-all text-ds-muted">结果 {result.result.versionId} · {result.inputs.length} 个输入版本</p>
        <p className="text-ds-muted">以下展示引用同一结果，不构成独立证据。</p>
        {result.presentations.map(presentation => <div key={presentation.id} data-presentation-impact={presentation.status} className="mt-1 border-l border-ds-border pl-2">
          <p>{presentation.label} · {presentation.status === 'requires-review' ? '待复核' : presentation.status === 'unknown' ? '状态未知' : '未见已记录变化'}</p>
          <p className="break-words text-ds-muted">{presentation.location}</p>
        </div>)}
        {!!result.reasons.length && <details><summary>变化依据</summary>{result.reasons.map(reason => <p key={reason} className="break-all text-ds-muted">{reason}</p>)}</details>}
        {(view.humanReview?.enabled || !!result.humanReview?.total) && <ResearchResultHumanReview result={result} enabled={view.humanReview?.enabled ?? false} revision={view.revision} scope={scope} invoker={invoker} active={active && visible} onSaved={onSaved} />}
      </article>)}
    </div>}
    {!!impacts.length && <details open={pending > 0}><summary className="cursor-pointer text-ds-muted">摘要与来源 · {pending ? `${pending} 项待复核` : '查看关系'}</summary>
      {impacts.map(item => <details key={item.id} data-synthesis-impact={item.status} className="my-1 rounded border border-ds-border px-2 py-1"><summary className="cursor-pointer">{item.title} · {item.status === 'requires-review' ? '需复核' : item.status === 'unknown' ? '关系未知' : '未见已记录变化'}</summary><p className="break-words text-ds-muted">{item.sourceIds.join(' · ') || '未记录来源关系，适用性未知。'}</p></details>)}
    </details>}
    {!refs.length && <p className="text-ds-muted">{view.auditReferences?.limited ? '相关材料尚未完整读取，可继续查看原始记录。' : '尚未关联材料。'}</p>}
    {view.auditReferences?.limited && <p className="text-ds-muted">仅返回部分引用，其余范围未知。</p>}
    {active && visible && refs.map((ref, index) => <ExactMaterialReview key={requestKey + exactRefKey(ref)} label={`材料 ${index + 1}`} reference={ref} invoker={invoker} scope={scope} workbench={workbench} schedule={schedule} open={open} />)}
    {issue && <p role="alert">{issue}</p>}
  </section>
}

// Schema order is canonical; all immutable identity, policy and availability fields participate.
function exactRefKey(reference: ArtifactVersionRefV1): string {
  return JSON.stringify(artifactVersionRefV1Schema.parse(reference))
}
function reviewQueue(limit: number) {
  let running = 0
  const waiting: (() => void)[] = []
  const pump = () => { while (running < limit && waiting.length) waiting.shift()!() }
  return (job: () => Promise<void>) => { waiting.push(() => {
    running++
    void job().finally(() => { running--; pump() })
  }); pump() }
}
function ExactMaterialReview({ label, reference, invoker, scope, workbench, schedule, open }: {
  label: string; reference: ArtifactVersionRefV1; invoker: DomainRendererCapabilityInvoker; scope: ResearchRecordScope; workbench?: DomainRendererWorkbenchHost
  schedule: ReturnType<typeof reviewQueue>; open: (kind: string, id: string, digest: string) => Promise<void>
}): ReactElement {
  const [loaded, setLoaded] = useState<{ invoker: DomainRendererCapabilityInvoker; value: ResearchAuditEvidenceAuditQueryOutput }>()
  const result = loaded?.invoker === invoker ? loaded.value : undefined
  const [error, setError] = useState('')
  const [discussionError, setDiscussionError] = useState('')
  const [opening, setOpening] = useState(false)
  const discussing = useRef(false)
  const generation = useRef(0)
  const workspaceRoot = scope.workspaceRoot
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    generation.current++; discussing.current = false
    setLoaded(undefined); setError(''); setDiscussionError(''); setOpening(false)
    schedule(async () => {
      if (!current || document.hidden) return
      try {
        const value = evidenceDagAuditQueryOutputSchema.parse(await invoker.invoke(contract, { subject: { artifactVersionRef: reference } }, { workspaceId: workspaceRoot }))
        if (!('artifactVersionRef' in value.subject) || exactRefKey(value.subject.artifactVersionRef) !== exactRefKey(reference)) throw new Error('审查响应与请求的完整精确产物身份不一致，未显示该结果。')
        if (current && !document.hidden) setLoaded({ invoker, value })
      } catch (cause) { if (current && !document.hidden) setError(cause instanceof Error ? cause.message : String(cause)) }
    })
    return () => { current = false; generation.current++ }
  }, [reference, invoker, workspaceRoot, schedule, attempt, workbench])
  const context = useMemo(() => {
    if (!result) return undefined
    try { return { request: materialReviewDiscussion(scope, reference, result) } }
    catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) } }
  }, [scope, reference, result])
  const status = result ? materialReviewStatus(result) : undefined
  const discuss = async () => {
    if (!context?.request || !workbench?.openSideConversation || document.hidden || discussing.current) return
    const token = generation.current
    discussing.current = true; setOpening(true); setDiscussionError('')
    try { if (!await workbench.openSideConversation(context.request) && token === generation.current) setDiscussionError('侧聊暂不可用，请重试。') }
    catch (cause) { if (token === generation.current) setDiscussionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (token === generation.current) { discussing.current = false; setOpening(false) } }
  }
  return <article data-exact-material={reference.versionId} className="min-w-0 rounded-lg border border-ds-border p-3">
    <div className="flex flex-wrap items-start gap-2"><span className="min-w-0 flex-1 truncate font-medium text-ds-ink" title={reference.versionId}>{label}</span>
      {status && <span data-review-attention={status.attention} className="shrink-0 text-ds-muted">{status.label}</span>}</div>
    {!result && !error && <p role="status" className="mt-1 text-ds-muted">正在读取核查依据…</p>}
    {error && <><p role="alert" className="mt-1 break-words">{error}</p><button className={button} type="button" onClick={() => setAttempt(value => value + 1)}>重试该材料 · {reference.versionId}</button></>}
    {result && <>
      <div className="my-1 flex flex-wrap gap-1"><button className={button} type="button" onClick={() => void open('artifact-version', reference.versionId, `sha256:${reference.contentDigest}`)}><FileSearch size={13} />查看材料</button>
        <button className={button} type="button" disabled={opening || !context?.request || !workbench?.openSideConversation} onClick={() => void discuss()}><MessageSquare size={13} />{opening ? '正在打开…' : '讨论'}</button>
      </div>
      {(discussionError || context?.error) && <p role="alert">{discussionError || context?.error}</p>}
      <details><summary className="cursor-pointer text-ds-muted">依据与范围</summary><div className="mt-2 space-y-2 break-words">
        <button className={button} type="button" disabled={opening} onClick={() => setAttempt(value => value + 1)}><RotateCcw size={13} />重新核查</button>
        <p className="text-ds-muted">授权、材料完整性、执行成功与科研认可分别判断。</p>
        <AuditReviewHistory decisions={result.reviewDecisions} />
        <EvidenceReviewCoverage review={result.scientificReview} />
        {result.scientificReview?.conditions.map(condition => <details key={condition.axis}><summary className="cursor-pointer">{reviewAxes[condition.axis]} · {condition.status === 'unknown' ? '未知' : '有记录'}</summary>{condition.observations.map((item, i) => <div key={i} className="my-2"><p className="whitespace-pre-wrap">{item.text}</p><details><summary>精确引用</summary><p>{item.targetId} · {item.recordDigest} · {item.closureDigest}</p></details></div>)}</details>)}
        {result.scientificReview?.impacts.map((impact, index) => <div key={impact.recordDigest + ':' + index}><p>{impact.status === 'requires-review' ? '需复核' : impact.status === 'unknown' ? '影响未知' : '未见已记录影响'} · {impact.affected.map(item => item.title).join(' · ') || '未记录具体目标'}</p>{impact.changes.map((change, i) => <p key={i}>{change.reason}</p>)}<button className={button} type="button" onClick={() => void open('evidence-closure', impact.closureDigest, impact.closureDigest)}>查看对应证据链</button></div>)}
        <details><summary>材料版本</summary><p>{reference.versionId} · sha256:{reference.contentDigest} · {result.freshness}</p></details>
        {context?.request && <details><summary>讨论会带入什么</summary><pre className="whitespace-pre-wrap break-words">{context.request.context?.text}</pre><p>打开讨论草稿后再提问，不自动调用模型。</p></details>}
      </div></details>
      <EvidenceRerunReview result={result} reference={reference} workspaceRoot={workspaceRoot} invoker={invoker} onReview={() => setAttempt(value => value + 1)} />
    </>}
  </article>
}
