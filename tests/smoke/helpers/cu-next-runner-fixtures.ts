import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { CU_NEXT_TASK_MAPPINGS } from '../../../tools/computer-use-next/task-map.js';
import { projectCuNextAcceptanceForScenarioRun } from '../../../tools/cu-next-run.js';

const execFileAsync = promisify(execFile);
const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);

function sciForgeChatOrigin(runId: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.chat-origin.v1',
    handoffSource: 'ui-chat',
    entrypoint: 'sciforge-chat',
    terminalEquivalentText: true,
    selectedActionProvider: 'action.sciforge.computer-use',
    selectedToolIds: ['local.vision-sense'],
    sessionRefs: [`computer-use-session:${runId}`],
  };
}

export async function writeCuNextValidateRunStatusFixture(
  workspace: string,
  runId: string,
  options: { manifestStatus: 'passed' | 'repair-needed'; summaryStatus: 'passed' | 'repair-needed' },
): Promise<string> {
  const prepare = await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    'tools/cu-next-run.ts',
    'prepare',
    '--task',
    'CU-NEXT-07',
    '--out-root',
    workspace,
    '--run-id',
    runId,
    '--workspace-path',
    workspace,
  ]);
  const manifestPath = /manifest: (.+)/.exec(prepare.stdout)?.[1]?.trim();
  assert.ok(manifestPath, 'prepare output should include manifest path');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.status = options.manifestStatus;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dirname(manifestPath), 'scenario-summary.json'), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1',
    scenarioId: 'CU-LONG-004',
    status: options.summaryStatus,
  }, null, 2)}\n`);
  await writeFile(join(dirname(manifestPath), 'cu-user-acceptance-manifest.json'), `${JSON.stringify(passedCuNext07AcceptanceManifest(), null, 2)}\n`);
  return manifestPath;
}

export async function writeCuNextValidateRunLiveAcceptanceFixture(
  workspace: string,
  runId: string,
  options: {
    includeMarker: boolean;
    materializeAcceptanceRefs?: boolean;
    realTrace?: boolean;
    mutateAcceptance?: (acceptance: Record<string, unknown>) => void;
  },
): Promise<string> {
  const prepare = await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    'tools/cu-next-run.ts',
    'prepare',
    '--task',
    'CU-NEXT-07',
    '--out-root',
    workspace,
    '--run-id',
    runId,
    '--workspace-path',
    workspace,
  ]);
  const manifestPath = /manifest: (.+)/.exec(prepare.stdout)?.[1]?.trim();
  assert.ok(manifestPath, 'prepare output should include manifest path');
  const runDir = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.status = 'passed';
  for (const round of manifest.rounds as Array<Record<string, unknown>>) {
    const roundNumber = Number(round.round);
    assert.ok(Number.isInteger(roundNumber), 'prepared round should include a numeric round');
    const roundDirName = `round-${String(roundNumber).padStart(2, '0')}`;
    const evidenceDir = join(runDir, 'evidence', roundDirName);
    await mkdir(evidenceDir, { recursive: true });
    await Promise.all([
      writeFile(join(evidenceDir, 'before.png'), fixturePng),
      writeFile(join(evidenceDir, 'after.png'), fixturePng),
      writeFile(join(evidenceDir, 'runtime-prompt.md'), `CU-NEXT validate-run fixture ${runId} round ${roundNumber}\n`),
      writeFile(join(evidenceDir, 'vision-trace.json'), `${JSON.stringify(cuNextValidateRunTrace(runId, roundNumber, { realTrace: options.realTrace === true }), null, 2)}\n`),
      writeFile(join(evidenceDir, 'action-ledger.json'), `${JSON.stringify({
        schemaVersion: 'sciforge.computer-use-long.action-ledger.v1',
        runtimePromptRef: `evidence/${roundDirName}/runtime-prompt.md`,
        executionUnits: [{ status: 'done' }],
      }, null, 2)}\n`),
      writeFile(join(evidenceDir, 'failure-diagnostics.json'), `${JSON.stringify({
        schemaVersion: 'sciforge.computer-use-long.failure-diagnostics.v1',
        status: 'done',
        traceValidation: { ok: true, issues: [], metrics: { actionCount: 1, nonWaitActionCount: 1 } },
      }, null, 2)}\n`),
    ]);
    round.status = 'passed';
    round.visionTraceRef = `evidence/${roundDirName}/vision-trace.json`;
    round.screenshotRefs = ['before.png', 'after.png'];
    round.actionLedgerRefs = [`evidence/${roundDirName}/action-ledger.json`];
    round.failureDiagnosticsRefs = [`evidence/${roundDirName}/failure-diagnostics.json`];
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(runDir, 'scenario-summary.json'), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1',
    scenarioId: 'CU-LONG-004',
    status: 'passed',
  }, null, 2)}\n`);
  const finalRound = (manifest.rounds as Array<Record<string, unknown>>).at(-1);
  assert.ok(finalRound?.visionTraceRef, 'fixture should have a passed final round trace ref');
  const acceptanceDir = dirname(join(runDir, String(finalRound.visionTraceRef)));
  const acceptance = passedCuNext07AcceptanceManifest();
  if (!options.includeMarker) delete acceptance.evidenceMarkers;
  options.mutateAcceptance?.(acceptance);
  if (options.materializeAcceptanceRefs) {
    await materializeCuNextAcceptanceRefs(acceptanceDir, acceptance);
  }
  await writeFile(join(acceptanceDir, 'cu-user-acceptance-manifest.json'), `${JSON.stringify(acceptance, null, 2)}\n`);
  return manifestPath;
}

