import { ModelSourceDetails } from './ModelSourceDetails.js'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { VisualDocument } from '../review/types.js'
import type { VisualReviewCapabilityClient } from './capability-client.js'

/** Model and human-decision lineage shares the same document capabilities as review. */
export function VisualReviewVersionHistory({ client, workspaceRoot, documentId, active }: {
  client: VisualReviewCapabilityClient
  workspaceRoot: string
  documentId: string
  active: boolean
}): ReactElement | null {
  const { t } = useTranslation()
  const [document, setDocument] = useState<VisualDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    setDocument(null)
    setError(null)
    if (!active || !workspaceRoot || !documentId) return undefined
    void client.readDocument({ documentId }, workspaceRoot).then((result) => {
      if (current) { setDocument(result.document); setError(null) }
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [active, client, documentId, workspaceRoot])
  if (!documentId) return null
  return <section className="scientific-plotting-review-history" aria-label={t('scientificPlottingReviewVersions')}>
    <h3>{t('scientificPlottingReviewVersions')}</h3>
    {error ? <p role="alert">{error}</p> : null}
    {document?.artifact ? <p>{t('scientificPlottingOutputHash')}: <code>{document.artifact.sourceHash}</code></p> : null}
    {document?.revisions.length === 0 ? <p>{t('scientificPlottingReviewNoVersions')}</p> : null}
    {document ? <ModelSourceDetails document={document} /> : null}
    {document?.revisions.map((revision) => <details key={revision.id}>
      <summary>{revision.id} · {t(`scientificPlottingRevision_${revision.status}`)}</summary>
      <p>{revision.summary}</p>
      <dl>
        <dt>{t('scientificPlottingOutputHash')}</dt><dd><code>{revision.artifactHash}</code></dd>
        <dt>{t('scientificPlottingSource')}</dt><dd><code>{revision.basedOnHash}</code></dd>
        <dt>{t('scientificPlottingReview')}</dt><dd>{revision.reviewEvidence.semantic.summary}</dd>
        <dt>{t('scientificPlottingVersion')}</dt><dd>{revision.versionRef?.versionId ?? '—'}</dd>
      </dl>
    </details>)}
  </section>
}
