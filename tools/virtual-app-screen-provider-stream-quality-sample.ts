import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_SAMPLE_MANIFEST_SCHEMA,
  type VirtualAppScreenProviderStreamQualityField,
} from './check-virtual-app-screen-provider-stream-quality-contract.js';

export interface VirtualAppScreenProviderStreamQualitySamples {
  frameReadLatencyMs: number[];
  frameIntervalsMs: number[];
  inputToFrameMs: number[];
  reconnectMs: number[];
  fallbackRequired: boolean;
}

export interface VirtualAppScreenProviderStreamQualitySampleManifest {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_SAMPLE_MANIFEST_SCHEMA;
  owner: 'VirtualDisplayProvider';
  hostSurfaceOwner: 'NativeVirtualAppScreenHost';
  refsFirst: true;
  artifactPayloadMode: 'bounded-summary-refs-only';
  providerRootRef: string;
  currentRunPointerRef: string;
  currentRunLedgerRef: string;
  frameTransportContractRef: string;
  frameTelemetryRef: string;
  providerStreamQualityRef: string;
  inputToFrameCausalityRef: string;
  reconnectProbeRef: string;
  boundedMetricSummaryRef: string;
  fallbackDecisionRef: string;
  fallbackReasonRef: string;
  metrics: Record<VirtualAppScreenProviderStreamQualityField, number | boolean>;
}

export interface BuildVirtualAppScreenProviderStreamQualitySampleManifestInput {
  realHostSessionManifest: unknown;
  providerRootRef: string;
  samples: VirtualAppScreenProviderStreamQualitySamples;
}

export function defaultVirtualAppScreenProviderStreamQualitySampleManifestPath(runId: string): string {
  return join('docs', 'test-artifacts', 'virtual-app-screen-provider-stream-quality', safeSegment(runId), 'sample-manifest.json');
}

export async function writeVirtualAppScreenProviderStreamQualitySampleManifest(
  manifestPath: string,
  input: BuildVirtualAppScreenProviderStreamQualitySampleManifestInput,
): Promise<VirtualAppScreenProviderStreamQualitySampleManifest> {
  const manifest = buildVirtualAppScreenProviderStreamQualitySampleManifest(input);
  const outDir = dirname(manifestPath);
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJson(join(outDir, 'frame-transport-contract.json'), providerSidecar(manifest, 'frame-transport-contract')),
    writeJson(join(outDir, 'frame-telemetry-summary.json'), providerSidecar(manifest, 'frame-telemetry-summary')),
    writeJson(join(outDir, 'stream-quality.json'), providerSidecar(manifest, 'stream-quality')),
    writeJson(join(outDir, 'input-to-frame-causality.json'), providerSidecar(manifest, 'input-to-frame-causality')),
    writeJson(join(outDir, 'reconnect-probe.json'), providerSidecar(manifest, 'reconnect-probe')),
    writeJson(join(outDir, 'bounded-metric-summary.json'), providerSidecar(manifest, 'bounded-metric-summary')),
    writeJson(join(outDir, 'fallback-decision.json'), providerSidecar(manifest, 'fallback-decision')),
    writeJson(join(outDir, 'fallback-reason.json'), providerSidecar(manifest, 'fallback-reason')),
  ]);
  await writeJson(manifestPath, manifest);
  return manifest;
}

export function buildVirtualAppScreenProviderStreamQualitySampleManifest(
  input: BuildVirtualAppScreenProviderStreamQualitySampleManifestInput,
): VirtualAppScreenProviderStreamQualitySampleManifest {
  const host = parsePassedRealHostSessionManifest(input.realHostSessionManifest);
  const providerRootRef = requireProviderRootRef(input.providerRootRef);
  const samples = normalizedSamples(input.samples);
  const metrics = boundedMetrics(samples);
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_SAMPLE_MANIFEST_SCHEMA,
    owner: 'VirtualDisplayProvider',
    hostSurfaceOwner: 'NativeVirtualAppScreenHost',
    refsFirst: true,
    artifactPayloadMode: 'bounded-summary-refs-only',
    providerRootRef,
    currentRunPointerRef: host.currentRunPointerRef,
    currentRunLedgerRef: host.currentRunLedgerRef,
    frameTransportContractRef: providerRef(providerRootRef, 'frame-transport-contract.json'),
    frameTelemetryRef: providerRef(providerRootRef, 'frame-telemetry-summary.json'),
    providerStreamQualityRef: providerRef(providerRootRef, 'stream-quality.json'),
    inputToFrameCausalityRef: providerRef(providerRootRef, 'input-to-frame-causality.json'),
    reconnectProbeRef: providerRef(providerRootRef, 'reconnect-probe.json'),
    boundedMetricSummaryRef: providerRef(providerRootRef, 'bounded-metric-summary.json'),
    fallbackDecisionRef: providerRef(providerRootRef, 'fallback-decision.json'),
    fallbackReasonRef: providerRef(providerRootRef, 'fallback-reason.json'),
    metrics,
  };
}

