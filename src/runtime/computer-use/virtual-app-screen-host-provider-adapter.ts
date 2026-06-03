import {
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  sha256,
  type NativeHostAppProfile,
  type NativeHostAutomationBarrier,
  type NativeHostAutomationIntent,
  type NativeHostAutomationResult,
  type NativeHostCapabilityFlags,
  type NativeHostFrame,
  type NativeHostHumanInputAccepted,
  type NativeHostHumanInputEvent,
  type NativeHostInputAdapterKind,
  type NativeHostLiveSurface,
  type NativeHostPermissionLedgerRequest,
  type NativeHostReadinessRecord,
  type NativeHostResult,
  type NativeHostSession,
  type NativeHostSurfaceTarget,
  type NativeHostSurfaceTransport,
  type NativeVirtualAppScreenHostDescription,
  type NativeVirtualAppScreenPlatformAdapter,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';
import { sanitizeId } from './utils.js';
import {
  isVirtualDisplayReadinessControllable,
  type VirtualDisplayProviderInputIntent,
  type VirtualDisplayInputAdapter,
  type VirtualDisplayPlatform,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderL1Contract,
  type VirtualDisplayProviderOperationOptions,
  type VirtualDisplayReadiness,
  type VirtualDisplayTransport,
} from './virtual-display-provider.js';

export interface VirtualDisplayProviderNativeHostLifecycle {
  probe: VirtualDisplayProviderInvokeResult;
  createSession: VirtualDisplayProviderInvokeResult;
  launchApp: VirtualDisplayProviderInvokeResult;
  attachSurface: VirtualDisplayProviderInvokeResult;
  readFrame: VirtualDisplayProviderInvokeResult;
}

export function createVirtualDisplayProviderNativeHostAdapter(options: {
  executorId: string;
  providerId: string;
  lifecycle: VirtualDisplayProviderNativeHostLifecycle;
  provider?: VirtualDisplayProviderL1Contract;
  operationOptions?: VirtualDisplayProviderOperationOptions;
}): NativeVirtualAppScreenPlatformAdapter {
  return new MaterializedVirtualDisplayProviderNativeHostAdapter(options);
}

class MaterializedVirtualDisplayProviderNativeHostAdapter implements NativeVirtualAppScreenPlatformAdapter {
  private readonly executorId: string;
  private readonly providerId: string;
  private readonly lifecycle: VirtualDisplayProviderNativeHostLifecycle;
  private readonly provider: VirtualDisplayProviderL1Contract | undefined;
  private readonly operationOptions: VirtualDisplayProviderOperationOptions | undefined;
  private surface: NativeHostLiveSurface | undefined;

  constructor(options: {
    executorId: string;
    providerId: string;
    lifecycle: VirtualDisplayProviderNativeHostLifecycle;
    provider?: VirtualDisplayProviderL1Contract;
    operationOptions?: VirtualDisplayProviderOperationOptions;
  }) {
    this.executorId = options.executorId;
    this.providerId = options.providerId;
    this.lifecycle = options.lifecycle;
    this.provider = options.provider;
    this.operationOptions = options.operationOptions;
  }

  describe(): NativeVirtualAppScreenHostDescription {
    const readiness = this.readiness();
    const capabilities = nativeHostCapabilities(readiness);
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      hostId: `native-virtual-app-screen-host.runtime.${sanitizeId(this.executorId)}`,
      platform: nativeHostPlatform(readiness?.platform),
      backendKind: readiness?.backendKind ?? readiness?.providerKind ?? 'virtual-display-provider-adapter',
      protocol: [...NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL],
      supportedApps: readiness?.appIdentity?.targetAppKind
        ? [`app:${String(readiness.appIdentity.targetAppKind)}`]
        : [],
      supportedTransports: nativeHostSupportedTransports(readiness),
      supportedInputAdapters: nativeHostInputAdapters(readiness),
      capabilities,
      permissionRefs: readiness?.permissionRefs ?? [],
      blockedReason: readiness?.blockedReason,
      diagnosticOnly: !isVirtualDisplayReadinessControllable(readiness),
      thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only',
    };
  }

  probe(): NativeHostReadinessRecord {
    const readiness = this.readiness();
    const description = this.describe();
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      status: nativeHostReadinessStatus(readiness),
      adapterKind: description.backendKind,
      platform: description.platform,
      checkedAt: new Date().toISOString(),
      adapterReadinessRef: stringRef(this.lifecycle.probe, 'adapterReadinessRef')
        ?? stringRef(this.lifecycle.createSession, 'adapterReadinessRef')
        ?? `computer-use:native-host/readiness/${sanitizeId(this.providerId)}.json`,
      permissionRefs: readiness?.permissionRefs ?? [],
      driverRefs: providerDriverRefs(this.providerId, readiness),
      providerRefs: uniqueRefs([
        `virtual-display-provider:${this.providerId}`,
        stringRef(this.lifecycle.probe, 'providerProbeRef'),
      ]),
      capabilities: description.capabilities,
      diagnosticOnly: description.diagnosticOnly,
      blockedReason: readiness?.blockedReason,
      handoffRef: readiness?.permissions.state === 'missing'
        ? `computer-use:native-host/handoff/${sanitizeId(this.providerId)}.json`
        : undefined,
      recheckRef: `computer-use:native-host/recheck/${sanitizeId(this.providerId)}.json`,
    };
  }

  async refreshReadiness(
    session: NativeHostSession,
    _request: NativeHostPermissionLedgerRequest = {},
  ): Promise<NativeHostResult<NativeHostReadinessRecord>> {
    if (!this.provider) {
      return nativeHostBlocked('provider-unavailable', 'Native Host provider adapter has no provider readiness refresher.', this.probe());
    }
    const runId = this.operationOptions?.runId ?? sanitizeId(session.evidenceContext.currentRunRef || session.sessionId);
    const providerResult = await this.provider.probe({
      ...(this.operationOptions ?? { runId }),
      runId,
    });
    this.lifecycle.probe = providerResult;
    if (providerResult.rawPayloadWritten !== false) {
      return nativeHostBlocked('unsafe-input', 'provider.probe returned an inline/raw provider payload.', this.probe());
    }
    if (!stringRef(providerResult, 'adapterReadinessRef')) {
      return nativeHostBlocked('missing-evidence', 'provider.probe did not return adapterReadinessRef evidence.', this.probe());
    }
    return { status: 'ok', value: this.probe() };
  }

  launchOrAttachApp(_session: NativeHostSession, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostAppProfile> {
    const targetAppRef = stringRef(this.lifecycle.launchApp, 'targetAppRef')
      ?? stringRef(this.lifecycle.createSession, 'targetAppRef')
      ?? appProfile.appRef;
    return {
      status: 'ok',
      value: {
        ...appProfile,
        appRef: targetAppRef,
        metadata: {
          ...(appProfile.metadata ?? {}),
          providerTargetAppRef: targetAppRef,
          providerLifecycleEventRef: stringRef(this.lifecycle.launchApp, 'lifecycleEventRef'),
        },
      },
    };
  }

  attachSurface(session: NativeHostSession, surfaceTarget: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface> {
    const scope = hostScope(session, surfaceTarget);
    const transport = nativeHostSurfaceTransport(
      this.lifecycle.attachSurface.surfaceTransport?.transport
        ?? this.readiness()?.selectedTransport
        ?? surfaceTarget.transport,
    );
    const surface: NativeHostLiveSurface = {
      surfaceId: surfaceTarget.surfaceId ?? scope,
      screenRef: surfaceTarget.screenRef,
      targetAppRef: session.app?.appRef ?? stringRef(this.lifecycle.launchApp, 'targetAppRef') ?? 'app:unknown',
      targetWindowRef: surfaceTarget.targetWindowRef,
      sessionRef: session.sessionRef,
      liveSurfaceRef: hostRef('surfaces', scope, 'live-surface.json'),
      liveBindingAttachGrantRef: hostRef('grants', scope, 'live-binding-attach-grant.json'),
      surfaceOwnerRef: hostRef('surfaces', scope, 'surface-owner.json'),
      displayOwnerRef: hostRef('surfaces', scope, 'display-owner.json'),
      surfaceTransport: transport,
      surfaceTransportRef: hostRef('surfaces', scope, 'surface-transport.json'),
      frameStreamRef: hostRef('surfaces', scope, 'frame-stream.json'),
      frameTransportContractRef: hostRef('surfaces', scope, 'frame-transport-contract.json'),
      frameTelemetryRef: hostRef('surfaces', scope, 'frame-telemetry.json'),
      mediaChannelRef: hostRef('surfaces', scope, `${transport === 'webrtc' ? 'webrtc-video-track' : 'native-frame-stream'}/live`),
      dataChannelRef: hostRef('surfaces', scope, `${transport === 'webrtc' ? 'webrtc-data-channel' : 'native-frame-control-channel'}/control`),
      currentFrameSequence: nonNegativeSequence(this.lifecycle.attachSurface)
        ?? nonNegativeSequence(this.lifecycle.readFrame)
        ?? 0,
    };
    this.surface = surface;
    return { status: 'ok', value: surface };
  }

  readFrame(session: NativeHostSession, cursor?: string): NativeHostResult<NativeHostFrame> {
    const surface = this.surface ?? session.surface;
    if (!surface) {
      return {
        status: 'blocked',
        error: {
          code: 'surface-not-attached',
          message: 'Native Host provider adapter cannot read a frame before attachSurface.',
        },
      };
    }
    const sequence = nonNegativeSequence(this.lifecycle.readFrame)
      ?? Math.max(0, surface.currentFrameSequence + 1);
    const frameRef = hostRef('frames', surface.surfaceId, `${String(sequence).padStart(4, '0')}.png`);
    return {
      status: 'ok',
      value: {
        frameRef,
        frameHash: sha256({
          cursor,
          providerId: this.providerId,
          providerFrameRef: stringRef(this.lifecycle.readFrame, 'currentFrameRef'),
          currentRunRef: stringRef(this.lifecycle.readFrame, 'currentRunRef'),
          liveSurfaceRef: surface.liveSurfaceRef,
          frameStreamRef: surface.frameStreamRef,
          frameSequence: sequence,
        }),
        frameSequence: sequence,
        liveSurfaceRef: surface.liveSurfaceRef,
        frameStreamRef: surface.frameStreamRef,
        readAt: new Date().toISOString(),
      },
    };
  }

  async sendHumanInput(
    session: NativeHostSession,
    inputEvent: NativeHostHumanInputEvent,
  ): Promise<NativeHostResult<NativeHostHumanInputAccepted>> {
    if (!this.provider) {
      return nativeHostBlocked('provider-unavailable', 'Native Host provider adapter has no provider input invoker.', this.probe());
    }
    const input = this.providerInputOperationOptions(session, {
      source: 'native-host-human-input',
      kind: inputEvent.kind,
      action: inputEvent,
      refs: {
        inputIntentRef: inputEvent.inputIntentRef,
      },
      ratios: humanInputRatios(inputEvent),
    });
    if (input.status === 'blocked') return input;

    const providerResult = await this.provider.sendInputIntent(input.value.operationOptions);
    const blocked = this.validateProviderInputResult(providerResult, input.value, 'sendInputIntent');
    if (blocked) return blocked;

    return {
      status: 'ok',
      value: {
        inputAcceptedRef: hostRef('provider-adapter-inputs', input.value.scope, `${sha256(stringListRef(providerResult, 'inputIntentRefs')).slice(0, 16)}.json`),
        inputSequence: input.value.inputSequence,
        acceptedAt: new Date().toISOString(),
        fireAndRelease: true,
        evidenceWillCatchUp: true,
        providerEvidenceRefs: providerEvidenceRefsFromInputResult(providerResult),
      },
    };
  }

  async executeAutomationIntent(
    session: NativeHostSession,
    intent: NativeHostAutomationIntent,
    barrier: NativeHostAutomationBarrier,
  ): Promise<NativeHostResult<NativeHostAutomationResult>> {
    if (!this.provider) {
      return nativeHostBlocked('provider-unavailable', 'Native Host provider adapter has no provider automation invoker.', this.probe());
    }
    if (barrier.requiredReadinessRef !== this.probe().adapterReadinessRef) {
      return nativeHostBlocked('automation-barrier-not-ready', 'Native Host provider adapter automation barrier does not match provider readiness.', this.probe());
    }
    const input = this.providerInputOperationOptions(session, {
      source: 'native-host-automation',
      kind: intent.kind,
      action: intent,
      refs: {
        automationIntentRef: intent.intentRef,
        automationBarrierRef: barrier.barrierRef,
        verifierRef: intent.verifierRef,
        hostBeforeFrameRef: intent.beforeFrameRef,
      },
    });
    if (input.status === 'blocked') return input;

    const providerResult = await this.provider.sendInputIntent(input.value.operationOptions);
    const blocked = this.validateProviderInputResult(providerResult, input.value, 'sendInputIntent');
    if (blocked) return blocked;

    return {
      status: 'ok',
      value: {
        automationBarrierRef: barrier.barrierRef,
        beforeFrameRef: intent.beforeFrameRef,
        afterFrameRef: hostRef('provider-adapter-automation', input.value.scope, 'after-frame.json'),
        verifierRef: intent.verifierRef ?? hostRef('provider-adapter-automation', input.value.scope, 'verifier.json'),
        evidenceLedgerRef: session.ledgerRef,
        completedAt: new Date().toISOString(),
      },
    };
  }

  async pauseAgent(session: NativeHostSession, reason: string): Promise<NativeHostResult<NativeHostSession>> {
    if (!this.provider) {
      return nativeHostBlocked('provider-unavailable', 'Native Host provider adapter has no provider pause invoker.', this.probe());
    }
    const controlKind = reason === 'takeover' || reason === 'pause-agent' ? reason : 'pause-agent';
    const input = this.providerInputOperationOptions(session, {
      source: 'native-host-control',
      kind: controlKind,
      controlKind,
      action: { type: controlKind, reason },
    });
    if (input.status === 'blocked') return input;

    const providerResult = await this.provider.pause(input.value.operationOptions);
    const blocked = this.validateProviderInputResult(providerResult, input.value, 'pause');
    if (blocked) return blocked;
    this.recordControlEvidence(session, input.value, providerResult, 'pause');
    return { status: 'ok', value: session };
  }

  async resumeAgent(
    session: NativeHostSession,
    barrier: NativeHostAutomationBarrier,
  ): Promise<NativeHostResult<NativeHostSession>> {
    if (!this.provider) {
      return nativeHostBlocked('provider-unavailable', 'Native Host provider adapter has no provider resume invoker.', this.probe());
    }
    if (barrier.requiredReadinessRef !== this.probe().adapterReadinessRef) {
      return nativeHostBlocked('automation-barrier-not-ready', 'Native Host provider adapter resume barrier does not match provider readiness.', this.probe());
    }
    const input = this.providerInputOperationOptions(session, {
      source: 'native-host-control',
      kind: 'resume-agent',
      controlKind: 'resume-agent',
      action: { type: 'resume-agent' },
      refs: {
        automationBarrierRef: barrier.barrierRef,
      },
    });
    if (input.status === 'blocked') return input;

    const providerResult = await this.provider.resume(input.value.operationOptions);
    const blocked = this.validateProviderInputResult(providerResult, input.value, 'resume');
    if (blocked) return blocked;
    const readFrame = await this.provider.readFrame(input.value.operationOptions);
    const readFrameBlocked = this.validateProviderControlReadFrame(readFrame, input.value, 'resume.readFrame');
    if (readFrameBlocked) return readFrameBlocked;
    this.lifecycle.readFrame = readFrame;
    this.recordControlEvidence(session, input.value, providerResult, 'resume', readFrame);
    return { status: 'ok', value: session };
  }

  async closeSession(session: NativeHostSession): Promise<NativeHostResult<NativeHostSession>> {
    if (!this.provider) {
      return nativeHostBlocked('provider-unavailable', 'Native Host provider adapter has no provider close invoker.', this.probe());
    }
    const input = this.providerInputOperationOptions(session, {
      source: 'native-host-control',
      kind: 'stop-session',
      controlKind: 'stop-session',
      action: { type: 'stop-session' },
    });
    if (input.status === 'blocked') return input;

    const providerResult = await this.provider.closeSession(input.value.operationOptions);
    const blocked = this.validateProviderInputResult(providerResult, input.value, 'closeSession');
    if (blocked) return blocked;
    this.recordControlEvidence(session, input.value, providerResult, 'closeSession');
    return { status: 'ok', value: session };
  }

  private readiness(): VirtualDisplayReadiness | undefined {
    return this.lifecycle.readFrame.readiness
      ?? this.lifecycle.attachSurface.readiness
      ?? this.lifecycle.launchApp.readiness
      ?? this.lifecycle.createSession.readiness
      ?? this.lifecycle.probe.readiness;
  }

  private providerInputOperationOptions(
    session: NativeHostSession,
    input: {
      source: string;
      kind: string;
      action: unknown;
      controlKind?: string;
      refs?: Record<string, unknown>;
      ratios?: Record<string, number>;
    },
  ): NativeHostResult<ProviderInputInvocation> {
    const surface = this.surface ?? session.surface;
    if (!surface) {
      return nativeHostBlocked('surface-not-attached', 'Native Host provider adapter cannot send input before attachSurface.', this.probe());
    }
    const providerSessionRef = stringRef(this.lifecycle.createSession, 'sessionRef')
      ?? stringRef(this.lifecycle.readFrame, 'sessionRef');
    if (!providerSessionRef) {
      return nativeHostBlocked('missing-evidence', 'Native Host provider adapter is missing provider lifecycle sessionRef.', this.probe());
    }
    const currentFrameRef = stringRef(this.lifecycle.readFrame, 'currentFrameRef')
      ?? stringRef(this.lifecycle.attachSurface, 'currentFrameRef');
    const inputLeaseRef = stringRef(this.lifecycle.readFrame, 'inputLeaseRef')
      ?? stringRef(this.lifecycle.attachSurface, 'inputLeaseRef');
    const actionAdapterRef = stringRef(this.lifecycle.readFrame, 'actionAdapterRef')
      ?? stringRef(this.lifecycle.attachSurface, 'actionAdapterRef');
    const adapterReadinessRef = session.readiness.adapterReadinessRef
      ?? stringRef(this.lifecycle.readFrame, 'adapterReadinessRef')
      ?? stringRef(this.lifecycle.attachSurface, 'adapterReadinessRef')
      ?? stringRef(this.lifecycle.createSession, 'adapterReadinessRef')
      ?? stringRef(this.lifecycle.probe, 'adapterReadinessRef')
      ?? this.probe().adapterReadinessRef;
    const evidenceLedgerRef = stringRef(this.lifecycle.readFrame, 'evidenceLedgerRef')
      ?? stringRef(this.lifecycle.attachSurface, 'evidenceLedgerRef')
      ?? stringRef(this.lifecycle.launchApp, 'evidenceLedgerRef')
      ?? stringRef(this.lifecycle.createSession, 'evidenceLedgerRef');
    if (!currentFrameRef || !inputLeaseRef || !actionAdapterRef || !adapterReadinessRef || !evidenceLedgerRef) {
      const missing = [
        currentFrameRef ? undefined : 'currentFrameRef',
        inputLeaseRef ? undefined : 'inputLeaseRef',
        actionAdapterRef ? undefined : 'actionAdapterRef',
        adapterReadinessRef ? undefined : 'adapterReadinessRef',
        evidenceLedgerRef ? undefined : 'evidenceLedgerRef',
      ].filter((entry): entry is string => Boolean(entry));
      return nativeHostBlocked(
        'missing-evidence',
        `Native Host provider adapter is missing input evidence refs: ${missing.join(', ')}.`,
        this.probe(),
      );
    }
    const runId = this.operationOptions?.runId ?? sanitizeId(session.evidenceContext.currentRunRef || session.sessionId);
    const scope = sanitizeId([this.providerId, session.sessionId, input.source, input.kind].join('-'));
    const inputIntent: VirtualDisplayProviderInputIntent = {
      source: input.source,
      kind: input.kind,
      action: input.action,
      controlKind: input.controlKind,
      refs: {
        sessionRef: providerSessionRef,
        screenRef: stringRef(this.lifecycle.createSession, 'screenRef') ?? surface.screenRef,
        targetAppRef: stringRef(this.lifecycle.launchApp, 'targetAppRef') ?? surface.targetAppRef,
        targetWindowRef: stringRef(this.lifecycle.launchApp, 'targetWindowRef')
          ?? stringRef(this.lifecycle.attachSurface, 'targetWindowRef')
          ?? surface.targetWindowRef,
        frameRef: currentFrameRef,
        inputLeaseRef,
        actionAdapterRef,
        adapterReadinessRef,
        evidenceLedgerRef,
        hostSessionRef: session.sessionRef,
        hostFrameRef: surface.currentFrameRef,
        hostLiveSurfaceRef: surface.liveSurfaceRef,
        ...input.refs,
      },
      ratios: input.ratios,
    };
    return {
      status: 'ok',
      value: {
        operationOptions: {
          ...(this.operationOptions ?? { runId }),
          runId,
          inputIntent,
        },
        providerSessionRef,
        inputLeaseRef,
        actionAdapterRef,
        adapterReadinessRef,
        evidenceLedgerRef,
        scope,
        inputSequence: 1,
      },
    };
  }

  private validateProviderInputResult(
    result: VirtualDisplayProviderInvokeResult,
    expected: ProviderInputInvocation,
    operation: string,
  ): NativeHostResult<never> | undefined {
    if (result.rawPayloadWritten !== false) {
      return nativeHostBlocked('unsafe-input', `${operation} returned an inline/raw provider payload.`, this.probe());
    }
    if (result.status !== 'ready') {
      return nativeHostBlocked(
        statusToNativeHostErrorCode(result),
        `${operation} was not ready: ${result.blockedReason ?? result.status}.`,
        this.probe(),
      );
    }
    if (result.providerExecuted !== true) {
      return nativeHostBlocked('provider-unavailable', `${operation} did not provide runtime-owned provider execution evidence.`, this.probe());
    }
    if (result.mutatingActionExecuted !== true) {
      return nativeHostBlocked('unsafe-input', `${operation} did not prove mutatingActionExecuted=true.`, this.probe());
    }
    if (!isVirtualDisplayReadinessControllable(result.readiness ?? this.readiness())) {
      return nativeHostBlocked('provider-unavailable', `${operation} did not prove isolated controllable VirtualDisplay readiness.`, this.probe());
    }
    const missing = [
      stringRef(result, 'currentRunRef') ? undefined : 'currentRunRef',
      stringRef(result, 'sessionRef') ? undefined : 'sessionRef',
      stringListRef(result, 'inputIntentRefs').length ? undefined : 'inputIntentRefs',
      stringListRef(result, 'executorEventRefs').length ? undefined : 'executorEventRefs',
      stringRef(result, 'beforeFrameRef') ? undefined : 'beforeFrameRef',
      stringRef(result, 'afterFrameRef') ? undefined : 'afterFrameRef',
      stringListRef(result, 'beforeAfterFrameRefs').length ? undefined : 'beforeAfterFrameRefs',
      stringListRef(result, 'verificationRefs').length ? undefined : 'verificationRefs',
      stringRef(result, 'evidenceLedgerRef') ? undefined : 'evidenceLedgerRef',
      operation === 'pause' || operation === 'resume' || operation === 'closeSession'
        ? stringRef(result, 'agentQueueRef') ? undefined : 'agentQueueRef'
        : undefined,
      operation === 'resume'
        ? stringRef(result, 'currentFrameRefreshRef') ? undefined : 'currentFrameRefreshRef'
        : undefined,
      operation === 'closeSession'
        ? stringRef(result, 'safeStopRef') ? undefined : 'safeStopRef'
        : undefined,
    ].filter((entry): entry is string => Boolean(entry));
    if (missing.length) {
      return nativeHostBlocked('missing-evidence', `${operation} returned incomplete provider input evidence: ${missing.join(', ')}.`, this.probe());
    }
    if (stringRef(result, 'sessionRef') !== expected.providerSessionRef) {
      return nativeHostBlocked('stale-current-run', `${operation} sessionRef did not match the provider lifecycle session.`, this.probe());
    }
    if (stringRef(result, 'inputLeaseRef') !== expected.inputLeaseRef) {
      return nativeHostBlocked('stale-current-run', `${operation} inputLeaseRef did not match the attached provider input lease.`, this.probe());
    }
    if (stringRef(result, 'actionAdapterRef') !== expected.actionAdapterRef) {
      return nativeHostBlocked('stale-current-run', `${operation} actionAdapterRef did not match the attached provider action adapter.`, this.probe());
    }
    if (stringRef(result, 'adapterReadinessRef') !== expected.adapterReadinessRef) {
      return nativeHostBlocked('stale-current-run', `${operation} adapterReadinessRef did not match the attached provider readiness.`, this.probe());
    }
    if (stringRef(result, 'evidenceLedgerRef') !== expected.evidenceLedgerRef) {
      return nativeHostBlocked('missing-evidence', `${operation} evidenceLedgerRef did not match the attached provider evidence ledger.`, this.probe());
    }
    return undefined;
  }

  private validateProviderControlReadFrame(
    result: VirtualDisplayProviderInvokeResult,
    expected: ProviderInputInvocation,
    operation: string,
  ): NativeHostResult<never> | undefined {
    if (result.rawPayloadWritten !== false) {
      return nativeHostBlocked('unsafe-input', `${operation} returned an inline/raw provider payload.`, this.probe());
    }
    if (result.status !== 'ready') {
      return nativeHostBlocked(
        statusToNativeHostErrorCode(result),
        `${operation} was not ready: ${result.blockedReason ?? result.status}.`,
        this.probe(),
      );
    }
    if (result.providerExecuted !== true) {
      return nativeHostBlocked('provider-unavailable', `${operation} did not provide runtime-owned provider execution evidence.`, this.probe());
    }
    if (stringRef(result, 'sessionRef') !== expected.providerSessionRef) {
      return nativeHostBlocked('stale-current-run', `${operation} sessionRef did not match the provider lifecycle session.`, this.probe());
    }
    if (!stringRef(result, 'currentFrameRef')) {
      return nativeHostBlocked('missing-frame', `${operation} currentFrameRef was missing.`, this.probe());
    }
    return undefined;
  }

  private recordControlEvidence(
    session: NativeHostSession,
    expected: ProviderInputInvocation,
    result: VirtualDisplayProviderInvokeResult,
    operation: 'pause' | 'resume' | 'closeSession',
    readFrame?: VirtualDisplayProviderInvokeResult,
  ) {
    const base = hostRef('provider-adapter-control', expected.scope, operation);
    session.profile.metadata = {
      ...(session.profile.metadata ?? {}),
      nativeHostControlEvidence: {
        agentQueueRef: stringRef(result, 'agentQueueRef') ? `${base}/agent-queue.json` : undefined,
        currentFrameRefreshRef: stringRef(result, 'currentFrameRefreshRef') ? `${base}/current-frame-refresh.json` : undefined,
        safeStopRef: stringRef(result, 'safeStopRef') ? `${base}/safe-stop.json` : undefined,
        currentFrameRef: readFrame ? stringRef(readFrame, 'currentFrameRef') : undefined,
        providerEvidenceRefs: uniqueRefs([
          stringRef(result, 'agentQueueRef'),
          stringRef(result, 'currentFrameRefreshRef'),
          stringRef(result, 'safeStopRef'),
          stringRef(readFrame ?? result, 'currentFrameRef'),
          ...providerEvidenceRefsFromInputResult(result),
        ]),
      },
    };
  }
}

interface ProviderInputInvocation {
  operationOptions: VirtualDisplayProviderOperationOptions;
  providerSessionRef: string;
  inputLeaseRef: string;
  actionAdapterRef: string;
  adapterReadinessRef: string;
  evidenceLedgerRef: string;
  scope: string;
  inputSequence: number;
}

function hostScope(session: NativeHostSession, surfaceTarget: NativeHostSurfaceTarget): string {
  return sanitizeId([
    session.sessionId,
    session.sessionRef,
    surfaceTarget.screenRef,
    surfaceTarget.targetWindowRef,
  ].join('-'));
}

function hostRef(scope: string, id: string, leaf: string): string {
  return `computer-use:native-host/${scope}/${id}/${leaf}`;
}

function nativeHostPlatform(platform: VirtualDisplayPlatform | undefined) {
  return platform === 'darwin' || platform === 'linux' || platform === 'win32'
    ? platform
    : 'unknown';
}

function nativeHostSurfaceTransport(transport: VirtualDisplayTransport | NativeHostSurfaceTransport | undefined): NativeHostSurfaceTransport {
  return transport === 'native-frame-stream' || transport === 'webrtc' || transport === 'native-presented-surface'
    ? transport
    : 'native-frame-stream';
}

function nativeHostSupportedTransports(readiness: VirtualDisplayReadiness | undefined): NativeHostSurfaceTransport[] {
  const selected = nativeHostSurfaceTransport(readiness?.selectedTransport);
  return uniqueRefs([selected, 'native-frame-stream', 'webrtc']) as NativeHostSurfaceTransport[];
}

function nativeHostInputAdapters(readiness: VirtualDisplayReadiness | undefined): NativeHostInputAdapterKind[] {
  return uniqueRefs(
    readiness?.inputIsolation.inputAdapterRefs
      ?.filter((adapter): adapter is VirtualDisplayInputAdapter => Boolean(adapter))
      ?? [],
  ) as NativeHostInputAdapterKind[];
}

function nativeHostCapabilities(readiness: VirtualDisplayReadiness | undefined): NativeHostCapabilityFlags {
  const ready = isVirtualDisplayReadinessControllable(readiness);
  return {
    createDisplay: ready && readiness?.captureSupported === true,
    launchApp: ready,
    attachWindow: ready && readiness?.liveSurfaceSupported === true,
    captureFrame: ready && readiness?.captureSupported === true,
    streamFrames: ready && readiness?.liveSurfaceSupported === true,
    sendHumanInput: ready && readiness?.inputSupported === true,
    executeAutomationIntent: ready && readiness?.inputSupported === true,
    validateGrant: true,
    writeEvidenceLedger: true,
    backgroundRenderable: ready && readiness?.backgroundRenderable === true,
    affectsPhysicalDisplay: readiness?.affectsPhysicalDisplay === true,
    requiresFocusSteal: readiness?.requiresFocusSteal === true,
    sharedSystemInputUsed: readiness?.sharedSystemInputUsed === true,
  };
}

function nativeHostReadinessStatus(readiness: VirtualDisplayReadiness | undefined): NativeHostReadinessRecord['status'] {
  if (isVirtualDisplayReadinessControllable(readiness)) return 'ready';
  if (readiness?.readinessStatus === 'permission-missing') return 'requires-handoff';
  if (readiness?.installState === 'installable') return 'installable';
  if (readiness?.installState === 'unsupported') return 'unsupported';
  return 'blocked';
}

function providerDriverRefs(providerId: string, readiness: VirtualDisplayReadiness | undefined): string[] {
  return uniqueRefs([
    isVirtualDisplayReadinessControllable(readiness)
      ? `computer-use:native-host/platform-drivers/${sanitizeId(providerId)}/ready.json`
      : undefined,
    ...(readiness?.diagnosticRefs ?? []),
    ...(readiness?.installHintRefs ?? []),
  ]);
}

function stringRef(result: VirtualDisplayProviderInvokeResult, key: string): string | undefined {
  const value = result.refs[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
  return undefined;
}

function nonNegativeSequence(result: VirtualDisplayProviderInvokeResult): number | undefined {
  const value = stringRef(result, 'currentFrameSequence');
  if (!value || !/^\d+$/u.test(value)) return result.surfaceTransport?.currentFrameSequence;
  return Number(value);
}

function uniqueRefs<T extends string>(refs: Array<T | string | undefined>): T[] {
  return [...new Set(refs.filter((ref): ref is T => Boolean(ref?.trim())))] as T[];
}

function stringListRef(result: VirtualDisplayProviderInvokeResult, key: string): string[] {
  const value = result.refs[key];
  if (typeof value === 'string' && value.trim()) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
}

function providerEvidenceRefsFromInputResult(result: VirtualDisplayProviderInvokeResult): string[] {
  return uniqueRefs([
    stringRef(result, 'beforeFrameRef'),
    stringRef(result, 'afterFrameRef'),
    ...stringListRef(result, 'inputIntentRefs'),
    ...stringListRef(result, 'executorEventRefs'),
    ...stringListRef(result, 'beforeAfterFrameRefs'),
    ...stringListRef(result, 'verificationRefs'),
    ...stringListRef(result, 'isolationEvidenceRefs'),
    ...stringListRef(result, 'physicalDesktopProbeRefs'),
  ]);
}

function nativeHostBlocked<T>(
  code: Extract<NativeHostResult<T>, { status: 'blocked' }>['error']['code'],
  message: string,
  readiness?: NativeHostReadinessRecord,
): NativeHostResult<T> {
  return {
    status: 'blocked',
    error: {
      code,
      message,
      ref: `computer-use:native-host/provider-adapter/blocked/${sanitizeId(code)}.json`,
    },
    readiness,
  };
}

function statusToNativeHostErrorCode(result: VirtualDisplayProviderInvokeResult): Extract<NativeHostResult<never>, { status: 'blocked' }>['error']['code'] {
  if (result.status === 'permission-missing') return 'permission-missing';
  if (!result.providerId) return 'provider-unavailable';
  return 'provider-unavailable';
}

function humanInputRatios(inputEvent: NativeHostHumanInputEvent): Record<string, number> | undefined {
  const ratios: Record<string, number> = {};
  if (inputEvent.xRatio !== undefined) ratios['x-ratio'] = inputEvent.xRatio;
  if (inputEvent.yRatio !== undefined) ratios['y-ratio'] = inputEvent.yRatio;
  if (inputEvent.endXRatio !== undefined) ratios['end-x-ratio'] = inputEvent.endXRatio;
  if (inputEvent.endYRatio !== undefined) ratios['end-y-ratio'] = inputEvent.endYRatio;
  return Object.keys(ratios).length ? ratios : undefined;
}
