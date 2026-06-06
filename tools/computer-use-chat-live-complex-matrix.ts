import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import {
  buildComputerUseChatLivePreflightManifest,
  type ComputerUseChatLivePreflightManifest,
} from './computer-use-chat-live-preflight.js';
import {
  runComputerUseChatLiveContinuationE2E,
  runComputerUseChatLiveE2E,
} from './computer-use-chat-live-e2e.js';
import type {
  ComputerUseChatLiveContinuationE2EManifest,
  ComputerUseChatLiveE2EExpectedStatus,
  ComputerUseChatLiveE2EManifest,
  ComputerUseChatLiveE2EOptions,
} from './computer-use-chat-live-e2e-contract.js';
import {
  classifyCuNextEvidence,
  type CuNextEvidenceClassification,
  type CuNextEvidenceClassificationInput,
} from './computer-use-next/evidence-classification.js';
import { buildComputerUseChatLiveResourceDiagnostics } from './computer-use-chat-live-resource-diagnostics.js';
import {
  buildComputerUseChatLiveCaseIsolationResetManifest,
  buildComputerUseChatLiveCaseIsolationSeedPlan,
  e2eOptionsForCaseIsolationPlanCase,
  writeComputerUseChatLiveCaseIsolationResetManifest,
  type ComputerUseChatLiveCaseIsolationResetManifest,
  type ComputerUseChatLiveCaseIsolationSeedPlan,
  type ComputerUseChatLiveCaseIsolationSeedPlanCase,
  type ComputerUseChatLiveCaseIsolationStrategy,
} from './computer-use-chat-live-case-isolation.js';
import {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES,
  type ComputerUseChatLiveComplexMatrixCase,
  type ComputerUseChatLiveComplexMatrixCaseId,
} from './computer-use-chat-live-complex-matrix-cases.js';
import {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_SCHEMA,
  type ComputerUseChatLiveComplexMatrixAggregateCase,
  type ComputerUseChatLiveComplexMatrixAggregateManifest,
  type ComputerUseChatLiveComplexMatrixCaseIsolation,
  type ComputerUseChatLiveComplexMatrixCaseResult,
  type ComputerUseChatLiveComplexMatrixCaseRetryAttempt,
  type ComputerUseChatLiveComplexMatrixCleanupManifest,
  type ComputerUseChatLiveComplexMatrixManifest,
  type ComputerUseChatLiveComplexMatrixOptions,
  type ComputerUseChatLiveComplexMatrixStabilityDiagnostics,
} from './computer-use-chat-live-complex-matrix-contract.js';
import { diagnosticBlockersForComplexMatrixAggregateCase } from './computer-use-chat-live-complex-matrix-diagnostic-blockers.js';

export {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES,
  type ComputerUseChatLiveComplexMatrixCase,
  type ComputerUseChatLiveComplexMatrixCaseId,
} from './computer-use-chat-live-complex-matrix-cases.js';
export {
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
  COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_SCHEMA,
  type ComputerUseChatLiveComplexMatrixAggregateCase,
  type ComputerUseChatLiveComplexMatrixAggregateManifest,
  type ComputerUseChatLiveComplexMatrixCaseIsolation,
  type ComputerUseChatLiveComplexMatrixCaseResult,
  type ComputerUseChatLiveComplexMatrixCaseRetryAttempt,
  type ComputerUseChatLiveComplexMatrixCleanupManifest,
  type ComputerUseChatLiveComplexMatrixDiagnosticBlocker,
  type ComputerUseChatLiveComplexMatrixManifest,
  type ComputerUseChatLiveComplexMatrixOptions,
  type ComputerUseChatLiveComplexMatrixStabilityDiagnostics,
} from './computer-use-chat-live-complex-matrix-contract.js';

const EXPECTED_STATUS_DRIFT_MAX_RETRIES = 1;
const DEFAULT_COMPLEX_MATRIX_CASE_TIMEOUT_MS = 600_000;
const MAX_DEFAULT_COMPLEX_MATRIX_CASE_TIMEOUT_MS = 600_000;

interface CliArgs {
  out?: string;
  aggregateFrom: string[];
  workspace?: string;
  workspaceWriterBaseUrl?: string;
  timeoutMs?: number;
  caseTimeoutMs?: number;
  completionEvidenceProducerIds: string[];
  caseIds?: ComputerUseChatLiveComplexMatrixCaseId[];
  caseIsolationStrategy?: ComputerUseChatLiveCaseIsolationStrategy;
  strict: boolean;
  json: boolean;
}

export async function runComputerUseChatLiveComplexMatrix(
  options: ComputerUseChatLiveComplexMatrixOptions = {},
): Promise<ComputerUseChatLiveComplexMatrixManifest> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const cases = selectedCases(options.caseIds);
  const matrixRunId = matrixRunIdForOptions(options, checkedAt);
  const writeProgressManifest = matrixProgressManifestWriter(options.out);
  const caseIsolationPlan = await buildOptionalCaseIsolationPlan({
    matrixRunId,
    cases,
    options,
    now,
  });
  const preflight = await buildComputerUseChatLivePreflightManifest({
    env,
    fetchImpl: options.fetchImpl,
    now,
    workspacePath: options.workspacePath,
    localConfigs: options.localConfigs,
    requestVisionAllowSharedSystemInput: false,
  });
  if (preflight.status !== 'ready') {
    const blockedCases = cases.map((item, index) => blockedCase(
      item,
      checkedAt,
      preflight,
      caseIsolationContext({ item, caseIndex: index, matrixRunId, options, caseIsolationPlan }),
    ));
    const blockedManifest: ComputerUseChatLiveComplexMatrixManifest = sanitizeMatrixManifest({
      schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_SCHEMA,
      checkedAt,
      status: 'blocked',
      releaseAcceptance: 'opt-in-only',
      evidenceMode: 'current-chat-run-complex-matrix-only',
      preflight: preflightSummary(preflight),
      caseIsolationPlan: caseIsolationPlanSummary(caseIsolationPlan),
      cases: blockedCases,
      stabilityDiagnostics: buildComplexMatrixStabilityDiagnostics({ selectedCases: cases, results: blockedCases }),
      issues: [
        'live-preflight-not-ready',
        ...preflight.missingEnv.map((item) => `missing:${item}`),
        ...preflight.policyViolations.map((item) => `policy:${item}`),
        ...preflight.serviceChecks.filter((check) => check.status === 'fail').map((check) => `service:${check.id}`),
      ],
      requestSubmitted: false,
      resourceDiagnostics: buildComputerUseChatLiveResourceDiagnostics({
        env,
        manifests: [preflight],
        now,
      }),
      completionPolicy: completionPolicy(),
    });
    await writeProgressManifest(blockedManifest);
    return blockedManifest;
  }

  const results: ComputerUseChatLiveComplexMatrixCaseResult[] = [];
  const resetManifests: ComputerUseChatLiveCaseIsolationResetManifest[] = [];
  const caseTimeoutMs = matrixCaseTimeoutMs(options, env);
  await writeProgressManifest(matrixManifestForResults({ checkedAt, cases, results, preflight, caseIsolationPlan, env, now }));
  for (const [caseIndex, item] of cases.entries()) {
    let isolation = caseIsolationContext({ item, caseIndex, matrixRunId, options, caseIsolationPlan });
    const reset = await writeCaseIsolationResetManifest({
      item,
      isolation,
      caseIsolationPlan,
      previousManifests: resetManifests,
      now,
    });
    isolation = reset.isolation;
    if (reset.manifest) resetManifests.push(reset.manifest);
    if (reset.manifest?.status === 'failed') {
      const failed = failedCaseRunManifest(
        item,
        checkedAt,
        preflight,
        new Error(`case isolation reset failed: ${reset.manifest.issues.join('; ')}`),
      );
      const result = matrixCaseResult(item, failed, isolation);
      results.push(await resultWithCleanupManifest(result, options, now));
      await writeProgressManifest(matrixManifestForResults({ checkedAt, cases, results, preflight, caseIsolationPlan, env, now }));
      continue;
    }
    const runOptions = caseRunOptions(options, caseIsolationPlan?.cases[caseIndex]);
    try {
      const run = await runMatrixCaseWithHardTimeout(
        item,
        runOptions,
        isolation,
        now,
        caseTimeoutMs,
      );
      const result = matrixCaseResult(item, run.runManifest, run.isolation ?? isolation, run.autoContinuation, run.retryAttempts);
      results.push(await resultWithCleanupManifest(result, options, now));
    } catch (error) {
      const run = await runMatrixCaseRunErrorRetry({
        item,
        options: runOptions,
        isolation,
        preflight,
        checkedAt,
        error,
        now,
        caseTimeoutMs,
      });
      const result = matrixCaseResult(item, run.runManifest, run.isolation ?? isolation, run.autoContinuation, run.retryAttempts);
      results.push(await resultWithCleanupManifest(result, options, now));
    }
    await writeProgressManifest(matrixManifestForResults({ checkedAt, cases, results, preflight, caseIsolationPlan, env, now }));
  }
  const manifest = matrixManifestForResults({ checkedAt, cases, results, preflight, caseIsolationPlan, env, now });
  await writeProgressManifest(manifest);
  return manifest;
}

function matrixManifestForResults(input: {
  checkedAt: string;
  cases: ComputerUseChatLiveComplexMatrixCase[];
  results: ComputerUseChatLiveComplexMatrixCaseResult[];
  preflight: ComputerUseChatLivePreflightManifest;
  caseIsolationPlan?: ComputerUseChatLiveCaseIsolationSeedPlan;
  env: NodeJS.ProcessEnv;
  now: () => Date;
}): ComputerUseChatLiveComplexMatrixManifest {
  const incompleteIssue = input.results.length < input.cases.length
    ? [`matrix-run-incomplete:${input.results.length}/${input.cases.length}`]
    : [];
  const issues = uniqueStrings([
    ...input.results.flatMap((result) => result.issues.map((issue) => `${result.id}:${issue}`)),
    ...incompleteIssue,
  ]);
  return sanitizeMatrixManifest({
    schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_SCHEMA,
    checkedAt: input.checkedAt,
    status: input.results.length === input.cases.length && input.results.every((result) => result.status === 'passed')
      ? 'passed'
      : 'failed',
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'current-chat-run-complex-matrix-only',
    preflight: preflightSummary(input.preflight),
    caseIsolationPlan: caseIsolationPlanSummary(input.caseIsolationPlan),
    cases: input.results,
    stabilityDiagnostics: buildComplexMatrixStabilityDiagnostics({ selectedCases: input.cases, results: input.results }),
    issues,
    requestSubmitted: input.results.some((result) => result.requestSubmitted),
    resourceDiagnostics: buildComputerUseChatLiveResourceDiagnostics({
      env: input.env,
      manifests: input.results.flatMap((result) => [
        result.runManifest,
        result.autoContinuation,
        ...(result.retryAttempts ?? []).map((attempt) => attempt.sourceRunManifest),
        result.isolation,
      ].filter((item): item is NonNullable<typeof item> => Boolean(item))),
      manifestRefs: uniqueStrings(input.results.flatMap((result) => [
        ...result.runManifest.auditRefs,
        result.isolation.cleanupManifestRef ?? '',
        ...(result.retryAttempts ?? []).flatMap((attempt) => [
          ...attempt.sourceRunManifest.auditRefs,
          attempt.cleanupBeforeRetry.cleanupManifestRef ?? '',
        ]),
        result.runManifest.packageBridgeCompletionGrade?.producerDiagnosticRefs ?? [],
        result.runManifest.packageBridgeCompletionGrade?.diagnosticRefs ?? [],
      ].flat())),
      now: input.now,
    }),
    completionPolicy: completionPolicy(),
  });
}

