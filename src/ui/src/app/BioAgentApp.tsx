import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUp,
  CircleStop,
  Clock,
  Copy,
  Download,
  Eye,
  File,
  FileCode,
  Files,
  FilePlus,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Lock,
  Plus,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  scenarios,
  feasibilityRows,
  navItems,
  radarData,
  roleTabs,
  stats,
  type ScenarioId,
  type ClaimType,
  type EvidenceLevel,
  type PageId,
} from '../data';
import { SCENARIO_SPECS, SCENARIO_PRESETS, componentManifest } from '../scenarioSpecs';
import { compileScenarioDraft, scenarioIdBySkillDomain, type ScenarioBuilderDraft } from '../scenarioCompiler/scenarioDraftCompiler';
import { compileScenarioIRFromSelection, recommendScenarioElements, type ScenarioElementSelection } from '../scenarioCompiler/scenarioElementCompiler';
import { elementRegistry } from '../scenarioCompiler/elementRegistry';
import { runScenarioRuntimeSmoke } from '../scenarioCompiler/runtimeSmoke';
import { buildScenarioQualityReport } from '../scenarioCompiler/scenarioQualityGate';
import { buildBuiltInScenarioPackage, builtInScenarioPackageRef, type ScenarioPackage } from '../scenarioCompiler/scenarioPackage';
import type { ScenarioLibraryItem } from '../scenarioCompiler/scenarioLibrary';
import { compileSlotsForScenario } from '../scenarioCompiler/uiPlanCompiler';
import { scpMarkdownSkills } from '../scpSkillCatalog';
import { timeline } from '../demoData';
import { sendAgentMessageStream } from '../api/agentClient';
import { sendBioAgentToolMessage } from '../api/bioagentToolsClient';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../exportPolicy';
import {
  makeId,
  nowIso,
  type AlignmentContractRecord,
  type BioAgentMessage,
  type BioAgentReference,
  type BioAgentRun,
  type BioAgentSession,
  type BioAgentWorkspaceState,
  type BioAgentConfig,
  type AgentStreamEvent,
  type DisplayIntent,
  type EvidenceClaim,
  type FeedbackCommentRecord,
  type FeedbackCommentStatus,
  type FeedbackPriority,
  type FeedbackRuntimeSnapshot,
  type FeedbackTargetSnapshot,
  type NotebookRecord,
  type NormalizedAgentResponse,
  type ObjectAction,
  type ObjectReference,
  type ResolvedViewPlan,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type ScenarioInstanceId,
  type ScenarioRuntimeOverride,
  type TimelineEventRecord,
  type UIManifestSlot,
  type ViewPlanSection,
  type ReusableTaskCandidateRecord,
} from '../domain';
import { uiModuleRegistry, type PresentationDedupeScope, type RuntimeUIModule } from '../uiModuleRegistry';
import type { VolcanoPoint } from '../charts';
import { compactWorkspaceStateForStorage, createSession, loadWorkspaceState, resetSession, saveWorkspaceState, sessionActivityScore, shouldUsePersistedWorkspaceState, versionSession } from '../sessionStore';
import { loadBioAgentConfig, normalizeWorkspaceRootPath, saveBioAgentConfig, updateConfig } from '../config';
import {
  acceptSkillPromotionProposal,
  archiveSkillPromotionProposal,
  archiveWorkspaceScenario,
  deleteWorkspaceScenario,
  listSkillPromotionProposals,
  listWorkspace,
  loadFileBackedBioAgentConfig,
  loadPersistedWorkspaceState,
  loadScenarioLibrary,
  loadWorkspaceScenario,
  mutateWorkspaceFile,
  openWorkspaceObject,
  persistWorkspaceState,
  publishWorkspaceScenario,
  rejectSkillPromotionProposal,
  restoreWorkspaceScenario,
  saveFileBackedBioAgentConfig,
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
import { AlignmentPage, TimelinePage, type AlignmentContractData } from './AlignmentPages';
import { Dashboard } from './Dashboard';
import { ResultsRenderer, handoffAutoRunPrompt, type HandoffAutoRunRequest } from './ResultsRenderer';
import { ScenarioBuilderPanel, defaultElementSelectionForScenario, scenarioPackageToOverride } from './ScenarioBuilderPanel';
import { ChatPanel, mergeRunTimelineEvents, objectReferenceKindLabel } from './ChatPanel';
import { exportJsonFile, exportTextFile } from './exportUtils';
import { RuntimeHealthPanel, useRuntimeHealth, type RuntimeHealthItem } from './runtimeHealthPanel';
import { ActionButton, Badge, Card, ChartLoadingFallback, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, IconButton, SectionHeader, TabBar, cx } from './uiPrimitives';
import { HeatmapViewer, MoleculeViewer, NetworkGraph, UmapViewer } from '../visualizations';

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


function checksumText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
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
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 36);
  return title || '新聊天';
}

const FEEDBACK_AUTHOR_KEY = 'bioagent.feedback.author.v1';
const APP_BUILD_ID = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'local-dev';

function loadFeedbackAuthor() {
  if (typeof window === 'undefined') return { authorId: 'local-user', authorName: 'Local User' };
  try {
    const raw = window.localStorage.getItem(FEEDBACK_AUTHOR_KEY);
    if (raw) {
      const value = JSON.parse(raw) as { authorId?: unknown; authorName?: unknown };
      if (typeof value.authorId === 'string' && typeof value.authorName === 'string') {
        return { authorId: value.authorId, authorName: value.authorName };
      }
    }
  } catch {
    // Fall through to a stable browser-local author.
  }
  const author = { authorId: makeId('feedback-user'), authorName: 'Local User' };
  saveFeedbackAuthor(author);
  return author;
}

function saveFeedbackAuthor(author: { authorId: string; authorName: string }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FEEDBACK_AUTHOR_KEY, JSON.stringify(author));
  } catch {
    // Feedback capture still works without local author persistence.
  }
}


function hasUsableModelConfig(config: BioAgentConfig) {
  const provider = config.modelProvider.trim() || 'native';
  if (provider === 'native') {
    return Boolean(config.modelName.trim() || config.modelBaseUrl.trim() || config.apiKey.trim());
  }
  return Boolean(config.modelBaseUrl.trim() && config.apiKey.trim());
}

const extensionTools = [
  { name: 'Workspace Runtime Gateway', detail: 'deterministic task dispatch / artifact JSON / ExecutionUnit', kind: 'runtime' },
  { name: 'MCP Tool Adapters', detail: 'fixed remote tool flows and connector contracts', kind: 'mcp' },
  { name: 'PubMed E-utilities', detail: 'literature search and paper-list artifacts', kind: 'database' },
  { name: 'RCSB / AlphaFold DB', detail: 'structure metadata, coordinate download and parsing', kind: 'database' },
  { name: 'UniProt / ChEMBL', detail: 'protein, compound and mechanism lookups', kind: 'database' },
  { name: 'NCBI BLAST URL API', detail: 'BLASTP sequence-alignment artifacts', kind: 'database' },
  { name: 'Python / R / Shell / CLI Runner', detail: 'workspace-local reproducible task execution', kind: 'runner' },
  { name: 'AgentServer Repair Bridge', detail: 'task generation and self-heal fallback', kind: 'fallback' },
];

const executableSeedSkills = [
  'literature.pubmed_search',
  'structure.rcsb_latest_or_entry',
  'omics.differential_expression',
  'knowledge.uniprot_chembl_lookup',
  'sequence.ncbi_blastp_search',
  'inspector.generic_file_table_log',
];

function explorerWorkspaceRoot(config: BioAgentConfig): string {
  return (config.workspacePath || '').replace(/\/+$/, '');
}

function pathBasename(p: string): string {
  const c = p.replace(/\/+$/, '');
  if (!c) return '';
  const i = c.lastIndexOf('/');
  return i >= 0 ? c.slice(i + 1) : c;
}

function sortWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function syntheticFolderEntry(path: string): WorkspaceEntry {
  const clean = path.replace(/\/+$/, '') || path;
  return { kind: 'folder', path: clean, name: pathBasename(clean) || clean };
}

function explorerFileGlyph(name: string) {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go'].includes(ext)) {
    return <FileCode size={16} className="explorer-type-icon" aria-hidden />;
  }
  if (['.md', '.txt', '.rst'].includes(ext)) {
    return <FileText size={16} className="explorer-type-icon" aria-hidden />;
  }
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
    return <FileCode size={16} className="explorer-type-icon explorer-icon-muted" aria-hidden />;
  }
  return <File size={16} className="explorer-type-icon explorer-icon-muted" aria-hidden />;
}

