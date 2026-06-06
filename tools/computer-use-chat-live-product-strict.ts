import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const COMPUTER_USE_CHAT_LIVE_PRODUCT_STRICT_SCHEMA =
  'sciforge.computer-use.chat-live-product-strict.v1' as const;

export type ComputerUseChatLiveProductStrictRequirement =
  | 'ordinary-desktop-chat-entrypoint'
  | 'electron-product-shell'
  | 'electron-dynamic-workspace-writer'
  | 'runtime-codex-transport'
  | 'desktop-native-host'
  | 'browser-host-or-window-action-session-target'
  | 'current-run-live-acceptance-bundle'
  | 'display-group'
  | 'screen-identity'
  | 'actor-cursor-provenance'
  | 'user-control-refs'
  | 'native-sidecar-isolation'
  | 'action-ledger'
  | 'replay-bundle'
  | 'validator-ledger-refs';

export interface ComputerUseChatLiveProductStrictEvidence {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_PRODUCT_STRICT_SCHEMA;
  status: 'passed' | 'failed';
  required: ComputerUseChatLiveProductStrictRequirement[];
  observed: ComputerUseChatLiveProductStrictRequirement[];
  missing: ComputerUseChatLiveProductStrictRequirement[];
  targetKind?: 'BrowserHostSession' | 'WindowActionSession';
  acceptanceManifestRef?: string;
  issues: string[];
}

export interface ComputerUseChatLiveProductStrictManifestLike {
  releaseAcceptance: 'not-evaluated' | 'desktop-product-strict';
  prompt: string;
  status: string;
  issues: string[];
  displayedRefs: string[];
  artifactRefs: string[];
  auditRefs: string[];
  requestSubmitted: boolean;
  liveAcceptanceCandidate: boolean;
  completionEvidenceProducerIds?: string[];
  liveAcceptanceBundle?: {
    status: 'valid' | 'missing' | 'invalid';
    acceptanceManifestRef?: string;
  };
  productStrict?: ComputerUseChatLiveProductStrictEvidence;
}

export interface ComputerUseChatLiveProductStrictOptions {
  productStrict?: boolean;
  workspacePath?: string;
  completionEvidenceProducerIds?: string[];
}

const requiredProductStrict: readonly ComputerUseChatLiveProductStrictRequirement[] = [
  'ordinary-desktop-chat-entrypoint',
  'electron-product-shell',
  'electron-dynamic-workspace-writer',
  'runtime-codex-transport',
  'desktop-native-host',
  'browser-host-or-window-action-session-target',
  'current-run-live-acceptance-bundle',
  'display-group',
  'screen-identity',
  'actor-cursor-provenance',
  'user-control-refs',
  'native-sidecar-isolation',
  'action-ledger',
  'replay-bundle',
  'validator-ledger-refs',
];

export async function attachComputerUseChatLiveProductStrict<T extends ComputerUseChatLiveProductStrictManifestLike>(
  input: {
    manifest: T;
    env: NodeJS.ProcessEnv;
    options?: ComputerUseChatLiveProductStrictOptions;
  },
): Promise<T> {
  if (input.options?.productStrict !== true) return input.manifest;
  const productStrict = await validateComputerUseChatLiveProductStrict({
    manifest: input.manifest,
    workspacePath: input.options?.workspacePath ?? input.env.SCIFORGE_WORKSPACE_PATH ?? process.cwd(),
    completionEvidenceProducerIds: productStrictCompletionEvidenceProducerIds(input.manifest, input.options),
  });
  const issues = uniqueStrings([...input.manifest.issues, ...productStrict.issues]);
  return {
    ...input.manifest,
    releaseAcceptance: 'desktop-product-strict',
    productStrict,
    issues,
    status: issues.length ? 'failed' : input.manifest.status,
    liveAcceptanceCandidate: input.manifest.liveAcceptanceCandidate && productStrict.status === 'passed' && issues.length === 0,
  };
}

