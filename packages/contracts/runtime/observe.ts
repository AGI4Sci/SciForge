export const OBSERVE_INPUT_MODALITIES = [
  'text',
  'image',
  'screenshot',
  'audio',
  'video',
  'document',
  'file',
  'table',
  'telemetry',
  'gui-state',
  'artifact-ref',
] as const;

export type ObserveInputModalityKind = typeof OBSERVE_INPUT_MODALITIES[number];
export type ObserveModalityKind = ObserveInputModalityKind | (string & {});

export const OBSERVE_RESPONSE_STATUSES = ['ok', 'failed', 'partial', 'needs-approval', 'rejected'] as const;
export type ObserveResponseStatus = typeof OBSERVE_RESPONSE_STATUSES[number];

export const OBSERVE_FAILURE_MODES = [
  'missing-modality',
  'unsupported-modality',
  'invalid-instruction',
  'provider-unavailable',
  'timeout',
  'rate-limited',
  'permission-denied',
  'safety-blocked',
  'privacy-blocked',
  'low-confidence',
  'malformed-response',
  'internal-error',
] as const;

export type ObserveFailureMode = typeof OBSERVE_FAILURE_MODES[number];

export const CAPABILITY_COST_CLASSES = ['free', 'low', 'medium', 'high', 'variable', 'unknown'] as const;
export type CapabilityCostClass = typeof CAPABILITY_COST_CLASSES[number];

export const CAPABILITY_LATENCY_CLASSES = ['instant', 'low', 'medium', 'high', 'variable', 'unknown'] as const;
export type CapabilityLatencyClass = typeof CAPABILITY_LATENCY_CLASSES[number];

export const CAPABILITY_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type CapabilityRiskLevel = typeof CAPABILITY_RISK_LEVELS[number];

export interface ObserveModalityContract {
  kind: ObserveInputModalityKind;
  required: boolean;
  maxItems?: number;
  acceptedMimeTypes: string[];
  maxInlineBytes?: number;
  refRequired: boolean;
  notes?: string;
}

export interface ObserveInputModality {
  kind: ObserveInputModalityKind;
  ref: string;
  mimeType?: string;
  title?: string;
  summary?: string;
  sensitivity?: 'public' | 'internal' | 'private' | 'secret';
  metadata?: Record<string, unknown>;
}

export interface ObserveInvocationPolicy {
  repeatedInvocationExpected: boolean;
  maxCallsPerTurn?: number;
  callSpacingMs?: number;
  reason: string;
}

export interface ObserveSafetyPrivacyBoundary {
  riskLevel: CapabilityRiskLevel;
  allowedDataClasses: string[];
  prohibitedDataClasses: string[];
  highRiskPolicy: 'reject' | 'require-confirmation' | 'allow';
  storesRawModalities: boolean;
  contextPolicy: 'refs-and-bounded-summaries';
  notes: string;
}

export interface ObserveCostLatencyExpectation {
  costClass: CapabilityCostClass;
  latencyClass: CapabilityLatencyClass;
  typicalLatencyMs?: number;
  maxLatencyMs?: number;
  notes?: string;
}

export interface ObserveProviderCapabilityBrief {
  schemaVersion: 1;
  id: string;
  kind: 'observe';
  version?: string;
  oneLine: string;
  domains: string[];
  triggers: string[];
  antiTriggers: string[];
  inputModalities: ObserveModalityContract[];
  output: {
    kind: 'text-response';
    formats: Array<'plain-text' | 'markdown' | 'json' | 'coordinates' | 'labels' | 'ocr' | 'diagnostic-text'>;
    description: string;
  };
  failureModes: ObserveFailureMode[];
  cost: ObserveCostLatencyExpectation;
  latency: ObserveCostLatencyExpectation;
  repeatedInvocation: ObserveInvocationPolicy;
  safetyPrivacy: ObserveSafetyPrivacyBoundary;
}

export interface ObserveRequest {
  schemaVersion: 1;
  providerId?: string;
  instruction: string;
  modalities: ObserveInputModality[];
  expectedResponse: {
    kind: 'text-response';
    preferredFormat?: 'plain-text' | 'markdown' | 'json';
  };
  constraints?: Record<string, unknown>;
  invocationPolicy?: ObserveInvocationPolicy;
  safetyPrivacy?: ObserveSafetyPrivacyBoundary;
  trace?: {
    callId?: string;
    parentRunRef?: string;
  };
}

