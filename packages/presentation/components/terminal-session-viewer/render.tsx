import React, { type RefObject } from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export type TerminalMode = 'live' | 'transcript';
export type TerminalSessionStatus = 'empty' | 'running' | 'completed' | 'stopped' | 'error';
type TerminalTheme = 'dark' | 'light' | 'system';

export type TerminalCapabilities = {
  input?: boolean;
  paste?: boolean;
  resize?: boolean;
  copy?: boolean;
  download?: boolean;
  stop?: boolean;
  focus?: boolean;
};

export type HostOwnedTerminalSession = {
  sessionId: string;
  sessionRef?: string;
  terminalSessionId?: string;
  terminalSessionRef?: string;
  cwd?: string;
  rows?: number;
  cols?: number;
  status: TerminalSessionStatus | string;
  exitCode?: number | string | null;
  startedAt?: string;
  completedAt?: string;
  transcriptRef?: string;
  ptyTranscriptRef?: string;
};

export type TerminalSessionAdapter = {
  kind: 'host-owned-terminal-session';
  session: HostOwnedTerminalSession;
  mode?: TerminalMode | string;
  buffer?: unknown;
  transcript?: unknown;
  liveSurfaceRef?: RefObject<HTMLDivElement | null>;
  liveSurfaceLabel?: string;
};

export type TerminalSessionPayload = {
  mode?: TerminalMode | string;
  adapter?: TerminalSessionAdapter;
  hostSession?: HostOwnedTerminalSession;
  session?: HostOwnedTerminalSession;
  sessionRef?: string;
  sessionId?: string;
  terminalSessionRef?: string;
  terminalSessionId?: string;
  status?: TerminalSessionStatus | string;
  buffer?: unknown;
  transcript?: unknown;
  transcriptRef?: string;
  ptyTranscriptRef?: string;
  title?: string;
  capabilities?: TerminalCapabilities;
  theme?: TerminalTheme | string;
  metadata?: Record<string, unknown>;
  cwd?: string;
  rows?: number;
  cols?: number;
  exitCode?: number | string | null;
  startedAt?: string;
  completedAt?: string;
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

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function payloadFromProps(props: UIComponentRendererProps): TerminalSessionPayload {
  const artifactData = recordValue(props.artifact?.data);
  const slotProps = props.slot.props ?? {};
  return { ...artifactData, ...slotProps } as TerminalSessionPayload;
}

function normalizeStatus(value: unknown): TerminalSessionStatus {
  if (value === 'empty' || value === 'idle' || value === 'none' || value === undefined || value === null || value === '') return 'empty';
  if (value === 'running' || value === 'connected' || value === 'active') return 'running';
  if (value === 'completed' || value === 'complete' || value === 'done' || value === 'success' || value === 0) return 'completed';
  if (value === 'error' || value === 'failed' || value === 'failure') return 'error';
  return 'stopped';
}

function normalizeMode(value: unknown): TerminalMode | undefined {
  if (value === 'live' || value === 'transcript') return value;
  if (value === 'buffer' || value === 'static') return 'transcript';
  return undefined;
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
      if (isRecord(item) && typeof item.text === 'string' && isTerminalLineRecord(item)) {
        const sanitized = sanitizeTerminalText(item.text);
        return sanitized.trim().length ? sanitized.split(/\r?\n/) : [];
      }
      return [];
    });
  }
  return [];
}

