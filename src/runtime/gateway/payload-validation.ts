import { resolve } from 'node:path';
import {
  CURRENT_REFERENCE_GATE_TOOL_ID,
} from '@sciforge-ui/runtime-contract';
import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
} from '@sciforge-ui/runtime-contract/capability-budget';
import {
  previewPathHasStableDeliverableExtension,
} from '@sciforge-ui/artifact-preview';
import {
  contractValidationFailureFromErrors,
  contractValidationFailureFromRepairReason,
  validationScopeForToolPayloadSchemaErrors,
  type ContractValidationAuditNote,
} from '@sciforge-ui/runtime-contract/validation-failure';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { runWorkspaceTask, sha1 } from '../workspace-task-runner.js';
import { composeRuntimeUiManifest } from '../runtime-ui-manifest.js';
import { isRecord, toRecordList } from '../gateway-utils.js';
import { repairNeededPayload as buildRepairNeededPayload, type RepairPolicyRefs } from './repair-policy.js';
import { contextCompactionMetadata } from './agentserver-context-window.js';
import { normalizeArtifactsForPayload, persistArtifactRefsForPayload } from './artifact-materializer.js';
import { schemaErrors as toolPayloadSchemaErrors } from './tool-payload-contract.js';
import { normalizeToolPayloadShape, normalizeWorkspaceTaskArtifacts } from './direct-answer-payload.js';
import {
  agentHarnessRepairPolicyBridgeFromRuntimeState,
  createValidationRepairAuditChain,
} from './validation-repair-audit-bridge.js';
import { attachResultPresentationContract } from './result-presentation-contract.js';

type AttemptPlanRefsBuilder = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;
let attemptPlanRefsBuilder: AttemptPlanRefsBuilder = () => ({});

export function configurePayloadValidationContext(builder: AttemptPlanRefsBuilder) {
  attemptPlanRefsBuilder = builder;
}

export function validateToolPayloadStructure(payload: unknown) {
  return toolPayloadSchemaErrors(payload);
}

type AgentServerGenerationFailureDiagnostics = {
  kind: 'contextWindowExceeded' | 'rateLimit' | 'agentserver';
  backend?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  sessionRef?: string;
  originalErrorSummary: string;
  harnessSignals?: Record<string, unknown>;
  compaction?: Parameters<typeof contextCompactionMetadata>[0];
  retryAttempted?: boolean;
  retrySucceeded?: boolean;
};

const PAYLOAD_NORMALIZATION_AUDIT_SCHEMA_VERSION = 'sciforge.payload-normalization-audit.v1' as const;
const STRICT_PAYLOAD_SCHEMA_POLICY_ID = 'sciforge.strict-payload-schema.v1' as const;

interface PayloadNormalizationAudit {
  schemaVersion: typeof PAYLOAD_NORMALIZATION_AUDIT_SCHEMA_VERSION;
  status: 'no-op' | 'refused';
  policy: 'strict-contract';
  policyId: typeof STRICT_PAYLOAD_SCHEMA_POLICY_ID;
  allowedRepairs: string[];
  refusedErrors: string[];
  notes: string[];
  auditNotes: ContractValidationAuditNote[];
}

