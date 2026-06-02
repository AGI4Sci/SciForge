import type { VirtualScreenPayload } from '../../../../../packages/presentation/components';

export interface RightPaneActiveVirtualAppScreenBinding {
  screenRef: string;
  tabId?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  inputLeaseRef?: string;
  providerSessionOwnerRef?: string;
  providerSessionReconnectRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  surfaceTransportRef?: string;
  currentFrameSequence?: VirtualScreenPayload['currentFrameSequence'];
  adapterReadinessRef?: string;
  evidenceLedgerRef?: string;
  blockedRef?: string;
  blockedReason?: string;
}

export interface RightPaneActiveVirtualAppScreenRegistry {
  byScreenRef: Record<string, RightPaneActiveVirtualAppScreenBinding>;
  screenRefByTabId: Record<string, string>;
}

export interface RightPaneVirtualAppScreenPlaceholderRefs {
  scope: string;
  screenRef: string;
  activationRef: string;
  readinessRef: string;
  blockedRef: string;
  permissionRef: string;
  permissionHandoffRef: string;
  permissionRecheckRef: string;
  platformDriverRef: string;
  guiPresentRef: string;
  evidenceLedgerRef: string;
}

type RightPaneVirtualAppScreenPayloadRefs =
  Pick<VirtualScreenPayload, 'screenRef' | 'sessionRef' | 'liveSurfaceRef' | 'frameStreamRef' | 'currentFrameRef' | 'currentFrameSequence' | 'inputLeaseRef' | 'surfaceTransportRef' | 'adapterReadinessRef' | 'evidenceLedgerRef' | 'blockedRef' | 'blockedReason'>
  & {
    providerSessionOwnerRef?: string;
    providerSessionReconnectRef?: string;
    liveBindingAttachGrantRef?: string;
    grantValidationRef?: string;
  };

export type RightPaneVirtualAppScreenReconnectReason =
  | 'resize'
  | 'tab-switch'
  | 'workspace-restore'
  | 'provider-reconnect';

export interface RightPaneVirtualAppScreenReconnectCheckpoint {
  schemaVersion: 'sciforge.ui.right-pane.virtual-app-screen-reconnect.v1';
  checkpointRef: string;
  reason: RightPaneVirtualAppScreenReconnectReason;
  screenRef: string;
  tabId?: string;
  sessionRef?: string;
  liveSurfaceRef?: string;
  frameStreamRef?: string;
  currentFrameRef?: string;
  inputLeaseRef?: string;
  providerSessionOwnerRef?: string;
  providerSessionReconnectRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  surfaceTransportRef?: string;
  currentFrameSequence?: VirtualScreenPayload['currentFrameSequence'];
  observedSessionRef?: string;
  observedLiveSurfaceRef?: string;
  observedFrameStreamRef?: string;
  observedProviderSessionOwnerRef?: string;
  observedProviderSessionReconnectRef?: string;
  observedLiveBindingAttachGrantRef?: string;
  observedGrantValidationRef?: string;
  observedSurfaceTransportRef?: string;
  observedCurrentFrameSequence?: VirtualScreenPayload['currentFrameSequence'];
  adapterReadinessRef?: string;
  evidenceLedgerRef?: string;
  sameSessionRef: boolean;
  sameLiveSurfaceRef: boolean;
  sameFrameStreamRef: boolean;
  sameProviderSessionOwnerRef: boolean;
  sameProviderSessionReconnectRef: boolean;
  sameLiveBindingAttachGrantRef: boolean;
  sameGrantValidationRef: boolean;
  missingRefEvidence: string[];
  mismatchedRefEvidence: string[];
  blockedRef?: string;
  blockedReason?: string;
  singleInteractiveTruth: true;
  secondInteractiveSurfacePresent: false;
}

export function createRightPaneActiveVirtualAppScreenRegistry(): RightPaneActiveVirtualAppScreenRegistry {
  return { byScreenRef: {}, screenRefByTabId: {} };
}

