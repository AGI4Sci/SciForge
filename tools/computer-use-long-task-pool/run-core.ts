import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type {
  ComputerUseLongRepairDiagnostics,
  ComputerUseLongRoundRunResult,
  ComputerUseLongRunValidation,
  ComputerUseLongScenarioRunResult,
  ComputerUseLongTraceValidation,
  PreparedComputerUseLongRun,
} from './contracts.js';
import { allowedActionTypes, requiredTraceMetadata } from './contracts.js';
import { loadComputerUseLongTaskPool } from './task-pool.js';
import { validateComputerUseLongTrace } from './trace-contract.js';
import {
  validateCuNextNeedsConfirmationSidecars,
  canonicalApprovalRefFromConfirmedSidecar,
} from '../computer-use-next/approval-chain.js';
import {
  defaultWindowTargetForRound,
  collectRefsFirstManifestPayloadIssues,
  findPayloadTraceRef,
  firstString,
  isBrowserWindowTarget,
  isRealGuiTrace,
  isRecord,
  manifestRel,
  missingEvidenceRefsFromIssues,
  minimumAcceptanceCount,
  readOptionalJson,
  readOptionalText,
  repairActionsForIssues,
  renderActionLedger,
  renderFailureDiagnostics,
  renderRoundRuntimePrompt,
  renderScenarioSummary,
  resolveManifestRef,
  resolveTraceArtifactPath,
  resolveTraceRefPath,
  scenarioExpectsBrowserTarget,
  screenshotRefsFromTrace,
  traceWindowTargetFromTrace,
  validatePngRef,
  sanitizeRunId,
  withTaskPoolHardTimeout,
} from './support.js';

export const CU_LONG_DEFAULT_DRY_RUN_ROUND_TIMEOUT_MS = 120_000;
export const CU_LONG_MIN_REAL_ROUND_TIMEOUT_MS = 240_000;
export const CU_LONG_DEFAULT_PLANNER_TIMEOUT_MS = 120_000;
export const CU_LONG_DEFAULT_REAL_MAX_STEPS = 8;
export const CU_LONG_ABORT_GRACE_MS = 15_000;
export const CU_LONG_FINALIZATION_GRACE_MS = 30_000;

export function computerUsePlannerStepTimeoutMs(plannerTimeoutMs = CU_LONG_DEFAULT_PLANNER_TIMEOUT_MS) {
  return Math.max(
    plannerTimeoutMs + 10_000,
    plannerTimeoutMs * 2 + 5_000,
  );
}

export function computerUseLongRoundTimeoutMs(input: {
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  maxSteps?: number;
} = {}) {
  const env = input.env ?? process.env;
  const configuredRoundTimeoutMs = positiveFiniteNumber(env.SCIFORGE_CU_LONG_ROUND_TIMEOUT_MS);
  if (configuredRoundTimeoutMs !== undefined) return configuredRoundTimeoutMs;
  if (input.dryRun) return CU_LONG_DEFAULT_DRY_RUN_ROUND_TIMEOUT_MS;
  const plannerTimeoutMs = positiveFiniteNumber(env.SCIFORGE_COMPUTER_USE_PLANNER_TIMEOUT_MS)
    ?? CU_LONG_DEFAULT_PLANNER_TIMEOUT_MS;
  const maxSteps = Math.max(1, Math.ceil(positiveFiniteNumber(input.maxSteps) ?? CU_LONG_DEFAULT_REAL_MAX_STEPS));
  const minimumBudget = computerUsePlannerStepTimeoutMs(plannerTimeoutMs)
    * maxSteps
    + CU_LONG_ABORT_GRACE_MS
    + CU_LONG_FINALIZATION_GRACE_MS;
  return Math.max(CU_LONG_MIN_REAL_ROUND_TIMEOUT_MS, minimumBudget);
}

export function computerUseLongAcceptanceProgress(
  manifest: PreparedComputerUseLongRun,
  round: number,
  observed: {
    observedScenarioActionCount?: number;
    observedScenarioNonWaitActionCount?: number;
  } = {},
) {
  const roundCount = Math.max(1, manifest.rounds.length);
  const remainingRounds = Math.max(1, roundCount - Math.max(1, round) + 1);
  const currentRound = manifest.rounds.find((item) => item.round === round);
  const currentRoundActionQuotaEligible = currentRound
    ? isComputerUseLongActionQuotaEligibleRound(currentRound)
    : true;
  const remainingActionQuotaRounds = manifest.rounds
    .filter((item) => item.round >= round && isComputerUseLongActionQuotaEligibleRound(item))
    .length;
  const minimumScenarioActionCount = minimumAcceptanceCount(manifest.acceptance, /通用动作|generic actions?/i);
  const minimumScenarioNonWaitActionCount = minimumAcceptanceCount(manifest.acceptance, /非\s*wait|non[-\s]?wait/i);
  const observedScenarioActionCount = Math.max(0, Math.floor(observed.observedScenarioActionCount ?? 0));
  const observedScenarioNonWaitActionCount = Math.max(0, Math.floor(observed.observedScenarioNonWaitActionCount ?? 0));
  const remainingScenarioActionCount = minimumScenarioActionCount === undefined
    ? undefined
    : Math.max(0, minimumScenarioActionCount - observedScenarioActionCount);
  const remainingScenarioNonWaitActionCount = minimumScenarioNonWaitActionCount === undefined
    ? undefined
    : Math.max(0, minimumScenarioNonWaitActionCount - observedScenarioNonWaitActionCount);
  const suggestedCurrentRoundActionTarget = currentRoundActionQuotaEligible
    ? suggestedCurrentRoundQuota(remainingScenarioActionCount, Math.max(1, remainingActionQuotaRounds))
    : undefined;
  const suggestedCurrentRoundNonWaitActionTarget = currentRoundActionQuotaEligible
    ? suggestedCurrentRoundQuota(remainingScenarioNonWaitActionCount, Math.max(1, remainingActionQuotaRounds))
    : undefined;
  const progress = {
    schemaVersion: 'sciforge.computer-use-long.acceptance-progress.v1',
    round,
    roundCount,
    remainingRounds,
    currentRoundActionQuotaEligible,
    remainingActionQuotaRounds,
    minimumScenarioActionCount,
    minimumScenarioNonWaitActionCount,
    observedScenarioActionCount,
    observedScenarioNonWaitActionCount,
    remainingScenarioActionCount,
    remainingScenarioNonWaitActionCount,
    suggestedCurrentRoundActionTarget,
    suggestedCurrentRoundNonWaitActionTarget,
    actionQuotaEligibilityReason: currentRoundActionQuotaEligible
      ? 'current round can produce generic GUI action evidence'
      : 'current round is evidence/report/ref summarization; scenario action quota must already be satisfied by prior action-producing rounds',
    source: 'scenario-acceptance-minimums',
  };
  return Object.fromEntries(Object.entries(progress).filter(([, value]) => value !== undefined));
}

