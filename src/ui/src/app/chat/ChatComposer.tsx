import { ChevronDown, ChevronUp, CircleStop, FileUp, Quote, Sparkles } from 'lucide-react';
import { ActionButton, cx } from '../uiPrimitives';
import type { ReactNode, RefObject } from 'react';
import type { SciForgeReference } from '../../domain';

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
  onExpand,
  onCollapse,
  onToggleReferencePickMode,
  onFileUpload,
  onInputChange,
  onSend,
  onAbort,
  onBeginResize,
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
  onExpand: () => void;
  onCollapse: () => void;
  onToggleReferencePickMode: () => void;
  onFileUpload: (files: FileList | null) => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onBeginResize: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  if (!expanded) {
    return (
      <button
        type="button"
        className="composer-collapsed"
        onClick={onExpand}
        aria-expanded={false}
        title="展开输入栏"
      >
        <Sparkles size={15} />
        <span>输入研究问题，或点选对象后继续追问...</span>
        <ChevronUp size={15} />
      </button>
    );
  }

  return (
    <div className="composer" aria-expanded={true}>
      <button
        type="button"
        className="composer-collapse-button"
        onClick={onCollapse}
        title="收起输入栏"
        aria-label="收起输入栏"
      >
        <ChevronDown size={15} />
      </button>
      <div className="composer-resize-handle" onMouseDown={onBeginResize} title="拖拽调整输入框高度" />
      <div className="reference-composer">
        <button
          type="button"
          className={cx('reference-trigger', referencePickMode && 'active')}
          onClick={onToggleReferencePickMode}
          title="点选模式引用整块 UI；选中文字可右键引用"
        >
          <Quote size={14} />
          点选
        </button>
        <button
          type="button"
          className="reference-trigger"
          onClick={() => fileInputRef.current?.click()}
          title="上传 PDF、图片、表格或任意文件到证据矩阵"
        >
          <FileUp size={14} />
          上传
        </button>
        <input
          ref={fileInputRef}
          className="sr-only-file-input"
          type="file"
          multiple
          onChange={(event) => onFileUpload(event.currentTarget.files)}
        />
        {pendingReferences.length ? referenceChips : <span className="reference-hint">点选 SciForge 可见对象作为上下文</span>}
      </div>
      {referencePickMode ? (
        <div className="reference-pick-banner">
          <Quote size={14} />
          点击页面对象引用整块 UI，Esc 取消
        </div>
      ) : null}
      <textarea
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSend();
        }}
        placeholder={isSending ? '继续输入引导会排队；也可以中断当前运行...' : '输入研究问题，或点选对象后继续追问...'}
        rows={1}
        style={{ height: `${composerHeight}px` }}
      />
      {contextMeter}
      {isSending ? (
        <ActionButton icon={CircleStop} variant="coral" onClick={onAbort}>
          中断
        </ActionButton>
      ) : null}
      <ActionButton icon={Sparkles} onClick={onSend} disabled={!input.trim() && !pendingReferences.length}>
        {isSending ? '引导' : '发送'}
      </ActionButton>
    </div>
  );
}
