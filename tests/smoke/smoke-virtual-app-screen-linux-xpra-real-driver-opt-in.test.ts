import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  createLinuxXpraVirtualDisplayDriverHooks,
} from '../../src/runtime/computer-use/native-providers/linux-xpra-virtual-display-driver.js';
import {
  LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
  createLinuxXpraVirtualDisplayProvider,
} from '../../src/runtime/computer-use/native-providers/linux-xpra-virtual-display-provider.js';
import {
  xpraDisplayForRunId,
} from '../../src/runtime/computer-use/native-providers/linux-xpra-driver-helpers.js';
import {
  createVirtualAppScreenNativeExecutor,
} from '../../src/runtime/computer-use/virtual-app-screen-native-executor.js';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandRunId,
} from '../../src/runtime/computer-use/virtual-app-screen-command.js';
import {
  assertRealHostSessionEvidenceManifestGateFromEnv,
} from './helpers/virtual-app-screen-real-host-evidence-manifest-gates.js';

const execFileAsync = promisify(execFile);

const REAL_DRIVER_OPT_IN_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_XPRA_REAL_DRIVER';
const MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST';
const TARGET_KIND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND';
const TARGET_COMMAND_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_COMMAND';
const TARGET_ARGS_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_ARGS_JSON';

test('Linux Xpra real-driver smoke is opt-in, sequenced after macOS, and proves attach/readFrame refs', async () => {
  if (!realDriverOptedIn()) {
    const manifest = defaultBlockedManifest();

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.blockedByOptInEnv, REAL_DRIVER_OPT_IN_ENV);
    assert.equal(manifest.optInEnv, REAL_DRIVER_OPT_IN_ENV);
    assert.equal(manifest.evidence.providerExecuted, false);
    assert.equal(manifest.evidence.diagnosticOnly, true);
    assert.equal(manifest.sequencing.linuxCompletionClaim, false);
    assert.equal(manifest.sequencing.actualLinuxPassRequiresMacosClosedLoopEvidence, true);
    assert.equal(manifest.sequencing.macosClosedLoopEvidenceManifestEnv, MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV);
    assert.equal(manifest.attachReadFrameRequiredWhenActuallyRun, true);
    return;
  }

  const macosEvidenceManifestRef = await assertMacosClosedLoopEvidenceManifestGate();
  assert.equal(process.platform, 'linux', `${REAL_DRIVER_OPT_IN_ENV}=1 requires Linux; current platform is ${process.platform}.`);

  const targetKind = process.env[TARGET_KIND_ENV]?.trim() || 'generic-editor';
  const targetCommand = process.env[TARGET_COMMAND_ENV]?.trim() || 'xterm';
  const targetArgs = parseTargetArgs(process.env[TARGET_ARGS_ENV]);
  const outDir = await mkdtemp(join(tmpdir(), 'sciforge-linux-xpra-real-driver-'));
  const command = parsedAttachCommand(targetKind);
  const runId = virtualAppScreenRuntimeCommandRunId(command);
  const display = xpraDisplayForRunId(runId);
  const provider = createLinuxXpraVirtualDisplayProvider({
    probeOptions: { targetAppKind: targetKind },
    hooks: createLinuxXpraVirtualDisplayDriverHooks({
      targetApp: {
        kind: targetKind,
        command: targetCommand,
        args: targetArgs,
      },
      probeOptions: { targetAppKind: targetKind },
      outDir,
    }),
  });
  const executor = createVirtualAppScreenNativeExecutor({
    executorId: 'native-session-manager:linux-xpra-real-driver-opt-in-smoke',
    providerId: LINUX_XPRA_VIRTUAL_DISPLAY_PROVIDER_ID,
    supportedProfiles: [targetKind],
    provider,
    targetAppKind: targetKind,
  });

  try {
    const attached = await executor.attach(command);

    assert.equal(attached.status, 'attached', attached.blockedReason);
    assert.equal(attached.evidence.providerExecuted, true);
    assert.equal(attached.evidence.nativeSessionCreated, true);
    assert.equal(attached.evidence.currentFrameMaterialized, true);
    assert.equal(attached.evidence.diagnosticOnly, false);
    assertHostOwnedRefs(attached.refs, [
      'sessionRef',
      'liveSurfaceRef',
      'surfaceTransportRef',
      'frameStreamRef',
      'currentFrameRef',
      'frameTransportContractRef',
      'frameTelemetryRef',
      'surfaceOwnerRef',
      'displayOwnerRef',
      'evidenceLedgerRef',
    ]);
    assertPlatformEvidenceRefs(attached.refs, attached.evidence.evidenceRefs);
    assertNoFixtureOrReplayEvidence(attached.evidence.evidenceRefs);
    assert.equal(macosEvidenceManifestRef.length > 0, true);
  } finally {
    await stopXpraDisplay(display);
    await rm(outDir, { recursive: true, force: true });
  }
});

