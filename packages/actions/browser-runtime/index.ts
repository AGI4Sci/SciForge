import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleInvokeResult,
} from '@sciforge-ui/runtime-contract/modules';

export const BROWSER_PRIMITIVE_SERVICE_MODULE_ID = 'browser' as const;
export const BROWSER_PRIMITIVE_RESULT_SCHEMA = 'sciforge.browser-runtime.primitive-result.v1' as const;

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
export type BrowserSearchEngine = 'bing' | 'duckduckgo';
export type BrowserSafeSearch = 'off' | 'moderate' | 'strict';
export type BrowserReadNavigationMode = 'none' | 'ephemeral';
export type BrowserExtractTarget = typeof BROWSER_EXTRACT_TARGETS[number];

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

export interface BrowserPrimitiveEnvelope<T = unknown> {
  schemaVersion: typeof BROWSER_PRIMITIVE_RESULT_SCHEMA;
  moduleId: typeof BROWSER_PRIMITIVE_SERVICE_MODULE_ID;
  primitive: BrowserPrimitiveName;
  status: BrowserPrimitiveStatus;
  output?: T;
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
      const input = validation.input;
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
        });
      }
      try {
        const result = await port(input);
        return primitiveModuleResult(primitive, {
          ...result,
          budget: mergeBudget(elapsedBudget(input, startedAt, now()), result.budget),
        });
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
        });
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

export function browserPrimitiveModuleDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    title: 'Browser Runtime',
    summary: 'Refs-first browser primitive module. Agent Host owns intent, repair, verification, and final synthesis.',
    resources: [
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
): ModuleInvokeResult<BrowserPrimitiveEnvelope> {
  const refs = uniqueStrings(input.refs ?? []);
  const value: BrowserPrimitiveEnvelope = {
    schemaVersion: BROWSER_PRIMITIVE_RESULT_SCHEMA,
    moduleId: BROWSER_PRIMITIVE_SERVICE_MODULE_ID,
    primitive,
    status: input.status,
    output: input.output,
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

function validateSearchInput(input: Record<string, unknown>, errors: string[]) {
  validateSchema(input, BROWSER_PRIMITIVE_INPUT_SCHEMAS.search, errors);
  rejectUnknownFields(input, ['schemaVersion', 'query', 'engine', 'locale', 'region', 'limit', 'budget', 'constraints'], errors);
  if (!nonEmptyString(input.query)) errors.push('missing_string:query');
  validateOptionalEnum(input.engine, ['bing', 'duckduckgo'], 'engine', errors);
  validateOptionalString(input.locale, 'locale', errors);
  validateOptionalString(input.region, 'region', errors);
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
  rejectUnknownFields(input, ['schemaVersion', 'sessionId', 'url', 'navigationMode', 'includeText', 'includeHtml', 'maxTextChars', 'timeoutMs'], errors);
  const hasSession = nonEmptyString(input.sessionId);
  const hasUrl = nonEmptyString(input.url);
  if (!hasSession && !hasUrl) errors.push('missing_read_source:sessionId_or_url');
  if (hasUrl) {
    validateHttpUrl(input.url, 'url', errors);
    if (input.navigationMode !== 'ephemeral') errors.push('read_url_requires_navigationMode_ephemeral');
  } else {
    validateOptionalEnum(input.navigationMode, ['none'], 'navigationMode', errors);
  }
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
  rejectUnknownFields(input, ['schemaVersion', 'url', 'sessionId', 'linkSelector', 'saveScope', 'maxBytes', 'timeoutMs', 'filenameHint'], errors);
  const hasUrl = nonEmptyString(input.url);
  const hasSessionLink = nonEmptyString(input.sessionId) && nonEmptyString(input.linkSelector);
  if (!hasUrl && !hasSessionLink) errors.push('missing_download_source:url_or_session_linkSelector');
  if (hasUrl) validateHttpUrl(input.url, 'url', errors);
  validateOptionalString(input.sessionId, 'sessionId', errors);
  validateOptionalString(input.linkSelector, 'linkSelector', errors);
  validateOptionalString(input.filenameHint, 'filenameHint', errors);
  validateRequiredLiteral(input.saveScope, 'session-artifacts', 'saveScope', errors);
  validateOptionalFinitePositiveNumber(input.maxBytes, 'maxBytes', errors);
  validateOptionalFinitePositiveNumber(input.timeoutMs, 'timeoutMs', errors);
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

function primitiveFromIntent(intent: string): BrowserPrimitiveName | undefined {
  return INTENT_TO_PRIMITIVE.get(intent as BrowserPrimitiveIntent);
}

function browserPrimitiveSideEffect(primitive: BrowserPrimitiveName) {
  if (primitive === 'extract' || primitive === 'observe') return 'none' as const;
  if (primitive === 'download') return 'workspace' as const;
  return 'external' as const;
}

function browserPrimitiveSummary(primitive: BrowserPrimitiveName) {
  if (primitive === 'search') return 'Discover candidate URLs for a Host-provided query without reading result pages.';
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

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
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
