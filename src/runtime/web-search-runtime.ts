import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { decodeSearchRedirect } from './browser-host-session-search.js';
import { sha1 } from './workspace-task-runner.js';
import {
  createOpenSerpSearchProvider,
  createSearxngSearchProvider,
  type SearchCandidate,
  type SearchCandidateProvider,
  type SearchProviderDiagnostics,
  type WebSearchErrorCode,
  type WebSearchFetch,
  type WebSearchProviderConfig,
  type WebSearchProviderStatus,
} from './web-search-provider.js';

export {
  createOpenSerpSearchProvider,
  createSearxngSearchProvider,
  type SearchCandidate,
  type SearchCandidateProvider,
  type SearchCandidateProviderRequest,
  type SearchCandidateProviderResult,
  type WebSearchErrorCode,
  type WebSearchFetch,
  type WebSearchProviderConfig,
  type WebSearchProviderStatus,
} from './web-search-provider.js';

export interface WebSearchInput {
  query: string;
  limit?: number;
  language?: string;
  region?: string;
  timeRange?: string;
  safeSearch?: string;
  provider?: string;
  timeoutMs?: number;
  constraints?: {
    allowUnsafeUrls?: boolean;
  };
}

export interface NormalizedWebSearchResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  source?: string;
  provider: string;
  publishedAt?: string;
  ref: string;
}

export interface WebSearchEvidenceBoundary {
  kind: 'candidate-discovery';
  sourceEvidence: false;
  statement: string;
}

export interface WebSearchArtifactRef {
  kind: 'web-search-result-set';
  ref: string;
  path: string;
  mimeType: 'application/json';
  byteLength: number;
  sha1: string;
}

export interface WebSearchRuntimeDiagnostics extends SearchProviderDiagnostics {
  fallbackUsed: boolean;
  fallbackProvider?: string;
  fallbackReason?: string;
  blockedReason?: string;
  duplicateCount: number;
  unsafeUrlCount: number;
  searchEngineSelfLinkCount: number;
  providerDegraded?: boolean;
  timeout?: boolean;
  rateLimited?: boolean;
  noResults?: boolean;
  malformedJson?: boolean;
  retryCount: number;
}

export interface WebSearchTimings {
  providerMs: number;
  parseMs: number;
  optionalReadMs: number;
  normalizeMs: number;
  persistMs: number;
  totalMs: number;
  fallbackMs?: number;
}

export interface WebSearchEnvelope {
  ok: boolean;
  status: WebSearchProviderStatus;
  tool: 'web_search';
  provider: string;
  data?: {
    query: string;
    searchedAt: string;
    results: NormalizedWebSearchResult[];
    evidenceBoundary: WebSearchEvidenceBoundary;
  };
  refs: {
    searchResultSetRef?: string;
    discoveredPageRefs: Array<{ rank: number; ref: string; url: string }>;
  };
  artifacts: WebSearchArtifactRef[];
  timings: WebSearchTimings;
  diagnostics: WebSearchRuntimeDiagnostics;
  warnings: string[];
  error?: {
    code: WebSearchErrorCode;
    message: string;
  };
}

export interface RunWebSearchOptions {
  workspacePath?: string;
  provider?: SearchCandidateProvider;
  fallbackProvider?: SearchCandidateProvider;
  enableBrowserFallback?: boolean;
  env?: Record<string, string | undefined>;
  config?: WebSearchProviderConfig;
  now?: () => string;
}

const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 8_000;
const DEFAULT_WEB_SEARCH_LIMIT = 10;
const MAX_WEB_SEARCH_LIMIT = 25;

