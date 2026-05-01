import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, CircleStop, Clock, Copy, Download, MessageSquare, Plus, Quote, Sparkles, Trash2, X } from 'lucide-react';
import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { sendAgentMessageStream } from '../api/agentClient';
import { sendBioAgentToolMessage } from '../api/bioagentToolsClient';
import { builtInScenarioPackageRef } from '../scenarioCompiler/scenarioPackage';
import { resetSession } from '../sessionStore';
import { acceptAndRepairAgentResponse, buildUserGoalSnapshot } from '../turnAcceptance';
import { makeId, nowIso, type AgentStreamEvent, type BioAgentConfig, type BioAgentMessage, type BioAgentReference, type BioAgentRun, type BioAgentSession, type NormalizedAgentResponse, type ObjectReference, type RuntimeExecutionUnit, type ScenarioInstanceId, type ScenarioRuntimeOverride, type TimelineEventRecord } from '../domain';
import { exportJsonFile } from './exportUtils';
import { ActionButton, Badge, ClaimTag, ConfidenceBar, EvidenceTag, IconButton, cx } from './uiPrimitives';

interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioId;
  prompt: string;
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
}) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(88);
  const [streamEventsExpanded, setStreamEventsExpanded] = useState(true);
  const [streamEventsHeight, setStreamEventsHeight] = useState(260);
  const [streamEvents, setStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [guidanceQueue, setGuidanceQueue] = useState<string[]>([]);
  const [referencePickMode, setReferencePickMode] = useState(false);
  const [pendingReferences, setPendingReferences] = useState<BioAgentReference[]>([]);
  const activeSessionRef = useRef(session);
  const guidanceQueueRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    activeSessionRef.current = session;
  }, [session]);

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
      addPendingReference(target.reference);
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
    if (!autoRunRequest || autoRunRequest.targetScenario !== scenarioId || isSending) return;
    onAutoRunConsumed(autoRunRequest.id);
    window.setTimeout(() => {
      void runPrompt(autoRunRequest.prompt, activeSessionRef.current);
    }, 120);
  }, [scenarioId, autoRunRequest, isSending, onAutoRunConsumed]);

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
    await runPrompt(prompt, session, pendingReferences);
  }

  function addPendingReference(reference: BioAgentReference) {
    setPendingReferences((current) => {
      if (current.some((item) => item.id === reference.id)) return current;
      return [...current, reference].slice(0, 8);
    });
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
    try {
      let latestRoundTokenUsage: AgentStreamEvent['usage'];
      const handleStreamEvent = (event: AgentStreamEvent) => {
        if (event.usage) latestRoundTokenUsage = event.usage;
        setStreamEvents((current) => coalesceStreamEvents(current, event).slice(-32));
      };
      const request = {
        sessionId: optimisticSession.sessionId,
        scenarioId,
        agentName: scenario.name,
        agentDomain: scenario.domain,
        prompt,
        references,
        roleView: role,
        messages: optimisticSession.messages,
        artifacts: optimisticSession.artifacts,
        executionUnits: optimisticSession.executionUnits,
        runs: optimisticSession.runs,
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
      const acceptedResponse = acceptAndRepairAgentResponse({
        snapshot: goalSnapshot,
        response: responseWithReferences,
        session: activeSessionRef.current,
      });
      const mergedSession = mergeAgentResponse(activeSessionRef.current, acceptedResponse);
      onSessionChange(mergedSession);
      activeSessionRef.current = mergedSession;
      onActiveRunChange(acceptedResponse.run.id);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const wasInterrupted = controller.signal.aborted || /cancel|abort|已取消|cancelled|canceled/i.test(rawMessage);
      const message = wasInterrupted ? '用户已中断当前 backend 运行。' : rawMessage;
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
    setGuidanceQueue((current) => [...current, prompt]);
    setStreamEvents((current) => [...current.slice(-32), {
      id: makeId('evt'),
      type: 'guidance-queued',
      label: '引导已排队',
      detail: prompt,
      createdAt: now,
    }]);
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
                {message.tokenUsage ? (
                  <span className="message-token-usage" title="本轮 AgentServer token usage">
                    {formatAgentTokenUsage(message.tokenUsage)}
                  </span>
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
              {message.status === 'failed' ? (
                <FailureRecoveryCard
                  message={message.content}
                  onOpenSettings={() => setErrorText('请打开右上角设置，检查 AgentServer / Workspace Writer / Model Backend 连接。')}
                  onRetry={() => {
                    const lastPrompt = [...messages].reverse().find((item) => item.role === 'user')?.content;
                    if (lastPrompt) void runPrompt(lastPrompt, activeSessionRef.current);
                  }}
                  onUseSeedSkill={() => setErrorText(`当前可先使用 workspace/evolved capability：${skillPlanRef}。如果任务需要通用生成，请启动 AgentServer。`)}
                  onExportDiagnostics={() => exportJsonFile(`${scenarioId}-${session.sessionId}-diagnostics.json`, buildSessionDiagnostics(session, message.content, {
                    scenarioPackageRef,
                    skillPlanRef,
                    uiPlanRef,
                  }))}
                />
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
                {liveTokenUsage ? (
                  <span className="message-token-usage" title="当前运行 token usage">
                    {formatAgentTokenUsage(liveTokenUsage)}
                  </span>
                ) : null}
              </div>
              <p>{latestRunningEvent(streamEvents) || '正在规划、生成或执行 workspace task...'}</p>
            </div>
          </div>
        ) : null}
      </div>

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
            <span>Agent Backend 运行观察</span>
            <div className="stream-events-actions">
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
          {streamEventsExpanded ? (
            <div className="stream-events-list">
              {streamEvents.slice(-24).map((event) => {
                const readableDetail = readableStreamEventDetail(event);
                const usageDetail = formatAgentTokenUsage(event.usage);
                return (
                  <div className={cx('stream-event', streamEventUiClass(event.type))} key={event.id}>
                    <Badge variant={streamEventBadge(event.type)}>{event.label}</Badge>
                    <span className="stream-event-type">{streamEventTypeLabel(event.type)}</span>
                    {usageDetail ? <span className="stream-event-usage">{usageDetail}</span> : null}
                    {readableDetail ? <span className="stream-event-detail">{readableDetail}</span> : null}
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(event.raw ?? { type: event.type, label: event.label, detail: event.detail }, null, 2))}>复制 raw</button>
                  </div>
                );
              })}
            </div>
          ) : null}
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
            title="像浏览器检查元素一样，点击页面上的目标自动引用"
          >
            <Quote size={14} />
            点选
          </button>
          {pendingReferences.length ? (
            <BioAgentReferenceChips
              references={pendingReferences}
              onRemove={(referenceId) => setPendingReferences((current) => current.filter((reference) => reference.id !== referenceId))}
            />
          ) : (
            <span className="reference-hint">点选 BioAgent 可见对象作为上下文</span>
          )}
        </div>
        {referencePickMode ? (
          <div className="reference-pick-banner">
            <Quote size={14} />
            点击页面上的对象来引用，Esc 取消
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
        {isSending ? (
          <ActionButton icon={CircleStop} variant="coral" onClick={handleAbort}>
            中断
          </ActionButton>
        ) : null}
        <ActionButton icon={Sparkles} onClick={handleSend} disabled={!input.trim() && !pendingReferences.length} >
          {isSending ? '引导' : '发送'}
        </ActionButton>
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
  const visible = references.slice(0, 8);
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
          {reference.status && reference.status !== 'available' ? <Badge variant={reference.status === 'blocked' ? 'danger' : 'warning'}>{reference.status}</Badge> : null}
        </button>
      ))}
      {hidden ? <Badge variant="muted">+{hidden} objects</Badge> : null}
    </div>
  );
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
}: {
  references: BioAgentReference[];
  onRemove?: (referenceId: string) => void;
}) {
  return (
    <div className="bioagent-reference-strip" aria-label="用户引用的上下文">
      {references.slice(0, 8).map((reference) => (
        <span
          key={reference.id}
          className={cx('bioagent-reference-chip', `kind-${reference.kind}`)}
          title={reference.summary || reference.ref}
        >
          <span>{bioAgentReferenceKindLabel(reference.kind)}</span>
          <strong>{reference.title}</strong>
          {onRemove ? (
            <button type="button" onClick={() => onRemove(reference.id)} aria-label={`移除引用 ${reference.title}`}>
              <X size={12} />
            </button>
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

function latestRunningEvent(events: AgentStreamEvent[]) {
  const latest = [...events].reverse().find((event) => readableStreamEventDetail(event));
  return latest ? readableStreamEventDetail(latest) : undefined;
}

function latestTokenUsage(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.usage)?.usage;
}

function formatAgentTokenUsage(usage: AgentStreamEvent['usage'] | undefined) {
  if (!usage) return '';
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

function coalesceStreamEvents(events: AgentStreamEvent[], next: AgentStreamEvent) {
  if (next.type !== 'text-delta') return [...events, next];
  const detail = normalizeStreamTextDelta(next.detail).trim();
  if (!detail) return events;
  const last = events.at(-1);
  if (!last || last.type !== 'text-delta') return [...events, { ...next, detail }];
  const mergedDetail = mergeTextDeltaDetail(last.detail || '', detail);
  return [
    ...events.slice(0, -1),
    {
      ...next,
      id: last.id,
      label: last.label || next.label,
      detail: mergedDetail.length > 1200 ? `${mergedDetail.slice(-1200).replace(/^\S+\s+/, '')}` : mergedDetail,
      raw: {
        type: 'text-delta',
        coalesced: true,
        latest: next.raw ?? { detail },
      },
    },
  ];
}

function mergeTextDeltaDetail(previous: string, next: string) {
  if (!previous.trim()) return next;
  if (!next.trim()) return previous;
  if (/^[,.;:!?，。；：！？)\]}]/.test(next)) return tidyReadableText(`${previous}${next}`);
  if (/[(\[{]$/.test(previous)) return `${previous}${next}`;
  return tidyReadableText(`${previous} ${next}`);
}

function streamEventTypeLabel(type: string) {
  if (type === 'text-delta') return '生成内容';
  if (type === 'tool-call') return '工具调用';
  if (type === 'tool-result') return '工具结果';
  if (type === 'run-plan') return '执行计划';
  if (type === 'stage-start') return '阶段开始';
  return type;
}

function readableStreamEventDetail(event: AgentStreamEvent) {
  if (!event.detail) return '';
  const detail = event.type === 'text-delta'
    ? normalizeStreamTextDelta(event.detail)
    : tidyReadableText(event.detail);
  const usageDetail = formatAgentTokenUsage(event.usage);
  return usageDetail ? detail.replace(` | ${usageDetail}`, '').replace(usageDetail, '').trim() : detail;
}

function normalizeStreamTextDelta(value?: string) {
  if (!value) return '';
  const extracted = extractProtocolText(value);
  return tidyReadableText(extracted || value);
}

function extractProtocolText(value: string) {
  const parts: string[] = [];
  const textFieldPattern = /"text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of value.matchAll(textFieldPattern)) {
    try {
      parts.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      parts.push(match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
    }
  }
  if (!parts.length) return '';
  const protocolFragments = value.match(/"protocolVersion"\s*:\s*"v\d+"/g)?.length ?? 0;
  return protocolFragments || parts.length > 1 ? parts.join('') : '';
}

function tidyReadableText(value: string) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/([A-Za-z0-9\u4e00-\u9fff])\n(?=[A-Za-z0-9\u4e00-\u9fff])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function streamEventBadge(type: string): 'info' | 'warning' | 'danger' | 'success' | 'muted' {
  if (type.includes('error') || type.includes('failed')) return 'danger';
  if (type.includes('silent') || type.includes('guidance') || type.includes('permission')) return 'warning';
  if (type.includes('result') || type.includes('completed') || type.includes('done')) return 'success';
  if (type.includes('text-delta')) return 'muted';
  return 'info';
}

function streamEventUiClass(type: string) {
  if (type === 'tool-call' || type === 'tool-result') return 'tool';
  if (type === 'text-delta') return 'thinking';
  if (type === 'run-plan' || type === 'stage-start') return 'plan';
  if (type.includes('error') || type.includes('failed')) return 'error';
  return '';
}

function FailureRecoveryCard({
  message,
  onRetry,
  onOpenSettings,
  onUseSeedSkill,
  onExportDiagnostics,
}: {
  message: string;
  onRetry: () => void;
  onOpenSettings: () => void;
  onUseSeedSkill: () => void;
  onExportDiagnostics: () => void;
}) {
  const actions = recoveryActionsForMessage(message);
  return (
    <div className="failure-recovery-card">
      <strong>可以这样恢复</strong>
      <div>
        {actions.map((action) => <span key={action}>{action}</span>)}
      </div>
      <div className="scenario-builder-actions">
        <button onClick={onRetry}>重试上一条请求</button>
        <button onClick={onUseSeedSkill}>改用 workspace capability</button>
        <button onClick={onOpenSettings}>检查设置</button>
        <button onClick={onExportDiagnostics}>导出诊断包</button>
      </div>
    </div>
  );
}

function buildSessionDiagnostics(
  session: BioAgentSession,
  message: string,
  refs: {
    scenarioPackageRef?: RuntimeExecutionUnit['scenarioPackageRef'];
    skillPlanRef: string;
    uiPlanRef: string;
  },
) {
  return {
    schemaVersion: '1',
    generatedAt: nowIso(),
    reason: message,
    scenarioId: session.scenarioId,
    sessionId: session.sessionId,
    packageRef: refs.scenarioPackageRef,
    skillPlanRef: refs.skillPlanRef,
    uiPlanRef: refs.uiPlanRef,
    recentMessages: session.messages.slice(-8),
    recentRuns: session.runs.slice(-8),
    executionUnits: session.executionUnits.slice(0, 12),
    artifacts: session.artifacts.slice(0, 12).map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      schemaVersion: artifact.schemaVersion,
      dataRef: artifact.dataRef,
      metadata: artifact.metadata,
    })),
  };
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

function recoveryActionsForMessage(message: string) {
  if (/AgentServer|18080|stream|fetch/i.test(message)) {
    return [
      '启动或修复 AgentServer 后重试。',
      '如果当前任务已有 workspace/evolved skill，BioAgent 会优先走 workspace runtime。',
      '仍失败时导出诊断包，保留 package/version 和 execution logs。',
    ];
  }
  if (/workspace|writer|5174|scenarios|save/i.test(message)) {
    return [
      '启动 workspace writer 或检查 Workspace Writer URL。',
      '确认 workspace path 可写。',
      '刷新 Scenario Library 后重试。',
    ];
  }
  return [
    '查看 Runtime Health 判断是连接、输入还是 contract 问题。',
    '检查当前 package 的 validation / quality gate。',
    '保留失败 run，作为 repair 或 reusable task 候选。',
  ];
}

function SessionHistoryPanel({
  currentSession,
  archivedSessions,
  onRestore,
}: {
  currentSession: BioAgentSession;
  archivedSessions: BioAgentSession[];
  onRestore: (sessionId: string) => void;
}) {
  const currentStats = sessionHistoryStats(currentSession);
  return (
    <div className="session-history-panel">
      <div className="session-history-head">
        <div>
          <strong>历史会话</strong>
          <span>当前：{currentSession.title}</span>
        </div>
        <Badge variant="muted">{currentStats}</Badge>
      </div>
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
