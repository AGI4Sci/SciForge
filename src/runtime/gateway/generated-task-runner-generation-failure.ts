import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { attachAgentServerCompletionCandidateArtifacts } from './generated-task-completion-candidate.js';
import { materializeBackendGenerationLifecyclePayload } from './generated-task-runner-payload-materialization.js';
import { literatureGenerationFailureRecoveryPayload } from './generated-task-runner-literature-recovery.js';
import {
  attachGeneratedTaskFailureBudgetDebit,
  appendGeneratedTaskGenerationFailureLifecycle,
  generatedTaskFailureBudgetDebitAuditRefs,
  generatedTaskFailureBudgetDebitId,
} from './generated-task-runner-validation-lifecycle.js';

const BACKEND_GENERATION_FAILURE_TASK_REF = 'backend-generation://generation-failure' as const;

type AttemptPlanRefs = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;

export interface BackendGenerationFailure {
  ok: false;
  error: string;
  diagnostics?: any;
}

export interface GeneratedTaskGenerationFailureLifecycleDeps {
  attemptPlanRefs: AttemptPlanRefs;
  backendFailurePayloadRefs(diagnostics?: any): Record<string, unknown>;
  backendGenerationFailureReason(error: string, diagnostics?: any): string;
  repairNeededPayload(request: GatewayRequest, skill: SkillAvailability, reason: string, refs?: Record<string, unknown>): ToolPayload;
  validateAndNormalizePayload(
    payload: ToolPayload,
    request: GatewayRequest,
    skill: SkillAvailability,
    refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
  ): Promise<ToolPayload>;
}

export async function completeBackendGenerationFailureRepairPayload(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: BackendGenerationFailure;
  deps: GeneratedTaskGenerationFailureLifecycleDeps;
}): Promise<ToolPayload> {
  const failureReason = input.deps.backendGenerationFailureReason(input.generation.error, input.generation.diagnostics);
  const failedRequestId = `backend-generation-${input.request.skillDomain}-${sha1(`${input.request.prompt}:${input.generation.error}`).slice(0, 12)}`;
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
    input.deps.backendFailurePayloadRefs(input.generation.diagnostics),
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
  return await materializeBackendGenerationLifecyclePayload({
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    payload,
    reason: failureReason,
    kind: literatureRecovery ? 'generation-failure-recovery' : 'generation-failure-repair',
    taskRel: BACKEND_GENERATION_FAILURE_TASK_REF,
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
