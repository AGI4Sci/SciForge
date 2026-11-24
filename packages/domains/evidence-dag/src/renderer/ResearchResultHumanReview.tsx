import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { researchHumanReviewContract, researchResultBindingSchema, type ResearchRecordScope, type ResearchRecordView } from '../research-record-contract'

type Result = NonNullable<ResearchRecordView['resultImpact']>[number]
const decisions = { approved: '认可', 'changes-requested': '需修改', 'unable-to-judge': '无法判断', skipped: '已跳过' }
const button = 'rounded border border-ds-border px-2 py-1 text-ds-muted hover:bg-ds-hover disabled:opacity-50'

export function ResearchResultHumanReview({ result, enabled, revision, scope, invoker, active, onSaved }: {
  result: Result; enabled: boolean; revision: number; scope: ResearchRecordScope; invoker: DomainRendererCapabilityInvoker; active: boolean; onSaved?: () => void
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'changes-requested' | 'unable-to-judge'>('approved')
  const [opinion, setOpinion] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false), generation = useRef(0)
  const request = useRef<{ key: string; input: unknown } | undefined>(undefined)
  const { status: _status, reasons: _reasons, humanReview: review, ...base } = result
  const binding = researchResultBindingSchema.parse({ ...base, presentations: base.presentations.map(({ status: _status, ...item }) => item) })
  const identity = JSON.stringify([scope, binding, revision, enabled])
  useEffect(() => {
    generation.current++; pending.current = false; request.current = undefined
    setExpanded(false); setOpinion(''); setMessage(''); setBusy(false)
    return () => { generation.current++ }
  }, [identity, invoker, active])
  const submit = async (selected: 'approved' | 'changes-requested' | 'unable-to-judge' | 'skipped') => {
    if (pending.current || !active || !enabled || document.hidden) return
    pending.current = true; setBusy(true); setMessage('')
    const token = generation.current
    const key = JSON.stringify([identity, selected, opinion.trim()])
    if (request.current?.key !== key) request.current = { key, input: { target: { ...scope, binding, expectedRevision: revision,
      requestId: crypto.randomUUID(), decision: selected, opinion: opinion.trim() } } }
    try {
      await invoker.invoke(researchHumanReviewContract, researchHumanReviewContract.inputSchema.parse(request.current.input), { workspaceId: scope.workspaceRoot, approval: { mode: 'confirmation' } })
      if (token === generation.current) { setMessage('已记录。'); setExpanded(false); onSaved?.() }
    } catch (error) { if (token === generation.current) setMessage(error instanceof Error ? error.message : String(error)) }
    finally { if (token === generation.current) { pending.current = false; setBusy(false) } }
  }
  return <div aria-label="人工复核" className="mt-2 space-y-2 border-t border-ds-border pt-2">
    {enabled && <><p className="text-ds-muted">人工复核可选，不阻塞研究。{review?.latest ? `${decisions[review.latest.decision]} · ${review.applicability === 'current' ? '适用于当前版本' : review.applicability === 'stale' ? '版本或材料已变化，旧意见不代表当前结果' : '当前适用性未知'}` : '尚无人工复核记录。'}</p>
      {!expanded && <button type="button" className={button} disabled={!active || busy} onClick={() => setExpanded(true)}>复核此结果</button>}
      {expanded && <div className="space-y-2">
        <p className="text-ds-muted">提交时由系统确认当前账户身份；未选择账户时，请先在账户设置中选择身份。本地账户选择与云端认证分别记录。</p>
        <label className="block">复核结论 <select aria-label="复核结论" className={button} value={decision} disabled={busy} onChange={event => setDecision(event.target.value as typeof decision)}>
          <option value="approved">认可</option><option value="changes-requested">需修改</option><option value="unable-to-judge">无法判断</option>
        </select></label>
        <label className="block">复核意见<textarea aria-label="复核意见" maxLength={4000} rows={3} disabled={busy} className="mt-1 w-full rounded border border-ds-border bg-ds-main p-2" value={opinion} onChange={event => setOpinion(event.target.value)} placeholder="填写核对内容、依据及保留意见；跳过时原因可留空。" /></label>
        <p className="break-all text-ds-muted">复核范围：结果 {binding.result.versionId}、{binding.inputs.length} 个输入、{binding.presentations.length} 处报告展示。认可仅记录个人意见。</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !active || !opinion.trim() || decision === 'approved' && (result.status !== 'no-recorded-impact' || result.presentations.some(item => item.status !== 'no-recorded-impact'))} onClick={() => void submit(decision)}>提交复核…</button>
          <button type="button" className={button} disabled={busy || !active} onClick={() => void submit('skipped')}>跳过复核…</button>
          <button type="button" className={button} disabled={busy} onClick={() => setExpanded(false)}>收起</button></div>
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
    {!!review?.history.length && <details><summary>历史复核 · {review.total} 条{!enabled ? ' · 人工复核已关闭' : ''}</summary>
      {review.history.map(item => <div key={item.requestId} className="my-2 border-l border-ds-border pl-2">
        <p>{decisions[item.decision]} · {item.at}</p><p className="break-all text-ds-muted">{item.principal.subject} · {item.principal.assurance === 'cloud-authenticated' ? '云端认证' : '本地账户选择'}</p>
        <p className="whitespace-pre-wrap break-words">{item.opinion || '未填写跳过原因。'}</p>
        <details><summary>身份、确认与精确版本</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(item, null, 2)}</pre></details>
      </div>)}{review.limited && <p className="text-ds-muted">此处显示最近 10 条；更早记录保留在研究记录历史中。</p>}
    </details>}
  </div>
}
