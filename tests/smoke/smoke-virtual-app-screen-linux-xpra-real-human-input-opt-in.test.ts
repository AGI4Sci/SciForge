import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
  ensureVirtualAppScreenRuntimeExecutorsRegistered,
  resetVirtualAppScreenRuntimeExecutorsForTests,
} from '../../src/runtime/computer-use/virtual-app-screen-runtime-executors.js';
import {
  parseVirtualScreenInputIntentCommand,
} from '../../src/runtime/computer-use/input-intent-command.js';
import {
  runVirtualAppScreenInputRuntime,
} from '../../src/runtime/computer-use/virtual-app-screen-input-runtime.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
} from '../../src/runtime/computer-use/virtual-app-screen-native-host-session-store.js';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  attachVirtualAppScreenSession,
  type VirtualAppScreenSessionManagerRefs,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import {
  xpraDisplayForRunId,
} from '../../src/runtime/computer-use/native-providers/linux-xpra-driver-helpers.js';
import {
  type NativeHostLedgerEventType,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/contracts.js';
import {
  defaultVirtualAppScreenRealHostSessionEvidenceManifestPath,
  writeVirtualAppScreenRealHostSessionEvidenceManifest,
} from '../../tools/virtual-app-screen-real-host-session-evidence.js';
import {
  assertRealHostSessionEvidenceManifestGateFromEnv,
} from './helpers/virtual-app-screen-real-host-evidence-manifest-gates.js';

const execFileAsync = promisify(execFile);

const REAL_HUMAN_INPUT_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_HUMAN_INPUT';
const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_DRIVER';
const REAL_HOST_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST';
const MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';
const TARGET_COMMAND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND';
const TARGET_ARGS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON';

test('Linux Xpra real human input smoke is opt-in and replays Host ledger evidence', async () => {
  if (!realHumanInputOptedIn()) {
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-linux-xpra-real-human-input-smoke.v1',
      status: 'not-run',
      optInEnv: REAL_HUMAN_INPUT_OPT_IN_ENV,
      realDriverOptInEnv: REAL_DRIVER_OPT_IN_ENV,
      runtimeHooksEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
      targetAppJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
      requiresAttachReadFrameHumanInputPauseResumeLedgerReplay: true,
      verificationCommand: 'npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
      sequencing: {
        linuxCompletionClaim: false,
        actualLinuxPassRequiresMacosClosedLoopEvidence: true,
        macosClosedLoopEvidenceManifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        macosClosedLoopEvidenceProducer: 'npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent',
      },
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.optInEnv, REAL_HUMAN_INPUT_OPT_IN_ENV);
    assert.equal(manifest.requiresAttachReadFrameHumanInputPauseResumeLedgerReplay, true);
    assert.equal(manifest.sequencing.actualLinuxPassRequiresMacosClosedLoopEvidence, true);
    return;
  }

  const macosEvidenceManifestRef = await assertMacosClosedLoopEvidenceManifestGate();
  assert.equal(process.platform, 'linux', `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 requires Linux; current platform is ${process.platform}.`);
  assert.ok(
    realDriverOptedIn(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 must also set ${REAL_DRIVER_OPT_IN_ENV}=1 to require the real Xpra driver path.`,
  );
  assert.ok(
    runtimeDriverHooksOptedIn(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 must also set ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1 to exercise the product runtime bootstrap path.`,
  );

  const targetKind = process.env[TARGET_KIND_ENV]?.trim() || 'generic-editor';
  const targetCommand = process.env[TARGET_COMMAND_ENV]?.trim() || 'xterm';
  const targetArgs = parseTargetArgs(process.env[TARGET_ARGS_ENV]);
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-linux-xpra-real-human-input-'));
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const command = parsedAttachCommand(targetKind);
  const display = xpraDisplayForRunId(virtualAppScreenRuntimeCommandRunId(command));
  try {
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'linux',
      nativeDriverHooks: {
        env: process.env,
        linux: {
          outDir,
          targetApp: {
            kind: targetKind,
            command: targetCommand,
            args: targetArgs,
          },
          probeOptions: {
            targetAppKind: targetKind,
          },
        },
      },
      linuxProviderOptions: {
        probeOptions: {
          targetAppKind: targetKind,
        },
      },
      linuxExecutorOptions: {
        executorId: 'native-session-manager:linux-xpra-real-human-input-opt-in-smoke',
        supportedProfiles: [targetKind],
        targetAppKind: targetKind,
      },
      linuxInputExecutorOptions: {
        executorId: 'input-runtime:linux-xpra-real-human-input-opt-in-smoke',
      },
    });

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

    const input = await runVirtualAppScreenInputRuntime(parsedTypeInputCommandFromAttach(attached.refs));
    assert.equal(input.status, 'executed', input.message);
    assert.equal(input.providerId, 'native-virtual-app-screen-host');
    assert.equal(input.evidence.providerExecuted, true);
    assert.equal(input.evidence.mutatingActionExecuted, true);
    assert.deepEqual(input.routeDecision.providerOperations, ['sendInputIntent', 'readFrame']);
    assert.match(String(input.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//u);
    assertNoFixtureOrReplayEvidence(input.evidence.evidenceRefs);
    assertLedgerTypes(record, ['human-input.accepted']);
    assertFrameReadsAtLeast(record, 2);
    await assertProviderInputVerification(outDir, record, 'sendInputIntent-type');

    const takeover = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('takeover', attached.refs));
    assert.equal(takeover.status, 'executed', takeover.message);
    assert.deepEqual(takeover.routeDecision.providerOperations, ['pause']);
    assert.match(String(takeover.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assertLedgerTypes(record, ['agent.paused']);
    await assertProviderInputVerification(outDir, record, 'pause-takeover');

    const resume = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('resume-agent', attached.refs));
    assert.equal(resume.status, 'executed', resume.message);
    assert.deepEqual(resume.routeDecision.providerOperations, ['resume', 'readFrame']);
    assert.match(String(resume.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRefreshRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//u);
    assertLedgerTypes(record, ['agent.resumed']);
    assertFrameReadsAtLeast(record, 3);
    await assertProviderInputVerification(outDir, record, 'resume-resume-agent');

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
        platformProvider: 'linux-xpra',
        targetAppProfile: targetKind,
        userIntent: 'Linux Xpra real Host session attached, accepted human input, paused automation, and resumed with a fresh frame.',
        attach: attached,
        input,
        takeover,
        resume,
      },
    );
    assert.equal(evidenceManifest.status, 'passed', evidenceManifest.blockedReason ?? undefined);
    assert.equal(evidenceManifest.userAcceptanceInput.evidenceClaims?.[0]?.kind, 'real-virtual-app-screen');
    assert.equal(macosEvidenceManifestRef.length > 0, true);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await stopXpraDisplay(display);
    await rm(outDir, { recursive: true, force: true });
  }
});

function realHumanInputOptedIn(): boolean {
  return truthyEnv(process.env[REAL_HUMAN_INPUT_OPT_IN_ENV]);
}

async function assertMacosClosedLoopEvidenceManifestGate(): Promise<string> {
  return assertRealHostSessionEvidenceManifestGateFromEnv({
    expectedPlatformProviders: ['macos'],
    manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    gateName: 'Linux Xpra real-human-input macOS sequencing gate',
    missingManifestMessage: [
      `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 is sequenced after macOS real closed-loop evidence.`,
      'Producer: npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent',
    ].join(' '),
  });
}

function realDriverOptedIn(): boolean {
  return truthyEnv(process.env[REAL_DRIVER_OPT_IN_ENV]);
}

function runtimeDriverHooksOptedIn(): boolean {
  return truthyEnv(process.env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]);
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
    '--screen-ref "virtual-app-screen:linux-xpra-real-human-input/screen"',
    '--activation-ref "computer-use:native-host/linux-xpra-real-human-input/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/linux-xpra-real-human-input/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/linux-xpra-real-human-input/evidence-ledger.json"',
    '--gui-present-ref "gui.present:linux-xpra-real-human-input/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedTypeInputCommandFromAttach(refs: VirtualAppScreenSessionManagerRefs) {
  const text = `sciforge_linux_xpra_${Date.now()}`;
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind type',
    `--session-ref "${requiredRef(refs.sessionRef, 'sessionRef')}"`,
    `--screen-ref "${requiredRef(refs.screenRef, 'screenRef')}"`,
    `--target-app-ref "${requiredRef(refs.targetAppRef, 'targetAppRef')}"`,
    `--target-window-ref "${requiredRef(refs.targetWindowRef, 'targetWindowRef')}"`,
    `--frame-ref "${requiredRef(refs.currentFrameRef, 'currentFrameRef')}"`,
    `--input-lease-ref "${requiredRef(refs.inputLeaseRef, 'inputLeaseRef')}"`,
    `--action-adapter-ref "${requiredRef(refs.actionAdapterRef, 'actionAdapterRef')}"`,
    `--adapter-readiness-ref "${requiredRef(refs.adapterReadinessRef, 'adapterReadinessRef')}"`,
    `--evidence-ledger-ref "${requiredRef(refs.evidenceLedgerRef, 'evidenceLedgerRef')}"`,
    `--text "${text}"`,
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input intent command');
  return parsed.command;
}

