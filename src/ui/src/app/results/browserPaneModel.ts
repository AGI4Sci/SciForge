import {
  type BrowserWorkbenchStateStatus,
} from '../../../../../packages/presentation/components';
import type { ObjectReference } from '../../domain';
import {
  artifactForObjectReference,
  type ObjectReferenceSessionLike,
  pathForObjectReference,
} from '../../../../../packages/support/object-references';
import {
  buildBrowserWorkbenchPdfViewerUrl,
  browserPreviewSandboxForUrl,
  browserWorkbenchUrlIsLocal,
  normalizeBrowserWorkbenchUrl,
  shouldUseBrowserWorkbenchPdfViewerUrl,
} from '../browserWorkbenchUrlModel';

export type RightPaneBrowserProjectionStatus = BrowserWorkbenchStateStatus;
export type RightPaneBrowserProjectionTabStatus = 'new' | 'loading' | 'ready' | 'failed' | 'closed';

export const RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA = 'sciforge.browser-pane.loading-progress.lifecycle.v1' as const;
export const RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES = [
  'navigation-start',
  'navigation-committed',
  'interactive',
  'load',
  'network-quiet',
  'stalled',
  'blocked',
  'retry',
  'handoff',
] as const;

export type RightPaneBrowserLoadingProgressState = typeof RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES[number];
export type RightPaneBrowserLoadingProgressReason =
  | 'navigation-requested'
  | 'navigation-committed'
  | 'page-interactive'
  | 'page-load'
  | 'network-quiet'
  | 'navigation-stalled'
  | 'navigation-blocked'
  | 'navigation-retry'
  | 'user-handoff-required'
  | 'host-starting'
  | 'host-loading'
  | 'host-ready'
  | 'host-error'
  | 'host-diagnostic';
export type RightPaneBrowserLoadingProgressSource =
  | 'host-lifecycle'
  | 'host-progress'
  | 'host-navigation'
  | 'host-action-timing'
  | 'host-state'
  | 'host-session'
  | 'ui-command'
  | 'host-error';

