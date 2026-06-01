import { useState } from 'react';
import { AlertTriangle, Shield } from 'lucide-react';
import type { RuntimeCompatibilityDiagnostic, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';
import { Badge, Card, SectionHeader, cx } from '../uiPrimitives';
import {
  conversationProjectionForSession,
  conversationProjectionStatus,
} from '../conversation-projection-view-model';
import {
  backendRepairStates,
  contractValidationFailureKey,
  contractValidationFailures,
  failedExecutionUnits,
  runAuditBlockers,
  runPresentationState,
  runRecoverActions,
  type RunPresentationState,
} from '../results-renderer-execution-model';
import type { CommandTextUIAction } from '../uiActionBoundary';
import {
  BackendRepairStateSummary,
  ContractValidationFailureSummary,
  compactVisibleFailureText,
  requestRecoverCommandTextAction,
} from './primaryAuditAdapter';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultCountText, resultText, type ResultLocale } from './resultLocale';
import type { RuntimeResolvedViewPlan } from './viewPlanResolver';

export function RunStatusSummary({
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

export function RuntimeCompatibilityDetails({ diagnostics, locale }: { diagnostics: RuntimeCompatibilityDiagnostic[]; locale?: ResultLocale }) {
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

function executionUnitRefCount(unit: RuntimeExecutionUnit) {
  return [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef].filter(Boolean).length;
}

export function runtimeCompatibilityDiagnosticsForPresentation(session: SciForgeSession, activeRun?: SciForgeRun): RuntimeCompatibilityDiagnostic[] {
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
