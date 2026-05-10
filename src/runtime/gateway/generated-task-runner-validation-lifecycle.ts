import { writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { GatewayRequest, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult, WorkspaceTaskSpec } from '../runtime-types.js';
import { errorMessage, isRecord, toRecordList } from '../gateway-utils.js';
import { appendTaskAttempt, readRecentTaskAttempts } from '../task-attempt-history.js';
import { sha1 } from '../workspace-task-runner.js';
import type { RuntimeRefBundle } from './artifact-materializer.js';
import { currentTurnReferences } from './agentserver-context-window.js';
import { summarizeTaskAttemptsForAgentServer } from './context-envelope.js';
import { evaluateGuidanceAdoption } from './guidance-adoption-guard.js';
import { selectedComponentIdsForRequest } from './gateway-request.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { evaluateToolPayloadEvidence } from './work-evidence-guard.js';
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

export interface GeneratedTaskRuntimeRefs {
  taskRel: string;
  inputRel: string;
  outputRel: string;
  stdoutRel: string;
  stderrRel: string;
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
  lifecycle: GeneratedTaskDirectPayloadLifecycle;
  attemptPlanRefs: AttemptPlanRefs;
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

export function assessGeneratedTaskDirectPayloadLifecycle(
  input: GeneratedTaskDirectPayloadLifecycleInput,
): GeneratedTaskDirectPayloadLifecycle {
  const evidenceFinding = evaluateToolPayloadEvidence(input.payload, input.request);
  const guidanceFinding = evaluateGuidanceAdoption(input.payload, input.request);
  const workEvidenceSummary = summarizeWorkEvidenceForHandoff(input.payload);
  const payloadFailureReason = input.firstPayloadFailureReason(input.payload)
    ?? firstRepairOrFailurePayloadReason(input.payload);
  const payloadFailureStatus = input.payloadHasFailureStatus(input.payload) || payloadHasRepairOrFailureStatus(input.payload);
  const guardFailureReason = !payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined;
  const failureReason = payloadFailureReason ?? guardFailureReason;
  const attemptStatus = guidanceFinding
    ? guidanceFinding.severity
    : evidenceFinding
      ? evidenceFinding.severity
      : payloadFailureStatus
        ? payloadAttemptStatus(input.payload)
        : 'done';

  return {
    workEvidenceSummary,
    payloadFailureStatus,
    failureReason,
    attemptStatus,
    guardFailureReason,
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
  await appendTaskAttempt(input.workspacePath, {
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
  });
}

export async function runGeneratedTaskRepairAttemptLifecycle(
  input: GeneratedTaskRepairAttemptLifecycleInput,
): Promise<ToolPayload | undefined> {
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
  return await runGeneratedTaskRepairAuditLifecycle(input);
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
    finalStatus: 'succeeded',
    recoverActions: ['record-successful-dynamic-glue', 'preserve-runtime-evidence-refs'],
    eventKind: 'dynamic-glue-execution',
    promotionReason: 'Successful dynamic glue execution is ledger evidence; repeated compatible records can become promotion candidates.',
  });
}

export async function recordGeneratedTaskSuccessLedgerLifecycle(
  input: GeneratedTaskSuccessLedgerLifecycleInput,
) {
  await recordGeneratedTaskSuccessLedger({
    ...input,
    ...input.refs,
  });
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
  await appendTaskAttempt(input.workspacePath, {
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
  });
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
