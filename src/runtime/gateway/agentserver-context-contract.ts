import type { ContextProjectionBlock, ProjectMemoryRef } from '../project-session-memory.js';

export const AGENTSERVER_CONTEXT_REQUEST_VERSION = 'sciforge.context-request.v1' as const;
export const AGENTSERVER_CONTEXT_RESPONSE_VERSION = 'sciforge.context-response.v1' as const;
export const AGENTSERVER_BACKEND_HANDOFF_VERSION = 'agentserver.handoff.v1' as const;

export type ContextMode = 'fresh' | 'continue' | 'repair' | 'answer-from-registry';
export type RetrievalTool = 'read_ref' | 'retrieve' | 'workspace_search' | 'list_session_artifacts';
export type Recoverability = 'recoverable' | 'retryable' | 'needs-human' | 'fatal' | 'unknown';
export type FailureOwner = 'user' | 'ui' | 'runtime' | 'agentserver' | 'backend' | 'worker' | 'verifier' | 'system';

export interface RefDescriptor {
  ref: string;
  kind?: string;
  digest?: string;
  sizeBytes?: number;
  mime?: string;
  preview?: string;
  readable?: boolean;
}

export type SelectedRefSource = 'explicit' | 'projection-primary' | 'failure-evidence' | 'context-index';

export interface SelectedRefDescriptor extends RefDescriptor {
  source: SelectedRefSource;
  priority: number;
}

export interface AgentServerContextRequest {
  _contractVersion: typeof AGENTSERVER_CONTEXT_REQUEST_VERSION;
  sessionId: string;
  turnId: string;
  cachePlan: {
    stablePrefixRefs: ProjectMemoryRef[];
    perTurnPayloadRefs: ProjectMemoryRef[];
  };
  currentTask: {
    currentTurnRef: ProjectMemoryRef;
    stableGoalRef?: ProjectMemoryRef;
    mode: ContextMode;
    explicitRefs: RefDescriptor[];
    selectedRefs: SelectedRefDescriptor[];
    userVisibleSelectionDigest?: string;
    failureRef?: ProjectMemoryRef;
  };
  retrievalPolicy: {
    tools: RetrievalTool[];
    scope: 'current-session' | 'workspace';
    preferExplicitRefs: true;
    requireEvidenceForClaims: boolean;
    maxTailEvidenceBytes: number;
  };
  refSelectionAudit: {
    policyDigest: string;
    selectedRefCount: number;
    selectedRefBytes: number;
    truncated: boolean;
    sourceCounts: {
      explicit: number;
      projectionPrimary: number;
      failureEvidence: number;
      contextIndex: number;
    };
  };
  contextPolicy: {
    mode: ContextMode;
    includeCurrentWork: boolean;
    includeRecentTurns: boolean;
    persistRunSummary: boolean;
    maxContextTokens: number;
  };
}

export interface DegradedReason {
  owner: FailureOwner;
  reason: string;
  recoverability: Recoverability;
}

export interface AgentServerContextResponse {
  _contractVersion: typeof AGENTSERVER_CONTEXT_RESPONSE_VERSION;
  agentId: string;
  backend: string;
  handoffPacketRef: ProjectMemoryRef;
  contextSnapshotRef: ProjectMemoryRef;
  contextRefs: ProjectMemoryRef[];
  compactionAuditRefs: ProjectMemoryRef[];
  retrievalAuditRefs: ProjectMemoryRef[];
  degradedReason?: DegradedReason;
  degradedReasonRef?: ProjectMemoryRef;
  retrievalTools: RetrievalTool[];
  contextBudget: {
    maxContextTokens: number;
    estimatedStablePrefixTokens: number;
    estimatedPerTurnPayloadTokens: number;
    compactionTriggered: boolean;
    triggerReason?: 'budget' | 'health' | 'policy' | 'manual';
  };
  cacheBlocks?: ContextProjectionBlock[];
}

export interface BackendHandoffPacket {
  _contractVersion: typeof AGENTSERVER_BACKEND_HANDOFF_VERSION;
  sessionId: string;
  turnId: string;
  currentTurnRef: ProjectMemoryRef;
  contextRefs: ProjectMemoryRef[];
  retrievalTools: RetrievalTool[];
  contextSnapshotRef?: ProjectMemoryRef;
  compactionAuditRefs?: ProjectMemoryRef[];
  retrievalAuditRefs?: ProjectMemoryRef[];
  syntheticAuditMeta?: SyntheticAuditMeta;
}

