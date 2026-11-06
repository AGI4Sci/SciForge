import * as React from 'react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type { ArtifactVersionRefV1, ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'
import type { SciForgeReproSpecV1 } from '@sciforge/domain-sdk/reproducibility'
import { CREATE_LOOP_CAPABILITY_IDS, createLoopWorkflowInputSchema, createLoopRunResultSchema } from '@sciforge/domain-create-loop/contract'
import { evidenceDagRerunSpecOutputSchema, evidenceDagRerunCompareInputSchema, evidenceDagRerunCompareOutputSchema, type EvidenceDagRerunCompareOutput } from '../contract'

import { evidenceDagCapabilityContracts } from './evidence-dag-capability-client'
const specContract = evidenceDagCapabilityContracts.rerunSpec
const compareContract = evidenceDagCapabilityContracts.rerunCompare
// The sole existing execution capability owns confirmation and executor policy.
const executeContract = { actionId: CREATE_LOOP_CAPABILITY_IDS.run, effect: 'external-write' as const, inputSchema: createLoopWorkflowInputSchema, outputSchema: createLoopRunResultSchema }

export function downloadEvidenceJson(value: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url)
}

export function EvidenceReviewCoverage({ review }: { review: ResearchAuditEvidenceAuditQueryOutput['scientificReview'] }): ReactElement {
  const coverage = review?.coverageDetails
  return <details><summary>索引与科学审查覆盖 · {review?.bounded ? '有界 / bounded' : '仅已记录关系'}</summary>
    {coverage ? <><p>索引版本 {coverage.indexRevision} · 链 {coverage.indexedChains} · 已索引 delta {coverage.indexedDeltas}</p>
      <p>已扫描 {coverage.scannedDeltas} / 相关总量 {coverage.totalRelevantDeltas}</p><p>原因：{coverage.reasons.join(' · ') || '无记录原因'}</p>
      <p>查询节点 {coverage.queryNodes} / 10000 · 索引提取节点 {coverage.extractionNodes} · 未返回记录 {coverage.omittedRecords}；未扫描或遗漏关系保持未知。</p></> : <p>覆盖计数未知。</p>}
  </details>
}

/** Shared owning UI, mounted only for a currently visible exact-version review. */
export function EvidenceRerunReview(props: { result: ResearchAuditEvidenceAuditQueryOutput; reference: ArtifactVersionRefV1; workspaceRoot: string; invoker: DomainRendererCapabilityInvoker; onReview: () => void }): ReactElement {
  const identity = JSON.stringify([props.result, props.reference, props.workspaceRoot])
  return <RerunSession key={identity} {...props} />
}

