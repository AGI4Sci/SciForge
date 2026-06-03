import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS,
  VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_CONTRACT_SCHEMA,
  buildVirtualAppScreenProviderStreamQualityContract,
  validateVirtualAppScreenProviderStreamQualitySampleManifest,
  runVirtualAppScreenProviderStreamQualityContract,
} from '../../tools/check-virtual-app-screen-provider-stream-quality-contract.js';
import {
  buildVirtualAppScreenProviderStreamQualitySampleManifest,
  defaultVirtualAppScreenProviderStreamQualitySampleManifestPath,
  writeVirtualAppScreenProviderStreamQualitySampleManifest,
} from '../../tools/virtual-app-screen-provider-stream-quality-sample.js';

const execFileAsync = promisify(execFile);

test('VirtualAppScreen provider stream quality contract is provider-owned, refs-first, bounded, and no-real-run by default', () => {
  const contract = buildVirtualAppScreenProviderStreamQualityContract();

  assert.equal(contract.schemaVersion, VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_CONTRACT_SCHEMA);
  assert.equal(contract.owner, 'VirtualDisplayProvider');
  assert.equal(contract.hostSurfaceOwner, 'NativeVirtualAppScreenHost');
  assert.equal(contract.refsFirst, true);
  assert.equal(contract.artifactPayloadMode, 'bounded-summary-refs-only');
  assert.equal(contract.payloadPolicy.maxInlineEvidenceBytes, 0);
  assert.deepEqual(contract.payloadPolicy.forbiddenInlineEvidenceKinds, [
    'raw-frame-bytes',
    'base64-image',
    'video-chunk',
    'provider-payload',
    'input-log',
    'full-trace',
  ]);
  assert.deepEqual(
    contract.requiredMetricFields.map((field) => field.field),
    REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS,
  );
  assert.ok(contract.requiredMetricFields.every((field) => field.required));
  assert.ok(contract.requiredMetricFields.every((field) => field.source === 'provider-owned-bounded-summary-ref'));
  assert.ok(contract.requiredMetricFields.every((field) => field.inlineEvidence === 'forbidden'));
  assert.deepEqual(contract.requiredProviderRefs, [
    'frameTransportContractRef',
    'frameTelemetryRef',
    'providerStreamQualityRef',
    'inputToFrameCausalityRef',
    'reconnectProbeRef',
    'boundedMetricSummaryRef',
    'fallbackDecisionRef',
  ]);
  assert.deepEqual(contract.reusesVirtualDisplayConcepts, [
    'VirtualDisplayFrameTransportContract',
    'VirtualDisplayFrameTelemetrySummary',
    'VirtualDisplaySurfaceTransportDescriptor',
    'frameTransportReadiness',
  ]);
  assert.equal(contract.realRunStatus, 'pending-provider-samples');
  assert.equal(contract.realStreamRunClaim, false);
  assert.equal(contract.fallbackPolicy.whenFallbackRequiredTrue.status, 'fail-closed');
  assert.equal(contract.fallbackPolicy.whenFallbackRequiredTrue.userLevelLivePassAllowed, false);
  assert.deepEqual(contract.fallbackPolicy.whenFallbackRequiredTrue.allowedPresentationStates, [
    'fallback',
    'blocked',
    'handoff',
  ]);
});

test('VirtualAppScreen provider stream quality contract documentation includes required provider measurement gates', async () => {
  const summary = await runVirtualAppScreenProviderStreamQualityContract();

  assert.equal(summary.status, 'passed', summary.issues.join('\n'));
  assert.deepEqual(summary.metricFields, REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS);
  assert.deepEqual(summary.checks, [
    'section-present',
    'provider-owned-refs-first',
    'bounded-metric-fields',
    'virtual-display-telemetry-reuse',
    'fallback-required-fail-closed',
    'real-run-status-pending',
    'optional-sample-manifest',
  ]);
});

test('VirtualAppScreen provider stream quality contract CLI reports pending real stream run status', async () => {
  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/check-virtual-app-screen-provider-stream-quality-contract.ts',
  ]);

  assert.match(stdout, /^\[passed\] VirtualAppScreen provider stream quality contract/);
  assert.match(stdout, /realRunStatus=pending-provider-samples/);
  assert.match(stdout, /realStreamRunClaim=false/);
  for (const field of REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS) {
    assert.match(stdout, new RegExp(field));
  }
});

