import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { compileScenarioIRFromSelection } from '@sciforge/scenario-core/scenario-element-compiler';
import { builtInScenarioIdForRuntimeInput, scenarioRuntimeOverrideForBuiltInScenario } from '@sciforge/scenario-core/scenario-routing-policy';
import { scenarios, type ScenarioId } from '../../data';
import { makeId, nowIso, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type ScenarioInstanceId, type ScenarioRuntimeOverride, type SciForgeConfig, type SciForgeReference, type SciForgeSession, type TimelineEventRecord } from '../../domain';
import { listWorkspace, type WorkspaceEntry } from '../../api/workspaceClient';
import {
  artifactTypeForPath,
  normalizeWorkspacePath,
  stableHash,
  toWorkspaceRelativePath,
  workspacePathBasename,
} from '../../../../../packages/support/object-references';
import { ChatPanel } from '../ChatPanel';
import { ResultsRenderer, type WorkspaceFileEditorState } from '../ResultsRenderer';
import type { SettingsSectionId } from '../appShell/settingsPageModel';
import { recoverableRunFocusForSession } from '../appShell/workspaceState';
import { runPresentationState } from '../results-renderer-execution-model';
import { recordUIActionInSession, type CommandTextUIAction, type OpenDebugAuditUIAction, type UIAction } from '../uiActionBoundary';
import type { HandoffAutoRunRequest } from '../results/viewPlanResolver';
import { scopedResultSlotId } from '../results/viewPlanResolver';
import { defaultElementSelectionForScenario, ScenarioBuilderPanel } from '../ScenarioBuilderPanel';
import { useRuntimeHealth } from '../runtimeHealthPanel';
import { cx } from '../uiPrimitives';
import { createWorkbenchObjectFocusUIAction } from './workbenchObjectFocus';

const WORKSPACE_REFERENCE_SCAN_MAX_FILES = 600;
const WORKSPACE_REFERENCE_SCAN_MAX_FOLDERS = 180;
const WORKSPACE_REFERENCE_SCAN_MAX_DEPTH = 5;
const WORKSPACE_REFERENCE_SKIP_FOLDERS = new Set([
  '.git',
  '.hg',
  '.sciforge',
  '.next',
  '.turbo',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
]);