export interface RightPaneBrowserLoadingProgressLifecycle {
  schemaVersion: typeof RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA;
  state: RightPaneBrowserLoadingProgressState;
  reason: RightPaneBrowserLoadingProgressReason;
  source: RightPaneBrowserLoadingProgressSource;
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
  requestedUrl?: string;
  currentUrl?: string;
  finalUrl?: string;
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface RightPaneBrowserHostLoadingProgressRecord {
  schemaVersion?: string;
  state?: RightPaneBrowserLoadingProgressState | string;
  reason?: RightPaneBrowserLoadingProgressReason | string;
  source?: RightPaneBrowserLoadingProgressSource | string;
  status?: RightPaneBrowserProjectionStatus | RightPaneBrowserProjectionTabStatus | string;
  tabStatus?: RightPaneBrowserProjectionTabStatus;
  action?: string;
  updatedAt?: string;
  refs?: {
    session?: string;
    liveSurface?: string;
    frameStream?: string;
    frame?: string;
    screenshot?: string;
    domSnapshot?: string;
    axSnapshot?: string;
    consoleLog?: string;
    networkLog?: string;
    searchResult?: string;
  };
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface RightPaneBrowserLoadingProgressInput {
  targetUrl?: string;
  hostBusy?: boolean;
  hostError?: string;
  hostSession?: RightPaneBrowserHostSessionState | Record<string, unknown>;
  hostState?: RightPaneBrowserHostState | Record<string, unknown>;
}

export interface RightPaneBrowserProjectionState {
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
  previewUrl?: string;
  externalUrl?: string;
  previewSandbox?: string;
  reason?: string;
  detail?: string;
  ref?: string;
  canRenderFrame?: boolean;
  hostSurface?: string;
  loadingProgress?: RightPaneBrowserLoadingProgressLifecycle;
  embedPolicy?: {
    embeddable?: boolean;
    status?: RightPaneBrowserProjectionStatus;
    reason?: string;
    ref?: string;
  };
}

export interface RightPaneBrowserHostState {
  ok?: boolean;
  url?: string;
  reason?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  surface?: string;
}

export interface RightPaneBrowserHostSessionState {
  id: string;
  status: 'starting' | 'loading' | 'ready' | 'failed' | 'closed';
  requestedUrl?: string;
  url: string;
  title?: string;
  updatedAt?: string;
  workspaceWriterBaseUrl?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  liveSurfaceRef?: string;
  liveSurfaceTransport?: 'host-stream' | 'native-embedded';
  singleInteractiveTruth?: true;
  frameStreamRef?: string;
  frameRef?: string;
  frameUrl?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  searchResultRef?: string;
  reason?: string;
  diagnostics?: string[];
  loadingProgress?: RightPaneBrowserLoadingProgressLifecycle | RightPaneBrowserHostLoadingProgressRecord;
}

export interface RightPaneBrowserProjectionOptions {
  hostExternalBrowserAvailable?: boolean;
  hostSurface?: string;
  hostBusy?: boolean;
  hostSession?: RightPaneBrowserHostSessionState;
  hostState?: RightPaneBrowserHostState;
  hostError?: string;
}

export function browserAddressForFocusedObjectReference(reference: ObjectReference | undefined, session: Pick<ObjectReferenceSessionLike, 'artifacts'>) {
  if (!reference) return undefined;
  const focusedHostSession = browserHostSessionForFocusedObjectReference(reference, session);
  if (focusedHostSession?.url) return normalizeRightPaneBrowserUrl(focusedHostSession.url);
  const artifactUrl = browserProjectionArtifactUrl(reference, session);
  if (artifactUrl) return normalizeRightPaneBrowserUrl(artifactUrl);
  if (reference.kind !== 'url' && !/^(?:url:|https?:\/\/|browser:|browser-runtime:|browser-session:|browser-snapshot:|browser-host-session:)/i.test(reference.ref)) return undefined;
  const path = pathForObjectReference(reference, session) ?? reference.ref.replace(/^url:/i, '');
  if (!path.trim()) return undefined;
  return normalizeRightPaneBrowserUrl(path);
}

export function browserHostSessionForFocusedObjectReference(
  reference: ObjectReference | undefined,
  session: Pick<ObjectReferenceSessionLike, 'artifacts'>,
): RightPaneBrowserHostSessionState | undefined {
  if (!reference || reference.kind !== 'artifact') return undefined;
  const artifact = artifactForObjectReference(reference, session);
  if (artifact?.type !== 'browser-runtime-projection') return undefined;
  const data = recordValue(artifact.data);
  const hostSession = recordValue(data?.hostSession) ?? recordValue(recordValue(data?.projection)?.hostSession);
  const id = stringField(hostSession?.id);
  const url = stringField(hostSession?.url) ?? stringField(hostSession?.requestedUrl) ?? browserProjectionArtifactUrl(reference, session);
  if (!id || !url) return undefined;
  return {
    id,
    status: browserHostSessionStatus(hostSession?.status),
    requestedUrl: stringField(hostSession?.requestedUrl),
    url: normalizeRightPaneBrowserUrl(url),
    title: stringField(hostSession?.title),
    updatedAt: stringField(hostSession?.updatedAt),
    workspaceWriterBaseUrl: stringField(hostSession?.workspaceWriterBaseUrl),
    canGoBack: booleanField(hostSession?.canGoBack),
    canGoForward: booleanField(hostSession?.canGoForward),
    liveSurfaceRef: stringField(hostSession?.liveSurfaceRef),
    liveSurfaceTransport: browserHostLiveSurfaceTransport(hostSession?.liveSurfaceTransport),
    singleInteractiveTruth: hostSession?.singleInteractiveTruth === true ? true : undefined,
    frameStreamRef: stringField(hostSession?.frameStreamRef),
    frameRef: stringField(hostSession?.frameRef),
    frameUrl: stringField(hostSession?.frameUrl),
    screenshotRef: stringField(hostSession?.screenshotRef),
    domSnapshotRef: stringField(hostSession?.domSnapshotRef),
    axSnapshotRef: stringField(hostSession?.axSnapshotRef),
    consoleLogRef: stringField(hostSession?.consoleLogRef),
    networkLogRef: stringField(hostSession?.networkLogRef),
    searchResultRef: stringField(hostSession?.searchResultRef),
    reason: stringField(hostSession?.reason),
    diagnostics: arrayOfStrings(hostSession?.diagnostics),
    loadingProgress: rightPaneBrowserLoadingProgressLifecycle({ hostSession }),
  };
}

function browserProjectionArtifactUrl(reference: ObjectReference, session: Pick<ObjectReferenceSessionLike, 'artifacts'>) {
  if (reference.kind !== 'artifact') return undefined;
  const artifact = artifactForObjectReference(reference, session);
  if (artifact?.type !== 'browser-runtime-projection') return undefined;
  const data = recordValue(artifact.data);
  const metadata = recordValue(artifact.metadata);
  const hostSession = recordValue(data?.hostSession) ?? recordValue(recordValue(data?.projection)?.hostSession);
  return stringField(hostSession?.url)
    ?? stringField(hostSession?.requestedUrl)
    ?? stringField(data?.finalUrl)
    ?? stringField(recordValue(data?.snapshot)?.url)
    ?? stringField(metadata?.finalUrl);
}

function browserHostSessionStatus(value: unknown): RightPaneBrowserHostSessionState['status'] {
  return value === 'starting' || value === 'loading' || value === 'ready' || value === 'failed' || value === 'closed'
    ? value
    : 'ready';
}

function browserHostLiveSurfaceTransport(value: unknown): RightPaneBrowserHostSessionState['liveSurfaceTransport'] {
  return value === 'host-stream' || value === 'native-embedded' ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_BY_STATE: Record<RightPaneBrowserLoadingProgressState, RightPaneBrowserLoadingProgressReason> = {
  'navigation-start': 'navigation-requested',
  'navigation-committed': 'navigation-committed',
  interactive: 'page-interactive',
  load: 'page-load',
  'network-quiet': 'network-quiet',
  stalled: 'navigation-stalled',
  blocked: 'navigation-blocked',
  retry: 'navigation-retry',
  handoff: 'user-handoff-required',
};

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_SURFACE_BY_STATE: Record<RightPaneBrowserLoadingProgressState, {
  status: RightPaneBrowserProjectionStatus;
  tabStatus: RightPaneBrowserProjectionTabStatus;
}> = {
  'navigation-start': { status: 'loading', tabStatus: 'loading' },
  'navigation-committed': { status: 'loading', tabStatus: 'loading' },
  interactive: { status: 'loading', tabStatus: 'loading' },
  load: { status: 'loading', tabStatus: 'loading' },
  'network-quiet': { status: 'ready', tabStatus: 'ready' },
  stalled: { status: 'loading', tabStatus: 'loading' },
  blocked: { status: 'blocked', tabStatus: 'failed' },
  retry: { status: 'loading', tabStatus: 'loading' },
  handoff: { status: 'blocked', tabStatus: 'failed' },
};

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATE_ALIASES = loadingProgressAliasMap<RightPaneBrowserLoadingProgressState>({
  'navigation-start': ['navigation-start', 'navigation-started', 'navigation-starting', 'navigation-requested', 'start', 'started', 'starting', 'requested'],
  'navigation-committed': ['navigation-committed', 'committed', 'commit'],
  interactive: ['interactive', 'user-interactive', 'dom-interactive', 'domcontentloaded', 'dom-content-loaded', 'document-interactive', 'document-ready'],
  load: ['load', 'loaded', 'page-load', 'load-event', 'window-load'],
  'network-quiet': ['network-quiet', 'networkquiet', 'network-idle', 'networkidle', 'network-idle0', 'network-idle2', 'idle'],
  stalled: ['stalled', 'stall', 'timeout', 'timed-out', 'no-progress', 'no-progress-timeout', 'first-paint-timeout'],
  blocked: ['blocked', 'block', 'policy-blocked', 'navigation-blocked', 'host-blocked'],
  retry: ['retry', 'retrying', 'retryable', 'retry-after', 'host-retry'],
  handoff: ['handoff', 'requires-handoff', 'requires-user-handoff', 'user-handoff', 'external-handoff', 'open-external'],
});

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_ALIASES = loadingProgressAliasMap<RightPaneBrowserLoadingProgressReason>({
  'navigation-requested': ['navigation-requested', 'request-started', 'url-submitted'],
  'navigation-committed': ['navigation-committed', 'commit-observed', 'response-committed'],
  'page-interactive': ['page-interactive', 'dom-interactive', 'domcontentloaded', 'dom-content-loaded', 'interactive'],
  'page-load': ['page-load', 'load-event', 'window-load', 'loaded'],
  'network-quiet': ['network-quiet', 'network-idle', 'networkidle'],
  'navigation-stalled': ['navigation-stalled', 'no-progress-timeout', 'first-paint-timeout', 'timeout', 'stalled'],
  'navigation-blocked': ['navigation-blocked', 'host-blocked', 'policy-blocked', 'blocked'],
  'navigation-retry': ['navigation-retry', 'retry', 'retrying', 'retry-after', 'retryable'],
  'user-handoff-required': ['user-handoff-required', 'requires-handoff', 'requires-user-handoff', 'handoff'],
  'host-starting': ['host-starting', 'browser-host-starting'],
  'host-loading': ['host-loading', 'browser-host-loading'],
  'host-ready': ['host-ready', 'browser-host-ready'],
  'host-error': ['host-error', 'browser-host-error'],
  'host-diagnostic': ['host-diagnostic', 'diagnostic'],
});

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_SOURCES = new Set<RightPaneBrowserLoadingProgressSource>([
  'host-lifecycle',
  'host-progress',
  'host-navigation',
  'host-action-timing',
  'host-state',
  'host-session',
  'ui-command',
  'host-error',
]);

const RIGHT_PANE_BROWSER_LOADING_PROGRESS_NESTED_FIELDS: Array<{
  field: string;
  source: RightPaneBrowserLoadingProgressSource;
}> = [
  { field: 'loadingProgress', source: 'host-progress' },
  { field: 'progress', source: 'host-progress' },
  { field: 'lifecycle', source: 'host-lifecycle' },
  { field: 'navigationLifecycle', source: 'host-lifecycle' },
  { field: 'navigation', source: 'host-navigation' },
  { field: 'loadState', source: 'host-progress' },
];

export function rightPaneBrowserLoadingProgressLifecycle(input: RightPaneBrowserLoadingProgressInput = {}): RightPaneBrowserLoadingProgressLifecycle | undefined {
  const hostSession = recordValue(input.hostSession);
  const hostState = recordValue(input.hostState);
  const explicit = explicitRightPaneBrowserLoadingProgress(hostSession)
    ?? explicitRightPaneBrowserLoadingProgress(hostState);
  if (explicit) return buildRightPaneBrowserLoadingProgressLifecycle(input, explicit.state, explicit.reason, explicit.source);

  const lastActionTiming = recordValue(hostSession?.lastActionTiming);
  if (stringField(lastActionTiming?.blockedReason) || stringField(hostSession?.blockedReason) || stringField(hostState?.blockedReason)) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'blocked', 'navigation-blocked', 'host-action-timing');
  }
  if (booleanField(hostSession?.requiresHandoff) || booleanField(hostState?.requiresHandoff) || stringField(hostSession?.handoffReason) || stringField(hostState?.handoffReason)) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'handoff', 'user-handoff-required', 'host-state');
  }
  if (booleanField(hostSession?.retrying) || booleanField(hostState?.retrying) || stringField(hostSession?.retryReason) || stringField(hostState?.retryReason)) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'retry', 'navigation-retry', 'host-state');
  }

  const hostStatus = stringField(hostSession?.status);
  const hostStateStatus = stringField(hostState?.status);
  if (input.hostError || hostStatus === 'failed' || hostState?.ok === false) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'blocked', 'host-error', input.hostError ? 'host-error' : 'host-session');
  }
  if (input.hostBusy && (!hostStatus || hostStatus === 'starting')) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'navigation-start', 'navigation-requested', 'ui-command');
  }
  if (hostStatus === 'starting') {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'navigation-start', 'host-starting', 'host-session');
  }
  if (input.hostBusy || hostStatus === 'loading' || hostStateStatus === 'loading') {
    return buildRightPaneBrowserLoadingProgressLifecycle(
      input,
      hostNavigationAppearsCommitted(input) ? 'navigation-committed' : 'navigation-start',
      'host-loading',
      input.hostBusy ? 'ui-command' : 'host-session',
    );
  }
  if (hostStatus === 'ready' || hostState?.ok === true) {
    return buildRightPaneBrowserLoadingProgressLifecycle(input, 'network-quiet', 'host-ready', 'host-session');
  }
  return undefined;
}

