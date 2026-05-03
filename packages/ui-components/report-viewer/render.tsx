import React, { useEffect, useState } from 'react';
import type { UIComponentRendererProps, UIComponentRuntimeArtifact } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstString(...values: unknown[]) {
  return values.map(asString).find(Boolean);
}

function slotPayload(slot: UIComponentRendererProps['slot'], artifact?: UIComponentRuntimeArtifact): Record<string, unknown> {
  if (isRecord(artifact?.data)) return artifact.data;
  return slot.props ?? {};
}

function recordToReadableText(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => {
      if (typeof value === 'string') return `**${humanizeKey(key)}:** ${value}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `**${humanizeKey(key)}:** ${String(value)}`;
      if (Array.isArray(value)) return `**${humanizeKey(key)}:**\n${value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n') || JSON.stringify(record, null, 2);
}

function humanizeKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sectionsToMarkdown(sections: Record<string, unknown>[]) {
  return sections.map((section, index) => {
    const title = asString(section.title) || `Section ${index + 1}`;
    return [`## ${title}`, asString(section.content) || asString(section.markdown) || recordToReadableText(section)].join('\n\n');
  }).join('\n\n');
}

function parseNestedReport(payload: Record<string, unknown>) {
  const nested = payload.reportData ?? payload.reportPayload ?? payload.document;
  return isRecord(nested) ? nested : undefined;
}

function reportRefFromPayload(payload: Record<string, unknown>) {
  return firstString(payload.reportRef, payload.markdownRef, payload.path, payload.dataRef, payload.outputRef, payload.resultRef);
}

function reportRefFromArtifact(artifact?: UIComponentRuntimeArtifact) {
  return firstString(artifact?.path, artifact?.dataRef, artifact?.metadata?.path, artifact?.metadata?.filePath, artifact?.metadata?.markdownRef, artifact?.metadata?.reportRef);
}

function reportRefFromText(text?: string) {
  if (!text) return undefined;
  return text.match(/(?:markdownRef|reportRef|path|dataRef)"?\s*[:=]\s*"?([^"\s]+\.md[^"\s]*)/i)?.[1]
    || text.match(/([./\w-]+\.md(?:[?#][^\s"']*)?)/i)?.[1];
}

function looksLikeBackendPayloadText(text?: string) {
  return Boolean(text && /ToolPayload|uiManifest|"artifacts"|"message"\s*:|```json/i.test(text));
}

function markdownShellForReportRef(ref?: string) {
  if (!ref || !/\.md($|[?#])|markdown/i.test(ref)) return undefined;
  return [
    '# Markdown report',
    '',
    `报告内容已作为 workspace ref 生成：\`${ref}\`。`,
    '',
    '当前 artifact 没有内联 markdown 内容，因此结果区保留可读文档壳和可复现引用；如需全文预览，请让任务把 markdown 正文写入 `research-report.markdown` 或 `sections` 字段。',
  ].join('\n');
}

function isGeneratedReportShell(markdown: string) {
  return /^# Markdown report\b/i.test(markdown) && /workspace ref|workspace 引用|artifact 没有内联 markdown/i.test(markdown);
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodeJsonStringLiteral(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function parseJsonPayloadsFromText(text: string): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = parseJsonRecord(match[1]);
    if (parsed) payloads.push(parsed);
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const parsed = parseJsonRecord(text.slice(firstBrace, lastBrace + 1));
    if (parsed) payloads.push(parsed);
  }
  if (!payloads.length) {
    const messageMatch = text.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const message = messageMatch ? decodeJsonStringLiteral(messageMatch[1]) : undefined;
    const ref = reportRefFromText(text);
    if (message || ref) payloads.push({ message, reportRef: ref });
  }
  return payloads;
}

function reportMarkdownFromRecord(record: Record<string, unknown>): string | undefined {
  const sections = toRecordList(record.sections);
  const direct = firstString(record.markdown, record.report, record.content, record.summary);
  if (direct && !looksLikeBackendPayloadText(direct)) return direct;
  if (sections.length) return sectionsToMarkdown(sections);
  return undefined;
}

function reportFromStructuredPayload(payload: Record<string, unknown>): { markdown?: string; reportRef?: string } {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.filter(isRecord) : [];
  for (const artifact of artifacts) {
    const type = asString(artifact.type) || asString(artifact.id) || '';
    if (!/report|markdown|document|summary/i.test(type)) continue;
    const nested = isRecord(artifact.data) ? artifact.data : artifact;
    const markdown = reportMarkdownFromRecord(nested);
    const reportRef = reportRefFromPayload(nested) || reportRefFromPayload(artifact) || reportRefFromText(JSON.stringify(artifact));
    if (markdown || reportRef) return { markdown, reportRef };
  }
  const markdown = reportMarkdownFromRecord(payload);
  const reportRef = reportRefFromPayload(payload) || reportRefFromText(JSON.stringify(payload));
  if (markdown || reportRef) return { markdown, reportRef };
  const message = asString(payload.message);
  return {
    markdown: message && !looksLikeBackendPayloadText(message) ? message : undefined,
    reportRef,
  };
}

function extractUserFacingReport(text?: string): { markdown?: string; reportRef?: string } {
  if (!text) return {};
  for (const payload of parseJsonPayloadsFromText(text)) {
    const fromPayload = reportFromStructuredPayload(payload);
    if (fromPayload.markdown || fromPayload.reportRef) return fromPayload;
  }
  const reportRef = reportRefFromText(text);
  return {
    reportRef,
    markdown: looksLikeBackendPayloadText(text) ? markdownShellForReportRef(reportRef) : undefined,
  };
}

function reportFromKnownFields(source: Record<string, unknown>) {
  const title = firstString(source.title, source.name);
  const summary = firstString(source.summary, source.description, source.message);
  const findings = toRecordList(source.findings ?? source.results ?? source.claims);
  if (!title && !summary && !findings.length) return undefined;
  return [
    title ? `# ${title}` : undefined,
    summary,
    findings.length ? markdownTable(findings.slice(0, 10)) : undefined,
  ].filter(Boolean).join('\n\n');
}

function markdownTable(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 5);
  if (!columns.length) return rows.map((row) => `- ${recordToReadableText(row).replace(/\n+/g, '; ')}`).join('\n');
  const escapeCell = (value: unknown) => String(Array.isArray(value) ? value.join(', ') : isRecord(value) ? JSON.stringify(value) : value ?? '').replace(/\|/g, '\\|').slice(0, 220);
  return [
    `| ${columns.map(humanizeKey).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => escapeCell(row[column])).join(' | ')} |`),
  ].join('\n');
}

function recordsFromArtifactPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function reportSectionForArtifact(artifact: UIComponentRuntimeArtifact) {
  const payload = isRecord(artifact.data) ? artifact.data : {};
  const label = asString(artifact.metadata?.title) || asString(artifact.metadata?.name) || humanizeKey(artifact.type || artifact.id);
  const papers = recordsFromArtifactPayload(payload, ['papers', 'items', 'records', 'rows']);
  if (/paper|literature/i.test(`${artifact.type} ${artifact.id}`) && papers.length) {
    return [
      `## ${label}`,
      '',
      ...papers.slice(0, 12).map((paper, index) => {
        const title = firstString(paper.title, paper.name) || `Paper ${index + 1}`;
        const summary = firstString(paper.summary, paper.abstract, paper.reason, paper.relevance, paper.finding);
        return [`${index + 1}. **${title}**`, summary ? `   - ${summary}` : ''].filter(Boolean).join('\n');
      }),
    ].join('\n');
  }
  const rows = recordsFromArtifactPayload(payload, ['rows', 'records', 'items', 'claims', 'entries']);
  if (rows.length) return [`## ${label}`, '', markdownTable(rows.slice(0, 10))].join('\n');
  const known = reportFromKnownFields(payload);
  if (known) return `## ${label}\n\n${known.replace(/^# .+\n\n?/, '')}`;
  const summary = firstString(payload.summary, payload.message, payload.description, artifact.dataRef, artifact.path);
  return summary ? `## ${label}\n\n${summary}` : undefined;
}

function reportFromRelatedArtifacts(artifacts: UIComponentRuntimeArtifact[], primary?: UIComponentRuntimeArtifact) {
  const sections = artifacts.map(reportSectionForArtifact).filter(Boolean);
  if (!sections.length) return undefined;
  const title = asString(primary?.metadata?.title) || asString(primary?.metadata?.name) || 'Research Report';
  return [`# ${title}`, '', '以下内容由当前运行产生的结构化 artifacts 自动整理，便于直接阅读；原始 JSON 仍保留在对应 artifact 中。', '', ...sections].join('\n');
}

export function coerceReportPayload(payload: Record<string, unknown>, artifact?: UIComponentRuntimeArtifact, relatedArtifacts: UIComponentRuntimeArtifact[] = []) {
  const nested = parseNestedReport(payload);
  const source = nested ?? payload;
  const sections = toRecordList(source.sections);
  const direct = firstString(source.markdown, source.report, source.summary, source.content);
  const extracted = extractUserFacingReport(direct);
  const relatedMarkdown = reportFromRelatedArtifacts(relatedArtifacts, artifact);
  const extractedMarkdown = extracted.markdown && !isGeneratedReportShell(extracted.markdown) ? extracted.markdown : undefined;
  const reportRef = extracted.reportRef
    || reportRefFromPayload(source)
    || reportRefFromText(direct)
    || reportRefFromArtifact(artifact);
  const markdown = extractedMarkdown
    || (!looksLikeBackendPayloadText(direct) ? direct : undefined)
    || (sections.length ? sectionsToMarkdown(sections) : undefined)
    || reportFromKnownFields(source)
    || relatedMarkdown
    || extracted.markdown
    || markdownShellForReportRef(reportRef);
  return { markdown, sections, reportRef };
}

export function ReportViewerRenderer(props: UIComponentRendererProps) {
  const { slot, artifact, helpers } = props;
  const sessionArtifacts = isRecord(props.session) && Array.isArray(props.session.artifacts) ? props.session.artifacts.filter(isRecord) as unknown as UIComponentRuntimeArtifact[] : [];
  const relatedArtifacts = sessionArtifacts.filter((item) => item.id !== artifact?.id).slice(0, 8);
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
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown || sectionsToMarkdown(sections))}>
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
            {MarkdownBlock ? <MarkdownBlock markdown={asString(section.content) || asString(section.markdown) || recordToReadableText(section)} /> : <p>{asString(section.content) || asString(section.markdown) || recordToReadableText(section)}</p>}
          </section>
        )) : MarkdownBlock ? <MarkdownBlock markdown={markdown} /> : <pre>{markdown}</pre>}
      </div>
    </div>
  );
}

export function renderReportViewer(props: UIComponentRendererProps) {
  return <ReportViewerRenderer {...props} />;
}
