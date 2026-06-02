import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ContractSmokeNativeHostPlatformAdapter,
  FailClosedNativeHostPlatformAdapter,
  InMemoryNativeVirtualAppScreenHost,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL,
  NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION,
  sha256,
  validateNativeHostEvidenceLedger,
  type NativeHostEvidenceLedger,
  type NativeHostMaybePromise,
  type NativeHostResult,
  type NativeHostSession,
} from '../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

export type NativeVirtualAppScreenHostValidationProfile =
  | 'all'
  | 'manifest-api'
  | 'viewer'
  | 'fixtures'
  | 'provider-readiness'
  | 'user-acceptance';

export interface NativeVirtualAppScreenHostValidationSummary {
  profile: NativeVirtualAppScreenHostValidationProfile;
  status: 'passed' | 'failed';
  checks: string[];
  issues: string[];
}

type HostManifest = {
  schemaVersion?: string;
  packageName?: string;
  owner?: string;
  role?: string;
  productTruthOwner?: boolean;
  publicApi?: string[];
  refsFirst?: boolean;
  failClosed?: boolean;
  singleTruthSource?: Record<string, unknown>;
  thirdPartyToolsRole?: string;
  forbiddenTruthSources?: string[];
};

type OwnershipMap = {
  entries?: Array<{
    id?: string;
    owner?: string;
    targetImplementationPaths?: string[];
    forbiddenOwners?: string[];
    migrationNote?: string;
  }>;
};

const criticalProductApi = [
  'describe',
  'probe',
  'createSession',
  'launchOrAttachApp',
  'attachSurface',
  'presentSurface',
  'readFrame',
  'sendHumanInput',
  'executeAutomationIntent',
  'recordPermissionHandoff',
  'recordPermissionRecheck',
  'pauseAgent',
  'resumeAgent',
  'closeSession',
  'validateGrant',
] as const;

type CheckName =
  | 'manifest-api'
  | 'ownership-map'
  | 'provider-readiness'
  | 'contract-ledger'
  | 'permission-ledger'
  | 'ui-only-negative'
  | 'fixture-only-negative'
  | 'missing-frame-negative'
  | 'unverified-grant-negative';

const checkProfiles: Record<NativeVirtualAppScreenHostValidationProfile, CheckName[]> = {
  all: [
    'manifest-api',
    'ownership-map',
    'provider-readiness',
    'contract-ledger',
    'permission-ledger',
    'ui-only-negative',
    'fixture-only-negative',
    'missing-frame-negative',
    'unverified-grant-negative',
  ],
  'manifest-api': ['manifest-api', 'ownership-map'],
  viewer: ['manifest-api', 'ownership-map', 'contract-ledger', 'permission-ledger', 'ui-only-negative', 'missing-frame-negative', 'unverified-grant-negative'],
  fixtures: ['manifest-api', 'fixture-only-negative'],
  'provider-readiness': ['manifest-api', 'provider-readiness', 'contract-ledger', 'permission-ledger'],
  'user-acceptance': ['manifest-api', 'contract-ledger', 'permission-ledger', 'ui-only-negative', 'fixture-only-negative', 'missing-frame-negative', 'unverified-grant-negative'],
};

