import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { DeepRunManifest } from './deep-test-manifest';
import { validateDeepRunManifest } from './deep-test-manifest';
import {
  expectedArtifactsFromRound,
  manifestPathForScenario,
  renderArtifactEvidenceCommand,
  renderBrowserScreenshotCommand,
  renderComputerUseScreenshotCommand,
  renderExecutionEvidenceCommand,
  renderGapCommands,
  renderRecordRoundCommand,
  shellQuote,
} from './longform-regression-evidence';

export interface LongformScenarioScript {
  schemaVersion: '1.0';
  taskId: 'T060';
  scenarioId: string;
  title: string;
  goal: string;
  scenarioPackageId: string;
  minRounds: number;
  backendRequirement: string;
  rounds: LongformScenarioRound[];
  evidencePlan: {
    browser: string[];
    computerUse: string[];
    workspace: string[];
  };
  blockerTemplate: string;
  scoringDimensions: string[];
}

export interface LongformScenarioRound {
  round: number;
  prompt: string;
  referenceOps: LongformReferenceOperation[];
  expectedArtifacts: string[];
  acceptanceChecks: string[];
}

export interface LongformReferenceOperation {
  kind: string;
  marker?: string;
  source: string;
  requiredPayload?: string[];
  expectedHighlight?: string;
}

export interface PrepareLongformRegressionOptions {
  scenario?: string;
  scriptsDir?: string;
  outRoot?: string;
  runId?: string;
  appUrl?: string;
  workspacePath?: string;
  backend?: string;
  modelProvider?: string;
  modelName?: string;
  operator?: string;
  status?: DeepRunManifest['status'];
  coverageStage?: DeepRunManifest['coverageStage'];
}

export interface PreparedLongformRegression {
  scenarioId: string;
  directory: string;
  manifestPath: string;
  checklistPath: string;
  evidenceDirectory: string;
  manifest: DeepRunManifest;
}

export interface PrepareLongformWeeklyRegressionOptions extends PrepareLongformRegressionOptions {
  manifests: DeepRunManifest[];
  weeklyRequiredPassedRealRuns?: number;
  now?: Date;
  skipPending?: boolean;
}

export interface PreparedLongformWeeklyRegression {
  status: LongformRegressionStatus;
  prepared: PreparedLongformRegression[];
  skipped: Array<{
    scenarioId: string;
    reason: string;
    latestRunId?: string;
  }>;
}

export interface RecordLongformRoundOptions {
  manifestPath: string;
  round: number;
  status: DeepRunManifest['rounds'][number]['status'];
  observedBehavior: string;
  artifactRefs?: string[];
  executionUnitRefs?: string[];
  screenshotRefs?: string[];
  completedAt?: string;
  updateRunStatus?: boolean;
}

export type LongformEvidenceInput =
  | { kind: 'artifact'; artifact: DeepRunManifest['artifacts'][number] }
  | { kind: 'execution-unit'; executionUnit: DeepRunManifest['executionUnits'][number] }
  | { kind: 'screenshot'; screenshot: DeepRunManifest['screenshots'][number] };

export interface RecordLongformEvidenceOptions {
  manifestPath: string;
  evidence: LongformEvidenceInput;
}

export interface FinalizeLongformRegressionOptions {
  manifestPath: string;
  status?: DeepRunManifest['status'];
  coverageStage?: DeepRunManifest['coverageStage'];
  completedAt?: string;
  qualityScores?: Partial<DeepRunManifest['qualityScores']>;
  notes?: string;
  appendNotes?: boolean;
  failurePoint?: DeepRunManifest['failurePoints'][number];
}

export interface LongformNextRound {
  scenarioId: string;
  title: string;
  runId: string;
  manifestStatus: DeepRunManifest['status'];
  appUrl?: string;
  progress: {
    completedRounds: number;
    totalRounds: number;
    nextRoundNumber?: number;
  };
  round?: DeepRunManifest['rounds'][number];
  referenceOps: LongformReferenceOperation[];
  expectedArtifacts: string[];
  acceptanceChecks: string[];
  recordCommand?: string;
}

export interface LongformEvidenceGapReport {
  scenarioId: string;
  title: string;
  runId: string;
  status: DeepRunManifest['status'];
  readyToFinalizePassed: boolean;
  completedRounds: number;
  totalRounds: number;
  missing: {
    rounds: number[];
    roundArtifactRefs: number[];
    roundExecutionRefs: number[];
    roundScreenshotRefs: number[];
    evidenceClasses: string[];
    producedArtifacts: boolean;
    referenceImpact: boolean;
    completedAt: boolean;
    blocker: boolean;
  };
  suggestedCommands: string[];
  qualityIssues: string[];
}

export interface LongformEvidenceCommandPlan {
  scenarioId: string;
  runId: string;
  roundCommands: Array<{
    round: number;
    status: DeepRunManifest['rounds'][number]['status'];
    command: string;
  }>;
  evidenceCommands: string[];
  finalizeCommand: string;
}

export interface LongformOperatorRunbook {
  scenarioId: string;
  runId: string;
  path: string;
  markdown: string;
}

