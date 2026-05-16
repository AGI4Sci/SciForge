import type { GatewayRequest, SkillAvailability, WorkspaceTaskRunResult } from '../runtime-types.js';
import { extractAgentServerCurrentUserRequest } from '@sciforge-ui/runtime-contract/agentserver-prompt-policy';
import { agentServerToolPayloadProtocolContractLines } from '@sciforge-ui/runtime-contract/artifact-policy';
import { agentServerExternalIoReliabilityContractLines, agentServerRepairPromptPolicyLines, agentServerToolPayloadShapeContract, agentServerWorkspaceTaskRepairPromptPolicyLines } from '../../../packages/skills/runtime-policy';
import { minimalValidInteractiveToolPayloadExample } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';
import { summarizeArtifactRefs, summarizeExecutionRefs, summarizeTaskAttemptsForAgentServer } from './context-envelope.js';
import { clipForAgentServerPrompt, extractLikelyErrorLine, isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';
import { ignoredLegacyRepairContextPolicyAuditForAgentServer, repairContextPolicySummaryForAgentServer } from './agentserver-repair-context-policy.js';
import { sanitizePromptHandoffValue } from './agentserver-generation-prompts.js';
import { summarizeUiStateForAgentServer } from './agentserver-context-summary.js';

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function buildCompactRepairContext(params: {
  request: GatewayRequest;
  workspace: string;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
}) {
  const inputRel = `.sciforge/task-inputs/${params.run.spec.id}.json`;
  const diagnosticText = repairDiagnosticTextForLikelyError(params.failureReason, params.schemaErrors, undefined);
  const rawContext = {
    version: 'sciforge.repair-context.v1',
    schemaVersion: 'sciforge.agentserver.repair-context.ref-first.v1',
    createdAt: new Date().toISOString(),
    projectFacts: {
      project: 'SciForge',
      runtimeRole: 'scenario-first AI4Science workspace runtime',
      toolPayloadContract: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
    },
    currentGoal: {
      currentUserRequest: clipForAgentServerPrompt(extractAgentServerCurrentUserRequest(params.request.prompt), 4000),
      skillDomain: params.request.skillDomain,
      expectedArtifactTypes: expectedArtifactTypesForRequest(params.request),
      selectedComponentIds: selectedComponentIdsForRequest(params.request),
    },
    workspaceRefs: {
      workspacePath: params.workspace,
      codeRef: params.run.spec.taskRel,
      inputRef: inputRel,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      generatedTaskId: params.run.spec.id,
    },
    selectedSkill: {
      id: params.skill.id,
      kind: params.skill.kind,
      entrypointType: params.skill.manifest.entrypoint.type,
      manifestPath: params.skill.manifestPath,
    },
    failure: {
      exitCode: params.run.exitCode,
      failureReason: clipForAgentServerPrompt(params.failureReason, 4000),
      schemaErrors: params.schemaErrors.slice(0, 16).map((entry) => clipForAgentServerPrompt(entry, 600)).filter(Boolean),
      likelyErrorLine: extractLikelyErrorLine(diagnosticText),
      workEvidenceSummary: undefined,
    },
    repairMaterials: repairMaterialRefs(params.run, inputRel),
    sessionSummary: summarizeUiStateForAgentServer(params.request.uiState, 'delta'),
    artifacts: summarizeArtifactRefs(params.request.artifacts),
    recentExecutionRefs: summarizeExecutionRefs(toRecordList(params.request.uiState?.recentExecutionRefs)),
    priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts).slice(0, 4),
  };
  const repairContextPolicySummary = repairContextPolicySummaryForAgentServer(params.request, rawContext);
  const compactRepairContext = applyRefFirstRepairContextPolicyForAgentServer(rawContext, repairContextPolicySummary);
  const refFirstRepairContext = projectRepairContextForAgentServerPrompt(compactRepairContext);
  return withIgnoredLegacyRepairContextPolicyAudit(
    refFirstRepairContext,
    ignoredLegacyRepairContextPolicyAuditForAgentServer(params.request, rawContext),
  ) ?? refFirstRepairContext;
}

function repairDiagnosticTextForLikelyError(
  failureReason: string,
  schemaErrors: string[],
  workEvidenceSummary: unknown,
) {
  const workEvidenceDiagnostics = toRecordList(isRecord(workEvidenceSummary) ? workEvidenceSummary.items : {})
    .flatMap((item) => [
      stringField(item.failureReason),
      ...toStringList(item.diagnostics),
      ...toStringList(item.recoverActions),
      stringField(item.nextStep),
    ]);
  return [
    failureReason,
    ...schemaErrors,
    ...workEvidenceDiagnostics,
  ].filter(Boolean).join('\n');
}