export async function materializeCuNextAcceptanceRefs(acceptanceDir: string, acceptance: Record<string, unknown>) {
  const refs = collectFixtureFileRefs(acceptance);
  const completionEvidenceRef = typeof acceptance.completionEvidenceRef === 'string'
    ? acceptance.completionEvidenceRef
    : undefined;
  const screenshotRefs = acceptance.screenshotRefs && typeof acceptance.screenshotRefs === 'object' && !Array.isArray(acceptance.screenshotRefs)
    ? acceptance.screenshotRefs as Record<string, unknown>
    : {};
  for (const ref of [...stringList(screenshotRefs.before), ...stringList(screenshotRefs.after)]) {
    refs.push(ref);
  }
  await Promise.all(refs.filter((ref) => ref !== completionEvidenceRef).map(async (ref) => {
    const target = materializedFixtureRefPath(acceptanceDir, ref);
    await mkdir(dirname(target), { recursive: true });
    if (await fileExists(target)) return;
    if (/\.(png|jpg|jpeg|webp)$/i.test(ref)) {
      await writeFile(target, fixturePng);
    } else if (/dense-grounding-rejections\.json$|rejected-.+-target\.json$|coarse-fine-rejected-targets\.json$/.test(ref)) {
      await writeFile(target, `${JSON.stringify(denseGroundingRejectedTargetFixture(ref), null, 2)}\n`);
    } else {
      await writeFile(target, `${JSON.stringify({ ref, fixture: 'materialized-live-acceptance-ref' }, null, 2)}\n`);
    }
  }));
  if (completionEvidenceRef) {
    const target = join(acceptanceDir, completionEvidenceRef);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(acceptance.completionEvidence ?? {}, null, 2)}\n`);
    if (acceptance.completionEvidence && typeof acceptance.completionEvidence === 'object' && !Array.isArray(acceptance.completionEvidence)) {
      await materializeCompletionEvidenceRefs(acceptanceDir, acceptance.completionEvidence as Record<string, unknown>);
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function materializeCompletionEvidenceRefs(acceptanceDir: string, completionEvidence: Record<string, unknown>) {
  await Promise.all(collectCompletionEvidenceFileRefs(completionEvidence).map(async (ref) => {
    const target = materializedFixtureRefPath(acceptanceDir, ref);
    await mkdir(dirname(target), { recursive: true });
    if (/\.(png|jpg|jpeg|webp)$/i.test(ref)) {
      await writeFile(target, fixturePng);
    } else {
      await writeFile(target, `${JSON.stringify({ ref, fixture: 'materialized-completion-evidence-ref' }, null, 2)}\n`);
    }
  }));
}

function materializedFixtureRefPath(acceptanceDir: string, ref: string) {
  const normalizedRef = ref.replace(/\\/g, '/');
  if (normalizedRef.startsWith('.sciforge/')) {
    const normalizedDir = acceptanceDir.replace(/\\/g, '/');
    const marker = '/.sciforge/';
    const markerIndex = normalizedDir.indexOf(marker);
    if (markerIndex > 0) return join(normalizedDir.slice(0, markerIndex), normalizedRef);
  }
  return join(acceptanceDir, ref);
}

function collectCompletionEvidenceFileRefs(value: unknown, key = ''): string[] {
  if (typeof value === 'string') {
    const ref = completionEvidenceFixtureFileRef(value);
    return ref && looksLikeCompletionEvidenceFileRef(key, value) ? [ref] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectCompletionEvidenceFileRefs(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, child]) => collectCompletionEvidenceFileRefs(child, childKey));
}

function looksLikeCompletionEvidenceFileRef(key: string, value: string): boolean {
  const fileRef = completionEvidenceFixtureFileRef(value);
  return /ref/i.test(key)
    && Boolean(fileRef)
    && /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(fileRef?.split('/').at(-1) ?? '');
}

function completionEvidenceFixtureFileRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  const fileRef = trimmed.split('#', 1)[0];
  if (!fileRef || fileRef.split(/[\\/]+/).includes('..')) return undefined;
  return fileRef;
}

export function repairDiagnosticsFixture() {
  return {
    actionShortfall: {
      metric: 'actionCount' as const,
      observed: 15,
      minimum: 20,
      missing: 5,
      source: 'scenario-acceptance' as const,
    },
    actionShortfalls: [{
      metric: 'actionCount' as const,
      observed: 15,
      minimum: 20,
      missing: 5,
      source: 'scenario-acceptance' as const,
    }],
    missingRefs: [],
    failingRoundDiagnosticsRefs: [],
    failureReasons: [],
    traceMetricsByRound: [],
    nextRepairFocus: ['Increase the real-run action budget or continue additional evidence-producing generic mouse/keyboard steps until the scenario acceptance minimum is met.'],
  };
}

export function collectFixtureFileRefs(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (item: unknown, key = '') => {
    if (typeof item === 'string') {
      if (looksLikeFixtureFileRef(key, item)) refs.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, key));
      return;
    }
    if (item && typeof item === 'object') {
      for (const [childKey, child] of Object.entries(item)) visit(child, childKey);
    }
  };
  visit(value);
  return [...new Set(refs)];
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

export function uniqueStringList(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function prefixedRef(prefix: string, name: string): string {
  return `${prefix.replace(/\/?$/, '/')}${name}`;
}

export function looksLikeFixtureFileRef(key: string, value: string) {
  const trimmed = value.trim();
  return /ref/i.test(key)
    && trimmed.length > 0
    && !trimmed.startsWith('approval:')
    && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    && !trimmed.startsWith('/')
    && /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(trimmed.split('/').at(-1) ?? '');
}

export function cuNextValidateRunTrace(runId: string, round: number, options: { realTrace?: boolean } = {}): Record<string, unknown> {
  const windowTarget = {
    windowId: `cu-next-validate-${round}`,
    appName: 'SciForge T084 Harness',
    title: `${runId} round ${round}`,
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    coordinateSpace: 'window-local',
  };
  const scheduler = {
    mode: 'serialized-window-actions',
    lockId: `cu-next-validate-lock-${round}`,
    lockScope: 'target-window',
    focusPolicy: 'fail-closed-focus',
    interferenceRisk: 'isolated test fixture window',
    executorLock: options.realTrace
      ? {
          provider: 'filesystem-lease',
          timeoutMs: 1000,
          staleLockMs: 2000,
        }
      : undefined,
  };
  const beforeRef = cuNextValidateRunScreenshotRef('before.png', windowTarget);
  const afterRef = cuNextValidateRunScreenshotRef('after.png', windowTarget);
  const steps = Array.from({ length: options.realTrace ? 5 : 1 }, (_, index) => ({
    kind: 'gui-execution',
    status: 'done',
    plannedAction: {
      type: 'click',
      coordinateSpace: 'window-local',
      localX: 120 + index,
      localY: 96 + index,
      inputChannel: 'generic-mouse-keyboard',
    },
    beforeScreenshotRefs: [beforeRef],
    afterScreenshotRefs: [afterRef],
    execution: {
      inputChannel: 'generic-mouse-keyboard',
      status: 'done',
    },
    verifier: {
      windowConsistency: { status: 'target-window-consistent' },
      visibleEffect: 'low-risk control focus changed',
    },
    grounding: {
      coordinateSpace: 'window-local',
      localX: 120 + index,
      localY: 96 + index,
    },
    windowTarget,
    scheduler: {
      ...scheduler,
      executorLease: options.realTrace
        ? {
            mode: 'real-gui-executor-lock',
            lockId: `cu-next-validate-lock-${round}`,
            status: 'released',
            acquiredAt: '2026-05-25T00:00:00.000Z',
            releasedAt: '2026-05-25T00:00:00.100Z',
          }
        : undefined,
    },
  }));
  return {
    schemaVersion: 'sciforge.vision-trace.v1',
    runId: `${runId}-round-${round}`,
    request: {
      text: 'Inspect low-risk settings form controls with generic mouse input.',
    },
    config: {
      dryRun: options.realTrace === true ? false : true,
      windowTarget,
    },
    windowTarget,
    scheduler,
    genericComputerUse: {
      appSpecificShortcuts: [],
      inputChannel: 'generic-mouse-keyboard',
      inputChannelContract: {
        userDeviceImpact: 'none',
        pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
        highRiskConfirmationRequired: true,
      },
      actionSchema: ['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
      coordinateContract: {
        localCoordinateFrame: 'window-local',
      },
      verifierContract: {
        screenshotScope: 'window',
      },
    },
    windowLifecycle: {
      recoveryPolicy: 'stable-target-window',
    },
    imageMemory: {
      policy: 'file-ref-only',
      refs: [beforeRef, afterRef],
    },
    steps,
  };
}

export function cuNextValidateRunScreenshotRef(
  path: string,
  windowTarget: Record<string, unknown>,
): Record<string, unknown> {
  return {
    path,
    sha256: '0'.repeat(64),
    width: 1,
    height: 1,
    scope: 'window',
    windowId: windowTarget.windowId,
    appName: windowTarget.appName,
    bounds: windowTarget.bounds,
  };
}

export async function writeCuNextProjectionEvidenceFiles(evidenceDir: string) {
  await Promise.all([
    'step-001-before.png',
    'step-001-before-focus.png',
    'step-001-after.png',
    'step-002-before.png',
    'step-002-after.png',
    'step-003-before.png',
    'step-003-after.png',
  ].map((name) => writeFile(join(evidenceDir, name), fixturePng)));
  await writeFile(join(evidenceDir, 'dense-grounding-export.csv'), 'label,x,y\nexport,100,80\n');
}

export async function writeBundleLocalCuNext07Acceptance(workspace: string): Promise<string> {
  const runId = 'cu-next-07-wrapper';
  const runDirRef = `.sciforge/vision-runs/${runId}`;
  const bundleDir = join(workspace, '.sciforge', 'vision-runs', runId);
  const acceptance = passedBundleLocalCuNext07AcceptanceManifest();
  await mkdir(bundleDir, { recursive: true });
  await Promise.all([
    'before.png',
    'after.png',
    'focus-crop.png',
    'final-visible.png',
  ].map((name) => writeFile(join(bundleDir, name), fixturePng)));
  await Promise.all([
    'window-switch-trace.json',
    'computer-use-request.json',
    'host-ports.json',
    'tool-payload.json',
    'gui-present.json',
    'vision-trace.json',
    'virtual-pointer-events.json',
    'fine-grounding-diagnostic.json',
    'executor-lease.json',
    'verifier-verdict.json',
    'gui-present-payload.json',
    'isolated-desktop-l3-workflow-evidence.json',
  ].map((name) => writeFile(join(bundleDir, name), JSON.stringify({ runId, name }, null, 2))));
  await Promise.all([
    'coarse-fine-rejected-targets.json',
    'rejected-save-target.json',
    'rejected-share-target.json',
  ].map((name) => writeFile(join(bundleDir, name), JSON.stringify(denseGroundingRejectedTargetFixture(`${runDirRef}/${name}`), null, 2))));
  await writeFile(
    join(bundleDir, 'isolated-desktop-l3-workflow-evidence.json'),
    JSON.stringify(acceptance.completionEvidence ?? {}, null, 2),
  );
  await materializeCuNextAcceptanceRefs(bundleDir, acceptance);
  await writeFile(join(bundleDir, 'coarse-window.png'), fixturePng);
  await writeFile(join(bundleDir, 'dense-grounding-export.csv'), 'label,x,y\nexport,100,80\n');
  const manifestPath = join(bundleDir, 'cu-user-acceptance-manifest.json');
  await writeFile(manifestPath, JSON.stringify(acceptance, null, 2));
  const acceptanceManifestRef = `${runDirRef}/cu-user-acceptance-manifest.json`;
  const completionEvidenceRef = `${runDirRef}/isolated-desktop-l3-workflow-evidence.json`;
  const directoryListingRef = `${runDirRef}/directory-listing.json`;
  const runTaskChainRef = `${runDirRef}/tui-host-run-task-chain.json`;
  await writeFile(join(bundleDir, 'tui-host-run-task-chain.json'), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
    runId,
    refs: [
      `${runDirRef}/tool-payload.json`,
      `${runDirRef}/gui-present.json`,
      `${runDirRef}/vision-trace.json`,
      acceptanceManifestRef,
      completionEvidenceRef,
    ],
    links: [
      { kind: 'directory-listing', status: 'present', recordRef: directoryListingRef },
      { kind: 'user-acceptance-manifest', status: 'present', recordRef: acceptanceManifestRef },
      { kind: 'completion-grade-evidence', status: 'attached', recordRef: completionEvidenceRef },
    ],
    completionGrade: {
      status: 'attached',
      acceptanceManifestRef,
      completionEvidenceRef,
    },
  }, null, 2)}\n`);
  await writeFile(join(bundleDir, 'directory-listing.json'), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
    runId,
    fileRefs: [
      runTaskChainRef,
      directoryListingRef,
      `${runDirRef}/computer-use-request.json`,
      `${runDirRef}/tool-payload.json`,
      `${runDirRef}/gui-present.json`,
      `${runDirRef}/vision-trace.json`,
      `${runDirRef}/dense-grounding-export.csv`,
      acceptanceManifestRef,
      completionEvidenceRef,
    ],
  }, null, 2)}\n`);
  return manifestPath;
}

export function passedBundleLocalCuNext07AcceptanceManifest(): Record<string, unknown> {
  const runId = 'cu-next-07-wrapper';
  const ref = (name: string) => name;
  const sessionRef = `computer-use-session:${runId}`;
  const finalArtifactRef = ref('dense-grounding-export.csv');
  const replayFrameRef = ref('before.png');
  return {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId,
    taskId: 'CU-NEXT-07',
    scenarioId: 'CU-LONG-004',
    createdAt: '2026-05-25T00:00:00.000Z',
    status: 'multi-app-workflow-passed',
    taskText: 'CU-NEXT-07 visual-grounding-pressure-test coarse fine focus crop rejected excluded targets',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'Dense Toolbar App', 'Finder'],
      windowSwitchTraceRefs: [ref('window-switch-trace.json')],
    },
    antiShortcutGuard: { status: 'passed', rejectedClaims: [] },
    tuiHostChain: [
      {
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: 'present',
        requestRef: ref('computer-use-request.json'),
        origin: sciForgeChatOrigin(runId),
      },
      { id: 'tui-host-runTask', kind: 'tui-host-runTask', status: 'present', requestRef: ref('computer-use-request.json'), hostPortsRef: ref('host-ports.json') },
      { id: 'computer-use-action-provider', kind: 'computer-use-action-provider', status: 'present', toolPayloadRef: ref('tool-payload.json') },
      { id: 'gui-present', kind: 'gui.present', status: 'present', recordRef: ref('gui-present.json') },
    ],
    evidenceClaims: [
      {
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: 'present',
        ref: ref('computer-use-request.json'),
        refs: [ref('computer-use-request.json')],
        origin: sciForgeChatOrigin(runId),
        sessionRefs: [sessionRef],
      },
      { id: 'real-computer-use-trace', kind: 'real-computer-use', ref: ref('vision-trace.json') },
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter',
        refs: [ref('virtual-pointer-events.json')],
        sessionRefs: [sessionRef],
      },
      {
        id: 'gui-present-record',
        kind: 'gui-present-record',
        ref: ref('gui-present.json'),
        refs: [ref('gui-present.json')],
        artifactRefs: [finalArtifactRef],
      },
    ],
    screenshotRefs: {
      before: [replayFrameRef],
      after: [ref('after.png')],
    },
    focusCropRefs: [ref('focus-crop.png')],
    groundingDiagnosticsRefs: [ref('coarse-fine-rejected-targets.json')],
    executorLease: { status: 'present', ref: ref('executor-lease.json') },
    finalArtifactRef,
    finalVisibleScreenshotRef: ref('final-visible.png'),
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: ref('verifier-verdict.json'),
    },
    guiPresent: {
      status: 'present',
      recordRef: ref('gui-present.json'),
      payloadRef: ref('gui-present-payload.json'),
      displayedRefs: [finalArtifactRef, replayFrameRef],
      artifactRefs: [finalArtifactRef],
      sessionRefs: [sessionRef],
    },
    ...cuNext07AcceptanceProductRefs(runId, ''),
    evidenceMarkers: [cuNext07DenseGroundingMarker()],
    completionEvidence: isolatedL3CompletionEvidence(finalArtifactRef),
    completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
  };
}

export async function writeProjectedCuNext07Acceptance(workspace: string, runId: string): Promise<string> {
  const runDir = join(workspace, 'CU-LONG-004', runId);
  const evidenceDir = join(runDir, 'evidence', 'round-03');
  await mkdir(evidenceDir, { recursive: true });
  const manifestPath = join(runDir, 'manifest.json');
  const summaryPath = join(runDir, 'scenario-summary.json');
  await writeCuNextProjectionEvidenceFiles(evidenceDir);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: '1.0',
    taskId: 'T084',
    cuNextTaskId: 'CU-NEXT-07',
    scenarioId: 'CU-LONG-004',
    title: 'Dense visual grounding',
    status: 'passed',
    run: {
      id: runId,
      workspacePath: workspace,
    },
    rounds: [
      { round: 1, status: 'passed', visionTraceRef: 'evidence/round-01/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      { round: 2, status: 'passed', visionTraceRef: 'evidence/round-02/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
      { round: 3, status: 'passed', visionTraceRef: 'evidence/round-03/vision-trace.json', screenshotRefs: [], actionLedgerRefs: [], failureDiagnosticsRefs: [] },
    ],
  }, null, 2));
  await writeFile(summaryPath, JSON.stringify({ schemaVersion: 'sciforge.computer-use-long.scenario-summary.v1', scenarioId: 'CU-LONG-004', status: 'passed' }));
  await writeFile(join(evidenceDir, 'computer-use-request.json'), JSON.stringify({ task: 'CU-NEXT-07 dense grounding acceptance from visible toolbar state.' }));
  await writeFile(join(evidenceDir, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
  await writeFile(join(evidenceDir, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
  await writeFile(join(evidenceDir, 'gui-present.json'), JSON.stringify({ port: 'gui.present', artifactRef: join(evidenceDir, 'dense-grounding-export.csv') }));
  await writeFile(join(evidenceDir, 'vision-trace.json'), JSON.stringify(cuNextProjectionTrace(runId, evidenceDir), null, 2));
  await writeFile(join(evidenceDir, 'independent-input-adapter.json'), JSON.stringify(cuNextProjectionAdapter(runId), null, 2));
  await writeFile(join(evidenceDir, 'virtual-remote-session.json'), JSON.stringify({ runId, mode: 'window' }));

  const projection = await projectCuNextAcceptanceForScenarioRun({
    taskId: 'CU-NEXT-07',
    dryRun: false,
    result: {
      manifestPath,
      scenarioId: 'CU-LONG-004',
      status: 'passed',
      attemptedRounds: [1, 2, 3],
      passedRounds: [1, 2, 3],
      summaryPath,
      roundResults: [],
    },
  });
  assert.equal(projection.status, 'projected');
  assert.ok(projection.paths?.manifest);
  return String(projection.paths.manifest);
}

export function projectFixtureWithOnlyCuNext07Checked(): string {
  const sections = CU_NEXT_TASK_MAPPINGS.map((mapping) => [
    `### ${mapping.taskId} ${mapping.title}`,
    '',
    `- [${mapping.taskId === 'CU-NEXT-07' ? 'x' : ' '}] Run ${mapping.slug}${mapping.taskId === 'CU-NEXT-07' ? ' - 2026-05-25 evidence: passed with cu-user-acceptance-manifest and verifier status.' : ''}`,
    `- [${mapping.taskId === 'CU-NEXT-07' ? 'x' : ' '}] Present trace refs${mapping.taskId === 'CU-NEXT-07' ? ' - 2026-05-25 evidence: passed with cu-user-acceptance-manifest and verifier status.' : ''}`,
    '',
  ].join('\n')).join('\n');
  return `# SciForge 项目协议\n\n## 当前任务板：下一轮 Computer Use 真实复杂任务\n\n${sections}\n## 验证规则\n`;
}

