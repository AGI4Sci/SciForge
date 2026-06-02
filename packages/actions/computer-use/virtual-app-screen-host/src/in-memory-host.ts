import {
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  type NativeHostAppProfile,
  type NativeHostAutomationBarrier,
  type NativeHostAutomationIntent,
  type NativeHostAutomationResult,
  type NativeHostError,
  type NativeHostEvidenceContext,
  type NativeHostEvidenceLedger,
  type NativeHostFrame,
  type NativeHostGrantValidation,
  type NativeHostHumanInputAccepted,
  type NativeHostHumanInputEvent,
  type NativeHostLedgerEntry,
  type NativeHostLedgerRefs,
  type NativeHostMaybePromise,
  type NativeHostLiveBindingGrant,
  type NativeHostLiveSurface,
  type NativeHostPermissionLedgerRequest,
  type NativeHostPermissionRequest,
  type NativeHostReadinessRecord,
  type NativeHostResult,
  type NativeHostSession,
  type NativeHostSessionProfile,
  type NativeHostSurfaceTarget,
  type NativeVirtualAppScreenHost,
  type NativeVirtualAppScreenHostDescription,
  type NativeVirtualAppScreenPlatformAdapter,
} from './contracts';
import { appendNativeHostLedgerEntry, sha256, validateNativeHostEvidenceLedger } from './ledger';

function ref(scope: string, id: string, leaf: string): string {
  return `computer-use:native-host/${scope}/${id}/${leaf}`;
}

function now(): string {
  return new Date().toISOString();
}

function blocked<T>(code: NativeHostError['code'], message: string, readiness?: NativeHostReadinessRecord): NativeHostResult<T> {
  return {
    status: 'blocked',
    error: {
      code,
      message,
      ref: `computer-use:native-host/blocked/${code}.json`,
    },
    readiness,
  };
}

function adapterBlocked<T>(result: Extract<NativeHostResult<unknown>, { status: 'blocked' }>): NativeHostResult<T> {
  return {
    status: 'blocked',
    error: result.error,
    readiness: result.readiness,
  };
}

function isPromiseLike<T>(value: NativeHostMaybePromise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as { then?: unknown }).then === 'function');
}

export class FailClosedNativeHostPlatformAdapter implements NativeVirtualAppScreenPlatformAdapter {
  describe(): NativeVirtualAppScreenHostDescription {
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      hostId: 'native-virtual-app-screen-host.fail-closed',
      platform: 'unknown',
      backendKind: 'no-platform-adapter',
      protocol: [...NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL],
      supportedApps: [],
      supportedTransports: [],
      supportedInputAdapters: [],
      capabilities: {
        createDisplay: false,
        launchApp: false,
        attachWindow: false,
        captureFrame: false,
        streamFrames: false,
        sendHumanInput: false,
        executeAutomationIntent: false,
        validateGrant: true,
        writeEvidenceLedger: true,
        backgroundRenderable: false,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
      },
      permissionRefs: [],
      blockedReason: 'No Native VirtualAppScreen platform adapter is registered.',
      diagnosticOnly: true,
      thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only',
    };
  }

  probe(): NativeHostReadinessRecord {
    const description = this.describe();
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      status: 'blocked',
      adapterKind: description.backendKind,
      platform: description.platform,
      checkedAt: now(),
      adapterReadinessRef: 'computer-use:native-host/readiness/no-platform-adapter.json',
      permissionRefs: [],
      driverRefs: [],
      providerRefs: [],
      capabilities: description.capabilities,
      diagnosticOnly: true,
      blockedReason: description.blockedReason,
      handoffRef: 'computer-use:native-host/handoff/no-platform-adapter.json',
      recheckRef: 'computer-use:native-host/recheck/no-platform-adapter.json',
    };
  }
}

