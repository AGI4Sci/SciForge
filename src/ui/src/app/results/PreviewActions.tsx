import type { PreviewDescriptor, SciForgeReference } from '../../domain';

export function PreviewDescriptorActions({ descriptor, reference }: { descriptor: PreviewDescriptor; reference: SciForgeReference }) {
  return (
    <>
      <div className="source-list">
        <code>{descriptor.ref}</code>
        {descriptor.mimeType ? <code>{descriptor.mimeType}</code> : null}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(reference, null, 2))}>复制引用</button>
      </div>
      {descriptor.derivatives?.length ? (
        <details className="report-read-warning">
          <summary>按需派生物</summary>
          <div className="source-list">
            {descriptor.derivatives.map((derivative) => (
              <code key={`${derivative.kind}-${derivative.ref}`}>{derivative.kind}: {derivative.status || 'lazy'}</code>
            ))}
          </div>
        </details>
      ) : null}
      {descriptor.diagnostics?.length ? (
        <details className="report-read-warning">
          <summary>preview diagnostics</summary>
          <pre className="workspace-object-code">{descriptor.diagnostics.join('\n')}</pre>
        </details>
      ) : null}
    </>
  );
}
