import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Download, Eye, FileCode, FileText, Lock, Save, Shield, Sparkles, Target, Terminal, Trash2, X } from 'lucide-react';
import { scenarios, type EvidenceLevel, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { elementRegistry } from '../scenarioCompiler/elementRegistry';
import { compileSlotsForScenario } from '../scenarioCompiler/uiPlanCompiler';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../exportPolicy';
import { artifactPreviewActions, objectReferenceKinds, previewDescriptorKinds, runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { openWorkspaceObject, readPreviewDerivative, readPreviewDescriptor, readWorkspaceFile, writeWorkspaceFile, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry, type PresentationDedupeScope, type RuntimeUIModule } from '../uiModuleRegistry';
import {
  renderGraphViewer,
  renderMatrixViewer,
  renderPointSetViewer,
  renderRecordTable,
  renderReportViewer,
  renderStructureViewer,
  type UIComponentRendererProps,
} from '../../../../packages/ui-components';
import {
  descriptorWithDiagnostic as packageDescriptorWithDiagnostic,
  mergePreviewDescriptors as packageMergePreviewDescriptors,
  normalizeArtifactPreviewDescriptor as packageNormalizeArtifactPreviewDescriptor,
  shouldHydratePreviewDescriptor as packageShouldHydratePreviewDescriptor,
} from '../../../../packages/artifact-preview';
import { exportJsonFile, exportTextFile } from './exportUtils';
import { ActionButton, Badge, Card, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, SectionHeader, TabBar, cx } from './uiPrimitives';
import type { SciForgeConfig, SciForgeReference, SciForgeRun, SciForgeSession, DisplayIntent, EvidenceClaim, NotebookRecord, ObjectAction, ObjectReference, PreviewDerivative, PreviewDescriptor, ResolvedViewPlan, RuntimeArtifact, RuntimeExecutionUnit, ScenarioInstanceId, UIManifestSlot, ViewPlanSection } from '../domain';
import {
  artifactForObjectReference,
  artifactReferenceKind as packageArtifactReferenceKind,
  availableObjectActions,
  sciForgeReferenceAttribute,
  findArtifact,
  objectReferenceKindLabel,
  pathForObjectReference,
  referenceForArtifact,
  referenceForObjectReference,
  referenceForResultSlotLike,
  referenceForWorkspaceFileLike,
  syntheticArtifactForObjectReference,
  withRegionLocator,
} from '../../../../packages/object-references';

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

function artifactMeta(artifact?: RuntimeArtifact) {
  if (!artifact) return 'empty';
  return `${artifact.type} · ${artifact.schemaVersion}`;
}

function artifactSource(artifact?: RuntimeArtifact): 'project-tool' | 'record-only' | 'empty' {
  if (!artifact) return 'empty';
  const mode = asString(artifact.metadata?.mode);
  const runner = asString(artifact.metadata?.runner);
  if (mode?.includes('record')) return 'record-only';
  if (runner?.includes('local-csv') || artifact.dataRef?.includes('.sciforge/omics/')) return 'project-tool';
  return 'project-tool';
}

function sourceVariant(source: ReturnType<typeof artifactSource>): 'success' | 'muted' | 'warning' {
  if (source === 'project-tool') return 'success';
  if (source === 'record-only') return 'warning';
  return 'muted';
}

function executionUnitForArtifact(session: SciForgeSession, artifact?: RuntimeArtifact): RuntimeExecutionUnit | undefined {
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
  const props = slot.props ?? {};
  if (!artifact) return props;
  const artifactRecord = artifact as RuntimeArtifact & Record<string, unknown>;
  const artifactData = isRecord(artifact.data) ? artifact.data : {};
  const nestedContent = isRecord(artifactRecord.content)
    ? artifactRecord.content
    : isRecord(artifactData.content)
      ? artifactData.content
      : {};
  return {
    ...props,
    ...artifactRecord,
    ...artifactData,
    ...nestedContent,
  };
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

function pickEvidenceLevel(value: unknown): EvidenceLevel {
  const levels: EvidenceLevel[] = ['meta', 'rct', 'cohort', 'case', 'experimental', 'review', 'database', 'preprint', 'prediction'];
  return levels.includes(value as EvidenceLevel) ? value as EvidenceLevel : 'prediction';
}

function compactParams(params: string) {
  return params.length > 128 ? `${params.slice(0, 125)}...` : params;
}

function exportExecutionBundle(session: SciForgeSession) {
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
  config: SciForgeConfig;
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
}) {
  const [resultTab, setResultTab] = useState('primary');
  const [focusMode, setFocusMode] = useState<ResultFocusMode>('all');
  const [inspectedArtifact, setInspectedArtifact] = useState<RuntimeArtifact | undefined>();
  const [pinnedObjectReferences, setPinnedObjectReferences] = useState<ObjectReference[]>([]);
  const [objectActionError, setObjectActionError] = useState('');
  const [objectActionNotice, setObjectActionNotice] = useState('');
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0];
  const activeRun = activeRunId ? session.runs.find((run) => run.id === activeRunId) : undefined;
  useEffect(() => {
    const handleInlineReferenceFocus = (event: Event) => {
      const reference = (event as CustomEvent<ObjectReference>).detail;
      if (!reference || typeof reference !== 'object') return;
      onFocusedObjectChange(reference);
      setResultTab('primary');
    };
    window.addEventListener('sciforge-focus-object-reference', handleInlineReferenceFocus);
    return () => window.removeEventListener('sciforge-focus-object-reference', handleInlineReferenceFocus);
  }, [onFocusedObjectChange]);
  useEffect(() => {
    const cleanup = hydrateInlineObjectReferenceButtons();
    return cleanup;
  }, [resultTab, session.artifacts, session.runs, focusedObjectReference]);
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
  ];
  const focusModes: Array<{ id: ResultFocusMode; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'visual', label: '只看图' },
    { id: 'evidence', label: '只看证据' },
    { id: 'execution', label: '只看执行单元' },
  ];
  const handleObjectAction = async (reference: ObjectReference, action: ObjectAction) => {
    setObjectActionError('');
    setObjectActionNotice('');
    if (action === 'focus-right-pane') {
      onFocusedObjectChange(reference);
      if (reference.runId) onActiveRunChange(reference.runId);
      setResultTab('primary');
      setObjectActionNotice('已聚焦到右侧结果。');
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
      setObjectActionNotice(action === 'compare' ? '已加入对比/固定列表。' : '已固定到结果区。');
      return;
    }
    if (action === 'copy-path') {
      const path = pathForObjectReference(reference, session);
      if (!path) {
        setObjectActionError(`没有可复制路径：${reference.title}`);
        return;
      }
      try {
        await writeClipboardText(path);
        setObjectActionNotice(`已复制路径：${path}`);
      } catch (error) {
        setObjectActionError(error instanceof Error ? error.message : String(error));
      }
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
        setObjectActionNotice(action === 'reveal-in-folder' ? '已请求在文件夹中显示。' : '已请求系统打开文件。');
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
                    if (mode.id === 'execution') setResultTab('primary');
                    if (mode.id === 'visual') setResultTab('primary');
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="result-content">
            {activeRun && !focusedObjectReference ? (
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
                notice={objectActionNotice}
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
                onPreviewPackageRequest={onPreviewPackageRequest}
              />
            ) : null}
            {resultTab === 'primary' ? (
              <PrimaryResult
                scenarioId={scenarioId}
                config={config}
                session={session}
                activeRun={activeRun}
                viewPlan={viewPlan}
                focusMode={focusMode}
                onArtifactHandoff={onArtifactHandoff}
                onInspectArtifact={setInspectedArtifact}
                onObjectReferenceFocus={onFocusedObjectChange}
                onDismissResultSlotPresentation={onDismissResultSlotPresentation}
              />
            ) : resultTab === 'evidence' ? (
              <EvidenceMatrix claims={session.claims} artifacts={session.artifacts} />
            ) : null}
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
  config: SciForgeConfig;
  session: SciForgeSession;
  slot: UIManifestSlot;
  artifact?: RuntimeArtifact;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
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

function filterHiddenResultSlots(items: ResolvedViewPlanItem[], session: SciForgeSession): ResolvedViewPlanItem[] {
  const hidden = session.hiddenResultSlotIds;
  if (!hidden?.length) return items;
  const drop = new Set(hidden);
  return items.filter((item) => !drop.has(item.id));
}

type RuntimeResolvedViewPlan = Omit<ResolvedViewPlan, 'sections'> & {
  sections: Record<ViewPlanSection, ResolvedViewPlanItem[]>;
  allItems: ResolvedViewPlanItem[];
};

export interface HandoffAutoRunRequest {
  id: string;
  targetScenario: ScenarioInstanceId;
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
  session: SciForgeSession;
  defaultSlots?: UIManifestSlot[];
  activeRun?: SciForgeRun;
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

function extractDisplayIntent(activeRun?: SciForgeRun): DisplayIntent | undefined {
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

function inferDisplayIntentFromArtifacts(session: SciForgeSession, activeRun?: SciForgeRun): DisplayIntent {
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
  return [
    'report-viewer',
    'structure-viewer',
    'molecule-viewer',
    'point-set-viewer',
    'volcano-plot',
    'umap-viewer',
    'matrix-viewer',
    'heatmap-viewer',
    'graph-viewer',
    'network-graph',
  ].includes(module.componentId);
}

function compactViewPlanItems(items: ResolvedViewPlanItem[], session: SciForgeSession) {
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
    if (item.module.componentId === 'evidence-matrix' && !session.claims.length && !uploadedEvidenceArtifacts(session.artifacts).length && !item.artifact) return false;
    if (item.module.componentId === 'notebook-timeline' && !session.notebook.length && !item.artifact) return false;
    if (item.module.componentId === 'unknown-artifact-inspector' && !item.artifact) return false;
    const artifactKey = item.artifact?.id ?? item.slot.artifactRef;
    const strongest = artifactKey ? strongestByArtifact.get(artifactKey) : undefined;
    if (strongest && strongest.id !== item.id && item.module.componentId === 'unknown-artifact-inspector') return false;
    if (strongest && strongest.id !== item.id && (item.module.componentId === 'record-table' || item.module.componentId === 'data-table') && strongest.status === 'bound') return false;
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
  session: SciForgeSession,
  items: ResolvedViewPlanItem[],
  activeRun?: SciForgeRun,
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
  return [
    'structure-viewer',
    'molecule-viewer',
    'point-set-viewer',
    'volcano-plot',
    'umap-viewer',
    'matrix-viewer',
    'heatmap-viewer',
    'graph-viewer',
    'network-graph',
    'report-viewer',
  ].includes(item.module.componentId);
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

function ReportViewerSlot({ slot, artifact, config, session, onObjectReferenceFocus }: RegistryRendererProps) {
  const payload = slotPayload(slot, artifact);
  const report = coerceReportPayload(payload, artifact, relatedArtifactsForReport(session, artifact));
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
          <details className="report-read-warning">
            <summary>外部报告正文暂不可读，已展示可用 artifacts 生成的摘要</summary>
            <p>{loadError}</p>
          </details>
        ) : null}
        {sections.length ? sections.map((section, index) => (
          <section key={`${asString(section.title) ?? 'section'}-${index}`}>
            <h3>{asString(section.title) || `Section ${index + 1}`}</h3>
            <MarkdownBlock markdown={asString(section.content) || asString(section.markdown) || recordToReadableText(section)} onObjectReferenceFocus={onObjectReferenceFocus} />
          </section>
        )) : <MarkdownBlock markdown={markdown} onObjectReferenceFocus={onObjectReferenceFocus} />}
      </div>
    </div>
  );
}

export function coerceReportPayload(payload: Record<string, unknown>, artifact?: RuntimeArtifact, relatedArtifacts: RuntimeArtifact[] = []) {
  const nested = parseNestedReport(payload);
  const source = nested ?? payload;
  const sections = toRecordList(source.sections);
  const direct = firstString(source.markdown, source.report, source.summary, source.content);
  const extracted = extractUserFacingReport(direct);
  const relatedMarkdown = reportFromRelatedArtifacts(relatedArtifacts, artifact);
  const extractedMarkdown = extracted.markdown && !isGeneratedReportShell(extracted.markdown) ? extracted.markdown : undefined;
  const reportRef = extracted.reportRef
    || reportRefFromPayload(source)
    || reportRefFromText(direct)
    || reportRefFromArtifact(artifact);
  const markdown = extractedMarkdown
    || (!looksLikeBackendPayloadText(direct) ? direct : undefined)
    || (sections.length ? sectionsToMarkdown(sections) : undefined)
    || reportFromKnownFields(source)
    || relatedMarkdown
    || extracted.markdown
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

function isGeneratedReportShell(markdown: string) {
  return /^# Markdown report\b/i.test(markdown) && /workspace ref|workspace 引用|artifact 没有内联 markdown/i.test(markdown);
}

function relatedArtifactsForReport(session: SciForgeSession, artifact?: RuntimeArtifact) {
  const runId = asString(artifact?.metadata?.runId) || asString(artifact?.metadata?.agentServerRunId) || asString(artifact?.metadata?.producerRunId);
  const candidates = session.artifacts.filter((item) => item.id !== artifact?.id);
  const sameRun = runId
    ? candidates.filter((item) => {
      const metadata = item.metadata ?? {};
      return asString(metadata.runId) === runId
        || asString(metadata.agentServerRunId) === runId
        || asString(metadata.producerRunId) === runId;
    })
    : [];
  return (sameRun.length ? sameRun : candidates).filter((item) => isReportSupportingArtifact(item)).slice(0, 8);
}

function isReportSupportingArtifact(artifact: RuntimeArtifact) {
  const haystack = `${artifact.id} ${artifact.type} ${artifact.path ?? ''} ${artifact.dataRef ?? ''}`;
  return /paper|literature|evidence|matrix|table|csv|summary|result|graph|timeline|notebook/i.test(haystack);
}

function reportFromRelatedArtifacts(artifacts: RuntimeArtifact[], primary?: RuntimeArtifact) {
  const sections: string[] = [];
  const title = asString(primary?.metadata?.title) || asString(primary?.metadata?.name) || 'Research Report';
  for (const artifact of artifacts) {
    const section = reportSectionForArtifact(artifact);
    if (section) sections.push(section);
  }
  if (!sections.length) return undefined;
  return [
    `# ${title}`,
    '',
    '以下内容由当前运行产生的结构化 artifacts 自动整理，便于直接阅读；原始 JSON 仍保留在对应 artifact 中。',
    '',
    ...sections,
  ].join('\n');
}

function reportSectionForArtifact(artifact: RuntimeArtifact) {
  const payload = isRecord(artifact.data) ? artifact.data : {};
  const label = asString(artifact.metadata?.title) || asString(artifact.metadata?.name) || humanizeKey(artifact.type || artifact.id);
  const papers = recordsFromArtifactPayload(payload, ['papers', 'items', 'records', 'rows']);
  if (/paper|literature/i.test(`${artifact.type} ${artifact.id}`) && papers.length) {
    return [
      `## ${label}`,
      '',
      ...papers.slice(0, 12).map((paper, index) => readablePaperBullet(paper, index)),
    ].join('\n');
  }
  const rows = recordsFromArtifactPayload(payload, ['rows', 'records', 'items', 'claims', 'entries']);
  if (rows.length) {
    return [
      `## ${label}`,
      '',
      markdownTable(rows.slice(0, 10)),
    ].join('\n');
  }
  const known = reportFromKnownFields(payload);
  if (known) return `## ${label}\n\n${known.replace(/^# .+\n\n?/, '')}`;
  const summary = firstString(payload.summary, payload.message, payload.description, artifact.dataRef, artifact.path);
  if (summary) return `## ${label}\n\n${summary}`;
  return undefined;
}

function recordsFromArtifactPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function readablePaperBullet(paper: Record<string, unknown>, index: number) {
  const title = firstString(paper.title, paper.name) || `Paper ${index + 1}`;
  const authors = readableList(paper.authors);
  const venue = firstString(paper.venue, paper.journal, paper.source, paper.publisher);
  const year = firstString(paper.year, paper.published, paper.date, paper.publishedAt);
  const url = firstString(paper.url, paper.doi, paper.arxivId, paper.id);
  const summary = firstString(paper.summary, paper.abstract, paper.reason, paper.relevance, paper.finding);
  const meta = [authors, venue, year, url].filter(Boolean).join(' · ');
  return [`${index + 1}. **${title}**${meta ? ` (${meta})` : ''}`, summary ? `   - ${summary}` : ''].filter(Boolean).join('\n');
}

function readableList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : asString((item as Record<string, unknown>)?.name)).filter(Boolean).slice(0, 4).join(', ');
  return asString(value);
}

function markdownTable(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 5);
  if (!columns.length) return rows.map((row) => `- ${recordToReadableText(row).replace(/\n+/g, '; ')}`).join('\n');
  const escapeCell = (value: unknown) => String(Array.isArray(value) ? value.join(', ') : isRecord(value) ? JSON.stringify(value) : value ?? '').replace(/\|/g, '\\|').slice(0, 220);
  return [
    `| ${columns.map(humanizeKey).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => escapeCell(row[column])).join(' | ')} |`),
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
  return text.match(/(?:^|["'`\s(:：])((?:\.sciforge|workspace\/\.sciforge|\/[^"'`\s]+)[^"'`\s]*\.md)(?:$|["'`\s),，。])/i)?.[1]
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

