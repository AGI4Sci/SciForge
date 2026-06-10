import type {
  BrowserHostPageReadInput,
  BrowserHostPageReadOutput,
} from './browser-host-session.js';
import { WORKSPACE_BROWSER_PROFILE_REF } from './workspace-paths.js';

export type WebReadRenderMode = 'auto' | 'static' | 'browser';
export type WebReadBrowserFallbackProvider = 'browser-host-session' | 'crawl4ai' | 'playwright';
export type WebReadBrowserFallbackProviderTrace = WebReadBrowserFallbackProvider | 'none';
export type WebReadBrowserFallbackStatus = 'read' | 'not_needed' | 'needs_browser' | 'needs_user_browser' | 'blocked';
export type WebReadBrowserAdapterStatus = 'read' | 'blocked' | 'failed' | 'timeout';
export type WebReadBrowserBlockedReason =
  | 'captcha'
  | 'login'
  | 'paywall'
  | 'cookie_banner'
  | 'search_blocked'
  | 'multi_step_interaction'
  | 'user_profile_required'
  | 'navigation_blocked'
  | 'render_timeout'
  | 'low_information'
  | 'unknown';
export type WebReadBrowserFallbackErrorCode =
  | 'needs_browser'
  | 'needs_user_browser'
  | 'read_failed'
  | 'timeout'
  | 'extract_failed';

export interface WebReadStaticReadSignal {
  status: 'read' | 'partial' | 'read_failed' | 'extract_failed' | 'blocked' | 'empty';
  reason?: string;
  textCharCount?: number;
  preview?: string;
  httpStatus?: number;
  blockedReason?: WebReadBrowserBlockedReason | string;
}

export interface WebReadBrowserRenderInput {
  workspacePath: string;
  url: string;
  title?: string;
  sessionId?: string;
  timeoutMs?: number;
  reason: string;
  renderMode: Extract<WebReadRenderMode, 'auto' | 'browser'>;
  profilePolicy: WebReadBrowserProfilePolicy;
}

export interface WebReadBrowserRenderTrace {
  navigationUrl?: string;
  finalUrl?: string;
  waitReason?: string;
  extractMethod?: string;
  blockedReason?: WebReadBrowserBlockedReason | string;
  timings?: Partial<WebReadBrowserFallbackTimings>;
}

export interface WebReadBrowserRenderAdapterResult {
  status: WebReadBrowserAdapterStatus;
  finalUrl?: string;
  title?: string;
  contentType?: string;
  textCharCount?: number;
  refs?: WebReadBrowserFallbackRefs;
  artifactPaths?: {
    sourcePagePath?: string;
    pageTextPath?: string;
    htmlPath?: string;
    tracePath?: string;
  };
  trace?: WebReadBrowserRenderTrace;
  blockedReason?: WebReadBrowserBlockedReason | string;
  requiresUserBrowser?: boolean;
  errorMessage?: string;
}

export interface WebReadBrowserRenderAdapter {
  provider: WebReadBrowserFallbackProvider;
  render(input: WebReadBrowserRenderInput): Promise<WebReadBrowserRenderAdapterResult>;
}

export interface WebReadBrowserFallbackInput {
  workspacePath: string;
  url: string;
  title?: string;
  sessionId?: string;
  render?: WebReadRenderMode;
  timeoutMs?: number;
  staticRead?: WebReadStaticReadSignal;
  adapter?: WebReadBrowserRenderAdapter;
  minContentChars?: number;
}

export interface WebReadBrowserFallbackRefs {
  sourcePageRef?: string;
  pageTextRef?: string;
  htmlRef?: string;
  browserTraceRef?: string;
  screenshotRef?: string;
  sessionRef?: string;
}

export interface WebReadBrowserFallbackTimings {
  policyMs: number;
  browserRenderMs?: number;
  navigateMs?: number;
  waitMs?: number;
  extractMs?: number;
  persistMs?: number;
  totalMs: number;
}

export interface WebReadBrowserProfilePolicy {
  profileRef: typeof WORKSPACE_BROWSER_PROFILE_REF;
  storageScope: 'workspace';
  reusesUserMainProfile: false;
  autonomousAgentStarted: false;
}

