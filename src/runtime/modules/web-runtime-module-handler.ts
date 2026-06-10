import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleResultEnvelope,
} from '../../../packages/contracts/runtime/modules.js';
import { normalizeWorkspaceRootPath } from '../workspace-paths.js';
import { defaultBrowserHostSessionManager } from '../browser-host-session.js';
import {
  createBrowserHostSessionRenderAdapter,
  runWebReadBrowserFallback,
  type WebReadBrowserFallbackResult,
  type WebReadBrowserRenderAdapter,
} from '../web-read-browser-fallback.js';
import { extractStaticHtmlPage } from '../web-read-extract.js';
import type { RuntimeModuleHandler } from './dispatcher.js';

export const WEB_RUNTIME_MODULE_ID = 'web' as const;
export const WEB_SEARCH_INTENT = 'web.search' as const;
export const WEB_READ_INTENT = 'web.read' as const;
export const WEB_SEARCH_INPUT_SCHEMA_VERSION = 'sciforge.web-search.input.v1' as const;
export const WEB_READ_INPUT_SCHEMA_VERSION = 'sciforge.web-read.input.v1' as const;
export const WEB_RUNTIME_RESULT_SCHEMA_VERSION = 'sciforge.web-runtime.result.v1' as const;

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_READ_MAX_CHARS = 12_000;
const MAX_READ_MAX_CHARS = 200_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const WEB_RUNTIME_ROOT = '.sciforge/web-search';
const SEARXNG_PRESETS = {
  docs: { engines: 'mdn,github' },
  science: { categories: 'science', engines: 'openalex,crossref,arxiv' },
  stable: { engines: 'mdn,github,openalex,crossref,arxiv' },
} as const;

type WebToolName = 'web_search' | 'web_read';
type WebRuntimeStatus = 'completed' | 'partial' | 'blocked' | 'failed';
type WebRuntimeErrorCode =
  | 'invalid_input'
  | 'unsafe_url'
  | 'provider_unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'no_results'
  | 'read_failed'
  | 'extract_failed'
  | 'needs_browser'
  | 'needs_user_browser';

export interface WebSearchCandidate {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  publishedAt?: string;
  provider?: string;
}

export interface WebSearchProviderInput {
  query: string;
  limit: number;
  language?: string;
  region?: string;
  timeRange?: string;
  safeSearch?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface WebSearchProviderResult {
  provider: string;
  results: WebSearchCandidate[];
  timings?: Record<string, number>;
  diagnostics?: WebRuntimeDiagnostic[];
}

export type SearchCandidateProvider = (input: WebSearchProviderInput) => Promise<WebSearchProviderResult>;

export interface WebReadProviderInput {
  url: string;
  format: WebReadFormat;
  render: WebReadRenderMode;
  maxChars: number;
  timeoutMs: number;
  resourceRef?: string;
  signal?: AbortSignal;
}

export interface WebReadProviderResult {
  provider: string;
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  contentType?: string;
  language?: string;
  markdown?: string;
  text?: string;
  html?: string;
  timings?: Record<string, number>;
  diagnostics?: WebRuntimeDiagnostic[];
}

export type WebReadProvider = (input: WebReadProviderInput) => Promise<WebReadProviderResult>;
export type WebReadFormat = 'markdown' | 'text' | 'html' | 'metadata';
type WebReadRenderMode = 'auto' | 'static' | 'browser';

export interface WebRuntimeDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  retryable?: boolean;
}

export interface WebRuntimeToolResult {
  schemaVersion: typeof WEB_RUNTIME_RESULT_SCHEMA_VERSION;
  ok: boolean;
  status: WebRuntimeStatus;
  tool: WebToolName;
  provider?: string;
  data: Record<string, any>;
  refs: string[];
  timings: Record<string, number>;
  warnings: string[];
  diagnostics: WebRuntimeDiagnostic[];
  error?: {
    code: WebRuntimeErrorCode;
    message: string;
  };
}

export interface WebRuntimeModuleOptions {
  workspacePath?: string;
  searchProvider?: SearchCandidateProvider;
  readProvider?: WebReadProvider;
  browserFallbackAdapter?: WebReadBrowserRenderAdapter | false;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

interface NormalizedCandidate {
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  publishedAt?: string;
  provider: string;
  resourceRef: string;
  evidenceState: 'candidate_only';
}

interface StoredWebPageRef {
  schemaVersion: typeof WEB_RUNTIME_RESULT_SCHEMA_VERSION;
  ref: string;
  searchRef: string;
  discoveredAt: string;
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  provider: string;
  publishedAt?: string;
}

class WebRuntimeError extends Error {
  constructor(readonly code: WebRuntimeErrorCode, message: string = code) {
    super(message);
  }
}

export function createWebRuntimeModuleHandler(options: WebRuntimeModuleOptions = {}): RuntimeModuleHandler {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(options.workspacePath || process.cwd()));
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const searchProvider = options.searchProvider ?? defaultSearchProvider(env, fetchImpl) ?? unavailableSearchProvider();
  const readProvider = options.readProvider ?? createStaticFetchReadProvider({ fetchImpl });
  const browserFallbackAdapter = options.browserFallbackAdapter === false
    ? undefined
    : options.browserFallbackAdapter ?? createBrowserHostSessionRenderAdapter(defaultBrowserHostSessionManager());
  const now = options.now ?? (() => new Date());

  return {
    describe: webRuntimeModuleDescription,
    invoke: async (request) => {
      if (request.intent === WEB_SEARCH_INTENT) {
        return invokeWebSearch({ request, workspaceRoot, provider: searchProvider, now });
      }
      if (request.intent === WEB_READ_INTENT) {
        return invokeWebRead({ request, workspaceRoot, provider: readProvider, browserFallbackAdapter, now });
      }
      return failTool('web_search', 'invalid_input', `unsupported_intent:${request.intent}`);
    },
  };
}

