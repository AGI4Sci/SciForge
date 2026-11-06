import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { researchRecordContracts, researchRecordSourceSchema, type ResearchRecordScope, type ResearchRecordView } from '../research-record-contract'
import { downloadEvidenceJson } from './EvidenceRerunReview'

export function ResearchSourceRetention({ view, scope, invoker, active }: { view: ResearchRecordView; scope: ResearchRecordScope; invoker: DomainRendererCapabilityInvoker; active: boolean }): ReactElement {
  const identity = JSON.stringify([scope, view.node?.id, view.node?.source, view.revision])
  const authority = useMemo(() => ({}), [identity, invoker, active])
  const current = useRef(authority); current.current = authority
  const generation = useRef(0), mounted = useRef(true)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState<ResearchRecordView['sourceExport']>()
  const [loadedAuthority, setLoadedAuthority] = useState<object>()
  const [busy, setBusy] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  useEffect(() => { generation.current++; setReady(undefined); setNotice(''); setBusy(false) }, [authority])
  useEffect(() => {
    const changed = () => { generation.current++; setReady(undefined); setNotice(''); setBusy(false); setVisible(!document.hidden) }
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const usage = view.sourceRetention
  const request = async () => {
    if (!active || busy || document.hidden || !view.node?.source) return
    const requested = authority, token = ++generation.current
    const live = () => mounted.current && current.current === requested && token === generation.current && !document.hidden
    setBusy(true); setReady(undefined); setNotice('')
    try {
      const result = researchRecordContracts.view.outputSchema.parse(await invoker.invoke(researchRecordContracts.view, { ...scope, nodeId: view.node.id, offset: 0, includeSourceExport: true }, { workspaceId: scope.workspaceRoot }))
      if (!live()) return
      const source = result.sourceExport
      if (result.revision !== view.revision || result.node?.id !== view.node.id || JSON.stringify(result.node.source) !== JSON.stringify(view.node.source)) throw new Error('来源导出 node / ref / digest 精确身份不一致')
      if (!source?.complete) { setNotice(`来源导出不可用：${source?.reasons.join(' · ') || 'missing / incomplete owner projection'}`); return }
      if (!source.ref || JSON.stringify(researchRecordSourceSchema.parse(source.ref)) !== JSON.stringify(researchRecordSourceSchema.parse(view.node.source))) throw new Error('来源导出 ref / digest 精确身份不一致')
      if (!Object.hasOwn(source, 'raw') || source.raw === undefined || source.raw === null) { setNotice(`来源导出不可用：${source.reasons.join(' · ') || 'raw missing'}`); return }
      setLoadedAuthority(requested)
      setReady(source)
    } catch (error) { if (live()) setNotice(error instanceof Error ? error.message : String(error)) }
    finally { if (live()) setBusy(false) }
  }
  return <section aria-label="来源保全与单项导出">
    <details><summary>来源保全容量 · {usage?.usageKnown ? `${usage.usedBytes} / ${usage.maxBytes} bytes` : 'UNKNOWN（用量未知）'}</summary>
      {usage ? <><p>保全条目 {usage.usageKnown ? `${usage.retainedEntries} / ${usage.maxEntries}` : 'UNKNOWN'}</p><p>引用 {usage.referencedEntries} · 已检查 {usage.inspectedEntries} · {usage.complete ? '当前有界检查完成' : '验证有界 / 未完成'}</p>
        <p>missing {usage.missingEntries} · corrupt {usage.corruptEntries} · rejected {usage.rejectedEntries} · 中断写预留 {usage.reservedEntries ?? 0}</p><p>{usage.reasons.join(' · ')}</p><p>{usage.policy} · exportRequired={String(usage.exportRequired)}</p></> : <p>没有容量或验证覆盖回执，保持未知。</p>}
      <p>仅当前授权记录引用的保全来源表示；不代表全档案、完整会话或科学产物迁移。始终保留原来源，不自动删除。</p>
    </details>
    <button disabled={!active || !visible || busy || !view.node?.source} onClick={() => void request()}>请求授权的单项保全来源</button>
    {active && visible && ready && loadedAuthority === authority && <button onClick={() => { if (mounted.current && current.current === loadedAuthority && !document.hidden) downloadEvidenceJson(ready, 'research-retained-source.json') }}>下载单项来源（保留 raw / ref / digest）</button>}
    {notice && <p role="alert">{notice}</p>}
  </section>
}
