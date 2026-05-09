import { useEffect, useState, type ReactNode } from 'react';
import type { SciForgeConfig, SciForgeSession, ObjectReference, RuntimeArtifact, UIManifestSlot } from '../../domain';
import { readWorkspaceFile } from '../../api/workspaceClient';
import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import { EmptyArtifactState } from '../uiPrimitives';

export type ReportViewerSlotProps = {
  scenarioId: unknown;
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function slotPayload(slot: UIManifestSlot, artifact?: RuntimeArtifact): Record<string, unknown> {
  const props = slot.props ?? {};
  if (!artifact) return props;
  const artifactRecord = artifact as RuntimeArtifact & Record<string, unknown>;
  const artifactData = isRecord(artifact.data) ? artifact.data : {};
  const nestedContent = isRecord(artifactRecord.content)
    ? artifactRecord.content
    : isRecord(artifactData.content)
      ? artifactData.content
      : {};
  return {
    ...props,
    ...artifactRecord,
    ...artifactData,
    ...nestedContent,
  };
}

function ComponentEmptyState({
  componentId,
  artifactType,
  title,
  detail,
}: {
  componentId: string;
  artifactType?: string;
  title?: string;
  detail?: string;
}) {
  const component = elementRegistry.components.find((item) => item.componentId === componentId);
  const producerSkillIds = artifactType
    ? elementRegistry.artifacts.find((item) => item.artifactType === artifactType)?.producerSkillIds ?? []
    : [];
  const recoverActions = [
    ...(component?.recoverActions ?? []),
    ...producerSkillIds.slice(0, 2).map((skillId) => `run-skill:${skillId}`),
  ];
  return (
    <EmptyArtifactState
      title={title ?? component?.emptyState.title ?? '等待 runtime artifact'}
      detail={detail ?? component?.emptyState.detail ?? '当前组件没有可展示 artifact；请运行场景或导入匹配数据。'}
      recoverActions={Array.from(new Set(recoverActions))}
    />
  );
}

export function ReportViewerSlot({ slot, artifact, config, session, onObjectReferenceFocus }: ReportViewerSlotProps) {
  const payload = slotPayload(slot, artifact);
  const report = coerceReportPayload(payload, artifact, relatedArtifactsForReport(session, artifact));
  const [loadedReport, setLoadedReport] = useState<{ ref: string; markdown: string } | undefined>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const ref = report.reportRef;
    if (!ref || loadedReport?.ref === ref) return undefined;
    let cancelled = false;
    setLoadError('');
    void readWorkspaceFile(ref, config)
      .then((file) => {
        if (!cancelled) setLoadedReport({ ref, markdown: file.content });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [config, loadedReport?.ref, report.reportRef]);
  const markdown = loadedReport && loadedReport.ref === report.reportRef ? loadedReport.markdown : report.markdown;
  const sections = report.sections;
  if (!artifact || (!markdown && !sections.length)) {
    return <ComponentEmptyState componentId="report-viewer" artifactType="research-report" detail={!artifact ? undefined : '当前 research-report 缺少 markdown/report/sections 字段；请检查 AgentServer 生成的 artifact contract。'} />;
  }
  return (
    <div className="stack">
      <div className="report-viewer">
        <div className="report-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown || sectionsToMarkdown(sections))}>
            复制 Markdown
          </button>
        </div>
        {report.reportRef && !loadedReport && !loadError ? (
          <p className="empty-state">正在读取 Markdown 报告正文：{report.reportRef}</p>
        ) : null}
        {loadError ? (
          <details className="report-read-warning">
            <summary>外部报告正文暂不可读，已展示可用 artifacts 生成的摘要</summary>
            <p>{loadError}</p>
          </details>
        ) : null}
        {sections.length ? sections.map((section, index) => (
          <section key={`${asString(section.title) ?? 'section'}-${index}`}>
            <h3>{asString(section.title) || `Section ${index + 1}`}</h3>
            <MarkdownBlock markdown={asString(section.content) || asString(section.markdown) || recordToReadableText(section)} onObjectReferenceFocus={onObjectReferenceFocus} />
          </section>
        )) : <MarkdownBlock markdown={markdown} onObjectReferenceFocus={onObjectReferenceFocus} />}
      </div>
    </div>
  );
}

export function coerceReportPayload(payload: Record<string, unknown>, artifact?: RuntimeArtifact, relatedArtifacts: RuntimeArtifact[] = []) {
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

function relatedArtifactsForReport(session: SciForgeSession, artifact?: RuntimeArtifact) {
  const runId = asString(artifact?.metadata?.runId) || asString(artifact?.metadata?.agentServerRunId) || asString(artifact?.metadata?.producerRunId);
  const candidates = session.artifacts.filter((item) => item.id !== artifact?.id);
  const sameRun = runId
    ? candidates.filter((item) => {
      const metadata = item.metadata ?? {};
      return asString(metadata.runId) === runId
        || asString(metadata.agentServerRunId) === runId
        || asString(metadata.producerRunId) === runId;
    })
    : [];
  return (sameRun.length ? sameRun : candidates).filter((item) => isReportSupportingArtifact(item)).slice(0, 8);
}

function isReportSupportingArtifact(artifact: RuntimeArtifact) {
  const haystack = `${artifact.id} ${artifact.type} ${artifact.path ?? ''} ${artifact.dataRef ?? ''}`;
  return /paper|literature|evidence|matrix|table|csv|summary|result|graph|timeline|notebook/i.test(haystack);
}

function reportFromRelatedArtifacts(artifacts: RuntimeArtifact[], primary?: RuntimeArtifact) {
  const sections: string[] = [];
  const title = asString(primary?.metadata?.title) || asString(primary?.metadata?.name) || 'Research Report';
  for (const artifact of artifacts) {
    const section = reportSectionForArtifact(artifact);
    if (section) sections.push(section);
  }
  if (!sections.length) return undefined;
  return [
    `# ${title}`,
    '',
    '以下内容由当前运行产生的结构化 artifacts 自动整理，便于直接阅读；原始 JSON 仍保留在对应 artifact 中。',
    '',
    ...sections,
  ].join('\n');
}

function reportSectionForArtifact(artifact: RuntimeArtifact) {
  const payload = isRecord(artifact.data) ? artifact.data : {};
  const label = asString(artifact.metadata?.title) || asString(artifact.metadata?.name) || humanizeKey(artifact.type || artifact.id);
  const papers = recordsFromArtifactPayload(payload, ['papers', 'items', 'records', 'rows']);
  if (/paper|literature/i.test(`${artifact.type} ${artifact.id}`) && papers.length) {
    return [
      `## ${label}`,
      '',
      ...papers.slice(0, 12).map((paper, index) => readablePaperBullet(paper, index)),
    ].join('\n');
  }
  const rows = recordsFromArtifactPayload(payload, ['rows', 'records', 'items', 'claims', 'entries']);
  if (rows.length) {
    return [
      `## ${label}`,
      '',
      markdownTable(rows.slice(0, 10)),
    ].join('\n');
  }
  const known = reportFromKnownFields(payload);
  if (known) return `## ${label}\n\n${known.replace(/^# .+\n\n?/, '')}`;
  const summary = firstString(payload.summary, payload.message, payload.description, artifact.dataRef, artifact.path);
  if (summary) return `## ${label}\n\n${summary}`;
  return undefined;
}

function recordsFromArtifactPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function readablePaperBullet(paper: Record<string, unknown>, index: number) {
  const title = firstString(paper.title, paper.name) || `Paper ${index + 1}`;
  const authors = readableList(paper.authors);
  const venue = firstString(paper.venue, paper.journal, paper.source, paper.publisher);
  const year = firstString(paper.year, paper.published, paper.date, paper.publishedAt);
  const url = firstString(paper.url, paper.doi, paper.arxivId, paper.id);
  const summary = firstString(paper.summary, paper.abstract, paper.reason, paper.relevance, paper.finding);
  const meta = [authors, venue, year, url].filter(Boolean).join(' · ');
  return [`${index + 1}. **${title}**${meta ? ` (${meta})` : ''}`, summary ? `   - ${summary}` : ''].filter(Boolean).join('\n');
}

function readableList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : asString((item as Record<string, unknown>)?.name)).filter(Boolean).slice(0, 4).join(', ');
  return asString(value);
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

function extractUserFacingReport(text?: string): { markdown?: string; reportRef?: string } {
  if (!text) return {};
  const parsedPayloads = parseJsonPayloadsFromText(text);
  for (const payload of parsedPayloads) {
    const fromPayload = reportFromStructuredPayload(payload);
    if (fromPayload.markdown || fromPayload.reportRef) return fromPayload;
  }
  const reportRef = reportRefFromText(text);
  return {
    reportRef,
    markdown: looksLikeBackendPayloadText(text) ? markdownShellForReportRef(reportRef) : undefined,
  };
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

function reportMarkdownFromRecord(record: Record<string, unknown>): string | undefined {
  const sections = toRecordList(record.sections);
  const direct = firstString(record.markdown, record.report, record.content, record.summary);
  if (direct && !looksLikeBackendPayloadText(direct)) return direct;
  if (sections.length) return sectionsToMarkdown(sections);
  return undefined;
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

function reportRefFromPayload(payload: Record<string, unknown>) {
  return firstMarkdownRef(payload.markdownRef, payload.reportRef, payload.path, payload.dataRef, payload.outputRef);
}

function reportRefFromArtifact(artifact?: RuntimeArtifact) {
  return firstMarkdownRef(
    artifact?.metadata?.markdownRef,
    artifact?.metadata?.reportRef,
    artifact?.path,
    artifact?.dataRef,
    artifact?.metadata?.dataRef,
    artifact?.metadata?.outputRef,
  );
}

function reportRefFromText(text?: string) {
  if (!text) return undefined;
  return text.match(/(?:^|["'`\s(:：])((?:\.sciforge|workspace\/\.sciforge|\/[^"'`\s]+)[^"'`\s]*\.md)(?:$|["'`\s),，。])/i)?.[1]
    || text.match(/([\w./-]*report[\w./-]*\.md)/i)?.[1];
}

function looksLikeBackendPayloadText(text?: string) {
  if (!text) return false;
  return /```json|ToolPayload|Returning the existing result|Let me inspect|prior attempt|\"artifacts\"\s*:|\"uiManifest\"\s*:|\"executionUnits\"\s*:/i.test(text);
}

function firstString(...values: unknown[]) {
  return values.map(asString).find(Boolean);
}

function firstMarkdownRef(...values: unknown[]) {
  return values.map(asString).find((value) => Boolean(value && /\.m(?:d|arkdown)(?:$|[?#])/i.test(value)));
}

function parseNestedReport(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['data', 'content', 'report', 'markdown', 'result']) {
    const value = payload[key];
    if (isRecord(value)) return value;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        if (isRecord(parsed.data)) return parsed.data;
        return parsed;
      }
    } catch {
      // The string may already be normal Markdown.
    }
  }
  return undefined;
}

export function sectionsToMarkdown(sections: Record<string, unknown>[]) {
  return sections.map((section, index) => {
    const title = asString(section.title) || `Section ${index + 1}`;
    const content = asString(section.content) || asString(section.markdown) || recordToReadableText(section);
    return `## ${title}\n\n${content}`;
  }).join('\n\n');
}

function reportFromKnownFields(record: Record<string, unknown>) {
  const parts: string[] = [];
  const title = asString(record.title) || asString(record.name);
  if (title) parts.push(`# ${title}`);
  for (const key of ['executiveSummary', 'keyFindings', 'methods', 'limitations', 'conclusions']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) parts.push(`## ${humanizeKey(key)}\n\n${value.trim()}`);
    if (Array.isArray(value) && value.length) {
      parts.push(`## ${humanizeKey(key)}\n\n${value.map((item) => `- ${typeof item === 'string' ? item : recordToReadableText(isRecord(item) ? item : { value: item })}`).join('\n')}`);
    }
  }
  return parts.length ? parts.join('\n\n') : undefined;
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

export function MarkdownBlock({ markdown, onObjectReferenceFocus }: { markdown?: string; onObjectReferenceFocus?: (reference: ObjectReference) => void }) {
  const lines = (markdown || '').split('\n');
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  function flushList() {
    if (!list.length) return;
    nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item, onObjectReferenceFocus)}</li>)}</ul>);
    list = [];
  }
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushList();
      const level = trimmed.match(/^#+/)?.[0].length ?? 2;
      const text = trimmed.replace(/^#{1,4}\s+/, '');
      nodes.push(level <= 2 ? <h3 key={index}>{inlineMarkdown(text, onObjectReferenceFocus)}</h3> : <h4 key={index}>{inlineMarkdown(text, onObjectReferenceFocus)}</h4>);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*]\s+/, ''));
      return;
    }
    flushList();
    nodes.push(<p key={index}>{inlineMarkdown(trimmed, onObjectReferenceFocus)}</p>);
  });
  flushList();
  return <div className="markdown-block">{nodes}</div>;
}

