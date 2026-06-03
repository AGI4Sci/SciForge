import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  NativeHostLedgerEventType,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/contracts.js';
import {
  parseVirtualScreenInputIntentCommand,
} from '../../src/runtime/computer-use/input-intent-command.js';
import {
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
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
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  attachVirtualAppScreenSession,
  type VirtualAppScreenSessionManagerAttachResult,
  type VirtualAppScreenSessionManagerRefs,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import {
  defaultVirtualAppScreenRealHostSessionEvidenceManifestPath,
  writeVirtualAppScreenRealHostSessionEvidenceManifest,
} from '../../tools/virtual-app-screen-real-host-session-evidence.js';
import {
  assertRealHostSessionEvidenceManifestGateFromEnv,
} from './helpers/virtual-app-screen-real-host-evidence-manifest-gates.js';
import {
  assertProviderInputVerificationFiles,
} from './helpers/virtual-app-screen-provider-evidence-assertions.js';

const REAL_HUMAN_INPUT_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_HUMAN_INPUT';
const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER';
const PERMISSION_GRANTS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_PERMISSION_GRANTS';
const REAL_HOST_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST';
const LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';
const TARGET_NAME_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_NAME';

test('Windows IDD real human input smoke is opt-in and replays Host ledger evidence', { timeout: 120_000 }, async () => {
  if (!realHumanInputOptedIn()) {
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-windows-idd-real-human-input-smoke.v1',
      status: 'not-run',
      optInEnv: REAL_HUMAN_INPUT_OPT_IN_ENV,
      realDriverOptInEnv: REAL_DRIVER_OPT_IN_ENV,
      runtimeHooksEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
      targetAppJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
      requiresAttachReadFrameHumanInputPauseResumeLedgerReplay: true,
      requiresProviderSidecarValidation: true,
      verificationCommand: 'npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in --silent',
      sequencing: {
        windowsCompletionClaim: false,
        actualWindowsPassRequiresLinuxClosedLoopEvidence: true,
        linuxClosedLoopEvidenceManifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        linuxClosedLoopEvidenceProducer: 'npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
      },
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.optInEnv, REAL_HUMAN_INPUT_OPT_IN_ENV);
    assert.equal(manifest.requiresAttachReadFrameHumanInputPauseResumeLedgerReplay, true);
    assert.equal(manifest.requiresProviderSidecarValidation, true);
    assert.equal(manifest.sequencing.windowsCompletionClaim, false);
    assert.equal(manifest.sequencing.actualWindowsPassRequiresLinuxClosedLoopEvidence, true);
    return;
  }

  const linuxEvidenceManifestRef = await assertLinuxClosedLoopEvidenceManifestGate();
  assert.equal(process.platform, 'win32', `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 requires Windows win32; current platform is ${process.platform}.`);
  assert.ok(
    realDriverOptedIn(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 must also set ${REAL_DRIVER_OPT_IN_ENV}=1 to require the real Windows IDD driver path.`,
  );
  assert.ok(
    runtimeDriverHooksOptedIn(),
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 must also set ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1 to exercise the product runtime bootstrap path.`,
  );

  const targetKind = targetAppKind();
  const targetName = targetAppName(targetKind);
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-windows-idd-real-human-input-'));
  resetVirtualAppScreenRuntimeExecutorsForTests();
  const command = parsedAttachCommand(targetKind);
  try {
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'win32',
      nativeDriverHooks: {
        env: process.env,
        windows: {
          outDir,
          targetApp: targetAppSpecWithEnvDefaults(targetKind, targetName),
          probeOptions: {
            targetAppKind: targetKind,
            permissionGrants: permissionGrantsOptedIn()
              ? { 'permission:windows/idd-driver-authorized': true }
              : undefined,
          },
        },
      },
      windowsProviderOptions: {
        probeOptions: {
          targetAppKind: targetKind,
          permissionGrants: permissionGrantsOptedIn()
            ? { 'permission:windows/idd-driver-authorized': true }
            : undefined,
        },
      },
      windowsExecutorOptions: {
        executorId: 'native-session-manager:windows-idd-real-human-input-opt-in-smoke',
        supportedProfiles: [targetKind],
        targetAppKind: targetKind,
        targetAppName: targetName,
      },
      windowsInputExecutorOptions: {
        executorId: 'input-runtime:windows-idd-real-human-input-opt-in-smoke',
      },
    });

    const attached = await attachVirtualAppScreenSession(command);
    if (attached.status !== 'attached') {
      assertOptInBlockedEvidence(attached);
      assert.fail(optInBlockedPassFailureMessage(attached));
    }

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
    assert.ok(record, 'attached Windows IDD smoke must record a current Native Host session binding.');
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
    assertNoFallbackOrFixtureEvidence(input.evidence.evidenceRefs);
    assertLedgerTypes(record, ['human-input.accepted']);
    assertFrameReadsAtLeast(record, 2);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'sendInputIntent-type' });

    const takeover = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('takeover', attached.refs));
    assert.equal(takeover.status, 'executed', takeover.message);
    assert.deepEqual(takeover.routeDecision.providerOperations, ['pause']);
    assert.match(String(takeover.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assertLedgerTypes(record, ['agent.paused']);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'pause-takeover' });

    const resume = await runVirtualAppScreenInputRuntime(parsedControlCommandFromAttach('resume-agent', attached.refs));
    assert.equal(resume.status, 'executed', resume.message);
    assert.deepEqual(resume.routeDecision.providerOperations, ['resume', 'readFrame']);
    assert.match(String(resume.routeDecision.agentQueueRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRefreshRef), /^computer-use:native-host\/provider-adapter-control\//u);
    assert.match(String(resume.routeDecision.currentFrameRef), /^computer-use:native-host\/frames\//u);
    assertLedgerTypes(record, ['agent.resumed']);
    assertFrameReadsAtLeast(record, 3);
    await assertProviderInputVerificationFiles({ outDir, record: providerEvidenceRecord(record), slug: 'resume-resume-agent' });

    const ledgerValidation = record.host.validateLedger(record.sessionId, {
      requireFrame: true,
      requireHumanInput: true,
      requireGrantValidation: true,
    });
    assert.equal(ledgerValidation.ok, true, ledgerValidation.issues.join(' '));

    const evidenceManifest = await writeVirtualAppScreenRealHostSessionEvidenceManifest(
      process.env[REAL_HOST_EVIDENCE_MANIFEST_ENV]?.trim()
        || defaultVirtualAppScreenRealHostSessionEvidenceManifestPath(virtualAppScreenRuntimeCommandRunId(command)),
      {
        runId: virtualAppScreenRuntimeCommandRunId(command),
        platformProvider: 'windows-idd',
        targetAppProfile: targetKind,
        userIntent: 'Windows IDD real Host session attached, accepted human input, paused automation, and resumed with a fresh frame.',
        attach: attached,
        input,
        takeover,
        resume,
      },
    );
    assert.equal(evidenceManifest.status, 'passed', evidenceManifest.blockedReason ?? undefined);
    assert.equal(evidenceManifest.userAcceptanceInput.evidenceClaims?.[0]?.kind, 'real-virtual-app-screen');
    assert.equal(linuxEvidenceManifestRef.length > 0, true);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

function realHumanInputOptedIn(): boolean {
  return truthyEnv(process.env[REAL_HUMAN_INPUT_OPT_IN_ENV]);
}

async function assertLinuxClosedLoopEvidenceManifestGate(): Promise<string> {
  return assertRealHostSessionEvidenceManifestGateFromEnv({
    expectedPlatformProviders: ['linux-xpra', 'linux'],
    manifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    gateName: 'Windows IDD real-human-input Linux sequencing gate',
    missingManifestMessage: [
      `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 is sequenced after an actual Linux real closed-loop pass.`,
      'Producer: npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
    ].join(' '),
  });
}

function targetAppSpecWithEnvDefaults(targetKind: string, targetName: string) {
  const envSpec = targetAppSpecFromEnv(process.env);
  return {
    ...envSpec,
    kind: envSpec.kind ?? targetKind,
    name: envSpec.name ?? targetName,
  };
}

function targetAppSpecFromEnv(env: Record<string, string | undefined>) {
  const jsonSpec = parseTargetAppJsonEnv(env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]);
  return compactRecord({
    ...jsonSpec,
    kind: env[TARGET_KIND_ENV]?.trim() || jsonSpec.kind,
    name: env[TARGET_NAME_ENV]?.trim() || jsonSpec.name,
    command: env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND?.trim() || jsonSpec.command,
    appPath: env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_PATH?.trim() || jsonSpec.appPath,
    appUserModelId: env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_USER_MODEL_ID?.trim() || jsonSpec.appUserModelId,
    processMatch: env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH?.trim() || jsonSpec.processMatch,
    windowTitlePattern: env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN?.trim() || jsonSpec.windowTitlePattern,
    args: parseTargetArgs(env.SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON) ?? jsonSpec.args,
  });
}

function parseTargetAppJsonEnv(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV} must be a JSON object.`);
  return compactRecord({
    kind: stringField(parsed, 'kind'),
    name: stringField(parsed, 'name'),
    command: stringField(parsed, 'command'),
    appPath: stringField(parsed, 'appPath'),
    appUserModelId: stringField(parsed, 'appUserModelId'),
    processMatch: stringField(parsed, 'processMatch'),
    windowTitlePattern: stringField(parsed, 'windowTitlePattern'),
    args: argsField(parsed, 'args'),
  });
}

function parseTargetArgs(value: string | undefined): string[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  assert.ok(Array.isArray(parsed), 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON must be a JSON string array.');
  assert.ok(parsed.every((item): item is string => typeof item === 'string'), 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON must be a JSON string array.');
  return parsed;
}

function stringField(record: unknown, key: string): string | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = (record as Record<string, unknown>)[key];
  if (value === undefined) return undefined;
  assert.equal(typeof value, 'string', `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.${key} must be a string.`);
  const text = value as string;
  return text.trim() || undefined;
}

function argsField(record: unknown, key: string): string[] | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = (record as Record<string, unknown>)[key];
  if (value === undefined) return undefined;
  assert.ok(Array.isArray(value), `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.${key} must be a JSON string array.`);
  assert.ok(value.every((item): item is string => typeof item === 'string'), `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV}.${key} must be a JSON string array.`);
  return value;
}

function compactRecord<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function parsedAttachCommand(targetKind: string) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${targetKind}"`,
    `--target-app-ref "app:profile/${targetKind}"`,
    '--screen-ref "virtual-app-screen:windows-idd-real-human-input/screen"',
    '--activation-ref "computer-use:native-host/windows-idd-real-human-input/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/windows-idd-real-human-input/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/windows-idd-real-human-input/evidence-ledger.json"',
    '--gui-present-ref "gui.present:windows-idd-real-human-input/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedTypeInputCommandFromAttach(refs: VirtualAppScreenSessionManagerRefs) {
  const text = `sciforge_windows_idd_${Date.now()}`;
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

