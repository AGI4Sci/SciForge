import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, CircleStop, Clock, Copy, Download, FileUp, MessageSquare, Plus, Quote, Sparkles, Trash2, X } from 'lucide-react';
import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { sendAgentMessageStream, validateSemanticTurnAcceptance } from '../api/agentClient';
import { sendBioAgentToolMessage } from '../api/bioagentToolsClient';
import { buildContextWindowMeterModel, estimateContextWindowState, latestContextWindowState } from '../contextWindow';
import { builtInScenarioPackageRef } from '../scenarioCompiler/scenarioPackage';
import { resetSession } from '../sessionStore';
import { coalesceStreamEvents, formatAgentTokenUsage, latestRunningEvent, presentStreamEvent, streamEventCounts } from '../streamEventPresentation';
import { acceptAndRepairAgentResponse, buildBackendAcceptanceRepairPrompt, buildUserGoalSnapshot, shouldRunBackendAcceptanceRepair } from '../turnAcceptance';
import { makeId, nowIso, type AgentContextWindowState, type AgentStreamEvent, type BioAgentConfig, type BioAgentMessage, type BioAgentReference, type BioAgentRun, type BioAgentSession, type NormalizedAgentResponse, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type RuntimeExecutionUnit, type ScenarioInstanceId, type ScenarioRuntimeOverride, type TimelineEventRecord } from '../domain';
import { writeWorkspaceFile } from '../api/workspaceClient';
import { exportJsonFile } from './exportUtils';
import { ActionButton, Badge, ClaimTag, ConfidenceBar, EvidenceTag, IconButton, cx } from './uiPrimitives';

interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioId;
  prompt: string;
}

