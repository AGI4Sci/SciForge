import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client.js'
import { LOCAL_MATERIAL_KIND } from './research-dossier-model.js'
const MATERIAL_ROLES = ['source', 'dataset', 'partition', 'model', 'result', 'review', 'other'] as const
const CANDIDATE_ID = 'local-material'

/** This is only a UI check. The owner performs real-path containment and reads actual bytes. */
export function localMaterialPath(value: string): string | null {
  const path = value.trim().replace(/\\/gu, '/')
  if (!path || path.length > 4_096 || path.startsWith('/') || path.includes(':') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  if (path.split('/').some(part => !part || part === '.' || part === '..')) return null
  return path
}

export function LocalMaterialRegistration({ client, workspaceRoot, runtimeId, sessionId, onRegistered, onOpen, canOpen }: Readonly<{
  client: ResearchDossierCapabilityClient
  workspaceRoot: string
  runtimeId?: string
  sessionId: string
  onRegistered: () => void
  onOpen: (ref: ArtifactVersionRefV1) => void
  canOpen: boolean
}>): ReactElement {
  const { t } = useTranslation('common')
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<typeof MATERIAL_ROLES[number]>('source')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [registered, setRegistered] = useState<{ ref: ArtifactVersionRefV1; path: string } | null>(null)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const inputClass = 'w-full rounded border border-ds-border bg-ds-main px-2 py-1.5 text-ds-sm text-ds-ink'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending.current) return
    const relativePath = localMaterialPath(path)
    if (!relativePath) { setIssue(t('researchDossierMaterialPathInvalid')); return }
    pending.current = true
    setBusy(true)
    setIssue('')
    setRegistered(null)
    try {
      const result = await client.observeArtifactVersion(workspaceRoot, {
        idempotencyKey: `research-dossier:material:${crypto.randomUUID()}`,
        candidateId: CANDIDATE_ID,
        expectedCurrentVersionId: null,
        kind: LOCAL_MATERIAL_KIND,
        label: label.trim() || relativePath.split('/').at(-1)!,
        path: relativePath,
        retention: 'snapshot',
        metadata: {
          materialRole: role,
          description: description.trim(),
          registrationOrigin: 'user-observed-local-file',
          registrationSessionId: sessionId,
          ...(runtimeId ? { registrationRuntimeId: runtimeId } : {}),
          provenanceStatus: 'observed-untracked'
        }
      })
      if (!mounted.current) return
      if (!result.ok) { setIssue(result.issue.message); return }
      const version = result.value.versions.find(item => item.candidateId === CANDIDATE_ID)
      if (!version) { setIssue(t('researchDossierMaterialReceiptMissing')); return }
      setRegistered({ ref: version.ref, path: relativePath })
      onRegistered()
    } catch (error) {
      if (mounted.current) setIssue(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <section className="mb-3 rounded-lg border border-ds-border bg-ds-main/40 p-3" data-local-material-registration>
    <details>
      <summary className="cursor-pointer text-ds-sm font-medium text-ds-ink">{t('researchDossierMaterialRegister')}</summary>
      <p className="my-2 text-ds-xs text-ds-muted">{t('researchDossierMaterialBoundary')}</p>
      <p className="mb-2 break-all text-ds-2xs text-ds-faint">{t('researchDossierMaterialWorkspace')}: {workspaceRoot}</p>
      <form onSubmit={event => void submit(event)} className="grid gap-2" aria-label={t('researchDossierMaterialRegister')}>
        <label className="grid gap-1 text-ds-xs text-ds-muted">{t('researchDossierMaterialPath')}
          <input className={inputClass} name="material-path" required maxLength={4_096} value={path} disabled={busy} onChange={event => setPath(event.target.value)} placeholder="data/results.csv" />
        </label>
        <label className="grid gap-1 text-ds-xs text-ds-muted">{t('researchDossierMaterialRole')}
          <select className={inputClass} name="material-role" value={role} disabled={busy} onChange={event => setRole(event.target.value as typeof role)}>
            {MATERIAL_ROLES.map(value => <option key={value} value={value}>{t(`researchDossierMaterialRole_${value}`)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-ds-xs text-ds-muted">{t('researchDossierMaterialLabel')}
          <input className={inputClass} name="material-label" maxLength={512} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} />
        </label>
        <label className="grid gap-1 text-ds-xs text-ds-muted">{t('researchDossierMaterialDescription')}
          <textarea className={inputClass} name="material-description" maxLength={4_000} rows={2} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} />
        </label>
        <button type="submit" disabled={busy} className="justify-self-start rounded border border-ds-border px-3 py-1.5 text-ds-xs text-ds-ink hover:bg-ds-hover disabled:opacity-40">{t(busy ? 'researchDossierMaterialRegistering' : 'researchDossierMaterialSave')}</button>
      </form>
    </details>
    {issue ? <p role="alert" className="mt-2 break-words text-ds-xs text-red-600">{issue}</p> : null}
    {registered ? <div className="mt-3 grid gap-1 break-all text-ds-xs text-ds-muted" role="status" data-registered-material-version={registered.ref.versionId}>
      <p className="font-medium text-ds-ink">{t('researchDossierMaterialSaved')}</p>
      <p>{registered.path}</p>
      <p>{t('researchDossierSelectedVersion')}: {registered.ref.versionId}</p>
      <p>SHA-256: {registered.ref.contentDigest}</p>
      <p>{registered.ref.byteLength} bytes</p>
      <p>{t(registered.ref.retention === 'snapshot' && registered.ref.availability === 'available' ? 'researchDossierMaterialPreviewReady' : 'researchDossierMaterialPreviewUnavailable')}</p>
      <p>{t('researchDossierMaterialBoundary')}</p>
      <button type="button" disabled={!canOpen} onClick={() => onOpen(registered.ref)} className="mt-1 justify-self-start rounded border border-ds-border px-2 py-1 hover:bg-ds-hover disabled:opacity-40">{t('researchDossierMaterialOpen')}</button>
      {!canOpen ? <p>{t('researchDossierMaterialNavigationUnavailable')}</p> : null}
    </div> : null}
  </section>
}
