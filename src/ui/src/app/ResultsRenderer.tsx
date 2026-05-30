import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Lock, Shield, Sparkles, Terminal } from 'lucide-react';
import type { ScenarioId } from '../data';
import { artifactPreviewActions, objectReferenceKinds, previewDescriptorKinds, runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { listWorkspace, readPreviewDerivative, readPreviewDescriptor, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry } from '../uiModuleRegistry';
import { interactiveViewResultSummaryPresentation } from '../../../../packages/presentation/interactive-views';
import {
  WorkspaceFileViewer,
  workspaceFileViewerBasename,
  workspaceFileViewerParentPath,
  type WorkspaceFileViewerEntry,
} from '../../../../packages/presentation/components';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import { exportJsonFile } from './exportUtils';
import { Badge, Card, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';
import { ResultShell, type ResultFocusMode } from './results/ResultShell';
import { PreviewDescriptorActions } from './results/PreviewActions';
import { EvidenceMatrix, ExecutionPanel, NotebookTimeline } from './results/ExecutionNotebookPanels';
import { resultCountText, resultLocale, resultText, type ResultLocale } from './results/resultLocale';
import { normalizeWorkspaceRootPath } from '../config';
export { handoffAutoRunPrompt, previewPackageAutoRunPrompt } from './results/autoRunPrompts';
import {
  createResultsRendererViewModel,
  type ResolvedViewPlanItem,
  type ResultsRendererManifestDiagnostic,
  type ResultsRendererViewModel,
  type RuntimeResolvedViewPlan,
} from './results-renderer-view-model';
export { selectDefaultResultItems, type HandoffAutoRunRequest } from './results/viewPlanResolver';
export { coerceReportPayload } from './results/reportContent';
import {
  compactParams,
  exportExecutionBundle,
  isRecord,
  toRecordList,
} from './results/resultArtifactHelpers';
import { boundedRightPaneText, rightPaneInlineLabel, rightPaneSafeRefs } from './results/previewSafety';
import { artifactsForRun, auditExecutionUnitsForRun } from './results/executionUnitsForRun';
import {
  descriptorCanUseWorkspacePreview,
  descriptorDerivativeKind,
  normalizeArtifactPreviewDescriptor,
  previewNeedsPackage,
  uploadedArtifactPreview,
} from './results/previewDescriptor';
import { canHydrateWorkspaceObjectPath, UploadedDataUrlPreview, WorkspaceObjectPreview } from './results/WorkspaceObjectPreview';
import { type EvidenceClaim, type SciForgeConfig, type SciForgeRun, type SciForgeSession, type ObjectAction, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type RuntimeCompatibilityDiagnostic, type RuntimeExecutionUnit, type UIManifestSlot } from '../domain';
import {
  conversationProjectionForSession,
  conversationProjectionStatus,
  type UiConversationProjection,
} from './conversation-projection-view-model';
import {
  backendRepairStates,
  browserVisibleRuntimeState,
  contractValidationFailureKey,
  contractValidationFailures,
  failedExecutionUnits,
  rawAuditItems,
  runAuditBlockers,
  runAuditRefs,
  runPresentationState,
  runRecoverActions,
  type BackendRepairState,
  type RunPresentationState,
} from './results-renderer-execution-model';
export {
  backendRepairStates,
  contractValidationFailures,
  runAuditRefs,
  runPresentationState,
  runRecoverActions,
  shouldDefaultOpenRunAuditDetails,
  shouldOpenRunAuditDetails,
} from './results-renderer-execution-model';
import {
  availableObjectActions,
} from '../../../../packages/support/object-references';
import {
  objectReferenceKindLabel,
  pathForObjectReference,
  referenceKindForWorkspaceFileLike,
  referenceForObjectReference,
  referenceForWorkspaceFileLike,
  sciForgeReferenceAttribute,
  withRegionLocator,
} from '../../../../packages/support/object-references';
import {
  objectActionLabel,
  performObjectReferenceAction,
} from './results-renderer-object-actions';
import { ArtifactInspectorDrawer } from './results-renderer-artifact-inspector';
import {
  RegistrySlot,
  renderRegisteredWorkbenchSlot,
  type WorkbenchSlotRenderProps,
} from './results-renderer-registry-slot';
import {
  createRecoverCommandTextUIAction,
  type CommandTextUIAction,
  type OpenDebugAuditUIAction,
} from './uiActionBoundary';
import { capabilityPlanSummaryForSession, createLocalUserActionApi, type CapabilityPlanSummary, type UserActionApi } from './projectionApi';

export { renderRegisteredWorkbenchSlot };
export type { WorkbenchSlotRenderProps };

function ResultPaneWorkspaceFileViewer({
  state,
  config,
  locale,
  onChange,
  onClose,
}: {
  state: { file: WorkspaceFileContent; draft: string };
  config: SciForgeConfig;
  locale?: ResultLocale;
  onChange: (next: { file: WorkspaceFileContent; draft: string }) => void;
  onClose: () => void;
}) {
  const workspaceRoot = config.workspacePath.trim();
  const dirty = state.draft !== state.file.content;
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceFileViewerEntry[] | undefined>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const fileReference = referenceForWorkspaceFileLike(state.file, referenceKindForWorkspaceFileLike(state.file));

  useEffect(() => {
    setFolderChildren({});
    setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : []));
    setWorkspaceError('');
    setWorkspaceNotice('');
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return undefined;
    let cancelled = false;
    void loadFolder(workspaceRoot, { cancelled: () => cancelled, quiet: true });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    if (!workspaceRoot || !state.file.path) return;
    const ancestors = workspaceFileAncestors(workspaceRoot, state.file.path);
    if (!ancestors.length) return;
    setExpandedFolders((current) => new Set([...current, ...ancestors]));
    for (const ancestor of ancestors) {
      if (folderChildren[ancestor] === undefined) {
        void loadFolder(ancestor, { quiet: true });
      }
    }
  }, [workspaceRoot, state.file.path]);

  async function loadFolder(path: string, options: { cancelled?: () => boolean; quiet?: boolean } = {}) {
    if (!path.trim()) return;
    try {
      if (!options.quiet) setWorkspaceError('');
      const entries = await listWorkspace(path, config);
      if (options.cancelled?.()) return;
      setFolderChildren((previous) => ({ ...previous, [path]: entries.map(workspaceFileViewerEntryFromWorkspaceEntry) }));
      if (!options.quiet) {
        setWorkspaceNotice(entries.length
          ? resultText(locale, { 'zh-CN': `已加载 ${entries.length} 项`, 'en-US': `${entries.length} items loaded` })
          : resultText(locale, { 'zh-CN': '文件夹为空', 'en-US': 'Folder is empty' }));
      }
    } catch (error) {
      if (options.cancelled?.()) return;
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      if (!options.quiet) setWorkspaceNotice('');
    }
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (folderChildren[path] === undefined) void loadFolder(path, { quiet: true });
      }
      return next;
    });
  }

  async function refreshTree() {
    if (!workspaceRoot) return;
    try {
      setWorkspaceError('');
      const folders = Array.from(new Set([workspaceRoot, ...expandedFolders])).filter(Boolean);
      const loaded = await Promise.all(folders.map(async (folder) => [folder, await listWorkspace(folder, config)] as const));
      setFolderChildren((previous) => ({
        ...previous,
        ...Object.fromEntries(loaded.map(([folder, entries]) => [folder, entries.map(workspaceFileViewerEntryFromWorkspaceEntry)])),
      }));
      setWorkspaceNotice(resultText(locale, { 'zh-CN': '目录已刷新', 'en-US': 'Tree refreshed' }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  function collapseTree() {
    setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : []));
  }

  async function openFile(entry: WorkspaceFileViewerEntry) {
    if (entry.kind !== 'file') return;
    try {
      setWorkspaceError('');
      const file = await readWorkspaceFile(entry.path, config);
      onChange({ file, draft: file.content });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开 ${file.name}`, 'en-US': `Opened ${file.name}` }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  async function save() {
    try {
      setSaveError('');
      const file = await writeWorkspaceFile(state.file.path, state.draft, config);
      onChange({ file, draft: file.content });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已保存 ${file.name}`, 'en-US': `Saved ${file.name}` }));
      const parent = workspaceFileViewerParentPath(file.path) || workspaceRoot;
      if (parent) await loadFolder(parent, { quiet: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div
      className="result-workspace-file-viewer"
      aria-label={resultText(locale, { 'zh-CN': '工作区文件', 'en-US': 'Workspace file' })}
      data-sciforge-reference={sciForgeReferenceAttribute(fileReference)}
    >
      <WorkspaceFileViewer
        rootPath={workspaceRoot}
        rootLabel={workspaceFileViewerBasename(workspaceRoot)}
        entriesByFolder={folderChildren}
        expandedFolderPaths={Array.from(expandedFolders)}
        selectedPath={state.file.path}
        file={state.file}
        draft={state.draft}
        dirty={dirty}
        notice={workspaceNotice}
        error={boundedRightPaneText(workspaceError, 800)}
        saveError={boundedRightPaneText(saveError, 800)}
        labels={workspaceFileViewerLabels(locale)}
        onToggleFolder={toggleFolder}
        onOpenFile={(entry) => void openFile(entry)}
        onRefresh={() => void refreshTree()}
        onCollapseAll={collapseTree}
        onDraftChange={(draft) => onChange({ file: state.file, draft })}
        onSave={() => void save()}
        onClose={onClose}
        onCopyPath={(path) => void navigator.clipboard?.writeText(path)}
        onCopyContents={(content) => void navigator.clipboard?.writeText(content)}
      />
    </div>
  );
}

function workspaceFileViewerEntryFromWorkspaceEntry(entry: WorkspaceEntry): WorkspaceFileViewerEntry {
  return {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
  };
}

function workspaceFileAncestors(workspaceRoot: string, filePath: string) {
  const root = normalizeWorkspaceViewerPath(workspaceRoot);
  let current = normalizeWorkspaceViewerPath(workspaceFileViewerParentPath(filePath));
  const ancestors: string[] = [];
  while (current && (current === root || current.startsWith(`${root}/`))) {
    ancestors.unshift(current);
    if (current === root) break;
    current = normalizeWorkspaceViewerPath(workspaceFileViewerParentPath(current));
  }
  return ancestors;
}

function normalizeWorkspaceViewerPath(path: string | undefined) {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function workspaceFileEditorMatchesPath(editorPath: string | undefined, requestedPath: string, workspaceRoot: string) {
  const editor = normalizeWorkspaceViewerPath(editorPath);
  const requested = normalizeWorkspaceViewerPath(requestedPath);
  const root = normalizeWorkspaceViewerPath(workspaceRoot);
  if (!editor || !requested) return false;
  if (editor === requested) return true;
  return Boolean(root && editor === `${root}/${requested.replace(/^\/+/, '')}`);
}

function focusedWorkspaceRootForReference(reference: ObjectReference | undefined, session: SciForgeSession, fallbackWorkspaceRoot: string) {
  if (reference?.kind !== 'file' || reference.provenance?.producer !== 'cursor-agent-process') {
    return normalizeWorkspaceRootPath(fallbackWorkspaceRoot);
  }
  const runWorkspace = workspaceRootForRun(session, reference.runId);
  return normalizeWorkspaceRootPath(runWorkspace || fallbackWorkspaceRoot);
}

function workspaceRootForRun(session: SciForgeSession, runId: string | undefined) {
  if (!runId) return '';
  const run = session.runs.find((item) => item.id === runId);
  if (!run) return '';
  return firstNonEmptyString(
    conversationProjectionForSession(session, run)?.runtimeMetadata?.workspace,
    workspaceRootFromRunRaw(run),
    workspaceRootFromStreamProcess(run),
  );
}

function workspaceRootFromRunRaw(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const payload = isRecord(raw?.payload) ? raw.payload : undefined;
  const runtimeMetadata = isRecord(raw?.runtimeMetadata)
    ? raw.runtimeMetadata
    : isRecord(payload?.runtimeMetadata)
      ? payload.runtimeMetadata
      : undefined;
  return stringField(runtimeMetadata?.workspace) || stringField(runtimeMetadata?.workspacePath);
}

function workspaceRootFromStreamProcess(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const streamProcess = isRecord(raw?.streamProcess) ? raw.streamProcess : undefined;
  const events = Array.isArray(streamProcess?.events) ? streamProcess.events : [];
  for (const event of events) {
    if (!isRecord(event)) continue;
    const native = isRecord(event.native) ? event.native : undefined;
    const workspace = firstNonEmptyString(
      stringField(native?.workspace),
      stringField(native?.workspacePath),
      stringField(native?.workspace_path),
      stringField(event.workspace),
      stringField(event.workspacePath),
      stringField(event.workspace_path),
    );
    if (workspace) return workspace;
  }
  return '';
}

function firstNonEmptyString(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function workspaceFileViewerLabels(locale?: ResultLocale) {
  return {
    title: resultText(locale, { 'zh-CN': '工作区文件', 'en-US': 'Workspace files' }),
    treeLabel: resultText(locale, { 'zh-CN': '工作区文件树', 'en-US': 'Workspace file tree' }),
    editorLabel: resultText(locale, { 'zh-CN': '工作区文件编辑器', 'en-US': 'Workspace file editor' }),
    loading: resultText(locale, { 'zh-CN': '加载中...', 'en-US': 'Loading...' }),
    emptyTree: resultText(locale, { 'zh-CN': '没有可显示的文件。', 'en-US': 'No files to show.' }),
    emptyEditor: resultText(locale, { 'zh-CN': '选择一个文件查看内容。', 'en-US': 'Select a file to inspect it.' }),
    refresh: resultText(locale, { 'zh-CN': '刷新目录', 'en-US': 'Refresh tree' }),
    collapseAll: resultText(locale, { 'zh-CN': '折叠目录', 'en-US': 'Collapse tree' }),
    copyPath: resultText(locale, { 'zh-CN': '复制路径', 'en-US': 'Copy path' }),
    copyContents: resultText(locale, { 'zh-CN': '复制内容', 'en-US': 'Copy contents' }),
    save: resultText(locale, { 'zh-CN': '保存文件', 'en-US': 'Save file' }),
    close: resultText(locale, { 'zh-CN': '关闭文件视图', 'en-US': 'Close file view' }),
    saved: resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' }),
    unsaved: resultText(locale, { 'zh-CN': '未保存', 'en-US': 'Unsaved' }),
  };
}

export function ResultsRenderer({
  scenarioId,
  config,
  session,
  defaultSlots,
  onArtifactHandoff,
  collapsed,
  onToggleCollapse,
  activeRunId,
  onActiveRunChange,
  focusedObjectReference,
  onFocusedObjectChange,
  onPreviewPackageRequest,
  workspaceFileEditor,
  onWorkspaceFileEditorChange,
  onDismissResultSlotPresentation,
  onCommandTextAction,
  onOpenDebugAuditAction,
  initialFocusMode = 'all',
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  defaultSlots: UIManifestSlot[];
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
  focusedObjectReference?: ObjectReference;
  onFocusedObjectChange: (reference: ObjectReference | undefined) => void;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  workspaceFileEditor: { file: WorkspaceFileContent; draft: string } | null;
  onWorkspaceFileEditorChange: (next: { file: WorkspaceFileContent; draft: string } | null) => void;
  /** Hide a resolved results card from the UI only (artifacts and workspace files stay). */
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  /** Test hook for rendering a non-default focus mode without browser events. */
  initialFocusMode?: ResultFocusMode;
}) {
  const locale = resultLocale(config.locale);
  const [resultTab, setResultTab] = useState('primary');
  const [focusMode, setFocusMode] = useState<ResultFocusMode>(initialFocusMode);
  const [inspectedArtifact, setInspectedArtifact] = useState<RuntimeArtifact | undefined>();
  const [pinnedObjectReferences, setPinnedObjectReferences] = useState<ObjectReference[]>([]);
  const [objectActionError, setObjectActionError] = useState('');
  const [objectActionNotice, setObjectActionNotice] = useState('');
  const executionFocus = focusMode === 'execution';
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const rendererModel = useMemo(() => createResultsRendererViewModel({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences,
    focusMode,
    locale,
  }), [scenarioId, session, defaultSlots, activeRun, focusedObjectReference, pinnedObjectReferences, focusMode, locale]);
  function handleFocusModeChange(mode: ResultFocusMode) {
    setFocusMode(mode);
    if (mode === 'evidence') setResultTab('evidence');
    if (mode === 'execution') setResultTab('primary');
    if (mode === 'visual') setResultTab('primary');
  }
  const handleObjectAction = async (reference: ObjectReference, action: ObjectAction) => {
    setObjectActionError('');
    setObjectActionNotice('');
    const result = await performObjectReferenceAction({
      action,
      config,
      pinnedObjectReferences,
      reference,
      session,
    });
    if (result.focusReference) onFocusedObjectChange(result.focusReference);
    if (result.activeRunId) onActiveRunChange(result.activeRunId);
    if (result.resultTab) setResultTab(result.resultTab);
    if (result.inspectedArtifact) setInspectedArtifact(result.inspectedArtifact);
    if (result.pinnedObjectReferences) setPinnedObjectReferences(result.pinnedObjectReferences);
    if (result.commandTextAction) onCommandTextAction?.(result.commandTextAction);
    if (result.notice) setObjectActionNotice(result.notice);
    if (result.error) setObjectActionError(result.error);
  };
  const focusedWorkspaceFilePath = useMemo(() => {
    if (!focusedObjectReference || focusedObjectReference.kind !== 'file') return '';
    const path = pathForObjectReference(focusedObjectReference, session)?.trim() ?? '';
    if (!path || !canHydrateWorkspaceObjectPath(path)) return '';
    return path;
  }, [focusedObjectReference, session]);
  const focusedWorkspaceRoot = useMemo(
    () => focusedWorkspaceRootForReference(focusedObjectReference, session, config.workspacePath),
    [config.workspacePath, focusedObjectReference, session],
  );
  const workspaceFileConfig = useMemo(
    () => focusedWorkspaceRoot && focusedWorkspaceRoot !== config.workspacePath
      ? { ...config, workspacePath: focusedWorkspaceRoot }
      : config,
    [config, focusedWorkspaceRoot],
  );
  useEffect(() => {
    if (executionFocus || !focusedWorkspaceFilePath) return undefined;
    if (workspaceFileEditorMatchesPath(workspaceFileEditor?.file.path, focusedWorkspaceFilePath, workspaceFileConfig.workspacePath)) return undefined;
    let cancelled = false;
    setObjectActionError('');
    void readWorkspaceFile(focusedWorkspaceFilePath, workspaceFileConfig)
      .then((file) => {
        if (!cancelled) onWorkspaceFileEditorChange({ file, draft: file.content });
      })
      .catch((error) => {
        if (!cancelled) setObjectActionError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    executionFocus,
    focusedWorkspaceFilePath,
    onWorkspaceFileEditorChange,
    workspaceFileConfig,
    workspaceFileEditor?.file.path,
  ]);

  return (
    <ResultShell
      collapsed={collapsed}
      resultTab={resultTab}
      focusMode={focusMode}
      activeRun={undefined}
      scenarioId={scenarioId}
      locale={locale}
      onToggleCollapse={onToggleCollapse}
      onResultTabChange={setResultTab}
      onFocusModeChange={handleFocusModeChange}
      onActiveRunChange={onActiveRunChange}
      drawer={!executionFocus && inspectedArtifact ? (
        <ArtifactInspectorDrawer
          scenarioId={scenarioId}
          session={session}
          artifact={inspectedArtifact}
          onClose={() => setInspectedArtifact(undefined)}
          onArtifactHandoff={onArtifactHandoff}
        />
      ) : null}
    >
            {workspaceFileEditor ? (
              <ResultPaneWorkspaceFileViewer
                state={workspaceFileEditor}
                config={workspaceFileConfig}
                locale={locale}
                onChange={onWorkspaceFileEditorChange}
                onClose={() => onWorkspaceFileEditorChange(null)}
              />
            ) : null}
            {!executionFocus && focusedObjectReference ? (
              <ObjectFocusBanner
                reference={focusedObjectReference}
                pinnedReferences={pinnedObjectReferences}
                actions={availableObjectActions(focusedObjectReference, session)}
                error={objectActionError}
                notice={objectActionNotice}
                locale={locale}
                onAction={handleObjectAction}
                onClear={() => onFocusedObjectChange(undefined)}
              />
            ) : objectActionError ? (
              <div className="object-action-error">{objectActionError}</div>
            ) : null}
            {!workspaceFileEditor && !executionFocus && focusedObjectReference ? (
              <WorkspaceObjectPreview
                reference={focusedObjectReference}
                session={session}
                config={config}
                locale={locale}
                onPreviewPackageRequest={onPreviewPackageRequest}
                onObjectReferenceFocus={onFocusedObjectChange}
              />
            ) : null}
            {resultTab === 'primary' ? (
              <PrimaryResult
                scenarioId={scenarioId}
                config={config}
                session={session}
                activeRun={activeRun}
                focusMode={focusMode}
                model={rendererModel}
                locale={locale}
                onArtifactHandoff={onArtifactHandoff}
                onInspectArtifact={setInspectedArtifact}
                onObjectReferenceFocus={onFocusedObjectChange}
                onDismissResultSlotPresentation={onDismissResultSlotPresentation}
                onCommandTextAction={onCommandTextAction}
                onOpenDebugAuditAction={onOpenDebugAuditAction}
              />
            ) : resultTab === 'evidence' ? (
              <EvidenceMatrix claims={evidenceClaimsForRun(session, activeRun)} artifacts={artifactsForRun(session, activeRun)} locale={locale} />
            ) : null}
    </ResultShell>
  );
}

function PrimaryResult({
  scenarioId,
  config,
  session,
  activeRun,
  focusMode,
  model,
  locale,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
  onCommandTextAction,
  onOpenDebugAuditAction,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  focusMode: ResultFocusMode;
  model: ResultsRendererViewModel;
  locale?: ResultLocale;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
}) {
  const { viewPlan } = model;
  const runtimeState = browserVisibleRuntimeState(session, activeRun, viewPlan);
  const hasResultPreview = model.visibleItems.length > 0 || model.deferredItems.length > 0;
  const compatibilityDiagnostics = runtimeCompatibilityDiagnosticsForPresentation(session, activeRun);
  const capabilitySummary = capabilityPlanSummaryForSession(session, activeRun?.id);
  const hasSupportDetails = hasResultPreview
    || (capabilitySummary && capabilitySummary.status !== 'none')
    || (!hasResultPreview && compatibilityDiagnostics.length > 0)
    || model.auditOpen
    || viewPlan.allItems.length > 0;
  if (focusMode === 'execution') {
    return <ExecutionOnlyResult session={session} activeRun={activeRun} locale={locale} />;
  }
  return (
    <div className="stack">
      <div
        className="runtime-visible-state-hook"
        data-testid="runtime-visible-state"
        data-run-status={runtimeState.runStatus ?? ''}
        data-run-created-at={runtimeState.runCreatedAt ?? ''}
        data-run-completed-at={runtimeState.runCompletedAt ?? ''}
        data-projection-status={runtimeState.projectionStatus}
        data-presentation-kind={runtimeState.presentationKind}
        data-current-stage-id={runtimeState.currentStageId ?? ''}
        data-current-stage-status={runtimeState.currentStageStatus ?? ''}
        data-background-status={runtimeState.backgroundStatus ?? ''}
        data-t-first-progress-ms={runtimeState.tFirstProgressMs ?? ''}
        data-t-first-backend-event-ms={runtimeState.tFirstBackendEventMs ?? ''}
        data-t-terminal-projection-ms={runtimeState.tTerminalProjectionMs ?? ''}
        data-visible-artifact-refs={runtimeState.visibleArtifactRefs.join(',')}
        data-recover-action-count={runtimeState.recoverActionCount}
        data-projection-wait-at-terminal={runtimeState.projectionWaitAtTerminal ? 'true' : 'false'}
        data-fallback-used={runtimeState.rawFallbackUsed ? 'true' : 'false'}
        data-diagnostic-leak={runtimeState.rawLeak ? 'true' : 'false'}
        aria-hidden="true"
      />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} locale={locale} /> : null}
      {model.emptyState ? (
        <EmptyArtifactState
          title={model.emptyState.title}
          detail={model.emptyState.detail}
          recoverActions={model.emptyState.recoverActions}
        />
      ) : null}
      <ResultItemsSection
        title={model.primaryTitle}
        items={model.visibleItems}
        scenarioId={scenarioId}
        config={config}
        session={session}
        onArtifactHandoff={onArtifactHandoff}
        onInspectArtifact={onInspectArtifact}
        onObjectReferenceFocus={onObjectReferenceFocus}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        locale={locale}
      />
      {model.deferredSections.length ? (
        <details className="result-details-panel">
          <summary>
            <span>{resultText(locale, { 'zh-CN': '更多结果', 'en-US': 'More results' })}</span>
            <Badge variant="muted">{resultCountText(locale, model.deferredItems.length, {
              zh: (count) => `${count} 项已折叠`,
              en: (count) => `${count} folded`,
            })}</Badge>
          </summary>
          {model.deferredSections.map((section) => (
            <ResultItemsSection
              key={section.section}
              title={section.title}
              items={section.items}
              scenarioId={scenarioId}
              config={config}
              session={session}
              onArtifactHandoff={onArtifactHandoff}
              onInspectArtifact={onInspectArtifact}
              onObjectReferenceFocus={onObjectReferenceFocus}
              onDismissResultSlotPresentation={onDismissResultSlotPresentation}
              locale={locale}
            />
          ))}
        </details>
      ) : null}
      {hasSupportDetails ? (
        <ResultSupportDetails locale={locale}>
          {hasResultPreview ? (
            <RunStatusSummary
              session={session}
              activeRun={activeRun}
              viewPlan={viewPlan}
              locale={locale}
              onCommandTextAction={onCommandTextAction}
            />
          ) : null}
          <CapabilityPlanSummaryCard
            summary={capabilitySummary}
            session={session}
            activeRun={activeRun}
            locale={locale}
            onOpenDebugAuditAction={onOpenDebugAuditAction}
          />
          {!hasResultPreview && compatibilityDiagnostics.length ? (
            <RuntimeCompatibilityDetails diagnostics={compatibilityDiagnostics} locale={locale} />
          ) : null}
          {model.auditOpen ? (
            <RunAuditDetails
              scenarioId={scenarioId}
              session={session}
              activeRun={activeRun}
              viewPlan={viewPlan}
              defaultOpen={model.auditDefaultOpen}
              locale={locale}
              onOpenDebugAuditAction={onOpenDebugAuditAction}
              onCommandTextAction={onCommandTextAction}
            />
          ) : null}
          {viewPlan.allItems.length ? (
            <ViewPlanDetails viewPlan={viewPlan} session={session} activeRun={activeRun} items={model.manifestDiagnostics} locale={locale} />
          ) : null}
        </ResultSupportDetails>
      ) : null}
    </div>
  );
}

function ResultSupportDetails({ children, locale }: { children: ReactNode; locale?: ResultLocale }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="result-details-panel subtle"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '更多', 'en-US': 'More' })}</span>
        <Badge variant="muted">{resultText(locale, { 'zh-CN': '已折叠', 'en-US': 'folded' })}</Badge>
      </summary>
      {expanded ? <div className="stack">{children}</div> : null}
    </details>
  );
}

