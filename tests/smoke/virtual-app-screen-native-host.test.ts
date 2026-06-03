import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ContractSmokeNativeHostPlatformAdapter,
  createDefaultProductNativeVirtualAppScreenHost,
  deriveNativeHostMinimalEvidenceReplayRefs,
  InMemoryNativeVirtualAppScreenHost,
  NATIVE_HOST_ERROR_TAXONOMY,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  validateNativeHostEvidenceLedger,
  type NativeHostAutomationBarrier,
  type NativeHostAutomationIntent,
  type NativeHostAutomationResult,
  type NativeHostAppProfile,
  type NativeHostEvidenceLedger,
  type NativeHostFrame,
  type NativeHostHumanInputAccepted,
  type NativeHostHumanInputEvent,
  type NativeHostLiveSurface,
  type NativeHostResult,
  type NativeHostReadinessRecord,
  type NativeHostSession,
  type NativeHostSurfaceTarget,
  type NativeVirtualAppScreenHostDescription,
  type NativeVirtualAppScreenPlatformAdapter,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

test('Native VirtualAppScreen Host manifest and API stay aligned', () => {
  const manifest = JSON.parse(readFileSync(
    'packages/actions/computer-use/virtual-app-screen-host/capability.manifest.json',
    'utf8',
  )) as Record<string, unknown>;
  const api = manifest.publicApi as string[];

  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.failClosed, true);
  assert.equal(manifest.productTruthOwner, true);
  assert.deepEqual(api, [...NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL]);
  assert.deepEqual(manifest.thirdPartyToolsRole, 'adapter-diagnostic-or-fallback-only');
  assert.ok(Object.values(NATIVE_HOST_ERROR_TAXONOMY).flat().includes('ui-owned-source-blocked'));
  assert.ok(Object.values(NATIVE_HOST_ERROR_TAXONOMY).flat().includes('fixture-live-source-blocked'));
});

test('Native Host defaults to fail-closed when no platform adapter is registered', () => {
  const host = new InMemoryNativeVirtualAppScreenHost();
  const description = host.describe();
  const readiness = host.probe();
  const session = host.createSession(
    { profileId: 'default-vscode' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    { currentRunRef: 'run:fail-closed', evidenceRootRef: 'evidence:fail-closed' },
  );

  assert.equal(description.schemaVersion, NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION);
  assert.equal(description.blockedReason, 'No Native VirtualAppScreen platform adapter is registered.');
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.diagnosticOnly, true);
  assert.equal(session.status, 'blocked');
  assert.equal(session.error.code, 'provider-unavailable');
});

test('Native Host product selector only chooses a non-diagnostic isolated adapter for the default attach path', () => {
  const diagnosticHost = createDefaultProductNativeVirtualAppScreenHost([
    new ContractSmokeNativeHostPlatformAdapter(),
  ]);
  assert.equal(diagnosticHost.describe().backendKind, 'no-product-platform-adapter');
  assert.match(diagnosticHost.describe().blockedReason ?? '', /No product-ready Native VirtualAppScreen platform adapter/);
  assert.equal(diagnosticHost.probe().status, 'blocked');
  assert.equal(diagnosticHost.probe().diagnosticOnly, true);
  assert.match(diagnosticHost.probe().blockedReason ?? '', /contract-smoke-adapter is diagnostic-only/);

  const selectedHost = createDefaultProductNativeVirtualAppScreenHost([
    new ContractSmokeNativeHostPlatformAdapter(),
    new ProductReadySmokeAdapter(),
  ]);
  assert.equal(selectedHost.describe().backendKind, 'product-ready-smoke-adapter');
  assert.equal(selectedHost.describe().diagnosticOnly, false);
  assert.equal(selectedHost.probe().status, 'ready');
  assert.equal(selectedHost.probe().diagnosticOnly, false);

  const created = selectedHost.createSession(
    { profileId: 'vscode-editor' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:native-host/runs/product-selector/current-run.json',
      evidenceRootRef: 'computer-use:native-host/runs/product-selector/evidence',
    },
  );
  assert.equal(created.status, 'ok');
  assert.equal(created.value.readiness.diagnosticOnly, false);
});

