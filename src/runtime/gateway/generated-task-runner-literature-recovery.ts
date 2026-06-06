import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import {
  generatedTaskLiteratureDeliverablesExpected,
  literatureGenerationFailureRecoveryMessage,
  literatureNoResultScope,
  literatureProviderMetadataMissingFullTextStatus,
  literatureRecoverySearchQuery,
} from '@sciforge-ui/runtime-contract/generated-work-policy';
import { invokeWebTool } from '../../../packages/workers/web-worker/src/worker.js';

export async function literatureGenerationFailureRecoveryPayload(
  request: GatewayRequest,
  failureReason: string,
): Promise<ToolPayload | undefined> {
  if (!shouldUseLiteratureMetadataRecoveryAdapter(request)) return undefined;
  const query = literatureRecoverySearchQuery(request.prompt);
  const search = await invokeWebTool({
    toolId: 'web_search',
    input: { query, limit: 8 },
    requestId: `literature-generation-failure-search-${sha1(query).slice(0, 10)}`,
    metadata: { source: 'agentserver-generation-failure-recovery' },
  });
  if (!search.ok || !isRecord(search.output)) {
    return literatureNoResultRecoveryPayload(
      request,
      query,
      failureReason,
      search.ok ? 'web_search returned non-object output' : search.error.message,
    );
  }
  const records = flattenLiteratureRecords(search.output, 12);
  if (!records.length) {
    return literatureNoResultRecoveryPayload(request, query, failureReason, 'web_search returned zero normalized literature records');
  }
  const provider = stringValue(search.output.provider);
  const providerQuery = stringValue(search.output.providerQuery) || query;
  const dateFallback = isRecord(search.output.dateFallback) ? search.output.dateFallback : undefined;
  const requestedDateRange = isRecord(dateFallback?.requestedDateRange) ? dateFallback.requestedDateRange : undefined;
  const dateFallbackReason = stringValue(dateFallback?.reason);
  const requestedFromDate = stringValue(dateFallback?.fromDate) || stringValue(requestedDateRange?.fromDate);
  const requestedToDate = stringValue(dateFallback?.toDate) || stringValue(requestedDateRange?.toDate);
  const dateFallbackNote = dateFallbackReason
    ? `日期窗口说明：${dateFallbackReason}；原始日期范围 ${requestedFromDate || '?'} 至 ${requestedToDate || '?'}，因此下表是放宽日期后的最新匹配，不应表述为“当天提交论文”。`
    : '';
  const rows = normalizeLiteratureRows(records);
  let fetchedCount = 0;
  let pdfExtractedCount = 0;
  for (const row of rows.slice(0, 3)) {
    const url = typeof row.url === 'string' ? row.url : '';
    if (!url) continue;
    const fetch = await invokeWebTool({
      toolId: 'web_fetch',
      input: { url, maxChars: 8000 },
      requestId: `literature-generation-failure-fetch-${sha1(url).slice(0, 10)}`,
      metadata: { source: 'agentserver-generation-failure-recovery' },
    });
    if (!fetch.ok || !isRecord(fetch.output)) {
      row.fetchStatus = fetch.ok ? 'web_fetch returned non-object output' : `web_fetch failed: ${fetch.error.message}`;
      row.fullTextStatus = 'Full-text/PDF unavailable in this run because provider fetch failed; source URL retained for retry.';
      continue;
    }
    fetchedCount += 1;
    const finalUrl = stringValue(fetch.output.finalUrl) || stringValue(fetch.output.url) || url;
    const text = stringValue(fetch.output.text);
    row.evidenceLocation = finalUrl;
    row.fetchStatus = `Fetched via web_fetch; ok=${String(fetch.output.ok)}; status=${String(fetch.output.status ?? '')}`;
    if (text) row.evidenceSnippet = text.slice(0, 900);
    const pdfUrl = pdfUrlFromFetchOutput(fetch.output, finalUrl, row);
    if (!pdfUrl) {
      row.fullTextStatus = text
        ? 'Source page text fetched via web_fetch; no PDF link confirmed in fetched page.'
        : 'web_fetch completed, but no page text or PDF link was returned.';
      continue;
    }
    row.pdfUrl = pdfUrl;
    const pdf = await invokeWebTool({
      toolId: 'pdf_extract',
      input: { url: pdfUrl, maxChars: 14000, maxPages: 8, timeoutMs: 30000 },
      requestId: `literature-generation-failure-pdf-${sha1(pdfUrl).slice(0, 10)}`,
      metadata: { source: 'agentserver-generation-failure-recovery' },
    });
    if (!pdf.ok || !isRecord(pdf.output)) {
      row.fullTextStatus = `PDF/full-text candidate URL found (${pdfUrl}), but extraction failed: ${pdf.ok ? 'pdf_extract returned non-object output' : pdf.error.message}`;
      row.evidenceLocation = pdfUrl;
      continue;
    }
    const extraction = isRecord(pdf.output.pdfExtraction) ? pdf.output.pdfExtraction : {};
    const extractionStatus = stringValue(extraction.status);
    const pdfText = stringValue(pdf.output.text);
    row.evidenceLocation = firstEvidenceLocation(extraction.evidenceLocations, `${pdfUrl}#page=1`);
    row.pdfExtractionStatus = extractionStatus || 'unknown';
    if (pdfText) {
      pdfExtractedCount += 1;
      row.evidenceSnippet = pdfText.slice(0, 1200);
      row.fullTextStatus = `PDF extracted via pdf_extract (${stringValue(extraction.extractor) || 'pdftotext'}), page range ${stringValue(extraction.pageRange) || 'bounded'}, chars=${String(extraction.charsExtracted ?? pdfText.length)}; source ${pdfUrl}`;
      row.limitations = 'PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations.';
    } else {
      row.fullTextStatus = `PDF URL confirmed (${pdfUrl}), but bounded extraction did not return readable text: ${stringValue(extraction.reason) || extractionStatus || 'unknown reason'}`;
    }
  }
  const matrixRows = rows.map((row) => ({
    claim: row.title,
    'main result': row.summary,
    fullTextStatus: row.fullTextStatus,
    evidenceLocation: row.evidenceLocation,
    evidenceSnippet: row.evidenceSnippet ?? '',
    limitations: row.limitations,
    'citation/ref': row.url || row.doi || row.title,
  }));
  const report = [
    '# 中文文献调研报告（AgentServer generation failure recovery）',
    '',
    `检索 query：${query}`,
    `检索 provider：${provider || 'web_search'}；provider query：${providerQuery}`,
    dateFallbackNote,
    `候选论文数：${rows.length}；已抓取来源页面：${fetchedCount}；已抽取 PDF 全文片段：${pdfExtractedCount}。`,
    '',
    '## 候选论文与全文/PDF状态',
    '',
    markdownLiteratureTable(rows),
    '',
    '## 关键结论',
    '',
    ...(dateFallbackNote ? [`- ${dateFallbackNote}`] : []),
    '- 已生成 latest paper list、evidence matrix、中文 research report artifact，并保留 source/evidence location。',
    '- 对前几条候选记录尝试了 web_fetch，并在确认 PDF URL 后调用 pdf_extract 做 bounded PDF 正文抽取；无法抽取时保留不可得原因。',
    '- 该 fallback 避免 AgentServer convergence guard 后只返回 runtime diagnostic，支持 selected report follow-up 继续点选 artifact 追问。',
    '',
    '## 局限性',
    '',
    '- 这是 AgentServer generation failure 后的 bounded provider recovery，不等同完整系统综述。',
    ...(dateFallbackNote ? ['- 用户要求的当天窗口没有被满足；当前候选只能作为“最近匹配”继续阅读清单。'] : []),
    '- 搜索 provider 的排序和摘要可能遗漏最新论文，全文可得性受站点访问、PDF 可解析性和 bounded page/char budget 影响。',
    '',
    '## Recovery note',
    '',
    failureReason,
  ].join('\n');
  return {
    message: literatureGenerationFailureRecoveryMessage({
      rowCount: rows.length,
      fetchedCount,
      pdfExtractedCount,
    }),
    confidence: pdfExtractedCount > 0 ? 0.74 : 0.68,
    claimType: 'literature-survey',
    evidenceLevel: 'provider-grounded-recovery',
    reasoningTrace: failureReason,
    claims: [{
      statement: `Provider fallback returned ${rows.length} candidate literature records for the requested research question.`,
      confidence: pdfExtractedCount > 0 ? 0.74 : 0.68,
      evidenceRefs: ['runtime://web-worker/web_search', 'runtime://web-worker/web_fetch', 'runtime://web-worker/pdf_extract'],
    }],
    uiManifest: [
      { componentId: 'paper-card-list', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', artifactRef: 'evidence-matrix', priority: 2 },
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 3 },
      { componentId: 'notebook-timeline', artifactRef: 'notebook-timeline', priority: 4 },
    ],
    executionUnits: [{
      id: 'literature-generation-failure-provider-recovery',
      status: 'done',
      tool: 'sciforge.web-worker.web_search+web_fetch+pdf_extract',
      summary: `Called web_search, fetched ${fetchedCount} source pages, and extracted ${pdfExtractedCount} PDFs after AgentServer generation failed.`,
      failureReason,
      recoverActions: pdfExtractedCount > 0
        ? ['Audit extracted PDF snippets against exact page/section claims before making stronger citation-level conclusions.']
        : ['Run a full PDF extraction pass before making stronger citation-level claims.'],
    }],
    artifacts: [
      { id: 'paper-list', type: 'paper-list', data: rows },
      { id: 'evidence-matrix', type: 'evidence-matrix', data: { rows: matrixRows } },
      { id: 'research-report', type: 'research-report', data: { markdown: report } },
      {
        id: 'notebook-timeline',
        type: 'notebook-timeline',
        data: {
          events: [
            { kind: 'provider-search', title: 'Provider search', summary: `web_search returned ${rows.length} candidate literature records.`, artifactRef: 'artifact:paper-list' },
            { kind: 'provider-fetch', title: 'Source fetch', summary: `web_fetch retrieved ${fetchedCount} source pages for full-text/PDF availability notes.`, artifactRef: 'artifact:evidence-matrix' },
            { kind: 'provider-fetch', title: 'PDF extraction', summary: `pdf_extract retrieved bounded text from ${pdfExtractedCount} PDFs.`, artifactRef: 'artifact:evidence-matrix' },
            { kind: 'report', title: 'Chinese report generated', summary: 'Research-report artifact assembled with conclusions, limitations, and follow-up support.', artifactRef: 'artifact:research-report' },
          ],
        },
      },
    ],
    displayIntent: { status: 'completed', taskOutcome: 'satisfied', primaryView: 'answer' },
    objectReferences: [
      { kind: 'artifact', ref: 'artifact:research-report' },
      { kind: 'artifact', ref: 'artifact:paper-list' },
      { kind: 'artifact', ref: 'artifact:evidence-matrix' },
      { kind: 'artifact', ref: 'artifact:notebook-timeline' },
    ],
  };
}

