import type { ObjectReference, RuntimeArtifact } from '@sciforge-ui/runtime-contract';

export type ReportPolicyRuntimeArtifactLike =
  Pick<RuntimeArtifact, 'id' | 'type' | 'metadata' | 'data' | 'dataRef' | 'path'>
  & Partial<Pick<RuntimeArtifact, 'producerScenario' | 'schemaVersion'>>;

export type ArtifactProvenanceSource = 'project-tool' | 'record-only' | 'empty';
export type ArtifactProvenanceSourceVariant = 'success' | 'muted' | 'warning';

export function isReportPolicyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function reportPolicyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function reportPolicyRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isReportPolicyRecord) : [];
}

export function artifactProvenanceSource(artifact?: ReportPolicyRuntimeArtifactLike): ArtifactProvenanceSource {
  if (!artifact) return 'empty';
  const mode = reportPolicyString(artifact.metadata?.mode);
  const runner = reportPolicyString(artifact.metadata?.runner);
  if (mode?.includes('record')) return 'record-only';
  if (runner?.includes('local-csv') || artifact.dataRef?.includes('.sciforge/omics/')) return 'project-tool';
  return 'project-tool';
}

export function artifactProvenanceSourceVariant(source: ArtifactProvenanceSource): ArtifactProvenanceSourceVariant {
  if (source === 'project-tool') return 'success';
  if (source === 'record-only') return 'warning';
  return 'muted';
}

export function coerceArtifactReportPayload(
  payload: Record<string, unknown>,
  artifact?: ReportPolicyRuntimeArtifactLike,
  relatedArtifacts: ReportPolicyRuntimeArtifactLike[] = [],
) {
  const nested = parseNestedReport(payload);
  const source = nested ?? payload;
  const sections = reportPolicyRecordList(source.sections);
  const direct = firstString(source.markdown, source.report, source.summary, source.content);
  const directIsBackendPayloadText = looksLikeBackendPayloadText(direct);
  const extracted = extractUserFacingReport(direct);
  const relatedMarkdown = reportFromRelatedArtifacts(relatedArtifacts, artifact);
  const extractedMarkdown = extracted.markdown
    && !isGeneratedReportShell(extracted.markdown)
    && (!directIsBackendPayloadText || looksLikeSubstantialReportMarkdown(extracted.markdown))
    ? extracted.markdown
    : undefined;
  const sourceIsBackendPayload = directIsBackendPayloadText || looksLikeBackendPayloadRecord(source);
  const reportRef = extracted.reportRef
    || reportRefFromPayload(source)
    || reportRefFromText(direct)
    || reportRefFromArtifact(artifact);
  const markdown = extractedMarkdown
    || (!sourceIsBackendPayload ? direct : undefined)
    || (sections.length && !sourceIsBackendPayload ? reportSectionsToMarkdown(sections) : undefined)
    || (!sourceIsBackendPayload ? reportFromKnownFields(source) : undefined)
    || relatedMarkdown
    || (!sourceIsBackendPayload ? extracted.markdown : undefined)
    || markdownShellForReportRef(reportRef);
  return { markdown, sections, reportRef };
}

export function relatedArtifactsForReportPolicy(
  artifacts: ReportPolicyRuntimeArtifactLike[],
  artifact?: ReportPolicyRuntimeArtifactLike,
) {
  const runId = reportPolicyString(artifact?.metadata?.runId)
    || reportPolicyString(artifact?.metadata?.agentServerRunId)
    || reportPolicyString(artifact?.metadata?.producerRunId);
  const candidates = artifacts.filter((item) => item.id !== artifact?.id);
  const sameRun = runId
    ? candidates.filter((item) => {
      const metadata = item.metadata ?? {};
      return reportPolicyString(metadata.runId) === runId
        || reportPolicyString(metadata.agentServerRunId) === runId
        || reportPolicyString(metadata.producerRunId) === runId;
    })
    : [];
  return (sameRun.length ? sameRun : candidates).filter((item) => isReportSupportingArtifact(item)).slice(0, 8);
}

