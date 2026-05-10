import { writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';
import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { GatewayRequest, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult, WorkspaceTaskSpec } from '../runtime-types.js';
import { errorMessage, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { appendTaskAttempt, readRecentTaskAttempts } from '../task-attempt-history.js';
import { sha1 } from '../workspace-task-runner.js';
import type { CapabilityEvolutionRuntimeEventResult } from './capability-evolution-events.js';
import type { RuntimeRefBundle } from './artifact-materializer.js';
import { currentTurnReferences } from './agentserver-context-window.js';
import { summarizeTaskAttemptsForAgentServer } from './context-envelope.js';
import {
  evaluateGuidanceAdoption,
  GUIDANCE_ADOPTION_GUARD_CONTRACT_ID,
  GUIDANCE_ADOPTION_GUARD_SCHEMA_PATH,
  type GuidanceAdoptionFinding,
  validationFindingProjectionFromGuidanceAdoptionFinding,
} from './guidance-adoption-guard.js';
import { selectedComponentIdsForRequest } from './gateway-request.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import {
  evaluateToolPayloadEvidence,
  type WorkEvidenceGuardFinding,
  validationFindingProjectionFromWorkEvidenceGuardFinding,
} from './work-evidence-guard.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import {
  attachValidationRepairAuditChainToPayload,
  createValidationRepairAuditChain,
} from './validation-repair-audit-bridge.js';
import { recordValidationRepairTelemetryForPayload } from './validation-repair-telemetry-runtime.js';

type RepairAttemptRunner = (params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  taskPrefix: string;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}) => Promise<ToolPayload | undefined>;

type GeneratedTaskAttemptStatus = 'done' | 'repair-needed' | 'failed-with-reason';
type AttemptPlanRefs = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;
type GeneratedTaskSuccessBudgetDebitSource = 'generated-task' | 'agentserver-direct-payload';
type GeneratedTaskGuardFinding =
  | { source: 'work-evidence'; finding: WorkEvidenceGuardFinding }
  | { source: 'guidance-adoption'; finding: GuidanceAdoptionFinding };

export interface GeneratedTaskRuntimeRefs extends RuntimeRefBundle {
  inputRel?: string;
}

export interface GeneratedTaskValidationLifecycleInput {
  payload: ToolPayload;
  normalized?: ToolPayload;
  schemaErrors: string[];
  run: WorkspaceTaskRunResult;
  request: GatewayRequest;
  firstPayloadFailureReason(payload: ToolPayload, run?: WorkspaceTaskRunResult): string | undefined;
  payloadHasFailureStatus(payload: ToolPayload): boolean;
}

export interface GeneratedTaskValidationLifecycle {
  workEvidenceSummary: ReturnType<typeof summarizeWorkEvidenceForHandoff>;
  normalizedFailureStatus: boolean;
  normalizedRepairNeeded: boolean;
  payloadFailureStatus: boolean;
  failureReason?: string;
  attemptFailureReason?: string;
  attemptStatus: GeneratedTaskAttemptStatus;
  guardFinding?: GeneratedTaskGuardFinding;
  repair?: {
    failureReason: string;
    recoverActions: string[];
  };
}

export interface GeneratedTaskDirectPayloadLifecycleInput {
  payload: ToolPayload;
  request: GatewayRequest;
  firstPayloadFailureReason(payload: ToolPayload, run?: WorkspaceTaskRunResult): string | undefined;
  payloadHasFailureStatus(payload: ToolPayload): boolean;
}

export interface GeneratedTaskDirectPayloadLifecycle {
  workEvidenceSummary: ReturnType<typeof summarizeWorkEvidenceForHandoff>;
  payloadFailureStatus: boolean;
  failureReason?: string;
  attemptStatus: GeneratedTaskAttemptStatus;
  guardFailureReason?: string;
  guardFinding?: GeneratedTaskGuardFinding;
}

export interface GeneratedTaskRepairAuditLifecycleInput {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  runId?: string;
  run: WorkspaceTaskRunResult;
  payload?: ToolPayload;
  taskRel: string;
  inputRel?: string;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
  schemaErrors: string[];
  failureReason: string;
  recoverActions: string[];
  callbacks?: WorkspaceRuntimeCallbacks;
  tryAgentServerRepairAndRerun: RepairAttemptRunner;
}

export interface GeneratedTaskAttemptLifecycleInput extends GeneratedTaskRuntimeRefs {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  run: WorkspaceTaskRunResult;
  attemptPlanRefs: AttemptPlanRefs;
  status: GeneratedTaskAttemptStatus;
  schemaErrors?: string[];
  workEvidenceSummary?: ReturnType<typeof summarizeWorkEvidenceForHandoff>;
  failureReason?: string;
  budgetDebitRefs?: string[];
  budgetDebitAuditRefs?: string[];
}

export interface GeneratedTaskRunInputLifecycleInput {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generatedInputRels: string[];
  expectedArtifacts: string[];
}

export interface GeneratedTaskRunInputLifecycle {
  taskInput: WorkspaceTaskSpec['input'];
  retentionProtectedInputRels: string[];
}

export interface GeneratedTaskGenerationFailureLifecycleInput {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  failedRequestId: string;
  failureReason: string;
  diagnostics?: any;
  attemptPlanRefs: AttemptPlanRefs;
}

export interface GeneratedTaskDirectPayloadAttemptLifecycleInput {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  runId?: string;
  refs: RuntimeRefBundle;
  payload?: ToolPayload;
  lifecycle: GeneratedTaskDirectPayloadLifecycle;
  attemptPlanRefs: AttemptPlanRefs;
  budgetDebitRefs?: string[];
  budgetDebitAuditRefs?: string[];
}

export interface GeneratedTaskRepairAttemptLifecycleInput extends GeneratedTaskRepairAuditLifecycleInput {
  attemptPlanRefs: AttemptPlanRefs;
  attemptStatus: GeneratedTaskAttemptStatus;
  attemptSchemaErrors?: string[];
  workEvidenceSummary?: ReturnType<typeof summarizeWorkEvidenceForHandoff>;
  attemptFailureReason?: string;
}

export interface GeneratedTaskSuccessLedgerInput extends GeneratedTaskRuntimeRefs {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  runId?: string;
  run: WorkspaceTaskRunResult;
  payload: ToolPayload;
}

export interface GeneratedTaskSuccessLedgerLifecycleInput extends Omit<GeneratedTaskSuccessLedgerInput, keyof GeneratedTaskRuntimeRefs> {
  refs: GeneratedTaskRuntimeRefs;
}

export interface AgentServerDirectPayloadSuccessLedgerLifecycleInput {
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  runId?: string;
  payload: ToolPayload;
  refs: RuntimeRefBundle;
}

export interface GeneratedTaskSuccessBudgetDebitInput {
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  runId?: string;
  payload: ToolPayload;
  refs: Pick<GeneratedTaskRuntimeRefs, 'taskRel' | 'outputRel' | 'stdoutRel' | 'stderrRel'> & Partial<Pick<GeneratedTaskRuntimeRefs, 'inputRel'>>;
  source: GeneratedTaskSuccessBudgetDebitSource;
  runtimeLabel: string;
  ledgerRefs?: string[];
}