function isTerminalLineRecord(item: Record<string, unknown>) {
  const classifier = ['kind', 'type', 'role', 'source', 'channel', 'stream']
    .map((key) => stringValue(item[key])?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const blocked = ['agent', 'trace', 'summary', 'environment', 'activity', 'active-result', 'agent-result'];

  return !classifier.some((value) => blocked.some((blockedValue) => value.includes(blockedValue)));
}

function sanitizeTerminalText(value: string) {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function firstScalar(records: Array<Record<string, unknown> | undefined>, keys: string[]) {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = scalarString(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function eventButton(
  label: string,
  event: string,
  action: string,
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
      data-terminal-action={action}
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
  const payloadRecord = payload as Record<string, unknown>;
  const adapter = payload.adapter;
  const adapterRecord = recordValue(adapter);
  const hostSession = payload.hostSession ?? payload.session ?? adapter?.session;
  const hostSessionRecord = recordValue(hostSession);
  const payloadMetadataRecord = recordValue(payload.metadata);
  const artifactMetadataRecord = recordValue(props.artifact?.metadata);
  const status = normalizeStatus(payload.status ?? hostSession?.status);
  const capabilities = normalizeCapabilities(payload.capabilities);
  const surfaceSources = [payloadRecord, hostSessionRecord, adapterRecord, payloadMetadataRecord, artifactMetadataRecord];
  const sessionRef = firstScalar(surfaceSources, ['sessionRef', 'terminalSessionRef'])
    ?? stringValue(props.artifact?.dataRef);
  const sessionId = firstScalar(surfaceSources, ['sessionId', 'terminalSessionId'])
    ?? props.artifact?.id;
  const sessionLabel = sessionRef ?? sessionId;
  const title = payload.title ?? props.slot.title ?? 'Terminal session';
  const liveSurfaceRef = payload.liveSurfaceRef ?? adapter?.liveSurfaceRef;
  const requestedMode = normalizeMode(payload.mode ?? adapter?.mode) ?? (liveSurfaceRef ? 'live' : 'transcript');
  const mode: TerminalMode = requestedMode === 'live' && liveSurfaceRef ? 'live' : 'transcript';
  const lines = mode === 'transcript' ? bufferLines(payload.transcript ?? adapter?.transcript ?? payload.buffer ?? adapter?.buffer) : [];
  const rows = numberValue(payload.rows ?? hostSession?.rows) ?? 24;
  const cols = numberValue(payload.cols ?? hostSession?.cols) ?? 80;
  const theme = payload.theme === 'light' || payload.theme === 'system' ? payload.theme : 'dark';
  const cwd = firstScalar(surfaceSources, ['cwd', 'workingDirectory', 'workingDir']);
  const exitCode = firstScalar(surfaceSources, ['exitCode', 'exit_code']);
  const startedAt = firstScalar(surfaceSources, ['startedAt', 'startedTime', 'startTime', 'started_at']);
  const completedAt = firstScalar(surfaceSources, ['completedAt', 'completedTime', 'finishedAt', 'endedAt', 'completed_at']);
  const transcriptRef = firstScalar(surfaceSources, ['transcriptRef', 'terminalTranscriptRef', 'outputRef']);
  const ptyTranscriptRef = firstScalar(surfaceSources, ['ptyTranscriptRef', 'ptyRef']);
  const surfaceRows = [
    ['Mode', mode],
    ['Session ref', sessionRef],
    ['Session id', sessionId],
    ['CWD', cwd],
    ['Status', status],
    ['Size', `${cols}x${rows}`],
    ['Exit code', exitCode],
    ['Started', startedAt],
    ['Completed', completedAt],
    ['Transcript ref', transcriptRef],
    ['PTY transcript ref', ptyTranscriptRef],
  ].filter(([, value]) => value !== undefined && value !== '') as Array<[string, string]>;
  const selectionText = payload.selection?.text;
  const liveSurfaceLabel = payload.liveSurfaceLabel ?? adapter?.liveSurfaceLabel ?? 'Host-owned live terminal surface';
  const closedForInput = status === 'empty' || status === 'stopped' || status === 'completed' || status === 'error';
  const canInput = capabilities.input && !closedForInput;
  const canPaste = capabilities.paste && !closedForInput;
  const canResize = capabilities.resize && status === 'running';
  const canStop = capabilities.stop && status === 'running';

  return (
    <div
      className={`terminal-session-viewer terminal-session-viewer-${theme}`}
      data-component-id="terminal-session-viewer"
      data-render-boundary="presentation-only"
      data-session-ref={sessionRef}
      data-session-id={sessionId}
      data-status={status}
      data-mode={mode}
      data-requested-mode={requestedMode}
      data-cwd={cwd}
      data-exit-code={exitCode}
      data-started-at={startedAt}
      data-completed-at={completedAt}
      data-transcript-ref={transcriptRef}
      data-pty-transcript-ref={ptyTranscriptRef}
      data-terminal-session-adapter={adapter?.kind}
      data-theme={theme}
    >
      <header className="terminal-session-viewer-header">
        <div>
          <h3>{title}</h3>
          <p>{sessionLabel ? `Terminal session ${sessionLabel}` : 'No terminal session is attached.'}</p>
        </div>
        <span className={`terminal-session-viewer-status terminal-session-viewer-status-${status}`}>
          {status}
        </span>
      </header>
      <div className="terminal-session-viewer-actions" aria-label="Terminal session actions">
        {eventButton('Copy', 'copy-request', 'copy', !capabilities.copy, { 'data-selection': selectionText }, () => payload.onCopyRequest?.(selectionText))}
        {eventButton('Download', 'download-request', 'download', !capabilities.download, { 'data-session-ref': sessionRef }, () => payload.onDownloadRequest?.(sessionRef))}
        {eventButton('Stop', 'stop-request', 'stop', !canStop, { 'data-session-ref': sessionRef }, () => {
          if (canStop) payload.onStopRequest?.(sessionRef);
        })}
        {eventButton('Focus', 'focus-change', 'focus', !capabilities.focus, { 'data-focused': 'true' }, () => payload.onFocusChange?.(true))}
      </div>
      <section
        className="terminal-session-viewer-screen"
        aria-label="Terminal output"
        data-mode={mode}
        data-rows={rows}
        data-cols={cols}
      >
        {mode === 'live' && liveSurfaceRef ? (
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
          if (canInput && input.trim()) payload.onDataInput?.(input);
        }}
      >
        <label>
          Input
          <textarea
            name="terminal-input"
            data-event="data-input"
            data-terminal-event="data-input"
            data-terminal-action="input"
            disabled={!canInput}
            rows={2}
            placeholder="Type input for attached session"
          />
        </label>
        <div className="terminal-session-viewer-input-actions">
          <button
            type="submit"
            data-event="data-input"
            data-terminal-event="data-input"
            data-terminal-action="input"
            disabled={!canInput}
          >
            Send input
          </button>
          {eventButton('Paste', 'paste-input', 'paste', !canPaste, undefined, () => {
            if (canPaste) payload.onPasteInput?.('');
          })}
          {eventButton('Resize', 'resize', 'resize', !canResize, { 'data-cols': cols, 'data-rows': rows }, () => {
            if (canResize) payload.onResize?.({ cols, rows });
          })}
        </div>
      </form>
      {surfaceRows.length ? (
        <dl className="terminal-session-viewer-metadata">
          {surfaceRows.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
