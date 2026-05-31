import { ChevronLeft, ChevronRight, GalleryHorizontalEnd, Image, ListChecks, Plus, TerminalSquare, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../uiPrimitives';
import type { SciForgeRun } from '../../domain';
import type { ScenarioId } from '../../data';
import { resultText, type ResultLocale } from './resultLocale';

export type ResultFocusMode = 'all' | 'visual' | 'evidence' | 'execution';
export type ResultPaneTab = 'primary' | 'browser' | 'screen' | 'terminal' | 'files' | 'evidence';
export interface ResultPaneTabInstance {
  id: string;
  kind: ResultPaneTab;
  label: string;
  closable?: boolean;
}

const RESULT_TABS: Array<{ id: ResultPaneTab; label: string }> = [
  { id: 'primary', label: 'Results' },
  { id: 'browser', label: 'Browser' },
  { id: 'screen', label: 'Screen' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'files', label: 'Files' },
  { id: 'evidence', label: 'References' },
];

const RESULT_FOCUS_MODES: Array<{ id: ResultFocusMode; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All', icon: GalleryHorizontalEnd },
  { id: 'visual', label: 'Media', icon: Image },
  { id: 'evidence', label: 'Sources', icon: ListChecks },
  { id: 'execution', label: 'Activity', icon: TerminalSquare },
];

export function ResultShell({
  collapsed,
  activeTabId,
  resultTab,
  resultTabs,
  focusMode,
  activeRun,
  scenarioId,
  locale,
  children,
  drawer,
  onToggleCollapse,
  onResultTabChange,
  onNewResultTab,
  onCloseResultTab,
  onFocusModeChange,
  onActiveRunChange,
}: {
  collapsed: boolean;
  activeTabId: string;
  resultTab: ResultPaneTab;
  resultTabs: ResultPaneTabInstance[];
  focusMode: ResultFocusMode;
  activeRun?: SciForgeRun;
  scenarioId: ScenarioId;
  locale?: ResultLocale;
  children: ReactNode;
  drawer?: ReactNode;
  onToggleCollapse: () => void;
  onResultTabChange: (tabId: string) => void;
  onNewResultTab: (tab: ResultPaneTab) => void;
  onCloseResultTab: (tabId: string) => void;
  onFocusModeChange: (mode: ResultFocusMode) => void;
  onActiveRunChange: (runId: string | undefined) => void;
}) {
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const newTabButtonRef = useRef<HTMLButtonElement | null>(null);
  const newTabMenuRef = useRef<HTMLDivElement | null>(null);
  const newTabMenuId = 'result-new-tab-menu';
  const tabs = (Array.isArray(resultTabs) ? resultTabs : []).map((tab) => ({
    ...tab,
    label: tab.label || resultTabLabel(tab.kind, locale),
  }));
  const newTabOptions = RESULT_TABS.map((tab) => ({
    ...tab,
    label: resultTabLabel(tab.id, locale),
  }));
  const focusModes = RESULT_FOCUS_MODES.map((mode) => ({
    ...mode,
    label: resultFocusModeLabel(mode.id, locale),
  }));
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeTabButtonId = activeTab ? resultTabButtonId(activeTab.id) : undefined;
  const activePanelId = activeTab ? resultTabPanelId(activeTab.id) : undefined;
  useEffect(() => {
    if (!newTabMenuOpen) return undefined;
    const firstItem = newTabMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    window.setTimeout(() => firstItem?.focus(), 0);
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (newTabButtonRef.current?.contains(target) || newTabMenuRef.current?.contains(target)) return;
      setNewTabMenuOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [newTabMenuOpen]);

  function handleTabstripKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!tabs.length) return;
    const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
    const lastIndex = tabs.length - 1;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
    else if (event.key === 'ArrowLeft') nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = lastIndex;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onResultTabChange(nextTab.id);
    window.setTimeout(() => document.getElementById(resultTabButtonId(nextTab.id))?.focus(), 0);
  }
  function handleNewTabMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(newTabMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      setNewTabMenuOpen(false);
      window.setTimeout(() => newTabButtonRef.current?.focus(), 0);
      return;
    } else return;
    event.preventDefault();
    items[nextIndex]?.focus();
  }
  return (
    <div className={cx('results-panel', collapsed && 'collapsed')} data-result-tab={resultTab}>
      <button
        className="results-collapse-button"
        type="button"
        onClick={onToggleCollapse}
        title={collapsed
          ? resultText(locale, { 'zh-CN': '打开结果面板', 'en-US': 'Open results panel' })
          : resultText(locale, { 'zh-CN': '折叠结果面板', 'en-US': 'Collapse results panel' })}
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
      {!collapsed ? (
        <>
          <div className="result-tabs">
            <div
              className="result-tabstrip"
              role="tablist"
              aria-label={resultText(locale, { 'zh-CN': '右侧页面', 'en-US': 'Right pane pages' })}
              onKeyDown={handleTabstripKeyDown}
            >
              {tabs.map((tab) => (
                <span key={tab.id} className={cx('result-page-tab-item', activeTabId === tab.id && 'active')}>
                  <button
                    id={resultTabButtonId(tab.id)}
                    className="result-page-tab"
                    type="button"
                    role="tab"
                    aria-selected={activeTabId === tab.id}
                    aria-controls={resultTabPanelId(tab.id)}
                    tabIndex={activeTabId === tab.id ? 0 : -1}
                    onClick={() => onResultTabChange(tab.id)}
                  >
                    <span>{tab.label}</span>
                  </button>
                </span>
              ))}
            </div>
            <div className="result-new-tab">
              <button
                ref={newTabButtonRef}
                className="result-new-tab-button"
                type="button"
                aria-haspopup="menu"
                aria-expanded={newTabMenuOpen}
                aria-controls={newTabMenuOpen ? newTabMenuId : undefined}
                aria-label={resultText(locale, { 'zh-CN': '新建右侧页面', 'en-US': 'New right pane page' })}
                title={resultText(locale, { 'zh-CN': '新建页面', 'en-US': 'New tab' })}
                onClick={() => setNewTabMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setNewTabMenuOpen(true);
                }}
              >
                <Plus size={13} aria-hidden="true" />
                <span>{resultText(locale, { 'zh-CN': '新建', 'en-US': 'New' })}</span>
              </button>
              {newTabMenuOpen ? (
                <div
                  id={newTabMenuId}
                  ref={newTabMenuRef}
                  className="result-new-tab-menu"
                  role="menu"
                  onKeyDown={handleNewTabMenuKeyDown}
                >
                  {newTabOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onNewResultTab(option.id);
                        setNewTabMenuOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {activeTab ? (
              <button
                type="button"
                className="result-active-tab-close"
                aria-label={resultText(locale, { 'zh-CN': `关闭 ${activeTab.label}`, 'en-US': `Close ${activeTab.label}` })}
                title={resultText(locale, { 'zh-CN': `关闭 ${activeTab.label}`, 'en-US': `Close ${activeTab.label}` })}
                onClick={() => onCloseResultTab(activeTab.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            ) : null}
            <div className="result-focus-mode" aria-label={resultText(locale, { 'zh-CN': '结果聚焦模式', 'en-US': 'Result focus mode' })}>
              {focusModes.map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    className={cx(focusMode === mode.id && 'active')}
                    type="button"
                    aria-label={mode.label}
                    title={mode.label}
                    onClick={() => onFocusModeChange(mode.id)}
                  >
                    <Icon size={13} strokeWidth={2} aria-hidden="true" />
                    <span>{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div
            className="result-content"
            role="tabpanel"
            id={activePanelId}
            aria-labelledby={activeTabButtonId}
          >
            {activeRun ? (
              <div className="active-run-banner">
                <div>
                  <strong>{resultText(locale, { 'zh-CN': '当前结果', 'en-US': 'Active result' })}</strong>
                  <span>{runStatusLabel(activeRun.status, locale)} · {scenarioLabel(scenarioId, locale)}</span>
                </div>
                <button type="button" onClick={() => onActiveRunChange(undefined)}>
                  {resultText(locale, { 'zh-CN': '清除', 'en-US': 'Clear' })}
                </button>
              </div>
            ) : null}
            {children}
          </div>
          {drawer}
        </>
      ) : (
        <div className="results-collapsed-hint">{resultText(locale, { 'zh-CN': '结果', 'en-US': 'Results' })}</div>
      )}
    </div>
  );
}

function resultTabLabel(tabId: ResultPaneTab, locale?: ResultLocale) {
  if (tabId === 'browser') return resultText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' });
  if (tabId === 'screen') return resultText(locale, { 'zh-CN': '屏幕', 'en-US': 'Screen' });
  if (tabId === 'terminal') return resultText(locale, { 'zh-CN': '终端', 'en-US': 'Terminal' });
  if (tabId === 'files') return resultText(locale, { 'zh-CN': '文件', 'en-US': 'Files' });
  if (tabId === 'evidence') return resultText(locale, { 'zh-CN': '引用', 'en-US': 'References' });
  return resultText(locale, { 'zh-CN': '结果', 'en-US': 'Results' });
}

function resultTabDomId(tabId: string) {
  return tabId.replace(/[^A-Za-z0-9_-]/g, '-');
}

function resultTabButtonId(tabId: string) {
  return `result-tab-${resultTabDomId(tabId)}`;
}

function resultTabPanelId(tabId: string) {
  return `result-panel-${resultTabDomId(tabId)}`;
}

function resultFocusModeLabel(mode: ResultFocusMode, locale?: ResultLocale) {
  if (mode === 'visual') return resultText(locale, { 'zh-CN': '媒体', 'en-US': 'Media' });
  if (mode === 'evidence') return resultText(locale, { 'zh-CN': '来源', 'en-US': 'Sources' });
  if (mode === 'execution') return resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' });
  return resultText(locale, { 'zh-CN': '全部', 'en-US': 'All' });
}

function runStatusLabel(status: SciForgeRun['status'], locale?: ResultLocale) {
  if (status === 'completed') return resultText(locale, { 'zh-CN': '完成', 'en-US': 'Done' });
  if (status === 'running') return resultText(locale, { 'zh-CN': '运行中', 'en-US': 'Running' });
  if (status === 'failed') return resultText(locale, { 'zh-CN': '失败', 'en-US': 'Failed' });
  if (status === 'cancelled') return resultText(locale, { 'zh-CN': '已取消', 'en-US': 'Cancelled' });
  return resultText(locale, { 'zh-CN': '排队中', 'en-US': 'Queued' });
}

function scenarioLabel(scenarioId: ScenarioId, locale?: ResultLocale) {
  if (scenarioId === 'literature-evidence-review') return resultText(locale, { 'zh-CN': '文献', 'en-US': 'Literature' });
  if (scenarioId === 'structure-exploration') return resultText(locale, { 'zh-CN': '结构', 'en-US': 'Structure' });
  if (scenarioId === 'omics-differential-exploration') return resultText(locale, { 'zh-CN': '组学', 'en-US': 'Omics' });
  if (scenarioId === 'biomedical-knowledge-graph') return resultText(locale, { 'zh-CN': '知识图谱', 'en-US': 'Knowledge graph' });
  return resultText(locale, { 'zh-CN': '当前任务', 'en-US': 'Current task' });
}
