import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';

import {
  extractStaticHtmlPage,
  type WebReadHtmlExtractor,
} from './web-read-extract.js';
import { normalizeWorkspaceRootPath } from './workspace-paths.js';
import { sha1 } from './workspace-task-runner.js';

const WEB_READ_SOURCE_SCHEMA = 'sciforge.web-read.source.v1' as const;
const WEB_READ_CACHE_SCHEMA = 'sciforge.web-read.cache.v1' as const;
const WEB_READ_PROVIDER = 'static-fetch' as const;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_CHARS = 4_000;
const DEFAULT_REDIRECT_LIMIT = 5;

export type WebReadErrorCode =
  | 'invalid_input'
  | 'unsafe_url'
  | 'timeout'
  | 'read_failed'
  | 'extract_failed'
  | 'needs_browser'
  | 'needs_user_browser';

export type WebReadStatus = 'read' | 'partial' | 'blocked' | 'failed';
export type WebReadFormat = 'markdown' | 'text' | 'html' | 'metadata';
export type WebReadCachePolicy = 'default' | 'bypass' | 'refresh';
export type WebReadCacheStatus = 'miss' | 'hit' | 'revalidated';

export interface WebReadResourceLocator {
  url?: string;
}

export interface WebReadResourceRef {
  ref: string;
  kind: 'web_page' | 'web_source' | 'web_text' | string;
  sourceTool?: string;
  locator?: WebReadResourceLocator;
  url?: string;
  title?: string;
}

export interface WebReadNetworkPolicy {
  allowPrivateNetwork?: boolean;
}

export interface WebReadStaticInput {
  workspacePath: string;
  url?: string;
  resourceRef?: string;
  resourceRefs?: WebReadResourceRef[];
  format?: WebReadFormat;
  maxChars?: number;
  maxBytes?: number;
  timeoutMs?: number;
  redirectLimit?: number;
  networkPolicy?: WebReadNetworkPolicy;
  extractor?: WebReadHtmlExtractor;
  fetchImpl?: typeof fetch;
  cachePolicy?: WebReadCachePolicy;
  cache_policy?: WebReadCachePolicy;
  openedAt?: string;
}

export interface WebReadRefRecord {
  ref: string;
  path: string;
}

export interface WebReadRefs {
  sourcePageRef?: string;
  pageTextRef?: string;
  sourcePage?: WebReadRefRecord;
  pageText?: WebReadRefRecord;
}

export interface WebReadTimings {
  fetchMs?: number;
  extractMs?: number;
  cacheMs?: number;
  persistMs?: number;
  totalMs: number;
  cache: WebReadCacheStatus;
  cachePolicy: WebReadCachePolicy;
}

export interface WebReadDiagnostics {
  httpStatus?: number;
  requestedUrl?: string;
  finalUrl?: string;
  redirectCount?: number;
  contentType?: string;
  extractMethod?: string;
  cachePolicy?: WebReadCachePolicy;
  cacheStatus?: WebReadCacheStatus;
  cacheKey?: string;
  cachePath?: string;
  cachedAt?: string;
  blockedReason?: string;
  networkError?: string;
}

export interface WebReadData {
  requestedUrl: string;
  requestedResourceRef?: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  openedAt: string;
  text: string;
  textPreview: string;
  textCharCount: number;
  textSha1: string;
  sourcePageRef: string;
  pageTextRef: string;
}

export interface WebReadResult {
  ok: boolean;
  status: WebReadStatus;
  tool: 'web_read';
  provider: typeof WEB_READ_PROVIDER;
  data?: WebReadData;
  refs: WebReadRefs;
  timings: WebReadTimings;
  diagnostics: WebReadDiagnostics;
  warnings: string[];
  error?: {
    code: WebReadErrorCode;
    message: string;
  };
}

interface ResolvedReadTarget {
  requestedUrl: string;
  requestedResourceRef?: string;
}

interface FetchReadResult {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string;
  bodyText: string;
  redirectCount: number;
}