export class ContractSmokeNativeHostPlatformAdapter implements NativeVirtualAppScreenPlatformAdapter {
  describe(): NativeVirtualAppScreenHostDescription {
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      hostId: 'native-virtual-app-screen-host.contract-smoke',
      platform: 'unknown',
      backendKind: 'contract-smoke-adapter',
      protocol: [...NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL],
      supportedApps: ['app:contract-smoke'],
      supportedTransports: ['native-frame-stream'],
      supportedInputAdapters: ['app-command', 'virtual-display-input'],
      capabilities: {
        createDisplay: true,
        launchApp: true,
        attachWindow: true,
        captureFrame: true,
        streamFrames: true,
        sendHumanInput: true,
        executeAutomationIntent: true,
        validateGrant: true,
        writeEvidenceLedger: true,
        backgroundRenderable: true,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
      },
      permissionRefs: ['permission:contract-smoke/background-rendering'],
      diagnosticOnly: true,
      thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only',
    };
  }

  probe(): NativeHostReadinessRecord {
    const description = this.describe();
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      status: 'ready',
      adapterKind: description.backendKind,
      platform: description.platform,
      checkedAt: now(),
      adapterReadinessRef: 'computer-use:native-host/readiness/contract-smoke-adapter.json',
      permissionRefs: description.permissionRefs,
      driverRefs: ['computer-use:native-host/drivers/contract-smoke-driver.json'],
      providerRefs: ['computer-use:native-host/providers/contract-smoke-provider.json'],
      capabilities: description.capabilities,
      diagnosticOnly: true,
    };
  }

  sendHumanInput(
    _session: NativeHostSession,
    inputEvent: NativeHostHumanInputEvent,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostHumanInputAccepted>> {
    return {
      status: 'ok',
      value: {
        inputAcceptedRef: `computer-use:native-host/adapter-smoke/inputs/${sha256(inputEvent).slice(0, 16)}.json`,
        inputSequence: 1,
        acceptedAt: now(),
        fireAndRelease: true,
        evidenceWillCatchUp: true,
      },
    };
  }

  executeAutomationIntent(
    session: NativeHostSession,
    intent: NativeHostAutomationIntent,
    barrier: NativeHostAutomationBarrier,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostAutomationResult>> {
    return {
      status: 'ok',
      value: {
        automationBarrierRef: barrier.barrierRef,
        beforeFrameRef: intent.beforeFrameRef,
        afterFrameRef: `computer-use:native-host/adapter-smoke/frames/${sha256({ sessionRef: session.sessionRef, intent }).slice(0, 16)}.png`,
        verifierRef: intent.verifierRef ?? `computer-use:native-host/adapter-smoke/verifiers/${intent.kind}.json`,
        evidenceLedgerRef: session.ledgerRef,
        completedAt: now(),
      },
    };
  }

  pauseAgent(session: NativeHostSession, _reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    return { status: 'ok', value: session };
  }

  resumeAgent(session: NativeHostSession, _barrier: NativeHostAutomationBarrier): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    return { status: 'ok', value: session };
  }

  stop(session: NativeHostSession, _reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    return { status: 'ok', value: session };
  }

  closeSession(session: NativeHostSession): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    return { status: 'ok', value: session };
  }
}

export class InMemoryNativeVirtualAppScreenHost implements NativeVirtualAppScreenHost {
  private readonly adapter: NativeVirtualAppScreenPlatformAdapter;
  private readonly sessions = new Map<string, NativeHostSession>();
  private readonly ledgers = new Map<string, NativeHostEvidenceLedger>();
  private readonly grants = new Map<string, NativeHostLiveBindingGrant>();
  private sequence = 0;

  constructor(adapter: NativeVirtualAppScreenPlatformAdapter = new FailClosedNativeHostPlatformAdapter()) {
    this.adapter = adapter;
  }

  describe(): NativeVirtualAppScreenHostDescription {
    return this.adapter.describe();
  }

  probe(): NativeHostReadinessRecord {
    return this.adapter.probe();
  }

  createSession(
    profile: NativeHostSessionProfile,
    permissions: NativeHostPermissionRequest,
    evidenceContext: NativeHostEvidenceContext,
  ): NativeHostResult<NativeHostSession> {
    const readiness = this.probe();
    if (readiness.status !== 'ready') {
      return blocked('provider-unavailable', readiness.blockedReason ?? 'Native host provider is not ready.', readiness);
    }
    if (permissions.allowSharedSystemInput !== false || readiness.capabilities.sharedSystemInputUsed) {
      return blocked('shared-system-input-blocked', 'Native Host refuses shared system input for product sessions.', readiness);
    }
    if (!readiness.capabilities.backgroundRenderable || readiness.capabilities.affectsPhysicalDisplay || readiness.capabilities.requiresFocusSteal) {
      return blocked('driver-missing', 'Native Host cannot prove background isolated rendering.', readiness);
    }

    const id = `session-${++this.sequence}`;
    const sessionRef = ref('sessions', id, 'session.json');
    const currentRunPointerRef = evidenceContext.currentRunPointerRef ?? ref('runs', id, 'current-run-pointer.json');
    const requiredEvidenceContext: Required<NativeHostEvidenceContext> = {
      currentRunRef: evidenceContext.currentRunRef,
      evidenceRootRef: evidenceContext.evidenceRootRef,
      currentRunPointerRef,
      guiPresentRef: evidenceContext.guiPresentRef ?? ref('gui-present', id, 'screen-pane.json'),
    };
    const session: NativeHostSession = {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      sessionId: id,
      sessionRef,
      hostId: this.describe().hostId,
      status: 'created',
      createdAt: now(),
      updatedAt: now(),
      profile,
      permissions,
      evidenceContext: requiredEvidenceContext,
      readiness,
      ledgerRef: ref('ledgers', id, 'evidence-ledger.json'),
      currentRunPointerRef,
    };
    const ledger: NativeHostEvidenceLedger = {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      ledgerRef: session.ledgerRef,
      sessionId: id,
      sessionRef,
      currentRunRef: requiredEvidenceContext.currentRunRef,
      currentRunPointerRef,
      entries: [],
    };
    appendNativeHostLedgerEntry({
      ledger,
      type: 'session.created',
      refs: { sessionRef },
      diagnosticOnly: readiness.diagnosticOnly,
    });
    this.sessions.set(id, session);
    this.ledgers.set(id, ledger);
    return { status: 'ok', value: session };
  }

