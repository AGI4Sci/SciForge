import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContractSmokeNativeHostPlatformAdapter,
  InMemoryNativeVirtualAppScreenHost,
} from '../../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';
import { parseVirtualAppScreenRuntimeCommand } from './virtual-app-screen-command.js';
import {
  recordVirtualAppScreenNativeHostSession,
  resetVirtualAppScreenNativeHostSessionStoreForTests,
} from './virtual-app-screen-native-host-session-store.js';
import {
  readVirtualAppScreenProviderSessionRecord,
  resetVirtualAppScreenProviderSessionStoreForTests,
} from './virtual-app-screen-provider-session-store.js';
import {
  attachVirtualAppScreenSession,
  listVirtualAppScreenSessionExecutors,
  registerVirtualAppScreenSessionExecutor,
  reconnectVirtualAppScreenSession,
  validateVirtualAppScreenSessionManagerResult,
  virtualAppScreenSessionManagerResultToVirtualScreenData,
  VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
  type VirtualAppScreenSessionManagerAttachResult,
} from './virtual-app-screen-session-manager.js';

test('VirtualAppScreen session manager fails closed when no runtime-owned executor is registered', async () => {
  const command = parsedAttachCommand();

  const result = await attachVirtualAppScreenSession(command);
  const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);

  assert.equal(result.status, 'blocked');
  assert.equal(result.executorId, 'virtual-app-screen-session-manager:none');
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.equal(data.status, 'blocked');
  assert.equal(data.attachState, 'blocked');
  assert.equal(data.surfaceMode, 'empty');
  assert.equal(data.sessionRef, undefined);
  assert.equal(data.liveSurfaceRef, undefined);
  assert.equal(data.currentFrameRef, undefined);
});

