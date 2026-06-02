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

export type BrowserWorkbenchFrameRenderer = 'image-blob' | 'canvas-binary';

export interface BrowserWorkbenchLiveTransportHandoff {
  status: 'candidate-contract';
  claim: 'bridge-to-right-pane-canvas-handoff-only';
  claimScope: 'candidate-only';
  owner: 'BrowserHostSession';
  rightPaneSurfaceOwner: 'BrowserHostSession';
  productSurface: 'right-pane-browser';
  renderTarget: 'canvas';
  frameRenderer: 'canvas-binary';
  frameTransport: 'webrtc-data-channel';
  fallbackTransport: 'websocket-binary';
  liveSurfaceTransportCandidate: 'webrtc-data-channel';
  hostSessionRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  inlineFrameBytes: false;
  inlineSignals: false;
  secondViewer: false;
  secondTruthSource: false;
  httpFrameLiveFallback: false;
  fullyPassedClaim: false;
  realUiWebRtcPassClaim: false;
  loopbackEvidenceOnly: false;
  httpFrameRouteClaim: false;
}

const BROWSER_WORKBENCH_POINTER_MOVE_FLUSH_MS = 24;
const BROWSER_WORKBENCH_KEYBOARD_FOCUS_STORAGE_PREFIX = 'sciforge.browser-workbench.keyboard-focus.v1';
const BROWSER_WORKBENCH_DIAGNOSTIC_TEXT_MAX = 240;
const BROWSER_WORKBENCH_HEALTH_CAPABILITIES = ['browser-host-session', 'browser-host-search'] as const;

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
  frameRenderer?: BrowserWorkbenchFrameRenderer;
  liveTransportHandoff?: BrowserWorkbenchLiveTransportHandoff;
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

function safeIframePreviewUrl(value: string | undefined) {
  if (!value) return undefined;
  const normalized = normalizeBrowserWorkbenchUrl(value);
  if (/^https?:\/\//i.test(normalized) || /^about:blank$/i.test(normalized)) return normalized;
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized;
  return undefined;
}

function safeHostBrowserFrameUrl(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^blob:/i.test(trimmed)) return trimmed;
  return safeIframePreviewUrl(value);
}

function safeExternalHref(value: string | undefined) {
  if (!value) return undefined;
  const normalized = normalizeBrowserWorkbenchUrl(value);
  return /^https?:\/\//i.test(normalized) ? normalized : undefined;
}

function browserWorkbenchFrameRenderer(value: unknown): BrowserWorkbenchFrameRenderer {
  return value === 'canvas-binary' ? 'canvas-binary' : 'image-blob';
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
    status: normalizeStateStatus(value.status) ?? 'idle',
    url: asString(value.url),
    title: asString(value.title),
    reason: asString(value.reason),
    detail: asString(value.detail),
    ref: asRefString(value.ref),
    checkedAt: asString(value.checkedAt),
    canRenderFrame: asBoolean(value.canRenderFrame),
    hostSurface: asString(value.hostSurface),
  };
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

function browserWorkbenchKeyAction(event: React.KeyboardEvent): { action: 'type'; text: string } | { action: 'press'; key: string } | undefined {
  if (event.key === 'Dead' || event.nativeEvent.isComposing) return undefined;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) return { action: 'type', text: event.key };
  const modifierPrefix = [
    event.ctrlKey ? 'Control' : '',
    event.metaKey ? 'Meta' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey && event.key.length !== 1 ? 'Shift' : '',
  ].filter(Boolean).join('+');
  const key = browserWorkbenchPressKey(event.key);
  if (!key) return undefined;
  return { action: 'press', key: modifierPrefix ? `${modifierPrefix}+${key}` : key };
}

function browserWorkbenchPressKey(key: string) {
  if (key === ' ') return 'Space';
  const allowed = new Set([
    'Enter',
    'Backspace',
    'Delete',
    'Tab',
    'Escape',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]);
  if (allowed.has(key)) return key;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  return undefined;
}

function browserWorkbenchKeyboardPressAction(event: React.KeyboardEvent): { action: 'press'; key: string } | undefined {
  if (event.key === 'Dead' || event.nativeEvent.isComposing) return undefined;
  if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) return undefined;
  const action = browserWorkbenchKeyAction(event);
  return action?.action === 'press' ? action : undefined;
}

function browserWorkbenchHostFrameForTarget(target: HTMLElement) {
  return target.closest<HTMLElement>('.browser-workbench-host-frame') ?? target.parentElement;
}