export function isComputerUseLongActionQuotaEligibleRound(round: {
  prompt?: string;
  expectedTrace?: string[];
}) {
  const text = [round.prompt, ...(round.expectedTrace ?? [])].join(' ').trim();
  if (!text) return true;
  const summaryOnlyIntent = /(?:总结|汇总|复盘|追问|回答|生成(?:测试|回归|regression|跨\s*backend)?报告|比较不同\s*backend|压测\s*context|删除聊天可见上下文|summari[sz]e|summary|report|handoff|success metrics|failure categories)/i.test(text);
  const explicitGuiActionIntent = /(?:打开|启动|点击|双击|拖|滚动|输入|填写|修改|清除|修正|切换|移动|最小化|遮挡|恢复|创建|保存|重命名|预览|定位|筛选|导航|返回|展开|取消|触发|执行|发送|按\s*(?:Escape|Tab|Enter)|回到\s*SciForge|press[_\s-]?key|hotkey|click|double[_\s-]?click|drag|scroll|type[_\s-]?text|open[_\s-]?app|launch|switch|move|save|rename|preview|filter|navigate)/i.test(text);
  return !(summaryOnlyIntent && !explicitGuiActionIntent);
}

function suggestedCurrentRoundQuota(remaining: number | undefined, remainingRounds: number) {
  if (remaining === undefined || remaining <= 0) return undefined;
  return Math.max(1, Math.ceil(remaining / Math.max(1, remainingRounds)));
}