function explicitRightPaneBrowserLoadingProgress(record: Record<string, unknown> | undefined): {
  state: RightPaneBrowserLoadingProgressState;
  reason?: RightPaneBrowserLoadingProgressReason;
  source: RightPaneBrowserLoadingProgressSource;
} | undefined {
  if (!record) return undefined;
  for (const candidate of RIGHT_PANE_BROWSER_LOADING_PROGRESS_NESTED_FIELDS) {
    const nested = recordValue(record[candidate.field]);
    const fromNested = rightPaneBrowserLoadingProgressFromRecord(nested, candidate.source);
    if (fromNested) return fromNested;
    const fromString = rightPaneBrowserLoadingProgressStateFromUnknown(record[candidate.field]);
    if (fromString) return { state: fromString, source: candidate.source };
  }
  return rightPaneBrowserLoadingProgressFromRecord(record, 'host-session');
}

function rightPaneBrowserLoadingProgressFromRecord(
  record: Record<string, unknown> | undefined,
  source: RightPaneBrowserLoadingProgressSource,
): {
  state: RightPaneBrowserLoadingProgressState;
  reason?: RightPaneBrowserLoadingProgressReason;
  source: RightPaneBrowserLoadingProgressSource;
} | undefined {
  if (!record) return undefined;
  const state = firstLoadingProgressState(record, [
    'state',
    'stage',
    'phase',
    'kind',
    'lifecycleState',
    'progressState',
    'navigationState',
    'loadState',
  ]);
  const reason = firstLoadingProgressReason(record, [
    'reason',
    'reasonCode',
    'code',
    'blockedReason',
    'retryReason',
    'handoffReason',
  ]);
  const explicitSource = rightPaneBrowserLoadingProgressSourceFromUnknown(record.source);
  const stateFromReason = reason ? rightPaneBrowserLoadingProgressStateForReason(reason) : undefined;
  if (state) return { state, reason, source: explicitSource ?? source };
  if (stateFromReason) return { state: stateFromReason, reason, source: explicitSource ?? source };
  return undefined;
}