  launchOrAttachApp(sessionId: string, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostSession> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    const adapterApp = this.adapter.launchOrAttachApp?.(session, appProfile);
    if (adapterApp?.status === 'blocked') return adapterBlocked(adapterApp);
    session.app = adapterApp?.status === 'ok' ? adapterApp.value : appProfile;
    session.status = 'app-attached';
    session.updatedAt = now();
    appendNativeHostLedgerEntry({
      ledger,
      type: 'app.launched',
      refs: {
        sessionRef: session.sessionRef,
        targetAppRef: session.app.appRef,
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: session };
  }

  launchApp(sessionId: string, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostSession> {
    return this.launchOrAttachApp(sessionId, appProfile);
  }

  attachSurface(sessionId: string, surfaceTarget: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!session.app) return blocked('surface-not-attached', 'Cannot attach a surface before launchOrAttachApp.');
    if (!this.describe().supportedTransports.includes(surfaceTarget.transport)) {
      return blocked('provider-unavailable', `Unsupported Native Host transport: ${surfaceTarget.transport}`);
    }
    const surfaceId = surfaceTarget.surfaceId ?? `surface-${sessionId}`;
    const defaultSurface: NativeHostLiveSurface = {
      surfaceId,
      screenRef: surfaceTarget.screenRef,
      targetAppRef: session.app.appRef,
      targetWindowRef: surfaceTarget.targetWindowRef,
      sessionRef: session.sessionRef,
      liveSurfaceRef: ref('surfaces', surfaceId, 'live-surface.json'),
      liveBindingAttachGrantRef: ref('grants', surfaceId, 'live-binding-attach-grant.json'),
      surfaceOwnerRef: ref('surfaces', surfaceId, 'surface-owner.json'),
      displayOwnerRef: ref('surfaces', surfaceId, 'display-owner.json'),
      surfaceTransport: surfaceTarget.transport,
      surfaceTransportRef: ref('surfaces', surfaceId, 'surface-transport.json'),
      frameStreamRef: ref('surfaces', surfaceId, 'frame-stream.json'),
      frameTransportContractRef: ref('surfaces', surfaceId, 'frame-transport-contract.json'),
      frameTelemetryRef: ref('surfaces', surfaceId, 'frame-telemetry.json'),
      currentFrameSequence: 0,
    };
    const adapterSurface = this.adapter.attachSurface?.(session, surfaceTarget);
    if (adapterSurface?.status === 'blocked') return adapterBlocked(adapterSurface);
    const surface = adapterSurface?.status === 'ok' ? adapterSurface.value : defaultSurface;
    const surfaceIssue = validateAdapterSurface(session, surfaceTarget, surface);
    if (surfaceIssue) return blocked('missing-evidence', surfaceIssue);
    const grant: NativeHostLiveBindingGrant = {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      grantRef: surface.liveBindingAttachGrantRef,
      sessionId,
      surfaceId,
      currentRunRef: session.evidenceContext.currentRunRef,
      liveSurfaceRef: surface.liveSurfaceRef,
      surfaceTransportRef: surface.surfaceTransportRef,
      frameStreamRef: surface.frameStreamRef,
      issuedAt: now(),
    };
    session.surface = surface;
    session.status = 'surface-attached';
    session.updatedAt = now();
    this.grants.set(surface.liveBindingAttachGrantRef, grant);
    appendNativeHostLedgerEntry({
      ledger,
      type: 'surface.attached',
      refs: {
        sessionRef: session.sessionRef,
        targetAppRef: session.app.appRef,
        targetWindowRef: surfaceTarget.targetWindowRef,
        liveSurfaceRef: surface.liveSurfaceRef,
        liveBindingAttachGrantRef: surface.liveBindingAttachGrantRef,
        surfaceOwnerRef: surface.surfaceOwnerRef,
        displayOwnerRef: surface.displayOwnerRef,
        surfaceTransportRef: surface.surfaceTransportRef,
        frameStreamRef: surface.frameStreamRef,
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: surface };
  }

  presentSurface(sessionId: string, grantRef: string): NativeHostResult<NativeHostGrantValidation> {
    const validation = this.validateGrant(grantRef);
    if (!validation.ok) return blocked('invalid-grant', validation.issues.join(' '));
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    const grant = this.grants.get(grantRef);
    if (!session || !ledger || !grant || grant.sessionId !== sessionId) {
      return blocked('invalid-grant', 'Grant does not belong to this Native Host session.');
    }
    const entry = appendNativeHostLedgerEntry({
      ledger,
      type: 'grant.validated',
      refs: {
        sessionRef: session.sessionRef,
        liveSurfaceRef: grant.liveSurfaceRef,
        liveBindingAttachGrantRef: grant.grantRef,
        surfaceTransportRef: grant.surfaceTransportRef,
        frameStreamRef: grant.frameStreamRef,
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    grant.validatedAt = entry.recordedAt;
    grant.validationLedgerEntryRef = entry.eventRef;
    return {
      status: 'ok',
      value: {
        ...validation,
        validationLedgerEntryRef: entry.eventRef,
      },
    };
  }

  readFrame(sessionId: string, cursor?: string): NativeHostResult<NativeHostFrame> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!session.surface) return blocked('surface-not-attached', 'Cannot read a frame before attachSurface.');
    const nextSequence = session.surface.currentFrameSequence + 1;
    const defaultFrameRef = ref('frames', session.surface.surfaceId, `${String(nextSequence).padStart(4, '0')}.png`);
    const defaultFrame: NativeHostFrame = {
      frameRef: defaultFrameRef,
      frameHash: sha256({
        cursor,
        frameRef: defaultFrameRef,
        frameSequence: nextSequence,
        liveSurfaceRef: session.surface.liveSurfaceRef,
        currentRunRef: session.evidenceContext.currentRunRef,
      }),
      frameSequence: nextSequence,
      liveSurfaceRef: session.surface.liveSurfaceRef,
      frameStreamRef: session.surface.frameStreamRef,
      readAt: now(),
    };
    const adapterFrame = this.adapter.readFrame?.(session, cursor);
    if (adapterFrame?.status === 'blocked') return adapterBlocked(adapterFrame);
    const frame = adapterFrame?.status === 'ok' ? adapterFrame.value : defaultFrame;
    const frameIssue = validateAdapterFrame(session, frame);
    if (frameIssue) return blocked('missing-frame', frameIssue);
    session.surface.currentFrameSequence = frame.frameSequence;
    session.surface.currentFrameRef = frame.frameRef;
    session.surface.currentFrameHash = frame.frameHash;
    appendNativeHostLedgerEntry({
      ledger,
      type: 'frame.read',
      refs: {
        sessionRef: session.sessionRef,
        liveSurfaceRef: session.surface.liveSurfaceRef,
        frameStreamRef: session.surface.frameStreamRef,
        frameRef: frame.frameRef,
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: frame };
  }

  sendHumanInput(
    sessionId: string,
    inputEvent: NativeHostHumanInputEvent,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostHumanInputAccepted>> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!session.surface) return blocked('surface-not-attached', 'Cannot send input before attachSurface.');
    if (inputEvent.screenRef !== session.surface.screenRef) {
      return blocked('unsafe-input', 'Human input screenRef does not match the attached host surface.');
    }
    if (!this.adapter.sendHumanInput) {
      return blocked('provider-unavailable', 'Native Host platform adapter does not implement human input delivery.', session.readiness);
    }
    const adapterInput = this.adapter.sendHumanInput(session, inputEvent);
    if (isPromiseLike(adapterInput)) {
      return adapterInput.then((resolved) => this.acceptHumanInputAfterAdapter(sessionId, session, ledger, inputEvent, resolved));
    }
    return this.acceptHumanInputAfterAdapter(sessionId, session, ledger, inputEvent, adapterInput);
  }

  private acceptHumanInputAfterAdapter(
    sessionId: string,
    session: NativeHostSession,
    ledger: NativeHostEvidenceLedger,
    inputEvent: NativeHostHumanInputEvent,
    adapterInput: NativeHostResult<NativeHostHumanInputAccepted>,
  ): NativeHostResult<NativeHostHumanInputAccepted> {
    const surface = session.surface;
    if (!surface) return blocked('surface-not-attached', 'Cannot accept input before attachSurface.');
    if (adapterInput.status === 'blocked') return adapterBlocked(adapterInput);
    if (
      adapterInput.value.fireAndRelease !== true
      || adapterInput.value.evidenceWillCatchUp !== true
    ) {
      return blocked('unsafe-input', 'Native Host adapter human input did not prove fire-and-release acceptance.');
    }
    const inputSequence = ledger.entries.filter((entry) => entry.type === 'human-input.accepted').length + 1;
    const accepted: NativeHostHumanInputAccepted = {
      inputAcceptedRef: ref('inputs', sessionId, `${String(inputSequence).padStart(4, '0')}-${inputEvent.kind}.json`),
      inputSequence,
      acceptedAt: now(),
      fireAndRelease: true,
      evidenceWillCatchUp: true,
    };
    appendNativeHostLedgerEntry({
      ledger,
      type: 'human-input.accepted',
      refs: {
        sessionRef: session.sessionRef,
        targetWindowRef: surface.targetWindowRef,
        liveSurfaceRef: surface.liveSurfaceRef,
        frameStreamRef: surface.frameStreamRef,
        frameRef: surface.currentFrameRef,
        inputIntentRef: inputEvent.inputIntentRef,
        inputAcceptedRef: accepted.inputAcceptedRef,
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: accepted };
  }

  executeAutomationIntent(
    sessionId: string,
    intent: NativeHostAutomationIntent,
    barrier: NativeHostAutomationBarrier,
  ): NativeHostMaybePromise<NativeHostResult<NativeHostAutomationResult>> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!session.surface?.currentFrameRef) return blocked('missing-frame', 'Automation requires a current host frame.');
    if (barrier.requiredReadinessRef !== session.readiness.adapterReadinessRef) {
      return blocked('automation-barrier-not-ready', 'Automation barrier does not match current provider readiness.');
    }
    if (!this.adapter.executeAutomationIntent) {
      return blocked('provider-unavailable', 'Native Host platform adapter does not implement automation intent execution.', session.readiness);
    }
    const adapterAutomation = this.adapter.executeAutomationIntent(session, intent, barrier);
    if (isPromiseLike(adapterAutomation)) {
      return adapterAutomation.then((resolved) => this.completeAutomationAfterAdapter(sessionId, session, ledger, intent, barrier, resolved));
    }
    return this.completeAutomationAfterAdapter(sessionId, session, ledger, intent, barrier, adapterAutomation);
  }

  private completeAutomationAfterAdapter(
    sessionId: string,
    session: NativeHostSession,
    ledger: NativeHostEvidenceLedger,
    intent: NativeHostAutomationIntent,
    barrier: NativeHostAutomationBarrier,
    adapterAutomation: NativeHostResult<NativeHostAutomationResult>,
  ): NativeHostResult<NativeHostAutomationResult> {
    const surface = session.surface;
    if (!surface) return blocked('surface-not-attached', 'Cannot complete automation before attachSurface.');
    if (adapterAutomation.status === 'blocked') return adapterBlocked(adapterAutomation);
    if (adapterAutomation.value.automationBarrierRef !== barrier.barrierRef) {
      return blocked('automation-barrier-not-ready', 'Native Host adapter automation did not complete the requested barrier.');
    }
    if (adapterAutomation.value.beforeFrameRef !== intent.beforeFrameRef) {
      return blocked('missing-frame', 'Native Host adapter automation did not preserve the requested before frame.');
    }
    const afterFrame = this.readFrame(sessionId, 'automation-after-frame');
    if (afterFrame.status !== 'ok') return afterFrame;
    const result: NativeHostAutomationResult = {
      automationBarrierRef: barrier.barrierRef,
      beforeFrameRef: intent.beforeFrameRef,
      afterFrameRef: afterFrame.value.frameRef,
      verifierRef: intent.verifierRef ?? ref('verifiers', sessionId, `${intent.kind}.json`),
      evidenceLedgerRef: session.ledgerRef,
      completedAt: now(),
    };
    appendNativeHostLedgerEntry({
      ledger,
      type: 'automation.barrier-completed',
      refs: {
        sessionRef: session.sessionRef,
        targetWindowRef: intent.targetWindowRef,
        liveSurfaceRef: surface.liveSurfaceRef,
        frameStreamRef: surface.frameStreamRef,
        automationIntentRef: intent.intentRef,
        automationBarrierRef: barrier.barrierRef,
        beforeFrameRef: intent.beforeFrameRef,
        afterFrameRef: result.afterFrameRef,
        verifierRef: result.verifierRef,
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: result };
  }

  recordPermissionHandoff(
    sessionId: string,
    request: NativeHostPermissionLedgerRequest = {},
  ): NativeHostResult<NativeHostLedgerEntry> {
    return this.recordPermissionLedgerEvent(sessionId, 'permission.handoff', request);
  }

  recordPermissionRecheck(
    sessionId: string,
    request: NativeHostPermissionLedgerRequest = {},
  ): NativeHostResult<NativeHostLedgerEntry> {
    return this.recordPermissionLedgerEvent(sessionId, 'permission.recheck', request);
  }

  private recordPermissionLedgerEvent(
    sessionId: string,
    type: 'permission.handoff' | 'permission.recheck',
    request: NativeHostPermissionLedgerRequest,
  ): NativeHostResult<NativeHostLedgerEntry> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    const readiness = this.probe();
    const requestedRefIssue = unsafeRefsIssue(request);
    if (requestedRefIssue) return blocked(requestedRefIssue.code, requestedRefIssue.message, readiness);

    session.readiness = readiness;
    session.updatedAt = now();
    const refs = compactRefs({
      sessionRef: session.sessionRef,
      permissionHandoffRef: request.permissionHandoffRef ?? readiness.handoffRef ?? ref('permission-handoffs', sessionId, 'handoff.json'),
      recheckRef: request.recheckRef ?? readiness.recheckRef ?? ref('permission-rechecks', sessionId, 'recheck.json'),
      permissionRef: request.permissionRef ?? readiness.permissionRefs[0],
      adapterReadinessRef: readiness.adapterReadinessRef,
      platformDriverRef: request.platformDriverRef ?? readiness.driverRefs[0],
      blockedRef: request.blockedRef ?? (readiness.status === 'ready'
        ? undefined
        : ref('blocked', sessionId, `${type}.json`)),
    });
    const finalRefIssue = unsafeRefsIssue(refs);
    if (finalRefIssue) return blocked(finalRefIssue.code, finalRefIssue.message, readiness);

    const entry = appendNativeHostLedgerEntry({
      ledger,
      type,
      refs,
      diagnosticOnly: readiness.diagnosticOnly,
    });
    return { status: 'ok', value: entry };
  }

  pauseAgent(sessionId: string, reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!this.adapter.pauseAgent) {
      return blocked('provider-unavailable', 'Native Host platform adapter does not implement agent pause control.', session.readiness);
    }
    const adapterPause = this.adapter.pauseAgent(session, reason);
    if (isPromiseLike(adapterPause)) {
      return adapterPause.then((resolved) => this.pauseAgentAfterAdapter(sessionId, session, ledger, reason, resolved));
    }
    return this.pauseAgentAfterAdapter(sessionId, session, ledger, reason, adapterPause);
  }

  private pauseAgentAfterAdapter(
    sessionId: string,
    session: NativeHostSession,
    ledger: NativeHostEvidenceLedger,
    reason: string,
    adapterPause: NativeHostResult<NativeHostSession>,
  ): NativeHostResult<NativeHostSession> {
    if (adapterPause.status === 'blocked') return adapterBlocked(adapterPause);
    session.status = 'paused';
    session.updatedAt = now();
    appendNativeHostLedgerEntry({
      ledger,
      type: 'agent.paused',
      refs: {
        sessionRef: session.sessionRef,
        liveSurfaceRef: session.surface?.liveSurfaceRef,
        agentPauseRef: ref('agent-pauses', sessionId, `${sha256({ reason }).slice(0, 12)}.json`),
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: session };
  }

  resumeAgent(sessionId: string, barrier: NativeHostAutomationBarrier): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (barrier.requiredReadinessRef !== session.readiness.adapterReadinessRef) {
      return blocked('automation-barrier-not-ready', 'Resume barrier does not match current provider readiness.');
    }
    const permissionBarrierIssue = resumePermissionBarrierIssue(ledger, barrier);
    if (permissionBarrierIssue) {
      return blocked('automation-barrier-not-ready', permissionBarrierIssue, session.readiness);
    }
    if (!this.adapter.resumeAgent) {
      return blocked('provider-unavailable', 'Native Host platform adapter does not implement agent resume control.', session.readiness);
    }
    const adapterResume = this.adapter.resumeAgent(session, barrier);
    if (isPromiseLike(adapterResume)) {
      return adapterResume.then((resolved) => this.resumeAgentAfterAdapter(session, ledger, barrier, resolved));
    }
    return this.resumeAgentAfterAdapter(session, ledger, barrier, adapterResume);
  }

  private resumeAgentAfterAdapter(
    session: NativeHostSession,
    ledger: NativeHostEvidenceLedger,
    barrier: NativeHostAutomationBarrier,
    adapterResume: NativeHostResult<NativeHostSession>,
  ): NativeHostResult<NativeHostSession> {
    if (adapterResume.status === 'blocked') return adapterBlocked(adapterResume);
    session.status = session.surface ? 'surface-attached' : 'app-attached';
    session.updatedAt = now();
    appendNativeHostLedgerEntry({
      ledger,
      type: 'agent.resumed',
      refs: {
        sessionRef: session.sessionRef,
        liveSurfaceRef: session.surface?.liveSurfaceRef,
        automationBarrierRef: barrier.barrierRef,
        agentResumeRef: ref('agent-resumes', session.sessionId, `${sha256({ barrier }).slice(0, 12)}.json`),
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: session };
  }

  stop(sessionId: string, reason: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!this.adapter.stop) {
      return blocked('provider-unavailable', 'Native Host platform adapter does not implement safe stop control.', session.readiness);
    }
    const adapterStop = this.adapter.stop(session, reason);
    if (isPromiseLike(adapterStop)) {
      return adapterStop.then((resolved) => this.stopAfterAdapter(sessionId, session, ledger, reason, resolved));
    }
    return this.stopAfterAdapter(sessionId, session, ledger, reason, adapterStop);
  }

  private stopAfterAdapter(
    sessionId: string,
    session: NativeHostSession,
    ledger: NativeHostEvidenceLedger,
    reason: string,
    adapterStop: NativeHostResult<NativeHostSession>,
  ): NativeHostResult<NativeHostSession> {
    if (adapterStop.status === 'blocked') return adapterBlocked(adapterStop);
    session.status = 'stopped';
    session.updatedAt = now();
    appendNativeHostLedgerEntry({
      ledger,
      type: 'session.stopped',
      refs: {
        sessionRef: session.sessionRef,
        liveSurfaceRef: session.surface?.liveSurfaceRef,
        stoppedRef: ref('stopped', sessionId, `${sha256({ reason }).slice(0, 12)}.json`),
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: session };
  }

  closeSession(sessionId: string): NativeHostMaybePromise<NativeHostResult<NativeHostSession>> {
    const session = this.sessions.get(sessionId);
    const ledger = this.ledgers.get(sessionId);
    if (!session || !ledger) return blocked('session-not-found', `Unknown Native Host session: ${sessionId}`);
    if (!this.adapter.closeSession) {
      return blocked('provider-unavailable', 'Native Host platform adapter does not implement session close control.', session.readiness);
    }
    const adapterClose = this.adapter.closeSession(session);
    if (isPromiseLike(adapterClose)) {
      return adapterClose.then((resolved) => this.closeSessionAfterAdapter(session, ledger, resolved));
    }
    return this.closeSessionAfterAdapter(session, ledger, adapterClose);
  }

  private closeSessionAfterAdapter(
    session: NativeHostSession,
    ledger: NativeHostEvidenceLedger,
    adapterClose: NativeHostResult<NativeHostSession>,
  ): NativeHostResult<NativeHostSession> {
    if (adapterClose.status === 'blocked') return adapterBlocked(adapterClose);
    session.status = 'closed';
    session.updatedAt = now();
    appendNativeHostLedgerEntry({
      ledger,
      type: 'session.closed',
      refs: {
        sessionRef: session.sessionRef,
        liveSurfaceRef: session.surface?.liveSurfaceRef,
        closedRef: ref('closed', session.sessionId, 'session-closed.json'),
      },
      diagnosticOnly: session.readiness.diagnosticOnly,
    });
    return { status: 'ok', value: session };
  }

  validateGrant(grantRef: string): NativeHostGrantValidation {
    const grant = this.grants.get(grantRef);
    const issues: string[] = [];
    if (!grant) {
      return { ok: false, grantRef, issues: ['Grant ref was not issued by Native Host.'] };
    }
    const session = this.sessions.get(grant.sessionId);
    if (!session) issues.push('Grant session is missing.');
    if (session && grant.currentRunRef !== session.evidenceContext.currentRunRef) issues.push('Grant currentRunRef is stale.');
    if (session?.surface?.liveSurfaceRef !== grant.liveSurfaceRef) issues.push('Grant liveSurfaceRef does not match current surface.');
    if (session?.surface?.surfaceTransportRef !== grant.surfaceTransportRef) issues.push('Grant surfaceTransportRef does not match current surface.');
    if (session?.surface?.frameStreamRef !== grant.frameStreamRef) issues.push('Grant frameStreamRef does not match current surface.');
    if (!grant.liveSurfaceRef || !grant.surfaceTransportRef || !grant.frameStreamRef) issues.push('Grant is missing live refs.');
    return {
      ok: issues.length === 0,
      grantRef,
      sessionRef: session?.sessionRef,
      liveSurfaceRef: grant.liveSurfaceRef,
      surfaceTransportRef: grant.surfaceTransportRef,
      frameStreamRef: grant.frameStreamRef,
      currentRunRef: grant.currentRunRef,
      validationLedgerEntryRef: grant.validationLedgerEntryRef,
      issues,
    };
  }

  getLedger(sessionId: string): NativeHostEvidenceLedger | undefined {
    return this.ledgers.get(sessionId);
  }

  validateLedger(
    sessionId: string,
    options?: Parameters<NativeVirtualAppScreenHost['validateLedger']>[1],
  ) {
    const ledger = this.getLedger(sessionId);
    if (!ledger) return { ok: false, issues: [`Unknown Native Host session: ${sessionId}`] };
    return validateNativeHostEvidenceLedger(ledger, options);
  }
}

function validateAdapterSurface(
  session: NativeHostSession,
  target: NativeHostSurfaceTarget,
  surface: NativeHostLiveSurface,
): string | undefined {
  const required: Array<[string, string | undefined]> = [
    ['surfaceId', surface.surfaceId],
    ['screenRef', surface.screenRef],
    ['targetAppRef', surface.targetAppRef],
    ['targetWindowRef', surface.targetWindowRef],
    ['sessionRef', surface.sessionRef],
    ['liveSurfaceRef', surface.liveSurfaceRef],
    ['liveBindingAttachGrantRef', surface.liveBindingAttachGrantRef],
    ['surfaceOwnerRef', surface.surfaceOwnerRef],
    ['displayOwnerRef', surface.displayOwnerRef],
    ['surfaceTransportRef', surface.surfaceTransportRef],
    ['frameStreamRef', surface.frameStreamRef],
  ];
  const missing = required.find(([, value]) => !value?.trim())?.[0];
  if (missing) return `Native Host adapter surface is missing ${missing}.`;
  if (surface.sessionRef !== session.sessionRef) return 'Native Host adapter surface sessionRef does not match host session.';
  if (surface.screenRef !== target.screenRef) return 'Native Host adapter surface screenRef does not match target screen.';
  if (surface.targetWindowRef !== target.targetWindowRef) return 'Native Host adapter surface targetWindowRef does not match target window.';
  if (surface.targetAppRef !== session.app?.appRef) return 'Native Host adapter surface targetAppRef does not match host app.';
  if (surface.surfaceTransport !== target.transport) return 'Native Host adapter surface transport does not match requested transport.';
  if (!Number.isFinite(surface.currentFrameSequence) || surface.currentFrameSequence < 0) {
    return 'Native Host adapter surface currentFrameSequence is invalid.';
  }
  return undefined;
}

function validateAdapterFrame(session: NativeHostSession, frame: NativeHostFrame): string | undefined {
  if (!session.surface) return 'Native Host adapter frame has no attached surface.';
  if (!frame.frameRef?.trim()) return 'Native Host adapter frameRef is missing.';
  if (!/^[a-f0-9]{64}$/iu.test(frame.frameHash)) return 'Native Host adapter frameHash is invalid.';
  if (!Number.isFinite(frame.frameSequence) || frame.frameSequence < 0) return 'Native Host adapter frameSequence is invalid.';
  if (frame.frameSequence < session.surface.currentFrameSequence) return 'Native Host adapter frameSequence moved backwards.';
  if (frame.liveSurfaceRef !== session.surface.liveSurfaceRef) return 'Native Host adapter frame liveSurfaceRef does not match surface.';
  if (frame.frameStreamRef !== session.surface.frameStreamRef) return 'Native Host adapter frameStreamRef does not match surface.';
  return undefined;
}

function compactRefs(refs: NativeHostLedgerRefs): NativeHostLedgerRefs {
  return Object.fromEntries(
    Object.entries(refs).filter(([, value]) => value !== undefined),
  ) as NativeHostLedgerRefs;
}

function unsafeRefsIssue(refs: NativeHostLedgerRefs | NativeHostPermissionLedgerRequest): {
  code: 'ui-owned-source-blocked' | 'fixture-live-source-blocked';
  message: string;
} | undefined {
  for (const [key, value] of Object.entries(refs)) {
    if (typeof value !== 'string') continue;
    if (/^(ui|gui-viewer|screen-pane):/iu.test(value)) {
      return {
        code: 'ui-owned-source-blocked',
        message: `Native Host refuses UI-owned permission ledger ref ${key}.`,
      };
    }
    if (/^(fixture|replay-fixture|snapshot-fixture):/iu.test(value)) {
      return {
        code: 'fixture-live-source-blocked',
        message: `Native Host refuses fixture-owned permission ledger ref ${key}.`,
      };
    }
  }
  return undefined;
}

function resumePermissionBarrierIssue(
  ledger: NativeHostEvidenceLedger,
  barrier: NativeHostAutomationBarrier,
): string | undefined {
  const latestHandoff = ledger.entries.findLast((entry) => entry.type === 'permission.handoff');
  if (!latestHandoff) return undefined;
  const latestRecheck = ledger.entries.findLast((entry) =>
    entry.type === 'permission.recheck' && entry.sequence > latestHandoff.sequence);
  const recheckRef = latestRecheck?.refs.recheckRef;
  if (!recheckRef) {
    return 'Resume after permission handoff requires a later Native Host permission recheck ledger event.';
  }
  if (barrier.resumeAfterPermissionRecheckRef !== recheckRef) {
    return 'Resume barrier must reference the latest Native Host permission recheck ref.';
  }
  return undefined;
}