export async function runComputerUseLongRound(options: {
  manifestPath: string;
  round: number;
  dryRun?: boolean;
  maxSteps?: number;
  runId?: string;
  actionsJson?: string;
  promptSuffix?: string;
  approvalRef?: string;
  approvalSourceDir?: string;
  approvalProvenance?: Record<string, unknown>;
  targetAppName?: string;
  targetTitle?: string;
  targetMode?: 'active-window' | 'app-window' | 'window-id' | 'display';
  now?: Date;
}): Promise<ComputerUseLongRoundRunResult> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  if (manifest.schemaVersion !== '1.0' || manifest.taskId !== 'T084') {
    throw new Error('run-round requires a prepared T084 Computer Use manifest');
  }
  const round = manifest.rounds.find((item) => item.round === options.round);
  if (!round) throw new Error(`Round ${options.round} is not present in ${manifestPath}`);

  const workspacePath = resolve(manifest.run.workspacePath);
  const evidenceDir = join(dirname(manifestPath), 'evidence', `round-${String(options.round).padStart(2, '0')}`);
  await mkdir(evidenceDir, { recursive: true });
  const now = options.now ?? new Date();
  const runId = sanitizeRunId(options.runId || `${manifest.run.id}-round-${String(options.round).padStart(2, '0')}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}`);
  const prompt = await renderRoundRuntimePrompt(manifest, round, dirname(manifestPath), options.promptSuffix);
  const gatewayPrompt = renderComputerUseGatewayPrompt(prompt, {
    scenarioId: manifest.scenarioId,
    round: round.round,
    testActionFixtureMode: Boolean(options.actionsJson),
  });
  const runtimePromptPath = join(evidenceDir, 'runtime-prompt.md');
  const actionLedgerPath = join(evidenceDir, 'action-ledger.json');
  const failureDiagnosticsPath = join(evidenceDir, 'failure-diagnostics.json');
  await writeFile(runtimePromptPath, `${prompt}\n`);

  manifest.status = 'running';
  round.status = 'repair-needed';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const { runWorkspaceRuntimeGateway } = await import('../../src/runtime/workspace-runtime-gateway.js');
  const priorMetrics = await priorRoundAcceptanceMetrics(manifest, dirname(manifestPath), options.round);
  const acceptanceProgress = computerUseLongAcceptanceProgress(manifest, options.round, priorMetrics);
  const targetActionCount = typeof acceptanceProgress.suggestedCurrentRoundActionTarget === 'number'
    ? acceptanceProgress.suggestedCurrentRoundActionTarget
    : 0;
  const targetNonWaitActionCount = typeof acceptanceProgress.suggestedCurrentRoundNonWaitActionTarget === 'number'
    ? acceptanceProgress.suggestedCurrentRoundNonWaitActionTarget
    : 0;
  const maxSteps = Math.max(
    options.maxSteps ?? CU_LONG_DEFAULT_REAL_MAX_STEPS,
    targetActionCount ? targetActionCount + 2 : 0,
    targetNonWaitActionCount ? targetNonWaitActionCount + 2 : 0,
  );
  const windowTarget = await defaultWindowTargetForRound(manifest, options.round, options.dryRun ?? false, {
    appName: options.targetAppName,
    title: options.targetTitle,
    mode: options.targetMode,
  });
  const approvalProvenance = options.approvalProvenance
    ?? await approvalProvenanceFromSourceDir(options.approvalSourceDir, options.approvalRef);
  const humanApproval = options.approvalRef
    ? {
        approvalRef: options.approvalRef,
        status: 'confirmed',
        source: 'cu-long-runner-cli',
        ...(approvalProvenance ? { approvalProvenance } : {}),
      }
    : undefined;
  const humanApprovalPolicy = options.approvalRef
    ? {
        status: 'confirmed',
        approvalRef: options.approvalRef,
        source: 'cu-long-runner-cli',
        ...(approvalProvenance ? { approvalProvenance } : {}),
      }
    : undefined;
  const roundTimeoutMs = computerUseLongRoundTimeoutMs({ dryRun: options.dryRun ?? false, maxSteps });
  const gatewayAbort = new AbortController();
  const timeoutMessage = `runWorkspaceRuntimeGateway timed out after ${roundTimeoutMs}ms for ${manifest.scenarioId} round ${options.round}`;
  const gatewayPromise = runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt: gatewayPrompt,
      workspacePath,
      selectedToolIds: ['local.vision-sense'],
      selectedSenseIds: ['local.vision-sense'],
      selectedActionIds: ['action.sciforge.computer-use'],
      humanApproval,
      humanApprovalPolicy,
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        selectedSenseIds: ['local.vision-sense'],
        selectedActionIds: ['action.sciforge.computer-use'],
	        approvalRef: options.approvalRef,
	        approvalProvenance,
	        humanApproval,
        humanApprovalPolicy,
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          dryRun: options.dryRun ?? false,
          maxSteps,
          runId,
          testActionFixtureMode: Boolean(options.actionsJson),
          testOnlyActions: options.actionsJson ? JSON.parse(options.actionsJson) : [],
          windowTarget,
          completionPolicy: {
            mode: options.dryRun ? 'one-successful-non-wait-action' : 'planner-confirmed',
            reason: options.dryRun
              ? 'Dry-run T084 CU-LONG rounds are evidence-generation probes; one verified non-wait GUI action produces the required round trace.'
              : 'Real T084 CU-LONG rounds must continue until the planner confirms the visible task state is complete or maxSteps is exhausted.',
          },
        },
          computerUseLong: {
            taskId: manifest.taskId,
            scenarioId: manifest.scenarioId,
            cuNextTaskId: manifest.cuNextTaskId,
            cuNextTask: manifest.cuNextTask,
            runId: manifest.run.id,
            round: options.round,
            title: manifest.title,
            roundPrompt: round.prompt,
            expectedTrace: round.expectedTrace,
            acceptance: manifest.acceptance,
            requiredEvidence: manifest.requiredEvidence,
            failureRecord: manifest.failureRecord,
            requirements: manifest.cuNextTask?.requirements,
            requiredPipeline: manifest.universalPipeline,
            safetyBoundary: manifest.safetyBoundary,
            validationContract: manifest.validationContract,
            acceptanceProgress,
          },
          computerUseNext: manifest.cuNextTask,
        },
      artifacts: [],
    }, { signal: gatewayAbort.signal });
  const payload = await withTaskPoolHardTimeout(gatewayPromise, roundTimeoutMs, timeoutMessage, () => {
      gatewayAbort.abort(new Error(timeoutMessage));
    })
    .catch(async (error) => {
      let message = error instanceof Error ? error.message : String(error);
      if (message === timeoutMessage) {
        try {
          return await withTaskPoolHardTimeout(gatewayPromise, CU_LONG_ABORT_GRACE_MS, `${timeoutMessage}; abort grace elapsed`);
        } catch (abortError) {
          message = abortError instanceof Error ? abortError.message : String(abortError);
        }
      }
      round.status = 'repair-needed';
      round.actionLedgerRefs = [manifestRel(dirname(manifestPath), actionLedgerPath)];
      round.failureDiagnosticsRefs = [manifestRel(dirname(manifestPath), failureDiagnosticsPath)];
      round.observedBehavior = message;
      manifest.status = 'repair-needed';
      await writeFile(actionLedgerPath, `${JSON.stringify({
        schemaVersion: 'sciforge.computer-use-long.action-ledger.v1',
        scenarioId: manifest.scenarioId,
        round: options.round,
        runtimePromptRef: manifestRel(dirname(manifestPath), runtimePromptPath),
        actions: [],
        status: 'repair-needed',
        reason: message,
      }, null, 2)}\n`);
      await writeFile(failureDiagnosticsPath, `${JSON.stringify({
        schemaVersion: 'sciforge.computer-use-long.failure-diagnostics.v1',
        scenarioId: manifest.scenarioId,
        round: options.round,
        status: 'repair-needed',
        issueCategories: ['runtime-timeout'],
        issues: [message],
        tracePath: undefined,
      }, null, 2)}\n`);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await writeScenarioSummaryForManifest(manifestPath, manifest, [{
        manifestPath,
        scenarioId: manifest.scenarioId,
        round: options.round,
        status: round.status,
        actionLedgerPath,
        failureDiagnosticsPath,
        payloadMessage: message,
      }]);
      return {
        message,
        executionUnits: [{ status: 'failed-with-reason', failureReason: message }],
        artifacts: [],
      };
    });

  const traceRef = findPayloadTraceRef(payload);
  const tracePath = traceRef ? resolveTraceArtifactPath(traceRef, workspacePath) : undefined;
  const traceEvidencePath = tracePath ? join(evidenceDir, 'vision-trace.json') : undefined;
  if (tracePath && traceEvidencePath && tracePath !== traceEvidencePath) {
    await copyTraceEvidenceBundle({
      tracePath,
      traceEvidencePath,
      traceDir: dirname(tracePath),
      evidenceDir,
      workspacePath,
    });
  }
  const validationTracePath = traceEvidencePath ?? tracePath;
  const screenshotRefs = validationTracePath ? await screenshotRefsFromTrace(validationTracePath) : [];

  let validation: ComputerUseLongTraceValidation | undefined;
  if (validationTracePath) {
    validation = await validateComputerUseLongTrace({
      scenarioId: manifest.scenarioId,
      tracePath: validationTracePath,
      workspacePath,
    });
  }

  const unit = payload.executionUnits[0] ?? {};
  const payloadStatus = typeof unit.status === 'string' ? unit.status : '';
  const dryRunTracePassed = options.dryRun === true && validation?.ok === true;
  const passed = validation?.ok === true && (payloadStatus === 'done' || dryRunTracePassed || isExpectedFailClosedRound(round, payloadStatus, validation));
  const failed = payloadStatus === 'failed' || payloadStatus === 'failed-with-reason' || validation?.ok === false || !tracePath;
  round.status = passed ? 'passed' : failed ? 'repair-needed' : 'repair-needed';
  round.visionTraceRef = traceEvidencePath ? manifestRel(dirname(manifestPath), traceEvidencePath) : traceRef;
  round.screenshotRefs = screenshotRefs;
  round.actionLedgerRefs = [manifestRel(dirname(manifestPath), actionLedgerPath)];
  round.failureDiagnosticsRefs = [manifestRel(dirname(manifestPath), failureDiagnosticsPath)];
  round.observedBehavior = payload.message;
  manifest.status = manifest.rounds.every((item) => item.status === 'passed')
    ? 'passed'
    : manifest.rounds.some((item) => item.status === 'repair-needed' || item.status === 'failed')
      ? 'repair-needed'
      : 'not-run';

  await writeFile(actionLedgerPath, `${JSON.stringify(renderActionLedger(payload, validation, manifestRel(dirname(manifestPath), runtimePromptPath)), null, 2)}\n`);
  await writeFile(failureDiagnosticsPath, `${JSON.stringify(renderFailureDiagnostics(payload, validation, validationTracePath), null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeScenarioSummaryForManifest(manifestPath, manifest, [{
    manifestPath,
    scenarioId: manifest.scenarioId,
    round: options.round,
    status: round.status,
    tracePath: validationTracePath,
    validation,
    actionLedgerPath,
    failureDiagnosticsPath,
    payloadMessage: payload.message,
  }]);

  return {
    manifestPath,
    scenarioId: manifest.scenarioId,
    round: options.round,
    status: round.status,
    tracePath,
    validation,
    actionLedgerPath,
    failureDiagnosticsPath,
    payloadMessage: payload.message,
  };
}

function positiveFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function priorRoundAcceptanceMetrics(
  manifest: PreparedComputerUseLongRun,
  manifestDir: string,
  round: number,
) {
  let observedScenarioActionCount = 0;
  let observedScenarioNonWaitActionCount = 0;
  for (const priorRound of manifest.rounds.filter((item) => item.round < round)) {
    const metrics = await firstRoundMetricsFromRefs(
      manifestDir,
      [
        ...(priorRound.actionLedgerRefs ?? []),
        ...(priorRound.failureDiagnosticsRefs ?? []),
      ],
    );
    observedScenarioActionCount += metrics.actionCount;
    observedScenarioNonWaitActionCount += metrics.nonWaitActionCount;
  }
  return {
    observedScenarioActionCount,
    observedScenarioNonWaitActionCount,
  };
}

async function firstRoundMetricsFromRefs(manifestDir: string, refs: string[]) {
  for (const ref of refs) {
    const data = await readOptionalJson(resolveManifestRef(manifestDir, ref));
    const metrics = roundMetricsFromRecord(data);
    if (metrics) return metrics;
  }
  return { actionCount: 0, nonWaitActionCount: 0 };
}

function roundMetricsFromRecord(data: unknown): { actionCount: number; nonWaitActionCount: number } | undefined {
  if (!isRecord(data)) return undefined;
  const candidates = [
    data.validationMetrics,
    isRecord(data.traceValidation) ? data.traceValidation.metrics : undefined,
    data.metrics,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const actionCount = finiteNumber(candidate.actionCount) ?? 0;
    const nonWaitActionCount = finiteNumber(candidate.nonWaitActionCount) ?? 0;
    if (actionCount > 0 || nonWaitActionCount > 0) {
      return { actionCount, nonWaitActionCount };
    }
  }
  return undefined;
}

async function copyTraceEvidenceBundle(options: {
  tracePath: string;
  traceEvidencePath: string;
  traceDir: string;
  evidenceDir: string;
  workspacePath: string;
}) {
  const { refMap, copiedJsonPaths } = await copyTraceSiblingEvidenceFiles(options.traceDir, options.evidenceDir, options.workspacePath);
  try {
    const trace = JSON.parse(await readFile(options.tracePath, 'utf8')) as unknown;
    const bundledTrace = rewriteTraceRefsForEvidenceBundle(trace, refMap, options.evidenceDir);
    await writeFile(options.traceEvidencePath, `${JSON.stringify(bundledTrace, null, 2)}\n`, 'utf8');
  } catch {
    await copyFile(options.tracePath, options.traceEvidencePath);
  }
  await rewriteCopiedJsonSiblings(copiedJsonPaths, refMap, options.evidenceDir, options.traceEvidencePath);
}

async function copyTraceSiblingEvidenceFiles(traceDir: string, evidenceDir: string, workspacePath: string) {
  const siblingEvidenceNames = [
    'computer-use-request.json',
    'request.json',
    'gateway-request.json',
    'host-ports.json',
    'tool-payload.json',
    'gui-present.json',
    'gui-ask-user.json',
    'independent-input-adapter.json',
    'virtual-remote-session.json',
  ];
  const refMap = new Map<string, string>();
  const copiedJsonPaths = (await Promise.all(siblingEvidenceNames.map(async (name) => (
    copyTraceSiblingFile(traceDir, evidenceDir, workspacePath, name, refMap)
  )))).filter(isString);
  try {
    const entries = await readdir(traceDir, { withFileTypes: true });
    copiedJsonPaths.push(...(await Promise.all(entries
      .filter((entry) => entry.isFile())
      .map((entry) => copyTraceSiblingFile(traceDir, evidenceDir, workspacePath, entry.name, refMap))))
      .filter(isString));
  } catch {
    // A missing original trace directory is handled by the caller's trace copy.
  }
  return {
    refMap,
    copiedJsonPaths: Array.from(new Set(copiedJsonPaths)),
  };
}

async function copyTraceSiblingFile(
  traceDir: string,
  evidenceDir: string,
  workspacePath: string,
  name: string,
  refMap: Map<string, string>,
) {
  const source = join(traceDir, name);
  const target = join(evidenceDir, name);
  try {
    await access(source);
    if (source !== target) await copyFile(source, target);
    const bundledRef = manifestRel(evidenceDir, target);
    refMap.set(source, bundledRef);
    refMap.set(manifestRel(workspacePath, source), bundledRef);
    return name.endsWith('.json') ? target : undefined;
  } catch {
    // Older traces may not have every package-bridge evidence sibling.
  }
  return undefined;
}

function rewriteTraceRefsForEvidenceBundle(value: unknown, refMap: Map<string, string>, evidenceDir: string): unknown {
  if (typeof value === 'string') return refMap.get(value) ?? bundleLocalAbsoluteRef(value, evidenceDir);
  if (Array.isArray(value)) return value.map((item) => rewriteTraceRefsForEvidenceBundle(item, refMap, evidenceDir));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    rewriteTraceRefsForEvidenceBundle(child, refMap, evidenceDir),
  ]));
}

async function rewriteCopiedJsonSiblings(
  copiedJsonPaths: string[],
  refMap: Map<string, string>,
  evidenceDir: string,
  traceEvidencePath: string,
) {
  await Promise.all(copiedJsonPaths
    .filter((path) => path !== traceEvidencePath)
    .map(async (path) => {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
        const rewritten = rewriteTraceRefsForEvidenceBundle(parsed, refMap, evidenceDir);
        await writeFile(path, `${JSON.stringify(rewritten, null, 2)}\n`, 'utf8');
      } catch {
        // Non-JSON or partially written diagnostic siblings are copied verbatim.
      }
    }));
}

function bundleLocalAbsoluteRef(value: string, evidenceDir: string): string {
  if (!isAbsolute(value)) return value;
  const rel = relative(evidenceDir, value).replace(/\\/g, '/');
  return rel.startsWith('..') ? value : rel || value.split('/').pop() || value;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

async function writeScenarioSummaryForManifest(
  manifestPath: string,
  manifest: PreparedComputerUseLongRun,
  roundResults: ComputerUseLongRoundRunResult[],
) {
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === manifest.scenarioId);
  if (!scenario) return;
  const summaryPath = join(dirname(manifestPath), 'scenario-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(renderScenarioSummary(manifest, scenario, roundResults), null, 2)}\n`);
}