test('VirtualAppScreen session manager rejects attached claims missing current live evidence', () => {
  const command = parsedAttachCommand();
  const invalid: VirtualAppScreenSessionManagerAttachResult = {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: 'native-session-manager:test',
    providerId: 'provider:test',
    refs: {
      currentRunRef: '.sciforge/vision-runs/test/current-run.json',
      sessionRef: 'computer-use:session/test/session.json',
      liveSurfaceRef: 'computer-use:session/test/live-surface.json',
      adapterReadinessRef: command.refs.readinessRef,
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: false,
      guiPresented: true,
      isolationVerified: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      evidenceRefs: ['computer-use:session/test/evidence-ledger.json'],
    },
  };

  const result = validateVirtualAppScreenSessionManagerResult(command, invalid);

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /currentFrameRef/);
  assert.match(result.blockedReason ?? '', /currentFrameMaterialized/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('VirtualAppScreen session manager rejects executors that touch physical desktop or shared system input', () => {
  const command = parsedAttachCommand();
  const unsafe = validAttachedResult(command) as unknown as {
    evidence: { systemPointerMoved: boolean };
  };
  unsafe.evidence.systemPointerMoved = true;

  const result = validateVirtualAppScreenSessionManagerResult(command, unsafe as unknown as VirtualAppScreenSessionManagerAttachResult);

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /physical desktop or shared system input/);
  assert.equal(result.refs.sessionRef, undefined);
});

test('VirtualAppScreen session manager materializes live refs only from complete executor evidence', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const command = parsedAttachCommand();
  const result = await attachVirtualAppScreenSession(command, {
    executors: [{
      executorId: 'native-session-manager:test',
      providerId: 'provider:test',
      supportedProfiles: ['vscode-editor'],
      attach: () => validAttachedResult(command),
    }],
  });
  const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);

  assert.equal(result.status, 'attached');
  assert.equal(data.status, 'ready');
  assert.equal(data.attachState, 'attached');
  assert.equal(data.surfaceMode, 'live');
  assert.equal(data.sessionRef, 'computer-use:session/test/session.json');
  assert.equal(data.liveSurfaceRef, 'computer-use:session/test/live-surface.json');
  assert.equal(data.frameStreamRef, 'computer-use:session/test/frame-stream.json');
  assert.equal(data.currentFrameRef, 'computer-use:session/test/frames/current.png');
  assert.match(result.refs.providerSessionOwnerRef ?? '', /^computer-use:provider-session\//);
  assert.match(result.refs.providerSessionReconnectRef ?? '', /^computer-use:provider-session\//);
  assert.match(result.refs.liveBindingAttachGrantRef ?? '', /^computer-use:provider-session\//);
  assert.match(result.refs.grantValidationRef ?? '', /^computer-use:provider-session\//);
  assert.equal(data.providerSessionOwnerRef, result.refs.providerSessionOwnerRef);
  assert.equal(data.providerSessionReconnectRef, result.refs.providerSessionReconnectRef);
  assert.equal(data.liveBindingAttachGrantRef, result.refs.liveBindingAttachGrantRef);
  assert.equal(data.grantValidationRef, result.refs.grantValidationRef);
  assert.equal(data.liveBindingAttachGrantStatus, 'validated');
  assert.equal(data.grantValidationStatus, 'validated');
  assert.equal(data.surfaceTransport, 'native-frame-stream');
  assert.deepEqual(data.surfaceTransportDescriptor, validSurfaceTransport());
  assert.deepEqual(data.frameTransport, {
    ref: 'computer-use:session/test/frame-transport-contract.json',
    transport: 'native-frame-stream',
    diagnosticOnly: false,
    sequence: 11,
  });
  assert.equal(data.isolationFlags.providerExecuted, true);
  assert.deepEqual(readVirtualAppScreenProviderSessionRecord({
    screenRef: command.refs.screenRef,
  }), {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-session-record.v1',
    providerSessionOwnerRef: result.refs.providerSessionOwnerRef,
    reconnectRef: result.refs.providerSessionReconnectRef,
    liveBindingAttachGrantRef: result.refs.liveBindingAttachGrantRef,
    grantValidationRef: result.refs.grantValidationRef,
    screenRef: command.refs.screenRef,
    providerId: 'provider:test',
    executorId: 'native-session-manager:test',
    currentRunRef: '.sciforge/vision-runs/test/current-run.json',
    transport: 'native-frame-stream',
    sessionRef: 'computer-use:session/test/session.json',
    liveSurfaceRef: 'computer-use:session/test/live-surface.json',
    frameStreamRef: 'computer-use:session/test/frame-stream.json',
    currentFrameRef: 'computer-use:session/test/frames/current.png',
    surfaceTransportRef: 'computer-use:session/test/surface-transport.json',
    frameTransportContractRef: 'computer-use:session/test/frame-transport-contract.json',
    frameTelemetryRef: 'computer-use:session/test/frame-telemetry.json',
    mediaChannelRef: 'computer-use:session/test/native-frame-stream/live',
    dataChannelRef: 'computer-use:session/test/native-frame-control-channel/control',
    targetAppRef: command.refs.targetAppRef,
    targetWindowRef: 'window:test/vscode/main',
    inputLeaseRef: 'computer-use:session/test/input-lease.json',
    actionAdapterRef: 'computer-use:session/test/action-adapter.json',
    adapterReadinessRef: command.refs.readinessRef,
    platformDriverRef: 'computer-use:session/test/platform-driver.json',
    evidenceLedgerRef: 'computer-use:session/test/evidence-ledger.json',
    guiPresentRef: 'gui.present:test/screen-pane',
    currentFrameSequence: 11,
    owner: 'VirtualDisplayProvider',
    singleInteractiveTruth: true,
    secondInteractiveSurfacePresent: false,
    currentSessionOnly: true,
  });
});

test('VirtualAppScreen session manager revalidates provider session reconnect without native attach', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const attachCommand = parsedAttachCommand();
  const attached = await attachVirtualAppScreenSession(attachCommand, {
    executors: [{
      executorId: 'native-session-manager:test',
      providerId: 'provider:test',
      supportedProfiles: ['vscode-editor'],
      attach: () => validAttachedResult(attachCommand),
    }],
  });
  assert.equal(attached.status, 'attached');

  let attachCalled = false;
  const reconnectCommand = parsedReconnectCommand({
    providerSessionOwnerRef: attached.refs.providerSessionOwnerRef!,
    providerSessionReconnectRef: attached.refs.providerSessionReconnectRef!,
    liveBindingAttachGrantRef: attached.refs.liveBindingAttachGrantRef!,
    grantValidationRef: attached.refs.grantValidationRef!,
    currentFrameRef: 'computer-use:session/test/frames/current-12.png',
    currentFrameSequence: 12,
  });
  const result = await reconnectVirtualAppScreenSession(reconnectCommand, {
    executors: [{
      executorId: 'native-session-manager:must-not-run',
      providerId: 'provider:must-not-run',
      supportedProfiles: ['*'],
      attach: () => {
        attachCalled = true;
        return validAttachedResult(attachCommand);
      },
    }],
  });
  const data = virtualAppScreenSessionManagerResultToVirtualScreenData(reconnectCommand, result);

  assert.equal(attachCalled, false);
  assert.equal(result.status, 'attached');
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.equal(result.evidence.mutatingActionExecuted, false);
  assert.equal(result.refs.sessionRef, attached.refs.sessionRef);
  assert.equal(result.refs.liveSurfaceRef, attached.refs.liveSurfaceRef);
  assert.equal(result.refs.frameStreamRef, attached.refs.frameStreamRef);
  assert.equal(result.refs.providerSessionOwnerRef, attached.refs.providerSessionOwnerRef);
  assert.equal(result.refs.providerSessionReconnectRef, attached.refs.providerSessionReconnectRef);
  assert.equal(result.refs.liveBindingAttachGrantRef, attached.refs.liveBindingAttachGrantRef);
  assert.equal(result.refs.grantValidationRef, attached.refs.grantValidationRef);
  assert.equal(result.refs.currentFrameRef, 'computer-use:session/test/frames/current-12.png');
  assert.equal(result.evidence.surfaceTransport?.currentFrameSequence, 12);
  assert.equal(data.status, 'ready');
  assert.equal(data.isolationFlags.providerExecuted, false);
  assert.equal(data.runSummary.realNativeSidecarExecuted, false);
  assert.equal(data.runSummary.providerSessionRevalidated, true);
  assert.deepEqual(data.currentFrameSequence, {
    ref: 'computer-use:session/test/frames/current-12.png',
    transport: 'native-frame-stream',
    diagnosticOnly: false,
    sequence: 12,
  });
  assert.equal(readVirtualAppScreenProviderSessionRecord({
    screenRef: attachCommand.refs.screenRef,
  })?.currentFrameRef, 'computer-use:session/test/frames/current-12.png');
});

test('VirtualAppScreen session manager blocks reconnect refs that do not match the recorded provider session', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const attachCommand = parsedAttachCommand();
  const attached = await attachVirtualAppScreenSession(attachCommand, {
    executors: [{
      executorId: 'native-session-manager:test',
      providerId: 'provider:test',
      supportedProfiles: ['vscode-editor'],
      attach: () => validAttachedResult(attachCommand),
    }],
  });
  assert.equal(attached.status, 'attached');

  const reconnectCommand = parsedReconnectCommand({
    providerSessionOwnerRef: 'computer-use:provider-session/other/owner.json',
    providerSessionReconnectRef: attached.refs.providerSessionReconnectRef!,
    liveBindingAttachGrantRef: attached.refs.liveBindingAttachGrantRef!,
    grantValidationRef: attached.refs.grantValidationRef!,
    currentFrameRef: 'computer-use:session/test/frames/current-12.png',
    currentFrameSequence: 12,
  });
  const result = await reconnectVirtualAppScreenSession(reconnectCommand);

  assert.equal(result.status, 'blocked');
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.match(result.blockedReason ?? '', /do not match/);
  assert.equal(readVirtualAppScreenProviderSessionRecord({
    screenRef: attachCommand.refs.screenRef,
  })?.currentFrameRef, 'computer-use:session/test/frames/current.png');
});

test('VirtualAppScreen session manager blocks reconnect owner and reconnect refs independently', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const attachCommand = parsedAttachCommand();
  const attached = await attachVirtualAppScreenSession(attachCommand, {
    executors: [{
      executorId: 'native-session-manager:test',
      providerId: 'provider:test',
      supportedProfiles: ['vscode-editor'],
      attach: () => validAttachedResult(attachCommand),
    }],
  });
  assert.equal(attached.status, 'attached');

  const reconnectCommand = parsedReconnectCommand({
    providerSessionOwnerRef: attached.refs.providerSessionOwnerRef!,
    providerSessionReconnectRef: 'computer-use:provider-session/other/reconnect.json',
    liveBindingAttachGrantRef: attached.refs.liveBindingAttachGrantRef!,
    grantValidationRef: attached.refs.grantValidationRef!,
    currentFrameRef: 'computer-use:session/test/frames/current-12.png',
    currentFrameSequence: 12,
  });
  const result = await reconnectVirtualAppScreenSession(reconnectCommand);

  assert.equal(result.status, 'blocked');
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.match(result.blockedReason ?? '', /do not match/);
  assert.equal(readVirtualAppScreenProviderSessionRecord({
    screenRef: attachCommand.refs.screenRef,
  })?.currentFrameRef, 'computer-use:session/test/frames/current.png');
});

