import { useEffect, useRef, type RefObject } from 'react';
import {
  renderVirtualScreenViewer,
  type VirtualScreenPayload,
} from '../../../../../packages/presentation/components';
import type { RuntimeArtifact, SciForgeConfig, SciForgeRun, SciForgeSession } from '../../domain';
import { resultText, type ResultLocale } from './resultLocale';
import { rightPaneVirtualScreenPayload } from './screenPaneModel';

export interface RightPaneVirtualScreenCommandEvent {
  commandText: string;
  label: string;
  targetRef?: string;
}

export type RightPaneVirtualScreenSlotProps = Record<string, unknown> & VirtualScreenPayload & {
  onTerminalEquivalentText: (event: RightPaneVirtualScreenCommandEvent) => void;
};

export interface RightPaneVirtualScreenSlot {
  componentId: 'virtual-screen-viewer';
  title: string;
  props: RightPaneVirtualScreenSlotProps;
}

export interface RightPaneVirtualScreenHostPresentationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RightPaneVirtualScreenHostPresentationBinding {
  sessionRef: string;
  hostSessionRef?: string;
  surfaceOwnerRef?: string;
  displayOwnerRef?: string;
  screenRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  providerSessionOwnerRef: string;
  providerSessionReconnectRef: string;
  liveBindingAttachGrantRef: string;
  liveBindingAttachGrantStatus: string;
  grantValidationRef: string;
  grantValidationStatus: string;
  surfaceTransportRef: string;
  surfaceTransport?: VirtualScreenPayload['surfaceTransport'];
  currentFrameSequence: NonNullable<VirtualScreenPayload['currentFrameSequence']>;
  platformDriverRef: string;
  platformDriverStatus: string;
  evidenceLedgerRef: string;
  providerExecuted?: true;
  providerSessionRevalidated?: true;
  surfaceTransportDescriptor: RightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor;
}

interface RightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor {
  schemaVersion?: string;
  owner: 'VirtualDisplayProvider';
  providerId?: string;
  transport?: string;
  surfaceTransportRef: string;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  frameTransportContractRef?: string;
  frameTelemetryRef?: string;
  mediaChannelRef?: string;
  dataChannelRef?: string;
  currentFrameSequence: number;
  diagnosticOnly: false;
  productFallback: false;
  singleInteractiveTruth: true;
}

type RightPaneVirtualScreenHostPresentationPresenterBinding = Omit<
  RightPaneVirtualScreenHostPresentationBinding,
  'screenRef' | 'providerSessionOwnerRef' | 'providerSessionReconnectRef' | 'providerExecuted' | 'providerSessionRevalidated'
>;

export interface RightPaneVirtualScreenHostPresentationAttachRequest extends RightPaneVirtualScreenHostPresentationPresenterBinding {
  kind: 'right-pane-virtual-app-screen-surface';
  bounds: RightPaneVirtualScreenHostPresentationBounds;
  visible: true;
  focus: boolean;
}

export interface RightPaneVirtualScreenHostPresentationDetachRequest extends RightPaneVirtualScreenHostPresentationPresenterBinding {
  kind: 'right-pane-virtual-app-screen-surface';
  visible: false;
}

export type RightPaneVirtualScreenHostPresentationBridgeRequest =
  | RightPaneVirtualScreenHostPresentationAttachRequest
  | RightPaneVirtualScreenHostPresentationDetachRequest;

export interface RightPaneVirtualScreenHostPresentationBridge {
  attachVirtualAppScreenSurface?: (input: RightPaneVirtualScreenHostPresentationBridgeRequest) => Promise<unknown> | unknown;
  presentVirtualAppScreenSurface?: (input: RightPaneVirtualScreenHostPresentationBridgeRequest) => Promise<unknown> | unknown;
  detachVirtualAppScreenSurface?: (input: RightPaneVirtualScreenHostPresentationDetachRequest) => Promise<unknown> | unknown;
}

