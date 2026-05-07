import type { CapabilityCostClass, CapabilityLatencyClass, CapabilityRiskLevel } from './senseProvider';

export const VERIFICATION_RESULT_SCHEMA_VERSION = 1 as const;

export const VERIFICATION_MODES = ['none', 'lightweight', 'automatic', 'human', 'hybrid'] as const;
export type VerificationMode = typeof VERIFICATION_MODES[number];

export const VERIFICATION_VERDICTS = ['pass', 'fail', 'uncertain', 'needs-human', 'unverified'] as const;
export type VerificationVerdict = typeof VERIFICATION_VERDICTS[number];

export const VERIFIER_PROVIDER_TYPES = ['human', 'agent', 'schema-test', 'environment', 'simulator', 'reward-model'] as const;
export type VerifierProviderType = typeof VERIFIER_PROVIDER_TYPES[number];

export const HUMAN_VERIFICATION_EVENT_TYPES = ['accept', 'reject', 'revise', 'score', 'comment'] as const;
export type HumanVerificationEventType = typeof HUMAN_VERIFICATION_EVENT_TYPES[number];

export interface VerificationPolicy {
  schemaVersion: 1;
  required: boolean;
  mode: VerificationMode;
  riskLevel: CapabilityRiskLevel;
  allowUnverified: boolean;
  unverifiedReason?: string;
  minConfidence?: number;
  minReward?: number;
  requiredVerifierIds: string[];
  humanApproval: {
    required: boolean;
    reason?: string;
  };
  visibility: {
    exposeUnverified: true;
    exposeCritique: boolean;
  };
  reason: string;
}

export interface VerificationRequest {
  schemaVersion: 1;
  goal: string;
  resultRefs: string[];
  artifactRefs: string[];
  traceRefs: string[];
  stateRefs: string[];
  rubric?: string;
  policy: VerificationPolicy;
}

export interface VerificationResult {
  schemaVersion: typeof VERIFICATION_RESULT_SCHEMA_VERSION;
  providerKind: 'human' | 'agent' | 'rule' | 'schema' | 'test' | 'environment' | 'simulator' | 'reward-model';
  providerId: string;
  verdict: VerificationVerdict;
  reward: number;
  confidence: number;
  critique?: string;
  evidenceRefs: string[];
  repairHints: string[];
  artifactRefs: string[];
  traceRefs: string[];
  targetRef?: string;
  createdAt: string;
  rawEvent?: Record<string, unknown>;
}

export interface VerifierCapabilityBrief {
  schemaVersion: 1;
  id: string;
  kind: 'verifier';
  version?: string;
  providerType: VerifierProviderType;
  oneLine: string;
  domains: string[];
  triggers: string[];
  antiTriggers: string[];
  evaluates: Array<'goal' | 'result-ref' | 'artifact-ref' | 'trace-ref' | 'state-ref' | 'environment-state' | 'human-feedback'>;
  supportedVerdicts: VerificationVerdict[];
  output: {
    kind: 'verification-result';
    fields: ['verdict', 'reward', 'confidence', 'critique', 'evidenceRefs', 'repairHints'];
  };
  defaultPolicy: VerificationPolicy;
  costClass: CapabilityCostClass;
  latencyClass: CapabilityLatencyClass;
  failureModes: string[];
  safetyPrivacy: {
    riskLevel: CapabilityRiskLevel;
    requiresHumanForHighRisk: boolean;
    contextPolicy: 'refs-and-bounded-summaries';
    notes: string;
  };
}

