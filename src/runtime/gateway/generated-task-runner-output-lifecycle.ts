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
import { tryBackendSupplementMissingArtifacts } from './generated-task-runner-supplement-lifecycle.js';
import type { BackendTaskFilesGeneration } from './generated-task-runner-generation-lifecycle.js';
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

type RunGeneratedTaskBackend = (
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
  generation: BackendTaskFilesGeneration;
  run: WorkspaceTaskRunResult;
  supplementArtifactTypes: string[];
  runGeneratedTask: RunGeneratedTaskBackend;
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
      tryGeneratedTaskRepairAndRerun: deps.tryGeneratedTaskRepairAndRerun,
    });
    if (repair.repaired) return repair.repaired;
    const partialRefs = await collectGeneratedTaskPartialEvidenceRefs(workspace, refs);
    return attachGeneratedTaskCompletionCandidate(
      deps.failedTaskPayload(
        request,
        skill,
        run,
        repair.failureReason,
        failedTaskPartialEvidenceRefs(partialRefs, 'pre-output-failure'),
      ),
      partialRefs,
      'pre-output-failure',
    );
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, input.outputRel), 'utf8')) as ToolPayload;
    const boundaryPayload = normalizeWorkspaceTaskPayloadBoundary(rawPayload) as ToolPayload;
    const payload = deps.coerceWorkspaceTaskPayload(boundaryPayload) ?? boundaryPayload;
    const rawErrors = deps.schemaErrors(rawPayload);
    const shapedPayload = deps.normalizeToolPayloadShape(payload);
    const errors = deps.schemaErrors(shapedPayload);
    let normalized = errors.length ? undefined : await deps.validateAndNormalizePayload(shapedPayload, request, skill, {
      ...refs,
      runtimeFingerprint: run.runtimeFingerprint,
    });
    if (normalized) {
      normalized = await materializeBackendPayloadOutput(workspace, request, normalized, refs);
      normalized = downgradeTransientExternalFailures(normalized);
      if (payloadHasOnlyTransientExternalDependencyFailures(normalized)) {
        const transientFailureReason = firstTransientExternalFailureReason(normalized);
        normalized = annotateExternalBlockedExecutionUnits(normalized, transientFailureReason, refs);
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
          failureReason: transientFailureReason,
        });
        return normalized;
      }
    }

    const lifecycle = assessGeneratedTaskValidationLifecycle({
      payload: shapedPayload,
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
        payload: normalized ?? shapedPayload,
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
        tryGeneratedTaskRepairAndRerun: deps.tryGeneratedTaskRepairAndRerun,
      });
      if (repaired) return repaired;
      if (lifecycle.normalizedRepairNeeded && normalized) return normalized;
      if (errors.length) {
        return schemaValidationRepairPayload({
          payload: shapedPayload,
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
      return deps.repairNeededPayload(request, skill, 'backend-generated task output could not be normalized after schema validation.');
    }

    if (input.options?.allowSupplement !== false) {
      const supplemented = await tryBackendSupplementMissingArtifacts({
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
          runtimeLabel: 'backend-generated workspace task with supplemental fallback',
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
        return await materializeCompletedGeneratedTaskPayload(input, completedWithDebit, refs);
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
      runtimeLabel: 'backend-generated workspace task',
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
    return await materializeCompletedGeneratedTaskPayload(input, completedWithDebit, refs);
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
      tryGeneratedTaskRepairAndRerun: deps.tryGeneratedTaskRepairAndRerun,
    });
    if (repair.repaired) return repair.repaired;
    const partialRefs = await collectGeneratedTaskPartialEvidenceRefs(workspace, refs);
    return attachGeneratedTaskCompletionCandidate(
      deps.failedTaskPayload(
        request,
        skill,
        run,
        repair.failureReason,
        failedTaskPartialEvidenceRefs(partialRefs, 'parse-output-failure'),
      ),
      partialRefs,
      'parse-output-failure',
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
  const partialRefs = await collectGeneratedTaskPartialEvidenceRefs(workspace, refs);
  const payload = withGeneratedTaskPartialEvidence(
    transientExternalDependencyPayload({ request, skill, run, reason }),
    partialRefs,
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
  return attachGeneratedTaskCompletionCandidate(normalized ?? payload, partialRefs, 'transient-external-failure');
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
      `backend generation run: ${input.generation.runId || 'unknown'}`,
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

async function materializeCompletedGeneratedTaskPayload(
  input: CompleteGeneratedTaskRunOutputLifecycleInput,
  payload: ToolPayload,
  refs: GeneratedTaskRuntimeRefs,
): Promise<ToolPayload> {
  const materialized = await materializeBackendPayloadOutput(input.workspace, input.request, payload, refs);
  const rerunPatched = await ensureGeneratedTaskReportRerunCommand(input, materialized);
  if (rerunPatched === materialized) return materialized;
  return await materializeBackendPayloadOutput(input.workspace, input.request, rerunPatched, refs);
}

async function ensureGeneratedTaskReportRerunCommand(
  input: CompleteGeneratedTaskRunOutputLifecycleInput,
  payload: ToolPayload,
): Promise<ToolPayload> {
  const rerunCommand = generatedTaskRerunCommand(input);
  if (!rerunCommand) return payload;
  const patches = new Map<number, { ref?: string; text: string; changed: boolean }>();
  await Promise.all(payload.artifacts.map(async (artifact, index) => {
    if (!isRecord(artifact) || !artifactLooksLikeReport(artifact)) return;
    let selectedText: string | undefined;
    let selectedRef: string | undefined;
    let changed = false;
    for (const ref of artifactReadableRefCandidates(artifact)) {
      const abs = artifactRefToAbsPath(ref, input.workspace);
      if (!abs) continue;
      try {
        const text = await readFile(abs, 'utf8');
        const patched = replaceOrAppendRerunCommand(text, rerunCommand);
        selectedText = patched;
        selectedRef = ref;
        if (patched !== text) {
          await writeFile(abs, patched, 'utf8');
          changed = true;
        }
        break;
      } catch {
        // Report refs are best-effort; artifact materialization still owns delivery validation.
      }
    }
    const inlineText = artifactInlineReportText(artifact);
    if (inlineText) {
      const patchedInline = replaceOrAppendRerunCommand(inlineText, rerunCommand);
      if (!selectedText || patchedInline !== inlineText) selectedText = patchedInline;
      changed = changed || patchedInline !== inlineText;
    }
    if (selectedText) patches.set(index, { ref: selectedRef, text: selectedText, changed });
  }));
  let changed = false;
  const artifacts = payload.artifacts.map((artifact, index) => {
    if (!isRecord(artifact) || !artifactLooksLikeReport(artifact)) return artifact;
    const patch = patches.get(index);
    if (!patch) return artifact;
    const inline = patchArtifactInlineReportText(artifact, patch.text);
    changed = changed || patch.changed || inline.changed;
    if (!patch.changed && !inline.changed) return artifact;
    return {
      ...artifact,
      ...inline.topLevel,
      data: inline.data,
      metadata: {
        ...(isRecord(artifact.metadata) ? artifact.metadata : {}),
        rerunCommand,
        rerunCommandPatchedBy: 'sciforge.generated-task-output-lifecycle',
      },
    };
  });
  if (!changed) return payload;
  return {
    ...payload,
    reasoningTrace: [
      payload.reasoningTrace,
      `SciForge normalized generated report rerun command: ${rerunCommand}`,
    ].filter(Boolean).join('\n'),
    artifacts,
  };
}

function generatedTaskRerunCommand(input: CompleteGeneratedTaskRunOutputLifecycleInput) {
  const workspace = input.workspace;
  if (!input.inputRel) return undefined;
  const taskAbs = join(workspace, input.taskRel);
  const inputAbs = join(workspace, input.inputRel);
  const rerunOutputRel = input.outputRel.replace(/\.json$/i, '.rerun.json');
  const outputAbs = join(workspace, rerunOutputRel);
  return [
    'cd',
    shellQuote(workspace),
    '&&',
    'python',
    shellQuote(taskAbs),
    shellQuote(inputAbs),
    shellQuote(outputAbs),
  ].join(' ');
}

function replaceOrAppendRerunCommand(text: string, command: string) {
  const block = `\`\`\`bash\n${command}\n\`\`\``;
  const headingPattern = /(^|\n)(#{1,6}\s*(?:\d+\.\s*)?Rerun Command[^\n]*\n)(?:```[\s\S]*?```|[^\n]*(?:\n|$))?/i;
  if (headingPattern.test(text)) {
    return text.replace(headingPattern, (_match, prefix: string, heading: string) => `${prefix}${heading}${block}\n`);
  }
  return `${text.trimEnd()}\n\n## Rerun Command\n${block}\n`;
}

function artifactInlineReportText(artifact: Record<string, unknown>) {
  return reportTextFromValue(artifact.data) ?? reportTextFromValue(artifact);
}

function reportTextFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (!isRecord(value)) return undefined;
  for (const field of ['markdown', 'reportMarkdown', 'report', 'content', 'text']) {
    const text = value[field];
    if (typeof text === 'string' && text.trim()) return text;
  }
  return undefined;
}

function patchArtifactInlineReportText(artifact: Record<string, unknown>, text: string) {
  const dataPatch = patchReportTextFields(artifact.data, text);
  const topLevelPatch = patchReportTextFields(artifact, text);
  return {
    data: dataPatch.value,
    topLevel: topLevelPatch.value && isRecord(topLevelPatch.value) ? topLevelPatch.value : {},
    changed: dataPatch.changed || topLevelPatch.changed,
  };
}

function patchReportTextFields(value: unknown, text: string): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    if (!value.trim() || value === text) return { value, changed: false };
    return { value: text, changed: true };
  }
  if (!isRecord(value)) return { value, changed: false };
  let changed = false;
  const next = { ...value };
  for (const field of ['markdown', 'reportMarkdown', 'report', 'content', 'text']) {
    const current = value[field];
    if (typeof current === 'string' && current.trim() && current !== text) {
      next[field] = text;
      changed = true;
    }
  }
  return { value: changed ? next : value, changed };
}

function artifactLooksLikeReport(artifact: Record<string, unknown>) {
  const type = String(artifact.type ?? artifact.kind ?? artifact.id ?? '').toLowerCase();
  const title = String(artifact.title ?? artifact.label ?? '').toLowerCase();
  return /report|markdown|analysis/.test(`${type} ${title}`)
    || artifactReadableRefCandidates(artifact).some((ref) => /\.m(?:d|arkdown)(?:$|[?#])/i.test(ref));
}

function artifactReadableRefCandidates(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const delivery = isRecord(artifact.delivery) ? artifact.delivery : {};
  return [
    delivery.readableRef,
    metadata.readableRef,
    metadata.markdownRef,
    metadata.reportRef,
    artifact.dataRef,
    artifact.path,
    artifact.ref,
    metadata.path,
    metadata.filePath,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function artifactRefToAbsPath(ref: string, workspace: string) {
  const trimmed = ref.trim();
  if (!trimmed || /^artifact:|^runtime:|^execution-unit:/i.test(trimmed)) return undefined;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return trimmed.replace(/^file:\/\//i, '');
    }
  }
  if (trimmed.startsWith('/')) return trimmed;
  if (/^[a-z]+:\/\//i.test(trimmed)) return undefined;
  return join(workspace, trimmed.replace(/^file:/i, '').replace(/^path:/i, '').replace(/^\.\//, ''));
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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

function annotateExternalBlockedExecutionUnits(
  payload: ToolPayload,
  failureReason: string | undefined,
  refs: GeneratedTaskRuntimeRefs,
): ToolPayload {
  const failureOwner = failureReason
    ? externalProviderFailureDecision({
      reason: failureReason,
      evidenceRefs: [refs.stdoutRel, refs.stderrRel, refs.outputRel],
    })
    : undefined;
  return {
    ...payload,
    executionUnits: payload.executionUnits.map((unit) => isRecord(unit) && unit.externalDependencyStatus === 'transient-unavailable'
      ? {
        conversationKernelStatus: 'external-blocked',
        failureOwner,
        ...unit,
      }
      : unit),
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

function attachGeneratedTaskCompletionCandidate(
  payload: ToolPayload,
  partialRefs: string[],
  failureKind: 'pre-output-failure' | 'parse-output-failure' | 'transient-external-failure',
): ToolPayload {
  const artifactRefs = partialRefs
    .filter((ref) => !/\.json$/i.test(ref))
    .map((ref) => `artifact:${artifactIdFromPartialRef(ref)}`);
  if (!artifactRefs.length) return payload;
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  return {
    ...payload,
    displayIntent: {
      ...displayIntent,
      completionCandidate: {
        schemaVersion: 'sciforge.completion-candidate.v1',
        status: 'unverified',
        failureKind,
        summary: '发现可用结果，待导入、验证或人工确认后才能作为最终答案。',
        artifactRefs: Array.from(new Set(artifactRefs)),
        auditRefs: partialRefs,
        recoverActions: [
          '导入并验证候选结果',
          'Inspect preserved partial refs before rerunning expensive external work.',
        ],
      },
    },
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

function artifactIdFromPartialRef(ref: string) {
  const name = ref.split('/').filter(Boolean).pop() ?? ref;
  return name
    .replace(/\.[a-z0-9]{1,12}$/i, '')
    .replace(/[^a-z0-9_.-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    || 'completion-candidate';
}

function toStringArrayLocal(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}