function isExpectedFailClosedRound(
  round: PreparedComputerUseLongRun['rounds'][number],
  payloadStatus: string,
  validation: ComputerUseLongTraceValidation | undefined,
) {
  if (payloadStatus !== 'failed-with-reason' || validation?.ok !== true) return false;
  const text = `${round.prompt} ${round.expectedTrace.join(' ')}`;
  return /fail\s*closed|blocked|risk|confirmation|高风险|确认|阻断|删除|发送|提交|授权|外发/i.test(text)
    && validation.metrics.blockedCount > 0
    && validation.metrics.nonWaitActionCount > 0;
}

function renderComputerUseGatewayPrompt(
  prompt: string,
  options: { scenarioId: string; round: number; testActionFixtureMode: boolean },
) {
  if (options.testActionFixtureMode) {
    return `/computer-use run operate the target window with generic mouse/keyboard for T084 ${options.scenarioId} round ${options.round}. Use test-only fixture actions and write window screenshot trace evidence.`;
  }
  return prompt.trimStart().startsWith('/computer-use')
    ? prompt
    : `/computer-use run operate the target window with generic mouse/keyboard. ${prompt}`;
}

export async function runComputerUseLongScenario(options: {
  manifestPath: string;
  rounds?: number;
  dryRun?: boolean;
  maxSteps?: number;
  actionsJson?: string;
  promptSuffix?: string;
  approvalRef?: string;
  approvalSourceDir?: string;
  approvalProvenance?: Record<string, unknown>;
  targetAppName?: string;
  targetTitle?: string;
  targetMode?: 'active-window' | 'app-window' | 'window-id' | 'display';
  now?: Date;
}): Promise<ComputerUseLongScenarioRunResult> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  if (manifest.schemaVersion !== '1.0' || manifest.taskId !== 'T084') {
    throw new Error('run-scenario requires a prepared T084 Computer Use manifest');
  }
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === manifest.scenarioId);
  if (!scenario) throw new Error(`Unknown CU-LONG scenario: ${manifest.scenarioId}`);
  const requestedRounds = options.rounds ?? scenario.minRounds;
  if (!Number.isInteger(requestedRounds) || requestedRounds < 1) throw new Error('run-scenario rounds must be a positive integer');
  const roundsToRun = manifest.rounds.slice(0, requestedRounds);
  if (roundsToRun.length < requestedRounds) {
    throw new Error(`Manifest only defines ${roundsToRun.length} rounds, cannot run ${requestedRounds}`);
  }

  const roundResults: ComputerUseLongRoundRunResult[] = [];
  for (const round of roundsToRun) {
    const result = await runComputerUseLongRound({
      manifestPath,
      round: round.round,
      dryRun: options.dryRun,
      maxSteps: options.maxSteps,
      runId: `${manifest.run.id}-round-${String(round.round).padStart(2, '0')}`,
      actionsJson: options.actionsJson,
      promptSuffix: options.promptSuffix,
      approvalRef: options.approvalRef,
      approvalSourceDir: options.approvalSourceDir,
      approvalProvenance: options.approvalProvenance,
      targetAppName: options.targetAppName,
      targetTitle: options.targetTitle,
      targetMode: options.targetMode,
      now: options.now,
    });
    roundResults.push(result);
    if (result.status !== 'passed') break;
  }

  const latestManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const attemptedRounds = roundResults.map((item) => item.round);
  const passedRounds = roundResults.filter((item) => item.status === 'passed').map((item) => item.round);
  const repairNeededRound = roundResults.find((item) => item.status !== 'passed')?.round;
  latestManifest.status = repairNeededRound
    ? 'repair-needed'
    : passedRounds.length >= scenario.minRounds
      ? 'passed'
      : 'repair-needed';
  await writeFile(manifestPath, `${JSON.stringify(latestManifest, null, 2)}\n`);

  const summaryPath = join(dirname(manifestPath), 'scenario-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(renderScenarioSummary(latestManifest, scenario, roundResults), null, 2)}\n`);
  const validation = await validateComputerUseLongRun({
    manifestPath,
    requirePassed: latestManifest.status === 'passed',
    requireScenarioSummaryValidation: false,
  });
  if (latestManifest.status === 'passed' && !validation.ok) {
    latestManifest.status = 'repair-needed';
    await writeFile(manifestPath, `${JSON.stringify(latestManifest, null, 2)}\n`);
  }
  await writeFile(summaryPath, `${JSON.stringify(renderScenarioSummary(latestManifest, scenario, roundResults, validation), null, 2)}\n`);
  return {
    manifestPath,
    scenarioId: latestManifest.scenarioId,
    status: latestManifest.status,
    attemptedRounds,
    passedRounds,
    repairNeededRound,
    validation,
    summaryPath,
    roundResults,
  };
}