export function rightPaneVirtualScreenSlot({
  payload,
  locale,
  onCommandRequest,
}: {
  payload: VirtualScreenPayload;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
}): RightPaneVirtualScreenSlot {
  const props = {
    ...(payload as Record<string, unknown>),
    onTerminalEquivalentText: (event: RightPaneVirtualScreenCommandEvent) => {
      onCommandRequest(event.commandText, event.label, event.targetRef);
    },
  } as RightPaneVirtualScreenSlotProps;
  return {
    componentId: 'virtual-screen-viewer',
    title: resultText(locale, { 'zh-CN': '虚拟屏幕', 'en-US': 'Virtual Screen' }),
    props,
  };
}

export function rightPaneVirtualScreenArtifact(payload: VirtualScreenPayload): RuntimeArtifact {
  return {
    id: 'right-pane-virtual-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: payload,
  };
}

export function RightPaneVirtualScreenTool({
  config,
  session,
  activeRun,
  activeTabId,
  payload: providedPayload,
  locale,
  onCommandRequest,
  hostPresentationBridge,
}: {
  config: SciForgeConfig;
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  activeTabId?: string;
  payload?: VirtualScreenPayload;
  locale?: ResultLocale;
  onCommandRequest: (commandText: string, label?: string, targetRef?: string) => void;
  hostPresentationBridge?: RightPaneVirtualScreenHostPresentationBridge;
}) {
  const payload = providedPayload ?? rightPaneVirtualScreenPayload(session, activeRun, config, locale, { activeTabId });
  const hostSurfaceRef = useRef<HTMLDivElement | null>(null);
  const attachedPresentationKeyRef = useRef<string | undefined>(undefined);

  useRightPaneVirtualScreenHostPresentation({
    payload,
    hostSurfaceRef,
    attachedPresentationKeyRef,
    hostPresentationBridge,
  });

  return (
    <div
      ref={hostSurfaceRef}
      className="right-pane-package-surface right-pane-virtual-screen-surface"
      data-testid="right-pane-virtual-screen-tool"
      data-host-presentation-boundary="virtual-app-screen-ref-bridge"
      data-host-presentation-ready={rightPaneVirtualScreenHostPresentationBinding(payload) ? 'true' : 'false'}
    >
      {renderVirtualScreenViewer({
        slot: rightPaneVirtualScreenSlot({ payload, locale, onCommandRequest }),
        artifact: rightPaneVirtualScreenArtifact(payload),
        config,
        session,
      })}
    </div>
  );
}

export function rightPaneVirtualScreenHostPresentationAttachRequest(
  payload: VirtualScreenPayload,
  bounds: RightPaneVirtualScreenHostPresentationBounds,
  focus = false,
): RightPaneVirtualScreenHostPresentationAttachRequest | undefined {
  const binding = rightPaneVirtualScreenHostPresentationBinding(payload);
  const normalizedBounds = rightPaneVirtualScreenHostPresentationBounds(bounds);
  if (!binding || !normalizedBounds) return undefined;
  return {
    kind: 'right-pane-virtual-app-screen-surface',
    ...rightPaneVirtualScreenHostPresentationPresenterBinding(binding),
    bounds: normalizedBounds,
    visible: true,
    focus,
  };
}

