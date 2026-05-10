import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceTaskRunResult } from '../runtime-types.js';
import { sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { safeWorkspaceRel } from '../gateway-utils.js';
import { materializeBackendPayloadOutput } from './artifact-materializer.js';
import {
  appendGeneratedTaskGenerationFailureLifecycle,
} from './generated-task-runner-validation-lifecycle.js';
import {
  backendPayloadRefs,
  completeAgentServerDirectPayloadLifecycle,
  resolveGeneratedTaskGenerationRetryLifecycle,
  stableAgentServerPayloadTaskId,
  writeBackendPayloadLogs,
  type AgentServerGenerationResult,
} from './generated-task-runner-generation-lifecycle.js';
import { runGeneratedTaskExecutionLifecycle } from './generated-task-runner-execution-lifecycle.js';
import { completeGeneratedTaskRunOutputLifecycle } from './generated-task-runner-output-lifecycle.js';
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

export interface GeneratedTaskRunnerDeps {
  readConfiguredAgentServerBaseUrl(workspace: string): Promise<string | undefined>;
  requestAgentServerGeneration(params: {
    baseUrl: string;
    request: GatewayRequest;
    skill: SkillAvailability;
    skills: SkillAvailability[];
    workspace: string;
    callbacks?: WorkspaceRuntimeCallbacks;
    strictTaskFilesReason?: string;
  }): Promise<AgentServerGenerationResult>;
  agentServerGenerationFailureReason(error: string, diagnostics?: any): string;
  attemptPlanRefs(request: GatewayRequest, skill?: SkillAvailability, fallbackReason?: string): Record<string, unknown>;
  repairNeededPayload(request: GatewayRequest, skill: SkillAvailability, reason: string, refs?: Record<string, unknown>): ToolPayload;
  agentServerFailurePayloadRefs(diagnostics?: any): Record<string, unknown>;
  ensureDirectAnswerReportArtifact(payload: ToolPayload, request: GatewayRequest, source: string): ToolPayload;
  mergeReusableContextArtifactsForDirectPayload(payload: ToolPayload, request: GatewayRequest): Promise<ToolPayload>;
  validateAndNormalizePayload(
    payload: ToolPayload,
    request: GatewayRequest,
    skill: SkillAvailability,
    refs: { taskRel: string; outputRel: string; stdoutRel: string; stderrRel: string; runtimeFingerprint: Record<string, unknown> },
  ): Promise<ToolPayload>;
  tryAgentServerRepairAndRerun(params: {
    request: GatewayRequest;
    skill: SkillAvailability;
    taskId: string;
    taskPrefix: string;
    run: WorkspaceTaskRunResult;
    schemaErrors: string[];
    failureReason: string;
    callbacks?: WorkspaceRuntimeCallbacks;
  }): Promise<ToolPayload | undefined>;
  failedTaskPayload(request: GatewayRequest, skill: SkillAvailability, run: WorkspaceTaskRunResult, parseReason?: string): ToolPayload;
  coerceWorkspaceTaskPayload(value: unknown): ToolPayload | undefined;
  schemaErrors(payload: unknown): string[];
  firstPayloadFailureReason(payload: ToolPayload, run?: WorkspaceTaskRunResult): string | undefined;
  payloadHasFailureStatus(payload: ToolPayload): boolean;
}

export async function runAgentServerGeneratedTask(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks = {},
  deps: GeneratedTaskRunnerDeps,
  options: { allowSupplement?: boolean } = {},
): Promise<ToolPayload | undefined> {
  const {
    agentServerFailurePayloadRefs,
    agentServerGenerationFailureReason,
    attemptPlanRefs,
    readConfiguredAgentServerBaseUrl,
    repairNeededPayload,
    requestAgentServerGeneration,
    validateAndNormalizePayload,
  } = deps;
  const workspace = resolve(request.workspacePath || process.cwd());
  const baseUrl = request.agentServerBaseUrl || await readConfiguredAgentServerBaseUrl(workspace);
  if (!baseUrl) {
    return repairNeededPayload(request, skill, 'No validated local skill matched this request and no AgentServer base URL is configured.');
  }
  let generation = await requestAgentServerGeneration({
    baseUrl,
    request,
    skill,
    skills,
    workspace,
    callbacks,
  });
  if (!generation.ok) {
    const digestRecovery = await currentReferenceDigestRecoveryPayload(request, skill, workspace, generation.error);
    if (digestRecovery) {
      emitWorkspaceRuntimeEvent(callbacks, {
        type: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_TYPE,
        source: 'workspace-runtime',
        status: 'self-healed',
        message: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_MESSAGE,
        detail: CURRENT_REFERENCE_DIGEST_RECOVERY_EVENT_DETAIL,
      });
      const recoveryRefs = backendPayloadRefs(
        stableAgentServerPayloadTaskId('digest-recovery', request, skill, sha1(request.prompt).slice(0, 8)),
        `agentserver://${CURRENT_REFERENCE_DIGEST_RECOVERY_REF_PATH}`,
      );
      await writeBackendPayloadLogs(workspace, recoveryRefs, CURRENT_REFERENCE_DIGEST_RECOVERY_LOG_LINE);
      const normalizedRecovery = await validateAndNormalizePayload(digestRecovery, request, skill, {
        ...recoveryRefs,
        runtimeFingerprint: { runtime: CURRENT_REFERENCE_DIGEST_RECOVERY_RUNTIME_LABEL, error: generation.error },
      });
      return await materializeBackendPayloadOutput(workspace, request, normalizedRecovery, recoveryRefs);
    }
    const failureReason = agentServerGenerationFailureReason(generation.error, generation.diagnostics);
    const failedRequestId = `agentserver-generation-${request.skillDomain}-${sha1(`${request.prompt}:${generation.error}`).slice(0, 12)}`;
    await appendGeneratedTaskGenerationFailureLifecycle({
      workspacePath: workspace,
      request,
      skill,
      failedRequestId,
      failureReason,
      diagnostics: generation.diagnostics,
      attemptPlanRefs,
    });
    return repairNeededPayload(request, skill, failureReason, agentServerFailurePayloadRefs(generation.diagnostics));
  }
  if ('directPayload' in generation) {
    return await completeAgentServerDirectPayloadLifecycle({
      workspace,
      request,
      skill,
      generation,
      deps,
      kind: 'initial',
      stableTaskKind: 'direct',
      logLine: `AgentServer direct ToolPayload run: ${generation.runId || 'unknown'}\n`,
      source: 'agentserver-direct-payload',
      callbacks,
    });
  }

  const generationLifecycle = await resolveGeneratedTaskGenerationRetryLifecycle({
    baseUrl,
    request,
    skill,
    skills,
    workspace,
    callbacks,
    generation,
    deps,
  });
  if (generationLifecycle.kind === 'payload') return generationLifecycle.payload;
  generation = generationLifecycle.generation;

  const executionLifecycle = await runGeneratedTaskExecutionLifecycle({
    workspace,
    request,
    skill,
    generation,
    callbacks,
    deps,
  });
  if (executionLifecycle.kind === 'payload') return executionLifecycle.payload;
  const { run, supplementArtifactTypes, taskId, taskRel, inputRel, outputRel, stdoutRel, stderrRel } = executionLifecycle.execution;

  return await completeGeneratedTaskRunOutputLifecycle({
    workspace,
    request,
    skill,
    skills,
    callbacks,
    deps,
    options,
    taskId,
    generation,
    run,
    taskRel,
    inputRel,
    outputRel,
    stdoutRel,
    stderrRel,
    supplementArtifactTypes,
    runGeneratedTask: runAgentServerGeneratedTask,
  });
}

async function currentReferenceDigestRecoveryPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  workspace: string,
  failureReason: string,
): Promise<ToolPayload | undefined> {
  if (!currentReferenceDigestFailureCanRecover(failureReason)) return undefined;
  const candidates = currentReferenceDigestRecoveryCandidates(request.uiState?.currentReferenceDigests);
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
      const abs = resolve(workspace, safeWorkspaceRel(digest.digestRef));
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
  return buildCurrentReferenceDigestRecoveryPayload({
    prompt: request.prompt,
    skillDomain: request.skillDomain,
    skillId: skill.id,
    failureReason,
    sources,
    uiManifest: reportRuntimeResultViewSlots(
      CURRENT_REFERENCE_DIGEST_RECOVERY_REPORT_ARTIFACT_ID,
      `${request.skillDomain}-runtime-result`,
    ),
    shortHash: (value) => sha1(value).slice(0, 8),
  }) as ToolPayload;
}