function MarkdownBlock({ markdown, onObjectReferenceFocus }: { markdown?: string; onObjectReferenceFocus?: (reference: ObjectReference) => void }) {
  const lines = (markdown || '').split('\n');
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  function flushList() {
    if (!list.length) return;
    nodes.push(<ul key={`list-${nodes.length}`}>{list.map((item, index) => <li key={index}>{inlineMarkdown(item, onObjectReferenceFocus)}</li>)}</ul>);
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
      nodes.push(level <= 2 ? <h3 key={index}>{inlineMarkdown(text, onObjectReferenceFocus)}</h3> : <h4 key={index}>{inlineMarkdown(text, onObjectReferenceFocus)}</h4>);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*]\s+/, ''));
      return;
    }
    flushList();
    nodes.push(<p key={index}>{inlineMarkdown(trimmed, onObjectReferenceFocus)}</p>);
  });
  flushList();
  return <div className="markdown-block">{nodes}</div>;
}

function inlineMarkdown(text: string, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{inlinePlainText(part.slice(2, -2), onObjectReferenceFocus)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) {
      const codeText = part.slice(1, -1);
      const reference = objectReferenceFromInlineRef(codeText);
      return reference ? inlineObjectReferenceButton(reference, index, onObjectReferenceFocus) : <code key={index}>{codeText}</code>;
    }
    return <span key={index}>{inlinePlainText(part, onObjectReferenceFocus)}</span>;
  });
}