test('VirtualAppScreen session manager blocks reconnect attach grants from another recorded binding', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const attachCommand = parsedAttachCommand();
  const attached = await attachVirtualAppScreenSession(attachCommand, {
    executors: [{
      executorId: 'native-session-manager:test',
      providerId: 'provider:test',
      supportedProfiles: ['vscode-editor'],
      attach: () => validAttachedResult(attachCommand),
    }],
  });
  assert.equal(attached.status, 'attached');

  const reconnectCommand = parsedReconnectCommand({
    providerSessionOwnerRef: attached.refs.providerSessionOwnerRef!,
    providerSessionReconnectRef: attached.refs.providerSessionReconnectRef!,
    liveBindingAttachGrantRef: 'computer-use:provider-session/other/live-binding-attach-grant.json',
    grantValidationRef: attached.refs.grantValidationRef!,
    currentFrameRef: 'computer-use:session/test/frames/current-12.png',
    currentFrameSequence: 12,
  });
  const result = await reconnectVirtualAppScreenSession(reconnectCommand);

  assert.equal(result.status, 'blocked');
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.match(result.blockedReason ?? '', /do not match/);
  assert.equal(readVirtualAppScreenProviderSessionRecord({
    screenRef: attachCommand.refs.screenRef,
  })?.currentFrameRef, 'computer-use:session/test/frames/current.png');
});

