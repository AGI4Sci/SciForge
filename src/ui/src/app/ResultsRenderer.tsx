import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Download, Eye, FileCode, FileText, Lock, Save, Shield, Sparkles, Target, X } from 'lucide-react';
import { scenarios, type EvidenceLevel, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { elementRegistry } from '../scenarioCompiler/elementRegistry';
import { compileSlotsForScenario } from '../scenarioCompiler/uiPlanCompiler';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../exportPolicy';
import { runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { openWorkspaceObject, readWorkspaceFile, writeWorkspaceFile, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry, type PresentationDedupeScope, type RuntimeUIModule } from '../uiModuleRegistry';
import type { VolcanoPoint } from '../charts';
import { HeatmapViewer, MoleculeViewer, NetworkGraph, UmapViewer } from '../visualizations';
import { exportJsonFile, exportTextFile } from './exportUtils';
import { objectReferenceKindLabel } from './ChatPanel';
import { ActionButton, Badge, Card, ChartLoadingFallback, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, SectionHeader, TabBar, cx } from './uiPrimitives';
import type { BioAgentConfig, BioAgentReference, BioAgentRun, BioAgentSession, DisplayIntent, EvidenceClaim, NotebookRecord, ObjectAction, ObjectReference, ResolvedViewPlan, RuntimeArtifact, RuntimeExecutionUnit, ScenarioInstanceId, UIManifestSlot, ViewPlanSection } from '../domain';

const VolcanoChart = lazy(async () => ({ default: (await import('../charts')).VolcanoChart }));

function isBuiltInScenarioId(value: string): value is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIO_SPECS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const normalizedRef = ref.replace(/^artifact:\/\//, '').replace(/^artifact:/, '');
  return session.artifacts.find((artifact) => artifact.id === ref
    || artifact.id === normalizedRef
    || artifact.dataRef === ref
    || artifact.dataRef === normalizedRef
    || artifact.type === ref
    || artifact.type === normalizedRef
    || Object.values(artifact.metadata ?? {}).some((value) => value === ref));
}

function artifactForObjectReference(reference: ObjectReference, session: BioAgentSession): RuntimeArtifact | undefined {
  if (reference.kind !== 'artifact') return undefined;
  return findArtifact(session, reference.ref)
    ?? findArtifact(session, reference.artifactType)
    ?? session.artifacts.find((artifact) => artifact.id === reference.id || artifact.type === reference.artifactType);
}

function pathForObjectReference(reference: ObjectReference, session: BioAgentSession): string | undefined {
  const artifact = artifactForObjectReference(reference, session);
  if (artifact) {
    return artifact.path
      || asString(artifact.metadata?.path)
      || asString(artifact.metadata?.filePath)
      || asString(artifact.metadata?.localPath)
      || asString(artifact.dataRef)
      || reference.provenance?.path
      || reference.provenance?.dataRef;
  }
  if (reference.kind === 'file' || reference.kind === 'folder') return reference.ref.replace(/^(file|folder):/i, '');
  return reference.provenance?.path || reference.provenance?.dataRef;
}

function syntheticArtifactForObjectReference(reference: ObjectReference, scenarioId: ScenarioInstanceId): RuntimeArtifact | undefined {
  if (reference.kind !== 'file' && reference.kind !== 'folder' && reference.kind !== 'url') return undefined;
  const path = reference.ref.replace(/^(file|folder|url):/i, '');
  return {
    id: reference.id,
    type: reference.kind === 'url' ? 'external-url' : artifactTypeForPath(path, reference.kind),
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: {
      title: reference.title,
      objectReferenceId: reference.id,
      path: reference.kind === 'url' ? undefined : path,
      url: reference.kind === 'url' ? path : undefined,
      synthetic: true,
    },
    path: reference.kind === 'url' ? undefined : path,
    dataRef: reference.kind === 'url' || reference.kind === 'file' ? path : undefined,
    data: {
      title: reference.title,
      ref: reference.ref,
      summary: reference.summary,
      path: reference.kind === 'url' ? undefined : path,
      url: reference.kind === 'url' ? path : undefined,
    },
  };
}

function artifactTypeForPath(path: string, kind: ObjectReference['kind']) {
  if (kind === 'folder') return 'workspace-folder';
  if (/\.md$/i.test(path)) return 'research-report';
  if (/\.pdf$/i.test(path)) return 'pdf-document';
  if (/\.(docx?|rtf)$/i.test(path)) return 'word-document';
  if (/\.(pptx?|key)$/i.test(path)) return 'slide-deck';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image';
  if (/\.(csv|tsv|xlsx?)$/i.test(path)) return 'data-table';
  if (/\.(pdb|cif|mmcif)$/i.test(path)) return 'structure-summary';
  if (/\.html?$/i.test(path)) return 'html-document';
  return 'workspace-file';
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

function formatResultFileBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ResultPaneWorkspaceFileEditor({
  state,
  config,
  onChange,
  onClose,
}: {
  state: { file: WorkspaceFileContent; draft: string };
  config: BioAgentConfig;
  onChange: (next: { file: WorkspaceFileContent; draft: string }) => void;
  onClose: () => void;
}) {
  const dirty = state.draft !== state.file.content;
  const [saveError, setSaveError] = useState('');
  async function save() {
    try {
      setSaveError('');
      const file = await writeWorkspaceFile(state.file.path, state.draft, config);
      onChange({ file, draft: file.content });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div className="workspace-preview result-workspace-file-editor" aria-label="工作区文件">
      <div className="workspace-preview-head">
        <span>
          <FileText size={13} />
          <strong title={state.file.path}>{state.file.name}</strong>
          {dirty ? <Badge variant="warning">未保存</Badge> : <Badge variant="success">已保存</Badge>}
        </span>
        <div>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(state.file.path)} title="复制路径" aria-label="复制路径">
            <Copy size={13} />
          </button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(state.draft)} title="复制内容" aria-label="复制内容">
            <Copy size={13} />
          </button>
          <button type="button" onClick={() => void save()} disabled={!dirty} title="保存文件" aria-label="保存文件">
            <Save size={13} />
          </button>
          <button type="button" onClick={onClose} title="关闭文件视图" aria-label="关闭文件视图">
            <X size={13} />
          </button>
        </div>
      </div>
      {saveError ? <div className="object-action-error">{saveError}</div> : null}
      <textarea
        value={state.draft}
        spellCheck={false}
        onChange={(event) => {
          const draft = event.target.value;
          onChange({ file: state.file, draft });
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void save();
          }
        }}
        aria-label={`${state.file.name} 文件内容`}
      />
      <div className="workspace-preview-meta">
        <code>{state.file.language}</code>
        <span>{formatResultFileBytes(state.file.size)}</span>
        {state.file.modifiedAt ? <span>{new Date(state.file.modifiedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
      </div>
    </div>
  );
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
  workspaceFileEditor,
  onWorkspaceFileEditorChange,
}: {
  scenarioId: ScenarioId;
  config: BioAgentConfig;
  session: BioAgentSession;
  defaultSlots: UIManifestSlot[];
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeRunId?: string;
  onActiveRunChange: (runId: string | undefined) => void;
  focusedObjectReference?: ObjectReference;
  onFocusedObjectChange: (reference: ObjectReference | undefined) => void;
  workspaceFileEditor: { file: WorkspaceFileContent; draft: string } | null;
  onWorkspaceFileEditorChange: (next: { file: WorkspaceFileContent; draft: string } | null) => void;
}) {
  const [resultTab, setResultTab] = useState('primary');
  const [focusMode, setFocusMode] = useState<ResultFocusMode>('all');
  const [inspectedArtifact, setInspectedArtifact] = useState<RuntimeArtifact | undefined>();
  const [pinnedObjectReferences, setPinnedObjectReferences] = useState<ObjectReference[]>([]);
  const [objectActionError, setObjectActionError] = useState('');
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  const viewPlan = useMemo(() => resolveViewPlan({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences,
  }), [scenarioId, session, defaultSlots, activeRun, focusedObjectReference, pinnedObjectReferences]);
  const tabs = [
    { id: 'primary', label: '结果视图' },
    { id: 'evidence', label: '证据矩阵' },
    { id: 'execution', label: 'ExecutionUnit' },
    { id: 'ui-design', label: 'UI设计' },
    { id: 'notebook', label: '研究记录' },
  ];
  const focusModes: Array<{ id: ResultFocusMode; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'visual', label: '只看图' },
    { id: 'evidence', label: '只看证据' },
    { id: 'execution', label: '只看执行单元' },
  ];
  const handleObjectAction = async (reference: ObjectReference, action: ObjectAction) => {
    setObjectActionError('');
    if (action === 'focus-right-pane') {
      onFocusedObjectChange(reference);
      if (reference.runId) onActiveRunChange(reference.runId);
      setResultTab('primary');
      return;
    }
    if (action === 'inspect') {
      const artifact = artifactForObjectReference(reference, session);
      if (artifact) {
        setInspectedArtifact(artifact);
      } else {
        setObjectActionError(`无法解析 artifact：${reference.ref}`);
      }
      return;
    }
    if (action === 'pin' || action === 'compare') {
      setPinnedObjectReferences((current) => current.some((item) => item.id === reference.id)
        ? current.filter((item) => item.id !== reference.id)
        : [...current, reference].slice(-4));
      onFocusedObjectChange(reference);
      setResultTab('primary');
      return;
    }
    if (action === 'copy-path') {
      const path = pathForObjectReference(reference, session);
      if (!path) {
        setObjectActionError(`没有可复制路径：${reference.title}`);
        return;
      }
      await navigator.clipboard?.writeText(path);
      return;
    }
    if (action === 'open-external' || action === 'reveal-in-folder') {
      const path = pathForObjectReference(reference, session);
      if (!path) {
        setObjectActionError(`没有可打开路径：${reference.title}`);
        return;
      }
      try {
        await openWorkspaceObject(config, action, path);
      } catch (error) {
        setObjectActionError(error instanceof Error ? error.message : String(error));
      }
    }
  };

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
            {workspaceFileEditor ? (
              <ResultPaneWorkspaceFileEditor
                state={workspaceFileEditor}
                config={config}
                onChange={onWorkspaceFileEditorChange}
                onClose={() => onWorkspaceFileEditorChange(null)}
              />
            ) : null}
            {focusedObjectReference ? (
              <ObjectFocusBanner
                reference={focusedObjectReference}
                pinnedReferences={pinnedObjectReferences}
                actions={availableObjectActions(focusedObjectReference, session)}
                error={objectActionError}
                onAction={handleObjectAction}
                onClear={() => onFocusedObjectChange(undefined)}
              />
            ) : objectActionError ? (
              <div className="object-action-error">{objectActionError}</div>
            ) : null}
            {focusedObjectReference ? (
              <WorkspaceObjectPreview
                reference={focusedObjectReference}
                session={session}
                config={config}
              />
            ) : null}
            {resultTab === 'primary' ? (
              <PrimaryResult
                scenarioId={scenarioId}
                config={config}
                session={session}
                viewPlan={viewPlan}
                focusMode={focusMode}
                onArtifactHandoff={onArtifactHandoff}
                onInspectArtifact={setInspectedArtifact}
              />
            ) : resultTab === 'evidence' ? (
              <EvidenceMatrix claims={session.claims} />
            ) : resultTab === 'execution' ? (
              <ExecutionPanel session={session} executionUnits={session.executionUnits} />
            ) : resultTab === 'ui-design' ? (
              <UIDesignStudioPanel viewPlan={viewPlan} />
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

type RegistryRendererProps = {
  scenarioId: ScenarioId;
  config: BioAgentConfig;
  session: BioAgentSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
};

type RegistryEntry = {
  label: string;
  render: (props: RegistryRendererProps) => ReactNode;
};

type ResultFocusMode = 'all' | 'visual' | 'evidence' | 'execution';

type ViewPlanSource = 'object-focus' | 'display-intent' | 'runtime-manifest' | 'artifact-inferred' | 'default-plan' | 'fallback';
type ViewPlanBindingStatus = 'bound' | 'missing-artifact' | 'missing-fields' | 'fallback';

type ResolvedViewPlanItem = {
  id: string;
  slot: UIManifestSlot;
  module: RuntimeUIModule;
  artifact?: RuntimeArtifact;
  section: ViewPlanSection;
  source: ViewPlanSource;
  status: ViewPlanBindingStatus;
  reason?: string;
  missingFields?: string[];
};

type RuntimeResolvedViewPlan = Omit<ResolvedViewPlan, 'sections'> & {
  sections: Record<ViewPlanSection, ResolvedViewPlanItem[]>;
  allItems: ResolvedViewPlanItem[];
};

export interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioId;
  prompt: string;
}

function defaultSlotsForAgent(scenarioId: ScenarioId): UIManifestSlot[] {
  return compileSlotsForScenario(scenarioId);
}

function resolveViewPlan({
  scenarioId,
  session,
  defaultSlots,
  activeRun,
  focusedObjectReference,
  pinnedObjectReferences = [],
}: {
  scenarioId: ScenarioId;
  session: BioAgentSession;
  defaultSlots?: UIManifestSlot[];
  activeRun?: BioAgentRun;
  focusedObjectReference?: ObjectReference;
  pinnedObjectReferences?: ObjectReference[];
}): RuntimeResolvedViewPlan {
  const displayIntent = extractDisplayIntent(activeRun) ?? inferDisplayIntentFromArtifacts(session, activeRun);
  const runtimeSlots = session.runs.length && session.uiManifest.length ? session.uiManifest : [];
  const seedSlots = (runtimeSlots.length ? runtimeSlots : defaultSlots?.length ? defaultSlots : defaultSlotsForAgent(scenarioId))
    .slice()
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const diagnostics: string[] = [];
  const items: ResolvedViewPlanItem[] = [];
  const seen = new Set<string>();

  const addItem = (
    module: RuntimeUIModule,
    artifact: RuntimeArtifact | undefined,
    source: ViewPlanSource,
    overrides: Partial<UIManifestSlot> = {},
    reason?: string,
  ) => {
    const slot: UIManifestSlot = {
      componentId: overrides.componentId ?? module.componentId,
      title: overrides.title ?? module.title,
      artifactRef: overrides.artifactRef ?? artifact?.id,
      priority: overrides.priority ?? module.priority,
      props: overrides.props,
      encoding: overrides.encoding,
      layout: overrides.layout,
      selection: overrides.selection,
      sync: overrides.sync,
      transform: overrides.transform,
      compare: overrides.compare,
    };
    const validation = validateModuleBinding(module, artifact);
    const section = source === 'object-focus' ? 'primary' : sectionForModule(module, displayIntent, artifact);
    const id = `${section}-${module.moduleId}-${artifact?.id ?? slot.artifactRef ?? slot.componentId}`;
    if (seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      slot,
      module,
      artifact,
      section,
      source,
      status: validation.status,
      reason: reason ?? validation.reason,
      missingFields: validation.missingFields,
    });
  };

  for (const reference of [focusedObjectReference, ...pinnedObjectReferences].filter((item): item is ObjectReference => Boolean(item))) {
    const artifact = artifactForObjectReference(reference, session) ?? syntheticArtifactForObjectReference(reference, scenarioId);
    const module = moduleForObjectReference(reference, artifact) ?? (artifact ? findBestModuleForArtifact(artifact) : moduleById('generic-artifact-inspector'));
    if (module) {
      addItem(module, artifact, 'object-focus', {
        title: reference.title,
        artifactRef: artifact?.id ?? reference.ref,
        priority: -10,
      }, reference.summary || `object reference ${reference.ref}`);
    }
  }

  for (const moduleId of displayIntent.preferredModules ?? []) {
    const module = moduleById(moduleId);
    if (!module) {
      diagnostics.push(`UI module 未发布：${moduleId}`);
      continue;
    }
    addItem(module, findBestArtifactForModule(session.artifacts, module), 'display-intent');
  }

  for (const artifactType of displayIntent.requiredArtifactTypes ?? []) {
    const artifact = findBestArtifactForType(session.artifacts, artifactType);
    const module = findBestModuleForArtifactType(artifact?.type ?? artifactType, displayIntent.preferredModules);
    if (module) {
      addItem(module, artifact, 'display-intent', {}, artifact ? undefined : `等待 artifact type=${artifactType}`);
    } else {
      diagnostics.push(`没有已发布 UI module 可消费 artifact type=${artifactType}`);
    }
  }

  for (const artifact of session.artifacts.slice(0, 12)) {
    const module = findBestModuleForArtifact(artifact);
    if (module) addItem(module, artifact, 'artifact-inferred');
  }

  for (const slot of seedSlots) {
    const artifact = findArtifact(session, slot.artifactRef);
    const currentModule = uiModuleRegistry.find((module) => module.componentId === slot.componentId && moduleAcceptsArtifact(module, artifact?.type ?? slot.artifactRef));
    const replacementModule = artifact ? findBestModuleForArtifact(artifact) : uiModuleRegistry.find((module) => module.componentId === slot.componentId);
    const module = currentModule ?? replacementModule ?? moduleById('generic-artifact-inspector');
    if (!module) continue;
    if (artifact && slot.componentId !== module.componentId) {
      diagnostics.push(`${slot.componentId} -> ${artifact.type} 已改由 ${module.componentId} 渲染，避免组件/artifact 错配。`);
    }
    addItem(module, artifact, runtimeSlots.includes(slot) ? 'runtime-manifest' : 'default-plan', {
      ...slot,
      componentId: module.componentId,
      title: slot.title ?? module.title,
      artifactRef: artifact?.id ?? slot.artifactRef,
      priority: slot.priority ?? module.priority,
    });
  }

  if (session.claims.length || session.artifacts.some((artifact) => artifact.type === 'evidence-matrix')) {
    addItem(moduleById('evidence-matrix-panel') ?? uiModuleRegistry[3], undefined, 'fallback');
  }
  if (session.executionUnits.length) {
    addItem(moduleById('execution-provenance-table') ?? uiModuleRegistry[4], undefined, 'fallback');
  }

  const ordered = compactViewPlanItems(items, session).sort((left, right) => {
    const sectionDelta = sectionRank(left.section) - sectionRank(right.section);
    if (sectionDelta) return sectionDelta;
    return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
  });
  const sections: RuntimeResolvedViewPlan['sections'] = {
    primary: [],
    supporting: [],
    provenance: [],
    raw: [],
  };
  ordered.forEach((item) => sections[item.section].push(item));

  const blockedDesign = blockedDesignForIntent(displayIntent, session, ordered, activeRun);
  return {
    displayIntent,
    diagnostics,
    sections,
    allItems: ordered,
    blockedDesign,
  };
}

function extractDisplayIntent(activeRun?: BioAgentRun): DisplayIntent | undefined {
  const candidates = [
    activeRun?.raw,
    isRecord(activeRun?.raw) ? activeRun?.raw.displayIntent : undefined,
    parseMaybeJsonObject(activeRun?.response)?.displayIntent,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const primaryGoal = asString(candidate.primaryGoal) || asString(candidate.goal) || asString(candidate.title);
    if (!primaryGoal) continue;
    return {
      primaryGoal,
      requiredArtifactTypes: asStringList(candidate.requiredArtifactTypes),
      preferredModules: asStringList(candidate.preferredModules),
      fallbackAcceptable: asStringList(candidate.fallbackAcceptable),
      acceptanceCriteria: asStringList(candidate.acceptanceCriteria),
      source: 'agentserver',
    };
  }
  return undefined;
}

function inferDisplayIntentFromArtifacts(session: BioAgentSession, activeRun?: BioAgentRun): DisplayIntent {
  const artifactTypes = Array.from(new Set(session.artifacts.map((artifact) => artifact.type)));
  const text = `${activeRun?.prompt ?? ''}\n${activeRun?.response ?? ''}`.toLowerCase();
  const requiredArtifactTypes = prioritizeArtifactTypes(artifactTypes, text);
  const preferredModules = requiredArtifactTypes
    .map((artifactType) => findBestModuleForArtifactType(artifactType)?.moduleId)
    .filter((moduleId): moduleId is string => Boolean(moduleId));
  return {
    primaryGoal: activeRun?.prompt
      ? `展示当前 run 的核心结果：${activeRun.prompt.slice(0, 80)}`
      : '展示当前 session 的最新 runtime artifacts',
    requiredArtifactTypes,
    preferredModules: Array.from(new Set(preferredModules)),
    fallbackAcceptable: ['generic-data-table', 'generic-artifact-inspector'],
    acceptanceCriteria: ['primary result visible', 'artifact binding validated', 'fallback explains missing fields'],
    source: 'fallback-inference',
  };
}

function prioritizeArtifactTypes(artifactTypes: string[], text: string) {
  const ranked = [...artifactTypes].sort((left, right) => artifactTypePriority(right, text) - artifactTypePriority(left, text));
  return ranked.slice(0, 4);
}

function artifactTypePriority(type: string, text: string) {
  let score = 0;
  if (/structure|pdb|protein|molecule|蛋白|结构|3d/.test(type)) score += 60;
  if (/report|markdown|summary|报告|文档/.test(type)) score += 50;
  if (/evidence|claim|证据/.test(type)) score += 40;
  if (/paper|literature|文献/.test(type)) score += 30;
  if (/omics|expression|matrix|umap|heatmap|volcano|组学/.test(type)) score += 30;
  if (text.includes('pdb') || text.includes('结构') || text.includes('3d')) score += /structure|pdb|protein|3d/.test(type) ? 30 : 0;
  if (text.includes('markdown') || text.includes('报告')) score += /report|markdown/.test(type) ? 30 : 0;
  return score;
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function moduleById(moduleId: string) {
  return uiModuleRegistry.find((module) => module.moduleId === moduleId);
}

function moduleForObjectReference(reference: ObjectReference, artifact?: RuntimeArtifact) {
  if (reference.preferredView) {
    const preferred = uiModuleRegistry.find((module) => module.moduleId === reference.preferredView || module.componentId === reference.preferredView);
    if (preferred && (!artifact || moduleAcceptsArtifact(preferred, artifact.type))) return preferred;
  }
  if (artifact) return findBestModuleForArtifact(artifact);
  return moduleById('generic-artifact-inspector');
}

function moduleAcceptsArtifact(module: RuntimeUIModule, artifactType?: string) {
  if (!artifactType) return module.acceptsArtifactTypes.includes('*');
  return module.acceptsArtifactTypes.includes('*') || module.acceptsArtifactTypes.includes(artifactType);
}

function findBestModuleForArtifact(artifact: RuntimeArtifact) {
  return findBestModuleForArtifactType(artifact.type);
}

function findBestModuleForArtifactType(artifactType: string, preferredModules: string[] = []) {
  const preferred = preferredModules
    .map(moduleById)
    .find((module): module is RuntimeUIModule => Boolean(module && moduleAcceptsArtifact(module, artifactType)));
  if (preferred) return preferred;
  return uiModuleRegistry
    .filter((module) => module.componentId !== 'unknown-artifact-inspector' && moduleAcceptsArtifact(module, artifactType))
    .sort((left, right) => (left.priority ?? 99) - (right.priority ?? 99))[0]
    ?? moduleById('generic-artifact-inspector');
}

function findBestArtifactForModule(artifacts: RuntimeArtifact[], module: RuntimeUIModule) {
  return artifacts.find((artifact) => moduleAcceptsArtifact(module, artifact.type));
}

function findBestArtifactForType(artifacts: RuntimeArtifact[], artifactType: string) {
  return artifacts.find((artifact) => artifact.type === artifactType || artifact.id === artifactType)
    ?? artifacts.find((artifact) => artifactTypeMatches(artifact.type, artifactType));
}

function artifactTypeMatches(actualType: string, requestedType: string) {
  if (actualType === requestedType) return true;
  if (isStructureArtifactType(actualType) && isStructureArtifactType(requestedType)) return true;
  return false;
}

function isStructureArtifactType(type: string) {
  return /structure|pdb|protein|molecule|mmcif|cif|3d/i.test(type);
}

function validateModuleBinding(module: RuntimeUIModule, artifact?: RuntimeArtifact): { status: ViewPlanBindingStatus; reason?: string; missingFields?: string[] } {
  if (!artifact && ['evidence-matrix', 'execution-unit-table', 'notebook-timeline'].includes(module.componentId)) {
    return { status: 'bound' };
  }
  if (!artifact && !module.acceptsArtifactTypes.includes('*')) {
    return { status: 'missing-artifact', reason: `等待 ${module.acceptsArtifactTypes.join('/')} artifact` };
  }
  if (artifact && !moduleAcceptsArtifact(module, artifact.type)) {
    return { status: 'fallback', reason: `${module.moduleId} 不声明消费 ${artifact.type}` };
  }
  const missingFields = (module.requiredFields ?? []).filter((field) => !artifactHasField(artifact, field));
  const missingAny = (module.requiredAnyFields ?? []).filter((group) => !group.some((field) => artifactHasField(artifact, field)));
  if (missingFields.length || missingAny.length) {
    return {
      status: 'missing-fields',
      reason: 'artifact 缺少模块必需字段',
      missingFields: [...missingFields, ...missingAny.map((group) => group.join('|'))],
    };
  }
  return { status: 'bound' };
}

function artifactHasField(artifact: RuntimeArtifact | undefined, field: string) {
  if (!artifact) return false;
  if (field === 'dataRef' && artifact.dataRef) return true;
  if (field in artifact) return true;
  if (isRecord(artifact.metadata) && field in artifact.metadata) return true;
  const data = artifact.data;
  if (isRecord(data) && field in data) return true;
  if (field === 'rows' && Array.isArray(data)) return true;
  return false;
}

function sectionForModule(module: RuntimeUIModule, displayIntent: DisplayIntent, artifact?: RuntimeArtifact): ViewPlanSection {
  if (isPrimaryResultModule(module)) {
    if (artifact && displayIntent.requiredArtifactTypes?.includes(artifact.type)) return 'primary';
    if (displayIntent.preferredModules?.includes(module.moduleId)) return 'primary';
  }
  return module.defaultSection ?? 'supporting';
}

function isPrimaryResultModule(module: RuntimeUIModule) {
  return ['report-viewer', 'molecule-viewer', 'volcano-plot', 'heatmap-viewer', 'umap-viewer', 'network-graph'].includes(module.componentId);
}

function compactViewPlanItems(items: ResolvedViewPlanItem[], session: BioAgentSession) {
  const strongestByArtifact = new Map<string, ResolvedViewPlanItem>();
  const strongestByPresentationIdentity = new Map<string, ResolvedViewPlanItem>();
  for (const item of items) {
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    if (artifactKey) {
      const previous = strongestByArtifact.get(artifactKey);
      if (!previous || resultPresentationRank(item, previous) < 0) strongestByArtifact.set(artifactKey, item);
    }
    const presentationKey = presentationIdentityKey(item);
    if (presentationKey) {
      const previous = strongestByPresentationIdentity.get(presentationKey);
      if (!previous || presentationIdentityRank(item, previous) < 0) strongestByPresentationIdentity.set(presentationKey, item);
    }
  }
  return items.filter((item) => {
    if (item.status === 'missing-artifact' && item.section !== 'primary' && item.source !== 'display-intent') return false;
    if (item.module.componentId === 'execution-unit-table' && !session.executionUnits.length) return false;
    if (item.module.componentId === 'evidence-matrix' && !session.claims.length && !item.artifact) return false;
    if (item.module.componentId === 'notebook-timeline' && !session.notebook.length && !item.artifact) return false;
    if (item.module.componentId === 'unknown-artifact-inspector' && !item.artifact) return false;
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    const strongest = artifactKey ? strongestByArtifact.get(artifactKey) : undefined;
    if (strongest && strongest.id !== item.id && item.module.componentId === 'unknown-artifact-inspector') return false;
    if (strongest && strongest.id !== item.id && item.module.componentId === 'data-table' && strongest.status === 'bound') return false;
    const presentationKey = presentationIdentityKey(item);
    const strongestPresentation = presentationKey ? strongestByPresentationIdentity.get(presentationKey) : undefined;
    if (strongestPresentation && strongestPresentation.id !== item.id && isPresentationDedupeEnabled(item.module)) return false;
    return true;
  });
}

function isPresentationDedupeEnabled(module: RuntimeUIModule) {
  return (module.presentation?.dedupeScope ?? 'entity') !== 'none';
}

function presentationIdentityKey(item: ResolvedViewPlanItem) {
  if (!item.artifact || item.status === 'missing-artifact' || !isPresentationDedupeEnabled(item.module)) return undefined;
  const scope = item.module.presentation?.dedupeScope ?? 'entity';
  const identity = artifactPresentationIdentity(item.artifact, item.module, scope);
  return identity ? `${item.module.componentId}:${scope}:${identity}` : undefined;
}

function artifactPresentationIdentity(
  artifact: RuntimeArtifact,
  module: RuntimeUIModule,
  scope: PresentationDedupeScope,
) {
  const fields = module.presentation?.identityFields?.length
    ? module.presentation.identityFields
    : defaultPresentationIdentityFields;
  const semanticIdentity = artifactSemanticIdentity(artifact, fields, scope);
  if (semanticIdentity) return `semantic:${semanticIdentity}`;
  const provenanceIdentity = artifactProvenanceIdentity(artifact);
  if (provenanceIdentity) return `provenance:${provenanceIdentity}`;
  return undefined;
}

const defaultPresentationIdentityFields = [
  'presentationKey',
  'resultKey',
  'displayKey',
  'semanticKey',
  'entityKey',
  'entityId',
  'entity_id',
  'targetId',
  'target_id',
  'subjectId',
  'subject_id',
  'accession',
  'accessionId',
  'accession_id',
  'gene',
  'symbol',
  'compoundId',
  'compound_id',
  'datasetId',
  'dataset_id',
  'reportId',
  'report_id',
  'documentId',
  'document_id',
  'paperId',
  'paper_id',
  'doi',
  'url',
  'dataRef',
  'outputRef',
  'resultRef',
];

function artifactSemanticIdentity(
  artifact: RuntimeArtifact,
  fields: string[],
  scope: PresentationDedupeScope,
) {
  const data = artifact.data;
  const records = [
    artifact.metadata,
    artifactRecordForIdentity(artifact),
    isRecord(data) ? data : undefined,
    scope === 'entity' ? firstPayloadRecordForIdentity(data) : undefined,
  ];
  for (const record of records) {
    const identity = identityFromRecord(record, fields);
    if (identity) return identity;
  }
  return undefined;
}

function artifactRecordForIdentity(artifact: RuntimeArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    dataRef: artifact.dataRef,
    path: artifact.path,
  };
}

function firstPayloadRecordForIdentity(data: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(data)) return toRecordList(data)[0];
  if (!isRecord(data)) return undefined;
  for (const key of ['selected', 'primary', 'item', 'record', 'data', 'structures', 'rows', 'items', 'results', 'records']) {
    const value = data[key];
    if (isRecord(value)) return value;
    const first = toRecordList(value)[0];
    if (first) return first;
  }
  return undefined;
}

function identityFromRecord(record: Record<string, unknown> | undefined, fields: string[]) {
  if (!record) return undefined;
  const canonicalFields = new Set(fields.map(canonicalPresentationIdentityField));
  for (const field of fields) {
    const value = asString(record[field]);
    const normalized = normalizePresentationIdentity(value);
    if (normalized) return `${canonicalPresentationIdentityField(field)}:${normalized}`;
  }
  for (const [field, rawValue] of Object.entries(record)) {
    const canonicalField = canonicalPresentationIdentityField(field);
    if (!canonicalFields.has(canonicalField)) continue;
    const normalized = normalizePresentationIdentity(asString(rawValue));
    if (normalized) return `${canonicalField}:${normalized}`;
  }
  return undefined;
}

function canonicalPresentationIdentityField(field: string) {
  return field.trim().toLowerCase().replace(/[_\-\s]+/g, '');
}

function artifactProvenanceIdentity(artifact: RuntimeArtifact) {
  const metadata = artifact.metadata ?? {};
  const values = [
    artifact.dataRef,
    artifact.path,
    asString(metadata.outputRef),
    asString(metadata.resultRef),
    asString(metadata.dataRef),
    asString(metadata.path),
    asString(metadata.runId),
    asString(metadata.agentServerRunId),
    asString(metadata.provenanceRef),
  ];
  return values.map(normalizePresentationIdentity).find(Boolean);
}

function normalizePresentationIdentity(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'unknown' || normalized === 'none' || normalized === 'null' || normalized === 'undefined') return undefined;
  return normalized.replace(/\s+/g, ' ');
}

function presentationIdentityRank(left: ResolvedViewPlanItem, right: ResolvedViewPlanItem) {
  const statusDelta = resultStatusRank(left.status) - resultStatusRank(right.status);
  if (statusDelta) return statusDelta;
  const payloadDelta = artifactPresentationPayloadRank(left.artifact) - artifactPresentationPayloadRank(right.artifact);
  if (payloadDelta) return payloadDelta;
  const sourceDelta = viewPlanSourceRank(left.source) - viewPlanSourceRank(right.source);
  if (sourceDelta) return sourceDelta;
  const sectionDelta = sectionRank(left.section) - sectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

function artifactPresentationPayloadRank(artifact?: RuntimeArtifact) {
  if (!artifact) return 50;
  const type = artifact.type.toLowerCase();
  if (/(interactive|viewer|html|3d|image|figure|plot|chart|report|document|markdown)/i.test(type)) return 0;
  if (/(file|coordinate|matrix|graph|network|table|dataset|dataframe|csv|tsv|json)/i.test(type)) return 1;
  if (/(summary|profile|annotation|metadata)/i.test(type)) return 2;
  if (/(list|collection|index|search-result)/i.test(type)) return 6;
  if (artifact.dataRef || artifact.path) return 3;
  return 8;
}

function viewPlanSourceRank(source: ViewPlanSource) {
  if (source === 'object-focus') return -1;
  if (source === 'display-intent') return 0;
  if (source === 'runtime-manifest') return 1;
  if (source === 'artifact-inferred') return 2;
  if (source === 'default-plan') return 3;
  return 4;
}

function sectionRank(section: ViewPlanSection) {
  if (section === 'primary') return 0;
  if (section === 'supporting') return 1;
  if (section === 'provenance') return 2;
  return 3;
}

function blockedDesignForIntent(
  displayIntent: DisplayIntent,
  session: BioAgentSession,
  items: ResolvedViewPlanItem[],
  activeRun?: BioAgentRun,
) {
  const requiredTypes = displayIntent.requiredArtifactTypes ?? [];
  const unsupportedType = requiredTypes.find((artifactType) => {
    const artifact = findBestArtifactForType(session.artifacts, artifactType);
    if (!artifact) return false;
    const specialized = uiModuleRegistry.find((module) => module.componentId !== 'unknown-artifact-inspector' && moduleAcceptsArtifact(module, artifact.type));
    return !specialized;
  });
  const primaryBound = items.some((item) => item.section === 'primary' && item.status === 'bound');
  if (!unsupportedType && (primaryBound || !requiredTypes.length)) return undefined;
  if (unsupportedType) {
    return {
      reason: `没有已发布 UI module 可作为主视图渲染 artifact type=${unsupportedType}`,
      requiredModuleCapability: `render ${unsupportedType} as primary result`,
      resumeRunId: activeRun?.id,
    };
  }
  return undefined;
}

function itemsForFocusMode(plan: RuntimeResolvedViewPlan, focusMode: ResultFocusMode) {
  const sections = focusMode === 'evidence'
    ? ['supporting'] as ViewPlanSection[]
    : focusMode === 'execution'
      ? ['provenance'] as ViewPlanSection[]
      : ['primary', 'supporting', 'provenance', 'raw'] as ViewPlanSection[];
  return sections.flatMap((section) => plan.sections[section])
    .filter((item) => itemMatchesFocusMode(item, focusMode));
}

function itemMatchesFocusMode(item: ResolvedViewPlanItem, focusMode: ResultFocusMode) {
  if (focusMode === 'all') return true;
  if (focusMode === 'evidence') return item.module.componentId === 'evidence-matrix' || item.artifact?.type === 'evidence-matrix';
  if (focusMode === 'execution') return item.module.componentId === 'execution-unit-table' || item.section === 'provenance';
  return ['molecule-viewer', 'volcano-plot', 'heatmap-viewer', 'umap-viewer', 'network-graph', 'report-viewer'].includes(item.module.componentId);
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
  const structureRows = Array.isArray(artifact?.data)
    ? toRecordList(artifact?.data)
    : toRecordList(payload.structures ?? payload.data ?? payload.rows ?? payload.items);
  const primaryStructure = structureRows[0] ?? {};
  const artifactPath = artifactFilePath(artifact, payload);
  const dataRef = asString(payload.structureUrl) || asString(artifact?.dataRef) || asString(payload.dataRef) || artifactPath;
  const pdbId = asString(payload.pdbId)
    || asString(payload.pdb_id)
    || asString(payload.pdb)
    || asString(artifact?.metadata?.pdbId)
    || asString(artifact?.metadata?.pdb_id)
    || asString(primaryStructure.pdbId)
    || asString(primaryStructure.pdb_id)
    || asString(primaryStructure.pdb)
    || inferPdbIdFromStructureRef(dataRef);
  const uniprotId = asString(payload.uniprotId);
  const ligand = asString(payload.ligand) || 'none';
  const residues = asStringList(payload.highlightResidues ?? payload.residues);
  const metrics = isRecord(payload.metrics) ? payload.metrics : payload;
  const coordinateRef = isFetchableStructureRef(dataRef) ? dataRef : undefined;
  const html = asString(payload.html) || asString(payload.structureHtml) || asString(payload.iframeHtml);
  const htmlRef = asString(payload.htmlRef) || asString(payload.structureHtmlRef)
    || (artifactPath && /\.html?($|[?#])/i.test(artifactPath) ? artifactPath : undefined)
    || (dataRef && (/\.html?($|[?#])/i.test(dataRef) || dataRef.startsWith('data:text/html')) ? dataRef : undefined);
  const canPreviewHtml = Boolean(html || htmlRef?.startsWith('data:text/html') || /^https?:\/\//i.test(htmlRef ?? ''));
  const isHtmlStructure = Boolean(canPreviewHtml || /html/i.test(artifact?.type ?? ''));
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
  if (!artifact || (!pdbId && !uniprotId && !coordinateRef && !html && !htmlRef && !atoms.length && !structureRows.length)) {
    return <ComponentEmptyState componentId="molecule-viewer" artifactType="structure-summary" detail={!artifact ? undefined : '当前 structure artifact 缺少 pdbId、uniprotId、dataRef 或 HTML 结构视图；请补齐 accession/坐标/HTML ref。'} />;
  }
  return (
    <div className="stack">
      <ArtifactSourceBar artifact={artifact} session={session} />
      <div className="slot-meta">
        <Badge variant="success">{artifactMeta(artifact)}</Badge>
        <code>{uniprotId ? `UniProt=${uniprotId}` : `PDB=${pdbId || 'unknown'}`}</code>
        <code>ligand={ligand}</code>
        {dataRef ? <code title={dataRef}>dataRef={compactParams(dataRef)}</code> : <code>record-only structure</code>}
        {!coordinateRef && pdbId ? <code>coordinates=RCSB</code> : null}
        {structureRows.length ? <code>{structureRows.length} structures</code> : null}
        {residues.length ? <code>residues={residues.join(',')}</code> : null}
        {slot.encoding?.highlightSelection ? <code>highlightSelection={Array.isArray(slot.encoding.highlightSelection) ? slot.encoding.highlightSelection.join(',') : slot.encoding.highlightSelection}</code> : null}
      </div>
      {isHtmlStructure && canPreviewHtml ? (
        <StructureHtmlPreview html={html} htmlRef={htmlRef} />
      ) : coordinateRef || pdbId || atoms.length ? (
        <div className="viz-card">
          <MoleculeViewer
            pdbId={pdbId || uniprotId}
            ligand={ligand}
            structureUrl={coordinateRef}
            highlightResidues={residues}
            pocketLabel={asString(payload.pocketLabel) || asString(payload.pocket) || asString(primaryStructure.title) || 'Structure view'}
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

function artifactFilePath(artifact: RuntimeArtifact | undefined, payload: Record<string, unknown>) {
  const artifactRecord = artifact as (RuntimeArtifact & Record<string, unknown>) | undefined;
  const metadata = artifact?.metadata ?? {};
  return asString(artifactRecord?.path)
    || asString(payload.path)
    || asString(payload.filePath)
    || asString(payload.localPath)
    || asString(payload.downloadedPath)
    || asString(metadata.path)
    || asString(metadata.filePath)
    || asString(metadata.localPath)
    || asString(metadata.downloadedPath);
}

function isFetchableStructureRef(ref?: string) {
  if (!ref) return false;
  if (/^agentserver:\/\//i.test(ref)) return false;
  if (/\.html?($|[?#])/i.test(ref)) return false;
  return /^https?:\/\//i.test(ref) || /^data:/i.test(ref);
}

function inferPdbIdFromStructureRef(ref?: string) {
  if (!ref) return undefined;
  let decoded = ref.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original ref when it is not URI-encoded.
  }
  const patterns = [
    /(?:^|[/_-])([0-9][A-Za-z0-9]{3})(?=\.(?:pdb|cif|mmcif)(?:$|[?#]))/i,
    /rcsb\.org\/(?:download|structure|entry)\/([0-9][A-Za-z0-9]{3})(?:$|[/?#.]|%)/i,
    /(?:pdb(?:id)?[=:_-])([0-9][A-Za-z0-9]{3})(?:$|[/?#._-])/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return undefined;
}

function StructureHtmlPreview({ html, htmlRef }: { html?: string; htmlRef?: string }) {
  const canEmbedRef = htmlRef?.startsWith('data:text/html') || /^https?:\/\//i.test(htmlRef ?? '');
  return (
    <div className="structure-html-preview">
      <div className="slot-meta">
        <Badge variant="info">sandboxed html structure</Badge>
        {htmlRef ? <code title={htmlRef}>htmlRef={compactParams(htmlRef)}</code> : null}
      </div>
      {html || canEmbedRef ? (
        <iframe
          title="Sandboxed structure HTML preview"
          sandbox="allow-scripts"
          src={canEmbedRef ? htmlRef : undefined}
          srcDoc={html}
        />
      ) : (
        <EmptyArtifactState
          title="结构 HTML 已生成但不能直接嵌入"
          detail="当前 dataRef 指向 workspace 文件；请通过 Artifact Inspector 查看路径，或让任务输出 data:text/html / structure-summary 坐标 artifact。"
          recoverActions={['inspect-artifact', 'repair-ui-plan', 'fallback-component:unknown-artifact-inspector']}
        />
      )}
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

function ReportViewerSlot({ slot, artifact, config }: RegistryRendererProps) {
  const payload = slotPayload(slot, artifact);
  const report = coerceReportPayload(payload, artifact);
  const [loadedReport, setLoadedReport] = useState<{ ref: string; markdown: string } | undefined>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const ref = report.reportRef;
    if (!ref || loadedReport?.ref === ref) return undefined;
    let cancelled = false;
    setLoadError('');
    void readWorkspaceFile(ref, config)
      .then((file) => {
        if (!cancelled) setLoadedReport({ ref, markdown: file.content });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [config, loadedReport?.ref, report.reportRef]);
  const markdown = loadedReport && loadedReport.ref === report.reportRef ? loadedReport.markdown : report.markdown;
  const sections = report.sections;
  if (!artifact || (!markdown && !sections.length)) {
    return <ComponentEmptyState componentId="report-viewer" artifactType="research-report" detail={!artifact ? undefined : '当前 research-report 缺少 markdown/report/sections 字段；请检查 AgentServer 生成的 artifact contract。'} />;
  }
  return (
    <div className="stack">
      <div className="report-viewer">
        <div className="report-actions">
          <button type="button" onClick={() => void navigator.clipboard?.writeText(markdown || sectionsToMarkdown(sections))}>
            复制 Markdown
          </button>
        </div>
        {report.reportRef && !loadedReport && !loadError ? (
          <p className="empty-state">正在读取 Markdown 报告正文：{report.reportRef}</p>
        ) : null}
        {loadError ? (
          <p className="empty-state">报告正文读取失败，已显示可用摘要：{loadError}</p>
        ) : null}
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

export function coerceReportPayload(payload: Record<string, unknown>, artifact?: RuntimeArtifact) {
  const nested = parseNestedReport(payload);
  const source = nested ?? payload;
  const sections = toRecordList(source.sections);
  const direct = firstString(source.markdown, source.report, source.summary, source.content);
  const extracted = extractUserFacingReport(direct);
  const reportRef = extracted.reportRef
    || reportRefFromPayload(source)
    || reportRefFromText(direct)
    || reportRefFromArtifact(artifact);
  const markdown = extracted.markdown
    || (!looksLikeBackendPayloadText(direct) ? direct : undefined)
    || (sections.length ? sectionsToMarkdown(sections) : undefined)
    || reportFromKnownFields(source)
    || markdownShellForReportRef(reportRef);
  return { markdown, sections, reportRef };
}

function markdownShellForReportRef(ref?: string) {
  if (!ref || !/\.md($|[?#])|markdown/i.test(ref)) return undefined;
  return [
    '# Markdown report',
    '',
    `报告内容已作为 workspace ref 生成：\`${ref}\`。`,
    '',
    '当前 artifact 没有内联 markdown 内容，因此结果区保留可读文档壳和可复现引用；如需全文预览，请让任务把 markdown 正文写入 `research-report.markdown` 或 `sections` 字段。',
  ].join('\n');
}

function extractUserFacingReport(text?: string): { markdown?: string; reportRef?: string } {
  if (!text) return {};
  const parsedPayloads = parseJsonPayloadsFromText(text);
  for (const payload of parsedPayloads) {
    const fromPayload = reportFromStructuredPayload(payload);
    if (fromPayload.markdown || fromPayload.reportRef) return fromPayload;
  }
  const reportRef = reportRefFromText(text);
  return {
    reportRef,
    markdown: looksLikeBackendPayloadText(text) ? markdownShellForReportRef(reportRef) : undefined,
  };
}

function reportFromStructuredPayload(payload: Record<string, unknown>): { markdown?: string; reportRef?: string } {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.filter(isRecord) : [];
  for (const artifact of artifacts) {
    const type = asString(artifact.type) || asString(artifact.id) || '';
    if (!/report|markdown|document|summary/i.test(type)) continue;
    const nested = isRecord(artifact.data) ? artifact.data : artifact;
    const markdown = reportMarkdownFromRecord(nested);
    const reportRef = reportRefFromPayload(nested) || reportRefFromPayload(artifact) || reportRefFromText(JSON.stringify(artifact));
    if (markdown || reportRef) return { markdown, reportRef };
  }
  const markdown = reportMarkdownFromRecord(payload);
  const reportRef = reportRefFromPayload(payload) || reportRefFromText(JSON.stringify(payload));
  if (markdown || reportRef) return { markdown, reportRef };
  const message = asString(payload.message);
  return {
    markdown: message && !looksLikeBackendPayloadText(message) ? message : undefined,
    reportRef,
  };
}

function reportMarkdownFromRecord(record: Record<string, unknown>): string | undefined {
  const sections = toRecordList(record.sections);
  const direct = firstString(record.markdown, record.report, record.content, record.summary);
  if (direct && !looksLikeBackendPayloadText(direct)) return direct;
  if (sections.length) return sectionsToMarkdown(sections);
  return undefined;
}

function parseJsonPayloadsFromText(text: string): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = parseJsonRecord(match[1]);
    if (parsed) payloads.push(parsed);
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const parsed = parseJsonRecord(text.slice(firstBrace, lastBrace + 1));
    if (parsed) payloads.push(parsed);
  }
  if (!payloads.length) {
    const messageMatch = text.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const message = messageMatch ? decodeJsonStringLiteral(messageMatch[1]) : undefined;
    const ref = reportRefFromText(text);
    if (message || ref) payloads.push({ message, reportRef: ref });
  }
  return payloads;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodeJsonStringLiteral(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function reportRefFromPayload(payload: Record<string, unknown>) {
  return firstString(payload.reportRef, payload.markdownRef, payload.dataRef, payload.path, payload.outputRef);
}

function reportRefFromArtifact(artifact?: RuntimeArtifact) {
  return artifact?.dataRef
    || asString(artifact?.metadata?.reportRef)
    || asString(artifact?.metadata?.markdownRef)
    || asString(artifact?.metadata?.dataRef)
    || asString(artifact?.metadata?.outputRef);
}

function reportRefFromText(text?: string) {
  if (!text) return undefined;
  return text.match(/(?:^|["'`\s(:：])((?:\.bioagent|workspace\/\.bioagent|\/[^"'`\s]+)[^"'`\s]*\.md)(?:$|["'`\s),，。])/i)?.[1]
    || text.match(/([\w./-]*report[\w./-]*\.md)/i)?.[1];
}

function looksLikeBackendPayloadText(text?: string) {
  if (!text) return false;
  return /```json|ToolPayload|Returning the existing result|Let me inspect|prior attempt|\"artifacts\"\s*:|\"uiManifest\"\s*:|\"executionUnits\"\s*:/i.test(text);
}

function firstString(...values: unknown[]) {
  return values.map(asString).find(Boolean);
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

function bioAgentReferenceAttribute(reference: BioAgentReference | undefined) {
  return reference ? JSON.stringify(reference) : undefined;
}

function referenceForArtifact(
  artifact: RuntimeArtifact,
  kind: BioAgentReference['kind'] = 'file-region',
): BioAgentReference {
  const title = String(artifact.metadata?.title || artifact.metadata?.name || artifact.path || artifact.dataRef || artifact.id || artifact.type).slice(0, 52);
  return {
    id: `ref-${kind}-${artifact.id}`,
    kind,
    title,
    ref: artifact.path && kind === 'file' ? `file:${artifact.path}` : `artifact:${artifact.id}`,
    sourceId: artifact.id,
    runId: asString(artifact.metadata?.runId) || asString(artifact.metadata?.agentServerRunId),
    summary: `${artifact.type}${artifact.path ? ` · ${artifact.path}` : ''}${artifact.dataRef ? ` · ${artifact.dataRef}` : ''}`,
    payload: {
      id: artifact.id,
      type: artifact.type,
      schemaVersion: artifact.schemaVersion,
      path: artifact.path,
      dataRef: artifact.dataRef,
      metadata: artifact.metadata,
      dataSummary: summarizeReferencePayload(artifact.data),
    },
  };
}

function referenceForResultSlot(item: ResolvedViewPlanItem): BioAgentReference {
  return {
    id: `ref-ui-slot-${item.id.replace(/[^a-z0-9]+/gi, '-').slice(0, 52)}`,
    kind: 'ui',
    title: item.slot.title || item.module.title,
    ref: `ui-module:${item.module.moduleId}`,
    sourceId: item.id,
    summary: `${item.section} · ${item.status}${item.reason ? ` · ${item.reason}` : ''}`,
    payload: {
      moduleId: item.module.moduleId,
      componentId: item.module.componentId,
      section: item.section,
      status: item.status,
      slot: item.slot,
      missingFields: item.missingFields,
    },
  };
}

function artifactReferenceKind(artifact: RuntimeArtifact, componentId = ''): BioAgentReference['kind'] {
  const haystack = `${artifact.type} ${artifact.id} ${componentId}`;
  if (artifact.path || artifact.dataRef || artifact.metadata?.filePath || artifact.metadata?.path) {
    if (/\.(pdf|docx?|pptx?|md|txt|png|jpe?g|csv|tsv|xlsx?|pdb|cif|html?)$/i.test(`${artifact.path ?? ''} ${artifact.dataRef ?? ''}`)) return 'file';
  }
  if (/chart|plot|graph|visual|pca|umap|volcano|heatmap|histogram|scatter|molecule|viewer/i.test(haystack)) return 'chart';
  if (/table|matrix|csv|tsv|dataframe|spreadsheet|gene-list|evidence/i.test(haystack) || rowCountForReference(artifact.data)) return 'table';
  return 'file-region';
}

function summarizeReferencePayload(data: unknown) {
  if (typeof data === 'string') return { valueType: 'string', preview: data.slice(0, 1000) };
  if (Array.isArray(data)) return { valueType: 'array', count: data.length, preview: data.slice(0, 5) };
  if (!isRecord(data)) return data === undefined ? undefined : { valueType: typeof data };
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  return {
    valueType: 'object',
    keys: Object.keys(data).slice(0, 16),
    rowCount: rows?.length,
    previewRows: rows?.slice(0, 5),
    markdownPreview: typeof data.markdown === 'string' ? data.markdown.slice(0, 1000) : undefined,
  };
}

function rowCountForReference(data: unknown) {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return undefined;
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  return rows?.length;
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
    <div className="artifact-source-bar" data-bioagent-reference={bioAgentReferenceAttribute(referenceForArtifact(artifact, artifactReferenceKind(artifact)))}>
      <Badge variant={sourceVariant(source)}>{source}</Badge>
      <code>{artifact.id}</code>
      <code>{artifact.type}</code>
      <code>schema={artifact.schemaVersion}</code>
      {artifact.path ? <code title={artifact.path}>path={compactParams(artifact.path)}</code> : null}
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
  config,
  session,
  viewPlan,
  focusMode,
  onArtifactHandoff,
  onInspectArtifact,
}: {
  scenarioId: ScenarioId;
  config: BioAgentConfig;
  session: BioAgentSession;
  viewPlan: RuntimeResolvedViewPlan;
  focusMode: ResultFocusMode;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
}) {
  const slotLimit = focusMode === 'visual' || focusMode === 'all' ? 8 : 4;
  const planItems = itemsForFocusMode(viewPlan, focusMode).slice(0, slotLimit);
  const { visibleItems, deferredItems } = selectDefaultResultItems(planItems, focusMode);
  return (
    <div className="stack">
      <SectionHeader icon={FileText} title="结果视图" subtitle="优先展示用户本轮要看的结果；更多内容默认收起" />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} /> : null}
      {!planItems.length ? (
        <EmptyArtifactState
          title={focusMode === 'all' ? '还没有可展示的关键结果' : '当前筛选没有匹配内容'}
          detail={focusMode === 'all'
            ? '发送请求后，这里只展示真实产物、当前 run 结果和被点选/引用的对象；空的系统模块会默认隐藏。'
            : '切回“全部”，或运行一个会生成对应 artifact 的任务。'}
        />
      ) : null}
      <ResultItemsSection
        title={focusMode === 'execution' ? '执行记录' : focusMode === 'evidence' ? '证据重点' : '核心结果'}
        items={visibleItems}
        scenarioId={scenarioId}
        config={config}
        session={session}
        onArtifactHandoff={onArtifactHandoff}
        onInspectArtifact={onInspectArtifact}
      />
      {deferredItems.length ? (
        <details className="result-details-panel">
          <summary>
            <span>更多结果</span>
            <Badge variant="muted">{deferredItems.length} hidden</Badge>
          </summary>
          {(['supporting', 'provenance', 'raw', 'primary'] as ViewPlanSection[]).map((section) => {
            const sectionItems = deferredItems.filter((item) => item.section === section);
            if (!sectionItems.length) return null;
            return (
              <ResultItemsSection
                key={section}
                title={viewPlanSectionLabel(section)}
                items={sectionItems}
                scenarioId={scenarioId}
                config={config}
                session={session}
                onArtifactHandoff={onArtifactHandoff}
                onInspectArtifact={onInspectArtifact}
              />
            );
          })}
        </details>
      ) : null}
      {viewPlan.allItems.length ? (
        <details className="result-details-panel subtle">
          <summary>
            <span>视图状态</span>
            <Badge variant="muted">{viewPlan.allItems.length} modules</Badge>
          </summary>
          <ViewPlanSummary viewPlan={viewPlan} />
        </details>
      ) : null}
    </div>
  );
}

function ViewPlanSummary({ viewPlan }: { viewPlan: RuntimeResolvedViewPlan }) {
  const boundCount = viewPlan.allItems.filter((item) => item.status === 'bound').length;
  const waitingCount = viewPlan.allItems.filter((item) => item.status === 'missing-artifact' || item.status === 'missing-fields').length;
  return (
    <div className="view-plan-summary">
      <div>
        <Badge variant={waitingCount ? 'warning' : 'success'}>{waitingCount ? 'partial result' : 'ready result'}</Badge>
        <strong>{viewPlan.displayIntent.primaryGoal}</strong>
        <span>{boundCount} 个结果可用{waitingCount ? `，${waitingCount} 个结果等待 artifact 或字段` : ''}</span>
      </div>
    </div>
  );
}

function UIDesignBlockerCard({ blocker }: { blocker: NonNullable<RuntimeResolvedViewPlan['blockedDesign']> }) {
  return (
    <div className="ui-design-blocker">
      <Badge variant="warning">blocked-awaiting-ui-design</Badge>
      <strong>需要先设计并发布一个 UI 模块</strong>
      <p>{blocker.reason}</p>
      <div className="slot-meta">
        <code>{blocker.requiredModuleCapability}</code>
        {blocker.resumeRunId ? <code>resumeRunId={blocker.resumeRunId}</code> : null}
      </div>
    </div>
  );
}

function ObjectFocusBanner({
  reference,
  pinnedReferences,
  actions,
  error,
  onAction,
  onClear,
}: {
  reference: ObjectReference;
  pinnedReferences: ObjectReference[];
  actions: ObjectAction[];
  error?: string;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
  onClear: () => void;
}) {
  return (
    <div className="object-focus-banner">
      <div>
        <Badge variant="info">{objectReferenceKindLabel(reference.kind)}</Badge>
        <strong>{reference.title}</strong>
        <span>{reference.summary || reference.ref}</span>
      </div>
      <div className="object-focus-actions">
        {actions.slice(0, 6).map((action) => (
          <button key={action} type="button" onClick={() => void onAction(reference, action)}>
            {objectActionLabel(action)}
          </button>
        ))}
        <button type="button" onClick={onClear}>清除</button>
      </div>
      {pinnedReferences.length ? (
        <div className="pinned-object-row">
          <span>pinned</span>
          {pinnedReferences.map((item) => <code key={item.id}>{item.title}</code>)}
        </div>
      ) : null}
      {error ? <p className="object-action-error">{error}</p> : null}
    </div>
  );
}

function WorkspaceObjectPreview({
  reference,
  session,
  config,
}: {
  reference: ObjectReference;
  session: BioAgentSession;
  config: BioAgentConfig;
}) {
  const path = pathForObjectReference(reference, session);
  const [file, setFile] = useState<WorkspaceFileContent | undefined>();
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setFile(undefined);
    setError('');
    if (!path || (reference.kind !== 'file' && reference.kind !== 'artifact') || /^https?:\/\//i.test(path)) return undefined;
    let cancelled = false;
    setLoadingPath(path);
    void readWorkspaceFile(path, config)
      .then((nextFile) => {
        if (!cancelled) setFile(nextFile);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoadingPath('');
      });
    return () => {
      cancelled = true;
    };
  }, [config, path, reference.kind]);

  if (reference.kind === 'url') {
    const url = reference.ref.replace(/^url:/i, '');
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">url</Badge>
          <strong>{reference.title}</strong>
        </div>
        <a href={url} target="_blank" rel="noreferrer">{url}</a>
      </div>
    );
  }
  if (reference.kind === 'folder') {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="info">folder</Badge>
          <strong>{path || reference.ref}</strong>
        </div>
        <p>这是一个 workspace 文件夹引用；可用“系统打开”或“打开文件夹”查看内容。</p>
      </div>
    );
  }
  if (reference.kind !== 'file' && reference.kind !== 'artifact') return null;
  if (!path) return null;
  if (loadingPath) {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="muted">loading</Badge>
          <strong>{loadingPath}</strong>
        </div>
        <p>正在读取 workspace 文件内容...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="workspace-object-preview">
        <div className="workspace-object-preview-head">
          <Badge variant="warning">preview</Badge>
          <strong>{path}</strong>
        </div>
        <p>无法内联预览：{error}</p>
      </div>
    );
  }
  if (!file) return null;
  return (
    <div className="workspace-object-preview">
      <div className="workspace-object-preview-head">
        <Badge variant="info">{file.language || fileKindForPath(file.path)}</Badge>
        <strong>{file.path}</strong>
        <span>{formatBytes(file.size)}</span>
      </div>
      <WorkspaceFileInlineViewer file={file} />
    </div>
  );
}

function WorkspaceFileInlineViewer({ file }: { file: WorkspaceFileContent }) {
  const kind = fileKindForPath(file.path, file.language);
  if (kind === 'markdown') return <MarkdownBlock markdown={file.content} />;
  if (kind === 'json') return <pre className="workspace-object-code">{formatJsonLike(file.content)}</pre>;
  if (kind === 'csv' || kind === 'tsv') return <DelimitedTextPreview content={file.content} delimiter={kind === 'tsv' ? '\t' : ','} />;
  if (kind === 'image') {
    return (
      <div className="workspace-object-media-note">
        图片文件已解析为 workspace 引用；若 workspace server 返回文本内容，则下方显示其元数据/编码预览。
        <pre className="workspace-object-code">{file.content.slice(0, 4000)}</pre>
      </div>
    );
  }
  if (kind === 'pdf') {
    return <p className="workspace-object-media-note">PDF 已作为可点击文件引用聚焦。可用“系统打开”查看完整 PDF，BioAgent 不会把二进制内容直接塞进聊天区。</p>;
  }
  if (kind === 'html') return <pre className="workspace-object-code">{file.content.slice(0, 12000)}</pre>;
  return <pre className="workspace-object-code">{file.content.slice(0, 12000)}</pre>;
}

function DelimitedTextPreview({ content, delimiter }: { content: string; delimiter: ',' | '\t' }) {
  const rows = content.split(/\r?\n/).filter(Boolean).slice(0, 12).map((line) => line.split(delimiter).slice(0, 8));
  if (!rows.length) return <p className="empty-state">表格文件为空。</p>;
  return (
    <div className="data-table-wrap compact">
      <table className="data-preview-table">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('|')}`}>
              {row.map((cell, cellIndex) => rowIndex === 0 ? (
                <th key={`${cellIndex}-${cell}`}>{cell}</th>
              ) : (
                <td key={`${cellIndex}-${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fileKindForPath(path: string, language = '') {
  const value = `${path} ${language}`.toLowerCase();
  if (/markdown|\.md\b|\.markdown\b/.test(value)) return 'markdown';
  if (/json|\.json\b/.test(value)) return 'json';
  if (/\.csv\b/.test(value)) return 'csv';
  if (/\.tsv\b/.test(value)) return 'tsv';
  if (/\.pdf\b/.test(value)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg)\b/.test(value)) return 'image';
  if (/html|\.html?\b/.test(value)) return 'html';
  return language || 'text';
}

function formatJsonLike(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content.slice(0, 12000);
  }
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${value || 0} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function objectActionLabel(action: ObjectAction) {
  if (action === 'focus-right-pane') return '聚焦';
  if (action === 'inspect') return '检查数据';
  if (action === 'open-external') return '系统打开';
  if (action === 'reveal-in-folder') return '打开文件夹';
  if (action === 'copy-path') return '复制路径';
  if (action === 'compare') return '对比';
  return 'Pin';
}

function availableObjectActions(reference: ObjectReference, session: BioAgentSession): ObjectAction[] {
  const declared: ObjectAction[] = reference.actions?.length ? reference.actions : ['focus-right-pane', 'pin'];
  const path = pathForObjectReference(reference, session);
  const hasWorkspacePath = Boolean(path && !/^https?:\/\//i.test(path) && !/^agentserver:\/\//i.test(path) && !/^data:/i.test(path));
  return declared.filter((action) => {
    if (action === 'open-external' || action === 'reveal-in-folder' || action === 'copy-path') return hasWorkspacePath;
    if (action === 'inspect') return reference.kind === 'artifact';
    return true;
  });
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
  return (
    <div className="stack">
      <SectionHeader icon={Sparkles} title="UI Design Studio" subtitle="先设计模块，运行期只组合和绑定已发布能力" />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} /> : (
        <div className="ui-design-blocker ready">
          <Badge variant="success">module match ready</Badge>
          <strong>当前展示需求可由已发布 UI modules 满足</strong>
          <p>Runtime View Planner 已完成模块匹配；如果用户提出新展示方式，可在这里沉淀为 View Preset 或新 UI Module。</p>
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

function viewPlanSectionLabel(section: ViewPlanSection) {
  if (section === 'primary') return '核心结果';
  if (section === 'supporting') return '支撑证据';
  if (section === 'provenance') return '执行记录';
  return '原始数据 / fallback';
}

function selectDefaultResultItems(items: ResolvedViewPlanItem[], focusMode: ResultFocusMode) {
  const sorted = [...items].sort(resultPresentationRank);
  if (focusMode === 'evidence' || focusMode === 'execution') {
    const visibleItems: ResolvedViewPlanItem[] = [];
    pushUniqueVisibleItems(visibleItems, sorted, 4);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    return {
      visibleItems,
      deferredItems: sorted.filter((item) => !visibleIds.has(item.id)),
    };
  }
  const primary = sorted.filter((item) => item.section === 'primary');
  const usefulPrimary = primary.filter((item) => item.status === 'bound' || item.status === 'missing-fields');
  const visibleItems: ResolvedViewPlanItem[] = [];
  pushUniqueVisibleItems(visibleItems, usefulPrimary.length ? usefulPrimary : primary, 2);
  if (visibleItems.length < 2) {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    pushUniqueVisibleItems(
      visibleItems,
      sorted.filter((item) => !visibleIds.has(item.id) && item.section === 'supporting' && item.status === 'bound'),
      2,
    );
  }
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  return {
    visibleItems,
    deferredItems: items.filter((item) => !visibleIds.has(item.id)),
  };
}

function pushUniqueVisibleItems(target: ResolvedViewPlanItem[], candidates: ResolvedViewPlanItem[], limit: number) {
  const visibleKeys = new Set(target.map(visiblePresentationGroupKey));
  for (const item of candidates) {
    if (target.length >= limit) break;
    const key = visiblePresentationGroupKey(item);
    if (visibleKeys.has(key)) continue;
    visibleKeys.add(key);
    target.push(item);
  }
}

function visiblePresentationGroupKey(item: ResolvedViewPlanItem) {
  return `${item.section}:${item.module.componentId}`;
}

function resultPresentationRank(left: ResolvedViewPlanItem, right: ResolvedViewPlanItem) {
  const sectionDelta = sectionRank(left.section) - sectionRank(right.section);
  if (sectionDelta) return sectionDelta;
  const statusDelta = resultStatusRank(left.status) - resultStatusRank(right.status);
  if (statusDelta) return statusDelta;
  const componentDelta = resultComponentRank(left.module.componentId) - resultComponentRank(right.module.componentId);
  if (componentDelta) return componentDelta;
  return (left.slot.priority ?? left.module.priority ?? 99) - (right.slot.priority ?? right.module.priority ?? 99);
}

function resultStatusRank(status: ResolvedViewPlanItem['status']) {
  if (status === 'bound') return 0;
  if (status === 'missing-fields') return 1;
  if (status === 'fallback') return 2;
  return 3;
}

function resultComponentRank(componentId: string) {
  const order = ['report-viewer', 'molecule-viewer', 'evidence-matrix', 'paper-card-list', 'network-graph', 'data-table', 'execution-unit-table', 'notebook-timeline', 'unknown-artifact-inspector'];
  const index = order.indexOf(componentId);
  return index === -1 ? 99 : index;
}

function ResultItemsSection({
  title,
  items,
  scenarioId,
  config,
  session,
  onArtifactHandoff,
  onInspectArtifact,
}: {
  title: string;
  items: ResolvedViewPlanItem[];
  scenarioId: ScenarioId;
  config: BioAgentConfig;
  session: BioAgentSession;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
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
          />
        ))}
      </div>
    </section>
  );
}

function DataPreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8);
  if (!rows.length || !columns.length) return <p className="empty-state">没有可展示 rows。</p>;
  return (
    <div className="data-preview-table">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{humanizeKey(column)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column}>{compactParams(formatCellValue(row[column]))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatCellValue).join(', ');
  if (isRecord(value)) return JSON.stringify(value);
  return '';
}

function RegistrySlot({
  scenarioId,
  config,
  session,
  item,
  onArtifactHandoff,
  onInspectArtifact,
}: {
  scenarioId: ScenarioId;
  config: BioAgentConfig;
  session: BioAgentSession;
  item: ResolvedViewPlanItem;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
}) {
  const [handoffPreviewTarget, setHandoffPreviewTarget] = useState<ScenarioId | undefined>();
  const { slot, module } = item;
  const artifact = item.artifact ?? findArtifact(session, slot.artifactRef);
  const entry = componentRegistry[slot.componentId];
  const handoffTargets = artifact ? handoffTargetsForArtifact(artifact, scenarioId) : [];
  if (!entry) {
    return (
      <Card
        className="registry-slot"
        data-bioagent-reference={bioAgentReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact)) : referenceForResultSlot(item))}
      >
        <SectionHeader icon={AlertTriangle} title={slot.title ?? '未注册组件'} subtitle={slot.componentId} />
        <p className="empty-state">Scenario 返回了未知 componentId。当前使用通用 inspector 展示 artifact、manifest 和日志引用。</p>
        {slot.artifactRef && !artifact ? <p className="empty-state">artifactRef 未找到：{slot.artifactRef}</p> : null}
        <UnknownArtifactInspector scenarioId={scenarioId} config={config} session={session} slot={slot} artifact={artifact} />
      </Card>
    );
  }
  return (
    <Card
      className={cx('registry-slot', item.section === 'primary' && 'primary-slot')}
      data-bioagent-reference={bioAgentReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact, slot.componentId)) : referenceForResultSlot(item))}
    >
      <SectionHeader icon={Target} title={slot.title ?? entry.label} subtitle={resultSlotSubtitle(item, artifact)} />
      {artifact ? (
        <div className="artifact-card-actions">
          <button type="button" onClick={() => onInspectArtifact(artifact)}>
            <Eye size={13} />
            查看数据
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
      {entry.render({ scenarioId, config, session, slot, artifact })}
    </Card>
  );
}

function resultSlotSubtitle(item: ResolvedViewPlanItem, artifact?: RuntimeArtifact) {
  if (artifact) return `${artifact.type} · ${artifact.id}`;
  if (item.status === 'missing-fields') return `数据字段不完整 · ${item.slot.artifactRef ?? item.module.componentId}`;
  if (item.status === 'missing-artifact') return `等待 ${item.slot.artifactRef ?? item.module.acceptsArtifactTypes[0] ?? 'artifact'}`;
  return item.module.title;
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

function ManifestDiagnostics({ items }: { items: ResolvedViewPlanItem[] }) {
  return (
    <div className="manifest-diagnostics">
      {items.map((item) => (
        <code key={item.id} title={item.reason ?? item.module.description}>
          {item.module.moduleId}{item.artifact ? ` -> ${item.artifact.type}` : ''}
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
  const rows = claims.map((claim, index) => ({
    id: `${claim.id || 'claim'}-${index}`,
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
                    {row.supportingRefs.map((ref, index) => <code key={`support-${row.id}-${ref}-${index}`}>+ {ref}</code>)}
                    {row.opposingRefs.map((ref, index) => <code key={`oppose-${row.id}-${ref}-${index}`}>- {ref}</code>)}
                    {row.dependencyRefs.map((ref, index) => <code key={`dependency-${row.id}-${ref}-${index}`}>depends-on {ref}</code>)}
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
        {filtered.map((item, index) => {
          const scenario = scenarios.find((entry) => entry.id === item.scenario) ?? scenarios[0];
          return (
            <Card className="timeline-card" key={`${item.id || item.title}-${item.time || index}-${index}`}>
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

export function handoffAutoRunPrompt(targetScenario: ScenarioId, artifact: RuntimeArtifact, sourceScenarioName: string, targetScenarioName: string): string {
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