function Sidebar({
  page,
  setPage,
  scenarioId,
  setScenarioId,
  config,
  workspaceStatus,
  onWorkspacePathChange,
  deferWorkbenchFilePreview,
  onWorkbenchFileOpened,
  workbenchEditorFilePath,
  onWorkbenchEditorPathInvalidated,
}: {
  page: PageId;
  setPage: (page: PageId) => void;
  scenarioId: ScenarioInstanceId;
  setScenarioId: (id: ScenarioId) => void;
  config: BioAgentConfig;
  workspaceStatus: string;
  onWorkspacePathChange: (value: string) => void;
  deferWorkbenchFilePreview?: boolean;
  onWorkbenchFileOpened?: (file: WorkspaceFileContent) => void;
  workbenchEditorFilePath?: string | null;
  onWorkbenchEditorPathInvalidated?: () => void;
}) {
  const workspaceRoot = explorerWorkspaceRoot(config);
  const [collapsed, setCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState<'navigation' | 'workspace' | 'extensions'>('navigation');
  const prevPageRef = useRef<PageId | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(284);
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<{ path: string; kind: 'file' | 'folder' } | null>(null);
  const [pathEditDraft, setPathEditDraft] = useState(config.workspacePath);
  const [previewFile, setPreviewFile] = useState<WorkspaceFileContent | null>(null);
  const [previewDraft, setPreviewDraft] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry?: WorkspaceEntry } | null>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    if (collapsed) return;
    function handleMouseMove(event: MouseEvent) {
      if (!resizingRef.current) return;
      const nextWidth = Math.min(420, Math.max(220, event.clientX));
      setSidebarWidth(nextWidth);
    }
    function handleMouseUp() {
      resizingRef.current = false;
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [collapsed]);

  function handlePanelSwitch(panel: 'navigation' | 'workspace' | 'extensions') {
    setActivePanel(panel);
    setCollapsed(false);
  }

  useEffect(() => {
    if (page === 'workbench' && prevPageRef.current !== 'workbench') {
      setActivePanel('workspace');
      setCollapsed(false);
    }
    prevPageRef.current = page;
  }, [page]);

  useEffect(() => {
    const root = explorerWorkspaceRoot(config);
    setPathEditDraft(config.workspacePath);
    setPreviewFile(null);
    setPreviewDraft('');
    setPreviewDirty(false);
    setFolderChildren({});
    setExpandedFolders(new Set(root ? [root] : []));
    setSelectedEntry(root ? { path: root, kind: 'folder' } : null);
  }, [config.workspacePath]);

  useEffect(() => {
    if (activePanel !== 'workspace' || collapsed || !workspaceRoot) return;
    void (async () => {
      try {
        setWorkspaceError('');
        const entries = await listWorkspace(workspaceRoot, config);
        setFolderChildren((prev) => ({ ...prev, [workspaceRoot]: sortWorkspaceEntries(entries) }));
        setWorkspaceNotice(entries.length ? `已加载 ${entries.length} 项` : '文件夹为空');
      } catch (err) {
        setFolderChildren({});
        setWorkspaceError(err instanceof Error ? err.message : String(err));
        setWorkspaceNotice('');
      }
    })();
  }, [activePanel, collapsed, workspaceRoot, config.workspaceWriterBaseUrl, config.workspacePath]);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  function effectiveCreateParentPath(): string {
    const root = explorerWorkspaceRoot(config);
    if (!selectedEntry) return root;
    if (selectedEntry.kind === 'folder') return selectedEntry.path;
    const p = parentPath(selectedEntry.path);
    return p && p.length ? p : root;
  }

  async function ensureFolderLoaded(dirPath: string) {
    if (!dirPath.trim()) return;
    try {
      setWorkspaceError('');
      const raw = await listWorkspace(dirPath, config);
      setFolderChildren((prev) => ({ ...prev, [dirPath]: sortWorkspaceEntries(raw) }));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshExplorer() {
    const root = explorerWorkspaceRoot(config);
    if (!root) {
      setWorkspaceNotice('');
      return;
    }
    try {
      setWorkspaceError('');
      const paths = new Set<string>([root, ...expandedFolders]);
      const next: Record<string, WorkspaceEntry[]> = {};
      for (const p of paths) {
        if (!p.trim()) continue;
        const raw = await listWorkspace(p, config);
        next[p] = sortWorkspaceEntries(raw);
      }
      setFolderChildren((prev) => ({ ...prev, ...next }));
      const n = next[root]?.length ?? 0;
      setWorkspaceNotice(n ? `已加载 ${n} 项` : '文件夹为空');
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function collapseExplorerFolders() {
    const root = explorerWorkspaceRoot(config);
    if (!root) {
      setExpandedFolders(new Set());
      return;
    }
    setExpandedFolders(new Set([root]));
  }

  async function openWorkspaceEntry(entry: WorkspaceEntry) {
    if (entry.kind === 'folder') return;
    setSelectedEntry({ path: entry.path, kind: 'file' });
    try {
      setWorkspaceError('');
      const file = await readWorkspaceFile(entry.path, config);
      onWorkbenchFileOpened?.(file);
      if (deferWorkbenchFilePreview) {
        setPreviewFile(null);
        setPreviewDraft('');
        setPreviewDirty(false);
      } else {
        setPreviewFile(file);
        setPreviewDraft(file.content);
        setPreviewDirty(false);
      }
      setWorkspaceNotice(`已打开 ${file.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function savePreviewFile() {
    if (!previewFile) return;
    try {
      setWorkspaceError('');
      const file = await writeWorkspaceFile(previewFile.path, previewDraft, config);
      setPreviewFile(file);
      setPreviewDraft(file.content);
      setPreviewDirty(false);
      setWorkspaceNotice(`已保存 ${file.name}`);
      await refreshExplorer();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function runWorkspaceAction(action: 'create-file' | 'create-folder' | 'rename' | 'delete', entry?: WorkspaceEntry) {
    const root = explorerWorkspaceRoot(config);
    const basePath = entry?.kind === 'folder'
      ? entry.path
      : entry?.kind === 'file'
        ? (parentPath(entry.path) || root)
        : effectiveCreateParentPath();
    const selectedPath = entry?.path || selectedEntry?.path || root;
    let targetPath = selectedPath;
    let renameTarget: string | undefined;
    if (action === 'create-file') {
      const name = window.prompt('新文件名', 'notes.md');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === 'create-folder') {
      const name = window.prompt('新文件夹名', 'new-folder');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === 'rename') {
      if (!entry) return;
      const name = window.prompt('重命名为', entry.name);
      if (!name || name === entry.name) return;
      renameTarget = `${entry.path.slice(0, -entry.name.length)}${name}`;
    } else if (action === 'delete') {
      if (!entry || !window.confirm(`删除 ${entry.name}？`)) return;
    }
    try {
      setWorkspaceError('');
      await mutateWorkspaceFile(config, action, { path: targetPath, targetPath: renameTarget });
      const invalidatedWorkbenchPath = entry?.path && workbenchEditorFilePath && entry.path === workbenchEditorFilePath;
      if (invalidatedWorkbenchPath) {
        onWorkbenchEditorPathInvalidated?.();
      }
      if (previewFile && (previewFile.path === targetPath || previewFile.path === selectedPath)) {
        setPreviewFile(null);
        setPreviewDraft('');
        setPreviewDirty(false);
      }
      await refreshExplorer();
      setWorkspaceNotice(workspaceActionSuccessMessage(action));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function initializeWorkspacePath() {
    const root = config.workspacePath.trim();
    if (!root) {
      setWorkspaceError('请先填写 workspace path。');
      return;
    }
    try {
      setWorkspaceError('');
      setWorkspaceNotice('正在创建 BioAgent workspace...');
      await mutateWorkspaceFile(config, 'create-folder', { path: root });
      await mutateWorkspaceFile(config, 'create-folder', { path: `${root.replace(/\/+$/, '')}/.bioagent` });
      for (const resource of ['tasks', 'logs', 'task-results', 'scenarios', 'exports', 'artifacts', 'sessions', 'versions']) {
        await mutateWorkspaceFile(config, 'create-folder', { path: `${root.replace(/\/+$/, '')}/.bioagent/${resource}` });
      }
      await refreshExplorer();
      setWorkspaceNotice('BioAgent workspace 已创建；可以导入 package 或运行场景。');
    } catch (err) {
      setWorkspaceError(workspaceOnboardingError(err));
      setWorkspaceNotice('');
    }
  }

  async function openFolderFromContext(path: string) {
    setSelectedEntry({ path, kind: 'folder' });
    setExpandedFolders((prev) => new Set([...prev, path]));
    await ensureFolderLoaded(path);
  }

  async function toggleFolderExpanded(path: string, nextExpanded?: boolean) {
    const shouldExpand = typeof nextExpanded === 'boolean' ? nextExpanded : !expandedFolders.has(path);
    if (shouldExpand) {
      setExpandedFolders((prev) => new Set([...prev, path]));
      await ensureFolderLoaded(path);
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  async function handleContextMenuAction(action: 'create-file' | 'create-folder' | 'rename' | 'delete') {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    await runWorkspaceAction(action, entry);
  }

  async function handleContextMenuOpen() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry) return;
    if (entry.kind === 'folder') {
      await openFolderFromContext(entry.path);
      return;
    }
    await openWorkspaceEntry(entry);
  }

  async function handleContextMenuToggleFolder() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry || entry.kind !== 'folder') return;
    await toggleFolderExpanded(entry.path);
  }

  async function handleContextMenuCopyPath() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    await navigator.clipboard?.writeText(entry.path);
    setWorkspaceNotice(`已复制路径 ${entry.path}`);
  }

  function toWorkspaceRelativePath(path: string): string {
    const root = explorerWorkspaceRoot(config).replace(/\/+$/, '');
    const current = path.replace(/\/+$/, '');
    if (root && current.startsWith(`${root}/`)) return current.slice(root.length + 1);
    if (root && current === root) return '.';
    return current;
  }

  async function handleContextMenuCopyRelativePath() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    const relativePath = toWorkspaceRelativePath(entry.path);
    await navigator.clipboard?.writeText(relativePath);
    setWorkspaceNotice(`已复制相对路径 ${relativePath}`);
  }

  async function handleContextMenuRevealInFolder() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    try {
      setWorkspaceError('');
      await openWorkspaceObject(config, 'reveal-in-folder', entry.path, config.workspacePath);
      setWorkspaceNotice(`已在系统文件管理器定位 ${entry.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function handleContextMenuOpenExternal() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    try {
      setWorkspaceError('');
      await openWorkspaceObject(config, 'open-external', entry.path, config.workspacePath);
      setWorkspaceNotice(`已使用系统默认方式打开 ${entry.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function handleContextMenuOpenInWorkbench() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry || entry.kind !== 'file') return;
    try {
      setWorkspaceError('');
      const file = await readWorkspaceFile(entry.path, config);
      onWorkbenchFileOpened?.(file);
      setPage('workbench');
      setWorkspaceNotice(`已在工作台打开 ${file.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function renderExplorerDepth(depth: number, dirPath: string): ReactNode {
    const entries = folderChildren[dirPath];
    if (entries === undefined) {
      return (
        <div className="explorer-loading" style={{ paddingLeft: 12 + depth * 12 }}>
          加载中…
        </div>
      );
    }
    return entries.map((entry) => {
      const isExpanded = entry.kind === 'folder' && expandedFolders.has(entry.path);
      const isSelected = selectedEntry?.path === entry.path;
      return (
        <div key={entry.path} className="explorer-node">
          <div
            role="treeitem"
            aria-expanded={entry.kind === 'folder' ? isExpanded : undefined}
            className={cx('explorer-row', entry.kind === 'file' && 'is-file', isSelected && 'is-selected')}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('.explorer-twistie')) return;
              setSelectedEntry({ path: entry.path, kind: entry.kind });
              if (entry.kind === 'file') void openWorkspaceEntry(entry);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelectedEntry({ path: entry.path, kind: entry.kind });
              setContextMenu({ x: event.clientX, y: event.clientY, entry });
            }}
          >
            {entry.kind === 'folder' ? (
              <button
                type="button"
                className="explorer-twistie"
                aria-label={isExpanded ? '折叠' : '展开'}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setExpandedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else {
                      next.add(entry.path);
                      void ensureFolderLoaded(entry.path);
                    }
                    return next;
                  });
                }}
              >
                {isExpanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
              </button>
            ) : (
              <span className="explorer-twistie-placeholder" aria-hidden />
            )}
            {entry.kind === 'folder' ? <Folder size={16} className="explorer-type-icon" aria-hidden /> : explorerFileGlyph(entry.name)}
            <span className="explorer-label">{entry.name}</span>
          </div>
          {entry.kind === 'folder' && isExpanded ? (
            <div className="explorer-branch" role="group">
              {renderExplorerDepth(depth + 1, entry.path)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  return (
    <aside className={cx('sidebar', collapsed && 'collapsed', activePanel === 'workspace' && 'explorer-theme')} style={{ width: collapsed ? 46 : sidebarWidth }}>
      <div className="sidebar-activitybar">
        <div className="brand">
          <div className="brand-mark">BA</div>
        </div>
        <button
          className={cx('activity-item', activePanel === 'navigation' && !collapsed && 'active')}
          onClick={() => handlePanelSwitch('navigation')}
          title="导航"
          aria-label="导航"
        >
          <Target size={18} />
        </button>
        <button
          className={cx('activity-item', activePanel === 'workspace' && !collapsed && 'active')}
          onClick={() => handlePanelSwitch('workspace')}
          title="资源管理器"
          aria-label="资源管理器"
        >
          <Files size={18} />
        </button>
        <button
          className={cx('activity-item', activePanel === 'extensions' && !collapsed && 'active')}
          onClick={() => handlePanelSwitch('extensions')}
          title="拓展"
          aria-label="拓展"
        >
          <Sparkles size={18} />
        </button>
        {collapsed ? (
          <button className="collapse-button top-toggle" onClick={() => setCollapsed(false)} title="展开侧栏" aria-label="展开侧栏">
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="sidebar-panel">
          <div className={cx('sidebar-panel-header', activePanel === 'workspace' && 'explorer-panel-header')}>
            {activePanel === 'workspace' ? (
              <>
                <span className="explorer-view-title">资源管理器</span>
                <div className="explorer-view-toolbar">
                  <button
                    type="button"
                    className="explorer-icon-btn"
                    onClick={() => void runWorkspaceAction('create-file')}
                    title="新建文件"
                    aria-label="新建文件"
                  >
                    <FilePlus size={16} />
                  </button>
                  <button
                    type="button"
                    className="explorer-icon-btn"
                    onClick={() => void runWorkspaceAction('create-folder')}
                    title="新建文件夹"
                    aria-label="新建文件夹"
                  >
                    <FolderPlus size={16} />
                  </button>
                  <button type="button" className="explorer-icon-btn" onClick={() => void refreshExplorer()} title="刷新" aria-label="刷新">
                    <RefreshCw size={16} />
                  </button>
                  <button type="button" className="explorer-icon-btn" onClick={collapseExplorerFolders} title="全部折叠" aria-label="全部折叠">
                    <ChevronsUp size={16} />
                  </button>
                  <button className="panel-collapse-button" onClick={() => setCollapsed(true)} title="收起侧栏" aria-label="收起侧栏">
                    <ChevronLeft size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>
                  {activePanel === 'navigation' ? '导航' : '拓展'}
                </span>
                <button className="panel-collapse-button" onClick={() => setCollapsed(true)} title="收起侧栏" aria-label="收起侧栏">
                  <ChevronLeft size={16} />
                </button>
              </>
            )}
          </div>
          <div className="sidebar-panel-body">
            {activePanel === 'navigation' ? (
              <>
                <nav className="nav-section">
                  {navItems.map((item) => (
                    <button key={item.id} className={cx('nav-item', page === item.id && 'active')} onClick={() => setPage(item.id)}>
                      <item.icon size={18} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </nav>
                <div className="scenario-list">
                  <div className="sidebar-label">场景编译</div>
                  <button
                    className="scenario-compile-card"
                    onClick={() => setPage('dashboard')}
                  >
                    <Sparkles size={15} />
                    <span>
                      <strong>描述需求并编译新场景</strong>
                      <small>选择 skills / tools / UI 组件后发布稳定 workspace package</small>
                    </span>
                  </button>
                  <div className="sidebar-package-note">
                    <strong>统一 Scenario Library</strong>
                    <span>官方模板、workspace package 和新编译场景都在研究概览中按需打开、导入或编辑配置。</span>
                  </div>
                </div>
              </>
            ) : null}
            {activePanel === 'workspace' ? (
              <div
                className="sidebar-tree explorer-surface"
                role="tree"
                aria-label="工作区文件树"
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest('.explorer-row')) return;
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                {workspaceNeedsOnboarding(config.workspacePath, workspaceError, workspaceStatus) ? (
                  <div className="workspace-onboarding">
                    <strong>{config.workspacePath.trim() ? '初始化 BioAgent workspace' : '设置 workspace path'}</strong>
                    <p>{workspaceOnboardingReason(config.workspacePath, workspaceError, workspaceStatus)}</p>
                    <button type="button" onClick={() => void initializeWorkspacePath()}>
                      创建 .bioagent 工作区
                    </button>
                  </div>
                ) : null}
                {workspaceNotice ? <p className="workspace-status explorer-muted-line" role="status">{workspaceNotice}</p> : null}
                {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
                {!workspaceNeedsOnboarding(config.workspacePath, workspaceError, workspaceStatus) && workspaceRoot ? (
                  <div className="explorer-section">
                    <div
                      role="treeitem"
                      aria-expanded={expandedFolders.has(workspaceRoot)}
                      className={cx('explorer-row', 'explorer-root-row', selectedEntry?.path === workspaceRoot && 'is-selected')}
                      style={{ paddingLeft: 8 }}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('.explorer-twistie')) return;
                        setSelectedEntry({ path: workspaceRoot, kind: 'folder' });
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSelectedEntry({ path: workspaceRoot, kind: 'folder' });
                        setContextMenu({ x: event.clientX, y: event.clientY, entry: syntheticFolderEntry(workspaceRoot) });
                      }}
                    >
                      <button
                        type="button"
                        className="explorer-twistie"
                        aria-label={expandedFolders.has(workspaceRoot) ? '折叠' : '展开'}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setExpandedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(workspaceRoot)) next.delete(workspaceRoot);
                            else {
                              next.add(workspaceRoot);
                              void ensureFolderLoaded(workspaceRoot);
                            }
                            return next;
                          });
                        }}
                      >
                        {expandedFolders.has(workspaceRoot) ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
                      </button>
                      <FolderOpen size={16} className="explorer-type-icon" aria-hidden />
                      <span className="explorer-label">{pathBasename(workspaceRoot) || workspaceRoot}</span>
                    </div>
                    {expandedFolders.has(workspaceRoot) ? (
                      <div className="explorer-branch explorer-root-children" role="group">
                        {renderExplorerDepth(0, workspaceRoot)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {previewFile ? (
                  <div className="workspace-preview" aria-label="文件预览">
                    <div className="workspace-preview-head">
                      <span>
                        <FileText size={13} />
                        <strong>{previewFile.name}</strong>
                        {previewDirty ? <Badge variant="warning">未保存</Badge> : <Badge variant="success">已保存</Badge>}
                      </span>
                      <div>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(previewFile.path)} title="复制路径" aria-label="复制路径"><Copy size={13} /></button>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(previewDraft)} title="复制内容" aria-label="复制内容"><Copy size={13} /></button>
                        <button type="button" onClick={() => void savePreviewFile()} disabled={!previewDirty} title="保存文件" aria-label="保存文件"><Save size={13} /></button>
                      </div>
                    </div>
                    <textarea
                      value={previewDraft}
                      spellCheck={false}
                      onChange={(event) => {
                        setPreviewDraft(event.target.value);
                        setPreviewDirty(event.target.value !== previewFile.content);
                      }}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                          event.preventDefault();
                          void savePreviewFile();
                        }
                      }}
                      aria-label={`${previewFile.name} 文件内容`}
                    />
                    <div className="workspace-preview-meta">
                      <code>{previewFile.language}</code>
                      <span>{formatBytes(previewFile.size)}</span>
                      {previewFile.modifiedAt ? <span>{new Date(previewFile.modifiedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
                    </div>
                  </div>
                ) : null}
                {contextMenu ? (
                  <div className="context-menu context-menu-vscode" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
                    {contextMenu.entry?.kind === 'folder' ? (
                      <button
                        type="button"
                        onClick={() => void handleContextMenuToggleFolder()}
                      >
                        {expandedFolders.has(contextMenu.entry.path) ? '折叠' : '展开'}
                      </button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuOpen()}>
                        {contextMenu.entry.kind === 'folder' ? '打开文件夹' : '打开'}
                      </button>
                    ) : null}
                    {contextMenu.entry?.kind === 'file' ? (
                      <button type="button" onClick={() => void handleContextMenuOpenInWorkbench()}>在工作台打开</button>
                    ) : null}
                    <hr className="context-menu-separator" />
                    <button type="button" onClick={() => void handleContextMenuAction('create-file')}>新建文件</button>
                    <button type="button" onClick={() => void handleContextMenuAction('create-folder')}>新建文件夹</button>
                    {contextMenu.entry ? <button type="button" onClick={() => void handleContextMenuAction('rename')}>重命名</button> : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuCopyPath()}>复制路径</button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuCopyRelativePath()}>复制相对路径</button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuRevealInFolder()}>在文件管理器中显示</button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuOpenExternal()}>系统默认程序打开</button>
                    ) : null}
                    {contextMenu.entry ? <button type="button" className="danger" onClick={() => void handleContextMenuAction('delete')}>删除</button> : null}
                  </div>
                ) : null}
                <details className="explorer-folder-picker">
                  <summary>打开其他文件夹…</summary>
                  <div className="explorer-folder-picker-body">
                    <input
                      className="workspace-path-editor explorer-path-input"
                      value={pathEditDraft}
                      onChange={(event) => setPathEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void refreshExplorer();
                      }}
                      spellCheck={false}
                      title={workspaceStatus || 'Workspace 根路径'}
                      aria-label="Workspace 根路径"
                    />
                    <div className="explorer-folder-picker-actions">
                      <button type="button" className="explorer-cta-btn" onClick={() => onWorkspacePathChange(pathEditDraft.trim())}>
                        <Check size={14} />
                        用作工作区根目录
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
            {activePanel === 'extensions' ? (
              <div className="sidebar-tree">
                <div className="extension-section">
                  <div className="sidebar-label">Tools</div>
                  <p className="extension-note">确定性的 MCP tool、数据库 connector、runtime runner 和修复流程。</p>
                  {extensionTools.map((tool) => (
                    <div key={tool.name} className="extension-row" title={`${tool.name}: ${tool.detail}`}>
                      <span className="extension-icon"><Settings size={13} /></span>
                      <span className="extension-copy">
                        <strong>{tool.name}</strong>
                        <small>{tool.kind} · {tool.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="extension-section">
                  <div className="sidebar-label">Skills</div>
                  <p className="extension-note">Markdown skill 是可读、可安装、可沉淀的任务知识；seed skill 描述能力和产物契约。</p>
                  <div className="extension-subhead">
                    <span>Seed capability contracts</span>
                    <code>{executableSeedSkills.length}</code>
                  </div>
                  {executableSeedSkills.map((skill) => (
                    <div key={skill} className="extension-row compact" title={`skills/seed/${skill}/skill.json`}>
                      <span className="extension-icon"><FileCode size={13} /></span>
                      <span className="extension-copy">
                        <strong>{skill}</strong>
                        <small>skills/seed capability manifest</small>
                      </span>
                    </div>
                  ))}
                  <div className="extension-subhead">
                    <span>SCP markdown skills</span>
                    <code>{scpMarkdownSkills.length}</code>
                  </div>
                  <div className="skill-catalog-list">
                    {scpMarkdownSkills.map((skill) => (
                      <div key={skill.id} className="extension-row compact" title={`${skill.description}\n${skill.path}`}>
                        <span className="extension-icon"><FileText size={13} /></span>
                        <span className="extension-copy">
                          <strong>{skill.name}</strong>
                          <small>{skill.description}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {!collapsed ? (
        <div
          className="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整左侧栏宽度"
          onMouseDown={() => {
            resizingRef.current = true;
          }}
        />
      ) : null}
    </aside>
  );
}

function workspaceActionSuccessMessage(action: 'create-file' | 'create-folder' | 'rename' | 'delete') {
  if (action === 'create-file') return '文件已创建。';
  if (action === 'create-folder') return '文件夹已创建。';
  if (action === 'rename') return '资源已重命名。';
  return '资源已删除。';
}

function workspaceNeedsOnboarding(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return true;
  const combined = `${workspaceError} ${workspaceStatus}`;
  return /ENOENT|no such file|not found|未找到|不存在/i.test(combined);
}

function workspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return '当前还没有 workspace path；填写一个本机目录后可以创建 .bioagent 资源结构。';
  const combined = `${workspaceError} ${workspaceStatus}`;
  if (/EACCES|EPERM|permission|权限/i.test(combined)) {
    return '当前路径权限不足；请选择可写目录，或修复目录权限后再创建。';
  }
  if (/Workspace Writer 未连接|Failed to fetch|无法访问|connection/i.test(combined)) {
    return 'Workspace Writer 当前不可用；请启动 npm run workspace:server 后再创建。';
  }
  return `未找到 ${path}/.bioagent/workspace-state.json；可以创建标准 .bioagent 目录结构作为新工作区。`;
}

function workspaceOnboardingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM|permission/i.test(message)) return `创建失败：权限不足。${message}`;
  if (/Workspace Writer 未连接|Failed to fetch|fetch/i.test(message)) return `创建失败：Workspace Writer 未连接。${message}`;
  return `创建失败：${message}`;
}

function parentPath(path: string) {
  const clean = path.replace(/\/+$/, '');
  if (!clean || clean === '/') return clean || '/';
  const index = clean.lastIndexOf('/');
  return index <= 0 ? '/' : clean.slice(0, index);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function TopBar({
  onSearch,
  onSettingsOpen,
  healthItems,
}: {
  onSearch: (query: string) => void;
  onSettingsOpen: () => void;
  healthItems: RuntimeHealthItem[];
}) {
  const [query, setQuery] = useState('');
  const healthProblems = healthItems.filter((item) => item.status === 'offline' || item.status === 'not-configured').length;
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query);
  }
  return (
    <header className="topbar">
      <form className="searchbox" onSubmit={handleSubmit}>
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索基因、通路、文献、Execution Unit..." />
      </form>
      <div className="topbar-actions">
        <Badge variant={healthProblems ? 'warning' : 'success'} glow>
          Scenario Runtime · {healthProblems ? `${healthProblems} actions` : 'ready'}
        </Badge>
        <IconButton icon={Settings} label="设置" onClick={onSettingsOpen} />
      </div>
    </header>
  );
}

function SettingsDialog({
  config,
  onChange,
  saveState,
  onSave,
  onClose,
}: {
  config: BioAgentConfig;
  onChange: (patch: Partial<BioAgentConfig>) => void;
  saveState: ConfigSaveState;
  onSave: () => void;
  onClose: () => void;
}) {
  const healthItems = useRuntimeHealth(config);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="BioAgent 设置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <div>
            <h2>设置</h2>
            <p>统一配置 AgentServer、模型连接和本地 workspace。</p>
          </div>
          <IconButton icon={ChevronDown} label="关闭设置" onClick={onClose} />
        </div>
        <RuntimeHealthPanel items={healthItems} />
        <div className="settings-grid">
          <label>
            <span>AgentServer Base URL</span>
            <input value={config.agentServerBaseUrl} onChange={(event) => onChange({ agentServerBaseUrl: event.target.value })} />
          </label>
          <label>
            <span>Workspace Writer URL</span>
            <input value={config.workspaceWriterBaseUrl} onChange={(event) => onChange({ workspaceWriterBaseUrl: event.target.value })} />
          </label>
          <label className="wide">
            <span>Workspace Path</span>
            <input value={config.workspacePath} onChange={(event) => onChange({ workspacePath: event.target.value })} />
          </label>
          <label>
            <span>Agent Backend</span>
            <select value={config.agentBackend} onChange={(event) => onChange({ agentBackend: event.target.value })}>
              <option value="codex">Codex</option>
              <option value="openteam_agent">OpenTeam Agent</option>
              <option value="claude-code">Claude Code</option>
              <option value="hermes-agent">Hermes Agent</option>
              <option value="openclaw">OpenClaw</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label>
            <span>Model Provider</span>
            <select value={config.modelProvider} onChange={(event) => onChange({ modelProvider: event.target.value })}>
              <option value="native">native user endpoint</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="openrouter">openrouter</option>
              <option value="qwen">qwen</option>
              <option value="codex-chatgpt">codex-chatgpt</option>
              <option value="gemini">gemini</option>
            </select>
          </label>
          <label>
            <span>Model Name</span>
            <input value={config.modelName} onChange={(event) => onChange({ modelName: event.target.value })} placeholder="gpt-5.4 / local-model / ..." />
          </label>
          <label>
            <span>Model Base URL</span>
            <input value={config.modelBaseUrl} onChange={(event) => onChange({ modelBaseUrl: event.target.value })} placeholder="https://.../v1" />
          </label>
          <label>
            <span>API Key</span>
            <input type="password" value={config.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} placeholder="stored in local config.json" />
          </label>
          <label>
            <span>Timeout ms</span>
            <input
              type="number"
              min={30000}
              step={10000}
              value={config.requestTimeoutMs}
              onChange={(event) => onChange({ requestTimeoutMs: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Max Context Window (k tokens)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(config.maxContextWindowTokens / 1000)}
              onChange={(event) => onChange({ maxContextWindowTokens: Number(event.target.value) * 1000 })}
            />
          </label>
        </div>
        <div className="settings-save-state" role="status">
          <span className={cx('status-dot', saveState.status === 'error' ? 'offline' : saveState.status === 'saving' ? 'optional' : 'online')} />
          <span>
            {settingsSaveStateText(saveState)}
            {' '}
            下一次 AgentServer 请求会使用当前模型：
            {' '}
            <code>{config.agentBackend}</code>
            <strong>{config.modelProvider || 'native'}</strong>
            {config.modelName.trim() ? <code>{config.modelName.trim()}</code> : <em>user model not set</em>}
          </span>
          <ActionButton icon={Save} variant="primary" onClick={onSave} disabled={saveState.status === 'saving'}>
            {saveState.status === 'saving' ? '保存中' : '保存并生效'}
          </ActionButton>
          <ActionButton icon={RefreshCw} variant="secondary" onClick={() => window.location.reload()}>重新检测连接</ActionButton>
        </div>
      </section>
    </div>
  );
}

type ConfigSaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
  savedAt?: string;
};

function settingsSaveStateText(state: ConfigSaveState) {
  if (state.status === 'saving') return '正在保存到 config.local.json...';
  if (state.status === 'error') return state.message || 'config.local.json 保存失败，请检查 Workspace Writer。';
  if (state.status === 'saved') {
    const time = state.savedAt ? new Date(state.savedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    return time ? `已保存到 config.local.json（${time}）` : '已保存到 config.local.json';
  }
  return '修改后点击“保存并生效”，BioAgent 会写入 config.local.json。';
}

function formatSessionTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
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
  workspaceFileEditor,
  onWorkspaceFileEditorChange,
  externalReferenceRequest,
  onExternalReferenceConsumed,
}: {
  scenarioId: ScenarioInstanceId;
  config: BioAgentConfig;
  session: BioAgentSession;
  draft: string;
  savedScrollTop: number;
  onDraftChange: (scenarioId: ScenarioInstanceId, value: string) => void;
  onScrollTopChange: (scenarioId: ScenarioInstanceId, value: number) => void;
  onSessionChange: (session: BioAgentSession) => void;
  onNewChat: (scenarioId: ScenarioInstanceId) => void;
  onDeleteChat: (scenarioId: ScenarioInstanceId) => void;
  archivedSessions: BioAgentSession[];
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
  onConfigChange: (patch: Partial<BioAgentConfig>) => void;
  onTimelineEvent: (event: TimelineEventRecord) => void;
  onMarkReusableRun: (scenarioId: ScenarioInstanceId, runId: string) => void;
  workspaceFileEditor: { file: WorkspaceFileContent; draft: string } | null;
  onWorkspaceFileEditorChange: (next: { file: WorkspaceFileContent; draft: string } | null) => void;
  externalReferenceRequest?: { id: string; reference: BioAgentReference };
  onExternalReferenceConsumed: (requestId: string) => void;
}) {
  const baseScenarioId = builtInScenarioIdForInstance(scenarioId, scenarioOverride);
  const scenarioView = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
  const scenarioSpec = SCENARIO_PRESETS[baseScenarioId];
  const runtimeScenario = scenarioOverride ?? {
    title: scenarioSpec.title,
    description: scenarioSpec.description,
    skillDomain: scenarioSpec.skillDomain,
    scenarioMarkdown: scenarioSpec.scenarioMarkdown,
    defaultComponents: scenarioSpec.componentPolicy.defaultComponents,
    allowedComponents: scenarioSpec.componentPolicy.allowedComponents,
    fallbackComponent: scenarioSpec.componentPolicy.fallbackComponent,
  };
  const [role, setRole] = useState('biologist');
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [mobilePane, setMobilePane] = useState<'builder' | 'chat' | 'results'>('chat');
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [focusedObjectReference, setFocusedObjectReference] = useState<ObjectReference | undefined>();
  const [chatColumnWidth, setChatColumnWidth] = useState(42);
  const workbenchResizeRef = useRef<{ startX: number; startWidth: number; gridWidth: number } | null>(null);
  const runtimeHealth = useRuntimeHealth(config);
  const defaultResultSlots = useMemo(
    () => compileScenarioIRFromSelection(defaultElementSelectionForScenario(baseScenarioId, runtimeScenario)).uiPlan.slots,
    [baseScenarioId, runtimeScenario],
  );
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
      <div className="workbench-header">
        <div className="scenario-title">
          <div className="scenario-large-icon" style={{ color: scenarioView.color, background: `${scenarioView.color}18` }}>
            <scenarioView.icon size={24} />
          </div>
          <div>
            <h1 style={{ color: scenarioView.color }}>{runtimeScenario.title}</h1>
            <p>{runtimeScenario.description}</p>
          </div>
        </div>
        <div className="role-tabs">
          <span>角色视图</span>
          <TabBar tabs={roleTabs} active={role} onChange={setRole} />
        </div>
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
      <div className={cx('mobile-pane', mobilePane !== 'builder' && 'mobile-hidden')}>
        <ScenarioBuilderPanel
          scenarioId={baseScenarioId}
          scenario={runtimeScenario}
          config={config}
          runtimeHealth={runtimeHealth}
          expanded={settingsExpanded}
          onToggle={() => setSettingsExpanded((value) => !value)}
          onChange={(override) => onScenarioOverrideChange(scenarioId, override)}
        />
      </div>
      <div className="manifest-banner">
        <span>UIManifest</span>
        {runtimeScenario.defaultComponents.map((component) => (
          <code key={component}>{component}</code>
        ))}
        <code>fallback={runtimeScenario.fallbackComponent}</code>
      </div>
      <div
        className={cx('workbench-grid', 'workbench-canvas', resultsCollapsed && 'results-collapsed')}
        style={!resultsCollapsed ? { gridTemplateColumns: `minmax(360px, ${chatColumnWidth}%) 10px minmax(360px, 1fr)` } : undefined}
      >
        <div className={cx('mobile-pane', mobilePane !== 'chat' && 'mobile-hidden')}>
          <ChatPanel
            scenarioId={scenarioId}
            role={role}
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
            scenarioOverride={scenarioOverride}
            onConfigChange={onConfigChange}
            onTimelineEvent={onTimelineEvent}
            activeRunId={activeRunId}
            onActiveRunChange={setActiveRunId}
            onMarkReusableRun={(runId) => onMarkReusableRun(scenarioId, runId)}
            onObjectFocus={handleObjectFocus}
            externalReferenceRequest={externalReferenceRequest}
            onExternalReferenceConsumed={onExternalReferenceConsumed}
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
            workspaceFileEditor={workspaceFileEditor}
            onWorkspaceFileEditorChange={onWorkspaceFileEditorChange}
          />
        </div>
      </div>
    </main>
  );
}

function FeedbackCaptureLayer({
  page,
  scenarioId,
  session,
  author,
  onAuthorChange,
  onSubmit,
  onReference,
}: {
  page: PageId;
  scenarioId: ScenarioInstanceId;
  session: BioAgentSession;
  author: { authorId: string; authorName: string };
  onAuthorChange: (author: { authorId: string; authorName: string }) => void;
  onSubmit: (comment: FeedbackCommentRecord) => void;
  onReference: (reference: BioAgentReference) => void;
}) {
  const [contextTarget, setContextTarget] = useState<{ x: number; y: number; target: FeedbackTargetSnapshot; selectedText: string; objectReference?: BioAgentReference; mode: 'menu' | 'comment' } | null>(null);
  const [comment, setComment] = useState('');
  const [priority, setPriority] = useState<FeedbackPriority>('normal');
  const [tags, setTags] = useState('');

  useEffect(() => {
    function openMenu(event: MouseEvent) {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest('[data-feedback-control="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setContextTarget({
        x: Math.min(event.clientX, window.innerWidth - 230),
        y: Math.min(event.clientY, window.innerHeight - 160),
        target: feedbackTargetSnapshot(element),
        selectedText: currentSelectedText(),
        objectReference: bioAgentReferenceFromElement(element),
        mode: 'menu',
      });
    }
    function handleContextMenu(event: MouseEvent) {
      openMenu(event);
    }
    function handleClick(event: MouseEvent) {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('[data-feedback-control="true"]')) return;
      setContextTarget(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextTarget(null);
    }
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!contextTarget || !comment.trim()) return;
    const now = nowIso();
    onSubmit({
      id: makeId('feedback'),
      schemaVersion: 1,
      authorId: author.authorId,
      authorName: author.authorName.trim() || 'Anonymous',
      comment: comment.trim(),
      status: 'open',
      priority,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      createdAt: now,
      updatedAt: now,
      target: contextTarget.target,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      runtime: feedbackRuntimeSnapshot({ page, scenarioId, session }),
    });
    setContextTarget(null);
    setComment('');
    setTags('');
    setPriority('normal');
  }

  function addReference(kind: 'object' | 'selection') {
    if (!contextTarget) return;
    const reference = kind === 'object' && contextTarget.objectReference
      ? contextTarget.objectReference
      : referenceForFeedbackTarget(contextTarget.target, contextTarget.selectedText, kind);
    onReference(reference);
    setContextTarget(null);
    setComment('');
    setTags('');
    setPriority('normal');
  }

  function openComment() {
    setContextTarget((current) => current
      ? {
        ...current,
        x: Math.min(current.x, window.innerWidth - 380),
        y: Math.min(current.y, window.innerHeight - 250),
        mode: 'comment',
      }
      : current);
  }

  return (
    <div className="feedback-layer" data-feedback-control="true" aria-live="polite">
      {contextTarget?.mode === 'menu' ? (
        <div
          className="feedback-context-menu"
          style={{ left: `${contextTarget.x}px`, top: `${contextTarget.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={openComment}>添加评论</button>
          <button type="button" onClick={() => addReference('object')}>引用对象到对话</button>
          <button type="button" onClick={() => addReference('selection')} disabled={!contextTarget.selectedText}>引用选中内容</button>
        </div>
      ) : null}
      {contextTarget?.mode === 'comment' ? (
          <form
            className="feedback-popover"
            style={{ left: `${contextTarget.x}px`, top: `${contextTarget.y}px` }}
            onSubmit={submit}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="feedback-popover-head">
              <strong>添加评论</strong>
              <button type="button" className="feedback-close" onClick={() => setContextTarget(null)}>关闭</button>
            </div>
            <div className="feedback-target-summary">
              <span>selector</span>
              <code>{contextTarget.target.selector}</code>
              <span>position</span>
              <code>{Math.round(contextTarget.target.rect.x)}, {Math.round(contextTarget.target.rect.y)} · {Math.round(contextTarget.target.rect.width)}x{Math.round(contextTarget.target.rect.height)}</code>
            </div>
            <label className="feedback-field wide">
              <span>评论内容</span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} autoFocus placeholder="写下你希望这里如何改..." />
            </label>
            <div className="feedback-grid">
              <label className="feedback-field">
                <span>用户</span>
                <input
                  value={author.authorName}
                  onChange={(event) => onAuthorChange({ ...author, authorName: event.target.value })}
                />
              </label>
              <label className="feedback-field">
                <span>优先级</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value as FeedbackPriority)}>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                  <option value="low">low</option>
                </select>
              </label>
              <label className="feedback-field wide">
                <span>标签（逗号分隔）</span>
                <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="upload, history, ui" />
              </label>
            </div>
            <div className="feedback-actions">
              <ActionButton icon={Check} disabled={!comment.trim()}>保存反馈</ActionButton>
            </div>
          </form>
      ) : null}
    </div>
  );
}

function FeedbackInboxPage({
  comments,
  requests,
  onStatusChange,
  onDelete,
  onCreateRequest,
}: {
  comments: FeedbackCommentRecord[];
  requests: NonNullable<BioAgentWorkspaceState['feedbackRequests']>;
  onStatusChange: (ids: string[], status: FeedbackCommentStatus) => void;
  onDelete: (ids: string[]) => void;
  onCreateRequest: (ids: string[], title: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<FeedbackCommentStatus | 'all'>('all');
  const visibleComments = comments
    .filter((comment) => statusFilter === 'all' || comment.status === statusFilter)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const selectedComments = comments.filter((comment) => selectedIds.includes(comment.id));
  const bundle = feedbackBundle(selectedComments.length ? selectedComments : visibleComments, requests);
  const visibleIds = visibleComments.map((item) => item.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.includes(id)).length;

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
        <button type="button" onClick={() => setSelectedIds(visibleIds)} disabled={!visibleIds.length || visibleSelectedCount === visibleIds.length}>选择当前列表</button>
        <button type="button" onClick={() => setSelectedIds([])}>清除选择</button>
        <button type="button" onClick={() => onStatusChange(selectedIds, 'triaged')} disabled={!selectedIds.length}>标记 triaged</button>
        <button type="button" onClick={() => onStatusChange(selectedIds, 'fixed')} disabled={!selectedIds.length}>标记 fixed</button>
        <button type="button" className="danger" onClick={() => deleteSelected(selectedIds)} disabled={!selectedIds.length}>删除选中</button>
        <button type="button" className="danger" onClick={() => deleteSelected(visibleIds)} disabled={!visibleIds.length}>删除当前列表</button>
        <button type="button" onClick={() => onCreateRequest(selectedIds, requestTitleFromFeedback(selectedComments))} disabled={!selectedIds.length}>生成 Request</button>
        <button type="button" onClick={() => exportJsonFile(`bioagent-feedback-${nowIso().slice(0, 10)}.json`, bundle)}>导出 Bundle</button>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(bundle, null, 2))}>复制 Bundle</button>
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
                <div className="feedback-card-head">
                  <strong>{item.comment}</strong>
                  <Badge variant={feedbackStatusVariant(item.status)}>{item.status}</Badge>
                  <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'warning' : 'muted'}>{item.priority}</Badge>
                </div>
                <p>{item.authorName} · {formatSessionTime(item.createdAt)} · {item.runtime.page} · {item.runtime.scenarioId}</p>
                <div className="feedback-target-summary compact">
                  <span>target</span>
                  <code>{item.target.selector}</code>
                  <span>runtime</span>
                  <code>{item.runtime.sessionId ?? 'no-session'} / {item.runtime.activeRunId ?? 'no-run'}</code>
                </div>
                {item.tags.length ? <div className="feedback-tags">{item.tags.map((tag) => <code key={tag}>{tag}</code>)}</div> : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function feedbackRuntimeSnapshot({
  page,
  scenarioId,
  session,
}: {
  page: PageId;
  scenarioId: ScenarioInstanceId;
  session: BioAgentSession;
}): FeedbackRuntimeSnapshot {
  const activeRun = session.runs.at(-1);
  return {
    page,
    url: window.location.href,
    scenarioId,
    sessionId: session.sessionId,
    activeRunId: activeRun?.id,
    sessionTitle: session.title,
    messageCount: session.messages.length,
    artifactSummary: session.artifacts.slice(0, 12).map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      title: typeof artifact.metadata?.title === 'string' ? artifact.metadata.title : undefined,
    })),
    executionSummary: session.executionUnits.slice(0, 12).map((unit) => ({
      id: unit.id,
      tool: unit.tool,
      status: unit.status,
    })),
    uiManifest: session.uiManifest.map((slot) => slot.componentId),
    appVersion: APP_BUILD_ID,
  };
}

function feedbackTargetSnapshot(element: Element): FeedbackTargetSnapshot {
  const rect = element.getBoundingClientRect();
  const htmlElement = element as HTMLElement;
  return {
    selector: cssSelectorForElement(element),
    path: elementPath(element),
    text: compactFeedbackText(htmlElement.innerText || element.textContent || ''),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || undefined,
    ariaLabel: element.getAttribute('aria-label') || htmlElement.title || undefined,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

function currentSelectedText() {
  const text = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 2400 ? `${text.slice(0, 2400)}...` : text;
}

function bioAgentReferenceFromElement(element: Element): BioAgentReference | undefined {
  const referenceElement = element.closest<HTMLElement>('[data-bioagent-reference]');
  const raw = referenceElement?.dataset.bioagentReference;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<BioAgentReference>;
    if (!parsed.id || !parsed.kind || !parsed.title || !parsed.ref) return undefined;
    return parsed as BioAgentReference;
  } catch {
    return undefined;
  }
}

function referenceForFeedbackTarget(target: FeedbackTargetSnapshot, selectedText: string, mode: 'object' | 'selection'): BioAgentReference {
  const sourceRef = `ui:${target.selector}`;
  if (mode === 'selection' && selectedText) {
    const textHash = feedbackHash(`${sourceRef}:${selectedText}`);
    return {
      id: `ref-context-text-${textHash}`,
      kind: 'ui',
      title: `选中内容 · ${selectedText.slice(0, 28)}`,
      ref: `ui-text:${sourceRef}#${textHash}`,
      summary: selectedText,
      locator: {
        textRange: selectedText.slice(0, 160),
        region: sourceRef,
      },
      payload: {
        selectedText,
        sourceTitle: target.text || target.ariaLabel || target.tagName,
        sourceRef,
        sourceKind: 'ui',
        composerMarkerHint: 'selection',
      },
    };
  }
  return {
    id: `ref-context-ui-${feedbackHash(sourceRef)}`,
    kind: 'ui',
    title: target.text || target.ariaLabel || `${target.tagName} 对象`,
    ref: sourceRef,
    summary: target.text || target.ariaLabel || target.path,
    payload: {
      tagName: target.tagName,
      ariaLabel: target.ariaLabel,
      selector: target.selector,
      path: target.path,
      textPreview: target.text,
      composerMarkerHint: 'object',
    },
  };
}

function feedbackHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cssSelectorForElement(element: Element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const classNames = Array.from(current.classList).filter((name) => !/^active|selected|hover/.test(name)).slice(0, 2);
    if (classNames.length) part += classNames.map((name) => `.${CSS.escape(name)}`).join('');
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children) as Element[];
      const sameTagSiblings = siblings.filter((child) => child.tagName === current?.tagName);
      if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(' > ');
}

function elementPath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function compactFeedbackText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function feedbackBundle(comments: FeedbackCommentRecord[], requests: NonNullable<BioAgentWorkspaceState['feedbackRequests']>) {
  return {
    schemaVersion: 1,
    exportedAt: nowIso(),
    appVersion: APP_BUILD_ID,
    comments,
    requests: requests.filter((request) => request.feedbackIds.some((id) => comments.some((comment) => comment.id === id))),
    githubIssueHint: 'Use comments as source-of-truth; GitHub Issue should summarize and link this bundle instead of replacing it.',
  };
}

function requestTitleFromFeedback(comments: FeedbackCommentRecord[]) {
  const first = comments[0]?.comment.trim();
  return first ? first.slice(0, 48) : 'BioAgent feedback request';
}

function feedbackStatusVariant(status: FeedbackCommentStatus): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'fixed') return 'success';
  if (status === 'planned' || status === 'triaged') return 'info';
  if (status === 'needs-discussion') return 'warning';
  if (status === 'wont-fix') return 'danger';
  return 'muted';
}

function scenarioLabelForInstance(scenarioId: ScenarioInstanceId) {
  return scenarios.find((item) => item.id === scenarioId)?.name ?? String(scenarioId);
}

export function BioAgentApp() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [scenarioId, setScenarioId] = useState<ScenarioInstanceId>('literature-evidence-review');
  const [config, setConfig] = useState<BioAgentConfig>(() => loadBioAgentConfig());
  const [configFileHydrated, setConfigFileHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceState, setWorkspaceState] = useState<BioAgentWorkspaceState>(() => {
    const state = loadWorkspaceState();
    const loadedConfig = loadBioAgentConfig();
    return { ...state, workspacePath: normalizeWorkspaceRootPath(loadedConfig.workspacePath || state.workspacePath) };
  });
  const [workspaceStatus, setWorkspaceStatus] = useState('');
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [handoffAutoRun, setHandoffAutoRun] = useState<HandoffAutoRunRequest | undefined>();
  const [workbenchWorkspaceFileEditor, setWorkbenchWorkspaceFileEditor] = useState<{ file: WorkspaceFileContent; draft: string } | null>(null);
  const [feedbackAuthor, setFeedbackAuthor] = useState(() => loadFeedbackAuthor());
  const [configSaveState, setConfigSaveState] = useState<ConfigSaveState>({ status: 'idle' });
  const [externalReferenceRequest, setExternalReferenceRequest] = useState<{ id: string; scenarioId: ScenarioInstanceId; reference: BioAgentReference } | undefined>();
  const [scenarioOverrides, setScenarioOverrides] = useState<Partial<Record<ScenarioInstanceId, ScenarioRuntimeOverride>>>({});
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
    }, {} as Record<ScenarioInstanceId, BioAgentSession[]>);
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
    loadFileBackedBioAgentConfig(config)
      .then((fileConfig) => {
        if (cancelled) return;
        if (fileConfig) {
          setConfig((current) => {
            const currentHasModel = hasUsableModelConfig(current);
            const fileHasModel = hasUsableModelConfig(fileConfig);
            const next = currentHasModel && !fileHasModel
              ? updateConfig(fileConfig, {
                modelProvider: current.modelProvider,
                modelBaseUrl: current.modelBaseUrl,
                modelName: current.modelName,
                apiKey: current.apiKey,
              })
              : fileConfig;
            saveBioAgentConfig(next);
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

  async function hydrateWorkspaceSnapshot(path: string, runtimeConfig: BioAgentConfig, mode: 'prefer-newer' | 'force' = 'prefer-newer') {
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
            saveBioAgentConfig(next);
            return next;
          });
        }
        setWorkspaceStatus(`已从 ${restoredPath || '最近工作区'}/.bioagent 恢复工作区`);
      } else {
        setWorkspaceStatus(requestedPath ? `未找到 ${requestedPath}/.bioagent/workspace-state.json` : '未找到最近工作区快照');
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
            saveBioAgentConfig(next);
            return next;
          });
          setWorkspaceStatus(`已从 ${restoredPath}/.bioagent 恢复工作区`);
        } else {
          setWorkspaceStatus(workspacePath ? `未找到 ${workspacePath}/.bioagent/workspace-state.json` : '未找到最近工作区快照');
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
        .then(() => setWorkspaceStatus(`已同步到 ${workspaceState.workspacePath}/.bioagent`))
        .catch((err) => setWorkspaceStatus(`Workspace writer 未连接：${err instanceof Error ? err.message : String(err)}`));
    }
  }, [workspaceState, config, workspaceHydrated]);

  useEffect(() => {
    if (!configFileHydrated) return;
    saveBioAgentConfig(config);
    setConfigSaveState({ status: 'saving' });
    saveFileBackedBioAgentConfig(config)
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

  function updateWorkspace(mutator: (state: BioAgentWorkspaceState) => BioAgentWorkspaceState) {
    setWorkspaceState((current) => ({
      ...mutator(current),
      updatedAt: nowIso(),
    }));
  }

  function updateSession(nextSession: BioAgentSession, reason = 'session update') {
    updateWorkspace((current) => ({
      ...current,
      sessionsByScenario: {
        ...current.sessionsByScenario,
        [nextSession.scenarioId]: versionSession(nextSession, reason),
      },
      timelineEvents: mergeRunTimelineEvents(current.timelineEvents ?? [], current.sessionsByScenario[nextSession.scenarioId], nextSession),
    }));
  }

  function appendTimelineEvent(event: TimelineEventRecord) {
    updateWorkspace((current) => ({
      ...current,
      timelineEvents: [event, ...(current.timelineEvents ?? [])].slice(0, 200),
    }));
  }

  function addFeedbackComment(comment: FeedbackCommentRecord) {
    updateWorkspace((current) => ({
      ...current,
      feedbackComments: [comment, ...(current.feedbackComments ?? [])].slice(0, 500),
    }));
  }

  function addContextReference(reference: BioAgentReference) {
    const requestId = makeId('context-ref');
    setExternalReferenceRequest({ id: requestId, scenarioId, reference });
    setPage('workbench');
  }

  function updateFeedbackStatus(ids: string[], status: FeedbackCommentStatus) {
    if (!ids.length) return;
    const selected = new Set(ids);
    updateWorkspace((current) => ({
      ...current,
      feedbackComments: (current.feedbackComments ?? []).map((comment) => selected.has(comment.id)
        ? { ...comment, status, updatedAt: nowIso() }
        : comment),
    }));
  }

  function deleteFeedbackComments(ids: string[]) {
    if (!ids.length) return;
    const selected = new Set(ids);
    updateWorkspace((current) => ({
      ...current,
      feedbackComments: (current.feedbackComments ?? []).filter((comment) => !selected.has(comment.id)),
      feedbackRequests: (current.feedbackRequests ?? []).map((request) => ({
        ...request,
        feedbackIds: request.feedbackIds.filter((id) => !selected.has(id)),
      })),
    }));
  }

  function createFeedbackRequest(ids: string[], title: string) {
    if (!ids.length) return;
    const now = nowIso();
    const requestId = makeId('request');
    updateWorkspace((current) => {
      const request: NonNullable<BioAgentWorkspaceState['feedbackRequests']>[number] = {
        id: requestId,
        schemaVersion: 1,
        title,
        status: 'draft',
        feedbackIds: ids,
        summary: `Codex change request from ${ids.length} feedback comments.`,
        acceptanceCriteria: ids.map((id) => {
          const comment = current.feedbackComments?.find((item) => item.id === id);
          return comment ? comment.comment : id;
        }).slice(0, 12),
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...current,
        feedbackRequests: [request, ...(current.feedbackRequests ?? [])].slice(0, 80),
        feedbackComments: (current.feedbackComments ?? []).map((comment) => ids.includes(comment.id)
          ? { ...comment, status: comment.status === 'open' ? 'triaged' : comment.status, requestId, updatedAt: now }
          : comment),
      };
    });
  }

  function setWorkspacePath(value: string) {
    const workspacePath = normalizeWorkspaceRootPath(value);
    const nextConfig = updateConfig(config, { workspacePath });
    setConfig(nextConfig);
    saveBioAgentConfig(nextConfig);
    updateWorkspace((current) => ({ ...current, workspacePath }));
    void hydrateWorkspaceSnapshot(workspacePath, nextConfig, 'force');
  }

  function updateRuntimeConfig(patch: Partial<BioAgentConfig>) {
    setConfig((current) => {
      const next = updateConfig(current, patch);
      saveBioAgentConfig(next);
      if ('workspacePath' in patch) {
        updateWorkspace((state) => ({ ...state, workspacePath: next.workspacePath }));
        void hydrateWorkspaceSnapshot(next.workspacePath, next, 'force');
      }
      return next;
    });
  }

  function saveRuntimeConfigNow() {
    const next = updateConfig(config, {});
    saveBioAgentConfig(next);
    setConfigSaveState({ status: 'saving' });
    saveFileBackedBioAgentConfig(next)
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
    setMessageScrollTops((current) => ({ ...current, [nextScenarioId]: value }));
  }

  function applyScenarioOverride(nextScenarioId: ScenarioInstanceId, override: ScenarioRuntimeOverride) {
    setScenarioOverrides((current) => ({ ...current, [nextScenarioId]: override }));
  }

  function activeSessionFor(state: BioAgentWorkspaceState, nextScenarioId: ScenarioInstanceId) {
    return state.sessionsByScenario[nextScenarioId] ?? createSession(nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`);
  }

  function newChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => {
      const currentSession = versionSession(activeSessionFor(current, nextScenarioId), 'new chat archived previous session');
      return {
        ...current,
        archivedSessions: [currentSession, ...current.archivedSessions].slice(0, 80),
        sessionsByScenario: {
          ...current.sessionsByScenario,
          [nextScenarioId]: createSession(nextScenarioId, `${scenarioLabelForInstance(nextScenarioId)} 新聊天`),
        },
      };
    });
  }

  function deleteChat(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => {
      const deleted = versionSession(activeSessionFor(current, nextScenarioId), 'deleted current chat');
      return {
        ...current,
        archivedSessions: [{ ...deleted, title: `${deleted.title}（已删除）` }, ...current.archivedSessions].slice(0, 80),
        sessionsByScenario: {
          ...current.sessionsByScenario,
          [nextScenarioId]: resetSession(nextScenarioId),
        },
      };
    });
  }

  function restoreArchivedSession(nextScenarioId: ScenarioInstanceId, sessionId: string) {
    updateWorkspace((current) => {
      const restored = current.archivedSessions.find((session) => session.scenarioId === nextScenarioId && session.sessionId === sessionId);
      if (!restored) return current;
      const active = activeSessionFor(current, nextScenarioId);
      const nextArchived = current.archivedSessions.filter((session) => session.sessionId !== sessionId);
      const archivedActive = sessionActivityScore(active) > 0
        ? [versionSession(active, `restored archived session ${sessionId}`), ...nextArchived]
        : nextArchived;
      return {
        ...current,
        archivedSessions: archivedActive.slice(0, 80),
        sessionsByScenario: {
          ...current.sessionsByScenario,
          [nextScenarioId]: {
            ...restored,
            updatedAt: nowIso(),
          },
        },
      };
    });
  }

  function deleteArchivedSessions(nextScenarioId: ScenarioInstanceId, sessionIds: string[]) {
    if (!sessionIds.length) return;
    const selected = new Set(sessionIds);
    updateWorkspace((current) => ({
      ...current,
      archivedSessions: current.archivedSessions.filter((session) => session.scenarioId !== nextScenarioId || !selected.has(session.sessionId)),
    }));
  }

  function clearArchivedSessions(nextScenarioId: ScenarioInstanceId) {
    updateWorkspace((current) => ({
      ...current,
      archivedSessions: current.archivedSessions.filter((session) => session.scenarioId !== nextScenarioId),
    }));
  }

  function editMessage(nextScenarioId: ScenarioInstanceId, messageId: string, content: string) {
    const session = workspaceState.sessionsByScenario[nextScenarioId] ?? createSession(nextScenarioId);
    const nextSession: BioAgentSession = {
      ...session,
      messages: session.messages.map((message) => message.id === messageId ? { ...message, content, updatedAt: nowIso() } as BioAgentMessage : message),
      updatedAt: nowIso(),
    };
    updateSession(nextSession, `edit message ${messageId}`);
  }

  function deleteMessage(nextScenarioId: ScenarioInstanceId, messageId: string) {
    const session = workspaceState.sessionsByScenario[nextScenarioId] ?? createSession(nextScenarioId);
    const nextSession: BioAgentSession = {
      ...session,
      messages: session.messages.filter((message) => message.id !== messageId),
      updatedAt: nowIso(),
    };
    updateSession(nextSession, `delete message ${messageId}`);
  }

  function markReusableRun(nextScenarioId: ScenarioInstanceId, runId: string) {
    updateWorkspace((current) => {
      const session = current.sessionsByScenario[nextScenarioId];
      const run = session?.runs.find((item) => item.id === runId);
      if (!run) return current;
      const candidate: ReusableTaskCandidateRecord = {
        id: `reusable.${run.scenarioPackageRef?.id ?? nextScenarioId}.${run.id}`,
        runId: run.id,
        scenarioId: nextScenarioId,
        scenarioPackageRef: run.scenarioPackageRef,
        skillPlanRef: run.skillPlanRef,
        uiPlanRef: run.uiPlanRef,
        prompt: run.prompt,
        status: run.status,
        promotionState: 'candidate',
        createdAt: nowIso(),
      };
      const existing = current.reusableTaskCandidates ?? [];
      return {
        ...current,
        reusableTaskCandidates: [candidate, ...existing.filter((item) => item.id !== candidate.id)].slice(0, 80),
        timelineEvents: [({
          id: makeId('timeline'),
          actor: 'BioAgent Library',
          action: 'package.reusable-candidate',
          subject: `${candidate.scenarioPackageRef?.id ?? nextScenarioId}:${run.id}`,
          artifactRefs: [],
          executionUnitRefs: [run.id, run.skillPlanRef, run.uiPlanRef].filter((value): value is string => Boolean(value)),
          beliefRefs: [],
          branchId: nextScenarioId,
          visibility: 'project-record',
          decisionStatus: 'not-a-decision',
          createdAt: candidate.createdAt,
        } satisfies TimelineEventRecord), ...(current.timelineEvents ?? [])].slice(0, 200),
      };
    });
  }

  function handleSearch(query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return;
    const matchedScenario = scenarios.find((scenario) =>
      normalized.includes(scenario.id)
      || normalized.includes(scenario.name.toLowerCase())
      || normalized.includes(scenario.domain.toLowerCase())
      || scenario.tools.some((tool) => normalized.includes(tool.toLowerCase())),
    );
    if (matchedScenario) {
      setScenarioId(matchedScenario.id);
      setPage('workbench');
      return;
    }
    if (normalized.includes('timeline') || normalized.includes('时间线') || normalized.includes('notebook')) {
      setPage('timeline');
      return;
    }
    if (normalized.includes('align') || normalized.includes('对齐')) {
      setPage('alignment');
      return;
    }
    setPage('workbench');
  }

  function handleArtifactHandoff(targetScenario: ScenarioId, artifact: RuntimeArtifact) {
    const sourceScenario = scenarios.find((item) => item.id === artifact.producerScenario);
    const target = scenarios.find((item) => item.id === targetScenario);
    const now = nowIso();
    const autoRunPrompt = handoffAutoRunPrompt(targetScenario, artifact, sourceScenario?.name ?? artifact.producerScenario, target?.name ?? targetScenario);
    const handoffMessage: BioAgentMessage = {
      id: makeId('handoff'),
      role: 'user',
      content: [
        `请基于来自${sourceScenario?.name ?? artifact.producerScenario}的 artifact 继续分析。`,
        `artifact id: ${artifact.id}`,
        `artifact type: ${artifact.type}`,
        `目标：按${target?.name ?? targetScenario}的 input contract 生成下一步 claims、ExecutionUnit 和 UIManifest。`,
      ].join('\n'),
      createdAt: now,
      status: 'completed',
    };
    setWorkspaceState((current) => {
      const targetSession = current.sessionsByScenario[targetScenario];
      const artifacts = targetSession.artifacts.some((item) => item.id === artifact.id)
        ? targetSession.artifacts
        : [artifact, ...targetSession.artifacts].slice(0, 24);
      const nextTargetSession = versionSession({
        ...targetSession,
        messages: [...targetSession.messages, handoffMessage],
        artifacts,
        notebook: [{
          id: makeId('note'),
          time: new Date(now).toLocaleString('zh-CN', { hour12: false }),
          scenario: targetScenario,
          title: `接收 ${artifact.type}`,
          desc: `来自 ${sourceScenario?.name ?? artifact.producerScenario} 的 ${artifact.id} 已进入当前 Scenario 上下文。`,
          claimType: 'fact' as const,
          confidence: 1,
          artifactRefs: [artifact.id],
          updateReason: 'artifact handoff',
        }, ...targetSession.notebook].slice(0, 24),
        updatedAt: now,
      }, `handoff artifact ${artifact.id}`);
      return {
        ...current,
        timelineEvents: [({
          id: makeId('timeline'),
          actor: 'BioAgent Handoff',
          action: 'artifact.handoff',
          subject: `${artifact.producerScenario}:${artifact.id} -> ${targetScenario}`,
          artifactRefs: [artifact.id],
          executionUnitRefs: [],
          beliefRefs: [],
          branchId: targetScenario,
          visibility: 'project-record',
          decisionStatus: 'not-a-decision',
          createdAt: now,
        } satisfies TimelineEventRecord), ...(current.timelineEvents ?? [])].slice(0, 200),
        sessionsByScenario: {
          ...current.sessionsByScenario,
          [targetScenario]: nextTargetSession,
        },
        updatedAt: now,
      };
    });
    setScenarioId(targetScenario);
    setPage('workbench');
    setHandoffAutoRun({
      id: makeId('handoff-run'),
      targetScenario,
      prompt: autoRunPrompt,
    });
  }

  function consumeHandoffAutoRun(requestId: string) {
    setHandoffAutoRun((current) => current?.id === requestId ? undefined : current);
  }

  function saveAlignmentContract(data: AlignmentContractData, reason: string, confirmationStatus: AlignmentContractRecord['confirmationStatus'] = 'needs-data') {
    const now = nowIso();
    const checksum = checksumText(JSON.stringify(data));
    const id = makeId('alignment-contract');
    const contract: AlignmentContractRecord = {
      id,
      type: 'alignment-contract',
      schemaVersion: '1',
      title: `Alignment contract ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
      createdAt: now,
      updatedAt: now,
      reason,
      checksum,
      sourceRefs: ['alignment-workspace:user-input', 'alignment-workspace:ai-draft'],
      assumptionRefs: ['assumption:data-quality-review-required', 'assumption:researcher-final-authority'],
      decisionAuthority: 'researcher',
      confirmationStatus,
      confirmedBy: confirmationStatus === 'user-confirmed' ? 'researcher' : undefined,
      confirmedAt: confirmationStatus === 'user-confirmed' ? now : undefined,
      sourceContractVersion: id,
      data,
    };
    updateWorkspace((current) => ({
      ...current,
      alignmentContracts: [contract, ...(current.alignmentContracts ?? [])].slice(0, 40),
    }));
  }

  const activeScenarioOverride = scenarioOverrides[scenarioId];
  const activeBuiltInScenarioId = builtInScenarioIdForInstance(scenarioId, activeScenarioOverride);
  const activeSession = sessions[scenarioId] ?? createSession(scenarioId, `${scenarioLabelForInstance(scenarioId)} 新聊天`);
  const appHealthItems = useRuntimeHealth(config, Object.keys(sessions).length);

  return (
    <div className="app-shell">
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
        <TopBar onSearch={handleSearch} onSettingsOpen={() => setSettingsOpen(true)} healthItems={appHealthItems} />
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
              workspaceFileEditor={workbenchWorkspaceFileEditor}
              onWorkspaceFileEditorChange={setWorkbenchWorkspaceFileEditor}
              externalReferenceRequest={externalReferenceRequest?.scenarioId === scenarioId ? externalReferenceRequest : undefined}
              onExternalReferenceConsumed={(requestId) => {
                setExternalReferenceRequest((current) => current?.id === requestId ? undefined : current);
              }}
            />
          ) : page === 'alignment' ? (
            <AlignmentPage contracts={workspaceState.alignmentContracts ?? []} onSaveContract={saveAlignmentContract} />
          ) : page === 'timeline' ? (
            <TimelinePage alignmentContracts={workspaceState.alignmentContracts ?? []} events={workspaceState.timelineEvents ?? []} onOpenScenario={(id) => {
              setScenarioId(id);
              setPage('workbench');
            }} />
          ) : (
            <FeedbackInboxPage
              comments={workspaceState.feedbackComments ?? []}
              requests={workspaceState.feedbackRequests ?? []}
              onStatusChange={updateFeedbackStatus}
              onDelete={deleteFeedbackComments}
              onCreateRequest={createFeedbackRequest}
            />
          )}
        </div>
      </div>
      <FeedbackCaptureLayer
        page={page}
        scenarioId={scenarioId}
        session={activeSession}
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