test('VirtualAppScreen session manager blocks reconnect grant validation refs from another binding', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const attachCommand = parsedAttachCommand();
  const attached = await attachVirtualAppScreenSession(attachCommand, {
    executors: [{
      executorId: 'native-session-manager:test',
      providerId: 'provider:test',
      supportedProfiles: ['vscode-editor'],
      attach: () => validAttachedResult(attachCommand),
    }],
  });
  assert.equal(attached.status, 'attached');

  const reconnectCommand = parsedReconnectCommand({
    providerSessionOwnerRef: attached.refs.providerSessionOwnerRef!,
    providerSessionReconnectRef: attached.refs.providerSessionReconnectRef!,
    liveBindingAttachGrantRef: attached.refs.liveBindingAttachGrantRef!,
    grantValidationRef: 'computer-use:provider-session/other/grant-validation.json',
    currentFrameRef: 'computer-use:session/test/frames/current-12.png',
    currentFrameSequence: 12,
  });
  const result = await reconnectVirtualAppScreenSession(reconnectCommand);

  assert.equal(result.status, 'blocked');
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.match(result.blockedReason ?? '', /do not match/);
  assert.equal(readVirtualAppScreenProviderSessionRecord({
    screenRef: attachCommand.refs.screenRef,
  })?.currentFrameRef, 'computer-use:session/test/frames/current.png');
});

