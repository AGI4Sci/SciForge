import { useEffect, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import type {
  FeedbackCommentRecord,
  FeedbackPriority,
  FeedbackTargetSnapshot,
  SciForgeReference,
  SciForgeSession,
  ScenarioInstanceId,
} from '../domain';
import type { PageId } from '../data';
import { makeId, nowIso } from '../domain';
import { ActionButton } from '../app/uiPrimitives';
import {
  buildFeedbackEvidenceStatus,
  buildFeedbackRuntimeSnapshot,
  buildFeedbackTargetSnapshot,
  captureFeedbackScreenshotEvidence,
  compactSelectedText,
  feedbackEvidenceRefs,
  referenceForFeedbackTarget,
  sciForgeReferenceFromElement,
} from './captureModel';

interface FeedbackCaptureLayerProps {
  page: PageId;
  scenarioId: ScenarioInstanceId;
  session: SciForgeSession;
  appVersion: string;
  author: { authorId: string; authorName: string };
  onAuthorChange: (author: { authorId: string; authorName: string }) => void;
  onSubmit: (comment: FeedbackCommentRecord) => void;
  onAnnotationReference: (input: AnnotationReferenceInput) => void;
  annotationReferenceCount?: number;
  annotationModeActive?: boolean;
  onAnnotationModeChange?: (active: boolean) => void;
}

export interface AnnotationReferenceInput {
  reference: SciForgeReference;
  target: FeedbackTargetSnapshot;
  selectedText?: string;
}

interface CommentTarget {
  x: number;
  y: number;
  target: FeedbackTargetSnapshot;
  selectedText: string;
  objectReference?: SciForgeReference;
}

const POPOVER_WIDTH = 380;
const POPOVER_HEIGHT = 540;

export function FeedbackCaptureLayer({
  page,
  scenarioId,
  session,
  appVersion,
  author,
  onAuthorChange,
  onSubmit,
  onAnnotationReference,
  annotationReferenceCount = 0,
  annotationModeActive = false,
  onAnnotationModeChange,
}: FeedbackCaptureLayerProps) {
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const [hoverTarget, setHoverTarget] = useState<FeedbackTargetSnapshot | null>(null);
  const [comment, setComment] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [actualBehavior, setActualBehavior] = useState('');
  const [priority, setPriority] = useState<FeedbackPriority>('normal');
  const [tags, setTags] = useState('');
  const [saveHint, setSaveHint] = useState('');

  function selectableElementFromEvent(event: MouseEvent) {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest('[data-feedback-control="true"]')) return null;
    return element;
  }

  function commentTargetForElement(element: Element, event: MouseEvent): CommentTarget {
    return {
      x: clampToViewport(event.clientX, POPOVER_WIDTH),
      y: clampToViewport(event.clientY, POPOVER_HEIGHT, 'height'),
      target: buildFeedbackTargetSnapshot(element, { x: event.clientX, y: event.clientY }),
      selectedText: compactSelectedText(window.getSelection()?.toString() ?? ''),
      objectReference: sciForgeReferenceFromElement(element),
    };
  }

  function openAnnotationComment(element: Element, event: MouseEvent) {
    setCommentTarget(commentTargetForElement(element, event));
    setHoverTarget(null);
    setSaveHint('');
    onAnnotationModeChange?.(false);
  }

  function addAnnotationReference(element: Element, event: MouseEvent) {
    const context = commentTargetForElement(element, event);
    const reference = context.objectReference
      ?? referenceForFeedbackTarget(context.target, context.selectedText, 'object');
    onAnnotationReference({ reference, target: context.target, selectedText: context.selectedText });
    setHoverTarget(context.target);
    setSaveHint('');
  }

  useEffect(() => {
    if (!annotationModeActive) {
      setHoverTarget(null);
      setCommentTarget(null);
      return;
    }
    setSaveHint('');
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [annotationModeActive]);

  useEffect(() => {
    if (!annotationModeActive) return undefined;
    function handleContextMenu(event: MouseEvent) {
      const element = selectableElementFromEvent(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      openAnnotationComment(element, event);
    }
    function handleMouseMove(event: MouseEvent) {
      const element = selectableElementFromEvent(event);
      setHoverTarget(element ? buildFeedbackTargetSnapshot(element, { x: event.clientX, y: event.clientY }) : null);
    }
    function handleClick(event: MouseEvent) {
      const element = selectableElementFromEvent(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      addAnnotationReference(element, event);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      onAnnotationModeChange?.(false);
      setHoverTarget(null);
      setCommentTarget(null);
    }
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [annotationModeActive, onAnnotationModeChange, onAnnotationReference]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!commentTarget || !comment.trim()) return;
    const now = nowIso();
    const feedbackId = makeId('feedback');
    const refs = feedbackEvidenceRefs(feedbackId);
    const screenshot = await captureFeedbackScreenshotEvidence(commentTarget.target, now, { annotationLabel: '1' });
    const screenshotWithRefs = screenshot
      ? {
        ...screenshot,
        rawScreenshotRef: refs.rawScreenshotRef,
        annotatedScreenshotRef: refs.annotatedScreenshotRef,
      }
      : undefined;
    const runtime = buildFeedbackRuntimeSnapshot({ page, scenarioId, session, url: window.location.href, appVersion });
    const evidenceStatus = buildFeedbackEvidenceStatus({
      screenshot: screenshotWithRefs,
      target: commentTarget.target,
      runtime,
      diagnostics: screenshotWithRefs ? [] : ['screenshot capture failed; saved target and runtime evidence only'],
    });
    onSubmit({
      id: feedbackId,
      schemaVersion: 1,
      authorId: author.authorId,
      authorName: author.authorName.trim() || 'Anonymous',
      comment: comment.trim(),
      expectedBehavior: expectedBehavior.trim() || undefined,
      actualBehavior: actualBehavior.trim() || undefined,
      status: 'open',
      priority,
      severity: priority,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      createdAt: now,
      updatedAt: now,
      target: commentTarget.target,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      runtime,
      screenshotRef: refs.annotatedScreenshotRef,
      rawScreenshotRef: refs.rawScreenshotRef,
      annotatedScreenshotRef: refs.annotatedScreenshotRef,
      evidenceBundleRef: refs.evidenceBundleRef,
      evidenceStatus,
      screenshot: screenshotWithRefs,
    });
    setSaveHint(evidenceStatus.status === 'complete'
      ? '反馈已保存，截图和目标证据已记录。'
      : '反馈已保存，但截图采集不完整；收件箱会标记 partial evidence。');
    resetDraft();
  }

  function resetDraft() {
    setCommentTarget(null);
    setHoverTarget(null);
    setComment('');
    setExpectedBehavior('');
    setActualBehavior('');
    setTags('');
    setPriority('normal');
  }

  const activeHighlightTarget = commentTarget ? commentTarget.target : annotationModeActive ? hoverTarget : null;

  return (
    <div className="feedback-layer" data-feedback-control="true" aria-live="polite">
      {annotationModeActive ? (
        <div className="feedback-annotation-hint" role="status">
          <div>
            <strong>注释模式</strong>
            <span>
              {annotationReferenceCount > 0
                ? `已加入 ${annotationReferenceCount} 个对象到注释侧栏；继续点选，或在侧栏描述关系。`
                : '点击页面对象加入注释侧栏；右键可打开精准反馈评论，Esc 退出。'}
            </span>
          </div>
          <button type="button" onClick={() => onAnnotationModeChange?.(false)}>退出</button>
        </div>
      ) : null}
      {activeHighlightTarget ? (
        <div
          className="feedback-highlight-box"
          style={{
            left: `${Math.max(0, activeHighlightTarget.rect.x - 3)}px`,
            top: `${Math.max(0, activeHighlightTarget.rect.y - 3)}px`,
            width: `${Math.max(1, activeHighlightTarget.rect.width + 6)}px`,
            height: `${Math.max(1, activeHighlightTarget.rect.height + 6)}px`,
          }}
          aria-hidden
        />
      ) : null}
      {commentTarget ? (
        <form
          className="feedback-popover"
          style={{ left: `${commentTarget.x}px`, top: `${commentTarget.y}px` }}
          onSubmit={submit}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="feedback-popover-head">
            <strong>添加评论</strong>
            <button type="button" className="feedback-close" onClick={() => setCommentTarget(null)}>关闭</button>
          </div>
          <div className="feedback-target-summary">
            <span>selector</span>
            <code>{commentTarget.target.selector}</code>
            <span>position</span>
            <code>{Math.round(commentTarget.target.rect.x)}, {Math.round(commentTarget.target.rect.y)} · {Math.round(commentTarget.target.rect.width)}x{Math.round(commentTarget.target.rect.height)}</code>
          </div>
          <label className="feedback-field wide">
            <span>评论内容</span>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} autoFocus placeholder="写下你希望这里如何改..." />
          </label>
          <label className="feedback-field wide">
            <span>期望行为</span>
            <textarea value={expectedBehavior} onChange={(event) => setExpectedBehavior(event.target.value)} placeholder="这里应该发生什么..." />
          </label>
          <label className="feedback-field wide">
            <span>实际行为</span>
            <textarea value={actualBehavior} onChange={(event) => setActualBehavior(event.target.value)} placeholder="现在实际发生了什么..." />
          </label>
          <div className="feedback-grid">
            <label className="feedback-field">
              <span>用户</span>
              <input
                value={author.authorName}
                onChange={(event) => onAuthorChange({ ...author, authorName: event.target.value })}
              />
            </label>
            <label className="feedback-field">
              <span>优先级</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as FeedbackPriority)}>
                <option value="normal">normal</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
                <option value="low">low</option>
              </select>
            </label>
            <label className="feedback-field wide">
              <span>标签（逗号分隔）</span>
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="upload, history, ui" />
            </label>
          </div>
          <div className="feedback-actions">
            <ActionButton icon={Check} disabled={!comment.trim()}>保存反馈</ActionButton>
          </div>
        </form>
      ) : null}
      {saveHint ? (
        <div
          className="feedback-context-menu"
          style={{ right: '16px', bottom: '16px', minWidth: '260px' }}
          role="status"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => setSaveHint('')}>{saveHint}</button>
        </div>
      ) : null}
    </div>
  );
}

function clampToViewport(value: number, size: number, axis: 'width' | 'height' = 'width') {
  const limit = axis === 'width' ? window.innerWidth : window.innerHeight;
  return Math.max(0, Math.min(value, limit - size));
}
