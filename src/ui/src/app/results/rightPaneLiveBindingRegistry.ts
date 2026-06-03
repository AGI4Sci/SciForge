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
  surfaceIdentityRef?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  surfaceTransportRef?: string;
  currentFrameSequence?: VirtualScreenPayload['currentFrameSequence'];
  preflightRef?: string;
  preflightLedgerRef?: string;
  preflightLedgerEntryRef?: string;
  hostReadinessRef?: string;
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
  Pick<VirtualScreenPayload, 'screenRef' | 'sessionRef' | 'liveSurfaceRef' | 'frameStreamRef' | 'currentFrameRef' | 'currentFrameSequence' | 'inputLeaseRef' | 'surfaceTransportRef' | 'preflightRef' | 'preflightLedgerRef' | 'preflightLedgerEntryRef' | 'hostReadinessRef' | 'adapterReadinessRef' | 'evidenceLedgerRef' | 'blockedRef' | 'blockedReason'>
  & {
    providerSessionOwnerRef?: string;
    providerSessionReconnectRef?: string;
    surfaceIdentityRef?: string;
    surfaceOwnerRef?: string;
    displayOwnerRef?: string;
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
  surfaceIdentityRef?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  liveBindingAttachGrantRef?: string;
  grantValidationRef?: string;
  surfaceTransportRef?: string;
  currentFrameSequence?: VirtualScreenPayload['currentFrameSequence'];
  observedSessionRef?: string;
  observedLiveSurfaceRef?: string;
  observedFrameStreamRef?: string;
  observedProviderSessionOwnerRef?: string;
  observedProviderSessionReconnectRef?: string;
  observedSurfaceIdentityRef?: string;
  observedSurfaceOwnerRef?: string;
  observedDisplayOwnerRef?: string;
  observedLiveBindingAttachGrantRef?: string;
  observedGrantValidationRef?: string;
  observedSurfaceTransportRef?: string;
  observedCurrentFrameSequence?: VirtualScreenPayload['currentFrameSequence'];
  preflightRef?: string;
  preflightLedgerRef?: string;
  preflightLedgerEntryRef?: string;
  hostReadinessRef?: string;
  adapterReadinessRef?: string;
  evidenceLedgerRef?: string;
  sameSessionRef: boolean;
  sameLiveSurfaceRef: boolean;
  sameFrameStreamRef: boolean;
  sameProviderSessionOwnerRef: boolean;
  sameProviderSessionReconnectRef: boolean;
  sameSurfaceIdentityRef: boolean;
  sameSurfaceOwnerRef: boolean;
  sameDisplayOwnerRef: boolean;
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
  const liveLike = rightPaneVirtualScreenPayloadRefsLiveLike(payload);
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
    surfaceIdentityRef: virtualScreenStringProp(payload, 'surfaceIdentityRef'),
    surfaceOwnerRef: virtualScreenStringProp(payload, 'surfaceOwnerRef'),
    displayOwnerRef: virtualScreenStringProp(payload, 'displayOwnerRef'),
    liveBindingAttachGrantRef: virtualScreenStringProp(payload, 'liveBindingAttachGrantRef'),
    grantValidationRef: virtualScreenStringProp(payload, 'grantValidationRef'),
    surfaceTransportRef: payload.surfaceTransportRef,
    currentFrameSequence: payload.currentFrameSequence,
    preflightRef: rightPaneNativeHostPreflightRef(payload.preflightRef),
    preflightLedgerRef: rightPaneNativeHostPreflightRef(payload.preflightLedgerRef),
    preflightLedgerEntryRef: rightPaneNativeHostPreflightRef(payload.preflightLedgerEntryRef),
    hostReadinessRef: rightPaneNativeHostPreflightRef(payload.hostReadinessRef),
    adapterReadinessRef: payload.adapterReadinessRef,
    evidenceLedgerRef: payload.evidenceLedgerRef,
    blockedRef: liveLike ? undefined : payload.blockedRef,
    blockedReason: liveLike ? undefined : payload.blockedReason,
  });
}

