import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { buildSilentStreamRunId, guidanceQueuedEvent, isLiveRuntimeCodexMessage, isSeedDemoOrFixtureMessage, userInterruptEvent } from '@sciforge-ui/runtime-contract';
import { estimateContextWindowState, latestContextWindowState } from '../contextWindow';
import { builtInScenarioPackageRef } from '@sciforge/scenario-core/scenario-package';
import { builtInScenarioIdForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';
import { resetSession } from '../sessionStore';
import { buildRequestAcceptedProgressEvent, buildSilentStreamProgressEvent, silentStreamWaitThresholdMs } from '../processProgress';
import { assistantDraftFromStreamEvents, coalesceStreamEvents, streamEventCounts } from '../streamEventPresentation';
import { makeId, nowIso, type AgentContextWindowState, type AgentStreamEvent, type GuidanceQueueRecord, type GuidanceQueueStatus, type SciForgeConfig, type SciForgeMessage, type SciForgeReference, type SciForgeRun, type SciForgeSession, type ObjectReference, type ScenarioInstanceId, type ScenarioRuntimeOverride, type TimelineEventRecord } from '../domain';
import { exportJsonFile } from './exportUtils';
import { Badge, ClaimTag, ConfidenceBar, EvidenceTag, cx } from './uiPrimitives';
import {
  createCancelRunUIAction,
  createConcurrencyDecisionUIAction,
  createSubmitTurnUIAction,
  recordUIActionInSession,
  type UIAction,
} from './uiActionBoundary';
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
import { SciForgeReferenceChips } from './chat/ReferenceChips';
import { CURRENT_TARGET_INSTANCE_VALUE, enabledPeerInstances, selectedPeerInstance } from './chat/targetInstance';
import { MessageContent, inlineObjectReferencesForMessage } from './chat/MessageContent';
import { sanitizeUserProjectionText } from './conversation-projection-view-model';
import { addComposerReferenceWithMarker, addPendingComposerReference, composerReferenceForObjectReference, promptForComposerSend, removeComposerReference } from './chat/composerReferences';
import { runPromptOrchestrator } from './chat/runOrchestrator';
import type { CodexRealtimeControlSender } from '../api/sciforgeToolsClient';
import { appendRunningGuidanceRecord, appendUploadMessageToSession, applyHistoricalUserMessageEdit, attachGuidanceQueueToSessionRun, createGuidanceQueueRecord, mergeAgentResponseIntoSession, resolveGuidanceQueueAfterRun, updateGuidanceQueueRecords } from './chat/sessionTransforms';
import { attachStreamProcessToFailedSession, attachStreamProcessToResponse, compactFailureNotice, guidanceBadgeVariant, guidanceStatusLabel, latestTokenUsage } from './chat/runPresentation';
import { RunVerificationTag, runIdForMessage } from './chat/messageRunPresentation';
import { runReadiness, runningMessageContentFromStream, runtimeReadinessIssue } from './chat/runStatusPresentation';
import { waitForNextPaint } from './chat/nextPaint';
import { fileToUploadedArtifact, objectReferenceForUploadedArtifact, referenceForUploadedArtifact } from './chat/uploadedArtifact';
import type { RuntimeHealthItem } from './runtimeHealthPanel';
import { createGuiProtocolController } from './guiProtocol';
import {
  sciForgeReferenceAttribute,
  objectReferenceKindLabel,
  parseSciForgeReferenceAttribute,
  referenceForMessage,
  referenceForObjectReference,
  referenceForTextSelection,
  referenceForUiElement,
} from '../../../../packages/support/object-references';

export { objectReferenceKindLabel } from '../../../../packages/support/object-references';
export { runIdForMessage } from './chat/messageRunPresentation';
export { runningMessageContentFromStream } from './chat/runStatusPresentation';
export { mergeRunTimelineEvents } from './chat/runTimelinePresentation';

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

function builtInScenarioIdForInstance(scenarioId: ScenarioInstanceId, scenarioOverride?: ScenarioRuntimeOverride): ScenarioId {
  return builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride });
}

