import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { isRecord, safeWorkspaceRel } from '../gateway-utils.js';
import { ensureSessionBundle, sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { sha1 } from '../workspace-task-runner.js';
import { materializeBackendPayloadOutput, type RuntimeRefBundle } from './artifact-materializer.js';
import {
  attachGeneratedTaskSuccessBudgetDebit,
  attachGeneratedTaskFailureBudgetDebit,
  appendGeneratedTaskDirectPayloadAttemptLifecycle,
  appendGeneratedTaskGenerationFailureLifecycle,
  assessGeneratedTaskDirectPayloadLifecycle,
  annotateGeneratedTaskGuardValidationFailurePayload,
  capabilityEvolutionLedgerRefsFromResult,
  generatedTaskFailureBudgetDebitAuditRefs,
  generatedTaskFailureBudgetDebitId,
  generatedTaskSuccessBudgetDebitAuditRefs,
  generatedTaskSuccessBudgetDebitId,
  recordAgentServerDirectPayloadSuccessLedgerLifecycle,
} from './generated-task-runner-validation-lifecycle.js';
import { reportRuntimeResultViewSlots } from '../../../packages/presentation/interactive-views';
import {
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH,
  CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
  CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL,
  buildCurrentReferenceDigestRecoveryPayload,
  currentReferenceDigestFailureCanRecover,
  currentReferenceDigestRecoveryCandidates,
  type CurrentReferenceDigestRecoverySource,
} from '../../../packages/contracts/runtime/artifact-policy';
import {
  AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
  agentServerGeneratedEntrypointContractReason,
  agentServerGeneratedTaskInterfaceContractReason,
  agentServerGeneratedTaskRetryDetail,
  agentServerPathOnlyStrictRetryDirectPayloadReason,
  agentServerPathOnlyStrictRetryStillMissingReason,
  agentServerPathOnlyTaskFilesReason,
  agentServerStablePayloadTaskId,
} from '../../../packages/skills/runtime-policy';
import {
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightFailureReason,
  isGeneratedTaskCapabilityFirstPolicyIssue,
} from './generated-task-payload-preflight.js';

export const AGENTSERVER_DIRECT_PAYLOAD_TASK_REF = 'agentserver://direct-payload' as const;

export type AgentServerGenerationResult =
  | AgentServerTaskFilesGeneration
  | AgentServerDirectPayloadGeneration
  | AgentServerGenerationFailure;

export interface AgentServerGenerationFailure {
  ok: false;
  error: string;
  diagnostics?: any;
}

export interface AgentServerTaskFilesGeneration {
  ok: true;
  runId?: string;
  response: AgentServerGenerationResponse;
}

export interface AgentServerDirectPayloadGeneration {
  ok: true;
  runId?: string;
  directPayload: ToolPayload;
}

type AttemptPlanRefs = (request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string) => Record<string, unknown>;

export interface GeneratedTaskGenerationLifecycleDeps {
  requestAgentServerGeneration(params: {
    baseUrl: string;
    request: GatewayRequest;
    skill: SkillAvailability;
    skills: SkillAvailability[];
    workspace: string;
    callbacks?: WorkspaceRuntimeCallbacks;
    strictTaskFilesReason?: string;
  }): Promise<AgentServerGenerationResult>;
  attemptPlanRefs: AttemptPlanRefs;
  repairNeededPayload(request: GatewayRequest, skill: SkillAvailability, reason: string, refs?: Record<string, unknown>): ToolPayload;
  ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload;
  mergeReusableContextArtifactsForDirectPayload(payload: ToolPayload, request: GatewayRequest): Promise<ToolPayload>;
  validateAndNormalizePayload(
    payload: ToolPayload,
    request: GatewayRequest,
    skill: SkillAvailability,
    refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
  ): Promise<ToolPayload>;
  firstPayloadFailureReason(payload: ToolPayload): string | undefined;
  payloadHasFailureStatus(payload: ToolPayload): boolean;
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

export interface ResolveGeneratedTaskGenerationLifecycleInput {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  generation: AgentServerTaskFilesGeneration;
  deps: GeneratedTaskGenerationLifecycleDeps;
}

export type ResolveGeneratedTaskGenerationLifecycleResult =
  | { kind: 'task-files'; generation: AgentServerTaskFilesGeneration }
  | { kind: 'payload'; payload: ToolPayload };

export async function completeAgentServerGenerationFailureLifecycle(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerGenerationFailure;
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: GeneratedTaskGenerationFailureLifecycleDeps;
}): Promise<ToolPayload> {
  const digestRecovery = await currentReferenceDigestRecoveryPayload(input);
  if (digestRecovery) return digestRecovery;

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
  return attachGeneratedTaskFailureBudgetDebit({
    ...budgetDebitInput,
    payload: repairPayload,
  });
}

export async function resolveGeneratedTaskGenerationRetryLifecycle(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  let generation = input.generation;
  const entrypointResult = await retryGeneratedTaskEntrypointContract(input, generation);
  if (entrypointResult.kind === 'payload') return entrypointResult;
  generation = entrypointResult.generation;

  const pathOnlyResult = await retryGeneratedTaskPathOnlyContract(input, generation);
  if (pathOnlyResult.kind === 'payload') return pathOnlyResult;
  generation = pathOnlyResult.generation;

  const interfaceResult = await retryGeneratedTaskInterfaceContract(input, generation);
  if (interfaceResult.kind === 'payload') return interfaceResult;
  generation = interfaceResult.generation;

  return await retryGeneratedTaskPayloadPreflightContract(input, generation);
}

export async function completeAgentServerDirectPayloadLifecycle(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerDirectPayloadGeneration;
  deps: Omit<GeneratedTaskGenerationLifecycleDeps, 'requestAgentServerGeneration'>;
  kind: 'initial' | 'strict-retry';
  stableTaskKind: string;
  logLine: string;
  source: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}): Promise<ToolPayload> {
  const taskId = stableAgentServerPayloadTaskId(input.stableTaskKind, input.request, input.skill, input.generation.runId);
  const sessionBundleRel = sessionBundleRelForRequest(input.request);
  await ensureSessionBundle(input.workspace, sessionBundleRel, {
    sessionId: typeof input.request.uiState?.sessionId === 'string' ? input.request.uiState.sessionId : 'sessionless',
    scenarioId: input.request.scenarioPackageRef?.id || input.request.skillDomain,
    createdAt: typeof input.request.uiState?.sessionCreatedAt === 'string' ? input.request.uiState.sessionCreatedAt : undefined,
    updatedAt: typeof input.request.uiState?.sessionUpdatedAt === 'string' ? input.request.uiState.sessionUpdatedAt : undefined,
  });
  const refs = backendPayloadRefs(
    taskId,
    AGENTSERVER_DIRECT_PAYLOAD_TASK_REF,
    sessionBundleRel,
  );
  await writeBackendPayloadLogs(input.workspace, refs, input.logLine);
  const directPayload = await input.deps.mergeReusableContextArtifactsForDirectPayload(
    input.deps.ensureDirectAnswerReportArtifact(
      input.generation.directPayload,
      input.request,
      input.source,
    ),
    input.request,
  );
  let normalized = await input.deps.validateAndNormalizePayload(directPayload, input.request, input.skill, {
    ...refs,
    runtimeFingerprint: { runtime: 'AgentServer direct ToolPayload', runId: input.generation.runId },
  });
  normalized = await materializeBackendPayloadOutput(input.workspace, input.request, normalized, refs);
  if (input.kind === 'strict-retry') return normalized;

  const lifecycle = assessGeneratedTaskDirectPayloadLifecycle({
    payload: normalized,
    request: input.request,
    firstPayloadFailureReason: input.deps.firstPayloadFailureReason,
    payloadHasFailureStatus: input.deps.payloadHasFailureStatus,
  });
  await appendGeneratedTaskDirectPayloadAttemptLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    runId: input.generation.runId,
    refs,
    payload: normalized,
    lifecycle,
    attemptPlanRefs: input.deps.attemptPlanRefs,
    budgetDebitRefs: [generatedTaskSuccessBudgetDebitId({
      request: input.request,
      skill: input.skill,
      taskId,
      runId: input.generation.runId,
      refs,
      source: 'agentserver-direct-payload',
    })],
    budgetDebitAuditRefs: generatedTaskSuccessBudgetDebitAuditRefs({
      request: input.request,
      skill: input.skill,
      taskId,
      runId: input.generation.runId,
      refs,
      source: 'agentserver-direct-payload',
    }),
  });
  if (lifecycle.guardFailureReason) {
    return await annotateGeneratedTaskGuardValidationFailurePayload({
      payload: input.deps.repairNeededPayload(input.request, input.skill, lifecycle.guardFailureReason),
      sourcePayload: normalized,
      workspacePath: input.workspace,
      request: input.request,
      skill: input.skill,
      refs,
      guardFinding: lifecycle.guardFinding,
    });
  }
  if (lifecycle.payloadFailureStatus) return normalized;
  const completed = {
    ...normalized,
    reasoningTrace: [
      normalized.reasoningTrace,
      `AgentServer generation run: ${input.generation.runId || 'unknown'}`,
      'AgentServer returned a SciForge ToolPayload directly; no workspace task archive was required.',
    ].filter(Boolean).join('\n'),
    executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
      ...unit,
      ...input.deps.attemptPlanRefs(input.request, input.skill),
      agentServerGenerated: true,
      agentServerRunId: input.generation.runId,
    } : unit),
  };
  const ledgerResult = await recordAgentServerDirectPayloadSuccessLedgerLifecycle({
    workspacePath: input.workspace,
    request: input.request,
    skill: input.skill,
    runId: input.generation.runId,
    payload: completed,
    refs,
  });
  const completedWithDebit = attachGeneratedTaskSuccessBudgetDebit({
    request: input.request,
    skill: input.skill,
    taskId,
    runId: input.generation.runId,
    payload: completed,
    refs,
    source: 'agentserver-direct-payload',
    runtimeLabel: 'AgentServer direct ToolPayload',
    ledgerRefs: capabilityEvolutionLedgerRefsFromResult(ledgerResult),
  });
  const directDebit = completedWithDebit.budgetDebits?.find((debit) => debit.capabilityId === 'sciforge.agentserver.direct-payload');
  if (directDebit) {
    await appendGeneratedTaskDirectPayloadAttemptLifecycle({
      workspacePath: input.workspace,
      request: input.request,
      skill: input.skill,
      runId: input.generation.runId,
      refs,
      payload: completedWithDebit,
      lifecycle,
      attemptPlanRefs: input.deps.attemptPlanRefs,
      budgetDebitRefs: [directDebit.debitId],
      budgetDebitAuditRefs: directDebit.sinkRefs.auditRefs,
    });
  }
  return await materializeBackendPayloadOutput(input.workspace, input.request, completedWithDebit, refs);
}

