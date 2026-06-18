import { XMLParser } from 'fast-xml-parser';

import type { PaperRecord, SyncResult } from './types.js';

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  maxRecords?: number;
}

export interface ArxivSyncRequest {
  categories?: string[];
  since?: string;
  until?: string;
  maxRecords?: number;
}

export interface BiorxivSyncRequest {
  from?: string;
  to?: string;
  server?: 'biorxiv' | 'medrxiv';
  maxRecords?: number;
}

const ARXIV_OAI_URL = 'https://export.arxiv.org/oai2';
const BIORXIV_API_URL = 'https://api.biorxiv.org/details';

const xml = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
});

export async function fetchArxivMetadata(req: ArxivSyncRequest, options: SyncOptions = {}): Promise<{ papers: PaperRecord[]; result: SyncResult }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const since = req.since ?? isoDate(addDays(now(), -1));
  const until = req.until;
  const categories = normalizeCategories(req.categories ?? ['q-bio', 'cs.LG', 'stat.ML']);
  const maxRecords = clampMax(req.maxRecords ?? options.maxRecords, 500);
  const roots = Array.from(
    new Set(
      categories
        .map((category) => category.split('.')[0])
        .filter((category): category is string => typeof category === 'string' && category.length > 0),
    ),
  );
  const papers = new Map<string, PaperRecord>();

  for (const root of roots) {
    let token: string | undefined;
    do {
      const url = token
        ? `${ARXIV_OAI_URL}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`
        : buildUrl(ARXIV_OAI_URL, {
            verb: 'ListRecords',
            metadataPrefix: 'arXiv',
            from: since,
            ...(until ? { until } : {}),
            set: root,
          });
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`arXiv OAI-PMH returned HTTP ${response.status}`);
      const parsed = xml.parse(await response.text()) as ArxivOaiResponse;
      const list = parsed['OAI-PMH']?.ListRecords;
      for (const record of asArray(list?.record)) {
        const paper = parseArxivRecord(record);
        if (!paper) continue;
        if (!matchesCategory(paper.categories, categories)) continue;
        papers.set(paper.id, paper);
        if (papers.size >= maxRecords) break;
      }
      token = typeof list?.resumptionToken === 'object' ? list.resumptionToken['#text'] : list?.resumptionToken;
      if (papers.size >= maxRecords) break;
      if (token) await delay(3100);
    } while (token);
  }

  const values = Array.from(papers.values());
  return {
    papers: values,
    result: { source: 'arxiv', fetched: values.length, upserted: values.length, skipped: 0, from: since, to: until },
  };
}

export async function fetchBiorxivMetadata(
  req: BiorxivSyncRequest,
  options: SyncOptions = {},
): Promise<{ papers: PaperRecord[]; result: SyncResult }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const server = req.server ?? 'biorxiv';
  const to = req.to ?? isoDate(now());
  const from = req.from ?? isoDate(addDays(now(), -1));
  const maxRecords = clampMax(req.maxRecords ?? options.maxRecords, 500);
  const papers: PaperRecord[] = [];
  let cursor = 0;

  while (papers.length < maxRecords) {
    const response = await fetchImpl(`${BIORXIV_API_URL}/${server}/${from}/${to}/${cursor}`);
    if (!response.ok) throw new Error(`bioRxiv API returned HTTP ${response.status}`);
    const payload = (await response.json()) as BiorxivResponse;
    const collection = payload.collection ?? [];
    for (const item of collection) {
      const paper = parseBiorxivRecord(item, server);
      if (paper) papers.push(paper);
      if (papers.length >= maxRecords) break;
    }
    if (collection.length === 0 || papers.length >= maxRecords) break;
    cursor += collection.length;
    if (collection.length < 100) break;
  }

  return {
    papers,
    result: { source: 'biorxiv', fetched: papers.length, upserted: papers.length, skipped: 0, from, to },
  };
}

function parseArxivRecord(record: ArxivRecord): PaperRecord | undefined {
  const meta = record.metadata?.arXiv;
  if (!meta?.id || !meta.title || !meta.abstract || !meta.created) return undefined;
  const categories = String(meta.categories ?? '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const authors = asArray(meta.authors?.author).map((author) => [author.forenames, author.keyname].filter(Boolean).join(' '));
  const externalId = String(meta.id);
  return {
    id: `arxiv:${externalId}`,
    source: 'arxiv',
    externalId,
    title: cleanText(meta.title),
    authors: authors.length ? authors : ['Unknown'],
    abstract: cleanText(meta.abstract),
    categories,
    subjects: [],
    publishedAt: meta.created,
    updatedAt: meta.updated,
    doi: meta.doi,
    absUrl: `https://arxiv.org/abs/${externalId}`,
    pdfUrl: `https://arxiv.org/pdf/${externalId}`,
  };
}

function parseBiorxivRecord(item: BiorxivItem, server: 'biorxiv' | 'medrxiv'): PaperRecord | undefined {
  if (!item.doi || !item.title || !item.abstract || !item.date) return undefined;
  const doi = String(item.doi);
  const absUrl = item.biorxiv_url || item.url || `https://www.${server}.org/content/${doi}`;
  return {
    id: `${server}:${doi}`,
    source: 'biorxiv',
    externalId: doi,
    title: cleanText(item.title),
    authors: splitAuthors(item.authors),
    abstract: cleanText(item.abstract),
    categories: item.category ? [item.category] : [],
    subjects: item.category ? [item.category] : [],
    publishedAt: item.date,
    doi,
    absUrl,
    pdfUrl: `${absUrl}.full.pdf`,
  };
}

function normalizeCategories(categories: string[]): string[] {
  return categories.map((category) => category.trim()).filter(Boolean);
}

function matchesCategory(paperCategories: string[], wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  return paperCategories.some((paperCategory) =>
    wanted.some((category) => paperCategory === category || paperCategory.startsWith(`${category}.`) || category.startsWith(`${paperCategory}.`)),
  );
}

function splitAuthors(value?: string): string[] {
  if (!value) return ['Unknown'];
  return value
    .split(';')
    .flatMap((part) => part.split(', '))
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function clampMax(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(2000, Math.floor(value as number)));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ArxivOaiResponse {
  'OAI-PMH'?: {
    ListRecords?: {
      record?: ArxivRecord | ArxivRecord[];
      resumptionToken?: string | { '#text'?: string };
    };
  };
}

interface ArxivRecord {
  metadata?: {
    arXiv?: {
      id?: string;
      created?: string;
      updated?: string;
      title?: string;
      authors?: { author?: ArxivAuthor | ArxivAuthor[] };
      abstract?: string;
      categories?: string;
      doi?: string;
    };
  };
}

interface ArxivAuthor {
  keyname?: string;
  forenames?: string;
}

interface BiorxivResponse {
  collection?: BiorxivItem[];
}

interface BiorxivItem {
  doi?: string;
  title?: string;
  authors?: string;
  abstract?: string;
  date?: string;
  category?: string;
  biorxiv_url?: string;
  url?: string;
}