function messageProvenanceKind(message: SciForgeMessage) {
  if (isLiveRuntimeCodexMessage(message)) return 'live-runtime-codex';
  const kind = message.provenance?.kind;
  if (kind && isInternalMessageProvenance(kind)) return 'runtime-result';
  return kind
    ?? (message.role === 'user' ? 'user-authored' : message.role === 'system' ? 'system-ui' : 'seed-demo');
}

function MessageProvenanceBadge({ message }: { message: SciForgeMessage }) {
  const kind = messageProvenanceKind(message);
  if (isLiveRuntimeCodexMessage(message) || kind === 'live-runtime-codex' || kind === 'runtime-result' || kind === 'user-authored') return null;
  if (isSeedDemoOrFixtureMessage(message)) {
    return <Badge variant={kind === 'fixture' ? 'muted' : 'warning'}>{kind === 'fixture' ? 'fixture' : 'seed-demo'}</Badge>;
  }
  if (kind === 'system-ui') return <Badge variant="muted">系统消息</Badge>;
  return <Badge variant="muted">{kind}</Badge>;
}

function messageProvenanceAttribute(kind: string) {
  if (kind === 'user-authored') return 'user-message';
  if (kind === 'system-ui') return 'system-message';
  if (kind === 'live-runtime-codex' || kind === 'runtime-result') return 'assistant-result';
  if (kind === 'seed-demo' || kind === 'fixture') return kind;
  return 'message';
}

function isInternalMessageProvenance(value: string) {
  return /^(?:native-message|live-runtime-codex|runtime-result|codex-command(?:-|$))|(?:^|[:/])codex-command(?:-|$)/i.test(value);
}

function shouldShowMessageDiagnosticBadges(message: SciForgeMessage, provenanceKind: string) {
  return message.role !== 'user' && provenanceKind !== 'live-runtime-codex' && provenanceKind !== 'runtime-result';
}