export interface ObserveResponse {
  schemaVersion: 1;
  providerId?: string;
  status: ObserveResponseStatus;
  textResponse: string;
  failureMode?: ObserveFailureMode;
  confidence?: number;
  artifactRefs: string[];
  traceRef?: string;
  diagnostics: string[];
  cost?: {
    costClass?: CapabilityCostClass;
    billedUnits?: number;
  };
  latencyMs?: number;
  safetyPrivacy?: {
    blocked: boolean;
    reason?: string;
  };
}

export interface ObserveModalityRef {
  kind: ObserveModalityKind;
  ref: string;
  mimeType?: string;
  summary?: string;
}

export interface ObserveProviderContract {
  id: string;
  displayName?: string;
  acceptedModalities: ObserveModalityKind[];
  outputKind: 'text';
  expectedMultipleCalls?: boolean;
  costClass?: 'low' | 'medium' | 'high';
  latencyClass?: 'low' | 'medium' | 'high';
}

export interface ObserveIntent {
  instruction: string;
  modalities: ObserveModalityRef[];
  providerId?: string;
  reason?: string;
}

export interface ObserveInvocation {
  callRef: string;
  providerId: string;
  instruction: string;
  modalities: ObserveModalityRef[];
  reason?: string;
}

export interface ObserveInvocationRecord extends ObserveInvocation {
  status: 'ok' | 'failed';
  text?: string;
  artifactRefs: string[];
  traceRef?: string;
  compactSummary: string;
  diagnostics?: Record<string, unknown>;
}

export interface ObserveInvocationPlan {
  goal: string;
  runRef: string;
  invocations: ObserveInvocation[];
}

export function isObserveInputModalityKind(value: unknown): value is ObserveInputModalityKind {
  return typeof value === 'string' && (OBSERVE_INPUT_MODALITIES as readonly string[]).includes(value);
}

