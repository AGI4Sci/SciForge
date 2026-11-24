import React, { useEffect, useState, type ReactElement } from 'react'
import { artifactVersionRefV1Schema, type ArtifactVersionRefV1 } from '@sciforge/domain-artifact-versions/contract'
import type { ResearchDossierCapabilityClient } from './research-dossier-capability-client'

const MAX_BYTES = 256 * 1024
const MAX_CHARACTERS = 8_000
/** Inert bounded display using the existing authorized owner read. No path reads or receipt writes. */
export function ExactArtifactText({ reference, client, workspaceRoot, active }: {
  reference: ArtifactVersionRefV1; client: Pick<ResearchDossierCapabilityClient, 'readArtifactVersion'>; workspaceRoot: string; active: boolean
}): ReactElement | null {
  const key = JSON.stringify([workspaceRoot, artifactVersionRefV1Schema.parse(reference)])
  const textual = /^(text\/|application\/(json|xml)$)/u.test(reference.mediaType ?? '')
  const [loaded, setLoaded] = useState<{ key: string; client: typeof client; text?: string; issue?: string }>()
  useEffect(() => {
    let current = true
    setLoaded(undefined)
    if (!active || !textual || reference.byteLength > MAX_BYTES) return () => { current = false }
    void client.readArtifactVersion(workspaceRoot, { versionId: reference.versionId, expectedRef: reference, maxBytes: MAX_BYTES }).then(async result => {
      if (!current) return
      if (!result.ok) throw new Error(result.issue.message)
      const value = result.value
      if (JSON.stringify(artifactVersionRefV1Schema.parse(value.ref)) !== JSON.stringify(artifactVersionRefV1Schema.parse(reference)) || value.artifact.artifactId !== reference.artifactId || value.version.versionId !== reference.versionId || value.version.artifactId !== reference.artifactId) throw new Error('材料响应与所选版本不一致。')
      if (value.dataBase64.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error('材料超过本页读取范围。')
      const bytes = Uint8Array.from(atob(value.dataBase64), char => char.charCodeAt(0))
      if (bytes.length !== reference.byteLength || bytes.length > MAX_BYTES) throw new Error('材料内容长度与所选版本不一致。')
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (digest !== reference.contentDigest) throw new Error('材料内容与所选版本不一致。')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (current) setLoaded({ key, client, text })
    }).catch((error: unknown) => { if (current) setLoaded({ key, client, issue: error instanceof Error ? error.message : String(error) }) })
    return () => { current = false }
  }, [key, client, active, textual, workspaceRoot, reference])
  if (!textual || !active) return null
  if (reference.byteLength > MAX_BYTES) return <p className="text-ds-sm text-ds-muted">这份材料较大，请在完整查看器中阅读。</p>
  const state = loaded?.key === key && loaded.client === client ? loaded : undefined
  return <section aria-label="材料正文" className="my-3" data-exact-artifact-text>
    {!state ? <p role="status" className="text-ds-sm text-ds-muted">正在读取材料内容…</p> : state.issue ? <><p role="alert" className="text-ds-sm text-ds-muted">暂时无法显示此版本的内容，请查看读取详情或重新读取。</p><details className="text-ds-sm text-ds-muted"><summary>读取详情</summary><p className="break-words">{state.issue}</p></details></> : <>
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{state.text?.slice(0, MAX_CHARACTERS) || '这份材料没有文本内容。'}</p>
      {(state.text?.length ?? 0) > MAX_CHARACTERS && <p className="mt-2 text-ds-sm text-ds-muted">当前显示内容节选，可打开完整材料继续阅读。</p>}
    </>}
  </section>
}
