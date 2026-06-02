import { useEffect, useRef, useState } from 'react';
import {
  BROWSER_HOST_WRITER_PREFLIGHT_TIMEOUT_MS,
  browserHostSessionFrameStreamUrl,
  preflightBrowserHostSessionWriter,
  readBrowserHostSessionState,
  sendBrowserHostComputerUseAction,
  sendBrowserHostSessionAction,
  startBrowserHostSession,
  startRuntimeServices,
  type BrowserHostComputerUseAction,
  type BrowserHostSessionWriterPreflightResult,
  type BrowserHostSessionState,
} from '../../api/workspaceClient';
import type { ObjectReference, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  browserWorkbenchDefaultCommands,
  renderBrowserWorkbench,
  type BrowserWorkbenchCommand,
  type BrowserWorkbenchLiveTransportHandoff,
} from '../../../../../packages/presentation/components';
import {
  browserAddressForFocusedObjectReference,
  browserHostSessionForFocusedObjectReference,
  normalizeRightPaneBrowserUrl,
  parseRightPaneBrowserUrl,
  rightPaneBrowserProjectionForUrl,
  rightPaneBrowserUrlsEquivalent,
  rightPaneBrowserUrlIsLocal,
} from './browserPaneModel';
import { resultText, type ResultLocale } from './resultLocale';

export function rightPaneBrowserRequiresExternalHost(url: string) {
  if (url === 'about:blank') return false;
  const parsed = parseRightPaneBrowserUrl(url);
  return Boolean(parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !rightPaneBrowserUrlIsLocal(parsed));
}

type RightPaneBrowserHostAction = {
  action: 'click' | 'double-click' | 'mouse-down' | 'mouse-move' | 'mouse-up' | 'drag' | 'type' | 'press' | 'scroll' | 'cursor';
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  path?: Array<{ x: number; y: number }>;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  actionId?: string;
  uiEventReceivedAt?: string;
};

type BrowserHostCanvasBinaryFrame = Blob | ArrayBuffer | ArrayBufferView;

const BROWSER_HOST_ACTION_FLUSH_MS = 50;
const BROWSER_HOST_CURSOR_FLUSH_MS = 80;
const BROWSER_HOST_FRAME_STREAM_INTERVAL_MS = 200;
const BROWSER_HOST_FRAME_STREAM_QUIET_WINDOW_MS = 80;
const rightPaneBrowserHostSessionCache = new Map<string, BrowserHostSessionState>();

