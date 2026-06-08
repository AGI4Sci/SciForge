import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  BrowserHostDiscoveryInput,
  BrowserHostDiscoveryResult,
  BrowserHostSourcePage,
} from './browser-host-session-types.js';
import { sha1 } from './workspace-task-runner.js';

const SOURCE_PAGE_PREVIEW_MAX = 1_600;
const SOURCE_PAGE_TEXT_MAX = 60_000;
const SOURCE_PAGE_SUMMARY_MAX = 1_600;
const SEARCH_RESULT_LIST_SUMMARY_MAX = 3_800;
const SEARCH_RESULT_ITEM_SUMMARY_MAX = 520;
const HUGGING_FACE_DAILY_PAPER_SUMMARY_MAX = 900;
const OPENAI_CHANGELOG_SUMMARY_MAX = 1_200;

export function browserHostSourcePageLimit(input: BrowserHostDiscoveryInput, searchLimit: number): number {
  const requested = Number.isFinite(input.sourcePageLimit) ? Math.floor(Number(input.sourcePageLimit)) : Math.min(3, searchLimit);
  return Math.max(0, Math.min(5, requested));
}

export async function persistBrowserHostSourcePage(input: {
  sessionId: string;
  sessionDir: string;
  result: BrowserHostDiscoveryResult;
  resultIndex: number;
  finalUrl: string;
  openedAt: string;
  text: string;
  discoveryOnly?: boolean;
  discoveredSourceUrls?: string[];
}): Promise<BrowserHostSourcePage> {
  const sourceText = cleanSourcePageText(input.text);
  const textSummary = sourcePageTextSummary(input.result, sourceText);
  const artifact = sourcePageArtifactText(input.result, sourceText, textSummary);
  const discoveredSourceUrls = uniqueSourceUrls(input.discoveredSourceUrls ?? structuredSummarySourceUrls(textSummary ?? ''));
  const sha = sha1(artifact.text);
  const fileName = join('source-pages', `source-${input.resultIndex + 1}-${sha.slice(0, 10)}.txt`);
  const sourcePageFileName = join('source-pages', `source-${input.resultIndex + 1}-${sha.slice(0, 10)}.source.json`);
  const filePath = join(input.sessionDir, fileName);
  const sourcePageFilePath = join(input.sessionDir, sourcePageFileName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, artifact.text, 'utf8');
  await writeFile(sourcePageFilePath, JSON.stringify({
    schemaVersion: 'sciforge.browser-host-session.source-page.v1',
    resultIndex: input.resultIndex,
    title: cleanSourcePageText(input.result.title),
    url: input.result.url,
    finalUrl: input.finalUrl,
    openedAt: input.openedAt,
    status: 'read',
    ...(input.discoveryOnly ? { discoveryOnly: true } : {}),
    ...(discoveredSourceUrls.length ? { discoveredSourceUrls } : {}),
    textRef: `browser-host-session:${input.sessionId}/${fileName}`,
    textSha1: sha,
  }, null, 2), 'utf8');
  return {
    resultIndex: input.resultIndex,
    title: cleanSourcePageText(input.result.title),
    url: input.result.url,
    finalUrl: input.finalUrl,
    openedAt: input.openedAt,
    status: 'read',
    sourcePageRef: `browser-host-session:${input.sessionId}/${sourcePageFileName}`,
    textRef: `browser-host-session:${input.sessionId}/${fileName}`,
    textPreview: sourcePagePreview(artifact.text),
    ...(textSummary ? { textSummary } : {}),
    ...(artifact.kind !== 'page-text' ? { textArtifactKind: artifact.kind, sourceTextCharCount: sourceText.length } : {}),
    ...(input.discoveryOnly ? { discoveryOnly: true } : {}),
    ...(discoveredSourceUrls.length ? { discoveredSourceUrls } : {}),
    textCharCount: artifact.text.length,
    textSha1: sha,
  };
}

