import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

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
  const runId = sanitizeRunId(options.runId || `${manifest.run.id}-round-${String(options.round).padStart(2, '0')}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const prompt = await renderRoundRuntimePrompt(manifest, round, dirname(manifestPath), options.promptSuffix);
  const runtimePromptPath = join(evidenceDir, 'runtime-prompt.md');
  const actionLedgerPath = join(evidenceDir, 'action-ledger.json');
  const failureDiagnosticsPath = join(evidenceDir, 'failure-diagnostics.json');
  await writeFile(runtimePromptPath, `${prompt}\n`);

  manifest.status = 'running';
  round.status = 'repair-needed';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const { runWorkspaceRuntimeGateway } = await import('../../src/runtime/workspace-runtime-gateway.js');
  const windowTarget = await defaultWindowTargetForRound(manifest, options.round, options.dryRun ?? false, {
    appName: options.targetAppName,
    title: options.targetTitle,
    mode: options.targetMode,
  });
  const configuredRoundTimeoutMs = Number(process.env.SCIFORGE_CU_LONG_ROUND_TIMEOUT_MS);
  const roundTimeoutMs = Number.isFinite(configuredRoundTimeoutMs) && configuredRoundTimeoutMs > 0
    ? configuredRoundTimeoutMs
    : options.dryRun ? 120_000 : 240_000;
  const payload = await withTaskPoolHardTimeout(runWorkspaceRuntimeGateway({
      skillDomain: 'knowledge',
      prompt,
      workspacePath,
      selectedToolIds: ['local.vision-sense'],
      uiState: {
        selectedToolIds: ['local.vision-sense'],
        visionSenseConfig: {
          desktopBridgeEnabled: true,
          dryRun: options.dryRun ?? false,
          maxSteps: options.maxSteps ?? 8,
          runId,
          actions: options.actionsJson ? JSON.parse(options.actionsJson) : [],
          windowTarget,
          completionPolicy: {
            mode: options.dryRun ? 'one-successful-non-wait-action' : 'planner-confirmed',
            reason: options.dryRun
              ? 'Dry-run T084 CU-LONG rounds are evidence-generation probes; one verified non-wait GUI action produces the required round trace.'
              : 'Real T084 CU-LONG rounds must continue until the planner confirms the visible task state is complete or maxSteps is exhausted.',
            fallbackActions: [{
              type: 'scroll',
              direction: 'down',
              amount: 4,
              targetDescription: 'Main content area of the active target window',
            }],
          },
        },
        computerUseLong: {
          scenarioId: manifest.scenarioId,
          runId: manifest.run.id,
          round: options.round,
          requiredPipeline: manifest.universalPipeline,
          safetyBoundary: manifest.safetyBoundary,
        },
      },
      artifacts: [],
    }), roundTimeoutMs, `runWorkspaceRuntimeGateway timed out after ${roundTimeoutMs}ms for ${manifest.scenarioId} round ${options.round}`)
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
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
  const screenshotRefs = tracePath ? await screenshotRefsFromTrace(tracePath) : [];
  const traceEvidencePath = tracePath ? join(evidenceDir, 'vision-trace.json') : undefined;
  if (tracePath && traceEvidencePath && tracePath !== traceEvidencePath) {
    await copyFile(tracePath, traceEvidencePath);
  }

  let validation: ComputerUseLongTraceValidation | undefined;
  if (tracePath) {
    validation = await validateComputerUseLongTrace({
      scenarioId: manifest.scenarioId,
      tracePath,
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
  await writeFile(failureDiagnosticsPath, `${JSON.stringify(renderFailureDiagnostics(payload, validation, tracePath), null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeScenarioSummaryForManifest(manifestPath, manifest, [{
    manifestPath,
    scenarioId: manifest.scenarioId,
    round: options.round,
    status: round.status,
    tracePath,
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
    if (!round.visionTraceRef) {
      issues.push(`round ${round.round} missing visionTraceRef`);
    } else {
      const tracePath = resolveManifestRef(manifestDir, round.visionTraceRef);
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
      const resolved = resolveTraceRefPath(ref, resolve(manifest.run.workspacePath), manifestDir);
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