async function validateComputerUseChatLiveProductStrict(input: {
  manifest: ComputerUseChatLiveProductStrictManifestLike;
  workspacePath: string;
  completionEvidenceProducerIds: string[];
}): Promise<ComputerUseChatLiveProductStrictEvidence> {
  const issues: string[] = [];
  const acceptance = await readAcceptanceManifest(input.workspacePath, input.manifest.liveAcceptanceBundle?.acceptanceManifestRef);
  const record = acceptance.record;
  const classification = asRecord(record?.productPathClassification)
    ?? asRecord(record?.productPath)
    ?? asRecord(record?.acceptancePathClassification)
    ?? {};
  const desktop = asRecord(record?.desktopProductAcceptance) ?? {};
  const desktopEvidence = asRecord(desktop.evidence) ?? {};
  const hops = uniqueStrings([
    ...stringList(classification.hops),
    ...stringList(desktop.hops),
  ].map(normalizeToken));
  const targetKind = productTargetKind(classification, desktop);
  const observed: ComputerUseChatLiveProductStrictRequirement[] = [];

  observe(observed, 'ordinary-desktop-chat-entrypoint', ordinaryDesktopChat(input.manifest.prompt, classification, desktop));
  observe(observed, 'electron-product-shell', hasElectronProductShell(classification, desktop, hops));
  observe(observed, 'electron-dynamic-workspace-writer', hasDynamicWorkspaceWriter(classification, desktop, hops));
  observe(observed, 'runtime-codex-transport', hasRuntimeCodexTransport(classification, desktop, hops));
  observe(observed, 'desktop-native-host', hasDesktopNativeHost(classification, desktop, hops));
  observe(observed, 'browser-host-or-window-action-session-target', targetKind !== undefined);
  observe(observed, 'current-run-live-acceptance-bundle', input.manifest.liveAcceptanceBundle?.status === 'valid' && Boolean(record));
  observe(observed, 'display-group', hasDisplayGroup(record, desktopEvidence));
  observe(observed, 'screen-identity', hasScreenIdentity(record, desktopEvidence));
  observe(observed, 'actor-cursor-provenance', hasActorCursorProvenance(record, desktopEvidence));
  observe(observed, 'user-control-refs', hasUserControlRefs(record, desktopEvidence));
  observe(observed, 'native-sidecar-isolation', hasNativeSidecarIsolation(record, desktopEvidence));
  observe(observed, 'action-ledger', hasActionLedger(record, desktopEvidence));
  observe(observed, 'replay-bundle', hasReplayBundle(record, desktopEvidence));
  observe(observed, 'validator-ledger-refs', hasValidatorLedgerRefs(record, desktopEvidence));

  if (acceptance.issue) issues.push(acceptance.issue);
  for (const missing of requiredProductStrict.filter((requirement) => !observed.includes(requirement))) {
    issues.push(`product-strict:${missing}-required`);
  }
  if (input.completionEvidenceProducerIds.includes('computer-use.embedded-isolated-desktop-l3')) {
    issues.push('product-strict:isolated-producer-completion-not-product-path');
  }
  if (classification.diagnosticOnly === true || classification.packageDiagnosticOnly === true) {
    issues.push('product-strict:package-diagnostic-path-not-product');
  }
  if (classification.tier === 'package-diagnostic' || desktop.diagnosticOnly === true || desktop.packageDiagnosticOnly === true) {
    issues.push('product-strict:package-diagnostic-path-not-product');
  }
  issues.push(...hardConfirmIssues(record, desktop));
  const uniqueIssues = uniqueStrings(issues);
  return {
    schemaVersion: COMPUTER_USE_CHAT_LIVE_PRODUCT_STRICT_SCHEMA,
    status: uniqueIssues.length ? 'failed' : 'passed',
    required: [...requiredProductStrict],
    observed,
    missing: requiredProductStrict.filter((requirement) => !observed.includes(requirement)),
    targetKind,
    acceptanceManifestRef: input.manifest.liveAcceptanceBundle?.acceptanceManifestRef,
    issues: uniqueIssues,
  };
}

async function readAcceptanceManifest(workspacePath: string, ref: string | undefined): Promise<{
  record?: Record<string, unknown>;
  issue?: string;
}> {
  if (!ref || !isLocalRef(ref)) return { issue: 'product-strict:current-run-live-acceptance-bundle-required' };
  try {
    const path = resolve(workspacePath, ref);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      return { issue: 'product-strict:current-run-live-acceptance-bundle-required' };
    }
    return { record: JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> };
  } catch {
    return { issue: 'product-strict:current-run-live-acceptance-bundle-required' };
  }
}

