import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, CircleStop, Clock, Copy, Download, FileUp, MessageSquare, Plus, Quote, Sparkles, Trash2, X } from 'lucide-react';
import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { compactAgentContext, sendAgentMessageStream, validateSemanticTurnAcceptance } from '../api/agentClient';
import { sendSciForgeToolMessage } from '../api/sciforgeToolsClient';
import { buildContextWindowMeterModel, estimateContextWindowState, latestContextWindowState, shouldStartContextCompaction } from '../contextWindow';
import { buildContextCompactionFailureResult, buildContextCompactionOutcome } from '../contextCompaction';
import { builtInScenarioPackageRef } from '../scenarioCompiler/scenarioPackage';
import { resetSession } from '../sessionStore';
import { coalesceStreamEvents, formatAgentTokenUsage, latestRunningEvent, presentStreamEvent, streamEventCounts } from '../streamEventPresentation';
import { acceptAndRepairAgentResponse, buildBackendAcceptanceRepairPrompt, buildUserGoalSnapshot, shouldRunBackendAcceptanceRepair } from '../turnAcceptance';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../artifactIntent';
import { makeId, nowIso, type AgentContextWindowState, type AgentStreamEvent, type SciForgeConfig, type SciForgeMessage, type SciForgeReference, type SciForgeRun, type SciForgeSession, type NormalizedAgentResponse, type ObjectAction, type ObjectReference, type ObjectReferenceKind, type RuntimeArtifact, type RuntimeExecutionUnit, type ScenarioInstanceId, type ScenarioRuntimeOverride, type TimelineEventRecord } from '../domain';
import { writeWorkspaceFile } from '../api/workspaceClient';
import { exportJsonFile } from './exportUtils';
import { ActionButton, Badge, ClaimTag, ConfidenceBar, EvidenceTag, IconButton, cx } from './uiPrimitives';
import {
  appendReferenceMarkerToInput,
  artifactTypeForUploadedFileLike as artifactTypeForUploadedFile,
  sciForgeReferenceAttribute,
  mergeObjectReferences,
  objectReferenceChipModel,
  objectReferenceForArtifactSummary,
  objectReferenceForUploadedArtifact,
  objectReferenceIcon,
  objectReferenceKindLabel,
  parseSciForgeReferenceAttribute,
  previewKindForUploadedFileLike as previewKindForUploadedFile,
  referenceComposerMarker,
  referenceForMessage,
  referenceForObjectReference,
  referenceForRun,
  referenceForTextSelection,
  referenceForUiElement,
  referenceForUploadedArtifact,
  removeReferenceMarkerFromInput,
  uploadedDerivativeHintsForFileLike as uploadedDerivativeHints,
  uploadedInlinePolicyForFileLike as uploadedInlinePolicy,
  uploadedLocatorHintsForFileLike as uploadedLocatorHints,
  uploadedPreviewActionsForFileLike as uploadedPreviewActions,
  withComposerMarker,
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
  const [guidanceQueue, setGuidanceQueue] = useState<string[]>([]);
  const [referencePickMode, setReferencePickMode] = useState(false);
  const [pendingReferences, setPendingReferences] = useState<SciForgeReference[]>([]);
  const [referenceContextMenu, setReferenceContextMenu] = useState<ReferenceContextMenuState | null>(null);
  const activeSessionRef = useRef(session);
  const inputRef = useRef(input);
  const guidanceQueueRef = useRef<string[]>([]);
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
    savedScrollTopRef.current = savedScrollTop;
  }, [savedScrollTop]);

  useEffect(() => {
    if (input.trim() || pendingReferences.length || referencePickMode) setComposerExpanded(true);
  }, [input, pendingReferences.length, referencePickMode]);

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
      window.requestAnimationFrame(() => {
        const element = messagesRef.current;
        if (!element) return;
        element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
      });
    }
  }, [messages.length, isSending]);

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
      const uploadMessage: SciForgeMessage = {
        id: makeId('msg'),
        role: 'system',
        content: `已上传 ${uploaded.length} 个文件到证据矩阵：${uploaded.map((artifact) => artifact.metadata?.title ?? artifact.id).join('、')}`,
        createdAt: now,
        status: 'completed',
        references,
        objectReferences: uploaded.map((artifact) => objectReferenceForUploadedArtifact(artifact)),
      };
      const nextSession: SciForgeSession = {
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

  function addPendingReference(reference: SciForgeReference) {
    setPendingReferences((current) => {
      if (current.some((item) => item.id === reference.id)) return current;
      return [...current, reference].slice(0, 8);
    });
  }

  function addPendingReferenceToComposer(reference: SciForgeReference) {
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

  function focusPendingReference(reference: SciForgeReference) {
    highlightReferencedContent(reference);
  }

  async function runPrompt(prompt: string, baseSession: SciForgeSession, references: SciForgeReference[] = []) {
    const turnId = makeId('turn');
    const turnComponentHints = selectedComponentsForCurrentTurn(
      prompt,
      availableComponentIds.length
        ? availableComponentIds
        : (scenarioOverride?.defaultComponents?.length
          ? scenarioOverride.defaultComponents
          : SCENARIO_SPECS[baseScenarioId].componentPolicy.defaultComponents),
    );
    const goalSnapshot = buildUserGoalSnapshot({
      turnId,
      prompt,
      references,
      scenarioId,
      scenarioOverride,
      expectedArtifacts: expectedArtifactsForCurrentTurn({
        scenarioId: baseScenarioId,
        prompt,
        selectedComponentIds: turnComponentHints,
      }),
      recentMessages: baseSession.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
    });
    const userMessage: SciForgeMessage = {
      id: makeId('msg'),
      role: 'user',
      content: prompt,
      createdAt: nowIso(),
      status: 'completed',
      references,
      goalSnapshot,
    };
    const optimisticSession: SciForgeSession = {
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
    setComposerExpanded(false);
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
        availableComponentIds,
        scenarioPackageRef,
        skillPlanRef,
        uiPlanRef,
      };
      const preflightState = latestContextWindowState(streamEvents)
        ?? estimateContextWindowState(baseSession, config, streamEvents);
      if (shouldStartContextCompaction({
        state: preflightState,
        running: false,
        inFlight: false,
        reason: 'auto-threshold-before-send',
      })) {
        const startedAt = nowIso();
        setStreamEvents((current) => [...current.slice(-31), {
          id: makeId('evt'),
          type: 'contextCompaction',
          label: '上下文压缩',
          detail: '发送前达到阈值，正在请求 AgentServer/backend 原生压缩。',
          contextWindowState: {
            ...preflightState,
            pendingCompact: true,
            status: 'compacting',
          },
          contextCompaction: {
            status: 'started',
            source: 'agentserver',
            backend: config.agentBackend,
            compactCapability: preflightState.compactCapability,
            before: preflightState,
            startedAt,
            reason: 'auto-threshold-before-send',
            message: '发送前达到阈值，正在请求 AgentServer/backend 原生压缩。',
          },
          createdAt: startedAt,
        }]);
        try {
          const compactResult = await compactAgentContext(request, 'auto-threshold-before-send', controller.signal);
          const completedAt = nowIso();
          const outcome = buildContextCompactionOutcome({
            eventId: makeId('evt'),
            messageId: makeId('msg'),
            result: compactResult,
            beforeState: preflightState,
            reason: 'auto-threshold-before-send',
            startedAt,
            completedAt,
            fallbackBackend: config.agentBackend,
          });
          setStreamEvents((current) => coalesceStreamEvents(current, outcome.event).slice(-32));
        } catch (compactError) {
          if (compactError instanceof DOMException && compactError.name === 'AbortError') throw compactError;
          const completedAt = nowIso();
          const outcome = buildContextCompactionOutcome({
            eventId: makeId('evt'),
            messageId: makeId('msg'),
            result: buildContextCompactionFailureResult({
              error: compactError,
              reason: 'auto-threshold-before-send',
              backend: config.agentBackend,
              compactCapability: preflightState.compactCapability,
              startedAt,
            }),
            beforeState: preflightState,
            reason: 'auto-threshold-before-send',
            startedAt,
            completedAt,
            fallbackBackend: config.agentBackend,
          });
          setStreamEvents((current) => coalesceStreamEvents(current, outcome.event).slice(-32));
        }
      }
      let response: NormalizedAgentResponse;
      try {
        response = await sendSciForgeToolMessage(request, {
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
          detail: `SciForge project tool unavailable, falling back to AgentServer: ${detail}`,
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
    const guidanceMessage: SciForgeMessage = {
      id: makeId('msg'),
      role: 'user',
      content: `运行中引导：${prompt}`,
      createdAt: now,
      status: 'running',
    };
    const nextSession: SciForgeSession = {
      ...activeSessionRef.current,
      messages: [...activeSessionRef.current.messages, guidanceMessage],
      updatedAt: now,
    };
    activeSessionRef.current = nextSession;
    onSessionChange(nextSession);
    onInputChange('');
    inputRef.current = '';
    setComposerExpanded(false);
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
    references: SciForgeReference[];
    request: {
      artifacts?: NormalizedAgentResponse['artifacts'];
      executionUnits?: NormalizedAgentResponse['executionUnits'];
      runs?: NormalizedAgentResponse['run'][];
      messages: SciForgeMessage[];
    } & Parameters<typeof sendSciForgeToolMessage>[0];
    acceptedResponse: NormalizedAgentResponse;
    goalSnapshot: NonNullable<SciForgeMessage['goalSnapshot']>;
    sessionBeforeMerge: SciForgeSession;
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
      const repairResponse = await sendSciForgeToolMessage({
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

  function mergeAgentResponse(baseSession: SciForgeSession, response: NormalizedAgentResponse): SciForgeSession {
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
      executionUnits: mergeExecutionUnits(response.executionUnits, baseSession.executionUnits),
      artifacts: mergeRuntimeArtifacts(response.artifacts, baseSession.artifacts),
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
      <div className="panel-title compact">
        <div className="scenario-mini" style={{ background: `${scenario.color}18`, color: scenario.color }}>
          <scenario.icon size={18} />
        </div>
        <strong className="panel-scenario-name">{scenario.name}</strong>
        <Badge variant="success" glow>在线</Badge>
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
      <div className="messages-stack">
        <div
          className="messages"
          ref={messagesRef}
          onScroll={handleMessagesScroll}
        >
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
                {message.status === 'failed' ? <Badge variant="danger">failed</Badge> : null}
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
                  <MessageContent
                    content={message.content}
                    references={inlineObjectReferencesForMessage(message, session, messageRunId)}
                    onObjectFocus={onObjectFocus}
                  />
                  {messageRunId && message.role !== 'user' ? (
                    <RunKeyInfo
                      runId={messageRunId}
                      session={session}
                      onObjectFocus={onObjectFocus}
                    />
                  ) : null}
                  {messageRunId && message.role !== 'user' ? (
                    <RunExecutionProcess
                      runId={messageRunId}
                      session={session}
                      trace={message.expandable}
                      onObjectFocus={onObjectFocus}
                    />
                  ) : null}
                </>
              )}
              {message.references?.length ? (
                <SciForgeReferenceChips references={message.references} />
              ) : null}
              {message.acceptance && !message.acceptance.pass ? (
                <TurnAcceptanceNotice acceptance={message.acceptance} />
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
        </div>
      </div>

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
      {!composerExpanded ? (
        <button
          type="button"
          className="composer-collapsed"
          onClick={() => setComposerExpanded(true)}
          aria-expanded={false}
          title="展开输入栏"
        >
          <Sparkles size={15} />
          <span>输入研究问题，或点选对象后继续追问...</span>
          <ChevronUp size={15} />
        </button>
      ) : (
      <div className="composer" aria-expanded={true}>
        <button
          type="button"
          className="composer-collapse-button"
          onClick={() => setComposerExpanded(false)}
          title="收起输入栏"
          aria-label="收起输入栏"
        >
          <ChevronDown size={15} />
        </button>
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
            <SciForgeReferenceChips
              references={pendingReferences}
              onRemove={removePendingReference}
              onFocus={focusPendingReference}
            />
          ) : (
            <span className="reference-hint">点选 SciForge 可见对象作为上下文</span>
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
      )}
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
    tool: 'sciforge.acceptance-repair-rerun',
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

function requestPayloadForTurn(session: SciForgeSession, userMessage: SciForgeMessage, references: SciForgeReference[]) {
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

function rollbackSessionBeforeMessage(session: SciForgeSession, messageId: string): SciForgeSession {
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return session;
  const cutoff = session.messages[index]?.createdAt;
  const runs = cutoff ? session.runs.filter((run) => run.createdAt < cutoff) : [];
  const keptRunIds = new Set(runs.map((run) => run.id));
  return {
    ...session,
    messages: session.messages.slice(0, index),
    runs,
    uiManifest: [],
    claims: cutoff ? session.claims.filter((claim) => claim.updatedAt < cutoff) : [],
    executionUnits: session.executionUnits.filter((unit) => {
      const selectedAt = unit.routeDecision?.selectedAt;
      return selectedAt ? selectedAt < cutoff : keptRunIds.size > 0;
    }),
    artifacts: keptRunIds.size ? session.artifacts : [],
    notebook: cutoff ? session.notebook.filter((entry) => entry.time < cutoff) : [],
    updatedAt: nowIso(),
  };
}

function mergeRuntimeArtifacts(primary: NormalizedAgentResponse['artifacts'], secondary: NormalizedAgentResponse['artifacts']) {
  const byKey = new Map<string, NormalizedAgentResponse['artifacts'][number]>();
  for (const artifact of [...secondary, ...primary]) {
    const key = artifact.id || artifact.path || artifact.dataRef || `${artifact.type}-${byKey.size}`;
    byKey.set(key, { ...byKey.get(key), ...artifact });
  }
  return Array.from(byKey.values()).slice(0, 32);
}

function mergeExecutionUnits(primary: NormalizedAgentResponse['executionUnits'], secondary: NormalizedAgentResponse['executionUnits']) {
  const byId = new Map<string, NormalizedAgentResponse['executionUnits'][number]>();
  for (const unit of [...secondary, ...primary]) {
    const key = unit.id || `${unit.tool}-${byId.size}`;
    byId.set(key, { ...byId.get(key), ...unit });
  }
  return Array.from(byId.values()).slice(0, 32);
}

function mergeRuns(primary: NormalizedAgentResponse['run'][], secondary: NormalizedAgentResponse['run'][]) {
  const byId = new Map<string, NormalizedAgentResponse['run']>();
  for (const run of [...primary, ...secondary]) byId.set(run.id, { ...byId.get(run.id), ...run });
  return Array.from(byId.values()).slice(-12);
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

function runIdForMessage(
  message: SciForgeMessage,
  index: number,
  messages: SciForgeMessage[],
  runs: SciForgeRun[],
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

function MessageContent({
  content,
  references,
  onObjectFocus,
}: {
  content: string;
  references: ObjectReference[];
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  return (
    <div className="message-content">
      {renderMarkdownBlocks(content, references, onObjectFocus)}
    </div>
  );
}

type MarkdownBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; depth: number; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language?: string; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'rule' };

function renderMarkdownBlocks(
  markdown: string,
  references: ObjectReference[],
  onObjectFocus: (reference: ObjectReference) => void,
): ReactNode[] {
  const blocks = parseMarkdownBlocks(markdown);
  return blocks.map((block, index) => {
    const key = `md-${index}`;
    if (block.type === 'heading') {
      const children = renderInlineMarkdown(block.text, references, onObjectFocus, key);
      if (block.depth === 1) return <h1 key={key}>{children}</h1>;
      if (block.depth === 2) return <h2 key={key}>{children}</h2>;
      if (block.depth === 3) return <h3 key={key}>{children}</h3>;
      if (block.depth === 4) return <h4 key={key}>{children}</h4>;
      if (block.depth === 5) return <h5 key={key}>{children}</h5>;
      return <h6 key={key}>{children}</h6>;
    }
    if (block.type === 'blockquote') {
      return <blockquote key={key}>{renderInlineMarkdown(block.text, references, onObjectFocus, key)}</blockquote>;
    }
    if (block.type === 'code') {
      return (
        <pre key={key} className="message-code-block">
          {block.language ? <span className="message-code-lang">{block.language}</span> : null}
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.type === 'list') {
      const items = block.items.map((item, itemIndex) => (
        <li key={`${key}-li-${itemIndex}`}>{renderInlineMarkdown(item, references, onObjectFocus, `${key}-${itemIndex}`)}</li>
      ));
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    if (block.type === 'table') {
      const [head, ...body] = block.rows;
      return (
        <div key={key} className="message-table-scroll">
          <table>
            {head ? (
              <thead>
                <tr>{head.map((cell, cellIndex) => <th key={`${key}-th-${cellIndex}`}>{renderInlineMarkdown(cell, references, onObjectFocus, `${key}-h-${cellIndex}`)}</th>)}</tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`${key}-tr-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`${key}-td-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, references, onObjectFocus, `${key}-c-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === 'rule') return <hr key={key} />;
    return <p key={key}>{renderInlineMarkdown(block.text, references, onObjectFocus, key)}</p>;
  });
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language: fence[1], text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }
    if (isMarkdownTableAt(lines, index)) {
      const rows: string[][] = [];
      rows.push(splitMarkdownTableRow(lines[index]));
      index += 2;
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        rows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const match = orderedList ? lines[index].match(/^\s*\d+[.)]\s+(.+)$/) : lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ type: 'list', ordered: orderedList, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quote.join('\n') });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks.length ? blocks : [{ type: 'paragraph', text: '' }];
}

function isMarkdownBlockStart(lines: string[], index: number) {
  const line = lines[index];
  return /^```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || isMarkdownTableAt(lines, index);
}

function isMarkdownTableAt(lines: string[], index: number) {
  return index + 1 < lines.length
    && /^\s*\|.+\|\s*$/.test(lines[index])
    && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function splitMarkdownTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderInlineMarkdown(
  text: string,
  references: ObjectReference[],
  onObjectFocus: (reference: ObjectReference) => void,
  keyPrefix: string,
): ReactNode[] {
  const pieces = linkifyObjectReferences(text, references);
  const nodes: ReactNode[] = [];
  pieces.forEach((piece, index) => {
    if (piece.reference) {
      nodes.push(
        <button
          key={`${keyPrefix}-ref-${index}`}
          type="button"
          className="message-object-link"
          onClick={() => onObjectFocus(piece.reference as ObjectReference)}
          title={piece.reference.summary || piece.reference.ref}
          data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(piece.reference))}
        >
          {piece.text}
        </button>,
      );
    } else {
      nodes.push(...renderInlineText(piece.text, `${keyPrefix}-txt-${index}`));
    }
  });
  return nodes;
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+(?:\*[^*\n]+)*\*\*|\[[^\]\n]+\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    appendPlainInlineText(nodes, text.slice(lastIndex, match.index), `${keyPrefix}-plain-${nodes.length}`);
    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-code-${nodes.length}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-strong-${nodes.length}`}>{renderInlineText(token.slice(2, -2), `${keyPrefix}-strong-${nodes.length}`)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`${keyPrefix}-em-${nodes.length}`}>{renderInlineText(token.slice(1, -1), `${keyPrefix}-em-${nodes.length}`)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)$/);
      if (link) {
        nodes.push(
          <a key={`${keyPrefix}-link-${nodes.length}`} href={link[2]} target="_blank" rel="noreferrer">
            {renderInlineText(link[1], `${keyPrefix}-link-${nodes.length}`)}
          </a>,
        );
      } else {
        appendPlainInlineText(nodes, token, `${keyPrefix}-fallback-${nodes.length}`);
      }
    }
    lastIndex = match.index + token.length;
  }
  appendPlainInlineText(nodes, text.slice(lastIndex), `${keyPrefix}-tail-${nodes.length}`);
  return nodes;
}

function appendPlainInlineText(nodes: ReactNode[], text: string, keyPrefix: string) {
  if (!text) return;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (line) nodes.push(<span key={`${keyPrefix}-${index}`}>{line}</span>);
    if (index < lines.length - 1) nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
  });
}

function RunningWorkProcess({
  events,
  counts,
  tokenUsage,
  backend,
  guidanceCount,
}: {
  events: AgentStreamEvent[];
  counts: ReturnType<typeof streamEventCounts>;
  tokenUsage?: AgentStreamEvent['usage'];
  backend: string;
  guidanceCount: number;
}) {
  const visibleEvents = events.slice(-24);
  const usageLabel = formatAgentTokenUsage(tokenUsage);
  if (!visibleEvents.length && !guidanceCount && !usageLabel) return null;
  return (
    <details className="message-fold depth-2 running-work-process">
      <summary>
        工作过程 · {counts.key} 关键 · {counts.background} 过程
        {usageLabel ? ` · ${usageLabel}` : ''}
      </summary>
      <div className="running-work-process-body">
        <div className="running-work-process-meta">
          <Badge variant="muted">{backend}</Badge>
          {guidanceCount ? <Badge variant="warning">{guidanceCount} 条引导排队</Badge> : null}
          {counts.debug ? <Badge variant="muted">{counts.debug} debug</Badge> : null}
        </div>
        <div className="stream-events-list inline">
          {visibleEvents.map((event) => {
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
      </div>
    </details>
  );
}

function inlineObjectReferencesForMessage(message: SciForgeMessage, session: SciForgeSession, runId?: string) {
  const run = runId ? session.runs.find((item) => item.id === runId) : undefined;
  const runArtifactRefs = new Set((run?.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/, '')));
  const runArtifacts = session.artifacts
    .filter((artifact) => runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId)
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  const structuredReferences = mergeObjectReferences(message.objectReferences ?? [], mergeObjectReferences(run?.objectReferences ?? [], runArtifacts), 32);
  return mergeObjectReferences(objectReferencesFromInlineTokens(message.content, runId), structuredReferences, 40);
}

function objectReferencesFromInlineTokens(content: string, runId?: string) {
  const references: ObjectReference[] = [];
  const seen = new Set<string>();
  const tokenPattern = /\b(?:(?:artifact|file|folder|run|execution-unit|scenario-package)::?[^\s)\]）>，。；、,;]+|https?:\/\/[^\s)\]）>，。；、]+)[^\s)\]）>，。；、,;]*/gi;
  for (const match of content.matchAll(tokenPattern)) {
    const raw = match[0].replace(/[.,;，。；、]+$/, '');
    const reference = objectReferenceFromInlineToken(raw, runId);
    if (!reference || seen.has(reference.ref)) continue;
    seen.add(reference.ref);
    references.push(reference);
  }
  return references;
}

function objectReferenceFromInlineToken(raw: string, runId?: string): ObjectReference | undefined {
  if (/^https?:\/\//i.test(raw)) {
    return {
      id: inlineObjectReferenceId('url', raw),
      title: inlineReferenceTitle(raw),
      kind: 'url',
      ref: `url:${raw}`,
      runId,
      actions: ['focus-right-pane', 'open-external', 'copy-path'],
      status: 'external',
      summary: raw,
      provenance: { dataRef: raw },
    };
  }
  const tokenMatch = raw.match(/^([a-z-]+)::?(.+)$/i);
  if (!tokenMatch) return undefined;
  const prefix = tokenMatch[1].toLowerCase() as ObjectReferenceKind;
  if (!['artifact', 'file', 'folder', 'run', 'execution-unit', 'scenario-package'].includes(prefix)) return undefined;
  const target = tokenMatch[2];
  return {
    id: inlineObjectReferenceId(prefix, raw),
    title: inlineReferenceTitle(target),
    kind: prefix,
    ref: raw,
    runId,
    actions: inlineObjectReferenceActions(prefix),
    status: 'available',
    summary: target,
    provenance: prefix === 'file' || prefix === 'folder' ? { path: target } : { dataRef: target },
  };
}

function inlineObjectReferenceActions(kind: ObjectReferenceKind): ObjectAction[] {
  if (kind === 'file' || kind === 'folder') return ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'];
  if (kind === 'url') return ['focus-right-pane', 'open-external', 'copy-path'];
  return ['focus-right-pane', 'inspect', 'copy-path', 'pin'];
}

function inlineObjectReferenceId(kind: ObjectReferenceKind, ref: string) {
  return `inline-${kind}-${ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;
}

function inlineReferenceTitle(ref: string) {
  try {
    const value = decodeURIComponent(ref.replace(/^url:/i, ''));
    const trimmed = value.replace(/[?#].*$/, '').replace(/\/$/, '');
    return trimmed.split('/').pop() || value;
  } catch {
    return ref;
  }
}

function unmentionedObjectReferencesForMessage(message: SciForgeMessage, session: SciForgeSession, runId?: string) {
  const mentioned = new Set(linkifyObjectReferences(message.content, inlineObjectReferencesForMessage(message, session, runId))
    .flatMap((piece) => piece.reference ? [piece.reference.ref] : []));
  return inlineObjectReferencesForMessage(message, session, runId).filter((reference) => !mentioned.has(reference.ref));
}

function linkifyObjectReferences(content: string, references: ObjectReference[]) {
  if (!content || !references.length) return [{ text: content }];
  const candidates = objectReferenceLinkCandidates(references);
  if (!candidates.length) return [{ text: content }];
  const pieces: Array<{ text: string; reference?: ObjectReference }> = [];
  let cursor = 0;
  while (cursor < content.length) {
    const match = nextObjectReferenceMatch(content, cursor, candidates);
    if (!match) {
      pieces.push({ text: content.slice(cursor) });
      break;
    }
    if (match.index > cursor) pieces.push({ text: content.slice(cursor, match.index) });
    pieces.push({ text: content.slice(match.index, match.index + match.key.length), reference: match.reference });
    cursor = match.index + match.key.length;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

function nextObjectReferenceMatch(
  content: string,
  cursor: number,
  candidates: Array<{ key: string; reference: ObjectReference }>,
) {
  let best: { index: number; key: string; reference: ObjectReference } | undefined;
  for (const candidate of candidates) {
    const index = content.indexOf(candidate.key, cursor);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && candidate.key.length > best.key.length)) {
      best = { index, key: candidate.key, reference: candidate.reference };
    }
  }
  return best;
}

function objectReferenceLinkCandidates(references: ObjectReference[]) {
  const candidates: Array<{ key: string; reference: ObjectReference }> = [];
  const seen = new Set<string>();
  for (const reference of references) {
    for (const key of objectReferenceLinkKeys(reference)) {
      const trimmed = key.trim();
      if (trimmed.length < 4 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      candidates.push({ key: trimmed, reference });
    }
  }
  return candidates.sort((left, right) => right.key.length - left.key.length);
}

function objectReferenceLinkKeys(reference: ObjectReference) {
  const keys = [
    reference.ref,
    reference.ref.replace(/^file:/i, 'file::'),
    reference.ref.replace(/^folder:/i, 'folder::'),
    reference.ref.replace(/^artifact:/i, ''),
    reference.title,
    reference.provenance?.path,
    reference.provenance?.dataRef,
    reference.provenance?.path ? `file:${reference.provenance.path}` : undefined,
    reference.provenance?.path ? `file::${reference.provenance.path}` : undefined,
    reference.provenance?.dataRef ? `file:${reference.provenance.dataRef}` : undefined,
    reference.provenance?.dataRef ? `file::${reference.provenance.dataRef}` : undefined,
  ];
  return keys.filter((key): key is string => Boolean(key && key.trim()));
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
  const [expanded, setExpanded] = useState(false);
  const chipModel = objectReferenceChipModel(references, expanded);
  return (
    <div className="object-reference-strip" aria-label="回答中引用的对象">
      {chipModel.visible.map((reference) => (
        <button
          type="button"
          key={reference.id}
          className={cx('object-reference-chip', activeRunId && reference.runId === activeRunId && 'active')}
          onClick={() => onFocus(reference)}
          title={reference.summary || reference.ref}
          data-tooltip={`${objectReferenceKindLabel(reference.kind)} · ${reference.ref}`}
          data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}
        >
          <span>{objectReferenceIcon(reference.kind)}</span>
          <strong>{reference.title}</strong>
          {chipModel.pending.some((item) => item.id === reference.id) ? <Badge variant="warning">点击验证</Badge> : null}
          {reference.status && reference.status !== 'available' ? <Badge variant={reference.status === 'blocked' ? 'danger' : 'warning'}>{reference.status}</Badge> : null}
        </button>
      ))}
      {chipModel.hasOverflow ? (
        <button
          type="button"
          className="object-reference-more"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          title={expanded ? '收起对象列表' : `展开剩余 ${chipModel.hiddenCount} 个对象`}
        >
          {expanded ? '收起对象' : `+${chipModel.hiddenCount} objects`}
        </button>
      ) : null}
    </div>
  );
}

function RunExecutionProcess({
  runId,
  session,
  trace,
  onObjectFocus,
}: {
  runId: string;
  session: SciForgeSession;
  trace?: string;
  onObjectFocus: (reference: ObjectReference) => void;
}) {
  const run = session.runs.find((item) => item.id === runId);
  const units = executionUnitsForRun(run, session).slice(-8);
  if (!run && !units.length && !trace) return null;
  const auditObjectReferences = objectReferencesForAudit(run, session, runId);
  const lines = executionProcessLines(run, units, auditObjectReferences, trace);
  if (!lines.length) return null;
  const content = lines.join('\n');
  const references = mergeObjectReferences(
    objectReferencesFromInlineTokens(content, runId),
    auditObjectReferences,
    40,
  );
  const summary = executionProcessSummary(units);
  return (
    <details className="message-fold depth-2 execution-process-fold">
      <summary>执行审计 · {summary}</summary>
      <div className="execution-process-body">
        <MessageContent
          content={content}
          references={references}
          onObjectFocus={onObjectFocus}
        />
      </div>
    </details>
  );
}

function executionUnitsForRun(run: SciForgeRun | undefined, session: SciForgeSession) {
  if (!run) return [];
  const artifactRefs = new Set((run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/i, '')));
  const packageKey = run.scenarioPackageRef ? `${run.scenarioPackageRef.id}@${run.scenarioPackageRef.version}` : '';
  const matched = session.executionUnits.filter((unit) => {
    const unitPackageKey = unit.scenarioPackageRef ? `${unit.scenarioPackageRef.id}@${unit.scenarioPackageRef.version}` : '';
    if (packageKey && unitPackageKey === packageKey) return true;
    if (unit.outputArtifacts?.some((artifactId) => artifactRefs.has(artifactId))) return true;
    if (unit.artifacts?.some((artifactId) => artifactRefs.has(artifactId))) return true;
    return false;
  });
  return matched.length ? matched : session.executionUnits.filter((unit) => unit.status !== 'planned').slice(-6);
}

function objectReferencesForAudit(run: SciForgeRun | undefined, session: SciForgeSession, runId: string) {
  if (!run) return [];
  const runArtifactRefs = new Set((run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref.replace(/^artifact:/i, '')));
  const runArtifacts = session.artifacts
    .filter((artifact) => runArtifactRefs.has(artifact.id) || artifact.metadata?.runId === runId)
    .map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  return mergeObjectReferences(run.objectReferences ?? [], runArtifacts, 40);
}

function executionProcessLines(
  run: SciForgeRun | undefined,
  units: RuntimeExecutionUnit[],
  objectReferences: ObjectReference[],
  trace?: string,
) {
  const lines: string[] = [];
  if (run?.prompt) lines.push(`1. 接收任务：${compactAuditText(run.prompt, 160)}`);
  units.forEach((unit) => {
    const step = lines.length + 1;
    const verb = executionUnitVerb(unit);
    const target = executionUnitTarget(unit);
    lines.push(`${step}. ${verb}：${unit.tool}${target ? `，${target}` : ''}。状态：${unit.status}${unit.time ? `，时间：${unit.time}` : ''}。`);
    for (const detail of executionUnitDetails(unit)) lines.push(`   - ${detail}`);
  });
  for (const line of producedObjectLines(objectReferences)) lines.push(`${lines.length + 1}. ${line}`);
  if (trace) lines.push(`${lines.length + 1}. Agent 思考与完整 trace：${compactAuditText(trace, 900)}`);
  if (run?.response) lines.push(`${lines.length + 1}. 形成最终总结：${compactAuditText(run.response, 220)}`);
  return lines.slice(0, 36);
}

function producedObjectLines(references: ObjectReference[]) {
  return references
    .filter((reference) => reference.kind === 'artifact' || reference.kind === 'file' || reference.kind === 'folder')
    .slice(0, 8)
    .map((reference) => `产生/引用对象：${reference.title}（${reference.ref}）${reference.summary ? `，${compactAuditText(reference.summary, 120)}` : ''}`);
}

function executionProcessSummary(units: RuntimeExecutionUnit[]) {
  const counts = units.reduce((memo, unit) => {
    const verb = executionUnitVerb(unit);
    if (verb === '运行程序') memo.program += 1;
    else if (verb === '探索文件') memo.explore += 1;
    else if (verb === '编辑文件') memo.edit += 1;
    else memo.other += 1;
    return memo;
  }, { program: 0, explore: 0, edit: 0, other: 0 });
  const parts = [
    counts.program ? `运行 ${counts.program}` : '',
    counts.explore ? `探索 ${counts.explore}` : '',
    counts.edit ? `编辑 ${counts.edit}` : '',
    counts.other ? `其他 ${counts.other}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '无执行单元';
}

function executionUnitVerb(unit: RuntimeExecutionUnit) {
  const text = `${unit.tool} ${unit.entrypoint || ''} ${unit.params || ''} ${unit.codeRef || ''} ${unit.diffRef || ''}`.toLowerCase();
  if (/edit|write|patch|apply|diff|save|mutate|create|生成|编辑|写入|修改/.test(text)) return '编辑文件';
  if (/read|cat|sed|rg|grep|ls|find|open|inspect|explore|读取|检索|查看|探索/.test(text)) return '探索文件';
  if (/python|node|npm|pnpm|yarn|tsx|pytest|vitest|test|build|run|exec|运行|执行/.test(text)) return '运行程序';
  return '执行步骤';
}

function executionUnitTarget(unit: RuntimeExecutionUnit) {
  const refs = [
    formatExecutionRef(unit.entrypoint),
    formatExecutionRef(unit.codeRef),
    formatExecutionRef(unit.diffRef),
    formatExecutionRef(unit.outputRef),
    formatExecutionRef(unit.stdoutRef),
    formatExecutionRef(unit.stderrRef),
    ...(unit.inputData ?? []).map(formatExecutionRef),
    ...(unit.outputArtifacts ?? []).map((artifactId) => `artifact:${artifactId}`),
  ].filter(Boolean).slice(0, 4);
  return refs.length ? `涉及 ${refs.join('、')}` : '';
}

function executionUnitDetails(unit: RuntimeExecutionUnit) {
  const details = [
    unit.params ? `参数：${compactAuditText(unit.params, 180)}` : '',
    unit.codeRef ? `代码位置：${formatExecutionRef(unit.codeRef)}` : '',
    unit.code ? `执行代码：${compactAuditText(unit.code, 220)}` : '',
    unit.diffRef ? `编辑 diff：${formatExecutionRef(unit.diffRef)}` : '',
    unit.stdoutRef ? `标准输出：${formatExecutionRef(unit.stdoutRef)}` : '',
    unit.stderrRef ? `错误输出：${formatExecutionRef(unit.stderrRef)}` : '',
    unit.outputRef ? `输出：${formatExecutionRef(unit.outputRef)}` : '',
    unit.patchSummary ? `修改摘要：${unit.patchSummary}` : '',
    unit.failureReason ? `失败原因：${unit.failureReason}` : '',
  ];
  return details.filter(Boolean).slice(0, 5);
}

function formatExecutionRef(value?: string) {
  if (!value) return '';
  if (/^(artifact|file|folder|run|execution-unit|scenario-package)::?/i.test(value) || /^https?:\/\//i.test(value)) return value;
  if (/^\.?\/?[\w.-/]+(?:\.[a-z0-9]+)(?:[#?].*)?$/i.test(value)) return `file::${value.replace(/^\.\//, '')}`;
  return value;
}

function compactAuditText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function RunKeyInfo({
  runId,
  session,
  onObjectFocus,
}: {
  runId: string;
  session: SciForgeSession;
  onObjectFocus?: (reference: ObjectReference) => void;
}) {
  const run = session.runs.find((item) => item.id === runId);
  const objectRefs = run?.objectReferences ?? [];
  const artifactRefIds = new Set(objectRefs.filter((ref) => ref.kind === 'artifact').map((ref) => ref.ref.replace(/^artifact:/, '')));
  const artifacts = session.artifacts
    .filter((artifact) => artifactRefIds.has(artifact.id) || artifact.metadata?.runId === runId)
    .slice(0, 4);
  const artifactReferences = artifacts.map((artifact) => objectReferenceForArtifactSummary(artifact, runId));
  const claims = session.claims.slice(0, 3);
  if (!artifacts.length && !claims.length) return null;
  const objectNames = artifacts.map(artifactTitle).join('、') || '暂无新对象';
  return (
    <div className="message-key-info" aria-label="本轮关键信息">
      <div className="message-key-info-head">
        <strong>关键信息</strong>
        <span>{artifacts.length} objects · {claims.length} claims</span>
      </div>
      <MessageContent
        content={`本轮回答保留了 ${artifacts.length} 个关键对象和 ${claims.length} 条关键判断。关键对象包括 ${objectNames}；对象名可直接点击，在右侧预览。执行代码、程序、探索文件、编辑文件、trace 和输出对象统一收进下方“执行审计”。`}
        references={artifactReferences}
        onObjectFocus={onObjectFocus ?? (() => undefined)}
      />
      {claims.length ? (
        <div className="message-key-list">
          {claims.map((claim) => (
            <p key={claim.id} className="message-key-row">
              <span>判断：{claim.text}</span>
              <small>{claim.evidenceLevel} · confidence {Math.round(claim.confidence * 100)}%</small>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function artifactTitle(artifact: RuntimeArtifact) {
  return String(artifact.metadata?.title || artifact.metadata?.name || artifact.id);
}

function TurnAcceptanceNotice({
  acceptance,
}: {
  acceptance: NonNullable<SciForgeMessage['acceptance']>;
}) {
  const diagnostic = turnAcceptanceDiagnostic(acceptance);
  return (
    <div className="turn-acceptance-notice">
      <Badge variant={acceptance.severity === 'repairable' ? 'warning' : 'danger'}>{acceptance.severity}</Badge>
      <div className="turn-acceptance-copy">
        <strong>{diagnostic.title}</strong>
        <span>{diagnostic.summary}</span>
        {diagnostic.recoverActions.length ? (
          <ul>
            {diagnostic.recoverActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        ) : null}
        {diagnostic.secondary.length ? (
          <div className="turn-acceptance-secondary">
            {diagnostic.secondary.map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
        <details className="turn-acceptance-raw">
          <summary>查看原始诊断</summary>
          <pre>{diagnostic.rawDetails}</pre>
        </details>
      </div>
    </div>
  );
}

function turnAcceptanceDiagnostic(acceptance: NonNullable<SciForgeMessage['acceptance']>) {
  const rawDetails = acceptance.failures
    .map((failure) => `${failure.code}: ${failure.detail}`)
    .join('\n\n');
  const haystack = rawDetails.toLowerCase();
  const secondary = acceptance.failures
    .filter((failure) => !/execution-failed|backend-repair-failed/i.test(failure.code))
    .map((failure) => readableAcceptanceFailure(failure.code));
  if (/http-429|429|rate-limit|too-many-failed-attempts|exceeded retry|retry-budget/.test(haystack)) {
    return {
      title: '后端模型限流，自动修复未完成',
      summary: 'AgentServer 调用模型时触发 HTTP 429 / too-many-failed-attempts，SciForge 已做过一次 compact/slim retry；重试预算耗尽后停止，避免继续刷失败请求。',
      recoverActions: [
        '等待 provider 配额或 retry budget 恢复后重试同一问题。',
        '切换到可用 quota 的 backend/model，再重试后续修复。',
        '后续追问尽量引用已有 report/paper-list artifact，避免重新发送大段全文上下文。',
      ],
      secondary,
      rawDetails,
    };
  }
  if (/cancel|已取消|abort|timeout|超时/.test(haystack)) {
    return {
      title: '后端修复请求被中断',
      summary: '本次 acceptance repair 没有完成，通常是用户中断、请求超时，或外层运行已经结束导致后台 stream 被取消。',
      recoverActions: ['确认 Runtime Health 为 ready 后重新发送同一修复请求。'],
      secondary,
      rawDetails,
    };
  }
  if (/missing-object-references|clickable object references|引用/.test(haystack)) {
    return {
      title: '结果缺少可点击引用',
      summary: '回答里提到了路径或 artifact，但没有被规范化成 SciForge 可点击 object reference。',
      recoverActions: ['要求后端基于已有 artifact 重新返回 objectReferences，不需要重新检索全文。'],
      secondary,
      rawDetails,
    };
  }
  return {
    title: '任务未通过验收',
    summary: acceptance.failures.map((failure) => failure.detail).join('；'),
    recoverActions: [],
    secondary,
    rawDetails,
  };
}

function readableAcceptanceFailure(code: string) {
  if (code === 'missing-object-references') return '缺少可点击对象引用';
  if (code === 'missing-explicit-references') return '显式引用未保留';
  if (code === 'unused-explicit-references') return '引用未体现在结果中';
  if (code === 'empty-final-response') return '最终回答为空';
  if (code === 'raw-payload-leak') return '暴露了原始 payload';
  return code;
}

function SciForgeReferenceChips({
  references,
  onRemove,
  onFocus,
}: {
  references: SciForgeReference[];
  onRemove?: (referenceId: string) => void;
  onFocus?: (reference: SciForgeReference) => void;
}) {
  return (
    <div className="sciforge-reference-strip" aria-label="用户引用的上下文">
      {references.slice(0, 8).map((reference) => (
        <span
          role="button"
          tabIndex={0}
          key={reference.id}
          className={cx('sciforge-reference-chip', `kind-${reference.kind}`)}
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

function latestTokenUsage(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.usage)?.usage;
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

function SessionHistoryPanel({
  currentSession,
  archivedSessions,
  onRestore,
  onDelete,
  onClear,
}: {
  currentSession: SciForgeSession;
  archivedSessions: SciForgeSession[];
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

function sessionHistoryStats(session: SciForgeSession) {
  const userMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return `${userMessages} messages · ${session.artifacts.length} artifacts · ${session.executionUnits.length} units`;
}

function sessionHistoryPackageLabel(session: SciForgeSession) {
  const lastRun = session.runs.at(-1);
  const ref = lastRun?.scenarioPackageRef;
  if (!ref) return undefined;
  return `${ref.id}@${ref.version}`;
}

function sessionHistoryLastRunLabel(session: SciForgeSession) {
  const lastRun = session.runs.at(-1);
  if (!lastRun) return undefined;
  return `last run ${lastRun.status}`;
}

function sessionHistoryLastRunVariant(session: SciForgeSession): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
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