export function passedBrowserManifest(options: { observedAt?: string } = {}): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
    status: 'passed',
    source: 'codex-in-app-browser',
    observedAt: options.observedAt ?? '2026-05-25T00:00:00.000Z',
    releaseEligible: true,
    acceptanceConclusionFromRealBrowser: true,
    automationSubstituteUsed: false,
    seedDemoFixtureEvidenceUsed: false,
    startedFromDefaultChatEntry: true,
    submittedThroughRuntimeCodex: true,
    providerModelProfileVisible: true,
    workspaceVisible: true,
    commandIdVisible: true,
    singleTurn: browserStep(),
    artifactFollowUp: browserStep(),
    multiTurn: {
      ...browserStep(),
      secondTurnVisibleAnswerConfirmed: true,
    },
  };
}

export function browserStep(): Record<string, unknown> {
  return {
    status: 'passed',
    visibleAnswerConfirmed: true,
    providerModelProfileVisible: true,
    workspaceCommandIdVisible: true,
  };
}

export function passedKvGroundManifest(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.kv-ground-smoke.v1',
    runId: 'kv-ground-smoke-20260525T000000Z',
    createdAt: '2026-05-25T00:00:00.000Z',
    endpoint: 'http://127.0.0.1:18081',
    checks: {
      health: { ok: true },
      predict: { coordinates: [480, 1062] },
    },
    predictRequest: { textPrompt: 'Click the Ask SciForge input box' },
  };
}