function ordinaryDesktopChat(
  prompt: string,
  classification: Record<string, unknown>,
  desktop: Record<string, unknown>,
): boolean {
  if (/^\s*\/(?:computer-use|debug|slash)\b/i.test(prompt)) return false;
  return classification.ordinaryDesktopChat === true
    || desktop.ordinaryDesktopChat === true
    || stringValue(classification.entrypoint) === 'sciforge-desktop-chat'
    || stringValue(desktop.entrypoint) === 'sciforge-desktop-chat'
    || stringValue(desktop.promptSurface) === 'ordinary-chat';
}

function productTargetKind(
  classification: Record<string, unknown>,
  desktop: Record<string, unknown>,
): ComputerUseChatLiveProductStrictEvidence['targetKind'] {
  const target = asRecord(desktop.target) ?? asRecord(desktop.targetSession) ?? {};
  const targetKind = stringValue(classification.targetKind) ?? stringValue(target.kind);
  const targetRefs = [
    ...stringList(classification.targetRefs),
    stringValue(target.targetRef),
    stringValue(target.sessionRef),
  ].join(' ');
  const haystack = `${targetKind ?? ''} ${targetRefs} ${stringList(classification.hops).join(' ')} ${stringList(desktop.hops).join(' ')}`;
  if (/BrowserHostSession|browser-host-session/i.test(haystack)) return 'BrowserHostSession';
  if (/WindowActionSession|window-action-session/i.test(haystack)) return 'WindowActionSession';
  return undefined;
}

function hasElectronProductShell(
  classification: Record<string, unknown>,
  desktop: Record<string, unknown>,
  hops: string[],
): boolean {
  return stringValue(classification.shell) === 'electron-product'
    || stringValue(desktop.shell) === 'electron-product'
    || stringValue(asRecord(desktop.electronProductShell)?.kind) === 'electron-product'
    || hops.includes('electron-product-shell');
}

function hasDynamicWorkspaceWriter(
  classification: Record<string, unknown>,
  desktop: Record<string, unknown>,
  hops: string[],
): boolean {
  return stringValue(classification.workspaceWriter) === 'electron-dynamic'
    || stringValue(desktop.workspaceWriter) === 'electron-dynamic'
    || stringValue(asRecord(desktop.workspaceWriter)?.kind) === 'dynamic-workspace-writer'
    || stringValue(asRecord(desktop.workspaceWriter)?.allocation) === 'dynamic'
    || hops.includes('electron-dynamic-workspace-writer');
}

function hasRuntimeCodexTransport(
  classification: Record<string, unknown>,
  desktop: Record<string, unknown>,
  hops: string[],
): boolean {
  const runtime = asRecord(desktop.runtimeTransport) ?? {};
  return stringValue(classification.runtimeTransport) === 'runtime-codex-sse'
    || stringValue(desktop.runtimeTransport) === 'runtime-codex-sse'
    || stringValue(runtime.kind) === 'runtime-codex'
    || stringValue(runtime.transport) === 'sse'
    || hops.includes('runtime-codex-transport');
}

function hasDesktopNativeHost(
  classification: Record<string, unknown>,
  desktop: Record<string, unknown>,
  hops: string[],
): boolean {
  const nativeHost = asRecord(desktop.desktopNativeHost) ?? asRecord(desktop.nativeHost) ?? {};
  return stringValue(classification.desktopNativeHost) === 'sciforgeDesktop'
    || stringValue(desktop.nativeHost) === 'sciforgeDesktop'
    || stringValue(nativeHost.host) === 'sciforgeDesktop'
    || stringValue(nativeHost.kind) === 'desktop-native-host'
    || hops.includes('desktop-native-host');
}

function hasDisplayGroup(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  const group = asRecord(record?.virtualDisplayGroup) ?? asRecord(record?.displayGroup);
  return Boolean(
    (stringValue(group?.displayGroupId) && records(group?.screens).length > 0)
      || stringValue(evidence.displayGroupRef),
  );
}

function hasScreenIdentity(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  const group = asRecord(record?.virtualDisplayGroup) ?? asRecord(record?.displayGroup);
  return records(group?.screens).some((screen) => Boolean(stringValue(screen.screenId)))
    || Boolean(stringValue(evidence.screenIdentityRef));
}

function hasActorCursorProvenance(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  return (
    records(record?.actorCursorProvenance).some((cursor) => (
      Boolean(stringValue(cursor.actorId) && stringValue(cursor.cursorId) && stringValue(cursor.screenId))
    ))
    && records(record?.cursorEvents).length > 0
  ) || Boolean(stringValue(evidence.actorCursorProvenanceRef));
}