function firstLoadingProgressState(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const state = rightPaneBrowserLoadingProgressStateFromUnknown(record[field]);
    if (state) return state;
  }
  return undefined;
}

function firstLoadingProgressReason(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    const reason = rightPaneBrowserLoadingProgressReasonFromUnknown(record[field]);
    if (reason) return reason;
  }
  return undefined;
}

function rightPaneBrowserLoadingProgressStateFromUnknown(value: unknown): RightPaneBrowserLoadingProgressState | undefined {
  const token = normalizedLoadingProgressToken(value);
  return token ? RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATE_ALIASES[token] : undefined;
}

function rightPaneBrowserLoadingProgressReasonFromUnknown(value: unknown): RightPaneBrowserLoadingProgressReason | undefined {
  const token = normalizedLoadingProgressToken(value);
  return token ? RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_ALIASES[token] : undefined;
}

function rightPaneBrowserLoadingProgressSourceFromUnknown(value: unknown): RightPaneBrowserLoadingProgressSource | undefined {
  return typeof value === 'string' && RIGHT_PANE_BROWSER_LOADING_PROGRESS_SOURCES.has(value as RightPaneBrowserLoadingProgressSource)
    ? value as RightPaneBrowserLoadingProgressSource
    : undefined;
}

function rightPaneBrowserLoadingProgressStateForReason(reason: RightPaneBrowserLoadingProgressReason): RightPaneBrowserLoadingProgressState | undefined {
  for (const state of RIGHT_PANE_BROWSER_LOADING_PROGRESS_STATES) {
    if (RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_BY_STATE[state] === reason) return state;
  }
  if (reason === 'host-starting') return 'navigation-start';
  if (reason === 'host-loading') return 'navigation-committed';
  if (reason === 'host-ready') return 'network-quiet';
  if (reason === 'host-error' || reason === 'host-diagnostic') return 'blocked';
  return undefined;
}