test('VirtualAppScreen session manager does not record provider ownership for blocked attach', async () => {
  resetVirtualAppScreenProviderSessionStoreForTests();
  const command = parsedAttachCommand();

  const result = await attachVirtualAppScreenSession(command);

  assert.equal(result.status, 'blocked');
  assert.equal(result.refs.providerSessionOwnerRef, undefined);
  assert.equal(readVirtualAppScreenProviderSessionRecord({ screenRef: command.refs.screenRef }), undefined);
});

test('VirtualAppScreen session manager rejects attached claims missing safe surface transport evidence', () => {
  const command = parsedAttachCommand();
  const invalid = validAttachedResult(command);
  delete invalid.evidence.surfaceTransport;

  const result = validateVirtualAppScreenSessionManagerResult(command, invalid);

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /surfaceTransport/);
  assert.equal(result.evidence.providerExecuted, false);
  assert.equal(result.refs.sessionRef, undefined);
});

test('VirtualAppScreen session manager rejects attached claims with mismatched surface transport refs or missing sequence', () => {
  const command = parsedAttachCommand();
  const mismatched = validAttachedResult(command);
  mismatched.evidence.surfaceTransport = {
    ...validSurfaceTransport(),
    currentFrameRef: 'computer-use:session/test/frames/stale.png',
  };

  const mismatchResult = validateVirtualAppScreenSessionManagerResult(command, mismatched);

  assert.equal(mismatchResult.status, 'blocked');
  assert.match(mismatchResult.blockedReason ?? '', /mismatched surface transport refs/);
  assert.match(mismatchResult.blockedReason ?? '', /currentFrameRef/);

  const missingSequence = validAttachedResult(command);
  const { currentFrameSequence: _currentFrameSequence, ...surfaceTransportWithoutSequence } = validSurfaceTransport();
  missingSequence.evidence.surfaceTransport = surfaceTransportWithoutSequence;

  const missingSequenceResult = validateVirtualAppScreenSessionManagerResult(command, missingSequence);

  assert.equal(missingSequenceResult.status, 'blocked');
  assert.match(missingSequenceResult.blockedReason ?? '', /currentFrameSequence/);
  assert.equal(missingSequenceResult.evidence.providerExecuted, false);
});

test('VirtualAppScreen session manager rejects attached claims that switch requested session refs', () => {
  const command = parsedAttachCommand();
  command.refs.sessionRef = 'computer-use:session/requested/session.json';
  const invalid = validAttachedResult(command);
  invalid.refs.sessionRef = 'computer-use:session/other/session.json';

  const result = validateVirtualAppScreenSessionManagerResult(command, invalid);

  assert.equal(result.status, 'blocked');
  assert.match(result.blockedReason ?? '', /requested current session/);
  assert.equal(result.evidence.providerExecuted, false);
});

test('VirtualAppScreen session manager can attach through a registered runtime executor', async () => {
  const command = parsedAttachCommand();
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:registered-test',
    providerId: 'provider:registered-test',
    supportedProfiles: ['vscode-editor'],
    attach: () => validAttachedResult(command, {
      executorId: 'native-session-manager:registered-test',
      providerId: 'provider:registered-test',
    }),
  });
  try {
    assert.equal(listVirtualAppScreenSessionExecutors().length, 1);
    const result = await attachVirtualAppScreenSession(command);
    const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);

    assert.equal(result.status, 'attached', result.blockedReason);
    assert.equal(result.executorId, 'native-session-manager:registered-test');
    assert.equal(data.attachState, 'attached');
    assert.equal(data.liveSurfaceRef, 'computer-use:session/test/live-surface.json');
  } finally {
    unregister();
  }

  assert.equal(listVirtualAppScreenSessionExecutors().length, 0);
});