test('VirtualAppScreen provider stream quality sample manifest validates bounded actual provider metrics without claiming run completion', () => {
  const validation = validateVirtualAppScreenProviderStreamQualitySampleManifest(validSampleManifest());

  assert.equal(validation.status, 'passed', validation.issues.join('\n'));
  assert.equal(validation.sampleManifestStatus, 'provider-samples-validated');
  assert.equal(validation.realStreamRunClaim, false);
  assert.deepEqual(validation.metricFields, REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS);
  assert.deepEqual(validation.checks, [
    'sample-manifest-schema',
    'sample-manifest-provider-owned-refs',
    'sample-manifest-current-run-refs',
    'sample-manifest-bounded-metrics',
    'sample-manifest-fallback-policy',
  ]);
});

test('VirtualAppScreen provider stream quality sample manifest accepts Host-owned evidence ledger refs from real sessions', () => {
  const validation = validateVirtualAppScreenProviderStreamQualitySampleManifest({
    ...validSampleManifest(),
    currentRunLedgerRef: 'computer-use:native-host/ledgers/session-1/evidence-ledger.json',
  });

  assert.equal(validation.status, 'passed', validation.issues.join('\n'));
  assert.equal(validation.sampleManifestStatus, 'provider-samples-validated');
});

test('VirtualAppScreen provider stream quality sample manifest rejects missing provider-owned refs and raw payloads', () => {
  const manifest = {
    ...validSampleManifest(),
    providerStreamQualityRef: 'computer-use:native-host/runs/run-1/stream-quality.json',
    rawFrameBytes: 'base64-payload',
  };

  const validation = validateVirtualAppScreenProviderStreamQualitySampleManifest(manifest);

  assert.equal(validation.status, 'failed');
  assert.equal(validation.realStreamRunClaim, false);
  assert.match(validation.issues.join('\n'), /providerStreamQualityRef must be provider-owned/);
  assert.match(validation.issues.join('\n'), /rawFrameBytes is forbidden/);
});

test('VirtualAppScreen provider stream quality contract CLI validates optional sample manifest but keeps no-manifest default pending', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-provider-stream-quality-'));
  const manifestPath = join(workspace, 'sample-manifest.json');
  await writeFile(manifestPath, JSON.stringify(validSampleManifest(), null, 2));

  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/check-virtual-app-screen-provider-stream-quality-contract.ts',
    '--sample-manifest',
    manifestPath,
  ]);

  assert.match(stdout, /^\[passed\] VirtualAppScreen provider stream quality contract/);
  assert.match(stdout, /sampleManifestStatus=provider-samples-validated/);
  assert.match(stdout, /realStreamRunClaim=false/);
});

test('VirtualAppScreen provider stream quality sample builder derives provider-owned bounded refs from a passed real Host run', () => {
  const manifest = buildVirtualAppScreenProviderStreamQualitySampleManifest({
    realHostSessionManifest: validRealHostSessionManifest(),
    providerRootRef: 'provider:virtual-display/macos/stream-quality/run-1',
    samples: validStreamQualitySamples(),
  });

  assert.equal(manifest.owner, 'VirtualDisplayProvider');
  assert.equal(manifest.hostSurfaceOwner, 'NativeVirtualAppScreenHost');
  assert.equal(manifest.currentRunPointerRef, 'computer-use:native-host/runs/session-1/current-run-pointer.json');
  assert.equal(manifest.currentRunLedgerRef, 'computer-use:native-host/ledgers/session-1/evidence-ledger.json');
  assert.equal(manifest.frameTransportContractRef, `${manifest.providerRootRef}/frame-transport-contract.json`);
  assert.equal(manifest.frameTelemetryRef, `${manifest.providerRootRef}/frame-telemetry-summary.json`);
  assert.equal(manifest.metrics.latencyP50Ms, 18);
  assert.equal(manifest.metrics.latencyP95Ms, 40);
  assert.equal(manifest.metrics.inputToFrameP50Ms, 45);
  assert.equal(manifest.metrics.inputToFrameP95Ms, 80);
  assert.equal(manifest.metrics.reconnectP50Ms, 120);
  assert.equal(manifest.metrics.reconnectP95Ms, 180);
  assert.equal(manifest.metrics.sampleCount, 3);
  assert.equal(manifest.metrics.fallbackRequired, false);
  assert.equal(
    validateVirtualAppScreenProviderStreamQualitySampleManifest(manifest).status,
    'passed',
  );
});

test('VirtualAppScreen provider stream quality sample builder rejects non-real Host manifests', () => {
  assert.throws(
    () => buildVirtualAppScreenProviderStreamQualitySampleManifest({
      realHostSessionManifest: {
        ...validRealHostSessionManifest(),
        status: 'blocked',
      },
      providerRootRef: 'provider:virtual-display/macos/stream-quality/run-1',
      samples: validStreamQualitySamples(),
    }),
    /passed real Host session manifest/u,
  );
});