export function browserHostSourcePageDerivedResults(
  sourcePage: BrowserHostSourcePage,
): BrowserHostDiscoveryResult[] {
  return structuredSummarySourceItems(sourcePage.textSummary ?? sourcePage.textPreview ?? '')
    .map((item) => ({
      title: item.title || item.url,
      url: item.url,
      snippet: item.snippet || `Discovered from ${sourcePage.title}`,
    }));
}

export function failedBrowserHostSourcePage(input: {
  result: BrowserHostDiscoveryResult;
  resultIndex: number;
  openedAt: string;
  error: string;
}): BrowserHostSourcePage {
  return {
    resultIndex: input.resultIndex,
    title: cleanSourcePageText(input.result.title),
    url: input.result.url,
    finalUrl: input.result.url,
    openedAt: input.openedAt,
    status: 'failed',
    error: cleanSourcePageText(input.error).slice(0, 500),
  };
}

function normalizeSourcePageText(value: string) {
  return value.length > SOURCE_PAGE_TEXT_MAX ? value.slice(0, SOURCE_PAGE_TEXT_MAX) : value;
}

function sourcePagePreview(value: string) {
  return value.length > SOURCE_PAGE_PREVIEW_MAX ? value.slice(0, SOURCE_PAGE_PREVIEW_MAX) : value;
}

function cleanSourcePageText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function sourcePageArtifactText(
  result: BrowserHostDiscoveryResult,
  sourceText: string,
  textSummary: string | undefined,
): { kind: 'page-text' | 'structured-summary'; text: string } {
  if (isHuggingFaceDailyPapersApi(result) && textSummary) {
    return {
      kind: 'structured-summary',
      text: [
        'Hugging Face Daily Papers API source summary',
        `Source URL: ${cleanSourcePageText(result.url)}`,
        `Source response text length: ${sourceText.length} characters`,
        'Persisted as a structured summary to avoid materializing truncated JSON.',
        '',
        textSummary,
      ].join('\n').trim(),
    };
  }
  if (isOpenAiApiChangelog(result) && textSummary) {
    return {
      kind: 'structured-summary',
      text: [
        'OpenAI API changelog source summary',
        `Source URL: ${cleanSourcePageText(result.url)}`,
        `Source response text length: ${sourceText.length} characters`,
        'Persisted as a structured summary to keep product-update evidence readable.',
        '',
        textSummary,
      ].join('\n').trim(),
    };
  }
  if (isStructuredSearchResultList(result, textSummary)) {
    return {
      kind: 'structured-summary',
      text: [
        `${structuredSearchResultListLabel(result)} source summary`,
        `Source URL: ${cleanSourcePageText(result.url)}`,
        `Source response text length: ${sourceText.length} characters`,
        'Persisted as a structured summary to keep search/listing evidence readable.',
        '',
        textSummary,
      ].join('\n').trim(),
    };
  }
  return { kind: 'page-text', text: normalizeSourcePageText(sourceText) };
}

function sourcePageTextSummary(result: BrowserHostDiscoveryResult, text: string): string | undefined {
  if (isOpenAiApiChangelog(result)) return openAiApiChangelogSummary(text);
  if (isArxivSearchResultPage(result)) return arxivSearchResultSummary(text);
  if (isArxivAbsPage(result)) return arxivAbsPageSummary(result, text);
  if (!isHuggingFaceDailyPapersApi(result)) return undefined;
  const papers = huggingFaceDailyPaperItems(text).slice(0, 3);
  if (!papers.length) {
    if (dailyPapersJsonReturnedNoItems(text)) {
      const date = dailyPapersDateFromUrl(result.url);
      return `Hugging Face Daily Papers API returned no entries${date ? ` for ${date}` : ''}.`;
    }
    return undefined;
  }
  return joinCompleteSummaries(papers
    .map((paper, index) => formatHuggingFaceDailyPaperSummary(paper, index + 1))
    .filter(Boolean), SOURCE_PAGE_SUMMARY_MAX);
}

