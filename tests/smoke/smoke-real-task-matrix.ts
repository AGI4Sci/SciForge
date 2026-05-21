import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { validateCancellationEvidenceLedger } from '../../src/runtime/codex/cancellation-evidence.js';
import { validateServiceLifecycleEvidenceLedger } from '../../src/runtime/codex/service-lifecycle-evidence.js';

type RealTaskEntrypoint =
  | 'codex-in-app-browser-default-chat'
  | 'production-desktop-cold-start';

type RealTaskStatus = 'todo' | 'done';
type RealTaskManifestStatus = 'not-run' | 'blocked' | 'partial' | 'failed' | 'passed';

type RealTaskMatrixEntry = {
  id: string;
  family: string;
  entrypoint: RealTaskEntrypoint;
  minTurns: 3;
  requiresSelectedRefOrReason: boolean;
  passEvidence: Array<
    | 'visible-ui'
    | 'workspace-artifact-or-explicit-no-artifact-reason'
    | 'audit-refs'
    | 'command-or-test-output'
    | 'provider-model-profile'
    | 'blocked-manifest-when-external-runtime-fails'
  >;
  gates: string[];
};

type ProjectTask = {
  status: RealTaskStatus;
  title: string;
  sourceText: string;
  line: number;
  lineWithNext: string;
};

type RealTaskEvidenceManifest = {
  schemaVersion?: string;
  taskId?: string;
  title?: string;
  sourceProjectPath?: string;
  sourceProjectLine?: number;
  sourceProjectText?: string;
  status?: RealTaskManifestStatus;
  statusReason?: string;
  statusSource?: {
    path?: string;
    observedStatus?: string;
    observedReason?: string;
  };
  minTurns?: number;
  entrypointExpectations?: {
    entrypoint?: RealTaskEntrypoint;
    startedFromDefaultChatEntry?: boolean;
    requiresRuntimeCodex?: boolean;
    requiresLiveBrowserAcceptance?: boolean;
    requiresProductionDesktopAcceptance?: boolean;
    requiresVisibleGuiPresentAnswer?: boolean;
    allowsScriptableMockAsPass?: boolean;
    allowsSeedDemoFixtureAsPass?: boolean;
  };
  requiredEvidenceClasses?: string[];
  provider?: string | null;
  model?: string | null;
  profile?: string | null;
  workspacePath?: string;
  actualUrl?: string;
  actualPort?: number;
  commandId?: string;
  evidenceRefs?: string[];
  selectedRefEvidence?: {
    artifactRef?: string;
    exemptionReason?: string;
    evidenceRefs?: string[];
    selectedRefs?: string[];
    forbiddenRefs?: string[];
    followupRunIds?: string[];
    latestArtifactUsed?: boolean;
    derivedArtifactRef?: string;
    resumeMetadataRef?: string;
    commandTextPolicy?: {
      newUserRequestOnly?: boolean;
      selectedRefsOnly?: boolean;
      replaysGuiTranscript?: boolean;
      includesFullArtifactBody?: boolean;
      evidenceRefs?: string[];
    };
  };
  releaseEligible?: boolean;
  releaseBlocking?: boolean;
  attemptScope?: 'shared-preflight' | 'task-specific-live-attempt' | 'desktop-preflight' | 'desktop-live-attempt';
  currentRunEvidenceScope?: 'shared-preflight' | 'task-specific-live-attempt' | 'desktop-preflight' | 'desktop-live-attempt';
  source?: {
    entrypoint?: string;
    evidenceMode?: string;
    devServices?: string;
    harnessMode?: string;
    runtimeSource?: string;
  };
  restoredGuiStateSource?: string;
  nativeContinuity?: {
    codexSessionId?: string;
    resumeCommand?: string;
    attemptId?: string;
    evidenceRefs?: string[];
  };
  serviceLifecycleEvidence?: {
    ledgerRef?: string;
    actualPort?: number;
    cleanupEvidenceRefs?: string[];
    readinessCheckRefs?: string[];
    browserRefreshEvidenceRefs?: string[];
    passClaimRefs?: string[];
  };
  cancellationEvidence?: {
    ledgerRef?: string;
    safeContinuationPlanRef?: string;
    partialArtifactRefs?: string[];
    unsafeRemainderRefs?: string[];
    irreversibleSideEffectRefs?: string[];
  };
  securityScrubEvidence?: {
    rawAuditBundleManifestRef?: string;
    diagnosisRef?: string;
    correctedConfigRetryRef?: string;
    primaryReplyDomRefs?: string[];
    forbiddenLeakCheckRefs?: string[];
  };
  failedRunAuditExport?: {
    bundleManifestRef?: string;
    runId?: string;
    commandId?: string;
    provider?: string;
    model?: string;
    profile?: string;
    boundedScrubbedRefs?: string[];
  };
  providerOutageRecovery?: {
    failureClassification?: string;
    initialFailureStatus?: string;
    initialFailureRunId?: string;
    recoveryRunId?: string;
    initialFailureRef?: string;
    recoveryEvidenceRef?: string;
    freshDispatchEvidenceRef?: string;
    reusedFailedOutputAsSuccessEvidence?: boolean;
  };
  turns?: Array<{
    turnId?: string;
    prompt?: string;
    evidenceSource?: string;
  }>;
  visibleAnswer?: string | { text?: string };
  screenshotRefs?: string[];
  auditRefs?: string[];
  artifactPaths?: string[];
  noArtifactReason?: string;
};

type RealTaskBlocker = {
  status: string;
  reason: string;
  path: string;
  isSharedRuntimeBlocker?: boolean;
};

const root = process.cwd();
const projectText = await readFile(join(root, 'PROJECT.md'), 'utf8');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
const updateManifests = process.argv.includes('--update-manifests');

const matrix: RealTaskMatrixEntry[] = [
  task('R-PROTO-04', 'gui-presentation-catalog-discovery', ['smoke:runtime-codex-browser-acceptance', 'smoke:native-extension-ownership', 'smoke:real-task-protocol-gates']),
  task('R-PROTO-05', 'inline-reference-right-panel-preview', ['smoke:runtime-codex-browser-acceptance', 'smoke:object-references', 'smoke:real-task-protocol-gates']),
  task('R-VERIFY-02', 'confidence-source-and-explanation', ['smoke:runtime-codex-browser-acceptance', 'smoke:runtime-codex-truth-source', 'smoke:real-task-protocol-gates']),
];

