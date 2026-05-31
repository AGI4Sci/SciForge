export const COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID = 'computer-use-control-plane';
export const COMPUTER_USE_CONTROL_PLANE_ARTIFACT_TYPE = 'computer-use-control-plane';
export const COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION = 'sciforge.computer-use.user-control-plane.presentation.v1';
export const COMPUTER_USE_CONFIRMATION_RESULT_SCHEMA_VERSION = 'sciforge.computer-use.confirmation-result.v1';
export const GUI_TERMINAL_EQUIVALENT_TEXT_SCHEMA_VERSION = 'sciforge.gui-terminal-equivalent-text.v1';

export type ComputerUseControlPlaneStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'needs-confirmation'
  | 'approved'
  | 'rejected'
  | 'stopping'
  | 'cancelled'
  | 'blocked'
  | 'failed'
  | 'completed'
  | string;

export type ComputerUseApprovalMode =
  | 'not-required'
  | 'optional'
  | 'required'
  | 'blocked'
  | 'manual'
  | string;

export type ComputerUseConfirmationDecision = 'approved' | 'rejected';
export type ComputerUseControlPlaneAction = 'stop' | 'cancel-lease' | 'approve' | 'reject';

export type ComputerUseControlPlanePayload = {
  schemaVersion: typeof COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION;
  sessionRef?: string;
  sessionPermissionRef?: string;
  allowedAppRefs?: string[];
  allowedWindowRefs?: string[];
  forbiddenAppRefs?: string[];
  riskPreviewRef?: string;
  dataVisibilityRef?: string;
  stopRef?: string;
  cancelLeaseRef?: string;
  approvalMode?: ComputerUseApprovalMode;
  status?: ComputerUseControlPlaneStatus;
  approvalRef?: string;
  approvalRequestRef?: string;
  confirmationStatus?: string;
  title?: string;
  message?: string;
  riskLevel?: string;
};

export type ComputerUseTerminalEquivalentText = {
  schemaVersion: typeof GUI_TERMINAL_EQUIVALENT_TEXT_SCHEMA_VERSION;
  kind: 'terminal-equivalent-text';
  source: typeof COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID;
  action: ComputerUseControlPlaneAction;
  commandText: string;
  refs: {
    sessionPermissionRef?: string;
    stopRef?: string;
    cancelLeaseRef?: string;
    approvalRef?: string;
    approvalRequestRef?: string;
  };
};

export type ComputerUseConfirmationResult = {
  schemaVersion: typeof COMPUTER_USE_CONFIRMATION_RESULT_SCHEMA_VERSION;
  kind: 'confirmation-result';
  source: typeof COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID;
  decision: ComputerUseConfirmationDecision;
  approvalMode?: ComputerUseApprovalMode;
  status?: ComputerUseControlPlaneStatus;
  confirmationStatus?: string;
  approvalRef?: string;
  approvalRequestRef?: string;
  commandText?: string;
  relatedRefs: string[];
  riskPreviewRef?: string;
  dataVisibilityRef?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return values.length ? uniqueStrings(values) : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function stringListField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = asStringArray(record[key]);
    if (value) return value;
  }
  return undefined;
}

export function normalizeComputerUseControlPlanePayload(value: unknown): ComputerUseControlPlanePayload | undefined {
  if (!isRecord(value)) return undefined;
  const payload: ComputerUseControlPlanePayload = {
    schemaVersion: COMPUTER_USE_CONTROL_PLANE_SCHEMA_VERSION,
    sessionRef: stringField(value, 'sessionRef', 'session_ref'),
    sessionPermissionRef: stringField(value, 'sessionPermissionRef', 'session_permission_ref'),
    allowedAppRefs: stringListField(value, 'allowedAppRefs', 'allowed_app_refs'),
    allowedWindowRefs: stringListField(value, 'allowedWindowRefs', 'allowed_window_refs'),
    forbiddenAppRefs: stringListField(value, 'forbiddenAppRefs', 'forbidden_app_refs'),
    riskPreviewRef: stringField(value, 'riskPreviewRef', 'risk_preview_ref'),
    dataVisibilityRef: stringField(value, 'dataVisibilityRef', 'data_visibility_ref'),
    stopRef: stringField(value, 'stopRef', 'stop_ref'),
    cancelLeaseRef: stringField(value, 'cancelLeaseRef', 'cancel_lease_ref'),
    approvalMode: stringField(value, 'approvalMode', 'approval_mode'),
    status: stringField(value, 'status', 'approvalStatus', 'approval_status'),
    approvalRef: stringField(value, 'approvalRef', 'approval_ref'),
    approvalRequestRef: stringField(value, 'approvalRequestRef', 'approval_request_ref'),
    confirmationStatus: stringField(value, 'confirmationStatus', 'confirmation_status'),
    title: stringField(value, 'title'),
    message: stringField(value, 'message', 'summary'),
    riskLevel: stringField(value, 'riskLevel', 'risk_level', 'risk'),
  };
  return hasComputerUseControlPlanePresentation(payload) ? compactControlPlanePayload(payload) : undefined;
}