test('VirtualAppScreen session manager dry-run blocks even when a registered executor exists', async () => {
  const command = parsedAttachCommand();
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:dry-run-test',
    providerId: 'provider:dry-run-test',
    supportedProfiles: ['*'],
    attach: () => validAttachedResult(command),
  });
  try {
    const result = await attachVirtualAppScreenSession(command, { dryRun: true });

    assert.equal(result.status, 'blocked');
    assert.equal(result.evidence.providerExecuted, false);
    assert.match(result.blockedReason ?? '', /dry-run/);
  } finally {
    unregister();
  }
});

test('VirtualAppScreen session manager never executes native attach during permission handoff', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  const command = parsedPermissionHandoffCommand();
  const { host, session } = createRecordedNativeHostSession();
  let attachCalled = false;
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:handoff-test',
    providerId: 'provider:handoff-test',
    supportedProfiles: ['*'],
    attach: () => {
      attachCalled = true;
      return validAttachedResult(parsedAttachCommand());
    },
  });
  try {
    const result = await attachVirtualAppScreenSession(command);

    assert.equal(attachCalled, false);
    assert.equal(result.status, 'requires-handoff');
    assert.equal(result.evidence.providerExecuted, false);
    assert.match(result.blockedReason ?? '', /presentation-only/);
    const ledger = host.getLedger(session.sessionId);
    assert.ok(ledger);
    assert.equal(ledger.entries.at(-1)?.type, 'permission.handoff');
    assert.equal(ledger.entries.at(-1)?.refs.permissionHandoffRef, command.refs.permissionHandoffRef);
    assert.equal(result.refs.hostEvidenceLedgerRef, ledger.ledgerRef);
    assert.equal(result.refs.permissionHandoffLedgerEntryRef, ledger.entries.at(-1)?.eventRef);
    assert.ok(result.evidence.evidenceRefs.includes(ledger.ledgerRef));
    assert.ok(result.evidence.evidenceRefs.includes(ledger.entries.at(-1)?.eventRef ?? ''));
    const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);
    assert.equal(data.hostEvidenceLedgerRef, ledger.ledgerRef);
    assert.equal(data.permissionHandoffLedgerEntryRef, ledger.entries.at(-1)?.eventRef);
    assert.equal(host.validateLedger(session.sessionId, { requirePermissionHandoff: true }).ok, true);
  } finally {
    unregister();
    resetVirtualAppScreenNativeHostSessionStoreForTests();
  }
});

test('VirtualAppScreen session manager records permission recheck before native attach resumes', async () => {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  const callOrder: string[] = [];
  class RecordingHost extends InMemoryNativeVirtualAppScreenHost {
    recordPermissionRecheck(
      ...args: Parameters<InMemoryNativeVirtualAppScreenHost['recordPermissionRecheck']>
    ): ReturnType<InMemoryNativeVirtualAppScreenHost['recordPermissionRecheck']> {
      callOrder.push('permission.recheck');
      return super.recordPermissionRecheck(...args);
    }
  }
  const { host, session } = createRecordedNativeHostSession(new RecordingHost(new ContractSmokeNativeHostPlatformAdapter()));
  const command = parsedPermissionRecheckCommand(session.sessionRef);
  const unregister = registerVirtualAppScreenSessionExecutor({
    executorId: 'native-session-manager:recheck-test',
    providerId: 'provider:recheck-test',
    supportedProfiles: ['*'],
    attach: () => {
      callOrder.push('attach');
      const attached = validAttachedResult(parsedAttachCommand());
      attached.refs.sessionRef = session.sessionRef;
      return attached;
    },
  });
  try {
    const result = await attachVirtualAppScreenSession(command);

    assert.equal(result.status, 'attached', result.blockedReason);
    assert.deepEqual(callOrder, ['permission.recheck', 'attach']);
    const ledger = host.getLedger(session.sessionId);
    assert.ok(ledger);
    assert.equal(ledger.entries.at(-1)?.type, 'permission.recheck');
    assert.equal(ledger.entries.at(-1)?.refs.recheckRef, command.refs.permissionRecheckRef);
    assert.equal(result.refs.hostEvidenceLedgerRef, ledger.ledgerRef);
    assert.equal(result.refs.permissionRecheckLedgerEntryRef, ledger.entries.at(-1)?.eventRef);
    const data = virtualAppScreenSessionManagerResultToVirtualScreenData(command, result);
    assert.equal(data.hostEvidenceLedgerRef, ledger.ledgerRef);
    assert.equal(data.permissionRecheckLedgerEntryRef, ledger.entries.at(-1)?.eventRef);
    assert.equal(host.validateLedger(session.sessionId, { requirePermissionRecheck: true }).ok, false);
  } finally {
    unregister();
    resetVirtualAppScreenNativeHostSessionStoreForTests();
  }
});

function parsedAttachCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:test/screen"',
    '--activation-ref "computer-use:test/attach-request.json"',
    '--adapter-readiness-ref "computer-use:test/provider-readiness.json"',
    '--platform-driver-ref "computer-use:session/test/platform-driver.json"',
    '--evidence-ledger-ref "ledger:computer-use/test/screen-activation.json"',
    '--gui-present-ref "gui.present:test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedPermissionHandoffCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use permission-handoff',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:test/screen"',
    '--permission-handoff-ref "computer-use:test/permission-handoff.json"',
    '--permission-ref "permission:macos/accessibility"',
    '--adapter-readiness-ref "computer-use:test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/test/screen-activation.json"',
    '--gui-present-ref "gui.present:test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedPermissionRecheckCommand(sessionRef: string) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use permission-recheck',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:test/screen"',
    `--session-ref "${sessionRef}"`,
    '--permission-handoff-ref "computer-use:test/permission-handoff.json"',
    '--permission-recheck-ref "computer-use:test/permission-recheck.json"',
    '--permission-ref "permission:macos/accessibility"',
    '--adapter-readiness-ref "computer-use:test/provider-readiness.json"',
    '--evidence-ledger-ref "ledger:computer-use/test/screen-activation.json"',
    '--gui-present-ref "gui.present:test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedReconnectCommand(options: {
  providerSessionOwnerRef: string;
  providerSessionReconnectRef: string;
  liveBindingAttachGrantRef: string;
  grantValidationRef: string;
  currentFrameRef: string;
  currentFrameSequence: number;
}) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason provider-reconnect',
    '--screen-ref "virtual-app-screen:test/screen"',
    '--session-ref "computer-use:session/test/session.json"',
    '--live-surface-ref "computer-use:session/test/live-surface.json"',
    '--frame-stream-ref "computer-use:session/test/frame-stream.json"',
    `--current-frame-ref "${options.currentFrameRef}"`,
    `--current-frame-sequence ${options.currentFrameSequence}`,
    `--provider-session-owner-ref "${options.providerSessionOwnerRef}"`,
    `--provider-session-reconnect-ref "${options.providerSessionReconnectRef}"`,
    `--live-binding-attach-grant-ref "${options.liveBindingAttachGrantRef}"`,
    `--grant-validation-ref "${options.grantValidationRef}"`,
    '--surface-transport-ref "computer-use:session/test/surface-transport.json"',
    '--evidence-ledger-ref "ledger:computer-use/test/screen-reconnect.json"',
    '--gui-present-ref "gui.present:test/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function createRecordedNativeHostSession(
  host: InMemoryNativeVirtualAppScreenHost = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter()),
) {
  const created = host.createSession(
    { profileId: 'vscode-editor', defaultSurfaceTransport: 'native-frame-stream' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:run/session-manager-native-host/current-run.json',
      evidenceRootRef: 'computer-use:run/session-manager-native-host/evidence',
    },
  );
  assert.equal(created.status, 'ok');
  assert.equal(host.launchOrAttachApp(created.value.sessionId, {
    appId: 'vscode',
    appRef: 'app:profile/vscode-editor',
  }).status, 'ok');
  const attached = host.attachSurface(created.value.sessionId, {
    screenRef: 'virtual-app-screen:test/screen',
    targetWindowRef: 'window:test/vscode/main',
    transport: 'native-frame-stream',
  });
  assert.equal(attached.status, 'ok');
  const frame = host.readFrame(created.value.sessionId);
  assert.equal(frame.status, 'ok');
  recordVirtualAppScreenNativeHostSession({
    host,
    session: created.value,
    surface: attached.value,
    frame: frame.value,
    refs: {
      adapterReadinessRef: created.value.readiness.adapterReadinessRef,
      evidenceLedgerRef: created.value.ledgerRef,
    },
  });
  return { host, session: created.value };
}