function buildComplexMatrixStabilityDiagnostics(input: {
  selectedCases: ComputerUseChatLiveComplexMatrixCase[];
  results: ComputerUseChatLiveComplexMatrixCaseResult[];
}): ComputerUseChatLiveComplexMatrixStabilityDiagnostics {
  const selectedCaseIds = input.selectedCases.map((item) => item.id);
  const resultCaseIds = input.results.map((item) => item.id);
  const selectedSet = new Set(selectedCaseIds);
  const resultCounts = new Map<ComputerUseChatLiveComplexMatrixCaseId, number>();
  for (const id of resultCaseIds) resultCounts.set(id, (resultCounts.get(id) ?? 0) + 1);
  const firstFailedIndex = input.results.findIndex((result) => result.status === 'failed');
  const retryAttempts = input.results.flatMap((result) => result.retryAttempts ?? []);
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.stability-diagnostics.v1',
    caseOrdering: {
      selectedCaseIds,
      resultCaseIds,
      preservedSelectedOrder: selectedCaseIds.length === resultCaseIds.length
        && selectedCaseIds.every((id, index) => resultCaseIds[index] === id),
      duplicateResultCaseIds: Array.from(resultCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([id]) => id),
      missingResultCaseIds: selectedCaseIds.filter((id) => !resultCounts.has(id)),
      extraResultCaseIds: resultCaseIds.filter((id) => !selectedSet.has(id)),
    },
    retryBoundary: {
      mode: 'case-scoped',
      matrixContinuesAfterCaseFailure: firstFailedIndex >= 0
        && input.results.slice(firstFailedIndex + 1).some((result) => result.requestSubmitted),
      failedCaseIds: input.results.filter((result) => result.status === 'failed').map((result) => result.id),
      submittedAfterFailureCaseIds: firstFailedIndex >= 0
        ? input.results.slice(firstFailedIndex + 1).filter((result) => result.requestSubmitted).map((result) => result.id)
        : [],
      autoContinuationCaseIds: input.results.filter((result) => Boolean(result.autoContinuation)).map((result) => result.id),
      boundedRetryCaseIds: input.results.filter((result) => (result.retryAttempts ?? []).length > 0).map((result) => result.id),
      cases: input.results.map((result, index) => ({
        id: result.id,
        caseIndex: result.isolation.caseIndex,
        status: result.status,
        requestSubmitted: result.requestSubmitted,
        autoContinuationAttempted: Boolean(result.autoContinuation),
        boundedRetryAttempts: result.retryAttempts?.length ?? 0,
        boundary: retryBoundaryForCase(result),
      })),
    },
    cleanupManifestSummary: {
      expectedCaseCount: selectedCaseIds.length,
      plannedManifestRefs: uniqueStrings([
        ...input.results.map((result) => result.isolation.cleanupManifestRef ?? ''),
        ...retryAttempts.map((attempt) => attempt.cleanupBeforeRetry.cleanupManifestRef ?? ''),
      ]),
      recordedManifestRefs: uniqueStrings(input.results
        .filter((result) => result.isolation.cleanupStatus === 'recorded')
        .map((result) => result.isolation.cleanupManifestRef ?? '')
        .concat(retryAttempts
          .filter((attempt) => attempt.cleanupBeforeRetry.cleanupStatus === 'recorded')
          .map((attempt) => attempt.cleanupBeforeRetry.cleanupManifestRef ?? ''))),
      inlineOnlyCaseIds: input.results
        .filter((result) => result.isolation.cleanupStatus === 'inline-only')
        .map((result) => result.id),
      writeFailedCaseIds: input.results
        .filter((result) => result.isolation.cleanupStatus === 'write-failed')
        .map((result) => result.id),
      cleanupIssuesByCase: input.results
        .filter((result) => result.isolation.cleanupIssues.length > 0)
        .map((result) => ({
          id: result.id,
          cleanupStatus: result.isolation.cleanupStatus,
          issues: result.isolation.cleanupIssues,
        })),
    },
  };
}

function retryBoundaryForCase(
  result: ComputerUseChatLiveComplexMatrixCaseResult,
): ComputerUseChatLiveComplexMatrixStabilityDiagnostics['retryBoundary']['cases'][number]['boundary'] {
  if (!result.requestSubmitted) return 'blocked-before-submit';
  if (result.autoContinuation) return 'single-case-continuation';
  if ((result.retryAttempts ?? []).length > 0) return 'single-case-bounded-retry';
  if (result.status === 'failed') return 'case-run-failure-captured';
  return 'no-retry-needed';
}

async function runMatrixCaseWithHardTimeout(
  item: ComputerUseChatLiveComplexMatrixCase,
  options: ComputerUseChatLiveComplexMatrixOptions,
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation,
  now: () => Date,
  caseTimeoutMs: number,
): Promise<{
  runManifest: ComputerUseChatLiveE2EManifest;
  isolation?: ComputerUseChatLiveComplexMatrixCaseIsolation;
  autoContinuation?: ComputerUseChatLiveComplexMatrixCaseResult['autoContinuation'];
  retryAttempts?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt[];
}> {
  const controller = new AbortController();
  const parentSignal = options.abortSignal;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let timedOut = false;
  const runPromise = runMatrixCase(item, { ...options, abortSignal: controller.signal }, isolation, now);
  runPromise.catch(() => undefined);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = globalThis.setTimeout(() => {
      timedOut = true;
      reject(new Error(`Computer Use complex matrix case ${item.id} timed out after ${caseTimeoutMs}ms`));
      controller.abort();
    }, caseTimeoutMs);
  });

  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
    if (!timedOut && !parentSignal?.aborted) controller.abort();
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

async function runMatrixCaseRunErrorRetry(input: {
  item: ComputerUseChatLiveComplexMatrixCase;
  options: ComputerUseChatLiveComplexMatrixOptions;
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation;
  preflight: ComputerUseChatLivePreflightManifest;
  checkedAt: string;
  error: unknown;
  now: () => Date;
  caseTimeoutMs: number;
}): Promise<{
  runManifest: ComputerUseChatLiveE2EManifest;
  isolation?: ComputerUseChatLiveComplexMatrixCaseIsolation;
  autoContinuation?: ComputerUseChatLiveComplexMatrixCaseResult['autoContinuation'];
  retryAttempts?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt[];
}> {
  const sourceRunManifest = failedCaseRunManifest(input.item, input.checkedAt, input.preflight, input.error);
  if (!caseRunTransientErrorRetryReason(sourceRunManifest)) return { runManifest: sourceRunManifest };

  const firstAttemptResult = matrixCaseResult(input.item, sourceRunManifest, {
    ...input.isolation,
    cleanupManifestRef: retryCleanupManifestRefForCase(input.isolation.matrixRunId, input.item.id, 1),
    cleanupStatus: 'planned',
    cleanupIssues: [],
  });
  const cleanedFirstAttempt = await resultWithCleanupManifest(firstAttemptResult, input.options, input.now);
  if (cleanedFirstAttempt.isolation.cleanupStatus === 'write-failed') return { runManifest: sourceRunManifest };

  const retryIsolation = retryIsolationForAttempt(input.isolation, input.item.id, 1);
  let retryRunManifest: ComputerUseChatLiveE2EManifest;
  let retryAutoContinuation: ComputerUseChatLiveComplexMatrixCaseResult['autoContinuation'];
  let nestedRetryAttempts: ComputerUseChatLiveComplexMatrixCaseRetryAttempt[] | undefined;
  let retryRunIsolation: ComputerUseChatLiveComplexMatrixCaseIsolation | undefined;
  try {
    const retryRun = await runMatrixCaseWithHardTimeout(
      input.item,
      input.options,
      retryIsolation,
      input.now,
      input.caseTimeoutMs,
    );
    retryRunManifest = retryRun.runManifest;
    retryAutoContinuation = retryRun.autoContinuation;
    nestedRetryAttempts = retryRun.retryAttempts;
    retryRunIsolation = retryRun.isolation;
  } catch (retryError) {
    retryRunManifest = failedCaseRunManifest(input.item, input.checkedAt, input.preflight, retryError);
  }

  return {
    runManifest: retryRunManifest,
    isolation: retryRunIsolation ?? retryIsolation,
    autoContinuation: retryAutoContinuation,
    retryAttempts: [{
      schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-retry.v1',
      attempt: 1,
      maxAttempts: EXPECTED_STATUS_DRIFT_MAX_RETRIES,
      reason: 'case-run-transient-error',
      expectedStatus: input.item.expectedStatus,
      observedStatus: sourceRunManifest.status,
      observedVisibleStatus: sourceRunManifest.visibleStatus,
      sourceRunManifest,
      cleanupBeforeRetry: {
        cleanupManifestRef: cleanedFirstAttempt.isolation.cleanupManifestRef,
        cleanupStatus: cleanedFirstAttempt.isolation.cleanupStatus,
        cleanupIssues: cleanedFirstAttempt.isolation.cleanupIssues,
      },
      retryBoundary: {
        sessionId: retryIsolation.sessionId,
        currentTurnId: retryIsolation.currentTurnId,
        workspaceSeed: retryIsolation.workspaceSeed,
        prompt: input.item.prompt,
        requestSubmitted: retryRunManifest.requestSubmitted,
        status: retryRunManifest.status,
        issues: retryRunManifest.issues,
      },
    }, ...(nestedRetryAttempts ?? [])],
  };
}

function caseRunTransientErrorRetryReason(
  runManifest: ComputerUseChatLiveE2EManifest,
): ComputerUseChatLiveComplexMatrixCaseRetryAttempt['reason'] | undefined {
  const errorIssue = runManifest.issues.find((issue) => issue.startsWith('matrix-case-run-error:'));
  if (!errorIssue) return undefined;
  if (/timed out after \d+ms/i.test(errorIssue)) return undefined;
  return /terminated|socket|econnreset|fetch failed|network|aborted|closed|stream/i.test(errorIssue)
    ? 'case-run-transient-error'
    : undefined;
}

