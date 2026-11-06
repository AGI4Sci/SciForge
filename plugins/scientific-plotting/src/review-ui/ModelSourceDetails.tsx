import type { VisualDocument } from '../review/types.js'

export function ModelSourceDetails({ document }: { document: VisualDocument | null }) {
  const revisions = document?.revisions ?? []
  return <details className="shrink-0 border-b border-ds-border-muted min-w-0 px-3 py-2 text-sm leading-relaxed">
    <summary className="cursor-pointer">图片来源 · 请求与版本</summary>
    <div className="max-h-72 overflow-auto py-2">
      {!revisions.length ? <p>未绑定模型执行回执。历史图片不会自动重跑或推测 prompt。</p> : null}
      {revisions.map((revision) => <details key={revision.id} open={revision.id === document?.activeCandidateRevisionId || revision.id === document?.acceptedRevisionId}>
        <summary>{revision.status} · {revision.id}</summary>
        <p className="break-all">图片 SHA-256：{revision.artifactHash}</p>
        <p className="break-all">版本：{revision.versionRef?.versionId ?? '候选，尚未接纳'}</p>
        {revision.modelSource ? <>
          <p>模型：{revision.modelSource.request.model}</p>
          <p>实际发送的 prompt</p>
          <pre className="whitespace-pre-wrap break-words">{revision.modelSource.request.prompt}</pre>
          <p className="break-all">Prompt SHA-256：{revision.modelSource.request.promptHash}</p>
          <p>实际请求参数</p>
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(revision.modelSource.request.parameters, null, 2)}</pre>
          <p className="break-all">审核清单 SHA-256：{revision.modelSource.manifestDigest}</p>
          <p>输入参考（{revision.modelSource.request.references.length}）</p>
          {revision.modelSource.request.references.map((ref, index) => <p className="break-all" key={index}>{ref.role} · {ref.path} · {ref.byteLength} bytes · SHA-256 {ref.contentDigest}</p>)}
          {revision.modelSource.referenceVersions.map((ref) => <p className="break-all" key={ref.versionId}>输入版本：{ref.versionId} · {ref.accessPolicy.visibility} · {ref.accessPolicy.allowExport ? '允许导出' : '禁止导出'}</p>)}
          <p>已知缺口</p>
          <ul>{revision.modelSource.request.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
          <p>回执记录执行输入；不承诺复跑得到相同像素。</p>
        </> : <p>未绑定模型执行回执。没有可核验的 prompt 或参考输入；不会从图片或摘要推测。</p>}
      </details>)}
    </div>
  </details>
}
