import type { RuntimeVerificationResult } from '../../contracts/runtime/verification-result.js';
import { capabilityManifest, providerAvailability } from './manifest.js';
import {
  createScientificReproductionVerifierProvider,
  type ScientificReproductionArtifact,
  type ScientificReproductionVerifierRequest,
} from './index.js';

export interface PackageRuntimeVerifierInput {
  goal?: string;
  request?: unknown;
  payload?: unknown;
  policy?: unknown;
  providerHints?: Record<string, unknown>;
}

export interface PackageRuntimeVerifierAdapter {
  id: string;
  acceptedVerifierIds: string[];
  verify(input: PackageRuntimeVerifierInput): Promise<RuntimeVerificationResult[]>;
}

const provider = createScientificReproductionVerifierProvider();

export const scientificReproductionRuntimeVerifier: PackageRuntimeVerifierAdapter = {
  id: provider.id,
  acceptedVerifierIds: [
    capabilityManifest.id,
    ...providerAvailability.map((entry) => entry.id),
    ...capabilityManifest.providers.map((entry) => entry.id),
  ],
  async verify(input) {
    const request = toScientificVerifierRequest(input);
    const result = await provider.verify(request);
    return [{
      id: result.verifierId,
      verdict: result.verdict,
      reward: result.reward,
      confidence: result.confidence,
      critique: result.critique,
      evidenceRefs: result.evidenceRefs,
      repairHints: result.repairHints,
      diagnostics: {
        schemaVersion: result.schemaVersion,
        verifierId: result.verifierId,
        criterionResults: result.criterionResults,
        diagnostics: result.diagnostics,
      },
    }];
  },
};

function toScientificVerifierRequest(input: PackageRuntimeVerifierInput): ScientificReproductionVerifierRequest {
  const payload = record(input.payload);
  const request = record(input.request);
  const policy = record(input.policy);
  const artifacts = uniqueArtifacts([
    ...recordList(payload.artifacts),
    ...recordList(request.artifacts),
  ]);
  return {
    goal: firstString(input.goal, request.prompt, payload.message),
    resultRefs: uniqueStrings([
      ...refsFromRecord(payload),
      ...executionUnitRefs(payload.executionUnits),
    ]),
    artifactRefs: uniqueStrings([
      ...artifacts.flatMap((artifact) => refsFromRecord(artifact)),
      ...recordList(request.artifacts).flatMap((artifact) => refsFromRecord(artifact)),
    ]),
    traceRefs: uniqueStrings([
      ...executionUnitRefs(payload.executionUnits),
      ...recordList(payload.logs).flatMap((entry) => refsFromRecord(entry)),
    ]),
    artifacts: artifacts as ScientificReproductionArtifact[],
    providerHints: {
      ...record(policy.providerHints),
      ...record(input.providerHints),
    },
  };
}

function uniqueArtifacts(artifacts: Record<string, unknown>[]) {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const artifact of artifacts) {
    const key = firstString(artifact.id, artifact.dataRef, artifact.ref, artifact.path)
      ?? JSON.stringify(artifact).slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(artifact);
  }
  return out;
}

function executionUnitRefs(value: unknown) {
  return recordList(value).flatMap((unit) => [
    stringField(unit.id),
    stringField(unit.codeRef),
    stringField(unit.stdoutRef),
    stringField(unit.stderrRef),
    stringField(unit.outputRef),
    stringField(unit.traceRef),
    ...refsFromRecord(record(unit.refs)),
  ]).filter((entry): entry is string => Boolean(entry));
}

function refsFromRecord(value: unknown): string[] {
  const source = record(value);
  return [
    stringField(source.ref),
    stringField(source.dataRef),
    stringField(source.rawRef),
    stringField(source.path),
    stringField(source.outputRef),
    stringField(source.traceRef),
  ].filter((entry): entry is string => Boolean(entry));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Object.keys(record(entry)).length > 0) : [];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstString(...values: unknown[]) {
  return values.map(stringField).find(Boolean);
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
