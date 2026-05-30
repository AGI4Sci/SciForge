import { ChevronDown, ChevronUp, CircleStop, FileUp, Folder, Quote, ShieldCheck, Sparkles } from 'lucide-react';
import { ActionButton, cx } from '../uiPrimitives';
import type { ReactNode, RefObject } from 'react';
import type { SciForgeReference } from '../../domain';
import { useI18n } from '../../i18nContext';

export function ChatComposer({
  expanded,
  input,
  isSending,
  composerHeight,
  referencePickMode,
  pendingReferences,
  contextMeter,
  fileInputRef,
  referenceChips,
  topAddon,
  runtimeContext,
  textareaRef,
  onExpand,
  onCollapse,
  onToggleReferencePickMode,
  onFileUpload,
  onInputChange,
  onSend,
  onAbort,
  onBeginResize,
  copy,
  disabled = false,
  showReferencePicker = true,
  showFileUpload = true,
  showCollapseButton = true,
  showResizeHandle = true,
}: {
  expanded: boolean;
  input: string;
  isSending: boolean;
  composerHeight: number;
  referencePickMode: boolean;
  pendingReferences: SciForgeReference[];
  contextMeter: ReactNode;
  fileInputRef: RefObject<HTMLInputElement | null>;
  referenceChips: ReactNode;
  topAddon?: ReactNode;
  runtimeContext?: {
    provider: string;
    model: string;
    workspacePath: string;
    permissionMode: string;
  };
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onExpand: () => void;
  onCollapse: () => void;
  onToggleReferencePickMode: () => void;
  onFileUpload: (files: FileList | null) => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onBeginResize: (event: React.MouseEvent<HTMLDivElement>) => void;
  copy?: {
    collapsedText?: string;
    referenceHint?: string;
    placeholder?: string;
    sendingPlaceholder?: string;
    sendLabel?: string;
    sendingLabel?: string;
  };
  disabled?: boolean;
  showReferencePicker?: boolean;
  showFileUpload?: boolean;
  showCollapseButton?: boolean;
  showResizeHandle?: boolean;
}) {
  const { t } = useI18n();
  const collapsedText = copy?.collapsedText ?? t({ 'zh-CN': '提问，或附加上下文...', 'en-US': 'Ask a question, or attach context...' });
  const referenceHint = copy?.referenceHint ?? t({ 'zh-CN': '选择可见对象作为上下文', 'en-US': 'Select visible objects as context' });
  const placeholder = copy?.placeholder ?? t({ 'zh-CN': '提问，或附加上下文...', 'en-US': 'Ask a question, or attach context...' });
  const sendingPlaceholder = copy?.sendingPlaceholder ?? t({ 'zh-CN': '当前任务运行中，追加指令会排队...', 'en-US': 'Additional guidance will queue while this runs...' });
  const sendLabel = copy?.sendLabel ?? t({ 'zh-CN': '发送', 'en-US': 'Send' });
  const sendingLabel = copy?.sendingLabel ?? t({ 'zh-CN': '排队', 'en-US': 'Queue' });
  if (!expanded) {
    return (
      <button
        type="button"
        className="composer-collapsed"
        onClick={onExpand}
        aria-expanded={false}
        title={t({ 'zh-CN': '展开输入框', 'en-US': 'Expand composer' })}
      >
        <Sparkles size={15} />
        <span>{collapsedText}</span>
        <ChevronUp size={15} />
      </button>
    );
  }

  return (
    <div className="composer" aria-expanded={true}>
      {showCollapseButton ? (
        <button
          type="button"
          className="composer-collapse-button"
          onClick={onCollapse}
          title={t({ 'zh-CN': '收起输入框', 'en-US': 'Collapse composer' })}
          aria-label={t({ 'zh-CN': '收起输入框', 'en-US': 'Collapse composer' })}
        >
          <ChevronDown size={15} />
        </button>
      ) : null}
      {showResizeHandle ? <div className="composer-resize-handle" onMouseDown={onBeginResize} title={t({ 'zh-CN': '调整输入框大小', 'en-US': 'Resize composer' })} /> : null}
      {topAddon}
      {showReferencePicker || showFileUpload || pendingReferences.length ? (
        <div className="reference-composer">
          {showReferencePicker ? (
            <button
              type="button"
              className={cx('reference-trigger', referencePickMode && 'active')}
              onClick={onToggleReferencePickMode}
              title={t({
                'zh-CN': '选择可见 UI 作为上下文；选中文本可从菜单引用',
                'en-US': 'Pick visible UI as context; selected text can be referenced from its menu',
              })}
            >
              <Quote size={14} />
              {t({ 'zh-CN': '拾取', 'en-US': 'Pick' })}
            </button>
          ) : null}
          {showFileUpload ? (
            <>
              <button
                type="button"
                className="reference-trigger"
                onClick={() => fileInputRef.current?.click()}
                title={t({
                  'zh-CN': '附加 PDF、图片、表格或其他文件',
                  'en-US': 'Attach PDFs, images, tables, or other files',
                })}
              >
                <FileUp size={14} />
                {t({ 'zh-CN': '附加', 'en-US': 'Attach' })}
              </button>
              <input
                ref={fileInputRef}
                className="sr-only-file-input"
                type="file"
                multiple
                onChange={(event) => onFileUpload(event.currentTarget.files)}
              />
            </>
          ) : null}
          {pendingReferences.length ? referenceChips : <span className="reference-hint">{referenceHint}</span>}
        </div>
      ) : null}
      {referencePickMode ? (
        <div className="reference-pick-banner">
          <Quote size={14} />
          {t({ 'zh-CN': '选择一个可见对象作为上下文。按 Esc 取消。', 'en-US': 'Select a visible object as context. Press Esc to cancel.' })}
        </div>
      ) : null}
      {runtimeContext ? (
        <div className="composer-runtime-row" aria-label={t({ 'zh-CN': '上下文', 'en-US': 'Context' })}>
          <span className="composer-runtime-pill" title={workspaceTitle(runtimeContext.workspacePath, t)}>
            <Folder size={13} />
            {workspaceLabel(runtimeContext.workspacePath, t)}
          </span>
          <span className="composer-runtime-pill" title={t({ 'zh-CN': 'Assistant 连接', 'en-US': 'Assistant connection' })}>
            <Sparkles size={13} />
            {assistantConnectionLabel(runtimeContext, t)}
          </span>
          <span className="composer-runtime-pill permission" title={t({ 'zh-CN': '权限', 'en-US': 'Permission' })}>
            <ShieldCheck size={13} />
            {permissionLabel(runtimeContext.permissionMode, t)}
          </span>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSend();
        }}
        placeholder={isSending ? sendingPlaceholder : placeholder}
        disabled={disabled}
        rows={1}
        style={{ height: `${composerHeight}px` }}
      />
      {contextMeter}
      {isSending ? (
        <ActionButton icon={CircleStop} variant="coral" onClick={onAbort}>
          {t({ 'zh-CN': '停止', 'en-US': 'Stop' })}
        </ActionButton>
      ) : null}
      <ActionButton icon={Sparkles} onClick={onSend} disabled={disabled || (!input.trim() && !pendingReferences.length)}>
        {isSending ? sendingLabel : sendLabel}
      </ActionButton>
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>['t'];

function workspaceLabel(path: string, t: Translate) {
  const trimmed = path.trim();
  return trimmed ? t({ 'zh-CN': '工作区', 'en-US': 'Workspace' }) : t({ 'zh-CN': '未选择工作区', 'en-US': 'No workspace' });
}

function workspaceTitle(path: string, t: Translate) {
  return path.trim() ? t({ 'zh-CN': '当前工作区', 'en-US': 'Current workspace' }) : t({ 'zh-CN': '未选择工作区', 'en-US': 'No workspace selected' });
}

function assistantConnectionLabel(context: NonNullable<Parameters<typeof ChatComposer>[0]['runtimeContext']>, t: Translate) {
  return context.model.trim()
    ? t({ 'zh-CN': 'Assistant 已连接', 'en-US': 'Assistant connected' })
    : t({ 'zh-CN': '连接未配置', 'en-US': 'Connection not configured' });
}

function permissionLabel(permissionMode: string, t: Translate) {
  const normalized = permissionMode.trim();
  if (!normalized) return t({ 'zh-CN': '权限未设置', 'en-US': 'Permission not set' });
  if (/read[-_\s]?only|readonly|只读/i.test(normalized)) return t({ 'zh-CN': '只读', 'en-US': 'Read-only' });
  if (/write|写|可写/i.test(normalized)) return t({ 'zh-CN': '可写', 'en-US': 'Writable' });
  if (/ask|approve|confirm|确认|审批/i.test(normalized)) return t({ 'zh-CN': '先询问', 'en-US': 'Ask first' });
  return t({ 'zh-CN': '权限已设置', 'en-US': 'Permission set' });
}
