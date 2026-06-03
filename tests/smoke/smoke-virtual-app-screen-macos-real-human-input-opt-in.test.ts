import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join, relative } from 'node:path';
import test from 'node:test';

import {
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
  ensureVirtualAppScreenRuntimeExecutorsRegistered,
  resetVirtualAppScreenRuntimeExecutorsForTests,
} from '../../src/runtime/computer-use/virtual-app-screen-runtime-executors.js';
import {
  runVirtualAppScreenInputRuntime,
} from '../../src/runtime/computer-use/virtual-app-screen-input-runtime.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
} from '../../src/runtime/computer-use/virtual-app-screen-native-host-session-store.js';
import {
  attachVirtualAppScreenSession,
  reconnectVirtualAppScreenSession,
  type VirtualAppScreenSessionManagerRefs,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  parseVirtualScreenInputIntentCommand,
} from '../../src/runtime/computer-use/input-intent-command.js';
import {
  type NativeHostLedgerEventType,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/contracts.js';
import {
  assertProviderInputVerificationFiles,
} from './helpers/virtual-app-screen-provider-evidence-assertions.js';
import {
  defaultVirtualAppScreenRealHostSessionEvidenceManifestPath,
  writeVirtualAppScreenRealHostSessionEvidenceManifest,
} from '../../tools/virtual-app-screen-real-host-session-evidence.js';
import {
  defaultVirtualAppScreenProviderStreamQualitySampleManifestPath,
  writeVirtualAppScreenProviderStreamQualitySampleManifest,
} from '../../tools/virtual-app-screen-provider-stream-quality-sample.js';

const REAL_HUMAN_INPUT_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_HUMAN_INPUT';
const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER';
const PERMISSION_GRANTS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS';
const REAL_HOST_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST';
const STREAM_QUALITY_SAMPLE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_SAMPLE_MANIFEST';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';
const TARGET_COMMAND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND';
const TARGET_ARGS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON';

test('macOS real human input smoke is opt-in and replays Host ledger evidence', async () => {
  if (!realHumanInputOptedIn()) {
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-macos-real-human-input-smoke.v1',
      status: 'not-run',
      optInEnv: REAL_HUMAN_INPUT_OPT_IN_ENV,
      realDriverOptInEnv: REAL_DRIVER_OPT_IN_ENV,
      runtimeHooksEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
      targetAppJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
      inputControlHookCommandEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV,
      inputControlHookArgsJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON_ENV,
      requiresAttachReadFrameHumanInputPauseResumeLedgerReplay: true,
      verificationCommand: 'npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent',
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.optInEnv, REAL_HUMAN_INPUT_OPT_IN_ENV);
    assert.equal(manifest.inputControlHookCommandEnv, VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV);
    assert.equal(manifest.requiresAttachReadFrameHumanInputPauseResumeLedgerReplay, true);
    return;
  }

  assert.equal(process.platform, 'darwin', `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 requires macOS; current platform is ${process.platform}.`);
  assert.ok(
    realDriverOptedIn(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 must also set ${REAL_DRIVER_OPT_IN_ENV}=1 to require the real driver attach/readFrame path.`,
  );
  assert.ok(
    runtimeDriverHooksOptedIn(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 must also set ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1 to exercise the product runtime bootstrap path.`,
  );
  assert.ok(
    process.env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV]?.trim(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 requires ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_COMMAND_ENV} to name a real isolated input/control hook command.`,
  );

  const targetKind = process.env[TARGET_KIND_ENV]?.trim() || 'generic-editor';
  const targetCommand = process.env[TARGET_COMMAND_ENV]?.trim();
  const permissionGrants = permissionGrantsOptedIn()
    ? {
        'permission:macos/screen-recording': true,
        'permission:macos/accessibility': true,
      }
    : undefined;
  if (permissionGrants && !targetCommand) {
    assert.fail(`${PERMISSION_GRANTS_ENV}=1 requires ${TARGET_COMMAND_ENV} to name an explicit generic GUI app command.`);
  }
  parseTargetArgs(process.env[TARGET_ARGS_ENV]);

  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-macos-real-human-input-'));
  resetVirtualAppScreenRuntimeExecutorsForTests();
  try {
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'darwin',
      nativeDriverHooks: {
        env: process.env,
        macos: {
          outDir,
          probeOptions: {
            targetAppKind: targetKind,
            permissionGrants,
          },
        },
      },
      macosProviderOptions: {
        probeOptions: {
          targetAppKind: targetKind,
          permissionGrants,
        },
      },
      macosExecutorOptions: {
        executorId: 'native-session-manager:macos-real-human-input-opt-in-smoke',
        supportedProfiles: [targetKind],
        targetAppKind: targetKind,
      },
      macosInputExecutorOptions: {
        executorId: 'input-runtime:macos-real-human-input-opt-in-smoke',
      },
    });

    const command = parsedAttachCommand(targetKind);
    const attached = await attachVirtualAppScreenSession(command);
    assert.equal(attached.status, 'attached', attached.blockedReason);
    assert.equal(attached.evidence.providerExecuted, true);
    assert.equal(attached.evidence.nativeSessionCreated, true);
    assert.equal(attached.evidence.currentFrameMaterialized, true);
    assert.equal(attached.evidence.diagnosticOnly, false);
    assertNativeHostRefs(attached.refs, [
      'sessionRef',
      'liveSurfaceRef',
      'frameStreamRef',
      'currentFrameRef',
      'liveBindingAttachGrantRef',
      'grantValidationRef',
      'surfaceOwnerRef',
      'displayOwnerRef',
      'surfaceTransportRef',
      'evidenceLedgerRef',
    ]);

    const record = readVirtualAppScreenNativeHostSessionRecord({
      sessionRef: attached.refs.sessionRef,
      screenRef: attached.refs.screenRef,
    });
    assert.ok(record, 'attached smoke must record a current Native Host session binding.');
    assert.equal(record.diagnosticOnly, false);
    assert.equal(record.currentRunRef, attached.refs.currentRunRef);
    assertLedgerTypes(record, ['session.created', 'app.launched', 'surface.attached', 'grant.validated', 'frame.read']);
    const streamQualitySamples = await collectRealStreamQualitySamples(record, attached.refs);

    const inputStart = performance.now();
    const input = await runVirtualAppScreenInputRuntime(parsedInputCommandFromAttach(attached.refs));
    streamQualitySamples.inputToFrameMs.push(elapsedSince(inputStart));
    assert.equal(input.status, 'executed', input.message);
    assert.equal(input.providerId, 'native-virtual-app-screen-host');
    assert.equal(input.evidence.providerExecuted, true);
    assert.equal(input.evidence.mutatingActionExecuted, true);
    assert.deepEqual(input.routeDecision.providerOperations, ['sendInputIntent', 'readFrame']);
    assert.match(String(input.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//u);
    assertNoFixtureOrReplayEvidence(input.evidence.evidenceRefs);
    assertLedgerTypes(record, ['human-input.accepted']);
    assertFrameReadsAtLeast(record, 2);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'sendInputIntent-click' });

    const takeover = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('takeover', attached.refs));
    assert.equal(takeover.status, 'executed', takeover.message);
    assert.deepEqual(takeover.routeDecision.providerOperations, ['pause']);
    assert.match(String(takeover.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assertLedgerTypes(record, ['agent.paused']);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'pause-takeover' });

    const missingReadinessRef = 'computer-use:native-host/readiness/macos-real-human-input/permission-missing.json';
    const handoff = await attachVirtualAppScreenSession(parsedPermissionCommandFromAttach('permission-handoff', attached.refs, missingReadinessRef));
    assert.equal(handoff.status, 'requires-handoff');
    assert.equal(readCurrentRecord(attached.refs).adapterReadinessRef, missingReadinessRef);
    assertLedgerTypes(record, ['permission.handoff']);

    const beforeRecheckResume = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach(
      'resume-agent',
      { ...attached.refs, adapterReadinessRef: missingReadinessRef },
    ));
    assert.equal(beforeRecheckResume.status, 'blocked');
    assert.match(beforeRecheckResume.message, /permission recheck/i);

    const recheck = await attachVirtualAppScreenSession(parsedPermissionCommandFromAttach(
      'permission-recheck',
      attached.refs,
      requiredRef(attached.refs.adapterReadinessRef, 'adapterReadinessRef'),
    ));
    assert.equal(recheck.status, 'attached', recheck.blockedReason);
    assert.notEqual(recheck.refs.adapterReadinessRef, missingReadinessRef);
    assert.equal(recheck.refs.sessionRef, attached.refs.sessionRef);
    assert.equal(readCurrentRecord(recheck.refs).adapterReadinessRef, recheck.refs.adapterReadinessRef);
    assertLedgerTypes(record, ['permission.recheck']);

    const resume = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('resume-agent', recheck.refs));
    assert.equal(resume.status, 'executed', resume.message);
    assert.deepEqual(resume.routeDecision.providerOperations, ['resume', 'readFrame']);
    assert.match(String(resume.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRefreshRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//u);
    assertLedgerTypes(record, ['agent.resumed']);
    assertFrameReadsAtLeast(record, 4);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'resume-resume-agent' });

    const postResumeRefs = {
      ...recheck.refs,
      currentFrameRef: String(resume.routeDecision.currentFrameRef ?? recheck.refs.currentFrameRef),
    };
    const stop = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('stop-session', postResumeRefs));
    assert.equal(stop.status, 'executed', stop.message);
    assert.deepEqual(stop.routeDecision.providerOperations, ['closeSession']);
    assert.match(String(stop.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(stop.routeDecision.safeStopRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.equal(stop.routeDecision.safeStopMode, 'safe-close-or-pause-virtual-session-only');
    assert.equal((stop.virtualScreenData.runSummary as Record<string, unknown>).closesUserRealApp, false);
    assertLedgerCloseSessionSafeStop(record);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'closeSession-stop-session' });
    await assertProviderSafeStopFile({ outDir, record: providerEvidenceRecord(record), slug: 'closeSession-stop-session' });

    const ledgerValidation = record.host.validateLedger(record.sessionId, {
      requireFrame: true,
      requireHumanInput: true,
      requireGrantValidation: true,
    });
    assert.equal(ledgerValidation.ok, true, ledgerValidation.issues.join(' '));
    const ledger = record.host.getLedger(record.sessionId);
    assert.ok(ledger, 'Native Host ledger must remain readable after input and resume.');
    assert.equal(ledger.currentRunRef, record.currentRunRef);
    assert.equal(ledger.entries.every((entry) => entry.source === 'native-virtual-app-screen-host'), true);
    assert.equal(ledger.entries.every((entry) => entry.diagnosticOnly === false), true);
    assertNoFixtureOrReplayEvidence(ledger.entries.flatMap((entry) => [
      entry.eventRef,
      ...Object.values(entry.refs).flatMap((value) => Array.isArray(value) ? value : [value]),
    ]));

    const evidenceManifest = await writeVirtualAppScreenRealHostSessionEvidenceManifest(
      process.env[REAL_HOST_EVIDENCE_MANIFEST_ENV]?.trim()
        || defaultVirtualAppScreenRealHostSessionEvidenceManifestPath(virtualAppScreenRuntimeCommandRunId(command)),
      {
        runId: virtualAppScreenRuntimeCommandRunId(command),
        platformProvider: 'macos',
        targetAppProfile: targetKind,
        userIntent: 'macOS real Host session attached, accepted human input, paused automation, and resumed with a fresh frame.',
        attach: attached,
        input,
        takeover,
        resume,
        stop,
      },
    );
    assert.equal(evidenceManifest.status, 'passed', evidenceManifest.blockedReason ?? undefined);
    assert.equal(evidenceManifest.userAcceptanceInput.evidenceClaims?.[0]?.kind, 'real-virtual-app-screen');
    const streamQualitySampleManifest = await writeVirtualAppScreenProviderStreamQualitySampleManifest(
      process.env[STREAM_QUALITY_SAMPLE_MANIFEST_ENV]?.trim()
        || defaultVirtualAppScreenProviderStreamQualitySampleManifestPath(virtualAppScreenRuntimeCommandRunId(command)),
      {
        realHostSessionManifest: evidenceManifest,
        providerRootRef: `provider:virtual-display/macos/${virtualAppScreenRuntimeCommandRunId(command)}/stream-quality`,
        samples: streamQualitySamples,
      },
    );
    assert.equal(streamQualitySampleManifest.metrics.fallbackRequired, false);
    assert.equal(streamQualitySampleManifest.currentRunPointerRef, evidenceManifest.dogfoodRefs.currentRunPointerRef);
    assert.equal(streamQualitySampleManifest.currentRunLedgerRef, evidenceManifest.dogfoodRefs.evidenceLedgerRef);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

function realHumanInputOptedIn(): boolean {
  return truthyEnv(process.env[REAL_HUMAN_INPUT_OPT_IN_ENV]);
}

async function collectRealStreamQualitySamples(
  record: NativeHostRecord,
  refs: VirtualAppScreenSessionManagerRefs,
) {
  const frameReadLatencyMs: number[] = [];
  const frameIntervalsMs: number[] = [];
  let previousReadFinishedAt = performance.now();
  let latestFrameRef = requiredRef(refs.currentFrameRef, 'currentFrameRef');
  let latestFrameSequence = 1;
  for (const cursor of ['stream-quality-read-1', 'stream-quality-read-2', 'stream-quality-read-3']) {
    const start = performance.now();
    const frame = record.host.readFrame(record.sessionId, cursor);
    const finishedAt = performance.now();
    assert.equal(frame.status, 'ok');
    if (frame.status !== 'ok') throw new Error('expected real provider frame read to pass');
    frameReadLatencyMs.push(Math.max(0, finishedAt - start));
    frameIntervalsMs.push(Math.max(0.01, finishedAt - previousReadFinishedAt));
    previousReadFinishedAt = finishedAt;
    latestFrameRef = frame.value.frameRef;
    latestFrameSequence = frame.value.frameSequence;
  }

  const reconnectStart = performance.now();
  const reconnect = await reconnectVirtualAppScreenSession(parsedReconnectCommandFromAttach(refs, latestFrameRef, latestFrameSequence));
  const reconnectMs = [elapsedSince(reconnectStart)];
  assert.equal(reconnect.status, 'attached', reconnect.blockedReason);
  assert.equal(reconnect.evidence.providerSessionGrantValidated, true);

  return {
    frameReadLatencyMs,
    frameIntervalsMs,
    inputToFrameMs: [] as number[],
    reconnectMs,
    fallbackRequired: false,
  };
}

function realDriverOptedIn(): boolean {
  return truthyEnv(process.env[REAL_DRIVER_OPT_IN_ENV]);
}

function runtimeDriverHooksOptedIn(): boolean {
  return truthyEnv(process.env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]);
}

function permissionGrantsOptedIn(): boolean {
  return truthyEnv(process.env[PERMISSION_GRANTS_ENV]);
}

function truthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? '');
}

function parseTargetArgs(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  assert.ok(Array.isArray(parsed), `${TARGET_ARGS_ENV} must be a JSON string array.`);
  assert.ok(parsed.every((item): item is string => typeof item === 'string'), `${TARGET_ARGS_ENV} must be a JSON string array.`);
  return parsed;
}

function parsedAttachCommand(targetKind: string) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${targetKind}"`,
    `--target-app-ref "app:profile/${targetKind}"`,
    '--screen-ref "virtual-app-screen:macos-real-human-input/screen"',
    '--activation-ref "computer-use:native-host/macos-real-human-input/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/macos-real-human-input/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/macos-real-human-input/evidence-ledger.json"',
    '--gui-present-ref "gui.present:macos-real-human-input/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedInputCommandFromAttach(refs: VirtualAppScreenSessionManagerRefs) {
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    `--session-ref "${requiredRef(refs.sessionRef, 'sessionRef')}"`,
    `--screen-ref "${requiredRef(refs.screenRef, 'screenRef')}"`,
    `--target-app-ref "${requiredRef(refs.targetAppRef, 'targetAppRef')}"`,
    `--target-window-ref "${requiredRef(refs.targetWindowRef, 'targetWindowRef')}"`,
    `--frame-ref "${requiredRef(refs.currentFrameRef, 'currentFrameRef')}"`,
    `--input-lease-ref "${requiredRef(refs.inputLeaseRef, 'inputLeaseRef')}"`,
    `--action-adapter-ref "${requiredRef(refs.actionAdapterRef, 'actionAdapterRef')}"`,
    `--adapter-readiness-ref "${requiredRef(refs.adapterReadinessRef, 'adapterReadinessRef')}"`,
    `--evidence-ledger-ref "${requiredRef(refs.evidenceLedgerRef, 'evidenceLedgerRef')}"`,
    '--frame-width 100',
    '--frame-height 100',
    '--x-ratio 0.5',
    '--y-ratio 0.5',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input intent command');
  return parsed.command;
}

function parsedPermissionCommandFromAttach(
  action: 'permission-handoff' | 'permission-recheck',
  refs: VirtualAppScreenSessionManagerRefs,
  adapterReadinessRef: string,
) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    `/computer-use ${action}`,
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    `--target-app-ref "${requiredRef(refs.targetAppRef, 'targetAppRef')}"`,
    `--screen-ref "${requiredRef(refs.screenRef, 'screenRef')}"`,
    `--session-ref "${requiredRef(refs.sessionRef, 'sessionRef')}"`,
    '--permission-handoff-ref "computer-use:native-host/permissions/macos-real-human-input/handoff.json"',
    '--permission-recheck-ref "computer-use:native-host/permissions/macos-real-human-input/recheck.json"',
    '--permission-ref "permission:macos/screen-recording"',
    `--adapter-readiness-ref "${adapterReadinessRef}"`,
    `--evidence-ledger-ref "${requiredRef(refs.evidenceLedgerRef, 'evidenceLedgerRef')}"`,
    `--gui-present-ref "${requiredRef(refs.guiPresentRef, 'guiPresentRef')}"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed permission command');
  return parsed.command;
}

function parsedControlCommandFromAttach(
  controlKind: 'takeover' | 'resume-agent' | 'stop-session',
  refs: VirtualAppScreenSessionManagerRefs,
) {
  const sessionRef = requiredRef(refs.sessionRef, 'sessionRef');
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-control',
    `--kind "${controlKind}"`,
    `--session-ref "${sessionRef}"`,
    `--screen-ref "${requiredRef(refs.screenRef, 'screenRef')}"`,
    `--target-app-ref "${requiredRef(refs.targetAppRef, 'targetAppRef')}"`,
    `--target-window-ref "${requiredRef(refs.targetWindowRef, 'targetWindowRef')}"`,
    `--frame-ref "${requiredRef(refs.currentFrameRef, 'currentFrameRef')}"`,
    `--input-lease-ref "${requiredRef(refs.inputLeaseRef, 'inputLeaseRef')}"`,
    `--user-lease-ref "${sessionRef.replace(/session\\.json$/u, 'leases/user.json')}"`,
    `--agent-lease-ref "${sessionRef.replace(/session\\.json$/u, 'leases/agent.json')}"`,
    `--active-lease-owner-ref "${sessionRef.replace(/session\\.json$/u, 'leases/owner-agent.json')}"`,
    '--active-lease-owner-role agent',
    `--lease-control-ref "${sessionRef.replace(/session\\.json$/u, `leases/${controlKind}.json`)}"`,
    `--action-adapter-ref "${requiredRef(refs.actionAdapterRef, 'actionAdapterRef')}"`,
    `--adapter-readiness-ref "${requiredRef(refs.adapterReadinessRef, 'adapterReadinessRef')}"`,
    `--evidence-ledger-ref "${requiredRef(refs.evidenceLedgerRef, 'evidenceLedgerRef')}"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed control command');
  return parsed.command;
}

function parsedReconnectCommandFromAttach(
  refs: VirtualAppScreenSessionManagerRefs,
  currentFrameRef: string,
  currentFrameSequence: number,
) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen reconnect',
    '--source right-pane-screen',
    '--reason provider-reconnect',
    `--screen-ref "${requiredRef(refs.screenRef, 'screenRef')}"`,
    `--session-ref "${requiredRef(refs.sessionRef, 'sessionRef')}"`,
    `--live-surface-ref "${requiredRef(refs.liveSurfaceRef, 'liveSurfaceRef')}"`,
    `--frame-stream-ref "${requiredRef(refs.frameStreamRef, 'frameStreamRef')}"`,
    `--current-frame-ref "${currentFrameRef}"`,
    `--current-frame-sequence ${currentFrameSequence}`,
    `--provider-session-owner-ref "${requiredRef(refs.providerSessionOwnerRef, 'providerSessionOwnerRef')}"`,
    `--provider-session-reconnect-ref "${requiredRef(refs.providerSessionReconnectRef, 'providerSessionReconnectRef')}"`,
    `--surface-identity-ref "${requiredRef(refs.surfaceIdentityRef, 'surfaceIdentityRef')}"`,
    `--surface-owner-ref "${requiredRef(refs.surfaceOwnerRef, 'surfaceOwnerRef')}"`,
    `--display-owner-ref "${requiredRef(refs.displayOwnerRef, 'displayOwnerRef')}"`,
    `--live-binding-attach-grant-ref "${requiredRef(refs.liveBindingAttachGrantRef, 'liveBindingAttachGrantRef')}"`,
    `--grant-validation-ref "${requiredRef(refs.grantValidationRef, 'grantValidationRef')}"`,
    `--surface-transport-ref "${requiredRef(refs.surfaceTransportRef, 'surfaceTransportRef')}"`,
    `--adapter-readiness-ref "${requiredRef(refs.adapterReadinessRef, 'adapterReadinessRef')}"`,
    `--evidence-ledger-ref "${requiredRef(refs.evidenceLedgerRef, 'evidenceLedgerRef')}"`,
    `--gui-present-ref "${requiredRef(refs.guiPresentRef, 'guiPresentRef')}"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed reconnect command');
  return parsed.command;
}

function assertNativeHostRefs(refs: VirtualAppScreenSessionManagerRefs, keys: Array<keyof VirtualAppScreenSessionManagerRefs>) {
  for (const key of keys) {
    assert.match(requiredRef(refs[key], String(key)), /^computer-use:native-host\//u, `${String(key)} must be Host-owned.`);
  }
}

function assertLedgerTypes(
  record: NonNullable<ReturnType<typeof readVirtualAppScreenNativeHostSessionRecord>>,
  expectedTypes: NativeHostLedgerEventType[],
) {
  const ledger = record.host.getLedger(record.sessionId);
  assert.ok(ledger, 'Native Host ledger must be readable.');
  const types = new Set(ledger.entries.map((entry) => entry.type));
  for (const type of expectedTypes) {
    assert.equal(types.has(type), true, `Native Host ledger missing ${type}.`);
  }
}

function assertFrameReadsAtLeast(
  record: NonNullable<ReturnType<typeof readVirtualAppScreenNativeHostSessionRecord>>,
  count: number,
) {
  const ledger = record.host.getLedger(record.sessionId);
  assert.ok(ledger, 'Native Host ledger must be readable.');
  assert.ok(
    ledger.entries.filter((entry) => entry.type === 'frame.read').length >= count,
    `Native Host ledger must include at least ${count} frame.read entries.`,
  );
}

function assertLedgerCloseSessionSafeStop(record: NonNullable<ReturnType<typeof readVirtualAppScreenNativeHostSessionRecord>>) {
  const ledger = record.host.getLedger(record.sessionId);
  assert.ok(ledger, 'Native Host ledger must be readable.');
  const closed = ledger.entries.find((entry) => entry.type === 'session.closed');
  assert.ok(closed, 'Native Host ledger missing session.closed.');
  assert.match(requiredRef(closed.refs.agentQueueRef, 'session.closed.agentQueueRef'), /^computer-use:native-host\/provider-adapter-control\//u);
  assert.match(requiredRef(closed.refs.safeStopRef, 'session.closed.safeStopRef'), /^computer-use:native-host\/provider-adapter-control\//u);
}

function assertNoFixtureOrReplayEvidence(values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(value, /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|replay|snapshot|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/iu);
  }
}

type NativeHostRecord = NonNullable<ReturnType<typeof readVirtualAppScreenNativeHostSessionRecord>>;

type ProviderEvidenceRecord = {
  sessionId: string;
  host: {
    getLedger(sessionId: string): {
      entries: Array<{
        refs?: Record<string, unknown>;
      }>;
    } | undefined;
  };
};

function providerEvidenceRecord(record: NativeHostRecord): ProviderEvidenceRecord {
  return {
    sessionId: record.sessionId,
    host: {
      getLedger(sessionId: string) {
        const ledger = record.host.getLedger(sessionId);
        if (!ledger) return undefined;
        return {
          entries: ledger.entries.map((entry) => ({
            refs: entry.refs ? plainRecord(entry.refs) : undefined,
          })),
        };
      },
    },
  };
}

async function assertProviderSafeStopFile(input: {
  outDir: string;
  record: ProviderEvidenceRecord;
  slug: string;
}) {
  const ledger = input.record.host.getLedger(input.record.sessionId);
  assert.ok(ledger, 'Native Host ledger must be readable.');
  const providerRefs = ledger.entries
    .flatMap((entry) => Object.values(entry.refs ?? {}).flatMap((value) => Array.isArray(value) ? value : [value]))
    .filter((ref): ref is string => typeof ref === 'string' && Boolean(ref.trim()));
  const safeStopRef = providerRefs.find((ref) => ref.endsWith(`/control-plane/${input.slug}/safe-stop.json`));
  assert.ok(safeStopRef, `Native Host ledger must reference provider safe-stop evidence ${input.slug}.`);
  assert.match(safeStopRef, /^\.sciforge\/vision-runs\/[^/]+\/virtual-display-provider\//u);
  const safeStop = JSON.parse(await readFile(localPathForProviderRef(input.outDir, safeStopRef), 'utf8'));
  assert.ok(safeStop && typeof safeStop === 'object' && !Array.isArray(safeStop), `provider safe-stop evidence ${input.slug} must be a JSON object.`);
  const safeStopRecord = safeStop as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(safeStopRecord, 'operation')) {
    assert.equal(safeStopRecord.operation, 'closeSession');
  }
  if (Object.prototype.hasOwnProperty.call(safeStopRecord, 'mode')) {
    assert.equal(safeStopRecord.mode, 'safe-close-or-pause-virtual-session-only');
  }
  if (Object.prototype.hasOwnProperty.call(safeStopRecord, 'currentRunOnly')) {
    assert.equal(safeStopRecord.currentRunOnly, true);
  }
}

function localPathForProviderRef(outDir: string, ref: string): string {
  const match = ref.match(/^(\.sciforge\/vision-runs\/[^/]+)\//u);
  assert.ok(match, `provider evidence ref must be run-scoped: ${ref}`);
  return join(outDir, relative(match[1] as string, ref));
}

function plainRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value) as Array<[string, unknown]>);
}

function elapsedSince(start: number): number {
  return Math.max(0.01, performance.now() - start);
}

function requiredRef(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${label} is required.`);
  }
  assert.ok(value.trim(), `${label} is required.`);
  return value;
}

function readCurrentRecord(refs: VirtualAppScreenSessionManagerRefs): NativeHostRecord {
  const record = readVirtualAppScreenNativeHostSessionRecord({
    sessionRef: refs.sessionRef,
    screenRef: refs.screenRef,
  });
  assert.ok(record, 'expected current Native Host session record.');
  return record;
}
