import type { GeneratedTaskRunnerDeps } from '../../src/runtime/gateway/generated-task-runner.js';
import { coerceAgentServerToolPayload, coerceWorkspaceTaskPayload, ensureDirectAnswerReportArtifact } from '../../src/runtime/gateway/direct-answer-payload.js';
import { repairNeededPayload, validateAndNormalizePayload } from '../../src/runtime/gateway/payload-validation.js';
import { schemaErrors as toolPayloadSchemaErrors } from '../../src/runtime/gateway/tool-payload-contract.js';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';

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

export function runtimeGatewaySkill(): SkillAvailability {
  return {
    id: 'agentserver.generation.literature',
    kind: 'installed',
    available: true,
    reason: 'smoke',
    checkedAt: new Date().toISOString(),
    manifestPath: 'agentserver',
    manifest: {
      id: 'agentserver.generation.literature',
      kind: 'installed',
      description: 'smoke',
      skillDomains: ['literature'],
      inputContract: {},
      outputArtifactSchema: {},
      entrypoint: { type: 'agentserver-generation' },
      environment: {},
      validationSmoke: {},
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

export function makeGeneratedTaskRunnerDeps({
  request,
  requestAgentServerGeneration,
  useProductionPayloadValidation = false,
  tryAgentServerRepairAndRerun = async () => undefined,
}: {
  request: GatewayRequest;
  requestAgentServerGeneration: GeneratedTaskRunnerDeps['requestAgentServerGeneration'];
  useProductionPayloadValidation?: boolean;
  tryAgentServerRepairAndRerun?: GeneratedTaskRunnerDeps['tryAgentServerRepairAndRerun'];
}): GeneratedTaskRunnerDeps {
  return {
    readConfiguredAgentServerBaseUrl: async () => 'http://agentserver.local',
    requestAgentServerGeneration,
    agentServerGenerationFailureReason: (error) => error,
    attemptPlanRefs: () => ({ scenarioPackageRef: request.scenarioPackageRef }),
    repairNeededPayload: (req, selectedSkill, reason, refs) => repairNeededPayload(req, selectedSkill, reason, refs),
    agentServerFailurePayloadRefs: () => ({}),
    ensureDirectAnswerReportArtifact: useProductionPayloadValidation
      ? ensureDirectAnswerReportArtifact
      : (payload) => payload,
    mergeReusableContextArtifactsForDirectPayload: async (payload) => payload,
    validateAndNormalizePayload: useProductionPayloadValidation
      ? validateAndNormalizePayload
      : smokeValidateAndNormalizePayload,
    tryAgentServerRepairAndRerun,
    failedTaskPayload: (req, selectedSkill, _run, reason) => repairNeededPayload(req, selectedSkill, reason || 'failed'),
    coerceWorkspaceTaskPayload: useProductionPayloadValidation
      ? coerceWorkspaceTaskPayload
      : (value) => coerceAgentServerToolPayload(value),
    schemaErrors: useProductionPayloadValidation ? toolPayloadSchemaErrors : smokeSchemaErrors,
    firstPayloadFailureReason: () => undefined,
    payloadHasFailureStatus: () => false,
  };
}
