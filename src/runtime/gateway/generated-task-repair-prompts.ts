import type { GatewayRequest, SkillAvailability, WorkspaceTaskRunResult } from '../runtime-types.js';
import { extractBackendCurrentUserRequest } from '@sciforge-ui/runtime-contract/backend-prompt-policy';
import { backendToolPayloadProtocolContractLines } from '@sciforge-ui/runtime-contract/artifact-policy';
import { backendExternalIoReliabilityContractLines, backendRepairPromptPolicyLines, backendToolPayloadShapeContract, backendWorkspaceTaskRepairPromptPolicyLines } from '../../../packages/skills/runtime-policy.js';
import { minimalValidInteractiveToolPayloadExample } from '../../../packages/presentation/interactive-views/runtime-ui-manifest-policy.js';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';
import { summarizeArtifactRefs, summarizeExecutionRefs, summarizeTaskAttemptsForAgentServer } from './context-envelope.js';
import { clipForBackendPrompt, extractLikelyErrorLine, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import {
  applyRepairContextPolicyForBackend,
  ignoredLegacyRepairContextPolicyAuditForBackend,
  repairContextPolicySummaryForBackend,
} from './generated-task-repair-context-policy.js';
import { sanitizePromptHandoffValue } from './generated-task-prompt-policy.js';
import { summarizeUiStateForAgentServer } from './backend-context-summary.js';

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
      currentUserRequest: clipForBackendPrompt(extractBackendCurrentUserRequest(params.request.prompt), 4000),
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
      failureReason: clipForBackendPrompt(params.failureReason, 4000),
      schemaErrors: params.schemaErrors.slice(0, 16).map((entry) => clipForBackendPrompt(entry, 600)).filter(Boolean),
      likelyErrorLine: extractLikelyErrorLine(diagnosticText),
      workEvidenceSummary: undefined,
    },
    repairMaterials: repairMaterialRefs(params.run, inputRel),
    sessionSummary: summarizeUiStateForAgentServer(params.request.uiState, 'delta'),
    artifacts: summarizeArtifactRefs(params.request.artifacts),
    recentExecutionRefs: summarizeExecutionRefs(toRecordList(params.request.uiState?.recentExecutionRefs)),
    priorAttempts: summarizeTaskAttemptsForAgentServer(params.priorAttempts).slice(0, 4),
  };
  const repairContextPolicySummary = repairContextPolicySummaryForBackend(params.request, rawContext);
  const compactRepairContext = applyRepairContextPolicyForBackend(rawContext, repairContextPolicySummary) ?? rawContext;
  const refFirstRepairContext = projectRepairContextForBackendPrompt(compactRepairContext);
  return withIgnoredLegacyRepairContextPolicyAudit(
    refFirstRepairContext,
    ignoredLegacyRepairContextPolicyAuditForBackend(params.request, rawContext),
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

function projectRepairContextForBackendPrompt(repairContext: Record<string, unknown>) {
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
      ...backendToolPayloadShapeContract(),
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
    failureReason: promptSafeFailureReason(failure.failureReason),
    schemaErrors: failure.schemaErrors,
    likelyErrorLine: failure.likelyErrorLine,
    workEvidenceSummary: failure.workEvidenceSummary,
    evidenceRefs: repairDiagnosticEvidenceRefs(repairContext),
    materialBodies: 'omitted-ref-first',
  });
}

function promptSafeFailureReason(value: unknown) {
  if (typeof value !== 'string') return value;
  if (!/BLOCKED_STDERR_SECRET|Traceback \(most recent call last\)|\b(?:RuntimeError|SyntaxError|ValueError|TypeError|Exception|Error):|(?:^|\n)\s*File ".*?", line \d+/i.test(value)) return value;
  const exitMatch = value.match(/\bbackend-generated task exited\s+(\d+)/i);
  if (exitMatch) return `backend-generated task exited ${exitMatch[1]}; raw process log details are available only through policy-approved refs.`;
  return 'Generated task failed during execution; raw process log details are available only through policy-approved refs.';
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

export function buildGeneratedTaskRepairPrompt(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  priorAttempts: unknown[];
  repairContext?: Record<string, unknown>;
}) {
  const repairContextPolicySummary = repairContextPolicySummaryForBackend(params.request, params.repairContext);
  const filteredRepairContext = applyRepairContextPolicyForBackend(params.repairContext, repairContextPolicySummary);
  const repairContextWithAudit = withIgnoredLegacyRepairContextPolicyAudit(
    filteredRepairContext,
    ignoredLegacyRepairContextPolicyAuditForBackend(params.request, params.repairContext),
  );
  const repairContext = repairContextWithAudit
    ? projectRepairContextForBackendPrompt(repairContextWithAudit)
    : undefined;
  return [
    ...backendWorkspaceTaskRepairPromptPolicyLines('intro'),
    ...backendRepairPromptPolicyLines(),
    ...backendExternalIoReliabilityContractLines(),
    ...backendToolPayloadProtocolContractLines(),
    ...backendWorkspaceTaskRepairPromptPolicyLines('completion'),
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
