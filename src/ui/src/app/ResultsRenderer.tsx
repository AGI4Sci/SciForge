import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Copy, Download, FileCode, FileText, Lock, Save, Shield, Sparkles, Target, Terminal, X } from 'lucide-react';
import { scenarios, type EvidenceLevel, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { elementRegistry } from '../scenarioCompiler/elementRegistry';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../exportPolicy';
import { artifactPreviewActions, objectReferenceKinds, previewDescriptorKinds, runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { openWorkspaceObject, readPreviewDerivative, readPreviewDescriptor, readWorkspaceFile, writeWorkspaceFile, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry } from '../uiModuleRegistry';
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
  shouldHydratePreviewDescriptor as packageShouldHydratePreviewDescriptor,
} from '../../../../packages/artifact-preview';
import { exportJsonFile, exportTextFile } from './exportUtils';
import { ActionButton, Badge, Card, ClaimTag, ConfidenceBar, EmptyArtifactState, EvidenceTag, SectionHeader, cx } from './uiPrimitives';
import { ResultShell, type ResultFocusMode } from './results/ResultShell';
import { HandoffPreview, HandoffTargetButtons } from './results/HandoffControls';
import { PreviewDescriptorActions } from './results/PreviewActions';
import { ArtifactCardControls } from './results/ArtifactCardControls';
export { handoffAutoRunPrompt, previewPackageAutoRunPrompt } from './results/autoRunPrompts';
import {
  filterHiddenResultSlots,
  itemsForFocusMode,
  resolveViewPlan,
  selectDefaultResultItems,
  viewPlanSectionLabel,
  type ResolvedViewPlanItem,
  type RuntimeResolvedViewPlan,
} from './results/viewPlanResolver';
export { selectDefaultResultItems, type HandoffAutoRunRequest } from './results/viewPlanResolver';
import { MarkdownBlock, hydrateInlineObjectReferenceButtons } from './results/reportContent';
export { coerceReportPayload } from './results/reportContent';
import { applyViewTransforms, arrayPayload, artifactDownloadItems } from './results/artifactData';
import {
  descriptorCanUseWorkspacePreview,
  descriptorDerivativeKind,
  fileKindForPath,
  normalizeArtifactPreviewDescriptor,
  previewNeedsPackage,
  uploadedArtifactPreview,
} from './results/previewDescriptor';
import type { SciForgeConfig, SciForgeReference, SciForgeRun, SciForgeSession, EvidenceClaim, NotebookRecord, ObjectAction, ObjectReference, PreviewDescriptor, RuntimeArtifact, RuntimeExecutionUnit, ScenarioInstanceId, UIManifestSlot, ViewPlanSection } from '../domain';
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
  function handleFocusModeChange(mode: ResultFocusMode) {
    setFocusMode(mode);
    if (mode === 'evidence') setResultTab('evidence');
    if (mode === 'execution') setResultTab('primary');
    if (mode === 'visual') setResultTab('primary');
  }
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
    <ResultShell
      collapsed={collapsed}
      resultTab={resultTab}
      focusMode={focusMode}
      activeRun={!focusedObjectReference ? activeRun : undefined}
      scenarioId={scenarioId}
      onToggleCollapse={onToggleCollapse}
      onResultTabChange={setResultTab}
      onFocusModeChange={handleFocusModeChange}
      onActiveRunChange={onActiveRunChange}
      drawer={inspectedArtifact ? (
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
    </ResultShell>
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
    const staticDescriptor = normalizeArtifactPreviewDescriptor(artifact, path);
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

function humanizeKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
        <ArtifactCardControls
          presentationId={item.id}
          onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        />
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
      <ArtifactCardControls
        artifact={artifact}
        presentationId={item.id}
        onInspectArtifact={onInspectArtifact}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
      />
      {artifact && handoffTargets.length ? (
        <HandoffTargetButtons targets={handoffTargets} onPreview={setHandoffPreviewTarget} />
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