export function buildVerificationPolicy(input: {
  required?: boolean;
  mode?: VerificationMode;
  riskLevel?: CapabilityRiskLevel;
  allowUnverified?: boolean;
  unverifiedReason?: string;
  minConfidence?: number;
  minReward?: number;
  requiredVerifierIds?: unknown[];
  humanApprovalRequired?: boolean;
  humanApprovalReason?: string;
  exposeCritique?: boolean;
  reason: string;
}): VerificationPolicy {
  const mode = input.mode ?? 'lightweight';
  const riskLevel = input.riskLevel ?? 'medium';
  const required = input.required ?? mode !== 'none';
  return {
    schemaVersion: 1,
    required,
    mode,
    riskLevel,
    allowUnverified: input.allowUnverified ?? mode === 'none',
    unverifiedReason: input.unverifiedReason?.trim() || undefined,
    minConfidence: clampOptional01(input.minConfidence),
    minReward: clampOptionalReward(input.minReward),
    requiredVerifierIds: compactStringList(input.requiredVerifierIds),
    humanApproval: {
      required: input.humanApprovalRequired ?? (mode === 'human' || (mode === 'hybrid' && riskLevel === 'high')),
      reason: input.humanApprovalReason?.trim() || undefined,
    },
    visibility: {
      exposeUnverified: true,
      exposeCritique: input.exposeCritique ?? true,
    },
    reason: input.reason.trim(),
  };
}

export function buildVerificationRequest(input: {
  goal: string;
  resultRefs?: unknown[];
  artifactRefs?: unknown[];
  traceRefs?: unknown[];
  stateRefs?: unknown[];
  rubric?: string;
  policy: VerificationPolicy;
}): VerificationRequest {
  return {
    schemaVersion: 1,
    goal: input.goal.trim(),
    resultRefs: compactStringList(input.resultRefs),
    artifactRefs: compactStringList(input.artifactRefs),
    traceRefs: compactStringList(input.traceRefs),
    stateRefs: compactStringList(input.stateRefs),
    rubric: input.rubric?.trim() || undefined,
    policy: input.policy,
  };
}

export function buildVerificationResult(input: {
  providerKind?: VerificationResult['providerKind'];
  providerId?: string;
  verifierId?: string;
  verdict: VerificationVerdict;
  reward?: number;
  confidence?: number;
  critique?: string;
  evidenceRefs?: unknown[];
  repairHints?: unknown[];
  artifactRefs?: unknown[];
  traceRefs?: unknown[];
  targetRef?: string;
  createdAt?: string;
  checkedAt?: string;
  policyRef?: string;
  diagnostics?: unknown[];
}): VerificationResult {
  return {
    schemaVersion: VERIFICATION_RESULT_SCHEMA_VERSION,
    providerKind: input.providerKind ?? 'agent',
    providerId: input.providerId?.trim() || input.verifierId?.trim() || 'unknown-verifier',
    verdict: input.verdict,
    reward: clampOptionalReward(input.reward) ?? 0,
    confidence: clampOptional01(input.confidence) ?? 0,
    critique: input.critique?.trim() || '',
    evidenceRefs: compactStringList(input.evidenceRefs),
    repairHints: compactStringList(input.repairHints),
    artifactRefs: compactStringList(input.artifactRefs),
    traceRefs: compactStringList(input.traceRefs),
    targetRef: input.targetRef?.trim() || undefined,
    createdAt: input.createdAt ?? input.checkedAt ?? new Date(0).toISOString(),
    rawEvent: {
      policyRef: input.policyRef,
      diagnostics: compactStringList(input.diagnostics),
    },
  };
}

