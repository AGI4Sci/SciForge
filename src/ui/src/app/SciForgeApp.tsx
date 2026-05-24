import { useEffect, useMemo, useRef, useState } from 'react';
import {
  builtInScenarioIdForRuntimeInput,
  createBuiltInScenarioRecord,
} from '@sciforge/scenario-core/scenario-routing-policy';
import { builtInScenarioPackageRef } from '@sciforge/scenario-core/scenario-package';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { referenceComposerMarker } from '../../../../packages/support/object-references';
import { scenarios, type ScenarioId, type PageId } from '../data';
import { AnnotationSidebar } from '../feedback/AnnotationSidebar';
import { FeedbackCaptureLayer, type AnnotationReferenceInput } from '../feedback/FeedbackCaptureLayer';
import { AppContextMenuLayer } from './contextMenu/AppContextMenuLayer';
import { saveFeedbackCommentEvidenceBundle } from '../api/workspaceClient';
import {
  importGithubOpenIssuesAsFeedback as applyGithubOpenIssuesAsFeedback,
  markFeedbackGithubIssueClosed,
  markFeedbackGithubIssueCreated,
  markFeedbackGithubIssueSyncFailed,
  markFeedbackGithubIssueSyncPending,
} from '../feedback/githubFeedback';
import {
  addFeedbackCommentToWorkspace,
  createFeedbackRequestFromComments,
  deleteFeedbackCommentsFromWorkspace,
  replaceGithubSyncedOpenIssuesInWorkspace,
  restoreFeedbackCommentsInWorkspace,
  upsertFeedbackRepairActionInWorkspace,
  upsertFeedbackRepairGuidanceInWorkspace,
  upsertFeedbackRepairResultInWorkspace,
  upsertFeedbackRepairRunInWorkspace,
  updateFeedbackCommentStatus,
} from '../feedback/feedbackWorkspace';
import {
  buildFeedbackEvidenceStatus,
  buildFeedbackRuntimeSnapshot,
  buildFeedbackTargetSnapshot,
  captureFeedbackScreenshotEvidence,
  feedbackEvidenceRefs,
} from '../feedback/captureModel';
import {
  addAnnotationReferenceToDraft,
  advanceAnnotationPlanClarification,
  appendAnnotationActionRecord,
  assessAnnotationQuickAction,
  buildAnnotationPlanFeedbackComment,
  buildAnnotationPlanOnlyEnvelope,
  buildAnnotationQuickActionEnvelope,
  buildAnnotationQuickActionPrompt,
  createAnnotationPlanDraft,
  discardAnnotationPlanDraft,
  ensureAnnotationReferenceMarkers,
  loadPersistedAnnotationPlanDraft,
  markAnnotationPlanDraftSaved,
  persistAnnotationPlanDraft,
  refreshAnnotationPlanDraftContext,
  removeAnnotationReferenceFromDraft,
  updateAnnotationPlanDescription,
  type AnnotationActionRecord,
  type AnnotationPlanChoice,
  type AnnotationPlanDraft,
  type AnnotationPlanReferenceRecord,
} from '../feedback/annotationPlanModel';
import {
  makeId,
  nowIso,
  type AgentStreamEvent,
  type SciForgeSession,
  type SciForgeWorkspaceState,
  type SciForgeConfig,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackRepairActionRecord,
  type FeedbackRepairGuidanceRecord,
  type FeedbackRepairResultRecord,
  type FeedbackRepairRunRecord,
  type GithubSyncedOpenIssueRecord,
  type ObjectReference,
  type PreviewDescriptor,
  type RuntimeArtifact,
  type ScenarioInstanceId,
  type ScenarioRuntimeOverride,
  type SciForgeReference,
  type TimelineEventRecord,
} from '../domain';
import { compactWorkspaceStateForStorage, createInitialWorkspaceState, createSession, loadWorkspaceState, saveWorkspaceState, sessionActivityScore, shouldUsePersistedWorkspaceState } from '../sessionStore';
import {
  activeSessionFor as workspaceActiveSessionFor,
  clearArchivedSessions as clearScenarioArchivedSessions,
  deleteActiveChat,
  deleteArchivedSessions as deleteScenarioArchivedSessions,
  deleteSessionMessage,
  editSessionMessage,
  archiveActiveSession as archiveScenarioActiveSession,
  archiveAllActiveSessions as archiveAllScenarioActiveSessions,
  restoreArchivedSession as restoreScenarioArchivedSession,
  startNewChat,
} from '../workspace/sessionWorkspace';
import { markReusableRunInWorkspace } from '../workspace/reusableTaskWorkspace';
import { loadDesktopRuntimeConfigDefaults, loadSciForgeConfig, normalizeFeedbackGithubRepo, normalizeWorkspaceRootPath, saveSciForgeConfig, applyWorkspaceProjectSwitch, updateConfig } from '../config';
import {
  loadFileBackedSciForgeConfig,
  loadSciForgeInstanceManifest,
  loadPersistedWorkspaceState,
  loadPersistedWorkspaceStateForProject,
  persistWorkspaceState,
  saveFileBackedSciForgeConfig,
  type WorkspaceFileContent,
} from '../api/workspaceClient';
import { TimelinePage } from './AlignmentPages';
import { ComponentWorkbenchPage } from './ComponentWorkbenchPage';
import { previewPackageAutoRunPrompt } from './ResultsRenderer';
import type { HandoffAutoRunRequest } from './results/viewPlanResolver';
import { useRuntimeHealth } from './runtimeHealthPanel';
import { cx } from './uiPrimitives';
import { resolveSearchNavigation, workbenchNavigationForScenario } from './appShell/navigation';
import { SettingsPage, Sidebar, TopBar, type ConfigSaveState, type SidebarProjectThreadGroup } from './appShell/ShellPanels';
import { runPromptOrchestrator } from './chat/runOrchestrator';
import { highlightFeedbackTargetSnapshot } from './chat/referenceFocus';
import type { SettingsSectionId } from './appShell/settingsPageModel';
import { buildWorkspaceProjectActivation, findPeerInstanceForSidebarProject, isCurrentSidebarProject, removeSidebarProjectFromConfig } from './appShell/sidebarProjectModel';
import {
  buildSidebarProjectSessionsByPath,
  loadPeerSidebarProjectSessionSnapshots,
  peerSidebarProjectSessionTargets,
  type SidebarProjectSessionsByPath,
} from './appShell/sidebarProjectSessions';
import { sidebarProjectPath } from './appShell/sidebarProjectModel';
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
  updateDraftRecord,
} from './sciforgeApp/appStateModels';
import { FeedbackInboxPage } from './sciforgeApp/FeedbackInboxPage';
import { Workbench } from './sciforgeApp/SciForgeWorkbench';
import { loadStoredAppNavigation, saveStoredAppNavigation } from './sciforgeApp/navigationStorage';