function hasUserControlRefs(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  const control = asRecord(record?.userControlPlane);
  return Boolean(
    (
      stringValue(control?.sessionPermissionRef)
        && stringList(control?.allowedAppRefs).length > 0
        && stringList(control?.allowedWindowRefs).length > 0
        && (stringValue(control?.stopRef) || stringValue(control?.cancelLeaseRef))
    )
      || stringValue(evidence.userControlRef),
  );
}

function hasNativeSidecarIsolation(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  const report = asRecord(record?.platformSidecarIsolationReport);
  const flags = asRecord(report?.isolationFlags) ?? {};
  return Boolean(
    (
      report
        && ['passed', 'present'].includes(stringValue(report.status) ?? '')
        && stringValue(report.reportRef)
        && stringValue(report.executorAdapterRef)
        && flags.sharedSystemInputUsed === false
        && flags.systemPointerMoved === false
        && flags.systemKeyboardEventsSent === false
        && flags.sidecarDoesPlanning === false
        && flags.sidecarDoesCompletion === false
    )
      || stringValue(evidence.nativeSidecarIsolationRef),
  );
}

function hasActionLedger(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  return records(record?.mutatingActions).length > 0
    || records(record?.evidenceLedgerActions).length > 0
    || records(asRecord(record?.actionLedger)?.actions).length > 0
    || records(asRecord(record?.evidenceLedger)?.actions).length > 0
    || Boolean(stringValue(record?.actionLedgerRef))
    || stringList(record?.actionLedgerRefs).length > 0
    || Boolean(stringValue(evidence.actionLedgerRef));
}

function hasReplayBundle(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  const replay = asRecord(record?.replayBundle);
  return Boolean(
    (stringValue(replay?.ref) && records(replay?.frames).length > 0)
      || stringValue(record?.replayBundleRef)
      || stringValue(evidence.replayBundleRef),
  );
}

function hasValidatorLedgerRefs(record: Record<string, unknown> | undefined, evidence: Record<string, unknown>): boolean {
  const verifier = asRecord(record?.verifierVerdict);
  const guiPresent = asRecord(record?.guiPresent);
  return Boolean(
    (
      stringValue(verifier?.ref)
        && stringValue(guiPresent?.recordRef)
        && stringValue(guiPresent?.payloadRef)
        && records(record?.tuiHostChain).length > 0
    )
      || (
        stringList(record?.validatorRefs).length > 0
        && stringList(record?.ledgerRefs).length > 0
      )
      || (
        stringList(evidence.validatorRefs).length > 0
        && stringList(evidence.ledgerRefs).length > 0
      ),
  );
}

function hardConfirmIssues(
  record: Record<string, unknown> | undefined,
  desktop: Record<string, unknown>,
): string[] {
  const hardConfirm = asRecord(desktop.hardConfirm)
    ?? asRecord(desktop.hardConfirmSurface)
    ?? asRecord(record?.hardConfirmSurface);
  const required = hardConfirm?.required === true
    || stringValue(record?.approvalMode) === 'hard-confirm'
    || records(record?.approvalRequestRefs).length > 0;
  if (!required) return [];
  const controls = stringList(hardConfirm?.controls);
  const surfaced = stringValue(hardConfirm?.surfaceRef)
    || stringValue(hardConfirm?.approvalRequestRef)
    || stringValue(hardConfirm?.approvalDecisionRef);
  return surfaced && controls.includes('Confirm') && controls.includes('Cancel')
    ? []
    : ['product-strict:hard-confirm-surface-required'];
}

function observe(
  observed: ComputerUseChatLiveProductStrictRequirement[],
  requirement: ComputerUseChatLiveProductStrictRequirement,
  condition: boolean,
): void {
  if (condition) observed.push(requirement);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(asRecord) : [];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function productStrictCompletionEvidenceProducerIds(
  manifest: ComputerUseChatLiveProductStrictManifestLike,
  options: ComputerUseChatLiveProductStrictOptions | undefined,
): string[] {
  return uniqueStrings([
    ...(options?.completionEvidenceProducerIds ?? []),
    ...(manifest.completionEvidenceProducerIds ?? []),
  ]);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isLocalRef(ref: string): boolean {
  return !ref.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.split('/').includes('..');
}
