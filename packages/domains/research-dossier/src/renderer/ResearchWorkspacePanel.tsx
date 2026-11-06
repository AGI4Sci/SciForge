import React, { Suspense, useMemo, useState, type ReactElement } from 'react'
import type { DomainRendererContribution } from '@sciforge/domain-sdk/host'
import { domainRendererResearchWorkspaceContractSchema, isDomainRendererWorkbenchSurfaceValue, type DomainRendererResearchWorkspaceValue } from '@sciforge/domain-sdk/renderer'
import { RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION } from '../definition.js'
import { ResearchDossierPanel, type ResearchDossierPanelProps } from './ResearchDossierPanel.js'

export function ResearchWorkspacePanel(props: ResearchDossierPanelProps & {
  focused: boolean; researchViews: readonly DomainRendererContribution[]
}): ReactElement {
  const payload = props.activation?.payload
  const revision = props.activation?.revision
  // A new navigation can repeat both its target and producer revision. Preserve
  // manual tabs on ordinary rerenders, but honor the next payload instance.
  const [selection, setSelection] = useState<{ payload?: unknown; revision?: number; page: 'record' | 'dossier' }>({ page: 'record' })
  const recordReturn = Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && 'recordScope' in payload)
  // Unknown dossier activations still reach its strict parser and fail closed.
  const exact = Boolean(props.activation && !recordReturn)
  const page = selection.payload === payload && selection.revision === revision ? selection.page : exact ? 'dossier' : 'record'
  const view = useMemo(() => props.researchViews.flatMap(contribution => {
    const contract = domainRendererResearchWorkspaceContractSchema.safeParse(contribution.contract)
    return contract.success && isDomainRendererWorkbenchSurfaceValue(contribution.value)
      ? [{ id: contribution.id, order: contract.data.order, value: contribution.value as DomainRendererResearchWorkspaceValue<ReactElement> }] : []
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0], [props.researchViews])
  const select = (page: 'record' | 'dossier') => setSelection({ payload, revision, page })
  return <section className={`flex h-full min-h-0 flex-col bg-ds-main text-ds-ink ${props.className ?? ''}`} data-research-workspace="true">
    <nav className="flex shrink-0 gap-2 border-b border-ds-border px-3 py-2 text-xs" aria-label="科研">
      <button className="rounded px-2 py-1 hover:bg-ds-hover aria-[selected=true]:bg-ds-hover" aria-selected={page === 'record'} onClick={() => select('record')}>阶段主线</button>
      <button className="rounded px-2 py-1 hover:bg-ds-hover aria-[selected=true]:bg-ds-hover" aria-selected={page === 'dossier'} onClick={() => select('dossier')}>档案与版本</button>
    </nav>
    <div className="min-h-0 flex-1"><Suspense fallback={<p className="p-4 text-xs text-ds-muted">正在读取科研记录…</p>}>
      {page === 'record' ? view ? view.value.render({
        session: props.session, active: props.active, focused: props.focused, className: 'h-full',
        surfaceId: props.surfaceId, onCollapse: props.onCollapse,
        ...(!exact && props.activation ? { activation: props.activation } : {}),
        returnContributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
      }) : <div className="p-4 text-xs text-ds-muted">阶段视图当前不可用。<button className="ml-2 underline" onClick={() => select('dossier')}>查看档案与版本</button></div>
        : <ResearchDossierPanel {...props} className="h-full" {...(!exact ? { activation: undefined } : {})} />}
    </Suspense></div>
  </section>
}
