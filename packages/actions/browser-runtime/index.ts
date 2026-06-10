import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleInvokeResult,
} from '@sciforge-ui/runtime-contract/modules';

export const BROWSER_PRIMITIVE_SERVICE_MODULE_ID = 'browser' as const;
export const BROWSER_PRIMITIVE_RESULT_SCHEMA = 'sciforge.browser-runtime.primitive-result.v1' as const;
export const WEB_SEARCH_TOOL_NAME = 'web_search' as const;
export const WEB_READ_TOOL_NAME = 'web_read' as const;
export const WEB_TOOL_NAMES = [WEB_SEARCH_TOOL_NAME, WEB_READ_TOOL_NAME] as const;
export const WEB_TOOL_RESULT_SCHEMA = 'sciforge.browser-runtime.web-tool-result.v1' as const;

export const WEB_TOOL_INPUT_SCHEMA_VERSIONS = {
  web_search: 'sciforge.browser-runtime.web-search-input.v1',
  web_read: 'sciforge.browser-runtime.web-read-input.v1',
} as const;

export const WEB_RESOURCE_REF_PREFIXES = {
  searchResultSet: 'web-search:',
  discoveredPage: 'web-page:',
  sourcePage: 'web-source:',
  pageText: 'web-text:',
} as const;

export const WEB_ERROR_CODES = [
  'invalid_input',
  'unsafe_url',
  'provider_unavailable',
  'timeout',
  'rate_limited',
  'no_results',
  'read_failed',
  'extract_failed',
  'needs_browser',
  'needs_user_browser',
] as const;

export const WEB_SAFE_SEARCH_VALUES = ['off', 'moderate', 'strict'] as const;
export const WEB_SEARCH_TIME_RANGES = ['day', 'week', 'month', 'year'] as const;
export const WEB_READ_FORMATS = ['markdown', 'text', 'html', 'metadata'] as const;
export const WEB_READ_RENDER_MODES = ['auto', 'static', 'browser'] as const;
export const WEB_CACHE_POLICIES = ['default', 'bypass', 'refresh'] as const;
export const WEB_TOOL_TIMEOUT_MS_MAX = 60_000 as const;
export const WEB_SEARCH_LIMIT_MAX = 20 as const;
export const WEB_READ_MAX_CHARS_MAX = 1_000_000 as const;

export const WEB_TOOL_INPUT_SCHEMAS = {
  web_search: objectSchema(['query'], {
    query: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: WEB_SEARCH_LIMIT_MAX },
    language: { type: 'string', minLength: 1 },
    region: { type: 'string', minLength: 1 },
    time_range: { enum: [...WEB_SEARCH_TIME_RANGES] },
    safe_search: { enum: [...WEB_SAFE_SEARCH_VALUES] },
    provider: { type: 'string', minLength: 1 },
    timeout_ms: { type: 'integer', minimum: 1, maximum: WEB_TOOL_TIMEOUT_MS_MAX },
    constraints: webConstraintsSchema(),
  }),
  web_read: {
    ...objectSchema([], {
      url: { type: 'string', format: 'uri' },
      resourceRef: {
        type: 'string',
        minLength: 1,
        pattern: `^${escapeRegExp(WEB_RESOURCE_REF_PREFIXES.discoveredPage)}`,
        description: 'A discovered page ref produced by web_search, formatted as web-page:{id}.',
      },
      format: { enum: [...WEB_READ_FORMATS] },
      render: { enum: [...WEB_READ_RENDER_MODES] },
      max_chars: { type: 'integer', minimum: 1, maximum: WEB_READ_MAX_CHARS_MAX },
      timeout_ms: { type: 'integer', minimum: 1, maximum: WEB_TOOL_TIMEOUT_MS_MAX },
      cache_policy: { enum: [...WEB_CACHE_POLICIES] },
      constraints: webConstraintsSchema(),
    }),
    anyOf: [{ required: ['url'] }, { required: ['resourceRef'] }],
  },
} as const;

export const WEB_TOOL_OUTPUT_SCHEMAS = {
  web_search: objectSchema(['query', 'results', 'evidenceBoundary'], {
    query: { type: 'string' },
    provider: { type: 'string' },
    results: {
      type: 'array',
      description: 'Current-run web_search results and snippets are candidate sources for ordinary search answers with source links.',
      items: objectSchema(['rank', 'title', 'url', 'source', 'provider'], {
        rank: { type: 'integer', minimum: 1 },
        title: { type: 'string' },
        url: { type: 'string', format: 'uri' },
        snippet: { type: 'string' },
        source: { type: 'string' },
        publishedAt: { type: 'string' },
        provider: { type: 'string' },
      }),
    },
    refs: {
      type: 'object',
      description: 'Search refs use web-search:{id}; discovered candidate page refs use web-page:{id}. These refs identify result sets and source links for ordinary search; page text refs are only produced by read escalation.',
    },
    evidenceBoundary: {
      type: 'string',
      description: 'Ordinary search can be answered from current-run web_search results plus source links when sufficient; page-level detail, direct quotes, URL summaries, low-information results, or conflicting sources use read-required escalation. Ordinary search does not require web_read.',
    },
    diagnostics: { type: 'object' },
  }),
  web_read: objectSchema(['requestedUrl', 'finalUrl', 'refs', 'evidenceBoundary'], {
    requestedUrl: { type: 'string' },
    finalUrl: { type: 'string' },
    title: { type: 'string' },
    author: { type: 'string' },
    publishedAt: { type: 'string' },
    contentType: { type: 'string' },
    language: { type: 'string' },
    contentPreview: { type: 'string' },
    textCharCount: { type: 'integer', minimum: 0 },
    textSha1: { type: 'string' },
    refs: {
      type: 'object',
      description: 'web_read source/page text refs are evidence: source page refs use web-source:{id}; page text refs use web-text:{id}.',
    },
    evidenceBoundary: {
      type: 'string',
      description: 'source/page text refs are evidence for the single read page; task-level synthesis remains outside Browser Runtime.',
    },
    diagnostics: { type: 'object' },
  }),
} as const;

export const BROWSER_PRIMITIVE_INPUT_SCHEMAS = {
  search: 'sciforge.browser-runtime.search-input.v1',
  navigate: 'sciforge.browser-runtime.navigate-input.v1',
  observe: 'sciforge.browser-runtime.observe-input.v1',
  read: 'sciforge.browser-runtime.read-input.v1',
  extract: 'sciforge.browser-runtime.extract-input.v1',
  download: 'sciforge.browser-runtime.download-input.v1',
} as const;

export const BROWSER_PRIMITIVE_INTENTS = {
  search: 'browser.search',
  navigate: 'browser.navigate',
  observe: 'browser.observe',
  read: 'browser.read',
  extract: 'browser.extract',
  download: 'browser.download',
} as const;

export const BROWSER_PRIMITIVE_NAMES = ['search', 'navigate', 'observe', 'read', 'extract', 'download'] as const;
export const BROWSER_EXTRACT_TARGETS = ['links', 'forms', 'dates', 'metadata', 'resultItems'] as const;

export type BrowserPrimitiveName = typeof BROWSER_PRIMITIVE_NAMES[number];
export type BrowserPrimitiveIntent = typeof BROWSER_PRIMITIVE_INTENTS[BrowserPrimitiveName];
export type BrowserPrimitiveStatus = 'completed' | 'partial' | 'blocked' | 'needs-confirmation' | 'failed';
export type BrowserCaptureMode = 'none' | 'frame' | 'screenshot';
export type BrowserSearchEngine = string;
export type BrowserSafeSearch = 'off' | 'moderate' | 'strict';
export type BrowserReadNavigationMode = 'none' | 'ephemeral';
export type BrowserExtractTarget = typeof BROWSER_EXTRACT_TARGETS[number];
export type WebToolName = typeof WEB_TOOL_NAMES[number];
export type WebErrorCode = typeof WEB_ERROR_CODES[number];
export type WebSafeSearch = typeof WEB_SAFE_SEARCH_VALUES[number];
export type WebSearchTimeRange = typeof WEB_SEARCH_TIME_RANGES[number];
export type WebReadFormat = typeof WEB_READ_FORMATS[number];
export type WebReadRenderMode = typeof WEB_READ_RENDER_MODES[number];
export type WebCachePolicy = typeof WEB_CACHE_POLICIES[number];
export type WebToolStatus = BrowserPrimitiveStatus;
export type WebRefEvidence = 'candidate' | 'source' | 'diagnostic';
export type WebRefKind = 'search_result_set' | 'discovered_page' | 'source_page' | 'page_text' | 'html' | 'diagnostic';

