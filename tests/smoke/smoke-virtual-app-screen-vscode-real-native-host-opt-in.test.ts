import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
  VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
  ensureVirtualAppScreenRuntimeExecutorsRegistered,
  resetVirtualAppScreenRuntimeExecutorsForTests,
} from '../../src/runtime/computer-use/virtual-app-screen-runtime-executors.js';
import {
  readVirtualAppScreenNativeHostSessionRecord,
} from '../../src/runtime/computer-use/virtual-app-screen-native-host-session-store.js';
import {
  attachVirtualAppScreenSession,
  type VirtualAppScreenSessionManagerRefs,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import {
  parseVirtualAppScreenRuntimeCommand,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  resolveVirtualAppScreenAppProfile,
} from '../../src/runtime/computer-use/virtual-app-screen-app-profiles.js';
import type {
  NativeHostLedgerEventType,
} from '../../packages/actions/computer-use/virtual-app-screen-host/src/contracts.js';

const REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_VSCODE_REAL_NATIVE_HOST';
const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER';
const PERMISSION_GRANTS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS';

const TARGET_APP_SCALAR_ENVS = [
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_NAME',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_BUNDLE_ID',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_APP_PATH',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_PROCESS_MATCH',
  'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN',
] as const;

const DEFAULT_VSCODE_TARGET_APP = {
  kind: 'vscode',
  name: 'VS Code',
  bundleId: 'com.microsoft.VSCode',
  processMatch: 'Visual Studio Code|com\\.microsoft\\.VSCode|/Applications/Visual Studio Code\\.app',
  windowTitlePattern: '.*',
} as const;

test('VS Code real Native Host attach smoke is opt-in and only passes with diagnosticOnly=false', { timeout: 120_000 }, async () => {
  if (!realVsCodeNativeHostOptedIn()) {
    await assertDefaultBootstrapFailClosed();
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-vscode-real-native-host-smoke.v1',
      status: 'not-run',
      optInEnv: REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV,
      realDriverOptInEnv: REAL_DRIVER_OPT_IN_ENV,
      runtimeHooksEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
      targetAppJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
      targetAppProfile: 'vscode-editor',
      requiresDiagnosticOnlyFalseAttachWhenOptedIn: true,
      verificationCommand: [
        `${REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV}=1`,
        `${REAL_DRIVER_OPT_IN_ENV}=1`,
        `${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1`,
        'node --import tsx --test tests/smoke/smoke-virtual-app-screen-vscode-real-native-host-opt-in.test.ts',
      ].join(' '),
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.targetAppProfile, 'vscode-editor');
    assert.equal(manifest.requiresDiagnosticOnlyFalseAttachWhenOptedIn, true);
    assert.equal(manifest.optInEnv, REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV);
    return;
  }

  assert.equal(process.platform, 'darwin', `${REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV}=1 requires macOS; current platform is ${process.platform}.`);
  assert.ok(
    realDriverOptedIn(),
    `${REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV}=1 must also set ${REAL_DRIVER_OPT_IN_ENV}=1 to require a real macOS driver attach/readFrame path.`,
  );
  assert.ok(
    runtimeDriverHooksOptedIn(),
    `${REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV}=1 must also set ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1 to exercise the product runtime bootstrap path.`,
  );

  const profile = resolveVirtualAppScreenAppProfile({
    profile: 'vscode-editor',
    targetAppRef: 'app:profile/vscode-editor',
  });
  assert.equal(profile.status, 'resolved');
  if (profile.status !== 'resolved') throw new Error('expected vscode-editor app profile to resolve');
  assert.equal(profile.targetAppKind, 'vscode');
  assert.equal(profile.targetAppRef, 'app:profile/vscode-editor');

  const permissionGrants = permissionGrantsOptedIn()
    ? {
        'permission:macos/screen-recording': true,
        'permission:macos/accessibility': true,
      }
    : undefined;
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-vscode-real-native-host-'));
  resetVirtualAppScreenRuntimeExecutorsForTests();
  try {
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'darwin',
      nativeDriverHooks: {
        env: targetAppEnvWithVsCodeDefaults(process.env),
        macos: {
          outDir,
          probeOptions: {
            targetAppKind: profile.targetAppKind,
            permissionGrants,
          },
        },
      },
      macosProviderOptions: {
        probeOptions: {
          targetAppKind: profile.targetAppKind,
          permissionGrants,
        },
      },
      macosExecutorOptions: {
        executorId: 'native-session-manager:vscode-real-native-host-opt-in-smoke',
        supportedProfiles: [profile.profileId],
        targetAppKind: profile.targetAppKind,
        targetAppName: profile.targetAppName,
      },
      macosInputExecutorOptions: {
        executorId: 'input-runtime:vscode-real-native-host-opt-in-smoke',
      },
    });

    const attached = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.equal(attached.status, 'attached', attached.blockedReason);
    assert.equal(attached.evidence.providerExecuted, true);
    assert.equal(attached.evidence.nativeSessionCreated, true);
    assert.equal(attached.evidence.currentFrameMaterialized, true);
    assert.equal(attached.evidence.diagnosticOnly, false);
    assert.equal(attached.refs.targetAppRef, 'app:profile/vscode-editor');
    assert.match(attached.refs.targetWindowRef ?? '', /^window:.+\/vscode\/main$/u);
    assertNativeHostRefs(attached.refs, [
      'sessionRef',
      'liveSurfaceRef',
      'surfaceTransportRef',
      'frameStreamRef',
      'currentFrameRef',
      'liveBindingAttachGrantRef',
      'grantValidationRef',
      'surfaceOwnerRef',
      'displayOwnerRef',
      'evidenceLedgerRef',
      'currentRunPointerRef',
    ]);
    assertNoFallbackOrFixtureEvidence(attached.evidence.evidenceRefs ?? []);

    const record = readVirtualAppScreenNativeHostSessionRecord({
      sessionRef: attached.refs.sessionRef,
      screenRef: attached.refs.screenRef,
    });
    assert.ok(record, 'attached VS Code smoke must record a current Native Host session binding.');
    assert.equal(record.diagnosticOnly, false);
    assert.equal(record.currentRunRef, attached.refs.currentRunRef);
    assertLedgerTypes(record, ['session.created', 'app.launched', 'surface.attached', 'grant.validated', 'frame.read']);

    const ledger = record.host.getLedger(record.sessionId);
    assert.ok(ledger, 'Native Host ledger must remain readable after VS Code attach.');
    assert.equal(ledger.currentRunRef, record.currentRunRef);
    assert.equal(ledger.entries.every((entry) => entry.source === 'native-virtual-app-screen-host'), true);
    assert.equal(ledger.entries.every((entry) => entry.diagnosticOnly === false), true);
    assertNoFallbackOrFixtureEvidence(ledger.entries.flatMap((entry) => [
      entry.eventRef,
      ...Object.values(entry.refs).flatMap((value) => Array.isArray(value) ? value : [value]),
    ]));
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
    await rm(outDir, { recursive: true, force: true });
  }
});