test('Native Host records current-run preflight readiness without creating a session', () => {
  const host = new InMemoryNativeVirtualAppScreenHost();

  assert.equal(NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL.includes('recordPreflight' as never), true);
  assert.equal(typeof (host as { recordPreflight?: unknown }).recordPreflight, 'function');

  const preflight = (host as unknown as {
    recordPreflight(request: {
      currentRunRef: string;
      evidenceRootRef: string;
      currentRunPointerRef: string;
    }): NativeHostResult<{
      preflightRef: string;
      preflightLedgerRef: string;
      preflightLedgerEntryRef: string;
      currentRunRef: string;
      currentRunPointerRef: string;
      adapterReadinessRef: string;
      hostReadinessRef: string;
      status: string;
      diagnosticOnly: boolean;
      permissionRefs: string[];
      driverRefs: string[];
      providerRefs: string[];
      blockedRef?: string;
      handoffRef?: string;
      recheckRef?: string;
    }>;
  }).recordPreflight({
    currentRunRef: 'computer-use:run/native-host-preflight/current-run.json',
    evidenceRootRef: 'computer-use:run/native-host-preflight/evidence',
    currentRunPointerRef: 'computer-use:run/native-host-preflight/current-run-pointer.json',
  });

  assert.equal(preflight.status, 'ok');
  assert.equal(preflight.value.status, 'blocked');
  assert.equal(preflight.value.currentRunRef, 'computer-use:run/native-host-preflight/current-run.json');
  assert.equal(preflight.value.currentRunPointerRef, 'computer-use:run/native-host-preflight/current-run-pointer.json');
  assert.match(preflight.value.preflightRef, /^computer-use:native-host\/preflights\/preflight-\d+\/preflight\.json$/u);
  assert.match(preflight.value.adapterReadinessRef, /^computer-use:native-host\/preflights\/preflight-\d+\/adapter-readiness\.json$/u);
  assert.match(preflight.value.hostReadinessRef, /^computer-use:native-host\/preflights\/preflight-\d+\/host-readiness\.json$/u);
  assert.match(preflight.value.blockedRef ?? '', /^computer-use:native-host\/preflights\/preflight-\d+\/blocked\.json$/u);
  assert.match(preflight.value.handoffRef ?? '', /^computer-use:native-host\/preflights\/preflight-\d+\/handoff\.json$/u);
  assert.match(preflight.value.recheckRef ?? '', /^computer-use:native-host\/preflights\/preflight-\d+\/recheck\.json$/u);
  assert.equal(preflight.value.diagnosticOnly, true);
  assert.match(preflight.value.preflightLedgerRef, /^computer-use:native-host\/preflights\/preflight-\d+\/preflight-ledger\.json$/u);
  assert.match(preflight.value.preflightLedgerEntryRef, /^computer-use:native-host\/preflights\/preflight-\d+\/preflight-ledger\.json\/events\/0001-preflight\.recorded\.json$/u);
  assert.deepEqual(preflight.value.permissionRefs, []);
  assert.deepEqual(preflight.value.driverRefs, []);
  assert.deepEqual(preflight.value.providerRefs, []);

  const ledger = (host as {
    getPreflightLedger(preflightRef: string): NativeHostEvidenceLedger | undefined;
    validatePreflightLedger(preflightRef: string): { ok: boolean; issues: string[] };
  }).getPreflightLedger(preflight.value.preflightRef);
  assert.ok(ledger);
  assert.equal(ledger.sessionId, 'preflight-1');
  assert.equal(ledger.sessionRef, preflight.value.preflightRef);
  assert.equal(ledger.currentRunRef, preflight.value.currentRunRef);
  assert.equal(ledger.currentRunPointerRef, preflight.value.currentRunPointerRef);
  assert.deepEqual(ledger.entries.map((entry) => entry.type), ['preflight.recorded']);
  assert.equal(ledger.entries[0].refs.preflightRef, preflight.value.preflightRef);
  assert.equal(ledger.entries[0].refs.preflightLedgerRef, preflight.value.preflightLedgerRef);
  assert.equal(ledger.entries[0].refs.preflightLedgerEntryRef, preflight.value.preflightLedgerEntryRef);
  assert.equal(ledger.entries[0].refs.hostReadinessRef, preflight.value.hostReadinessRef);
  assert.equal(ledger.entries[0].refs.adapterReadinessRef, preflight.value.adapterReadinessRef);
  const ledgerValidation = (host as {
    validatePreflightLedger(preflightRef: string): { ok: boolean; issues: string[] };
  }).validatePreflightLedger(preflight.value.preflightRef);
  assert.equal(ledgerValidation.ok, true, ledgerValidation.issues.join('\n'));

  const pollutedLedger = cloneLedger(ledger);
  pollutedLedger.ledgerRef = 'ledger:computer-use/native-host-preflight/preflight-ledger.json';
  pollutedLedger.sessionRef = 'computer-use:screen-activation/native-host-preflight/preflight.json';
  pollutedLedger.entries[0] = {
    ...pollutedLedger.entries[0],
    eventRef: 'ledger:computer-use/native-host-preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
    refs: {
      ...pollutedLedger.entries[0].refs,
      preflightRef: 'computer-use:screen-activation/native-host-preflight/preflight.json',
      preflightLedgerRef: 'computer-use:native-host/readiness/native-host-preflight/preflight-ledger.json',
      preflightLedgerEntryRef: 'computer-use:native-host/readiness/native-host-preflight/preflight-ledger.json/events/0001-preflight.recorded.json',
      hostReadinessRef: 'computer-use:native-host/readiness/native-host-preflight/host-readiness.json',
      adapterReadinessRef: 'computer-use:native-host/readiness/native-host-preflight/adapter-readiness.json',
    },
  };
  const pollutedValidation = validateNativeHostEvidenceLedger(pollutedLedger, { scope: 'preflight' });
  assert.equal(pollutedValidation.ok, false);
  assert.ok(pollutedValidation.issues.some((issue) => issue.includes('ledgerRef must be a Host-owned preflight ref')));
  assert.ok(pollutedValidation.issues.some((issue) => issue.includes('preflight.recorded preflightRef must be a Host-owned preflight ref')));
  assert.ok(pollutedValidation.issues.some((issue) => issue.includes('preflight.recorded preflightLedgerRef must equal ledgerRef')));
  assert.ok(pollutedValidation.issues.some((issue) => issue.includes('preflight.recorded preflightLedgerEntryRef must equal eventRef')));

  const uiOwned = (host as {
    recordPreflight(request: {
      currentRunRef: string;
      evidenceRootRef: string;
      requestedPermissionRefs: string[];
    }): NativeHostResult<unknown>;
  }).recordPreflight({
    currentRunRef: 'computer-use:run/native-host-preflight/current-run.json',
    evidenceRootRef: 'computer-use:run/native-host-preflight/evidence',
    requestedPermissionRefs: ['ui:permission/native-host-placeholder'],
  });
  assert.equal(uiOwned.status, 'blocked');
  assert.equal(uiOwned.error.code, 'ui-owned-source-blocked');
});

test('Native Host preflight records permission driver and provider readiness without attached session', () => {
  const host = new InMemoryNativeVirtualAppScreenHost();
  const preflight = host.recordPreflight({
    currentRunRef: 'computer-use:run/native-host-preflight-readiness/current-run.json',
    evidenceRootRef: 'computer-use:run/native-host-preflight-readiness/evidence',
    currentRunPointerRef: 'computer-use:run/native-host-preflight-readiness/current-run-pointer.json',
    requestedPermissionRefs: ['permission:macos/screen-recording'],
    platformDriverRef: 'computer-use:native-host/platform-drivers/preflight-readiness/driver.json',
    providerReadinessRef: 'computer-use:native-host/providers/preflight-readiness/provider-readiness.json',
  });

  assert.equal(preflight.status, 'ok');
  assert.deepEqual(preflight.value.permissionRefs, ['permission:macos/screen-recording']);
  assert.deepEqual(preflight.value.driverRefs, ['computer-use:native-host/platform-drivers/preflight-readiness/driver.json']);
  assert.deepEqual(preflight.value.providerRefs, ['computer-use:native-host/providers/preflight-readiness/provider-readiness.json']);

  const ledger = host.getPreflightLedger(preflight.value.preflightRef);
  assert.ok(ledger);
  assert.deepEqual(ledger.entries.map((entry) => entry.type), ['preflight.recorded']);
  assert.equal(ledger.entries[0].refs.permissionRef, 'permission:macos/screen-recording');
  assert.equal(ledger.entries[0].refs.platformDriverRef, 'computer-use:native-host/platform-drivers/preflight-readiness/driver.json');
  assert.equal(ledger.entries[0].refs.providerReadinessSummaryRef, 'computer-use:native-host/providers/preflight-readiness/provider-readiness.json');
  assert.equal(ledger.entries.some((entry) => entry.type === 'session.created'), false);
  assert.equal(ledger.entries.some((entry) => entry.type === 'app.launched'), false);
  assert.equal(ledger.entries.some((entry) => entry.type === 'surface.attached'), false);

  const validation = host.validatePreflightLedger(preflight.value.preflightRef);
  assert.equal(validation.ok, true, validation.issues.join('\n'));
});