function CapabilityPlanSummaryCard({
  summary,
  session,
  activeRun,
  locale,
  onOpenDebugAuditAction,
}: {
  summary?: CapabilityPlanSummary;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  locale?: ResultLocale;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!summary || summary.status === 'none') return null;
  return (
    <details
      className="result-details-panel subtle"
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        if (open) {
          void requestOpenDebugAuditThroughUserActionApi({ session, activeRun })
            .then((action) => {
              if (action) onOpenDebugAuditAction?.(action);
            });
        }
      }}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '计划', 'en-US': 'Plan' })}</span>
        <Badge variant="muted">{summary.debugRefs.length
          ? resultCountText(locale, summary.debugRefs.length, {
            zh: (count) => `${count} 条来源`,
            en: (count) => `${count} sources`,
          })
          : resultText(locale, { 'zh-CN': '已记录', 'en-US': 'saved' })}</Badge>
      </summary>
      {expanded ? (
        <Card className="capability-plan-summary">
          <SectionHeader
            icon={Sparkles}
            title={resultText(locale, { 'zh-CN': '运行计划', 'en-US': 'Run plan' })}
            subtitle={resultText(locale, { 'zh-CN': '已选择的工具', 'en-US': 'Selected tools' })}
          />
          <p>{boundedRightPaneText(summary.summary, 800)}</p>
          {summary.debugRefs.length ? (
            <div className="inspector-ref-list">
              {rightPaneSafeRefs(summary.debugRefs, 8).map((ref) => <code key={ref}>{ref}</code>)}
            </div>
          ) : null}
        </Card>
      ) : null}
    </details>
  );
}