interface CachedWebReadRecord {
  schemaVersion: typeof WEB_READ_CACHE_SCHEMA;
  cacheKey: string;
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  format: WebReadFormat;
  text: string;
  textSha1: string;
  status: Extract<WebReadStatus, 'read' | 'partial'>;
  warnings: string[];
  diagnostics: WebReadDiagnostics;
  cachedAt: string;
}

type FailureStatus = Exclude<WebReadStatus, 'read'>;

class WebReadFailure extends Error {
  readonly code: WebReadErrorCode;
  readonly status: FailureStatus;
  readonly diagnostics: WebReadDiagnostics;

  constructor(code: WebReadErrorCode, status: FailureStatus, message: string, diagnostics: WebReadDiagnostics = {}) {
    super(message);
    this.name = 'WebReadFailure';
    this.code = code;
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

export async function readWebPageStatic(input: WebReadStaticInput): Promise<WebReadResult> {
  const totalStarted = nowMs();
  const cachePolicy = normalizeCachePolicy(input.cachePolicy ?? input.cache_policy);
  const timings: WebReadTimings = { totalMs: 0, cache: 'miss', cachePolicy };
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(input.workspacePath || process.cwd()));
  const openedAt = input.openedAt ?? new Date().toISOString();
  let target: ResolvedReadTarget | undefined;
  let cacheKey: string | undefined;
  let cachePath: string | undefined;
  try {
    target = resolveReadTarget(input);
    const initialSafety = validateSafeHttpUrl(target.requestedUrl, input.networkPolicy);
    if (!initialSafety.ok) {
      throw new WebReadFailure('unsafe_url', 'blocked', initialSafety.message, {
        requestedUrl: target.requestedUrl,
        blockedReason: initialSafety.reason,
        cachePolicy,
        cacheStatus: timings.cache,
      });
    }

    const format = input.format ?? 'text';
    cacheKey = webReadCacheKey(target.requestedUrl, format);
    cachePath = webReadCachePath(cacheKey);
    if (cachePolicy === 'default') {
      const cacheStarted = nowMs();
      const cached = await readCachedWebRead(workspaceRoot, cacheKey, format);
      timings.cacheMs = elapsedMs(cacheStarted);
      if (cached) {
        timings.cache = 'hit';
        const diagnostics = withCacheDiagnostics(cached.diagnostics, {
          cachePolicy,
          cacheStatus: 'hit',
          cacheKey,
          cachePath,
          cachedAt: cached.cachedAt,
        });
        return await materializeWebReadSuccess({
          workspaceRoot,
          target,
          openedAt,
          finalUrl: cached.finalUrl,
          title: cached.title,
          contentType: cached.contentType,
          text: cached.text,
          textSha1: cached.textSha1,
          status: cached.status,
          warnings: cached.warnings,
          diagnostics,
          timings,
          totalStarted,
          maxChars: input.maxChars,
        });
      }
    }

    const fetchStarted = nowMs();
    const fetched = await fetchStaticHtml(target.requestedUrl, input);
    timings.fetchMs = elapsedMs(fetchStarted);

    const extractStarted = nowMs();
    const extracted = await extractStaticHtmlPage({
      html: fetched.bodyText,
      url: fetched.finalUrl,
      contentType: fetched.contentType,
    }, input.extractor);
    timings.extractMs = elapsedMs(extractStarted);

    const text = contentForFormat(format, fetched.bodyText, extracted.text, extracted.markdown);
    if (!text.trim()) {
      throw new WebReadFailure('extract_failed', 'blocked', 'Static HTML extraction returned no readable page text.', {
        requestedUrl: target.requestedUrl,
        finalUrl: fetched.finalUrl,
        httpStatus: fetched.httpStatus,
        contentType: fetched.contentType,
        blockedReason: 'empty_extracted_text',
        extractMethod: extracted.method,
        cachePolicy,
        cacheStatus: timings.cache,
        ...(cacheKey ? { cacheKey } : {}),
        ...(cachePath ? { cachePath } : {}),
      });
    }

    const textSha1 = sha1(text);
    const cacheStatus: WebReadCacheStatus = cachePolicy === 'refresh' ? 'revalidated' : 'miss';
    timings.cache = cacheStatus;
    const diagnostics = withCacheDiagnostics({
      httpStatus: fetched.httpStatus,
      requestedUrl: target.requestedUrl,
      finalUrl: fetched.finalUrl,
      redirectCount: fetched.redirectCount,
      contentType: fetched.contentType,
      extractMethod: extracted.method,
    }, {
      cachePolicy,
      cacheStatus,
      cacheKey,
      cachePath,
      cachedAt: openedAt,
    });
    if (cachePolicy !== 'bypass') {
      const cacheStarted = nowMs();
      await writeCachedWebRead(workspaceRoot, {
        schemaVersion: WEB_READ_CACHE_SCHEMA,
        cacheKey,
        requestedUrl: target.requestedUrl,
        finalUrl: fetched.finalUrl,
        ...(extracted.title ? { title: extracted.title } : {}),
        contentType: fetched.contentType,
        format,
        text,
        textSha1,
        status: extracted.lowInformation ? 'partial' : 'read',
        warnings: extracted.warnings,
        diagnostics,
        cachedAt: openedAt,
      });
      timings.cacheMs = (timings.cacheMs ?? 0) + elapsedMs(cacheStarted);
    }

    return await materializeWebReadSuccess({
      workspaceRoot,
      target,
      openedAt,
      finalUrl: fetched.finalUrl,
      title: extracted.title,
      contentType: fetched.contentType,
      text,
      textSha1,
      status: extracted.lowInformation ? 'partial' : 'read',
      warnings: extracted.warnings,
      diagnostics,
      timings,
      totalStarted,
      maxChars: input.maxChars,
    });
  } catch (error) {
    timings.totalMs = elapsedMs(totalStarted);
    const failure = normalizeFailure(error, target?.requestedUrl);
    const diagnostics = withCacheDiagnostics(failure.diagnostics, {
      cachePolicy,
      cacheStatus: timings.cache,
      cacheKey,
      cachePath,
    });
    return {
      ok: false,
      status: failure.status,
      tool: 'web_read',
      provider: WEB_READ_PROVIDER,
      refs: {},
      timings,
      diagnostics,
      warnings: [],
      error: {
        code: failure.code,
        message: failure.message,
      },
    };
  }
}

function resolveReadTarget(input: WebReadStaticInput): ResolvedReadTarget {
  const hasUrl = typeof input.url === 'string' && input.url.trim().length > 0;
  const hasRef = typeof input.resourceRef === 'string' && input.resourceRef.trim().length > 0;
  if (hasUrl === hasRef) {
    throw new WebReadFailure(
      'invalid_input',
      'failed',
      'web_read requires exactly one of url or resourceRef.',
    );
  }
  if (hasUrl) return { requestedUrl: input.url!.trim() };

  const resourceRef = input.resourceRef!.trim();
  if (!resourceRef.startsWith('web-page:')) {
    throw new WebReadFailure(
      'invalid_input',
      'failed',
      'web_read resourceRef must point to a discovered web page ref.',
      { blockedReason: 'resource_ref_not_web_page' },
    );
  }
  const matched = (input.resourceRefs ?? []).find((candidate) => candidate.ref === resourceRef);
  if (!matched) {
    throw new WebReadFailure(
      'invalid_input',
      'failed',
      'web_read resourceRef is not present in the discovered web page ref index.',
      { blockedReason: 'unknown_resource_ref' },
    );
  }
  const url = matched.locator?.url ?? matched.url;
  if (matched.kind !== 'web_page' || matched.sourceTool !== 'web_search' || !url?.trim()) {
    throw new WebReadFailure(
      'invalid_input',
      'failed',
      'web_read resourceRef is not a web_search discovered web page with a URL locator.',
      { blockedReason: 'resource_ref_without_web_search_url_locator' },
    );
  }
  return { requestedUrl: url.trim(), requestedResourceRef: resourceRef };
}

async function materializeWebReadSuccess(input: {
  workspaceRoot: string;
  target: ResolvedReadTarget;
  openedAt: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  text: string;
  textSha1: string;
  status: Extract<WebReadStatus, 'read' | 'partial'>;
  warnings: string[];
  diagnostics: WebReadDiagnostics;
  timings: WebReadTimings;
  totalStarted: number;
  maxChars?: number;
}): Promise<WebReadResult> {
  const persistStarted = nowMs();
  const persisted = await persistWebReadRefs({
    workspaceRoot: input.workspaceRoot,
    finalUrl: input.finalUrl,
    openedAt: input.openedAt,
    text: input.text,
    textSha1: input.textSha1,
  });
  input.timings.persistMs = elapsedMs(persistStarted);
  input.timings.totalMs = elapsedMs(input.totalStarted);
  await writeWebReadSourceMetadata({
    workspaceRoot: input.workspaceRoot,
    sourcePage: persisted.sourcePage,
    pageText: persisted.pageText,
    requestedUrl: input.target.requestedUrl,
    requestedResourceRef: input.target.requestedResourceRef,
    finalUrl: input.finalUrl,
    title: input.title,
    contentType: input.contentType,
    openedAt: input.openedAt,
    text: input.text,
    textSha1: input.textSha1,
    timings: input.timings,
    diagnostics: input.diagnostics,
  });
  input.timings.persistMs = elapsedMs(persistStarted);
  input.timings.totalMs = elapsedMs(input.totalStarted);

  const data: WebReadData = {
    requestedUrl: input.target.requestedUrl,
    ...(input.target.requestedResourceRef ? { requestedResourceRef: input.target.requestedResourceRef } : {}),
    finalUrl: input.finalUrl,
    ...(input.title ? { title: input.title } : {}),
    contentType: input.contentType,
    openedAt: input.openedAt,
    text: input.text,
    textPreview: boundedPreview(input.text, input.maxChars),
    textCharCount: input.text.length,
    textSha1: input.textSha1,
    sourcePageRef: persisted.sourcePage.ref,
    pageTextRef: persisted.pageText.ref,
  };
  return {
    ok: true,
    status: input.status,
    tool: 'web_read',
    provider: WEB_READ_PROVIDER,
    data,
    refs: {
      sourcePageRef: persisted.sourcePage.ref,
      pageTextRef: persisted.pageText.ref,
      sourcePage: persisted.sourcePage,
      pageText: persisted.pageText,
    },
    timings: input.timings,
    diagnostics: input.diagnostics,
    warnings: input.warnings,
  };
}

async function fetchStaticHtml(requestedUrl: string, input: WebReadStaticInput): Promise<FetchReadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = boundedInteger(input.timeoutMs, 1, 120_000, DEFAULT_TIMEOUT_MS);
  const maxBytes = boundedInteger(input.maxBytes, 1, 50_000_000, DEFAULT_MAX_BYTES);
  const redirectLimit = boundedInteger(input.redirectLimit, 0, 10, DEFAULT_REDIRECT_LIMIT);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let currentUrl = requestedUrl;
    let redirectCount = 0;
    for (;;) {
      const safety = validateSafeHttpUrl(currentUrl, input.networkPolicy);
      if (!safety.ok) {
        throw new WebReadFailure('unsafe_url', 'blocked', safety.message, {
          requestedUrl,
          finalUrl: currentUrl,
          blockedReason: safety.reason,
          redirectCount,
        });
      }

      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'SciForge web_read static fetch',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
      } catch (error) {
        if (timedOut || isAbortError(error)) {
          throw new WebReadFailure('timeout', 'failed', `web_read timed out after ${timeoutMs}ms.`, {
            requestedUrl,
            finalUrl: currentUrl,
            redirectCount,
            networkError: errorMessage(error),
          });
        }
        throw new WebReadFailure('read_failed', 'failed', 'Static fetch failed before reading page content.', {
          requestedUrl,
          finalUrl: currentUrl,
          redirectCount,
          networkError: errorMessage(error),
        });
      }