export function reportSectionsToMarkdown(sections: Record<string, unknown>[]) {
  return sections.map((section, index) => {
    const title = reportPolicyString(section.title) || `Section ${index + 1}`;
    const content = reportPolicyString(section.content) || reportPolicyString(section.markdown) || reportRecordToReadableText(section);
    return `## ${title}\n\n${content}`;
  }).join('\n\n');
}

export function reportRecordToReadableText(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => {
      if (typeof value === 'string') return `**${humanizeReportKey(key)}:** ${value}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `**${humanizeReportKey(key)}:** ${String(value)}`;
      if (Array.isArray(value)) return `**${humanizeReportKey(key)}:**\n${value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n') || JSON.stringify(record, null, 2);
}

export function markdownShellForReportRef(ref?: string) {
  if (!ref || !/\.md($|[?#])|markdown/i.test(ref)) return undefined;
  return [
    '# Markdown report',
    '',
    `报告内容已作为 workspace ref 生成：\`${ref}\`。`,
    '',
    '当前 artifact 没有内联 markdown 内容，因此结果区保留可读文档壳和可复现引用；如需全文预览，请让任务把 markdown 正文写入 `research-report.markdown` 或 `sections` 字段。',
  ].join('\n');
}

export function isGeneratedReportShell(markdown: string) {
  return /^# Markdown report\b/i.test(markdown) && /workspace ref|workspace 引用|artifact 没有内联 markdown/i.test(markdown);
}

export function reportRefFromText(text?: string) {
  if (!text) return undefined;
  return text.match(/(?:^|["'`\s(:：])((?:\.sciforge|workspace\/\.sciforge|\/[^"'`\s]+)[^"'`\s]*\.md)(?:$|["'`\s),，。])/i)?.[1]
    || text.match(/(?:markdownRef|reportRef|path|dataRef)"?\s*[:=]\s*"?([^"\s]+\.md[^"\s]*)/i)?.[1]
    || text.match(/([\w./-]*report[\w./-]*\.md)/i)?.[1]
    || text.match(/([./\w-]+\.md(?:[?#][^\s"']*)?)/i)?.[1];
}

export function looksLikeBackendPayloadText(text?: string) {
  if (!text) return false;
  return /```json|ToolPayload|Returning the existing result|Let me inspect|prior attempt|sciforge\.agentserver-generation-response\.v1|\"taskFiles\"\s*:|\"artifacts\"\s*:|\"uiManifest\"\s*:|\"executionUnits\"\s*:|\"stdout\"\s*:|\"stderr\"\s*:|\"message\"\s*:|Traceback \(most recent call last\)|^\s*(import|from|const|function|class)\s+\S+/im.test(text);
}

function looksLikeBackendPayloadRecord(record: Record<string, unknown>) {
  const version = reportPolicyString(record.version) || reportPolicyString(record.schemaVersion) || '';
  return /sciforge\.agentserver-generation-response/i.test(version)
    || Array.isArray(record.taskFiles)
    || Array.isArray(record.executionUnits)
    || Array.isArray(record.uiManifest)
    || typeof record.stdout === 'string'
    || typeof record.stderr === 'string';
}

function looksLikeSubstantialReportMarkdown(text: string) {
  const trimmed = text.trim();
  return trimmed.length >= 120 || /^#{1,3}\s+\S/m.test(trimmed) || /\n[-*]\s+\S/.test(trimmed) || /\n\|.+\|/.test(trimmed);
}

export function inlineObjectReferenceFromMarkdownRef(rawRef: string): ObjectReference | undefined {
  const match = rawRef.match(/^(file|folder|artifact):(.+)$/i);
  if (!match) return undefined;
  const kind = match[1].toLowerCase() as 'file' | 'folder' | 'artifact';
  const value = match[2].trim();
  if (!value) return undefined;
  const pathLike = kind === 'file' || kind === 'folder';
  return {
    id: `inline-${kind}-${value.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 80)}`,
    kind,
    title: inlineReferenceTitle(kind, value),
    ref: `${kind}:${value}`,
    artifactType: kind === 'artifact' ? value : undefined,
    preferredView: /\.pdf(?:$|[?#])/i.test(value) ? 'pdf' : undefined,
    actions: pathLike ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin'] : ['focus-right-pane', 'inspect', 'pin'],
    summary: value,
    provenance: pathLike ? { path: value } : undefined,
  };
}

export function splitInlineObjectReferenceText(text: string) {
  return text
    .split(/((?:file|folder|artifact):[^\s\])}>,，。；;、|]+)/gi)
    .filter(Boolean)
    .map((part) => ({ text: part, reference: inlineObjectReferenceFromMarkdownRef(part) }));
}

export function hasInlineObjectReferenceText(text: string) {
  return /(?:file|folder|artifact):/i.test(text);
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
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.filter(isReportPolicyRecord) : [];
  for (const artifact of artifacts) {
    const type = reportPolicyString(artifact.type) || reportPolicyString(artifact.id) || '';
    if (!/report|markdown|document|summary/i.test(type)) continue;
    const nested = isReportPolicyRecord(artifact.data) ? artifact.data : artifact;
    const markdown = reportMarkdownFromRecord(nested);
    const reportRef = reportRefFromPayload(nested) || reportRefFromPayload(artifact) || reportRefFromText(JSON.stringify(artifact));
    if (markdown || reportRef) return { markdown, reportRef };
  }
  const markdown = reportMarkdownFromRecord(payload);
  const reportRef = reportRefFromPayload(payload) || reportRefFromText(JSON.stringify(payload));
  if (markdown || reportRef) return { markdown, reportRef };
  const message = reportPolicyString(payload.message);
  return {
    markdown: message && !looksLikeBackendPayloadText(message) ? message : undefined,
    reportRef,
  };
}

function reportMarkdownFromRecord(record: Record<string, unknown>): string | undefined {
  const sections = reportPolicyRecordList(record.sections);
  const direct = firstString(record.markdown, record.report, record.content, record.summary);
  if (direct && !looksLikeBackendPayloadText(direct)) return direct;
  if (sections.length) return reportSectionsToMarkdown(sections);
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
    return isReportPolicyRecord(parsed) ? parsed : undefined;
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
  return firstMarkdownRef(payload.markdownRef, payload.reportRef, payload.path, payload.dataRef, payload.outputRef, payload.resultRef)
    || reportRefFromTaskFiles(payload.taskFiles)
    || reportRefFromTaskFiles(payload.files)
    || reportRefFromTaskFiles(payload.outputs)
    || reportRefFromDeepRecord(payload, 2);
}

function reportRefFromArtifact(artifact?: ReportPolicyRuntimeArtifactLike) {
  const direct = firstMarkdownRef(
    artifact?.metadata?.markdownRef,
    artifact?.metadata?.reportRef,
    artifact?.path,
    artifact?.metadata?.path,
    artifact?.metadata?.filePath,
    artifact?.dataRef,
    artifact?.metadata?.dataRef,
    artifact?.metadata?.outputRef,
  );
  if (direct) return direct;
  const data = isReportPolicyRecord(artifact?.data) ? artifact.data : undefined;
  const metadata = isReportPolicyRecord(artifact?.metadata) ? artifact.metadata : undefined;
  return data ? reportRefFromPayload(data) : metadata ? reportRefFromPayload(metadata) : undefined;
}

function firstString(...values: unknown[]) {
  return values.map(reportPolicyString).find(Boolean);
}

function firstMarkdownRef(...values: unknown[]) {
  return values.map(reportPolicyString).find((value) => Boolean(value && /\.m(?:d|arkdown)(?:$|[?#])/i.test(value)));
}

function reportRefFromTaskFiles(value: unknown): string | undefined {
  const records = Array.isArray(value) ? value.filter(isReportPolicyRecord) : [];
  for (const record of records) {
    const ref = firstMarkdownRef(record.path, record.ref, record.dataRef, record.outputRef, record.name);
    if (ref) return ref;
  }
  return undefined;
}

function reportRefFromDeepRecord(record: Record<string, unknown>, depth: number): string | undefined {
  if (depth <= 0) return undefined;
  for (const value of Object.values(record)) {
    if (typeof value === 'string') {
      const ref = reportRefFromText(value);
      if (ref) return ref;
    }
    if (isReportPolicyRecord(value)) {
      const ref = reportRefFromPayload(value);
      if (ref) return ref;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isReportPolicyRecord(item)) continue;
        const ref = reportRefFromDeepRecord(item, depth - 1);
        if (ref) return ref;
      }
    }
  }
  return undefined;
}

function parseNestedReport(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['data', 'content', 'report', 'markdown', 'result', 'reportData', 'reportPayload', 'document']) {
    const value = payload[key];
    if (isReportPolicyRecord(value)) return value;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isReportPolicyRecord(parsed)) {
        if (isReportPolicyRecord(parsed.data)) return parsed.data;
        return parsed;
      }
    } catch {
      // Report strings may already be Markdown.
    }
  }
  return undefined;
}

function reportFromKnownFields(record: Record<string, unknown>) {
  const parts: string[] = [];
  const title = reportPolicyString(record.title) || reportPolicyString(record.name);
  if (title) parts.push(`# ${title}`);
  for (const key of ['executiveSummary', 'keyFindings', 'methods', 'limitations', 'conclusions']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) parts.push(`## ${humanizeReportKey(key)}\n\n${value.trim()}`);
    if (Array.isArray(value) && value.length) {
      parts.push(`## ${humanizeReportKey(key)}\n\n${value.map((item) => `- ${typeof item === 'string' ? item : reportRecordToReadableText(isReportPolicyRecord(item) ? item : { value: item })}`).join('\n')}`);
    }
  }
  const summary = firstString(record.summary, record.description, record.message);
  const findings = reportPolicyRecordList(record.findings ?? record.results ?? record.claims);
  if (!parts.length && (title || summary || findings.length)) {
    return [
      title ? `# ${title}` : undefined,
      summary,
      findings.length ? markdownTable(findings.slice(0, 10)) : undefined,
    ].filter(Boolean).join('\n\n');
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

function reportFromRelatedArtifacts(artifacts: ReportPolicyRuntimeArtifactLike[], primary?: ReportPolicyRuntimeArtifactLike) {
  const sections: string[] = [];
  const title = reportPolicyString(primary?.metadata?.title) || reportPolicyString(primary?.metadata?.name) || 'Research Report';
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

function reportSectionForArtifact(artifact: ReportPolicyRuntimeArtifactLike) {
  const payload = isReportPolicyRecord(artifact.data) ? artifact.data : {};
  const label = reportPolicyString(artifact.metadata?.title) || reportPolicyString(artifact.metadata?.name) || humanizeReportKey(artifact.type || artifact.id);
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

function isReportSupportingArtifact(artifact: ReportPolicyRuntimeArtifactLike) {
  const haystack = `${artifact.id} ${artifact.type} ${artifact.path ?? ''} ${artifact.dataRef ?? ''}`;
  return /paper|literature|evidence|matrix|table|csv|summary|result|graph|timeline|notebook/i.test(haystack);
}

function recordsFromArtifactPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isReportPolicyRecord);
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
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : reportPolicyString((item as Record<string, unknown>)?.name)).filter(Boolean).slice(0, 4).join(', ');
  return reportPolicyString(value);
}

function markdownTable(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 5);
  if (!columns.length) return rows.map((row) => `- ${reportRecordToReadableText(row).replace(/\n+/g, '; ')}`).join('\n');
  const escapeCell = (value: unknown) => String(Array.isArray(value) ? value.join(', ') : isReportPolicyRecord(value) ? JSON.stringify(value) : value ?? '').replace(/\|/g, '\\|').slice(0, 220);
  return [
    `| ${columns.map(humanizeReportKey).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => escapeCell(row[column])).join(' | ')} |`),
  ].join('\n');
}

function inlineReferenceTitle(kind: 'file' | 'folder' | 'artifact', value: string) {
  if (kind === 'artifact') return value.replace(/^artifact:/i, '');
  const clean = value.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).at(-1) || value;
}

function humanizeReportKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