export interface WriteLongformOperatorRunbookOptions {
  manifestPath: string;
  manifest: DeepRunManifest;
  script?: LongformScenarioScript;
  outPath?: string;
}

export interface LongformQualityGateResult {
  scenarioId: string;
  pass: boolean;
  issues: string[];
}

export interface LongformRegressionStatus {
  scenarioCount: number;
  manifestCount: number;
  passedCount: number;
  pendingCount: number;
  repairNeededCount: number;
  failedCount: number;
  currentWeekPassedRealRuns: number;
  weeklyRequiredPassedRealRuns: number;
  weeklyRequirementMet: boolean;
  weeklyDeficit: number;
  nextRecommendedScenarioIds: string[];
  scenarios: LongformScenarioStatus[];
}

export interface LongformScenarioStatus {
  scenarioId: string;
  title: string;
  hasScript: boolean;
  manifestCount: number;
  latestStatus: DeepRunManifest['status'] | 'missing';
  latestRunId?: string;
  latestCompletedAt?: string;
  latestStartedAt?: string;
  passedRuns: number;
  pendingRuns: number;
  qualityIssues: string[];
}

export async function loadLongformScenarioScripts(scriptsDir = resolve('tests', 'longform', 'scenarios')) {
  const files = (await readdir(scriptsDir)).filter((file) => file.endsWith('.json')).sort();
  const scripts: LongformScenarioScript[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(scriptsDir, file), 'utf8')) as unknown;
    const script = raw as LongformScenarioScript;
    scripts.push(script);
  }
  return scripts;
}

export function validateLongformRunManifest(manifest: DeepRunManifest, script?: LongformScenarioScript): LongformQualityGateResult {
  const issues: string[] = [];
  if (manifest.taskId !== 'T060') issues.push('manifest.taskId must be T060 for longform validation');
  if (manifest.status === 'not-run') {
    return { scenarioId: manifest.scenarioId, pass: true, issues };
  }

  const minimumRounds = script?.minRounds ?? 6;
  if (manifest.rounds.length < minimumRounds) issues.push(`expected at least ${minimumRounds} rounds`);
  const completedRounds = manifest.rounds.filter((round) => round.status === 'passed').length;
  if (manifest.status === 'passed' && completedRounds < minimumRounds) {
    issues.push(`passed longform run needs ${minimumRounds}+ passed rounds; got ${completedRounds}`);
  }

  const referenceOps = script?.rounds.flatMap((round) => round.referenceOps) ?? referenceOpsFromManifest(manifest);
  const referenceKinds = new Set(referenceOps.map((op) => op.kind));
  if (referenceOps.length < 2) issues.push('expected at least two reference operations');
  if (referenceKinds.size < 2) issues.push('expected at least two reference operation types');

  if (manifest.status === 'passed') {
    const evidenceClasses = evidenceClassesForManifest(manifest);
    for (const required of ['browser', 'computer-use', 'workspace']) {
      if (!evidenceClasses.has(required)) issues.push(`missing ${required} evidence`);
    }
    if (manifest.artifacts.filter((artifact) => artifact.status !== 'missing').length === 0) {
      issues.push('passed longform run must record at least one produced artifact');
    }
    if (!manifest.rounds.some((round) => (round.artifactRefs?.length ?? 0) > 0)) {
      issues.push('passed longform run must attach artifact refs to at least one round');
    }
    if (!mentionsReferenceImpact(manifest)) {
      issues.push('passed longform run must explain how explicit references changed the answer, artifact, plan, or next step');
    }
    if (!manifest.run.completedAt) {
      issues.push('passed longform run must record a completedAt timestamp');
    }
  }

  if (manifest.status === 'repair-needed' || manifest.status === 'failed') {
    const blockers = manifest.failurePoints.filter((failure) => failure.severity === 'blocker' || failure.category === 'model' || failure.category === 'runtime');
    if (!blockers.length) issues.push(`${manifest.status} longform run should record a concrete model/runtime blocker`);
  }

  return { scenarioId: manifest.scenarioId, pass: issues.length === 0, issues };
}

