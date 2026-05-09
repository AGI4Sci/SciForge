import { useEffect, useMemo, useRef, useState } from 'react';
import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { estimateContextWindowState, latestContextWindowState } from '../contextWindow';
import { builtInScenarioPackageRef } from '../scenarioCompiler/scenarioPackage';
import { resetSession } from '../sessionStore';
import { SILENT_STREAM_WAIT_THRESHOLD_MS, buildSilentStreamProgressEvent, formatProgressHeadline, latestProgressModel } from '../processProgress';
import { coalesceStreamEvents, latestRunningEvent, streamEventCounts } from '../streamEventPresentation';
import { makeId, nowIso, type AgentContextWindowState, type AgentStreamEvent, type GuidanceQueueRecord, type SciForgeConfig, type SciForgeMessage, type SciForgeReference, type SciForgeRun, type SciForgeSession, type ObjectReference, type RuntimeArtifact, type RuntimeExecutionUnit, type ScenarioInstanceId, type ScenarioRuntimeOverride, type TimelineEventRecord } from '../domain';
import { writeWorkspaceFile } from '../api/workspaceClient';
import { exportJsonFile } from './exportUtils';
import { Badge, ClaimTag, ConfidenceBar, EvidenceTag, cx, type BadgeVariant } from './uiPrimitives';
import { AcceptancePanel } from './chat/AcceptancePanel';
import { ArchiveDrawer } from './chat/ArchiveDrawer';
import { ChatComposer } from './chat/ChatComposer';
import { ChatPanelHeader } from './chat/ChatPanelHeader';
import { ReferenceContextMenu } from './chat/ReferenceContextMenu';
import { RunReadinessBar } from './chat/RunReadinessBar';
import { MessageList } from './chat/MessageList';
import { RunningWorkProcess } from './chat/RunningWorkProcess';
import { RunExecutionProcess, RunKeyInfo } from './chat/RunExecutionProcess';
import { TargetInstanceSelector } from './chat/TargetInstanceSelector';
import { FinalMessageContent } from './chat/FinalMessageContent';
import { ContextWindowMeter } from './chat/ContextWindowMeter';
import { ObjectReferenceChips, SciForgeReferenceChips } from './chat/ReferenceChips';
import { CURRENT_TARGET_INSTANCE_VALUE, enabledPeerInstances, selectedPeerInstance } from './chat/targetInstance';
import { MessageContent, inlineObjectReferencesForMessage, unmentionedObjectReferencesForMessage } from './chat/MessageContent';
import { addComposerReferenceWithMarker, addPendingComposerReference, promptForComposerSend, removeComposerReference } from './chat/composerReferences';
import { runPromptOrchestrator } from './chat/runOrchestrator';
import { appendRunningGuidanceRecord, appendUploadMessageToSession, attachGuidanceQueueToSessionRun, createGuidanceQueueRecord, mergeAgentResponseIntoSession, rollbackSessionBeforeMessage, updateGuidanceQueueRecords } from './chat/sessionTransforms';
import { attachStreamProcessToFailedSession, attachStreamProcessToResponse, compactFailureNotice, guidanceBadgeVariant, guidanceStatusLabel, latestTokenUsage } from './chat/runPresentation';
import {
  artifactTypeForUploadedFileLike as artifactTypeForUploadedFile,
  sciForgeReferenceAttribute,
  objectReferenceForUploadedArtifact,
  objectReferenceKindLabel,
  parseSciForgeReferenceAttribute,
  previewKindForUploadedFileLike as previewKindForUploadedFile,
  referenceForMessage,
  referenceForObjectReference,
  referenceForRun,
  referenceForTextSelection,
  referenceForUiElement,
  referenceForUploadedArtifact,
  uploadedDerivativeHintsForFileLike as uploadedDerivativeHints,
  uploadedInlinePolicyForFileLike as uploadedInlinePolicy,
  uploadedLocatorHintsForFileLike as uploadedLocatorHints,
  uploadedPreviewActionsForFileLike as uploadedPreviewActions,
} from '../../../../packages/object-references';

export { objectReferenceKindLabel } from '../../../../packages/object-references';

interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioInstanceId;
  prompt: string;
}

interface ReferenceContextMenuState {
  x: number;
  y: number;
  reference: SciForgeReference;
}

function isBuiltInScenarioId(value: string): value is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIO_SPECS, value);
}

function builtInScenarioIdForInstance(scenarioId: ScenarioInstanceId, scenarioOverride?: ScenarioRuntimeOverride): ScenarioId {
  const skillDomain = scenarioOverride?.skillDomain;
  if (skillDomain === 'structure') return 'structure-exploration';
  if (skillDomain === 'omics') return 'omics-differential-exploration';
  if (skillDomain === 'knowledge') return 'biomedical-knowledge-graph';
  if (skillDomain === 'literature') return 'literature-evidence-review';
  if (typeof scenarioId === 'string' && isBuiltInScenarioId(scenarioId)) return scenarioId;
  return 'literature-evidence-review';
}

