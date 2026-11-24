import { AuditReviewHistory } from './AuditReviewHistory'
import { RecordLongText } from './RecordLongText'
import { createResearchRecordPresentation } from './research-record-presentation'
import React, { useEffect, useState, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { EVIDENCE_DAG_CAPABILITY_IDS, evidenceDagAuditQueryInputSchema, evidenceDagAuditQueryOutputSchema, type EvidenceDagAuditQueryOutput } from '../contract'

const contract = { actionId: EVIDENCE_DAG_CAPABILITY_IDS.auditQuery, effect: 'read' as const, inputSchema: evidenceDagAuditQueryInputSchema, outputSchema: evidenceDagAuditQueryOutputSchema }
export async function readExactEvidenceClosure(invoker: DomainRendererCapabilityInvoker, workspaceRoot: string, closureDigest: string): Promise<EvidenceDagAuditQueryOutput> {
  if (!workspaceRoot.trim()) throw new Error('缺少当前工作区；未读取证据。')
  const input = contract.inputSchema.parse({ subject: { closureDigest } })
  const result = contract.outputSchema.parse(await invoker.invoke(contract, input, { workspaceId: workspaceRoot }))
  if (!('closureDigest' in result.subject) || result.subject.closureDigest !== closureDigest) throw new Error('证据 owner 返回了不同闭包；未展示其他版本。')
  return result
}

/** A read-only exact closure view, separate from the mutable graph renderer. */
export function EvidenceClosurePanel({ invoker, workspaceRoot, closureDigest, active, onClose }: {
  invoker: DomainRendererCapabilityInvoker; workspaceRoot: string; closureDigest: string; active: boolean; onClose: () => void
}): ReactElement {
  const [presentation] = useState(createResearchRecordPresentation)
  const [result, setResult] = useState<EvidenceDagAuditQueryOutput | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setResult(null); setError(''); setOffset(0)
    if (!active) { setBusy(false); return }
    setBusy(true)
    void readExactEvidenceClosure(invoker, workspaceRoot, closureDigest).then(value => { if (current) setResult(value) })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [invoker, workspaceRoot, closureDigest, active, refresh])
  return <section className="flex h-full min-h-0 flex-col bg-ds-main text-ds-ink" aria-label="本次审阅依据">
    <header className="flex shrink-0 items-center gap-2 border-b border-ds-border p-3 text-ds-lg"><strong>本次审阅依据</strong><button className="ml-auto" onClick={onClose}>收起</button></header>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-ds-lg [overflow-wrap:anywhere]">
      <p className="text-ds-muted">查看这次审阅所引用的材料与记录。</p><details className="text-ds-sm"><summary className="cursor-pointer">技术引用</summary><p className="font-mono">{closureDigest}</p></details>
      <button className="rounded border border-ds-border px-2 py-1" disabled={busy || !active} onClick={() => setRefresh(value => value + 1)}>{busy ? '正在读取…' : '重新读取'}</button>
      {error && <p role="alert">{error}</p>}
      {result && <><AuditReviewHistory decisions={result.reviewDecisions} /><p className="text-ds-muted">{result.freshness === 'fresh' ? '已读取所选范围的依据。' : '依据尚未确认与当前材料同步。'}{!result.completeness.complete ? ' 部分依据未能读取。' : ''}</p>
        {!!result.completeness.gapCodes.length && <details><summary className="cursor-pointer text-ds-sm">读取详情</summary><p>{result.completeness.gapCodes.join(' · ')}</p></details>}
        {!result.records.length && <p>此范围没有可读取的关联材料记录。</p>}
        <ol className="space-y-3">{result.records.slice(offset, offset + 20).map(record => <li key={record.recordDigest} className="rounded-lg border border-ds-border p-3">
          <p>关联记录 · {new Date(record.createdAt).toLocaleString('zh-CN')}</p>
          <details><summary className="cursor-pointer text-ds-sm">完整记录与技术引用</summary><RecordLongText id={record.recordDigest} label="完整记录与精确标识" text={JSON.stringify(record, null, 2)} presentation={presentation} /></details>
        </li>)}</ol>
        {result.records.length > 20 && <div className="flex gap-3"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一组</button><span>{offset + 1}–{Math.min(offset + 20, result.records.length)} / {result.records.length}</span><button disabled={offset + 20 >= result.records.length} onClick={() => setOffset(offset + 20)}>下一组</button></div>}
      </>}
    </div>
  </section>
}
