import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AgentServerGenerationResponse, GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { errorMessage, isRecord, safeWorkspaceRel } from '../gateway-utils.js';
import { ensureSessionBundle, sessionBundleRelForRequest, sessionBundleResourceRel } from '../session-bundle.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { fileExists, sha1 } from '../workspace-task-runner.js';
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
  workspaceTaskPythonCommandCandidates,
} from '../../../packages/skills/runtime-policy';
import {
  generatedTaskLiteratureDeliverablesExpected,
  generatedTaskRecoveryTaskPath,
  literatureGenerationFailureRecoveryMessage,
  literatureNoResultScope,
  literatureProviderMetadataMissingFullTextStatus,
  literatureRecoverySearchQuery,
} from '@sciforge-ui/runtime-contract/generated-work-policy';
import {
  evaluateGeneratedTaskPayloadPreflight,
  generatedTaskPayloadPreflightFailureReason,
  isGeneratedTaskCapabilityFirstPolicyIssue,
} from './generated-task-payload-preflight.js';
import { attachAgentServerCompletionCandidateArtifacts } from './agentserver-completion-candidate.js';
import { invokeWebTool } from '../../../packages/workers/web-worker/src/worker';

export const AGENTSERVER_DIRECT_PAYLOAD_TASK_REF = 'agentserver://direct-payload' as const;
const AGENTSERVER_GENERATION_FAILURE_TASK_REF = 'agentserver://generation-failure' as const;
const AGENTSERVER_GENERATION_RETRY_REPAIR_TASK_REF = 'agentserver://generation-retry-repair' as const;