export function webRuntimeModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: WEB_RUNTIME_MODULE_ID,
    title: 'Web Search',
    summary: 'Refs-first web candidate discovery and single-source reading. Agent Host owns intent, source selection, evidence sufficiency, synthesis, and fallback escalation.',
    resources: [
      { kind: 'web-search', refPrefix: 'web-search:', readable: true, summary: 'Persisted web_search result set metadata.' },
      { kind: 'web-page', refPrefix: 'web-page:', readable: true, summary: 'A discovered candidate page ref from web_search; not source evidence until web_read succeeds.' },
      { kind: 'web-source', refPrefix: 'web-source:', readable: true, summary: 'Persisted web_read source metadata.' },
      { kind: 'web-text', refPrefix: 'web-text:', readable: true, summary: 'Persisted web_read extracted page text / markdown.' },
    ],
    intents: [
      { name: WEB_SEARCH_INTENT, sideEffect: 'external', returnsOperation: false, summary: 'Discover candidate sources for a Host-provided query. Candidate snippets are not source evidence.' },
      { name: WEB_READ_INTENT, sideEffect: 'external', returnsOperation: false, summary: 'Read exactly one URL or web-page ref and materialize source/page text refs.' },
    ],
    facets: { refs: true },
    limits: { maxInlineBytes: 16_000, expectedLatencyMs: 3_000 },
  });
}

async function invokeWebSearch(input: {
  request: ModuleInvokeRequest;
  workspaceRoot: string;
  provider: SearchCandidateProvider;
  now: () => Date;
}): Promise<ModuleResultEnvelope> {
  const startedAt = Date.now();
  const validation = parseSearchInput(input.request.input);
  if (!validation.ok) return failTool('web_search', validation.code, validation.message);
  if (!input.provider) return failTool('web_search', 'provider_unavailable', 'No web search provider is configured.');
  const abort = timeoutAbort(validation.value.timeoutMs);
  try {
    const providerStartedAt = Date.now();
    const providerResult = await input.provider({ ...validation.value, signal: abort.signal });
    const providerMs = Date.now() - providerStartedAt;
    const searchId = webArtifactId('search', validation.value.query);
    const searchRef = `web-search:${searchId}`;
    const discoveredAt = input.now().toISOString();
    const normalized = normalizeSearchCandidates(providerResult.results, {
      limit: validation.value.limit,
      provider: providerResult.provider,
      searchRef,
      searchId,
    });
    if (!normalized.results.length) {
      return failTool('web_search', 'no_results', 'Search provider returned no usable HTTP(S) candidates.', {
        provider: providerResult.provider,
        timings: { totalMs: Date.now() - startedAt, providerMs, ...(providerResult.timings ?? {}) },
        diagnostics: providerResult.diagnostics ?? [],
        warnings: normalized.warnings,
      });
    }
    const persistStartedAt = Date.now();
    await persistSearchResult(input.workspaceRoot, {
      searchId,
      searchRef,
      query: validation.value.query,
      provider: providerResult.provider,
      discoveredAt,
      candidates: normalized.results,
    });
    const persistMs = Date.now() - persistStartedAt;
    const refs = [searchRef, ...normalized.results.map((result) => result.resourceRef)];
    return moduleResult({
      moduleId: WEB_RUNTIME_MODULE_ID,
      ok: true,
      value: toolResult({
        ok: true,
        status: 'completed',
        tool: 'web_search',
        provider: providerResult.provider,
        refs,
        warnings: normalized.warnings,
        diagnostics: providerResult.diagnostics ?? [],
        timings: {
          totalMs: Date.now() - startedAt,
          providerMs,
          persistMs,
          ...(providerResult.timings ?? {}),
        },
        data: {
          query: validation.value.query,
          resultSetRef: searchRef,
          evidenceState: 'candidate_only',
          evidenceBoundary: 'web_search results are candidate discovery only, not source evidence. Call web_read on a web-page ref or URL before using a page as evidence.',
          results: normalized.results,
        },
      }),
      refs,
    });
  } catch (error) {
    return failTool('web_search', errorCode(error), errorMessage(error), {
      timings: { totalMs: Date.now() - startedAt },
    });
  } finally {
    abort.clear();
  }
}

