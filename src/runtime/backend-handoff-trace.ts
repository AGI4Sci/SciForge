import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface BackendHandoffBudget {
  schemaVersion: 'sciforge.backend-handoff-budget.v1';
  maxPayloadBytes: number;
  maxInlineStringChars: number;
  maxInlineJsonBytes: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxDepth: number;
  headChars: number;
  tailChars: number;
  maxPriorAttempts: number;
}

export interface BackendHandoffNormalizationResult<T = unknown> {
  payload: T;
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  normalizedBytes: number;
  budget: BackendHandoffBudget;
  decisions: BackendHandoffBudgetDecision[];
  auditRefs: string[];
  contextEstimate: BackendHandoffContextEstimate;
  slimmingTrace: BackendHandoffSlimmingTrace;
  slimmingTraceRef: string;
  slimmingTraceSha1: string;
}

export interface BackendHandoffBudgetDecision {
  kind: string;
  reason?: string;
  pointer?: string;
  rawRef: string;
  estimatedBytes?: number;
  originalCount?: number;
  keptCount?: number;
  omittedCount?: number;
}

export interface BackendHandoffContextEstimate {
  source: 'estimate';
  rawTokens: number;
  normalizedTokens: number;
  savedTokens: number;
  rawBytes: number;
  normalizedBytes: number;
  budgetMaxPayloadBytes: number;
  normalizedBudgetRatio: number;
}

export interface BackendHandoffSlimmingTrace {
  schemaVersion: 'sciforge.backend-handoff-slimming-trace.v1';
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  normalizedBytes: number;
  sourceRefs: BackendHandoffSlimmingSourceRefs;
  budget: BackendHandoffBudget;
  contextEstimate: BackendHandoffContextEstimate;
  deterministic: true;
  decisions: BackendHandoffSlimmingTraceDecision[];
  decisionDigest: string;
}

export interface BackendHandoffSlimmingSourceRefs {
  harnessContractRef?: string;
  harnessTraceRef?: string;
  agentHarnessHandoffSchemaVersion?: string;
}

export interface BackendHandoffSlimmingTraceDecision extends BackendHandoffBudgetDecision {
  decisionRef: string;
  ordinal: number;
}

export const DEFAULT_BACKEND_HANDOFF_BUDGET: BackendHandoffBudget = {
  schemaVersion: 'sciforge.backend-handoff-budget.v1',
  maxPayloadBytes: 220_000,
  maxInlineStringChars: 12_000,
  maxInlineJsonBytes: 48_000,
  maxArrayItems: 24,
  maxObjectKeys: 80,
  maxDepth: 7,
  headChars: 2000,
  tailChars: 2000,
  maxPriorAttempts: 4,
};