export function summarizeLongformRegressionStatus({
  scripts,
  manifests,
  now = new Date(),
  weeklyRequiredPassedRealRuns = 2,
}: {
  scripts: LongformScenarioScript[];
  manifests: DeepRunManifest[];
  now?: Date;
  weeklyRequiredPassedRealRuns?: number;
}): LongformRegressionStatus {
  const scriptById = new Map(scripts.map((script) => [script.scenarioId, script]));
  const relevantManifests = manifests.filter((manifest) => manifest.taskId === 'T060' || scriptById.has(manifest.scenarioId));
  const manifestsByScenario = new Map<string, DeepRunManifest[]>();
  for (const manifest of relevantManifests) {
    const current = manifestsByScenario.get(manifest.scenarioId) ?? [];
    current.push(manifest);
    manifestsByScenario.set(manifest.scenarioId, current);
  }
  const scenarioIds = uniqueStrings([...scripts.map((script) => script.scenarioId), ...relevantManifests.map((manifest) => manifest.scenarioId)]).sort();
  const scenarios = scenarioIds.map((scenarioId): LongformScenarioStatus => {
    const script = scriptById.get(scenarioId);
    const scenarioManifests = [...(manifestsByScenario.get(scenarioId) ?? [])].sort(compareManifestRecency).reverse();
    const latest = scenarioManifests[0];
    const qualityIssues = latest ? validateLongformRunManifest(latest, script).issues : ['missing longform manifest'];
    return {
      scenarioId,
      title: script?.title ?? latest?.title ?? scenarioId,
      hasScript: Boolean(script),
      manifestCount: scenarioManifests.length,
      latestStatus: latest?.status ?? 'missing',
      latestRunId: latest?.run.id,
      latestCompletedAt: latest?.run.completedAt,
      latestStartedAt: latest?.run.startedAt,
      passedRuns: scenarioManifests.filter((manifest) => manifest.status === 'passed').length,
      pendingRuns: scenarioManifests.filter((manifest) => manifest.status === 'not-run').length,
      qualityIssues,
    };
  });
  const currentWeekPassedRealRuns = relevantManifests.filter((manifest) => isPassedRealRunInCurrentWeek(manifest, now)).length;
  const weeklyDeficit = Math.max(0, weeklyRequiredPassedRealRuns - currentWeekPassedRealRuns);
  const currentWeekPassedScenarioIds = new Set(
    relevantManifests.filter((manifest) => isPassedRealRunInCurrentWeek(manifest, now)).map((manifest) => manifest.scenarioId),
  );
  const nextRecommendedScenarioIds = recommendNextScenarioIds(scenarios, currentWeekPassedScenarioIds, weeklyDeficit);
  return {
    scenarioCount: scripts.length,
    manifestCount: relevantManifests.length,
    passedCount: relevantManifests.filter((manifest) => manifest.status === 'passed').length,
    pendingCount: relevantManifests.filter((manifest) => manifest.status === 'not-run').length,
    repairNeededCount: relevantManifests.filter((manifest) => manifest.status === 'repair-needed').length,
    failedCount: relevantManifests.filter((manifest) => manifest.status === 'failed').length,
    currentWeekPassedRealRuns,
    weeklyRequiredPassedRealRuns,
    weeklyRequirementMet: currentWeekPassedRealRuns >= weeklyRequiredPassedRealRuns,
    weeklyDeficit,
    nextRecommendedScenarioIds,
    scenarios,
  };
}

export async function prepareLongformRegression(options: PrepareLongformRegressionOptions = {}) {
  const scripts = (await loadLongformScenarioScripts(options.scriptsDir))
    .filter((script) => !options.scenario || script.scenarioId === options.scenario || basename(script.scenarioId) === options.scenario);
  if (!scripts.length) {
    throw new Error(options.scenario ? `No longform scenario matched: ${options.scenario}` : 'No longform scenarios found');
  }
  const prepared: PreparedLongformRegression[] = [];
  for (const script of scripts) {
    prepared.push(await prepareScenario(script, options));
  }
  return prepared;
}

