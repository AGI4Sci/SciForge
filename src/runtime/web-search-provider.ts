export type WebSearchErrorCode =
  | 'invalid_input'
  | 'unsafe_url'
  | 'provider_unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'no_results';

export type WebSearchProviderStatus =
  | 'completed'
  | WebSearchErrorCode;

export interface WebSearchFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type WebSearchFetch = (
  url: string | URL,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<WebSearchFetchResponse>;

export interface SearchCandidateProviderRequest {
  query: string;
  limit: number;
  language?: string;
  region?: string;
  timeRange?: string;
  safeSearch?: string;
  timeoutMs: number;
}

export interface SearchCandidate {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  publishedAt?: string;
}

export interface SearchProviderDiagnostics {
  providerDegraded?: boolean;
  timeout?: boolean;
  rateLimited?: boolean;
  noResults?: boolean;
  malformedJson?: boolean;
  disabled?: boolean;
  missingConfiguration?: boolean;
  retryCount?: number;
  suggestedAction?: string;
  [key: string]: boolean | string | number | undefined;
}

export interface SearchCandidateProviderResult {
  status: WebSearchProviderStatus;
  candidates: SearchCandidate[];
  error?: {
    code: WebSearchErrorCode;
    message: string;
  };
  diagnostics: SearchProviderDiagnostics;
  timings: {
    fetchMs: number;
    parseMs: number;
  };
}

export interface SearchCandidateProvider {
  id: string;
  selfLinkBaseUrl?: string;
  search(request: SearchCandidateProviderRequest): Promise<SearchCandidateProviderResult>;
}

export interface WebSearchProviderConfig {
  baseUrl?: string;
  timeoutMs?: number;
  enabled?: boolean;
  searxng?: {
    baseUrl?: string;
    timeoutMs?: number;
    enabled?: boolean;
    preset?: string;
    categories?: string;
    engines?: string;
    disabledEngines?: string;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  };
  openserp?: {
    baseUrl?: string;
    timeoutMs?: number;
    enabled?: boolean;
  };
}

export interface SearxngSearchProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  config?: WebSearchProviderConfig;
  fetch?: WebSearchFetch;
  preset?: string;
  categories?: string;
  engines?: string;
  disabledEngines?: string;
  searchParams?: Record<string, string>;
  headers?: Record<string, string>;
}

export function createSearxngSearchProvider(options: SearxngSearchProviderOptions = {}): SearchCandidateProvider {
  const env = options.env ?? process.env;
  const baseUrl = firstNonEmpty(
    options.baseUrl,
    options.config?.searxng?.baseUrl,
    options.config?.baseUrl,
    env.SCIFORGE_SEARXNG_BASE_URL,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_BASE_URL,
    env.SEARXNG_BASE_URL,
  );
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    options.config?.searxng?.timeoutMs,
    options.config?.timeoutMs,
  );
  return new SearxngSearchProvider({
    baseUrl,
    timeoutMs,
    fetch: options.fetch,
    searchParams: buildSearxngSearchParams(options, env),
    headers: buildSearxngHeaders(options, env),
  });
}

export interface OpenSerpSearchProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  enabled?: boolean;
  env?: Record<string, string | undefined>;
  config?: WebSearchProviderConfig;
  fetch?: WebSearchFetch;
}

export function createOpenSerpSearchProvider(options: OpenSerpSearchProviderOptions = {}): SearchCandidateProvider {
  const env = options.env ?? process.env;
  const enabled = options.enabled
    ?? options.config?.openserp?.enabled
    ?? env.SCIFORGE_OPENSERP_ENABLED === '1';
  const baseUrl = firstNonEmpty(
    options.baseUrl,
    options.config?.openserp?.baseUrl,
    env.SCIFORGE_OPENSERP_BASE_URL,
    env.OPENSERP_BASE_URL,
  );
  if (!enabled || !baseUrl) {
    return {
      id: 'openserp',
      selfLinkBaseUrl: baseUrl,
      async search() {
        return providerFailure('provider_unavailable', 'OpenSERP provider is disabled or missing baseUrl.', {
          disabled: !enabled,
          missingConfiguration: !baseUrl,
        });
      },
    };
  }
  return new OpenSerpSearchProvider({
    baseUrl,
    timeoutMs: positiveInteger(options.timeoutMs, options.config?.openserp?.timeoutMs),
    fetch: options.fetch,
  });
}

