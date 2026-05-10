import { writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import { evaluateGuidanceAdoption } from './guidance-adoption-guard.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { evaluateToolPayloadEvidence } from './work-evidence-guard.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import {
  attachValidationRepairAuditChainToPayload,
  createValidationRepairAuditChain,
} from './validation-repair-audit-bridge.js';

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
  await persistAnnotatedRepairRerunPayloadBestEffort(input.workspacePath, completedPayloadRef, annotated);
  return annotated;
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

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}
