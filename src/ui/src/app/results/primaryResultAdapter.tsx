import { FolderTree, Globe2, Image as ImageIcon, Terminal } from 'lucide-react';
import type { ScenarioId } from '../../data';
import type { SciForgeConfig, SciForgeRun, SciForgeSession, ObjectReference, RuntimeArtifact } from '../../domain';
import { Badge, EmptyArtifactState } from '../uiPrimitives';
import { browserVisibleRuntimeState } from '../results-renderer-execution-model';
import type { ResolvedViewPlanItem, ResultsRendererViewModel, RuntimeResolvedViewPlan } from '../results-renderer-view-model';
import { RegistrySlot } from '../results-renderer-registry-slot';
import type { CommandTextUIAction, OpenDebugAuditUIAction } from '../uiActionBoundary';
import type { ResultFocusMode, ResultPaneTab } from './ResultShell';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultCountText, resultText, type ResultLocale } from './resultLocale';
import {
  PrimaryExecutionOnlyResult,
  PrimarySupportDetails,
} from './primarySupportAdapter';

export function PrimaryResultAdapter({
  scenarioId,
  config,
  session,
  activeRun,
  focusMode,
  model,
  locale,
  onArtifactHandoff,
  onInspectArtifact,
  onObjectReferenceFocus,
  onDismissResultSlotPresentation,
  onCommandTextAction,
  onOpenDebugAuditAction,
  onWorkbenchToolSelect,
}: {
  scenarioId: ScenarioId;
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  focusMode: ResultFocusMode;
  model: ResultsRendererViewModel;
  locale?: ResultLocale;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
  onInspectArtifact: (artifact: RuntimeArtifact) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
  onDismissResultSlotPresentation?: (resolvedSlotPresentationId: string) => void;
  onCommandTextAction?: (action: CommandTextUIAction) => void;
  onOpenDebugAuditAction?: (action: OpenDebugAuditUIAction) => void;
  onWorkbenchToolSelect: (tab: ResultPaneTab) => void;
}) {
  const { viewPlan } = model;
  const runtimeState = browserVisibleRuntimeState(session, activeRun, viewPlan);
  if (focusMode === 'execution') {
    return <PrimaryExecutionOnlyResult session={session} activeRun={activeRun} locale={locale} />;
  }
  return (
    <div className="stack">
      <div
        className="runtime-visible-state-hook"
        data-testid="runtime-visible-state"
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
        data-fallback-used={runtimeState.rawFallbackUsed ? 'true' : 'false'}
        data-diagnostic-leak={runtimeState.rawLeak ? 'true' : 'false'}
        aria-hidden="true"
      />
      {viewPlan.blockedDesign ? <PrimaryDesignBlockerCard blocker={viewPlan.blockedDesign} locale={locale} /> : null}
      {model.emptyState ? (
        <>
          <EmptyArtifactState
            title={model.emptyState.title}
            detail={model.emptyState.detail}
            recoverActions={model.emptyState.recoverActions}
          />
          <RightPaneToolDock locale={locale} onSelect={onWorkbenchToolSelect} />
        </>
      ) : null}
      <PrimaryResultItemsSection
        title={model.primaryTitle}
        items={model.visibleItems}
        scenarioId={scenarioId}
        config={config}
        session={session}
        onArtifactHandoff={onArtifactHandoff}
        onInspectArtifact={onInspectArtifact}
        onObjectReferenceFocus={onObjectReferenceFocus}
        onDismissResultSlotPresentation={onDismissResultSlotPresentation}
        locale={locale}
      />
      {model.deferredSections.length ? (
        <details className="result-details-panel">
          <summary>
            <span>{resultText(locale, { 'zh-CN': '更多结果', 'en-US': 'More results' })}</span>
            <Badge variant="muted">{resultCountText(locale, model.deferredItems.length, {
              zh: (count) => `${count} 项已折叠`,
              en: (count) => `${count} folded`,
            })}</Badge>
          </summary>
          {model.deferredSections.map((section) => (
            <PrimaryResultItemsSection
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
              locale={locale}
            />
          ))}
        </details>
      ) : null}
      <PrimarySupportDetails
        scenarioId={scenarioId}
        session={session}
        activeRun={activeRun}
        model={model}
        locale={locale}
        onCommandTextAction={onCommandTextAction}
        onOpenDebugAuditAction={onOpenDebugAuditAction}
      />
    </div>
  );
}

function PrimaryDesignBlockerCard({ blocker, locale }: { blocker: NonNullable<RuntimeResolvedViewPlan['blockedDesign']>; locale?: ResultLocale }) {
  return (
    <div className="ui-design-blocker">
      <Badge variant="warning">blocked-awaiting-ui-design</Badge>
      <strong>{resultText(locale, { 'zh-CN': '需要先设计并发布一个 UI 模块', 'en-US': 'Design and publish a UI module first' })}</strong>
      <p>{boundedRightPaneText(blocker.reason, 800)}</p>
      <div className="slot-meta">
        <code>{rightPaneInlineLabel(blocker.requiredModuleCapability)}</code>
        {blocker.resumeRunId ? <code>resumeRunId={rightPaneInlineLabel(blocker.resumeRunId)}</code> : null}
      </div>
    </div>
  );
}

function RightPaneToolDock({
  locale,
  onSelect,
}: {
  locale?: ResultLocale;
  onSelect: (tab: ResultPaneTab) => void;
}) {
  const tools: Array<{ tab: ResultPaneTab; label: string; detail: string; Icon: typeof Globe2 }> = [
    {
      tab: 'browser',
      label: resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' }),
      detail: resultText(locale, { 'zh-CN': '页面预览和截图', 'en-US': 'Page preview and screenshots' }),
      Icon: Globe2,
    },
    {
      tab: 'image',
      label: resultText(locale, { 'zh-CN': '图片 / 证据', 'en-US': 'Image / Evidence' }),
      detail: resultText(locale, { 'zh-CN': '图片、标注、裁剪和来源', 'en-US': 'Images, annotations, crops, and source details' }),
      Icon: ImageIcon,
    },
    {
      tab: 'terminal',
      label: resultText(locale, { 'zh-CN': '终端', 'en-US': 'Terminal' }),
      detail: resultText(locale, { 'zh-CN': '命令输入、运行输出、停止/复制', 'en-US': 'Command input, output, stop/copy' }),
      Icon: Terminal,
    },
    {
      tab: 'files',
      label: resultText(locale, { 'zh-CN': '文件', 'en-US': 'Files' }),
      detail: resultText(locale, { 'zh-CN': '文件树、查看、编辑和保存', 'en-US': 'File tree, inspect, edit, save' }),
      Icon: FolderTree,
    },
  ];

  return (
    <section className="right-pane-tool-dock" aria-label={resultText(locale, { 'zh-CN': '右侧工具区', 'en-US': 'Right pane tools' })}>
      {tools.map(({ tab, label, detail, Icon }) => (
        <button key={tab} type="button" onClick={() => onSelect(tab)} data-right-pane-tool={tab}>
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
          <small>{detail}</small>
        </button>
      ))}
    </section>
  );
}

function PrimaryResultItemsSection({
  title,
  items,
  scenarioId,
  config,
  session,
  locale,
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
  locale?: ResultLocale;
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
            locale={locale}
          />
        ))}
      </div>
    </section>
  );
}