export function updateRightPaneActiveVirtualAppScreenRegistry(
  registry: RightPaneActiveVirtualAppScreenRegistry,
  binding: RightPaneActiveVirtualAppScreenBinding | undefined,
): RightPaneActiveVirtualAppScreenRegistry {
  if (!binding?.screenRef) return cloneRegistry(registry);
  const previous = registry.byScreenRef[binding.screenRef];
  const identityDrift = rightPaneVirtualAppScreenSurfaceIdentityDrift(previous, binding);
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
    surfaceIdentityRef: identityDrift.length ? previous?.surfaceIdentityRef : binding.surfaceIdentityRef ?? previous?.surfaceIdentityRef,
    surfaceOwnerRef: identityDrift.length ? previous?.surfaceOwnerRef : binding.surfaceOwnerRef ?? previous?.surfaceOwnerRef,
    displayOwnerRef: identityDrift.length ? previous?.displayOwnerRef : binding.displayOwnerRef ?? previous?.displayOwnerRef,
    liveBindingAttachGrantRef: binding.liveBindingAttachGrantRef ?? previous?.liveBindingAttachGrantRef,
    grantValidationRef: binding.grantValidationRef ?? previous?.grantValidationRef,
    surfaceTransportRef: binding.surfaceTransportRef ?? previous?.surfaceTransportRef,
    currentFrameSequence: binding.currentFrameSequence ?? previous?.currentFrameSequence,
    preflightRef: rightPaneNativeHostPreflightRef(binding.preflightRef) ?? rightPaneNativeHostPreflightRef(previous?.preflightRef),
    preflightLedgerRef: rightPaneNativeHostPreflightRef(binding.preflightLedgerRef) ?? rightPaneNativeHostPreflightRef(previous?.preflightLedgerRef),
    preflightLedgerEntryRef: rightPaneNativeHostPreflightRef(binding.preflightLedgerEntryRef) ?? rightPaneNativeHostPreflightRef(previous?.preflightLedgerEntryRef),
    hostReadinessRef: rightPaneNativeHostPreflightRef(binding.hostReadinessRef) ?? rightPaneNativeHostPreflightRef(previous?.hostReadinessRef),
    adapterReadinessRef: binding.adapterReadinessRef ?? previous?.adapterReadinessRef,
    evidenceLedgerRef: binding.evidenceLedgerRef ?? previous?.evidenceLedgerRef,
    blockedRef: identityDrift.length
      ? `computer-use:screen-reconnect/${safeRefPathSegment(binding.screenRef)}/blocked/surface-identity.json`
      : binding.blockedRef ?? previous?.blockedRef,
    blockedReason: identityDrift.length
      ? `VirtualAppScreen active binding surface identity drifted: ${identityDrift.join(', ')}.`
      : binding.blockedReason ?? previous?.blockedReason,
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
  const payloadLiveLike = rightPaneVirtualScreenPayloadRefsLiveLike(payload);
  return stripUndefined({
    ...payload,
    sessionRef: payload.sessionRef ?? binding.sessionRef,
    liveSurfaceRef: payload.liveSurfaceRef ?? binding.liveSurfaceRef,
    frameStreamRef: payload.frameStreamRef ?? binding.frameStreamRef,
    currentFrameRef: payload.currentFrameRef ?? binding.currentFrameRef,
    inputLeaseRef: payload.inputLeaseRef ?? binding.inputLeaseRef,
    providerSessionOwnerRef: virtualScreenStringProp(payload, 'providerSessionOwnerRef') ?? binding.providerSessionOwnerRef,
    providerSessionReconnectRef: virtualScreenStringProp(payload, 'providerSessionReconnectRef') ?? binding.providerSessionReconnectRef,
    surfaceIdentityRef: virtualScreenStringProp(payload, 'surfaceIdentityRef') ?? binding.surfaceIdentityRef,
    surfaceOwnerRef: virtualScreenStringProp(payload, 'surfaceOwnerRef') ?? binding.surfaceOwnerRef,
    displayOwnerRef: virtualScreenStringProp(payload, 'displayOwnerRef') ?? binding.displayOwnerRef,
    liveBindingAttachGrantRef: virtualScreenStringProp(payload, 'liveBindingAttachGrantRef') ?? binding.liveBindingAttachGrantRef,
    grantValidationRef: virtualScreenStringProp(payload, 'grantValidationRef') ?? binding.grantValidationRef,
    surfaceTransportRef: payload.surfaceTransportRef ?? binding.surfaceTransportRef,
    currentFrameSequence: payload.currentFrameSequence ?? binding.currentFrameSequence,
    preflightRef: rightPaneNativeHostPreflightRef(payload.preflightRef) ?? rightPaneNativeHostPreflightRef(binding.preflightRef),
    preflightLedgerRef: rightPaneNativeHostPreflightRef(payload.preflightLedgerRef) ?? rightPaneNativeHostPreflightRef(binding.preflightLedgerRef),
    preflightLedgerEntryRef: rightPaneNativeHostPreflightRef(payload.preflightLedgerEntryRef) ?? rightPaneNativeHostPreflightRef(binding.preflightLedgerEntryRef),
    hostReadinessRef: rightPaneNativeHostPreflightRef(payload.hostReadinessRef) ?? rightPaneNativeHostPreflightRef(binding.hostReadinessRef),
    adapterReadinessRef: payload.adapterReadinessRef ?? binding.adapterReadinessRef,
    evidenceLedgerRef: payload.evidenceLedgerRef ?? binding.evidenceLedgerRef,
    blockedRef: payloadLiveLike ? undefined : payload.blockedRef ?? binding.blockedRef,
    blockedReason: payloadLiveLike ? undefined : payload.blockedReason ?? binding.blockedReason,
  }) as VirtualScreenPayload;
}