function ExecutionOnlyResult({ session, activeRun, locale }: { session: SciForgeSession; activeRun?: SciForgeRun; locale?: ResultLocale }) {
  const projection = conversationProjectionForSession(session, activeRun ?? session.runs.at(-1));
  const units = auditExecutionUnitsForRun(session, activeRun);
  if (projection) {
    return (
      <div className="stack">
        <ProjectionExecutionOnlyResult projection={projection} locale={locale} />
        <ExecutionPanel session={session} executionUnits={units} activeRun={activeRun} embedded locale={locale} />
      </div>
    );
  }
  return (
    <div className="stack">
      <ExecutionPanel session={session} executionUnits={units} activeRun={activeRun} embedded locale={locale} />
    </div>
  );
}

function ProjectionExecutionOnlyResult({ projection, locale }: { projection: UiConversationProjection; locale?: ResultLocale }) {
  const events = projection.executionProcess.slice(-12);
  const status = conversationProjectionStatus(projection);
  return (
    <div className="stack">
      <Card className="code-card">
        <SectionHeader icon={Terminal} title={resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' })} subtitle={projectionStatusLabel(status, locale)} />
        {events.length ? (
          <div className="run-status-lines">
            {events.map((event) => (
              <span key={event.eventId}>{projectionEventLabel(event.type, status, locale)}: {boundedRightPaneText(projectionEventSummary(event.summary || event.eventId, status, locale), 500)}</span>
            ))}
          </div>
        ) : <p className="empty-state">{resultText(locale, { 'zh-CN': '此结果还没有关联活动。', 'en-US': 'No activity has been attached to this result yet.' })}</p>}
      </Card>
    </div>
  );
}

function projectionStatusLabel(status: ReturnType<typeof conversationProjectionStatus>, locale?: ResultLocale) {
  const labels: Record<ReturnType<typeof conversationProjectionStatus>, Record<ResultLocale, string>> = {
    idle: { 'zh-CN': '未运行', 'en-US': 'Not run' },
    planned: { 'zh-CN': '已计划', 'en-US': 'Planned' },
    dispatched: { 'zh-CN': '已开始', 'en-US': 'Started' },
    'partial-ready': { 'zh-CN': '部分结果', 'en-US': 'Partial result' },
    'output-materialized': { 'zh-CN': '输出已保存', 'en-US': 'Output saved' },
    validated: { 'zh-CN': '已验证', 'en-US': 'Validated' },
    'visible-not-live-acceptance': { 'zh-CN': '回答已显示', 'en-US': 'Answer shown' },
    satisfied: { 'zh-CN': '完成', 'en-US': 'Complete' },
    'degraded-result': { 'zh-CN': '部分结果', 'en-US': 'Partial result' },
    'external-blocked': { 'zh-CN': '已阻塞', 'en-US': 'Blocked' },
    'repair-needed': { 'zh-CN': '需要恢复', 'en-US': 'Needs recovery' },
    'needs-human': { 'zh-CN': '需要输入', 'en-US': 'Needs input' },
    'background-running': { 'zh-CN': '仍在运行', 'en-US': 'Still running' },
  };
  return resultText(locale, labels[status]);
}

function projectionEventLabel(type: string, status: ReturnType<typeof conversationProjectionStatus>, locale?: ResultLocale) {
  if (status === 'visible-not-live-acceptance' || /native.?codex.?message/i.test(type)) return resultText(locale, { 'zh-CN': '回答', 'en-US': 'Answer' });
  if (/artifact|output|materialized/i.test(type)) return resultText(locale, { 'zh-CN': '输出', 'en-US': 'Output' });
  if (/verification|validated/i.test(type)) return resultText(locale, { 'zh-CN': '检查', 'en-US': 'Check' });
  return resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' });
}

function projectionEventSummary(summary: string, status: ReturnType<typeof conversationProjectionStatus>, locale?: ResultLocale) {
  if (status === 'visible-not-live-acceptance' || /native.?codex.?message/i.test(summary)) return resultText(locale, { 'zh-CN': '回答已显示在聊天中', 'en-US': 'Answer shown in chat' });
  return summary;
}

function RunStatusSummary({
  session,
  activeRun,
  viewPlan,
  locale,
  onCommandTextAction,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  locale?: ResultLocale;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
}) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  const failures = projection ? [] : failedExecutionUnits(session, activeRun);
  const blockers = runAuditBlockers(session, activeRun);
  const validationFailures = projection ? [] : contractValidationFailures(session, activeRun);
  const repairStates = projection ? [] : backendRepairStates(session, activeRun);
  const runtimeDriftDiagnostics = runtimeCompatibilityDiagnosticsForPresentation(session, activeRun);
  const presentationState = runPresentationState(session, activeRun, viewPlan);
  const suppressNativeAnswerRecovery = projection
    && conversationProjectionStatus(projection) === 'visible-not-live-acceptance'
    && presentationState.kind === 'ready';
  const recoverActions = suppressNativeAnswerRecovery ? [] : runRecoverActions(session, activeRun).slice(0, 4);
  const shouldShowPresentationState = presentationState.kind !== 'ready' || presentationState.nextSteps.length > 0;
  const failureDriven = failures.length || validationFailures.length;
  const projectionStateDriven = projection && presentationState.kind !== 'ready';
  const statusDriven = failureDriven || projectionStateDriven;
  if (!failures.length && !blockers.length && !validationFailures.length && !repairStates.length && !runtimeDriftDiagnostics.length && !recoverActions.length && !shouldShowPresentationState) return null;
  return (
    <Card className={cx('run-status-summary', failureDriven ? 'failed' : presentationState.kind)}>
      <SectionHeader
        icon={runtimeDriftDiagnostics.length && !statusDriven ? Shield : AlertTriangle}
        title={failureDriven ? resultText(locale, { 'zh-CN': '需要处理', 'en-US': 'Needs attention' }) : projectionStateDriven ? presentationState.title : runtimeDriftDiagnostics.length ? resultText(locale, { 'zh-CN': '兼容性检查', 'en-US': 'Compatibility check' }) : presentationState.title}
        subtitle={run ? runStatusSubtitle(run.status, presentationState.kind, locale) : resultText(locale, { 'zh-CN': '等待结果', 'en-US': 'Waiting for results' })}
      />
      <RunPresentationStateSummary state={presentationState} locale={locale} />
      {runtimeDriftDiagnostics.map((diagnostic) => <RuntimeCompatibilityDiagnosticSummary key={diagnostic.id} diagnostic={diagnostic} locale={locale} />)}
      {blockers.length ? (
        <div className="run-status-lines">
          {blockers.map((line) => <span key={line}>{boundedRightPaneText(compactVisibleFailureText(line, locale), 500)}</span>)}
        </div>
      ) : null}
      {failures.map((unit) => (
        <div className="run-failure-card" key={unit.id}>
          <strong>{resultText(locale, { 'zh-CN': '动作需要处理', 'en-US': 'Action needs attention' })}</strong>
          <p>{boundedRightPaneText(compactVisibleFailureText(unit.failureReason || unit.selfHealReason || unit.nextStep || resultText(locale, { 'zh-CN': '动作失败，详情在下方可查看。', 'en-US': 'The action failed. Details are available below.' }), locale), 500)}</p>
          <p className="empty-state">{resultCountText(locale, executionUnitRefCount(unit), {
            zh: (count) => `已保存 ${count} 条恢复引用。`,
            en: (count) => `${count} recovery reference${count === 1 ? '' : 's'} saved.`,
          })}</p>
        </div>
      ))}
      {validationFailures.map((failure) => <ContractValidationFailureSummary key={contractValidationFailureKey(failure)} failure={failure} compact locale={locale} />)}
      {repairStates.map((state) => <BackendRepairStateSummary key={state.id} state={state} compact locale={locale} />)}
      {recoverActions.length ? (
        <div className="run-recover-actions">
          {recoverActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => void requestRecoverCommandTextAction({ session, activeRun, recoverAction: action })
                .then((commandAction) => {
                  if (commandAction) onCommandTextAction?.(commandAction);
                })}
            >
              {boundedRightPaneText(action, 500)}
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function runStatusSubtitle(status: SciForgeRun['status'], presentationKind: RunPresentationState['kind'], locale?: ResultLocale) {
  if (status === 'running') return resultText(locale, { 'zh-CN': '运行中', 'en-US': 'Running' });
  if (status === 'failed') return resultText(locale, { 'zh-CN': '需要处理', 'en-US': 'Needs attention' });
  if (status === 'cancelled') return resultText(locale, { 'zh-CN': '已取消', 'en-US': 'Cancelled' });
  if (presentationKind === 'empty') return resultText(locale, { 'zh-CN': '等待结果', 'en-US': 'Waiting for results' });
  if (presentationKind === 'partial') return resultText(locale, { 'zh-CN': '部分结果已就绪', 'en-US': 'Partial results ready' });
  if (presentationKind === 'recoverable') return resultText(locale, { 'zh-CN': '可恢复', 'en-US': 'Recoverable' });
  if (presentationKind === 'needs-human') return resultText(locale, { 'zh-CN': '需要确认', 'en-US': 'Needs confirmation' });
  return resultText(locale, { 'zh-CN': '完成', 'en-US': 'Done' });
}

function RuntimeCompatibilityDiagnosticSummary({ diagnostic, locale }: { diagnostic: RuntimeCompatibilityDiagnostic; locale?: ResultLocale }) {
  return (
    <div className="run-failure-card">
      <strong>{diagnostic.kind}</strong>
      <p>{boundedRightPaneText(compactVisibleFailureText(diagnostic.reason, locale), 500)}</p>
      <div className="slot-meta">
        <strong>{resultText(locale, { 'zh-CN': '兼容性', 'en-US': 'Compatibility' })}</strong>
        <code>{resultText(locale, { 'zh-CN': '当前', 'en-US': 'current' })}: {diagnostic.current.compatibilityVersion}</code>
        {diagnostic.persisted ? <code>{resultText(locale, { 'zh-CN': '已保存', 'en-US': 'persisted' })}: {diagnostic.persisted.compatibilityVersion}</code> : null}
      </div>
      <div className="run-recover-actions">
        {diagnostic.recoverableActions.map((action) => <code key={action}>{rightPaneInlineLabel(action)}</code>)}
      </div>
    </div>
  );
}

function RuntimeCompatibilityDetails({ diagnostics, locale }: { diagnostics: RuntimeCompatibilityDiagnostic[]; locale?: ResultLocale }) {
  const [expanded, setExpanded] = useState(false);
  if (!diagnostics.length) return null;
  return (
    <details
      className="result-details-panel subtle"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '检查', 'en-US': 'Checks' })}</span>
        <Badge variant="muted">{resultCountText(locale, diagnostics.length, {
          zh: (count) => `${count} 项检查`,
          en: (count) => `${count} check${count === 1 ? '' : 's'}`,
        })}</Badge>
      </summary>
      {expanded ? (
        <div className="stack">
          {diagnostics.map((diagnostic) => <RuntimeCompatibilityDiagnosticSummary key={diagnostic.id} diagnostic={diagnostic} locale={locale} />)}
        </div>
      ) : null}
    </details>
  );
}

function RunPresentationStateSummary({ state, locale }: { state: RunPresentationState; locale?: ResultLocale }) {
  if (state.kind === 'ready' && !state.nextSteps.length) return null;
  return (
    <div className="run-presentation-state">
      <div className="run-status-lines">
        <span>{boundedRightPaneText(state.reason, 800)}</span>
      </div>
      {state.availableArtifacts.length ? (
        <div className="slot-meta">
          <strong>{resultText(locale, { 'zh-CN': '结果', 'en-US': 'Results' })}</strong>
          {state.availableArtifacts.slice(0, 6).map((artifact) => (
            <code key={artifact.id}>{rightPaneInlineLabel(artifact.title ?? resultText(locale, { 'zh-CN': '结果', 'en-US': 'Result' }))}</code>
          ))}
        </div>
      ) : null}
      {state.progress ? <RunProgressSummary progress={state.progress} locale={locale} /> : null}
      {state.nextSteps.length ? (
        <div className="run-recover-actions">
          {state.nextSteps.map((action) => <code key={action}>{boundedRightPaneText(action, 500)}</code>)}
        </div>
      ) : null}
    </div>
  );
}

function RunProgressSummary({ progress, locale }: { progress: NonNullable<RunPresentationState['progress']>; locale?: ResultLocale }) {
  const hasProgress = progress.completedParts.length || progress.currentStage || progress.backgroundStatus || progress.safeActions.length;
  if (!hasProgress) return null;
  return (
    <div
      className="run-progress-summary"
      data-testid="runtime-timing-progress"
      data-current-stage-id={progress.currentStage?.id ?? ''}
      data-current-stage-status={progress.currentStage?.status ?? ''}
      data-background-status={progress.backgroundStatus ?? ''}
    >
      {progress.completedParts.length ? (
        <div className="slot-meta">
          <strong>{resultText(locale, { 'zh-CN': '已完成', 'en-US': 'Completed' })}</strong>
          {progress.completedParts.slice(0, 6).map((part) => (
            <code key={`${part.id}-${part.ref ?? ''}`}>{rightPaneInlineLabel(part.label)}</code>
          ))}
        </div>
      ) : null}
      {progress.currentStage || progress.backgroundStatus ? (
        <div className="run-status-lines">
          {progress.currentStage ? <span>{resultText(locale, { 'zh-CN': '当前步骤', 'en-US': 'Current step' })}: {rightPaneInlineLabel(progress.currentStage.label)} · {rightPaneInlineLabel(progress.currentStage.status)}</span> : null}
          {progress.backgroundStatus ? <span>{resultText(locale, { 'zh-CN': '后台', 'en-US': 'Background' })}: {rightPaneInlineLabel(progress.backgroundStatus)}</span> : null}
        </div>
      ) : null}
      {progress.safeActions.length ? (
        <div className="run-recover-actions">
          {progress.safeActions.map((action) => (
            <code key={`${action.kind}-${action.label}-${action.ref ?? ''}`}>{action.safe ? resultText(locale, { 'zh-CN': '可用', 'en-US': 'Ready' }) : resultText(locale, { 'zh-CN': '需确认', 'en-US': 'Confirm' })} · {rightPaneInlineLabel(action.label)}</code>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunAuditDetails({
  scenarioId,
  session,
  activeRun,
  viewPlan,
  defaultOpen,
  locale,
  onOpenDebugAuditAction,
  onCommandTextAction,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  defaultOpen?: boolean;
  locale?: ResultLocale;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
}) {
  const failureCount = failedExecutionUnits(session, activeRun).length;
  const units = auditExecutionUnitsForRun(session, activeRun ?? session.runs.at(-1));
  const [expanded, setExpanded] = useState(Boolean(defaultOpen));
  const rawItems = expanded ? rawAuditItems(session, activeRun, viewPlan) : [];
  return (
    <details
      className="result-details-panel audit-details-panel"
      open={defaultOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        if (open) {
          void requestOpenDebugAuditThroughUserActionApi({ session, activeRun })
            .then((action) => {
              if (action) onOpenDebugAuditAction?.(action);
            });
        }
      }}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' })}</span>
        <Badge variant={failureCount ? 'danger' : 'muted'}>
          {failureCount
            ? resultCountText(locale, failureCount, {
              zh: (count) => `${count} 个问题`,
              en: (count) => `${count} issue${count === 1 ? '' : 's'}`,
            })
            : resultCountText(locale, units.length, {
              zh: (count) => `${count} 步`,
              en: (count) => `${count} steps`,
            })}
        </Badge>
      </summary>
      {expanded ? (
        <>
          <RunAuditOverview session={session} activeRun={activeRun} locale={locale} onCommandTextAction={onCommandTextAction} />
          <ExecutionPanel session={session} executionUnits={units} embedded locale={locale} />
          <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} embedded locale={locale} />
          <Card className="code-card">
            <SectionHeader icon={Terminal} title={resultText(locale, { 'zh-CN': '支持活动', 'en-US': 'Supporting Activity' })} />
            <p className="empty-state">{resultCountText(locale, rawItems.length, {
              zh: (count) => `已保存 ${count} 条支持记录供查看。`,
              en: (count) => `Saved ${count} supporting records for review.`,
            })}</p>
          </Card>
        </>
      ) : null}
    </details>
  );
}

function RunAuditOverview({
  session,
  activeRun,
  locale,
  onCommandTextAction,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  locale?: ResultLocale;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
}) {
  const blockers = runAuditBlockers(session, activeRun);
  const refs = runAuditRefs(session, activeRun);
  const recoverActions = runRecoverActions(session, activeRun);
  const validationFailures = contractValidationFailures(session, activeRun);
  const repairStates = backendRepairStates(session, activeRun);
  return (
    <Card className="audit-overview">
      <SectionHeader icon={Shield} title={resultText(locale, { 'zh-CN': '问题摘要', 'en-US': 'Issue Summary' })} subtitle={resultText(locale, { 'zh-CN': '检查和恢复记录', 'en-US': 'Checks and recovery notes' })} />
      {blockers.length ? (
        <div className="run-status-lines">
          {blockers.map((line) => <span key={line}>{boundedRightPaneText(line, 500)}</span>)}
        </div>
      ) : <p className="empty-state">{resultText(locale, { 'zh-CN': '没有阻塞项。支持活动保留在下方。', 'en-US': 'No blockers. Supporting activity is kept below.' })}</p>}
      {recoverActions.length ? (
        <div className="run-recover-actions">
          {recoverActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => void requestRecoverCommandTextAction({ session, activeRun, recoverAction: action })
                .then((commandAction) => {
                  if (commandAction) onCommandTextAction?.(commandAction);
                })}
            >
              {boundedRightPaneText(action, 500)}
            </button>
          ))}
        </div>
      ) : null}
      {validationFailures.length ? (
        <div className="stack">
          {validationFailures.map((failure) => <ContractValidationFailureSummary key={contractValidationFailureKey(failure)} failure={failure} locale={locale} />)}
        </div>
      ) : null}
      {repairStates.length ? (
        <div className="stack">
          {repairStates.map((state) => <BackendRepairStateSummary key={state.id} state={state} locale={locale} />)}
        </div>
      ) : null}
      {refs.length ? <p className="empty-state">{resultCountText(locale, refs.length, {
        zh: (count) => `已保存 ${count} 条恢复引用。`,
        en: (count) => `${count} recovery reference${count === 1 ? '' : 's'} saved.`,
      })}</p> : null}
    </Card>
  );
}

function executionUnitRefCount(unit: RuntimeExecutionUnit) {
  return [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef].filter(Boolean).length;
}

function ContractValidationFailureSummary({ failure, compact = false, locale }: { failure: ContractValidationFailure; compact?: boolean; locale?: ResultLocale }) {
  const issueLines = failure.issues.map((issue) => [
    issue.path || issue.missingField || issue.invalidRef || issue.unresolvedUri || 'issue',
    issue.message,
  ].filter(Boolean).join(': '));
  return (
    <div className="run-failure-card">
      <strong>{resultText(locale, { 'zh-CN': '验证未通过', 'en-US': 'Validation failed' })} · {contractFailureKindLabel(failure.failureKind, locale)}</strong>
      <p>{boundedRightPaneText(compact ? compactVisibleFailureText(failure.failureReason, locale) : failure.failureReason, 800)}</p>
      <div className="slot-meta">
        <code>{resultText(locale, { 'zh-CN': '规则', 'en-US': 'Rule' })}: {rightPaneInlineLabel(failure.contractId)}</code>
        <code>{resultText(locale, { 'zh-CN': '能力', 'en-US': 'Capability' })}: {rightPaneInlineLabel(failure.capabilityId)}</code>
        {failure.schemaPath ? <code>{resultText(locale, { 'zh-CN': '位置', 'en-US': 'Location' })}: {rightPaneInlineLabel(failure.schemaPath)}</code> : null}
      </div>
      {failure.missingFields.length || failure.invalidRefs.length || failure.unresolvedUris.length ? (
        <div className="slot-meta">
          {failure.missingFields.map((field) => <code key={`missing-${field}`}>{resultText(locale, { 'zh-CN': '缺少字段', 'en-US': 'Missing field' })}: {rightPaneInlineLabel(field)}</code>)}
          {failure.invalidRefs.map((ref) => <code key={`invalid-${ref}`}>{resultText(locale, { 'zh-CN': '不可用线索', 'en-US': 'Unavailable reference' })}: {rightPaneInlineLabel(ref)}</code>)}
          {failure.unresolvedUris.map((uri) => <code key={`unresolved-${uri}`}>{resultText(locale, { 'zh-CN': '无法打开', 'en-US': 'Cannot open' })}: {rightPaneInlineLabel(uri)}</code>)}
        </div>
      ) : null}
      {!compact && issueLines.length ? (
        <div className="run-status-lines">
          {issueLines.slice(0, 6).map((line) => <span key={line}>{boundedRightPaneText(line, 500)}</span>)}
        </div>
      ) : null}
      {failure.relatedRefs.length ? (
        <div className="inspector-ref-list">
          {rightPaneSafeRefs(failure.relatedRefs, 8).map((ref) => <code key={`related-${ref}`}>{resultText(locale, { 'zh-CN': '相关线索', 'en-US': 'Related reference' })}: {ref}</code>)}
        </div>
      ) : null}
      {failure.nextStep ? <p className="empty-state">{resultText(locale, { 'zh-CN': '建议', 'en-US': 'Suggestion' })}: {boundedRightPaneText(failure.nextStep, 500)}</p> : null}
    </div>
  );
}

function BackendRepairStateSummary({ state, compact = false, locale }: { state: BackendRepairState; compact?: boolean; locale?: ResultLocale }) {
  const statusText = [state.status ? `${resultText(locale, { 'zh-CN': '状态', 'en-US': 'Status' })}: ${state.status}` : undefined, state.failureReason].filter(Boolean).join(' · ') || resultText(locale, { 'zh-CN': '已记录恢复线索', 'en-US': 'Recovery note saved' });
  return (
    <div className="run-failure-card">
      <strong>{resultText(locale, { 'zh-CN': '恢复线索', 'en-US': 'Recovery note' })} · {repairStateLabel(state.label, locale)}</strong>
      <p>{boundedRightPaneText(compact ? compactVisibleFailureText(statusText, locale) : statusText, 800)}</p>
      <div className="slot-meta">
        {state.sourceRunId ? <code>{resultText(locale, { 'zh-CN': '来源记录', 'en-US': 'Source record' })}: {rightPaneInlineLabel(state.sourceRunId)}</code> : null}
        {state.repairRunId ? <code>{resultText(locale, { 'zh-CN': '恢复记录', 'en-US': 'Repair record' })}: {rightPaneInlineLabel(state.repairRunId)}</code> : null}
      </div>
      {state.refs.length ? (
        <div className="inspector-ref-list">
          {rightPaneSafeRefs(state.refs, 8).map((ref) => <code key={`${state.id}-${ref}`}>{ref}</code>)}
        </div>
      ) : null}
      {!compact && state.history.length ? (
        <div className="run-status-lines">
          {state.history.slice(0, 6).map((line) => <span key={line}>{boundedRightPaneText(line, 500)}</span>)}
        </div>
      ) : null}
    </div>
  );
}

export async function requestRecoverCommandTextAction(input: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  recoverAction: string;
}): Promise<CommandTextUIAction | undefined> {
  const run = input.activeRun ?? input.session.runs.at(-1);
  if (!run) return undefined;
  return createRecoverCommandTextUIAction({
    session: input.session,
    id: actionId('command-recover'),
    createdAt: new Date().toISOString(),
    runId: run.id,
    recoverAction: input.recoverAction,
    auditRefs: runAuditRefs(input.session, run),
  });
}

export async function requestOpenDebugAuditThroughUserActionApi(input: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  userActionApi?: Pick<UserActionApi, 'openDebugAudit'>;
}): Promise<OpenDebugAuditUIAction | undefined> {
  const run = input.activeRun ?? input.session.runs.at(-1);
  const api = input.userActionApi ?? createLocalUserActionApi();
  const result = await api.openDebugAudit({
    session: input.session,
    runId: run?.id,
  });
  return result.action?.type === 'open-debug-audit' ? result.action : undefined;
}

function actionId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function runtimeCompatibilityDiagnosticsForPresentation(session: SciForgeSession, activeRun?: SciForgeRun): RuntimeCompatibilityDiagnostic[] {
  const diagnostics = session.runtimeCompatibilityDiagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.filter((diagnostic): diagnostic is RuntimeCompatibilityDiagnostic => {
    if (!diagnostic
      || diagnostic.schemaVersion !== 1
      || typeof diagnostic.id !== 'string'
      || typeof diagnostic.reason !== 'string'
      || !Array.isArray(diagnostic.recoverableActions)
      || typeof diagnostic.current !== 'object'
      || diagnostic.current === null) return false;
    if (!activeRun) return true;
    const diagnosticTime = Date.parse(diagnostic.createdAt);
    const runCreatedAt = Date.parse(activeRun.createdAt);
    if (Number.isFinite(diagnosticTime) && Number.isFinite(runCreatedAt) && diagnosticTime < runCreatedAt) return false;
    return true;
  }).slice(0, 4);
}

function evidenceClaimsForRun(session: SciForgeSession, activeRun?: SciForgeRun): EvidenceClaim[] {
  if (!activeRun) return session.claims;
  const artifactIds = new Set(artifactsForRun(session, activeRun).map((artifact) => artifact.id));
  const executionUnitIds = new Set(auditExecutionUnitsForRun(session, activeRun).map((unit) => unit.id.replace(/^execution-unit::?/i, '')));
  if (!artifactIds.size && !executionUnitIds.size) return [];
  return session.claims.filter((claim) => {
    const refs = [...claim.supportingRefs, ...claim.opposingRefs, ...(claim.dependencyRefs ?? [])];
    return refs.some((ref) => {
      const normalized = ref.replace(/^(artifact|file|execution-unit)::?/i, '');
      return artifactIds.has(normalized) || executionUnitIds.has(normalized);
    });
  });
}

function compactVisibleFailureText(value: string, locale?: ResultLocale) {
  const text = value.replace(/\s+/g, ' ').trim();
  const reasonMatch = text.match(/reason=([^.;]+(?:[.;]|$))/i);
  const previousFailureMatch = text.match(/Previous failure:\s*([^.;]+(?:[.;]|$))/i);
  const contractMatch = text.match(/ContractValidationFailure(?:\s+|\()([a-z-]+)/i);
  const pieces = [
    contractMatch ? `${resultText(locale, { 'zh-CN': '验证未通过', 'en-US': 'Validation failed' })} · ${contractFailureKindLabel(contractMatch[1], locale)}` : undefined,
    previousFailureMatch?.[1]?.replace(/[.;]\s*$/, ''),
    reasonMatch?.[1]?.replace(/[.;]\s*$/, ''),
  ].filter((piece): piece is string => Boolean(piece));
  const compact = pieces.length ? Array.from(new Set(pieces)).join(' · ') : text;
  return compact.length > 260 ? `${compact.slice(0, 257).trim()}...` : compact;
}

function contractFailureKindLabel(kind: string, locale?: ResultLocale) {
  const labels: Record<string, Record<ResultLocale, string>> = {
    'payload-schema': { 'zh-CN': '结果格式', 'en-US': 'Result format' },
    'artifact-schema': { 'zh-CN': '结果内容', 'en-US': 'Result content' },
    reference: { 'zh-CN': '引用', 'en-US': 'Reference' },
    'ui-manifest': { 'zh-CN': '视图配置', 'en-US': 'View config' },
    'work-evidence': { 'zh-CN': '工作证据', 'en-US': 'Work evidence' },
    verifier: { 'zh-CN': '检查', 'en-US': 'Check' },
    unknown: { 'zh-CN': '未知', 'en-US': 'Unknown' },
  };
  return labels[kind] ? resultText(locale, labels[kind]) : kind;
}

function repairStateLabel(label: string, locale?: ResultLocale) {
  if (/acceptance/i.test(label)) return resultText(locale, { 'zh-CN': '验收恢复', 'en-US': 'Acceptance recovery' });
  if (/background/i.test(label)) return resultText(locale, { 'zh-CN': '后台恢复', 'en-US': 'Background recovery' });
  if (/repair/i.test(label)) return resultText(locale, { 'zh-CN': '恢复记录', 'en-US': 'Repair record' });
  return resultText(locale, { 'zh-CN': '恢复记录', 'en-US': 'Repair record' });
}

function ViewPlanSummary({ viewPlan, session, activeRun }: { viewPlan: RuntimeResolvedViewPlan; session: SciForgeSession; activeRun?: SciForgeRun; locale?: ResultLocale }) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  const presentationState = runPresentationState(session, activeRun, viewPlan);
  const diagnosticCount = projection
    ? projectionDiagnosticsForViewSummary(projection, presentationState)
    : contractValidationFailures(session, activeRun).length + failedExecutionUnits(session, activeRun).length;
  const runFailed = projection
    ? presentationState.kind === 'failed' || presentationState.kind === 'recoverable' || presentationState.kind === 'needs-human'
    : false;
  const summary = interactiveViewResultSummaryPresentation({
    items: viewPlan.allItems,
    diagnosticCount,
    runFailed,
  });
  return (
    <div className="view-plan-summary">
      <div>
        <Badge variant={summary.badgeVariant}>{summary.badgeLabel}</Badge>
        <strong>{rightPaneInlineLabel(viewPlan.displayIntent.primaryGoal)}</strong>
        <span>{boundedRightPaneText(summary.summaryText, 500)}</span>
      </div>
    </div>
  );
}

function projectionDiagnosticsForViewSummary(projection: UiConversationProjection, presentationState: RunPresentationState) {
  if (presentationState.kind === 'ready') return 0;
  return Math.max(
    projection.diagnostics.length,
    conversationProjectionStatus(projection) === 'satisfied' ? 0 : 1,
  );
}

function ViewPlanDetails({
  viewPlan,
  session,
  activeRun,
  items,
  locale,
}: {
  viewPlan: RuntimeResolvedViewPlan;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  items: ResultsRendererManifestDiagnostic[];
  locale?: ResultLocale;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="result-details-panel subtle"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '展示', 'en-US': 'Presentation' })}</span>
        <Badge variant="muted">{resultCountText(locale, items.length, {
          zh: (count) => `${count} 项`,
          en: (count) => `${count} items`,
        })}</Badge>
      </summary>
      {expanded ? (
        <>
          <ViewPlanSummary viewPlan={viewPlan} session={session} activeRun={activeRun} locale={locale} />
          <ManifestDiagnostics items={items} locale={locale} />
        </>
      ) : null}
    </details>
  );
}

