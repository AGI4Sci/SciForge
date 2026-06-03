import { useEffect, useMemo, useRef } from 'react';
import type { VirtualScreenPayload } from '../../../../../packages/presentation/components';
import type { SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import type { ResultPaneTab } from './ResultShell';
import { rightPaneVirtualScreenPayload } from './screenPaneModel';
import type { ResultLocale } from './resultLocale';
import {
  createRightPaneActiveVirtualAppScreenRegistry,
  mergeRightPaneActiveVirtualAppScreenBinding,
  rightPaneActiveVirtualAppScreenBindingFor,
  rightPaneActiveVirtualAppScreenBindingFromPayload,
  updateRightPaneActiveVirtualAppScreenRegistry,
  type RightPaneActiveVirtualAppScreenRegistry,
} from './rightPaneLiveBindingRegistry';

export interface RightPaneVirtualScreenActivationCommand {
  commandText: string;
  label: string;
  targetRef: string;
  commandKey: string;
}

export interface UseRightPaneScreenControllerOptions {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  activeTabId: string;
  resultTab: ResultPaneTab;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}

export interface RightPaneScreenController {
  payload: VirtualScreenPayload;
  activationCommand?: RightPaneVirtualScreenActivationCommand;
}

export interface RightPaneVirtualScreenPayloadRegistryResult {
  payload: VirtualScreenPayload;
  registry: RightPaneActiveVirtualAppScreenRegistry;
}

export function useRightPaneScreenController({
  config,
  session,
  activeRun,
  activeTabId,
  resultTab,
  locale,
  onCommandRequest,
}: UseRightPaneScreenControllerOptions): RightPaneScreenController {
  const activeScreenRegistryRef = useRef(createRightPaneActiveVirtualAppScreenRegistry());
  const basePayload = useMemo(() => rightPaneVirtualScreenPayload(session, activeRun, config, locale, { activeTabId }), [
    activeRun,
    activeTabId,
    config,
    locale,
    session,
  ]);
  const payload = useMemo(() => {
    const next = rightPaneVirtualScreenPayloadWithLiveBindingRegistry(
      basePayload,
      activeScreenRegistryRef.current,
      activeTabId,
    );
    activeScreenRegistryRef.current = next.registry;
    return next.payload;
  }, [activeTabId, basePayload]);
  const activationCommand = useMemo(() => rightPaneVirtualScreenActivationCommand(payload), [
    payload.adapterReadinessRef,
    payload.attachState,
    payload.evidenceLedgerRef,
    payload.frameStreamRef,
    payload.guiPresentRefs?.[0],
    (payload as Record<string, unknown>).grantValidationRef,
    payload.handoffRef,
    payload.hostReadinessRef,
    (payload as Record<string, unknown>).liveBindingAttachGrantRef,
    (payload as Record<string, unknown>).surfaceIdentityRef,
    (payload as Record<string, unknown>).surfaceOwnerRef,
    (payload as Record<string, unknown>).displayOwnerRef,
    payload.liveSurfaceRef,
    payload.permissionGranted,
    payload.permissionHandoffRef,
    payload.permissionHandoffRefs?.[0],
    payload.permissionRef,
    payload.permissionRecheckRef,
    payload.permissionRecheckRefs?.[0],
    payload.permissionRequired,
    payload.permissionStatus,
    payload.platformDriverRef,
    payload.platformDriverStatus,
    payload.preflightLedgerEntryRef,
    payload.preflightLedgerRef,
    payload.preflightRef,
    payload.providerSessionOwnerRef,
    payload.providerSessionReconnectRef,
    payload.recheckRef,
    payload.screenRef,
    payload.sessionRef,
    payload.status,
    payload.surfaceMode,
    payload.surfaceTransportRef,
    payload.targetAppRef,
    payload.currentFrameRef,
    payload.currentFrameSequence?.sequence,
  ]);
  const emittedActivationKeys = useRef(new Set<string>());

  useEffect(() => {
    if (resultTab !== 'screen' || !activationCommand) return;
    if (emittedActivationKeys.current.has(activationCommand.commandKey)) return;
    emittedActivationKeys.current.add(activationCommand.commandKey);
    onCommandRequest(activationCommand.commandText, activationCommand.label, activationCommand.targetRef);
  }, [activationCommand, onCommandRequest, resultTab]);

  return { payload, activationCommand };
}

export function rightPaneVirtualScreenPayloadWithLiveBindingRegistry(
  payload: VirtualScreenPayload,
  registry: RightPaneActiveVirtualAppScreenRegistry,
  activeTabId?: string,
): RightPaneVirtualScreenPayloadRegistryResult {
  const binding = rightPaneActiveVirtualAppScreenBindingFor(registry, {
    screenRef: payload.screenRef,
    tabId: activeTabId,
  });
  const mergedPayload = mergeRightPaneActiveVirtualAppScreenBinding(payload, binding);
  return {
    payload: mergedPayload,
    registry: updateRightPaneActiveVirtualAppScreenRegistry(
      registry,
      rightPaneActiveVirtualAppScreenBindingFromPayload(mergedPayload, activeTabId),
    ),
  };
}

export function rightPaneVirtualScreenActivationCommand(payload: VirtualScreenPayload): RightPaneVirtualScreenActivationCommand | undefined {
  const attachCommand = rightPaneVirtualScreenAttachCommand(payload);
  const permissionRecheckCommand = rightPaneVirtualScreenPermissionRecheckCommand(payload);
  if (permissionRecheckCommand) return permissionRecheckCommand;
  if (attachCommand && !rightPaneVirtualScreenExplicitPermissionBlock(payload)) return attachCommand;
  const permissionHandoffCommand = rightPaneVirtualScreenPermissionHandoffCommand(payload);
  if (permissionHandoffCommand) return permissionHandoffCommand;
  const reconnectCommand = rightPaneVirtualScreenReconnectCommand(payload);
  if (reconnectCommand) return reconnectCommand;
  return attachCommand;
}

function rightPaneVirtualScreenAttachCommand(payload: VirtualScreenPayload): RightPaneVirtualScreenActivationCommand | undefined {
  if (payload.sessionRef) return undefined;
  if (!payload.handoffRef || !payload.targetAppRef || !payload.adapterReadinessRef) return undefined;
  if (payload.attachState !== 'blocked' && payload.attachState !== 'requires-handoff' && payload.status !== 'blocked') return undefined;
  const parts = [
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile ${terminalQuote(profileFromTargetAppRef(payload.targetAppRef))}`,
    `--target-app-ref ${terminalQuote(payload.targetAppRef)}`,
    payload.screenRef ? `--screen-ref ${terminalQuote(payload.screenRef)}` : undefined,
    `--activation-ref ${terminalQuote(payload.handoffRef)}`,
    `--adapter-readiness-ref ${terminalQuote(payload.adapterReadinessRef)}`,
    ...rightPaneVirtualScreenPreflightCommandParts(payload),
    payload.platformDriverRef ? `--platform-driver-ref ${terminalQuote(payload.platformDriverRef)}` : undefined,
    payload.permissionRef ? `--permission-ref ${terminalQuote(payload.permissionRef)}` : undefined,
    payload.evidenceLedgerRef ? `--evidence-ledger-ref ${terminalQuote(payload.evidenceLedgerRef)}` : undefined,
    payload.guiPresentRefs?.[0] ? `--gui-present-ref ${terminalQuote(payload.guiPresentRefs[0])}` : undefined,
  ].filter(Boolean);
  return {
    commandText: parts.join(' '),
    label: 'Attach VirtualAppScreen',
    targetRef: payload.handoffRef,
    commandKey: payload.handoffRef,
  };
}

function rightPaneVirtualScreenExplicitPermissionBlock(payload: VirtualScreenPayload) {
  return payload.attachState === 'requires-handoff' || payload.status === 'requires-handoff';
}

function rightPaneVirtualScreenReconnectCommand(payload: VirtualScreenPayload): RightPaneVirtualScreenActivationCommand | undefined {
  if (!payload.sessionRef) return undefined;
  if (payload.surfaceMode === 'live' && (payload.attachState === 'attached' || payload.attachState === 'observe-only')) return undefined;
  if (payload.status !== 'blocked' && payload.attachState !== 'blocked') return undefined;
  const liveBindingAttachGrantRef = virtualScreenStringProp(payload, 'liveBindingAttachGrantRef');
  const grantValidationRef = virtualScreenStringProp(payload, 'grantValidationRef');
  const surfaceIdentityRef = virtualScreenStringProp(payload, 'surfaceIdentityRef');
  const surfaceOwnerRef = virtualScreenStringProp(payload, 'surfaceOwnerRef');
  const displayOwnerRef = virtualScreenStringProp(payload, 'displayOwnerRef');
  if (
    !payload.screenRef
    || !rightPaneNativeHostProductRef(payload.sessionRef)
    || !rightPaneNativeHostProductRef(payload.liveSurfaceRef)
    || !rightPaneNativeHostProductRef(payload.frameStreamRef)
    || !rightPaneNativeHostProductRef(payload.currentFrameRef)
    || typeof payload.currentFrameSequence?.sequence !== 'number'
    || !Number.isFinite(payload.currentFrameSequence.sequence)
    || payload.currentFrameSequence.sequence < 0
    || !payload.providerSessionOwnerRef
    || !payload.providerSessionReconnectRef
    || !surfaceIdentityRef
    || !rightPaneNativeHostProductRef(surfaceOwnerRef)
    || !rightPaneNativeHostProductRef(displayOwnerRef)
    || !rightPaneNativeHostProductRef(liveBindingAttachGrantRef)
    || !rightPaneNativeHostProductRef(grantValidationRef)
    || !rightPaneNativeHostProductRef(payload.surfaceTransportRef)
  ) return undefined;
  const parts = [
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason provider-reconnect',
    `--screen-ref ${terminalQuote(payload.screenRef)}`,
    `--session-ref ${terminalQuote(payload.sessionRef)}`,
    `--live-surface-ref ${terminalQuote(payload.liveSurfaceRef)}`,
    `--frame-stream-ref ${terminalQuote(payload.frameStreamRef)}`,
    `--current-frame-ref ${terminalQuote(payload.currentFrameRef)}`,
    `--current-frame-sequence ${Math.round(payload.currentFrameSequence.sequence)}`,
    `--provider-session-owner-ref ${terminalQuote(payload.providerSessionOwnerRef)}`,
    `--provider-session-reconnect-ref ${terminalQuote(payload.providerSessionReconnectRef)}`,
    `--surface-identity-ref ${terminalQuote(surfaceIdentityRef)}`,
    `--surface-owner-ref ${terminalQuote(surfaceOwnerRef)}`,
    `--display-owner-ref ${terminalQuote(displayOwnerRef)}`,
    `--live-binding-attach-grant-ref ${terminalQuote(liveBindingAttachGrantRef)}`,
    `--grant-validation-ref ${terminalQuote(grantValidationRef)}`,
    `--surface-transport-ref ${terminalQuote(payload.surfaceTransportRef)}`,
    payload.adapterReadinessRef ? `--adapter-readiness-ref ${terminalQuote(payload.adapterReadinessRef)}` : undefined,
    payload.evidenceLedgerRef ? `--evidence-ledger-ref ${terminalQuote(payload.evidenceLedgerRef)}` : undefined,
    payload.guiPresentRefs?.[0] ? `--gui-present-ref ${terminalQuote(payload.guiPresentRefs[0])}` : undefined,
  ].filter(Boolean);
  return {
    commandText: parts.join(' '),
    label: 'Reconnect VirtualAppScreen',
    targetRef: payload.providerSessionReconnectRef,
    commandKey: `${payload.providerSessionReconnectRef}:${liveBindingAttachGrantRef}:${grantValidationRef}:${payload.currentFrameRef}:${Math.round(payload.currentFrameSequence.sequence)}`,
  };
}

function rightPaneVirtualScreenPermissionRecheckCommand(payload: VirtualScreenPayload): RightPaneVirtualScreenActivationCommand | undefined {
  if (!rightPaneVirtualScreenPermissionRecheckReady(payload)) return undefined;
  const permissionRecheckRef = payload.permissionRecheckRef ?? payload.permissionRecheckRefs?.[0] ?? payload.recheckRef;
  if (!permissionRecheckRef || !payload.adapterReadinessRef) return undefined;
  if (payload.attachState !== 'blocked' && payload.attachState !== 'requires-handoff' && payload.status !== 'blocked' && payload.status !== 'requires-handoff') return undefined;
  const parts = [
    '/computer-use permission-recheck',
    '--source right-pane-screen',
    `--target-ref ${terminalQuote(permissionRecheckRef)}`,
    `--adapter-readiness-ref ${terminalQuote(payload.adapterReadinessRef)}`,
    payload.permissionRef ? `--permission-ref ${terminalQuote(payload.permissionRef)}` : undefined,
    payload.platformDriverRef ? `--platform-driver-ref ${terminalQuote(payload.platformDriverRef)}` : undefined,
    ...rightPaneVirtualScreenPreflightCommandParts(payload),
    payload.screenRef ? `--screen-ref ${terminalQuote(payload.screenRef)}` : undefined,
    payload.sessionRef ? `--session-ref ${terminalQuote(payload.sessionRef)}` : undefined,
    payload.targetAppRef ? `--target-app-ref ${terminalQuote(payload.targetAppRef)}` : undefined,
    payload.blockedRef ? `--blocked-ref ${terminalQuote(payload.blockedRef)}` : undefined,
    payload.evidenceLedgerRef ? `--evidence-ledger-ref ${terminalQuote(payload.evidenceLedgerRef)}` : undefined,
    payload.guiPresentRefs?.[0] ? `--gui-present-ref ${terminalQuote(payload.guiPresentRefs[0])}` : undefined,
  ].filter(Boolean);
  return {
    commandText: parts.join(' '),
    label: 'Recheck Screen Permissions',
    targetRef: permissionRecheckRef,
    commandKey: `${permissionRecheckRef}:${payload.adapterReadinessRef}:permission-ready`,
  };
}

function rightPaneVirtualScreenPermissionHandoffCommand(payload: VirtualScreenPayload): RightPaneVirtualScreenActivationCommand | undefined {
  if (!rightPaneVirtualScreenAuthorizationIncomplete(payload)) return undefined;
  const permissionHandoffRef = payload.permissionHandoffRef ?? payload.permissionHandoffRefs?.[0] ?? payload.handoffRef ?? payload.blockedRef;
  const permissionRecheckRef = payload.permissionRecheckRef ?? payload.permissionRecheckRefs?.[0] ?? payload.recheckRef;
  if (!permissionHandoffRef || !payload.adapterReadinessRef) return undefined;
  if (payload.attachState !== 'blocked' && payload.attachState !== 'requires-handoff' && payload.status !== 'blocked' && payload.status !== 'requires-handoff') return undefined;
  const parts = [
    '/computer-use permission-handoff',
    '--source right-pane-screen',
    `--target-ref ${terminalQuote(permissionHandoffRef)}`,
    payload.permissionRef ? `--permission-ref ${terminalQuote(payload.permissionRef)}` : undefined,
    permissionRecheckRef ? `--recheck-ref ${terminalQuote(permissionRecheckRef)}` : undefined,
    `--provider-readiness-ref ${terminalQuote(payload.adapterReadinessRef)}`,
    payload.platformDriverRef ? `--platform-driver-ref ${terminalQuote(payload.platformDriverRef)}` : undefined,
    ...rightPaneVirtualScreenPreflightCommandParts(payload),
    payload.screenRef ? `--screen-ref ${terminalQuote(payload.screenRef)}` : undefined,
    payload.sessionRef ? `--session-ref ${terminalQuote(payload.sessionRef)}` : undefined,
    payload.targetAppRef ? `--target-app-ref ${terminalQuote(payload.targetAppRef)}` : undefined,
    payload.blockedRef ? `--blocked-ref ${terminalQuote(payload.blockedRef)}` : undefined,
    payload.evidenceLedgerRef ? `--evidence-ledger-ref ${terminalQuote(payload.evidenceLedgerRef)}` : undefined,
    payload.guiPresentRefs?.[0] ? `--gui-present-ref ${terminalQuote(payload.guiPresentRefs[0])}` : undefined,
  ].filter(Boolean);
  return {
    commandText: parts.join(' '),
    label: 'Resolve Screen Permissions',
    targetRef: permissionHandoffRef,
    commandKey: `${permissionHandoffRef}:${permissionRecheckRef ?? payload.adapterReadinessRef}`,
  };
}

function rightPaneVirtualScreenAuthorizationIncomplete(payload: VirtualScreenPayload) {
  return Boolean(
    (payload.permissionRequired === true && payload.permissionGranted !== true)
    || payload.permissionGranted === false
    || isBlockedGateStatus(payload.permissionStatus)
    || isBlockedGateStatus(payload.platformDriverStatus)
    || payload.permissionHandoffRef
    || (payload.permissionHandoffRefs?.length ?? 0),
  );
}

function isBlockedGateStatus(value: string | undefined) {
  return /^(blocked|denied|disabled|error|failed|missing|not-granted|not-installed|revoked|unavailable)$/i.test(value?.trim() ?? '');
}

function rightPaneVirtualScreenPermissionRecheckReady(payload: VirtualScreenPayload) {
  return Boolean(
    rightPaneVirtualScreenPermissionReady(payload)
    && rightPaneVirtualScreenPlatformDriverReady(payload)
    && payload.adapterReadinessRef,
  );
}

function rightPaneVirtualScreenPermissionReady(payload: VirtualScreenPayload) {
  if (payload.permissionGranted === true) return true;
  if (payload.permissionRequired === false && !isBlockedGateStatus(payload.permissionStatus)) return true;
  return isReadyGateStatus(payload.permissionStatus);
}

function rightPaneVirtualScreenPlatformDriverReady(payload: VirtualScreenPayload) {
  if (!payload.platformDriverRef && !payload.platformDriverStatus) return true;
  return isReadyGateStatus(payload.platformDriverStatus);
}

function isReadyGateStatus(value: string | undefined) {
  return /^(attached|available|granted|not-required|ready|running)$/i.test(value?.trim() ?? '');
}

function rightPaneVirtualScreenPreflightCommandParts(payload: VirtualScreenPayload) {
  const refs = [
    ['preflight-ref', payload.preflightRef],
    ['preflight-ledger-ref', payload.preflightLedgerRef],
    ['preflight-ledger-entry-ref', payload.preflightLedgerEntryRef],
    ['host-readiness-ref', payload.hostReadinessRef],
  ] as const;
  return refs.flatMap(([option, ref]) =>
    ref && rightPaneNativeHostPreflightRef(ref)
      ? [`--${option} ${terminalQuote(ref)}`]
      : []);
}

function terminalQuote(value: string) {
  return JSON.stringify(value);
}

function profileFromTargetAppRef(targetAppRef: string) {
  const profile = targetAppRef.split('/').filter(Boolean).at(-1);
  return profile || 'vscode-editor';
}

function virtualScreenStringProp(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function rightPaneNativeHostProductRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ref = value.trim();
  if (!ref.startsWith('computer-use:native-host/')) return false;
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
  ) return false;
  return !/[\r\n]/.test(ref);
}

function rightPaneNativeHostPreflightRef(value: unknown): value is string {
  return rightPaneNativeHostProductRef(value)
    && value.trim().startsWith('computer-use:native-host/preflights/');
}
