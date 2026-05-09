import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, Download, FilePlus, FileUp, Play, RefreshCw, Settings, Shield, Sparkles, Target, Trash2 } from 'lucide-react';
import { stats, type PageId, type ScenarioId } from '../data';
import { compileScenarioDraft, type ScenarioBuilderDraft } from '../scenarioCompiler/scenarioDraftCompiler';
import { buildBuiltInScenarioPackage, type ScenarioPackage } from '../scenarioCompiler/scenarioPackage';
import type { ScenarioLibraryItem } from '../scenarioCompiler/scenarioLibrary';
import type { SciForgeConfig, SciForgeWorkspaceState, ScenarioInstanceId, ScenarioRuntimeOverride } from '../domain';
import {
  acceptSkillPromotionProposal,
  archiveSkillPromotionProposal,
  archiveWorkspaceScenario,
  deleteWorkspaceScenario,
  listSkillPromotionProposals,
  loadScenarioLibrary,
  loadWorkspaceScenario,
  rejectSkillPromotionProposal,
  restoreWorkspaceScenario,
  saveWorkspaceScenario,
  validateAcceptedSkillPromotionProposal,
  type SkillPromotionProposalRecord,
  type SkillPromotionValidationResult,
} from '../api/workspaceClient';
import { scenarioPackageToOverride } from './ScenarioBuilderPanel';
import { exportJsonFile } from './exportUtils';
import { RuntimeHealthPanel, useRuntimeHealth } from './runtimeHealthPanel';
import { ActionButton, Badge, Card, ChartLoadingFallback, IconButton, SectionHeader } from './uiPrimitives';
import {
  buildDashboardLibraryItems,
  buildPackageRunStats,
  compileScenarioPackageForDraft,
  filterScenarioLibraryItems,
  packageManifestPreview,
  parseScenarioPackageJson,
  renameScenarioPackageForImport,
  scenarioInstanceIdForDraft,
  type DashboardLibraryItem,
  type PackageRunStats,
} from './appShell/dashboardModels';

const ActivityAreaChart = lazy(async () => ({ default: (await import('../charts')).ActivityAreaChart }));

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

export function Dashboard({
  setPage,
  setScenarioId,
  config,
  workspaceState,
  onApplyScenarioDraft,
  onWorkbenchPrompt,
}: {
  setPage: (page: PageId) => void;
  setScenarioId: (id: ScenarioInstanceId) => void;
  config: SciForgeConfig;
  workspaceState: SciForgeWorkspaceState;
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
  const [librarySort, setLibrarySort] = useState('usage');
  const [exportPreviewPackage, setExportPreviewPackage] = useState<ScenarioPackage | undefined>();
  const [expandedLibraryItemId, setExpandedLibraryItemId] = useState<string | undefined>();
  const [libraryDetailPackages, setLibraryDetailPackages] = useState<Record<string, ScenarioPackage>>({});
  const [skillProposals, setSkillProposals] = useState<SkillPromotionProposalRecord[]>([]);
  const [skillProposalStatus, setSkillProposalStatus] = useState('');
  const [skillProposalValidations, setSkillProposalValidations] = useState<Record<string, SkillPromotionValidationResult>>({});
  const packageImportInputRef = useRef<HTMLInputElement>(null);
  const importedPackageIds = useMemo(() => new Set(libraryItems.map((item) => item.id)), [libraryItems]);
  const combinedLibraryItems = useMemo<DashboardLibraryItem[]>(() => buildDashboardLibraryItems(libraryItems), [libraryItems]);
  const packageRunStatsById = useMemo(() => buildPackageRunStats(workspaceState), [workspaceState]);
  const filteredCombinedLibraryItems = useMemo(() => filterScenarioLibraryItems(combinedLibraryItems, {
    query: libraryQuery,
    status: libraryStatusFilter,
    source: librarySourceFilter,
    domain: libraryDomainFilter,
    sort: librarySort,
    runStatsById: packageRunStatsById,
  }), [combinedLibraryItems, libraryQuery, libraryStatusFilter, librarySourceFilter, libraryDomainFilter, librarySort, packageRunStatsById]);
  const healthItems = useRuntimeHealth(config, libraryItems.length);
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
    setSkillProposalStatus(`已接受 ${id}，安装到 .sciforge/evolved-skills/${manifest.id}。`);
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
    await rejectSkillPromotionProposal(config, id, 'Rejected from SciForge dashboard review.');
    await refreshSkillProposals();
    setSkillProposalStatus(`已拒绝 ${id}，不会进入 evolved skills。`);
  }

  async function archiveSkillProposalFromDashboard(id: string) {
    await archiveSkillPromotionProposal(config, id, 'Archived from SciForge dashboard review.');
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
    setLibraryStatus('已归档：该 package 会从默认排序中降级并保留恢复入口；如确认不再需要，可使用删除永久移除。');
  }

  async function deleteWorkspaceScenarioFromLibrary(id: string) {
    const confirmed = window.confirm(`永久删除 Scenario package ${id}？删除后无法从 Scenario Library 恢复。`);
    if (!confirmed) return;
    await deleteWorkspaceScenario(config, id);
    await refreshScenarioLibrary();
    setLibraryStatus(`已删除 ${id}。`);
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
          subtitle="按综合等级优先展示常用、高质量、最近成功的场景；归档保留可恢复记录，删除会永久移除 workspace package"
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
            <option value="usage">综合等级</option>
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
                    {item.imported ? <ActionButton icon={Trash2} variant="ghost" onClick={() => void deleteWorkspaceScenarioFromLibrary(item.id)}>删除</ActionButton> : null}
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
      <SectionHeader title="Skill Proposals" subtitle=".sciforge/skill-proposals → .sciforge/evolved-skills" action={<ActionButton icon={RefreshCw} variant="secondary" onClick={onRefresh}>刷新</ActionButton>} />
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