function isStructuredSearchResultList(result: BrowserHostDiscoveryResult, textSummary: string | undefined): boolean {
  return Boolean(textSummary) && isArxivSearchResultPage(result);
}

function structuredSearchResultListLabel(result: BrowserHostDiscoveryResult): string {
  if (isArxivSearchResultPage(result)) return 'arXiv search result';
  return 'Search result list';
}

function isArxivSearchResultPage(result: BrowserHostDiscoveryResult): boolean {
  return /^https:\/\/arxiv\.org\/search\?/i.test(result.url.trim())
    || (/arxiv/i.test(result.title) && /search/i.test(result.title));
}

function isArxivAbsPage(result: BrowserHostDiscoveryResult): boolean {
  return /^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{4,5}/i.test(result.url.trim());
}

interface ArxivSearchItem {
  id: string;
  categories: string;
  title: string;
  authors: string;
  abstract: string;
  submitted: string;
  announced?: string;
  comments?: string;
}

function arxivSearchResultSummary(text: string): string | undefined {
  const items = arxivSearchResultItems(text).slice(0, 6);
  if (!items.length) return arxivSearchResultEmptySummary(text);
  const heading = arxivSearchResultHeading(text);
  return joinCompleteSummaries([
    heading,
    ...items.map((item, index) => formatArxivSearchItemSummary(item, index + 1)),
  ].filter((item): item is string => Boolean(item)), SEARCH_RESULT_LIST_SUMMARY_MAX);
}

function arxivSearchResultItems(text: string): ArxivSearchItem[] {
  const normalized = cleanSourcePageText(text).replace(/\s*▽\s*More\s*/g, ' ');
  const items: ArxivSearchItem[] = [];
  const itemPattern = /\barXiv:(\d{4}\.\d{4,5})(?:v\d+)?\s+\[[^\]]+\]\s+((?:(?:[a-z]+(?:-[a-z]+)?|q-fin)\.[A-Za-z0-9.-]+(?:\s+|$))+)(.+?)\s+Authors:\s+(.+?)\s+Abstract:\s+(.+?)\s+Submitted\s+(\d{1,2}\s+[A-Za-z]+,\s+\d{4})(?:;\s+originally announced\s+([^.\n]+)\.)?(?:\s+Comments:\s+(.+?))?(?=\s+arXiv:\d{4}\.\d{4,5}|\s+Next\s+\d|\s+Search v\d|$)/g;
  for (const match of normalized.matchAll(itemPattern)) {
    const item = {
      id: cleanSourcePageText(match[1] ?? ''),
      categories: cleanSourcePageText(match[2] ?? ''),
      title: cleanSourcePageText(match[3] ?? ''),
      authors: cleanSourcePageText(match[4] ?? ''),
      abstract: cleanSourcePageText(match[5] ?? ''),
      submitted: cleanSourcePageText(match[6] ?? ''),
      announced: cleanSourcePageText(match[7] ?? ''),
      comments: cleanSourcePageText(match[8] ?? ''),
    };
    if (item.id && item.title && item.authors) items.push(item);
  }
  return items;
}

function formatArxivSearchItemSummary(item: ArxivSearchItem, index: number): string {
  const details = [
    item.categories ? `categories: ${item.categories}` : undefined,
    item.authors ? `authors: ${truncateAtWord(item.authors, 180)}` : undefined,
    item.submitted ? `submitted: ${item.submitted}` : undefined,
    item.announced ? `announced: ${item.announced}` : undefined,
    item.comments ? `comments: ${truncateAtWord(item.comments, 120)}` : undefined,
  ].filter(Boolean).join('; ');
  const conclusion = truncateAtWord(item.abstract, SEARCH_RESULT_ITEM_SUMMARY_MAX);
  return `${index}. ${item.title} (${details}; link: https://arxiv.org/abs/${item.id}): ${conclusion}`;
}

