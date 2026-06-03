import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
} from './virtual-app-screen-real-host-session-evidence.js';

export const MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST' as const;
export const LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV =
  'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST' as const;

export type VirtualAppScreenRealHostHandoffTarget = 'linux-after-macos' | 'windows-after-linux';

export interface RealHostSessionEvidenceManifestGateOptions {
  expectedPlatformProviders: readonly string[];
  manifestEnv: string;
  gateName: string;
  missingManifestMessage?: string;
}

export interface VirtualAppScreenRealHostEvidenceManifestHandoffGateOptions {
  target: VirtualAppScreenRealHostHandoffTarget;
  manifestPath?: string;
  env?: Record<string, string | undefined>;
}

export interface VirtualAppScreenRealHostEvidenceManifestHandoffGateSummary {
  status: 'passed' | 'failed';
  target: VirtualAppScreenRealHostHandoffTarget;
  gateName: string;
  manifestEnv: string;
  expectedPlatformProviders: string[];
  manifestPath: string | null;
  passClaim: false;
  sequencingStatus: 'ready-for-linux-real-run' | 'ready-for-windows-real-run' | 'blocked';
  exportEnvCommand: string;
  handoffCommands: string[];
  exportEnvCommandsByShell: ShellSpecificHandoffCommands;
  handoffCommandsByShell: {
    posix: string[];
    powershell: string[];
    cmd: string[];
  };
  issues: string[];
}

export interface ShellSpecificHandoffCommands {
  posix: string;
  powershell: string;
  cmd: string;
}

interface HandoffTargetConfig {
  target: VirtualAppScreenRealHostHandoffTarget;
  gateName: string;
  manifestEnv: typeof MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV | typeof LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV;
  expectedPlatformProviders: string[];
  sequencingReadyStatus: Exclude<VirtualAppScreenRealHostEvidenceManifestHandoffGateSummary['sequencingStatus'], 'blocked'>;
  missingManifestMessage: string;
  handoffCommandScripts: string[];
}

const WINDOWS_REAL_HOST_SESSION_EVIDENCE_MANIFEST_PLACEHOLDER =
  'docs/test-artifacts/virtual-app-screen-real-app-session/windows-idd-real-closed-loop/manifest.json';

const HANDOFF_TARGETS: Record<VirtualAppScreenRealHostHandoffTarget, HandoffTargetConfig> = {
  'linux-after-macos': {
    target: 'linux-after-macos',
    gateName: 'Linux Xpra real-run handoff after macOS',
    manifestEnv: MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    expectedPlatformProviders: ['macos'],
    sequencingReadyStatus: 'ready-for-linux-real-run',
    missingManifestMessage: [
      'Linux Xpra real-run handoff requires a passed macOS real closed-loop evidence manifest.',
      'Producer: npm run smoke:virtual-app-screen-macos-real-human-input:opt-in --silent',
    ].join(' '),
    handoffCommandScripts: [
      'npm run smoke:virtual-app-screen-linux-xpra-real-driver:opt-in --silent',
      'npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
    ],
  },
  'windows-after-linux': {
    target: 'windows-after-linux',
    gateName: 'Windows IDD real-run handoff after Linux',
    manifestEnv: LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    expectedPlatformProviders: ['linux-xpra', 'linux'],
    sequencingReadyStatus: 'ready-for-windows-real-run',
    missingManifestMessage: [
      'Windows IDD real-run handoff requires a passed Linux real closed-loop evidence manifest.',
      'Producer: npm run smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in --silent',
    ].join(' '),
    handoffCommandScripts: [
      'npm run smoke:virtual-app-screen-windows-idd-real-driver:opt-in --silent',
      'npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in --silent',
    ],
  },
};