interface ReferenceContextMenuState {
  x: number;
  y: number;
  reference: BioAgentReference;
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

function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/s+/g, ' ').slice(0, 36);
  return title || '新聊天';
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
}: {
  scenarioId: ScenarioInstanceId;
  role: string;
  config: BioAgentConfig;
  session: BioAgentSession;
  input: string;
  savedScrollTop: number;
  onInputChange: (value: string) => void;
  onScrollTopChange: (value: number) => void;
  onSessionChange: (session: BioAgentSession) => void;
  onNewChat: () => void;
  onDeleteChat: () => void;
  archivedSessions: BioAgentSession[];
  onRestoreArchivedSession: (sessionId: string) => void;
  onDeleteArchivedSessions: (sessionIds: string[]) => void;
  onClearArchivedSessions: () => void;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  archivedCount: number;
  autoRunRequest?: HandoffAutoRunRequest;
  onAutoRunConsumed: (requestId: string) => void;
  scenarioOverride?: ScenarioRuntimeOverride;
  onConfigChange: (patch: Partial<BioAgentConfig>) => void;
  onTimelineEvent: (event: TimelineEventRecord) => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
  onMarkReusableRun: (runId: string) => void;
  onObjectFocus: (reference: ObjectReference) => void;
  externalReferenceRequest?: { id: string; reference: BioAgentReference };
  onExternalReferenceConsumed?: (requestId: string) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(88);
  const [streamEventsExpanded, setStreamEventsExpanded] = useState(false);
  const [streamEventsHeight, setStreamEventsHeight] = useState(260);
  const [streamEvents, setStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [guidanceQueue, setGuidanceQueue] = useState<string[]>([]);
  const [referencePickMode, setReferencePickMode] = useState(false);
  const [pendingReferences, setPendingReferences] = useState<BioAgentReference[]>([]);
  const [referenceContextMenu, setReferenceContextMenu] = useState<ReferenceContextMenuState | null>(null);
  const activeSessionRef = useRef(session);
  const inputRef = useRef(input);
  const guidanceQueueRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const userAbortRequestedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoScrollRef = useRef(true);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const streamResizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const messages = session.messages;
  const baseScenarioId = builtInScenarioIdForInstance(scenarioId, scenarioOverride);
  const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
  const scenarioPackageRef = scenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId);
  const skillPlanRef = scenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.default`;
  const uiPlanRef = scenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.default`;
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const visibleMessageStart = Math.max(0, messages.length - 24);
  const visibleMessages = messages.slice(visibleMessageStart);
  const liveTokenUsage = latestTokenUsage(streamEvents);
  const worklogCounts = streamEventCounts(streamEvents);
  const latestWorklogLine = latestRunningEvent(streamEvents);
  const contextWindowState = latestContextWindowState(streamEvents)
    ?? estimateContextWindowState(session, config, streamEvents);

  useEffect(() => {
    activeSessionRef.current = session;
  }, [session]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    guidanceQueueRef.current = guidanceQueue;
  }, [guidanceQueue]);

  useEffect(() => {
    setStreamEvents([]);
    setGuidanceQueue([]);
    setErrorText('');
  }, [scenarioId, session.sessionId]);

  useEffect(() => {
    if (autoScrollRef.current) {
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length, isSending]);

  useEffect(() => {
    if (!referencePickMode) return undefined;
    let highlighted: HTMLElement | null = null;
    document.body.classList.add('bioagent-reference-picking');
    const clearHighlight = () => {
      highlighted?.classList.remove('bioagent-reference-pick-hover');
      highlighted = null;
    };
    const setHighlight = (element: HTMLElement | null) => {
      if (highlighted === element) return;
      clearHighlight();
      highlighted = element;
      highlighted?.classList.add('bioagent-reference-pick-hover');
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
      document.body.classList.remove('bioagent-reference-picking');
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
    setExpanded(0);
    const element = messagesRef.current;
    if (element) {
      element.scrollTo({ top: savedScrollTop, behavior: 'auto' });
      autoScrollRef.current = savedScrollTop <= 0;
    }
  }, [scenarioId, savedScrollTop]);

  async function handleSend() {
    const prompt = input.trim() || (pendingReferences.length ? '请基于已引用对象继续分析。' : '');
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
      const now = nowIso();
      const uploadMessage: BioAgentMessage = {
        id: makeId('msg'),
        role: 'system',
        content: `已上传 ${uploaded.length} 个文件到证据矩阵：${uploaded.map((artifact) => artifact.metadata?.title ?? artifact.id).join('、')}`,
        createdAt: now,
        status: 'completed',
        references,
        objectReferences: uploaded.map((artifact) => objectReferenceForUploadedArtifact(artifact)),
      };
      const nextSession: BioAgentSession = {
        ...activeSessionRef.current,
        messages: [...activeSessionRef.current.messages, uploadMessage],
        artifacts: mergeRuntimeArtifacts(uploaded, activeSessionRef.current.artifacts),
        updatedAt: now,
      };
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

  function addPendingReference(reference: BioAgentReference) {
    setPendingReferences((current) => {
      if (current.some((item) => item.id === reference.id)) return current;
      return [...current, reference].slice(0, 8);
    });
  }

  function addPendingReferenceToComposer(reference: BioAgentReference) {
    const referenceWithMarker = withComposerMarker(reference, pendingReferences);
    addPendingReference(referenceWithMarker);
    const nextInput = appendReferenceMarkerToInput(inputRef.current, referenceWithMarker);
    inputRef.current = nextInput;
    onInputChange(nextInput);
  }

  function removePendingReference(referenceId: string) {
    const reference = pendingReferences.find((item) => item.id === referenceId);
    setPendingReferences((current) => current.filter((item) => item.id !== referenceId));
    if (!reference) return;
    const nextInput = removeReferenceMarkerFromInput(inputRef.current, reference);
    inputRef.current = nextInput;
    onInputChange(nextInput);
  }

  function focusPendingReference(reference: BioAgentReference) {
    highlightReferencedContent(reference);
  }

  async function runPrompt(prompt: string, baseSession: BioAgentSession, references: BioAgentReference[] = []) {
    const turnId = makeId('turn');
    const goalSnapshot = buildUserGoalSnapshot({
      turnId,
      prompt,
      references,
      scenarioId,
      scenarioOverride,
      expectedArtifacts: SCENARIO_SPECS[baseScenarioId].outputArtifacts.map((artifact) => artifact.type),
      recentMessages: baseSession.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
    });
    const userMessage: BioAgentMessage = {
      id: makeId('msg'),
      role: 'user',
      content: prompt,
      createdAt: nowIso(),
      status: 'completed',
      references,
      goalSnapshot,
    };
    const optimisticSession: BioAgentSession = {
      ...baseSession,
      title: baseSession.runs.length || baseSession.messages.some((message) => message.id.startsWith('msg'))
        ? baseSession.title
        : titleFromPrompt(prompt),
      messages: [...baseSession.messages, userMessage],
      updatedAt: nowIso(),
    };
    onSessionChange(optimisticSession);
    onInputChange('');
    inputRef.current = '';
    setPendingReferences([]);
    setReferencePickMode(false);
    setErrorText('');
    setStreamEvents([{
      id: makeId('evt'),
      type: 'queued',
      label: '已提交',
      detail: prompt,
      createdAt: nowIso(),
    }]);
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    userAbortRequestedRef.current = false;
    try {
      let latestRoundTokenUsage: AgentStreamEvent['usage'];
      const handleStreamEvent = (event: AgentStreamEvent) => {
        if (event.usage) latestRoundTokenUsage = event.usage;
        setStreamEvents((current) => coalesceStreamEvents(current, event).slice(-32));
      };
      const turnPayload = requestPayloadForTurn(optimisticSession, userMessage, references);
      const request = {
        sessionId: optimisticSession.sessionId,
        scenarioId,
        agentName: scenario.name,
        agentDomain: scenario.domain,
        prompt,
        references,
        roleView: role,
        messages: turnPayload.messages,
        artifacts: turnPayload.artifacts,
        executionUnits: turnPayload.executionUnits,
        runs: turnPayload.runs,
        config,
        scenarioOverride,
        scenarioPackageRef,
        skillPlanRef,
        uiPlanRef,
      };
      let response: NormalizedAgentResponse;
      try {
        response = await sendBioAgentToolMessage(request, {
          onEvent: handleStreamEvent,
        }, controller.signal);
      } catch (projectToolError) {
        const detail = projectToolError instanceof Error ? projectToolError.message : String(projectToolError);
        if (/cancel|abort|已取消|cancelled|canceled/i.test(detail)) {
          throw projectToolError;
        }
        setStreamEvents((current) => [...current.slice(-32), {
          id: makeId('evt'),
          type: 'project-tool-fallback',
          label: '项目工具',
          detail: `BioAgent project tool unavailable, falling back to AgentServer: ${detail}`,
          createdAt: nowIso(),
          raw: { error: detail },
        }]);
        response = await sendAgentMessageStream(request, {
          onEvent: handleStreamEvent,
        }, controller.signal);
      }
      const responseWithUsage = latestRoundTokenUsage
        ? { ...response, message: { ...response.message, tokenUsage: latestRoundTokenUsage } }
        : response;
      const responseWithReferences = {
        ...responseWithUsage,
        run: {
          ...responseWithUsage.run,
          references,
          goalSnapshot,
        },
        message: {
          ...responseWithUsage.message,
          references: responseWithUsage.message.references,
          goalSnapshot,
        },
      };
      const deterministicAcceptedResponse = acceptAndRepairAgentResponse({
        snapshot: goalSnapshot,
        response: responseWithReferences,
        session: activeSessionRef.current,
      });
      const semanticAcceptance = shouldValidateSemanticAcceptance(deterministicAcceptedResponse)
        ? await validateSemanticTurnAcceptance(request, {
          snapshot: goalSnapshot,
          response: deterministicAcceptedResponse,
          deterministicAcceptance: deterministicAcceptedResponse.message.acceptance!,
        }, controller.signal)
        : undefined;
      const acceptedResponse = semanticAcceptance
        ? acceptAndRepairAgentResponse({
          snapshot: goalSnapshot,
          response: deterministicAcceptedResponse,
          session: activeSessionRef.current,
          semanticAcceptance,
        })
        : deterministicAcceptedResponse;
      const finalResponse = await maybeRunBackendAcceptanceRepair({
        prompt,
        references,
        request,
        acceptedResponse,
        goalSnapshot,
        sessionBeforeMerge: activeSessionRef.current,
        onStreamEvent: handleStreamEvent,
        signal: controller.signal,
      });
      const mergedSession = mergeAgentResponse(activeSessionRef.current, finalResponse);
      onSessionChange(mergedSession);
      activeSessionRef.current = mergedSession;
      onActiveRunChange(finalResponse.run.id);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const wasUserInterrupted = userAbortRequestedRef.current;
      const wasSystemInterrupted = !wasUserInterrupted && (controller.signal.aborted || /cancel|abort|已取消|cancelled|canceled/i.test(rawMessage));
      const message = wasUserInterrupted
        ? '用户已中断当前 backend 运行。'
        : wasSystemInterrupted
          ? `当前 backend 运行被系统或网络中断：${rawMessage}`
          : rawMessage;
      setErrorText(message);
      const failedRunId = makeId('run');
      const failedAt = nowIso();
      const failedRun = {
        id: failedRunId,
        scenarioId,
        scenarioPackageRef,
        skillPlanRef,
        uiPlanRef,
        status: 'failed' as const,
        prompt,
        response: message,
        createdAt: failedAt,
        completedAt: failedAt,
        references,
        goalSnapshot,
      };
      onSessionChange({
        ...optimisticSession,
        messages: [
          ...optimisticSession.messages,
          {
            id: makeId('msg'),
            role: 'system',
            content: message,
            createdAt: nowIso(),
            status: 'failed',
            goalSnapshot,
          },
        ],
        runs: [
          ...optimisticSession.runs,
          failedRun,
        ],
        updatedAt: nowIso(),
      });
      onActiveRunChange(failedRunId);
    } finally {
      setIsSending(false);
      abortRef.current = null;
      userAbortRequestedRef.current = false;
      const [nextGuidance, ...rest] = guidanceQueueRef.current;
      if (nextGuidance) {
        setGuidanceQueue(rest);
        window.setTimeout(() => {
          void runPrompt(nextGuidance, activeSessionRef.current);
        }, 80);
      }
    }
  }

  function handleRunningGuidance(prompt: string) {
    const now = nowIso();
    const guidanceMessage: BioAgentMessage = {
      id: makeId('msg'),
      role: 'user',
      content: `运行中引导：${prompt}`,
      createdAt: now,
      status: 'running',
    };
    const nextSession: BioAgentSession = {
      ...activeSessionRef.current,
      messages: [...activeSessionRef.current.messages, guidanceMessage],
      updatedAt: now,
    };
    activeSessionRef.current = nextSession;
    onSessionChange(nextSession);
    onInputChange('');
    inputRef.current = '';
    setGuidanceQueue((current) => [...current, prompt]);
    setStreamEvents((current) => [...current.slice(-32), {
      id: makeId('evt'),
      type: 'guidance-queued',
      label: '引导已排队',
      detail: prompt,
      createdAt: now,
    }]);
  }

  function shouldValidateSemanticAcceptance(response: NormalizedAgentResponse) {
    const acceptance = response.message.acceptance;
    if (!acceptance || acceptance.pass) return false;
    return shouldRunBackendAcceptanceRepair(acceptance, 1);
  }

  function handleAbort() {
    if (!abortRef.current) return;
    const interruptedAt = nowIso();
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

  function beginStreamEventsResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    streamResizeStateRef.current = { startY: event.clientY, startHeight: streamEventsHeight };
    const handleMove = (moveEvent: MouseEvent) => {
      const state = streamResizeStateRef.current;
      if (!state) return;
      const delta = state.startY - moveEvent.clientY;
      const nextHeight = Math.max(96, Math.min(Math.round(window.innerHeight * 0.62), state.startHeight + delta));
      setStreamEventsHeight(nextHeight);
      setStreamEventsExpanded(true);
    };
    const handleUp = () => {
      streamResizeStateRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }

  async function maybeRunBackendAcceptanceRepair({
    prompt,
    references,
    request,
    acceptedResponse,
    goalSnapshot,
    sessionBeforeMerge,
    onStreamEvent,
    signal,
  }: {
    prompt: string;
    references: BioAgentReference[];
    request: {
      artifacts?: NormalizedAgentResponse['artifacts'];
      executionUnits?: NormalizedAgentResponse['executionUnits'];
      runs?: NormalizedAgentResponse['run'][];
      messages: BioAgentMessage[];
    } & Parameters<typeof sendBioAgentToolMessage>[0];
    acceptedResponse: NormalizedAgentResponse;
    goalSnapshot: NonNullable<BioAgentMessage['goalSnapshot']>;
    sessionBeforeMerge: BioAgentSession;
    onStreamEvent: (event: AgentStreamEvent) => void;
    signal: AbortSignal;
  }): Promise<NormalizedAgentResponse> {
    const acceptance = acceptedResponse.message.acceptance;
    if (!shouldRunBackendAcceptanceRepair(acceptance, 1)) return acceptedResponse;

    const startedAt = nowIso();
    const repairPrompt = buildBackendAcceptanceRepairPrompt({
      snapshot: goalSnapshot,
      acceptance: acceptance!,
      response: acceptedResponse,
      session: sessionBeforeMerge,
    });
    const action = acceptance!.failures.find((failure) => /artifact-repair|execution-repair/.test(failure.repairAction ?? ''))?.repairAction ?? 'artifact-repair';
    const baseHistory = acceptance!.repairHistory ?? [];
    setStreamEvents((current) => [...current.slice(-31), {
      id: makeId('evt'),
      type: 'acceptance-repair-start',
      label: '验收修复',
      detail: 'TurnAcceptanceGate 触发一次 backend artifact/execution repair rerun。',
      createdAt: startedAt,
      raw: { sourceRunId: acceptedResponse.run.id, failures: acceptance!.failures },
    }]);

    try {
      const repairResponse = await sendBioAgentToolMessage({
        ...request,
        prompt: repairPrompt,
        references,
        messages: [
          ...request.messages,
          {
            id: makeId('msg'),
            role: 'system',
            content: `Acceptance repair rerun for original user prompt: ${prompt}`,
            createdAt: startedAt,
            status: 'running',
            goalSnapshot,
          },
        ],
        artifacts: mergeRuntimeArtifacts(acceptedResponse.artifacts, request.artifacts ?? []),
        executionUnits: mergeExecutionUnits(acceptedResponse.executionUnits, request.executionUnits ?? []),
        runs: mergeRuns([acceptedResponse.run], request.runs ?? []),
      }, {
        onEvent: onStreamEvent,
      }, signal);
      const repairAccepted = acceptAndRepairAgentResponse({
        snapshot: goalSnapshot,
        response: {
          ...repairResponse,
          run: {
            ...repairResponse.run,
            references,
            goalSnapshot,
          },
          message: {
            ...repairResponse.message,
            goalSnapshot,
          },
        },
        session: {
          ...sessionBeforeMerge,
          artifacts: mergeRuntimeArtifacts(acceptedResponse.artifacts, sessionBeforeMerge.artifacts),
          executionUnits: mergeExecutionUnits(acceptedResponse.executionUnits, sessionBeforeMerge.executionUnits),
          runs: mergeRuns([acceptedResponse.run], sessionBeforeMerge.runs),
        },
      });
      const completedAt = nowIso();
      if (repairAccepted.message.acceptance?.pass && repairAccepted.run.status !== 'failed') {
        const repairHistory = [...baseHistory, {
          attempt: baseHistory.length + 1,
          action,
          status: 'completed' as const,
          startedAt,
          completedAt,
          sourceRunId: acceptedResponse.run.id,
          repairRunId: repairAccepted.run.id,
          failureCodes: acceptance!.failures.map((failure) => failure.code),
        }];
        return mergeRepairSuccessResponse(acceptedResponse, repairAccepted, repairHistory);
      }
      return failedAcceptanceRepairResponse(
        acceptedResponse,
        repairAccepted,
        action,
        startedAt,
        completedAt,
        baseHistory,
        repairAccepted.message.acceptance?.failures.map((failure) => `${failure.code}: ${failure.detail}`).join('; ')
          || repairAccepted.executionUnits.find((unit) => unit.failureReason)?.failureReason
          || 'repair rerun did not satisfy TurnAcceptanceGate',
      );
    } catch (error) {
      const completedAt = nowIso();
      const reason = error instanceof Error ? error.message : String(error);
      return failedAcceptanceRepairResponse(acceptedResponse, undefined, action, startedAt, completedAt, baseHistory, reason);
    }
  }

  function mergeAgentResponse(baseSession: BioAgentSession, response: NormalizedAgentResponse): BioAgentSession {
    const versionedRun = {
      ...response.run,
      scenarioPackageRef: response.run.scenarioPackageRef ?? scenarioPackageRef,
      skillPlanRef: response.run.skillPlanRef ?? skillPlanRef,
      uiPlanRef: response.run.uiPlanRef ?? uiPlanRef,
    };
    return {
      ...baseSession,
      messages: [...baseSession.messages, response.message],
      runs: [...baseSession.runs, versionedRun],
      uiManifest: response.uiManifest.length ? response.uiManifest : baseSession.uiManifest,
      claims: [...response.claims, ...baseSession.claims].slice(0, 24),
      executionUnits: [...response.executionUnits, ...baseSession.executionUnits].slice(0, 24),
      artifacts: [...response.artifacts, ...baseSession.artifacts].slice(0, 24),
      notebook: [...response.notebook, ...baseSession.notebook].slice(0, 24),
      updatedAt: nowIso(),
    };
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

  function beginEditMessage(message: BioAgentMessage) {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  }

  function saveEditMessage() {
    const content = editingContent.trim();
    if (!editingMessageId || !content) return;
    onEditMessage(editingMessageId, content);
    setEditingMessageId(null);
    setEditingContent('');
  }

  function handleMessagesScroll() {
    const element = messagesRef.current;
    if (!element) return;
    autoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    onScrollTopChange(element.scrollTop);
  }

  return (
    <div className="chat-panel">
      <div className="panel-title compact">
        <div className="scenario-mini" style={{ background: `${scenario.color}18`, color: scenario.color }}>
          <scenario.icon size={18} />
        </div>
        <div>
          <strong>{scenario.name}</strong>
          <span>{session.title} · {scenario.tools.join(' / ')}</span>
        </div>
        <Badge variant="success" glow>在线</Badge>
        <Badge variant="muted">{session.versions.length} versions</Badge>
        {archivedCount ? <Badge variant="muted">{archivedCount} archived</Badge> : null}
        <label className="backend-picker" title="选择本场景下一次 AgentServer 运行使用的 agent backend">
          <span>backend</span>
          <select value={config.agentBackend} onChange={(event) => onConfigChange({ agentBackend: event.target.value })}>
            <option value="codex">Codex</option>
            <option value="openteam_agent">OpenTeam</option>
            <option value="claude-code">Claude Code</option>
            <option value="hermes-agent">Hermes</option>
            <option value="openclaw">OpenClaw</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <div className="panel-actions">
          <IconButton icon={Plus} label="开启新聊天" onClick={onNewChat} />
          <IconButton icon={Clock} label="历史会话" onClick={() => setHistoryOpen((value) => !value)} />
          {isSending ? <IconButton icon={CircleStop} label="中断请求" onClick={handleAbort} /> : null}
          <IconButton icon={Download} label="导出当前 Scenario 会话" onClick={handleExport} />
          <IconButton icon={Trash2} label="删除当前聊天" onClick={onDeleteChat} />
        </div>
      </div>

      {historyOpen ? (
        <SessionHistoryPanel
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
      <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {!messages.length ? (
          <div className="chat-empty">
            <MessageSquare size={18} />
            <strong>新聊天已就绪</strong>
            <span>输入研究问题，或先点选文件、历史消息、任务结果、图表和表格作为上下文。</span>
          </div>
        ) : null}
        {visibleMessageStart > 0 ? (
          <div className="chat-empty compact-history-note">
            <MessageSquare size={18} />
            <strong>已折叠较早对话</strong>
            <span>当前工作台仅渲染最近 {visibleMessages.length} 条消息，完整审计保留在 runs、ExecutionUnit 和 workspace artifacts 中。</span>
          </div>
        ) : null}
        {visibleMessages.map((message, visibleIndex) => {
          const index = visibleMessageStart + visibleIndex;
          const messageRunId = runIdForMessage(message, index, messages, session.runs);
          return (
          <div
            key={message.id}
            className={cx('message', message.role, activeRunId && messageRunId === activeRunId && 'active-run')}
            data-run-id={messageRunId}
            data-bioagent-reference={bioAgentReferenceAttribute(referenceForMessage(message, messageRunId))}
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
                {message.status === 'failed' ? <Badge variant="danger">failed</Badge> : null}
                {message.acceptance ? (
                  <Badge variant={message.acceptance.pass ? 'success' : message.acceptance.severity === 'repairable' ? 'warning' : 'danger'}>
                    gate {message.acceptance.severity}
                  </Badge>
                ) : null}
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
                <p>{message.content}</p>
              )}
              {message.references?.length ? (
                <BioAgentReferenceChips references={message.references} />
              ) : null}
              {message.objectReferences?.length ? (
                <ObjectReferenceChips
                  references={message.objectReferences}
                  activeRunId={activeRunId}
                  onFocus={onObjectFocus}
                />
              ) : null}
              {message.acceptance && !message.acceptance.pass ? (
                <TurnAcceptanceNotice acceptance={message.acceptance} />
              ) : null}
              <div className="message-actions">
                <button onClick={() => void navigator.clipboard?.writeText(message.content)}>复制</button>
                <button onClick={() => beginEditMessage(message)}>编辑</button>
                <button onClick={() => onDeleteMessage(message.id)}>删除</button>
              </div>
              {message.expandable ? (
                <>
                  <button className="expand-link" onClick={() => setExpanded(expanded === index ? null : index)}>
                    {expanded === index ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {expanded === index ? '收起推理链' : '展开推理链'}
                  </button>
                  {expanded === index ? (
                    <div className="reasoning-block">
                      <button type="button" onClick={() => void navigator.clipboard?.writeText(message.expandable || '')}>复制推理链</button>
                      <pre className="reasoning">{message.expandable}</pre>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          );
        })}
        {isSending ? (
          <div className="message scenario">
            <div className="message-body">
              <div className="message-meta">
                <strong>{scenario.name}</strong>
                <Badge variant="info">running</Badge>
              </div>
              <p>{latestWorklogLine || '正在规划、生成或执行 workspace task，过程日志默认折叠。'}</p>
            </div>
          </div>
        ) : null}
      </div>

      {streamEvents.length || isSending ? (
        <div className="codex-work-status" aria-label="工作状态">
          <button
            type="button"
            onClick={() => setStreamEventsExpanded((value) => !value)}
            title={streamEventsExpanded ? '收起工作过程' : '展开工作过程'}
          >
            <span>{isSending ? '处理中' : '已处理'}</span>
            <small>
              {worklogCounts.total ? `${worklogCounts.total} 条工作记录` : latestWorklogLine || '等待工作过程'}
            </small>
            {streamEventsExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      ) : null}

      {session.runs.length ? (
        <div className="run-link-strip" aria-label="运行记录">
          <span>Runs</span>
          {session.runs.slice(-6).map((run) => (
            <button
              key={run.id}
              type="button"
              className={cx(activeRunId === run.id && 'active')}
              onClick={() => onActiveRunChange(activeRunId === run.id ? undefined : run.id)}
              data-run-id={run.id}
              data-bioagent-reference={bioAgentReferenceAttribute(referenceForRun(run))}
            >
              {run.id.replace(/^run-/, '').slice(0, 8)}
              <em>{run.status}</em>
            </button>
          ))}
          {activeRun ? (
            <button type="button" className="candidate-action" onClick={() => onMarkReusableRun(activeRun.id)}>
              标记 reusable
            </button>
          ) : null}
        </div>
      ) : null}

      {isSending || streamEvents.length ? (
        <div
          className={cx('stream-events', !streamEventsExpanded && 'collapsed')}
          style={streamEventsExpanded ? { height: `${streamEventsHeight}px` } : undefined}
        >
          {streamEventsExpanded ? (
            <div className="stream-events-resize-handle" onMouseDown={beginStreamEventsResize} title="拖拽调整运行观察高度" />
          ) : null}
          <div className="stream-events-head">
            <span>工作过程</span>
            <div className="stream-events-actions">
              {worklogCounts.key ? <Badge variant="info">{worklogCounts.key} 关键</Badge> : null}
              {worklogCounts.background ? <Badge variant="muted">{worklogCounts.background} 过程</Badge> : null}
              {guidanceQueue.length ? <Badge variant="warning">{guidanceQueue.length} 条引导排队</Badge> : null}
              {liveTokenUsage ? <Badge variant="muted">{formatAgentTokenUsage(liveTokenUsage)}</Badge> : null}
              <Badge variant="muted">{config.agentBackend}</Badge>
              <button
                type="button"
                className="stream-events-toggle"
                onClick={() => setStreamEventsExpanded((value) => !value)}
                title={streamEventsExpanded ? '收缩运行观察' : '展开运行观察'}
              >
                {streamEventsExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            </div>
          </div>
          {!streamEventsExpanded ? (
            <button
              type="button"
              className="stream-events-preview"
              onClick={() => setStreamEventsExpanded(true)}
              title="展开查看后台探索、工具调用和 raw event"
            >
              <span>{latestWorklogLine || '后台过程将折叠在这里。'}</span>
            </button>
          ) : (
            <div className="stream-events-list">
              {streamEvents.slice(-24).map((event) => {
                const presentation = presentStreamEvent(event);
                const copyPayload = JSON.stringify(event.raw ?? { type: event.type, label: event.label, detail: event.detail }, null, 2);
                return (
                  <details className={cx('stream-event', presentation.uiClass)} key={event.id} open={!presentation.initiallyCollapsed}>
                    <summary>
                      <Badge variant={presentation.tone}>{event.label}</Badge>
                      <span className="stream-event-type">{presentation.typeLabel}</span>
                      {presentation.usageDetail ? <span className="stream-event-usage">{presentation.usageDetail}</span> : null}
                      <span className="stream-event-detail compact">{presentation.shortDetail || '无详细文本'}</span>
                    </summary>
                    <div className="stream-event-expanded">
                      {presentation.detail ? <pre>{presentation.detail}</pre> : <span>无额外详情。</span>}
                      <button type="button" onClick={() => void navigator.clipboard?.writeText(copyPayload)}>复制 raw</button>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {errorText ? (
        <div className="composer-error">
          <span>{errorText}</span>
          <small>可检查 Runtime Health、启动缺失服务，或改用当前场景的 workspace capability 重试。</small>
        </div>
      ) : null}
      <div className="run-readiness">
        <Badge variant={readiness.ok ? 'success' : readiness.severity}>{readiness.ok ? 'ready' : 'action'}</Badge>
        <span>{readiness.message}</span>
        <code>{scenarioPackageRef.id}@{scenarioPackageRef.version}</code>
      </div>
      <div className="composer">
        <div className="composer-resize-handle" onMouseDown={beginComposerResize} title="拖拽调整输入框高度" />
        <div className="reference-composer">
          <button
            type="button"
            className={cx('reference-trigger', referencePickMode && 'active')}
            onClick={() => setReferencePickMode((value) => !value)}
            title="点选模式引用整块 UI；选中文字可右键引用"
          >
            <Quote size={14} />
            点选
          </button>
          <button
            type="button"
            className="reference-trigger"
            onClick={() => fileInputRef.current?.click()}
            title="上传 PDF、图片、表格或任意文件到证据矩阵"
          >
            <FileUp size={14} />
            上传
          </button>
          <input
            ref={fileInputRef}
            className="sr-only-file-input"
            type="file"
            multiple
            onChange={(event) => void handleFileUpload(event.currentTarget.files)}
          />
          {pendingReferences.length ? (
            <BioAgentReferenceChips
              references={pendingReferences}
              onRemove={removePendingReference}
              onFocus={focusPendingReference}
            />
          ) : (
            <span className="reference-hint">点选 BioAgent 可见对象作为上下文</span>
          )}
        </div>
        {referencePickMode ? (
          <div className="reference-pick-banner">
            <Quote size={14} />
            点击页面对象引用整块 UI，Esc 取消
          </div>
        ) : null}
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void handleSend();
          }}
          placeholder={isSending ? '继续输入引导会排队；也可以中断当前运行...' : '输入研究问题，或点选对象后继续追问...'}
          rows={1}
          style={{ height: `${composerHeight}px` }}
        />
        <ContextWindowMeter
          state={contextWindowState}
          running={isSending}
        />
        {isSending ? (
          <ActionButton icon={CircleStop} variant="coral" onClick={handleAbort}>
            中断
          </ActionButton>
        ) : null}
        <ActionButton icon={Sparkles} onClick={handleSend} disabled={!input.trim() && !pendingReferences.length} >
          {isSending ? '引导' : '发送'}
        </ActionButton>
      </div>
      {referenceContextMenu ? (
        <div
          className="reference-context-menu"
          style={{ left: `${referenceContextMenu.x}px`, top: `${referenceContextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              addPendingReferenceToComposer(referenceContextMenu.reference);
              setReferenceContextMenu(null);
            }}
          >
            <Quote size={14} />
            引用到对话栏
          </button>
        </div>
      ) : null}
    </div>
  );
}

function mergeRepairSuccessResponse(
  original: NormalizedAgentResponse,
  repair: NormalizedAgentResponse,
  repairHistory: NonNullable<NonNullable<NormalizedAgentResponse['message']['acceptance']>['repairHistory']>,
): NormalizedAgentResponse {
  const objectReferences = mergeObjectReferences(repair.message.objectReferences ?? [], original.message.objectReferences ?? []);
  const acceptance = repair.message.acceptance ? {
    ...repair.message.acceptance,
    objectReferences,
    repairAttempt: repairHistory.length,
    repairHistory,
  } : undefined;
  return {
    ...repair,
    message: {
      ...repair.message,
      objectReferences,
      acceptance,
    },
    run: {
      ...repair.run,
      objectReferences,
      acceptance,
      raw: enrichRepairRaw(repair.run.raw, repairHistory, original.run.id),
    },
    uiManifest: repair.uiManifest.length ? repair.uiManifest : original.uiManifest,
    claims: [...repair.claims, ...original.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits(repair.executionUnits, original.executionUnits),
    artifacts: mergeRuntimeArtifacts(repair.artifacts, original.artifacts),
    notebook: [...repair.notebook, ...original.notebook].slice(0, 24),
  };
}

function failedAcceptanceRepairResponse(
  original: NormalizedAgentResponse,
  repair: NormalizedAgentResponse | undefined,
  action: string,
  startedAt: string,
  completedAt: string,
  baseHistory: NonNullable<NonNullable<NormalizedAgentResponse['message']['acceptance']>['repairHistory']>,
  reason: string,
): NormalizedAgentResponse {
  const failureUnit: RuntimeExecutionUnit = {
    id: makeId('EU-acceptance-repair'),
    tool: 'bioagent.acceptance-repair-rerun',
    params: `sourceRunId=${original.run.id}`,
    status: 'failed-with-reason',
    hash: original.run.id.slice(0, 10),
    attempt: baseHistory.length + 1,
    parentAttempt: 0,
    failureReason: reason,
    recoverActions: ['Review failureReason/stdoutRef/stderrRef/codeRef and rerun manually if needed.'],
    nextStep: 'Repair rerun failed; return failed-with-reason to the user instead of presenting partial success.',
  };
  const repairHistory = [...baseHistory, {
    attempt: baseHistory.length + 1,
    action,
    status: 'failed-with-reason' as const,
    startedAt,
    completedAt,
    sourceRunId: original.run.id,
    repairRunId: repair?.run.id,
    failureCodes: original.message.acceptance?.failures.map((failure) => failure.code) ?? [],
    reason,
  }];
  const objectReferences = mergeObjectReferences(repair?.message.objectReferences ?? [], original.message.objectReferences ?? []);
  const acceptance = original.message.acceptance ? {
    ...original.message.acceptance,
    pass: false,
    severity: 'failed' as const,
    checkedAt: completedAt,
    objectReferences,
    repairAttempt: repairHistory.length,
    repairHistory,
    failures: [
      ...original.message.acceptance.failures,
      {
        code: 'backend-repair-failed',
        detail: reason,
        repairAction: action,
      },
    ],
  } : undefined;
  const content = `failed-with-reason: 后台 artifact/execution repair 未能完成。${reason}`;
  return {
    ...original,
    message: {
      ...original.message,
      content,
      status: 'failed',
      objectReferences,
      acceptance,
    },
    run: {
      ...original.run,
      status: 'failed',
      response: content,
      completedAt,
      objectReferences,
      acceptance,
      raw: enrichRepairRaw(original.run.raw, repairHistory, original.run.id, reason),
    },
    uiManifest: repair?.uiManifest.length ? repair.uiManifest : original.uiManifest,
    claims: [...(repair?.claims ?? []), ...original.claims].slice(0, 24),
    executionUnits: mergeExecutionUnits([failureUnit, ...(repair?.executionUnits ?? [])], original.executionUnits),
    artifacts: mergeRuntimeArtifacts(repair?.artifacts ?? [], original.artifacts),
    notebook: [...(repair?.notebook ?? []), ...original.notebook].slice(0, 24),
  };
}

function mergeObjectReferences(primary: ObjectReference[], secondary: ObjectReference[]) {
  const byRef = new Map<string, ObjectReference>();
  for (const reference of [...primary, ...secondary]) {
    byRef.set(reference.ref || reference.id, { ...byRef.get(reference.ref || reference.id), ...reference });
  }
  return Array.from(byRef.values()).slice(0, 24);
}

function requestPayloadForTurn(session: BioAgentSession, userMessage: BioAgentMessage, references: BioAgentReference[]) {
  const hasExplicitReferences = references.length > 0;
  const priorMessages = session.messages.filter((message) => message.id !== userMessage.id);
  const hasRealPriorMessages = priorMessages.some((message) => !message.id.startsWith('seed'));
  const hasPriorWork = hasRealPriorMessages
    || session.runs.length > 0
    || session.artifacts.length > 0
    || session.executionUnits.length > 0;
  if (hasPriorWork || hasExplicitReferences) {
    return {
      messages: session.messages.filter((message) => !message.id.startsWith('seed')),
      artifacts: session.artifacts,
      executionUnits: session.executionUnits,
      runs: session.runs,
    };
  }
  return {
    messages: [userMessage],
    artifacts: [],
    executionUnits: [],
    runs: [],
  };
}

function mergeRuntimeArtifacts(primary: NormalizedAgentResponse['artifacts'], secondary: NormalizedAgentResponse['artifacts']) {
  const byKey = new Map<string, NormalizedAgentResponse['artifacts'][number]>();
  for (const artifact of [...primary, ...secondary]) {
    byKey.set(artifact.id || artifact.path || artifact.dataRef || `${artifact.type}-${byKey.size}`, { ...byKey.get(artifact.id || artifact.path || artifact.dataRef || ''), ...artifact });
  }
  return Array.from(byKey.values()).slice(0, 32);
}

function mergeExecutionUnits(primary: NormalizedAgentResponse['executionUnits'], secondary: NormalizedAgentResponse['executionUnits']) {
  const byId = new Map<string, NormalizedAgentResponse['executionUnits'][number]>();
  for (const unit of [...primary, ...secondary]) {
    byId.set(unit.id || `${unit.tool}-${byId.size}`, { ...byId.get(unit.id || ''), ...unit });
  }
  return Array.from(byId.values()).slice(0, 32);
}

function mergeRuns(primary: NormalizedAgentResponse['run'][], secondary: NormalizedAgentResponse['run'][]) {
  const byId = new Map<string, NormalizedAgentResponse['run']>();
  for (const run of [...primary, ...secondary]) byId.set(run.id, { ...byId.get(run.id), ...run });
  return Array.from(byId.values()).slice(-12);
}

async function fileToUploadedArtifact(file: File, scenarioId: ScenarioInstanceId, config: BioAgentConfig, sessionId: string): Promise<RuntimeArtifact> {
  const id = makeId('upload');
  const safeSessionId = safeWorkspaceSegment(sessionId || 'sessionless');
  const safeFileName = safeWorkspaceSegment(file.name) || `${id}.bin`;
  const relativePath = `.bioagent/uploads/${safeSessionId}/${id}-${safeFileName}`;
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

function uploadedInlinePolicy(file: File): PreviewDescriptor['inlinePolicy'] {
  const kind = previewKindForUploadedFile(file);
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return file.size <= 1024 * 1024 ? 'inline' : 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return kind === 'folder' ? 'extract' : 'unsupported';
}

function uploadedDerivativeHints(file: File, ref: string): PreviewDescriptor['derivatives'] {
  const kind = previewKindForUploadedFile(file);
  const lazy = (derivativeKind: NonNullable<PreviewDescriptor['derivatives']>[number]['kind'], mimeType: string) => ({
    kind: derivativeKind,
    ref: `${ref}#${derivativeKind}`,
    mimeType,
    status: 'lazy' as const,
  });
  if (kind === 'pdf') return [lazy('text', 'text/plain'), lazy('pages', 'application/json'), lazy('thumb', 'image/png')];
  if (kind === 'image') return [lazy('thumb', file.type || 'image/*')];
  if (kind === 'json' || kind === 'table') return [lazy('schema', 'application/json')];
  if (kind === 'office' || kind === 'binary') return [lazy('metadata', 'application/json')];
  return [];
}

function uploadedPreviewActions(file: File): PreviewDescriptor['actions'] {
  const kind = previewKindForUploadedFile(file);
  const common: PreviewDescriptor['actions'] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

function uploadedLocatorHints(file: File): PreviewDescriptor['locatorHints'] {
  const kind = previewKindForUploadedFile(file);
  if (kind === 'pdf') return ['page', 'region'];
  if (kind === 'image') return ['region'];
  if (kind === 'table') return ['row-range', 'column-range'];
  if (kind === 'structure') return ['structure-selection'];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['text-range'];
  return [];
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

function artifactTypeForUploadedFile(file: File) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'uploaded-pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'uploaded-image';
  if (/\.(csv|tsv|xlsx?|json)$/i.test(name)) return 'uploaded-data-file';
  if (/\.(txt|md|rtf|docx?)$/i.test(name)) return 'uploaded-document';
  return 'uploaded-file';
}

function previewKindForUploadedFile(file: File): PreviewDescriptor['kind'] {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return 'image';
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/\.(txt|log)$/i.test(name) || type.startsWith('text/')) return 'text';
  if (/\.(json|jsonl)$/i.test(name) || type.includes('json')) return 'json';
  if (/\.(csv|tsv|xlsx?)$/i.test(name)) return 'table';
  if (/\.(html?|xhtml)$/i.test(name)) return 'html';
  if (/\.(pdb|cif|mmcif)$/i.test(name)) return 'structure';
  if (/\.(docx?|pptx?)$/i.test(name)) return 'office';
  return 'binary';
}

function referenceForUploadedArtifact(artifact: RuntimeArtifact): BioAgentReference {
  const title = String(artifact.metadata?.title ?? artifact.id);
  return {
    id: makeId('ref-upload'),
    kind: 'file',
    title,
    ref: artifact.dataRef ?? artifact.id,
    summary: `用户上传文件 · ${artifact.type}`,
    sourceId: artifact.id,
    payload: {
      artifactId: artifact.id,
      type: artifact.type,
      metadata: artifact.metadata,
    },
  };
}

function objectReferenceForUploadedArtifact(artifact: RuntimeArtifact): ObjectReference {
  const title = String(artifact.metadata?.title ?? artifact.id);
  return {
    id: makeId('obj-upload'),
    kind: 'artifact',
    title,
    ref: artifact.id,
    artifactType: artifact.type,
    preferredView: artifact.type === 'uploaded-image' || artifact.type === 'uploaded-pdf' ? 'preview' : 'generic-artifact-inspector',
    actions: ['focus-right-pane', 'inspect', 'pin'],
    status: 'available',
    summary: '用户上传到证据矩阵的文件',
    provenance: {
      dataRef: artifact.dataRef,
      producer: 'user-upload',
      size: typeof artifact.metadata?.size === 'number' ? artifact.metadata.size : undefined,
    },
  };
}

function enrichRepairRaw(raw: unknown, repairHistory: unknown, sourceRunId: string, failureReason?: string) {
  const repairMetadata = { acceptanceRepair: { sourceRunId, repairHistory, failureReason } };
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...raw, ...repairMetadata }
    : { raw, ...repairMetadata };
}

function ContextWindowMeter({
  state,
  running,
}: {
  state: AgentContextWindowState;
  running: boolean;
}) {
  const meter = buildContextWindowMeterModel(state, running);
  const tooltipId = useId();
  return (
    <div
      role="status"
      aria-label={`上下文窗口 ${meter.ratioLabel}，${meter.statusLabel}`}
      aria-describedby={tooltipId}
      className={cx('context-window-meter', meter.level, meter.isEstimated && 'estimated', meter.isUnknown && 'unknown')}
      title={meter.title}
      tabIndex={0}
      style={{ '--context-window-ratio': meter.ratioStyle } as CSSProperties}
    >
      <span className="context-window-ring" aria-hidden="true">
        <span>{meter.ratioLabel === 'unknown' ? '?' : meter.ratioLabel}</span>
      </span>
      <div className="context-window-popover" id={tooltipId} role="tooltip">
        <div className="context-window-popover-head">
          <strong>Context window</strong>
          <em>{meter.statusLabel}</em>
        </div>
        <dl>
          {meter.detailRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <small>只读状态 · 压缩由 backend 能力和阈值触发</small>
      </div>
    </div>
  );
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
  config: BioAgentConfig;
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

function runIdForMessage(
  message: BioAgentMessage,
  index: number,
  messages: BioAgentMessage[],
  runs: BioAgentRun[],
) {
  if (!runs.length || message.id.startsWith('seed')) return undefined;
  if (message.role === 'user') {
    const normalizedContent = normalizeRunPrompt(message.content);
    return [...runs].reverse().find((run) => normalizeRunPrompt(run.prompt) === normalizedContent)?.id;
  }
  const responseIndex = messages
    .slice(0, index + 1)
    .filter((item) => !item.id.startsWith('seed') && item.role !== 'user')
    .length - 1;
  return runs[responseIndex]?.id;
}

function normalizeRunPrompt(value: string) {
  return value.replace(/^运行中引导：/, '').trim();
}

function ObjectReferenceChips({
  references,
  activeRunId,
  onFocus,
}: {
  references: ObjectReference[];
  activeRunId?: string;
  onFocus: (reference: ObjectReference) => void;
}) {
  const trusted = references.filter(isTrustedObjectReference);
  const pending = references.filter((reference) => !isTrustedObjectReference(reference));
  const visible = [...trusted, ...pending].slice(0, 8);
  const hidden = Math.max(0, references.length - visible.length);
  return (
    <div className="object-reference-strip" aria-label="回答中引用的对象">
      {visible.map((reference) => (
        <button
          type="button"
          key={reference.id}
          className={cx('object-reference-chip', activeRunId && reference.runId === activeRunId && 'active')}
          onClick={() => onFocus(reference)}
          title={reference.summary || reference.ref}
          data-tooltip={`${objectReferenceKindLabel(reference.kind)} · ${reference.ref}`}
          data-bioagent-reference={bioAgentReferenceAttribute(referenceForObjectReference(reference))}
        >
          <span>{objectReferenceIcon(reference.kind)}</span>
          <strong>{reference.title}</strong>
          {!isTrustedObjectReference(reference) ? <Badge variant="warning">点击验证</Badge> : null}
          {reference.status && reference.status !== 'available' ? <Badge variant={reference.status === 'blocked' ? 'danger' : 'warning'}>{reference.status}</Badge> : null}
        </button>
      ))}
      {hidden ? <Badge variant="muted">+{hidden} objects</Badge> : null}
    </div>
  );
}

function isTrustedObjectReference(reference: ObjectReference) {
  if (reference.status && reference.status !== 'available') return false;
  if (reference.kind === 'artifact') return true;
  if (reference.kind === 'url') return true;
  if (/^agentserver:\/\//i.test(reference.ref)) return false;
  return Boolean(reference.provenance?.hash || reference.provenance?.size || reference.provenance?.producer);
}

function TurnAcceptanceNotice({
  acceptance,
}: {
  acceptance: NonNullable<BioAgentMessage['acceptance']>;
}) {
  return (
    <div className="turn-acceptance-notice">
      <Badge variant={acceptance.severity === 'repairable' ? 'warning' : 'danger'}>{acceptance.severity}</Badge>
      <span>{acceptance.failures.map((failure) => failure.detail).join('；')}</span>
    </div>
  );
}

function BioAgentReferenceChips({
  references,
  onRemove,
  onFocus,
}: {
  references: BioAgentReference[];
  onRemove?: (referenceId: string) => void;
  onFocus?: (reference: BioAgentReference) => void;
}) {
  return (
    <div className="bioagent-reference-strip" aria-label="用户引用的上下文">
      {references.slice(0, 8).map((reference) => (
        <span
          role="button"
          tabIndex={0}
          key={reference.id}
          className={cx('bioagent-reference-chip', `kind-${reference.kind}`)}
          title={reference.summary || reference.ref}
          onClick={() => onFocus?.(reference)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            onFocus?.(reference);
          }}
        >
          <span>{referenceComposerMarker(reference)}</span>
          <strong>{reference.title}</strong>
          {onRemove ? (
            <i
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(reference.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onRemove(reference.id);
              }}
              aria-label={`移除引用 ${reference.title}`}
            >
              <X size={12} />
            </i>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function bioAgentReferenceKindLabel(kind: BioAgentReference['kind']) {
  if (kind === 'file') return 'file';
  if (kind === 'file-region') return 'region';
  if (kind === 'message') return 'msg';
  if (kind === 'task-result') return 'run';
  if (kind === 'chart') return 'chart';
  if (kind === 'table') return 'table';
  return 'ui';
}

function bioAgentReferenceAttribute(reference: BioAgentReference | undefined) {
  return reference ? JSON.stringify(reference) : undefined;
}

function appendReferenceMarkerToInput(currentInput: string, reference: BioAgentReference) {
  const marker = referenceComposerMarker(reference);
  if (!marker || currentInput.includes(marker)) return currentInput;
  return [currentInput.trimEnd(), marker].filter(Boolean).join(' ');
}

function removeReferenceMarkerFromInput(currentInput: string, reference: BioAgentReference) {
  const marker = referenceComposerMarker(reference);
  return currentInput
    .replace(marker, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

function referenceComposerMarker(reference: BioAgentReference) {
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const marker = typeof payload?.composerMarker === 'string' ? payload.composerMarker : '';
  return marker || '※?';
}

function withComposerMarker(reference: BioAgentReference, currentReferences: BioAgentReference[]) {
  const existing = currentReferences.find((item) => item.id === reference.id);
  if (existing) return existing;
  const marker = nextComposerMarker(currentReferences);
  return {
    ...reference,
    payload: {
      ...(isRecord(reference.payload) ? reference.payload : {}),
      composerMarker: marker,
    },
  };
}

function nextComposerMarker(currentReferences: BioAgentReference[]) {
  const used = new Set(currentReferences.map(referenceComposerMarker));
  for (let index = 1; index <= currentReferences.length + 1; index += 1) {
    const marker = `※${index}`;
    if (!used.has(marker)) return marker;
  }
  return `※${currentReferences.length + 1}`;
}

function highlightReferencedContent(reference: BioAgentReference) {
  const element = elementForBioAgentReference(reference);
  if (!element) return;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.add('bioagent-reference-focus');
  window.setTimeout(() => element.classList.remove('bioagent-reference-focus'), 2200);
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  const selectedText = typeof payload?.selectedText === 'string' ? payload.selectedText : '';
  if (selectedText) selectTextInElement(element, selectedText);
}

function elementForBioAgentReference(reference: BioAgentReference) {
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
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-bioagent-reference]'))) {
    const parsed = parseBioAgentReferenceAttribute(element.dataset.bioagentReference);
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

function textSelectionReferenceTarget(event?: MouseEvent): { element: HTMLElement; reference: BioAgentReference } | undefined {
  const rawTarget = event?.target instanceof Element ? event.target : undefined;
  if (rawTarget?.closest('.composer, .reference-pick-banner, .settings-dialog, .reference-context-menu')) return undefined;
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim();
  if (!selection || selection.rangeCount === 0 || !selectedText) return undefined;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element
    : range.commonAncestorContainer.parentElement;
  const element = ancestor?.closest<HTMLElement>('[data-bioagent-reference], .message, .registry-slot, .card, .data-preview-table, table, section');
  if (!element || element.closest('.composer, .reference-pick-banner, .settings-dialog')) return undefined;
  if (rawTarget && !element.contains(rawTarget) && !rawTarget.contains(element)) return undefined;
  const sourceReference = parseBioAgentReferenceAttribute(element.dataset.bioagentReference) ?? referenceForUiElement(element);
  const textHash = stableHash(`${sourceReference.ref}:${selectedText}`);
  const clippedText = selectedText.length > 2400 ? `${selectedText.slice(0, 2400)}...` : selectedText;
  return {
    element,
    reference: {
      id: `ref-text-${textHash}`,
      kind: 'ui',
      title: `选中文本 · ${selectedText.replace(/\s+/g, ' ').slice(0, 28)}`,
      ref: `ui-text:${sourceReference.ref}#${textHash}`,
      sourceId: sourceReference.sourceId,
      runId: sourceReference.runId,
      summary: clippedText,
      locator: {
        textRange: selectedText.slice(0, 160),
        region: sourceReference.ref,
      },
      payload: {
        selectedText: clippedText,
        sourceTitle: sourceReference.title,
        sourceRef: sourceReference.ref,
        sourceKind: sourceReference.kind,
        sourceSummary: sourceReference.summary,
      },
    },
  };
}

function referenceTargetFromEvent(event: MouseEvent): { element: HTMLElement; reference: BioAgentReference } | undefined {
  const rawTarget = event.target instanceof Element ? event.target : undefined;
  if (!rawTarget || rawTarget.closest('.composer, .reference-pick-banner, .settings-dialog')) return undefined;
  const explicit = rawTarget.closest<HTMLElement>('[data-bioagent-reference]');
  if (explicit) {
    const reference = parseBioAgentReferenceAttribute(explicit.dataset.bioagentReference);
    if (reference) return { element: explicit, reference };
  }
  const implicit = rawTarget.closest<HTMLElement>('button, [role="button"], .registry-slot, .card, .message, .data-preview-table, table, canvas, svg, section');
  if (!implicit || !(implicit instanceof HTMLElement) || implicit.closest('.composer, .reference-pick-banner, .settings-dialog')) return undefined;
  return { element: implicit, reference: referenceForUiElement(implicit) };
}

function parseBioAgentReferenceAttribute(value: string | undefined): BioAgentReference | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<BioAgentReference>;
    if (!parsed.id || !parsed.kind || !parsed.title || !parsed.ref) return undefined;
    return parsed as BioAgentReference;
  } catch {
    return undefined;
  }
}

function referenceForMessage(message: BioAgentMessage, runId?: string): BioAgentReference {
  return {
    id: `ref-message-${message.id}`,
    kind: 'message',
    title: `${message.role === 'user' ? '用户' : message.role === 'system' ? '系统' : 'Agent'} · ${message.content.trim().slice(0, 28) || message.id}`,
    ref: `message:${message.id}`,
    sourceId: message.id,
    runId,
    summary: message.content.slice(0, 500),
    payload: {
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      references: message.references,
      objectReferences: message.objectReferences,
    },
  };
}

function referenceForRun(run: BioAgentRun): BioAgentReference {
  return {
    id: `ref-run-${run.id}`,
    kind: 'task-result',
    title: `run ${run.id.replace(/^run-/, '').slice(0, 8)} · ${run.status}`,
    ref: `run:${run.id}`,
    sourceId: run.id,
    runId: run.id,
    summary: `${run.prompt.slice(0, 240)}\n${run.response.slice(0, 240)}`,
    payload: {
      status: run.status,
      prompt: run.prompt,
      response: run.response,
      references: run.references,
      objectReferences: run.objectReferences,
    },
  };
}

function referenceForObjectReference(reference: ObjectReference): BioAgentReference {
  const kind: BioAgentReference['kind'] = reference.kind === 'file' ? 'file'
    : reference.kind === 'artifact' && /table|matrix|csv|dataframe/i.test(reference.artifactType ?? reference.title) ? 'table'
      : reference.kind === 'artifact' && /chart|plot|graph|visual|umap|heatmap/i.test(reference.artifactType ?? reference.title) ? 'chart'
        : 'task-result';
  return {
    id: `ref-object-${reference.id}`,
    kind,
    title: reference.title,
    ref: reference.ref,
    sourceId: reference.id,
    runId: reference.runId,
    summary: reference.summary,
    payload: {
      artifactType: reference.artifactType,
      preferredView: reference.preferredView,
      provenance: reference.provenance,
      status: reference.status,
    },
  };
}

function referenceForUiElement(element: HTMLElement): BioAgentReference {
  const title = readableElementTitle(element);
  const selector = stableElementSelector(element);
  return {
    id: `ref-ui-${selector.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || makeId('ui')}`,
    kind: 'ui',
    title,
    ref: `ui:${selector}`,
    summary: element.innerText?.trim().slice(0, 600) || element.getAttribute('aria-label') || element.className.toString(),
    payload: {
      tagName: element.tagName.toLowerCase(),
      className: element.className.toString(),
      ariaLabel: element.getAttribute('aria-label'),
      textPreview: element.innerText?.trim().slice(0, 1000),
    },
  };
}

function readableElementTitle(element: HTMLElement) {
  return (element.getAttribute('aria-label')
    || element.getAttribute('title')
    || element.querySelector('h1,h2,h3,strong')?.textContent
    || element.innerText
    || element.tagName)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 52);
}

function stableElementSelector(element: HTMLElement) {
  if (element.id) return `#${element.id}`;
  const dataRunId = element.dataset.runId;
  if (dataRunId) return `[data-run-id="${dataRunId}"]`;
  const className = element.className.toString().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
  return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function objectReferenceKindLabel(kind: ObjectReference['kind']) {
  if (kind === 'artifact') return 'artifact';
  if (kind === 'file') return 'file';
  if (kind === 'folder') return 'folder';
  if (kind === 'run') return 'run';
  if (kind === 'execution-unit') return 'execution unit';
  if (kind === 'scenario-package') return 'scenario package';
  return 'url';
}

function objectReferenceIcon(kind: ObjectReference['kind']) {
  if (kind === 'folder') return 'folder';
  if (kind === 'file') return 'file';
  if (kind === 'run') return 'run';
  if (kind === 'execution-unit') return 'EU';
  if (kind === 'url') return 'link';
  if (kind === 'scenario-package') return 'pkg';
  return 'obj';
}

function latestTokenUsage(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.usage)?.usage;
}

export function mergeRunTimelineEvents(events: TimelineEventRecord[], previousSession: BioAgentSession | undefined, nextSession: BioAgentSession) {
  const previousRunIds = new Set(previousSession?.runs.map((run) => run.id) ?? []);
  const existingEventIds = new Set(events.map((event) => event.id));
  const newEvents = nextSession.runs
    .filter((run) => !previousRunIds.has(run.id))
    .map((run) => timelineEventFromStoredRun(nextSession, run))
    .filter((event) => !existingEventIds.has(event.id));
  return [...newEvents, ...events].slice(0, 200);
}

function timelineEventFromStoredRun(session: BioAgentSession, run: BioAgentSession['runs'][number]): TimelineEventRecord {
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
    actor: 'BioAgent Runtime',
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

function SessionHistoryPanel({
  currentSession,
  archivedSessions,
  onRestore,
  onDelete,
  onClear,
}: {
  currentSession: BioAgentSession;
  archivedSessions: BioAgentSession[];
  onRestore: (sessionId: string) => void;
  onDelete: (sessionIds: string[]) => void;
  onClear: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const currentStats = sessionHistoryStats(currentSession);
  const allSelected = archivedSessions.length > 0 && selectedIds.length === archivedSessions.length;
  function toggleSelected(sessionId: string) {
    setSelectedIds((current) => current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId]);
  }
  function deleteSelected() {
    if (!selectedIds.length) return;
    onDelete(selectedIds);
    setSelectedIds([]);
  }
  function clearAll() {
    if (!archivedSessions.length) return;
    onClear();
    setSelectedIds([]);
  }
  return (
    <div className="session-history-panel">
      <div className="session-history-head">
        <div>
          <strong>历史会话</strong>
          <span>当前：{currentSession.title}</span>
        </div>
        <Badge variant="muted">{currentStats}</Badge>
      </div>
      {archivedSessions.length ? (
        <div className="session-history-bulkbar">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => setSelectedIds(event.target.checked ? archivedSessions.map((item) => item.sessionId) : [])}
            />
            全选
          </label>
          <Badge variant={selectedIds.length ? 'info' : 'muted'}>{selectedIds.length} selected</Badge>
          <button type="button" onClick={deleteSelected} disabled={!selectedIds.length}>删除选中</button>
          <button type="button" onClick={clearAll}>清空历史</button>
        </div>
      ) : null}
      {!archivedSessions.length ? (
        <div className="empty-runtime-state compact">
          <Badge variant="muted">empty</Badge>
          <strong>暂无归档会话</strong>
          <p>点击开启新聊天或删除当前聊天后，旧会话会进入这里。</p>
        </div>
      ) : (
        <div className="session-history-list">
          {archivedSessions.map((item) => (
            <div className="session-history-row" key={item.sessionId}>
              <input
                type="checkbox"
                checked={selectedIds.includes(item.sessionId)}
                onChange={() => toggleSelected(item.sessionId)}
                aria-label={`选择历史会话 ${item.title}`}
              />
              <div className="session-history-copy">
                <strong>{item.title}</strong>
                <span>{formatSessionTime(item.updatedAt || item.createdAt)} · {sessionHistoryStats(item)}</span>
                <div className="session-history-meta">
                  {sessionHistoryPackageLabel(item) ? <code>{sessionHistoryPackageLabel(item)}</code> : null}
                  {sessionHistoryLastRunLabel(item) ? <Badge variant={sessionHistoryLastRunVariant(item)}>{sessionHistoryLastRunLabel(item)}</Badge> : <Badge variant="muted">no runs</Badge>}
                </div>
              </div>
              <ActionButton icon={Clock} variant="secondary" onClick={() => onRestore(item.sessionId)}>恢复</ActionButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function sessionHistoryStats(session: BioAgentSession) {
  const userMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return `${userMessages} messages · ${session.artifacts.length} artifacts · ${session.executionUnits.length} units`;
}

function sessionHistoryPackageLabel(session: BioAgentSession) {
  const lastRun = session.runs.at(-1);
  const ref = lastRun?.scenarioPackageRef;
  if (!ref) return undefined;
  return `${ref.id}@${ref.version}`;
}

function sessionHistoryLastRunLabel(session: BioAgentSession) {
  const lastRun = session.runs.at(-1);
  if (!lastRun) return undefined;
  return `last run ${lastRun.status}`;
}

function sessionHistoryLastRunVariant(session: BioAgentSession): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  const status = session.runs.at(-1)?.status;
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'idle') return 'muted';
  return 'info';
}

function formatSessionTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}