export function passedCuNext07AcceptanceManifest(): Record<string, unknown> {
  const runId = 'cu-next-07-wrapper';
  const ref = (name: string) => name;
  const sessionRef = `computer-use-session:${runId}`;
  const finalArtifactRef = ref('dense-grounding-export.csv');
  const replayFrameRef = ref('before.png');
  return {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId,
    taskId: 'CU-NEXT-07',
    scenarioId: 'CU-LONG-004',
    createdAt: '2026-05-25T00:00:00.000Z',
    status: 'multi-app-workflow-passed',
    taskText: 'CU-NEXT-07 visual-grounding-pressure-test coarse fine focus crop rejected excluded targets',
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'Dense Toolbar App', 'Finder'],
      windowSwitchTraceRefs: [ref('window-switch-trace.json')],
    },
    antiShortcutGuard: { status: 'passed', rejectedClaims: [] },
    tuiHostChain: [
      {
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: 'present',
        requestRef: ref('computer-use-request.json'),
        origin: sciForgeChatOrigin(runId),
      },
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: ref('computer-use-request.json'),
        hostPortsRef: ref('host-ports.json'),
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef: ref('tool-payload.json'),
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: 'present',
        recordRef: ref('gui-present.json'),
      },
    ],
    evidenceClaims: [
      {
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: 'present',
        ref: ref('computer-use-request.json'),
        refs: [ref('computer-use-request.json')],
        origin: sciForgeChatOrigin(runId),
        sessionRefs: [sessionRef],
      },
      { id: 'real-computer-use-trace', kind: 'real-computer-use', ref: ref('vision-trace.json') },
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter',
        refs: [ref('virtual-pointer-events.json')],
        sessionRefs: [sessionRef],
      },
      {
        id: 'gui-present-record',
        kind: 'gui-present-record',
        ref: ref('gui-present.json'),
        refs: [ref('gui-present.json')],
        artifactRefs: [finalArtifactRef],
      },
    ],
    screenshotRefs: {
      before: [replayFrameRef],
      after: [ref('after.png')],
    },
    focusCropRefs: [ref('focus-crop.png')],
    groundingDiagnosticsRefs: [ref('coarse-fine-rejected-targets.json')],
    executorLease: { status: 'present', ref: ref('executor-lease.json') },
    finalArtifactRef,
    finalVisibleScreenshotRef: ref('final-visible.png'),
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: ref('verifier-verdict.json'),
    },
    guiPresent: {
      status: 'present',
      recordRef: ref('gui-present.json'),
      payloadRef: ref('gui-present-payload.json'),
      displayedRefs: [finalArtifactRef, replayFrameRef],
      artifactRefs: [finalArtifactRef],
      sessionRefs: [sessionRef],
    },
    ...cuNext07AcceptanceProductRefs(runId, ''),
    evidenceMarkers: [cuNext07DenseGroundingMarker()],
    completionEvidence: isolatedL3CompletionEvidence(finalArtifactRef),
    completionEvidenceRef: ref('isolated-desktop-l3-workflow-evidence.json'),
  };
}

