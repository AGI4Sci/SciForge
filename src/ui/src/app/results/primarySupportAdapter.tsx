import { useState, type ReactNode } from 'react';
import { Sparkles, Terminal } from 'lucide-react';
import { interactiveViewResultSummaryPresentation } from '../../../../../packages/presentation/interactive-views';
import type { ScenarioId } from '../../data';
import type { SciForgeRun, SciForgeSession } from '../../domain';
import { Badge, Card, SectionHeader } from '../uiPrimitives';
import {
  conversationProjectionForSession,
  conversationProjectionStatus,
  type UiConversationProjection,
} from '../conversation-projection-view-model';
import {
  contractValidationFailures,
  failedExecutionUnits,
  runPresentationState,
  type RunPresentationState,
} from '../results-renderer-execution-model';
import type { ResultsRendererManifestDiagnostic, ResultsRendererViewModel } from '../results-renderer-view-model';
import { capabilityPlanSummaryForSession, type CapabilityPlanSummary } from '../projectionApi';
import type { CommandTextUIAction, OpenDebugAuditUIAction } from '../uiActionBoundary';
import { ExecutionPanel } from './ExecutionNotebookPanels';
import { auditExecutionUnitsForRun } from './executionUnitsForRun';
import {
  RunAuditDetails,
  requestOpenDebugAuditThroughUserActionApi,
} from './primaryAuditAdapter';
import {
  RunStatusSummary,
  RuntimeCompatibilityDetails,
  runtimeCompatibilityDiagnosticsForPresentation,
} from './primaryRunStatusAdapter';
import { boundedRightPaneText, rightPaneInlineLabel, rightPaneSafeRefs } from './previewSafety';
import { resultCountText, resultText, type ResultLocale } from './resultLocale';
import type { RuntimeResolvedViewPlan } from './viewPlanResolver';

export function PrimarySupportDetails({
  scenarioId,
  session,
  activeRun,
  model,
  locale,
  onCommandTextAction,
  onOpenDebugAuditAction,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  model: ResultsRendererViewModel;
  locale?: ResultLocale;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
}) {
  const { viewPlan } = model;
  const hasResultPreview = model.visibleItems.length > 0 || model.deferredItems.length > 0;
  const compatibilityDiagnostics = runtimeCompatibilityDiagnosticsForPresentation(session, activeRun);
  const capabilitySummary = capabilityPlanSummaryForSession(session, activeRun?.id);
  const hasSupportDetails = hasResultPreview
    || (capabilitySummary && capabilitySummary.status !== 'none')
    || (!hasResultPreview && compatibilityDiagnostics.length > 0)
    || model.auditOpen
    || viewPlan.allItems.length > 0;
  if (!hasSupportDetails) return null;
  return (
    <ResultSupportDetails locale={locale}>
      {hasResultPreview ? (
        <RunStatusSummary
          session={session}
          activeRun={activeRun}
          viewPlan={viewPlan}
          locale={locale}
          onCommandTextAction={onCommandTextAction}
        />
      ) : null}
      <CapabilityPlanSummaryCard
        summary={capabilitySummary}
        session={session}
        activeRun={activeRun}
        locale={locale}
        onOpenDebugAuditAction={onOpenDebugAuditAction}
      />
      {!hasResultPreview && compatibilityDiagnostics.length ? (
        <RuntimeCompatibilityDetails diagnostics={compatibilityDiagnostics} locale={locale} />
      ) : null}
      {model.auditOpen ? (
        <RunAuditDetails
          scenarioId={scenarioId}
          session={session}
          activeRun={activeRun}
          viewPlan={viewPlan}
          defaultOpen={model.auditDefaultOpen}
          locale={locale}
          onOpenDebugAuditAction={onOpenDebugAuditAction}
          onCommandTextAction={onCommandTextAction}
        />
      ) : null}
      {viewPlan.allItems.length ? (
        <ViewPlanDetails viewPlan={viewPlan} session={session} activeRun={activeRun} items={model.manifestDiagnostics} locale={locale} />
      ) : null}
    </ResultSupportDetails>
  );
}