function useRightPaneVirtualScreenHostPresentation({
  payload,
  hostSurfaceRef,
  attachedPresentationKeyRef,
  hostPresentationBridge,
}: {
  payload: VirtualScreenPayload;
  hostSurfaceRef: RefObject<HTMLDivElement | null>;
  attachedPresentationKeyRef: RefObject<string | undefined>;
  hostPresentationBridge?: RightPaneVirtualScreenHostPresentationBridge;
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bridge = hostPresentationBridge ?? rightPaneVirtualScreenHostPresentationBridge();
    const binding = rightPaneVirtualScreenHostPresentationBinding(payload);
    const present = bridge?.attachVirtualAppScreenSurface ?? bridge?.presentVirtualAppScreenSurface;
    if (!bridge || !binding || !present) return;

    let cancelled = false;
    const bindingKey = rightPaneVirtualScreenHostPresentationKey(binding);
    const syncPresentation = () => {
      if (cancelled) return;
      const target = rightPaneVirtualScreenHostPresentationElement(hostSurfaceRef.current);
      const bounds = target ? rightPaneVirtualScreenHostPresentationBoundsFromElement(target) : undefined;
      if (!bounds) return;
      const request = rightPaneVirtualScreenHostPresentationAttachRequest(payload, bounds, attachedPresentationKeyRef.current !== bindingKey);
      if (!request) return;
      attachedPresentationKeyRef.current = bindingKey;
      void Promise.resolve(present(request)).catch(() => undefined);
    };

    const timer = window.setTimeout(syncPresentation, 0);
    const initialTarget = rightPaneVirtualScreenHostPresentationElement(hostSurfaceRef.current);
    const observer = initialTarget && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(syncPresentation)
      : undefined;
    if (initialTarget) observer?.observe(initialTarget);
    window.addEventListener('resize', syncPresentation);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', syncPresentation);
      detachRightPaneVirtualScreenHostPresentation(bridge, binding);
      if (attachedPresentationKeyRef.current === bindingKey) attachedPresentationKeyRef.current = undefined;
    };
  }, [
    attachedPresentationKeyRef,
    hostPresentationBridge,
    hostSurfaceRef,
    payload.attachState,
    payload.currentFrameRef,
    payload.frameStreamRef,
    payload.liveSurfaceRef,
    payload.platformDriverRef,
    payload.platformDriverStatus,
    payload.providerSessionOwnerRef,
    payload.providerSessionReconnectRef,
    (payload as Record<string, unknown>).liveBindingAttachGrantRef,
    (payload as Record<string, unknown>).liveBindingAttachGrantStatus,
    (payload as Record<string, unknown>).grantValidationRef,
    (payload as Record<string, unknown>).grantValidationStatus,
    (payload as Record<string, unknown>).providerSessionRevalidated,
    payload.screenRef,
    payload.sessionRef,
    payload.surfaceMode,
    payload.surfaceTransport,
    payload.surfaceTransportRef,
    payload.evidenceLedgerRef,
    payload.permissionGranted,
    payload.permissionRequired,
    payload.permissionStatus,
    (payload as Record<string, unknown>).providerExecuted,
    JSON.stringify((payload as Record<string, unknown>).surfaceTransportDescriptor),
    payload.currentFrameSequence?.diagnosticOnly,
    payload.currentFrameSequence?.label,
    payload.currentFrameSequence?.ref,
    payload.currentFrameSequence?.sequence,
    payload.currentFrameSequence?.status,
    payload.currentFrameSequence?.transport,
  ]);
}

function detachRightPaneVirtualScreenHostPresentation(
  bridge: RightPaneVirtualScreenHostPresentationBridge,
  binding: RightPaneVirtualScreenHostPresentationBinding,
) {
  const request: RightPaneVirtualScreenHostPresentationDetachRequest = {
    kind: 'right-pane-virtual-app-screen-surface',
    ...rightPaneVirtualScreenHostPresentationPresenterBinding(binding),
    visible: false,
  };
  if (bridge.detachVirtualAppScreenSurface) {
    void Promise.resolve(bridge.detachVirtualAppScreenSurface(request)).catch(() => undefined);
    return;
  }
  const present = bridge.attachVirtualAppScreenSurface ?? bridge.presentVirtualAppScreenSurface;
  if (!present) return;
  void Promise.resolve(present(request)).catch(() => undefined);
}

