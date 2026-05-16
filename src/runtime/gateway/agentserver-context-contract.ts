import { createHash } from 'node:crypto';
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

export const REF_SELECTION_POLICY_VERSION = 'sciforge.ref-selection-policy.v1' as const;

export interface RefSelectionPolicy {
  schemaVersion: typeof REF_SELECTION_POLICY_VERSION;
  deterministic: true;
  maxSelectedRefs: number;
  maxSelectedRefBytes: number;
  maxRefPreviewBytes: number;
  maxStablePrefixRefs: number;
  maxPerTurnPayloadRefs: number;
  maxPerTurnPayloadBytes: number;
  retrievalAvailable: boolean;
  fallbackOrder: SelectedRefSource[];
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
  refSelectionPolicy?: RefSelectionPolicy;
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

export interface BuildAgentServerContextRequestInput {
  sessionId: string;
  turnId: string;
  mode: ContextMode;
  currentTurnRef: ProjectMemoryRef;
  stableGoalRef?: ProjectMemoryRef;
  failureRef?: ProjectMemoryRef;
  explicitRefs?: RefDescriptor[];
  projectionPrimaryRefs?: RefDescriptor[];
  failureEvidenceRefs?: RefDescriptor[];
  boundedContextIndexRefs?: RefDescriptor[];
  cachePlan?: {
    stablePrefixRefs?: ProjectMemoryRef[];
    perTurnPayloadRefs?: ProjectMemoryRef[];
  };
  retrievalTools?: RetrievalTool[];
  retrievalAvailable?: boolean;
  retrievalScope?: 'current-session' | 'workspace';
  requireEvidenceForClaims?: boolean;
  maxTailEvidenceBytes?: number;
  maxContextTokens?: number;
  persistRunSummary?: boolean;
  refSelectionPolicy?: Partial<Omit<RefSelectionPolicy, 'schemaVersion' | 'deterministic'>>;
  userVisibleSelectionDigest?: string;
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

const BACKEND_HANDOFF_FORBIDDEN_FIELDS = new Set([
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

const DEFAULT_REF_SELECTION_POLICY: RefSelectionPolicy = {
  schemaVersion: REF_SELECTION_POLICY_VERSION,
  deterministic: true,
  maxSelectedRefs: 8,
  maxSelectedRefBytes: 32_768,
  maxRefPreviewBytes: 512,
  maxStablePrefixRefs: 4,
  maxPerTurnPayloadRefs: 8,
  maxPerTurnPayloadBytes: 16_384,
  retrievalAvailable: true,
  fallbackOrder: ['explicit', 'failure-evidence', 'projection-primary', 'context-index'],
};

export function buildAgentServerContextRequest(input: BuildAgentServerContextRequestInput): AgentServerContextRequest {
  const mode = input.mode;
  const retrievalAvailable = input.retrievalAvailable !== false;
  const refSelectionPolicy = normalizeRefSelectionPolicy(input.refSelectionPolicy, retrievalAvailable);
  const selectedRefs = selectRefsForContextRequest(input, refSelectionPolicy);
  const stablePrefixRefs = boundProjectMemoryRefs(
    mode === 'fresh' ? [] : input.cachePlan?.stablePrefixRefs ?? (input.stableGoalRef ? [input.stableGoalRef] : []),
    refSelectionPolicy.maxStablePrefixRefs,
    Number.POSITIVE_INFINITY,
  ).refs;
  const perTurnPayloadRefs = boundProjectMemoryRefs(
    [
      input.currentTurnRef,
      ...(input.failureRef ? [input.failureRef] : []),
      ...(input.cachePlan?.perTurnPayloadRefs ?? []),
    ],
    refSelectionPolicy.maxPerTurnPayloadRefs,
    refSelectionPolicy.maxPerTurnPayloadBytes,
  ).refs;
  const selectedRefBytes = selectedRefs.reduce((total, ref) => total + refDescriptorBytes(ref), 0);
  const sourceCounts = selectedRefs.reduce((counts, ref) => {
    counts[ref.source] += 1;
    return counts;
  }, {
    explicit: 0,
    'projection-primary': 0,
    'failure-evidence': 0,
    'context-index': 0,
  } as Record<SelectedRefSource, number>);
  const retrievalTools = retrievalAvailable
    ? stableUniqueRetrievalTools(input.retrievalTools ?? ['read_ref', 'retrieve', 'workspace_search'])
    : [];
  const includeCurrentWork = mode === 'continue' || mode === 'repair';

  const request: AgentServerContextRequest = {
    _contractVersion: AGENTSERVER_CONTEXT_REQUEST_VERSION,
    sessionId: input.sessionId,
    turnId: input.turnId,
    cachePlan: {
      stablePrefixRefs,
      perTurnPayloadRefs,
    },
    currentTask: {
      currentTurnRef: input.currentTurnRef,
      stableGoalRef: mode === 'fresh' ? undefined : input.stableGoalRef,
      failureRef: input.failureRef,
      mode,
      explicitRefs: boundedRefDescriptors(input.explicitRefs ?? [], refSelectionPolicy),
      selectedRefs,
      userVisibleSelectionDigest: input.userVisibleSelectionDigest,
    },
    retrievalPolicy: {
      tools: retrievalTools,
      scope: input.retrievalScope ?? (mode === 'repair' ? 'workspace' : 'current-session'),
      preferExplicitRefs: true,
      requireEvidenceForClaims: input.requireEvidenceForClaims ?? true,
      maxTailEvidenceBytes: retrievalAvailable ? input.maxTailEvidenceBytes ?? 4096 : 0,
    },
    refSelectionPolicy,
    refSelectionAudit: {
      policyDigest: `sha256:${sha256Json(refSelectionPolicy)}`,
      selectedRefCount: selectedRefs.length,
      selectedRefBytes,
      truncated: selectedRefs.length < refCandidatesForMode(input).length
        || selectedRefBytes >= refSelectionPolicy.maxSelectedRefBytes,
      sourceCounts: {
        explicit: sourceCounts.explicit,
        projectionPrimary: sourceCounts['projection-primary'],
        failureEvidence: sourceCounts['failure-evidence'],
        contextIndex: sourceCounts['context-index'],
      },
    },
    contextPolicy: {
      mode,
      includeCurrentWork,
      includeRecentTurns: false,
      persistRunSummary: input.persistRunSummary ?? mode !== 'fresh',
      maxContextTokens: input.maxContextTokens ?? 8000,
    },
  };
  assertAgentServerContextRequest(request);
  return request;
}

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
    validateStablePrefixRefs(cachePlan.stablePrefixRefs, 'request.cachePlan.stablePrefixRefs', errors);
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

  if (request.refSelectionPolicy !== undefined) {
    validateRefSelectionPolicy(request.refSelectionPolicy, errors);
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
  collectForbiddenFieldErrors(packet, BACKEND_HANDOFF_FORBIDDEN_FIELDS, 'BackendHandoffPacket', errors);
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

function validateRefSelectionPolicy(value: unknown, errors: string[]): void {
  const policy = asRecord(value);
  if (!policy) {
    errors.push('request.refSelectionPolicy must be an object');
    return;
  }
  collectFunctionFieldErrors(policy, 'request.refSelectionPolicy', errors);
  expectLiteral(policy.schemaVersion, REF_SELECTION_POLICY_VERSION, 'request.refSelectionPolicy.schemaVersion', errors);
  if (policy.deterministic !== true) errors.push('request.refSelectionPolicy.deterministic must be true');
  expectPositiveNumber(policy.maxSelectedRefs, 'request.refSelectionPolicy.maxSelectedRefs', errors);
  expectNonNegativeNumber(policy.maxSelectedRefBytes, 'request.refSelectionPolicy.maxSelectedRefBytes', errors);
  expectNonNegativeNumber(policy.maxRefPreviewBytes, 'request.refSelectionPolicy.maxRefPreviewBytes', errors);
  expectPositiveNumber(policy.maxStablePrefixRefs, 'request.refSelectionPolicy.maxStablePrefixRefs', errors);
  expectPositiveNumber(policy.maxPerTurnPayloadRefs, 'request.refSelectionPolicy.maxPerTurnPayloadRefs', errors);
  expectNonNegativeNumber(policy.maxPerTurnPayloadBytes, 'request.refSelectionPolicy.maxPerTurnPayloadBytes', errors);
  expectBoolean(policy.retrievalAvailable, 'request.refSelectionPolicy.retrievalAvailable', errors);
  if (!Array.isArray(policy.fallbackOrder) || policy.fallbackOrder.length === 0) {
    errors.push('request.refSelectionPolicy.fallbackOrder must be a non-empty array');
  } else {
    policy.fallbackOrder.forEach((source, index) => {
      if (!SELECTED_REF_SOURCES.has(source as SelectedRefSource)) {
        errors.push(`request.refSelectionPolicy.fallbackOrder[${index}] must be a selected ref source`);
      }
    });
  }
}

function validateStablePrefixRefs(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    const ref = asRecord(entry);
    const valueText = `${String(ref?.kind ?? '')}:${String(ref?.ref ?? '')}`;
    if (/(?:^|[:/_-])(turn|run|timestamp|ledger-event)(?:$|[:/_-])/i.test(valueText)) {
      errors.push(`${path}[${index}] must not contain turn, run, timestamp, or ledger-event refs`);
    }
  });
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

function collectFunctionFieldErrors(value: unknown, path: string, errors: string[]): void {
  if (typeof value === 'function') {
    errors.push(`${path} must not contain function values`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectFunctionFieldErrors(item, `${path}[${index}]`, errors));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    collectFunctionFieldErrors(child, `${path}.${key}`, errors);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value));
}

function normalizeRefSelectionPolicy(
  input: BuildAgentServerContextRequestInput['refSelectionPolicy'] | undefined,
  retrievalAvailable: boolean,
): RefSelectionPolicy {
  return {
    ...DEFAULT_REF_SELECTION_POLICY,
    ...input,
    schemaVersion: REF_SELECTION_POLICY_VERSION,
    deterministic: true,
    retrievalAvailable,
    fallbackOrder: stableSelectedRefSources(input?.fallbackOrder ?? DEFAULT_REF_SELECTION_POLICY.fallbackOrder),
  };
}

function stableSelectedRefSources(values: unknown): SelectedRefSource[] {
  const out: SelectedRefSource[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (SELECTED_REF_SOURCES.has(value as SelectedRefSource) && !out.includes(value as SelectedRefSource)) {
      out.push(value as SelectedRefSource);
    }
  }
  return out.length ? out : [...DEFAULT_REF_SELECTION_POLICY.fallbackOrder];
}

function selectRefsForContextRequest(
  input: BuildAgentServerContextRequestInput,
  policy: RefSelectionPolicy,
): SelectedRefDescriptor[] {
  const candidates = refCandidatesForMode(input);
  const allowedSources = policy.retrievalAvailable
    ? policy.fallbackOrder
    : policy.fallbackOrder.filter((source) => source === 'context-index' || source === 'explicit' || source === 'failure-evidence');
  const ordered = candidates
    .filter((candidate) => allowedSources.includes(candidate.source))
    .sort((a, b) => {
      const sourceDelta = allowedSources.indexOf(a.source) - allowedSources.indexOf(b.source);
      if (sourceDelta !== 0) return sourceDelta;
      return stableRefSortKey(a).localeCompare(stableRefSortKey(b));
    });
  const selected: SelectedRefDescriptor[] = [];
  let bytes = 0;
  for (const candidate of ordered) {
    if (selected.some((ref) => ref.ref === candidate.ref)) continue;
    const nextBytes = refDescriptorBytes(candidate);
    if (selected.length >= policy.maxSelectedRefs) break;
    if (bytes + nextBytes > policy.maxSelectedRefBytes) break;
    selected.push({
      ...candidate,
      preview: candidate.preview && Buffer.byteLength(candidate.preview, 'utf8') > policy.maxRefPreviewBytes
        ? candidate.preview.slice(0, policy.maxRefPreviewBytes)
        : candidate.preview,
      priority: selected.length,
    });
    bytes += nextBytes;
  }
  return selected;
}

function refCandidatesForMode(input: BuildAgentServerContextRequestInput): SelectedRefDescriptor[] {
  const explicit = (input.explicitRefs ?? []).map((ref, index) => selectedRef(ref, 'explicit', index));
  const failure = [
    ...(input.failureRef ? [projectMemoryRefDescriptor(input.failureRef)] : []),
    ...(input.failureEvidenceRefs ?? []),
  ].map((ref, index) => selectedRef(ref, 'failure-evidence', explicit.length + index));
  const projection = input.mode === 'continue' || input.mode === 'repair'
    ? (input.projectionPrimaryRefs ?? []).map((ref, index) => selectedRef(ref, 'projection-primary', explicit.length + failure.length + index))
    : [];
  const contextIndex = (input.boundedContextIndexRefs ?? []).map((ref, index) => selectedRef(ref, 'context-index', explicit.length + failure.length + projection.length + index));
  if (explicit.length > 0) return [...explicit, ...failure];
  return [...failure, ...projection, ...contextIndex];
}

function selectedRef(ref: RefDescriptor, source: SelectedRefSource, priority: number): SelectedRefDescriptor {
  return {
    ...ref,
    source,
    priority,
  };
}

function projectMemoryRefDescriptor(ref: ProjectMemoryRef): RefDescriptor {
  return {
    ref: ref.ref,
    kind: ref.kind,
    digest: ref.digest,
    sizeBytes: ref.sizeBytes,
  };
}

function boundedRefDescriptors(refs: RefDescriptor[], policy: RefSelectionPolicy): RefDescriptor[] {
  const out: RefDescriptor[] = [];
  for (const ref of refs.sort((a, b) => stableRefSortKey(a).localeCompare(stableRefSortKey(b)))) {
    if (out.some((entry) => entry.ref === ref.ref)) continue;
    if (out.length >= policy.maxSelectedRefs) break;
    out.push({
      ...ref,
      preview: ref.preview && Buffer.byteLength(ref.preview, 'utf8') > policy.maxRefPreviewBytes
        ? ref.preview.slice(0, policy.maxRefPreviewBytes)
        : ref.preview,
    });
  }
  return out;
}

function boundProjectMemoryRefs(refs: ProjectMemoryRef[], maxRefs: number, maxBytes: number): { refs: ProjectMemoryRef[]; truncated: boolean } {
  const out: ProjectMemoryRef[] = [];
  let bytes = 0;
  for (const ref of refs.sort((a, b) => stableRefSortKey(a).localeCompare(stableRefSortKey(b)))) {
    if (out.some((entry) => entry.ref === ref.ref)) continue;
    const nextBytes = typeof ref.sizeBytes === 'number' && Number.isFinite(ref.sizeBytes) ? ref.sizeBytes : ref.ref.length;
    if (out.length >= maxRefs || bytes + nextBytes > maxBytes) return { refs: out, truncated: true };
    out.push(ref);
    bytes += nextBytes;
  }
  return { refs: out, truncated: false };
}

function stableUniqueRetrievalTools(tools: RetrievalTool[]): RetrievalTool[] {
  const out: RetrievalTool[] = [];
  for (const tool of tools) {
    if (RETRIEVAL_TOOLS.has(tool) && !out.includes(tool)) out.push(tool);
  }
  return out;
}

function refDescriptorBytes(ref: RefDescriptor): number {
  if (typeof ref.sizeBytes === 'number' && Number.isFinite(ref.sizeBytes)) return ref.sizeBytes;
  return Buffer.byteLength(canonicalJson(ref), 'utf8');
}

function stableRefSortKey(ref: RefDescriptor | ProjectMemoryRef): string {
  return [
    String(ref.kind ?? ''),
    String(ref.ref ?? ''),
    String(ref.digest ?? ''),
  ].join('\0');
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
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