function normalizeExecutionUnitStatus(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return ['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(text) ? text : 'done';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function validateAndNormalizePayload(
  payload: ToolPayload,
  request: GatewayRequest,
  skill: SkillAvailability,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
) {
  const preNormalizationErrors = toolPayloadSchemaErrors(payload);
  const contractPayload = normalizeToolPayloadShape(payload);
  const normalizationAudit = payloadNormalizationAudit(payload, contractPayload, preNormalizationErrors);
  if (normalizationAudit.status === 'refused') {
    return schemaValidationRepairPayload({
      payload,
      sourcePayload: payload,
      errors: normalizationAudit.refusedErrors,
      request,
      skill,
      refs,
      normalizationAudit,
      forceFailClosed: true,
    });
  }
  const errors = toolPayloadSchemaErrors(contractPayload);
  if (errors.length) {
    return schemaValidationRepairPayload({
      payload: contractPayload,
      sourcePayload: payload,
      errors,
      request,
      skill,
      refs,
      normalizationAudit,
    });
  }
  const workspace = resolve(request.workspacePath || process.cwd());
  const normalizedArtifacts = await normalizeArtifactsForPayload(
    Array.isArray(contractPayload.artifacts) ? contractPayload.artifacts : [],
    workspace,
    refs,
  );
  const persistedArtifacts = await persistArtifactRefsForPayload(
    workspace,
    request,
    normalizedArtifacts,
    refs,
  );
  const referenceFailures = currentReferenceUsageFailures(contractPayload, persistedArtifacts, request);
  const referenceValidationFailure = referenceValidationFailureFromFailures(referenceFailures, request, skill, refs);
  const referenceFailureUnits = referenceFailureExecutionUnits(referenceFailures, referenceValidationFailure);
  const completedContractFailures = completedPayloadContractFailures(contractPayload, persistedArtifacts, refs);
  if (completedContractFailures.length) {
    const validationFailure = contractValidationFailureFromErrors(completedContractFailures, {
      capabilityId: skill.id,
      failureKind: 'work-evidence',
      schemaPath: 'src/runtime/gateway/payload-validation.ts#completedPayloadContractFailures',
      contractId: 'sciforge.completed-payload.v1',
      expected: 'Completed payloads deliver final text, a meaningful artifact body, or a stable non-output artifact/ref',
      actual: 'Payload only promised future retrieval/analysis work and exposed no durable completed deliverable',
      relatedRefs: relatedRefsFromRepairRefs(refs),
      recoverActions: [
        'Run the promised retrieval/analysis work before marking the payload completed.',
        'Return final answer text, a meaningful artifact body, or a stable artifact/dataRef produced by the run.',
        'If the work cannot be completed, return failed-with-reason or repair-needed with a blocker and nextStep.',
      ],
      nextStep: 'Regenerate the backend payload as a real completed result, or report the blocker as repair-needed/failed-with-reason.',
    });
    const repairRefs = repairRefsWithValidationRepairAudit(request, skill, validationFailure, refs, {
      additionalValidationFailures: referenceValidationFailure ? [referenceValidationFailure] : [],
    });
    const repairPayload = repairNeededPayload(request, skill, validationFailure.failureReason, repairRefs);
    return attachPayloadValidationBudgetDebit(
      referenceFailureUnits.length
        ? {
          ...repairPayload,
          executionUnits: [
            ...repairPayload.executionUnits,
            ...referenceFailureUnits,
          ],
        }
        : repairPayload,
      skill,
      validationFailure,
      repairRefs,
    );
  }
  const normalizedPayload: ToolPayload = withPayloadNormalizationAudit(withFailureDiagnosticsPassthrough({
    message: referenceFailures.length
      ? `Current-turn reference contract failed: ${referenceFailures.join('; ')}`
      : String(payload.message || `${skill.id} completed.`),
    confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.5,
    claimType: String(payload.claimType || 'fact'),
    evidenceLevel: String(payload.evidenceLevel || 'runtime'),
    reasoningTrace: [
      String(contractPayload.reasoningTrace || ''),
      `Skill: ${skill.id}`,
      `Runtime gateway refs: taskCodeRef=${refs.taskRel}, outputRef=${refs.outputRel}, stdoutRef=${refs.stdoutRel}, stderrRef=${refs.stderrRel}`,
    ].filter(Boolean).join('\n'),
    claims: Array.isArray(contractPayload.claims) ? contractPayload.claims : [],
    uiManifest: removeExplicitEmptyUiArtifactRefs(
      composeRuntimeUiManifest(
        Array.isArray(contractPayload.uiManifest) ? contractPayload.uiManifest : [],
        Array.isArray(contractPayload.artifacts) ? contractPayload.artifacts : [],
        request,
      ),
      payload,
    ),
    executionUnits: [
      ...(Array.isArray(contractPayload.executionUnits) ? contractPayload.executionUnits : []).map((unit) => isRecord(unit) ? {
        language: 'python',
        codeRef: refs.taskRel,
        stdoutRef: refs.stdoutRel,
        stderrRef: refs.stderrRel,
        outputRef: refs.outputRel,
        runtimeFingerprint: refs.runtimeFingerprint,
        skillId: skill.id,
        ...attemptPlanRefsBuilder(request, skill),
        ...unit,
        status: normalizeExecutionUnitStatus(unit.status),
      } : unit),
      ...referenceFailureUnits,
    ],
    artifacts: persistedArtifacts,
    logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
    verificationResults: contractPayload.verificationResults,
    verificationPolicy: contractPayload.verificationPolicy,
    workEvidence: contractPayload.workEvidence,
  }, contractPayload), normalizationAudit);
  const presentationPayload = attachResultPresentationContract(normalizedPayload, { request, skill, refs });
  return referenceValidationFailure
    ? attachPayloadValidationBudgetDebit(presentationPayload, skill, referenceValidationFailure, refs)
    : presentationPayload;
}

export function schemaValidationRepairPayload(input: {
  payload: unknown;
  sourcePayload?: unknown;
  errors: string[];
  request: GatewayRequest;
  skill: SkillAvailability;
  refs: RepairPolicyRefs;
  normalizationAudit?: PayloadNormalizationAudit;
  forceFailClosed?: boolean;
}): ToolPayload {
  const validationScope = validationScopeForToolPayloadSchemaErrors(input.errors);
  const validationFailure = contractValidationFailureFromErrors(input.errors, {
    capabilityId: input.skill.id,
    failureKind: validationScope.failureKind,
    schemaPath: validationScope.schemaPath,
    contractId: validationScope.contractId,
    expected: validationScope.expected,
    actual: {
      shape: summarizeActualContractShape(input.sourcePayload ?? input.payload),
      normalizationPolicyId: input.normalizationAudit?.policyId,
    },
    relatedRefs: relatedRefsFromRepairRefs(input.refs),
    recoverActions: [
      ...recoverActionsForPayloadSchemaFailure(input.errors),
      ...preservePartialArtifactRecoverActions(input.payload, input.sourcePayload),
      ...recoverActionsForRefusedNormalization(input.normalizationAudit),
    ],
    nextStep: input.normalizationAudit?.status === 'refused'
      ? 'Fail closed and regenerate the payload without relying on unapproved semantic or safety-impacting normalization.'
      : 'Regenerate a valid ToolPayload envelope; keep any partial artifacts as repair inputs until validation passes.',
    auditNotes: input.normalizationAudit?.auditNotes,
  });
  const repairRefs = repairRefsWithValidationRepairAudit(input.request, input.skill, validationFailure, input.refs, {
    forceFailClosed: input.forceFailClosed ?? input.normalizationAudit?.status === 'refused',
  });
  const repairPayload = attachPreservedPartialArtifacts(
    repairNeededPayload(input.request, input.skill, validationFailure.failureReason, repairRefs),
    input.payload,
    input.sourcePayload,
  );
  return attachPayloadValidationBudgetDebit(
    attachResultPresentationContract(withPayloadNormalizationAudit(repairPayload, input.normalizationAudit), { request: input.request, skill: input.skill, refs: repairRefs }),
    input.skill,
    validationFailure,
    repairRefs,
  );
}

function payloadNormalizationAudit(
  sourcePayload: unknown,
  normalizedPayload: unknown,
  preNormalizationErrors: string[],
): PayloadNormalizationAudit {
  const decisions = preNormalizationErrors.map((error) => payloadNormalizationDecision(error, sourcePayload, normalizedPayload));
  const allowedRepairs = decisions
    .filter((decision) => decision.allowed)
    .map((decision) => decision.repair);
  const refusedErrors = decisions
    .filter((decision) => !decision.allowed)
    .map((decision) => decision.error);
  const auditNotes = decisions.map((decision) => decision.auditNote);
  if (refusedErrors.length) {
    return {
      schemaVersion: PAYLOAD_NORMALIZATION_AUDIT_SCHEMA_VERSION,
      status: 'refused',
      policy: 'strict-contract',
      policyId: STRICT_PAYLOAD_SCHEMA_POLICY_ID,
      allowedRepairs,
      refusedErrors,
      notes: [
        'Payload validation refused to normalize invalid ToolPayload shape.',
        'Backends must emit the strict contract; semantic content, safety boundaries, invalid UI refs, legacy aliases, and required envelope omissions fail closed.',
      ],
      auditNotes,
    };
  }
  return {
    schemaVersion: PAYLOAD_NORMALIZATION_AUDIT_SCHEMA_VERSION,
    status: 'no-op',
    policy: 'strict-contract',
    policyId: STRICT_PAYLOAD_SCHEMA_POLICY_ID,
    allowedRepairs,
    refusedErrors: [],
    notes: [],
    auditNotes,
  };
}

function payloadNormalizationDecision(error: string, sourcePayload: unknown, normalizedPayload: unknown): {
  error: string;
  allowed: boolean;
  repair: string;
  auditNote: ContractValidationAuditNote;
} {
  const repair = allowedPayloadNormalizationRepair(error, sourcePayload, normalizedPayload);
  const path = schemaErrorPath(error);
  return {
    error,
    allowed: Boolean(repair),
    repair: repair ?? `blocked ${path}`,
    auditNote: {
      kind: 'schema-normalization',
      status: 'blocked',
      boundary: 'semantic-or-safety',
      policyId: STRICT_PAYLOAD_SCHEMA_POLICY_ID,
      message: repair
        ? `Applied whitelisted schema normalization: ${repair}.`
        : `Refused schema normalization outside the strict ToolPayload contract: ${error}.`,
      paths: [path],
    },
  };
}

function allowedPayloadNormalizationRepair(error: string, sourcePayload: unknown, normalizedPayload: unknown) {
  if (error === 'reasoningTrace must be a string'
    && isRecord(sourcePayload)
    && Array.isArray(sourcePayload.reasoningTrace)
    && isRecord(normalizedPayload)
    && typeof normalizedPayload.reasoningTrace === 'string') {
    return 'joined reasoningTrace array into newline-delimited string';
  }
  const uiArtifactRefMatch = error.match(/^uiManifest\[(\d+)\]\.artifactRef must be a non-empty string when present$/);
  if (uiArtifactRefMatch
    && isRecord(sourcePayload)
    && isRecord(normalizedPayload)
    && Array.isArray(sourcePayload.uiManifest)
    && Array.isArray(normalizedPayload.uiManifest)) {
    const index = Number(uiArtifactRefMatch[1]);
    const sourceSlot = sourcePayload.uiManifest[index];
    const normalizedSlot = normalizedPayload.uiManifest[index];
    if (isRecord(sourceSlot)
      && (sourceSlot.artifactRef === null || sourceSlot.artifactRef === '')
      && isRecord(normalizedSlot)
      && !('artifactRef' in normalizedSlot)) {
      return `removed empty uiManifest[${index}].artifactRef`;
    }
  }
  return undefined;
}

function withFailureDiagnosticsPassthrough(payload: ToolPayload, sourcePayload: unknown): ToolPayload {
  if (!isRecord(sourcePayload)) return payload;
  const failureReason = stringField(sourcePayload.failureReason);
  const diagnostics = sourcePayload.diagnostics;
  const passthrough: Record<string, unknown> = {};
  if (failureReason) passthrough.failureReason = failureReason;
  if (diagnostics !== undefined) passthrough.diagnostics = diagnostics;
  return Object.keys(passthrough).length ? { ...payload, ...passthrough } : payload;
}

function removeExplicitEmptyUiArtifactRefs(
  uiManifest: Array<Record<string, unknown>>,
  sourcePayload: unknown,
): Array<Record<string, unknown>> {
  if (!isRecord(sourcePayload) || !Array.isArray(sourcePayload.uiManifest)) return uiManifest;
  const sourceUiManifest = sourcePayload.uiManifest;
  return uiManifest.map((slot, index) => {
    const sourceSlot = sourceUiManifest[index];
    if (!isRecord(sourceSlot) || (sourceSlot.artifactRef !== null && sourceSlot.artifactRef !== '')) return slot;
    const next = { ...slot };
    delete next.artifactRef;
    return next;
  });
}

function schemaErrorPath(error: string) {
  const missingMatch = error.match(/^missing\s+(.+)$/i);
  if (missingMatch) return String(missingMatch[1]);
  const explicitPath = error.match(/^([A-Za-z0-9_.[\]-]+)\s+/);
  return explicitPath?.[1] ?? '$';
}

function recoverActionsForRefusedNormalization(audit: PayloadNormalizationAudit | undefined) {
  if (audit?.status !== 'refused') return [];
  return [
    'Regenerate the payload to match the strict ToolPayload contract exactly.',
    'Do not infer missing envelope fields, alias legacy keys, or normalize semantic/safety-sensitive values during validation.',
  ];
}

function withPayloadNormalizationAudit(payload: ToolPayload, audit: PayloadNormalizationAudit | undefined): ToolPayload {
  if (!audit || audit.status === 'no-op') return payload;
  return {
    ...payload,
    reasoningTrace: [
      payload.reasoningTrace,
      `payloadNormalizationAudit=${audit.status}; policy=${audit.policy}; allowed=${audit.allowedRepairs.join('|') || 'none'}; refused=${audit.refusedErrors.join('|') || 'none'}`,
    ].filter(Boolean).join('\n'),
    logs: [
      ...(payload.logs ?? []),
      {
        kind: 'payload-normalization-audit',
        ...audit,
      },
    ],
    executionUnits: payload.executionUnits.map((unit, index) => isRecord(unit) && index === 0
      ? {
        ...unit,
        refs: {
          ...(isRecord(unit.refs) ? unit.refs : {}),
          payloadNormalizationAudit: audit,
        },
      }
      : unit),
  };
}

function relatedRefsFromRepairRefs(refs: RepairPolicyRefs) {
  return [refs.taskRel, refs.outputRel, refs.stdoutRel, refs.stderrRel].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function recoverActionsForPayloadSchemaFailure(errors: string[]) {
  const actions = [
    'Return a ToolPayload object with message, claims, uiManifest, executionUnits, and artifacts fields.',
  ];
  if (errors.some((error) => /artifacts must be an array/i.test(error))) {
    actions.push('Normalize artifact maps or keyed artifact objects into an artifacts array before returning.');
  }
  if (errors.some((error) => /missing message|missing claims|missing uiManifest/i.test(error))) {
    actions.push('Keep the failed payload in repair-needed status until the required envelope fields are present.');
  }
  return actions;
}

function preservePartialArtifactRecoverActions(payload: unknown, sourcePayload: unknown) {
  const artifacts = preservedPartialArtifacts(payload, sourcePayload);
  if (!artifacts.length) return [];
  return [
    `Preserve ${artifacts.length} partial artifact(s) as repair inputs; do not promote the malformed result to success.`,
  ];
}

function attachPreservedPartialArtifacts(
  payload: ToolPayload,
  normalizedPayload: unknown,
  sourcePayload: unknown,
): ToolPayload {
  const artifacts = preservedPartialArtifacts(normalizedPayload, sourcePayload);
  if (!artifacts.length) return payload;
  const artifactIds = artifacts.map((artifact) => stringField(artifact.id) ?? stringField(artifact.type) ?? 'artifact');
  const evidenceRefs = uniqueStringsLocal([
    ...artifactIds.map((id) => `artifact:${id}`),
    ...artifacts.flatMap(partialArtifactRefs),
  ]);
  return {
    ...payload,
    reasoningTrace: [
      payload.reasoningTrace,
      `partialArtifactPreservation=preserved ${artifactIds.length} artifact(s) from malformed task result for repair diagnostics`,
    ].filter(Boolean).join('\n'),
    executionUnits: payload.executionUnits.map((unit, index) => isRecord(unit) && index === 0
      ? {
        ...unit,
        outputArtifacts: uniqueStringsLocal([
          ...toStringArray(unit.outputArtifacts),
          ...artifactIds,
        ]),
        refs: {
          ...(isRecord(unit.refs) ? unit.refs : {}),
          partialArtifacts: artifactIds,
          partialArtifactRefs: evidenceRefs,
        },
      }
      : unit),
    objectReferences: mergeObjectReferenceRecords(
      payload.objectReferences ?? [],
      evidenceRefs.map(objectReferenceForPartialRef),
    ),
    artifacts: mergeArtifactRecords(payload.artifacts, artifacts),
    logs: [
      ...(payload.logs ?? []),
      {
        kind: 'partial-artifact-preservation',
        artifactIds,
        refs: evidenceRefs,
      },
    ],
  };
}

function preservedPartialArtifacts(normalizedPayload: unknown, sourcePayload: unknown) {
  const normalized = isRecord(normalizedPayload)
    ? normalizeWorkspaceTaskArtifacts(normalizedPayload.artifacts)
    : [];
  if (normalized.length) return normalized.map(markPartialArtifactPreserved);
  const source = isRecord(sourcePayload)
    ? normalizeWorkspaceTaskArtifacts(sourcePayload.artifacts)
    : [];
  return source.map(markPartialArtifactPreserved);
}

function markPartialArtifactPreserved(artifact: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return {
    ...artifact,
    metadata: {
      ...metadata,
      preservedFromMalformedPayload: true,
      validationStatus: 'repair-needed',
    },
  };
}

function partialArtifactRefs(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const refs = [
    artifact.ref,
    artifact.dataRef,
    artifact.path,
    artifact.rawRef,
    artifact.outputRef,
    metadata.artifactRef,
    metadata.outputRef,
    metadata.taskCodeRef,
    metadata.stdoutRef,
    metadata.stderrRef,
    ...toStringArray(artifact.evidenceRefs),
    ...toStringArray(artifact.traceRefs),
    ...toStringArray(artifact.sourceRefs),
    ...toStringArray(artifact.relatedRefs),
  ];
  return refs.filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0);
}

function objectReferenceForPartialRef(ref: string) {
  const id = ref.replace(/[^A-Za-z0-9:._/-]+/g, '-');
  const kind = ref.startsWith('artifact:')
    ? 'artifact'
    : ref.startsWith('run:')
      ? 'run'
      : ref.startsWith('file:')
        ? 'file'
        : 'reference';
  return {
    id,
    title: ref,
    kind,
    ref,
    status: 'available',
    actions: ['inspect', 'pin'],
    provenance: { preservedFromMalformedPayload: true },
  };
}

function mergeArtifactRecords(base: Array<Record<string, unknown>>, additions: Array<Record<string, unknown>>) {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const artifact of [...base, ...additions]) {
    const key = stringField(artifact.id) ?? stringField(artifact.type) ?? JSON.stringify(artifact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(artifact);
  }
  return out;
}

function mergeObjectReferenceRecords(base: Array<Record<string, unknown>>, additions: Array<Record<string, unknown>>) {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const reference of [...base, ...additions]) {
    const key = stringField(reference.ref) ?? stringField(reference.id) ?? JSON.stringify(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reference);
  }
  return out;
}