function structuredSummarySourceItems(text: string): Array<{ title: string; url: string; snippet: string }> {
  const normalized = cleanSourcePageText(text);
  if (!normalized || !/\blink:\s+https?:\/\//i.test(normalized)) return [];
  const items: Array<{ title: string; url: string; snippet: string }> = [];
  const detailPattern = /\(([^)]*?\blink:\s+https?:\/\/[^\s;)]+[^)]*)\):/gi;
  let searchFrom = 0;
  for (const detailMatch of normalized.matchAll(detailPattern)) {
    const detailStart = detailMatch.index ?? 0;
    const detailEnd = detailStart + detailMatch[0].length;
    const beforeDetails = normalized.slice(searchFrom, detailStart);
    const markerMatches = [...beforeDetails.matchAll(/(?:^|\s)(\d{1,2})\.\s+/g)];
    const markerMatch = markerMatches.at(-1);
    if (!markerMatch) {
      searchFrom = detailEnd;
      continue;
    }
    const markerStart = searchFrom + (markerMatch.index ?? 0);
    const contentStart = markerStart + markerMatch[0].length;
    const title = cleanSourcePageText(normalized.slice(contentStart, detailStart));
    const details = detailMatch[1] ?? '';
    const url = sourcePageStructuredDetailField(details, 'link');
    if (title && url) {
      items.push({
        title,
        url,
        snippet: cleanSourcePageText(normalized.slice(detailEnd, Math.min(normalized.length, detailEnd + 260))),
      });
    }
    searchFrom = detailEnd;
  }
  return uniqueSourceItems(items);
}

function structuredSummarySourceUrls(text: string): string[] {
  return uniqueSourceUrls(structuredSummarySourceItems(text).map((item) => item.url));
}

function sourcePageStructuredDetailField(details: string, field: string): string | undefined {
  const pattern = new RegExp(String.raw`(?:^|;\s*)${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\s*([^;]+)`, 'iu');
  const value = cleanSourcePageText(pattern.exec(details)?.[1] ?? '');
  return value && /^https?:\/\//i.test(value) ? value.replace(/[),.;]+$/, '') : undefined;
}