export async function runVirtualAppScreenRealHostEvidenceManifestHandoffGate(
  options: VirtualAppScreenRealHostEvidenceManifestHandoffGateOptions,
): Promise<VirtualAppScreenRealHostEvidenceManifestHandoffGateSummary> {
  const config = handoffTargetConfig(options.target);
  const manifestPath = options.manifestPath?.trim() || options.env?.[config.manifestEnv]?.trim() || '';
  const baseSummary = buildHandoffSummary(config, manifestPath, 'blocked', [
    `${config.missingManifestMessage} Set ${config.manifestEnv} or pass --manifest.`,
  ]);

  if (!manifestPath) return baseSummary;

  try {
    const validatedManifestPath = await validateRealHostSessionEvidenceManifestGate(manifestPath, {
      expectedPlatformProviders: config.expectedPlatformProviders,
      manifestEnv: config.manifestEnv,
      gateName: config.gateName,
      missingManifestMessage: config.missingManifestMessage,
    });
    return buildHandoffSummary(config, validatedManifestPath, config.sequencingReadyStatus, []);
  } catch (error) {
    return buildHandoffSummary(config, manifestPath, 'blocked', [shortError(error)]);
  }
}

export async function assertRealHostSessionEvidenceManifestGateFromEnv(
  options: RealHostSessionEvidenceManifestGateOptions,
): Promise<string> {
  const manifestPath = process.env[options.manifestEnv]?.trim();
  assert.ok(
    manifestPath,
    [
      options.missingManifestMessage ?? `${options.gateName} requires a real Host session evidence manifest.`,
      `Set ${options.manifestEnv} to a passed ${VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA} manifest.`,
    ].join(' '),
  );
  return validateRealHostSessionEvidenceManifestGate(manifestPath, options);
}

export async function validateRealHostSessionEvidenceManifestGate(
  manifestPath: string,
  options: RealHostSessionEvidenceManifestGateOptions,
): Promise<string> {
  let manifest: Record<string, unknown>;
  try {
    manifest = recordObject(JSON.parse(await readFile(manifestPath, 'utf8')), `${options.gateName} manifest`);
  } catch (error) {
    assert.fail(`${options.manifestEnv} must point to a readable JSON manifest: ${shortError(error)}.`);
  }

  assert.equal(
    manifest.schemaVersion,
    VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA,
    `${options.gateName}: schemaVersion must be ${VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_SCHEMA}.`,
  );
  assert.equal(manifest.status, 'passed', `${options.gateName}: status must be passed.`);
  assertAllowedPlatform(manifest.platformProvider, options);
  assert.equal(manifest.diagnosticOnly, false, `${options.gateName}: diagnosticOnly must be false.`);
  assert.equal(manifest.refsFirst, true, `${options.gateName}: refsFirst must be true.`);

  const validation = recordObject(manifest.validation, `${options.gateName}.validation`);
  assert.equal(validation.ok, true, `${options.gateName}: validation.ok must be true.`);
  const missing = arrayFromUnknown(validation.missing);
  assert.equal(missing.length, 0, `${options.gateName}: validation.missing must be empty.`);

  const dogfoodRefs = recordObject(manifest.dogfoodRefs, `${options.gateName}.dogfoodRefs`);
  if (Object.prototype.hasOwnProperty.call(dogfoodRefs, 'diagnosticOnly')) {
    assert.equal(dogfoodRefs.diagnosticOnly, false, `${options.gateName}: dogfoodRefs.diagnosticOnly must be false.`);
  }
  const currentRunRefs = assertCurrentRunHostRefs(dogfoodRefs, options.gateName);
  for (const field of [
    'realHostProviderSessionRef',
    'realOptInRunRef',
    'sessionRef',
    'liveSurfaceRef',
    'currentFrameRef',
  ]) {
    assertHostOwnedRef(dogfoodRefs[field], `${options.gateName}.dogfoodRefs.${field}`);
  }
  for (const field of [
    'realPlatformEvidenceRefs',
    'realAgentQueueEvidenceRefs',
    'minimalEvidenceReplayRefs',
    'inputAcceptedRefs',
    'automationBarrierRefs',
    'backgroundEvidenceRefs',
  ]) {
    assertNonEmptyHostOwnedRefArray(dogfoodRefs[field], `${options.gateName}.dogfoodRefs.${field}`);
  }
  assertNoFixtureEvidenceStrings(manifest, options.gateName);
  assertCurrentRunEvidenceConsistency(dogfoodRefs, currentRunRefs, options.gateName);

  const userAcceptanceInput = recordObject(manifest.userAcceptanceInput, `${options.gateName}.userAcceptanceInput`);
  const evidenceClaims = recordArray(userAcceptanceInput.evidenceClaims, `${options.gateName}.userAcceptanceInput.evidenceClaims`);
  const realClaim = evidenceClaims.find((claim) => claim.kind === 'real-virtual-app-screen');
  assert.ok(realClaim, `${options.gateName}: userAcceptanceInput must include a real-virtual-app-screen claim.`);
  assert.equal(realClaim.status, 'present', `${options.gateName}: real-virtual-app-screen claim status must be present.`);
  assert.equal(realClaim.diagnosticOnly, false, `${options.gateName}: real-virtual-app-screen claim diagnosticOnly must be false.`);
  assertHostOwnedRef(realClaim.realHostProviderSessionRef, `${options.gateName}.claim.realHostProviderSessionRef`);
  assertHostOwnedRef(realClaim.realOptInRunRef, `${options.gateName}.claim.realOptInRunRef`);
  assertNonEmptyHostOwnedRefArray(realClaim.realPlatformEvidenceRefs, `${options.gateName}.claim.realPlatformEvidenceRefs`);
  if (Object.prototype.hasOwnProperty.call(realClaim, 'currentRunPointerRef')) {
    const claimCurrentRunPointerRef = assertHostOwnedRef(realClaim.currentRunPointerRef, `${options.gateName}.claim.currentRunPointerRef`);
    assert.equal(
      claimCurrentRunPointerRef,
      currentRunRefs.currentRunPointerRef,
      `${options.gateName}: claim.currentRunPointerRef must match dogfoodRefs.currentRunPointerRef.`,
    );
  }

  return manifestPath;
}