function uniqueStringsLocal(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function repairRefsWithValidationRepairAudit(
  request: GatewayRequest,
  skill: SkillAvailability,
  validationFailure: NonNullable<RepairPolicyRefs['validationFailure']>,
  refs: RepairPolicyRefs,
  options: {
    forceFailClosed?: boolean;
    additionalValidationFailures?: Array<NonNullable<RepairPolicyRefs['validationFailure']>>;
  } = {},
): RepairPolicyRefs {
  const chainId = payloadValidationChainId(skill, validationFailure, refs);
  const currentRefs = currentTurnReferenceRecords(request)
    .map((reference) => stringField(reference.ref))
    .filter((ref): ref is string => Boolean(ref));
  const relatedRefs = [
    ...relatedRefsFromRepairRefs(refs),
    ...validationFailure.relatedRefs,
    ...currentRefs,
  ];
  const chain = createValidationRepairAuditChain({
    chainId,
    subject: {
      kind: validationSubjectKindForRepairRefs(refs),
      id: validationSubjectIdForRepairRefs(skill, refs),
      capabilityId: skill.id,
      contractId: validationFailure.contractId,
      schemaPath: validationFailure.schemaPath,
      completedPayloadRef: refs.outputRel,
      generatedTaskRef: generatedTaskRefForRepairRefs(refs),
      artifactRefs: [],
      currentRefs,
    },
    contractValidationFailures: [
      validationFailure,
      ...(options.additionalValidationFailures ?? []),
    ],
    relatedRefs,
    repairBudget: options.forceFailClosed
      ? {
        maxAttempts: 0,
        remainingAttempts: 0,
        maxSupplementAttempts: 0,
        remainingSupplementAttempts: 0,
      }
      : undefined,
    telemetrySpanRefs: [
      `span:payload-validation:${chainId}`,
      `span:repair-decision:${chainId}`,
    ],
    sinkRefs: [`appendTaskAttempt:${chainId}`],
    agentHarnessRepairPolicy: agentHarnessRepairPolicyBridgeFromRuntimeState(request.uiState),
    createdAt: validationFailure.createdAt,
  });
  return {
    ...refs,
    recoverActions: refs.recoverActions ?? validationFailure.recoverActions,
    validationFailure,
    agentServerRefs: {
      ...refs.agentServerRefs,
      validationRepairAudit: {
        validationDecision: chain.validation,
        repairDecision: chain.repair,
        auditRecord: chain.audit,
      },
    },
  };
}

function payloadValidationChainId(
  skill: SkillAvailability,
  failure: NonNullable<RepairPolicyRefs['validationFailure']>,
  refs: RepairPolicyRefs,
) {
  const stableInput = [
    skill.id,
    failure.contractId,
    failure.failureKind,
    refs.outputRel,
    refs.taskRel,
  ].filter(Boolean).join(':');
  return `payload-validation:${sha1(stableInput).slice(0, 12)}`;
}

function attachPayloadValidationBudgetDebit(
  payload: ToolPayload,
  skill: SkillAvailability,
  validationFailure: NonNullable<RepairPolicyRefs['validationFailure']>,
  refs: RepairPolicyRefs,
): ToolPayload {
  const chainId = payloadValidationChainId(skill, validationFailure, refs);
  const executionUnitRef = firstPayloadExecutionUnitId(payload);
  const logRef = `audit:payload-validation-budget-debit:${sha1(chainId).slice(0, 12)}`;
  const debit = createCapabilityBudgetDebitRecord({
    debitId: `budgetDebit:${chainId}`,
    invocationId: `capabilityInvocation:${chainId}`,
    capabilityId: 'sciforge.payload-validation',
    candidateId: 'validator.sciforge.payload-validation',
    manifestRef: 'capability:verifier.schema',
    subjectRefs: uniquePayloadValidationSubjectRefs(validationFailure, refs),
    debitLines: payloadValidationDebitLines(validationFailure),
    sinkRefs: {
      executionUnitRef,
      auditRefs: [
        `audit:${chainId}`,
        `appendTaskAttempt:${chainId}`,
        logRef,
      ],
    },
    metadata: {
      validatorCapabilityId: skill.id,
      failureKind: validationFailure.failureKind,
      contractId: validationFailure.contractId,
      schemaPath: validationFailure.schemaPath,
    },
  });
  const budgetDebitRefs = [debit.debitId];
  return {
    ...payload,
    budgetDebits: [
      ...(payload.budgetDebits ?? []),
      debit,
    ],
    executionUnits: payload.executionUnits.map((unit) => isRecord(unit)
      ? attachBudgetDebitRefs(unit, budgetDebitRefs)
      : unit),
    logs: [
      ...(payload.logs ?? []),
      {
        kind: 'capability-budget-debit-audit',
        ref: logRef,
        capabilityId: 'sciforge.payload-validation',
        validationFailureKind: validationFailure.failureKind,
        budgetDebitRefs,
      },
    ],
  };
}

function payloadValidationDebitLines(
  validationFailure: NonNullable<RepairPolicyRefs['validationFailure']>,
): CapabilityBudgetDebitLine[] {
  return [
    {
      dimension: 'costUnits',
      amount: 1,
      reason: `payload validation ${validationFailure.failureKind}`,
      sourceRef: validationFailure.contractId,
    },
    {
      dimension: 'resultItems',
      amount: Math.max(1, Array.isArray(validationFailure.issues) ? validationFailure.issues.length : 0),
      reason: 'validation findings',
      sourceRef: validationFailure.schemaPath,
    },
  ];
}

function uniquePayloadValidationSubjectRefs(
  validationFailure: NonNullable<RepairPolicyRefs['validationFailure']>,
  refs: RepairPolicyRefs,
) {
  return [...new Set([
    ...relatedRefsFromRepairRefs(refs),
    ...validationFailure.relatedRefs,
    validationFailure.contractId,
    validationFailure.schemaPath,
  ].filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0))];
}