test('Native Host contract smoke owns session, grant, human input, automation barrier, and ledger chain', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const created = host.createSession(
    { profileId: 'contract-smoke-vscode', defaultSurfaceTransport: 'native-frame-stream' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:run/native-host-smoke/current-run.json',
      evidenceRootRef: 'computer-use:run/native-host-smoke/evidence',
      currentRunPointerRef: 'computer-use:run/native-host-smoke/current-run-pointer.json',
      guiPresentRef: 'gui.present:native-host-smoke/screen-pane',
    },
  );
  assert.equal(created.status, 'ok');

  const launched = host.launchOrAttachApp(created.value.sessionId, {
    appId: 'vscode',
    appRef: 'app:profile/vscode-editor',
    title: 'VS Code contract smoke',
  });
  assert.equal(launched.status, 'ok');

  const attached = host.attachSurface(created.value.sessionId, {
    screenRef: 'virtual-app-screen:native-host-smoke/screen-a',
    targetWindowRef: 'window:vscode-editor/main',
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');
  assert.equal(attached.value.sessionRef, created.value.sessionRef);
  assert.match(attached.value.liveBindingAttachGrantRef, /live-binding-attach-grant\.json$/);

  const presented = host.presentSurface(created.value.sessionId, attached.value.liveBindingAttachGrantRef);
  assert.equal(presented.status, 'ok');
  assert.equal(presented.value.ok, true);
  assert.equal(presented.value.liveSurfaceRef, attached.value.liveSurfaceRef);

  const firstFrame = host.readFrame(created.value.sessionId);
  assert.equal(firstFrame.status, 'ok');
  assert.equal(firstFrame.value.frameSequence, 1);
  assert.match(firstFrame.value.frameHash, /^[a-f0-9]{64}$/);

  const humanInput = await host.sendHumanInput(created.value.sessionId, {
    kind: 'click',
    screenRef: attached.value.screenRef,
    targetWindowRef: attached.value.targetWindowRef,
    xRatio: 0.25,
    yRatio: 0.5,
    inputIntentRef: 'computer-use:run/native-host-smoke/input-intents/click.json',
  });
  assert.equal(humanInput.status, 'ok');
  assert.equal(humanInput.value.fireAndRelease, true);
  assert.equal(humanInput.value.evidenceWillCatchUp, true);
  assert.equal(humanInput.value.inputSequence, 1);

  const inputEntry = host.getLedger(created.value.sessionId)?.entries.find((entry) => entry.type === 'human-input.accepted');
  assert.equal(inputEntry?.refs.beforeFrameRef, firstFrame.value.frameRef);
  assert.equal(inputEntry?.refs.currentFrameRef, firstFrame.value.frameRef);
  assert.match(inputEntry?.refs.inputAcceptedRef ?? '', /^computer-use:native-host\/inputs\//);

  const automation = await host.executeAutomationIntent(
    created.value.sessionId,
    {
      intentRef: 'computer-use:run/native-host-smoke/automation/type-marker.json',
      kind: 'type-marker',
      targetWindowRef: attached.value.targetWindowRef,
      beforeFrameRef: firstFrame.value.frameRef,
      verifierRef: 'computer-use:run/native-host-smoke/verifier/type-marker.json',
    },
    {
      barrierRef: 'computer-use:run/native-host-smoke/barriers/type-marker.json',
      currentRunRef: created.value.evidenceContext.currentRunRef,
      requiredReadinessRef: created.value.readiness.adapterReadinessRef,
    },
  );
  assert.equal(automation.status, 'ok');
  assert.equal(automation.value.beforeFrameRef, firstFrame.value.frameRef);
  assert.ok(automation.value.afterFrameRef);
  assert.equal(automation.value.evidenceLedgerRef, created.value.ledgerRef);

  assert.equal((await host.pauseAgent(created.value.sessionId, 'human takeover')).status, 'ok');
  assert.equal((await host.resumeAgent(created.value.sessionId, {
    barrierRef: 'computer-use:run/native-host-smoke/barriers/resume.json',
    currentRunRef: created.value.evidenceContext.currentRunRef,
    requiredReadinessRef: created.value.readiness.adapterReadinessRef,
  })).status, 'ok');
  assert.equal((await host.closeSession(created.value.sessionId)).status, 'ok');

  const ledger = host.getLedger(created.value.sessionId);
  assert.ok(ledger);
  const validation = validateNativeHostEvidenceLedger(ledger, {
    requireFrame: true,
    requireHumanInput: true,
    requireAutomationBarrier: true,
    requireGrantValidation: true,
  });
  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.deepEqual(ledger.entries.map((entry) => entry.type), [
    'session.created',
    'app.launched',
    'surface.attached',
    'grant.validated',
    'frame.read',
    'human-input.accepted',
    'frame.read',
    'automation.barrier-completed',
    'agent.paused',
    'agent.resumed',
    'frame.read',
    'session.closed',
  ]);
  assert.ok(ledger.currentRunPointerRef.startsWith('computer-use:native-host/'));
  assert.deepEqual(deriveNativeHostMinimalEvidenceReplayRefs(ledger), [
    ledger.entries[0].eventRef,
    ledger.entries[2].eventRef,
    ledger.entries[3].eventRef,
    ledger.entries[4].eventRef,
    ledger.entries[5].eventRef,
    ledger.entries[8].eventRef,
    ledger.entries[9].eventRef,
    ledger.entries[10].eventRef,
  ]);
});

test('Native Host validation fails closed when human input lacks Host frame before/current evidence', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  const frame = host.readFrame(session.sessionId);
  assert.equal(frame.status, 'ok');

  const humanInput = await host.sendHumanInput(session.sessionId, {
    kind: 'click',
    screenRef: surface.screenRef,
    targetWindowRef: surface.targetWindowRef,
    xRatio: 0.2,
    yRatio: 0.4,
    inputIntentRef: 'computer-use:run/native-host-human-input-evidence/input-intents/click.json',
  });
  assert.equal(humanInput.status, 'ok');

  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger);
  const valid = validateNativeHostEvidenceLedger(ledger, { requireHumanInput: true });
  assert.equal(valid.ok, true, valid.issues.join('\n'));

  const missingBefore = cloneLedger(ledger);
  const inputEntry = missingBefore.entries.find((entry) => entry.type === 'human-input.accepted');
  assert.ok(inputEntry);
  delete inputEntry.refs.beforeFrameRef;
  const beforeValidation = validateNativeHostEvidenceLedger(missingBefore, { requireHumanInput: true });
  assert.equal(beforeValidation.ok, false);
  assert.ok(beforeValidation.issues.some((issue) => issue.includes('human-input.accepted beforeFrameRef is required')));

  const missingCurrent = cloneLedger(ledger);
  const currentInputEntry = missingCurrent.entries.find((entry) => entry.type === 'human-input.accepted');
  assert.ok(currentInputEntry);
  delete currentInputEntry.refs.currentFrameRef;
  const currentValidation = validateNativeHostEvidenceLedger(missingCurrent, { requireHumanInput: true });
  assert.equal(currentValidation.ok, false);
  assert.ok(currentValidation.issues.some((issue) => issue.includes('human-input.accepted currentFrameRef is required')));
});