const projectTasks = extractProjectTasks(projectText);
const projectIds = [...projectTasks.keys()].sort();
const matrixIds = matrix.map((entry) => entry.id).sort();

assert.deepEqual(matrixIds, projectIds, 'real task matrix must cover exactly the R-* task board in PROJECT.md');
assert.equal(new Set(matrixIds).size, matrix.length, 'real task matrix ids must be unique');

for (const entry of matrix) {
  assert.equal(entry.minTurns, 3, `${entry.id}: must require at least three real turns`);
  assert.ok(entry.gates.length > 0, `${entry.id}: must name at least one deterministic gate`);
  assert.ok(entry.gates.every((gate) => gate.startsWith('smoke:')), `${entry.id}: gates must be npm smoke scripts`);
  assert.ok(entry.gates.every((gate) => packageJson.scripts?.[gate]), `${entry.id}: all gates must exist in package.json scripts`);
  assert.ok(entry.passEvidence.includes('visible-ui'), `${entry.id}: visible UI evidence is required`);
  assert.ok(entry.passEvidence.includes('audit-refs'), `${entry.id}: audit refs are required`);
  assert.ok(entry.passEvidence.includes('command-or-test-output'), `${entry.id}: command/test output evidence is required`);
  assert.ok(entry.passEvidence.includes('blocked-manifest-when-external-runtime-fails'), `${entry.id}: blocked external/runtime evidence must stay explicit`);
  assert.notEqual(entry.gates.includes('seed-demo'), true, `${entry.id}: seed/demo gates cannot satisfy live tasks`);
}

for (const [id, projectTask] of projectTasks) {
  if (projectTask.status !== 'done') continue;
  const evidenceWindow = projectTask.lineWithNext;
  assert.match(evidenceWindow, /evidence|证据|docs\/test-artifacts|status|状态|passed|blocked|partial|failed/i, `${id}: checked tasks must record evidence/status next to the task`);
}

assert.ok(
  matrix.some((entry) => entry.gates.includes('smoke:runtime-codex-browser-acceptance')),
  'matrix must keep the real Runtime Codex browser acceptance gate in scope',
);

const manifestSummary = await assertOrSyncRealTaskManifests(matrix, projectTasks, { updateManifests });

console.log(`[ok] real-task-matrix covers ${matrix.length} PROJECT.md R-* tasks with live-entrypoint, evidence, smoke-gate contracts, and ${manifestSummary.count} evidence manifest contract(s); materialized=${manifestSummary.materialized}; updated=${manifestSummary.updated}; wouldUpdate=${manifestSummary.wouldUpdate}; mode=${manifestSummary.mode}`);

function task(
  id: string,
  family: string,
  gates: string[],
  entrypoint: RealTaskEntrypoint = 'codex-in-app-browser-default-chat',
): RealTaskMatrixEntry {
  return {
    id,
    family,
    entrypoint,
    minTurns: 3,
    requiresSelectedRefOrReason: true,
    passEvidence: [
      'visible-ui',
      'workspace-artifact-or-explicit-no-artifact-reason',
      'audit-refs',
      'command-or-test-output',
      'provider-model-profile',
      'blocked-manifest-when-external-runtime-fails',
    ],
    gates,
  };
}

function extractProjectTasks(text: string): Map<string, ProjectTask> {
  const tasks = new Map<string, ProjectTask>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^- \[( |x|X)\] (R-[A-Z]+-\d{2})\b\s*(.*)$/.exec(line);
    if (!match) continue;
    const status: RealTaskStatus = match[1].toLowerCase() === 'x' ? 'done' : 'todo';
    const id = match[2];
    const sourceText = match[3].trim();
    const title = sourceText.split(/[：:]/, 1)[0]?.trim() || sourceText;
    assert.ok(!tasks.has(id), `${id}: duplicate PROJECT.md task`);
    tasks.set(id, {
      status,
      title,
      sourceText,
      line: index + 1,
      lineWithNext: [line, lines[index + 1] ?? ''].join('\n'),
    });
  }
  assert.ok(tasks.size > 0, 'PROJECT.md must contain R-* tasks');
  return tasks;
}

type ManifestSyncSummary = {
  count: number;
  materialized: number;
  updated: number;
  wouldUpdate: number;
  mode: 'validate' | 'update';
};

async function assertOrSyncRealTaskManifests(
  entries: RealTaskMatrixEntry[],
  tasks: Map<string, ProjectTask>,
  options: { updateManifests: boolean },
): Promise<ManifestSyncSummary> {
  const manifestRoot = join(root, 'docs', 'test-artifacts', 'real-tasks');
  const runtimeBlocker = await currentRuntimeBlocker();
  let updated = 0;
  let wouldUpdate = 0;
  if (options.updateManifests) await mkdir(manifestRoot, { recursive: true });

  for (const entry of entries) {
    const projectTask = tasks.get(entry.id);
    assert.ok(projectTask, `${entry.id}: missing PROJECT.md task`);
    const manifestPath = join(manifestRoot, entry.id, 'manifest.json');
    const expectedScaffold = createBlockedManifest(entry, projectTask, runtimeBlocker);
    let manifest = await readJson<RealTaskEvidenceManifest>(manifestPath);
    if (!manifest || shouldRefreshScaffold(manifest, expectedScaffold)) {
      manifest = expectedScaffold;
      if (options.updateManifests) {
        await mkdir(dirname(manifestPath), { recursive: true });
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        updated += 1;
      } else {
        wouldUpdate += 1;
      }
    }
    await assertRealTaskEvidenceManifest(manifest, entry, projectTask, manifestPath);
  }

  const manifestIds = await readManifestIds(manifestRoot);
  const expectedIds = entries.map((entry) => entry.id).sort();
  if (options.updateManifests) {
    const missingIds = expectedIds.filter((id) => !manifestIds.includes(id));
    assert.deepEqual(missingIds, [], 'real task evidence manifests must include every current PROJECT.md R-* task after --update-manifests');
  }
  return {
    count: entries.length,
    materialized: manifestIds.length,
    updated,
    wouldUpdate,
    mode: options.updateManifests ? 'update' : 'validate',
  };
}