export async function runWebSearch(input: WebSearchInput, options: RunWebSearchOptions = {}): Promise<WebSearchEnvelope> {
  const totalStart = nowMs();
  const searchedAt = options.now?.() ?? new Date().toISOString();
  const workspacePath = resolve(options.workspacePath || process.cwd());
  const provider = options.provider ?? createProviderForInput(input, options);
  const providerRequest = {
    query: input.query.trim(),
    limit: normalizeLimit(input.limit),
    language: cleanOptional(input.language),
    region: cleanOptional(input.region),
    timeRange: cleanOptional(input.timeRange),
    safeSearch: cleanOptional(input.safeSearch),
    timeoutMs: normalizeTimeout(input.timeoutMs),
  };

  if (!providerRequest.query) {
    return failureEnvelope({
      status: 'invalid_input',
      provider: provider.id,
      message: 'web_search query is required.',
      diagnostics: baseDiagnostics(),
      timings: emptyTimings(totalStart),
    });
  }

  const primaryStart = nowMs();
  const primary = await provider.search(providerRequest);
  const primaryProviderMs = elapsedMs(primaryStart);

  if (primary.status !== 'completed') {
    if (options.enableBrowserFallback && options.fallbackProvider) {
      const fallbackStart = nowMs();
      const fallback = await options.fallbackProvider.search(providerRequest);
      const fallbackMs = elapsedMs(fallbackStart);
      const fallbackDiagnostics = {
        ...baseDiagnostics(),
        ...primary.diagnostics,
        ...fallback.diagnostics,
        fallbackUsed: true,
        fallbackProvider: options.fallbackProvider.id,
        fallbackReason: primary.status,
        retryCount: retryCountFromDiagnostics(primary.diagnostics) + retryCountFromDiagnostics(fallback.diagnostics),
      };
      if (fallback.status === 'completed') {
        return completedEnvelope({
          input,
          workspacePath,
          searchedAt,
          provider: options.fallbackProvider,
          candidates: fallback.candidates,
          providerMs: elapsedMs(primaryStart),
          parseMs: fallback.timings.parseMs,
          totalStart,
          diagnostics: fallbackDiagnostics,
          warnings: [`Browser SERP fallback provider used after ${primary.status}.`],
          fallbackMs,
          limit: providerRequest.limit,
        });
      }
      return failureEnvelope({
        status: fallback.status,
        provider: options.fallbackProvider.id,
        message: fallback.error?.message ?? `Browser SERP fallback failed with ${fallback.status}.`,
        diagnostics: fallbackDiagnostics,
        timings: {
          providerMs: primaryProviderMs,
          parseMs: fallback.timings.parseMs,
          optionalReadMs: 0,
          normalizeMs: 0,
          persistMs: 0,
          totalMs: elapsedMs(totalStart),
          fallbackMs,
        },
      });
    }

    return failureEnvelope({
      status: primary.status,
      provider: provider.id,
      message: primary.error?.message ?? `Search provider failed with ${primary.status}.`,
      diagnostics: {
        ...baseDiagnostics(),
        ...primary.diagnostics,
      },
      timings: {
        providerMs: primaryProviderMs,
        parseMs: primary.timings.parseMs,
        optionalReadMs: 0,
        normalizeMs: 0,
        persistMs: 0,
        totalMs: elapsedMs(totalStart),
      },
    });
  }

  return completedEnvelope({
    input,
    workspacePath,
    searchedAt,
    provider,
    candidates: primary.candidates,
    providerMs: primaryProviderMs,
    parseMs: primary.timings.parseMs,
    totalStart,
    diagnostics: {
      ...baseDiagnostics(),
      ...primary.diagnostics,
    },
    warnings: [],
    limit: providerRequest.limit,
  });
}

