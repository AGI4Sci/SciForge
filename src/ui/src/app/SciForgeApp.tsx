import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUp,
  Copy,
  ExternalLink,
  Loader2,
  Download,
  Eye,
  File,
  FileCode,
  FilePlus,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Lock,
  Moon,
  Plus,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Sun,
  Target,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  scenarios,
  feasibilityRows,
  navItems,
  radarData,
  stats,
  type ScenarioId,
  type ClaimType,
  type EvidenceLevel,
  type PageId,
} from '../data';
import { SCENARIO_SPECS, SCENARIO_PRESETS, componentManifest } from '@sciforge/scenario-core/scenario-specs';
import { compileScenarioDraft, scenarioIdBySkillDomain, type ScenarioBuilderDraft } from '@sciforge/scenario-core/scenario-draft-compiler';
import { compileScenarioIRFromSelection, recommendScenarioElements, type ScenarioElementSelection } from '@sciforge/scenario-core/scenario-element-compiler';
import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import { buildScenarioQualityReport } from '@sciforge/scenario-core/scenario-quality-gate';
import { buildBuiltInScenarioPackage, builtInScenarioPackageRef, type ScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import type { ScenarioLibraryItem } from '@sciforge/scenario-core/scenario-library';
import { compileSlotsForScenario } from '@sciforge/scenario-core/ui-plan-compiler';
import { timeline } from '../demoData';
import { sendSciForgeToolMessage } from '../api/sciforgeToolsClient';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../exportPolicy';
import { FeedbackCaptureLayer } from '../feedback/FeedbackCaptureLayer';
import {
  buildFeedbackBundle,
  buildFeedbackGithubIssueBody,
  buildFeedbackGithubIssueTitle,
  importGithubOpenIssuesAsFeedback as applyGithubOpenIssuesAsFeedback,
  markFeedbackGithubIssueCreated,
  submitFeedbackGithubIssue,
  syncFeedbackGithubIssues,
} from '../feedback/githubFeedback';
import { FeedbackScreenshotPreview } from '../feedback/FeedbackScreenshotPreview';
import { FeedbackRepairAuditPanel } from '../feedback/FeedbackRepairAuditPanel';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  replaceGithubSyncedOpenIssuesInWorkspace,
  feedbackRepairAuditForIssue,
  upsertFeedbackRepairRunInWorkspace,
  updateFeedbackCommentStatus,
} from '../feedback/feedbackWorkspace';
import {
  makeId,
  nowIso,
  type SciForgeReference,
  type SciForgeRun,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type SciForgeConfig,
  type AgentStreamEvent,
  type DisplayIntent,
  type EvidenceClaim,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairRunRecord,
  type FeedbackRepairResultRecord,
  type GithubSyncedOpenIssueRecord,
  type FeedbackPriority,
  type NotebookRecord,
  type NormalizedAgentResponse,
  type ObjectAction,
  type ObjectReference,
  type PreviewDescriptor,
  type ResolvedViewPlan,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type ScenarioInstanceId,
  type ScenarioRuntimeOverride,
  type TimelineEventRecord,
  type UIManifestSlot,
  type ViewPlanSection,
} from '../domain';
import { uiModuleRegistry, type PresentationDedupeScope, type RuntimeUIModule } from '../uiModuleRegistry';
import type { VolcanoPoint } from '../charts';
import { compactWorkspaceStateForStorage, createSession, loadWorkspaceState, saveWorkspaceState, shouldUsePersistedWorkspaceState } from '../sessionStore';
import {
  activeSessionFor as workspaceActiveSessionFor,
  clearArchivedSessions as clearScenarioArchivedSessions,
  deleteActiveChat,
  deleteArchivedSessions as deleteScenarioArchivedSessions,
  deleteSessionMessage,
  editSessionMessage,
  restoreArchivedSession as restoreScenarioArchivedSession,
  startNewChat,
} from '../workspace/sessionWorkspace';
import { markReusableRunInWorkspace } from '../workspace/reusableTaskWorkspace';
import { defaultSciForgeConfig, loadSciForgeConfig, normalizeWorkspaceRootPath, saveSciForgeConfig, updateConfig } from '../config';
import {
  acceptSkillPromotionProposal,
  archiveSkillPromotionProposal,
  archiveWorkspaceScenario,
  deleteWorkspaceScenario,
  listSkillPromotionProposals,
  loadFeedbackIssueHandoffBundle,
  listWorkspace,
  loadSciForgeInstanceManifest,
  loadFileBackedSciForgeConfig,
  loadPersistedWorkspaceState,
  loadScenarioLibrary,
  loadWorkspaceScenario,
  mutateWorkspaceFile,
  openWorkspaceObject,
  persistWorkspaceState,
  publishWorkspaceScenario,
  rejectSkillPromotionProposal,
  restoreWorkspaceScenario,
  saveFileBackedSciForgeConfig,
  saveWorkspaceScenario,
  validateAcceptedSkillPromotionProposal,
  readWorkspaceFile,
  writeWorkspaceFile,
  type SkillPromotionProposalRecord,
  type SkillPromotionValidationResult,
  type WorkspaceEntry,
  type WorkspaceFileContent,
} from '../api/workspaceClient';
import { runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { TimelinePage } from './AlignmentPages';
import { ComponentWorkbenchPage } from './ComponentWorkbenchPage';
import { Dashboard } from './Dashboard';
import { ResultsRenderer, previewPackageAutoRunPrompt } from './ResultsRenderer';
import type { HandoffAutoRunRequest } from './results/viewPlanResolver';
import { ScenarioBuilderPanel, defaultElementSelectionForScenario, scenarioPackageToOverride } from './ScenarioBuilderPanel';
import { objectReferenceKindLabel } from '../../../../packages/support/object-references';
import { ChatPanel } from './ChatPanel';
import { exportJsonFile, exportTextFile } from './exportUtils';
import { RuntimeHealthPanel, useRuntimeHealth, type RuntimeHealthItem } from './runtimeHealthPanel';
import { ActionButton, Badge, Card, ChartLoadingFallback, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, IconButton, SectionHeader, cx } from './uiPrimitives';
import { DelayedHelpButton } from './DelayedHelpButton';
import { HeatmapViewer, MoleculeViewer, NetworkGraph, UmapViewer } from '../visualizations';
import { resolveSearchNavigation, workbenchNavigationForScenario } from './appShell/navigation';
import { SettingsDialog, Sidebar, TopBar, type ConfigSaveState } from './appShell/ShellPanels';
import {
  APP_BUILD_ID,
  feedbackStatusVariant,
  formatSessionTime,
  loadFeedbackAuthor,
  mergeFileBackedConfig,
  requestTitleFromFeedback,
  saveFeedbackAuthor,
  scenarioLabelForInstance,
} from './appShell/appHelpers';
import {
  appendTimelineEventToWorkspace,
  applySessionUpdateToWorkspace,
  createArtifactHandoffTransition,
  createPreviewPackageAutoRunRequest,
  touchWorkspaceUpdatedAt,
} from './appShell/workspaceState';

const chartTheme = {
  bg: '#0A0F1A',
  card: '#0F1623',
  elevated: '#1A2332',
  border: '#243044',
  text: '#E8EDF5',
  muted: '#7B93B0',
  accent: '#00E5A0',
  teal: '#4ECDC4',
  coral: '#FF7043',
  amber: '#FFD54F',
};

const ActivityAreaChart = lazy(async () => ({ default: (await import('../charts')).ActivityAreaChart }));
const VolcanoChart = lazy(async () => ({ default: (await import('../charts')).VolcanoChart }));
const CapabilityRadarChart = lazy(async () => ({ default: (await import('../charts')).CapabilityRadarChart }));

const officialScenarioPackages = scenarios.map((scenario) => ({
  scenario,
  package: buildBuiltInScenarioPackage(scenario.id, '2026-04-25T00:00:00.000Z'),
}));


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
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 36);
  return title || '新聊天';
}

