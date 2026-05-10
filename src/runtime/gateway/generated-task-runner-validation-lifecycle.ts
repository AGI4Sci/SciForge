import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { evaluateGuidanceAdoption } from './guidance-adoption-guard.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { evaluateToolPayloadEvidence } from './work-evidence-guard.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';

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
  attemptStatus: 'done' | 'repair-needed' | 'failed-with-reason';
  repair?: {
    failureReason: string;
    recoverActions: string[];
  };
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
  inputRel: string;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
  schemaErrors: string[];
  failureReason: string;
  recoverActions: string[];
  callbacks?: WorkspaceRuntimeCallbacks;
  tryAgentServerRepairAndRerun: RepairAttemptRunner;
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
  const evidenceFinding = normalized ? evaluateToolPayloadEvidence(normalized, request) : undefined;
  const guidanceFinding = normalized ? evaluateGuidanceAdoption(normalized, request) : undefined;
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
  const evidenceFailureReason = !payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined;
  const failureReason = payloadFailureReason ?? evidenceFailureReason;
  const shouldRepairExecutionFailure = schemaErrors.length === 0 && Boolean(failureReason)
    && (run.exitCode !== 0 || Boolean(evidenceFailureReason) || normalizedRepairNeeded);
  const attemptStatus = schemaErrors.length
    ? 'repair-needed'
    : shouldRepairExecutionFailure
      ? normalizedRepairNeeded ? 'repair-needed' : guidanceFinding?.severity ?? evidenceFinding?.severity ?? 'repair-needed'
      : payloadFailureStatus
        ? normalized ? payloadAttemptStatus(normalized) : payloadAttemptStatus(payload)
        : 'done';
  const repairFailureReason = schemaErrors.length
    ? `AgentServer generated task output failed schema validation: ${schemaErrors.join('; ')}`
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
    attemptStatus,
    repair: repairFailureReason ? {
      failureReason: repairFailureReason,
      recoverActions: schemaErrors.length
        ? ['repair-output-schema', 'preserve-output-ref', 'rerun-generated-task']
        : ['repair-runtime-evidence', 'preserve-output-ref', 'rerun-generated-task'],
    } : undefined,
  };
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
  await writeCapabilityEvolutionEventBestEffort({
    workspacePath: input.workspacePath,
    request: input.request,
    skill: input.skill,
    taskId: input.taskId,
    runId: input.runId,
    run: input.run,
    payload: repaired,
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
  return repaired;
}

export function payloadHasRepairOrFailureStatus(payload: ToolPayload) {
  return payloadHasRepairNeededStatus(payload)
    || (Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
      .some((unit) => isRecord(unit) && /failed|error|needs-human/i.test(String(unit.status || '')));
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
    await recordCapabilityEvolutionRuntimeEvent(input);
  } catch {
    // Ledger capture is audit evidence; it must not turn a repair/fallback path into a harder failure.
  }
}