function firstPayloadExecutionUnitId(payload: ToolPayload) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    const id = stringField(unit.id);
    if (id) return id;
  }
  return undefined;
}

function attachBudgetDebitRefs(record: Record<string, unknown>, refs: string[]) {
  return {
    ...record,
    budgetDebitRefs: [...new Set([
      ...stringList(record.budgetDebitRefs),
      ...refs,
    ])],
    refs: {
      ...(isRecord(record.refs) ? record.refs : {}),
      budgetDebits: [...new Set([
        ...stringList(isRecord(record.refs) ? record.refs.budgetDebits : undefined),
        ...refs,
      ])],
    },
  };
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function validationSubjectKindForRepairRefs(refs: RepairPolicyRefs) {
  return typeof refs.taskRel === 'string' && refs.taskRel.startsWith('agentserver://')
    ? 'direct-payload'
    : 'generated-task-result';
}

function validationSubjectIdForRepairRefs(skill: SkillAvailability, refs: RepairPolicyRefs) {
  return refs.outputRel
    ? `payload:${refs.outputRel}`
    : `payload:${skill.id}`;
}

function generatedTaskRefForRepairRefs(refs: RepairPolicyRefs) {
  return typeof refs.taskRel === 'string' && !refs.taskRel.startsWith('agentserver://')
    ? refs.taskRel
    : undefined;
}

function summarizeActualContractShape(value: unknown) {
  if (!isRecord(value)) return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, fieldValue]) => [key, Array.isArray(fieldValue) ? 'array' : typeof fieldValue]));
}