function createBlockedManifest(
  entry: RealTaskMatrixEntry,
  projectTask: ProjectTask,
  runtimeBlocker: { status: string; reason: string },
): RealTaskEvidenceManifest {
  const blocker = blockerForEntry(entry, runtimeBlocker);
  const manifestStatus = blockerManifestStatus(blocker);
  const expectsBrowserDefaultChat = entry.entrypoint === 'codex-in-app-browser-default-chat';
  const expectsProductionDesktop = entry.entrypoint === 'production-desktop-cold-start';
  const evidenceScope = nonPassedSharedEvidenceScope(entry);
  return {
    schemaVersion: 'sciforge.real-task-manifest.v1',
    taskId: entry.id,
    title: projectTask.title,
    sourceProjectPath: 'PROJECT.md',
    sourceProjectLine: projectTask.line,
    sourceProjectText: projectTask.sourceText,
    status: manifestStatus,
    statusReason: manifestStatus === 'blocked' || manifestStatus === 'failed' || manifestStatus === 'partial'
      ? blockerStatusReason(blocker, manifestStatus)
      : 'No live real-task evidence has been recorded yet.',
    statusSource: {
      path: blocker.path,
      observedStatus: blocker.status,
      observedReason: blocker.reason,
    },
    minTurns: entry.minTurns,
    entrypointExpectations: {
      entrypoint: entry.entrypoint,
      startedFromDefaultChatEntry: expectsBrowserDefaultChat,
      requiresRuntimeCodex: true,
      requiresLiveBrowserAcceptance: expectsBrowserDefaultChat,
      requiresProductionDesktopAcceptance: expectsProductionDesktop,
      requiresVisibleGuiPresentAnswer: true,
      allowsScriptableMockAsPass: false,
      allowsSeedDemoFixtureAsPass: false,
    },
    requiredEvidenceClasses: requiredManifestEvidenceClasses(),
    provider: null,
    model: null,
    profile: null,
    releaseEligible: false,
    releaseBlocking: true,
    attemptScope: evidenceScope,
    currentRunEvidenceScope: evidenceScope,
    evidenceRefs: [],
  };
}

function blockerForEntry(
  entry: RealTaskMatrixEntry,
  runtimeBlocker: { status: string; reason: string },
): RealTaskBlocker {
  if (entry.entrypoint === 'production-desktop-cold-start') {
    return {
      status: 'blocked',
      reason: 'Production and packaged Electron lifecycle evidence now proves dist-ui/app.asar renderer loading, dynamic ports, appData/workspace/log isolation, main-owned workspace/provider/runtime sidecars, readiness, and clean shutdown. R-DESK/R-PKG still cannot claim pass until the cold-started production or packaged window runs a real Runtime Codex task, records provider/profile/model/workspace/command id plus audit refs, opens or explicitly exempts an artifact, and performs selected-artifact follow-up.',
      path: 'tests/smoke/smoke-desktop-live-acceptance-evidence.test.ts',
    };
  }
  return {
    ...runtimeBlocker,
    path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
    isSharedRuntimeBlocker: true,
  };
}

function blockerManifestStatus(blocker: RealTaskBlocker): RealTaskManifestStatus {
  if (blocker.isSharedRuntimeBlocker && blocker.status === 'failed') return 'blocked';
  if (blocker.status === 'blocked' || blocker.status === 'failed' || blocker.status === 'partial') return blocker.status;
  return 'not-run';
}

function blockerStatusReason(blocker: RealTaskBlocker, manifestStatus: RealTaskManifestStatus): string {
  if (blocker.isSharedRuntimeBlocker && blocker.status === 'failed' && manifestStatus === 'blocked') {
    return `Blocked by shared Runtime Codex browser acceptance failure: ${blocker.reason}`;
  }
  return blocker.reason;
}

async function currentRuntimeBlocker(): Promise<{ status: string; reason: string }> {
  const manifest = await readJson<Record<string, unknown>>(join(
    root,
    'docs',
    'test-artifacts',
    'runtime-codex-browser-acceptance',
    'manifest.json',
  ));
  const status = typeof manifest?.status === 'string' ? manifest.status : 'missing';
  const reason = typeof manifest?.reason === 'string'
    ? manifest.reason
    : typeof manifest?.blocker === 'string'
      ? manifest.blocker
      : 'Runtime Codex browser acceptance evidence is missing.';
  return { status, reason };
}

function shouldRefreshScaffold(manifest: RealTaskEvidenceManifest, expectedScaffold: RealTaskEvidenceManifest): boolean {
  if (manifest.status === 'passed') return false;
  if ((manifest.evidenceRefs ?? []).length > 0) return false;
  return JSON.stringify(manifest) !== JSON.stringify(expectedScaffold);
}

