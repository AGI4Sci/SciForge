import React, { Suspense, useCallback, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DomainRendererContribution, DomainWorkbenchRightPanelActivation } from '@sciforge/domain-sdk/host'
import { domainRendererResearchWorkspaceContractSchema, isDomainRendererWorkbenchSurfaceValue, type DomainRendererResearchWorkspaceValue } from '@sciforge/domain-sdk/renderer'
import { artifactVersionRefV1Schema } from '@sciforge/domain-sdk/research-audit'
import { createResearchDossierActivation, researchDossierActivationPayloadV1Schema } from '../contract.js'
import { RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION } from '../definition.js'
import { ResearchDossierPanel, type ResearchDossierPanelProps, type ResearchDossierResolvedArtifact } from './ResearchDossierPanel.js'

type Props = ResearchDossierPanelProps & { onReturnToSide?: () => Promise<void>; focused: boolean; researchViews: readonly DomainRendererContribution[] }
type Tab = 'overview' | 'graph' | 'versions'
type Location = { activation?: DomainWorkbenchRightPanelActivation; tab: Tab; graphTarget?: Record<string, unknown> }
const tabs = [['overview', '概览'], ['graph', '证据图'], ['versions', '版本']] as const

export function ResearchWorkspacePanel(props: Props): ReactElement {
  return <Workspace key={JSON.stringify([props.session.runtimeId, props.session.id, props.session.workspaceRoot])} {...props} />
}

function initialLocation(activation?: DomainWorkbenchRightPanelActivation): Location {
  const payload = activation?.payload
  const parsed = researchDossierActivationPayloadV1Schema.safeParse(payload)
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'view' in payload && payload.view === 'graph' && 'artifactVersionRef' in payload) {
    const reference = artifactVersionRefV1Schema.safeParse(payload.artifactVersionRef)
    if (reference.success) return { tab: 'graph', graphTarget: payload, activation: createResearchDossierActivation({ kind: 'artifact-version', versionId: reference.data.versionId }, { expectedDigest: `sha256:${reference.data.contentDigest}`, revision: activation?.revision }) }
  }
  return { activation, tab: parsed.success ? parsed.data.page === 'versions' ? 'versions' : 'overview'
    : payload && typeof payload === 'object' && 'view' in payload && payload.view === 'graph' ? 'graph' : 'overview' }
}