function rightPaneVirtualScreenHostPresentationBinding(payload: VirtualScreenPayload): RightPaneVirtualScreenHostPresentationBinding | undefined {
  if (payload.surfaceMode !== 'live') return undefined;
  if (payload.attachState !== 'attached') return undefined;
  if (rightPaneVirtualScreenHostPresentationBlocked(payload)) return undefined;
  if (!rightPaneVirtualScreenHostPresentationPermissionReady(payload)) return undefined;
  if (!rightPaneVirtualScreenHostPresentationPlatformDriverReady(payload)) return undefined;
  if (!rightPaneVirtualScreenHostPresentationCompleteIsolation(payload.isolationFlags)) return undefined;
  const sessionRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.sessionRef);
  const explicitHostSessionRef = rightPaneVirtualScreenHostPresentationNativeHostRef(virtualScreenStringProp(payload, 'hostSessionRef'));
  const surfaceOwnerRef = rightPaneVirtualScreenHostPresentationNativeHostRef(virtualScreenStringProp(payload, 'surfaceOwnerRef'));
  const displayOwnerRef = rightPaneVirtualScreenHostPresentationNativeHostRef(virtualScreenStringProp(payload, 'displayOwnerRef'));
  const screenRef = rightPaneVirtualScreenHostPresentationRef(payload.screenRef);
  const liveSurfaceRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.liveSurfaceRef);
  const frameStreamRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.frameStreamRef);
  const currentFrameRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.currentFrameRef);
  const providerSessionOwnerRef = rightPaneVirtualScreenHostPresentationRef(payload.providerSessionOwnerRef);
  const providerSessionReconnectRef = rightPaneVirtualScreenHostPresentationRef(payload.providerSessionReconnectRef);
  const liveBindingAttachGrantRef = rightPaneVirtualScreenHostPresentationNativeHostRef(virtualScreenStringProp(payload, 'liveBindingAttachGrantRef'));
  const liveBindingAttachGrantStatus = rightPaneVirtualScreenHostPresentationText(virtualScreenStringProp(payload, 'liveBindingAttachGrantStatus'));
  const grantValidationRef = rightPaneVirtualScreenHostPresentationNativeHostRef(virtualScreenStringProp(payload, 'grantValidationRef'));
  const grantValidationStatus = rightPaneVirtualScreenHostPresentationText(virtualScreenStringProp(payload, 'grantValidationStatus'));
  const surfaceTransportRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.surfaceTransportRef);
  const surfaceTransport = rightPaneVirtualScreenHostPresentationSurfaceTransport(payload.surfaceTransport);
  const currentFrameSequence = rightPaneVirtualScreenHostPresentationCurrentFrameSequence(payload.currentFrameSequence);
  const platformDriverRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.platformDriverRef);
  const platformDriverStatus = rightPaneVirtualScreenHostPresentationText(payload.platformDriverStatus);
  const evidenceLedgerRef = rightPaneVirtualScreenHostPresentationNativeHostRef(payload.evidenceLedgerRef);
  const providerExecuted = rightPaneVirtualScreenHostPresentationProviderExecuted(payload);
  const providerSessionRevalidated = rightPaneVirtualScreenHostPresentationProviderSessionRevalidated(payload);
  const surfaceTransportDescriptor = rightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor(payload);
  if (
    !sessionRef
    || !screenRef
    || !liveSurfaceRef
    || !frameStreamRef
    || !currentFrameRef
    || !providerSessionOwnerRef
    || !providerSessionReconnectRef
    || !liveBindingAttachGrantRef
    || !grantValidationRef
    || !rightPaneVirtualScreenHostPresentationLiveBindingGrantValidated({ liveBindingAttachGrantStatus, grantValidationStatus })
    || !surfaceTransportRef
    || !surfaceTransport
    || !currentFrameSequence
    || !platformDriverRef
    || !platformDriverStatus
    || !evidenceLedgerRef
    || (!providerExecuted && !providerSessionRevalidated)
    || !surfaceTransportDescriptor
  ) return undefined;
  if (!rightPaneVirtualScreenHostPresentationSurfaceTransportDescriptorMatches({
    surfaceTransportDescriptor,
    liveSurfaceRef,
    frameStreamRef,
    currentFrameRef,
    surfaceTransportRef,
    surfaceTransport,
    currentFrameSequence,
  })) return undefined;
  return {
    sessionRef,
    ...(explicitHostSessionRef ? { hostSessionRef: explicitHostSessionRef } : {}),
    ...(surfaceOwnerRef ? { surfaceOwnerRef } : {}),
    ...(displayOwnerRef ? { displayOwnerRef } : {}),
    screenRef,
    liveSurfaceRef,
    frameStreamRef,
    currentFrameRef,
    providerSessionOwnerRef,
    providerSessionReconnectRef,
    liveBindingAttachGrantRef,
    liveBindingAttachGrantStatus: liveBindingAttachGrantStatus ?? 'validated',
    grantValidationRef,
    grantValidationStatus: grantValidationStatus ?? 'validated',
    surfaceTransportRef,
    surfaceTransport,
    currentFrameSequence,
    platformDriverRef,
    platformDriverStatus,
    evidenceLedgerRef,
    ...(providerExecuted ? { providerExecuted } : {}),
    ...(providerSessionRevalidated ? { providerSessionRevalidated } : {}),
    surfaceTransportDescriptor,
  };
}

