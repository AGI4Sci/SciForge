import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import { ARTIFACT_VERSION_READ_CONTRACT } from '@sciforge/domain-artifact-versions/contract'
import type { ResearchRecordScope } from '../research-record-contract'

import { recordArtifactReferences } from '../research-record-artifact-refs'

export function recordMediaReferences(raw: unknown) { const value = recordArtifactReferences(raw); return { ...value, refs: value.refs.filter(ref => ref.mediaType?.startsWith('image/')) } }

const rasterTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export function ResearchRecordMedia({ raw, scope, invoker, workbench, onSource, sourceStatus, rawOrigin, retainedSource }: {
  rawOrigin?: 'retained' | 'live'; retainedSource?: 'retained' | 'not-retained' | 'corrupt' | 'denied'; sourceStatus?: 'current' | 'changed' | 'unavailable'; raw: unknown; scope: ResearchRecordScope; invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost; onSource?: () => void
}): ReactElement {
  const { refs, limited } = useMemo(() => recordMediaReferences(raw), [raw])
  const [index, setIndex] = useState(0)
  const ref = refs[Math.min(index, Math.max(0, refs.length - 1))]
  const [preview, setPreview] = useState<{ key: string; uri?: string; kind?: string; error?: string }>()
  const [issue, setIssue] = useState('')
  const key = ref ? `${scope.workspaceRoot}:${ref.artifactId}:${ref.versionId}:${ref.contentDigest}` : ''
  useEffect(() => {
    let active = true
    setPreview(undefined); setIssue('')
    if (ref) void invoker.invoke(ARTIFACT_VERSION_READ_CONTRACT, { versionId: ref.versionId, expectedRef: ref, maxBytes: 8 * 1024 * 1024 }, { workspaceId: scope.workspaceRoot })
      .then(result => {
        if (!active) return
        if (!result.ok) { setPreview({ key, error: result.issue.message }); return }
        if (result.value.ref.artifactId !== ref.artifactId || result.value.ref.byteLength !== ref.byteLength || result.value.ref.versionId !== ref.versionId || result.value.ref.contentDigest !== ref.contentDigest || result.value.ref.mediaType !== ref.mediaType) { setPreview({ key, error: '返回版本与来源引用不一致，未展示图片。' }); return }
        setPreview({ key, kind: result.value.artifact.kind, ...(rasterTypes.has(ref.mediaType ?? '') ? { uri: `data:${ref.mediaType};base64,${result.value.dataBase64}` } : {}) })
      }).catch(error => { if (active) setPreview({ key, error: error instanceof Error ? error.message : String(error) }) })
    return () => { active = false }
  }, [invoker, ref, key, scope.workspaceRoot])
  const current = preview?.key === key ? preview : undefined
  const open = () => {
    if (!ref || !current?.kind || !workbench?.openResource) return
    const kind = workbench.canOpenResource?.(current.kind) ? current.kind : 'artifact-version'
    if (!workbench.openResource({ sessionId: scope.threadId, resource: { resourceKind: kind, resourceId: ref.versionId, integrity: { algorithm: 'sha256', expectedDigest: `sha256:${ref.contentDigest}` } } })) setIssue('精确版本查看器当前不可用。')
  }
  return <section className="space-y-3 record-text" aria-label="图像版本">
    {rawOrigin === 'retained' && retainedSource === 'retained' && <p className="record-caption record-check-text">历史保留观察中的精确版本引用；当前来源状态：{sourceStatus ?? 'unknown'}。不代表当前材料。</p>}
    {rawOrigin !== 'retained' && sourceStatus === 'changed' && <p className="record-caption record-check-text">来源已变化；这里展示当前返回的版本引用，不代表当时旧图。</p>}
    {refs.length ? <>
      <nav className="flex flex-wrap gap-2" aria-label="来源中的图像版本">{refs.map((item, i) => <button key={`${item.artifactId}:${item.versionId}:${item.contentDigest}`} type="button" className="rounded border border-ds-border px-2 py-1 record-caption" aria-pressed={i === Math.min(index, refs.length - 1)} onClick={() => setIndex(i)}>图 {i + 1}</button>)}</nav>
      {current?.uri && <button type="button" className="record-image-preview" aria-label="打开精确图像版本" disabled={!workbench?.openResource} onClick={open}><img src={current.uri} alt={`来源图像 ${Math.min(index, refs.length - 1) + 1}`} /></button>}
      {!current && <p className="record-caption text-ds-muted">正在核对版本…</p>}
      {current?.kind && <button type="button" className="rounded border border-ds-border px-2 py-1 record-caption" disabled={!workbench?.openResource} onClick={open}>打开精确版本</button>}
      {current?.kind && !current.uri && <p className="record-caption text-ds-muted">此格式不内嵌预览，请打开版本查看。</p>}
      {ref && <details className="record-caption text-ds-muted"><summary>版本与校验信息</summary><p className="break-all">{ref.versionId}</p><p className="break-all">{ref.contentDigest}</p></details>}
      {(current?.error || issue) && <p role="alert" className="record-check-text">{current?.error || issue}</p>}
    </> : <p className="text-ds-muted">当前来源未提供可核对的图像版本引用。图片可能仍在原始会话中；不会按文件名或外链猜测绑定。</p>}
    {limited && <p className="record-caption record-check-text">当前仅检查有界来源片段，更多图像请回读原始过程。</p>}
    {onSource && <button type="button" className="rounded border border-ds-border px-2 py-1 record-caption" onClick={onSource}>回到原始过程</button>}
  </section>
}