function cuNext07AcceptanceProductRefs(runId: string, prefix: string): Record<string, unknown> {
  const ref = (name: string) => prefix ? prefixedRef(prefix, name) : name;
  const bundleRef = prefix ? prefix.replace(/\/+$/, '') : '.';
  const screenId = `${runId}-screen-main`;
  const previewScreenId = `${runId}-screen-preview`;
  const windowId = `${runId}-window-main`;
  const writerWindowId = `${runId}-window-writer`;
  const actorId = `${runId}-actor-agent`;
  const cursorId = `${runId}-cursor-agent`;
  const writerActorId = `${runId}-actor-writer`;
  const writerCursorId = `${runId}-cursor-writer`;
  const previewActorId = `${runId}-actor-preview`;
  const previewCursorId = `${runId}-cursor-preview`;
  return {
    productPathClassification: {
      schemaVersion: 'sciforge.computer-use.product-path-classification.v1',
      tier: 'product-smoke',
      entrypoint: 'codex-app-server/native-plugin',
      hops: ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use', 'native-multi-screen-sidecar'],
      appServerRunRef: ref('codex-app-server-run.json'),
      nativePluginInvocationRef: ref('native-plugin-invocation.json'),
      sciforgeComputerUseRunTaskRef: ref('tui-host-run-task-chain.json'),
      platformSidecarIsolationReportRef: ref('platform-sidecar-isolation-report.json'),
      currentBundleRef: bundleRef,
      currentBundleOnly: true,
      diagnosticOnly: false,
      packageDiagnosticOnly: false,
    },
    userControlPlane: {
      schemaVersion: 'sciforge.computer-use.user-control-plane.v1',
      status: 'present',
      sessionPermissionRef: ref('session-permission.json'),
      allowedAppRefs: [ref('allowed-apps.json')],
      allowedWindowRefs: [ref('allowed-windows.json')],
      forbiddenAppRefs: [ref('forbidden-apps.json')],
      inputModalityPolicyRef: ref('input-modality-policy.json'),
      riskPreviewRef: ref('risk-preview.json'),
      dataVisibilityRef: ref('data-visibility.json'),
      stopRef: ref('stop-cancel-lease.json'),
      cancelLeaseRef: ref('stop-cancel-lease.json'),
      approvalMode: 'bounded-low-risk',
    },
    platformSidecarIsolationReport: {
      schemaVersion: 'sciforge.computer-use.platform-sidecar-isolation-report.v1',
      status: 'passed',
      backendKind: 'native-multi-screen-sidecar',
      sidecarKind: 'native-multi-screen-sidecar',
      reportRef: ref('platform-sidecar-isolation-report.json'),
      captureRef: ref('sidecar-capture.json'),
      stateRef: ref('sidecar-state.json'),
      preflightRef: ref('sidecar-preflight.json'),
      executorAdapterRef: ref('sidecar-executor-adapter.json'),
      isolationFlags: {
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        sidecarDoesPlanning: false,
        sidecarDoesCompletion: false,
      },
    },
    virtualDisplayGroup: {
      displayGroupId: `${runId}-display-group`,
      ref: ref('virtual-display-group.json'),
      screens: [
        {
          screenId,
          ref: ref('virtual-screen-main.json'),
          geometry: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
        },
        {
          screenId: previewScreenId,
          ref: ref('virtual-screen-preview.json'),
          geometry: { x: 1280, y: 0, width: 1024, height: 720, scale: 1 },
        },
      ],
    },
    actorCursorProvenance: [
      {
        actorId,
        cursorId,
        screenId,
        actorCursorLogRef: ref('actor-cursors.jsonl'),
      },
      {
        actorId: writerActorId,
        cursorId: writerCursorId,
        screenId,
        actorCursorLogRef: ref('actor-cursors.jsonl'),
      },
      {
        actorId: previewActorId,
        cursorId: previewCursorId,
        screenId: previewScreenId,
        actorCursorLogRef: ref('actor-cursors.jsonl'),
      },
    ],
    cursorEvents: [
      {
        kind: 'move',
        actorId,
        cursorId,
        screenId,
        cursorEventLogRef: ref('actor-cursors.jsonl'),
        readOnlyCursorEvent: true,
        mutatingGuiAction: false,
      },
      {
        kind: 'point',
        actorId: writerActorId,
        cursorId: writerCursorId,
        screenId,
        cursorEventLogRef: ref('actor-cursors.jsonl'),
        readOnlyCursorEvent: true,
        mutatingGuiAction: false,
      },
      {
        kind: 'annotate',
        actorId: previewActorId,
        cursorId: previewCursorId,
        screenId: previewScreenId,
        cursorEventLogRef: ref('actor-cursors.jsonl'),
        readOnlyCursorEvent: true,
        mutatingGuiAction: false,
      },
    ],
    executorLease: {
      status: 'present',
      ref: ref('executor-lease.json'),
      owner: 'sciforge-independent-input-adapter',
      screenId,
      windowId,
      actorId,
      cursorId,
      leaseScope: {
        kind: 'window-local',
        screenId,
        windowId,
      },
    },
    observeBeforeMutate: {
      schemaVersion: 'sciforge.computer-use.observe-before-mutate.v1',
      status: 'passed',
      currentAppStateRef: ref('current-app-state.json'),
      currentScreenshotRef: ref('before.png'),
      stateSnapshotRef: ref('state-snapshot.json'),
      freshnessCheckRef: ref('freshness-check.json'),
      browserRuntimeObservationRef: ref('browser-dom-ax-observation.json'),
      browserRuntimeObservationUse: 'observe-before-mutate-hint',
    },
    browserRuntimeDomAxObservation: {
      schemaVersion: 'sciforge.computer-use.browser-runtime-dom-ax-observation.v1',
      trust: 'untrusted-page-observation',
      refsFirst: true,
      currentBundleOnly: true,
      screenId,
      windowId,
      observationRef: ref('browser-dom-ax-observation.json'),
      visibleDomRef: ref('browser-visible-dom.json'),
      accessibilitySnapshotRef: ref('browser-accessibility.json'),
      playwrightEvaluateRef: ref('browser-playwright-evaluate.json'),
      pageQueryRef: ref('browser-page-query.json'),
      stableRefs: [ref('browser-stable-refs.json')],
      groundingHintRefs: [ref('browser-grounding-hints.json')],
      observationUse: 'observe-before-mutate-hint',
      executorLeaseSubstitute: false,
      guiActionSubstitute: false,
      artifactCausalitySubstitute: false,
      completionEvidenceEligible: false,
      userLevelCompletionSubstitute: false,
    },
    actionProposals: [
      {
        proposalId: `${runId}-proposal-main-agent`,
        proposalRef: ref('proposal-main-agent.json'),
        actorId,
        cursorId,
        leaseScope: { kind: 'window-local', screenId, windowId },
      },
      {
        proposalId: `${runId}-proposal-main-writer`,
        proposalRef: ref('proposal-main-writer.json'),
        actorId: writerActorId,
        cursorId: writerCursorId,
        leaseScope: { kind: 'window-local', screenId, windowId: writerWindowId },
        decisionStatus: 'queued',
      },
      {
        proposalId: `${runId}-proposal-preview-refresh`,
        proposalRef: ref('proposal-preview-refresh.json'),
        actorId: previewActorId,
        cursorId: previewCursorId,
        leaseScope: { kind: 'screen-global', screenId: previewScreenId },
      },
    ],
    executorQueue: [
      {
        queueId: `${runId}-window-local-queue`,
        screenId,
        queueKind: 'window-local',
        schedulerPolicy: 'native-screen-serial',
        leaseOwnerRefs: [ref('executor-lease.json')],
      },
      {
        queueId: `${runId}-screen-global-queue`,
        screenId: previewScreenId,
        queueKind: 'screen-global',
        schedulerPolicy: 'native-screen-serial',
        leaseOwnerRefs: [ref('screen-global-lease.json')],
      },
    ],
    mutatingActions: [
      {
        actionKind: 'click',
        screenId,
        windowId,
        actorId,
        cursorId,
        leaseId: `${runId}-lease-window-main`,
        leaseScope: {
          kind: 'window-local',
          screenId,
          windowId,
        },
        target: {
          scope: 'window',
          screenId,
          windowId,
          bounds: { x: 64, y: 72, width: 160, height: 36 },
        },
        beforeEvidenceRefs: [ref('before.png')],
        afterEvidenceRefs: [ref('after.png')],
        beforeFrameRefs: [ref('before.png')],
        afterFrameRefs: [ref('after.png')],
        inputIntentRef: ref('input-intents/click-export.json'),
        providerAdapterRef: ref('sidecar-executor-adapter.json'),
        currentAppStateRef: ref('current-app-state.json'),
        currentScreenshotRef: ref('before.png'),
        stateSnapshotRef: ref('state-snapshot.json'),
        freshnessCheckRef: ref('freshness-check.json'),
        groundingRefs: [ref('coarse-fine-rejected-targets.json'), ref('browser-grounding-hints.json')],
        executorEventRef: ref('executor-event.json'),
        verificationRefs: [ref('verifier-verdict.json')],
        artifactRefs: [ref('dense-grounding-export.csv')],
      },
    ],
    replayBundle: {
      ref: ref('replay-bundle.json'),
      frames: [
        {
          screenId,
          screenshotRef: ref('before.png'),
          cursorOverlayRefs: [ref('cursor-overlay-before.json')],
          sourceEvidenceRefs: [ref('before.png')],
        },
        {
          screenId: previewScreenId,
          screenshotRef: ref('preview-before.png'),
          cursorOverlayRefs: [ref('cursor-overlay-preview-before.json')],
          sourceEvidenceRefs: [ref('preview-before.png')],
        },
        {
          screenId,
          screenshotRef: ref('after.png'),
          cursorOverlayRefs: [ref('cursor-overlay-after.json')],
          sourceEvidenceRefs: [ref('after.png')],
        },
        {
          screenId: previewScreenId,
          screenshotRef: ref('preview-after.png'),
          cursorOverlayRefs: [ref('cursor-overlay-preview-after.json')],
          sourceEvidenceRefs: [ref('preview-after.png')],
        },
      ],
      cursorOverlayRefs: [
        ref('cursor-overlay-before.json'),
        ref('cursor-overlay-preview-before.json'),
        ref('cursor-overlay-after.json'),
        ref('cursor-overlay-preview-after.json'),
      ],
      leaseOwnerRefs: [ref('executor-lease.json'), ref('screen-global-lease.json')],
      beforeEvidenceRefs: [ref('before.png'), ref('preview-before.png')],
      afterEvidenceRefs: [ref('after.png'), ref('preview-after.png')],
    },
  };
}