function literatureNoResultRecoveryPayload(
  request: GatewayRequest,
  query: string,
  failureReason: string,
  unavailableReason: string,
): ToolPayload {
  const scope = literatureNoResultScope(query || request.prompt);
  const report = [
    '# 中文文献调研报告（无可确认结果）',
    '',
    `检索 query：${query}`,
    '',
    '## 最新论文列表',
    '',
    '- 本轮 provider fallback 未返回可规范化的论文记录，因此没有把任何候选论文标记为“已确认最新”。',
    '',
    '## 全文/PDF 或不可得说明',
    '',
    `- 不可得原因：${unavailableReason}`,
    '- 未生成 PDF/full-text 已读取声明；后续需要在 provider 恢复后重新运行相应检索 API 与 PDF 提取。',
    '',
    '## 证据位置',
    '',
    '- 证据位置仅限本次 provider 调用诊断；没有可引用论文页面或 PDF 页码。',
    '',
    '## 关键结论',
    '',
    '- SciForge 没有把 AgentServer malformed generation 当作成功结果。',
    '- SciForge 已尝试通用文献 provider fallback；由于没有可规范化论文记录，本轮只能给出无结果/不可得结论。',
    '',
    '## 局限性',
    '',
    '- 无结果不等于领域内不存在相关论文；它只说明本轮可用 provider 没有返回可确认记录。',
    '- 没有完成 PDF extraction/citation-grade verification。',
    '',
    '## 下一步阅读建议',
    '',
    '- 放宽日期窗到最近 7-30 天。',
    `- 用${scope.sourceLabel}主题词 \`${scope.topicLabel}\` 重新检索，并记录 provider 状态与原始结果。`,
    '- 对返回的论文页面或 PDF 链接逐篇做全文/PDF 提取。',
    '',
    '## Recovery note',
    '',
    failureReason,
  ].join('\n');
  return {
    message: `未能确认${scope.conditionLabel} “${scope.topicLabel}” 的可规范化论文记录；已生成中文报告 artifact，说明最新论文列表为空、PDF/全文不可得原因、证据位置限制、关键结论、局限性和下一步建议。`,
    confidence: 0.45,
    claimType: 'literature-survey',
    evidenceLevel: 'provider-grounded-empty-result',
    reasoningTrace: `${failureReason}\nProvider fallback unavailable: ${unavailableReason}`,
    claims: [{
      statement: 'Provider fallback returned no normalized literature records for the requested query.',
      confidence: 0.45,
      evidenceRefs: ['runtime://web-worker/web_search'],
    }],
    uiManifest: [
      { componentId: 'paper-card-list', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', artifactRef: 'evidence-matrix', priority: 2 },
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 3 },
      { componentId: 'notebook-timeline', artifactRef: 'notebook-timeline', priority: 4 },
    ],
    executionUnits: [{
      id: 'literature-generation-failure-provider-empty-result',
      status: 'done',
      tool: 'sciforge.web-worker.web_search',
      summary: `Called web_search after AgentServer generation failed; no normalized literature records were returned for query: ${query}.`,
      recoverActions: ['Retry with a wider date window or alternate topic terms, then run PDF extraction.'],
    }],
    artifacts: [
      { id: 'paper-list', type: 'paper-list', data: [] },
      { id: 'evidence-matrix', type: 'evidence-matrix', data: { rows: [] } },
      { id: 'research-report', type: 'research-report', data: { markdown: report } },
      {
        id: 'notebook-timeline',
        type: 'notebook-timeline',
        data: {
          events: [
            { kind: 'provider-search', title: 'Provider search returned no normalized papers', summary: unavailableReason, artifactRef: 'artifact:research-report' },
            { kind: 'report', title: 'Chinese no-result report generated', summary: 'Report includes unavailable note, evidence-location limits, conclusions, limitations, and next steps.', artifactRef: 'artifact:research-report' },
          ],
        },
      },
    ],
    displayIntent: { status: 'completed', taskOutcome: 'satisfied', primaryView: 'answer' },
    objectReferences: [
      { kind: 'artifact', ref: 'artifact:research-report' },
      { kind: 'artifact', ref: 'artifact:paper-list' },
      { kind: 'artifact', ref: 'artifact:evidence-matrix' },
      { kind: 'artifact', ref: 'artifact:notebook-timeline' },
    ],
  };
}