async function runMatrixCase(
  item: ComputerUseChatLiveComplexMatrixCase,
  options: ComputerUseChatLiveComplexMatrixOptions,
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation,
  now: () => Date,
): Promise<{
  runManifest: ComputerUseChatLiveE2EManifest;
  isolation?: ComputerUseChatLiveComplexMatrixCaseIsolation;
  autoContinuation?: ComputerUseChatLiveComplexMatrixCaseResult['autoContinuation'];
  retryAttempts?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt[];
}> {
  if (item.expectedStatus !== 'completed') {
    const casePrompt = computerUseCommandPrompt(item.prompt);
    const firstRunManifest = await runComputerUseChatLiveE2E({
      ...options,
      prompt: casePrompt,
      expectedStatus: item.expectedStatus,
      taskId: item.taskId,
      scenarioId: item.scenarioId,
      sessionId: isolation.sessionId,
      currentTurnId: isolation.currentTurnId,
    });
    const retryReason = nonCompletedRetryReason(item, firstRunManifest);
    if (!retryReason) return { runManifest: firstRunManifest };

    const firstAttemptResult = matrixCaseResult(item, firstRunManifest, {
      ...isolation,
      cleanupManifestRef: retryCleanupManifestRefForCase(isolation.matrixRunId, item.id, 1),
      cleanupStatus: 'planned',
      cleanupIssues: [],
    });
    const cleanedFirstAttempt = await resultWithCleanupManifest(firstAttemptResult, options, now);
    if (cleanedFirstAttempt.isolation.cleanupStatus === 'write-failed') {
      return { runManifest: firstRunManifest };
    }

    const retryIsolation = retryIsolationForAttempt(isolation, item.id, 1);
    const retryPrompt = retryPromptForExpectedStateGuard({
      item,
      attempt: 1,
      maxAttempts: EXPECTED_STATUS_DRIFT_MAX_RETRIES,
      reason: retryReason,
      sourceRunManifest: firstRunManifest,
    });
    const retryCommandPrompt = computerUseCommandPrompt(retryPrompt);
    const retryRunManifest = await runComputerUseChatLiveE2E({
      ...options,
      prompt: retryCommandPrompt,
      expectedStatus: item.expectedStatus,
      taskId: item.taskId,
      scenarioId: item.scenarioId,
      sessionId: retryIsolation.sessionId,
      currentTurnId: retryIsolation.currentTurnId,
    });
    return {
      runManifest: retryRunManifest,
      isolation: retryIsolation,
      retryAttempts: [{
        schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-retry.v1',
        attempt: 1,
        maxAttempts: EXPECTED_STATUS_DRIFT_MAX_RETRIES,
        reason: retryReason,
        expectedStatus: item.expectedStatus,
        observedStatus: firstRunManifest.status,
        observedVisibleStatus: firstRunManifest.visibleStatus,
        sourceRunManifest: firstRunManifest,
        cleanupBeforeRetry: {
          cleanupManifestRef: cleanedFirstAttempt.isolation.cleanupManifestRef,
          cleanupStatus: cleanedFirstAttempt.isolation.cleanupStatus,
          cleanupIssues: cleanedFirstAttempt.isolation.cleanupIssues,
        },
        retryBoundary: {
          sessionId: retryIsolation.sessionId,
          currentTurnId: retryIsolation.currentTurnId,
          workspaceSeed: retryIsolation.workspaceSeed,
          prompt: retryCommandPrompt,
          requestSubmitted: retryRunManifest.requestSubmitted,
          status: retryRunManifest.status,
          issues: retryRunManifest.issues,
        },
      }],
    };
  }
  const continuation = await runComputerUseChatLiveContinuationE2E({
    ...options,
    firstPrompt: computerUseCommandPrompt(item.prompt),
    firstExpectedStatus: 'completed',
    secondExpectedStatus: 'completed',
    taskId: item.taskId,
    scenarioId: item.scenarioId,
    sessionId: isolation.sessionId,
    currentTurnId: isolation.currentTurnId,
  });
  const selectedRunManifest = continuation.status === 'passed' && continuation.secondTurn
    ? continuation.secondTurn
    : continuation.firstTurn;
  const selectedRunCurrentTurnId = continuation.status === 'passed' && continuation.secondTurn
    ? `${isolation.currentTurnId}-turn-2`
    : `${isolation.currentTurnId}-turn-1`;
  const autoContinuation = continuation.status === 'passed' || continuation.secondTurn
    ? continuationCaseSummary(continuation)
    : undefined;
  const retryReason = completedRetryReason(item, selectedRunManifest);
  if (retryReason) {
    const sourceAttemptIsolation = {
      ...isolation,
      currentTurnId: safeId(selectedRunCurrentTurnId),
    };
    const firstAttemptResult = matrixCaseResult(item, selectedRunManifest, {
      ...sourceAttemptIsolation,
      cleanupManifestRef: retryCleanupManifestRefForCase(isolation.matrixRunId, item.id, 1),
      cleanupStatus: 'planned',
      cleanupIssues: [],
    }, autoContinuation);
    const cleanedFirstAttempt = await resultWithCleanupManifest(firstAttemptResult, options, now);
    if (cleanedFirstAttempt.isolation.cleanupStatus !== 'write-failed') {
      const retryIsolation = retryIsolationForAttempt(sourceAttemptIsolation, item.id, 1);
      const retryPrompt = retryPromptForExpectedStateGuard({
        item,
        attempt: 1,
        maxAttempts: EXPECTED_STATUS_DRIFT_MAX_RETRIES,
        reason: retryReason,
        sourceRunManifest: selectedRunManifest,
      });
      const retryCommandPrompt = computerUseCommandPrompt(retryPrompt);
      const retryRunManifest = await runComputerUseChatLiveE2E({
        ...options,
        prompt: retryCommandPrompt,
        expectedStatus: item.expectedStatus,
        taskId: item.taskId,
        scenarioId: item.scenarioId,
        sessionId: retryIsolation.sessionId,
        currentTurnId: retryIsolation.currentTurnId,
      });
      return {
        runManifest: retryRunManifest,
        isolation: retryIsolation,
        autoContinuation,
        retryAttempts: [{
          schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-retry.v1',
          attempt: 1,
          maxAttempts: EXPECTED_STATUS_DRIFT_MAX_RETRIES,
          reason: retryReason,
          expectedStatus: item.expectedStatus,
          observedStatus: selectedRunManifest.status,
          observedVisibleStatus: selectedRunManifest.visibleStatus,
          sourceRunManifest: selectedRunManifest,
          cleanupBeforeRetry: {
            cleanupManifestRef: cleanedFirstAttempt.isolation.cleanupManifestRef,
            cleanupStatus: cleanedFirstAttempt.isolation.cleanupStatus,
            cleanupIssues: cleanedFirstAttempt.isolation.cleanupIssues,
          },
          retryBoundary: {
            sessionId: retryIsolation.sessionId,
            currentTurnId: retryIsolation.currentTurnId,
            workspaceSeed: retryIsolation.workspaceSeed,
            prompt: retryCommandPrompt,
            requestSubmitted: retryRunManifest.requestSubmitted,
            status: retryRunManifest.status,
            issues: retryRunManifest.issues,
          },
        }],
      };
    }
  }
  return {
    runManifest: selectedRunManifest,
    autoContinuation,
  };
}

function continuationCaseSummary(
  manifest: ComputerUseChatLiveContinuationE2EManifest,
): ComputerUseChatLiveComplexMatrixCaseResult['autoContinuation'] {
  return {
    schemaVersion: manifest.schemaVersion,
    checkedAt: manifest.checkedAt,
    status: manifest.status,
    evidenceMode: manifest.evidenceMode,
    continuation: manifest.continuation,
    issues: manifest.issues,
    requestSubmitted: manifest.requestSubmitted,
    liveAcceptanceCandidate: manifest.liveAcceptanceCandidate,
  };
}

function nonCompletedRetryReason(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): ComputerUseChatLiveComplexMatrixCaseRetryAttempt['reason'] | undefined {
  if (item.expectedStatus === 'completed') return undefined;
  const preflightRetryReason = casePreflightTransientBlockRetryReason(runManifest);
  if (preflightRetryReason) return preflightRetryReason;
  if (!runManifest.requestSubmitted) return undefined;
  if (!nonCompletedExpectedStateDriftIssues(item, runManifest).length) return undefined;
  return 'non-completed-expected-state-drift';
}

function completedRetryReason(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): ComputerUseChatLiveComplexMatrixCaseRetryAttempt['reason'] | undefined {
  if (item.expectedStatus !== 'completed') return undefined;
  const preflightRetryReason = casePreflightTransientBlockRetryReason(runManifest);
  if (preflightRetryReason) return preflightRetryReason;
  if (!runManifest.requestSubmitted) return undefined;
  if (expectedStateForRunManifest(runManifest) !== 'completed') return 'completed-expected-state-drift';
  if (completedCompletionEvidenceDriftIssues(item, runManifest).length) return 'completed-completion-evidence-drift';
  return undefined;
}

function casePreflightTransientBlockRetryReason(
  runManifest: ComputerUseChatLiveE2EManifest,
): ComputerUseChatLiveComplexMatrixCaseRetryAttempt['reason'] | undefined {
  if (runManifest.requestSubmitted) return undefined;
  if (runManifest.status !== 'blocked') return undefined;
  if (!runManifest.issues.includes('live-preflight-not-ready')) return undefined;
  return transientCasePreflightBlock(runManifest.preflight) ? 'case-preflight-transient-block' : undefined;
}

function transientCasePreflightBlock(
  preflight: ComputerUseChatLiveE2EManifest['preflight'],
): boolean {
  if (preflight.status === 'ready') return false;
  if (preflight.missingEnv.length > 0 || preflight.policyViolations.length > 0) return false;
  const failedServices = preflight.serviceChecks.filter((check) => check.status === 'fail');
  if (failedServices.some((check) => !transientCasePreflightDiagnostic(check.error))) return false;
  const runtimeProviderBlocked = preflight.runtimeProviderPreflight?.status === 'blocked';
  if (runtimeProviderBlocked && !transientRuntimeProviderCasePreflightBlock(preflight.runtimeProviderPreflight)) {
    return false;
  }
  return failedServices.length > 0 || runtimeProviderBlocked;
}

function transientRuntimeProviderCasePreflightBlock(
  preflight: ComputerUseChatLiveE2EManifest['preflight']['runtimeProviderPreflight'],
): boolean {
  if (!preflight || preflight.status !== 'blocked') return false;
  if (preflight.missingEnv.length > 0 || preflight.policyViolations.length > 0) return false;
  if (transientCasePreflightDiagnostic(preflight.readIssue)) return true;
  const httpStatus = preflight.checkedHealthz?.httpStatus;
  if (typeof httpStatus === 'number' && transientProviderHealthStatus(httpStatus)) return true;
  return transientCasePreflightDiagnostic(preflight.category);
}

function transientProviderHealthStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function transientCasePreflightDiagnostic(message: string | undefined): boolean {
  if (!message) return false;
  return /\b(?:AbortError|aborted|timeout|timed out|fetch failed|network|terminated|socket hang up|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|temporar(?:y|ily)|transient|unavailable|overloaded|rate[- ]?limited|upstream-outage)\b/i.test(message);
}

function completedCompletionEvidenceDriftIssues(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): string[] {
  const evidenceClassification = classifyMatrixRunEvidence(item, runManifest);
  const policyIssues = matrixPolicyIssues(item, runManifest, evidenceClassification);
  return uniqueStrings([
    runManifest.status !== 'completed' ? `completed-run-status-${runManifest.status}` : undefined,
    !evidenceClassification.canCompleteL3Workflow
      ? `matrix-completion-evidence-not-current-isolated-l3:${evidenceClassification.kind}`
      : undefined,
    (runManifest.packageBridgeCompletionGrade?.status ?? 'missing') !== 'attached'
      ? `package-bridge-completion-grade-${runManifest.packageBridgeCompletionGrade?.status ?? 'missing'}`
      : undefined,
    (runManifest.liveAcceptanceBundle?.status ?? 'missing') !== 'valid'
      ? `live-acceptance-bundle-${runManifest.liveAcceptanceBundle?.status ?? 'missing'}`
      : undefined,
    ...policyIssues,
    ...runManifest.issues.filter((issue) => (
      issue.startsWith('completion-grade:')
      || issue.includes('cu-user-acceptance-manifest')
      || issue.includes('isolated-desktop-l3-workflow-evidence')
      || issue.includes('current-run acceptance')
      || issue.startsWith('matrix-completion-evidence-not-current-isolated-l3:')
      || issue.startsWith('matrix-completed-from-diagnostic-harness:')
    )),
  ].filter((issue): issue is string => Boolean(issue)));
}

function nonCompletedExpectedStateDriftIssues(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): string[] {
  if (item.expectedStatus === 'completed') return [];
  const observed = expectedStateForRunManifest(runManifest);
  const issues = [
    observed !== item.expectedStatus ? `matrix-expected-${item.expectedStatus}-got-${observed}` : undefined,
    item.expectedStatus === 'needs-confirmation' && runManifest.confirmedRequestRefs.length
      ? 'matrix-needs-confirmation-unexpected-confirmed-request-ref'
      : undefined,
    item.expectedStatus === 'needs-confirmation' && runManifest.liveAcceptanceBundle?.status === 'valid'
      ? 'matrix-needs-confirmation-unexpected-completion-bundle'
      : undefined,
    item.expectedStatus === 'needs-confirmation' && runManifest.visibleStatus === 'output-materialized'
      ? 'matrix-needs-confirmation-output-materialized'
      : undefined,
    ...(
      item.expectedStatus === 'needs-confirmation'
        ? runManifest.issues
          .filter((issue) => issue.startsWith('needs-confirmation-'))
          .map((issue) => `matrix-needs-confirmation-evidence-drift:${issue}`)
        : []
    ),
  ].filter((issue): issue is string => Boolean(issue));
  return uniqueStrings(issues);
}

function expectedStateForRunManifest(
  runManifest: ComputerUseChatLiveE2EManifest,
): ComputerUseChatLiveE2EExpectedStatus | 'failed' {
  if (runManifest.status !== 'failed') {
    return runManifest.status === 'confirmed-approval-retry' ? 'completed' : runManifest.status;
  }
  if (runManifest.visibleStatus === 'output-materialized') return 'completed';
  if (runManifest.visibleStatus === 'repair-needed') return 'repair-needed';
  if (runManifest.visibleStatus === 'needs-confirmation' || runManifest.visibleStatus === 'needs-human') return 'needs-confirmation';
  if (runManifest.issues.some((issue) => issue.startsWith(`expected-${runManifest.expectedStatus}-got-`))) {
    const issue = runManifest.issues.find((item) => item.startsWith(`expected-${runManifest.expectedStatus}-got-`));
    const observed = issue?.replace(`expected-${runManifest.expectedStatus}-got-`, '');
    if (
      observed === 'completed'
      || observed === 'confirmed-approval-retry'
      || observed === 'needs-confirmation'
      || observed === 'repair-needed'
      || observed === 'blocked'
    ) {
      return observed === 'confirmed-approval-retry' ? 'completed' : observed;
    }
  }
  return 'failed';
}

function retryIsolationForAttempt(
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation,
  caseId: ComputerUseChatLiveComplexMatrixCaseId,
  attempt: number,
): ComputerUseChatLiveComplexMatrixCaseIsolation {
  const suffix = `retry-${attempt}`;
  return {
    ...isolation,
    currentTurnId: safeId(`${isolation.currentTurnId}-${suffix}`),
    cleanupManifestRef: cleanupManifestRefForCase(isolation.matrixRunId, caseId),
    cleanupStatus: 'planned',
    cleanupIssues: [],
  };
}

function retryPromptForExpectedStateGuard(input: {
  item: ComputerUseChatLiveComplexMatrixCase;
  attempt: number;
  maxAttempts: number;
  reason?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt['reason'];
  sourceRunManifest: ComputerUseChatLiveE2EManifest;
}): string {
  return [
    input.item.prompt,
    retryPromptObservationText(input),
    expectedStateGuardText(input.item.expectedStatus, input.item.evidenceRequirements),
    'Use only this retry current chat run and its current-run refs as evidence; do not reuse package-local, fixture, target-bound, readiness-only, DOM, Playwright, accessibility-tree, or shell-written evidence as success.',
  ].join(' ');
}

function retryPromptObservationText(input: {
  item: ComputerUseChatLiveComplexMatrixCase;
  attempt: number;
  maxAttempts: number;
  reason?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt['reason'];
  sourceRunManifest: ComputerUseChatLiveE2EManifest;
}): string {
  if (input.reason === 'case-preflight-transient-block') {
    return `Matrix bounded retry ${input.attempt}/${input.maxAttempts}: the previous case attempt was blocked before submission by a transient live preflight block instead of reaching expected ${input.item.expectedStatus}.`;
  }
  if (input.reason === 'completed-completion-evidence-drift') {
    return `Matrix bounded retry ${input.attempt}/${input.maxAttempts}: the previous current-chat run reached a completed visible state, but current-run completion-grade evidence was missing or invalid instead of proving expected ${input.item.expectedStatus}.`;
  }
  return `Matrix bounded retry ${input.attempt}/${input.maxAttempts}: the previous current-chat run observed ${expectedStateForRunManifest(input.sourceRunManifest)} instead of expected ${input.item.expectedStatus}.`;
}

function computerUseCommandPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (/^\/computer-use(?:\s|$)/i.test(trimmed)) return trimmed;
  return `/computer-use ${trimmed}`;
}

function expectedStateGuardText(
  expectedStatus: ComputerUseChatLiveE2EExpectedStatus,
  evidenceRequirements: string[],
): string {
  if (expectedStatus === 'needs-confirmation') {
    return [
      'Stop only at the high-risk confirmation boundary.',
      'Do not execute, send, upload, publish, delete, submit, share, or complete the external action.',
      'Do not return completed or output-materialized for a local report/export.',
      'Emit gui.ask_user plus approval-request.json, gui-ask-user.json, risk-audit.json, deniedExecuted=false, no confirmed-request.json, and current-run trace/run-task-chain refs.',
      `Expected evidence requirements: ${evidenceRequirements.join(', ')}.`,
    ].join(' ');
  }
  if (expectedStatus === 'repair-needed') {
    return [
      'Preserve the failure boundary and do not fabricate completion.',
      'Return repair-needed with blocked-manifest.json, repair-hint.json, continuation-request.json, run-task-chain refs, and current-run trace refs.',
      `Expected evidence requirements: ${evidenceRequirements.join(', ')}.`,
    ].join(' ');
  }
  if (expectedStatus === 'completed') {
    return [
      'Return completed only after the current SciForge chat run visibly materializes the requested local final artifact/report.',
      'The current run must include gui.present refs for that final artifact, current-run trace/run-task-chain/directory-listing refs, and canonical isolated L3 completion evidence plus cu-user-acceptance-manifest when the completion evidence producer is configured.',
      'Do not stop at needs-confirmation, ask for approval, or emit gui.ask_user unless the task itself requires a high-risk external action; these completed matrix cases require safe local artifact/report work.',
      `Expected evidence requirements: ${evidenceRequirements.join(', ')}.`,
    ].join(' ');
  }
  return `Return ${expectedStatus} only when that exact expected state is visible in current-run evidence.`;
}

export async function runComputerUseChatLiveComplexMatrixCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  if (args.aggregateFrom.length) {
    const manifest = await aggregateComputerUseChatLiveComplexMatrixManifests(args.aggregateFrom);
    const outputPath = args.out ? resolve(args.out) : undefined;
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    } else {
      process.stdout.write(`[${manifest.status}] Computer Use chat live complex matrix aggregate; cases=${manifest.cases.length}; issues=${manifest.issues.length}\n`);
      if (outputPath) process.stdout.write(`  manifest: ${outputPath}\n`);
      for (const result of manifest.cases) {
        process.stdout.write(`  - ${result.id}: ${result.status} evidence=${result.evidenceKind ?? 'missing'} source=${result.sourceManifestRef ?? 'missing'}\n`);
        for (const issue of result.issues) process.stdout.write(`    - ${issue}\n`);
      }
    }
    if (args.strict && manifest.status !== 'passed') process.exitCode = 1;
    return;
  }
  const manifest = await runComputerUseChatLiveComplexMatrix({
    caseIds: args.caseIds,
    out: args.out,
    workspacePath: args.workspace,
    workspaceWriterBaseUrl: args.workspaceWriterBaseUrl,
    requestTimeoutMs: args.timeoutMs,
    caseTimeoutMs: args.caseTimeoutMs,
    completionEvidenceProducerIds: args.completionEvidenceProducerIds,
    caseIsolationStrategy: args.caseIsolationStrategy,
  });
  if (args.out) {
    const outputPath = resolve(args.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write(`[${manifest.status}] Computer Use chat live complex matrix; cases=${manifest.cases.length}; submitted=${manifest.requestSubmitted}; issues=${manifest.issues.length}\n`);
    if (args.out) process.stdout.write(`  manifest: ${resolve(args.out)}\n`);
    for (const result of manifest.cases) {
      process.stdout.write(`  - ${result.id}: ${result.status} expected=${result.expectedStatus} evidence=${result.evidenceClassification.kind}\n`);
      for (const issue of result.issues) process.stdout.write(`    - ${issue}\n`);
    }
  }
  if (args.strict && manifest.status !== 'passed') process.exitCode = 1;
}

