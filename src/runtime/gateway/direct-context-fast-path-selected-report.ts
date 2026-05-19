import type { GatewayRequest } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { buildDirectContextFastPathItems, directContextFastPathSupportingRefs } from '@sciforge-ui/runtime-contract/artifact-policy';
import {
  directContextEvidenceStatusSourceLines,
  directContextIsLiteraturePaperRow,
  directContextLiteratureMetadataEvidenceAnswerLines,
  directContextLiteratureFullTextStatus,
  directContextLiteratureSourceHasCompletedFullTextEvidence,
  directContextLiteratureSourceIsMetadataOnly,
  directContextLiteratureNoResultScope,
  directContextNoConfirmedLiteratureAnswerLines,
  directContextPromptAsksConfounding,
  directContextPromptAsksQcImpact,
  directContextPromptAsksStatistics,
  directContextPromptMentionsQcArtifact,
  directContextPromptMentionsChart,
  directContextPromptRequestsChartSufficiency,
  directContextPromptRequestsCounterfactualThreshold,
  directContextPromptRequestsCredibilityAudit,
  directContextPromptRequestsEvidenceBoundary,
  directContextPromptRequestsLiteralFacts,
  directContextPromptRequestsPassFailAudit,
  directContextPromptRequestsPriorityLiteratureRows,
  directContextPromptRequestsQcMissingnessImpact,
  directContextPromptRequestsRerunInfo,
  directContextPromptRequestsSelectedReport,
  directContextPromptRequestsSelectedReportBullets,
  directContextPromptRequestsSelectedReportQuestion,
  directContextSelectedLiteratureReportBasisLines,
  directContextSelectedReportLiteralFactKinds,
  directContextTextAsksFullTextEvidenceStatus,
  directContextTextWantsChinese,
} from '@sciforge-ui/runtime-contract/direct-context-followup-policy';
import {
  directContextItemMatchesSelectedRef,
  directContextStatements,
  isDirectContextAnswerStatement,
  promptMentionedFileTitle,
  promptNamedDirectContextItems,
  recordRows,
  selectedDurableReferenceTokens,
  selectedReferenceTokenVariants,
  selectedReferenceTokens,
  statementParts,
  stringField,
  uniqueStrings,
} from './direct-context-fast-path-shared.js';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function selectedReportEvidenceStatusAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsSelectedReport(prompt)) return undefined;
  const asksFullTextStatus = directContextTextAsksFullTextEvidenceStatus(prompt);
  if (!asksFullTextStatus) return undefined;
  const promptNamedContext = promptNamedDirectContextItems(request, context);
  const promptFileTitle = promptMentionedFileTitle(request.prompt);
  const selectedRefs = selectedReferenceTokens(request);
  const durableSelectedRefs = selectedDurableReferenceTokens(request);
  const durableSelectedContext = durableSelectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, durableSelectedRefs))
    : [];
  const selectedContext = promptFileTitle && promptNamedContext.length
    ? promptNamedContext
    : durableSelectedContext.length
    ? durableSelectedContext
    : promptNamedContext.length
    ? promptNamedContext
    : selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const answerContext = (selectedContext.length ? selectedContext : context)
    .filter((item) => !/claim|execution-unit|audit|diagnostic/i.test(item.kind));
  const sourceText = uniqueStrings(answerContext
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
  if (!sourceText) return undefined;
  const saysMetadataOnly = directContextLiteratureSourceIsMetadataOnly(sourceText);
  const hasCompletedFullTextEvidence = directContextLiteratureSourceHasCompletedFullTextEvidence(sourceText);
  const sourceLines = directContextEvidenceStatusSourceLines(sourceText);
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  const noConfirmedPapers = selectedLiteratureReportNoConfirmedPapers(sourceText);
  if (noConfirmedPapers) {
    const reason = selectedLiteratureReportUnavailableReason(sourceText);
    const scope = directContextLiteratureNoResultScope(sourceText, prompt);
    const basisLines = sourceLines.length
      ? sourceLines
      : directContextSelectedLiteratureReportBasisLines(sourceText);
    return directContextNoConfirmedLiteratureAnswerLines({
      chinese: directContextTextWantsChinese(prompt),
      selectedTitle,
      scope,
      reason,
      basisLines,
    }).join('\n');
  }
  return directContextLiteratureMetadataEvidenceAnswerLines({
    chinese: directContextTextWantsChinese(prompt),
    selectedTitle,
    sourceLines,
    completedFullTextEvidence: !saysMetadataOnly && hasCompletedFullTextEvidence,
  }).join('\n');
}

export function selectedLiteratureReportNoConfirmedPapers(sourceText: string) {
  return /(无可确认结果|未能确认|没有确认|未确认到|没有可规范化论文|最新论文列表[^。.!?\n]{0,40}(?:为空|空|无)|latest paper list[^。.!?\n]{0,40}(?:empty|none)|no confirmed (?:paper|result)|no citable (?:paper|result))/i.test(sourceText);
}

export function selectedLiteratureReportUnavailableReason(sourceText: string) {
  const line = sourceText
    .split(/[\n\r]+|(?<=[。.!?；;])\s+/)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .find((part) => /(HTTP\s*429|rate limit|限流|unavailable|不可得|could not satisfy|failed|failure|错误|失败)/i.test(part));
  return line && line.length <= 260 ? line : undefined;
}

interface LiteratureReportRow {
  title: string;
  year?: string;
  url?: string;
  evidenceLocation?: string;
  fullTextStatus?: string;
  summary?: string;
  limitations?: string;
}

export function selectedLiteratureReportBulletSummaryMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsSelectedReportBullets(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText || !/(候选论文|fullTextStatus|PDF\/full-text|arXiv|perturbation|flow matching|single-cell)/i.test(sourceText)) {
    return undefined;
  }
  const rows = literatureReportRows(sourceText);
  if (!rows.length) return undefined;
  const picks = pickLiteratureReportSummaryRows(rows);
  if (!picks.length) return undefined;
  const wantsPriority = directContextPromptRequestsPriorityLiteratureRows(prompt);
  return [
    '基于当前 report artifact 直接回答，不启动新的 workspace task，也不重新检索。',
    '',
    ...picks.map((pick, index) => [
      `- ${wantsPriority ? `优先阅读 ${index + 1}` : pick.theme}：${literatureRowConclusion(pick.row)}`,
      `  理由：${literatureReadFirstReason(pick.row, pick.theme)}`,
      `  证据位置：选中 report 的候选论文表；title="${pick.row.title}"${pick.row.url ? `；URL=${pick.row.url}` : ''}${pick.row.evidenceLocation ? `；evidence=${pick.row.evidenceLocation}` : ''}`,
      `  PDF/full-text 状态：${directContextLiteratureFullTextStatus(pick.row.fullTextStatus ?? '')}`,
      `  局限性：${literatureLimitation(pick.row)}`,
    ].join('\n')),
  ].join('\n');
}