function visibleMessageReference(message: SciForgeMessage) {
  return referenceForMessage(message);
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
  runtimeHealth = [],
  workspaceObjectReferences = [],
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
  runtimeHealth?: RuntimeHealthItem[];
  workspaceObjectReferences?: ObjectReference[];
}) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(58);
  const [composerExpanded, setComposerExpanded] = useState(() => shouldOpenComposerByDefault(session));
  const [streamEvents, setStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [retainedContextWindowState, setRetainedContextWindowState] = useState<AgentContextWindowState | undefined>();
  const [guidanceQueue, setGuidanceQueue] = useState<GuidanceQueueRecord[]>([]);
  const [referencePickMode, setReferencePickMode] = useState(false);
  const [targetInstanceName, setTargetInstanceName] = useState(CURRENT_TARGET_INSTANCE_VALUE);
  const [pendingReferences, setPendingReferences] = useState<SciForgeReference[]>([]);
  const [referenceContextMenu, setReferenceContextMenu] = useState<ReferenceContextMenuState | null>(null);
  const activeSessionRef = useRef(session);
  const inputRef = useRef(input);
  const pendingReferencesRef = useRef<SciForgeReference[]>([]);
  const guidanceQueueRef = useRef<GuidanceQueueRecord[]>([]);
  const uiActionAuditLogRef = useRef<UIAction[]>([]);
  const streamEventsRef = useRef<AgentStreamEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const realtimeControlRef = useRef<CodexRealtimeControlSender | null>(null);
  const userAbortRequestedRef = useRef(false);
  const activeRunTokenRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
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
  const runningMessageContent = runningMessageContentFromStream(assistantDraft, streamEvents);
  const latestStreamEventAt = streamEvents.at(-1)?.createdAt;
  const contextWindowState = latestContextWindowState(streamEvents)
    ?? retainedContextWindowState
    ?? estimateContextWindowState(session, config, streamEvents);
  const targetPeers = useMemo(() => enabledPeerInstances(config), [config.peerInstances]);
  const targetPeer = useMemo(() => selectedPeerInstance(config, targetInstanceName), [config.peerInstances, targetInstanceName]);
  const guiProtocolSurface = useMemo(() => {
    const selectedRefs = pendingReferences.map((reference) => reference.ref);
    const controller = createGuiProtocolController({
      focusedPanel: 'chat',
      hotRegion: {
        panel: 'chat',
        selectedRefs,
        primaryRef: selectedRefs[0],
        interactionMode: isSending ? 'editing' : 'idle',
        lastChangeOrigin: 'user',
        lastChangeAt: nowIso(),
        availableActions: [{ label: 'Submit turn', commandText: selectedRefs[0] ? `ask --ref ${JSON.stringify(selectedRefs[0])} "<prompt>"` : '/runtime-codex submit "<prompt>"' }],
      },
    });
    const shell = controller.getContext({ level: 'shell' }) as { availableGuiTools: string[] };
    const hot = controller.getContext({ level: 'hot-region' }) as { hotRegion: { availableActions: Array<{ commandText: string }> } };
    return {
      tools: shell.availableGuiTools,
      commandText: hot.hotRegion.availableActions[0]?.commandText ?? '/runtime-codex submit "<prompt>"',
    };
  }, [isSending, pendingReferences]);

  useLayoutEffect(() => {
    activeSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    pendingReferencesRef.current = pendingReferences;
  }, [pendingReferences]);

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

  useLayoutEffect(() => {
    activeRunTokenRef.current += 1;
    userAbortRequestedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsSending(false);
    setStreamEvents([]);
    streamEventsRef.current = [];
    setAssistantDraft('');
    setRetainedContextWindowState(undefined);
    setGuidanceQueue([]);
    guidanceQueueRef.current = [];
    setErrorText('');
    setComposerExpanded(shouldOpenComposerByDefault(session));
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
        runId: buildSilentStreamRunId({
          sessionId: session.sessionId,
          prompt: streamEventsRef.current.find((event) => event.type === 'queued')?.detail,
        }),
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
    const waitThresholdMs = silentStreamWaitThresholdMs(streamEventsRef.current);
    const latestEventTime = Date.parse(streamEventsRef.current.at(-1)?.createdAt ?? '');
    const elapsedMs = Number.isFinite(latestEventTime) ? Date.now() - latestEventTime : waitThresholdMs;
    const timeout = window.setTimeout(() => {
      publishWaitingProgress();
      const repeatMs = Math.max(3_000, Math.min(waitThresholdMs, 5_000));
      interval = window.setInterval(publishWaitingProgress, repeatMs);
    }, Math.max(0, waitThresholdMs - elapsedMs));
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
      void submitTurn(autoRunRequest.prompt);
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
    const currentPendingReferences = pendingReferencesRef.current;
    const prompt = promptForComposerSend(inputRef.current, currentPendingReferences);
    if (!prompt) return;
    if (isSending) {
      handleRunningGuidance(prompt, currentPendingReferences);
      return;
    }
    const runtimeIssue = runtimeReadinessIssue(runtimeHealth);
    if (runtimeIssue) {
      setErrorText(runtimeIssue.message);
      setComposerExpanded(true);
      return;
    }
    await submitTurn(prompt, currentPendingReferences);
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
    setPendingReferences((current) => {
      const next = addPendingComposerReference(current, reference);
      pendingReferencesRef.current = next;
      return next;
    });
  }

  function handleObjectReferenceClick(reference: ObjectReference) {
    onObjectFocus(reference);
    addPendingReferenceToComposer(composerReferenceForObjectReference(reference));
  }

  function addPendingReferenceToComposer(reference: SciForgeReference) {
    const next = addComposerReferenceWithMarker({
      input: inputRef.current,
      pendingReferences: pendingReferencesRef.current,
      reference,
    });
    setPendingReferences(next.pendingReferences);
    pendingReferencesRef.current = next.pendingReferences;
    inputRef.current = next.input;
    onInputChange(next.input);
    setComposerExpanded(true);
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function removePendingReference(referenceId: string) {
    const next = removeComposerReference({
      input: inputRef.current,
      pendingReferences: pendingReferencesRef.current,
      referenceId,
    });
    setPendingReferences(next.pendingReferences);
    pendingReferencesRef.current = next.pendingReferences;
    inputRef.current = next.input;
    onInputChange(next.input);
  }

  function focusPendingReference(reference: SciForgeReference) {
    highlightReferencedContent(reference);
  }

  async function submitTurn(prompt: string, references: SciForgeReference[] = []) {
    recordUIAction(createSubmitTurnUIAction({
      id: makeId('ui-action'),
      session: activeSessionRef.current,
      createdAt: nowIso(),
      prompt,
      references,
    }));
    await runPrompt(prompt, activeSessionRef.current, references);
  }

  async function runPrompt(prompt: string, baseSession: SciForgeSession, references: SciForgeReference[] = [], sourceGuidance?: GuidanceQueueRecord) {
    const runToken = activeRunTokenRef.current + 1;
    activeRunTokenRef.current = runToken;
    const turnSessionId = baseSession.sessionId;
    const isCurrentTurn = () => activeRunTokenRef.current === runToken && activeSessionRef.current.sessionId === turnSessionId;
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
    const acceptedEvent = buildRequestAcceptedProgressEvent(prompt);
    const initialEvents = [queuedEvent, acceptedEvent];
    streamEventsRef.current = initialEvents;
    setStreamEvents(initialEvents);
    setAssistantDraft('');
    setIsSending(true);
    await waitForNextPaint();
    const controller = new AbortController();
    abortRef.current = controller;
    realtimeControlRef.current = null;
    userAbortRequestedRef.current = false;
    let runFailed = false;
    let runEndedReason: string | undefined;
    try {
      const handleStreamEvent = (event: AgentStreamEvent) => {
        if (!isCurrentTurn()) return;
        const next = coalesceStreamEvents(streamEventsRef.current, event).slice(-160);
        streamEventsRef.current = next;
        const latestContext = latestContextWindowState(next);
        if (latestContext) setRetainedContextWindowState(latestContext);
        setStreamEvents(next);
        setAssistantDraft(assistantDraftFromStreamEvents(next));
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
          if (!isCurrentTurn()) return;
          onSessionChange(optimisticSession);
          activeSessionRef.current = optimisticSession;
        },
        onRealtimeControlReady: (sender) => {
          if (!isCurrentTurn()) return;
          realtimeControlRef.current = sender;
        },
      });
      if (!isCurrentTurn()) return;
      if (result.status === 'failed') {
        runFailed = true;
        runEndedReason = '当前 run 失败；追加引导已保留为 deferred，等待用户确认、修复或重新运行后再合并。';
        restoreSubmittedDraftAfterFailure(prompt, references, sourceGuidance);
        const activeGuidanceForRun = guidanceForCurrentRun(sourceGuidance, guidanceQueueRef.current);
        const failedSessionWithProcess = attachGuidanceQueueToSessionRun(
          attachStreamProcessToFailedSession(result.failedSession, result.failedRunId, streamEventsRef.current),
          result.failedRunId,
          activeGuidanceForRun,
          'deferred',
          '当前 run 失败或中断前已接收追加引导，等待 run orchestration 下一轮处理。',
        );
        const failedMessage = failedSessionWithProcess.messages.at(-1)?.content ?? result.message;
        setErrorText(compactFailureNotice(failedMessage));
        const failedSessionWithHandledGuidance = markGuidanceTerminalOutcome(failedSessionWithProcess, sourceGuidance, {
          status: 'deferred',
          handlingRunId: result.failedRunId,
          reason: runEndedReason,
        });
        onSessionChange(failedSessionWithHandledGuidance);
        activeSessionRef.current = failedSessionWithHandledGuidance;
        onActiveRunChange(result.failedRunId);
        return;
      }
      const finalResponseWithProcess = attachStreamProcessToResponse(result.finalResponse, streamEventsRef.current, guidanceForCurrentRun(sourceGuidance, guidanceQueueRef.current));
      const mergedSession = mergeAgentResponseIntoSession({
        baseSession: activeSessionRef.current,
        response: finalResponseWithProcess,
        scenarioPackageRef,
        skillPlanRef,
        uiPlanRef,
      });
      const mergedSessionWithHandledGuidance = markGuidanceHandledByRun(mergedSession, sourceGuidance, finalResponseWithProcess.run.id);
      onSessionChange(mergedSessionWithHandledGuidance);
      activeSessionRef.current = mergedSessionWithHandledGuidance;
      onActiveRunChange(finalResponseWithProcess.run.id);
    } catch (error) {
      if (!isCurrentTurn()) return;
      const wasUserCancelled = userAbortRequestedRef.current;
      runFailed = !wasUserCancelled;
      runEndedReason = wasUserCancelled
        ? '用户显式中断当前 backend run；正在处理的追加引导已跨过 cancel boundary，不能自动恢复。'
        : '当前 run 在 backend orchestration 期间异常结束；追加引导已保留为 deferred，等待用户确认、修复或重新运行后再合并。';
      const message = error instanceof Error ? error.message : String(error);
      restoreSubmittedDraftAfterFailure(prompt, references, sourceGuidance);
      setErrorText(compactFailureNotice(message || runEndedReason));
      const sessionWithSourceGuidance = markGuidanceTerminalOutcome(activeSessionRef.current, sourceGuidance, {
        status: wasUserCancelled ? 'rejected' : 'deferred',
        handlingRunId: wasUserCancelled ? 'cancelled-before-run-result' : 'orchestrator-throw',
        reason: runEndedReason,
      });
      if (sessionWithSourceGuidance !== activeSessionRef.current) {
        activeSessionRef.current = sessionWithSourceGuidance;
        onSessionChange(sessionWithSourceGuidance);
      }
    } finally {
      if (activeRunTokenRef.current !== runToken) return;
      const wasUserCancelled = userAbortRequestedRef.current;
      setIsSending(false);
      setAssistantDraft('');
      abortRef.current = null;
      realtimeControlRef.current = null;
      userAbortRequestedRef.current = false;
      const guidanceResolution = resolveGuidanceQueueAfterRun(activeSessionRef.current, guidanceQueueRef.current, {
        userCancelled: wasUserCancelled,
        runFailed,
        runEndedReason,
      });
      if (guidanceResolution.session !== activeSessionRef.current) {
        activeSessionRef.current = guidanceResolution.session;
        onSessionChange(guidanceResolution.session);
      }
      guidanceQueueRef.current = guidanceResolution.remainingQueue;
      setGuidanceQueue(guidanceResolution.remainingQueue);
      const nextGuidance = guidanceResolution.nextGuidance;
      if (nextGuidance) {
        window.setTimeout(() => {
          void runPrompt(nextGuidance.prompt, activeSessionRef.current, nextGuidance.references ?? [], nextGuidance);
        }, 80);
      }
    }
  }

  function clearTransientTurnState() {
    streamEventsRef.current = [];
    guidanceQueueRef.current = [];
    setStreamEvents([]);
    setAssistantDraft('');
    setRetainedContextWindowState(undefined);
    setGuidanceQueue([]);
    setPendingReferences([]);
    setReferencePickMode(false);
    setReferenceContextMenu(null);
    setErrorText('');
    setIsSending(false);
  }

  function handleNewChat() {
    activeRunTokenRef.current += 1;
    userAbortRequestedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    inputRef.current = '';
    onInputChange('');
    onActiveRunChange(undefined);
    clearTransientTurnState();
    onNewChat();
  }

  function markGuidanceHandledByRun(session: SciForgeSession, guidance: GuidanceQueueRecord | undefined, handlingRunId: string) {
    return markGuidanceTerminalOutcome(session, guidance, {
      status: 'merged',
      handlingRunId,
      reason: '排队引导已作为独立下一轮发送，并绑定到实际处理 run。',
    });
  }

  function markGuidanceTerminalOutcome(
    session: SciForgeSession,
    guidance: GuidanceQueueRecord | undefined,
    outcome: { status: GuidanceQueueStatus; handlingRunId: string; reason: string },
  ) {
    if (!guidance) return session;
    return updateGuidanceQueueRecords(session, [guidance.id], {
      status: outcome.status,
      handlingRunId: outcome.handlingRunId,
      reason: outcome.reason,
    });
  }

  function guidanceForCurrentRun(sourceGuidance: GuidanceQueueRecord | undefined, queue: GuidanceQueueRecord[]) {
    const records = [
      ...(sourceGuidance ? [sourceGuidance] : []),
      ...queue.filter((item) => item.status === 'queued'),
    ];
    const seen = new Set<string>();
    return records.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  function restoreSubmittedDraftAfterFailure(
    prompt: string,
    references: SciForgeReference[],
    sourceGuidance?: GuidanceQueueRecord,
  ) {
    if (sourceGuidance) return;
    if (inputRef.current.trim() || pendingReferencesRef.current.length) return;
    inputRef.current = prompt;
    onInputChange(prompt);
    pendingReferencesRef.current = references;
    setPendingReferences(references);
    setComposerExpanded(true);
  }

  function handleRunningGuidance(prompt: string, references: SciForgeReference[] = pendingReferencesRef.current) {
    const now = nowIso();
    recordUIAction(createConcurrencyDecisionUIAction({
      id: makeId('ui-action'),
      session: activeSessionRef.current,
      createdAt: now,
      activeRunId,
      decision: 'queue-guidance',
      prompt,
    }));
    const guidance = createGuidanceQueueRecord(prompt, {
      references,
      receivedAt: now,
      activeRunId,
      reason: '当前 backend run 正在执行，已排队等待 run orchestration 下一轮处理。',
    });
    const { session: nextSession } = appendRunningGuidanceRecord(activeSessionRef.current, guidance);
    activeSessionRef.current = nextSession;
    onSessionChange(nextSession);
    onInputChange('');
    inputRef.current = '';
    setPendingReferences([]);
    pendingReferencesRef.current = [];
    setComposerExpanded(false);
    const nextQueue = [...guidanceQueueRef.current, guidance];
    guidanceQueueRef.current = nextQueue;
    setGuidanceQueue(nextQueue);
    realtimeControlRef.current?.send({
      controlType: 'interrupt',
      mode: 'queue-next-turn',
      message: prompt,
      requestId: guidance.id,
      reason: 'running-guidance',
    });
    setStreamEvents((current) => [...current.slice(-32), guidanceQueuedEvent({ id: makeId('evt'), createdAt: now }, guidance)]);
  }

  function handleAbort() {
    if (!abortRef.current) return;
    const interruptedAt = nowIso();
    const rejectedIds = guidanceQueueRef.current.map((item) => item.id);
    recordUIAction(createCancelRunUIAction({
      id: makeId('ui-action'),
      session: activeSessionRef.current,
      createdAt: interruptedAt,
      runId: activeRunId,
      rejectedGuidanceIds: rejectedIds,
    }));
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
    setStreamEvents((current) => [...current.slice(-31), userInterruptEvent({ id: makeId('evt'), createdAt: interruptedAt })]);
    userAbortRequestedRef.current = true;
    const sentControl = realtimeControlRef.current?.send({
      controlType: 'cancel',
      requestId: makeId('cancel'),
      reason: 'user-interrupt',
    }) === true;
    if (sentControl) {
      window.setTimeout(() => abortRef.current?.abort(), 150);
      return;
    }
    abortRef.current.abort();
  }

  function recordUIAction(action: UIAction) {
    const nextSession = recordUIActionInSession(activeSessionRef.current, action);
    uiActionAuditLogRef.current = nextSession.uiActionAuditLog ?? [];
    activeSessionRef.current = nextSession;
    onSessionChange(nextSession);
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
    runtimeHealth,
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
      const editResult = applyHistoricalUserMessageEdit({
        session,
        messageId: editingMessageId,
        content,
        mode: 'continue',
      });
      activeSessionRef.current = editResult.session;
      onSessionChange(editResult.session);
      if (editResult.branch?.requiresUserConfirmation) {
        setErrorText('历史消息已更新；下游结果存在冲突，请确认是否保留受影响 refs 或从编辑边界重新运行。');
        return;
      }
      void submitTurn(content, editedMessage.references ?? []);
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
        onNewChat={handleNewChat}
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
                <strong>SciForge</strong>
                <Badge variant="info">进行中</Badge>
              </div>
              <MessageContent content={runningMessageContent} references={[]} onObjectFocus={onObjectFocus} />
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
          const provenanceKind = messageProvenanceKind(message);
          const showDiagnosticBadges = shouldShowMessageDiagnosticBadges(message, provenanceKind);
          const showMessageConfidence = message.role !== 'user' && typeof message.confidence === 'number' && Number.isFinite(message.confidence);
          return (
          <div
            key={message.id}
            className={cx('message', message.role, activeRunId && messageRunId === activeRunId && 'active-run')}
            data-testid="chat-message"
            data-message-id={message.id}
            data-message-provenance={messageProvenanceAttribute(provenanceKind)}
            data-runtime-request-eligible={message.provenance?.runtimeRequestEligible === true ? 'true' : 'false'}
            data-live-acceptance-eligible={isLiveRuntimeCodexMessage(message) ? 'true' : 'false'}
            data-sciforge-reference={sciForgeReferenceAttribute(visibleMessageReference(message))}
          >
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'SciForge'}</strong>
                {messageRunId ? (
                  <button type="button" className="message-run-link" onClick={() => onActiveRunChange(messageRunId)} title="查看本轮过程">
                    过程
                  </button>
                ) : null}
                {showMessageConfidence ? <ConfidenceBar value={message.confidence as number} /> : null}
                {showDiagnosticBadges && message.evidence ? <EvidenceTag level={message.evidence} /> : null}
                {showDiagnosticBadges && message.claimType ? <ClaimTag type={message.claimType} /> : null}
                <MessageProvenanceBadge message={message} />
                <RunVerificationTag session={session} runId={messageRunId} />
                {message.status === 'failed' ? <Badge variant="danger">未完成</Badge> : null}
                {message.guidanceQueue ? <Badge variant={guidanceBadgeVariant(message.guidanceQueue.status)}>{guidanceStatusLabel(message.guidanceQueue.status)}</Badge> : null}
                {message.acceptance ? (
                  <Badge variant={message.acceptance.pass ? 'success' : message.acceptance.severity === 'repairable' ? 'warning' : 'danger'}>
                    验收：{acceptanceSeverityLabel(message.acceptance.severity)}
                  </Badge>
                ) : null}
                <div className="message-actions">
                  <button
                    type="button"
                    onClick={() => void copyMessageContent(message.content)}
                    title="复制 Markdown"
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
                    <>
                      <FollowupBindingLine message={message} />
                      <MessageContent
                        content={sanitizeUserProjectionText(message.content) ?? message.content}
                        references={inlineObjectReferencesForMessage(message, session)}
                        onObjectFocus={handleObjectReferenceClick}
                      />
                    </>
                  ) : (
                    <>
                      <FinalMessageContent
                        content={sanitizeUserProjectionText(message.content) ?? message.content}
                        references={inlineObjectReferencesForMessage(message, session, messageRunId, { workspaceObjectReferences })}
                        resultPresentation={resultPresentationForRun(session, messageRunId)}
                        onObjectFocus={handleObjectReferenceClick}
                      />
                      {messageRunId ? (
                        <details className="message-fold depth-2 codex-result-clues-fold">
                          <summary>
                            <span>结果线索</span>
                          </summary>
                          <RunKeyInfo
                            runId={messageRunId}
                            session={session}
                            onObjectFocus={handleObjectReferenceClick}
                          />
                        </details>
                      ) : null}
                      {messageRunId ? (
                        <RunExecutionProcess
                          runId={messageRunId}
                          session={session}
                          trace={message.expandable}
                          onObjectFocus={handleObjectReferenceClick}
                        />
                      ) : null}
                    </>
                  )}
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
        textareaRef={composerTextareaRef}
        runtimeContext={{
          provider: config.modelProvider || 'provider unset',
          model: config.modelName.trim() || 'model unset',
          workspacePath: config.workspacePath,
          permissionMode: '可写工作区',
        }}
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

function acceptanceSeverityLabel(value: string) {
  if (value === 'repairable') return '可恢复';
  if (value === 'blocking') return '阻塞';
  if (value === 'warning') return '需留意';
  return value;
}

function FollowupBindingLine({ message }: { message: SciForgeMessage }) {
  const references = message.references ?? [];
  if (!references.length) return null;
  const labels = references
    .slice(0, 3)
    .map((reference) => reference.title || reference.ref)
    .join('、');
  const overflow = references.length > 3 ? ` +${references.length - 3}` : '';
  return (
    <div className="message-continuity-line">
      <span>继续基于当前对话</span>
      <span>和 {labels}{overflow}</span>
    </div>
  );
}

function enrichRepairRaw(raw: unknown, repairHistory: unknown, sourceRunId: string, failureReason?: string) {
  const repairMetadata = { acceptanceRepair: { sourceRunId, repairHistory, failureReason } };
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, ...repairMetadata }
    : { raw, ...repairMetadata };
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
  if (rawTarget?.closest('.composer, .reference-pick-banner, .settings-dialog, .settings-page, .settings-page, .reference-context-menu')) return undefined;
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim();
  if (!selection || selection.rangeCount === 0 || !selectedText) return undefined;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  const element = ancestor?.closest<HTMLElement>('[data-sciforge-reference], .message, .registry-slot, .card, .data-preview-table, table, section');
  if (!element || element.closest('.composer, .reference-pick-banner, .settings-dialog, .settings-page')) return undefined;
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
  if (!rawTarget || rawTarget.closest('.composer, .reference-pick-banner, .settings-dialog, .settings-page')) return undefined;
  const explicit = rawTarget.closest<HTMLElement>('[data-sciforge-reference]');
  if (explicit) {
    const reference = parseSciForgeReferenceAttribute(explicit.dataset.sciforgeReference);
    if (reference) return { element: explicit, reference };
  }
  const implicit = rawTarget.closest<HTMLElement>('button, [role="button"], .registry-slot, .card, .message, .data-preview-table, table, canvas, svg, section');
  if (!implicit || !(implicit instanceof HTMLElement) || implicit.closest('.composer, .reference-pick-banner, .settings-dialog, .settings-page')) return undefined;
  return { element: implicit, reference: referenceForUiElement(implicit) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldOpenComposerByDefault(session: SciForgeSession) {
  return session.messages.length === 0 && session.runs.length === 0;
}

function resultPresentationForRun(session: SciForgeSession, runId: string | undefined) {
  if (!runId) return undefined;
  const run = session.runs.find((item) => item.id === runId);
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  if (!raw) return undefined;
  const direct = raw.resultPresentation;
  // Only use the top-level resultPresentation. raw.displayIntent is runtime audit/diagnostic
  // data used by the results panel; it must NOT drive the chat message body.
  return isRecord(direct) ? direct : undefined;
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
