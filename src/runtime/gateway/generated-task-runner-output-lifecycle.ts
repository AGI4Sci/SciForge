import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { fileExists } from '../workspace-task-runner.js';
import { isRecord } from '../gateway-utils.js';
import { maybeWriteSkillPromotionProposal } from '../skill-promotion.js';
import { materializeBackendPayloadOutput } from './artifact-materializer.js';
import {
  attachGeneratedTaskSuccessBudgetDebit,
  appendGeneratedTaskAttemptLifecycle,
  assessGeneratedTaskValidationLifecycle,
  annotateGeneratedTaskGuardValidationFailurePayload,
  capabilityEvolutionLedgerRefsFromResult,
  generatedTaskSuccessBudgetDebitAuditRefs,
  generatedTaskSuccessBudgetDebitId,
  recordGeneratedTaskSuccessLedgerLifecycle,
  runGeneratedTaskParseRepairLifecycle,
  runGeneratedTaskPreOutputRepairLifecycle,
  runGeneratedTaskRepairAttemptLifecycle,
  type GeneratedTaskRuntimeRefs,
} from './generated-task-runner-validation-lifecycle.js';
import { tryAgentServerSupplementMissingArtifacts } from './generated-task-runner-supplement-lifecycle.js';
import type { AgentServerTaskFilesGeneration } from './generated-task-runner-generation-lifecycle.js';
import type { GeneratedTaskRunnerDeps } from './generated-task-runner.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import { normalizeWorkspaceTaskPayloadBoundary } from './direct-answer-payload.js';
import { schemaValidationRepairPayload } from './payload-validation.js';

type RunAgentServerGeneratedTask = (
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks | undefined,
  deps: GeneratedTaskRunnerDeps,
  options: { allowSupplement?: boolean },
) => Promise<ToolPayload | undefined>;

export interface CompleteGeneratedTaskRunOutputLifecycleInput extends GeneratedTaskRuntimeRefs {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: GeneratedTaskRunnerDeps;
  options?: { allowSupplement?: boolean };
  taskId: string;
  generation: AgentServerTaskFilesGeneration;
  run: WorkspaceTaskRunResult;
  supplementArtifactTypes: string[];
  runGeneratedTask: RunAgentServerGeneratedTask;
}