function ResultSupportDetails({ children, locale }: { children: ReactNode; locale?: ResultLocale }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="result-details-panel subtle"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '更多', 'en-US': 'More' })}</span>
        <Badge variant="muted">{resultText(locale, { 'zh-CN': '已折叠', 'en-US': 'folded' })}</Badge>
      </summary>
      {expanded ? <div className="stack">{children}</div> : null}
    </details>
  );
}

function CapabilityPlanSummaryCard({
  summary,
  session,
  activeRun,
  locale,
  onOpenDebugAuditAction,
}: {
  summary?: CapabilityPlanSummary;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  locale?: ResultLocale;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!summary || summary.status === 'none') return null;
  return (
    <details
      className="result-details-panel subtle"
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
        <span>{resultText(locale, { 'zh-CN': '计划', 'en-US': 'Plan' })}</span>
        <Badge variant="muted">{summary.debugRefs.length
          ? resultCountText(locale, summary.debugRefs.length, {
            zh: (count) => `${count} 条来源`,
            en: (count) => `${count} sources`,
          })
          : resultText(locale, { 'zh-CN': '已记录', 'en-US': 'saved' })}</Badge>
      </summary>
      {expanded ? (
        <Card className="capability-plan-summary">
          <SectionHeader
            icon={Sparkles}
            title={resultText(locale, { 'zh-CN': '运行计划', 'en-US': 'Run plan' })}
            subtitle={resultText(locale, { 'zh-CN': '已选择的工具', 'en-US': 'Selected tools' })}
          />
          <p>{boundedRightPaneText(summary.summary, 800)}</p>
          {summary.debugRefs.length ? (
            <div className="inspector-ref-list">
              {rightPaneSafeRefs(summary.debugRefs, 8).map((ref) => <code key={ref}>{ref}</code>)}
            </div>
          ) : null}
        </Card>
      ) : null}
    </details>
  );
}

export function PrimaryExecutionOnlyResult({ session, activeRun, locale }: { session: SciForgeSession; activeRun?: SciForgeRun; locale?: ResultLocale }) {
  const projection = conversationProjectionForSession(session, activeRun ?? session.runs.at(-1));
  const units = auditExecutionUnitsForRun(session, activeRun);
  if (projection) {
    return (
      <div className="stack">
        <ProjectionExecutionOnlyResult projection={projection} locale={locale} />
        <ExecutionPanel session={session} executionUnits={units} activeRun={activeRun} embedded locale={locale} />
      </div>
    );
  }
  return (
    <div className="stack">
      <ExecutionPanel session={session} executionUnits={units} activeRun={activeRun} embedded locale={locale} />
    </div>
  );
}