function Workspace(props: Props): ReactElement {
  const [navigation, setNavigation] = useState(() => ({ external: props.activation, current: initialLocation(props.activation), back: [] as Location[] }))
  // Producer revisions can repeat. A fresh activation payload is a new navigation;
  // ordinary rerenders must leave the user's chosen historical version untouched.
  if (navigation.external?.payload !== props.activation?.payload || navigation.external?.revision !== props.activation?.revision) setNavigation({ external: props.activation, current: initialLocation(props.activation), back: [] })
  const { current, back } = navigation
  const [returnBusy, setReturnBusy] = useState(false)
  const [returnError, setReturnError] = useState('')
  const returnToSide = async () => { if (!props.onReturnToSide || returnBusy) return; setReturnBusy(true); setReturnError(''); try { await props.onReturnToSide() } catch (cause) {setReturnError(cause instanceof Error ? cause.message : String(cause))} finally {setReturnBusy(false)} }
  const [materialsVisited, setMaterialsVisited] = useState(false)
  const [graphVisited, setGraphVisited] = useState(current.tab === 'graph')
  const parsed = researchDossierActivationPayloadV1Schema.safeParse(current.activation?.payload)
  const raw = current.activation?.payload
  const recordScope = raw && typeof raw === 'object' && 'recordScope' in raw ? raw.recordScope : undefined
  const evidenceOnly = raw && typeof raw === 'object' && 'view' in raw && (raw.view === 'graph' || raw.view === 'record')
  const exact = parsed.success
  const invalid = Boolean(current.activation && !exact && !recordScope && !evidenceOnly)
  const dossierActivation = exact || invalid ? current.activation : undefined
  const [resolved, setResolved] = useState<ResearchDossierResolvedArtifact & { activation?: DomainWorkbenchRightPanelActivation }>()
  const material = resolved?.activation === dossierActivation ? resolved : undefined
  const onResolvedArtifact = useCallback((value: ResearchDossierResolvedArtifact | null) => {
    if (!value) { setResolved(undefined); return }
    const target = researchDossierActivationPayloadV1Schema.safeParse(dossierActivation?.payload)
    if (!target.success || target.data.target.kind !== 'artifact-version' || target.data.target.versionId !== value.reference.versionId || (target.data.expectedDigest && target.data.expectedDigest !== `sha256:${value.reference.contentDigest}`)) return
    setResolved(previous => previous && previous.activation === dossierActivation && JSON.stringify(previous.reference) === JSON.stringify(value.reference) && previous.isCurrent === value.isCurrent && previous.title === value.title && JSON.stringify(previous.evidenceSession) === JSON.stringify(value.evidenceSession) ? previous : { activation: dossierActivation, ...value })
  }, [dossierActivation])
  const panelRef = useRef<HTMLElement>(null)
  const ids = useId()
  const navigate = useCallback((activation?: DomainWorkbenchRightPanelActivation) => {
    setNavigation(previous => ({ ...previous, current: initialLocation(activation), back: [...previous.back, previous.current] }))
  }, [])
  const select = (tab: Tab) => {
    if (tab === 'graph') setGraphVisited(true)
    if (tab === 'versions') setMaterialsVisited(true)
    setNavigation(previous => ({ ...previous, current: { ...previous.current, tab } }))
  }
  const goBack = () => {
    setNavigation(previous => ({ ...previous, current: previous.back.at(-1) ?? { tab: 'overview' }, back: previous.back.slice(0, -1) }))
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus())
  }
  const view = useMemo(() => props.researchViews.flatMap(contribution => {
    const contract = domainRendererResearchWorkspaceContractSchema.safeParse(contribution.contract)
    return contract.success && isDomainRendererWorkbenchSurfaceValue(contribution.value)
      ? [{ id: contribution.id, order: contract.data.order, value: contribution.value as DomainRendererResearchWorkspaceValue<ReactElement> }] : []
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0], [props.researchViews])
  const graphAllowed = !invalid && (!exact || Boolean(material))
  const graphPayload = useMemo(() => ({
    ...(evidenceOnly && raw && typeof raw === 'object' ? raw : {}),
    view: 'graph',
    ...(recordScope && typeof recordScope === 'object' && 'runtimeId' in recordScope && 'threadId' in recordScope
      ? { runtimeId: recordScope.runtimeId, threadId: recordScope.threadId }
      : !evidenceOnly && props.session.runtimeId ? { runtimeId: props.session.runtimeId, threadId: props.session.id } : {}),
    ...(material ? { ...material.evidenceSession, artifactVersionRef: material.reference } : {}),
    ...current.graphTarget
  }), [raw, evidenceOnly, recordScope, material, props.session.runtimeId, props.session.id, current.graphTarget])
  const renderEvidence = (tab: 'overview' | 'graph') => view?.value.render({
    session: props.session, active: props.active && current.tab === tab, focused: props.focused,
    className: 'h-full', ...(props.surfaceId ? {surfaceId:props.surfaceId} : {}), sourcePresentation: props.sourcePresentation, onCollapse: props.onCollapse,
    activation: { revision: current.activation?.revision ?? 1, payload: tab === 'graph' ? graphPayload : { ...(recordScope ? { recordScope } : {}), view: 'record' } },
    returnContributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  })
  return <section ref={panelRef} className={`flex h-full min-h-0 min-w-0 flex-col bg-ds-main text-ds-ink ${props.className ?? ''}`} data-research-workspace="true"><style>{`[data-research-workspace] {font-size:14px} [data-research-workspace] > header h2 {font-size:16px;line-height:1.6} [data-research-workspace] [data-domain-panel="research-dossier"] .text-ds-2xs {font-size:13px;line-height:1.65}`}</style>
    <header className="shrink-0 border-b border-ds-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-ds-sm">
        {(exact || invalid || back.length > 0) && <button className="shrink-0 rounded px-2 py-1 hover:bg-ds-hover" onClick={goBack}>返回</button>}
        <div className="min-w-0 flex-1"><h2 className="break-words font-medium">{material?.title ?? (exact ? parsed.data.target.kind === 'compute-run' ? '计算结果' : '研究材料' : invalid ? '材料暂不可用' : '科研证据链')}</h2>
          {material && <p className="text-ds-xs text-ds-muted">{material.isCurrent ? '当前材料' : '历史材料'}</p>}</div>
        {props.onReturnToSide && <button className="shrink-0 rounded px-2 py-1 hover:bg-ds-hover disabled:opacity-50" disabled={returnBusy} onClick={() => void returnToSide()}>返回侧面</button>}
        <button className="shrink-0 rounded px-2 py-1 hover:bg-ds-hover" onClick={props.onCollapse}>{props.sourcePresentation === 'global-overlay' ? '关闭' : '收起'}</button>
      </div>
      {returnError && <p role="alert" className="text-ds-sm">{returnError}</p>}
      <nav className="mt-2 flex gap-1 text-ds-sm" role="tablist" aria-label="审计工作区">
        {tabs.map(([tab, label], index) => <button key={tab} id={`${ids}-${tab}`} role="tab" type="button" aria-controls={`${ids}-panel`} aria-selected={current.tab === tab} tabIndex={current.tab === tab ? 0 : -1}
          className="min-w-0 flex-1 rounded px-2 py-1.5 hover:bg-ds-hover aria-[selected=true]:bg-ds-hover" onClick={() => select(tab)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
            if (next === undefined) return
            event.preventDefault(); select(tabs[next][0]); panelRef.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
          }}>{label}</button>)}
      </nav>
    </header>
    <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-${current.tab}`} className="min-h-0 min-w-0 flex-1">
      <Suspense fallback={<p className="p-4 text-ds-sm text-ds-muted">正在读取研究材料…</p>}>
        {!exact && !invalid && <div hidden={current.tab !== 'overview'} style={{ height: '100%', display: current.tab === 'overview' ? 'flex' : 'none', flexDirection: 'column' }}><button className="mx-3 mt-2 rounded border border-ds-border px-3 py-1 text-ds-sm" onClick={() => select('versions')}>查看研究材料</button><div className="min-h-0 flex-1">{view ? renderEvidence('overview') : <p className="p-4 text-ds-sm text-ds-muted">研究摘要暂不可用，请从版本页查看材料。</p>}</div></div>}
        <div hidden={current.tab === 'graph' || (!exact && !invalid && current.tab === 'overview')} style={{ height: '100%', display: current.tab === 'graph' || (!exact && !invalid && current.tab === 'overview') ? 'none' : 'flex', flexDirection: 'column' }}>
          {!exact && !invalid && <p className="px-3 pt-3 text-ds-sm text-ds-muted">选择一份材料，查看它的变化与依据。</p>}
          {(exact || invalid || materialsVisited || current.tab === 'versions') && <ResearchDossierPanel {...props} activation={dossierActivation} className="min-h-0 flex-1" embedded controlledPage={current.tab === 'versions' ? 'versions' : 'overview'} onNavigate={navigate} onResolvedArtifact={onResolvedArtifact} active={props.active && current.tab !== 'graph' && (Boolean(exact || invalid) || current.tab === 'versions')} />}
        </div>
        {(graphVisited || current.tab === 'graph') && <div hidden={current.tab !== 'graph'} className="h-full min-h-0">{graphAllowed ? view ? renderEvidence('graph') : <p className="p-4 text-ds-sm text-ds-muted">证据图当前不可用。</p> : <p role="status" className="p-4 text-ds-sm text-ds-muted">尚未取得此材料的精确引用，无法读取对应证据图。</p>}</div>}
      </Suspense>
    </div>
  </section>
}