test('Native Host blocks automation while paused and after safe stop or close', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  const frame = host.readFrame(session.sessionId);
  assert.equal(frame.status, 'ok');

  const paused = await host.pauseAgent(session.sessionId, 'human takeover');
  assert.equal(paused.status, 'ok');
  const pausedAutomation = await host.executeAutomationIntent(
    session.sessionId,
    automationIntentFor(surface.targetWindowRef, frame.value.frameRef, 'paused'),
    automationBarrierFor(session, 'paused'),
  );
  assert.equal(pausedAutomation.status, 'blocked');
  assert.equal(pausedAutomation.error.code, 'session-paused');

  const resumed = await host.resumeAgent(session.sessionId, automationBarrierFor(session, 'resume'));
  assert.equal(resumed.status, 'ok');
  const resumedFrame = host.readFrame(session.sessionId);
  assert.equal(resumedFrame.status, 'ok');
  const activeAutomation = await host.executeAutomationIntent(
    session.sessionId,
    automationIntentFor(surface.targetWindowRef, resumedFrame.value.frameRef, 'active'),
    automationBarrierFor(session, 'active'),
  );
  assert.equal(activeAutomation.status, 'ok');

  const stopped = await host.stop(session.sessionId, 'safe stop');
  assert.equal(stopped.status, 'ok');
  const stoppedAutomation = await host.executeAutomationIntent(
    session.sessionId,
    automationIntentFor(surface.targetWindowRef, resumedFrame.value.frameRef, 'stopped'),
    automationBarrierFor(session, 'stopped'),
  );
  assert.equal(stoppedAutomation.status, 'blocked');
  assert.equal(stoppedAutomation.error.code, 'session-stopped');

  const closedHost = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const closedSession = createAttachedHostSession(closedHost);
  assert.ok(closedSession.surface);
  const closedFrame = closedHost.readFrame(closedSession.sessionId);
  assert.equal(closedFrame.status, 'ok');
  const closed = await closedHost.closeSession(closedSession.sessionId);
  assert.equal(closed.status, 'ok');
  const closedAutomation = await closedHost.executeAutomationIntent(
    closedSession.sessionId,
    automationIntentFor(closedSession.surface.targetWindowRef, closedFrame.value.frameRef, 'closed'),
    automationBarrierFor(closedSession, 'closed'),
  );
  assert.equal(closedAutomation.status, 'blocked');
  assert.equal(closedAutomation.error.code, 'session-closed');
});

test('Native Host blocks in-flight automation completion when human takeover pauses the agent', async () => {
  let releaseAutomation: ((result: NativeHostResult<NativeHostAutomationResult>) => void) | undefined;
  class SlowAutomationAdapter extends ContractSmokeNativeHostPlatformAdapter {
    executeAutomationIntent(
      _session: NativeHostSession,
      _intent: NativeHostAutomationIntent,
      _barrier: NativeHostAutomationBarrier,
    ): Promise<NativeHostResult<NativeHostAutomationResult>> {
      return new Promise((resolve) => {
        releaseAutomation = resolve;
      });
    }
  }

  const host = new InMemoryNativeVirtualAppScreenHost(new SlowAutomationAdapter());
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  const frame = host.readFrame(session.sessionId);
  assert.equal(frame.status, 'ok');

  const automation = host.executeAutomationIntent(
    session.sessionId,
    automationIntentFor(surface.targetWindowRef, frame.value.frameRef, 'in-flight'),
    automationBarrierFor(session, 'in-flight'),
  ) as Promise<NativeHostResult<NativeHostAutomationResult>>;

  const paused = await host.pauseAgent(session.sessionId, 'human takeover');
  assert.equal(paused.status, 'ok');
  assert.ok(releaseAutomation);
  releaseAutomation({
    status: 'ok',
    value: {
      automationBarrierRef: automationBarrierFor(session, 'in-flight').barrierRef,
      beforeFrameRef: frame.value.frameRef,
      afterFrameRef: 'provider:automation/after-frame.json',
      verifierRef: 'provider:automation/verifier.json',
      evidenceLedgerRef: 'provider:automation/evidence-ledger.json',
      completedAt: '2026-06-02T00:00:01.000Z',
    },
  });

  const completed = await automation;
  assert.equal(completed.status, 'blocked');
  assert.equal(completed.error.code, 'session-paused');

  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger);
  assert.equal(ledger.entries.some((entry) => entry.type === 'automation.barrier-completed'), false);
  assert.equal(ledger.entries.some((entry) => entry.type === 'agent.paused'), true);
});