export function backendHandoffRef(purpose: string, rawSha1: string, suffix = '', sessionBundleRel?: string) {
  return join(
    sessionBundleRel ? join(sessionBundleRel.replace(/\/+$/, ''), 'handoffs') : join('.sciforge', 'handoffs'),
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeToken(purpose)}-${rawSha1.slice(0, 10)}${suffix}.json`,
  );
}

export async function writeBackendHandoffRawRef(params: {
  workspacePath: string;
  rawRef: string;
  purpose: string;
  rawSha1: string;
  rawBytes: number;
  payload: unknown;
}) {
  await writeWorkspaceRef(params.workspacePath, params.rawRef, JSON.stringify({
    schemaVersion: 'sciforge.backend-handoff-raw.v1',
    createdAt: new Date().toISOString(),
    purpose: params.purpose,
    rawSha1: params.rawSha1,
    rawBytes: params.rawBytes,
    payload: params.payload,
  }, null, 2));
}

export function backendHandoffAuditRefs(params: {
  purpose: string;
  rawSha1: string;
  rawRef: string;
  slimmingTraceRef: string;
}) {
  return [
    `backend-handoff:${safeToken(params.purpose)}:${params.rawSha1.slice(0, 12)}`,
    params.rawRef,
    params.slimmingTraceRef,
  ];
}

export function estimateHandoffContext(params: {
  rawBytes: number;
  normalizedBytes: number;
  maxPayloadBytes: number;
}): BackendHandoffContextEstimate {
  const rawTokens = Math.ceil(params.rawBytes / 4);
  const normalizedTokens = Math.ceil(params.normalizedBytes / 4);
  return {
    source: 'estimate',
    rawTokens,
    normalizedTokens,
    savedTokens: Math.max(0, rawTokens - normalizedTokens),
    rawBytes: params.rawBytes,
    normalizedBytes: params.normalizedBytes,
    budgetMaxPayloadBytes: params.maxPayloadBytes,
    normalizedBudgetRatio: params.maxPayloadBytes ? params.normalizedBytes / params.maxPayloadBytes : 0,
  };
}

export function attachHandoffManifest(value: unknown, manifest: {
  budget: BackendHandoffBudget;
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  forced?: boolean;
  sourceRefs?: BackendHandoffSlimmingSourceRefs;
}) {
  const handoffManifest = {
    schemaVersion: 'sciforge.backend-handoff-normalized.v1',
    rawRef: manifest.rawRef,
    rawSha1: manifest.rawSha1,
    rawBytes: manifest.rawBytes,
    budget: manifest.budget,
    forcedSecondPass: manifest.forced === true,
    sourceRefs: manifest.sourceRefs,
  };
  if (isRecord(value)) return { ...value, _sciforgeHandoffManifest: handoffManifest };
  return { value, _sciforgeHandoffManifest: handoffManifest };
}

export function attachHandoffSlimmingTraceManifest(value: unknown, manifest: {
  slimmingTraceRef: string;
  decisionCount: number;
  decisionDigest: string;
  sourceRefs: BackendHandoffSlimmingSourceRefs;
}) {
  const record = isRecord(value) ? value : { value };
  const current = isRecord(record._sciforgeHandoffManifest) ? record._sciforgeHandoffManifest : {};
  return {
    ...record,
    _sciforgeHandoffManifest: {
      ...current,
      slimmingTraceRef: manifest.slimmingTraceRef,
      slimmingDecisionCount: manifest.decisionCount,
      slimmingDecisionDigest: manifest.decisionDigest,
      sourceRefs: manifest.sourceRefs,
    },
  };
}

export function buildBackendHandoffSlimmingTrace(input: {
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  normalizedBytes: number;
  budget: BackendHandoffBudget;
  sourceRefs: BackendHandoffSlimmingSourceRefs;
  contextEstimate: BackendHandoffContextEstimate;
  decisions: BackendHandoffBudgetDecision[];
}): BackendHandoffSlimmingTrace {
  const decisions = input.decisions.map((decision, index) => ({
    ...decision,
    ordinal: index,
    decisionRef: `backend-handoff-slimming:${input.rawSha1.slice(0, 12)}:${index}:${sha1Json({
      kind: decision.kind,
      reason: decision.reason,
      pointer: decision.pointer,
      rawRef: decision.rawRef,
      estimatedBytes: decision.estimatedBytes,
      originalCount: decision.originalCount,
      keptCount: decision.keptCount,
      omittedCount: decision.omittedCount,
      sourceRefs: input.sourceRefs,
    }).slice(0, 12)}`,
  }));
  const digestInput = {
    rawSha1: input.rawSha1,
    normalizedBytes: input.normalizedBytes,
    sourceRefs: input.sourceRefs,
    decisions,
  };
  return {
    schemaVersion: 'sciforge.backend-handoff-slimming-trace.v1',
    rawRef: input.rawRef,
    rawSha1: input.rawSha1,
    rawBytes: input.rawBytes,
    normalizedBytes: input.normalizedBytes,
    sourceRefs: input.sourceRefs,
    budget: input.budget,
    contextEstimate: input.contextEstimate,
    deterministic: true,
    decisions,
    decisionDigest: `sha1:${sha1Json(digestInput).slice(0, 16)}`,
  };
}

export function backendHandoffSlimmingSourceRefs(value: unknown): BackendHandoffSlimmingSourceRefs {
  const candidates = [
    value,
    recordPath(value, ['metadata']),
    recordPath(value, ['input', 'metadata']),
    recordPath(value, ['runtime', 'metadata']),
    recordPath(value, ['metadata', 'agentHarnessHandoff']),
    recordPath(value, ['input', 'metadata', 'agentHarnessHandoff']),
    recordPath(value, ['runtime', 'metadata', 'agentHarnessHandoff']),
  ].filter(isRecord);
  for (const candidate of candidates) {
    const handoff = isRecord(candidate.agentHarnessHandoff) ? candidate.agentHarnessHandoff : candidate;
    const harnessContractRef = stringField(handoff.harnessContractRef) ?? stringField(candidate.harnessContractRef);
    const harnessTraceRef = stringField(handoff.harnessTraceRef) ?? stringField(candidate.harnessTraceRef);
    if (harnessContractRef || harnessTraceRef) {
      return normalizeSlimmingSourceRefs({
        harnessContractRef,
        harnessTraceRef,
        agentHarnessHandoffSchemaVersion: stringField(handoff.schemaVersion),
      });
    }
  }
  return {};
}

export function normalizeSlimmingSourceRefs(sourceRefs: BackendHandoffSlimmingSourceRefs): BackendHandoffSlimmingSourceRefs {
  return {
    harnessContractRef: stringField(sourceRefs.harnessContractRef),
    harnessTraceRef: stringField(sourceRefs.harnessTraceRef),
    agentHarnessHandoffSchemaVersion: stringField(sourceRefs.agentHarnessHandoffSchemaVersion),
  };
}

export function estimateBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function sha1Json(value: unknown) {
  try {
    return sha1Text(JSON.stringify(value));
  } catch {
    return sha1Text(String(value));
  }
}

export function sha1Text(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

export function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: String(value) });
  }
}

export async function writeWorkspaceRef(workspace: string, rel: string, content: string) {
  const path = join(workspace, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function recordPath(value: unknown, path: string[]) {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'handoff';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