export interface DegradedHandoffPacket {
  _contractVersion: typeof AGENTSERVER_BACKEND_HANDOFF_VERSION;
  degradedReason: DegradedReason;
  degradedReasonRef?: ProjectMemoryRef;
  currentTurnRef: ProjectMemoryRef;
  stableGoalRef?: ProjectMemoryRef;
  capabilityBriefRef: ProjectMemoryRef;
  boundedArtifactIndex: RefDescriptor[];
  boundedFailureIndex: RefDescriptor[];
  availableRetrievalTools: RetrievalTool[];
}

export interface SyntheticAuditMeta {
  synthetic: true;
  source: 'adapter';
  upstream: string;
  reason: 'upstream-missing-audit' | 'upstream-partial-audit' | 'upstream-non-deterministic-format';
  confidence: 'low' | 'medium' | 'high';
  sourceRefs: ProjectMemoryRef[];
}

export interface ContractValidationResult {
  ok: boolean;
  errors: string[];
}

const REQUEST_FORBIDDEN_FIELDS = new Set([
  'recentTurns',
  'rawHistory',
  'history',
  'rawBody',
  'body',
  'rawArtifactBody',
  'artifactBody',
  'fullRefList',
  'compactionState',
]);

const DEGRADED_FORBIDDEN_FIELDS = new Set([
  'recentTurns',
  'fullRefList',
  'rawHistory',
  'history',
  'rawBody',
  'body',
  'rawArtifactBody',
  'artifactBody',
  'compactionState',
]);

const SELECTED_REF_SOURCES = new Set<SelectedRefSource>([
  'explicit',
  'projection-primary',
  'failure-evidence',
  'context-index',
]);

const RETRIEVAL_TOOLS = new Set<RetrievalTool>([
  'read_ref',
  'retrieve',
  'workspace_search',
  'list_session_artifacts',
]);

export function canonicalSerializeAgentServerContextRequest(request: AgentServerContextRequest): string {
  assertAgentServerContextRequest(request);
  return canonicalJson(request);
}

export function canonicalSerializeDegradedHandoffPacket(packet: DegradedHandoffPacket): string {
  assertDegradedHandoffPacket(packet);
  return canonicalJson(packet);
}

export function canonicalSerializeBackendHandoffPacket(packet: BackendHandoffPacket): string {
  assertBackendHandoffPacket(packet);
  return canonicalJson(packet);
}

