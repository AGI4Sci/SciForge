import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Database,
  Download,
  Eye,
  File,
  FileCode,
  FilePlus,
  FileText,
  FileUp,
  Folder,
  FolderPlus,
  Home,
  Lock,
  MessageSquare,
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
} from './data';
import { SCENARIO_SPECS, SCENARIO_PRESETS, componentManifest } from './scenarioSpecs';
import { compileScenarioDraft, scenarioIdBySkillDomain, type ScenarioBuilderDraft } from './scenarioCompiler/scenarioDraftCompiler';
import { compileScenarioIRFromSelection, recommendScenarioElements, type ScenarioElementSelection } from './scenarioCompiler/scenarioElementCompiler';
import { elementRegistry } from './scenarioCompiler/elementRegistry';
import { runScenarioRuntimeSmoke } from './scenarioCompiler/runtimeSmoke';
import { buildScenarioQualityReport } from './scenarioCompiler/scenarioQualityGate';
import { buildBuiltInScenarioPackage, builtInScenarioPackageRef, type ScenarioPackage } from './scenarioCompiler/scenarioPackage';
import type { ScenarioLibraryItem } from './scenarioCompiler/scenarioLibrary';
import { compileSlotsForScenario } from './scenarioCompiler/uiPlanCompiler';
import { scpMarkdownSkills } from './scpSkillCatalog';
import { timeline } from './demoData';
import { sendAgentMessageStream } from './api/agentClient';
import { sendBioAgentToolMessage } from './api/bioagentToolsClient';
import { buildExecutionBundle, evaluateExecutionBundleExport } from './exportPolicy';
import { modelHealth, type RuntimeHealthItem, type RuntimeHealthStatus } from './runtimeHealth';
import {
  makeId,
  nowIso,
  type AlignmentContractRecord,
  type BioAgentMessage,
  type BioAgentRun,
  type BioAgentSession,
  type BioAgentWorkspaceState,
  type BioAgentConfig,
  type AgentStreamEvent,
  type EvidenceClaim,
  type NotebookRecord,
  type NormalizedAgentResponse,
  type RuntimeArtifact,
  type RuntimeExecutionUnit,
  type ScenarioInstanceId,
  type ScenarioRuntimeOverride,
  type TimelineEventRecord,
  type UIManifestSlot,
  type ReusableTaskCandidateRecord,
} from './domain';
import type { VolcanoPoint } from './charts';
import { createSession, loadWorkspaceState, resetSession, saveWorkspaceState, sessionActivityScore, shouldUsePersistedWorkspaceState, versionSession } from './sessionStore';
import { loadBioAgentConfig, normalizeWorkspaceRootPath, saveBioAgentConfig, updateConfig } from './config';
import {
  acceptSkillPromotionProposal,
  archiveSkillPromotionProposal,
  archiveWorkspaceScenario,
  listSkillPromotionProposals,
  listWorkspace,
  loadFileBackedBioAgentConfig,
  loadPersistedWorkspaceState,
  loadScenarioLibrary,
  loadWorkspaceScenario,
  mutateWorkspaceFile,
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
} from './api/workspaceClient';
import { HeatmapViewer, MoleculeViewer, NetworkGraph, UmapViewer } from './visualizations';

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

const ActivityAreaChart = lazy(async () => ({ default: (await import('./charts')).ActivityAreaChart }));
const VolcanoChart = lazy(async () => ({ default: (await import('./charts')).VolcanoChart }));
const CapabilityRadarChart = lazy(async () => ({ default: (await import('./charts')).CapabilityRadarChart }));

const officialScenarioPackages = scenarios.map((scenario) => ({
  scenario,
  package: buildBuiltInScenarioPackage(scenario.id, '2026-04-25T00:00:00.000Z'),
}));

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

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

function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <section className={cx('card', onClick && 'clickable', className)} onClick={onClick}>
      {children}
    </section>
  );
}

function Badge({
  children,
  variant = 'info',
  glow = false,
}: {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';
  glow?: boolean;
}) {
  return <span className={cx('badge', `badge-${variant}`, glow && 'badge-glow')}>{children}</span>;
}

function IconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button className="icon-button" onClick={onClick} title={label} aria-label={label} data-tooltip={label}>
      <Icon size={17} />
    </button>
  );
}

function titleFromPrompt(prompt: string) {
  const title = prompt.trim().replace(/\s+/g, ' ').slice(0, 36);
  return title || '新聊天';
}