export interface WebReadBrowserFallbackTrace {
  provider: WebReadBrowserFallbackProviderTrace;
  reason: string;
  navigationUrl: string;
  finalUrl?: string;
  waitReason?: string;
  extractMethod?: string;
  blockedReason?: WebReadBrowserBlockedReason | string;
  timings: Partial<WebReadBrowserFallbackTimings>;
}

export interface WebReadBrowserFallbackDiagnostics {
  fallbackUsed: boolean;
  fallbackReason: string;
  needsBrowser: boolean;
  needsUserBrowser: boolean;
  blockedReason?: WebReadBrowserBlockedReason | string;
  failureReason?: string;
  escalationHint?: string;
  staticReadStatus?: WebReadStaticReadSignal['status'];
  staticTextCharCount?: number;
  adapterStatus?: WebReadBrowserAdapterStatus;
}

export interface WebReadBrowserFallbackResult {
  ok: boolean;
  status: WebReadBrowserFallbackStatus;
  tool: 'web_read';
  provider: WebReadBrowserFallbackProviderTrace;
  data?: {
    requestedUrl: string;
    finalUrl: string;
    title?: string;
    contentType?: string;
    textCharCount?: number;
    evidenceBoundary: 'source_page_text_ref';
  };
  refs: WebReadBrowserFallbackRefs;
  timings: WebReadBrowserFallbackTimings;
  fallbackTrace: WebReadBrowserFallbackTrace;
  profilePolicy: WebReadBrowserProfilePolicy;
  diagnostics: WebReadBrowserFallbackDiagnostics;
  warnings: string[];
  error?: {
    code: WebReadBrowserFallbackErrorCode;
    message: string;
    blockedReason?: WebReadBrowserBlockedReason | string;
  };
}

export interface WebReadBrowserFallbackPolicyDecision {
  action: 'skip' | 'render' | 'needs_browser' | 'needs_user_browser';
  reason: string;
  blockedReason?: WebReadBrowserBlockedReason | string;
}

export interface BrowserHostSessionPageReader {
  readPage(workspacePath: string, input: BrowserHostPageReadInput): Promise<BrowserHostPageReadOutput>;
}

export interface Crawl4AiBrowserRenderClient {
  read(input: WebReadBrowserRenderInput): Promise<WebReadBrowserRenderAdapterResult>;
}

export type PlaywrightBrowserRenderClient =
  (input: WebReadBrowserRenderInput) => Promise<WebReadBrowserRenderAdapterResult>;

const DEFAULT_MIN_CONTENT_CHARS = 80;

