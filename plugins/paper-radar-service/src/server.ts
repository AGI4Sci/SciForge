import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { fetchArxivMetadata, fetchBiorxivMetadata, type ArxivSyncRequest, type BiorxivSyncRequest } from './sources.js';
import { PaperStore } from './storage.js';
import { ProfileStore } from './profiles.js';
import { profileSyncCategories, rankPapers } from './ranker.js';
import type { DigestRequest, PaperRecord, RankRequest, SearchRequest, ServiceError, ServiceResult, SyncResult, TopicProfile } from './types.js';

export const SERVICE_ID = 'sciforge.paper-radar';
export const SERVICE_VERSION = '0.1.0';

export interface PaperRadarOptions {
  dbPath: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  profilesPath?: string;
}

export function createPaperRadarServer(options: PaperRadarOptions): Server {
  const store = new PaperStore(options.dbPath);
  const profiles = new ProfileStore(options.profilesPath ?? join(options.dbPath, '..', 'profiles.json'));
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const server = createServer((req, res) => {
    handle(req, res, store, profiles, fetchImpl, now).catch((error) => {
      sendJson(res, 500, errorResult('INTERNAL_ERROR', messageOf(error), false));
    });
  });
  server.on('close', () => store.close());
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: PaperStore,
  profiles: ProfileStore,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: SERVICE_ID, stats: store.stats(), checkedAt: now().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/version') {
    return sendJson(res, 200, { service: SERVICE_ID, version: SERVICE_VERSION });
  }
  if (req.method === 'POST' && url.pathname === '/sync/arxiv') {
    return syncArxivRoute(req, res, store, fetchImpl, now);
  }
  if (req.method === 'POST' && url.pathname === '/sync/biorxiv') {
    return syncBiorxivRoute(req, res, store, fetchImpl, now);
  }
  if (req.method === 'POST' && url.pathname === '/sync/profile') {
    return syncProfileRoute(req, res, store, profiles, fetchImpl, now);
  }
  if (req.method === 'GET' && url.pathname === '/profiles') {
    return sendJson(res, 200, ok({ profiles: profiles.list() }));
  }
  if (req.method === 'POST' && url.pathname === '/profiles') {
    return upsertProfileRoute(req, res, profiles);
  }
  if (req.method === 'GET' && url.pathname === '/papers/search') {
    return searchRoute(url, res, store);
  }
  if (req.method === 'POST' && url.pathname === '/papers/rank') {
    return rankRoute(req, res, store, profiles);
  }
  if (req.method === 'POST' && url.pathname === '/digest') {
    return digestRoute(req, res, store, profiles);
  }
  return sendJson(res, 404, errorResult('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, false));
}

async function syncArxivRoute(
  req: IncomingMessage,
  res: ServerResponse,
  store: PaperStore,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const body = (await readJson(req)) as ArxivSyncRequest;
  const { papers, result } = await fetchArxivMetadata(body, { fetchImpl, now });
  persistPapers(store, papers);
  store.setSyncState('arxiv', 'last_sync', now().toISOString());
  return sendJson(res, 200, ok({ ...result, upserted: papers.length }));
}

async function syncBiorxivRoute(
  req: IncomingMessage,
  res: ServerResponse,
  store: PaperStore,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const body = (await readJson(req)) as BiorxivSyncRequest;
  const { papers, result } = await fetchBiorxivMetadata(body, { fetchImpl, now });
  persistPapers(store, papers);
  store.setSyncState('biorxiv', 'last_sync', now().toISOString());
  return sendJson(res, 200, ok({ ...result, upserted: papers.length }));
}

async function syncProfileRoute(
  req: IncomingMessage,
  res: ServerResponse,
  store: PaperStore,
  profiles: ProfileStore,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<void> {
  const body = (await readJson(req)) as { profile?: string; from?: string; to?: string; maxRecords?: number };
  const profile = profiles.get(body.profile);
  const today = body.to ?? now().toISOString().slice(0, 10);
  const yesterday = new Date(now());
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const from = body.from ?? yesterday.toISOString().slice(0, 10);
  const maxRecords = body.maxRecords ?? 200;
  const arxiv = await fetchArxivMetadata(
    { categories: profileSyncCategories(profile), since: from, until: today, maxRecords },
    { fetchImpl, now },
  );
  persistPapers(store, arxiv.papers);
  const biorxiv = await fetchBiorxivMetadata({ from, to: today, maxRecords }, { fetchImpl, now });
  const biorxivPapers = biorxiv.papers.filter((paper) => {
    if (!profile.biorxivSubjects.length) return true;
    const metadata = [...paper.categories, ...paper.subjects].join(' ').toLowerCase();
    return profile.biorxivSubjects.some((subject) => metadata.includes(subject.toLowerCase()));
  });
  persistPapers(store, biorxivPapers);
  store.setSyncState('arxiv', 'last_sync', now().toISOString());
  store.setSyncState('biorxiv', 'last_sync', now().toISOString());
  return sendJson(res, 200, ok({
    profile: profile.name,
    results: [
      { ...arxiv.result, upserted: arxiv.papers.length },
      { ...biorxiv.result, fetched: biorxiv.papers.length, upserted: biorxivPapers.length, skipped: biorxiv.papers.length - biorxivPapers.length },
    ],
  }));
}

function searchRoute(url: URL, res: ServerResponse, store: PaperStore): void {
  const req: SearchRequest = {
    query: url.searchParams.get('q') ?? undefined,
    sources: parseSources(url.searchParams.getAll('source')),
    categories: url.searchParams.getAll('category'),
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    topK: parseNumber(url.searchParams.get('topK')),
  };
  const papers = store.search(req);
  return sendJson(res, 200, ok({ papers, count: papers.length }));
}

async function upsertProfileRoute(req: IncomingMessage, res: ServerResponse, profiles: ProfileStore): Promise<void> {
  const body = (await readJson(req)) as TopicProfile;
  const profile = profiles.upsert(body);
  return sendJson(res, 200, ok({ profile }));
}

async function rankRoute(req: IncomingMessage, res: ServerResponse, store: PaperStore, profiles: ProfileStore): Promise<void> {
  const body = (await readJson(req)) as RankRequest;
  const papers = rankPapers(store, profiles, body);
  return sendJson(res, 200, ok({ profile: body.profile ?? 'lab_default', count: papers.length, papers }));
}

async function digestRoute(req: IncomingMessage, res: ServerResponse, store: PaperStore, profiles: ProfileStore): Promise<void> {
  const body = (await readJson(req)) as DigestRequest;
  const papers = rankPapers(store, profiles, { ...body, topK: body.topK ?? 10 });
  return sendJson(
    res,
    200,
    ok({
      profile: body.profile ?? 'default',
      generatedAt: new Date().toISOString(),
      count: papers.length,
      papers,
    }),
  );
}

function persistPapers(store: PaperStore, papers: PaperRecord[]): void {
  for (const paper of papers) store.upsertPaper(paper);
}

function parseSources(values: string[]): SearchRequest['sources'] {
  const sources = values.filter((value): value is 'arxiv' | 'biorxiv' => value === 'arxiv' || value === 'biorxiv');
  return sources.length ? sources : undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

function errorResult(code: ServiceError['code'], message: string, retryable: boolean): ServiceResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