async function completedEnvelope(input: {
  input: WebSearchInput;
  workspacePath: string;
  searchedAt: string;
  provider: SearchCandidateProvider;
  candidates: SearchCandidate[];
  providerMs: number;
  parseMs: number;
  totalStart: number;
  diagnostics: WebSearchRuntimeDiagnostics;
  warnings: string[];
  limit: number;
  fallbackMs?: number;
}): Promise<WebSearchEnvelope> {
  const normalizeStart = nowMs();
  const normalized = normalizeSearchCandidates(input.candidates, {
    providerId: input.provider.id,
    selfLinkBaseUrl: input.provider.selfLinkBaseUrl,
    limit: input.limit,
    allowUnsafeUrls: Boolean(input.input.constraints?.allowUnsafeUrls),
  });
  const normalizeMs = elapsedMs(normalizeStart);
  const diagnostics = {
    ...input.diagnostics,
    duplicateCount: normalized.diagnostics.duplicateCount,
    unsafeUrlCount: normalized.diagnostics.unsafeUrlCount,
    searchEngineSelfLinkCount: normalized.diagnostics.searchEngineSelfLinkCount,
    noResults: normalized.results.length ? input.diagnostics.noResults : true,
  };

  if (!normalized.results.length) {
    return failureEnvelope({
      status: 'no_results',
      provider: input.provider.id,
      message: 'Search provider returned no safe normalized candidates.',
      diagnostics,
      warnings: input.warnings,
      timings: {
        providerMs: input.providerMs,
        parseMs: input.parseMs,
        optionalReadMs: 0,
        normalizeMs,
        persistMs: 0,
        totalMs: elapsedMs(input.totalStart),
        ...(input.fallbackMs !== undefined ? { fallbackMs: input.fallbackMs } : {}),
      },
    });
  }

  const evidenceBoundary = webSearchEvidenceBoundary();
  const persistStart = nowMs();
  const artifact = await persistWebSearchResultSet({
    workspacePath: input.workspacePath,
    searchedAt: input.searchedAt,
    query: input.input.query.trim(),
    provider: input.provider.id,
    results: normalized.results,
    refs: {
      discoveredPageRefs: normalized.results.map((result) => ({ rank: result.rank, ref: result.ref, url: result.url })),
    },
    evidenceBoundary,
    diagnostics,
  });
  const persistMs = elapsedMs(persistStart);

  return {
    ok: true,
    status: 'completed',
    tool: 'web_search',
    provider: input.provider.id,
    data: {
      query: input.input.query.trim(),
      searchedAt: input.searchedAt,
      results: normalized.results,
      evidenceBoundary,
    },
    refs: {
      searchResultSetRef: artifact.ref,
      discoveredPageRefs: normalized.results.map((result) => ({ rank: result.rank, ref: result.ref, url: result.url })),
    },
    artifacts: [artifact],
    timings: {
      providerMs: input.providerMs,
      parseMs: input.parseMs,
      optionalReadMs: 0,
      normalizeMs,
      persistMs,
      totalMs: elapsedMs(input.totalStart),
      ...(input.fallbackMs !== undefined ? { fallbackMs: input.fallbackMs } : {}),
    },
    diagnostics,
    warnings: input.warnings,
  };
}

function failureEnvelope(input: {
  status: Exclude<WebSearchProviderStatus, 'completed'>;
  provider: string;
  message: string;
  diagnostics: WebSearchRuntimeDiagnostics;
  timings: WebSearchTimings;
  warnings?: string[];
}): WebSearchEnvelope {
  const diagnostics = {
    blockedReason: input.diagnostics.blockedReason ?? input.status,
    ...input.diagnostics,
  };
  return {
    ok: false,
    status: input.status,
    tool: 'web_search',
    provider: input.provider,
    refs: {
      discoveredPageRefs: [],
    },
    artifacts: [],
    timings: input.timings,
    diagnostics,
    warnings: input.warnings ?? [],
    error: {
      code: input.status,
      message: input.message,
    },
  };
}