export function RightPaneBrowserTool({
  tabId,
  config,
  session,
  locale,
  focusedObjectReference,
  addressDraft,
  onAddressDraftChange,
  onCommandRequest,
  onConfigChange,
  onOpenSettings,
}: {
  tabId: string;
  config: SciForgeConfig;
  session: SciForgeSession;
  locale?: ResultLocale;
  focusedObjectReference?: ObjectReference;
  addressDraft: string;
  onAddressDraftChange: (nextAddress: string) => void;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
  onConfigChange?: (patch: Partial<SciForgeConfig>) => void;
  onOpenSettings?: (section?: 'workspace') => void;
}) {
  const normalizedAddressDraft = normalizeRightPaneBrowserUrl(addressDraft);
  const focusedBrowserAddress = browserAddressForFocusedObjectReference(focusedObjectReference, session);
  const normalizedFocusedBrowserAddress = focusedBrowserAddress ? normalizeRightPaneBrowserUrl(focusedBrowserAddress) : undefined;
  const [committedUrl, setCommittedUrl] = useState(normalizedAddressDraft);
  const normalizedUrl = committedUrl;
  const initialHostSession = browserHostSessionForFocusedObjectReference(focusedObjectReference, session) as BrowserHostSessionState | undefined;
  const hostSessionCacheKey = rightPaneBrowserHostSessionCacheKey(config, tabId, normalizedUrl);
  const [hostSession, setHostSession] = useState<BrowserHostSessionState | undefined>(() => {
    if (browserHostSessionMatchesTarget(initialHostSession, normalizedUrl) && browserHostSessionHasUsableLiveSurface(initialHostSession)) return initialHostSession;
    return cachedRightPaneBrowserHostSession(hostSessionCacheKey, normalizedUrl);
  });
  const [hostError, setHostError] = useState('');
  const [writerDiagnostic, setWriterDiagnostic] = useState<BrowserHostSessionWriterPreflightResult | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [hostCursor, setHostCursor] = useState('default');
  const [hostFrameObjectUrl, setHostFrameObjectUrl] = useState<string | undefined>(undefined);
  const [canvasFrameVersion, setCanvasFrameVersion] = useState(0);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef({ width: 1365, height: 900 });
  const hostSessionRef = useRef<BrowserHostSessionState | undefined>(undefined);
  const hostFrameObjectUrlRef = useRef<string | undefined>(undefined);
  const hostFrameObjectSessionRef = useRef<string | undefined>(undefined);
  const configRef = useRef(config);
  const bufferedTextRef = useRef('');
  const bufferedTextReceivedAtRef = useRef<string | undefined>(undefined);
  const bufferedScrollRef = useRef<{ deltaX: number; deltaY: number; x?: number; y?: number }>({ deltaX: 0, deltaY: 0 });
  const bufferedScrollReceivedAtRef = useRef<string | undefined>(undefined);
  const actionFlushTimerRef = useRef<number | undefined>(undefined);
  const cursorFlushTimerRef = useRef<number | undefined>(undefined);
  const frameStreamSocketRef = useRef<WebSocket | null>(null);
  const frameStreamReceivedBinaryRef = useRef(false);
  const frameStreamCandidateTransportRef = useRef<string | undefined>(undefined);
  const pendingBinaryFrameSessionRef = useRef<string | undefined>(undefined);
  const pendingCanvasBinaryFrameRef = useRef<{ sessionId: string; frame: BrowserHostCanvasBinaryFrame; sequence: number } | undefined>(undefined);
  const canvasFrameSequenceRef = useRef(0);
  const pendingCursorRef = useRef<RightPaneBrowserHostAction | undefined>(undefined);
  const cursorRequestInFlightRef = useRef(false);
  const pendingMouseMoveRef = useRef<RightPaneBrowserHostAction | undefined>(undefined);
  const mouseMoveRequestInFlightRef = useRef(false);
  const actionChainRef = useRef<Promise<void>>(Promise.resolve());
  const nativeSurfaceSessionRef = useRef<string | undefined>(undefined);
  const pendingHostOpenUrlRef = useRef<string | undefined>(undefined);
  const [browserViewport, setBrowserViewport] = useState(viewportRef.current);
  const needsBrowserHost = rightPaneBrowserRequiresExternalHost(normalizedUrl);

  useEffect(() => {
    hostSessionRef.current = hostSession;
  }, [hostSession]);

  useEffect(() => {
    cacheRightPaneBrowserHostSession(hostSessionCacheKey, normalizedUrl, hostSession);
  }, [hostSessionCacheKey, hostSession, normalizedUrl]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (!normalizedFocusedBrowserAddress) return;
    setCommittedUrl((current) => rightPaneBrowserUrlsEquivalent(current, normalizedFocusedBrowserAddress) ? current : normalizedFocusedBrowserAddress);
  }, [normalizedFocusedBrowserAddress]);

  useEffect(() => {
    const nextInitialHostSession = initialHostSession;
    if (!nextInitialHostSession || !browserHostSessionMatchesTarget(nextInitialHostSession, normalizedUrl) || !browserHostSessionHasUsableLiveSurface(nextInitialHostSession)) return;
    const focusedHostSession = nextInitialHostSession;
    setHostSession((current) => current && current.id === focusedHostSession.id && current.updatedAt === focusedHostSession.updatedAt ? current : focusedHostSession);
    if (focusedHostSession.workspaceWriterBaseUrl) updateEffectiveWriterConfig(focusedHostSession.workspaceWriterBaseUrl);
  }, [initialHostSession?.id, initialHostSession?.updatedAt, normalizedUrl]);

  useEffect(() => () => {
    if (actionFlushTimerRef.current !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(actionFlushTimerRef.current);
    }
    if (cursorFlushTimerRef.current !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(cursorFlushTimerRef.current);
    }
    closeHostFrameStream();
    detachNativeBrowserSurface();
    clearHostFrameObjectUrl();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const node = surfaceRef.current;
    if (!node) return;
    const updateViewport = () => {
      const rect = node.getBoundingClientRect();
      const nextViewport = rightPaneBrowserHostViewport(rect.width, rect.height);
      const previous = viewportRef.current;
      viewportRef.current = nextViewport;
      if (Math.abs(previous.width - nextViewport.width) >= 24 || Math.abs(previous.height - nextViewport.height) >= 24) {
        setBrowserViewport(nextViewport);
      }
    };
    updateViewport();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!needsBrowserHost || typeof window === 'undefined') {
      setHostSession(undefined);
      setHostError('');
      setBusy(false);
      pendingHostOpenUrlRef.current = undefined;
      detachNativeBrowserSurface();
      clearHostFrameObjectUrl();
      return;
    }
    if (browserHostSessionMatchesTarget(hostSession, normalizedUrl) && browserHostSessionHasUsableLiveSurface(hostSession)) return;
    if (pendingHostOpenUrlRef.current && rightPaneBrowserUrlsEquivalent(pendingHostOpenUrlRef.current, normalizedUrl)) return;
    const currentOpenHostSession = hostSession
      && hostSession.status !== 'closed'
      && hostSession.status !== 'failed'
      && browserHostSessionHasUsableLiveSurface(hostSession)
      ? hostSession
      : undefined;
    if (currentOpenHostSession) return;
    let cancelled = false;
    let pollStopped = false;
    let pollTimer: number | undefined;
    let operationConfig = config;
    const pendingSessionId = browserHostPendingSessionId(tabId, normalizedUrl);
    const pollPendingSession = () => {
      if (cancelled || pollStopped || typeof window === 'undefined') return;
      void readBrowserHostSessionState(operationConfig, pendingSessionId)
        .then((sessionState) => {
          if (cancelled || pollStopped || !browserHostSessionMatchesTarget(sessionState, normalizedUrl)) return;
          setHostSession(sessionState);
          setWriterDiagnostic(undefined);
          updateEffectiveWriterConfig(sessionState.workspaceWriterBaseUrl);
        })
        .catch(() => undefined)
        .finally(() => {
          if (cancelled || pollStopped || typeof window === 'undefined') return;
          const current = hostSessionRef.current;
          if (current?.id === pendingSessionId && (current.status === 'ready' || current.status === 'failed' || current.status === 'closed')) return;
          pollTimer = window.setTimeout(pollPendingSession, 500);
        });
    };
    setHostError('');
    setBusy(true);
    pendingHostOpenUrlRef.current = normalizedUrl;
    void (async () => {
      operationConfig = await browserHostPendingWriterConfig();
      if (cancelled) return undefined;
      if (typeof window !== 'undefined') pollTimer = window.setTimeout(pollPendingSession, 250);
      return startBrowserHostSession(operationConfig, { url: normalizedUrl, sessionId: pendingSessionId, ...viewportRef.current });
    })()
      .then((result) => {
        if (cancelled || !result) return;
        setHostSession(result.session);
        setWriterDiagnostic(undefined);
        updateEffectiveWriterConfig(result.session.workspaceWriterBaseUrl);
      })
      .catch((error) => {
        if (cancelled) return;
        setHostError(error instanceof Error ? error.message : String(error));
        void refreshWriterDiagnostic();
      })
      .finally(() => {
        pollStopped = true;
        if (pollTimer !== undefined && typeof window !== 'undefined') window.clearTimeout(pollTimer);
        if (rightPaneBrowserUrlsEquivalent(pendingHostOpenUrlRef.current, normalizedUrl)) pendingHostOpenUrlRef.current = undefined;
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      pollStopped = true;
      if (pollTimer !== undefined && typeof window !== 'undefined') window.clearTimeout(pollTimer);
    };
  }, [config, hostSession?.requestedUrl, hostSession?.status, hostSession?.url, needsBrowserHost, normalizedUrl, tabId]);

  useEffect(() => {
    const currentHostSession = hostSession;
    if (!needsBrowserHost || !currentHostSession || !browserHostSessionCanUseHostFrameStream(currentHostSession) || browserHostSessionUsesNativeSurface(currentHostSession)) {
      closeHostFrameStream();
      return;
    }
    connectHostFrameStream(currentHostSession);
    return () => closeHostFrameStream();
  }, [hostSession?.id, hostSession?.status, hostSession?.workspaceWriterBaseUrl, needsBrowserHost]);

  useEffect(() => {
    void drawPendingBrowserHostCanvasFrame();
  }, [canvasFrameVersion, hostSession?.id]);

  useEffect(() => {
    if (!needsBrowserHost || !hostSession || !browserHostSessionUsesNativeSurface(hostSession) || hostSession.status === 'closed' || hostSession.status === 'failed') {
      detachNativeBrowserSurface();
      return;
    }
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const syncSurface = () => {
      if (!cancelled) void attachNativeBrowserSurface(hostSession);
    };
    const timer = window.setTimeout(syncSurface, 0);
    const target = browserHostNativeSurfaceElement(surfaceRef.current);
    const observer = target && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSurface) : undefined;
    if (target) observer?.observe(target);
    window.addEventListener('resize', syncSurface);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', syncSurface);
    };
  }, [hostSession?.id, hostSession?.liveSurfaceTransport, hostSession?.status, needsBrowserHost]);

  const browserState = rightPaneBrowserProjectionForUrl(normalizedUrl, needsBrowserHost ? {
    hostExternalBrowserAvailable: true,
    hostSurface: 'browser-host-session',
    hostBusy: busy,
    hostSession,
    hostError,
  } : {});
  const commands = browserWorkbenchDefaultCommands(normalizedUrl, {
    status: browserState.status,
    canGoBack: hostSession?.canGoBack ?? false,
    canGoForward: hostSession?.canGoForward ?? false,
    canReload: normalizedUrl !== 'about:blank',
    canStop: browserState.status === 'loading',
    canSnapshot: normalizedUrl !== 'about:blank',
    canState: normalizedUrl !== 'about:blank',
    canTakeover: normalizedUrl !== 'about:blank',
    canCopyUrl: normalizedUrl !== 'about:blank',
    canOpenExternal: Boolean(browserState.externalUrl),
  });

  function requestCommand(command: BrowserWorkbenchCommand) {
    if (command.id === 'open') {
      void openAddress(normalizedUrl);
      return;
    }
    if (hostSession && (command.id === 'back' || command.id === 'forward' || command.id === 'reload' || command.id === 'stop' || command.id === 'snapshot' || command.id === 'state')) {
      flushBufferedHostActions();
      const action = command.id === 'snapshot' ? 'snapshot' : command.id === 'state' ? 'state' : command.id;
      const commandShowsLoading = command.id === 'back' || command.id === 'forward' || command.id === 'reload' || command.id === 'stop';
      if (commandShowsLoading) setBusy(true);
      if (command.id === 'stop') {
        setHostSession({
          ...hostSession,
          status: 'ready',
          loadingProgress: {
            schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1',
            state: 'network-quiet',
            reason: 'host-ready',
            source: 'host-session',
            status: 'ready',
            action: 'stop',
            updatedAt: new Date().toISOString(),
            refs: {
              session: `browser-host-session:${hostSession.id}/session.json`,
              liveSurface: hostSession.liveSurfaceRef,
              frameStream: hostSession.frameStreamRef,
              frame: hostSession.frameRef,
              screenshot: hostSession.screenshotRef,
              domSnapshot: hostSession.domSnapshotRef,
              axSnapshot: hostSession.axSnapshotRef,
              consoleLog: hostSession.consoleLogRef,
              networkLog: hostSession.networkLogRef,
              searchResult: hostSession.searchResultRef,
            },
            urls: hostSession.loadingProgress?.urls,
          },
        });
      }
      void sendBrowserHostSessionAction(browserHostSessionConfig(config, hostSession), hostSession.id, {
        action,
        workspaceWriterBaseUrl: hostSession.workspaceWriterBaseUrl,
      })
        .then(setHostSession)
        .catch((error) => {
          setHostError(error instanceof Error ? error.message : String(error));
          void refreshWriterDiagnostic();
        })
        .finally(() => {
          if (commandShowsLoading) setBusy(false);
        });
      return;
    }
    if (command.id === 'copy-url' && typeof navigator !== 'undefined') {
      void navigator.clipboard?.writeText(normalizedUrl);
    }
    if (command.id === 'open-external') {
      onCommandRequest(command.command, command.label, browserState.ref);
    }
  }

  async function browserHostPendingWriterConfig(): Promise<SciForgeConfig> {
    try {
      const diagnostic = await preflightBrowserHostSessionWriter(config, {
        timeoutMs: BROWSER_HOST_WRITER_PREFLIGHT_TIMEOUT_MS,
      });
      const effectiveBaseUrl = diagnostic.ok ? diagnostic.effectiveBaseUrl : diagnostic.recommendedBaseUrl;
      if (effectiveBaseUrl) {
        setWriterDiagnostic(undefined);
        updateEffectiveWriterConfig(effectiveBaseUrl);
        return { ...config, workspaceWriterBaseUrl: effectiveBaseUrl };
      }
    } catch {
      // startBrowserHostSession still performs the authoritative writer preparation.
    }
    return config;
  }

  async function startBrowserHostSessionWithPendingPoll(targetUrl: string): Promise<BrowserHostSessionState> {
    let stopped = false;
    let pollTimer: number | undefined;
    const operationConfig = await browserHostPendingWriterConfig();
    const pendingSessionId = browserHostPendingSessionId(tabId, targetUrl);
    const pollPendingSession = () => {
      if (stopped || typeof window === 'undefined') return;
      void readBrowserHostSessionState(operationConfig, pendingSessionId)
        .then((sessionState) => {
          if (stopped || !browserHostSessionMatchesTarget(sessionState, targetUrl)) return;
          setHostSession(sessionState);
          setWriterDiagnostic(undefined);
          updateEffectiveWriterConfig(sessionState.workspaceWriterBaseUrl);
        })
        .catch(() => undefined)
        .finally(() => {
          if (stopped || typeof window === 'undefined') return;
          const current = hostSessionRef.current;
          if (current?.id === pendingSessionId && (current.status === 'ready' || current.status === 'failed' || current.status === 'closed')) return;
          pollTimer = window.setTimeout(pollPendingSession, 500);
        });
    };
    if (typeof window !== 'undefined') pollTimer = window.setTimeout(pollPendingSession, 250);
    try {
      return (await startBrowserHostSession(operationConfig, { url: targetUrl, sessionId: pendingSessionId, ...viewportRef.current })).session;
    } finally {
      stopped = true;
      if (pollTimer !== undefined && typeof window !== 'undefined') window.clearTimeout(pollTimer);
    }
  }

  async function openAddress(value: string) {
    flushBufferedHostActions();
    const nextUrl = normalizeRightPaneBrowserUrl(value);
    onAddressDraftChange(nextUrl);
    setCommittedUrl(nextUrl);
    if (rightPaneBrowserRequiresExternalHost(nextUrl)) {
      pendingHostOpenUrlRef.current = nextUrl;
      setBusy(true);
      try {
        const current = hostSession && hostSession.status !== 'closed' && browserHostSessionHasUsableLiveSurface(hostSession) ? hostSession : undefined;
        const nextSession = current
          ? await sendBrowserHostSessionAction(browserHostSessionConfig(config, current), current.id, {
              action: 'navigate',
              url: nextUrl,
              workspaceWriterBaseUrl: current.workspaceWriterBaseUrl,
            })
          : await startBrowserHostSessionWithPendingPoll(nextUrl);
        setHostSession(nextSession);
        setHostError('');
        setWriterDiagnostic(undefined);
        updateEffectiveWriterConfig(nextSession.workspaceWriterBaseUrl);
      } catch (error) {
        setHostError(error instanceof Error ? error.message : String(error));
        await refreshWriterDiagnostic();
      } finally {
        if (rightPaneBrowserUrlsEquivalent(pendingHostOpenUrlRef.current, nextUrl)) pendingHostOpenUrlRef.current = undefined;
        setBusy(false);
      }
    } else {
      pendingHostOpenUrlRef.current = undefined;
      setHostSession(undefined);
      setHostError('');
      setWriterDiagnostic(undefined);
    }
  }

  function requestHostAction(action: RightPaneBrowserHostAction) {
    const timedAction = browserHostActionWithUiTiming(action);
    if (timedAction.action === 'cursor') {
      requestHostCursor(timedAction);
      return;
    }
    if (timedAction.action === 'mouse-move') {
      requestHostMouseMove(timedAction);
      return;
    }
    if (timedAction.action === 'type' && timedAction.text) {
      bufferedTextRef.current += timedAction.text;
      bufferedTextReceivedAtRef.current = bufferedTextReceivedAtRef.current ?? timedAction.uiEventReceivedAt;
      scheduleBufferedHostActionFlush();
      return;
    }
    if (timedAction.action === 'scroll') {
      bufferedScrollRef.current.deltaX += timedAction.deltaX ?? 0;
      bufferedScrollRef.current.deltaY += timedAction.deltaY ?? 0;
      if (Number.isFinite(timedAction.x) && Number.isFinite(timedAction.y)) {
        bufferedScrollRef.current.x = timedAction.x;
        bufferedScrollRef.current.y = timedAction.y;
      }
      bufferedScrollReceivedAtRef.current = bufferedScrollReceivedAtRef.current ?? timedAction.uiEventReceivedAt;
      scheduleBufferedHostActionFlush();
      return;
    }
    if (timedAction.action === 'press') {
      flushBufferedHostActions();
      dispatchHostAction(timedAction, 'none');
      return;
    }
    flushBufferedHostActions();
    dispatchHostAction(timedAction, 'none');
  }

  function scheduleBufferedHostActionFlush() {
    if (typeof window === 'undefined') {
      flushBufferedHostActions();
      return;
    }
    if (actionFlushTimerRef.current !== undefined) window.clearTimeout(actionFlushTimerRef.current);
    actionFlushTimerRef.current = window.setTimeout(() => {
      actionFlushTimerRef.current = undefined;
      flushBufferedHostActions();
    }, BROWSER_HOST_ACTION_FLUSH_MS);
  }

  function flushBufferedHostActions() {
    if (actionFlushTimerRef.current !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(actionFlushTimerRef.current);
      actionFlushTimerRef.current = undefined;
    }
    const text = bufferedTextRef.current;
    bufferedTextRef.current = '';
    const textReceivedAt = bufferedTextReceivedAtRef.current;
    bufferedTextReceivedAtRef.current = undefined;
    if (text) dispatchHostAction(browserHostActionWithUiTiming({ action: 'type', text, uiEventReceivedAt: textReceivedAt }), 'none');
    const scroll = bufferedScrollRef.current;
    bufferedScrollRef.current = { deltaX: 0, deltaY: 0 };
    const scrollReceivedAt = bufferedScrollReceivedAtRef.current;
    bufferedScrollReceivedAtRef.current = undefined;
    if (scroll.deltaX || scroll.deltaY) {
      dispatchHostAction(browserHostActionWithUiTiming({ action: 'scroll', x: scroll.x, y: scroll.y, deltaX: scroll.deltaX, deltaY: scroll.deltaY, uiEventReceivedAt: scrollReceivedAt }), 'none');
    }
  }

  function dispatchHostAction(
    action: RightPaneBrowserHostAction,
    capture: 'frame' | 'none' = 'frame',
  ) {
    if (!hostSessionRef.current) return;
    actionChainRef.current = actionChainRef.current.then(() => sendHostAction(action, capture)).catch((error) => {
      setHostError(error instanceof Error ? error.message : String(error));
      void refreshWriterDiagnostic();
    });
  }

  function requestHostMouseMove(action: RightPaneBrowserHostAction) {
    pendingMouseMoveRef.current = action;
    if (mouseMoveRequestInFlightRef.current) return;
    void flushPendingHostMouseMove();
  }

  async function flushPendingHostMouseMove(): Promise<void> {
    if (mouseMoveRequestInFlightRef.current) return;
    const action = pendingMouseMoveRef.current;
    pendingMouseMoveRef.current = undefined;
    if (!action || !hostSessionRef.current) return;
    mouseMoveRequestInFlightRef.current = true;
    try {
      await sendHostAction(action, 'none');
    } catch (error) {
      setHostError(error instanceof Error ? error.message : String(error));
      void refreshWriterDiagnostic();
    } finally {
      mouseMoveRequestInFlightRef.current = false;
      if (pendingMouseMoveRef.current) void flushPendingHostMouseMove();
    }
  }

  async function sendHostAction(
    action: RightPaneBrowserHostAction,
    capture: 'frame' | 'none',
  ): Promise<void> {
    const currentSession = hostSessionRef.current;
    if (!currentSession) return;
    const adapterSentAt = new Date().toISOString();
    const computerUseAction = browserHostComputerUseActionFromHostAction(action);
    const nextSession = computerUseAction
      ? (await sendBrowserHostComputerUseAction(browserHostSessionConfig(configRef.current, currentSession), currentSession.id, {
          action: computerUseAction,
          capture,
          actionId: action.actionId,
          uiEventReceivedAt: action.uiEventReceivedAt,
          adapterSentAt,
          workspaceWriterBaseUrl: currentSession.workspaceWriterBaseUrl,
        })).session
      : await sendBrowserHostSessionAction(browserHostSessionConfig(configRef.current, currentSession), currentSession.id, {
          ...action,
          capture,
          adapterSentAt,
          workspaceWriterBaseUrl: currentSession.workspaceWriterBaseUrl,
        });
    hostSessionRef.current = nextSession;
    if (capture !== 'none') setHostSession(nextSession);
    setHostError('');
  }

  function connectHostFrameStream(sessionState: BrowserHostSessionState) {
    if (typeof WebSocket === 'undefined') return;
    closeHostFrameStream();
    clearHostFrameObjectUrl();
    const socket = new WebSocket(browserHostSessionFrameStreamUrl(browserHostSessionConfig(configRef.current, sessionState), sessionState, {
      intervalMs: BROWSER_HOST_FRAME_STREAM_INTERVAL_MS,
      quietWindowMs: BROWSER_HOST_FRAME_STREAM_QUIET_WINDOW_MS,
    }));
    socket.binaryType = 'blob';
    frameStreamSocketRef.current = socket;
    frameStreamReceivedBinaryRef.current = false;
    socket.addEventListener('message', (event) => {
      if (applyBrowserHostFrameStreamBinary(event.data, sessionState.id)) return;
      const message = parseBrowserHostFrameStreamMessage(event.data);
      if (!message || message.type !== 'frame' || message.session?.id !== sessionState.id) return;
      const current = hostSessionRef.current;
      if (!current || current.id !== sessionState.id) return;
      frameStreamCandidateTransportRef.current = browserHostSameSessionCandidateFrameTransport(message.session, message.frameTransport);
      pendingBinaryFrameSessionRef.current = frameStreamCandidateTransportRef.current && message.binaryFrameId
        ? sessionState.id
        : undefined;
      const nextSession: BrowserHostSessionState = {
        ...message.session,
        workspaceWriterBaseUrl: current.workspaceWriterBaseUrl,
      };
      hostSessionRef.current = nextSession;
      setHostSession(nextSession);
      setHostError('');
    });
    socket.addEventListener('close', () => {
      reportHostFrameStreamIssue(socket, sessionState, 'BrowserHostSession live frame stream closed before a real browser frame arrived.');
    });
    socket.addEventListener('error', () => {
      reportHostFrameStreamIssue(socket, sessionState, 'BrowserHostSession live frame stream is unavailable.');
    });
  }

  function closeHostFrameStream() {
    frameStreamSocketRef.current?.close();
    frameStreamSocketRef.current = null;
    pendingBinaryFrameSessionRef.current = undefined;
    pendingCanvasBinaryFrameRef.current = undefined;
    frameStreamReceivedBinaryRef.current = false;
    frameStreamCandidateTransportRef.current = undefined;
  }

  function reportHostFrameStreamIssue(socket: WebSocket, sessionState: BrowserHostSessionState, message: string) {
    if (frameStreamSocketRef.current !== socket) return;
    frameStreamSocketRef.current = null;
    pendingBinaryFrameSessionRef.current = undefined;
    frameStreamCandidateTransportRef.current = undefined;
    if (frameStreamReceivedBinaryRef.current || hostSessionRef.current?.id !== sessionState.id) return;
    setHostError(message);
    void refreshWriterDiagnostic();
  }

  function applyBrowserHostFrameStreamBinary(value: unknown, sessionId: string) {
    if (!browserHostFrameStreamBinaryLike(value)) return false;
    if (pendingBinaryFrameSessionRef.current !== sessionId || hostSessionRef.current?.id !== sessionId) return true;
    pendingBinaryFrameSessionRef.current = undefined;
    const frame = value as BrowserHostCanvasBinaryFrame;
    pendingCanvasBinaryFrameRef.current = { sessionId, frame, sequence: ++canvasFrameSequenceRef.current };
    const blob = typeof Blob !== 'undefined'
      ? value instanceof Blob ? value : new Blob([value as BlobPart], { type: 'image/png' })
      : undefined;
    frameStreamReceivedBinaryRef.current = true;
    void drawPendingBrowserHostCanvasFrame();
    setCanvasFrameVersion((version) => version + 1);
    if (browserHostSessionUsesCanvasBinaryRenderer(hostSessionRef.current)) return true;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return true;
    if (!blob) return true;
    const objectUrl = URL.createObjectURL(blob);
    const previousObjectUrl = hostFrameObjectUrlRef.current;
    hostFrameObjectUrlRef.current = objectUrl;
    hostFrameObjectSessionRef.current = sessionId;
    setHostFrameObjectUrl(objectUrl);
    if (previousObjectUrl && previousObjectUrl !== objectUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previousObjectUrl);
    return true;
  }

  async function drawPendingBrowserHostCanvasFrame() {
    const pending = pendingCanvasBinaryFrameRef.current;
    if (!pending || hostSessionRef.current?.id !== pending.sessionId) return;
    const canvas = browserHostCanvasBinaryElement(surfaceRef.current, pending.sessionId);
    if (!canvas) return;
    const drawn = await drawBrowserHostCanvasBinaryFrame(canvas, pending.frame);
    if (drawn && pendingCanvasBinaryFrameRef.current?.sequence === pending.sequence) {
      pendingCanvasBinaryFrameRef.current = undefined;
    }
  }

  function clearHostFrameObjectUrl() {
    const previousObjectUrl = hostFrameObjectUrlRef.current;
    hostFrameObjectUrlRef.current = undefined;
    hostFrameObjectSessionRef.current = undefined;
    setHostFrameObjectUrl(undefined);
    if (previousObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(previousObjectUrl);
  }

  function requestHostCursor(action: RightPaneBrowserHostAction) {
    if (!hostSessionRef.current) {
      setHostCursor('default');
      return;
    }
    if ((action.x ?? 0) < 0 || (action.y ?? 0) < 0) {
      pendingCursorRef.current = undefined;
      setHostCursor('default');
      return;
    }
    pendingCursorRef.current = action;
    if (cursorFlushTimerRef.current !== undefined || typeof window === 'undefined') {
      if (typeof window === 'undefined') void flushHostCursor();
      return;
    }
    cursorFlushTimerRef.current = window.setTimeout(() => {
      cursorFlushTimerRef.current = undefined;
      void flushHostCursor();
    }, BROWSER_HOST_CURSOR_FLUSH_MS);
  }

  async function flushHostCursor() {
    if (cursorRequestInFlightRef.current) return;
    const action = pendingCursorRef.current;
    pendingCursorRef.current = undefined;
    const currentSession = hostSessionRef.current;
    if (!currentSession || !action) return;
    cursorRequestInFlightRef.current = true;
    try {
      const adapterSentAt = new Date().toISOString();
      const result = await sendBrowserHostComputerUseAction(browserHostSessionConfig(configRef.current, currentSession), currentSession.id, {
        action: { type: 'cursor', x: action.x, y: action.y },
        capture: 'none',
        actionId: action.actionId,
        uiEventReceivedAt: action.uiEventReceivedAt,
        adapterSentAt,
        workspaceWriterBaseUrl: currentSession.workspaceWriterBaseUrl,
      });
      const nextSession = result.session;
      setHostCursor(normalizeRightPaneHostCursor(nextSession.cursor));
    } catch {
      setHostCursor('default');
    } finally {
      cursorRequestInFlightRef.current = false;
      if (pendingCursorRef.current) void flushHostCursor();
    }
  }

  async function refreshWriterDiagnostic() {
    try {
      setWriterDiagnostic(await preflightBrowserHostSessionWriter(config, { timeoutMs: BROWSER_HOST_WRITER_PREFLIGHT_TIMEOUT_MS }));
    } catch {
      // The original hostError carries the actionable Workspace Writer failure.
    }
  }

  async function startRuntimeServicesAndRetry() {
    setBusy(true);
    try {
      await startRuntimeServices();
      setWriterDiagnostic(undefined);
      await openAddress(normalizedUrl);
    } catch (error) {
      setHostError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function updateEffectiveWriterConfig(baseUrl: string | undefined) {
    const normalizedBaseUrl = baseUrl?.replace(/\/+$/, '');
    if (!normalizedBaseUrl || normalizedBaseUrl === config.workspaceWriterBaseUrl.replace(/\/+$/, '')) return;
    onConfigChange?.({ workspaceWriterBaseUrl: normalizedBaseUrl });
  }

  function useWorkspaceWriterCandidate(baseUrl: string) {
    setWriterDiagnostic(undefined);
    setHostError('');
    onConfigChange?.({ workspaceWriterBaseUrl: baseUrl });
  }

  async function attachNativeBrowserSurface(sessionState: BrowserHostSessionState) {
    const bridge = desktopBrowserHostSurfaceBridge();
    if (!bridge?.attachBrowserHostSessionSurface) return;
    const bounds = browserHostNativeSurfaceBounds(surfaceRef.current);
    if (!bounds) return;
    try {
      const result = await bridge.attachBrowserHostSessionSurface({
        sessionId: sessionState.id,
        liveSurfaceRef: sessionState.liveSurfaceRef,
        bounds,
        visible: true,
        focus: nativeSurfaceSessionRef.current !== sessionState.id,
      });
      nativeSurfaceSessionRef.current = sessionState.id;
      if (nativeBrowserHostSurfaceResultFailed(result)) {
        setHostError(nativeBrowserHostSurfaceReason(result) ?? 'Native embedded BrowserHostSession surface could not attach.');
      } else {
        setHostError('');
      }
    } catch (error) {
      setHostError(error instanceof Error ? error.message : String(error));
    }
  }

  function detachNativeBrowserSurface(sessionId = nativeSurfaceSessionRef.current) {
    if (!sessionId || typeof window === 'undefined') return;
    const bridge = desktopBrowserHostSurfaceBridge();
    nativeSurfaceSessionRef.current = undefined;
    void bridge?.detachBrowserHostSessionSurface?.({ sessionId });
  }

  return (
    <div
      ref={surfaceRef}
      className="right-pane-package-surface right-pane-browser-surface"
      data-testid="right-pane-browser-tool"
      data-browser-viewport-width={browserViewport.width}
      data-browser-viewport-height={browserViewport.height}
    >
      {writerDiagnostic && !writerDiagnostic.ok ? (
        <div
          className="right-pane-browser-writer-diagnostic"
          role="status"
          data-browser-writer-diagnostic={writerDiagnostic.status}
          data-browser-writer-configured-url={writerDiagnostic.configuredDisplayUrl}
          data-browser-writer-recommended-url={writerDiagnostic.recommendedDisplayUrl}
        >
          <div>
            <strong>{resultText(locale, { 'zh-CN': 'BrowserHostSession 需要 Workspace Writer', 'en-US': 'BrowserHostSession needs Workspace Writer' })}</strong>
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
          <div className="right-pane-browser-writer-actions">
            <button type="button" onClick={() => void openAddress(normalizedUrl)} disabled={busy}>
              {resultText(locale, { 'zh-CN': '重试', 'en-US': 'Retry' })}
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
      {renderBrowserWorkbench({
        slot: {
          componentId: 'browser-workbench',
          title: resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' }),
          props: {
            title: resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' }),
            status: browserState.status,
            state: {
              status: browserState.status,
              url: normalizedUrl,
              reason: browserState.reason,
              detail: browserState.detail,
              ref: browserState.ref,
              canRenderFrame: browserState.canRenderFrame,
              hostSurface: browserState.hostSurface,
            },
            embedPolicy: browserState.embedPolicy,
            addressValue: addressDraft,
            addressPlaceholder: 'https://example.org',
            previewUrl: browserState.previewUrl,
            frameUrl: hostSession && !browserHostSessionUsesNativeSurface(hostSession) && hostFrameObjectSessionRef.current === hostSession.id ? hostFrameObjectUrl : undefined,
            frameTransport: browserHostSessionUsesNativeSurface(hostSession)
              ? 'native-embedded'
              : browserHostSessionUsesCanvasBinaryRenderer(hostSession)
                ? browserHostCanvasBinaryFrameTransport(hostSession, frameStreamCandidateTransportRef.current)
                : hostFrameObjectSessionRef.current === hostSession?.id && hostFrameObjectUrl ? 'websocket-binary' : undefined,
            frameRenderer: browserHostSessionUsesCanvasBinaryRenderer(hostSession) ? 'canvas-binary' : undefined,
            liveTransportHandoff: browserHostWebRtcRightPaneHandoff(hostSession, frameStreamCandidateTransportRef.current),
            previewSandbox: browserState.previewSandbox,
            externalUrl: browserState.externalUrl,
            hostSession: hostSession ? { ...hostSession, cursor: hostCursor } : undefined,
            writerDiagnostic: writerDiagnostic ? {
              status: writerDiagnostic.status,
              configuredBaseUrl: writerDiagnostic.configuredBaseUrl,
              configuredDisplayUrl: writerDiagnostic.configuredDisplayUrl,
              effectiveBaseUrl: writerDiagnostic.effectiveBaseUrl,
              effectiveDisplayUrl: writerDiagnostic.effectiveDisplayUrl,
              recommendedBaseUrl: writerDiagnostic.recommendedBaseUrl,
              recommendedDisplayUrl: writerDiagnostic.recommendedDisplayUrl,
              diagnosticRef: writerDiagnostic.diagnosticRef,
              message: writerDiagnostic.message,
              health: writerDiagnostic.health ? {
                ok: writerDiagnostic.health.ok,
                service: writerDiagnostic.health.service,
                capabilities: writerDiagnostic.health.capabilities,
              } : undefined,
            } : undefined,
            commands,
            onAddressChange: onAddressDraftChange,
            onAddressSubmit: openAddress,
            onCommandRequest: requestCommand,
            onHostActionRequest: requestHostAction,
            onCopyRefRequest: (ref: { ref: string }) => {
              if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(ref.ref);
            },
            notes: [],
          },
        },
        artifact: {
          id: 'right-pane-browser-workbench',
          type: 'browser-runtime-projection',
          producerScenario: 'browser-runtime',
          schemaVersion: 'sciforge.browser-runtime.projection.v1',
          data: {
            session: {
              id: 'right-pane-browser',
              mode: 'agent-headless',
              providerId: 'browser_runtime',
              activeTabId: `${tabId}:tab`,
              tabs: [{
                id: `${tabId}:tab`,
                url: hostSession?.url ?? normalizedUrl,
                title: hostSession?.title ?? (normalizedUrl === 'about:blank' ? 'about:blank' : normalizedUrl),
                status: browserState.tabStatus,
              }],
            },
            hostSession: hostSession ? { ...hostSession, cursor: hostCursor } : undefined,
            snapshot: hostSession ? {
              schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
              url: hostSession.url,
              title: hostSession.title,
              screenshotRef: hostSession.screenshotRef,
              domSnapshotRef: hostSession.domSnapshotRef,
              axSnapshotRef: hostSession.axSnapshotRef,
              consoleLogRef: hostSession.consoleLogRef,
              networkLogRef: hostSession.networkLogRef,
              searchResultRef: hostSession.searchResultRef,
            } : undefined,
          },
        },
        config,
        session,
      })}
    </div>
  );
}

function browserHostSessionMatchesTarget(session: BrowserHostSessionState | undefined, normalizedUrl: string) {
  if (!session || session.status === 'failed' || session.status === 'closed') return false;
  return rightPaneBrowserUrlsEquivalent(session.requestedUrl, normalizedUrl)
    || rightPaneBrowserUrlsEquivalent(session.url, normalizedUrl);
}

function browserHostPendingSessionId(tabId: string, normalizedUrl: string) {
  return `right-pane-${safeBrowserHostSessionIdPart(tabId)}-${browserHostSessionIdHash(normalizedUrl)}`;
}

function safeBrowserHostSessionIdPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'browser';
}

function browserHostSessionIdHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function browserHostSessionCanUseHostFrameStream(session: BrowserHostSessionState | undefined) {
  return Boolean(session
    && session.status !== 'closed'
    && session.status !== 'failed'
    && session.liveSurfaceTransport === 'host-stream'
    && session.singleInteractiveTruth === true
    && session.frameStreamRef === `browser-host-session:${session.id}/frame-stream`);
}

function browserHostSessionHasUsableLiveSurface(session: BrowserHostSessionState | undefined) {
  return browserHostSessionCanUseHostFrameStream(session) || browserHostSessionUsesNativeSurface(session);
}

function rightPaneBrowserHostSessionCacheKey(config: SciForgeConfig, tabId: string, normalizedUrl: string) {
  return `${config.workspacePath}::${tabId}::${normalizedUrl}`;
}

function cachedRightPaneBrowserHostSession(key: string, normalizedUrl: string) {
  const cached = rightPaneBrowserHostSessionCache.get(key);
  return browserHostSessionMatchesTarget(cached, normalizedUrl) && browserHostSessionHasUsableLiveSurface(cached) ? cached : undefined;
}

function cacheRightPaneBrowserHostSession(
  key: string,
  normalizedUrl: string,
  session: BrowserHostSessionState | undefined,
) {
  if (!session || !browserHostSessionMatchesTarget(session, normalizedUrl) || !browserHostSessionHasUsableLiveSurface(session)) return;
  rightPaneBrowserHostSessionCache.set(key, session);
}

function browserHostSessionConfig(config: SciForgeConfig, session: BrowserHostSessionState): SciForgeConfig {
  return session.workspaceWriterBaseUrl
    ? { ...config, workspaceWriterBaseUrl: session.workspaceWriterBaseUrl }
    : config;
}

function browserHostComputerUseActionFromHostAction(action: RightPaneBrowserHostAction): BrowserHostComputerUseAction | undefined {
  if (action.action === 'click') return { type: 'click', x: action.x, y: action.y };
  if (action.action === 'double-click') return { type: 'double_click', x: action.x, y: action.y };
  if (action.action === 'mouse-down') return { type: 'mouse_down', x: action.x, y: action.y, button: action.button };
  if (action.action === 'mouse-move') return { type: 'mouse_move', x: action.x, y: action.y };
  if (action.action === 'mouse-up') return { type: 'mouse_up', x: action.x, y: action.y, button: action.button };
  if (action.action === 'type') return { type: 'type_text', text: action.text ?? '' };
  if (action.action === 'press') return browserHostComputerUseKeyAction(action.key);
  if (action.action === 'scroll') return { type: 'wheel', x: action.x, y: action.y, deltaX: action.deltaX, deltaY: action.deltaY };
  if (action.action === 'cursor') return { type: 'cursor', x: action.x, y: action.y };
  return undefined;
}

function browserHostComputerUseKeyAction(key: string | undefined): BrowserHostComputerUseAction {
  const normalized = key?.trim() ?? '';
  if (!normalized) return { type: 'press_key', key: 'Enter' };
  const keys = normalized.split('+').map((part) => part.trim()).filter(Boolean);
  return keys.length > 1 ? { type: 'hotkey', keys } : { type: 'press_key', key: normalized };
}

function parseBrowserHostFrameStreamMessage(value: unknown): { type?: string; session?: BrowserHostSessionState; frameTransport?: string; binaryFrameId?: string } | undefined {
  try {
    const text = typeof value === 'string'
      ? value
      : typeof Blob !== 'undefined' && value instanceof Blob
        ? ''
        : String(value ?? '');
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as { type?: unknown; session?: unknown };
    return {
      type: typeof record.type === 'string' ? record.type : undefined,
      session: record.session && typeof record.session === 'object' ? record.session as BrowserHostSessionState : undefined,
      frameTransport: typeof (record as { frameTransport?: unknown }).frameTransport === 'string' ? (record as { frameTransport: string }).frameTransport : undefined,
      binaryFrameId: typeof (record as { binaryFrameId?: unknown }).binaryFrameId === 'string' ? (record as { binaryFrameId: string }).binaryFrameId : undefined,
    };
  } catch {
    return undefined;
  }
}

function browserHostFrameStreamBinaryLike(value: unknown) {
  return typeof Blob !== 'undefined' && value instanceof Blob
    || typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer
    || typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value);
}

function browserHostFrameTransportCarriesBinary(frameTransport: string | undefined) {
  return frameTransport === 'websocket-binary' || frameTransport === 'webrtc-data-channel';
}

function browserHostSameSessionCandidateFrameTransport(
  session: BrowserHostSessionState | undefined,
  frameTransport: string | undefined,
) {
  if (!browserHostSessionUsesCanvasBinaryRenderer(session)) return undefined;
  return browserHostFrameTransportCarriesBinary(frameTransport) ? frameTransport : undefined;
}

export async function drawBrowserHostCanvasBinaryFrame(
  canvas: HTMLCanvasElement,
  frame: BrowserHostCanvasBinaryFrame,
) {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const blob = browserHostCanvasBinaryFrameBlob(frame);
  if (!blob) return false;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      drawBrowserHostCanvasImage(canvas, context, bitmap.width, bitmap.height, bitmap);
      bitmap.close?.();
      return true;
    } catch {
      // Some runtimes expose createImageBitmap but cannot decode every Blob type.
    }
  }
  return drawBrowserHostCanvasImageFallback(canvas, context, blob);
}