export function buildVerifierCapabilityBrief(input: {
  id: string;
  oneLine: string;
  providerType: VerifierProviderType;
  defaultPolicy: VerificationPolicy;
  version?: string;
  domains?: unknown[];
  triggers?: unknown[];
  antiTriggers?: unknown[];
  evaluates?: VerifierCapabilityBrief['evaluates'];
  supportedVerdicts?: VerificationVerdict[];
  costClass?: CapabilityCostClass;
  latencyClass?: CapabilityLatencyClass;
  failureModes?: unknown[];
  safetyPrivacy?: Partial<VerifierCapabilityBrief['safetyPrivacy']>;
}): VerifierCapabilityBrief {
  return {
    schemaVersion: 1,
    id: input.id,
    kind: 'verifier',
    version: input.version,
    providerType: input.providerType,
    oneLine: input.oneLine,
    domains: compactStringList(input.domains),
    triggers: compactStringList(input.triggers),
    antiTriggers: compactStringList(input.antiTriggers),
    evaluates: input.evaluates ?? ['goal', 'result-ref', 'artifact-ref', 'trace-ref'],
    supportedVerdicts: input.supportedVerdicts ?? [...VERIFICATION_VERDICTS],
    output: {
      kind: 'verification-result',
      fields: ['verdict', 'reward', 'confidence', 'critique', 'evidenceRefs', 'repairHints'],
    },
    defaultPolicy: input.defaultPolicy,
    costClass: input.costClass ?? 'unknown',
    latencyClass: input.latencyClass ?? 'unknown',
    failureModes: compactStringList(input.failureModes),
    safetyPrivacy: {
      riskLevel: input.safetyPrivacy?.riskLevel ?? input.defaultPolicy.riskLevel,
      requiresHumanForHighRisk: input.safetyPrivacy?.requiresHumanForHighRisk ?? true,
      contextPolicy: 'refs-and-bounded-summaries',
      notes: input.safetyPrivacy?.notes ?? 'Verifier inputs and evidence should use refs and bounded summaries rather than inlining large artifacts or traces.',
    },
  };
}

export function normalizeVerificationPolicy(value: unknown, fallbackReason = 'No explicit verification policy was provided.'): VerificationPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return buildVerificationPolicy({ mode: 'lightweight', reason: fallbackReason });
  const record = value as Record<string, unknown>;
  return buildVerificationPolicy({
    required: typeof record.required === 'boolean' ? record.required : undefined,
    mode: normalizeVerificationMode(record.mode),
    riskLevel: normalizeRiskLevel(record.riskLevel),
    allowUnverified: typeof record.allowUnverified === 'boolean' ? record.allowUnverified : undefined,
    unverifiedReason: typeof record.unverifiedReason === 'string' ? record.unverifiedReason : undefined,
    minConfidence: typeof record.minConfidence === 'number' ? record.minConfidence : undefined,
    minReward: typeof record.minReward === 'number' ? record.minReward : undefined,
    requiredVerifierIds: Array.isArray(record.requiredVerifierIds) ? record.requiredVerifierIds : [],
    humanApprovalRequired: isPlainRecord(record.humanApproval) && typeof record.humanApproval.required === 'boolean' ? record.humanApproval.required : undefined,
    humanApprovalReason: isPlainRecord(record.humanApproval) && typeof record.humanApproval.reason === 'string' ? record.humanApproval.reason : undefined,
    exposeCritique: isPlainRecord(record.visibility) && typeof record.visibility.exposeCritique === 'boolean' ? record.visibility.exposeCritique : undefined,
    reason: typeof record.reason === 'string' && record.reason.trim() ? record.reason : fallbackReason,
  });
}

export function normalizeVerificationResult(value: unknown): VerificationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return buildVerificationResult({ verdict: 'unverified' });
  const record = value as Record<string, unknown>;
  return buildVerificationResult({
    providerKind: normalizeProviderKind(record.providerKind),
    providerId: typeof record.providerId === 'string' ? record.providerId : undefined,
    verdict: normalizeVerificationVerdict(record.verdict) ?? 'unverified',
    reward: typeof record.reward === 'number' ? record.reward : undefined,
    confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
    critique: typeof record.critique === 'string' ? record.critique : '',
    evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs : [],
    repairHints: Array.isArray(record.repairHints) ? record.repairHints : [],
    artifactRefs: Array.isArray(record.artifactRefs) ? record.artifactRefs : [],
    traceRefs: Array.isArray(record.traceRefs) ? record.traceRefs : [],
    targetRef: typeof record.targetRef === 'string' ? record.targetRef : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
  });
}

export function isVerificationSuccess(result: Pick<VerificationResult, 'verdict'>): boolean {
  return result.verdict === 'pass';
}

export function isTerminalVerificationVerdict(verdict: VerificationVerdict): boolean {
  return verdict === 'pass' || verdict === 'fail';
}