async function invokeWebRead(input: {
  request: ModuleInvokeRequest;
  workspaceRoot: string;
  provider: WebReadProvider;
  browserFallbackAdapter?: WebReadBrowserRenderAdapter;
  now: () => Date;
}): Promise<ModuleResultEnvelope> {
  const startedAt = Date.now();
  const validation = parseReadInput(input.request.input);
  if (!validation.ok) return failTool('web_read', validation.code, validation.message);
  const resolved = await resolveReadUrl(input.workspaceRoot, validation.value);
  if (!resolved.ok) return failTool('web_read', resolved.code, resolved.message);
  const safety = safeHttpUrl(resolved.value.url);
  if (!safety.ok) return failTool('web_read', 'unsafe_url', safety.reason);
  const abort = timeoutAbort(validation.value.timeoutMs);
  try {
    if (validation.value.render === 'browser') {
      return webReadBrowserFallbackModuleResult(await runWebReadBrowserFallback({
        workspacePath: input.workspaceRoot,
        url: safety.url.toString(),
        render: 'browser',
        timeoutMs: validation.value.timeoutMs,
        adapter: input.browserFallbackAdapter,
        staticRead: {
          status: 'empty',
          reason: 'browser_render_requested',
          textCharCount: 0,
        },
      }), startedAt);
    }
    const providerStartedAt = Date.now();
    const providerResult = await input.provider({
      url: safety.url.toString(),
      resourceRef: validation.value.resourceRef,
      format: validation.value.format,
      render: validation.value.render,
      maxChars: validation.value.maxChars,
      timeoutMs: validation.value.timeoutMs,
      signal: abort.signal,
    });
    const providerMs = Date.now() - providerStartedAt;
    const sourceText = contentForFormat(providerResult, validation.value.format);
    if (validation.value.format !== 'metadata' && !sourceText.trim()) {
      return failTool('web_read', 'extract_failed', 'Read provider returned no page text.', {
        provider: providerResult.provider,
        timings: { totalMs: Date.now() - startedAt, providerMs, ...(providerResult.timings ?? {}) },
        diagnostics: providerResult.diagnostics ?? [],
      });
    }
    const boundedText = sourceText.slice(0, validation.value.maxChars);
    const sourceId = webArtifactId('source', providerResult.finalUrl || safety.url.toString());
    const sourceRef = `web-source:${sourceId}`;
    const textRef = `web-text:${sourceId}`;
    const textSha1 = sha1(boundedText);
    const openedAt = input.now().toISOString();
    const persistStartedAt = Date.now();
    await persistReadResult(input.workspaceRoot, {
      sourceId,
      sourceRef,
      textRef,
      text: boundedText,
      metadata: {
        schemaVersion: WEB_RUNTIME_RESULT_SCHEMA_VERSION,
        ref: sourceRef,
        textRef,
        requestedUrl: providerResult.requestedUrl || safety.url.toString(),
        finalUrl: providerResult.finalUrl || safety.url.toString(),
        title: providerResult.title,
        author: providerResult.author,
        publishedAt: providerResult.publishedAt,
        contentType: providerResult.contentType,
        language: providerResult.language,
        textSha1,
        textCharCount: boundedText.length,
        openedAt,
        provider: providerResult.provider,
        sourcePageRef: validation.value.resourceRef,
      },
    });
    const persistMs = Date.now() - persistStartedAt;
    const refs = [sourceRef, textRef];
    return moduleResult({
      moduleId: WEB_RUNTIME_MODULE_ID,
      ok: true,
      value: toolResult({
        ok: true,
        status: 'completed',
        tool: 'web_read',
        provider: providerResult.provider,
        refs,
        warnings: sourceText.length > boundedText.length ? ['content_truncated_to_max_chars'] : [],
        diagnostics: providerResult.diagnostics ?? [],
        timings: {
          totalMs: Date.now() - startedAt,
          providerMs,
          persistMs,
          ...(providerResult.timings ?? {}),
        },
        data: {
          evidenceState: 'source_read',
          evidenceBoundary: 'web_read materializes source/page text refs; page text refs are source evidence, while Agent Host still decides sufficiency and synthesis.',
          source: {
            requestedUrl: providerResult.requestedUrl || safety.url.toString(),
            finalUrl: providerResult.finalUrl || safety.url.toString(),
            title: providerResult.title,
            author: providerResult.author,
            publishedAt: providerResult.publishedAt,
            contentType: providerResult.contentType,
            language: providerResult.language,
            sourceRef,
            pageTextRef: textRef,
            textSha1,
            openedAt,
          },
          content: {
            format: validation.value.format,
            preview: boundedText.slice(0, Math.min(2_000, boundedText.length)),
            charCount: boundedText.length,
            textRef,
          },
        },
      }),
      refs,
    });
  } catch (error) {
    const code = errorCode(error);
    const message = errorMessage(error);
    if (validation.value.render === 'auto' && code === 'extract_failed') {
      return webReadBrowserFallbackModuleResult(await runWebReadBrowserFallback({
        workspacePath: input.workspaceRoot,
        url: safety.url.toString(),
        render: 'auto',
        timeoutMs: validation.value.timeoutMs,
        adapter: input.browserFallbackAdapter,
        staticRead: {
          status: 'extract_failed',
          reason: code,
          textCharCount: 0,
          preview: message,
        },
      }), startedAt);
    }
    if (validation.value.render === 'browser' || code === 'needs_browser') {
      return webReadBrowserFallbackModuleResult(await runWebReadBrowserFallback({
        workspacePath: input.workspaceRoot,
        url: safety.url.toString(),
        render: 'browser',
        timeoutMs: validation.value.timeoutMs,
        adapter: input.browserFallbackAdapter,
        staticRead: {
          status: 'read_failed',
          reason: code,
          textCharCount: 0,
          preview: message,
        },
      }), startedAt);
    }
    return failTool('web_read', code, message, {
      timings: { totalMs: Date.now() - startedAt },
    });
  } finally {
    abort.clear();
  }
}

function webReadBrowserFallbackModuleResult(
  fallback: WebReadBrowserFallbackResult,
  startedAt: number,
): ModuleResultEnvelope {
  const refs = uniqueStrings(Object.values(fallback.refs).filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0));
  const code = webRuntimeErrorCodeFromFallback(fallback);
  const ok = fallback.ok && fallback.status === 'read';
  return moduleResult({
    moduleId: WEB_RUNTIME_MODULE_ID,
    ok,
    error: ok ? undefined : code,
    value: toolResult({
      ok,
      status: ok ? 'completed' : failureStatus(code),
      tool: 'web_read',
      provider: fallback.provider,
      refs,
      warnings: fallback.warnings,
      diagnostics: [{
        code: `browser_fallback_${fallback.status}`,
        message: fallback.error?.message ?? fallback.diagnostics.fallbackReason,
        severity: ok ? 'info' : 'warning',
        retryable: fallback.status === 'needs_browser',
      }],
      timings: {
        totalMs: Math.max(fallback.timings.totalMs, Date.now() - startedAt),
        ...numberRecord(fallback.timings),
      },
      data: ok
        ? {
            evidenceState: 'source_read',
            evidenceBoundary: 'web_read browser fallback materialized source/page text refs; Agent Host still decides sufficiency and synthesis.',
            fallbackUsed: true,
            fallbackTrace: fallback.fallbackTrace,
            profilePolicy: fallback.profilePolicy,
            source: {
              requestedUrl: fallback.data?.requestedUrl,
              finalUrl: fallback.data?.finalUrl,
              title: fallback.data?.title,
              contentType: fallback.data?.contentType,
              sourceRef: fallback.refs.sourcePageRef,
              pageTextRef: fallback.refs.pageTextRef,
            },
            content: {
              format: 'markdown',
              preview: '',
              charCount: fallback.data?.textCharCount ?? 0,
              textRef: fallback.refs.pageTextRef,
            },
          }
        : {
            evidenceState: 'none',
            evidenceBoundary: 'Browser fallback did not materialize source/page text refs; this result cannot satisfy source evidence.',
            fallbackUsed: fallback.diagnostics.fallbackUsed,
            fallbackTrace: fallback.fallbackTrace,
            profilePolicy: fallback.profilePolicy,
          },
      ...(ok ? {} : {
        error: {
          code,
          message: fallback.error?.message ?? fallback.diagnostics.failureReason ?? fallback.diagnostics.fallbackReason,
        },
      }),
    }),
    refs,
  });
}