function UIDesignBlockerCard({ blocker, locale }: { blocker: NonNullable<RuntimeResolvedViewPlan['blockedDesign']>; locale?: ResultLocale }) {
  return (
    <div className="ui-design-blocker">
      <Badge variant="warning">blocked-awaiting-ui-design</Badge>
      <strong>{resultText(locale, { 'zh-CN': '需要先设计并发布一个 UI 模块', 'en-US': 'Design and publish a UI module first' })}</strong>
      <p>{boundedRightPaneText(blocker.reason, 800)}</p>
      <div className="slot-meta">
        <code>{rightPaneInlineLabel(blocker.requiredModuleCapability)}</code>
        {blocker.resumeRunId ? <code>resumeRunId={rightPaneInlineLabel(blocker.resumeRunId)}</code> : null}
      </div>
    </div>
  );
}

function ObjectFocusBanner({
  reference,
  pinnedReferences,
  actions,
  error,
  notice,
  locale,
  onAction,
  onClear,
}: {
  reference: ObjectReference;
  pinnedReferences: ObjectReference[];
  actions: ObjectAction[];
  error?: string;
  notice?: string;
  locale?: ResultLocale;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
  onClear: () => void;
}) {
  const visibleActions = actions.filter((action) => action !== 'focus-right-pane');
  return (
    <div className="object-focus-banner">
      <div>
        <Badge variant="info">{objectReferenceKindLabel(reference.kind)}</Badge>
        <strong>{rightPaneInlineLabel(reference.title)}</strong>
        <span>{rightPaneInlineLabel(reference.summary || reference.ref)}</span>
      </div>
      <div className="object-focus-actions">
        {visibleActions.slice(0, 6).map((action) => (
          <button key={action} type="button" onClick={() => void onAction(reference, action)}>
            {objectActionLabel(action)}
          </button>
        ))}
        <button type="button" onClick={onClear}>{resultText(locale, { 'zh-CN': '清除', 'en-US': 'Clear' })}</button>
      </div>
      {pinnedReferences.length ? (
        <div className="pinned-object-row">
          <span>{resultText(locale, { 'zh-CN': '已固定', 'en-US': 'pinned' })}</span>
          {pinnedReferences.map((item) => <code key={item.id}>{rightPaneInlineLabel(item.title)}</code>)}
        </div>
      ) : null}
      {notice ? <p className="object-action-notice">{boundedRightPaneText(notice, 800)}</p> : null}
      {error ? <p className="object-action-error">{boundedRightPaneText(error, 800)}</p> : null}
    </div>
  );
}

