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
  buildFeedbackRuntimeSnapshot,
  buildFeedbackTargetSnapshot,
  compactSelectedText,
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
const POPOVER_HEIGHT = 250;

export function FeedbackCaptureLayer({
  page,
  scenarioId,
  session,
  appVersion,
  author,
  onAuthorChange,
  onSubmit,
  onReference,
}: FeedbackCaptureLayerProps) {
  const [contextTarget, setContextTarget] = useState<ContextTarget | null>(null);
  const [comment, setComment] = useState('');
  const [priority, setPriority] = useState<FeedbackPriority>('normal');
  const [tags, setTags] = useState('');

  useEffect(() => {
    function openMenu(event: MouseEvent) {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest('[data-feedback-control="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setContextTarget({
        x: clampToViewport(event.clientX, MENU_WIDTH),
        y: clampToViewport(event.clientY, MENU_HEIGHT, 'height'),
        target: buildFeedbackTargetSnapshot(element),
        selectedText: compactSelectedText(window.getSelection()?.toString() ?? ''),
        objectReference: sciForgeReferenceFromElement(element),
        mode: 'menu',
      });
    }
    function handleContextMenu(event: MouseEvent) {
      openMenu(event);
    }
    function handleClick(event: MouseEvent) {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('[data-feedback-control="true"]')) return;
      setContextTarget(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextTarget(null);
    }
    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!contextTarget || !comment.trim()) return;
    const now = nowIso();
    onSubmit({
      id: makeId('feedback'),
      schemaVersion: 1,
      authorId: author.authorId,
      authorName: author.authorName.trim() || 'Anonymous',
      comment: comment.trim(),
      status: 'open',
      priority,
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
      runtime: buildFeedbackRuntimeSnapshot({ page, scenarioId, session, url: window.location.href, appVersion }),
    });
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
    setComment('');
    setTags('');
    setPriority('normal');
  }

  return (
    <div className="feedback-layer" data-feedback-control="true" aria-live="polite">
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
    </div>
  );
}

function clampToViewport(value: number, size: number, axis: 'width' | 'height' = 'width') {
  const limit = axis === 'width' ? window.innerWidth : window.innerHeight;
  return Math.max(0, Math.min(value, limit - size));
}