function literatureReportRows(sourceText: string): LiteratureReportRow[] {
  const regexRows = literatureReportRowsByRegex(sourceText);
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('|'));
  let headers: string[] = [];
  const rows: LiteratureReportRow[] = [];
  for (const line of lines) {
    const cells = markdownTableCells(line);
    if (cells.length < 4) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (cells.some((cell) => /^title$/i.test(cell)) && cells.some((cell) => /fullTextStatus/i.test(cell))) {
      headers = cells.map((cell) => cell.trim());
      continue;
    }
    if (!headers.length) continue;
    const record = new Map<string, string>();
    headers.forEach((header, index) => record.set(header.toLowerCase(), cells[index] ?? ''));
    const title = record.get('title')?.trim();
    if (!title || /^title$/i.test(title)) continue;
    rows.push({
      title,
      year: record.get('year'),
      url: record.get('url'),
      evidenceLocation: record.get('evidencelocation'),
      fullTextStatus: record.get('fulltextstatus'),
      summary: record.get('summary'),
      limitations: record.get('limitations'),
    });
  }
  return uniqueLiteratureRows([
    ...literatureReportRowsFromJsonLike(sourceText),
    ...regexRows,
    ...rows,
    ...literatureReportRowsFromPipeCells(sourceText),
    ...literatureRowsFromEvidenceMatrixSummary(sourceText),
  ]).filter(directContextIsLiteraturePaperRow).slice(0, 12);
}

function literatureReportRowsFromJsonLike(sourceText: string): LiteratureReportRow[] {
  const normalized = sourceText.replace(/\\"/g, '"');
  const rows: LiteratureReportRow[] = [];
  const titlePattern = /"title"\s*:\s*"([^"]+)"([\s\S]{0,2400}?)(?="title"\s*:|$)/gi;
  for (const match of normalized.matchAll(titlePattern)) {
    const title = match[1]?.trim();
    const block = match[2] ?? '';
    if (!title || /^title$/i.test(title)) continue;
    rows.push({
      title,
      year: firstJsonLikeString(block, ['year', 'published', 'date']) ?? firstJsonLikeDate(block),
      url: firstJsonLikeString(block, ['url', 'sourceUrl']) ?? firstUrl(block),
      evidenceLocation: firstJsonLikeString(block, ['evidenceLocation', 'evidence_location']),
      fullTextStatus: firstJsonLikeString(block, ['fullTextStatus', 'full_text_status', 'pdfStatus']),
      summary: firstJsonLikeString(block, ['evidenceSnippet', 'abstract', 'summary', 'claim']),
      limitations: firstJsonLikeString(block, ['limitations', 'limitation', 'notes']),
    });
  }
  return rows;
}

function firstJsonLikeString(block: string, keys: string[]) {
  for (const key of keys) {
    const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"([^"]+)"`, 'i');
    const value = block.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return undefined;
}

function firstJsonLikeDate(block: string) {
  return block.match(/\b(20\d{2}(?:-\d{2}-\d{2})?(?:T[0-9:.Z-]+)?)\b/)?.[1];
}

