import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { attachAgentServerCompletionCandidateArtifacts } from './agentserver-completion-candidate.js';
import { materializeAgentServerGenerationLifecyclePayload } from './generated-task-runner-payload-materialization.js';
import { literatureGenerationFailureRecoveryPayload } from './generated-task-runner-literature-recovery.js';
import {
  attachGeneratedTaskFailureBudgetDebit,
  appendGeneratedTaskGenerationFailureLifecycle,
  generatedTaskFailureBudgetDebitAuditRefs,
  generatedTaskFailureBudgetDebitId,
} from './generated-task-runner-validation-lifecycle.js';

const AGENTSERVER_GENERATION_FAILURE_TASK_REF = 'agentserver://generation-failure' as const;

type AttemptPlanRefs = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;

export interface AgentServerGenerationFailure {
  ok: false;
  error: string;
  diagnostics?: any;
}

export interface GeneratedTaskGenerationFailureLifecycleDeps {
  attemptPlanRefs: AttemptPlanRefs;
  agentServerFailurePayloadRefs(diagnostics?: any): Record<string, unknown>;
  agentServerGenerationFailureReason(error: string, diagnostics?: any): string;
  repairNeededPayload(request: GatewayRequest, skill: SkillAvailability, reason: string, refs?: Record<string, unknown>): ToolPayload;
  validateAndNormalizePayload(
    payload: ToolPayload,
    request: GatewayRequest,
    skill: SkillAvailability,
    refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
  ): Promise<ToolPayload>;
}

export async function completeAgentServerGenerationFailureRepairPayload(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerGenerationFailure;
  deps: GeneratedTaskGenerationFailureLifecycleDeps;
}): Promise<ToolPayload> {
  const failureReason = input.deps.agentServerGenerationFailureReason(input.generation.error, input.generation.diagnostics);
  const failedRequestId = `agentserver-generation-${input.request.skillDomain}-${sha1(`${input.request.prompt}:${input.generation.error}`).slice(0, 12)}`;
  const budgetDebitInput = {
    request: input.request,
    skill: input.skill,
    failedRequestId,
    failureReason,
    diagnostics: input.generation.diagnostics,
  };
  await appendGeneratedTaskGenerationFailureLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    failedRequestId,
    failureReason,
    diagnostics: input.generation.diagnostics,
    attemptPlanRefs: input.deps.attemptPlanRefs,
    budgetDebitRefs: [generatedTaskFailureBudgetDebitId(budgetDebitInput)],
    budgetDebitAuditRefs: generatedTaskFailureBudgetDebitAuditRefs(budgetDebitInput),
  });
  const repairPayload = input.deps.repairNeededPayload(
    input.request,
    input.skill,
    failureReason,
    input.deps.agentServerFailurePayloadRefs(input.generation.diagnostics),
  );
  const salvagedPayload = attachAgentServerCompletionCandidateArtifacts({
    payload: repairPayload,
    workspace: input.workspace,
    workEvidence: input.generation.diagnostics?.sideEffectWorkEvidence,
    failureKind: input.generation.diagnostics?.kind,
  });
  const literatureRecovery = await generationFailureLiteratureRecoveryPayload({
    request: input.request,
    failureReason,
    diagnostics: input.generation.diagnostics,
  });
  const payload = attachGeneratedTaskFailureBudgetDebit({
    ...budgetDebitInput,
    payload: literatureRecovery ?? salvagedPayload,
  });
  return await materializeAgentServerGenerationLifecyclePayload({
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    payload,
    reason: failureReason,
    kind: literatureRecovery ? 'generation-failure-recovery' : 'generation-failure-repair',
    taskRel: AGENTSERVER_GENERATION_FAILURE_TASK_REF,
  });
}

async function generationFailureLiteratureRecoveryPayload(input: {
  request: GatewayRequest;
  failureReason: string;
  diagnostics?: any;
}) {
  const hasAgentServerSideEffectWork = Array.isArray(input.diagnostics?.sideEffectWorkEvidence)
    && input.diagnostics.sideEffectWorkEvidence.some((entry: unknown) => (
      isRecord(entry) && entry.kind === 'write' && entry.status === 'success'
    ));
  const shouldPreferLiteratureRecovery = !hasAgentServerSideEffectWork
    || /malformed|incomplete|AgentServerGenerationResponse|taskFiles/i.test(input.failureReason);
  return shouldPreferLiteratureRecovery
    ? await literatureGenerationFailureRecoveryPayload(input.request, input.failureReason)
    : undefined;
}
