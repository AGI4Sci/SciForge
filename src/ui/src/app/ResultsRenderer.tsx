import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, FolderTree, Globe2, Lock, Monitor, Shield, Sparkles, Terminal } from 'lucide-react';
import type { ScenarioId } from '../data';
import { artifactPreviewActions, objectReferenceKinds, previewDescriptorKinds, runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { listWorkspace, loadSciForgeInstanceManifest, readPreviewDerivative, readPreviewDescriptor, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry } from '../uiModuleRegistry';
import { interactiveViewResultSummaryPresentation } from '../../../../packages/presentation/interactive-views';
import {
  browserWorkbenchDefaultCommands,
  normalizeBrowserWorkbenchUrl,
  renderBrowserWorkbench,
  renderTerminalSessionViewer,
  renderVirtualScreenViewer,
  renderWorkspaceFileViewer,
  workspaceFileViewerBasename,
  workspaceFileViewerParentPath,
  type BrowserWorkbenchCommand,
  type TerminalSessionAdapter,
  type TerminalSessionStatus,
  type VirtualScreenFrame,
  type VirtualScreenPayload,
  type WorkspaceFileViewerEntry,
  type WorkspaceFileViewerFile,
  type WorkspaceFileViewerProps,
} from '../../../../packages/presentation/components';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import { exportJsonFile } from './exportUtils';
import { Badge, Card, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';
import { ResultShell, type ResultFocusMode, type ResultPaneTab, type ResultPaneTabInstance } from './results/ResultShell';
import { PreviewDescriptorActions } from './results/PreviewActions';
import { ExecutionPanel, NotebookTimeline } from './results/ExecutionNotebookPanels';
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
import { type SciForgeConfig, type SciForgeRun, type SciForgeSession, type ObjectAction, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type RuntimeCompatibilityDiagnostic, type RuntimeExecutionUnit, type UIManifestSlot } from '../domain';
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
  objectReferenceForArtifactSummary,
  pathForObjectReference,
  referenceKindForWorkspaceFileLike,
  referenceForObjectReference,
  referenceForWorkspaceFileLike,
  sciForgeReferenceAttribute,
  toWorkspaceRelativePath,
  withRegionLocator,
} from '../../../../packages/support/object-references';
import {
  objectActionLabel,
  performObjectReferenceAction,
  resultTabForObjectReference,
} from './results-renderer-object-actions';
import { ArtifactInspectorDrawer } from './results-renderer-artifact-inspector';
import {
  RegistrySlot,
  renderRegisteredWorkbenchSlot,
  type WorkbenchSlotRenderProps,
} from './results-renderer-registry-slot';
import {
  createCommandTextUIAction,
  createRecoverCommandTextUIAction,
  type CommandTextUIAction,
  type OpenDebugAuditUIAction,
} from './uiActionBoundary';
import { capabilityPlanSummaryForSession, createLocalUserActionApi, type CapabilityPlanSummary, type UserActionApi } from './projectionApi';

export { renderRegisteredWorkbenchSlot };
export type { WorkbenchSlotRenderProps };

export type WorkspaceFileEditorState = {
  file: WorkspaceFileContent & WorkspaceFileViewerFile;
  draft: string;
  workspacePath?: string;
  focusRequestKey?: string;
  editMode?: boolean;
};

export type WorkspaceFileEditorsByTabId = Record<string, WorkspaceFileEditorState | undefined>;

const WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES = 1024 * 1024;

export function setWorkspaceFileEditorForTab(
  current: WorkspaceFileEditorsByTabId,
  tabId: string,
  next: WorkspaceFileEditorState | null,
): WorkspaceFileEditorsByTabId {
  if (!tabId) return current;
  const updated = { ...current };
  if (next) updated[tabId] = next;
  else delete updated[tabId];
  return updated;
}

export function removeWorkspaceFileEditorForTab(current: WorkspaceFileEditorsByTabId, tabId: string): WorkspaceFileEditorsByTabId {
  if (!tabId || !(tabId in current)) return current;
  const updated = { ...current };
  delete updated[tabId];
  return updated;
}

export function cancelWorkspaceFileEditorEdit(state: WorkspaceFileEditorState): WorkspaceFileEditorState {
  return { ...state, draft: state.file.content, editMode: false };
}

function workspaceFileEditorMimeLooksText(mimeType: string | undefined) {
  if (!mimeType) return true;
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || /(?:json|xml|yaml|toml|csv|markdown|javascript|typescript|x-sh|x-python|x-ruby|x-php|x-java|x-c|x-c\+\+)/.test(normalized);
}

function workspaceFileEditorCanEditFile(file: WorkspaceFileEditorState['file'] | null | undefined) {
  return Boolean(file && !file.readOnly && !workspaceFileEditorUnsupportedKind(file));
}

function workspaceFileEditorUnsupportedKind(file: WorkspaceFileEditorState['file'] | null | undefined): WorkspaceFileViewerFile['unsupportedKind'] | undefined {
  if (!file) return undefined;
  if (file.unsupportedKind) return file.unsupportedKind;
  if (file.encoding === 'base64') return 'binary';
  if (!workspaceFileEditorMimeLooksText(file.mimeType)) return 'binary';
  if (typeof file.size === 'number' && file.size > WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES) return 'too-large';
  if (file.contentUnavailable) return 'unsupported';
  return undefined;
}

function workspaceFileWithInlinePolicy(file: WorkspaceFileContent & WorkspaceFileViewerFile): WorkspaceFileEditorState['file'] {
  const unsupportedKind = workspaceFileEditorUnsupportedKind(file);
  if (!unsupportedKind) return file;
  return {
    ...file,
    content: '',
    readOnly: true,
    contentUnavailable: true,
    unsupportedKind,
  };
}

function workspaceFileEditorWithEditMode(state: WorkspaceFileEditorState, editMode: boolean): WorkspaceFileEditorState {
  return { ...state, editMode: editMode && workspaceFileEditorCanEditFile(state.file) };
}

function workspaceFileViewerDraftForFile(file: WorkspaceFileEditorState['file']) {
  return workspaceFileEditorCanEditFile(file) ? file.content : '';
}

function workspaceDisplayPathForPath(workspaceRoot: string, path: string) {
  const relative = toWorkspaceRelativePath(workspaceRoot, path);
  if (relative === '.') return workspaceFileViewerBasename(workspaceRoot) || '.';
  return relative || workspaceFileViewerBasename(path) || path;
}

function workspaceCopyRefForPath(workspaceRoot: string, path: string) {
  const relative = toWorkspaceRelativePath(workspaceRoot, path);
  return relative === '.' ? 'workspace:.' : `file:${relative}`;
}

function tooLargeWorkspaceFileFromEntry(entry: WorkspaceFileViewerEntry): WorkspaceFileEditorState['file'] | undefined {
  if (typeof entry.size !== 'number' || entry.size <= WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES) return undefined;
  return {
    path: entry.path,
    name: entry.name,
    content: '',
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    language: 'unsupported',
    encoding: 'utf8',
    readOnly: true,
    contentUnavailable: true,
    unsupportedKind: 'too-large',
  };
}

function ResultPaneWorkspaceFileViewer({
  state,
  config,
  locale,
  onChange,
  onClose,
}: {
  state: WorkspaceFileEditorState;
  config: SciForgeConfig;
  locale?: ResultLocale;
  onChange: (next: WorkspaceFileEditorState) => void;
  onClose: () => void;
}) {
  const workspaceRoot = normalizeWorkspaceRootPath(state.workspacePath || config.workspacePath);
  const dirty = state.draft !== state.file.content;
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceFileViewerEntry[] | undefined>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const canEditFile = workspaceFileEditorCanEditFile(state.file);
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
    const tooLargeFile = tooLargeWorkspaceFileFromEntry(entry);
    if (tooLargeFile) {
      onChange({ ...state, file: tooLargeFile, draft: '', workspacePath: workspaceRoot, editMode: false });
      setWorkspaceError('');
      setSaveError('');
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开只读元数据：${entry.name}`, 'en-US': `Opened read-only metadata for ${entry.name}` }));
      return;
    }
    try {
      setWorkspaceError('');
      const file = workspaceFileWithInlinePolicy(await readWorkspaceFile(entry.path, config));
      onChange({ ...state, file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开 ${file.name}`, 'en-US': `Opened ${file.name}` }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  async function save() {
    if (!canEditFile) return;
    try {
      setSaveError('');
      const file = workspaceFileWithInlinePolicy(await writeWorkspaceFile(state.file.path, state.draft, config));
      onChange({ ...state, file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
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
      {renderWorkspaceFileViewer({
        slot: {
          componentId: 'workspace-file-viewer',
          title: workspaceFileViewerLabels(locale).title,
          props: {
            rootPath: workspaceRoot,
            rootLabel: workspaceFileViewerBasename(workspaceRoot),
            entriesByFolder: folderChildren,
            expandedFolderPaths: Array.from(expandedFolders),
            selectedPath: state.file.path,
            file: state.file,
            treePageSize: 200,
            inlineTextLimitBytes: WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES,
            draft: state.draft,
            dirty: dirty && canEditFile,
            editMode: Boolean(state.editMode && canEditFile),
            notice: workspaceNotice,
            error: boundedRightPaneText(workspaceError, 800),
            saveError: boundedRightPaneText(saveError, 800),
            labels: workspaceFileViewerLabels(locale),
            displayPathForPath: (path: string) => workspaceDisplayPathForPath(workspaceRoot, path),
            copyPathForPath: (path: string) => workspaceCopyRefForPath(workspaceRoot, path),
            onToggleFolder: toggleFolder,
            onOpenFile: (entry: WorkspaceFileViewerEntry) => void openFile(entry),
            onRefresh: () => void refreshTree(),
            onCollapseAll: collapseTree,
            onDraftChange: (draft: string) => {
              if (state.editMode && canEditFile) onChange({ ...state, draft });
            },
            onEditModeChange: (editMode: boolean) => onChange(workspaceFileEditorWithEditMode(state, editMode)),
            onSave: () => void save(),
            onCancel: () => onChange(cancelWorkspaceFileEditorEdit(state)),
            onClose,
            onCopyPath: (path: string) => void navigator.clipboard?.writeText(path),
            onCopyContents: (content: string) => void navigator.clipboard?.writeText(content),
          } satisfies Partial<WorkspaceFileViewerProps> as Record<string, unknown>,
        },
        artifact: {
          id: `workspace-file-view:${state.file.path}`,
          type: 'workspace-file-view',
          producerScenario: 'workspace-file-viewer',
          schemaVersion: 'sciforge.workspace-file-view.v1',
          data: {
            rootPath: workspaceRoot,
            selectedPath: state.file.path,
            file: state.file,
            dirty: dirty && canEditFile,
          },
        },
        config,
      })}
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

export function workspaceFileFocusRequestKey(reference: ObjectReference | undefined, path: string) {
  if (!reference || !path.trim()) return '';
  return [
    reference.kind,
    reference.id,
    reference.runId ?? '',
    reference.ref,
    reference.provenance?.path ?? '',
    path.trim(),
  ].join('|');
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

async function readFocusedWorkspaceFile({
  path,
  config,
  reference,
}: {
  path: string;
  config: SciForgeConfig;
  reference?: ObjectReference;
}): Promise<{ file: WorkspaceFileContent; workspacePath: string }> {
  const primaryWorkspacePath = normalizeWorkspaceRootPath(config.workspacePath);
  try {
    const file = workspaceFileWithInlinePolicy(await readWorkspaceFile(path, config));
    return { file, workspacePath: primaryWorkspacePath };
  } catch (primaryError) {
    if (!shouldTryRepoRootWorkspaceFallback(reference, path)) throw primaryError;
    const repoRoot = await repoRootWorkspaceFallback(config).catch(() => '');
    if (!repoRoot || repoRoot === primaryWorkspacePath) throw primaryError;
    try {
      const file = workspaceFileWithInlinePolicy(await readWorkspaceFile(path, { ...config, workspacePath: repoRoot }));
      return { file, workspacePath: repoRoot };
    } catch {
      throw primaryError;
    }
  }
}

export function shouldTryRepoRootWorkspaceFallback(reference: ObjectReference | undefined, path: string) {
  return reference?.kind === 'file' && isSafeRepoRelativeFilePath(path);
}

function isSafeRepoRelativeFilePath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^file::?/i, '');
  if (!normalized || normalized.startsWith('/')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return false;
  return normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}

async function repoRootWorkspaceFallback(config: SciForgeConfig) {
  const manifest = await loadSciForgeInstanceManifest(config);
  const repoRoot = manifest.repo.detected && typeof manifest.repo.root === 'string'
    ? manifest.repo.root
    : '';
  return normalizeWorkspaceRootPath(repoRoot);
}

function workspaceFileViewerLabels(locale?: ResultLocale) {
  return {
    title: resultText(locale, { 'zh-CN': '工作区文件', 'en-US': 'Workspace files' }),
    treeLabel: resultText(locale, { 'zh-CN': '工作区文件树', 'en-US': 'Workspace file tree' }),
    editorLabel: resultText(locale, { 'zh-CN': '工作区文件编辑器', 'en-US': 'Workspace file editor' }),
    readOnly: resultText(locale, { 'zh-CN': '只读', 'en-US': 'Read only' }),
    editing: resultText(locale, { 'zh-CN': '编辑中', 'en-US': 'Editing' }),
    edit: resultText(locale, { 'zh-CN': '编辑', 'en-US': 'Edit' }),
    loading: resultText(locale, { 'zh-CN': '加载中...', 'en-US': 'Loading...' }),
    emptyTree: resultText(locale, { 'zh-CN': '没有可显示的文件。', 'en-US': 'No files to show.' }),
    emptyEditor: resultText(locale, { 'zh-CN': '选择一个文件查看内容。', 'en-US': 'Select a file to inspect it.' }),
    refresh: resultText(locale, { 'zh-CN': '刷新目录', 'en-US': 'Refresh tree' }),
    collapseAll: resultText(locale, { 'zh-CN': '折叠目录', 'en-US': 'Collapse tree' }),
    searchPlaceholder: resultText(locale, { 'zh-CN': '搜索文件', 'en-US': 'Search files' }),
    noSearchResults: resultText(locale, { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' }),
    copyPath: resultText(locale, { 'zh-CN': '复制路径', 'en-US': 'Copy path' }),
    copyContents: resultText(locale, { 'zh-CN': '复制内容', 'en-US': 'Copy contents' }),
    save: resultText(locale, { 'zh-CN': '保存文件', 'en-US': 'Save file' }),
    cancel: resultText(locale, { 'zh-CN': '取消', 'en-US': 'Cancel' }),
    close: resultText(locale, { 'zh-CN': '关闭文件视图', 'en-US': 'Close file view' }),
    saved: resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' }),
    unsaved: resultText(locale, { 'zh-CN': '未保存', 'en-US': 'Unsaved' }),
    unsupported: resultText(locale, { 'zh-CN': '不支持预览', 'en-US': 'Unsupported file' }),
    binaryUnsupported: resultText(locale, { 'zh-CN': '二进制文件在此视图中只读。', 'en-US': 'Binary files are read-only in this viewer.' }),
    tooLargeUnsupported: resultText(locale, { 'zh-CN': '文件过大，已切换为只读元数据视图。', 'en-US': 'This file is too large for inline editing.' }),
    readOnlyReason: resultText(locale, { 'zh-CN': '该文件为只读。', 'en-US': 'This file is read-only.' }),
  };
}

const DEFAULT_RIGHT_PANE_TABS: ResultPaneTab[] = ['primary', 'browser', 'screen', 'terminal', 'files', 'evidence'];

export type RightPaneFocusTarget =
  | { kind: 'tab'; tabId: string }
  | { kind: 'new-button' };

export interface RightPaneTabLifecycleState {
  tabs: ResultPaneTabInstance[];
  activeTabId: string;
  browserTabAddresses: Record<string, string>;
}

export interface RightPaneTabLifecycleTransition extends RightPaneTabLifecycleState {
  focusTarget: RightPaneFocusTarget;
}

function baseResultPaneTabId(kind: ResultPaneTab) {
  return `base:${kind}`;
}

function resultPaneTabInstanceLabel(kind: ResultPaneTab, index: number, locale?: ResultLocale) {
  const label = resultText(locale, {
    'zh-CN': kind === 'primary'
      ? '结果'
      : kind === 'browser'
        ? '浏览器'
        : kind === 'screen'
          ? '屏幕'
          : kind === 'terminal'
            ? '终端'
            : kind === 'files'
              ? '文件'
              : '引用',
    'en-US': kind === 'primary'
      ? 'Results'
      : kind === 'browser'
        ? 'Browser'
        : kind === 'screen'
          ? 'Screen'
          : kind === 'terminal'
            ? 'Terminal'
            : kind === 'files'
              ? 'Files'
              : 'References',
  });
  return index > 1 ? `${label} ${index}` : label;
}

export function createDefaultRightPaneTabs(locale?: ResultLocale): ResultPaneTabInstance[] {
  return DEFAULT_RIGHT_PANE_TABS.map((kind) => ({
    id: baseResultPaneTabId(kind),
    kind,
    label: resultPaneTabInstanceLabel(kind, 1, locale),
    closable: true,
  }));
}

function nextResultPaneTabIndex(tabs: readonly ResultPaneTabInstance[], kind: ResultPaneTab) {
  return tabs.filter((tab) => tab.kind === kind).length + 1;
}

interface StoredRightPaneState {
  tabs: ResultPaneTabInstance[];
  activeTabId: string;
  browserTabAddresses: Record<string, string>;
}

export function addRightPaneTabLifecycleState(
  state: RightPaneTabLifecycleState,
  tab: ResultPaneTab,
  locale?: ResultLocale,
  now = Date.now(),
): RightPaneTabLifecycleTransition {
  const nextIndex = nextResultPaneTabIndex(state.tabs, tab);
  const nextTab: ResultPaneTabInstance = {
    id: `custom:${tab}:${now}:${nextIndex}`,
    kind: tab,
    label: resultPaneTabInstanceLabel(tab, nextIndex, locale),
    closable: true,
  };
  return {
    tabs: [...state.tabs, nextTab],
    activeTabId: nextTab.id,
    browserTabAddresses: state.browserTabAddresses,
    focusTarget: { kind: 'tab', tabId: nextTab.id },
  };
}

export function closeRightPaneTabLifecycleState(
  state: RightPaneTabLifecycleState,
  tabId: string,
): RightPaneTabLifecycleTransition {
  const targetIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (targetIndex < 0) {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return {
      ...state,
      focusTarget: activeTab ? { kind: 'tab', tabId: activeTab.id } : { kind: 'new-button' },
    };
  }
  const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
  const browserTabAddresses = removeBrowserTabAddress(state.browserTabAddresses, tabId);
  if (!nextTabs.length) {
    return {
      tabs: nextTabs,
      activeTabId: '',
      browserTabAddresses,
      focusTarget: { kind: 'new-button' },
    };
  }
  if (state.activeTabId !== tabId && nextTabs.some((tab) => tab.id === state.activeTabId)) {
    return {
      tabs: nextTabs,
      activeTabId: state.activeTabId,
      browserTabAddresses,
      focusTarget: { kind: 'tab', tabId: state.activeTabId },
    };
  }
  const fallback = nextTabs[Math.max(0, targetIndex - 1)] ?? nextTabs[0];
  return {
    tabs: nextTabs,
    activeTabId: fallback.id,
    browserTabAddresses,
    focusTarget: { kind: 'tab', tabId: fallback.id },
  };
}

function removeBrowserTabAddress(addresses: Record<string, string>, tabId: string) {
  if (!(tabId in addresses)) return addresses;
  const { [tabId]: _removed, ...rest } = addresses;
  return rest;
}

function browserTabAddressesForOpenTabs(addresses: Record<string, string>, tabs: readonly ResultPaneTabInstance[]) {
  const openTabIds = new Set(tabs.map((tab) => tab.id));
  const filtered: Record<string, string> = {};
  for (const [id, address] of Object.entries(addresses)) {
    if (openTabIds.has(id)) filtered[id] = address;
  }
  return filtered;
}

function queueRightPaneFocus(target: RightPaneFocusTarget) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.setTimeout(() => {
    const element = target.kind === 'tab'
      ? document.getElementById(`result-tab-${target.tabId.replace(/[^A-Za-z0-9_-]/g, '-')}`)
      : document.querySelector<HTMLButtonElement>('.result-new-tab-button');
    element?.focus();
  }, 0);
}

function rightPaneStateStorageKey(workspacePath: string | undefined) {
  return `sciforge.right-pane-state.v1.${workspacePath || 'default'}`;
}

function isResultPaneTab(value: unknown): value is ResultPaneTab {
  return value === 'primary'
    || value === 'browser'
    || value === 'screen'
    || value === 'terminal'
    || value === 'files'
    || value === 'evidence';
}

function normalizeStoredRightPaneTabs(value: unknown, locale?: ResultLocale) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tabs: ResultPaneTabInstance[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isResultPaneTab(item.kind)) continue;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : baseResultPaneTabId(item.kind);
    if (seen.has(id)) continue;
    seen.add(id);
    tabs.push({
      id,
      kind: item.kind,
      label: typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : resultPaneTabInstanceLabel(item.kind, nextResultPaneTabIndex(tabs, item.kind), locale),
      closable: true,
    });
  }
  return tabs;
}

function normalizeStoredBrowserTabAddresses(value: unknown) {
  if (!isRecord(value)) return {};
  const addresses: Record<string, string> = {};
  for (const [id, address] of Object.entries(value)) {
    if (typeof address === 'string') addresses[id] = address;
  }
  return addresses;
}

function loadStoredRightPaneState(storageKey: string, locale: ResultLocale | undefined, initialResultTab: ResultPaneTab): StoredRightPaneState {
  const fallbackTabs = createDefaultRightPaneTabs(locale);
  const fallbackActive = fallbackTabs.find((tab) => tab.kind === initialResultTab)?.id ?? fallbackTabs[0]?.id ?? '';
  if (typeof window === 'undefined') {
    return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
    const tabs = Array.isArray(parsed.tabs)
      ? normalizeStoredRightPaneTabs(parsed.tabs, locale)
      : fallbackTabs;
    const activeTabId = typeof parsed.activeTabId === 'string' && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs.find((tab) => tab.kind === initialResultTab)?.id ?? tabs[0]?.id ?? '';
    return {
      tabs,
      activeTabId,
      browserTabAddresses: browserTabAddressesForOpenTabs(normalizeStoredBrowserTabAddresses(parsed.browserTabAddresses), tabs),
    };
  } catch {
    return { tabs: fallbackTabs, activeTabId: fallbackActive, browserTabAddresses: {} };
  }
}

function saveStoredRightPaneState(storageKey: string, state: StoredRightPaneState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // UI state persistence should never break the workbench.
  }
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
  initialResultTab = 'primary',
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
  workspaceFileEditor: WorkspaceFileEditorState | null;
  onWorkspaceFileEditorChange: (next: WorkspaceFileEditorState | null) => void;
  /** Hide a resolved results card from the UI only (artifacts and workspace files stay). */
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  /** Test hook for rendering a non-default focus mode without browser events. */
  initialFocusMode?: ResultFocusMode;
  /** Test hook for rendering a non-default right-pane tab without browser events. */
  initialResultTab?: ResultPaneTab;
}) {
  const locale = resultLocale(config.locale);
  const rightPaneStorageKey = rightPaneStateStorageKey(config.workspacePath);
  const initialRightPaneState = useRef<StoredRightPaneState | undefined>(undefined);
  if (!initialRightPaneState.current) {
    initialRightPaneState.current = loadStoredRightPaneState(rightPaneStorageKey, locale, initialResultTab);
  }
  const [resultTabs, setResultTabs] = useState<ResultPaneTabInstance[]>(() => initialRightPaneState.current?.tabs ?? createDefaultRightPaneTabs(locale));
  const [activeResultTabId, setActiveResultTabId] = useState(initialRightPaneState.current?.activeTabId ?? baseResultPaneTabId(initialResultTab));
  const [browserTabAddresses, setBrowserTabAddresses] = useState<Record<string, string>>(() => initialRightPaneState.current?.browserTabAddresses ?? {});
  const [workspaceFileEditorsByTabId, setWorkspaceFileEditorsByTabId] = useState<WorkspaceFileEditorsByTabId>(() => (
    workspaceFileEditor ? { [baseResultPaneTabId('files')]: workspaceFileEditorWithEditMode(workspaceFileEditor, Boolean(workspaceFileEditor.editMode)) } : {}
  ));
  const [focusMode, setFocusMode] = useState<ResultFocusMode>(initialFocusMode);
  const [inspectedArtifact, setInspectedArtifact] = useState<RuntimeArtifact | undefined>();
  const [pinnedObjectReferences, setPinnedObjectReferences] = useState<ObjectReference[]>([]);
  const [objectActionError, setObjectActionError] = useState('');
  const [objectActionNotice, setObjectActionNotice] = useState('');
  const activeResultTab = resultTabs.find((tab) => tab.id === activeResultTabId);
  const resultTab = activeResultTab?.kind ?? 'primary';
  const activeFilesWorkspaceFileEditor = resultTab === 'files'
    ? workspaceFileEditorsByTabId[activeResultTabId] ?? null
    : null;
  const hasOpenRightPaneTabs = resultTabs.length > 0 && Boolean(activeResultTab);
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
  useEffect(() => {
    saveStoredRightPaneState(rightPaneStorageKey, {
      tabs: resultTabs,
      activeTabId: activeResultTabId,
      browserTabAddresses,
    });
  }, [activeResultTabId, browserTabAddresses, resultTabs, rightPaneStorageKey]);
  function activateResultTabKind(tab: ResultPaneTab) {
    const existingTabId = resultTabs.find((item) => item.kind === tab)?.id ?? baseResultPaneTabId(tab);
    setActiveResultTabId(existingTabId);
    if (tab === 'evidence') {
      setFocusMode('evidence');
      return;
    }
    if (tab === 'terminal') {
      setFocusMode('execution');
      return;
    }
    if (focusMode === 'evidence' || focusMode === 'execution') setFocusMode('all');
  }
  function handleResultTabChange(tabId: string) {
    const tab = resultTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveResultTabId(tab.id);
    if (tab.kind === 'evidence') {
      setFocusMode('evidence');
      return;
    }
    if (tab.kind === 'terminal') {
      setFocusMode('execution');
      return;
    }
    if (focusMode === 'evidence' || focusMode === 'execution') setFocusMode('all');
  }
  function handleNewResultTab(tab: ResultPaneTab) {
    setResultTabs((current) => {
      const nextState = addRightPaneTabLifecycleState({
        tabs: current,
        activeTabId: activeResultTabId,
        browserTabAddresses,
      }, tab, locale);
      setActiveResultTabId(nextState.activeTabId);
      queueRightPaneFocus(nextState.focusTarget);
      return nextState.tabs;
    });
    if (tab === 'evidence') setFocusMode('evidence');
    else if (tab === 'terminal') setFocusMode('execution');
    else if (focusMode === 'evidence' || focusMode === 'execution') setFocusMode('all');
  }
  function handleCloseResultTab(tabId: string) {
    setWorkspaceFileEditorsByTabId((current) => removeWorkspaceFileEditorForTab(current, tabId));
    setResultTabs((current) => {
      const nextState = closeRightPaneTabLifecycleState({
        tabs: current,
        activeTabId: activeResultTabId,
        browserTabAddresses,
      }, tabId);
      setBrowserTabAddresses(nextState.browserTabAddresses);
      setActiveResultTabId(nextState.activeTabId);
      const nextActiveTab = nextState.tabs.find((tab) => tab.id === nextState.activeTabId);
      if (!nextActiveTab) {
        if (focusMode === 'evidence' || focusMode === 'execution') setFocusMode('all');
      } else if (nextActiveTab.kind === 'evidence') setFocusMode('evidence');
      else if (nextActiveTab.kind === 'terminal') setFocusMode('execution');
      else if (focusMode === 'evidence' || focusMode === 'execution') setFocusMode('all');
      queueRightPaneFocus(nextState.focusTarget);
      return nextState.tabs;
    });
  }
  function handleFocusModeChange(mode: ResultFocusMode) {
    setFocusMode(mode);
    if (mode === 'evidence') activateResultTabKind('evidence');
    if (mode === 'execution') activateResultTabKind('terminal');
    if (mode === 'visual') activateResultTabKind('primary');
  }
  function requestCommandText(commandText: string, label?: string, targetRef?: string) {
    if (!commandText.trim()) return;
    onCommandTextAction?.(createCommandTextUIAction({
      session,
      id: actionId('command-right-pane'),
      createdAt: new Date().toISOString(),
      source: 'open',
      commandText,
      label,
      targetRef,
    }));
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
    if (result.resultTab) activateResultTabKind(result.resultTab);
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
  const focusedWorkspaceFileRequestKey = useMemo(
    () => workspaceFileFocusRequestKey(focusedObjectReference, focusedWorkspaceFilePath),
    [focusedObjectReference, focusedWorkspaceFilePath],
  );
  const focusedWorkspaceRoot = useMemo(
    () => focusedWorkspaceRootForReference(focusedObjectReference, session, config.workspacePath),
    [config.workspacePath, focusedObjectReference, session],
  );
  const workspaceFileConfig = useMemo(
    () => {
      const editor = activeFilesWorkspaceFileEditor ?? workspaceFileEditor;
      const editorRoot = activeFilesWorkspaceFileEditor?.workspacePath
        || (editor?.focusRequestKey === focusedWorkspaceFileRequestKey
        ? editor?.workspacePath
        : undefined);
      const root = normalizeWorkspaceRootPath(editorRoot || focusedWorkspaceRoot);
      return root && root !== normalizeWorkspaceRootPath(config.workspacePath)
        ? { ...config, workspacePath: root }
        : config;
    },
    [activeFilesWorkspaceFileEditor, config, focusedWorkspaceFileRequestKey, focusedWorkspaceRoot, workspaceFileEditor],
  );
  useEffect(() => {
    if (executionFocus || !focusedWorkspaceFilePath) return undefined;
    const currentEditor = resultTab === 'files' ? activeFilesWorkspaceFileEditor : workspaceFileEditor;
    if (currentEditor?.focusRequestKey === focusedWorkspaceFileRequestKey) return undefined;
    if (workspaceFileEditorMatchesPath(currentEditor?.file.path, focusedWorkspaceFilePath, workspaceFileConfig.workspacePath)) return undefined;
    let cancelled = false;
    setObjectActionError('');
    void readFocusedWorkspaceFile({
      path: focusedWorkspaceFilePath,
      config: workspaceFileConfig,
      reference: focusedObjectReference,
    })
      .then(({ file, workspacePath }) => {
        if (cancelled) return;
        const nextEditor = {
          file,
          draft: workspaceFileViewerDraftForFile(file),
          workspacePath,
          focusRequestKey: focusedWorkspaceFileRequestKey,
          editMode: false,
        };
        if (resultTab === 'files') {
          setWorkspaceFileEditorsByTabId((current) => setWorkspaceFileEditorForTab(current, activeResultTabId, nextEditor));
        } else {
          onWorkspaceFileEditorChange(nextEditor);
        }
      })
      .catch((error) => {
        if (!cancelled) setObjectActionError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeFilesWorkspaceFileEditor,
    activeResultTabId,
    executionFocus,
    focusedWorkspaceFilePath,
    focusedWorkspaceFileRequestKey,
    focusedObjectReference,
    onWorkspaceFileEditorChange,
    resultTab,
    workspaceFileConfig,
    workspaceFileEditor,
  ]);

  return (
    <ResultShell
      collapsed={collapsed}
      activeTabId={activeResultTabId}
      resultTab={resultTab}
      resultTabs={resultTabs}
      focusMode={focusMode}
      activeRun={activeRun}
      scenarioId={scenarioId}
      locale={locale}
      onToggleCollapse={onToggleCollapse}
      onResultTabChange={handleResultTabChange}
      onNewResultTab={handleNewResultTab}
      onCloseResultTab={handleCloseResultTab}
      onFocusModeChange={handleFocusModeChange}
      onActiveRunChange={onActiveRunChange}
      showActiveRunBanner={resultTab === 'primary'}
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
            {!hasOpenRightPaneTabs ? (
              <RightPaneEmptyWorkspace locale={locale} />
            ) : (
              <>
            {resultTab !== 'files' && workspaceFileEditor ? (
              <ResultPaneWorkspaceFileViewer
                state={workspaceFileEditor}
                config={workspaceFileConfig}
                locale={locale}
                onChange={onWorkspaceFileEditorChange}
                onClose={() => {
                  onWorkspaceFileEditorChange(null);
                  onFocusedObjectChange(undefined);
                }}
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
            {resultTab === 'browser' ? (
              <RightPaneBrowserTool
                key={activeResultTabId}
                tabId={activeResultTabId}
                config={config}
                session={session}
                locale={locale}
                addressDraft={browserTabAddresses[activeResultTabId] ?? 'about:blank'}
                onAddressDraftChange={(nextAddress) => {
                  setBrowserTabAddresses((current) => ({
                    ...current,
                    [activeResultTabId]: nextAddress,
                  }));
                }}
                onCommandRequest={requestCommandText}
              />
            ) : resultTab === 'screen' ? (
              <RightPaneVirtualScreenTool
                key={activeResultTabId}
                config={config}
                session={session}
                activeRun={activeRun}
                locale={locale}
                onCommandRequest={requestCommandText}
              />
            ) : resultTab === 'terminal' ? (
              <RightPaneTerminalTool
                key={activeResultTabId}
                session={session}
                activeRun={activeRun}
                locale={locale}
                onCommandRequest={requestCommandText}
              />
            ) : resultTab === 'files' ? (
              <RightPaneFilesTool
                key={activeResultTabId}
                config={workspaceFileConfig}
                locale={locale}
                state={activeFilesWorkspaceFileEditor}
                onChange={(nextEditor) => {
                  setWorkspaceFileEditorsByTabId((current) => setWorkspaceFileEditorForTab(current, activeResultTabId, nextEditor));
                }}
              />
            ) : resultTab === 'primary' ? (
              <PrimaryResult
                key={activeResultTabId}
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
                onWorkbenchToolSelect={activateResultTabKind}
              />
            ) : resultTab === 'evidence' ? (
              <RightPaneReferencesTool
                key={activeResultTabId}
                session={session}
                activeRun={activeRun}
                pinnedReferences={pinnedObjectReferences}
                locale={locale}
                onAction={handleObjectAction}
              />
            ) : null}
              </>
            )}
    </ResultShell>
  );
}

function RightPaneEmptyWorkspace({ locale }: { locale?: ResultLocale }) {
  return (
    <div className="right-pane-empty-workspace" data-testid="right-pane-empty-workspace">
      <strong>{resultText(locale, { 'zh-CN': '没有打开的页面', 'en-US': 'No pages open' })}</strong>
      <span>{resultText(locale, { 'zh-CN': '使用顶部 New 打开 Results、Browser、Screen、Terminal、Files 或 References。', 'en-US': 'Use New above to open Results, Browser, Screen, Terminal, Files, or References.' })}</span>
    </div>
  );
}

function RightPaneToolDock({
  locale,
  onSelect,
}: {
  locale?: ResultLocale;
  onSelect: (tab: ResultPaneTab) => void;
}) {
  const tools: Array<{ tab: ResultPaneTab; label: string; detail: string; Icon: typeof Globe2 }> = [
    {
      tab: 'browser',
      label: resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' }),
      detail: resultText(locale, { 'zh-CN': '页面预览和截图', 'en-US': 'Page preview and screenshots' }),
      Icon: Globe2,
    },
    {
      tab: 'screen',
      label: resultText(locale, { 'zh-CN': '虚拟屏幕', 'en-US': 'Virtual Screen' }),
      detail: resultText(locale, { 'zh-CN': '屏幕预览、光标、权限和回放', 'en-US': 'Screen preview, cursor, permissions, and replay' }),
      Icon: Monitor,
    },
    {
      tab: 'terminal',
      label: resultText(locale, { 'zh-CN': '终端', 'en-US': 'Terminal' }),
      detail: resultText(locale, { 'zh-CN': '命令输入、运行输出、停止/复制', 'en-US': 'Command input, output, stop/copy' }),
      Icon: Terminal,
    },
    {
      tab: 'files',
      label: resultText(locale, { 'zh-CN': '文件', 'en-US': 'Files' }),
      detail: resultText(locale, { 'zh-CN': '文件树、查看、编辑和保存', 'en-US': 'File tree, inspect, edit, save' }),
      Icon: FolderTree,
    },
  ];

  return (
    <section className="right-pane-tool-dock" aria-label={resultText(locale, { 'zh-CN': '右侧工具区', 'en-US': 'Right pane tools' })}>
      {tools.map(({ tab, label, detail, Icon }) => (
        <button key={tab} type="button" onClick={() => onSelect(tab)} data-right-pane-tool={tab}>
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
          <small>{detail}</small>
        </button>
      ))}
    </section>
  );
}

function RightPaneBrowserTool({
  tabId,
  config,
  session,
  locale,
  addressDraft,
  onAddressDraftChange,
  onCommandRequest,
}: {
  tabId: string;
  config: SciForgeConfig;
  session: SciForgeSession;
  locale?: ResultLocale;
  addressDraft: string;
  onAddressDraftChange: (nextAddress: string) => void;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}) {
  const normalizedUrl = normalizeRightPaneBrowserUrl(addressDraft);
  const browserState = rightPaneBrowserProjectionForUrl(normalizedUrl);
  const commands = browserWorkbenchDefaultCommands(normalizedUrl, {
    status: browserState.status,
    canGoBack: false,
    canGoForward: false,
    canReload: normalizedUrl !== 'about:blank',
    canStop: browserState.status === 'loading',
    canSnapshot: normalizedUrl !== 'about:blank',
    canState: normalizedUrl !== 'about:blank',
    canTakeover: normalizedUrl !== 'about:blank',
    canCopyUrl: normalizedUrl !== 'about:blank',
    canOpenExternal: Boolean(browserState.externalUrl),
  });

  function requestCommand(command: BrowserWorkbenchCommand) {
    onCommandRequest(command.command, command.label, normalizedUrl);
  }

  function openAddress(value: string) {
    const nextUrl = normalizeRightPaneBrowserUrl(value);
    onAddressDraftChange(nextUrl);
    onCommandRequest(`/browser open ${JSON.stringify(nextUrl)} --surface workbench`, 'Open browser', nextUrl);
  }

  return (
    <div className="right-pane-package-surface right-pane-browser-surface" data-testid="right-pane-browser-tool">
      {renderBrowserWorkbench({
        slot: {
          componentId: 'browser-workbench',
          title: resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' }),
          props: {
            title: resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' }),
            status: browserState.status,
            state: {
              status: browserState.status,
              url: normalizedUrl,
              reason: browserState.reason,
              detail: browserState.detail,
              ref: browserState.ref,
              canRenderFrame: browserState.canRenderFrame,
            },
            embedPolicy: browserState.embedPolicy,
            addressValue: addressDraft,
            addressPlaceholder: 'https://example.org',
            previewUrl: browserState.previewUrl,
            externalUrl: browserState.externalUrl,
            proxyFallbackUrl: browserState.proxyFallbackUrl,
            commands,
            onAddressChange: onAddressDraftChange,
            onAddressSubmit: openAddress,
            onCommandRequest: requestCommand,
            onCopyRefRequest: (ref: { ref: string }) => {
              if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(ref.ref);
            },
            notes: [
              resultText(locale, {
                'zh-CN': 'Browser 动作会转成 /browser 命令交给运行时执行。',
                'en-US': 'Browser actions emit /browser commands for the runtime.',
              }),
            ],
          },
        },
        artifact: {
          id: 'right-pane-browser-workbench',
          type: 'browser-runtime-projection',
          producerScenario: 'browser-runtime',
          schemaVersion: 'sciforge.browser-runtime.projection.v1',
          data: {
            session: {
              id: 'right-pane-browser',
              mode: 'agent-headless',
              providerId: 'browser_runtime',
              activeTabId: `${tabId}:tab`,
              tabs: [{
                id: `${tabId}:tab`,
                url: normalizedUrl,
                title: normalizedUrl === 'about:blank' ? 'about:blank' : normalizedUrl,
                status: browserState.tabStatus,
              }],
            },
          },
        },
        config,
        session,
      })}
    </div>
  );
}

function RightPaneVirtualScreenTool({
  config,
  session,
  activeRun,
  locale,
  onCommandRequest,
}: {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}) {
  const payload = rightPaneVirtualScreenPayload(session, activeRun, config, locale);
  return (
    <div className="right-pane-package-surface right-pane-virtual-screen-surface" data-testid="right-pane-virtual-screen-tool">
      {renderVirtualScreenViewer({
        slot: {
          componentId: 'virtual-screen-viewer',
          title: resultText(locale, { 'zh-CN': '虚拟屏幕', 'en-US': 'Virtual Screen' }),
          props: {
            ...payload,
            onTerminalEquivalentText: (event: { commandText: string; label: string; targetRef?: string }) => {
              onCommandRequest(event.commandText, event.label, event.targetRef);
            },
          },
        },
        artifact: {
          id: 'right-pane-virtual-screen',
          type: 'computer-use-virtual-screen',
          producerScenario: 'computer-use',
          schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
          data: payload,
        },
        config,
        session,
      })}
    </div>
  );
}

function rightPaneVirtualScreenPayload(
  session: SciForgeSession,
  activeRun: SciForgeRun | undefined,
  config: SciForgeConfig,
  locale?: ResultLocale,
): VirtualScreenPayload {
  const candidates = virtualScreenPayloadCandidates(session, activeRun, config);
  const payload = candidates.find((candidate) =>
    candidate.frameRef
    || candidate.frameRefs.length
    || candidate.replayRef
    || candidate.screenRef
    || candidate.sessionRef
    || candidate.blockedRef
    || candidate.errorRef
  );
  if (payload) return payload;
  return {
    title: resultText(locale, { 'zh-CN': 'Computer Use 虚拟屏幕', 'en-US': 'Computer Use Virtual Screen' }),
    status: 'empty',
    sessionRef: undefined,
    screenRef: undefined,
    visibleScreenRefs: [],
    visibleCursorRefs: [],
    replayRef: undefined,
    frameRefs: [],
    cursorOverlayRefs: [],
    leaseOwnerRefs: [],
    proposalRefs: [],
    proposals: [],
    permissionStatus: 'not-requested',
    permissionRequired: false,
    sharedInputAllowed: false,
    leaseStatus: 'none',
    rejectedInputs: [],
    screen: { width: 1440, height: 900, label: resultText(locale, { 'zh-CN': '无可用屏幕', 'en-US': 'No attached screen' }) },
    isolation: {
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      inputExecuted: false,
      diagnosticOnly: true,
    },
    events: [],
  };
}

function virtualScreenPayloadCandidates(session: SciForgeSession, activeRun: SciForgeRun | undefined, config: SciForgeConfig): VirtualScreenPayload[] {
  const runArtifacts = activeRun
    ? dedupeRuntimeArtifacts([
      ...artifactsForRun(session, activeRun),
      ...runtimeArtifactsFromRunForRightPane(activeRun),
    ])
    : [];
  const artifacts = activeRun ? runArtifacts : session.artifacts;
  return artifacts
    .filter((artifact) => /computer-use|virtual-screen|replay|screen/i.test([artifact.type, artifact.producerScenario, artifact.id].join(' ')))
    .map((artifact) => virtualScreenPayloadFromArtifact(artifact, config))
    .filter((payload): payload is VirtualScreenPayload => Boolean(payload));
}

function runtimeArtifactsFromRunForRightPane(run: SciForgeRun): RuntimeArtifact[] {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const output = isRecord(raw?.output) ? raw.output : undefined;
  const dataOutput = isRecord(data?.output) ? data.output : undefined;
  const roots = [
    raw,
    raw?.payload,
    raw?.toolPayload,
    raw?.structured,
    data,
    data?.payload,
    data?.toolPayload,
    output,
    output?.payload,
    output?.result,
    dataOutput,
    dataOutput?.payload,
    dataOutput?.result,
  ];
  return dedupeRuntimeArtifacts(roots.flatMap((root) => {
    const record = isRecord(root) ? root : undefined;
    return toRecordList(record?.artifacts).map((artifact) => runtimeArtifactFromRecord(artifact, run.scenarioId));
  }).filter((artifact): artifact is RuntimeArtifact => Boolean(artifact)));
}

function runtimeArtifactFromRecord(record: Record<string, unknown>, fallbackScenario: RuntimeArtifact['producerScenario']): RuntimeArtifact | undefined {
  const id = firstNonEmptyString(stringField(record.id), stringField(record.artifactId))?.replace(/^artifact::?/i, '');
  const type = firstNonEmptyString(stringField(record.type), stringField(record.artifactType));
  if (!id || !type) return undefined;
  return {
    id,
    type,
    producerScenario: (stringField(record.producerScenario) ?? fallbackScenario) as RuntimeArtifact['producerScenario'],
    schemaVersion: stringField(record.schemaVersion) ?? 'unknown',
    dataRef: stringField(record.dataRef),
    data: record.data,
    metadata: isRecord(record.metadata) ? record.metadata : undefined,
    delivery: isRecord(record.delivery) ? record.delivery as unknown as RuntimeArtifact['delivery'] : undefined,
  };
}

function dedupeRuntimeArtifacts(artifacts: RuntimeArtifact[]) {
  const byId = new Map<string, RuntimeArtifact>();
  for (const artifact of artifacts) {
    if (!artifact.id || byId.has(artifact.id)) continue;
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values());
}

function virtualScreenPayloadFromArtifact(artifact: RuntimeArtifact, config: SciForgeConfig): VirtualScreenPayload | undefined {
  const data = isRecord(artifact.data) ? artifact.data : {};
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const frameRecords = virtualScreenFrameRecords(data, metadata, config);
  const frameRefs = frameRecords.map((frame) => frame.ref);
  const visibleScreenRefs = stringListField(data.visibleScreenRefs).concat(stringListField(metadata.visibleScreenRefs));
  const visibleCursorRefs = stringListField(data.visibleCursorRefs).concat(stringListField(metadata.visibleCursorRefs));
  const beforeRefs = stringListField(data.beforeEvidenceRefs).concat(stringListField(metadata.beforeEvidenceRefs));
  const afterRefs = stringListField(data.afterEvidenceRefs).concat(stringListField(metadata.afterEvidenceRefs));
  const cursorOverlayRefs = Array.from(new Set([
    ...stringListField(data.cursorOverlayRefs),
    ...stringListField(metadata.cursorOverlayRefs),
    ...frameRecords.flatMap((frame) => frame.cursorOverlayRefs ?? []),
  ]));
  const proposalRefs = Array.from(new Set([
    ...stringListField(data.proposalRefs),
    ...stringListField(metadata.proposalRefs),
    ...frameRecords.map((frame) => frame.proposalRef).filter((ref): ref is string => Boolean(ref)),
  ]));
  const replayRef = firstNonEmptyString(stringField(data.replayRef), stringField(metadata.replayRef), stringField(artifact.delivery?.readableRef), stringField(artifact.dataRef));
  const frameRef = firstNonEmptyString(stringField(data.frameRef), frameRefs[0], stringField(metadata.frameRef));
  const screenRef = firstNonEmptyString(stringField(data.screenRef), visibleScreenRefs[0], frameRecords[0]?.screenRef, stringField(metadata.screenRef));
  const sessionRef = firstNonEmptyString(stringField(data.sessionRef), stringField(metadata.sessionRef));
  const blockedRef = firstNonEmptyString(stringField(data.blockedRef), stringField(metadata.blockedRef));
  const errorRef = firstNonEmptyString(stringField(data.errorRef), stringField(metadata.errorRef));
  if (!frameRef && !replayRef && !screenRef && !sessionRef && !blockedRef && !errorRef) return undefined;
  const screenRecord = isRecord(data.screen) ? data.screen : {};
  return {
    title: stringField(data.title) ?? stringField(metadata.title) ?? 'Computer Use Virtual Screen',
    status: errorRef ? 'error' : blockedRef ? 'blocked' : frameRef ? 'ready' : 'empty',
    sessionRef,
    displayGroupRef: firstNonEmptyString(stringField(data.displayGroupRef), stringField(metadata.displayGroupRef)),
    screenRef,
    visibleScreenRefs: Array.from(new Set([screenRef, ...visibleScreenRefs, ...frameRecords.map((frame) => frame.screenRef)].filter((ref): ref is string => Boolean(ref)))),
    visibleCursorRefs,
    frameRef,
    frameRefs: frameRecords.map((frame) => ({
      ...frame,
      screenRef: frame.screenRef ?? screenRef,
      beforeEvidenceRef: frame.beforeEvidenceRef ?? beforeRefs[0],
      afterEvidenceRef: frame.afterEvidenceRef ?? afterRefs[0],
    })),
    replayRef,
    cursorOverlayRefs,
    leaseOwnerRefs: [
      ...toRecordList(data.leaseOwnerRefs),
      ...toRecordList(metadata.leaseOwnerRefs),
      ...frameRecords.flatMap((frame) => frame.leaseOwnerRefs ?? []).map((ref) => ({ ref })),
    ].flatMap((owner) => {
      const ownerRecord = owner as Record<string, unknown>;
      const ref = stringField(ownerRecord.ref) ?? stringField(ownerRecord.leaseOwnerRef);
      return ref ? [{ ref, label: stringField(ownerRecord.label), status: stringField(ownerRecord.status), ownerRef: stringField(ownerRecord.ownerRef), scopeRef: stringField(ownerRecord.scopeRef) }] : [];
    }),
    proposalRefs,
    proposals: toRecordList(data.proposals).flatMap((proposal) => {
      const ref = stringField(proposal.ref) ?? stringField(proposal.proposalRef);
      return ref ? [{ ref, label: stringField(proposal.label), status: stringField(proposal.status), actorRef: stringField(proposal.actorRef), cursorRef: stringField(proposal.cursorRef), frameRef: stringField(proposal.frameRef), approvalRef: stringField(proposal.approvalRef), riskLevel: stringField(proposal.riskLevel) }] : [];
    }),
    beforeEvidenceRef: beforeRefs[0],
    afterEvidenceRef: afterRefs[0],
    completionEvidenceRef: stringField(data.completionEvidenceRef) ?? stringField(metadata.completionEvidenceRef),
    blockedRef,
    errorRef,
    blockedReason: stringField(data.blockedReason) ?? stringField(metadata.blockedReason),
    errorReason: stringField(data.errorReason) ?? stringField(metadata.errorReason),
    permissionRef: firstNonEmptyString(stringField(data.permissionRef), stringField(metadata.permissionRef)),
    permissionStatus: stringField(data.permissionStatus) ?? stringField(metadata.permissionStatus),
    permissionRequired: typeof data.permissionRequired === 'boolean' ? data.permissionRequired : undefined,
    permissionGranted: typeof data.permissionGranted === 'boolean' ? data.permissionGranted : undefined,
    sharedInputAllowed: typeof data.sharedInputAllowed === 'boolean' ? data.sharedInputAllowed : undefined,
    leaseStatus: stringField(data.leaseStatus) ?? stringField(metadata.leaseStatus),
    stopRef: firstNonEmptyString(stringField(data.stopRef), stringField(metadata.stopRef)),
    cancelLeaseRef: firstNonEmptyString(stringField(data.cancelLeaseRef), stringField(metadata.cancelLeaseRef)),
    screen: {
      width: numberField(screenRecord.width) ?? numberField(data.width) ?? 1440,
      height: numberField(screenRecord.height) ?? numberField(data.height) ?? 900,
      label: stringField(screenRecord.label) ?? stringField(data.screenId) ?? screenRef,
    },
    actorCursors: toRecordList(data.actorCursors).map((cursor, index) => ({
      actorId: stringField(cursor.actorId) ?? `actor-${index + 1}`,
      cursorId: stringField(cursor.cursorId),
      label: stringField(cursor.label) ?? stringField(cursor.actorId),
      color: stringField(cursor.color),
      x: numberField(cursor.x),
      y: numberField(cursor.y),
      state: stringField(cursor.state),
    })),
    isolation: isRecord(data.isolation) ? data.isolation : {
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      inputExecuted: false,
      diagnosticOnly: true,
    },
    runSummary: virtualScreenRunSummaryFromArtifact(data, metadata, artifact, frameRecords, {
      status: errorRef ? 'error' : blockedRef ? 'blocked' : frameRef ? 'ready' : 'empty',
      sessionRef,
      screenRef,
      replayRef,
      blockedRef,
    }),
    rejectedInputs: [],
    events: [
      ...refEvents('frame', frameRefs),
      ...refEvents('screen', visibleScreenRefs),
      ...refEvents('cursor', visibleCursorRefs),
      ...refEvents('before', beforeRefs),
      ...refEvents('after', afterRefs),
      stringField(data.completionEvidenceRef) ? { label: 'completion', ref: stringField(data.completionEvidenceRef), status: 'recorded' } : undefined,
      blockedRef ? { label: 'blocked', ref: blockedRef, status: 'blocked' } : undefined,
      errorRef ? { label: 'error', ref: errorRef, status: 'error' } : undefined,
    ].filter((event): event is { label: string; ref: string; status: string } => Boolean(event?.ref)),
  };
}

function virtualScreenRunSummaryFromArtifact(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  artifact: RuntimeArtifact,
  frameRecords: VirtualScreenFrame[],
  fallback: {
    status: string;
    sessionRef?: string;
    screenRef?: string;
    replayRef?: string;
    blockedRef?: string;
  },
) {
  const raw = isRecord(data.runSummary)
    ? data.runSummary
    : isRecord(metadata.runSummary)
      ? metadata.runSummary
      : {};
  const visibleScreenRefs = Array.from(new Set([
    ...stringListField(data.visibleScreenRefs),
    stringField(data.screenRef),
    fallback.screenRef,
    ...frameRecords.map((frame) => frame.screenRef),
  ].filter((ref): ref is string => Boolean(ref))));
  const visibleCursorRefs = Array.from(new Set([
    ...stringListField(data.visibleCursorRefs),
    ...stringListField(data.cursorOverlayRefs),
    ...frameRecords.flatMap((frame) => frame.cursorOverlayRefs ?? []),
  ]));
  const sidecarBinding = isRecord(data.sidecarBinding) ? data.sidecarBinding : {};
  return compactVirtualScreenRunSummary({
    schemaVersion: stringField(raw.schemaVersion) ?? 'sciforge.computer-use.run-summary.v1',
    status: stringField(raw.status) ?? stringField(data.status) ?? fallback.status,
    runId: stringField(raw.runId) ?? stringField(data.runId) ?? stringField(metadata.runId) ?? stringField(artifact.metadata?.runId),
    validationRef: firstNonEmptyString(stringField(raw.validationRef), stringField(data.validationRef), stringField(metadata.validationRef)),
    currentBundleRef: firstNonEmptyString(stringField(raw.currentBundleRef), stringField(data.currentBundleRef), stringField(metadata.currentBundleRef), fallback.sessionRef),
    evidenceBundleIndexRef: firstNonEmptyString(stringField(raw.evidenceBundleIndexRef), stringField(raw.evidenceIndexRef), stringField(data.evidenceBundleIndexRef), stringField(data.evidenceIndexRef), stringField(metadata.evidenceBundleIndexRef)),
    replayRef: firstNonEmptyString(stringField(raw.replayRef), fallback.replayRef),
    validationStatus: boundedRightPaneText(firstNonEmptyString(stringField(raw.validationStatus), stringField(data.validationStatus), stringField(metadata.validationStatus)) ?? '', 120) || undefined,
    validationOk: booleanField(raw.validationOk) ?? booleanField(data.validationOk),
    sidecarBindingRef: firstNonEmptyString(stringField(raw.sidecarBindingRef), stringField(data.sidecarBindingRef), stringField(metadata.sidecarBindingRef)),
    sidecarCapabilitiesRef: firstNonEmptyString(stringField(raw.sidecarCapabilitiesRef), stringField(data.sidecarCapabilitiesRef), stringField(metadata.sidecarCapabilitiesRef)),
    sidecarDiscoveryRef: firstNonEmptyString(stringField(raw.sidecarDiscoveryRef), stringField(data.sidecarDiscoveryRef), stringField(metadata.sidecarDiscoveryRef)),
    sidecarBindingKind: boundedRightPaneText(firstNonEmptyString(stringField(raw.sidecarBindingKind), stringField(data.sidecarBindingKind), stringField(sidecarBinding.bindingKind)) ?? '', 120) || undefined,
    realNativeSidecarExecuted: booleanField(raw.realNativeSidecarExecuted) ?? booleanField(data.realNativeSidecarExecuted),
    completionEligible: booleanField(raw.completionEligible) ?? booleanField(data.completionEligible),
    screenCount: positiveIntegerField(raw.screenCount) ?? positiveIntegerField(data.screenCount) ?? visibleScreenRefs.length,
    actorCursorCount: positiveIntegerField(raw.actorCursorCount) ?? positiveIntegerField(data.actorCursorCount) ?? Math.max(toRecordList(data.actorCursors).length, visibleCursorRefs.length),
    frameCount: positiveIntegerField(raw.frameCount) ?? positiveIntegerField(data.frameCount) ?? frameRecords.length,
    cursorOverlayCount: positiveIntegerField(raw.cursorOverlayCount) ?? positiveIntegerField(data.cursorOverlayCount) ?? visibleCursorRefs.length,
    schedulerLeaseCount: positiveIntegerField(raw.schedulerLeaseCount) ?? positiveIntegerField(data.schedulerLeaseCount) ?? Math.max(stringListField(data.schedulerLeaseRefs).length, stringListField(data.leaseOwnerRefs).length),
    targetCount: positiveIntegerField(raw.targetCount) ?? positiveIntegerField(data.targetCount) ?? stringListField(data.targetRefs).length,
    blockedReason: boundedRightPaneText(firstNonEmptyString(stringField(raw.blockedReason), stringField(data.blockedReason)) ?? '', 240) || undefined,
  });
}

function compactVirtualScreenRunSummary(summary: Record<string, unknown>) {
  const compact = Object.fromEntries(Object.entries(summary).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false;
    return true;
  }));
  return Object.keys(compact).length > 1 ? compact : undefined;
}

function virtualScreenFrameRecords(
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
  config: SciForgeConfig,
): VirtualScreenFrame[] {
  const frames = [
    ...frameRecordsFromValue(data.frames, config),
    ...frameRecordsFromValue(data.frameRefs, config),
    ...frameRecordsFromValue(metadata.frames, config),
    ...frameRecordsFromValue(metadata.frameRefs, config),
  ];
  const topLevelFrame = frameRecordFromValue({
    ref: stringField(data.frameRef) ?? stringField(metadata.frameRef),
    frameRef: stringField(data.frameRef) ?? stringField(metadata.frameRef),
    frameUrl: stringField(data.frameUrl) ?? stringField(metadata.frameUrl),
    frameDataRef: stringField(data.frameDataRef) ?? stringField(metadata.frameDataRef),
    screenshotRef: stringField(data.screenshotRef) ?? stringField(metadata.screenshotRef),
    screenRef: stringField(data.screenRef) ?? stringField(metadata.screenRef),
    label: stringField(data.frameLabel) ?? stringField(metadata.frameLabel),
    status: stringField(data.frameStatus) ?? stringField(metadata.frameStatus),
    framePreviewUrl: stringField(data.framePreviewUrl) ?? stringField(metadata.framePreviewUrl),
    thumbnailPreviewUrl: stringField(data.thumbnailPreviewUrl) ?? stringField(metadata.thumbnailPreviewUrl),
    safePreviewUrl: stringField(data.safePreviewUrl) ?? stringField(metadata.safePreviewUrl),
    previewUrl: stringField(data.previewUrl) ?? stringField(metadata.previewUrl),
    thumbnailUrl: stringField(data.thumbnailUrl) ?? stringField(metadata.thumbnailUrl),
    beforeEvidenceRef: stringField(data.beforeEvidenceRef) ?? stringListField(data.beforeEvidenceRefs)[0],
    afterEvidenceRef: stringField(data.afterEvidenceRef) ?? stringListField(data.afterEvidenceRefs)[0],
    evidenceRef: stringField(data.evidenceRef),
    cursorOverlayRefs: stringListField(data.cursorOverlayRefs),
    leaseOwnerRefs: stringListField(data.leaseOwnerRefs),
    proposalRef: stringField(data.proposalRef) ?? stringField(data.actionProposalRef),
    blockedReason: stringField(data.blockedReason),
    errorReason: stringField(data.errorReason),
  }, config);
  if (topLevelFrame) frames.unshift(topLevelFrame);
  const byRef = new Map<string, VirtualScreenFrame>();
  for (const frame of frames) {
    const previous = byRef.get(frame.ref);
    byRef.set(frame.ref, previous ? mergeVirtualScreenFrame(previous, frame) : frame);
  }
  return Array.from(byRef.values());
}

function frameRecordsFromValue(value: unknown, config: SciForgeConfig): VirtualScreenFrame[] {
  if (!Array.isArray(value)) return [];
  return value.map((frame) => frameRecordFromValue(frame, config)).filter((frame): frame is VirtualScreenFrame => Boolean(frame));
}

function frameRecordFromValue(value: unknown, config: SciForgeConfig): VirtualScreenFrame | undefined {
  if (typeof value === 'string') {
    const ref = stringField(value);
    return ref ? { ref, framePreviewUrl: rightPaneVirtualScreenFramePreviewUrl(ref, config) } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const ref = firstNonEmptyString(
    stringField(value.ref),
    stringField(value.frameRef),
    stringField(value.screenshotRef),
    stringField(value.frameDataRef),
  );
  if (!ref) return undefined;
  const previewUrl = safeFramePreviewUrl(value.framePreviewUrl)
    ?? safeFramePreviewUrl(value.safePreviewUrl)
    ?? safeFramePreviewUrl(value.previewUrl)
    ?? safeFramePreviewUrl(value.rawUrl)
    ?? safeFramePreviewUrl(value.frameUrl)
    ?? rightPaneVirtualScreenFramePreviewUrl(ref, config);
  return {
    ref,
    screenRef: stringField(value.screenRef),
    label: stringField(value.label),
    status: stringField(value.status),
    frameUrl: safeFramePreviewUrl(value.frameUrl),
    frameDataRef: stringField(value.frameDataRef),
    screenshotRef: stringField(value.screenshotRef),
    framePreviewUrl: previewUrl,
    thumbnailPreviewUrl: safeFramePreviewUrl(value.thumbnailPreviewUrl),
    safePreviewUrl: safeFramePreviewUrl(value.safePreviewUrl),
    previewUrl: safeFramePreviewUrl(value.previewUrl),
    thumbnailUrl: safeFramePreviewUrl(value.thumbnailUrl),
    rawUrl: safeFramePreviewUrl(value.rawUrl),
    beforeEvidenceRef: stringField(value.beforeEvidenceRef) ?? stringListField(value.beforeEvidenceRefs)[0],
    afterEvidenceRef: stringField(value.afterEvidenceRef) ?? stringListField(value.afterEvidenceRefs)[0],
    evidenceRef: stringField(value.evidenceRef),
    cursorOverlayRefs: stringListField(value.cursorOverlayRefs),
    leaseOwnerRefs: stringListField(value.leaseOwnerRefs),
    proposalRef: stringField(value.proposalRef) ?? stringField(value.actionProposalRef),
    blockedReason: stringField(value.blockedReason),
    errorReason: stringField(value.errorReason),
  };
}

function mergeVirtualScreenFrame(
  left: VirtualScreenFrame,
  right: VirtualScreenFrame,
): VirtualScreenFrame {
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && !value.length) continue;
    merged[key] = value;
  }
  return merged as unknown as VirtualScreenFrame;
}

function rightPaneVirtualScreenFramePreviewUrl(ref: string, config: SciForgeConfig) {
  if (!isPreviewableFrameRef(ref)) return undefined;
  const params = new URLSearchParams({ ref });
  const workspacePath = normalizeWorkspaceRootPath(config.workspacePath);
  if (workspacePath) params.set('workspacePath', workspacePath);
  return `/api/sciforge/preview/raw?${params.toString()}`;
}

function isPreviewableFrameRef(ref: string) {
  const value = ref.trim();
  if (!/\.(?:png|jpe?g|webp|gif)$/i.test(value)) return false;
  if (/^(?:data:|blob:|file:|javascript:)/i.test(value) || /base64/i.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('~')) return false;
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function safeFramePreviewUrl(value: unknown) {
  const url = stringField(value);
  if (!url || /^(?:data:|blob:|file:|javascript:)/i.test(url) || /base64/i.test(url)) return undefined;
  return url.startsWith('/api/sciforge/preview/') && !url.startsWith('//') ? url : undefined;
}

function stringListField(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerField(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function refEvents(label: string, refs: string[]) {
  return refs.map((ref) => ({ label, ref, status: 'recorded' }));
}

function RightPaneTerminalTool({
  session,
  activeRun,
  locale,
  onCommandRequest,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}) {
  const units = activeRun ? auditExecutionUnitsForRun(session, activeRun) : session.executionUnits.slice(-6);
  const buffer = terminalTranscriptForRightPane(units, locale);
  const status = terminalStatusForRightPane(units, activeRun, buffer);
  const sessionRef = activeRun ? `run:${rightPaneInlineLabel(activeRun.id)}:terminal` : 'right-pane-terminal';
  const sessionId = activeRun ? rightPaneInlineLabel(activeRun.id) : 'right-pane-terminal';
  const transcriptRef = terminalTranscriptRefForRightPane(units, activeRun);
  const ptyTranscriptRef = terminalPtyTranscriptRefForRightPane(units, activeRun);
  const terminalAdapter: TerminalSessionAdapter = {
    kind: 'host-owned-terminal-session',
    mode: 'transcript',
    session: {
      sessionRef,
      sessionId,
      status,
      rows: 24,
      cols: 80,
      startedAt: activeRun?.createdAt,
      completedAt: activeRun?.completedAt,
      transcriptRef,
      ptyTranscriptRef,
    },
    transcript: buffer,
  };
  const inputAllowed = status === 'running';
  return (
    <div className="right-pane-package-surface right-pane-terminal-surface" data-testid="right-pane-terminal-tool">
      {renderTerminalSessionViewer({
        slot: {
          componentId: 'terminal-session-viewer',
          title: resultText(locale, { 'zh-CN': '终端', 'en-US': 'Terminal' }),
          props: {
            mode: 'transcript',
            adapter: terminalAdapter,
            sessionRef,
            sessionId,
            title: resultText(locale, { 'zh-CN': '终端', 'en-US': 'Terminal' }),
            status,
            rows: 24,
            cols: 80,
            buffer,
            transcriptRef,
            ptyTranscriptRef,
            capabilities: { input: inputAllowed, paste: inputAllowed, resize: true, copy: true, download: true, stop: status === 'running', focus: true },
            metadata: {
              surface: 'right-pane',
              mode: 'transcript',
              source: 'execution-units',
              runStatus: activeRun?.status ?? 'none',
              unitCount: String(units.length),
            },
            onDataInput: (input: string) => {
              if (status === 'running' && input.trim()) onCommandRequest(`/terminal input --session ${JSON.stringify(sessionRef)} --text ${JSON.stringify(input)}`, 'Terminal input', sessionRef);
            },
            onPasteInput: (input: string) => {
              if (status === 'running' && input.trim()) onCommandRequest(`/terminal paste --session ${JSON.stringify(sessionRef)} --text ${JSON.stringify(input)}`, 'Terminal paste', sessionRef);
            },
            onResize: (size: { cols: number; rows: number }) => onCommandRequest(`/terminal resize --session ${JSON.stringify(sessionRef)} --cols ${size.cols} --rows ${size.rows}`, 'Resize terminal', sessionRef),
            onCopyRequest: () => onCommandRequest(`/terminal copy --session ${JSON.stringify(sessionRef)}`, 'Copy terminal transcript', sessionRef),
            onDownloadRequest: () => onCommandRequest(`/terminal download --session ${JSON.stringify(sessionRef)}`, 'Download terminal transcript', sessionRef),
            onStopRequest: () => onCommandRequest(`/terminal stop --session ${JSON.stringify(sessionRef)}`, 'Stop terminal', sessionRef),
            onFocusChange: (focused: boolean) => {
              if (focused) onCommandRequest(`/terminal focus --session ${JSON.stringify(sessionRef)}`, 'Focus terminal', sessionRef);
            },
          },
        },
        artifact: {
          id: 'right-pane-terminal-session',
          type: 'terminal-session',
          producerScenario: 'terminal-session-viewer',
          schemaVersion: 'sciforge.terminal-session.v1',
          data: { status, buffer, transcriptRef, ptyTranscriptRef },
        },
        session,
      })}
    </div>
  );
}

function RightPaneFilesTool({
  config,
  locale,
  state,
  onChange,
}: {
  config: SciForgeConfig;
  locale?: ResultLocale;
  state: WorkspaceFileEditorState | null;
  onChange: (next: WorkspaceFileEditorState | null) => void;
}) {
  const workspaceRoot = normalizeWorkspaceRootPath(state?.workspacePath || config.workspacePath);
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceFileViewerEntry[] | undefined>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const canEditFile = workspaceFileEditorCanEditFile(state?.file);
  const dirty = Boolean(state && canEditFile && state.draft !== state.file.content);

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

  async function openFile(entry: WorkspaceFileViewerEntry) {
    if (entry.kind !== 'file') return;
    const tooLargeFile = tooLargeWorkspaceFileFromEntry(entry);
    if (tooLargeFile) {
      onChange({ file: tooLargeFile, draft: '', workspacePath: workspaceRoot, editMode: false });
      setWorkspaceError('');
      setSaveError('');
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开只读元数据：${entry.name}`, 'en-US': `Opened read-only metadata for ${entry.name}` }));
      return;
    }
    try {
      setWorkspaceError('');
      const file = workspaceFileWithInlinePolicy(await readWorkspaceFile(entry.path, config));
      onChange({ file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开 ${file.name}`, 'en-US': `Opened ${file.name}` }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  async function saveFile() {
    if (!state || !canEditFile) return;
    try {
      setSaveError('');
      const file = workspaceFileWithInlinePolicy(await writeWorkspaceFile(state.file.path, state.draft, config));
      onChange({ ...state, file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已保存 ${file.name}`, 'en-US': `Saved ${file.name}` }));
      const parent = workspaceFileViewerParentPath(file.path) || workspaceRoot;
      if (parent) await loadFolder(parent, { quiet: true });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="right-pane-package-surface right-pane-files-surface" data-testid="right-pane-files-tool">
      {renderWorkspaceFileViewer({
        slot: {
          componentId: 'workspace-file-viewer',
          title: workspaceFileViewerLabels(locale).title,
          props: {
            rootPath: workspaceRoot,
            rootLabel: workspaceFileViewerBasename(workspaceRoot),
            entriesByFolder: folderChildren,
            expandedFolderPaths: Array.from(expandedFolders),
            selectedPath: state?.file.path,
            file: state?.file ?? null,
            treePageSize: 200,
            inlineTextLimitBytes: WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES,
            draft: state?.draft ?? '',
            dirty,
            editMode: Boolean(state?.editMode && canEditFile),
            notice: workspaceNotice,
            error: boundedRightPaneText(workspaceError, 800),
            saveError: boundedRightPaneText(saveError, 800),
            labels: workspaceFileViewerLabels(locale),
            displayPathForPath: (path: string) => workspaceDisplayPathForPath(workspaceRoot, path),
            copyPathForPath: (path: string) => workspaceCopyRefForPath(workspaceRoot, path),
            onToggleFolder: toggleFolder,
            onOpenFile: (entry: WorkspaceFileViewerEntry) => void openFile(entry),
            onRefresh: () => void refreshTree(),
            onCollapseAll: () => setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : [])),
            onDraftChange: (draft: string) => {
              if (state?.editMode && canEditFile) onChange({ ...state, draft });
            },
            onEditModeChange: (editMode: boolean) => {
              if (state) onChange(workspaceFileEditorWithEditMode(state, editMode));
            },
            onSave: () => void saveFile(),
            onCancel: () => {
              if (state) onChange(cancelWorkspaceFileEditorEdit(state));
            },
            onClose: () => onChange(null),
            onCopyPath: (path: string) => {
              if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(path);
            },
            onCopyContents: (content: string) => {
              if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(content);
            },
          } satisfies Partial<WorkspaceFileViewerProps> as Record<string, unknown>,
        },
        artifact: {
          id: 'right-pane-workspace-file-view',
          type: 'workspace-file-view',
          producerScenario: 'workspace-file-viewer',
          schemaVersion: 'sciforge.workspace-file-view.v1',
          data: {
            rootPath: workspaceRoot,
            selectedPath: state?.file.path,
            file: state?.file ?? null,
            dirty,
          },
        },
        config,
      })}
    </div>
  );
}

function RightPaneReferencesTool({
  session,
  activeRun,
  pinnedReferences,
  locale,
  onAction,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  pinnedReferences: ObjectReference[];
  locale?: ResultLocale;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
}) {
  const references = rightPaneObjectReferences(session, activeRun);
  const grouped = groupObjectReferencesByKind(references);
  if (!references.length) {
    return (
      <div className="right-pane-references-inspector" data-testid="right-pane-references-tool" data-state="empty">
        <strong>{resultText(locale, { 'zh-CN': '没有对象引用', 'en-US': 'No object references' })}</strong>
        <span>{resultText(locale, { 'zh-CN': '当回答、过程或结果声明 refs 后会显示在这里。', 'en-US': 'Declared refs from answers, process rows, and results appear here.' })}</span>
      </div>
    );
  }
  return (
    <div className="right-pane-references-inspector" data-testid="right-pane-references-tool" data-state="ready">
      {grouped.map((group) => (
        <section key={group.kind} className="right-pane-reference-group" data-reference-kind={group.kind}>
          <div className="view-plan-section-head">
            <span>{objectReferenceKindLabel(group.kind)}</span>
            <Badge variant="muted">{group.references.length}</Badge>
          </div>
          <div className="right-pane-reference-list">
            {group.references.map((reference) => {
              const actions = availableObjectActions(reference, session);
              const targetTab = resultTabForObjectReference(reference);
              const isPinned = pinnedReferences.some((item) => item.id === reference.id);
              return (
                <article key={`${reference.kind}:${reference.id}:${reference.ref}`} className="right-pane-reference-card" data-focus-target={targetTab}>
                  <div>
                    <Badge variant={reference.status === 'blocked' || reference.status === 'missing' ? 'warning' : 'info'}>{reference.status ?? 'available'}</Badge>
                    <strong>{rightPaneInlineLabel(reference.title || reference.ref)}</strong>
                    <span>{rightPaneInlineLabel(reference.summary || reference.ref)}</span>
                  </div>
                  <code>{rightPaneInlineLabel(reference.ref)}</code>
                  <div className="object-focus-actions">
                    {actions.slice(0, 5).map((action) => (
                      <button key={action} type="button" onClick={() => void onAction(reference, action)}>
                        {action === 'focus-right-pane'
                          ? resultText(locale, { 'zh-CN': '打开', 'en-US': 'Open' })
                          : objectActionLabel(action)}
                      </button>
                    ))}
                    {isPinned ? <span>{resultText(locale, { 'zh-CN': '已固定', 'en-US': 'Pinned' })}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function rightPaneObjectReferences(session: SciForgeSession, activeRun?: SciForgeRun): ObjectReference[] {
  const activeRunIds = activeRun ? new Set([activeRun.id]) : undefined;
  const fromMessages = session.messages.flatMap((message) => message.objectReferences ?? [])
    .filter((reference) => !activeRunIds || !reference.runId || activeRunIds.has(reference.runId));
  const runs = activeRun ? [activeRun] : session.runs;
  const fromRuns = runs.flatMap((run) => run.objectReferences ?? []);
  const fromArtifacts = (activeRun ? artifactsForRun(session, activeRun) : session.artifacts)
    .map((artifact) => objectReferenceForArtifactSummary(artifact, activeRun?.id));
  const fromExecutionUnits = auditExecutionUnitsForRun(session, activeRun).map((unit): ObjectReference => ({
    id: `object-execution-unit-${unit.id}`,
    kind: 'execution-unit',
    title: unit.tool || unit.id,
    ref: `execution-unit:${unit.id}`,
    runId: unit.runId ?? activeRun?.id,
    executionUnitId: unit.id,
    status: terminalExecutionUnitFailed(unit) ? 'blocked' : 'available',
    summary: unit.outputRef || unit.stdoutRef || unit.stderrRef || unit.status,
    actions: ['focus-right-pane', 'copy-path'],
    provenance: {
      dataRef: unit.outputRef,
      producer: unit.tool,
    },
  }));
  return dedupeObjectReferences([
    ...fromMessages,
    ...fromRuns,
    ...fromArtifacts,
    ...fromExecutionUnits,
  ]);
}

function dedupeObjectReferences(references: ObjectReference[]) {
  const byKey = new Map<string, ObjectReference>();
  for (const reference of references) {
    if (!reference?.ref || !reference.kind) continue;
    const key = `${reference.kind}:${reference.ref}`;
    if (!byKey.has(key)) byKey.set(key, reference);
  }
  return Array.from(byKey.values()).slice(0, 60);
}

function groupObjectReferencesByKind(references: ObjectReference[]) {
  const order: ObjectReference['kind'][] = ['artifact', 'file', 'folder', 'url', 'execution-unit', 'run', 'scenario-package'];
  return order
    .map((kind) => ({
      kind,
      references: references.filter((reference) => reference.kind === kind),
    }))
    .filter((group) => group.references.length > 0);
}

function normalizeRightPaneBrowserUrl(value: string) {
  return normalizeBrowserWorkbenchUrl(value);
}

type RightPaneBrowserProjectionStatus = 'idle' | 'loading' | 'ready' | 'blocked' | 'error' | 'offline';

interface RightPaneBrowserProjectionState {
  status: RightPaneBrowserProjectionStatus;
  tabStatus: 'new' | 'loading' | 'ready' | 'failed' | 'closed';
  previewUrl?: string;
  externalUrl?: string;
  proxyFallbackUrl?: string;
  reason?: string;
  detail?: string;
  ref?: string;
  canRenderFrame?: boolean;
  embedPolicy?: {
    embeddable?: boolean;
    status?: RightPaneBrowserProjectionStatus;
    reason?: string;
    ref?: string;
  };
}

function rightPaneBrowserProjectionForUrl(url: string): RightPaneBrowserProjectionState {
  if (url === 'about:blank') {
    return {
      status: 'idle',
      tabStatus: 'new',
      previewUrl: 'about:blank',
      reason: 'No browser URL is open in this right-pane tab yet.',
      canRenderFrame: true,
    };
  }

  const parsed = parseRightPaneBrowserUrl(url);
  if (!parsed) {
    return {
      status: 'error',
      tabStatus: 'failed',
      reason: 'The URL could not be parsed into a browser target.',
      detail: 'Enter a local path, localhost URL, http URL, or https URL.',
      ref: 'browser:error/right-pane/invalid-url',
      canRenderFrame: false,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      status: 'blocked',
      tabStatus: 'failed',
      reason: 'This URL scheme is not embeddable by the browser workbench.',
      detail: 'Use an http or https URL, or open the target through a host-owned BrowserRuntime command.',
      ref: 'browser:embed-policy/right-pane/unsupported-scheme',
      canRenderFrame: false,
      embedPolicy: {
        embeddable: false,
        status: 'blocked',
        reason: 'Unsupported browser workbench URL scheme.',
        ref: 'browser:embed-policy/right-pane/unsupported-scheme',
      },
    };
  }

  if (rightPaneBrowserUrlIsLocal(parsed)) {
    return {
      status: 'ready',
      tabStatus: 'ready',
      previewUrl: url,
      reason: 'Local pages can be embedded directly in the workbench.',
      canRenderFrame: true,
    };
  }

  return {
    status: 'blocked',
    tabStatus: 'failed',
    previewUrl: url,
    externalUrl: url,
    proxyFallbackUrl: rightPaneBrowserProxyFallbackUrl(url),
    reason: 'External pages may block iframe embedding with X-Frame-Options or Content-Security-Policy.',
    detail: 'Use Open External, Snapshot, State, Takeover, or the proxy snapshot fallback instead of a blank embedded frame.',
    ref: 'browser:embed-policy/right-pane/external-iframe',
    canRenderFrame: false,
    embedPolicy: {
      embeddable: false,
      status: 'blocked',
      reason: 'External page embedding is blocked until BrowserRuntime reports an embeddable projection.',
      ref: 'browser:embed-policy/right-pane/external-iframe',
    },
  };
}

function parseRightPaneBrowserUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function rightPaneBrowserUrlIsLocal(parsed: URL) {
  return /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(parsed.hostname);
}

function rightPaneBrowserProxyFallbackUrl(url: string) {
  const params = new URLSearchParams({ url });
  return `/api/sciforge/browser/proxy?${params.toString()}`;
}

function terminalStatusForRightPane(units: RuntimeExecutionUnit[], activeRun: SciForgeRun | undefined, buffer: string): TerminalSessionStatus {
  if (activeRun?.status === 'running' || units.some((unit) => unit.status === 'running')) return 'running';
  if (activeRun?.status === 'failed' || units.some((unit) => terminalExecutionUnitFailed(unit))) return 'error';
  if (activeRun?.status === 'completed' || units.some((unit) => unit.status === 'done' || unit.status === 'self-healed')) return 'completed';
  return 'stopped';
}

function terminalTranscriptRefForRightPane(units: RuntimeExecutionUnit[], activeRun: SciForgeRun | undefined) {
  const explicitRef = units
    .flatMap((unit) => [unit.stdoutRef, unit.stderrRef, unit.outputRef])
    .find((ref): ref is string => typeof ref === 'string' && Boolean(ref.trim()));
  if (explicitRef) return explicitRef;
  if (activeRun?.id) return `terminal-transcript:${rightPaneInlineLabel(activeRun.id)}`;
  return 'terminal-transcript:right-pane';
}

function terminalPtyTranscriptRefForRightPane(units: RuntimeExecutionUnit[], activeRun: SciForgeRun | undefined) {
  const terminalUnit = units.find((unit) => unit.tool === 'shell_command' || unit.language === 'bash' || unit.language === 'shell');
  if (terminalUnit?.hash) return `pty-transcript:${rightPaneInlineLabel(terminalUnit.hash)}`;
  if (activeRun?.id) return `pty-transcript:${rightPaneInlineLabel(activeRun.id)}`;
  return 'pty-transcript:right-pane';
}

function terminalExecutionUnitFailed(unit: RuntimeExecutionUnit) {
  return unit.status === 'failed'
    || unit.status === 'failed-with-reason'
    || unit.status === 'repair-needed'
    || Boolean(unit.failureReason);
}

function terminalTranscriptForRightPane(units: RuntimeExecutionUnit[], locale?: ResultLocale) {
  if (!units.length) {
    return [
      '$ ask --help',
      `# ${resultText(locale, { 'zh-CN': '等待已附加的终端会话或运行输出。', 'en-US': 'Waiting for an attached terminal session or run output.' })}`,
    ].join('\n');
  }
  return units.slice(-8).flatMap((unit, index) => {
    const command = terminalCommandForExecutionUnit(unit, index);
    const lines = [
      `$ ${boundedRightPaneText(command, 220)}`,
      terminalStatusLineForExecutionUnit(unit, locale),
      unit.stdoutRef ? `[stdout] ${rightPaneInlineLabel(unit.stdoutRef)}` : undefined,
      unit.stderrRef ? `[stderr] ${rightPaneInlineLabel(unit.stderrRef)}` : undefined,
      unit.outputRef ? `[output] ${rightPaneInlineLabel(unit.outputRef)}` : undefined,
      unit.failureReason ? `[failed] ${boundedRightPaneText(unit.failureReason, 220)}` : undefined,
    ].filter((line): line is string => Boolean(line));
    return index === 0 ? lines : ['', ...lines];
  }).join('\n');
}

function terminalCommandForExecutionUnit(unit: RuntimeExecutionUnit, index: number) {
  if (unit.code?.trim()) return unit.code.trim();
  const paramsCommand = terminalCommandFromParams(unit.params);
  if (paramsCommand) return paramsCommand;
  return unit.tool || `step-${index + 1}`;
}

function terminalCommandFromParams(params: string | undefined) {
  if (!params?.trim()) return '';
  try {
    const parsed = JSON.parse(params) as unknown;
    if (isRecord(parsed)) {
      const direct = firstStringField(parsed, ['cmd', 'command', 'script']);
      if (direct) return direct;
      const args = parsed.args;
      if (Array.isArray(args) && args.every((item) => typeof item === 'string')) return args.join(' ');
    }
  } catch {
    // Params can be plain text for legacy execution units.
  }
  return params.length <= 160 && !/[{}\[\]"]/u.test(params) ? params.trim() : '';
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function terminalStatusLineForExecutionUnit(unit: RuntimeExecutionUnit, locale?: ResultLocale) {
  const status = terminalExecutionUnitFailed(unit) ? 'failed' : unit.status || 'recorded';
  const details = [
    unit.time ? unit.time : undefined,
    typeof unit.attempt === 'number' ? `attempt ${unit.attempt}` : undefined,
  ].filter(Boolean).join(' · ');
  const label = resultText(locale, {
    'zh-CN': status === 'running'
      ? '运行中'
      : status === 'done'
        ? '完成'
        : status === 'failed'
          ? '失败'
          : '记录',
    'en-US': status === 'running'
      ? 'running'
      : status === 'done'
        ? 'done'
        : status === 'failed'
          ? 'failed'
          : 'recorded',
  });
  return details ? `[${label}] ${boundedRightPaneText(details, 120)}` : `[${label}]`;
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
  onWorkbenchToolSelect,
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
  onWorkbenchToolSelect: (tab: ResultPaneTab) => void;
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
        <>
          <EmptyArtifactState
            title={model.emptyState.title}
            detail={model.emptyState.detail}
            recoverActions={model.emptyState.recoverActions}
          />
          <RightPaneToolDock locale={locale} onSelect={onWorkbenchToolSelect} />
        </>
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
