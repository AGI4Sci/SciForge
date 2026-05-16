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
  emitGenerationRetryEvent(
    input.callbacks,
    `Provider-first preflight blocked direct provider bypass; using deterministic provider-first recovery adapter. ${reason}`,
    'provider-first-payload-preflight',
  );
  return {
    kind: 'task-files',
    generation: {
      ok: true,
      runId: generation.runId,
      response: providerFirstRecoveryAdapterGeneration(input.request, reason, reason),
    },
  };
}

function providerFirstRecoveryAdapterGeneration(
  request: GatewayRequest,
  initialReason: string,
  retryReason: string,
): AgentServerGenerationResponse {
  const taskPath = `.sciforge/generated-tasks/provider-first-recovery-${sha1(`${request.prompt}:${initialReason}:${retryReason}`).slice(0, 12)}.py`;
  return {
    taskFiles: [{
      path: taskPath,
      language: 'python',
      content: providerFirstRecoveryAdapterSource(initialReason, retryReason),
    }],
    entrypoint: { language: 'python', path: taskPath },
    environmentRequirements: {},
    validationCommand: '',
    expectedArtifacts: request.expectedArtifactTypes ?? [],
    patchSummary: 'Recovered AgentServer provider-first contract violation with a deterministic SciForge provider-route adapter.',
  };
}