export function assessGeneratedTaskDirectPayloadLifecycle(
  input: GeneratedTaskDirectPayloadLifecycleInput,
): GeneratedTaskDirectPayloadLifecycle {
  const guardFinding = evaluateGeneratedTaskGuardFinding(input.payload, input.request);
  const workEvidenceSummary = summarizeWorkEvidenceForHandoff(input.payload);
  const payloadFailureReason = input.firstPayloadFailureReason(input.payload)
    ?? firstRepairOrFailurePayloadReason(input.payload);
  const payloadFailureStatus = input.payloadHasFailureStatus(input.payload) || payloadHasRepairOrFailureStatus(input.payload);
  const guardFailureReason = !payloadFailureStatus ? guardFinding?.finding.reason : undefined;
  const failureReason = payloadFailureReason ?? guardFailureReason;
  const attemptStatus = guardFinding
    ? guardFinding.finding.severity
    : payloadFailureStatus
        ? payloadAttemptStatus(input.payload)
        : 'done';

  return {
    workEvidenceSummary,
    payloadFailureStatus,
    failureReason,
    attemptStatus,
    guardFailureReason,
    guardFinding,
  };
}

export function assessGeneratedTaskValidationLifecycle(
  input: GeneratedTaskValidationLifecycleInput,
): GeneratedTaskValidationLifecycle {
  const {
    firstPayloadFailureReason,
    normalized,
    payload,
    payloadHasFailureStatus,
    request,
    run,
    schemaErrors,
  } = input;
  const guardFinding = normalized ? evaluateGeneratedTaskGuardFinding(normalized, request) : undefined;
  const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized ?? payload);
  const normalizedFailureReason = normalized
    ? firstPayloadFailureReason(normalized, run) ?? firstRepairOrFailurePayloadReason(normalized)
    : undefined;
  const normalizedFailureStatus = normalized
    ? payloadHasFailureStatus(normalized) || payloadHasRepairOrFailureStatus(normalized)
    : false;
  const normalizedRepairNeeded = normalized ? payloadHasRepairNeededStatus(normalized) : false;
  const payloadFailureReason = firstPayloadFailureReason(payload, run)
    ?? firstRepairOrFailurePayloadReason(payload)
    ?? normalizedFailureReason;
  const payloadFailureStatus = payloadHasFailureStatus(payload) || payloadHasRepairOrFailureStatus(payload) || normalizedFailureStatus;
  const evidenceFailureReason = !payloadFailureStatus ? guardFinding?.finding.reason : undefined;
  const failureReason = payloadFailureReason ?? evidenceFailureReason;
  const shouldRepairExecutionFailure = schemaErrors.length === 0 && Boolean(failureReason)
    && (run.exitCode !== 0 || Boolean(evidenceFailureReason) || normalizedRepairNeeded);
  const attemptStatus = schemaErrors.length
    ? 'repair-needed'
    : shouldRepairExecutionFailure
      ? normalizedRepairNeeded ? 'repair-needed' : guardFinding?.finding.severity ?? 'repair-needed'
      : payloadFailureStatus
        ? normalized ? payloadAttemptStatus(normalized) : payloadAttemptStatus(payload)
        : 'done';
  const schemaFailureReason = schemaErrors.length ? generatedTaskSchemaFailureReason(schemaErrors) : undefined;
  const attemptFailureReason = schemaFailureReason ?? failureReason;
  const repairFailureReason = schemaErrors.length
    ? schemaFailureReason
    : shouldRepairExecutionFailure
      ? normalizedRepairNeeded
        ? String(failureReason)
        : evidenceFailureReason ?? `AgentServer generated task exited ${run.exitCode} with failed payload: ${failureReason}`
      : undefined;

  return {
    workEvidenceSummary,
    normalizedFailureStatus,
    normalizedRepairNeeded,
    payloadFailureStatus,
    failureReason,
    attemptFailureReason,
    attemptStatus,
    guardFinding,
    repair: repairFailureReason ? {
      failureReason: repairFailureReason,
      recoverActions: schemaErrors.length
        ? generatedTaskRepairRecoverActions('schema-validation')
        : generatedTaskRepairRecoverActions('runtime-evidence'),
    } : undefined,
  };
}

export async function appendGeneratedTaskAttemptLifecycle(
  input: GeneratedTaskAttemptLifecycleInput,
) {
  await appendTaskAttempt(input.workspacePath, taskAttemptWithBudgetDebitRefs({
    id: input.taskId,
    prompt: input.request.prompt,
    skillDomain: input.request.skillDomain,
    ...input.attemptPlanRefs(input.request, input.skill),
    skillId: input.skill.id,
    attempt: 1,
    status: input.status,
    codeRef: input.taskRel,
    inputRef: input.inputRel,
    outputRef: input.outputRel,
    stdoutRef: input.stdoutRel,
    stderrRef: input.stderrRel,
    exitCode: input.run.exitCode,
    schemaErrors: input.schemaErrors,
    workEvidenceSummary: input.workEvidenceSummary,
    failureReason: input.failureReason,
    createdAt: new Date().toISOString(),
  }, input.budgetDebitRefs, input.budgetDebitAuditRefs));
}

export async function runGeneratedTaskRepairAttemptLifecycle(
  input: GeneratedTaskRepairAttemptLifecycleInput,
): Promise<ToolPayload | undefined> {
  const payload = input.payload
    ? await annotateGeneratedTaskGuardValidationFailurePayload({
      payload: input.payload,
      workspacePath: input.workspacePath,
      request: input.request,
      skill: input.skill,
      refs: input,
      schemaErrors: input.schemaErrors,
    })
    : undefined;
  await appendGeneratedTaskAttemptLifecycle({
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    run: input.run,
    attemptPlanRefs: input.attemptPlanRefs,
    status: input.attemptStatus,
    taskRel: input.taskRel,
    inputRel: input.inputRel,
    outputRel: input.outputRel,
    stdoutRel: input.stdoutRel,
    stderrRel: input.stderrRel,
    schemaErrors: input.attemptSchemaErrors,
    workEvidenceSummary: input.workEvidenceSummary,
    failureReason: input.attemptFailureReason ?? input.failureReason,
  });
  return await runGeneratedTaskRepairAuditLifecycle({
    ...input,
    payload,
  });
}