      if (isRedirectStatus(response.status)) {
        if (redirectCount >= redirectLimit) {
          throw new WebReadFailure('read_failed', 'failed', 'Static fetch exceeded redirect limit.', {
            requestedUrl,
            finalUrl: currentUrl,
            httpStatus: response.status,
            redirectCount,
            blockedReason: 'redirect_limit_exceeded',
          });
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new WebReadFailure('read_failed', 'failed', 'Static fetch received a redirect without a Location header.', {
            requestedUrl,
            finalUrl: currentUrl,
            httpStatus: response.status,
            redirectCount,
            blockedReason: 'redirect_without_location',
          });
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirectCount += 1;
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new WebReadFailure('read_failed', 'blocked', `Static fetch was blocked by HTTP ${response.status}.`, {
          requestedUrl,
          finalUrl: currentUrl,
          httpStatus: response.status,
          redirectCount,
          blockedReason: `http_${response.status}`,
        });
      }
      if (response.status < 200 || response.status >= 400) {
        throw new WebReadFailure('read_failed', 'failed', `Static fetch failed with HTTP ${response.status}.`, {
          requestedUrl,
          finalUrl: currentUrl,
          httpStatus: response.status,
          redirectCount,
          blockedReason: `http_${response.status}`,
        });
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !isHtmlContentType(contentType)) {
        throw new WebReadFailure('read_failed', 'blocked', `Static web_read only accepts HTML content, got ${contentType}.`, {
          requestedUrl,
          finalUrl: currentUrl,
          httpStatus: response.status,
          redirectCount,
          contentType,
          blockedReason: 'non_html_content_type',
        });
      }

      const lengthHeader = response.headers.get('content-length');
      const contentLength = lengthHeader ? Number.parseInt(lengthHeader, 10) : Number.NaN;
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new WebReadFailure('read_failed', 'blocked', `Static fetch content-length exceeds maxBytes (${maxBytes}).`, {
          requestedUrl,
          finalUrl: currentUrl,
          httpStatus: response.status,
          redirectCount,
          contentType,
          blockedReason: 'max_bytes_exceeded',
        });
      }