export async function completeGeneratedTaskRunOutputLifecycle(
  input: CompleteGeneratedTaskRunOutputLifecycleInput,
): Promise<ToolPayload> {
  const { deps, generation, request, run, skill, taskId, workspace } = input;
  const refs = runtimeRefs(input);

  if (run.exitCode !== 0 && !await fileExists(join(workspace, input.outputRel))) {
    const repair = await runGeneratedTaskPreOutputRepairLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      ...refs,
      attemptPlanRefs: deps.attemptPlanRefs,
      callbacks: input.callbacks,
      tryAgentServerRepairAndRerun: deps.tryAgentServerRepairAndRerun,
    });
    if (repair.repaired) return repair.repaired;
    return deps.failedTaskPayload(request, skill, run, repair.failureReason);
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, input.outputRel), 'utf8')) as ToolPayload;
    const boundaryPayload = normalizeWorkspaceTaskPayloadBoundary(rawPayload) as ToolPayload;
    const payload = deps.coerceWorkspaceTaskPayload(boundaryPayload) ?? boundaryPayload;
    const rawErrors = deps.schemaErrors(rawPayload);
    const errors = rawErrors.length ? rawErrors : deps.schemaErrors(payload);
    let normalized = errors.length ? undefined : await deps.validateAndNormalizePayload(payload, request, skill, {
      ...refs,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    if (normalized) {
      normalized = await materializeBackendPayloadOutput(workspace, request, normalized, refs);
    }

    const lifecycle = assessGeneratedTaskValidationLifecycle({
      payload,
      normalized,
      schemaErrors: errors,
      run,
      request,
      firstPayloadFailureReason: deps.firstPayloadFailureReason,
      payloadHasFailureStatus: deps.payloadHasFailureStatus,
    });
    if (lifecycle.repair) {
      const repaired = await runGeneratedTaskRepairAttemptLifecycle({
        workspacePath: workspace,
        request,
        skill,
        taskId,
        runId: generation.runId,
        run,
        payload: normalized ?? payload,
        ...refs,
        attemptPlanRefs: deps.attemptPlanRefs,
        attemptStatus: lifecycle.attemptStatus,
        attemptSchemaErrors: errors,
        workEvidenceSummary: lifecycle.workEvidenceSummary,
        attemptFailureReason: lifecycle.attemptFailureReason,
        schemaErrors: errors,
        failureReason: lifecycle.repair.failureReason,
        recoverActions: lifecycle.repair.recoverActions,
        callbacks: input.callbacks,
        tryAgentServerRepairAndRerun: deps.tryAgentServerRepairAndRerun,
      });
      if (repaired) return repaired;
      if (lifecycle.normalizedRepairNeeded && normalized) return normalized;
      if (errors.length) {
        return schemaValidationRepairPayload({
          payload,
          sourcePayload: rawPayload,
          errors,
          request,
          skill,
          refs,
        });
      }
      return await annotateGeneratedTaskGuardValidationFailurePayload({
        payload: deps.repairNeededPayload(request, skill, lifecycle.repair.failureReason),
        sourcePayload: normalized ?? payload,
        workspacePath: workspace,
        request,
        skill,
        refs,
        schemaErrors: errors,
        guardFinding: lifecycle.guardFinding,
      });
    }

    await appendGeneratedTaskAttemptLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      run,
      attemptPlanRefs: deps.attemptPlanRefs,
      status: lifecycle.attemptStatus,
      ...refs,
      schemaErrors: errors,
      workEvidenceSummary: lifecycle.workEvidenceSummary,
      failureReason: lifecycle.attemptFailureReason,
      budgetDebitRefs: [generatedTaskSuccessBudgetDebitId({
        request,
        skill,
        taskId,
        runId: generation.runId,
        refs,
        source: 'generated-task',
      })],
      budgetDebitAuditRefs: generatedTaskSuccessBudgetDebitAuditRefs({
        request,
        skill,
        taskId,
        runId: generation.runId,
        refs,
        source: 'generated-task',
      }),
    });
    if (!normalized) {
      return deps.repairNeededPayload(request, skill, 'AgentServer generated task output could not be normalized after schema validation.');
    }

    if (input.options?.allowSupplement !== false) {
      const supplemented = await tryAgentServerSupplementMissingArtifacts({
        request,
        skill,
        skills: input.skills,
        workspace,
        payload: normalized,
        primaryTaskId: taskId,
        primaryRunId: generation.runId,
        primaryRun: run,
        primaryRefs: refs,
        expectedArtifactTypes: input.supplementArtifactTypes,
        callbacks: input.callbacks,
        deps,
        runGeneratedTask: input.runGeneratedTask,
      });
      if (supplemented) {
        const completed = await completeSuccessfulGeneratedTaskPayload(input, supplemented);
        const ledgerResult = await recordGeneratedTaskSuccessLedgerLifecycle({
          workspacePath: workspace,
          request,
          skill,
          taskId,
          runId: generation.runId,
          run,
          payload: completed,
          refs,
        });
        const completedWithDebit = attachGeneratedTaskSuccessBudgetDebit({
          request,
          skill,
          taskId,
          runId: generation.runId,
          payload: completed,
          refs,
          source: 'generated-task',
          runtimeLabel: 'AgentServer generated workspace task with supplemental fallback',
          ledgerRefs: capabilityEvolutionLedgerRefsFromResult(ledgerResult),
        });
        const generatedDebit = completedWithDebit.budgetDebits?.find((debit) => debit.capabilityId === 'sciforge.generated-task-runner');
        if (generatedDebit) {
          await appendGeneratedTaskAttemptLifecycle({
            workspacePath: workspace,
            request,
            skill,
            taskId,
            run,
            attemptPlanRefs: deps.attemptPlanRefs,
            status: lifecycle.attemptStatus,
            ...refs,
            schemaErrors: errors,
            workEvidenceSummary: summarizeWorkEvidenceForHandoff(completedWithDebit),
            failureReason: lifecycle.attemptFailureReason,
            budgetDebitRefs: [generatedDebit.debitId],
            budgetDebitAuditRefs: generatedDebit.sinkRefs.auditRefs,
          });
        }
        return await materializeBackendPayloadOutput(workspace, request, completedWithDebit, refs);
      }
    }

    if (lifecycle.normalizedFailureStatus) return normalized;
    const completed = await completeSuccessfulGeneratedTaskPayload(input, normalized);
    const ledgerResult = await recordGeneratedTaskSuccessLedgerLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      payload: completed,
      refs,
    });
    const completedWithDebit = attachGeneratedTaskSuccessBudgetDebit({
      request,
      skill,
      taskId,
      runId: generation.runId,
      payload: completed,
      refs,
      source: 'generated-task',
      runtimeLabel: 'AgentServer generated workspace task',
      ledgerRefs: capabilityEvolutionLedgerRefsFromResult(ledgerResult),
    });
    const generatedDebit = completedWithDebit.budgetDebits?.find((debit) => debit.capabilityId === 'sciforge.generated-task-runner');
    if (generatedDebit) {
      await appendGeneratedTaskAttemptLifecycle({
        workspacePath: workspace,
        request,
        skill,
        taskId,
        run,
        attemptPlanRefs: deps.attemptPlanRefs,
        status: lifecycle.attemptStatus,
        ...refs,
        schemaErrors: errors,
        workEvidenceSummary: summarizeWorkEvidenceForHandoff(completedWithDebit),
        failureReason: lifecycle.attemptFailureReason,
        budgetDebitRefs: [generatedDebit.debitId],
        budgetDebitAuditRefs: generatedDebit.sinkRefs.auditRefs,
      });
    }
    return await materializeBackendPayloadOutput(workspace, request, completedWithDebit, refs);
  } catch (error) {
    const repair = await runGeneratedTaskParseRepairLifecycle({
      workspacePath: workspace,
      request,
      skill,
      taskId,
      runId: generation.runId,
      run,
      ...refs,
      attemptPlanRefs: deps.attemptPlanRefs,
      error,
      callbacks: input.callbacks,
      tryAgentServerRepairAndRerun: deps.tryAgentServerRepairAndRerun,
    });
    if (repair.repaired) return repair.repaired;
    return deps.failedTaskPayload(request, skill, run, repair.failureReason);
  }
}

