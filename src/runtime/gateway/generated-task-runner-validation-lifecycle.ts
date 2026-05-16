import { writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type { ValidationFindingProjectionInput } from '@sciforge-ui/runtime-contract/validation-repair-audit';
import type { GatewayRequest, SkillAvailability, TaskAttemptRecord, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult, WorkspaceTaskSpec } from '../runtime-types.js';
import { errorMessage, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { appendTaskAttempt, readRecentTaskAttempts } from '../task-attempt-history.js';
import { sha1 } from '../workspace-task-runner.js';
import type { RuntimeRefBundle } from './artifact-materializer.js';
import { currentTurnReferences } from './agentserver-context-window.js';
import { summarizeTaskAttemptsForAgentServer } from './context-envelope.js';
import {
  attachGeneratedTaskGuardBudgetDebit,
  evaluateGeneratedTaskGuardFinding,
  generatedTaskCurrentRefs,
  generatedTaskGuardChainId,
  generatedTaskGuardFindingProjection,
  generatedTaskGuardRelatedRefs,
  generatedTaskPayloadArtifactRefs,
  generatedTaskRefForGeneratedTaskGuardRefs,
  type GeneratedTaskGuardFinding,
  payloadHasValidationRepairAudit,
  validationSubjectKindForGeneratedTaskGuardRefs,
} from './generated-task-validation-guard.js';
import { selectedComponentIdsForRequest } from './gateway-request.js';
import { recordCapabilityEvolutionRuntimeEvent } from './capability-evolution-events.js';
import { capabilityProviderRoutesForGatewayInvocation, capabilityProviderRoutesForHandoff } from './capability-provider-preflight.js';
import { summarizeWorkEvidenceForHandoff } from './work-evidence-types.js';
import {
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightForTaskInput,
  generatedTaskPayloadPreflightFailureReason,
  generatedTaskPayloadPreflightRecoverActions,
  type GeneratedTaskPayloadPreflightReport,
} from './generated-task-payload-preflight.js';
import {
  attachValidationRepairAuditChainToPayload,
  createValidationRepairAuditChain,
} from './validation-repair-audit-bridge.js';
import { recordValidationRepairTelemetryForPayload } from './validation-repair-telemetry-runtime.js';

export {
  attachGeneratedTaskSuccessBudgetDebit,
  capabilityEvolutionLedgerRefsFromResult,
  generatedTaskSuccessBudgetDebitAuditRefs,
  generatedTaskSuccessBudgetDebitId,
} from './generated-task-success-budget-debit.js';
export {
  attachGeneratedTaskFailureBudgetDebit,
  generatedTaskFailureBudgetDebitAuditRefs,
  generatedTaskFailureBudgetDebitId,
} from './generated-task-failure-budget-debit.js';
export type {
  GeneratedTaskSuccessBudgetDebitInput,
} from './generated-task-success-budget-debit.js';
export type {
  GeneratedTaskGuardFinding,
} from './generated-task-validation-guard.js';
export {
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightFailureReason,
  generatedTaskPayloadPreflightRecoverActions,
  type GeneratedTaskPayloadPreflightReport,
} from './generated-task-payload-preflight.js';

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
  taskHelperRel?: string;
  expectedArtifacts: string[];
  payloadPreflight?: GeneratedTaskPayloadPreflightReport;
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
  budgetDebitRefs?: string[];
  budgetDebitAuditRefs?: string[];
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
    && (Boolean(evidenceFailureReason) || normalizedRepairNeeded || (run.exitCode !== 0 && !payloadFailureStatus));
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
  const recordWithPartialRefs = taskAttemptWithWorkEvidenceRefs({
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
    sessionId: sessionIdForRequest(input.request),
    sessionBundleRef: sessionBundleRelForRequest(input.request),
    exitCode: input.run.exitCode,
    schemaErrors: input.schemaErrors,
    workEvidenceSummary: input.workEvidenceSummary,
    failureReason: input.failureReason,
    createdAt: new Date().toISOString(),
  });
  await appendTaskAttempt(input.workspacePath, taskAttemptWithBudgetDebitRefs(
    recordWithPartialRefs,
    input.budgetDebitRefs,
    input.budgetDebitAuditRefs,
  ));
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

export async function buildGeneratedTaskRunInputLifecycle(
  input: GeneratedTaskRunInputLifecycleInput,
): Promise<GeneratedTaskRunInputLifecycle> {
  const currentRefs = currentTurnReferences(input.request);
  const providerRouteRequest = providerRouteRequestForGeneratedTask(input.request, input.expectedArtifacts);
  const internalProviderRoutes = capabilityProviderRoutesForGatewayInvocation(providerRouteRequest);
  const providerRoutes = capabilityProviderRoutesForHandoff(providerRouteRequest);
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
      taskHelperSdk: {
        schemaVersion: 'sciforge.generated-task-helper.v1',
        moduleName: 'sciforge_task',
        helperRef: input.taskHelperRel,
        importHint: 'from sciforge_task import load_input, write_payload, provider_route, has_ready_provider, require_provider_first, invoke_capability, invoke_provider, provider_result_is_empty, empty_result_payload',
      },
      capabilityProviderRoutes: {
        requiredCapabilityIds: providerRoutes.requiredCapabilityIds,
        ok: providerRoutes.ok,
        routes: providerRoutes.routes,
      },
      providerInvocation: providerInvocationForGeneratedTask(internalProviderRoutes),
      capabilityFirstPolicy: {
        schemaVersion: 'sciforge.generated-task-capability-first.v1',
        policy: 'provider-first',
        rules: [
          'Import sciforge_task from the generated task entrypoint directory for input loading, ToolPayload writing, and provider route inspection.',
          'When capabilityProviderRoutes declares a ready capability route, call invoke_capability(task_input, capabilityId, input). invoke_provider is the web provider alias for web_search/web_fetch.',
          'Do not call requests, urllib, fetch, httpx, aiohttp, or Node http/https for web work that has a ready SciForge provider route.',
          'After invoke_capability, check provider_result_is_empty(result); if empty, write_payload(output_path, empty_result_payload(...)) with refine/recover actions instead of waiting or repairing indefinitely.',
          'If a provider route is unavailable, empty, unauthorized, or rate limited, write an honest repair-needed or failed-with-reason ToolPayload with recoverActions.',
        ],
      },
      generatedTaskPayloadPreflight: input.payloadPreflight
        ? generatedTaskPayloadPreflightForTaskInput(input.payloadPreflight)
        : undefined,
    },
    retentionProtectedInputRels: input.generatedInputRels,
  };
}

