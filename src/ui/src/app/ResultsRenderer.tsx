import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Copy, Download, FileCode, FileText, Lock, Save, Shield, Sparkles, Target, Terminal, X } from 'lucide-react';
import { scenarios, type ScenarioId } from '../data';
import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import { artifactPreviewActions, objectReferenceKinds, previewDescriptorKinds, runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { readPreviewDerivative, readPreviewDescriptor, readWorkspaceFile, writeWorkspaceFile, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry } from '../uiModuleRegistry';
import {
  interactiveArtifactDownloadItems,
  interactiveArtifactInspectorTablePolicy,
  interactiveResultSlotSubtitle,
  interactiveUnknownComponentFallbackPolicy,
  interactiveViewComponentLabel,
  interactiveViewPackageRendererForComponent,
  interactiveViewResultSummaryPresentation,
  isEvidenceInteractiveViewComponent,
  isExecutionInteractiveViewComponent,
  isNotebookInteractiveViewComponent,
  isUnknownArtifactInspectorComponent,
  type UIComponentRendererProps,
} from '../../../../packages/presentation/interactive-views';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import { exportJsonFile, exportTextFile } from './exportUtils';
import { ActionButton, Badge, Card, ClaimTag, ConfidenceBar, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';
import { ResultShell, type ResultFocusMode } from './results/ResultShell';
import { HandoffPreview, HandoffTargetButtons } from './results/HandoffControls';
import { PreviewDescriptorActions } from './results/PreviewActions';
import { ArtifactCardControls } from './results/ArtifactCardControls';
import { EvidenceMatrix, ExecutionPanel, NotebookTimeline } from './results/ExecutionNotebookPanels';
export { handoffAutoRunPrompt, previewPackageAutoRunPrompt } from './results/autoRunPrompts';
import {
  createResultsRendererViewModel,
  type ResolvedViewPlanItem,
  type ResultsRendererManifestDiagnostic,
  type ResultsRendererViewModel,
  type RuntimeResolvedViewPlan,
} from './results-renderer-view-model';
export { selectDefaultResultItems, type HandoffAutoRunRequest } from './results/viewPlanResolver';
import { MarkdownBlock, hydrateInlineObjectReferenceButtons } from './results/reportContent';
export { coerceReportPayload } from './results/reportContent';
import {
  artifactSource,
  compactParams,
  executionUnitForArtifact,
  exportExecutionBundle,
  formatResultFileBytes,
  isRecord,
  sourceVariant,
  toRecordList,
  viewCompositionSummary,
} from './results/resultArtifactHelpers';
import {
  descriptorCanUseWorkspacePreview,
  descriptorDerivativeKind,
  fileKindForPath,
  normalizeArtifactPreviewDescriptor,
  previewNeedsPackage,
  uploadedArtifactPreview,
} from './results/previewDescriptor';
import { UploadedDataUrlPreview, WorkspaceObjectPreview } from './results/WorkspaceObjectPreview';
import type { SciForgeConfig, SciForgeRun, SciForgeSession, ObjectAction, ObjectReference, PreviewDescriptor, RuntimeArtifact, UIManifestSlot } from '../domain';
import {
  backendRepairStates,
  contractValidationFailureKey,
  contractValidationFailures,
  failedExecutionUnits,
  rawAuditItems,
  runAuditBlockers,
  runAuditRefs,
  runRecoverActions,
  type BackendRepairState,
} from './results-renderer-execution-model';
export {
  backendRepairStates,
  contractValidationFailures,
  runAuditRefs,
  runRecoverActions,
  shouldOpenRunAuditDetails,
} from './results-renderer-execution-model';
import {
  artifactInspectorModel,
  artifactReferenceKind,
  handoffTargetsForArtifact,
  referenceForResultSlot,
} from './results-renderer-artifact-normalizer';
import {
  availableObjectActions,
  findArtifact,
} from '../../../../packages/support/object-references';
import {
  sciForgeReferenceAttribute,
  objectReferenceKindLabel,
  referenceForArtifact,
  referenceForObjectReference,
  referenceForWorkspaceFileLike,
  withRegionLocator,
} from '../../../../packages/support/object-references';
import {
  objectActionLabel,
  performObjectReferenceAction,
} from './results-renderer-object-actions';

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
  const rendererModel = useMemo(() => createResultsRendererViewModel({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences,
    focusMode,
  }), [scenarioId, session, defaultSlots, activeRun, focusedObjectReference, pinnedObjectReferences, focusMode]);
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
    if (result.notice) setObjectActionNotice(result.notice);
    if (result.error) setObjectActionError(result.error);
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
                model={rendererModel}
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

function UnknownArtifactInspector({ slot, artifact, session }: RegistryRendererProps) {
  const payload = artifact?.data ?? slot.props ?? {};
  const table = interactiveArtifactInspectorTablePolicy(payload);
  const unit = session ? executionUnitForArtifact(session, artifact) : undefined;
  const refs = [
    artifact?.dataRef ? { label: 'dataRef', value: artifact.dataRef } : undefined,
    unit?.codeRef ? { label: 'codeRef', value: unit.codeRef } : undefined,
    unit?.stdoutRef ? { label: 'stdoutRef', value: unit.stdoutRef } : undefined,
    unit?.stderrRef ? { label: 'stderrRef', value: unit.stderrRef } : undefined,
    unit?.outputRef ? { label: 'outputRef', value: unit.outputRef } : undefined,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
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
        <div className="slot-meta">
          {refs.map((ref) => (
            <code key={`${ref.label}-${ref.value}`}>{ref.label}: {ref.value}</code>
          ))}
        </div>
      ) : null}
      {table.rows.length ? (
        <div className="artifact-table">
          <div className="artifact-table-head" style={{ gridTemplateColumns: table.gridTemplateColumns }}>
            {table.columns.map((column) => <span key={column}>{column}</span>)}
          </div>
          {table.rows.slice(0, table.rowLimit).map((row, index) => (
            <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: table.gridTemplateColumns }}>
              {table.columns.map((column) => <span key={column}>{String(row[column] ?? '-')}</span>)}
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
  const downloads = interactiveArtifactDownloadItems(artifact);
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

function registryEntryForComponent(componentId: string): RegistryEntry | undefined {
  const packageEntry = interactiveViewPackageRendererForComponent(componentId);
  if (packageEntry) {
    return {
      label: packageEntry.label,
      render: (props) => <>{packageEntry.render(packageRendererProps(props))}</>,
    };
  }
  if (isEvidenceInteractiveViewComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: ({ session }) => <EvidenceMatrix claims={session.claims} artifacts={session.artifacts} />,
    };
  }
  if (isExecutionInteractiveViewComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: ({ session }) => <ExecutionPanel session={session} executionUnits={session.executionUnits} embedded />,
    };
  }
  if (isNotebookInteractiveViewComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: ({ scenarioId, session }) => <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} />,
    };
  }
  if (isUnknownArtifactInspectorComponent(componentId)) {
    return {
      label: interactiveViewComponentLabel(componentId),
      render: (props) => <UnknownArtifactInspector {...props} />,
    };
  }
  return undefined;
}

export type WorkbenchSlotRenderProps = RegistryRendererProps;

export function renderRegisteredWorkbenchSlot(props: RegistryRendererProps): ReactNode {
  const entry = registryEntryForComponent(props.slot.componentId);
  if (!entry) {
    return (
      <EmptyArtifactState
        title={interactiveUnknownComponentFallbackPolicy({ componentId: props.slot.componentId }).title}
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
  model,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  model: ResultsRendererViewModel;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
}) {
  const { viewPlan } = model;
  return (
    <div className="stack">
      <SectionHeader icon={FileText} title="结果视图" subtitle="优先展示用户本轮要看的结果；更多内容默认收起" />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} /> : null}
      <RunStatusSummary session={session} activeRun={activeRun} />
      {model.emptyState ? (
        <EmptyArtifactState
          title={model.emptyState.title}
          detail={model.emptyState.detail}
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
      />
      {model.deferredSections.length ? (
        <details className="result-details-panel">
          <summary>
            <span>更多结果</span>
            <Badge variant="muted">{model.deferredItems.length} hidden</Badge>
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
            />
          ))}
        </details>
      ) : null}
      {model.auditOpen ? (
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
          <ViewPlanSummary viewPlan={viewPlan} session={session} activeRun={activeRun} />
          <ManifestDiagnostics items={model.manifestDiagnostics} />
        </details>
      ) : null}
    </div>
  );
}