async function approvalProvenanceFromSourceDir(
  sourceDir: string | undefined,
  approvalRef: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!sourceDir) return undefined;
  const dir = resolve(sourceDir);
  const [approvalRequestSidecar, guiAskUserSidecar, riskAuditSidecar] = await Promise.all([
    readOptionalJson(join(dir, 'approval-request.json')),
    readOptionalJson(join(dir, 'gui-ask-user.json')),
    readOptionalJson(join(dir, 'risk-audit.json')),
  ]);
  if (!isRecord(approvalRequestSidecar) || !isRecord(guiAskUserSidecar) || !isRecord(riskAuditSidecar)) {
    throw new Error(`approval source dir must contain approval-request.json, gui-ask-user.json, and risk-audit.json: ${dir}`);
  }
  const validationIssues = validateCuNextNeedsConfirmationSidecars({
    sidecars: {
      approvalRequest: approvalRequestSidecar,
      guiAskUser: guiAskUserSidecar,
      riskAudit: riskAuditSidecar,
    },
    refs: {
      approvalRequestRef: 'approval-request.json',
      guiAskUserRecordRef: 'gui-ask-user.json',
      riskAuditRef: 'risk-audit.json',
    },
  });
  if (validationIssues.length > 0) {
    throw new Error(`approval source dir is not a valid fail-closed needs-confirmation source: ${validationIssues.map((issue) => issue.reason).join(' ')}`);
  }
  const approvalRequest = recordAt(approvalRequestSidecar, 'approvalRequest');
  const approvalRequestId = firstString(
    stringAtRecord(approvalRequestSidecar, 'approvalRequestId'),
    stringAtRecord(approvalRequest, 'id'),
    stringAtRecord(approvalRequest, 'approvalRequestId'),
  );
  const riskActionHash = firstString(
    stringAtRecord(riskAuditSidecar, 'riskActionHash'),
    stringAtRecord(approvalRequestSidecar, 'riskActionHash'),
    stringAtRecord(approvalRequest, 'riskActionHash'),
  );
  const sourceApprovalRef = canonicalApprovalRefFromConfirmedSidecar(approvalRequestSidecar)
    ?? stringAtRecord(approvalRequestSidecar, 'approvalRef')
    ?? stringAtRecord(approvalRequest, 'approvalRef');
  if (approvalRef && sourceApprovalRef && approvalRef !== sourceApprovalRef) {
    throw new Error(`approvalRef must match the prior fail-closed source approvalRef; got ${approvalRef}, expected ${sourceApprovalRef}`);
  }
  return compactRecord({
    source: 'prior-fail-closed-request',
    sourceStatus: 'needs-confirmation',
    sourceRunId: firstString(
      stringAtRecord(riskAuditSidecar, 'runId'),
      stringAtRecord(approvalRequestSidecar, 'runId'),
      stringAtRecord(guiAskUserSidecar, 'runId'),
    ),
    sourceApprovalRequestRef: 'approval-request.json',
    sourceGuiAskUserRecordRef: 'gui-ask-user.json',
    sourceRiskAuditRef: 'risk-audit.json',
    approvalRequestId,
    approvalRef: approvalRef ?? sourceApprovalRef,
    riskActionHash,
    highRiskAction: recordAt(riskAuditSidecar, 'highRiskAction')
      ?? recordAt(approvalRequestSidecar, 'highRiskAction')
      ?? recordAt(approvalRequest, 'highRiskAction'),
    approvalRequestSidecar,
    guiAskUserSidecar,
    riskAuditSidecar,
    sourceApprovalRequestPath: join(dir, 'approval-request.json'),
    sourceGuiAskUserPath: join(dir, 'gui-ask-user.json'),
    sourceRiskAuditPath: join(dir, 'risk-audit.json'),
    decisionSource: 'cu-long-runner-cli',
  });
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return isRecord(child) ? child : undefined;
}