function webRuntimeErrorCodeFromFallback(fallback: WebReadBrowserFallbackResult): WebRuntimeErrorCode {
  const code = fallback.error?.code;
  if (code === 'needs_browser' || code === 'needs_user_browser' || code === 'read_failed' || code === 'timeout' || code === 'extract_failed') {
    return code;
  }
  return fallback.status === 'needs_user_browser'
    ? 'needs_user_browser'
    : fallback.status === 'needs_browser'
      ? 'needs_browser'
      : 'read_failed';
}

export function createSearxngSearchCandidateProvider(options: {
  baseUrl: string;
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): SearchCandidateProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const searchParams = sanitizeProviderSearchParams(options.searchParams ?? {});
  const headers = sanitizeProviderHeaders(options.headers ?? {});
  return async (input) => {
    if (!fetchImpl) throw new WebRuntimeError('provider_unavailable', 'fetch is unavailable');
    const url = new URL('/search', options.baseUrl);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('q', input.query);
    url.searchParams.set('format', 'json');
    if (input.language) url.searchParams.set('language', input.language);
    if (input.timeRange) url.searchParams.set('time_range', input.timeRange);
    if (input.safeSearch) url.searchParams.set('safesearch', input.safeSearch);
    const startedAt = Date.now();
    const response = await fetchImpl(url, { signal: input.signal, headers: { accept: 'application/json', ...headers } });
    const providerMs = Date.now() - startedAt;
    if (response.status === 429) throw new WebRuntimeError('rate_limited', 'SearXNG returned 429 rate_limited.');
    if (!response.ok) throw new WebRuntimeError('provider_unavailable', `SearXNG returned HTTP ${response.status}.`);
    const parseStartedAt = Date.now();
    let payload: any;
    try {
      payload = await response.json();
    } catch (error) {
      throw new WebRuntimeError('provider_unavailable', `SearXNG returned malformed JSON: ${errorMessage(error)}`);
    }
    const rawResults = Array.isArray(payload?.results) ? payload.results : [];
    const results = rawResults.map((item: any) => ({
      title: stringOrUndefined(item?.title) ?? stringOrUndefined(item?.url) ?? 'Untitled',
      url: stringOrUndefined(item?.url) ?? '',
      snippet: stringOrUndefined(item?.content) ?? stringOrUndefined(item?.snippet),
      source: stringOrUndefined(item?.engine) ?? stringOrUndefined(item?.source),
      publishedAt: stringOrUndefined(item?.publishedDate) ?? stringOrUndefined(item?.published_at),
      provider: 'searxng',
    })).filter((item: WebSearchCandidate) => item.url);
    return {
      provider: 'searxng',
      results,
      timings: { providerMs, parseMs: Date.now() - parseStartedAt },
      diagnostics: Array.isArray(payload?.unresponsive_engines) && payload.unresponsive_engines.length
        ? [{
            code: 'provider_degraded',
            message: `${payload.unresponsive_engines.length} SearXNG engines were unresponsive.`,
            severity: 'warning',
            retryable: true,
          }]
        : [],
    };
  };
}

export function createOpenSerpSearchCandidateProvider(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): SearchCandidateProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return async (input) => {
    if (!fetchImpl) throw new WebRuntimeError('provider_unavailable', 'fetch is unavailable');
    const url = searchEndpointUrl(options.baseUrl);
    url.searchParams.set('text', input.query);
    url.searchParams.set('format', 'json');
    if (input.language) url.searchParams.set('language', input.language);
    const startedAt = Date.now();
    const response = await fetchImpl(url, { signal: input.signal, headers: { accept: 'application/json' } });
    const providerMs = Date.now() - startedAt;
    if (response.status === 429) throw new WebRuntimeError('rate_limited', 'OpenSERP returned 429 rate_limited.');
    if (!response.ok) throw new WebRuntimeError('provider_unavailable', `OpenSERP returned HTTP ${response.status}.`);
    const parseStartedAt = Date.now();
    let payload: any;
    try {
      payload = await response.json();
    } catch (error) {
      throw new WebRuntimeError('provider_unavailable', `OpenSERP returned malformed JSON: ${errorMessage(error)}`);
    }
    const rawResults = firstArray(payload?.results, payload?.organic_results, payload?.items, payload?.data);
    const results = rawResults.map((item: any) => ({
      title: stringOrUndefined(item?.title) ?? stringOrUndefined(item?.url) ?? stringOrUndefined(item?.link) ?? 'Untitled',
      url: stringOrUndefined(item?.url) ?? stringOrUndefined(item?.link) ?? '',
      snippet: stringOrUndefined(item?.content) ?? stringOrUndefined(item?.snippet) ?? stringOrUndefined(item?.description),
      source: stringOrUndefined(item?.engine) ?? stringOrUndefined(item?.source),
      publishedAt: stringOrUndefined(item?.publishedDate) ?? stringOrUndefined(item?.publishedAt) ?? stringOrUndefined(item?.published_at),
      provider: 'openserp',
    })).filter((item: WebSearchCandidate) => item.url);
    return {
      provider: 'openserp',
      results,
      timings: { providerMs, parseMs: Date.now() - parseStartedAt },
      diagnostics: [],
    };
  };
}