export async function aggregateComputerUseChatLiveComplexMatrixManifests(
  manifestRefs: string[],
  options: { now?: () => Date } = {},
): Promise<ComputerUseChatLiveComplexMatrixAggregateManifest> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const sourceEntries = await Promise.all(manifestRefs.map(async (ref) => ({
    ref,
    manifest: JSON.parse(await readFile(ref, 'utf8')) as ComputerUseChatLiveComplexMatrixManifest,
  })));
  const byCase = new Map<ComputerUseChatLiveComplexMatrixCaseId, ComputerUseChatLiveComplexMatrixAggregateCase>();
  for (const item of COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES) {
    const candidates = sourceEntries.flatMap((entry) => (
      (entry.manifest.cases ?? [])
        .filter((candidate) => candidate.id === item.id)
        .map((candidate) => aggregateCaseFromResult(item, candidate, entry.ref, entry.manifest.checkedAt))
    ));
    const selected = selectAggregateCase(candidates);
    byCase.set(item.id, selected ?? missingAggregateCase(item));
  }
  const cases = COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => byCase.get(item.id) ?? missingAggregateCase(item));
  const issues = uniqueStrings(cases.flatMap((item) => {
    if (item.status === 'passed') return [];
    return item.issues.length ? item.issues.map((issue) => `${item.id}:${issue}`) : [`${item.id}:missing-passed-live-manifest`];
  }));
  return sanitizeMatrixManifest({
    schemaVersion: COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_AGGREGATE_SCHEMA,
    checkedAt,
    status: issues.length === 0 ? 'passed' : 'failed',
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'split-live-manifest-aggregate',
    sourceManifestRefs: manifestRefs,
    cases,
    issues,
    completionPolicy: {
      ...completionPolicy(),
      aggregateRequiresEveryCasePassed: true,
    },
  });
}

function aggregateCaseFromResult(
  item: ComputerUseChatLiveComplexMatrixCase,
  result: ComputerUseChatLiveComplexMatrixCaseResult,
  sourceManifestRef: string,
  sourceCheckedAt: string,
): ComputerUseChatLiveComplexMatrixAggregateCase {
  const acceptanceIssues = aggregateCaseAcceptanceIssues({
    status: result.status,
    evidenceKind: result.evidenceClassification.kind,
  });
  const issues = uniqueStrings([...result.issues, ...acceptanceIssues]);
  const finalArtifactRefs = uniqueStrings([
    ...result.runManifest.artifactRefs,
    ...result.runManifest.displayedRefs,
  ].filter((ref) => finalArtifactLikeRef(ref)));
  const guiPresentRefs = uniqueStrings([
    ...result.runManifest.displayedRefs,
    ...result.runManifest.auditRefs.filter((ref) => /(?:^|\/)gui-present\.json$/i.test(ref)),
  ]);
  return {
    id: result.id,
    label: result.label,
    taskId: result.taskId,
    scenarioId: result.scenarioId,
    expectedStatus: result.expectedStatus,
    status: result.status === 'passed' && acceptanceIssues.length ? 'failed' : result.status,
    sourceManifestRef,
    sourceCheckedAt,
    evidenceKind: result.evidenceClassification.kind,
    liveAcceptanceCandidate: result.liveAcceptanceCandidate,
    requestSubmitted: result.requestSubmitted,
    issues,
    acceptanceRefs: {
      runDirRef: result.runManifest.liveAcceptanceBundle?.runDirRef,
      acceptanceManifestRef: result.runManifest.liveAcceptanceBundle?.acceptanceManifestRef,
      completionEvidenceRef: result.runManifest.liveAcceptanceBundle?.completionEvidenceRef,
      finalArtifactRefs,
      guiPresentRefs,
    },
    residualStabilityNotes: result.status === 'passed' && acceptanceIssues.length === 0
      ? []
      : [
        'This source manifest cannot prove the case; use a later passed split live manifest or rerun this case.',
      ],
    diagnosticBlockers: diagnosticBlockersForComplexMatrixAggregateCase({
      expectedStatus: result.expectedStatus,
      evidenceClassification: result.evidenceClassification,
      runManifest: result.runManifest,
      issues,
    }),
  };
}

function selectAggregateCase(
  candidates: ComputerUseChatLiveComplexMatrixAggregateCase[],
): ComputerUseChatLiveComplexMatrixAggregateCase | undefined {
  return [...candidates].sort((left, right) => aggregateCaseRank(right) - aggregateCaseRank(left))[0];
}

function aggregateCaseRank(item: ComputerUseChatLiveComplexMatrixAggregateCase): number {
  const passed = item.status === 'passed' ? 1_000_000 : 0;
  const currentRunL3 = item.evidenceKind === 'isolated-L3' ? 100_000 : 0;
  const submitted = item.requestSubmitted ? 10_000 : 0;
  return passed + currentRunL3 + submitted + Date.parse(item.sourceCheckedAt ?? '1970-01-01T00:00:00.000Z') / 1_000_000_000;
}

function aggregateCaseAcceptanceIssues(input: {
  status: ComputerUseChatLiveComplexMatrixAggregateCase['status'];
  evidenceKind?: CuNextEvidenceClassification['kind'] | string;
}): string[] {
  if (input.status !== 'passed') return [];
  return diagnosticMatrixEvidenceKind(input.evidenceKind)
    ? [`matrix-diagnostic-only-evidence-kind:${input.evidenceKind}`]
    : [];
}

function diagnosticMatrixEvidenceKind(kind: string | undefined): boolean {
  return kind === 'fixture' || kind === 'package-local' || kind === 'target-bound-real';
}

function missingAggregateCase(item: ComputerUseChatLiveComplexMatrixCase): ComputerUseChatLiveComplexMatrixAggregateCase {
  return {
    id: item.id,
    label: item.label,
    taskId: item.taskId,
    scenarioId: item.scenarioId,
    expectedStatus: item.expectedStatus,
    status: 'missing',
    liveAcceptanceCandidate: false,
    requestSubmitted: false,
    issues: ['missing-passed-live-manifest'],
    acceptanceRefs: {
      finalArtifactRefs: [],
      guiPresentRefs: [],
    },
    residualStabilityNotes: [
      'No source manifest in the aggregate input contained this case.',
    ],
    diagnosticBlockers: [],
  };
}

function matrixCaseResult(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation,
  autoContinuation?: ComputerUseChatLiveComplexMatrixCaseResult['autoContinuation'],
  retryAttempts?: ComputerUseChatLiveComplexMatrixCaseRetryAttempt[],
): ComputerUseChatLiveComplexMatrixCaseResult {
  const evidenceClassification = classifyMatrixRunEvidence(item, runManifest);
  const policyIssues = matrixPolicyIssues(item, runManifest, evidenceClassification);
  const completionEvidenceIssues = item.expectedStatus === 'completed'
    && runManifest.requestSubmitted
    && expectedStateForRunManifest(runManifest) === 'completed'
    ? completedCompletionEvidenceDriftIssues(item, runManifest)
    : [];
  const issues = uniqueStrings([...runManifest.issues, ...policyIssues, ...completionEvidenceIssues]);
  const expectedPassed = runManifest.status === item.expectedStatus && issues.length === 0;
  return {
    id: item.id,
    label: item.label,
    expectedStatus: item.expectedStatus,
    taskId: item.taskId,
    scenarioId: item.scenarioId,
    prompt: item.prompt,
    status: expectedPassed ? 'passed' : runManifest.requestSubmitted ? 'failed' : 'blocked',
    requestSubmitted: runManifest.requestSubmitted,
    liveAcceptanceCandidate: runManifest.liveAcceptanceCandidate,
    isolation,
    evidenceClassification,
    runManifest,
    autoContinuation,
    retryAttempts,
    issues,
  };
}

function classifyMatrixRunEvidence(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): CuNextEvidenceClassification {
  return classifyCuNextEvidence(matrixEvidenceClassificationInput(item, runManifest));
}

function matrixEvidenceClassificationInput(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): CuNextEvidenceClassificationInput {
  if (
    runManifest.liveAcceptanceBundle?.status === 'valid'
    && runManifest.packageBridgeCompletionGrade?.status === 'attached'
  ) {
    return {
      kind: 'isolated-L3',
      status: 'completed',
      acceptanceTier: 'l3-multi-app-workflow',
      targetEnvironmentKind: 'linux-isolated-desktop-session',
      completionEvidenceRef: runManifest.liveAcceptanceBundle.completionEvidenceRef,
      validatorAcceptedL3: true,
      userAcceptanceEligible: true,
      diagnosticOnly: false,
      realWindowEvidence: true,
      sameSession: true,
      sourceToWriterToPreviewCausality: true,
      l3Workflow: {
        completed: true,
        sameSession: true,
        sourceToWriterToPreviewCausality: true,
      },
      antiShortcutRejectedKinds: rejectedShortcutKinds(runManifest),
    };
  }
  const evidenceText = searchableEvidenceText(item, runManifest);
  return {
    kind: diagnosticEvidenceKind(evidenceText),
    status: runManifest.status === 'confirmed-approval-retry' ? 'completed' : runManifest.status,
    userAcceptanceEligible: false,
    diagnosticOnly: true,
    realWindowEvidence: false,
    antiShortcutRejectedKinds: rejectedShortcutKinds(runManifest),
  };
}

function matrixPolicyIssues(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
  evidenceClassification: CuNextEvidenceClassification,
): string[] {
  const issues: string[] = [];
  if (item.expectedStatus === 'completed' && !evidenceClassification.canCompleteL3Workflow) {
    issues.push(`matrix-completion-evidence-not-current-isolated-l3:${evidenceClassification.kind}`);
  }
  if (
    (runManifest.status === 'completed' || runManifest.status === 'confirmed-approval-retry' || runManifest.visibleStatus === 'output-materialized')
    && ['fixture', 'package-local', 'target-bound-real'].includes(evidenceClassification.kind)
  ) {
    issues.push(`matrix-completed-from-diagnostic-harness:${evidenceClassification.kind}`);
  }
  issues.push(...missingEvidenceRequirementRefIssues(item, runManifest));
  return uniqueStrings(issues);
}

function missingEvidenceRequirementRefIssues(
  item: ComputerUseChatLiveComplexMatrixCase,
  runManifest: ComputerUseChatLiveE2EManifest,
): string[] {
  if (runManifest.status !== item.expectedStatus) return [];
  const refs = complexMatrixEvidenceRefs(runManifest);
  return item.evidenceRequirements.flatMap((requirement) => {
    const patterns = evidenceRequirementRefPatterns(requirement);
    if (!patterns.length) return [];
    if (patterns.some((pattern) => refs.some((ref) => pattern.test(ref)))) return [];
    return [`matrix-missing-evidence-requirement-ref:${requirement}`];
  });
}

