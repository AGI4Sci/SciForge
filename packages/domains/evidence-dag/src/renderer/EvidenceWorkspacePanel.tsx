import { evidenceDagActivationPayloadSchema } from '../contract'
import { EvidenceClosurePanel } from './EvidenceClosurePanel'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost, DomainRendererVisibleContextHost } from '@sciforge/domain-sdk/host'
import { EvidenceDagPanel, evidenceDagPanelTarget, type EvidenceDagPanelProps } from './EvidenceDagPanel'
import { ResearchRecordPanel } from './ResearchRecordPanel'
import { researchRecordScopeSchema, type ResearchRecordScope } from '../research-record-contract'
import { createResearchRecordPresentationRegistry, researchRecordSurfaceScope, type ResearchRecordPresentation } from './research-record-presentation'

type Props = EvidenceDagPanelProps & {
  invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost
  visibleContext?: DomainRendererVisibleContextHost
  getPresentation?: (scope: ResearchRecordScope) => ResearchRecordPresentation
  returnContributionId?: string
  embedded?: boolean
  sourcePresentation?: 'right-panel' | 'global-overlay'
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
  const raw = props.activation?.payload
  // Record navigation has its own scope contract. Only this known route may use
  // the session fallback; malformed graph selectors must remain fail-closed.
  const recordRoute = Boolean(raw && typeof raw === 'object' && !Array.isArray(raw)
    && (('view' in raw && raw.view === 'record') || (!('view' in raw) && 'recordScope' in raw))
    && Object.keys(raw).every(key => key === 'view' || key === 'recordScope' || key === 'returnContributionId')
    && (!('returnContributionId' in raw) || typeof raw.returnContributionId === 'string' && raw.returnContributionId.trim().length > 0 && raw.returnContributionId.length <= 512)
    && (!('recordScope' in raw) || researchRecordScopeSchema.safeParse(raw.recordScope).success))
  const target = evidenceDagPanelTarget(props.session, recordRoute ? undefined : props.activation)
  const scope = useMemo(() => target.invalidSelection ? undefined : researchRecordSurfaceScope(raw, {
    runtimeId: target.runtimeId, threadId: target.threadId, workspaceRoot: target.workspaceRoot
  }), [raw, target.invalidSelection, target.runtimeId, target.threadId, target.workspaceRoot])
  const graphActivation = recordRoute && scope && props.activation ? { ...props.activation, payload: { view: 'graph', runtimeId: scope.runtimeId, threadId: scope.threadId } } : props.activation
  const graphSession = recordRoute && scope ? { ...props.session, runtimeId: scope.runtimeId, id: scope.threadId, workspaceRoot: scope.workspaceRoot } : props.session
  const [localRegistry] = useState(createResearchRecordPresentationRegistry)
  const presentation = (props.getPresentation ?? localRegistry)(scope ?? { runtimeId: '', threadId: '', workspaceRoot: '' })
  const { tab: savedTab } = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot)
  const controlled = props.embedded && raw && typeof raw === 'object' && 'view' in raw ? raw.view : undefined
  const unsupportedTarget = raw && typeof raw === 'object' && 'artifactVersionRef' in raw && !evidenceDagActivationPayloadSchema.safeParse(raw).success
  const tab = controlled === 'record' || controlled === 'graph' ? controlled : savedTab
  const setTab = (tab: 'record' | 'graph') => presentation.update({ tab })
  useEffect(() => {
    if (controlled === 'record' || controlled === 'graph') return
    if (target.nodeId || target.snapshotDigest || (props.activation?.payload && typeof props.activation.payload === 'object' && 'view' in props.activation.payload && props.activation.payload.view === 'graph')) presentation.update({ tab: 'graph' })
    else presentation.update({ tab: 'record' })
  }, [props.activation?.revision, target.nodeId, target.snapshotDigest, presentation, controlled])
  return <aside className={`flex h-full min-h-0 flex-col bg-ds-main ${props.className ?? ''}`}>
    {!props.embedded && <div className="flex shrink-0 items-center gap-2 border-b border-ds-border p-2 text-ds-sm text-ds-ink" role="tablist" aria-label="研究证据">
      <button role="tab" aria-selected={tab === 'record'} className={`rounded-lg px-3 py-1.5 hover:bg-ds-hover ${tab === 'record' ? 'bg-ds-hover' : ''}`} onClick={() => setTab('record')}>研究记录</button>
      <button role="tab" aria-selected={tab === 'graph'} className={`rounded-lg px-3 py-1.5 hover:bg-ds-hover ${tab === 'graph' ? 'bg-ds-hover' : ''}`} onClick={() => setTab('graph')}>证据图</button>
      <span className="ml-auto flex items-center gap-1">
        {tab === 'record' && scope && props.onExpand && <button className="rounded-lg px-2 py-1.5 text-ds-muted hover:bg-ds-hover" onClick={() => props.onExpand!(scope)}>全局打开</button>}
        <button className="rounded-lg px-2 py-1.5 text-ds-muted hover:bg-ds-hover" onClick={props.onCollapse}>收起</button>
      </span>
    </div>}
    <div className="flex min-h-0 flex-1 flex-col" role={props.embedded ? undefined : "tabpanel"}>
      {props.embedded && tab === 'record' && scope && props.onExpand && <div className="flex shrink-0 justify-end px-3"><button className="rounded px-2 py-1 text-ds-xs text-ds-muted hover:bg-ds-hover" onClick={() => props.onExpand!(scope)}>展开阅读</button></div>}
      <div className="min-h-0 flex-1">{tab === 'graph' ? unsupportedTarget ? <p role="status" className="p-4 text-ds-sm text-ds-muted">当前证据组件尚不能读取此材料的精确版本。</p> : <EvidenceDagPanel {...props} activation={graphActivation} session={graphSession} /> : scope ? <ResearchRecordPanel sourcePresentation={props.sourcePresentation} auditOverview={props.embedded} returnContributionId={props.returnContributionId} key={`${scope.runtimeId}:${scope.threadId}:${scope.workspaceRoot}`} scope={scope} invoker={props.invoker} workbench={props.workbench} presentation={presentation} visibleContext={props.visibleContext} active={props.active} /> : <p className="p-4 text-ds-sm text-ds-muted">选择带工作区的会话以查看研究记录。</p>}</div>
    </div>
  </aside>
}