function inlinePlainText(text: string, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  const parts = text.split(/((?:file|folder|artifact):[^\s\])}>,，。；;、|]+)/gi).filter(Boolean);
  return parts.map((part, index) => {
    const reference = objectReferenceFromInlineRef(part);
    if (!reference) return <span key={index}>{part}</span>;
    return inlineObjectReferenceButton(reference, index, onObjectReferenceFocus);
  });
}

function inlineObjectReferenceButton(reference: ObjectReference, key: string | number, onObjectReferenceFocus?: (reference: ObjectReference) => void): ReactNode {
  return (
    <button
      key={key}
      type="button"
      className="markdown-object-ref"
      title={reference.ref}
      onClick={() => focusInlineObjectReference(reference, onObjectReferenceFocus)}
    >
      {reference.title}
    </button>
  );
}

function hydrateInlineObjectReferenceButtons(root: ParentNode = document): () => void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent || '';
      if (!/(?:file|folder|artifact):/i.test(text)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest('button,a,textarea,input,script,style')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent || '';
    const parts = text.split(/((?:file|folder|artifact):[^\s\])}>,，。；;、|]+)/gi).filter(Boolean);
    if (parts.length < 2) continue;
    const fragment = document.createDocumentFragment();
    let changed = false;
    for (const part of parts) {
      const reference = objectReferenceFromInlineRef(part);
      if (!reference) {
        fragment.append(document.createTextNode(part));
        continue;
      }
      changed = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'markdown-object-ref';
      button.title = reference.ref;
      button.textContent = reference.title;
      button.addEventListener('click', () => focusInlineObjectReference(reference));
      fragment.append(button);
    }
    if (!changed || !node.parentNode) continue;
    node.parentNode.replaceChild(fragment, node);
  }
  return () => undefined;
}

function focusInlineObjectReference(reference: ObjectReference, onObjectReferenceFocus?: (reference: ObjectReference) => void) {
  if (onObjectReferenceFocus) {
    onObjectReferenceFocus(reference);
    return;
  }
  window.dispatchEvent(new CustomEvent('sciforge-focus-object-reference', { detail: reference }));
}