test('Native Host validation requires agent queue evidence for takeover pause and resume', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  const frame = host.readFrame(session.sessionId);
  assert.equal(frame.status, 'ok');

  const paused = await host.pauseAgent(session.sessionId, 'human takeover');
  assert.equal(paused.status, 'ok');
  const resumed = await host.resumeAgent(session.sessionId, automationBarrierFor(session, 'resume'));
  assert.equal(resumed.status, 'ok');

  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger);
  const validation = validateNativeHostEvidenceLedger(ledger, {
    requireFrame: true,
    requireTakeoverQueue: true,
  });
  assert.equal(validation.ok, true, validation.issues.join('\n'));

  const missingPauseQueue = cloneLedger(ledger);
  const pauseEntry = missingPauseQueue.entries.find((entry) => entry.type === 'agent.paused');
  assert.ok(pauseEntry);
  delete pauseEntry.refs.agentQueueRef;
  const pauseValidation = validateNativeHostEvidenceLedger(missingPauseQueue, {
    requireTakeoverQueue: true,
  });
  assert.equal(pauseValidation.ok, false);
  assert.ok(pauseValidation.issues.some((issue) => issue.includes('agent.paused agentQueueRef is required')));

  const missingResumeQueue = cloneLedger(ledger);
  const resumeEntry = missingResumeQueue.entries.find((entry) => entry.type === 'agent.resumed');
  assert.ok(resumeEntry);
  delete resumeEntry.refs.agentQueueRef;
  const resumeValidation = validateNativeHostEvidenceLedger(missingResumeQueue, {
    requireTakeoverQueue: true,
  });
  assert.equal(resumeValidation.ok, false);
  assert.ok(resumeValidation.issues.some((issue) => issue.includes('agent.resumed agentQueueRef is required')));
});

test('Native Host gates human input and automation through platform adapter without exposing provider refs as truth', async () => {
  class InputAutomationAdapter extends ContractSmokeNativeHostPlatformAdapter {
    humanInputs: NativeHostHumanInputEvent[] = [];
    automations: NativeHostAutomationIntent[] = [];

    sendHumanInput(
      _session: NativeHostSession,
      inputEvent: NativeHostHumanInputEvent,
    ): NativeHostResult<NativeHostHumanInputAccepted> {
      this.humanInputs.push(inputEvent);
      return {
        status: 'ok',
        value: {
          inputAcceptedRef: 'provider:input/accepted.json',
          inputSequence: this.humanInputs.length,
          acceptedAt: '2026-06-02T00:00:00.000Z',
          fireAndRelease: true,
          evidenceWillCatchUp: true,
          providerEvidenceRefs: [
            '.sciforge/vision-runs/native-host-provider-evidence/virtual-display-provider/verification/sendInputIntent-click.json',
            '.sciforge/vision-runs/native-host-provider-evidence/virtual-display-provider/control-plane/sendInputIntent-click/isolation-evidence.json',
          ],
        },
      };
    }

    executeAutomationIntent(
      _session: NativeHostSession,
      intent: NativeHostAutomationIntent,
      barrier: NativeHostAutomationBarrier,
    ): NativeHostResult<NativeHostAutomationResult> {
      this.automations.push(intent);
      return {
        status: 'ok',
        value: {
          automationBarrierRef: barrier.barrierRef,
          beforeFrameRef: intent.beforeFrameRef,
          afterFrameRef: 'provider:automation/after-frame.json',
          verifierRef: intent.verifierRef ?? 'provider:automation/verifier.json',
          evidenceLedgerRef: 'provider:automation/evidence-ledger.json',
          completedAt: '2026-06-02T00:00:01.000Z',
        },
      };
    }
  }

  const adapter = new InputAutomationAdapter();
  const host = new InMemoryNativeVirtualAppScreenHost(adapter);
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  assert.equal(host.presentSurface(session.sessionId, surface.liveBindingAttachGrantRef).status, 'ok');
  const firstFrame = host.readFrame(session.sessionId);
  assert.equal(firstFrame.status, 'ok');

  const humanInput = await host.sendHumanInput(session.sessionId, {
    kind: 'click',
    screenRef: surface.screenRef,
    targetWindowRef: surface.targetWindowRef,
    xRatio: 0.25,
    yRatio: 0.5,
    inputIntentRef: 'computer-use:run/native-host-adapter/input-intents/click.json',
  });
  assert.equal(humanInput.status, 'ok');
  assert.equal(adapter.humanInputs.length, 1);
  assert.match(humanInput.value.inputAcceptedRef, /^computer-use:native-host\/inputs\//);
  assert.notEqual(humanInput.value.inputAcceptedRef, 'provider:input/accepted.json');

  const automation = await host.executeAutomationIntent(
    session.sessionId,
    {
      intentRef: 'computer-use:run/native-host-adapter/automation/type-marker.json',
      kind: 'type-marker',
      targetWindowRef: surface.targetWindowRef,
      beforeFrameRef: firstFrame.value.frameRef,
      verifierRef: 'computer-use:run/native-host-adapter/verifier/type-marker.json',
    },
    {
      barrierRef: 'computer-use:run/native-host-adapter/barriers/type-marker.json',
      currentRunRef: session.evidenceContext.currentRunRef,
      requiredReadinessRef: session.readiness.adapterReadinessRef,
    },
  );
  assert.equal(automation.status, 'ok');
  assert.equal(adapter.automations.length, 1);
  assert.match(automation.value.afterFrameRef, /^computer-use:native-host\/frames\//);
  assert.notEqual(automation.value.afterFrameRef, 'provider:automation/after-frame.json');

  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger);
  const inputEntry = ledger.entries.find((entry) => entry.type === 'human-input.accepted');
  const automationEntry = ledger.entries.find((entry) => entry.type === 'automation.barrier-completed');
  assert.match(inputEntry?.refs.inputAcceptedRef ?? '', /^computer-use:native-host\/inputs\//);
  assert.deepEqual(inputEntry?.refs.providerEvidenceRefs, [
    '.sciforge/vision-runs/native-host-provider-evidence/virtual-display-provider/verification/sendInputIntent-click.json',
    '.sciforge/vision-runs/native-host-provider-evidence/virtual-display-provider/control-plane/sendInputIntent-click/isolation-evidence.json',
  ]);
  assert.equal(automationEntry?.refs.automationBarrierRef, 'computer-use:run/native-host-adapter/barriers/type-marker.json');
});

test('Native Host records permission handoff and recheck as Host-owned ledger events', () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);

  const handoff = host.recordPermissionHandoff(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/recheck.json',
    permissionRef: 'permission:macos/accessibility',
    platformDriverRef: 'computer-use:native-host/platform-drivers/macos.json',
    blockedRef: 'computer-use:native-host/blocked/permission-missing.json',
  });
  assert.equal(handoff.status, 'ok');
  assert.equal(handoff.value.type, 'permission.handoff');
  assert.equal(handoff.value.refs.sessionRef, session.sessionRef);
  assert.equal(handoff.value.refs.permissionHandoffRef, 'computer-use:permissions/native-host/handoff.json');
  assert.equal(handoff.value.refs.recheckRef, 'computer-use:permissions/native-host/recheck.json');
  assert.equal(handoff.value.refs.adapterReadinessRef, session.readiness.adapterReadinessRef);
  assert.equal(handoff.value.refs.platformDriverRef, 'computer-use:native-host/platform-drivers/macos.json');
  assert.equal(handoff.value.refs.providerReadinessSummaryRef, 'computer-use:native-host/providers/contract-smoke-provider.json');

  const recheck = host.recordPermissionRecheck(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/recheck.json',
    permissionRef: 'permission:macos/accessibility',
    platformDriverRef: 'computer-use:native-host/platform-drivers/macos-recheck.json',
    providerReadinessRef: 'computer-use:native-host/providers/macos-recheck/provider-readiness.json',
  });
  assert.equal(recheck.status, 'ok');
  assert.equal(recheck.value.type, 'permission.recheck');
  assert.equal(recheck.value.refs.adapterReadinessRef, session.readiness.adapterReadinessRef);
  assert.equal(recheck.value.refs.platformDriverRef, 'computer-use:native-host/platform-drivers/macos-recheck.json');
  assert.equal(recheck.value.refs.providerReadinessSummaryRef, 'computer-use:native-host/providers/macos-recheck/provider-readiness.json');

  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger);
  assert.deepEqual(ledger.entries.slice(-2).map((entry) => entry.type), ['permission.handoff', 'permission.recheck']);
  const validation = validateNativeHostEvidenceLedger(ledger, {
    requirePermissionHandoff: true,
    requirePermissionRecheck: true,
  });
  assert.equal(validation.ok, true, validation.issues.join('\n'));

  const entryCount = ledger.entries.length;
  const uiOwned = host.recordPermissionHandoff(session.sessionId, {
    permissionHandoffRef: 'ui:permission/handoff',
  });
  assert.equal(uiOwned.status, 'blocked');
  assert.equal(uiOwned.error.code, 'ui-owned-source-blocked');
  assert.equal(ledger.entries.length, entryCount);
});