function inlineMarkdown(text: string, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{inlinePlainText(part.slice(2, -2), onObjectReferenceFocus)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) {
      const codeText = part.slice(1, -1);
      const reference = objectReferenceFromInlineRef(codeText);
      return reference ? inlineObjectReferenceButton(reference, index, onObjectReferenceFocus) : <code key={index}>{codeText}</code>;
    }
    return <span key={index}>{inlinePlainText(part, onObjectReferenceFocus)}</span>;
  });
}

function inlinePlainText(text: string, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  const parts = text.split(/((?:file|folder|artifact):[^\s\])}>,，。；;、|]+)/gi).filter(Boolean);
  return parts.map((part, index) => {
    const reference = objectReferenceFromInlineRef(part);
    if (!reference) return <span key={index}>{part}</span>;
    return inlineObjectReferenceButton(reference, index, onObjectReferenceFocus);
  });
}

function inlineObjectReferenceButton(reference: ObjectReference, key: string | number, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  return (
    <button
      key={key}
      type="button"
      className="markdown-object-ref"
      title={reference.ref}
      onClick={() => focusInlineObjectReference(reference, onObjectReferenceFocus)}
    >
      {reference.title}
    </button>
  );
}

export function hydrateInlineObjectReferenceButtons(root: ParentNode = document): () => void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent || '';
      if (!/(?:file|folder|artifact):/i.test(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest('button,a,textarea,input,script,style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent || '';
    const parts = text.split(/((?:file|folder|artifact):[^\s\])}>,，。；;、|]+)/gi).filter(Boolean);
    if (parts.length < 2) continue;
    const fragment = document.createDocumentFragment();
    let changed = false;
    for (const part of parts) {
      const reference = objectReferenceFromInlineRef(part);
      if (!reference) {
        fragment.append(document.createTextNode(part));
        continue;
      }
      changed = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'markdown-object-ref';
      button.title = reference.ref;
      button.textContent = reference.title;
      button.addEventListener('click', () => focusInlineObjectReference(reference));
      fragment.append(button);
    }
    if (!changed || !node.parentNode) continue;
    node.parentNode.replaceChild(fragment, node);
  }
  return () => undefined;
}