export function rightPaneActiveVirtualAppScreenBindingFromPayload(
  payload: RightPaneVirtualAppScreenPayloadRefs,
  tabId?: string,
): RightPaneActiveVirtualAppScreenBinding | undefined {
  if (!payload.screenRef) return undefined;
  return stripUndefined({
    screenRef: payload.screenRef,
    tabId,
    sessionRef: payload.sessionRef,
    liveSurfaceRef: payload.liveSurfaceRef,
    frameStreamRef: payload.frameStreamRef,
    currentFrameRef: payload.currentFrameRef,
    inputLeaseRef: payload.inputLeaseRef,
    providerSessionOwnerRef: virtualScreenStringProp(payload, 'providerSessionOwnerRef'),
    providerSessionReconnectRef: virtualScreenStringProp(payload, 'providerSessionReconnectRef'),
    liveBindingAttachGrantRef: virtualScreenStringProp(payload, 'liveBindingAttachGrantRef'),
    grantValidationRef: virtualScreenStringProp(payload, 'grantValidationRef'),
    surfaceTransportRef: payload.surfaceTransportRef,
    currentFrameSequence: payload.currentFrameSequence,
    adapterReadinessRef: payload.adapterReadinessRef,
    evidenceLedgerRef: payload.evidenceLedgerRef,
    blockedRef: payload.blockedRef,
    blockedReason: payload.blockedReason,
  });
}

export function updateRightPaneActiveVirtualAppScreenRegistry(
  registry: RightPaneActiveVirtualAppScreenRegistry,
  binding: RightPaneActiveVirtualAppScreenBinding | undefined,
): RightPaneActiveVirtualAppScreenRegistry {
  if (!binding?.screenRef) return cloneRegistry(registry);
  const previous = registry.byScreenRef[binding.screenRef];
  const nextBinding = stripUndefined({
    ...previous,
    ...binding,
    screenRef: binding.screenRef,
    tabId: binding.tabId ?? previous?.tabId,
    sessionRef: binding.sessionRef ?? previous?.sessionRef,
    liveSurfaceRef: binding.liveSurfaceRef ?? previous?.liveSurfaceRef,
    frameStreamRef: binding.frameStreamRef ?? previous?.frameStreamRef,
    currentFrameRef: binding.currentFrameRef ?? previous?.currentFrameRef,
    inputLeaseRef: binding.inputLeaseRef ?? previous?.inputLeaseRef,
    providerSessionOwnerRef: binding.providerSessionOwnerRef ?? previous?.providerSessionOwnerRef,
    providerSessionReconnectRef: binding.providerSessionReconnectRef ?? previous?.providerSessionReconnectRef,
    liveBindingAttachGrantRef: binding.liveBindingAttachGrantRef ?? previous?.liveBindingAttachGrantRef,
    grantValidationRef: binding.grantValidationRef ?? previous?.grantValidationRef,
    surfaceTransportRef: binding.surfaceTransportRef ?? previous?.surfaceTransportRef,
    currentFrameSequence: binding.currentFrameSequence ?? previous?.currentFrameSequence,
    adapterReadinessRef: binding.adapterReadinessRef ?? previous?.adapterReadinessRef,
    evidenceLedgerRef: binding.evidenceLedgerRef ?? previous?.evidenceLedgerRef,
    blockedRef: binding.blockedRef ?? previous?.blockedRef,
    blockedReason: binding.blockedReason ?? previous?.blockedReason,
  });
  return {
    byScreenRef: {
      ...registry.byScreenRef,
      [binding.screenRef]: nextBinding,
    },
    screenRefByTabId: binding.tabId
      ? { ...registry.screenRefByTabId, [binding.tabId]: binding.screenRef }
      : { ...registry.screenRefByTabId },
  };
}

export function rightPaneActiveVirtualAppScreenBindingFor(
  registry: RightPaneActiveVirtualAppScreenRegistry,
  options: { screenRef?: string; tabId?: string },
): RightPaneActiveVirtualAppScreenBinding | undefined {
  const screenRef = options.screenRef ?? (options.tabId ? registry.screenRefByTabId[options.tabId] : undefined);
  return screenRef ? registry.byScreenRef[screenRef] : undefined;
}