export function createGenericJsonSearchCandidateProvider(options: {
  provider: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): SearchCandidateProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return async (input) => {
    if (!fetchImpl) throw new WebRuntimeError('provider_unavailable', 'fetch is unavailable');
    const url = new URL(options.baseUrl);
    if (!url.searchParams.has('q')) url.searchParams.set('q', input.query);
    if (!url.searchParams.has('format')) url.searchParams.set('format', 'json');
    const startedAt = Date.now();
    const response = await fetchImpl(url, { signal: input.signal, headers: { accept: 'application/json' } });
    const providerMs = Date.now() - startedAt;
    if (response.status === 429) throw new WebRuntimeError('rate_limited', `${options.provider} returned 429 rate_limited.`);
    if (!response.ok) throw new WebRuntimeError('provider_unavailable', `${options.provider} returned HTTP ${response.status}.`);
    const parseStartedAt = Date.now();
    let payload: any;
    try {
      payload = await response.json();
    } catch (error) {
      throw new WebRuntimeError('provider_unavailable', `${options.provider} returned malformed JSON: ${errorMessage(error)}`);
    }
    const rawResults = firstArray(payload?.results, payload?.organic_results, payload?.items, payload?.data);
    const results = rawResults.map((item: any) => ({
      title: stringOrUndefined(item?.title) ?? stringOrUndefined(item?.url) ?? stringOrUndefined(item?.link) ?? 'Untitled',
      url: stringOrUndefined(item?.url) ?? stringOrUndefined(item?.link) ?? '',
      snippet: stringOrUndefined(item?.content) ?? stringOrUndefined(item?.snippet) ?? stringOrUndefined(item?.description),
      source: stringOrUndefined(item?.engine) ?? stringOrUndefined(item?.source),
      publishedAt: stringOrUndefined(item?.publishedDate) ?? stringOrUndefined(item?.publishedAt) ?? stringOrUndefined(item?.published_at),
      provider: options.provider,
    })).filter((item: WebSearchCandidate) => item.url);
    return {
      provider: options.provider,
      results,
      timings: { providerMs, parseMs: Date.now() - parseStartedAt },
      diagnostics: [],
    };
  };
}