test('Native Host resume after permission recheck must use recovered readiness refs', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ReprobingReadinessAdapter());
  const session = createAttachedHostSession(host);

  const handoff = host.recordPermissionHandoff(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/reprobe/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/reprobe/recheck.json',
    permissionRef: 'permission:macos/accessibility',
  });
  assert.equal(handoff.status, 'ok');
  const staleReadinessRef = handoff.value.refs.adapterReadinessRef;

  const recheck = host.recordPermissionRecheck(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/reprobe/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/reprobe/recheck.json',
    permissionRef: 'permission:macos/accessibility',
  });
  assert.equal(recheck.status, 'ok');
  assert.notEqual(recheck.value.refs.adapterReadinessRef, staleReadinessRef);
  assert.match(recheck.value.refs.platformDriverRef ?? '', /driver-\d+\.json$/u);
  assert.match(recheck.value.refs.providerReadinessSummaryRef ?? '', /provider-\d+\.json$/u);

  const staleResume = await host.resumeAgent(session.sessionId, {
    barrierRef: 'computer-use:permissions/native-host/reprobe/barriers/resume-stale.json',
    currentRunRef: session.evidenceContext.currentRunRef,
    requiredReadinessRef: staleReadinessRef as string,
    resumeAfterPermissionRecheckRef: recheck.value.refs.recheckRef,
  });
  assert.equal(staleResume.status, 'blocked');
  assert.equal(staleResume.error.code, 'automation-barrier-not-ready');
  assert.match(staleResume.error.message, /current provider readiness/);

  const resumed = await host.resumeAgent(session.sessionId, {
    barrierRef: 'computer-use:permissions/native-host/reprobe/barriers/resume-current.json',
    currentRunRef: session.evidenceContext.currentRunRef,
    requiredReadinessRef: recheck.value.refs.adapterReadinessRef as string,
    resumeAfterPermissionRecheckRef: recheck.value.refs.recheckRef,
  });
  assert.equal(resumed.status, 'ok');
});

test('Native Host blocks agent resume after permission handoff until matching recheck barrier', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const handoff = host.recordPermissionHandoff(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/recheck.json',
    permissionRef: 'permission:macos/accessibility',
  });
  assert.equal(handoff.status, 'ok');

  const baseBarrier = {
    barrierRef: 'computer-use:permissions/native-host/barriers/resume.json',
    currentRunRef: session.evidenceContext.currentRunRef,
    requiredReadinessRef: session.readiness.adapterReadinessRef,
  };
  const beforeRecheck = await host.resumeAgent(session.sessionId, baseBarrier);
  assert.equal(beforeRecheck.status, 'blocked');
  assert.equal(beforeRecheck.error.code, 'automation-barrier-not-ready');
  assert.match(beforeRecheck.error.message, /permission recheck/);

  const recheck = host.recordPermissionRecheck(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/recheck.json',
    permissionRef: 'permission:macos/accessibility',
  });
  assert.equal(recheck.status, 'ok');
  const mismatched = await host.resumeAgent(session.sessionId, {
    ...baseBarrier,
    resumeAfterPermissionRecheckRef: 'computer-use:permissions/native-host/recheck/older.json',
  });
  assert.equal(mismatched.status, 'blocked');
  assert.equal(mismatched.error.code, 'automation-barrier-not-ready');

  const resumed = await host.resumeAgent(session.sessionId, {
    ...baseBarrier,
    resumeAfterPermissionRecheckRef: recheck.value.refs.recheckRef,
  });
  assert.equal(resumed.status, 'ok');
});