function buildRightPaneBrowserLoadingProgressLifecycle(
  input: RightPaneBrowserLoadingProgressInput,
  state: RightPaneBrowserLoadingProgressState,
  reason: RightPaneBrowserLoadingProgressReason | undefined,
  source: RightPaneBrowserLoadingProgressSource,
): RightPaneBrowserLoadingProgressLifecycle {
  const surface = RIGHT_PANE_BROWSER_LOADING_PROGRESS_SURFACE_BY_STATE[state];
  const hostSession = recordValue(input.hostSession);
  const hostState = recordValue(input.hostState);
  return {
    schemaVersion: RIGHT_PANE_BROWSER_LOADING_PROGRESS_LIFECYCLE_SCHEMA,
    state,
    reason: reason ?? RIGHT_PANE_BROWSER_LOADING_PROGRESS_REASON_BY_STATE[state],
    source,
    status: surface.status,
    tabStatus: surface.tabStatus,
    requestedUrl: normalizedOptionalRightPaneBrowserUrl(hostSession?.requestedUrl ?? input.targetUrl),
    currentUrl: normalizedOptionalRightPaneBrowserUrl(hostSession?.url ?? hostState?.url),
    finalUrl: normalizedOptionalRightPaneBrowserUrl(hostSession?.finalUrl ?? hostState?.finalUrl),
    canRetry: state === 'retry' || booleanField(hostSession?.retryable) || booleanField(hostState?.retryable) || undefined,
    blocked: state === 'blocked' ? true : undefined,
    requiresHandoff: state === 'handoff' ? true : undefined,
  };
}