function complexMatrixEvidenceRefs(runManifest: ComputerUseChatLiveE2EManifest): string[] {
  return uniqueStrings([
    ...runManifest.displayedRefs,
    ...runManifest.artifactRefs,
    ...runManifest.auditRefs,
    ...runManifest.approvalRequestRefs,
    ...runManifest.guiAskUserRecordRefs,
    ...runManifest.riskAuditRefs,
    ...runManifest.confirmedRequestRefs,
    ...runManifest.approvalDecisionRefs,
    ...runManifest.sourceApprovalRequestRefs,
    ...runManifest.sourceGuiAskUserRecordRefs,
    ...runManifest.sourceRiskAuditRefs,
    ...(runManifest.deniedExecutionProof?.refs ?? []),
    ...runManifest.failureDiagnostics.flatMap((diagnostic) => diagnostic.refs),
    ...(runManifest.packageBridgeCompletionGrade?.diagnosticRefs ?? []),
    ...(runManifest.packageBridgeCompletionGrade?.acceptanceManifestRefs ?? []),
    ...(runManifest.packageBridgeCompletionGrade?.acceptanceInputRefs ?? []),
    ...(runManifest.packageBridgeCompletionGrade?.completionEvidenceRefs ?? []),
    ...(runManifest.packageBridgeCompletionGrade?.producerDiagnosticRefs ?? []),
    runManifest.liveAcceptanceBundle?.runDirRef,
    runManifest.liveAcceptanceBundle?.acceptanceManifestRef,
    runManifest.liveAcceptanceBundle?.completionEvidenceRef,
    runManifest.productStrict?.acceptanceManifestRef,
  ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0));
}

export function evidenceRequirementRefPatterns(requirement: string): RegExp[] {
  switch (requirement) {
    case 'browser-research':
      return [/(?:^|\/)(?:browser|web|source|research)[^/]*\.(?:json|md|txt)$/i];
    case 'local-report':
      return [/(?:^|\/)(?:local-)?(?:report|briefing|analysis)[^/]*\.(?:md|txt|json)$/i];
    case 'source-ref-causality':
    case 'source-to-table-to-report-causality':
    case 'cross-app-causality':
      return [/(?:^|\/)(?:source|causality|run-task-chain)[^/]*\.(?:json|md)$/i];
    case 'csv-or-table-source':
      return [/(?:^|\/)(?:csv|table|spreadsheet)[^/]*\.(?:csv|json|md)$/i];
    case 'file-artifact-validator-refs':
    case 'artifact-validator-refs':
    case 'artifact-validation':
      return [/(?:^|\/)(?:artifact-)?validator[^/]*\.json$/i, /(?:^|\/)validation[^/]*\.json$/i];
    case 'browser-form-draft':
      return [/(?:^|\/)(?:browser-)?(?:form|draft)[^/]*\.(?:json|md|txt)$/i];
    case 'hard-confirm-submit':
    case 'hard-confirm':
    case 'approval-request':
    case 'approval-sidecars':
    case 'current-action-type-turn-authorization':
    case 'cancel-no-execution':
    case 'confirm-current-action-type-turn-only':
      return [/(?:^|\/)(?:approval-request|gui-ask-user|risk-audit|approval-decision|confirmed-request)[^/]*\.json$/i];
    case 'gui.ask_user':
      return [/(?:^|\/)gui-ask-user[^/]*\.json$/i];
    case 'risk-audit':
    case 'deniedExecuted=false':
      return [/(?:^|\/)(?:risk-audit|approval-request|gui-ask-user)[^/]*\.json$/i];
    case 'file-manager-evidence':
      return [/(?:^|\/)(?:file-manager|finder|files?)[^/]*\.(?:json|png|md)$/i];
    case 'directory-listing-refs':
    case 'file-list-evidence':
      return [/(?:^|\/)(?:directory-listing|file-list)[^/]*\.json$/i];
    case 'file-organization-evidence':
      return [/(?:^|\/)(?:file-organization|organization-index|file-index|index)[^/]*\.(?:json|md|txt)$/i];
    case 'explicit-terminal-workflow':
    case 'terminal-evidence':
      return [/(?:^|\/)terminal[^/]*\.(?:json|md|txt|log)$/i];
    case 'notebook-workflow':
      return [/(?:^|\/)notebook[^/]*\.(?:ipynb|json|md|txt)$/i];
    case 'browser-source-reader':
      return [/(?:^|\/)(?:browser-source-reader|source-reader|browser-source)[^/]*\.(?:json|md|txt)$/i];
    case 'editor-evidence':
      return [/(?:^|\/)editor[^/]*\.(?:json|md|txt|png)$/i];
    case 'file-preview-evidence':
      return [/(?:^|\/)(?:file-preview|preview)[^/]*\.(?:json|md|txt|png)$/i];
    case 'viewport-recovery':
      return [/(?:^|\/)viewport-recovery[^/]*\.json$/i];
    case 'scroll-evidence':
      return [/(?:^|\/)scroll[^/]*\.(?:json|png)$/i];
    case 'viewport-state-refs':
      return [/(?:^|\/)viewport-state[^/]*\.json$/i];
    case 'fresh-observation':
    case 'fresh-re-observation':
      return [/(?:^|\/)(?:(?:fresh-)?re-?observation|vision-trace)[^/]*\.(?:json|png)$/i];
    case 'blocked-repair-manifest':
    case 'blocked-target-manifest':
      return [/(?:^|\/)blocked-(?:repair-)?manifest[^/]*\.json$/i];
    case 'repair-hint':
      return [/(?:^|\/)repair-hint[^/]*\.json$/i];
    case 'continuation-request':
      return [/(?:^|\/)continuation-request[^/]*\.json$/i];
    case 'run-task-chain':
      return [/(?:^|\/)(?:tui-host-)?run-task-chain[^/]*\.json$/i];
    case 'focus-crops':
      return [/(?:^|\/)(?:focus-)?crop[^/]*\.(?:json|png)$/i];
    case 'ocr-refs':
      return [/(?:^|\/)ocr[^/]*\.(?:json|txt|md|png)$/i];
    case 'vision-translator-refs':
      return [/(?:^|\/)vision-translator[^/]*\.json$/i];
    case 'ambiguous-target-blocked':
      return [/(?:^|\/)(?:ambiguous-target|target-ambiguity|dense-grounding-rejections)[^/]*\.json$/i];
    case 'dense-grounding-rejections':
      return [/(?:^|\/)dense-grounding-rejections\.json$/i];
    default:
      return [];
  }
}

function blockedCase(
  item: ComputerUseChatLiveComplexMatrixCase,
  checkedAt: string,
  preflight: ComputerUseChatLivePreflightManifest,
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation,
): ComputerUseChatLiveComplexMatrixCaseResult {
  const runManifest: ComputerUseChatLiveE2EManifest = {
    schemaVersion: 'sciforge.computer-use.chat-live-e2e.v1',
    checkedAt,
    status: 'blocked',
    expectedStatus: item.expectedStatus,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-chat-run-only',
    preflight: preflightSummary(preflight),
    prompt: item.prompt,
    eventTypes: [],
    eventSummaries: [],
    displayedRefs: [],
    artifactRefs: [],
    auditRefs: [],
    approvalRequestRefs: [],
    guiAskUserRecordRefs: [],
    riskAuditRefs: [],
    confirmedRequestRefs: [],
    approvalDecisionRefs: [],
    sourceApprovalRequestRefs: [],
    sourceGuiAskUserRecordRefs: [],
    sourceRiskAuditRefs: [],
    evidenceReadIssues: [],
    recoverActions: [],
    failureDiagnostics: [],
    issues: ['live-preflight-not-ready'],
    requestSubmitted: false,
    liveAcceptanceCandidate: false,
  };
  return {
    id: item.id,
    label: item.label,
    expectedStatus: item.expectedStatus,
    taskId: item.taskId,
    scenarioId: item.scenarioId,
    prompt: item.prompt,
    status: 'blocked',
    requestSubmitted: false,
    liveAcceptanceCandidate: false,
    isolation: {
      ...isolation,
      cleanupStatus: 'inline-only',
    },
    evidenceClassification: classifyCuNextEvidence({ kind: 'package-local', status: 'blocked', diagnosticOnly: true }),
    runManifest,
    issues: ['live-preflight-not-ready'],
  };
}

function failedCaseRunManifest(
  item: ComputerUseChatLiveComplexMatrixCase,
  checkedAt: string,
  preflight: ComputerUseChatLivePreflightManifest,
  error: unknown,
): ComputerUseChatLiveE2EManifest {
  const message = sanitizeDiagnosticText(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-e2e.v1',
    checkedAt,
    status: 'failed',
    expectedStatus: item.expectedStatus,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'current-chat-run-only',
    preflight: preflightSummary(preflight),
    prompt: item.prompt,
    eventTypes: [],
    eventSummaries: [{
      type: 'computer-use.chat-live-complex-matrix.case-error',
      status: 'failed',
      detailExcerpt: message.slice(0, 240),
    }],
    displayedRefs: [],
    artifactRefs: [],
    auditRefs: [],
    approvalRequestRefs: [],
    guiAskUserRecordRefs: [],
    riskAuditRefs: [],
    confirmedRequestRefs: [],
    approvalDecisionRefs: [],
    sourceApprovalRequestRefs: [],
    sourceGuiAskUserRecordRefs: [],
    sourceRiskAuditRefs: [],
    evidenceReadIssues: [],
    recoverActions: [
      'Rerun this case after checking the live workspace writer/runtime stream health.',
      'Inspect service logs if the error is a stream termination or socket close.',
    ],
    failureDiagnostics: [{
      kind: 'canonical-l3-blocked',
      summary: `Live complex matrix case threw before producing a completed manifest: ${message}`,
      refs: [],
      recoverActions: [
        'Rerun the current case with the same request-scoped completion evidence producer enabled.',
        'Keep this case failed rather than reusing old evidence or package-local fixtures.',
      ],
    }],
    issues: [`matrix-case-run-error:${message}`],
    requestSubmitted: true,
    liveAcceptanceCandidate: false,
  };
}

function matrixRunIdForOptions(
  options: ComputerUseChatLiveComplexMatrixOptions,
  checkedAt: string,
): string {
  return safeId(options.sessionId ?? `computer-use-chat-live-complex-matrix-${checkedAt}`);
}

