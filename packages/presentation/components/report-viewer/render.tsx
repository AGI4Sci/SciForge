import React, { useEffect, useState } from 'react';
import type { UIComponentRendererProps, UIComponentRuntimeArtifact } from '@sciforge-ui/runtime-contract';
import {
  coerceArtifactReportPayload,
} from '@sciforge-ui/artifact-preview';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function coerceReportPayload(payload: Record<string, unknown>, artifact?: UIComponentRuntimeArtifact, relatedArtifacts: UIComponentRuntimeArtifact[] = []) {
  return coerceArtifactReportPayload(payload, artifact, relatedArtifacts);
}

export function ReportViewerRenderer(props: UIComponentRendererProps) {
  const { artifact, helpers, input } = props;
  const reportRef = input?.kind === 'markdown' ? input.ref : undefined;
  const [loadedReport, setLoadedReport] = useState<{ ref: string; markdown: string } | undefined>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const ref = reportRef;
    if (!ref || loadedReport?.ref === ref || !helpers?.readWorkspaceFile) return undefined;
    let cancelled = false;
    setLoadError('');
    void helpers.readWorkspaceFile(ref)
      .then((file) => {
        if (!cancelled) setLoadedReport({ ref, markdown: file.content });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [helpers, loadedReport?.ref, reportRef]);
  const markdown = loadedReport && loadedReport.ref === reportRef ? loadedReport.markdown : undefined;
  const ComponentEmptyState = helpers?.ComponentEmptyState;
  const MarkdownBlock = helpers?.MarkdownBlock;
  if (!artifact || !reportRef) {
    return ComponentEmptyState ? <ComponentEmptyState componentId="report-viewer" artifactType="research-report" detail={!artifact ? undefined : '当前 artifact 没有通过 ArtifactDelivery 解析出 markdown PresentationInput。'} /> : <p className="empty-state">No markdown input available.</p>;
  }
  return (
    <div className="stack">
      <div className="report-viewer">
        <div className="report-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown ?? '')} disabled={!markdown}>
            复制 Markdown
          </button>
        </div>
        {!markdown && !loadError ? <p className="empty-state">正在读取 Markdown 报告正文：{reportRef}</p> : null}
        {loadError ? (
          <details className="report-read-warning">
            <summary>Markdown 报告正文暂不可读</summary>
            <p>{loadError}</p>
          </details>
        ) : null}
        {markdown ? (MarkdownBlock ? <MarkdownBlock markdown={markdown} /> : <pre>{markdown}</pre>) : null}
      </div>
    </div>
  );
}

export function renderReportViewer(props: UIComponentRendererProps) {
  return <ReportViewerRenderer {...props} />;
}