function browserHostCanvasBinaryFrameBlob(frame: BrowserHostCanvasBinaryFrame) {
  if (typeof Blob === 'undefined') return undefined;
  if (typeof Blob !== 'undefined' && frame instanceof Blob) return frame;
  if (typeof ArrayBuffer !== 'undefined' && frame instanceof ArrayBuffer) {
    return new Blob([frame], { type: 'image/png' });
  }
  const view = frame as ArrayBufferView;
  const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  const bytes = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  return new Blob([bytes], { type: 'image/png' });
}

function drawBrowserHostCanvasImage(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  image: CanvasImageSource,
) {
  const nextWidth = Math.max(1, Math.round(width || canvas.width || 1));
  const nextHeight = Math.max(1, Math.round(height || canvas.height || 1));
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function drawBrowserHostCanvasImageFallback(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  blob: Blob,
) {
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(false);
  const objectUrl = URL.createObjectURL(blob);
  return new Promise<boolean>((resolve) => {
    const image = new Image();
    const finish = (drawn: boolean) => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
      resolve(drawn);
    };
    image.onload = () => {
      drawBrowserHostCanvasImage(canvas, context, image.naturalWidth, image.naturalHeight, image);
      finish(true);
    };
    image.onerror = () => finish(false);
    image.src = objectUrl;
  });
}