export interface WebToolError {
  code: WebErrorCode;
  message: string;
  retryable?: boolean;
  refs?: string[];
  provider?: string;
}

export interface WebToolWarning {
  code: string;
  message: string;
  refs?: string[];
}

export interface WebToolTimings {
  providerMs?: number;
  fetchMs?: number;
  renderMs?: number;
  extractMs?: number;
  parseMs?: number;
  persistMs?: number;
  totalMs?: number;
}

export interface WebToolRef {
  ref: string;
  kind: WebRefKind;
  evidence: WebRefEvidence;
  locator?: Record<string, unknown>;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface WebSearchInput {
  query: string;
  limit?: number;
  language?: string;
  region?: string;
  time_range?: WebSearchTimeRange;
  safe_search?: WebSafeSearch;
  provider?: string;
  timeout_ms?: number;
  constraints?: WebToolConstraints;
}

export interface WebReadInput {
  url?: string;
  resourceRef?: string;
  format?: WebReadFormat;
  render?: WebReadRenderMode;
  max_chars?: number;
  timeout_ms?: number;
  cache_policy?: WebCachePolicy;
  constraints?: WebToolConstraints;
}

export interface WebToolConstraints {
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export interface WebSearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet?: string;
  source: string;
  publishedAt?: string;
  provider: string;
}

export interface WebSearchOutput {
  query: string;
  provider?: string;
  results: WebSearchResultItem[];
  refs?: Record<string, unknown>;
  evidenceBoundary: string;
  diagnostics?: Record<string, unknown>;
}

export interface WebReadOutput {
  requestedUrl?: string;
  finalUrl?: string;
  title?: string;
  author?: string;
  publishedAt?: string;
  contentType?: string;
  language?: string;
  contentPreview?: string;
  textCharCount?: number;
  textSha1?: string;
  refs?: Record<string, unknown>;
  evidenceBoundary: string;
  diagnostics?: Record<string, unknown>;
}

export interface WebToolResultEnvelope<T = WebSearchOutput | WebReadOutput> {
  schemaVersion: typeof WEB_TOOL_RESULT_SCHEMA;
  ok: boolean;
  status: WebToolStatus;
  tool: WebToolName;
  provider?: string;
  data?: T;
  refs: WebToolRef[];
  timings: WebToolTimings;
  warnings: WebToolWarning[];
  error?: WebToolError;
}

export interface WebToolValidationResult<T = WebSearchInput | WebReadInput> {
  ok: boolean;
  tool?: WebToolName;
  input?: T;
  errors: WebToolError[];
}

export interface BrowserPrimitiveBudget {
  maxTimeMs?: number;
  elapsedMs?: number;
  maxBytes?: number;
  bytesRead?: number;
}

export interface BrowserDiagnostic {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  refs?: string[];
  retryable?: boolean;
}

export interface BrowserRepairHint {
  code: string;
  message: string;
  suggestedPrimitive?: BrowserPrimitiveName;
  machineReadable?: Record<string, unknown>;
}

export type BrowserResourceStatus = 'discovered' | 'accessed' | 'observed' | 'read' | 'extracted' | 'downloaded' | 'blocked' | 'failed';
export type BrowserResourceConfidence = 'candidate' | 'observed' | 'materialized';

export interface BrowserResource {
  ref: string;
  kind: string;
  status: BrowserResourceStatus;
  originTool: BrowserPrimitiveIntent;
  locator?: Record<string, unknown>;
  title?: string;
  snippet?: string;
  refs?: string[];
  confidence?: BrowserResourceConfidence;
  metadata?: Record<string, unknown>;
}

export interface BrowserEvidenceState {
  completed: string[];
  unknown: string[];
  boundary: string;
}

export interface BrowserPrimitiveEnvelope<T = unknown> {
  schemaVersion: typeof BROWSER_PRIMITIVE_RESULT_SCHEMA;
  moduleId: typeof BROWSER_PRIMITIVE_SERVICE_MODULE_ID;
  primitive: BrowserPrimitiveName;
  status: BrowserPrimitiveStatus;
  output?: T;
  resources: BrowserResource[];
  evidenceState: BrowserEvidenceState;
  refs: string[];
  diagnostics: BrowserDiagnostic[];
  budget: BrowserPrimitiveBudget;
  blockedReason?: string;
  repairHints?: BrowserRepairHint[];
}

export interface BrowserPrimitiveConstraints {
  allowedDomains?: string[];
  blockedDomains?: string[];
  safeSearch?: BrowserSafeSearch;
  requireUserConfirmationForCrossOrigin?: boolean;
}

export interface BrowserSearchInput {
  schemaVersion: typeof BROWSER_PRIMITIVE_INPUT_SCHEMAS.search;
  query: string;
  engine?: BrowserSearchEngine;
  locale?: string;
  region?: string;
  timeRange?: WebSearchTimeRange | string;
  limit?: number;
  budget?: BrowserPrimitiveBudget;
  constraints?: BrowserPrimitiveConstraints;
}

export interface BrowserSearchResultItem {
  rank?: number;
  title: string;
  url: string;
  snippet?: string;
  displayedUrl?: string;
}

export interface BrowserSearchOutput {
  query: string;
  queryUsed?: string;
  engine?: BrowserSearchEngine | string;
  searchUrl?: string;
  searchedAt?: string;
  results: BrowserSearchResultItem[];
  searchResultRef?: string;
}

export interface BrowserNavigateInput {
  schemaVersion: typeof BROWSER_PRIMITIVE_INPUT_SCHEMAS.navigate;
  url: string;
  sessionId?: string;
  timeoutMs?: number;
  capture?: BrowserCaptureMode;
  constraints?: BrowserPrimitiveConstraints;
}

export interface BrowserNavigateOutput {
  sessionId: string;
  sessionRef?: string;
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  openedAt?: string;
  navigation?: {
    redirected?: boolean;
    blockedByLogin?: boolean;
    blockedByConsent?: boolean;
    errorCode?: string;
  };
  frameRef?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
}

export interface BrowserObserveInput {
  schemaVersion: typeof BROWSER_PRIMITIVE_INPUT_SCHEMAS.observe;
  sessionId: string;
  timeoutMs?: number;
  capture?: BrowserCaptureMode;
}

export interface BrowserObserveOutput {
  sessionId: string;
  url?: string;
  title?: string;
  status?: string;
  stateRef?: string;
  frameRef?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  diagnostics?: string[];
}

export interface BrowserReadInput {
  schemaVersion: typeof BROWSER_PRIMITIVE_INPUT_SCHEMAS.read;
  resourceRef?: string;
  sessionId?: string;
  url?: string;
  navigationMode?: BrowserReadNavigationMode;
  includeText?: boolean;
  includeHtml?: boolean;
  maxTextChars?: number;
  timeoutMs?: number;
}

export interface BrowserReadOutput {
  sessionId?: string;
  url?: string;
  finalUrl: string;
  title?: string;
  contentType?: string;
  sourcePageRef: string;
  pageTextRef?: string;
  htmlRef?: string;
  textPreview?: string;
  textCharCount?: number;
  textSha1?: string;
}

export interface BrowserExtractInput {
  schemaVersion: typeof BROWSER_PRIMITIVE_INPUT_SCHEMAS.extract;
  ref: string;
  extract: BrowserExtractTarget[];
  maxItems?: number;
}

export interface BrowserExtractOutput {
  ref: string;
  links?: Array<{ url: string; text?: string; rel?: string; confidence?: number }>;
  forms?: Array<{
    action?: string;
    method?: 'get' | 'post';
    controls: Array<{ name?: string; type?: string; value?: string }>;
  }>;
  dates?: Array<{ value: string; label?: string; context?: string }>;
  metadata?: Record<string, string>;
  resultItems?: Array<{ title?: string; url?: string; snippet?: string; date?: string }>;
}

export interface BrowserDownloadInput {
  schemaVersion: typeof BROWSER_PRIMITIVE_INPUT_SCHEMAS.download;
  url?: string;
  sessionId?: string;
  linkSelector?: string;
  saveScope: 'session-artifacts';
  maxBytes?: number;
  timeoutMs?: number;
  filenameHint?: string;
  constraints?: BrowserPrimitiveConstraints;
}

export interface BrowserDownloadOutput {
  artifactRef: string;
  filename?: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
  finalUrl?: string;
}

export type BrowserPrimitiveInput =
  | BrowserSearchInput
  | BrowserNavigateInput
  | BrowserObserveInput
  | BrowserReadInput
  | BrowserExtractInput
  | BrowserDownloadInput;

export interface BrowserPrimitiveValidationResult {
  ok: boolean;
  primitive?: BrowserPrimitiveName;
  input?: BrowserPrimitiveInput;
  errors: string[];
}

export interface BrowserPrimitivePortResult<T = unknown> {
  status: BrowserPrimitiveStatus;
  output?: T;
  refs?: string[];
  resources?: BrowserResource[];
  evidenceState?: BrowserEvidenceState;
  diagnostics?: BrowserDiagnostic[];
  budget?: BrowserPrimitiveBudget;
  blockedReason?: string;
  repairHints?: BrowserRepairHint[];
}

export interface BrowserPrimitivePorts {
  search?(input: BrowserSearchInput): Promise<BrowserPrimitivePortResult<BrowserSearchOutput>> | BrowserPrimitivePortResult<BrowserSearchOutput>;
  navigate?(input: BrowserNavigateInput): Promise<BrowserPrimitivePortResult<BrowserNavigateOutput>> | BrowserPrimitivePortResult<BrowserNavigateOutput>;
  observe?(input: BrowserObserveInput): Promise<BrowserPrimitivePortResult<BrowserObserveOutput>> | BrowserPrimitivePortResult<BrowserObserveOutput>;
  read?(input: BrowserReadInput): Promise<BrowserPrimitivePortResult<BrowserReadOutput>> | BrowserPrimitivePortResult<BrowserReadOutput>;
  extract?(input: BrowserExtractInput): Promise<BrowserPrimitivePortResult<BrowserExtractOutput>> | BrowserPrimitivePortResult<BrowserExtractOutput>;
  download?(input: BrowserDownloadInput): Promise<BrowserPrimitivePortResult<BrowserDownloadOutput>> | BrowserPrimitivePortResult<BrowserDownloadOutput>;
}

export interface BrowserPrimitiveServiceOptions {
  ports?: BrowserPrimitivePorts;
  now?: () => number;
}

export interface BrowserPrimitiveService {
  describe(): ModuleDescription;
  invoke(request: ModuleInvokeRequest): Promise<ModuleInvokeResult<BrowserPrimitiveEnvelope>>;
}

const INTENT_TO_PRIMITIVE = new Map<BrowserPrimitiveIntent, BrowserPrimitiveName>(
  BROWSER_PRIMITIVE_NAMES.map((primitive) => [BROWSER_PRIMITIVE_INTENTS[primitive], primitive]),
);

export function createBrowserPrimitiveService(options: BrowserPrimitiveServiceOptions = {}): BrowserPrimitiveService {
  const ports = options.ports ?? {};
  const now = options.now ?? Date.now;
  const resourceLedger = new Map<string, BrowserResource>();
  return {
    describe: browserPrimitiveModuleDescription,
    invoke: async (request) => {
      const startedAt = now();
      const validation = validateBrowserPrimitiveInvokeRequest(request);
      if (!validation.ok || !validation.primitive || !validation.input) {
        return moduleResult({
          moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
          ok: false,
          error: validation.errors.join(';'),
        });
      }
      const primitive = validation.primitive;
      const input = primitive === 'read'
        ? resolveBrowserReadInput(validation.input as BrowserReadInput, resourceLedger)
        : validation.input;
      if (!input) {
        return primitiveModuleResult(primitive, {
          status: 'blocked',
          blockedReason: 'browser_resource_ref_unresolved',
          refs: [],
          diagnostics: [{
            code: 'browser-resource-ref-unresolved',
            message: 'The requested Browser resourceRef is not known to this Browser Runtime service or does not contain a readable URL locator.',
            severity: 'error',
            retryable: false,
          }],
          budget: elapsedBudget(validation.input, startedAt, now()),
        }, resourceLedger);
      }
      const port = ports[primitive] as ((input: BrowserPrimitiveInput) => Promise<BrowserPrimitivePortResult> | BrowserPrimitivePortResult) | undefined;
      if (!port) {
        return primitiveModuleResult(primitive, {
          status: 'blocked',
          blockedReason: `missing_browser_primitive_port:${primitive}`,
          refs: [],
          diagnostics: [{
            code: 'missing-port',
            message: `No host port is registered for ${BROWSER_PRIMITIVE_INTENTS[primitive]}.`,
            severity: 'error',
            retryable: false,
          }],
          budget: elapsedBudget(input, startedAt, now()),
          repairHints: [{
            code: 'register-host-port',
            message: 'Register a Browser Runtime host port for this primitive before invoking it.',
            suggestedPrimitive: primitive,
          }],
        }, resourceLedger);
      }
      try {
        const result = await port(input);
        return primitiveModuleResult(primitive, {
          ...result,
          budget: mergeBudget(elapsedBudget(input, startedAt, now()), result.budget),
        }, resourceLedger);
      } catch (error) {
        return primitiveModuleResult(primitive, {
          status: 'failed',
          blockedReason: 'browser_primitive_port_error',
          refs: [],
          diagnostics: [{
            code: 'port-error',
            message: errorMessage(error),
            severity: 'error',
            retryable: true,
          }],
          budget: elapsedBudget(input, startedAt, now()),
        }, resourceLedger);
      }
    },
  };
}

export function validateBrowserPrimitiveInvokeRequest(request: ModuleInvokeRequest): BrowserPrimitiveValidationResult {
  const errors: string[] = [];
  if (request.moduleId !== BROWSER_PRIMITIVE_SERVICE_MODULE_ID) {
    errors.push(`module_id_mismatch:${request.moduleId}`);
  }
  const primitive = primitiveFromIntent(request.intent);
  if (!primitive) {
    errors.push(`unsupported_browser_primitive_intent:${request.intent}`);
    return { ok: false, errors };
  }
  const input = record(request.input);
  if (!input) return { ok: false, primitive, errors: [...errors, 'missing_input'] };

  if (primitive === 'search') validateSearchInput(input, errors);
  if (primitive === 'navigate') validateNavigateInput(input, errors);
  if (primitive === 'observe') validateObserveInput(input, errors);
  if (primitive === 'read') validateReadInput(input, errors);
  if (primitive === 'extract') validateExtractInput(input, errors);
  if (primitive === 'download') validateDownloadInput(input, errors);

  return {
    ok: errors.length === 0,
    primitive,
    input: errors.length === 0 ? input as unknown as BrowserPrimitiveInput : undefined,
    errors,
  };
}

export function validateWebToolInput(tool: string, inputValue: unknown): WebToolValidationResult {
  if (!isWebToolName(tool)) {
    return {
      ok: false,
      errors: [webToolError('invalid_input', `unsupported_web_tool:${tool}`)],
    };
  }
  const input = record(inputValue);
  if (!input) {
    return {
      ok: false,
      tool,
      errors: [webToolError('invalid_input', 'missing_input')],
    };
  }

  const errors: WebToolError[] = [];
  if (tool === WEB_SEARCH_TOOL_NAME) validateWebSearchInputRecord(input, errors);
  if (tool === WEB_READ_TOOL_NAME) validateWebReadInputRecord(input, errors);

  return {
    ok: errors.length === 0,
    tool,
    input: errors.length === 0 ? input as unknown as WebSearchInput | WebReadInput : undefined,
    errors,
  };
}

export function createWebToolResultEnvelope<T = WebSearchOutput | WebReadOutput>(input: {
  tool: WebToolName;
  status: WebToolStatus;
  provider?: string;
  data?: T;
  refs?: WebToolRef[];
  timings?: WebToolTimings;
  warnings?: WebToolWarning[];
  error?: WebToolError;
}): WebToolResultEnvelope<T> {
  const ok = input.status === 'completed' || input.status === 'partial';
  return {
    schemaVersion: WEB_TOOL_RESULT_SCHEMA,
    ok,
    status: input.status,
    tool: input.tool,
    provider: input.provider,
    data: input.data,
    refs: uniqueWebToolRefs(input.refs ?? []),
    timings: input.timings ?? {},
    warnings: input.warnings ?? [],
    error: input.error,
  };
}

export function browserPrimitiveEnvelopeToWebToolResult(
  tool: WebToolName,
  primitive: BrowserPrimitiveEnvelope,
  provider?: string,
): WebToolResultEnvelope {
  const warnings = primitive.diagnostics
    .filter((diagnostic) => diagnostic.severity !== 'error')
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      refs: diagnostic.refs,
    }));
  const errorDiagnostic = primitive.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  const error = primitive.status === 'completed' || primitive.status === 'partial'
    ? undefined
    : webToolError(
      webErrorCodeForPrimitive(tool, primitive, errorDiagnostic),
      primitive.blockedReason ?? errorDiagnostic?.message ?? `${tool} failed`,
      errorDiagnostic?.retryable,
      errorDiagnostic?.refs,
      provider,
    );

  return createWebToolResultEnvelope({
    tool,
    status: primitive.status,
    provider: provider ?? providerForPrimitive(tool, primitive.output),
    data: tool === WEB_SEARCH_TOOL_NAME
      ? webSearchOutputForPrimitive(primitive, provider)
      : webReadOutputForPrimitive(primitive),
    refs: webRefsForPrimitive(primitive),
    timings: webTimingsForPrimitive(primitive),
    warnings,
    error,
  });
}