export function createStaticFetchReadProvider(options: {
  fetchImpl?: typeof fetch;
} = {}): WebReadProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return async (input) => {
    if (!fetchImpl) throw new WebRuntimeError('provider_unavailable', 'fetch is unavailable');
    if (input.render === 'browser') throw new WebRuntimeError('needs_browser', 'Browser render fallback is not configured for this runtime.');
    const fetchStartedAt = Date.now();
    const response = await fetchImpl(input.url, {
      redirect: 'follow',
      signal: input.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': 'SciForge-WebRuntime/1.0 (+https://github.com/)',
      },
    });
    const fetchMs = Date.now() - fetchStartedAt;
    if (response.status === 401 || response.status === 403) {
      throw new WebRuntimeError('needs_user_browser', `HTTP ${response.status} requires user/session access.`);
    }
    if (!response.ok) throw new WebRuntimeError('read_failed', `HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const raw = await response.text();
    const extractStartedAt = Date.now();
    const finalUrl = response.url || input.url;
    const extracted = contentType.includes('html')
      ? await extractStaticHtmlPage({ html: raw, url: finalUrl, contentType })
      : undefined;
    const title = extracted?.title ?? titleFromHtml(raw);
    const text = extracted?.text ?? raw;
    const markdown = extracted?.markdown ?? raw;
    const extractMs = Date.now() - extractStartedAt;
    if (!text.trim()) throw new WebRuntimeError('extract_failed', 'No readable text was extracted.');
    return {
      provider: 'static-fetch',
      requestedUrl: input.url,
      finalUrl,
      title,
      contentType,
      markdown: contentType.includes('html') ? markdown : fencedPlainText(text),
      text: contentType.includes('html') ? text : markdownToPlainText(text),
      timings: { fetchMs, extractMs },
      diagnostics: extracted
        ? [{
            code: 'extract_method',
            message: `Static HTML extraction used ${extracted.method}.`,
            severity: 'info',
          }]
        : [],
    };
  };
}

function defaultSearchProvider(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): SearchCandidateProvider | undefined {
  const explicitProvider = cleanProviderName(env.SCIFORGE_WEB_SEARCH_PROVIDER ?? env.SCIFORGE_WEB_SEARCH_PROVIDER_ID);
  const explicitBaseUrl = firstNonEmpty(
    env.SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL,
    env.SCIFORGE_WEB_SEARCH_BASE_URL,
    env.WEB_SEARCH_PROVIDER_BASE_URL,
  );
  const searxngUrl = firstNonEmpty(
    explicitProvider === 'searxng' ? explicitBaseUrl : undefined,
    env.SCIFORGE_SEARXNG_BASE_URL,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_BASE_URL,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_URL,
    env.SEARXNG_BASE_URL,
    env.SEARXNG_URL,
  );
  const openserpUrl = firstNonEmpty(
    explicitProvider === 'openserp' ? explicitBaseUrl : undefined,
    env.SCIFORGE_OPENSERP_BASE_URL,
    env.OPENSERP_BASE_URL,
    env.OPEN_SERP_BASE_URL,
  );
  if (searxngUrl?.trim()) {
    return createSearxngSearchCandidateProvider({
      baseUrl: searxngUrl.trim(),
      searchParams: buildSearxngSearchParams(env),
      headers: buildSearxngHeaders(env),
      fetchImpl,
    });
  }
  if (openserpUrl?.trim() && (explicitProvider === 'openserp' || truthyEnv(env.SCIFORGE_OPENSERP_ENABLED) || truthyEnv(env.OPENSERP_ENABLED))) {
    return createOpenSerpSearchCandidateProvider({
      baseUrl: openserpUrl.trim(),
      fetchImpl,
    });
  }
  if (explicitBaseUrl?.trim()) {
    return createGenericJsonSearchCandidateProvider({
      provider: explicitProvider || 'generic-json',
      baseUrl: explicitBaseUrl.trim(),
      fetchImpl,
    });
  }
  return undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function cleanProviderName(value: string | undefined): string | undefined {
  const clean = value?.trim().toLowerCase();
  return clean || undefined;
}

function buildSearxngSearchParams(env: NodeJS.ProcessEnv): Record<string, string> {
  const params = parseKeyValueConfig(firstNonEmpty(
    env.SCIFORGE_SEARXNG_SEARCH_PARAMS,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_SEARCH_PARAMS,
    env.SEARXNG_SEARCH_PARAMS,
  ));
  const preset = searxngPreset(firstNonEmpty(
    env.SCIFORGE_SEARXNG_PRESET,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_PRESET,
    env.SEARXNG_PRESET,
  ));
  const categories = firstNonEmpty(
    env.SCIFORGE_SEARXNG_CATEGORIES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_CATEGORIES,
    env.SEARXNG_CATEGORIES,
    preset?.categories,
  );
  const engines = firstNonEmpty(
    env.SCIFORGE_SEARXNG_ENGINES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_ENGINES,
    env.SEARXNG_ENGINES,
    preset?.engines,
  );
  const disabledEngines = firstNonEmpty(
    env.SCIFORGE_SEARXNG_DISABLED_ENGINES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_DISABLED_ENGINES,
    env.SEARXNG_DISABLED_ENGINES,
  );
  if (categories) params.categories = categories;
  if (engines) params.engines = engines;
  if (disabledEngines) params.disabled_engines = disabledEngines;
  delete params.q;
  delete params.format;
  return sanitizeProviderSearchParams(params);
}

function searxngPreset(value: string | undefined): { categories?: string; engines?: string } | undefined {
  const key = value?.trim().toLowerCase();
  if (!key) return undefined;
  return key === 'docs' || key === 'science' || key === 'stable' ? SEARXNG_PRESETS[key] : undefined;
}

function buildSearxngHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  return sanitizeProviderHeaders(parseKeyValueConfig(firstNonEmpty(
    env.SCIFORGE_SEARXNG_HEADERS,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_HEADERS,
    env.SEARXNG_HEADERS,
  )));
}

function parseKeyValueConfig(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed)
        .map(([key, item]) => [key.trim(), String(item).trim()])
        .filter(([key, item]) => key && item));
    } catch {
      return {};
    }
  }
  return Object.fromEntries([...new URLSearchParams(raw).entries()]
    .map(([key, item]) => [key.trim(), item.trim()])
    .filter(([key, item]) => key && item));
}

function sanitizeProviderSearchParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params)
    .filter(([key, value]) => /^[a-zA-Z0-9_.-]+$/.test(key) && safeProviderHeaderOrParamValue(value)));
}

function sanitizeProviderHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers)
    .filter(([key, value]) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key) && safeProviderHeaderOrParamValue(value)));
}

function safeProviderHeaderOrParamValue(value: string): boolean {
  return Boolean(value.trim()) && !/[\r\n]/.test(value);
}

function unavailableSearchProvider(): SearchCandidateProvider {
  return async () => {
    throw new WebRuntimeError('provider_unavailable', 'No web search provider is configured.');
  };
}

function parseSearchInput(input: unknown): ParseResult<WebSearchProviderInput> {
  if (!isRecord(input)) return parseFail('invalid_input', 'missing_input');
  const unknown = unknownFields(input, ['schemaVersion', 'query', 'limit', 'language', 'region', 'timeRange', 'time_range', 'safeSearch', 'safe_search', 'provider', 'timeoutMs', 'timeout_ms', 'constraints']);
  if (unknown.length) return parseFail('invalid_input', `unknown_input_fields:${unknown.join(',')}`);
  if (input.schemaVersion !== WEB_SEARCH_INPUT_SCHEMA_VERSION) return parseFail('invalid_input', 'invalid_schemaVersion');
  const query = stringOrUndefined(input.query);
  if (!query) return parseFail('invalid_input', 'missing_query');
  const limit = integerInRange(input.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  if (limit === undefined) return parseFail('invalid_input', 'invalid_limit');
  const timeoutMs = integerInRange(input.timeoutMs ?? input.timeout_ms, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
  if (timeoutMs === undefined) return parseFail('invalid_input', 'invalid_timeout_ms');
  return {
    ok: true,
    value: {
      query,
      limit,
      language: stringOrUndefined(input.language),
      region: stringOrUndefined(input.region),
      timeRange: stringOrUndefined(input.timeRange) ?? stringOrUndefined(input.time_range),
      safeSearch: stringOrUndefined(input.safeSearch) ?? stringOrUndefined(input.safe_search),
      timeoutMs,
    },
  };
}

interface ParsedReadInput {
  url?: string;
  resourceRef?: string;
  format: WebReadFormat;
  render: WebReadRenderMode;
  maxChars: number;
  timeoutMs: number;
}

function parseReadInput(input: unknown): ParseResult<ParsedReadInput> {
  if (!isRecord(input)) return parseFail('invalid_input', 'missing_input');
  const unknown = unknownFields(input, ['schemaVersion', 'url', 'resourceRef', 'resource_ref', 'format', 'render', 'maxChars', 'max_chars', 'timeoutMs', 'timeout_ms', 'cachePolicy', 'cache_policy', 'constraints']);
  if (unknown.length) return parseFail('invalid_input', `unknown_input_fields:${unknown.join(',')}`);
  if (input.schemaVersion !== WEB_READ_INPUT_SCHEMA_VERSION) return parseFail('invalid_input', 'invalid_schemaVersion');
  const url = stringOrUndefined(input.url);
  const resourceRef = stringOrUndefined(input.resourceRef) ?? stringOrUndefined(input.resource_ref);
  if (Number(Boolean(url)) + Number(Boolean(resourceRef)) !== 1) return parseFail('invalid_input', 'provide_exactly_one_of_url_or_resourceRef');
  const format = readFormat(input.format);
  if (!format) return parseFail('invalid_input', 'invalid_format');
  const render = readRenderMode(input.render);
  if (!render) return parseFail('invalid_input', 'invalid_render');
  const maxChars = integerInRange(input.maxChars ?? input.max_chars, DEFAULT_READ_MAX_CHARS, 1, MAX_READ_MAX_CHARS);
  if (maxChars === undefined) return parseFail('invalid_input', 'invalid_max_chars');
  const timeoutMs = integerInRange(input.timeoutMs ?? input.timeout_ms, DEFAULT_TIMEOUT_MS, 1, MAX_TIMEOUT_MS);
  if (timeoutMs === undefined) return parseFail('invalid_input', 'invalid_timeout_ms');
  return { ok: true, value: { url, resourceRef, format, render, maxChars, timeoutMs } };
}

async function resolveReadUrl(workspaceRoot: string, input: ParsedReadInput): Promise<ParseResult<{ url: string }>> {
  if (input.url) return { ok: true, value: { url: input.url } };
  const ref = input.resourceRef ?? '';
  if (!ref.startsWith('web-page:')) return parseFail('invalid_input', 'resourceRef_must_be_web_page');
  const id = ref.slice('web-page:'.length);
  if (!safeRefId(id)) return parseFail('invalid_input', 'invalid_resourceRef');
  try {
    const text = await readFile(join(webRuntimeDir(workspaceRoot), 'pages', `${id}.json`), 'utf8');
    const page = JSON.parse(text) as StoredWebPageRef;
    if (page.ref !== ref || !page.url) return parseFail('invalid_input', 'invalid_resourceRef');
    return { ok: true, value: { url: page.url } };
  } catch {
    return parseFail('invalid_input', 'unknown_resourceRef');
  }
}

function normalizeSearchCandidates(candidates: WebSearchCandidate[], input: {
  limit: number;
  provider: string;
  searchRef: string;
  searchId: string;
}) {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const results: NormalizedCandidate[] = [];
  for (const candidate of candidates) {
    const canonical = canonicalHttpUrl(candidate.url);
    if (!canonical) {
      warnings.push('candidate_filtered_unsafe_or_invalid_url');
      continue;
    }
    if (isSearchEngineSelfLink(canonical)) {
      warnings.push('candidate_filtered_search_engine_self_link');
      continue;
    }
    if (seen.has(canonical)) {
      warnings.push('candidate_filtered_duplicate_url');
      continue;
    }
    seen.add(canonical);
    const rank = results.length + 1;
    const pageId = `${input.searchId}-${rank}`;
    results.push({
      rank,
      title: boundedText(candidate.title || canonical, 500),
      url: canonical,
      snippet: boundedOptionalText(candidate.snippet, 1_000),
      source: boundedOptionalText(candidate.source, 200),
      publishedAt: boundedOptionalText(candidate.publishedAt, 100),
      provider: candidate.provider || input.provider,
      resourceRef: `web-page:${pageId}`,
      evidenceState: 'candidate_only',
    });
    if (results.length >= input.limit) break;
  }
  return { results, warnings: uniqueStrings(warnings) };
}

async function persistSearchResult(workspaceRoot: string, input: {
  searchId: string;
  searchRef: string;
  query: string;
  provider: string;
  discoveredAt: string;
  candidates: NormalizedCandidate[];
}) {
  const base = await ensureWebRuntimeDirs(workspaceRoot);
  const pages: StoredWebPageRef[] = input.candidates.map((candidate) => ({
    schemaVersion: WEB_RUNTIME_RESULT_SCHEMA_VERSION,
    ref: candidate.resourceRef,
    searchRef: input.searchRef,
    discoveredAt: input.discoveredAt,
    rank: candidate.rank,
    title: candidate.title,
    url: candidate.url,
    snippet: candidate.snippet,
    source: candidate.source,
    provider: candidate.provider,
    publishedAt: candidate.publishedAt,
  }));
  await Promise.all(pages.map((page) =>
    writeFile(join(base, 'pages', `${page.ref.slice('web-page:'.length)}.json`), JSON.stringify(page, null, 2), 'utf8'),
  ));
  await writeFile(join(base, 'searches', `${input.searchId}.json`), JSON.stringify({
    schemaVersion: WEB_RUNTIME_RESULT_SCHEMA_VERSION,
    ref: input.searchRef,
    query: input.query,
    provider: input.provider,
    discoveredAt: input.discoveredAt,
    resultRefs: input.candidates.map((candidate) => candidate.resourceRef),
    results: input.candidates,
  }, null, 2), 'utf8');
}

async function persistReadResult(workspaceRoot: string, input: {
  sourceId: string;
  sourceRef: string;
  textRef: string;
  text: string;
  metadata: Record<string, unknown>;
}) {
  const base = await ensureWebRuntimeDirs(workspaceRoot);
  await Promise.all([
    writeFile(join(base, 'sources', `${input.sourceId}.json`), JSON.stringify(input.metadata, null, 2), 'utf8'),
    writeFile(join(base, 'texts', `${input.sourceId}.md`), input.text, 'utf8'),
  ]);
}

async function ensureWebRuntimeDirs(workspaceRoot: string) {
  const base = webRuntimeDir(workspaceRoot);
  await Promise.all([
    mkdir(join(base, 'searches'), { recursive: true }),
    mkdir(join(base, 'pages'), { recursive: true }),
    mkdir(join(base, 'sources'), { recursive: true }),
    mkdir(join(base, 'texts'), { recursive: true }),
  ]);
  await ensureWorkspaceRuntimeGitignore(workspaceRoot);
  return base;
}

function webRuntimeDir(workspaceRoot: string) {
  return join(workspaceRoot, WEB_RUNTIME_ROOT);
}

async function ensureWorkspaceRuntimeGitignore(workspaceRoot: string) {
  const gitignorePath = join(workspaceRoot, '.gitignore');
  let current = '';
  try {
    current = await readFile(gitignorePath, 'utf8');
  } catch {
    current = '';
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === '.sciforge/')) return;
  const prefix = current && !current.endsWith('\n') ? `${current}\n` : current;
  await writeFile(gitignorePath, `${prefix}.sciforge/\n`, 'utf8');
}

function safeHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'unsupported_protocol' };
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return { ok: false, reason: 'local_hostname_blocked' };
  }
  if (hostname === 'metadata.google.internal') return { ok: false, reason: 'metadata_endpoint_blocked' };
  if (isUnsafeIpv4(hostname) || isUnsafeIpv6(hostname)) return { ok: false, reason: 'private_or_special_ip_blocked' };
  return { ok: true, url };
}

function canonicalHttpUrl(raw: string): string | undefined {
  const safe = safeHttpUrl(raw);
  if (!safe.ok) return undefined;
  const url = safe.url;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString();
}

function searchEndpointUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (!/\/search\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`;
  }
  return url;
}