function parsedControlCommandFromAttach(
  controlKind: 'takeover' | 'resume-agent',
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

function assertNoFixtureOrReplayEvidence(values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(value, /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|replay|snapshot|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/iu);
  }
}

async function assertProviderInputVerification(
  outDir: string,
  record: NonNullable<ReturnType<typeof readVirtualAppScreenNativeHostSessionRecord>>,
  slug: string,
) {
  const ledger = record.host.getLedger(record.sessionId);
  assert.ok(ledger, 'Native Host ledger must be readable.');
  const providerRefs = ledger.entries
    .flatMap((entry) => Object.values(entry.refs).flatMap((value) => Array.isArray(value) ? value : [value]))
    .filter((ref): ref is string => typeof ref === 'string');
  const verificationRef = providerRefs.find((ref) => ref.endsWith(`/verification/${slug}.json`));
  assert.ok(verificationRef, `Native Host ledger must reference provider verification ${slug}.`);
  const verification = recordObject(JSON.parse(await readFile(localPathForRunRef(outDir, verificationRef), 'utf8')));
  assert.equal(verification.displayScoped, true);
  assert.equal(verification.affectsPhysicalDisplay, false);
  assert.equal(verification.sharedSystemInputUsed, false);
  assert.equal(verification.systemPointerMoved, false);
  assert.equal(verification.systemKeyboardEventsSent, false);
  assert.match(requiredRef(verification.display, 'verification.display'), /^:\d+$/u);
  assert.equal(requiredRef(verification.targetWindowId, 'verification.targetWindowId').trim().length > 0, true);

  const isolationRef = providerRefs.find((ref) => ref.endsWith(`/control-plane/${slug}/isolation-evidence.json`));
  const physicalDesktopProbeRef = providerRefs.find((ref) => ref.endsWith(`/control-plane/${slug}/physical-desktop-probe.json`));
  assert.ok(isolationRef, `Native Host ledger must reference provider isolation evidence ${slug}.`);
  assert.ok(physicalDesktopProbeRef, `Native Host ledger must reference provider physical desktop probe ${slug}.`);
  const isolation = recordObject(JSON.parse(await readFile(localPathForRunRef(outDir, isolationRef), 'utf8')));
  const physicalDesktopProbe = recordObject(JSON.parse(await readFile(localPathForRunRef(outDir, physicalDesktopProbeRef), 'utf8')));
  for (const evidence of [isolation, physicalDesktopProbe]) {
    assert.equal(evidence.affectsPhysicalDisplay, false);
    assert.equal(evidence.sharedSystemInputUsed, false);
    assert.equal(evidence.systemPointerMoved, false);
    assert.equal(evidence.systemKeyboardEventsSent, false);
  }
}

function localPathForRunRef(outDir: string, ref: string) {
  const match = ref.match(/^(\.sciforge\/vision-runs\/[^/]+)\//u);
  assert.ok(match, `provider verification ref must be run-scoped: ${ref}`);
  return join(outDir, relative(match[1] as string, ref));
}

function recordObject(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function requiredRef(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${label} is required.`);
  }
  assert.ok(value.trim(), `${label} is required.`);
  return value;
}

async function stopXpraDisplay(display: string): Promise<void> {
  try {
    await execFileAsync('xpra', ['stop', display], { timeout: 15000, maxBuffer: 1024 * 1024 });
  } catch {
    // Best-effort cleanup for opt-in real-driver runs.
  }
}