function flattenLiteratureRecords(value: unknown, limit: number): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (records.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    if (['title', 'name', 'citation', 'doi', 'url', 'link', 'abstract', 'snippet', 'summary'].some((key) => key in node)) {
      records.push(node);
    }
    for (const key of ['results', 'items', 'papers', 'records', 'data', 'documents', 'hits']) {
      const child = node[key];
      if (Array.isArray(child) || isRecord(child)) visit(child);
    }
  };
  visit(value);
  return records.slice(0, limit);
}

function normalizeLiteratureRows(records: Record<string, unknown>[]) {
  return records.slice(0, 8).map((record, index) => {
    const title = firstString(record, ['title', 'name', 'citation']) || `Candidate paper ${index + 1}`;
    const url = firstString(record, ['url', 'link', 'sourceUrl', 'pdfUrl', 'fullTextUrl']);
    const pdfUrl = firstString(record, ['pdfUrl', 'pdf', 'fullTextUrl']) || inferPdfUrl(url);
    const summary = firstString(record, ['abstract', 'snippet', 'summary', 'description'])
      || 'Provider returned no abstract/snippet; inspect source before using as evidence.';
    return {
      id: `paper-${index + 1}`,
      title,
      authors: authorsText(record.authors),
      year: firstString(record, ['year', 'publicationYear', 'date', 'published']),
      venue: firstString(record, ['journal', 'venue', 'source', 'publisher']),
      doi: firstString(record, ['doi', 'DOI']),
      url,
      pdfUrl,
      summary: summary.slice(0, 700),
      fullTextStatus: pdfUrl
        ? `PDF/full-text candidate URL inferred from source: ${pdfUrl}`
        : literatureProviderMetadataMissingFullTextStatus(),
      evidenceLocation: url || 'Provider metadata had no source URL.',
      limitations: 'Provider-grounded recovery package; citation/full-text verification should be run before strong scientific claims.',
    } as Record<string, unknown>;
  });
}