async function assertRealTaskEvidenceManifest(
  manifest: RealTaskEvidenceManifest,
  entry: RealTaskMatrixEntry,
  projectTask: ProjectTask,
  manifestPath: string,
): Promise<void> {
  assert.equal(manifest.schemaVersion, 'sciforge.real-task-manifest.v1', `${entry.id}: manifest schema`);
  assert.equal(manifest.taskId, entry.id, `${entry.id}: manifest taskId`);
  assert.equal(manifest.title, projectTask.title, `${entry.id}: manifest title must mirror PROJECT.md`);
  assert.equal(manifest.sourceProjectPath, 'PROJECT.md', `${entry.id}: sourceProjectPath`);
  assert.equal(manifest.sourceProjectLine, projectTask.line, `${entry.id}: sourceProjectLine`);
  assert.equal(manifest.sourceProjectText, projectTask.sourceText, `${entry.id}: sourceProjectText must mirror PROJECT.md`);
  assert.equal(manifest.minTurns, entry.minTurns, `${entry.id}: minTurns`);
  assert.ok(isRealTaskManifestStatus(manifest.status), `${entry.id}: invalid manifest status`);
  assert.equal(manifest.entrypointExpectations?.entrypoint, entry.entrypoint, `${entry.id}: entrypoint`);
  assert.equal(manifest.entrypointExpectations?.requiresRuntimeCodex, true, `${entry.id}: requires Runtime Codex`);
  assert.equal(manifest.entrypointExpectations?.requiresVisibleGuiPresentAnswer, true, `${entry.id}: requires visible GUI answer`);
  assertEntrypointExpectations(manifest, entry);
  assert.equal(manifest.entrypointExpectations?.allowsScriptableMockAsPass, false, `${entry.id}: scriptable mock cannot pass`);
  assert.equal(manifest.entrypointExpectations?.allowsSeedDemoFixtureAsPass, false, `${entry.id}: seed/demo fixture cannot pass`);
  for (const evidenceClass of requiredManifestEvidenceClasses()) {
    assert.ok(manifest.requiredEvidenceClasses?.includes(evidenceClass), `${entry.id}: missing evidence class ${evidenceClass}`);
  }

  if (manifest.status !== 'passed') {
    assert.equal(manifest.releaseEligible, false, `${entry.id}: ${manifest.status} manifest must explicitly reject release eligibility`);
    assert.equal(manifest.releaseBlocking, true, `${entry.id}: ${manifest.status} manifest must remain release blocking`);
    await assertNonPassedEvidenceScope(manifest, entry, dirname(manifestPath));
    if ((manifest.evidenceRefs ?? []).length === 0 && manifest.statusSource?.observedStatus === 'failed') {
      assert.equal(
        manifest.status,
        'blocked',
        `${entry.id}: shared failed Runtime Codex probe with no task-specific evidence must block the task, not mark the task attempt failed`,
      );
      assert.match(
        manifest.statusReason ?? '',
        /Blocked by shared Runtime Codex browser acceptance failure/,
        `${entry.id}: shared failed Runtime Codex probe must explain that the task is blocked by shared acceptance evidence`,
      );
    }
    return;
  }

  assertNoFixtureEvidence(manifest, entry.id);
  assert.equal(manifest.releaseEligible, true, `${entry.id}: passed manifest must be release eligible`);
  assert.equal(manifest.releaseBlocking, false, `${entry.id}: passed manifest must not remain release blocking`);
  assertPassedRuntimeProvenance(manifest, entry);
  await assertSelectedRefEvidence(manifest, entry.id, dirname(manifestPath));
  await assertTaskSpecificSelectedRefEvidence(manifest, entry.id, dirname(manifestPath));
  await assertTaskGroupCEvidence(manifest, entry.id, dirname(manifestPath));
  assert.ok((manifest.turns ?? []).length >= entry.minTurns, `${entry.id}: passed manifest requires at least three turns`);
  for (const turn of manifest.turns ?? []) {
    assert.ok(turn.turnId?.trim(), `${entry.id}: turnId is required`);
    assert.ok(turn.prompt?.trim(), `${entry.id}: turn prompt is required`);
  }
  assert.ok(stringList(manifest.screenshotRefs).length > 0, `${entry.id}: passed manifest requires screenshot refs`);
  assert.ok(stringList(manifest.auditRefs).length > 0, `${entry.id}: passed manifest requires audit refs`);
  await assertEvidenceRefsExist(stringList(manifest.evidenceRefs), dirname(manifestPath), `${entry.id}: evidenceRefs`);
  assert.ok(visibleAnswerText(manifest.visibleAnswer).trim(), `${entry.id}: passed manifest requires visibleAnswer`);
  assert.ok(typeof manifest.provider === 'string' && manifest.provider.trim(), `${entry.id}: passed manifest requires provider`);
  assert.ok(typeof manifest.model === 'string' && manifest.model.trim(), `${entry.id}: passed manifest requires model`);
  assert.ok(typeof manifest.profile === 'string' && manifest.profile.trim(), `${entry.id}: passed manifest requires profile`);
  assertResume02ContinuityEvidence(manifest, entry.id);

  const artifactPaths = optionalStringList(manifest.artifactPaths);
  if (artifactPaths.length === 0) {
    assert.ok(manifest.noArtifactReason?.trim(), `${entry.id}: passed manifest requires artifactPaths or noArtifactReason`);
    return;
  }
  for (const artifactPath of artifactPaths) {
    await access(resolveWorkspacePath(dirname(manifestPath), artifactPath));
  }
}

async function assertNonPassedEvidenceScope(
  manifest: RealTaskEvidenceManifest,
  entry: RealTaskMatrixEntry,
  baseDir: string,
): Promise<void> {
  const evidenceRefs = optionalStringList(manifest.evidenceRefs);
  const isDesktopTask = entry.entrypoint === 'production-desktop-cold-start';
  const expectedSharedScope = nonPassedSharedEvidenceScope(entry);
  if (evidenceRefs.length === 0) {
    assert.equal(
      manifest.attemptScope,
      expectedSharedScope,
      `${entry.id}: ${manifest.status} scaffold without task-specific evidence must remain ${expectedSharedScope}`,
    );
    assert.equal(
      manifest.currentRunEvidenceScope,
      expectedSharedScope,
      `${entry.id}: ${manifest.status} scaffold must declare currentRunEvidenceScope=${expectedSharedScope}`,
    );
    return;
  }

  assert.ok(
    manifest.attemptScope === 'task-specific-live-attempt' || manifest.attemptScope === 'desktop-live-attempt',
    `${entry.id}: ${manifest.status} manifest with evidenceRefs must declare a task-specific live attempt scope`,
  );
  assert.equal(
    manifest.currentRunEvidenceScope,
    manifest.attemptScope,
    `${entry.id}: currentRunEvidenceScope must mirror attemptScope when evidenceRefs are present`,
  );
  if (isDesktopTask) {
    assert.equal(manifest.attemptScope, 'desktop-live-attempt', `${entry.id}: desktop evidence refs require desktop-live-attempt scope`);
  }
  await assertEvidenceRefsExist(evidenceRefs, baseDir, `${entry.id}: non-passed evidenceRefs`);
}

function nonPassedSharedEvidenceScope(entry: RealTaskMatrixEntry): NonNullable<RealTaskEvidenceManifest['attemptScope']> {
  return entry.entrypoint === 'production-desktop-cold-start' ? 'desktop-preflight' : 'shared-preflight';
}