function objectReferenceFromInlineRef(rawRef: string): ObjectReference | undefined {
  const match = rawRef.match(/^(file|folder|artifact):(.+)$/i);
  if (!match) return undefined;
  const kind = match[1].toLowerCase() as 'file' | 'folder' | 'artifact';
  const value = match[2].trim();
  if (!value) return undefined;
  const title = inlineReferenceTitle(kind, value);
  const pathLike = kind === 'file' || kind === 'folder';
  return {
    id: `inline-${kind}-${value.replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 80)}`,
    kind,
    title,
    ref: `${kind}:${value}`,
    artifactType: kind === 'artifact' ? value : undefined,
    preferredView: /\.pdf(?:$|[?#])/i.test(value) ? 'pdf' : undefined,
    actions: pathLike ? ['focus-right-pane', 'open-external', 'reveal-in-folder', 'copy-path', 'pin'] : ['focus-right-pane', 'inspect', 'pin'],
    summary: value,
    provenance: pathLike ? { path: value } : undefined,
  };
}

function inlineReferenceTitle(kind: 'file' | 'folder' | 'artifact', value: string) {
  if (kind === 'artifact') return value.replace(/^artifact:/i, '');
  const clean = value.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).at(-1) || value;
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

function referenceForResultSlot(item: ResolvedViewPlanItem): SciForgeReference {
  return referenceForResultSlotLike(item);
}

function artifactReferenceKind(artifact: RuntimeArtifact, componentId = ''): SciForgeReference['kind'] {
  return packageArtifactReferenceKind(artifact, componentId, rowCountForReference(artifact.data));
}

function rowCountForReference(data: unknown) {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return undefined;
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  return rows?.length;
}

function ArtifactSourceBar({ artifact, session }: { artifact?: RuntimeArtifact; session?: SciForgeSession }) {
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
    <div className="artifact-source-bar" data-sciforge-reference={sciForgeReferenceAttribute(referenceForArtifact(artifact, artifactReferenceKind(artifact)))}>
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

function packageRendererProps(props: RegistryRendererProps): UIComponentRendererProps {
  return {
    slot: props.slot,
    artifact: props.artifact,
    session: props.session,
    config: props.config,
    helpers: {
      ArtifactSourceBar: ({ artifact, session }) => <ArtifactSourceBar artifact={artifact as RuntimeArtifact | undefined} session={session as SciForgeSession | undefined} />,
      ArtifactDownloads: ({ artifact }) => <ArtifactDownloads artifact={artifact as RuntimeArtifact | undefined} />,
      ComponentEmptyState,
      MarkdownBlock: (markdownProps) => <MarkdownBlock {...markdownProps} onObjectReferenceFocus={props.onObjectReferenceFocus} />,
      readWorkspaceFile: (ref: string) => readWorkspaceFile(ref, props.config),
    },
  };
}

function PackageReportViewer(props: UIComponentRendererProps) {
  return <>{renderReportViewer(props)}</>;
}

function PackageRecordTable(props: UIComponentRendererProps) {
  return <>{renderRecordTable(props)}</>;
}

function PackageGraphViewer(props: UIComponentRendererProps) {
  return <>{renderGraphViewer(props)}</>;
}

function PackagePointSetViewer(props: UIComponentRendererProps) {
  return <>{renderPointSetViewer(props)}</>;
}

function PackageMatrixViewer(props: UIComponentRendererProps) {
  return <>{renderMatrixViewer(props)}</>;
}

function PackageStructureViewer(props: UIComponentRendererProps) {
  return <>{renderStructureViewer(props)}</>;
}

const componentRegistry: Record<string, RegistryEntry> = {
  'report-viewer': { label: 'ReportViewer', render: (props) => <PackageReportViewer {...packageRendererProps(props)} /> },
  'paper-card-list': { label: 'PaperCardList', render: (props) => <PaperCardList {...props} /> },
  'structure-viewer': { label: 'StructureViewer', render: (props) => <PackageStructureViewer {...packageRendererProps(props)} /> },
  'molecule-viewer': { label: 'MoleculeViewer', render: (props) => <PackageStructureViewer {...packageRendererProps(props)} /> },
  'molecule-viewer-3d': { label: 'MoleculeViewer3D', render: (props) => <PackageStructureViewer {...packageRendererProps(props)} /> },
  'point-set-viewer': { label: 'PointSetViewer', render: (props) => <PackagePointSetViewer {...packageRendererProps(props)} /> },
  'volcano-plot': { label: 'VolcanoPlot', render: (props) => <PackagePointSetViewer {...packageRendererProps(props)} /> },
  'umap-viewer': { label: 'UmapViewer', render: (props) => <PackagePointSetViewer {...packageRendererProps(props)} /> },
  'matrix-viewer': { label: 'MatrixViewer', render: (props) => <PackageMatrixViewer {...packageRendererProps(props)} /> },
  'heatmap-viewer': { label: 'HeatmapViewer', render: (props) => <PackageMatrixViewer {...packageRendererProps(props)} /> },
  'graph-viewer': { label: 'GraphViewer', render: (props) => <PackageGraphViewer {...packageRendererProps(props)} /> },
  'network-graph': { label: 'NetworkGraph', render: (props) => <PackageGraphViewer {...packageRendererProps(props)} /> },
  'evidence-matrix': { label: 'EvidenceMatrix', render: ({ session }) => <EvidenceMatrix claims={session.claims} artifacts={session.artifacts} /> },
  'execution-unit-table': { label: 'ExecutionUnitTable', render: ({ session }) => <ExecutionPanel session={session} executionUnits={session.executionUnits} embedded /> },
  'notebook-timeline': { label: 'NotebookTimeline', render: ({ scenarioId, session }) => <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} /> },
  'record-table': { label: 'RecordTable', render: (props) => <PackageRecordTable {...packageRendererProps(props)} /> },
  'data-table': { label: 'DataTable', render: (props) => <PackageRecordTable {...packageRendererProps(props)} /> },
  'unknown-artifact-inspector': { label: 'UnknownArtifactInspector', render: (props) => <UnknownArtifactInspector {...props} /> },
};

export type WorkbenchSlotRenderProps = RegistryRendererProps;

export function renderRegisteredWorkbenchSlot(props: RegistryRendererProps): ReactNode {
  const entry = componentRegistry[props.slot.componentId];
  if (!entry) {
    return (
      <EmptyArtifactState
        title="未注册组件"
        detail={`componentId: ${props.slot.componentId}`}
      />
    );
  }
  return entry.render(props);
}

function PrimaryResult({
  scenarioId,
  config,
  session,
  activeRun,
  viewPlan,
  focusMode,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  focusMode: ResultFocusMode;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  const slotLimit = focusMode === 'visual' || focusMode === 'all' ? 8 : 4;
  const focusModeItems = itemsForFocusMode(viewPlan, focusMode);
  const visibleAfterDismiss = filterHiddenResultSlots(focusModeItems, session);
  const planItems = visibleAfterDismiss.slice(0, slotLimit);
  const dismissedAllInFilter = focusModeItems.length > 0 && visibleAfterDismiss.length === 0;
  const { visibleItems, deferredItems } = selectDefaultResultItems(planItems, focusMode);
  const auditOpen = shouldOpenRunAuditDetails(session, activeRun);
  return (
    <div className="stack">
      <SectionHeader icon={FileText} title="结果视图" subtitle="优先展示用户本轮要看的结果；更多内容默认收起" />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} /> : null}
      <RunStatusSummary session={session} activeRun={activeRun} />
      {!planItems.length ? (
        <EmptyArtifactState
          title={dismissedAllInFilter ? '当前筛选下的视图已全部从界面移除' : focusMode === 'all' ? '还没有可展示的关键结果' : '当前筛选没有匹配内容'}
          detail={dismissedAllInFilter
            ? '这是仅影响呈现的隐藏列表，artifact 与工作区文件未被删除。新开聊天会清空该列表。'
            : focusMode === 'all'
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
        onObjectReferenceFocus={onObjectReferenceFocus}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
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
                onObjectReferenceFocus={onObjectReferenceFocus}
                onDismissResultSlotPresentation={onDismissResultSlotPresentation}
              />
            );
          })}
        </details>
      ) : null}
      {auditOpen ? (
        <RunAuditDetails
          scenarioId={scenarioId}
          session={session}
          activeRun={activeRun}
          viewPlan={viewPlan}
          defaultOpen
        />
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

function RunStatusSummary({ session, activeRun }: { session: SciForgeSession; activeRun?: SciForgeRun }) {
  const failures = failedExecutionUnits(session, activeRun);
  const run = activeRun ?? session.runs.at(-1);
  const blockers = runAuditBlockers(session, activeRun);
  const recoverActions = runRecoverActions(session, activeRun).slice(0, 4);
  if (!failures.length && !blockers.length && !recoverActions.length && run?.status !== 'failed') return null;
  return (
    <Card className={cx('run-status-summary', failures.length || run?.status === 'failed' ? 'failed' : 'recoverable')}>
      <SectionHeader
        icon={AlertTriangle}
        title={failures.length || run?.status === 'failed' ? '运行需要处理' : '可恢复建议'}
        subtitle={run ? `${run.id} · ${run.status}` : '当前 session'}
      />
      {blockers.length ? (
        <div className="run-status-lines">
          {blockers.map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : null}
      {failures.map((unit) => (
        <div className="run-failure-card" key={unit.id}>
          <strong>{unit.id}</strong>
          <p>{unit.failureReason || unit.selfHealReason || unit.nextStep || '执行失败，详情已保留在运行审计中。'}</p>
          <div className="inspector-ref-list">
            {[unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef].filter(Boolean).map((ref) => <code key={ref}>{ref}</code>)}
          </div>
        </div>
      ))}
      {recoverActions.length ? (
        <div className="run-recover-actions">
          {recoverActions.map((action) => <code key={action}>{action}</code>)}
        </div>
      ) : null}
    </Card>
  );
}

function RunAuditDetails({
  scenarioId,
  session,
  activeRun,
  viewPlan,
  defaultOpen,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  defaultOpen?: boolean;
}) {
  const rawItems = rawAuditItems(session, activeRun, viewPlan);
  const failureCount = failedExecutionUnits(session, activeRun).length;
  return (
    <details className="result-details-panel audit-details-panel" open={defaultOpen}>
      <summary>
        <span>查看运行细节</span>
        <Badge variant={failureCount ? 'danger' : 'muted'}>
          {failureCount ? `${failureCount} failure` : `${session.executionUnits.length} EU`}
        </Badge>
      </summary>
      <RunAuditOverview session={session} activeRun={activeRun} />
      <ExecutionPanel session={session} executionUnits={session.executionUnits} embedded />
      <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} embedded />
      <Card className="code-card">
        <SectionHeader icon={Terminal} title="Raw JSON / stdout / stderr refs" />
        <div className="audit-raw-grid">
          {rawItems.map((item) => (
            <details key={item.id} className="audit-raw-item">
              <summary>{item.label}</summary>
              <pre className="inspector-json">{item.value}</pre>
            </details>
          ))}
        </div>
      </Card>
    </details>
  );
}

function RunAuditOverview({ session, activeRun }: { session: SciForgeSession; activeRun?: SciForgeRun }) {
  const blockers = runAuditBlockers(session, activeRun);
  const refs = runAuditRefs(session, activeRun);
  const recoverActions = runRecoverActions(session, activeRun);
  return (
    <Card className="audit-overview">
      <SectionHeader icon={Shield} title="审计摘要" subtitle="失败原因、恢复动作和可复现引用" />
      {blockers.length ? (
        <div className="run-status-lines">
          {blockers.map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : <p className="empty-state">没有阻塞项；完整执行单元、timeline 和 raw payload 已在下方保留。</p>}
      {recoverActions.length ? (
        <div className="run-recover-actions">
          {recoverActions.map((action) => <code key={action}>{action}</code>)}
        </div>
      ) : null}
      {refs.length ? (
        <div className="inspector-ref-list">
          {refs.map((ref) => <code key={ref}>{ref}</code>)}
        </div>
      ) : null}
    </Card>
  );
}

export function shouldOpenRunAuditDetails(session: SciForgeSession, activeRun?: SciForgeRun) {
  return Boolean((activeRun ?? session.runs.at(-1))?.status === 'failed' || failedExecutionUnits(session, activeRun).length);
}

function failedExecutionUnits(session: SciForgeSession, activeRun?: SciForgeRun) {
  const runRefs = new Set([activeRun?.id].filter((id): id is string => Boolean(id)));
  return session.executionUnits.filter((unit) => {
    const failed = unit.status === 'failed' || unit.status === 'failed-with-reason' || unit.status === 'repair-needed' || Boolean(unit.failureReason);
    if (!failed) return false;
    if (!runRefs.size) return true;
    return !unit.outputRef || Array.from(runRefs).some((runId) => unit.outputRef?.includes(runId));
  });
}

function runAuditBlockers(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  const lines = [
    run?.status === 'failed' ? `blocker: run ${run.id} failed` : undefined,
    asString(raw?.blocker) ? `blocker: ${asString(raw?.blocker)}` : undefined,
    asString(raw?.failureReason) ? `failureReason: ${asString(raw?.failureReason)}` : undefined,
    ...failedExecutionUnits(session, activeRun).map((unit) => `failureReason: ${unit.failureReason || unit.id}`),
  ].filter((line): line is string => Boolean(line));
  return Array.from(new Set(lines));
}

function runRecoverActions(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  return Array.from(new Set([
    ...asStringList(raw?.recoverActions),
    ...failedExecutionUnits(session, activeRun).flatMap((unit) => unit.recoverActions ?? []),
    ...session.executionUnits.flatMap((unit) => unit.status === 'repair-needed' ? unit.recoverActions ?? [] : []),
  ]));
}

function runAuditRefs(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  return Array.from(new Set([
    ...asStringList(raw?.refs),
    ...asStringList(raw?.auditRefs),
    ...(run?.references ?? []).map((ref) => ref.ref),
    ...session.executionUnits.flatMap((unit) => [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef]).filter((ref): ref is string => Boolean(ref)),
  ]));
}

function rawAuditItems(session: SciForgeSession, activeRun: SciForgeRun | undefined, viewPlan: RuntimeResolvedViewPlan) {
  const run = activeRun ?? session.runs.at(-1);
  return [
    run ? { id: `run-${run.id}`, label: `run ${run.id}`, value: JSON.stringify(run.raw ?? run, null, 2) } : undefined,
    session.artifacts.length ? { id: 'artifacts', label: `artifacts (${session.artifacts.length})`, value: JSON.stringify(session.artifacts, null, 2) } : undefined,
    session.executionUnits.length ? { id: 'execution-units', label: `ExecutionUnit JSON (${session.executionUnits.length})`, value: JSON.stringify(session.executionUnits, null, 2) } : undefined,
    session.notebook.length ? { id: 'notebook', label: `timeline JSON (${session.notebook.length})`, value: JSON.stringify(session.notebook, null, 2) } : undefined,
    viewPlan.allItems.length ? { id: 'view-plan', label: `resolved view plan (${viewPlan.allItems.length})`, value: JSON.stringify(viewPlan.allItems, null, 2) } : undefined,
  ].filter((item): item is { id: string; label: string; value: string } => Boolean(item));
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
  notice,
  onAction,
  onClear,
}: {
  reference: ObjectReference;
  pinnedReferences: ObjectReference[];
  actions: ObjectAction[];
  error?: string;
  notice?: string;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
  onClear: () => void;
}) {
  const visibleActions = actions.filter((action) => action !== 'focus-right-pane');
  return (
    <div className="object-focus-banner">
      <div>
        <Badge variant="info">{objectReferenceKindLabel(reference.kind)}</Badge>
        <strong>{reference.title}</strong>
        <span>{reference.summary || reference.ref}</span>
      </div>
      <div className="object-focus-actions">
        {visibleActions.slice(0, 6).map((action) => (
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
      {notice ? <p className="object-action-notice">{notice}</p> : null}
      {error ? <p className="object-action-error">{error}</p> : null}
    </div>
  );
}

function WorkspaceObjectPreview({
  reference,
  session,
  config,
  onPreviewPackageRequest,
}: {
  reference: ObjectReference;
  session: SciForgeSession;
  config: SciForgeConfig;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
}) {
  const artifact = artifactForObjectReference(reference, session);
  const inlinePreview = useMemo(() => uploadedArtifactPreview(artifact), [artifact]);
  const path = pathForObjectReference(reference, session);
  const [descriptor, setDescriptor] = useState<PreviewDescriptor | undefined>();
  const [file, setFile] = useState<WorkspaceFileContent | undefined>();
  const [loadingPath, setLoadingPath] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setFile(undefined);
    setDescriptor(undefined);
    setError('');
    if (inlinePreview) return undefined;
    if (!path || (reference.kind !== 'file' && reference.kind !== 'artifact') || /^https?:\/\//i.test(path)) return undefined;
    let cancelled = false;
    setLoadingPath(path);
    const staticDescriptor = packageNormalizeArtifactPreviewDescriptor(artifact, path);
    if (staticDescriptor) {
      setDescriptor(staticDescriptor);
      if (!packageShouldHydratePreviewDescriptor(staticDescriptor, path)) {
        setLoadingPath('');
        return () => {
          cancelled = true;
        };
      }
    }
    void readPreviewDescriptor(path, config)
      .then((nextDescriptor) => {
        if (!cancelled) setDescriptor(staticDescriptor ? packageMergePreviewDescriptors(staticDescriptor, nextDescriptor) : nextDescriptor);
      })
      .catch(async (descriptorError) => {
        if (staticDescriptor) {
          if (!cancelled) setDescriptor(packageDescriptorWithDiagnostic(staticDescriptor, descriptorError));
          return;
        }
        try {
          const nextFile = await readWorkspaceFile(path, config);
          if (!cancelled) setFile(nextFile);
        } catch (fileError) {
          if (!cancelled) {
            const descriptorMessage = descriptorError instanceof Error ? descriptorError.message : String(descriptorError);
            const fileMessage = fileError instanceof Error ? fileError.message : String(fileError);
            setError(`已切换到备用预览，但仍无法读取：${fileMessage}；descriptor diagnostic: ${descriptorMessage}`);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPath('');
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, config, inlinePreview, path, reference.kind]);

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
  if (inlinePreview) {
    const previewReference = referenceForObjectReference(reference, inlinePreview.kind === 'pdf' || inlinePreview.kind === 'image' ? 'file-region' : 'file');
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(previewReference)}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{inlinePreview.kind}</Badge>
          <strong>{inlinePreview.title}</strong>
          {inlinePreview.size ? <span>{formatBytes(inlinePreview.size)}</span> : null}
        </div>
        <UploadedDataUrlPreview
          kind={inlinePreview.kind}
          dataUrl={inlinePreview.dataUrl}
          title={inlinePreview.title}
          mimeType={inlinePreview.mimeType}
          reference={previewReference}
        />
      </div>
    );
  }
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
        <UnsupportedPreviewPackageNotice
          reference={reference}
          path={path}
          diagnostic={error}
          onRequest={onPreviewPackageRequest}
        />
      </div>
    );
  }
  if (descriptor) {
    return (
      <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference, descriptor.kind === 'pdf' || descriptor.kind === 'image' ? 'file-region' : 'file'))}>
        <div className="workspace-object-preview-head">
          <Badge variant="info">{descriptor.kind}</Badge>
          <strong>{descriptor.title || descriptor.ref}</strong>
          {descriptor.sizeBytes !== undefined ? <span>{formatBytes(descriptor.sizeBytes)}</span> : null}
        </div>
        {previewNeedsPackage(descriptor) ? (
          <UnsupportedPreviewPackageNotice
            reference={reference}
            path={path}
            descriptor={descriptor}
            onRequest={onPreviewPackageRequest}
          />
        ) : (
          <DescriptorPreview descriptor={descriptor} config={config} reference={referenceForObjectReference(reference, descriptor.kind === 'pdf' || descriptor.kind === 'image' ? 'file-region' : 'file')} />
        )}
      </div>
    );
  }
  if (!file) return null;
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference, fileKindForPath(file.path, file.language) === 'pdf' ? 'file-region' : 'file'))}>
      <div className="workspace-object-preview-head">
        <Badge variant="info">{file.language || fileKindForPath(file.path)}</Badge>
        <strong>{file.path}</strong>
        <span>{formatBytes(file.size)}</span>
      </div>
      <WorkspaceFileInlineViewer file={file} />
    </div>
  );
}

