import React, { useEffect, useState } from 'react';
import type { UIComponentRendererProps, UIComponentRuntimeArtifact } from '@sciforge-ui/runtime-contract';
import {
  coerceArtifactReportPayload,
  relatedArtifactsForReportPolicy,
  reportRecordToReadableText,
  reportSectionsToMarkdown,
} from '@sciforge-ui/artifact-preview';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function slotPayload(slot: UIComponentRendererProps['slot'], artifact?: UIComponentRuntimeArtifact): Record<string, unknown> {
  if (isRecord(artifact?.data)) return artifact.data;
  return slot.props ?? {};
}

export function coerceReportPayload(payload: Record<string, unknown>, artifact?: UIComponentRuntimeArtifact, relatedArtifacts: UIComponentRuntimeArtifact[] = []) {
  return coerceArtifactReportPayload(payload, artifact, relatedArtifacts);
}

export function ReportViewerRenderer(props: UIComponentRendererProps) {
  const { slot, artifact, helpers } = props;
  const sessionArtifacts = isRecord(props.session) && Array.isArray(props.session.artifacts) ? props.session.artifacts.filter(isRecord) as unknown as UIComponentRuntimeArtifact[] : [];
  const relatedArtifacts = relatedArtifactsForReportPolicy(sessionArtifacts, artifact) as UIComponentRuntimeArtifact[];
  const report = coerceReportPayload(slotPayload(slot, artifact), artifact, relatedArtifacts);
  const [loadedReport, setLoadedReport] = useState<{ ref: string; markdown: string } | undefined>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const ref = report.reportRef;
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
  }, [helpers, loadedReport?.ref, report.reportRef]);
  const markdown = loadedReport && loadedReport.ref === report.reportRef ? loadedReport.markdown : report.markdown;
  const sections = report.sections;
  const ComponentEmptyState = helpers?.ComponentEmptyState;
  const MarkdownBlock = helpers?.MarkdownBlock;
  if (!artifact || (!markdown && !sections.length)) {
    return ComponentEmptyState ? <ComponentEmptyState componentId="report-viewer" artifactType="research-report" detail={!artifact ? undefined : '当前 research-report 缺少 markdown/report/sections 字段；请检查 AgentServer 生成的 artifact contract。'} /> : <p className="empty-state">No report content available.</p>;
  }
  return (
    <div className="stack">
      <div className="report-viewer">
        <div className="report-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown || reportSectionsToMarkdown(sections))}>
            复制 Markdown
          </button>
        </div>
        {report.reportRef && !loadedReport && !loadError ? <p className="empty-state">正在读取 Markdown 报告正文：{report.reportRef}</p> : null}
        {loadError ? (
          <details className="report-read-warning">
            <summary>外部报告正文暂不可读，已展示可用 artifacts 生成的摘要</summary>
            <p>{loadError}</p>
          </details>
        ) : null}
        {sections.length ? sections.map((section, index) => (
          <section key={`${asString(section.title) ?? 'section'}-${index}`}>
            <h3>{asString(section.title) || `Section ${index + 1}`}</h3>
            {MarkdownBlock ? <MarkdownBlock markdown={asString(section.content) || asString(section.markdown) || reportRecordToReadableText(section)} /> : <p>{asString(section.content) || asString(section.markdown) || reportRecordToReadableText(section)}</p>}
          </section>
        )) : MarkdownBlock ? <MarkdownBlock markdown={markdown} /> : <pre>{markdown}</pre>}
      </div>
    </div>
  );
}

export function renderReportViewer(props: UIComponentRendererProps) {
  return <ReportViewerRenderer {...props} />;
}