function focusInlineObjectReference(reference: ObjectReference, onObjectReferenceFocus?: (reference: ObjectReference) => void) {
  if (onObjectReferenceFocus) {
    onObjectReferenceFocus(reference);
    return;
  }
  window.dispatchEvent(new CustomEvent('sciforge-focus-object-reference', { detail: reference }));
}

function objectReferenceFromInlineRef(rawRef: string): ObjectReference | undefined {
  const match = rawRef.match(/^(file|folder|artifact):(.+)$/i);
  if (!match) return undefined;
  const kind = match[1].toLowerCase() as 'file' | 'folder' | 'artifact';
  const value = match[2].trim();
  if (!value) return undefined;
  const title = inlineReferenceTitle(kind, value);
  const pathLike = kind === 'file' || kind === 'folder';
  return {
    id: `inline-${kind}-${value.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 80)}`,
    kind,
    title,
    ref: `${kind}:${value}`,
    artifactType: kind === 'artifact' ? value : undefined,
    preferredView: /\.pdf(?:$|[?#])/i.test(value) ? 'pdf' : undefined,
    actions: pathLike ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin'] : ['focus-right-pane', 'inspect', 'pin'],
    summary: value,
    provenance: pathLike ? { path: value } : undefined,
  };
}

function inlineReferenceTitle(kind: 'file' | 'folder' | 'artifact', value: string) {
  if (kind === 'artifact') return value.replace(/^artifact:/i, '');
  const clean = value.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).at(-1) || value;
}