export async function runWebReadBrowserFallback(input: WebReadBrowserFallbackInput): Promise<WebReadBrowserFallbackResult> {
  const startedAt = nowMs();
  const policyStartedAt = nowMs();
  const profilePolicy = webReadBrowserProfilePolicy();
  const renderMode = input.render ?? 'auto';
  const decision = evaluateWebReadBrowserFallbackPolicy(input);
  const policyMs = elapsedMs(policyStartedAt);
  const traceBase = fallbackTraceBase({
    provider: decision.action === 'render' ? input.adapter?.provider ?? 'none' : 'none',
    reason: decision.reason,
    navigationUrl: input.url,
    timings: { policyMs },
  });

  if (decision.action === 'skip') {
    return baseResult({
      ok: true,
      status: 'not_needed',
      provider: 'none',
      profilePolicy,
      timings: totalTimings(startedAt, { policyMs }),
      fallbackTrace: traceBase,
      diagnostics: {
        fallbackUsed: false,
        fallbackReason: decision.reason,
        needsBrowser: false,
        needsUserBrowser: false,
        staticReadStatus: input.staticRead?.status,
        staticTextCharCount: input.staticRead?.textCharCount,
      },
      warnings: [],
    });
  }

  if (decision.action === 'needs_user_browser') {
    return baseResult({
      ok: false,
      status: 'needs_user_browser',
      provider: 'none',
      profilePolicy,
      timings: totalTimings(startedAt, { policyMs }),
      fallbackTrace: {
        ...traceBase,
        blockedReason: decision.blockedReason,
      },
      diagnostics: {
        fallbackUsed: false,
        fallbackReason: decision.reason,
        needsBrowser: false,
        needsUserBrowser: true,
        blockedReason: decision.blockedReason,
        escalationHint: 'Agent Host must explicitly start a user-browser or browse/search fallback handoff; web_read does not bypass login or CAPTCHA.',
        staticReadStatus: input.staticRead?.status,
        staticTextCharCount: input.staticRead?.textCharCount,
      },
      warnings: ['browser fallback requires an explicit Host-owned user-browser handoff'],
      error: {
        code: 'needs_user_browser',
        message: `Browser fallback requires user browser handoff: ${decision.blockedReason ?? decision.reason}.`,
        blockedReason: decision.blockedReason,
      },
    });
  }

  if (decision.action === 'needs_browser' || !input.adapter) {
    const reason = decision.action === 'needs_browser'
      ? decision.reason
      : 'browser_render_adapter_unavailable';
    return baseResult({
      ok: false,
      status: 'needs_browser',
      provider: 'none',
      profilePolicy,
      timings: totalTimings(startedAt, { policyMs }),
      fallbackTrace: fallbackTraceBase({
        provider: 'none',
        reason: decision.reason,
        navigationUrl: input.url,
        timings: { policyMs },
      }),
      diagnostics: {
        fallbackUsed: false,
        fallbackReason: decision.reason,
        needsBrowser: true,
        needsUserBrowser: false,
        failureReason: reason === 'browser_render_adapter_unavailable'
          ? 'No browser render adapter was provided to web_read fallback.'
          : reason,
        staticReadStatus: input.staticRead?.status,
        staticTextCharCount: input.staticRead?.textCharCount,
      },
      warnings: ['browser render fallback was requested but no adapter seam was available'],
      error: {
        code: 'needs_browser',
        message: 'web_read needs a browser render adapter to recover this source.',
      },
    });
  }

  const browserStartedAt = nowMs();
  try {
    const adapterResult = await input.adapter.render({
      workspacePath: input.workspacePath,
      url: input.url,
      title: input.title,
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
      reason: decision.reason,
      renderMode: renderMode === 'browser' ? 'browser' : 'auto',
      profilePolicy,
    });
    const browserRenderMs = elapsedMs(browserStartedAt);
    return resultFromAdapterResult(input, {
      adapterResult,
      decision,
      provider: input.adapter.provider,
      profilePolicy,
      startedAt,
      policyMs,
      browserRenderMs,
    });
  } catch (error) {
    const browserRenderMs = elapsedMs(browserStartedAt);
    const message = errorMessage(error);
    const blockedReason = classifyBlockedReason(message);
    const needsUserBrowser = Boolean(blockedReason && needsUserBrowserForBlockedReason(blockedReason));
    return baseResult({
      ok: false,
      status: needsUserBrowser ? 'needs_user_browser' : 'blocked',
      provider: input.adapter.provider,
      profilePolicy,
      timings: totalTimings(startedAt, { policyMs, browserRenderMs }),
      fallbackTrace: fallbackTraceBase({
        provider: input.adapter.provider,
        reason: decision.reason,
        navigationUrl: input.url,
        blockedReason,
        timings: { policyMs, browserRenderMs },
      }),
      diagnostics: {
        fallbackUsed: true,
        fallbackReason: decision.reason,
        needsBrowser: false,
        needsUserBrowser,
        blockedReason,
        failureReason: message,
        staticReadStatus: input.staticRead?.status,
        staticTextCharCount: input.staticRead?.textCharCount,
      },
      warnings: needsUserBrowser ? ['browser fallback reached a user-interactive block'] : ['browser fallback failed before text refs were materialized'],
      error: {
        code: needsUserBrowser ? 'needs_user_browser' : 'read_failed',
        message,
        blockedReason,
      },
    });
  }
}

export function evaluateWebReadBrowserFallbackPolicy(input: WebReadBrowserFallbackInput): WebReadBrowserFallbackPolicyDecision {
  const renderMode = input.render ?? 'auto';
  const staticRead = input.staticRead;
  const minContentChars = boundedMinContentChars(input.minContentChars);
  const blockedReason = normalizeBlockedReason(staticRead?.blockedReason) ?? classifyBlockedReason(staticRead?.preview);

  if (renderMode === 'static') {
    return { action: 'needs_browser', reason: 'browser_render_disabled' };
  }
  if (renderMode === 'auto' && blockedReason && needsUserBrowserForBlockedReason(blockedReason)) {
    return {
      action: 'needs_user_browser',
      reason: staticRead?.reason ?? blockedReason,
      blockedReason,
    };
  }
  if (!staticRead) return { action: 'render', reason: 'browser_render_requested' };
  if (staticRead.status === 'read' && (staticRead.textCharCount ?? 0) >= minContentChars) {
    return { action: 'skip', reason: 'static_read_sufficient' };
  }
  if (staticRead.status === 'blocked' && blockedReason && needsUserBrowserForBlockedReason(blockedReason)) {
    return {
      action: 'needs_user_browser',
      reason: staticRead.reason ?? blockedReason,
      blockedReason,
    };
  }
  return { action: 'render', reason: staticRead.reason ?? staticRead.status };
}