export async function runGeneratedTaskRepairAuditLifecycle(
  input: GeneratedTaskRepairAuditLifecycleInput,
): Promise<ToolPayload | undefined> {
  await writeCapabilityEvolutionEventBestEffort({
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    runId: input.runId,
    run: input.run,
    payload: input.payload,
    taskRel: input.taskRel,
    inputRel: input.inputRel,
    outputRel: input.outputRel,
    stdoutRel: input.stdoutRel,
    stderrRel: input.stderrRel,
    schemaErrors: input.schemaErrors,
    failureReason: input.failureReason,
    recoverActions: input.recoverActions,
  });
  const repaired = await input.tryAgentServerRepairAndRerun({
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    taskPrefix: 'generated',
    run: input.run,
    schemaErrors: input.schemaErrors,
    failureReason: input.failureReason,
    callbacks: input.callbacks,
  });
  if (!repaired) return undefined;
  const repairedWithAudit = await annotateRepairRerunResult(input, repaired);
  await writeCapabilityEvolutionEventBestEffort({
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    runId: input.runId,
    run: input.run,
    payload: repairedWithAudit,
    taskRel: input.taskRel,
    inputRel: input.inputRel,
    outputRel: input.outputRel,
    stdoutRel: input.stdoutRel,
    stderrRel: input.stderrRel,
    schemaErrors: input.schemaErrors,
    failureReason: input.failureReason,
    finalStatus: 'repair-succeeded',
    repairAttempt: {
      id: `${input.taskId}-repair`,
      status: 'succeeded',
      reason: input.failureReason,
      validationResult: { verdict: 'pass', validatorId: 'sciforge.payload-schema' },
    },
  });
  return repairedWithAudit;
}

export async function recordGeneratedTaskSuccessLedger(
  input: GeneratedTaskSuccessLedgerInput,
) {
  return await writeCapabilityEvolutionEventBestEffort({
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    runId: input.runId,
    run: input.run,
    payload: input.payload,
    taskRel: input.taskRel,
    inputRel: input.inputRel,
    outputRel: input.outputRel,
    stdoutRel: input.stdoutRel,
    stderrRel: input.stderrRel,
    finalStatus: 'succeeded',
    recoverActions: ['record-successful-dynamic-glue', 'preserve-runtime-evidence-refs'],
    eventKind: 'dynamic-glue-execution',
    promotionReason: 'Successful dynamic glue execution is ledger evidence; repeated compatible records can become promotion candidates.',
  });
}

export async function recordGeneratedTaskSuccessLedgerLifecycle(
  input: GeneratedTaskSuccessLedgerLifecycleInput,
) {
  return await recordGeneratedTaskSuccessLedger({
    ...input,
    ...input.refs,
  });
}

export async function recordAgentServerDirectPayloadSuccessLedgerLifecycle(
  input: AgentServerDirectPayloadSuccessLedgerLifecycleInput,
) {
  return await writeCapabilityEvolutionEventBestEffort({
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    taskId: stableAgentServerDirectPayloadLedgerTaskId(input),
    runId: input.runId,
    payload: input.payload,
    taskRel: input.refs.taskRel,
    outputRel: input.refs.outputRel,
    stdoutRel: input.refs.stdoutRel,
    stderrRel: input.refs.stderrRel,
    finalStatus: 'succeeded',
    recoverActions: ['record-successful-agentserver-direct-payload', 'preserve-runtime-evidence-refs'],
    eventKind: 'agentserver-direct-payload',
    promotionEligible: false,
    promotionReason: 'AgentServer direct payload success is ledger evidence; promotion requires repeated compatible records.',
  });
}

export function generatedTaskSuccessBudgetDebitId(
  input: Pick<GeneratedTaskSuccessBudgetDebitInput, 'request' | 'skill' | 'taskId' | 'runId' | 'refs' | 'source'>,
) {
  return `budgetDebit:${generatedTaskSuccessBudgetDebitSlug(input)}`;
}

export function generatedTaskSuccessBudgetDebitAuditRefs(
  input: Pick<GeneratedTaskSuccessBudgetDebitInput, 'request' | 'skill' | 'taskId' | 'runId' | 'refs' | 'source'>,
  ledgerRefs: string[] = [],
) {
  return uniqueStrings([
    `appendTaskAttempt:${input.taskId}`,
    `audit:capability-budget-debit:${generatedTaskSuccessBudgetDebitSlug(input)}`,
    ...ledgerRefs,
  ]);
}

export function capabilityEvolutionLedgerRefsFromResult(result: CapabilityEvolutionRuntimeEventResult | undefined) {
  return uniqueStrings([
    result?.ledgerRef,
    result?.recordRef,
    result?.record.id ? `capabilityEvolutionRecord:${result.record.id}` : undefined,
  ]);
}

export function attachGeneratedTaskSuccessBudgetDebit(
  input: GeneratedTaskSuccessBudgetDebitInput,
): ToolPayload {
  const debitId = generatedTaskSuccessBudgetDebitId(input);
  const debitSlug = generatedTaskSuccessBudgetDebitSlug(input);
  const auditRefs = generatedTaskSuccessBudgetDebitAuditRefs(input, input.ledgerRefs);
  const budgetDebitRefs = [debitId];
  const executionUnitRef = firstPayloadExecutionUnitId(input.payload) ?? `executionUnit:${input.taskId}`;
  const executionUnits = input.payload.executionUnits.map((unit) => isRecord(unit)
    ? attachBudgetDebitRefs(unit, budgetDebitRefs)
    : unit);
  const workEvidence = workEvidenceWithGeneratedTaskBudgetDebitRefs(input, budgetDebitRefs, debitSlug);
  const workEvidenceRefs = workEvidence.map((entry) => stringField(entry.id)).filter((id): id is string => Boolean(id));
  const capabilityId = input.source === 'generated-task'
    ? 'sciforge.generated-task-runner'
    : 'sciforge.agentserver.direct-payload';
  const debit = createCapabilityBudgetDebitRecord({
    debitId,
    invocationId: `capabilityInvocation:${debitSlug}`,
    capabilityId,
    candidateId: input.skill.id,
    manifestRef: input.skill.manifestPath || `capability:${input.skill.id}`,
    subjectRefs: generatedTaskSuccessSubjectRefs(input, executionUnitRef, workEvidenceRefs),
    debitLines: generatedTaskSuccessDebitLines(input),
    sinkRefs: {
      executionUnitRef,
      workEvidenceRefs,
      auditRefs,
    },
    metadata: {
      source: input.source,
      runtimeLabel: input.runtimeLabel,
      skillDomain: input.request.skillDomain,
      skillId: input.skill.id,
      runId: input.runId,
      taskId: input.taskId,
      ledgerRefs: input.ledgerRefs,
    },
  });
  return {
    ...input.payload,
    budgetDebits: upsertBudgetDebit(input.payload.budgetDebits ?? [], debit),
    executionUnits,
    workEvidence,
    logs: upsertBudgetDebitAuditLog(input.payload.logs ?? [], {
      ref: `audit:capability-budget-debit:${debitSlug}`,
      capabilityId,
      source: input.source,
      taskId: input.taskId,
      runId: input.runId,
      ledgerRefs: input.ledgerRefs,
      budgetDebitRefs,
    }),
  };
}