function normalizeSearchCandidates(input: SearchCandidate[], options: {
  providerId: string;
  selfLinkBaseUrl?: string;
  limit: number;
  allowUnsafeUrls: boolean;
}): {
  results: NormalizedWebSearchResult[];
  diagnostics: Pick<WebSearchRuntimeDiagnostics, 'duplicateCount' | 'unsafeUrlCount' | 'searchEngineSelfLinkCount'>;
} {
  const seen = new Set<string>();
  const results: NormalizedWebSearchResult[] = [];
  const diagnostics = {
    duplicateCount: 0,
    unsafeUrlCount: 0,
    searchEngineSelfLinkCount: 0,
  };

  for (const candidate of input) {
    const title = cleanText(candidate.title).slice(0, 180);
    if (!title) continue;
    const canonical = canonicalHttpUrl(candidate.url, { allowUnsafeUrls: options.allowUnsafeUrls });
    if (!canonical) {
      diagnostics.unsafeUrlCount += 1;
      continue;
    }
    if (isSearchEngineSelfLink(canonical, title, options.selfLinkBaseUrl)) {
      diagnostics.searchEngineSelfLinkCount += 1;
      continue;
    }
    if (seen.has(canonical)) {
      diagnostics.duplicateCount += 1;
      continue;
    }
    seen.add(canonical);
    const rank = results.length + 1;
    results.push({
      rank,
      title,
      url: canonical,
      snippet: cleanText(candidate.snippet ?? '').slice(0, 320),
      provider: options.providerId,
      ref: webPageRef(canonical),
      ...(candidate.source ? { source: cleanText(candidate.source).slice(0, 120) } : {}),
      ...(candidate.publishedAt ? { publishedAt: cleanText(candidate.publishedAt).slice(0, 80) } : {}),
    });
    if (results.length >= options.limit) break;
  }

  return { results, diagnostics };
}

async function persistWebSearchResultSet(input: {
  workspacePath: string;
  searchedAt: string;
  query: string;
  provider: string;
  results: NormalizedWebSearchResult[];
  refs: { discoveredPageRefs: Array<{ rank: number; ref: string; url: string }> };
  evidenceBoundary: WebSearchEvidenceBoundary;
  diagnostics: WebSearchRuntimeDiagnostics;
}): Promise<WebSearchArtifactRef> {
  const id = sha1(JSON.stringify({
    searchedAt: input.searchedAt,
    query: input.query,
    provider: input.provider,
    results: input.results.map((result) => ({ url: result.url, title: result.title })),
  })).slice(0, 12);
  const ref = `web-search:${id}`;
  const relPath = join('.sciforge', 'web-search', `search-${id}.json`);
  const path = join(input.workspacePath, relPath);
  const payload = {
    schemaVersion: 'sciforge.web-search.result-set.v1',
    ref,
    searchedAt: input.searchedAt,
    query: input.query,
    provider: input.provider,
    evidenceBoundary: input.evidenceBoundary,
    results: input.results,
    refs: {
      searchResultSetRef: ref,
      discoveredPageRefs: input.refs.discoveredPageRefs,
    },
    diagnostics: input.diagnostics,
  };
  const text = JSON.stringify(payload, null, 2);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
  return {
    kind: 'web-search-result-set',
    ref,
    path,
    mimeType: 'application/json',
    byteLength: Buffer.byteLength(text, 'utf8'),
    sha1: sha1(text),
  };
}

function canonicalHttpUrl(value: string, options: { allowUnsafeUrls: boolean }): string | undefined {
  const decoded = decodeSearchRedirect(value.trim());
  if (!decoded) return undefined;
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    return undefined;
  }
  if (!/^https?:$/i.test(url.protocol)) return undefined;
  if (!options.allowUnsafeUrls && isUnsafeHttpUrl(url)) return undefined;
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.username = '';
  url.password = '';
  url.hash = '';
  const entries = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
    ));
  url.search = '';
  for (const [key, paramValue] of entries) url.searchParams.append(key, paramValue);
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

function isUnsafeHttpUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isMetadataEndpointHost(host)) return true;
  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  if (isUnsafeIpv6(host)) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  return false;
}

function parseIpv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const parsed = parts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parsed as [number, number, number, number];
}

