import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import type {
  BrowserRuntimeProjection,
  BrowserRuntimeSession,
  BrowserRuntimeSnapshot,
  BrowserRuntimeTab,
  BrowserRuntimeTraceRef,
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

export interface BrowserWorkbenchPayload {
  projection?: BrowserRuntimeProjection;
  session?: BrowserRuntimeSession;
  activeTab?: BrowserRuntimeTab;
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
  proxyFallbackUrl?: string;
  previewUrl?: string;
  title?: string;
  status?: string;
  notes?: string[];
  addressValue?: string;
  addressPlaceholder?: string;
  onAddressChange?: (value: string) => void;
  onAddressSubmit?: (value: string) => void;
  onCommandRequest?: (command: BrowserWorkbenchCommand) => void;
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

function traceRefsFromPayload(payload: BrowserWorkbenchPayload): BrowserRuntimeTraceRef[] {
  return [
    ...(payload.projection?.traceRefs ?? []),
    ...(payload.traceRefs ?? []),
  ].filter((ref) => Boolean(asRefString(ref.ref)))
    .filter((ref, index, refs) => refs.findIndex((candidate) => candidate.kind === ref.kind && candidate.ref === ref.ref) === index);
}

function commandUrl(payload: BrowserWorkbenchPayload, tab?: BrowserRuntimeTab, snapshot?: BrowserRuntimeSnapshot) {
  return normalizeBrowserWorkbenchUrl(asString(tab?.url) ?? asString(snapshot?.url) ?? asString(payload.previewUrl) ?? 'about:blank');
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
      disabled={command.disabled}
      onClick={() => {
        if (!command.disabled) onCommandRequest?.(command);
      }}
    >
      {command.label}
    </button>
  );
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
    { kind: 'screenshot', ref: asRefString(snapshot?.screenshotRef) ?? '' },
    { kind: 'dom-snapshot', ref: asRefString(snapshot?.domSnapshotRef) ?? '' },
    { kind: 'console-log', ref: asRefString(snapshot?.consoleLogRef) ?? '' },
    { kind: 'network-log', ref: asRefString(snapshot?.networkLogRef) ?? '' },
  ].filter((ref): ref is BrowserRuntimeTraceRef => Boolean(ref.ref));
}

function displayedTraceRefs(snapshot: BrowserRuntimeSnapshot | undefined, traceRefs: BrowserRuntimeTraceRef[]) {
  return [
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

function renderBrowserState(
  state: BrowserWorkbenchState,
  refs: BrowserRuntimeTraceRef[],
  payload: BrowserWorkbenchPayload,
) {
  const externalUrl = safeExternalHref(payload.externalUrl ?? state.url);
  const proxyFallbackUrl = safeIframePreviewUrl(payload.proxyFallbackUrl);
  return (
    <div
      className={`browser-workbench-viewer-state browser-workbench-viewer-state-${state.status}`}
      data-browser-object-type="browser-state"
      data-browser-state={state.status}
      data-browser-state-ref={state.ref}
      role={state.status === 'loading' ? 'status' : undefined}
    >
      <strong>{state.status}</strong>
      {state.reason ? <p>{state.reason}</p> : null}
      <dl>
        {renderStateValue('url', state.url)}
        {renderStateValue('title', state.title)}
        {renderStateValue('detail', state.detail)}
        {renderStateValue('checkedAt', state.checkedAt)}
        {renderStateValue('ref', state.ref)}
      </dl>
      {externalUrl || proxyFallbackUrl ? (
        <div className="browser-workbench-viewer-state-actions" aria-label="Browser fallback actions">
          {externalUrl ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              data-browser-state-action="open-external"
            >
              Open External
            </a>
          ) : null}
          {proxyFallbackUrl ? (
            <a
              href={proxyFallbackUrl}
              target="_blank"
              rel="noreferrer"
              data-browser-state-action="proxy-fallback"
            >
              Proxy Snapshot
            </a>
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

export function renderBrowserWorkbench(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const session = sessionFromPayload(payload);
  const activeTab = activeTabFromPayload(payload, session);
  const snapshot = snapshotFromPayload(payload);
  const traceRefs = traceRefsFromPayload(payload);
  const title = payload.title ?? activeTab?.title ?? snapshot?.title ?? props.slot.title ?? 'Browser workbench';
  const previewUrl = asString(payload.previewUrl);
  const normalizedPreviewUrl = previewUrl ? normalizeBrowserWorkbenchUrl(previewUrl) : undefined;
  const iframePreviewUrl = safeIframePreviewUrl(previewUrl);
  const baseState = browserWorkbenchStateFromPayload(payload, session, activeTab, snapshot, normalizedPreviewUrl);
  const state = normalizedPreviewUrl && !iframePreviewUrl && baseState.status === 'ready'
    ? {
        ...baseState,
        status: 'blocked' as const,
        reason: 'Preview URL scheme is not embeddable by the presentation surface.',
        canRenderFrame: false,
      }
    : baseState;
  const commands = browserWorkbenchCommands(payload, state, activeTab, snapshot);
  const refs = displayedTraceRefs(snapshot, traceRefs);
  const addressValue = payload.addressValue ?? activeTab?.url ?? snapshot?.url ?? previewUrl ?? '';
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  const renderFrame = canRenderIframe(state, iframePreviewUrl);

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
        data-browser-object-type={renderFrame ? 'browser-frame' : 'browser-state'}
        data-browser-state={state.status}
      >
        {renderFrame ? (
          <iframe
            title={title}
            src={iframePreviewUrl}
            data-browser-frame-state={state.status}
            sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation"
          />
        ) : (
          renderBrowserState(state, refs, payload)
        )}
      </section>
      {!renderFrame && snapshot?.textPreview ? (
        <section className="browser-workbench-viewer-refs" aria-label="Browser text preview">
          {snapshot?.textPreview ? <p>{snapshot.textPreview}</p> : null}
        </section>
      ) : null}
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