export async function buildGeneratedTaskRunInputLifecycle(
  input: GeneratedTaskRunInputLifecycleInput,
): Promise<GeneratedTaskRunInputLifecycle> {
  const currentRefs = currentTurnReferences(input.request);
  const priorAttempts = currentRefs.length
    ? []
    : summarizeTaskAttemptsForAgentServer(await readRecentTaskAttempts(input.workspacePath, input.request.skillDomain, 8, {
      scenarioPackageId: input.request.scenarioPackageRef?.id,
      skillPlanRef: input.request.skillPlanRef,
      prompt: input.request.prompt,
    }));
  return {
    taskInput: {
      prompt: input.request.prompt,
      attempt: 1,
      skillId: input.skill.id,
      agentServerGenerated: true,
      artifacts: input.request.artifacts,
      uiStateSummary: input.request.uiState,
      taskProjectHandoff: isRecord(input.request.uiState?.taskProjectHandoff) ? input.request.uiState.taskProjectHandoff : undefined,
      userGuidanceQueue: activeGuidanceQueueForGeneratedTaskInput(input.request),
      recentExecutionRefs: toRecordList(input.request.uiState?.recentExecutionRefs),
      priorAttempts,
      expectedArtifacts: input.expectedArtifacts,
      selectedComponentIds: selectedComponentIdsForRequest(input.request),
    },
    retentionProtectedInputRels: input.generatedInputRels,
  };
}

export async function appendGeneratedTaskGenerationFailureLifecycle(
  input: GeneratedTaskGenerationFailureLifecycleInput,
) {
  await appendTaskAttempt(input.workspacePath, {
    id: input.failedRequestId,
    prompt: input.request.prompt,
    skillDomain: input.request.skillDomain,
    ...input.attemptPlanRefs(input.request, input.skill, input.failureReason),
    skillId: input.skill.id,
    attempt: 1,
    status: 'repair-needed',
    failureReason: input.failureReason,
    contextRecovery: contextRecoveryAttemptMetadata(input.diagnostics),
    createdAt: new Date().toISOString(),
  });
}

export async function appendGeneratedTaskDirectPayloadAttemptLifecycle(
  input: GeneratedTaskDirectPayloadAttemptLifecycleInput,
) {
  await annotateGeneratedTaskGuardValidationFailurePayload({
    payload: input.payload,
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    refs: input.refs,
    guardFinding: input.lifecycle.guardFinding,
  });
  await appendTaskAttempt(input.workspacePath, taskAttemptWithBudgetDebitRefs({
    id: `agentserver-direct-${input.skill.id}-${sha1(`${input.request.prompt}:${input.runId || 'unknown'}`).slice(0, 12)}`,
    prompt: input.request.prompt,
    skillDomain: input.request.skillDomain,
    ...input.attemptPlanRefs(input.request, input.skill),
    skillId: input.skill.id,
    attempt: 1,
    status: input.lifecycle.attemptStatus,
    codeRef: input.refs.taskRel,
    outputRef: input.refs.outputRel,
    stdoutRef: input.refs.stdoutRel,
    stderrRef: input.refs.stderrRel,
    workEvidenceSummary: input.lifecycle.workEvidenceSummary,
    failureReason: input.lifecycle.failureReason,
    createdAt: new Date().toISOString(),
  }, input.budgetDebitRefs, input.budgetDebitAuditRefs));
}

export async function runGeneratedTaskPreOutputRepairLifecycle(
  input: Omit<GeneratedTaskRepairAttemptLifecycleInput, 'attemptStatus' | 'schemaErrors' | 'failureReason' | 'recoverActions'>,
): Promise<{ repaired?: ToolPayload; failureReason: string }> {
  const failureReason = input.run.stderr || 'AgentServer generated task failed before writing output.';
  const repaired = await runGeneratedTaskRepairAttemptLifecycle({
    ...input,
    attemptStatus: 'repair-needed',
    schemaErrors: [],
    failureReason,
    recoverActions: generatedTaskRepairRecoverActions('pre-output-failure'),
  });
  return { repaired, failureReason };
}

export async function runGeneratedTaskParseRepairLifecycle(
  input: Omit<GeneratedTaskRepairAttemptLifecycleInput, 'attemptStatus' | 'schemaErrors' | 'failureReason' | 'recoverActions'> & { error: unknown },
): Promise<{ repaired?: ToolPayload; failureReason: string }> {
  const failureReason = `AgentServer generated task output could not be parsed: ${errorMessage(input.error)}`;
  const repaired = await runGeneratedTaskRepairAttemptLifecycle({
    ...input,
    attemptStatus: 'repair-needed',
    schemaErrors: ['output could not be parsed'],
    failureReason,
    recoverActions: generatedTaskRepairRecoverActions('parse-output-failure'),
  });
  return { repaired, failureReason };
}

export async function annotateGeneratedTaskGuardValidationFailurePayload(input: {
  payload?: ToolPayload;
  sourcePayload?: ToolPayload;
  workspacePath: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  refs: RuntimeRefBundle & { inputRel?: string };
  schemaErrors?: string[];
  guardFinding?: GeneratedTaskGuardFinding;
}): Promise<ToolPayload> {
  if (!input.payload) return undefined as unknown as ToolPayload;
  if ((input.schemaErrors ?? []).length > 0) return input.payload;
  const guardFinding = input.guardFinding ?? evaluateGeneratedTaskGuardFinding(input.sourcePayload ?? input.payload, input.request);
  if (!guardFinding) return input.payload;
  const relatedRefs = generatedTaskGuardRelatedRefs(input, input.sourcePayload ?? input.payload);
  const chainId = generatedTaskGuardChainId(input.skill, input.refs, guardFinding);
  if (payloadHasValidationRepairAudit(input.payload, `audit:${chainId}`)) return input.payload;
  const projection = generatedTaskGuardFindingProjection(guardFinding, chainId, relatedRefs);
  const chain = createValidationRepairAuditChain({
    chainId,
    subject: {
      kind: validationSubjectKindForGeneratedTaskGuardRefs(input.refs),
      id: input.refs.outputRel ? `guard:${input.refs.outputRel}` : `guard:${input.skill.id}`,
      capabilityId: input.skill.id,
      contractId: projection.contractId,
      schemaPath: projection.schemaPath,
      completedPayloadRef: input.refs.outputRel,
      generatedTaskRef: generatedTaskRefForGeneratedTaskGuardRefs(input.refs),
      artifactRefs: repairRerunArtifactRefs(input.sourcePayload ?? input.payload),
      currentRefs: repairRerunCurrentRefs(input.request),
    },
    findingProjections: [projection],
    relatedRefs,
    repairBudget: {
      maxAttempts: 1,
      remainingAttempts: 1,
      maxSupplementAttempts: 0,
      remainingSupplementAttempts: 0,
    },
    sinkRefs: [
      `appendTaskAttempt:${chainId}`,
      `ledger:${chainId}`,
    ],
    telemetrySpanRefs: [
      `span:${guardFinding.source === 'work-evidence' ? 'work-evidence' : 'payload-validation'}:${chainId}`,
      `span:repair-decision:${chainId}`,
    ],
  });
  const withAudit = attachValidationRepairAuditChainToPayload(input.payload, chain);
  const withDebit = attachGeneratedTaskGuardBudgetDebit(withAudit, input, guardFinding, chainId, chain.audit.auditId);
  const withTelemetry = await recordValidationRepairTelemetryForPayload(withDebit, {
    ...input.request,
    workspacePath: input.workspacePath,
  });
  await persistAnnotatedRepairRerunPayloadBestEffort(input.workspacePath, input.refs.outputRel, withTelemetry);
  return withTelemetry;
}

