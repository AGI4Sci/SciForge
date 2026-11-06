import { EvidenceRerunReview, EvidenceReviewCoverage } from '@sciforge/domain-evidence-dag/renderer'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { artifactVersionRefV1Schema, type ArtifactVersionRefV1, type ResearchAuditEvidenceAuditQueryOutput } from '@sciforge/domain-sdk/research-audit'
import type { DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client.js'

/** Exact-version formal Evidence read with the shared explicit governed rerun UI. */
export function ResearchDossierEvidenceReview({ client, reference, workspaceRoot, sessionId, runtimeId, workbench, active = true }: {
  active?: boolean
  client: ResearchDossierCapabilityClient
  reference: ArtifactVersionRefV1
  workspaceRoot: string
  sessionId: string
  runtimeId?: string
  workbench?: DomainRendererWorkbenchHost
}): ReactElement {
  const { t } = useTranslation('common')
  const [result, setResult] = useState<ResearchAuditEvidenceAuditQueryOutput | null>(null)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [page, setPage] = useState(0)
  const identity = JSON.stringify([workspaceRoot, runtimeId, sessionId, artifactVersionRefV1Schema.parse(reference)])
  const scope = useMemo(() => ({}), [client, identity, active])
  const readGeneration = useRef(0)
  const currentScope = useRef(scope)
  currentScope.current = scope
  const [loadedScope, setLoadedScope] = useState<object>()
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => { const changed = () => { currentScope.current = {}; readGeneration.current++; setVisible(!document.hidden); setResult(null); setIssue(''); setBusy(false) }; document.addEventListener('visibilitychange', changed); return () => document.removeEventListener('visibilitychange', changed) }, [])
  useEffect(() => { readGeneration.current++; setResult(null); setIssue(''); setBusy(false) }, [scope])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const read = async () => {
    if (busy || !active || !visible) return
    const generation = ++readGeneration.current
    const requestedScope = scope
    const current = () => mounted.current && generation === readGeneration.current && currentScope.current === requestedScope && !document.hidden
    setLoadedScope(scope)
    setBusy(true)
    setIssue('')
    setResult(null)
    try {
      const value = await client.queryEvidenceAudit(workspaceRoot, reference)
      if (!current()) return
      const subject = value.subject
      if (!('artifactVersionRef' in subject) || JSON.stringify(artifactVersionRefV1Schema.parse(subject.artifactVersionRef)) !== JSON.stringify(artifactVersionRefV1Schema.parse(reference))) {
        throw new Error(t('researchDossierEvidenceIdentityMismatch'))
      }
      setResult(value)
      setPage(0)
    } catch (error) {
      if (current()) setIssue(error instanceof Error ? error.message : String(error))
    } finally {
      if (current()) setBusy(false)
    }
  }
  const axes = { independence: 'researchDossierSourceIndependence', controls: 'researchDossierControls', 'negative-results': 'researchDossierNegativeResults', reproduction: 'researchDossierReproduction', scope: 'researchDossierScientificScope' }
  const canNavigate = Boolean(workbench?.openResource && workbench.canOpenResource?.('evidence-closure'))
  return <section className="min-w-0 rounded-lg border border-ds-border p-3 text-xs" data-dossier-evidence-review>
    <h3 className="font-semibold">{t('researchDossierFormalEvidence')}</h3>
    <p className="my-2 text-ds-muted">{t('researchDossierBrowseNotReview')}</p>
    <button type="button" className="rounded border border-ds-border px-2 py-1.5 disabled:opacity-50" disabled={busy || !active || !visible} aria-busy={busy} onClick={() => void read()}>
      {t(busy ? 'researchDossierEvidenceReading' : 'researchDossierReadEvidence')}
    </button>
    {active && visible && loadedScope === scope && issue ? <p role="alert" className="mt-2 break-words text-ds-muted">{issue}</p> : null}
    {active && visible && loadedScope === scope && result ? <div className="mt-2 grid min-w-0 gap-2" role="status">
      <p>{t('researchDossierEvidenceFreshness')}: {result.freshness} · {t('researchDossierQueryCoverage')}: {t(result.completeness.complete ? 'researchDossierEvidenceQueryComplete' : 'researchDossierHistoryPartial')}</p>
      {result.completeness.gapCodes.length ? <p className="break-words">{result.completeness.gapCodes.join(' · ')}</p> : null}
      <EvidenceReviewCoverage review={result.scientificReview} />
      {client.capabilityInvoker && <EvidenceRerunReview result={result} reference={reference} workspaceRoot={workspaceRoot} invoker={client.capabilityInvoker} onReview={() => void read()} />}
      {result.scientificReview ? <section aria-label={t('researchDossierScientificConditions')} className="grid gap-2">
        <p>{t('researchDossierMaterialReviewBoundary')}</p>
        <p>{t('researchDossierRecordedLinksOnly')}{result.scientificReview.bounded ? t('researchDossierReviewBounded') : ''}</p>

      </section> : <p>{t('researchDossierConditionsUnavailable')}</p>}
      {!result.records.length ? <p>{t('researchDossierNoEvidenceReviews')}</p> : null}
      <ol className="grid min-w-0 gap-2">
        {result.records.slice(page * 10, (page + 1) * 10).map(record => <li key={record.recordDigest} className="min-w-0 break-words rounded border border-ds-border p-2">
          {(() => { const impact = result.scientificReview?.impacts.find(value => value.recordDigest === record.recordDigest); return <div data-scientific-impact={impact?.status ?? 'unknown'}>
            <p>{impact?.status === 'requires-review' ? t('researchDossierMaterialRequiresReview') : impact?.status === 'no-recorded-impact' ? t('researchDossierNoRecordedImpact') : t('researchDossierImpactUnknown')}</p>
            {impact?.affectedIds.length ? <p>{t('researchDossierAffectedSubjects')}：{impact.affected.map(value => value.title + ' (' + value.id + ')').join(' · ')}</p> : null}
            {impact?.changes.map((change, index) => <p key={index}>{change.reason} · {change.sourceId} · {change.digest}</p>)}
          </div> })()}
          <section aria-label={t('researchDossierScientificConditions')}>
            {result.scientificReview?.conditions.map(condition => {
              const observations = condition.observations.filter(item => item.recordDigest === record.recordDigest && item.closureDigest === record.closureDigest)
              return <details key={condition.axis}><summary>{t(axes[condition.axis])} · {t(observations.length ? 'researchDossierConditionRecorded' : 'researchDossierConditionUnknown')}</summary>{observations.map((observation, index) => <div key={index} className="break-words border-l border-ds-border pl-2"><p>{observation.targetId} · {observation.field} · {observation.text}</p><p className="font-mono">{observation.digest}</p></div>)}</details>
            })}
          </section>
          <p>{record.recordType} · {record.createdAt}</p>
          <p>{t('researchDossierReviewer')}: {record.reviewerIdentity ?? t('researchDossierEmpty')}</p>
          <details><summary>{t('researchDossierReferenceDetails')}</summary>
            <p>{record.recordId}</p><p>{record.recordDigest}</p><p>{record.closureDigest}</p>
            <p>{record.threadId}</p>
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(record.payload, null, 2)}</pre>
          </details>
          <button type="button" className="mt-1 underline disabled:opacity-50" disabled={!canNavigate} onClick={() => {
            try {
              if (!workbench?.openResource?.({ sessionId, resource: {
                resourceKind: 'evidence-closure', resourceId: record.closureDigest,
                integrity: { algorithm: 'sha256', expectedDigest: record.closureDigest }
              } })) setIssue(t('researchDossierEvidenceNavigationUnavailable'))
            } catch (error) { setIssue(error instanceof Error ? error.message : String(error)) }
          }}>{t('researchDossierOpenEvidenceClosure')}</button>
          {record.threadId !== `${runtimeId}:${sessionId}` ? <p>{t('researchDossierEvidenceOtherSession')}</p> : null}
        </li>)}
      </ol>
      {result.records.length > 10 ? <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!page} onClick={() => setPage(page - 1)}>{t('researchDossierPreviousPage')}</button>
        <span>{page + 1} / {Math.ceil(result.records.length / 10)}</span>
        <button type="button" disabled={(page + 1) * 10 >= result.records.length} onClick={() => setPage(page + 1)}>{t('researchDossierNextPage')}</button>
      </div> : null}
      {result.records.length > 0 && !canNavigate ? <p>{t('researchDossierEvidenceNavigationUnavailable')}</p> : null}
    </div> : null}
  </section>
}