function stringAtRecord(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const child = value[key];
  return typeof child === 'string' && child.trim().length > 0 ? child : undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry === undefined || entry === null) return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    if (isRecord(entry) && Object.keys(entry).length === 0) return false;
    return true;
  }));
}

export async function validateComputerUseLongRun(options: {
  manifestPath: string;
  requirePassed?: boolean;
  requireScenarioSummaryValidation?: boolean;
}): Promise<ComputerUseLongRunValidation> {
  const manifestPath = resolve(options.manifestPath);
  const manifestDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const issues: string[] = [];
  issues.push(...collectRefsFirstManifestPayloadIssues(manifest, 'manifest'));
  if (manifest.schemaVersion !== '1.0') issues.push('manifest.schemaVersion must be 1.0');
  if (manifest.taskId !== 'T084') issues.push('manifest.taskId must be T084');
  const pool = await loadComputerUseLongTaskPool();
  const scenario = pool.scenarios.find((item) => item.id === manifest.scenarioId);
  if (!scenario) {
    issues.push(`Unknown CU-LONG scenario: ${manifest.scenarioId}`);
  } else {
    if (manifest.title !== scenario.title) issues.push('manifest title does not match task pool scenario');
    if (manifest.rounds.length !== scenario.rounds.length) issues.push('manifest rounds length does not match task pool scenario');
    if (JSON.stringify(manifest.universalPipeline) !== JSON.stringify(scenario.requiredPipeline)) {
      issues.push('manifest universalPipeline does not match scenario requiredPipeline');
    }
    if (JSON.stringify(manifest.safetyBoundary) !== JSON.stringify(scenario.safetyBoundary)) {
      issues.push('manifest safetyBoundary does not match scenario safetyBoundary');
    }
    if (options.requirePassed !== false && manifest.status !== 'passed') issues.push('manifest.status must be passed');
  }
  if (!isRecord(manifest.run.windowTarget)) {
    issues.push('manifest.run.windowTarget must require window-targeted Computer Use');
  } else {
    if (manifest.run.windowTarget.mode !== 'required') issues.push('manifest.run.windowTarget.mode must be required');
    if (manifest.run.windowTarget.coordinateSpace !== 'window-local') issues.push('manifest.run.windowTarget.coordinateSpace must be window-local');
  }
  if (!isRecord(manifest.run.inputChannel)) {
    issues.push('manifest.run.inputChannel must describe generic mouse/keyboard input');
  } else {
    if (manifest.run.inputChannel.mode !== 'generic-mouse-keyboard') issues.push('manifest.run.inputChannel.mode must be generic-mouse-keyboard');
    const manifestActions = new Set(Array.isArray(manifest.run.inputChannel.allowedActionTypes) ? manifest.run.inputChannel.allowedActionTypes.map(String) : []);
    for (const action of allowedActionTypes) {
      if (!manifestActions.has(action)) issues.push(`manifest.run.inputChannel.allowedActionTypes missing ${action}`);
    }
  }
  if (!isRecord(manifest.run.scheduler)) {
    issues.push('manifest.run.scheduler must describe serialized window action scheduling');
  } else {
    if (manifest.run.scheduler.mode !== 'serialized-window-actions') issues.push('manifest.run.scheduler.mode must be serialized-window-actions');
    if (manifest.run.scheduler.requiresBeforeAfterScreenshots !== true) issues.push('manifest.run.scheduler.requiresBeforeAfterScreenshots must be true');
  }
  if (!isRecord(manifest.validationContract)) {
    issues.push('manifest.validationContract is missing');
  } else {
    if (manifest.validationContract.screenshotScope !== 'window') issues.push('manifest.validationContract.screenshotScope must be window');
    if (manifest.validationContract.coordinateSpace !== 'window-local') issues.push('manifest.validationContract.coordinateSpace must be window-local');
    if (manifest.validationContract.inputChannel !== 'generic-mouse-keyboard') issues.push('manifest.validationContract.inputChannel must be generic-mouse-keyboard');
    if (manifest.validationContract.scheduler !== 'serialized-window-actions') issues.push('manifest.validationContract.scheduler must be serialized-window-actions');
    const required = Array.isArray(manifest.validationContract.requiredTraceMetadata) ? manifest.validationContract.requiredTraceMetadata.map(String) : [];
    for (const item of requiredTraceMetadata) {
      if (!required.includes(item)) issues.push(`manifest.validationContract.requiredTraceMetadata missing ${item}`);
    }
  }

  const summaryPath = join(manifestDir, 'scenario-summary.json');
  const summary = await readOptionalJson(summaryPath);
  if (!summary) {
    issues.push('scenario-summary.json is missing');
  } else if (!isRecord(summary)) {
    issues.push('scenario-summary.json must be a JSON object');
  } else {
    issues.push(...collectRefsFirstManifestPayloadIssues(summary, 'scenario-summary'));
    if (summary.schemaVersion !== 'sciforge.computer-use-long.scenario-summary.v1') issues.push('scenario-summary schemaVersion is invalid');
    if (summary.scenarioId !== manifest.scenarioId) issues.push('scenario-summary scenarioId does not match manifest');
    if (summary.status !== manifest.status) issues.push('scenario-summary status does not match manifest');
    if (summary.runId !== manifest.run.id) issues.push('scenario-summary runId does not match manifest current run');
    if (options.requirePassed !== false && options.requireScenarioSummaryValidation !== false) {
      const summaryValidation = isRecord(summary.validation) ? summary.validation : undefined;
      if (!summaryValidation) {
        issues.push('scenario-summary validation validator evidence is missing');
      } else if (summaryValidation.ok !== true) {
        issues.push('scenario-summary validation.ok must be true for passed run evidence');
      }
    }
  }

  const checkedRounds: number[] = [];
  let passedRounds = 0;
  let traceCount = 0;
  let realTraceCount = 0;
  let totalActionCount = 0;
  let totalNonWaitActionCount = 0;
  let screenshotRefCount = 0;
  let actionLedgerCount = 0;
  let failureDiagnosticsCount = 0;
  const repairDiagnostics = emptyRepairDiagnostics();
  const traceWindowTargets: Array<Record<string, unknown>> = [];
  for (const round of manifest.rounds) {
    if (round.status !== 'passed') {
      failureDiagnosticsCount += await collectRoundFailureDiagnostics({
        manifestDir,
        round,
        issues,
        repairDiagnostics,
        requirePassed: options.requirePassed !== false,
      });
      continue;
    }
    checkedRounds.push(round.round);
    passedRounds += 1;
    let roundTraceDir = manifestDir;
    if (!round.visionTraceRef) {
      issues.push(`round ${round.round} missing visionTraceRef`);
    } else {
      const tracePath = resolveManifestRef(manifestDir, round.visionTraceRef);
      roundTraceDir = dirname(tracePath);
      const traceValidation = await validateComputerUseLongTrace({
        scenarioId: manifest.scenarioId,
        tracePath,
        workspacePath: manifest.run.workspacePath,
      });
      if (!traceValidation.ok) {
        for (const issue of traceValidation.issues) issues.push(`round ${round.round} trace: ${issue}`);
      }
      const trace = await readOptionalJson(tracePath);
      if (isRecord(trace)) {
        if (isRealGuiTrace(trace)) realTraceCount += 1;
        const target = traceWindowTargetFromTrace(trace);
        if (target) traceWindowTargets.push(target);
      }
      totalActionCount += traceValidation.metrics.actionCount;
      totalNonWaitActionCount += traceValidation.metrics.nonWaitActionCount;
      traceCount += 1;
    }
    if (!round.screenshotRefs.length) issues.push(`round ${round.round} missing screenshotRefs`);
    screenshotRefCount += round.screenshotRefs.length;
    for (const ref of round.screenshotRefs) {
      const resolved = resolveTraceRefPath(ref, resolve(manifest.run.workspacePath), roundTraceDir);
      const fileIssues = await validatePngRef(resolved, ref);
      for (const issue of fileIssues) issues.push(`round ${round.round}: ${issue}`);
    }
    if (!round.actionLedgerRefs.length) issues.push(`round ${round.round} missing actionLedgerRefs`);
    for (const ref of round.actionLedgerRefs) {
      actionLedgerCount += 1;
      const ledger = await readOptionalJson(resolveManifestRef(manifestDir, ref));
      if (!isRecord(ledger)) {
        issues.push(`round ${round.round} action ledger ${ref} is missing or invalid`);
      } else {
        if (ledger.schemaVersion !== 'sciforge.computer-use-long.action-ledger.v1') issues.push(`round ${round.round} action ledger schemaVersion is invalid`);
        const runtimePromptRef = typeof ledger.runtimePromptRef === 'string' ? ledger.runtimePromptRef : '';
        if (!runtimePromptRef) {
          issues.push(`round ${round.round} action ledger missing runtimePromptRef`);
        } else {
          const promptText = await readOptionalText(resolveManifestRef(manifestDir, runtimePromptRef));
          if (!promptText) issues.push(`round ${round.round} runtime prompt is missing`);
          if (promptText && /data:image|;base64,/i.test(promptText)) issues.push(`round ${round.round} runtime prompt contains inline image payload`);
        }
      }
    }
    failureDiagnosticsCount += await collectRoundFailureDiagnostics({
      manifestDir,
      round,
      issues,
      repairDiagnostics,
      requirePassed: options.requirePassed !== false,
    });
  }
  if (scenario && options.requirePassed !== false && passedRounds < scenario.minRounds) {
    issues.push(`passed rounds ${passedRounds} is below scenario minRounds ${scenario.minRounds}`);
  }
  if (scenario && options.requirePassed !== false && realTraceCount > 0) {
    const minActions = minimumAcceptanceCount(scenario.acceptance, /通用动作|generic actions?/i);
    if (minActions !== undefined && totalActionCount < minActions) {
      issues.push(`real run action count ${totalActionCount} is below acceptance minimum ${minActions}`);
      repairDiagnostics.actionShortfalls.push({
        metric: 'actionCount',
        observed: totalActionCount,
        minimum: minActions,
        missing: minActions - totalActionCount,
        source: 'scenario-acceptance',
      });
    }
    const minNonWaitActions = minimumAcceptanceCount(scenario.acceptance, /非\s*wait|non[-\s]?wait/i);
    if (minNonWaitActions !== undefined && totalNonWaitActionCount < minNonWaitActions) {
      issues.push(`real run non-wait action count ${totalNonWaitActionCount} is below acceptance minimum ${minNonWaitActions}`);
      repairDiagnostics.actionShortfalls.push({
        metric: 'nonWaitActionCount',
        observed: totalNonWaitActionCount,
        minimum: minNonWaitActions,
        missing: minNonWaitActions - totalNonWaitActionCount,
        source: 'scenario-acceptance',
      });
    }
    if (scenarioExpectsBrowserTarget(scenario) && !traceWindowTargets.some(isBrowserWindowTarget)) {
      issues.push('real browser scenario did not target a browser window in any trace');
    }
  }
  if (repairDiagnostics.actionShortfalls[0]) repairDiagnostics.actionShortfall = repairDiagnostics.actionShortfalls[0];
  repairDiagnostics.missingRefs = dedupeStrings([
    ...repairDiagnostics.missingRefs,
    ...missingEvidenceRefsFromIssues(issues),
  ]);
  repairDiagnostics.failingRoundDiagnosticsRefs = dedupeStrings(repairDiagnostics.failingRoundDiagnosticsRefs);
  repairDiagnostics.failureReasons = dedupeStrings(repairDiagnostics.failureReasons);
  repairDiagnostics.nextRepairFocus = issues.length ? repairActionsForIssues(issues) : [];

  return {
    ok: issues.length === 0,
    manifestPath,
    scenarioId: manifest.scenarioId,
    summaryPath,
    checkedRounds,
    issues,
    repairDiagnostics,
    metrics: {
      passedRounds,
      traceCount,
      realTraceCount,
      actionCount: totalActionCount,
      nonWaitActionCount: totalNonWaitActionCount,
      screenshotRefCount,
      actionLedgerCount,
      failureDiagnosticsCount,
    },
  };
}