export function validateAgentServerContextRequest(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const request = asRecord(value);
  if (!request) return invalid('request must be an object');
  collectForbiddenFieldErrors(request, REQUEST_FORBIDDEN_FIELDS, 'AgentServerContextRequest', errors);
  expectLiteral(request._contractVersion, AGENTSERVER_CONTEXT_REQUEST_VERSION, 'request._contractVersion', errors);
  expectNonEmptyString(request.sessionId, 'request.sessionId', errors);
  expectNonEmptyString(request.turnId, 'request.turnId', errors);

  const cachePlan = asRecord(request.cachePlan);
  if (!cachePlan) {
    errors.push('request.cachePlan must be an object');
  } else {
    validateProjectMemoryRefs(cachePlan.stablePrefixRefs, 'request.cachePlan.stablePrefixRefs', errors);
    validateProjectMemoryRefs(cachePlan.perTurnPayloadRefs, 'request.cachePlan.perTurnPayloadRefs', errors);
  }

  const currentTask = asRecord(request.currentTask);
  if (!currentTask) {
    errors.push('request.currentTask must be an object');
  } else {
    validateProjectMemoryRef(currentTask.currentTurnRef, 'request.currentTask.currentTurnRef', errors);
    validateOptionalProjectMemoryRef(currentTask.stableGoalRef, 'request.currentTask.stableGoalRef', errors);
    validateOptionalProjectMemoryRef(currentTask.failureRef, 'request.currentTask.failureRef', errors);
    validateContextMode(currentTask.mode, 'request.currentTask.mode', errors);
    validateRefDescriptors(currentTask.explicitRefs, 'request.currentTask.explicitRefs', errors);
    validateSelectedRefDescriptors(currentTask.selectedRefs, 'request.currentTask.selectedRefs', errors);
  }

  const retrievalPolicy = asRecord(request.retrievalPolicy);
  if (!retrievalPolicy) {
    errors.push('request.retrievalPolicy must be an object');
  } else {
    validateRetrievalTools(retrievalPolicy.tools, 'request.retrievalPolicy.tools', errors);
    if (retrievalPolicy.scope !== 'current-session' && retrievalPolicy.scope !== 'workspace') {
      errors.push('request.retrievalPolicy.scope must be current-session or workspace');
    }
    if (retrievalPolicy.preferExplicitRefs !== true) {
      errors.push('request.retrievalPolicy.preferExplicitRefs must be true');
    }
    expectBoolean(retrievalPolicy.requireEvidenceForClaims, 'request.retrievalPolicy.requireEvidenceForClaims', errors);
    expectNonNegativeNumber(retrievalPolicy.maxTailEvidenceBytes, 'request.retrievalPolicy.maxTailEvidenceBytes', errors);
  }

  validateRefSelectionAudit(request.refSelectionAudit, errors);
  const contextPolicy = asRecord(request.contextPolicy);
  if (!contextPolicy) {
    errors.push('request.contextPolicy must be an object');
  } else {
    validateContextMode(contextPolicy.mode, 'request.contextPolicy.mode', errors);
    expectBoolean(contextPolicy.includeCurrentWork, 'request.contextPolicy.includeCurrentWork', errors);
    expectBoolean(contextPolicy.includeRecentTurns, 'request.contextPolicy.includeRecentTurns', errors);
    expectBoolean(contextPolicy.persistRunSummary, 'request.contextPolicy.persistRunSummary', errors);
    expectPositiveNumber(contextPolicy.maxContextTokens, 'request.contextPolicy.maxContextTokens', errors);
  }

  return { ok: errors.length === 0, errors };
}

export function assertAgentServerContextRequest(value: unknown): asserts value is AgentServerContextRequest {
  const result = validateAgentServerContextRequest(value);
  if (!result.ok) throw new ContractValidationError('Invalid AgentServerContextRequest', result.errors);
}

export function validateDegradedHandoffPacket(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const packet = asRecord(value);
  if (!packet) return invalid('degraded packet must be an object');
  collectForbiddenFieldErrors(packet, DEGRADED_FORBIDDEN_FIELDS, 'DegradedHandoffPacket', errors);
  expectLiteral(packet._contractVersion, AGENTSERVER_BACKEND_HANDOFF_VERSION, 'packet._contractVersion', errors);
  validateDegradedReason(packet.degradedReason, 'packet.degradedReason', errors);
  validateOptionalProjectMemoryRef(packet.degradedReasonRef, 'packet.degradedReasonRef', errors);
  validateProjectMemoryRef(packet.currentTurnRef, 'packet.currentTurnRef', errors);
  validateOptionalProjectMemoryRef(packet.stableGoalRef, 'packet.stableGoalRef', errors);
  validateProjectMemoryRef(packet.capabilityBriefRef, 'packet.capabilityBriefRef', errors);
  validateRefDescriptors(packet.boundedArtifactIndex, 'packet.boundedArtifactIndex', errors);
  validateRefDescriptors(packet.boundedFailureIndex, 'packet.boundedFailureIndex', errors);
  validateRetrievalTools(packet.availableRetrievalTools, 'packet.availableRetrievalTools', errors);
  return { ok: errors.length === 0, errors };
}

export function assertDegradedHandoffPacket(value: unknown): asserts value is DegradedHandoffPacket {
  const result = validateDegradedHandoffPacket(value);
  if (!result.ok) throw new ContractValidationError('Invalid DegradedHandoffPacket', result.errors);
}