function realDriverOptedIn(): boolean {
  return /^(1|true|yes|on)$/iu.test(process.env[REAL_DRIVER_OPT_IN_ENV]?.trim() ?? '');
}

function defaultBlockedManifest() {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-linux-xpra-real-driver-smoke.v1',
    status: 'blocked',
    passClaim: false,
    blockedByOptInEnv: REAL_DRIVER_OPT_IN_ENV,
    blockedReason: `${REAL_DRIVER_OPT_IN_ENV} is not enabled; Linux Xpra real-driver execution is skipped and cannot claim VirtualAppScreen P2.1 completion.`,
    optInEnv: REAL_DRIVER_OPT_IN_ENV,
    attachReadFrameRequiredWhenActuallyRun: true,
    humanInputCoveredBy: 'npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
    verificationCommand: 'npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in --silent',
    evidence: {
      providerExecuted: false,
      diagnosticOnly: true,
    },
    sequencing: {
      phase: 'VirtualAppScreen P2.1',
      linuxCompletionClaim: false,
      actualLinuxPassRequiresMacosClosedLoopEvidence: true,
      macosClosedLoopEvidenceManifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
      macosClosedLoopEvidenceProducer: 'npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent',
    },
  } as const;
}

async function assertMacosClosedLoopEvidenceManifestGate(): Promise<string> {
  return assertRealHostSessionEvidenceManifestGateFromEnv({
    expectedPlatformProviders: ['macos'],
    manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    gateName: 'Linux Xpra real-driver macOS sequencing gate',
    missingManifestMessage: [
      `${REAL_DRIVER_OPT_IN_ENV}=1 is sequenced after macOS real closed-loop evidence.`,
      'Producer: npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent',
    ].join(' '),
  });
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
    '--screen-ref "virtual-app-screen:linux-xpra-real-driver/screen"',
    '--activation-ref "computer-use:native-host/linux-xpra-real-driver/attach-request.json"',
    '--adapter-readiness-ref "computer-use:native-host/linux-xpra-real-driver/adapter-readiness.json"',
    '--evidence-ledger-ref "computer-use:native-host/linux-xpra-real-driver/evidence-ledger.json"',
    '--gui-present-ref "gui.present:linux-xpra-real-driver/screen-pane"',
  ].join(' '));
  assert.equal(parsed.kind, 'parsed');
  if (parsed.kind !== 'parsed') throw new Error('expected parsed command');
  return parsed.command;
}

function assertHostOwnedRefs(refs: object, keys: string[]): void {
  const record = refs as Record<string, unknown>;
  for (const key of keys) {
    assertHostOwnedRef(record[key], key);
  }
}

function assertHostOwnedRef(value: unknown, label: string): string {
  const ref = requiredRef(value, label);
  assert.match(ref, /^computer-use:native-host\//u, `${label} must be Host-owned.`);
  return ref;
}

function assertPlatformEvidenceRefs(refs: object, evidenceRefsValue: unknown): void {
  const record = refs as Record<string, unknown>;
  const evidenceRefs = stringsFromUnknown(evidenceRefsValue);
  const platformDriverRef = assertHostOwnedRef(record.platformDriverRef, 'platformDriverRef');
  assert.match(platformDriverRef, /^computer-use:native-host\/platform-drivers\//u);
  const adapterReadinessRef = requiredProviderRunRef(record.adapterReadinessRef, 'adapterReadinessRef');
  const providerLifecycleSessionRef = requiredProviderRunRef(record.providerLifecycleSessionRef, 'providerLifecycleSessionRef');
  assert.match(providerLifecycleSessionRef, /^\.sciforge\/vision-runs\/[^/]+\/virtual-display-provider\/session\.json$/u);
  for (const ref of [platformDriverRef, adapterReadinessRef, providerLifecycleSessionRef]) {
    assert.equal(evidenceRefs.includes(ref), true, `attached evidenceRefs must include ${ref}.`);
  }
}

function requiredProviderRunRef(value: unknown, label: string): string {
  const ref = requiredRef(value, label);
  assert.match(ref, /^\.sciforge\/vision-runs\/[^/]+\/virtual-display-provider\//u, `${label} must be provider-owned and run-scoped.`);
  return ref;
}

function assertNoFixtureOrReplayEvidence(values: unknown): void {
  for (const value of stringsFromUnknown(values)) {
    assert.doesNotMatch(value, /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|replay|snapshot|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/iu);
  }
}

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
}

function requiredRef(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} is required.`);
  const ref = value as string;
  assert.ok(ref.trim(), `${label} is required.`);
  return ref;
}

async function stopXpraDisplay(display: string): Promise<void> {
  try {
    await execFileAsync('xpra', ['stop', display], { timeout: 15000, maxBuffer: 1024 * 1024 });
  } catch {
    // Best-effort cleanup for opt-in real-driver runs.
  }
}
