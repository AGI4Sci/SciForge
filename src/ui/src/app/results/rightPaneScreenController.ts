import { useEffect, useMemo, useRef } from 'react';
import type { VirtualScreenPayload } from '../../../../../packages/presentation/components';
import type { SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import type { ResultPaneTab } from './ResultShell';
import { rightPaneVirtualScreenPayload } from './screenPaneModel';
import type { ResultLocale } from './resultLocale';

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

export function useRightPaneScreenController({
  config,
  session,
  activeRun,
  activeTabId,
  resultTab,
  locale,
  onCommandRequest,
}: UseRightPaneScreenControllerOptions): RightPaneScreenController {
  const payload = useMemo(() => rightPaneVirtualScreenPayload(session, activeRun, config, locale, { activeTabId }), [
    activeRun,
    activeTabId,
    config,
    locale,
    session,
  ]);
  const activationCommand = useMemo(() => rightPaneVirtualScreenActivationCommand(payload), [
    payload.adapterReadinessRef,
    payload.attachState,
    payload.evidenceLedgerRef,
    payload.frameStreamRef,
    payload.guiPresentRefs?.[0],
    payload.handoffRef,
    (payload as Record<string, unknown>).liveBindingAttachGrantRef,
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

export function rightPaneVirtualScreenActivationCommand(payload: VirtualScreenPayload): RightPaneVirtualScreenActivationCommand | undefined {
  const attachCommand = rightPaneVirtualScreenAttachCommand(payload);
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
  if (
    !payload.screenRef
    || !payload.liveSurfaceRef
    || !payload.frameStreamRef
    || !payload.currentFrameRef
    || typeof payload.currentFrameSequence?.sequence !== 'number'
    || !Number.isFinite(payload.currentFrameSequence.sequence)
    || payload.currentFrameSequence.sequence < 0
    || !payload.providerSessionOwnerRef
    || !payload.providerSessionReconnectRef
    || !liveBindingAttachGrantRef
    || !payload.surfaceTransportRef
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
    `--live-binding-attach-grant-ref ${terminalQuote(liveBindingAttachGrantRef)}`,
    `--surface-transport-ref ${terminalQuote(payload.surfaceTransportRef)}`,
    payload.adapterReadinessRef ? `--adapter-readiness-ref ${terminalQuote(payload.adapterReadinessRef)}` : undefined,
    payload.evidenceLedgerRef ? `--evidence-ledger-ref ${terminalQuote(payload.evidenceLedgerRef)}` : undefined,
    payload.guiPresentRefs?.[0] ? `--gui-present-ref ${terminalQuote(payload.guiPresentRefs[0])}` : undefined,
  ].filter(Boolean);
  return {
    commandText: parts.join(' '),
    label: 'Reconnect VirtualAppScreen',
    targetRef: payload.providerSessionReconnectRef,
    commandKey: `${payload.providerSessionReconnectRef}:${liveBindingAttachGrantRef}:${payload.currentFrameRef}:${Math.round(payload.currentFrameSequence.sequence)}`,
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
