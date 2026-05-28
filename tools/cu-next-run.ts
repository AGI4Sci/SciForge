import { lstatSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ComputerUseLongRepairDiagnostics,
  type ComputerUseLongScenarioRunResult,
  type ComputerUseLongRunValidation,
  type PreparedComputerUseLongRun,
  preflightComputerUseLong,
  prepareComputerUseLongRun,
  runComputerUseLongMatrix,
  runComputerUseLongScenario,
  validateComputerUseLongRun,
} from './computer-use-long-task-pool/internal.js';
import {
  missingEvidenceRefsFromIssues,
  repairActionsForIssues,
} from './computer-use-long-task-pool/support.js';
import {
  getCuNextTaskMapping,
  isCuNextTaskId,
  loadValidatedCuNextTaskMap,
  scenarioIdsForCuNextTask,
  type CuNextTaskMapping,
  type CuNextTaskId,
} from './computer-use-next/task-map.js';
import { validateCuNextLiveAcceptanceTaskEvidence } from './computer-use-next/live-acceptance-validator.js';
import {
  approvalChainSidecarRefsFromEvidence,
  validateCuNextApprovalChainSidecars,
  validateCuNextNeedsConfirmationSidecars,
} from './computer-use-next/approval-chain.js';
import {
  buildCuNextReadinessManifest,
  writeCuNextReadinessManifest,
} from './cu-next-readiness-manifest.js';
import { cuNextCompletionGradeEvidenceIssues } from './computer-use-next/completion-grade.js';
import { runCuL3IndependentInputAcceptanceHarness } from './cu-l3-independent-input-acceptance-harness.js';

type CuNextCommand =
  | 'list'
  | 'preflight'
  | 'prepare'
  | 'run-scenario'
  | 'run-matrix'
  | 'validate-run'
  | 'readiness';

interface CuNextRunCliArgs {
  command: CuNextCommand;
  taskId?: CuNextTaskId;
  allScenarios?: boolean;
  outRoot?: string;
  out?: string;
  runId?: string;
  workspacePath?: string;
  appUrl?: string;
  backend?: string;
  operator?: string;
  dryRun?: boolean;
  maxSteps?: number;
  rounds?: number;
  actionsJson?: string;
  promptSuffix?: string;
  approvalRef?: string;
  approvalSourceDir?: string;
  manifestPath?: string;
  targetAppName?: string;
  targetTitle?: string;
  targetMode?: 'active-window' | 'app-window' | 'window-id' | 'display';
  projectPath?: string;
  runtimeBrowserManifestPath?: string;
  searchDirs?: string[];
  userAcceptanceManifestPaths?: string[];
  kvGroundSmokePaths?: string[];
  taskMapPath?: string;
  json?: boolean;
}

export interface CuNextAcceptanceProjection {
  status: 'projected' | 'skipped' | 'failed';
  reason?: string;
  manifestStatus?: string;
  paths?: {
    verifier: string;
    input: string;
    manifest: string;
  };
}