export function mergeRightPaneActiveVirtualAppScreenBinding(
  payload: VirtualScreenPayload,
  binding: RightPaneActiveVirtualAppScreenBinding | undefined,
): VirtualScreenPayload {
  if (!binding || payload.screenRef !== binding.screenRef) return payload;
  return stripUndefined({
    ...payload,
    sessionRef: payload.sessionRef ?? binding.sessionRef,
    liveSurfaceRef: payload.liveSurfaceRef ?? binding.liveSurfaceRef,
    frameStreamRef: payload.frameStreamRef ?? binding.frameStreamRef,
    currentFrameRef: payload.currentFrameRef ?? binding.currentFrameRef,
    inputLeaseRef: payload.inputLeaseRef ?? binding.inputLeaseRef,
    providerSessionOwnerRef: virtualScreenStringProp(payload, 'providerSessionOwnerRef') ?? binding.providerSessionOwnerRef,
    providerSessionReconnectRef: virtualScreenStringProp(payload, 'providerSessionReconnectRef') ?? binding.providerSessionReconnectRef,
    liveBindingAttachGrantRef: virtualScreenStringProp(payload, 'liveBindingAttachGrantRef') ?? binding.liveBindingAttachGrantRef,
    grantValidationRef: virtualScreenStringProp(payload, 'grantValidationRef') ?? binding.grantValidationRef,
    surfaceTransportRef: payload.surfaceTransportRef ?? binding.surfaceTransportRef,
    currentFrameSequence: payload.currentFrameSequence ?? binding.currentFrameSequence,
    adapterReadinessRef: payload.adapterReadinessRef ?? binding.adapterReadinessRef,
    evidenceLedgerRef: payload.evidenceLedgerRef ?? binding.evidenceLedgerRef,
    blockedRef: payload.blockedRef ?? binding.blockedRef,
    blockedReason: payload.blockedReason ?? binding.blockedReason,
  }) as VirtualScreenPayload;
}

export function rightPaneVirtualAppScreenReconnectCheckpoint(
  registry: RightPaneActiveVirtualAppScreenRegistry,
  options: {
    reason: RightPaneVirtualAppScreenReconnectReason;
    screenRef?: string;
    tabId?: string;
    checkpointRef?: string;
    observed?: Partial<RightPaneVirtualAppScreenPayloadRefs>;
  },
): RightPaneVirtualAppScreenReconnectCheckpoint | undefined {
  const binding = rightPaneActiveVirtualAppScreenBindingFor(registry, {
    screenRef: options.screenRef,
    tabId: options.tabId,
  });
  if (!binding) return undefined;
  const observed = rightPaneVirtualAppScreenObservedRefs(options.observed);
  const refEvidence = rightPaneVirtualAppScreenReconnectRefEvidence(binding, observed);
  return stripUndefined({
    schemaVersion: 'sciforge.ui.right-pane.virtual-app-screen-reconnect.v1' as const,
    checkpointRef: options.checkpointRef ?? `computer-use:screen-reconnect/${safeRefPathSegment(binding.screenRef)}/${options.reason}.json`,
    reason: options.reason,
    screenRef: binding.screenRef,
    tabId: options.tabId ?? binding.tabId,
    sessionRef: binding.sessionRef,
    liveSurfaceRef: binding.liveSurfaceRef,
    frameStreamRef: binding.frameStreamRef,
    currentFrameRef: binding.currentFrameRef,
    inputLeaseRef: binding.inputLeaseRef,
    providerSessionOwnerRef: binding.providerSessionOwnerRef,
    providerSessionReconnectRef: binding.providerSessionReconnectRef,
    liveBindingAttachGrantRef: binding.liveBindingAttachGrantRef,
    grantValidationRef: binding.grantValidationRef,
    surfaceTransportRef: binding.surfaceTransportRef,
    currentFrameSequence: binding.currentFrameSequence,
    observedSessionRef: observed.sessionRef,
    observedLiveSurfaceRef: observed.liveSurfaceRef,
    observedFrameStreamRef: observed.frameStreamRef,
    observedProviderSessionOwnerRef: observed.providerSessionOwnerRef,
    observedProviderSessionReconnectRef: observed.providerSessionReconnectRef,
    observedLiveBindingAttachGrantRef: observed.liveBindingAttachGrantRef,
    observedGrantValidationRef: observed.grantValidationRef,
    observedSurfaceTransportRef: observed.surfaceTransportRef,
    observedCurrentFrameSequence: observed.currentFrameSequence,
    adapterReadinessRef: binding.adapterReadinessRef,
    evidenceLedgerRef: binding.evidenceLedgerRef,
    sameSessionRef: refEvidence.sameSessionRef,
    sameLiveSurfaceRef: refEvidence.sameLiveSurfaceRef,
    sameFrameStreamRef: refEvidence.sameFrameStreamRef,
    sameProviderSessionOwnerRef: refEvidence.sameProviderSessionOwnerRef,
    sameProviderSessionReconnectRef: refEvidence.sameProviderSessionReconnectRef,
    sameLiveBindingAttachGrantRef: refEvidence.sameLiveBindingAttachGrantRef,
    sameGrantValidationRef: refEvidence.sameGrantValidationRef,
    missingRefEvidence: refEvidence.missingRefEvidence,
    mismatchedRefEvidence: refEvidence.mismatchedRefEvidence,
    blockedRef: binding.blockedRef ?? refEvidence.blockedRef,
    blockedReason: binding.blockedReason ?? refEvidence.blockedReason,
    singleInteractiveTruth: true as const,
    secondInteractiveSurfacePresent: false as const,
  });
}

