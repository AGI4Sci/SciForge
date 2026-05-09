import { resolve } from 'node:path';
import {
  CURRENT_REFERENCE_GATE_TOOL_ID,
  VERIFICATION_RESULT_CONTRACT_ID,
  VERIFICATION_RESULT_SCHEMA_PATH,
} from '@sciforge-ui/runtime-contract';
import {
  CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
  type ContractValidationFailure,
  type ContractValidationFailureKind,
  type ContractValidationIssue,
} from '@sciforge-ui/runtime-contract/validation-failure';
import {
  WORK_EVIDENCE_POLICY_CONTRACT_ID,
  WORK_EVIDENCE_POLICY_SCHEMA_PATH,
} from '@sciforge-ui/runtime-contract/work-evidence-policy';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { runWorkspaceTask } from '../workspace-task-runner.js';
import { composeRuntimeUiManifest } from '../runtime-ui-manifest.js';
import { isRecord } from '../gateway-utils.js';
import { repairNeededPayload as buildRepairNeededPayload, type RepairPolicyRefs } from './repair-policy.js';
import { contextCompactionMetadata } from './agentserver-context-window.js';
import { normalizeArtifactsForPayload, persistArtifactRefsForPayload } from './artifact-materializer.js';
import { schemaErrors as toolPayloadSchemaErrors } from './tool-payload-contract.js';
import { normalizeToolPayloadShape } from './direct-answer-payload.js';

type AttemptPlanRefsBuilder = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;
let attemptPlanRefsBuilder: AttemptPlanRefsBuilder = () => ({});

export function configurePayloadValidationContext(builder: AttemptPlanRefsBuilder) {
  attemptPlanRefsBuilder = builder;
}