export function browserPrimitiveModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    title: 'Browser Runtime',
    summary: 'Refs-first browser primitive module. Agent Host owns intent, repair, verification, and final synthesis.',
    resources: [
      { kind: 'browser-resource', refPrefix: 'browser:resource:', queryable: false, readable: true },
      { kind: 'browser-session', refPrefix: 'browser:session:', queryable: false, readable: true },
      { kind: 'browser-search-result', refPrefix: 'browser:search-result:', queryable: false, readable: true },
      { kind: 'browser-source-page', refPrefix: 'browser:source-page:', queryable: false, readable: true },
      { kind: 'browser-page-text', refPrefix: 'browser:page-text:', queryable: false, readable: true },
      { kind: 'browser-download', refPrefix: 'browser:download:', queryable: false, readable: true },
    ],
    intents: BROWSER_PRIMITIVE_NAMES.map((primitive) => ({
      name: BROWSER_PRIMITIVE_INTENTS[primitive],
      sideEffect: browserPrimitiveSideEffect(primitive),
      returnsOperation: false,
      summary: browserPrimitiveSummary(primitive),
    })),
    facets: { refs: true, events: true },
    limits: { maxInlineBytes: 16_000, expectedLatencyMs: 500 },
  });
}

function primitiveModuleResult(
  primitive: BrowserPrimitiveName,
  input: BrowserPrimitivePortResult,
  resourceLedger?: Map<string, BrowserResource>,
): ModuleInvokeResult<BrowserPrimitiveEnvelope> {
  const refs = uniqueStrings(input.refs ?? []);
  const output = input.output;
  const resources = uniqueBrowserResources([
    ...(input.resources ?? []),
    ...browserResourcesForPrimitive(primitive, output, refs),
  ]);
  registerBrowserResources(resourceLedger, resources);
  const evidenceState = input.evidenceState ?? browserEvidenceStateForPrimitive(primitive, input.status, resources);
  const value: BrowserPrimitiveEnvelope = {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    primitive,
    status: input.status,
    output,
    resources,
    evidenceState,
    refs,
    diagnostics: input.diagnostics ?? [],
    budget: input.budget ?? {},
    blockedReason: input.blockedReason,
    repairHints: input.repairHints,
  };
  return moduleResult({
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    ok: input.status === 'completed' || input.status === 'partial',
    value,
    refs,
    error: input.status === 'completed' || input.status === 'partial'
      ? undefined
      : input.blockedReason ?? input.status,
  });
}

