import { useId, type CSSProperties } from 'react';
import { buildContextWindowMeterModel } from '../../contextWindow';
import type { AgentContextWindowState } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import { useI18n } from '../../i18nContext';
import { cx } from '../uiPrimitives';
import { chatText } from './chatI18n';

export function ContextWindowMeter({
  state,
  running,
  locale: localeOverride,
}: {
  state: AgentContextWindowState;
  running: boolean;
  locale?: SupportedLocale;
}) {
  const { locale: contextLocale } = useI18n();
  const locale = localeOverride ?? contextLocale;
  const meter = buildContextWindowMeterModel(state, running);
  const tooltipId = useId();
  const ratioLabel = localizeContextValue(meter.ratioLabel, locale);
  const statusLabel = localizeContextStatus(meter.statusLabel, locale);
  const title = chatText(locale, {
    'zh-CN': `上下文 ${localizeContextValue(meter.ratioDetail, locale)} · ${statusLabel}`,
    'en-US': `Context ${meter.ratioDetail} · ${statusLabel}`,
  });
  return (
    <div
      role="status"
      aria-label={chatText(locale, {
        'zh-CN': `上下文窗口 ${ratioLabel}，${statusLabel}`,
        'en-US': `Context window ${ratioLabel}, ${statusLabel}`,
      })}
      aria-describedby={tooltipId}
      className={cx('context-window-meter', meter.level, meter.isEstimated && 'estimated', meter.isUnknown && 'unknown')}
      title={title}
      tabIndex={0}
      style={{ '--context-window-ratio': meter.ratioStyle } as CSSProperties}
    >
      <span className="context-window-ring" aria-hidden="true">
        <span>{meter.ratioLabel === 'Unknown' ? '?' : meter.ratioLabel}</span>
      </span>
      <div className="context-window-popover" id={tooltipId} role="tooltip">
        <div className="context-window-popover-head">
          <strong>{chatText(locale, { 'zh-CN': '上下文', 'en-US': 'Context' })}</strong>
          <em>{statusLabel}</em>
        </div>
        <dl>
          {meter.detailRows.map((row) => (
            <div key={row.label}>
              <dt>{localizeContextRowLabel(row.label, locale)}</dt>
              <dd>{localizeContextValue(row.value, locale)}</dd>
            </div>
          ))}
        </dl>
        <small>{chatText(locale, {
          'zh-CN': '当前对话、已选择对象和必要摘要会被保留。',
          'en-US': meter.memoryBoundaryLine,
        })}</small>
      </div>
    </div>
  );
}

function localizeContextRowLabel(value: string, locale?: SupportedLocale) {
  const labels: Record<string, Record<SupportedLocale, string>> = {
    Used: { 'zh-CN': '已用', 'en-US': 'Used' },
    Remaining: { 'zh-CN': '剩余', 'en-US': 'Remaining' },
    Status: { 'zh-CN': '状态', 'en-US': 'Status' },
    Compaction: { 'zh-CN': '摘要', 'en-US': 'Compaction' },
    'Request size': { 'zh-CN': '请求大小', 'en-US': 'Request size' },
    Saved: { 'zh-CN': '已节省', 'en-US': 'Saved' },
    'Payload size': { 'zh-CN': '载荷大小', 'en-US': 'Payload size' },
    Budget: { 'zh-CN': '预算', 'en-US': 'Budget' },
  };
  return labels[value] ? chatText(locale, labels[value]) : value;
}

function localizeContextStatus(value: string, locale?: SupportedLocale) {
  const labels: Record<string, Record<SupportedLocale, string>> = {
    Good: { 'zh-CN': '良好', 'en-US': 'Good' },
    Watch: { 'zh-CN': '关注', 'en-US': 'Watch' },
    'Near limit': { 'zh-CN': '接近上限', 'en-US': 'Near limit' },
    Exceeded: { 'zh-CN': '已超出', 'en-US': 'Exceeded' },
    Compacting: { 'zh-CN': '摘要中', 'en-US': 'Compacting' },
    Blocked: { 'zh-CN': '被阻止', 'en-US': 'Blocked' },
    Unknown: { 'zh-CN': '未知', 'en-US': 'Unknown' },
  };
  return labels[value] ? chatText(locale, labels[value]) : value;
}

function localizeContextValue(value: string, locale?: SupportedLocale) {
  const status = localizeContextStatus(value, locale);
  if (status !== value) return status;
  return value
    .replace(/\bUnknown\b/g, chatText(locale, { 'zh-CN': '未知', 'en-US': 'Unknown' }))
    .replace(/\bcontext\b/g, chatText(locale, { 'zh-CN': '上下文', 'en-US': 'context' }))
    .replace(/\bbytes\b/g, chatText(locale, { 'zh-CN': '字节', 'en-US': 'bytes' }))
    .replace(/\bAutomatic\b/g, chatText(locale, { 'zh-CN': '自动', 'en-US': 'Automatic' }))
    .replace(/\bAvailable\b/g, chatText(locale, { 'zh-CN': '可用', 'en-US': 'Available' }))
    .replace(/\bPreparing\b/g, chatText(locale, { 'zh-CN': '准备中', 'en-US': 'Preparing' }))
    .replace(/\bOn demand\b/g, chatText(locale, { 'zh-CN': '按需', 'en-US': 'On demand' }));
}