function isPrivateIpv4(parts: [number, number, number, number]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isUnsafeIpv6(host: string): boolean {
  const normalized = host.replace(/:+/g, ':');
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4) {
    const ipv4 = parseIpv4(mappedIpv4);
    return ipv4 ? isPrivateIpv4(ipv4) : true;
  }
  if (normalized === '::1' || normalized === '::' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (/^(?:fc|fd)[0-9a-f]{0,2}:/i.test(normalized)) return true;
  if (/^fe[89ab][0-9a-f]?:/i.test(normalized)) return true;
  return false;
}

function isMetadataEndpointHost(host: string): boolean {
  return host === 'metadata'
    || host === 'metadata.google.internal'
    || host.endsWith('.metadata.google.internal')
    || host === '100.100.100.200';
}

function isTrackingParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.startsWith('utm_')
    || ['fbclid', 'gclid', 'dclid', 'mc_cid', 'mc_eid', 'igshid', 'ref', 'ref_src'].includes(normalized);
}

function isSearchEngineSelfLink(value: string, title: string, selfLinkBaseUrl: string | undefined): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (selfLinkBaseUrl) {
      const self = new URL(selfLinkBaseUrl);
      if (host === self.hostname.toLowerCase() && (path === '/' || path === '/search' || path === '/search/')) return true;
    }
    if (!/(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)google\.[a-z.]+$/i.test(host)) return false;
    if (/^(?:skip to content|skip to main content|web|images|videos|news|maps|shopping|more|all|search|google search)$/i.test(title)) return true;
    if (/(^|\.)bing\.com$/i.test(host)) return path === '/' || path === '/search' || /^\/(?:images|videos|news|maps)\/search/.test(path);
    if (/(^|\.)duckduckgo\.com$/i.test(host)) return path === '/' || path === '/html/' || path === '/html';
    return path === '/search' || path.startsWith('/search/');
  } catch {
    return false;
  }
}

function createProviderForInput(input: WebSearchInput, options: RunWebSearchOptions): SearchCandidateProvider {
  if ((input.provider ?? '').toLowerCase() === 'openserp') {
    return createOpenSerpSearchProvider({
      env: options.env,
      config: options.config,
    });
  }
  return createSearxngSearchProvider({
    env: options.env,
    config: options.config,
  });
}

function webSearchEvidenceBoundary(): WebSearchEvidenceBoundary {
  return {
    kind: 'candidate-discovery',
    sourceEvidence: false,
    statement: 'Search results and snippets are candidate discovery only; no source page text has been read.',
  };
}

function webPageRef(url: string): string {
  return `web-page:${sha1(url).slice(0, 12)}`;
}

function baseDiagnostics(): WebSearchRuntimeDiagnostics {
  return {
    fallbackUsed: false,
    duplicateCount: 0,
    unsafeUrlCount: 0,
    searchEngineSelfLinkCount: 0,
    retryCount: 0,
  };
}

function emptyTimings(totalStart: number): WebSearchTimings {
  return {
    providerMs: 0,
    parseMs: 0,
    optionalReadMs: 0,
    normalizeMs: 0,
    persistMs: 0,
    totalMs: elapsedMs(totalStart),
  };
}

function retryCountFromDiagnostics(diagnostics: SearchProviderDiagnostics): number {
  const value = diagnostics.retryCount;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WEB_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_WEB_SEARCH_LIMIT, Math.floor(Number(value))));
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WEB_SEARCH_TIMEOUT_MS;
  return Math.max(1, Math.min(60_000, Math.floor(Number(value))));
}

function cleanOptional(value: string | undefined): string | undefined {
  const clean = cleanText(value ?? '');
  return clean || undefined;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function nowMs() {
  return performance.now();
}

function elapsedMs(start: number) {
  return Math.max(0, Math.round((nowMs() - start) * 1000) / 1000);
}