function repairMaterialRefs(run: WorkspaceTaskRunResult, inputRef: string) {
  return [
    repairMaterialRef('code', run.spec.taskRel, 'task-source'),
    repairMaterialRef('input', inputRef, 'task-input'),
    repairMaterialRef('output', run.outputRef, 'task-output'),
    repairMaterialRef('stdout', run.stdoutRef, 'process-log'),
    repairMaterialRef('stderr', run.stderrRef, 'process-log'),
  ].filter(Boolean);
}

function repairMaterialRef(kind: string, ref: string | undefined, role: string) {
  if (!ref) return undefined;
  return { kind, ref, role };
}

function applyRefFirstRepairContextPolicyForAgentServer(
  repairContext: Record<string, unknown>,
  policy: ReturnType<typeof repairContextPolicySummaryForAgentServer>,
) {
  if (!policy) return repairContext;
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const filtered: Record<string, unknown> = {
    ...repairContext,
    repairContextPolicy: {
      source: policy.source,
      sourceKind: policy.sourceKind,
      contractRef: policy.contractRef,
      traceRef: policy.traceRef,
      deterministicDecisionRef: policy.deterministicDecisionRef,
      kind: policy.kind,
      maxAttempts: policy.maxAttempts,
      includeStdoutSummary: policy.includeStdoutSummary,
      includeStderrSummary: policy.includeStderrSummary,
      includeValidationFindings: policy.includeValidationFindings,
      includePriorAttemptRefs: policy.includePriorAttemptRefs,
      allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
      blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    },
  };
  const audit = refFirstRepairContextPolicyAudit(policy);
  const failure = isRecord(repairContext.failure) ? { ...repairContext.failure } : {};
  applyRefFirstFailureFieldPolicy(failure, 'failureReason', repairPolicyRefs(workspaceRefs.outputRef, 'failureReason', 'failure:reason'), true, policy, audit);
  applyRefFirstFailureFieldPolicy(failure, 'workEvidenceSummary', repairPolicyRefs(workspaceRefs.outputRef, 'output', 'workEvidenceSummary'), true, policy, audit);
  filterRefFirstSchemaErrors(failure, repairPolicyRefs(workspaceRefs.outputRef, 'validation:findings', 'validator:findings', 'schemaErrors'), policy, audit);
  recordRefFirstEvidenceDecision(audit, 'diagnostics.stdoutRef', refFirstRepairEvidenceDecision(repairPolicyRefs(workspaceRefs.stdoutRef, 'stdout', 'stdoutSummary'), policy, policy.includeStdoutSummary));
  recordRefFirstEvidenceDecision(audit, 'diagnostics.stderrRef', refFirstRepairEvidenceDecision(repairPolicyRefs(workspaceRefs.stderrRef, 'stderr', 'stderrSummary'), policy, policy.includeStderrSummary));
  filtered.failure = failure;
  filtered.priorAttempts = policy.includePriorAttemptRefs ? repairContext.priorAttempts : [];
  if (!policy.includePriorAttemptRefs && Array.isArray(repairContext.priorAttempts) && repairContext.priorAttempts.length) {
    recordRefFirstEvidenceDecision(audit, 'priorAttempts', { include: false, reason: 'disabled', refs: ['priorAttempts'] });
  }
  filtered.repairContextPolicyAudit = audit;
  return filtered;
}

function applyRefFirstFailureFieldPolicy(
  failure: Record<string, unknown>,
  field: string,
  refs: string[],
  enabled: boolean,
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
  audit: Record<string, unknown>,
) {
  if (failure[field] === undefined) return;
  const decision = refFirstRepairEvidenceDecision(refs, policy, enabled);
  recordRefFirstEvidenceDecision(audit, `failure.${field}`, decision);
  if (!decision.include) delete failure[field];
}

function filterRefFirstSchemaErrors(
  failure: Record<string, unknown>,
  refs: string[],
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
  audit: Record<string, unknown>,
) {
  if (!Array.isArray(failure.schemaErrors)) return;
  const decision = refFirstRepairEvidenceDecision(refs, policy, policy.includeValidationFindings);
  recordRefFirstEvidenceDecision(audit, 'failure.schemaErrors', decision);
  if (!decision.include) delete failure.schemaErrors;
}

