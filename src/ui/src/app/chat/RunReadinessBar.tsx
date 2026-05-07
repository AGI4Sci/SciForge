import { Badge } from '../uiPrimitives';

export function RunReadinessBar({
  ok,
  severity,
  message,
  packageLabel,
}: {
  ok: boolean;
  severity: 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';
  message: string;
  packageLabel: string;
}) {
  return (
    <div className="run-readiness">
      <Badge variant={ok ? 'success' : severity}>{ok ? 'ready' : 'action'}</Badge>
      <span>{message}</span>
      <code>{packageLabel}</code>
    </div>
  );
}