export function cuNext07DenseGroundingMarker(runId?: string): Record<string, unknown> {
  const prefix = runId ? `.sciforge/vision-runs/${runId}/` : '';
  return {
    kind: 'dense-grounding',
    targetDescription: 'Export button in the toolbar, excluding Save, AutoSave, and Share.',
    coarseWindowScreenshotRef: `${prefix}coarse-window.png`,
    focusCropRef: `${prefix}focus-crop.png`,
    fineGroundingDiagnosticRef: `${prefix}fine-grounding-diagnostic.json`,
    rejectedTargetRefs: [
      `${prefix}rejected-save-target.json`,
      `${prefix}rejected-share-target.json`,
    ],
  };
}

export function isolatedL3CompletionEvidence(
  taskFinalArtifactRefs: string | string[] = [],
  options: { refPrefix?: string; additionalTaskFinalArtifactRefs?: string[] } = {},
): Record<string, unknown> {
  const ref = (name: string) => options.refPrefix ? prefixedRef(options.refPrefix, name) : name;
  const passedTaskFinalArtifactRefs = Array.isArray(taskFinalArtifactRefs) ? taskFinalArtifactRefs : [taskFinalArtifactRefs];
  const l3FinalArtifactRef = ref('evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx');
  const boundTaskFinalArtifactRefs = uniqueStringList([
    ...passedTaskFinalArtifactRefs,
    ...(options.additionalTaskFinalArtifactRefs ?? []),
  ]);
  const currentTaskFinalArtifactRef = boundTaskFinalArtifactRefs[0];
  const sessionManifestRef = ref('evidence/l3/isolated-l3-session/session-manifest.json');
  const sourceFirstScreenshotRef = ref('evidence/l3/isolated-l3-session/screenshots/source-editor.png');
  const sourceLastScreenshotRef = ref('evidence/l3/isolated-l3-session/screenshots/source-editor-final.png');
  const writerFirstScreenshotRef = ref('evidence/l3/isolated-l3-session/screenshots/writer-editor.png');
  const writerLastScreenshotRef = ref('evidence/l3/isolated-l3-session/screenshots/writer-saved.png');
  const previewFirstScreenshotRef = ref('evidence/l3/isolated-l3-session/screenshots/file-preview-open.png');
  const previewLastScreenshotRef = ref('evidence/l3/isolated-l3-session/screenshots/file-preview.png');
  const sourceFactRefs = [
    ref('evidence/l3/source-facts/recovery.json'),
    ref('evidence/l3/source-facts/cohorts.json'),
  ];
  return {
    schemaVersion: 'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1',
    evidenceKind: 'isolated-L3',
    status: 'completed',
    acceptanceTier: 'l3-multi-app-workflow',
    targetEnvironmentKind: 'linux-isolated-desktop-session',
    realWindowEvidence: true,
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    errors: [],
    resultRef: ref('evidence/l3/computer-use-result.json'),
    inputEventLogRef: ref('evidence/l3/isolated-l3-session/l3-input-events.json'),
    pointerEventLogRef: ref('evidence/l3/isolated-l3-session/l3-pointer-events.json'),
    keyboardEventLogRef: ref('evidence/l3/isolated-l3-session/l3-keyboard-events.json'),
    executorCommandEventLogRef: ref('evidence/l3/isolated-l3-session/l3-executor-command-events.json'),
    backendReadinessProofRef: ref('evidence/l3/isolated-l3-session/backend-readiness-proof.json'),
    processRef: ref('evidence/l3/isolated-l3-session/backend-processes.json'),
    resourceAllocationRef: ref('evidence/l3/isolated-runtime-resource-allocation.json'),
    targetWindowRef: ref('evidence/l3/isolated-l3-session/l3-target-window.json'),
    windowBoundPointerProofRef: ref('evidence/l3/isolated-l3-session/l3-window-bound-pointer-proof.json'),
    sessionManifestRef,
    taskFinalArtifactRefs: boundTaskFinalArtifactRefs,
    taskArtifactBinding: {
      finalArtifactRef: currentTaskFinalArtifactRef,
      finalArtifactRefs: boundTaskFinalArtifactRefs,
      supportingL3FinalArtifactRef: l3FinalArtifactRef,
      source: 'task-final-artifact-binding',
    },
    finalArtifactRef: l3FinalArtifactRef,
    artifactValidationRef: ref('evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx.validation.json'),
    fileListArtifactRef: ref('evidence/l3/isolated-l3-session/filesystem-root/out/file-list.json'),
    fileListDataRef: ref('evidence/l3/isolated-l3-session/filesystem-root/out/file-list-data.json'),
    guiPresentRef: ref('evidence/l3/gui-present.json'),
    viewerManifestRef: ref('evidence/l3/visible-run-viewer-manifest.json'),
    evidenceLogRef: ref('evidence/l3/evidence/evidence-log.jsonl'),
    evidenceSnapshotRef: ref('evidence/l3/evidence/evidence-snapshot.json'),
    evidenceIndexRef: ref('evidence/l3/evidence/evidence-index.json'),
    screenshotRefs: [
      sourceFirstScreenshotRef,
      writerLastScreenshotRef,
      previewLastScreenshotRef,
    ],
    traceRefs: [ref('evidence/l3/vision-trace.json')],
    l3Workflow: {
      status: 'completed',
      completed: true,
      sameSession: true,
      sameVirtualSession: true,
      sourceToWriterToPreviewCausality: true,
    },
    workflowRequirements: {
      minimumAppCount: 3,
      minimumActionCount: 6,
      requiredInputModalities: ['pointer', 'keyboard'],
      requiresCurrentStepScreenshots: true,
      forbidPriorRoundCompletionEvidence: true,
      requiresDirectoryEvidence: true,
      requiresArtifactPreview: true,
      requiresWindowBoundPointerProof: true,
    },
    applicationEvidence: [
      {
        appKind: 'source-reader',
        sessionManifestRef,
        firstScreenshotRef: sourceFirstScreenshotRef,
        lastScreenshotRef: sourceLastScreenshotRef,
        windowEvidenceRefs: [sourceFirstScreenshotRef, sourceLastScreenshotRef],
      },
      {
        appKind: 'word-document-writer',
        sessionManifestRef,
        firstScreenshotRef: writerFirstScreenshotRef,
        lastScreenshotRef: writerLastScreenshotRef,
        windowEvidenceRefs: [writerFirstScreenshotRef, writerLastScreenshotRef],
      },
      {
        appKind: 'file-manager-preview',
        sessionManifestRef,
        firstScreenshotRef: previewFirstScreenshotRef,
        lastScreenshotRef: previewLastScreenshotRef,
        windowEvidenceRefs: [previewFirstScreenshotRef, previewLastScreenshotRef],
      },
    ],
    crossAppTransitions: [
      {
        fromAppKind: 'source-reader',
        toAppKind: 'word-document-writer',
        sessionManifestRef,
        screenshotRef: writerFirstScreenshotRef,
      },
      {
        fromAppKind: 'word-document-writer',
        toAppKind: 'file-manager-preview',
        sessionManifestRef,
        screenshotRef: previewFirstScreenshotRef,
      },
    ],
    sourceEvidence: {
      sourceObservationRefs: [sourceLastScreenshotRef],
      sourceFactRefs,
    },
    derivedContentEvidence: {
      supportedFactRefs: sourceFactRefs,
    },
    artifactCausality: {
      savedByActionIndex: 3,
      savedByInputModality: 'keyboard',
      savedByCommandEventRef: `${ref('evidence/l3/isolated-l3-session/l3-executor-command-events.json')}#events/l3-command-003`,
      finalArtifactRef: l3FinalArtifactRef,
      artifactValidationRef: ref('evidence/l3/isolated-l3-session/filesystem-root/out/source-summary.docx.validation.json'),
      savedThroughGui: true,
      shellDirectArtifactWrite: false,
    },
    directoryEvidence: {
      fileListArtifactRef: ref('evidence/l3/isolated-l3-session/filesystem-root/out/file-list.json'),
      fileListDataRef: ref('evidence/l3/isolated-l3-session/filesystem-root/out/file-list-data.json'),
      previewObservationRef: previewLastScreenshotRef,
      directoryObservationAfterSaveRef: previewFirstScreenshotRef,
      previewedByActionIndex: 5,
      previewedByInputModality: 'pointer',
      previewedThroughGui: true,
      shellDirectoryListingOnly: false,
    },
    presentationEvidence: {
      guiPresentRef: ref('evidence/l3/gui-present.json'),
      artifactRefs: boundTaskFinalArtifactRefs,
    },
  };
}

