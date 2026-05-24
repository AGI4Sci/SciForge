import type { FormEvent } from 'react';
import { Inbox, MessageSquareText, MousePointer2, Save, Send, Trash2, X } from 'lucide-react';
import type { PageId } from '../data';
import { Badge, cx } from '../app/uiPrimitives';
import { MessageContent } from '../app/chat/MessageContent';
import { SciForgeReferenceChips } from '../app/chat/ReferenceChips';
import {
  referenceComposerMarker,
  sciForgeReferenceKindLabel,
} from '../../../../packages/support/object-references';
import {
  annotationPlanLatestChoices,
  buildAnnotationPlanOnlyEnvelope,
  type AnnotationPlanChoice,
  type AnnotationPlanDraft,
} from './annotationPlanModel';

interface AnnotationSidebarProps {
  open: boolean;
  draft: AnnotationPlanDraft | null;
  selectionActive: boolean;
  saving: boolean;
  page: PageId;
  onClose: () => void;
  onToggleSelection: () => void;
  onDescriptionChange: (description: string) => void;
  onClarify: (content: string) => void;
  onChoice: (choice: AnnotationPlanChoice) => void;
  onRemoveReference: (referenceId: string) => void;
  onDiscard: () => void;
  onSave: () => void;
  onOpenInbox: () => void;
}

export function AnnotationSidebar({
  open,
  draft,
  selectionActive,
  saving,
  page,
  onClose,
  onToggleSelection,
  onDescriptionChange,
  onClarify,
  onChoice,
  onRemoveReference,
  onDiscard,
  onSave,
  onOpenInbox,
}: AnnotationSidebarProps) {
  if (!open) return null;
  const choices = draft ? annotationPlanLatestChoices(draft) : [];
  const envelope = draft ? buildAnnotationPlanOnlyEnvelope(draft) : null;
  const canSave = Boolean(draft && draft.status !== 'saved' && (draft.references.length || draft.description.trim() || draft.messages.length));
  const statusLabel = draft?.status === 'saved'
    ? '已保存'
    : draft?.status === 'ready-to-save'
      ? '可保存'
      : draft?.status === 'clarifying'
        ? '澄清中'
        : '草稿';

  function submitClarification(event: FormEvent) {
    event.preventDefault();
    if (!draft || !draft.description.trim()) return;
    onClarify(draft.description);
  }

  return (
    <aside className="annotation-sidebar" data-feedback-control="true" aria-label="全局注释侧栏">
      <header className="annotation-sidebar-head">
        <div>
          <Badge variant="info">annotation-plan</Badge>
          <h2>注释</h2>
          <p title={draft?.currentUrl ?? page}>{page} · {annotationRouteLabel(draft?.currentUrl)} · 仅澄清，不改代码</p>
        </div>
        <button type="button" className="annotation-icon-button" onClick={onClose} aria-label="关闭注释侧栏" title="关闭注释侧栏">
          <X size={16} />
        </button>
      </header>

      <section className="annotation-sidebar-status" aria-label="注释计划状态">
        <span className={cx('annotation-status-dot', selectionActive && 'active')} />
        <strong>{statusLabel}</strong>
        <span>{draft?.references.length ?? 0} refs</span>
        <span>{envelope?.kind ?? 'annotation-plan-only'}</span>
      </section>

      {draft?.savedFeedbackId ? (
        <section className="annotation-sidebar-saved">
          <strong>已进入反馈收件箱</strong>
          <code>{draft.savedFeedbackId}</code>
          <button type="button" onClick={onOpenInbox}>
            <Inbox size={14} />
            打开收件箱
          </button>
        </section>
      ) : null}

      <section className="annotation-sidebar-section">
        <div className="annotation-section-head">
          <strong>对象</strong>
          <button type="button" className={cx('annotation-tool-button', selectionActive && 'active')} onClick={onToggleSelection}>
            <MousePointer2 size={14} />
            {selectionActive ? '点选中' : '点选'}
          </button>
        </div>
        {draft?.references.length ? (
          <>
            <SciForgeReferenceChips
              references={draft.references.map((item) => item.reference)}
              onRemove={onRemoveReference}
            />
            <div className="annotation-reference-list">
              {draft.references.map((item) => (
                <div key={item.reference.id} className="annotation-reference-row">
                  <span>{referenceComposerMarker(item.reference)}</span>
                  <div>
                    <strong>{item.reference.title}</strong>
                    <small>{sciForgeReferenceKindLabel(item.reference.kind)} · {item.target.selector}</small>
                  </div>
                  <button type="button" onClick={() => onRemoveReference(item.reference.id)} aria-label={`移除 ${item.reference.title}`}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="annotation-muted">使用顶栏“注释”后点选界面对象，token 会按 ※1、※2 保持在这里。</p>
        )}
      </section>

      <form className="annotation-sidebar-section grow" onSubmit={submitClarification}>
        <label className="annotation-field">
          <span>计划草稿</span>
          <textarea
            value={draft?.description ?? ''}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="描述你希望这些对象如何变化..."
            disabled={!draft || draft.status === 'saved'}
          />
        </label>
        <div className="annotation-actions">
          <button type="submit" disabled={!draft || !draft.description.trim() || draft.status === 'saved'}>
            <Send size={14} />
            澄清
          </button>
          <button type="button" onClick={onSave} disabled={!canSave || saving}>
            <Save size={14} />
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </form>

      {draft?.messages.length ? (
        <section className="annotation-sidebar-section messages">
          <div className="annotation-section-head">
            <strong>讨论</strong>
            <MessageSquareText size={14} />
          </div>
          <div className="annotation-message-list">
            {draft.messages.map((message) => (
              <article key={message.id} className={cx('annotation-message', message.role)}>
                <span>{message.role === 'user' ? '你' : '计划'}</span>
                <MessageContent content={message.content} references={[]} onObjectFocus={() => undefined} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {draft && draft.status !== 'saved' ? (
        <section className="annotation-choice-row" aria-label="注释计划选项">
          {choices.map((choice) => (
            <button key={choice.id} type="button" onClick={() => onChoice(choice)}>
              {choice.label}
            </button>
          ))}
        </section>
      ) : null}

      <footer className="annotation-sidebar-footer">
        <button type="button" onClick={onDiscard} disabled={!draft || draft.status === 'saved'}>
          <Trash2 size={14} />
          丢弃
        </button>
        <span>{envelope?.forbiddenSideEffects.length ?? 0} blocked side effects</span>
      </footer>
    </aside>
  );
}

function annotationRouteLabel(url: string | undefined) {
  if (!url) return 'current route';
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    return url;
  }
}