const MIN_WORKSPACE_LOADING_VISIBLE_MS = 600;

function currentBrowserUrl() {
  return typeof window === 'undefined' ? 'about:blank' : window.location.href;
}

export function SciForgeApp() {
  const initialNavigation = useMemo(() => loadStoredAppNavigation(), []);
  const [page, setPage] = useState<PageId>(initialNavigation.page);
  const [scenarioId, setScenarioId] = useState<ScenarioInstanceId>(initialNavigation.scenarioId);
  const [config, setConfig] = useState<SciForgeConfig>(() => loadSciForgeConfig());
  const [configFileHydrated, setConfigFileHydrated] = useState(false);
  const [detectedFeedbackGithubRepo, setDetectedFeedbackGithubRepo] = useState<string | undefined>();
  const returnPageRef = useRef<PageId>(initialNavigation.page);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');
  const [workspaceState, setWorkspaceState] = useState<SciForgeWorkspaceState>(() => {
    const state = loadWorkspaceState();
    const loadedConfig = loadSciForgeConfig();
    return { ...state, workspacePath: normalizeWorkspaceRootPath(loadedConfig.workspacePath || state.workspacePath) };
  });
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workspaceLoadingVisible, setWorkspaceLoadingVisible] = useState(true);
  const [handoffAutoRun, setHandoffAutoRun] = useState<HandoffAutoRunRequest | undefined>();
  const [workbenchWorkspaceFileEditor, setWorkbenchWorkspaceFileEditor] = useState<{ file: WorkspaceFileContent; draft: string } | null>(null);
  const [feedbackAuthor, setFeedbackAuthor] = useState(() => loadFeedbackAuthor());
  const [feedbackAnnotationModeActive, setFeedbackAnnotationModeActive] = useState(false);
  const [annotationSidebarOpen, setAnnotationSidebarOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationPlanDraft | null>(() => {
    const draft = loadPersistedAnnotationPlanDraft();
    return draft ? ensureAnnotationReferenceMarkers(draft) : null;
  });
  const [annotationStreamEvents, setAnnotationStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [annotationQuickActionRunning, setAnnotationQuickActionRunning] = useState(false);
  const [configSaveState, setConfigSaveState] = useState<ConfigSaveState>({ status: 'idle' });
  const [scenarioOverrides, setScenarioOverrides] = useState<Partial<Record<ScenarioInstanceId, ScenarioRuntimeOverride>>>({});
  const [selectedRuntimeComponentIds, setSelectedRuntimeComponentIds] = useState<string[]>(() => defaultPublishedRuntimeComponentIds());
  const [drafts, setDrafts] = useState<Record<ScenarioInstanceId, string>>(() => createBuiltInScenarioRecord(''));
  const [messageScrollTops, setMessageScrollTops] = useState<Record<ScenarioInstanceId, number>>(() => createBuiltInScenarioRecord(0));
  const [workspaceRecoveryFocusKey, setWorkspaceRecoveryFocusKey] = useState<string | undefined>();
  const [peerProjectSessionsByPath, setPeerProjectSessionsByPath] = useState<SidebarProjectSessionsByPath>({});
  const [pendingSidebarThread, setPendingSidebarThread] = useState<{
    scenarioId: ScenarioInstanceId;
    sessionId: string;
    workspacePath: string;
  } | null>(null);
  const [pendingSidebarNewChat, setPendingSidebarNewChat] = useState<{
    scenarioId: ScenarioInstanceId;
    workspacePath: string;
  } | null>(null);
  const [chatReferenceRequest, setChatReferenceRequest] = useState<{ id: string; reference: SciForgeReference } | null>(null);

  const sessions = workspaceState.sessionsByScenario;
  const archivedSessionsByAgent = useMemo(
    () => buildArchivedSessionsByScenario(workspaceState.archivedSessions),
    [workspaceState.archivedSessions],
  );
  const archivedCountByAgent = useMemo(
    () => buildArchivedSessionCountsByScenario(archivedSessionsByAgent),
    [archivedSessionsByAgent],
  );
  const peerSessionRefreshKey = useMemo(
    () => JSON.stringify(peerSidebarProjectSessionTargets(config)),
    [config],
  );
  const projectSessionsByPath = useMemo(
    () => buildSidebarProjectSessionsByPath(config, workspaceState, peerProjectSessionsByPath),
    [config, workspaceState, peerProjectSessionsByPath],
  );

  useEffect(() => {
    if (page !== 'settings') saveStoredAppNavigation({ page, scenarioId });
  }, [page, scenarioId]);

  function openSettings(section: SettingsSectionId = 'general') {
    returnPageRef.current = page === 'settings' ? returnPageRef.current : page;
    setSettingsSection(section);
    setPage('settings');
  }

  function closeSettings() {
    setPage(returnPageRef.current);
  }

  useEffect(() => {
    if (!configFileHydrated) return;
    let cancelled = false;
    void loadPeerSidebarProjectSessionSnapshots(config).then((snapshots) => {
      if (!cancelled) setPeerProjectSessionsByPath(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [config, configFileHydrated, peerSessionRefreshKey]);

	  useEffect(() => {
	    let cancelled = false;
	    Promise.all([
	      loadFileBackedSciForgeConfig(config),
	      loadDesktopRuntimeConfigDefaults(),
	    ])
	      .then(([fileConfig, desktopRuntimeConfig]) => {
	        if (cancelled) return;
	        if (fileConfig || desktopRuntimeConfig) {
	          setConfig((current) => {
	            const fileMerged = fileConfig ? mergeFileBackedConfig(current, fileConfig) : current;
	            const next = desktopRuntimeConfig ? updateConfig(fileMerged, desktopRuntimeConfig) : fileMerged;
	            saveSciForgeConfig(next);
	            return next;
	          });
	          const nextWorkspacePath = desktopRuntimeConfig?.workspacePath || fileConfig?.workspacePath;
	          if (nextWorkspacePath) {
	            setWorkspaceState((current) => ({
	              ...current,
	              workspacePath: normalizeWorkspaceRootPath(nextWorkspacePath || current.workspacePath),
	            }));
	          }
	          setWorkspaceStatus(desktopRuntimeConfig
	            ? '已从 Electron runtime config 加载桌面运行时配置'
	            : '已从 config.local.json 加载统一配置');
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
    if (pendingSidebarThread || pendingSidebarNewChat) return;
    if (workspaceRecoveryFocusKey) return;
    const focus = workspaceRecoveryFocusForState(workspaceState);
    setWorkspaceRecoveryFocusKey(focus ? `${focus.sessionId}:${focus.activeRunId}` : 'none');
    if (!focus) return;
    setScenarioId(focus.scenarioId);
    setPage('workbench');
  }, [workspaceHydrated, workspaceRecoveryFocusKey, workspaceState, pendingSidebarThread, pendingSidebarNewChat]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    if (sidebarProjectPath(config.workspacePath) !== sidebarProjectPath(workspaceState.workspacePath)) return;
    saveWorkspaceState(workspaceState);
    if (workspaceState.workspacePath.trim()) {
      persistWorkspaceState(compactWorkspaceStateForStorage(workspaceState), config)
        .then(() => setWorkspaceStatus(`已同步到 ${workspaceState.workspacePath}/.sciforge`))
        .catch((err) => setWorkspaceStatus(`Workspace writer 未连接：${err instanceof Error ? err.message : String(err)}`));
    }
  }, [workspaceState, config, workspaceHydrated]);

  useEffect(() => {
    if (!configFileHydrated) return;
    let cancelled = false;
    loadSciForgeInstanceManifest(config)
      .then((manifest) => {
        if (cancelled) return;
        setDetectedFeedbackGithubRepo(normalizeFeedbackGithubRepo(manifest.repo.remote));
      })
      .catch(() => {
        if (!cancelled) setDetectedFeedbackGithubRepo(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [configFileHydrated, config.workspacePath, config.workspaceWriterBaseUrl]);

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

  const workspaceLoadingActive = !configFileHydrated || !workspaceHydrated;
  useEffect(() => {
    if (workspaceLoadingActive) {
      setWorkspaceLoadingVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setWorkspaceLoadingVisible(false), MIN_WORKSPACE_LOADING_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [workspaceLoadingActive]);

  useEffect(() => {
    if (page !== 'workbench') setWorkbenchWorkspaceFileEditor(null);
  }, [page]);

  useEffect(() => {
    saveFeedbackAuthor(feedbackAuthor);
  }, [feedbackAuthor]);

  useEffect(() => {
    persistAnnotationPlanDraft(annotationDraft);
  }, [annotationDraft]);

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
    saveFeedbackCommentEvidenceBundle(config, comment)
      .then((bundle) => {
        updateWorkspace((current) => ({
          ...current,
          feedbackComments: (current.feedbackComments ?? []).map((item) => item.id === comment.id
            ? {
              ...item,
              evidenceBundleRef: bundle.evidenceBundleRef || item.evidenceBundleRef,
              rawScreenshotRef: bundle.rawScreenshotRef || item.rawScreenshotRef,
              annotatedScreenshotRef: bundle.annotatedScreenshotRef || item.annotatedScreenshotRef,
              evidenceAssets: bundle.evidenceAssets?.length ? bundle.evidenceAssets : item.evidenceAssets,
              screenshot: item.screenshot
                ? {
                  ...item.screenshot,
                  rawScreenshotRef: bundle.rawScreenshotRef || item.screenshot.rawScreenshotRef,
                  annotatedScreenshotRef: bundle.annotatedScreenshotRef || item.screenshot.annotatedScreenshotRef,
                }
                : item.screenshot,
            }
            : item),
        }));
        setWorkspaceStatus(`反馈证据已写入 ${bundle.evidenceBundleRef}`);
      })
      .catch((error) => {
        setWorkspaceStatus(`反馈已保存在本地状态，但证据 bundle 未落盘：${error instanceof Error ? error.message : String(error)}`);
      });
  }

  function annotationDraftContext() {
    return {
      page,
      scenarioId,
      sessionId: activeSession.sessionId,
      url: currentBrowserUrl(),
    };
  }

  function ensureAnnotationDraft(current: AnnotationPlanDraft | null) {
    const context = annotationDraftContext();
    if (current && current.status !== 'saved' && current.status !== 'discarded') {
      return ensureAnnotationReferenceMarkers(refreshAnnotationPlanDraftContext(current, context));
    }
    return createAnnotationPlanDraft(context);
  }

  function toggleAnnotationSelectionMode() {
    setAnnotationSidebarOpen(true);
    setAnnotationDraft((current) => ensureAnnotationDraft(current));
    setFeedbackAnnotationModeActive((current) => !current);
  }

  function closeAnnotationSidebar() {
    setAnnotationSidebarOpen(false);
    setFeedbackAnnotationModeActive(false);
  }

  function handleAnnotationReference(input: AnnotationReferenceInput) {
    setAnnotationSidebarOpen(true);
    setFeedbackAnnotationModeActive(true);
    setAnnotationDraft((current) => addAnnotationReferenceToDraft(ensureAnnotationDraft(current), input));
  }

  function handleAnnotationDescriptionChange(description: string) {
    setAnnotationSidebarOpen(true);
    setAnnotationDraft((current) => updateAnnotationPlanDescription(ensureAnnotationDraft(current), description));
  }

  async function runAnnotationPlanOnlyTurn(content: string, choice?: AnnotationPlanChoice) {
    const prompt = content.trim();
    if (!prompt) return;
    const draftForTurn = ensureAnnotationDraft(annotationDraft);
    const baseScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride: activeScenarioOverride });
    const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
    const queuedEvent: AgentStreamEvent = {
      id: makeId('evt'),
      type: 'queued',
      label: '已提交',
      detail: prompt,
      createdAt: nowIso(),
    };
    setAnnotationStreamEvents([queuedEvent]);
    const emitAnnotationEvent = (event: AgentStreamEvent) => {
      setAnnotationStreamEvents((current) => [...current, event].slice(-48));
    };
    const result = await runPromptOrchestrator({
      prompt,
      baseSession: activeSession,
      references: draftForTurn.references.map((item) => item.reference),
      scenarioId,
      baseScenarioId,
      scenarioName: scenario.name,
      scenarioDomain: scenario.domain,
      role: 'annotation planner',
      config,
      scenarioOverride: activeScenarioOverride,
      availableComponentIds: selectedRuntimeComponentIds,
      defaultComponentIds: activeScenarioOverride?.defaultComponents?.length
        ? activeScenarioOverride.defaultComponents
        : SCENARIO_SPECS[baseScenarioId].componentPolicy.defaultComponents,
      scenarioPackageRef: activeScenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId),
      skillPlanRef: activeScenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.annotation-plan-only`,
      uiPlanRef: activeScenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.annotation-plan-only`,
      streamEvents: [],
      signal: new AbortController().signal,
      userAbortRequested: () => false,
      activeSession: () => activeSession,
      onStreamEvent: emitAnnotationEvent,
      turnMode: 'annotation-plan-only',
      conversationEnvelope: buildAnnotationPlanOnlyEnvelope(draftForTurn),
    });
    const assistantContent = result.status === 'completed'
      ? result.finalResponse.message.content
      : `反馈侧栏整理失败：${result.message}`;
    setAnnotationDraft((current) => current ? advanceAnnotationPlanClarification(current, { content: prompt, choice, assistantContent }) : current);
    setWorkspaceStatus('反馈侧栏已整理当前意图；可继续预览、小改动或保存到收件箱。');
  }

  function handleAnnotationClarify(content: string) {
    void runAnnotationPlanOnlyTurn(content);
  }

  function handleAnnotationChoice(choice: AnnotationPlanChoice) {
    void runAnnotationPlanOnlyTurn(choice.prompt, choice);
  }

  function focusAnnotationReference(reference: AnnotationPlanReferenceRecord) {
    highlightFeedbackTargetSnapshot(reference.target, reference.reference, reference.selectedText);
  }

  async function runAnnotationQuickAction() {
    const draftForTurn = ensureAnnotationDraft(annotationDraft);
    const assessment = assessAnnotationQuickAction(draftForTurn);
    const now = nowIso();
    if (!assessment.eligible) {
      const draftWithRoute = appendAnnotationActionRecord(draftForTurn, {
        action: 'send-to-inbox',
        status: 'blocked',
        summary: assessment.reason,
        risk: assessment.risk,
        createdAt: now,
      });
      setAnnotationDraft(draftWithRoute);
      setWorkspaceStatus(`这条反馈需要收件箱确认：${assessment.reason}`);
      await persistAnnotationDraftToInbox(draftWithRoute, {
        action: 'send-to-inbox',
        openInboxAfterSave: true,
        statusText: '复杂改动已保存到反馈收件箱',
      });
      return;
    }

    const draftWithRequest = appendAnnotationActionRecord(draftForTurn, {
      action: 'apply-small-change',
      status: 'requested',
      summary: assessment.reason,
      risk: assessment.risk,
      createdAt: now,
    });
    const prompt = buildAnnotationQuickActionPrompt(draftWithRequest, assessment);
    const baseScenarioId = builtInScenarioIdForRuntimeInput({ scenarioId, scenarioOverride: activeScenarioOverride });
    const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
    const queuedEvent: AgentStreamEvent = {
      id: makeId('evt'),
      type: 'queued',
      label: '小改动已提交',
      detail: assessment.reason,
      createdAt: nowIso(),
    };
    setAnnotationDraft(draftWithRequest);
    setAnnotationQuickActionRunning(true);
    setAnnotationStreamEvents([queuedEvent]);
    const emitAnnotationEvent = (event: AgentStreamEvent) => {
      setAnnotationStreamEvents((current) => [...current, event].slice(-48));
    };
    try {
      const result = await runPromptOrchestrator({
        prompt,
        baseSession: activeSession,
        references: draftWithRequest.references.map((item) => item.reference),
        scenarioId,
        baseScenarioId,
        scenarioName: scenario.name,
        scenarioDomain: scenario.domain,
        role: 'annotation quick action',
        config,
        scenarioOverride: activeScenarioOverride,
        availableComponentIds: selectedRuntimeComponentIds,
        defaultComponentIds: activeScenarioOverride?.defaultComponents?.length
          ? activeScenarioOverride.defaultComponents
          : SCENARIO_SPECS[baseScenarioId].componentPolicy.defaultComponents,
        scenarioPackageRef: activeScenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId),
        skillPlanRef: activeScenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.annotation-quick-action`,
        uiPlanRef: activeScenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.annotation-quick-action`,
        streamEvents: annotationStreamEvents,
        signal: new AbortController().signal,
        userAbortRequested: () => false,
        activeSession: () => activeSession,
        onStreamEvent: emitAnnotationEvent,
        turnMode: 'annotation-quick-action',
        conversationEnvelope: buildAnnotationQuickActionEnvelope(draftWithRequest, assessment),
      });
      const assistantContent = result.status === 'completed'
        ? result.finalResponse.message.content
        : `快捷修改未完成：${result.message}`;
      const needsInbox = result.status !== 'completed'
        || /\bNEEDS_INBOX\b|需要.*收件箱|未修改|没有修改|no files changed|no changes/i.test(assistantContent);
      const runtimeRunId = result.status === 'completed' ? result.finalResponse.run.id : undefined;
      const draftWithResult = appendAnnotationActionRecord(draftWithRequest, {
        action: 'apply-small-change',
        status: needsInbox ? 'blocked' : 'completed',
        summary: needsInbox ? '快捷修改未应用，转入收件箱确认。' : '低风险小改动已由侧栏提交执行。',
        risk: assessment.risk,
        writesApplied: !needsInbox,
        runtimeRunId,
        createdAt: nowIso(),
      });
      const nextDraft = advanceAnnotationPlanClarification(draftWithResult, {
        content: '应用小改动',
        choice: {
          id: 'apply-small-change',
          label: '应用小改动',
          prompt,
        },
        assistantContent,
      });
      setAnnotationDraft(nextDraft);
      await persistAnnotationDraftToInbox(nextDraft, {
        action: needsInbox ? 'send-to-inbox' : 'apply-small-change',
        statusText: needsInbox ? '快捷修改未应用，已转入反馈收件箱' : '低风险小改动结果已记录到反馈收件箱',
      });
    } catch (error) {
      const draftWithFailure = appendAnnotationActionRecord(draftWithRequest, {
        action: 'apply-small-change',
        status: 'blocked',
        summary: error instanceof Error ? error.message : String(error),
        risk: assessment.risk,
        writesApplied: false,
        createdAt: nowIso(),
      });
      setAnnotationDraft(draftWithFailure);
      await persistAnnotationDraftToInbox(draftWithFailure, {
        action: 'send-to-inbox',
        statusText: '快捷修改被阻塞，已转入反馈收件箱',
      });
    } finally {
      setAnnotationQuickActionRunning(false);
    }
  }

  function discardAnnotationDraft() {
    setAnnotationDraft((current) => current ? discardAnnotationPlanDraft(current) : current);
    setAnnotationDraft(null);
    setAnnotationSidebarOpen(false);
    setFeedbackAnnotationModeActive(false);
  }

  async function saveAnnotationDraft(options: { openInboxAfterSave?: boolean; action?: AnnotationActionRecord['action']; statusText?: string } = {}) {
    if (!annotationDraft || annotationDraft.status === 'saved') return;
    await persistAnnotationDraftToInbox(annotationDraft, {
      action: options.action ?? 'save-feedback',
      openInboxAfterSave: options.openInboxAfterSave,
      statusText: options.statusText ?? '反馈已保存到收件箱',
    });
  }

  async function persistAnnotationDraftToInbox(
    draftToSave: AnnotationPlanDraft,
    options: { openInboxAfterSave?: boolean; action?: AnnotationActionRecord['action']; statusText?: string } = {},
  ) {
    if (draftToSave.status === 'saved') return;
    setAnnotationSaving(true);
    try {
      const now = nowIso();
      const feedbackId = makeId('feedback');
      const refs = feedbackEvidenceRefs(feedbackId);
      const draftForComment = appendAnnotationActionRecord(draftToSave, {
        action: options.action ?? 'save-feedback',
        status: 'saved',
        summary: options.statusText ?? '反馈已保存到收件箱',
        feedbackId,
        createdAt: now,
      });
      const firstReference = draftForComment.references[0];
      const target = firstReference?.target ?? buildFeedbackTargetSnapshot(document.body);
      const annotations = draftForComment.references.map((item) => ({
        label: referenceComposerMarker(item.reference),
        target: item.target,
      }));
      const screenshot = await captureFeedbackScreenshotEvidence(target, now, {
        annotationLabel: annotations[0]?.label ?? 'plan',
        annotations: annotations.length ? annotations : [{ label: 'plan', target }],
      });
      const screenshotWithRefs = screenshot
        ? {
          ...screenshot,
          rawScreenshotRef: refs.rawScreenshotRef,
          annotatedScreenshotRef: refs.annotatedScreenshotRef,
        }
        : undefined;
      const runtime = buildFeedbackRuntimeSnapshot({
        page,
        scenarioId,
        session: activeSession,
        url: currentBrowserUrl(),
        appVersion: APP_BUILD_ID,
      });
      const evidenceStatus = buildFeedbackEvidenceStatus({
        screenshot: screenshotWithRefs,
        target,
        runtime,
        diagnostics: screenshotWithRefs ? [] : ['screenshot capture failed; saved annotation plan target and runtime evidence only'],
      });
      const comment = buildAnnotationPlanFeedbackComment({
        draft: draftForComment,
        feedbackId,
        now,
        author: feedbackAuthor,
        target,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        runtime,
        screenshot: screenshotWithRefs,
        refs,
        evidenceStatus,
      });
      addFeedbackComment(comment);
      setAnnotationDraft((current) => current ? markAnnotationPlanDraftSaved(current.id === draftForComment.id ? draftForComment : current, feedbackId, now) : current);
      setFeedbackAnnotationModeActive(false);
      setWorkspaceStatus(`${options.statusText ?? '反馈已保存到收件箱'}：${feedbackId}`);
      if (options.openInboxAfterSave) {
        setPage('feedback');
        setAnnotationSidebarOpen(false);
      }
    } catch (error) {
      setWorkspaceStatus(`反馈未保存：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAnnotationSaving(false);
    }
  }

  function openFeedbackInboxFromAnnotation() {
    setPage('feedback');
    setAnnotationSidebarOpen(false);
    setFeedbackAnnotationModeActive(false);
  }

  function updateFeedbackStatus(ids: string[], status: FeedbackCommentStatus) {
    if (!ids.length) return;
    updateWorkspace((current) => updateFeedbackCommentStatus(current, ids, status, nowIso()));
  }

  function deleteFeedbackComments(ids: string[]) {
    if (!ids.length) return;
    updateWorkspace((current) => deleteFeedbackCommentsFromWorkspace(current, ids));
  }

  function restoreFeedbackComments(ids: string[]) {
    if (!ids.length) return;
    updateWorkspace((current) => restoreFeedbackCommentsInWorkspace(current, ids));
  }

  function createFeedbackRequest(ids: string[], title: string) {
    if (!ids.length) return;
    updateWorkspace((current) => createFeedbackRequestFromComments(current, ids, title));
  }

  function recordFeedbackRepairRun(run: FeedbackRepairRunRecord) {
    updateWorkspace((current) => upsertFeedbackRepairRunInWorkspace(current, run));
  }

  function recordFeedbackRepairResult(result: FeedbackRepairResultRecord) {
    updateWorkspace((current) => upsertFeedbackRepairResultInWorkspace(current, result));
  }

  function recordFeedbackRepairAction(action: FeedbackRepairActionRecord) {
    updateWorkspace((current) => upsertFeedbackRepairActionInWorkspace(current, action));
  }

  function recordFeedbackRepairGuidance(guidance: FeedbackRepairGuidanceRecord) {
    updateWorkspace((current) => upsertFeedbackRepairGuidanceInWorkspace(current, guidance));
  }

  function recordFeedbackEvidenceUpload(comment: FeedbackCommentRecord) {
    updateWorkspace((current) => ({
      ...current,
      feedbackComments: (current.feedbackComments ?? []).map((item) => item.id === comment.id
        ? {
          ...item,
          evidenceAssets: comment.evidenceAssets?.length ? comment.evidenceAssets : item.evidenceAssets,
          updatedAt: comment.updatedAt || item.updatedAt,
        }
        : item),
    }));
  }

  function replaceGithubSyncedOpenIssues(issues: GithubSyncedOpenIssueRecord[]) {
    updateWorkspace((current) => replaceGithubSyncedOpenIssuesInWorkspace(current, issues, nowIso()));
  }

  function recordGithubIssueCreated(commentIds: string[], issue: { number: number; htmlUrl: string; title: string }) {
    updateWorkspace((current) => markFeedbackGithubIssueCreated(current, commentIds, issue));
  }

  function recordGithubIssueClosed(commentIds: string[], issue: { number: number; htmlUrl?: string; title?: string; commentUrl?: string; updatedAt?: string }) {
    updateWorkspace((current) => markFeedbackGithubIssueClosed(current, commentIds, issue));
  }

  function recordGithubIssueSyncPending(commentIds: string[]) {
    updateWorkspace((current) => markFeedbackGithubIssueSyncPending(current, commentIds));
  }

  function recordGithubIssueSyncFailed(commentIds: string[], error: unknown) {
    updateWorkspace((current) => markFeedbackGithubIssueSyncFailed(current, commentIds, error));
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
    void hydrateWorkspaceSnapshot(workspacePath, nextConfig, 'force');
  }

  function activateWorkspaceProject(
    project: Parameters<typeof buildWorkspaceProjectActivation>[1],
    thread?: { scenarioId: ScenarioInstanceId; sessionId: string },
  ) {
    const targetPath = sidebarProjectPath(project.detail || config.workspacePath);
    const patch = buildWorkspaceProjectActivation(config, project);
    if (patch) {
      const departingPath = sidebarProjectPath(config.workspacePath);
      if (departingPath) {
        setPeerProjectSessionsByPath((current) => ({
          ...current,
          [departingPath]: {
            sessionsByScenario: workspaceState.sessionsByScenario,
            archivedSessions: workspaceState.archivedSessions ?? [],
          },
        }));
      }
    }
    if (thread) {
      const needsSwitch = Boolean(patch) || sidebarProjectPath(config.workspacePath) !== targetPath;
      if (needsSwitch) {
        setPendingSidebarThread({
          ...thread,
          workspacePath: sidebarProjectPath(patch?.workspacePath || targetPath),
        });
      } else {
        restoreArchivedSession(thread.scenarioId, thread.sessionId);
        setScenarioId(thread.scenarioId);
        setPage('workbench');
        return;
      }
    }
    if (!patch) return;
    updateRuntimeConfig(patch);
  }

  function updateRuntimeConfig(patch: Partial<SciForgeConfig>) {
    setConfig((current) => {
      const next = ('workspacePath' in patch && !('workspaceWriterBaseUrl' in patch))
        ? applyWorkspaceProjectSwitch(current, patch)
        : updateConfig(current, patch);
      saveSciForgeConfig(next);
      if ('workspacePath' in patch) {
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
        setWorkspaceStatus('设置已保存并对下一次 Codex Runtime 请求生效');
      })
      .catch((err) => {
        const message = `设置未保存：${err instanceof Error ? err.message : String(err)}`;
        setConfigSaveState({ status: 'error', message });
        setWorkspaceStatus(message);
      });
  }

  function updateDraft(nextScenarioId: ScenarioInstanceId, value: string) {
    setDrafts((current) => updateDraftRecord(current, nextScenarioId, value));
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

  function startProjectNewChat(project: SidebarProjectThreadGroup) {
    if (project.current) {
      setScenarioId(scenarioId);
      setPage('workbench');
      newChat(scenarioId);
      return;
    }
    const targetPath = sidebarProjectPath(project.detail || config.workspacePath);
    setPendingSidebarNewChat({ scenarioId, workspacePath: targetPath });
    activateWorkspaceProject(project);
  }

  useEffect(() => {
    if (!pendingSidebarThread || !workspaceHydrated) return;
    const currentPath = normalizeWorkspaceRootPath(config.workspacePath);
    if (currentPath !== pendingSidebarThread.workspacePath) return;
    const { scenarioId: nextScenarioId, sessionId } = pendingSidebarThread;
    const active = workspaceState.sessionsByScenario[nextScenarioId];
    if (active?.sessionId !== sessionId) {
      restoreArchivedSession(nextScenarioId, sessionId);
    }
    setScenarioId(nextScenarioId);
    setPage('workbench');
    setPendingSidebarThread(null);
  }, [pendingSidebarThread, workspaceHydrated, config.workspacePath, workspaceState.sessionsByScenario]);

  useEffect(() => {
    if (!pendingSidebarNewChat || !workspaceHydrated) return;
    const currentPath = normalizeWorkspaceRootPath(config.workspacePath);
    if (currentPath !== pendingSidebarNewChat.workspacePath) return;
    const { scenarioId: nextScenarioId } = pendingSidebarNewChat;
    setScenarioId(nextScenarioId);
    setPage('workbench');
    newChat(nextScenarioId);
    setPendingSidebarNewChat(null);
  }, [pendingSidebarNewChat, workspaceHydrated, config.workspacePath]);

  function archiveThread(nextScenarioId: ScenarioInstanceId, sessionId: string) {
    updateWorkspace((current) => archiveScenarioActiveSession(
      current,
      nextScenarioId,
      sessionId,
      `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
    ));
  }

  function archiveAllChats() {
    updateWorkspace((current) => archiveAllScenarioActiveSessions(
      current,
      (nextScenarioId) => `${scenarioLabelForInstance(nextScenarioId)} 新聊天`,
    ));
  }

  function workspaceHasActiveChats(
    state: Pick<SciForgeWorkspaceState, 'sessionsByScenario'>,
  ) {
    return Object.values(state.sessionsByScenario).some((session) => session && sessionActivityScore(session) > 0);
  }

  async function archiveSidebarProjectChats(project: SidebarProjectThreadGroup) {
    if (isCurrentSidebarProject(config, project)) {
      if (!workspaceHasActiveChats(workspaceState)) {
        throw new Error(`${project.label} 没有可归档的活跃对话。`);
      }
      archiveAllChats();
      return;
    }

    const targetPath = sidebarProjectPath(project.detail);
    const peer = findPeerInstanceForSidebarProject(config, project);
    if (!targetPath || !peer) {
      throw new Error(`${project.label} 没有可归档的活跃对话。`);
    }

    const writerBaseUrl = peer.workspaceWriterUrl?.trim() || config.workspaceWriterBaseUrl;
    const cachedBundle = projectSessionsByPath[targetPath];
    let state = await loadPersistedWorkspaceStateForProject(targetPath, config, writerBaseUrl);
    if (!state && cachedBundle) {
      state = {
        ...createInitialWorkspaceState(),
        workspacePath: targetPath,
        sessionsByScenario: cachedBundle.sessionsByScenario as SciForgeWorkspaceState['sessionsByScenario'],
        archivedSessions: cachedBundle.archivedSessions ?? [],
        updatedAt: nowIso(),
      };
    }
    if (!state || !workspaceHasActiveChats(state)) {
      throw new Error(`${project.label} 没有可归档的活跃对话。`);
    }

    const nextState = archiveAllScenarioActiveSessions(
      state,
      (scenarioId) => `${scenarioLabelForInstance(scenarioId)} 新聊天`,
    );
    await persistWorkspaceState(compactWorkspaceStateForStorage(nextState), {
      ...config,
      workspacePath: targetPath,
      workspaceWriterBaseUrl: writerBaseUrl,
    });
    setPeerProjectSessionsByPath((current) => ({
      ...current,
      [targetPath]: {
        sessionsByScenario: nextState.sessionsByScenario,
        archivedSessions: nextState.archivedSessions ?? [],
      },
    }));
  }

  function removeSidebarProject(project: SidebarProjectThreadGroup) {
    const patch = removeSidebarProjectFromConfig(config, project);
    if (!patch) throw new Error('当前项目不能从侧栏移除。');
    updateRuntimeConfig(patch);
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

  function clearAllArchivedSessions() {
    updateWorkspace((current) => ({ ...current, archivedSessions: [] }));
  }

  function restoreArchivedAndOpen(nextScenarioId: ScenarioInstanceId, sessionId: string) {
    restoreArchivedSession(nextScenarioId, sessionId);
    setScenarioId(nextScenarioId);
    setPage('workbench');
    closeSettings();
  }

  function handleSearch(query: string) {
    const target = resolveSearchNavigation(query, scenarios);
    if (!target) return;
    if (target.scenarioId) setScenarioId(target.scenarioId);
    setPage(target.page);
  }

  function requestChatReference(reference: SciForgeReference) {
    setChatReferenceRequest({ id: `chat-ref-${Date.now()}`, reference });
    if (page !== 'workbench') setPage('workbench');
  }

  function consumeChatReferenceRequest(requestId: string) {
    setChatReferenceRequest((current) => (current?.id === requestId ? null : current));
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
      {page === 'settings' ? (
        <SettingsPage
          config={config}
          onChange={updateRuntimeConfig}
          saveState={configSaveState}
          onSave={saveRuntimeConfigNow}
          onBack={closeSettings}
          initialSection={settingsSection}
          archivedSessions={workspaceState.archivedSessions ?? []}
          scenarioLabelFor={scenarioLabelForInstance}
          onRestoreArchivedSession={restoreArchivedAndOpen}
          onDeleteArchivedSessions={deleteArchivedSessions}
          onClearArchivedSessions={clearAllArchivedSessions}
        />
      ) : (
        <>
      <Sidebar
        page={page}
        setPage={setPage}
        scenarioId={scenarioId}
        setScenarioId={setScenarioId}
        config={config}
        sessionsByScenario={sessions}
        onProjectNewChat={startProjectNewChat}
        onArchiveThread={archiveThread}
        onArchiveProjectChats={archiveSidebarProjectChats}
        onArchiveAllChats={archiveAllChats}
        onRemoveSidebarProject={removeSidebarProject}
        onSearchNavigate={handleSearch}
        onSettingsOpen={() => openSettings()}
        workspaceStatus={workspaceStatus}
        onWorkspacePathChange={setWorkspacePath}
        onWorkspaceProjectActivate={activateWorkspaceProject}
        projectSessionsByPath={projectSessionsByPath}
        activeWorkspacePath={workspaceState.workspacePath}
        deferWorkbenchFilePreview={page === 'workbench'}
        onWorkbenchFileOpened={(file) => setWorkbenchWorkspaceFileEditor({ file, draft: file.content })}
        workbenchEditorFilePath={workbenchWorkspaceFileEditor?.file.path ?? null}
        onWorkbenchEditorPathInvalidated={() => setWorkbenchWorkspaceFileEditor(null)}
        onReferenceToChat={requestChatReference}
      />
      <div className="main-shell">
        <TopBar
          onSearch={handleSearch}
          onSettingsOpen={() => openSettings()}
          theme={config.theme}
          onThemeToggle={() => updateRuntimeConfig({ theme: (config.theme ?? 'dark') === 'dark' ? 'light' : 'dark' })}
          healthItems={appHealthItems}
          annotationModeActive={feedbackAnnotationModeActive}
          onAnnotationModeToggle={toggleAnnotationSelectionMode}
        />
        <div className="content-shell">
          {page === 'workbench' ? (
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
              onExternalReferenceConsumed={consumeChatReferenceRequest}
              externalReferenceRequest={chatReferenceRequest ?? undefined}
              availableComponentIds={selectedRuntimeComponentIds}
              onAvailableComponentIdsChange={setSelectedRuntimeComponentIds}
            />
          ) : page === 'components' ? (
            <ComponentWorkbenchPage />
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
              repairActions={workspaceState.feedbackRepairActions ?? []}
              repairGuidance={workspaceState.feedbackRepairGuidance ?? []}
              onStatusChange={updateFeedbackStatus}
              onDelete={deleteFeedbackComments}
              onRestore={restoreFeedbackComments}
              onCreateRequest={createFeedbackRequest}
              onRepairRunWritten={recordFeedbackRepairRun}
              onRepairResultWritten={recordFeedbackRepairResult}
              onRepairActionWritten={recordFeedbackRepairAction}
              onRepairGuidanceWritten={recordFeedbackRepairGuidance}
              onFeedbackEvidenceUploaded={recordFeedbackEvidenceUpload}
              feedbackGithubRepo={config.feedbackGithubRepo}
              detectedGithubRepo={detectedFeedbackGithubRepo}
              feedbackGithubToken={config.feedbackGithubToken}
              workspaceLoading={workspaceLoadingVisible}
              workspaceLoadingDetail={!configFileHydrated
                ? '正在加载 config.local.json；反馈列表会先使用浏览器缓存，GitHub/repair 操作等待配置完成。'
                : !workspaceHydrated
                  ? '正在恢复 .sciforge/workspace-state.json；反馈计数、筛选和操作范围会在加载完成后刷新。'
                  : workspaceLoadingVisible
                    ? '正在完成 workspace 状态刷新；反馈计数、筛选和操作范围已经恢复，将在片刻后切换为 loaded。'
                    : workspaceStatus || 'workspace snapshot loaded'}
              githubSyncedOpenIssues={workspaceState.githubSyncedOpenIssues ?? []}
              onReplaceGithubSyncedOpenIssues={replaceGithubSyncedOpenIssues}
              onImportGithubOpenIssues={importGithubOpenIssuesAsFeedback}
              onGithubIssueSyncPending={recordGithubIssueSyncPending}
              onGithubIssueSyncFailed={recordGithubIssueSyncFailed}
              onGithubIssueCreated={recordGithubIssueCreated}
              onGithubIssueClosed={recordGithubIssueClosed}
              onOpenGithubSettings={() => openSettings('feedback')}
            />
          )}
        </div>
      </div>
      <AnnotationSidebar
        open={annotationSidebarOpen}
        draft={annotationDraft}
        selectionActive={feedbackAnnotationModeActive}
        saving={annotationSaving}
        page={page}
        onClose={closeAnnotationSidebar}
        onToggleSelection={toggleAnnotationSelectionMode}
        onDescriptionChange={handleAnnotationDescriptionChange}
        onClarify={handleAnnotationClarify}
        onChoice={handleAnnotationChoice}
        onRemoveReference={(referenceId) => setAnnotationDraft((current) => current ? removeAnnotationReferenceFromDraft(current, referenceId) : current)}
        onReferenceFocus={focusAnnotationReference}
        onDiscard={discardAnnotationDraft}
        onSave={saveAnnotationDraft}
        onSendToInbox={() => void saveAnnotationDraft({
          openInboxAfterSave: true,
          action: 'send-to-inbox',
          statusText: '复杂改动已保存到反馈收件箱',
        })}
        onApplySmallChange={() => void runAnnotationQuickAction()}
        onOpenInbox={openFeedbackInboxFromAnnotation}
        quickActionRunning={annotationQuickActionRunning}
        streamEvents={annotationStreamEvents}
      />
      <AppContextMenuLayer
        annotationModeActive={feedbackAnnotationModeActive}
        onReferenceToChat={requestChatReference}
      />
      <FeedbackCaptureLayer
        page={page}
        scenarioId={scenarioId}
        session={activeSession}
        appVersion={APP_BUILD_ID}
        author={feedbackAuthor}
        onAuthorChange={setFeedbackAuthor}
        onSubmit={addFeedbackComment}
        onAnnotationReference={handleAnnotationReference}
        annotationReferenceCount={annotationDraft?.references.length ?? 0}
        annotationModeActive={feedbackAnnotationModeActive}
        onAnnotationModeChange={setFeedbackAnnotationModeActive}
      />
        </>
      )}
    </div>
  );
}
