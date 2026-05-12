import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { compileScenarioIRFromSelection } from '@sciforge/scenario-core/scenario-element-compiler';
import { builtInScenarioIdForRuntimeInput, scenarioRuntimeOverrideForBuiltInScenario } from '@sciforge/scenario-core/scenario-routing-policy';
import { scenarios, type ScenarioId } from '../../data';
import { nowIso, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type ScenarioInstanceId, type ScenarioRuntimeOverride, type SciForgeConfig, type SciForgeReference, type SciForgeSession, type TimelineEventRecord } from '../../domain';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import { ChatPanel } from '../ChatPanel';
import { ResultsRenderer } from '../ResultsRenderer';
import { recoverableRunFocusForSession } from '../appShell/workspaceState';
import type { HandoffAutoRunRequest } from '../results/viewPlanResolver';
import { defaultElementSelectionForScenario, ScenarioBuilderPanel } from '../ScenarioBuilderPanel';
import { useRuntimeHealth } from '../runtimeHealthPanel';
import { cx } from '../uiPrimitives';

export function Workbench({
  scenarioId,
  config,
  session,
  draft,
  savedScrollTop,
  onDraftChange,
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
  onArtifactHandoff,
  autoRunRequest,
  onAutoRunConsumed,
  scenarioOverride,
  onScenarioOverrideChange,
  onConfigChange,
  onTimelineEvent,
  onMarkReusableRun,
  onPreviewPackageRequest,
  workspaceFileEditor,
  onWorkspaceFileEditorChange,
  externalReferenceRequest,
  onExternalReferenceConsumed,
  availableComponentIds,
  onAvailableComponentIdsChange,
}: {
  scenarioId: ScenarioInstanceId;
  config: SciForgeConfig;
  session: SciForgeSession;
  draft: string;
  savedScrollTop: number;
  onDraftChange: (scenarioId: ScenarioInstanceId, value: string) => void;
  onScrollTopChange: (scenarioId: ScenarioInstanceId, value: number) => void;
  onSessionChange: (session: SciForgeSession) => void;
  onNewChat: (scenarioId: ScenarioInstanceId) => void;
  onDeleteChat: (scenarioId: ScenarioInstanceId) => void;
  archivedSessions: SciForgeSession[];
  onRestoreArchivedSession: (scenarioId: ScenarioInstanceId, sessionId: string) => void;
  onDeleteArchivedSessions: (scenarioId: ScenarioInstanceId, sessionIds: string[]) => void;
  onClearArchivedSessions: (scenarioId: ScenarioInstanceId) => void;
  onEditMessage: (scenarioId: ScenarioInstanceId, messageId: string, content: string) => void;
  onDeleteMessage: (scenarioId: ScenarioInstanceId, messageId: string) => void;
  archivedCount: number;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  autoRunRequest?: HandoffAutoRunRequest;
  onAutoRunConsumed: (requestId: string) => void;
  scenarioOverride?: ScenarioRuntimeOverride;
  onScenarioOverrideChange: (scenarioId: ScenarioInstanceId, override: ScenarioRuntimeOverride) => void;
  onConfigChange: (patch: Partial<SciForgeConfig>) => void;
  onTimelineEvent: (event: TimelineEventRecord) => void;
  onMarkReusableRun: (scenarioId: ScenarioInstanceId, runId: string) => void;
  onPreviewPackageRequest: (scenarioId: ScenarioInstanceId, reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  workspaceFileEditor: { file: WorkspaceFileContent; draft: string } | null;
  onWorkspaceFileEditorChange: (next: { file: WorkspaceFileContent; draft: string } | null) => void;
  externalReferenceRequest?: { id: string; reference: SciForgeReference };
  onExternalReferenceConsumed: (requestId: string) => void;
  availableComponentIds: string[];
  onAvailableComponentIdsChange: (ids: string[]) => void;
}) {
  const baseScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride });
  const scenarioView = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
  const visionSenseToolId = 'local.vision-sense';
  const baseRuntimeScenario: ScenarioRuntimeOverride = scenarioOverride ?? scenarioRuntimeOverrideForBuiltInScenario(baseScenarioId);
  const [visionSenseDefaultDisabled, setVisionSenseDefaultDisabled] = useState(false);
  const runtimeScenario: ScenarioRuntimeOverride = {
    ...baseRuntimeScenario,
    selectedToolIds: visionSenseDefaultDisabled
      ? (baseRuntimeScenario.selectedToolIds ?? []).filter((id) => id !== visionSenseToolId)
      : Array.from(new Set([...(baseRuntimeScenario.selectedToolIds ?? []), visionSenseToolId])),
  };
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [workbenchChromeExpanded, setWorkbenchChromeExpanded] = useState(false);
  const [mobileWorkbenchLayout, setMobileWorkbenchLayout] = useState(false);
  const [mobilePane, setMobilePane] = useState<'builder' | 'chat' | 'results'>('chat');
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [focusedObjectReference, setFocusedObjectReference] = useState<ObjectReference | undefined>();
  const [chatColumnWidth, setChatColumnWidth] = useState(42);
  const workbenchResizeRef = useRef<{ startX: number; startWidth: number; gridWidth: number } | null>(null);
  const autoFocusedRunKeyRef = useRef<string | undefined>(undefined);
  const runtimeHealth = useRuntimeHealth(config);
  const visionSenseActive = (runtimeScenario.selectedToolIds ?? [visionSenseToolId]).includes(visionSenseToolId);
  const defaultResultSlots = useMemo(
    () => compileScenarioIRFromSelection(defaultElementSelectionForScenario(baseScenarioId, runtimeScenario)).uiPlan.slots,
    [baseScenarioId, runtimeScenario],
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const sync = () => setMobileWorkbenchLayout(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!mobileWorkbenchLayout || mobilePane !== 'builder') return;
    setWorkbenchChromeExpanded(true);
  }, [mobileWorkbenchLayout, mobilePane]);

  const showWorkbenchChromeBody = workbenchChromeExpanded;
  const recoveryFocus = recoverableRunFocusForSession(session);
  const recoveryRunKey = recoveryFocus ? `${recoveryFocus.sessionId}:${recoveryFocus.activeRunId}` : undefined;
  useEffect(() => {
    if (activeRunId && !session.runs.some((run) => run.id === activeRunId)) {
      setActiveRunId(undefined);
    }
  }, [activeRunId, session.runs]);

  useEffect(() => {
    if (!recoveryFocus || autoFocusedRunKeyRef.current === recoveryRunKey) return;
    autoFocusedRunKeyRef.current = recoveryRunKey;
    setActiveRunId((current) => current && session.runs.some((run) => run.id === current) ? current : recoveryFocus.activeRunId);
    setResultsCollapsed(false);
    setMobilePane('results');
  }, [recoveryFocus, recoveryRunKey, session.runs]);

  function handleActiveRunChange(runId: string | undefined) {
    setActiveRunId(runId);
  }

  const workspaceFilePathForLayout = workspaceFileEditor?.file.path;
  useEffect(() => {
    if (!workspaceFilePathForLayout) return;
    setResultsCollapsed(false);
    setMobilePane('results');
  }, [workspaceFilePathForLayout]);

  function handleObjectFocus(reference: ObjectReference) {
    setFocusedObjectReference(reference);
    if (reference.runId) setActiveRunId(reference.runId);
    setResultsCollapsed(false);
    setMobilePane('results');
  }

  function toggleVisionSense() {
    const currentToolIds = runtimeScenario.selectedToolIds ?? [];
    setVisionSenseDefaultDisabled(currentToolIds.includes(visionSenseToolId));
    const selectedToolIds = currentToolIds.includes(visionSenseToolId)
      ? currentToolIds.filter((id) => id !== visionSenseToolId)
      : [...currentToolIds, visionSenseToolId];
    onScenarioOverrideChange(scenarioId, {
      ...runtimeScenario,
      selectedToolIds,
    });
  }

  function beginWorkbenchResize(event: React.MouseEvent<HTMLDivElement>) {
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    event.preventDefault();
    workbenchResizeRef.current = {
      startX: event.clientX,
      startWidth: chatColumnWidth,
      gridWidth: grid.getBoundingClientRect().width,
    };
    const handleMove = (moveEvent: MouseEvent) => {
      const state = workbenchResizeRef.current;
      if (!state) return;
      const deltaPercent = ((moveEvent.clientX - state.startX) / state.gridWidth) * 100;
      setChatColumnWidth(Math.max(28, Math.min(72, state.startWidth + deltaPercent)));
    };
    const handleUp = () => {
      workbenchResizeRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }

  return (
    <main className="workbench workbench-canvas-shell codex-quiet-shell">
      <div className="workbench-chrome">
        <div className="workbench-chrome-toggle">
          <button
            type="button"
            className="workbench-chrome-toggle-main"
            onClick={() => setWorkbenchChromeExpanded((value) => !value)}
            aria-expanded={showWorkbenchChromeBody}
          >
            <div className="scenario-large-icon workbench-chrome-icon" style={{ color: scenarioView.color, background: `${scenarioView.color}18` }}>
              <scenarioView.icon size={22} />
            </div>
            <span className="workbench-chrome-title">{runtimeScenario.title}</span>
            {workbenchChromeExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          <div className="workbench-sense-actions" aria-label="感官插件">
            <button
              type="button"
              className={cx('sense-toggle', visionSenseActive && 'active')}
              aria-pressed={visionSenseActive}
              onClick={toggleVisionSense}
              title={visionSenseActive ? '取消 vision-sense 感官' : '激活 vision-sense 感官'}
            >
              <Eye size={14} />
              <span>vision-sense</span>
              <small>{visionSenseActive ? 'on' : 'off'}</small>
            </button>
          </div>
        </div>
        {showWorkbenchChromeBody ? (
          <div className="workbench-chrome-body">
            <ScenarioBuilderPanel
              scenarioId={baseScenarioId}
              scenario={runtimeScenario}
              config={config}
              runtimeHealth={runtimeHealth}
              expanded
              onToggle={() => {}}
              chromeEmbedded
              onChange={(override) => onScenarioOverrideChange(scenarioId, override)}
              agentRuntimeComponentIds={availableComponentIds}
              onAgentRuntimeComponentIdsChange={onAvailableComponentIdsChange}
            />
          </div>
        ) : null}
      </div>
      <div className="mobile-workbench-tabs" aria-label="移动端工作区视图">
        {[
          ['builder', 'Builder'],
          ['chat', 'Chat'],
          ['results', 'Results'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={cx(mobilePane === id && 'active')} onClick={() => setMobilePane(id as typeof mobilePane)}>
            {label}
          </button>
        ))}
      </div>
      <div
        className={cx('workbench-grid', 'workbench-canvas', resultsCollapsed && 'results-collapsed')}
        style={!resultsCollapsed && !mobileWorkbenchLayout ? { gridTemplateColumns: `minmax(280px, ${chatColumnWidth}%) 10px minmax(0, 1fr)` } : undefined}
      >
        <div className={cx('mobile-pane', mobilePane !== 'chat' && 'mobile-hidden')}>
          <ChatPanel
            scenarioId={scenarioId}
            role="biologist"
            config={config}
            session={session}
            input={draft}
            savedScrollTop={savedScrollTop}
            onInputChange={(value) => onDraftChange(scenarioId, value)}
            onScrollTopChange={(value) => onScrollTopChange(scenarioId, value)}
            onSessionChange={onSessionChange}
            onNewChat={() => onNewChat(scenarioId)}
            onDeleteChat={() => onDeleteChat(scenarioId)}
            archivedSessions={archivedSessions}
            onRestoreArchivedSession={(sessionId) => onRestoreArchivedSession(scenarioId, sessionId)}
            onDeleteArchivedSessions={(sessionIds) => onDeleteArchivedSessions(scenarioId, sessionIds)}
            onClearArchivedSessions={() => onClearArchivedSessions(scenarioId)}
            onEditMessage={(messageId, content) => onEditMessage(scenarioId, messageId, content)}
            onDeleteMessage={(messageId) => onDeleteMessage(scenarioId, messageId)}
            archivedCount={archivedCount}
            autoRunRequest={autoRunRequest}
            onAutoRunConsumed={onAutoRunConsumed}
            scenarioOverride={runtimeScenario}
            onConfigChange={onConfigChange}
            onTimelineEvent={onTimelineEvent}
            activeRunId={activeRunId}
            onActiveRunChange={handleActiveRunChange}
            onMarkReusableRun={(runId) => onMarkReusableRun(scenarioId, runId)}
            onObjectFocus={handleObjectFocus}
            externalReferenceRequest={externalReferenceRequest}
            onExternalReferenceConsumed={onExternalReferenceConsumed}
            availableComponentIds={availableComponentIds}
          />
        </div>
        {!resultsCollapsed ? (
          <div
            className="workbench-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整聊天区和结果区宽度"
            onMouseDown={beginWorkbenchResize}
            title="拖拽调整聊天区和结果区宽度"
          />
        ) : null}
        <div className={cx('mobile-pane', mobilePane !== 'results' && 'mobile-hidden')}>
          <ResultsRenderer
            scenarioId={baseScenarioId}
            config={config}
            session={session}
            defaultSlots={defaultResultSlots}
            onArtifactHandoff={onArtifactHandoff}
            collapsed={resultsCollapsed}
            onToggleCollapse={() => setResultsCollapsed((value) => !value)}
            activeRunId={activeRunId}
            onActiveRunChange={handleActiveRunChange}
            focusedObjectReference={focusedObjectReference}
            onFocusedObjectChange={setFocusedObjectReference}
            onPreviewPackageRequest={(reference, path, descriptor) => onPreviewPackageRequest(scenarioId, reference, path, descriptor)}
            workspaceFileEditor={workspaceFileEditor}
            onWorkspaceFileEditorChange={onWorkspaceFileEditorChange}
            onDismissResultSlotPresentation={(presentationId) => {
              onSessionChange({
                ...session,
                hiddenResultSlotIds: [...new Set([...(session.hiddenResultSlotIds ?? []), presentationId])],
                updatedAt: nowIso(),
              });
            }}
          />
        </div>
      </div>
    </main>
  );
}