export async function runNativeVirtualAppScreenHostValidation(
  profile: NativeVirtualAppScreenHostValidationProfile = 'all',
): Promise<NativeVirtualAppScreenHostValidationSummary> {
  const checks: string[] = [];
  const issues: string[] = [];

  for (const checkName of checkProfiles[profile]) {
    try {
      await runCheck(checkName);
      checks.push(checkName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${checkName}: ${message}`);
    }
  }

  return {
    profile,
    status: issues.length ? 'failed' : 'passed',
    checks,
    issues,
  };
}

async function runCheck(checkName: CheckName): Promise<void> {
  if (checkName === 'manifest-api') return assertNativeHostManifestAndApi();
  if (checkName === 'ownership-map') return assertNativeHostOwnershipMap();
  if (checkName === 'provider-readiness') return assertProviderReadiness();
  if (checkName === 'contract-ledger') return assertContractLedgerPasses();
  if (checkName === 'permission-ledger') return assertPermissionLedgerPasses();
  if (checkName === 'ui-only-negative') return assertUiOnlyLedgerRejected();
  if (checkName === 'fixture-only-negative') return assertFixtureOnlyLedgerRejected();
  if (checkName === 'missing-frame-negative') return assertMissingFrameLedgerRejected();
  if (checkName === 'unverified-grant-negative') return assertUnverifiedGrantLedgerRejected();
  assert.fail(`Unknown Native Host validation check: ${checkName}`);
}

async function assertNativeHostManifestAndApi(): Promise<void> {
  const manifest = JSON.parse(await readFile(resolve('packages/actions/computer-use/virtual-app-screen-host/capability.manifest.json'), 'utf8')) as HostManifest;
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const description = host.describe();

  assert.equal(manifest.schemaVersion, 'sciforge.computer-use.native-virtual-app-screen-host.manifest.v1');
  assert.equal(manifest.packageName, 'packages/actions/computer-use/virtual-app-screen-host');
  assert.equal(manifest.productTruthOwner, true);
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.failClosed, true);
  assert.ok(Array.isArray(manifest.publicApi), 'manifest publicApi must be an array');
  const protocol = new Set<string>(NATIVE_VIRTUAL_APP_SCREEN_HOST_PROTOCOL);
  const describedProtocol = new Set<string>(description.protocol);
  const hostRecord = host as unknown as Record<string, unknown>;
  for (const methodName of manifest.publicApi) {
    assert.ok(protocol.has(methodName), `manifest publicApi method ${methodName} must be in the host protocol`);
    assert.ok(describedProtocol.has(methodName), `manifest publicApi method ${methodName} must be described by the host`);
    assert.equal(typeof hostRecord[methodName], 'function', `manifest publicApi method ${methodName} must exist on the host`);
  }
  for (const methodName of criticalProductApi) {
    assert.ok(manifest.publicApi.includes(methodName), `manifest publicApi must include ${methodName}`);
    assert.equal(typeof hostRecord[methodName], 'function', `critical host API method ${methodName} must exist`);
  }
  assert.equal(description.schemaVersion, NATIVE_VIRTUAL_APP_SCREEN_HOST_SCHEMA_VERSION);
  assert.equal(description.thirdPartyToolsRole, 'adapter-diagnostic-or-fallback-only');
  assert.equal(manifest.thirdPartyToolsRole, 'adapter-diagnostic-or-fallback-only');
  assert.equal(manifest.singleTruthSource?.session, 'host-owned');
  assert.equal(manifest.singleTruthSource?.surface, 'host-owned');
  assert.equal(manifest.singleTruthSource?.frame, 'host-owned');
  assert.equal(manifest.singleTruthSource?.permission, 'host-owned-readiness');
  assert.equal(manifest.singleTruthSource?.grant, 'host-issued');
  assert.equal(manifest.singleTruthSource?.ledger, 'host-owned');
  assert.ok(manifest.forbiddenTruthSources?.includes('ui-owned-live-screen'));
  assert.ok(manifest.forbiddenTruthSources?.includes('fixture-owned-live-screen'));
  assert.ok(manifest.forbiddenTruthSources?.includes('replay-owned-live-screen'));
}

async function assertNativeHostOwnershipMap(): Promise<void> {
  const ownership = JSON.parse(await readFile(resolve('docs/native-extension-ownership-map.json'), 'utf8')) as OwnershipMap;
  const entry = ownership.entries?.find((candidate) => candidate.id === 'virtual-app-screen-native-host');
  assert.ok(entry, 'ownership map must include virtual-app-screen-native-host');
  assert.match(String(entry.owner), /native-host-control-plane/);
  assert.ok(entry.targetImplementationPaths?.includes('packages/actions/computer-use/virtual-app-screen-host'));
  assert.match(JSON.stringify(entry.forbiddenOwners), /GUI-owned live surface replacement/);
  assert.match(JSON.stringify(entry.forbiddenOwners), /snapshot\/replay second interactive truth/);
  assert.match(JSON.stringify(entry.forbiddenOwners), /third-party virtual screen UI as product truth/);
  assert.match(String(entry.migrationNote), /host grants/);
  assert.match(String(entry.migrationNote), /host-owned evidence writing/);
}

function assertProviderReadiness(): void {
  const failClosedHost = new InMemoryNativeVirtualAppScreenHost(new FailClosedNativeHostPlatformAdapter());
  const blockedReadiness = failClosedHost.probe();
  assert.equal(blockedReadiness.status, 'blocked');
  assert.equal(blockedReadiness.diagnosticOnly, true);
  assert.equal(blockedReadiness.capabilities.writeEvidenceLedger, true);
  assert.equal(blockedReadiness.capabilities.validateGrant, true);
  assert.equal(blockedReadiness.capabilities.sharedSystemInputUsed, false);
  assert.match(String(blockedReadiness.blockedReason), /No Native VirtualAppScreen platform adapter/);
  const blockedSession = failClosedHost.createSession(
    { profileId: 'contract-blocked' },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:native-host/runs/contract-blocked/current-run.json',
      evidenceRootRef: 'computer-use:native-host/runs/contract-blocked',
    },
  );
  assert.equal(blockedSession.status, 'blocked');
  if (blockedSession.status === 'blocked') {
    assert.equal(blockedSession.error.code, 'provider-unavailable');
  }

  const readyHost = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const ready = readyHost.probe();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.capabilities.captureFrame, true);
  assert.equal(ready.capabilities.sendHumanInput, true);
  assert.equal(ready.capabilities.executeAutomationIntent, true);
  assert.equal(ready.capabilities.sharedSystemInputUsed, false);
  assert.ok(ready.providerRefs.length > 0);
  assert.ok(ready.driverRefs.length > 0);
}

function assertContractLedgerPasses(): void {
  const { ledger } = buildNativeHostContractRun();
  const validation = validateNativeHostEvidenceLedger(ledger, {
    requireFrame: true,
    requireHumanInput: true,
    requireAutomationBarrier: true,
    requireGrantValidation: true,
  });
  assert.equal(validation.ok, true, validation.issues.join('\n'));
}

function assertPermissionLedgerPasses(): void {
  const { host, session } = buildNativeHostContractRun();
  const handoff = mustOk(host.recordPermissionHandoff(session.sessionId, {
    permissionHandoffRef: 'computer-use:native-host/runs/contract-smoke/permissions/handoff.json',
    recheckRef: 'computer-use:native-host/runs/contract-smoke/permissions/recheck.json',
    permissionRef: 'permission:macos/accessibility',
    platformDriverRef: 'computer-use:native-host/platform-drivers/contract-smoke-driver.json',
  }), 'recordPermissionHandoff');
  const recheck = mustOk(host.recordPermissionRecheck(session.sessionId, {
    permissionHandoffRef: 'computer-use:native-host/runs/contract-smoke/permissions/handoff.json',
    recheckRef: 'computer-use:native-host/runs/contract-smoke/permissions/recheck.json',
    permissionRef: 'permission:macos/accessibility',
    platformDriverRef: 'computer-use:native-host/platform-drivers/contract-smoke-driver.json',
  }), 'recordPermissionRecheck');
  assert.equal(handoff.type, 'permission.handoff');
  assert.equal(recheck.type, 'permission.recheck');
  const ledger = host.getLedger(session.sessionId);
  assert.ok(ledger, 'expected host ledger after permission records');
  const validation = validateNativeHostEvidenceLedger(ledger, {
    requirePermissionHandoff: true,
    requirePermissionRecheck: true,
  });
  assert.equal(validation.ok, true, validation.issues.join('\n'));

  const missingPermission = cloneLedger(ledger);
  missingPermission.entries = missingPermission.entries
    .filter((entry) => entry.type !== 'permission.handoff' && entry.type !== 'permission.recheck');
  rehashLedger(missingPermission);
  const missingValidation = validateNativeHostEvidenceLedger(missingPermission, {
    requirePermissionHandoff: true,
    requirePermissionRecheck: true,
  });
  assert.equal(missingValidation.ok, false);
  assert.ok(missingValidation.issues.includes('permission.handoff entry is required.'), missingValidation.issues.join('\n'));
  assert.ok(missingValidation.issues.includes('permission.recheck entry is required.'), missingValidation.issues.join('\n'));
}

function assertUiOnlyLedgerRejected(): void {
  const { ledger } = buildNativeHostContractRun();
  const polluted = cloneLedger(ledger);
  const frameEntry = polluted.entries.find((entry) => entry.type === 'frame.read');
  assert.ok(frameEntry, 'expected a frame.read entry');
  frameEntry.refs.frameRef = 'ui:screen-pane/current-frame.png';
  rehashLedger(polluted);

  const validation = validateNativeHostEvidenceLedger(polluted, { requireFrame: true });
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((issue) => issue.includes('UI-owned') && issue.includes('frameRef')),
    validation.issues.join('\n'),
  );
}

function assertFixtureOnlyLedgerRejected(): void {
  const { ledger } = buildNativeHostContractRun();
  const polluted = cloneLedger(ledger);
  const surfaceEntry = polluted.entries.find((entry) => entry.type === 'surface.attached');
  assert.ok(surfaceEntry, 'expected a surface.attached entry');
  surfaceEntry.refs.liveSurfaceRef = 'fixture:virtual-app-screen/live-surface.json';
  rehashLedger(polluted);

  const validation = validateNativeHostEvidenceLedger(polluted, { requireFrame: true });
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((issue) => issue.includes('fixture-owned') && issue.includes('liveSurfaceRef')),
    validation.issues.join('\n'),
  );
}

function assertMissingFrameLedgerRejected(): void {
  const { ledger } = buildNativeHostContractRun();
  const missingFrame = cloneLedger(ledger);
  missingFrame.entries = missingFrame.entries
    .filter((entry) => entry.type !== 'frame.read')
    .map((entry) => ({
      ...entry,
      refs: {
        ...entry.refs,
        frameRef: undefined,
        beforeFrameRef: undefined,
        afterFrameRef: undefined,
      },
    }));
  rehashLedger(missingFrame);

  const validation = validateNativeHostEvidenceLedger(missingFrame, {
    requireFrame: true,
    requireHumanInput: true,
    requireAutomationBarrier: true,
    requireGrantValidation: true,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes('frame.read entry is required.'), validation.issues.join('\n'));
  assert.ok(validation.issues.includes('latest frame ref is missing.'), validation.issues.join('\n'));
}

function assertUnverifiedGrantLedgerRejected(): void {
  const { host, session, surface, ledger } = buildNativeHostContractRun({ presentSurface: false });
  const grantValidation = host.validateGrant(surface.liveBindingAttachGrantRef);
  assert.equal(grantValidation.ok, true, grantValidation.issues.join('\n'));
  assert.equal(grantValidation.validationLedgerEntryRef, undefined);

  const validation = validateNativeHostEvidenceLedger(ledger, {
    requireFrame: true,
    requireHumanInput: true,
    requireAutomationBarrier: true,
    requireGrantValidation: true,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes('grant.validated entry is required.'), validation.issues.join('\n'));
  assert.equal(session.status, 'surface-attached');
}

export interface NativeHostContractRun {
  host: InMemoryNativeVirtualAppScreenHost;
  session: NativeHostSession;
  surface: {
    liveBindingAttachGrantRef: string;
    liveSurfaceRef: string;
    targetWindowRef: string;
  };
  ledger: NativeHostEvidenceLedger;
}

export function buildNativeHostContractRun(options: { presentSurface?: boolean } = {}): NativeHostContractRun {
  const host = new InMemoryNativeVirtualAppScreenHost(new ContractSmokeNativeHostPlatformAdapter());
  const created = mustOk(host.createSession(
    {
      profileId: 'native-host-contract-smoke',
      defaultSurfaceTransport: 'native-frame-stream',
    },
    { allowBackgroundRendering: true, allowSharedSystemInput: false },
    {
      currentRunRef: 'computer-use:native-host/runs/contract-smoke/current-run.json',
      evidenceRootRef: 'computer-use:native-host/runs/contract-smoke',
      guiPresentRef: 'computer-use:native-host/runs/contract-smoke/gui-present/screen-pane.json',
    },
  ), 'createSession');
  const launched = mustOk(host.launchOrAttachApp(created.sessionId, {
    appId: 'contract-smoke',
    appRef: 'app:contract-smoke',
    title: 'Native Host Contract Smoke',
    workspaceRef: 'workspace:contract-smoke',
  }), 'launchOrAttachApp');
  const surface = mustOk(host.attachSurface(launched.sessionId, {
    screenRef: 'computer-use:native-host/screen/contract-smoke.json',
    targetWindowRef: 'window:contract-smoke/main',
    transport: 'native-frame-stream',
  }), 'attachSurface');

  if (options.presentSurface !== false) {
    mustOk(host.presentSurface(launched.sessionId, surface.liveBindingAttachGrantRef), 'presentSurface');
  }

  const beforeFrame = mustOk(host.readFrame(launched.sessionId, 'before-input'), 'readFrame before input');
  mustOk(host.sendHumanInput(launched.sessionId, {
    kind: 'click',
    screenRef: surface.screenRef,
    targetWindowRef: surface.targetWindowRef,
    xRatio: 0.5,
    yRatio: 0.5,
    inputIntentRef: 'computer-use:native-host/runs/contract-smoke/input-intents/click.json',
  }), 'sendHumanInput');
  mustOk(host.executeAutomationIntent(
    launched.sessionId,
    {
      intentRef: 'computer-use:native-host/runs/contract-smoke/automation/focus-editor.json',
      kind: 'focus-editor',
      targetWindowRef: surface.targetWindowRef,
      beforeFrameRef: beforeFrame.frameRef,
      verifierRef: 'computer-use:native-host/runs/contract-smoke/verifiers/focus-editor.json',
    },
    {
      barrierRef: 'computer-use:native-host/runs/contract-smoke/automation/barrier.json',
      currentRunRef: launched.evidenceContext.currentRunRef,
      requiredReadinessRef: launched.readiness.adapterReadinessRef,
    },
  ), 'executeAutomationIntent');
  const ledger = host.getLedger(launched.sessionId);
  assert.ok(ledger, 'expected host ledger');
  return {
    host,
    session: launched,
    surface,
    ledger: cloneLedger(ledger),
  };
}

function mustOk<T>(result: NativeHostMaybePromise<NativeHostResult<T>>, label: string): T {
  if (isPromiseLike(result)) throw new Error(`${label} unexpectedly returned async Native Host result.`);
  if (result.status === 'ok') return result.value;
  throw new Error(`${label} blocked: ${result.error.code}: ${result.error.message}`);
}

function isPromiseLike<T>(value: NativeHostMaybePromise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as { then?: unknown }).then === 'function');
}

function cloneLedger(ledger: NativeHostEvidenceLedger): NativeHostEvidenceLedger {
  return structuredClone(ledger) as NativeHostEvidenceLedger;
}

function rehashLedger(ledger: NativeHostEvidenceLedger): NativeHostEvidenceLedger {
  let previousSha256: string | undefined;
  ledger.entries = ledger.entries.map((entry, index) => {
    const next = {
      ...entry,
      sequence: index + 1,
      previousSha256,
    };
    next.sha256 = sha256({
      schemaVersion: next.schemaVersion,
      type: next.type,
      sequence: next.sequence,
      eventRef: next.eventRef,
      sessionId: next.sessionId,
      currentRunRef: next.currentRunRef,
      recordedAt: next.recordedAt,
      refs: next.refs,
      previousSha256: next.previousSha256,
      source: next.source,
      diagnosticOnly: next.diagnosticOnly,
    });
    previousSha256 = next.sha256;
    return next;
  });
  ledger.headSha256 = previousSha256;
  return ledger;
}

function parseProfile(argv: string[]): NativeVirtualAppScreenHostValidationProfile {
  let profile: NativeVirtualAppScreenHostValidationProfile = 'all';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      const value = argv[index + 1] as NativeVirtualAppScreenHostValidationProfile | undefined;
      if (!value || !(value in checkProfiles)) throw new Error(`Unknown Native Host validation profile: ${value ?? ''}`);
      profile = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown Native Host validation argument: ${arg}`);
  }
  return profile;
}

async function main(): Promise<void> {
  const profile = parseProfile(process.argv.slice(2));
  const summary = await runNativeVirtualAppScreenHostValidation(profile);
  const prefix = summary.status === 'passed' ? '[passed]' : '[failed]';
  process.stdout.write(`${prefix} Native VirtualAppScreen Host validation profile=${summary.profile} checks=${summary.checks.join(',')}\n`);
  if (summary.issues.length) {
    process.stderr.write(`${summary.issues.join('\n')}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