function caseIsolationContext(input: {
  item: ComputerUseChatLiveComplexMatrixCase;
  caseIndex: number;
  matrixRunId: string;
  options: ComputerUseChatLiveComplexMatrixOptions;
  caseIsolationPlan?: ComputerUseChatLiveCaseIsolationSeedPlan;
}): ComputerUseChatLiveComplexMatrixCaseIsolation {
  const planCase = input.caseIsolationPlan?.cases[input.caseIndex];
  const caseRunId = safeId(`${input.matrixRunId}-${String(input.caseIndex + 1).padStart(2, '0')}-${input.item.id}`);
  const currentTurnBase = input.options.currentTurnId
    ? safeId(`${input.options.currentTurnId}-${input.item.id}`)
    : caseRunId;
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-isolation.v1',
    matrixRunId: input.matrixRunId,
    caseRunId: planCase?.caseRunId ?? caseRunId,
    caseIndex: input.caseIndex,
    sessionId: planCase?.sessionId ?? caseRunId,
    currentTurnId: planCase?.currentTurnId ?? currentTurnBase,
    workspaceSeed: {
      kind: planCase?.workspace.kind ?? 'shared-workspace-case-seed',
      seed: planCase?.caseRunId ?? caseRunId,
      workspacePathConfigured: Boolean(planCase?.workspace.caseWorkspacePath ?? workspacePathForOptions(input.options)),
      caseWorkspacePath: planCase?.workspace.caseWorkspacePath,
    },
    resetManifestRef: planCase?.workspace.resetManifestRef,
    resetStatus: planCase ? 'not-enabled' : 'not-enabled',
    resetIssues: [],
    cleanupManifestRef: cleanupManifestRefForCase(input.matrixRunId, input.item.id),
    cleanupStatus: 'planned',
    cleanupIssues: [],
  };
}

async function buildOptionalCaseIsolationPlan(input: {
  matrixRunId: string;
  cases: ComputerUseChatLiveComplexMatrixCase[];
  options: ComputerUseChatLiveComplexMatrixOptions;
  now: () => Date;
}): Promise<ComputerUseChatLiveCaseIsolationSeedPlan | undefined> {
  if (!input.options.caseIsolationStrategy) return undefined;
  const baseWorkspacePath = workspacePathForOptions(input.options);
  if (!baseWorkspacePath) {
    throw new Error(`--case-isolation ${input.options.caseIsolationStrategy} requires --workspace PATH or SCIFORGE_WORKSPACE_PATH; refusing to run without per-case workspace forks.`);
  }
  return buildComputerUseChatLiveCaseIsolationSeedPlan({
    matrixRunId: input.matrixRunId,
    baseWorkspacePath,
    strategy: input.options.caseIsolationStrategy,
    materialize: true,
    now: input.now,
    cases: input.cases.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      scenarioId: item.scenarioId,
      expectedStatus: item.expectedStatus,
    })),
  });
}

function caseIsolationPlanSummary(
  plan: ComputerUseChatLiveCaseIsolationSeedPlan | undefined,
): ComputerUseChatLiveComplexMatrixManifest['caseIsolationPlan'] {
  if (!plan) return undefined;
  return {
    schemaVersion: plan.schemaVersion,
    checkedAt: plan.checkedAt,
    matrixRunId: plan.matrixRunId,
    strategy: plan.strategy,
    baseWorkspacePath: plan.baseWorkspacePath,
    resetManifestSchemaVersion: plan.resetManifestSchemaVersion,
    runnerIntegration: plan.runnerIntegration,
    issues: plan.issues,
    cases: plan.cases.map((item) => ({
      id: item.id,
      caseRunId: item.caseRunId,
      sessionId: item.sessionId,
      currentTurnId: item.currentTurnId,
      workspace: item.workspace,
      isolationContract: item.isolationContract,
    })),
  };
}

function caseRunOptions(
  options: ComputerUseChatLiveComplexMatrixOptions,
  planCase: ComputerUseChatLiveCaseIsolationSeedPlanCase | undefined,
): ComputerUseChatLiveComplexMatrixOptions {
  if (!planCase) return options;
  return {
    ...options,
    ...e2eOptionsForCaseIsolationPlanCase(planCase, options.env ?? process.env),
  };
}

function matrixCaseTimeoutMs(
  options: ComputerUseChatLiveComplexMatrixOptions,
  env: NodeJS.ProcessEnv,
): number {
  const explicitTimeout = positiveIntegerValue(options.caseTimeoutMs)
    ?? positiveIntegerValue(env.SCIFORGE_COMPUTER_USE_CHAT_LIVE_MATRIX_CASE_TIMEOUT_MS);
  if (explicitTimeout) return explicitTimeout;
  const requestTimeoutMs = positiveIntegerValue(options.requestTimeoutMs)
    ?? positiveIntegerValue(env.SCIFORGE_COMPUTER_USE_CHAT_E2E_TIMEOUT_MS)
    ?? 180_000;
  return Math.max(
    DEFAULT_COMPLEX_MATRIX_CASE_TIMEOUT_MS,
    Math.min(MAX_DEFAULT_COMPLEX_MATRIX_CASE_TIMEOUT_MS, requestTimeoutMs * 2),
  );
}

function matrixProgressManifestWriter(out: string | undefined): (manifest: ComputerUseChatLiveComplexMatrixManifest) => Promise<void> {
  if (!out) return async () => undefined;
  const outputPath = resolve(out);
  return async (manifest) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  };
}

async function writeCaseIsolationResetManifest(input: {
  item: ComputerUseChatLiveComplexMatrixCase;
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation;
  caseIsolationPlan?: ComputerUseChatLiveCaseIsolationSeedPlan;
  previousManifests: ComputerUseChatLiveCaseIsolationResetManifest[];
  now: () => Date;
}): Promise<{
  isolation: ComputerUseChatLiveComplexMatrixCaseIsolation;
  manifest?: ComputerUseChatLiveCaseIsolationResetManifest;
}> {
  if (!input.caseIsolationPlan) {
    return {
      isolation: {
        ...input.isolation,
        resetStatus: 'not-enabled',
      },
    };
  }
  const planCase = input.caseIsolationPlan.cases.find((item) => item.id === input.item.id);
  if (!planCase) {
    return {
      isolation: {
        ...input.isolation,
        resetStatus: 'failed',
        resetIssues: [`case-not-in-isolation-plan:${input.item.id}`],
      },
    };
  }
  const manifest = buildComputerUseChatLiveCaseIsolationResetManifest({
    plan: input.caseIsolationPlan,
    caseId: input.item.id,
    previousManifests: input.previousManifests,
    now: input.now,
    observed: {
      workspacePath: planCase.workspace.caseWorkspacePath,
      sessionId: planCase.sessionId,
      currentTurnId: planCase.currentTurnId,
      windowState: {
        scopeId: planCase.isolationContract.windowStateScopeId,
        refs: [],
        priorCaseMarkers: [],
      },
      tempFiles: {
        rootRef: planCase.workspace.tempRootRef,
        refs: [],
      },
      plannerMemory: {
        scopeId: planCase.isolationContract.plannerMemoryScopeId,
        refs: [],
        priorCaseMarkers: [],
      },
    },
  });
  try {
    await writeComputerUseChatLiveCaseIsolationResetManifest({ manifest });
  } catch (error) {
    const message = sanitizeDiagnosticText(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return {
      isolation: {
        ...input.isolation,
        resetManifestRef: planCase.workspace.resetManifestRef,
        resetStatus: 'write-failed',
        resetIssues: [`case-isolation-reset-write-failed:${message}`],
      },
      manifest: {
        ...manifest,
        status: 'failed',
        issues: uniqueStrings([...manifest.issues, `case-isolation-reset-write-failed:${message}`]),
      },
    };
  }
  return {
    isolation: {
      ...input.isolation,
      resetManifestRef: planCase.workspace.resetManifestRef,
      resetStatus: manifest.status,
      resetIssues: manifest.issues,
    },
    manifest,
  };
}

async function resultWithCleanupManifest(
  result: ComputerUseChatLiveComplexMatrixCaseResult,
  options: ComputerUseChatLiveComplexMatrixOptions,
  now: () => Date,
): Promise<ComputerUseChatLiveComplexMatrixCaseResult> {
  const cleanup = cleanupManifestForCase(result, now().toISOString());
  const workspacePath = workspacePathForOptions(options);
  if (!workspacePath || !result.isolation.cleanupManifestRef) {
    return {
      ...result,
      isolation: {
        ...result.isolation,
        cleanupStatus: 'inline-only',
        cleanupIssues: uniqueStrings([
          ...result.isolation.cleanupIssues,
          !workspacePath ? 'cleanup-manifest-not-written:no-workspace-path' : '',
        ]),
      },
    };
  }
  try {
    const outputPath = resolve(workspacePath, result.isolation.cleanupManifestRef);
    const workspaceRoot = resolve(workspacePath);
    if (!outputPath.startsWith(`${workspaceRoot}${sep}`)) {
      throw new Error('cleanup manifest ref escapes workspace');
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(sanitizeMatrixManifest(cleanup), null, 2)}\n`);
    return {
      ...result,
      isolation: {
        ...result.isolation,
        cleanupStatus: 'recorded',
        cleanupIssues: result.isolation.cleanupIssues,
      },
    };
  } catch (error) {
    const message = sanitizeDiagnosticText(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return {
      ...result,
      isolation: {
        ...result.isolation,
        cleanupStatus: 'write-failed',
        cleanupIssues: uniqueStrings([...result.isolation.cleanupIssues, `cleanup-manifest-write-failed:${message}`]),
      },
      issues: uniqueStrings([...result.issues, `case-cleanup-manifest-write-failed:${message}`]),
    };
  }
}

function cleanupManifestForCase(
  result: ComputerUseChatLiveComplexMatrixCaseResult,
  checkedAt: string,
): ComputerUseChatLiveComplexMatrixCleanupManifest {
  const runDirRefs = runDirRefsForManifest(result.runManifest);
  const finalArtifactRefs = uniqueStrings([
    ...result.runManifest.artifactRefs,
    ...result.runManifest.displayedRefs,
  ].filter((ref) => finalArtifactLikeRef(ref)));
  const guiReceiptRefs = uniqueStrings([
    ...result.runManifest.displayedRefs,
    ...result.runManifest.auditRefs.filter((ref) => /(?:^|\/)gui-(?:present|ask-user)\.json$/i.test(ref)),
    ...result.runManifest.guiAskUserRecordRefs,
  ]);
  const producerDiagnosticRefs = result.runManifest.packageBridgeCompletionGrade?.producerDiagnosticRefs ?? [];
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-complex-matrix.case-cleanup.v1',
    checkedAt,
    matrixRunId: result.isolation.matrixRunId,
    caseRunId: result.isolation.caseRunId,
    caseId: result.id,
    status: result.status,
    sessionId: result.isolation.sessionId,
    currentTurnId: result.isolation.currentTurnId,
    workspaceSeed: result.isolation.workspaceSeed,
    runDirRefs,
    finalArtifactRefs,
    guiReceiptRefs,
    acceptanceRefs: {
      runDirRef: result.runManifest.liveAcceptanceBundle?.runDirRef,
      acceptanceManifestRef: result.runManifest.liveAcceptanceBundle?.acceptanceManifestRef,
      completionEvidenceRef: result.runManifest.liveAcceptanceBundle?.completionEvidenceRef,
      producerDiagnosticRefs,
    },
    resourceReleaseChecks: resourceReleaseChecksForCase({
      result,
      runDirRefs,
      guiReceiptRefs,
      producerDiagnosticRefs,
    }),
    residualIssues: result.issues,
  };
}

function resourceReleaseChecksForCase(input: {
  result: ComputerUseChatLiveComplexMatrixCaseResult;
  runDirRefs: string[];
  guiReceiptRefs: string[];
  producerDiagnosticRefs: string[];
}): ComputerUseChatLiveComplexMatrixCleanupManifest['resourceReleaseChecks'] {
  return [
    {
      kind: 'workspace-seed',
      status: 'recorded',
      ref: input.result.isolation.workspaceSeed.seed,
      note: 'Matrix runner assigned a case-scoped session/current-turn seed so planner state can be audited per case.',
    },
    ...input.runDirRefs.map((ref) => ({
      kind: 'run-dir' as const,
      status: 'recorded' as const,
      ref,
      note: 'Current-run evidence directory is tracked for post-run retention or cleanup review.',
    })),
    {
      kind: 'gui-receipt',
      status: input.guiReceiptRefs.length ? 'recorded' : 'not-applicable',
      ref: input.guiReceiptRefs[0],
      note: input.guiReceiptRefs.length
        ? 'GUI receipt refs were captured for this case.'
        : 'No GUI receipt was expected or captured for this case.',
    },
    {
      kind: 'l3-producer',
      status: input.producerDiagnosticRefs.length ? 'recorded' : 'not-applicable',
      ref: input.producerDiagnosticRefs[0],
      note: input.producerDiagnosticRefs.length
        ? 'Embedded L3 producer diagnostics are linked for resource/timeout review.'
        : 'No embedded L3 producer diagnostics were emitted for this case.',
    },
    {
      kind: 'timeout',
      status: input.result.runManifest.issues.some((issue) => /timeout|terminated|abort/i.test(issue)) ? 'needs-review' : 'recorded',
      note: 'Timeout and stream termination signals remain in case issues/failure diagnostics when present.',
    },
  ];
}

function workspacePathForOptions(options: ComputerUseChatLiveComplexMatrixOptions): string | undefined {
  if (options.workspacePath !== undefined) return nonEmptyOptionValue(options.workspacePath);
  if (options.env && Object.prototype.hasOwnProperty.call(options.env, 'SCIFORGE_WORKSPACE_PATH')) {
    return nonEmptyOptionValue(options.env.SCIFORGE_WORKSPACE_PATH);
  }
  return nonEmptyOptionValue(process.env.SCIFORGE_WORKSPACE_PATH);
}

function nonEmptyOptionValue(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function cleanupManifestRefForCase(
  matrixRunId: string,
  caseId: ComputerUseChatLiveComplexMatrixCaseId,
): string {
  return `.sciforge/vision-runs/computer-use-chat-live-complex-matrix/${safeId(matrixRunId)}/${caseId}/case-cleanup-manifest.json`;
}

function retryCleanupManifestRefForCase(
  matrixRunId: string,
  caseId: ComputerUseChatLiveComplexMatrixCaseId,
  attempt: number,
): string {
  return `.sciforge/vision-runs/computer-use-chat-live-complex-matrix/${safeId(matrixRunId)}/${caseId}/retry-${attempt}-cleanup-manifest.json`;
}

function runDirRefsForManifest(runManifest: ComputerUseChatLiveE2EManifest): string[] {
  return uniqueStrings([
    runManifest.liveAcceptanceBundle?.runDirRef ?? '',
    ...[
      ...runManifest.displayedRefs,
      ...runManifest.artifactRefs,
      ...runManifest.auditRefs,
      ...runManifest.approvalRequestRefs,
      ...runManifest.guiAskUserRecordRefs,
      ...runManifest.riskAuditRefs,
      ...runManifest.confirmedRequestRefs,
      ...runManifest.approvalDecisionRefs,
    ].map((ref) => runDirRefFromWorkspaceRef(ref)),
  ].filter((ref): ref is string => Boolean(ref)));
}

function runDirRefFromWorkspaceRef(ref: string): string | undefined {
  const match = ref.match(/^(.*?\.sciforge\/vision-runs\/[^/]+)(?:\/|$)/);
  return match?.[1];
}

function finalArtifactLikeRef(ref: string): boolean {
  return /(?:^|\/)[^/]*(?:report|index|brief|analysis|summary|artifact|export)[^/]*\.(?:md|csv|txt|docx?|pptx?|pdf|xlsx?)$/i.test(ref);
}

function safeId(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'computer-use-chat-live-complex-matrix';
}

function selectedCases(caseIds: ComputerUseChatLiveComplexMatrixCaseId[] | undefined): ComputerUseChatLiveComplexMatrixCase[] {
  if (!caseIds?.length) return COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES;
  const byId = new Map(COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.map((item) => [item.id, item]));
  return caseIds.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown complex matrix case: ${id}`);
    return item;
  });
}