function refFirstRepairEvidenceDecision(
  refs: string[],
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
  enabled = true,
) {
  const normalizedRefs = uniqueStrings(refs);
  if (!enabled) return { include: false, reason: 'disabled', refs: normalizedRefs };
  const blocked = normalizedRefs.filter((ref) => policy.blockedFailureEvidenceRefs.includes(ref));
  if (blocked.length) return { include: false, reason: 'blocked', refs: blocked };
  if (policy.allowedFailureEvidenceRefs.length) {
    const allowed = normalizedRefs.filter((ref) => policy.allowedFailureEvidenceRefs.includes(ref));
    if (!allowed.length) return { include: false, reason: 'not-allowed', refs: normalizedRefs };
    return { include: true, refs: allowed };
  }
  return { include: true, refs: normalizedRefs };
}

function recordRefFirstEvidenceDecision(
  audit: Record<string, unknown>,
  path: string,
  decision: { include: boolean; reason?: string; refs: string[] },
) {
  if (decision.include) {
    audit.includedFailureEvidenceRefs = uniqueStrings([
      ...toStringList(audit.includedFailureEvidenceRefs),
      ...decision.refs,
    ]);
    return;
  }
  audit.omittedFailureEvidenceRefs = uniqueStrings([
    ...toStringList(audit.omittedFailureEvidenceRefs),
    ...decision.refs,
  ]);
  const omittedFields = Array.isArray(audit.omittedFields) ? audit.omittedFields.filter(isRecord) : [];
  omittedFields.push({ path, reason: decision.reason, refs: decision.refs });
  audit.omittedFields = omittedFields;
}

function refFirstRepairContextPolicyAudit(
  policy: NonNullable<ReturnType<typeof repairContextPolicySummaryForAgentServer>>,
) {
  return {
    schemaVersion: 'sciforge.agentserver.repair-context-policy-audit.v1',
    source: policy.source,
    sourceKind: policy.sourceKind,
    contractRef: policy.contractRef,
    traceRef: policy.traceRef,
    deterministicDecisionRef: policy.deterministicDecisionRef,
    deterministic: true,
    allowedFailureEvidenceRefs: policy.allowedFailureEvidenceRefs,
    blockedFailureEvidenceRefs: policy.blockedFailureEvidenceRefs,
    includeStdoutSummary: policy.includeStdoutSummary,
    includeStderrSummary: policy.includeStderrSummary,
    includeValidationFindings: policy.includeValidationFindings,
    includePriorAttemptRefs: policy.includePriorAttemptRefs,
    ignoredLegacySources: policy.ignoredLegacySources,
    includedFailureEvidenceRefs: [],
    omittedFailureEvidenceRefs: [],
    omittedFields: [],
  };
}

function repairPolicyRefs(...refs: unknown[]) {
  return uniqueStrings(refs.flatMap((ref) => {
    const value = stringField(ref);
    return value ? [value] : [];
  }));
}

function projectRepairContextForAgentServerPrompt(repairContext: Record<string, unknown>) {
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const existingRefs = isRecord(repairContext.refs) ? repairContext.refs : {};
  const failure = isRecord(repairContext.failure) ? repairContext.failure : {};
  const existingDiagnostics = isRecord(repairContext.diagnostics) ? repairContext.diagnostics : undefined;
  const projectFacts = isRecord(repairContext.projectFacts) ? repairContext.projectFacts : {};
  const existingTaskContract = isRecord(repairContext.taskContract) ? repairContext.taskContract : {};
  const repairMaterials = toRecordList(repairContext.repairMaterials);
  const existingMaterials = toRecordList(existingRefs.materials);
  const out: Record<string, unknown> = {
    version: repairContext.version,
    schemaVersion: 'sciforge.agentserver.repair-context.ref-first.v1',
    createdAt: repairContext.createdAt,
    promptOrder: 'diagnostic-first/ref-first',
    diagnostics: Object.keys(failure).length
      ? repairDiagnosticsForPrompt(failure, repairContext)
      : existingDiagnostics,
    refs: {
      workspacePath: workspaceRefs.workspacePath ?? existingRefs.workspacePath,
      generatedTaskId: workspaceRefs.generatedTaskId ?? existingRefs.generatedTaskId,
      materials: repairMaterials.length
        ? repairMaterials
        : existingMaterials.length ? existingMaterials : repairMaterialRefsFromWorkspaceRefs(workspaceRefs),
    },
    currentGoal: repairContext.currentGoal,
    selectedSkill: repairContext.selectedSkill,
    taskContract: {
      ...existingTaskContract,
      outputPayloadKeys: toStringList(projectFacts.toolPayloadContract).length
        ? toStringList(projectFacts.toolPayloadContract)
        : existingTaskContract.outputPayloadKeys,
      ...agentServerToolPayloadShapeContract(),
    },
    sessionSummary: repairContext.sessionSummary,
    artifacts: repairContext.artifacts,
    recentExecutionRefs: repairContext.recentExecutionRefs,
    priorAttempts: repairContext.priorAttempts,
    repairContextPolicy: repairContext.repairContextPolicy,
    repairContextPolicyAudit: repairContext.repairContextPolicyAudit,
    repairContextPolicyIgnoredLegacyAudit: repairContext.repairContextPolicyIgnoredLegacyAudit,
    agentServerCoreSnapshot: repairContext.agentServerCoreSnapshot,
  };
  return removeUndefinedFields(sanitizePromptHandoffValue(out, 'repairContext') as Record<string, unknown>);
}