type AgentServerGenerationFailureDiagnostics = {
  kind: 'contextWindowExceeded' | 'rateLimit' | 'agentserver';
  backend?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  sessionRef?: string;
  originalErrorSummary: string;
  compaction?: Parameters<typeof contextCompactionMetadata>[0];
  retryAttempted?: boolean;
  retrySucceeded?: boolean;
};

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
  const contractPayload = normalizeToolPayloadShape(payload);
  const errors = toolPayloadSchemaErrors(contractPayload);
  if (errors.length) {
    const validationScope = validationScopeForSchemaErrors(errors);
    const validationFailure = contractValidationFailureFromErrors(errors, {
      capabilityId: skill.id,
      failureKind: validationScope.failureKind,
      schemaPath: validationScope.schemaPath,
      contractId: validationScope.contractId,
      expected: validationScope.expected,
      actual: summarizeActualContractShape(contractPayload),
      relatedRefs: relatedRefsFromRepairRefs(refs),
    });
    return repairNeededPayload(request, skill, validationFailure.failureReason, {
      ...refs,
      recoverActions: validationFailure.recoverActions,
      validationFailure,
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
    return repairNeededPayload(request, skill, validationFailure.failureReason, {
      ...refs,
      recoverActions: validationFailure.recoverActions,
      validationFailure,
    });
  }
  const referenceFailures = currentReferenceUsageFailures(contractPayload, persistedArtifacts, request);
  const referenceValidationFailure = referenceFailures.length
    ? contractValidationFailureFromErrors(referenceFailures, {
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
  const referenceFailureUnits = referenceFailures.map((failure, index) => ({
    id: `current-reference-usage-${index + 1}`,
    status: 'failed-with-reason',
    tool: CURRENT_REFERENCE_GATE_TOOL_ID,
    failureReason: failure,
    recoverActions: [
      'Read the current-turn reference by ref/path/dataRef.',
      'Regenerate the final answer/artifacts from that reference, or report the ref as unreadable with nextStep.',
    ],
    refs: referenceValidationFailure ? { validationFailure: referenceValidationFailure } : undefined,
  }));
  return {
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
    uiManifest: composeRuntimeUiManifest(
      Array.isArray(contractPayload.uiManifest) ? contractPayload.uiManifest : [],
      Array.isArray(contractPayload.artifacts) ? contractPayload.artifacts : [],
      request,
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
  };
}

export interface ContractValidationFailureOptions {
  capabilityId: string;
  failureKind: ContractValidationFailureKind;
  schemaPath: string;
  contractId: string;
  expected?: unknown;
  actual?: unknown;
  relatedRefs?: string[];
  recoverActions?: string[];
  nextStep?: string;
}

export function contractValidationFailureFromErrors(
  errors: string[],
  options: ContractValidationFailureOptions,
): ContractValidationFailure {
  const issues = errors.map(contractValidationIssueFromError);
  const missingFields = uniqueStrings(issues.map((issue) => issue.missingField));
  const invalidRefs = uniqueStrings(issues.map((issue) => issue.invalidRef));
  const unresolvedUris = uniqueStrings(issues.map((issue) => issue.unresolvedUri));
  const recoverActions = options.recoverActions ?? recoverActionsForValidationFailure(options.failureKind);
  return {
    contract: CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
    schemaPath: options.schemaPath,
    contractId: options.contractId,
    capabilityId: options.capabilityId,
    failureKind: options.failureKind,
    expected: options.expected,
    actual: options.actual,
    missingFields,
    invalidRefs,
    unresolvedUris,
    failureReason: `Contract validation failed (${options.contractId}): ${errors.join('; ')}`,
    recoverActions,
    nextStep: options.nextStep ?? nextStepForValidationFailure(options.failureKind),
    relatedRefs: uniqueStrings(options.relatedRefs ?? []),
    issues,
    createdAt: new Date().toISOString(),
  };
}

function contractValidationIssueFromError(error: string): ContractValidationIssue {
  const missingMatch = error.match(/^missing\s+(.+)$/i);
  const nonEmptyStringMatch = error.match(/^([A-Za-z0-9_.[\]-]+) must be a non-empty string/i);
  const bracketPathMatch = error.match(/^([A-Za-z0-9_.[\]-]+)\s+/);
  const invalidRefMatch = error.match(/(?:invalid|unresolved|missing|unreadable)[^:]*ref(?:erence)?[^:]*:\s*([^;]+)/i);
  const currentRefMatch = error.match(/Current-turn reference was not reflected in answer\/artifacts:\s*([^;]+)/i);
  const unresolvedUriMatch = error.match(/unresolved\s+(?:uri|url):\s*([^;]+)/i);
  const guardIssue = runtimeGuardIssueForError(error);
  const missingField = missingMatch ? String(missingMatch[1]) : nonEmptyStringMatch?.[1];
  return {
    path: missingField ?? guardIssue?.path ?? bracketPathMatch?.[1] ?? '$',
    message: error,
    expected: missingMatch ? 'present' : nonEmptyStringMatch ? 'non-empty string' : guardIssue?.expected,
    actual: missingMatch ? 'missing' : nonEmptyStringMatch ? 'missing or empty' : guardIssue?.actual,
    missingField,
    invalidRef: (invalidRefMatch?.[1] ?? currentRefMatch?.[1])?.trim(),
    unresolvedUri: unresolvedUriMatch?.[1]?.trim(),
  };
}

function runtimeGuardIssueForError(error: string): Pick<ContractValidationIssue, 'path' | 'expected' | 'actual'> | undefined {
  if (/verified but has no evidenceRefs|WorkEvidence evidence references/i.test(error)) {
    return {
      path: 'claims[].evidenceRefs',
      expected: 'verified claims include evidenceRefs/rawRef or WorkEvidence refs',
      actual: 'verified claim without evidence refs',
    };
  }
  if (/non-zero exitCode/i.test(error)) {
    return {
      path: 'executionUnits[].exitCode',
      expected: 'non-zero command exitCode is paired with failed/repair-needed status',
      actual: 'successful payload reported a non-zero exitCode',
    };
  }
  if (/fetch timeout|HTTP 429|rate-limit/i.test(error)) {
    return {
      path: 'workEvidence[].status',
      expected: 'provider failure is represented as failed/repair-needed with recovery evidence',
      actual: 'provider failure was swallowed by a successful payload',
    };
  }
  if (/External I\/O WorkEvidence|durable evidenceRefs|rawRef/i.test(error)) {
    return {
      path: 'workEvidence[].evidenceRefs',
      expected: 'external I/O evidence has durable evidenceRefs or rawRef',
      actual: 'external I/O evidence lacks durable refs',
    };
  }
  if (/uiManifest references an artifact/i.test(error)) {
    return {
      path: 'artifacts[].dataRef',
      expected: 'referenced artifacts include dataRef or schema contract',
      actual: 'referenced artifact lacks dataRef/schema',
    };
  }
  if (/External retrieval returned zero results/i.test(error)) {
    return {
      path: 'workEvidence[].diagnostics',
      expected: 'zero-result external retrieval includes external service status, query/url, retry diagnostics, or failed status',
      actual: 'zero-result external retrieval was reported as completed without diagnostics',
    };
  }
  if (/only plan\/promise text|no final answer text|stable artifact\/ref/i.test(error)) {
    return {
      path: 'message',
      expected: 'completed payload includes final answer text, artifact data, or stable artifact/dataRef',
      actual: 'completed payload only promised future work',
    };
  }
  if (/verifier|verification gate|human approval|needs-human/i.test(error)) {
    return {
      path: 'verificationResults[]',
      expected: 'passing verifier result or explicit human approval',
      actual: 'verification failed, missing, or requires human approval',
    };
  }
  return undefined;
}

function recoverActionsForValidationFailure(kind: ContractValidationFailureKind) {
  if (kind === 'reference') {
    return [
      'Resolve each invalid or missing reference from relatedRefs.',
      'Regenerate the payload so message, claims, artifacts, and refs agree.',
    ];
  }
  if (kind === 'artifact-schema') {
    return [
      'Regenerate artifacts with required id, type, schemaVersion, and data/dataRef fields.',
      'Keep artifact refs stable and point them at materialized workspace outputs.',
    ];
  }
  if (kind === 'ui-manifest') {
    return [
      'Regenerate uiManifest as an array of component slots with non-empty componentId values.',
      'Bind each artifactRef to an artifact id/type that exists in artifacts.',
    ];
  }
  if (kind === 'work-evidence') {
    return [
      'Regenerate the payload so WorkEvidence, claims, execution unit status, and durable refs agree.',
      'Attach evidenceRefs/rawRef or return repair-needed/failed-with-reason with backend diagnostics.',
    ];
  }
  if (kind === 'verifier') {
    return [
      'Attach a passing verifier result or explicit human approval before reporting completion.',
      'Preserve verifier evidenceRefs and repairHints so the next run can continue from the failed check.',
    ];
  }
  return [
    'Regenerate the runtime payload with all required contract fields.',
    'Return valid JSON that satisfies the contract before reporting success.',
  ];
}

function nextStepForValidationFailure(kind: ContractValidationFailureKind) {
  if (kind === 'reference') return 'Repair invalid refs or explicitly report the referenced input as unreadable, then rerun validation.';
  if (kind === 'artifact-schema') return 'Repair artifact ids/types/data refs and rerun validation.';
  if (kind === 'ui-manifest') return 'Repair display manifest slots and bindings, then rerun validation.';
  if (kind === 'work-evidence') return 'Repair WorkEvidence/status/ref consistency and rerun validation.';
  if (kind === 'verifier') return 'Run the selected verifier or collect human approval, then rerun validation.';
  return 'Repair the structured payload contract and rerun validation.';
}

function relatedRefsFromRepairRefs(refs: RepairPolicyRefs) {
  return [refs.taskRel, refs.outputRel, refs.stdoutRel, refs.stderrRel].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function validationScopeForSchemaErrors(errors: string[]): Required<Pick<ContractValidationFailureOptions, 'failureKind' | 'schemaPath' | 'contractId' | 'expected'>> {
  if (errors.every((error) => error.startsWith('artifacts['))) {
    return {
      failureKind: 'artifact-schema',
      schemaPath: 'src/runtime/gateway/tool-payload-contract.ts#artifacts',
      contractId: 'sciforge.artifact.v1',
      expected: 'Artifacts with non-empty id and type fields, plus stable schema/data refs when materialized',
    };
  }
  if (errors.every((error) => error.startsWith('uiManifest['))) {
    return {
      failureKind: 'ui-manifest',
      schemaPath: 'src/runtime/gateway/tool-payload-contract.ts#uiManifest',
      contractId: 'sciforge.ui-manifest.v1',
      expected: 'UIManifest array slots with non-empty componentId and string artifactRef values',
    };
  }
  return {
    failureKind: 'payload-schema',
    schemaPath: 'src/runtime/gateway/tool-payload-contract.ts',
    contractId: 'sciforge.tool-payload.v1',
    expected: 'ToolPayload with message, claims, uiManifest, executionUnits, and artifacts',
  };
}

export function contractValidationFailureFromRepairReason(
  reason: string,
  options: {
    capabilityId: string;
    refs?: RepairPolicyRefs;
  },
): ContractValidationFailure | undefined {
  const scope = validationScopeForRepairReason(reason);
  if (!scope) return undefined;
  return contractValidationFailureFromErrors([reason], {
    capabilityId: options.capabilityId,
    failureKind: scope.failureKind,
    schemaPath: scope.schemaPath,
    contractId: scope.contractId,
    expected: scope.expected,
    actual: scope.actual,
    relatedRefs: relatedRefsFromRepairRefs(options.refs ?? {}),
  });
}

function validationScopeForRepairReason(reason: string): (Required<Pick<ContractValidationFailureOptions, 'failureKind' | 'schemaPath' | 'contractId' | 'expected'>> & { actual: unknown }) | undefined {
  if (isWorkEvidenceContractReason(reason)) {
    return {
      failureKind: 'work-evidence',
      schemaPath: WORK_EVIDENCE_POLICY_SCHEMA_PATH,
      contractId: WORK_EVIDENCE_POLICY_CONTRACT_ID,
      expected: 'Claims, executionUnits, artifacts, and WorkEvidence expose durable evidence refs or honest failed/repair-needed status',
      actual: reason,
    };
  }
  if (isVerifierContractReason(reason)) {
    return {
      failureKind: 'verifier',
      schemaPath: VERIFICATION_RESULT_SCHEMA_PATH,
      contractId: VERIFICATION_RESULT_CONTRACT_ID,
      expected: 'Required verifier path supplies a passing verifier result or explicit human approval before completion',
      actual: reason,
    };
  }
  return undefined;
}

function isWorkEvidenceContractReason(reason: string) {
  return /WorkEvidence|verified but has no evidenceRefs|non-zero exitCode|fetch timeout|HTTP 429|rate-limit signal|External retrieval returned zero results|uiManifest references an artifact that is missing both a dataRef and a schema contract/i.test(reason);
}

function isVerifierContractReason(reason: string) {
  return /verifier|verification gate|Verification gate|passing verifier result|human approval|needs-human/i.test(reason)
    && /fail|failed|blocked|required|did not receive|no verifier|approval/i.test(reason);
}

function summarizeActualContractShape(value: unknown) {
  if (!isRecord(value)) return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, fieldValue]) => [key, Array.isArray(fieldValue) ? 'array' : typeof fieldValue]));
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function currentReferenceUsageFailures(
  payload: ToolPayload,
  artifacts: Array<Record<string, unknown>>,
  request: GatewayRequest,
) {
  const references = currentTurnReferenceRecords(request).filter(shouldRequireCurrentReferenceUse);
  if (!references.length) return [];
  const haystack = payloadReferenceUseHaystack(payload, artifacts);
  return references
    .filter((reference) => !referenceTokens(reference).some((token) => containsMeaningfulReferenceToken(haystack, token)))
    .map((reference) => `Current-turn reference was not reflected in answer/artifacts: ${stringField(reference.ref) ?? stringField(reference.title) ?? 'unknown-ref'}`);
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

const stableDeliverablePathSuffixes = [
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.tsv',
  '.txt',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.html',
  '.htm',
];

function hasStableDeliverablePathSuffix(value: string) {
  const pathWithoutQuery = value.toLowerCase().split(/[?#]/)[0] ?? '';
  return stableDeliverablePathSuffixes.some((suffix) => pathWithoutQuery.endsWith(suffix));
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
      Array.isArray(claim.supportingRefs) ? claim.supportingRefs.join(' ') : undefined,
      Array.isArray(claim.opposingRefs) ? claim.opposingRefs.join(' ') : undefined,
    ] : [String(claim)]),
    ...artifacts.flatMap((artifact) => [
      artifact.id,
      artifact.type,
      artifact.path,
      artifact.dataRef,
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
    || /\.(?:pdf|docx?|xlsx?|csv|tsv|json|md|markdown|txt|png|jpe?g|gif|webp|svg|html?|pdb|cif|mmcif)$/i.test(value);
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
): ToolPayload {
  const validationFailure = refs.validationFailure ?? contractValidationFailureFromRepairReason(reason, {
    capabilityId: skill.id,
    refs,
  });
  const repairRefs = validationFailure
    ? {
      ...refs,
      recoverActions: refs.recoverActions ?? validationFailure.recoverActions,
      validationFailure,
    }
    : refs;
  return buildRepairNeededPayload(request, skill, reason, repairRefs, attemptPlanRefsBuilder(request, skill, reason));
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
    },
  );
}

export { toolPayloadSchemaErrors as schemaErrors };