function RunStatusSummary({ session, activeRun }: { session: SciForgeSession; activeRun?: SciForgeRun }) {
  const failures = failedExecutionUnits(session, activeRun);
  const run = activeRun ?? session.runs.at(-1);
  const blockers = runAuditBlockers(session, activeRun);
  const validationFailures = contractValidationFailures(session, activeRun);
  const repairStates = backendRepairStates(session, activeRun);
  const recoverActions = runRecoverActions(session, activeRun).slice(0, 4);
  if (!failures.length && !blockers.length && !validationFailures.length && !repairStates.length && !recoverActions.length && run?.status !== 'failed') return null;
  return (
    <Card className={cx('run-status-summary', failures.length || validationFailures.length || run?.status === 'failed' ? 'failed' : 'recoverable')}>
      <SectionHeader
        icon={AlertTriangle}
        title={failures.length || validationFailures.length || run?.status === 'failed' ? '运行需要处理' : '可恢复建议'}
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
      {validationFailures.map((failure) => <ContractValidationFailureSummary key={contractValidationFailureKey(failure)} failure={failure} compact />)}
      {repairStates.map((state) => <BackendRepairStateSummary key={state.id} state={state} compact />)}
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
  const validationFailures = contractValidationFailures(session, activeRun);
  const repairStates = backendRepairStates(session, activeRun);
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
      {validationFailures.length ? (
        <div className="stack">
          {validationFailures.map((failure) => <ContractValidationFailureSummary key={contractValidationFailureKey(failure)} failure={failure} />)}
        </div>
      ) : null}
      {repairStates.length ? (
        <div className="stack">
          {repairStates.map((state) => <BackendRepairStateSummary key={state.id} state={state} />)}
        </div>
      ) : null}
      {refs.length ? (
        <div className="slot-meta">
          {refs.map((ref) => <code key={ref}>{ref}</code>)}
        </div>
      ) : null}
    </Card>
  );
}

