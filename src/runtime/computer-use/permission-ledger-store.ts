export type ComputerUsePermissionRiskDecision = 'auto' | 'needs-confirmation' | 'blocked';
export type ComputerUsePermissionRiskLevel = 'low' | 'medium' | 'high';
export type ComputerUsePermissionLedgerStatus = 'confirmed' | 'pending' | 'rejected';
export type ComputerUsePermissionApprovalState = 'not-required' | 'needs-confirmation' | 'approved' | 'denied';
export type ComputerUsePermissionAuthorizationProfileId =
  | 'assisted-autonomy'
  | 'high-autonomy'
  | 'research-sandbox-max'
  | string;

export interface ComputerUsePermissionRiskInput {
  decision: ComputerUsePermissionRiskDecision;
  level: ComputerUsePermissionRiskLevel;
  category: string;
  hardConfirm?: boolean;
  reason?: string;
}

export interface ComputerUsePermissionApprovalInput {
  approvalRef: string;
  sourceRefs?: string[];
}

export interface ComputerUseTurnPermissionInput {
  turnId: string;
  actionId?: string;
  authorizationProfileId: ComputerUsePermissionAuthorizationProfileId;
  risk: ComputerUsePermissionRiskInput;
  evidenceRefs?: string[];
  approval?: ComputerUsePermissionApprovalInput;
}

