import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import * as xtermModule from '@xterm/xterm';
import { renderTerminalSessionViewer, type TerminalSessionAdapter, type TerminalSessionStatus } from '../../../../../packages/presentation/components';
import {
  preflightWorkspaceTerminalWriter,
  startRuntimeServices,
  startWorkspaceTerminalSession,
  stopWorkspaceTerminalSession,
  workspaceTerminalWebSocketUrl,
  type WorkspaceTerminalWriterPreflightResult,
  type WorkspaceTerminalSession,
} from '../../api/workspaceClient';
import type { ObjectReference, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import type { SettingsSectionId } from '../appShell/settingsPageModel';
import { auditExecutionUnitsForRun } from './executionUnitsForRun';
import {
  terminalPtyTranscriptRefForRightPane,
  terminalStatusForRightPane,
  terminalTranscriptForRightPane,
  terminalTranscriptRefForRightPane,
} from './terminalPaneModel';
import { resultText, type ResultLocale } from './resultLocale';
import { Badge } from '../uiPrimitives';

const XTermTerminal = xtermModule.Terminal
  ?? (xtermModule as typeof xtermModule & { default?: typeof xtermModule }).default?.Terminal;
type XTermTerminalInstance = InstanceType<typeof xtermModule.Terminal>;

type TerminalServerMessage =
  | { type: 'output'; data?: string }
  | { type: 'status'; session?: WorkspaceTerminalSession }
  | { type: 'exit'; exitCode?: number; signal?: number; session?: WorkspaceTerminalSession }
  | { type: 'error'; message?: string };

export function RightPaneTerminalTool({
  config,
  session,
  activeRun,
  focusedObjectReference,
  terminalSession,
  locale,
  onConfigChange,
  onOpenSettings,
  onTerminalSessionChange,
}: {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  focusedObjectReference?: ObjectReference;
  terminalSession?: WorkspaceTerminalSession;
  locale?: ResultLocale;
  onConfigChange?: (patch: Partial<SciForgeConfig>) => void;
  onOpenSettings?: (section?: SettingsSectionId) => void;
  onTerminalSessionChange?: (session: WorkspaceTerminalSession | undefined) => void;
}) {
  const allUnits = activeRun ? auditExecutionUnitsForRun(session, activeRun) : session.executionUnits.slice(-6);
  const units = terminalUnitsForFocus(allUnits, session, focusedObjectReference);
  const transcriptBuffer = terminalTranscriptForRightPane(units, locale);
  const transcriptStatus = terminalStatusForRightPane(units, activeRun) as TerminalSessionStatus;
  const transcriptRef = terminalSession?.transcriptRef ?? terminalTranscriptRefForRightPane(units, activeRun);
  const ptyTranscriptRef = terminalSession?.transcriptRef
    ? `pty-transcript:${terminalSession.id}`
    : terminalPtyTranscriptRefForRightPane(units, activeRun);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hint, setHint] = useState('');
  const [writerDiagnostic, setWriterDiagnostic] = useState<WorkspaceTerminalWriterPreflightResult | undefined>();
  const [xtermReady, setXtermReady] = useState(false);
  const xtermHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTermTerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const autoStartRef = useRef(false);
  const status = terminalViewerStatus(terminalSession?.status, connected, transcriptStatus);
  const isRunning = terminalSession?.status === 'starting' || terminalSession?.status === 'running';
  const sessionRef = terminalSession ? `terminal-session:${terminalSession.id}` : 'terminal-session:right-pane-live';
  const sessionId = terminalSession?.id ?? 'right-pane-live';

  useEffect(() => {
    if (terminalSession) return;
    autoStartRef.current = false;
    setWriterDiagnostic(undefined);
  }, [config.workspacePath, config.workspaceWriterBaseUrl, terminalSession?.id]);

  useEffect(() => {
    if (!xtermHostRef.current || xtermRef.current) return;
    const terminal = new XTermTerminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 8000,
      theme: {
        background: '#06101b',
        foreground: '#d7fbe8',
        cursor: '#22f0bf',
        selectionBackground: '#245d89',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(xtermHostRef.current);
    fitAddon.fit();
    terminal.focus();
    terminal.writeln('SciForge terminal ready.');
    const dataDisposable = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const fitAndResize = () => {
      fitAddon.fit();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitAndResize) : undefined;
    if (xtermHostRef.current) resizeObserver?.observe(xtermHostRef.current);
    window.addEventListener('resize', fitAndResize);
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setXtermReady(true);
    return () => {
      window.removeEventListener('resize', fitAndResize);
      resizeObserver?.disconnect();
      dataDisposable.dispose();
      socketRef.current?.close();
      socketRef.current = null;
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      setConnected(false);
      setXtermReady(false);
    };
  }, []);

  useEffect(() => {
    if (!xtermReady || !terminalSession) return;
    connectTerminalSocket(terminalSession);
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [terminalSession?.id, xtermReady]);

  useEffect(() => {
    if (!xtermReady || terminalSession || busy || autoStartRef.current) return;
    autoStartRef.current = true;
    void startShell();
  }, [busy, config.workspacePath, config.workspaceWriterBaseUrl, terminalSession, xtermReady]);

  function connectTerminalSocket(nextSession: WorkspaceTerminalSession) {
    const terminal = xtermRef.current;
    if (!terminal) return;
    socketRef.current?.close();
    terminal.reset();
    terminal.writeln(`Connecting to ${nextSession.cwd}...`);
    const socket = new WebSocket(workspaceTerminalWebSocketUrl(config, nextSession));
    socketRef.current = socket;
    socket.addEventListener('open', () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      terminal.focus();
    });
    socket.addEventListener('close', () => {
      setConnected(false);
    });
    socket.addEventListener('message', (event) => {
      const message = parseTerminalServerMessage(event.data);
      if (!message) return;
      if (message.type === 'output') terminal.write(message.data || '');
      if (message.type === 'status' && message.session) onTerminalSessionChange?.(message.session);
      if (message.type === 'exit') {
        if (message.session) onTerminalSessionChange?.(message.session);
        setHint(`Terminal exited with code ${message.exitCode ?? 'unknown'}.`);
      }
      if (message.type === 'error') {
        const text = message.message || 'Workspace terminal WebSocket error.';
        setHint(text);
        terminal.writeln(`\r\n[error] ${text}`);
      }
    });
  }

  async function startShell() {
    setBusy(true);
    setHint(resultText(locale, { 'zh-CN': '正在启动 workspace terminal...', 'en-US': 'Starting workspace terminal...' }));
    setWriterDiagnostic(undefined);
    try {
      fitAddonRef.current?.fit();
      const terminal = xtermRef.current;
      const preflight = await preflightWorkspaceTerminalWriter(config);
      if (!preflight.ok) {
        setWriterDiagnostic(preflight);
        setHint(preflight.message);
        return;
      }
      const launchConfig = preflight.effectiveBaseUrl && preflight.effectiveBaseUrl !== config.workspaceWriterBaseUrl.replace(/\/+$/, '')
        ? { ...config, workspaceWriterBaseUrl: preflight.effectiveBaseUrl }
        : config;
      const launch = () => startWorkspaceTerminalSession(launchConfig, {
        workspacePath: config.workspacePath,
        cols: terminal?.cols,
        rows: terminal?.rows,
      });
      let result: Awaited<ReturnType<typeof startWorkspaceTerminalSession>>;
      try {
        result = await launch();
      } catch (error) {
        if (!isWorkspaceConnectionError(error)) throw error;
        setHint(`Workspace Writer unavailable; trying to start runtime services for ${config.workspaceWriterBaseUrl}.`);
        const runtime = await startRuntimeServices();
        if (!runtime.ok) {
          const summary = runtime.services.map((service) => `${String(service.label ?? service.id)} ${String(service.status ?? 'unknown')}`).join('; ');
          throw new Error(summary || runtime.error || 'Runtime services did not become ready.');
        }
        result = await launch();
      }
      const nextSession = { ...result.session, workspaceWriterBaseUrl: launchConfig.workspaceWriterBaseUrl };
      onTerminalSessionChange?.(nextSession);
      setHint(nextSession.message || 'Workspace terminal started.');
      connectTerminalSocket(nextSession);
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopShell() {
    if (!terminalSession) return;
    setBusy(true);
    setHint('Stopping workspace terminal...');
    try {
      const stopConfig = terminalSession.workspaceWriterBaseUrl
        ? { ...config, workspaceWriterBaseUrl: terminalSession.workspaceWriterBaseUrl }
        : config;
      const next = await stopWorkspaceTerminalSession(stopConfig, terminalSession.id, {
        workspacePath: terminalSession.workspacePath || config.workspacePath,
        reason: 'right pane terminal stop',
      });
      onTerminalSessionChange?.(next);
      socketRef.current?.close();
      socketRef.current = null;
      setHint(next.message || 'Workspace terminal stopped.');
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function startRuntimeServicesAndRetry() {
    setBusy(true);
    setHint(`Starting runtime services for ${config.workspaceWriterBaseUrl}...`);
    try {
      const runtime = await startRuntimeServices();
      if (!runtime.ok) {
        const summary = runtime.services.map((service) => `${String(service.label ?? service.id)} ${String(service.status ?? 'unknown')}`).join('; ');
        throw new Error(summary || runtime.error || 'Runtime services did not become ready.');
      }
      setWriterDiagnostic(undefined);
      autoStartRef.current = true;
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setBusy(false);
    }
    await startShell();
  }

  function useWorkspaceWriterCandidate(baseUrl: string) {
    setWriterDiagnostic(undefined);
    setHint(`Switching Workspace Writer to ${baseUrl}...`);
    autoStartRef.current = false;
    onConfigChange?.({ workspaceWriterBaseUrl: baseUrl });
  }

  const terminalAdapter: TerminalSessionAdapter = {
    kind: 'host-owned-terminal-session',
    mode: 'live',
    session: {
      sessionRef,
      sessionId,
      cwd: terminalSession?.cwd ?? config.workspacePath,
      status,
      rows: xtermRef.current?.rows ?? 28,
      cols: xtermRef.current?.cols ?? 110,
      startedAt: terminalSession?.startedAt,
      completedAt: terminalSession && (terminalSession.status === 'idle' || terminalSession.status === 'failed' || terminalSession.status === 'cancelled')
        ? terminalSession.updatedAt
        : undefined,
      transcriptRef,
      ptyTranscriptRef,
    },
    liveSurfaceRef: xtermHostRef,
    liveSurfaceLabel: 'SciForge workspace terminal',
  };

  return (
    <div
      className="right-pane-package-surface right-pane-terminal-surface right-pane-terminal-live"
      data-testid="right-pane-terminal-tool"
      data-terminal-live-pty-exception="host-owned-workspace-writer"
      data-terminal-session-id={terminalSession?.id}
      data-terminal-connected={connected ? 'true' : 'false'}
    >
      <div className="right-pane-terminal-toolbar">
        <div>
          <strong>{resultText(locale, { 'zh-CN': 'Terminal', 'en-US': 'Terminal' })}</strong>
          <Badge variant={status === 'error' ? 'danger' : status === 'running' ? 'warning' : 'muted'}>{status}</Badge>
          {connected ? <Badge variant="success">connected</Badge> : null}
        </div>
        <div>
          <button type="button" onClick={() => void startShell()} disabled={busy || isRunning}>
            {terminalSession ? resultText(locale, { 'zh-CN': '新终端', 'en-US': 'New shell' }) : resultText(locale, { 'zh-CN': '启动', 'en-US': 'Start' })}
          </button>
          <button type="button" onClick={() => void stopShell()} disabled={busy || !terminalSession || !isRunning}>
            {resultText(locale, { 'zh-CN': '停止', 'en-US': 'Stop' })}
          </button>
          <button type="button" onClick={() => copyText(transcriptRef)} disabled={!transcriptRef}>
            {resultText(locale, { 'zh-CN': '复制 transcript ref', 'en-US': 'Copy transcript ref' })}
          </button>
        </div>
      </div>
      {writerDiagnostic ? (
        <div
          className="right-pane-terminal-writer-diagnostic"
          role="status"
          data-terminal-writer-diagnostic={writerDiagnostic.status}
          data-terminal-writer-configured-url={writerDiagnostic.configuredDisplayUrl}
          data-terminal-writer-recommended-url={writerDiagnostic.recommendedDisplayUrl}
        >
          <div>
            <strong>{resultText(locale, { 'zh-CN': 'Workspace Writer 需要修复', 'en-US': 'Workspace Writer needs attention' })}</strong>
            <span>{writerDiagnostic.message}</span>
          </div>
          <dl>
            <div>
              <dt>{resultText(locale, { 'zh-CN': '当前 URL', 'en-US': 'Current URL' })}</dt>
              <dd>{writerDiagnostic.configuredDisplayUrl || 'unknown'}</dd>
            </div>
            <div>
              <dt>{resultText(locale, { 'zh-CN': '问题', 'en-US': 'Issue' })}</dt>
              <dd>{writerDiagnostic.status}</dd>
            </div>
            {writerDiagnostic.recommendedDisplayUrl ? (
              <div>
                <dt>{resultText(locale, { 'zh-CN': '推荐', 'en-US': 'Recommended' })}</dt>
                <dd>{writerDiagnostic.recommendedDisplayUrl}</dd>
              </div>
            ) : null}
          </dl>
          <div className="right-pane-terminal-writer-actions">
            <button type="button" onClick={() => void startShell()} disabled={busy}>
              {resultText(locale, { 'zh-CN': '重新检查', 'en-US': 'Recheck' })}
            </button>
            <button type="button" onClick={() => void startRuntimeServicesAndRetry()} disabled={busy}>
              {resultText(locale, { 'zh-CN': '启动服务', 'en-US': 'Start services' })}
            </button>
            {writerDiagnostic.candidates.filter((candidate) => candidate.ok).map((candidate) => (
              <button
                key={candidate.baseUrl}
                type="button"
                onClick={() => useWorkspaceWriterCandidate(candidate.baseUrl)}
                disabled={busy || !onConfigChange}
                title={candidate.displayUrl}
              >
                {resultText(locale, { 'zh-CN': `使用 ${candidate.label}`, 'en-US': `Use ${candidate.label}` })}
              </button>
            ))}
            <button type="button" onClick={() => onOpenSettings?.('workspace')} disabled={!onOpenSettings}>
              {resultText(locale, { 'zh-CN': '打开设置', 'en-US': 'Open Settings' })}
            </button>
          </div>
        </div>
      ) : null}
      {renderTerminalSessionViewer({
        slot: {
          componentId: 'terminal-session-viewer',
          title: resultText(locale, { 'zh-CN': 'Workspace Terminal', 'en-US': 'Workspace Terminal' }),
          props: {
            mode: 'live',
            adapter: terminalAdapter,
            sessionRef,
            sessionId,
            title: resultText(locale, { 'zh-CN': 'Workspace Terminal', 'en-US': 'Workspace Terminal' }),
            status,
            rows: xtermRef.current?.rows ?? 28,
            cols: xtermRef.current?.cols ?? 110,
            liveSurfaceRef: xtermHostRef,
            liveSurfaceLabel: 'SciForge workspace terminal',
            transcriptRef,
            ptyTranscriptRef,
            capabilities: { input: isRunning, paste: isRunning, resize: true, copy: true, download: false, stop: isRunning, focus: true },
            metadata: {
              surface: 'right-pane',
              mode: 'live-pty',
              owner: 'workspace-writer',
              workspace: config.workspacePath,
              cwd: terminalSession?.cwd ?? config.workspacePath,
              focusedRef: focusedObjectReference?.ref,
              transcriptSource: transcriptBuffer ? 'execution-units' : 'live-session',
            },
            onDataInput: (input: string) => sendTerminalInput(socketRef.current, input),
            onPasteInput: (input: string) => sendTerminalInput(socketRef.current, input),
            onResize: () => {
              fitAddonRef.current?.fit();
              const terminal = xtermRef.current;
              const socket = socketRef.current;
              if (terminal && socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
              }
            },
            onCopyRequest: () => copyText(transcriptRef),
            onStopRequest: () => void stopShell(),
            onFocusChange: (focused: boolean) => {
              if (focused) xtermRef.current?.focus();
            },
          },
        },
        artifact: {
          id: terminalSession?.id ?? 'right-pane-workspace-terminal',
          type: 'runtime-terminal-session',
          producerScenario: 'right-pane-terminal',
          schemaVersion: 'sciforge.terminal-session.v1',
          data: { status, transcriptRef, ptyTranscriptRef },
        },
        session,
      })}
      <details className="right-pane-terminal-transcript-preview">
        <summary>{resultText(locale, { 'zh-CN': 'Execution refs', 'en-US': 'Execution refs' })}</summary>
        {transcriptBuffer ? <pre>{transcriptBuffer}</pre> : <p>{resultText(locale, { 'zh-CN': '尚无 execution-unit transcript；live shell 输出保存在 transcript ref。', 'en-US': 'No execution-unit transcript yet; live shell output is mirrored behind the transcript ref.' })}</p>}
      </details>
      {hint ? <p className="right-pane-terminal-hint" role="status">{hint}</p> : null}
    </div>
  );
}

function terminalUnitsForFocus(
  units: ReturnType<typeof auditExecutionUnitsForRun>,
  session: SciForgeSession,
  focusedObjectReference?: ObjectReference,
) {
  const ref = focusedObjectReference?.ref?.trim();
  if (!ref) return units;
  const executionUnitId = /^(?:execution-unit:|EU-)(.+)$/i.exec(ref)?.[1];
  const allUnits = [...units, ...session.executionUnits];
  const target = allUnits.find((unit) => (
    unit.id === executionUnitId
    || unit.stdoutRef === ref
    || unit.stderrRef === ref
    || unit.outputRef === ref
    || (unit.hash && (`pty-transcript:${unit.hash}` === ref || `terminal-transcript:${unit.hash}` === ref))
  ));
  return target ? [target] : units;
}

function terminalViewerStatus(status: WorkspaceTerminalSession['status'] | undefined, connected: boolean, fallback: TerminalSessionStatus): TerminalSessionStatus {
  if (connected) return 'running';
  if (status === 'starting' || status === 'running') return 'running';
  if (status === 'failed' || status === 'cancelled') return 'error';
  if (status === 'idle') return 'stopped';
  return fallback;
}

function parseTerminalServerMessage(value: unknown): TerminalServerMessage | undefined {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return undefined;
    return parsed as TerminalServerMessage;
  } catch {
    return undefined;
  }
}

function isWorkspaceConnectionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const diagnosticRef = 'diagnosticRef' in error ? String(error.diagnosticRef || '') : '';
  if (diagnosticRef === 'workspace-connection') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Workspace Writer 未连接') || message.includes('Failed to fetch');
}

function copyText(text: string | undefined) {
  if (!text || typeof navigator === 'undefined') return;
  void navigator.clipboard?.writeText(text);
}

function sendTerminalInput(socket: WebSocket | null, input: string) {
  if (!input || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'input', data: input.endsWith('\n') ? input : `${input}\n` }));
}
