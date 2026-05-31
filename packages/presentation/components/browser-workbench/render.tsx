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
  label: string;
  command: string;
  risk?: 'allowed' | 'needs-approval';
}

export interface BrowserWorkbenchPayload {
  projection?: BrowserRuntimeProjection;
  session?: BrowserRuntimeSession;
  activeTab?: BrowserRuntimeTab;
  snapshot?: BrowserRuntimeSnapshot;
  traceRefs?: BrowserRuntimeTraceRef[];
  commands?: BrowserWorkbenchCommand[];
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

export function normalizeBrowserWorkbenchUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^about:blank$/i.test(trimmed)) return 'about:blank';
  if (/about:blank$/i.test(trimmed)) return normalizeBrowserWorkbenchUrl(trimmed.slice(0, -'about:blank'.length));
  if (trimmed.startsWith('/')) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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
  ].filter((ref, index, refs) => refs.findIndex((candidate) => candidate.kind === ref.kind && candidate.ref === ref.ref) === index);
}

function commandUrl(payload: BrowserWorkbenchPayload, tab?: BrowserRuntimeTab, snapshot?: BrowserRuntimeSnapshot) {
  return normalizeBrowserWorkbenchUrl(asString(tab?.url) ?? asString(snapshot?.url) ?? asString(payload.previewUrl) ?? 'about:blank');
}

export function browserWorkbenchDefaultCommands(url: string): BrowserWorkbenchCommand[] {
  const normalizedUrl = normalizeBrowserWorkbenchUrl(url);
  const quotedUrl = JSON.stringify(normalizedUrl);
  return [
    { label: 'Open', command: `/browser open ${quotedUrl} --surface workbench`, risk: 'allowed' },
    { label: 'Snapshot', command: `/browser snapshot --url ${quotedUrl} --screenshot --dom --logs`, risk: 'allowed' },
    { label: 'State', command: `/browser state --url ${quotedUrl} --dom --ax --console --network`, risk: 'allowed' },
    { label: 'Takeover', command: `/browser takeover --url ${quotedUrl} --approval required`, risk: 'needs-approval' },
  ];
}

function browserWorkbenchCommands(payload: BrowserWorkbenchPayload, tab?: BrowserRuntimeTab, snapshot?: BrowserRuntimeSnapshot) {
  return payload.commands?.length ? payload.commands : browserWorkbenchDefaultCommands(commandUrl(payload, tab, snapshot));
}

function statusLabel(payload: BrowserWorkbenchPayload, session?: BrowserRuntimeSession, tab?: BrowserRuntimeTab) {
  return payload.status ?? tab?.status ?? (session ? 'ready' : 'idle');
}

function renderCommandButton(command: BrowserWorkbenchCommand, onCommandRequest?: (command: BrowserWorkbenchCommand) => void) {
  return (
    <button
      key={`${command.label}:${command.command}`}
      type="button"
      data-event="browser-command-request"
      data-browser-command={command.command}
      data-browser-risk={command.risk ?? 'allowed'}
      onClick={() => onCommandRequest?.(command)}
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

export function renderBrowserWorkbench(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const session = sessionFromPayload(payload);
  const activeTab = activeTabFromPayload(payload, session);
  const snapshot = snapshotFromPayload(payload);
  const traceRefs = traceRefsFromPayload(payload);
  const commands = browserWorkbenchCommands(payload, activeTab, snapshot);
  const title = payload.title ?? activeTab?.title ?? snapshot?.title ?? props.slot.title ?? 'Browser workbench';
  const previewUrl = asString(payload.previewUrl);
  const iframePreviewUrl = previewUrl ? normalizeBrowserWorkbenchUrl(previewUrl) : undefined;
  const addressValue = payload.addressValue ?? activeTab?.url ?? snapshot?.url ?? previewUrl ?? '';
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;

  return (
    <div
      className="browser-workbench-viewer"
      data-component-id="browser-workbench"
      data-render-boundary="presentation-only"
      data-session-ref={session?.id}
      data-status={statusLabel(payload, session, activeTab)}
    >
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={props.artifact} /> : null}
      <header className="browser-workbench-viewer-header">
        <div>
          <h3>{title}</h3>
          <p>{activeTab?.url ?? snapshot?.url ?? 'No browser tab is attached.'}</p>
        </div>
        <span className="browser-workbench-viewer-status">{statusLabel(payload, session, activeTab)}</span>
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
      {iframePreviewUrl ? (
        <section className="browser-workbench-viewer-preview" aria-label="Browser preview">
          <iframe
            title={title}
            src={iframePreviewUrl}
            sandbox="allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation"
          />
        </section>
      ) : snapshot || traceRefs.length ? (
        <section className="browser-workbench-viewer-refs" aria-label="Browser refs">
          {snapshot?.textPreview ? <p>{snapshot.textPreview}</p> : null}
          <ul>
            {snapshot?.screenshotRef ? renderRef({ kind: 'screenshot', ref: snapshot.screenshotRef }, payload.onCopyRefRequest) : null}
            {snapshot?.domSnapshotRef ? renderRef({ kind: 'dom-snapshot', ref: snapshot.domSnapshotRef }, payload.onCopyRefRequest) : null}
            {snapshot?.consoleLogRef ? renderRef({ kind: 'console-log', ref: snapshot.consoleLogRef }, payload.onCopyRefRequest) : null}
            {snapshot?.networkLogRef ? renderRef({ kind: 'network-log', ref: snapshot.networkLogRef }, payload.onCopyRefRequest) : null}
            {traceRefs.map((ref) => renderRef(ref, payload.onCopyRefRequest))}
          </ul>
        </section>
      ) : ComponentEmptyState ? (
        <ComponentEmptyState
          componentId="browser-workbench"
          artifactType={props.artifact?.type ?? 'browser-runtime-projection'}
          detail="Attach a browser_runtime projection before rendering tabs, snapshots, or refs."
        />
      ) : (
        <p>Attach a browser_runtime projection before rendering tabs, snapshots, or refs.</p>
      )}
      <section className="browser-workbench-viewer-command-list" aria-label="Terminal-equivalent browser commands">
        {commands.map((command) => (
          <code key={`${command.label}:code`}>{command.command}</code>
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
