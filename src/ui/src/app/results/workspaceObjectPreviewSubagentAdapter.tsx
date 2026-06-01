import type { ObjectReference } from '../../domain';
import { Badge } from '../uiPrimitives';
import {
  referenceForObjectReference,
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';
import { boundedRightPaneText, rightPaneInlineLabel } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import {
  objectReferenceForSubagentPreviewRef,
  subagentPreviewSafeRefs,
  subagentPreviewSummary,
  type SubagentArtifactPreviewModel,
} from './workspaceObjectPreviewModel';

export function SubagentArtifactPreview({
  preview,
  reference,
  locale,
  onObjectReferenceFocus,
}: {
  preview: SubagentArtifactPreviewModel;
  reference: ObjectReference;
  locale?: ResultLocale;
  onObjectReferenceFocus?: (reference: ObjectReference) => void;
}) {
  const safeTitle = preview.agentId
    ? resultText(locale, { 'zh-CN': '子任务结果', 'en-US': 'Subtask result' })
    : reference.title || reference.ref;
  const summary = subagentPreviewSummary(preview.resultSummary, reference, locale);
  const refs = subagentPreviewSafeRefs(preview);
  return (
    <div className="workspace-object-preview" data-sciforge-reference={sciForgeReferenceAttribute(referenceForObjectReference(reference))}>
      <div className="workspace-object-preview-head">
        <Badge variant="info">{resultText(locale, { 'zh-CN': '子任务结果', 'en-US': 'Subtask result' })}</Badge>
        <strong>{rightPaneInlineLabel(safeTitle)}</strong>
        {preview.status ? <span>{rightPaneInlineLabel(preview.status)}</span> : null}
      </div>
      {refs.length ? (
        <div className="source-list">
          {refs.map((ref) => (
            onObjectReferenceFocus ? (
              <button
                type="button"
                key={ref}
                title={rightPaneInlineLabel(ref)}
                onClick={() => onObjectReferenceFocus(objectReferenceForSubagentPreviewRef(ref))}
              >
                {rightPaneInlineLabel(ref)}
              </button>
            ) : <code key={ref} title={rightPaneInlineLabel(ref)}>{rightPaneInlineLabel(ref)}</code>
          ))}
        </div>
      ) : null}
      {preview.createdAt ? <p className="muted-inline">{resultText(locale, { 'zh-CN': '完成于', 'en-US': 'Completed at' })} {rightPaneInlineLabel(preview.createdAt)}</p> : null}
      <p>{boundedRightPaneText(summary, 1600)}</p>
    </div>
  );
}