class SearxngSearchProvider implements SearchCandidateProvider {
  id = 'searxng';
  selfLinkBaseUrl?: string;

  private readonly baseUrl?: string;
  private readonly timeoutMs?: number;
  private readonly fetch: WebSearchFetch;
  private readonly searchParams: Record<string, string>;
  private readonly headers: Record<string, string>;

  constructor(options: {
    baseUrl?: string;
    timeoutMs?: number;
    fetch?: WebSearchFetch;
    searchParams?: Record<string, string>;
    headers?: Record<string, string>;
  }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.selfLinkBaseUrl = this.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalFetch;
    this.searchParams = sanitizeProviderSearchParams(options.searchParams ?? {});
    this.headers = sanitizeProviderHeaders(options.headers ?? {});
  }

  async search(request: SearchCandidateProviderRequest): Promise<SearchCandidateProviderResult> {
    if (!this.baseUrl) {
      return providerFailure('provider_unavailable', 'SearXNG provider baseUrl is not configured.', {
        missingConfiguration: true,
      });
    }

    const url = searchEndpointUrl(this.baseUrl);
    for (const [key, value] of Object.entries(this.searchParams)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'json');
    if (request.language) url.searchParams.set('language', request.language);
    if (request.timeRange) url.searchParams.set('time_range', request.timeRange);
    const safeSearch = searxngSafeSearch(request.safeSearch);
    if (safeSearch) url.searchParams.set('safesearch', safeSearch);

    return fetchJsonCandidates({
      providerId: this.id,
      url,
      fetch: this.fetch,
      headers: this.headers,
      timeoutMs: this.timeoutMs ?? request.timeoutMs,
      mapPayload: searxngCandidatesFromPayload,
    });
  }
}

class OpenSerpSearchProvider implements SearchCandidateProvider {
  id = 'openserp';
  selfLinkBaseUrl?: string;

  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetch: WebSearchFetch;

  constructor(options: {
    baseUrl: string;
    timeoutMs?: number;
    fetch?: WebSearchFetch;
  }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl) ?? options.baseUrl;
    this.selfLinkBaseUrl = this.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalFetch;
  }

  async search(request: SearchCandidateProviderRequest): Promise<SearchCandidateProviderResult> {
    const url = searchEndpointUrl(this.baseUrl);
    url.searchParams.set('text', request.query);
    url.searchParams.set('format', 'json');
    if (request.language) url.searchParams.set('language', request.language);
    return fetchJsonCandidates({
      providerId: this.id,
      url,
      fetch: this.fetch,
      timeoutMs: this.timeoutMs ?? request.timeoutMs,
      mapPayload: genericCandidatesFromPayload,
    });
  }
}

class GenericJsonSearchProvider implements SearchCandidateProvider {
  selfLinkBaseUrl?: string;

  private readonly baseUrl: string;
  private readonly timeoutMs?: number;
  private readonly fetch: WebSearchFetch;

  constructor(private readonly options: {
    id: string;
    baseUrl: string;
    timeoutMs?: number;
    fetch?: WebSearchFetch;
  }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl) ?? options.baseUrl;
    this.selfLinkBaseUrl = this.baseUrl;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalFetch;
  }

  get id() {
    return this.options.id;
  }

  async search(request: SearchCandidateProviderRequest): Promise<SearchCandidateProviderResult> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', request.query);
    url.searchParams.set('format', 'json');
    return fetchJsonCandidates({
      providerId: this.id,
      url,
      fetch: this.fetch,
      timeoutMs: this.timeoutMs ?? request.timeoutMs,
      mapPayload: genericCandidatesFromPayload,
    });
  }
}