function emptyRepairDiagnostics(): ComputerUseLongRepairDiagnostics {
  return {
    actionShortfalls: [],
    missingRefs: [],
    failingRoundDiagnosticsRefs: [],
    failureReasons: [],
    traceMetricsByRound: [],
    nextRepairFocus: [],
  };
}

async function collectRoundFailureDiagnostics(options: {
  manifestDir: string;
  round: PreparedComputerUseLongRun['rounds'][number];
  issues: string[];
  repairDiagnostics: ComputerUseLongRepairDiagnostics;
  requirePassed: boolean;
}) {
  const { manifestDir, round, issues, repairDiagnostics } = options;
  if (!round.failureDiagnosticsRefs.length) {
    if (round.status !== 'not-run') issues.push(`round ${round.round} missing failureDiagnosticsRefs`);
    return 0;
  }
  let count = 0;
  for (const ref of round.failureDiagnosticsRefs) {
    count += 1;
    if (round.status !== 'passed') repairDiagnostics.failingRoundDiagnosticsRefs.push(ref);
    const diagnostics = await readOptionalJson(resolveManifestRef(manifestDir, ref));
    if (!isRecord(diagnostics)) {
      issues.push(`round ${round.round} failure diagnostics ${ref} is missing or invalid`);
      continue;
    }
    if (diagnostics.schemaVersion !== 'sciforge.computer-use-long.failure-diagnostics.v1') {
      issues.push(`round ${round.round} failure diagnostics schemaVersion is invalid`);
    }
    const traceValidation = isRecord(diagnostics.traceValidation) ? diagnostics.traceValidation : undefined;
    if (!traceValidation) {
      issues.push(`round ${round.round} failure diagnostics missing traceValidation`);
    }
    const failureReason = firstString(diagnostics.failureReason, diagnostics.message, firstExecutionFailure(diagnostics));
    if (failureReason) {
      repairDiagnostics.failureReasons.push(`round ${round.round}: ${failureReason}`);
      if (options.requirePassed && round.status !== 'passed') {
        issues.push(`round ${round.round} ${round.status}: ${failureReason}`);
      }
    }
    const metrics = traceValidation && isRecord(traceValidation.metrics) ? traceValidation.metrics : {};
    repairDiagnostics.traceMetricsByRound.push({
      round: round.round,
      status: round.status,
      diagnosticsRef: ref,
      traceRef: firstString(diagnostics.tracePath, round.visionTraceRef),
      actionCount: finiteNumber(metrics.actionCount),
      nonWaitActionCount: finiteNumber(metrics.nonWaitActionCount),
      effectiveNonWaitActionCount: finiteNumber(metrics.effectiveNonWaitActionCount),
      screenshotCount: finiteNumber(metrics.screenshotCount),
      blockedCount: finiteNumber(metrics.blockedCount),
      failedCount: finiteNumber(metrics.failedCount),
      recoverActions: countRecoverActions(diagnostics),
    });
  }
  return count;
}

function firstExecutionFailure(diagnostics: Record<string, unknown>) {
  const units = Array.isArray(diagnostics.executionUnits) ? diagnostics.executionUnits.filter(isRecord) : [];
  for (const unit of units) {
    const failureReason = firstString(unit.failureReason);
    if (failureReason) return failureReason;
    const records = Array.isArray(unit.traceRecords) ? unit.traceRecords.filter(isRecord) : [];
    for (const record of records) {
      const execution = isRecord(record.execution) ? record.execution : undefined;
      const stderr = firstString(execution?.stderr, execution?.stdout);
      if (stderr) return stderr;
    }
  }
  return undefined;
}

function countRecoverActions(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countRecoverActions(item), 0);
  if (!isRecord(value)) return 0;
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (/recover|recovery/i.test(key)) {
      if (Array.isArray(item)) count += item.length;
      else if (item !== undefined && item !== null) count += 1;
    }
    if (isRecord(item) || Array.isArray(item)) count += countRecoverActions(item);
  }
  return count;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim())));
}