function resolveBrowserReadInput(
  input: BrowserReadInput,
  resourceLedger: Map<string, BrowserResource>,
): BrowserReadInput | undefined {
  if (input.url || input.sessionId) return input;
  if (!input.resourceRef) return input;
  const resource = resourceLedger.get(input.resourceRef);
  if (!resource || resource.kind !== 'web_page') return undefined;
  const url = stringAt(resource.locator, 'url') ?? stringAt(resource.locator, 'finalUrl');
  if (!url || !isHttpUrl(url)) return undefined;
  return {
    ...input,
    url,
    navigationMode: input.navigationMode ?? 'ephemeral',
  };
}

function browserResourcesForPrimitive(
  primitive: BrowserPrimitiveName,
  output: unknown,
  refs: string[],
): BrowserResource[] {
  const originTool = BROWSER_PRIMITIVE_INTENTS[primitive];
  if (primitive === 'search') return browserResourcesForSearch(output, originTool);
  if (primitive === 'navigate') return browserResourcesForNavigate(output, originTool, refs);
  if (primitive === 'observe') return browserResourcesForObserve(output, originTool, refs);
  if (primitive === 'read') return browserResourcesForRead(output, originTool, refs);
  if (primitive === 'extract') return browserResourcesForExtract(output, originTool, refs);
  return browserResourcesForDownload(output, originTool, refs);
}

function browserResourcesForSearch(output: unknown, originTool: BrowserPrimitiveIntent): BrowserResource[] {
  const searchOutput = record(output);
  if (!searchOutput) return [];
  const resources: BrowserResource[] = [];
  const searchQuery = stringAt(searchOutput, 'queryUsed') ?? stringAt(searchOutput, 'query');
  const rawSearchResultRef = stringAt(searchOutput, 'searchResultRef');
  const searchResultRef = rawSearchResultRef?.startsWith(WEB_RESOURCE_REF_PREFIXES.searchResultSet)
    ? rawSearchResultRef
    : searchQuery
      ? webResourceRef(WEB_RESOURCE_REF_PREFIXES.searchResultSet, rawSearchResultRef ?? searchQuery)
      : undefined;
  if (searchResultRef) {
    resources.push({
      ref: searchResultRef,
      kind: 'search_result_set',
      status: 'discovered',
      originTool,
      locator: {
        query: searchQuery,
        searchUrl: stringAt(searchOutput, 'searchUrl'),
      },
      refs: [searchResultRef],
      confidence: 'candidate',
    });
  }
  for (const item of toRecordList(searchOutput.results)) {
    const url = stringAt(item, 'url');
    if (!url || !isHttpUrl(url)) continue;
    resources.push({
      ref: webResourceRef(WEB_RESOURCE_REF_PREFIXES.discoveredPage, url),
      kind: 'web_page',
      status: 'discovered',
      originTool,
      locator: { url },
      title: stringAt(item, 'title'),
      snippet: stringAt(item, 'snippet'),
      confidence: 'candidate',
      metadata: {
        rank: typeof item.rank === 'number' ? item.rank : undefined,
        displayedUrl: stringAt(item, 'displayedUrl'),
      },
    });
  }
  return resources;
}

function browserResourcesForNavigate(
  output: unknown,
  originTool: BrowserPrimitiveIntent,
  refs: string[],
): BrowserResource[] {
  const navigateOutput = record(output);
  if (!navigateOutput) return [];
  const resources: BrowserResource[] = [];
  const sessionId = stringAt(navigateOutput, 'sessionId');
  const sessionRef = stringAt(navigateOutput, 'sessionRef') ?? (sessionId ? `browser:resource:browser_session:${safeBrowserResourceSegment(sessionId)}` : undefined);
  const finalUrl = stringAt(navigateOutput, 'finalUrl');
  if (sessionRef) {
    resources.push({
      ref: sessionRef,
      kind: 'browser_session',
      status: 'accessed',
      originTool,
      locator: { sessionId, url: finalUrl },
      title: stringAt(navigateOutput, 'title'),
      refs,
      confidence: 'observed',
    });
  }
  if (finalUrl && isHttpUrl(finalUrl)) {
    resources.push({
      ref: browserResourceRef('web_page', finalUrl),
      kind: 'web_page',
      status: 'accessed',
      originTool,
      locator: { url: finalUrl, requestedUrl: stringAt(navigateOutput, 'requestedUrl') },
      title: stringAt(navigateOutput, 'title'),
      refs,
      confidence: 'observed',
    });
  }
  return resources;
}