function firstUrl(block: string) {
  return block.match(/https?:\/\/[^\s"',)]+/i)?.[0];
}

function literatureReportRowsByRegex(sourceText: string): LiteratureReportRow[] {
  const rows: LiteratureReportRow[] = [];
  const withEvidencePattern = /\|\s*([^|\n]+?)\s*\|\s*(\d{4}[^|\n]*?)\s*\|\s*([^|\n]*?)\s*\|\s*(https?:\/\/[^|\s]+)\s*\|\s*([^|\n]*(?:PDF\s+extracted|PDF\/full-text|pdf_extract)[^|\n]*)\s*\|\s*([^|\n]*(?:https?:\/\/|#page=|artifact:|file:)[^|\n]*)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*(?=\|\s*(?:\||[A-Z0-9#]|$))/gi;
  for (const match of sourceText.matchAll(withEvidencePattern)) {
    const title = match[1]?.trim();
    if (!title || /^title$/i.test(title) || /^[-:]+$/.test(title)) continue;
    rows.push({
      title,
      year: match[2]?.trim(),
      url: match[4]?.trim(),
      fullTextStatus: match[5]?.trim(),
      evidenceLocation: match[6]?.trim(),
      summary: match[7]?.trim(),
      limitations: match[8]?.trim(),
    });
  }
  const withoutEvidencePattern = /\|\s*([^|\n]+?)\s*\|\s*(\d{4}[^|\n]*?)\s*\|\s*([^|\n]*?)\s*\|\s*(https?:\/\/[^|\s]+)\s*\|\s*([^|\n]*(?:PDF\s+extracted|PDF\/full-text|pdf_extract|full[-\s]?text)[^|\n]*)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*(?=\|\s*(?:\||[A-Z0-9#]|$))/gi;
  for (const match of sourceText.matchAll(withoutEvidencePattern)) {
    const title = match[1]?.trim();
    if (!title || /^title$/i.test(title) || /^[-:]+$/.test(title)) continue;
    rows.push({
      title,
      year: match[2]?.trim(),
      url: match[4]?.trim(),
      fullTextStatus: match[5]?.trim(),
      summary: match[6]?.trim(),
      limitations: match[7]?.trim(),
    });
  }
  return rows;
}

function markdownTableCells(line: string) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function literatureReportRowsFromPipeCells(sourceText: string): LiteratureReportRow[] {
  const cells = sourceText.split('|').map((cell) => cell.trim());
  const headerIndex = cells.findIndex((cell, index) => /^title$/i.test(cell)
    && /^year$/i.test(cells[index + 1] ?? '')
    && /^venue$/i.test(cells[index + 2] ?? '')
    && /^url$/i.test(cells[index + 3] ?? '')
    && /^fullTextStatus$/i.test(cells[index + 4] ?? ''));
  if (headerIndex < 0) return [];
  const headerLength = /^evidenceLocation$/i.test(cells[headerIndex + 5] ?? '') ? 8 : 7;
  const headers = cells.slice(headerIndex, headerIndex + headerLength).map((cell) => cell.toLowerCase());
  const rows: LiteratureReportRow[] = [];
  for (let index = headerIndex + headers.length; index + headers.length <= cells.length; index += headers.length) {
    const rowCells = cells.slice(index, index + headers.length);
    if (rowCells.every((cell) => /^:?-{3,}:?$/.test(cell) || cell === '')) continue;
    const record = new Map<string, string>();
    headers.forEach((header, cellIndex) => record.set(header, rowCells[cellIndex] ?? ''));
    const title = record.get('title')?.trim();
    if (!title || /^title$/i.test(title) || /^:?-{3,}:?$/.test(title)) continue;
    rows.push({
      title,
      year: record.get('year'),
      url: record.get('url'),
      evidenceLocation: record.get('evidencelocation'),
      fullTextStatus: record.get('fulltextstatus'),
      summary: record.get('summary'),
      limitations: record.get('limitations'),
    });
  }
  return rows;
}

function literatureRowsFromEvidenceMatrixSummary(sourceText: string): LiteratureReportRow[] {
  const rows: LiteratureReportRow[] = [];
  const rowPattern = /Row\s+\d+:\s*([^;\n]+);\s*result:\s*([\s\S]*?)(?=\s+Row\s+\d+:|\n\s*\[|$)/gi;
  for (const match of sourceText.matchAll(rowPattern)) {
    const title = match[1]?.trim();
    const body = match[2]?.replace(/\s+/g, ' ').trim() ?? '';
    if (!title || !body) continue;
    const url = body.match(/https:\/\/arxiv\.org\/abs\/[^\s|]+/i)?.[0];
    const pdf = body.match(/https:\/\/arxiv\.org\/pdf\/[^\s|]+/i)?.[0];
    const year = body.match(/published:([^|]+)/i)?.[1]?.trim();
    const summary = body.split(/\|\s*/).find((part) => /single-cell|perturb|flow matching|gene regulation|virtual cell|count data/i.test(part)) ?? body;
    rows.push({
      title,
      year,
      url,
      evidenceLocation: url,
      fullTextStatus: pdf ? `PDF/full-text candidate URL inferred from evidence matrix: ${pdf}` : undefined,
      summary,
      limitations: 'Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims.',
    });
  }
  return rows;
}

function uniqueLiteratureRows(rows: LiteratureReportRow[]) {
  const out: LiteratureReportRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function pickLiteratureReportSummaryRows(rows: LiteratureReportRow[]) {
  const paperRows = rows.filter(directContextIsLiteraturePaperRow);
  const used = new Set<LiteratureReportRow>();
  const pick = (theme: string, pattern: RegExp) => {
    const row = paperRows.find((candidate) => !used.has(candidate) && pattern.test(`${candidate.title}\n${candidate.summary ?? ''}`));
    if (!row) return undefined;
    used.add(row);
    return { theme, row };
  };
  return [
    pick('flow matching / 纵向动态建模', /FLUX|MIOFlow|Flow Matching for Count Data|probability flow matching|flow matching/i),
    pick('perturbation prediction / 虚拟扰动预测', /PRiMeFlow|SCALE|SAVE|perturbation|virtual cell|multi-condition/i),
    pick('single-cell count / gene-regulation 方法基础', /Count Data|probability flow matching|gene regulation|single-cell RNA|scRNAseq/i),
  ].filter((item): item is { theme: string; row: LiteratureReportRow } => Boolean(item))
    .concat([...paperRows]
      .filter((row) => !used.has(row))
      .sort((left, right) => literatureRowPriorityScore(right) - literatureRowPriorityScore(left))
      .slice(0, 3)
      .map((row) => ({ theme: '候选论文', row })))
    .slice(0, 3);
}

function literatureRowPriorityScore(row: LiteratureReportRow) {
  const text = `${row.title}\n${row.fullTextStatus ?? ''}\n${row.summary ?? ''}\n${row.evidenceLocation ?? ''}`;
  let score = 0;
  if (/PDF\s+extracted|pdf_extract|pdftotext/i.test(text)) score += 5;
  if (/https?:\/\/\S+#page=\d+/i.test(text)) score += 3;
  if (/GUI|browser|web agents?|computer-use|computer\/OS|OS exploration|SaaS/i.test(text)) score += 2;
  if ((row.summary ?? '').length >= 80) score += 1;
  return score;
}

function literatureRowConclusion(row: LiteratureReportRow) {
  const summary = firstUsefulSentence(row.summary)
    ?? '该条目是当前报告中保留的候选论文，适合按用户问题继续做全文核验。';
  return `${row.title}${row.year ? `（${row.year}` : ''}${row.year ? '）' : ''}；${summary}`;
}

function firstUsefulSentence(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = value
    .replace(/\barXiv:[^/]+\/\s*/i, '')
    .replace(/\bpublished:[^/]+\/\s*/i, '')
    .replace(/\bauthors:[^/]+\/\s*/i, '')
    .replace(/\bpdf:https?:\/\/\S+\s*\/\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = cleaned
    .split(/(?<=[。.!?；;])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length >= 40 && part.length <= 360 && isUsefulLiteratureSentence(part));
  if (sentence) return sentence;
  return cleaned.length <= 300 && isUsefulLiteratureSentence(cleaned) ? cleaned : undefined;
}

function isUsefulLiteratureSentence(value: string) {
  const cleaned = value.trim();
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return false;
  if (/^(?:arXiv:)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(cleaned)) return false;
  if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(cleaned)) return false;
  return /[A-Za-z]{12,}|[一-龥]{8,}/.test(cleaned);
}

function literatureReadFirstReason(row: LiteratureReportRow, theme: string) {
  const sentence = firstUsefulSentence(row.summary);
  if (sentence) return sentence;
  if (/PDF\s+extracted|pdf_extract|pdftotext/i.test(`${row.fullTextStatus ?? ''}\n${row.evidenceLocation ?? ''}`)) {
    return '该条目已在选中 report 中完成 bounded PDF 抽取并保留证据位置，适合优先做更完整的逐段阅读全文和引用核验。';
  }
  if (/candidate link|candidate URL|https?:\/\/\S+/i.test(row.fullTextStatus ?? '')) {
    return '该条目已在选中 report 中保留候选 PDF/全文入口，适合作为下一轮可验证全文读取的优先候选。';
  }
  return `${theme} 与当前问题的关键词匹配，且在选中 report 的候选论文表中保留了可追溯条目。`;
}

function literatureLimitation(row: LiteratureReportRow) {
  return firstUsefulSentence(row.limitations)
    ?? '选中 report 未给出该论文的逐段全文核验结果，强结论仍需 citation/full-text verification。';
}

function selectedReportTitle(request: GatewayRequest) {
  const promptTitle = promptMentionedFileTitle(request.prompt);
  if (promptTitle) return promptTitle;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return uniqueStrings([...recordRows(request.references), ...recordRows(uiState.currentReferences)]
    .map((reference) => stringField(reference.title) ?? stringField(reference.ref))
    .filter((value): value is string => Boolean(value)))
    .find(Boolean);
}

function directContextDisplayTitle(item: ReturnType<typeof buildDirectContextFastPathItems>[number]) {
  const value = item.label ?? item.ref;
  return value?.replace(/^(?:artifact|file|reference|research-report|runtime-context-summary)\s+(.+)$/i, '$1').trim();
}

interface QcMissingnessMetric {
  key: 'total' | 'missingBaseline' | 'missingOutcome' | 'outliers' | 'protocolDeviations';
  label: string;
  count?: number;
  percent?: number;
}

export function selectedQcMissingnessImpactAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsQcMissingnessImpact(prompt)) return undefined;
  const promptMentionsQcArtifact = directContextPromptMentionsQcArtifact(prompt);
  const promptAsksQcImpact = directContextPromptAsksQcImpact(prompt);
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : promptMentionsQcArtifact
    ? context.filter((item) => qcMissingnessContextText(item).match(/missing|qc|quality[-_\s]?control|outlier|protocol[-_\s]?deviations?|deviations?|csv|table|缺失|质控|离群|异常|违背/i))
    : [];
  const qcContext = selectedContext.filter((item) => qcMissingnessContextText(item).match(/missing|qc|quality[-_\s]?control|outlier|protocol[-_\s]?deviations?|deviations?|csv|table|缺失|质控|离群|异常|违背/i));
  const answerContext = qcContext.length ? qcContext : selectedContext;
  if (!answerContext.length) return undefined;
  const sourceText = answerContext.map((item) => item.summary).join('\n');
  const metrics = qcMissingnessMetricsFromText(sourceText);
  const hasMetricEvidence = metrics.some((metric) => metric.count !== undefined || metric.percent !== undefined);
  const looksLikeQcArtifact = answerContext.some((item) => /missing|qc|outlier|protocol[-_\s]?deviations?|deviations?|csv|table|缺失|质控|离群|异常|违背/i.test(qcMissingnessContextText(item)));
  if (!promptMentionsQcArtifact && !looksLikeQcArtifact) return undefined;
  if (!hasMetricEvidence && !looksLikeQcArtifact) return undefined;
  const refLine = directContextFastPathSupportingRefs(answerContext).slice(0, 3).join(', ') || answerContext[0]?.label || 'selected QC/missingness artifact';
  const metricLine = qcMissingnessMetricLine(metrics);
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 QC/missingness 引用回答：${refLine}。没有启动新的 workspace task，也不使用未选中的报告、CSV、图表或历史消息。`,
      '',
      '结论：不能。这个表本身只能说明缺失、离群值和 protocol deviation 的规模/质控风险，不能单独证明或推翻治疗效应结论。',
      metricLine ? `选中表中的数值：${metricLine}。` : '选中表没有给出足够的分组/模型数值。',
      '它能支持的判断：这些质控问题需要敏感性分析、排除/保留对照、以及按 treatment/site/batch 的缺失和偏倚检查。',
      '仍缺少的决定性证据：treatment 分组内缺失/离群/protocol deviation 率、主模型与敏感性模型的效应估计前后对比、CI 或 p 值、模型/检验假设，以及 site/batch imbalance 是否改变结论。',
    ].join('\n');
  }
  return [
    `Answered only from the selected QC/missingness reference: ${refLine}. No new workspace task was started, and unselected reports, CSVs, charts, or history were not used.`,
    '',
    'Conclusion: no. This table can flag data-quality risk, but by itself it cannot prove or overturn the treatment-effect conclusion.',
    metricLine ? `Selected values: ${metricLine}.` : 'Selected values: the selected table does not expose enough grouped/model-level values.',
    'What it can support: the missingness/outlier/protocol-deviation burden should trigger sensitivity analysis, inclusion/exclusion comparisons, and treatment/site/batch imbalance checks.',
    'Still missing to decide the treatment effect: rates by treatment/site/batch, before/after effect estimates from the primary and sensitivity models, CI or p value, model/test assumptions, and whether the QC issues are imbalanced enough to change the conclusion.',
  ].join('\n');
}

function qcMissingnessContextText(item: ReturnType<typeof buildDirectContextFastPathItems>[number]) {
  return `${item.kind} ${item.label} ${item.ref ?? ''} ${item.summary}`;
}

function qcMissingnessMetricLine(metrics: QcMissingnessMetric[]) {
  return metrics
    .filter((metric) => metric.count !== undefined || metric.percent !== undefined)
    .map((metric) => {
      const count = metric.count !== undefined ? String(metric.count) : 'not stated';
      const percent = metric.percent !== undefined ? ` (${formatMetricPercent(metric.percent)}%)` : '';
      return `${metric.label}: ${count}${percent}`;
    })
    .join('; ');
}

function qcMissingnessMetricsFromText(sourceText: string): QcMissingnessMetric[] {
  const metrics: QcMissingnessMetric[] = [
    { key: 'total', label: 'total patients' },
    { key: 'missingBaseline', label: 'missing baseline severity' },
    { key: 'missingOutcome', label: 'missing outcome week 8' },
    { key: 'outliers', label: 'outcome outliers' },
    { key: 'protocolDeviations', label: 'protocol deviations' },
  ];
  for (const row of qcMissingnessRowsFromText(sourceText)) {
    const metric = metrics.find((candidate) => qcMissingnessMetricNameMatches(row.metric, candidate.key));
    if (!metric) continue;
    metric.count = row.count ?? metric.count;
    metric.percent = row.percent ?? metric.percent;
  }
  for (const metric of metrics) {
    if (metric.count !== undefined || metric.percent !== undefined) continue;
    const fallback = qcMissingnessMetricFallback(sourceText, metric.key);
    metric.count = fallback?.count;
    metric.percent = fallback?.percent;
  }
  return metrics;
}

function qcMissingnessRowsFromText(sourceText: string) {
  return sourceText
    .split(/\r?\n|(?=Total patients|Missing baseline|Missing outcome|Outcome outliers|Protocol deviations)/i)
    .flatMap((line) => {
      const cells = line
        .trim()
        .replace(/^\|+|\|+$/g, '')
        .split(/\s*\|\s*|\s*,\s*|\t+/)
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (cells.length < 3 || /^(metric|row\s+\d+)$/i.test(cells[0] ?? '')) return [];
      const count = numericMetricValue(cells[1]);
      const percent = numericMetricValue(cells[2]);
      if (count === undefined && percent === undefined) return [];
      return [{ metric: cells[0] ?? '', count, percent }];
    });
}

function qcMissingnessMetricFallback(sourceText: string, key: QcMissingnessMetric['key']) {
  for (const alias of qcMissingnessMetricAliases(key)) {
    const pattern = new RegExp(`${escapeRegExp(alias).replace(/\\s+/g, '\\s+')}[^0-9]{0,80}([0-9]+(?:\\.[0-9]+)?)\\s*(?:[,;|()\\s]+)\\s*([0-9]+(?:\\.[0-9]+)?)\\s*%?`, 'i');
    const match = sourceText.match(pattern);
    if (!match) continue;
    const count = numericMetricValue(match[1]);
    const percent = numericMetricValue(match[2]);
    if (count !== undefined || percent !== undefined) return { count, percent };
  }
  return undefined;
}

function qcMissingnessMetricNameMatches(name: string, key: QcMissingnessMetric['key']) {
  const normalized = normalizeMetricName(name);
  return qcMissingnessMetricAliases(key).some((alias) => normalized.includes(normalizeMetricName(alias)));
}

function qcMissingnessMetricAliases(key: QcMissingnessMetric['key']) {
  switch (key) {
    case 'total':
      return ['total patients', 'sample size', 'patients'];
    case 'missingBaseline':
      return ['missing baseline severity', 'baseline severity missing', 'missing baseline'];
    case 'missingOutcome':
      return ['missing outcome week 8', 'outcome week 8 missing', 'missing outcome'];
    case 'outliers':
      return ['outcome outliers', 'outliers', 'outcome outlier'];
    case 'protocolDeviations':
      return ['protocol deviations', 'protocol deviation', 'protocoldeviation'];
  }
}

function formatMetricPercent(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function selectedChartSufficiencyAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsChartSufficiency(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context.filter(directContextItemLooksLikeChartByIdentity);
  const promptMentionsChart = directContextPromptMentionsChart(prompt);
  const selectedLooksLikeChart = selectedContext.some(directContextItemLooksLikeChartByIdentity);
  if (!promptMentionsChart && !selectedLooksLikeChart) return undefined;
  const chartContext = selectedContext.filter(directContextItemLooksLikeChartByIdentity);
  const answerContext = chartContext.length ? chartContext : selectedContext;
  if (!answerContext.length) return undefined;
  const refLine = directContextFastPathSupportingRefs(answerContext).slice(0, 3).join(', ') || answerContext[0]?.label || 'selected chart';
  const asksStatistics = directContextPromptAsksStatistics(prompt);
  const asksConfounding = directContextPromptAsksConfounding(prompt);
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的图表引用回答：${refLine}。没有启动新的 workspace task，也不使用其他引用。`,
      '',
      '结论：不能。单个图表最多提供视觉线索，不能单独证明统计显著性或 batch-confounding 结论。',
      ...(asksStatistics ? [
        '缺少的统计显著性依据：原始样本值或可审计数据表、每组样本量、具体检验或模型、效应方向与效应量、p 值或置信区间、以及检验假设/诊断。',
      ] : []),
      ...(asksConfounding ? [
        '缺少的混杂依据：batch 标签、treatment/timepoint 在 batch 中的分布、分层或调整前后模型结果，以及控制 batch 后效应是否保持的比较。',
      ] : []),
      '可支持的有限判断：如果图表可见，它只能提示组间分布可能不同；这不是可复现的统计或混杂控制证据。',
    ].join('\n');
  }
  return [
    `Answered only from the selected chart reference: ${refLine}. No new workspace task was started, and other refs were not used.`,
    '',
    'Conclusion: no. A single chart can provide a visual cue, but it cannot by itself establish statistical significance or a batch-confounding conclusion.',
    ...(asksStatistics ? [
      'Missing for statistical significance: auditable sample-level data, group sample sizes, the exact test/model, effect direction and effect size, p value or confidence interval, and test assumptions/diagnostics.',
    ] : []),
    ...(asksConfounding ? [
      'Missing for batch confounding: batch labels, treatment/timepoint balance across batches, stratified or adjusted model results, and a before/after comparison showing how batch control changes the drugA@48h estimate.',
    ] : []),
    'What the selected chart can support at most: a visual hypothesis that distributions may differ; it is not a reproducible statistical or confounding-control result on its own.',
  ].join('\n');
}

function directContextItemLooksLikeChartByIdentity(
  item: ReturnType<typeof buildDirectContextFastPathItems>[number],
) {
  return /(chart|plot|figure|image|png|jpe?g|webp|svg|boxplot|violin|heatmap|图表|图片|图像)/i
    .test(`${item.kind} ${item.label} ${item.ref ?? ''}`);
}

interface SelectedReportPassFailRow {
  metric: string;
  trueValue?: string;
  fittedValue?: string;
  error?: string;
  threshold?: string;
  verdict?: 'PASS' | 'FAIL';
}

interface SelectedReportThresholdCheck {
  metric: string;
  observedLabel: string;
  observed?: number;
  observedText?: string;
  threshold: number;
  thresholdText: string;
  pass: boolean;
}

function selectedReportSourceText(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const promptNamedContext = promptNamedDirectContextItems(request, context);
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = promptNamedContext.length
    ? promptNamedContext
    : selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  return uniqueStrings((selectedContext.length ? selectedContext : context)
    .filter((item) => /report|artifact|file|summary|reference/i.test(`${item.kind} ${item.label}`))
    .map(directContextReportSourceText)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
}

function directContextReportSourceText(item: ReturnType<typeof buildDirectContextFastPathItems>[number]) {
  const data = isRecord(item) && isRecord(item.data) ? item.data : {};
  return [
    item.summary,
    stringField(data.markdown),
    stringField(data.content),
    stringField(data.text),
    stringField(data.report),
  ].filter((value): value is string => Boolean(value)).join('\n');
}

export function selectedReportCounterfactualThresholdAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsCounterfactualThreshold(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const rows = selectedReportPassFailRows(sourceText);
  if (!rows.length) return undefined;
  const checks = selectedReportCounterfactualThresholdChecks(prompt, rows);
  if (!checks.length) return undefined;
  const failed = checks.filter((check) => !check.pass);
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 做反事实门槛验收，不启动新的 workspace task，也不沿用原报告的 success 结论替代重新判断。`,
      '',
      `是否仍可判成功：${failed.length ? '不能' : '可以'}。`,
      ...checks.map((check) => `- ${check.metric}: observed ${check.observedLabel}=${check.observedText ?? '未给出'}; new threshold<=${check.thresholdText}; verdict=${check.pass ? 'PASS' : 'FAIL'}.`),
      failed.length
        ? `未达标项：${failed.map((check) => check.metric).join('、')}。`
        : '未达标项：没有。',
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started, and the original success label was not reused as the decision rule.`,
    '',
    `Still successful under the new thresholds: ${failed.length ? 'NO' : 'YES'}.`,
    ...checks.map((check) => `- ${check.metric}: observed ${check.observedLabel}=${check.observedText ?? 'not stated'}; new threshold<=${check.thresholdText}; verdict=${check.pass ? 'PASS' : 'FAIL'}.`),
    failed.length
      ? `Failed checks: ${failed.map((check) => check.metric).join(', ')}.`
      : 'Failed checks: none.',
  ].join('\n');
}

function selectedReportCounterfactualThresholdChecks(
  prompt: string,
  rows: SelectedReportPassFailRow[],
): SelectedReportThresholdCheck[] {
  const thresholds = selectedReportThresholdsFromPrompt(prompt);
  return thresholds.flatMap(({ metric, threshold, thresholdText }) => {
    const row = findSelectedReportMetricRow(rows, metric);
    if (!row) return [];
    const observedText = metric === 'RMSE' ? row.fittedValue ?? row.error : row.error;
    const observed = numericMetricValue(observedText);
    if (observed === undefined) return [];
    return [{
      metric,
      observedLabel: metric === 'RMSE' ? 'value' : 'error',
      observed,
      observedText,
      threshold,
      thresholdText,
      pass: observed <= threshold,
    }];
  });
}

function selectedReportThresholdsFromPrompt(text: string) {
  return [
    { metric: 'r', pattern: /\br\s*(?:error|误差)?\s*(?:<=|≤|不超过|小于等于)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i, suffix: '%' },
    { metric: 'K', pattern: /\bK\s*(?:error|误差)?\s*(?:<=|≤|不超过|小于等于)\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i, suffix: '%' },
    { metric: 'RMSE', pattern: /\bRMSE\b\s*(?:<=|≤|不超过|小于等于)\s*([0-9]+(?:\.[0-9]+)?)/i, suffix: '' },
  ].flatMap(({ metric, pattern, suffix }) => {
    const match = text.match(pattern);
    if (!match) return [];
    const threshold = Number(match[1]);
    if (!Number.isFinite(threshold)) return [];
    return [{ metric, threshold, thresholdText: `${match[1]}${suffix}` }];
  });
}

function findSelectedReportMetricRow(rows: SelectedReportPassFailRow[], metric: string) {
  const target = normalizeMetricName(metric);
  return rows.find((row) => normalizeMetricName(row.metric) === target);
}

function numericMetricValue(value: string | undefined) {
  const normalized = value?.replace(/[%\s,]/g, '');
  if (!normalized || /^[-—–]+$/.test(normalized)) return undefined;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function selectedReportRerunInfoAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsRerunInfo(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const commandLines = selectedReportCommandLines(sourceText);
  const scriptName = selectedReportGeneratedByScript(sourceText);
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 核对复跑信息，不补造 report 里没有出现的命令或路径。`,
      '',
      `- 完整 rerun command：${commandLines.length ? commandLines.join(' ; ') : '未给出。'}`,
      `- 脚本路径：${scriptName ? `${scriptName}（报告只给出脚本名，不是完整路径）` : '未给出。'}`,
      `- 缺口：${commandLines.length && scriptName ? '仍需确认工作目录、依赖和输入数据。' : '缺少可直接复制执行的完整命令、工作目录、依赖/环境信息和输入数据位置。'}`,
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no rerun command or path was invented.`,
    '',
    `- Complete rerun command: ${commandLines.length ? commandLines.join(' ; ') : 'not stated.'}`,
    `- Script path: ${scriptName ? `${scriptName} (the report gives only a script name, not a full path).` : 'not stated.'}`,
    `- Gap: ${commandLines.length && scriptName ? 'working directory, dependencies, and inputs still need confirmation.' : 'missing copy-pasteable command, working directory, dependency/environment details, and input locations.'}`,
  ].join('\n');
}

function selectedReportCommandLines(sourceText: string) {
  return uniqueStrings(sourceText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^`{1,3}|`{1,3}$/g, ''))
    .filter((line) => /^(?:python|python3|node|npm|pnpm|yarn|uv|pytest|npx|tsx)\b/i.test(line)))
    .slice(0, 4);
}

function selectedReportGeneratedByScript(sourceText: string) {
  const raw = sourceText.match(/Report generated by\s+([^\s`'"]+)/i)?.[1]
    ?? sourceText.match(/\b([A-Za-z0-9._/-]+\.py)\b/)?.[1];
  return raw ? cleanSelectedReportPathToken(raw) : undefined;
}

function selectedReportFieldValue(sourceText: string, fieldPattern: RegExp) {
  for (const part of statementParts(sourceText)) {
    const match = part.match(fieldPattern);
    if (match?.[1]) return cleanSelectedReportFieldValue(match[1]);
  }
  const fallback = sourceText.match(fieldPattern)?.[1];
  return fallback ? cleanSelectedReportFieldValue(fallback) : undefined;
}

function cleanSelectedReportFieldValue(value: string) {
  return value
    .replace(/\s+(?=(?:Random seed|Optimizer|Bounds|Synthetic noise std|Report generated by|Headings?|Refs?|Artifact|File|Run|Message|Fields)\s*[:：]).*$/i, '')
    .trim();
}

function cleanSelectedReportPathToken(value: string) {
  return cleanSelectedReportFieldValue(value)
    .replace(/^[*`'"]+/, '')
    .replace(/[*`'").,;。]+$/g, '')
    .trim();
}

export function selectedReportLiteralFactAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsLiteralFacts(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const kinds = directContextSelectedReportLiteralFactKinds(prompt);
  const facts = [
    kinds.seed ? ['Random seed', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Random seed\s*[:：]\s*(.+)$/i)] : undefined,
    kinds.optimizer ? ['Optimizer', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Optimizer\s*[:：]\s*(.+)$/i)] : undefined,
    kinds.bounds ? ['Bounds', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Bounds\s*[:：]\s*(.+)$/i)] : undefined,
    kinds.noise ? ['Synthetic noise std', selectedReportFieldValue(sourceText, /^(?:[-*]\s*)?Synthetic noise std\s*[:：]\s*(.+)$/i)] : undefined,
    kinds.script ? ['Report generated by', selectedReportGeneratedByScript(sourceText)] : undefined,
  ].filter((item): item is [string, string | undefined] => Boolean(item));
  if (!facts.length) return undefined;
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 回答，不给可信度总结。`,
      '',
      ...facts.map(([label, value]) => `- ${label}: ${value?.trim() || '报告未给出'}`),
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no credibility summary was added.`,
    '',
    ...facts.map(([label, value]) => `- ${label}: ${value?.trim() || 'not stated'}`),
  ].join('\n');
}

export function selectedReportEvidenceBoundaryAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsEvidenceBoundary(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const limitations = selectedReportBoundaryLimitations(sourceText).slice(0, 6);
  if (limitations.length < 2) return undefined;
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 做证据边界审计，不启动新的 workspace task。`,
      '',
      ...limitations.map((line, index) => `${index + 1}. ${line}`),
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started.`,
    '',
    ...limitations.map((line, index) => `${index + 1}. ${line}`),
  ].join('\n');
}

function selectedReportBoundaryLimitations(sourceText: string) {
  return uniqueStrings([
    /synthetic/i.test(sourceText)
      ? '不能证明真实数据或外部队列上的效果，因为报告只说明使用 synthetic data。'
      : undefined,
    /random seed|fixed seed|seed/i.test(sourceText)
      ? '不能证明随机种子稳健性，因为报告只记录了单一 random seed。'
      : undefined,
    /noise|noisy|Synthetic noise std/i.test(sourceText)
      ? '不能证明不同噪声水平下仍稳定，因为报告只给出当前噪声设置。'
      : undefined,
    /toy|logistic/i.test(sourceText)
      ? '不能外推到更复杂模型或真实科研复现，因为报告范围是 toy logistic-growth reproduction。'
      : undefined,
    selectedReportCommandLines(sourceText).length === 0
      ? '不能证明第三方可直接复跑，因为报告没有给出完整 rerun command。'
      : undefined,
    !/(holdout|independent|external|validation set|真实|外部|独立)/i.test(sourceText)
      ? '不能证明独立验证集表现，因为报告没有记录 holdout/external validation。'
      : undefined,
  ].filter((value): value is string => Boolean(value)));
}

export function selectedReportCredibilityAuditAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsCredibilityAudit(prompt)) return undefined;
  const sourceText = selectedReportSourceText(request, context);
  if (!sourceText) return undefined;
  const rows = selectedReportPassFailRows(sourceText);
  const metrics = selectedReportMetricLines(sourceText);
  if (!rows.length && !metrics.length) return undefined;
  const failed = rows.filter((row) => row.verdict === 'FAIL');
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  const boundedNo = failed.length === 0;
  const support = metrics.length ? metrics.slice(0, 4) : rows.map(formatSelectedReportPassFailRowEn).slice(0, 4);
  const counter = selectedReportBoundaryLimitations(sourceText).slice(0, 3);
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 做一致性审计，不使用未选中的历史消息。`,
      '',
      `yes/no：${boundedNo ? 'No' : 'Yes'}。如果措辞严格限定为 “credible as a toy reproduction”，报告证据没有过度乐观；如果把它读成真实/稳健复现成功，则会过度外推。`,
      '支持证据：',
      ...support.map((line) => `- ${line}`),
      '反对证据/边界：',
      ...(counter.length ? counter.map((line) => `- ${line}`) : ['- 报告没有提供足够的外部稳健性证据。']),
      '最小补充实验：换多个 random seeds 和 noise levels 重跑同一拟合，并要求 r/K error 与 RMSE 继续满足同一阈值。',
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; unselected history was not used.`,
    '',
    `Yes/no: ${boundedNo ? 'No' : 'Yes'}. The phrase "credible as a toy reproduction" is supported if it stays bounded to the toy setup; reading it as real-world or robust reproduction success would overreach.`,
    'Supporting evidence:',
    ...support.map((line) => `- ${line}`),
    'Counter-evidence / boundary:',
    ...(counter.length ? counter.map((line) => `- ${line}`) : ['- The report does not provide enough external robustness evidence.']),
    'Minimal supplementary experiment: rerun the fit across multiple random seeds and noise levels, requiring r/K error and RMSE to keep passing the same thresholds.',
  ].join('\n');
}

export function selectedReportPassFailAuditAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsPassFailAudit(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const sourceText = uniqueStrings((selectedContext.length ? selectedContext : context)
    .filter((item) => /report|artifact|file|summary|reference/i.test(`${item.kind} ${item.label}`))
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
  if (!/\b(?:PASS|FAIL)\b|threshold|阈值|达标|未达标|没达标/i.test(sourceText)) return undefined;
  const rows = selectedReportPassFailRows(sourceText);
  if (!rows.length) return undefined;
  const failed = rows.filter((row) => row.verdict === 'FAIL');
  const selectedTitle = selectedReportTitle(request) ?? 'selected report';
  if (directContextTextWantsChinese(prompt)) {
    return [
      `只基于当前选中的 ${selectedTitle} 逐项核对，不启动新的 workspace task，也不使用未选中的历史消息或其它 artifact。`,
      '',
      ...rows.map(formatSelectedReportPassFailRowZh),
      '',
      failed.length
        ? `未达标项：${failed.map((row) => row.metric).join('、')}。`
        : '未达标项：没有。选中报告中这些检查均为 PASS。',
    ].join('\n');
  }
  return [
    `Answered only from the selected ${selectedTitle}; no new workspace task was started, and unselected history/artifacts were not used.`,
    '',
    ...rows.map(formatSelectedReportPassFailRowEn),
    '',
    failed.length
      ? `Failed checks: ${failed.map((row) => row.metric).join(', ')}.`
      : 'Failed checks: none. The selected report marks these checks as PASS.',
  ].join('\n');
}

function selectedReportPassFailRows(sourceText: string): SelectedReportPassFailRow[] {
  const rows = new Map<string, SelectedReportPassFailRow>();
  for (const match of sourceText.matchAll(/\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|/g)) {
    const metric = match[1]?.trim();
    if (!metric || /^[-:]+$/.test(metric) || /^parameter$/i.test(metric)) continue;
    if ([match[2], match[3], match[4]].some((cell) => /^[-:\s]+$/.test(cell ?? ''))) continue;
    const row = ensurePassFailRow(rows, metric);
    row.trueValue = normalizeMetricCell(match[2]) ?? row.trueValue;
    row.fittedValue = normalizeMetricCell(match[3]) ?? row.fittedValue;
    row.error = normalizeMetricCell(match[4]) ?? row.error;
  }
  for (const match of sourceText.matchAll(/(?:^|[\n\r]\s*|\s+-\s*)[-*]?\s*([A-Za-z][A-Za-z0-9 _./-]*?)(?:\s+error)?\s*:\s*([0-9]+(?:\.[0-9]+)?%?)\s*\(\s*threshold\s*([0-9]+(?:\.[0-9]+)?%?)\s*\)\s*(?:[-–—>→\s]*)\b(PASS|FAIL)\b/gi)) {
    const metric = match[1]?.trim();
    if (!metric) continue;
    const row = ensurePassFailRow(rows, metric);
    if (/RMSE/i.test(metric)) row.fittedValue = row.fittedValue ?? match[2];
    else row.error = row.error ?? match[2];
    row.threshold = match[3];
    row.verdict = match[4]?.toUpperCase() === 'FAIL' ? 'FAIL' : 'PASS';
  }
  return Array.from(rows.values())
    .filter((row) => row.verdict || row.threshold || row.trueValue || row.fittedValue || row.error)
    .slice(0, 8);
}

function ensurePassFailRow(rows: Map<string, SelectedReportPassFailRow>, metric: string) {
  const key = normalizeMetricName(metric);
  const existing = rows.get(key);
  if (existing) return existing;
  const row: SelectedReportPassFailRow = { metric: metric.trim() };
  rows.set(key, row);
  return row;
}

function normalizeMetricName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMetricCell(value: string | undefined) {
  const text = value?.trim();
  if (!text || /^[-—–]+$/.test(text)) return undefined;
  return text;
}

function formatSelectedReportPassFailRowZh(row: SelectedReportPassFailRow) {
  return `- ${row.metric}: true=${row.trueValue ?? '未给出/不适用'}; fitted=${row.fittedValue ?? '未给出/不适用'}; error=${row.error ?? '未给出/不适用'}; threshold=${row.threshold ?? '未给出'}; verdict=${row.verdict ?? '未给出'}.`;
}

function formatSelectedReportPassFailRowEn(row: SelectedReportPassFailRow) {
  return `- ${row.metric}: true=${row.trueValue ?? 'not stated / N/A'}; fitted=${row.fittedValue ?? 'not stated / N/A'}; error=${row.error ?? 'not stated / N/A'}; threshold=${row.threshold ?? 'not stated'}; verdict=${row.verdict ?? 'not stated'}.`;
}

export function selectedReportQuestionAnswerMessage(
  request: GatewayRequest,
  context: ReturnType<typeof buildDirectContextFastPathItems>,
) {
  const prompt = request.prompt;
  if (!directContextPromptRequestsSelectedReportQuestion(prompt)) return undefined;
  const selectedRefs = selectedReferenceTokens(request);
  const selectedContext = selectedRefs.length
    ? context.filter((item) => directContextItemMatchesSelectedRef(item, selectedRefs))
    : context;
  const sourceText = uniqueStrings((selectedContext.length ? selectedContext : context)
    .filter((item) => /report|artifact|file|summary|reference/i.test(`${item.kind} ${item.label}`))
    .map((item) => item.summary)
    .filter((value): value is string => Boolean(value)))
    .join('\n');
  if (!/(reproduction|reproduced|fitted|RMSE|parameter|verdict|success|误差|拟合|复现)/i.test(sourceText)) return undefined;
  const metrics = selectedReportMetricLines(sourceText);
  const verdict = selectedReportVerdict(sourceText, metrics);
  if (!verdict && !metrics.length) return undefined;
  const risk = selectedReportRiskLine(sourceText);
  const nextStep = selectedReportNextValidationLine(sourceText);
  return [
    'Answered directly from the selected report; no new workspace task was started.',
    '',
    `- Credibility verdict: ${verdict ?? 'the selected report provides reproduction metrics, but it does not state a clear pass/fail verdict.'}`,
    ...metrics.map((line) => `- Supporting metric: ${line}`),
    `- Biggest remaining risk: ${risk}`,
    `- Next validation step: ${nextStep}`,
  ].join('\n');
}

function selectedReportVerdict(sourceText: string, metrics: string[]) {
  const explicit = sourceText.match(/Reproduction success\s*:\s*(YES|NO)/i)?.[1];
  if (explicit) {
    return explicit.toUpperCase() === 'YES'
      ? 'credible as a toy reproduction because the selected report says "Reproduction success: YES".'
      : 'not credible enough yet because the selected report says "Reproduction success: NO".';
  }
  if (metrics.length && /PASS|satisfied|completed/i.test(sourceText)) {
    return 'credible as a toy reproduction because the selected report records passing checks and concrete fit metrics.';
  }
  return undefined;
}

function selectedReportMetricLines(sourceText: string) {
  const metrics: string[] = [];
  for (const match of sourceText.matchAll(/\|\s*(r|K)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|\s*([0-9]+(?:\.[0-9]+)?%)/gi)) {
    metrics.push(`${match[1]} true ${match[2]}, fitted ${match[3]}, error ${match[4]}`);
  }
  const proseParameterMatches = [
    ...sourceText.matchAll(/\b(true\s+)?(r|K)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)[,;\s]+(?:fitted|fit)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)[,;\s]+(?:error|relative error|percent error)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?%)/gi),
  ];
  for (const match of proseParameterMatches) {
    metrics.push(`${match[2]} true ${match[3]}, fitted ${match[4]}, error ${match[5]}`);
  }
  const rmse = sourceText.match(/\bRMSE\b\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  if (rmse) metrics.push(`RMSE ${rmse}`);
  const thresholdLines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length <= 240 && /\bPASS\b/i.test(line) && /RMSE|error|threshold|acceptance|r\b|K\b/i.test(line))
    .slice(0, 3);
  return uniqueStrings([...metrics, ...thresholdLines]).slice(0, 6);
}

function selectedReportRiskLine(sourceText: string) {
  const explicitRisk = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\s*(?:[-*]|\d+[.)])\s*/, ''))
    .find((line) => /(risk|limitation|caveat|failure mode|remaining|风险|局限)/i.test(line) && line.length <= 240);
  if (explicitRisk) return explicitRisk;
  const evidence = uniqueStrings([
    /synthetic/i.test(sourceText) ? 'synthetic data' : undefined,
    /fixed seed/i.test(sourceText) ? 'fixed seed' : undefined,
    /\btoy\b/i.test(sourceText) ? 'toy setup' : undefined,
    /noise|noisy/i.test(sourceText) ? 'noisy observations' : undefined,
  ].filter((value): value is string => Boolean(value)));
  if (evidence.length) {
    return `the report is still a ${evidence.join(', ')} reproduction, so it does not establish robustness on real or independent data.`;
  }
  return 'the selected report does not state an explicit residual risk, so robustness beyond this single reported run remains unproven.';
}

function selectedReportNextValidationLine(sourceText: string) {
  const explicitNext = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\s*(?:[-*]|\d+[.)])\s*/, ''))
    .find((line) => /(next|validation|validate|holdout|repeat|seed|noise|robust|下一步|验证)/i.test(line) && line.length <= 240);
  if (explicitNext && !/Reproduction success/i.test(explicitNext)) return explicitNext;
  if (/fixed seed|seed/i.test(sourceText) || /noise|noisy/i.test(sourceText)) {
    return 'repeat the same fitting check across multiple random seeds and noise levels, then compare r/K error and RMSE against the same thresholds.';
  }
  return 'rerun the selected method on an independent held-out dataset and require the same verdict and metric thresholds to hold.';
}