function shouldHydratePreviewDescriptor(descriptor: PreviewDescriptor, path: string) {
  if (!path || /^agentserver:\/\//i.test(path) || /^data:/i.test(path) || /^https?:\/\//i.test(path)) return false;
  if (!descriptor.rawUrl && (descriptor.kind === 'pdf' || descriptor.kind === 'image' || descriptor.inlinePolicy === 'stream')) return true;
  if (!descriptor.derivatives?.length && descriptor.actions.some((action) => action === 'extract-text' || action === 'make-thumbnail' || action === 'select-rows')) return true;
  return false;
}

function mergePreviewDescriptors(local: PreviewDescriptor, hydrated: PreviewDescriptor): PreviewDescriptor {
  return {
    ...local,
    ...hydrated,
    title: local.title || hydrated.title,
    diagnostics: uniqueStrings([...(local.diagnostics ?? []), ...(hydrated.diagnostics ?? [])]),
    derivatives: mergePreviewDerivatives(local.derivatives, hydrated.derivatives),
    actions: uniqueStrings([...(local.actions ?? []), ...(hydrated.actions ?? [])]) as PreviewDescriptor['actions'],
    locatorHints: uniqueStrings([...(local.locatorHints ?? []), ...(hydrated.locatorHints ?? [])]) as PreviewDescriptor['locatorHints'],
  };
}

function descriptorWithDiagnostic(descriptor: PreviewDescriptor, error: unknown): PreviewDescriptor {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...descriptor,
    diagnostics: uniqueStrings([...(descriptor.diagnostics ?? []), `Workspace Writer descriptor hydration failed: ${message}`]),
  };
}

function mergePreviewDerivatives(left: PreviewDescriptor['derivatives'], right: PreviewDescriptor['derivatives']) {
  const byKey = new Map<string, NonNullable<PreviewDescriptor['derivatives']>[number]>();
  for (const derivative of [...(left ?? []), ...(right ?? [])]) {
    byKey.set(`${derivative.kind}:${derivative.ref}`, { ...byKey.get(`${derivative.kind}:${derivative.ref}`), ...derivative });
  }
  return byKey.size ? Array.from(byKey.values()) : undefined;
}