export function createBrowserHostSessionRenderAdapter(manager: BrowserHostSessionPageReader): WebReadBrowserRenderAdapter {
  return {
    provider: 'browser-host-session',
    async render(input) {
      const output = await manager.readPage(input.workspacePath, {
        url: input.url,
        title: input.title,
        sessionId: input.sessionId,
        timeoutMs: input.timeoutMs,
      });
      const sourcePage = output.sourcePage;
      const diagnostics = output.session.diagnostics.join('\n');
      const blockedReason = normalizeBlockedReason(sourcePage.error) ?? classifyBlockedReason(`${sourcePage.error ?? ''}\n${sourcePage.textPreview ?? ''}\n${diagnostics}`);
      const status: WebReadBrowserAdapterStatus = sourcePage.status === 'read' ? 'read' : 'blocked';
      return {
        status,
        finalUrl: sourcePage.finalUrl || output.session.url || input.url,
        title: sourcePage.title || output.session.title,
        contentType: 'text/html',
        textCharCount: sourcePage.textCharCount,
        refs: {
          sourcePageRef: sourcePage.sourcePageRef,
          pageTextRef: sourcePage.textRef,
          screenshotRef: output.session.screenshotRef,
          sessionRef: `browser-host-session:${output.session.id}/session.json`,
        },
        trace: {
          navigationUrl: input.url,
          finalUrl: sourcePage.finalUrl || output.session.url,
          waitReason: output.session.loadingProgress?.reason ?? 'host-ready',
          extractMethod: 'browser-host-session-text',
          blockedReason,
          timings: browserHostTimingFields(output.session.lastActionTiming?.totalMs),
        },
        blockedReason,
        requiresUserBrowser: blockedReason ? needsUserBrowserForBlockedReason(blockedReason) : false,
        errorMessage: sourcePage.error,
      };
    },
  };
}

export function createCrawl4AiBrowserRenderAdapter(client: Crawl4AiBrowserRenderClient): WebReadBrowserRenderAdapter {
  return {
    provider: 'crawl4ai',
    render: (input) => client.read(input),
  };
}

export function createPlaywrightBrowserRenderAdapter(client: PlaywrightBrowserRenderClient): WebReadBrowserRenderAdapter {
  return {
    provider: 'playwright',
    render: (input) => client(input),
  };
}

