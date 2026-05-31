import React, { type RefObject } from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

type TerminalStatus = 'connected' | 'running' | 'stopped' | 'error' | 'idle' | 'unknown';
type TerminalTheme = 'dark' | 'light' | 'system';

type TerminalCapabilities = {
  input?: boolean;
  paste?: boolean;
  resize?: boolean;
  copy?: boolean;
  download?: boolean;
  stop?: boolean;
  focus?: boolean;
};

type TerminalSessionPayload = {
  sessionRef?: string;
  sessionId?: string;
  status?: TerminalStatus | string;
  buffer?: unknown;
  title?: string;
  capabilities?: TerminalCapabilities;
  theme?: TerminalTheme | string;
  metadata?: Record<string, unknown>;
  rows?: number;
  cols?: number;
  selection?: { text?: string; range?: string };
  onDataInput?: (input: string) => void;
  onPasteInput?: (input: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
  onCopyRequest?: (selection?: string) => void;
  onDownloadRequest?: (sessionRef?: string) => void;
  onStopRequest?: (sessionRef?: string) => void;
  onFocusChange?: (focused: boolean) => void;
  liveSurfaceRef?: RefObject<HTMLDivElement | null>;
  liveSurfaceLabel?: string;
};

const defaultCapabilities: Required<TerminalCapabilities> = {
  input: true,
  paste: true,
  resize: true,
  copy: true,
  download: true,
  stop: true,
  focus: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function payloadFromProps(props: UIComponentRendererProps): TerminalSessionPayload {
  const artifactData = recordValue(props.artifact?.data);
  const slotProps = props.slot.props ?? {};
  return { ...artifactData, ...slotProps } as TerminalSessionPayload;
}

function normalizeStatus(value: unknown): TerminalStatus {
  if (value === 'connected' || value === 'running' || value === 'stopped' || value === 'error' || value === 'idle') return value;
  return value ? 'unknown' : 'idle';
}

function normalizeCapabilities(value: unknown): Required<TerminalCapabilities> {
  const record = recordValue(value) ?? {};
  return {
    input: record.input !== false,
    paste: record.paste !== false,
    resize: record.resize !== false,
    copy: record.copy !== false,
    download: record.download !== false,
    stop: record.stop !== false,
    focus: record.focus !== false,
  };
}

function bufferLines(value: unknown): string[] {
  if (typeof value === 'string') {
    const sanitized = sanitizeTerminalText(value);
    return sanitized.trim().length ? sanitized.split(/\r?\n/) : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') {
        const sanitized = sanitizeTerminalText(item);
        return sanitized.trim().length ? sanitized.split(/\r?\n/) : [];
      }
      if (isRecord(item) && typeof item.text === 'string') {
        const sanitized = sanitizeTerminalText(item.text);
        return sanitized.trim().length ? sanitized.split(/\r?\n/) : [];
      }
      return [];
    });
  }
  return [];
}

function sanitizeTerminalText(value: string) {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function metadataRows(metadata: unknown) {
  return Object.entries(recordValue(metadata) ?? {})
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'function')
    .slice(0, 6)
    .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)] as const);
}

function eventButton(
  label: string,
  event: string,
  disabled?: boolean,
  data?: Record<string, string | number | undefined>,
  onClick?: () => void,
) {
  return (
    <button
      key={event}
      type="button"
      data-event={event}
      data-terminal-event={event}
      disabled={disabled}
      onClick={onClick}
      {...data}
    >
      {label}
    </button>
  );
}