export function cuNextProjectionTrace(runId: string, runRef: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.vision-trace.v1',
    runId,
    tool: 'action.sciforge.computer-use',
    runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
    actionProvider: 'action.sciforge.computer-use',
    createdAt: '2026-05-25T00:00:00.000Z',
    completedAt: '2026-05-25T00:01:00.000Z',
    request: {
      taskId: 'CU-NEXT-07',
      cuNextTaskId: 'CU-NEXT-07',
      task: 'CU-NEXT-07 dense grounding acceptance from visible toolbar state.',
    },
    config: {
      dryRun: false,
      inputAdapter: 'remote-desktop',
      independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
    },
    hostPorts: {
      ports: {
        execute: {
          provider: 'sciforge-simulated-remote-desktop-input-adapter',
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        },
      },
    },
    genericComputerUse: {
      inputChannelContract: {
        currentIndependentAdapter: 'remote-desktop',
        pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
        pointerMode: 'adapter-window-bound-pointer',
        keyboardMode: 'adapter-window-bound-keyboard',
        userDeviceImpact: 'none',
      },
    },
    finalArtifactRef: `${runRef}/dense-grounding-export.csv`,
    finalVisibleScreenshotRef: `${runRef}/step-003-after.png`,
    completionEvidence: isolatedL3CompletionEvidence([`${runRef}/dense-grounding-export.csv`]),
    steps: [
      {
        id: 'step-001-browser',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-001-before.png`,
            windowTarget: { appName: 'Browser' },
          },
          {
            type: 'screenshot',
            captureScope: 'focus-region',
            path: `${runRef}/step-001-before-focus.png`,
            windowTarget: { appName: 'Browser' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-001-after.png`,
            windowTarget: { appName: 'Browser' },
          },
        ],
        plannedAction: { type: 'click', appName: 'Browser', targetDescription: 'visible source summary' },
        grounding: { provider: 'kv-ground', localX: 100, localY: 80 },
      },
      {
        id: 'step-002-dense-app',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-002-before.png`,
            windowTarget: { appName: 'Dense Toolbar App' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-002-after.png`,
            windowTarget: { appName: 'Dense Toolbar App' },
          },
        ],
        plannedAction: { type: 'click', appName: 'Dense Toolbar App', targetDescription: 'export button' },
        fineGrounding: { provider: 'kv-ground', status: 'accepted', targetDescription: 'Export button', rejectedTargets: ['Save', 'Share'] },
        denseGroundingRejectedTargets: [
          {
            fineGroundingRejected: true,
            targetDescription: 'Export button',
            fineGrounding: {
              provider: 'kv-ground',
              status: 'rejected',
              targetDescription: 'Save button',
              rejectionReason: 'neighboring decoy target',
              screenshotRef: `${runRef}/step-002-before.png`,
              focusScreenshotRef: `${runRef}/step-001-before-focus.png`,
              coordinateSpace: 'window-local',
              x: 72,
              y: 40,
            },
          },
          {
            fineGroundingRejected: true,
            targetDescription: 'Export button',
            fineGrounding: {
              provider: 'kv-ground',
              status: 'rejected',
              targetDescription: 'Share button',
              rejectionReason: 'neighboring decoy target',
              screenshotRef: `${runRef}/step-002-before.png`,
              focusScreenshotRef: `${runRef}/step-001-before-focus.png`,
              coordinateSpace: 'window-local',
              x: 154,
              y: 40,
            },
          },
        ],
      },
      {
        id: 'step-003-file-manager',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-003-before.png`,
            windowTarget: { appName: 'File Manager' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${runRef}/step-003-after.png`,
            windowTarget: { appName: 'File Manager' },
          },
        ],
        plannedAction: { type: 'click', appName: 'File Manager', targetDescription: 'show exported artifact' },
      },
    ],
  };
}

