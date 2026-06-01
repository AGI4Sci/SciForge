import { Fragment } from 'react';
import type { ObjectAction, ObjectReference, SciForgeRun, SciForgeSession } from '../../domain';
import { availableObjectActions } from '../../../../../packages/support/object-references';
import { Badge } from '../uiPrimitives';
import { objectActionLabel, resultTabForObjectReference } from '../results-renderer-object-actions';
import { rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import type { RuntimeResolvedViewPlan } from './viewPlanResolver';
import {
  buildRightPaneReferencesTraceIndex,
  groupObjectReferencesByKind,
  rightPaneCopyableReferenceText,
  rightPaneObjectReferences,
  rightPaneReferenceKindGroupLabel,
  rightPaneReferenceKindIsKnown,
  rightPaneReferenceProvenanceRows,
  rightPaneReferenceTraceRows,
} from './referencesPaneModel';

export function RightPaneReferencesTool({
  session,
  activeRun,
  viewPlan,
  pinnedReferences,
  locale,
  onAction,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan?: Pick<RuntimeResolvedViewPlan, 'allItems' | 'diagnostics'>;
  pinnedReferences: ObjectReference[];
  locale?: ResultLocale;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
}) {
  const references = rightPaneObjectReferences(session, activeRun);
  const grouped = groupObjectReferencesByKind(references);
  const traceIndex = buildRightPaneReferencesTraceIndex({ session, activeRun, references, viewPlan });
  if (!references.length) {
    return (
      <div className="right-pane-references-inspector" data-testid="right-pane-references-tool" data-state="empty">
        <strong>{resultText(locale, { 'zh-CN': '没有对象引用', 'en-US': 'No object references' })}</strong>
        <span>{resultText(locale, { 'zh-CN': '当回答、过程或结果声明 refs 后会显示在这里。', 'en-US': 'Declared refs from answers, process rows, and results appear here.' })}</span>
      </div>
    );
  }
  return (
    <div className="right-pane-references-inspector" data-testid="right-pane-references-tool" data-state="ready">
      {grouped.map((group) => (
        <section key={group.kind} className="right-pane-reference-group" data-reference-kind={group.kind}>
          <div className="view-plan-section-head">
            <span>{rightPaneReferenceKindGroupLabel(group.kind)}</span>
            <Badge variant="muted">{group.references.length}</Badge>
          </div>
          <div className="right-pane-reference-list">
            {group.references.map((reference) => {
              const unsupported = !rightPaneReferenceKindIsKnown(reference);
              const actions = availableObjectActions(reference, session);
              const targetTab = unsupported ? 'evidence' : resultTabForObjectReference(reference);
              const isPinned = pinnedReferences.some((item) => item.id === reference.id);
              return (
                <article
                  key={`${reference.kind}:${reference.id}:${reference.ref}`}
                  className="right-pane-reference-card"
                  data-focus-target={targetTab}
                  data-reference-state={unsupported ? 'unsupported' : reference.status ?? 'available'}
                >
                  <div>
                    <Badge variant={unsupported || reference.status === 'blocked' || reference.status === 'missing' ? 'warning' : 'info'}>
                      {unsupported ? 'unsupported' : reference.status ?? 'available'}
                    </Badge>
                    <strong>{rightPaneInlineLabel(reference.title || reference.ref)}</strong>
                    <span>{rightPaneInlineLabel(reference.summary || reference.ref)}</span>
                  </div>
                  <code>{rightPaneInlineLabel(reference.ref)}</code>
                  {renderRightPaneReferenceProvenance(reference, locale)}
                  {renderRightPaneReferenceTrace(reference, traceIndex, locale)}
                  <div className="object-focus-actions">
                    {unsupported ? null : actions.slice(0, 5).map((action) => (
                      <button key={action} type="button" onClick={() => void onAction(reference, action)}>
                        {action === 'focus-right-pane'
                          ? resultText(locale, { 'zh-CN': '打开', 'en-US': 'Open' })
                          : objectActionLabel(action)}
                      </button>
                    ))}
                    <button type="button" data-reference-action="copy-ref" onClick={() => copyRightPaneReference(reference.ref)}>
                      {resultText(locale, { 'zh-CN': '复制', 'en-US': 'Copy' })}
                    </button>
                    {isPinned ? <span>{resultText(locale, { 'zh-CN': '已固定', 'en-US': 'Pinned' })}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function renderRightPaneReferenceTrace(reference: ObjectReference, traceIndex: ReturnType<typeof buildRightPaneReferencesTraceIndex>, locale?: ResultLocale) {
  const rows = rightPaneReferenceTraceRows(reference, traceIndex);
  if (!rows.length) return null;
  return (
    <dl className="right-pane-reference-provenance" aria-label={resultText(locale, { 'zh-CN': '链路', 'en-US': 'Trace' })}>
      {rows.map(([key, value]) => (
        <Fragment key={`${key}:${value}`}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function renderRightPaneReferenceProvenance(reference: ObjectReference, locale?: ResultLocale) {
  const rows = rightPaneReferenceProvenanceRows(reference);
  if (!rows.length) return null;
  return (
    <dl className="right-pane-reference-provenance" aria-label={resultText(locale, { 'zh-CN': '来源', 'en-US': 'Provenance' })}>
      {rows.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function copyRightPaneReference(ref: string) {
  if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(rightPaneCopyableReferenceText(ref));
}
