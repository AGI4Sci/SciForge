import type { SupportedLocale } from '../../i18n';
import { Badge } from '../uiPrimitives';
import { chatText } from './chatI18n';

export function RunReadinessBar({
  ok,
  severity,
  message,
  locale,
}: {
  ok: boolean;
  severity: 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';
  message: string;
  locale?: SupportedLocale;
}) {
  return (
    <div className="run-readiness">
      <Badge variant={ok ? 'success' : severity}>{ok
        ? chatText(locale, { 'zh-CN': '就绪', 'en-US': 'Ready' })
        : chatText(locale, { 'zh-CN': '提示', 'en-US': 'Tip' })}</Badge>
      <span>{message}</span>
    </div>
  );
}