function browserHostCanvasBinaryElement(root: HTMLElement | null, sessionId: string) {
  return root?.querySelector<HTMLCanvasElement>(`canvas[data-browser-frame-renderer="canvas-binary"][data-browser-frame-session-id="${cssEscapeValue(sessionId)}"]`) ?? null;
}

function cssEscapeValue(value: string) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

function browserHostSessionUsesNativeSurface(session: BrowserHostSessionState | undefined) {
  return session?.liveSurfaceTransport === 'native-embedded';
}

function browserHostSessionUsesCanvasBinaryRenderer(session: BrowserHostSessionState | undefined) {
  return session?.liveSurfaceTransport === 'host-stream'
    && session.singleInteractiveTruth === true
    && session.frameStreamRef === `browser-host-session:${session.id}/frame-stream`;
}

function browserHostCanvasBinaryFrameTransport(session: BrowserHostSessionState | undefined, candidateTransport: string | undefined) {
  if (!browserHostSessionUsesCanvasBinaryRenderer(session)) return undefined;
  return candidateTransport === 'webrtc-data-channel' ? 'webrtc-data-channel' : 'websocket-binary';
}

function browserHostWebRtcRightPaneHandoff(
  session: BrowserHostSessionState | undefined,
  candidateTransport: string | undefined,
): BrowserWorkbenchLiveTransportHandoff | undefined {
  if (!session || candidateTransport !== 'webrtc-data-channel' || !browserHostSessionUsesCanvasBinaryRenderer(session)) return undefined;
  if (!session.liveSurfaceRef || !session.frameStreamRef) return undefined;
  return {
    status: 'candidate-contract',
    claim: 'bridge-to-right-pane-canvas-handoff-only',
    claimScope: 'candidate-only',
    owner: 'BrowserHostSession',
    rightPaneSurfaceOwner: 'BrowserHostSession',
    productSurface: 'right-pane-browser',
    renderTarget: 'canvas',
    frameRenderer: 'canvas-binary',
    frameTransport: 'webrtc-data-channel',
    fallbackTransport: 'websocket-binary',
    liveSurfaceTransportCandidate: 'webrtc-data-channel',
    hostSessionRef: `browser-host-session:${session.id}`,
    liveSurfaceRef: session.liveSurfaceRef,
    frameStreamRef: session.frameStreamRef,
    inlineFrameBytes: false,
    inlineSignals: false,
    secondViewer: false,
    secondTruthSource: false,
    httpFrameLiveFallback: false,
    fullyPassedClaim: false,
    realUiWebRtcPassClaim: false,
    loopbackEvidenceOnly: false,
    httpFrameRouteClaim: false,
  };
}