async function assertDefaultBootstrapFailClosed(): Promise<void> {
  resetVirtualAppScreenRuntimeExecutorsForTests();
  try {
    ensureVirtualAppScreenRuntimeExecutorsRegistered({
      platform: 'darwin',
      nativeDriverHooks: {
        env: {
          [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV]: '0',
          [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify(DEFAULT_VSCODE_TARGET_APP),
        },
      },
      macosExecutorOptions: {
        executorId: 'native-session-manager:vscode-real-native-host-default-blocked-smoke',
        supportedProfiles: ['vscode-editor'],
        targetAppKind: 'vscode',
        targetAppName: 'VS Code',
      },
    });
    const result = await attachVirtualAppScreenSession(parsedAttachCommand());
    assert.notEqual(result.status, 'attached');
    assert.equal(result.evidence.mutatingActionExecuted, false);
    assert.notEqual(result.evidence.diagnosticOnly, false);
    assert.doesNotMatch(result.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\//u);
    assert.match(
      result.blockedReason ?? '',
      /side-effect hook is not registered|No runtime-owned native VirtualAppScreen session executor|node-mac-virtual-display|Screen Recording permission|Accessibility permission/u,
    );
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
  }
}

function parsedAttachCommand() {
  const parsed = parseVirtualAppScreenRuntimeCommand([
    '/computer-use screen attach',
    '--source right-pane-screen',
    '--profile "vscode-editor"',
    '--target-app-ref "app:profile/vscode-editor"',
    '--screen-ref "virtual-app-screen:vscode-real-native-host/screen"',
    '--activation-ref "computer-use:native-host/vscode-real-native-host/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/vscode-real-native-host/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/vscode-real-native-host/evidence-ledger.json"',
    '--gui-present-ref "gui.present:vscode-real-native-host/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function targetAppEnvWithVsCodeDefaults(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (hasExplicitTargetAppEnv(env)) return env;
  return {
    ...env,
    [VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]: JSON.stringify(DEFAULT_VSCODE_TARGET_APP),
  };
}

function hasExplicitTargetAppEnv(env: Record<string, string | undefined>): boolean {
  return Boolean(env[VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV]?.trim())
    || TARGET_APP_SCALAR_ENVS.some((name) => Boolean(env[name]?.trim()));
}

function realVsCodeNativeHostOptedIn(): boolean {
  return truthyEnv(process.env[REAL_VSCODE_NATIVE_HOST_OPT_IN_ENV]);
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
