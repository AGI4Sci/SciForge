import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { TabBar, cx } from '../uiPrimitives';
import type { SciForgeRun } from '../../domain';
import type { ScenarioId } from '../../data';

export type ResultFocusMode = 'all' | 'visual' | 'evidence' | 'execution';

const RESULT_TABS = [
  { id: 'primary', label: '结果视图' },
  { id: 'evidence', label: '证据矩阵' },
];

const RESULT_FOCUS_MODES: Array<{ id: ResultFocusMode; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'visual', label: '只看图' },
  { id: 'evidence', label: '只看证据' },
  { id: 'execution', label: '只看执行单元' },
];

export function ResultShell({
  collapsed,
  resultTab,
  focusMode,
  activeRun,
  scenarioId,
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
  children: ReactNode;
  drawer?: ReactNode;
  onToggleCollapse: () => void;
  onResultTabChange: (tab: string) => void;
  onFocusModeChange: (mode: ResultFocusMode) => void;
  onActiveRunChange: (runId: string | undefined) => void;
}) {
  return (
    <div className={cx('results-panel', collapsed && 'collapsed')}>
      <button
        className="results-collapse-button"
        type="button"
        onClick={onToggleCollapse}
        title={collapsed ? '展开结果面板' : '向右收缩结果面板'}
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
      {!collapsed ? (
        <>
          <div className="result-tabs">
            <TabBar tabs={RESULT_TABS} active={resultTab} onChange={onResultTabChange} />
            <div className="result-focus-mode" aria-label="结果区 focus mode">
              {RESULT_FOCUS_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={cx(focusMode === mode.id && 'active')}
                  type="button"
                  onClick={() => onFocusModeChange(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="result-content">
            {activeRun ? (
              <div className="active-run-banner">
                <div>
                  <strong>当前聚焦 run</strong>
                  <span>{activeRun.id} · {activeRun.status} · {activeRun.scenarioPackageRef ? `${activeRun.scenarioPackageRef.id}@${activeRun.scenarioPackageRef.version}` : scenarioId}</span>
                </div>
                <button type="button" onClick={() => onActiveRunChange(undefined)}>取消高亮</button>
              </div>
            ) : null}
            {children}
          </div>
          {drawer}
        </>
      ) : (
        <div className="results-collapsed-hint">结果</div>
      )}
    </div>
  );
}