function uniqueStrings<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function DescriptorPreview({ descriptor, config, reference }: { descriptor: PreviewDescriptor; config: SciForgeConfig; reference: SciForgeReference }) {
  const [derivedFile, setDerivedFile] = useState<WorkspaceFileContent | undefined>();
  const [derivedLabel, setDerivedLabel] = useState('');
  const [derivedError, setDerivedError] = useState('');
  const [derivedLoading, setDerivedLoading] = useState(false);
  useEffect(() => {
    if (!descriptorCanUseWorkspacePreview(descriptor)) {
      setDerivedFile(undefined);
      setDerivedLabel('');
      setDerivedError('');
      setDerivedLoading(false);
      return undefined;
    }
    let cancelled = false;
    setDerivedFile(undefined);
    setDerivedError('');
    setDerivedLoading(true);
    void loadDescriptorPreviewFile(descriptor, config)
      .then(({ file, label }) => {
        if (cancelled) return;
        setDerivedFile(file);
        setDerivedLabel(label);
      })
      .catch((error) => {
        if (!cancelled) setDerivedError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setDerivedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config, descriptor]);

  if ((descriptor.kind === 'pdf' || descriptor.kind === 'image') && descriptor.rawUrl) {
    return (
      <UploadedDataUrlPreview
        kind={descriptor.kind}
        dataUrl={descriptor.rawUrl}
        title={descriptor.title || descriptor.ref}
        mimeType={descriptor.mimeType}
        reference={reference}
      />
    );
  }
  if (descriptor.kind === 'markdown' || descriptor.kind === 'text' || descriptor.kind === 'json' || descriptor.kind === 'table' || descriptor.kind === 'html') {
    return (
      <div className="workspace-object-media-note">
        <p>此 artifact 使用 workspace descriptor 预览；小文件直接读取，大文件按需生成 text/schema 派生预览。这只调用本地 workspace 函数，不增加 LLM token 开销。</p>
        {derivedLoading ? <p>正在生成或读取预览...</p> : null}
        {derivedFile ? (
          <div className="descriptor-derived-preview">
            <Badge variant="info">{derivedLabel}</Badge>
            <WorkspaceFileInlineViewer file={derivedFile} />
          </div>
        ) : null}
        {derivedError ? <pre className="workspace-object-code">{derivedError}</pre> : null}
        <PreviewDescriptorActions descriptor={descriptor} reference={reference} />
      </div>
    );
  }
  return (
    <div className="workspace-object-media-note">
      <p>{descriptor.title || descriptor.ref} 已作为轻量 artifact 聚焦。当前类型使用 metadata/system-open/copy-ref 作为稳定 fallback，派生内容按需生成。</p>
      <PreviewDescriptorActions descriptor={descriptor} reference={reference} />
    </div>
  );
}

function descriptorCanUseWorkspacePreview(descriptor: PreviewDescriptor) {
  return descriptor.kind === 'markdown'
    || descriptor.kind === 'text'
    || descriptor.kind === 'json'
    || descriptor.kind === 'table'
    || descriptor.kind === 'html';
}

async function loadDescriptorPreviewFile(descriptor: PreviewDescriptor, config: SciForgeConfig) {
  const shouldReadInline = descriptor.inlinePolicy === 'inline' && (descriptor.sizeBytes ?? 0) <= 1024 * 1024;
  if (shouldReadInline) {
    try {
      return { file: await readWorkspaceFile(descriptor.ref, config), label: 'inline' };
    } catch {
      // Fall through to derived preview; the descriptor endpoint may point at a file outside the normal workspace route.
    }
  }
  const derivativeKind = descriptorDerivativeKind(descriptor);
  const derivative = await readPreviewDerivative(descriptor.ref, derivativeKind, config);
  return { file: await readWorkspaceFile(derivative.ref, config), label: `${derivative.kind} derivative` };
}

function descriptorDerivativeKind(descriptor: PreviewDescriptor): PreviewDerivative['kind'] {
  if (descriptor.kind === 'json' || descriptor.kind === 'table') return 'schema';
  if (descriptor.kind === 'html') return 'html';
  return 'text';
}

function previewNeedsPackage(descriptor: PreviewDescriptor) {
  if (descriptor.inlinePolicy === 'unsupported') return true;
  if (descriptor.kind === 'binary' || descriptor.kind === 'office') return true;
  return false;
}

function UnsupportedPreviewPackageNotice({
  reference,
  path,
  descriptor,
  diagnostic,
  onRequest,
}: {
  reference: ObjectReference;
  path?: string;
  descriptor?: PreviewDescriptor;
  diagnostic?: string;
  onRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
}) {
  const kind = descriptor?.kind || reference.artifactType || 'unknown';
  return (
    <div className="unsupported-preview-package">
      <p>
        这个文件仍然可以作为对象引用传给 Agent，但右侧暂不支持内联预览
        {kind ? `（${kind}）` : ''}。需要设计一个匹配该文件类型的 preview package 插件后，才能在这里稳定渲染。
      </p>
      <div className="source-list">
        <code>{path || descriptor?.ref || reference.ref}</code>
        {descriptor?.mimeType ? <code>{descriptor.mimeType}</code> : null}
        {descriptor?.inlinePolicy ? <code>inlinePolicy: {descriptor.inlinePolicy}</code> : null}
      </div>
      {diagnostic ? <pre className="workspace-object-code">{diagnostic}</pre> : null}
      <button
        type="button"
        className="unsupported-preview-package-action"
        onClick={() => onRequest?.(reference, path, descriptor)}
        disabled={!onRequest}
      >
        <Sparkles size={14} />
        让 Agent 设计 preview package 并重试
      </button>
    </div>
  );
}

function PreviewDescriptorActions({ descriptor, reference }: { descriptor: PreviewDescriptor; reference: SciForgeReference }) {
  return (
    <>
      <div className="source-list">
        <code>{descriptor.ref}</code>
        {descriptor.mimeType ? <code>{descriptor.mimeType}</code> : null}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(reference, null, 2))}>复制引用</button>
      </div>
      {descriptor.derivatives?.length ? (
        <details className="report-read-warning">
          <summary>按需派生物</summary>
          <div className="source-list">
            {descriptor.derivatives.map((derivative) => (
              <code key={`${derivative.kind}-${derivative.ref}`}>{derivative.kind}: {derivative.status || 'lazy'}</code>
            ))}
          </div>
        </details>
      ) : null}
      {descriptor.diagnostics?.length ? (
        <details className="report-read-warning">
          <summary>preview diagnostics</summary>
          <pre className="workspace-object-code">{descriptor.diagnostics.join('\n')}</pre>
        </details>
      ) : null}
    </>
  );
}

function WorkspaceFileInlineViewer({ file }: { file: WorkspaceFileContent }) {
  const kind = fileKindForPath(file.path, file.language);
  if (kind === 'markdown') return <MarkdownBlock markdown={file.content} />;
  if (kind === 'json') return <pre className="workspace-object-code">{formatJsonLike(file.content)}</pre>;
  if (kind === 'csv' || kind === 'tsv') return <DelimitedTextPreview content={file.content} delimiter={kind === 'tsv' ? '\t' : ','} />;
  if (kind === 'image') {
    if (file.encoding === 'base64') {
      return (
        <div className="workspace-object-image-frame">
          <img src={`data:${file.mimeType || 'image/png'};base64,${file.content}`} alt={file.name} />
        </div>
      );
    }
    return (
      <div className="workspace-object-media-note">
        图片文件已解析为 workspace 引用，但当前 workspace server 未返回 base64 预览；可使用“系统打开”查看。
        <pre className="workspace-object-code">{file.content.slice(0, 4000)}</pre>
      </div>
    );
  }
  if (kind === 'pdf') {
    if (file.encoding === 'base64') {
      return (
        <UploadedDataUrlPreview
          kind="pdf"
          dataUrl={`data:${file.mimeType || 'application/pdf'};base64,${file.content}`}
          title={file.name}
          mimeType={file.mimeType || 'application/pdf'}
          reference={referenceForWorkspaceFile(file, 'file-region')}
        />
      );
    }
    return (
      <div className="workspace-object-media-note">
        <p>PDF 已作为可点击文件引用聚焦。点击对话栏“点选”后选中这张卡片，即可把 PDF 文件作为上下文；如需页码、段落或图表区域，请在问题中补充页码/图号/坐标描述。</p>
        <div className="source-list">
          <code>{file.path}</code>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(referenceForWorkspaceFile(file, 'file-region'), null, 2))}>复制 PDF 引用</button>
        </div>
      </div>
    );
  }
  if (kind === 'document' || kind === 'spreadsheet' || kind === 'presentation') {
    return (
      <div className="workspace-object-media-note">
        <p>{officePreviewLabel(kind)} 已作为可点击文件引用聚焦。浏览器内联预览暂不展开此类二进制文件，可用“系统打开”查看完整内容，或继续把它作为上下文引用给 SciForge。</p>
        <div className="source-list">
          <code>{file.path}</code>
          <code>{file.mimeType || 'application/octet-stream'}</code>
        </div>
      </div>
    );
  }
  if (kind === 'html') return <pre className="workspace-object-code">{file.content.slice(0, 12000)}</pre>;
  return <pre className="workspace-object-code">{file.content.slice(0, 12000)}</pre>;
}

function officePreviewLabel(kind: string) {
  if (kind === 'spreadsheet') return '表格文件';
  if (kind === 'presentation') return '演示文稿';
  return '文档文件';
}

function uploadedArtifactPreview(artifact?: RuntimeArtifact) {
  if (!artifact || !isRecord(artifact.data)) return undefined;
  const dataUrl = asString(artifact.data.dataUrl);
  const kind = asString(artifact.data.previewKind);
  if (!dataUrl || (kind !== 'pdf' && kind !== 'image')) return undefined;
  return {
    kind: kind as 'pdf' | 'image',
    dataUrl,
    title: asString(artifact.metadata?.title) || asString(artifact.data.title) || artifact.id,
    mimeType: asString(artifact.metadata?.mimeType) || asString(artifact.data.mimeType),
    size: asNumber(artifact.metadata?.size) || asNumber(artifact.data.size),
  };
}

