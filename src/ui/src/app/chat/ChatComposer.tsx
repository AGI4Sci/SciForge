import { Bot, ChevronDown, ChevronRight, ChevronUp, CircleStop, FileUp, Folder, Image, Mic, Plus, Quote, Send, ShieldCheck, Sparkles, Wrench, X } from 'lucide-react';
import { ActionButton } from '../uiPrimitives';
import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { SciForgeConfig, SciForgeReference } from '../../domain';
import { useI18n } from '../../i18nContext';
import {
  applyComposerToolDirective,
  composerAutonomySelectionIntents,
  buildComposerCapabilityMenu,
  buildComposerToolMenu,
  composerModeSelectionIntentForToolItem,
  composerModelSelectionIntents,
  filterComposerCapabilityMenuItems,
  filterComposerToolMenuItems,
  publicComposerModel,
  type ComposerAgentHostCatalogItem,
  type ComposerAutonomySelectionIntent,
  type ComposerCapabilityMenuItem,
  type ComposerModeSelectionIntent,
  type ComposerModelSelectionIntent,
  type ComposerToolMenuItem,
} from './composerToolMenu';

export function ChatComposer({
  expanded,
  input,
  isSending,
  composerHeight,
  referencePickMode,
  pendingReferences,
  queuedGuidanceCount = 0,
  contextMeter,
  fileInputRef,
  referenceChips,
  topAddon,
  runtimeContext,
  toolProviderRoutes,
  agentHostCatalog,
  textareaRef,
  onExpand,
  onCollapse,
  onToggleReferencePickMode,
  onFileUpload,
  onInputChange,
  onSend,
  onAbort,
  onModelIntentSelect,
  onModeIntentSelect,
  onAutonomyIntentSelect,
  onClearModeIntent,
  onBeginResize,
  copy,
  selectedModeIntent,
  selectedAutonomyIntent,
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
  queuedGuidanceCount?: number;
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
  toolProviderRoutes?: SciForgeConfig['toolProviderRoutes'];
  agentHostCatalog?: ComposerAgentHostCatalogItem[];
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onExpand: () => void;
  onCollapse: () => void;
  onToggleReferencePickMode: () => void;
  onFileUpload: (files: FileList | null) => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onModelIntentSelect?: (intent: ComposerModelSelectionIntent) => void;
  onModeIntentSelect?: (intent: ComposerModeSelectionIntent) => void;
  onAutonomyIntentSelect?: (intent: ComposerAutonomySelectionIntent) => void;
  onClearModeIntent?: () => void;
  onBeginResize: (event: React.MouseEvent<HTMLDivElement>) => void;
  selectedModeIntent?: ComposerModeSelectionIntent | null;
  selectedAutonomyIntent?: ComposerAutonomySelectionIntent | null;
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
  const { t, locale } = useI18n();
  const collapsedText = copy?.collapsedText ?? t({ 'zh-CN': '提问，或附加上下文...', 'en-US': 'Ask a question, or attach context...' });
  const referenceHint = copy?.referenceHint ?? t({ 'zh-CN': '选择可见对象作为上下文', 'en-US': 'Select visible objects as context' });
  const placeholder = copy?.placeholder ?? t({ 'zh-CN': '提问，或附加上下文...', 'en-US': 'Ask a question, or attach context...' });
  const sendingPlaceholder = copy?.sendingPlaceholder ?? t({ 'zh-CN': '当前任务运行中，追加指令会排队...', 'en-US': 'Additional guidance will queue while this runs...' });
  const activePlaceholder = selectedModeIntent?.id === 'multitask' && !input.trim()
    ? t({ 'zh-CN': '协调并行任务...', 'en-US': 'Coordinate parallel tasks...' })
    : placeholder;
  const sendLabel = copy?.sendLabel ?? t({ 'zh-CN': '发送', 'en-US': 'Send' });
  const sendingLabel = copy?.sendingLabel ?? t({ 'zh-CN': '排队', 'en-US': 'Queue' });
  const toolMenu = buildComposerToolMenu(locale);
  const capabilityMenu = buildComposerCapabilityMenu({ locale, toolProviderRoutes, agentHostCatalog });
  const [addMenuQuery, setAddMenuQuery] = useState('');
  const visibleToolMenu = useMemo(() => filterComposerToolMenuItems(toolMenu, addMenuQuery), [toolMenu, addMenuQuery]);
  const visibleSkills = useMemo(() => filterComposerCapabilityMenuItems(capabilityMenu.skills, addMenuQuery), [capabilityMenu.skills, addMenuQuery]);
  const visibleMcpServers = useMemo(() => filterComposerCapabilityMenuItems(capabilityMenu.mcpServers, addMenuQuery), [capabilityMenu.mcpServers, addMenuQuery]);
  const model = publicComposerModel(runtimeContext, locale);
  const addMenuRef = useRef<HTMLDetailsElement | null>(null);
  const modelMenuRef = useRef<HTMLDetailsElement | null>(null);
  const autonomyMenuRef = useRef<HTMLDetailsElement | null>(null);
  const autonomyIntent = selectedAutonomyIntent ?? composerAutonomySelectionIntents(locale).find((item) => item.id === 'high-autonomy')!;
  if (!expanded) {
    return (
      <button
        type="button"
        className="composer-collapsed"
        data-testid="chat-composer-collapsed-button"
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
    <div className="composer" aria-expanded={true} data-selected-mode={selectedModeIntent?.id}>
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
          <details ref={addMenuRef} className="composer-add-menu">
            <summary title={t({ 'zh-CN': '添加 agents、context、tools', 'en-US': 'Add agents, context, tools' })}>
              <Plus size={15} aria-hidden />
              <span>{t({ 'zh-CN': 'Add agents, context, tools', 'en-US': 'Add agents, context, tools' })}</span>
            </summary>
            <div className="composer-add-menu-panel">
              <input
                aria-label={t({ 'zh-CN': '搜索菜单项', 'en-US': 'Search menu items' })}
                placeholder={t({ 'zh-CN': 'Add agents, context, tools...', 'en-US': 'Add agents, context, tools...' })}
                value={addMenuQuery}
                onChange={(event) => setAddMenuQuery(event.currentTarget.value)}
              />
              {visibleToolMenu.map((item) => {
                const modeIntent = composerModeSelectionIntentForToolItem(item, locale);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={modeIntent ? 'composer-mode-chip' : undefined}
                    data-composer-tool={item.id}
                    data-mode-option={modeIntent?.id}
                    data-mode-intent={modeIntent?.id}
                    data-mode-selected={modeIntent && selectedModeIntent?.id === modeIntent.id ? 'true' : undefined}
                    aria-pressed={modeIntent ? selectedModeIntent?.id === modeIntent.id : undefined}
                    onClick={() => handleToolMenuItem(item)}
                  >
                    <ComposerToolIcon item={item} />
                    <span>{item.label}</span>
                    {(item.id === 'models' || item.id === 'skills' || item.id === 'mcp-servers') ? <ChevronRight size={13} aria-hidden /> : null}
                  </button>
                );
              })}
              {visibleSkills.length ? (
                <div className="composer-add-menu-section" aria-label={t({ 'zh-CN': '技能', 'en-US': 'Skills' })}>
                  <small>{t({ 'zh-CN': 'Skills', 'en-US': 'Skills' })}</small>
                  {visibleSkills.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-composer-capability={item.kind}
                      onClick={() => handleCapabilityMenuItem(item)}
                    >
                      <Wrench size={14} aria-hidden />
                      <span>{item.label}</span>
                      <em>{item.detail}</em>
                    </button>
                  ))}
                </div>
              ) : null}
              {visibleMcpServers.length ? (
                <div className="composer-add-menu-section" aria-label={t({ 'zh-CN': 'MCP 服务器', 'en-US': 'MCP Servers' })}>
                  <small>{t({ 'zh-CN': 'MCP Servers', 'en-US': 'MCP Servers' })}</small>
                  {visibleMcpServers.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-composer-capability={item.kind}
                      onClick={() => handleCapabilityMenuItem(item)}
                    >
                      <Wrench size={14} aria-hidden />
                      <span>{item.label}</span>
                      <em>{item.detail}</em>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
          {showFileUpload ? (
            <input
              ref={fileInputRef}
              className="sr-only-file-input"
              type="file"
              multiple
              onChange={(event) => onFileUpload(event.currentTarget.files)}
            />
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
        <div className="composer-runtime-row" aria-label={t({ 'zh-CN': '本地环境', 'en-US': 'Local environment' })} data-local-environment="true">
          <span className="composer-runtime-pill" title={workspaceTitle(runtimeContext.workspacePath, t)}>
            <Folder size={13} />
            {workspaceLabel(runtimeContext.workspacePath, t)}
          </span>
          <span className="composer-runtime-pill" title={t({ 'zh-CN': 'Assistant 连接', 'en-US': 'Assistant connection' })}>
            <Sparkles size={13} />
            {assistantConnectionLabel(runtimeContext, t)}
          </span>
          <details ref={autonomyMenuRef} className="composer-autonomy-menu">
            <summary title={t({ 'zh-CN': 'Autonomy', 'en-US': 'Autonomy' })}>
              <ShieldCheck size={13} aria-hidden />
              <span>{t({ 'zh-CN': 'Autonomy', 'en-US': 'Autonomy' })}</span>
              <em>{autonomyIntent.label}</em>
              <ChevronDown size={12} aria-hidden className="composer-autonomy-menu-chevron" />
            </summary>
            <div className="composer-autonomy-menu-panel">
              {composerAutonomySelectionIntents(locale).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="composer-autonomy-option"
                  data-autonomy-option={option.id}
                  data-autonomy-selected={autonomyIntent.id === option.id ? 'true' : undefined}
                  aria-pressed={autonomyIntent.id === option.id}
                  onClick={() => handleAutonomyIntent(option)}
                >
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </details>
        </div>
      ) : null}
      {selectedModeIntent ? (
        <div className="composer-selected-mode-row">
          <button
            type="button"
            className="composer-mode-chip selected"
            data-selected-mode={selectedModeIntent.id}
            onClick={onClearModeIntent}
            aria-label={t({
              'zh-CN': `移除 ${selectedModeIntent.label} 模式`,
              'en-US': `Remove ${selectedModeIntent.label} mode`,
            })}
            title={t({
              'zh-CN': `移除 ${selectedModeIntent.label} 模式`,
              'en-US': `Remove ${selectedModeIntent.label} mode`,
            })}
          >
            <Sparkles size={13} aria-hidden />
            <span>{selectedModeIntent.label}</span>
            <X size={12} aria-hidden />
          </button>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        data-testid="chat-composer-textarea"
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSend();
        }}
        placeholder={isSending ? sendingPlaceholder : activePlaceholder}
        disabled={disabled}
        rows={1}
        style={{ height: `${composerHeight}px` }}
      />
      <div className="composer-bottom-toolbar">
        <details ref={modelMenuRef} className="composer-model-menu">
          <summary title={t({ 'zh-CN': '模型和模式', 'en-US': 'Model and mode' })}>
            <Bot size={14} aria-hidden />
            <span>{model.label}</span>
            <em>{model.speed}</em>
          </summary>
          <div className="composer-model-menu-panel">
            <input aria-label={t({ 'zh-CN': '搜索模型', 'en-US': 'Search models' })} placeholder={t({ 'zh-CN': 'Search models', 'en-US': 'Search models' })} readOnly />
            {composerModelSelectionIntents(locale).map((option) => (
              <button
                key={option.id}
                type="button"
                data-model-option={option.id}
                data-model-intent={option.mode}
                onClick={() => handleModelIntent(option)}
              >
                <span>{option.label}</span>
                <em>{option.speed}</em>
              </button>
            ))}
          </div>
        </details>
        <button type="button" className="composer-icon-button" title={t({ 'zh-CN': '语音输入', 'en-US': 'Start voice input' })} aria-label={t({ 'zh-CN': '语音输入', 'en-US': 'Start voice input' })}>
          <Mic size={15} aria-hidden />
        </button>
        {isSending && queuedGuidanceCount > 0 ? (
          <span
            className="composer-queue-status"
            role="status"
            aria-live="polite"
            aria-label={t({ 'zh-CN': '排队中的追加指令', 'en-US': 'Queued guidance' })}
          >
            {t({ 'zh-CN': `${queuedGuidanceCount} 条已排队`, 'en-US': `${queuedGuidanceCount} queued` })}
          </span>
        ) : null}
        {contextMeter}
      </div>
      {isSending ? (
        <ActionButton icon={CircleStop} variant="coral" onClick={onAbort}>
          {t({ 'zh-CN': '停止', 'en-US': 'Stop' })}
        </ActionButton>
      ) : null}
      <ActionButton
        icon={isSending ? Sparkles : Send}
        data-testid="chat-composer-send-button"
        onClick={onSend}
        disabled={disabled || (!input.trim() && !pendingReferences.length)}
      >
        {isSending ? sendingLabel : sendLabel}
      </ActionButton>
    </div>
  );

  function handleToolMenuItem(item: ComposerToolMenuItem) {
    addMenuRef.current?.removeAttribute('open');
    if (item.id === 'pick-context') {
      if (showReferencePicker) onToggleReferencePickMode();
      return;
    }
    if (item.id === 'attach-file' || item.id === 'image') {
      if (showFileUpload) fileInputRef.current?.click();
      return;
    }
    if (item.id === 'models') {
      modelMenuRef.current?.setAttribute('open', '');
      return;
    }
    const modeIntent = composerModeSelectionIntentForToolItem(item, locale);
    if (modeIntent) {
      onModeIntentSelect?.(modeIntent);
      return;
    }
    onInputChange(applyComposerToolDirective(input, item));
  }

  function handleCapabilityMenuItem(item: ComposerCapabilityMenuItem) {
    addMenuRef.current?.removeAttribute('open');
    onInputChange(applyComposerToolDirective(input, item));
  }

  function handleModelIntent(intent: ComposerModelSelectionIntent) {
    modelMenuRef.current?.removeAttribute('open');
    onModelIntentSelect?.(intent);
  }

  function handleAutonomyIntent(intent: ComposerAutonomySelectionIntent) {
    autonomyMenuRef.current?.removeAttribute('open');
    onAutonomyIntentSelect?.(intent);
  }
}

function ComposerToolIcon({ item }: { item: ComposerToolMenuItem }) {
  if (item.id === 'image') return <Image size={14} aria-hidden />;
  if (item.id === 'pick-context') return <Quote size={14} aria-hidden />;
  if (item.id === 'attach-file') return <FileUp size={14} aria-hidden />;
  if (item.group === 'agent') return <Sparkles size={14} aria-hidden />;
  if (item.id === 'models') return <Bot size={14} aria-hidden />;
  return <Wrench size={14} aria-hidden />;
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