function resultFromAdapterResult(
  input: WebReadBrowserFallbackInput,
  context: {
    adapterResult: WebReadBrowserRenderAdapterResult;
    decision: WebReadBrowserFallbackPolicyDecision;
    provider: WebReadBrowserFallbackProvider;
    profilePolicy: WebReadBrowserProfilePolicy;
    startedAt: number;
    policyMs: number;
    browserRenderMs: number;
  },
): WebReadBrowserFallbackResult {
  const { adapterResult, decision, provider, profilePolicy, startedAt, policyMs, browserRenderMs } = context;
  const traceTimings = adapterResult.trace?.timings ?? {};
  const timings = totalTimings(startedAt, {
    policyMs,
    browserRenderMs,
    navigateMs: traceTimings.navigateMs,
    waitMs: traceTimings.waitMs,
    extractMs: traceTimings.extractMs,
    persistMs: traceTimings.persistMs,
  });
  const blockedReason = normalizeBlockedReason(adapterResult.blockedReason)
    ?? normalizeBlockedReason(adapterResult.trace?.blockedReason)
    ?? classifyBlockedReason(adapterResult.errorMessage);
  const needsUserBrowser = adapterResult.requiresUserBrowser === true
    || Boolean(blockedReason && needsUserBrowserForBlockedReason(blockedReason));
  const fallbackTrace = fallbackTraceBase({
    provider,
    reason: decision.reason,
    navigationUrl: adapterResult.trace?.navigationUrl ?? input.url,
    finalUrl: adapterResult.finalUrl ?? adapterResult.trace?.finalUrl,
    waitReason: adapterResult.trace?.waitReason,
    extractMethod: adapterResult.trace?.extractMethod,
    blockedReason,
    timings,
  });

  if (adapterResult.status === 'read' && adapterResult.refs?.sourcePageRef && adapterResult.refs.pageTextRef) {
    return baseResult({
      ok: true,
      status: 'read',
      provider,
      profilePolicy,
      data: {
        requestedUrl: input.url,
        finalUrl: adapterResult.finalUrl ?? input.url,
        title: adapterResult.title,
        contentType: adapterResult.contentType,
        textCharCount: adapterResult.textCharCount,
        evidenceBoundary: 'source_page_text_ref',
      },
      refs: adapterResult.refs,
      timings,
      fallbackTrace,
      diagnostics: {
        fallbackUsed: true,
        fallbackReason: decision.reason,
        needsBrowser: false,
        needsUserBrowser: false,
        adapterStatus: adapterResult.status,
        staticReadStatus: input.staticRead?.status,
        staticTextCharCount: input.staticRead?.textCharCount,
      },
      warnings: [],
    });
  }

  if (needsUserBrowser) {
    const message = adapterResult.errorMessage
      ?? `Browser render reached ${blockedReason ?? 'a user-interactive block'} and requires Host-owned user browser handoff.`;
    return baseResult({
      ok: false,
      status: 'needs_user_browser',
      provider,
      profilePolicy,
      timings,
      fallbackTrace,
      diagnostics: {
        fallbackUsed: true,
        fallbackReason: decision.reason,
        needsBrowser: false,
        needsUserBrowser: true,
        blockedReason,
        adapterStatus: adapterResult.status,
        escalationHint: 'Agent Host must explicitly start a user-browser or browse/search fallback handoff; web_read does not bypass login or CAPTCHA.',
        staticReadStatus: input.staticRead?.status,
        staticTextCharCount: input.staticRead?.textCharCount,
      },
      warnings: ['browser fallback stopped at a user-interactive block'],
      error: {
        code: 'needs_user_browser',
        message,
        blockedReason,
      },
    });
  }

  const message = adapterResult.errorMessage
    ?? `Browser render did not materialize source/page text refs; adapter status=${adapterResult.status}.`;
  return baseResult({
    ok: false,
    status: adapterResult.status === 'timeout' ? 'needs_browser' : 'blocked',
    provider,
    profilePolicy,
    timings,
    fallbackTrace,
    diagnostics: {
      fallbackUsed: true,
      fallbackReason: decision.reason,
      needsBrowser: adapterResult.status === 'timeout',
      needsUserBrowser: false,
      blockedReason,
      failureReason: message,
      adapterStatus: adapterResult.status,
      staticReadStatus: input.staticRead?.status,
      staticTextCharCount: input.staticRead?.textCharCount,
    },
    warnings: ['browser fallback failed before source/page text refs were materialized'],
    error: {
      code: adapterResult.status === 'timeout' ? 'timeout' : 'read_failed',
      message,
      blockedReason,
    },
  });
}

function baseResult(
  fields: Omit<Partial<WebReadBrowserFallbackResult>, 'tool'> & {
    ok: boolean;
    status: WebReadBrowserFallbackStatus;
    provider: WebReadBrowserFallbackProviderTrace;
    profilePolicy: WebReadBrowserProfilePolicy;
    timings: WebReadBrowserFallbackTimings;
    fallbackTrace: WebReadBrowserFallbackTrace;
    diagnostics: WebReadBrowserFallbackDiagnostics;
    warnings: string[];
  },
): WebReadBrowserFallbackResult {
  return {
    ok: fields.ok,
    status: fields.status,
    tool: 'web_read',
    provider: fields.provider,
    data: fields.data,
    refs: fields.refs ?? {},
    timings: fields.timings,
    fallbackTrace: fields.fallbackTrace,
    profilePolicy: fields.profilePolicy,
    diagnostics: fields.diagnostics,
    warnings: fields.warnings,
    error: fields.error,
  };
}

