import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract/validation-failure';
import { sha1 } from '../workspace-task-runner.js';
import { uniqueStrings } from '../gateway-utils.js';
import { diagnosticForFailure, type AgentServerBackendFailureDiagnostic } from './backend-failure-diagnostics.js';

export const BACKEND_REPAIR_FAILURE_CONTRACT_ID = 'sciforge.backend-repair-failure.v1';

export interface BackendRepairFailure {
  contract: typeof BACKEND_REPAIR_FAILURE_CONTRACT_ID;
  failureKind: 'backend-diagnostic';
  capabilityId: string;
  failureReason: string;
  diagnostic: AgentServerBackendFailureDiagnostic;
  recoverActions: string[];
  nextStep: string;
  relatedRefs: string[];
  createdAt: string;
}

export type StructuredRepairFailure = ContractValidationFailure | BackendRepairFailure;

export interface RepairPolicyRefs {
  taskRel?: string;
  outputRel?: string;
  stdoutRel?: string;
  stderrRel?: string;
  blocker?: string;
  agentServerRefs?: Record<string, unknown>;
  recoverActions?: string[];
  validationFailure?: ContractValidationFailure;
  backendFailure?: BackendRepairFailure;
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
  planRefs: Record<string, unknown> = {},
): ToolPayload {
  const validationFailure = refs.validationFailure;
  const evidenceRefs = evidenceRefsForRepair(refs);
  const backendFailure = validationFailure ? undefined : refs.backendFailure ?? backendRepairFailureFromReason(reason, {
    capabilityId: skill.id,
    backend: request.agentBackend,
    provider: request.modelProvider,
    model: request.modelName,
    evidenceRefs,
    recoverActions: refs.recoverActions,
  });
  const repairFailure: StructuredRepairFailure = validationFailure ?? backendFailure!;
  const repairReason = repairFailure.failureReason;
  const id = `EU-${request.skillDomain}-${sha1(`${request.prompt}:${repairReason}`).slice(0, 8)}`;
  const diagnostic = backendFailure?.diagnostic ?? diagnosticForFailure(repairReason, {
    backend: request.agentBackend,
    provider: request.modelProvider,
    model: request.modelName,
    evidenceRefs,
  });
  const recoverActions = refs.recoverActions
    ?? repairFailure.recoverActions
    ?? diagnostic.recoverActions
    ?? recoverActionsForRepair(repairFailure);
  const nextStep = repairFailure.nextStep ?? diagnostic.nextStep ?? nextStepForRepair(repairFailure);
  const displayReason = isContractValidationFailure(repairFailure)
    ? validationFailurePrompt(repairFailure)
    : backendFailurePrompt(repairFailure);
  return {
    message: `SciForge runtime gateway needs repair or AgentServer task generation: ${displayReason}`,
    confidence: 0.2,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      ...repairReasoningTrace(repairFailure),
      `skillDomain=${request.skillDomain}`,
      `skill=${skill.id}`,
      'No demo/default/record-only success payload was substituted.',
    ].join('\n'),
    claims: [{
      text: displayReason,
      type: 'fact',
      confidence: 0.2,
      evidenceLevel: 'runtime',
      supportingRefs: [skill.id],
      opposingRefs: [],
    }],
    uiManifest: [defaultRepairDiagnosticSlot(request)],
    executionUnits: [{
      id,
      tool: 'sciforge.workspace-runtime-gateway',
      params: JSON.stringify(repairParams(request, skill, repairFailure)),
      status: 'repair-needed',
      hash: sha1(`${id}:${repairReason}`).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'SciForge workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: [],
      artifacts: [],
      codeRef: refs.taskRel,
      outputRef: refs.outputRel,
      stdoutRef: refs.stdoutRel,
      stderrRef: refs.stderrRel,
      blocker: refs.blocker,
      refs: {
        ...refs.agentServerRefs,
        ...(validationFailure ? { validationFailure } : { backendFailure }),
        diagnostic: {
          kind: diagnostic.kind,
          categories: diagnostic.categories,
          title: diagnostic.title,
          evidenceRefs,
        },
      },
      failureReason: displayReason,
      ...planRefs,
      requiredInputs: requiredInputsForRepair(request, repairFailure),
      recoverActions,
      nextStep,
      attempt: 1,
    }],
    objectReferences: objectReferencesForEvidence(id, evidenceRefs),
    artifacts: [],
  };
}