export function renderTerminalSessionViewer(props: UIComponentRendererProps) {
  const payload = payloadFromProps(props);
  const status = normalizeStatus(payload.status);
  const capabilities = normalizeCapabilities(payload.capabilities);
  const sessionRef = payload.sessionRef ?? payload.sessionId ?? stringValue(props.artifact?.dataRef) ?? props.artifact?.id;
  const title = payload.title ?? props.slot.title ?? 'Terminal session';
  const lines = bufferLines(payload.buffer);
  const rows = numberValue(payload.rows) ?? 24;
  const cols = numberValue(payload.cols) ?? 80;
  const theme = payload.theme === 'light' || payload.theme === 'system' ? payload.theme : 'dark';
  const metadata = metadataRows(payload.metadata ?? props.artifact?.metadata);
  const selectionText = payload.selection?.text;
  const liveSurfaceRef = payload.liveSurfaceRef;
  const liveSurfaceLabel = payload.liveSurfaceLabel ?? 'Host-owned live terminal surface';
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;

  return (
    <div
      className={`terminal-session-viewer terminal-session-viewer-${theme}`}
      data-component-id="terminal-session-viewer"
      data-render-boundary="presentation-only"
      data-session-ref={sessionRef}
      data-status={status}
      data-theme={theme}
    >
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={props.artifact} /> : null}
      <header className="terminal-session-viewer-header">
        <div>
          <h3>{title}</h3>
          <p>{sessionRef ? `Session ${sessionRef}` : 'No terminal session is attached.'}</p>
        </div>
        <span className={`terminal-session-viewer-status terminal-session-viewer-status-${status}`}>
          {status}
        </span>
      </header>
      <div className="terminal-session-viewer-actions" aria-label="Terminal session actions">
        {eventButton('Copy', 'copy-request', !capabilities.copy, { 'data-selection': selectionText }, () => payload.onCopyRequest?.(selectionText))}
        {eventButton('Download', 'download-request', !capabilities.download, { 'data-session-ref': sessionRef }, () => payload.onDownloadRequest?.(sessionRef))}
        {eventButton('Stop', 'stop-request', !capabilities.stop || status === 'stopped', { 'data-session-ref': sessionRef }, () => payload.onStopRequest?.(sessionRef))}
        {eventButton('Focus', 'focus-change', !capabilities.focus, { 'data-focused': 'true' }, () => payload.onFocusChange?.(true))}
      </div>
      <section
        className="terminal-session-viewer-screen"
        aria-label="Terminal output"
        data-rows={rows}
        data-cols={cols}
      >
        {liveSurfaceRef ? (
          <div
            ref={liveSurfaceRef}
            className="terminal-session-viewer-live-surface"
            aria-label={liveSurfaceLabel}
            data-terminal-live-surface="host-owned"
          />
        ) : lines.length ? (
          <pre>
            {lines.map((line, index) => (
              <span className="terminal-session-viewer-line" data-line-number={index + 1} key={index}>
                {line || ' '}
                {'\n'}
              </span>
            ))}
          </pre>
        ) : ComponentEmptyState ? (
          <ComponentEmptyState
            componentId="terminal-session-viewer"
            artifactType={props.artifact?.type ?? 'terminal-session'}
            detail="Terminal buffer is empty. The host must attach an existing session before live output appears."
          />
        ) : (
          <p>Terminal buffer is empty. Waiting for host-provided output.</p>
        )}
      </section>
      <form
        className="terminal-session-viewer-input"
        data-terminal-form="presentation-only"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const input = String(data.get('terminal-input') ?? '');
          if (input.trim()) payload.onDataInput?.(input);
        }}
      >
        <label>
          Input
          <textarea
            name="terminal-input"
            data-event="data-input"
            data-terminal-event="data-input"
            disabled={!capabilities.input || status === 'stopped'}
            rows={2}
            placeholder="Type input for attached session"
          />
        </label>
        <div className="terminal-session-viewer-input-actions">
          <button
            type="submit"
            data-event="data-input"
            data-terminal-event="data-input"
            disabled={!capabilities.input || status === 'stopped'}
          >
            Send input
          </button>
          {eventButton('Paste', 'paste-input', !capabilities.paste || status === 'stopped', undefined, () => payload.onPasteInput?.(''))}
          {eventButton('Resize', 'resize', !capabilities.resize, { 'data-cols': cols, 'data-rows': rows }, () => payload.onResize?.({ cols, rows }))}
        </div>
      </form>
      {metadata.length ? (
        <dl className="terminal-session-viewer-metadata">
          {metadata.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      <script type="application/json" data-terminal-callback-props>
        {JSON.stringify([
          'onDataInput',
          'onPasteInput',
          'onResize',
          'onCopyRequest',
          'onDownloadRequest',
          'onStopRequest',
          'onFocusChange',
        ])}
      </script>
    </div>
  );
}