function rightPaneVirtualScreenPayloadRefsLiveLike(payload: Partial<RightPaneVirtualAppScreenPayloadRefs> & Partial<VirtualScreenPayload>) {
  return Boolean(
    rightPaneNativeHostProductRef(payload.sessionRef)
    && rightPaneNativeHostProductRef(payload.liveSurfaceRef)
    && rightPaneNativeHostProductRef(payload.frameStreamRef)
    && rightPaneNativeHostProductRef(payload.currentFrameRef)
    && payload.providerSessionOwnerRef
    && payload.providerSessionReconnectRef
    && rightPaneNativeHostProductRef(payload.liveBindingAttachGrantRef)
    && rightPaneNativeHostProductRef(payload.grantValidationRef)
    && rightPaneNativeHostProductRef(payload.currentFrameSequence?.ref)
  );
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
    surfaceIdentityRef: binding.surfaceIdentityRef,
    surfaceOwnerRef: binding.surfaceOwnerRef,
    displayOwnerRef: binding.displayOwnerRef,
    liveBindingAttachGrantRef: binding.liveBindingAttachGrantRef,
    grantValidationRef: binding.grantValidationRef,
    surfaceTransportRef: binding.surfaceTransportRef,
    currentFrameSequence: binding.currentFrameSequence,
    preflightRef: rightPaneNativeHostPreflightRef(binding.preflightRef),
    preflightLedgerRef: rightPaneNativeHostPreflightRef(binding.preflightLedgerRef),
    preflightLedgerEntryRef: rightPaneNativeHostPreflightRef(binding.preflightLedgerEntryRef),
    hostReadinessRef: rightPaneNativeHostPreflightRef(binding.hostReadinessRef),
    observedSessionRef: observed.sessionRef,
    observedLiveSurfaceRef: observed.liveSurfaceRef,
    observedFrameStreamRef: observed.frameStreamRef,
    observedProviderSessionOwnerRef: observed.providerSessionOwnerRef,
    observedProviderSessionReconnectRef: observed.providerSessionReconnectRef,
    observedSurfaceIdentityRef: observed.surfaceIdentityRef,
    observedSurfaceOwnerRef: observed.surfaceOwnerRef,
    observedDisplayOwnerRef: observed.displayOwnerRef,
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
    sameSurfaceIdentityRef: refEvidence.sameSurfaceIdentityRef,
    sameSurfaceOwnerRef: refEvidence.sameSurfaceOwnerRef,
    sameDisplayOwnerRef: refEvidence.sameDisplayOwnerRef,
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
    surfaceIdentityRef: virtualScreenStringProp(observed, 'surfaceIdentityRef'),
    surfaceOwnerRef: virtualScreenStringProp(observed, 'surfaceOwnerRef'),
    displayOwnerRef: virtualScreenStringProp(observed, 'displayOwnerRef'),
    liveBindingAttachGrantRef: virtualScreenStringProp(observed, 'liveBindingAttachGrantRef'),
    grantValidationRef: virtualScreenStringProp(observed, 'grantValidationRef'),
    surfaceTransportRef: virtualScreenStringProp(observed, 'surfaceTransportRef'),
    currentFrameSequence: observed.currentFrameSequence,
    preflightRef: rightPaneNativeHostPreflightRef(virtualScreenStringProp(observed, 'preflightRef')),
    preflightLedgerRef: rightPaneNativeHostPreflightRef(virtualScreenStringProp(observed, 'preflightLedgerRef')),
    preflightLedgerEntryRef: rightPaneNativeHostPreflightRef(virtualScreenStringProp(observed, 'preflightLedgerEntryRef')),
    hostReadinessRef: rightPaneNativeHostPreflightRef(virtualScreenStringProp(observed, 'hostReadinessRef')),
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
    rightPaneVirtualAppScreenReconnectRefCheck('surfaceIdentityRef', expected.surfaceIdentityRef, observed.surfaceIdentityRef),
    rightPaneVirtualAppScreenReconnectRefCheck('surfaceOwnerRef', expected.surfaceOwnerRef, observed.surfaceOwnerRef),
    rightPaneVirtualAppScreenReconnectRefCheck('displayOwnerRef', expected.displayOwnerRef, observed.displayOwnerRef),
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
    sameSurfaceIdentityRef: checks[5]?.same ?? false,
    sameSurfaceOwnerRef: checks[6]?.same ?? false,
    sameDisplayOwnerRef: checks[7]?.same ?? false,
    sameLiveBindingAttachGrantRef: checks[8]?.same ?? false,
    sameGrantValidationRef: checks[9]?.same ?? false,
    missingRefEvidence,
    mismatchedRefEvidence,
    blockedRef: hasBlockedEvidence ? `computer-use:screen-reconnect/${safeRefPathSegment(expected.screenRef)}/blocked/ref-evidence.json` : undefined,
    blockedReason: hasBlockedEvidence ? `VirtualAppScreen reconnect checkpoint is blocked until expected and observed refs match: ${evidenceSuffix}.` : undefined,
  };
}