function currentReferenceUsageFailures(
  payload: ToolPayload,
  artifacts: Array<Record<string, unknown>>,
  request: GatewayRequest,
) {
  const references = currentTurnReferenceRecords(request).filter(shouldRequireCurrentReferenceUse);
  if (!references.length) return [];
  const structuredRefs = payloadStructuredReferenceSet(payload, artifacts);
  const haystack = payloadReferenceUseHaystack(payload, artifacts);
  return references
    .filter((reference) =>
      !referenceStructuredRefVariants(reference).some((token) => structuredRefs.has(token))
      && !referenceTokens(reference).some((token) => containsMeaningfulReferenceToken(haystack, token)))
    .map((reference) => `Current-turn reference was not reflected in answer/artifacts: ${stringField(reference.ref) ?? stringField(reference.title) ?? 'unknown-ref'}`);
}

function referenceValidationFailureFromFailures(
  failures: string[],
  request: GatewayRequest,
  skill: SkillAvailability,
  refs: RepairPolicyRefs,
) {
  return failures.length
    ? contractValidationFailureFromErrors(failures, {
      capabilityId: skill.id,
      failureKind: 'reference',
      schemaPath: 'src/runtime/gateway/payload-validation.ts#currentReferenceUsageFailures',
      contractId: 'sciforge.current-reference-usage.v1',
      expected: 'Payload message, claims, or artifacts reflect each required current-turn reference',
      actual: 'One or more required current-turn references were absent from payload text/artifacts',
      relatedRefs: [
        ...relatedRefsFromRepairRefs(refs),
        ...currentTurnReferenceRecords(request).map((reference) => stringField(reference.ref)).filter((ref): ref is string => Boolean(ref)),
      ],
    })
    : undefined;
}