      const bodyText = await readResponseTextWithLimit(response, maxBytes, contentType, {
        requestedUrl,
        finalUrl: currentUrl,
        httpStatus: response.status,
        redirectCount,
        contentType,
      });
      if (!contentType && !looksLikeHtml(bodyText)) {
        throw new WebReadFailure('read_failed', 'blocked', 'Static web_read could not sniff HTML content.', {
          requestedUrl,
          finalUrl: currentUrl,
          httpStatus: response.status,
          redirectCount,
          blockedReason: 'non_html_content_type',
        });
      }

      return {
        requestedUrl,
        finalUrl: currentUrl,
        httpStatus: response.status,
        contentType: contentType || 'text/html; charset=utf-8',
        bodyText,
        redirectCount,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  contentType: string,
  diagnostics: WebReadDiagnostics,
) {
  const chunks: Buffer[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const read = await reader.read();
        if (read.done) break;
        const chunk = Buffer.from(read.value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new WebReadFailure('read_failed', 'blocked', `Static fetch exceeded maxBytes (${maxBytes}).`, {
            ...diagnostics,
            blockedReason: 'max_bytes_exceeded',
          });
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    total = buffer.byteLength;
    if (total > maxBytes) {
      throw new WebReadFailure('read_failed', 'blocked', `Static fetch exceeded maxBytes (${maxBytes}).`, {
        ...diagnostics,
        blockedReason: 'max_bytes_exceeded',
      });
    }
    chunks.push(buffer);
  }
  return decodeResponseBytes(Buffer.concat(chunks), contentType);
}

async function readCachedWebRead(
  workspaceRoot: string,
  cacheKey: string,
  format: WebReadFormat,
): Promise<CachedWebReadRecord | undefined> {
  try {
    const text = await readFile(join(workspaceRoot, webReadCachePath(cacheKey)), 'utf8');
    const parsed = JSON.parse(text) as Partial<CachedWebReadRecord>;
    if (parsed.schemaVersion !== WEB_READ_CACHE_SCHEMA) return undefined;
    if (parsed.cacheKey !== cacheKey || parsed.format !== format) return undefined;
    if (typeof parsed.text !== 'string' || typeof parsed.textSha1 !== 'string') return undefined;
    if (sha1(parsed.text) !== parsed.textSha1) return undefined;
    if (typeof parsed.requestedUrl !== 'string' || typeof parsed.finalUrl !== 'string') return undefined;
    if (typeof parsed.contentType !== 'string' || typeof parsed.cachedAt !== 'string') return undefined;
    if (parsed.status !== 'read' && parsed.status !== 'partial') return undefined;
    return {
      schemaVersion: WEB_READ_CACHE_SCHEMA,
      cacheKey,
      requestedUrl: parsed.requestedUrl,
      finalUrl: parsed.finalUrl,
      ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
      contentType: parsed.contentType,
      format,
      text: parsed.text,
      textSha1: parsed.textSha1,
      status: parsed.status,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [],
      diagnostics: isRecord(parsed.diagnostics) ? parsed.diagnostics as WebReadDiagnostics : {},
      cachedAt: parsed.cachedAt,
    };
  } catch {
    return undefined;
  }
}

async function writeCachedWebRead(workspaceRoot: string, record: CachedWebReadRecord) {
  const path = join(workspaceRoot, webReadCachePath(record.cacheKey));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(record, null, 2), 'utf8');
}

function webReadCacheKey(requestedUrl: string, format: WebReadFormat) {
  return sha1(JSON.stringify({
    schemaVersion: WEB_READ_CACHE_SCHEMA,
    requestedUrl: normalizedCacheUrl(requestedUrl),
    format,
  })).slice(0, 24);
}

function webReadCachePath(cacheKey: string) {
  return join('.sciforge', 'web-read', 'cache', `cache-${cacheKey}.json`);
}

function normalizedCacheUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function persistWebReadRefs(input: {
  workspaceRoot: string;
  finalUrl: string;
  openedAt: string;
  text: string;
  textSha1: string;
}): Promise<{ sourcePage: WebReadRefRecord; pageText: WebReadRefRecord }> {
  const id = sha1(`${input.finalUrl}\n${input.openedAt}\n${input.textSha1}`).slice(0, 16);
  const sourcePage: WebReadRefRecord = {
    ref: `web-source:${id}`,
    path: join('.sciforge', 'web-read', 'sources', `source-${id}.json`),
  };
  const pageText: WebReadRefRecord = {
    ref: `web-text:${id}`,
    path: join('.sciforge', 'web-read', 'texts', `text-${id}.txt`),
  };
  await mkdir(dirname(join(input.workspaceRoot, sourcePage.path)), { recursive: true });
  await mkdir(dirname(join(input.workspaceRoot, pageText.path)), { recursive: true });
  await writeFile(join(input.workspaceRoot, pageText.path), input.text, 'utf8');
  return { sourcePage, pageText };
}

async function writeWebReadSourceMetadata(input: {
  workspaceRoot: string;
  sourcePage: WebReadRefRecord;
  pageText: WebReadRefRecord;
  requestedUrl: string;
  requestedResourceRef?: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  openedAt: string;
  text: string;
  textSha1: string;
  timings: WebReadTimings;
  diagnostics: WebReadDiagnostics;
}) {
  const metadata = {
    schemaVersion: WEB_READ_SOURCE_SCHEMA,
    tool: 'web_read',
    provider: WEB_READ_PROVIDER,
    requestedUrl: input.requestedUrl,
    ...(input.requestedResourceRef ? { requestedResourceRef: input.requestedResourceRef } : {}),
    finalUrl: input.finalUrl,
    ...(input.title ? { title: input.title } : {}),
    contentType: input.contentType,
    openedAt: input.openedAt,
    sourceRef: input.sourcePage.ref,
    textRef: input.pageText.ref,
    textPath: input.pageText.path,
    textSha1: input.textSha1,
    textCharCount: input.text.length,
    timings: input.timings,
    diagnostics: input.diagnostics,
  };
  await writeFile(join(input.workspaceRoot, input.sourcePage.path), JSON.stringify(metadata, null, 2), 'utf8');
}

function contentForFormat(format: WebReadFormat, html: string, text: string, markdown: string) {
  if (format === 'html') return html;
  if (format === 'markdown') return markdown;
  return text;
}

function normalizeCachePolicy(value: unknown): WebReadCachePolicy {
  return value === 'bypass' || value === 'refresh' || value === 'default' ? value : 'default';
}

function withCacheDiagnostics(
  diagnostics: WebReadDiagnostics,
  cache: {
    cachePolicy: WebReadCachePolicy;
    cacheStatus: WebReadCacheStatus;
    cacheKey?: string;
    cachePath?: string;
    cachedAt?: string;
  },
): WebReadDiagnostics {
  return {
    ...diagnostics,
    cachePolicy: cache.cachePolicy,
    cacheStatus: cache.cacheStatus,
    ...(cache.cacheKey ? { cacheKey: cache.cacheKey } : {}),
    ...(cache.cachePath ? { cachePath: cache.cachePath } : {}),
    ...(cache.cachedAt ? { cachedAt: cache.cachedAt } : {}),
  };
}

function validateSafeHttpUrl(rawUrl: string, policy: WebReadNetworkPolicy | undefined): {
  ok: true;
} | {
  ok: false;
  reason: string;
  message: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      reason: 'invalid_url',
      message: 'web_read URL must be an absolute HTTP(S) URL.',
    };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'non_http_protocol',
      message: `web_read only supports HTTP(S) URLs, got ${parsed.protocol}`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  const privateReason = privateHostReason(host);
  if (privateReason && !policy?.allowPrivateNetwork) {
    return {
      ok: false,
      reason: privateReason,
      message: `web_read refused an unsafe private/local URL host (${host}).`,
    };
  }
  return { ok: true };
}

