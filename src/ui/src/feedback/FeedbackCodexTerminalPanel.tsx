import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ExternalLink, Loader2, Play, Square, TerminalSquare } from 'lucide-react';
import { renderTerminalSessionViewer } from '../../../../packages/presentation/components/terminal-session-viewer/render';
import {
  feedbackCodexPtyWebSocketUrl,
  startRuntimeServices,
  startFeedbackCodexPtyTerminal,
  stopFeedbackCodexPtyTerminal,
  type FeedbackCodexTerminalSession,
  type FeedbackCodexPtyTerminalStartResult,
} from '../api/workspaceClient';
import type { FeedbackCommentRecord, FeedbackRepairRunRecord, SciForgeConfig } from '../domain';
import { Badge, cx } from '../app/uiPrimitives';
import { DelayedHelpButton } from '../app/DelayedHelpButton';

export interface FeedbackCodexTerminalPanelProps {
  config: SciForgeConfig;
  item: FeedbackCommentRecord;
  providerReady: boolean;
  providerBlocker?: string;
  gitMode?: 'manual' | 'auto';
  onRepairRunWritten?: (run: FeedbackRepairRunRecord) => void;
}

type PtyServerMessage =
  | { type: 'output'; data?: string }
  | { type: 'status'; session?: FeedbackCodexTerminalSession }
  | { type: 'exit'; exitCode?: number; signal?: number; session?: FeedbackCodexTerminalSession }
  | { type: 'error'; message?: string };

