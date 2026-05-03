import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { sha1 } from '../workspace-task-runner.js';

export interface RepairPolicyRefs {
  taskRel?: string;
  outputRel?: string;
  stdoutRel?: string;
  stderrRel?: string;
  blocker?: string;
  agentServerRefs?: Record<string, unknown>;
  recoverActions?: string[];
}

export function repairNeededPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  reason: string,
  refs: RepairPolicyRefs = {},
  planRefs: Record<string, unknown> = {},
): ToolPayload {
  const id = `EU-${request.skillDomain}-${sha1(`${request.prompt}:${reason}`).slice(0, 8)}`;
  return {
    message: `BioAgent runtime gateway needs repair or AgentServer task generation: ${reason}`,
    confidence: 0.2,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      reason,
      `skillDomain=${request.skillDomain}`,
      `skill=${skill.id}`,
      'No demo/default/record-only success payload was substituted.',
    ].join('\n'),
    claims: [{
      text: reason,
      type: 'fact',
      confidence: 0.2,
      evidenceLevel: 'runtime',
      supportingRefs: [skill.id],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: `${request.skillDomain}-runtime-result`, priority: 1 },
    ],
    executionUnits: [{
      id,
      tool: 'bioagent.workspace-runtime-gateway',
      params: JSON.stringify({ prompt: request.prompt, skillDomain: request.skillDomain, skillId: skill.id, reason }),
      status: 'repair-needed',
      hash: sha1(`${id}:${reason}`).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'BioAgent workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: [],
      artifacts: [],
      codeRef: refs.taskRel,
      outputRef: refs.outputRel,
      stdoutRef: refs.stdoutRel,
      stderrRef: refs.stderrRel,
      blocker: refs.blocker,
      refs: refs.agentServerRefs,
      failureReason: reason,
      ...planRefs,
      requiredInputs: requiredInputsForRepair(request, reason),
      recoverActions: refs.recoverActions ?? recoverActionsForRepair(reason),
      nextStep: nextStepForRepair(reason),
      attempt: 1,
    }],
    artifacts: [],
  };
}

export function requiredInputsForRepair(request: GatewayRequest, reason: string) {
  const inputs = ['workspacePath', 'prompt', 'skillDomain'];
  if (/agentserver|base url/i.test(reason)) inputs.push('agentServerBaseUrl');
  if (/User-side model configuration|llmEndpoint|Model Provider|Model Base URL|Model Name/i.test(reason)) inputs.push('modelProvider', 'modelBaseUrl', 'modelName', 'apiKey');
  if (/credential|token|api key/i.test(reason)) inputs.push('credentials');
  if (/file|path|input/i.test(reason)) inputs.push('input artifacts or workspace files');
  if (request.scenarioPackageRef) inputs.push(`scenarioPackage:${request.scenarioPackageRef.id}@${request.scenarioPackageRef.version}`);
  return Array.from(new Set(inputs));
}

export function recoverActionsForRepair(reason: string) {
  if (/429|rate-limit|rate limit|retry budget|too many failed attempts|responseTooManyFailedAttempts|retry-after/i.test(reason)) {
    return [
      'Wait for the provider rate-limit/retry budget reset, then retry the same prompt.',
      'Reduce concurrent AgentServer runs or switch to a provider/model with available quota.',
      'Keep follow-up context compact by relying on workspace refs instead of resending full logs/artifacts.',
    ];
  }
  if (/User-side model configuration|llmEndpoint|openteam\.json defaults/i.test(reason)) {
    return [
      'Open BioAgent settings and fill Model Provider, Model Base URL, Model Name, and API Key.',
      'Save config.local.json, then retry the same prompt so BioAgent forwards the request-selected llmEndpoint.',
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

export function nextStepForRepair(reason: string) {
  if (/429|rate-limit|rate limit|retry budget|too many failed attempts|responseTooManyFailedAttempts|retry-after/i.test(reason)) return 'Wait for provider quota/reset, then rerun with compact workspace refs; BioAgent has already used its single automatic compact retry.';
  if (/User-side model configuration|llmEndpoint|openteam\.json defaults/i.test(reason)) return 'Configure the user-side model endpoint in BioAgent settings, then retry the same prompt.';
  if (/AgentServer|base URL|fetch|ECONNREFUSED/i.test(reason)) return 'Start AgentServer or choose a local skill/runtime, then retry.';
  if (/schema|payload|parsed|validation/i.test(reason)) return 'Repair the task output contract and rerun validation.';
  return 'Review diagnostics, provide missing inputs, and rerun.';
}