function parsePassedRealHostSessionManifest(manifest: unknown): {
  currentRunPointerRef: string;
  currentRunLedgerRef: string;
} {
  const record = asRecord(manifest);
  const dogfoodRefs = asRecord(record.dogfoodRefs);
  const validation = asRecord(record.validation);
  if (
    record.schemaVersion !== 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1'
    || record.status !== 'passed'
    || record.diagnosticOnly !== false
    || record.refsFirst !== true
    || validation.ok !== true
  ) {
    throw new Error('VirtualAppScreen stream quality samples require a passed real Host session manifest.');
  }
  const currentRunPointerRef = requiredNativeHostRef(dogfoodRefs.currentRunPointerRef, 'currentRunPointerRef');
  const currentRunLedgerRef = requiredNativeHostRef(dogfoodRefs.evidenceLedgerRef, 'evidenceLedgerRef');
  if (!currentRunPointerRef.startsWith('computer-use:native-host/runs/')) {
    throw new Error('VirtualAppScreen stream quality samples require a Host current-run pointer ref.');
  }
  if (!currentRunLedgerRef.startsWith('computer-use:native-host/ledgers/')) {
    throw new Error('VirtualAppScreen stream quality samples require a Host evidence ledger ref.');
  }
  return {
    currentRunPointerRef,
    currentRunLedgerRef,
  };
}

function normalizedSamples(samples: VirtualAppScreenProviderStreamQualitySamples): VirtualAppScreenProviderStreamQualitySamples {
  return {
    frameReadLatencyMs: nonNegativeFiniteSamples(samples.frameReadLatencyMs, 'frameReadLatencyMs'),
    frameIntervalsMs: positiveFiniteSamples(samples.frameIntervalsMs, 'frameIntervalsMs'),
    inputToFrameMs: nonNegativeFiniteSamples(samples.inputToFrameMs, 'inputToFrameMs'),
    reconnectMs: nonNegativeFiniteSamples(samples.reconnectMs, 'reconnectMs'),
    fallbackRequired: samples.fallbackRequired === true,
  };
}

function boundedMetrics(samples: VirtualAppScreenProviderStreamQualitySamples): Record<VirtualAppScreenProviderStreamQualityField, number | boolean> {
  const frameRates = samples.frameIntervalsMs.map((value) => 1000 / value);
  return {
    latencyP50Ms: percentile(samples.frameReadLatencyMs, 50),
    latencyP95Ms: percentile(samples.frameReadLatencyMs, 95),
    framerateAvgFps: round(avg(frameRates)),
    framerateP5Fps: percentile(frameRates, 5),
    inputToFrameP50Ms: percentile(samples.inputToFrameMs, 50),
    inputToFrameP95Ms: percentile(samples.inputToFrameMs, 95),
    reconnectP50Ms: percentile(samples.reconnectMs, 50),
    reconnectP95Ms: percentile(samples.reconnectMs, 95),
    sampleCount: samples.frameReadLatencyMs.length,
    fallbackRequired: samples.fallbackRequired,
  };
}

function providerSidecar(
  manifest: VirtualAppScreenProviderStreamQualitySampleManifest,
  kind: string,
): Record<string, unknown> {
  return {
    schemaVersion: `sciforge.computer-use.virtual-app-screen-provider-stream-quality-${kind}.v1`,
    owner: manifest.owner,
    hostSurfaceOwner: manifest.hostSurfaceOwner,
    refsFirst: true,
    artifactPayloadMode: manifest.artifactPayloadMode,
    providerRootRef: manifest.providerRootRef,
    currentRunPointerRef: manifest.currentRunPointerRef,
    currentRunLedgerRef: manifest.currentRunLedgerRef,
    metrics: manifest.metrics,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function providerRef(root: string, leaf: string): string {
  return `${root.replace(/\/+$/u, '')}/${leaf}`;
}

function requireProviderRootRef(value: string): string {
  if (!value.startsWith('provider:')) {
    throw new Error('VirtualAppScreen stream quality providerRootRef must be provider-owned.');
  }
  return value.replace(/\/+$/u, '');
}

function requiredNativeHostRef(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || !value.startsWith('computer-use:native-host/')) {
    throw new Error(`VirtualAppScreen stream quality samples require Host-owned ${label}.`);
  }
  return value;
}

function nonNegativeFiniteSamples(values: number[], label: string): number[] {
  const samples = finiteSamples(values, label);
  if (samples.some((value) => value < 0)) {
    throw new Error(`${label} samples must be non-negative.`);
  }
  return samples;
}

function positiveFiniteSamples(values: number[], label: string): number[] {
  const samples = finiteSamples(values, label);
  if (samples.some((value) => value <= 0)) {
    throw new Error(`${label} samples must be positive.`);
  }
  return samples;
}

function finiteSamples(values: number[], label: string): number[] {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} samples must be a non-empty finite number array.`);
  }
  return values.map((value) => round(value));
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return round(sorted[index]!);
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function safeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'run';
}