function focusBrowserWorkbenchKeyboardInput(target: HTMLElement, point?: { clientX: number; clientY: number }) {
  const frame = browserWorkbenchHostFrameForTarget(target);
  const input = frame?.querySelector<HTMLTextAreaElement>('.browser-workbench-host-keyboard-input');
  if (!input || !frame) return;
  if (point) {
    const frameRect = frame.getBoundingClientRect();
    const localX = clampNumber(point.clientX - frameRect.left, 0, Math.max(0, frameRect.width - 16));
    const localY = clampNumber(point.clientY - frameRect.top - 13, 0, Math.max(0, frameRect.height - 28));
    input.style.left = `${Math.round(localX)}px`;
    input.style.top = `${Math.round(localY)}px`;
    input.style.width = `${Math.round(Math.max(48, frameRect.width - localX - 8))}px`;
    input.style.height = '28px';
    input.value = '';
    input.dataset.sentValue = '';
  }
  frame.dataset.browserHostKeyboardFocus = 'hidden-input';
  input.dataset.browserHostKeyboardFocus = 'active';
  rememberBrowserWorkbenchKeyboardFocus(frame);
  focusBrowserWorkbenchKeyboardInputNow(input);
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame?.(() => focusBrowserWorkbenchKeyboardInputNow(input));
    window.setTimeout(() => focusBrowserWorkbenchKeyboardInputNow(input), 0);
  }
}

function focusBrowserWorkbenchKeyboardInputNow(input: HTMLTextAreaElement) {
  input.focus({ preventScroll: true });
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function browserWorkbenchKeyboardFocusStorageKey(frame: HTMLElement) {
  const key = frame.dataset.browserHostKeyboardFocusKey;
  return key ? `${BROWSER_WORKBENCH_KEYBOARD_FOCUS_STORAGE_PREFIX}:${key}` : undefined;
}

function rememberBrowserWorkbenchKeyboardFocus(frame: HTMLElement) {
  const key = browserWorkbenchKeyboardFocusStorageKey(frame);
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, 'active');
  } catch {
    // Browser focus restoration is best-effort; input routing still works after an explicit frame click.
  }
}

function restoreBrowserWorkbenchKeyboardFocus(input: HTMLTextAreaElement | null) {
  if (!input || typeof window === 'undefined') return;
  const frame = browserWorkbenchHostFrameForTarget(input);
  if (!frame) return;
  const key = browserWorkbenchKeyboardFocusStorageKey(frame);
  if (!key) return;
  try {
    if (window.sessionStorage.getItem(key) !== 'active') return;
  } catch {
    return;
  }
  frame.dataset.browserHostKeyboardFocus = 'hidden-input';
  input.dataset.browserHostKeyboardFocus = 'active';
  window.requestAnimationFrame?.(() => focusBrowserWorkbenchKeyboardInputNow(input));
  window.setTimeout(() => focusBrowserWorkbenchKeyboardInputNow(input), 0);
}

function sendBrowserWorkbenchInputText(
  input: HTMLTextAreaElement,
  onHostActionRequest: BrowserWorkbenchPayload['onHostActionRequest'],
  fallbackText = '',
) {
  const sentValue = input.dataset.sentValue ?? '';
  const value = input.value || fallbackText;
  const text = value.startsWith(sentValue) ? value.slice(sentValue.length) : value || fallbackText;
  input.dataset.sentValue = input.value || value;
  if (text) onHostActionRequest?.({ action: 'type', text });
}

function mirrorBrowserWorkbenchSpecialKey(input: HTMLTextAreaElement, key: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (key === 'Backspace' && start > 0) {
    const nextStart = start === end ? start - 1 : start;
    input.value = `${input.value.slice(0, nextStart)}${input.value.slice(end)}`;
    input.setSelectionRange(nextStart, nextStart);
    input.dataset.sentValue = input.value;
    return;
  }
  if (key === 'Delete' && start < input.value.length) {
    const nextEnd = start === end ? end + 1 : end;
    input.value = `${input.value.slice(0, start)}${input.value.slice(nextEnd)}`;
    input.setSelectionRange(start, start);
    input.dataset.sentValue = input.value;
    return;
  }
  if (key === 'ArrowLeft') input.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1));
  if (key === 'ArrowRight') input.setSelectionRange(Math.min(input.value.length, end + 1), Math.min(input.value.length, end + 1));
  if (key === 'Home') input.setSelectionRange(0, 0);
  if (key === 'End') input.setSelectionRange(input.value.length, input.value.length);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

type BrowserWorkbenchInteractiveFrameElement = HTMLImageElement | HTMLCanvasElement;

function browserWorkbenchFrameBitmapSize(target: BrowserWorkbenchInteractiveFrameElement) {
  if (target instanceof HTMLCanvasElement) {
    return {
      width: target.width,
      height: target.height,
    };
  }
  return {
    width: target.naturalWidth,
    height: target.naturalHeight,
  };
}

function browserWorkbenchFramePoint(
  target: BrowserWorkbenchInteractiveFrameElement,
  event:
    | React.MouseEvent<BrowserWorkbenchInteractiveFrameElement>
    | React.PointerEvent<BrowserWorkbenchInteractiveFrameElement>
    | React.WheelEvent<BrowserWorkbenchInteractiveFrameElement>,
) {
  const rect = target.getBoundingClientRect();
  const bitmapSize = browserWorkbenchFrameBitmapSize(target);
  const scaleX = bitmapSize.width && rect.width ? bitmapSize.width / rect.width : 1;
  const scaleY = bitmapSize.height && rect.height ? bitmapSize.height / rect.height : 1;
  const maxX = Math.max(0, (bitmapSize.width || Math.round(rect.width) || 1) - 1);
  const maxY = Math.max(0, (bitmapSize.height || Math.round(rect.height) || 1) - 1);
  return {
    x: Math.round(clampNumber((event.clientX - rect.left) * scaleX, 0, maxX)),
    y: Math.round(clampNumber((event.clientY - rect.top) * scaleY, 0, maxY)),
  };
}

