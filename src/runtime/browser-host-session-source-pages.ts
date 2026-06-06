import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  BrowserHostSearchInput,
  BrowserHostSearchResult,
  BrowserHostSearchSourcePage,
} from './browser-host-session-types.js';
import { sha1 } from './workspace-task-runner.js';

const SOURCE_PAGE_PREVIEW_MAX = 1_600;
const SOURCE_PAGE_TEXT_MAX = 60_000;
const SOURCE_PAGE_SUMMARY_MAX = 1_600;
const HUGGING_FACE_DAILY_PAPER_SUMMARY_MAX = 900;

export function browserHostSearchSourcePageLimit(input: BrowserHostSearchInput, searchLimit: number): number {
  const requested = Number.isFinite(input.sourcePageLimit) ? Math.floor(Number(input.sourcePageLimit)) : Math.min(3, searchLimit);
  return Math.max(0, Math.min(5, requested));
}

export async function persistBrowserHostSearchSourcePage(input: {
  sessionId: string;
  sessionDir: string;
  result: BrowserHostSearchResult;
  resultIndex: number;
  finalUrl: string;
  openedAt: string;
  text: string;
}): Promise<BrowserHostSearchSourcePage> {
  const sourceText = cleanSourcePageText(input.text);
  const textSummary = sourcePageTextSummary(input.result, sourceText);
  const artifact = sourcePageArtifactText(input.result, sourceText, textSummary);
  const sha = sha1(artifact.text);
  const fileName = join('source-pages', `source-${input.resultIndex + 1}-${sha.slice(0, 10)}.txt`);
  const filePath = join(input.sessionDir, fileName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, artifact.text, 'utf8');
  return {
    resultIndex: input.resultIndex,
    title: cleanSourcePageText(input.result.title),
    url: input.result.url,
    finalUrl: input.finalUrl,
    openedAt: input.openedAt,
    status: 'read',
    textRef: `browser-host-session:${input.sessionId}/${fileName}`,
    textPreview: sourcePagePreview(artifact.text),
    ...(textSummary ? { textSummary } : {}),
    ...(artifact.kind !== 'page-text' ? { textArtifactKind: artifact.kind, sourceTextCharCount: sourceText.length } : {}),
    textCharCount: artifact.text.length,
    textSha1: sha,
  };
}

export function failedBrowserHostSearchSourcePage(input: {
  result: BrowserHostSearchResult;
  resultIndex: number;
  openedAt: string;
  error: string;
}): BrowserHostSearchSourcePage {
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
  result: BrowserHostSearchResult,
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
  return { kind: 'page-text', text: normalizeSourcePageText(sourceText) };
}

function sourcePageTextSummary(result: BrowserHostSearchResult, text: string): string | undefined {
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

function isHuggingFaceDailyPapersApi(result: BrowserHostSearchResult): boolean {
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