function assertOptInBlockedEvidence(result: VirtualAppScreenSessionManagerAttachResult): void {
  assert.notEqual(result.status, 'attached');
  assert.equal(result.evidence.mutatingActionExecuted, false);
  assert.equal(result.evidence.nativeSessionCreated, false);
  assert.notEqual(result.evidence.diagnosticOnly, false);
  assert.doesNotMatch(result.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\//u);
  assert.doesNotMatch(result.refs.liveSurfaceRef ?? '', /^computer-use:native-host\/surfaces\//u);
  assert.doesNotMatch(result.refs.currentFrameRef ?? '', /^computer-use:native-host\/frames\//u);
  assert.match(
    result.blockedReason ?? '',
    /win32 host platform|driver API is not available|not installed|authorization is not proven|frame capture API is not available|explicit generic target app launch spec|No Windows IDD launch dependency|target app window|attachSurface|readFrame capture failed|side-effect hook is not registered/u,
  );
}

function optInBlockedPassFailureMessage(result: VirtualAppScreenSessionManagerAttachResult): string {
  return [
    `${REAL_HUMAN_INPUT_OPT_IN_ENV}=1 is an actual Windows IDD real human-input pass smoke.`,
    'A blocked attach is valid fail-closed evidence, but it is not a pass.',
    result.blockedReason ? `blockedReason=${result.blockedReason}` : '',
  ].filter(Boolean).join(' ');
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

function plainRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value) as Array<[string, unknown]>);
}

function assertNoFallbackOrFixtureEvidence(values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(
      value,
      /(?:fixture|mock|replay|snapshot|noVNC|Xvfb|RDP|QEMU|Playwright|serve-web|code-server|openvscode)/iu,
    );
  }
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

function targetAppKind(): string {
  return process.env[TARGET_KIND_ENV]?.trim() || 'generic-editor';
}

function targetAppName(targetKind: string): string {
  return process.env[TARGET_NAME_ENV]?.trim() || targetKind;
}

function requiredRef(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${label} is required.`);
  }
  assert.ok(value.trim(), `${label} is required.`);
  return value;
}