function ContractValidationFailureSummary({ failure, compact = false }: { failure: ContractValidationFailure; compact?: boolean }) {
  const issueLines = failure.issues.map((issue) => [
    issue.path || issue.missingField || issue.invalidRef || issue.unresolvedUri || 'issue',
    issue.message,
  ].filter(Boolean).join(': '));
  return (
    <div className="run-failure-card">
      <strong>ContractValidationFailure · {failure.failureKind}</strong>
      <p>{failure.failureReason}</p>
      <div className="slot-meta">
        <code>contractId={failure.contractId}</code>
        <code>capabilityId={failure.capabilityId}</code>
        {failure.schemaPath ? <code>schemaPath={failure.schemaPath}</code> : null}
      </div>
      {failure.missingFields.length || failure.invalidRefs.length || failure.unresolvedUris.length ? (
        <div className="slot-meta">
          {failure.missingFields.map((field) => <code key={`missing-${field}`}>missingField: {field}</code>)}
          {failure.invalidRefs.map((ref) => <code key={`invalid-${ref}`}>invalidRef: {ref}</code>)}
          {failure.unresolvedUris.map((uri) => <code key={`unresolved-${uri}`}>unresolvedUri: {uri}</code>)}
        </div>
      ) : null}
      {!compact && issueLines.length ? (
        <div className="run-status-lines">
          {issueLines.slice(0, 6).map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : null}
      {failure.relatedRefs.length ? (
        <div className="inspector-ref-list">
          {failure.relatedRefs.map((ref) => <code key={`related-${ref}`}>relatedRef: {ref}</code>)}
        </div>
      ) : null}
      {failure.nextStep ? <p className="empty-state">nextStep: {failure.nextStep}</p> : null}
    </div>
  );
}

function BackendRepairStateSummary({ state, compact = false }: { state: BackendRepairState; compact?: boolean }) {
  return (
    <div className="run-failure-card">
      <strong>Backend repair state · {state.label}</strong>
      <p>{[state.status ? `status=${state.status}` : undefined, state.failureReason].filter(Boolean).join(' · ') || 'repair metadata recorded'}</p>
      <div className="slot-meta">
        {state.sourceRunId ? <code>sourceRunId={state.sourceRunId}</code> : null}
        {state.repairRunId ? <code>repairRunId={state.repairRunId}</code> : null}
      </div>
      {state.refs.length ? (
        <div className="inspector-ref-list">
          {state.refs.map((ref) => <code key={`${state.id}-${ref}`}>{ref}</code>)}
        </div>
      ) : null}
      {!compact && state.history.length ? (
        <div className="run-status-lines">
          {state.history.slice(0, 6).map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function ViewPlanSummary({ viewPlan, session, activeRun }: { viewPlan: RuntimeResolvedViewPlan; session: SciForgeSession; activeRun?: SciForgeRun }) {
  const diagnosticCount = contractValidationFailures(session, activeRun).length + failedExecutionUnits(session, activeRun).length;
  const runFailed = (activeRun ?? session.runs.at(-1))?.status === 'failed';
  const summary = interactiveViewResultSummaryPresentation({
    items: viewPlan.allItems,
    diagnosticCount,
    runFailed,
  });
  return (
    <div className="view-plan-summary">
      <div>
        <Badge variant={summary.badgeVariant}>{summary.badgeLabel}</Badge>
        <strong>{viewPlan.displayIntent.primaryGoal}</strong>
        <span>{summary.summaryText}</span>
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
  const entry = registryEntryForComponent(slot.componentId);
  const handoffTargets = artifact ? handoffTargetsForArtifact(artifact, scenarioId) : [];
  if (!entry) {
    const fallback = interactiveUnknownComponentFallbackPolicy({
      componentId: slot.componentId,
      artifactRef: slot.artifactRef,
      artifactFound: Boolean(artifact),
      slotTitle: slot.title,
    });
    return (
      <Card
        className="registry-slot"
        data-sciforge-reference={sciForgeReferenceAttribute(artifact ? referenceForArtifact(artifact, artifactReferenceKind(artifact)) : referenceForResultSlot(item))}
      >
        <SectionHeader icon={AlertTriangle} title={fallback.title} subtitle={fallback.subtitle} />
        <p className="empty-state">{fallback.detail}</p>
        {fallback.missingArtifactDetail ? <p className="empty-state">{fallback.missingArtifactDetail}</p> : null}
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
  return interactiveResultSlotSubtitle(item, artifact);
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
  const { files, handoffTargets, lineage } = artifactInspectorModel({
    artifact,
    session,
    currentScenarioId: scenarioId,
    downloads: interactiveArtifactDownloadItems(artifact),
  });
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

function ManifestDiagnostics({ items }: { items: ResultsRendererManifestDiagnostic[] }) {
  return (
    <div className="manifest-diagnostics">
      {items.map((item) => (
        <code key={item.id} title={item.reason}>
          {item.moduleId}{item.artifactType ? ` -> ${item.artifactType}` : ''}
        </code>
      ))}
    </div>
  );
}