function ActionButton({
  icon: Icon,
  children,
  variant = 'primary',
  onClick,
  disabled = false,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'coral';
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={cx('action-button', `action-${variant}`)} onClick={onClick} disabled={disabled}>
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

function ChartLoadingFallback({ label }: { label: string }) {
  return (
    <div className="empty-runtime-state compact chart-loading-state">
      <Badge variant="muted">loading</Badge>
      <strong>{label}</strong>
    </div>
  );
}

function useRuntimeHealth(config: BioAgentConfig, libraryCount?: number) {
  const [items, setItems] = useState<RuntimeHealthItem[]>(() => buildInitialHealth(config, libraryCount));

  useEffect(() => {
    let cancelled = false;
    setItems(buildInitialHealth(config, libraryCount));
    async function check() {
      const [workspaceOnline, agentOnline] = await Promise.all([
        probeUrl(`${config.workspaceWriterBaseUrl.replace(/\/+$/, '')}/health`),
        probeUrl(`${config.agentServerBaseUrl.replace(/\/+$/, '')}/health`),
      ]);
      if (cancelled) return;
      setItems([
        { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
        workspaceOnline
          ? { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: config.workspaceWriterBaseUrl }
          : { id: 'workspace', label: 'Workspace Writer', status: 'offline', detail: config.workspaceWriterBaseUrl, recoverAction: '启动 npm run workspace:server 后刷新' },
        agentOnline
          ? { id: 'agentserver', label: 'AgentServer', status: 'online', detail: config.agentServerBaseUrl }
          : { id: 'agentserver', label: 'AgentServer', status: 'optional', detail: config.agentServerBaseUrl, recoverAction: '需要通用生成/修复时启动 AgentServer；seed skill 可离线运行' },
        modelHealth(config),
        {
          id: 'library',
          label: 'Scenario Library',
          status: libraryCount && libraryCount > 0 ? 'online' : 'optional',
          detail: libraryCount && libraryCount > 0 ? `${libraryCount} packages in workspace` : '可先导入官方 package 或编译新场景',
        },
      ]);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [
    config.agentServerBaseUrl,
    config.workspaceWriterBaseUrl,
    config.modelProvider,
    config.modelBaseUrl,
    config.modelName,
    config.apiKey,
    libraryCount,
  ]);

  return items;
}

function hasUsableModelConfig(config: BioAgentConfig) {
  const provider = config.modelProvider.trim() || 'native';
  if (provider === 'native') {
    return Boolean(config.modelName.trim() || config.modelBaseUrl.trim() || config.apiKey.trim());
  }
  return Boolean(config.modelBaseUrl.trim() && config.apiKey.trim());
}

function buildInitialHealth(config: BioAgentConfig, libraryCount?: number): RuntimeHealthItem[] {
  return [
    { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
    { id: 'workspace', label: 'Workspace Writer', status: 'checking', detail: config.workspaceWriterBaseUrl },
    { id: 'agentserver', label: 'AgentServer', status: 'checking', detail: config.agentServerBaseUrl },
    modelHealth(config),
    {
      id: 'library',
      label: 'Scenario Library',
      status: libraryCount && libraryCount > 0 ? 'online' : 'optional',
      detail: libraryCount && libraryCount > 0 ? `${libraryCount} packages in workspace` : '可先导入官方 package 或编译新场景',
    },
  ];
}

async function probeUrl(url: string) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1600);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function healthBadgeVariant(status: RuntimeHealthStatus): 'success' | 'info' | 'warning' | 'danger' | 'muted' {
  if (status === 'online') return 'success';
  if (status === 'checking') return 'info';
  if (status === 'optional') return 'warning';
  if (status === 'not-configured') return 'warning';
  return 'danger';
}

function healthLabel(status: RuntimeHealthStatus) {
  if (status === 'online') return 'online';
  if (status === 'checking') return 'checking';
  if (status === 'optional') return 'optional';
  if (status === 'not-configured') return 'setup';
  return 'offline';
}

function RuntimeHealthPanel({ items, compact = false }: { items: RuntimeHealthItem[]; compact?: boolean }) {
  const blocking = items.filter((item) => item.status === 'offline' || item.status === 'not-configured');
  return (
    <div className={cx('runtime-health-panel', compact && 'compact')}>
      <div className="runtime-health-head">
        <strong>Runtime Health</strong>
        <Badge variant={blocking.length ? 'warning' : 'success'}>{blocking.length ? `${blocking.length} actions` : 'ready'}</Badge>
      </div>
      <div className="runtime-health-grid">
        {items.map((item) => (
          <div className="runtime-health-item" key={item.id}>
            <Badge variant={healthBadgeVariant(item.status)}>{healthLabel(item.status)}</Badge>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              {item.recoverAction ? <em>{item.recoverAction}</em> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="section-title-wrap">
        {Icon ? (
          <div className="section-icon">
            <Icon size={18} />
          </div>
        ) : null}
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <button key={tab.id} className={cx('tab', active === tab.id && 'active')} onClick={() => onChange(tab.id)} title={tab.label} data-tooltip={tab.label}>
          {tab.icon ? <tab.icon size={14} /> : null}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function EvidenceTag({ level }: { level: EvidenceLevel }) {
  const labels: Record<EvidenceLevel, string> = {
    meta: 'Meta分析',
    rct: 'RCT/临床',
    cohort: '队列研究',
    case: '案例报告',
    experimental: '实验验证',
    review: '综述',
    database: '数据库',
    preprint: '预印本',
    prediction: '计算预测',
  };
  const variant: Record<EvidenceLevel, 'success' | 'info' | 'warning' | 'coral' | 'muted'> = {
    meta: 'success',
    rct: 'info',
    cohort: 'warning',
    case: 'coral',
    experimental: 'success',
    review: 'info',
    database: 'muted',
    preprint: 'warning',
    prediction: 'muted',
  };
  return <Badge variant={variant[level]}>{labels[level]}</Badge>;
}

function ClaimTag({ type }: { type: ClaimType }) {
  const labels: Record<ClaimType, string> = { fact: '事实', inference: '推断', hypothesis: '假设' };
  const variant: Record<ClaimType, 'success' | 'warning' | 'coral'> = {
    fact: 'success',
    inference: 'warning',
    hypothesis: 'coral',
  };
  return <Badge variant={variant[type]}>{labels[type]}</Badge>;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? '#00E5A0' : pct >= 75 ? '#FFD54F' : '#FF7043';
  return (
    <div className="confidence">
      <div className="confidence-track">
        <div className="confidence-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color }}>{pct}%</span>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function findArtifact(session: BioAgentSession, ref?: string): RuntimeArtifact | undefined {
  if (!ref) return undefined;
  return session.artifacts.find((artifact) => artifact.id === ref
    || artifact.dataRef === ref
    || artifact.type === ref
    || Object.values(artifact.metadata ?? {}).some((value) => value === ref));
}

function exportJsonFile(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  exportBlob(name, blob);
}

function parseScenarioPackageJson(value: unknown): ScenarioPackage {
  if (!isRecord(value)) throw new Error('Package JSON 必须是对象。');
  if (value.schemaVersion !== '1') throw new Error('只支持 schemaVersion=1 的 Scenario Package。');
  if (!asString(value.id)) throw new Error('Package 缺少 id。');
  if (!asString(value.version)) throw new Error('Package 缺少 version。');
  if (!['draft', 'validated', 'published', 'archived'].includes(String(value.status))) throw new Error('Package status 无效。');
  if (!isRecord(value.scenario)) throw new Error('Package 缺少 scenario。');
  if (!asString(value.scenario.id)) throw new Error('scenario.id 缺失。');
  if (!asString(value.scenario.title)) throw new Error('scenario.title 缺失。');
  if (!asString(value.scenario.skillDomain)) throw new Error('scenario.skillDomain 缺失。');
  if (!isRecord(value.skillPlan)) throw new Error('Package 缺少 skillPlan。');
  if (!isRecord(value.uiPlan)) throw new Error('Package 缺少 uiPlan。');
  if (!Array.isArray(value.tests)) throw new Error('Package tests 必须是数组。');
  if (!Array.isArray(value.versions)) throw new Error('Package versions 必须是数组。');
  return value as unknown as ScenarioPackage;
}

function renameScenarioPackageForImport(pkg: ScenarioPackage, nextId: string): ScenarioPackage {
  return {
    ...pkg,
    id: nextId,
    status: pkg.status === 'archived' ? 'draft' : pkg.status,
    scenario: {
      ...pkg.scenario,
      id: nextId,
      title: pkg.scenario.title.endsWith(' copy') ? pkg.scenario.title : `${pkg.scenario.title} copy`,
      source: 'workspace',
    },
    versions: [{
      version: pkg.version,
      status: 'draft',
      createdAt: nowIso(),
      summary: `Imported as ${nextId} to avoid package id conflict.`,
      scenarioHash: `import-${nextId}`,
    }, ...pkg.versions],
  };
}

function filterScenarioLibraryItems<T extends ScenarioLibraryItem>(
  items: T[],
  options: { query: string; status: string; source: string; domain: string; sort: string },
) {
  const query = options.query.trim().toLowerCase();
  return [...items]
    .filter((item) => {
      if (options.status !== 'all' && item.status !== options.status) return false;
      if (options.source !== 'all' && item.source !== options.source) return false;
      if (options.domain !== 'all' && item.skillDomain !== options.domain) return false;
      if (!query) return true;
      return [item.id, item.title, item.description, item.version, item.status, item.source, item.skillDomain]
        .some((value) => value.toLowerCase().includes(query));
    })
    .sort((left, right) => {
      if (options.sort === 'title') return left.title.localeCompare(right.title);
      if (options.sort === 'status') return `${left.status}-${left.title}`.localeCompare(`${right.status}-${right.title}`);
      return Date.parse(right.versions[0]?.createdAt ?? '') - Date.parse(left.versions[0]?.createdAt ?? '');
    });
}

type DashboardLibraryItem = ScenarioLibraryItem & {
  builtInScenarioId?: ScenarioId;
  icon?: LucideIcon;
  color?: string;
  imported?: boolean;
  package?: ScenarioPackage;
};

function scenarioPackageToLibraryDisplayItem(
  pkg: ScenarioPackage,
  options: {
    source?: ScenarioLibraryItem['source'];
    builtInScenarioId?: ScenarioId;
    icon?: LucideIcon;
    color?: string;
    imported?: boolean;
    package?: ScenarioPackage;
  } = {},
): DashboardLibraryItem {
  return {
    id: pkg.id,
    title: pkg.scenario.title,
    description: pkg.scenario.description,
    version: pkg.version,
    status: pkg.status,
    skillDomain: pkg.scenario.skillDomain,
    source: options.source ?? (pkg.status === 'archived' ? 'archived' : pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace'),
    packageRef: {
      id: pkg.id,
      version: pkg.version,
      source: pkg.scenario.source === 'built-in' ? 'built-in' : 'workspace',
    },
    validationReport: pkg.validationReport,
    qualityReport: pkg.qualityReport,
    versions: pkg.versions,
    builtInScenarioId: options.builtInScenarioId,
    icon: options.icon,
    color: options.color,
    imported: options.imported,
    package: options.package,
  };
}

function exportTextFile(name: string, content: string, contentType = 'text/plain') {
  exportBlob(name, new Blob([content], { type: `${contentType};charset=utf-8` }));
}

function exportBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function artifactMeta(artifact?: RuntimeArtifact) {
  if (!artifact) return 'empty';
  return `${artifact.type} · ${artifact.schemaVersion}`;
}

function artifactSource(artifact?: RuntimeArtifact): 'project-tool' | 'record-only' | 'empty' {
  if (!artifact) return 'empty';
  const mode = asString(artifact.metadata?.mode);
  const runner = asString(artifact.metadata?.runner);
  if (mode?.includes('record')) return 'record-only';
  if (runner?.includes('local-csv') || artifact.dataRef?.includes('.bioagent/omics/')) return 'project-tool';
  return 'project-tool';
}

function sourceVariant(source: ReturnType<typeof artifactSource>): 'success' | 'muted' | 'warning' {
  if (source === 'project-tool') return 'success';
  if (source === 'record-only') return 'warning';
  return 'muted';
}

function executionUnitForArtifact(session: BioAgentSession, artifact?: RuntimeArtifact): RuntimeExecutionUnit | undefined {
  if (!artifact) return undefined;
  return session.executionUnits.find((unit) => {
    const refs = [...(unit.artifacts ?? []), ...(unit.outputArtifacts ?? [])];
    const metadataRefs = Object.values(artifact.metadata ?? {}).filter((value): value is string => typeof value === 'string');
    const outputRef = asString(unit.outputRef);
    return refs.includes(artifact.id)
      || refs.includes(artifact.type)
      || (artifact.dataRef ? refs.includes(artifact.dataRef) : false)
      || Boolean(outputRef && metadataRefs.some((ref) => ref === outputRef || ref.startsWith(`${outputRef.replace(/\/+$/, '')}/`)));
  });
}

function slotPayload(slot: UIManifestSlot, artifact?: RuntimeArtifact): Record<string, unknown> {
  if (isRecord(artifact?.data)) return artifact.data;
  return slot.props ?? {};
}

function viewCompositionSummary(slot: UIManifestSlot) {
  const encoding = slot.encoding ?? {};
  const parts = [
    encoding.colorBy ? `colorBy=${encoding.colorBy}` : undefined,
    encoding.splitBy ? `splitBy=${encoding.splitBy}` : undefined,
    encoding.overlayBy ? `overlayBy=${encoding.overlayBy}` : undefined,
    encoding.facetBy ? `facetBy=${encoding.facetBy}` : undefined,
    encoding.syncViewport ? 'syncViewport=true' : undefined,
    slot.layout?.mode ? `layout=${slot.layout.mode}` : undefined,
    slot.compare?.mode ? `compare=${slot.compare.mode}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

function applyViewTransforms(rows: Record<string, unknown>[], slot: UIManifestSlot) {
  return (slot.transform ?? []).reduce((current, transform) => {
    if (transform.type === 'filter' && transform.field) {
      return current.filter((row) => compareValue(row[transform.field ?? ''], transform.op ?? '==', transform.value));
    }
    if (transform.type === 'sort' && transform.field) {
      return [...current].sort((left, right) => String(left[transform.field ?? ''] ?? '').localeCompare(String(right[transform.field ?? ''] ?? '')));
    }
    if (transform.type === 'limit') {
      const limit = typeof transform.value === 'number' ? transform.value : Number(transform.value);
      return Number.isFinite(limit) && limit >= 0 ? current.slice(0, limit) : current;
    }
    return current;
  }, rows);
}

function compareValue(left: unknown, op: string, right: unknown) {
  const leftNumber = typeof left === 'number' ? left : typeof left === 'string' ? Number(left) : Number.NaN;
  const rightNumber = typeof right === 'number' ? right : typeof right === 'string' ? Number(right) : Number.NaN;
  if (op === '<=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber <= rightNumber;
  if (op === '>=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber >= rightNumber;
  if (op === '<' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber < rightNumber;
  if (op === '>' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber > rightNumber;
  if (op === '!=' || op === '!==') return String(left ?? '') !== String(right ?? '');
  return String(left ?? '') === String(right ?? '');
}

function arrayPayload(slot: UIManifestSlot, key: string, artifact?: RuntimeArtifact): Record<string, unknown>[] {
  const payload = artifact?.data ?? slot.props?.[key] ?? slot.props;
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload[key])) return payload[key].filter(isRecord);
  return [];
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function edgeSourcesLabel(value: unknown): string | undefined {
  const sources = asStringList(value);
  if (sources.length) return sources.join(', ');
  const recordSources = toRecordList(value)
    .map((source) => asString(source.id) || asString(source.name) || asString(source.type))
    .filter(Boolean);
  if (recordSources.length) return recordSources.slice(0, 3).join(', ');
  if (isRecord(value)) {
    return [value.database, value.source, value.id].map(asString).filter(Boolean).join(', ') || undefined;
  }
  return asString(value);
}

function asNumberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : [];
}

function asNumberMatrix(value: unknown): number[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const matrix = value.map(asNumberList).filter((row) => row.length > 0);
  return matrix.length ? matrix : undefined;
}

function pickEvidenceLevel(value: unknown): EvidenceLevel {
  const levels: EvidenceLevel[] = ['meta', 'rct', 'cohort', 'case', 'experimental', 'review', 'database', 'preprint', 'prediction'];
  return levels.includes(value as EvidenceLevel) ? value as EvidenceLevel : 'prediction';
}

function compactParams(params: string) {
  return params.length > 128 ? `${params.slice(0, 125)}...` : params;
}

function exportExecutionBundle(session: BioAgentSession) {
  const decision = evaluateExecutionBundleExport(session);
  if (!decision.allowed) {
    window.alert(`导出被 artifact policy 阻止：${decision.blockedArtifactIds.join(', ')}`);
    return;
  }
  exportJsonFile(`execution-units-${session.scenarioId}-${session.sessionId}.json`, buildExecutionBundle(session, decision));
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

function Sidebar({
  page,
  setPage,
  scenarioId,
  setScenarioId,
  config,
  workspaceStatus,
  onWorkspacePathChange,
}: {
  page: PageId;
  setPage: (page: PageId) => void;
  scenarioId: ScenarioInstanceId;
  setScenarioId: (id: ScenarioId) => void;
  config: BioAgentConfig;
  workspaceStatus: string;
  onWorkspacePathChange: (value: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activePanel, setActivePanel] = useState<'navigation' | 'workspace' | 'extensions'>('navigation');
  const [sidebarWidth, setSidebarWidth] = useState(284);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [selectedEntryPath, setSelectedEntryPath] = useState('');
  const [currentWorkspacePath, setCurrentWorkspacePath] = useState(config.workspacePath);
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
    if (activePanel !== 'workspace' || collapsed) return;
    void refreshWorkspace();
  }, [activePanel, collapsed, currentWorkspacePath, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    setCurrentWorkspacePath(config.workspacePath);
    setPreviewFile(null);
    setPreviewDraft('');
    setPreviewDirty(false);
  }, [config.workspacePath]);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  async function refreshWorkspace() {
    try {
      setWorkspaceError('');
      const entries = await listWorkspace(currentWorkspacePath || config.workspacePath, config);
      setWorkspaceEntries(entries);
      setWorkspaceNotice(entries.length ? `已加载 ${entries.length} 个资源` : '当前目录为空；可新建文件夹或打开 .bioagent 分组。');
    } catch (err) {
      setWorkspaceEntries([]);
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function openWorkspaceFolder(path: string) {
    setCurrentWorkspacePath(path);
    setSelectedEntryPath(path);
    setPreviewFile(null);
    setPreviewDraft('');
    setPreviewDirty(false);
  }

  async function openWorkspaceEntry(entry: WorkspaceEntry) {
    setSelectedEntryPath(entry.path);
    if (entry.kind === 'folder') {
      openWorkspaceFolder(entry.path);
      return;
    }
    try {
      setWorkspaceError('');
      const file = await readWorkspaceFile(entry.path, config);
      setPreviewFile(file);
      setPreviewDraft(file.content);
      setPreviewDirty(false);
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
      await refreshWorkspace();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function goWorkspaceParent() {
    const parent = parentPath(currentWorkspacePath);
    if (parent && parent !== currentWorkspacePath) openWorkspaceFolder(parent);
  }

  function goWorkspaceRoot() {
    openWorkspaceFolder(config.workspacePath);
  }

  async function runWorkspaceAction(action: 'create-file' | 'create-folder' | 'rename' | 'delete', entry?: WorkspaceEntry) {
    const basePath = entry?.kind === 'folder' ? entry.path : currentWorkspacePath || config.workspacePath;
    const selectedPath = entry?.path || currentWorkspacePath || config.workspacePath;
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
      if (previewFile && (previewFile.path === targetPath || previewFile.path === selectedPath)) {
        setPreviewFile(null);
        setPreviewDraft('');
        setPreviewDirty(false);
      }
      await refreshWorkspace();
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
      await refreshWorkspace();
      setWorkspaceNotice('BioAgent workspace 已创建；可以导入 package 或运行场景。');
    } catch (err) {
      setWorkspaceError(workspaceOnboardingError(err));
      setWorkspaceNotice('');
    }
  }

  return (
    <aside className={cx('sidebar', collapsed && 'collapsed')} style={{ width: collapsed ? 46 : sidebarWidth }}>
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
          title="工作目录"
          aria-label="工作目录"
        >
          <FileText size={18} />
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
          <div className="sidebar-panel-header">
            <span>
              {activePanel === 'navigation' ? '导航' : activePanel === 'workspace' ? '资源管理器' : '拓展'}
            </span>
            <button className="panel-collapse-button" onClick={() => setCollapsed(true)} title="收起侧栏" aria-label="收起侧栏">
              <ChevronLeft size={16} />
            </button>
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
              <div className="sidebar-tree">
                <div className="sidebar-label">当前工作目录</div>
                <input
                  className="workspace-path-editor"
                  value={currentWorkspacePath}
                  onChange={(event) => setCurrentWorkspacePath(event.target.value)}
                  onBlur={() => void refreshWorkspace()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void refreshWorkspace();
                  }}
                  title={workspaceStatus || 'BioAgent workspace path'}
                />
                <div className="workspace-toolbar">
                  <button onClick={() => onWorkspacePathChange(currentWorkspacePath)} title="将当前路径设为工作区根目录" aria-label="将当前路径设为工作区根目录"><Check size={14} /></button>
                  <button onClick={goWorkspaceRoot} title="回到工作区根目录" aria-label="回到工作区根目录"><Home size={14} /></button>
                  <button onClick={goWorkspaceParent} title="返回上一级目录" aria-label="返回上一级目录"><ArrowUp size={14} /></button>
                  <button onClick={() => void runWorkspaceAction('create-file')} title="新建文件" aria-label="新建文件"><FilePlus size={14} /></button>
                  <button onClick={() => void runWorkspaceAction('create-folder')} title="新建文件夹" aria-label="新建文件夹"><FolderPlus size={14} /></button>
                  <button onClick={() => void refreshWorkspace()} title="刷新" aria-label="刷新"><RefreshCw size={14} /></button>
                </div>
                <div className="workspace-breadcrumbs" aria-label="当前目录层级">
                  {workspaceBreadcrumbs(currentWorkspacePath, config.workspacePath).map((crumb) => (
                    <button key={crumb.path} type="button" onClick={() => openWorkspaceFolder(crumb.path)} title={crumb.path}>
                      {crumb.label}
                    </button>
                  ))}
                </div>
                {workspaceNeedsOnboarding(config.workspacePath, workspaceError, workspaceStatus) ? (
                  <div className="workspace-onboarding">
                    <strong>{config.workspacePath.trim() ? '初始化 BioAgent workspace' : '设置 workspace path'}</strong>
                    <p>{workspaceOnboardingReason(config.workspacePath, workspaceError, workspaceStatus)}</p>
                    <button type="button" onClick={() => void initializeWorkspacePath()}>
                      创建 .bioagent 工作区
                    </button>
                  </div>
                ) : null}
                {workspaceNotice ? <p className="workspace-status" role="status">{workspaceNotice}</p> : null}
                {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
                <div className="workspace-bioagent-group" aria-label=".bioagent 专用分组">
                  <div className="workspace-group-head">
                    <Database size={14} />
                    <span>.bioagent resources</span>
                  </div>
                  {bioagentWorkspaceResources(config.workspacePath).map((resource) => (
                    <button
                      key={resource.key}
                      className="workspace-resource-chip"
                      onClick={() => openWorkspaceFolder(resource.path)}
                      title={resource.path}
                    >
                      <Folder size={13} />
                      <span>{resource.label}</span>
                    </button>
                  ))}
                </div>
                {workspaceEntries.map((entry) => (
                  <button
                    key={entry.path}
                    className={cx('tree-item', selectedEntryPath === entry.path && 'active')}
                    onClick={() => void openWorkspaceEntry(entry)}
                    onDoubleClick={() => entry.kind === 'folder' && openWorkspaceFolder(entry.path)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedEntryPath(entry.path);
                      setContextMenu({ x: event.clientX, y: event.clientY, entry });
                    }}
                    title={entry.path}
                  >
                    {entry.kind === 'folder' ? <Folder size={14} /> : <File size={14} />}
                    <span>{entry.name}</span>
                    {entry.kind === 'file' && typeof entry.size === 'number' ? <small>{formatBytes(entry.size)}</small> : null}
                  </button>
                ))}
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
                  <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
                    {contextMenu.entry?.kind === 'folder' ? <button onClick={() => openWorkspaceFolder(contextMenu.entry?.path || currentWorkspacePath)}>打开文件夹</button> : null}
                    {contextMenu.entry?.kind === 'file' ? <button onClick={() => contextMenu.entry && void openWorkspaceEntry(contextMenu.entry)}>打开/预览</button> : null}
                    <button onClick={() => void runWorkspaceAction('create-file', contextMenu.entry)}>新建文件</button>
                    <button onClick={() => void runWorkspaceAction('create-folder', contextMenu.entry)}>新建文件夹</button>
                    {contextMenu.entry ? <button onClick={() => void runWorkspaceAction('rename', contextMenu.entry)}>重命名</button> : null}
                    {contextMenu.entry ? <button onClick={() => void navigator.clipboard?.writeText(contextMenu.entry?.path || '')}>复制路径</button> : null}
                    {contextMenu.entry ? <button className="danger" onClick={() => void runWorkspaceAction('delete', contextMenu.entry)}>删除</button> : null}
                  </div>
                ) : null}
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
                  <p className="extension-note">Markdown skill 是可读、可安装、可沉淀的任务知识；seed skill 带可执行入口。</p>
                  <div className="extension-subhead">
                    <span>Seed executable skills</span>
                    <code>{executableSeedSkills.length}</code>
                  </div>
                  {executableSeedSkills.map((skill) => (
                    <div key={skill} className="extension-row compact" title={`skills/seed/${skill}/skill.json`}>
                      <span className="extension-icon"><FileCode size={13} /></span>
                      <span className="extension-copy">
                        <strong>{skill}</strong>
                        <small>skills/seed executable manifest</small>
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

function bioagentWorkspaceResources(workspacePath: string) {
  const root = `${workspacePath.replace(/\/+$/, '')}/.bioagent`;
  return [
    { key: 'tasks', label: 'tasks', path: `${root}/tasks` },
    { key: 'logs', label: 'logs', path: `${root}/logs` },
    { key: 'task-results', label: 'task-results', path: `${root}/task-results` },
    { key: 'scenarios', label: 'scenarios', path: `${root}/scenarios` },
    { key: 'exports', label: 'exports', path: `${root}/exports` },
    { key: 'artifacts', label: 'artifacts', path: `${root}/artifacts` },
  ];
}

function parentPath(path: string) {
  const clean = path.replace(/\/+$/, '');
  if (!clean || clean === '/') return clean || '/';
  const index = clean.lastIndexOf('/');
  return index <= 0 ? '/' : clean.slice(0, index);
}

function workspaceBreadcrumbs(path: string, workspaceRoot: string) {
  const cleanPath = path.replace(/\/+$/, '') || workspaceRoot.replace(/\/+$/, '');
  const cleanRoot = workspaceRoot.replace(/\/+$/, '');
  const crumbs: Array<{ label: string; path: string }> = [];
  if (cleanRoot && cleanPath.startsWith(cleanRoot)) {
    crumbs.push({ label: 'workspace', path: cleanRoot });
    const rest = cleanPath.slice(cleanRoot.length).replace(/^\/+/, '');
    let cursor = cleanRoot;
    for (const part of rest.split('/').filter(Boolean)) {
      cursor = `${cursor}/${part}`;
      crumbs.push({ label: part, path: cursor });
    }
    return crumbs;
  }
  let cursor = '';
  for (const part of cleanPath.split('/').filter(Boolean).slice(-4)) {
    cursor = cursor ? `${cursor}/${part}` : cleanPath.startsWith('/') ? `/${part}` : part;
    crumbs.push({ label: part, path: cursor });
  }
  return crumbs.length ? crumbs : [{ label: cleanPath || '/', path: cleanPath || '/' }];
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
  onClose,
}: {
  config: BioAgentConfig;
  onChange: (patch: Partial<BioAgentConfig>) => void;
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
        </div>
        <div className="settings-save-state" role="status">
          <span className="status-dot online" />
          <span>
            已自动保存到 config.local.json。下一次 AgentServer 请求会使用当前模型：
            {' '}
            <strong>{config.modelProvider || 'native'}</strong>
            {config.modelName.trim() ? <code>{config.modelName.trim()}</code> : <em>user model not set</em>}
          </span>
          <ActionButton icon={RefreshCw} variant="secondary" onClick={() => window.location.reload()}>重新检测连接</ActionButton>
        </div>
      </section>
    </div>
  );
}

function PackageExportPreviewDialog({
  pkg,
  workspacePath,
  onClose,
  onConfirm,
}: {
  pkg: ScenarioPackage;
  workspacePath: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const preview = packageManifestPreview(pkg, workspacePath);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-dialog package-export-dialog" role="dialog" aria-modal="true" aria-label="Package export preview" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <div>
            <h2>导出 package manifest preview</h2>
            <p>{pkg.id}@{pkg.version} · {pkg.status}</p>
          </div>
          <IconButton icon={ChevronDown} label="关闭导出预览" onClick={onClose} />
        </div>
        <div className="package-export-summary">
          <Badge variant={preview.hasSensitiveRefs ? 'warning' : 'success'}>
            {preview.hasSensitiveRefs ? 'contains workspace refs' : 'portable manifest'}
          </Badge>
          <span>{preview.slotCount} UI slots</span>
          <span>{preview.skillCount} skills</span>
          <span>{preview.testCount} tests</span>
          <span>{preview.versionCount} versions</span>
        </div>
        <div className="handoff-field-grid">
          <span><em>scenario</em><code>{pkg.scenario.title}</code></span>
          <span><em>domain</em><code>{pkg.scenario.skillDomain}</code></span>
          <span><em>quality</em><code>{preview.qualityLabel}</code></span>
          <span><em>export file</em><code>{pkg.id}-{pkg.version}.scenario-package.json</code></span>
        </div>
        {preview.sensitiveRefs.length ? (
          <div className="export-warning">
            <strong>可能包含本机 workspace 引用</strong>
            <p>导出前确认这些路径是否可以分享；需要公开分发时建议替换为相对路径、dataRef 或受控 artifact refs。</p>
            <div className="inspector-ref-list">
              {preview.sensitiveRefs.slice(0, 5).map((ref) => <code key={ref}>{ref}</code>)}
            </div>
          </div>
        ) : null}
        <pre className="inspector-json">{JSON.stringify(preview.manifest, null, 2)}</pre>
        <div className="scenario-builder-actions">
          <ActionButton icon={ChevronLeft} variant="secondary" onClick={onClose}>取消</ActionButton>
          <ActionButton icon={Download} onClick={onConfirm}>确认导出</ActionButton>
        </div>
      </section>
    </div>
  );
}

function packageManifestPreview(pkg: ScenarioPackage, workspacePath: string) {
  const json = JSON.stringify(pkg, null, 2);
  const sensitiveRefs = extractSensitiveWorkspaceRefs(json, workspacePath);
  const qualityOk = pkg.qualityReport?.ok ?? pkg.validationReport?.ok ?? true;
  return {
    hasSensitiveRefs: sensitiveRefs.length > 0,
    sensitiveRefs,
    slotCount: pkg.uiPlan.slots.length,
    skillCount: pkg.skillPlan.skillIRs.length,
    testCount: pkg.tests.length,
    versionCount: pkg.versions.length || 1,
    qualityLabel: qualityOk ? 'quality pass' : 'quality warnings',
    manifest: {
      schemaVersion: pkg.schemaVersion,
      id: pkg.id,
      version: pkg.version,
      status: pkg.status,
      scenario: {
        id: pkg.scenario.id,
        title: pkg.scenario.title,
        skillDomain: pkg.scenario.skillDomain,
        source: pkg.scenario.source,
      },
      skillPlan: {
        id: pkg.skillPlan.id,
        skills: pkg.skillPlan.skillIRs.map((skill) => skill.skillId),
      },
      uiPlan: {
        id: pkg.uiPlan.id,
        components: pkg.uiPlan.compiledFrom.componentIds,
        artifacts: pkg.uiPlan.compiledFrom.artifactTypes,
      },
      tests: pkg.tests.map((test) => ({ id: test.id, expectedArtifactTypes: test.expectedArtifactTypes })),
      quality: {
        ok: qualityOk,
        issues: pkg.qualityReport?.items.length ?? pkg.validationReport?.issues.length ?? 0,
      },
      versions: pkg.versions.map((version) => ({
        version: version.version,
        status: version.status,
        createdAt: version.createdAt,
        summary: version.summary,
      })),
    },
  };
}

function extractSensitiveWorkspaceRefs(json: string, workspacePath: string) {
  const refs = new Set<string>();
  const normalizedWorkspace = workspacePath.trim();
  if (normalizedWorkspace && json.includes(normalizedWorkspace)) refs.add(normalizedWorkspace);
  const pathPattern = /(?:\/Users\/|\/Applications\/workspace\/|[A-Za-z]:\\)[^"',\s)]+/g;
  for (const match of json.matchAll(pathPattern)) {
    refs.add(match[0]);
  }
  return Array.from(refs).slice(0, 12);
}

function Dashboard({
  setPage,
  setScenarioId,
  config,
  workspaceState,
  onApplyScenarioDraft,
  onWorkbenchPrompt,
}: {
  setPage: (page: PageId) => void;
  setScenarioId: (id: ScenarioInstanceId) => void;
  config: BioAgentConfig;
  workspaceState: BioAgentWorkspaceState;
  onApplyScenarioDraft: (scenarioId: ScenarioInstanceId, draft: ScenarioRuntimeOverride) => void;
  onWorkbenchPrompt: (scenarioId: ScenarioInstanceId, prompt: string) => void;
}) {
  const [scenarioPrompt, setScenarioPrompt] = useState('我想比较KRAS G12D突变相关文献证据，并在需要时联动蛋白结构和知识图谱。');
  const [scenarioDraft, setScenarioDraft] = useState<ScenarioBuilderDraft>(() => compileScenarioDraft('我想比较KRAS G12D突变相关文献证据，并在需要时联动蛋白结构和知识图谱。'));
  const draftArtifactTypes = scenarioDraft.recommendedArtifactTypes ?? [];
  const draftSkillIds = scenarioDraft.recommendedSkillIds ?? [];
  const [libraryItems, setLibraryItems] = useState<ScenarioLibraryItem[]>([]);
  const [libraryStatus, setLibraryStatus] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryStatusFilter, setLibraryStatusFilter] = useState('all');
  const [librarySourceFilter, setLibrarySourceFilter] = useState('all');
  const [libraryDomainFilter, setLibraryDomainFilter] = useState('all');
  const [librarySort, setLibrarySort] = useState('recent');
  const [exportPreviewPackage, setExportPreviewPackage] = useState<ScenarioPackage | undefined>();
  const [expandedLibraryItemId, setExpandedLibraryItemId] = useState<string | undefined>();
  const [libraryDetailPackages, setLibraryDetailPackages] = useState<Record<string, ScenarioPackage>>({});
  const [skillProposals, setSkillProposals] = useState<SkillPromotionProposalRecord[]>([]);
  const [skillProposalStatus, setSkillProposalStatus] = useState('');
  const [skillProposalValidations, setSkillProposalValidations] = useState<Record<string, SkillPromotionValidationResult>>({});
  const packageImportInputRef = useRef<HTMLInputElement>(null);
  const importedPackageIds = useMemo(() => new Set(libraryItems.map((item) => item.id)), [libraryItems]);
  const officialLibraryItems = useMemo<DashboardLibraryItem[]>(() => officialScenarioPackages.map(({ scenario, package: pkg }) => scenarioPackageToLibraryDisplayItem(pkg, {
    source: 'built-in',
    builtInScenarioId: scenario.id,
    icon: scenario.icon,
    color: scenario.color,
    imported: importedPackageIds.has(pkg.id),
    package: pkg,
  })), [importedPackageIds]);
  const workspaceLibraryItems = useMemo<DashboardLibraryItem[]>(() => libraryItems.map((item) => ({
    ...item,
    imported: true,
  })), [libraryItems]);
  const combinedLibraryItems = useMemo<DashboardLibraryItem[]>(() => {
    const workspaceIds = new Set(workspaceLibraryItems.map((item) => item.id));
    return [
      ...workspaceLibraryItems,
      ...officialLibraryItems.filter((item) => !workspaceIds.has(item.id)),
    ];
  }, [officialLibraryItems, workspaceLibraryItems]);
  const filteredCombinedLibraryItems = useMemo(() => filterScenarioLibraryItems(combinedLibraryItems, {
    query: libraryQuery,
    status: libraryStatusFilter,
    source: librarySourceFilter,
    domain: libraryDomainFilter,
    sort: librarySort,
  }), [combinedLibraryItems, libraryQuery, libraryStatusFilter, librarySourceFilter, libraryDomainFilter, librarySort]);
  const healthItems = useRuntimeHealth(config, libraryItems.length);
  const packageRunStatsById = useMemo(() => buildPackageRunStats(workspaceState), [workspaceState]);
  useEffect(() => {
    let cancelled = false;
    if (!config.workspacePath.trim()) {
      setLibraryItems([]);
      return;
    }
    refreshScenarioLibrary()
      .catch((error) => {
        if (!cancelled) setLibraryStatus(error instanceof Error ? error.message : String(error));
      });
    refreshSkillProposals()
      .catch((error) => {
        if (!cancelled) setSkillProposalStatus(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [config.workspacePath, config.workspaceWriterBaseUrl]);

  async function refreshScenarioLibrary() {
    const library = await loadScenarioLibrary(config);
    setLibraryItems(library?.items ?? []);
  }

  async function refreshSkillProposals() {
    setSkillProposals(await listSkillPromotionProposals(config));
  }

  async function acceptSkillProposalFromDashboard(id: string, skillId: string) {
    const manifest = await acceptSkillPromotionProposal(config, id);
    setSkillProposalStatus(`已接受 ${id}，安装到 .bioagent/evolved-skills/${manifest.id}。`);
    await refreshSkillProposals();
    const validation = await validateAcceptedSkillPromotionProposal(config, manifest.id || skillId);
    setSkillProposalValidations((current) => ({ ...current, [manifest.id || skillId]: validation }));
    setSkillProposalStatus(validation.passed ? `已接受并通过 validation smoke：${manifest.id || skillId}` : `已接受，但 validation smoke 未通过：${manifest.id || skillId}`);
  }

  async function validateSkillProposalFromDashboard(skillId: string) {
    const validation = await validateAcceptedSkillPromotionProposal(config, skillId);
    setSkillProposalValidations((current) => ({ ...current, [skillId]: validation }));
    setSkillProposalStatus(validation.passed ? `Validation smoke 通过：${skillId}` : `Validation smoke 未通过：${skillId}`);
  }

  async function rejectSkillProposalFromDashboard(id: string) {
    await rejectSkillPromotionProposal(config, id, 'Rejected from BioAgent dashboard review.');
    await refreshSkillProposals();
    setSkillProposalStatus(`已拒绝 ${id}，不会进入 evolved skills。`);
  }

  async function archiveSkillProposalFromDashboard(id: string) {
    await archiveSkillPromotionProposal(config, id, 'Archived from BioAgent dashboard review.');
    await refreshSkillProposals();
    setSkillProposalStatus(`已归档 ${id}。`);
  }

  function openScenarioPackage(pkg: ScenarioPackage) {
    onApplyScenarioDraft(pkg.id, scenarioPackageToOverride(pkg));
    setScenarioId(pkg.id);
    setPage('workbench');
  }

  async function openWorkspaceScenario(id: string) {
    try {
      const pkg = await loadWorkspaceScenario(config, id);
      if (!pkg) {
        setLibraryStatus(`打开失败：workspace 中找不到 package ${id}。`);
        return;
      }
      openScenarioPackage(pkg);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? `打开 package 失败：${error.message}` : `打开 package 失败：${String(error)}`);
    }
  }

  async function copyWorkspaceScenario(id: string) {
    const pkg = await loadWorkspaceScenario(config, id);
    if (!pkg) return;
    const copyId = `${pkg.id}-copy-${Date.now().toString(36)}`;
    await saveWorkspaceScenario(config, {
      ...pkg,
      id: copyId,
      version: '1.0.0',
      status: 'draft',
      scenario: {
        ...pkg.scenario,
        id: copyId,
        title: `${pkg.scenario.title} copy`,
      },
    });
    await refreshScenarioLibrary();
    setLibraryStatus('已复制为 draft。');
  }

  async function archiveWorkspaceScenarioFromLibrary(id: string) {
    await archiveWorkspaceScenario(config, id);
    await refreshScenarioLibrary();
    setLibraryStatus('已归档。');
  }

  async function restoreWorkspaceScenarioFromLibrary(id: string) {
    await restoreWorkspaceScenario(config, id, 'draft');
    await refreshScenarioLibrary();
    setLibraryStatus(`已恢复 ${id} 到 Library draft，可重新打开或发布。`);
  }

  async function importScenarioPackageFile(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text()) as unknown;
      let pkg = parseScenarioPackageJson(json);
      if (importedPackageIds.has(pkg.id)) {
        const overwrite = window.confirm(`Scenario Library 已存在 ${pkg.id}。选择“确定”覆盖，选择“取消”则另存为新 id。`);
        if (!overwrite) {
          const nextId = window.prompt('另存为 package id', `${pkg.id}-import-${Date.now().toString(36)}`);
          if (!nextId?.trim()) {
            setLibraryStatus('已取消导入。');
            return;
          }
          pkg = renameScenarioPackageForImport(pkg, nextId.trim());
        }
      }
      await saveWorkspaceScenario(config, pkg);
      await refreshScenarioLibrary();
      setLibraryStatus(`已导入 package ${pkg.scenario.title} (${pkg.id}@${pkg.version})，正在打开工作台。`);
      openScenarioPackage(pkg);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? `导入 package 失败：${error.message}` : `导入 package 失败：${String(error)}`);
    }
  }

  async function exportWorkspacePackage(id: string) {
    const pkg = await loadWorkspaceScenario(config, id);
    if (!pkg) {
      setLibraryStatus(`导出失败：找不到 package ${id}。`);
      return;
    }
    setExportPreviewPackage(pkg);
  }

  async function importOfficialPackage(id: ScenarioId) {
    try {
      const builtInPackage = buildBuiltInScenarioPackage(id);
      const pkg: ScenarioPackage = {
        ...builtInPackage,
        status: 'published',
        scenario: {
          ...builtInPackage.scenario,
          source: 'built-in',
        },
      };
      await saveWorkspaceScenario(config, pkg);
      await refreshScenarioLibrary();
      setLibraryStatus(`已导入 ${pkg.scenario.title}，正在打开工作台。`);
      openScenarioPackage(pkg);
    } catch (error) {
      setLibraryStatus(error instanceof Error ? `导入失败：${error.message}` : `导入失败：${String(error)}`);
    }
  }

  function exportOfficialPackage(id: ScenarioId) {
    const pkg = buildBuiltInScenarioPackage(id);
    setExportPreviewPackage(pkg);
  }

  async function openLibraryItem(item: DashboardLibraryItem) {
    if (item.source === 'built-in' && item.builtInScenarioId && !importedPackageIds.has(item.id)) {
      await importOfficialPackage(item.builtInScenarioId);
      return;
    }
    await openWorkspaceScenario(item.id);
  }

  function exportLibraryItem(item: DashboardLibraryItem) {
    if (item.source === 'built-in' && item.builtInScenarioId && !importedPackageIds.has(item.id)) {
      exportOfficialPackage(item.builtInScenarioId);
      return;
    }
    void exportWorkspacePackage(item.id);
  }

  async function toggleLibraryDetails(item: DashboardLibraryItem) {
    if (expandedLibraryItemId === item.id) {
      setExpandedLibraryItemId(undefined);
      return;
    }
    setExpandedLibraryItemId(item.id);
    if (item.package || libraryDetailPackages[item.id] || (item.source === 'built-in' && !importedPackageIds.has(item.id))) return;
    try {
      const pkg = await loadWorkspaceScenario(config, item.id);
      if (pkg) {
        setLibraryDetailPackages((current) => ({ ...current, [item.id]: pkg }));
      }
    } catch (error) {
      setLibraryStatus(error instanceof Error ? `读取配置失败：${error.message}` : `读取配置失败：${String(error)}`);
    }
  }

  async function saveCompiledDraftAndOpen() {
    try {
      const instanceId = scenarioInstanceIdForDraft(scenarioDraft);
      const pkg = compileScenarioPackageForDraft(instanceId, scenarioDraft);
      await saveWorkspaceScenario(config, pkg);
      await refreshScenarioLibrary();
      onApplyScenarioDraft(instanceId, scenarioPackageToOverride(pkg));
      onWorkbenchPrompt(instanceId, scenarioPrompt.trim() || scenarioDraft.description);
      setScenarioId(instanceId);
      setLibraryStatus(`已保存新场景 ${pkg.scenario.title} 到 Scenario Library。`);
      setPage('workbench');
    } catch (error) {
      setLibraryStatus(error instanceof Error ? `保存编译场景失败：${error.message}` : `保存编译场景失败：${String(error)}`);
    }
  }
  const activityData = [
    { day: 'Mon', papers: 28, eus: 4 },
    { day: 'Tue', papers: 36, eus: 7 },
    { day: 'Wed', papers: 42, eus: 8 },
    { day: 'Thu', papers: 51, eus: 11 },
    { day: 'Fri', papers: 47, eus: 13 },
    { day: 'Sat', papers: 66, eus: 16 },
  ];
  return (
    <main className="page dashboard">
      <div className="page-heading">
        <h1>研究概览</h1>
        <p>场景 markdown 编译为 ScenarioSpec，LLM 只生成结构化 artifact 和 UIManifest，组件库负责专业展示。</p>
      </div>

      <section className="get-started-panel">
        <div>
          <Badge variant="success">Get Started</Badge>
          <h2>从一个稳定研究服务开始</h2>
          <p>导入官方 package、导入本地 package，或描述需求编译新场景。导入后会直接进入对应工作台。</p>
        </div>
        <div className="get-started-actions">
          <ActionButton icon={FilePlus} onClick={() => void importOfficialPackage('literature-evidence-review')}>导入文献场景</ActionButton>
          <ActionButton icon={FileUp} variant="secondary" onClick={() => packageImportInputRef.current?.click()}>导入 package JSON</ActionButton>
          <ActionButton icon={Sparkles} variant="secondary" onClick={() => setScenarioDraft(compileScenarioDraft(scenarioPrompt))}>编译新场景</ActionButton>
        </div>
        <RuntimeHealthPanel items={healthItems} compact />
      </section>
      {exportPreviewPackage ? (
        <PackageExportPreviewDialog
          pkg={exportPreviewPackage}
          workspacePath={config.workspacePath}
          onClose={() => setExportPreviewPackage(undefined)}
          onConfirm={() => {
            exportJsonFile(`${exportPreviewPackage.id}-${exportPreviewPackage.version}.scenario-package.json`, exportPreviewPackage);
            setLibraryStatus(`已导出 ${exportPreviewPackage.scenario.title || exportPreviewPackage.id} package JSON。`);
            setExportPreviewPackage(undefined);
          }}
        />
      ) : null}

      <div className="stats-grid">
        {stats.map((stat) => (
          <Card key={stat.label} className="stat-card">
            <div className="stat-icon" style={{ color: stat.color, background: `${stat.color}18` }}>
              <stat.icon size={18} />
            </div>
            <div>
              <div className="stat-value" style={{ color: stat.color }}>
                {stat.value}
              </div>
              <div className="stat-label">{stat.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <section className="scenario-builder">
        <div className="scenario-builder-copy">
          <Badge variant="info">AI Scenario Builder</Badge>
          <h2>描述你的研究场景，生成可编辑设置</h2>
          <p>从一句自然语言开始，系统会选择 skill domain、推荐组件集合，并生成 Scenario markdown 草案。</p>
        </div>
        <div className="scenario-builder-box">
          <textarea
            value={scenarioPrompt}
            onChange={(event) => setScenarioPrompt(event.target.value)}
            placeholder="例如：帮我构建一个场景，读取单细胞表达矩阵，比较处理组和对照组，并展示火山图、热图和UMAP。"
          />
          <div className="scenario-builder-actions">
            <ActionButton icon={Sparkles} onClick={() => setScenarioDraft(compileScenarioDraft(scenarioPrompt))}>生成场景设置</ActionButton>
            <ActionButton
              icon={Play}
              variant="secondary"
              onClick={() => void saveCompiledDraftAndOpen()}
            >
              进入可运行工作台
            </ActionButton>
          </div>
        </div>
        <div className="scenario-draft-preview">
          <div>
            <span>推荐场景</span>
            <strong>{scenarioDraft.title}</strong>
            <em>{scenarioDraft.summary} · confidence {Math.round(scenarioDraft.confidence * 100)}%</em>
          </div>
          <div className="component-pills">
            {scenarioDraft.defaultComponents.map((component) => <code key={component}>{component}</code>)}
          </div>
          <div className="component-pills">
            {draftArtifactTypes.map((artifactType) => <code key={artifactType}>{artifactType}</code>)}
          </div>
          <div className="component-pills">
            {draftSkillIds.slice(0, 4).map((skillId) => <code key={skillId}>{skillId}</code>)}
          </div>
          <pre>{scenarioDraft.scenarioMarkdown}</pre>
        </div>
      </section>

      <div className="dashboard-grid">
        <Card className="wide">
          <SectionHeader icon={Shield} title="Scenario-first 架构状态" subtitle="所有场景共享同一套 chat / runtime / evidence / component registry" />
          <div className="principles">
            {[
              ['场景即契约', '用户可以用 markdown 描述目标、输入输出、组件集合和诚实边界。'],
              ['配置驱动 UI', '场景差异通过 ScenarioSpec + UIManifest + registry 表达。'],
              ['可复现执行', 'ExecutionUnit 记录代码、参数、环境、数据指纹和产物。'],
              ['组件库优先', 'LLM 选择已注册组件和 View Composition；动态 plugin 默认关闭。'],
            ].map(([title, text]) => (
              <div className="principle" key={title}>
                <Check size={16} />
                <div>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionHeader icon={Target} title="最近活跃度" subtitle="workspace runtime events" />
          <div className="chart-220">
            <Suspense fallback={<ChartLoadingFallback label="加载活跃度图表" />}>
              <ActivityAreaChart data={activityData} />
            </Suspense>
          </div>
        </Card>
      </div>

      <section>
        <SectionHeader
          title="Scenario Library"
          subtitle="所有官方模板、workspace package 和新编译场景统一在这里按需打开、导入或编辑配置"
          action={(
            <div className="scenario-builder-actions">
              <input
                ref={packageImportInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void importScenarioPackageFile(event)}
              />
              <ActionButton icon={FileUp} variant="secondary" onClick={() => packageImportInputRef.current?.click()}>导入 package</ActionButton>
              <ActionButton icon={RefreshCw} variant="ghost" onClick={() => void refreshScenarioLibrary()}>刷新</ActionButton>
            </div>
          )}
        />
        {libraryStatus ? <p className="empty-state">{libraryStatus}</p> : null}
        <div className="library-controls">
          <input
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="搜索 package、描述、版本..."
            aria-label="搜索 Scenario Library"
          />
          <select value={libraryStatusFilter} onChange={(event) => setLibraryStatusFilter(event.target.value)} aria-label="按状态过滤">
            <option value="all">全部状态</option>
            <option value="published">published</option>
            <option value="draft">draft</option>
            <option value="validated">validated</option>
            <option value="archived">archived</option>
          </select>
          <select value={librarySourceFilter} onChange={(event) => setLibrarySourceFilter(event.target.value)} aria-label="按来源过滤">
            <option value="all">全部来源</option>
            <option value="built-in">built-in</option>
            <option value="workspace">workspace</option>
            <option value="archived">archived</option>
          </select>
          <select value={libraryDomainFilter} onChange={(event) => setLibraryDomainFilter(event.target.value)} aria-label="按 skill domain 过滤">
            <option value="all">全部 domain</option>
            <option value="literature">literature</option>
            <option value="structure">structure</option>
            <option value="omics">omics</option>
            <option value="knowledge">knowledge</option>
          </select>
          <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value)} aria-label="排序 Scenario Library">
            <option value="recent">最近版本</option>
            <option value="title">名称</option>
            <option value="status">质量状态</option>
          </select>
        </div>
        <div className="scenario-library-scroll">
          <div className="scenario-grid scenario-library-grid">
            {filteredCombinedLibraryItems.map((item) => {
              const DetailIcon = item.icon;
              const detailPackage = item.package ?? libraryDetailPackages[item.id];
              const isBuiltInAvailable = item.source === 'built-in' && item.builtInScenarioId && !importedPackageIds.has(item.id);
              const isExpanded = expandedLibraryItemId === item.id;
              return (
                <Card key={`${item.id}-${item.version}-${item.source}`} className="scenario-card scenario-library-card">
                  <div className="scenario-card-top">
                    {DetailIcon ? (
                      <div className="scenario-card-icon compact" style={{ color: item.color, background: item.color ? `${item.color}18` : undefined }}>
                        <DetailIcon size={18} />
                      </div>
                    ) : null}
                    <div className="library-card-badges">
                      <Badge variant={item.status === 'published' ? 'success' : item.status === 'archived' ? 'muted' : 'warning'}>{item.status}</Badge>
                      <Badge variant={item.imported ? 'success' : 'muted'}>{item.imported ? 'workspace' : 'built-in'}</Badge>
                    </div>
                    <code>{item.version}</code>
                  </div>
                  <h3 style={item.color ? { color: item.color } : undefined}>{item.title || item.id}</h3>
                  <p>{item.description || item.id}</p>
                  <div className="scenario-note">
                    <code>{item.id}</code>
                    <span>{item.source ?? 'workspace'} · {item.skillDomain}</span>
                  </div>
                  <PackageOperationalMeta
                    versionCount={item.versions.length || 1}
                    versions={item.versions}
                    qualityOk={item.qualityReport?.ok ?? item.validationReport?.ok ?? true}
                    qualityIssueCount={item.qualityReport?.items.length ?? item.validationReport?.issues.length ?? 0}
                    runStats={packageRunStatsById[item.id]}
                  />
                  {isExpanded ? (
                    <div className="scenario-config-panel">
                      <div>
                        <strong>Skills</strong>
                        <div className="tool-chips compact">
                          {(detailPackage?.scenario.selectedSkillIds ?? ['打开后加载配置']).slice(0, 8).map((skillId) => <code key={skillId}>{skillId}</code>)}
                        </div>
                      </div>
                      <div>
                        <strong>UI Components</strong>
                        <div className="tool-chips compact">
                          {(detailPackage?.scenario.selectedComponentIds ?? ['打开后加载配置']).slice(0, 8).map((componentId) => <code key={componentId}>{componentId}</code>)}
                        </div>
                      </div>
                      <ActionButton icon={Settings} variant="secondary" onClick={() => void openLibraryItem(item)}>打开编辑配置</ActionButton>
                    </div>
                  ) : null}
                  <div className="scenario-builder-actions">
                    {item.status === 'archived' && !isBuiltInAvailable ? (
                      <ActionButton icon={RefreshCw} onClick={() => void restoreWorkspaceScenarioFromLibrary(item.id)}>恢复</ActionButton>
                    ) : (
                      <ActionButton icon={isBuiltInAvailable ? FilePlus : Play} onClick={() => void openLibraryItem(item)}>
                        {isBuiltInAvailable ? '导入并打开' : '打开'}
                      </ActionButton>
                    )}
                    <ActionButton icon={Settings} variant="secondary" onClick={() => void toggleLibraryDetails(item)}>{isExpanded ? '收起配置' : '配置'}</ActionButton>
                    {item.imported ? <ActionButton icon={FilePlus} variant="secondary" onClick={() => void copyWorkspaceScenario(item.id)}>复制</ActionButton> : null}
                    <ActionButton icon={Download} variant="secondary" onClick={() => exportLibraryItem(item)}>导出</ActionButton>
                    {item.imported && item.status !== 'archived' ? <ActionButton icon={Trash2} variant="ghost" onClick={() => void archiveWorkspaceScenarioFromLibrary(item.id)}>归档</ActionButton> : null}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
        {!filteredCombinedLibraryItems.length ? <p className="empty-state">没有匹配的 package。可以清空搜索、切换过滤条件，或导入新的 package JSON。</p> : null}
        <SkillProposalPanel
          proposals={skillProposals}
          status={skillProposalStatus}
          validations={skillProposalValidations}
          onRefresh={() => void refreshSkillProposals().catch((error) => setSkillProposalStatus(error instanceof Error ? error.message : String(error)))}
          onAccept={(proposal) => void acceptSkillProposalFromDashboard(proposal.id, proposal.proposedManifest.id).catch((error) => setSkillProposalStatus(error instanceof Error ? error.message : String(error)))}
          onValidate={(proposal) => void validateSkillProposalFromDashboard(proposal.proposedManifest.id).catch((error) => setSkillProposalStatus(error instanceof Error ? error.message : String(error)))}
          onReject={(proposal) => void rejectSkillProposalFromDashboard(proposal.id).catch((error) => setSkillProposalStatus(error instanceof Error ? error.message : String(error)))}
          onArchive={(proposal) => void archiveSkillProposalFromDashboard(proposal.id).catch((error) => setSkillProposalStatus(error instanceof Error ? error.message : String(error)))}
        />
        {workspaceState.reusableTaskCandidates?.length ? (
          <div className="candidate-panel" aria-label="Reusable candidate 候选区">
            <SectionHeader title="Reusable Task Candidates" subtitle="从 Workbench 标记出来、可进入 Element Registry 的 skill/task 候选" />
            <div className="candidate-list">
              {workspaceState.reusableTaskCandidates.slice(0, 6).map((candidate) => (
                <div className="candidate-row" key={candidate.id}>
                  <Badge variant={candidate.status === 'completed' ? 'success' : 'warning'}>{candidate.promotionState}</Badge>
                  <span>
                    <strong>{candidate.scenarioPackageRef?.id ?? candidate.scenarioId}</strong>
                    <small>{candidate.skillPlanRef ?? 'skill-plan unknown'} · run {candidate.runId.replace(/^run-/, '').slice(0, 8)}</small>
                  </span>
                  <code>{candidate.prompt.slice(0, 72)}</code>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function SkillProposalPanel({
  proposals,
  status,
  validations,
  onRefresh,
  onAccept,
  onValidate,
  onReject,
  onArchive,
}: {
  proposals: SkillPromotionProposalRecord[];
  status: string;
  validations: Record<string, SkillPromotionValidationResult>;
  onRefresh: () => void;
  onAccept: (proposal: SkillPromotionProposalRecord) => void;
  onValidate: (proposal: SkillPromotionProposalRecord) => void;
  onReject: (proposal: SkillPromotionProposalRecord) => void;
  onArchive: (proposal: SkillPromotionProposalRecord) => void;
}) {
  const visible = proposals.filter((proposal) => proposal.status !== 'archived').slice(0, 8);
  if (!visible.length && !status) return null;
  return (
    <div className="candidate-panel" aria-label="Skill promotion proposals">
      <SectionHeader title="Skill Proposals" subtitle=".bioagent/skill-proposals → .bioagent/evolved-skills" action={<ActionButton icon={RefreshCw} variant="secondary" onClick={onRefresh}>刷新</ActionButton>} />
      {status ? <p className="scenario-note">{status}</p> : null}
      <div className="candidate-list">
        {visible.map((proposal) => {
          const validation = validations[proposal.proposedManifest.id];
          const acceptDisabled = proposal.status === 'accepted' || proposal.status === 'rejected' || proposal.securityGate?.passed === false;
          return (
            <div className="candidate-row skill-proposal-row" key={proposal.id}>
              <Badge variant={proposalStatusBadge(proposal)}>{proposal.status}</Badge>
              <span>
                <strong>{proposal.id}</strong>
                <small>{proposal.proposedManifest.id}</small>
              </span>
              <div className="skill-proposal-meta">
                <code>{proposal.source.taskCodeRef}</code>
                <small>
                  input {proposal.source.inputRef ?? 'none'} · output {proposal.source.outputRef ?? 'none'} · logs {[proposal.source.stdoutRef, proposal.source.stderrRef].filter(Boolean).join(', ') || 'none'}
                </small>
                <div className="tool-chips compact">
                  {(proposal.validationPlan.expectedArtifactTypes ?? []).slice(0, 4).map((type) => <code key={type}>{type}</code>)}
                  <Badge variant={proposal.securityGate?.passed === false ? 'danger' : 'success'}>{proposal.securityGate?.passed === false ? 'gate fail' : 'gate pass'}</Badge>
                  {validation ? <Badge variant={validation.passed ? 'success' : 'danger'}>{validation.passed ? 'smoke pass' : 'smoke fail'}</Badge> : null}
                </div>
                {proposal.securityGate?.findings.length ? <small>{proposal.securityGate.findings.join('; ')}</small> : null}
              </div>
              <div className="scenario-builder-actions compact-actions">
                <IconButton icon={Check} label="Accept proposal" onClick={acceptDisabled ? undefined : () => onAccept(proposal)} />
                <IconButton icon={RefreshCw} label="Run validation smoke" onClick={proposal.status === 'accepted' ? () => onValidate(proposal) : undefined} />
                <IconButton icon={AlertTriangle} label="Reject proposal" onClick={proposal.status === 'accepted' ? undefined : () => onReject(proposal)} />
                <IconButton icon={Trash2} label="Archive proposal" onClick={() => onArchive(proposal)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function proposalStatusBadge(proposal: SkillPromotionProposalRecord): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  if (proposal.status === 'accepted') return 'success';
  if (proposal.status === 'rejected') return 'danger';
  if (proposal.status === 'archived') return 'muted';
  if (proposal.securityGate?.passed === false) return 'danger';
  return 'warning';
}

type PackageRunStats = {
  lastRun?: BioAgentRun;
  totalRuns: number;
  failedRuns: number;
};

function buildPackageRunStats(workspaceState: BioAgentWorkspaceState): Record<string, PackageRunStats> {
  const stats: Record<string, PackageRunStats> = {};
  const sessions = [
    ...Object.values(workspaceState.sessionsByScenario),
    ...workspaceState.archivedSessions,
  ];
  for (const run of sessions.flatMap((session) => session.runs)) {
    const packageId = run.scenarioPackageRef?.id;
    if (!packageId) continue;
    const current = stats[packageId] ?? { totalRuns: 0, failedRuns: 0 };
    const currentLast = current.lastRun ? Date.parse(current.lastRun.completedAt ?? current.lastRun.createdAt) : -1;
    const runTime = Date.parse(run.completedAt ?? run.createdAt);
    stats[packageId] = {
      lastRun: runTime >= currentLast ? run : current.lastRun,
      totalRuns: current.totalRuns + 1,
      failedRuns: current.failedRuns + (run.status === 'failed' ? 1 : 0),
    };
  }
  return stats;
}

function PackageOperationalMeta({
  versionCount,
  versions = [],
  qualityOk,
  qualityIssueCount,
  runStats,
}: {
  versionCount: number;
  versions?: ScenarioPackage['versions'];
  qualityOk: boolean;
  qualityIssueCount: number;
  runStats?: PackageRunStats;
}) {
  const latestVersion = versions[0];
  const lastRunLabel = runStats?.lastRun
    ? `${runStats.lastRun.status} · ${new Date(runStats.lastRun.completedAt ?? runStats.lastRun.createdAt).toLocaleDateString('zh-CN')}`
    : 'no runs yet';
  return (
    <div className="library-card-meta">
      <Badge variant={qualityOk ? 'success' : 'warning'}>{qualityOk ? 'quality pass' : 'quality warnings'}</Badge>
      <span>{qualityIssueCount} issues</span>
      <span>{versionCount} versions</span>
      <span>last run {lastRunLabel}</span>
      <span>{runStats?.failedRuns ?? 0} failed / {runStats?.totalRuns ?? 0} runs</span>
      {latestVersion ? <code title={latestVersion.summary}>latest {latestVersion.version} · {latestVersion.status}</code> : null}
    </div>
  );
}

function ChatPanel({
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
  onTimelineEvent,
  activeRunId,
  onActiveRunChange,
  onMarkReusableRun,
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
  onTimelineEvent: (event: TimelineEventRecord) => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
  onMarkReusableRun: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(88);
  const [streamEvents, setStreamEvents] = useState<AgentStreamEvent[]>([]);
  const [guidanceQueue, setGuidanceQueue] = useState<string[]>([]);
  const activeSessionRef = useRef(session);
  const guidanceQueueRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const messages = session.messages;
  const baseScenarioId = builtInScenarioIdForInstance(scenarioId, scenarioOverride);
  const scenario = scenarios.find((item) => item.id === baseScenarioId) ?? scenarios[0];
  const scenarioPackageRef = scenarioOverride?.scenarioPackageRef ?? builtInScenarioPackageRef(baseScenarioId);
  const skillPlanRef = scenarioOverride?.skillPlanRef ?? `skill-plan.${baseScenarioId}.default`;
  const uiPlanRef = scenarioOverride?.uiPlanRef ?? `ui-plan.${baseScenarioId}.default`;
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const visibleMessageStart = Math.max(0, messages.length - 24);
  const visibleMessages = messages.slice(visibleMessageStart);

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
    const prompt = input.trim();
    if (!prompt) return;
    if (isSending) {
      handleRunningGuidance(prompt);
      return;
    }
    await runPrompt(prompt, session);
  }

  async function runPrompt(prompt: string, baseSession: BioAgentSession) {
    const userMessage: BioAgentMessage = {
      id: makeId('msg'),
      role: 'user',
      content: prompt,
      createdAt: nowIso(),
      status: 'completed',
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
      const request = {
        scenarioId,
        agentName: scenario.name,
        agentDomain: scenario.domain,
        prompt,
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
          onEvent(event) {
            setStreamEvents((current) => [...current.slice(-32), event]);
          },
        }, controller.signal);
      } catch (projectToolError) {
        const detail = projectToolError instanceof Error ? projectToolError.message : String(projectToolError);
        setStreamEvents((current) => [...current.slice(-32), {
          id: makeId('evt'),
          type: 'project-tool-fallback',
          label: '项目工具',
          detail: `BioAgent project tool unavailable, falling back to AgentServer: ${detail}`,
          createdAt: nowIso(),
          raw: { error: detail },
        }]);
        response = await sendAgentMessageStream(request, {
          onEvent(event) {
            setStreamEvents((current) => [...current.slice(-32), event]);
          },
        }, controller.signal);
      }
      const mergedSession = mergeAgentResponse(activeSessionRef.current, response);
      onSessionChange(mergedSession);
      activeSessionRef.current = mergedSession;
      onActiveRunChange(response.run.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
    abortRef.current?.abort();
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
        <div className="panel-actions">
          <IconButton icon={Plus} label="开启新聊天" onClick={onNewChat} />
          <IconButton icon={Clock} label="历史会话" onClick={() => setHistoryOpen((value) => !value)} />
          {isSending ? <IconButton icon={RefreshCw} label="取消请求" onClick={handleAbort} /> : null}
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
            <span>输入研究问题后，当前 Scenario 会从一个干净上下文开始工作。</span>
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
              {message.status === 'failed' ? (
                <FailureRecoveryCard
                  message={message.content}
                  onOpenSettings={() => setErrorText('请打开右上角设置，检查 AgentServer / Workspace Writer / Model Backend 连接。')}
                  onRetry={() => {
                    const lastPrompt = [...messages].reverse().find((item) => item.role === 'user')?.content;
                    if (lastPrompt) void runPrompt(lastPrompt, activeSessionRef.current);
                  }}
                  onUseSeedSkill={() => setErrorText(`当前可先使用 seed skill / workspace runtime：${skillPlanRef}。如果任务需要通用生成，再启动 AgentServer。`)}
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
        <div className="stream-events">
          <div className="stream-events-head">
            <span>流式事件</span>
            {guidanceQueue.length ? <Badge variant="warning">{guidanceQueue.length} 条引导排队</Badge> : null}
          </div>
          <div className="stream-events-list">
            {streamEvents.slice(-8).map((event) => (
              <div className="stream-event" key={event.id}>
                <Badge variant={event.type.includes('error') ? 'danger' : event.type.includes('guidance') ? 'warning' : 'info'}>{event.label}</Badge>
                {event.detail ? <span className="stream-event-detail">{event.detail}</span> : null}
                <button type="button" onClick={() => void navigator.clipboard?.writeText([event.label, event.detail].filter(Boolean).join(' '))}>复制</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {errorText ? (
        <div className="composer-error">
          <span>{errorText}</span>
          <small>可检查 Runtime Health、启动缺失服务，或改用当前场景的 seed skill 重试。</small>
        </div>
      ) : null}
      <div className="run-readiness">
        <Badge variant={readiness.ok ? 'success' : readiness.severity}>{readiness.ok ? 'ready' : 'action'}</Badge>
        <span>{readiness.message}</span>
        <code>{scenarioPackageRef.id}@{scenarioPackageRef.version}</code>
      </div>
      <div className="composer">
        <div className="composer-resize-handle" onMouseDown={beginComposerResize} title="拖拽调整输入框高度" />
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void handleSend();
          }}
          placeholder={isSending ? '继续输入引导，Enter 后排队到当前推理之后...' : '输入研究问题...'}
          rows={1}
          style={{ height: `${composerHeight}px` }}
        />
        <ActionButton icon={Sparkles} onClick={handleSend} disabled={!input.trim()} >
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

function latestRunningEvent(events: AgentStreamEvent[]) {
  return [...events].reverse().find((event) => event.detail)?.detail;
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
        <button onClick={onUseSeedSkill}>改用 seed skill</button>
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

function mergeRunTimelineEvents(events: TimelineEventRecord[], previousSession: BioAgentSession | undefined, nextSession: BioAgentSession) {
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
      '如果当前任务已有 seed skill，BioAgent 会优先走 workspace runtime。',
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

function scenarioInstanceIdForDraft(draft: ScenarioBuilderDraft): ScenarioInstanceId {
  return `workspace-${draft.baseScenarioId}-${safeInstanceId(draft.title || draft.description)}-${Date.now().toString(36)}`;
}

function compileScenarioPackageForDraft(instanceId: ScenarioInstanceId, draft: ScenarioBuilderDraft): ScenarioPackage {
  const recommendation = recommendScenarioElements(draft.description || draft.scenarioMarkdown);
  const selectedSkillIds = draft.recommendedSkillIds?.length ? draft.recommendedSkillIds : recommendation.selectedSkillIds;
  const selectedArtifactTypes = draft.recommendedArtifactTypes?.length ? draft.recommendedArtifactTypes : recommendation.selectedArtifactTypes;
  const selectedComponentIds = draft.recommendedComponentIds?.length ? draft.recommendedComponentIds : draft.defaultComponents.length ? draft.defaultComponents : recommendation.selectedComponentIds;
  const result = compileScenarioIRFromSelection({
    id: String(instanceId),
    title: draft.title,
    description: draft.description,
    skillDomain: draft.skillDomain,
    scenarioMarkdown: draft.scenarioMarkdown,
    selectedSkillIds,
    selectedToolIds: recommendation.selectedToolIds,
    selectedArtifactTypes,
    selectedComponentIds,
    selectedFailurePolicyIds: recommendation.selectedFailurePolicyIds,
    fallbackComponentId: draft.fallbackComponent,
  });
  return result.package;
}

function safeInstanceId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || Date.now().toString(36);
}

function formatSessionTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

function volcanoPointsFromPayload(payload: Record<string, unknown>, colorField?: string): VolcanoPoint[] | undefined {
  const records = toRecordList(payload.points);
  const points = records.flatMap((record, index) => {
    const logFC = asNumber(record.logFC) ?? asNumber(record.log2FC);
    const negLogP = asNumber(record.negLogP) ?? (asNumber(record.pValue) ? -Math.log10(Math.max(1e-300, asNumber(record.pValue) ?? 1)) : undefined);
    if (logFC === undefined || negLogP === undefined) return [];
    return [{
      gene: asString(record.gene) || asString(record.label) || `Gene${index + 1}`,
      logFC,
      negLogP,
      sig: typeof record.significant === 'boolean' ? record.significant : Math.abs(logFC) > 1.4 && negLogP > 3,
      category: colorField ? asString(record[colorField]) : undefined,
    }];
  });
  return points.length ? points : undefined;
}

function ResultsRenderer({
  scenarioId,
  session,
  defaultSlots,
  onArtifactHandoff,
  collapsed,
  onToggleCollapse,
  activeRunId,
  onActiveRunChange,
}: {
  scenarioId: ScenarioId;
  session: BioAgentSession;
  defaultSlots: UIManifestSlot[];
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
}) {
  const [resultTab, setResultTab] = useState('primary');
  const [focusMode, setFocusMode] = useState<ResultFocusMode>('all');
  const [inspectedArtifact, setInspectedArtifact] = useState<RuntimeArtifact | undefined>();
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const tabs = [
    { id: 'primary', label: '结果视图' },
    { id: 'evidence', label: '证据矩阵' },
    { id: 'execution', label: 'ExecutionUnit' },
    { id: 'notebook', label: '研究记录' },
  ];
  const focusModes: Array<{ id: ResultFocusMode; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'visual', label: '只看图' },
    { id: 'evidence', label: '只看证据' },
    { id: 'execution', label: '只看执行单元' },
  ];

  return (
    <div className={cx('results-panel', collapsed && 'collapsed')}>
      <button
        className="results-collapse-button"
        type="button"
        onClick={onToggleCollapse}
        title={collapsed ? '展开结果面板' : '向右收缩结果面板'}
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
      {!collapsed ? (
        <>
          <div className="result-tabs">
            <TabBar tabs={tabs} active={resultTab} onChange={setResultTab} />
            <div className="result-focus-mode" aria-label="结果区 focus mode">
              {focusModes.map((mode) => (
                <button
                  key={mode.id}
                  className={cx(focusMode === mode.id && 'active')}
                  type="button"
                  onClick={() => {
                    setFocusMode(mode.id);
                    if (mode.id === 'evidence') setResultTab('evidence');
                    if (mode.id === 'execution') setResultTab('execution');
                    if (mode.id === 'visual') setResultTab('primary');
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="result-content">
            {activeRun ? (
              <div className="active-run-banner">
                <div>
                  <strong>当前聚焦 run</strong>
                  <span>{activeRun.id} · {activeRun.status} · {activeRun.scenarioPackageRef ? `${activeRun.scenarioPackageRef.id}@${activeRun.scenarioPackageRef.version}` : scenarioId}</span>
                </div>
                <button type="button" onClick={() => onActiveRunChange(undefined)}>取消高亮</button>
              </div>
            ) : null}
            {resultTab === 'primary' ? (
              <PrimaryResult
                scenarioId={scenarioId}
                session={session}
                defaultSlots={defaultSlots}
                focusMode={focusMode}
                onArtifactHandoff={onArtifactHandoff}
                onInspectArtifact={setInspectedArtifact}
              />
            ) : resultTab === 'evidence' ? (
              <EvidenceMatrix claims={session.claims} />
            ) : resultTab === 'execution' ? (
              <ExecutionPanel session={session} executionUnits={session.executionUnits} />
            ) : (
              <NotebookTimeline scenarioId={scenario.id} notebook={session.notebook} />
            )}
          </div>
          {inspectedArtifact ? (
            <ArtifactInspectorDrawer
              scenarioId={scenarioId}
              session={session}
              artifact={inspectedArtifact}
              onClose={() => setInspectedArtifact(undefined)}
              onArtifactHandoff={onArtifactHandoff}
            />
          ) : null}
        </>
      ) : (
        <div className="results-collapsed-hint">结果</div>
      )}
    </div>
  );
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
  onEditMessage,
  onDeleteMessage,
  archivedCount,
  onArtifactHandoff,
  autoRunRequest,
  onAutoRunConsumed,
  scenarioOverride,
  onScenarioOverrideChange,
  onTimelineEvent,
  onMarkReusableRun,
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
  onEditMessage: (scenarioId: ScenarioInstanceId, messageId: string, content: string) => void;
  onDeleteMessage: (scenarioId: ScenarioInstanceId, messageId: string) => void;
  archivedCount: number;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  autoRunRequest?: HandoffAutoRunRequest;
  onAutoRunConsumed: (requestId: string) => void;
  scenarioOverride?: ScenarioRuntimeOverride;
  onScenarioOverrideChange: (scenarioId: ScenarioInstanceId, override: ScenarioRuntimeOverride) => void;
  onTimelineEvent: (event: TimelineEventRecord) => void;
  onMarkReusableRun: (scenarioId: ScenarioInstanceId, runId: string) => void;
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
  const defaultResultSlots = useMemo(
    () => compileScenarioIRFromSelection(defaultElementSelectionForScenario(baseScenarioId, runtimeScenario)).uiPlan.slots,
    [baseScenarioId, runtimeScenario],
  );
  useEffect(() => {
    if (activeRunId && !session.runs.some((run) => run.id === activeRunId)) {
      setActiveRunId(undefined);
    }
  }, [activeRunId, session.runs]);
  return (
    <main className="workbench">
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
      <div className={cx('workbench-grid', resultsCollapsed && 'results-collapsed')}>
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
            onEditMessage={(messageId, content) => onEditMessage(scenarioId, messageId, content)}
            onDeleteMessage={(messageId) => onDeleteMessage(scenarioId, messageId)}
            archivedCount={archivedCount}
            autoRunRequest={autoRunRequest}
            onAutoRunConsumed={onAutoRunConsumed}
            scenarioOverride={scenarioOverride}
            onTimelineEvent={onTimelineEvent}
            activeRunId={activeRunId}
            onActiveRunChange={setActiveRunId}
            onMarkReusableRun={(runId) => onMarkReusableRun(scenarioId, runId)}
          />
        </div>
        <div className={cx('mobile-pane', mobilePane !== 'results' && 'mobile-hidden')}>
          <ResultsRenderer
            scenarioId={baseScenarioId}
            session={session}
            defaultSlots={defaultResultSlots}
            onArtifactHandoff={onArtifactHandoff}
            collapsed={resultsCollapsed}
            onToggleCollapse={() => setResultsCollapsed((value) => !value)}
            activeRunId={activeRunId}
            onActiveRunChange={setActiveRunId}
          />
        </div>
      </div>
    </main>
  );
}

function ScenarioBuilderPanel({
  scenarioId,
  scenario,
  config,
  expanded,
  onToggle,
  onChange,
}: {
  scenarioId: ScenarioId;
  scenario: ScenarioRuntimeOverride;
  config: BioAgentConfig;
  expanded: boolean;
  onToggle: () => void;
  onChange: (override: ScenarioRuntimeOverride) => void;
}) {
  const builtin = SCENARIO_SPECS[scenarioId];
  const initialSelection = useMemo(() => defaultElementSelectionForScenario(scenarioId, scenario), [scenarioId]);
  const [selection, setSelection] = useState<ScenarioElementSelection>(initialSelection);
  const [builderStep, setBuilderStep] = useState<'describe' | 'elements' | 'contract' | 'quality' | 'publish'>('describe');
  const [previewTab, setPreviewTab] = useState<'scenario' | 'skill' | 'ui' | 'validation'>('scenario');
  const [advancedPreviewOpen, setAdvancedPreviewOpen] = useState(false);
  const [publishStatus, setPublishStatus] = useState('');
  useEffect(() => {
    setSelection(initialSelection);
  }, [initialSelection]);
  const componentOptions = Array.from(new Set([...builtin.componentPolicy.allowedComponents, ...scenario.allowedComponents]));
  const compileResult = useMemo(() => compileScenarioIRFromSelection(selection), [selection]);
  const runtimeHealth = useRuntimeHealth(config);
  const qualityReport = useMemo(() => buildScenarioQualityReport({
    package: compileResult.package,
    validationReport: compileResult.validationReport,
    runtimeHealth,
  }), [compileResult, runtimeHealth]);
  const qualityCounts = useMemo(() => ({
    blocking: qualityReport.items.filter((item) => item.severity === 'blocking').length,
    warning: qualityReport.items.filter((item) => item.severity === 'warning').length,
    note: qualityReport.items.filter((item) => item.severity === 'note').length,
  }), [qualityReport]);
  const skillOptions = elementRegistry.skills.filter((skill) => skill.skillDomains.includes(selection.skillDomain ?? scenario.skillDomain));
  const artifactOptions = elementRegistry.artifacts.filter((artifact) => (
    artifact.tags?.includes(selection.skillDomain ?? scenario.skillDomain)
    || artifact.producerSkillIds.some((skillId) => selection.selectedSkillIds.includes(skillId))
    || selection.selectedArtifactTypes.includes(artifact.artifactType)
  ));
  const toolOptions = elementRegistry.tools.filter((tool) => tool.skillDomains.includes(selection.skillDomain ?? scenario.skillDomain));
  const recommendationReasons = builderRecommendationReasons(selection, scenario, compileResult.uiPlan.slots.length, compileResult.skillPlan.skillIRs.length);
  function patch(patchValue: Partial<ScenarioRuntimeOverride>) {
    onChange({ ...scenario, ...patchValue });
  }
  function patchSelection(patchValue: Partial<ScenarioElementSelection>) {
    setSelection((current) => ({ ...current, ...patchValue }));
  }
  function toggleComponent(component: string) {
    const next = scenario.defaultComponents.includes(component)
      ? scenario.defaultComponents.filter((item) => item !== component)
      : [...scenario.defaultComponents, component];
    patchSelection({ selectedComponentIds: toggleList(selection.selectedComponentIds ?? [], component) });
    patch({ defaultComponents: next.length ? next : [scenario.fallbackComponent] });
  }
  function toggleSelectionList(key: 'selectedSkillIds' | 'selectedToolIds' | 'selectedArtifactTypes' | 'selectedFailurePolicyIds', value: string) {
    setSelection((current) => ({
      ...current,
      [key]: toggleList((current[key] ?? []) as string[], value),
    }));
  }
  async function saveCompiled(status: 'draft' | 'published') {
    try {
      setPublishStatus(status === 'draft' ? '保存中...' : '发布中...');
      const smoke = await runScenarioRuntimeSmoke({ package: compileResult.package, mode: 'dry-run' });
      const quality = buildScenarioQualityReport({
        package: compileResult.package,
        validationReport: smoke.validationReport,
        runtimeSmoke: smoke,
        runtimeHealth,
      });
      const pkg = {
        ...compileResult.package,
        status,
        metadata: {
          ...(compileResult.package as ScenarioPackage & { metadata?: Record<string, unknown> }).metadata,
          recommendationReasons,
          compiledFrom: {
            builderStep,
            skillDomain: selection.skillDomain ?? scenario.skillDomain,
            selectedSkillIds: selection.selectedSkillIds,
            selectedToolIds: selection.selectedToolIds,
            selectedComponentIds: selection.selectedComponentIds,
            selectedArtifactTypes: selection.selectedArtifactTypes,
          },
        },
        validationReport: smoke.validationReport,
        qualityReport: quality,
      };
      if (status === 'published') {
        if (!quality.ok) {
          setPublishStatus('quality gate blocking errors，已保持为 draft。');
          await saveWorkspaceScenario(config, { ...pkg, status: 'draft' });
          return;
        }
        await publishWorkspaceScenario(config, pkg);
      } else {
        await saveWorkspaceScenario(config, pkg);
      }
      setPublishStatus(status === 'draft' ? '已保存 draft 到 workspace。' : '已发布到 workspace scenario library。');
    } catch (error) {
      setPublishStatus(error instanceof Error ? error.message : String(error));
    }
  }
  const previewJson = previewTab === 'scenario'
    ? compileResult.scenario
    : previewTab === 'skill'
      ? compileResult.skillPlan
      : previewTab === 'ui'
        ? compileResult.uiPlan
        : compileResult.validationReport;
  return (
    <section className={cx('scenario-settings', expanded && 'expanded')}>
      <button className="scenario-settings-summary" onClick={onToggle}>
        <FileCode size={16} />
        <span>Scenario Builder</span>
        <strong>{scenario.skillDomain}</strong>
        <em>{compileResult.package.id}@{compileResult.package.version} · {compileResult.validationReport.ok ? 'valid' : 'needs fixes'}</em>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded ? (
        <div className="scenario-settings-body">
          <div className="builder-stepper" aria-label="Scenario Builder steps">
            {[
              ['describe', '需求描述'],
              ['elements', '推荐元素'],
              ['contract', '编辑契约'],
              ['quality', '质量检查'],
              ['publish', '发布运行'],
            ].map(([id, label], index) => (
              <button key={id} className={cx(builderStep === id && 'active')} onClick={() => setBuilderStep(id as typeof builderStep)}>
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className={cx('builder-step-panel', builderStep !== 'describe' && 'muted')}>
            <label>
              <span>场景名称</span>
              <input
                value={scenario.title}
                onChange={(event) => {
                  patch({ title: event.target.value });
                  patchSelection({ title: event.target.value });
                }}
              />
            </label>
            <label>
              <span>Skill domain</span>
              <select
                value={scenario.skillDomain}
                onChange={(event) => {
                  const skillDomain = event.target.value as ScenarioRuntimeOverride['skillDomain'];
                  const base = SCENARIO_SPECS[scenarioIdBySkillDomain[skillDomain]];
                  const domainSkillIds = elementRegistry.skills
                    .filter((skill) => skill.skillDomains.includes(skillDomain))
                    .map((skill) => skill.id);
                  const generatedSkillId = `agentserver.generate.${skillDomain}`;
                  const nextSelectedSkillIds = domainSkillIds.includes(generatedSkillId)
                    ? [generatedSkillId]
                    : domainSkillIds.slice(0, 1);
                  const nextDefaultComponents = base.componentPolicy.defaultComponents;
                  patch({
                    skillDomain,
                    defaultComponents: nextDefaultComponents,
                    allowedComponents: base.componentPolicy.allowedComponents,
                    fallbackComponent: base.componentPolicy.fallbackComponent,
                    scenarioPackageRef: undefined,
                    skillPlanRef: undefined,
                    uiPlanRef: undefined,
                  });
                  patchSelection({
                    skillDomain,
                    selectedSkillIds: nextSelectedSkillIds,
                    selectedToolIds: elementRegistry.tools.filter((tool) => tool.skillDomains.includes(skillDomain)).slice(0, 5).map((tool) => tool.id),
                    selectedArtifactTypes: base.outputArtifacts.map((artifact) => artifact.type),
                    selectedComponentIds: nextDefaultComponents,
                    fallbackComponentId: base.componentPolicy.fallbackComponent,
                  });
                }}
              >
                <option value="literature">literature</option>
                <option value="structure">structure</option>
                <option value="omics">omics</option>
                <option value="knowledge">knowledge</option>
              </select>
            </label>
            <label className="wide">
              <span>场景描述</span>
              <input
                value={scenario.description}
                onChange={(event) => {
                  patch({ description: event.target.value });
                  patchSelection({ description: event.target.value });
                }}
              />
            </label>
          </div>
          <div className={cx('builder-step-panel', builderStep !== 'elements' && 'muted')}>
            <div className="component-selector">
              <span>默认组件集合</span>
              <div>
                {componentOptions.map((component) => (
                  <button
                    key={component}
                    className={cx(scenario.defaultComponents.includes(component) && 'active')}
                    onClick={() => toggleComponent(component)}
                  >
                    {component}
                    <ElementPopover {...componentElementPopover(component)} />
                  </button>
                ))}
              </div>
            </div>
            <ElementSelector
              title="Skills"
              options={skillOptions.map((skill) => ({
                id: skill.id,
                label: skill.label,
                detail: skill.description,
                meta: `produces ${skill.outputArtifactTypes.join(', ') || 'runtime artifacts'} · ${skill.requiredCapabilities.map((item) => `${item.capability}:${item.level}`).join(', ') || 'no extra capability profile'}`,
              }))}
              selected={selection.selectedSkillIds}
              onToggle={(id) => toggleSelectionList('selectedSkillIds', id)}
            />
            <ElementSelector
              title="Tools"
              options={toolOptions.map((tool) => ({
                id: tool.id,
                label: tool.label,
                detail: tool.description,
                meta: `${tool.toolType} · produces ${(tool.producesArtifactTypes ?? []).join(', ') || 'supporting runtime data'}`,
              }))}
              selected={selection.selectedToolIds ?? []}
              onToggle={(id) => toggleSelectionList('selectedToolIds', id)}
            />
            <ElementSelector
              title="Artifacts"
              options={artifactOptions.map((artifact) => ({
                id: artifact.artifactType,
                label: artifact.label,
                detail: artifact.description,
                meta: `producer ${artifact.producerSkillIds.join(', ') || 'none'} · consumer ${artifact.consumerComponentIds.join(', ') || 'none'} · handoff ${artifact.handoffTargets.join(', ') || 'none'}`,
              }))}
              selected={selection.selectedArtifactTypes}
              onToggle={(id) => toggleSelectionList('selectedArtifactTypes', id)}
            />
            <ElementSelector
              title="Failure policies"
              options={elementRegistry.failurePolicies.map((policy) => ({
                id: policy.id,
                label: policy.label,
                detail: policy.description,
                meta: `fallback ${policy.fallbackComponentId} · ${policy.recoverActions.join(', ')}`,
              }))}
              selected={selection.selectedFailurePolicyIds ?? []}
              onToggle={(id) => toggleSelectionList('selectedFailurePolicyIds', id)}
            />
          </div>
          <div className={cx('builder-step-panel', builderStep !== 'contract' && 'muted')}>
            <label className="wide">
              <span>Scenario markdown</span>
              <textarea
                value={scenario.scenarioMarkdown}
                onChange={(event) => {
                  patch({ scenarioMarkdown: event.target.value });
                  patchSelection({ scenarioMarkdown: event.target.value });
                }}
              />
            </label>
          </div>
          <div className="builder-recommendation-summary">
            <strong>推荐组合</strong>
            <span>基于 skill domain={selection.skillDomain ?? scenario.skillDomain}，当前会生成 {compileResult.uiPlan.slots.length} 个 UI slot、{compileResult.skillPlan.skillIRs.length} 个 skill step。</span>
            <span>发布前会检查 producer/consumer、fallback、runtime profile 和 package quality gate。</span>
            <ul>
              {recommendationReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
          <div className={cx('scenario-preview-panel', builderStep !== 'contract' && 'muted')}>
            <button className="advanced-preview-toggle" onClick={() => setAdvancedPreviewOpen((value) => !value)}>
              {advancedPreviewOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {advancedPreviewOpen ? '收起高级 JSON contract' : '展开高级 JSON contract'}
            </button>
            {advancedPreviewOpen ? (
              <>
                <div className="scenario-preview-tabs">
                  {(['scenario', 'skill', 'ui', 'validation'] as const).map((tab) => (
                    <button key={tab} className={cx(previewTab === tab && 'active')} onClick={() => setPreviewTab(tab)}>{tab}</button>
                  ))}
                </div>
                <pre className="inspector-json">{JSON.stringify(previewJson, null, 2)}</pre>
              </>
            ) : null}
          </div>
          <div className={cx('manifest-diagnostics', builderStep !== 'quality' && 'muted')}>
            <strong>Quality gate</strong>
            <span><Badge variant={qualityCounts.blocking ? 'danger' : 'success'}>{qualityCounts.blocking} blocking</Badge></span>
            <span><Badge variant={qualityCounts.warning ? 'warning' : 'muted'}>{qualityCounts.warning} warning</Badge></span>
            <span><Badge variant="info">{qualityCounts.note} note</Badge></span>
            <code>{qualityReport.items.slice(0, 3).map((item) => `${item.severity}:${item.code}`).join(' · ') || 'ready'}</code>
          </div>
          <div className={cx('scenario-publish-row', builderStep !== 'publish' && 'muted')}>
            <div>
              <Badge variant={compileResult.validationReport.ok ? 'success' : 'warning'}>
                {compileResult.validationReport.ok ? 'validation ok' : `${compileResult.validationReport.issues.length} issues`}
              </Badge>
              {publishStatus ? <span>{publishStatus}</span> : null}
            </div>
            <div>
              <ActionButton icon={FilePlus} variant="secondary" onClick={() => void saveCompiled('draft')}>保存 draft</ActionButton>
              <ActionButton icon={Play} disabled={!compileResult.validationReport.ok} onClick={() => void saveCompiled('published')}>发布</ActionButton>
              {publishStatus.includes('已发布') ? <ActionButton icon={Download} variant="secondary" onClick={() => exportJsonFile(`${compileResult.package.id}-${compileResult.package.version}.scenario-package.json`, compileResult.package)}>导出 package</ActionButton> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function defaultElementSelectionForScenario(scenarioId: ScenarioId, scenario: ScenarioRuntimeOverride): ScenarioElementSelection {
  const spec = SCENARIO_SPECS[scenarioId];
  const compiledHints = scenario as ScenarioRuntimeOverride & Partial<Pick<ScenarioBuilderDraft, 'recommendedSkillIds' | 'recommendedArtifactTypes' | 'recommendedComponentIds'>>;
  const recommendation = recommendScenarioElements([
    scenario.title,
    scenario.description,
  ].join('\n'));
  return {
    id: `${scenarioId}-workspace-draft`,
    title: scenario.title,
    description: scenario.description,
    skillDomain: scenario.skillDomain,
    scenarioMarkdown: scenario.scenarioMarkdown,
    selectedSkillIds: compiledHints.recommendedSkillIds?.length
      ? compiledHints.recommendedSkillIds
      : recommendation.selectedSkillIds.length
      ? recommendation.selectedSkillIds
      : [`agentserver.generate.${scenario.skillDomain}`],
    selectedToolIds: recommendation.selectedToolIds.length
      ? recommendation.selectedToolIds
      : elementRegistry.tools.filter((tool) => tool.skillDomains.includes(scenario.skillDomain)).slice(0, 5).map((tool) => tool.id),
    selectedArtifactTypes: compiledHints.recommendedArtifactTypes?.length
      ? compiledHints.recommendedArtifactTypes
      : recommendation.selectedArtifactTypes.length
      ? recommendation.selectedArtifactTypes
      : spec.outputArtifacts.map((artifact) => artifact.type),
    selectedComponentIds: compiledHints.recommendedComponentIds?.length
      ? compiledHints.recommendedComponentIds
      : recommendation.selectedComponentIds.length
      ? recommendation.selectedComponentIds
      : scenario.defaultComponents,
    selectedFailurePolicyIds: ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'],
    fallbackComponentId: scenario.fallbackComponent,
    status: 'draft',
  };
}

function scenarioPackageToOverride(pkg: { scenario: { title: string; description: string; skillDomain: ScenarioRuntimeOverride['skillDomain']; scenarioMarkdown: string; selectedComponentIds: string[]; fallbackComponentId: string } }): ScenarioRuntimeOverride {
  const base = SCENARIO_SPECS[scenarioIdBySkillDomain[pkg.scenario.skillDomain]];
  const defaultComponents = pkg.scenario.selectedComponentIds.length ? pkg.scenario.selectedComponentIds : base.componentPolicy.defaultComponents;
  const packageLike = pkg as { id?: string; version?: string; skillPlan?: { id?: string }; uiPlan?: { id?: string } };
  return {
    title: pkg.scenario.title,
    description: pkg.scenario.description,
    skillDomain: pkg.scenario.skillDomain,
    scenarioMarkdown: pkg.scenario.scenarioMarkdown,
    defaultComponents,
    allowedComponents: Array.from(new Set([...base.componentPolicy.allowedComponents, ...defaultComponents])),
    fallbackComponent: pkg.scenario.fallbackComponentId || base.componentPolicy.fallbackComponent,
    scenarioPackageRef: packageLike.id && packageLike.version ? { id: packageLike.id, version: packageLike.version, source: 'workspace' } : undefined,
    skillPlanRef: packageLike.skillPlan?.id,
    uiPlanRef: packageLike.uiPlan?.id,
  };
}

function toggleList(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function builderRecommendationReasons(
  selection: ScenarioElementSelection,
  scenario: ScenarioRuntimeOverride,
  uiSlotCount: number,
  skillStepCount: number,
) {
  const domain = selection.skillDomain ?? scenario.skillDomain;
  return [
    `skill domain ${domain} 决定默认 skill/tool/profile 搜索空间。`,
    `${selection.selectedSkillIds.length} 个 skill 覆盖 ${selection.selectedArtifactTypes.length} 个 artifact contract。`,
    `${uiSlotCount} 个 UI slot 由已选 artifact consumer 自动编译，fallback=${scenario.fallbackComponent}。`,
    `${skillStepCount} 个 skill step 会进入 package metadata，便于后续 diff 和复现。`,
  ];
}

function componentElementPopover(componentId: string) {
  const component = elementRegistry.components.find((item) => item.componentId === componentId);
  if (!component) {
    return {
      label: componentId,
      detail: '未注册组件会使用 unknown-artifact-inspector fallback。',
      meta: 'producer/consumer unknown · fallback unknown-artifact-inspector',
    };
  }
  return {
    label: component.label,
    detail: component.description,
    meta: `accepts ${component.acceptsArtifactTypes.join(', ') || '*'} · fields ${component.requiredFields.join(', ') || 'none'} · fallback ${component.fallback}`,
  };
}

function ElementPopover({ label, detail, meta }: { label: string; detail: string; meta: string }) {
  return (
    <span className="element-popover" role="tooltip">
      <strong>{label}</strong>
      <small>{detail}</small>
      <em>{meta}</em>
    </span>
  );
}

function ElementSelector({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: Array<{ id: string; label: string; detail?: string; meta?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="component-selector">
      <span>{title}</span>
      <div>
        {options.slice(0, 24).map((option) => (
          <button key={option.id} className={cx(selected.includes(option.id) && 'active')} onClick={() => onToggle(option.id)} title={option.label}>
            {option.id}
            <ElementPopover label={option.label} detail={option.detail ?? option.id} meta={option.meta ?? 'no additional profile'} />
          </button>
        ))}
      </div>
    </div>
  );
}

type RegistryRendererProps = {
  scenarioId: ScenarioId;
  session: BioAgentSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
};

type RegistryEntry = {
  label: string;
  render: (props: RegistryRendererProps) => ReactNode;
};

type ResultFocusMode = 'all' | 'visual' | 'evidence' | 'execution';

interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioId;
  prompt: string;
}

function defaultSlotsForAgent(scenarioId: ScenarioId): UIManifestSlot[] {
  return compileSlotsForScenario(scenarioId);
}

function PaperCardList({ slot, artifact, session }: RegistryRendererProps) {
  const records = applyViewTransforms(arrayPayload(slot, 'papers', artifact), slot);
  const papers = records.map((record, index) => ({
    title: asString(record.title) || asString(record.name) || `Paper ${index + 1}`,
    source: asString(record.source) || asString(record.journal) || asString(record.venue) || 'unknown source',
    year: asString(record.year) || String(asNumber(record.year) ?? 'unknown'),
    url: asString(record.url),
    level: pickEvidenceLevel(record.evidenceLevel),
  }));
  if (!artifact || !papers.length) {
    return <ComponentEmptyState componentId="paper-card-list" artifactType="paper-list" detail={!artifact ? undefined : '当前 paper-list artifact 缺少 papers 数组；请检查字段映射或修复 skill 输出。'} />;
  }
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      {viewCompositionSummary(slot) ? <div className="composition-strip"><code>{viewCompositionSummary(slot)}</code></div> : null}
      <div className="paper-list">
        {papers.map((paper) => (
          <Card key={`${paper.title}-${paper.source}`} className="paper-card">
            <div>
              <h3>{paper.url ? <a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a> : paper.title}</h3>
              <p>{paper.source} · {paper.year}</p>
            </div>
            <EvidenceTag level={paper.level} />
            <Badge variant="success">runtime</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MoleculeSlot({ slot, artifact, session }: RegistryRendererProps) {
  const payload = slotPayload(slot, artifact);
  const pdbId = asString(payload.pdbId) || asString(payload.pdb);
  const uniprotId = asString(payload.uniprotId);
  const ligand = asString(payload.ligand) || 'none';
  const residues = asStringList(payload.highlightResidues ?? payload.residues);
  const metrics = isRecord(payload.metrics) ? payload.metrics : payload;
  const dataRef = asString(artifact?.dataRef) || asString(payload.dataRef);
  const atoms = toRecordList(payload.atomCoordinates).flatMap((atom) => {
    const x = asNumber(atom.x);
    const y = asNumber(atom.y);
    const z = asNumber(atom.z);
    if (x === undefined || y === undefined || z === undefined) return [];
    return [{
      atomName: asString(atom.atomName),
      residueName: asString(atom.residueName),
      chain: asString(atom.chain),
      residueNumber: asString(atom.residueNumber),
      element: asString(atom.element),
      x,
      y,
      z,
      hetatm: atom.hetatm === true,
    }];
  });
  if (!artifact || (!pdbId && !uniprotId)) {
    return <ComponentEmptyState componentId="molecule-viewer" artifactType="structure-summary" detail={!artifact ? undefined : '当前 structure-summary 缺少 pdbId 或 uniprotId；请补齐 accession 字段。'} />;
  }
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <div className="slot-meta">
        <Badge variant="success">{artifactMeta(artifact)}</Badge>
        <code>{uniprotId ? `UniProt=${uniprotId}` : `PDB=${pdbId}`}</code>
        <code>ligand={ligand}</code>
        {dataRef ? <code title={dataRef}>dataRef={compactParams(dataRef)}</code> : <code>record-only structure</code>}
        {residues.length ? <code>residues={residues.join(',')}</code> : null}
        {slot.encoding?.highlightSelection ? <code>highlightSelection={Array.isArray(slot.encoding.highlightSelection) ? slot.encoding.highlightSelection.join(',') : slot.encoding.highlightSelection}</code> : null}
      </div>
      {dataRef ? (
        <div className="viz-card">
          <MoleculeViewer
            pdbId={pdbId || uniprotId}
            ligand={ligand}
            structureUrl={dataRef}
            highlightResidues={residues}
            pocketLabel={asString(payload.pocketLabel) || asString(payload.pocket) || 'Structure view'}
            atoms={atoms}
          />
        </div>
      ) : (
        <ComponentEmptyState componentId="molecule-viewer" artifactType="structure-summary" title="缺少结构坐标 dataRef" detail="已保留结构摘要，但没有可加载坐标文件；请检查 project tool 输出。" />
      )}
      <MetricGrid metrics={metrics} />
    </div>
  );
}

function CanvasSlot({ slot, artifact, session, kind }: RegistryRendererProps & { kind: 'volcano' | 'heatmap' | 'umap' | 'network' }) {
  const payload = slotPayload(slot, artifact);
  const colorField = slot.encoding?.colorBy;
  const splitField = slot.encoding?.splitBy || slot.encoding?.facetBy;
  const graphNodeRecords = toRecordList(payload.nodes).length ? toRecordList(payload.nodes) : toRecordList(payload.entities);
  const networkNodes = graphNodeRecords.map((node) => ({
    id: asString(node.id),
    label: asString(node.label) || asString(node.name),
    type: colorField ? asString(node[colorField]) || asString(node.type) : asString(node.type),
  }));
  const networkEdges = toRecordList(payload.edges).map((edge) => ({
    source: asString(edge.source) || asString(edge.from),
    target: asString(edge.target) || asString(edge.to),
    relation: asString(edge.relation),
    evidenceLevel: asString(edge.evidenceLevel) || asString(edge.evidence_level),
    confidence: asNumber(edge.confidence),
    sourceDb: asString(edge.sourceDb) || asString(edge.source_db) || edgeSourcesLabel(edge.sources),
  }));
  const volcanoPoints = volcanoPointsFromPayload(payload, colorField);
  const heatmap = isRecord(payload.heatmap)
    ? asNumberMatrix(payload.heatmap.matrix ?? payload.heatmap.values)
    : asNumberMatrix(payload.matrix ?? payload.values);
  const svgText = kind === 'heatmap'
    ? asString(payload.heatmapSvgText) || asString(payload.svgText)
    : kind === 'umap'
      ? asString(payload.umapSvgText) || asString(payload.svgText)
      : undefined;
  const umapPoints = toRecordList(payload.umap ?? payload.points).flatMap((point) => {
    const x = asNumber(point.x) ?? asNumber(point.umap1);
    const y = asNumber(point.y) ?? asNumber(point.umap2);
    return x === undefined || y === undefined ? [] : [{
      x,
      y,
      cluster: colorField ? asString(point[colorField]) || asString(point.cluster) || asString(point.group) : asString(point.cluster) || asString(point.group),
      label: asString(point.label),
    }];
  });
  if (!artifact) {
    return <ComponentEmptyState componentId={canvasComponentId(kind)} artifactType={canvasArtifactType(kind)} detail={`${kind} 组件不再使用 demo seed；请先运行当前 Scenario 生成 artifact。`} />;
  }
  const hasData = kind === 'volcano'
    ? Boolean(volcanoPoints?.length)
    : kind === 'heatmap'
      ? Boolean(heatmap || svgText)
      : kind === 'umap'
        ? Boolean(umapPoints.length || svgText)
        : Boolean(networkNodes.length);
  if (!hasData) {
    return <ComponentEmptyState componentId={canvasComponentId(kind)} artifactType={artifact.type} title="artifact 缺少可视化数据" detail={`当前 ${artifact.type} 没有 ${kind} 所需字段；UI 已停止回退到 demo 图。`} />;
  }
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <div className="slot-meta">
        <Badge variant="success">{artifactMeta(artifact)}</Badge>
        {networkNodes.length ? <code>{networkNodes.length} nodes</code> : null}
        {networkEdges.length ? <code>{networkEdges.length} edges</code> : null}
        {volcanoPoints?.length ? <code>{volcanoPoints.length} volcano points</code> : null}
        {umapPoints.length ? <code>{umapPoints.length} UMAP points</code> : null}
        {heatmap ? <code>{heatmap.length}x{heatmap[0]?.length ?? 0} heatmap</code> : null}
        {colorField ? <code>colorBy={colorField}</code> : null}
        {splitField ? <code>splitBy={splitField}</code> : null}
      </div>
      <Card className="viz-card">
        {kind === 'volcano' ? (
          <div className="chart-300">
            <Suspense fallback={<ChartLoadingFallback label="加载火山图" />}>
              <VolcanoChart points={volcanoPoints} />
            </Suspense>
          </div>
        ) : svgText ? (
          <SvgArtifactImage svgText={svgText} label={kind === 'heatmap' ? 'Heatmap SVG artifact' : 'UMAP SVG artifact'} />
        ) : kind === 'heatmap' ? (
          <HeatmapViewer matrix={heatmap} label={[asString(payload.label) || asString(isRecord(payload.heatmap) ? payload.heatmap.label : undefined), splitField ? `splitBy=${splitField}` : undefined].filter(Boolean).join(' · ') || undefined} />
        ) : kind === 'umap' ? (
          <UmapViewer points={umapPoints.length ? umapPoints : undefined} />
        ) : (
          <NetworkGraph nodes={networkNodes.length ? networkNodes : undefined} edges={networkEdges.length ? networkEdges : undefined} />
        )}
      </Card>
    </div>
  );
}

function SvgArtifactImage({ svgText, label }: { svgText: string; label: string }) {
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  return (
    <div className="svg-artifact-frame">
      <img src={source} alt={label} />
    </div>
  );
}

function DataTableSlot({ slot, artifact, session }: RegistryRendererProps) {
  const records = applyViewTransforms(arrayPayload(slot, 'rows', artifact), slot);
  const rows = records;
  if (!artifact || !rows.length) {
    return (
      <div className="stack">
        <ArtifactDownloads artifact={artifact} />
        <ComponentEmptyState componentId="data-table" artifactType={artifact?.type ?? 'knowledge-graph'} detail={!artifact ? undefined : `当前 ${artifact.type} 没有可表格化 rows；请打开 Artifact Inspector 检查 payload。`} />
      </div>
    );
  }
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 5);
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <ArtifactDownloads artifact={artifact} />
      {viewCompositionSummary(slot) ? <div className="composition-strip"><code>{viewCompositionSummary(slot)}</code></div> : null}
      <div className="artifact-table">
        <div className="artifact-table-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
          {columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {rows.map((row, index) => (
          <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
            {columns.map((column) => <span key={column}>{String(row[column] ?? '-')}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnknownArtifactInspector({ slot, artifact, session }: RegistryRendererProps) {
  const payload = artifact?.data ?? slot.props ?? {};
  const rows = Array.isArray(payload)
    ? payload.filter(isRecord)
    : isRecord(payload) && Array.isArray(payload.rows)
      ? payload.rows.filter(isRecord)
      : [];
  const unit = session ? executionUnitForArtifact(session, artifact) : undefined;
  const refs = [
    artifact?.dataRef ? { label: 'dataRef', value: artifact.dataRef } : undefined,
    unit?.codeRef ? { label: 'codeRef', value: unit.codeRef } : undefined,
    unit?.stdoutRef ? { label: 'stdoutRef', value: unit.stdoutRef } : undefined,
    unit?.stderrRef ? { label: 'stderrRef', value: unit.stderrRef } : undefined,
    unit?.outputRef ? { label: 'outputRef', value: unit.outputRef } : undefined,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const columns = rows.length ? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 6) : [];
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <ArtifactDownloads artifact={artifact} />
      <div className="slot-meta">
        <Badge variant="warning">inspector</Badge>
        {artifact ? <code>{artifact.type}</code> : null}
        {viewCompositionSummary(slot) ? <code>{viewCompositionSummary(slot)}</code> : null}
      </div>
      {refs.length ? (
        <div className="inspector-ref-list">
          {refs.map((ref) => (
            <code key={`${ref.label}-${ref.value}`}>{ref.label}: {ref.value}</code>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <div className="artifact-table">
          <div className="artifact-table-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
            {columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {rows.slice(0, 20).map((row, index) => (
            <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
              {columns.map((column) => <span key={column}>{String(row[column] ?? '-')}</span>)}
            </div>
          ))}
        </div>
      ) : (
        <pre className="inspector-json">{JSON.stringify(payload, null, 2)}</pre>
      )}
    </div>
  );
}

function ReportViewerSlot({ slot, artifact, session }: RegistryRendererProps) {
  const payload = slotPayload(slot, artifact);
  const report = coerceReportPayload(payload);
  const markdown = report.markdown;
  const sections = report.sections;
  if (!artifact || (!markdown && !sections.length)) {
    return <ComponentEmptyState componentId="report-viewer" artifactType="research-report" detail={!artifact ? undefined : '当前 research-report 缺少 markdown/report/sections 字段；请检查 AgentServer 生成的 artifact contract。'} />;
  }
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <ArtifactDownloads artifact={artifact} />
      <div className="slot-meta">
        <Badge variant="success">report</Badge>
        {sections.length ? <code>{sections.length} sections</code> : null}
        {viewCompositionSummary(slot) ? <code>{viewCompositionSummary(slot)}</code> : null}
      </div>
      <div className="report-viewer">
        <div className="report-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown || sectionsToMarkdown(sections))}>
            复制 Markdown
          </button>
        </div>
        {sections.length ? sections.map((section, index) => (
          <section key={`${asString(section.title) ?? 'section'}-${index}`}>
            <h3>{asString(section.title) || `Section ${index + 1}`}</h3>
            <MarkdownBlock markdown={asString(section.content) || asString(section.markdown) || recordToReadableText(section)} />
          </section>
        )) : <MarkdownBlock markdown={markdown} />}
      </div>
    </div>
  );
}

function coerceReportPayload(payload: Record<string, unknown>) {
  const nested = parseNestedReport(payload);
  const source = nested ?? payload;
  const sections = toRecordList(source.sections);
  const markdown = asString(source.markdown)
    || asString(source.report)
    || asString(source.summary)
    || asString(source.content)
    || (sections.length ? sectionsToMarkdown(sections) : undefined)
    || reportFromKnownFields(source);
  return { markdown, sections };
}

function parseNestedReport(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ['data', 'content', 'report', 'markdown', 'result']) {
    const value = payload[key];
    if (isRecord(value)) return value;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        if (isRecord(parsed.data)) return parsed.data;
        return parsed;
      }
    } catch {
      // The string may already be normal Markdown.
    }
  }
  return undefined;
}

function sectionsToMarkdown(sections: Record<string, unknown>[]) {
  return sections.map((section, index) => {
    const title = asString(section.title) || `Section ${index + 1}`;
    const content = asString(section.content) || asString(section.markdown) || recordToReadableText(section);
    return `## ${title}\n\n${content}`;
  }).join('\n\n');
}

function reportFromKnownFields(record: Record<string, unknown>) {
  const parts: string[] = [];
  const title = asString(record.title) || asString(record.name);
  if (title) parts.push(`# ${title}`);
  for (const key of ['executiveSummary', 'keyFindings', 'methods', 'limitations', 'conclusions']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) parts.push(`## ${humanizeKey(key)}\n\n${value.trim()}`);
    if (Array.isArray(value) && value.length) {
      parts.push(`## ${humanizeKey(key)}\n\n${value.map((item) => `- ${typeof item === 'string' ? item : recordToReadableText(isRecord(item) ? item : { value: item })}`).join('\n')}`);
    }
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

function recordToReadableText(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) => key !== 'title')
    .map(([key, value]) => {
      if (typeof value === 'string') return `**${humanizeKey(key)}:** ${value}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `**${humanizeKey(key)}:** ${String(value)}`;
      if (Array.isArray(value)) return `**${humanizeKey(key)}:**\n${value.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n') || JSON.stringify(record, null, 2);
}

function humanizeKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MarkdownBlock({ markdown }: { markdown?: string }) {
  const lines = (markdown || '').split('\n');
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  function flushList() {
    if (!list.length) return;
    nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</ul>);
    list = [];
  }
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (/^#{1,4}\s+/.test(trimmed)) {
      flushList();
      const level = trimmed.match(/^#+/)?.[0].length ?? 2;
      const text = trimmed.replace(/^#{1,4}\s+/, '');
      nodes.push(level <= 2 ? <h3 key={index}>{inlineMarkdown(text)}</h3> : <h4 key={index}>{inlineMarkdown(text)}</h4>);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*]\s+/, ''));
      return;
    }
    flushList();
    nodes.push(<p key={index}>{inlineMarkdown(trimmed)}</p>);
  });
  flushList();
  return <div className="markdown-block">{nodes}</div>;
}

function inlineMarkdown(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function ArtifactDownloads({ artifact }: { artifact?: RuntimeArtifact }) {
  const downloads = artifactDownloadItems(artifact);
  if (!downloads.length) return null;
  return (
    <div className="artifact-downloads">
      {downloads.map((item) => (
        <ActionButton
          key={`${item.name}-${item.path ?? item.key ?? ''}`}
          icon={Download}
          variant="secondary"
          onClick={() => exportTextFile(item.name, item.content, item.contentType)}
        >
          {item.name}{typeof item.rowCount === 'number' ? ` · ${item.rowCount} rows` : ''}
        </ActionButton>
      ))}
    </div>
  );
}

function artifactDownloadItems(artifact?: RuntimeArtifact) {
  const data = artifact?.data;
  const raw = isRecord(data) && Array.isArray(data.downloads) ? data.downloads : [];
  return raw
    .filter(isRecord)
    .map((item) => ({
      key: asString(item.key),
      name: asString(item.name) ?? asString(item.filename) ?? 'artifact-download.txt',
      path: asString(item.path),
      contentType: asString(item.contentType) ?? 'text/plain',
      rowCount: asNumber(item.rowCount),
      content: typeof item.content === 'string' ? item.content : '',
    }))
    .filter((item) => item.content.length > 0);
}

function EmptyArtifactState({ title, detail, recoverActions }: { title: string; detail: string; recoverActions?: string[] }) {
  return (
    <div className="empty-runtime-state">
      <Badge variant="muted">empty</Badge>
      <strong>{title}</strong>
      <p>{detail}</p>
      <div className="empty-recover-actions" aria-label="恢复动作">
        {(recoverActions?.length ? recoverActions : ['run-current-scenario', 'import-matching-package', 'inspect-artifact-schema']).map((action) => (
          <span key={action}>{recoverActionLabel(action)}</span>
        ))}
      </div>
    </div>
  );
}

function ComponentEmptyState({
  componentId,
  artifactType,
  title,
  detail,
}: {
  componentId: string;
  artifactType?: string;
  title?: string;
  detail?: string;
}) {
  const component = elementRegistry.components.find((item) => item.componentId === componentId);
  const producerSkillIds = artifactType
    ? elementRegistry.artifacts.find((item) => item.artifactType === artifactType)?.producerSkillIds ?? []
    : [];
  const recoverActions = [
    ...(component?.recoverActions ?? []),
    ...producerSkillIds.slice(0, 2).map((skillId) => `run-skill:${skillId}`),
  ];
  return (
    <EmptyArtifactState
      title={title ?? component?.emptyState.title ?? '等待 runtime artifact'}
      detail={detail ?? component?.emptyState.detail ?? '当前组件没有可展示 artifact；请运行场景或导入匹配数据。'}
      recoverActions={Array.from(new Set(recoverActions))}
    />
  );
}

function canvasComponentId(kind: 'volcano' | 'heatmap' | 'umap' | 'network') {
  if (kind === 'volcano') return 'volcano-plot';
  if (kind === 'heatmap') return 'heatmap-viewer';
  if (kind === 'umap') return 'umap-viewer';
  return 'network-graph';
}

function canvasArtifactType(kind: 'volcano' | 'heatmap' | 'umap' | 'network') {
  return kind === 'network' ? 'knowledge-graph' : 'omics-differential-expression';
}

function recoverActionLabel(action: string) {
  const labels: Record<string, string> = {
    'run-current-scenario': '运行当前场景',
    'rerun-current-scenario': '重试当前运行',
    'import-matching-package': '导入匹配 package',
    'inspect-artifact-schema': '检查 artifact schema',
    'inspect-artifact': '打开 Artifact Inspector',
    'inspect-ui-manifest': '检查 UIManifest',
    'inspect-claims': '检查 claims',
    'inspect-runtime-route': '查看 runtime route',
    'export-diagnostics': '导出诊断包',
    'repair-ui-plan': '修复 UIPlan',
    'create-timeline-event': '创建 timeline event',
    'import-research-bundle': '导入研究 bundle',
  };
  if (labels[action]) return labels[action];
  if (action.startsWith('run-skill:')) return `运行 skill ${action.slice('run-skill:'.length)}`;
  if (action.startsWith('inspect-artifact-schema:')) return `检查 ${action.slice('inspect-artifact-schema:'.length)} schema`;
  if (action.startsWith('import-package:')) return `导入 ${action.slice('import-package:'.length)} package`;
  if (action.startsWith('fallback-component:')) return `改用 ${action.slice('fallback-component:'.length)} 组件`;
  if (action.startsWith('add-field:')) return `补齐字段 ${action.slice('add-field:'.length)}`;
  if (action.startsWith('add-fields:')) return `补齐字段 ${action.slice('add-fields:'.length)}`;
  if (action.startsWith('map-fields:')) return `映射字段 ${action.slice('map-fields:'.length)}`;
  if (action.startsWith('map-array-field:')) return `映射数组字段 ${action.slice('map-array-field:'.length)}`;
  if (action.startsWith('repair-task:')) return `修复任务 ${action.slice('repair-task:'.length)}`;
  return action;
}

function ArtifactSourceBar({ artifact, session }: { artifact?: RuntimeArtifact; session?: BioAgentSession }) {
  const source = artifactSource(artifact);
  const unit = session ? executionUnitForArtifact(session, artifact) : undefined;
  if (!artifact) {
    return (
      <div className="artifact-source-bar">
        <Badge variant="muted">empty</Badge>
        <code>no runtime artifact</code>
      </div>
    );
  }
  return (
    <div className="artifact-source-bar">
      <Badge variant={sourceVariant(source)}>{source}</Badge>
      <code>{artifact.id}</code>
      <code>{artifact.type}</code>
      <code>schema={artifact.schemaVersion}</code>
      {artifact.dataRef ? <code title={artifact.dataRef}>dataRef={compactParams(artifact.dataRef)}</code> : null}
      {unit ? <code title={unit.params}>tool={unit.tool} · {unit.status}</code> : <code>audit warning: no ExecutionUnit</code>}
    </div>
  );
}

const componentRegistry: Record<string, RegistryEntry> = {
  'report-viewer': { label: 'ReportViewer', render: (props) => <ReportViewerSlot {...props} /> },
  'paper-card-list': { label: 'PaperCardList', render: (props) => <PaperCardList {...props} /> },
  'molecule-viewer': { label: 'MoleculeViewer', render: (props) => <MoleculeSlot {...props} /> },
  'volcano-plot': { label: 'VolcanoPlot', render: (props) => <CanvasSlot {...props} kind="volcano" /> },
  'heatmap-viewer': { label: 'HeatmapViewer', render: (props) => <CanvasSlot {...props} kind="heatmap" /> },
  'umap-viewer': { label: 'UmapViewer', render: (props) => <CanvasSlot {...props} kind="umap" /> },
  'network-graph': { label: 'NetworkGraph', render: (props) => <CanvasSlot {...props} kind="network" /> },
  'evidence-matrix': { label: 'EvidenceMatrix', render: ({ session }) => <EvidenceMatrix claims={session.claims} /> },
  'execution-unit-table': { label: 'ExecutionUnitTable', render: ({ session }) => <ExecutionPanel session={session} executionUnits={session.executionUnits} embedded /> },
  'notebook-timeline': { label: 'NotebookTimeline', render: ({ scenarioId, session }) => <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} /> },
  'data-table': { label: 'DataTable', render: (props) => <DataTableSlot {...props} /> },
  'unknown-artifact-inspector': { label: 'UnknownArtifactInspector', render: (props) => <UnknownArtifactInspector {...props} /> },
};

function PrimaryResult({
  scenarioId,
  session,
  defaultSlots,
  focusMode,
  onArtifactHandoff,
  onInspectArtifact,
}: {
  scenarioId: ScenarioId;
  session: BioAgentSession;
  defaultSlots?: UIManifestSlot[];
  focusMode: ResultFocusMode;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
}) {
  const runtimeSlots = session.runs.length && session.uiManifest.length ? session.uiManifest : [];
  const slotLimit = focusMode === 'visual' || focusMode === 'all' ? 8 : 4;
  const slots = (runtimeSlots.length ? runtimeSlots : defaultSlots?.length ? defaultSlots : defaultSlotsForAgent(scenarioId))
    .slice()
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .filter((slot) => slotMatchesFocusMode(slot, focusMode))
    .slice(0, slotLimit);
  return (
    <div className="stack">
      <SectionHeader icon={FileText} title="动态结果区" subtitle="UIManifest -> component registry -> artifact/runtime data" />
      <ManifestDiagnostics slots={slots} />
      {!slots.length ? (
        <EmptyArtifactState
          title="当前 focus mode 没有匹配组件"
          detail="切回“全部”，或运行一个会生成对应 artifact 的 skill；结果区不会用 demo 数据补位。"
        />
      ) : null}
      <div className="registry-grid">
        {slots.map((slot) => (
          <RegistrySlot
            key={`${slot.componentId}-${slot.artifactRef ?? slot.title ?? slot.priority ?? ''}`}
            scenarioId={scenarioId}
            session={session}
            slot={slot}
            onArtifactHandoff={onArtifactHandoff}
            onInspectArtifact={onInspectArtifact}
          />
        ))}
      </div>
    </div>
  );
}

function RegistrySlot({
  scenarioId,
  session,
  slot,
  onArtifactHandoff,
  onInspectArtifact,
}: {
  scenarioId: ScenarioId;
  session: BioAgentSession;
  slot: UIManifestSlot;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
}) {
  const [handoffPreviewTarget, setHandoffPreviewTarget] = useState<ScenarioId | undefined>();
  const artifact = findArtifact(session, slot.artifactRef);
  const entry = componentRegistry[slot.componentId];
  const handoffTargets = artifact ? handoffTargetsForArtifact(artifact, scenarioId) : [];
  if (!entry) {
    return (
      <Card className="registry-slot">
        <SectionHeader icon={AlertTriangle} title={slot.title ?? '未注册组件'} subtitle={slot.componentId} />
        <p className="empty-state">Scenario 返回了未知 componentId。当前使用通用 inspector 展示 artifact、manifest 和日志引用。</p>
        {slot.artifactRef && !artifact ? <p className="empty-state">artifactRef 未找到：{slot.artifactRef}</p> : null}
        <UnknownArtifactInspector scenarioId={scenarioId} session={session} slot={slot} artifact={artifact} />
      </Card>
    );
  }
  return (
    <Card className="registry-slot">
      <SectionHeader icon={Target} title={slot.title ?? entry.label} subtitle={`${slot.componentId}${slot.artifactRef ? ` -> ${slot.artifactRef}` : ''}`} />
      {viewCompositionSummary(slot) ? <div className="composition-strip"><code>{viewCompositionSummary(slot)}</code></div> : null}
      {slot.artifactRef && !artifact ? <p className="empty-state">artifactRef 未找到，组件保持 empty state，不使用 demo 数据。</p> : null}
      {artifact ? (
        <div className="artifact-card-actions">
          <button type="button" onClick={() => onInspectArtifact(artifact)}>
            <Eye size={13} />
            检查 artifact
          </button>
        </div>
      ) : null}
      {artifact && handoffTargets.length ? (
        <div className="handoff-actions">
          <span>发送 artifact 到</span>
          {handoffTargets.map((target) => {
            const targetScenario = scenarios.find((item) => item.id === target);
            return (
              <button key={target} onClick={() => setHandoffPreviewTarget(target)}>
                {targetScenario?.name ?? target}
              </button>
            );
          })}
        </div>
      ) : null}
      {artifact && handoffPreviewTarget ? (
        <HandoffPreview
          sourceScenarioId={scenarioId}
          targetScenarioId={handoffPreviewTarget}
          artifact={artifact}
          onCancel={() => setHandoffPreviewTarget(undefined)}
          onConfirm={() => onArtifactHandoff(handoffPreviewTarget, artifact)}
        />
      ) : null}
      {entry.render({ scenarioId, session, slot, artifact })}
    </Card>
  );
}

function slotMatchesFocusMode(slot: UIManifestSlot, focusMode: ResultFocusMode) {
  if (focusMode === 'all') return true;
  if (focusMode === 'evidence') return slot.componentId === 'evidence-matrix' || slot.artifactRef === 'evidence-matrix';
  if (focusMode === 'execution') return slot.componentId === 'execution-unit-table' || slot.artifactRef === 'execution-unit';
  return ['molecule-viewer', 'volcano-plot', 'heatmap-viewer', 'umap-viewer', 'network-graph'].includes(slot.componentId);
}

function HandoffPreview({
  sourceScenarioId,
  targetScenarioId,
  artifact,
  onCancel,
  onConfirm,
}: {
  sourceScenarioId: ScenarioId;
  targetScenarioId: ScenarioId;
  artifact: RuntimeArtifact;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const source = scenarios.find((item) => item.id === sourceScenarioId);
  const target = scenarios.find((item) => item.id === targetScenarioId);
  const autoRunPrompt = handoffAutoRunPrompt(targetScenarioId, artifact, source?.name ?? sourceScenarioId, target?.name ?? targetScenarioId);
  const fields = [
    ['artifact id', artifact.id],
    ['artifact type', artifact.type],
    ['schema', artifact.schemaVersion],
    ['source', artifact.producerScenario],
    ['new run', `${target?.name ?? targetScenarioId} auto-run draft`],
  ];
  return (
    <div className="handoff-preview" role="group" aria-label="Handoff 确认预览">
      <div>
        <strong>确认 handoff</strong>
        <p>会把 artifact 放入目标场景上下文，并创建一条可自动运行的用户输入草案。</p>
      </div>
      <div className="handoff-field-grid">
        {fields.map(([label, value]) => (
          <span key={label}>
            <em>{label}</em>
            <code>{value}</code>
          </span>
        ))}
      </div>
      <pre className="handoff-prompt-preview">{autoRunPrompt}</pre>
      <div className="handoff-preview-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" onClick={onConfirm}>确认 handoff</button>
      </div>
    </div>
  );
}

function ArtifactInspectorDrawer({
  scenarioId,
  session,
  artifact,
  onClose,
  onArtifactHandoff,
}: {
  scenarioId: ScenarioId;
  session: BioAgentSession;
  artifact: RuntimeArtifact;
  onClose: () => void;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
}) {
  const unit = executionUnitForArtifact(session, artifact);
  const handoffTargets = handoffTargetsForArtifact(artifact, scenarioId);
  const files = [
    artifact.dataRef ? ['dataRef', artifact.dataRef] : undefined,
    unit?.codeRef ? ['codeRef', unit.codeRef] : undefined,
    unit?.stdoutRef ? ['stdoutRef', unit.stdoutRef] : undefined,
    unit?.stderrRef ? ['stderrRef', unit.stderrRef] : undefined,
    unit?.outputRef ? ['outputRef', unit.outputRef] : undefined,
    ...artifactDownloadItems(artifact).map((item) => [item.name, item.path || item.key || 'download payload'] as [string, string]),
  ].filter((item): item is [string, string] => Boolean(item));
  const lineage = [
    ['producer scenario', artifact.producerScenario],
    ['producer skill', asStringList(artifact.metadata?.producerSkillIds).join(', ') || asString(artifact.metadata?.producerSkillId) || 'unknown'],
    ['execution unit', unit ? `${unit.id} · ${unit.tool} · ${unit.status}` : 'missing'],
    ['created', asString(artifact.metadata?.createdAt) ?? 'unknown'],
  ];
  return (
    <div className="artifact-inspector-layer">
      <button className="artifact-inspector-backdrop" type="button" aria-label="关闭 Artifact Inspector" onClick={onClose} />
      <aside className="artifact-inspector-drawer" role="dialog" aria-modal="false" aria-label="Artifact Inspector">
        <div className="artifact-inspector-head">
          <div>
            <Badge variant="info">Artifact Inspector</Badge>
            <h2>{artifact.id}</h2>
            <p>{artifact.type} · schema {artifact.schemaVersion}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 Artifact Inspector">关闭</button>
        </div>
        <section>
          <h3>Schema</h3>
          <div className="handoff-field-grid">
            <span><em>type</em><code>{artifact.type}</code></span>
            <span><em>schemaVersion</em><code>{artifact.schemaVersion}</code></span>
            <span><em>source</em><code>{artifactSource(artifact)}</code></span>
          </div>
        </section>
        <section>
          <h3>Lineage</h3>
          <div className="inspector-ref-list">
            {lineage.map(([label, value]) => <code key={label}>{label}: {value}</code>)}
          </div>
        </section>
        <section>
          <h3>Files</h3>
          {files.length ? (
            <div className="inspector-ref-list">
              {files.map(([label, value]) => <code key={`${label}-${value}`}>{label}: {value}</code>)}
            </div>
          ) : (
            <p className="empty-state">没有可复现文件引用；请检查 ExecutionUnit 是否写入 code/stdout/stderr/output refs。</p>
          )}
        </section>
        <section>
          <h3>Preview</h3>
          <pre className="inspector-json">{JSON.stringify(artifact.data ?? artifact, null, 2)}</pre>
        </section>
        <section>
          <h3>Handoff targets</h3>
          {handoffTargets.length ? (
            <div className="handoff-actions compact">
              {handoffTargets.map((target) => {
                const targetScenario = scenarios.find((item) => item.id === target);
                return (
                  <button key={target} type="button" onClick={() => onArtifactHandoff(target, artifact)}>
                    {targetScenario?.name ?? target}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">当前 artifact schema 没有声明可 handoff 的目标场景。</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function handoffTargetsForArtifact(artifact: RuntimeArtifact, currentScenarioId: ScenarioId): ScenarioId[] {
  const declaredTargets = asStringList(isRecord(artifact.metadata) ? artifact.metadata.handoffTargets : undefined)
    .filter(isBuiltInScenarioId);
  const schemaTargets = isBuiltInScenarioId(artifact.producerScenario)
    ? SCENARIO_SPECS[artifact.producerScenario].outputArtifacts
      .find((schema) => schema.type === artifact.type)
      ?.consumers ?? []
    : scenarios.flatMap((scenario) => SCENARIO_SPECS[scenario.id].outputArtifacts
      .filter((schema) => schema.type === artifact.type)
      .flatMap((schema) => schema.consumers));
  return Array.from(new Set([...declaredTargets, ...schemaTargets]))
    .filter((target) => target !== currentScenarioId);
}

function ManifestDiagnostics({ slots }: { slots: Array<{ componentId: string; title?: string; artifactRef?: string }> }) {
  return (
    <div className="manifest-diagnostics">
      {slots.map((slot) => (
        <code key={`${slot.componentId}-${slot.artifactRef ?? slot.title ?? ''}`}>
          {slot.componentId}{slot.artifactRef ? ` -> ${slot.artifactRef}` : ''}
        </code>
      ))}
    </div>
  );
}

function MetricGrid({ metrics = {} }: { metrics?: Record<string, unknown> }) {
  const rows = [
    ['Pocket volume', asString(metrics.pocketVolume) || (asNumber(metrics.pocketVolume) ? `${asNumber(metrics.pocketVolume)} A3` : undefined), '#00E5A0'],
    ['pLDDT mean', asString(metrics.pLDDT) || asString(metrics.plddt) || (asNumber(metrics.pLDDT) ?? asNumber(metrics.plddt))?.toString(), '#4ECDC4'],
    ['Resolution', asString(metrics.resolution) || (asNumber(metrics.resolution) ? `${asNumber(metrics.resolution)} A` : undefined), '#FFD54F'],
    ['Mutation risk', asString(metrics.mutationRisk), '#FF7043'],
    ['Method', asString(metrics.method), '#B0C4D8'],
  ].filter((row): row is [string, string, string] => typeof row[1] === 'string' && row[1].trim().length > 0);
  if (!rows.length) {
    return <EmptyArtifactState title="没有结构指标" detail="structure-summary 未提供 metrics；UI 不再填充默认分辨率或 pLDDT。" />;
  }
  return (
    <div className="metric-grid">
      {rows.map(([label, value, color]) => (
        <Card className="metric" key={label}>
          <span>{label}</span>
          <strong style={{ color }}>{value}</strong>
        </Card>
      ))}
    </div>
  );
}

function EvidenceMatrix({ claims }: { claims: EvidenceClaim[] }) {
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const rows = claims.map((claim) => ({
    id: claim.id,
    claim: claim.text,
    support: `${claim.supportingRefs.length} 条支持`,
    oppose: `${claim.opposingRefs.length} 条反向`,
    level: claim.evidenceLevel,
    type: claim.type,
    supportingRefs: claim.supportingRefs,
    opposingRefs: claim.opposingRefs,
    dependencyRefs: claim.dependencyRefs ?? [],
    updateReason: claim.updateReason,
  }));
  return (
    <div className="stack">
      <SectionHeader icon={Shield} title="EvidenceGraph" subtitle="Claim -> supporting / opposing evidence" />
      {!rows.length ? <EmptyArtifactState title="等待真实 claims" detail="证据矩阵只展示当前 run 的 claims，不再回退到 KRAS demo claims。" /> : null}
      {rows.map((row) => (
        <Card className="evidence-row" key={row.id}>
          <div className="evidence-main">
            <h3>{row.claim}</h3>
            <p>{row.support} · {row.oppose}{row.dependencyRefs.length ? ` · ${row.dependencyRefs.length} 条依赖` : ''}</p>
            {row.updateReason ? <p className="empty-state">updateReason: {row.updateReason}</p> : null}
            {row.supportingRefs.length || row.opposingRefs.length || row.dependencyRefs.length ? (
              <>
                <button className="expand-link source-toggle" onClick={() => setExpandedClaim(expandedClaim === row.id ? null : row.id)}>
                  {expandedClaim === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expandedClaim === row.id ? '收起来源' : '查看来源/依赖'}
                </button>
                {expandedClaim === row.id ? (
                  <div className="source-list">
                    {row.supportingRefs.map((ref) => <code key={`support-${ref}`}>+ {ref}</code>)}
                    {row.opposingRefs.map((ref) => <code key={`oppose-${ref}`}>- {ref}</code>)}
                    {row.dependencyRefs.map((ref) => <code key={`dependency-${ref}`}>depends-on {ref}</code>)}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <EvidenceTag level={row.level} />
          <ClaimTag type={row.type} />
        </Card>
      ))}
    </div>
  );
}

function ExecutionPanel({
  session,
  executionUnits,
  embedded = false,
}: {
  session: BioAgentSession;
  executionUnits: RuntimeExecutionUnit[];
  embedded?: boolean;
}) {
  const rows = executionUnits;
  return (
    <div className="stack">
      <SectionHeader
        icon={Lock}
        title="可复现执行单元"
        subtitle={embedded ? '当前组件来自 UIManifest registry' : '代码 + 参数 + 环境 + 数据指纹'}
        action={<ActionButton icon={Download} variant="secondary" onClick={() => exportExecutionBundle(session)}>导出 JSON Bundle</ActionButton>}
      />
      {rows.length ? (
        <div className="eu-table">
          <div className="eu-head">
            <span>EU ID</span>
            <span>Tool</span>
            <span>Params</span>
            <span>Code Artifact</span>
            <span>Status</span>
            <span>Hash</span>
          </div>
          {rows.map((unit, index) => (
            <div className="eu-row" key={`${unit.id}-${unit.hash || index}-${index}`}>
              <code>{unit.id}</code>
              <span>{unit.tool}</span>
              <code title={unit.params}>{compactParams(unit.params)}</code>
              <code title={[unit.codeRef, unit.stdoutRef, unit.stderrRef].filter(Boolean).join('\n') || unit.code || ''}>
                {unit.codeRef || unit.language || unit.code || 'n/a'}
              </code>
              <Badge variant={executionStatusVariant(unit.status)}>{unit.status}</Badge>
              <code>{unit.hash}</code>
              {executionStatusDetail(unit) ? (
                <div className="eu-detail">
                  {executionStatusDetail(unit)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : <EmptyArtifactState title="等待真实 ExecutionUnit" detail="执行面板只展示当前会话的 runtime executionUnits，不再填充 demo 执行记录。" />}
      <Card className="code-card">
        <SectionHeader icon={FileCode} title="环境定义" />
        <pre>{executionEnvironmentText(rows)}</pre>
      </Card>
    </div>
  );
}

function executionStatusVariant(status: RuntimeExecutionUnit['status']): 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral' {
  if (status === 'done' || status === 'self-healed') return 'success';
  if (status === 'failed' || status === 'failed-with-reason') return 'danger';
  if (status === 'repair-needed') return 'warning';
  if (status === 'planned' || status === 'record-only') return 'muted';
  return 'info';
}

function executionStatusDetail(unit: RuntimeExecutionUnit) {
  const lines = [
    unit.attempt ? `attempt=${unit.attempt}` : undefined,
    unit.parentAttempt ? `parentAttempt=${unit.parentAttempt}` : undefined,
    unit.runtimeProfileId ? `runtimeProfile=${unit.runtimeProfileId}` : undefined,
    unit.routeDecision?.selectedSkill ? `selectedSkill=${unit.routeDecision.selectedSkill}` : undefined,
    unit.routeDecision?.selectedRuntime ? `selectedRuntime=${unit.routeDecision.selectedRuntime}` : undefined,
    unit.routeDecision?.fallbackReason ? `fallback=${unit.routeDecision.fallbackReason}` : undefined,
    unit.scenarioPackageRef ? `package=${unit.scenarioPackageRef.id}@${unit.scenarioPackageRef.version}` : undefined,
    unit.skillPlanRef ? `skillPlan=${unit.skillPlanRef}` : undefined,
    unit.uiPlanRef ? `uiPlan=${unit.uiPlanRef}` : undefined,
    unit.selfHealReason ? `selfHealReason=${unit.selfHealReason}` : undefined,
    unit.failureReason ? `failureReason=${unit.failureReason}` : undefined,
    unit.requiredInputs?.length ? `requiredInputs=${unit.requiredInputs.join(', ')}` : undefined,
    unit.recoverActions?.length ? `recover=${unit.recoverActions.join(' | ')}` : undefined,
    unit.nextStep ? `nextStep=${unit.nextStep}` : undefined,
    unit.patchSummary ? `patchSummary=${unit.patchSummary}` : undefined,
    unit.diffRef ? `diffRef=${unit.diffRef}` : undefined,
    unit.stdoutRef ? `stdout=${unit.stdoutRef}` : undefined,
    unit.stderrRef ? `stderr=${unit.stderrRef}` : undefined,
    unit.outputRef ? `output=${unit.outputRef}` : undefined,
  ].filter(Boolean);
  return lines.length ? lines.join(' · ') : '';
}

function executionEnvironmentText(rows: RuntimeExecutionUnit[]) {
  if (!rows.length) return 'No runtime execution units yet.';
  return rows.map((unit) => [
    `id: ${unit.id}`,
    `tool: ${unit.tool}`,
    `language: ${unit.language || 'unspecified'}`,
    `codeRef: ${unit.codeRef || unit.code || 'n/a'}`,
    `entrypoint: ${unit.entrypoint || 'n/a'}`,
    `environment: ${unit.environment || 'n/a'}`,
    `stdoutRef: ${unit.stdoutRef || 'n/a'}`,
    `stderrRef: ${unit.stderrRef || 'n/a'}`,
    `outputRef: ${unit.outputRef || 'n/a'}`,
    `runtimeProfileId: ${unit.runtimeProfileId || 'n/a'}`,
    `selectedSkill: ${unit.routeDecision?.selectedSkill || 'n/a'}`,
    `selectedRuntime: ${unit.routeDecision?.selectedRuntime || 'n/a'}`,
    `fallbackReason: ${unit.routeDecision?.fallbackReason || 'n/a'}`,
    `scenarioPackageRef: ${unit.scenarioPackageRef ? `${unit.scenarioPackageRef.id}@${unit.scenarioPackageRef.version}:${unit.scenarioPackageRef.source}` : 'n/a'}`,
    `skillPlanRef: ${unit.skillPlanRef || 'n/a'}`,
    `uiPlanRef: ${unit.uiPlanRef || 'n/a'}`,
    `attempt: ${unit.attempt || 'n/a'}`,
    `parentAttempt: ${unit.parentAttempt || 'n/a'}`,
    `selfHealReason: ${unit.selfHealReason || 'n/a'}`,
    `failureReason: ${unit.failureReason || 'n/a'}`,
    `patchSummary: ${unit.patchSummary || 'n/a'}`,
    `diffRef: ${unit.diffRef || 'n/a'}`,
    `requiredInputs: ${(unit.requiredInputs ?? []).join(', ') || 'n/a'}`,
    `recoverActions: ${(unit.recoverActions ?? []).join(' | ') || 'n/a'}`,
    `nextStep: ${unit.nextStep || 'n/a'}`,
    `databases: ${(unit.databaseVersions ?? []).join(', ') || 'n/a'}`,
  ].join('\n')).join('\n\n');
}

function NotebookTimeline({ scenarioId, notebook = [] }: { scenarioId: ScenarioId; notebook?: NotebookRecord[] }) {
  const filtered = notebook;
  return (
    <div className="stack">
      <SectionHeader icon={Clock} title="研究记录" subtitle="从对话到可审计 notebook timeline" />
      {!filtered.length ? <EmptyArtifactState title="等待真实 notebook 记录" detail="Notebook 只展示当前会话运行产生的记录；全局 demo timeline 仅保留在研究时间线页面。" /> : null}
      <div className="timeline-list">
        {filtered.map((item) => {
          const scenario = scenarios.find((entry) => entry.id === item.scenario) ?? scenarios[0];
          return (
            <Card className="timeline-card" key={item.title}>
              <div className="timeline-dot" style={{ background: scenario.color }} />
              <div>
                <div className="timeline-meta">
                  <span>{item.time}</span>
                  <ClaimTag type={item.claimType} />
                  <ConfidenceBar value={item.confidence} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                {item.updateReason ? <p className="empty-state">updateReason: {item.updateReason}</p> : null}
                {item.artifactRefs?.length || item.executionUnitRefs?.length || item.beliefRefs?.length || item.dependencyRefs?.length ? (
                  <div className="source-list">
                    {(item.artifactRefs ?? []).map((ref) => <code key={`artifact-${item.id}-${ref}`}>artifact {ref}</code>)}
                    {(item.executionUnitRefs ?? []).map((ref) => <code key={`eu-${item.id}-${ref}`}>execution {ref}</code>)}
                    {(item.beliefRefs ?? []).map((ref) => <code key={`belief-${item.id}-${ref}`}>belief {ref}</code>)}
                    {(item.dependencyRefs ?? []).map((ref) => <code key={`dependency-${item.id}-${ref}`}>depends-on {ref}</code>)}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type AlignmentContractData = AlignmentContractRecord['data'];

const defaultAlignmentContract: AlignmentContractData = {
  dataReality: '内部药敏样本约 200 例，包含 GDSC/CCLE 对齐后的表达矩阵、药物响应标签和基础质控记录。',
  aiAssessment: '特征维度显著高于样本量，主模型需要正则化、先验通路约束和外部数据预训练。',
  bioReality: '窄谱靶向药低响应率是生物学现实，需要按机制拆分模型，不能简单合并为一个泛化分类器。',
  feasibilityMatrix: feasibilityRows.map((row) => `${row.dim}: status=needs-data; source=AI-draft; AI=${row.ai}; Bio=${row.bio}; Action=${row.action}`).join('\n'),
  researchGoal: '聚焦 12 种药物的敏感性预测，排除 3 种极低响应率窄谱靶向药。',
  technicalRoute: 'GDSC/CCLE 预训练 + 内部数据微调，按机制拆分模型。',
  successCriteria: 'AUROC > 0.80，假阳性率 < 20%，至少 3 个命中完成实验验证。',
  knownRisks: '批次效应、药物机制差异和验证成本可能影响项目节奏。',
  recalibrationRecord: '模型在 2 种 HDAC 抑制剂上 AUROC 仅 0.58；共识为拆分模型并补充组蛋白修饰数据。',
  dataAssetsChecklist: 'needs-data: 列出表达矩阵、药敏标签、质控报告和外部公共数据 sourceRefs。',
  sampleSizeChecklist: 'needs-data: 按药物、癌种、批次统计样本量；低于阈值不得给出确定可行判断。',
  labelQualityChecklist: 'needs-data: 标注标签来源、缺失率、不平衡比例和人工复核状态。',
  batchEffectChecklist: 'needs-data: 记录 GDSC/CCLE/内部数据批次变量、校正策略和残余风险。',
  experimentalConstraints: 'needs-data: 记录预算、周期、可用细胞系、验证读出和失败重试条件。',
  feasibilitySourceNotes: 'unknown: 每个矩阵单元必须标注 user-input / artifact-statistic / literature-evidence / AI-draft。',
};

function AlignmentPage({
  contracts,
  onSaveContract,
}: {
  contracts: AlignmentContractRecord[];
  onSaveContract: (data: AlignmentContractData, reason: string, confirmationStatus?: AlignmentContractRecord['confirmationStatus']) => void;
}) {
  const [step, setStep] = useState(0);
  const latest = contracts[0];
  const [draft, setDraft] = useState<AlignmentContractData>(() => alignmentDraftData(latest));
  const [reason, setReason] = useState('alignment contract saved from workspace');
  const steps = ['数据摸底', '可行性评估', '方案共识', '持续校准'];
  useEffect(() => {
    setDraft(alignmentDraftData(latest));
  }, [latest?.id]);
  function updateField(field: keyof AlignmentContractData, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }
  function saveDraft(nextReason = reason, confirmationStatus: AlignmentContractRecord['confirmationStatus'] = 'needs-data') {
    onSaveContract(draft, nextReason.trim() || 'alignment contract saved from workspace', confirmationStatus);
  }
  function restore(contract: AlignmentContractRecord) {
    setDraft(alignmentDraftData(contract));
    onSaveContract(contract.data, `restore alignment contract ${contract.id}`);
  }
  return (
    <main className="page">
      <div className="page-heading">
        <h1>跨领域对齐工作台</h1>
        <p>把 AI 专家的可行性判断和生物专家的实验现实放到同一个结构化工作台里。</p>
      </div>
      <div className="artifact-source-bar alignment-status">
        <Badge variant={latest ? 'success' : 'muted'}>{latest ? 'alignment-contract' : 'draft-only'}</Badge>
        {latest ? <code>{latest.id}</code> : <code>not saved</code>}
        {latest ? <code>checksum={latest.checksum}</code> : null}
        {latest ? <code>versions={contracts.length}</code> : null}
        {latest ? <code>authority={latest.decisionAuthority || 'researcher'}</code> : null}
        {latest ? <Badge variant={latest.confirmationStatus === 'user-confirmed' ? 'success' : latest.confirmationStatus === 'needs-data' ? 'warning' : 'muted'}>{latest.confirmationStatus || 'needs-data'}</Badge> : null}
      </div>
      <div className="stepper">
        {steps.map((name, index) => (
          <button key={name} className={cx(index === step && 'active', index < step && 'done')} onClick={() => setStep(index)}>
            <span>{index < step ? <Check size={13} /> : index + 1}</span>
            {name}
          </button>
        ))}
      </div>
      {step === 0 ? (
        <AlignmentSurvey draft={draft} onChange={updateField} />
      ) : step === 1 ? (
        <Feasibility draft={draft} onChange={updateField} />
      ) : step === 2 ? (
        <ProjectContract draft={draft} onChange={updateField} reason={reason} onReasonChange={setReason} onSave={() => saveDraft()} onConfirm={() => saveDraft('researcher confirmed alignment contract', 'user-confirmed')} />
      ) : (
        <Recalibration draft={draft} onChange={updateField} contracts={contracts} onRestore={restore} onSave={() => saveDraft('alignment recalibration saved')} />
      )}
    </main>
  );
}

function alignmentDraftData(contract?: AlignmentContractRecord): AlignmentContractData {
  return { ...defaultAlignmentContract, ...(contract?.data ?? {}) };
}

function AlignmentSurvey({
  draft,
  onChange,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
}) {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={Sparkles} title="AI 视角" subtitle="数据能力评估" />
        <Progress label="样本量" value={20} color="#FFD54F" detail="200 / 1000 ideal" />
        <Progress label="特征维度" value={100} color="#00E5A0" detail="20K genes" />
        <Progress label="标签平衡度" value={35} color="#FF7043" detail="3 drugs < 5%" />
        <EditableBlock label="AI assessment" value={draft.aiAssessment} onChange={(value) => onChange('aiAssessment', value)} />
        <EditableBlock label="Data assets checklist" value={draft.dataAssetsChecklist} onChange={(value) => onChange('dataAssetsChecklist', value)} rows={4} />
        <EditableBlock label="Sample size checklist" value={draft.sampleSizeChecklist} onChange={(value) => onChange('sampleSizeChecklist', value)} rows={4} />
      </Card>
      <Card>
        <SectionHeader icon={Target} title="生物视角" subtitle="数据来源与实验现实" />
        <Progress label="药物覆盖" value={100} color="#00E5A0" detail="15 / 15" />
        <Progress label="组学模态" value={60} color="#FFD54F" detail="3 / 5" />
        <Progress label="批次一致性" value={60} color="#FFD54F" detail="GDSC vs CCLE" />
        <EditableBlock label="Data reality" value={draft.dataReality} onChange={(value) => onChange('dataReality', value)} />
        <EditableBlock label="Bio reality" value={draft.bioReality} onChange={(value) => onChange('bioReality', value)} />
        <EditableBlock label="Label quality checklist" value={draft.labelQualityChecklist} onChange={(value) => onChange('labelQualityChecklist', value)} rows={4} />
        <EditableBlock label="Batch effect checklist" value={draft.batchEffectChecklist} onChange={(value) => onChange('batchEffectChecklist', value)} rows={4} />
      </Card>
    </div>
  );
}

function Progress({ label, value, color, detail }: { label: string; value: number; color: string; detail: string }) {
  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <em>{detail}</em>
      </div>
      <div className="progress-track">
        <i style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function Feasibility({
  draft,
  onChange,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
}) {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={Target} title="可行性矩阵" />
        <div className="feasibility-list">
          {feasibilityRows.map((row) => (
            <div className="feasibility-row" key={row.dim}>
              <div className="feasibility-top">
                <strong>{row.dim}</strong>
                <Badge variant="warning">needs-data</Badge>
              </div>
              <div className="dual-view">
                <span>AI draft: {row.ai}</span>
                <span>Bio input: {row.bio}</span>
              </div>
              <div className="slot-meta">
                <code>source=AI-draft</code>
                <code>state=unknown until sourceRefs are attached</code>
              </div>
              <p>{row.action}</p>
            </div>
          ))}
        </div>
        <EditableBlock label="Editable feasibility matrix" value={draft.feasibilityMatrix} onChange={(value) => onChange('feasibilityMatrix', value)} rows={8} />
        <EditableBlock label="Feasibility source notes" value={draft.feasibilitySourceNotes} onChange={(value) => onChange('feasibilitySourceNotes', value)} rows={5} />
      </Card>
      <Card>
        <SectionHeader title="双视角能力雷达" subtitle="AI vs Bio assessment" />
        <div className="chart-300">
          <Suspense fallback={<ChartLoadingFallback label="加载能力雷达" />}>
            <CapabilityRadarChart data={radarData} />
          </Suspense>
        </div>
      </Card>
    </div>
  );
}

function ProjectContract({
  draft,
  onChange,
  reason,
  onReasonChange,
  onSave,
  onConfirm,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  onSave: () => void;
  onConfirm: () => void;
}) {
  const fields: Array<[keyof AlignmentContractData, string]> = [
    ['researchGoal', '研究目标'],
    ['technicalRoute', '技术路线'],
    ['successCriteria', '成功标准'],
    ['knownRisks', '已知风险'],
    ['experimentalConstraints', '实验约束'],
  ];
  return (
    <Card>
      <SectionHeader icon={FileText} title="项目契约草案" action={<ActionButton icon={FilePlus} variant="secondary" onClick={onSave}>保存契约</ActionButton>} />
      <div className="contract-grid">
        {fields.map(([field, label]) => (
          <EditableBlock key={field} label={label} value={draft[field]} onChange={(value) => onChange(field, value)} rows={4} />
        ))}
      </div>
      <div className="alignment-save-row">
        <label>
          <span>Version reason</span>
          <input value={reason} onChange={(event) => onReasonChange(event.target.value)} />
        </label>
        <Badge variant="warning">AI draft · needs-data until researcher confirmation</Badge>
        <ActionButton icon={FilePlus} onClick={onSave}>保存 alignment-contract</ActionButton>
        <ActionButton icon={Check} variant="secondary" onClick={onConfirm}>研究者确认保存</ActionButton>
      </div>
    </Card>
  );
}

function Recalibration({
  draft,
  onChange,
  contracts,
  onRestore,
  onSave,
}: {
  draft: AlignmentContractData;
  onChange: (field: keyof AlignmentContractData, value: string) => void;
  contracts: AlignmentContractRecord[];
  onRestore: (contract: AlignmentContractRecord) => void;
  onSave: () => void;
}) {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={AlertTriangle} title="持续校准记录" subtitle="早期发现认知漂移和模型偏差" action={<ActionButton icon={FilePlus} variant="secondary" onClick={onSave}>保存校准</ActionButton>} />
        <EditableBlock label="Recalibration record" value={draft.recalibrationRecord} onChange={(value) => onChange('recalibrationRecord', value)} rows={8} />
      </Card>
      <Card>
        <SectionHeader icon={Clock} title="版本快照" subtitle="保存、查看和恢复 alignment-contract" />
        <div className="alignment-version-list">
          {contracts.length ? contracts.map((contract) => (
            <div className="alignment-version-row" key={contract.id}>
              <div>
                <strong>{contract.title}</strong>
                <p>{new Date(contract.updatedAt).toLocaleString('zh-CN', { hour12: false })} · {contract.reason}</p>
                <code>{contract.checksum}</code>
              </div>
              <ActionButton variant="ghost" onClick={() => onRestore(contract)}>恢复</ActionButton>
            </div>
          )) : <EmptyArtifactState title="等待保存契约" detail="保存后会生成 alignment-contract artifact，并同步到 workspace .bioagent/artifacts。" />}
        </div>
      </Card>
    </div>
  );
}

function EditableBlock({
  label,
  value,
  onChange,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="editable-block">
      <span>{label}</span>
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TimelinePage({
  alignmentContracts = [],
  events = [],
  onOpenScenario,
}: {
  alignmentContracts?: AlignmentContractRecord[];
  events?: TimelineEventRecord[];
  onOpenScenario: (id: ScenarioInstanceId) => void;
}) {
  const [query, setQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const alignmentItems = alignmentContracts.map((contract) => ({
    time: new Date(contract.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    scenario: 'knowledge' as ScenarioId,
    title: contract.title,
    desc: `alignment-contract ${contract.id} · ${contract.reason} · checksum ${contract.checksum}`,
    claimType: 'fact' as ClaimType,
    confidence: 1,
    action: 'alignment.contract',
    refs: contract.sourceRefs,
  }));
  const runtimeItems = events.map((event) => ({
    time: new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false }),
    scenario: event.branchId ?? 'literature-evidence-review',
    title: event.action,
    desc: `${event.subject} · artifacts=${event.artifactRefs.length} · units=${event.executionUnitRefs.length}`,
    claimType: 'fact' as ClaimType,
    confidence: event.action.includes('failed') ? 0.35 : 0.9,
    action: event.action,
    refs: [...event.artifactRefs, ...event.executionUnitRefs],
  }));
  const items = [...runtimeItems, ...alignmentItems, ...timeline.map((item) => ({ ...item, action: 'demo.timeline', refs: [] }))];
  const filtered = items.filter((item) => {
    if (actionFilter !== 'all' && item.action !== actionFilter) return false;
    if (!query.trim()) return true;
    const normalized = query.trim().toLowerCase();
    return [item.title, item.desc, item.scenario, item.action, ...(item.refs ?? [])].some((value) => String(value).toLowerCase().includes(normalized));
  });
  const actions = ['all', ...Array.from(new Set(items.map((item) => item.action)))];
  function exportFilteredBranch() {
    exportJsonFile(`bioagent-timeline-${actionFilter}-${new Date().toISOString().slice(0, 10)}.json`, {
      schemaVersion: '1',
      exportedAt: nowIso(),
      query,
      actionFilter,
      eventCount: filtered.length,
      events: filtered,
    });
  }
  return (
    <main className="page">
      <div className="page-heading">
        <h1>研究时间线</h1>
        <p>聊天、工具、证据和执行单元最终都沉淀为可审计的研究记录。</p>
      </div>
      <div className="library-controls">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 run、artifact、package、scenario..." aria-label="搜索 Timeline" />
        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} aria-label="按事件类型过滤">
          {actions.map((action) => <option key={action} value={action}>{action === 'all' ? '全部事件' : action}</option>)}
        </select>
        <button type="button" onClick={exportFilteredBranch}>导出当前分支</button>
      </div>
      <div className="timeline-list">
        {filtered.map((item) => {
          const scenario = scenarios.find((entry) => entry.id === item.scenario) ?? scenarios[0];
          return (
            <Card className="timeline-card" key={`${item.time}-${item.title}`}>
              <div className="timeline-dot" style={{ background: scenario.color }} />
              <div>
                <div className="timeline-meta">
                  <span>{item.time}</span>
                  <Badge variant="info">{scenario.name}</Badge>
                  <ClaimTag type={item.claimType} />
                  <ConfidenceBar value={item.confidence} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <div className="scenario-builder-actions">
                  <button onClick={() => onOpenScenario(item.scenario)}>回到场景</button>
                  {item.refs?.slice(0, 3).map((ref) => <code key={ref}>{ref}</code>)}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {!filtered.length ? <EmptyArtifactState title="没有匹配的时间线事件" detail="运行任务、发布 package、handoff artifact 或保存契约后，会在这里形成可过滤记录。" /> : null}
    </main>
  );
}

function handoffAutoRunPrompt(targetScenario: ScenarioId, artifact: RuntimeArtifact, sourceScenarioName: string, targetScenarioName: string): string {
  const focus = artifactFocusTerm(artifact);
  if (targetScenario === 'literature-evidence-review' && focus) {
    return `${focus} clinical trials，返回 paper-list JSON artifact、claims、ExecutionUnit。`;
  }
  if (targetScenario === 'structure-exploration' && focus) {
    return `分析 ${focus} 的结构，返回 structure-summary artifact、dataRef、质量指标和 ExecutionUnit。`;
  }
  if (targetScenario === 'biomedical-knowledge-graph' && focus) {
    return `${focus} gene/protein knowledge graph，返回 knowledge-graph、来源链接、数据库访问日期和 ExecutionUnit。`;
  }
  return [
    `消费 handoff artifact ${artifact.id} (${artifact.type})。`,
    `来源 Scenario: ${sourceScenarioName}。`,
    `请按${targetScenarioName}的 input contract 生成下一步 claims、ExecutionUnit、UIManifest 和 runtime artifact。`,
  ].join('\n');
}

function artifactFocusTerm(artifact: RuntimeArtifact): string | undefined {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.entity)
    || asString(metadata.accession)
    || asString(metadata.uniprotAccession)
    || asString(data.uniprotId)
    || asString(data.pdbId)
    || rowValue(data.rows, 'entity')
    || rowValue(data.rows, 'uniprot_accession')
    || nodeId(data.nodes, ['gene', 'protein']);
}

function rowValue(value: unknown, key: string): string | undefined {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = rows.find((row) => asString(row.key)?.toLowerCase() === key.toLowerCase());
  return asString(found?.value);
}

function nodeId(value: unknown, preferredTypes: string[]): string | undefined {
  const nodes = Array.isArray(value) ? value.filter(isRecord) : [];
  const found = nodes.find((node) => {
    const type = asString(node.type)?.toLowerCase();
    return type ? preferredTypes.includes(type) : false;
  }) ?? nodes[0];
  return asString(found?.id) || asString(found?.label);
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
      persistWorkspaceState(workspaceState, config)
        .then(() => setWorkspaceStatus(`已同步到 ${workspaceState.workspacePath}/.bioagent`))
        .catch((err) => setWorkspaceStatus(`Workspace writer 未连接：${err instanceof Error ? err.message : String(err)}`));
    }
  }, [workspaceState, config, workspaceHydrated]);

  useEffect(() => {
    if (!configFileHydrated) return;
    saveBioAgentConfig(config);
    saveFileBackedBioAgentConfig(config)
      .then(() => setWorkspaceStatus('已保存到 config.local.json'))
      .catch((err) => setWorkspaceStatus(`config.local.json 未保存：${err instanceof Error ? err.message : String(err)}`));
  }, [config, configFileHydrated]);

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
              onEditMessage={editMessage}
              onDeleteMessage={deleteMessage}
              archivedCount={archivedCountByAgent[scenarioId] ?? 0}
              onArtifactHandoff={handleArtifactHandoff}
              autoRunRequest={handoffAutoRun}
              onAutoRunConsumed={consumeHandoffAutoRun}
              scenarioOverride={activeScenarioOverride}
              onScenarioOverrideChange={applyScenarioOverride}
              onTimelineEvent={appendTimelineEvent}
              onMarkReusableRun={markReusableRun}
            />
          ) : page === 'alignment' ? (
            <AlignmentPage contracts={workspaceState.alignmentContracts ?? []} onSaveContract={saveAlignmentContract} />
          ) : (
            <TimelinePage alignmentContracts={workspaceState.alignmentContracts ?? []} events={workspaceState.timelineEvents ?? []} onOpenScenario={(id) => {
              setScenarioId(id);
              setPage('workbench');
            }} />
          )}
        </div>
      </div>
      {settingsOpen ? (
        <SettingsDialog
          config={config}
          onChange={updateRuntimeConfig}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