function ProjectionExecutionOnlyResult({ projection, locale }: { projection: UiConversationProjection; locale?: ResultLocale }) {
  const events = projection.executionProcess.slice(-12);
  const status = conversationProjectionStatus(projection);
  return (
    <div className="stack">
      <Card className="code-card">
        <SectionHeader icon={Terminal} title={resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' })} subtitle={projectionStatusLabel(status, locale)} />
        {events.length ? (
          <div className="run-status-lines">
            {events.map((event) => (
              <span key={event.eventId}>{projectionEventLabel(event.type, status, locale)}: {boundedRightPaneText(projectionEventSummary(event.summary || event.eventId, status, locale), 500)}</span>
            ))}
          </div>
        ) : <p className="empty-state">{resultText(locale, { 'zh-CN': '此结果还没有关联活动。', 'en-US': 'No activity has been attached to this result yet.' })}</p>}
      </Card>
    </div>
  );
}

function projectionStatusLabel(status: ReturnType<typeof conversationProjectionStatus>, locale?: ResultLocale) {
  const labels: Record<ReturnType<typeof conversationProjectionStatus>, Record<ResultLocale, string>> = {
    idle: { 'zh-CN': '未运行', 'en-US': 'Not run' },
    planned: { 'zh-CN': '已计划', 'en-US': 'Planned' },
    dispatched: { 'zh-CN': '已开始', 'en-US': 'Started' },
    'partial-ready': { 'zh-CN': '部分结果', 'en-US': 'Partial result' },
    'output-materialized': { 'zh-CN': '输出已保存', 'en-US': 'Output saved' },
    validated: { 'zh-CN': '已验证', 'en-US': 'Validated' },
    'visible-not-live-acceptance': { 'zh-CN': '回答已显示', 'en-US': 'Answer shown' },
    satisfied: { 'zh-CN': '完成', 'en-US': 'Complete' },
    'degraded-result': { 'zh-CN': '部分结果', 'en-US': 'Partial result' },
    'external-blocked': { 'zh-CN': '已阻塞', 'en-US': 'Blocked' },
    'repair-needed': { 'zh-CN': '需要恢复', 'en-US': 'Needs recovery' },
    'needs-human': { 'zh-CN': '需要输入', 'en-US': 'Needs input' },
    'background-running': { 'zh-CN': '仍在运行', 'en-US': 'Still running' },
  };
  return resultText(locale, labels[status]);
}

function projectionEventLabel(type: string, status: ReturnType<typeof conversationProjectionStatus>, locale?: ResultLocale) {
  if (status === 'visible-not-live-acceptance' || /native.?codex.?message/i.test(type)) return resultText(locale, { 'zh-CN': '回答', 'en-US': 'Answer' });
  if (/artifact|output|materialized/i.test(type)) return resultText(locale, { 'zh-CN': '输出', 'en-US': 'Output' });
  if (/verification|validated/i.test(type)) return resultText(locale, { 'zh-CN': '检查', 'en-US': 'Check' });
  return resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' });
}

function projectionEventSummary(summary: string, status: ReturnType<typeof conversationProjectionStatus>, locale?: ResultLocale) {
  if (status === 'visible-not-live-acceptance' || /native.?codex.?message/i.test(summary)) return resultText(locale, { 'zh-CN': '回答已显示在聊天中', 'en-US': 'Answer shown in chat' });
  return summary;
}

function ViewPlanSummary({ viewPlan, session, activeRun }: { viewPlan: RuntimeResolvedViewPlan; session: SciForgeSession; activeRun?: SciForgeRun; locale?: ResultLocale }) {
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
        <strong>{rightPaneInlineLabel(viewPlan.displayIntent.primaryGoal)}</strong>
        <span>{boundedRightPaneText(summary.summaryText, 500)}</span>
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

function ViewPlanDetails({
  viewPlan,
  session,
  activeRun,
  items,
  locale,
}: {
  viewPlan: RuntimeResolvedViewPlan;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  items: ResultsRendererManifestDiagnostic[];
  locale?: ResultLocale;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="result-details-panel subtle"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{resultText(locale, { 'zh-CN': '展示', 'en-US': 'Presentation' })}</span>
        <Badge variant="muted">{resultCountText(locale, items.length, {
          zh: (count) => `${count} 项`,
          en: (count) => `${count} items`,
        })}</Badge>
      </summary>
      {expanded ? (
        <>
          <ViewPlanSummary viewPlan={viewPlan} session={session} activeRun={activeRun} locale={locale} />
          <ManifestDiagnostics items={items} locale={locale} />
        </>
      ) : null}
    </details>
  );
}

function ManifestDiagnostics({ items, locale }: { items: ResultsRendererManifestDiagnostic[]; locale?: ResultLocale }) {
  return (
    <div className="manifest-diagnostics">
      {items.map((item) => (
        <code key={item.id} title={rightPaneInlineLabel(item.detail)}>
          {rightPaneInlineLabel(item.label)} · {resultStatusLabel(item.status, locale)}
        </code>
      ))}
    </div>
  );
}

function resultStatusLabel(status: string, locale?: ResultLocale) {
  if (status === 'bound') return resultText(locale, { 'zh-CN': '可用', 'en-US': 'Ready' });
  if (status === 'fallback') return resultText(locale, { 'zh-CN': '备用视图', 'en-US': 'Alternate view' });
  if (status === 'missing-artifact') return resultText(locale, { 'zh-CN': '等待内容', 'en-US': 'Waiting for content' });
  if (status === 'missing-component') return resultText(locale, { 'zh-CN': '等待视图', 'en-US': 'Waiting for view' });
  return resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' });
}