function isUnsafeIpv4(hostname: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 198 && (b === 18 || b === 19));
}

function isUnsafeIpv6(hostname: string) {
  const value = hostname.toLowerCase();
  return value === '::1'
    || value === '::'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe80:')
    || value.startsWith('0:0:0:0:0:0:0:1');
}

function isSearchEngineSelfLink(url: string) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  return /(^|\.)google\./.test(host) && parsed.pathname.startsWith('/search')
    || /(^|\.)bing\.com$/.test(host) && parsed.pathname.startsWith('/search')
    || /(^|\.)duckduckgo\.com$/.test(host) && parsed.pathname === '/'
    || /(^|\.)searx/.test(host) && parsed.pathname.startsWith('/search');
}

function titleFromHtml(html: string): string | undefined {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return title ? collapseWhitespace(decodeHtmlEntities(stripTags(title))).slice(0, 500) : undefined;
}

function extractReadableTextFromHtml(html: string) {
  const scoped = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    ?? html;
  const withoutNoise = scoped
    .replace(/<script\b[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<canvas\b[\s\S]*?<\/canvas>/gi, '\n')
    .replace(/<(nav|header|footer|aside|form|button|dialog)\b[\s\S]*?<\/\1>/gi, '\n');
  const markdown = withoutNoise
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<(p|div|section|article|br|tr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr)>/gi, '\n')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  return collapseMarkdown(decodeHtmlEntities(stripTags(markdown)));
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    });
}

