import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Copy, FileCode, FileText, Lock, Save, Shield, Sparkles, Terminal, X } from 'lucide-react';
import type { ScenarioId } from '../data';
import { artifactPreviewActions, objectReferenceKinds, previewDescriptorKinds, runtimeContractSchemas, schemaPreview, validateRuntimeContract } from '../runtimeContracts';
import { readPreviewDerivative, readPreviewDescriptor, writeWorkspaceFile, type WorkspaceFileContent } from '../api/workspaceClient';
import { uiModuleRegistry } from '../uiModuleRegistry';
import { interactiveViewResultSummaryPresentation } from '../../../../packages/presentation/interactive-views';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import { exportJsonFile } from './exportUtils';
import { Badge, Card, EmptyArtifactState, SectionHeader, cx } from './uiPrimitives';
import { ResultShell, type ResultFocusMode } from './results/ResultShell';
import { PreviewDescriptorActions } from './results/PreviewActions';
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
export { coerceReportPayload } from './results/reportContent';
import {
  compactParams,
  exportExecutionBundle,
  formatResultFileBytes,
  isRecord,
  toRecordList,
} from './results/resultArtifactHelpers';
import { artifactsForRun, auditExecutionUnitsForRun } from './results/executionUnitsForRun';
import {
  descriptorCanUseWorkspacePreview,
  descriptorDerivativeKind,
  fileKindForPath,
  normalizeArtifactPreviewDescriptor,
  previewNeedsPackage,
  uploadedArtifactPreview,
} from './results/previewDescriptor';
import { UploadedDataUrlPreview, WorkspaceObjectPreview } from './results/WorkspaceObjectPreview';
import { makeId, nowIso, type EvidenceClaim, type SciForgeConfig, type SciForgeRun, type SciForgeSession, type ObjectAction, type ObjectReference, type PreviewDescriptor, type RuntimeArtifact, type RuntimeCompatibilityDiagnostic, type RuntimeExecutionUnit, type UIManifestSlot } from '../domain';
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
  createOpenDebugAuditUIAction,
  createTriggerRecoverUIAction,
  type OpenDebugAuditUIAction,
  type TriggerRecoverUIAction,
} from './uiActionBoundary';