function referenceFailureExecutionUnits(
  failures: string[],
  validationFailure: ReturnType<typeof referenceValidationFailureFromFailures>,
) {
  return failures.map((failure, index) => ({
    id: `current-reference-usage-${index + 1}`,
    status: 'failed-with-reason',
    tool: CURRENT_REFERENCE_GATE_TOOL_ID,
    failureReason: failure,
    recoverActions: [
      'Read the current-turn reference by ref/path/dataRef.',
      'Regenerate the final answer/artifacts from that reference, or report the ref as unreadable with nextStep.',
    ],
    refs: validationFailure ? { validationFailure } : undefined,
  }));
}

function completedPayloadContractFailures(
  payload: ToolPayload,
  artifacts: Array<Record<string, unknown>>,
  refs: RepairPolicyRefs,
) {
  if (payloadHasExplicitFailureStatus(payload)) return [];
  if (!looksLikePlanPromise(payload.message)) return [];
  if (hasStableDeliverableRef(payload, refs)) return [];
  if (hasMeaningfulDeliveredText(payload, artifacts)) return [];
  return ['Completed payload contains only plan/promise text and no final answer text, meaningful artifact data, or stable artifact/ref.'];
}

function payloadHasExplicitFailureStatus(payload: ToolPayload) {
  if (/failed|error|repair-needed|needs-human/i.test(String(payload.claimType || ''))) return true;
  return (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && /failed|error|repair-needed|needs-human/i.test(String(unit.status || '')));
}

function hasStableDeliverableRef(payload: ToolPayload, refs: RepairPolicyRefs) {
  const runtimeRefs = new Set(relatedRefsFromRepairRefs(refs));
  const candidates: string[] = [];
  for (const artifact of Array.isArray(payload.artifacts) ? payload.artifacts : []) {
    if (!isRecord(artifact)) continue;
    candidates.push(...stringFields(
      artifact.dataRef,
      artifact.data_ref,
      artifact.path,
      artifact.ref,
      artifact.url,
      artifact.rawRef,
      artifact.raw_ref,
    ));
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    candidates.push(...stringFields(
      metadata.artifactRef,
      metadata.reportRef,
      metadata.markdownRef,
      metadata.rawRef,
      metadata.sourceRef,
    ));
  }
  for (const claim of Array.isArray(payload.claims) ? payload.claims : []) {
    if (!isRecord(claim)) continue;
    for (const key of ['supportingRefs', 'evidenceRefs', 'sourceRefs', 'references']) {
      const value = claim[key];
      if (Array.isArray(value)) candidates.push(...value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0));
    }
  }
  return candidates.some((candidate) => {
    const ref = candidate.trim();
    if (!ref || runtimeRefs.has(ref)) return false;
    return /^(?:file|artifact|run|url|http|https):/i.test(ref)
      || /^\.sciforge\/(?:artifacts|task-results|uploads)\//.test(ref)
      || /^\.sciforge\/sessions\/[^/]+\/(?:artifacts|task-results|data|exports)\//.test(ref)
      || hasStableDeliverablePathSuffix(ref);
  });
}

function hasMeaningfulDeliveredText(payload: ToolPayload, artifacts: Array<Record<string, unknown>>) {
  const texts = [
    ...payload.claims.flatMap((claim) => isRecord(claim) ? [claim.text, claim.claim, claim.summary] : [String(claim)]),
    ...artifacts.flatMap(artifactDeliverableTexts),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return texts.some((text) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length >= 40 && !looksLikePlanPromise(normalized);
  });
}

function artifactDeliverableTexts(artifact: Record<string, unknown>) {
  const data = isRecord(artifact.data) ? artifact.data : {};
  return [
    data.markdown,
    data.report,
    data.content,
    data.summary,
    data.text,
    artifact.markdown,
    artifact.report,
    artifact.content,
    typeof artifact.data === 'string' ? artifact.data : undefined,
  ];
}