function privateHostReason(host: string) {
  if (!host) return 'empty_host';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost_host';
  const ipVersion = isIP(host);
  if (ipVersion === 4) return privateIpv4Reason(host);
  if (ipVersion === 6) return privateIpv6Reason(host);
  return undefined;
}

function privateIpv4Reason(host: string) {
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  const [a, b] = parts;
  if (a === 0) return 'special_ipv4_unspecified';
  if (a === 10) return 'private_ipv4';
  if (a === 127) return 'loopback_ipv4';
  if (a === 169 && b === 254) return 'link_local_ipv4';
  if (a === 172 && b >= 16 && b <= 31) return 'private_ipv4';
  if (a === 192 && b === 168) return 'private_ipv4';
  if (a === 100 && b >= 64 && b <= 127) return 'private_ipv4';
  if (a === 198 && (b === 18 || b === 19)) return 'special_ipv4_benchmark';
  if (a >= 224) return 'special_ipv4_multicast_or_reserved';
  return undefined;
}

function privateIpv6Reason(host: string) {
  const normalized = host.toLowerCase();
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return 'special_ipv6_unspecified';
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return 'loopback_ipv6';
  if (normalized.startsWith('fe80:')) return 'link_local_ipv6';
  if (/^f[cd][0-9a-f]{0,2}:/i.test(normalized)) return 'private_ipv6';
  if (normalized.startsWith('ff')) return 'special_ipv6_multicast';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized);
  return mapped?.[1] ? privateIpv4Reason(mapped[1]) : undefined;
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

function isHtmlContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
}

function looksLikeHtml(value: string) {
  return /<!doctype\s+html|<html\b|<body\b|<main\b|<article\b/i.test(value);
}

function decodeResponseBytes(bytes: Buffer, contentType: string) {
  const charset = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (charset && /^(?:iso-8859-1|latin-?1|windows-1252)$/i.test(charset)) {
    return bytes.toString('latin1');
  }
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function boundedPreview(value: string, requestedMaxChars: number | undefined) {
  const maxChars = boundedInteger(requestedMaxChars, 0, 100_000, DEFAULT_MAX_CHARS);
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(Number(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFailure(error: unknown, requestedUrl: string | undefined): WebReadFailure {
  if (error instanceof WebReadFailure) {
    return error;
  }
  return new WebReadFailure('read_failed', 'failed', errorMessage(error), {
    ...(requestedUrl ? { requestedUrl } : {}),
    networkError: errorMessage(error),
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function nowMs() {
  return performance.now();
}

function elapsedMs(started: number) {
  return Math.max(0, Math.round((nowMs() - started) * 100) / 100);
}
