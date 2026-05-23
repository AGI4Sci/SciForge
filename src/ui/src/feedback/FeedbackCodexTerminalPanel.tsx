import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Loader2, Play, Square, TerminalSquare } from 'lucide-react';
import { renderTerminalSessionViewer } from '../../../../packages/presentation/components/terminal-session-viewer/render';
import {
  feedbackCodexPtyWebSocketUrl,
  startFeedbackCodexPtyTerminal,
  stopFeedbackCodexPtyTerminal,
  type FeedbackCodexTerminalSession,
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
  const canStart = Boolean(!session && !busy);
  const canStop = Boolean(session && isRunning && !busy);
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
    terminal.writeln('WebSocket PTY ready. Start Codex to attach this terminal.');
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

  async function startPtyTerminal() {
    setBusy(true);
    setHint('正在启动 Codex CLI PTY...');
    try {
      fitAddonRef.current?.fit();
      const terminal = xtermRef.current;
      const result = await startFeedbackCodexPtyTerminal(config, item.id, {
        workspacePath: config.workspacePath,
        initialMessage: inputText.trim() || undefined,
        runtimeProfile: config.runtimeProfile,
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
        gitMode,
        cols: terminal?.cols,
        rows: terminal?.rows,
      });
      setSession(result.session);
      setInputText('');
      setHint('Codex PTY 已启动，可以直接在终端里交互。');
      connectPtySocket(result.session);
      if (result.repairRun) onRepairRunWritten?.(result.repairRun);
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopTerminal() {
    if (!session) return;
    setBusy(true);
    setHint('正在停止 Codex PTY...');
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
    <section className={cx('feedback-codex-terminal', session?.status ?? 'idle')} aria-label="Direct Codex Terminal">
      <div className="feedback-codex-terminal-head">
        <div>
          <TerminalSquare size={14} aria-hidden />
          <strong>Codex 修复终端</strong>
          <Badge variant={statusBadgeVariant(session?.status)}>{session?.status ?? 'not-started'}</Badge>
          <Badge variant={isPtySession ? 'success' : 'muted'}>{isPtySession ? 'WebSocket PTY' : 'xterm ready'}</Badge>
          {isPtySession ? <Badge variant={ptyConnected ? 'success' : 'warning'}>{ptyConnected ? 'connected' : 'disconnected'}</Badge> : null}
        </div>
        <div className="feedback-codex-terminal-actions">
          <DelayedHelpButton
            onClick={() => void stopTerminal()}
            disabled={!canStop}
            help="停止当前 Direct Codex Terminal；不会修改 Git、PR、merge 或旧 repair audit。"
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
          title: 'Direct Codex PTY',
          props: {
            sessionRef: session?.id ?? `feedback:${item.id}:codex-pty`,
            status: terminalViewerStatus(session?.status, ptyConnected),
            title: 'Direct Codex PTY',
            rows: xtermRef.current?.rows,
            cols: xtermRef.current?.cols,
            theme: 'dark',
            buffer: '',
            liveSurfaceRef: xtermHostRef,
            liveSurfaceLabel: 'Direct Codex PTY terminal',
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
              transport: 'websocket-pty',
              workspace: config.workspacePath,
              provider: providerReady ? 'ready' : 'diagnostic',
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
              if (!session) void startPtyTerminal();
            }
          }}
          disabled={!canEditInitialPrompt}
          placeholder="可选：先写给 Codex 的初始提示，再启动..."
          aria-label="输入 Direct Codex Terminal 初始提示"
        />
        <DelayedHelpButton
          onClick={() => void startPtyTerminal()}
          disabled={!canStart}
          help="生成 feedback prompt 并启动 Codex CLI WebSocket PTY；启动后直接在终端内输入。"
        >
          {busy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <Play size={14} aria-hidden />}
          启动 Codex
        </DelayedHelpButton>
        <span className="feedback-codex-terminal-boundary">
          Direct Codex CLI；Git commit/push/PR/merge 保留分级确认，merge 不静默。
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