function rightPaneVirtualScreenHostPresentationBridge(): RightPaneVirtualScreenHostPresentationBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const desktopBridge = (window as Window & { sciforgeDesktop?: RightPaneVirtualScreenHostPresentationBridge }).sciforgeDesktop;
  const providerBridge = (window as Window & { sciforgeVirtualAppScreen?: RightPaneVirtualScreenHostPresentationBridge }).sciforgeVirtualAppScreen;
  return providerBridge ?? desktopBridge;
}

function rightPaneVirtualScreenHostPresentationPresenterBinding(
  binding: RightPaneVirtualScreenHostPresentationBinding,
): RightPaneVirtualScreenHostPresentationPresenterBinding {
  return {
    sessionRef: binding.sessionRef,
    ...(binding.hostSessionRef ? { hostSessionRef: binding.hostSessionRef } : {}),
    ...(binding.surfaceOwnerRef ? { surfaceOwnerRef: binding.surfaceOwnerRef } : {}),
    ...(binding.displayOwnerRef ? { displayOwnerRef: binding.displayOwnerRef } : {}),
    liveSurfaceRef: binding.liveSurfaceRef,
    frameStreamRef: binding.frameStreamRef,
    currentFrameRef: binding.currentFrameRef,
    liveBindingAttachGrantRef: binding.liveBindingAttachGrantRef,
    liveBindingAttachGrantStatus: binding.liveBindingAttachGrantStatus,
    grantValidationRef: binding.grantValidationRef,
    grantValidationStatus: binding.grantValidationStatus,
    surfaceTransportRef: binding.surfaceTransportRef,
    ...(binding.surfaceTransport ? { surfaceTransport: binding.surfaceTransport } : {}),
    currentFrameSequence: binding.currentFrameSequence,
    platformDriverRef: binding.platformDriverRef,
    platformDriverStatus: binding.platformDriverStatus,
    evidenceLedgerRef: binding.evidenceLedgerRef,
    surfaceTransportDescriptor: binding.surfaceTransportDescriptor,
  };
}

function rightPaneVirtualScreenHostPresentationElement(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('.virtual-screen-frame[data-live-surface-ref]') ?? null;
}

