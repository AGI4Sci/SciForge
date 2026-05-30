import { ChevronLeft, ChevronRight, GalleryHorizontalEnd, Image, ListChecks, TerminalSquare, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TabBar, cx } from '../uiPrimitives';
import type { SciForgeRun } from '../../domain';
import type { ScenarioId } from '../../data';
import { resultText, type ResultLocale } from './resultLocale';

export type ResultFocusMode = 'all' | 'visual' | 'evidence' | 'execution';

const RESULT_TABS = [
  { id: 'primary', label: 'Results' },
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
  resultTab,
  focusMode,
  activeRun,
  scenarioId,
  locale,
  children,
  drawer,
  onToggleCollapse,
  onResultTabChange,
  onFocusModeChange,
  onActiveRunChange,
}: {
  collapsed: boolean;
  resultTab: string;
  focusMode: ResultFocusMode;
  activeRun?: SciForgeRun;
  scenarioId: ScenarioId;
  locale?: ResultLocale;
  children: ReactNode;
  drawer?: ReactNode;
  onToggleCollapse: () => void;
  onResultTabChange: (tab: string) => void;
  onFocusModeChange: (mode: ResultFocusMode) => void;
  onActiveRunChange: (runId: string | undefined) => void;
}) {
  const tabs = RESULT_TABS.map((tab) => ({
    ...tab,
    label: resultTabLabel(tab.id, locale),
  }));
  const focusModes = RESULT_FOCUS_MODES.map((mode) => ({
    ...mode,
    label: resultFocusModeLabel(mode.id, locale),
  }));
  return (
    <div className={cx('results-panel', collapsed && 'collapsed')}>
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
            <TabBar tabs={tabs} active={resultTab} onChange={onResultTabChange} />
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
          <div className="result-content">
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

function resultTabLabel(tabId: string, locale?: ResultLocale) {
  if (tabId === 'evidence') return resultText(locale, { 'zh-CN': '引用', 'en-US': 'References' });
  return resultText(locale, { 'zh-CN': '结果', 'en-US': 'Results' });
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
  if (status === 'failed') return resultText(locale, { 'zh-CN': '需要处理', 'en-US': 'Needs attention' });
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