function buildHandoffSummary(
  config: HandoffTargetConfig,
  manifestPath: string,
  sequencingStatus: VirtualAppScreenRealHostEvidenceManifestHandoffGateSummary['sequencingStatus'],
  issues: string[],
): VirtualAppScreenRealHostEvidenceManifestHandoffGateSummary {
  const manifestPathOrPlaceholder = manifestPath || `<path-to-passed-${config.expectedPlatformProviders[0]}-manifest.json>`;
  const exportEnvCommandsByShell = {
    posix: `export ${config.manifestEnv}=${shellQuote(manifestPathOrPlaceholder)}`,
    powershell: `$env:${config.manifestEnv}=${powershellQuote(manifestPathOrPlaceholder)}`,
    cmd: `set "${config.manifestEnv}=${manifestPathOrPlaceholder}"`,
  };
  const handoffCommandsByShell = {
    posix: config.handoffCommandScripts.map((script) => handoffCommandForShell(config, script, manifestPathOrPlaceholder, 'posix')),
    powershell: config.handoffCommandScripts.map((script) => handoffCommandForShell(config, script, manifestPathOrPlaceholder, 'powershell')),
    cmd: config.handoffCommandScripts.map((script) => handoffCommandForShell(config, script, manifestPathOrPlaceholder, 'cmd')),
  };
  return {
    status: issues.length ? 'failed' : 'passed',
    target: config.target,
    gateName: config.gateName,
    manifestEnv: config.manifestEnv,
    expectedPlatformProviders: [...config.expectedPlatformProviders],
    manifestPath: manifestPath || null,
    passClaim: false,
    sequencingStatus,
    exportEnvCommand: exportEnvCommandsByShell.posix,
    handoffCommands: handoffCommandsByShell.posix,
    exportEnvCommandsByShell,
    handoffCommandsByShell,
    issues,
  };
}

