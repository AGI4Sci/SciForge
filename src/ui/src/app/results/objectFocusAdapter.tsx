import type { ObjectAction, ObjectReference, PreviewDescriptor, SciForgeConfig, SciForgeSession } from '../../domain';
import {
  availableObjectActions,
  objectReferenceKindLabel,
} from '../../../../../packages/support/object-references';
import { objectActionLabel } from '../results-renderer-object-actions';
import { Badge } from '../uiPrimitives';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import { WorkspaceObjectPreview } from './WorkspaceObjectPreview';

export function visibleObjectFocusActions(actions: ObjectAction[]) {
  return actions.filter((action) => action !== 'focus-right-pane').slice(0, 6);
}

export function RightPaneObjectFocusSurface({
  reference,
  pinnedReferences,
  session,
  config,
  locale,
  error,
  notice,
  previewDisabled,
  suppressReferenceUi,
  onAction,
  onClear,
  onPreviewPackageRequest,
  onObjectReferenceFocus,
}: {
  reference?: ObjectReference;
  pinnedReferences: ObjectReference[];
  session: SciForgeSession;
  config: SciForgeConfig;
  locale?: ResultLocale;
  error?: string;
  notice?: string;
  previewDisabled?: boolean;
  suppressReferenceUi?: boolean;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
  onClear: () => void;
  onPreviewPackageRequest?: (reference: ObjectReference, path?: string, descriptor?: PreviewDescriptor) => void;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  if (!reference || suppressReferenceUi) {
    return error ? <div className="object-action-error">{boundedRightPaneText(error, 800)}</div> : null;
  }
  const actions = visibleObjectFocusActions(availableObjectActions(reference, session));
  return (
    <>
      <ObjectFocusBanner
        reference={reference}
        pinnedReferences={pinnedReferences}
        actions={actions}
        error={error}
        notice={notice}
        locale={locale}
        onAction={onAction}
        onClear={onClear}
      />
      {!previewDisabled ? (
        <WorkspaceObjectPreview
          reference={reference}
          session={session}
          config={config}
          locale={locale}
          onPreviewPackageRequest={onPreviewPackageRequest}
          onObjectReferenceFocus={onObjectReferenceFocus}
        />
      ) : null}
    </>
  );
}

function ObjectFocusBanner({
  reference,
  pinnedReferences,
  actions,
  error,
  notice,
  locale,
  onAction,
  onClear,
}: {
  reference: ObjectReference;
  pinnedReferences: ObjectReference[];
  actions: ObjectAction[];
  error?: string;
  notice?: string;
  locale?: ResultLocale;
  onAction: (reference: ObjectReference, action: ObjectAction) => void | Promise<void>;
  onClear: () => void;
}) {
  return (
    <div className="object-focus-banner" data-testid="right-pane-object-focus-banner">
      <div>
        <Badge variant="info">{objectReferenceKindLabel(reference.kind)}</Badge>
        <strong>{rightPaneInlineLabel(reference.title)}</strong>
        <span>{rightPaneInlineLabel(reference.summary || reference.ref)}</span>
      </div>
      <div className="object-focus-actions">
        {actions.map((action) => (
          <button key={action} type="button" onClick={() => void onAction(reference, action)}>
            {objectActionLabel(action)}
          </button>
        ))}
        <button type="button" onClick={onClear}>{resultText(locale, { 'zh-CN': '清除', 'en-US': 'Clear' })}</button>
      </div>
      {pinnedReferences.length ? (
        <div className="pinned-object-row">
          <span>{resultText(locale, { 'zh-CN': '已固定', 'en-US': 'pinned' })}</span>
          {pinnedReferences.map((item) => <code key={item.id}>{rightPaneInlineLabel(item.title)}</code>)}
        </div>
      ) : null}
      {notice ? <p className="object-action-notice">{boundedRightPaneText(notice, 800)}</p> : null}
      {error ? <p className="object-action-error">{boundedRightPaneText(error, 800)}</p> : null}
    </div>
  );
}