function Workbench({
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
  const baseScenarioId = builtInScenarioIdForInstance(scenarioId, scenarioOverride);
  const scenarioView = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
  const scenarioSpec = SCENARIO_PRESETS[baseScenarioId];
  const visionSenseToolId = 'local.vision-sense';
  const baseRuntimeScenario: ScenarioRuntimeOverride = scenarioOverride ?? {
    title: scenarioSpec.title,
    description: scenarioSpec.description,
    skillDomain: scenarioSpec.skillDomain,
    scenarioMarkdown: scenarioSpec.scenarioMarkdown,
    defaultComponents: scenarioSpec.componentPolicy.defaultComponents,
    allowedComponents: scenarioSpec.componentPolicy.allowedComponents,
    fallbackComponent: scenarioSpec.componentPolicy.fallbackComponent,
  };
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
  useEffect(() => {
    if (activeRunId && !session.runs.some((run) => run.id === activeRunId)) {
      setActiveRunId(undefined);
    }
  }, [activeRunId, session.runs]);

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
            onActiveRunChange={setActiveRunId}
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
            onActiveRunChange={setActiveRunId}
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

function FeedbackInboxPage({
  config,
  comments,
  requests,
  repairRuns,
  repairResults,
  onStatusChange,
  onDelete,
  onCreateRequest,
  onRepairRunWritten,
  feedbackGithubRepo,
  feedbackGithubToken,
  githubSyncedOpenIssues,
  onReplaceGithubSyncedOpenIssues,
  onImportGithubOpenIssues,
  onGithubIssueCreated,
  onOpenGithubSettings,
}: {
  config: SciForgeConfig;
  comments: FeedbackCommentRecord[];
  requests: NonNullable<SciForgeWorkspaceState['feedbackRequests']>;
  repairRuns: FeedbackRepairRunRecord[];
  repairResults: FeedbackRepairResultRecord[];
  onStatusChange: (ids: string[], status: FeedbackCommentStatus) => void;
  onDelete: (ids: string[]) => void;
  onCreateRequest: (ids: string[], title: string) => void;
  onRepairRunWritten: (run: FeedbackRepairRunRecord) => void;
  feedbackGithubRepo?: string;
  feedbackGithubToken?: string;
  githubSyncedOpenIssues: GithubSyncedOpenIssueRecord[];
  onReplaceGithubSyncedOpenIssues: (issues: GithubSyncedOpenIssueRecord[]) => void;
  onImportGithubOpenIssues: (issues: GithubSyncedOpenIssueRecord[]) => number;
  onGithubIssueCreated: (commentIds: string[], issue: { number: number; htmlUrl: string; title: string }) => void;
  onOpenGithubSettings: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<FeedbackCommentStatus | 'all'>('all');
  const [githubActionHint, setGithubActionHint] = useState('');
  const [githubSubmitBusy, setGithubSubmitBusy] = useState(false);
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
  const [handoffBusyById, setHandoffBusyById] = useState<Record<string, boolean>>({});
  const [handoffTargetById, setHandoffTargetById] = useState<Record<string, string>>({});
  const [handoffHintById, setHandoffHintById] = useState<Record<string, string>>({});
  const effectiveGithubRepo = useMemo(
    () => (feedbackGithubRepo?.trim() || defaultSciForgeConfig.feedbackGithubRepo || '').trim(),
    [feedbackGithubRepo],
  );
  const repairTargets = useMemo(
    () => (config.peerInstances ?? []).filter((peer) => peer.enabled && peer.trustLevel === 'repair'),
    [config.peerInstances],
  );
  const visibleComments = comments
    .filter((comment) => statusFilter === 'all' || comment.status === statusFilter)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const selectedComments = comments.filter((comment) => selectedIds.includes(comment.id));
  const bundle = buildFeedbackBundle(selectedComments.length ? selectedComments : visibleComments, requests, APP_BUILD_ID);
  const issueScopeComments = selectedComments.length ? selectedComments : visibleComments;
  const issueTitle = buildFeedbackGithubIssueTitle(issueScopeComments);
  const issueBody = buildFeedbackGithubIssueBody(issueScopeComments, requests, APP_BUILD_ID);
  const visibleIds = visibleComments.map((item) => item.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;

  function ensureGithubTokenOrOpenSettings(): boolean {
    const token = feedbackGithubToken?.trim();
    if (token) return true;
    setGithubActionHint(`需要 GitHub Personal Access Token：已打开「设置」，请在「反馈 GitHub Token」填写（需 Issues 读写）。当前仓库 ${effectiveGithubRepo || '（未解析）'}。`);
    onOpenGithubSettings();
    return false;
  }

  async function submitGithubIssueApi() {
    if (!issueScopeComments.length) return;
    if (!ensureGithubTokenOrOpenSettings()) return;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken!.trim();
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    setGithubSubmitBusy(true);
    try {
      const created = await submitFeedbackGithubIssue({ repo, token, title: issueTitle, body: issueBody });
      onGithubIssueCreated(issueScopeComments.map((comment) => comment.id), {
        number: created.number,
        htmlUrl: created.htmlUrl,
        title: issueTitle,
      });
      setGithubActionHint(`已创建 Issue #${created.number}，正在打开页面…`);
      window.open(created.htmlUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setGithubActionHint(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubSubmitBusy(false);
    }
  }

  async function syncGithubOpenIssues() {
    if (!ensureGithubTokenOrOpenSettings()) return;
    const repo = effectiveGithubRepo;
    const token = feedbackGithubToken!.trim();
    if (!repo) {
      setGithubActionHint('请在设置中填写有效的反馈 GitHub 仓库（owner/repo）。');
      return;
    }
    setGithubSyncBusy(true);
    try {
      const syncedAt = nowIso();
      const mapped = await syncFeedbackGithubIssues(repo, token, syncedAt);
      onReplaceGithubSyncedOpenIssues(mapped.slice(0, 500));
      const imported = onImportGithubOpenIssues(mapped.slice(0, 500));
      setGithubActionHint(`已同步 ${mapped.length} 条未关闭 Issue（不含 PR），导入/更新 ${imported} 条本地反馈。`);
    } catch (error) {
      setGithubActionHint(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubSyncBusy(false);
    }
  }

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function deleteSelected(ids: string[]) {
    if (!ids.length) return;
    const confirmed = window.confirm(`确认删除 ${ids.length} 条反馈？问题解决后删除不会影响已导出的 Bundle。`);
    if (!confirmed) return;
    onDelete(ids);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
  }

  function openGithubIssue(event: ReactMouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    if (!url.trim()) return;
    window.location.assign(url);
  }

  async function handoffFeedbackIssue(item: FeedbackCommentRecord) {
    const targetName = handoffTargetById[item.id] || repairTargets[0]?.name || '';
    const target = repairTargets.find((peer) => peer.name === targetName);
    if (!target) {
      setHandoffHintById((current) => ({ ...current, [item.id]: '没有可用的 repair 目标实例。请先配置 enabled + repair trust 的 peer instance。' }));
      return;
    }
    const targetConfig = {
      ...config,
      workspaceWriterBaseUrl: target.workspaceWriterUrl,
      workspacePath: target.workspacePath,
    };
    setHandoffBusyById((current) => ({ ...current, [item.id]: true }));
    setHandoffHintById((current) => ({ ...current, [item.id]: `正在准备交给 ${target.name}...` }));
    try {
      const bundlePromise = loadFeedbackIssueHandoffBundle(config, item.id);
      const manifestPromise = loadSciForgeInstanceManifest(targetConfig, target.workspacePath);
      const [bundleResult, manifestResult] = await Promise.allSettled([bundlePromise, manifestPromise]);
      const bundle = bundleResult.status === 'fulfilled' ? bundleResult.value : undefined;
      const manifest = manifestResult.status === 'fulfilled' ? manifestResult.value : undefined;
      const executorName = manifest?.instance.name || target.name;
      const executorId = manifest?.instance.id || target.name;
      const run: FeedbackRepairRunRecord = {
        schemaVersion: 1,
        id: makeId('feedback-repair-run'),
        issueId: item.id,
        status: 'assigned',
        externalInstanceId: executorId,
        externalInstanceName: executorName,
        actor: 'feedback-inbox',
        startedAt: nowIso(),
        note: `已交给 ${executorName}。收件箱只记录 handoff 和审计，不运行修复 runner。`,
        metadata: {
          handoffKind: 'feedback-repair',
          sourceWorkspacePath: config.workspacePath || bundle?.workspacePath,
          targetWorkspacePath: target.workspacePath,
          targetAppUrl: target.appUrl,
          targetWorkspaceWriterUrl: target.workspaceWriterUrl,
          handoffBundle: bundle,
          targetManifest: manifest,
          targetManifestUnavailable: manifestResult.status === 'rejected' ? String(manifestResult.reason) : undefined,
        },
      };
      onRepairRunWritten(run);
      setHandoffHintById((current) => ({ ...current, [item.id]: `已交给 ${executorName}；等待外部实例写回 repair result。` }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHandoffHintById((current) => ({ ...current, [item.id]: `Handoff 记录失败：${message}` }));
    } finally {
      setHandoffBusyById((current) => ({ ...current, [item.id]: false }));
    }
  }

  return (
    <main className="feedback-page">
      <section className="feedback-hero">
        <div>
          <Badge variant="info">Feedback Bundle</Badge>
          <h1>反馈收件箱</h1>
          <p>汇总多用户页面评论、元素定位和运行时上下文，供 Codex 批量修改代码并回写发布状态。</p>
        </div>
        <div className="feedback-stats">
          <span><strong>{comments.length}</strong> comments</span>
          <span><strong>{requests.length}</strong> requests</span>
          <span><strong>{comments.filter((item) => item.status === 'open').length}</strong> open</span>
          <span><strong>{githubSyncedOpenIssues.length}</strong> GitHub open</span>
        </div>
      </section>
      <section className="feedback-toolbar">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as FeedbackCommentStatus | 'all')}>
          <option value="all">全部状态</option>
          <option value="open">open</option>
          <option value="triaged">triaged</option>
          <option value="planned">planned</option>
          <option value="fixed">fixed</option>
          <option value="needs-discussion">needs-discussion</option>
          <option value="wont-fix">wont-fix</option>
        </select>
        <span className="feedback-selection-count">{selectedIds.length ? `已选择 ${selectedIds.length} 条` : `当前列表 ${visibleComments.length} 条`}</span>
        <DelayedHelpButton
          onClick={() => setSelectedIds(visibleIds)}
          disabled={!visibleIds.length || visibleSelectedCount === visibleIds.length}
          help="选择当前筛选结果中的所有反馈，适合批量标记、生成 Request 或提交到 GitHub。"
        >
          选择当前列表
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onStatusChange(selectedIds, 'triaged')}
          disabled={!selectedIds.length}
          help="把已选反馈标为 triaged，表示已经确认并进入处理队列。"
        >
          标记 triaged
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onStatusChange(selectedIds, 'fixed')}
          disabled={!selectedIds.length}
          help="把已选反馈标为 fixed，适合修复完成后回写状态。"
        >
          标记 fixed
        </DelayedHelpButton>
        <DelayedHelpButton
          className="danger"
          onClick={() => deleteSelected(selectedIds)}
          disabled={!selectedIds.length}
          help="删除已选本地反馈；不会删除已经导出的 Bundle 或 GitHub Issue。"
        >
          删除选中
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => onCreateRequest(selectedIds, requestTitleFromFeedback(selectedComments))}
          disabled={!selectedIds.length}
          help="把已选反馈合并成一个本地 Request，便于后续按任务追踪。"
        >
          生成 Request
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => exportJsonFile(`sciforge-feedback-${nowIso().slice(0, 10)}.json`, bundle)}
          help="导出当前选择或当前列表的反馈 Bundle，供离线归档或交给 Codex 批量处理。"
        >
          导出 Bundle
        </DelayedHelpButton>
        <DelayedHelpButton
          className="feedback-github-primary"
          onClick={() => void submitGithubIssueApi()}
          disabled={!issueScopeComments.length || githubSubmitBusy}
          help={`向 ${effectiveGithubRepo || '配置仓库'} 创建 GitHub Issue；需要在设置中填写具备 Issues 读写权限的 PAT。`}
        >
          {githubSubmitBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : null}
          提交到 GitHub
        </DelayedHelpButton>
        <DelayedHelpButton
          onClick={() => void syncGithubOpenIssues()}
          disabled={githubSyncBusy}
          help={`从 ${effectiveGithubRepo || '配置仓库'} 拉取未关闭 Issue，并导入为本地反馈；Pull Request 会自动排除。`}
        >
          {githubSyncBusy ? <Loader2 size={15} className="feedback-inline-spin" aria-hidden /> : null}
          从 GitHub 同步
        </DelayedHelpButton>
        {!feedbackGithubToken?.trim() ? (
          <span className="feedback-toolbar-token-note" title="GitHub API 匿名不可用">
            未配置 Token：点「提交 / 同步」将打开设置并提示填写 PAT
          </span>
        ) : null}
        {githubActionHint ? <span className="feedback-github-hint" role="status">{githubActionHint}</span> : null}
      </section>
      {!visibleComments.length ? (
        <div className="empty-runtime-state">
          <Badge variant="muted">empty</Badge>
          <strong>还没有反馈</strong>
          <p>点击右下角“评论”进入评论模式，然后点选任意页面元素保存反馈。</p>
        </div>
      ) : (
        <section className="feedback-list">
          {visibleComments.map((item) => (
            <article className={cx('feedback-card', selectedIds.includes(item.id) && 'selected')} key={item.id}>
              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} aria-label={`选择反馈 ${item.id}`} />
              <div className="feedback-card-main">
                {(() => {
                  const audit = feedbackRepairAuditForIssue(item.id, repairRuns, repairResults);
                  const targetValue = handoffTargetById[item.id] || repairTargets[0]?.name || '';
                  return (
                    <>
                <div className="feedback-card-head">
                  <strong>{item.comment}</strong>
                  <div className="feedback-card-head-actions">
                    <Badge variant={feedbackStatusVariant(item.status)}>{item.status}</Badge>
                    <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'warning' : 'muted'}>{item.priority}</Badge>
                    <Badge variant={audit.badge}>{audit.label}</Badge>
                  </div>
                </div>
                <p>{item.authorName} · {formatSessionTime(item.createdAt)} · {item.runtime.page} · {item.runtime.scenarioId}</p>
                {item.githubIssueUrl ? (
                  <a
                    className="feedback-github-card-link"
                    href={item.githubIssueUrl}
                    onClick={(event) => openGithubIssue(event, item.githubIssueUrl!)}
                    title="打开对应的 GitHub Issue"
                  >
                    GitHub #{item.githubIssueNumber ?? '?'}
                    <ExternalLink size={13} aria-hidden />
                  </a>
                ) : null}
                <div className="feedback-target-summary compact">
                  <span>target</span>
                  <code>{item.target.selector}</code>
                  <span>runtime</span>
                  <code>{item.runtime.sessionId ?? 'no-session'} / {item.runtime.activeRunId ?? 'no-run'}</code>
                </div>
                <FeedbackRepairAuditPanel
                  audit={audit}
                  repairTargets={repairTargets}
                  targetValue={targetValue}
                  busy={handoffBusyById[item.id]}
                  hint={handoffHintById[item.id]}
                  onTargetChange={(targetName) => setHandoffTargetById((current) => ({ ...current, [item.id]: targetName }))}
                  onHandoff={() => void handoffFeedbackIssue(item)}
                />
                <FeedbackScreenshotPreview item={item} />
                {item.tags.length ? <div className="feedback-tags">{item.tags.map((tag) => <code key={tag}>{tag}</code>)}</div> : null}
                    </>
                  );
                })()}
              </div>
            </article>
          ))}
        </section>
      )}
      <section className="feedback-github-panel" aria-label="GitHub 未关闭 Issue">
        <div className="feedback-github-panel-head">
          <h2>GitHub 未关闭 Issue</h2>
          <p>与上方本地反馈评论独立；仅同步仍打开的 Issue，Pull Request 会自动排除。数据保存在本机 workspace。</p>
        </div>
        {githubSyncedOpenIssues.length ? (
          <ul className="feedback-github-issue-list">
            {githubSyncedOpenIssues.map((issue) => (
              <li key={issue.number}>
                <div className="feedback-github-issue-row">
                  <a
                    className="feedback-github-issue-link"
                    href={issue.htmlUrl}
                    onClick={(event) => openGithubIssue(event, issue.htmlUrl)}
                    title="打开对应的 GitHub Issue"
                  >
                    <span className="feedback-github-issue-num">#{issue.number}</span>
                    <strong>{issue.title}</strong>
                    <ExternalLink size={14} aria-hidden className="feedback-github-issue-ext" />
                  </a>
                  <div className="feedback-github-issue-meta">
                    {issue.authorLogin ? <span>@{issue.authorLogin}</span> : null}
                    <span>更新 {formatSessionTime(issue.updatedAt)}</span>
                    <span>同步 {formatSessionTime(issue.syncedAt)}</span>
                  </div>
                  {issue.labels.length ? (
                    <div className="feedback-tags">{issue.labels.map((label) => <code key={label}>{label}</code>)}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="feedback-github-empty">
            <Badge variant="muted">empty</Badge>
            <p>尚未同步。配置仓库与 Token 后点击「从 GitHub 同步」。</p>
          </div>
        )}
      </section>
    </main>
  );
}

export function SciForgeApp() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [scenarioId, setScenarioId] = useState<ScenarioInstanceId>('literature-evidence-review');
  const [config, setConfig] = useState<SciForgeConfig>(() => loadSciForgeConfig());
  const [configFileHydrated, setConfigFileHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceState, setWorkspaceState] = useState<SciForgeWorkspaceState>(() => {
    const state = loadWorkspaceState();
    const loadedConfig = loadSciForgeConfig();
    return { ...state, workspacePath: normalizeWorkspaceRootPath(loadedConfig.workspacePath || state.workspacePath) };
  });
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [handoffAutoRun, setHandoffAutoRun] = useState<HandoffAutoRunRequest | undefined>();
  const [workbenchWorkspaceFileEditor, setWorkbenchWorkspaceFileEditor] = useState<{ file: WorkspaceFileContent; draft: string } | null>(null);
  const [feedbackAuthor, setFeedbackAuthor] = useState(() => loadFeedbackAuthor());
  const [configSaveState, setConfigSaveState] = useState<ConfigSaveState>({ status: 'idle' });
  const [externalReferenceRequest, setExternalReferenceRequest] = useState<{ id: string; scenarioId: ScenarioInstanceId; reference: SciForgeReference } | undefined>();
  const [scenarioOverrides, setScenarioOverrides] = useState<Partial<Record<ScenarioInstanceId, ScenarioRuntimeOverride>>>({});
  const [selectedRuntimeComponentIds, setSelectedRuntimeComponentIds] = useState<string[]>(() => (
    Array.from(new Set(uiModuleRegistry.filter((module) => module.lifecycle === 'published').map((module) => module.componentId))).sort()
  ));
  const [drafts, setDrafts] = useState<Record<ScenarioInstanceId, string>>({
    'literature-evidence-review': '',
    'structure-exploration': '',
    'omics-differential-exploration': '',
    'biomedical-knowledge-graph': '',
  });
  const [messageScrollTops, setMessageScrollTops] = useState<Record<ScenarioInstanceId, number>>({
    'literature-evidence-review': 0,
    'structure-exploration': 0,
    'omics-differential-exploration': 0,
    'biomedical-knowledge-graph': 0,
  });

  const sessions = workspaceState.sessionsByScenario;
  const archivedSessionsByAgent = useMemo(() => {
    const acc = scenarios.reduce((memo, scenario) => {
      memo[scenario.id] = workspaceState.archivedSessions
      .filter((session) => session.scenarioId === scenario.id)
      .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
      return memo;
    }, {} as Record<ScenarioInstanceId, SciForgeSession[]>);
    for (const session of workspaceState.archivedSessions) {
      if (acc[session.scenarioId]) continue;
      acc[session.scenarioId] = workspaceState.archivedSessions
        .filter((item) => item.scenarioId === session.scenarioId)
        .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
    }
    return acc;
  }, [workspaceState.archivedSessions]);
  const archivedCountByAgent = useMemo(() => Object.fromEntries(
    Object.entries(archivedSessionsByAgent).map(([key, value]) => [key, value.length]),
  ) as Record<ScenarioInstanceId, number>, [archivedSessionsByAgent]);

  useEffect(() => {
    let cancelled = false;
    loadFileBackedSciForgeConfig(config)
      .then((fileConfig) => {
        if (cancelled) return;
        if (fileConfig) {
          setConfig((current) => {
            const next = mergeFileBackedConfig(current, fileConfig);
            saveSciForgeConfig(next);
            return next;
          });
          setWorkspaceState((current) => ({
            ...current,
            workspacePath: normalizeWorkspaceRootPath(fileConfig.workspacePath || current.workspacePath),
          }));
          setWorkspaceStatus('已从 config.local.json 加载统一配置');
        }
      })
      .catch((err) => {
        if (!cancelled) setWorkspaceStatus(`config.local.json 未加载：${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setConfigFileHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function hydrateWorkspaceSnapshot(path: string, runtimeConfig: SciForgeConfig, mode: 'prefer-newer' | 'force' = 'prefer-newer') {
    const requestedPath = normalizeWorkspaceRootPath(path);
    setWorkspaceHydrated(false);
    try {
      const persisted = await loadPersistedWorkspaceState(requestedPath, runtimeConfig);
      if (persisted) {
        const restoredPath = normalizeWorkspaceRootPath(persisted.workspacePath || requestedPath);
        setWorkspaceState((current) => {
          const incoming = { ...persisted, workspacePath: restoredPath };
          return mode === 'force' || shouldUsePersistedWorkspaceState(current, incoming) ? incoming : current;
        });
        if (restoredPath && runtimeConfig.workspacePath !== restoredPath) {
          setConfig((current) => {
            if (current.workspacePath === restoredPath) return current;
            const next = updateConfig(current, { workspacePath: restoredPath });
            saveSciForgeConfig(next);
            return next;
          });
        }
        setWorkspaceStatus(`已从 ${restoredPath || '最近工作区'}/.sciforge 恢复工作区`);
      } else {
        setWorkspaceStatus(requestedPath ? `未找到 ${requestedPath}/.sciforge/workspace-state.json` : '未找到最近工作区快照');
      }
    } catch (err) {
      setWorkspaceStatus(`Workspace snapshot 未加载：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWorkspaceHydrated(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const workspacePath = normalizeWorkspaceRootPath(config.workspacePath);
    const loadStartedAt = Date.now();
	    loadPersistedWorkspaceState(workspacePath, config)
	      .then((persisted) => {
	        if (cancelled) return;
	        if (persisted) {
	          const restoredPath = normalizeWorkspaceRootPath(persisted.workspacePath || workspacePath);
	          setWorkspaceState((current) => {
	            const currentUpdatedAt = Date.parse(current.updatedAt || '');
	            if (Number.isFinite(currentUpdatedAt) && currentUpdatedAt > loadStartedAt) return current;
	            const incoming = { ...persisted, workspacePath: restoredPath };
	            return shouldUsePersistedWorkspaceState(current, incoming, { explicitWorkspacePath: Boolean(workspacePath) }) ? incoming : current;
	          });
          setConfig((current) => {
            if (current.workspacePath === restoredPath) return current;
            const next = updateConfig(current, { workspacePath: restoredPath });
            saveSciForgeConfig(next);
            return next;
          });
          setWorkspaceStatus(`已从 ${restoredPath}/.sciforge 恢复工作区`);
        } else {
          setWorkspaceStatus(workspacePath ? `未找到 ${workspacePath}/.sciforge/workspace-state.json` : '未找到最近工作区快照');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWorkspaceStatus(`Workspace snapshot 未加载：${err instanceof Error ? err.message : String(err)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;
    saveWorkspaceState(workspaceState);
    if (workspaceState.workspacePath.trim()) {
      persistWorkspaceState(compactWorkspaceStateForStorage(workspaceState), config)
        .then(() => setWorkspaceStatus(`已同步到 ${workspaceState.workspacePath}/.sciforge`))
        .catch((err) => setWorkspaceStatus(`Workspace writer 未连接：${err instanceof Error ? err.message : String(err)}`));
    }
  }, [workspaceState, config, workspaceHydrated]);

  useEffect(() => {
    if (!configFileHydrated) return;
    saveSciForgeConfig(config);
    setConfigSaveState({ status: 'saving' });
    saveFileBackedSciForgeConfig(config)
      .then(() => {
        const savedAt = nowIso();
        setConfigSaveState({ status: 'saved', savedAt });
        setWorkspaceStatus('已保存到 config.local.json');
      })
      .catch((err) => {
        const message = `config.local.json 未保存：${err instanceof Error ? err.message : String(err)}`;
        setConfigSaveState({ status: 'error', message });
        setWorkspaceStatus(message);
      });
  }, [config, configFileHydrated]);

  useEffect(() => {
    if (page !== 'workbench') setWorkbenchWorkspaceFileEditor(null);
  }, [page]);

  useEffect(() => {
    saveFeedbackAuthor(feedbackAuthor);
  }, [feedbackAuthor]);

  function updateWorkspace(mutator: (state: SciForgeWorkspaceState) => SciForgeWorkspaceState) {
    setWorkspaceState((current) => touchWorkspaceUpdatedAt(mutator(current), nowIso()));
  }

  function updateSession(nextSession: SciForgeSession, reason = 'session update') {
    updateWorkspace((current) => applySessionUpdateToWorkspace(current, nextSession, reason));
  }

  function appendTimelineEvent(event: TimelineEventRecord) {
    updateWorkspace((current) => appendTimelineEventToWorkspace(current, event));
  }

  function addFeedbackComment(comment: FeedbackCommentRecord) {
    updateWorkspace((current) => addFeedbackCommentToWorkspace(current, comment));
  }

  function addContextReference(reference: SciForgeReference) {
    const requestId = makeId('context-ref');
    setExternalReferenceRequest({ id: requestId, scenarioId, reference });
    setPage('workbench');
  }

  function updateFeedbackStatus(ids: string[], status: FeedbackCommentStatus) {
    if (!ids.length) return;
    updateWorkspace((current) => updateFeedbackCommentStatus(current, ids, status, nowIso()));
  }

  function deleteFeedbackComments(ids: string[]) {
    if (!ids.length) return;
    updateWorkspace((current) => deleteFeedbackCommentsFromWorkspace(current, ids));
  }

  function createFeedbackRequest(ids: string[], title: string) {
    if (!ids.length) return;
    updateWorkspace((current) => createFeedbackRequestFromComments(current, ids, title));
  }

  function recordFeedbackRepairRun(run: FeedbackRepairRunRecord) {
    updateWorkspace((current) => upsertFeedbackRepairRunInWorkspace(current, run));
  }

  function replaceGithubSyncedOpenIssues(issues: GithubSyncedOpenIssueRecord[]) {
    updateWorkspace((current) => replaceGithubSyncedOpenIssuesInWorkspace(current, issues, nowIso()));
  }

  function recordGithubIssueCreated(commentIds: string[], issue: { number: number; htmlUrl: string; title: string }) {
    updateWorkspace((current) => markFeedbackGithubIssueCreated(current, commentIds, issue));
  }

  function importGithubOpenIssuesAsFeedback(issues: GithubSyncedOpenIssueRecord[]) {
    const preview = applyGithubOpenIssuesAsFeedback(workspaceState, issues, nowIso(), APP_BUILD_ID);
    updateWorkspace((current) => applyGithubOpenIssuesAsFeedback(current, issues, nowIso(), APP_BUILD_ID).state);
    return preview.changed;
  }

  function setWorkspacePath(value: string) {
    const workspacePath = normalizeWorkspaceRootPath(value);
    const nextConfig = updateConfig(config, { workspacePath });
    setConfig(nextConfig);
    saveSciForgeConfig(nextConfig);
    updateWorkspace((current) => ({ ...current, workspacePath }));
    void hydrateWorkspaceSnapshot(workspacePath, nextConfig, 'force');
  }

  function updateRuntimeConfig(patch: Partial<SciForgeConfig>) {
    setConfig((current) => {
      const next = updateConfig(current, patch);
      saveSciForgeConfig(next);
      if ('workspacePath' in patch) {
        updateWorkspace((state) => ({ ...state, workspacePath: next.workspacePath }));
        void hydrateWorkspaceSnapshot(next.workspacePath, next, 'force');
      }
      return next;
    });
  }

  function saveRuntimeConfigNow() {
    const next = updateConfig(config, {});
    saveSciForgeConfig(next);
    setConfigSaveState({ status: 'saving' });
    saveFileBackedSciForgeConfig(next)
      .then(() => {
        const savedAt = nowIso();
        setConfigSaveState({ status: 'saved', savedAt });
        setWorkspaceStatus('设置已保存并对下一次 AgentServer 请求生效');
      })
      .catch((err) => {
        const message = `设置未保存：${err instanceof Error ? err.message : String(err)}`;
        setConfigSaveState({ status: 'error', message });
        setWorkspaceStatus(message);
      });
  }

  function updateDraft(nextScenarioId: ScenarioInstanceId, value: string) {
    setDrafts((current) => ({ ...current, [nextScenarioId]: value }));
  }

  function updateMessageScrollTop(nextScenarioId: ScenarioInstanceId, value: number) {
    setMessageScrollTops((current) => {
      if (Math.abs((current[nextScenarioId] ?? 0) - value) < 1) return current;
      return { ...current, [nextScenarioId]: value };
    });
  }

  function applyScenarioOverride(nextScenarioId: ScenarioInstanceId, override: ScenarioRuntimeOverride) {
    setScenarioOverrides((current) => ({ ...current, [nextScenarioId]: override }));
  }

  function activeSessionFor(state: SciForgeWorkspaceState, nextScenarioId: ScenarioInstanceId) {
    return workspaceActiveSessionFor(state, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`);
  }

  function newChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => startNewChat(current, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`));
  }

  function deleteChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => deleteActiveChat(current, nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`));
  }

  function restoreArchivedSession(nextScenarioId: ScenarioInstanceId, sessionId: string) {
    updateWorkspace((current) => restoreScenarioArchivedSession(
      current,
      nextScenarioId,
      sessionId,
      nowIso(),
      `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
    ));
  }

  function deleteArchivedSessions(nextScenarioId: ScenarioInstanceId, sessionIds: string[]) {
    if (!sessionIds.length) return;
    updateWorkspace((current) => deleteScenarioArchivedSessions(current, nextScenarioId, sessionIds));
  }

  function clearArchivedSessions(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => clearScenarioArchivedSessions(current, nextScenarioId));
  }

  function editMessage(nextScenarioId: ScenarioInstanceId, messageId: string, content: string) {
    updateSession(editSessionMessage(workspaceState, nextScenarioId, messageId, content, nowIso()), `edit message ${messageId}`);
  }

  function deleteMessage(nextScenarioId: ScenarioInstanceId, messageId: string) {
    updateSession(deleteSessionMessage(workspaceState, nextScenarioId, messageId, nowIso()), `delete message ${messageId}`);
  }

  function markReusableRun(nextScenarioId: ScenarioInstanceId, runId: string) {
    updateWorkspace((current) => markReusableRunInWorkspace(current, nextScenarioId, runId, nowIso()));
  }

  function handleSearch(query: string) {
    const target = resolveSearchNavigation(query, scenarios);
    if (!target) return;
    if (target.scenarioId) setScenarioId(target.scenarioId);
    setPage(target.page);
  }

  function handleArtifactHandoff(targetScenario: ScenarioId, artifact: RuntimeArtifact) {
    const now = nowIso();
    const transition = createArtifactHandoffTransition(scenarios, targetScenario, artifact, {
      now,
      notebookTime: new Date(now).toLocaleString('zh-CN', { hour12: false }),
    });
    setWorkspaceState(transition.apply);
    const target = workbenchNavigationForScenario(transition.targetScenario);
    setScenarioId(target.scenarioId);
    setPage(target.page);
    setHandoffAutoRun(transition.autoRunRequest);
  }

  function consumeHandoffAutoRun(requestId: string) {
    setHandoffAutoRun((current) => current?.id === requestId ? undefined : current);
  }

  function handlePreviewPackageRequest(
    targetScenario: ScenarioInstanceId,
    reference: ObjectReference,
    path?: string,
    descriptor?: PreviewDescriptor,
  ) {
    const target = workbenchNavigationForScenario(targetScenario);
    setScenarioId(target.scenarioId);
    setPage(target.page);
    setHandoffAutoRun(createPreviewPackageAutoRunRequest(targetScenario, previewPackageAutoRunPrompt(reference, path, descriptor)));
  }

  const activeScenarioOverride = scenarioOverrides[scenarioId];
  const activeBuiltInScenarioId = builtInScenarioIdForInstance(scenarioId, activeScenarioOverride);
  const activeSession = sessions[scenarioId] ?? createSession(scenarioId, `${scenarioLabelForInstance(scenarioId)} 新聊天`);
  const appHealthItems = useRuntimeHealth(config, Object.keys(sessions).length);

  return (
    <div className={cx('app-shell', `theme-${config.theme ?? 'dark'}`)}>
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <Sidebar
        page={page}
        setPage={setPage}
        scenarioId={activeBuiltInScenarioId}
        setScenarioId={setScenarioId}
        config={config}
        workspaceStatus={workspaceStatus}
        onWorkspacePathChange={setWorkspacePath}
        deferWorkbenchFilePreview={page === 'workbench'}
        onWorkbenchFileOpened={(file) => setWorkbenchWorkspaceFileEditor({ file, draft: file.content })}
        workbenchEditorFilePath={workbenchWorkspaceFileEditor?.file.path ?? null}
        onWorkbenchEditorPathInvalidated={() => setWorkbenchWorkspaceFileEditor(null)}
      />
      <div className="main-shell">
        <TopBar
          onSearch={handleSearch}
          onSettingsOpen={() => setSettingsOpen(true)}
          theme={config.theme}
          onThemeToggle={() => updateRuntimeConfig({ theme: (config.theme ?? 'dark') === 'dark' ? 'light' : 'dark' })}
          healthItems={appHealthItems}
        />
        <div className="content-shell">
          {page === 'dashboard' ? (
            <Dashboard
              setPage={setPage}
              setScenarioId={setScenarioId}
              config={config}
              workspaceState={workspaceState}
              onApplyScenarioDraft={applyScenarioOverride}
              onWorkbenchPrompt={updateDraft}
            />
          ) : page === 'workbench' ? (
            <Workbench
              scenarioId={scenarioId}
              config={config}
              session={activeSession}
              draft={drafts[scenarioId] ?? ''}
              savedScrollTop={messageScrollTops[scenarioId] ?? 0}
              onDraftChange={updateDraft}
              onScrollTopChange={updateMessageScrollTop}
              onSessionChange={updateSession}
              onNewChat={newChat}
              onDeleteChat={deleteChat}
              archivedSessions={archivedSessionsByAgent[scenarioId] ?? []}
              onRestoreArchivedSession={restoreArchivedSession}
              onDeleteArchivedSessions={deleteArchivedSessions}
              onClearArchivedSessions={clearArchivedSessions}
              onEditMessage={editMessage}
              onDeleteMessage={deleteMessage}
              archivedCount={archivedCountByAgent[scenarioId] ?? 0}
              onArtifactHandoff={handleArtifactHandoff}
              autoRunRequest={handoffAutoRun}
              onAutoRunConsumed={consumeHandoffAutoRun}
              scenarioOverride={activeScenarioOverride}
              onScenarioOverrideChange={applyScenarioOverride}
              onConfigChange={updateRuntimeConfig}
              onTimelineEvent={appendTimelineEvent}
              onMarkReusableRun={markReusableRun}
              onPreviewPackageRequest={handlePreviewPackageRequest}
              workspaceFileEditor={workbenchWorkspaceFileEditor}
              onWorkspaceFileEditorChange={setWorkbenchWorkspaceFileEditor}
              externalReferenceRequest={externalReferenceRequest?.scenarioId === scenarioId ? externalReferenceRequest : undefined}
              onExternalReferenceConsumed={(requestId) => {
                setExternalReferenceRequest((current) => current?.id === requestId ? undefined : current);
              }}
              availableComponentIds={selectedRuntimeComponentIds}
              onAvailableComponentIdsChange={setSelectedRuntimeComponentIds}
            />
          ) : page === 'components' ? (
            <ComponentWorkbenchPage
              config={config}
              selectedComponentIds={selectedRuntimeComponentIds}
              onSelectedComponentIdsChange={setSelectedRuntimeComponentIds}
            />
          ) : page === 'timeline' ? (
            <TimelinePage alignmentContracts={workspaceState.alignmentContracts ?? []} events={workspaceState.timelineEvents ?? []} onOpenScenario={(id) => {
              setScenarioId(id);
              setPage('workbench');
            }} />
          ) : (
            <FeedbackInboxPage
              config={config}
              comments={workspaceState.feedbackComments ?? []}
              requests={workspaceState.feedbackRequests ?? []}
              repairRuns={workspaceState.feedbackRepairRuns ?? []}
              repairResults={workspaceState.feedbackRepairResults ?? []}
              onStatusChange={updateFeedbackStatus}
              onDelete={deleteFeedbackComments}
              onCreateRequest={createFeedbackRequest}
              onRepairRunWritten={recordFeedbackRepairRun}
              feedbackGithubRepo={config.feedbackGithubRepo}
              feedbackGithubToken={config.feedbackGithubToken}
              githubSyncedOpenIssues={workspaceState.githubSyncedOpenIssues ?? []}
              onReplaceGithubSyncedOpenIssues={replaceGithubSyncedOpenIssues}
              onImportGithubOpenIssues={importGithubOpenIssuesAsFeedback}
              onGithubIssueCreated={recordGithubIssueCreated}
              onOpenGithubSettings={() => setSettingsOpen(true)}
            />
          )}
        </div>
      </div>
      <FeedbackCaptureLayer
        page={page}
        scenarioId={scenarioId}
        session={activeSession}
        appVersion={APP_BUILD_ID}
        author={feedbackAuthor}
        onAuthorChange={setFeedbackAuthor}
        onSubmit={addFeedbackComment}
        onReference={addContextReference}
      />
      {settingsOpen ? (
        <SettingsDialog
          config={config}
          onChange={updateRuntimeConfig}
          saveState={configSaveState}
          onSave={saveRuntimeConfigNow}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