export function cuNextProjectionAdapter(runId: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.independent-input-adapter.v1',
    adapter: 'remote-desktop',
    provider: 'sciforge-simulated-remote-desktop',
    runId,
    userDeviceImpact: 'none',
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
    targetSession: {
      mode: 'window',
      appName: 'Dense Toolbar App',
      coordinateSpace: 'window-local',
    },
    virtualPointer: {
      mode: 'virtual-pointer',
      coordinateSpace: 'window-local',
      x: 100,
      y: 80,
    },
    virtualKeyboard: {
      mode: 'virtual-keyboard',
      pressedKeys: [],
      keyEvents: [],
    },
    virtualRemoteSession: {
      stateRef: 'virtual-remote-session.json',
    },
    actions: [
      {
        id: 'step-001-click',
        type: 'click',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
      {
        id: 'step-002-click',
        type: 'click',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
    ],
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:01:00.000Z',
  };
}

export function cuNextVisibleMarkdownArtifact(artifactRef: string, sourceActionId: string): Record<string, unknown> {
  return {
    id: 'visible-markdown-index',
    title: 'Acceptance index',
    artifactRef,
    dataRef: artifactRef,
    path: artifactRef,
    mimeType: 'text/markdown',
    appId: 'Browser',
    delivery: 'virtual-remote-session-artifact',
    status: 'visible-and-saved',
    visibleTexts: ['Acceptance index', 'Visible final markdown artifact'],
    sourceActionIds: [sourceActionId],
  };
}

function denseGroundingRejectedTargetFixture(ref: string): Record<string, unknown> {
  const rejectedTargets = /dense-grounding-rejections\.json$|coarse-fine-rejected-targets\.json$/.test(ref)
    ? [
        { targetDescription: 'Save button', reason: 'neighboring decoy target' },
        { targetDescription: 'Share button', reason: 'neighboring decoy target' },
      ]
    : [
        { targetDescription: ref.includes('share') ? 'Share button' : 'Save button', reason: 'neighboring decoy target' },
      ];
  return {
    schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
    status: 'recorded',
    selectedTarget: {
      targetDescription: 'Export button in the toolbar.',
    },
    rejectedTargets,
    coarseWindowScreenshotRef: ref.replace(/dense-grounding-rejections\.json$|rejected-.+-target\.json$|coarse-fine-rejected-targets\.json$/, 'coarse-window.png'),
    focusCropRef: ref.replace(/dense-grounding-rejections\.json$|rejected-.+-target\.json$|coarse-fine-rejected-targets\.json$/, 'focus-crop.png'),
    fineGroundingDiagnosticRef: ref.replace(/dense-grounding-rejections\.json$|rejected-.+-target\.json$|coarse-fine-rejected-targets\.json$/, 'fine-grounding-diagnostic.json'),
  };
}