export function rightPaneVirtualAppScreenPlaceholderRefs(options: {
  sessionId?: string;
  runId?: string;
  activeTabId?: string;
}): RightPaneVirtualAppScreenPlaceholderRefs {
  const scope = rightPaneVirtualAppScreenPlaceholderScope(options);
  return {
    scope,
    screenRef: `virtual-app-screen:${scope}/screen-request`,
    activationRef: `computer-use:screen-activation/${scope}/attach-request.json`,
    readinessRef: `computer-use:screen-activation/${scope}/provider-readiness.json`,
    blockedRef: `computer-use:screen-activation/${scope}/blocked/no-native-session.json`,
    permissionRef: `computer-use:screen-activation/${scope}/permissions/platform-gates.json`,
    permissionHandoffRef: `computer-use:screen-activation/${scope}/permission-handoff.json`,
    permissionRecheckRef: `computer-use:screen-activation/${scope}/permission-recheck.json`,
    platformDriverRef: `computer-use:screen-activation/${scope}/platform-driver.json`,
    guiPresentRef: `gui.present:${scope}/screen-pane-activation`,
    evidenceLedgerRef: `ledger:computer-use/${scope}/screen-activation.json`,
  };
}

export function rightPaneVirtualAppScreenPlaceholderScope(options: {
  sessionId?: string;
  runId?: string;
  activeTabId?: string;
}) {
  const baseScope = safeRefPathSegment(options.runId ?? options.sessionId ?? 'workspace');
  const tabScope = options.activeTabId?.startsWith('custom:screen:')
    ? safeRefPathSegment(options.activeTabId)
    : undefined;
  return tabScope ? `${baseScope}/${tabScope}` : baseScope;
}

function rightPaneVirtualAppScreenObservedRefs(observed: Partial<RightPaneVirtualAppScreenPayloadRefs> | undefined): Partial<RightPaneActiveVirtualAppScreenBinding> {
  if (!observed) return {};
  return stripUndefined({
    sessionRef: virtualScreenStringProp(observed, 'sessionRef'),
    liveSurfaceRef: virtualScreenStringProp(observed, 'liveSurfaceRef'),
    frameStreamRef: virtualScreenStringProp(observed, 'frameStreamRef'),
    providerSessionOwnerRef: virtualScreenStringProp(observed, 'providerSessionOwnerRef'),
    providerSessionReconnectRef: virtualScreenStringProp(observed, 'providerSessionReconnectRef'),
    liveBindingAttachGrantRef: virtualScreenStringProp(observed, 'liveBindingAttachGrantRef'),
    grantValidationRef: virtualScreenStringProp(observed, 'grantValidationRef'),
    surfaceTransportRef: virtualScreenStringProp(observed, 'surfaceTransportRef'),
    currentFrameSequence: observed.currentFrameSequence,
  });
}

