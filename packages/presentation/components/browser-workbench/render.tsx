import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import type {
  BrowserRuntimeProjection,
  BrowserRuntimeSession,
  BrowserRuntimeSnapshot,
  BrowserRuntimeTab,
  BrowserRuntimeTraceRef,
  BrowserHostSessionState,
} from '@sciforge-ui/runtime-contract';

export interface BrowserWorkbenchCommand {
  id?: BrowserWorkbenchCommandId;
  label: string;
  command: string;
  risk?: 'allowed' | 'needs-approval';
  disabled?: boolean;
  kind?: 'terminal-equivalent';
}

export type BrowserWorkbenchCommandId =
  | 'open'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'snapshot'
  | 'state'
  | 'takeover'
  | 'copy-url'
  | 'open-external';

export type BrowserWorkbenchStateStatus = 'idle' | 'loading' | 'ready' | 'blocked' | 'error' | 'offline';

export interface BrowserWorkbenchState {
  status: BrowserWorkbenchStateStatus;
  url?: string;
  title?: string;
  reason?: string;
  detail?: string;
  ref?: string;
  checkedAt?: string;
  canRenderFrame?: boolean;
  hostSurface?: string;
  loadingProgress?: BrowserWorkbenchLoadingProgress;
}

export interface BrowserWorkbenchLoadingProgress {
  state?: string;
  reason?: string;
  source?: string;
  status?: string;
  tabStatus?: string;
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface BrowserWorkbenchNativeSurfaceBridgeState {
  routeStatus?: 'unknown' | 'reachable' | 'unreachable';
  capability?: 'ready' | 'missing' | 'unknown';
  rightPaneBridge?: boolean;
  status?: 'ready' | 'native-bridge-unavailable' | 'route-unreachable' | 'unknown';
  healthPath?: string;
  attachPath?: string;
  statePath?: string;
  diagnosticRef?: string;
}

export interface BrowserWorkbenchEmbedPolicy {
  embeddable?: boolean;
  status?: BrowserWorkbenchStateStatus | string;
  reason?: string;
  ref?: string;
  checkedAt?: string;
}

export interface BrowserWorkbenchCapabilities {
  canGoBack?: boolean;
  canGoForward?: boolean;
  canReload?: boolean;
  canStop?: boolean;
  canSnapshot?: boolean;
  canState?: boolean;
  canTakeover?: boolean;
  canCopyUrl?: boolean;
  canOpenExternal?: boolean;
}

export interface BrowserWorkbenchWriterDiagnostic {
  status?: string;
  configuredBaseUrl?: string;
  configuredDisplayUrl?: string;
  effectiveBaseUrl?: string;
  effectiveDisplayUrl?: string;
  recommendedBaseUrl?: string;
  recommendedDisplayUrl?: string;
  diagnosticRef?: string;
  message?: string;
  health?: {
    ok?: boolean;
    service?: string;
    capabilities?: unknown;
  };
}

export type BrowserWorkbenchMouseButton = 'left' | 'right' | 'middle';

export interface BrowserWorkbenchHostAction {
  action: 'click' | 'double-click' | 'mouse-down' | 'mouse-move' | 'mouse-up' | 'drag' | 'type' | 'press' | 'scroll' | 'cursor';
  x?: number;
  y?: number;
  button?: BrowserWorkbenchMouseButton;
  path?: Array<{ x: number; y: number }>;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
}

const BROWSER_WORKBENCH_DIAGNOSTIC_TEXT_MAX = 240;
const BROWSER_WORKBENCH_HEALTH_CAPABILITIES = ['browser-host-session', 'browser-host-native-surface', 'browser-host-search'] as const;

export interface BrowserWorkbenchPayload {
  projection?: BrowserRuntimeProjection;
  session?: BrowserRuntimeSession;
  activeTab?: BrowserRuntimeTab;
  hostSession?: BrowserHostSessionState;
  snapshot?: BrowserRuntimeSnapshot;
  traceRefs?: BrowserRuntimeTraceRef[];
  commands?: BrowserWorkbenchCommand[];
  state?: BrowserWorkbenchStateStatus | BrowserWorkbenchState;
  browserState?: BrowserWorkbenchStateStatus | BrowserWorkbenchState;
  embedPolicy?: BrowserWorkbenchEmbedPolicy;
  capabilities?: BrowserWorkbenchCapabilities;
  blockedReason?: string;
  error?: string | { message?: string; ref?: string };
  errorRef?: string;
  offlineReason?: string;
  offlineRef?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  externalUrl?: string;
  previewUrl?: string;
  frameUrl?: string;
  frameTransport?: string;
  previewSandbox?: string;
  title?: string;
  status?: string;
  notes?: string[];
  writerDiagnostic?: BrowserWorkbenchWriterDiagnostic;
  addressValue?: string;
  addressPlaceholder?: string;
  onAddressChange?: (value: string) => void;
  onAddressSubmit?: (value: string) => void;
  onCommandRequest?: (command: BrowserWorkbenchCommand) => void;
  onHostActionRequest?: (action: BrowserWorkbenchHostAction) => void;
  onCopyRefRequest?: (ref: BrowserRuntimeTraceRef) => void;
  onFocusTabRequest?: (tab: BrowserRuntimeTab) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function normalizeBrowserWorkbenchUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^about:blank$/i.test(trimmed)) return 'about:blank';
  if (/about:blank$/i.test(trimmed)) return normalizeBrowserWorkbenchUrl(trimmed.slice(0, -'about:blank'.length));
  if (trimmed.startsWith('/')) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isInlinePayloadRef(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('data:')
    || normalized.startsWith('javascript:')
    || normalized.includes(';base64,')
    || normalized.startsWith('{')
    || normalized.startsWith('[');
}

function isLocalHttpUrl(value: string) {
  try {
    const parsed = new URL(normalizeBrowserWorkbenchUrl(value));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
  } catch {
    return false;
  }
}

function safeLocalHttpOrigin(value: unknown) {
  const raw = asString(value);
  if (!raw || !isLocalHttpUrl(raw)) return undefined;
  try {
    return new URL(normalizeBrowserWorkbenchUrl(raw)).origin;
  } catch {
    return undefined;
  }
}

function sanitizeBrowserWorkbenchDiagnosticText(value: unknown) {
  const raw = asString(value);
  if (!raw) return undefined;
  if (isInlinePayloadRef(raw)) return undefined;
  if (/(?:<!doctype|<html\b|<body\b|<script\b|data:image\/|;base64,)/i.test(raw)) return 'inline-payload-redacted';
  const scrubbed = raw
    .replace(/data:[^\s"'<>]+/gi, '[inline-payload-redacted]')
    .replace(/\b(?:api[-_]?key|token|secret|password|authorization|cookie)=([^&\s]+)/gi, (match) => `${match.split('=')[0]}=[redacted]`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[secret-redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => safeLocalHttpOrigin(match) ?? '[url-redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed ? scrubbed.slice(0, BROWSER_WORKBENCH_DIAGNOSTIC_TEXT_MAX) : undefined;
}

function asRefString(value: unknown): string | undefined {
  const ref = asString(value);
  return ref && !isInlinePayloadRef(ref) ? ref : undefined;
}

function safePreviewStateUrl(value: string | undefined) {
  if (!value) return undefined;
  const normalized = normalizeBrowserWorkbenchUrl(value);
  if (/^https?:\/\//i.test(normalized) || /^about:blank$/i.test(normalized)) return normalized;
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized;
  return undefined;
}

function safeExternalHref(value: string | undefined) {
  if (!value) return undefined;
  const normalized = normalizeBrowserWorkbenchUrl(value);
  return /^https?:\/\//i.test(normalized) ? normalized : undefined;
}

function asBrowserWorkbenchPayload(value: unknown): BrowserWorkbenchPayload {
  return isRecord(value) ? value as BrowserWorkbenchPayload : {};
}

function payloadFromProps(props: UIComponentRendererProps): BrowserWorkbenchPayload {
  const artifactRecord = isRecord(props.artifact?.data) ? props.artifact.data : {};
  const artifactData = asBrowserWorkbenchPayload(artifactRecord);
  const slotProps = asBrowserWorkbenchPayload(props.slot.props);
  const projection = artifactData.projection
    ?? (artifactRecord.schemaVersion === 'sciforge.browser-runtime.projection.v1' ? artifactRecord as unknown as BrowserRuntimeProjection : undefined)
    ?? slotProps.projection;
  return {
    ...artifactData,
    ...slotProps,
    projection,
  };
}

function sessionFromPayload(payload: BrowserWorkbenchPayload): BrowserRuntimeSession | undefined {
  return payload.projection?.session ?? payload.session;
}

function activeTabFromPayload(payload: BrowserWorkbenchPayload, session?: BrowserRuntimeSession): BrowserRuntimeTab | undefined {
  return payload.projection?.activeTab
    ?? payload.activeTab
    ?? session?.tabs.find((tab) => tab.id === session.activeTabId)
    ?? session?.tabs[0];
}

function snapshotFromPayload(payload: BrowserWorkbenchPayload): BrowserRuntimeSnapshot | undefined {
  return payload.projection?.snapshot ?? payload.snapshot;
}

function hostSessionFromPayload(payload: BrowserWorkbenchPayload): BrowserHostSessionState | undefined {
  return payload.projection?.hostSession ?? payload.hostSession;
}

function traceRefsFromPayload(payload: BrowserWorkbenchPayload): BrowserRuntimeTraceRef[] {
  return [
    ...(payload.projection?.traceRefs ?? []),
    ...(payload.traceRefs ?? []),
  ].filter((ref) => Boolean(asRefString(ref.ref)))
    .filter((ref, index, refs) => refs.findIndex((candidate) => candidate.kind === ref.kind && candidate.ref === ref.ref) === index);
}

function commandUrl(payload: BrowserWorkbenchPayload, tab?: BrowserRuntimeTab, snapshot?: BrowserRuntimeSnapshot) {
  return normalizeBrowserWorkbenchUrl(asString(tab?.url) ?? asString(snapshot?.url) ?? asString(payload.externalUrl) ?? asString(payload.addressValue) ?? asString(payload.previewUrl) ?? 'about:blank');
}

export interface BrowserWorkbenchDefaultCommandOptions extends BrowserWorkbenchCapabilities {
  status?: BrowserWorkbenchStateStatus;
}

export function browserWorkbenchDefaultCommands(url: string, options: BrowserWorkbenchDefaultCommandOptions = {}): BrowserWorkbenchCommand[] {
  const normalizedUrl = normalizeBrowserWorkbenchUrl(url);
  const quotedUrl = JSON.stringify(normalizedUrl);
  const loading = options.status === 'loading';
  const reloadOrStop: BrowserWorkbenchCommand = loading
    ? {
        id: 'stop',
        label: 'Stop',
        command: `/browser stop --url ${quotedUrl}`,
        disabled: options.canStop === false,
        risk: 'allowed',
        kind: 'terminal-equivalent',
      }
    : {
        id: 'reload',
        label: 'Reload',
        command: `/browser reload --url ${quotedUrl}`,
        disabled: options.canReload === false,
        risk: 'allowed',
        kind: 'terminal-equivalent',
      };
  return [
    { id: 'open', label: 'Open', command: `/browser open ${quotedUrl} --surface workbench`, risk: 'allowed', kind: 'terminal-equivalent' },
    { id: 'back', label: 'Back', command: `/browser back --url ${quotedUrl}`, disabled: options.canGoBack === false, risk: 'allowed', kind: 'terminal-equivalent' },
    { id: 'forward', label: 'Forward', command: `/browser forward --url ${quotedUrl}`, disabled: options.canGoForward === false, risk: 'allowed', kind: 'terminal-equivalent' },
    reloadOrStop,
    { id: 'snapshot', label: 'Snapshot', command: `/browser snapshot --url ${quotedUrl} --screenshot --dom --logs`, disabled: options.canSnapshot === false, risk: 'allowed', kind: 'terminal-equivalent' },
    { id: 'state', label: 'State', command: `/browser state --url ${quotedUrl} --dom --ax --console --network`, disabled: options.canState === false, risk: 'allowed', kind: 'terminal-equivalent' },
    { id: 'takeover', label: 'Takeover', command: `/browser takeover --url ${quotedUrl} --approval required`, disabled: options.canTakeover === false, risk: 'needs-approval', kind: 'terminal-equivalent' },
    { id: 'copy-url', label: 'Copy URL', command: `/browser copy-url ${quotedUrl} --surface workbench`, disabled: options.canCopyUrl === false || normalizedUrl === 'about:blank', risk: 'allowed', kind: 'terminal-equivalent' },
    { id: 'open-external', label: 'Open External', command: `/browser open-external ${quotedUrl} --approval required`, disabled: options.canOpenExternal === false || normalizedUrl === 'about:blank', risk: 'needs-approval', kind: 'terminal-equivalent' },
  ];
}

function browserWorkbenchCommands(payload: BrowserWorkbenchPayload, state: BrowserWorkbenchState, tab?: BrowserRuntimeTab, snapshot?: BrowserRuntimeSnapshot) {
  if (payload.commands?.length) return payload.commands;
  return browserWorkbenchDefaultCommands(commandUrl(payload, tab, snapshot), {
    ...payload.capabilities,
    canGoBack: payload.canGoBack ?? payload.capabilities?.canGoBack,
    canGoForward: payload.canGoForward ?? payload.capabilities?.canGoForward,
    status: state.status,
  });
}

function normalizeStateStatus(value: unknown): BrowserWorkbenchStateStatus | undefined {
  const status = asString(value)?.toLowerCase();
  if (!status) return undefined;
  if (status === 'idle' || status === 'loading' || status === 'ready' || status === 'blocked' || status === 'error' || status === 'offline') return status;
  if (status === 'new' || status === 'navigating' || status === 'running') return 'loading';
  if (status === 'failed' || status === 'failure' || status === 'fail') return 'error';
  if (status === 'denied' || status === 'csp-blocked' || status === 'x-frame-options') return 'blocked';
  if (status === 'network-failure' || status === 'network-offline' || status === 'unreachable') return 'offline';
  if (status === 'closed' || status === 'empty') return 'idle';
  return undefined;
}

function normalizeStateInput(value: BrowserWorkbenchPayload['state'] | BrowserWorkbenchPayload['browserState']): Partial<BrowserWorkbenchState> | undefined {
  if (typeof value === 'string') return { status: normalizeStateStatus(value) ?? 'idle' };
  if (!isRecord(value)) return undefined;
  return {
    status: normalizeStateStatus(value.status),
    url: asString(value.url),
    title: asString(value.title),
    reason: asString(value.reason),
    detail: asString(value.detail),
    ref: asRefString(value.ref),
    checkedAt: asString(value.checkedAt),
    canRenderFrame: asBoolean(value.canRenderFrame),
    hostSurface: asString(value.hostSurface),
    loadingProgress: loadingProgressFromStateInput(value.loadingProgress),
  };
}

function loadingProgressFromStateInput(value: unknown): BrowserWorkbenchLoadingProgress | undefined {
  if (!isRecord(value)) return undefined;
  const progress = {
    state: asString(value.state),
    reason: asString(value.reason),
    source: asString(value.source),
    status: asString(value.status),
    tabStatus: asString(value.tabStatus),
    canRetry: asBoolean(value.canRetry),
    blocked: asBoolean(value.blocked),
    requiresHandoff: asBoolean(value.requiresHandoff),
  };
  return progress.state || progress.reason || progress.source || progress.status || progress.tabStatus || progress.canRetry || progress.blocked || progress.requiresHandoff
    ? progress
    : undefined;
}

function nativeSurfaceBridgeFromHostSession(hostSession: BrowserHostSessionState | undefined): BrowserWorkbenchNativeSurfaceBridgeState | undefined {
  const bridge = isRecord(hostSession)
    ? isRecord((hostSession as { nativeSurfaceBridge?: unknown }).nativeSurfaceBridge)
      ? (hostSession as { nativeSurfaceBridge?: Record<string, unknown> }).nativeSurfaceBridge
      : undefined
    : undefined;
  if (!bridge) return undefined;
  const routeStatus = bridge.routeStatus === 'reachable' || bridge.routeStatus === 'unreachable' || bridge.routeStatus === 'unknown'
    ? bridge.routeStatus
    : undefined;
  const capability = bridge.capability === 'ready' || bridge.capability === 'missing' || bridge.capability === 'unknown'
    ? bridge.capability
    : undefined;
  const rightPaneBridge = asBoolean(bridge.rightPaneBridge);
  const status = bridge.status === 'ready' || bridge.status === 'native-bridge-unavailable' || bridge.status === 'route-unreachable' || bridge.status === 'unknown'
    ? bridge.status
    : routeStatus === 'reachable' && rightPaneBridge === false
      ? 'native-bridge-unavailable'
      : routeStatus === 'unreachable'
        ? 'route-unreachable'
        : undefined;
  if (!routeStatus && !capability && rightPaneBridge === undefined && !status) return undefined;
  return {
    routeStatus,
    capability,
    rightPaneBridge,
    status,
    healthPath: asRefString(bridge.healthPath),
    attachPath: asRefString(bridge.attachPath),
    statePath: asRefString(bridge.statePath),
    diagnosticRef: asRefString(bridge.diagnosticRef),
  };
}

function nativeSurfaceBridgeDiagnosticSummary(bridge: BrowserWorkbenchNativeSurfaceBridgeState | undefined) {
  if (!bridge) return undefined;
  const status = bridge.status ?? 'unknown';
  const parts = [
    `route=${bridge.routeStatus ?? 'unknown'}`,
    `capability=${bridge.capability ?? 'unknown'}`,
    `rightPaneBridge=${bridge.rightPaneBridge === true ? 'true' : bridge.rightPaneBridge === false ? 'false' : 'unknown'}`,
  ];
  return `${status}:${parts.join(',')}`;
}

function errorMessage(value: BrowserWorkbenchPayload['error']) {
  if (typeof value === 'string') return asString(value);
  return isRecord(value) ? asString(value.message) : undefined;
}

function errorRef(value: BrowserWorkbenchPayload['error']) {
  return isRecord(value) ? asRefString(value.ref) : undefined;
}

function embedPolicyFromPayload(payload: BrowserWorkbenchPayload): BrowserWorkbenchEmbedPolicy | undefined {
  if (!isRecord(payload.embedPolicy)) return undefined;
  return {
    embeddable: asBoolean(payload.embedPolicy.embeddable),
    status: normalizeStateStatus(payload.embedPolicy.status) ?? asString(payload.embedPolicy.status),
    reason: asString(payload.embedPolicy.reason),
    ref: asRefString(payload.embedPolicy.ref),
    checkedAt: asString(payload.embedPolicy.checkedAt),
  };
}

export function browserWorkbenchStateFromPayload(
  payload: BrowserWorkbenchPayload,
  session?: BrowserRuntimeSession,
  tab?: BrowserRuntimeTab,
  snapshot?: BrowserRuntimeSnapshot,
  normalizedPreviewUrl?: string,
): BrowserWorkbenchState {
  const explicit = normalizeStateInput(payload.browserState ?? payload.state);
  const embedPolicy = embedPolicyFromPayload(payload);
  const explicitStatus = explicit?.status;
  const statusFromPayload = normalizeStateStatus(payload.status);
  const statusFromEmbedPolicy = normalizeStateStatus(embedPolicy?.status);
  const statusFromTab = normalizeStateStatus(tab?.status);
  const observedStatuses = [statusFromPayload, statusFromEmbedPolicy, statusFromTab];
  const exceptionalStatus = observedStatuses.find((status) => status === 'offline' || status === 'error' || status === 'blocked');
  const progressStatus = observedStatuses.find((status) => status === 'loading');
  const steadyStatus = observedStatuses.find((status) => status === 'ready' || status === 'idle');
  const hasPresentation = Boolean(session || tab || snapshot || normalizedPreviewUrl || traceRefsFromPayload(payload).length);
  const hasError = Boolean(payload.error || payload.errorRef || errorRef(payload.error));
  const hasOffline = Boolean(payload.offlineReason || payload.offlineRef);
  const hasBlocked = Boolean(payload.blockedReason || embedPolicy?.embeddable === false || embedPolicy?.reason);
  const status = explicitStatus
    ?? exceptionalStatus
    ?? (hasOffline ? 'offline' : undefined)
    ?? (hasError ? 'error' : undefined)
    ?? (hasBlocked ? 'blocked' : undefined)
    ?? progressStatus
    ?? steadyStatus
    ?? (hasPresentation ? 'ready' : 'idle');

  const defaultReason = status === 'idle'
    ? 'No browser runtime projection is attached.'
    : status === 'loading'
      ? 'The browser runtime is loading the active tab.'
      : status === 'blocked'
        ? 'The host reported that this page cannot be embedded in the workbench.'
        : status === 'error'
          ? 'The browser runtime reported an error for this tab.'
          : status === 'offline'
            ? 'The browser runtime reported a network or offline failure.'
            : undefined;

  return {
    status,
    url: explicit?.url ?? asString(tab?.url) ?? asString(snapshot?.url) ?? normalizedPreviewUrl,
    title: explicit?.title ?? asString(tab?.title) ?? asString(snapshot?.title),
    reason: explicit?.reason ?? payload.offlineReason ?? errorMessage(payload.error) ?? payload.blockedReason ?? embedPolicy?.reason ?? defaultReason,
    detail: explicit?.detail,
    ref: explicit?.ref ?? payload.offlineRef ?? asRefString(payload.errorRef) ?? errorRef(payload.error) ?? embedPolicy?.ref,
    checkedAt: explicit?.checkedAt ?? embedPolicy?.checkedAt,
    canRenderFrame: explicit?.canRenderFrame ?? (embedPolicy?.embeddable === false ? false : undefined),
    hostSurface: explicit?.hostSurface,
    loadingProgress: explicit?.loadingProgress,
  };
}

function renderCommandButton(command: BrowserWorkbenchCommand, onCommandRequest?: (command: BrowserWorkbenchCommand) => void) {
  return (
    <button
      key={`${command.id ?? command.label}:${command.command}`}
      type="button"
      data-event="browser-command-request"
      data-browser-command-id={command.id}
      data-browser-command={command.command}
      data-command-text={command.command}
      data-browser-command-kind={command.kind ?? 'terminal-equivalent'}
      data-browser-risk={command.risk ?? 'allowed'}
      data-browser-command-short-label={browserWorkbenchCommandShortLabel(command)}
      disabled={command.disabled}
      title={command.label}
      onClick={() => {
        if (!command.disabled) onCommandRequest?.(command);
      }}
    >
      {command.label}
    </button>
  );
}

function browserWorkbenchCommandShortLabel(command: BrowserWorkbenchCommand) {
  if (command.id === 'open') return 'Go';
  if (command.id === 'back') return '<';
  if (command.id === 'forward') return '>';
  if (command.id === 'reload') return 'R';
  if (command.id === 'stop') return 'X';
  if (command.id === 'snapshot') return 'Shot';
  if (command.id === 'state') return 'State';
  if (command.id === 'takeover') return 'Take';
  if (command.id === 'copy-url') return 'Copy';
  if (command.id === 'open-external') return 'Ext';
  return command.label.slice(0, 6);
}

function renderRef(ref: BrowserRuntimeTraceRef, onCopyRefRequest?: (ref: BrowserRuntimeTraceRef) => void) {
  return (
    <li key={`${ref.kind}:${ref.ref}`}>
      <button
        type="button"
        data-event="copy-ref-request"
        data-browser-ref={ref.ref}
        data-browser-ref-kind={ref.kind}
        onClick={() => onCopyRefRequest?.(ref)}
      >
        {ref.kind}
      </button>
      <code>{ref.ref}</code>
    </li>
  );
}

function refsFromSnapshot(snapshot: BrowserRuntimeSnapshot | undefined): BrowserRuntimeTraceRef[] {
  return [
    { kind: 'search-result', ref: asRefString(snapshot?.searchResultRef) ?? '' },
    { kind: 'screenshot', ref: asRefString(snapshot?.screenshotRef) ?? '' },
    { kind: 'dom-snapshot', ref: asRefString(snapshot?.domSnapshotRef) ?? '' },
    { kind: 'ax-snapshot', ref: asRefString(snapshot?.axSnapshotRef) ?? '' },
    { kind: 'console-log', ref: asRefString(snapshot?.consoleLogRef) ?? '' },
    { kind: 'network-log', ref: asRefString(snapshot?.networkLogRef) ?? '' },
  ].filter((ref): ref is BrowserRuntimeTraceRef => Boolean(ref.ref));
}

function refsFromHostSession(hostSession: BrowserHostSessionState | undefined): BrowserRuntimeTraceRef[] {
  return [
    { kind: 'browser-frame', ref: asRefString(hostSession?.frameRef) ?? '' },
    { kind: 'search-result', ref: asRefString(hostSession?.searchResultRef) ?? '' },
    { kind: 'screenshot', ref: asRefString(hostSession?.screenshotRef) ?? '' },
    { kind: 'dom-snapshot', ref: asRefString(hostSession?.domSnapshotRef) ?? '' },
    { kind: 'ax-snapshot', ref: asRefString(hostSession?.axSnapshotRef) ?? '' },
    { kind: 'console-log', ref: asRefString(hostSession?.consoleLogRef) ?? '' },
    { kind: 'network-log', ref: asRefString(hostSession?.networkLogRef) ?? '' },
  ].filter((ref): ref is BrowserRuntimeTraceRef => Boolean(ref.ref));
}

function displayedTraceRefs(snapshot: BrowserRuntimeSnapshot | undefined, traceRefs: BrowserRuntimeTraceRef[], hostSession?: BrowserHostSessionState) {
  return [
    ...refsFromHostSession(hostSession),
    ...refsFromSnapshot(snapshot),
    ...traceRefs,
  ].filter((ref, index, refs) => refs.findIndex((candidate) => candidate.kind === ref.kind && candidate.ref === ref.ref) === index);
}

function renderRefs(refs: BrowserRuntimeTraceRef[], onCopyRefRequest?: (ref: BrowserRuntimeTraceRef) => void) {
  if (!refs.length) return null;
  return (
    <section className="browser-workbench-viewer-refs" aria-label="Browser refs">
      <ul>
        {refs.map((ref) => renderRef(ref, onCopyRefRequest))}
      </ul>
    </section>
  );
}

function renderStateValue(label: string, value: string | undefined) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function renderBrowserWorkbenchStateReason(state: BrowserWorkbenchState) {
  if (!state.reason) return null;
  if (state.status !== 'blocked' && state.status !== 'error' && state.status !== 'offline') return <p>{state.reason}</p>;
  return <p>{sanitizeBrowserWorkbenchDiagnosticText(state.reason) ?? 'Diagnostic payload redacted.'}</p>;
}

function browserWorkbenchDiagnosticsDetail(values: string[] | undefined) {
  const diagnostics = (values ?? [])
    .map((diagnostic) => sanitizeBrowserWorkbenchDiagnosticText(diagnostic))
    .filter((diagnostic): diagnostic is string => Boolean(diagnostic));
  return diagnostics.length ? diagnostics.join('\n') : undefined;
}

interface BrowserWorkbenchBoundedDiagnostics {
  writerUrl?: string;
  healthCapability?: string;
  writerDiagnosticStatus?: string;
  writerDiagnosticRef?: string;
  nativeAdapterUrl?: string;
  nativeSurfaceBridge?: BrowserWorkbenchNativeSurfaceBridgeState;
  nativeSurfaceBridgeSummary?: string;
  transport?: string;
  timing?: BrowserHostSessionState['lastActionTiming'];
  summary: NonNullable<BrowserHostSessionState['actionTimingSummary']>;
  lastBlockedReason?: string;
  diagnostics: string[];
}

function browserWorkbenchWriterUrl(payload: BrowserWorkbenchPayload, hostSession: BrowserHostSessionState | undefined) {
  return safeLocalHttpOrigin(hostSession?.workspaceWriterBaseUrl)
    ?? safeLocalHttpOrigin(payload.writerDiagnostic?.effectiveBaseUrl)
    ?? safeLocalHttpOrigin(payload.writerDiagnostic?.effectiveDisplayUrl)
    ?? safeLocalHttpOrigin(payload.writerDiagnostic?.configuredBaseUrl)
    ?? safeLocalHttpOrigin(payload.writerDiagnostic?.configuredDisplayUrl)
    ?? safeLocalHttpOrigin(payload.writerDiagnostic?.recommendedBaseUrl)
    ?? safeLocalHttpOrigin(payload.writerDiagnostic?.recommendedDisplayUrl);
}

function browserWorkbenchHealthCapability(payload: BrowserWorkbenchPayload) {
  const capabilities = payload.writerDiagnostic?.health?.capabilities;
  if (!Array.isArray(capabilities)) return undefined;
  const capabilitySet = new Set(capabilities.filter((capability): capability is string => typeof capability === 'string'));
  return BROWSER_WORKBENCH_HEALTH_CAPABILITIES
    .map((capability) => `${capability}:${capabilitySet.has(capability) ? 'ready' : 'missing'}`)
    .join(',');
}

function browserWorkbenchLastBlockedReason(
  state: BrowserWorkbenchState,
  hostSession: BrowserHostSessionState | undefined,
  payload: BrowserWorkbenchPayload,
) {
  return sanitizeBrowserWorkbenchDiagnosticText(hostSession?.lastActionTiming?.blockedReason)
    ?? sanitizeBrowserWorkbenchDiagnosticText(hostSession?.diagnostics?.[Math.max(0, (hostSession.diagnostics?.length ?? 1) - 1)])
    ?? sanitizeBrowserWorkbenchDiagnosticText(payload.writerDiagnostic?.message)
    ?? (state.status === 'blocked' || state.status === 'error' || state.status === 'offline'
      ? sanitizeBrowserWorkbenchDiagnosticText(state.reason)
      : undefined);
}

function browserWorkbenchBoundedDiagnostics(
  state: BrowserWorkbenchState,
  payload: BrowserWorkbenchPayload,
  hostSession: BrowserHostSessionState | undefined,
): BrowserWorkbenchBoundedDiagnostics | undefined {
  const timing = hostSession?.lastActionTiming;
  const summary = hostSession?.actionTimingSummary ?? [];
  const nativeSurfaceBridge = nativeSurfaceBridgeFromHostSession(hostSession);
  const nativeSurfaceBridgeSummary = nativeSurfaceBridgeDiagnosticSummary(nativeSurfaceBridge);
  const diagnostics = (hostSession?.diagnostics ?? [])
    .slice(-3)
    .map((diagnostic) => sanitizeBrowserWorkbenchDiagnosticText(diagnostic))
    .filter((diagnostic): diagnostic is string => Boolean(diagnostic));
  const bounded = {
    writerUrl: browserWorkbenchWriterUrl(payload, hostSession),
    healthCapability: browserWorkbenchHealthCapability(payload),
    writerDiagnosticStatus: sanitizeBrowserWorkbenchDiagnosticText(payload.writerDiagnostic?.status),
    writerDiagnosticRef: asRefString(payload.writerDiagnostic?.diagnosticRef),
    nativeAdapterUrl: safeLocalHttpOrigin(hostSession?.nativeAdapterUrl),
    nativeSurfaceBridge,
    nativeSurfaceBridgeSummary,
    transport: hostSession?.liveSurfaceTransport ?? timing?.liveSurfaceTransport,
    timing,
    summary,
    lastBlockedReason: browserWorkbenchLastBlockedReason(state, hostSession, payload),
    diagnostics,
  };
  if (
    bounded.writerUrl
    || bounded.healthCapability
    || bounded.writerDiagnosticStatus
    || bounded.writerDiagnosticRef
    || bounded.nativeAdapterUrl
    || bounded.nativeSurfaceBridgeSummary
    || bounded.transport
    || bounded.timing
    || bounded.summary.length
    || bounded.lastBlockedReason
    || bounded.diagnostics.length
  ) return bounded;
  return undefined;
}

function renderBrowserWorkbenchDiagnostics(
  state: BrowserWorkbenchState,
  payload: BrowserWorkbenchPayload,
  hostSession: BrowserHostSessionState | undefined,
) {
  const diagnostics = browserWorkbenchBoundedDiagnostics(state, payload, hostSession);
  if (!diagnostics) return null;
  const timing = diagnostics.timing;
  const lastActionTiming = timing ? `${timing.action}:${timing.totalMs}ms:${timing.status}` : undefined;
  return (
    <section
      className="browser-workbench-viewer-diagnostics"
      aria-label="Browser diagnostics"
      data-browser-writer-url={diagnostics.writerUrl}
      data-browser-health-capability={diagnostics.healthCapability}
      data-browser-native-adapter-url={diagnostics.nativeAdapterUrl}
      data-browser-diagnostic-live-surface-transport={diagnostics.transport}
      data-browser-last-action={timing?.action}
      data-browser-last-action-total-ms={timing?.totalMs}
      data-browser-last-action-timing={lastActionTiming}
      data-browser-last-action-status={timing?.status}
      data-browser-last-blocked-reason={diagnostics.lastBlockedReason}
      data-browser-writer-diagnostic={diagnostics.writerDiagnosticStatus}
      data-browser-writer-diagnostic-ref={diagnostics.writerDiagnosticRef}
      data-browser-native-surface-route-status={diagnostics.nativeSurfaceBridge?.routeStatus}
      data-browser-native-surface-capability={diagnostics.nativeSurfaceBridge?.capability}
      data-browser-right-pane-bridge={diagnostics.nativeSurfaceBridge?.rightPaneBridge === true ? 'true' : diagnostics.nativeSurfaceBridge?.rightPaneBridge === false ? 'false' : undefined}
      data-browser-native-surface-bridge-status={diagnostics.nativeSurfaceBridge?.status}
      data-browser-native-surface-health-path={diagnostics.nativeSurfaceBridge?.healthPath}
      data-browser-native-surface-attach-path={diagnostics.nativeSurfaceBridge?.attachPath}
      data-browser-native-surface-state-path={diagnostics.nativeSurfaceBridge?.statePath}
      data-browser-native-surface-diagnostic-ref={diagnostics.nativeSurfaceBridge?.diagnosticRef}
    >
      <dl>
        {renderStateValue('writerUrl', diagnostics.writerUrl)}
        {renderStateValue('healthCapability', diagnostics.healthCapability)}
        {renderStateValue('writerDiagnostic', diagnostics.writerDiagnosticStatus)}
        {renderStateValue('writerDiagnosticRef', diagnostics.writerDiagnosticRef)}
        {renderStateValue('nativeSurfaceBridge', diagnostics.nativeSurfaceBridgeSummary)}
        {renderStateValue('nativeSurfaceHealthPath', diagnostics.nativeSurfaceBridge?.healthPath)}
        {renderStateValue('nativeSurfaceAttachPath', diagnostics.nativeSurfaceBridge?.attachPath)}
        {renderStateValue('nativeSurfaceStatePath', diagnostics.nativeSurfaceBridge?.statePath)}
        {renderStateValue('transport', diagnostics.transport)}
        {renderStateValue('nativeAdapterUrl', diagnostics.nativeAdapterUrl)}
        {timing ? renderStateValue('lastAction', timing.action) : null}
        {timing ? renderStateValue('lastActionTotalMs', String(timing.totalMs)) : null}
        {timing?.adapterToHostMs !== undefined ? renderStateValue('adapterToHostMs', String(timing.adapterToHostMs)) : null}
        {timing ? renderStateValue('hostActionMs', String(timing.hostActionMs)) : null}
        {timing?.evidenceMs !== undefined ? renderStateValue('evidenceMs', String(timing.evidenceMs)) : null}
        {timing?.paintAckSource ? renderStateValue('paintAckSource', timing.paintAckSource) : null}
        {renderStateValue('blockedReason', diagnostics.lastBlockedReason)}
        {diagnostics.summary.length ? renderStateValue('latencySummary', diagnostics.summary.map((row) => `${row.action}:p50=${row.p50Ms}ms,p95=${row.p95Ms}ms`).join(' | ')) : null}
        {diagnostics.diagnostics.length ? renderStateValue('diagnostics', diagnostics.diagnostics.join(' | ')) : null}
      </dl>
    </section>
  );
}

function renderBrowserState(
  state: BrowserWorkbenchState,
  refs: BrowserRuntimeTraceRef[],
  payload: BrowserWorkbenchPayload,
  commands: BrowserWorkbenchCommand[],
) {
  const externalUrl = safeExternalHref(payload.externalUrl ?? state.url);
  const openCommand = commands.find((command) => command.id === 'open');
  const openExternalCommand = externalUrl
    ? commands.find((command) => command.id === 'open-external')
      ?? browserWorkbenchDefaultCommands(externalUrl).find((command) => command.id === 'open-external')
    : undefined;
  const canRetryNativeSurface = state.hostSurface === 'browser-host-session' && Boolean(
    state.loadingProgress?.canRetry
    || state.status === 'blocked'
    || state.status === 'error'
    || state.loadingProgress?.state === 'retry',
  );
  const requiresHandoff = Boolean(state.loadingProgress?.requiresHandoff || state.loadingProgress?.state === 'handoff');
  return (
    <div
      className={`browser-workbench-viewer-state browser-workbench-viewer-state-${state.status}`}
      data-browser-object-type="browser-state"
      data-browser-state={state.status}
      data-browser-state-ref={state.ref}
      data-browser-host-surface={state.hostSurface}
      data-browser-loading-progress-state={state.loadingProgress?.state}
      data-browser-loading-progress-reason={state.loadingProgress?.reason}
      data-browser-loading-progress-source={state.loadingProgress?.source}
      data-browser-loading-progress-can-retry={state.loadingProgress?.canRetry ? 'true' : undefined}
      data-browser-loading-progress-blocked={state.loadingProgress?.blocked ? 'true' : undefined}
      data-browser-loading-progress-requires-handoff={state.loadingProgress?.requiresHandoff ? 'true' : undefined}
      role={state.status === 'loading' ? 'status' : undefined}
    >
      <strong>{state.status}</strong>
      {renderBrowserWorkbenchStateReason(state)}
      <dl>
        {renderStateValue('url', state.url)}
        {renderStateValue('title', state.title)}
        {renderStateValue('detail', sanitizeBrowserWorkbenchDiagnosticText(state.detail))}
        {renderStateValue('hostSurface', state.hostSurface)}
        {renderStateValue('progressState', state.loadingProgress?.state)}
        {renderStateValue('progressReason', state.loadingProgress?.reason)}
        {renderStateValue('progressSource', state.loadingProgress?.source)}
        {renderStateValue('checkedAt', state.checkedAt)}
        {renderStateValue('ref', state.ref)}
      </dl>
      {canRetryNativeSurface || externalUrl ? (
        <div className="browser-workbench-viewer-state-actions" aria-label="Browser state actions">
          {canRetryNativeSurface && openCommand ? (
            <button
              type="button"
              data-event="browser-command-request"
              data-browser-state-action="retry"
              data-browser-command-id={openCommand.id}
              data-browser-command={openCommand.command}
              data-command-text={openCommand.command}
              data-browser-command-kind={openCommand.kind ?? 'terminal-equivalent'}
              data-browser-risk={openCommand.risk ?? 'allowed'}
              disabled={openCommand.disabled}
              onClick={() => {
                if (!openCommand.disabled) payload.onCommandRequest?.(openCommand);
              }}
            >
              Retry
            </button>
          ) : null}
          {openExternalCommand ? (
            <button
              type="button"
              data-event="browser-command-request"
              data-browser-state-action={requiresHandoff ? 'handoff' : 'open-external'}
              data-browser-command-id={openExternalCommand.id}
              data-browser-command={openExternalCommand.command}
              data-command-text={openExternalCommand.command}
              data-browser-command-kind={openExternalCommand.kind ?? 'terminal-equivalent'}
              data-browser-risk={openExternalCommand.risk ?? 'needs-approval'}
              disabled={openExternalCommand.disabled}
              onClick={() => {
                if (!openExternalCommand.disabled) payload.onCommandRequest?.(openExternalCommand);
              }}
            >
              {requiresHandoff ? 'Handoff' : 'Open External'}
            </button>
          ) : null}
        </div>
      ) : null}
      {renderRefs(refs, payload.onCopyRefRequest)}
    </div>
  );
}

function canRenderHostBrowser(state: BrowserWorkbenchState, hostSession?: BrowserHostSessionState) {
  return state.hostSurface === 'browser-host-session'
    && (state.status === 'ready' || state.status === 'loading')
    && hostSession?.liveSurfaceTransport === 'native-embedded'
    && hostSession.singleInteractiveTruth === true
    && hostSession.secondTruthSource === false
    && Boolean(hostSession.liveSurfaceRef);
}

function browserWorkbenchNativeSurfaceStabilityKey(hostSession: BrowserHostSessionState) {
  return `${hostSession.id}:${hostSession.liveSurfaceRef}`;
}

function browserWorkbenchStateWithExplicit(
  base: BrowserWorkbenchState,
  explicit: Partial<BrowserWorkbenchState> | undefined,
): BrowserWorkbenchState {
  if (!explicit) return base;
  return {
    ...base,
    ...explicit,
    status: explicit.status ?? base.status,
    url: explicit.url ?? base.url,
    title: explicit.title ?? base.title,
    reason: explicit.reason ?? base.reason,
    detail: explicit.detail ?? base.detail,
    ref: explicit.ref ?? base.ref,
    checkedAt: explicit.checkedAt ?? base.checkedAt,
    canRenderFrame: explicit.canRenderFrame ?? base.canRenderFrame,
    hostSurface: explicit.hostSurface ?? base.hostSurface,
    loadingProgress: explicit.loadingProgress ?? base.loadingProgress,
  };
}

export function renderBrowserWorkbench(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const session = sessionFromPayload(payload);
  const activeTab = activeTabFromPayload(payload, session);
  const hostSession = hostSessionFromPayload(payload);
  const snapshot = snapshotFromPayload(payload);
  const traceRefs = traceRefsFromPayload(payload);
  const title = payload.title ?? activeTab?.title ?? snapshot?.title ?? props.slot.title ?? 'Browser workbench';
  const previewUrl = asString(payload.previewUrl);
  const normalizedPreviewUrl = previewUrl ? normalizeBrowserWorkbenchUrl(previewUrl) : undefined;
  const previewStateUrl = safePreviewStateUrl(previewUrl);
  const explicitState = normalizeStateInput(payload.browserState ?? payload.state);
  const baseState = hostSession
    ? browserWorkbenchStateWithExplicit({
        status: normalizeStateStatus(hostSession.status) ?? 'idle',
        url: asString(hostSession.url),
        title: asString(hostSession.title),
        reason: hostSession.status === 'failed' ? 'BrowserHostSession reported a failed live browser state.' : undefined,
        detail: browserWorkbenchDiagnosticsDetail(hostSession.diagnostics),
        ref: `browser-host-session:${hostSession.id}`,
        checkedAt: hostSession.updatedAt,
        canRenderFrame: false,
        hostSurface: 'browser-host-session',
        loadingProgress: loadingProgressFromStateInput((hostSession as { loadingProgress?: unknown }).loadingProgress),
      } satisfies BrowserWorkbenchState, explicitState)
    : browserWorkbenchStateFromPayload(payload, session, activeTab, snapshot, normalizedPreviewUrl);
  const state = normalizedPreviewUrl && !previewStateUrl && baseState.status === 'ready'
    ? {
        ...baseState,
        status: 'blocked' as const,
        reason: 'Preview URL scheme is not accepted by the browser presentation state.',
        canRenderFrame: false,
      }
    : baseState;
  const commands = browserWorkbenchCommands(payload, state, activeTab, snapshot);
  const refs = displayedTraceRefs(snapshot, traceRefs, hostSession);
  const addressValue = payload.addressValue ?? activeTab?.url ?? snapshot?.url ?? payload.externalUrl ?? previewUrl ?? '';
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  const renderHostBrowser = canRenderHostBrowser(state, hostSession);
  const hostFrameTransport = renderHostBrowser ? 'native-embedded' : undefined;
  const nativeSurfaceStabilityKey = renderHostBrowser && hostSession ? browserWorkbenchNativeSurfaceStabilityKey(hostSession) : undefined;

  return (
    <div
      className="browser-workbench-viewer"
      data-component-id="browser-workbench"
      data-render-boundary="presentation-only"
      data-session-ref={session?.id}
      data-status={state.status}
      data-browser-state={state.status}
      data-browser-loading-progress-state={state.loadingProgress?.state}
      data-browser-loading-progress-reason={state.loadingProgress?.reason}
      data-browser-loading-progress-source={state.loadingProgress?.source}
    >
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={props.artifact} /> : null}
      <header className="browser-workbench-viewer-header">
        <div>
          <h3>{title}</h3>
          <p>{state.url ?? 'No browser tab is attached.'}</p>
        </div>
        <span className={`browser-workbench-viewer-status browser-workbench-viewer-status-${state.status}`}>
          {state.status}
        </span>
      </header>
      <div className="browser-workbench-viewer-topbar">
        <form
          className="browser-workbench-viewer-address"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const value = normalizeBrowserWorkbenchUrl(String(data.get('browser-url') ?? ''));
            payload.onAddressSubmit?.(value);
          }}
        >
          <input
            name="browser-url"
            value={addressValue}
            readOnly={!payload.onAddressChange}
            placeholder={payload.addressPlaceholder ?? 'https://example.org'}
            aria-label="Browser URL"
            onChange={(event) => payload.onAddressChange?.(event.currentTarget.value)}
          />
          <button type="submit">Open</button>
        </form>
        <div className="browser-workbench-viewer-actions" aria-label="Browser runtime commands">
          {commands.map((command) => renderCommandButton(command, payload.onCommandRequest))}
        </div>
      </div>
      {session?.tabs.length ? (
        <nav className="browser-workbench-viewer-tabs" aria-label="Browser tabs">
          {session.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-event="focus-tab"
              data-browser-tab-id={tab.id}
              aria-current={tab.id === activeTab?.id ? 'page' : undefined}
              onClick={() => payload.onFocusTabRequest?.(tab)}
            >
              <span>{tab.title || tab.url || tab.id}</span>
              <small>{tab.status}</small>
            </button>
          ))}
        </nav>
      ) : null}
      <section
        className={`browser-workbench-viewer-preview browser-workbench-viewer-preview-${state.status}`}
        aria-label="Browser preview"
        data-browser-object-type={renderHostBrowser ? 'host-browser' : 'browser-state'}
        data-browser-state={state.status}
        data-browser-loading-progress-state={state.loadingProgress?.state}
        data-browser-loading-progress-reason={state.loadingProgress?.reason}
        data-browser-loading-progress-source={state.loadingProgress?.source}
      >
        {renderHostBrowser ? (
          <div
            key={nativeSurfaceStabilityKey}
            className="browser-workbench-host-frame browser-workbench-host-frame-native"
            data-browser-host-surface={state.hostSurface}
            data-browser-native-surface="true"
            data-browser-native-surface-stability-key={nativeSurfaceStabilityKey}
            data-browser-live-surface-ref={hostSession?.liveSurfaceRef}
            data-browser-live-surface-transport={hostSession?.liveSurfaceTransport}
            data-browser-single-interactive-truth={hostSession?.singleInteractiveTruth ? 'true' : undefined}
            data-browser-second-truth-source={hostSession?.secondTruthSource === false ? 'false' : undefined}
            data-browser-frame-transport={hostFrameTransport}
            role="application"
            aria-label="Browser page"
          />
        ) : (
          renderBrowserState(state, refs, payload, commands)
        )}
      </section>
      {snapshot?.textPreview ? (
        <section className="browser-workbench-viewer-refs" aria-label="Browser text preview">
          {snapshot?.textPreview ? <p>{snapshot.textPreview}</p> : null}
        </section>
      ) : null}
      {renderBrowserWorkbenchDiagnostics(state, payload, hostSession)}
      {renderHostBrowser ? renderRefs(refs, payload.onCopyRefRequest) : null}
      <section className="browser-workbench-viewer-command-list" aria-label="Terminal-equivalent browser commands">
        {commands.map((command) => (
          <code key={`${command.id ?? command.label}:code`}>{command.command}</code>
        ))}
      </section>
      {payload.notes?.length ? (
        <ul className="browser-workbench-viewer-notes">
          {payload.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
