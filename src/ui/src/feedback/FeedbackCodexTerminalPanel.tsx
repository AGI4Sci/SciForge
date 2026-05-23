import { useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Loader2, Play, Send, Square, TerminalSquare } from 'lucide-react';
import {
  feedbackCodexPtyWebSocketUrl,
  loadFeedbackCodexTerminalTail,
  sendFeedbackCodexTerminalInput,
  startFeedbackCodexPtyTerminal,
  startFeedbackCodexTerminal,
  stopFeedbackCodexPtyTerminal,
  stopFeedbackCodexTerminal,
  type FeedbackCodexTerminalSession,
  type FeedbackRepairTerminalMirrorEntry,
} from '../api/workspaceClient';
import type { FeedbackCommentRecord, FeedbackRepairRunRecord, SciForgeConfig } from '../domain';
import { Badge, cx } from '../app/uiPrimitives';
import { DelayedHelpButton } from '../app/DelayedHelpButton';

export interface FeedbackCodexTerminalPanelProps {
  config: SciForgeConfig;
  item: FeedbackCommentRecord;
  providerReady: boolean;
  providerBlocker?: string;
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
  onRepairRunWritten,
}: FeedbackCodexTerminalPanelProps) {
  const [session, setSession] = useState<FeedbackCodexTerminalSession | undefined>();
  const [entries, setEntries] = useState<FeedbackRepairTerminalMirrorEntry[]>([]);
  const [inputText, setInputText] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [tailError, setTailError] = useState('');
  const [ptyConnected, setPtyConnected] = useState(false);
  const xtermHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isRunning = session?.status === 'starting' || session?.status === 'running';
  const isPtySession = session?.transport === 'websocket-pty';
  const isHttpWriterSession = session?.transport === 'http-writer';
  const canSend = Boolean(isHttpWriterSession && inputText.trim() && !isRunning && !busy);
  const canStart = Boolean(!session && !busy);
  const canStop = Boolean(session && isRunning && !busy);
  const visibleEntries = useMemo(() => entries.slice(-180), [entries]);

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

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      if (!session?.id || session.transport === 'websocket-pty') return;
      try {
        const result = await loadFeedbackCodexTerminalTail(config, session.id, {
          workspacePath: session.workspacePath || config.workspacePath,
          cursor: 0,
          limit: 500,
        });
        if (cancelled) return;
        setTailError('');
        setEntries(result.tail.entries);
        if (result.session) setSession(result.session);
      } catch (error) {
        if (!cancelled) setTailError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled && session?.id) {
          timer = window.setTimeout(poll, isRunning ? 1400 : 4500);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [config, config.workspacePath, session?.id, session?.workspacePath, session?.transport, isRunning]);

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
        gitMode: 'manual',
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

  async function startHttpWriterTerminal() {
    setBusy(true);
    setHint('正在启动 Codex CLI HTTP writer session...');
    try {
      const result = await startFeedbackCodexTerminal(config, item.id, {
        workspacePath: config.workspacePath,
        initialMessage: inputText.trim() || undefined,
        runtimeProfile: config.runtimeProfile,
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
        gitMode: 'manual',
      });
      setSession(result.session);
      setInputText('');
      setHint('Codex HTTP writer 已启动，输出会自动刷新。');
      if (result.repairRun) onRepairRunWritten?.(result.repairRun);
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendInput() {
    if (!session || !inputText.trim() || !isHttpWriterSession) return;
    setBusy(true);
    setHint('正在发送下一条 Codex 提示...');
    try {
      const next = await sendFeedbackCodexTerminalInput(config, session.id, {
        workspacePath: session.workspacePath || config.workspacePath,
        message: inputText,
      });
      setSession(next);
      setInputText('');
      setHint('已发送到 Codex CLI。');
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopTerminal() {
    if (!session) return;
    setBusy(true);
    setHint(isPtySession ? '正在停止 Codex PTY...' : '正在请求停止当前 Codex turn...');
    try {
      const next = isPtySession
        ? await stopFeedbackCodexPtyTerminal(config, session.id, {
          workspacePath: session.workspacePath || config.workspacePath,
          reason: 'feedback inbox direct PTY terminal stop',
        })
        : await stopFeedbackCodexTerminal(config, session.id, {
          workspacePath: session.workspacePath || config.workspacePath,
          reason: 'feedback inbox direct terminal stop',
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
          {isHttpWriterSession ? <Badge variant="muted">HTTP writer fallback</Badge> : null}
          {isPtySession ? <Badge variant={ptyConnected ? 'success' : 'warning'}>{ptyConnected ? 'connected' : 'disconnected'}</Badge> : null}
        </div>
        <div className="feedback-codex-terminal-actions">
          <DelayedHelpButton
            onClick={() => void startPtyTerminal()}
            disabled={!canStart}
            help="启动带当前 feedback context 的 Codex CLI，并用 WebSocket/xterm 连接真实 PTY。"
          >
            {busy && !session ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <Play size={14} aria-hidden />}
            启动 Codex
          </DelayedHelpButton>
          <DelayedHelpButton
            onClick={() => void startHttpWriterTerminal()}
            disabled={!canStart}
            help="保留旧 HTTP writer 路径作为 fallback；可用于 WebSocket/PTY 不可用时的 Codex turn stream。"
          >
            <Send size={14} aria-hidden />
            HTTP writer
          </DelayedHelpButton>
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
        <code>{providerReady ? '配置可用；直接启动 Codex CLI' : providerBlocker || '预检未通过；仍可启动并查看真实 CLI 输出'}</code>
      </div>
      <div className="feedback-codex-xterm-shell" aria-label="Direct Codex PTY terminal">
        <div ref={xtermHostRef} className="feedback-codex-xterm" />
      </div>
      {isHttpWriterSession ? (
        <pre className="feedback-codex-terminal-body" aria-label="Direct Codex Terminal output">
          {visibleEntries.length ? visibleEntries.map((entry, index) => (
            <span className={cx('feedback-codex-terminal-line', entry.stream)} key={`${entry.timestamp}-${index}`}>
              <span className="feedback-codex-terminal-prefix">{entry.stream}</span>
              <span>{entry.text}</span>
            </span>
          )) : (
            <span className="feedback-codex-terminal-empty">启动后会显示 Codex CLI JSONL 事件、stderr 和回答文本。</span>
          )}
        </pre>
      ) : null}
      <div className="feedback-codex-terminal-input">
        <span className="feedback-repair-prompt">$</span>
        <textarea
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (isHttpWriterSession) void sendInput();
              else if (!session) void startPtyTerminal();
            }
          }}
          disabled={busy || isRunning || isPtySession}
          placeholder={isHttpWriterSession ? '输入给 Codex 的下一条提示...' : '可选：先写给 Codex 的初始提示，再启动...'}
          aria-label={isHttpWriterSession ? '输入给 Codex 的下一条提示' : '输入 Direct Codex Terminal 初始提示'}
        />
        <DelayedHelpButton
          onClick={() => isHttpWriterSession ? void sendInput() : void startPtyTerminal()}
          disabled={isHttpWriterSession ? !canSend : !canStart}
          help={isHttpWriterSession
            ? '通过 HTTP writer 追加下一条用户提示。'
            : '生成 feedback prompt 并启动 Codex CLI WebSocket PTY；启动后直接在终端内输入。'}
        >
          {busy ? <Loader2 size={14} className="feedback-inline-spin" aria-hidden /> : <Send size={14} aria-hidden />}
          {isHttpWriterSession ? '发送' : '启动并发送'}
        </DelayedHelpButton>
        <span className="feedback-codex-terminal-boundary">
          Direct Codex CLI；Git commit/push/PR/merge 默认手动确认。
        </span>
      </div>
      {session?.message || hint || tailError ? (
        <p className="feedback-codex-terminal-hint" role="status">
          {tailError || hint || session?.message}
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