function handoffCommandForShell(
  config: HandoffTargetConfig,
  script: string,
  manifestPath: string,
  shell: keyof VirtualAppScreenRealHostEvidenceManifestHandoffGateSummary['handoffCommandsByShell'],
): string {
  if (config.target === 'windows-after-linux') {
    const args = [
      '--linux-manifest',
      portableArgQuote(manifestPath),
    ];
    if (script.includes('real-human-input')) {
      args.push('--evidence-manifest', portableArgQuote(WINDOWS_REAL_HOST_SESSION_EVIDENCE_MANIFEST_PLACEHOLDER));
    }
    return `${script} -- ${args.join(' ')}`;
  }

  if (shell === 'powershell') return `${powershellExportCommand(config, manifestPath)}; ${script}`;
  if (shell === 'cmd') return `${cmdExportCommand(config, manifestPath)} && ${script}`;
  return `${config.manifestEnv}=${shellQuote(manifestPath)} ${script}`;
}

function powershellExportCommand(config: HandoffTargetConfig, manifestPath: string): string {
  return `$env:${config.manifestEnv}=${powershellQuote(manifestPath)}`;
}

function cmdExportCommand(config: HandoffTargetConfig, manifestPath: string): string {
  return `set "${config.manifestEnv}=${manifestPath}"`;
}

function handoffTargetConfig(target: VirtualAppScreenRealHostHandoffTarget): HandoffTargetConfig {
  const config = HANDOFF_TARGETS[target];
  if (!config) throw new Error(`Unknown VirtualAppScreen real Host handoff target: ${target}`);
  return config;
}

function assertAllowedPlatform(value: unknown, options: RealHostSessionEvidenceManifestGateOptions): void {
  const platformProvider = requiredString(value, `${options.gateName}.platformProvider`);
  const allowed = options.expectedPlatformProviders.map((platform) => platform.trim()).filter(Boolean);
  assert.ok(allowed.length > 0, `${options.gateName}: expectedPlatformProviders must not be empty.`);
  assert.ok(
    allowed.includes(platformProvider),
    `${options.gateName}: platformProvider must be ${formatPlatformList(allowed)}.`,
  );
}

function assertCurrentRunHostRefs(dogfoodRefs: Record<string, unknown>, gateName: string): {
  currentRunPointerRef: string;
  evidenceLedgerRef: string;
} {
  const currentRunPointerRef = dogfoodRefs.currentRunPointerRef;
  const evidenceLedgerRef = dogfoodRefs.evidenceLedgerRef;
  if (typeof currentRunPointerRef !== 'string' || !currentRunPointerRef.trim()
    || typeof evidenceLedgerRef !== 'string' || !evidenceLedgerRef.trim()) {
    assert.fail(`${gateName}: current-run Host refs are required.`);
  }
  return {
    currentRunPointerRef: assertHostOwnedRef(currentRunPointerRef, `${gateName}.dogfoodRefs.currentRunPointerRef`),
    evidenceLedgerRef: assertHostOwnedRef(evidenceLedgerRef, `${gateName}.dogfoodRefs.evidenceLedgerRef`),
  };
}

function assertCurrentRunEvidenceConsistency(
  dogfoodRefs: Record<string, unknown>,
  refs: {
    currentRunPointerRef: string;
    evidenceLedgerRef: string;
  },
  gateName: string,
): void {
  const platformRefs = stringArray(dogfoodRefs.realPlatformEvidenceRefs, `${gateName}.dogfoodRefs.realPlatformEvidenceRefs`);
  assert.ok(
    platformRefs.includes(refs.evidenceLedgerRef),
    `${gateName}: dogfoodRefs.realPlatformEvidenceRefs must include dogfoodRefs.evidenceLedgerRef.`,
  );

  const replayRefs = stringArray(dogfoodRefs.minimalEvidenceReplayRefs, `${gateName}.dogfoodRefs.minimalEvidenceReplayRefs`);
  const ledgerEventPrefix = `${refs.evidenceLedgerRef}/events/`;
  for (const [index, replayRef] of replayRefs.entries()) {
    assert.ok(
      replayRef.startsWith(ledgerEventPrefix),
      `${gateName}: dogfoodRefs.minimalEvidenceReplayRefs[${index}] must be scoped to dogfoodRefs.evidenceLedgerRef events.`,
    );
  }
}

