import { resolve } from 'node:path';
import {
  CONTRACT_VALIDATION_FAILURE_CONTRACT_ID,
  type ContractValidationFailure,
  type ContractValidationFailureKind,
  type ContractValidationIssue,
} from '@sciforge-ui/runtime-contract/validation-failure';
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
    const validationFailure = contractValidationFailureFromErrors(errors, {
      capabilityId: skill.id,
      failureKind: 'payload-schema',
      schemaPath: 'src/runtime/gateway/tool-payload-contract.ts',
      contractId: 'sciforge.tool-payload.v1',
      expected: 'ToolPayload with message, claims, uiManifest, executionUnits, and artifacts',
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
    tool: 'sciforge.current-reference-gate',
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
  const bracketPathMatch = error.match(/^([A-Za-z0-9_.[\]-]+)\s+/);
  const invalidRefMatch = error.match(/(?:invalid|unresolved|missing|unreadable)[^:]*ref(?:erence)?[^:]*:\s*([^;]+)/i);
  const currentRefMatch = error.match(/Current-turn reference was not reflected in answer\/artifacts:\s*([^;]+)/i);
  const unresolvedUriMatch = error.match(/unresolved\s+(?:uri|url):\s*([^;]+)/i);
  return {
    path: missingMatch ? String(missingMatch[1]) : bracketPathMatch?.[1] ?? '$',
    message: error,
    expected: missingMatch ? 'present' : undefined,
    actual: missingMatch ? 'missing' : undefined,
    missingField: missingMatch ? String(missingMatch[1]) : undefined,
    invalidRef: (invalidRefMatch?.[1] ?? currentRefMatch?.[1])?.trim(),
    unresolvedUri: unresolvedUriMatch?.[1]?.trim(),
  };
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
  return [
    'Regenerate the runtime payload with all required contract fields.',
    'Return valid JSON that satisfies the contract before reporting success.',
  ];
}

function nextStepForValidationFailure(kind: ContractValidationFailureKind) {
  if (kind === 'reference') return 'Repair invalid refs or explicitly report the referenced input as unreadable, then rerun validation.';
  return 'Repair the structured payload contract and rerun validation.';
}

function relatedRefsFromRepairRefs(refs: RepairPolicyRefs) {
  return [refs.taskRel, refs.outputRel, refs.stdoutRel, refs.stderrRel].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
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
  return buildRepairNeededPayload(request, skill, reason, refs, attemptPlanRefsBuilder(request, skill, reason));
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
