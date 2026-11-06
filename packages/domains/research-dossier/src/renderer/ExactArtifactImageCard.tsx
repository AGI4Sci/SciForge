import { useTranslation } from 'react-i18next'
import { useEffect, useState, type ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client.js'

/** An observed image is navigable by its registered kind only; no filename/digest inference. */
export function ExactArtifactImageCard({ reference, client, workspaceRoot, sessionId, workbench }: Readonly<{
  reference: ArtifactVersionRefV1
  client: Pick<ResearchDossierCapabilityClient, 'readArtifactVersion'>
  workspaceRoot: string
  sessionId: string
  workbench?: DomainRendererHost['workbench']
}>): ReactElement {
  const { t } = useTranslation('common')
  const [state, setState] = useState<{ source?: string; kind?: string; issue?: string }>({})
  const [navigationIssue, setNavigationIssue] = useState('')
  useEffect(() => {
    let cancelled = false
    setState({})
    setNavigationIssue('')
    void client.readArtifactVersion(workspaceRoot, { versionId: reference.versionId, expectedRef: reference, maxBytes: 16 * 1024 * 1024 }).then((result) => {
      if (cancelled) return
      if (!result.ok) { setState({ issue: result.issue.message }); return }
      const kind = result.value.artifact.kind
      // Inert raster preview only. Other formats retain their existing exact artifact navigation.
      const raster = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(reference.mediaType ?? '')
      setState({ kind, ...(raster ? { source: `data:${reference.mediaType};base64,${result.value.dataBase64}` } : {}) })
    }).catch((error: unknown) => {
      if (!cancelled) setState({ issue: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [client, workspaceRoot, reference])
  const open = () => {
    if (!state.kind || !workbench?.openResource) return
    const resourceKind = workbench.canOpenResource?.(state.kind) ? state.kind : 'artifact-version'
    const opened = workbench.openResource({ sessionId, resource: {
      resourceKind, resourceId: reference.versionId,
      integrity: { algorithm: 'sha256', expectedDigest: `sha256:${reference.contentDigest}` }
    } })
    if (!opened) setNavigationIssue(t('researchDossierSourceUnavailable', { defaultValue: 'The exact resource viewer is unavailable.' }))
  }
  return <div className="mt-2 grid gap-2" data-exact-artifact-image={reference.versionId}>
    {state.source ? <button type="button" onClick={open} disabled={!workbench?.openResource} aria-label={t('researchDossierOpenImageSource', { defaultValue: 'Open exact image source' })}>
      <img className="max-h-48 max-w-full object-contain" src={state.source} alt="Exact artifact version" />
    </button> : null}
    <p className="break-all text-[10px]">{reference.versionId} · {reference.contentDigest}</p>
    {state.kind && !workbench?.canOpenResource?.(state.kind) ? <p className="text-[10px]">{t('researchDossierSourceUnbound', { defaultValue: 'No registered source viewer. This snapshot does not establish executed code.' })}</p> : null}
    {state.issue || navigationIssue ? <p role="alert">{state.issue || navigationIssue}</p> : null}
  </div>
}