function browserResourcesForObserve(
  output: unknown,
  originTool: BrowserPrimitiveIntent,
  refs: string[],
): BrowserResource[] {
  const observeOutput = record(output);
  if (!observeOutput) return [];
  const sessionId = stringAt(observeOutput, 'sessionId');
  const stateRef = stringAt(observeOutput, 'stateRef');
  const url = stringAt(observeOutput, 'url');
  const resources: BrowserResource[] = [];
  if (sessionId) {
    resources.push({
      ref: stateRef ?? `browser:resource:browser_session:${safeBrowserResourceSegment(sessionId)}`,
      kind: 'browser_session',
      status: 'observed',
      originTool,
      locator: { sessionId, url },
      title: stringAt(observeOutput, 'title'),
      refs,
      confidence: 'observed',
    });
  }
  if (url && isHttpUrl(url)) {
    resources.push({
      ref: browserResourceRef('web_page', url),
      kind: 'web_page',
      status: 'observed',
      originTool,
      locator: { url },
      title: stringAt(observeOutput, 'title'),
      refs,
      confidence: 'observed',
    });
  }
  return resources;
}

function browserResourcesForRead(
  output: unknown,
  originTool: BrowserPrimitiveIntent,
  refs: string[],
): BrowserResource[] {
  const readOutput = record(output);
  if (!readOutput) return [];
  const finalUrl = stringAt(readOutput, 'finalUrl') ?? stringAt(readOutput, 'url');
  const title = stringAt(readOutput, 'title');
  const sourcePageRef = stringAt(readOutput, 'sourcePageRef');
  const pageTextRef = stringAt(readOutput, 'pageTextRef');
  const resources: BrowserResource[] = [];
  if (finalUrl && isHttpUrl(finalUrl)) {
    resources.push({
      ref: browserResourceRef('web_page', finalUrl),
      kind: 'web_page',
      status: 'read',
      originTool,
      locator: { url: finalUrl },
      title,
      refs,
      confidence: 'materialized',
    });
  }
  if (sourcePageRef) {
    resources.push({
      ref: sourcePageRef,
      kind: 'source_page',
      status: 'read',
      originTool,
      locator: { url: finalUrl },
      title,
      refs: [sourcePageRef],
      confidence: 'materialized',
    });
  }
  if (pageTextRef) {
    resources.push({
      ref: pageTextRef,
      kind: 'page_text',
      status: 'read',
      originTool,
      locator: { url: finalUrl },
      title,
      refs: [pageTextRef],
      confidence: 'materialized',
      metadata: {
        textCharCount: typeof readOutput.textCharCount === 'number' ? readOutput.textCharCount : undefined,
        textSha1: stringAt(readOutput, 'textSha1'),
        textPreview: stringAt(readOutput, 'textPreview'),
        textSummary: stringAt(readOutput, 'textSummary'),
      },
    });
  }
  return resources;
}

function browserResourcesForExtract(
  output: unknown,
  originTool: BrowserPrimitiveIntent,
  refs: string[],
): BrowserResource[] {
  const extractOutput = record(output);
  if (!extractOutput) return [];
  const resources: BrowserResource[] = [];
  for (const link of toRecordList(extractOutput.links)) {
    const url = stringAt(link, 'url');
    if (!url || !isHttpUrl(url)) continue;
    resources.push({
      ref: browserResourceRef('web_page', url),
      kind: 'web_page',
      status: 'discovered',
      originTool,
      locator: { url },
      title: stringAt(link, 'text'),
      refs,
      confidence: 'candidate',
      metadata: {
        confidence: typeof link.confidence === 'number' ? link.confidence : undefined,
        sourceRef: stringAt(extractOutput, 'ref'),
      },
    });
  }
  return resources;
}

function browserResourcesForDownload(
  output: unknown,
  originTool: BrowserPrimitiveIntent,
  refs: string[],
): BrowserResource[] {
  const downloadOutput = record(output);
  if (!downloadOutput) return [];
  const artifactRef = stringAt(downloadOutput, 'artifactRef');
  if (!artifactRef) return [];
  return [{
    ref: artifactRef,
    kind: 'download_artifact',
    status: 'downloaded',
    originTool,
    locator: { url: stringAt(downloadOutput, 'finalUrl') },
    title: stringAt(downloadOutput, 'filename'),
    refs,
    confidence: 'materialized',
    metadata: {
      mimeType: stringAt(downloadOutput, 'mimeType'),
      byteLength: typeof downloadOutput.byteLength === 'number' ? downloadOutput.byteLength : undefined,
      sha256: stringAt(downloadOutput, 'sha256'),
    },
  }];
}

function browserEvidenceStateForPrimitive(
  primitive: BrowserPrimitiveName,
  status: BrowserPrimitiveStatus,
  resources: BrowserResource[],
): BrowserEvidenceState {
  if (status === 'blocked' || status === 'failed' || status === 'needs-confirmation') {
    return {
      completed: [],
      unknown: [`${BROWSER_PRIMITIVE_INTENTS[primitive]} did not complete successfully.`],
      boundary: 'A blocked, failed, or needs-confirmation Browser primitive is not user-level completion evidence.',
    };
  }
  if (primitive === 'search') {
    return {
      completed: [`Discovered ${resources.filter((resource) => resource.kind === 'web_page').length} candidate web page resource(s) for ordinary search.`],
      unknown: ['Candidate page bodies have not been read; page-level details, URL summaries, direct quotes, low-information results, or conflicting sources may need read-required escalation.'],
      boundary: 'Current-run browser.search results can support ordinary search answers with source links when sufficient; page-level content uses read-required escalation.',
    };
  }
  if (primitive === 'navigate') {
    return {
      completed: ['Navigated a browser session and recorded session/navigation refs.'],
      unknown: ['Full page text has not been materialized unless browser.read is called.'],
      boundary: 'Navigation proves browser state, not source-page textual evidence or task completion.',
    };
  }
  if (primitive === 'observe') {
    return {
      completed: ['Observed current browser session state and available visual/DOM refs.'],
      unknown: ['Long page content may still be unread.'],
      boundary: 'Observation refs describe current browser state; they are not a synthesized answer.',
    };
  }
  if (primitive === 'read') {
    return {
      completed: ['Materialized page content as source/page text refs.'],
      unknown: ['Task-level synthesis and verifier acceptance remain outside Browser Runtime.'],
      boundary: 'Read refs are Browser evidence; only Agent Host can decide how they support the user request.',
    };
  }
  if (primitive === 'extract') {
    return {
      completed: ['Parsed an existing Browser ref into structured local fields.'],
      unknown: ['Extracted links or remote resources have not been read or downloaded unless separate primitives are called.'],
      boundary: 'Extraction is local structure parsing, not network access or task completion.',
    };
  }
  return {
    completed: ['Downloaded a Host-selected resource into session-scoped artifacts.'],
    unknown: ['Downloaded bytes have not been interpreted by a parser, reader, or verifier.'],
    boundary: 'Download artifact refs prove controlled retrieval, not semantic understanding of file contents.',
  };
}

function registerBrowserResources(resourceLedger: Map<string, BrowserResource> | undefined, resources: BrowserResource[]) {
  if (!resourceLedger) return;
  for (const resource of resources) resourceLedger.set(resource.ref, resource);
  const overflow = resourceLedger.size - 500;
  if (overflow <= 0) return;
  for (const key of [...resourceLedger.keys()].slice(0, overflow)) resourceLedger.delete(key);
}

function uniqueBrowserResources(resources: BrowserResource[]): BrowserResource[] {
  const byRef = new Map<string, BrowserResource>();
  for (const resource of resources) {
    if (!resource.ref.trim()) continue;
    byRef.set(resource.ref, {
      ...resource,
      refs: uniqueStrings(resource.refs ?? []),
    });
  }
  return [...byRef.values()];
}

function browserResourceRef(kind: string, locator: string): string {
  return `browser:resource:${safeBrowserResourceSegment(kind)}:${stableBrowserResourceHash(locator)}`;
}

function webResourceRef(prefix: string, locator: string): string {
  return `${prefix}${stableBrowserResourceHash(locator)}`;
}

function stableBrowserResourceHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

function safeBrowserResourceSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'resource';
}

function validateWebSearchInputRecord(input: Record<string, unknown>, errors: WebToolError[]) {
  rejectUnknownWebFields(input, [
    'query',
    'limit',
    'language',
    'region',
    'time_range',
    'safe_search',
    'provider',
    'timeout_ms',
    'constraints',
  ], errors);
  if (!nonEmptyString(input.query)) errors.push(webToolError('invalid_input', 'missing_string:query'));
  validateOptionalIntegerRangeWeb(input.limit, 'limit', 1, WEB_SEARCH_LIMIT_MAX, errors);
  validateOptionalStringWeb(input.language, 'language', errors);
  validateOptionalStringWeb(input.region, 'region', errors);
  validateOptionalEnumWeb(input.time_range, WEB_SEARCH_TIME_RANGES, 'time_range', errors);
  validateOptionalEnumWeb(input.safe_search, WEB_SAFE_SEARCH_VALUES, 'safe_search', errors);
  validateOptionalStringWeb(input.provider, 'provider', errors);
  validateOptionalIntegerRangeWeb(input.timeout_ms, 'timeout_ms', 1, WEB_TOOL_TIMEOUT_MS_MAX, errors);
  validateOptionalWebConstraints(input.constraints, errors);
}