async function fetchJsonCandidates(input: {
  providerId: string;
  url: URL;
  fetch: WebSearchFetch;
  headers?: Record<string, string>;
  timeoutMs: number;
  mapPayload: (payload: unknown) => SearchCandidate[];
}): Promise<SearchCandidateProviderResult> {
  const fetchStart = nowMs();
  let response: WebSearchFetchResponse;
  try {
    response = await fetchWithTimeout(input.fetch, input.url.toString(), input.timeoutMs, input.headers);
  } catch (error) {
    if (isAbortLikeError(error)) {
      return providerFailure('timeout', `${input.providerId} search timed out. Try a narrower SearXNG preset or fewer engines.`, {
        timeout: true,
        suggestedAction: 'Try SCIFORGE_SEARXNG_PRESET=docs, science, or stable, or reduce enabled SearXNG engines.',
      }, {
        fetchMs: elapsedMs(fetchStart),
        parseMs: 0,
      });
    }
    return providerFailure('provider_unavailable', `${input.providerId} search request failed: ${errorMessage(error)}`, {
      providerDegraded: true,
    }, {
      fetchMs: elapsedMs(fetchStart),
      parseMs: 0,
    });
  }
  const fetchMs = elapsedMs(fetchStart);

  if (response.status === 429) {
    return providerFailure('rate_limited', `${input.providerId} search provider returned HTTP 429.`, {
      rateLimited: true,
      providerDegraded: true,
    }, { fetchMs, parseMs: 0 });
  }
  if (!response.ok) {
    return providerFailure('provider_unavailable', `${input.providerId} search provider returned HTTP ${response.status}.`, {
      providerDegraded: true,
    }, { fetchMs, parseMs: 0 });
  }

  const parseStart = nowMs();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return providerFailure('provider_unavailable', `${input.providerId} search provider returned malformed JSON: ${errorMessage(error)}`, {
      malformedJson: true,
      providerDegraded: true,
    }, { fetchMs, parseMs: elapsedMs(parseStart) });
  }
  const candidates = input.mapPayload(payload);
  if (!candidates.length) {
    return providerFailure('no_results', `${input.providerId} search provider returned no results.`, {
      noResults: true,
    }, { fetchMs, parseMs: elapsedMs(parseStart) });
  }
  return {
    status: 'completed',
    candidates,
    diagnostics: { retryCount: 0 },
    timings: { fetchMs, parseMs: elapsedMs(parseStart) },
  };
}

function searxngCandidatesFromPayload(payload: unknown): SearchCandidate[] {
  const results = arrayField(recordField(payload), 'results');
  return results.map((item) => {
    const record = recordField(item);
    return {
      title: stringField(record, 'title'),
      url: stringField(record, 'url'),
      snippet: stringField(record, 'content') || stringField(record, 'snippet'),
      source: stringField(record, 'engine') || arrayField(record, 'engines').map((engine) => String(engine)).filter(Boolean).join(', '),
      publishedAt: stringField(record, 'publishedDate')
        || stringField(record, 'publishedAt')
        || stringField(record, 'published_at'),
    };
  }).filter((item) => item.title || item.url);
}

function genericCandidatesFromPayload(payload: unknown): SearchCandidate[] {
  const record = recordField(payload);
  const results = arrayField(record, 'results').length
    ? arrayField(record, 'results')
    : arrayField(record, 'organic_results');
  return results.map((item) => {
    const value = recordField(item);
    return {
      title: stringField(value, 'title'),
      url: stringField(value, 'url') || stringField(value, 'link'),
      snippet: stringField(value, 'snippet') || stringField(value, 'content'),
      source: stringField(value, 'source') || stringField(value, 'engine'),
      publishedAt: stringField(value, 'publishedAt') || stringField(value, 'date'),
    };
  }).filter((item) => item.title || item.url);
}