export function payloadHasRepairOrFailureStatus(payload: ToolPayload) {
  return payloadHasRepairNeededStatus(payload)
    || (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
      .some((unit) => isRecord(unit) && /failed|error|needs-human/i.test(String(unit.status || '')));
}

function generatedTaskSchemaFailureReason(schemaErrors: string[]) {
  return `AgentServer generated task output failed schema validation: ${schemaErrors.join('; ')}`;
}

function generatedTaskRepairRecoverActions(kind: 'schema-validation' | 'runtime-evidence' | 'pre-output-failure' | 'parse-output-failure') {
  if (kind === 'schema-validation') return ['repair-output-schema', 'preserve-output-ref', 'rerun-generated-task'];
  if (kind === 'runtime-evidence') return ['repair-runtime-evidence', 'preserve-output-ref', 'rerun-generated-task'];
  if (kind === 'pre-output-failure') return ['inspect-stderr-ref', 'repair-generated-task', 'rerun-generated-task'];
  return ['inspect-output-ref', 'repair-output-parser', 'rerun-generated-task'];
}

function activeGuidanceQueueForGeneratedTaskInput(request: GatewayRequest) {
  const handoff = isRecord(request.uiState?.taskProjectHandoff) ? request.uiState.taskProjectHandoff : undefined;
  const queue = Array.isArray(handoff?.userGuidanceQueue)
    ? handoff.userGuidanceQueue
    : Array.isArray(request.uiState?.userGuidanceQueue)
      ? request.uiState.userGuidanceQueue
      : Array.isArray(request.uiState?.guidanceQueue)
        ? request.uiState.guidanceQueue
        : [];
  return queue.filter((entry): entry is Record<string, unknown> => isRecord(entry)
    && typeof entry.id === 'string'
    && (entry.status === 'queued' || entry.status === 'deferred'));
}

function contextRecoveryAttemptMetadata(diagnostics: any): TaskAttemptRecord['contextRecovery'] {
  return diagnostics?.kind === 'contextWindowExceeded' ? {
    kind: 'contextWindowExceeded',
    backend: diagnostics.backend,
    provider: diagnostics.provider,
    agentId: diagnostics.agentId,
    sessionRef: diagnostics.sessionRef,
    originalErrorSummary: diagnostics.originalErrorSummary,
    compaction: diagnostics.compaction,
    retryAttempted: diagnostics.retryAttempted,
    retrySucceeded: diagnostics.retrySucceeded,
  } : undefined;
}

function payloadHasRepairNeededStatus(payload: ToolPayload) {
  if (/repair-needed|needs-human/i.test(String(payload.claimType || ''))) return true;
  return (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && /repair-needed|needs-human/i.test(String(unit.status || '')));
}

export function firstRepairOrFailurePayloadReason(payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  const unit = units.find((entry) => isRecord(entry) && /repair-needed|failed|error|needs-human/i.test(String(entry.status || '')));
  return isRecord(unit)
    ? stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message)
    : undefined;
}

export function payloadAttemptStatus(payload: ToolPayload): 'repair-needed' | 'failed-with-reason' {
  return payloadHasRepairNeededStatus(payload) ? 'repair-needed' : 'failed-with-reason';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function writeCapabilityEvolutionEventBestEffort(
  input: Parameters<typeof recordCapabilityEvolutionRuntimeEvent>[0],
) {
  try {
    return await recordCapabilityEvolutionRuntimeEvent(input);
  } catch {
    // Ledger capture is audit evidence; it must not turn a repair/fallback path into a harder failure.
    return undefined;
  }
}

function taskAttemptWithBudgetDebitRefs(
  record: TaskAttemptRecord,
  budgetDebitRefs: string[] | undefined,
  budgetDebitAuditRefs: string[] | undefined,
): TaskAttemptRecord {
  const debitRefs = uniqueStrings(budgetDebitRefs ?? []);
  if (!debitRefs.length) return record;
  const auditRefs = uniqueStrings(budgetDebitAuditRefs ?? []);
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown>; budgetDebitRefs?: string[] };
  return {
    ...record,
    budgetDebitRefs: uniqueStrings([
      ...toStringList(current.budgetDebitRefs),
      ...debitRefs,
    ]),
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      budgetDebits: uniqueStrings([
        ...toStringList(isRecord(current.refs) ? current.refs.budgetDebits : undefined),
        ...debitRefs,
      ]),
      budgetDebitAudit: uniqueStrings([
        ...toStringList(isRecord(current.refs) ? current.refs.budgetDebitAudit : undefined),
        ...auditRefs,
      ]),
    },
  } as TaskAttemptRecord;
}

function generatedTaskSuccessBudgetDebitSlug(
  input: Pick<GeneratedTaskSuccessBudgetDebitInput, 'request' | 'skill' | 'taskId' | 'runId' | 'refs' | 'source'>,
) {
  const stableInput = [
    input.source,
    input.request.skillDomain,
    input.skill.id,
    input.runId,
    input.taskId,
    input.refs.taskRel,
    input.refs.outputRel,
  ].filter(Boolean).join(':');
  return `${input.source}:${sha1(stableInput).slice(0, 12)}`;
}

function generatedTaskSuccessSubjectRefs(
  input: GeneratedTaskSuccessBudgetDebitInput,
  executionUnitRef: string,
  workEvidenceRefs: string[],
) {
  return uniqueStrings([
    input.taskId,
    input.runId,
    input.refs.taskRel,
    input.refs.inputRel,
    input.refs.outputRel,
    input.refs.stdoutRel,
    input.refs.stderrRel,
    executionUnitRef,
    ...workEvidenceRefs,
    ...input.payload.artifacts.map((artifact) => isRecord(artifact) ? stringField(artifact.id) ?? stringField(artifact.ref) ?? stringField(artifact.dataRef) : undefined),
    ...input.payload.executionUnits.flatMap((unit) => isRecord(unit) ? [
      stringField(unit.id),
      stringField(unit.outputRef),
      stringField(unit.diffRef),
    ] : []),
  ]);
}

function generatedTaskSuccessDebitLines(input: GeneratedTaskSuccessBudgetDebitInput): CapabilityBudgetDebitLine[] {
  return [
    {
      dimension: 'toolCalls',
      amount: 1,
      reason: input.source === 'generated-task'
        ? 'executed AgentServer generated workspace task'
        : 'accepted AgentServer direct payload',
      sourceRef: input.refs.taskRel,
    },
    {
      dimension: 'resultItems',
      amount: Math.max(1, input.payload.artifacts.length + input.payload.claims.length),
      reason: 'completed payload result items',
      sourceRef: input.refs.outputRel,
    },
    {
      dimension: 'costUnits',
      amount: 1,
      reason: input.runtimeLabel,
      sourceRef: input.skill.id,
    },
  ];
}