function diagnosticEvidenceKind(text: string): CuNextEvidenceClassificationInput['kind'] {
  if (/\bfixture\b|test-action-fixture|fixtures?\//i.test(text)) return 'fixture';
  if (/package[- ]local|package-owned|package harness|package-level/i.test(text)) return 'package-local';
  if (/target[- ]bound/i.test(text)) return 'target-bound-real';
  return 'package-local';
}

function rejectedShortcutKinds(runManifest: ComputerUseChatLiveE2EManifest): string[] {
  const text = searchableEvidenceText(undefined, runManifest).toLowerCase();
  return uniqueStrings([
    text.includes('dom') ? 'dom' : '',
    text.includes('playwright') ? 'playwright' : '',
    text.includes('accessibility') || text.includes('accessibility-tree') ? 'accessibility' : '',
    text.includes('generated-file-only') || text.includes('shell-written') ? 'generated-file-only' : '',
    text.includes('api-created-artifact') ? 'api-created-artifact' : '',
  ]);
}

function searchableEvidenceText(
  item: ComputerUseChatLiveComplexMatrixCase | undefined,
  runManifest: ComputerUseChatLiveE2EManifest,
): string {
  return JSON.stringify({
    caseId: item?.id,
    refs: [
      ...runManifest.displayedRefs,
      ...runManifest.artifactRefs,
      ...runManifest.auditRefs,
      ...runManifest.approvalRequestRefs,
      ...runManifest.guiAskUserRecordRefs,
      ...runManifest.riskAuditRefs,
    ],
    messageExcerpt: runManifest.messageExcerpt,
    eventSummaries: runManifest.eventSummaries,
    liveAcceptanceBundle: runManifest.liveAcceptanceBundle,
    issues: runManifest.issues,
  });
}

function preflightSummary(preflight: ComputerUseChatLivePreflightManifest): ComputerUseChatLiveComplexMatrixManifest['preflight'] {
  return {
    schemaVersion: preflight.schemaVersion,
    status: preflight.status,
    missingEnv: preflight.missingEnv,
    policyViolations: preflight.policyViolations,
    serviceChecks: preflight.serviceChecks,
  };
}

function completionPolicy(): ComputerUseChatLiveComplexMatrixManifest['completionPolicy'] {
  return {
    fixturePackageLocalHarnessCompletesProjectTasks: false,
    completionRequiresCurrentChatRunIsolatedL3Bundle: true,
  };
}

function sanitizeMatrixManifest<T>(manifest: T): T {
  return sanitizeUnknown(manifest) as T;
}

function sanitizeUnknown(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return sensitiveManifestStringKey(key) ? '[redacted]' : sanitizeDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, entry]) => [childKey, sanitizeUnknown(entry, childKey)]));
}

function sensitiveManifestStringKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return new Set([
    'model',
    'modelid',
    'modelname',
    'provider',
    'providerid',
    'providername',
    'runtimeprovider',
    'runtimeproviderid',
    'runtimeprovidername',
  ]).has(normalized);
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\b(?:authorization|token|apiKey|api_key|api-key|secret|password|credential|model|modelName|model_name|model-id|modelId|provider|providerName|provider_name|provider-id|providerId)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[redacted]')
    .replace(/https?:\/\/[^/@\s]+:[^/@\s]+@/gi, (match) => match.replace(/\/\/.*@/, '//[redacted]@'))
    .replace(/https?:\/\/(?!(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$))[^"'\s,;]+/gi, '[redacted-url]');
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { strict: false, json: false, completionEvidenceProducerIds: [], aggregateFrom: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--strict') parsed.strict = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--out') parsed.out = readArgValue(args, index += 1, arg);
    else if (arg === '--workspace') parsed.workspace = readArgValue(args, index += 1, arg);
    else if (arg === '--workspace-writer-base-url') parsed.workspaceWriterBaseUrl = readArgValue(args, index += 1, arg);
    else if (arg === '--timeout-ms') parsed.timeoutMs = parsePositiveInteger(readArgValue(args, index += 1, arg), arg);
    else if (arg === '--case-timeout-ms') parsed.caseTimeoutMs = parsePositiveInteger(readArgValue(args, index += 1, arg), arg);
    else if (arg === '--completion-evidence-producer') parsed.completionEvidenceProducerIds.push(readArgValue(args, index += 1, arg));
    else if (arg === '--aggregate-from') parsed.aggregateFrom.push(readArgValue(args, index += 1, arg));
    else if (arg === '--case-isolation') parsed.caseIsolationStrategy = parseCaseIsolationStrategy(readArgValue(args, index += 1, arg));
    else if (arg === '--case') parsed.caseIds = [...(parsed.caseIds ?? []), parseCaseId(readArgValue(args, index += 1, arg))];
    else if (arg === '--cases') parsed.caseIds = [
      ...(parsed.caseIds ?? []),
      ...readArgValue(args, index += 1, arg).split(',').map((value) => parseCaseId(value.trim())),
    ];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseCaseIsolationStrategy(value: string): ComputerUseChatLiveCaseIsolationStrategy {
  if (value === 'per-case-workspace-fork' || value === 'resettable-workspace-fixture') return value;
  throw new Error(`Unsupported case isolation strategy: ${value}`);
}

function parseCaseId(value: string): ComputerUseChatLiveComplexMatrixCaseId {
  if (COMPUTER_USE_CHAT_LIVE_COMPLEX_MATRIX_CASES.some((item) => item.id === value)) {
    return value as ComputerUseChatLiveComplexMatrixCaseId;
  }
  throw new Error(`Unsupported complex matrix case id: ${value}`);
}

function readArgValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} requires a positive integer.`);
  return parsed;
}

function positiveIntegerValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

if (process.argv[1]?.endsWith('computer-use-chat-live-complex-matrix.ts')) {
  await runComputerUseChatLiveComplexMatrixCli();
}