function UIDesignStudioPanel({ viewPlan }: { viewPlan: RuntimeResolvedViewPlan }) {
  const moduleRows = uiModuleRegistry.map((module) => ({
    moduleId: `${module.moduleId}@${module.version}`,
    component: module.componentId,
    accepts: module.acceptsArtifactTypes.join(', '),
    lifecycle: module.lifecycle,
    section: module.defaultSection ?? 'supporting',
  }));
  const displayIntentErrors = validateRuntimeContract('displayIntent', viewPlan.displayIntent);
  const viewPlanErrors = validateRuntimeContract('resolvedViewPlan', {
    displayIntent: viewPlan.displayIntent,
    sections: viewPlan.sections,
    diagnostics: viewPlan.diagnostics,
    blockedDesign: viewPlan.blockedDesign,
  });
  const contractRows = (Object.keys(runtimeContractSchemas) as Array<keyof typeof runtimeContractSchemas>).map((name) => ({
    contract: name,
    status: name === 'displayIntent'
      ? displayIntentErrors.length ? 'invalid' : 'valid'
      : name === 'resolvedViewPlan'
        ? viewPlanErrors.length ? 'invalid' : 'valid'
        : 'registered',
    schema: runtimeContractSchemas[name].$id,
  }));
  const objectPreviewRows = [
    ...objectReferenceKinds.map((kind) => ({
      contract: 'objectReference.kind',
      value: kind,
      preview: kind === 'artifact' || kind === 'file' || kind === 'folder' || kind === 'url' ? 'focus/preview' : 'focus/audit',
    })),
    ...previewDescriptorKinds.map((kind) => ({
      contract: 'previewDescriptor.kind',
      value: kind,
      preview: kind === 'office' || kind === 'binary' ? 'system-open fallback' : kind === 'folder' ? 'folder summary/system-open' : 'inline or lazy derivative',
    })),
    ...artifactPreviewActions.map((action) => ({
      contract: 'preview action',
      value: action,
      preview: action === 'system-open' ? 'local default app' : 'workspace writer',
    })),
  ];
  return (
    <div className="stack">
      <SectionHeader icon={Sparkles} title="UI Design Studio" subtitle="Design modules first; runtime only composes published capabilities." />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} /> : (
        <div className="ui-design-blocker ready">
          <Badge variant="success">module match ready</Badge>
          <strong>Published UI modules can satisfy this view request</strong>
          <p>Runtime View Planner matched the modules. New display needs can become a View Preset or UI Module here.</p>
        </div>
      )}
      <div className="ui-module-package-preview">
        <div>
          <Badge variant="muted">UI Module Package Contract</Badge>
          <pre>{[
            'ui-module/',
            '  module.json',
            '  artifact.schema.json',
            '  view.schema.json',
            '  interactions.json',
            '  renderer',
            '  fixtures/',
            '  tests.json',
            '  preview.md',
          ].join('\n')}</pre>
        </div>
        <div>
          <Badge variant="info">DisplayIntent</Badge>
          <pre>{JSON.stringify(viewPlan.displayIntent, null, 2)}</pre>
        </div>
      </div>
      <div className="ui-design-contract-grid">
        <div className="ui-design-blocker ready">
          <Badge variant={displayIntentErrors.length || viewPlanErrors.length ? 'warning' : 'success'}>contract check</Badge>
          <strong>{displayIntentErrors.length || viewPlanErrors.length ? '当前 view contract 需要修复' : '当前 view contract 可复现'}</strong>
          <p>{[...displayIntentErrors, ...viewPlanErrors].join('; ') || 'DisplayIntent、ResolvedViewPlan 和 UI Module Package schema 已登记，运行期只做匹配、绑定和 blocker 恢复。'}</p>
        </div>
        <div className="ui-design-lifecycle">
          {['draft', 'validated', 'published', 'deprecated'].map((step) => (
            <span key={step}>
              <Badge variant={step === 'published' ? 'success' : 'muted'}>{step}</Badge>
              <small>{uiDesignLifecycleHint(step)}</small>
            </span>
          ))}
        </div>
      </div>
      <details className="view-plan-debug">
        <summary>查看 runtime contract schemas</summary>
        <div className="ui-module-package-preview">
          <pre>{schemaPreview('objectReference')}</pre>
          <pre>{schemaPreview('resolvedViewPlan')}</pre>
        </div>
      </details>
      <DataPreviewTable rows={contractRows} />
      <DataPreviewTable rows={objectPreviewRows} />
      <DataPreviewTable rows={moduleRows} />
    </div>
  );
}