function rightPaneVirtualScreenHostPresentationBoundsFromElement(element: HTMLElement): RightPaneVirtualScreenHostPresentationBounds | undefined {
  const rect = element.getBoundingClientRect();
  return rightPaneVirtualScreenHostPresentationBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

function rightPaneVirtualScreenHostPresentationBounds(bounds: RightPaneVirtualScreenHostPresentationBounds | undefined): RightPaneVirtualScreenHostPresentationBounds | undefined {
  if (!bounds) return undefined;
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return undefined;
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function rightPaneVirtualScreenHostPresentationRef(value: string | undefined) {
  const ref = value?.trim();
  if (!ref || rightPaneVirtualScreenHostPresentationUnsafeRef(ref)) return undefined;
  return ref;
}

function rightPaneVirtualScreenHostPresentationNativeHostRef(value: string | undefined) {
  const ref = rightPaneVirtualScreenHostPresentationRef(value);
  if (!ref || !ref.startsWith('computer-use:native-host/')) return undefined;
  if (rightPaneVirtualScreenHostPresentationNonProductRef(ref)) return undefined;
  return ref;
}

function rightPaneVirtualScreenHostPresentationCurrentFrameSequence(
  value: VirtualScreenPayload['currentFrameSequence'] | undefined,
): NonNullable<VirtualScreenPayload['currentFrameSequence']> | undefined {
  const ref = rightPaneVirtualScreenHostPresentationNativeHostRef(value?.ref);
  if (!ref) return undefined;
  const sequence = typeof value?.sequence === 'number' && Number.isFinite(value.sequence) && value.sequence >= 0
    ? value.sequence
    : undefined;
  if (sequence === undefined) return undefined;
  return stripUndefined({
    ref,
    label: rightPaneVirtualScreenHostPresentationText(value?.label),
    status: rightPaneVirtualScreenHostPresentationText(value?.status),
    transport: rightPaneVirtualScreenHostPresentationText(value?.transport),
    diagnosticOnly: typeof value?.diagnosticOnly === 'boolean' ? value.diagnosticOnly : undefined,
    sequence,
  });
}

function rightPaneVirtualScreenHostPresentationText(value: string | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function rightPaneVirtualScreenHostPresentationUnsafeRef(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('data:')
    || normalized.startsWith('javascript:')
    || normalized.startsWith('file:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('//')
    || normalized.startsWith('/')
    || normalized.includes(';base64,')
    || /authorization|bearer|api[_-]?key|password|secret|token/i.test(normalized)
  );
}

function rightPaneVirtualScreenHostPresentationNonProductRef(value: string) {
  return /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|replay|snapshot|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/i.test(value);
}

function rightPaneVirtualScreenHostPresentationSurfaceTransport(value: VirtualScreenPayload['surfaceTransport'] | undefined): VirtualScreenPayload['surfaceTransport'] | undefined {
  if (!value) return undefined;
  return value === 'native-frame-stream' || value === 'webrtc' ? value : undefined;
}

function rightPaneVirtualScreenHostPresentationBlocked(payload: Pick<VirtualScreenPayload, 'permissionGranted' | 'permissionStatus' | 'sharedInputAllowed' | 'isolationFlags'>) {
  return Boolean(
    payload.permissionGranted === false
    || rightPaneVirtualScreenHostPresentationBlockedStatus(payload.permissionStatus)
    || payload.sharedInputAllowed === true
    || rightPaneVirtualScreenHostPresentationUnsafeIsolation(payload.isolationFlags)
  );
}

function rightPaneVirtualScreenHostPresentationPermissionReady(payload: Pick<VirtualScreenPayload, 'permissionGranted' | 'permissionStatus'>) {
  return payload.permissionGranted === true || rightPaneVirtualScreenHostPresentationReadyStatus(payload.permissionStatus);
}

function rightPaneVirtualScreenHostPresentationPlatformDriverReady(payload: Pick<VirtualScreenPayload, 'platformDriverRef' | 'platformDriverStatus'>) {
  return Boolean(
    rightPaneVirtualScreenHostPresentationNativeHostRef(payload.platformDriverRef)
    && rightPaneVirtualScreenHostPresentationReadyStatus(payload.platformDriverStatus)
  );
}

function rightPaneVirtualScreenHostPresentationCompleteIsolation(isolation: VirtualScreenPayload['isolationFlags']) {
  return Boolean(
    isolation?.backgroundRenderable === true
    && isolation.affectsPhysicalDisplay === false
    && isolation.requiresFocusSteal === false
    && isolation.sharedSystemInputUsed === false
    && isolation.systemPointerMoved === false
    && isolation.systemKeyboardEventsSent === false
    && isolation.singleInteractiveTruth === true
    && isolation.secondInteractiveSurfacePresent === false
    && isolation.diagnosticOnly === false
  );
}

function rightPaneVirtualScreenHostPresentationUnsafeIsolation(isolation: VirtualScreenPayload['isolationFlags']) {
  return Boolean(
    isolation?.affectsPhysicalDisplay === true
    || isolation?.requiresFocusSteal === true
    || isolation?.sharedSystemInputUsed === true
    || isolation?.systemPointerMoved === true
    || isolation?.systemKeyboardEventsSent === true
    || isolation?.singleInteractiveTruth === false
    || isolation?.secondInteractiveSurfacePresent === true
    || isolation?.diagnosticOnly === true
  );
}

function rightPaneVirtualScreenHostPresentationReadyStatus(value: string | undefined) {
  return Boolean(value && /^(attached|available|granted|not-required|ready|running)$/i.test(value.trim()));
}

function rightPaneVirtualScreenHostPresentationLiveBindingGrantValidated(value: {
  liveBindingAttachGrantStatus: string | undefined;
  grantValidationStatus: string | undefined;
}) {
  return Boolean(
    rightPaneVirtualScreenHostPresentationReadyStatus(value.liveBindingAttachGrantStatus)
    || rightPaneVirtualScreenHostPresentationReadyStatus(value.grantValidationStatus)
    || /^(?:valid|validated)$/i.test(value.liveBindingAttachGrantStatus?.trim() ?? '')
    || /^(?:valid|validated)$/i.test(value.grantValidationStatus?.trim() ?? ''),
  );
}

function rightPaneVirtualScreenHostPresentationBlockedStatus(value: string | undefined) {
  return Boolean(value && /^(blocked|denied|disabled|error|failed|missing|not-granted|not-installed|revoked|unavailable)$/i.test(value.trim()));
}

function rightPaneVirtualScreenHostPresentationKey(binding: RightPaneVirtualScreenHostPresentationBinding) {
  return [
    binding.sessionRef,
    binding.screenRef,
    binding.liveSurfaceRef,
    binding.frameStreamRef,
    binding.providerSessionOwnerRef,
    binding.providerSessionReconnectRef,
    binding.liveBindingAttachGrantRef,
    binding.liveBindingAttachGrantStatus,
    binding.grantValidationRef,
    binding.grantValidationStatus,
    binding.surfaceTransportRef,
    binding.surfaceTransport ?? '',
    binding.platformDriverRef,
    binding.platformDriverStatus,
    binding.evidenceLedgerRef,
    String(binding.providerExecuted),
    String(binding.providerSessionRevalidated),
    binding.surfaceTransportDescriptor.owner,
    binding.surfaceTransportDescriptor.providerId ?? '',
    binding.surfaceTransportDescriptor.currentFrameRef,
    binding.surfaceTransportDescriptor.currentFrameSequence,
    binding.currentFrameSequence.diagnosticOnly === undefined ? '' : String(binding.currentFrameSequence.diagnosticOnly),
    binding.currentFrameSequence.label ?? '',
    binding.currentFrameSequence.ref,
    binding.currentFrameSequence.sequence ?? '',
    binding.currentFrameSequence.status ?? '',
    binding.currentFrameSequence.transport ?? '',
  ].join('|');
}

function rightPaneVirtualScreenHostPresentationProviderExecuted(payload: VirtualScreenPayload) {
  const record = payload as Record<string, unknown>;
  const isolation = payload.isolationFlags as Record<string, unknown> | undefined;
  return record.providerExecuted === true || isolation?.providerExecuted === true ? true : undefined;
}

function rightPaneVirtualScreenHostPresentationProviderSessionRevalidated(payload: VirtualScreenPayload) {
  const record = payload as Record<string, unknown>;
  return record.providerSessionRevalidated === true ? true : undefined;
}

function rightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor(
  payload: VirtualScreenPayload,
): RightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor | undefined {
  const descriptor = (payload as Record<string, unknown>).surfaceTransportDescriptor;
  if (!isRecord(descriptor)) return undefined;
  const currentFrameSequence = typeof descriptor.currentFrameSequence === 'number' && Number.isFinite(descriptor.currentFrameSequence) && descriptor.currentFrameSequence >= 0
    ? descriptor.currentFrameSequence
    : undefined;
  const normalized = {
    schemaVersion: rightPaneVirtualScreenHostPresentationTextValue(descriptor.schemaVersion),
    owner: rightPaneVirtualScreenHostPresentationTextValue(descriptor.owner),
    providerId: rightPaneVirtualScreenHostPresentationTextValue(descriptor.providerId),
    transport: rightPaneVirtualScreenHostPresentationTextValue(descriptor.transport),
    surfaceTransportRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.surfaceTransportRef),
    liveSurfaceRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.liveSurfaceRef),
    frameStreamRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.frameStreamRef),
    currentFrameRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.currentFrameRef),
    frameTransportContractRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.frameTransportContractRef),
    frameTelemetryRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.frameTelemetryRef),
    mediaChannelRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.mediaChannelRef),
    dataChannelRef: rightPaneVirtualScreenHostPresentationNativeHostRefValue(descriptor.dataChannelRef),
    currentFrameSequence,
    diagnosticOnly: descriptor.diagnosticOnly,
    productFallback: descriptor.productFallback,
    singleInteractiveTruth: descriptor.singleInteractiveTruth,
  };
  if (
    normalized.owner !== 'VirtualDisplayProvider'
    || !normalized.surfaceTransportRef
    || !normalized.liveSurfaceRef
    || !normalized.frameStreamRef
    || !normalized.currentFrameRef
    || normalized.currentFrameSequence === undefined
    || normalized.diagnosticOnly !== false
    || normalized.productFallback !== false
    || normalized.singleInteractiveTruth !== true
  ) return undefined;
  return stripUndefined(normalized) as RightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor;
}