function rightPaneVirtualAppScreenSurfaceIdentityDrift(
  previous: RightPaneActiveVirtualAppScreenBinding | undefined,
  next: RightPaneActiveVirtualAppScreenBinding,
) {
  if (!previous) return [];
  return [
    rightPaneVirtualAppScreenImmutableRefDrift('sessionRef', previous.sessionRef, next.sessionRef),
    rightPaneVirtualAppScreenImmutableRefDrift('liveSurfaceRef', previous.liveSurfaceRef, next.liveSurfaceRef),
    rightPaneVirtualAppScreenImmutableRefDrift('frameStreamRef', previous.frameStreamRef, next.frameStreamRef),
    rightPaneVirtualAppScreenImmutableRefDrift('providerSessionOwnerRef', previous.providerSessionOwnerRef, next.providerSessionOwnerRef),
    rightPaneVirtualAppScreenImmutableRefDrift('providerSessionReconnectRef', previous.providerSessionReconnectRef, next.providerSessionReconnectRef),
    rightPaneVirtualAppScreenImmutableRefDrift('surfaceIdentityRef', previous.surfaceIdentityRef, next.surfaceIdentityRef),
    rightPaneVirtualAppScreenImmutableRefDrift('surfaceOwnerRef', previous.surfaceOwnerRef, next.surfaceOwnerRef),
    rightPaneVirtualAppScreenImmutableRefDrift('displayOwnerRef', previous.displayOwnerRef, next.displayOwnerRef),
    rightPaneVirtualAppScreenImmutableRefDrift('liveBindingAttachGrantRef', previous.liveBindingAttachGrantRef, next.liveBindingAttachGrantRef),
    rightPaneVirtualAppScreenImmutableRefDrift('grantValidationRef', previous.grantValidationRef, next.grantValidationRef),
    rightPaneVirtualAppScreenImmutableRefDrift('surfaceTransportRef', previous.surfaceTransportRef, next.surfaceTransportRef),
  ].filter((item): item is string => Boolean(item));
}

function rightPaneVirtualAppScreenImmutableRefDrift(name: string, previous: string | undefined, next: string | undefined) {
  return previous && next && previous !== next ? name : undefined;
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

function rightPaneNativeHostPreflightRef(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const ref = value.trim();
  if (!ref.startsWith('computer-use:native-host/preflights/')) return undefined;
  const lower = ref.toLowerCase();
  if (
    lower.startsWith('data:')
    || lower.startsWith('javascript:')
    || lower.startsWith('file:')
    || lower.startsWith('blob:')
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('//')
    || lower.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(ref)
    || /(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(ref)
    || /[\r\n]/.test(ref)
  ) return undefined;
  return ref;
}

function rightPaneNativeHostProductRef(value: unknown) {
  if (typeof value !== 'string') return false;
  const ref = value.trim();
  if (!ref.startsWith('computer-use:native-host/')) return false;
  const lower = ref.toLowerCase();
  return !(
    lower.startsWith('data:')
    || lower.startsWith('javascript:')
    || lower.startsWith('file:')
    || lower.startsWith('blob:')
    || lower.startsWith('http://')
    || lower.startsWith('https://')
    || lower.startsWith('//')
    || lower.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(ref)
    || /(?:^|[:/.-])(?:fixture|fixtures|replay-fixture|snapshot-fixture|mock)(?:[:/.-]|$)/i.test(ref)
    || /[\r\n]/.test(ref)
  );
}