function workEvidenceWithGeneratedTaskBudgetDebitRefs(
  input: GeneratedTaskSuccessBudgetDebitInput,
  budgetDebitRefs: string[],
  debitSlug: string,
) {
  const existing = Array.isArray(input.payload.workEvidence) ? input.payload.workEvidence : [];
  const evidence = existing.length ? existing : [generatedTaskSuccessWorkEvidence(input, debitSlug)];
  return evidence.map((entry, index) => {
    const record: Record<string, unknown> = isRecord(entry) ? entry : {};
    return {
      ...record,
      kind: stringField(record.kind) ?? (input.source === 'generated-task' ? 'command' : 'claim'),
      id: stringField(record.id) ?? `workEvidence:${debitSlug}:${index + 1}`,
      status: stringField(record.status) ?? 'success',
      provider: stringField(record.provider) ?? input.runtimeLabel,
      evidenceRefs: uniqueStrings([
        ...toStringList(record.evidenceRefs),
        input.refs.outputRel,
        input.refs.stdoutRel,
        input.refs.stderrRel,
      ]),
      recoverActions: toStringList(record.recoverActions),
      budgetDebitRefs: uniqueStrings([
        ...toStringList(record.budgetDebitRefs),
        ...budgetDebitRefs,
      ]),
    };
  });
}

function generatedTaskSuccessWorkEvidence(
  input: GeneratedTaskSuccessBudgetDebitInput,
  debitSlug: string,
) {
  return {
    kind: input.source === 'generated-task' ? 'command' : 'claim',
    id: `workEvidence:${debitSlug}:success`,
    status: 'success',
    provider: input.runtimeLabel,
    resultCount: Math.max(1, input.payload.artifacts.length + input.payload.claims.length),
    outputSummary: input.source === 'generated-task'
      ? 'AgentServer generated task executed successfully and produced a normalized ToolPayload.'
      : 'AgentServer direct payload completed successfully and was normalized into a ToolPayload.',
    evidenceRefs: uniqueStrings([
      input.refs.outputRel,
      input.refs.stdoutRel,
      input.refs.stderrRel,
      input.refs.taskRel,
    ]),
    recoverActions: [],
    rawRef: input.refs.outputRel,
  };
}

function upsertBudgetDebit(
  existing: CapabilityInvocationBudgetDebitRecord[],
  debit: CapabilityInvocationBudgetDebitRecord,
) {
  const index = existing.findIndex((entry) => entry.debitId === debit.debitId);
  if (index < 0) return [...existing, debit];
  return existing.map((entry, entryIndex) => entryIndex === index
    ? {
        ...entry,
        sinkRefs: {
          executionUnitRef: entry.sinkRefs.executionUnitRef ?? debit.sinkRefs.executionUnitRef,
          workEvidenceRefs: uniqueStrings([
            ...entry.sinkRefs.workEvidenceRefs,
            ...debit.sinkRefs.workEvidenceRefs,
          ]),
          auditRefs: uniqueStrings([
            ...entry.sinkRefs.auditRefs,
            ...debit.sinkRefs.auditRefs,
          ]),
        },
        metadata: {
          ...(entry.metadata ?? {}),
          ...(debit.metadata ?? {}),
        },
      }
    : entry);
}

function upsertBudgetDebitAuditLog(
  existing: Array<Record<string, unknown>>,
  log: Record<string, unknown> & { ref: string; budgetDebitRefs: string[] },
) {
  const index = existing.findIndex((entry) => stringField(entry.ref) === log.ref);
  if (index < 0) {
    return [
      ...existing,
      {
        kind: 'capability-budget-debit-audit',
        type: 'capability-budget-debit',
        ...log,
      },
    ];
  }
  return existing.map((entry, entryIndex) => entryIndex === index
    ? {
        ...entry,
        ...log,
        budgetDebitRefs: uniqueStrings([
          ...toStringList(entry.budgetDebitRefs),
          ...log.budgetDebitRefs,
        ]),
        ledgerRefs: uniqueStrings([
          ...toStringList(entry.ledgerRefs),
          ...toStringList(log.ledgerRefs),
        ]),
      }
    : entry);
}

function stableAgentServerDirectPayloadLedgerTaskId(input: AgentServerDirectPayloadSuccessLedgerLifecycleInput) {
  return `agentserver-direct-${input.request.skillDomain}-${sha1([
    input.request.prompt,
    input.skill.id,
    input.runId ?? '',
    input.refs.outputRel,
  ].join(':')).slice(0, 12)}`;
}

async function annotateRepairRerunResult(
  input: GeneratedTaskRepairAuditLifecycleInput,
  repaired: ToolPayload,
): Promise<ToolPayload> {
  const relatedRefs = repairRerunRelatedRefs(input, repaired);
  const completedPayloadRef = repairRerunCompletedPayloadRef(input, repaired);
  const chainId = `repair-rerun:${sha1([
    input.taskId,
    input.failureReason,
    completedPayloadRef,
    input.runId,
  ].filter(Boolean).join(':')).slice(0, 12)}`;
  const chain = createValidationRepairAuditChain({
    chainId,
    subject: {
      kind: 'repair-rerun-result',
      id: `repair-rerun:${input.taskId}`,
      capabilityId: input.skill.id,
      contractId: 'sciforge.repair-rerun-result.v1',
      schemaPath: 'src/runtime/gateway/generated-task-runner-validation-lifecycle.ts#repair-rerun-result',
      completedPayloadRef,
      generatedTaskRef: input.taskRel,
      artifactRefs: repairRerunArtifactRefs(repaired),
      currentRefs: repairRerunCurrentRefs(input.request),
    },
    findingProjections: repairRerunFindingProjections(input, repaired, relatedRefs, chainId),
    relatedRefs,
    repairBudget: {
      maxAttempts: 1,
      remainingAttempts: 0,
      maxSupplementAttempts: 0,
      remainingSupplementAttempts: 0,
    },
    sinkRefs: [`appendTaskAttempt:${chainId}`],
    telemetrySpanRefs: [
      `span:repair-rerun:${chainId}`,
      `span:repair-decision:${chainId}`,
    ],
  });
  const annotated = attachValidationRepairAuditChainToPayload(repaired, chain);
  const annotatedWithTelemetry = await recordValidationRepairTelemetryForPayload(annotated, {
    ...input.request,
    workspacePath: input.workspacePath,
  });
  await persistAnnotatedRepairRerunPayloadBestEffort(input.workspacePath, completedPayloadRef, annotatedWithTelemetry);
  return annotatedWithTelemetry;
}