function uniqueSourceItems(items: Array<{ title: string; url: string; snippet: string }>) {
  const seen = new Set<string>();
  const out: Array<{ title: string; url: string; snippet: string }> = [];
  for (const item of items) {
    const key = item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function uniqueSourceUrls(urls: string[]) {
  return [...new Set(urls
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .map((url) => url.replace(/[),.;]+$/, '')))];
}

function arxivSearchResultHeading(text: string): string | undefined {
  const normalized = cleanSourcePageText(text);
  const match = /\bShowing\s+(\d+\s*[–-]\s*\d+\s+of\s+[\d,]+\s+results\s+for\s+[^.]+?)(?=\s+Search term|\s+Show abstracts|\s+Sort results|\s+Go\s+Next|\s+arXiv:|$)/i.exec(normalized);
  return match ? `arXiv search page reports: ${cleanSourcePageText(match[1] ?? '')}.` : undefined;
}

function arxivSearchResultEmptySummary(text: string): string | undefined {
  const normalized = cleanSourcePageText(text);
  if (/No results/i.test(normalized)) return 'arXiv search page reports no matching results.';
  return arxivSearchResultHeading(normalized);
}

function arxivAbsPageSummary(result: BrowserHostDiscoveryResult, text: string): string | undefined {
  const normalized = cleanSourcePageText(text);
  const id = arxivIdFromUrl(result.url);
  const readableParts = arxivAbsReadablePageParts(normalized);
  const title = arxivAbsTitle(normalized) || readableParts.title || cleanSourcePageText(result.title).replace(/\s*\|\s*arXiv.*$/i, '');
  const authors = arxivAbsAuthors(normalized) || readableParts.authors;
  const submitted = arxivAbsSubmitted(normalized);
  const abstract = arxivAbsAbstract(normalized) || readableParts.abstract;
  if (!id || !title || !abstract) return undefined;
  const details = [
    authors ? `authors: ${truncateAtWord(authors, 220)}` : undefined,
    submitted ? `submitted: ${submitted}` : undefined,
    `link: https://arxiv.org/abs/${id}`,
  ].filter(Boolean).join('; ');
  return `1. ${title} (${details}): ${truncateAtWord(abstract, SEARCH_RESULT_ITEM_SUMMARY_MAX)}`;
}

function arxivIdFromUrl(value: string): string | undefined {
  try {
    const match = /^\/abs\/(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(new URL(value).pathname);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function arxivAbsTitle(text: string): string | undefined {
  return cleanSourcePageText(/(?:^|\s)Title:\s*(.+?)\s+Authors?:/i.exec(text)?.[1] ?? '');
}

function arxivAbsAuthors(text: string): string | undefined {
  return cleanSourcePageText(/(?:^|\s)Authors?:\s*(.+?)\s+(?:Abstract:|\[Submitted|Submitted\s+on|Subjects?:|Comments?:)/i.exec(text)?.[1] ?? '');
}

function arxivAbsSubmitted(text: string): string | undefined {
  const submitted = /(?:\[)?Submitted\s+(?:on\s+)?(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/i.exec(text);
  if (!submitted) return undefined;
  const month = fullMonthName(submitted[2]);
  return month ? `${submitted[1]} ${month}, ${submitted[3]}` : cleanSourcePageText(submitted[0]);
}

function arxivAbsAbstract(text: string): string | undefined {
  return cleanSourcePageText(/(?:^|\s)Abstract:\s*(.+?)(?=\s+(?:Subjects?:|Comments?:|Source Code:|Journal-ref:|Submission history|Download:)|$)/i.exec(text)?.[1] ?? '');
}

function arxivAbsReadablePageParts(text: string): { title?: string; authors?: string; abstract?: string } {
  const header = cleanSourcePageText(/\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\b.*?\[Submitted[^\]]+\]\s+(.+?)\s+View\s+PDF\b/i.exec(text)?.[1] ?? '');
  const splitHeader = splitArxivReadableHeader(header);
  return {
    ...splitHeader,
    abstract: arxivAbsReadableAbstract(text),
  };
}

function splitArxivReadableHeader(header: string): { title?: string; authors?: string } {
  if (!header) return {};
  const firstComma = header.indexOf(',');
  if (firstComma > 0) {
    const beforeComma = cleanSourcePageText(header.slice(0, firstComma));
    const afterComma = cleanSourcePageText(header.slice(firstComma + 1));
    const split = splitTitleAndFirstReadableAuthor(beforeComma);
    if (split.title && split.firstAuthor) {
      const authors = cleanSourcePageText([split.firstAuthor, afterComma].filter(Boolean).join(', '));
      return {
        title: split.title,
        ...(authors ? { authors } : {}),
      };
    }
  }
  const authorMatch = /\b[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+,\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+(?:,\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)+)*/.exec(header);
  if (!authorMatch || (authorMatch.index ?? 0) <= 0) return { title: header };
  const title = cleanSourcePageText(header.slice(0, authorMatch.index));
  const authors = cleanSourcePageText(header.slice(authorMatch.index));
  return {
    ...(title ? { title } : {}),
    ...(authors ? { authors } : {}),
  };
}

function splitTitleAndFirstReadableAuthor(value: string): { title?: string; firstAuthor?: string } {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return {};
  const authorTokenCount = readableFirstAuthorTokenCount(tokens);
  const title = cleanSourcePageText(tokens.slice(0, -authorTokenCount).join(' '));
  const firstAuthor = cleanSourcePageText(tokens.slice(-authorTokenCount).join(' '));
  if (!title || !firstAuthor) return {};
  return { title, firstAuthor };
}

function readableFirstAuthorTokenCount(tokens: string[]): number {
  const thirdFromEnd = tokens.at(-3) ?? '';
  const secondFromEnd = tokens.at(-2) ?? '';
  const thirdLooksNameLike = thirdFromEnd.length <= 4 || /^[A-Z]\.?$/i.test(thirdFromEnd) || /^[A-Z]\.?$/i.test(secondFromEnd);
  return tokens.length >= 4 && thirdLooksNameLike ? 3 : 2;
}

function arxivAbsReadableAbstract(text: string): string | undefined {
  const abstract = cleanSourcePageText(/\bView\s+PDF\s+HTML(?:\s+\(experimental\))?\s+(.+?)(?=\s+(?:Comments?:|Subjects?:|Cite as:|Submission history|Download:|Access Paper:)|$)/i.exec(text)?.[1] ?? '');
  return abstract || undefined;
}

function fullMonthName(value: string | undefined): string | undefined {
  const month = (value ?? '').toLowerCase();
  const months: Record<string, string> = {
    jan: 'January',
    january: 'January',
    feb: 'February',
    february: 'February',
    mar: 'March',
    march: 'March',
    apr: 'April',
    april: 'April',
    may: 'May',
    jun: 'June',
    june: 'June',
    jul: 'July',
    july: 'July',
    aug: 'August',
    august: 'August',
    sep: 'September',
    sept: 'September',
    september: 'September',
    oct: 'October',
    october: 'October',
    nov: 'November',
    november: 'November',
    dec: 'December',
    december: 'December',
  };
  return months[month];
}

function isOpenAiApiChangelog(result: BrowserHostDiscoveryResult): boolean {
  const url = result.url.trim();
  const title = result.title.trim();
  return /(^https:\/\/(?:platform|developers)\.openai\.com\/(?:api\/)?docs\/changelog\b)/i.test(url)
    || (/openai/i.test(title) && /changelog/i.test(title));
}

function openAiApiChangelogSummary(text: string): string | undefined {
  const normalized = cleanSourcePageText(text);
  const start = normalized.search(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December),\s+\d{4}\b/);
  const body = start >= 0 ? normalized.slice(start) : normalized;
  const entries: string[] = [];
  const entryPattern = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:Feature|Update|Deprecation|Fix|Preview|Release)\b[\s\S]*?(?=\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:Feature|Update|Deprecation|Fix|Preview|Release)\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December),\s+\d{4}\b|$)/g;
  for (const match of body.matchAll(entryPattern)) {
    const entry = truncateAtWord(cleanSourcePageText(match[0]), 420);
    if (entry) entries.push(entry);
    if (entries.length >= 5) break;
  }
  if (!entries.length) return undefined;
  return joinCompleteSummaries(entries, OPENAI_CHANGELOG_SUMMARY_MAX);
}

function isHuggingFaceDailyPapersApi(result: BrowserHostDiscoveryResult): boolean {
  return /^https:\/\/huggingface\.co\/api\/daily_papers\b/i.test(result.url.trim())
    || (/hugging\s*face/i.test(result.title) && /daily\s*papers/i.test(result.title) && /api/i.test(result.title));
}

interface HuggingFaceDailyPaperSummary {
  title: string;
  authors: string[];
  summary: string;
  publishedAt?: string;
  upvotes?: number;
  numComments?: number;
}

function huggingFaceDailyPaperItems(text: string): HuggingFaceDailyPaperSummary[] {
  const parsed = parseDailyPapersJson(text);
  return parsed.flatMap((value) => {
    if (Array.isArray(value)) return value.map(huggingFaceDailyPaperSummary).filter((item): item is HuggingFaceDailyPaperSummary => Boolean(item));
    if (isRecord(value)) {
      const nested = firstArray(value.dailyPapers, value.papers, value.results, value.items);
      if (nested) return nested.map(huggingFaceDailyPaperSummary).filter((item): item is HuggingFaceDailyPaperSummary => Boolean(item));
      const item = huggingFaceDailyPaperSummary(value);
      return item ? [item] : [];
    }
    return [];
  });
}

function parseDailyPapersJson(text: string): unknown[] {
  try {
    return [JSON.parse(text)];
  } catch {
    const objects = completeTopLevelArrayObjectJson(text).slice(0, 5);
    return objects.flatMap((objectJson) => {
      try {
        return [JSON.parse(objectJson)];
      } catch {
        return [];
      }
    });
  }
}

function dailyPapersJsonReturnedNoItems(text: string): boolean {
  const normalized = cleanSourcePageText(text);
  if (normalized === '[]') return true;
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (isRecord(parsed)) {
      const nested = firstArray(parsed.dailyPapers, parsed.papers, parsed.results, parsed.items);
      return nested !== undefined && nested.length === 0;
    }
  } catch {
    return false;
  }
  return false;
}

function dailyPapersDateFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const date = parsed.searchParams.get('date');
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  } catch {
    return undefined;
  }
}

