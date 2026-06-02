import { createHash } from 'node:crypto';

import {
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  type NativeHostEvidenceLedger,
  type NativeHostLedgerEntry,
  type NativeHostLedgerEventType,
  type NativeHostLedgerRefs,
  type NativeHostValidationResult,
} from './contracts';

export interface AppendNativeHostLedgerEntryInput {
  ledger: NativeHostEvidenceLedger;
  type: NativeHostLedgerEventType;
  refs: NativeHostLedgerRefs;
  diagnosticOnly: boolean;
  recordedAt?: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function appendNativeHostLedgerEntry({
  ledger,
  type,
  refs,
  diagnosticOnly,
  recordedAt,
}: AppendNativeHostLedgerEntryInput): NativeHostLedgerEntry {
  const sequence = ledger.entries.length + 1;
  const previousSha256 = ledger.headSha256;
  const eventRef = `${ledger.ledgerRef}/events/${String(sequence).padStart(4, '0')}-${type}.json`;
  const entryWithoutHash = {
    schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
    type,
    sequence,
    eventRef,
    sessionId: ledger.sessionId,
    currentRunRef: ledger.currentRunRef,
    recordedAt: recordedAt ?? new Date().toISOString(),
    refs,
    previousSha256,
    source: 'native-virtual-app-screen-host' as const,
    diagnosticOnly,
  };
  const entry: NativeHostLedgerEntry = {
    ...entryWithoutHash,
    sha256: sha256(entryWithoutHash),
  };
  ledger.entries.push(entry);
  ledger.headSha256 = entry.sha256;
  return entry;
}

function isUiOwnedRef(value: string | undefined): boolean {
  return Boolean(value && /^(ui|gui-viewer|screen-pane):/i.test(value));
}

function isFixtureOwnedRef(value: string | undefined): boolean {
  return Boolean(value && /^(fixture|replay-fixture|snapshot-fixture):/i.test(value));
}

export interface NativeHostLedgerValidationOptions {
  requireFrame?: boolean;
  requireHumanInput?: boolean;
  requireAutomationBarrier?: boolean;
  requireGrantValidation?: boolean;
  requirePermissionHandoff?: boolean;
  requirePermissionRecheck?: boolean;
}

export function validateNativeHostEvidenceLedger(
  ledger: NativeHostEvidenceLedger,
  options: NativeHostLedgerValidationOptions = {},
): NativeHostValidationResult {
  const issues: string[] = [];
  if (ledger.schemaVersion !== NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION) {
    issues.push('ledger schemaVersion is not native host v1.');
  }
  if (!ledger.ledgerRef) issues.push('ledgerRef is required.');
  if (!ledger.sessionId) issues.push('sessionId is required.');
  if (!ledger.sessionRef) issues.push('sessionRef is required.');
  if (!ledger.currentRunRef) issues.push('currentRunRef is required.');
  if (!ledger.currentRunPointerRef) issues.push('currentRunPointerRef is required.');
  if (!ledger.entries.length) issues.push('ledger entries are required.');

  let previousSha256: string | undefined;
  for (const [index, entry] of ledger.entries.entries()) {
    if (entry.sequence !== index + 1) issues.push(`entry ${index} has non-monotonic sequence.`);
    if (entry.previousSha256 !== previousSha256) issues.push(`entry ${entry.sequence} has broken hash chain.`);
    const recalculated = sha256({
      schemaVersion: entry.schemaVersion,
      type: entry.type,
      sequence: entry.sequence,
      eventRef: entry.eventRef,
      sessionId: entry.sessionId,
      currentRunRef: entry.currentRunRef,
      recordedAt: entry.recordedAt,
      refs: entry.refs,
      previousSha256: entry.previousSha256,
      source: entry.source,
      diagnosticOnly: entry.diagnosticOnly,
    });
    if (entry.sha256 !== recalculated) issues.push(`entry ${entry.sequence} sha256 does not match contents.`);
    if (entry.source !== 'native-virtual-app-screen-host') issues.push(`entry ${entry.sequence} source is not host-owned.`);
    if (entry.currentRunRef !== ledger.currentRunRef) issues.push(`entry ${entry.sequence} currentRunRef drifted.`);
    if (entry.sessionId !== ledger.sessionId) issues.push(`entry ${entry.sequence} sessionId drifted.`);
    for (const [refKey, refValue] of Object.entries(entry.refs)) {
      if (isUiOwnedRef(refValue)) issues.push(`${entry.type}.${refKey} is UI-owned and cannot be live truth.`);
      if (isFixtureOwnedRef(refValue)) issues.push(`${entry.type}.${refKey} is fixture-owned and cannot be live truth.`);
    }
    previousSha256 = entry.sha256;
  }
  if (ledger.headSha256 !== previousSha256) issues.push('ledger headSha256 does not match last entry.');

  const types = new Set(ledger.entries.map((entry) => entry.type));
  if (!types.has('session.created')) issues.push('session.created entry is required.');
  if (!types.has('app.launched')) issues.push('app.launched entry is required.');
  if (!types.has('surface.attached')) issues.push('surface.attached entry is required.');
  if (options.requireFrame && !types.has('frame.read')) issues.push('frame.read entry is required.');
  if (options.requireHumanInput && !types.has('human-input.accepted')) {
    issues.push('human-input.accepted entry is required.');
  }
  if (options.requireAutomationBarrier && !types.has('automation.barrier-completed')) {
    issues.push('automation.barrier-completed entry is required.');
  }
  if (options.requireGrantValidation && !types.has('grant.validated')) issues.push('grant.validated entry is required.');
  const permissionHandoff = ledger.entries.find((entry) => entry.type === 'permission.handoff');
  const permissionRecheck = ledger.entries.findLast((entry) => entry.type === 'permission.recheck');
  if (options.requirePermissionHandoff) {
    if (!permissionHandoff) {
      issues.push('permission.handoff entry is required.');
    } else {
      for (const key of ['sessionRef', 'permissionHandoffRef', 'recheckRef', 'adapterReadinessRef'] as const) {
        if (!permissionHandoff.refs[key]) issues.push(`permission.handoff ${key} is required.`);
      }
    }
  }
  if (options.requirePermissionRecheck) {
    if (!permissionRecheck) {
      issues.push('permission.recheck entry is required.');
    } else {
      for (const key of ['sessionRef', 'permissionHandoffRef', 'recheckRef', 'adapterReadinessRef'] as const) {
        if (!permissionRecheck.refs[key]) issues.push(`permission.recheck ${key} is required.`);
      }
    }
    if (!permissionHandoff) {
      issues.push('permission.recheck requires an earlier permission.handoff entry.');
    } else if (permissionRecheck && permissionRecheck.sequence <= permissionHandoff.sequence) {
      issues.push('permission.recheck must be recorded after permission.handoff.');
    }
  }

  if (options.requireFrame) {
    const frameEntry = ledger.entries.findLast((entry) => entry.refs.frameRef);
    if (!frameEntry?.refs.frameRef) issues.push('latest frame ref is missing.');
    if (!frameEntry?.refs.frameStreamRef) issues.push('frame stream ref is missing.');
    if (!frameEntry?.refs.liveSurfaceRef) issues.push('live surface ref is missing.');
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
