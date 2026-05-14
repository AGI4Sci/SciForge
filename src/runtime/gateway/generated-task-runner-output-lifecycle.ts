import { readdir, readFile, writeFile } from 'node:fs/promises';
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
import {
  downgradeTransientExternalFailures,
  externalProviderFailureDecision,
  firstTransientExternalFailureReason,
  payloadHasOnlyTransientExternalDependencyFailures,
  transientExternalDependencyPayload,
  transientExternalFailureReasonFromRun,
} from './transient-external-failure.js';

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
    const transientReason = transientExternalFailureReasonFromRun(run);
    if (transientReason) {
      return await completeTransientExternalBlockedLifecycle(input, transientReason, refs, { writeDiagnosticOutput: true });
    }
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
    return deps.failedTaskPayload(
      request,
      skill,
      run,
      repair.failureReason,
      failedTaskPartialEvidenceRefs(await collectGeneratedTaskPartialEvidenceRefs(workspace, refs), 'pre-output-failure'),
    );
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, input.outputRel), 'utf8')) as ToolPayload;
    const boundaryPayload = normalizeWorkspaceTaskPayloadBoundary(rawPayload) as ToolPayload;
    const payload = deps.coerceWorkspaceTaskPayload(boundaryPayload) ?? boundaryPayload;
    const rawErrors = deps.schemaErrors(rawPayload);
    const payloadErrors = deps.schemaErrors(payload);
    const errors = payloadErrors.length ? payloadErrors : [];
    let normalized = errors.length ? undefined : await deps.validateAndNormalizePayload(payload, request, skill, {
      ...refs,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    if (normalized) {
      normalized = await materializeBackendPayloadOutput(workspace, request, normalized, refs);
      normalized = downgradeTransientExternalFailures(normalized);
      if (payloadHasOnlyTransientExternalDependencyFailures(normalized)) {
        await appendGeneratedTaskAttemptLifecycle({
          workspacePath: workspace,
          request,
          skill,
          taskId,
          run,
          attemptPlanRefs: deps.attemptPlanRefs,
          status: 'failed-with-reason',
          ...refs,
          schemaErrors: errors,
          workEvidenceSummary: summarizeWorkEvidenceForHandoff(normalized),
          failureReason: firstTransientExternalFailureReason(normalized),
        });
        return normalized;
      }
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
    if (lifecycle.payloadFailureStatus && lifecycle.failureReason) {
      const externalBlocked = externalProviderFailureDecision({
        reason: lifecycle.failureReason,
        evidenceRefs: [refs.stdoutRel, refs.stderrRel, refs.outputRel],
      });
      if (externalBlocked) {
        return await completeTransientExternalBlockedLifecycle(input, externalBlocked.reason, refs);
      }
    }
    if (lifecycle.repair) {
      const externalBlocked = externalProviderFailureDecision({
        reason: lifecycle.repair.failureReason,
        evidenceRefs: [refs.stdoutRel, refs.stderrRel, refs.outputRel],
      });
      if (externalBlocked) {
        return await completeTransientExternalBlockedLifecycle(input, externalBlocked.reason, refs);
      }
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
        attemptSchemaErrors: errors.length ? errors : rawErrors,
        workEvidenceSummary: lifecycle.workEvidenceSummary,
        attemptFailureReason: lifecycle.attemptFailureReason,
        schemaErrors: errors.length ? errors : rawErrors,
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
    const transientReason = transientExternalFailureReasonFromRun(run);
    if (transientReason) {
      return await completeTransientExternalBlockedLifecycle(input, transientReason, refs);
    }
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
    return deps.failedTaskPayload(
      request,
      skill,
      run,
      repair.failureReason,
      failedTaskPartialEvidenceRefs(await collectGeneratedTaskPartialEvidenceRefs(workspace, refs), 'parse-output-failure'),
    );
  }
}

async function completeTransientExternalBlockedLifecycle(
  input: CompleteGeneratedTaskRunOutputLifecycleInput,
  reason: string,
  refs: GeneratedTaskRuntimeRefs,
  options: { writeDiagnosticOutput?: boolean } = {},
): Promise<ToolPayload> {
  const { deps, request, run, skill, taskId, workspace } = input;
  const payload = withGeneratedTaskPartialEvidence(
    transientExternalDependencyPayload({ request, skill, run, reason }),
    await collectGeneratedTaskPartialEvidenceRefs(workspace, refs),
    'transient-external-failure',
  );
  if (options.writeDiagnosticOutput) {
    await writeFile(join(workspace, input.outputRel), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  let normalized = await deps.validateAndNormalizePayload(payload, request, skill, {
    ...refs,
    runtimeFingerprint: run.runtimeFingerprint,
  });
  if (normalized) {
    normalized = await materializeBackendPayloadOutput(workspace, request, normalized, refs);
  }
  await appendGeneratedTaskAttemptLifecycle({
    workspacePath: workspace,
    request,
    skill,
    taskId,
    run,
    attemptPlanRefs: deps.attemptPlanRefs,
    status: 'failed-with-reason',
    ...refs,
    schemaErrors: [],
    workEvidenceSummary: summarizeWorkEvidenceForHandoff(normalized ?? payload),
    failureReason: reason,
  });
  return normalized ?? payload;
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

function failedTaskPartialEvidenceRefs(partialRefs: string[], failureKind: 'pre-output-failure' | 'parse-output-failure') {
  if (!partialRefs.length) return undefined;
  return {
    evidenceRefs: partialRefs,
    agentServerRefs: {
      partialEvidence: {
        kind: 'generated-task-partial-evidence',
        failureKind,
        preservedRefs: partialRefs,
        note: 'Generated task did not produce a valid final ToolPayload, but session-bundle partial files were preserved for continuation or repair.',
      },
    },
    recoverActions: [
      'Inspect preserved partial refs before rerunning expensive external fetches.',
      'Resume from the session bundle and write a valid partial ToolPayload/checkpoint before continuing retrieval.',
    ],
  };
}

function withGeneratedTaskPartialEvidence(
  payload: ToolPayload,
  partialRefs: string[],
  failureKind: 'transient-external-failure',
): ToolPayload {
  if (!partialRefs.length) return payload;
  return {
    ...payload,
    reasoningTrace: [
      payload.reasoningTrace,
      `partialEvidence=${partialRefs.length} session-bundle file ref(s) preserved after ${failureKind}`,
    ].filter(Boolean).join('\n'),
    executionUnits: payload.executionUnits.map((unit, index) => isRecord(unit) && index === 0
      ? {
        ...unit,
        refs: {
          ...(isRecord(unit.refs) ? unit.refs : {}),
          partialEvidence: {
            kind: 'generated-task-partial-evidence',
            failureKind,
            preservedRefs: partialRefs,
          },
        },
        recoverActions: [
          ...toStringArrayLocal(unit.recoverActions),
          'Inspect preserved partial refs before rerunning expensive external fetches.',
        ],
      }
      : unit),
    objectReferences: [
      ...(payload.objectReferences ?? []),
      ...partialRefs.map(objectReferenceForPartialRef),
    ],
    logs: [
      ...(payload.logs ?? []),
      {
        kind: 'generated-task-partial-evidence',
        failureKind,
        refs: partialRefs,
      },
    ],
  };
}

async function collectGeneratedTaskPartialEvidenceRefs(
  workspace: string,
  refs: GeneratedTaskRuntimeRefs,
) {
  const sessionRoot = inferSessionRootFromRef(refs.outputRel)
    ?? inferSessionRootFromRef(refs.taskRel)
    ?? inferSessionRootFromRef(refs.inputRel);
  if (!sessionRoot) return [];
  const roots = ['artifacts', 'task-results', 'data', 'exports']
    .map((name) => `${sessionRoot}/${name}`);
  const excluded = new Set([
    refs.taskRel,
    refs.inputRel,
    refs.outputRel,
    refs.stdoutRel,
    refs.stderrRel,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
  const partialRefs: string[] = [];
  for (const root of roots) {
    const collected = await collectFileRefs(workspace, root, excluded, 24 - partialRefs.length);
    partialRefs.push(...collected);
    if (partialRefs.length >= 24) break;
  }
  return Array.from(new Set(partialRefs));
}

function inferSessionRootFromRef(ref: string | undefined) {
  if (!ref) return undefined;
  const normalized = ref.replace(/\\/g, '/');
  const match = normalized.match(/^(\.sciforge\/sessions\/[^/]+)\//);
  return match?.[1];
}

async function collectFileRefs(
  workspace: string,
  rel: string,
  excluded: Set<string>,
  remaining: number,
): Promise<string[]> {
  if (remaining <= 0) return [];
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(join(workspace, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const refs: string[] = [];
  for (const entry of entries) {
    if (refs.length >= remaining) break;
    if (entry.name.startsWith('.')) continue;
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      refs.push(...await collectFileRefs(workspace, child, excluded, remaining - refs.length));
      continue;
    }
    if (!entry.isFile()) continue;
    if (excluded.has(child)) continue;
    if (!partialEvidencePathLooksUseful(child)) continue;
    refs.push(child);
  }
  return refs;
}

function partialEvidencePathLooksUseful(rel: string) {
  return /\.(?:pdf|json|jsonl|ndjson|md|csv|tsv|txt|png|jpe?g|svg|html)$/i.test(rel);
}

function objectReferenceForPartialRef(ref: string) {
  return {
    id: `file:${ref}`,
    title: ref.split('/').pop() ?? ref,
    kind: 'file',
    ref,
    status: 'available',
    actions: ['inspect', 'reveal-in-folder', 'copy-path'],
    provenance: { preservedFromFailedGeneratedTask: true },
  };
}

function toStringArrayLocal(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}