export function backendPayloadRefs(taskId: string, taskRel: string, sessionBundleRel?: string): RuntimeRefBundle {
  return {
    taskRel,
    outputRel: sessionBundleResourceRel(sessionBundleRel, 'task-results', `${taskId}.json`),
    stdoutRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stdout.log`),
    stderrRel: sessionBundleResourceRel(sessionBundleRel, 'logs', `${taskId}.stderr.log`),
  };
}

export function stableAgentServerPayloadTaskId(
  kind: string,
  request: GatewayRequest,
  skill: SkillAvailability,
  runId: string | undefined,
) {
  return agentServerStablePayloadTaskId({
    kind,
    skillDomain: request.skillDomain,
    skillId: skill.id,
    prompt: request.prompt,
    runId,
    shortHash: (value) => sha1(value).slice(0, 12),
  });
}

export async function writeBackendPayloadLogs(
  workspace: string,
  refs: RuntimeRefBundle,
  stdout: string,
  stderr = '',
) {
  try {
    await Promise.all([
      mkdir(dirname(join(workspace, refs.stdoutRel)), { recursive: true }),
      mkdir(dirname(join(workspace, refs.stderrRel)), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(workspace, refs.stdoutRel), stdout),
      writeFile(join(workspace, refs.stderrRel), stderr),
    ]);
  } catch {
    // Stable output materialization is the contract; direct-payload logs are best effort.
  }
}

export async function readGeneratedTaskFileIfPresent(workspace: string, path: string) {
  try {
    return await readFile(join(workspace, safeWorkspaceRel(path)), 'utf8');
  } catch {
    return undefined;
  }
}

export async function missingGeneratedTaskFileContents(
  workspace: string,
  taskFiles: AgentServerGenerationResponse['taskFiles'],
) {
  const missing: string[] = [];
  for (const file of taskFiles) {
    if (file.content) continue;
    const existing = await readGeneratedTaskFileIfPresent(workspace, file.path);
    if (existing === undefined) missing.push(safeWorkspaceRel(file.path));
  }
  return missing;
}

async function retryGeneratedTaskEntrypointContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const nonExecutableEntrypointReason = agentServerGeneratedEntrypointContractReason(generation.response, { normalizePath: safeWorkspaceRel });
  if (!nonExecutableEntrypointReason) return { kind: 'task-files', generation };
  emitGenerationRetryEvent(input.callbacks, nonExecutableEntrypointReason, 'entrypoint');
  const retriedGeneration = await requestStrictGenerationRetry(input, nonExecutableEntrypointReason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-entrypoint',
        logLine: `AgentServer strict retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }
  const retryReason = agentServerGeneratedEntrypointContractReason(retriedGeneration.response, { normalizePath: safeWorkspaceRel });
  if (retryReason) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${nonExecutableEntrypointReason}. Strict retry still returned invalid entrypoint: ${retryReason}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskPathOnlyContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const missingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(input.workspace, generation.response.taskFiles);
  if (!missingPathOnlyTaskFiles.length) return { kind: 'task-files', generation };
  const reason = agentServerPathOnlyTaskFilesReason(missingPathOnlyTaskFiles);
  emitGenerationRetryEvent(input.callbacks, reason, 'path-only-task-files');
  const retriedGeneration = await requestStrictGenerationRetry(input, reason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return repairNeeded(input, agentServerPathOnlyStrictRetryDirectPayloadReason(reason));
  }
  const stillMissingPathOnlyTaskFiles = await missingGeneratedTaskFileContents(input.workspace, retriedGeneration.response.taskFiles);
  if (stillMissingPathOnlyTaskFiles.length) {
    const contractReason = agentServerPathOnlyStrictRetryStillMissingReason(reason, stillMissingPathOnlyTaskFiles);
    return repairNeeded(input, `AgentServer generation contract violation: ${contractReason}`);
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskInterfaceContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const taskInterfaceReason = await generatedTaskInterfaceContractReason(input.workspace, generation.response);
  if (!taskInterfaceReason) return { kind: 'task-files', generation };
  emitGenerationRetryEvent(input.callbacks, taskInterfaceReason, 'task-interface');
  const retriedGeneration = await requestStrictGenerationRetry(input, taskInterfaceReason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-interface',
        logLine: `AgentServer interface retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }
  const retryInterfaceReason = await generatedTaskInterfaceContractReason(input.workspace, retriedGeneration.response);
  if (retryInterfaceReason) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${taskInterfaceReason}. Strict retry still returned a static/non-interface task: ${retryInterfaceReason}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskPayloadPreflightContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const preflight = await generatedTaskPayloadPreflightForGeneration(input.workspace, generation.response, input.request);
  if (!preflight.issues.some((issue) => issue.severity === 'repair-needed' && isGeneratedTaskCapabilityFirstPolicyIssue(issue))) {
    return { kind: 'task-files', generation };
  }
  const reason = generatedTaskPayloadPreflightFailureReason(preflight);
  emitGenerationRetryEvent(input.callbacks, reason, 'provider-first-payload-preflight');
  const retriedGeneration = await requestStrictGenerationRetry(input, reason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-provider-first-preflight',
        logLine: `AgentServer provider-first preflight retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }
  const retryPreflight = await generatedTaskPayloadPreflightForGeneration(input.workspace, retriedGeneration.response, input.request);
  const retryCapabilityIssues = retryPreflight.issues.filter((issue) => (
    issue.severity === 'repair-needed' && isGeneratedTaskCapabilityFirstPolicyIssue(issue)
  ));
  if (retryCapabilityIssues.length) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${reason}. Strict retry still bypassed ready provider routes: ${generatedTaskPayloadPreflightFailureReason(retryPreflight)}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function generatedTaskPayloadPreflightForGeneration(
  workspace: string,
  response: AgentServerGenerationResponse,
  request: GatewayRequest,
) {
  const taskFiles = await Promise.all(response.taskFiles.map(async (file) => ({
    ...file,
    content: typeof file.content === 'string'
      ? file.content
      : await readGeneratedTaskFileIfPresent(workspace, file.path),
  })));
  return evaluateGeneratedTaskPayloadPreflight({
    request,
    entrypoint: response.entrypoint,
    expectedArtifacts: response.expectedArtifacts,
    taskFiles,
  });
}

async function generatedTaskInterfaceContractReason(workspace: string, response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const content = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel)?.content
    ?? await readGeneratedTaskFileIfPresent(workspace, entryRel);
  if (content === undefined) return undefined;
  const language = String(response.entrypoint.language || '').toLowerCase();
  return agentServerGeneratedTaskInterfaceContractReason({ entryRel, language, source: content });
}

function directPayloadCompletionInput(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerDirectPayloadGeneration,
) {
  return {
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    generation,
    deps: input.deps,
    callbacks: input.callbacks,
  };
}

function emitGenerationRetryEvent(
  callbacks: WorkspaceRuntimeCallbacks | undefined,
  message: string,
  kind: Parameters<typeof agentServerGeneratedTaskRetryDetail>[0],
) {
  emitWorkspaceRuntimeEvent(callbacks, {
    type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
    source: 'workspace-runtime',
    status: 'running',
    message,
    detail: agentServerGeneratedTaskRetryDetail(kind),
  });
}

function requestStrictGenerationRetry(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  strictTaskFilesReason: string,
) {
  return input.deps.requestAgentServerGeneration({
    baseUrl: input.baseUrl,
    request: input.request,
    skill: input.skill,
    skills: input.skills,
    workspace: input.workspace,
    callbacks: input.callbacks,
    strictTaskFilesReason,
  });
}

function repairNeeded(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  reason: string,
): { kind: 'payload'; payload: ToolPayload } {
  return {
    kind: 'payload',
    payload: input.deps.repairNeededPayload(input.request, input.skill, reason),
  };
}

async function currentReferenceDigestRecoveryPayload(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  generation: AgentServerGenerationFailure;
  callbacks?: WorkspaceRuntimeCallbacks;
  deps: Pick<GeneratedTaskGenerationFailureLifecycleDeps, 'validateAndNormalizePayload'>;
}): Promise<ToolPayload | undefined> {
  if (!currentReferenceDigestFailureCanRecover(input.generation.error)) return undefined;
  const candidates = currentReferenceDigestRecoveryCandidates(input.request.uiState?.currentReferenceDigests);
  if (!candidates.length) return undefined;
  const sources: CurrentReferenceDigestRecoverySource[] = [];
  for (const digest of candidates) {
    if (digest.inlineText) {
      sources.push({
        sourceRef: digest.sourceRef,
        digestRef: digest.digestRef,
        text: digest.inlineText,
      });
      continue;
    }
    if (digest.digestRef) {
      const abs = resolve(input.workspace, safeWorkspaceRel(digest.digestRef));
      try {
        const text = await readFile(abs, 'utf8');
        sources.push({
          sourceRef: digest.sourceRef,
          digestRef: digest.digestRef,
          text,
        });
      } catch {
        // A missing digest should not block other current references.
      }
    }
  }
  if (!sources.length) return undefined;
  emitWorkspaceRuntimeEvent(input.callbacks, {
    type: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE,
    source: 'workspace-runtime',
    status: 'self-healed',
    message: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE,
    detail: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL,
  });
  const recoveryRefs = backendPayloadRefs(
    stableAgentServerPayloadTaskId('digest-recovery', input.request, input.skill, sha1(input.request.prompt).slice(0, 8)),
    `agentserver://${CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH}`,
    sessionBundleRelForRequest(input.request),
  );
  await writeBackendPayloadLogs(input.workspace, recoveryRefs, CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE);
  const recoveryPayload = buildCurrentReferenceDigestRecoveryPayload({
    prompt: input.request.prompt,
    skillDomain: input.request.skillDomain,
    skillId: input.skill.id,
    failureReason: input.generation.error,
    sources,
    uiManifest: reportRuntimeResultViewSlots(
      CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
      `${input.request.skillDomain}-runtime-result`,
    ),
    shortHash: (value) => sha1(value).slice(0, 8),
  }) as ToolPayload;
  const normalizedRecovery = await input.deps.validateAndNormalizePayload(recoveryPayload, input.request, input.skill, {
    ...recoveryRefs,
    runtimeFingerprint: { runtime: CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL, error: input.generation.error },
  });
  return await materializeBackendPayloadOutput(input.workspace, input.request, normalizedRecovery, recoveryRefs);
}