function pdfUrlFromFetchOutput(fetchOutput: Record<string, unknown>, finalUrl: string, row: Record<string, unknown>) {
  const fromRow = stringValue(row.pdfUrl);
  if (fromRow) return fromRow;
  const links = Array.isArray(fetchOutput.links) ? fetchOutput.links.filter(isRecord) : [];
  for (const link of links) {
    const linkUrl = stringValue(link.url) || stringValue(link.href);
    const linkText = `${stringValue(link.text)} ${stringValue(link.title)} ${linkUrl}`.toLowerCase();
    if (linkUrl && (linkText.includes('pdf') || /\.pdf(?:$|[?#])/i.test(linkUrl) || /arxiv\.org\/pdf\//i.test(linkUrl))) return linkUrl;
  }
  return inferPdfUrl(finalUrl);
}

function firstEvidenceLocation(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    const first = value.map(stringValue).find(Boolean);
    if (first) return first;
  }
  const direct = stringValue(value);
  return direct || fallback;
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return '';
}

function authorsText(value: unknown) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).slice(0, 4).join(', ');
  return stringValue(value);
}

function inferPdfUrl(url: string) {
  if (!url) return '';
  const arxivMatch = url.match(/^https?:\/\/arxiv\.org\/abs\/([^?#]+)/i);
  if (arxivMatch) return `https://arxiv.org/pdf/${arxivMatch[1]}.pdf`;
  return /\.pdf(?:$|[?#])/i.test(url) ? url : '';
}

function markdownLiteratureTable(rows: Record<string, unknown>[]) {
  const headers = ['title', 'year', 'venue', 'url', 'fullTextStatus', 'evidenceLocation', 'summary', 'limitations'];
  const lines = [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => stringValue(row[header]).replace(/\n/g, ' ').replace(/\|/g, '/').slice(0, 900)).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function shouldUseLiteratureMetadataRecoveryAdapter(request: GatewayRequest) {
  const text = `${request.skillDomain ?? ''} ${request.prompt ?? ''} ${(request.expectedArtifactTypes ?? []).join(' ')}`.toLowerCase();
  return /\bliterature\b|paper-list|research-report|evidence-matrix|full[-\s]?text|pdf|论文|文献|全文/.test(text);
}

export function literatureDirectPayloadRecoveryReason(request: GatewayRequest, payload: ToolPayload) {
  if (!shouldUseLiteratureMetadataRecoveryAdapter(request)) return undefined;
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const statusFields = [
    stringValue(displayIntent.status),
    stringValue(displayIntent.taskOutcome),
    stringValue(displayIntent.protocolStatus),
    stringValue(payload.evidenceLevel),
    stringValue(payload.claimType),
  ].join(' ');
  const text = [
    payload.message,
    payload.reasoningTrace,
    JSON.stringify(payload.claims ?? []),
    JSON.stringify(payload.artifacts ?? []),
    JSON.stringify(payload.objectReferences ?? []),
  ].map(stringValue).join('\n');
  const admitsMissingWork = /partial|needs[-\s]?work|unverified|budget exhausted|budget limit|cannot fetch|cannot retrieve|cannot generate|repair\/expand|full texts? unavailable|pdf\/full[-\s]?text notes unavailable|placeholder|example\.com|缺少|未完成|无法(?:抓取|生成|检索)|全文.*(?:不可用|未确认)/i.test(`${statusFields}\n${text}`);
  const hasExpectedDeliverables = generatedTaskLiteratureDeliverablesExpected({
    requestText: request.prompt,
    uiManifest: payload.uiManifest,
    artifacts: payload.artifacts,
  });
  if (!admitsMissingWork || !hasExpectedDeliverables) return undefined;
  return [
    'AgentServer direct ToolPayload was literature-shaped but explicitly incomplete.',
    `status/evidence fields: ${statusFields.trim() || 'none'}.`,
    'SciForge is running bounded provider recovery instead of presenting placeholder or budget-limit output as the final deliverable.',
  ].join(' ');
}