export async function runCuNextCli(argv = process.argv): Promise<void> {
  const args = parseCuNextRunArgs(argv.slice(2));
  await hydrateCuNextRuntimeEnvFromLocalConfig(args.workspacePath);
  const map = await loadValidatedCuNextTaskMap(args.taskMapPath);

  if (args.command === 'list') {
    for (const task of [...map.tasks].sort((a, b) => a.priority - b.priority)) {
      process.stdout.write(`${task.taskId} -> ${task.primaryScenarioId} (${task.longScenarioIds.join(', ')}) ${task.slug}\n`);
    }
    return;
  }

  if (args.command === 'readiness') {
    const manifest = await buildCuNextReadinessManifest({
      projectPath: args.projectPath,
      runtimeBrowserManifestPath: args.runtimeBrowserManifestPath,
      searchDirs: args.searchDirs,
      userAcceptanceManifestPaths: args.userAcceptanceManifestPaths,
      kvGroundSmokePaths: args.kvGroundSmokePaths,
      taskMapPath: args.taskMapPath,
    });
    if (args.out) await writeCuNextReadinessManifest(args.out, manifest);
    process.stdout.write(`[${manifest.status}] CU-NEXT readiness ${manifest.tasks.filter((task) => task.status === 'passed').length}/${manifest.tasks.length} passed; completionEligible=${manifest.completionEligible}\n`);
    if (args.out) process.stdout.write(`  manifest: ${args.out}\n`);
    return;
  }

  const taskId = requireTask(args);
  const mapping = getCuNextTaskMapping(map, taskId);
  const scenarioIds = scenarioIdsForCuNextTask(mapping, args.allScenarios ? 'all' : 'primary');

  if (args.command === 'validate-run') {
    if (!args.manifestPath) throw new Error('validate-run requires --manifest <manifest.json>');
    const validation = await validateComputerUseLongRun({
      manifestPath: args.manifestPath,
      requirePassed: true,
    });
    const issues = [...validation.issues];
    if (!scenarioIds.includes(validation.scenarioId)) {
      issues.push(`${validation.scenarioId} is not mapped to ${taskId}; expected ${scenarioIds.join(', ')}.`);
    }
    const acceptanceValidation = await validateProjectedCuNextAcceptance({
      taskId,
      mapping,
      manifestPath: args.manifestPath,
      longRunValidation: validation,
    });
    issues.push(...acceptanceValidation.issues);
    const ok = validation.ok && issues.length === 0;
    const repairDiagnostics = mergeCuNextRepairDiagnostics({
      base: validation.repairDiagnostics,
      issues,
      extraMissingRefs: acceptanceValidation.missingRefs,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 'sciforge.computer-use.cu-next-validate-run-result.v1',
        ok,
        status: ok ? 'ok' : 'repair-needed',
        taskId,
        scenarioId: validation.scenarioId,
        manifestPath: validation.manifestPath,
        summaryPath: validation.summaryPath,
        issues,
        metrics: validation.metrics,
        repairDiagnostics,
      }, null, 2)}\n`);
      return;
    }
    process.stdout.write(`[${ok ? 'ok' : 'repair-needed'}] validate-run ${taskId} -> ${validation.scenarioId}\n`);
    for (const issue of issues) process.stdout.write(`  - ${issue}\n`);
    if (!ok && repairDiagnostics.nextRepairFocus.length) {
      process.stdout.write('  next repair focus:\n');
      for (const action of repairDiagnostics.nextRepairFocus) process.stdout.write(`    - ${action}\n`);
    }
    return;
  }

  if (args.command === 'preflight') {
    const result = await preflightComputerUseLong({
      scenarioIds,
      workspacePath: args.workspacePath,
      dryRun: args.dryRun,
      actionsJson: args.actionsJson,
      out: args.out,
    });
    process.stdout.write(`[${result.ok ? 'ok' : 'repair-needed'}] ${taskId} preflight -> ${scenarioIds.join(', ')}\n`);
    if (args.out) process.stdout.write(`  report: ${args.out}\n`);
    for (const check of result.checks.filter((check) => check.status !== 'pass')) {
      process.stdout.write(`  - [${check.status}] ${check.id}: ${check.message}\n`);
      if (check.repairAction) process.stdout.write(`    repair: ${check.repairAction}\n`);
    }
    return;
  }

  if (args.command === 'prepare') {
    const prepared = await prepareComputerUseLongRun({
      scenarioId: mapping.primaryScenarioId,
      outRoot: args.outRoot,
      runId: args.runId,
      workspacePath: args.workspacePath,
      appUrl: args.appUrl,
      backend: args.backend,
      operator: args.operator,
    });
    await bindPreparedRunToCuNextTask(prepared.manifestPath, mapping);
    process.stdout.write(`[ok] prepared ${taskId} via ${prepared.scenario.id}\n`);
    process.stdout.write(`  manifest: ${prepared.manifestPath}\n`);
    process.stdout.write(`  checklist: ${prepared.checklistPath}\n`);
    process.stdout.write(`  evidence: ${prepared.evidenceDir}\n`);
    return;
  }

  if (args.command === 'run-scenario') {
    const prepared = await prepareComputerUseLongRun({
      scenarioId: mapping.primaryScenarioId,
      outRoot: args.outRoot,
      runId: args.runId,
      workspacePath: args.workspacePath,
      appUrl: args.appUrl,
      backend: args.backend,
      operator: args.operator,
    });
    await bindPreparedRunToCuNextTask(prepared.manifestPath, mapping);
    const result = await runComputerUseLongScenario({
      manifestPath: prepared.manifestPath,
      rounds: args.rounds,
      dryRun: args.dryRun,
      maxSteps: args.maxSteps ?? mapping.recommendedMaxSteps,
      actionsJson: args.actionsJson,
	      promptSuffix: args.promptSuffix,
	      approvalRef: args.approvalRef,
	      approvalSourceDir: args.approvalSourceDir,
	      targetAppName: args.targetAppName ?? mapping.recommendedTargetApp,
      targetTitle: args.targetTitle,
      targetMode: args.targetMode ?? mapping.recommendedTargetMode,
    });
    const acceptance = await projectCuNextAcceptanceForScenarioRun({
      taskId,
      result,
      dryRun: args.dryRun === true,
    });
    const diagnosticPath = await writeCuNextDiagnosticSummaryIfNeeded({
      taskId,
      result,
      dryRun: args.dryRun === true,
      acceptance,
    });
    process.stdout.write(`[${result.status}] ran ${taskId} via ${result.scenarioId}\n`);
    process.stdout.write(`  manifest: ${result.manifestPath}\n`);
    process.stdout.write(`  summary: ${result.summaryPath}\n`);
    if (acceptance.status === 'projected' && acceptance.paths) {
      process.stdout.write(`  acceptance: ${acceptance.paths.manifest} (${acceptance.manifestStatus})\n`);
      process.stdout.write(`  verifier: ${acceptance.paths.verifier}\n`);
    } else if (acceptance.reason) {
      process.stdout.write(`  acceptance: ${acceptance.status} (${acceptance.reason})\n`);
    }
    if (diagnosticPath) process.stdout.write(`  diagnostic: ${diagnosticPath}\n`);
    return;
  }

  if (args.command === 'run-matrix') {
    const result = await runComputerUseLongMatrix({
      scenarioIds,
      outRoot: args.outRoot,
      workspacePath: args.workspacePath,
      appUrl: args.appUrl,
      backend: args.backend,
      operator: args.operator,
      dryRun: args.dryRun,
      skipPreflight: false,
      maxSteps: args.maxSteps ?? mapping.recommendedMaxSteps,
      actionsJson: args.actionsJson,
      targetAppName: args.targetAppName ?? mapping.recommendedTargetApp,
      targetTitle: args.targetTitle,
      targetMode: args.targetMode ?? mapping.recommendedTargetMode,
    });
    process.stdout.write(`[${result.status}] ran ${taskId} matrix -> ${scenarioIds.join(', ')}\n`);
    process.stdout.write(`  summary: ${result.summaryPath}\n`);
    return;
  }
}

async function bindPreparedRunToCuNextTask(manifestPath: string, mapping: CuNextTaskMapping): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  manifest.cuNextTaskId = mapping.taskId;
  manifest.cuNextTask = {
    taskId: mapping.taskId,
    title: mapping.title,
    slug: mapping.slug,
    primaryScenarioId: mapping.primaryScenarioId,
    longScenarioIds: mapping.longScenarioIds,
    requirements: mapping.requirements,
    recommendedTargetMode: mapping.recommendedTargetMode,
    recommendedTargetApp: mapping.recommendedTargetApp,
    recommendedMaxSteps: mapping.recommendedMaxSteps,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function projectCuNextAcceptanceForScenarioRun(options: {
  taskId: CuNextTaskId;
  result: ComputerUseLongScenarioRunResult;
  dryRun: boolean;
}): Promise<CuNextAcceptanceProjection> {
  if (options.dryRun) {
    return {
      status: 'skipped',
      reason: 'dry-run diagnostics are not projected into cu-user-acceptance-manifest.json',
    };
  }
  if (options.result.status !== 'passed') {
    return {
      status: 'skipped',
      reason: `scenario status is ${options.result.status}, not passed`,
    };
  }

  const manifest = JSON.parse(await readFile(options.result.manifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const traceRef = [...manifest.rounds].reverse().find((round) => (
    round.status === 'passed' && typeof round.visionTraceRef === 'string' && round.visionTraceRef.trim().length > 0
  ))?.visionTraceRef;
  if (!traceRef) {
    return {
      status: 'failed',
      reason: 'passed CU-LONG run has no passed round visionTraceRef to project',
    };
  }

  const tracePath = resolve(dirname(options.result.manifestPath), traceRef);
  try {
    const projection = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      taskId: options.taskId,
      scenarioId: manifest.scenarioId,
      outDir: dirname(tracePath),
    });
    return {
      status: 'projected',
      manifestStatus: projection.manifest.status,
      paths: projection.paths,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function validateProjectedCuNextAcceptance(options: {
  taskId: CuNextTaskId;
  mapping: CuNextTaskMapping;
  manifestPath: string;
  longRunValidation: ComputerUseLongRunValidation;
}): Promise<{ issues: string[]; missingRefs: string[] }> {
  const longManifestPath = resolve(options.manifestPath);
  const longManifest = JSON.parse(await readFile(longManifestPath, 'utf8')) as PreparedComputerUseLongRun;
  const traceRef = [...longManifest.rounds].reverse().find((round) => (
    round.status === 'passed' && typeof round.visionTraceRef === 'string' && round.visionTraceRef.trim().length > 0
  ))?.visionTraceRef;
  const acceptancePath = traceRef
    ? join(dirname(resolve(dirname(longManifestPath), traceRef)), 'cu-user-acceptance-manifest.json')
    : join(dirname(longManifestPath), 'cu-user-acceptance-manifest.json');
  try {
    const manifest = JSON.parse(await readFile(acceptancePath, 'utf8')) as Record<string, unknown>;
    const issues: string[] = [];
    if (options.mapping.requirements.includes('l3-workflow-refs') && options.longRunValidation.metrics.realTraceCount === 0) {
      issues.push('completion-grade: CU-NEXT L3 validate-run requires at least one non-dry-run Computer Use vision trace; dry-run/fixture traces are diagnostic-only.');
    }
    if (manifest.schemaVersion !== 'sciforge.computer-use.user-acceptance-manifest.v1') {
      issues.push(`${acceptancePath} is not a CU user acceptance manifest.`);
    }
    if (manifest.taskId !== options.taskId) {
      issues.push(`${acceptancePath} taskId must be ${options.taskId}, got ${String(manifest.taskId ?? 'missing')}.`);
    }
    if (manifest.level !== 'L3') issues.push(`${acceptancePath} level must be L3.`);
    const requiredStatus = expectedCuNextAcceptanceManifestStatus(options.taskId);
    if (manifest.status !== requiredStatus) {
      issues.push(`${acceptancePath} status must be ${requiredStatus} for CU-NEXT readiness.`);
    }
    const refRecords = await readApprovalChainRefRecords(acceptancePath, manifest);
    const liveAcceptance = validateCuNextLiveAcceptanceTaskEvidence({
      taskId: options.taskId,
      evidence: manifest,
      taskMappings: [options.mapping],
      refRecords,
    });
    if (!liveAcceptance.ok) {
      for (const issue of liveAcceptance.issues) {
        issues.push(`${acceptancePath} live acceptance ${issue.id}${issue.path ? ` at ${issue.path}` : ''}: ${issue.reason}`);
      }
    }
    if (options.taskId === 'CU-NEXT-03' || options.taskId === 'CU-NEXT-06') {
      const approvalChainIssues = await readAndValidateApprovalChainSidecars(acceptancePath, manifest);
      for (const issue of approvalChainIssues) {
        issues.push(`${acceptancePath} approval-chain ${issue.id}${issue.path ? ` at ${issue.path}` : ''}: ${issue.reason}`);
      }
    }
    const completionEvidenceData = await readLiveAcceptanceLocalJsonRef(acceptancePath, stringValue(manifest.completionEvidenceRef));
    const completionGradeIssues = cuNextCompletionGradeEvidenceIssues(
      manifest,
      options.mapping,
      completionEvidenceData,
      {
        refScopeDescription: 'the current acceptance evidence bundle',
        refExists: (ref) => liveAcceptanceRegularRefExists(acceptancePath, ref),
      },
    );
    for (const issue of completionGradeIssues) {
      issues.push(`${acceptancePath} completion-grade: ${issue}`);
    }
    const missingRefs = await missingLiveAcceptanceFileRefs(acceptancePath, manifest);
    for (const ref of missingRefs) {
      issues.push(`${acceptancePath} live acceptance missing-ref: required evidence ref ${ref} was not found next to the acceptance manifest.`);
    }
    return { issues, missingRefs };
  } catch {
    if (!options.longRunValidation.ok) return { issues: [], missingRefs: [] };
    return {
      issues: [`cu-user-acceptance-manifest.json is missing for passed ${options.taskId} run; run computer-use-next:run-scenario to project L3 evidence.`],
      missingRefs: ['cu-user-acceptance-manifest.json'],
    };
  }
}

async function missingLiveAcceptanceFileRefs(acceptancePath: string, manifest: Record<string, unknown>) {
  const refs = collectLiveAcceptanceFileRefs(manifest);
  const missing: string[] = [];
  for (const ref of refs) {
    if (!liveAcceptanceRegularRefExists(acceptancePath, ref)) {
      missing.push(ref);
    }
  }
  return missing;
}

function liveAcceptanceRegularRefExists(acceptancePath: string, ref: string) {
  return liveAcceptanceRegularRefPath(acceptancePath, ref) !== undefined;
}

function liveAcceptanceRegularRefPath(acceptancePath: string, ref: string) {
  if (!isLocalFileEvidenceRef(ref)) return undefined;
  const baseDir = dirname(resolve(acceptancePath));
  const target = resolve(baseDir, ref);
  try {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    const baseReal = realpathSync(baseDir);
    const targetReal = realpathSync(target);
    if (!isPathInsideOrSame(baseReal, targetReal)) return undefined;
    return target;
  } catch {
    return undefined;
  }
}

function collectLiveAcceptanceFileRefs(manifest: Record<string, unknown>) {
  const appWorkflow = recordValue(manifest.appWorkflow);
  const screenshotRefs = recordValue(manifest.screenshotRefs);
  const executorLease = recordValue(manifest.executorLease);
  const verifierVerdict = recordValue(manifest.verifierVerdict);
  const guiPresent = recordValue(manifest.guiPresent);
  const refs = [
    ...stringArray(appWorkflow.windowSwitchTraceRefs),
    ...stringArray(screenshotRefs.before),
    ...stringArray(screenshotRefs.after),
    ...stringArray(manifest.focusCropRefs),
    ...stringArray(manifest.groundingDiagnosticsRefs),
    stringValue(executorLease.ref),
    stringValue(manifest.finalArtifactRef),
    stringValue(manifest.finalVisibleScreenshotRef),
    stringValue(verifierVerdict.ref),
    stringValue(guiPresent.recordRef),
    stringValue(guiPresent.payloadRef),
    stringValue(manifest.completionEvidenceRef),
    ...stringArray(guiPresent.displayedRefs),
    ...records(manifest.tuiHostChain).flatMap((link) => [
      stringValue(link.requestRef),
      stringValue(link.hostPortsRef),
      stringValue(link.toolPayloadRef),
      stringValue(link.recordRef),
    ]),
    ...records(manifest.evidenceClaims).flatMap((claim) => [
      stringValue(claim.ref),
      ...stringArray(claim.refs),
      ...stringArray(claim.recordRefs),
      ...stringArray(claim.evidenceRefs),
      ...stringArray(claim.artifactRefs),
    ]),
    ...records(manifest.evidenceMarkers).flatMap(markerFileRefs),
  ];
  return [...new Set(refs.filter((ref): ref is string => Boolean(ref)))];
}

async function readAndValidateApprovalChainSidecars(
  acceptancePath: string,
  manifest: Record<string, unknown>,
) {
  const refs = approvalChainSidecarRefsFromEvidence(manifest);
  const sidecars = {
    approvalRequest: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.approvalRequestRef),
    guiAskUser: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.guiAskUserRecordRef),
    confirmedRequest: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.confirmedRequestRef),
    riskAudit: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.riskAuditRef),
    sourceApprovalRequest: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.sourceApprovalRequestRef),
    sourceGuiAskUser: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.sourceGuiAskUserRecordRef),
    sourceRiskAudit: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.sourceRiskAuditRef),
    approvalDecision: await readLiveAcceptanceLocalJsonRef(acceptancePath, refs.approvalDecisionRef),
  };
  return manifest.taskId === 'CU-NEXT-03'
    ? validateCuNextNeedsConfirmationSidecars({ sidecars, refs })
    : validateCuNextApprovalChainSidecars({ sidecars, refs });
}

async function readApprovalChainRefRecords(
  acceptancePath: string,
  manifest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const refs = approvalChainSidecarRefsFromEvidence(manifest);
  const markerRefs = records(manifest.evidenceMarkers).flatMap(markerFileRefs);
  const recordsByRef: Record<string, unknown> = {};
  await Promise.all(uniqueStrings([
    ...Object.values(refs).filter((ref): ref is string => Boolean(ref)),
    ...markerRefs,
  ]).map(async (ref) => {
    const record = await readLiveAcceptanceLocalJsonRef(acceptancePath, ref);
    if (record !== undefined) recordsByRef[ref] = record;
  }));
  return recordsByRef;
}

async function readLiveAcceptanceLocalJsonRef(acceptancePath: string, ref: string | undefined) {
  if (!ref) return undefined;
  const target = liveAcceptanceRegularRefPath(acceptancePath, ref);
  if (!target) return undefined;
  try {
    return JSON.parse(await readFile(target, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function markerFileRefs(marker: Record<string, unknown>) {
  const refs: string[] = [];
  for (const [key, value] of Object.entries(marker)) {
    if (!/ref/i.test(key)) continue;
    refs.push(...stringArrayOrSingle(value).filter((ref) => !ref.trim().startsWith('approval:')));
  }
  return refs;
}

function stringArrayOrSingle(value: unknown) {
  const single = stringValue(value);
  if (single) return [single];
  return stringArray(value);
}

function isLocalFileEvidenceRef(ref: string) {
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (isAbsolute(trimmed) || trimmed.startsWith('~')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  const parts = trimmed.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function isPathInsideOrSame(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export async function writeCuNextDiagnosticSummaryIfNeeded(options: {
  taskId: CuNextTaskId;
  result: ComputerUseLongScenarioRunResult;
  dryRun: boolean;
  acceptance: CuNextAcceptanceProjection;
}): Promise<string | undefined> {
  const acceptancePassed = isSuccessfulCuNextAcceptanceProjection(options.taskId, options.acceptance);
  if (!options.dryRun && options.result.status === 'passed' && acceptancePassed) return undefined;

  const diagnosticPath = join(dirname(options.result.manifestPath), 'cu-next-diagnostic-summary.json');
  await mkdir(dirname(diagnosticPath), { recursive: true });
  const baseTaskId = await readManifestTaskId(options.result.manifestPath);
  const reasons = [
    options.dryRun ? 'dry-run diagnostics are never readiness evidence' : undefined,
    options.result.status !== 'passed' ? `scenario status is ${options.result.status}` : undefined,
    !acceptancePassed ? `acceptance projection is ${options.acceptance.status}${options.acceptance.manifestStatus ? `/${options.acceptance.manifestStatus}` : ''}` : undefined,
    options.acceptance.reason,
  ].filter((reason): reason is string => Boolean(reason));
  const acceptanceRepair = await readAcceptanceProjectionRepairDiagnostics(options.acceptance);
  const repairDiagnostics = mergeCuNextRepairDiagnostics({
    base: options.result.validation?.repairDiagnostics,
    issues: [
      ...reasons,
      ...(options.result.validation?.issues ?? []),
      ...acceptanceRepair.issues,
    ],
    extraMissingRefs: [
      ...missingRefsFromAcceptanceProjection(options.acceptance),
      ...acceptanceRepair.missingRefs,
    ],
    failingRoundDiagnosticsRefs: options.result.roundResults
      .filter((round) => round.status !== 'passed')
      .map((round) => round.failureDiagnosticsPath),
  });
  const summary = {
    schemaVersion: 'sciforge.computer-use.cu-next-diagnostic-summary.v1',
    createdAt: new Date().toISOString(),
    cuNextTaskId: options.taskId,
    baseTaskId,
    scenarioId: options.result.scenarioId,
    diagnosticOnly: true,
    acceptanceEligible: false,
    readinessEligible: false,
    dryRun: options.dryRun,
    manifestPath: options.result.manifestPath,
    scenarioSummaryPath: options.result.summaryPath,
    runStatus: options.result.status,
    attemptedRounds: options.result.attemptedRounds,
    passedRounds: options.result.passedRounds,
    repairNeededRound: options.result.repairNeededRound,
    acceptanceProjection: options.acceptance,
    acceptanceDiagnostics: acceptanceRepair,
    repairDiagnostics,
    diagnosis: reasons,
  };
  await writeFile(diagnosticPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return diagnosticPath;
}

function mergeCuNextRepairDiagnostics(options: {
  base?: ComputerUseLongRepairDiagnostics;
  issues: string[];
  extraMissingRefs?: string[];
  failingRoundDiagnosticsRefs?: string[];
}): ComputerUseLongRepairDiagnostics {
  const base = options.base;
  const actionShortfalls = [...(base?.actionShortfalls ?? [])];
  const repairIssues = [
    ...options.issues,
    ...(base?.failureReasons ?? []),
  ].filter(Boolean);
  const missingRefs = dedupeStrings([
    ...(base?.missingRefs ?? []),
    ...(options.extraMissingRefs ?? []),
    ...missingEvidenceRefsFromIssues(options.issues),
  ]);
  const nextRepairFocus = repairIssues.length ? repairActionsForIssues(repairIssues) : [];
  const repairDiagnostics: ComputerUseLongRepairDiagnostics = {
    actionShortfalls,
    missingRefs,
    failingRoundDiagnosticsRefs: dedupeStrings([
      ...(base?.failingRoundDiagnosticsRefs ?? []),
      ...(options.failingRoundDiagnosticsRefs ?? []),
    ]),
    failureReasons: dedupeStrings(base?.failureReasons ?? []),
    traceMetricsByRound: base?.traceMetricsByRound ?? [],
    nextRepairFocus,
  };
  if (base?.actionShortfall) repairDiagnostics.actionShortfall = base.actionShortfall;
  if (!repairDiagnostics.actionShortfall && actionShortfalls[0]) repairDiagnostics.actionShortfall = actionShortfalls[0];
  return repairDiagnostics;
}

async function readAcceptanceProjectionRepairDiagnostics(
  acceptance: CuNextAcceptanceProjection,
): Promise<{ issues: string[]; missingRefs: string[] }> {
  const manifestPath = acceptance.paths?.manifest;
  if (!manifestPath) return { issues: [], missingRefs: [] };
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const issues: string[] = [];
    const missingRefs = await missingLiveAcceptanceFileRefs(manifestPath, manifest);
    if (manifest.status && manifest.status !== 'multi-app-workflow-passed' && manifest.status !== 'needs-confirmation') {
      issues.push(`acceptance manifest status is ${String(manifest.status)}`);
    }
    if (!stringValue(manifest.finalArtifactRef)) {
      issues.push('acceptance finalArtifactRef is missing');
      missingRefs.push('finalArtifactRef');
    }
    const verifierVerdict = recordValue(manifest.verifierVerdict);
    if (verifierVerdict.status && verifierVerdict.status !== 'passed') {
      issues.push(`acceptance verifierVerdict is ${String(verifierVerdict.status)}`);
    }
    for (const reason of stringArray(verifierVerdict.reasons)) issues.push(`acceptance verifier: ${reason}`);
    for (const issue of stringArray(verifierVerdict.blockers)) issues.push(`acceptance verifier: ${issue}`);
    return {
      issues: dedupeStrings(issues),
      missingRefs: dedupeStrings(missingRefs),
    };
  } catch {
    return {
      issues: [`acceptance manifest is missing or invalid at ${manifestPath}`],
      missingRefs: [manifestPath],
    };
  }
}

function missingRefsFromAcceptanceProjection(acceptance: CuNextAcceptanceProjection) {
  return missingEvidenceRefsFromIssues([
    acceptance.reason ?? '',
    acceptance.manifestStatus ? `acceptance projection manifestStatus ${acceptance.manifestStatus}` : '',
  ]);
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim())));
}

export function expectedCuNextAcceptanceManifestStatus(taskId: CuNextTaskId): CuNextProjectedAcceptanceManifestStatus {
  return taskId === 'CU-NEXT-03' ? 'needs-confirmation' : 'multi-app-workflow-passed';
}

type CuNextProjectedAcceptanceManifestStatus = 'multi-app-workflow-passed' | 'needs-confirmation';

export function isSuccessfulCuNextAcceptanceProjection(
  taskId: CuNextTaskId,
  acceptance: Pick<CuNextAcceptanceProjection, 'status' | 'manifestStatus'>,
): boolean {
  return acceptance.status === 'projected'
    && acceptance.manifestStatus === expectedCuNextAcceptanceManifestStatus(taskId);
}

async function readManifestTaskId(manifestPath: string) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<PreparedComputerUseLongRun>;
    return typeof manifest.taskId === 'string' && manifest.taskId.trim() ? manifest.taskId : undefined;
  } catch {
    return undefined;
  }
}

export function parseCuNextRunArgs(args: string[]): CuNextRunCliArgs {
  const command = args[0] as CuNextCommand | undefined;
  if (!command || !['list', 'preflight', 'prepare', 'run-scenario', 'run-matrix', 'validate-run', 'readiness'].includes(command)) {
    throw new Error('Usage: tsx tools/cu-next-run.ts <list|preflight|prepare|run-scenario|run-matrix|validate-run|readiness> [options]');
  }
  const parsed: CuNextRunCliArgs = { command };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--task') {
      const value = readArg(args, index, arg);
      if (!isCuNextTaskId(value)) throw new Error(`Unknown CU-NEXT task: ${value}`);
      parsed.taskId = value;
      index += 1;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--all-scenarios') {
      parsed.allScenarios = true;
    } else if (arg === '--out-root') {
      parsed.outRoot = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--out') {
      parsed.out = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--run-id') {
      parsed.runId = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--workspace-path') {
      parsed.workspacePath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--app-url') {
      parsed.appUrl = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--backend') {
      parsed.backend = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--operator') {
      parsed.operator = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--real') {
      parsed.dryRun = false;
    } else if (arg === '--max-steps') {
      parsed.maxSteps = Number(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--rounds') {
      parsed.rounds = Number(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--actions-json') {
      parsed.actionsJson = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--prompt-suffix') {
      parsed.promptSuffix = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--approval-ref') {
      parsed.approvalRef = normalizeApprovalRef(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--approval-source-dir') {
      parsed.approvalSourceDir = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--manifest') {
      parsed.manifestPath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--target-app') {
      parsed.targetAppName = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--target-title') {
      parsed.targetTitle = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--target-mode') {
      parsed.targetMode = normalizeTargetMode(readArg(args, index, arg));
      index += 1;
    } else if (arg === '--project') {
      parsed.projectPath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--browser-manifest') {
      parsed.runtimeBrowserManifestPath = readArg(args, index, arg);
      index += 1;
    } else if (arg === '--search-dir') {
      parsed.searchDirs = [...(parsed.searchDirs ?? []), readArg(args, index, arg)];
      index += 1;
    } else if (arg === '--acceptance-manifest') {
      parsed.userAcceptanceManifestPaths = [...(parsed.userAcceptanceManifestPaths ?? []), readArg(args, index, arg)];
      index += 1;
    } else if (arg === '--kv-ground-smoke') {
      parsed.kvGroundSmokePaths = [...(parsed.kvGroundSmokePaths ?? []), readArg(args, index, arg)];
      index += 1;
    } else if (arg === '--task-map') {
      parsed.taskMapPath = readArg(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function hydrateCuNextRuntimeEnvFromLocalConfig(workspacePath?: string): Promise<void> {
  const localConfigPath = process.env.SCIFORGE_CONFIG_PATH?.trim()
    ? resolve(process.env.SCIFORGE_CONFIG_PATH)
    : resolve('config.local.json');
  const configs = (await Promise.all([
    readOptionalLocalJson(localConfigPath),
    workspacePath ? readOptionalLocalJson(resolve(workspacePath, '.sciforge', 'config.json')) : undefined,
    workspacePath ? readOptionalLocalJson(resolve(workspacePath, '.sciforge', 'config.local.json')) : undefined,
  ])).filter(isRecord);
  if (!configs.length) return;

  const apiKey = firstConfigString(configs, [
    ['apiKey'],
    ['llm', 'apiKey'],
    ['llm', 'upstreamApiKey'],
    ['codexProxy', 'apiKey'],
    ['runtimeCodexProxy', 'apiKey'],
  ]);
  const upstreamBaseUrl = stripTrailingSlash(firstConfigString(configs, [
    ['modelBaseUrl'],
    ['llm', 'baseUrl'],
    ['llm', 'upstreamBaseUrl'],
    ['codexProxy', 'upstreamBaseUrl'],
    ['codexProxy', 'baseUrl'],
    ['runtimeCodexProxy', 'upstreamBaseUrl'],
    ['runtimeCodexProxy', 'baseUrl'],
  ]));
  const model = firstConfigString(configs, [
    ['modelName'],
    ['llm', 'model'],
    ['llm', 'modelName'],
    ['codexProxy', 'defaultModel'],
    ['codexProxy', 'model'],
    ['runtimeCodexProxy', 'defaultModel'],
    ['runtimeCodexProxy', 'model'],
  ]);
  const provider = firstConfigString(configs, [
    ['runtimeProvider'],
    ['codexProxy', 'runtimeProvider'],
    ['codexProxy', 'provider'],
    ['runtimeCodexProxy', 'runtimeProvider'],
    ['runtimeCodexProxy', 'provider'],
  ]) ?? (upstreamBaseUrl ? 'sciforge-deepseek-proxy' : undefined);
  const plannerProfile = firstConfigString(configs, [
    ['computerUse', 'plannerProfile'],
    ['visionSense', 'plannerProfile'],
  ]);
  const grounderBaseUrl = stripTrailingSlash(firstConfigString(configs, [
    ['visionSense', 'grounderBaseUrl'],
  ]));
  const inputAdapter = firstConfigString(configs, [
    ['visionSense', 'inputAdapter'],
    ['visionSense', 'independentInputAdapter'],
    ['computerUse', 'inputAdapter'],
  ]);
  const inputAdapterProvider = firstConfigString(configs, [
    ['visionSense', 'independentInputAdapterProvider'],
    ['visionSense', 'inputAdapterProvider'],
    ['computerUse', 'independentInputAdapterProvider'],
    ['computerUse', 'inputAdapterProvider'],
  ]);
  const grounderUploadStrategy = firstConfigString(configs, [
    ['visionSense', 'grounderUploadStrategy'],
  ]);
  const visionVlmModel = firstConfigString(configs, [
    ['visionSense', 'vlmModel'],
    ['visionSense', 'visionModel'],
  ]);

  setEnvIfMissing('SCIFORGE_RUNTIME_API_KEY', apiKey);
  setEnvIfMissing('SCIFORGE_RUNTIME_PROVIDER', provider);
  setEnvIfMissing('SCIFORGE_RUNTIME_BASE_URL', upstreamBaseUrl);
  setEnvIfMissing('SCIFORGE_PROXY_UPSTREAM_BASE_URL', upstreamBaseUrl);
  setEnvIfMissing('SCIFORGE_RUNTIME_MODEL', model);
  setEnvIfMissing('SCIFORGE_PROXY_DEFAULT_MODEL', model);
  setEnvIfMissing('SCIFORGE_COMPUTER_USE_PLANNER_PROFILE', plannerProfile);
  setEnvIfMissing('SCIFORGE_VISION_KV_GROUND_URL', grounderBaseUrl);
  setEnvIfMissing('SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY', grounderUploadStrategy);
  setEnvIfMissing('SCIFORGE_VISION_INPUT_ADAPTER', inputAdapter);
  setEnvIfMissing('SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER', inputAdapterProvider);
  setEnvIfMissing('SCIFORGE_VISION_VLM_MODEL', visionVlmModel);
}

async function readOptionalLocalJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function firstConfigString(configs: Record<string, unknown>[], paths: string[][]): string | undefined {
  for (const path of paths) {
    for (const config of configs) {
      const value = getConfigString(config, path);
      if (value) return value;
    }
  }
  return undefined;
}

function getConfigString(config: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  if (typeof cursor === 'string' && cursor.trim()) return cursor.trim();
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return String(cursor);
  if (typeof cursor === 'boolean') return cursor ? 'true' : 'false';
  return undefined;
}

function setEnvIfMissing(key: string, value: string | undefined): void {
  if (process.env[key] !== undefined) return;
  if (value) process.env[key] = value;
}

function stripTrailingSlash(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireTask(args: CuNextRunCliArgs): CuNextTaskId {
  if (!args.taskId) throw new Error(`${args.command} requires --task <CU-NEXT-##>`);
  return args.taskId;
}

function readArg(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function normalizeTargetMode(value: string): CuNextRunCliArgs['targetMode'] {
  if (value === 'active-window' || value === 'app-window' || value === 'window-id' || value === 'display') return value;
  throw new Error(`Invalid --target-mode ${value}`);
}

function normalizeApprovalRef(value: string): string {
  const trimmed = value.trim();
  if (!/^approval:[A-Za-z0-9._:@/-]+$/.test(trimmed)) {
    throw new Error('--approval-ref must be a non-empty approval: token');
  }
  return trimmed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCuNextCli(process.argv);
}
