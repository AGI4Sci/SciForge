import { useId, type CSSProperties } from 'react';
import { buildContextWindowMeterModel } from '../../contextWindow';
import type { AgentContextWindowState } from '../../domain';
import { cx } from '../uiPrimitives';

export function ContextWindowMeter({
  state,
  running,
}: {
  state: AgentContextWindowState;
  running: boolean;
}) {
  const meter = buildContextWindowMeterModel(state, running);
  const tooltipId = useId();
  return (
    <div
      role="status"
      aria-label={`上下文窗口 ${meter.ratioLabel}，${meter.statusLabel}`}
      aria-describedby={tooltipId}
      className={cx('context-window-meter', meter.level, meter.isEstimated && 'estimated', meter.isUnknown && 'unknown')}
      title={meter.title}
      tabIndex={0}
      style={{ '--context-window-ratio': meter.ratioStyle } as CSSProperties}
    >
      <span className="context-window-ring" aria-hidden="true">
        <span>{meter.ratioLabel === '未知' ? '?' : meter.ratioLabel}</span>
      </span>
      <div className="context-window-popover" id={tooltipId} role="tooltip">
        <div className="context-window-popover-head">
          <strong>当前上下文</strong>
          <em>{meter.statusLabel}</em>
        </div>
        <dl>
          {meter.detailRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <small>{meter.memoryBoundaryLine}</small>
      </div>
    </div>
  );
}