export function validateBackendHandoffPacket(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const packet = asRecord(value);
  if (!packet) return invalid('handoff packet must be an object');
  expectLiteral(packet._contractVersion, AGENTSERVER_BACKEND_HANDOFF_VERSION, 'packet._contractVersion', errors);
  expectNonEmptyString(packet.sessionId, 'packet.sessionId', errors);
  expectNonEmptyString(packet.turnId, 'packet.turnId', errors);
  validateProjectMemoryRef(packet.currentTurnRef, 'packet.currentTurnRef', errors);
  validateProjectMemoryRefs(packet.contextRefs, 'packet.contextRefs', errors);
  validateRetrievalTools(packet.retrievalTools, 'packet.retrievalTools', errors);
  validateOptionalProjectMemoryRef(packet.contextSnapshotRef, 'packet.contextSnapshotRef', errors);
  if (packet.compactionAuditRefs !== undefined) {
    validateProjectMemoryRefs(packet.compactionAuditRefs, 'packet.compactionAuditRefs', errors);
  }
  if (packet.retrievalAuditRefs !== undefined) {
    validateProjectMemoryRefs(packet.retrievalAuditRefs, 'packet.retrievalAuditRefs', errors);
  }
  if (packet.syntheticAuditMeta !== undefined) {
    errors.push(...validateSyntheticAuditMeta(packet.syntheticAuditMeta).errors.map((error) => `packet.syntheticAuditMeta.${error}`));
  }
  return { ok: errors.length === 0, errors };
}

export function assertBackendHandoffPacket(value: unknown): asserts value is BackendHandoffPacket {
  const result = validateBackendHandoffPacket(value);
  if (!result.ok) throw new ContractValidationError('Invalid BackendHandoffPacket', result.errors);
}

export function validateSyntheticAuditMeta(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const meta = asRecord(value);
  if (!meta) return invalid('SyntheticAuditMeta must be an object');
  if (meta.synthetic !== true) errors.push('synthetic must be explicitly true');
  expectLiteral(meta.source, 'adapter', 'source', errors);
  expectNonEmptyString(meta.upstream, 'upstream', errors);
  if (!['upstream-missing-audit', 'upstream-partial-audit', 'upstream-non-deterministic-format'].includes(String(meta.reason))) {
    errors.push('reason must describe the upstream audit gap');
  }
  if (!['low', 'medium', 'high'].includes(String(meta.confidence))) {
    errors.push('confidence must be low, medium, or high');
  }
  validateProjectMemoryRefs(meta.sourceRefs, 'sourceRefs', errors);
  return { ok: errors.length === 0, errors };
}

export function assertSyntheticAuditMeta(value: unknown): asserts value is SyntheticAuditMeta {
  const result = validateSyntheticAuditMeta(value);
  if (!result.ok) throw new ContractValidationError('Invalid SyntheticAuditMeta', result.errors);
}

export class ContractValidationError extends Error {
  constructor(message: string, readonly errors: string[]) {
    super(`${message}: ${errors.join('; ')}`);
    this.name = 'ContractValidationError';
  }
}

function validateRefSelectionAudit(value: unknown, errors: string[]): void {
  const audit = asRecord(value);
  if (!audit) {
    errors.push('request.refSelectionAudit must be an object');
    return;
  }
  expectNonEmptyString(audit.policyDigest, 'request.refSelectionAudit.policyDigest', errors);
  expectNonNegativeInteger(audit.selectedRefCount, 'request.refSelectionAudit.selectedRefCount', errors);
  expectNonNegativeNumber(audit.selectedRefBytes, 'request.refSelectionAudit.selectedRefBytes', errors);
  expectBoolean(audit.truncated, 'request.refSelectionAudit.truncated', errors);
  const counts = asRecord(audit.sourceCounts);
  if (!counts) {
    errors.push('request.refSelectionAudit.sourceCounts must be an object');
    return;
  }
  expectNonNegativeInteger(counts.explicit, 'request.refSelectionAudit.sourceCounts.explicit', errors);
  expectNonNegativeInteger(counts.projectionPrimary, 'request.refSelectionAudit.sourceCounts.projectionPrimary', errors);
  expectNonNegativeInteger(counts.failureEvidence, 'request.refSelectionAudit.sourceCounts.failureEvidence', errors);
  expectNonNegativeInteger(counts.contextIndex, 'request.refSelectionAudit.sourceCounts.contextIndex', errors);
}

