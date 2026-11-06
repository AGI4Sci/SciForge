import { evidenceDagActivationPayloadSchema } from '../contract'
import { EvidenceClosurePanel } from './EvidenceClosurePanel'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost, DomainRendererVisibleContextHost } from '@sciforge/domain-sdk/host'
import { EvidenceDagPanel, evidenceDagPanelTarget, type EvidenceDagPanelProps } from './EvidenceDagPanel'
import { ResearchRecordPanel } from './ResearchRecordPanel'
import type { ResearchRecordScope } from '../research-record-contract'
import { createResearchRecordPresentationRegistry, researchRecordSurfaceScope, type ResearchRecordPresentation } from './research-record-presentation'

type Props = EvidenceDagPanelProps & {
  invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost
  visibleContext?: DomainRendererVisibleContextHost
  getPresentation?: (scope: ResearchRecordScope) => ResearchRecordPresentation
  returnContributionId?: string
  embedded?: boolean
  onExpand?: (scope: ResearchRecordScope) => void
}

export function EvidenceWorkspacePanel(props: Props): ReactElement {
  const raw = props.activation?.payload
  if (raw && typeof raw === 'object' && 'view' in raw && raw.view === 'closure') {
    const parsed = evidenceDagActivationPayloadSchema.safeParse(raw)
    if (!parsed.success || !parsed.data.closureDigest || !props.session.workspaceRoot) return <section className="p-4"><p role="alert">缺少有效闭包或工作区，未改为显示当前证据图。</p><button onClick={props.onCollapse}>收起</button></section>
    return <EvidenceClosurePanel key={`${props.session.workspaceRoot}:${parsed.data.closureDigest}`} invoker={props.invoker} workspaceRoot={props.session.workspaceRoot} closureDigest={parsed.data.closureDigest} active={props.active} onClose={props.onCollapse} />
  }
  return <EvidenceMainWorkspacePanel {...props} />
}

function EvidenceMainWorkspacePanel(props: Props): ReactElement {
  const target = evidenceDagPanelTarget(props.session, props.activation)
  const scope = useMemo(() => researchRecordSurfaceScope(props.activation?.payload, {
    runtimeId: target.runtimeId, threadId: target.threadId, workspaceRoot: target.workspaceRoot
  }), [props.activation?.payload, target.runtimeId, target.threadId, target.workspaceRoot])
  const [localRegistry] = useState(createResearchRecordPresentationRegistry)
  const presentation = (props.getPresentation ?? localRegistry)(scope ?? { runtimeId: '', threadId: '', workspaceRoot: '' })
  const { tab } = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const setTab = (tab: 'record' | 'graph') => presentation.update({ tab })
  useEffect(() => {
    if (target.nodeId || target.snapshotDigest || (props.activation?.payload && typeof props.activation.payload === 'object' && 'view' in props.activation.payload && props.activation.payload.view === 'graph')) presentation.update({ tab: 'graph' })
    else presentation.update({ tab: 'record' })
  }, [props.activation?.revision, target.nodeId, target.snapshotDigest, presentation])
  return <aside className={`flex h-full min-h-0 flex-col bg-ds-main ${props.className ?? ''}`}>
    <div className="flex shrink-0 items-center gap-2 border-b border-ds-border p-2 text-xs text-ds-ink" role={props.embedded ? 'toolbar' : 'tablist'} aria-label="研究证据">
      {props.embedded ? <button className="rounded-lg px-3 py-1.5 text-ds-muted hover:bg-ds-hover" onClick={() => setTab(tab === 'record' ? 'graph' : 'record')}>{tab === 'record' ? '查看证据图' : '返回阶段主线'}</button> : <>
        <button role="tab" aria-selected={tab === 'record'} className={`rounded-lg px-3 py-1.5 hover:bg-ds-hover ${tab === 'record' ? 'bg-ds-hover' : ''}`} onClick={() => setTab('record')}>研究记录</button>
        <button role="tab" aria-selected={tab === 'graph'} className={`rounded-lg px-3 py-1.5 hover:bg-ds-hover ${tab === 'graph' ? 'bg-ds-hover' : ''}`} onClick={() => setTab('graph')}>证据图</button>
      </>}
      <span className="ml-auto flex items-center gap-1">
        {tab === 'record' && scope && props.onExpand && <button className="rounded-lg px-2 py-1.5 text-ds-muted hover:bg-ds-hover" onClick={() => props.onExpand!(scope)}>全局打开</button>}
        <button className="rounded-lg px-2 py-1.5 text-ds-muted hover:bg-ds-hover" onClick={props.onCollapse}>收起</button>
      </span>
    </div>
    <div className="min-h-0 flex-1" role="tabpanel">
      {tab === 'graph' ? <EvidenceDagPanel {...props} /> : scope ? <ResearchRecordPanel returnContributionId={props.returnContributionId} key={`${scope.runtimeId}:${scope.threadId}:${scope.workspaceRoot}`} scope={scope} invoker={props.invoker} workbench={props.workbench} presentation={presentation} visibleContext={props.visibleContext} active={props.active} /> : <p className="p-4 text-xs text-ds-muted">选择带工作区的会话以查看研究记录。</p>}
    </div>
  </aside>
}
