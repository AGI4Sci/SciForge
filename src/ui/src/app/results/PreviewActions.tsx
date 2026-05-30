import type { PreviewDescriptor, SciForgeReference } from '../../domain';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';

export function PreviewDescriptorActions({ descriptor, reference, locale }: { descriptor: PreviewDescriptor; reference: SciForgeReference; locale?: ResultLocale }) {
  return (
    <>
      <div className="source-list">
        <code>{rightPaneInlineLabel(descriptor.ref)}</code>
        {descriptor.mimeType ? <code>{rightPaneInlineLabel(descriptor.mimeType)}</code> : null}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(reference, null, 2))}>{resultText(locale, { 'zh-CN': '复制引用', 'en-US': 'Copy reference' })}</button>
      </div>
      {descriptor.derivatives?.length ? (
        <details className="report-read-warning">
          <summary>{resultText(locale, { 'zh-CN': '相关预览', 'en-US': 'Related previews' })}</summary>
          <div className="source-list">
            {descriptor.derivatives.map((derivative) => (
              <code key={`${derivative.kind}-${derivative.ref}`}>{rightPaneInlineLabel(derivative.kind)}: {rightPaneInlineLabel(derivative.status || 'lazy')}</code>
            ))}
          </div>
        </details>
      ) : null}
      {descriptor.diagnostics?.length ? (
        <details className="report-read-warning">
          <summary>{resultText(locale, { 'zh-CN': '预览详情', 'en-US': 'Preview details' })}</summary>
          <pre className="workspace-object-code">{boundedRightPaneText(descriptor.diagnostics.join('\n'), 4_000)}</pre>
        </details>
      ) : null}
    </>
  );
}