export function hasComputerUseControlPlanePresentation(payload: Partial<ComputerUseControlPlanePayload> | undefined): boolean {
  if (!payload) return false;
  return Boolean(
    payload.sessionPermissionRef
      || payload.allowedAppRefs?.length
      || payload.allowedWindowRefs?.length
      || payload.forbiddenAppRefs?.length
      || payload.riskPreviewRef
      || payload.dataVisibilityRef
      || payload.stopRef
      || payload.cancelLeaseRef,
  );
}

export function computerUseControlPlaneDisplayedRefs(payload: Partial<ComputerUseControlPlanePayload> | undefined): string[] {
  if (!payload) return [];
  return uniqueStrings([
    payload.sessionPermissionRef,
    ...(payload.allowedAppRefs ?? []),
    ...(payload.allowedWindowRefs ?? []),
    ...(payload.forbiddenAppRefs ?? []),
    payload.riskPreviewRef,
    payload.dataVisibilityRef,
    payload.stopRef,
    payload.cancelLeaseRef,
    payload.approvalRequestRef,
  ].filter((ref): ref is string => Boolean(ref)));
}

export function computerUseControlPlaneCommand(
  payload: Partial<ComputerUseControlPlanePayload>,
  action: ComputerUseControlPlaneAction,
): ComputerUseTerminalEquivalentText | undefined {
  const refs: ComputerUseTerminalEquivalentText['refs'] = {};
  let commandText: string | undefined;
  if (action === 'stop' && payload.stopRef) {
    refs.stopRef = payload.stopRef;
    commandText = `/computer-use stop --stop-ref ${quoteCommandArg(payload.stopRef)}`;
  }
  if (action === 'cancel-lease' && payload.cancelLeaseRef) {
    refs.cancelLeaseRef = payload.cancelLeaseRef;
    commandText = `/computer-use cancel --cancel-lease-ref ${quoteCommandArg(payload.cancelLeaseRef)}`;
  }
  if ((action === 'approve' || action === 'reject') && (payload.approvalRef || payload.approvalRequestRef)) {
    if (payload.approvalRef) refs.approvalRef = payload.approvalRef;
    if (payload.approvalRequestRef) refs.approvalRequestRef = payload.approvalRequestRef;
    const verb = action === 'approve' ? 'approve' : 'reject';
    const refFlag = payload.approvalRef
      ? `--approval-ref ${quoteCommandArg(payload.approvalRef)}`
      : `--approval-request-ref ${quoteCommandArg(payload.approvalRequestRef ?? '')}`;
    commandText = `/computer-use ${verb} ${refFlag}`;
  }
  if (!commandText) return undefined;
  if (payload.sessionPermissionRef) refs.sessionPermissionRef = payload.sessionPermissionRef;
  return {
    schemaVersion: GUI_TERMINAL_EQUIVALENT_TEXT_SCHEMA_VERSION,
    kind: 'terminal-equivalent-text',
    source: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
    action,
    commandText,
    refs,
  };
}

export function computerUseControlPlaneConfirmationResult(
  payload: Partial<ComputerUseControlPlanePayload>,
  decision: ComputerUseConfirmationDecision,
): ComputerUseConfirmationResult {
  const command = computerUseControlPlaneCommand(payload, decision === 'approved' ? 'approve' : 'reject');
  return {
    schemaVersion: COMPUTER_USE_CONFIRMATION_RESULT_SCHEMA_VERSION,
    kind: 'confirmation-result',
    source: COMPUTER_USE_CONTROL_PLANE_COMPONENT_ID,
    decision,
    approvalMode: payload.approvalMode,
    status: payload.status,
    confirmationStatus: payload.confirmationStatus ?? (decision === 'approved' ? 'approved' : 'rejected'),
    approvalRef: payload.approvalRef,
    approvalRequestRef: payload.approvalRequestRef,
    commandText: command?.commandText,
    relatedRefs: computerUseControlPlaneDisplayedRefs(payload),
    riskPreviewRef: payload.riskPreviewRef,
    dataVisibilityRef: payload.dataVisibilityRef,
  };
}

function compactControlPlanePayload(payload: ComputerUseControlPlanePayload): ComputerUseControlPlanePayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== '';
    }),
  ) as ComputerUseControlPlanePayload;
}

function quoteCommandArg(value: string) {
  return JSON.stringify(value);
}
