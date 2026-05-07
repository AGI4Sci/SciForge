export const SENSE_INPUT_MODALITIES = [
  'text',
  'image',
  'screenshot',
  'audio',
  'video',
  'document',
  'table',
  'telemetry',
  'gui-state',
  'artifact-ref',
] as const;

export type SenseInputModalityKind = typeof SENSE_INPUT_MODALITIES[number];

export const SENSE_RESPONSE_STATUSES = ['ok', 'failed', 'partial', 'needs-approval', 'rejected'] as const;
export type SenseResponseStatus = typeof SENSE_RESPONSE_STATUSES[number];

export const SENSE_FAILURE_MODES = [
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

export type SenseFailureMode = typeof SENSE_FAILURE_MODES[number];

export const CAPABILITY_COST_CLASSES = ['free', 'low', 'medium', 'high', 'variable', 'unknown'] as const;
export type CapabilityCostClass = typeof CAPABILITY_COST_CLASSES[number];

export const CAPABILITY_LATENCY_CLASSES = ['instant', 'low', 'medium', 'high', 'variable', 'unknown'] as const;
export type CapabilityLatencyClass = typeof CAPABILITY_LATENCY_CLASSES[number];

export const CAPABILITY_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type CapabilityRiskLevel = typeof CAPABILITY_RISK_LEVELS[number];

export interface SenseModalityContract {
  kind: SenseInputModalityKind;
  required: boolean;
  maxItems?: number;
  acceptedMimeTypes: string[];
  maxInlineBytes?: number;
  refRequired: boolean;
  notes?: string;
}

export interface SenseInputModality {
  kind: SenseInputModalityKind;
  ref: string;
  mimeType?: string;
  title?: string;
  summary?: string;
  sensitivity?: 'public' | 'internal' | 'private' | 'secret';
  metadata?: Record<string, unknown>;
}

export interface SenseInvocationPolicy {
  repeatedInvocationExpected: boolean;
  maxCallsPerTurn?: number;
  callSpacingMs?: number;
  reason: string;
}

export interface SenseSafetyPrivacyBoundary {
  riskLevel: CapabilityRiskLevel;
  allowedDataClasses: string[];
  prohibitedDataClasses: string[];
  highRiskPolicy: 'reject' | 'require-confirmation' | 'allow';
  storesRawModalities: boolean;
  contextPolicy: 'refs-and-bounded-summaries';
  notes: string;
}

export interface SenseCostLatencyExpectation {
  costClass: CapabilityCostClass;
  latencyClass: CapabilityLatencyClass;
  typicalLatencyMs?: number;
  maxLatencyMs?: number;
  notes?: string;
}

export interface SenseProviderCapabilityBrief {
  schemaVersion: 1;
  id: string;
  kind: 'sense';
  version?: string;
  oneLine: string;
  domains: string[];
  triggers: string[];
  antiTriggers: string[];
  inputModalities: SenseModalityContract[];
  output: {
    kind: 'text-response';
    formats: Array<'plain-text' | 'markdown' | 'json' | 'coordinates' | 'labels' | 'ocr' | 'diagnostic-text'>;
    description: string;
  };
  failureModes: SenseFailureMode[];
  cost: SenseCostLatencyExpectation;
  latency: SenseCostLatencyExpectation;
  repeatedInvocation: SenseInvocationPolicy;
  safetyPrivacy: SenseSafetyPrivacyBoundary;
}

export interface SenseRequest {
  schemaVersion: 1;
  providerId?: string;
  instruction: string;
  modalities: SenseInputModality[];
  expectedResponse: {
    kind: 'text-response';
    preferredFormat?: 'plain-text' | 'markdown' | 'json';
  };
  constraints?: Record<string, unknown>;
  invocationPolicy?: SenseInvocationPolicy;
  safetyPrivacy?: SenseSafetyPrivacyBoundary;
  trace?: {
    callId?: string;
    parentRunRef?: string;
  };
}

export interface SenseResponse {
  schemaVersion: 1;
  providerId?: string;
  status: SenseResponseStatus;
  textResponse: string;
  failureMode?: SenseFailureMode;
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

export function isSenseInputModalityKind(value: unknown): value is SenseInputModalityKind {
  return typeof value === 'string' && (SENSE_INPUT_MODALITIES as readonly string[]).includes(value);
}

export function normalizeSenseInputModality(value: unknown): SenseInputModality | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value.kind;
  const ref = value.ref;
  if (!isSenseInputModalityKind(kind) || typeof ref !== 'string' || ref.trim().length === 0) return undefined;
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

export function buildSenseRequest(input: {
  providerId?: string;
  instruction: string;
  modalities: unknown[];
  preferredFormat?: SenseRequest['expectedResponse']['preferredFormat'];
  constraints?: Record<string, unknown>;
  invocationPolicy?: SenseInvocationPolicy;
  safetyPrivacy?: SenseSafetyPrivacyBoundary;
  trace?: SenseRequest['trace'];
}): SenseRequest {
  return {
    schemaVersion: 1,
    providerId: optionalString(input.providerId),
    instruction: input.instruction.trim(),
    modalities: input.modalities.map(normalizeSenseInputModality).filter(isPresent),
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

export function buildSenseProviderCapabilityBrief(input: {
  id: string;
  oneLine: string;
  version?: string;
  domains?: string[];
  triggers?: string[];
  antiTriggers?: string[];
  inputModalities: SenseModalityContract[];
  outputFormats?: SenseProviderCapabilityBrief['output']['formats'];
  outputDescription?: string;
  failureModes?: SenseFailureMode[];
  costClass?: CapabilityCostClass;
  latencyClass?: CapabilityLatencyClass;
  repeatedInvocationExpected?: boolean;
  repeatedInvocationReason?: string;
  safetyPrivacy?: Partial<SenseSafetyPrivacyBoundary>;
}): SenseProviderCapabilityBrief {
  const costClass = input.costClass ?? 'unknown';
  const latencyClass = input.latencyClass ?? 'unknown';
  return {
    schemaVersion: 1,
    id: input.id,
    kind: 'sense',
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
      reason: input.repeatedInvocationReason ?? 'The main agent may call a sense multiple times with narrower instructions, regions, or follow-up uncertainty checks.',
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

export function normalizeSenseResponse(value: unknown): SenseResponse {
  const record = isRecord(value) ? value : {};
  const status = typeof record.status === 'string' && (SENSE_RESPONSE_STATUSES as readonly string[]).includes(record.status)
    ? record.status as SenseResponseStatus
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
    failureMode: normalizeSenseFailureMode(record.failureMode),
    confidence: normalizeUnitInterval(record.confidence),
    artifactRefs: normalizeStringArray(record.artifactRefs),
    traceRef: optionalString(record.traceRef),
    diagnostics: normalizeStringArray(record.diagnostics),
    latencyMs: typeof record.latencyMs === 'number' && Number.isFinite(record.latencyMs) ? Math.max(0, record.latencyMs) : undefined,
  };
}

function normalizeSenseFailureMode(value: unknown): SenseFailureMode | undefined {
  return typeof value === 'string' && (SENSE_FAILURE_MODES as readonly string[]).includes(value)
    ? value as SenseFailureMode
    : undefined;
}

function normalizeSensitivity(value: unknown): SenseInputModality['sensitivity'] {
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