function emptyRunAutoCollapseKey(sessionId: string, run: SciForgeSession['runs'][number]) {
  return `${sessionId}:${run.id}:${run.status}:${run.completedAt ?? run.createdAt}`;
}

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
  onForkChat,
  onArchiveChat,
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
  onOpenSettings,
  onTimelineEvent,
  onMarkReusableRun,
  onPreviewPackageRequest,
  workspaceFileEditor,
  onWorkspaceFileEditorChange,
  externalReferenceRequest,
  onExternalReferenceRequest,
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
  onForkChat: (scenarioId: ScenarioInstanceId) => void;
  onArchiveChat: (scenarioId: ScenarioInstanceId) => void;
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
  onOpenSettings?: (section?: SettingsSectionId) => void;
  onTimelineEvent: (event: TimelineEventRecord) => void;
  onMarkReusableRun: (scenarioId: ScenarioInstanceId, runId: string) => void;
  onPreviewPackageRequest: (scenarioId: ScenarioInstanceId, reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  workspaceFileEditor: WorkspaceFileEditorState | null;
  onWorkspaceFileEditorChange: (next: WorkspaceFileEditorState | null) => void;
  externalReferenceRequest?: { id: string; reference: SciForgeReference };
  onExternalReferenceRequest: (reference: SciForgeReference) => void;
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
  const [workspaceObjectReferences, setWorkspaceObjectReferences] = useState<ObjectReference[]>([]);
  const [chatColumnWidth, setChatColumnWidth] = useState(42);
  const workbenchResizeRef = useRef<{ startX: number; startWidth: number; gridWidth: number } | null>(null);
  const autoFocusedRunKeyRef = useRef<string | undefined>(undefined);
  const autoCollapsedEmptyRunKeyRef = useRef<string | undefined>(undefined);
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

  useEffect(() => {
    const workspaceRoot = normalizeWorkspacePath(config.workspacePath || '');
    if (!workspaceRoot) {
      setWorkspaceObjectReferences([]);
      return undefined;
    }
    let cancelled = false;
    void collectWorkspaceObjectReferences(config)
      .then((references) => {
        if (!cancelled) setWorkspaceObjectReferences(references);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceObjectReferences([]);
      });
    return () => {
      cancelled = true;
    };
  }, [config.workspacePath, config.workspaceWriterBaseUrl, session.updatedAt]);

  const showWorkbenchChromeBody = workbenchChromeExpanded;
  const recoveryFocus = recoverableRunFocusForSession(session);
  const recoveryRunKey = recoveryFocus ? `${recoveryFocus.sessionId}:${recoveryFocus.activeRunId}` : undefined;
  const activeResultRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : session.runs.at(-1);
  const activeResultPresentation = useMemo(
    () => activeResultRun ? runPresentationState(session, activeResultRun) : undefined,
    [session, activeResultRun],
  );
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

  useEffect(() => {
    if (!activeResultRun || !activeResultPresentation) return;
    if (activeResultPresentation.kind !== 'empty') return;
    const key = emptyRunAutoCollapseKey(session.sessionId, activeResultRun);
    if (autoCollapsedEmptyRunKeyRef.current === key) return;
    autoCollapsedEmptyRunKeyRef.current = key;
    setResultsCollapsed(true);
    if (mobilePane === 'results') setMobilePane('chat');
  }, [
    activeResultPresentation,
    activeResultRun,
    mobilePane,
    session.sessionId,
  ]);

  function handleActiveRunChange(runId: string | undefined) {
    setActiveRunId(runId);
  }

  const workspaceFilePathForLayout = workspaceFileEditor?.file.path;
  useEffect(() => {
    if (!workspaceFilePathForLayout) return;
    if (activeResultRun && activeResultPresentation?.kind === 'empty') {
      autoCollapsedEmptyRunKeyRef.current = emptyRunAutoCollapseKey(session.sessionId, activeResultRun);
    }
    setResultsCollapsed(false);
    setMobilePane('results');
  }, [activeResultPresentation?.kind, activeResultRun, session.sessionId, workspaceFilePathForLayout]);

  function handleObjectFocus(reference: ObjectReference) {
    recordWorkbenchUIAction(createWorkbenchObjectFocusUIAction({
      session,
      reference,
      id: makeId('ui-action'),
      createdAt: nowIso(),
    }));
    const referenceRun = reference.runId ? session.runs.find((run) => run.id === reference.runId) : undefined;
    if (referenceRun && runPresentationState(session, referenceRun).kind === 'empty') {
      autoCollapsedEmptyRunKeyRef.current = emptyRunAutoCollapseKey(session.sessionId, referenceRun);
    }
    setFocusedObjectReference(reference);
    if (reference.runId) setActiveRunId(reference.runId);
    setResultsCollapsed(false);
    setMobilePane('results');
  }

  function handleResultObjectFocus(reference: ObjectReference | undefined) {
    if (!reference) {
      setFocusedObjectReference(undefined);
      return;
    }
    handleObjectFocus(reference);
  }

  function handleExternalReferenceConsumed(requestId: string) {
    onExternalReferenceConsumed(requestId);
  }

  function handleExternalReferenceRequest(reference: SciForgeReference) {
    onExternalReferenceRequest(reference);
    setMobilePane('chat');
  }

  function recordWorkbenchUIAction(action: UIAction) {
    const nextSession = recordUIActionInSession(session, action);
    onSessionChange(nextSession);
    return nextSession;
  }

  function handleCommandTextAction(action: CommandTextUIAction) {
    recordWorkbenchUIAction(action);
    onDraftChange(scenarioId, action.commandText);
    if (action.runId) setActiveRunId(action.runId);
    setResultsCollapsed(false);
    setMobilePane('chat');
  }

  function handleOpenDebugAuditAction(action: OpenDebugAuditUIAction) {
    recordWorkbenchUIAction(action);
    if (action.runId) setActiveRunId(action.runId);
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
            <span className="workbench-chrome-title">SciForge Workspace</span>
            {workbenchChromeExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          <div className="workbench-sense-actions" aria-label="Senses">
            <button
              type="button"
              className={cx('sense-toggle', visionSenseActive && 'active')}
              aria-pressed={visionSenseActive}
              onClick={toggleVisionSense}
              title={visionSenseActive ? 'Disable vision-sense' : 'Enable vision-sense'}
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
        style={!resultsCollapsed && !mobileWorkbenchLayout ? { gridTemplateColumns: `minmax(360px, ${chatColumnWidth}%) 10px minmax(300px, 1fr)` } : undefined}
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
            onForkChat={() => onForkChat(scenarioId)}
            onArchiveChat={() => onArchiveChat(scenarioId)}
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
            onExternalReferenceConsumed={handleExternalReferenceConsumed}
            availableComponentIds={availableComponentIds}
            runtimeHealth={runtimeHealth}
            workspaceObjectReferences={workspaceObjectReferences}
            conversationLaneId={`workbench:${scenarioId}:${session.sessionId}`}
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
            onFocusedObjectChange={handleResultObjectFocus}
            onPreviewPackageRequest={(reference, path, descriptor) => onPreviewPackageRequest(scenarioId, reference, path, descriptor)}
            workspaceFileEditor={workspaceFileEditor}
            onWorkspaceFileEditorChange={onWorkspaceFileEditorChange}
            onConfigChange={onConfigChange}
            onOpenSettings={onOpenSettings}
            onCommandTextAction={handleCommandTextAction}
            onOpenDebugAuditAction={handleOpenDebugAuditAction}
            onExternalReferenceRequest={handleExternalReferenceRequest}
            onDismissResultSlotPresentation={(presentationId) => {
              const scopedPresentationId = scopedResultSlotId(activeRunId, presentationId);
              onSessionChange({
                ...session,
                hiddenResultSlotIds: [...new Set([...(session.hiddenResultSlotIds ?? []), scopedPresentationId])],
                updatedAt: nowIso(),
              });
            }}
          />
        </div>
      </div>
    </main>
  );
}

async function collectWorkspaceObjectReferences(config: SciForgeConfig): Promise<ObjectReference[]> {
  const workspaceRoot = normalizeWorkspacePath(config.workspacePath || '');
  if (!workspaceRoot) return [];
  const queue: Array<{ path: string; depth: number }> = [{ path: workspaceRoot, depth: 0 }];
  const visitedFolders = new Set<string>();
  const references: ObjectReference[] = [];
  while (queue.length && references.length < WORKSPACE_REFERENCE_SCAN_MAX_FILES && visitedFolders.size < WORKSPACE_REFERENCE_SCAN_MAX_FOLDERS) {
    const current = queue.shift();
    if (!current) break;
    const folderPath = normalizeWorkspacePath(current.path);
    if (!folderPath || visitedFolders.has(folderPath)) continue;
    visitedFolders.add(folderPath);
    const entries = await listWorkspace(folderPath, config);
    for (const entry of entries) {
      if (entry.kind === 'file') {
        const reference = objectReferenceForWorkspaceEntry(entry, workspaceRoot);
        if (reference) references.push(reference);
        if (references.length >= WORKSPACE_REFERENCE_SCAN_MAX_FILES) break;
        continue;
      }
      if (current.depth < WORKSPACE_REFERENCE_SCAN_MAX_DEPTH && shouldScanWorkspaceReferenceFolder(entry)) {
        queue.push({ path: entry.path, depth: current.depth + 1 });
      }
    }
    queue.sort((left, right) => workspaceFolderScanPriority(right.path) - workspaceFolderScanPriority(left.path));
  }
  return references;
}

function objectReferenceForWorkspaceEntry(entry: WorkspaceEntry, workspaceRoot: string): ObjectReference | undefined {
  const path = workspaceReferencePath(entry, workspaceRoot);
  if (!path || !workspaceReferencePathLooksPreviewable(path) || workspaceReferencePathIsPrivate(path)) return undefined;
  const title = entry.name || workspacePathBasename(path) || path;
  return {
    id: `workspace-file-${stableHash(path)}`,
    kind: 'file',
    title,
    ref: `file:${path}`,
    artifactType: artifactTypeForPath(path, 'file'),
    presentationRole: 'supporting-evidence',
    actions: ['focus-right-pane', 'reveal-in-folder', 'copy-path', 'pin'],
    status: 'available',
    summary: 'Workspace file verified for right-pane preview',
    provenance: {
      path,
      producer: 'workspace',
      size: entry.size,
    },
  };
}

function workspaceReferencePath(entry: WorkspaceEntry, workspaceRoot: string) {
  const relativePath = toWorkspaceRelativePath(workspaceRoot, entry.path).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!relativePath || relativePath === '.') return '';
  if (!relativePath.startsWith('..') && !relativePath.startsWith('/')) return relativePath;
  return normalizeWorkspacePath(entry.path).replace(/\\/g, '/');
}

function shouldScanWorkspaceReferenceFolder(entry: WorkspaceEntry) {
  if (entry.kind !== 'folder') return false;
  const name = entry.name.toLowerCase();
  return !name.startsWith('.') && !WORKSPACE_REFERENCE_SKIP_FOLDERS.has(name);
}

function workspaceFolderScanPriority(path: string) {
  const name = workspacePathBasename(path).toLowerCase();
  if (/^(workspace|reports?|artifacts?|results?|outputs?|figures?|images?|tables?|data|papers?|parallel)$/.test(name)) return 3;
  if (/^(docs?|examples?|fixtures?)$/.test(name)) return 2;
  return 1;
}

function workspaceReferencePathLooksPreviewable(path: string) {
  return /\.(?:md|markdown|txt|log|jsonl?|csv|tsv|html?|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|pdb|cif|mmcif)(?:$|[?#])/i.test(path);
}

function workspaceReferencePathIsPrivate(path: string) {
  return /(?:^|\/)(?:\.git|\.sciforge|node_modules)(?:\/|$)/i.test(path)
    || /\.sciforge\/sessions\//i.test(path);
}