function validateWebReadInputRecord(input: Record<string, unknown>, errors: WebToolError[]) {
  rejectUnknownWebFields(input, [
    'url',
    'resourceRef',
    'format',
    'render',
    'max_chars',
    'timeout_ms',
    'cache_policy',
    'constraints',
  ], errors);
  const hasUrl = nonEmptyString(input.url);
  const hasResourceRef = nonEmptyString(input.resourceRef);
  if (!hasUrl && !hasResourceRef) errors.push(webToolError('invalid_input', 'missing_read_source:url_or_resourceRef'));
  if (hasUrl && hasResourceRef) errors.push(webToolError('invalid_input', 'ambiguous_read_source:choose_url_or_resourceRef'));
  if (hasUrl) validateSafeWebUrl(input.url, 'url', errors);
  if (hasResourceRef) {
    validateOptionalStringWeb(input.resourceRef, 'resourceRef', errors);
    if (!String(input.resourceRef).startsWith(WEB_RESOURCE_REF_PREFIXES.discoveredPage)) {
      errors.push(webToolError('invalid_input', `resourceRef_type_mismatch:${WEB_RESOURCE_REF_PREFIXES.discoveredPage.slice(0, -1)}`));
    }
  }
  validateOptionalEnumWeb(input.format, WEB_READ_FORMATS, 'format', errors);
  validateOptionalEnumWeb(input.render, WEB_READ_RENDER_MODES, 'render', errors);
  validateOptionalIntegerRangeWeb(input.max_chars, 'max_chars', 1, WEB_READ_MAX_CHARS_MAX, errors);
  validateOptionalIntegerRangeWeb(input.timeout_ms, 'timeout_ms', 1, WEB_TOOL_TIMEOUT_MS_MAX, errors);
  validateOptionalEnumWeb(input.cache_policy, WEB_CACHE_POLICIES, 'cache_policy', errors);
  validateOptionalWebConstraints(input.constraints, errors);
}

function rejectUnknownWebFields(input: Record<string, unknown>, allowed: string[], errors: WebToolError[]) {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(input)) {
    if (!allowedSet.has(field)) errors.push(webToolError('invalid_input', `unknown_input_field:${field}`));
  }
}

function validateOptionalStringWeb(value: unknown, field: string, errors: WebToolError[]) {
  if (value !== undefined && !nonEmptyString(value)) errors.push(webToolError('invalid_input', `invalid_string:${field}`));
}

function validateOptionalIntegerRangeWeb(
  value: unknown,
  field: string,
  min: number,
  max: number,
  errors: WebToolError[],
) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push(webToolError('invalid_input', `invalid_integer:${field}`));
  }
}

function validateOptionalEnumWeb(value: unknown, allowed: readonly string[], field: string, errors: WebToolError[]) {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) {
    errors.push(webToolError('invalid_input', `invalid_enum:${field}`));
  }
}

function validateOptionalWebConstraints(value: unknown, errors: WebToolError[]) {
  if (value === undefined) return;
  const constraints = record(value);
  if (!constraints) {
    errors.push(webToolError('invalid_input', 'invalid_object:constraints'));
    return;
  }
  rejectUnknownWebFields(constraints, ['allowedDomains', 'blockedDomains'], errors);
  validateOptionalStringArrayWeb(constraints.allowedDomains, 'constraints.allowedDomains', errors);
  validateOptionalStringArrayWeb(constraints.blockedDomains, 'constraints.blockedDomains', errors);
}

function validateOptionalStringArrayWeb(value: unknown, field: string, errors: WebToolError[]) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !nonEmptyString(item))) {
    errors.push(webToolError('invalid_input', `invalid_string_array:${field}`));
  }
}

function validateSafeWebUrl(value: unknown, field: string, errors: WebToolError[]) {
  if (!nonEmptyString(value)) {
    errors.push(webToolError('invalid_input', `missing_url:${field}`));
    return;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || isUnsafeWebHostname(url.hostname)) {
      errors.push(webToolError('unsafe_url', `unsafe_url:${field}`));
    }
  } catch {
    errors.push(webToolError('unsafe_url', `unsafe_url:${field}`));
  }
}

function isUnsafeWebHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isWebToolName(tool: string): tool is WebToolName {
  return WEB_TOOL_NAMES.includes(tool as WebToolName);
}

function webToolError(
  code: WebErrorCode,
  message: string,
  retryable?: boolean,
  refs?: string[],
  provider?: string,
): WebToolError {
  return {
    code,
    message,
    retryable,
    refs,
    provider,
  };
}

function uniqueWebToolRefs(refs: WebToolRef[]): WebToolRef[] {
  const byRef = new Map<string, WebToolRef>();
  for (const ref of refs) {
    if (!ref.ref.trim()) continue;
    byRef.set(ref.ref, ref);
  }
  return [...byRef.values()];
}

function webSearchOutputForPrimitive(primitive: BrowserPrimitiveEnvelope, provider?: string): WebSearchOutput {
  const output = record(primitive.output);
  const resolvedProvider = provider ?? providerForPrimitive(WEB_SEARCH_TOOL_NAME, primitive.output);
  const results = toRecordList(output?.results).map((item, index): WebSearchResultItem => {
    const url = stringAt(item, 'url') ?? '';
    return {
      rank: typeof item.rank === 'number' && Number.isFinite(item.rank) ? item.rank : index + 1,
      title: stringAt(item, 'title') ?? url,
      url,
      snippet: stringAt(item, 'snippet'),
      source: stringAt(item, 'source') ?? hostnameForUrl(url) ?? stringAt(item, 'displayedUrl') ?? '',
      publishedAt: stringAt(item, 'publishedAt'),
      provider: stringAt(item, 'provider') ?? resolvedProvider ?? stringAt(output, 'engine') ?? 'unknown',
    };
  });
  const searchRefs = primitive.resources
    .filter((resource) => resource.kind === 'search_result_set')
    .map((resource) => resource.ref);
  const discoveredPages = primitive.resources
    .filter((resource) => resource.kind === 'web_page' && resource.status === 'discovered')
    .map((resource) => resource.ref);
  return {
    query: stringAt(output, 'queryUsed') ?? stringAt(output, 'query') ?? '',
    provider: resolvedProvider,
    results,
    refs: {
      searchResultSet: searchRefs,
      discoveredPages,
    },
    evidenceBoundary: primitive.evidenceState.boundary
      || 'Ordinary search can be answered from current-run web_search results plus source links when sufficient; page-level detail, direct quotes, URL summaries, low-information results, or conflicting sources use read-required escalation. Ordinary search does not require web_read.',
    diagnostics: webDiagnosticsObject(primitive),
  };
}

function webReadOutputForPrimitive(primitive: BrowserPrimitiveEnvelope): WebReadOutput {
  const output = record(primitive.output);
  const sourcePageRefs = primitive.resources
    .filter((resource) => resource.kind === 'source_page')
    .map((resource) => resource.ref);
  const pageTextRefs = primitive.resources
    .filter((resource) => resource.kind === 'page_text')
    .map((resource) => resource.ref);
  return {
    requestedUrl: stringAt(output, 'requestedUrl') ?? stringAt(output, 'url'),
    finalUrl: stringAt(output, 'finalUrl'),
    title: stringAt(output, 'title'),
    author: stringAt(output, 'author'),
    publishedAt: stringAt(output, 'publishedAt'),
    contentType: stringAt(output, 'contentType'),
    language: stringAt(output, 'language'),
    contentPreview: stringAt(output, 'textPreview'),
    textCharCount: typeof output?.textCharCount === 'number' ? output.textCharCount : undefined,
    textSha1: stringAt(output, 'textSha1'),
    refs: {
      sourcePage: sourcePageRefs,
      pageText: pageTextRefs,
      html: stringAt(output, 'htmlRef'),
    },
    evidenceBoundary: primitive.evidenceState.boundary
      || 'web_read source/page text refs are evidence; Agent Host decides final answer sufficiency.',
    diagnostics: webDiagnosticsObject(primitive),
  };
}