test('Native Host blocks input and automation when the platform adapter has no execution hooks', async () => {
  const contractSmoke = new ContractSmokeNativeHostPlatformAdapter();
  const adapterWithoutExecutionHooks: NativeVirtualAppScreenPlatformAdapter = {
    describe: () => contractSmoke.describe(),
    probe: () => contractSmoke.probe(),
  };
  const host = new InMemoryNativeVirtualAppScreenHost(adapterWithoutExecutionHooks);
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  assert.equal(host.presentSurface(session.sessionId, surface.liveBindingAttachGrantRef).status, 'ok');
  const firstFrame = host.readFrame(session.sessionId);
  assert.equal(firstFrame.status, 'ok');

  const humanInput = await host.sendHumanInput(session.sessionId, {
    kind: 'click',
    screenRef: surface.screenRef,
    targetWindowRef: surface.targetWindowRef,
    xRatio: 0.25,
    yRatio: 0.5,
  });
  assert.equal(humanInput.status, 'blocked');
  assert.equal(humanInput.error.code, 'provider-unavailable');

  const automation = await host.executeAutomationIntent(
    session.sessionId,
    {
      intentRef: 'computer-use:run/native-host-no-hooks/automation/type-marker.json',
      kind: 'type-marker',
      targetWindowRef: surface.targetWindowRef,
      beforeFrameRef: firstFrame.value.frameRef,
    },
    {
      barrierRef: 'computer-use:run/native-host-no-hooks/barriers/type-marker.json',
      currentRunRef: session.evidenceContext.currentRunRef,
      requiredReadinessRef: session.readiness.adapterReadinessRef,
    },
  );
  assert.equal(automation.status, 'blocked');
  assert.equal(automation.error.code, 'provider-unavailable');

  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger);
  assert.equal(ledger.entries.some((entry) => entry.type === 'human-input.accepted'), false);
  assert.equal(ledger.entries.some((entry) => entry.type === 'automation.barrier-completed'), false);
});

test('Native Host refuses non-diagnostic adapters that omit product materialization hooks', () => {
  class NonDiagnosticMissingHooksAdapter extends ContractSmokeNativeHostPlatformAdapter {
    describe() {
      return {
        ...super.describe(),
        diagnosticOnly: false,
      };
    }

    probe() {
      return {
        ...super.probe(),
        diagnosticOnly: false,
      };
    }
  }

  const host = new InMemoryNativeVirtualAppScreenHost(new NonDiagnosticMissingHooksAdapter());
  const created = host.createSession(
    { profileId: 'product-mode-missing-hooks' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    { currentRunRef: 'computer-use:run/product-mode-missing-hooks/current-run.json', evidenceRootRef: 'computer-use:run/product-mode-missing-hooks/evidence' },
  );
  assert.equal(created.status, 'ok');

  const launched = host.launchOrAttachApp(created.value.sessionId, {
    appId: 'product-mode-missing-hooks',
    appRef: 'app:product-mode-missing-hooks',
  });

  assert.equal(launched.status, 'blocked');
  assert.equal(launched.error.code, 'provider-unavailable');
  assert.match(launched.error.message, /launchOrAttachApp/);
  assert.equal(host.getLedger(created.value.sessionId)?.entries.map((entry) => entry.type).join(','), 'session.created');
});

test('Native Host blocks human input before a current frame and for a mismatched target window', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  assert.equal(host.presentSurface(session.sessionId, surface.liveBindingAttachGrantRef).status, 'ok');

  const beforeFrame = await host.sendHumanInput(session.sessionId, {
    kind: 'click',
    screenRef: surface.screenRef,
    targetWindowRef: surface.targetWindowRef,
    xRatio: 0.25,
    yRatio: 0.5,
  });
  assert.equal(beforeFrame.status, 'blocked');
  assert.equal(beforeFrame.error.code, 'missing-frame');

  assert.equal(host.readFrame(session.sessionId).status, 'ok');
  const mismatchedWindow = await host.sendHumanInput(session.sessionId, {
    kind: 'click',
    screenRef: surface.screenRef,
    targetWindowRef: 'window:other-app/main',
    xRatio: 0.25,
    yRatio: 0.5,
  });
  assert.equal(mismatchedWindow.status, 'blocked');
  assert.equal(mismatchedWindow.error.code, 'unsafe-input');
  assert.match(mismatchedWindow.error.message, /targetWindowRef/);
});

test('Native Host blocks automation and resume barriers from a stale current run', async () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const surface = session.surface;
  assert.ok(surface);
  assert.equal(host.presentSurface(session.sessionId, surface.liveBindingAttachGrantRef).status, 'ok');
  const firstFrame = host.readFrame(session.sessionId);
  assert.equal(firstFrame.status, 'ok');

  const automation = await host.executeAutomationIntent(
    session.sessionId,
    {
      intentRef: 'computer-use:run/native-host-stale-barrier/automation/type-marker.json',
      kind: 'type-marker',
      targetWindowRef: surface.targetWindowRef,
      beforeFrameRef: firstFrame.value.frameRef,
    },
    {
      barrierRef: 'computer-use:run/native-host-stale-barrier/barriers/type-marker.json',
      currentRunRef: 'computer-use:run/stale/current-run.json',
      requiredReadinessRef: session.readiness.adapterReadinessRef,
    },
  );
  assert.equal(automation.status, 'blocked');
  assert.equal(automation.error.code, 'stale-current-run');

  assert.equal((await host.pauseAgent(session.sessionId, 'human takeover')).status, 'ok');
  const resume = await host.resumeAgent(session.sessionId, {
    barrierRef: 'computer-use:run/native-host-stale-barrier/barriers/resume.json',
    currentRunRef: 'computer-use:run/stale/current-run.json',
    requiredReadinessRef: session.readiness.adapterReadinessRef,
  });
  assert.equal(resume.status, 'blocked');
  assert.equal(resume.error.code, 'stale-current-run');
});

test('Native Host ledger validator catches missing frames, UI-only refs, fixture refs, and missing grant validation', () => {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const session = createAttachedHostSession(host);
  const ledgerBeforeFrame = host.getLedger(session.sessionId);
  assert.ok(ledgerBeforeFrame);

  const missingFrame = validateNativeHostEvidenceLedger(ledgerBeforeFrame, {
    requireFrame: true,
    requireGrantValidation: true,
  });
  assert.equal(missingFrame.ok, false);
  assert.ok(missingFrame.issues.some((issue) => issue.includes('frame.read entry is required')));
  assert.ok(missingFrame.issues.some((issue) => issue.includes('grant.validated entry is required')));

  const surface = session.surface;
  assert.ok(surface);
  assert.equal(host.presentSurface(session.sessionId, surface.liveBindingAttachGrantRef).status, 'ok');
  assert.equal(host.readFrame(session.sessionId).status, 'ok');
  const validLedger = host.getLedger(session.sessionId);
  assert.ok(validLedger);

  const uiOnlyLedger = cloneLedger(validLedger);
  uiOnlyLedger.entries[2] = {
    ...uiOnlyLedger.entries[2],
    refs: {
      ...uiOnlyLedger.entries[2].refs,
      liveSurfaceRef: 'ui:screen-pane/live-surface',
    },
  };
  const uiOnly = validateNativeHostEvidenceLedger(uiOnlyLedger);
  assert.equal(uiOnly.ok, false);
  assert.ok(uiOnly.issues.some((issue) => issue.includes('UI-owned')));

  const fixtureLedger = cloneLedger(validLedger);
  fixtureLedger.entries[2] = {
    ...fixtureLedger.entries[2],
    refs: {
      ...fixtureLedger.entries[2].refs,
      frameStreamRef: 'fixture:replay/frame-stream',
    },
  };
  const fixtureOnly = validateNativeHostEvidenceLedger(fixtureLedger);
  assert.equal(fixtureOnly.ok, false);
  assert.ok(fixtureOnly.issues.some((issue) => issue.includes('fixture-owned')));

  const invalidGrant = host.presentSurface(session.sessionId, 'computer-use:native-host/grants/not-issued.json');
  assert.equal(invalidGrant.status, 'blocked');
  assert.equal(invalidGrant.error.code, 'invalid-grant');
});