function assertEntrypointExpectations(manifest: RealTaskEvidenceManifest, entry: RealTaskMatrixEntry): void {
  if (entry.entrypoint === 'codex-in-app-browser-default-chat') {
    assert.equal(
      manifest.entrypointExpectations?.startedFromDefaultChatEntry,
      true,
      `${entry.id}: browser task must start from the default chat entry`,
    );
    assert.equal(
      manifest.entrypointExpectations?.requiresLiveBrowserAcceptance,
      true,
      `${entry.id}: browser task must require live in-app browser acceptance`,
    );
    assert.equal(
      manifest.entrypointExpectations?.requiresProductionDesktopAcceptance,
      false,
      `${entry.id}: browser task must not be satisfied by production desktop acceptance`,
    );
    return;
  }

  assert.equal(
    manifest.entrypointExpectations?.startedFromDefaultChatEntry,
    false,
    `${entry.id}: production desktop task must not claim default browser chat start`,
  );
  assert.equal(
    manifest.entrypointExpectations?.requiresLiveBrowserAcceptance,
    false,
    `${entry.id}: production desktop task must not require browser-only acceptance`,
  );
  assert.equal(
    manifest.entrypointExpectations?.requiresProductionDesktopAcceptance,
    true,
    `${entry.id}: production desktop task must require production desktop acceptance`,
  );
}