function hostNavigationAppearsCommitted(input: RightPaneBrowserLoadingProgressInput) {
  const hostSession = recordValue(input.hostSession);
  const hostState = recordValue(input.hostState);
  const requestedUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.requestedUrl ?? input.targetUrl);
  const currentUrl = normalizedOptionalRightPaneBrowserUrl(hostSession?.url ?? hostState?.url);
  if (!currentUrl || currentUrl === 'about:blank') return false;
  if (!requestedUrl) return true;
  return rightPaneBrowserUrlsEquivalent(currentUrl, requestedUrl);
}

function normalizedOptionalRightPaneBrowserUrl(value: unknown) {
  const url = stringField(value);
  return url ? normalizeRightPaneBrowserUrl(url) : undefined;
}

function loadingProgressAliasMap<T extends string>(aliases: Record<T, string[]>) {
  const result: Record<string, T> = {};
  for (const [canonical, values] of Object.entries(aliases) as Array<[T, string[]]>) {
    for (const value of [canonical, ...values]) {
      const token = normalizedLoadingProgressToken(value);
      if (token) result[token] = canonical;
    }
  }
  return result;
}

function normalizedLoadingProgressToken(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rightPaneBrowserLoadingProgressIsExplicit(lifecycle: RightPaneBrowserLoadingProgressLifecycle) {
  return lifecycle.source === 'host-lifecycle'
    || lifecycle.source === 'host-progress'
    || lifecycle.source === 'host-navigation'
    || lifecycle.source === 'host-action-timing'
    || lifecycle.state === 'retry'
    || lifecycle.state === 'handoff';
}

function rightPaneBrowserLoadingProgressMessage(lifecycle: RightPaneBrowserLoadingProgressLifecycle) {
  const labelByState: Record<RightPaneBrowserLoadingProgressState, string> = {
    'navigation-start': 'navigation started',
    'navigation-committed': 'navigation committed',
    interactive: 'page is interactive',
    load: 'load event observed',
    'network-quiet': 'network is quiet',
    stalled: 'navigation stalled',
    blocked: 'navigation blocked',
    retry: 'retry in progress',
    handoff: 'handoff required',
  };
  return `BrowserHostSession progress: ${labelByState[lifecycle.state]} (${lifecycle.reason}).`;
}

export function normalizeRightPaneBrowserUrl(value: string) {
  return normalizeBrowserWorkbenchUrl(value);
}

export function rightPaneBrowserProjectionForUrl(url: string, options: RightPaneBrowserProjectionOptions = {}): RightPaneBrowserProjectionState {
  if (url === 'about:blank') {
    return {
      status: 'idle',
      tabStatus: 'new',
      previewUrl: 'about:blank',
      reason: 'No browser URL is open in this right-pane tab yet.',
      canRenderFrame: true,
    };
  }

  const parsed = parseRightPaneBrowserUrl(url);
  if (!parsed) {
    return {
      status: 'error',
      tabStatus: 'failed',
      reason: 'The URL could not be parsed into a browser target.',
      detail: 'Enter a local path, localhost URL, http URL, or https URL.',
      ref: 'browser:error/right-pane/invalid-url',
      canRenderFrame: false,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      status: 'blocked',
      tabStatus: 'failed',
      reason: 'This URL scheme is not embeddable by the browser workbench.',
      detail: 'Use an http or https URL, or open the target through a host-owned BrowserRuntime command.',
      ref: 'browser:embed-policy/right-pane/unsupported-scheme',
      canRenderFrame: false,
      embedPolicy: {
        embeddable: false,
        status: 'blocked',
        reason: 'Unsupported browser workbench URL scheme.',
        ref: 'browser:embed-policy/right-pane/unsupported-scheme',
      },
    };
  }

  if (rightPaneBrowserUrlIsLocal(parsed)) {
    return {
      status: 'ready',
      tabStatus: 'ready',
      previewUrl: url,
      reason: 'Local pages can be embedded directly in the workbench.',
      canRenderFrame: true,
    };
  }

  if (options.hostExternalBrowserAvailable) {
    const hostSurface = options.hostSurface ?? options.hostState?.surface ?? 'browser-host-session';
    const hostUrl = options.hostSession?.url
      ? normalizeRightPaneBrowserUrl(options.hostSession.url)
      : options.hostState?.url
        ? normalizeRightPaneBrowserUrl(options.hostState.url)
        : undefined;
    const requestedUrl = options.hostSession?.requestedUrl ? normalizeRightPaneBrowserUrl(options.hostSession.requestedUrl) : undefined;
    const stateMatchesUrl = rightPaneBrowserUrlsEquivalent(requestedUrl, url) || rightPaneBrowserUrlsEquivalent(hostUrl, url);
    const hostFailed = options.hostError || options.hostSession?.status === 'failed' || options.hostState?.ok === false;
    const hostTargetKnown = Boolean(requestedUrl || hostUrl);
    const hostReadyForTarget = stateMatchesUrl
      || (!hostTargetKnown && (options.hostSession?.status === 'ready' || options.hostState?.ok === true));
    const hostDiagnostic = options.hostSession?.reason ?? options.hostSession?.diagnostics?.join('\n') ?? options.hostState?.reason;
    const loadingProgress = rightPaneBrowserLoadingProgressLifecycle({
      targetUrl: url,
      hostBusy: options.hostBusy,
      hostError: options.hostError,
      hostSession: options.hostSession,
      hostState: options.hostState,
    });
    const lifecycleDrivenStatus = loadingProgress && rightPaneBrowserLoadingProgressIsExplicit(loadingProgress)
      ? loadingProgress.status
      : undefined;
    const status: RightPaneBrowserProjectionStatus = hostFailed
      ? 'error'
      : lifecycleDrivenStatus
        ?? (options.hostBusy || options.hostSession?.status === 'starting' || options.hostSession?.status === 'loading'
        ? 'loading'
        : hostReadyForTarget
        ? 'ready'
        : 'idle');
    const lifecycleReason = loadingProgress ? rightPaneBrowserLoadingProgressMessage(loadingProgress) : undefined;
    return {
      status,
      tabStatus: status === 'error' || status === 'blocked' || status === 'offline' ? 'failed' : status === 'idle' ? 'new' : status === 'loading' ? 'loading' : 'ready',
      externalUrl: url,
      reason: status === 'error'
        ? 'BrowserHostSession could not open this external page.'
        : status === 'idle'
          ? 'External pages open through host-owned BrowserHostSession instead of unsafe iframe/proxy live browsing.'
          : status === 'loading'
            ? (lifecycleReason ?? 'BrowserHostSession is loading this external page.')
            : status === 'blocked'
              ? (lifecycleReason ?? 'BrowserHostSession navigation is blocked.')
            : 'External page is carried by host-owned BrowserHostSession.',
      detail: status === 'error'
        ? (options.hostError ?? hostDiagnostic ?? 'BrowserHostSession open failed.')
        : status === 'loading' || status === 'blocked'
          ? (hostDiagnostic ?? lifecycleReason ?? 'The right pane is waiting for the host-owned BrowserHostSession to commit the active navigation.')
        : 'The right pane keeps BrowserRuntime commands, frame refs, snapshots, and document evidence while the host owns the only interactive live browser surface.',
      ref: status === 'error' ? 'browser:host-surface/right-pane/error' : status === 'blocked' ? 'browser:host-surface/right-pane/blocked' : 'browser:host-surface/right-pane/external',
      canRenderFrame: false,
      hostSurface,
      loadingProgress,
    };
  }

  if (shouldUseBrowserWorkbenchPdfViewerUrl(url)) {
    const previewUrl = buildBrowserWorkbenchPdfViewerUrl(url);
    return {
      status: 'ready',
      tabStatus: 'ready',
      previewUrl,
      externalUrl: url,
      reason: 'External PDFs render through a SciForge-owned document viewer projection.',
      detail: 'The viewer is a document projection, not a live browser substitute; Browser commands keep the original URL.',
      ref: 'browser:embed-policy/right-pane/pdf-viewer',
      canRenderFrame: true,
      embedPolicy: {
        embeddable: true,
        status: 'ready',
        reason: 'External PDF is materialized by the same-origin PDF viewer projection.',
        ref: 'browser:embed-policy/right-pane/pdf-viewer',
      },
    };
  }

  return {
    status: 'blocked',
    tabStatus: 'failed',
    externalUrl: url,
    previewSandbox: browserPreviewSandboxForUrl(url),
    reason: 'External HTTP/HTTPS pages require a host-owned browser surface for live navigation.',
    detail: 'Live external navigation must run in BrowserHostSession. Proxy, iframe, and snapshot projections are evidence or document artifacts only; they are not alternate live browsers or a second interactive truth source.',
    ref: 'browser:host-surface/right-pane/required',
    canRenderFrame: false,
    embedPolicy: {
      embeddable: false,
      status: 'blocked',
      reason: 'External HTML pages are not embedded as iframe/proxy live browsers.',
      ref: 'browser:embed-policy/right-pane/external-html-host-required',
    },
  };
}

export function parseRightPaneBrowserUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function rightPaneBrowserUrlIsLocal(parsed: URL) {
  return browserWorkbenchUrlIsLocal(parsed);
}

export function rightPaneBrowserUrlsEquivalent(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const normalizedLeft = normalizeRightPaneBrowserUrl(left);
  const normalizedRight = normalizeRightPaneBrowserUrl(right);
  if (normalizedLeft === normalizedRight) return true;
  try {
    const leftUrl = new URL(normalizedLeft);
    const rightUrl = new URL(normalizedRight);
    return leftUrl.protocol === rightUrl.protocol
      && leftUrl.hostname === rightUrl.hostname
      && leftUrl.port === rightUrl.port
      && normalizedBrowserPath(leftUrl) === normalizedBrowserPath(rightUrl)
      && leftUrl.search === rightUrl.search
      && leftUrl.hash === rightUrl.hash;
  } catch {
    return false;
  }
}

function normalizedBrowserPath(url: URL) {
  return url.pathname === '' ? '/' : url.pathname;
}
