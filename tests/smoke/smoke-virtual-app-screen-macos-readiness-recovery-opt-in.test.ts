import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  InMemoryNativeVirtualAppScreenHost,
  type NativeHostAppProfile,
  type NativeHostAutomationBarrier,
  type NativeHostFrame,
  type NativeHostLiveSurface,
  type NativeHostReadinessRecord,
  type NativeHostResult,
  type NativeHostSession,
  type NativeHostSurfaceTarget,
  type NativeVirtualAppScreenHostDescription,
  type NativeVirtualAppScreenPlatformAdapter,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';
import {
  MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
  createMacosVirtualDisplayProvider,
} from '../../src/runtime/computer-use/native-providers/macos-virtual-display-provider.js';
import {
  createMacosVirtualDisplayDriverHooks,
} from '../../src/runtime/computer-use/native-providers/macos-virtual-display-driver.js';
import {
  createVirtualAppScreenNativeExecutor,
} from '../../src/runtime/computer-use/virtual-app-screen-native-executor.js';
import {
  parseVirtualAppScreenRuntimeCommand,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import type {
  VirtualDisplayProviderInvokeResult,
  VirtualDisplayReadiness,
} from '../../src/runtime/computer-use/virtual-display-provider.js';

const READINESS_RECOVERY_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_READINESS_RECOVERY';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';

test('macOS real adapter readiness recovery smoke is opt-in and fail-closed', async () => {
  if (!readinessRecoveryOptedIn()) {
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-macos-readiness-recovery-smoke.v1',
      status: 'not-run',
      optInEnv: READINESS_RECOVERY_OPT_IN_ENV,
      startsBlockedPermissionMissing: true,
      recordsHandoffRecheck: true,
      requiresRecoveredReadinessBeforeResume: true,
      verificationCommand: `${READINESS_RECOVERY_OPT_IN_ENV}=1 node --import tsx --test tests/smoke/smoke-virtual-app-screen-macos-readiness-recovery-opt-in.test.ts`,
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.optInEnv, READINESS_RECOVERY_OPT_IN_ENV);
    assert.equal(manifest.requiresRecoveredReadinessBeforeResume, true);
    return;
  }

  assert.equal(
    process.platform,
    'darwin',
    `${READINESS_RECOVERY_OPT_IN_ENV}=1 requires macOS; current platform is ${process.platform}.`,
  );

  const targetKind = process.env[TARGET_KIND_ENV]?.trim() || 'generic-editor';
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-macos-readiness-recovery-'));
  const permissionGrants: Record<string, boolean> = {
    'permission:macos/screen-recording': false,
    'permission:macos/accessibility': false,
  };
  const probeOptions = {
    targetAppKind: targetKind,
    permissionGrants,
  };
  const provider = createMacosVirtualDisplayProvider({
    hooks: createMacosVirtualDisplayDriverHooks({
      outDir,
      probeOptions,
    }),
    probeOptions,
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:macos-readiness-recovery-opt-in-smoke',
    providerId: MACOS_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: [targetKind],
    provider,
    targetAppKind: targetKind,
  });

  try {
    const blockedAttach = await executor.attach(parsedAttachCommand(targetKind, 'initial'));
    assert.notEqual(blockedAttach.status, 'attached');
    assert.equal(blockedAttach.evidence.nativeSessionCreated, false);
    assert.equal(blockedAttach.evidence.mutatingActionExecuted, false);
    assert.doesNotMatch(blockedAttach.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\//u);

    if (blockedAttach.status !== 'permission-missing') {
      assert.match(
        blockedAttach.blockedReason ?? '',
        /node-mac-virtual-display|screencapture|permission|Accessibility|Screen Recording|not ready|not available/u,
      );
      return;
    }

    const missingReadinessRef = blockedAttach.refs.adapterReadinessRef;
    assert.match(missingReadinessRef, /virtual-display-provider\/adapter-readiness\.json$/u);

    permissionGrants['permission:macos/screen-recording'] = true;
    permissionGrants['permission:macos/accessibility'] = true;
    const recoveredSessionProbe = await provider.probe({ runId: 'macos-readiness-recovery-session', targetAppKind: targetKind });
    if (recoveredSessionProbe.status !== 'ready') {
      assert.notEqual(recoveredSessionProbe.status, 'ready');
      assert.match(
        recoveredSessionProbe.blockedReason ?? '',
        /node-mac-virtual-display|screencapture|permission|Accessibility|Screen Recording|not ready|not available/u,
      );
      return;
    }

    const adapter = new ReprobingMacosReadinessAdapter(
      targetKind,
      nativeReadinessFromProbe(recoveredSessionProbe, 'session'),
    );
    const host = new InMemoryNativeVirtualAppScreenHost(adapter);
    const session = createAttachedHostSession(host, targetKind);
    assert.notEqual(session.readiness.adapterReadinessRef, missingReadinessRef);

    const paused = await host.pauseAgent(session.sessionId, 'permission recovery handoff');
    assert.equal(paused.status, 'ok');

    permissionGrants['permission:macos/screen-recording'] = false;
    const handoffProbe = await provider.probe({ runId: 'macos-readiness-recovery-handoff', targetAppKind: targetKind });
    assert.equal(handoffProbe.status, 'permission-missing', handoffProbe.blockedReason);
    adapter.setReadiness(nativeReadinessFromProbe(handoffProbe, 'handoff'));

    const handoff = host.recordPermissionHandoff(session.sessionId, {
      permissionHandoffRef: 'computer-use:native-host/permissions/macos-readiness-recovery/handoff.json',
      recheckRef: 'computer-use:native-host/permissions/macos-readiness-recovery/recheck.json',
      permissionRef: 'permission:macos/screen-recording',
      blockedRef: 'computer-use:native-host/blocked/macos-readiness-recovery/permission-missing.json',
    });
    assert.equal(handoff.status, 'ok');
    assert.equal(handoff.value.type, 'permission.handoff');
    assert.equal(handoff.value.refs.adapterReadinessRef, adapter.readiness.adapterReadinessRef);

    const beforeRecheck = await host.resumeAgent(session.sessionId, {
      barrierRef: 'computer-use:native-host/permissions/macos-readiness-recovery/barriers/before-recheck.json',
      currentRunRef: session.evidenceContext.currentRunRef,
      requiredReadinessRef: adapter.readiness.adapterReadinessRef,
    });
    assert.equal(beforeRecheck.status, 'blocked');
    assert.match(beforeRecheck.error.message, /permission recheck/u);

    permissionGrants['permission:macos/screen-recording'] = true;
    const recheckProbe = await provider.probe({ runId: 'macos-readiness-recovery-recheck', targetAppKind: targetKind });
    assert.equal(recheckProbe.status, 'ready', recheckProbe.blockedReason);
    adapter.setReadiness(nativeReadinessFromProbe(recheckProbe, 'recheck'));

    const recheck = host.recordPermissionRecheck(session.sessionId, {
      permissionHandoffRef: 'computer-use:native-host/permissions/macos-readiness-recovery/handoff.json',
      recheckRef: 'computer-use:native-host/permissions/macos-readiness-recovery/recheck.json',
      permissionRef: 'permission:macos/screen-recording',
    });
    assert.equal(recheck.status, 'ok');
    assert.equal(recheck.value.type, 'permission.recheck');
    assert.notEqual(recheck.value.refs.adapterReadinessRef, handoff.value.refs.adapterReadinessRef);
    assert.equal(recheck.value.refs.adapterReadinessRef, adapter.readiness.adapterReadinessRef);

    const staleResume = await host.resumeAgent(session.sessionId, resumeBarrier(
      session,
      'stale',
      handoff.value.refs.adapterReadinessRef as string,
      recheck.value.refs.recheckRef as string,
    ));
    assert.equal(staleResume.status, 'blocked');
    assert.match(staleResume.error.message, /current provider readiness/u);

    const recoveredResume = await host.resumeAgent(session.sessionId, resumeBarrier(
      session,
      'recovered',
      recheck.value.refs.adapterReadinessRef as string,
      recheck.value.refs.recheckRef as string,
    ));
    assert.equal(recoveredResume.status, 'ok');

    const ledger = host.getLedger(session.sessionId);
    assert.ok(ledger);
    const ledgerTypes = ledger.entries.map((entry) => entry.type);
    const handoffIndex = ledgerTypes.lastIndexOf('permission.handoff');
    const recheckIndex = ledgerTypes.lastIndexOf('permission.recheck');
    const resumeIndex = ledgerTypes.lastIndexOf('agent.resumed');
    const frameAfterResumeIndex = ledgerTypes.findIndex((type, index) => index > resumeIndex && type === 'frame.read');
    assert.ok(handoffIndex >= 0, 'ledger must include permission.handoff.');
    assert.ok(recheckIndex > handoffIndex, 'ledger must record permission.recheck after handoff.');
    assert.ok(resumeIndex > recheckIndex, 'ledger must resume only after recovered permission recheck.');
    assert.ok(frameAfterResumeIndex > resumeIndex, 'ledger must refresh a frame after resume.');
    const validation = host.validateLedger(session.sessionId, {
      requireFrame: true,
      requireGrantValidation: true,
      requirePermissionHandoff: true,
      requirePermissionRecheck: true,
    });
    assert.equal(validation.ok, true, validation.issues.join('\n'));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

function readinessRecoveryOptedIn(): boolean {
  return /^(1|true|yes|on)$/iu.test(process.env[READINESS_RECOVERY_OPT_IN_ENV]?.trim() ?? '');
}

function parsedAttachCommand(targetKind: string, label: string) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${targetKind}"`,
    `--target-app-ref "app:profile/${targetKind}"`,
    `--screen-ref "virtual-app-screen:macos-readiness-recovery/${label}"`,
    `--activation-ref "computer-use:native-host/macos-readiness-recovery/${label}/attach-request.json"`,
    `--adapter-readiness-ref "computer-use:native-host/macos-readiness-recovery/${label}/adapter-readiness.json"`,
    `--evidence-ledger-ref "computer-use:native-host/macos-readiness-recovery/${label}/evidence-ledger.json"`,
    `--gui-present-ref "gui.present:macos-readiness-recovery/${label}"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function createAttachedHostSession(
  host: InMemoryNativeVirtualAppScreenHost,
  targetKind: string,
): NativeHostSession {
  const created = host.createSession(
    { profileId: targetKind, defaultSurfaceTransport: 'native-frame-stream' },
    {
      allowBackgroundRendering: true,
      allowSharedSystemInput: false,
      requestedPermissionRefs: ['permission:macos/screen-recording', 'permission:macos/accessibility'],
      providerReadinessRef: host.probe().adapterReadinessRef,
    },
    {
      currentRunRef: 'computer-use:native-host/runs/macos-readiness-recovery/current-run.json',
      evidenceRootRef: 'computer-use:native-host/runs/macos-readiness-recovery/evidence',
      guiPresentRef: 'gui.present:macos-readiness-recovery/screen-pane',
    },
  );
  assert.equal(created.status, 'ok');

  const launched = host.launchOrAttachApp(created.value.sessionId, {
    appId: targetKind,
    appRef: `app:profile/${targetKind}`,
    title: targetKind,
  });
  assert.equal(launched.status, 'ok');

  const attached = host.attachSurface(created.value.sessionId, {
    screenRef: 'virtual-app-screen:macos-readiness-recovery/screen',
    targetWindowRef: `window:macos-readiness-recovery/${targetKind}/main`,
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');

  const presented = host.presentSurface(created.value.sessionId, attached.value.liveBindingAttachGrantRef);
  assert.equal(presented.status, 'ok');
  assert.equal(presented.value.ok, true);

  const frame = host.readFrame(created.value.sessionId);
  assert.equal(frame.status, 'ok');
  return created.value;
}

function resumeBarrier(
  session: NativeHostSession,
  label: string,
  readinessRef: string,
  recheckRef: string,
): NativeHostAutomationBarrier {
  return {
    barrierRef: `computer-use:native-host/permissions/macos-readiness-recovery/barriers/resume-${label}.json`,
    currentRunRef: session.evidenceContext.currentRunRef,
    requiredReadinessRef: readinessRef,
    resumeAfterPermissionRecheckRef: recheckRef,
  };
}

function nativeReadinessFromProbe(
  probe: VirtualDisplayProviderInvokeResult,
  label: string,
): NativeHostReadinessRecord {
  assert.ok(probe.readiness, `${label} probe must expose readiness.`);
  const readiness = probe.readiness;
  const ready = probe.status === 'ready' && readiness.readinessStatus === 'ready';
  const scope = sanitizeSegment(`macos-readiness-recovery-${label}`);
  return {
    schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
    status: nativeReadinessStatus(readiness, ready),
    adapterKind: readiness.backendKind,
    platform: 'darwin',
    checkedAt: new Date().toISOString(),
    adapterReadinessRef: stringRef(probe, 'adapterReadinessRef') ?? `computer-use:native-host/readiness/${scope}.json`,
    permissionRefs: readiness.permissionRefs,
    driverRefs: ready
      ? [`computer-use:native-host/platform-drivers/${scope}/ready.json`]
      : readiness.diagnosticRefs,
    providerRefs: [
      `virtual-display-provider:${probe.providerId ?? MACOS_VIRTUAL_DISPLAY_PROVIDER_ID}`,
      stringRef(probe, 'providerProbeRef'),
    ].filter((ref): ref is string => Boolean(ref)),
    capabilities: {
      createDisplay: ready && readiness.captureSupported,
      launchApp: ready,
      attachWindow: ready && readiness.liveSurfaceSupported,
      captureFrame: ready && readiness.captureSupported,
      streamFrames: ready && readiness.liveSurfaceSupported,
      sendHumanInput: ready && readiness.inputSupported,
      executeAutomationIntent: ready && readiness.inputSupported,
      validateGrant: true,
      writeEvidenceLedger: true,
      backgroundRenderable: ready && readiness.backgroundRenderable,
      affectsPhysicalDisplay: readiness.affectsPhysicalDisplay,
      requiresFocusSteal: readiness.requiresFocusSteal,
      sharedSystemInputUsed: readiness.sharedSystemInputUsed,
    },
    diagnosticOnly: !ready,
    blockedReason: ready ? undefined : readiness.blockedReason ?? probe.blockedReason,
    handoffRef: readiness.permissions.state === 'missing'
      ? `computer-use:native-host/handoff/${scope}.json`
      : undefined,
    recheckRef: `computer-use:native-host/recheck/${scope}.json`,
  };
}

function nativeReadinessStatus(readiness: VirtualDisplayReadiness, ready: boolean): NativeHostReadinessRecord['status'] {
  if (ready) return 'ready';
  if (readiness.readinessStatus === 'permission-missing') return 'requires-handoff';
  if (readiness.installState === 'installable') return 'installable';
  if (readiness.installState === 'unsupported') return 'unsupported';
  return 'blocked';
}

function stringRef(result: VirtualDisplayProviderInvokeResult, key: string): string | undefined {
  const value = result.refs[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
  return undefined;
}

function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'ref';
}

class ReprobingMacosReadinessAdapter implements NativeVirtualAppScreenPlatformAdapter {
  constructor(
    private readonly targetKind: string,
    public readiness: NativeHostReadinessRecord,
  ) {}

  setReadiness(readiness: NativeHostReadinessRecord): void {
    this.readiness = readiness;
  }

  describe(): NativeVirtualAppScreenHostDescription {
    return {
      schemaVersion: NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
      hostId: 'native-virtual-app-screen-host.macos-readiness-recovery-smoke',
      platform: 'darwin',
      backendKind: this.readiness.adapterKind,
      protocol: [...NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL],
      supportedApps: [`app:profile/${this.targetKind}`],
      supportedTransports: ['native-frame-stream'],
      supportedInputAdapters: ['app-command', 'ax', 'virtual-display-input'],
      capabilities: this.readiness.capabilities,
      permissionRefs: this.readiness.permissionRefs,
      blockedReason: this.readiness.blockedReason,
      diagnosticOnly: this.readiness.diagnosticOnly,
      thirdPartyToolsRole: 'adapter-diagnostic-or-fallback-only',
    };
  }

  probe(): NativeHostReadinessRecord {
    return this.readiness;
  }

  launchOrAttachApp(_session: NativeHostSession, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostAppProfile> {
    return {
      status: 'ok',
      value: {
        ...appProfile,
        appRef: `computer-use:native-host/apps/macos-readiness-recovery/${this.targetKind}.json`,
      },
    };
  }

  attachSurface(session: NativeHostSession, target: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface> {
    const surfaceId = sanitizeSegment(`${session.sessionId}-${this.targetKind}`);
    return {
      status: 'ok',
      value: {
        surfaceId,
        screenRef: target.screenRef,
        targetAppRef: session.app?.appRef ?? `computer-use:native-host/apps/macos-readiness-recovery/${this.targetKind}.json`,
        targetWindowRef: target.targetWindowRef,
        sessionRef: session.sessionRef,
        liveSurfaceRef: `computer-use:native-host/surfaces/${surfaceId}/live-surface.json`,
        liveBindingAttachGrantRef: `computer-use:native-host/grants/${surfaceId}/live-binding-attach-grant.json`,
        surfaceOwnerRef: `computer-use:native-host/surfaces/${surfaceId}/surface-owner.json`,
        displayOwnerRef: `computer-use:native-host/surfaces/${surfaceId}/display-owner.json`,
        surfaceTransport: target.transport,
        surfaceTransportRef: `computer-use:native-host/surfaces/${surfaceId}/surface-transport.json`,
        frameStreamRef: `computer-use:native-host/surfaces/${surfaceId}/frame-stream.json`,
        frameTransportContractRef: `computer-use:native-host/surfaces/${surfaceId}/frame-transport-contract.json`,
        frameTelemetryRef: `computer-use:native-host/surfaces/${surfaceId}/frame-telemetry.json`,
        currentFrameSequence: 0,
      },
    };
  }

  readFrame(session: NativeHostSession): NativeHostResult<NativeHostFrame> {
    const surface = session.surface;
    if (!surface) {
      return {
        status: 'blocked',
        error: {
          code: 'surface-not-attached',
          message: 'macOS readiness recovery smoke cannot read before surface attach.',
        },
      };
    }
    const frameSequence = surface.currentFrameSequence + 1;
    return {
      status: 'ok',
      value: {
        frameRef: `computer-use:native-host/frames/${surface.surfaceId}/${String(frameSequence).padStart(4, '0')}.png`,
        frameHash: 'b'.repeat(64),
        frameSequence,
        liveSurfaceRef: surface.liveSurfaceRef,
        frameStreamRef: surface.frameStreamRef,
        readAt: new Date().toISOString(),
      },
    };
  }

  pauseAgent(session: NativeHostSession, reason: string): NativeHostResult<NativeHostSession> {
    session.profile.metadata = {
      ...(session.profile.metadata ?? {}),
      nativeHostControlEvidence: {
        agentQueueRef: `computer-use:native-host/provider-adapter-control/${session.sessionId}/pause/agent-queue.json`,
        providerEvidenceRefs: [
          `computer-use:native-host/provider-adapter-control/${session.sessionId}/pause/${sanitizeSegment(reason)}.json`,
        ],
      },
    };
    return { status: 'ok', value: session };
  }

  resumeAgent(session: NativeHostSession, barrier: NativeHostAutomationBarrier): NativeHostResult<NativeHostSession> {
    session.profile.metadata = {
      ...(session.profile.metadata ?? {}),
      nativeHostControlEvidence: {
        agentQueueRef: `computer-use:native-host/provider-adapter-control/${session.sessionId}/resume/agent-queue.json`,
        currentFrameRefreshRef: `computer-use:native-host/provider-adapter-control/${session.sessionId}/resume/current-frame-refresh.json`,
        providerEvidenceRefs: [
          barrier.barrierRef,
          `computer-use:native-host/provider-adapter-control/${session.sessionId}/resume/provider-evidence.json`,
        ],
      },
    };
    return { status: 'ok', value: session };
  }
}