function createAttachedHostSession(host: InMemoryNativeVirtualAppScreenHost) {
  const created = host.createSession(
    { profileId: 'contract-smoke' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    { currentRunRef: 'computer-use:run/native-host-negative/current-run.json', evidenceRootRef: 'computer-use:run/native-host-negative/evidence' },
  );
  assert.equal(created.status, 'ok');
  assert.equal(host.launchOrAttachApp(created.value.sessionId, {
    appId: 'contract-smoke',
    appRef: 'app:contract-smoke',
  }).status, 'ok');
  const attached = host.attachSurface(created.value.sessionId, {
    screenRef: 'virtual-app-screen:native-host-negative/screen-a',
    targetWindowRef: 'window:contract-smoke/main',
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');
  return { ...created.value, surface: attached.value };
}

function automationIntentFor(targetWindowRef: string, beforeFrameRef: string, label: string): NativeHostAutomationIntent {
  return {
    intentRef: `computer-use:run/native-host-control-state/automation/${label}.json`,
    kind: `control-state-${label}`,
    targetWindowRef,
    beforeFrameRef,
    verifierRef: `computer-use:run/native-host-control-state/verifiers/${label}.json`,
  };
}

function automationBarrierFor(session: NativeHostSession, label: string): NativeHostAutomationBarrier {
  return {
    barrierRef: `computer-use:run/native-host-control-state/barriers/${label}.json`,
    currentRunRef: session.evidenceContext.currentRunRef,
    requiredReadinessRef: session.readiness.adapterReadinessRef,
  };
}

class ProductReadySmokeAdapter extends ContractSmokeNativeHostPlatformAdapter {
  describe(): NativeVirtualAppScreenHostDescription {
    return {
      ...super.describe(),
      hostId: 'native-virtual-app-screen-host.product-ready-smoke',
      platform: 'darwin',
      backendKind: 'product-ready-smoke-adapter',
      supportedApps: ['app:vscode-editor'],
      diagnosticOnly: false,
    };
  }

  probe(): NativeHostReadinessRecord {
    return {
      ...super.probe(),
      platform: 'darwin',
      adapterKind: 'product-ready-smoke-adapter',
      adapterReadinessRef: 'computer-use:native-host/readiness/product-ready-smoke-adapter.json',
      diagnosticOnly: false,
    };
  }

  launchOrAttachApp(_session: NativeHostSession, appProfile: NativeHostAppProfile): NativeHostResult<NativeHostAppProfile> {
    return {
      status: 'ok',
      value: {
        ...appProfile,
        appRef: 'computer-use:native-host/apps/product-ready-smoke/vscode-editor.json',
      },
    };
  }

  attachSurface(session: NativeHostSession, surfaceTarget: NativeHostSurfaceTarget): NativeHostResult<NativeHostLiveSurface> {
    const surfaceId = surfaceTarget.surfaceId ?? 'product-ready-smoke-surface';
    return {
      status: 'ok',
      value: {
        surfaceId,
        screenRef: surfaceTarget.screenRef,
        targetAppRef: session.app?.appRef ?? 'computer-use:native-host/apps/product-ready-smoke/vscode-editor.json',
        targetWindowRef: surfaceTarget.targetWindowRef,
        sessionRef: session.sessionRef,
        liveSurfaceRef: `computer-use:native-host/surfaces/${surfaceId}/live-surface.json`,
        liveBindingAttachGrantRef: `computer-use:native-host/grants/${surfaceId}/live-binding-attach-grant.json`,
        surfaceOwnerRef: `computer-use:native-host/surfaces/${surfaceId}/surface-owner.json`,
        displayOwnerRef: `computer-use:native-host/surfaces/${surfaceId}/display-owner.json`,
        surfaceTransport: surfaceTarget.transport,
        surfaceTransportRef: `computer-use:native-host/surfaces/${surfaceId}/surface-transport.json`,
        frameStreamRef: `computer-use:native-host/surfaces/${surfaceId}/frame-stream.json`,
        currentFrameSequence: 0,
      },
    };
  }

  readFrame(session: NativeHostSession): NativeHostResult<NativeHostFrame> {
    const surface = session.surface;
    assert.ok(surface);
    const frameSequence = surface.currentFrameSequence + 1;
    return {
      status: 'ok',
      value: {
        frameRef: `computer-use:native-host/frames/${surface.surfaceId}/${String(frameSequence).padStart(4, '0')}.png`,
        frameHash: 'a'.repeat(64),
        frameSequence,
        liveSurfaceRef: surface.liveSurfaceRef,
        frameStreamRef: surface.frameStreamRef,
        readAt: new Date().toISOString(),
      },
    };
  }
}

class ReprobingReadinessAdapter extends ContractSmokeNativeHostPlatformAdapter {
  private probeSequence = 0;

  probe(): NativeHostReadinessRecord {
    const readiness = super.probe();
    const sequence = ++this.probeSequence;
    return {
      ...readiness,
      adapterReadinessRef: `computer-use:native-host/readiness/reprobe/adapter-${sequence}.json`,
      driverRefs: [`computer-use:native-host/platform-drivers/reprobe/driver-${sequence}.json`],
      providerRefs: [`computer-use:native-host/providers/reprobe/provider-${sequence}.json`],
    };
  }
}

function cloneLedger(ledger: NativeHostEvidenceLedger): NativeHostEvidenceLedger {
  return JSON.parse(JSON.stringify(ledger)) as NativeHostEvidenceLedger;
}