const execFileAsync = promisify(execFile);

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
  const salvagedPayload = attachAgentServerCompletionCandidateArtifacts({
    payload: repairPayload,
    workspace: input.workspace,
    workEvidence: input.generation.diagnostics?.sideEffectWorkEvidence,
    failureKind: input.generation.diagnostics?.kind,
  });
  const hasAgentServerSideEffectWork = Array.isArray(input.generation.diagnostics?.sideEffectWorkEvidence)
    && input.generation.diagnostics.sideEffectWorkEvidence.some((entry: unknown) => (
      isRecord(entry) && entry.kind === 'write' && entry.status === 'success'
    ));
  const shouldPreferLiteratureRecovery = !hasAgentServerSideEffectWork
    || /malformed|incomplete|AgentServerGenerationResponse|taskFiles/i.test(failureReason);
  const literatureRecovery = shouldPreferLiteratureRecovery
    ? await literatureGenerationFailureRecoveryPayload(input.request, failureReason)
    : undefined;
  if (literatureRecovery) {
    const payload = attachGeneratedTaskFailureBudgetDebit({
      ...budgetDebitInput,
      payload: literatureRecovery,
    });
    return await materializeAgentServerGenerationLifecyclePayload({
      workspace: input.workspace,
      request: input.request,
      skill: input.skill,
      payload,
      reason: failureReason,
      kind: 'generation-failure-recovery',
      taskRel: AGENTSERVER_GENERATION_FAILURE_TASK_REF,
    });
  }
  const payload = attachGeneratedTaskFailureBudgetDebit({
    ...budgetDebitInput,
    payload: salvagedPayload,
  });
  return await materializeAgentServerGenerationLifecyclePayload({
    workspace: input.workspace,
    request: input.request,
    skill: input.skill,
    payload,
    reason: failureReason,
    kind: 'generation-failure-repair',
    taskRel: AGENTSERVER_GENERATION_FAILURE_TASK_REF,
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

  const syntaxResult = await retryGeneratedTaskSyntaxPreflightContract(input, generation);
  if (syntaxResult.kind === 'payload') return syntaxResult;
  generation = syntaxResult.generation;

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
  const directLiteratureRecoveryReason = literatureDirectPayloadRecoveryReason(input.request, normalized);
  if (directLiteratureRecoveryReason) {
    const recoveryPayload = await literatureGenerationFailureRecoveryPayload(input.request, directLiteratureRecoveryReason);
    if (recoveryPayload) {
      const normalizedRecovery = await input.deps.validateAndNormalizePayload(recoveryPayload, input.request, input.skill, {
        ...refs,
        runtimeFingerprint: {
          runtime: 'AgentServer direct ToolPayload provider recovery',
          runId: input.generation.runId,
        },
      });
      normalized = await materializeBackendPayloadOutput(input.workspace, input.request, normalizedRecovery, refs);
    }
  }
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

async function literatureGenerationFailureRecoveryPayload(
  request: GatewayRequest,
  failureReason: string,
): Promise<ToolPayload | undefined> {
  if (!shouldUseLiteratureMetadataRecoveryAdapter(request)) return undefined;
  const query = literatureRecoverySearchQuery(request.prompt);
  const search = await invokeWebTool({
    toolId: 'web_search',
    input: { query, limit: 8 },
    requestId: `literature-generation-failure-search-${sha1(query).slice(0, 10)}`,
    metadata: { source: 'agentserver-generation-failure-recovery' },
  });
  if (!search.ok || !isRecord(search.output)) {
    return literatureNoResultRecoveryPayload(
      request,
      query,
      failureReason,
      search.ok ? 'web_search returned non-object output' : search.error.message,
    );
  }
  const records = flattenLiteratureRecords(search.output, 12);
  if (!records.length) {
    return literatureNoResultRecoveryPayload(request, query, failureReason, 'web_search returned zero normalized literature records');
  }
  const provider = stringValue(search.output.provider);
  const providerQuery = stringValue(search.output.providerQuery) || query;
  const dateFallback = isRecord(search.output.dateFallback) ? search.output.dateFallback : undefined;
  const requestedDateRange = isRecord(dateFallback?.requestedDateRange) ? dateFallback.requestedDateRange : undefined;
  const dateFallbackReason = stringValue(dateFallback?.reason);
  const requestedFromDate = stringValue(dateFallback?.fromDate) || stringValue(requestedDateRange?.fromDate);
  const requestedToDate = stringValue(dateFallback?.toDate) || stringValue(requestedDateRange?.toDate);
  const dateFallbackNote = dateFallbackReason
    ? `日期窗口说明：${dateFallbackReason}；原始日期范围 ${requestedFromDate || '?'} 至 ${requestedToDate || '?'}，因此下表是放宽日期后的最新匹配，不应表述为“当天提交论文”。`
    : '';
  const rows = normalizeLiteratureRows(records);
  let fetchedCount = 0;
  let pdfExtractedCount = 0;
  for (const row of rows.slice(0, 3)) {
    const url = typeof row.url === 'string' ? row.url : '';
    if (!url) continue;
    const fetch = await invokeWebTool({
      toolId: 'web_fetch',
      input: { url, maxChars: 8000 },
      requestId: `literature-generation-failure-fetch-${sha1(url).slice(0, 10)}`,
      metadata: { source: 'agentserver-generation-failure-recovery' },
    });
    if (!fetch.ok || !isRecord(fetch.output)) {
      row.fetchStatus = fetch.ok ? 'web_fetch returned non-object output' : `web_fetch failed: ${fetch.error.message}`;
      row.fullTextStatus = 'Full-text/PDF unavailable in this run because provider fetch failed; source URL retained for retry.';
      continue;
    }
    fetchedCount += 1;
    const finalUrl = stringValue(fetch.output.finalUrl) || stringValue(fetch.output.url) || url;
    const text = stringValue(fetch.output.text);
    row.evidenceLocation = finalUrl;
    row.fetchStatus = `Fetched via web_fetch; ok=${String(fetch.output.ok)}; status=${String(fetch.output.status ?? '')}`;
    if (text) row.evidenceSnippet = text.slice(0, 900);
    const pdfUrl = pdfUrlFromFetchOutput(fetch.output, finalUrl, row);
    if (!pdfUrl) {
      row.fullTextStatus = text
        ? 'Source page text fetched via web_fetch; no PDF link confirmed in fetched page.'
        : 'web_fetch completed, but no page text or PDF link was returned.';
      continue;
    }
    row.pdfUrl = pdfUrl;
    const pdf = await invokeWebTool({
      toolId: 'pdf_extract',
      input: { url: pdfUrl, maxChars: 14000, maxPages: 8, timeoutMs: 30000 },
      requestId: `literature-generation-failure-pdf-${sha1(pdfUrl).slice(0, 10)}`,
      metadata: { source: 'agentserver-generation-failure-recovery' },
    });
    if (!pdf.ok || !isRecord(pdf.output)) {
      row.fullTextStatus = `PDF/full-text candidate URL found (${pdfUrl}), but extraction failed: ${pdf.ok ? 'pdf_extract returned non-object output' : pdf.error.message}`;
      row.evidenceLocation = pdfUrl;
      continue;
    }
    const extraction = isRecord(pdf.output.pdfExtraction) ? pdf.output.pdfExtraction : {};
    const extractionStatus = stringValue(extraction.status);
    const pdfText = stringValue(pdf.output.text);
    row.evidenceLocation = firstEvidenceLocation(extraction.evidenceLocations, `${pdfUrl}#page=1`);
    row.pdfExtractionStatus = extractionStatus || 'unknown';
    if (pdfText) {
      pdfExtractedCount += 1;
      row.evidenceSnippet = pdfText.slice(0, 1200);
      row.fullTextStatus = `PDF extracted via pdf_extract (${stringValue(extraction.extractor) || 'pdftotext'}), page range ${stringValue(extraction.pageRange) || 'bounded'}, chars=${String(extraction.charsExtracted ?? pdfText.length)}; source ${pdfUrl}`;
      row.limitations = 'PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations.';
    } else {
      row.fullTextStatus = `PDF URL confirmed (${pdfUrl}), but bounded extraction did not return readable text: ${stringValue(extraction.reason) || extractionStatus || 'unknown reason'}`;
    }
  }
  const matrixRows = rows.map((row) => ({
    claim: row.title,
    'main result': row.summary,
    fullTextStatus: row.fullTextStatus,
    evidenceLocation: row.evidenceLocation,
    evidenceSnippet: row.evidenceSnippet ?? '',
    limitations: row.limitations,
    'citation/ref': row.url || row.doi || row.title,
  }));
  const report = [
    '# 中文文献调研报告（AgentServer generation failure recovery）',
    '',
    `检索 query：${query}`,
    `检索 provider：${provider || 'web_search'}；provider query：${providerQuery}`,
    dateFallbackNote,
    `候选论文数：${rows.length}；已抓取来源页面：${fetchedCount}；已抽取 PDF 全文片段：${pdfExtractedCount}。`,
    '',
    '## 候选论文与全文/PDF状态',
    '',
    markdownLiteratureTable(rows),
    '',
    '## 关键结论',
    '',
    ...(dateFallbackNote ? [`- ${dateFallbackNote}`] : []),
    '- 已生成 latest paper list、evidence matrix、中文 research report artifact，并保留 source/evidence location。',
    '- 对前几条候选记录尝试了 web_fetch，并在确认 PDF URL 后调用 pdf_extract 做 bounded PDF 正文抽取；无法抽取时保留不可得原因。',
    '- 该 fallback 避免 AgentServer convergence guard 后只返回 runtime diagnostic，支持 selected report follow-up 继续点选 artifact 追问。',
    '',
    '## 局限性',
    '',
    '- 这是 AgentServer generation failure 后的 bounded provider recovery，不等同完整系统综述。',
    ...(dateFallbackNote ? ['- 用户要求的当天窗口没有被满足；当前候选只能作为“最近匹配”继续阅读清单。'] : []),
    '- 搜索 provider 的排序和摘要可能遗漏最新论文，全文可得性受站点访问、PDF 可解析性和 bounded page/char budget 影响。',
    '',
    '## Recovery note',
    '',
    failureReason,
  ].join('\n');
  return {
    message: literatureGenerationFailureRecoveryMessage({
      rowCount: rows.length,
      fetchedCount,
      pdfExtractedCount,
    }),
    confidence: pdfExtractedCount > 0 ? 0.74 : 0.68,
    claimType: 'literature-survey',
    evidenceLevel: 'provider-grounded-recovery',
    reasoningTrace: failureReason,
    claims: [{
      statement: `Provider fallback returned ${rows.length} candidate literature records for the requested research question.`,
      confidence: pdfExtractedCount > 0 ? 0.74 : 0.68,
      evidenceRefs: ['runtime://web-worker/web_search', 'runtime://web-worker/web_fetch', 'runtime://web-worker/pdf_extract'],
    }],
    uiManifest: [
      { componentId: 'paper-card-list', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', artifactRef: 'evidence-matrix', priority: 2 },
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 3 },
      { componentId: 'notebook-timeline', artifactRef: 'notebook-timeline', priority: 4 },
    ],
    executionUnits: [{
      id: 'literature-generation-failure-provider-recovery',
      status: 'done',
      tool: 'sciforge.web-worker.web_search+web_fetch+pdf_extract',
      summary: `Called web_search, fetched ${fetchedCount} source pages, and extracted ${pdfExtractedCount} PDFs after AgentServer generation failed.`,
      failureReason,
      recoverActions: pdfExtractedCount > 0
        ? ['Audit extracted PDF snippets against exact page/section claims before making stronger citation-level conclusions.']
        : ['Run a full PDF extraction pass before making stronger citation-level claims.'],
    }],
    artifacts: [
      { id: 'paper-list', type: 'paper-list', data: rows },
      { id: 'evidence-matrix', type: 'evidence-matrix', data: { rows: matrixRows } },
      { id: 'research-report', type: 'research-report', data: { markdown: report } },
      {
        id: 'notebook-timeline',
        type: 'notebook-timeline',
        data: {
          events: [
            { kind: 'provider-search', title: 'Provider search', summary: `web_search returned ${rows.length} candidate literature records.`, artifactRef: 'artifact:paper-list' },
            { kind: 'provider-fetch', title: 'Source fetch', summary: `web_fetch retrieved ${fetchedCount} source pages for full-text/PDF availability notes.`, artifactRef: 'artifact:evidence-matrix' },
            { kind: 'provider-fetch', title: 'PDF extraction', summary: `pdf_extract retrieved bounded text from ${pdfExtractedCount} PDFs.`, artifactRef: 'artifact:evidence-matrix' },
            { kind: 'report', title: 'Chinese report generated', summary: 'Research-report artifact assembled with conclusions, limitations, and follow-up support.', artifactRef: 'artifact:research-report' },
          ],
        },
      },
    ],
    displayIntent: { status: 'completed', taskOutcome: 'satisfied', primaryView: 'answer' },
    objectReferences: [
      { kind: 'artifact', ref: 'artifact:research-report' },
      { kind: 'artifact', ref: 'artifact:paper-list' },
      { kind: 'artifact', ref: 'artifact:evidence-matrix' },
      { kind: 'artifact', ref: 'artifact:notebook-timeline' },
    ],
  };
}

function literatureNoResultRecoveryPayload(
  request: GatewayRequest,
  query: string,
  failureReason: string,
  unavailableReason: string,
): ToolPayload {
  const scope = literatureNoResultScope(query || request.prompt);
  const report = [
    '# 中文文献调研报告（无可确认结果）',
    '',
    `检索 query：${query}`,
    '',
    '## 最新论文列表',
    '',
    '- 本轮 provider fallback 未返回可规范化的论文记录，因此没有把任何候选论文标记为“已确认最新”。',
    '',
    '## 全文/PDF 或不可得说明',
    '',
    `- 不可得原因：${unavailableReason}`,
    '- 未生成 PDF/full-text 已读取声明；后续需要在 provider 恢复后重新运行相应检索 API 与 PDF 提取。',
    '',
    '## 证据位置',
    '',
    '- 证据位置仅限本次 provider 调用诊断；没有可引用论文页面或 PDF 页码。',
    '',
    '## 关键结论',
    '',
    '- SciForge 没有把 AgentServer malformed generation 当作成功结果。',
    '- SciForge 已尝试通用文献 provider fallback；由于没有可规范化论文记录，本轮只能给出无结果/不可得结论。',
    '',
    '## 局限性',
    '',
    '- 无结果不等于领域内不存在相关论文；它只说明本轮可用 provider 没有返回可确认记录。',
    '- 没有完成 PDF extraction/citation-grade verification。',
    '',
    '## 下一步阅读建议',
    '',
    '- 放宽日期窗到最近 7-30 天。',
    `- 用${scope.sourceLabel}主题词 \`${scope.topicLabel}\` 重新检索，并记录 provider 状态与原始结果。`,
    '- 对返回的论文页面或 PDF 链接逐篇做全文/PDF 提取。',
    '',
    '## Recovery note',
    '',
    failureReason,
  ].join('\n');
  return {
    message: `未能确认${scope.conditionLabel} “${scope.topicLabel}” 的可规范化论文记录；已生成中文报告 artifact，说明最新论文列表为空、PDF/全文不可得原因、证据位置限制、关键结论、局限性和下一步建议。`,
    confidence: 0.45,
    claimType: 'literature-survey',
    evidenceLevel: 'provider-grounded-empty-result',
    reasoningTrace: `${failureReason}\nProvider fallback unavailable: ${unavailableReason}`,
    claims: [{
      statement: 'Provider fallback returned no normalized literature records for the requested query.',
      confidence: 0.45,
      evidenceRefs: ['runtime://web-worker/web_search'],
    }],
    uiManifest: [
      { componentId: 'paper-card-list', artifactRef: 'paper-list', priority: 1 },
      { componentId: 'evidence-matrix', artifactRef: 'evidence-matrix', priority: 2 },
      { componentId: 'report-viewer', artifactRef: 'research-report', priority: 3 },
      { componentId: 'notebook-timeline', artifactRef: 'notebook-timeline', priority: 4 },
    ],
    executionUnits: [{
      id: 'literature-generation-failure-provider-empty-result',
      status: 'done',
      tool: 'sciforge.web-worker.web_search',
      summary: `Called web_search after AgentServer generation failed; no normalized literature records were returned for query: ${query}.`,
      recoverActions: ['Retry with a wider date window or alternate topic terms, then run PDF extraction.'],
    }],
    artifacts: [
      { id: 'paper-list', type: 'paper-list', data: [] },
      { id: 'evidence-matrix', type: 'evidence-matrix', data: { rows: [] } },
      { id: 'research-report', type: 'research-report', data: { markdown: report } },
      {
        id: 'notebook-timeline',
        type: 'notebook-timeline',
        data: {
          events: [
            { kind: 'provider-search', title: 'Provider search returned no normalized papers', summary: unavailableReason, artifactRef: 'artifact:research-report' },
            { kind: 'report', title: 'Chinese no-result report generated', summary: 'Report includes unavailable note, evidence-location limits, conclusions, limitations, and next steps.', artifactRef: 'artifact:research-report' },
          ],
        },
      },
    ],
    displayIntent: { status: 'completed', taskOutcome: 'satisfied', primaryView: 'answer' },
    objectReferences: [
      { kind: 'artifact', ref: 'artifact:research-report' },
      { kind: 'artifact', ref: 'artifact:paper-list' },
      { kind: 'artifact', ref: 'artifact:evidence-matrix' },
      { kind: 'artifact', ref: 'artifact:notebook-timeline' },
    ],
  };
}

function flattenLiteratureRecords(value: unknown, limit: number): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (records.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    if (['title', 'name', 'citation', 'doi', 'url', 'link', 'abstract', 'snippet', 'summary'].some((key) => key in node)) {
      records.push(node);
    }
    for (const key of ['results', 'items', 'papers', 'records', 'data', 'documents', 'hits']) {
      const child = node[key];
      if (Array.isArray(child) || isRecord(child)) visit(child);
    }
  };
  visit(value);
  return records.slice(0, limit);
}

function normalizeLiteratureRows(records: Record<string, unknown>[]) {
  return records.slice(0, 8).map((record, index) => {
    const title = firstString(record, ['title', 'name', 'citation']) || `Candidate paper ${index + 1}`;
    const url = firstString(record, ['url', 'link', 'sourceUrl', 'pdfUrl', 'fullTextUrl']);
    const pdfUrl = firstString(record, ['pdfUrl', 'pdf', 'fullTextUrl']) || inferPdfUrl(url);
    const summary = firstString(record, ['abstract', 'snippet', 'summary', 'description'])
      || 'Provider returned no abstract/snippet; inspect source before using as evidence.';
    return {
      id: `paper-${index + 1}`,
      title,
      authors: authorsText(record.authors),
      year: firstString(record, ['year', 'publicationYear', 'date', 'published']),
      venue: firstString(record, ['journal', 'venue', 'source', 'publisher']),
      doi: firstString(record, ['doi', 'DOI']),
      url,
      pdfUrl,
      summary: summary.slice(0, 700),
      fullTextStatus: pdfUrl
        ? `PDF/full-text candidate URL inferred from source: ${pdfUrl}`
        : literatureProviderMetadataMissingFullTextStatus(),
      evidenceLocation: url || 'Provider metadata had no source URL.',
      limitations: 'Provider-grounded recovery package; citation/full-text verification should be run before strong scientific claims.',
    } as Record<string, unknown>;
  });
}

function pdfUrlFromFetchOutput(fetchOutput: Record<string, unknown>, finalUrl: string, row: Record<string, unknown>) {
  const fromRow = stringValue(row.pdfUrl);
  if (fromRow) return fromRow;
  const links = Array.isArray(fetchOutput.links) ? fetchOutput.links.filter(isRecord) : [];
  for (const link of links) {
    const linkUrl = stringValue(link.url) || stringValue(link.href);
    const linkText = `${stringValue(link.text)} ${stringValue(link.title)} ${linkUrl}`.toLowerCase();
    if (linkUrl && (linkText.includes('pdf') || /\.pdf(?:$|[?#])/i.test(linkUrl) || /arxiv\.org\/pdf\//i.test(linkUrl))) return linkUrl;
  }
  return inferPdfUrl(finalUrl);
}

function firstEvidenceLocation(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    const first = value.map(stringValue).find(Boolean);
    if (first) return first;
  }
  const direct = stringValue(value);
  return direct || fallback;
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return '';
}

function authorsText(value: unknown) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).slice(0, 4).join(', ');
  return stringValue(value);
}

function inferPdfUrl(url: string) {
  if (!url) return '';
  const arxivMatch = url.match(/^https?:\/\/arxiv\.org\/abs\/([^?#]+)/i);
  if (arxivMatch) return `https://arxiv.org/pdf/${arxivMatch[1]}.pdf`;
  return /\.pdf(?:$|[?#])/i.test(url) ? url : '';
}

function markdownLiteratureTable(rows: Record<string, unknown>[]) {
  const headers = ['title', 'year', 'venue', 'url', 'fullTextStatus', 'evidenceLocation', 'summary', 'limitations'];
  const lines = [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => stringValue(row[header]).replace(/\n/g, ' ').replace(/\|/g, '/').slice(0, 900)).join(' | ')} |`);
  }
  return lines.join('\n');
}

async function retryGeneratedTaskEntrypointContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const nonExecutableEntrypointReason = agentServerGeneratedEntrypointContractReason(generation.response, { normalizePath: safeWorkspaceRel })
    ?? await generatedTaskEntrypointContentMissingReason(input.workspace, generation.response);
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
  const retryReason = agentServerGeneratedEntrypointContractReason(retriedGeneration.response, { normalizePath: safeWorkspaceRel })
    ?? await generatedTaskEntrypointContentMissingReason(input.workspace, retriedGeneration.response);
  if (retryReason) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${nonExecutableEntrypointReason}. Strict retry still returned invalid entrypoint: ${retryReason}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function generatedTaskEntrypointContentMissingReason(workspace: string, response: AgentServerGenerationResponse) {
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const content = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel)?.content
    ?? await readGeneratedTaskFileIfPresent(workspace, entryRel);
  if (content !== undefined) return undefined;
  const declaredFiles = response.taskFiles.map((file) => safeWorkspaceRel(file.path)).filter(Boolean);
  return [
    `AgentServer entrypoint path is not materialized: ${entryRel}.`,
    'The entrypoint path must match one returned taskFiles item with inline content or an already-written readable workspace file.',
    declaredFiles.length ? `Returned taskFiles: ${declaredFiles.join(', ')}` : 'Returned taskFiles: none',
  ].join(' ');
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
    const recoveryReason = `AgentServer generation contract violation: ${taskInterfaceReason}. Strict retry still returned a static/non-interface task: ${retryInterfaceReason}`;
    const recoveryAdapterLabel = shouldUseLiteratureMetadataRecoveryAdapter(input.request)
      ? 'deterministic literature metadata provider adapter'
      : 'deterministic contract-failure adapter';
    emitGenerationRetryEvent(
      input.callbacks,
      `Strict retry still failed the generated task interface contract; using ${recoveryAdapterLabel}. ${retryInterfaceReason}`,
      'task-interface',
    );
    return {
      kind: 'task-files',
      generation: {
        ok: true,
        runId: retriedGeneration.runId,
        response: contractFailureAdapterGeneration(input.request, recoveryReason),
      },
    };
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskSyntaxPreflightContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const syntaxReason = await generatedTaskSyntaxPreflightReason(input.workspace, generation.response);
  if (!syntaxReason) return { kind: 'task-files', generation };
  emitGenerationRetryEvent(input.callbacks, syntaxReason, 'syntax-preflight');
  const retriedGeneration = await requestStrictGenerationRetry(input, syntaxReason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-syntax-preflight',
        logLine: `AgentServer syntax-preflight retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }
  const retrySyntaxReason = await generatedTaskSyntaxPreflightReason(input.workspace, retriedGeneration.response);
  if (retrySyntaxReason) {
    return repairNeeded(
      input,
      `AgentServer generation contract violation: ${syntaxReason}. Strict retry still returned code that failed syntax preflight: ${retrySyntaxReason}`,
    );
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

async function retryGeneratedTaskPayloadPreflightContract(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  generation: AgentServerTaskFilesGeneration,
): Promise<ResolveGeneratedTaskGenerationLifecycleResult> {
  const preflight = await generatedTaskPayloadPreflightForGeneration(input.workspace, generation.response, input.request);
  const blockingIssues = preflight.issues.filter((issue) => issue.severity === 'repair-needed');
  if (!blockingIssues.length) return { kind: 'task-files', generation };
  const reason = generatedTaskPayloadPreflightFailureReason(preflight);
  if (blockingIssues.some(isGeneratedTaskCapabilityFirstPolicyIssue)) {
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

  emitGenerationRetryEvent(input.callbacks, reason, 'payload-preflight');
  const retriedGeneration = await requestStrictGenerationRetry(input, reason);
  if (!retriedGeneration.ok) return repairNeeded(input, retriedGeneration.error);
  if ('directPayload' in retriedGeneration) {
    return {
      kind: 'payload',
      payload: await completeAgentServerDirectPayloadLifecycle({
        ...directPayloadCompletionInput(input, retriedGeneration),
        kind: 'strict-retry',
        stableTaskKind: 'direct-retry-payload-preflight',
        logLine: `AgentServer payload-preflight retry direct ToolPayload run: ${retriedGeneration.runId || 'unknown'}\n`,
        source: 'agentserver-direct-payload',
      }),
    };
  }

  const retryPreflight = await generatedTaskPayloadPreflightForGeneration(input.workspace, retriedGeneration.response, input.request);
  const retryBlockingIssues = retryPreflight.issues.filter((issue) => issue.severity === 'repair-needed');
  if (retryBlockingIssues.some(isGeneratedTaskCapabilityFirstPolicyIssue)) {
    const retryReason = generatedTaskPayloadPreflightFailureReason(retryPreflight);
    emitGenerationRetryEvent(
      input.callbacks,
      `Provider-first preflight blocked direct provider bypass after payload-preflight retry; using deterministic provider-first recovery adapter. ${retryReason}`,
      'provider-first-payload-preflight',
    );
    return {
      kind: 'task-files',
      generation: {
        ok: true,
        runId: retriedGeneration.runId,
        response: providerFirstRecoveryAdapterGeneration(input.request, reason, retryReason),
      },
    };
  }
  if (retryBlockingIssues.length) {
    const retryReason = generatedTaskPayloadPreflightFailureReason(retryPreflight);
    emitGenerationRetryEvent(
      input.callbacks,
      `Payload preflight strict retry surfaced another blocking contract issue; retrying once more. ${retryReason}`,
      'payload-preflight',
    );
    const secondRetryReason = `Previous payload-preflight strict retry still failed: ${retryReason}`;
    const secondGeneration = await requestStrictGenerationRetry(input, secondRetryReason);
    if (!secondGeneration.ok) return repairNeeded(input, secondGeneration.error);
    if ('directPayload' in secondGeneration) {
      return {
        kind: 'payload',
        payload: await completeAgentServerDirectPayloadLifecycle({
          ...directPayloadCompletionInput(input, secondGeneration),
          kind: 'strict-retry',
          stableTaskKind: 'direct-retry-payload-preflight-second',
          logLine: `AgentServer second payload-preflight retry direct ToolPayload run: ${secondGeneration.runId || 'unknown'}\n`,
          source: 'agentserver-direct-payload',
        }),
      };
    }
    const secondPreflight = await generatedTaskPayloadPreflightForGeneration(input.workspace, secondGeneration.response, input.request);
    const secondBlockingIssues = secondPreflight.issues.filter((issue) => issue.severity === 'repair-needed');
    if (secondBlockingIssues.some(isGeneratedTaskCapabilityFirstPolicyIssue)) {
      const secondReason = generatedTaskPayloadPreflightFailureReason(secondPreflight);
      emitGenerationRetryEvent(
        input.callbacks,
        `Provider-first preflight blocked direct provider bypass after payload-preflight retries; using deterministic provider-first recovery adapter. ${secondReason}`,
        'provider-first-payload-preflight',
      );
      return {
        kind: 'task-files',
        generation: {
          ok: true,
          runId: secondGeneration.runId,
          response: providerFirstRecoveryAdapterGeneration(input.request, reason, secondReason),
        },
      };
    }
    if (secondBlockingIssues.length) {
      return repairNeeded(
        input,
        `AgentServer generation contract violation: ${reason}. Second strict retry still failed payload preflight: ${generatedTaskPayloadPreflightFailureReason(secondPreflight)}`,
      );
    }
    return { kind: 'task-files', generation: secondGeneration };
  }
  return { kind: 'task-files', generation: retriedGeneration };
}

function providerFirstRecoveryAdapterGeneration(
  request: GatewayRequest,
  initialReason: string,
  retryReason: string,
): AgentServerGenerationResponse {
  const taskPath = generatedTaskRecoveryTaskPath(
    'provider-first',
    sha1(`${request.prompt}:${initialReason}:${retryReason}`).slice(0, 12),
  );
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

function contractFailureAdapterGeneration(
  request: GatewayRequest,
  reason: string,
): AgentServerGenerationResponse {
  if (shouldUseLiteratureMetadataRecoveryAdapter(request)) {
    const taskPath = generatedTaskRecoveryTaskPath(
      'literature-metadata',
      sha1(`${request.prompt}:${reason}`).slice(0, 12),
    );
    return {
      taskFiles: [{
        path: taskPath,
        language: 'python',
        content: literatureMetadataRecoveryAdapterSource(reason),
      }],
      entrypoint: { language: 'python', path: taskPath },
      environmentRequirements: {},
      validationCommand: '',
      expectedArtifacts: request.expectedArtifactTypes ?? ['paper-list', 'evidence-matrix', 'research-report', 'notebook-timeline'],
      patchSummary: 'Recovered invalid literature generated task interface with a deterministic provider-backed metadata report adapter.',
    };
  }
  const taskPath = generatedTaskRecoveryTaskPath(
    'contract-failure',
    sha1(`${request.prompt}:${reason}`).slice(0, 12),
  );
  return {
    taskFiles: [{
      path: taskPath,
      language: 'python',
      content: contractFailureAdapterSource(reason),
    }],
    entrypoint: { language: 'python', path: taskPath },
    environmentRequirements: {},
    validationCommand: '',
    expectedArtifacts: request.expectedArtifactTypes ?? [],
    patchSummary: 'Recovered invalid AgentServer generated task interface with a deterministic failed-with-reason ToolPayload adapter.',
  };
}

function shouldUseLiteratureMetadataRecoveryAdapter(request: GatewayRequest) {
  const text = `${request.skillDomain ?? ''} ${request.prompt ?? ''} ${(request.expectedArtifactTypes ?? []).join(' ')}`.toLowerCase();
  return /\bliterature\b|paper-list|research-report|evidence-matrix|full[-\s]?text|pdf|论文|文献|全文/.test(text);
}

export function literatureDirectPayloadRecoveryReason(request: GatewayRequest, payload: ToolPayload) {
  if (!shouldUseLiteratureMetadataRecoveryAdapter(request)) return undefined;
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const statusFields = [
    stringValue(displayIntent.status),
    stringValue(displayIntent.taskOutcome),
    stringValue(displayIntent.protocolStatus),
    stringValue(payload.evidenceLevel),
    stringValue(payload.claimType),
  ].join(' ');
  const text = [
    payload.message,
    payload.reasoningTrace,
    JSON.stringify(payload.claims ?? []),
    JSON.stringify(payload.artifacts ?? []),
    JSON.stringify(payload.objectReferences ?? []),
  ].map(stringValue).join('\n');
  const admitsMissingWork = /partial|needs[-\s]?work|unverified|budget exhausted|budget limit|cannot fetch|cannot retrieve|cannot generate|repair\/expand|full texts? unavailable|pdf\/full[-\s]?text notes unavailable|placeholder|example\.com|缺少|未完成|无法(?:抓取|生成|检索)|全文.*(?:不可用|未确认)/i.test(`${statusFields}\n${text}`);
  const hasExpectedDeliverables = generatedTaskLiteratureDeliverablesExpected({
    requestText: request.prompt,
    uiManifest: payload.uiManifest,
    artifacts: payload.artifacts,
  });
  if (!admitsMissingWork || !hasExpectedDeliverables) return undefined;
  return [
    'AgentServer direct ToolPayload was literature-shaped but explicitly incomplete.',
    `status/evidence fields: ${statusFields.trim() || 'none'}.`,
    'SciForge is running bounded provider recovery instead of presenting placeholder or budget-limit output as the final deliverable.',
  ].join(' ');
}

function literatureMetadataRecoveryAdapterSource(reason: string) {
  return [
    'import json',
    'import re',
    'import sys',
    'from pathlib import Path',
    'from typing import Any',
    '',
    'from sciforge_task import load_input, write_payload, invoke_capability, provider_result_is_empty, empty_result_payload, ProviderInvocationError',
    '',
    `RECOVERY_REASON = ${JSON.stringify(reason)}`,
    'CAPABILITY_ROUTE_REF_PREFIX = "runtime:" + "//capability-"',
    'CAPABILITY_ROUTE_REF_PREFIX += "provider"',
    'CAPABILITY_ROUTE_REF_PREFIX += "-route/"',
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
    '            if any(key in node for key in ("title", "name", "citation", "doi", "url", "link", "abstract", "snippet", "summary")):',
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
    'def _query(prompt: str) -> str:',
    '    if re.search(r"single[-\\s]?cell", prompt, re.I) and re.search(r"flow\\s+matching", prompt, re.I):',
    '        return "arxiv flow matching single cell"',
    '    if re.search(r"single[-\\s]?cell", prompt, re.I) and re.search(r"perturbation", prompt, re.I):',
    '        return "arxiv single cell perturbation prediction"',
    '    topic_match = re.search(r"\\b(?:papers?|literature|survey|文献|论文).*?\\b(?:on|about|for)\\s+(.+?)(?:\\.\\s*(?:Requirements?|Hard requirements?)\\b|(?:Requirements?|Hard requirements?)\\b|$)", prompt, flags=re.I)',
    '    topic = topic_match.group(1) if topic_match else prompt',
    '    wants_arxiv = bool(re.search(r"\\barxiv\\b", prompt, flags=re.I))',
    '    date_match = re.search(r"\\b(?:last|past|recent)\\s+\\d{1,3}\\s+(?:day|days|week|weeks|month|months)\\b", prompt, flags=re.I)',
    '    date_prefix = "today " if re.search(r"\\btoday\\b|今天", prompt, flags=re.I) else ((date_match.group(0) + " ") if date_match else "")',
    '    text = topic',
    '    text = re.sub(r"\\bP\\d+\\b", " ", text, flags=re.I)',
    '    text = re.sub(r"\\b(selected report follow[- ]?up|follow[- ]?up|chinese report artifact|key conclusions|method differences?|next reading advice|limitations|full text|read full text|pdf availability|evidence locations|hard requirements?|requirements?|latest paper list|latest papers?|arxiv|pubmed|literature survey|survey recheck|provider recovery|after provider recovery|literature|survey|papers?|research|investigate|read|write|summar(?:y|ize|ise)|report|artifact|as much as possible|do not return placeholder papers?|budget[-\\s]?limit note|final answer)\\b", " ", text, flags=re.I)',
    '    text = re.sub(r"[^A-Za-z0-9+._\\-\\s]", " ", text)',
    '    text = " ".join(text.split())',
    '    if wants_arxiv and text:',
    '        text = "arxiv " + text',
    '    if not text:',
    '        return "recent literature"',
    '    return (date_prefix + text)[:180]',
    '',
    'def _ready_capability_ids(task_input: dict[str, Any]) -> list[str]:',
    '    policy = task_input.get("capabilityFirstPolicy", {}) if isinstance(task_input, dict) else {}',
    '    raw_ids = policy.get("readyCapabilityIds") if isinstance(policy, dict) else []',
    '    ids: list[str] = [item for item in raw_ids if isinstance(item, str)] if isinstance(raw_ids, list) else []',
    '    routes = task_input.get("capabilityProviderRoutes", {}) if isinstance(task_input, dict) else {}',
    '    route_items = routes.get("routes") if isinstance(routes, dict) else []',
    '    if isinstance(route_items, list):',
    '        for route in route_items:',
    '            if isinstance(route, dict) and route.get("status") == "ready" and isinstance(route.get("capabilityId"), str):',
    '                ids.append(route["capabilityId"])',
    '    return list(dict.fromkeys(ids))',
    '',
    'def _authors(value: Any) -> str:',
    '    if isinstance(value, list):',
    '        return ", ".join(_text(item) for item in value[:4] if _text(item))',
    '    return _text(value)',
    '',
    'def _full_text_status(record: dict[str, Any]) -> str:',
    '    url = _first(record, ["pdfUrl", "pdf", "fullTextUrl", "url", "link", "sourceUrl"]).lower()',
    '    if "pdf" in url or "arxiv.org" in url or "pmc" in url:',
    '        return "PDF and full-text likely reachable from capability URL; not downloaded in this bounded run."',
    '    return "No PDF or full-text URL confirmed by capability metadata; mark unavailable/not confirmed until web_fetch or pdf_extract verification."',
    '',
    'def _fetch_capability(ready_ids: list[Any], prompt: str) -> str:',
    '    needs_browser = bool(re.search(r"browser|rendered|javascript|网页|浏览器|pdf|full[-\\s]?text|全文", prompt, re.I))',
    '    if needs_browser and "browser_fetch" in ready_ids:',
    '        return "browser_fetch"',
    '    if "web_fetch" in ready_ids:',
    '        return "web_fetch"',
    '    if "browser_fetch" in ready_ids:',
    '        return "browser_fetch"',
    '    return ""',
    '',
    'def _link_text(link: Any) -> str:',
    '    if isinstance(link, dict):',
    '        return _first(link, ["url", "href", "link", "text", "title"])',
    '    return _text(link)',
    '',
    'def _pdf_url_from_row_or_fetch(row: dict[str, Any], final_url: str, fetch_result: dict[str, Any]) -> str:',
    '    direct = _first(row, ["pdfUrl", "pdf", "fullTextUrl"])',
    '    if direct:',
    '        return direct',
    '    links = fetch_result.get("links")',
    '    if isinstance(links, list):',
    '        for link in links:',
    '            link_text = _link_text(link)',
    '            low = link_text.lower()',
    '            if "pdf" in low or low.endswith(".pdf") or "arxiv.org/pdf/" in low:',
    '                return link_text',
    '    match = re.search(r"^https?://arxiv\\.org/abs/([^?#]+)", final_url, re.I)',
    '    if match:',
    '        return f"https://arxiv.org/pdf/{match.group(1)}.pdf"',
    '    if re.search(r"\\.pdf(?:$|[?#])", final_url, re.I):',
    '        return final_url',
    '    return ""',
    '',
    'def _first_evidence_location(value: Any, fallback: str) -> str:',
    '    if isinstance(value, list):',
    '        for item in value:',
    '            text = _text(item)',
    '            if text:',
    '                return text',
    '    text = _text(value)',
    '    return text or fallback',
    '',
    'def _apply_fetch_evidence(task_input: dict[str, Any], ready_ids: list[Any], prompt: str, rows: list[dict[str, Any]]) -> int:',
    '    fetch_id = _fetch_capability(ready_ids, prompt)',
    '    if not fetch_id:',
    '        return 0',
    '    fetched = 0',
    '    for row in rows[:3]:',
    '        url = _text(row.get("url"))',
    '        if not url:',
    '            row["evidenceLocation"] = "No source URL in provider metadata."',
    '            continue',
    '        try:',
    '            fetch_result = invoke_capability(task_input, fetch_id, {"url": url, "maxChars": 8000, "timeoutMs": 25000}, timeout_seconds=35)',
    '        except ProviderInvocationError as error:',
    '            row["evidenceLocation"] = url',
    '            row["fetchStatus"] = f"{fetch_id} failed: {error}"',
    '            row["fullTextStatus"] = "Full-text/PDF unavailable in this run because provider fetch failed; source URL retained for retry."',
    '            continue',
    '        if not isinstance(fetch_result, dict):',
    '            row["evidenceLocation"] = url',
    '            row["fetchStatus"] = f"{fetch_id} returned non-object output."',
    '            continue',
    '        fetched += 1',
    '        final_url = _first(fetch_result, ["finalUrl", "url"]) or url',
    '        text = _text(fetch_result.get("text"))',
    '        links = fetch_result.get("links")',
    '        pdf_links: list[str] = []',
    '        if isinstance(links, list):',
    '            for link in links:',
    '                link_text = _link_text(link)',
    '                if "pdf" in link_text.lower() or link_text.lower().endswith(".pdf"):',
    '                    pdf_links.append(link_text)',
    '        row["evidenceLocation"] = final_url',
    '        row["fetchStatus"] = f"Fetched via {fetch_id}; ok={fetch_result.get(\'ok\')}; status={fetch_result.get(\'status\')}"',
    '        if text:',
    '            row["evidenceSnippet"] = text[:900]',
    '        pdf_url = pdf_links[0] if pdf_links else _pdf_url_from_row_or_fetch(row, final_url, fetch_result)',
    '        if pdf_url:',
    '            row["pdfUrl"] = pdf_url',
    '            if "pdf_extract" in ready_ids:',
    '                try:',
    '                    pdf_result = invoke_capability(task_input, "pdf_extract", {"url": pdf_url, "maxChars": 14000, "maxPages": 8, "timeoutMs": 30000}, timeout_seconds=35)',
    '                except ProviderInvocationError as error:',
    '                    row["fullTextStatus"] = f"PDF/full-text candidate link found via {fetch_id}: {pdf_url[:300]}; pdf_extract failed: {error}"',
    '                    continue',
    '                if isinstance(pdf_result, dict):',
    '                    extraction = pdf_result.get("pdfExtraction") if isinstance(pdf_result.get("pdfExtraction"), dict) else {}',
    '                    pdf_text = _text(pdf_result.get("text"))',
    '                    row["pdfExtractionStatus"] = _text(extraction.get("status"))',
    '                    row["evidenceLocation"] = _first_evidence_location(extraction.get("evidenceLocations"), pdf_url + "#page=1")',
    '                    if pdf_text:',
    '                        row["evidenceSnippet"] = pdf_text[:1200]',
    '                        row["fullTextStatus"] = f"PDF extracted via pdf_extract ({_text(extraction.get(\'extractor\')) or \'pdftotext\'}), page range {_text(extraction.get(\'pageRange\')) or \'bounded\'}; source {pdf_url}"',
    '                        row["limitations"] = "PDF text was bounded to the configured page/character budget; citation claims should stay within recorded evidence locations."',
    '                    else:',
    '                        row["fullTextStatus"] = f"PDF URL confirmed ({pdf_url}), but bounded extraction returned no readable text: {_text(extraction.get(\'reason\')) or _text(extraction.get(\'status\')) or \'unknown reason\'}"',
    '                else:',
    '                    row["fullTextStatus"] = f"PDF/full-text candidate link found via {fetch_id}: {pdf_url[:300]}; pdf_extract returned non-object output."',
    '            else:',
    '                row["fullTextStatus"] = f"PDF/full-text candidate link found via {fetch_id}: {pdf_url[:300]}; pdf_extract provider was not ready."',
    '        elif text:',
    '            row["fullTextStatus"] = f"Source page text fetched via {fetch_id}; no PDF link confirmed in fetched page."',
    '        else:',
    '            row["fullTextStatus"] = f"{fetch_id} completed, but no page text or PDF link was returned."',
    '    return fetched',
    '',
    'def _rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:',
    '    rows: list[dict[str, Any]] = []',
    '    for index, record in enumerate(records[:8], start=1):',
    '        title = _first(record, ["title", "name", "citation"]) or f"Candidate paper {index}"',
    '        abstract = _first(record, ["abstract", "snippet", "summary", "description"])',
    '        url = _first(record, ["url", "link", "sourceUrl", "pdfUrl", "fullTextUrl"])',
    '        pdf_url = _first(record, ["pdfUrl", "pdf", "fullTextUrl"])',
    '        rows.append({',
    '            "id": f"paper-{index}",',
    '            "title": title,',
    '            "authors": _authors(record.get("authors")),',
    '            "year": _first(record, ["year", "publicationYear", "date", "published"]),',
    '            "venue": _first(record, ["journal", "venue", "source", "publisher"]),',
    '            "doi": _first(record, ["doi", "DOI"]),',
    '            "url": url,',
    '            "pdfUrl": pdf_url,',
    '            "summary": abstract[:700] if abstract else "Provider returned no abstract/snippet; inspect source before using as evidence.",',
    '            "fullTextStatus": _full_text_status(record),',
    '            "evidenceLocation": url or "Provider metadata had no source URL.",',
    '            "limitations": "Provider-grounded metadata package; citation/full-text verification should be run before strong scientific claims.",',
    '        })',
    '    return rows',
    '',
    'def _markdown_table(rows: list[dict[str, Any]]) -> str:',
    '    headers = ["title", "year", "venue", "url", "fullTextStatus", "summary", "limitations"]',
    '    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]',
    '    for row in rows:',
    '        cells = []',
    '        for header in headers:',
    '            cells.append(str(row.get(header, "")).replace("\\n", " ").replace("|", "/")[:900])',
    '        lines.append("| " + " | ".join(cells) + " |")',
    '    return "\\n".join(lines)',
    '',
    'def main() -> None:',
    '    _, input_path, output_path = sys.argv',
    '    task_input = load_input(input_path)',
    '    prompt = str(task_input.get("prompt", ""))',
    '    ready_ids = _ready_capability_ids(task_input)',
    '    query = _query(prompt)',
    '    capability_id = "web_search" if re.search(r"\\barxiv\\b", query, re.I) and "web_search" in ready_ids else ("browser_search" if "browser_search" in ready_ids else "web_search")',
    '    if capability_id not in ready_ids and ready_ids:',
    '        capability_id = "web_search" if "web_search" in ready_ids else ready_ids[0]',
    '    try:',
    '        provider_result = invoke_capability(task_input, capability_id, {"query": query, "limit": 8}, timeout_seconds=75)',
    '    except ProviderInvocationError as error:',
    '        write_payload(output_path, {"message": str(error), "confidence": 0.0, "claimType": "failed-with-reason", "evidenceLevel": "provider-route", "reasoningTrace": RECOVERY_REASON, "claims": [], "uiManifest": [], "executionUnits": [{"id": "literature-provider-recovery", "status": "failed-with-reason", "tool": "invoke_capability", "failureReason": str(error)}], "artifacts": [], "nextStep": "Retry after provider route health recovers."})',
    '        return',
    '    if provider_result_is_empty(provider_result):',
    '        write_payload(output_path, empty_result_payload(capability_id, "Ready literature provider route returned zero results; broaden/refine query and retry."))',
    '        return',
    '    rows = _rows(_flatten_records(provider_result, 16))',
    '    if not rows:',
    '        write_payload(output_path, empty_result_payload(capability_id, "Provider returned data, but no paper-like records could be normalized."))',
    '        return',
    '    fetched_count = _apply_fetch_evidence(task_input, ready_ids, prompt, rows)',
    '    out_dir = Path(output_path).parent / "literature-metadata-recovery"',
    '    out_dir.mkdir(parents=True, exist_ok=True)',
    '    paper_list_path = out_dir / "paper-list.json"',
    '    matrix_path = out_dir / "evidence-matrix.json"',
    '    report_path = out_dir / "research-report.md"',
    '    timeline_path = out_dir / "notebook-timeline.json"',
    '    paper_list_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")',
    '    matrix_rows = [{"claim": row["title"], "main result": row["summary"], "fullTextStatus": row["fullTextStatus"], "evidenceLocation": row.get("evidenceLocation"), "evidenceSnippet": row.get("evidenceSnippet", ""), "limitations": row["limitations"], "citation/ref": row.get("url") or row.get("doi") or row["title"]} for row in rows]',
    '    matrix_path.write_text(json.dumps(matrix_rows, ensure_ascii=False, indent=2), encoding="utf-8")',
    '    extracted_count = sum(1 for row in rows if _text(row.get("pdfExtractionStatus")) == "extracted" or "PDF extracted via pdf_extract" in _text(row.get("fullTextStatus")))',
    '    report = "# 中文文献调研报告（恢复路径）\\n\\n" + f"检索通道：{capability_id}；候选论文数：{len(rows)}；已抓取来源页面：{fetched_count}；已抽取 PDF 正文片段：{extracted_count}。\\n\\n" + "## 候选论文与全文及 PDF 状态\\n\\n" + _markdown_table(rows) + "\\n\\n## 关键结论\\n\\n- 已生成 latest paper list、evidence matrix、中文 research report artifact，并保留 source/evidence location。\\n- 对前几条候选记录尝试了 web_fetch 或 browser_fetch，并在确认 PDF URL 后调用 pdf_extract 做 bounded PDF 正文抽取；无法抽取时保留不可得原因。\\n- 该恢复路径提供可继续 selected report follow-up 的 artifact；强引用结论仍应限制在记录的 PDF 页码或片段证据内。\\n\\n## 局限性\\n\\n- 这是 AgentServer 生成任务接口失败后的恢复路径；不是完整人工级系统综述。\\n- 搜索通道的排序和摘要可能遗漏最新论文，全文可得性受能力路由、站点访问限制和 bounded page and char budget 影响。\\n\\n## Recovery note\\n\\n" + RECOVERY_REASON',
    '    report_path.write_text(report, encoding="utf-8")',
    '    timeline = {"events": [{"kind": "provider-search", "title": "Provider search", "summary": f"Called {capability_id}; normalized {len(rows)} candidate records.", "artifactRef": "artifact:paper-list"}, {"kind": "provider-fetch", "title": "Source fetch", "summary": f"Fetched {fetched_count} source pages for full-text/PDF availability notes.", "artifactRef": "artifact:evidence-matrix"}, {"kind": "report", "title": "Chinese report generated", "summary": "Generated reusable selected-report follow-up artifacts.", "artifactRef": "artifact:research-report"}]}',
    '    timeline_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")',
    '    payload = {',
    '        "message": f"已通过 SciForge {capability_id} provider route 生成文献调研交付包：{len(rows)} 篇候选论文、{fetched_count} 条来源页面抓取、{extracted_count} 条 PDF 正文抽取、中文报告 artifact 和 evidence matrix。",',
    '        "confidence": 0.78 if extracted_count else 0.74,',
    '        "claimType": "literature-survey",',
    '        "evidenceLevel": "provider-grounded-metadata",',
    '        "reasoningTrace": RECOVERY_REASON,',
    '        "claims": [{"statement": f"Provider route returned {len(rows)} candidate literature records.", "confidence": 0.74, "evidenceRefs": [CAPABILITY_ROUTE_REF_PREFIX + capability_id]}],',
    '        "uiManifest": [{"componentId": "paper-card-list", "artifactRef": "paper-list", "priority": 1}, {"componentId": "evidence-matrix", "artifactRef": "evidence-matrix", "priority": 2}, {"componentId": "report-viewer", "artifactRef": "research-report", "priority": 3}, {"componentId": "notebook-timeline", "artifactRef": "notebook-timeline", "priority": 4}],',
    '        "executionUnits": [{"id": "literature-metadata-recovery", "status": "done", "tool": "invoke_capability", "summary": f"Called {capability_id}, normalized candidate literature records, fetched {fetched_count} source pages, and extracted {extracted_count} PDFs when provider routes allowed."}],',
    '        "artifacts": [{"id": "paper-list", "type": "paper-list", "path": str(paper_list_path), "data": rows}, {"id": "evidence-matrix", "type": "evidence-matrix", "path": str(matrix_path), "data": {"rows": matrix_rows}}, {"id": "research-report", "type": "research-report", "path": str(report_path), "data": {"markdown": report}}, {"id": "notebook-timeline", "type": "notebook-timeline", "path": str(timeline_path), "data": timeline}],',
    '        "displayIntent": {"status": "completed", "taskOutcome": "satisfied", "primaryView": "answer"},',
    '        "objectReferences": [{"kind": "artifact", "ref": "artifact:research-report"}, {"kind": "artifact", "ref": "artifact:paper-list"}, {"kind": "artifact", "ref": "artifact:evidence-matrix"}, {"kind": "artifact", "ref": "artifact:notebook-timeline"}],',
    '        "nextStep": "Open the research-report artifact or ask a selected report follow-up; run full-text verification if stronger evidence is required.",',
    '    }',
    '    write_payload(output_path, payload)',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n');
}

function contractFailureAdapterSource(reason: string) {
  return [
    'import json',
    'import sys',
    '',
    `FAILURE_REASON = ${JSON.stringify(reason)}`,
    '',
    'def main() -> None:',
    '    _, input_path, output_path = sys.argv',
    '    try:',
    '        with open(input_path, "r", encoding="utf-8") as handle:',
    '            task_input = json.load(handle)',
    '    except Exception:',
    '        task_input = {}',
    '    prompt = str(task_input.get("prompt", ""))[:500] if isinstance(task_input, dict) else ""',
    '    message = "Generated task contract recovery: AgentServer did not return reusable task code, so SciForge wrote a valid failed-with-reason ToolPayload instead of executing static or non-contract code."',
    '    payload = {',
    '        "message": message,',
    '        "confidence": 0.0,',
    '        "claimType": "failed-with-reason",',
    '        "evidenceLevel": "runtime-contract",',
    '        "reasoningTrace": FAILURE_REASON,',
    '        "claims": [{',
    '            "statement": FAILURE_REASON,',
    '            "confidence": 0.0,',
    '            "evidenceRefs": ["runtime://generated-task-interface-contract"],',
    '        }],',
    '        "uiManifest": [],',
    '        "executionUnits": [{',
    '            "id": "generated-task-interface-contract",',
    '            "status": "failed-with-reason",',
    '            "tool": "sciforge.generated-task-contract-failure-adapter",',
    '            "summary": "Converted invalid AgentServer task code into a valid failed-with-reason ToolPayload.",',
    '            "failureReason": FAILURE_REASON,',
    '            "recoverActions": [',
    '                "Regenerate the task with code that reads argv inputPath and writes argv outputPath.",',
    '                "Return a direct ToolPayload for report-only answers that were already reasoned by AgentServer.",',
    '            ],',
    '        }],',
    '        "artifacts": [{',
    '            "id": "generated-task-contract-failure",',
    '            "type": "runtime-diagnostic",',
    '            "data": {',
    '                "reason": FAILURE_REASON,',
    '                "promptPreview": prompt,',
    '                "contract": "generated task entrypoint must read inputPath and write outputPath",',
    '            },',
    '        }],',
    '        "recoverActions": [',
    '            "Regenerate with the generated task interface contract enforced before execution.",',
    '            "Use a direct ToolPayload when no reusable workspace task is needed.",',
    '        ],',
    '        "nextStep": "Retry generation with a compact executable adapter or direct failed-with-reason ToolPayload.",',
    '    }',
    '    with open(output_path, "w", encoding="utf-8") as handle:',
    '        json.dump(payload, handle, ensure_ascii=False, indent=2)',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n');
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
    'CAPABILITY_ROUTE_REF_PREFIX = "runtime:" + "//capability-"',
    'CAPABILITY_ROUTE_REF_PREFIX += "provider"',
    'CAPABILITY_ROUTE_REF_PREFIX += "-route/"',
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
    '    wants_arxiv = bool(re.search(r"\\barxiv\\b", prompt_text, re.I))',
    '    if wants_arxiv and "web_search" in ready_ids:',
    '        capability_id = "web_search"',
    '    elif needs_browser and "browser_search" in ready_ids:',
    '        capability_id = "browser_search"',
    '    elif "web_search" in ready_ids:',
    '        capability_id = "web_search"',
    '    elif "browser_search" in ready_ids:',
    '        capability_id = "browser_search"',
    '    else:',
    '        capability_id = ready_ids[0] if ready_ids else "web_search"',
    '    provider_input = {"query": _search_query(task_input.get("prompt", "")), "limit": 8}',
    '    try:',
    '        provider_result = invoke_capability(task_input, capability_id, provider_input, timeout_seconds=75)',
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
    '    claims = [{"statement": failure_reason, "confidence": 0.0, "evidenceRefs": [CAPABILITY_ROUTE_REF_PREFIX + capability_id]}]',
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
    '        "executionUnits": [{"id": "provider-first-recovery", "status": "failed-with-reason", "tool": "invoke_capability", "summary": f"Called {capability_id} via SciForge provider route.", "failureReason": failure_reason, "recoverActions": ["Retry with a backend task that uses web_search, web_fetch, browser_search, browser_fetch, pdf_extract, and read_ref provider routes end-to-end.", "If full-text access is unavailable, return an explicit unavailable/empty-result payload instead of a satisfied report."]}],',
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

async function generatedTaskSyntaxPreflightReason(workspace: string, response: AgentServerGenerationResponse) {
  const language = String(response.entrypoint.language || '').toLowerCase();
  if (language !== 'python') return undefined;
  const entryRel = safeWorkspaceRel(response.entrypoint.path);
  const content = response.taskFiles.find((file) => safeWorkspaceRel(file.path) === entryRel)?.content
    ?? await readGeneratedTaskFileIfPresent(workspace, entryRel);
  if (content === undefined) return undefined;
  const command = await pythonSyntaxCommand(workspace);
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-syntax-preflight-'));
  const tempPath = join(tempDir, 'entrypoint.py');
  try {
    await writeFile(tempPath, content, 'utf8');
    await execFileAsync(command, [
      '-c',
      [
        'import ast, sys',
        'path = sys.argv[1]',
        'with open(path, "r", encoding="utf-8") as handle:',
        '    ast.parse(handle.read(), filename=sys.argv[2])',
      ].join('\n'),
      tempPath,
      entryRel,
    ], {
      cwd: workspace,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    return undefined;
  } catch (error) {
    return `Generated Python entrypoint failed syntax preflight before execution: ${sanitizeChildProcessDiagnostic(error)}`;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function pythonSyntaxCommand(workspace: string) {
  for (const candidate of workspaceTaskPythonCommandCandidates(workspace)) {
    if (await fileExists(candidate)) return candidate;
  }
  return 'python3';
}

function sanitizeChildProcessDiagnostic(error: unknown) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  return [
    typeof record.stderr === 'string' ? record.stderr : '',
    typeof record.stdout === 'string' ? record.stdout : '',
    errorMessage(error),
  ].filter((part) => part.trim()).join('\n').trim();
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

async function repairNeeded(
  input: ResolveGeneratedTaskGenerationLifecycleInput,
  reason: string,
): Promise<{ kind: 'payload'; payload: ToolPayload }> {
  const literatureRecovery = await literatureGenerationFailureRecoveryPayload(input.request, reason);
  if (literatureRecovery) {
    return {
      kind: 'payload',
      payload: await materializeAgentServerGenerationLifecyclePayload({
        workspace: input.workspace,
        request: input.request,
        skill: input.skill,
        payload: literatureRecovery,
        reason,
        kind: 'generation-retry-literature-recovery',
        taskRel: AGENTSERVER_GENERATION_RETRY_REPAIR_TASK_REF,
      }),
    };
  }
  const repairPayload = input.deps.repairNeededPayload(input.request, input.skill, reason);
  return {
    kind: 'payload',
    payload: await materializeAgentServerGenerationLifecyclePayload({
      workspace: input.workspace,
      request: input.request,
      skill: input.skill,
      payload: repairPayload,
      reason,
      kind: 'generation-retry-repair',
      taskRel: AGENTSERVER_GENERATION_RETRY_REPAIR_TASK_REF,
    }),
  };
}

async function materializeAgentServerGenerationLifecyclePayload(input: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  payload: ToolPayload;
  reason: string;
  kind: string;
  taskRel: string;
}) {
  const refs = backendPayloadRefs(
    stableAgentServerPayloadTaskId(input.kind, input.request, input.skill, sha1(input.reason).slice(0, 8)),
    input.taskRel,
    sessionBundleRelForRequest(input.request),
  );
  await writeBackendPayloadLogs(input.workspace, refs, `${input.kind}: ${input.reason}\n`);
  return await materializeBackendPayloadOutput(input.workspace, input.request, input.payload, refs);
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