function repairRerunFindingProjections(
  input: GeneratedTaskRepairAuditLifecycleInput,
  repaired: ToolPayload,
  relatedRefs: string[],
  chainId: string,
): ValidationFindingProjectionInput[] {
  const units = Array.isArray(repaired.executionUnits) ? repaired.executionUnits : [];
  const unitFindings = units
    .filter((unit) => isRecord(unit) && /repair-needed|failed|error|needs-human/i.test(String(unit.status || '')))
    .map((unit, index): ValidationFindingProjectionInput => {
      const status = String(unit.status || 'failed');
      const reason = stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message) ?? input.failureReason;
      return {
        id: `${chainId}:execution-unit:${stringField(unit.id) ?? index + 1}`,
        source: 'work-evidence',
        kind: 'work-evidence',
        status,
        failureMode: status,
        message: `Repair rerun result failed: ${reason}`,
        contractId: 'sciforge.repair-rerun-result.v1',
        schemaPath: 'src/runtime/gateway/generated-task-runner-validation-lifecycle.ts#repair-rerun-result',
        capabilityId: input.skill.id,
        traceRef: stringField(unit.outputRef),
        relatedRefs: uniqueStrings([
          ...relatedRefs,
          stringField(unit.codeRef),
          stringField(unit.outputRef),
          stringField(unit.stdoutRef),
          stringField(unit.stderrRef),
          stringField(unit.diffRef),
        ]),
        recoverActions: input.recoverActions.length
          ? input.recoverActions
          : ['inspect repair rerun refs', 'fail closed with repair diagnostics'],
        diagnostics: {
          status,
          selfHealReason: stringField(unit.selfHealReason),
          parentAttempt: unit.parentAttempt,
          attempt: unit.attempt,
        },
        isFailure: true,
      };
    });
  if (unitFindings.length) return unitFindings;
  if (payloadHasRepairOrFailureStatus(repaired)) {
    const reason = firstRepairOrFailurePayloadReason(repaired) ?? input.failureReason;
    return [{
      id: `${chainId}:payload`,
      source: 'work-evidence',
      kind: 'work-evidence',
      status: 'failed',
      failureMode: String(repaired.claimType || 'repair-rerun-result'),
      message: `Repair rerun result failed: ${reason}`,
      contractId: 'sciforge.repair-rerun-result.v1',
      schemaPath: 'src/runtime/gateway/generated-task-runner-validation-lifecycle.ts#repair-rerun-result',
      capabilityId: input.skill.id,
      relatedRefs,
      recoverActions: input.recoverActions,
      diagnostics: {
        claimType: repaired.claimType,
        evidenceLevel: repaired.evidenceLevel,
      },
      isFailure: true,
    }];
  }
  return [];
}

function repairRerunRelatedRefs(input: GeneratedTaskRepairAuditLifecycleInput, repaired: ToolPayload) {
  const units = Array.isArray(repaired.executionUnits) ? repaired.executionUnits : [];
  const unitRefs = units.flatMap((unit) => isRecord(unit)
    ? [
        stringField(unit.codeRef),
        stringField(unit.inputRef),
        stringField(unit.outputRef),
        stringField(unit.stdoutRef),
        stringField(unit.stderrRef),
        stringField(unit.diffRef),
      ]
    : []);
  const logRefs = (Array.isArray(repaired.logs) ? repaired.logs : [])
    .map((entry) => isRecord(entry) ? stringField(entry.ref) : undefined);
  return uniqueStrings([
    input.taskRel,
    input.inputRel,
    input.outputRel,
    input.stdoutRel,
    input.stderrRel,
    input.run.outputRef,
    input.run.stdoutRef,
    input.run.stderrRef,
    ...unitRefs,
    ...logRefs,
  ]);
}

function repairRerunArtifactRefs(payload: ToolPayload) {
  return uniqueStrings([
    ...payload.artifacts.map((artifact) => isRecord(artifact) ? stringField(artifact.id) ?? stringField(artifact.ref) : undefined),
    ...payload.uiManifest.map((slot) => isRecord(slot) ? stringField(slot.artifactRef) : undefined),
  ]);
}

function repairRerunCurrentRefs(request: GatewayRequest) {
  const references = Array.isArray(request.references) ? request.references : [];
  const currentReferences = isRecord(request.uiState) && Array.isArray(request.uiState.currentReferences)
    ? request.uiState.currentReferences
    : [];
  return uniqueStrings([...references, ...currentReferences].map((reference) => isRecord(reference) ? stringField(reference.ref) : undefined));
}