function validateDegradedReason(value: unknown, path: string, errors: string[]): void {
  const reason = asRecord(value);
  if (!reason) {
    errors.push(`${path} must be an object`);
    return;
  }
  expectNonEmptyString(reason.owner, `${path}.owner`, errors);
  expectNonEmptyString(reason.reason, `${path}.reason`, errors);
  expectNonEmptyString(reason.recoverability, `${path}.recoverability`, errors);
}

function validateProjectMemoryRefs(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((ref, index) => validateProjectMemoryRef(ref, `${path}[${index}]`, errors));
}

function validateOptionalProjectMemoryRef(value: unknown, path: string, errors: string[]): void {
  if (value !== undefined) validateProjectMemoryRef(value, path, errors);
}

function validateProjectMemoryRef(value: unknown, path: string, errors: string[]): void {
  const ref = asRecord(value);
  if (!ref) {
    errors.push(`${path} must be a ProjectMemoryRef`);
    return;
  }
  expectNonEmptyString(ref.ref, `${path}.ref`, errors);
  expectNonEmptyString(ref.kind, `${path}.kind`, errors);
  expectNonEmptyString(ref.digest, `${path}.digest`, errors);
  expectNonNegativeNumber(ref.sizeBytes, `${path}.sizeBytes`, errors);
}

function validateRefDescriptors(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((descriptor, index) => {
    const ref = asRecord(descriptor);
    if (!ref) {
      errors.push(`${path}[${index}] must be a ref descriptor`);
      return;
    }
    expectNonEmptyString(ref.ref, `${path}[${index}].ref`, errors);
    if (ref.sizeBytes !== undefined) expectNonNegativeNumber(ref.sizeBytes, `${path}[${index}].sizeBytes`, errors);
  });
}

function validateSelectedRefDescriptors(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((descriptor, index) => {
    const ref = asRecord(descriptor);
    if (!ref) {
      errors.push(`${path}[${index}] must be a selected ref descriptor`);
      return;
    }
    expectNonEmptyString(ref.ref, `${path}[${index}].ref`, errors);
    if (!SELECTED_REF_SOURCES.has(ref.source as SelectedRefSource)) {
      errors.push(`${path}[${index}].source must be explicit, projection-primary, failure-evidence, or context-index`);
    }
    expectNonNegativeNumber(ref.priority, `${path}[${index}].priority`, errors);
    if (ref.sizeBytes !== undefined) expectNonNegativeNumber(ref.sizeBytes, `${path}[${index}].sizeBytes`, errors);
  });
}

function validateRetrievalTools(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((tool, index) => {
    if (!RETRIEVAL_TOOLS.has(tool as RetrievalTool)) {
      errors.push(`${path}[${index}] must be a supported retrieval tool`);
    }
  });
}

function validateContextMode(value: unknown, path: string, errors: string[]): void {
  if (!['fresh', 'continue', 'repair', 'answer-from-registry'].includes(String(value))) {
    errors.push(`${path} must be fresh, continue, repair, or answer-from-registry`);
  }
}

function collectForbiddenFieldErrors(
  value: unknown,
  forbiddenFields: ReadonlySet<string>,
  rootName: string,
  errors: string[],
  path = rootName,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFieldErrors(item, forbiddenFields, rootName, errors, `${path}[${index}]`));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (forbiddenFields.has(key)) {
      errors.push(`${childPath} is forbidden by ${rootName} contract`);
    }
    collectForbiddenFieldErrors(child, forbiddenFields, rootName, errors, childPath);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value));
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortForCanonicalJson(record[key])]),
  );
}

function expectLiteral(value: unknown, expected: string, path: string, errors: string[]): void {
  if (value !== expected) errors.push(`${path} must be ${expected}`);
}

function expectNonEmptyString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) errors.push(`${path} must be a non-empty string`);
}

function expectBoolean(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
}

function expectPositiveNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors.push(`${path} must be a positive number`);
}

function expectNonNegativeNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`${path} must be a non-negative number`);
}

function expectNonNegativeInteger(value: unknown, path: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) errors.push(`${path} must be a non-negative integer`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function invalid(error: string): ContractValidationResult {
  return { ok: false, errors: [error] };
}