export function backendRepairFailureFromReason(
  reason: string,
  options: {
    capabilityId: string;
    backend?: string;
    provider?: string;
    model?: string;
    evidenceRefs?: string[];
    recoverActions?: string[];
  },
): BackendRepairFailure {
  const diagnostic = diagnosticForFailure(reason, {
    backend: options.backend,
    provider: options.provider,
    model: options.model,
    evidenceRefs: options.evidenceRefs,
  });
  const recoverActions = options.recoverActions
    ?? userModelConfigRecoverActions(reason)
    ?? diagnostic.recoverActions
    ?? backendDiagnosticRecoverActions(diagnostic);
  const nextStep = userModelConfigNextStep(reason)
    ?? diagnostic.nextStep
    ?? backendDiagnosticNextStep(diagnostic);
  return {
    contract: BACKEND_REPAIR_FAILURE_CONTRACT_ID,
    failureKind: 'backend-diagnostic',
    capabilityId: options.capabilityId,
    failureReason: diagnostic.userReason ?? diagnostic.message,
    diagnostic,
    recoverActions,
    nextStep,
    relatedRefs: uniqueStrings(options.evidenceRefs ?? []),
    createdAt: new Date().toISOString(),
  };
}

function evidenceRefsForRepair(refs: RepairPolicyRefs) {
  return Array.from(new Set([
    refs.taskRel,
    refs.outputRel,
    refs.stdoutRel,
    refs.stderrRel,
    ...(refs.backendFailure?.relatedRefs ?? []),
    ...(refs.validationFailure?.relatedRefs ?? []),
    ...(refs.validationFailure?.invalidRefs ?? []),
    ...(refs.validationFailure?.unresolvedUris ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function validationFailurePrompt(failure: ContractValidationFailure) {
  return [
    `ContractValidationFailure ${failure.failureKind}`,
    `contractId=${failure.contractId}`,
    `schemaPath=${failure.schemaPath}`,
    `reason=${failure.failureReason}`,
  ].join('; ');
}

function backendFailurePrompt(failure: BackendRepairFailure) {
  return failure.diagnostic.userReason ?? [
    `BackendRepairFailure ${failure.diagnostic.kind}`,
    `contractId=${failure.contract}`,
    `reason=${failure.failureReason}`,
  ].join('; ');
}

function repairReasoningTrace(failure: StructuredRepairFailure) {
  if (isBackendRepairFailure(failure)) {
    return [
      'structuredRepairFailure=BackendRepairFailure',
      `contractId=${failure.contract}`,
      `failureKind=${failure.failureKind}`,
      `diagnosticKind=${failure.diagnostic.kind}`,
      failure.diagnostic.categories.length ? `diagnosticCategories=${failure.diagnostic.categories.join(', ')}` : undefined,
      `failureReason=${failure.failureReason}`,
      failure.relatedRefs.length ? `relatedRefs=${failure.relatedRefs.join(', ')}` : undefined,
    ].filter((line): line is string => Boolean(line));
  }
  return [
    'structuredValidationFailure=ContractValidationFailure',
    `failureKind=${failure.failureKind}`,
    `contractId=${failure.contractId}`,
    `schemaPath=${failure.schemaPath}`,
    `failureReason=${failure.failureReason}`,
    failure.missingFields.length ? `missingFields=${failure.missingFields.join(', ')}` : undefined,
    failure.invalidRefs.length ? `invalidRefs=${failure.invalidRefs.join(', ')}` : undefined,
    failure.unresolvedUris.length ? `unresolvedUris=${failure.unresolvedUris.join(', ')}` : undefined,
    failure.relatedRefs.length ? `relatedRefs=${failure.relatedRefs.join(', ')}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function repairParams(
  request: GatewayRequest,
  skill: SkillAvailability,
  failure: StructuredRepairFailure,
) {
  const base = {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    skillId: skill.id,
  };
  if (isBackendRepairFailure(failure)) {
    return {
      ...base,
      backendFailure: {
        contract: failure.contract,
        failureKind: failure.failureKind,
        capabilityId: failure.capabilityId,
        failureReason: failure.failureReason,
        diagnostic: {
          kind: failure.diagnostic.kind,
          categories: failure.diagnostic.categories,
          backend: failure.diagnostic.backend,
          provider: failure.diagnostic.provider,
          model: failure.diagnostic.model,
          httpStatus: failure.diagnostic.httpStatus,
          retryAfterMs: failure.diagnostic.retryAfterMs,
          resetAt: failure.diagnostic.resetAt,
          message: failure.diagnostic.message,
          title: failure.diagnostic.title,
        },
        recoverActions: failure.recoverActions,
        nextStep: failure.nextStep,
        relatedRefs: failure.relatedRefs,
      },
    };
  }
  return {
    ...base,
    validationFailure: {
      contract: failure.contract,
      contractId: failure.contractId,
      capabilityId: failure.capabilityId,
      failureKind: failure.failureKind,
      schemaPath: failure.schemaPath,
      failureReason: failure.failureReason,
      missingFields: failure.missingFields,
      invalidRefs: failure.invalidRefs,
      unresolvedUris: failure.unresolvedUris,
      relatedRefs: failure.relatedRefs,
      issues: failure.issues,
    },
  };
}

function objectReferencesForEvidence(executionUnitId: string, refs: string[]) {
  return [
    {
      id: `or-${executionUnitId}`,
      title: '失败的 execution unit',
      kind: 'execution-unit',
      ref: `execution-unit:${executionUnitId}`,
      executionUnitId,
      status: 'blocked',
      actions: ['focus-right-pane', 'inspect', 'pin'],
    },
    ...refs.map((ref) => ({
      id: `or-${sha1(ref).slice(0, 10)}`,
      title: ref.split('/').pop() || ref,
      kind: ref.startsWith('artifact:') ? 'artifact' : ref.startsWith('http') ? 'url' : 'file',
      ref: ref.includes(':') ? ref : `file:${ref}`,
      executionUnitId,
      status: 'available',
      actions: ['focus-right-pane', 'inspect', 'copy-path', 'pin'],
    })),
  ];
}

function defaultRepairDiagnosticSlot(request: GatewayRequest) {
  return {
    componentId: 'execution-unit-table',
    title: 'Execution units',
    artifactRef: `${request.skillDomain}-runtime-result`,
    priority: 1,
  };
}

export function requiredInputsForRepair(request: GatewayRequest, problem: StructuredRepairFailure) {
  const inputs = ['workspacePath', 'prompt', 'skillDomain'];
  if (isContractValidationFailure(problem)) {
    inputs.push(`contract:${problem.contractId}`);
    if (problem.missingFields.length) inputs.push(`missingFields:${problem.missingFields.join(',')}`);
    if (problem.invalidRefs.length || problem.unresolvedUris.length) inputs.push('valid workspace/artifact refs');
    if (problem.failureKind === 'artifact-schema') inputs.push('artifact ids/types/data refs');
    if (problem.failureKind === 'ui-manifest') inputs.push('display manifest bindings');
    if (problem.failureKind === 'work-evidence') inputs.push('evidenceRefs/rawRef or honest failed status');
    if (problem.failureKind === 'verifier') inputs.push('verifier evidence or human approval');
    if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
    return Array.from(new Set(inputs));
  }
  const categories = new Set(problem.diagnostic.categories);
  if (categories.has('network')) inputs.push('agentServerBaseUrl');
  if (isUserModelConfigReason(problem.diagnostic.message) || isUserModelConfigReason(problem.failureReason)) inputs.push('modelProvider', 'modelBaseUrl', 'modelName', 'apiKey');
  if (categories.has('auth')) inputs.push('credentials');
  if (categories.has('missing-input')) inputs.push('input artifacts or workspace files');
  if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
  return Array.from(new Set(inputs));
}

export function recoverActionsForRepair(problem: StructuredRepairFailure) {
  if (problem.recoverActions.length) return problem.recoverActions;
  if (isBackendRepairFailure(problem)) return backendDiagnosticRecoverActions(problem.diagnostic);
  if (problem.failureKind === 'reference') {
    return [
      'Read the referenced input by stable ref/path/dataRef.',
      'Regenerate the final answer/artifacts from that reference, or report the ref as unreadable with nextStep.',
    ];
  }
  if (problem.failureKind === 'artifact-schema') return ['Regenerate artifacts with non-empty ids/types and stable data refs.'];
  if (problem.failureKind === 'ui-manifest') return ['Repair display manifest bindings against the returned artifacts.'];
  if (problem.failureKind === 'work-evidence') return ['Attach durable evidenceRefs/rawRef, or return repair-needed/failed-with-reason with a blocker.'];
  if (problem.failureKind === 'verifier') return ['Run the required verifier path or collect human approval before completion.'];
  return ['Repair the structured payload contract and rerun validation.'];
}

function backendDiagnosticRecoverActions(diagnostic: AgentServerBackendFailureDiagnostic) {
  const userModelActions = userModelConfigRecoverActions(diagnostic.message);
  if (userModelActions) return userModelActions;
  const categories = new Set(diagnostic.categories);
  if (categories.has('network')) {
    return [
      'Start or configure AgentServer, then retry the same prompt.',
      'If a local package skill package should handle this task, verify the skill registry match before using AgentServer fallback.',
    ];
  }
  if (categories.has('schema')) {
    return [
      'Open stdoutRef, stderrRef, and outputRef to inspect the generated task result.',
      'Retry after the task returns message, claims, uiManifest, executionUnits, and artifacts.',
    ];
  }
  return diagnostic.recoverActions ?? [
    'Inspect stdoutRef, stderrRef, and outputRef when present.',
    'Attach required inputs or choose a compatible skill/runtime before retrying.',
  ];
}

export function nextStepForRepair(problem: StructuredRepairFailure) {
  if (problem.nextStep) return problem.nextStep;
  if (isBackendRepairFailure(problem)) return backendDiagnosticNextStep(problem.diagnostic);
  if (problem.failureKind === 'reference') return 'Resolve invalid refs or explicitly report unreadable inputs, then rerun validation.';
  if (problem.failureKind === 'artifact-schema') return 'Repair artifact ids/types/data refs and rerun validation.';
  if (problem.failureKind === 'ui-manifest') return 'Repair display manifest slots and bindings, then rerun validation.';
  if (problem.failureKind === 'work-evidence') return 'Repair WorkEvidence/status/ref consistency and rerun validation.';
  if (problem.failureKind === 'verifier') return 'Run the selected verifier or collect human approval, then rerun validation.';
  return 'Repair the structured payload contract and rerun validation.';
}

function backendDiagnosticNextStep(diagnostic: AgentServerBackendFailureDiagnostic) {
  return userModelConfigNextStep(diagnostic.message)
    ?? diagnostic.nextStep
    ?? 'Review diagnostics, provide missing inputs, and rerun.';
}

function isContractValidationFailure(problem: StructuredRepairFailure): problem is ContractValidationFailure {
  return problem.contract !== BACKEND_REPAIR_FAILURE_CONTRACT_ID;
}

function isBackendRepairFailure(problem: StructuredRepairFailure): problem is BackendRepairFailure {
  return problem.contract === BACKEND_REPAIR_FAILURE_CONTRACT_ID;
}

function isUserModelConfigReason(reason: string) {
  return /User-side model configuration|llmEndpoint|Model Provider|Model Base URL|Model Name|openteam\.json defaults/i.test(reason);
}

function userModelConfigRecoverActions(reason: string) {
  if (!isUserModelConfigReason(reason)) return undefined;
  return [
    'Open SciForge settings and fill Model Provider, Model Base URL, Model Name, and API Key.',
    'Save config.local.json, then retry the same prompt so SciForge forwards the request-selected llmEndpoint.',
    'Do not rely on AgentServer openteam.json defaults for generated workspace tasks.',
  ];
}

function userModelConfigNextStep(reason: string) {
  return isUserModelConfigReason(reason)
    ? 'Configure the user-side model endpoint in SciForge settings, then retry the same prompt.'
    : undefined;
}
