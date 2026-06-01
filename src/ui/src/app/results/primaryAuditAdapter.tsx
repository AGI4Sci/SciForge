import { useState } from 'react';
import { Shield, Terminal } from 'lucide-react';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract';
import type { ScenarioId } from '../../data';
import type { SciForgeRun, SciForgeSession } from '../../domain';
import { Badge, Card, SectionHeader } from '../uiPrimitives';
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
} from '../results-renderer-execution-model';
import { createRecoverCommandTextUIAction, type CommandTextUIAction, type OpenDebugAuditUIAction } from '../uiActionBoundary';
import { createLocalUserActionApi, type UserActionApi } from '../projectionApi';
import { ExecutionPanel, NotebookTimeline } from './ExecutionNotebookPanels';
import { auditExecutionUnitsForRun } from './executionUnitsForRun';
import { boundedRightPaneText, rightPaneInlineLabel, rightPaneSafeRefs } from './previewSafety';
import { resultCountText, resultText, type ResultLocale } from './resultLocale';
import type { RuntimeResolvedViewPlan } from './viewPlanResolver';

export function RunAuditDetails({
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

export function ContractValidationFailureSummary({ failure, compact = false, locale }: { failure: ContractValidationFailure; compact?: boolean; locale?: ResultLocale }) {
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

export function BackendRepairStateSummary({ state, compact = false, locale }: { state: BackendRepairState; compact?: boolean; locale?: ResultLocale }) {
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
    id: auditActionId('command-recover'),
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

export function compactVisibleFailureText(value: string, locale?: ResultLocale) {
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

function auditActionId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