function repairDiagnosticsForPrompt(
  failure: Record<string, unknown>,
  repairContext: Record<string, unknown>,
) {
  return removeUndefinedFields({
    exitCode: failure.exitCode,
    failureReason: failure.failureReason,
    schemaErrors: failure.schemaErrors,
    likelyErrorLine: failure.likelyErrorLine,
    workEvidenceSummary: failure.workEvidenceSummary,
    evidenceRefs: repairDiagnosticEvidenceRefs(repairContext),
    materialBodies: 'omitted-ref-first',
  });
}

function repairDiagnosticEvidenceRefs(repairContext: Record<string, unknown>) {
  const workspaceRefs = isRecord(repairContext.workspaceRefs) ? repairContext.workspaceRefs : {};
  const policyAudit = isRecord(repairContext.repairContextPolicyAudit) ? repairContext.repairContextPolicyAudit : {};
  const included = toStringList(policyAudit.includedFailureEvidenceRefs);
  const omitted = toStringList(policyAudit.omittedFailureEvidenceRefs);
  const refs = [
    repairMaterialRef('output', stringField(workspaceRefs.outputRef), omitted.includes('output') ? 'omitted-by-policy' : 'diagnostic-ref'),
    repairMaterialRef('stdout', stringField(workspaceRefs.stdoutRef), included.includes('stdout') ? 'included-by-policy' : omitted.includes('stdout') ? 'omitted-by-policy' : 'diagnostic-ref'),
    repairMaterialRef('stderr', stringField(workspaceRefs.stderrRef), included.includes('stderr') ? 'included-by-policy' : omitted.includes('stderr') ? 'omitted-by-policy' : 'diagnostic-ref'),
  ].filter(Boolean);
  return refs.length ? refs : undefined;
}

function repairMaterialRefsFromWorkspaceRefs(workspaceRefs: Record<string, unknown>) {
  return [
    repairMaterialRef('code', stringField(workspaceRefs.codeRef), 'task-source'),
    repairMaterialRef('input', stringField(workspaceRefs.inputRef), 'task-input'),
    repairMaterialRef('output', stringField(workspaceRefs.outputRef), 'task-output'),
    repairMaterialRef('stdout', stringField(workspaceRefs.stdoutRef), 'process-log'),
    repairMaterialRef('stderr', stringField(workspaceRefs.stderrRef), 'process-log'),
  ].filter(Boolean);
}

function removeUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

export function buildAgentServerRepairPrompt(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
  repairContext?: Record<string, unknown>;
}) {
  const repairContextPolicySummary = repairContextPolicySummaryForAgentServer(params.request, params.repairContext);
  const repairContextWithAudit = withIgnoredLegacyRepairContextPolicyAudit(
    params.repairContext,
    ignoredLegacyRepairContextPolicyAuditForAgentServer(params.request, params.repairContext),
  );
  const repairContext = repairContextWithAudit
    ? projectRepairContextForAgentServerPrompt(repairContextWithAudit)
    : undefined;
  return [
    ...agentServerWorkspaceTaskRepairPromptPolicyLines('intro'),
    ...agentServerRepairPromptPolicyLines(),
    ...agentServerExternalIoReliabilityContractLines(),
    ...agentServerToolPayloadProtocolContractLines(),
    ...agentServerWorkspaceTaskRepairPromptPolicyLines('completion'),
    '',
    JSON.stringify({
      repairContext,
      repairContextPolicySummary,
      expectedPayloadKeys: ['message', 'confidence', 'claimType', 'evidenceLevel', 'reasoningTrace', 'claims', 'displayIntent', 'uiManifest', 'executionUnits', 'artifacts', 'objectReferences'],
      minimalValidToolPayload: minimalValidInteractiveToolPayloadExample(params.request),
    }, null, 2),
    '',
    'Return a concise summary of files changed, tests or commands run, and any remaining blocker.',
  ].join('\n');
}

function withIgnoredLegacyRepairContextPolicyAudit(
  repairContext: Record<string, unknown> | undefined,
  audit: Record<string, unknown> | undefined,
) {
  if (!repairContext || !audit) return repairContext;
  return {
    ...repairContext,
    repairContextPolicyIgnoredLegacyAudit: audit,
  };
}