function RerunSession({ result, reference, workspaceRoot, invoker, onReview }: Parameters<typeof EvidenceRerunReview>[0]): ReactElement {
  const authority = useMemo(() => ({}), [invoker])
  const currentAuthority = useRef(authority); currentAuthority.current = authority
  const live = useRef(true)
  const generation = useRef(0)
  const [selected, setSelected] = useState('')
  const [spec, setSpec] = useState<SciForgeReproSpecV1>()
  const [comparison, setComparison] = useState<EvidenceDagRerunCompareOutput>()
  const [candidateDigest, setCandidateDigest] = useState('')
  const [candidateConclusion, setCandidateConclusion] = useState('')
  const [activityId, setActivityId] = useState('')
  const [state, setState] = useState('')
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    live.current = true
    const changed = () => { generation.current++; setVisible(!document.hidden); setSpec(undefined); setComparison(undefined); setBusy(false); setState('') }
    document.addEventListener('visibilitychange', changed)
    return () => { live.current = false; generation.current++; document.removeEventListener('visibilitychange', changed) }
  }, [])
  useEffect(() => { generation.current++; setSpec(undefined); setComparison(undefined); setBusy(false); setState('') }, [authority])
  const options = { workspaceId: workspaceRoot }
  const choices = result.scientificReview?.impacts.filter(impact => impact.status === 'requires-review').flatMap(impact => {
    const record = result.records.find(item => item.recordDigest === impact.recordDigest && item.closureDigest === impact.closureDigest)
    // No guessed thread mapping or latest-snapshot fallback.
    const separator = record?.threadId.indexOf(':') ?? -1
    if (!record || separator < 1) return []
    return impact.affected.map(target => ({ key: JSON.stringify([record.threadId, impact.closureDigest, target.id]), title: target.title,
      runtimeId: record.threadId.slice(0, separator), threadId: record.threadId.slice(separator + 1), closureDigest: impact.closureDigest, conclusionId: target.id }))
  }) ?? []
  const choice = choices.find(item => item.key === selected)
  const perform = async (job: (current: () => boolean) => Promise<void>) => {
    if (busy || !visible || document.hidden) return
    const token = ++generation.current, requestedAuthority = authority
    const current = () => live.current && token === generation.current && currentAuthority.current === requestedAuthority && !document.hidden
    setBusy(true); setState('')
    try { await job(current) } catch (error) { if (current()) setState(`unknown / 请求失败：${error instanceof Error ? error.message : String(error)}；未假定执行完成或未执行。`) }
    finally { if (current()) setBusy(false) }
  }
  return <section aria-label="显式复跑与比较">
    <p>材料变化 → 选择受影响结论 → 读取最小已记录活动/依赖 → 预览 spec → 明确启动 → 精确对照 → 当前材料重新审阅。</p>
    <p>既有 owner 将精确闭包解析为其保留的快照；缺失绑定或快照时显示失败，不替换为最新快照。</p>
    <select aria-label="受影响结论" value={selected} disabled={busy} onChange={event => { generation.current++; setSelected(event.target.value); setSpec(undefined); setComparison(undefined); setState('') }}>
      <option value="">选择需重新审查的具体结论</option>{choices.map((item, i) => <option key={i} value={item.key}>{item.title} · {item.conclusionId}</option>)}
    </select>
    {!choices.length && <p>没有可授权绑定的受影响结论与精确线程；复跑建议未知。</p>}
    <button disabled={!choice || busy || !visible} onClick={() => void perform(async current => {
      if (!choice) return
      const value = evidenceDagRerunSpecOutputSchema.parse(await invoker.invoke(specContract, { runtimeId: choice.runtimeId, threadId: choice.threadId, closureDigest: choice.closureDigest, conclusionId: choice.conclusionId }, options))
      if (value.source.threadId !== `${choice.runtimeId}:${choice.threadId}` || value.source.conclusionId !== choice.conclusionId || value.target.kind !== 'conclusion' || value.target.id !== choice.conclusionId) throw new Error('复跑 spec 精确身份不一致')
      if (current()) { setActivityId(''); setSpec(value) }
    })}>读取最小复跑建议 / spec</button>
    {visible && spec && <>
      <p>executionReady={String(spec.executionReady)} · {spec.reproducibility}。可执行不等于已授权；仅已记录依赖，缺失条件仍未知。</p>
      <details><summary>复跑预览：输入、代码/软件、参数、活动与依赖</summary><pre>{JSON.stringify(spec, null, 2)}</pre></details>
      <button disabled={busy} onClick={() => { if (live.current && !document.hidden) downloadEvidenceJson(spec, 'evidence-rerun-spec.json') }}>下载 spec</button>
      {spec.activities.length > 1 && <label>明确选择本次执行活动（依赖仍按 spec 核对，不隐式执行整条链）<select aria-label="执行活动" disabled={busy} value={activityId} onChange={event => setActivityId(event.target.value)}><option value="">选择活动</option>{spec.activities.map(activity => <option key={activity.id} value={activity.id}>{activity.name} · {activity.id} · {activity.executor.kind}</option>)}</select></label>}
      <button disabled={busy || !spec.executionReady || spec.activities.length > 1 && !activityId} onClick={() => void perform(async current => {
        setState('running / 正在请求既有 workflowExecute 治理；尚无完成回执。')
        const execution = createLoopRunResultSchema.parse(await invoker.invoke(executeContract, { rerunSpec: spec, ...(activityId ? { activityId } : {}) }, { ...options, approval: { mode: 'confirmation' } }))
        if (current()) setState(!execution.ok ? `refused / failed：${execution.message}` : `${execution.status === 'error' ? 'failed' : execution.status} · ${execution.runId} · ${execution.message}；执行回执不等于科学证明。`)
      })}>明确启动复跑（既有确认与治理）</button>
      <label>候选精确 snapshot digest<input aria-label="候选快照摘要" value={candidateDigest} disabled={busy} maxLength={71} onInput={event => { generation.current++; setBusy(false); setCandidateDigest(event.currentTarget.value); setComparison(undefined) }} /></label>
      <label>候选结论 ID<input aria-label="候选结论 ID" value={candidateConclusion} disabled={busy} maxLength={512} onInput={event => { generation.current++; setBusy(false); setCandidateConclusion(event.currentTarget.value); setComparison(undefined) }} /></label>
      <button disabled={busy || !choice || !candidateDigest || !candidateConclusion} onClick={() => void perform(async current => {
        if (!choice) return
        const input = evidenceDagRerunCompareInputSchema.parse({ runtimeId: choice.runtimeId, threadId: choice.threadId, baselineDigest: spec.source.snapshotDigest, baselineConclusionId: spec.target.id, candidateDigest, candidateConclusionId: candidateConclusion })
        const value = evidenceDagRerunCompareOutputSchema.parse(await invoker.invoke(compareContract, input, options))
        if (value.baseline.source.threadId !== spec.source.threadId || value.candidate.source.threadId !== spec.source.threadId || value.baseline.source.snapshotDigest !== input.baselineDigest || value.baseline.target.id !== input.baselineConclusionId || value.candidate.source.snapshotDigest !== input.candidateDigest || value.candidate.target.id !== input.candidateConclusionId) throw new Error('比较响应精确身份不一致')
        if (current()) setComparison(value)
      })}>比较精确 baseline / candidate</button>
    </>}
    {visible && comparison && <><p>{comparison.comparison.classification} · {comparison.comparison.replicationStatus} · 可核验 {String(comparison.comparison.comparisonVerifiable)}</p>
      <details open><summary>输入 / 代码软件 / 参数 / 版本差异与科学边界</summary><pre>{JSON.stringify(comparison, null, 2)}</pre><p>对照分类只基于已记录 spec、执行上下文及输出比较器；不证明科学有效性或跨条件推广。</p></details></>}
    {state && visible && <p role="status">{state}</p>}
    <button disabled={busy || !visible} onClick={onReview}>重新审阅当前精确材料 · {reference.versionId}</button>
  </section>
}