function normalizeArtifactPreviewDescriptor(artifact: RuntimeArtifact | undefined, fallbackRef?: string): PreviewDescriptor | undefined {
  if (!artifact) return undefined;
  if (artifact.previewDescriptor) return artifact.previewDescriptor;
  const metadata = artifact.metadata ?? {};
  const nested = isRecord(metadata.previewDescriptor) ? metadata.previewDescriptor : undefined;
  const rawKind = asString(nested?.kind) || asString(metadata.previewKind) || fileKindForPath(fallbackRef || artifact.path || artifact.dataRef || artifact.id, asString(metadata.language) || '');
  const kind = previewKindFromArtifact(rawKind, artifact);
  if (!kind) return undefined;
  const rawUrl = asString(nested?.rawUrl) || asString(metadata.rawUrl);
  return {
    kind,
    source: 'artifact',
    ref: fallbackRef || artifact.path || artifact.dataRef || `artifact:${artifact.id}`,
    mimeType: asString(nested?.mimeType) || asString(metadata.mimeType),
    sizeBytes: asNumber(nested?.sizeBytes) || asNumber(metadata.size),
    hash: asString(nested?.hash) || asString(metadata.hash),
    title: asString(nested?.title) || asString(metadata.title) || artifact.id,
    rawUrl,
    inlinePolicy: rawUrl ? 'stream' : defaultInlinePolicyForKind(kind),
    derivatives: Array.isArray(nested?.derivatives) ? nested.derivatives.map(normalizePreviewDerivative).filter((item): item is NonNullable<PreviewDescriptor['derivatives']>[number] => Boolean(item)) : undefined,
    actions: previewActionsForDescriptorKind(kind),
    diagnostics: asStringList(nested?.diagnostics),
  };
}

function normalizePreviewDerivative(value: unknown): NonNullable<PreviewDescriptor['derivatives']>[number] | undefined {
  if (!isRecord(value)) return undefined;
  const kind = asString(value.kind);
  const ref = asString(value.ref);
  if (!kind || !ref) return undefined;
  return {
    kind: kind as NonNullable<PreviewDescriptor['derivatives']>[number]['kind'],
    ref,
    mimeType: asString(value.mimeType),
    sizeBytes: asNumber(value.sizeBytes),
    hash: asString(value.hash),
    generatedAt: asString(value.generatedAt),
    status: value.status === 'available' || value.status === 'lazy' || value.status === 'failed' || value.status === 'unsupported' ? value.status : undefined,
    diagnostics: asStringList(value.diagnostics),
  };
}

function previewKindFromArtifact(kind: string | undefined, artifact: RuntimeArtifact): PreviewDescriptor['kind'] | undefined {
  const value = `${kind || ''} ${artifact.type} ${artifact.path || ''} ${artifact.dataRef || ''}`.toLowerCase();
  if (/pdf/.test(value)) return 'pdf';
  if (/image|png|jpe?g|gif|webp|svg/.test(value)) return 'image';
  if (/markdown|\.md\b/.test(value)) return 'markdown';
  if (/json/.test(value)) return 'json';
  if (/csv|tsv|xlsx?|table|matrix/.test(value)) return 'table';
  if (/html?/.test(value)) return 'html';
  if (/pdb|cif|mmcif|structure|molecule/.test(value)) return 'structure';
  if (/docx?|pptx?|office|presentation|document/.test(value)) return 'office';
  if (/text|log|txt/.test(value)) return 'text';
  if (artifact.path || artifact.dataRef) return 'binary';
  return undefined;
}

function defaultInlinePolicyForKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['inlinePolicy'] {
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return kind === 'folder' ? 'extract' : 'unsupported';
}

function previewActionsForDescriptorKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['actions'] {
  const common: PreviewDescriptor['actions'] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

function UploadedDataUrlPreview({
  kind,
  dataUrl,
  title,
  mimeType,
  reference,
}: {
  kind: 'image' | 'pdf';
  dataUrl: string;
  title: string;
  mimeType?: string;
  reference?: SciForgeReference;
}) {
  const [objectUrl, setObjectUrl] = useState('');
  const [regionPick, setRegionPick] = useState<RegionPickState | null>(null);
  const [pickedRegion, setPickedRegion] = useState<string>('');
  const regionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (kind !== 'pdf') return undefined;
    let cancelled = false;
    let nextUrl = '';
    void fetch(dataUrl)
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mimeType || 'application/pdf' }));
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl(dataUrl);
      });
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [dataUrl, kind, mimeType]);

  const regionLayer = reference ? (
    <div className={cx('workspace-object-region-layer', regionPick?.active ? 'active' : regionPick ? 'ready' : undefined)} ref={regionRef} onMouseDown={startRegionPick}>
      {regionPick ? <span className="workspace-object-region-box" style={regionStyle(regionPick)} /> : null}
      {pickedRegion ? <span className="workspace-object-region-label">{pickedRegion}</span> : null}
    </div>
  ) : null;

  if (kind === 'image') {
    return (
      <div className="workspace-object-image-frame" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
        <img src={dataUrl} alt={title} />
        {regionLayer}
        <PreviewReferenceHint reference={reference} label="点选图片或拖选区域作为图像上下文" onPickRegion={reference ? beginRegionPick : undefined} />
      </div>
    );
  }
  return (
    <div className="workspace-object-pdf-shell" data-sciforge-reference={sciForgeReferenceAttribute(reference)}>
      <object className="workspace-object-pdf-frame" data={objectUrl || dataUrl} type={mimeType || 'application/pdf'} aria-label={title}>
        <iframe className="workspace-object-pdf-frame" title={title} src={objectUrl || dataUrl} />
      </object>
      {regionLayer}
      <PreviewReferenceHint reference={reference} label="点选整份 PDF，或拖选页面区域作为上下文" onPickRegion={reference ? beginRegionPick : undefined} />
    </div>
  );

  function beginRegionPick() {
    setPickedRegion('');
    setRegionPick({ active: false, x: 0, y: 0, width: 0, height: 0 });
  }

  function startRegionPick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!regionPick || !regionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = regionRef.current.getBoundingClientRect();
    const startX = clamp01((event.clientX - bounds.left) / bounds.width);
    const startY = clamp01((event.clientY - bounds.top) / bounds.height);
    setRegionPick({ active: true, x: startX, y: startY, width: 0, height: 0, originX: startX, originY: startY });
    function move(pointerEvent: MouseEvent) {
      const currentX = clamp01((pointerEvent.clientX - bounds.left) / bounds.width);
      const currentY = clamp01((pointerEvent.clientY - bounds.top) / bounds.height);
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      setRegionPick({ active: true, x, y, width: Math.abs(currentX - startX), height: Math.abs(currentY - startY), originX: startX, originY: startY });
    }
    function up(pointerEvent: MouseEvent) {
      move(pointerEvent);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const endX = clamp01((pointerEvent.clientX - bounds.left) / bounds.width);
      const endY = clamp01((pointerEvent.clientY - bounds.top) / bounds.height);
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);
      if (width < 0.01 || height < 0.01) {
        setRegionPick(null);
        return;
      }
      const region = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(width * 1000)},${Math.round(height * 1000)}`;
      setPickedRegion(`region ${region}`);
      setRegionPick({ active: false, x, y, width, height });
      void navigator.clipboard?.writeText(JSON.stringify(withRegionLocator(reference, region), null, 2));
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
}

type RegionPickState = {
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  originX?: number;
  originY?: number;
};

function PreviewReferenceHint({
  reference,
  label,
  onPickRegion,
}: {
  reference?: SciForgeReference;
  label: string;
  onPickRegion?: () => void;
}) {
  return (
    <div className="workspace-object-reference-hint">
      <span>{label}</span>
      <div>
        {onPickRegion ? <button type="button" onClick={onPickRegion}>区域选择</button> : null}
        {reference ? <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(reference, null, 2))}>复制引用</button> : null}
      </div>
    </div>
  );
}

function regionStyle(region: RegionPickState) {
  return {
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function referenceForWorkspaceFile(file: WorkspaceFileContent, kind: SciForgeReference['kind'] = 'file'): SciForgeReference {
  return referenceForWorkspaceFileLike(file, kind);
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
  if (/document|\.(docx?|rtf)\b/.test(value)) return 'document';
  if (/spreadsheet|\.(xlsx?|ods)\b/.test(value)) return 'spreadsheet';
  if (/presentation|\.(pptx?|odp)\b/.test(value)) return 'presentation';
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

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制路径，请手动复制。');
  } finally {
    document.body.removeChild(textarea);
  }
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

function viewPlanSectionLabel(section: ViewPlanSection) {
  if (section === 'primary') return '核心结果';
  if (section === 'supporting') return '支撑证据';
  if (section === 'provenance') return '执行记录';
  return '原始数据 / fallback';
}

export function selectDefaultResultItems(items: ResolvedViewPlanItem[], focusMode: ResultFocusMode) {
  const sorted = [...items].sort(resultPresentationRank);
  const focused = sorted.filter((item) => item.source === 'object-focus');
  if (focused.length && focusMode === 'all') {
    const visibleItems: ResolvedViewPlanItem[] = [];
    pushUniqueVisibleItems(visibleItems, focused, 2);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    return {
      visibleItems,
      deferredItems: sorted.filter((item) => !visibleIds.has(item.id) && !isAuditOnlyResultItem(item)),
    };
  }
  if (focusMode === 'evidence' || focusMode === 'execution') {
    const visibleItems: ResolvedViewPlanItem[] = [];
    pushUniqueVisibleItems(visibleItems, sorted, 4);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    return {
      visibleItems,
      deferredItems: sorted.filter((item) => !visibleIds.has(item.id)),
    };
  }
  const userFacing = sorted.filter((item) => !isAuditOnlyResultItem(item));
  const primary = userFacing.filter((item) => item.section === 'primary');
  const usefulPrimary = primary.filter((item) => item.status === 'bound' || item.status === 'missing-fields');
  const visibleItems: ResolvedViewPlanItem[] = [];
  pushUniqueVisibleItems(visibleItems, usefulPrimary.length ? usefulPrimary : primary, 2);
  if (visibleItems.length < 2) {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    pushUniqueVisibleItems(
      visibleItems,
      userFacing.filter((item) => !visibleIds.has(item.id) && item.section === 'supporting' && item.status === 'bound'),
      2,
    );
  }
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  return {
    visibleItems,
    deferredItems: userFacing.filter((item) => !visibleIds.has(item.id)),
  };
}

function isAuditOnlyResultItem(item: ResolvedViewPlanItem) {
  return item.module.componentId === 'evidence-matrix'
    || item.module.componentId === 'execution-unit-table'
    || item.module.componentId === 'notebook-timeline'
    || item.module.componentId === 'unknown-artifact-inspector'
    || item.section === 'provenance'
    || item.section === 'raw';
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
  const order = [
    'report-viewer',
    'structure-viewer',
    'molecule-viewer',
    'evidence-matrix',
    'paper-card-list',
    'graph-viewer',
    'network-graph',
    'point-set-viewer',
    'matrix-viewer',
    'record-table',
    'data-table',
    'execution-unit-table',
    'notebook-timeline',
    'unknown-artifact-inspector',
  ];
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
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  title: string;
  items: ResolvedViewPlanItem[];
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
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
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  item: ResolvedViewPlanItem;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
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
        data-sciforge-reference={sciForgeReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact)) : referenceForResultSlot(item))}
      >
        <SectionHeader icon={AlertTriangle} title={slot.title ?? '未注册组件'} subtitle={slot.componentId} />
        <p className="empty-state">Scenario 返回了未知 componentId。当前使用通用 inspector 展示 artifact、manifest 和日志引用。</p>
        {slot.artifactRef && !artifact ? <p className="empty-state">artifactRef 未找到：{slot.artifactRef}</p> : null}
        {onDismissResultSlotPresentation ? (
          <div className="artifact-card-actions">
            <button
              type="button"
              className="registry-slot-dismiss"
              onClick={() => onDismissResultSlotPresentation(item.id)}
              title="从结果区移除本卡片（不删除 workspace 中的 artifact 或文件）"
            >
              <Trash2 size={13} />
              删除视图
            </button>
          </div>
        ) : null}
        <UnknownArtifactInspector scenarioId={scenarioId} config={config} session={session} slot={slot} artifact={artifact} />
      </Card>
    );
  }
  return (
    <Card
      className={cx('registry-slot', item.section === 'primary' && 'primary-slot')}
      data-sciforge-reference={sciForgeReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact, slot.componentId)) : referenceForResultSlot(item))}
    >
      <SectionHeader icon={Target} title={slot.title ?? entry.label} subtitle={resultSlotSubtitle(item, artifact)} />
      {artifact || onDismissResultSlotPresentation ? (
        <div className="artifact-card-actions">
          {artifact ? (
            <button type="button" onClick={() => onInspectArtifact(artifact)}>
              <Eye size={13} />
              查看数据
            </button>
          ) : null}
          {onDismissResultSlotPresentation ? (
            <button
              type="button"
              className="registry-slot-dismiss"
              onClick={() => onDismissResultSlotPresentation(item.id)}
              title="从结果区移除本卡片（不删除 workspace 中的 artifact 或文件）"
            >
              <Trash2 size={13} />
              删除视图
            </button>
          ) : null}
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
      {entry.render({ scenarioId, config, session, slot, artifact, onObjectReferenceFocus })}
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
  session: SciForgeSession;
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

function uploadedEvidenceArtifacts(artifacts: RuntimeArtifact[]) {
  return artifacts.filter((artifact) => artifact.metadata?.source === 'user-upload' || /^uploaded-/.test(artifact.type));
}

function EvidenceMatrix({ claims, artifacts = [] }: { claims: EvidenceClaim[]; artifacts?: RuntimeArtifact[] }) {
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);
  const [expandedUpload, setExpandedUpload] = useState<string | null>(null);
  const uploads = uploadedEvidenceArtifacts(artifacts);
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
      <SectionHeader icon={Shield} title="证据矩阵" subtitle="claims、上传文件和可交互引用" />
      {!rows.length && !uploads.length ? <EmptyArtifactState title="等待证据" detail="上传论文 PDF、图片或运行任务后，证据矩阵会展示可预览、可引用的材料。" /> : null}
      {uploads.map((artifact) => {
        const title = asString(artifact.metadata?.title) || asString(artifact.metadata?.fileName) || artifact.id;
        const mimeType = asString(artifact.metadata?.mimeType) || asString((artifact.data as Record<string, unknown> | undefined)?.mimeType) || 'application/octet-stream';
        const size = typeof artifact.metadata?.size === 'number' ? artifact.metadata.size : undefined;
        const data = isRecord(artifact.data) ? artifact.data : {};
        const dataUrl = asString(data.dataUrl);
        const previewKind = asString(data.previewKind);
        return (
          <Card className="evidence-row uploaded-evidence-row" key={artifact.id}>
            <div className="evidence-main">
              <h3>{title}</h3>
              <p>{artifact.type} · {mimeType}{size ? ` · ${formatResultFileBytes(size)}` : ''}</p>
              <button className="expand-link source-toggle" onClick={() => setExpandedUpload(expandedUpload === artifact.id ? null : artifact.id)}>
                {expandedUpload === artifact.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expandedUpload === artifact.id ? '收起预览' : '预览/引用'}
              </button>
              {expandedUpload === artifact.id ? (
                <div className="uploaded-evidence-preview">
                  {previewKind === 'image' && dataUrl ? (
                    <UploadedDataUrlPreview kind="image" dataUrl={dataUrl} title={title} mimeType={mimeType} />
                  ) : null}
                  {previewKind === 'pdf' && dataUrl ? (
                    <UploadedDataUrlPreview kind="pdf" dataUrl={dataUrl} title={title} mimeType={mimeType} />
                  ) : null}
                  {previewKind !== 'image' && previewKind !== 'pdf' ? <p className="empty-state">此文件类型已加入证据矩阵，可在对话栏引用给 SciForge 使用。</p> : null}
                  <div className="source-list">
                    <code>artifact:{artifact.id}</code>
                    {artifact.dataRef ? <code>{artifact.dataRef}</code> : null}
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(`artifact:${artifact.id}`)}>复制引用</button>
                  </div>
                </div>
              ) : null}
            </div>
            <Badge variant="info">uploaded</Badge>
            <Badge variant="muted">{previewKind || 'file'}</Badge>
          </Card>
        );
      })}
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
  session: SciForgeSession;
  executionUnits: RuntimeExecutionUnit[];
  embedded?: boolean;
}) {
  const rows = executionUnits;
  return (
    <div className="stack">
      <SectionHeader
        icon={Lock}
        title="可复现执行单元"
        subtitle={embedded ? '完整 ExecutionUnit、stdout/stderr refs 和数据指纹' : '代码 + 参数 + 环境 + 数据指纹'}
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

function NotebookTimeline({ scenarioId, notebook = [], embedded = false }: { scenarioId: ScenarioId; notebook?: NotebookRecord[]; embedded?: boolean }) {
  const filtered = notebook;
  return (
    <div className="stack">
      <SectionHeader icon={Clock} title="研究记录" subtitle={embedded ? '完整 notebook timeline 审计记录' : '从对话到可审计 notebook timeline'} />
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

export function previewPackageAutoRunPrompt(reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor): string {
  const target = path || descriptor?.ref || reference.ref;
  const ext = target.includes('.') ? target.split(/[?#]/)[0].split('.').pop() : undefined;
  return [
    `右侧预览点击了一个当前不支持内联 preview 的文件，但它仍然必须保持为可引用对象。`,
    `请为这个文件类型设计并实现一个 SciForge preview package 插件，然后自动尝试再次 preview/review。`,
    ``,
    `目标文件引用：${reference.ref}`,
    `目标文件路径：${target}`,
    `文件扩展名：${ext || 'unknown'}`,
    `当前 preview descriptor：${JSON.stringify({
      kind: descriptor?.kind,
      inlinePolicy: descriptor?.inlinePolicy,
      mimeType: descriptor?.mimeType,
      actions: descriptor?.actions,
      diagnostics: descriptor?.diagnostics,
    }, null, 2)}`,
    ``,
    `实施要求：`,
    `1. 先检查 packages/ui-components 下已有组件和 manifest，优先复用现有 package；不够再新增专门的 preview package。`,
    `2. 新 package 要包含 manifest、必要的 renderer/README/test，并接入 UI registry 或现有 preview 分发链路。`,
    `3. 未能完整渲染时要给用户明确 unsupported 状态和 fallback 操作，不能让右侧面板空白或崩溃。`,
    `4. 完成后运行相关测试/类型检查，并再次尝试聚焦 ${target}，报告 preview 是否已可用。`,
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