function browserWorkbenchMouseButton(button: number): BrowserWorkbenchMouseButton {
  if (button === 2) return 'right';
  if (button === 1) return 'middle';
  return 'left';
}

function shouldFlushBrowserWorkbenchPointerMove(target: HTMLElement) {
  const now = Date.now();
  const previous = Number(target.dataset.hostPointerMoveAt ?? '0');
  if (now - previous < BROWSER_WORKBENCH_POINTER_MOVE_FLUSH_MS) return false;
  target.dataset.hostPointerMoveAt = String(now);
  return true;
}

function browserWorkbenchPointerDistance(target: HTMLElement, point: { x: number; y: number }) {
  const startX = Number(target.dataset.hostPointerStartX ?? point.x);
  const startY = Number(target.dataset.hostPointerStartY ?? point.y);
  return Math.hypot(point.x - startX, point.y - startY);
}

function cleanupBrowserWorkbenchPointer(target: HTMLElement) {
  delete target.dataset.hostPointerDown;
  delete target.dataset.hostPointerButton;
  delete target.dataset.hostPointerStartX;
  delete target.dataset.hostPointerStartY;
  delete target.dataset.hostPointerMoveAt;
}

function normalizeBrowserWorkbenchCursor(value: unknown) {
  const cursor = typeof value === 'string' ? value.trim() : '';
  const allowed = new Set([
    'default',
    'auto',
    'pointer',
    'text',
    'vertical-text',
    'crosshair',
    'move',
    'grab',
    'grabbing',
    'help',
    'wait',
    'progress',
    'not-allowed',
    'copy',
    'alias',
    'zoom-in',
    'zoom-out',
    'cell',
    'context-menu',
    'col-resize',
    'row-resize',
    'ew-resize',
    'ns-resize',
    'nesw-resize',
    'nwse-resize',
    'all-scroll',
  ]);
  return allowed.has(cursor) ? cursor : 'default';
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

function browserWorkbenchKeyboardFocusKey(
  session: BrowserRuntimeSession | undefined,
  activeTab: BrowserRuntimeTab | undefined,
  state: BrowserWorkbenchState,
) {
  return asRefString(activeTab?.id)
    ?? asRefString(session?.activeTabId)
    ?? asRefString(session?.id)
    ?? asRefString(state.ref)
    ?? asString(state.url);
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
      data-browser-live-surface-transport={diagnostics.transport}
      data-browser-last-action={timing?.action}
      data-browser-last-action-total-ms={timing?.totalMs}
      data-browser-last-action-timing={lastActionTiming}
      data-browser-last-action-status={timing?.status}
      data-browser-last-blocked-reason={diagnostics.lastBlockedReason}
      data-browser-writer-diagnostic={diagnostics.writerDiagnosticStatus}
      data-browser-writer-diagnostic-ref={diagnostics.writerDiagnosticRef}
    >
      <dl>
        {renderStateValue('writerUrl', diagnostics.writerUrl)}
        {renderStateValue('healthCapability', diagnostics.healthCapability)}
        {renderStateValue('writerDiagnostic', diagnostics.writerDiagnosticStatus)}
        {renderStateValue('writerDiagnosticRef', diagnostics.writerDiagnosticRef)}
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
  const openExternalCommand = externalUrl
    ? commands.find((command) => command.id === 'open-external')
      ?? browserWorkbenchDefaultCommands(externalUrl).find((command) => command.id === 'open-external')
    : undefined;
  return (
    <div
      className={`browser-workbench-viewer-state browser-workbench-viewer-state-${state.status}`}
      data-browser-object-type="browser-state"
      data-browser-state={state.status}
      data-browser-state-ref={state.ref}
      data-browser-host-surface={state.hostSurface}
      role={state.status === 'loading' ? 'status' : undefined}
    >
      <strong>{state.status}</strong>
      {renderBrowserWorkbenchStateReason(state)}
      <dl>
        {renderStateValue('url', state.url)}
        {renderStateValue('title', state.title)}
        {renderStateValue('detail', sanitizeBrowserWorkbenchDiagnosticText(state.detail))}
        {renderStateValue('hostSurface', state.hostSurface)}
        {renderStateValue('checkedAt', state.checkedAt)}
        {renderStateValue('ref', state.ref)}
      </dl>
      {externalUrl ? (
        <div className="browser-workbench-viewer-state-actions" aria-label="Browser state actions">
          {openExternalCommand ? (
            <button
              type="button"
              data-event="browser-command-request"
              data-browser-state-action="open-external"
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
              Open External
            </button>
          ) : null}
        </div>
      ) : null}
      {renderRefs(refs, payload.onCopyRefRequest)}
    </div>
  );
}

function canRenderIframe(state: BrowserWorkbenchState, iframePreviewUrl: string | undefined) {
  if (!iframePreviewUrl || state.canRenderFrame === false) return false;
  return state.status === 'ready' || state.status === 'loading';
}

function canRenderHostBrowser(state: BrowserWorkbenchState, hostSession?: BrowserHostSessionState, frameUrl?: string) {
  return state.hostSurface === 'browser-host-session'
    && (state.status === 'ready' || state.status === 'loading')
    && (hostSession?.liveSurfaceTransport === 'native-embedded' || Boolean(frameUrl ?? hostSession?.frameUrl));
}

function browserHostSessionFrameStreamRefMatchesSession(hostSession: BrowserHostSessionState | undefined) {
  return Boolean(hostSession?.id && hostSession.frameStreamRef === `browser-host-session:${hostSession.id}/frame-stream`);
}

function canRenderHostCanvas(
  state: BrowserWorkbenchState,
  hostSession: BrowserHostSessionState | undefined,
  frameTransport: string | undefined,
  handoff: BrowserWorkbenchLiveTransportHandoff | undefined,
) {
  const requestedTransportAllowed = frameTransport === 'webrtc-data-channel'
    ? browserWorkbenchWebRtcCandidateHandoffAllowed(hostSession, frameTransport, handoff)
    : !frameTransport || frameTransport === 'websocket-binary';
  return state.hostSurface === 'browser-host-session'
    && (state.status === 'ready' || state.status === 'loading')
    && hostSession?.liveSurfaceTransport === 'host-stream'
    && hostSession.singleInteractiveTruth === true
    && browserHostSessionFrameStreamRefMatchesSession(hostSession)
    && requestedTransportAllowed;
}

function browserWorkbenchWebRtcCandidateHandoffAllowed(
  hostSession: BrowserHostSessionState | undefined,
  frameTransport: string | undefined,
  handoff: BrowserWorkbenchLiveTransportHandoff | undefined,
) {
  const hostSessionRef = hostSession?.id ? `browser-host-session:${hostSession.id}` : undefined;
  return frameTransport === 'webrtc-data-channel'
    && handoff?.status === 'candidate-contract'
    && handoff.claim === 'bridge-to-right-pane-canvas-handoff-only'
    && handoff.claimScope === 'candidate-only'
    && handoff.owner === 'BrowserHostSession'
    && handoff.rightPaneSurfaceOwner === 'BrowserHostSession'
    && handoff.productSurface === 'right-pane-browser'
    && handoff.renderTarget === 'canvas'
    && handoff.frameRenderer === 'canvas-binary'
    && handoff.frameTransport === 'webrtc-data-channel'
    && handoff.fallbackTransport === 'websocket-binary'
    && handoff.liveSurfaceTransportCandidate === 'webrtc-data-channel'
    && handoff.hostSessionRef === hostSessionRef
    && Boolean(hostSession?.liveSurfaceRef)
    && handoff.liveSurfaceRef === hostSession?.liveSurfaceRef
    && handoff.frameStreamRef === hostSession?.frameStreamRef
    && handoff.inlineFrameBytes === false
    && handoff.inlineSignals === false
    && handoff.secondViewer === false
    && handoff.secondTruthSource === false
    && handoff.httpFrameLiveFallback === false
    && handoff.fullyPassedClaim === false
    && handoff.realUiWebRtcPassClaim === false
    && handoff.loopbackEvidenceOnly === false
    && handoff.httpFrameRouteClaim === false
    && hostSession?.liveSurfaceTransport === 'host-stream'
    && hostSession.singleInteractiveTruth === true
    && browserHostSessionFrameStreamRefMatchesSession(hostSession);
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
  const iframePreviewUrl = safeIframePreviewUrl(previewUrl);
  const iframeSandbox = asString(payload.previewSandbox)
    ?? 'allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation';
  const baseState = hostSession
    ? {
        status: normalizeStateStatus(hostSession.status) ?? 'idle',
        url: asString(hostSession.url),
        title: asString(hostSession.title),
        reason: hostSession.status === 'failed' ? 'BrowserHostSession reported a failed live browser state.' : undefined,
        detail: browserWorkbenchDiagnosticsDetail(hostSession.diagnostics),
        ref: `browser-host-session:${hostSession.id}`,
        checkedAt: hostSession.updatedAt,
        canRenderFrame: false,
        hostSurface: 'browser-host-session',
      } satisfies BrowserWorkbenchState
    : browserWorkbenchStateFromPayload(payload, session, activeTab, snapshot, normalizedPreviewUrl);
  const state = normalizedPreviewUrl && !iframePreviewUrl && baseState.status === 'ready'
    ? {
        ...baseState,
        status: 'blocked' as const,
        reason: 'Preview URL scheme is not embeddable by the presentation surface.',
        canRenderFrame: false,
      }
    : baseState;
  const commands = browserWorkbenchCommands(payload, state, activeTab, snapshot);
  const refs = displayedTraceRefs(snapshot, traceRefs, hostSession);
  const addressValue = payload.addressValue ?? activeTab?.url ?? snapshot?.url ?? payload.externalUrl ?? previewUrl ?? '';
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  const renderFrame = canRenderIframe(state, iframePreviewUrl);
  const hostBrowserFrameUrl = safeHostBrowserFrameUrl(payload.frameUrl ?? hostSession?.frameUrl);
  const requestedFrameTransport = asString(payload.frameTransport);
  const frameRenderer = browserWorkbenchFrameRenderer(payload.frameRenderer);
  const liveTransportHandoff = payload.liveTransportHandoff;
  const renderCanvasHostBrowser = !renderFrame && frameRenderer === 'canvas-binary' && canRenderHostCanvas(state, hostSession, requestedFrameTransport, liveTransportHandoff);
  const requestedWebRtcLiveTransport = requestedFrameTransport === 'webrtc-data-channel'
    || hostSession?.liveSurfaceTransport === 'webrtc-data-channel';
  const renderHostBrowser = !renderFrame
    && (renderCanvasHostBrowser || (!requestedWebRtcLiveTransport && canRenderHostBrowser(state, hostSession, hostBrowserFrameUrl)));
  const renderNativeHostBrowser = renderHostBrowser && !renderCanvasHostBrowser && hostSession?.liveSurfaceTransport === 'native-embedded';
  const hostFrameTransport = requestedFrameTransport
    ?? (renderNativeHostBrowser ? 'native-embedded' : renderCanvasHostBrowser ? hostSession?.liveSurfaceTransport === 'webrtc-data-channel' ? 'webrtc-data-channel' : 'websocket-binary' : hostBrowserFrameUrl?.startsWith('blob:') ? 'websocket-binary' : undefined);
  const webRtcCandidateHandoff = browserWorkbenchWebRtcCandidateHandoffAllowed(hostSession, hostFrameTransport, liveTransportHandoff);
  const hostCursor = normalizeBrowserWorkbenchCursor(hostSession?.cursor);
  const hostKeyboardFocusKey = browserWorkbenchKeyboardFocusKey(session, activeTab, state);

  return (
    <div
      className="browser-workbench-viewer"
      data-component-id="browser-workbench"
      data-render-boundary="presentation-only"
      data-session-ref={session?.id}
      data-status={state.status}
      data-browser-state={state.status}
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
        data-browser-object-type={renderFrame ? 'browser-embedded-frame' : renderHostBrowser ? 'host-browser' : 'browser-state'}
        data-browser-state={state.status}
      >
        {renderFrame ? (
          <iframe
            title={title}
            src={iframePreviewUrl}
            data-browser-frame-state={state.status}
            sandbox={iframeSandbox}
          />
        ) : renderNativeHostBrowser ? (
          <div
            className="browser-workbench-host-frame browser-workbench-host-frame-native"
            data-browser-host-surface={state.hostSurface}
            data-browser-native-surface="true"
            data-browser-live-surface-ref={hostSession?.liveSurfaceRef}
            data-browser-live-surface-transport={hostSession?.liveSurfaceTransport}
            data-browser-single-interactive-truth={hostSession?.singleInteractiveTruth ? 'true' : undefined}
            data-browser-frame-stream-ref={hostSession?.frameStreamRef}
            data-browser-frame-transport={hostFrameTransport}
            role="application"
            aria-label="Browser page"
          />
        ) : renderCanvasHostBrowser ? (
          <div
            className="browser-workbench-host-frame browser-workbench-host-frame-canvas"
            data-browser-host-surface={state.hostSurface}
            data-browser-live-surface-ref={hostSession?.liveSurfaceRef}
            data-browser-live-surface-transport={hostSession?.liveSurfaceTransport}
            data-browser-single-interactive-truth={hostSession?.singleInteractiveTruth ? 'true' : undefined}
            data-browser-frame-stream-ref={hostSession?.frameStreamRef}
            data-browser-frame-transport={hostFrameTransport}
            data-browser-frame-renderer="canvas-binary"
            data-browser-frame-source="browser-host-session-frame-stream-binary"
            data-browser-webrtc-handoff={webRtcCandidateHandoff ? 'candidate-only' : undefined}
            data-browser-webrtc-claim={webRtcCandidateHandoff ? liveTransportHandoff?.claim : undefined}
            data-browser-webrtc-fully-passed-claim={webRtcCandidateHandoff ? 'false' : undefined}
            data-browser-second-viewer={webRtcCandidateHandoff ? 'false' : undefined}
            data-browser-http-frame-live-fallback={webRtcCandidateHandoff ? 'false' : undefined}
            data-browser-host-keyboard-path="hidden-input"
            data-browser-host-keyboard-focus-key={hostKeyboardFocusKey}
            style={{ cursor: hostCursor }}
            onPointerDownCapture={(event) => {
              if (event.button < 0 || event.button > 2) return;
              focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
            }}
            onMouseDownCapture={(event) => {
              if (event.button < 0 || event.button > 2) return;
              focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
            }}
            onClickCapture={(event) => {
              focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
            }}
          >
            <canvas
              className="browser-workbench-host-canvas"
              width={hostSession?.viewport?.width}
              height={hostSession?.viewport?.height}
              data-browser-host-surface={state.hostSurface}
              data-browser-live-surface-ref={hostSession?.liveSurfaceRef}
              data-browser-frame-stream-ref={hostSession?.frameStreamRef}
              data-browser-frame-transport={hostFrameTransport}
              data-browser-frame-renderer="canvas-binary"
              data-browser-frame-source="browser-host-session-frame-stream-binary"
              data-browser-webrtc-handoff={webRtcCandidateHandoff ? 'candidate-only' : undefined}
              data-browser-webrtc-claim={webRtcCandidateHandoff ? liveTransportHandoff?.claim : undefined}
              data-browser-webrtc-fully-passed-claim={webRtcCandidateHandoff ? 'false' : undefined}
              data-browser-second-viewer={webRtcCandidateHandoff ? 'false' : undefined}
              data-browser-http-frame-live-fallback={webRtcCandidateHandoff ? 'false' : undefined}
              data-browser-frame-session-id={hostSession?.id}
              data-browser-frame-state={state.status}
              tabIndex={0}
              role="application"
              aria-label="Browser page"
              style={{ cursor: hostCursor }}
              onFocus={(event) => {
                focusBrowserWorkbenchKeyboardInput(event.currentTarget);
              }}
              onPointerDown={(event) => {
                if (event.button < 0 || event.button > 2) return;
                event.preventDefault();
                event.stopPropagation();
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = browserWorkbenchMouseButton(event.button);
                event.currentTarget.dataset.hostPointerDown = 'true';
                event.currentTarget.dataset.hostPointerButton = button;
                event.currentTarget.dataset.hostPointerStartX = String(point.x);
                event.currentTarget.dataset.hostPointerStartY = String(point.y);
                event.currentTarget.dataset.hostPointerMoveAt = '0';
                event.currentTarget.dataset.hostSuppressClick = 'true';
                event.currentTarget.dataset.hostSuppressDoubleClick = 'true';
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Pointer capture is best-effort; the host still receives the down event.
                }
                payload.onHostActionRequest?.({
                  action: 'mouse-down',
                  x: point.x,
                  y: point.y,
                  button,
                });
              }}
              onPointerMove={(event) => {
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                if (event.currentTarget.dataset.hostPointerDown === 'true') {
                  event.preventDefault();
                  event.stopPropagation();
                  if (browserWorkbenchPointerDistance(event.currentTarget, point) >= 1 && shouldFlushBrowserWorkbenchPointerMove(event.currentTarget)) {
                    payload.onHostActionRequest?.({ action: 'mouse-move', x: point.x, y: point.y });
                  }
                  return;
                }
                payload.onHostActionRequest?.({ action: 'cursor', x: point.x, y: point.y });
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.dataset.hostPointerDown !== 'true') return;
                event.preventDefault();
                event.stopPropagation();
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = (event.currentTarget.dataset.hostPointerButton as BrowserWorkbenchMouseButton | undefined) ?? browserWorkbenchMouseButton(event.button);
                if (browserWorkbenchPointerDistance(event.currentTarget, point) >= 1) {
                  payload.onHostActionRequest?.({ action: 'mouse-move', x: point.x, y: point.y });
                }
                payload.onHostActionRequest?.({
                  action: 'mouse-up',
                  x: point.x,
                  y: point.y,
                  button,
                });
                cleanupBrowserWorkbenchPointer(event.currentTarget);
                try {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                } catch {
                  // The browser may already have released capture after pointerup.
                }
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.dataset.hostPointerDown !== 'true') {
                  payload.onHostActionRequest?.({ action: 'cursor', x: -1, y: -1 });
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = (event.currentTarget.dataset.hostPointerButton as BrowserWorkbenchMouseButton | undefined) ?? browserWorkbenchMouseButton(event.button);
                payload.onHostActionRequest?.({
                  action: 'mouse-up',
                  x: point.x,
                  y: point.y,
                  button,
                });
                cleanupBrowserWorkbenchPointer(event.currentTarget);
              }}
              onLostPointerCapture={(event) => {
                if (event.currentTarget.dataset.hostPointerDown !== 'true') return;
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = (event.currentTarget.dataset.hostPointerButton as BrowserWorkbenchMouseButton | undefined) ?? 'left';
                payload.onHostActionRequest?.({
                  action: 'mouse-up',
                  x: point.x,
                  y: point.y,
                  button,
                });
                cleanupBrowserWorkbenchPointer(event.currentTarget);
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.currentTarget.dataset.hostSuppressClick === 'true') {
                  delete event.currentTarget.dataset.hostSuppressClick;
                  return;
                }
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                payload.onHostActionRequest?.({
                  action: 'click',
                  x: point.x,
                  y: point.y,
                  button: browserWorkbenchMouseButton(event.button),
                });
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.currentTarget.dataset.hostSuppressDoubleClick === 'true') {
                  delete event.currentTarget.dataset.hostSuppressDoubleClick;
                  return;
                }
                if (event.currentTarget.dataset.hostSuppressClick === 'true') {
                  delete event.currentTarget.dataset.hostSuppressClick;
                  return;
                }
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                payload.onHostActionRequest?.({
                  action: 'double-click',
                  x: point.x,
                  y: point.y,
                  button: browserWorkbenchMouseButton(event.button),
                });
              }}
              onMouseLeave={(event) => {
                if (event.currentTarget.dataset.hostPointerDown === 'true') return;
                payload.onHostActionRequest?.({ action: 'cursor', x: -1, y: -1 });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onWheel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                payload.onHostActionRequest?.({
                  action: 'scroll',
                  x: point.x,
                  y: point.y,
                  deltaX: Math.round(event.deltaX),
                  deltaY: Math.round(event.deltaY),
                });
              }}
              onKeyDown={(event) => {
                const action = browserWorkbenchKeyAction(event);
                event.preventDefault();
                event.stopPropagation();
                if (!action) return;
                payload.onHostActionRequest?.(action);
              }}
              onKeyUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            />
            <textarea
              className="browser-workbench-host-keyboard-input"
              aria-label="Browser keyboard input"
              data-browser-host-keyboard-input="true"
              data-browser-host-keyboard-restore="session-storage"
              ref={restoreBrowserWorkbenchKeyboardFocus}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              tabIndex={-1}
              onCompositionStart={(event) => {
                event.stopPropagation();
                event.currentTarget.dataset.composing = 'true';
              }}
              onCompositionEnd={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.dataset.composing = '';
                sendBrowserWorkbenchInputText(event.currentTarget, payload.onHostActionRequest, event.data);
              }}
              onInput={(event) => {
                event.stopPropagation();
                if (event.currentTarget.dataset.composing === 'true') return;
                sendBrowserWorkbenchInputText(event.currentTarget, payload.onHostActionRequest);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                const action = browserWorkbenchKeyboardPressAction(event);
                if (!action) return;
                event.preventDefault();
                mirrorBrowserWorkbenchSpecialKey(event.currentTarget, event.key);
                payload.onHostActionRequest?.(action);
              }}
              onKeyUp={(event) => {
                event.stopPropagation();
              }}
            />
          </div>
        ) : renderHostBrowser && hostBrowserFrameUrl ? (
          <div
            className="browser-workbench-host-frame"
            data-browser-host-surface={state.hostSurface}
            data-browser-live-surface-ref={hostSession?.liveSurfaceRef}
            data-browser-live-surface-transport={hostSession?.liveSurfaceTransport}
            data-browser-single-interactive-truth={hostSession?.singleInteractiveTruth ? 'true' : undefined}
            data-browser-frame-stream-ref={hostSession?.frameStreamRef}
            data-browser-frame-transport={hostFrameTransport}
            data-browser-host-keyboard-path="hidden-input"
            data-browser-host-keyboard-focus-key={hostKeyboardFocusKey}
            style={{ cursor: hostCursor }}
            onPointerDownCapture={(event) => {
              if (event.button < 0 || event.button > 2) return;
              focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
            }}
            onMouseDownCapture={(event) => {
              if (event.button < 0 || event.button > 2) return;
              focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
            }}
            onClickCapture={(event) => {
              focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
            }}
          >
            <img
              title={title}
              src={hostBrowserFrameUrl}
              alt={title}
              data-browser-host-surface={state.hostSurface}
              data-browser-live-surface-ref={hostSession?.liveSurfaceRef}
              data-browser-frame-state={state.status}
              data-browser-frame-ref={hostSession?.frameRef}
              data-browser-frame-transport={hostFrameTransport}
              tabIndex={0}
              draggable={false}
              role="application"
              aria-label="Browser page"
              style={{ cursor: hostCursor }}
              onFocus={(event) => {
                focusBrowserWorkbenchKeyboardInput(event.currentTarget);
              }}
              onPointerDown={(event) => {
                if (event.button < 0 || event.button > 2) return;
                event.preventDefault();
                event.stopPropagation();
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = browserWorkbenchMouseButton(event.button);
                event.currentTarget.dataset.hostPointerDown = 'true';
                event.currentTarget.dataset.hostPointerButton = button;
                event.currentTarget.dataset.hostPointerStartX = String(point.x);
                event.currentTarget.dataset.hostPointerStartY = String(point.y);
                event.currentTarget.dataset.hostPointerMoveAt = '0';
                event.currentTarget.dataset.hostSuppressClick = 'true';
                event.currentTarget.dataset.hostSuppressDoubleClick = 'true';
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Pointer capture is best-effort; the host still receives the down event.
                }
                payload.onHostActionRequest?.({
                  action: 'mouse-down',
                  x: point.x,
                  y: point.y,
                  button,
                });
              }}
              onPointerMove={(event) => {
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                if (event.currentTarget.dataset.hostPointerDown === 'true') {
                  event.preventDefault();
                  event.stopPropagation();
                  if (browserWorkbenchPointerDistance(event.currentTarget, point) >= 1 && shouldFlushBrowserWorkbenchPointerMove(event.currentTarget)) {
                    payload.onHostActionRequest?.({ action: 'mouse-move', x: point.x, y: point.y });
                  }
                  return;
                }
                payload.onHostActionRequest?.({ action: 'cursor', x: point.x, y: point.y });
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.dataset.hostPointerDown !== 'true') return;
                event.preventDefault();
                event.stopPropagation();
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = (event.currentTarget.dataset.hostPointerButton as BrowserWorkbenchMouseButton | undefined) ?? browserWorkbenchMouseButton(event.button);
                if (browserWorkbenchPointerDistance(event.currentTarget, point) >= 1) {
                  payload.onHostActionRequest?.({ action: 'mouse-move', x: point.x, y: point.y });
                }
                payload.onHostActionRequest?.({
                  action: 'mouse-up',
                  x: point.x,
                  y: point.y,
                  button,
                });
                cleanupBrowserWorkbenchPointer(event.currentTarget);
                try {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                } catch {
                  // The browser may already have released capture after pointerup.
                }
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.dataset.hostPointerDown !== 'true') {
                  payload.onHostActionRequest?.({ action: 'cursor', x: -1, y: -1 });
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = (event.currentTarget.dataset.hostPointerButton as BrowserWorkbenchMouseButton | undefined) ?? browserWorkbenchMouseButton(event.button);
                payload.onHostActionRequest?.({
                  action: 'mouse-up',
                  x: point.x,
                  y: point.y,
                  button,
                });
                cleanupBrowserWorkbenchPointer(event.currentTarget);
              }}
              onLostPointerCapture={(event) => {
                if (event.currentTarget.dataset.hostPointerDown !== 'true') return;
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                const button = (event.currentTarget.dataset.hostPointerButton as BrowserWorkbenchMouseButton | undefined) ?? 'left';
                payload.onHostActionRequest?.({
                  action: 'mouse-up',
                  x: point.x,
                  y: point.y,
                  button,
                });
                cleanupBrowserWorkbenchPointer(event.currentTarget);
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.currentTarget.dataset.hostSuppressClick === 'true') {
                  delete event.currentTarget.dataset.hostSuppressClick;
                  return;
                }
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                payload.onHostActionRequest?.({
                  action: 'click',
                  x: point.x,
                  y: point.y,
                  button: browserWorkbenchMouseButton(event.button),
                });
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.currentTarget.dataset.hostSuppressDoubleClick === 'true') {
                  delete event.currentTarget.dataset.hostSuppressDoubleClick;
                  return;
                }
                if (event.currentTarget.dataset.hostSuppressClick === 'true') {
                  delete event.currentTarget.dataset.hostSuppressClick;
                  return;
                }
                focusBrowserWorkbenchKeyboardInput(event.currentTarget, event);
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                payload.onHostActionRequest?.({
                  action: 'double-click',
                  x: point.x,
                  y: point.y,
                  button: browserWorkbenchMouseButton(event.button),
                });
              }}
              onMouseLeave={(event) => {
                if (event.currentTarget.dataset.hostPointerDown === 'true') return;
                payload.onHostActionRequest?.({ action: 'cursor', x: -1, y: -1 });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onWheel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const point = browserWorkbenchFramePoint(event.currentTarget, event);
                payload.onHostActionRequest?.({
                  action: 'scroll',
                  x: point.x,
                  y: point.y,
                  deltaX: Math.round(event.deltaX),
                  deltaY: Math.round(event.deltaY),
                });
              }}
              onKeyDown={(event) => {
                const action = browserWorkbenchKeyAction(event);
                event.preventDefault();
                event.stopPropagation();
                if (!action) return;
                payload.onHostActionRequest?.(action);
              }}
              onKeyUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            />
            <textarea
              className="browser-workbench-host-keyboard-input"
              aria-label="Browser keyboard input"
              data-browser-host-keyboard-input="true"
              data-browser-host-keyboard-restore="session-storage"
              ref={restoreBrowserWorkbenchKeyboardFocus}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              tabIndex={-1}
              onCompositionStart={(event) => {
                event.stopPropagation();
                event.currentTarget.dataset.composing = 'true';
              }}
              onCompositionEnd={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.dataset.composing = '';
                sendBrowserWorkbenchInputText(event.currentTarget, payload.onHostActionRequest, event.data);
              }}
              onInput={(event) => {
                event.stopPropagation();
                if (event.currentTarget.dataset.composing === 'true') return;
                sendBrowserWorkbenchInputText(event.currentTarget, payload.onHostActionRequest);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                const action = browserWorkbenchKeyboardPressAction(event);
                if (!action) return;
                event.preventDefault();
                mirrorBrowserWorkbenchSpecialKey(event.currentTarget, event.key);
                payload.onHostActionRequest?.(action);
              }}
              onKeyUp={(event) => {
                event.stopPropagation();
              }}
            />
          </div>
        ) : (
          renderBrowserState(state, refs, payload, commands)
        )}
      </section>
      {!renderFrame && snapshot?.textPreview ? (
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