export function FeedbackCodexTerminalPanel({
  config,
  item,
  providerReady,
  providerBlocker,
  gitMode = 'manual',
  onRepairRunWritten,
}: FeedbackCodexTerminalPanelProps) {
  const [session, setSession] = useState<FeedbackCodexTerminalSession | undefined>();
  const [inputText, setInputText] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [ptyConnected, setPtyConnected] = useState(false);
  const xtermHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isRunning = session?.status === 'starting' || session?.status === 'running';
  const isPtySession = session?.transport === 'websocket-pty';
  const isSystemTerminalSession = session?.transport === 'system-terminal';
  const canStart = Boolean(!session && !busy);
  const canStop = Boolean(session && isRunning && isPtySession && !busy);
  const canEditInitialPrompt = Boolean(!session && !busy);

  useEffect(() => {
    if (!xtermHostRef.current || xtermRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#07111d',
        foreground: '#d7e7ff',
        cursor: '#22f0bf',
        selectionBackground: '#245d89',
        black: '#03111d',
        red: '#ff6b6b',
        green: '#22f0bf',
        yellow: '#f0c45c',
        blue: '#5aa9ff',
        magenta: '#c084fc',
        cyan: '#52e0ff',
        white: '#d7e7ff',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(xtermHostRef.current);
    fitAddon.fit();
    terminal.writeln('Web repair viewer ready. Start Codex to attach a backend-owned PTY session.');
    const disposable = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const resize = () => {
      fitAddon.fit();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      }
    };
    window.addEventListener('resize', resize);
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    return () => {
      window.removeEventListener('resize', resize);
      disposable.dispose();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  function connectPtySocket(nextSession: FeedbackCodexTerminalSession) {
    const terminal = xtermRef.current;
    if (!terminal) return;
    socketRef.current?.close();
    terminal.reset();
    terminal.writeln('Connecting to Codex PTY...');
    const socket = new WebSocket(feedbackCodexPtyWebSocketUrl(config, nextSession));
    socketRef.current = socket;
    socket.addEventListener('open', () => {
      setPtyConnected(true);
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    });
    socket.addEventListener('close', () => {
      setPtyConnected(false);
    });
    socket.addEventListener('message', (event) => {
      const message = parsePtyServerMessage(event.data);
      if (!message) return;
      if (message.type === 'output') {
        terminal.write(message.data || '');
      }
      if (message.type === 'status' && message.session) {
        setSession(message.session);
      }
      if (message.type === 'exit') {
        if (message.session) setSession(message.session);
        setHint(`Codex PTY exited with code ${message.exitCode ?? 'unknown'}.`);
      }
      if (message.type === 'error') {
        setHint(message.message || 'Codex PTY WebSocket error.');
        terminal.writeln(`\r\n[error] ${message.message || 'Codex PTY WebSocket error.'}`);
      }
    });
  }

  async function startPtyTerminal(launchSurface: 'system-terminal' | 'web-viewer') {
    setBusy(true);
    setHint(launchSurface === 'system-terminal'
      ? '正在打开系统 Terminal 并启动 Codex repair session...'
      : '正在启动 Codex repair Web Viewer...');
    try {
      fitAddonRef.current?.fit();
      const terminal = xtermRef.current;
      const launch = () => startFeedbackCodexPtyTerminal(config, item.id, {
        workspacePath: config.workspacePath,
        initialMessage: inputText.trim() || undefined,
        runtimeProfile: config.runtimeProfile,
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
        gitMode,
        launchSurface,
        cols: terminal?.cols,
        rows: terminal?.rows,
      });
      let result: FeedbackCodexPtyTerminalStartResult;
      try {
        result = await launch();
      } catch (error) {
        if (!isWorkspaceConnectionError(error)) throw error;
        setHint(`Workspace Writer 未连接，正在尝试启动 runtime 服务后重试：${config.workspaceWriterBaseUrl}`);
        const runtime = await startRuntimeServices();
        const summary = runtime.services.map((service) => `${String(service.label ?? service.id)} ${String(service.status ?? 'unknown')}`).join('；');
        if (!runtime.ok) {
          throw new Error(summary || runtime.error || 'Runtime services did not become ready.');
        }
        setHint(summary ? `Runtime 已启动：${summary}。正在重试 Codex repair session...` : 'Runtime 已启动，正在重试 Codex repair session...');
        result = await launch();
      }
      handleStartedSession(result, terminal);
      if (result.repairRun) onRepairRunWritten?.(result.repairRun);
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleStartedSession(result: FeedbackCodexPtyTerminalStartResult, terminal: Terminal | null) {
    setSession(result.session);
    setInputText('');
    if (result.session.transport === 'websocket-pty') {
      setHint('Codex repair session 已启动；Web Viewer 已连接，刷新或切页只会断开这个视图。');
      connectPtySocket(result.session);
      return;
    }
    terminal?.reset();
    terminal?.writeln('System Terminal owns this Codex repair session.');
    terminal?.writeln(result.session.systemTerminalLaunchRef ? `Launch script: ${result.session.systemTerminalLaunchRef}` : 'Launch script is being prepared.');
    terminal?.writeln('Use this Web Viewer only for status and durable log evidence.');
    setHint(result.session.systemTerminalLaunchRef
      ? `系统 Terminal 已打开；launch script: ${result.session.systemTerminalLaunchRef}`
      : '系统 Terminal 启动请求已发送。');
  }

  async function stopTerminal() {
    if (!session) return;
    setBusy(true);
    setHint('正在请求停止后台 Codex repair session...');
    try {
      const next = await stopFeedbackCodexPtyTerminal(config, session.id, {
        workspacePath: session.workspacePath || config.workspacePath,
        reason: 'feedback inbox direct PTY terminal stop',
      });
      setSession(next);
      setHint(next.message || '停止请求已记录。');
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cx('feedback-codex-terminal', session?.status ?? 'idle')} aria-label="Codex repair session viewer">
      <div className="feedback-codex-terminal-head">
        <div>
          <TerminalSquare size={14} aria-hidden />
          <strong>Codex Repair Session</strong>
          <Badge variant={statusBadgeVariant(session?.status)}>{session?.status ?? 'not-started'}</Badge>
          <Badge variant={isPtySession ? 'success' : isSystemTerminalSession ? 'success' : 'muted'}>
            {isPtySession ? 'Web Viewer' : isSystemTerminalSession ? 'System Terminal' : 'viewer ready'}
          </Badge>
          {isPtySession ? <Badge variant={ptyConnected ? 'success' : 'warning'}>{ptyConnected ? 'connected' : 'disconnected'}</Badge> : null}
        </div>
        <div className="feedback-codex-terminal-actions">
          <DelayedHelpButton
            onClick={() => void stopTerminal()}
            disabled={!canStop}
            help={isSystemTerminalSession
              ? '系统 Terminal 拥有进程；请在 Terminal 窗口中中断或继续。'
              : '请求停止后台 Codex repair Web Viewer PTY；不会修改 Git、PR、merge 或旧 repair audit。'}
          >
            <Square size={14} aria-hidden />
            停止
          </DelayedHelpButton>
        </div>
      </div>
      <div className={cx('feedback-codex-terminal-preflight', providerReady ? 'ready' : 'warning')}>
        <span>{providerReady ? 'provider ready' : 'provider diagnostic'}</span>
        <code>{providerReady ? '配置可用；provider 状态只展示，不改变 repair 目标路由。' : providerBlocker || '预检未通过；仍可启动并查看真实 CLI 输出，provider 状态不改变 repair 目标路由。'}</code>
      </div>
      {renderTerminalSessionViewer({
        slot: {
          componentId: 'terminal-session-viewer',
          title: 'Codex Repair Web Viewer',
          props: {
            sessionRef: session?.id ?? `feedback:${item.id}:codex-pty`,
            status: terminalViewerStatus(session?.status, ptyConnected),
            title: 'Codex Repair Web Viewer',
            rows: xtermRef.current?.rows,
            cols: xtermRef.current?.cols,
            theme: 'dark',
            buffer: '',
            liveSurfaceRef: xtermHostRef,
            liveSurfaceLabel: 'Codex repair Web Viewer',
            capabilities: {
              input: false,
              paste: false,
              resize: true,
              copy: false,
              download: false,
              stop: false,
              focus: true,
            },
            metadata: {
              transport: session?.transport ?? 'websocket-pty',
              workspace: config.workspacePath,
              provider: providerReady ? 'ready' : 'diagnostic',
              systemTerminalLaunchRef: session?.systemTerminalLaunchRef,
            },
          },
        },
        artifact: {
          id: session?.id ?? `feedback-${item.id}-codex-pty`,
          type: 'runtime-terminal-session',
          producerScenario: 'feedback-repair-terminal',
          schemaVersion: '0.1.0',
          data: {
            sessionRef: session?.id ?? `feedback:${item.id}:codex-pty`,
            status: terminalViewerStatus(session?.status, ptyConnected),
          },
        },
      })}
      <div className="feedback-codex-terminal-input">
        <span className="feedback-repair-prompt">$</span>
        <textarea
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!session) void startPtyTerminal('system-terminal');
            }
          }}
          disabled={!canEditInitialPrompt}
          placeholder="可选：先写给 Codex 的初始提示，再启动 repair session..."
          aria-label="输入 Codex repair session 初始提示"
        />
        <DelayedHelpButton
          onClick={() => void startPtyTerminal('system-terminal')}
          disabled={!canStart}
          help="生成 feedback prompt、launch script，并在 macOS Terminal 中启动 Codex；推荐用于修复 SciForge UI 或控制面。"
        >
          {busy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <ExternalLink size={14} aria-hidden />}
          打开系统 Terminal
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => void startPtyTerminal('web-viewer')}
          disabled={!canStart}
          help="启动后台 Codex PTY 并把当前 Web Viewer 连接上；刷新或 Vite HMR 只影响这个视图。"
        >
          {busy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <Play size={14} aria-hidden />}
          启动 Web Viewer
        </DelayedHelpButton>
        <span className="feedback-codex-terminal-boundary">
          系统 Terminal 是推荐控制面；Web Viewer 只是 attach，后台 Codex session 和日志证据才是生命线。
          {session?.systemTerminalLaunchRef ? ` Launch: ${session.systemTerminalLaunchRef}` : ''}
        </span>
      </div>
      {session?.message || hint ? (
        <p className="feedback-codex-terminal-hint" role="status">
          {hint || session?.message}
        </p>
      ) : null}
    </section>
  );
}

function parsePtyServerMessage(value: unknown): PtyServerMessage | undefined {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return undefined;
    return parsed as PtyServerMessage;
  } catch {
    return undefined;
  }
}

function statusBadgeVariant(status?: FeedbackCodexTerminalSession['status']) {
  if (status === 'idle') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'running' || status === 'starting') return 'warning';
  return 'muted';
}

function terminalViewerStatus(status: FeedbackCodexTerminalSession['status'] | undefined, connected: boolean) {
  if (connected) return 'connected';
  if (status === 'starting' || status === 'running') return 'running';
  if (status === 'failed' || status === 'cancelled') return 'error';
  if (status === 'idle') return 'stopped';
  return 'idle';
}

function isWorkspaceConnectionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const diagnosticRef = 'diagnosticRef' in error ? String(error.diagnosticRef || '') : '';
  if (diagnosticRef === 'workspace-connection') return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Workspace Writer 未连接') || message.includes('Failed to fetch');
}
