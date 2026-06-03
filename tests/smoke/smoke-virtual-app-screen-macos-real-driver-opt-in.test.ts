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
  runVirtualAppScreenInputRuntime,
} from '../../src/runtime/computer-use/virtual-app-screen-input-runtime.js';
import {
  attachVirtualAppScreenSession,
  type VirtualAppScreenSessionManagerRefs,
} from '../../src/runtime/computer-use/virtual-app-screen-session-manager.js';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  parseVirtualScreenInputIntentCommand,
} from '../../src/runtime/computer-use/input-intent-command.js';

const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_DRIVER';
const PERMISSION_GRANTS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';
const TARGET_COMMAND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND';
const TARGET_ARGS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON';

test('macOS real-driver smoke is opt-in and keeps input fail-closed without an isolated hook', async () => {
  if (!realDriverOptedIn()) {
    await assertDefaultBootstrapFailClosed();
    const manifest = {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-macos-real-driver-smoke.v1',
      status: 'not-run',
      optInEnv: REAL_DRIVER_OPT_IN_ENV,
      runtimeHooksEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV,
      targetAppJsonEnv: VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON_ENV,
      attachReadFrameRequiredWhenOptedIn: true,
      inputClaimedExecutedWithoutHook: false,
      verificationCommand: 'npm run smoke:virtual-app-screen-macos-real-driver:opt-in --silent',
    };

    assert.equal(manifest.status, 'not-run');
    assert.equal(manifest.optInEnv, REAL_DRIVER_OPT_IN_ENV);
    assert.equal(manifest.runtimeHooksEnv, VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV);
    assert.equal(manifest.inputClaimedExecutedWithoutHook, false);
    return;
  }

  assert.equal(process.platform, 'darwin', `${REAL_DRIVER_OPT_IN_ENV}=1 requires macOS; current platform is ${process.platform}.`);
  assert.ok(
    runtimeDriverHooksOptedIn(),
    `${REAL_DRIVER_OPT_IN_ENV}=1 must also set ${VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS_ENV}=1 to exercise the product runtime bootstrap path.`,
  );

  const targetKind = process.env[TARGET_KIND_ENV]?.trim() || 'generic-editor';
  const targetCommand = process.env[TARGET_COMMAND_ENV]?.trim();
  const targetArgs = parseTargetArgs(process.env[TARGET_ARGS_ENV]);
  const permissionGrants = permissionGrantsOptedIn()
    ? {
        'permission:macos/screen-recording': true,
        'permission:macos/accessibility': true,
      }
    : undefined;
  if (permissionGrants && !targetCommand) {
    assert.fail(`${PERMISSION_GRANTS_ENV}=1 requires ${TARGET_COMMAND_ENV} to name an explicit generic GUI app command.`);
  }

  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-macos-real-driver-'));
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
        executorId: 'native-session-manager:macos-real-driver-opt-in-smoke',
        supportedProfiles: [targetKind],
        targetAppKind: targetKind,
      },
      macosInputExecutorOptions: {
        executorId: 'input-runtime:macos-real-driver-opt-in-smoke',
      },
    });

    const command = parsedAttachCommand(targetKind);
    const attached = await attachVirtualAppScreenSession(command);
    if (attached.status !== 'attached') {
      assert.notEqual(attached.status, 'attached');
      assert.equal(attached.evidence.mutatingActionExecuted, false);
      assert.equal(attached.evidence.nativeSessionCreated, false);
      assert.doesNotMatch(attached.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\//u);
      assert.match(
        attached.blockedReason ?? '',
        /node-mac-virtual-display|screencapture|Screen Recording permission|Accessibility permission|explicit generic target app launch spec|could not find a target app window|could not move the target window|readFrame capture failed/u,
      );
      return;
    }

    assert.equal(attached.evidence.providerExecuted, true);
    assert.equal(attached.evidence.nativeSessionCreated, true);
    assert.equal(attached.evidence.currentFrameMaterialized, true);
    assert.equal(attached.evidence.diagnosticOnly, false);
    assert.match(attached.refs.sessionRef ?? '', /^computer-use:native-host\/sessions\//u);
    assert.match(attached.refs.liveSurfaceRef ?? '', /^computer-use:native-host\/surfaces\//u);
    assert.match(attached.refs.frameStreamRef ?? '', /^computer-use:native-host\/surfaces\//u);
    assert.match(attached.refs.currentFrameRef ?? '', /^computer-use:native-host\/frames\//u);
    assert.match(attached.refs.evidenceLedgerRef ?? '', /^computer-use:native-host\/ledgers\//u);
    assert.match(attached.refs.providerLifecycleSessionRef ?? '', /^\.sciforge\/vision-runs\/.+\/virtual-display-provider\/session\.json$/u);

    const input = await runVirtualAppScreenInputRuntime(parsedInputCommandFromAttach(command, attached.refs));

    assert.equal(input.status, 'blocked');
    assert.equal(input.evidence.providerExecuted, true);
    assert.equal(input.evidence.mutatingActionExecuted, false);
    assert.match(input.message, /isolated input\/control hook is not registered/u);
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
          [TARGET_COMMAND_ENV]: 'should-be-ignored-without-runtime-hook-opt-in',
          [TARGET_ARGS_ENV]: '"not-array"',
        },
      },
    });
    const command = parsedAttachCommand('generic-editor');
    const result = await attachVirtualAppScreenSession(command);
    assert.notEqual(result.status, 'attached');
    assert.equal(result.evidence.providerExecuted, false);
    assert.equal(result.evidence.mutatingActionExecuted, false);
    assert.match(result.blockedReason ?? '', /side-effect hook is not registered|No runtime-owned native VirtualAppScreen session executor/u);
  } finally {
    resetVirtualAppScreenRuntimeExecutorsForTests();
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
    '--screen-ref "virtual-app-screen:macos-real-driver/screen"',
    '--activation-ref "computer-use:native-host/macos-real-driver/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/macos-real-driver/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/macos-real-driver/evidence-ledger.json"',
    '--gui-present-ref "gui.present:macos-real-driver/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function parsedInputCommandFromAttach(
  attachCommand: ReturnType<typeof parsedAttachCommand>,
  refs: VirtualAppScreenSessionManagerRefs,
) {
  const runId = virtualAppScreenRuntimeCommandRunId(attachCommand);
  const parsed = parseVirtualScreenInputIntentCommand([
    '/computer-use input-intent',
    '--source virtual-app-screen-canvas',
    '--kind click',
    `--session-ref "${refs.providerLifecycleSessionRef ?? refs.sessionRef ?? `computer-use:native-host/${runId}/session.json`}"`,
    `--screen-ref "${refs.screenRef ?? 'virtual-app-screen:macos-real-driver/screen'}"`,
    `--target-app-ref "${refs.targetAppRef ?? 'app:profile/generic-editor'}"`,
    `--target-window-ref "${refs.targetWindowRef ?? `window:${runId}/generic-editor/main`}"`,
    `--frame-ref "${refs.currentFrameRef ?? `computer-use:native-host/frames/${runId}/current.json`}"`,
    `--input-lease-ref "${refs.inputLeaseRef ?? `computer-use:native-host/${runId}/input-lease.json`}"`,
    `--action-adapter-ref "${refs.actionAdapterRef ?? `computer-use:native-host/${runId}/action-adapter.json`}"`,
    `--adapter-readiness-ref "${refs.adapterReadinessRef ?? `computer-use:native-host/${runId}/adapter-readiness.json`}"`,
    `--evidence-ledger-ref "${refs.evidenceLedgerRef ?? `computer-use:native-host/${runId}/evidence-ledger.json`}"`,
    '--frame-width 100',
    '--frame-height 100',
    '--x-ratio 0.5',
    '--y-ratio 0.5',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed input intent command');
  return parsed.command;
}