function providerFirstRecoveryAdapterSource(initialReason: string, retryReason: string) {
  return [
    'import json',
    'import re',
    'import sys',
    'from typing import Any',
    '',
    'from sciforge_task import load_input, write_payload, invoke_capability, provider_result_is_empty, empty_result_payload, ProviderInvocationError',
    '',
    `INITIAL_PREFLIGHT_REASON = ${JSON.stringify(initialReason)}`,
    `RETRY_PREFLIGHT_REASON = ${JSON.stringify(retryReason)}`,
    '',
    'def _text(value: Any) -> str:',
    '    if value is None:',
    '        return ""',
    '    if isinstance(value, str):',
    '        return value.strip()',
    '    if isinstance(value, (int, float, bool)):',
    '        return str(value)',
    '    return ""',
    '',
    'def _first(record: dict[str, Any], keys: list[str]) -> str:',
    '    for key in keys:',
    '        value = _text(record.get(key))',
    '        if value:',
    '            return value',
    '    return ""',
    '',
    'def _flatten_records(value: Any, limit: int = 12) -> list[dict[str, Any]]:',
    '    records: list[dict[str, Any]] = []',
    '    def visit(node: Any) -> None:',
    '        if len(records) >= limit:',
    '            return',
    '        if isinstance(node, dict):',
    '            if any(key in node for key in ("title", "name", "citation", "doi", "url", "abstract", "snippet", "summary")):',
    '                records.append(node)',
    '            for child_key in ("results", "items", "papers", "records", "data", "documents", "hits"):',
    '                child = node.get(child_key)',
    '                if isinstance(child, (list, dict)):',
    '                    visit(child)',
    '        elif isinstance(node, list):',
    '            for item in node:',
    '                visit(item)',
    '    visit(value)',
    '    return records[:limit]',
    '',
    'def _citation(record: dict[str, Any]) -> str:',
    '    authors = record.get("authors")',
    '    if isinstance(authors, list):',
    '        author_text = ", ".join(_text(author) for author in authors[:3] if _text(author))',
    '    else:',
    '        author_text = _text(authors)',
    '    year = _first(record, ["year", "publicationYear", "date", "published"])',
    '    title = _first(record, ["title", "name"])',
    '    doi = _first(record, ["doi", "DOI"])',
    '    url = _first(record, ["url", "link", "sourceUrl"])',
    '    parts = [part for part in [author_text, year, title, doi or url] if part]',
    '    return ". ".join(parts) if parts else "provider result; citation metadata incomplete"',
    '',
    'def _matrix_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:',
    '    rows: list[dict[str, Any]] = []',
    '    for index, record in enumerate(records[:8], start=1):',
    '        title = _first(record, ["title", "name"]) or f"Provider evidence item {index}"',
    '        abstract = _first(record, ["abstract", "snippet", "summary", "description"])',
    '        method = _first(record, ["method", "studyType", "venue", "journal"]) or "reported literature evidence; method not normalized by provider"',
    '        model = _first(record, ["model", "system", "organism", "disease", "population"]) or "system/model not normalized by provider metadata"',
    '        rows.append({',
    '            "claim": f"{title}: candidate evidence relevant to the requested research question",',
    '            "model/system": model,',
    '            "method": method,',
    '            "main result": abstract[:600] if abstract else "Provider result lacks abstract/snippet; inspect citation before treating as supporting evidence.",',
    '            "limitations": "Metadata-only provider result; full text and experimental design require follow-up verification.",',
    '            "confidence": 0.62 if abstract else 0.45,',
    '            "citation/ref": _citation(record),',
    '        })',
    '    return rows',
    '',
    'def _markdown_table(rows: list[dict[str, Any]]) -> str:',
    '    headers = ["claim", "model/system", "method", "main result", "limitations", "confidence", "citation/ref"]',
    '    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]',
    '    for row in rows:',
    '        cells = []',
    '        for header in headers:',
    '            value = str(row.get(header, "")).replace("\\n", " ").replace("|", "/")',
    '            cells.append(value[:900])',
    '        lines.append("| " + " | ".join(cells) + " |")',
    '    return "\\n".join(lines)',
    '',
    'def _search_query(prompt: str) -> str:',
    '    raw = _text(prompt)',
    '    arxiv_ids = re.findall(r"\\b\\d{4}\\.\\d{4,5}(?:v\\d+)?\\b", raw, flags=re.I)',
    '    if arxiv_ids:',
    '        return ("arXiv " + " ".join(arxiv_ids[:4]))[:180]',
    '    lines = [line.strip() for line in raw.splitlines() if line.strip()]',
    '    instruction_markers = ("requirement", "requirements", "hard requirement", "output", "artifact", "verification", "download", "full text", "pdf", "最终", "硬性要求", "要求", "输出", "验证", "全文", "下载", "报告")',
    '    topic_lines = [line for line in lines if not any(marker in line.lower() for marker in instruction_markers)]',
    '    text = " ".join(topic_lines or lines or [raw]).strip()',
    '    text = re.sub(r"\\b(?:do\\s+not|don\\\'t|never|avoid)\\s+use\\s+[^.;。！？!?]+", " ", text, flags=re.I)',
    '    lower = text.lower()',
    '    markers = ["real research question:", "research question:", "question:", "问题：", "问题:"]',
    '    for marker in markers:',
    '        index = lower.find(marker.lower())',
    '        if index >= 0:',
    '            candidate = text[index + len(marker):]',
    '            for stop in [".", ";", "。", "！", "?", "？"]:',
    '                if stop in candidate:',
    '                    candidate = candidate.split(stop, 1)[0]',
    '            candidate = candidate.strip()',
    '            if candidate:',
    '                return candidate[:180]',
    '    ascii_terms = re.findall(r"[A-Za-z][A-Za-z0-9_+-]*(?:\\s+[A-Za-z][A-Za-z0-9_+-]*){0,4}", text)',
    '    stop_terms = {"today", "recent", "latest", "papers", "paper", "related", "new", "use", "provider", "search", "source", "query", "title", "authors", "date", "link", "links", "pdf", "full", "text", "artifact", "report", "evidence", "matrix", "metadata", "crossref"}',
    '    normalized_terms = []',
    '    for term in ascii_terms:',
    '        compact = " ".join(term.split())',
    '        if compact.lower() not in stop_terms and compact not in normalized_terms:',
    '            normalized_terms.append(compact)',
    '    if normalized_terms:',
    '        prefix = "arXiv " if "arxiv" in lower else ""',
    '        return (prefix + " ".join(normalized_terms[:8]))[:180]',
    '    return text[:180]',
    '',
    'def _failed_payload(reason: str) -> dict[str, Any]:',
    '    return {',
    '        "message": reason,',
    '        "confidence": 0.0,',
    '        "claimType": "runtime-diagnostic",',
    '        "evidenceLevel": "runtime",',
    '        "reasoningTrace": reason,',
    '        "claims": [],',
    '        "uiManifest": [],',
    '        "executionUnits": [{"id": "provider-first-recovery", "status": "failed-with-reason", "tool": "invoke_capability", "failureReason": reason}],',
    '        "artifacts": [],',
    '        "recoverActions": ["Check provider route health and retry the same request with preserved refs."],',
    '        "nextStep": "Retry through a ready SciForge provider route; do not use direct external network clients.",',
    '    }',
    '',
    'def main() -> None:',
    '    _, input_path, output_path = sys.argv',
    '    task_input = load_input(input_path)',
    '    policy = task_input.get("capabilityFirstPolicy", {}) if isinstance(task_input, dict) else {}',
    '    ready_ids = policy.get("readyCapabilityIds") or []',
    '    if not isinstance(ready_ids, list):',
    '        ready_ids = []',
    '    prompt_text = str(task_input.get("prompt", ""))',
    '    needs_browser = bool(re.search(r"(browser|chromium|rendered|javascript|\\bjs\\b|网页|浏览器|渲染|动态页面|pdf|full[-\\s]?text|全文)", prompt_text, re.I))',
    '    if needs_browser and "browser_search" in ready_ids:',
    '        capability_id = "browser_search"',
    '    elif "web_search" in ready_ids:',
    '        capability_id = "web_search"',
    '    elif "browser_search" in ready_ids:',
    '        capability_id = "browser_search"',
    '    else:',
    '        capability_id = ready_ids[0] if ready_ids else "web_search"',
    '    provider_input = {"query": _search_query(task_input.get("prompt", "")), "limit": 8}',
    '    try:',
    '        provider_result = invoke_capability(task_input, capability_id, provider_input, timeout_seconds=30)',
    '    except ProviderInvocationError as error:',
    '        write_payload(output_path, _failed_payload(str(error)))',
    '        return',
    '    if provider_result_is_empty(provider_result):',
    '        write_payload(output_path, empty_result_payload(capability_id, "Ready provider route returned zero results; broaden or refine the query and retry."))',
    '        return',
    '    records = _flatten_records(provider_result, 16)',
    '    rows = _matrix_rows(records)',
    '    if not rows:',
    '        write_payload(output_path, _failed_payload("Ready provider returned data, but no citation-like records could be normalized into an evidence matrix."))',
    '        return',
    '    matrix_markdown = _markdown_table(rows)',
    '    failure_reason = "Provider-first recovery could only produce candidate provider metadata. Full-text/PDF retrieval, citation verification, and task-specific evidence grounding were not completed, so this cannot satisfy the user request."',
    '    report = "# Provider Metadata Diagnostic\\n\\n" + matrix_markdown + "\\n\\n## Recovery Notes\\n\\n" + failure_reason + "\\n\\nGenerated by SciForge provider-first recovery adapter after AgentServer task code twice bypassed ready provider routes. Treat this as diagnostic input for repair, not as a completed research report."',
    '    claims = [{"statement": failure_reason, "confidence": 0.0, "evidenceRefs": [f"runtime://capability-provider-route/{capability_id}"]}]',
    '    message = f"Recovered through the SciForge {capability_id} provider route and found {len(rows[:8])} candidate metadata records, but the task remains failed-with-reason because provider metadata is not full-text verified evidence."',
    '    payload = {',
    '        "message": message,',
    '        "confidence": 0.0,',
    '        "claimType": "failed-with-reason",',
    '        "evidenceLevel": "provider-metadata-diagnostic",',
    '        "reasoningTrace": "Used invoke_capability provider route after provider-first preflight recovery. " + INITIAL_PREFLIGHT_REASON,',
    '        "claims": claims,',
    '        "uiManifest": [',
    '            {"componentId": "evidence-matrix", "artifactRef": "artifact:evidence-matrix-provider-recovery", "title": "Evidence matrix", "priority": 1},',
    '            {"componentId": "report-viewer", "artifactRef": "artifact:research-report-provider-recovery", "title": "Research report", "priority": 2},',
    '            {"componentId": "notebook-timeline", "artifactRef": "artifact:notebook-timeline-provider-recovery", "title": "Research timeline", "priority": 3},',
    '        ],',
    '        "executionUnits": [{"id": "provider-first-recovery", "status": "failed-with-reason", "tool": "invoke_capability", "summary": f"Called {capability_id} via SciForge provider route.", "failureReason": failure_reason, "recoverActions": ["Retry with a backend task that uses web_search/web_fetch/browser_search/browser_fetch/pdf_extract/read_ref provider routes end-to-end.", "If full-text access is unavailable, return an explicit unavailable/empty-result payload instead of a satisfied report."]}],',
    '        "artifacts": [',
    '            {"id": "evidence-matrix-provider-recovery", "type": "evidence-matrix", "data": {"rows": rows, "providerResultSummary": str(provider_result)[:4000]}},',
    '            {"id": "research-report-provider-recovery", "type": "research-report", "data": report},',
    '            {"id": "paper-list-provider-recovery", "type": "paper-list", "data": records[:8]},',
    '            {"id": "notebook-timeline-provider-recovery", "type": "notebook-timeline", "data": {"events": [{"kind": "provider-search", "title": "Provider search", "summary": f"Called {capability_id} through SciForge provider route.", "artifactRef": "artifact:evidence-matrix-provider-recovery"}, {"kind": "evidence-matrix", "title": "Evidence matrix produced", "summary": f"Normalized {len(rows[:8])} provider result records into an evidence matrix.", "artifactRef": "artifact:evidence-matrix-provider-recovery"}]}},',
    '            {"id": "runtime-context-summary-provider-recovery", "type": "runtime-context-summary", "data": {"capabilityId": capability_id, "initialPreflightReason": INITIAL_PREFLIGHT_REASON, "retryPreflightReason": RETRY_PREFLIGHT_REASON}},',
    '        ],',
    '        "recoverActions": ["Regenerate the task through ready provider routes and require durable full-text/citation evidence refs before marking it satisfied.", "Preserve this provider metadata as diagnostic search evidence only."],',
    '        "nextStep": "Run a bounded repair that fetches/reads full text or returns an honest unavailable/empty-result result.",',
    '        "objectReferences": [{"kind": "artifact", "ref": "artifact:evidence-matrix-provider-recovery"}],',
    '    }',
    '    write_payload(output_path, payload)',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n');
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
