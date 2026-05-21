import { Badge } from '../uiPrimitives';

export function RunReadinessBar({
  ok,
  severity,
  message,
}: {
  ok: boolean;
  severity: 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';
  message: string;
}) {
  return (
    <div className="run-readiness">
      <Badge variant={ok ? 'success' : severity}>{ok ? '可运行' : '提示'}</Badge>
      <span>{message}</span>
    </div>
  );
}