function webReadBrowserProfilePolicy(): WebReadBrowserProfilePolicy {
  return {
    profileRef: WORKSPACE_BROWSER_PROFILE_REF,
    storageScope: 'workspace',
    reusesUserMainProfile: false,
    autonomousAgentStarted: false,
  };
}

function fallbackTraceBase(input: {
  provider: WebReadBrowserFallbackProviderTrace;
  reason: string;
  navigationUrl: string;
  finalUrl?: string;
  waitReason?: string;
  extractMethod?: string;
  blockedReason?: WebReadBrowserBlockedReason | string;
  timings: Partial<WebReadBrowserFallbackTimings>;
}): WebReadBrowserFallbackTrace {
  return {
    provider: input.provider,
    reason: input.reason,
    navigationUrl: input.navigationUrl,
    finalUrl: input.finalUrl,
    waitReason: input.waitReason,
    extractMethod: input.extractMethod,
    blockedReason: input.blockedReason,
    timings: input.timings,
  };
}

function totalTimings(startedAt: number, values: Partial<WebReadBrowserFallbackTimings>): WebReadBrowserFallbackTimings {
  return {
    policyMs: nonNegativeMs(values.policyMs),
    browserRenderMs: optionalMs(values.browserRenderMs),
    navigateMs: optionalMs(values.navigateMs),
    waitMs: optionalMs(values.waitMs),
    extractMs: optionalMs(values.extractMs),
    persistMs: optionalMs(values.persistMs),
    totalMs: Math.max(elapsedMs(startedAt), sumKnownMs(values)),
  };
}

function boundedMinContentChars(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MIN_CONTENT_CHARS;
  return Math.max(1, Math.min(10_000, Math.floor(value)));
}

function browserHostTimingFields(totalMs: number | undefined): Partial<WebReadBrowserFallbackTimings> {
  return typeof totalMs === 'number' && Number.isFinite(totalMs)
    ? { navigateMs: nonNegativeMs(totalMs) }
    : {};
}

function needsUserBrowserForBlockedReason(reason: string): boolean {
  return /^(captcha|login|paywall|multi_step_interaction|user_profile_required)$/i.test(reason);
}

function classifyBlockedReason(value: string | undefined): WebReadBrowserBlockedReason | undefined {
  if (!value) return undefined;
  const text = value.toLowerCase();
  if (/\bcaptcha\b|recaptcha|hcaptcha|verify you are human|human verification/.test(text)) return 'captcha';
  if (/sign in|log in|login|password|authentication required|account required/.test(text)) return 'login';
  if (/paywall|subscribe to continue|subscription required/.test(text)) return 'paywall';
  if (/cookie banner|accept cookies|privacy choices/.test(text)) return 'cookie_banner';
  if (/unusual traffic|automated queries|search blocked|blocked search/.test(text)) return 'search_blocked';
  if (/multi[- ]step|requires interaction|manual interaction/.test(text)) return 'multi_step_interaction';
  if (/user profile|required profile|main profile|personal profile/.test(text)) return 'user_profile_required';
  if (/timeout|timed out/.test(text)) return 'render_timeout';
  if (/low information|empty body|body missing/.test(text)) return 'low_information';
  if (/blocked|forbidden|access denied/.test(text)) return 'navigation_blocked';
  return undefined;
}

function normalizeBlockedReason(value: WebReadBrowserBlockedReason | string | undefined): WebReadBrowserBlockedReason | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  switch (normalized) {
    case 'captcha':
    case 'login':
    case 'paywall':
    case 'cookie_banner':
    case 'search_blocked':
    case 'multi_step_interaction':
    case 'user_profile_required':
    case 'navigation_blocked':
    case 'render_timeout':
    case 'low_information':
    case 'unknown':
      return normalized;
    default:
      return classifyBlockedReason(value);
  }
}

function nowMs(): number {
  return performance.now();
}

function elapsedMs(startedAt: number): number {
  return nonNegativeMs(performance.now() - startedAt);
}

function nonNegativeMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function optionalMs(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return nonNegativeMs(value);
}

function sumKnownMs(values: Partial<WebReadBrowserFallbackTimings>): number {
  return [
    values.policyMs,
    values.browserRenderMs,
    values.navigateMs,
    values.waitMs,
    values.extractMs,
    values.persistMs,
  ]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((sum, value) => sum + Math.max(0, value), 0);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'browser render fallback failed';
}