export function ChatPanel({
  scenarioId,
  role,
  config,
  session,
  input,
  savedScrollTop,
  onInputChange,
  onScrollTopChange,
  onSessionChange,
  onNewChat,
  onDeleteChat,
  archivedSessions,
  onRestoreArchivedSession,
  onDeleteArchivedSessions,
  onClearArchivedSessions,
  onEditMessage,
  onDeleteMessage,
  archivedCount,
  autoRunRequest,
  onAutoRunConsumed,
  scenarioOverride,
  onConfigChange,
  onTimelineEvent,
  activeRunId,
  onActiveRunChange,
  onMarkReusableRun,
  onObjectFocus,
  externalReferenceRequest,
  onExternalReferenceConsumed,
  availableComponentIds = [],
}: {
  scenarioId: ScenarioInstanceId;
  role: string;
  config: SciForgeConfig;
  session: SciForgeSession;
  input: string;
  savedScrollTop: number;
  onInputChange: (value: string) => void;
  onScrollTopChange: (value: number) => void;
  onSessionChange: (session: SciForgeSession) => void;
  onNewChat: () => void;
  onDeleteChat: () => void;
  archivedSessions: SciForgeSession[];
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSessions: (sessionIds: string[]) => void;
  onClearArchivedSessions: () => void;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  archivedCount: number;
  autoRunRequest?: HandoffAutoRunRequest;
  onAutoRunConsumed: (requestId: string) => void;
  scenarioOverride?: ScenarioRuntimeOverride;
  onConfigChange: (patch: Partial<SciForgeConfig>) => void;
  onTimelineEvent: (event: TimelineEventRecord) => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
  onMarkReusableRun: (runId: string) => void;
  onObjectFocus: (reference: ObjectReference) => void;
  externalReferenceRequest?: { id: string; reference: SciForgeReference };
  onExternalReferenceConsumed?: (requestId: string) => void;
  availableComponentIds?: string[];
}) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(58);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [streamEvents, setStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [retainedContextWindowState, setRetainedContextWindowState] = useState<AgentContextWindowState | undefined>();
  const [guidanceQueue, setGuidanceQueue] = useState<GuidanceQueueRecord[]>([]);
  const [referencePickMode, setReferencePickMode] = useState(false);
  const [targetInstanceName, setTargetInstanceName] = useState(CURRENT_TARGET_INSTANCE_VALUE);
  const [pendingReferences, setPendingReferences] = useState<SciForgeReference[]>([]);
  const [referenceContextMenu, setReferenceContextMenu] = useState<ReferenceContextMenuState | null>(null);
  const activeSessionRef = useRef(session);
  const inputRef = useRef(input);
  const guidanceQueueRef = useRef<GuidanceQueueRecord[]>([]);
  const streamEventsRef = useRef<AgentStreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const userAbortRequestedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoScrollRef = useRef(true);
  const savedScrollTopRef = useRef(savedScrollTop);
  const reportedScrollTopRef = useRef(savedScrollTop);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const messages = session.messages;
  const baseScenarioId = builtInScenarioIdForInstance(scenarioId, scenarioOverride);
  const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
  const scenarioPackageRef = scenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId);
  const skillPlanRef = scenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.default`;
  const uiPlanRef = scenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.default`;
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const visibleMessageStart = 0;
  const visibleMessages = messages.slice(visibleMessageStart);
  const liveTokenUsage = latestTokenUsage(streamEvents);
  const worklogCounts = streamEventCounts(streamEvents);
  const latestWorklogLine = formatProgressHeadline(latestProgressModel(streamEvents), latestRunningEvent(streamEvents));
  const latestStreamEventAt = streamEvents.at(-1)?.createdAt;
  const contextWindowState = latestContextWindowState(streamEvents)
    ?? retainedContextWindowState
    ?? estimateContextWindowState(session, config, streamEvents);
  const targetPeers = useMemo(() => enabledPeerInstances(config), [config.peerInstances]);
  const targetPeer = useMemo(() => selectedPeerInstance(config, targetInstanceName), [config.peerInstances, targetInstanceName]);

  useEffect(() => {
    activeSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    savedScrollTopRef.current = savedScrollTop;
  }, [savedScrollTop]);

  useEffect(() => {
    if (input.trim() || pendingReferences.length || referencePickMode) setComposerExpanded(true);
  }, [input, pendingReferences.length, referencePickMode]);

  useEffect(() => {
    guidanceQueueRef.current = guidanceQueue;
  }, [guidanceQueue]);

  useEffect(() => {
    streamEventsRef.current = streamEvents;
  }, [streamEvents]);

  useEffect(() => {
    setStreamEvents([]);
    streamEventsRef.current = [];
    setRetainedContextWindowState(undefined);
    setGuidanceQueue([]);
    setErrorText('');
  }, [scenarioId, session.sessionId]);

  useEffect(() => {
    if (targetInstanceName === CURRENT_TARGET_INSTANCE_VALUE) return;
    if (!targetPeer) setTargetInstanceName(CURRENT_TARGET_INSTANCE_VALUE);
  }, [targetInstanceName, targetPeer]);

  useEffect(() => {
    if (autoScrollRef.current) {
      window.requestAnimationFrame(() => {
        const element = messagesRef.current;
        if (!element) return;
        element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
      });
    }
  }, [messages.length, isSending, streamEvents.length]);

  useEffect(() => {
    if (!isSending) return undefined;
    let interval: number | undefined;
    const publishWaitingProgress = () => {
      const waitingEvent = buildSilentStreamProgressEvent({
        events: streamEventsRef.current,
        nowMs: Date.now(),
        backend: config.agentBackend,
      });
      if (!waitingEvent) return;
      setStreamEvents((current) => {
        const next = current.filter((event) => {
          const raw = typeof event.raw === 'object' && event.raw !== null ? event.raw as Record<string, unknown> : {};
          return raw.silentStreamWaiting !== true;
        });
        const updated = [...next.slice(-159), waitingEvent];
        streamEventsRef.current = updated;
        return updated;
      });
    };
    const latestEventTime = Date.parse(streamEventsRef.current.at(-1)?.createdAt ?? '');
    const elapsedMs = Number.isFinite(latestEventTime) ? Date.now() - latestEventTime : SILENT_STREAM_WAIT_THRESHOLD_MS;
    const timeout = window.setTimeout(() => {
      publishWaitingProgress();
      interval = window.setInterval(publishWaitingProgress, 15_000);
    }, Math.max(0, SILENT_STREAM_WAIT_THRESHOLD_MS - elapsedMs));
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [config.agentBackend, isSending, latestStreamEventAt]);

  useEffect(() => {
    if (!referencePickMode) return undefined;
    let highlighted: HTMLElement | null = null;
    document.body.classList.add('sciforge-reference-picking');
    const clearHighlight = () => {
      highlighted?.classList.remove('sciforge-reference-pick-hover');
      highlighted = null;
    };
    const setHighlight = (element: HTMLElement | null) => {
      if (highlighted === element) return;
      clearHighlight();
      highlighted = element;
      highlighted?.classList.add('sciforge-reference-pick-hover');
    };
    const handleMove = (event: MouseEvent) => {
      setHighlight(referenceTargetFromEvent(event)?.element ?? null);
    };
    const handleClick = (event: MouseEvent) => {
      const target = referenceTargetFromEvent(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      addPendingReferenceToComposer(target.reference);
      setReferencePickMode(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReferencePickMode(false);
    };
    document.addEventListener('mousemove', handleMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearHighlight();
      document.body.classList.remove('sciforge-reference-picking');
      document.removeEventListener('mousemove', handleMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [referencePickMode]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = textSelectionReferenceTarget(event);
      if (!target) {
        setReferenceContextMenu(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setReferenceContextMenu({
        x: Math.min(event.clientX, window.innerWidth - 190),
        y: Math.min(event.clientY, window.innerHeight - 72),
        reference: target.reference,
      });
    };
    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, []);

  useEffect(() => {
    if (!referenceContextMenu) return undefined;
    const close = () => setReferenceContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [referenceContextMenu]);

  useEffect(() => {
    if (!autoRunRequest || autoRunRequest.targetScenario !== scenarioId || isSending) return;
    onAutoRunConsumed(autoRunRequest.id);
    window.setTimeout(() => {
      void runPrompt(autoRunRequest.prompt, activeSessionRef.current);
    }, 120);
  }, [scenarioId, autoRunRequest, isSending, onAutoRunConsumed]);

  useEffect(() => {
    if (!externalReferenceRequest) return;
    addPendingReferenceToComposer(externalReferenceRequest.reference);
    onExternalReferenceConsumed?.(externalReferenceRequest.id);
  }, [externalReferenceRequest?.id]);

  useEffect(() => {
    setErrorText('');
    const frame = window.requestAnimationFrame(() => {
      const element = messagesRef.current;
      if (!element) return;
      const nextScrollTop = savedScrollTopRef.current;
      element.scrollTo({ top: nextScrollTop, behavior: 'auto' });
      reportedScrollTopRef.current = element.scrollTop;
      autoScrollRef.current = nextScrollTop <= 0 || element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scenarioId, session.sessionId]);

  async function handleSend() {
    const prompt = promptForComposerSend(input, pendingReferences);
    if (!prompt) return;
    if (isSending) {
      handleRunningGuidance(prompt);
      return;
    }
    await runPrompt(prompt, activeSessionRef.current, pendingReferences);
  }

  async function handleFileUpload(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) return;
    try {
      const uploaded = await Promise.all(selectedFiles.map((file) => fileToUploadedArtifact(file, scenarioId, config, activeSessionRef.current.sessionId)));
      const references = uploaded.map((artifact) => referenceForUploadedArtifact(artifact));
      const nextSession = appendUploadMessageToSession({
        session: activeSessionRef.current,
        uploaded,
        references,
        objectReferences: uploaded.map((artifact) => objectReferenceForUploadedArtifact(artifact)),
      });
      activeSessionRef.current = nextSession;
      onSessionChange(nextSession);
      references.forEach(addPendingReference);
      setErrorText('');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function addPendingReference(reference: SciForgeReference) {
    setPendingReferences((current) => addPendingComposerReference(current, reference));
  }

  function addPendingReferenceToComposer(reference: SciForgeReference) {
    const next = addComposerReferenceWithMarker({
      input: inputRef.current,
      pendingReferences,
      reference,
    });
    setPendingReferences(next.pendingReferences);
    inputRef.current = next.input;
    onInputChange(next.input);
  }

  function removePendingReference(referenceId: string) {
    const next = removeComposerReference({
      input: inputRef.current,
      pendingReferences,
      referenceId,
    });
    setPendingReferences(next.pendingReferences);
    inputRef.current = next.input;
    onInputChange(next.input);
  }

  function focusPendingReference(reference: SciForgeReference) {
    highlightReferencedContent(reference);
  }

  async function runPrompt(prompt: string, baseSession: SciForgeSession, references: SciForgeReference[] = []) {
    const preflightStreamEvents = streamEventsRef.current;
    onInputChange('');
    inputRef.current = '';
    setPendingReferences([]);
    setReferencePickMode(false);
    setComposerExpanded(false);
    setErrorText('');
    const queuedEvent: AgentStreamEvent = {
      id: makeId('evt'),
      type: 'queued',
      label: '已提交',
      detail: prompt,
      createdAt: nowIso(),
    };
    streamEventsRef.current = [queuedEvent];
    setStreamEvents([queuedEvent]);
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    userAbortRequestedRef.current = false;
    try {
      const handleStreamEvent = (event: AgentStreamEvent) => {
        const next = coalesceStreamEvents(streamEventsRef.current, event).slice(-160);
        streamEventsRef.current = next;
        const latestContext = latestContextWindowState(next);
        if (latestContext) setRetainedContextWindowState(latestContext);
        setStreamEvents(next);
      };
      const result = await runPromptOrchestrator({
        prompt,
        baseSession,
        references,
        scenarioId,
        baseScenarioId,
        scenarioName: scenario.name,
        scenarioDomain: scenario.domain,
        role,
        config,
        targetPeer,
        scenarioOverride,
        availableComponentIds,
        defaultComponentIds: scenarioOverride?.defaultComponents?.length
          ? scenarioOverride.defaultComponents
          : SCENARIO_SPECS[baseScenarioId].componentPolicy.defaultComponents,
        scenarioPackageRef,
        skillPlanRef,
        uiPlanRef,
        streamEvents: preflightStreamEvents,
        signal: controller.signal,
        userAbortRequested: () => userAbortRequestedRef.current,
        activeSession: () => activeSessionRef.current,
        onStreamEvent: handleStreamEvent,
        onOptimisticSession: (optimisticSession) => {
          onSessionChange(optimisticSession);
          activeSessionRef.current = optimisticSession;
        },
      });
      if (result.status === 'failed') {
        const failedSessionWithProcess = attachGuidanceQueueToSessionRun(
          attachStreamProcessToFailedSession(result.failedSession, result.failedRunId, streamEventsRef.current),
          result.failedRunId,
          guidanceQueueRef.current,
          'deferred',
          '当前 run 失败或中断前已接收追加引导，等待 run orchestration 下一轮处理。',
        );
        const failedMessage = failedSessionWithProcess.messages.at(-1)?.content ?? result.message;
        setErrorText(compactFailureNotice(failedMessage));
        onSessionChange(failedSessionWithProcess);
        activeSessionRef.current = failedSessionWithProcess;
        onActiveRunChange(result.failedRunId);
        return;
      }
      const finalResponseWithProcess = attachStreamProcessToResponse(result.finalResponse, streamEventsRef.current, guidanceQueueRef.current);
      const mergedSession = mergeAgentResponseIntoSession({
        baseSession: activeSessionRef.current,
        response: finalResponseWithProcess,
        scenarioPackageRef,
        skillPlanRef,
        uiPlanRef,
      });
      onSessionChange(mergedSession);
      activeSessionRef.current = mergedSession;
      onActiveRunChange(finalResponseWithProcess.run.id);
    } finally {
      setIsSending(false);
      abortRef.current = null;
      userAbortRequestedRef.current = false;
      const [nextGuidance, ...rest] = guidanceQueueRef.current;
      if (nextGuidance) {
        const mergedSession = updateGuidanceQueueRecords(activeSessionRef.current, [nextGuidance.id], {
          status: 'merged',
          reason: '当前 run 已结束，已按 run orchestration contract 合并为下一轮用户引导。',
        });
        activeSessionRef.current = mergedSession;
        onSessionChange(mergedSession);
        guidanceQueueRef.current = rest;
        setGuidanceQueue(rest);
        window.setTimeout(() => {
          void runPrompt(nextGuidance.prompt, activeSessionRef.current);
        }, 80);
      }
    }
  }

  function handleRunningGuidance(prompt: string) {
    const now = nowIso();
    const guidance = createGuidanceQueueRecord(prompt, {
      receivedAt: now,
      activeRunId,
      reason: '当前 backend run 正在执行，已排队等待 run orchestration 下一轮处理。',
    });
    const { session: nextSession } = appendRunningGuidanceRecord(activeSessionRef.current, guidance);
    activeSessionRef.current = nextSession;
    onSessionChange(nextSession);
    onInputChange('');
    inputRef.current = '';
    setComposerExpanded(false);
    setGuidanceQueue((current) => [...current, guidance]);
    setStreamEvents((current) => [...current.slice(-32), {
      id: makeId('evt'),
      type: 'guidance-queued',
      label: '引导已排队',
      detail: `${prompt}\n状态：已排队，等待当前 run 结束后合并到下一轮。`,
      createdAt: now,
      raw: {
        guidanceQueue: guidance,
        contract: 'guidance-queue/run-orchestration',
      },
    }]);
  }

  function handleAbort() {
    if (!abortRef.current) return;
    const interruptedAt = nowIso();
    const rejectedIds = guidanceQueueRef.current.map((item) => item.id);
    if (rejectedIds.length) {
      const rejectedSession = updateGuidanceQueueRecords(activeSessionRef.current, rejectedIds, {
        status: 'rejected',
        reason: '用户中断当前 backend run；尚未处理的排队引导已被清空。',
      });
      activeSessionRef.current = rejectedSession;
      onSessionChange(rejectedSession);
    }
    guidanceQueueRef.current = [];
    setGuidanceQueue([]);
    setStreamEvents((current) => [...current.slice(-31), {
      id: makeId('evt'),
      type: 'user-interrupt',
      label: '中断请求',
      detail: '用户请求中断当前 backend 运行；已关闭当前 HTTP stream，并清空排队引导。',
      createdAt: interruptedAt,
    }]);
    userAbortRequestedRef.current = true;
    abortRef.current.abort();
  }

  function beginComposerResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeStateRef.current = { startY: event.clientY, startHeight: composerHeight };
    const handleMove = (moveEvent: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const delta = state.startY - moveEvent.clientY;
      const nextHeight = Math.max(36, Math.min(360, state.startHeight + delta));
      setComposerHeight(nextHeight);
    };
    const handleUp = () => {
      resizeStateRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }

  function handleClear() {
    if (isSending) abortRef.current?.abort();
    onSessionChange(resetSession(scenarioId));
  }

  function handleExport() {
    exportJsonFile(`${scenarioId}-${session.sessionId}.json`, session);
  }

  const readiness = runReadiness({
    input,
    isSending,
    config,
    scenarioPackageRef,
    skillPlanRef,
    uiPlanRef,
  });

  function beginEditMessage(message: SciForgeMessage) {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  }

  function saveEditMessage() {
    const content = editingContent.trim();
    if (!editingMessageId || !content) return;
    const editedMessage = session.messages.find((message) => message.id === editingMessageId);
    setEditingMessageId(null);
    setEditingContent('');
    if (editedMessage?.role === 'user') {
      if (isSending) abortRef.current?.abort();
      void runPrompt(content, rollbackSessionBeforeMessage(session, editingMessageId), editedMessage.references ?? []);
      return;
    }
    onEditMessage(editingMessageId, content);
  }

  function handleMessagesScroll() {
    const element = messagesRef.current;
    if (!element) return;
    autoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (Math.abs(element.scrollTop - reportedScrollTopRef.current) < 1) return;
    reportedScrollTopRef.current = element.scrollTop;
    onScrollTopChange(element.scrollTop);
  }

  async function copyMessageContent(content: string) {
    try {
      await copyTextToClipboard(content);
      setErrorText('');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '复制失败：浏览器拒绝访问剪贴板。');
    }
  }

  return (
    <div className="chat-panel">
      <ChatPanelHeader
        scenario={scenario}
        config={config}
        archivedCount={archivedCount}
        isSending={isSending}
        onConfigChange={onConfigChange}
        onNewChat={onNewChat}
        onToggleHistory={() => setHistoryOpen((value) => !value)}
        onAbort={handleAbort}
        onExport={handleExport}
        onDeleteChat={onDeleteChat}
      />

      {historyOpen ? (
        <ArchiveDrawer
          currentSession={session}
          archivedSessions={archivedSessions}
          onRestore={(sessionId) => {
            onRestoreArchivedSession(sessionId);
            setHistoryOpen(false);
          }}
          onDelete={onDeleteArchivedSessions}
          onClear={onClearArchivedSessions}
        />
      ) : null}
      <MessageList
        refObject={messagesRef}
        hasMessages={messages.length > 0}
        visibleMessageCount={visibleMessages.length}
        collapsedBeforeCount={visibleMessageStart}
        onScroll={handleMessagesScroll}
        runningMessage={isSending ? (
          <div className="message scenario">
            <div className="message-body">
              <div className="message-meta">
                <strong>{scenario.name}</strong>
                <Badge variant="info">running</Badge>
              </div>
              <MessageContent content={latestWorklogLine || '正在规划、生成或执行 workspace task，过程日志默认折叠。'} references={[]} onObjectFocus={onObjectFocus} />
              <RunningWorkProcess
                events={streamEvents}
                counts={worklogCounts}
                tokenUsage={liveTokenUsage}
                backend={config.agentBackend}
                guidanceCount={guidanceQueue.length}
              />
            </div>
          </div>
        ) : null}
      >
        {visibleMessages.map((message, visibleIndex) => {
          const index = visibleMessageStart + visibleIndex;
          const messageRunId = runIdForMessage(message, index, messages, session.runs);
          const messageObjectReferences = message.role === 'user'
            ? []
            : unmentionedObjectReferencesForMessage(message, session, messageRunId);
          return (
          <div
            key={message.id}
            className={cx('message', message.role, activeRunId && messageRunId === activeRunId && 'active-run')}
            data-run-id={messageRunId}
            data-sciforge-reference={sciForgeReferenceAttribute(referenceForMessage(message, messageRunId))}
          >
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.role === 'user' ? '你' : message.role === 'system' ? '系统' : scenario.name}</strong>
                {messageRunId ? (
                  <button type="button" className="message-run-link" onClick={() => onActiveRunChange(messageRunId)}>
                    run {messageRunId.replace(/^run-/, '').slice(0, 8)}
                  </button>
                ) : null}
                {message.confidence ? <ConfidenceBar value={message.confidence} /> : null}
                {message.evidence ? <EvidenceTag level={message.evidence} /> : null}
                {message.claimType ? <ClaimTag type={message.claimType} /> : null}
                {messageRunId ? <VerificationTag model={verificationTagForRun(session.runs, messageRunId)} /> : null}
                {message.status === 'failed' ? <Badge variant="danger">failed</Badge> : null}
                {message.guidanceQueue ? <Badge variant={guidanceBadgeVariant(message.guidanceQueue.status)}>{guidanceStatusLabel(message.guidanceQueue.status)}</Badge> : null}
                {message.acceptance ? (
                  <Badge variant={message.acceptance.pass ? 'success' : message.acceptance.severity === 'repairable' ? 'warning' : 'danger'}>
                    gate {message.acceptance.severity}
                  </Badge>
                ) : null}
                <div className="message-actions">
                  <button
                    type="button"
                    onClick={() => void copyMessageContent(message.content)}
                    title="复制原始 Markdown"
                  >
                    复制
                  </button>
                  <button onClick={() => beginEditMessage(message)}>编辑</button>
                </div>
              </div>
              {editingMessageId === message.id ? (
                <div className="message-editor">
                  <textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} />
                  <div>
                    <button onClick={saveEditMessage}>保存</button>
                    <button onClick={() => setEditingMessageId(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <>
                  {message.role === 'user' ? (
                    <MessageContent
                      content={message.content}
                      references={inlineObjectReferencesForMessage(message, session, messageRunId)}
                      onObjectFocus={onObjectFocus}
                    />
                  ) : (
                    <>
                      {messageRunId ? (
                        <RunExecutionProcess
                          runId={messageRunId}
                          session={session}
                          trace={message.expandable}
                          onObjectFocus={onObjectFocus}
                        />
                      ) : null}
                      <FinalMessageContent
                        content={message.content}
                        references={inlineObjectReferencesForMessage(message, session, messageRunId)}
                        onObjectFocus={onObjectFocus}
                      />
                    </>
                  )}
                  {messageRunId && message.role !== 'user' ? (
                    <RunKeyInfo
                      runId={messageRunId}
                      session={session}
                      onObjectFocus={onObjectFocus}
                    />
                  ) : null}
                  {messageObjectReferences.length ? (
                    <ObjectReferenceChips
                      references={messageObjectReferences}
                      activeRunId={activeRunId}
                      onFocus={onObjectFocus}
                    />
                  ) : null}
                </>
              )}
              {message.references?.length ? (
                <SciForgeReferenceChips references={message.references} />
              ) : null}
              {message.acceptance && !message.acceptance.pass ? (
                <AcceptancePanel acceptance={message.acceptance} />
              ) : null}
            </div>
          </div>
          );
        })}
      </MessageList>

      {errorText ? (
        <div className="composer-error">
          <span>{errorText}</span>
          <small>可检查 Runtime Health、启动缺失服务，或改用当前场景的 workspace capability 重试。</small>
        </div>
      ) : null}
      <RunReadinessBar
        ok={readiness.ok}
        severity={readiness.severity}
        message={readiness.message}
        packageLabel={`${scenarioPackageRef.id}@${scenarioPackageRef.version}`}
      />
      <ChatComposer
        expanded={composerExpanded}
        input={input}
        isSending={isSending}
        composerHeight={composerHeight}
        referencePickMode={referencePickMode}
        pendingReferences={pendingReferences}
        contextMeter={<ContextWindowMeter state={contextWindowState} running={isSending} />}
        fileInputRef={fileInputRef}
        topAddon={(
          <TargetInstanceSelector
            peers={targetPeers}
            selected={targetPeer ? targetPeer.name : CURRENT_TARGET_INSTANCE_VALUE}
            onSelect={setTargetInstanceName}
          />
        )}
        referenceChips={(
          <SciForgeReferenceChips
            references={pendingReferences}
            onRemove={removePendingReference}
            onFocus={focusPendingReference}
          />
        )}
        onExpand={() => setComposerExpanded(true)}
        onCollapse={() => setComposerExpanded(false)}
        onToggleReferencePickMode={() => setReferencePickMode((value) => !value)}
        onFileUpload={(files) => void handleFileUpload(files)}
        onInputChange={onInputChange}
        onSend={() => void handleSend()}
        onAbort={handleAbort}
        onBeginResize={beginComposerResize}
      />
      {referenceContextMenu ? (
        <ReferenceContextMenu
          x={referenceContextMenu.x}
          y={referenceContextMenu.y}
          reference={referenceContextMenu.reference}
          onAdd={(reference) => {
            addPendingReferenceToComposer(reference);
            setReferenceContextMenu(null);
          }}
        />
      ) : null}
    </div>
  );
}

async function fileToUploadedArtifact(file: File, scenarioId: ScenarioInstanceId, config: SciForgeConfig, sessionId: string): Promise<RuntimeArtifact> {
  const id = makeId('upload');
  const safeSessionId = safeWorkspaceSegment(sessionId || 'sessionless');
  const safeFileName = safeWorkspaceSegment(file.name) || `${id}.bin`;
  const relativePath = `.sciforge/uploads/${safeSessionId}/${id}-${safeFileName}`;
  const workspaceRoot = config.workspacePath.replace(/\/+$/, '');
  if (!workspaceRoot) throw new Error('上传文件需要先配置 workspacePath。');
  const absolutePath = `${workspaceRoot}/${relativePath}`;
  const bytes = await file.arrayBuffer();
  await writeWorkspaceFile(absolutePath, arrayBufferToBase64(bytes), config, {
    encoding: 'base64',
    mimeType: file.type || 'application/octet-stream',
  });
  return {
    id,
    type: artifactTypeForUploadedFile(file),
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: {
      title: file.name,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: nowIso(),
      source: 'user-upload',
      storage: 'workspace-file',
      workspacePath: relativePath,
    },
    dataRef: relativePath,
    path: relativePath,
    previewDescriptor: {
      kind: previewKindForUploadedFile(file),
      source: 'path',
      ref: relativePath,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      title: file.name,
      inlinePolicy: uploadedInlinePolicy(file),
      derivatives: uploadedDerivativeHints(file, relativePath),
      actions: uploadedPreviewActions(file),
      locatorHints: uploadedLocatorHints(file),
    },
    data: {
      title: file.name,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      path: relativePath,
      previewKind: previewKindForUploadedFile(file),
      storage: 'workspace-file',
    },
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeWorkspaceSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

function enrichRepairRaw(raw: unknown, repairHistory: unknown, sourceRunId: string, failureReason?: string) {
  const repairMetadata = { acceptanceRepair: { sourceRunId, repairHistory, failureReason } };
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, ...repairMetadata }
    : { raw, ...repairMetadata };
}

function runReadiness({
  input,
  isSending,
  config,
  scenarioPackageRef,
  skillPlanRef,
  uiPlanRef,
}: {
  input: string;
  isSending: boolean;
  config: SciForgeConfig;
  scenarioPackageRef: RuntimeExecutionUnit['scenarioPackageRef'];
  skillPlanRef: string;
  uiPlanRef: string;
}) {
  if (!input.trim() && !isSending) {
    return {
      ok: false,
      severity: 'muted' as const,
      message: '输入研究问题后即可运行；Shift+Enter 换行，Enter 发送。',
    };
  }
  if (isSending) {
    return {
      ok: true,
      severity: 'info' as const,
      message: '当前 run 正在执行；继续输入会排队为下一条引导。',
    };
  }
  if (!config.workspacePath.trim()) {
    return {
      ok: false,
      severity: 'warning' as const,
      message: '缺少 workspace path，请先在设置中选择工作目录。',
    };
  }
  return {
    ok: true,
    severity: 'success' as const,
    message: `将使用 ${scenarioPackageRef?.id ?? 'built-in'} · ${skillPlanRef} · ${uiPlanRef} 运行。`,
  };
}

export function runIdForMessage(
  message: SciForgeMessage,
  index: number,
  messages: SciForgeMessage[],
  runs: SciForgeRun[],
) {
  if (!runs.length || message.id.startsWith('seed')) return undefined;
  if (message.role === 'user') {
    const normalizedContent = normalizeRunPrompt(message.content);
    const matchingRuns = runs.filter((run) => normalizeRunPrompt(run.prompt) === normalizedContent);
    const messageTime = Date.parse(message.createdAt);
    const nextUserMessage = messages
      .slice(index + 1)
      .find((item) => !item.id.startsWith('seed') && item.role === 'user');
    const nextUserTime = nextUserMessage ? Date.parse(nextUserMessage.createdAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(messageTime)) {
      const runInTurnWindow = matchingRuns.find((run) => {
        const runTime = Date.parse(run.createdAt);
        return Number.isFinite(runTime) && runTime >= messageTime && runTime < nextUserTime;
      });
      if (runInTurnWindow) return runInTurnWindow.id;
    }
    const promptOccurrence = messages
      .slice(0, index + 1)
      .filter((item) => !item.id.startsWith('seed') && item.role === 'user' && normalizeRunPrompt(item.content) === normalizedContent)
      .length - 1;
    return matchingRuns[promptOccurrence]?.id ?? matchingRuns.at(-1)?.id;
  }
  if (message.role !== 'scenario') return undefined;
  const responseIndex = messages
    .slice(0, index + 1)
    .filter((item) => !item.id.startsWith('seed') && item.role === 'scenario')
    .length - 1;
  return runs[responseIndex]?.id;
}

function normalizeRunPrompt(value: string) {
  return value.replace(/^运行中引导：/, '').trim();
}

function highlightReferencedContent(reference: SciForgeReference) {
  const element = elementForSciForgeReference(reference);
  if (!element) return;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.add('sciforge-reference-focus');
  window.setTimeout(() => element.classList.remove('sciforge-reference-focus'), 2200);
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const selectedText = typeof payload?.selectedText === 'string' ? payload.selectedText : '';
  if (selectedText) selectTextInElement(element, selectedText);
}

function elementForSciForgeReference(reference: SciForgeReference) {
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const sourceRef = typeof payload?.sourceRef === 'string' ? payload.sourceRef : reference.ref;
  const uiRef = sourceRef.replace(/^ui-text:/, '').replace(/#[^#]*$/, '');
  if (uiRef.startsWith('ui:')) {
    const selector = uiRef.slice(3);
    try {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) return element;
    } catch {
      // Ignore invalid selectors from legacy references and fall back to attribute matching.
    }
  }
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-sciforge-reference]'))) {
    const parsed = parseSciForgeReferenceAttribute(element.dataset.sciforgeReference);
    if (parsed?.id === reference.id || parsed?.ref === sourceRef || parsed?.ref === reference.ref) return element;
  }
  return undefined;
}

function selectTextInElement(element: HTMLElement, text: string) {
  const range = rangeForTextInElement(element, text);
  if (!range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function rangeForTextInElement(element: HTMLElement, text: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.textContent ?? '';
    const offset = value.indexOf(text);
    if (offset >= 0) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + text.length);
      return range;
    }
    node = walker.nextNode();
  }
  return undefined;
}

function textSelectionReferenceTarget(event?: MouseEvent): { element: HTMLElement; reference: SciForgeReference } | undefined {
  const rawTarget = event?.target instanceof Element ? event.target : undefined;
  if (rawTarget?.closest('.composer, .reference-pick-banner, .settings-dialog, .reference-context-menu')) return undefined;
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim();
  if (!selection || selection.rangeCount === 0 || !selectedText) return undefined;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  const element = ancestor?.closest<HTMLElement>('[data-sciforge-reference], .message, .registry-slot, .card, .data-preview-table, table, section');
  if (!element || element.closest('.composer, .reference-pick-banner, .settings-dialog')) return undefined;
  if (rawTarget && !element.contains(rawTarget) && !rawTarget.contains(element)) return undefined;
  const sourceReference = parseSciForgeReferenceAttribute(element.dataset.sciforgeReference) ?? referenceForUiElement(element);
  const reference = referenceForTextSelection({ sourceReference, selectedText });
  if (!reference) return undefined;
  return {
    element,
    reference,
  };
}

function referenceTargetFromEvent(event: MouseEvent): { element: HTMLElement; reference: SciForgeReference } | undefined {
  const rawTarget = event.target instanceof Element ? event.target : undefined;
  if (!rawTarget || rawTarget.closest('.composer, .reference-pick-banner, .settings-dialog')) return undefined;
  const explicit = rawTarget.closest<HTMLElement>('[data-sciforge-reference]');
  if (explicit) {
    const reference = parseSciForgeReferenceAttribute(explicit.dataset.sciforgeReference);
    if (reference) return { element: explicit, reference };
  }
  const implicit = rawTarget.closest<HTMLElement>('button, [role="button"], .registry-slot, .card, .message, .data-preview-table, table, canvas, svg, section');
  if (!implicit || !(implicit instanceof HTMLElement) || implicit.closest('.composer, .reference-pick-banner, .settings-dialog')) return undefined;
  return { element: implicit, reference: referenceForUiElement(implicit) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type VerificationTagModel = {
  label: string;
  title: string;
  variant: BadgeVariant;
};

function VerificationTag({ model }: { model?: VerificationTagModel }) {
  if (!model) return null;
  return <span title={model.title}><Badge variant={model.variant}>{model.label}</Badge></span>;
}

function verificationTagForRun(runs: SciForgeRun[], runId: string): VerificationTagModel | undefined {
  const run = runs.find((item) => item.id === runId);
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const result = firstVerificationResult(raw);
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const displayVerification = isRecord(displayIntent?.verification) ? displayIntent.verification : undefined;
  const verdict = stringField(result?.verdict) ?? stringField(displayVerification?.verdict);
  if (!verdict) return undefined;
  const critique = stringField(result?.critique) ?? stringField(result?.reason);
  return {
    label: `Verification: ${verificationVerdictLabel(verdict)}`,
    title: critique || `Verification ${verdict}`,
    variant: verificationVerdictVariant(verdict),
  };
}

function firstVerificationResult(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const direct = raw?.verificationResult;
  if (isRecord(direct)) return direct;
  const list = Array.isArray(raw?.verificationResults) ? raw.verificationResults : [];
  return list.find(isRecord);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function verificationVerdictLabel(verdict: string) {
  const labels: Record<string, string> = {
    pass: '已验证',
    fail: '未通过',
    uncertain: '不确定',
    'needs-human': '需人工核验',
    unverified: '未验证',
  };
  return labels[verdict] ?? verdict;
}

function verificationVerdictVariant(verdict: string): BadgeVariant {
  if (verdict === 'pass') return 'success';
  if (verdict === 'fail') return 'danger';
  if (verdict === 'needs-human' || verdict === 'uncertain') return 'warning';
  return 'muted';
}

export function mergeRunTimelineEvents(events: TimelineEventRecord[], previousSession: SciForgeSession | undefined, nextSession: SciForgeSession) {
  const previousRunIds = new Set(previousSession?.runs.map((run) => run.id) ?? []);
  const existingEventIds = new Set(events.map((event) => event.id));
  const newEvents = nextSession.runs
    .filter((run) => !previousRunIds.has(run.id))
    .map((run) => timelineEventFromStoredRun(nextSession, run))
    .filter((event) => !existingEventIds.has(event.id));
  return [...newEvents, ...events].slice(0, 200);
}

function timelineEventFromStoredRun(session: SciForgeSession, run: SciForgeSession['runs'][number]): TimelineEventRecord {
  const runArtifactRefs = session.artifacts
    .filter((artifact) => artifact.producerScenario === session.scenarioId)
    .slice(0, 8)
    .map((artifact) => artifact.id);
  const runUnitRefs = [
    ...session.executionUnits.slice(0, 8).map((unit) => unit.id),
    run.skillPlanRef,
    run.uiPlanRef,
    run.scenarioPackageRef ? `${run.scenarioPackageRef.id}@${run.scenarioPackageRef.version}` : undefined,
  ].filter((value): value is string => Boolean(value));
  const promptSummary = run.prompt ? ` · ${run.prompt.slice(0, 100)}` : '';
  const failureSummary = run.status === 'failed' && run.response ? ` · ${run.response.slice(0, 120)}` : '';
  return {
    id: `timeline-${run.id}`,
    actor: 'SciForge Runtime',
    action: `run.${run.status}`,
    subject: `${session.scenarioId}:${run.id}${promptSummary}${failureSummary}`,
    artifactRefs: runArtifactRefs,
    executionUnitRefs: Array.from(new Set(runUnitRefs)),
    beliefRefs: session.claims.slice(0, 8).map((claim) => claim.id),
    branchId: session.scenarioId,
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: run.completedAt ?? run.createdAt ?? nowIso(),
  };
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to execCommand for embedded browsers or clipboard permission quirks.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    if (!document.execCommand('copy')) throw new Error('复制失败：浏览器拒绝访问剪贴板。');
  } finally {
    textarea.remove();
  }
}
