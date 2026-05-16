import { useEffect, useMemo, useState } from 'react';
import {
  builtInScenarioIdForRuntimeInput,
  createBuiltInScenarioRecord,
  defaultBuiltInScenarioId,
} from '@sciforge/scenario-core/scenario-routing-policy';
import { scenarios, type ScenarioId, type PageId } from '../data';
import { FeedbackCaptureLayer } from '../feedback/FeedbackCaptureLayer';
import {
  importGithubOpenIssuesAsFeedback as applyGithubOpenIssuesAsFeedback,
  markFeedbackGithubIssueCreated,
} from '../feedback/githubFeedback';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  replaceGithubSyncedOpenIssuesInWorkspace,
  upsertFeedbackRepairRunInWorkspace,
  updateFeedbackCommentStatus,
} from '../feedback/feedbackWorkspace';
import {
  makeId,
  nowIso,
  type SciForgeReference,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type SciForgeConfig,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairRunRecord,
  type GithubSyncedOpenIssueRecord,
  type ObjectReference,
  type PreviewDescriptor,
  type RuntimeArtifact,
  type ScenarioInstanceId,
  type ScenarioRuntimeOverride,
  type TimelineEventRecord,
} from '../domain';
import { compactWorkspaceStateForStorage, createInitialWorkspaceState, createSession, loadWorkspaceState, saveWorkspaceState, shouldUsePersistedWorkspaceState } from '../sessionStore';
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
import { loadSciForgeConfig, normalizeWorkspaceRootPath, saveSciForgeConfig, updateConfig } from '../config';
import {
  loadFileBackedSciForgeConfig,
  loadPersistedWorkspaceState,
  persistWorkspaceState,
  saveFileBackedSciForgeConfig,
  type WorkspaceFileContent,
} from '../api/workspaceClient';
import { TimelinePage } from './AlignmentPages';
import { ComponentWorkbenchPage } from './ComponentWorkbenchPage';
import { Dashboard } from './Dashboard';
import { previewPackageAutoRunPrompt } from './ResultsRenderer';
import type { HandoffAutoRunRequest } from './results/viewPlanResolver';
import { useRuntimeHealth } from './runtimeHealthPanel';
import { cx } from './uiPrimitives';
import { resolveSearchNavigation, workbenchNavigationForScenario } from './appShell/navigation';
import { SettingsDialog, Sidebar, TopBar, type ConfigSaveState } from './appShell/ShellPanels';
import {
  APP_BUILD_ID,
  loadFeedbackAuthor,
  mergeFileBackedConfig,
  saveFeedbackAuthor,
  scenarioLabelForInstance,
} from './appShell/appHelpers';
import {
  appendTimelineEventToWorkspace,
  applySessionUpdateToWorkspace,
  createArtifactHandoffTransition,
  createPreviewPackageAutoRunRequest,
  touchWorkspaceUpdatedAt,
  workspaceRecoveryFocusForState,
} from './appShell/workspaceState';
import {
  buildArchivedSessionCountsByScenario,
  buildArchivedSessionsByScenario,
  defaultPublishedRuntimeComponentIds,
} from './sciforgeApp/appStateModels';
import { FeedbackInboxPage } from './sciforgeApp/FeedbackInboxPage';
import { Workbench } from './sciforgeApp/SciForgeWorkbench';

export function SciForgeApp() {
  const initialNavigation = useMemo(() => loadStoredAppNavigation(), []);
  const [page, setPage] = useState<PageId>(initialNavigation.page);
  const [scenarioId, setScenarioId] = useState<ScenarioInstanceId>(initialNavigation.scenarioId);
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
  const [selectedRuntimeComponentIds, setSelectedRuntimeComponentIds] = useState<string[]>(() => defaultPublishedRuntimeComponentIds());
  const [drafts, setDrafts] = useState<Record<ScenarioInstanceId, string>>(() => createBuiltInScenarioRecord(''));
  const [messageScrollTops, setMessageScrollTops] = useState<Record<ScenarioInstanceId, number>>(() => createBuiltInScenarioRecord(0));
  const [workspaceRecoveryFocusKey, setWorkspaceRecoveryFocusKey] = useState<string | undefined>();

  const sessions = workspaceState.sessionsByScenario;
  const archivedSessionsByAgent = useMemo(
    () => buildArchivedSessionsByScenario(workspaceState.archivedSessions),
    [workspaceState.archivedSessions],
  );
  const archivedCountByAgent = useMemo(
    () => buildArchivedSessionCountsByScenario(archivedSessionsByAgent),
    [archivedSessionsByAgent],
  );

  useEffect(() => {
    saveStoredAppNavigation({ page, scenarioId });
  }, [page, scenarioId]);

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
    setWorkspaceRecoveryFocusKey(undefined);
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
        if (requestedPath) {
          setWorkspaceState({ ...createInitialWorkspaceState(), workspacePath: requestedPath });
        }
        setWorkspaceStatus(requestedPath ? `未找到 ${requestedPath}/.sciforge/workspace-state.json` : '未找到最近工作区快照');
      }
    } catch (err) {
      setWorkspaceStatus(`Workspace snapshot 未加载：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWorkspaceHydrated(true);
    }
  }

  useEffect(() => {
    if (!configFileHydrated) return;
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
          if (workspacePath) {
            setWorkspaceState({ ...createInitialWorkspaceState(), workspacePath });
          }
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
  }, [configFileHydrated, config.workspacePath, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (workspaceRecoveryFocusKey) return;
    const focus = workspaceRecoveryFocusForState(workspaceState);
    setWorkspaceRecoveryFocusKey(focus ? `${focus.sessionId}:${focus.activeRunId}` : 'none');
    if (!focus) return;
    setScenarioId(focus.scenarioId);
    setPage('workbench');
  }, [workspaceHydrated, workspaceRecoveryFocusKey, workspaceState]);

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
  const activeBuiltInScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride: activeScenarioOverride });
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

const APP_NAVIGATION_STORAGE_KEY = 'sciforge.app-navigation.v1';
const validPages = new Set<PageId>(['dashboard', 'workbench', 'components', 'timeline', 'feedback']);

function appNavigationStorageKey() {
  if (typeof window === 'undefined') return APP_NAVIGATION_STORAGE_KEY;
  const host = window.location.host.trim();
  return host ? `${APP_NAVIGATION_STORAGE_KEY}.${host}` : APP_NAVIGATION_STORAGE_KEY;
}

function loadStoredAppNavigation(): { page: PageId; scenarioId: ScenarioInstanceId } {
  if (typeof window === 'undefined') return { page: 'dashboard', scenarioId: defaultBuiltInScenarioId };
  try {
    const raw = window.localStorage.getItem(appNavigationStorageKey());
    if (!raw) return { page: 'dashboard', scenarioId: defaultBuiltInScenarioId };
    const parsed = JSON.parse(raw) as { page?: unknown; scenarioId?: unknown };
    const page = typeof parsed.page === 'string' && validPages.has(parsed.page as PageId)
      ? parsed.page as PageId
      : 'dashboard';
    const scenarioId = typeof parsed.scenarioId === 'string' && parsed.scenarioId.trim()
      ? parsed.scenarioId.trim()
      : defaultBuiltInScenarioId;
    return { page, scenarioId };
  } catch {
    return { page: 'dashboard', scenarioId: defaultBuiltInScenarioId };
  }
}

function saveStoredAppNavigation(navigation: { page: PageId; scenarioId: ScenarioInstanceId }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(appNavigationStorageKey(), JSON.stringify(navigation));
  } catch {
    // Navigation restore is convenience state; workspace-state remains the durable source of truth.
  }
}
