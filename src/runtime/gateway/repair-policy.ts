import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import type { ContractValidationFailure } from '@sciforge-ui/runtime-contract/validation-failure';
import { sha1 } from '../workspace-task-runner.js';
import { diagnosticForFailure } from './backend-failure-diagnostics.js';

export interface RepairPolicyRefs {
  taskRel?: string;
  outputRel?: string;
  stdoutRel?: string;
  stderrRel?: string;
  blocker?: string;
  agentServerRefs?: Record<string, unknown>;
  recoverActions?: string[];
  validationFailure?: ContractValidationFailure;
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
  planRefs: Record<string, unknown> = {},
): ToolPayload {
  const validationFailure = refs.validationFailure;
  const repairReason = validationFailure?.failureReason ?? reason;
  const id = `EU-${request.skillDomain}-${sha1(`${request.prompt}:${repairReason}`).slice(0, 8)}`;
  const evidenceRefs = evidenceRefsForRepair(refs);
  const diagnostic = diagnosticForFailure(repairReason, {
    backend: request.agentBackend,
    provider: request.modelProvider,
    model: request.modelName,
    evidenceRefs,
  });
  const recoverActions = refs.recoverActions
    ?? validationFailure?.recoverActions
    ?? diagnostic.recoverActions
    ?? recoverActionsForRepair(validationFailure ?? repairReason);
  const nextStep = validationFailure?.nextStep ?? diagnostic.nextStep ?? nextStepForRepair(validationFailure ?? repairReason);
  const displayReason = validationFailure ? validationFailurePrompt(validationFailure) : diagnostic.userReason ?? repairReason;
  return {
    message: `SciForge runtime gateway needs repair or AgentServer task generation: ${displayReason}`,
    confidence: 0.2,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      ...repairReasoningTrace(validationFailure, repairReason),
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
      params: JSON.stringify(repairParams(request, skill, validationFailure, repairReason)),
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
        validationFailure,
        diagnostic: {
          kind: diagnostic.kind,
          categories: diagnostic.categories,
          title: diagnostic.title,
          evidenceRefs,
        },
      },
      failureReason: displayReason,
      ...planRefs,
      requiredInputs: requiredInputsForRepair(request, validationFailure ?? repairReason),
      recoverActions,
      nextStep,
      attempt: 1,
    }],
    objectReferences: objectReferencesForEvidence(id, evidenceRefs),
    artifacts: [],
  };
}

function evidenceRefsForRepair(refs: RepairPolicyRefs) {
  return Array.from(new Set([
    refs.taskRel,
    refs.outputRel,
    refs.stdoutRel,
    refs.stderrRel,
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

function repairReasoningTrace(failure: ContractValidationFailure | undefined, repairReason: string) {
  if (!failure) return [repairReason];
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
  failure: ContractValidationFailure | undefined,
  repairReason: string,
) {
  const base = {
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    skillId: skill.id,
  };
  if (!failure) return { ...base, reason: repairReason };
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

export function requiredInputsForRepair(request: GatewayRequest, problem: string | ContractValidationFailure) {
  const inputs = ['workspacePath', 'prompt', 'skillDomain'];
  if (typeof problem !== 'string') {
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
  const reason = problem;
  if (/agentserver|base url/i.test(reason)) inputs.push('agentServerBaseUrl');
  if (/User-side model configuration|llmEndpoint|Model Provider|Model Base URL|Model Name/i.test(reason)) inputs.push('modelProvider', 'modelBaseUrl', 'modelName', 'apiKey');
  if (/credential|token|api key/i.test(reason)) inputs.push('credentials');
  if (/file|path|input/i.test(reason)) inputs.push('input artifacts or workspace files');
  if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
  return Array.from(new Set(inputs));
}

export function recoverActionsForRepair(problem: string | ContractValidationFailure) {
  if (typeof problem !== 'string') {
    if (problem.recoverActions.length) return problem.recoverActions;
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
  const reason = problem;
  if (/429|rate-limit|rate limit|retry budget|too many failed attempts|responseTooManyFailedAttempts|retry-after/i.test(reason)) {
    return [
      'Wait for the provider rate-limit/retry budget reset, then retry the same prompt.',
      'Reduce concurrent AgentServer runs or switch to a provider/model with available quota.',
      'Keep follow-up context compact by relying on workspace refs instead of resending full logs/artifacts.',
    ];
  }
  if (/User-side model configuration|llmEndpoint|openteam\.json defaults/i.test(reason)) {
    return [
      'Open SciForge settings and fill Model Provider, Model Base URL, Model Name, and API Key.',
      'Save config.local.json, then retry the same prompt so SciForge forwards the request-selected llmEndpoint.',
      'Do not rely on AgentServer openteam.json defaults for generated workspace tasks.',
    ];
  }
  if (/AgentServer|base URL|fetch|ECONNREFUSED/i.test(reason)) {
    return [
      'Start or configure AgentServer, then retry the same prompt.',
      'If a local package skill package should handle this task, verify the skill registry match before using AgentServer fallback.',
    ];
  }
  if (/schema|payload|parsed|validation/i.test(reason)) {
    return [
      'Open stdoutRef, stderrRef, and outputRef to inspect the generated task result.',
      'Retry after the task returns message, claims, uiManifest, executionUnits, and artifacts.',
    ];
  }
  return [
    'Inspect stdoutRef, stderrRef, and outputRef when present.',
    'Attach required inputs or choose a compatible skill/runtime before retrying.',
  ];
}

export function nextStepForRepair(problem: string | ContractValidationFailure) {
  if (typeof problem !== 'string') {
    if (problem.nextStep) return problem.nextStep;
    if (problem.failureKind === 'reference') return 'Resolve invalid refs or explicitly report unreadable inputs, then rerun validation.';
    if (problem.failureKind === 'artifact-schema') return 'Repair artifact ids/types/data refs and rerun validation.';
    if (problem.failureKind === 'ui-manifest') return 'Repair display manifest slots and bindings, then rerun validation.';
    if (problem.failureKind === 'work-evidence') return 'Repair WorkEvidence/status/ref consistency and rerun validation.';
    if (problem.failureKind === 'verifier') return 'Run the selected verifier or collect human approval, then rerun validation.';
    return 'Repair the structured payload contract and rerun validation.';
  }
  const reason = problem;
  if (/429|rate-limit|rate limit|retry budget|too many failed attempts|responseTooManyFailedAttempts|retry-after/i.test(reason)) return 'Wait for provider quota/reset, then rerun with compact workspace refs; SciForge has already used its single automatic compact retry.';
  if (/User-side model configuration|llmEndpoint|openteam\.json defaults/i.test(reason)) return 'Configure the user-side model endpoint in SciForge settings, then retry the same prompt.';
  if (/AgentServer|base URL|fetch|ECONNREFUSED/i.test(reason)) return 'Start AgentServer or choose a local skill/runtime, then retry.';
  if (/schema|payload|parsed|validation/i.test(reason)) return 'Repair the task output contract and rerun validation.';
  return 'Review diagnostics, provide missing inputs, and rerun.';
}
