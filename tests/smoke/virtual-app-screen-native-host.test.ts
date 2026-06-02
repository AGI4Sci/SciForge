import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ContractSmokeNativeHostPlatformAdapter,
  InMemoryNativeVirtualAppScreenHost,
  NATIVE_HOST_ERROR_TAXONOMY,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  validateNativeHostEvidenceLedger,
  type NativeHostAutomationBarrier,
  type NativeHostAutomationIntent,
  type NativeHostAutomationResult,
  type NativeHostEvidenceLedger,
  type NativeHostHumanInputAccepted,
  type NativeHostHumanInputEvent,
  type NativeHostResult,
  type NativeHostSession,
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
    'session.closed',
  ]);
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

  const recheck = host.recordPermissionRecheck(session.sessionId, {
    permissionHandoffRef: 'computer-use:permissions/native-host/handoff.json',
    recheckRef: 'computer-use:permissions/native-host/recheck.json',
    permissionRef: 'permission:macos/accessibility',
  });
  assert.equal(recheck.status, 'ok');
  assert.equal(recheck.value.type, 'permission.recheck');
  assert.equal(recheck.value.refs.adapterReadinessRef, session.readiness.adapterReadinessRef);

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

function cloneLedger(ledger: NativeHostEvidenceLedger): NativeHostEvidenceLedger {
  return JSON.parse(JSON.stringify(ledger)) as NativeHostEvidenceLedger;
}