function browserHostActionWithUiTiming(action: RightPaneBrowserHostAction): RightPaneBrowserHostAction {
  const receivedAt = action.uiEventReceivedAt ?? new Date().toISOString();
  return {
    ...action,
    actionId: action.actionId ?? `ui-${receivedAt.replace(/[^0-9TZ]/g, '')}-${Math.random().toString(36).slice(2, 8)}`,
    uiEventReceivedAt: receivedAt,
  };
}

type DesktopBrowserHostSurfaceBridge = {
  attachBrowserHostSessionSurface?: (input: unknown) => Promise<unknown>;
  detachBrowserHostSessionSurface?: (input: unknown) => Promise<unknown>;
  getBrowserHostSessionSurfaceState?: (input: unknown) => Promise<unknown>;
};

function desktopBrowserHostSurfaceBridge(): DesktopBrowserHostSurfaceBridge | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as Window & { sciforgeDesktop?: DesktopBrowserHostSurfaceBridge }).sciforgeDesktop;
}

function browserHostNativeSurfaceElement(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[data-browser-native-surface="true"]') ?? null;
}

function browserHostNativeSurfaceBounds(root: HTMLElement | null) {
  const element = browserHostNativeSurfaceElement(root);
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function nativeBrowserHostSurfaceResultFailed(value: unknown) {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

function nativeBrowserHostSurfaceReason(value: unknown) {
  return value && typeof value === 'object' && typeof (value as { reason?: unknown }).reason === 'string'
    ? (value as { reason: string }).reason
    : undefined;
}

function rightPaneBrowserHostViewport(width: number, height: number) {
  return {
    width: clampBrowserHostViewport(Math.round(width || 1365), 640, 2400),
    height: clampBrowserHostViewport(Math.round((height || 900) - 42), 480, 1800),
  };
}

function normalizeRightPaneHostCursor(value: unknown) {
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

function clampBrowserHostViewport(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