function webRefsForPrimitive(primitive: BrowserPrimitiveEnvelope): WebToolRef[] {
  const refs: WebToolRef[] = primitive.resources.map((resource) => webRefForBrowserResource(resource));
  const knownRefs = new Set(refs.map((ref) => ref.ref));
  for (const ref of primitive.refs) {
    if (knownRefs.has(ref)) continue;
    refs.push(webRefForRawRef(ref));
  }
  return refs;
}

function webRefForBrowserResource(resource: BrowserResource): WebToolRef {
  if (resource.kind === 'search_result_set') {
    return {
      ref: normalizedWebRef(resource.ref, WEB_RESOURCE_REF_PREFIXES.searchResultSet, resource.locator?.query ?? resource.ref),
      kind: 'search_result_set',
      evidence: 'candidate',
      locator: resource.locator,
      title: resource.title,
      metadata: resource.metadata,
    };
  }
  if (resource.kind === 'web_page') {
    return {
      ref: normalizedWebRef(resource.ref, WEB_RESOURCE_REF_PREFIXES.discoveredPage, resource.locator?.url ?? resource.ref),
      kind: 'discovered_page',
      evidence: resource.status === 'read' ? 'source' : 'candidate',
      locator: resource.locator,
      title: resource.title,
      metadata: resource.metadata,
    };
  }
  if (resource.kind === 'source_page') {
    return {
      ref: normalizedWebRef(resource.ref, WEB_RESOURCE_REF_PREFIXES.sourcePage, resource.locator?.url ?? resource.ref),
      kind: 'source_page',
      evidence: 'source',
      locator: resource.locator,
      title: resource.title,
      metadata: resource.metadata,
    };
  }
  if (resource.kind === 'page_text') {
    return {
      ref: normalizedWebRef(resource.ref, WEB_RESOURCE_REF_PREFIXES.pageText, resource.locator?.url ?? resource.ref),
      kind: 'page_text',
      evidence: 'source',
      locator: resource.locator,
      title: resource.title,
      metadata: resource.metadata,
    };
  }
  return webRefForRawRef(resource.ref);
}

function webRefForRawRef(ref: string): WebToolRef {
  if (ref.startsWith(WEB_RESOURCE_REF_PREFIXES.searchResultSet)) {
    return { ref, kind: 'search_result_set', evidence: 'candidate' };
  }
  if (ref.startsWith(WEB_RESOURCE_REF_PREFIXES.discoveredPage)) {
    return { ref, kind: 'discovered_page', evidence: 'candidate' };
  }
  if (ref.startsWith(WEB_RESOURCE_REF_PREFIXES.sourcePage)) {
    return { ref, kind: 'source_page', evidence: 'source' };
  }
  if (ref.startsWith(WEB_RESOURCE_REF_PREFIXES.pageText)) {
    return { ref, kind: 'page_text', evidence: 'source' };
  }
  return { ref, kind: 'diagnostic', evidence: 'diagnostic' };
}

function normalizedWebRef(ref: string, prefix: string, fallbackLocator: unknown): string {
  if (ref.startsWith(prefix)) return ref;
  return webResourceRef(prefix, String(fallbackLocator ?? ref));
}

function webTimingsForPrimitive(primitive: BrowserPrimitiveEnvelope): WebToolTimings {
  const output = record(primitive.output);
  const timings = record(output?.timings);
  return {
    providerMs: numberAt(timings, 'providerMs') ?? numberAt(timings, 'providerLatencyMs'),
    fetchMs: numberAt(timings, 'fetchMs'),
    renderMs: numberAt(timings, 'renderMs'),
    extractMs: numberAt(timings, 'extractMs'),
    parseMs: numberAt(timings, 'parseMs') ?? numberAt(timings, 'parseLatencyMs'),
    persistMs: numberAt(timings, 'persistMs'),
    totalMs: numberAt(timings, 'totalMs') ?? primitive.budget.elapsedMs,
  };
}

function providerForPrimitive(tool: WebToolName, output: unknown): string | undefined {
  const value = record(output);
  if (!value) return undefined;
  if (tool === WEB_SEARCH_TOOL_NAME) return stringAt(value, 'provider') ?? stringAt(value, 'engine');
  return stringAt(value, 'provider');
}

function webDiagnosticsObject(primitive: BrowserPrimitiveEnvelope): Record<string, unknown> {
  return {
    status: primitive.status,
    blockedReason: primitive.blockedReason,
    diagnostics: primitive.diagnostics,
  };
}

function webErrorCodeForPrimitive(
  tool: WebToolName,
  primitive: BrowserPrimitiveEnvelope,
  diagnostic: BrowserDiagnostic | undefined,
): WebErrorCode {
  const text = `${primitive.blockedReason ?? ''} ${diagnostic?.code ?? ''} ${diagnostic?.message ?? ''}`.toLowerCase();
  if (text.includes('unsafe')) return 'unsafe_url';
  if (text.includes('timeout')) return 'timeout';
  if (text.includes('rate') || text.includes('429')) return 'rate_limited';
  if (text.includes('no_result') || text.includes('no result')) return 'no_results';
  if (text.includes('extract')) return 'extract_failed';
  if (text.includes('needs_user_browser') || text.includes('user browser') || text.includes('login') || text.includes('captcha')) {
    return 'needs_user_browser';
  }
  if (text.includes('needs_browser') || text.includes('browser')) return 'needs_browser';
  if (text.includes('provider') || text.includes('missing-port')) return 'provider_unavailable';
  return tool === WEB_SEARCH_TOOL_NAME ? 'provider_unavailable' : 'read_failed';
}

function hostnameForUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function validateSearchInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.search, errors);
  rejectUnknownFields(input, ['schemaVersion', 'query', 'engine', 'locale', 'region', 'timeRange', 'limit', 'budget', 'constraints'], errors);
  if (!nonEmptyString(input.query)) errors.push('missing_string:query');
  validateOptionalString(input.engine, 'engine', errors);
  validateOptionalString(input.locale, 'locale', errors);
  validateOptionalString(input.region, 'region', errors);
  validateOptionalString(input.timeRange, 'timeRange', errors);
  validateOptionalIntegerRange(input.limit, 'limit', 1, 20, errors);
  validateOptionalBudget(input.budget, errors);
  validateOptionalConstraints(input.constraints, errors);
}

function validateNavigateInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.navigate, errors);
  rejectUnknownFields(input, ['schemaVersion', 'url', 'sessionId', 'timeoutMs', 'capture', 'constraints'], errors);
  validateHttpUrl(input.url, 'url', errors);
  validateOptionalString(input.sessionId, 'sessionId', errors);
  validateOptionalFinitePositiveNumber(input.timeoutMs, 'timeoutMs', errors);
  validateOptionalEnum(input.capture, ['none', 'frame', 'screenshot'], 'capture', errors);
  validateOptionalConstraints(input.constraints, errors);
}

function validateObserveInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.observe, errors);
  rejectUnknownFields(input, ['schemaVersion', 'sessionId', 'timeoutMs', 'capture'], errors);
  if (!nonEmptyString(input.sessionId)) errors.push('missing_string:sessionId');
  validateOptionalFinitePositiveNumber(input.timeoutMs, 'timeoutMs', errors);
  validateOptionalEnum(input.capture, ['none', 'frame', 'screenshot'], 'capture', errors);
}

function validateReadInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.read, errors);
  rejectUnknownFields(input, ['schemaVersion', 'resourceRef', 'sessionId', 'url', 'navigationMode', 'includeText', 'includeHtml', 'maxTextChars', 'timeoutMs'], errors);
  const hasResourceRef = nonEmptyString(input.resourceRef);
  const hasSession = nonEmptyString(input.sessionId);
  const hasUrl = nonEmptyString(input.url);
  if (!hasResourceRef && !hasSession && !hasUrl) errors.push('missing_read_source:resourceRef_or_sessionId_or_url');
  if ([hasResourceRef, hasSession, hasUrl].filter(Boolean).length > 1) errors.push('ambiguous_read_source:choose_one_of_resourceRef_sessionId_url');
  if (hasUrl) {
    validateHttpUrl(input.url, 'url', errors);
    if (input.navigationMode !== 'ephemeral') errors.push('read_url_requires_navigationMode_ephemeral');
  } else if (hasResourceRef) {
    validateOptionalEnum(input.navigationMode, ['ephemeral'], 'navigationMode', errors);
  } else {
    validateOptionalEnum(input.navigationMode, ['none'], 'navigationMode', errors);
  }
  validateOptionalString(input.resourceRef, 'resourceRef', errors);
  validateOptionalString(input.sessionId, 'sessionId', errors);
  validateOptionalBoolean(input.includeText, 'includeText', errors);
  validateOptionalBoolean(input.includeHtml, 'includeHtml', errors);
  validateOptionalIntegerRange(input.maxTextChars, 'maxTextChars', 1, 1_000_000, errors);
  validateOptionalFinitePositiveNumber(input.timeoutMs, 'timeoutMs', errors);
}

function validateExtractInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.extract, errors);
  rejectUnknownFields(input, ['schemaVersion', 'ref', 'extract', 'maxItems'], errors);
  if (!nonEmptyString(input.ref)) errors.push('missing_string:ref');
  validateStringEnumArray(input.extract, BROWSER_EXTRACT_TARGETS, 'extract', errors);
  validateOptionalIntegerRange(input.maxItems, 'maxItems', 1, 10_000, errors);
}

function validateDownloadInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.download, errors);
  rejectUnknownFields(input, ['schemaVersion', 'url', 'sessionId', 'linkSelector', 'saveScope', 'maxBytes', 'timeoutMs', 'filenameHint', 'constraints'], errors);
  const hasUrl = nonEmptyString(input.url);
  const hasSessionLink = nonEmptyString(input.sessionId) && nonEmptyString(input.linkSelector);
  if (!hasUrl && !hasSessionLink) errors.push('missing_download_source:url_or_session_linkSelector');
  if (hasUrl && hasSessionLink) errors.push('ambiguous_download_source:choose_url_or_session_linkSelector');
  if (hasUrl) validateHttpUrl(input.url, 'url', errors);
  validateOptionalString(input.sessionId, 'sessionId', errors);
  validateOptionalString(input.linkSelector, 'linkSelector', errors);
  validateOptionalString(input.filenameHint, 'filenameHint', errors);
  validateRequiredLiteral(input.saveScope, 'session-artifacts', 'saveScope', errors);
  validateOptionalFinitePositiveNumber(input.maxBytes, 'maxBytes', errors);
  validateOptionalFinitePositiveNumber(input.timeoutMs, 'timeoutMs', errors);
  validateOptionalConstraints(input.constraints, errors);
}

function validateSchema(input: Record<string, unknown>, schemaVersion: string, errors: string[]) {
  if (input.schemaVersion !== schemaVersion) errors.push(`schema_version_mismatch:${schemaVersion}`);
}

function rejectUnknownFields(input: Record<string, unknown>, allowed: string[], errors: string[]) {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(input)) {
    if (!allowedSet.has(field)) errors.push(`unknown_input_field:${field}`);
  }
}

function validateOptionalBudget(value: unknown, errors: string[]) {
  if (value === undefined) return;
  const budget = record(value);
  if (!budget) {
    errors.push('invalid_object:budget');
    return;
  }
  rejectUnknownFields(budget, ['maxTimeMs', 'elapsedMs', 'maxBytes', 'bytesRead'], errors);
  validateOptionalFinitePositiveNumber(budget.maxTimeMs, 'budget.maxTimeMs', errors);
  validateOptionalFiniteNonNegativeNumber(budget.elapsedMs, 'budget.elapsedMs', errors);
  validateOptionalFinitePositiveNumber(budget.maxBytes, 'budget.maxBytes', errors);
  validateOptionalFiniteNonNegativeNumber(budget.bytesRead, 'budget.bytesRead', errors);
}

function validateOptionalConstraints(value: unknown, errors: string[]) {
  if (value === undefined) return;
  const constraints = record(value);
  if (!constraints) {
    errors.push('invalid_object:constraints');
    return;
  }
  rejectUnknownFields(constraints, ['allowedDomains', 'blockedDomains', 'safeSearch', 'requireUserConfirmationForCrossOrigin'], errors);
  validateOptionalStringArray(constraints.allowedDomains, 'constraints.allowedDomains', errors);
  validateOptionalStringArray(constraints.blockedDomains, 'constraints.blockedDomains', errors);
  validateOptionalEnum(constraints.safeSearch, ['off', 'moderate', 'strict'], 'constraints.safeSearch', errors);
  validateOptionalBoolean(constraints.requireUserConfirmationForCrossOrigin, 'constraints.requireUserConfirmationForCrossOrigin', errors);
}

function validateOptionalString(value: unknown, field: string, errors: string[]) {
  if (value !== undefined && !nonEmptyString(value)) errors.push(`invalid_string:${field}`);
}

function validateOptionalStringArray(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !nonEmptyString(item))) errors.push(`invalid_string_array:${field}`);
}

function validateStringEnumArray<T extends readonly string[]>(value: unknown, allowed: T, field: string, errors: string[]) {
  if (!Array.isArray(value) || !value.length) {
    errors.push(`missing_enum_array:${field}`);
    return;
  }
  const allowedSet = new Set<string>(allowed);
  for (const item of value) {
    if (typeof item !== 'string' || !allowedSet.has(item)) errors.push(`invalid_enum:${field}`);
  }
}

function validateOptionalBoolean(value: unknown, field: string, errors: string[]) {
  if (value !== undefined && typeof value !== 'boolean') errors.push(`invalid_boolean:${field}`);
}

function validateOptionalEnum(value: unknown, allowed: readonly string[], field: string, errors: string[]) {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) errors.push(`invalid_enum:${field}`);
}

function validateRequiredLiteral(value: unknown, expected: string, field: string, errors: string[]) {
  if (value !== expected) errors.push(`invalid_literal:${field}`);
}

function validateOptionalIntegerRange(value: unknown, field: string, min: number, max: number, errors: string[]) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) errors.push(`invalid_integer:${field}`);
}

function validateOptionalFinitePositiveNumber(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors.push(`invalid_number:${field}`);
}

function validateOptionalFiniteNonNegativeNumber(value: unknown, field: string, errors: string[]) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`invalid_number:${field}`);
}

function validateHttpUrl(value: unknown, field: string, errors: string[]) {
  if (!nonEmptyString(value)) {
    errors.push(`missing_url:${field}`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.push(`invalid_url:${field}`);
  } catch {
    errors.push(`invalid_url:${field}`);
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function primitiveFromIntent(intent: string): BrowserPrimitiveName | undefined {
  return INTENT_TO_PRIMITIVE.get(intent as BrowserPrimitiveIntent);
}

function browserPrimitiveSideEffect(primitive: BrowserPrimitiveName) {
  if (primitive === 'extract' || primitive === 'observe') return 'none' as const;
  if (primitive === 'download') return 'workspace' as const;
  return 'external' as const;
}

function browserPrimitiveSummary(primitive: BrowserPrimitiveName) {
  if (primitive === 'search') return 'Run a Codex-compatible ordinary web_search fallback query and return result refs/source links without reading result pages.';
  if (primitive === 'navigate') return 'Navigate to a Host-provided URL and return session/navigation refs.';
  if (primitive === 'observe') return 'Return current Browser session state and visual/DOM evidence refs.';
  if (primitive === 'read') return 'Materialize current page or ephemeral URL content as refs-first source evidence.';
  if (primitive === 'extract') return 'Parse trusted refs for links, forms, dates, metadata, or result items without network access.';
  return 'Download a Host-selected remote resource into session-scoped artifacts.';
}

function elapsedBudget(input: BrowserPrimitiveInput, startedAt: number, endedAt: number): BrowserPrimitiveBudget {
  const budget = record((input as { budget?: unknown }).budget);
  return {
    ...budget,
    elapsedMs: Math.max(0, endedAt - startedAt),
  };
}

function mergeBudget(base: BrowserPrimitiveBudget, override: BrowserPrimitiveBudget | undefined): BrowserPrimitiveBudget {
  return { ...base, ...override };
}

function objectSchema(required: string[], properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function webConstraintsSchema() {
  return objectSchema([], {
    allowedDomains: { type: 'array', items: { type: 'string' } },
    blockedDomains: { type: 'array', items: { type: 'string' } },
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function numberAt(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const item = value?.[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function stringAt(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim() : undefined;
}

function toRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(record(item))) : [];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