function assertPassedRuntimeProvenance(manifest: RealTaskEvidenceManifest, entry: RealTaskMatrixEntry): void {
  assert.equal(
    manifest.source?.evidenceMode,
    'live-runtime-codex',
    `${entry.id}: passed manifest must record live-runtime-codex evidenceMode`,
  );
  assert.equal(
    manifest.source?.runtimeSource,
    'runtime-codex',
    `${entry.id}: passed manifest must record Runtime Codex as runtimeSource`,
  );
  assert.equal(
    manifest.source?.entrypoint,
    entry.entrypoint,
    `${entry.id}: passed manifest source.entrypoint must match the task matrix entrypoint`,
  );
  if (entry.entrypoint === 'codex-in-app-browser-default-chat') {
    assert.equal(
      manifest.entrypointExpectations?.startedFromDefaultChatEntry,
      true,
      `${entry.id}: browser passed manifest must start from the default chat entry`,
    );
  }
  assert.equal(manifest.entrypointExpectations?.requiresRuntimeCodex, true, `${entry.id}: passed manifest must require Runtime Codex`);
  assert.equal(manifest.entrypointExpectations?.requiresVisibleGuiPresentAnswer, true, `${entry.id}: passed manifest must require visible GUI answer`);
  assert.ok(isAbsolute(stringValue(manifest.workspacePath)), `${entry.id}: passed manifest must record absolute workspacePath`);
  assert.match(stringValue(manifest.actualUrl), /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//, `${entry.id}: passed manifest must record actual loopback URL`);
  assert.ok(typeof manifest.actualPort === 'number' && manifest.actualPort > 0, `${entry.id}: passed manifest must record actualPort`);
  assert.equal(new URL(stringValue(manifest.actualUrl)).port, String(manifest.actualPort), `${entry.id}: actualUrl port must match actualPort`);
  assert.match(stringValue(manifest.commandId), /^codex-command-[a-z0-9-]+$/i, `${entry.id}: passed manifest must record Runtime Codex commandId`);
}

async function assertSelectedRefEvidence(manifest: RealTaskEvidenceManifest, id: string, baseDir: string): Promise<void> {
  const selected = manifest.selectedRefEvidence;
  assert.ok(isRecord(selected), `${id}: passed manifest must include selectedRefEvidence`);
  const artifactRef = stringValue(selected.artifactRef);
  const exemptionReason = stringValue(selected.exemptionReason);
  assert.ok(artifactRef || exemptionReason, `${id}: selectedRefEvidence must include artifactRef or exemptionReason`);
  if (artifactRef) {
    assert.doesNotMatch(
      artifactRef,
      /latest artifact|implicit|auto-selected/i,
      `${id}: selectedRefEvidence.artifactRef must be an explicit selected ref, not an implicit latest artifact`,
    );
  }
  await assertEvidenceRefsExist(stringList(selected.evidenceRefs), baseDir, `${id}: selectedRefEvidence.evidenceRefs`);
}

async function assertTaskSpecificSelectedRefEvidence(manifest: RealTaskEvidenceManifest, id: string, baseDir: string): Promise<void> {
  if (id === 'R-LIT-03') {
    const selected = manifest.selectedRefEvidence;
    assert.ok(isRecord(selected), `${id}: selectedRefEvidence is required`);
    const selectedRefs = stringList(selected.selectedRefs);
    assert.ok(selectedRefs.length >= 2, `${id}: passed manifest must include old and switched selected report refs`);
    assert.equal(new Set(selectedRefs).size, selectedRefs.length, `${id}: selected report refs must be distinct`);
    assert.ok(selectedRefs.every((ref) => /^artifact:r-lit-03-.+-report$/.test(ref)), `${id}: selected report refs must be durable R-LIT-03 report refs`);
    assert.equal(selected.latestArtifactUsed, false, `${id}: selected-report follow-up must prove it did not use the latest artifact`);
    assert.ok(stringList(selected.followupRunIds).length >= 2, `${id}: passed manifest must include old-report and switched-selection follow-up run ids`);
    assert.ok(stringList(selected.forbiddenRefs).length > 0, `${id}: passed manifest must record forbidden unselected/latest refs`);
    await assertEvidenceRefsExist(stringList(selected.evidenceRefs), baseDir, `${id}: selected-scope evidence refs`);
  }

  if (id !== 'R-RESUME-01') return;
  const selected = manifest.selectedRefEvidence;
  assert.ok(isRecord(selected), `${id}: selectedRefEvidence is required`);
  const selectedArtifactRef = stringValue(selected.artifactRef);
  const selectedRefs = stringList(selected.selectedRefs);
  assert.ok(selectedArtifactRef, `${id}: selected artifact ref is required`);
  assert.ok(selectedRefs.includes(selectedArtifactRef), `${id}: selectedRefs must include the selected artifact ref`);
  const derivedArtifactRef = stringValue(selected.derivedArtifactRef);
  assert.ok(derivedArtifactRef, `${id}: derivedArtifactRef is required`);
  assert.notEqual(derivedArtifactRef, selectedArtifactRef, `${id}: derived artifact must differ from the selected source artifact`);
  assert.ok(stringValue(selected.resumeMetadataRef), `${id}: resumeMetadataRef is required`);

  const commandTextPolicy = selected.commandTextPolicy;
  assert.ok(isRecord(commandTextPolicy), `${id}: commandTextPolicy is required`);
  assert.equal(commandTextPolicy.newUserRequestOnly, true, `${id}: commandText must include only the new user request plus refs`);
  assert.equal(commandTextPolicy.selectedRefsOnly, true, `${id}: commandText must carry selected refs only`);
  assert.equal(commandTextPolicy.replaysGuiTranscript, false, `${id}: commandText must not replay GUI transcript`);
  assert.equal(commandTextPolicy.includesFullArtifactBody, false, `${id}: commandText must not include the full artifact body`);
  await assertEvidenceRefsExist(stringList(commandTextPolicy.evidenceRefs), baseDir, `${id}: commandTextPolicy.evidenceRefs`);

  const nativeContinuity = manifest.nativeContinuity;
  assert.ok(isRecord(nativeContinuity), `${id}: nativeContinuity is required`);
  const codexSessionId = stringValue(nativeContinuity.codexSessionId);
  const resumeCommand = stringValue(nativeContinuity.resumeCommand);
  assert.ok(codexSessionId, `${id}: nativeContinuity.codexSessionId is required`);
  assert.match(resumeCommand, /\bcodex\b.*\bresume\b/i, `${id}: nativeContinuity.resumeCommand must be a Runtime Codex native resume command`);
  assert.ok(resumeCommand.includes(codexSessionId), `${id}: resume command must include the native codexSessionId`);
  assert.ok(resumeCommand.includes(selectedArtifactRef), `${id}: resume command must include the selected artifact ref`);
  assert.doesNotMatch(
    resumeCommand,
    /GUI transcript|full artifact body|projection-only|frontend-memory-only/i,
    `${id}: resume command cannot replay GUI transcript or full artifact body`,
  );
  await assertEvidenceRefsExist(stringList(nativeContinuity.evidenceRefs), baseDir, `${id}: nativeContinuity.evidenceRefs`);
}

function assertResume02ContinuityEvidence(manifest: RealTaskEvidenceManifest, id: string): void {
  if (id !== 'R-RESUME-02') return;

  const restoredGuiStateSource = stringValue(manifest.restoredGuiStateSource);
  assert.ok(
    restoredGuiStateSource,
    `${id}: restoredGuiStateSource is required to distinguish GUI restore from native Runtime Codex continuity`,
  );
  assert.doesNotMatch(
    restoredGuiStateSource,
    /^runtime-codex-native-session$/i,
    `${id}: restoredGuiStateSource must describe GUI state restoration, not native Runtime Codex continuity`,
  );

  const nativeContinuity = manifest.nativeContinuity;
  assert.ok(
    isRecord(nativeContinuity),
    `${id}: nativeContinuity is required; Projection-only evidence cannot satisfy Runtime Codex native continuity`,
  );

  const codexSessionId = stringValue(nativeContinuity.codexSessionId);
  const resumeCommand = stringValue(nativeContinuity.resumeCommand);
  const attemptId = stringValue(nativeContinuity.attemptId);
  assert.ok(codexSessionId, `${id}: nativeContinuity.codexSessionId is required`);
  assert.ok(attemptId, `${id}: nativeContinuity.attemptId is required`);
  assert.ok(resumeCommand, `${id}: nativeContinuity.resumeCommand is required`);
  assert.match(
    resumeCommand,
    /\bcodex\b.*\bresume\b/i,
    `${id}: nativeContinuity.resumeCommand must be a Runtime Codex native resume command`,
  );
  assert.ok(
    resumeCommand.includes(codexSessionId),
    `${id}: nativeContinuity.resumeCommand must include nativeContinuity.codexSessionId`,
  );
  assert.doesNotMatch(
    resumeCommand,
    /projection-only|conversation-projection only|frontend-memory-only/i,
    `${id}: Projection-only evidence cannot masquerade as native resume pass`,
  );
}

async function assertTaskGroupCEvidence(manifest: RealTaskEvidenceManifest, id: string, baseDir: string): Promise<void> {
  if (id === 'R-RUN-01') await assertServiceLifecycleEvidence(manifest, baseDir);
  if (id === 'R-RUN-02') await assertCancellationEvidence(manifest, baseDir);
  if (id === 'R-SEC-01') await assertSecurityScrubEvidence(manifest, baseDir);
  if (id === 'R-AUDIT-01') await assertFailedRunAuditExport(manifest, baseDir);
  if (id === 'R-FAIL-01') await assertProviderOutageRecovery(manifest, baseDir);
}

async function assertServiceLifecycleEvidence(manifest: RealTaskEvidenceManifest, baseDir: string): Promise<void> {
  const evidence = manifest.serviceLifecycleEvidence;
  assert.ok(isRecord(evidence), 'R-RUN-01: serviceLifecycleEvidence is required');
  const ledgerRef = stringValue(evidence.ledgerRef);
  assert.ok(ledgerRef, 'R-RUN-01: serviceLifecycleEvidence.ledgerRef is required');
  const ledger = await readRequiredJson<Record<string, unknown>>(resolveWorkspacePath(baseDir, ledgerRef), 'R-RUN-01: serviceLifecycleEvidence.ledgerRef');
  const validation = validateServiceLifecycleEvidenceLedger(ledger);
  assert.equal(
    validation.ok,
    true,
    `R-RUN-01: service lifecycle ledger must validate: ${validation.errors.join('; ')}`,
  );
  assert.equal(
    evidence.actualPort,
    manifest.actualPort,
    'R-RUN-01: serviceLifecycleEvidence.actualPort must match manifest.actualPort',
  );
  await assertEvidenceRefsExist([
    ledgerRef,
    ...stringList(evidence.cleanupEvidenceRefs),
    ...stringList(evidence.readinessCheckRefs),
    ...stringList(evidence.browserRefreshEvidenceRefs),
    ...stringList(evidence.passClaimRefs),
  ], baseDir, 'R-RUN-01: service lifecycle evidence refs');
}

async function assertCancellationEvidence(manifest: RealTaskEvidenceManifest, baseDir: string): Promise<void> {
  const evidence = manifest.cancellationEvidence;
  assert.ok(isRecord(evidence), 'R-RUN-02: cancellationEvidence is required');
  const ledgerRef = stringValue(evidence.ledgerRef);
  const safeContinuationPlanRef = stringValue(evidence.safeContinuationPlanRef);
  assert.ok(ledgerRef, 'R-RUN-02: cancellationEvidence.ledgerRef is required');
  assert.ok(safeContinuationPlanRef, 'R-RUN-02: cancellationEvidence.safeContinuationPlanRef is required');

  const ledger = await readRequiredJson<Record<string, unknown>>(resolveWorkspacePath(baseDir, ledgerRef), 'R-RUN-02: cancellationEvidence.ledgerRef');
  const validation = validateCancellationEvidenceLedger(ledger);
  assert.equal(
    validation.ok,
    true,
    `R-RUN-02: cancellation ledger must validate: ${validation.errors.join('; ')}`,
  );

  const continuationPlan = await readRequiredJson<Record<string, unknown>>(
    resolveWorkspacePath(baseDir, safeContinuationPlanRef),
    'R-RUN-02: cancellationEvidence.safeContinuationPlanRef',
  );
  assert.equal(
    continuationPlan.continuationScope,
    'safe-remainder-only',
    'R-RUN-02: safeContinuationPlanRef must point to a safe-remainder-only plan',
  );
  assert.notEqual(
    continuationPlan.reason,
    'boundaryless-resume-blocked',
    'R-RUN-02: safeContinuationPlanRef cannot be a blocked boundaryless resume plan',
  );
  await assertEvidenceRefsExist([
    ledgerRef,
    safeContinuationPlanRef,
    ...stringList(evidence.partialArtifactRefs),
    ...stringList(evidence.unsafeRemainderRefs),
    ...stringList(evidence.irreversibleSideEffectRefs),
  ], baseDir, 'R-RUN-02: cancellation evidence refs');
}

async function assertSecurityScrubEvidence(manifest: RealTaskEvidenceManifest, baseDir: string): Promise<void> {
  const evidence = manifest.securityScrubEvidence;
  assert.ok(isRecord(evidence), 'R-SEC-01: securityScrubEvidence is required');
  const rawAuditBundleManifestRef = stringValue(evidence.rawAuditBundleManifestRef);
  const diagnosisRef = stringValue(evidence.diagnosisRef);
  const correctedConfigRetryRef = stringValue(evidence.correctedConfigRetryRef);
  assert.ok(rawAuditBundleManifestRef, 'R-SEC-01: rawAuditBundleManifestRef is required');
  assert.ok(diagnosisRef, 'R-SEC-01: diagnosisRef is required');
  assert.ok(correctedConfigRetryRef, 'R-SEC-01: correctedConfigRetryRef is required');
  assert.ok(stringList(evidence.primaryReplyDomRefs).length > 0, 'R-SEC-01: primaryReplyDomRefs are required');
  assert.ok(stringList(evidence.forbiddenLeakCheckRefs).length > 0, 'R-SEC-01: forbiddenLeakCheckRefs are required');
  await assertRuntimeAuditBundleManifest(baseDir, rawAuditBundleManifestRef, {
    taskId: 'R-SEC-01',
    status: 'failed',
  });
  await assertEvidenceRefsExist([
    rawAuditBundleManifestRef,
    diagnosisRef,
    correctedConfigRetryRef,
    ...stringList(evidence.primaryReplyDomRefs),
    ...stringList(evidence.forbiddenLeakCheckRefs),
  ], baseDir, 'R-SEC-01: security scrub evidence refs');
}

async function assertFailedRunAuditExport(manifest: RealTaskEvidenceManifest, baseDir: string): Promise<void> {
  const evidence = manifest.failedRunAuditExport;
  assert.ok(isRecord(evidence), 'R-AUDIT-01: failedRunAuditExport is required');
  const bundleManifestRef = stringValue(evidence.bundleManifestRef);
  assert.ok(bundleManifestRef, 'R-AUDIT-01: failedRunAuditExport.bundleManifestRef is required');
  const bundleManifest = await assertRuntimeAuditBundleManifest(baseDir, bundleManifestRef, {
    taskId: 'R-AUDIT-01',
    status: 'failed',
  });
  assert.equal(evidence.runId, bundleManifest.runId, 'R-AUDIT-01: failedRunAuditExport.runId must match bundle manifest');
  assert.equal(evidence.commandId, bundleManifest.commandId, 'R-AUDIT-01: failedRunAuditExport.commandId must match bundle manifest');
  assert.equal(evidence.provider, bundleManifest.provider, 'R-AUDIT-01: failedRunAuditExport.provider must match bundle manifest');
  assert.equal(evidence.model, bundleManifest.model, 'R-AUDIT-01: failedRunAuditExport.model must match bundle manifest');
  assert.equal(evidence.profile, bundleManifest.profile, 'R-AUDIT-01: failedRunAuditExport.profile must match bundle manifest');
  await assertEvidenceRefsExist([
    bundleManifestRef,
    ...stringList(evidence.boundedScrubbedRefs),
  ], baseDir, 'R-AUDIT-01: failed run audit export evidence refs');
}

async function assertProviderOutageRecovery(manifest: RealTaskEvidenceManifest, baseDir: string): Promise<void> {
  const evidence = manifest.providerOutageRecovery;
  assert.ok(isRecord(evidence), 'R-FAIL-01: providerOutageRecovery is required');
  assert.match(
    stringValue(evidence.failureClassification),
    /^(provider-auth|provider-gateway|external-network|rate-limited|timeout|dns)$/,
    'R-FAIL-01: providerOutageRecovery.failureClassification must identify provider/config/network class',
  );
  assert.match(
    stringValue(evidence.initialFailureStatus),
    /^(blocked|repair-needed)$/,
    'R-FAIL-01: initial failure must be blocked or repair-needed',
  );
  assert.ok(stringValue(evidence.initialFailureRunId), 'R-FAIL-01: initialFailureRunId is required');
  assert.ok(stringValue(evidence.recoveryRunId), 'R-FAIL-01: recoveryRunId is required');
  assert.notEqual(evidence.initialFailureRunId, evidence.recoveryRunId, 'R-FAIL-01: recovery must use a distinct run id');
  assert.equal(
    evidence.reusedFailedOutputAsSuccessEvidence,
    false,
    'R-FAIL-01: reusedFailedOutputAsSuccessEvidence must be false',
  );
  await assertEvidenceRefsExist([
    stringValue(evidence.initialFailureRef),
    stringValue(evidence.recoveryEvidenceRef),
    stringValue(evidence.freshDispatchEvidenceRef),
  ], baseDir, 'R-FAIL-01: provider outage recovery evidence refs');
}

async function assertRuntimeAuditBundleManifest(
  baseDir: string,
  manifestRef: string,
  options: { taskId: string; status?: string },
): Promise<Record<string, unknown>> {
  const manifest = await readRequiredJson<Record<string, unknown>>(
    resolveWorkspacePath(baseDir, manifestRef),
    `${options.taskId}: audit bundle manifest`,
  );
  assert.equal(manifest.schemaVersion, 'sciforge.runtime-codex.audit-bundle.v1', `${options.taskId}: audit bundle schemaVersion`);
  if (options.status) assert.equal(manifest.status, options.status, `${options.taskId}: audit bundle status`);
  assert.ok(stringValue(manifest.runId), `${options.taskId}: audit bundle runId is required`);
  assert.ok(stringValue(manifest.commandId), `${options.taskId}: audit bundle commandId is required`);
  assert.ok(stringValue(manifest.provider), `${options.taskId}: audit bundle provider is required`);
  assert.ok(stringValue(manifest.model), `${options.taskId}: audit bundle model is required`);
  assert.ok(stringValue(manifest.profile), `${options.taskId}: audit bundle profile is required`);

  const files = isRecord(manifest.files) ? manifest.files : {};
  for (const key of ['rawJsonl', 'stderr', 'normalizedEvents'] as const) {
    const file = files[key];
    assert.ok(isRecord(file), `${options.taskId}: audit bundle files.${key} is required`);
    const path = stringValue(file.path);
    assert.ok(path, `${options.taskId}: audit bundle files.${key}.path is required`);
    assert.ok(typeof file.bytes === 'number', `${options.taskId}: audit bundle files.${key}.bytes is required`);
    assert.ok(typeof file.maxBytes === 'number', `${options.taskId}: audit bundle files.${key}.maxBytes is required`);
    assert.ok(
      Number(file.bytes) <= Number(file.maxBytes),
      `${options.taskId}: bounded audit file ${path} must not exceed maxBytes`,
    );
    assert.match(stringValue(file.rawSha256), /^sha256:/, `${options.taskId}: audit bundle files.${key}.rawSha256 is required`);
    await access(resolveWorkspacePath(baseDir, path));
  }
  return manifest;
}

function assertNoFixtureEvidence(manifest: RealTaskEvidenceManifest, id: string): void {
  const provenanceValues = [
    manifest.source?.evidenceMode,
    manifest.source?.devServices,
    manifest.source?.harnessMode,
    manifest.source?.runtimeSource,
    ...(manifest.turns ?? []).map((turn) => turn.evidenceSource),
  ].flatMap((value) => typeof value === 'string' ? [value] : []);
  const forbidden = provenanceValues.find((value) => /^(fixture-managed|scriptable-mock|seed-demo)$/i.test(value));
  assert.equal(forbidden, undefined, `${id}: passed manifest cannot use fixture-managed, scriptable-mock, or seed-demo evidence`);
}

async function assertEvidenceRefsExist(refs: string[], baseDir: string, label: string): Promise<void> {
  assert.ok(refs.length > 0, `${label} must include at least one ref`);
  for (const ref of refs) {
    assert.ok(ref.trim(), `${label}: evidence ref cannot be blank`);
    if (/^[a-z]+:/i.test(ref) && !ref.startsWith('file:') && !ref.startsWith('workspace://')) continue;
    await access(resolveWorkspacePath(baseDir, ref)).catch((error: unknown) => {
      throw new Error(`${label}: evidence ref must exist: ${ref}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

function requiredManifestEvidenceClasses(): string[] {
  return [
    'three-turn-record',
    'visible-dom-answer',
    'screenshot',
    'runtime-audit-refs',
    'workspace-artifact-or-explicit-no-artifact-reason',
    'command-or-test-output',
    'provider-model-profile',
    'selected-ref-policy-or-explicit-exemption',
    'port-url-and-run-identifiers',
  ];
}

function isRealTaskManifestStatus(value: unknown): value is RealTaskManifestStatus {
  return value === 'not-run' || value === 'blocked' || value === 'partial' || value === 'failed' || value === 'passed';
}

async function readManifestIds(manifestRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(manifestRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(manifestRoot, entry.name, 'manifest.json');
    try {
      await access(manifestPath);
      ids.push(entry.name);
    } catch {
      // Non-manifest directories in test-artifacts are ignored by this gate.
    }
  }
  return ids;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readRequiredJson<T>(path: string, label: string): Promise<T> {
  const value = await readJson<T>(path);
  assert.ok(value, `${label}: JSON evidence ref must exist`);
  return value;
}

function stringList(value: unknown): string[] {
  assert.ok(Array.isArray(value), 'expected an array');
  assert.ok(value.every((item) => typeof item === 'string' && item.trim()), 'expected non-empty strings');
  return value as string[];
}

function optionalStringList(value: unknown): string[] {
  if (value === undefined) return [];
  return stringList(value);
}

function visibleAnswerText(value: RealTaskEvidenceManifest['visibleAnswer']): string {
  if (typeof value === 'string') return value;
  return value?.text ?? '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveWorkspacePath(baseDir: string, value: string): string {
  if (isAbsolute(value)) return value;
  if (value.startsWith('file:')) return value.slice('file:'.length);
  if (value.startsWith('workspace://')) return join(root, value.slice('workspace://'.length));
  if (value.startsWith('workspace/')) return join(root, value);
  return join(baseDir, value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