async function completeSuccessfulGeneratedTaskPayload(
  input: CompleteGeneratedTaskRunOutputLifecycleInput,
  normalized: ToolPayload,
): Promise<ToolPayload> {
  const proposal = await maybeWriteSkillPromotionProposal({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    taskRel: input.taskRel,
    inputRef: input.inputRel,
    outputRef: input.outputRel,
    stdoutRef: input.stdoutRel,
    stderrRef: input.stderrRel,
    payload: normalized,
    patchSummary: input.generation.response.patchSummary,
  });
  return {
    ...normalized,
    reasoningTrace: [
      normalized.reasoningTrace,
      `AgentServer generation run: ${input.generation.runId || 'unknown'}`,
      `Generation summary: ${input.generation.response.patchSummary || 'task generated'}`,
      proposal ? `Skill promotion proposal: .sciforge/skill-proposals/${proposal.id}` : '',
    ].filter(Boolean).join('\n'),
    executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
      ...unit,
      ...input.deps.attemptPlanRefs(input.request, input.skill),
      agentServerGenerated: true,
      agentServerRunId: input.generation.runId,
      patchSummary: input.generation.response.patchSummary,
    } : unit),
  };
}

function runtimeRefs(input: GeneratedTaskRuntimeRefs): GeneratedTaskRuntimeRefs {
  return {
    taskRel: input.taskRel,
    inputRel: input.inputRel,
    outputRel: input.outputRel,
    stdoutRel: input.stdoutRel,
    stderrRel: input.stderrRel,
  };
}
