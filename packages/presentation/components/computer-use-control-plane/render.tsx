import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import {
  COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
  computerUseControlPlaneCommand,
  computerUseControlPlaneConfirmationResult,
  computerUseControlPlaneDisplayedRefs,
  normalizeComputerUseControlPlanePayload,
  type ComputerUseConfirmationDecision,
  type ComputerUseControlPlaneAction,
  type ComputerUseControlPlanePayload,
  type ComputerUseConfirmationResult,
  type ComputerUseTerminalEquivalentText,
} from './contract';

export type ComputerUseControlPlaneCallbacks = {
  onTerminalEquivalentText?: (event: ComputerUseTerminalEquivalentText) => void;
  onConfirmationResult?: (result: ComputerUseConfirmationResult) => void;
};

type ComputerUseControlPlaneRendererPayload = Partial<ComputerUseControlPlanePayload> & ComputerUseControlPlaneCallbacks;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function payloadFromProps(props: UIComponentRendererProps): ComputerUseControlPlaneRendererPayload {
  const artifactData = isRecord(props.artifact?.data) ? props.artifact.data : {};
  const slotProps = props.slot.props ?? {};
  return { ...artifactData, ...slotProps } as ComputerUseControlPlaneRendererPayload;
}

function actionButton(
  label: string,
  action: ComputerUseControlPlaneAction,
  payload: ComputerUseControlPlanePayload,
  onTerminalEquivalentText?: (event: ComputerUseTerminalEquivalentText) => void,
) {
  const event = computerUseControlPlaneCommand(payload, action);
  return (
    <button
      key={action}
      type="button"
      data-event="computer-use-terminal-equivalent-text"
      data-computer-use-action={action}
      data-command-text={event?.commandText}
      disabled={!event}
      onClick={() => {
        if (event) onTerminalEquivalentText?.(event);
      }}
    >
      {label}
    </button>
  );
}

function confirmationButton(
  label: string,
  decision: ComputerUseConfirmationDecision,
  payload: ComputerUseControlPlanePayload,
  onConfirmationResult?: (result: ComputerUseConfirmationResult) => void,
) {
  const result = computerUseControlPlaneConfirmationResult(payload, decision);
  return (
    <button
      key={decision}
      type="button"
      data-event="computer-use-confirmation-result"
      data-confirmation-decision={decision}
      data-command-text={result.commandText}
      disabled={!result.approvalRef && !result.approvalRequestRef}
      onClick={() => onConfirmationResult?.(result)}
    >
      {label}
    </button>
  );
}

function refList(title: string, refs: string[] | undefined, tone?: string) {
  if (!refs?.length) return null;
  return (
    <section className={`computer-use-control-plane-ref-group${tone ? ` ${tone}` : ''}`}>
      <h4>{title}</h4>
      <ul>
        {refs.map((ref) => (
          <li key={ref}>
            <code>{ref}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function singleRef(label: string, ref: string | undefined, tone?: string) {
  return refList(label, ref ? [ref] : undefined, tone);
}

export function renderComputerUseControlPlane(props: UIComponentRendererProps) {
  const rawPayload = payloadFromProps(props);
  const payload = normalizeComputerUseControlPlanePayload(rawPayload);
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  if (!payload) {
    return (
      <div
        className="computer-use-control-plane"
        data-component-id={COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID}
        data-render-boundary="presentation-only"
        data-status="empty"
      >
        {ComponentEmptyState ? (
          <ComponentEmptyState
            componentId={COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID}
            artifactType={props.artifact?.type ?? 'computer-use-control-plane'}
            detail="Computer Use control refs are not attached."
          />
        ) : (
          <p>Computer Use control refs are not attached.</p>
        )}
      </div>
    );
  }
  const title = payload.title ?? props.slot.title ?? 'Computer Use controls';
  const displayedRefs = computerUseControlPlaneDisplayedRefs(payload);
  const showConfirmation = payload.approvalMode !== 'not-required'
    && (payload.status === 'needs-confirmation' || payload.approvalRef || payload.approvalRequestRef);
  return (
    <div
      className="computer-use-control-plane"
      data-component-id={COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID}
      data-render-boundary="presentation-only"
      data-status={payload.status}
      data-approval-mode={payload.approvalMode}
      data-session-permission-ref={payload.sessionPermissionRef}
      data-risk-preview-ref={payload.riskPreviewRef}
      data-data-visibility-ref={payload.dataVisibilityRef}
    >
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={props.artifact} /> : null}
      <header className="computer-use-control-plane-header">
        <div>
          <h3>{title}</h3>
          <p>{payload.sessionRef ?? payload.sessionPermissionRef ?? 'No Computer Use session ref is attached.'}</p>
        </div>
        <div className="computer-use-control-plane-status">
          {payload.status ? <span data-control-status={payload.status}>{payload.status}</span> : null}
          {payload.approvalMode ? <span data-approval-mode-label={payload.approvalMode}>{payload.approvalMode}</span> : null}
          {payload.riskLevel ? <span data-risk-level={payload.riskLevel}>{payload.riskLevel}</span> : null}
        </div>
      </header>
      {payload.message ? <p className="computer-use-control-plane-message">{payload.message}</p> : null}
      <div className="computer-use-control-plane-refs" aria-label="Computer Use control refs">
        {singleRef('Session permission', payload.sessionPermissionRef)}
        {refList('Allowed apps', payload.allowedAppRefs)}
        {refList('Allowed windows', payload.allowedWindowRefs)}
        {refList('Forbidden apps', payload.forbiddenAppRefs, 'danger')}
        {singleRef('Risk preview', payload.riskPreviewRef, 'warning')}
        {singleRef('Data visibility', payload.dataVisibilityRef)}
        {singleRef('Stop', payload.stopRef)}
        {singleRef('Cancel lease', payload.cancelLeaseRef)}
        {singleRef('Approval request', payload.approvalRequestRef)}
      </div>
      <div className="computer-use-control-plane-actions" aria-label="Computer Use control actions">
        {actionButton('Stop', 'stop', payload, rawPayload.onTerminalEquivalentText)}
        {actionButton('Cancel lease', 'cancel-lease', payload, rawPayload.onTerminalEquivalentText)}
        {showConfirmation ? confirmationButton('Approve', 'approved', payload, rawPayload.onConfirmationResult) : null}
        {showConfirmation ? confirmationButton('Reject', 'rejected', payload, rawPayload.onConfirmationResult) : null}
      </div>
      <script type="application/json" data-computer-use-control-plane-callback-props>
        {JSON.stringify(['onTerminalEquivalentText', 'onConfirmationResult'])}
      </script>
      <script type="application/json" data-computer-use-control-plane-displayed-refs>
        {JSON.stringify(displayedRefs)}
      </script>
    </div>
  );
}