function markdownToPlainText(markdown: string) {
  return collapseMarkdown(markdown.replace(/^#{1,6}\s+/gm, '').replace(/^\s*-\s+/gm, '- '));
}

function fencedPlainText(text: string) {
  return text;
}

function collapseMarkdown(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => collapseWhitespace(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function contentForFormat(result: WebReadProviderResult, format: WebReadFormat) {
  if (format === 'metadata') return JSON.stringify({
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    title: result.title,
    author: result.author,
    publishedAt: result.publishedAt,
    contentType: result.contentType,
    language: result.language,
  }, null, 2);
  if (format === 'html') return result.html ?? result.markdown ?? result.text ?? '';
  if (format === 'text') return result.text ?? markdownToPlainText(result.markdown ?? result.html ?? '');
  return result.markdown ?? result.text ?? '';
}

function toolResult(input: Omit<WebRuntimeToolResult, 'schemaVersion'>): WebRuntimeToolResult {
  return {
    schemaVersion: WEB_RUNTIME_RESULT_SCHEMA_VERSION,
    ...input,
    refs: uniqueStrings(input.refs),
    warnings: uniqueStrings(input.warnings),
  };
}

function failTool(tool: WebToolName, code: WebRuntimeErrorCode, message: string, detail: {
  provider?: string;
  timings?: Record<string, number>;
  diagnostics?: WebRuntimeDiagnostic[];
  warnings?: string[];
} = {}): ModuleResultEnvelope {
  return moduleResult({
    moduleId: WEB_RUNTIME_MODULE_ID,
    ok: false,
    error: code,
    value: toolResult({
      ok: false,
      status: failureStatus(code),
      tool,
      provider: detail.provider,
      data: {
        evidenceState: 'none',
        evidenceBoundary: tool === 'web_search'
          ? 'No source evidence was materialized. web_search failures cannot be used as page evidence.'
          : 'No source evidence was materialized. Failed web_read results cannot satisfy source evidence.',
      },
      refs: [],
      timings: detail.timings ?? {},
      warnings: detail.warnings ?? [],
      diagnostics: detail.diagnostics ?? [],
      error: { code, message },
    }),
  });
}

function failureStatus(code: WebRuntimeErrorCode): WebRuntimeStatus {
  if (code === 'needs_browser' || code === 'needs_user_browser') return 'blocked';
  if (code === 'no_results') return 'partial';
  return 'failed';
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WebRuntimeErrorCode; message: string };

function parseFail<T>(code: WebRuntimeErrorCode, message: string): ParseResult<T> {
  return { ok: false, code, message };
}

function timeoutAbort(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new WebRuntimeError('timeout', 'operation timed out')), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function errorCode(error: unknown): WebRuntimeErrorCode {
  if (error instanceof WebRuntimeError) return error.code;
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  const message = errorMessage(error);
  if (/aborted|timeout/i.test(message)) return 'timeout';
  return 'provider_unavailable';
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return scrubWebRuntimeText(error.message);
  return scrubWebRuntimeText(String(error));
}

function integerInRange(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value)) return undefined;
  const numeric = Number(value);
  return numeric >= min && numeric <= max ? numeric : undefined;
}

function readFormat(value: unknown): WebReadFormat | undefined {
  if (value === undefined || value === null || value === '') return 'markdown';
  return value === 'markdown' || value === 'text' || value === 'html' || value === 'metadata' ? value : undefined;
}

function readRenderMode(value: unknown): WebReadRenderMode | undefined {
  if (value === undefined || value === null || value === '') return 'auto';
  return value === 'auto' || value === 'static' || value === 'browser' ? value : undefined;
}

function unknownFields(input: Record<string, unknown>, allowed: string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(input).filter((key) => !allowedSet.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstArray(...values: unknown[]) {
  return values.find((value): value is unknown[] => Array.isArray(value)) ?? [];
}

function truthyEnv(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test((value ?? '').trim());
}

function boundedText(value: string, maxLength: number) {
  return collapseWhitespace(value).slice(0, maxLength);
}

function boundedOptionalText(value: unknown, maxLength: number) {
  return typeof value === 'string' && value.trim() ? boundedText(value, maxLength) : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function numberRecord(value: object) {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function webArtifactId(prefix: string, seed: string) {
  return `${prefix}-${sha1(`${seed}:${Date.now()}:${randomUUID()}`).slice(0, 16)}`;
}

function safeRefId(value: string) {
  return /^[a-z0-9._-]+$/i.test(value);
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function scrubWebRuntimeText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)=([^&\s]+)/gi, '$1=[redacted-secret]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}/gi, '[redacted-secret]')
    .replace(/(^|[\s"'([{<])((?:\/(?:Applications|Users|private|var|tmp|etc|opt|home)\/[^\s"'<>),;\]}]+)|(?:[A-Za-z]:\\[^\s"'<>),;\]}]+))/g, '$1[redacted-local-path]');
}
