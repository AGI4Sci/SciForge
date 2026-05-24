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
  onReference: (reference: SciForgeReference) => void;
  annotationModeActive?: boolean;
  onAnnotationModeChange?: (active: boolean) => void;
}

interface ContextTarget {
  x: number;
  y: number;
  target: FeedbackTargetSnapshot;
  selectedText: string;
  objectReference?: SciForgeReference;
  mode: 'menu' | 'comment';
}

const MENU_WIDTH = 230;
const MENU_HEIGHT = 160;
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
  onReference,
  annotationModeActive = false,
  onAnnotationModeChange,
}: FeedbackCaptureLayerProps) {
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [hoverTarget, setHoverTarget] = useState<FeedbackTargetSnapshot | null>(null);
  const [comment, setComment] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [actualBehavior, setActualBehavior] = useState('');
  const [priority, setPriority] = useState<FeedbackPriority>('normal');
  const [tags, setTags] = useState('');
  const [saveHint, setSaveHint] = useState('');
  const [annotationReferenceCount, setAnnotationReferenceCount] = useState(0);

  function selectableElementFromEvent(event: MouseEvent) {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest('[data-feedback-control="true"]')) return null;
    return element;
  }

  function contextForElement(element: Element, event: MouseEvent, mode: ContextTarget['mode']): ContextTarget {
    const width = mode === 'comment' ? POPOVER_WIDTH : MENU_WIDTH;
    const height = mode === 'comment' ? POPOVER_HEIGHT : MENU_HEIGHT;
    return {
      x: clampToViewport(event.clientX, width),
      y: clampToViewport(event.clientY, height, 'height'),
      target: buildFeedbackTargetSnapshot(element, { x: event.clientX, y: event.clientY }),
      selectedText: compactSelectedText(window.getSelection()?.toString() ?? ''),
      objectReference: sciForgeReferenceFromElement(element),
      mode,
    };
  }

  function openAnnotationComment(element: Element, event: MouseEvent) {
    setContextTarget(contextForElement(element, event, 'comment'));
    setHoverTarget(null);
    setSaveHint('');
    onAnnotationModeChange?.(false);
  }

  function addAnnotationReference(element: Element, event: MouseEvent) {
    const context = contextForElement(element, event, 'menu');
    const reference = context.objectReference
      ?? referenceForFeedbackTarget(context.target, context.selectedText, 'object');
    onReference(reference);
    setHoverTarget(context.target);
    setAnnotationReferenceCount((count) => count + 1);
    setSaveHint('');
  }

  useEffect(() => {
    if (!annotationModeActive) {
      setHoverTarget(null);
      setAnnotationReferenceCount(0);
      return;
    }
    setContextTarget(null);
    setSaveHint('');
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = previousCursor;
    };
  }, [annotationModeActive]);

  useEffect(() => {
    function openMenu(event: MouseEvent) {
      const element = selectableElementFromEvent(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      setContextTarget(contextForElement(element, event, 'menu'));
    }
    function handleContextMenu(event: MouseEvent) {
      if (annotationModeActive) {
        const element = selectableElementFromEvent(event);
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        openAnnotationComment(element, event);
        return;
      }
      openMenu(event);
    }
    function handleMouseMove(event: MouseEvent) {
      if (!annotationModeActive) return;
      const element = selectableElementFromEvent(event);
      setHoverTarget(element ? buildFeedbackTargetSnapshot(element, { x: event.clientX, y: event.clientY }) : null);
    }
    function handleClick(event: MouseEvent) {
      const element = selectableElementFromEvent(event);
      if (annotationModeActive) {
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        addAnnotationReference(element, event);
        return;
      }
      if (!element) return;
      setContextTarget(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (annotationModeActive) {
        onAnnotationModeChange?.(false);
        setHoverTarget(null);
        return;
      }
      setContextTarget(null);
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
  }, [annotationModeActive, onAnnotationModeChange]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!contextTarget || !comment.trim()) return;
    const now = nowIso();
    const feedbackId = makeId('feedback');
    const refs = feedbackEvidenceRefs(feedbackId);
    const screenshot = await captureFeedbackScreenshotEvidence(contextTarget.target, now, { annotationLabel: '1' });
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
      target: contextTarget.target,
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
      target: contextTarget.target,
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

  function addReference(kind: 'object' | 'selection') {
    if (!contextTarget) return;
    const reference = kind === 'object' && contextTarget.objectReference
      ? contextTarget.objectReference
      : referenceForFeedbackTarget(contextTarget.target, contextTarget.selectedText, kind);
    onReference(reference);
    resetDraft();
  }

  function openComment() {
    setContextTarget((current) => current
      ? {
        ...current,
        x: clampToViewport(current.x, POPOVER_WIDTH),
        y: clampToViewport(current.y, POPOVER_HEIGHT, 'height'),
        mode: 'comment',
      }
      : current);
  }

  function resetDraft() {
    setContextTarget(null);
    setHoverTarget(null);
    setComment('');
    setExpectedBehavior('');
    setActualBehavior('');
    setTags('');
    setPriority('normal');
  }

  const activeHighlightTarget = contextTarget?.mode === 'comment' ? contextTarget.target : annotationModeActive ? hoverTarget : null;

  return (
    <div className="feedback-layer" data-feedback-control="true" aria-live="polite">
      {annotationModeActive ? (
        <div className="feedback-annotation-hint" role="status">
          <div>
            <strong>注释模式</strong>
            <span>
              {annotationReferenceCount > 0
                ? `已引用 ${annotationReferenceCount} 个对象到主对话；继续点选，或在输入栏描述关系。`
                : '点击页面对象引用到主对话；可连续点选多个对象，右键添加反馈评论，Esc 退出。'}
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
      {contextTarget?.mode === 'menu' ? (
        <div
          className="feedback-context-menu"
          style={{ left: `${contextTarget.x}px`, top: `${contextTarget.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={openComment}>添加评论</button>
          <button type="button" onClick={() => addReference('object')}>引用对象到对话</button>
          <button type="button" onClick={() => addReference('selection')} disabled={!contextTarget.selectedText}>引用选中内容</button>
        </div>
      ) : null}
      {contextTarget?.mode === 'comment' ? (
        <form
          className="feedback-popover"
          style={{ left: `${contextTarget.x}px`, top: `${contextTarget.y}px` }}
          onSubmit={submit}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="feedback-popover-head">
            <strong>添加评论</strong>
            <button type="button" className="feedback-close" onClick={() => setContextTarget(null)}>关闭</button>
          </div>
          <div className="feedback-target-summary">
            <span>selector</span>
            <code>{contextTarget.target.selector}</code>
            <span>position</span>
            <code>{Math.round(contextTarget.target.rect.x)}, {Math.round(contextTarget.target.rect.y)} · {Math.round(contextTarget.target.rect.width)}x{Math.round(contextTarget.target.rect.height)}</code>
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
