import { runtimeAcceptanceDiagnostic } from '@sciforge-ui/runtime-contract/agent-backend-policy';
import { Badge } from '../uiPrimitives';
import type { SciForgeMessage } from '../../domain';

export function AcceptancePanel({
  acceptance,
}: {
  acceptance: NonNullable<SciForgeMessage['acceptance']>;
}) {
  const diagnostic = turnAcceptanceDiagnostic(acceptance);
  return (
    <div className="turn-acceptance-notice">
      <Badge variant={acceptance.severity === 'repairable' ? 'warning' : 'danger'}>{acceptance.severity}</Badge>
      <div className="turn-acceptance-copy">
        <strong>{diagnostic.title}</strong>
        <span>{diagnostic.summary}</span>
        {diagnostic.recoverActions.length ? (
          <ul>
            {diagnostic.recoverActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        ) : null}
        {diagnostic.secondary.length ? (
          <div className="turn-acceptance-secondary">
            {diagnostic.secondary.map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
        <details className="turn-acceptance-raw">
          <summary>查看原始诊断</summary>
          <pre>{diagnostic.rawDetails}</pre>
        </details>
      </div>
    </div>
  );
}

export function turnAcceptanceDiagnostic(acceptance: NonNullable<SciForgeMessage['acceptance']>) {
  return runtimeAcceptanceDiagnostic(acceptance);
}