function providerRouteRequestForGeneratedTask(request: GatewayRequest, expectedArtifacts: string[]): GatewayRequest {
  const selectedToolIds = new Set(toStringList(request.selectedToolIds));
  const expectsLiteratureRetrievalArtifact = expectedArtifacts.some((artifactType) => (
    artifactType === 'paper-list' || artifactType === 'evidence-matrix'
  ));
  if (request.externalIoRequired || expectsLiteratureRetrievalArtifact) {
    selectedToolIds.add('web_search');
    selectedToolIds.add('web_fetch');
  }
  if (!selectedToolIds.size) return request;
  return {
    ...request,
    selectedToolIds: [...selectedToolIds],
  };
}

function providerInvocationForGeneratedTask(providerRoutes: ReturnType<typeof capabilityProviderRoutesForGatewayInvocation>) {
  const adapters = providerRoutes.routes
    .filter((route) => route.status === 'ready')
    .map((route) => {
      const provider = route.providers.find((candidate) => candidate.providerId === route.primaryProviderId) ?? route.providers[0];
      const base = {
        capabilityId: route.capabilityId,
        providerId: route.primaryProviderId ?? provider?.providerId,
        toolId: route.capabilityId,
        status: route.status,
      };
      const endpoint = provider ? providerEndpoint(provider) : undefined;
      if (endpoint) {
        return {
          ...base,
          kind: 'http',
          endpoint,
          invokePath: provider?.invokePath ?? '/invoke',
          timeoutMs: provider?.timeoutMs ?? 30000,
        };
      }
      if (provider?.workerId === 'sciforge.web-worker' || /^sciforge\.web-worker\./.test(provider?.providerId ?? '')) {
        const cli = localWebWorkerCliAdapter();
        if (cli) {
          return {
            ...base,
            kind: 'node-cli',
            command: cli.command,
            argsPrefix: [...cli.argsPrefix, 'invoke', route.capabilityId],
            inputArg: 'json-last',
            timeoutMs: provider?.timeoutMs ?? 30000,
          };
        }
      }
      return {
        ...base,
        kind: 'unavailable',
        reason: 'No generated-task invocation adapter is registered for this provider.',
      };
    });
  return {
    schemaVersion: 'sciforge.generated-task-provider-invocation.v1',
    adapters,
  };
}

