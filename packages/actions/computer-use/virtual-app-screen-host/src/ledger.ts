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

function isHostOwnedPreflightRef(value: string | undefined): boolean {
  return Boolean(
    value?.startsWith('computer-use:native-host/preflights/')
    && !isUiOwnedRef(value)
    && !isFixtureOwnedRef(value)
    && !/(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(value),
  );
}

function isHostOwnedRef(value: string | undefined): boolean {
  return Boolean(
    value?.startsWith('computer-use:native-host/')
    && !isUiOwnedRef(value)
    && !isFixtureOwnedRef(value)
    && !/(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(value),
  );
}

export interface NativeHostLedgerValidationOptions {
  scope?: 'session' | 'preflight';
  requirePreflight?: boolean;
  requireFrame?: boolean;
  requireHumanInput?: boolean;
  requireAutomationBarrier?: boolean;
  requireTakeoverQueue?: boolean;
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
  const scope = options.scope ?? 'session';
  if (scope === 'preflight') {
    if (!isHostOwnedPreflightRef(ledger.ledgerRef)) {
      issues.push('preflight ledgerRef must be a Host-owned preflight ref.');
    }
    if (!isHostOwnedPreflightRef(ledger.sessionRef)) {
      issues.push('preflight sessionRef must be a Host-owned preflight ref.');
    }
    if (types.has('session.created')) issues.push('preflight ledger must not contain session.created.');
    if (types.has('app.launched')) issues.push('preflight ledger must not contain app.launched.');
    if (types.has('surface.attached')) issues.push('preflight ledger must not contain surface.attached.');
    if ((options.requirePreflight ?? true) && !types.has('preflight.recorded')) {
      issues.push('preflight.recorded entry is required.');
    }
    const preflight = ledger.entries.find((entry) => entry.type === 'preflight.recorded');
    if (preflight) {
      for (const key of ['preflightRef', 'preflightLedgerRef', 'preflightLedgerEntryRef', 'hostReadinessRef', 'adapterReadinessRef'] as const) {
        const ref = preflight.refs[key];
        if (!ref) {
          issues.push(`preflight.recorded ${key} is required.`);
        } else if (!isHostOwnedPreflightRef(ref)) {
          issues.push(`preflight.recorded ${key} must be a Host-owned preflight ref.`);
        }
      }
      if (preflight.refs.preflightRef && preflight.refs.preflightRef !== ledger.sessionRef) {
        issues.push('preflight.recorded preflightRef must equal sessionRef.');
      }
      if (preflight.refs.preflightLedgerRef && preflight.refs.preflightLedgerRef !== ledger.ledgerRef) {
        issues.push('preflight.recorded preflightLedgerRef must equal ledgerRef.');
      }
      if (preflight.refs.preflightLedgerEntryRef && preflight.refs.preflightLedgerEntryRef !== preflight.eventRef) {
        issues.push('preflight.recorded preflightLedgerEntryRef must equal eventRef.');
      }
    }
    return {
      ok: issues.length === 0,
      issues,
    };
  }
  if (!types.has('session.created')) issues.push('session.created entry is required.');
  if (!types.has('app.launched')) issues.push('app.launched entry is required.');
  if (!types.has('surface.attached')) issues.push('surface.attached entry is required.');
  if (!isHostOwnedRef(ledger.currentRunPointerRef)) {
    issues.push('currentRunPointerRef must be Host-owned session evidence.');
  }
  if (options.requireFrame && !types.has('frame.read')) issues.push('frame.read entry is required.');
  if (options.requireHumanInput && !types.has('human-input.accepted')) {
    issues.push('human-input.accepted entry is required.');
  }
  if (options.requireHumanInput) {
    for (const inputEntry of ledger.entries.filter((entry) => entry.type === 'human-input.accepted')) {
      if (!inputEntry.refs.inputAcceptedRef) issues.push('human-input.accepted inputAcceptedRef is required.');
      if (!inputEntry.refs.beforeFrameRef) issues.push('human-input.accepted beforeFrameRef is required.');
      if (!inputEntry.refs.currentFrameRef) issues.push('human-input.accepted currentFrameRef is required.');
      if (inputEntry.refs.beforeFrameRef && !isHostOwnedRef(inputEntry.refs.beforeFrameRef)) {
        issues.push('human-input.accepted beforeFrameRef must be Host-owned frame evidence.');
      }
      if (inputEntry.refs.currentFrameRef && !isHostOwnedRef(inputEntry.refs.currentFrameRef)) {
        issues.push('human-input.accepted currentFrameRef must be Host-owned frame evidence.');
      }
      if (inputEntry.refs.frameRef && inputEntry.refs.currentFrameRef && inputEntry.refs.frameRef !== inputEntry.refs.currentFrameRef) {
        issues.push('human-input.accepted frameRef must equal currentFrameRef.');
      }
    }
  }
  if (options.requireAutomationBarrier && !types.has('automation.barrier-completed')) {
    issues.push('automation.barrier-completed entry is required.');
  }
  if (options.requireTakeoverQueue) {
    const pauseEntry = ledger.entries.find((entry) => entry.type === 'agent.paused');
    const resumeEntry = ledger.entries.find((entry) => entry.type === 'agent.resumed');
    if (!pauseEntry) {
      issues.push('agent.paused entry is required.');
    } else {
      if (!pauseEntry.refs.agentQueueRef) {
        issues.push('agent.paused agentQueueRef is required.');
      } else if (!isHostOwnedRef(pauseEntry.refs.agentQueueRef)) {
        issues.push('agent.paused agentQueueRef must be Host-owned session evidence.');
      }
    }
    if (!resumeEntry) {
      issues.push('agent.resumed entry is required.');
    } else {
      if (!resumeEntry.refs.agentQueueRef) {
        issues.push('agent.resumed agentQueueRef is required.');
      } else if (!isHostOwnedRef(resumeEntry.refs.agentQueueRef)) {
        issues.push('agent.resumed agentQueueRef must be Host-owned session evidence.');
      }
      if (!resumeEntry.refs.currentFrameRefreshRef) {
        issues.push('agent.resumed currentFrameRefreshRef is required.');
      } else if (!isHostOwnedRef(resumeEntry.refs.currentFrameRefreshRef)) {
        issues.push('agent.resumed currentFrameRefreshRef must be Host-owned session evidence.');
      }
    }
  }
  if (options.requireGrantValidation && !types.has('grant.validated')) issues.push('grant.validated entry is required.');
  const permissionHandoff = ledger.entries.find((entry) => entry.type === 'permission.handoff');
  const permissionRecheck = ledger.entries.findLast((entry) => entry.type === 'permission.recheck');
  if (options.requirePermissionHandoff) {
    if (!permissionHandoff) {
      issues.push('permission.handoff entry is required.');
    } else {
      for (const key of ['sessionRef', 'permissionHandoffRef', 'recheckRef', 'adapterReadinessRef', 'platformDriverRef', 'providerReadinessSummaryRef'] as const) {
        if (!permissionHandoff.refs[key]) issues.push(`permission.handoff ${key} is required.`);
      }
    }
  }
  if (options.requirePermissionRecheck) {
    if (!permissionRecheck) {
      issues.push('permission.recheck entry is required.');
    } else {
      for (const key of ['sessionRef', 'permissionHandoffRef', 'recheckRef', 'adapterReadinessRef', 'platformDriverRef', 'providerReadinessSummaryRef'] as const) {
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

export function deriveNativeHostMinimalEvidenceReplayRefs(ledger: NativeHostEvidenceLedger): string[] {
  const refs = [
    ledger.entries.find((entry) => entry.type === 'session.created')?.eventRef,
    ledger.entries.find((entry) => entry.type === 'surface.attached')?.eventRef,
    ledger.entries.find((entry) => entry.type === 'grant.validated')?.eventRef,
    ledger.entries.find((entry) => entry.type === 'frame.read')?.eventRef,
    ledger.entries.find((entry) => entry.type === 'human-input.accepted')?.eventRef,
    ledger.entries.find((entry) => entry.type === 'agent.paused')?.eventRef,
    ledger.entries.find((entry) => entry.type === 'agent.resumed')?.eventRef,
    frameReadAfter(ledger, 'agent.resumed')?.eventRef,
  ];
  return refs.filter((entry): entry is string => Boolean(entry));
}

function frameReadAfter(
  ledger: NativeHostEvidenceLedger,
  type: NativeHostLedgerEventType,
): NativeHostLedgerEntry | undefined {
  const marker = ledger.entries.find((entry) => entry.type === type);
  if (!marker) return undefined;
  return ledger.entries.find((entry) => entry.type === 'frame.read' && entry.sequence > marker.sequence);
}