export async function prepareLongformWeeklyRegression(options: PrepareLongformWeeklyRegressionOptions): Promise<PreparedLongformWeeklyRegression> {
  const scripts = await loadLongformScenarioScripts(options.scriptsDir);
  const status = summarizeLongformRegressionStatus({
    scripts,
    manifests: options.manifests,
    now: options.now,
    weeklyRequiredPassedRealRuns: options.weeklyRequiredPassedRealRuns,
  });
  const scriptById = new Map(scripts.map((script) => [script.scenarioId, script]));
  const statusById = new Map(status.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const prepared: PreparedLongformRegression[] = [];
  const skipped: PreparedLongformWeeklyRegression['skipped'] = [];
  const skipPending = options.skipPending !== false;

  for (const scenarioId of status.nextRecommendedScenarioIds) {
    const script = scriptById.get(scenarioId);
    if (!script) {
      skipped.push({ scenarioId, reason: 'missing scenario script' });
      continue;
    }
    const scenarioStatus = statusById.get(scenarioId);
    if (skipPending && scenarioStatus?.latestStatus === 'not-run') {
      skipped.push({
        scenarioId,
        reason: 'pending manifest already exists',
        latestRunId: scenarioStatus.latestRunId,
      });
      continue;
    }
    prepared.push(await prepareScenario(script, {
      ...options,
      scenario: scenarioId,
      runId: options.runId ? `${options.runId}-${scenarioId}` : undefined,
    }));
  }

  return { status, prepared, skipped };
}

export async function recordLongformRoundObservation(options: RecordLongformRoundOptions) {
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as DeepRunManifest;
  const roundIndex = manifest.rounds.findIndex((round) => round.round === options.round);
  if (roundIndex < 0) throw new Error(`Round ${options.round} not found in ${options.manifestPath}`);
  manifest.rounds[roundIndex] = {
    ...manifest.rounds[roundIndex],
    status: options.status,
    observedBehavior: options.observedBehavior,
    artifactRefs: uniqueStrings([...(manifest.rounds[roundIndex].artifactRefs ?? []), ...(options.artifactRefs ?? [])]),
    executionUnitRefs: uniqueStrings([...(manifest.rounds[roundIndex].executionUnitRefs ?? []), ...(options.executionUnitRefs ?? [])]),
    screenshotRefs: uniqueStrings([...(manifest.rounds[roundIndex].screenshotRefs ?? []), ...(options.screenshotRefs ?? [])]),
  };

  if (options.updateRunStatus !== false) {
    manifest.status = inferManifestStatus(manifest);
    if (manifest.status === 'passed') {
      manifest.run.completedAt = options.completedAt ?? new Date().toISOString();
      manifest.coverageStage = manifest.coverageStage === 'protocol-pass' ? 'real-data-success' : manifest.coverageStage;
      manifest.runtimeProfile.dataMode = manifest.runtimeProfile.dataMode === 'unavailable' ? 'real' : manifest.runtimeProfile.dataMode;
    }
  }

  const issues = validateDeepRunManifest(manifest);
  if (issues.length) {
    throw new Error(`Updated manifest is invalid:\n${issues.join('\n')}`);
  }
  await writeFile(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function recordLongformEvidence(options: RecordLongformEvidenceOptions) {
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as DeepRunManifest;
  if (options.evidence.kind === 'artifact') {
    manifest.artifacts = upsertById<DeepRunManifest['artifacts'][number]>(manifest.artifacts, options.evidence.artifact);
  } else if (options.evidence.kind === 'execution-unit') {
    manifest.executionUnits = upsertById<DeepRunManifest['executionUnits'][number]>(manifest.executionUnits, options.evidence.executionUnit);
  } else {
    manifest.screenshots = upsertById<DeepRunManifest['screenshots'][number]>(manifest.screenshots, options.evidence.screenshot);
  }
  const issues = validateDeepRunManifest(manifest);
  if (issues.length) {
    throw new Error(`Updated manifest is invalid:\n${issues.join('\n')}`);
  }
  await writeFile(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function finalizeLongformRegression(options: FinalizeLongformRegressionOptions) {
  const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8')) as DeepRunManifest;
  if (options.status) manifest.status = options.status;
  if (options.coverageStage) manifest.coverageStage = options.coverageStage;
  if (options.completedAt) manifest.run.completedAt = options.completedAt;
  if (options.status === 'passed' && !manifest.run.completedAt) manifest.run.completedAt = new Date().toISOString();
  if (options.qualityScores) {
    manifest.qualityScores = mergeDefined(manifest.qualityScores, options.qualityScores);
  }
  if (options.notes) {
    manifest.notes = options.appendNotes === false || !manifest.notes ? options.notes : `${manifest.notes}\n\n${options.notes}`;
  }
  if (options.failurePoint) {
    manifest.failurePoints = upsertById<DeepRunManifest['failurePoints'][number]>(manifest.failurePoints, options.failurePoint);
  }

  const issues = validateDeepRunManifest(manifest);
  if (issues.length) {
    throw new Error(`Finalized manifest is invalid:\n${issues.join('\n')}`);
  }
  await writeFile(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function getLongformNextRound(manifest: DeepRunManifest, script?: LongformScenarioScript): LongformNextRound {
  const nextRound = manifest.rounds.find((round) => round.status === 'not-run' || round.status === 'repair-needed');
  const scriptRound = nextRound ? script?.rounds.find((round) => round.round === nextRound.round) : undefined;
  const completedRounds = manifest.rounds.filter((round) => round.status === 'passed').length;
  return {
    scenarioId: manifest.scenarioId,
    title: manifest.title,
    runId: manifest.run.id,
    manifestStatus: manifest.status,
    appUrl: manifest.runtimeProfile.appUrl,
    progress: {
      completedRounds,
      totalRounds: manifest.rounds.length,
      nextRoundNumber: nextRound?.round,
    },
    round: nextRound,
    referenceOps: scriptRound?.referenceOps ?? (nextRound ? referenceOpsFromManifest({ ...manifest, rounds: [nextRound] }) : []),
    expectedArtifacts: scriptRound?.expectedArtifacts ?? expectedArtifactsFromRound(nextRound),
    acceptanceChecks: scriptRound?.acceptanceChecks ?? acceptanceChecksFromRound(nextRound),
    recordCommand: nextRound ? renderRecordRoundCommand(manifest, nextRound) : undefined,
  };
}

export function summarizeLongformEvidenceGaps(manifest: DeepRunManifest, script?: LongformScenarioScript): LongformEvidenceGapReport {
  const quality = validateLongformRunManifest(manifest, script);
  const evidenceClasses = evidenceClassesForManifest(manifest);
  const requiredEvidenceClasses = ['browser', 'computer-use', 'workspace'];
  const missingEvidenceClasses = requiredEvidenceClasses.filter((item) => !evidenceClasses.has(item));
  const missingRounds = manifest.rounds.filter((round) => round.status !== 'passed').map((round) => round.round);
  const missingRoundArtifactRefs = manifest.rounds.filter((round) => round.status === 'passed' && !(round.artifactRefs?.length)).map((round) => round.round);
  const missingRoundExecutionRefs = manifest.rounds.filter((round) => round.status === 'passed' && !(round.executionUnitRefs?.length)).map((round) => round.round);
  const missingRoundScreenshotRefs = manifest.rounds.filter((round) => round.status === 'passed' && !(round.screenshotRefs?.length)).map((round) => round.round);
  const producedArtifacts = manifest.artifacts.some((artifact) => artifact.status !== 'missing');
  const referenceImpact = mentionsReferenceImpact(manifest);
  const completedAt = Boolean(manifest.run.completedAt);
  const blocker = manifest.status === 'repair-needed' || manifest.status === 'failed'
    ? manifest.failurePoints.some((failure) => failure.severity === 'blocker' || failure.category === 'model' || failure.category === 'runtime')
    : true;
  const readyToFinalizePassed = missingRounds.length === 0
    && missingEvidenceClasses.length === 0
    && producedArtifacts
    && referenceImpact
    && completedAt
    && manifest.rounds.some((round) => (round.artifactRefs?.length ?? 0) > 0);

  return {
    scenarioId: manifest.scenarioId,
    title: manifest.title,
    runId: manifest.run.id,
    status: manifest.status,
    readyToFinalizePassed,
    completedRounds: manifest.rounds.filter((round) => round.status === 'passed').length,
    totalRounds: manifest.rounds.length,
    missing: {
      rounds: missingRounds,
      roundArtifactRefs: missingRoundArtifactRefs,
      roundExecutionRefs: missingRoundExecutionRefs,
      roundScreenshotRefs: missingRoundScreenshotRefs,
      evidenceClasses: missingEvidenceClasses,
      producedArtifacts,
      referenceImpact,
      completedAt,
      blocker,
    },
    suggestedCommands: renderGapCommands(manifest, missingEvidenceClasses, producedArtifacts, completedAt, referenceImpact),
    qualityIssues: quality.issues,
  };
}

export function buildLongformEvidenceCommandPlan(manifest: DeepRunManifest): LongformEvidenceCommandPlan {
  const manifestPath = manifestPathForScenario(manifest.scenarioId);
  const roundsNeedingCommands = manifest.rounds.filter((round) =>
    round.status !== 'passed'
    || !(round.artifactRefs?.length)
    || !(round.executionUnitRefs?.length)
    || !(round.screenshotRefs?.length)
  );
  const roundCommands = roundsNeedingCommands.map((round) => ({
    round: round.round,
    status: round.status,
    command: renderRecordRoundCommand(manifest, round),
  }));
  return {
    scenarioId: manifest.scenarioId,
    runId: manifest.run.id,
    roundCommands,
    evidenceCommands: [
      renderArtifactEvidenceCommand(manifestPath, manifest),
      renderExecutionEvidenceCommand(manifestPath, manifest),
      renderBrowserScreenshotCommand(manifestPath, manifest),
      renderComputerUseScreenshotCommand(manifestPath, manifest),
    ],
    finalizeCommand: [
      'npm run longform:finalize --',
      `--manifest ${shellQuote(manifestPath)}`,
      '--status passed',
      '--coverage-stage real-data-success',
      '--score-task-completion 4',
      '--score-reproducibility 4',
      '--score-data-authenticity 4',
      '--score-artifact-schema 4',
      '--score-self-healing 4',
      '--score-report-quality 4',
      '--score-overall 4',
      `--score-rationale ${shellQuote('References, browser evidence, Computer Use evidence, workspace refs, artifacts, and recovery behavior were reviewed.')}`,
      `--notes ${shellQuote('Explicit references changed the final answer, artifacts, plan, or next step.')}`,
    ].join(' '),
  };
}

export async function writeLongformOperatorRunbook(options: WriteLongformOperatorRunbookOptions): Promise<LongformOperatorRunbook> {
  const next = getLongformNextRound(options.manifest, options.script);
  const gaps = summarizeLongformEvidenceGaps(options.manifest, options.script);
  const commands = buildLongformEvidenceCommandPlan(options.manifest);
  const outPath = options.outPath ? resolve(options.outPath) : join(dirname(resolve(options.manifestPath)), 'operator-runbook.md');
  const markdown = renderOperatorRunbook({ manifest: options.manifest, script: options.script, next, gaps, commands });
  await writeFile(outPath, markdown);
  return {
    scenarioId: options.manifest.scenarioId,
    runId: options.manifest.run.id,
    path: outPath,
    markdown,
  };
}

async function prepareScenario(script: LongformScenarioScript, options: PrepareLongformRegressionOptions) {
  const runId = options.runId ?? `${script.scenarioId}-${dateStamp(new Date())}`;
  const outRoot = options.outRoot ? resolve(options.outRoot) : resolve('docs', 'test-artifacts', 'deep-scenarios');
  const directory = join(outRoot, script.scenarioId);
  const evidenceDirectory = join(directory, 'evidence');
  const screenshotsDirectory = join(directory, 'screenshots');
  await mkdir(evidenceDirectory, { recursive: true });
  await mkdir(screenshotsDirectory, { recursive: true });

  const manifest: DeepRunManifest = {
    schemaVersion: '1.0',
    scenarioId: script.scenarioId,
    title: script.title,
    taskId: 'T060',
    status: options.status ?? 'not-run',
    coverageStage: options.coverageStage ?? 'protocol-pass',
    run: {
      id: runId,
      startedAt: new Date().toISOString(),
      operator: options.operator ?? 'Codex',
      entrypoint: 'manual-browser',
    },
    prompt: {
      initial: script.rounds[0]?.prompt ?? script.goal,
      compiledScenarioPrompt: script.goal,
      expectedOutcome: `Complete ${script.minRounds}+ SciForge turns with mixed reference operations and reproducible artifacts for ${script.scenarioPackageId}.`,
    },
    rounds: script.rounds.map((round) => ({
      round: round.round,
      userPrompt: round.prompt,
      expectedBehavior: [
        ...round.acceptanceChecks,
        round.referenceOps.length ? `Reference ops: ${round.referenceOps.map(formatReferenceOperation).join('; ')}` : '',
        round.expectedArtifacts.length ? `Expected artifacts: ${round.expectedArtifacts.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
      observedBehavior: 'Pending real SciForge browser run. Fill this during execution.',
      status: 'not-run',
      artifactRefs: [],
      executionUnitRefs: [],
      screenshotRefs: [],
    })),
    runtimeProfile: {
      appUrl: options.appUrl ?? 'http://localhost:5173/',
      workspacePath: options.workspacePath,
      agentBackend: options.backend,
      modelProvider: options.modelProvider,
      modelName: options.modelName,
      runtimeProfileId: 't060-longform',
      mockModel: false,
      dataMode: options.status === 'not-run' ? 'unavailable' : 'real',
    },
    artifacts: [],
    executionUnits: [],
    failurePoints: [{
      id: 'pending-real-regression',
      severity: 'info',
      category: 'protocol',
      summary: script.blockerTemplate,
      resolved: false,
    }],
    screenshots: [],
    qualityScores: {
      taskCompletion: 1,
      reproducibility: 1,
      dataAuthenticity: 1,
      artifactSchema: 1,
      selfHealing: 1,
      reportQuality: 1,
      rationale: `Pending manual scoring. Dimensions: ${script.scoringDimensions.join(', ')}.`,
    },
    notes: renderEvidencePlan(script),
  };

  const issues = validateDeepRunManifest(manifest);
  if (issues.length) {
    throw new Error(`Generated manifest for ${script.scenarioId} is invalid:\n${issues.join('\n')}`);
  }

  const manifestPath = join(directory, 'manifest.json');
  const checklistPath = join(directory, 'run-checklist.md');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(checklistPath, renderChecklist(script, manifest));

  return {
    scenarioId: script.scenarioId,
    directory,
    manifestPath,
    checklistPath,
    evidenceDirectory,
    manifest,
  };
}

function renderChecklist(script: LongformScenarioScript, manifest: DeepRunManifest) {
  const lines = [
    `# ${script.title}`,
    '',
    `Scenario script: \`${script.scenarioId}\``,
    `Scenario package: \`${script.scenarioPackageId}\``,
    `Run id: \`${manifest.run.id}\``,
    `App URL: \`${manifest.runtimeProfile.appUrl ?? 'http://localhost:5173/'}\``,
    '',
    '## Evidence Plan',
    '',
    `- Browser: ${script.evidencePlan.browser.join('; ')}`,
    `- Computer Use: ${script.evidencePlan.computerUse.join('; ')}`,
    `- Workspace: ${script.evidencePlan.workspace.join('; ')}`,
    '',
    '## Rounds',
    '',
  ];
  for (const round of script.rounds) {
    lines.push(`### Round ${round.round}`, '');
    lines.push(round.prompt, '');
    if (round.referenceOps.length) {
      lines.push('Reference operations:');
      for (const op of round.referenceOps) lines.push(`- ${formatReferenceOperation(op)}`);
      lines.push('');
    }
    lines.push(`Expected artifacts: ${round.expectedArtifacts.join(', ') || 'none'}`);
    lines.push('Acceptance checks:');
    for (const check of round.acceptanceChecks) lines.push(`- ${check}`);
    lines.push('');
    lines.push('Record:');
    lines.push('- Backend stream events:');
    lines.push('- Artifact refs:');
    lines.push('- Execution/log refs:');
    lines.push('- Screenshot refs:');
    lines.push('- Failure/repair notes:');
    lines.push('');
  }
  lines.push('## Scoring', '');
  for (const dimension of script.scoringDimensions) lines.push(`- ${dimension}: _/5`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderOperatorRunbook({
  manifest,
  script,
  next,
  gaps,
  commands,
}: {
  manifest: DeepRunManifest;
  script?: LongformScenarioScript;
  next: LongformNextRound;
  gaps: LongformEvidenceGapReport;
  commands: LongformEvidenceCommandPlan;
}) {
  const lines = [
    `# ${manifest.title}`,
    '',
    `Scenario: \`${manifest.scenarioId}\``,
    `Run: \`${manifest.run.id}\``,
    `Status: \`${manifest.status}\``,
    `App URL: \`${manifest.runtimeProfile.appUrl ?? 'http://localhost:5173/'}\``,
    `Progress: ${gaps.completedRounds}/${gaps.totalRounds}`,
    `Ready to finalize passed: ${gaps.readyToFinalizePassed ? 'yes' : 'no'}`,
    '',
    '## Goal',
    '',
    manifest.prompt.compiledScenarioPrompt ?? script?.goal ?? manifest.prompt.expectedOutcome ?? manifest.prompt.initial,
    '',
    '## Next Round',
    '',
  ];
  if (next.round) {
    lines.push(`Round ${next.round.round}:`, '', next.round.userPrompt, '');
    if (next.referenceOps.length) {
      lines.push('Reference operations:');
      for (const op of next.referenceOps) lines.push(`- ${formatReferenceOperation(op)}`);
      lines.push('');
    }
    if (next.expectedArtifacts.length) lines.push(`Expected artifacts: ${next.expectedArtifacts.join(', ')}`, '');
    if (next.acceptanceChecks.length) {
      lines.push('Acceptance checks:');
      for (const check of next.acceptanceChecks) lines.push(`- ${check}`);
      lines.push('');
    }
  } else {
    lines.push('All rounds are complete or no runnable round is available.', '');
  }
  lines.push('## Missing Evidence', '');
  lines.push(`- Rounds: ${gaps.missing.rounds.join(', ') || 'none'}`);
  lines.push(`- Round artifact refs: ${gaps.missing.roundArtifactRefs.join(', ') || 'none'}`);
  lines.push(`- Round execution refs: ${gaps.missing.roundExecutionRefs.join(', ') || 'none'}`);
  lines.push(`- Round screenshot refs: ${gaps.missing.roundScreenshotRefs.join(', ') || 'none'}`);
  lines.push(`- Evidence classes: ${gaps.missing.evidenceClasses.join(', ') || 'none'}`);
  lines.push(`- Produced artifact recorded: ${gaps.missing.producedArtifacts ? 'yes' : 'no'}`);
  lines.push(`- Reference impact explained: ${gaps.missing.referenceImpact ? 'yes' : 'no'}`);
  lines.push(`- CompletedAt recorded: ${gaps.missing.completedAt ? 'yes' : 'no'}`);
  lines.push('');
  if (gaps.qualityIssues.length) {
    lines.push('## Quality Issues', '');
    for (const issue of gaps.qualityIssues) lines.push(`- ${issue}`);
    lines.push('');
  }
  lines.push('## Round Commands', '');
  if (commands.roundCommands.length) {
    lines.push('```sh');
    for (const item of commands.roundCommands) lines.push(item.command);
    lines.push('```', '');
  } else {
    lines.push('No round commands needed.', '');
  }
  lines.push('## Top-Level Evidence Commands', '', '```sh');
  for (const command of commands.evidenceCommands) lines.push(command);
  lines.push('```', '');
  lines.push('## Finalize Command', '', '```sh', commands.finalizeCommand, '```', '');
  return `${lines.join('\n')}\n`;
}

function renderEvidencePlan(script: LongformScenarioScript) {
  return [
    'Prepared T060 longform regression manifest.',
    `Browser evidence: ${script.evidencePlan.browser.join('; ')}`,
    `Computer Use evidence: ${script.evidencePlan.computerUse.join('; ')}`,
    `Workspace evidence: ${script.evidencePlan.workspace.join('; ')}`,
    `Scoring dimensions: ${script.scoringDimensions.join(', ')}`,
  ].join('\n');
}

function acceptanceChecksFromRound(round: DeepRunManifest['rounds'][number] | undefined) {
  if (!round?.expectedBehavior) return [];
  return round.expectedBehavior
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('Reference ops:') && !line.startsWith('Expected artifacts:'));
}

function referenceOpsFromManifest(manifest: DeepRunManifest): LongformReferenceOperation[] {
  return manifest.rounds.flatMap((round) => {
    const text = `${round.userPrompt}\n${round.expectedBehavior ?? ''}\n${round.observedBehavior}`;
    const markers = text.match(/※\d+/g) ?? [];
    return markers.map((marker) => ({
      kind: /right-click|右键|selectedText|选中/i.test(text)
        ? 'right-click-selected-text'
        : /point-select|点选|UI block|整块/i.test(text)
          ? 'point-select-ui-block'
          : /object chip|chip|object reference/i.test(text)
            ? 'click-object-chip'
            : 'referenced-follow-up',
      marker,
      source: 'manifest text',
    }));
  });
}

function evidenceClassesForManifest(manifest: DeepRunManifest) {
  const classes = new Set<string>();
  const screenshotHaystack = manifest.screenshots.map((screenshot) => `${screenshot.id} ${screenshot.path} ${screenshot.caption ?? ''}`).join('\n').toLowerCase();
  const workspaceHaystack = [
    ...manifest.artifacts.map((artifact) => `${artifact.id} ${artifact.type} ${artifact.path ?? ''} ${artifact.summary ?? ''}`),
    ...manifest.executionUnits.map((unit) => `${unit.id} ${unit.logRef ?? ''} ${unit.failureReason ?? ''}`),
  ].join('\n').toLowerCase();
  if (manifest.screenshots.length > 0 || /browser|dom|in-app/.test(screenshotHaystack)) classes.add('browser');
  if (/computer use|computer-use|right-click|coordinate|desktop|鼠标|右键/.test(screenshotHaystack)) classes.add('computer-use');
  if (/workspace|\.sciforge|artifact|session|run ref|log|\.md|\.csv|\.tsv|notebook/.test(workspaceHaystack)) classes.add('workspace');
  return classes;
}

function mentionsReferenceImpact(manifest: DeepRunManifest) {
  const text = [
    ...manifest.rounds
      .filter((round) => round.status !== 'not-run' && !/Pending real SciForge browser run/i.test(round.observedBehavior))
      .map((round) => `${round.observedBehavior}\n${round.expectedBehavior ?? ''}`),
    ...manifest.artifacts.map((artifact) => artifact.summary ?? ''),
    manifest.qualityScores.rationale && !/^Pending manual scoring\./.test(manifest.qualityScores.rationale) ? manifest.qualityScores.rationale : '',
    manifest.notes && !/^Prepared T060 longform regression manifest\./.test(manifest.notes) ? manifest.notes : '',
  ].join('\n');
  return /※\d+|reference|引用|selectedText|sourceRef|changed|影响|改变|降级|重排|推翻|保留|舍弃/i.test(text);
}

function inferManifestStatus(manifest: DeepRunManifest): DeepRunManifest['status'] {
  if (manifest.rounds.some((round) => round.status === 'failed')) return 'failed';
  if (manifest.rounds.some((round) => round.status === 'repair-needed')) return 'repair-needed';
  if (manifest.rounds.length > 0 && manifest.rounds.every((round) => round.status === 'passed')) return 'passed';
  return 'not-run';
}

function isPassedRealRunInCurrentWeek(manifest: DeepRunManifest, now: Date) {
  if (manifest.status !== 'passed') return false;
  if (manifest.runtimeProfile.mockModel) return false;
  if (manifest.runtimeProfile.dataMode !== 'real' && manifest.runtimeProfile.dataMode !== 'mixed') return false;
  const completedAt = manifest.run.completedAt ? new Date(manifest.run.completedAt) : undefined;
  if (!completedAt || Number.isNaN(completedAt.valueOf())) return false;
  const weekStart = startOfIsoWeek(now);
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
  return completedAt >= weekStart && completedAt < nextWeekStart;
}

function startOfIsoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

function compareManifestRecency(left: DeepRunManifest, right: DeepRunManifest) {
  return manifestTimestamp(left) - manifestTimestamp(right);
}

function recommendNextScenarioIds(scenarios: LongformScenarioStatus[], currentWeekPassedScenarioIds: Set<string>, count: number) {
  if (count <= 0) return [];
  return [...scenarios]
    .filter((scenario) => scenario.hasScript && !currentWeekPassedScenarioIds.has(scenario.scenarioId))
    .sort((left, right) => scenarioPriority(left) - scenarioPriority(right) || left.scenarioId.localeCompare(right.scenarioId))
    .slice(0, count)
    .map((scenario) => scenario.scenarioId);
}

function scenarioPriority(scenario: LongformScenarioStatus) {
  if (scenario.latestStatus === 'missing') return 0;
  if (scenario.latestStatus === 'not-run') return 1;
  if (scenario.latestStatus === 'repair-needed') return 2;
  if (scenario.latestStatus === 'failed') return 3;
  return 4;
}

function manifestTimestamp(manifest: DeepRunManifest) {
  return new Date(manifest.run.completedAt ?? manifest.run.startedAt).valueOf() || 0;
}

function formatReferenceOperation(op: LongformReferenceOperation) {
  return [
    op.marker ? `${op.marker}` : '',
    op.kind,
    `source=${op.source}`,
    op.requiredPayload?.length ? `payload=${op.requiredPayload.join(',')}` : '',
    op.expectedHighlight ? `highlight=${op.expectedHighlight}` : '',
  ].filter(Boolean).join(' ');
}

function dateStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const definedItem = stripUndefined<T>(item);
  const index = items.findIndex((current) => current.id === item.id);
  if (index < 0) return [...items, definedItem as T];
  return items.map((current, currentIndex) => currentIndex === index ? mergeDefined<T>(current, definedItem) : current);
}

function mergeDefined<T extends object>(base: T, update: Partial<T>) {
  return { ...base, ...stripUndefined(update) } as T;
}

function stripUndefined<T extends object>(value: Partial<T>) {
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)) as Partial<T>;
}