function providerEndpoint(provider: { endpoint?: unknown; baseUrl?: unknown; url?: unknown; invokeUrl?: unknown }) {
  for (const value of [provider.invokeUrl, provider.endpoint, provider.baseUrl, provider.url]) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  }
  return undefined;
}

function localWebWorkerCliAdapter() {
  try {
    const require = createRequire(import.meta.url);
    const tsxLoader = require.resolve('tsx');
    const cliPath = fileURLToPath(new URL('../../../packages/workers/web-worker/src/cli.ts', import.meta.url));
    return {
      command: process.execPath,
      argsPrefix: ['--import', tsxLoader, resolve(cliPath)],
    };
  } catch {
    return undefined;
  }
}

export async function appendGeneratedTaskGenerationFailureLifecycle(
  input: GeneratedTaskGenerationFailureLifecycleInput,
) {
  await appendTaskAttempt(input.workspacePath, taskAttemptWithBudgetDebitRefs({
    id: input.failedRequestId,
    prompt: input.request.prompt,
    skillDomain: input.request.skillDomain,
    ...input.attemptPlanRefs(input.request, input.skill, input.failureReason),
    skillId: input.skill.id,
    attempt: 1,
    status: 'repair-needed',
    failureReason: input.failureReason,
    sessionId: sessionIdForRequest(input.request),
    sessionBundleRef: sessionBundleRelForRequest(input.request),
    contextRecovery: contextRecoveryAttemptMetadata(input.diagnostics),
    createdAt: new Date().toISOString(),
  }, input.budgetDebitRefs, input.budgetDebitAuditRefs));
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
    sessionId: sessionIdForRequest(input.request),
    sessionBundleRef: sessionBundleRelForRequest(input.request),
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
      artifactRefs: generatedTaskPayloadArtifactRefs(input.sourcePayload ?? input.payload),
      currentRefs: generatedTaskCurrentRefs(input.request),
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
    harnessSignals: diagnostics.harnessSignals,
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

function taskAttemptWithWorkEvidenceRefs(record: TaskAttemptRecord): TaskAttemptRecord {
  const refs = uniqueStrings((record.workEvidenceSummary?.items ?? [])
    .flatMap((item) => toStringList(item.evidenceRefs)));
  if (!refs.length) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      partialArtifactRefs: uniqueStrings([
        ...toStringList(isRecord(current.refs) ? current.refs.partialArtifactRefs : undefined),
        ...refs,
      ]),
    },
  } as TaskAttemptRecord;
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
      artifactRefs: generatedTaskPayloadArtifactRefs(repaired),
      currentRefs: generatedTaskCurrentRefs(input.request),
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

function sessionIdForRequest(request: GatewayRequest) {
  return typeof request.uiState?.sessionId === 'string' && request.uiState.sessionId.trim()
    ? request.uiState.sessionId.trim()
    : undefined;
}