test('VirtualAppScreen provider stream quality sample writer persists manifest and provider sidecar summaries', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-provider-stream-quality-writer-'));
  const manifestPath = join(workspace, 'sample-manifest.json');

  const manifest = await writeVirtualAppScreenProviderStreamQualitySampleManifest(manifestPath, {
    realHostSessionManifest: validRealHostSessionManifest(),
    providerRootRef: 'provider:virtual-display/macos/stream-quality/run-1',
    samples: validStreamQualitySamples(),
  });

  const persisted = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.deepEqual(persisted, manifest);
  assert.equal(
    JSON.parse(await readFile(join(workspace, 'bounded-metric-summary.json'), 'utf8')).metrics.sampleCount,
    3,
  );
  assert.equal(
    JSON.parse(await readFile(join(workspace, 'input-to-frame-causality.json'), 'utf8')).currentRunPointerRef,
    manifest.currentRunPointerRef,
  );
});

test('VirtualAppScreen provider stream quality sample default path is a stable refs-first artifact path', () => {
  assert.equal(
    defaultVirtualAppScreenProviderStreamQualitySampleManifestPath('run/with spaces'),
    join('docs', 'test-artifacts', 'virtual-app-screen-provider-stream-quality', 'run-with-spaces', 'sample-manifest.json'),
  );
});

function validSampleManifest() {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-stream-quality-sample-manifest.v1',
    owner: 'VirtualDisplayProvider',
    hostSurfaceOwner: 'NativeVirtualAppScreenHost',
    refsFirst: true,
    artifactPayloadMode: 'bounded-summary-refs-only',
    providerRootRef: 'provider:virtual-display/macos/run-1',
    currentRunPointerRef: 'computer-use:native-host/runs/session-1/current-run-pointer.json',
    currentRunLedgerRef: 'computer-use:native-host/runs/session-1/ledger.json',
    frameTransportContractRef: 'provider:virtual-display/macos/run-1/frame-transport-contract.json',
    frameTelemetryRef: 'provider:virtual-display/macos/run-1/frame-telemetry-summary.json',
    providerStreamQualityRef: 'provider:virtual-display/macos/run-1/stream-quality.json',
    inputToFrameCausalityRef: 'provider:virtual-display/macos/run-1/input-to-frame-causality.json',
    reconnectProbeRef: 'provider:virtual-display/macos/run-1/reconnect-probe.json',
    boundedMetricSummaryRef: 'provider:virtual-display/macos/run-1/bounded-metric-summary.json',
    fallbackDecisionRef: 'provider:virtual-display/macos/run-1/fallback-decision.json',
    fallbackReasonRef: 'provider:virtual-display/macos/run-1/fallback-reason.json',
    metrics: {
      latencyP50Ms: 22,
      latencyP95Ms: 48,
      framerateAvgFps: 57.4,
      framerateP5Fps: 51.2,
      inputToFrameP50Ms: 39,
      inputToFrameP95Ms: 83,
      reconnectP50Ms: 142,
      reconnectP95Ms: 240,
      sampleCount: 120,
      fallbackRequired: false,
    },
  };
}

function validRealHostSessionManifest() {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1',
    status: 'passed',
    runId: 'run-1',
    platformProvider: 'macos',
    targetAppProfile: 'vscode-editor',
    diagnosticOnly: false,
    refsFirst: true,
    dogfoodRefs: {
      currentRunPointerRef: 'computer-use:native-host/runs/session-1/current-run-pointer.json',
      evidenceLedgerRef: 'computer-use:native-host/ledgers/session-1/evidence-ledger.json',
      frameStreamRef: 'computer-use:native-host/surfaces/surface-1/frame-stream.json',
      surfaceTransportRef: 'computer-use:native-host/surfaces/surface-1/surface-transport.json',
      currentFrameRef: 'computer-use:native-host/frames/surface-1/0001.png',
      beforeAfterFrameRefs: ['computer-use:native-host/input-runtime/session-1/before-after/click.json'],
      backgroundEvidenceRefs: [
        'computer-use:native-host/surfaces/surface-1/frame-transport-contract.json',
        'computer-use:native-host/surfaces/surface-1/frame-telemetry.json',
      ],
    },
    validation: {
      ok: true,
      missing: [],
    },
  };
}

function validStreamQualitySamples() {
  return {
    frameReadLatencyMs: [12, 18, 40],
    frameIntervalsMs: [16, 17, 20],
    inputToFrameMs: [45, 80],
    reconnectMs: [120, 180],
    fallbackRequired: false,
  };
}
