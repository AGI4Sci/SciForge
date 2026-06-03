import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  NativeHostLedgerEventType,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/contracts.js';
import {
  createWindowsIddVirtualDisplayDriverHooks,
} from '../../src/runtime/computer-use/native-providers/windows-idd-virtual-display-driver.js';
import {
  WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
  createWindowsIddVirtualDisplayProvider,
} from '../../src/runtime/computer-use/native-providers/windows-idd-virtual-display-provider.js';
import {
  createVirtualAppScreenNativeExecutor,
} from '../../src/runtime/computer-use/virtual-app-screen-native-executor.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
  resetVirtualAppScreenNativeHostSessionStoreForTests,
} from '../../src/runtime/computer-use/virtual-app-screen-native-host-session-store.js';
import {
  type VirtualAppScreenSessionManagerAttachResult,
  type VirtualAppScreenSessionManagerRefs,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import {
  parseVirtualAppScreenRuntimeCommand,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  assertRealHostSessionEvidenceManifestGateFromEnv,
} from './helpers/virtual-app-screen-real-host-evidence-manifest-gates.js';

const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_REAL_DRIVER';
const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS';
const VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON';
const PERMISSION_GRANTS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_WINDOWS_IDD_PERMISSION_GRANTS';
const LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';
const TARGET_NAME_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_NAME';

const TARGET_APP_SCALAR_ENVS = [
  TARGET_KIND_ENV,
  TARGET_NAME_ENV,
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_PATH',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_USER_MODEL_ID',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN',
] as const;

test('Windows IDD real-driver smoke is opt-in and requires Host-owned diagnosticOnly=false evidence', { timeout: 120_000 }, async () => {
  if (!realDriverOptedIn()) {
    await assertDefaultBootstrapFailClosed();
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-windows-idd-real-driver-smoke.v1',
      status: 'not-run',
      optInEnv: REAL_DRIVER_OPT_IN_ENV,
      runtimeHooksEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
      permissionGrantsEnv: PERMISSION_GRANTS_ENV,
      targetAppJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
      targetAppScalarEnvs: TARGET_APP_SCALAR_ENVS,
      attachReadFrameRequiredWhenOptedIn: true,
      requiresHostOwnedRefsForPass: true,
      requiresDiagnosticOnlyFalseForPass: true,
      actualWindowsPassRequiresLinuxClosedLoopEvidence: true,
      linuxClosedLoopEvidenceManifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
      verificationCommand: [
        `${REAL_DRIVER_OPT_IN_ENV}=1`,
        `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1`,
        'node --import tsx --test tests/smoke/smoke-virtual-app-screen-windows-idd-real-driver-opt-in.test.ts',
      ].join(' '),
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.optInEnv, REAL_DRIVER_OPT_IN_ENV);
    assert.equal(manifest.requiresHostOwnedRefsForPass, true);
    assert.equal(manifest.requiresDiagnosticOnlyFalseForPass, true);
    assert.equal(manifest.actualWindowsPassRequiresLinuxClosedLoopEvidence, true);
    assert.equal(manifest.linuxClosedLoopEvidenceManifestEnv, LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV);
    assert.equal(manifest.attachReadFrameRequiredWhenOptedIn, true);
    return;
  }

  await assertLinuxClosedLoopEvidenceManifestGate();
  assert.equal(process.platform, 'win32', `${REAL_DRIVER_OPT_IN_ENV}=1 requires Windows win32; current platform is ${process.platform}.`);
  assert.ok(
    runtimeDriverHooksOptedIn(),
    `${REAL_DRIVER_OPT_IN_ENV}=1 must also set ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1 to exercise the product runtime bootstrap path.`,
  );

  const targetKind = targetAppKind();
  const targetName = targetAppName(targetKind);
  const permissionGrants = permissionGrantsOptedIn()
    ? { 'permission:windows/idd-driver-authorized': true }
    : undefined;
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-windows-idd-real-driver-'));
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  try {
    const provider = createWindowsIddVirtualDisplayProvider({
      providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
      probeOptions: {
        targetAppKind: targetKind,
        permissionGrants,
      },
      hooks: createWindowsIddVirtualDisplayDriverHooks({
        providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
        outDir,
        targetApp: targetAppSpecWithEnvDefaults(targetKind, targetName),
        probeOptions: {
          targetAppKind: targetKind,
          permissionGrants,
        },
      }),
    });
    const executor = createVirtualAppScreenNativeExecutor({
      executorId: 'native-session-manager:windows-idd-real-driver-opt-in-smoke',
      providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
      supportedProfiles: [targetKind],
      provider,
      targetAppKind: targetKind,
      targetAppName: targetName,
    });

    const attached = await executor.attach(parsedAttachCommand(targetKind));
    if (attached.status !== 'attached') {
      assertOptInBlockedEvidence(attached);
      assert.fail(optInBlockedPassFailureMessage(attached));
    }

    assert.equal(attached.providerId, WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID);
    assert.equal(attached.evidence.providerExecuted, true);
    assert.equal(attached.evidence.nativeSessionCreated, true);
    assert.equal(attached.evidence.liveFrameAttached, true);
    assert.equal(attached.evidence.currentFrameMaterialized, true);
    assert.equal(attached.evidence.diagnosticOnly, false);
    assert.equal(attached.evidence.surfaceTransport?.diagnosticOnly, false);
    assert.equal(attached.evidence.surfaceTransport?.productFallback, false);
    assert.equal(attached.evidence.surfaceTransport?.singleInteractiveTruth, true);
    assert.equal(attached.evidence.affectsPhysicalDisplay, false);
    assert.equal(attached.evidence.sharedSystemInputUsed, false);
    assert.equal(attached.evidence.systemPointerMoved, false);
    assert.equal(attached.evidence.systemKeyboardEventsSent, false);
    assertNativeHostRefs(attached.refs, [
      'currentRunRef',
      'currentRunPointerRef',
      'sessionRef',
      'liveSurfaceRef',
      'surfaceTransportRef',
      'frameStreamRef',
      'currentFrameRef',
      'frameTransportContractRef',
      'frameTelemetryRef',
      'mediaChannelRef',
      'dataChannelRef',
      'liveBindingAttachGrantRef',
      'grantValidationRef',
      'surfaceOwnerRef',
      'displayOwnerRef',
      'evidenceLedgerRef',
    ]);
    assertNoFallbackOrFixtureEvidence(attached.evidence.evidenceRefs ?? []);

    const record = readVirtualAppScreenNativeHostSessionRecord({
      sessionRef: attached.refs.sessionRef,
      screenRef: attached.refs.screenRef,
    });
    assert.ok(record, 'attached Windows IDD smoke must record a current Native Host session binding.');
    assert.equal(record.diagnosticOnly, false);
    assert.equal(record.currentRunRef, attached.refs.currentRunRef);
    assertLedgerTypes(record, ['session.created', 'app.launched', 'surface.attached', 'grant.validated', 'frame.read']);

    const ledger = record.host.getLedger(record.sessionId);
    assert.ok(ledger, 'Native Host ledger must remain readable after Windows IDD attach.');
    assert.equal(ledger.currentRunRef, record.currentRunRef);
    assert.equal(ledger.entries.every((entry) => entry.source === 'native-virtual-app-screen-host'), true);
    assert.equal(ledger.entries.every((entry) => entry.diagnosticOnly === false), true);
    assertNoFallbackOrFixtureEvidence(ledger.entries.flatMap((entry) => [
      entry.eventRef,
      ...Object.values(entry.refs).flatMap((value) => Array.isArray(value) ? value : [value]),
    ]));
  } finally {
    resetVirtualAppScreenNativeHostSessionStoreForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

async function assertDefaultBootstrapFailClosed(): Promise<void> {
  resetVirtualAppScreenNativeHostSessionStoreForTests();
  try {
    const provider = createWindowsIddVirtualDisplayProvider({
      providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
      probeOptions: {
        targetAppKind: 'generic-editor',
      },
    });
    const executor = createVirtualAppScreenNativeExecutor({
      executorId: 'native-session-manager:windows-idd-real-driver-default-blocked-smoke',
      providerId: WINDOWS_IDD_VIRTUAL_DISPLAY_PROVIDER_ID,
      supportedProfiles: ['generic-editor'],
      provider,
      targetAppKind: 'generic-editor',
    });
    const result = await executor.attach(parsedAttachCommand('generic-editor'));
    assert.notEqual(result.status, 'attached');
    assert.equal(result.evidence.providerExecuted, false);
    assert.equal(result.evidence.mutatingActionExecuted, false);
    assert.equal(result.evidence.nativeSessionCreated, false);
    assert.notEqual(result.evidence.diagnosticOnly, false);
    assert.doesNotMatch(result.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\//u);
    assert.match(
      result.blockedReason ?? '',
      /side-effect hook is not registered|Windows IDD VirtualDisplayProvider/u,
    );
  } finally {
    resetVirtualAppScreenNativeHostSessionStoreForTests();
  }
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
    `${REAL_DRIVER_OPT_IN_ENV}=1 is an actual Windows IDD real-driver pass smoke.`,
    'A blocked attach is valid fail-closed evidence, but it is not a pass.',
    result.blockedReason ? `blockedReason=${result.blockedReason}` : '',
  ].filter(Boolean).join(' ');
}

async function assertLinuxClosedLoopEvidenceManifestGate(): Promise<string> {
  return assertRealHostSessionEvidenceManifestGateFromEnv({
    expectedPlatformProviders: ['linux-xpra', 'linux'],
    manifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    gateName: 'Windows IDD real-driver Linux sequencing gate',
    missingManifestMessage: [
      `${REAL_DRIVER_OPT_IN_ENV}=1 is sequenced after an actual Linux real closed-loop pass.`,
      'Producer: npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
    ].join(' '),
  });
}

function parsedAttachCommand(targetKind: string) {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    `--profile "${targetKind}"`,
    `--target-app-ref "app:profile/${targetKind}"`,
    '--screen-ref "virtual-app-screen:windows-idd-real-driver/screen"',
    '--activation-ref "computer-use:native-host/windows-idd-real-driver/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/windows-idd-real-driver/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/windows-idd-real-driver/evidence-ledger.json"',
    '--gui-present-ref "gui.present:windows-idd-real-driver/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
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

function assertNoFallbackOrFixtureEvidence(values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(
      value,
      /(?:fixture|mock|replay|snapshot|noVNC|Xvfb|RDP|QEMU|Playwright|serve-web|code-server|openvscode)/iu,
    );
  }
}

function requiredRef(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${label} is required.`);
  }
  assert.ok(value.trim(), `${label} is required.`);
  return value;
}
