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
  { id: 'execution', label: '只看过程' },
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
                  <strong>本轮结果</strong>
                  <span>{runStatusLabel(activeRun.status)} · {scenarioLabel(scenarioId)}</span>
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

function runStatusLabel(status: SciForgeRun['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'running') return '进行中';
  if (status === 'failed') return '未完成';
  if (status === 'cancelled') return '已取消';
  return '等待中';
}

function scenarioLabel(scenarioId: ScenarioId) {
  if (scenarioId === 'literature-evidence-review') return '文献任务';
  if (scenarioId === 'structure-exploration') return '结构任务';
  if (scenarioId === 'omics-differential-exploration') return '组学任务';
  if (scenarioId === 'biomedical-knowledge-graph') return '知识图谱任务';
  return '当前任务';
}