export function normalizeObserveInputModality(value: unknown): ObserveInputModality | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  const ref = value.ref;
  if (!isObserveInputModalityKind(kind) || typeof ref !== 'string' || ref.trim().length === 0) return undefined;
  return {
    kind,
    ref: ref.trim(),
    mimeType: optionalString(value.mimeType),
    title: optionalString(value.title),
    summary: optionalString(value.summary),
    sensitivity: normalizeSensitivity(value.sensitivity),
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

export function buildObserveRequest(input: {
  providerId?: string;
  instruction: string;
  modalities: unknown[];
  preferredFormat?: ObserveRequest['expectedResponse']['preferredFormat'];
  constraints?: Record<string, unknown>;
  invocationPolicy?: ObserveInvocationPolicy;
  safetyPrivacy?: ObserveSafetyPrivacyBoundary;
  trace?: ObserveRequest['trace'];
}): ObserveRequest {
  return {
    schemaVersion: 1,
    providerId: optionalString(input.providerId),
    instruction: input.instruction.trim(),
    modalities: input.modalities.map(normalizeObserveInputModality).filter(isPresent),
    expectedResponse: {
      kind: 'text-response',
      preferredFormat: input.preferredFormat,
    },
    constraints: input.constraints,
    invocationPolicy: input.invocationPolicy,
    safetyPrivacy: input.safetyPrivacy,
    trace: input.trace,
  };
}

export function buildObserveProviderCapabilityBrief(input: {
  id: string;
  oneLine: string;
  version?: string;
  domains?: string[];
  triggers?: string[];
  antiTriggers?: string[];
  inputModalities: ObserveModalityContract[];
  outputFormats?: ObserveProviderCapabilityBrief['output']['formats'];
  outputDescription?: string;
  failureModes?: ObserveFailureMode[];
  costClass?: CapabilityCostClass;
  latencyClass?: CapabilityLatencyClass;
  repeatedInvocationExpected?: boolean;
  repeatedInvocationReason?: string;
  safetyPrivacy?: Partial<ObserveSafetyPrivacyBoundary>;
}): ObserveProviderCapabilityBrief {
  const costClass = input.costClass ?? 'unknown';
  const latencyClass = input.latencyClass ?? 'unknown';
  return {
    schemaVersion: 1,
    id: input.id,
    kind: 'observe',
    version: input.version,
    oneLine: input.oneLine,
    domains: uniqueStrings(input.domains),
    triggers: uniqueStrings(input.triggers),
    antiTriggers: uniqueStrings(input.antiTriggers),
    inputModalities: input.inputModalities,
    output: {
      kind: 'text-response',
      formats: input.outputFormats ?? ['plain-text', 'markdown', 'json'],
      description: input.outputDescription ?? 'Returns a bounded text response derived from the instruction and supplied modality refs.',
    },
    failureModes: input.failureModes ?? ['missing-modality', 'unsupported-modality', 'provider-unavailable', 'timeout', 'safety-blocked', 'malformed-response'],
    cost: { costClass, latencyClass },
    latency: { costClass, latencyClass },
    repeatedInvocation: {
      repeatedInvocationExpected: input.repeatedInvocationExpected ?? true,
      reason: input.repeatedInvocationReason ?? 'The main agent may call an observe provider multiple times with narrower instructions, regions, or follow-up uncertainty checks.',
    },
    safetyPrivacy: {
      riskLevel: input.safetyPrivacy?.riskLevel ?? 'medium',
      allowedDataClasses: input.safetyPrivacy?.allowedDataClasses ?? [],
      prohibitedDataClasses: input.safetyPrivacy?.prohibitedDataClasses ?? ['credentials', 'secrets', 'private personal data without approval'],
      highRiskPolicy: input.safetyPrivacy?.highRiskPolicy ?? 'require-confirmation',
      storesRawModalities: input.safetyPrivacy?.storesRawModalities ?? false,
      contextPolicy: 'refs-and-bounded-summaries',
      notes: input.safetyPrivacy?.notes ?? 'Raw modality payloads must stay behind refs; long-term context receives only compact text, artifact refs, and diagnostics.',
    },
  };
}

export function normalizeObserveResponse(value: unknown): ObserveResponse {
  const record = isRecord(value) ? value : {};
  const status = typeof record.status === 'string' && (OBSERVE_RESPONSE_STATUSES as readonly string[]).includes(record.status)
    ? record.status as ObserveResponseStatus
    : 'failed';
  const textResponse = typeof record.textResponse === 'string'
    ? record.textResponse
    : typeof record.text === 'string'
      ? record.text
      : '';
  return {
    schemaVersion: 1,
    providerId: optionalString(record.providerId),
    status,
    textResponse,
    failureMode: normalizeObserveFailureMode(record.failureMode),
    confidence: normalizeUnitInterval(record.confidence),
    artifactRefs: normalizeStringArray(record.artifactRefs),
    traceRef: optionalString(record.traceRef),
    diagnostics: normalizeStringArray(record.diagnostics),
    latencyMs: typeof record.latencyMs === 'number' && Number.isFinite(record.latencyMs) ? Math.max(0, record.latencyMs) : undefined,
  };
}

export type SenseInputModalityKind = ObserveInputModalityKind;
export type SenseModalityKind = ObserveModalityKind;
export type SenseResponseStatus = ObserveResponseStatus;
export type SenseFailureMode = ObserveFailureMode;
export type SenseModalityContract = ObserveModalityContract;
export type SenseInputModality = ObserveInputModality;
export type SenseInvocationPolicy = ObserveInvocationPolicy;
export type SenseSafetyPrivacyBoundary = ObserveSafetyPrivacyBoundary;
export type SenseCostLatencyExpectation = ObserveCostLatencyExpectation;
export type SenseProviderCapabilityBrief = ObserveProviderCapabilityBrief & { kind: 'observe' };
export type SenseRequest = ObserveRequest;
export type SenseResponse = ObserveResponse;
export type SenseModalityRef = ObserveModalityRef;
export type SenseProviderContract = ObserveProviderContract;
export type SenseObservationIntent = ObserveIntent;
export type SenseInvocation = ObserveInvocation;
export type SenseInvocationRecord = ObserveInvocationRecord;
export type SenseInvocationPlan = ObserveInvocationPlan;

export const SENSE_INPUT_MODALITIES = OBSERVE_INPUT_MODALITIES;
export const SENSE_RESPONSE_STATUSES = OBSERVE_RESPONSE_STATUSES;
export const SENSE_FAILURE_MODES = OBSERVE_FAILURE_MODES;

export const isSenseInputModalityKind = isObserveInputModalityKind;
export const normalizeSenseInputModality = normalizeObserveInputModality;
export const buildSenseRequest = buildObserveRequest;
export const buildSenseProviderCapabilityBrief = buildObserveProviderCapabilityBrief;
export const normalizeSenseResponse = normalizeObserveResponse;

function normalizeObserveFailureMode(value: unknown): ObserveFailureMode | undefined {
  return typeof value === 'string' && (OBSERVE_FAILURE_MODES as readonly string[]).includes(value)
    ? value as ObserveFailureMode
    : undefined;
}

function normalizeSensitivity(value: unknown): ObserveInputModality['sensitivity'] {
  return value === 'public' || value === 'internal' || value === 'private' || value === 'secret' ? value : undefined;
}

function normalizeUnitInterval(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value) : [];
}

function uniqueStrings(values: unknown[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