function rightPaneVirtualScreenHostPresentationSurfaceTransportDescriptorMatches(options: {
  surfaceTransportDescriptor: RightPaneVirtualScreenHostPresentationSurfaceTransportDescriptor;
  liveSurfaceRef: string;
  frameStreamRef: string;
  currentFrameRef: string;
  surfaceTransportRef: string;
  surfaceTransport: NonNullable<VirtualScreenPayload['surfaceTransport']>;
  currentFrameSequence: NonNullable<VirtualScreenPayload['currentFrameSequence']>;
}) {
  return Boolean(
    options.surfaceTransportDescriptor.liveSurfaceRef === options.liveSurfaceRef
    && options.surfaceTransportDescriptor.frameStreamRef === options.frameStreamRef
    && options.surfaceTransportDescriptor.currentFrameRef === options.currentFrameRef
    && options.surfaceTransportDescriptor.surfaceTransportRef === options.surfaceTransportRef
    && (!options.surfaceTransportDescriptor.transport || options.surfaceTransportDescriptor.transport === options.surfaceTransport)
    && options.surfaceTransportDescriptor.currentFrameSequence === options.currentFrameSequence.sequence,
  );
}

function rightPaneVirtualScreenHostPresentationNativeHostRefValue(value: unknown) {
  return typeof value === 'string' ? rightPaneVirtualScreenHostPresentationNativeHostRef(value) : undefined;
}

function rightPaneVirtualScreenHostPresentationTextValue(value: unknown) {
  const text = typeof value === 'string' ? rightPaneVirtualScreenHostPresentationText(value) : undefined;
  if (!text || /authorization|bearer|api[_-]?key|password|secret|token/i.test(text)) return undefined;
  return text;
}

function virtualScreenStringProp(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