export interface HumanVerificationInteractiveEvent {
  schemaVersion: 1;
  type: HumanVerificationEventType;
  viewId: string;
  targetRef?: string;
  artifactRefs?: string[];
  traceRefs?: string[];
  comment?: string;
  score?: number;
  confidence?: number;
  repairHints?: string[];
  evidenceRefs?: string[];
  createdAt?: string;
  raw?: Record<string, unknown>;
}

export function humanVerificationEventToResult(
  event: HumanVerificationInteractiveEvent,
  options: {
    providerId?: string;
    now?: () => string;
  } = {},
): VerificationResult {
  const verdict = verdictForHumanVerificationEvent(event);
  const reward = rewardForHumanVerificationEvent(event);
  return {
    schemaVersion: VERIFICATION_RESULT_SCHEMA_VERSION,
    providerKind: 'human',
    providerId: options.providerId ?? event.viewId,
    verdict,
    reward,
    confidence: clamp01(event.confidence ?? defaultHumanConfidence(event.type)),
    critique: event.comment?.trim() || undefined,
    evidenceRefs: compactStringList(event.evidenceRefs),
    repairHints: compactStringList([
      ...(event.type === 'revise' && event.comment ? [event.comment] : []),
      ...(event.repairHints ?? []),
    ]),
    artifactRefs: compactStringList(event.artifactRefs),
    traceRefs: compactStringList(event.traceRefs),
    targetRef: event.targetRef?.trim() || undefined,
    createdAt: event.createdAt ?? options.now?.() ?? new Date().toISOString(),
    rawEvent: {
      type: event.type,
      viewId: event.viewId,
      score: event.score,
      raw: event.raw,
    },
  };
}

export function isHumanVerificationInteractiveEvent(value: unknown): value is HumanVerificationInteractiveEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.viewId === 'string'
    && typeof record.type === 'string'
    && (HUMAN_VERIFICATION_EVENT_TYPES as readonly string[]).includes(record.type);
}

function verdictForHumanVerificationEvent(event: HumanVerificationInteractiveEvent): VerificationVerdict {
  if (event.type === 'accept') return 'pass';
  if (event.type === 'reject') return 'fail';
  if (event.type === 'revise') return 'fail';
  if (event.type === 'comment') return 'uncertain';
  const score = clamp01(event.score ?? 0.5);
  if (score >= 0.75) return 'pass';
  if (score <= 0.35) return 'fail';
  return 'uncertain';
}

function rewardForHumanVerificationEvent(event: HumanVerificationInteractiveEvent) {
  if (event.type === 'accept') return 1;
  if (event.type === 'reject') return 0;
  if (event.type === 'revise') return Math.min(0.35, clamp01(event.score ?? 0.25));
  if (event.type === 'comment') return clamp01(event.score ?? 0.5);
  return clamp01(event.score ?? 0.5);
}

function normalizeVerificationMode(value: unknown): VerificationMode | undefined {
  return typeof value === 'string' && (VERIFICATION_MODES as readonly string[]).includes(value)
    ? value as VerificationMode
    : undefined;
}

function normalizeVerificationVerdict(value: unknown): VerificationVerdict | undefined {
  return typeof value === 'string' && (VERIFICATION_VERDICTS as readonly string[]).includes(value)
    ? value as VerificationVerdict
    : undefined;
}

function normalizeRiskLevel(value: unknown): CapabilityRiskLevel | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function normalizeProviderKind(value: unknown): VerificationResult['providerKind'] | undefined {
  return value === 'human'
    || value === 'agent'
    || value === 'rule'
    || value === 'schema'
    || value === 'test'
    || value === 'environment'
    || value === 'simulator'
    || value === 'reward-model'
    ? value
    : undefined;
}

function clampOptionalReward(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(-1, Math.min(1, value));
}

function clampOptional01(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function defaultHumanConfidence(type: HumanVerificationEventType) {
  if (type === 'accept' || type === 'reject') return 0.9;
  if (type === 'revise') return 0.85;
  return 0.65;
}

function compactStringList(values: unknown): string[] {
  return Array.isArray(values)
    ? Array.from(new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)))
    : [];
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