export interface ComputerUsePermissionLedgerEntry {
  schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1';
  status: ComputerUsePermissionLedgerStatus;
  approvalState: ComputerUsePermissionApprovalState;
  turnId: string;
  actionId: string;
  authorizationProfileId: string;
  ledgerRef: string;
  permissionRef?: string;
  approvalRequestRef?: string;
  approvalRef?: string;
  evidenceRefs: string[];
  approvalSourceRefs: string[];
  risk: ComputerUsePermissionRiskInput;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComputerUsePermissionLedgerStore {
  requestTurnPermission(input: ComputerUseTurnPermissionInput): ComputerUsePermissionLedgerEntry;
  getByPermissionRef(permissionRef: string): ComputerUsePermissionLedgerEntry | undefined;
  getByApprovalRequestRef(approvalRequestRef: string): ComputerUsePermissionLedgerEntry | undefined;
  entries(): ComputerUsePermissionLedgerEntry[];
}

export interface ComputerUsePermissionLedgerStoreOptions {
  now?: () => string | Date;
  maxRefs?: number;
}

const DEFAULT_MAX_REFS = 16;
const MAX_REF_LENGTH = 180;

const RUNTIME_OWNED_REF_PREFIXES = [
  'runtime-truth:',
  'browser-host-session:',
  'window-action-session:',
  'computer-use:',
  'native-adapter:',
  'desktop-native:',
  'permission:',
  'approval:',
  'approval-request:',
  'cancel:',
  'stop:',
  'lease:',
  'adapter-registry:',
  'window:',
  'action-ledger:',
  'evidence:',
  'workEvidence:',
  'native-host:',
  'audit:',
] as const;

const UI_OR_FIXTURE_REF_PREFIXES = [
  'gui.',
  'gui:',
  'ui:',
  'gui-viewer:',
  'screen-pane:',
  'fixture:',
  'replay:',
  'replay-fixture:',
  'snapshot-fixture:',
] as const;

export function createComputerUsePermissionLedgerStore(
  options: ComputerUsePermissionLedgerStoreOptions = {},
): ComputerUsePermissionLedgerStore {
  const maxRefs = boundedPositiveInteger(options.maxRefs, DEFAULT_MAX_REFS);
  const byLedgerRef = new Map<string, ComputerUsePermissionLedgerEntry>();
  const byPermissionRef = new Map<string, ComputerUsePermissionLedgerEntry>();
  const byApprovalRequestRef = new Map<string, ComputerUsePermissionLedgerEntry>();

  function requestTurnPermission(input: ComputerUseTurnPermissionInput): ComputerUsePermissionLedgerEntry {
    const turnId = refSegment(input.turnId, 'turn');
    const actionId = refSegment(input.actionId ?? input.risk.category, 'action');
    const now = currentTimestamp(options.now);
    const refs = sanitizeRuntimeRefs(input.evidenceRefs ?? [], maxRefs);
    const ledgerRef = `computer-use:permission-ledger/${turnId}/${actionId}`;
    const permissionRef = `permission:turn/${turnId}/computer-use/${actionId}`;
    const approvalRequestRef = `approval-request:computer-use/${turnId}/${actionId}`;
    const expectedApprovalRef = `approval:computer-use/${turnId}/${actionId}`;

    if (input.risk.decision === 'blocked') {
      return store({
        schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1',
        status: 'rejected',
        approvalState: 'denied',
        turnId,
        actionId,
        authorizationProfileId: compactText(input.authorizationProfileId, 80),
        ledgerRef,
        evidenceRefs: refs.accepted,
        approvalSourceRefs: [],
        risk: normalizeRisk(input.risk),
        reason: 'Computer Use policy blocked this action before permission materialization.',
        createdAt: existingCreatedAt(ledgerRef) ?? now,
        updatedAt: now,
      });
    }

    if (requiresApproval(input)) {
      if (input.approval) {
        const approval = sanitizeApproval(input.approval, approvalRequestRef, expectedApprovalRef, maxRefs);
        if (approval.valid) {
          return store({
            schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1',
            status: 'confirmed',
            approvalState: 'approved',
            turnId,
            actionId,
            authorizationProfileId: compactText(input.authorizationProfileId, 80),
            ledgerRef,
            permissionRef,
            approvalRequestRef,
            approvalRef: approval.approvalRef,
            evidenceRefs: sanitizeRuntimeRefs([...refs.accepted, ...approval.sourceRefs], maxRefs).accepted,
            approvalSourceRefs: approval.sourceRefs,
            risk: normalizeRisk(input.risk),
            reason: 'Confirmed by runtime-owned approval evidence for this turn-scoped Computer Use action.',
            createdAt: existingCreatedAt(ledgerRef) ?? now,
            updatedAt: now,
          });
        }

        return store({
          schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1',
          status: 'rejected',
          approvalState: 'denied',
          turnId,
          actionId,
          authorizationProfileId: compactText(input.authorizationProfileId, 80),
          ledgerRef,
          approvalRequestRef,
          approvalRef: expectedApprovalRef,
          evidenceRefs: refs.accepted,
          approvalSourceRefs: [],
          risk: normalizeRisk(input.risk),
          reason: `Rejected approval: ${approval.reason}`,
          createdAt: existingCreatedAt(ledgerRef) ?? now,
          updatedAt: now,
        });
      }

      return store({
        schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1',
        status: 'pending',
        approvalState: 'needs-confirmation',
        turnId,
        actionId,
        authorizationProfileId: compactText(input.authorizationProfileId, 80),
        ledgerRef,
        approvalRequestRef,
        approvalRef: expectedApprovalRef,
        evidenceRefs: refs.accepted,
        approvalSourceRefs: [],
        risk: normalizeRisk(input.risk),
        reason: 'Hard-confirm or higher-risk Computer Use action requires runtime-owned approval.',
        createdAt: existingCreatedAt(ledgerRef) ?? now,
        updatedAt: now,
      });
    }

    if (input.authorizationProfileId !== 'high-autonomy' || input.risk.level !== 'low') {
      return store({
        schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1',
        status: 'pending',
        approvalState: 'needs-confirmation',
        turnId,
        actionId,
        authorizationProfileId: compactText(input.authorizationProfileId, 80),
        ledgerRef,
        approvalRequestRef,
        approvalRef: expectedApprovalRef,
        evidenceRefs: refs.accepted,
        approvalSourceRefs: [],
        risk: normalizeRisk(input.risk),
        reason: 'Only low-risk High Autonomy Computer Use actions may auto-materialize permission.',
        createdAt: existingCreatedAt(ledgerRef) ?? now,
        updatedAt: now,
      });
    }

    return store({
      schemaVersion: 'sciforge.computer-use.permission-ledger-entry.v1',
      status: 'confirmed',
      approvalState: 'not-required',
      turnId,
      actionId,
      authorizationProfileId: 'high-autonomy',
      ledgerRef,
      permissionRef,
      evidenceRefs: refs.accepted,
      approvalSourceRefs: [],
      risk: normalizeRisk(input.risk),
      reason: 'Low-risk High Autonomy action materialized a turn-scoped Computer Use permission.',
      createdAt: existingCreatedAt(ledgerRef) ?? now,
      updatedAt: now,
    });
  }

  function store(entry: ComputerUsePermissionLedgerEntry): ComputerUsePermissionLedgerEntry {
    const snapshot = cloneEntry(entry);
    byLedgerRef.set(snapshot.ledgerRef, snapshot);
    if (snapshot.permissionRef) byPermissionRef.set(snapshot.permissionRef, snapshot);
    if (snapshot.approvalRequestRef) byApprovalRequestRef.set(snapshot.approvalRequestRef, snapshot);
    return cloneEntry(snapshot);
  }

  function existingCreatedAt(ledgerRef: string): string | undefined {
    return byLedgerRef.get(ledgerRef)?.createdAt;
  }

  return {
    requestTurnPermission,
    getByPermissionRef: (permissionRef) => cloneOptionalEntry(byPermissionRef.get(permissionRef)),
    getByApprovalRequestRef: (approvalRequestRef) => cloneOptionalEntry(byApprovalRequestRef.get(approvalRequestRef)),
    entries: () => [...byLedgerRef.values()].map(cloneEntry),
  };
}

function requiresApproval(input: ComputerUseTurnPermissionInput): boolean {
  return input.risk.decision === 'needs-confirmation'
    || input.risk.hardConfirm === true
    || input.risk.level === 'high';
}

function sanitizeApproval(
  approval: ComputerUsePermissionApprovalInput,
  expectedApprovalRequestRef: string,
  expectedApprovalRef: string,
  maxRefs: number,
): { valid: true; approvalRef: string; sourceRefs: string[] } | { valid: false; reason: string } {
  const approvalRef = compactText(approval.approvalRef, MAX_REF_LENGTH);
  if (!approvalRef || approvalRef !== expectedApprovalRef || !isRuntimeOwnedRef(approvalRef) || hasUnsafeRefContent(approvalRef)) {
    return { valid: false, reason: 'approval ref is not runtime-owned approval evidence for this action' };
  }

  const sourceRefs = approval.sourceRefs ?? [];
  const sanitized = sanitizeRuntimeRefs(sourceRefs, maxRefs);
  if (sanitized.rejected.length || sanitized.accepted.length !== sourceRefs.length) {
    return { valid: false, reason: 'runtime-owned approval source refs are required' };
  }
  if (!sanitized.accepted.includes(expectedApprovalRequestRef)) {
    return { valid: false, reason: 'runtime-owned approval request ref is required' };
  }

  return { valid: true, approvalRef, sourceRefs: sanitized.accepted };
}

function sanitizeRuntimeRefs(refs: string[], maxRefs: number): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const normalized = compactText(ref, MAX_REF_LENGTH);
    if (!normalized || seen.has(normalized)) continue;
    if (!isRuntimeOwnedRef(normalized) || hasUnsafeRefContent(normalized)) {
      rejected.push(normalized);
      continue;
    }
    if (accepted.length >= maxRefs) continue;
    accepted.push(normalized);
    seen.add(normalized);
  }
  return { accepted, rejected };
}

