import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type {
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
  defaultWindowTargetForRound,
  findPayloadTraceRef,
  firstString,
  isBrowserWindowTarget,
  isRealGuiTrace,
  isRecord,
  manifestRel,
  minimumAcceptanceCount,
  readOptionalJson,
  readOptionalText,
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

export async function runComputerUseLongRound(options: {
  manifestPath: string;
  round: number;
  dryRun?: boolean;
  maxSteps?: number;
  runId?: string;
  actionsJson?: string;
  promptSuffix?: string;
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
  const maxSteps = options.maxSteps ?? CU_LONG_DEFAULT_REAL_MAX_STEPS;
  const windowTarget = await defaultWindowTargetForRound(manifest, options.round, options.dryRun ?? false, {
    appName: options.targetAppName,
    title: options.targetTitle,
    mode: options.targetMode,
  });
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
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        selectedSenseIds: ['local.vision-sense'],
        selectedActionIds: ['action.sciforge.computer-use'],
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
  return {
    manifestPath,
    scenarioId: latestManifest.scenarioId,
    status: latestManifest.status,
    attemptedRounds,
    passedRounds,
    repairNeededRound,
    summaryPath,
    roundResults,
  };
}

export async function validateComputerUseLongRun(options: {
  manifestPath: string;
  requirePassed?: boolean;
}): Promise<ComputerUseLongRunValidation> {
  const manifestPath = resolve(options.manifestPath);
  const manifestDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const issues: string[] = [];
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
    if (summary.schemaVersion !== 'sciforge.computer-use-long.scenario-summary.v1') issues.push('scenario-summary schemaVersion is invalid');
    if (summary.scenarioId !== manifest.scenarioId) issues.push('scenario-summary scenarioId does not match manifest');
    if (summary.status !== manifest.status) issues.push('scenario-summary status does not match manifest');
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
  const traceWindowTargets: Array<Record<string, unknown>> = [];
  for (const round of manifest.rounds) {
    if (round.status !== 'passed') continue;
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
    if (!round.failureDiagnosticsRefs.length) issues.push(`round ${round.round} missing failureDiagnosticsRefs`);
    for (const ref of round.failureDiagnosticsRefs) {
      failureDiagnosticsCount += 1;
      const diagnostics = await readOptionalJson(resolveManifestRef(manifestDir, ref));
      if (!isRecord(diagnostics)) {
        issues.push(`round ${round.round} failure diagnostics ${ref} is missing or invalid`);
      } else {
        if (diagnostics.schemaVersion !== 'sciforge.computer-use-long.failure-diagnostics.v1') issues.push(`round ${round.round} failure diagnostics schemaVersion is invalid`);
        if (!isRecord(diagnostics.traceValidation)) issues.push(`round ${round.round} failure diagnostics missing traceValidation`);
      }
    }
  }
  if (scenario && options.requirePassed !== false && passedRounds < scenario.minRounds) {
    issues.push(`passed rounds ${passedRounds} is below scenario minRounds ${scenario.minRounds}`);
  }
  if (scenario && options.requirePassed !== false && realTraceCount > 0) {
    const minActions = minimumAcceptanceCount(scenario.acceptance, /通用动作|generic actions?/i);
    if (minActions !== undefined && totalActionCount < minActions) {
      issues.push(`real run action count ${totalActionCount} is below acceptance minimum ${minActions}`);
    }
    const minNonWaitActions = minimumAcceptanceCount(scenario.acceptance, /非\s*wait|non[-\s]?wait/i);
    if (minNonWaitActions !== undefined && totalNonWaitActionCount < minNonWaitActions) {
      issues.push(`real run non-wait action count ${totalNonWaitActionCount} is below acceptance minimum ${minNonWaitActions}`);
    }
    if (scenarioExpectsBrowserTarget(scenario) && !traceWindowTargets.some(isBrowserWindowTarget)) {
      issues.push('real browser scenario did not target a browser window in any trace');
    }
  }

  return {
    ok: issues.length === 0,
    manifestPath,
    scenarioId: manifest.scenarioId,
    summaryPath,
    checkedRounds,
    issues,
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