export { renderRegisteredWorkbenchSlot };
export type { WorkbenchSlotRenderProps };

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
  const fileReference = referenceForWorkspaceFileLike(state.file, referenceKindForWorkspaceFileLike(state.file));
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
    <div
      className="workspace-preview result-workspace-file-editor"
      aria-label="工作区文件"
      data-sciforge-reference={sciForgeReferenceAttribute(fileReference)}
    >
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
  onTriggerRecoverAction,
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
  onTriggerRecoverAction?: (action: TriggerRecoverUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  /** Test hook for rendering a non-default focus mode without browser events. */
  initialFocusMode?: ResultFocusMode;
}) {
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
              <ResultPaneWorkspaceFileEditor
                state={workspaceFileEditor}
                config={config}
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
                onAction={handleObjectAction}
                onClear={() => onFocusedObjectChange(undefined)}
              />
            ) : objectActionError ? (
              <div className="object-action-error">{objectActionError}</div>
            ) : null}
            {!executionFocus && focusedObjectReference ? (
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
                focusMode={focusMode}
                model={rendererModel}
                onArtifactHandoff={onArtifactHandoff}
                onInspectArtifact={setInspectedArtifact}
                onObjectReferenceFocus={onFocusedObjectChange}
                onDismissResultSlotPresentation={onDismissResultSlotPresentation}
                onTriggerRecoverAction={onTriggerRecoverAction}
                onOpenDebugAuditAction={onOpenDebugAuditAction}
              />
            ) : resultTab === 'evidence' ? (
              <EvidenceMatrix claims={evidenceClaimsForRun(session, activeRun)} artifacts={artifactsForRun(session, activeRun)} />
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
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
  onTriggerRecoverAction,
  onOpenDebugAuditAction,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  focusMode: ResultFocusMode;
  model: ResultsRendererViewModel;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onTriggerRecoverAction?: (action: TriggerRecoverUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
}) {
  const { viewPlan } = model;
  const runtimeState = browserVisibleRuntimeState(session, activeRun, viewPlan);
  if (focusMode === 'execution') {
    return <ExecutionOnlyResult session={session} activeRun={activeRun} />;
  }
  return (
    <div className="stack">
      <div
        className="runtime-visible-state-hook"
        data-testid="runtime-visible-state"
        data-session-id={runtimeState.sessionId}
        data-run-id={runtimeState.runId ?? ''}
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
        data-raw-fallback-used={runtimeState.rawFallbackUsed ? 'true' : 'false'}
        data-raw-leak={runtimeState.rawLeak ? 'true' : 'false'}
        aria-hidden="true"
      />
      <SectionHeader icon={FileText} title="结果视图" subtitle="优先展示用户本轮要看的结果；更多内容默认收起" />
      {viewPlan.blockedDesign ? <UIDesignBlockerCard blocker={viewPlan.blockedDesign} /> : null}
      <RunStatusSummary
        session={session}
        activeRun={activeRun}
        viewPlan={viewPlan}
        onTriggerRecoverAction={onTriggerRecoverAction}
      />
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
          defaultOpen={model.auditDefaultOpen}
          onOpenDebugAuditAction={onOpenDebugAuditAction}
          onTriggerRecoverAction={onTriggerRecoverAction}
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

function ExecutionOnlyResult({ session, activeRun }: { session: SciForgeSession; activeRun?: SciForgeRun }) {
  const projection = conversationProjectionForSession(session, activeRun ?? session.runs.at(-1));
  const units = auditExecutionUnitsForRun(session, activeRun);
  if (projection) {
    return (
      <div className="stack">
        <ProjectionExecutionOnlyResult projection={projection} />
        <ExecutionPanel session={session} executionUnits={units} activeRun={activeRun} embedded />
      </div>
    );
  }
  return (
    <div className="stack">
      <ExecutionPanel session={session} executionUnits={units} activeRun={activeRun} embedded />
    </div>
  );
}

function ProjectionExecutionOnlyResult({ projection }: { projection: UiConversationProjection }) {
  const events = projection.executionProcess.slice(-12);
  return (
    <div className="stack">
      <Card className="code-card">
        <SectionHeader icon={Terminal} title="Projection 执行过程" subtitle={conversationProjectionStatus(projection)} />
        {events.length ? (
          <div className="run-status-lines">
            {events.map((event) => (
              <span key={event.eventId}>{event.type}: {event.summary || event.eventId}</span>
            ))}
          </div>
        ) : <p className="empty-state">当前 ConversationProjection 没有声明执行过程事件。</p>}
      </Card>
    </div>
  );
}

function RunStatusSummary({
  session,
  activeRun,
  viewPlan,
  onTriggerRecoverAction,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  onTriggerRecoverAction?: (action: TriggerRecoverUIAction) => void;
}) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  const failures = projection ? [] : failedExecutionUnits(session, activeRun);
  const blockers = runAuditBlockers(session, activeRun);
  const validationFailures = projection ? [] : contractValidationFailures(session, activeRun);
  const repairStates = projection ? [] : backendRepairStates(session, activeRun);
  const runtimeDriftDiagnostics = runtimeCompatibilityDiagnosticsForPresentation(session, activeRun);
  const recoverActions = runRecoverActions(session, activeRun).slice(0, 4);
  const presentationState = runPresentationState(session, activeRun, viewPlan);
  const shouldShowPresentationState = presentationState.kind !== 'ready' || presentationState.nextSteps.length > 0;
  const failureDriven = failures.length || validationFailures.length;
  const projectionStateDriven = projection && presentationState.kind !== 'ready';
  const statusDriven = failureDriven || projectionStateDriven;
  if (!failures.length && !blockers.length && !validationFailures.length && !repairStates.length && !runtimeDriftDiagnostics.length && !recoverActions.length && !shouldShowPresentationState) return null;
  return (
    <Card className={cx('run-status-summary', failureDriven ? 'failed' : presentationState.kind)}>
      <SectionHeader
        icon={runtimeDriftDiagnostics.length && !statusDriven ? Shield : AlertTriangle}
        title={failureDriven ? '运行需要处理' : projectionStateDriven ? presentationState.title : runtimeDriftDiagnostics.length ? '历史 session 需要兼容性检查' : presentationState.title}
        subtitle={run ? `${run.id} · ${presentationState.kind}` : '当前 session'}
      />
      <RunPresentationStateSummary state={presentationState} />
      {runtimeDriftDiagnostics.map((diagnostic) => <RuntimeCompatibilityDiagnosticSummary key={diagnostic.id} diagnostic={diagnostic} />)}
      {blockers.length ? (
        <div className="run-status-lines">
          {blockers.map((line) => <span key={line}>{compactVisibleFailureText(line)}</span>)}
        </div>
      ) : null}
      {failures.map((unit) => (
        <div className="run-failure-card" key={unit.id}>
          <strong>{unit.id}</strong>
          <p>{compactVisibleFailureText(unit.failureReason || unit.selfHealReason || unit.nextStep || '执行失败，详情已保留在运行审计中。')}</p>
          <p className="empty-state">{executionUnitRefCount(unit)} audit ref(s) retained for debug details.</p>
        </div>
      ))}
      {validationFailures.map((failure) => <ContractValidationFailureSummary key={contractValidationFailureKey(failure)} failure={failure} compact />)}
      {repairStates.map((state) => <BackendRepairStateSummary key={state.id} state={state} compact />)}
      {recoverActions.length ? (
        <div className="run-recover-actions">
          {recoverActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onTriggerRecoverAction?.(createTriggerRecoverAction(session, activeRun, action))}
            >
              {action}
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function RuntimeCompatibilityDiagnosticSummary({ diagnostic }: { diagnostic: RuntimeCompatibilityDiagnostic }) {
  return (
    <div className="run-failure-card">
      <strong>{diagnostic.kind}</strong>
      <p>{compactVisibleFailureText(diagnostic.reason)}</p>
      <div className="slot-meta">
        <strong>兼容性指纹</strong>
        <code>current: {diagnostic.current.compatibilityVersion}</code>
        {diagnostic.persisted ? <code>persisted: {diagnostic.persisted.compatibilityVersion}</code> : null}
      </div>
      <div className="run-recover-actions">
        {diagnostic.recoverableActions.map((action) => <code key={action}>{action}</code>)}
      </div>
    </div>
  );
}

function RunPresentationStateSummary({ state }: { state: RunPresentationState }) {
  if (state.kind === 'ready' && !state.nextSteps.length) return null;
  return (
    <div className="run-presentation-state">
      <div className="run-status-lines">
        <span>{state.reason}</span>
      </div>
      {state.availableArtifacts.length ? (
        <div className="slot-meta">
          <strong>可用产物</strong>
          {state.availableArtifacts.slice(0, 6).map((artifact) => (
            <code key={artifact.id}>{artifact.type}: {artifact.title ?? artifact.id}</code>
          ))}
        </div>
      ) : null}
      {state.progress ? <RunProgressSummary progress={state.progress} /> : null}
      {state.nextSteps.length ? (
        <div className="run-recover-actions">
          {state.nextSteps.map((action) => <code key={action}>{action}</code>)}
        </div>
      ) : null}
    </div>
  );
}

function RunProgressSummary({ progress }: { progress: NonNullable<RunPresentationState['progress']> }) {
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
          <strong>已完成部分</strong>
          {progress.completedParts.slice(0, 6).map((part) => (
            <code key={`${part.id}-${part.ref ?? ''}`}>{part.label}{part.ref ? ` · ${part.ref}` : ''}</code>
          ))}
        </div>
      ) : null}
      {progress.currentStage || progress.backgroundStatus ? (
        <div className="run-status-lines">
          {progress.currentStage ? <span>当前阶段：{progress.currentStage.label} · {progress.currentStage.status}</span> : null}
          {progress.backgroundStatus ? <span>后台状态：{progress.backgroundStatus}</span> : null}
        </div>
      ) : null}
      {progress.safeActions.length ? (
        <div className="run-recover-actions">
          {progress.safeActions.map((action) => (
            <code key={`${action.kind}-${action.label}-${action.ref ?? ''}`}>{action.safe ? 'safe' : 'confirm'} · {action.label}</code>
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
  onOpenDebugAuditAction,
  onTriggerRecoverAction,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  defaultOpen?: boolean;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  onTriggerRecoverAction?: (action: TriggerRecoverUIAction) => void;
}) {
  const rawItems = rawAuditItems(session, activeRun, viewPlan);
  const failureCount = failedExecutionUnits(session, activeRun).length;
  const units = auditExecutionUnitsForRun(session, activeRun ?? session.runs.at(-1));
  return (
    <details
      className="result-details-panel audit-details-panel"
      open={defaultOpen}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpenDebugAuditAction?.(createOpenDebugAuditAction(session, activeRun));
      }}
    >
      <summary>
        <span>查看运行细节</span>
        <Badge variant={failureCount ? 'danger' : 'muted'}>
          {failureCount ? `${failureCount} failure` : `${units.length} EU`}
        </Badge>
      </summary>
      <RunAuditOverview session={session} activeRun={activeRun} onTriggerRecoverAction={onTriggerRecoverAction} />
      <ExecutionPanel session={session} executionUnits={units} embedded />
      <NotebookTimeline scenarioId={scenarioId} notebook={session.notebook} embedded />
      <Card className="code-card">
        <SectionHeader icon={Terminal} title="运行审计材料" />
        <p className="empty-state">{rawItems.length} structured audit item(s) retained for debug/export details.</p>
      </Card>
    </details>
  );
}

function RunAuditOverview({
  session,
  activeRun,
  onTriggerRecoverAction,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  onTriggerRecoverAction?: (action: TriggerRecoverUIAction) => void;
}) {
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
          {recoverActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onTriggerRecoverAction?.(createTriggerRecoverAction(session, activeRun, action))}
            >
              {action}
            </button>
          ))}
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
      {refs.length ? <p className="empty-state">{refs.length} audit ref(s) retained for debug details.</p> : null}
    </Card>
  );
}

function executionUnitRefCount(unit: RuntimeExecutionUnit) {
  return [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef].filter(Boolean).length;
}

function ContractValidationFailureSummary({ failure, compact = false }: { failure: ContractValidationFailure; compact?: boolean }) {
  const issueLines = failure.issues.map((issue) => [
    issue.path || issue.missingField || issue.invalidRef || issue.unresolvedUri || 'issue',
    issue.message,
  ].filter(Boolean).join(': '));
  return (
    <div className="run-failure-card">
      <strong>ContractValidationFailure · {failure.failureKind}</strong>
      <p>{compact ? compactVisibleFailureText(failure.failureReason) : failure.failureReason}</p>
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
  const statusText = [state.status ? `status=${state.status}` : undefined, state.failureReason].filter(Boolean).join(' · ') || 'repair metadata recorded';
  return (
    <div className="run-failure-card">
      <strong>Backend repair state · {state.label}</strong>
      <p>{compact ? compactVisibleFailureText(statusText) : statusText}</p>
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

function createTriggerRecoverAction(session: SciForgeSession, activeRun: SciForgeRun | undefined, recoverAction: string): TriggerRecoverUIAction {
  return createTriggerRecoverUIAction({
    id: makeId('ui-action'),
    session,
    createdAt: nowIso(),
    runId: activeRun?.id,
    recoverAction,
    auditRefs: runAuditRefs(session, activeRun),
  });
}

function createOpenDebugAuditAction(session: SciForgeSession, activeRun: SciForgeRun | undefined): OpenDebugAuditUIAction {
  return createOpenDebugAuditUIAction({
    id: makeId('ui-action'),
    session,
    createdAt: nowIso(),
    runId: activeRun?.id,
    auditRefs: runAuditRefs(session, activeRun),
  });
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

function compactVisibleFailureText(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  const reasonMatch = text.match(/reason=([^.;]+(?:[.;]|$))/i);
  const previousFailureMatch = text.match(/Previous failure:\s*([^.;]+(?:[.;]|$))/i);
  const contractMatch = text.match(/ContractValidationFailure(?:\s+|\()([a-z-]+)/i);
  const pieces = [
    contractMatch ? `ContractValidationFailure ${contractMatch[1]}` : undefined,
    previousFailureMatch?.[1]?.replace(/[.;]\s*$/, ''),
    reasonMatch?.[1]?.replace(/[.;]\s*$/, ''),
  ].filter((piece): piece is string => Boolean(piece));
  const compact = pieces.length ? Array.from(new Set(pieces)).join(' · ') : text;
  return compact.length > 260 ? `${compact.slice(0, 257).trim()}...` : compact;
}

function ViewPlanSummary({ viewPlan, session, activeRun }: { viewPlan: RuntimeResolvedViewPlan; session: SciForgeSession; activeRun?: SciForgeRun }) {
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
        <strong>{viewPlan.displayIntent.primaryGoal}</strong>
        <span>{summary.summaryText}</span>
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
