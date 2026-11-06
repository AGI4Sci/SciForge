import { EvidenceRerunReview, EvidenceReviewCoverage } from './EvidenceRerunReview'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { artifactVersionRefV1Schema, type ArtifactVersionRefV1, type ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import type { ResearchRecordScope, ResearchRecordView } from '../research-record-contract'
import { evidenceDagAuditQueryInputSchema, evidenceDagAuditQueryOutputSchema, EVIDENCE_DAG_CAPABILITY_IDS } from '../contract'

const contract = { actionId: EVIDENCE_DAG_CAPABILITY_IDS.auditQuery, effect: 'read' as const, inputSchema: evidenceDagAuditQueryInputSchema, outputSchema: evidenceDagAuditQueryOutputSchema }
const axes = { independence: '来源独立性', controls: '对照与比较条件', 'negative-results': '负结果', reproduction: '复现', scope: '适用范围与未决缺口' }
/** Existing exact-version read port; no additional review database or write path. */
export function ResearchRecordScientificReview({ view, scope, invoker, workbench, active = true }: { view: ResearchRecordView; scope: ResearchRecordScope; active?: boolean; invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost }): ReactElement {
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
  const open = (kind: string, id: string, digest: string) => {
    try { if (!workbench?.openResource?.({ sessionId: scope.threadId, resource: { resourceKind: kind, resourceId: id, integrity: { algorithm: 'sha256', expectedDigest: digest } } })) setIssue('精确版本导航当前不可用。') }
    catch (error) { setIssue(String(error)) }
  }
  return <section aria-label="科学审查与材料影响" className="space-y-2 record-caption">
    <p>科学审查与材料影响：材料变化要求重新审查，不等于科学反驳。授权、字节完整性、执行成功和复现分别核对。</p>
    {(view.synthesisImpact ?? []).map(item => <details key={item.id} data-synthesis-impact={item.status}><summary>{item.title} · {item.status === 'requires-review' ? '来源已变化或缺失，需重新审查' : item.status === 'unknown' ? '来源关系未知' : '已映射来源未发现变化'}</summary><p>{item.sourceIds.join(' · ') || '没有记录来源关系；人工摘要适用性未知。'}</p></details>)}
    {!refs.length && <p>没有记录可绑定的完整 ArtifactVersion 引用；正式科学条件与影响覆盖未知。</p>}
    {refs.map(ref => <button type="button" key={exactRefKey(ref)} onClick={() => open('artifact-version', ref.versionId, `sha256:${ref.contentDigest}`)}>档案精确版本 · {ref.versionId}</button>)}
    {view.auditReferences?.limited && <p>引用读取有界，更多材料及未映射关系保持未知。</p>}
    {active && visible && refs.map(ref => <ExactMaterialReview key={requestKey + exactRefKey(ref)} reference={ref} invoker={invoker} workspaceRoot={scope.workspaceRoot} schedule={schedule} open={open} />)}
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
function ExactMaterialReview({ reference, invoker, workspaceRoot, schedule, open }: {
  reference: ArtifactVersionRefV1; invoker: DomainRendererCapabilityInvoker; workspaceRoot: string
  schedule: ReturnType<typeof reviewQueue>; open: (kind: string, id: string, digest: string) => void
}): ReactElement {
  const [loaded, setLoaded] = useState<{ invoker: DomainRendererCapabilityInvoker; value: ResearchAuditEvidenceAuditQueryOutput }>()
  const result = loaded?.invoker === invoker ? loaded.value : undefined
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setLoaded(undefined); setError('')
    schedule(async () => {
      if (!current || document.hidden) return
      try {
        const value = evidenceDagAuditQueryOutputSchema.parse(await invoker.invoke(contract, { subject: { artifactVersionRef: reference } }, { workspaceId: workspaceRoot }))
        if (!('artifactVersionRef' in value.subject) || exactRefKey(value.subject.artifactVersionRef) !== exactRefKey(reference)) throw new Error('审查响应与请求的完整精确产物身份不一致，未显示该结果。')
        if (current && !document.hidden) setLoaded({ invoker, value })
      } catch (cause) { if (current && !document.hidden) setError(cause instanceof Error ? cause.message : String(cause)) }
    })
    return () => { current = false }
  }, [reference, invoker, workspaceRoot, schedule, attempt])
  return <div data-exact-material={reference.versionId}>
    {!result && !error && <p role="status">正在审查精确材料 · {reference.versionId}</p>}
    {error && <><p role="alert">{reference.versionId} · {error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试该材料 · {reference.versionId}</button></>}
    {result && <details><summary>精确材料审查 · {reference.versionId} · {result.freshness}</summary>
      <EvidenceReviewCoverage review={result.scientificReview} /><EvidenceRerunReview result={result} reference={reference} workspaceRoot={workspaceRoot} invoker={invoker} onReview={() => setAttempt(value => value + 1)} /><p>仅记录关系；{result.scientificReview?.bounded ? '覆盖有界' : '缺失关系仍未知'}</p>
      {result.scientificReview?.conditions.map(condition => <details key={condition.axis}><summary>{axes[condition.axis]} · {condition.status === 'unknown' ? '未知' : '有记录（不等于已验证）'}</summary>{condition.observations.map((item, i) => <p key={i}>{item.targetId} · {item.text} · {item.recordDigest} · {item.closureDigest}</p>)}</details>)}
      {result.scientificReview?.impacts.slice(0, 10).map(impact => <div key={impact.recordDigest}><p>{impact.status} · {impact.affected.map(item => item.title).join(' · ')}</p>{impact.changes.map((change, i) => <p key={i}>{change.reason}</p>)}<button type="button" onClick={() => open('evidence-closure', impact.closureDigest, impact.closureDigest)}>打开精确闭包 · {impact.closureDigest}</button></div>)}
    </details>}

  </div>
}