function validAttachedResult(
  command: ReturnType<typeof parsedAttachCommand>,
  overrides: Partial<Pick<VirtualAppScreenSessionManagerAttachResult, 'executorId' | 'providerId'>> = {},
): VirtualAppScreenSessionManagerAttachResult {
  const providerId = overrides.providerId ?? 'provider:test';
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_SESSION_MANAGER_SCHEMA,
    status: 'attached',
    executorId: overrides.executorId ?? 'native-session-manager:test',
    providerId,
    refs: {
      currentRunRef: '.sciforge/vision-runs/test/current-run.json',
      sessionRef: 'computer-use:session/test/session.json',
      liveSurfaceRef: 'computer-use:session/test/live-surface.json',
      surfaceTransportRef: 'computer-use:session/test/surface-transport.json',
      frameStreamRef: 'computer-use:session/test/frame-stream.json',
      currentFrameRef: 'computer-use:session/test/frames/current.png',
      frameTransportContractRef: 'computer-use:session/test/frame-transport-contract.json',
      frameTelemetryRef: 'computer-use:session/test/frame-telemetry.json',
      mediaChannelRef: 'computer-use:session/test/native-frame-stream/live',
      dataChannelRef: 'computer-use:session/test/native-frame-control-channel/control',
      screenRef: command.refs.screenRef,
      targetAppRef: command.refs.targetAppRef,
      targetWindowRef: 'window:test/vscode/main',
      inputLeaseRef: 'computer-use:session/test/input-lease.json',
      actionAdapterRef: 'computer-use:session/test/action-adapter.json',
      adapterReadinessRef: command.refs.readinessRef,
      platformDriverRef: 'computer-use:session/test/platform-driver.json',
      evidenceLedgerRef: 'computer-use:session/test/evidence-ledger.json',
      guiPresentRef: 'gui.present:test/screen-pane',
    },
    evidence: {
      providerExecuted: true,
      mutatingActionExecuted: false,
      nativeSessionCreated: true,
      liveFrameAttached: true,
      currentFrameMaterialized: true,
      guiPresented: true,
      isolationVerified: true,
      platformDriverReady: true,
      permissionRequired: false,
      permissionGranted: true,
      backgroundRenderable: true,
      diagnosticOnly: false,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      surfaceTransport: validSurfaceTransport(providerId),
      evidenceRefs: [
        'computer-use:session/test/surface-transport.json',
        'computer-use:session/test/frame-transport-contract.json',
        'computer-use:session/test/evidence-ledger.json',
        'computer-use:session/test/frames/current.png',
      ],
    },
  };
}

function validSurfaceTransport(providerId = 'provider:test') {
  return {
    schemaVersion: 'sciforge.virtual-display.surface-transport.v1' as const,
    owner: 'VirtualDisplayProvider' as const,
    providerId,
    transport: 'native-frame-stream' as const,
    surfaceTransportRef: 'computer-use:session/test/surface-transport.json',
    liveSurfaceRef: 'computer-use:session/test/live-surface.json',
    frameStreamRef: 'computer-use:session/test/frame-stream.json',
    currentFrameRef: 'computer-use:session/test/frames/current.png',
    frameTransportContractRef: 'computer-use:session/test/frame-transport-contract.json',
    frameTelemetryRef: 'computer-use:session/test/frame-telemetry.json',
    mediaChannelRef: 'computer-use:session/test/native-frame-stream/live',
    dataChannelRef: 'computer-use:session/test/native-frame-control-channel/control',
    currentFrameSequence: 11,
    diagnosticOnly: false as const,
    productFallback: false as const,
    singleInteractiveTruth: true as const,
  };
}
