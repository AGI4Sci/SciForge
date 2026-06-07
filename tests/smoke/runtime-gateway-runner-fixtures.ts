import type { GeneratedTaskRunnerDeps } from '../../src/runtime/gateway/generated-task-runner.js';
import { coerceBackendToolPayload, coerceWorkspaceTaskPayload, ensureDirectAnswerReportArtifact, normalizeToolPayloadShape } from '../../src/runtime/gateway/direct-answer-payload.js';
import { repairNeededPayload, validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import { schemaErrors as toolPayloadSchemaErrors } from '../../src/runtime/gateway/tool-payload-contract.js';
import type { GatewayRequest, SciForgeSkillDomain, SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';

const REQUIRED_TOOL_PAYLOAD_KEYS = ['message', 'claims', 'uiManifest', 'executionUnits', 'artifacts'] as const;

function smokeSchemaErrors(payload: unknown): string[] {
  const record = payload as Record<string, unknown>;
  return REQUIRED_TOOL_PAYLOAD_KEYS.filter((key) => !(key in record)).map((key) => `missing ${key}`);
}

async function smokeValidateAndNormalizePayload(
  payload: ToolPayload,
  _request: GatewayRequest,
  selectedSkill: SkillAvailability,
  refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string },
): Promise<ToolPayload> {
  return {
    ...payload,
    reasoningTrace: `${payload.reasoningTrace}\nSkill: ${selectedSkill.id}\nRuntime gateway refs: taskCodeRef=${refs.taskRel}, outputRef=${refs.outputRel}`,
    executionUnits: payload.executionUnits.map((unit) => ({ ...unit, skillId: selectedSkill.id, outputRef: refs.outputRel })),
    logs: [{ kind: 'stdout', ref: refs.stdoutRel }, { kind: 'stderr', ref: refs.stderrRel }],
  };
}

export function runtimeGatewaySkill(skillDomain: SciForgeSkillDomain = 'literature'): SkillAvailability {
  return {
    id: `agentserver.generation.${skillDomain}`,
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: new Date().toISOString(),
    manifestPath: 'agentserver',
    manifest: {
      id: `agentserver.generation.${skillDomain}`,
      kind: 'installed',
      description: 'smoke',
      skillDomains: [skillDomain],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'backend-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

export function makeGeneratedTaskRunnerDeps({
  request,
  requestBackendGeneration,
  useProductionPayloadValidation = false,
  tryGeneratedTaskRepairAndRerun = async () => undefined,
}: {
  request: GatewayRequest;
  requestBackendGeneration: GeneratedTaskRunnerDeps['requestBackendGeneration'];
  useProductionPayloadValidation?: boolean;
  tryGeneratedTaskRepairAndRerun?: GeneratedTaskRunnerDeps['tryGeneratedTaskRepairAndRerun'];
}): GeneratedTaskRunnerDeps {
  return {
    readConfiguredBackendBaseUrl: async () => 'http://agentserver.local',
    requestBackendGeneration,
    backendGenerationFailureReason: (error) => error,
    attemptPlanRefs: () => ({ scenarioPackageRef: request.scenarioPackageRef }),
    repairNeededPayload: (req, selectedSkill, reason, refs) => repairNeededPayload(req, selectedSkill, reason, refs),
    backendFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: useProductionPayloadValidation
      ? ensureDirectAnswerReportArtifact
      : (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: useProductionPayloadValidation
      ? validateAndNormalizePayload
      : smokeValidateAndNormalizePayload,
    tryGeneratedTaskRepairAndRerun,
    failedTaskPayload: (req, selectedSkill, _run, reason) => repairNeededPayload(req, selectedSkill, reason || 'failed'),
    coerceWorkspaceTaskPayload: useProductionPayloadValidation
      ? coerceWorkspaceTaskPayload
      : (value) => coerceBackendToolPayload(value),
    schemaErrors: useProductionPayloadValidation ? toolPayloadSchemaErrors : smokeSchemaErrors,
    normalizeToolPayloadShape: useProductionPayloadValidation
      ? normalizeToolPayloadShape
      : (payload) => payload,
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  };
}