function repairRerunCompletedPayloadRef(input: GeneratedTaskRepairAuditLifecycleInput, payload: ToolPayload) {
  const unit = (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .find((entry) => isRecord(entry) && stringField(entry.outputRef));
  return isRecord(unit) ? stringField(unit.outputRef) ?? input.outputRel : input.outputRel;
}

function evaluateGeneratedTaskGuardFinding(payload: ToolPayload, request: GatewayRequest): GeneratedTaskGuardFinding | undefined {
  const guidanceFinding = evaluateGuidanceAdoption(payload, request);
  if (guidanceFinding) return { source: 'guidance-adoption', finding: guidanceFinding };
  const evidenceFinding = evaluateToolPayloadEvidence(payload, request);
  return evidenceFinding ? { source: 'work-evidence', finding: evidenceFinding } : undefined;
}

function generatedTaskGuardFindingProjection(
  guardFinding: GeneratedTaskGuardFinding,
  chainId: string,
  relatedRefs: string[],
): ValidationFindingProjectionInput {
  if (guardFinding.source === 'guidance-adoption') {
    return validationFindingProjectionFromGuidanceAdoptionFinding(guardFinding.finding, {
      id: `${chainId}:guidance-adoption`,
      capabilityId: 'sciforge.validation-guard',
      relatedRefs,
    });
  }
  return validationFindingProjectionFromWorkEvidenceGuardFinding(guardFinding.finding, {
    id: `${chainId}:work-evidence:${guardFinding.finding.kind}`,
    capabilityId: 'sciforge.validation-guard',
    relatedRefs,
  });
}

function generatedTaskGuardChainId(
  skill: SkillAvailability,
  refs: RuntimeRefBundle & { inputRel?: string },
  guardFinding: GeneratedTaskGuardFinding,
) {
  const guardKind = guardFinding.source === 'work-evidence'
    ? guardFinding.finding.kind
    : `${guardFinding.finding.missingIds.join(',')}:${guardFinding.finding.invalidIds.join(',')}`;
  return `validation-guard:${sha1([
    skill.id,
    guardFinding.source,
    guardKind,
    refs.outputRel,
    refs.taskRel,
  ].filter(Boolean).join(':')).slice(0, 12)}`;
}

function generatedTaskGuardRelatedRefs(input: {
  refs: RuntimeRefBundle & { inputRel?: string };
  request: GatewayRequest;
}, payload: ToolPayload) {
  const units = Array.isArray(payload.executionUnits) ? payload.executionUnits : [];
  return uniqueStrings([
    input.refs.taskRel,
    input.refs.inputRel,
    input.refs.outputRel,
    input.refs.stdoutRel,
    input.refs.stderrRel,
    ...repairRerunCurrentRefs(input.request),
    ...repairRerunArtifactRefs(payload),
    ...units.flatMap((unit) => isRecord(unit)
      ? [
          stringField(unit.id) ? `executionUnit:${stringField(unit.id)}` : undefined,
          stringField(unit.codeRef),
          stringField(unit.inputRef),
          stringField(unit.outputRef),
          stringField(unit.stdoutRef),
          stringField(unit.stderrRef),
        ]
      : []),
  ]);
}

function validationSubjectKindForGeneratedTaskGuardRefs(refs: RuntimeRefBundle) {
  return refs.taskRel.startsWith('agentserver://') ? 'direct-payload' : 'generated-task-result';
}

function generatedTaskRefForGeneratedTaskGuardRefs(refs: RuntimeRefBundle) {
  return refs.taskRel.startsWith('agentserver://') ? undefined : refs.taskRel;
}

function attachGeneratedTaskGuardBudgetDebit(
  payload: ToolPayload,
  input: {
    skill: SkillAvailability;
    refs: RuntimeRefBundle & { inputRel?: string };
  },
  guardFinding: GeneratedTaskGuardFinding,
  chainId: string,
  auditId: string,
): ToolPayload {
  const debitId = `budgetDebit:${chainId}`;
  if ((payload.budgetDebits ?? []).some((debit) => debit.debitId === debitId)) return payload;
  const executionUnitRef = firstPayloadExecutionUnitId(payload);
  const logRef = `audit:validation-guard-budget-debit:${sha1(chainId).slice(0, 12)}`;
  const payloadRefs = isRecord((payload as ToolPayload & { refs?: unknown }).refs)
    ? (payload as ToolPayload & { refs?: Record<string, unknown> }).refs
    : {};
  const debit = createCapabilityBudgetDebitRecord({
    debitId,
    invocationId: `capabilityInvocation:${chainId}`,
    capabilityId: 'sciforge.validation-guard',
    candidateId: `validator.sciforge.${guardFinding.source}`,
    manifestRef: 'capability:verifier.validation-guard',
    subjectRefs: uniqueStrings([
      input.refs.taskRel,
      input.refs.inputRel,
      input.refs.outputRel,
      input.refs.stdoutRel,
      input.refs.stderrRel,
      auditId,
    ]),
    debitLines: generatedTaskGuardBudgetDebitLines(guardFinding),
    sinkRefs: {
      executionUnitRef,
      workEvidenceRefs: [`validation-repair-audit:${chainId}`],
      auditRefs: [
        auditId,
        `appendTaskAttempt:${chainId}`,
        `ledger:${chainId}`,
        logRef,
      ],
    },
    metadata: {
      guardedCapabilityId: input.skill.id,
      guardSource: guardFinding.source,
      guardKind: guardFinding.source === 'work-evidence' ? guardFinding.finding.kind : 'guidance-adoption',
      contractId: guardFinding.source === 'work-evidence'
        ? 'sciforge.work-evidence.v1'
        : GUIDANCE_ADOPTION_GUARD_CONTRACT_ID,
      schemaPath: guardFinding.source === 'work-evidence'
        ? undefined
        : GUIDANCE_ADOPTION_GUARD_SCHEMA_PATH,
    },
  });
  const budgetDebitRefs = [debit.debitId];
  return {
    ...payload,
    refs: {
      ...payloadRefs,
      budgetDebits: uniqueStrings([
        ...stringList(payloadRefs?.budgetDebits),
        ...budgetDebitRefs,
      ]),
    },
    budgetDebits: [
      ...(payload.budgetDebits ?? []),
      debit,
    ],
    executionUnits: payload.executionUnits.map((unit) => isRecord(unit)
      ? attachBudgetDebitRefs(unit, budgetDebitRefs)
      : unit),
    workEvidence: Array.isArray(payload.workEvidence)
      ? payload.workEvidence.map((entry) => isRecord(entry)
        ? attachBudgetDebitRefs(entry, budgetDebitRefs) as unknown as typeof entry
        : entry)
      : payload.workEvidence,
    logs: [
      ...(payload.logs ?? []),
      {
        kind: 'capability-budget-debit-audit',
        ref: logRef,
        capabilityId: 'sciforge.validation-guard',
        guardSource: guardFinding.source,
        validationFailureKind: guardFinding.source === 'work-evidence' ? 'work-evidence' : 'guidance-adoption',
        budgetDebitRefs,
      },
    ],
  } as ToolPayload;
}

function generatedTaskGuardBudgetDebitLines(guardFinding: GeneratedTaskGuardFinding): CapabilityBudgetDebitLine[] {
  const resultItems = guardFinding.source === 'guidance-adoption'
    ? Math.max(1, guardFinding.finding.missingIds.length + guardFinding.finding.invalidIds.length)
    : 1;
  return [
    {
      dimension: 'costUnits',
      amount: 1,
      reason: `${guardFinding.source} validation guard`,
      sourceRef: guardFinding.source === 'guidance-adoption'
        ? GUIDANCE_ADOPTION_GUARD_CONTRACT_ID
        : 'sciforge.work-evidence.v1',
    },
    {
      dimension: 'resultItems',
      amount: resultItems,
      reason: 'guard findings',
      sourceRef: guardFinding.source === 'guidance-adoption'
        ? GUIDANCE_ADOPTION_GUARD_SCHEMA_PATH
        : 'packages/contracts/runtime/work-evidence-policy.ts#evaluateWorkEvidencePolicy',
    },
  ];
}

function payloadHasValidationRepairAudit(payload: ToolPayload, auditId: string) {
  const candidates: unknown[] = [payload];
  if (Array.isArray(payload.executionUnits)) candidates.push(...payload.executionUnits);
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const refs = isRecord(candidate.refs) ? candidate.refs : {};
    for (const chain of [candidate.validationRepairAudit, refs.validationRepairAudit]) {
      if (!isRecord(chain)) continue;
      const audit = isRecord(chain.auditRecord) ? chain.auditRecord : isRecord(chain.audit) ? chain.audit : undefined;
      if (audit && stringField(audit.auditId) === auditId) return true;
    }
  }
  return false;
}

function firstPayloadExecutionUnitId(payload: ToolPayload) {
  for (const unit of payload.executionUnits) {
    if (!isRecord(unit)) continue;
    const id = stringField(unit.id);
    if (id) return id;
  }
  return undefined;
}

function attachBudgetDebitRefs<T extends Record<string, unknown>>(record: T, refs: string[]): T & {
  budgetDebitRefs: string[];
  refs: Record<string, unknown>;
} {
  return {
    ...record,
    budgetDebitRefs: uniqueStrings([
      ...stringList(record.budgetDebitRefs),
      ...refs,
    ]),
    refs: {
      ...(isRecord(record.refs) ? record.refs : {}),
      budgetDebits: uniqueStrings([
        ...stringList(isRecord(record.refs) ? record.refs.budgetDebits : undefined),
        ...refs,
      ]),
    },
  };
}

async function persistAnnotatedRepairRerunPayloadBestEffort(
  workspacePath: string,
  outputRef: string | undefined,
  payload: ToolPayload,
) {
  if (!outputRef || outputRef.includes('://')) return;
  try {
    const workspace = resolve(workspacePath);
    const absolutePath = resolve(workspace, outputRef);
    const relativePath = relative(workspace, absolutePath);
    if (relativePath.startsWith('..') || relativePath === '' || relativePath.split(sep).includes('..')) return;
    await writeFile(absolutePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // Payload annotation is audit metadata; returning the repaired result must not depend on persistence.
  }
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