function assertHostOwnedRef(value: unknown, label: string): string {
  const ref = requiredString(value, label);
  assert.match(ref, /^computer-use:native-host\//u, `${label} must be Host-owned.`);
  return ref;
}

function assertNonEmptyHostOwnedRefArray(value: unknown, label: string): void {
  const refs = stringArray(value, label);
  assert.ok(refs.length > 0, `${label} must be a non-empty array.`);
  for (const [index, ref] of refs.entries()) {
    assertHostOwnedRef(ref, `${label}[${index}]`);
  }
}

function assertNoFixtureEvidenceStrings(value: unknown, gateName: string): void {
  for (const ref of stringValues(value)) {
    assert.doesNotMatch(
      ref,
      /(?:^|[:/.-])(?:fixture|fixtures|mock|mocks|snapshot|snapshot-fixture|replay-fixture)(?:[:/.-]|$)/iu,
      `${gateName}: must not reference fixture evidence: ${ref}`,
    );
  }
}

function recordObject(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function recordArray(value: unknown, label: string): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(value), `${label} must be a JSON array.`);
  return value.map((item, index) => recordObject(item, `${label}[${index}]`));
}

function stringArray(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} must be a JSON string array.`);
  assert.ok(value.every((item) => typeof item === 'string' && Boolean(item.trim())), `${label} must be a JSON string array.`);
  return value.map((item) => (item as string).trim());
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredString(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `${label} is required.`);
  const ref = value as string;
  assert.ok(ref.trim(), `${label} is required.`);
  return ref.trim();
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => stringValues(item));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => stringValues(item));
  }
  return [];
}

function formatPlatformList(platforms: string[]): string {
  return platforms.length === 1 ? platforms[0] as string : platforms.join(' or ');
}

function shortError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function portableArgQuote(value: string): string {
  return `"${value.replace(/"/gu, '\\"')}"`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runVirtualAppScreenRealHostEvidenceManifestHandoffGate({
    target: options.target,
    manifestPath: options.manifestPath,
    env: process.env,
  });

  if (summary.status !== 'passed') {
    process.stderr.write([
      `[failed] VirtualAppScreen real Host handoff gate target=${summary.target}`,
      `manifestEnv=${summary.manifestEnv}`,
      'passClaim=false',
      `issues=${summary.issues.join('; ')}`,
    ].join(' ') + '\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write([
    `[sequencing-ready] VirtualAppScreen real Host handoff gate target=${summary.target}`,
    `sequencingStatus=${summary.sequencingStatus}`,
    `manifest=${summary.manifestPath}`,
    'passClaim=false',
    `export=${summary.exportEnvCommand}`,
    `commands=${summary.handoffCommands.join(' && ')}`,
    `powershellCommands=${summary.handoffCommandsByShell.powershell.join(' ; ')}`,
    `cmdCommands=${summary.handoffCommandsByShell.cmd.join(' && ')}`,
  ].join(' ') + '\n');
}

function parseArgs(argv: string[]): {
  target: VirtualAppScreenRealHostHandoffTarget;
  manifestPath?: string;
} {
  let target: VirtualAppScreenRealHostHandoffTarget | undefined;
  let manifestPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') {
      const value = argv[index + 1] as VirtualAppScreenRealHostHandoffTarget | undefined;
      if (!value || !(value in HANDOFF_TARGETS)) throw new Error(`Unknown --target: ${value ?? ''}`);
      target = value;
      index += 1;
      continue;
    }
    if (arg === '--manifest') {
      manifestPath = argv[index + 1];
      if (!manifestPath) throw new Error('--manifest requires a path.');
      index += 1;
      continue;
    }
    throw new Error(`Unknown VirtualAppScreen real Host handoff gate argument: ${arg}`);
  }
  if (!target) throw new Error('--target is required.');
  return { target, manifestPath };
}

const isCli = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isCli) {
  await main();
}