function isRuntimeOwnedRef(ref: string): boolean {
  if (UI_OR_FIXTURE_REF_PREFIXES.some((prefix) => ref.startsWith(prefix))) return false;
  return RUNTIME_OWNED_REF_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

function hasUnsafeRefContent(ref: string): boolean {
  return /^https?:\/\//i.test(ref)
    || /^data:/i.test(ref)
    || /\bbase64\b/i.test(ref)
    || /<\s*(?:!doctype|html|script|iframe|body)\b/i.test(ref)
    || /\b(?:secret|token|password|api[-_]?key|bearer)\b/i.test(ref)
    || /\bsk-[a-z0-9_-]{8,}\b/i.test(ref);
}

function normalizeRisk(risk: ComputerUsePermissionRiskInput): ComputerUsePermissionRiskInput {
  return {
    decision: risk.decision,
    level: risk.level,
    category: compactText(risk.category, 80) || 'unknown-risk',
    hardConfirm: risk.hardConfirm === true,
    ...(risk.reason ? { reason: compactText(risk.reason, 160) } : {}),
  };
}

function refSegment(value: string, fallback: string): string {
  const normalized = compactText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function compactText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function boundedPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, DEFAULT_MAX_REFS);
}

function currentTimestamp(now?: () => string | Date): string {
  const value = now?.() ?? new Date();
  if (value instanceof Date) return value.toISOString();
  return compactText(value, 40) || new Date().toISOString();
}

function cloneOptionalEntry(entry: ComputerUsePermissionLedgerEntry | undefined): ComputerUsePermissionLedgerEntry | undefined {
  return entry ? cloneEntry(entry) : undefined;
}

function cloneEntry(entry: ComputerUsePermissionLedgerEntry): ComputerUsePermissionLedgerEntry {
  return {
    ...entry,
    evidenceRefs: [...entry.evidenceRefs],
    approvalSourceRefs: [...entry.approvalSourceRefs],
    risk: { ...entry.risk },
  };
}