function rightPaneVirtualAppScreenReconnectRefEvidence(
  expected: RightPaneActiveVirtualAppScreenBinding,
  observed: Partial<RightPaneActiveVirtualAppScreenBinding>,
) {
  const checks = [
    rightPaneVirtualAppScreenReconnectRefCheck('sessionRef', expected.sessionRef, observed.sessionRef),
    rightPaneVirtualAppScreenReconnectRefCheck('liveSurfaceRef', expected.liveSurfaceRef, observed.liveSurfaceRef),
    rightPaneVirtualAppScreenReconnectRefCheck('frameStreamRef', expected.frameStreamRef, observed.frameStreamRef),
    rightPaneVirtualAppScreenReconnectRefCheck('providerSessionOwnerRef', expected.providerSessionOwnerRef, observed.providerSessionOwnerRef),
    rightPaneVirtualAppScreenReconnectRefCheck('providerSessionReconnectRef', expected.providerSessionReconnectRef, observed.providerSessionReconnectRef),
    rightPaneVirtualAppScreenReconnectRefCheck('liveBindingAttachGrantRef', expected.liveBindingAttachGrantRef, observed.liveBindingAttachGrantRef),
    rightPaneVirtualAppScreenReconnectRefCheck('grantValidationRef', expected.grantValidationRef, observed.grantValidationRef),
  ];
  const missingRefEvidence = checks.flatMap((check) => check.missing);
  const mismatchedRefEvidence = checks.flatMap((check) => check.mismatch);
  const hasBlockedEvidence = missingRefEvidence.length || mismatchedRefEvidence.length;
  const evidenceSuffix = [
    missingRefEvidence.length ? `missing ${missingRefEvidence.join(', ')}` : undefined,
    mismatchedRefEvidence.length ? `mismatched ${mismatchedRefEvidence.join(', ')}` : undefined,
  ].filter((entry): entry is string => Boolean(entry)).join('; ');
  return {
    sameSessionRef: checks[0]?.same ?? false,
    sameLiveSurfaceRef: checks[1]?.same ?? false,
    sameFrameStreamRef: checks[2]?.same ?? false,
    sameProviderSessionOwnerRef: checks[3]?.same ?? false,
    sameProviderSessionReconnectRef: checks[4]?.same ?? false,
    sameLiveBindingAttachGrantRef: checks[5]?.same ?? false,
    sameGrantValidationRef: checks[6]?.same ?? false,
    missingRefEvidence,
    mismatchedRefEvidence,
    blockedRef: hasBlockedEvidence ? `computer-use:screen-reconnect/${safeRefPathSegment(expected.screenRef)}/blocked/ref-evidence.json` : undefined,
    blockedReason: hasBlockedEvidence ? `VirtualAppScreen reconnect checkpoint is blocked until expected and observed refs match: ${evidenceSuffix}.` : undefined,
  };
}

function rightPaneVirtualAppScreenReconnectRefCheck(name: string, expected: string | undefined, observed: string | undefined) {
  const missing = [
    expected ? undefined : `${name}:expected`,
    observed ? undefined : `${name}:observed`,
  ].filter((entry): entry is string => Boolean(entry));
  const mismatch = expected && observed && expected !== observed ? [name] : [];
  return {
    same: Boolean(expected && observed && expected === observed),
    missing,
    mismatch,
  };
}

function cloneRegistry(registry: RightPaneActiveVirtualAppScreenRegistry): RightPaneActiveVirtualAppScreenRegistry {
  return {
    byScreenRef: { ...registry.byScreenRef },
    screenRefByTabId: { ...registry.screenRefByTabId },
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function safeRefPathSegment(value: string) {
  const segment = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment || 'workspace';
}

function virtualScreenStringProp(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}
