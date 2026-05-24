import { useRef } from 'react';
import { Eye, Inbox, MessageSquareText, MousePointer2, Save, Sparkles, Trash2, X } from 'lucide-react';
import type { PageId } from '../data';
import type { AgentStreamEvent } from '../domain';
import { Badge, cx } from '../app/uiPrimitives';
import { ChatComposer } from '../app/chat/ChatComposer';
import { MessageContent } from '../app/chat/MessageContent';
import { SciForgeReferenceChips } from '../app/chat/ReferenceChips';
import { RunningWorkProcess } from '../app/chat/RunningWorkProcess';
import { streamEventCounts } from '../streamEventPresentation';
import {
  referenceComposerMarker,
  sciForgeReferenceKindLabel,
} from '../../../../packages/support/object-references';
import {
  assessAnnotationQuickAction,
  annotationPlanLatestChoices,
  buildAnnotationPlanOnlyEnvelope,
  type AnnotationPlanChoice,
  type AnnotationPlanDraft,
  type AnnotationPlanReferenceRecord,
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
  onReferenceFocus: (reference: AnnotationPlanReferenceRecord) => void;
  onDiscard: () => void;
  onSave: () => void;
  onSendToInbox: () => void;
  onApplySmallChange: () => void;
  onOpenInbox: () => void;
  quickActionRunning?: boolean;
  streamEvents?: AgentStreamEvent[];
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
  onReferenceFocus,
  onDiscard,
  onSave,
  onSendToInbox,
  onApplySmallChange,
  onOpenInbox,
  quickActionRunning = false,
  streamEvents = [],
}: AnnotationSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  if (!open) return null;
  const choices = draft ? annotationPlanLatestChoices(draft) : [];
  const previewChoice = choices.find((choice) => choice.id === 'preview-change');
  const secondaryChoices = choices.filter((choice) => choice.id !== 'preview-change');
  const envelope = draft ? buildAnnotationPlanOnlyEnvelope(draft) : null;
  const streamCounts = streamEventCounts(streamEvents);
  const canSave = Boolean(draft && draft.status !== 'saved' && (draft.references.length || draft.description.trim() || draft.messages.length));
  const quickActionAssessment = draft ? assessAnnotationQuickAction(draft) : null;
  const canApplySmallChange = Boolean(draft && draft.status !== 'saved' && quickActionAssessment?.eligible && !quickActionRunning);
  const statusLabel = draft?.status === 'saved'
    ? '已保存'
    : draft?.status === 'ready-to-save'
      ? '可保存'
      : draft?.status === 'clarifying'
        ? '澄清中'
        : '草稿';

  function submitClarification() {
    if (!draft || !draft.description.trim()) return;
    onClarify(draft.description);
  }

  return (
    <aside className="annotation-sidebar" data-feedback-control="true" aria-label="全局注释侧栏">
      <header className="annotation-sidebar-head">
        <div>
          <Badge variant="info">feedback flow</Badge>
          <h2>反馈侧栏</h2>
          <p title={draft?.currentUrl ?? page}>{page} · {annotationRouteLabel(draft?.currentUrl)} · 先说清楚，再选择下一步</p>
        </div>
        <button type="button" className="annotation-icon-button" onClick={onClose} aria-label="关闭注释侧栏" title="关闭注释侧栏">
          <X size={16} />
        </button>
      </header>

      <section className="annotation-sidebar-status" aria-label="注释计划状态">
        <span className={cx('annotation-status-dot', selectionActive && 'active')} />
        <strong>{statusLabel}</strong>
        <span>{draft?.references.length ?? 0} 个对象</span>
        <span>{quickActionAssessment?.label ?? '意图优先'}</span>
      </section>

      {draft?.savedFeedbackId ? (
        <section className="annotation-sidebar-saved">
          <strong>已保存反馈</strong>
          <code>{draft.savedFeedbackId}</code>
          <button type="button" onClick={onOpenInbox}>
            <Inbox size={14} />
            去收件箱
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
              onFocus={(reference) => {
                const record = draft.references.find((item) => item.reference.id === reference.id);
                if (record) onReferenceFocus(record);
              }}
            />
            <div className="annotation-reference-list">
              {draft.references.map((item) => (
                <div key={item.reference.id} className="annotation-reference-row">
                  <button
                    type="button"
                    className="annotation-reference-focus-button"
                    onClick={() => onReferenceFocus(item)}
                    title="定位引用对象"
                  >
                    <span>{referenceComposerMarker(item.reference)}</span>
                    <div>
                      <strong>{item.reference.title}</strong>
                      <small>{sciForgeReferenceKindLabel(item.reference.kind)} · {item.target.selector}</small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="annotation-reference-remove-button"
                    onClick={() => onRemoveReference(item.reference.id)}
                    aria-label={`移除 ${item.reference.title}`}
                  >
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

      <section className="annotation-sidebar-section grow">
        <div className="annotation-composer-label">
          <strong>问题和关系</strong>
          <span>同一条反馈路径</span>
        </div>
        <ChatComposer
          expanded
          input={draft?.description ?? ''}
          isSending={false}
          composerHeight={118}
          referencePickMode={false}
          pendingReferences={[]}
          contextMeter={<span className="annotation-context-meter">{draft?.references.length ?? 0} 对象 · {quickActionAssessment?.reason ?? '先补充意图'}</span>}
          fileInputRef={fileInputRef}
          referenceChips={null}
          textareaRef={textareaRef}
          onExpand={() => undefined}
          onCollapse={() => undefined}
          onToggleReferencePickMode={() => undefined}
          onFileUpload={() => undefined}
          onInputChange={onDescriptionChange}
          onSend={submitClarification}
          onAbort={() => undefined}
          onBeginResize={() => undefined}
          disabled={!draft || draft.status === 'saved'}
          showReferencePicker={false}
          showFileUpload={false}
          showCollapseButton={false}
          showResizeHandle={false}
          copy={{
            placeholder: '描述你希望哪里变化、对象之间有什么关系...',
            sendLabel: '整理',
          }}
        />
        <div className="annotation-action-ladder" aria-label="反馈下一步">
          <button type="button" className="primary" onClick={onSave} disabled={!canSave || saving}>
            <Save size={14} />
            {saving ? '保存中' : '保存反馈'}
          </button>
          <button type="button" onClick={() => previewChoice && onChoice(previewChoice)} disabled={!previewChoice || !draft || draft.status === 'saved'}>
            <Eye size={14} />
            预览修改
          </button>
          <button
            type="button"
            className="quick"
            onClick={onApplySmallChange}
            disabled={!canApplySmallChange}
            title={quickActionAssessment?.reason}
          >
            <Sparkles size={14} />
            {quickActionRunning ? '修改中' : '应用小改动'}
          </button>
          <button type="button" onClick={onSendToInbox} disabled={!canSave || saving}>
            <Inbox size={14} />
            复杂改动进收件箱
          </button>
        </div>
        <p className="annotation-decision-note">
          {quickActionAssessment?.eligible
            ? '当前像低风险小改动；执行后仍会留下反馈记录。'
            : quickActionAssessment?.reason ?? '先描述问题，系统再判断是小改动还是进收件箱。'}
        </p>
      </section>

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

      {streamEvents.length ? (
        <section className="annotation-sidebar-section stream" aria-label="注释计划事件">
          <div className="annotation-section-head">
            <strong>过程</strong>
            <span className="annotation-context-meter">stream/event model</span>
          </div>
          <RunningWorkProcess
            events={streamEvents}
            counts={streamCounts}
            backend="annotation-plan-only"
            guidanceCount={0}
          />
        </section>
      ) : null}

      {draft && draft.status !== 'saved' && secondaryChoices.length ? (
        <section className="annotation-choice-row" aria-label="注释计划选项">
          {secondaryChoices.map((choice) => (
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
        <span title={`${envelope?.forbiddenSideEffects.length ?? 0} 个复杂副作用需要收件箱确认`}>复杂操作需要确认和审计</span>
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