function completeTopLevelArrayObjectJson(text: string): string[] {
  const objects: string[] = [];
  const start = text.indexOf('[');
  if (start < 0) return objects;
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        objects.push(text.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }
  return objects;
}

function huggingFaceDailyPaperSummary(value: unknown): HuggingFaceDailyPaperSummary | undefined {
  if (!isRecord(value)) return undefined;
  const paper = isRecord(value.paper) ? value.paper : value;
  const title = cleanSourcePageText(stringField(paper.title) || stringField(value.title) || '');
  const summary = cleanSourcePageText(stringField(paper.summary) || stringField(value.summary) || stringField(paper.ai_summary) || '');
  if (!title || !summary) return undefined;
  return {
    title,
    authors: authorNames(paper.authors),
    summary,
    publishedAt: isoDate(stringField(paper.submittedOnDailyAt) || stringField(value.submittedOnDailyAt) || stringField(paper.publishedAt) || stringField(value.publishedAt)),
    upvotes: numberField(paper.upvotes) ?? numberField(value.upvotes),
    numComments: numberField(value.numComments) ?? numberField(paper.numComments),
  };
}

function formatHuggingFaceDailyPaperSummary(paper: HuggingFaceDailyPaperSummary, index: number): string {
  const details = [
    paper.authors.length ? `authors: ${paper.authors.slice(0, 3).join(', ')}${paper.authors.length > 3 ? ', et al.' : ''}` : undefined,
    paper.upvotes !== undefined ? `${paper.upvotes} upvotes` : undefined,
    paper.numComments !== undefined ? `${paper.numComments} comments` : undefined,
    paper.publishedAt ? `date: ${paper.publishedAt}` : undefined,
  ].filter(Boolean).join('; ');
  const summary = truncateAtWord(paper.summary, HUGGING_FACE_DAILY_PAPER_SUMMARY_MAX);
  return `${index}. ${paper.title}${details ? ` (${details})` : ''}: ${summary}`;
}

function joinCompleteSummaries(values: string[], maxLength: number): string {
  const output: string[] = [];
  for (const value of values) {
    const candidate = cleanSourcePageText(value);
    if (!candidate) continue;
    const next = output.length ? `${output.join(' ')} ${candidate}` : candidate;
    if (next.length > maxLength && output.length) break;
    output.push(truncateAtWord(candidate, maxLength));
    if (output.join(' ').length >= maxLength) break;
  }
  return output.join(' ');
}

function truncateAtWord(value: string, maxLength: number): string {
  const text = cleanSourcePageText(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, Math.max(0, maxLength - 3));
  const boundary = slice.lastIndexOf(' ');
  const prefix = boundary >= Math.floor(maxLength * 0.65) ? slice.slice(0, boundary) : slice;
  return `${prefix.trimEnd()}...`;
}

function authorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((author) => {
      if (typeof author === 'string') return cleanSourcePageText(author);
      if (!isRecord(author)) return '';
      return cleanSourcePageText(stringField(author.name) || stringField(isRecord(author.user) ? author.user.name : undefined) || '');
    })
    .filter(Boolean);
}

function firstArray(...values: unknown[]): unknown[] | undefined {
  return values.find((value): value is unknown[] => Array.isArray(value));
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match?.[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