function uiDesignLifecycleHint(step: string) {
  if (step === 'draft') return '对话生成草案，使用 fixture 预览';
  if (step === 'validated') return '通过 schema、smoke 和安全检查';
  if (step === 'published') return '运行期可被 View Planner 选择';
  return '历史可复现，新任务不再默认选择';
}

function ResultItemsSection({
  title,
  items,
  scenarioId,
  config,
  session,
  locale,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  title: string;
  items: ResolvedViewPlanItem[];
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  locale?: ResultLocale;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="view-plan-section">
      <div className="view-plan-section-head">
        <span>{title}</span>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      <div className="registry-grid">
        {items.map((item) => (
          <RegistrySlot
            key={item.id}
            scenarioId={scenarioId}
            config={config}
            session={session}
            item={item}
            onArtifactHandoff={onArtifactHandoff}
            onInspectArtifact={onInspectArtifact}
            onObjectReferenceFocus={onObjectReferenceFocus}
            onDismissResultSlotPresentation={onDismissResultSlotPresentation}
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}

function DataPreviewTable({ rows, locale }: { rows: Record<string, unknown>[]; locale?: ResultLocale }) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8);
  if (!rows.length || !columns.length) return <p className="empty-state">{resultText(locale, { 'zh-CN': '没有可展示的行。', 'en-US': 'No rows to display.' })}</p>;
  return (
    <div className="data-preview-table">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{humanizeKey(column)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column}>{compactParams(rightPaneInlineLabel(formatCellValue(row[column])))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (typeof value === 'string') return boundedRightPaneText(value, 800);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatCellValue).join(', ');
  if (isRecord(value)) return boundedRightPaneText(JSON.stringify(value), 800);
  return '';
}

function humanizeKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ManifestDiagnostics({ items, locale }: { items: ResultsRendererManifestDiagnostic[]; locale?: ResultLocale }) {
  return (
    <div className="manifest-diagnostics">
      {items.map((item) => (
        <code key={item.id} title={rightPaneInlineLabel(item.detail)}>
          {rightPaneInlineLabel(item.label)} · {resultStatusLabel(item.status, locale)}
        </code>
      ))}
    </div>
  );
}

function resultStatusLabel(status: string, locale?: ResultLocale) {
  if (status === 'bound') return resultText(locale, { 'zh-CN': '可用', 'en-US': 'Ready' });
  if (status === 'fallback') return resultText(locale, { 'zh-CN': '备用视图', 'en-US': 'Alternate view' });
  if (status === 'missing-artifact') return resultText(locale, { 'zh-CN': '等待内容', 'en-US': 'Waiting for content' });
  if (status === 'missing-component') return resultText(locale, { 'zh-CN': '等待视图', 'en-US': 'Waiting for view' });
  return resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' });
}