function providerFailure(
  code: Exclude<WebSearchProviderStatus, 'completed'>,
  message: string,
  diagnostics: SearchProviderDiagnostics = {},
  timings: { fetchMs: number; parseMs: number } = { fetchMs: 0, parseMs: 0 },
): SearchCandidateProviderResult {
  return {
    status: code,
    candidates: [],
    error: { code, message },
    diagnostics: { retryCount: 0, ...diagnostics },
    timings,
  };
}

async function fetchWithTimeout(
  fetcher: WebSearchFetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<WebSearchFetchResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Search provider request timed out.'), { name: 'AbortError' }));
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([
      fetcher(url, { signal: controller.signal, headers: { ...headers, Accept: 'application/json' } }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SEARXNG_PRESETS = {
  docs: { engines: 'mdn,github' },
  science: { categories: 'science', engines: 'openalex,crossref,arxiv' },
  stable: { engines: 'mdn,github,openalex,crossref,arxiv' },
} as const;

function buildSearxngSearchParams(
  options: SearxngSearchProviderOptions,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const params = {
    ...parseKeyValueConfig(firstNonEmpty(
      env.SCIFORGE_SEARXNG_SEARCH_PARAMS,
      env.SCIFORGE_WEB_SEARCH_SEARXNG_SEARCH_PARAMS,
      env.SEARXNG_SEARCH_PARAMS,
    )),
    ...(options.config?.searxng?.searchParams ?? {}),
    ...(options.searchParams ?? {}),
  };
  const preset = searxngPreset(firstNonEmpty(
    options.preset,
    options.config?.searxng?.preset,
    env.SCIFORGE_SEARXNG_PRESET,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_PRESET,
    env.SEARXNG_PRESET,
  ));
  const categories = firstNonEmpty(
    options.categories,
    options.config?.searxng?.categories,
    env.SCIFORGE_SEARXNG_CATEGORIES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_CATEGORIES,
    env.SEARXNG_CATEGORIES,
    preset?.categories,
  );
  const engines = firstNonEmpty(
    options.engines,
    options.config?.searxng?.engines,
    env.SCIFORGE_SEARXNG_ENGINES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_ENGINES,
    env.SEARXNG_ENGINES,
    preset?.engines,
  );
  const disabledEngines = firstNonEmpty(
    options.disabledEngines,
    options.config?.searxng?.disabledEngines,
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

function buildSearxngHeaders(
  options: SearxngSearchProviderOptions,
  env: Record<string, string | undefined>,
): Record<string, string> {
  return sanitizeProviderHeaders({
    ...parseKeyValueConfig(firstNonEmpty(
      env.SCIFORGE_SEARXNG_HEADERS,
      env.SCIFORGE_WEB_SEARCH_SEARXNG_HEADERS,
      env.SEARXNG_HEADERS,
    )),
    ...(options.config?.searxng?.headers ?? {}),
    ...(options.headers ?? {}),
  });
}

function searxngPreset(value: string | undefined): { categories?: string; engines?: string } | undefined {
  const key = value?.trim().toLowerCase();
  if (!key) return undefined;
  return key === 'docs' || key === 'science' || key === 'stable' ? SEARXNG_PRESETS[key] : undefined;
}

function parseKeyValueConfig(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
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

function searchEndpointUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (!/\/search\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`;
  }
  return url;
}

function searxngSafeSearch(value: string | undefined): string | undefined {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'off' || normalized === 'none' || normalized === '0') return '0';
  if (normalized === 'strict' || normalized === '2') return '2';
  return '1';
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  try {
    return new URL(clean).toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function positiveInteger(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (Number.isFinite(value) && Number(value) > 0) return Math.floor(Number(value));
  }
  return undefined;
}

function globalFetch(url: string | URL, init?: { signal?: AbortSignal; headers?: Record<string, string> }) {
  return fetch(url, init) as Promise<WebSearchFetchResponse>;
}

function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function nowMs() {
  return performance.now();
}

function elapsedMs(start: number) {
  return Math.max(0, Math.round((nowMs() - start) * 1000) / 1000);
}

function isAbortLikeError(error: unknown) {
  const record = recordField(error);
  return record.name === 'AbortError' || /abort|timeout/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