function looksLikePlanPromise(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return false;
  return /^(?:i(?:['’]ll|\s+(?:will|would|can|am going to|plan to|intend to|need to|shall))|we(?:['’]ll|\s+(?:will|would|can|are going to|plan to|intend to|need to|shall)))\s+(?:retrieve|fetch|search|look\s+up|analy[sz]e|investigate|review|read|compare|summari[sz]e|generate|create|build|run|perform|collect|download|query|parse|extract|write|prepare)\b/i.test(text)
    || /^(?:我(?:将|会|来|需要|可以)|接下来我(?:会|将)|下一步(?:我)?(?:会|将))\s*(?:检索|搜索|分析|调研|读取|查看|比较|总结|生成|创建|运行|下载|查询|提取|撰写|准备)/.test(text);
}

function stringFields(...values: unknown[]) {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function hasStableDeliverablePathSuffix(value: string) {
  return previewPathHasStableDeliverableExtension(value);
}

function currentTurnReferenceRecords(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const refs = Array.isArray(uiState.currentReferences) ? uiState.currentReferences.filter(isRecord) : [];
  return refs.slice(0, 8);
}

function shouldRequireCurrentReferenceUse(reference: Record<string, unknown>) {
  const kind = String(reference.kind || '').toLowerCase();
  if (kind === 'ui') {
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const selectedText = typeof payload.selectedText === 'string' ? payload.selectedText.trim() : '';
    const textRange = isRecord(reference.locator) && typeof reference.locator.textRange === 'string' ? reference.locator.textRange.trim() : '';
    return selectedText.length >= 12 || textRange.length >= 12 || /^ui-text:/i.test(String(reference.ref || ''));
  }
  return true;
}

function payloadReferenceUseHaystack(payload: ToolPayload, artifacts: Array<Record<string, unknown>>) {
  const values = [
    payload.message,
    payload.reasoningTrace,
    ...payload.claims.flatMap((claim) => isRecord(claim) ? [
      claim.text,
      claim.claim,
      claim.summary,
      Array.isArray(claim.supportingRefs) ? claim.supportingRefs.join(' ') : undefined,
      Array.isArray(claim.opposingRefs) ? claim.opposingRefs.join(' ') : undefined,
      Array.isArray(claim.evidenceRefs) ? claim.evidenceRefs.join(' ') : undefined,
      Array.isArray(claim.sourceRefs) ? claim.sourceRefs.join(' ') : undefined,
      Array.isArray(claim.references) ? claim.references.join(' ') : undefined,
    ] : [String(claim)]),
    ...artifacts.flatMap((artifact) => [
      artifact.id,
      artifact.type,
      artifact.path,
      artifact.dataRef,
      artifact.contentRef,
      JSON.stringify(isRecord(artifact.metadata) ? artifact.metadata : {}),
      compactArtifactDataForReferenceUse(artifact.data),
    ]),
  ];
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n').toLowerCase();
}

function compactArtifactDataForReferenceUse(data: unknown) {
  if (typeof data === 'string') return data.slice(0, 8000);
  if (!isRecord(data)) return '';
  const values: string[] = [];
  for (const key of ['markdown', 'report', 'content', 'summary', 'text', 'title']) {
    if (typeof data[key] === 'string') values.push(String(data[key]).slice(0, 8000));
  }
  if (Array.isArray(data.sections)) {
    values.push(...data.sections.slice(0, 12).flatMap((section) => isRecord(section)
      ? [String(section.title || ''), String(section.content || section.markdown || '')]
      : []));
  }
  return values.join('\n');
}

function referenceTokens(reference: Record<string, unknown>) {
  const kind = String(reference.kind || '').toLowerCase();
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const locator = isRecord(reference.locator) ? reference.locator : {};
  const identityTokens = [
    reference.ref,
    reference.title,
    reference.sourceId,
  ];
  const evidenceTokens = kind === 'ui' ? [
    reference.summary,
    typeof payload.selectedText === 'string' ? payload.selectedText : undefined,
    typeof payload.sourceTitle === 'string' ? payload.sourceTitle : undefined,
    typeof locator.textRange === 'string' ? locator.textRange : undefined,
  ] : [];
  return [...identityTokens, ...evidenceTokens]
    .filter((token): token is string => typeof token === 'string' && token.trim().length > 0);
}

function containsMeaningfulReferenceToken(haystack: string, token: string) {
  const normalized = token.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;
  if (haystack.includes(normalized)) return true;
  if (looksLikeReferencePath(normalized)) {
    const basename = normalized.replace(/^file:/, '').split(/[\\/]/).filter(Boolean).pop();
    return fileNameReflectionTokens(basename).some((candidate) => haystack.includes(candidate));
  }
  if (normalized.length > 48 && haystack.includes(normalized.slice(0, 48))) return true;
  const words = normalized.match(/[\p{L}\p{N}_-]{4,}/gu) ?? [];
  return words.slice(0, 8).some((word) => haystack.includes(word));
}

function fileNameReflectionTokens(basename: string | undefined) {
  if (!basename) return [];
  const decoded = decodeURIComponentSafe(basename).toLowerCase();
  const withoutQuery = decoded.split(/[?#]/)[0] ?? decoded;
  const stem = withoutQuery.replace(/\.[a-z0-9]{1,12}$/i, '');
  const suffixStem = stem.split('-').filter(Boolean).pop() ?? '';
  return [withoutQuery, stem, suffixStem]
    .map((token) => token.trim())
    .filter((token, index, tokens) => token.length >= 4 && tokens.indexOf(token) === index);
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeReferencePath(value: string) {
  return /^(?:file|artifact|folder|url):/i.test(value)
    || /[\\/]/.test(value)
    || /\.[a-z0-9]{2,12}(?:[?#].*)?$/i.test(value);
}

function payloadStructuredReferenceSet(payload: ToolPayload, artifacts: Array<Record<string, unknown>>) {
  const refs = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    for (const variant of normalizedRefVariants(value)) refs.add(variant);
  };
  for (const claim of payload.claims) {
    if (!isRecord(claim)) continue;
    for (const key of ['supportingRefs', 'opposingRefs', 'evidenceRefs', 'sourceRefs', 'references']) {
      for (const ref of stringList(claim[key])) add(ref);
    }
  }
  for (const reference of toRecordList(payload.objectReferences)) {
    add(reference.ref);
    add(reference.sourceRef);
  }
  for (const unit of toRecordList(payload.executionUnits)) {
    for (const key of ['codeRef', 'stdoutRef', 'stderrRef', 'outputRef', 'diffRef', 'verificationRef', 'traceRef']) {
      add(unit[key]);
    }
  }
  for (const slot of toRecordList(payload.uiManifest)) add(slot.artifactRef);
  for (const artifact of artifacts) {
    add(artifact.ref);
    add(artifact.path);
    add(artifact.dataRef);
    add(artifact.contentRef);
    const id = stringField(artifact.id);
    if (id) {
      add(id);
      add(`artifact:${id}`);
    }
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    for (const key of ['ref', 'path', 'dataRef', 'reportRef', 'markdownRef', 'outputRef', 'sourceRef', 'providerRecordRef']) {
      add(metadata[key]);
    }
    for (const key of ['sourceRefs', 'evidenceRefs', 'supportingRefs']) {
      for (const ref of stringList(metadata[key])) add(ref);
    }
  }
  return refs;
}

function referenceStructuredRefVariants(reference: Record<string, unknown>) {
  return [
    ...normalizedRefVariants(reference.ref),
    ...normalizedRefVariants(reference.sourceId),
  ];
}

function normalizedRefVariants(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const raw = value.trim();
  const withoutFile = raw.replace(/^file:/i, '');
  const withoutArtifact = raw.replace(/^artifact:/i, '');
  return Array.from(new Set([
    raw,
    raw.toLowerCase(),
    withoutFile,
    withoutFile.toLowerCase(),
    withoutArtifact,
    withoutArtifact.toLowerCase(),
    raw.startsWith('artifact:') ? withoutArtifact : `artifact:${raw}`,
    raw.startsWith('file:') ? withoutFile : `file:${raw}`,
  ].filter((entry) => entry.trim().length > 0)));
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
): ToolPayload {
  const validationFailure = refs.validationFailure ?? contractValidationFailureFromRepairReason(reason, {
    capabilityId: skill.id,
    relatedRefs: relatedRefsFromRepairRefs(refs),
  });
  const repairRefs = validationFailure
    ? {
      ...refs,
      recoverActions: refs.recoverActions ?? validationFailure.recoverActions,
      validationFailure,
    }
    : refs;
  return attachResultPresentationContract(
    buildRepairNeededPayload(request, skill, reason, repairRefs, attemptPlanRefsBuilder(request, skill, reason)),
    { request, skill, refs: repairRefs },
  );
}

export function agentServerGenerationFailureReason(error: string, diagnostics?: AgentServerGenerationFailureDiagnostics) {
  if (diagnostics?.kind !== 'contextWindowExceeded') return error;
  const parts = [
    'blocker=contextWindowExceeded: AgentServer/backend exceeded its context window during task generation.',
    `failureReason=${error}`,
    diagnostics.backend ? `backend=${diagnostics.backend}` : undefined,
    diagnostics.provider ? `provider=${diagnostics.provider}` : undefined,
    diagnostics.agentId ? `session=${diagnostics.agentId}` : undefined,
    diagnostics.originalErrorSummary ? `originalError=${diagnostics.originalErrorSummary}` : undefined,
    diagnostics.compaction ? `compact=${diagnostics.compaction.ok ? 'ok' : 'failed'}:${diagnostics.compaction.strategy}:${diagnostics.compaction.message || diagnostics.compaction.reason}` : 'compact=not-run',
    diagnostics.retryAttempted ? 'retry=attempted-once' : 'retry=not-attempted',
    diagnostics.retrySucceeded === false ? 'retryResult=failed' : undefined,
  ];
  return parts.filter(Boolean).join(' | ');
}

export function agentServerFailurePayloadRefs(diagnostics?: AgentServerGenerationFailureDiagnostics): Partial<{
  blocker: string;
  agentServerRefs: Record<string, unknown>;
  recoverActions: string[];
}> {
  if (!diagnostics) return {};
  const refs = {
    blocker: diagnostics.kind,
    agentServerRefs: {
      backend: diagnostics.backend,
      provider: diagnostics.provider,
      model: diagnostics.model,
      agentId: diagnostics.agentId,
      sessionRef: diagnostics.sessionRef,
      originalErrorSummary: diagnostics.originalErrorSummary,
      harnessSignals: diagnostics.harnessSignals,
      contextCompaction: diagnostics.compaction ? contextCompactionMetadata(diagnostics.compaction) : undefined,
      compactResult: diagnostics.compaction,
      retryAttempted: diagnostics.retryAttempted,
      retrySucceeded: diagnostics.retrySucceeded,
    },
  };
  return diagnostics.kind === 'contextWindowExceeded'
    ? {
      ...refs,
      recoverActions: [
        'Inspect AgentServer/backend context compaction diagnostics in refs.contextCompaction.',
        'Retry after reducing artifacts, priorAttempts, logs, or selected UI state passed into this turn.',
        'Use a backend/model with a larger context window if compaction keeps failing.',
      ],
    }
    : refs;
}

export function failedTaskPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  run: Awaited<ReturnType<typeof runWorkspaceTask>>,
  parseReason?: string,
  refs: Partial<RepairPolicyRefs> = {},
): ToolPayload {
  return repairNeededPayload(
    request,
    skill,
    parseReason ? `Task exited ${run.exitCode} and output could not be parsed: ${parseReason}` : `Task exited ${run.exitCode}: ${run.stderr || 'no stderr'}`,
    {
      taskRel: run.spec.taskRel,
      outputRel: run.outputRef,
      stdoutRel: run.stdoutRef,
      stderrRel: run.stderrRef,
      ...refs,
    },
  );
}

export { toolPayloadSchemaErrors as schemaErrors };
