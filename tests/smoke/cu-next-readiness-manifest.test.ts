import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildCuNextReadinessManifest,
  buildCuNextReadinessManifestFromData,
  CU_NEXT_TASK_MAPPINGS,
} from '../../tools/cu-next-readiness-manifest.js';
import { buildCuUserAcceptanceManifest } from '../../tools/cu-user-acceptance-manifest.js';

const execFileAsync = promisify(execFile);

test('current CU-NEXT readiness manifest stays blocked until real task evidence and PROJECT checkboxes exist', async () => {
  const manifest = await buildCuNextReadinessManifest({
    generatedAt: '2026-05-25T00:00:00.000Z',
  });

  assert.equal(manifest.schemaVersion, 'sciforge.computer-use.cu-next-readiness.v1');
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.completionEligible, false);
  assert.equal(manifest.tasks.length, CU_NEXT_TASK_MAPPINGS.length);
  assert.deepEqual(manifest.tasks.map((task) => task.id), CU_NEXT_TASK_MAPPINGS.map((mapping) => mapping.taskId));
  assert.equal(manifest.globalEvidence.kvGround.status, 'passed');
  assert.equal(manifest.globalEvidence.kvGround.endpoint, 'http://127.0.0.1:18081');
  assert.equal(manifest.globalEvidence.runtimeBrowser.status, 'blocked');

  for (const task of manifest.tasks) {
    assert.equal(task.status, 'blocked', `${task.id} must not pass from unchecked PROJECT.md items or synthetic evidence`);
    assert.equal(task.checkedChecklistItems, 0, `${task.id} current PROJECT.md checkboxes should remain unchecked`);
    assert.ok(task.blockedItems.some((item) => item.id === 'project-checklist-unchecked'), `${task.id} should report unchecked PROJECT.md work`);
  }
  assert.ok(
    manifest.blockedItems.some((item) => item.id === 'runtime-codex-browser-acceptance-not-passed'),
    'current browser manifest must stay a release blocker',
  );
});

test('readiness manifest rejects fixture, shared-input, and shortcut-substitute acceptance evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const projectText = cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' });
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07'));
    const base = {
      root: workspace,
      projectText,
      projectRef: 'PROJECT.md',
      generatedAt: '2026-05-25T00:00:00.000Z',
      runtimeBrowserManifest: {
        path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
        data: passedBrowserManifest(),
      },
      kvGroundSmokeManifests: [
        {
          path: '.sciforge/vision-runs/kv-ground-smoke/kv-ground-smoke.json',
          data: passedKvGroundManifest(),
        },
      ],
    };

    const shortcut = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', {
            antiShortcutRejectedClaims: [{ id: 'dom-export', kind: 'dom' }],
          }),
        },
      ],
    });
    assert.equal(shortcut.tasks.find((task) => task.id === 'CU-NEXT-07')?.status, 'blocked');

    const fixture = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', { fixture: true }),
        },
      ],
    });
    assert.equal(fixture.tasks.find((task) => task.id === 'CU-NEXT-07')?.status, 'blocked');

    const dryRun = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', { dryRun: true }),
        },
      ],
    });
    assert.equal(dryRun.tasks.find((task) => task.id === 'CU-NEXT-07')?.status, 'blocked');

    const sharedInput = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', { sharedSystemInput: true }),
        },
      ],
    });
    assert.equal(sharedInput.tasks.find((task) => task.id === 'CU-NEXT-07')?.status, 'blocked');

    const missingGuiPresentClaim = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', { omitGuiPresentClaim: true }),
        },
      ],
    });
    assert.equal(missingGuiPresentClaim.tasks.find((task) => task.id === 'CU-NEXT-07')?.status, 'blocked');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('readiness manifest requires exact taskId binding instead of text mentions', () => {
  const manifest = buildCuNextReadinessManifestFromData({
    projectText: cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }),
    projectRef: 'PROJECT.md',
    generatedAt: '2026-05-25T00:00:00.000Z',
    runtimeBrowserManifest: {
      path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
      data: passedBrowserManifest(),
    },
    kvGroundSmokeManifests: [
      {
        path: '.sciforge/vision-runs/kv-ground-smoke/kv-ground-smoke.json',
        data: passedKvGroundManifest(),
      },
    ],
    userAcceptanceManifests: [
      {
        path: '.sciforge/vision-runs/cu-next-mixed/cu-user-acceptance-manifest.json',
        data: {
          ...passedCuNextAcceptanceManifest('CU-NEXT-04'),
          taskText: 'This note mentions CU-NEXT-07 and visual-grounding-pressure-test but is bound to CU-NEXT-04.',
        },
      },
    ],
  });

  const task = manifest.tasks.find((candidate) => candidate.id === 'CU-NEXT-07');
  assert.equal(task?.status, 'blocked');
  assert.equal(task?.acceptedEvidenceRef, undefined);
  assert.ok(task?.blockedItems.some((item) => item.id === 'missing-live-l2-l3-user-acceptance-manifest'));
});

test('readiness manifest distinguishes evidence-ready from fully passed PROJECT task state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07'));
    const base = {
      root: workspace,
      projectRef: 'PROJECT.md',
      generatedAt: '2026-05-25T00:00:00.000Z',
      runtimeBrowserManifest: {
        path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
        data: passedBrowserManifest(),
      },
      kvGroundSmokeManifests: [
        {
          path: '.sciforge/vision-runs/kv-ground-smoke/kv-ground-smoke.json',
          data: passedKvGroundManifest(),
        },
      ],
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07'),
        },
      ],
    };

    const unchecked = buildCuNextReadinessManifestFromData({
      ...base,
      projectText: cuNextProjectFixture(),
    });
    const uncheckedTask = unchecked.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(uncheckedTask?.status, 'evidence-ready');
    assert.equal(uncheckedTask?.acceptedEvidenceStatus, 'multi-app-workflow-passed');
    assert.ok(uncheckedTask?.blockedItems.some((item) => item.id === 'project-checklist-unchecked'));
    assert.equal(unchecked.completionEligible, false);

    const checked = buildCuNextReadinessManifestFromData({
      ...base,
      projectText: cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }),
    });
    const checkedTask = checked.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(checkedTask?.status, 'passed');
    assert.deepEqual(checkedTask?.blockedItems, []);
    assert.equal(checked.completionEligible, false, 'one task passed is not enough to complete the full CU-NEXT board');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('readiness manifest rejects strong acceptance evidence with a missing required bundle ref', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const acceptance = passedCuNextAcceptanceManifest('CU-NEXT-07');
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    await writeEvidenceBundle(workspace, acceptanceRef, acceptance, {
      skipRefs: [String(acceptance.finalVisibleScreenshotRef)],
    });

    const manifest = buildCuNextReadinessManifestFromData({
      root: workspace,
      projectText: cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }),
      projectRef: 'PROJECT.md',
      generatedAt: '2026-05-25T00:00:00.000Z',
      runtimeBrowserManifest: {
        path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
        data: passedBrowserManifest(),
      },
      kvGroundSmokeManifests: [
        {
          path: '.sciforge/vision-runs/kv-ground-smoke/kv-ground-smoke.json',
          data: passedKvGroundManifest(),
        },
      ],
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: acceptance,
        },
      ],
    });

    const task = manifest.tasks.find((candidate) => candidate.id === 'CU-NEXT-07');
    assert.equal(task?.status, 'blocked');
    assert.equal(task?.acceptedEvidenceRef, undefined);
    assert.ok(task?.blockedItems.some((item) => item.id === 'missing-live-l2-l3-user-acceptance-manifest'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('readiness manifest blocks stale runtime browser observedAt from release eligibility', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const acceptance = passedCuNextAcceptanceManifest('CU-NEXT-07');
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    await writeEvidenceBundle(workspace, acceptanceRef, acceptance);

    const manifest = buildCuNextReadinessManifestFromData({
      root: workspace,
      projectText: cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }),
      projectRef: 'PROJECT.md',
      generatedAt: '2026-05-25T00:00:00.000Z',
      runtimeBrowserManifest: {
        path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
        data: passedBrowserManifest({ observedAt: '2026-05-23T23:59:00.000Z' }),
      },
      kvGroundSmokeManifests: [
        {
          path: '.sciforge/vision-runs/kv-ground-smoke/kv-ground-smoke.json',
          data: passedKvGroundManifest(),
        },
      ],
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: acceptance,
        },
      ],
    });

    const task = manifest.tasks.find((candidate) => candidate.id === 'CU-NEXT-07');
    assert.equal(manifest.globalEvidence.runtimeBrowser.status, 'blocked');
    assert.match(manifest.globalEvidence.runtimeBrowser.reason ?? '', /24h release window/);
    assert.equal(task?.acceptedEvidenceRef, acceptanceRef);
    assert.equal(task?.status, 'blocked');
    assert.ok(task?.blockedItems.some((item) => item.id === 'runtime-codex-browser-acceptance-blocked'));
    assert.equal(manifest.completionEligible, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT readiness CLI writes a JSON manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const projectPath = join(workspace, 'PROJECT.md');
    const browserPath = join(workspace, 'browser.json');
    const kvPath = join(workspace, 'kv-ground-smoke.json');
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    const acceptancePath = join(workspace, acceptanceRef);
    const outPath = join(workspace, 'readiness.json');
    await writeFile(projectPath, cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }));
    await writeFile(browserPath, JSON.stringify(passedBrowserManifest({ observedAt: new Date().toISOString() }), null, 2));
    await writeFile(kvPath, JSON.stringify(passedKvGroundManifest(), null, 2));
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07'));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-next-readiness-manifest.ts',
      '--root',
      workspace,
      '--project',
      projectPath,
      '--browser-manifest',
      browserPath,
      '--kv-ground-smoke',
      kvPath,
      '--acceptance-manifest',
      acceptancePath,
      '--out',
      outPath,
    ]);

    assert.match(stdout, new RegExp(`\\[blocked\\] CU-NEXT readiness 1\\/${CU_NEXT_TASK_MAPPINGS.length} passed; completionEligible=false`));
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(written.schemaVersion, 'sciforge.computer-use.cu-next-readiness.v1');
    assert.equal(written.tasks.find((task: { id: string }) => task.id === 'CU-NEXT-07')?.status, 'passed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU-NEXT readiness accepts real cu-user-acceptance builder output with exact taskId', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const acceptance = buildCuUserAcceptanceManifest(realCuNextAcceptanceInput('CU-NEXT-07'));
    const acceptanceRef = realBuilderAcceptanceRef('CU-NEXT-07');
    await writeEvidenceBundle(workspace, acceptanceRef, acceptance);
    const manifest = buildCuNextReadinessManifestFromData({
      root: workspace,
      projectText: cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }),
      projectRef: 'PROJECT.md',
      generatedAt: '2026-05-25T00:00:00.000Z',
      runtimeBrowserManifest: {
        path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
        data: passedBrowserManifest(),
      },
      kvGroundSmokeManifests: [
        {
          path: '.sciforge/vision-runs/kv-ground-smoke/kv-ground-smoke.json',
          data: passedKvGroundManifest(),
        },
      ],
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: acceptance,
        },
      ],
    });

    const task = manifest.tasks.find((candidate) => candidate.id === 'CU-NEXT-07');
    assert.equal(task?.status, 'passed');
    assert.equal(task?.acceptedEvidenceStatus, 'multi-app-workflow-passed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function cuNextProjectFixture(options: { checkedTask?: string } = {}): string {
  const sections = CU_NEXT_TASK_MAPPINGS.map((mapping) => {
    const checked = options.checkedTask === mapping.taskId ? 'x' : ' ';
    const evidenceSuffix = checked === 'x'
      ? ' - 2026-05-25 evidence: passed with cu-user-acceptance-manifest and verifier status.'
      : '';
    return [
      `### ${mapping.taskId} ${mapping.title}`,
      '',
      `- [${checked}] Run ${mapping.slug}${evidenceSuffix}`,
      `- [${checked}] Present trace, screenshot, artifact, verifier, and gui.present refs${evidenceSuffix}`,
      '',
    ].join('\n');
  }).join('\n');

  return [
    '# SciForge 项目协议',
    '',
    '## 当前任务板：下一轮 Computer Use 真实复杂任务',
    '',
    sections,
    '## 验证规则',
    '',
  ].join('\n');
}

function denseGroundingAcceptanceRef(taskId: string): string {
  return `.sciforge/vision-runs/${taskId.toLowerCase()}-dense-grounding/cu-user-acceptance-manifest.json`;
}

function realBuilderAcceptanceRef(taskId: string): string {
  return `.sciforge/vision-runs/${taskId.toLowerCase()}-real-builder/cu-user-acceptance-manifest.json`;
}

async function writeEvidenceBundle(
  root: string,
  manifestRef: string,
  data: unknown,
  options: { skipRefs?: string[] } = {},
): Promise<void> {
  await writeJsonRef(root, manifestRef, data);
  const skipRefs = new Set(options.skipRefs ?? []);
  const refs = collectLocalEvidenceRefs(data).filter((ref) => !skipRefs.has(ref));
  await Promise.all(refs.map((ref) => writeFixtureFile(root, ref)));
}

async function writeJsonRef(root: string, ref: string, data: unknown): Promise<void> {
  const path = resolveLocalFixtureRef(root, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function writeFixtureFile(root: string, ref: string): Promise<void> {
  const path = resolveLocalFixtureRef(root, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'fixture evidence\n');
}

function collectLocalEvidenceRefs(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return isLocalFixtureRef(value) ? [value] : [];
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((item) => collectLocalEvidenceRefs(item, seen));
  return Object.values(value).flatMap((item) => collectLocalEvidenceRefs(item, seen));
}

function isLocalFixtureRef(ref: string): boolean {
  const filePath = ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
  return filePath.startsWith('.sciforge/');
}

function resolveLocalFixtureRef(root: string, ref: string): string {
  const filePath = ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
  return resolve(root, filePath);
}

function passedBrowserManifest(options: { observedAt?: string } = {}): Record<string, unknown> {
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
    singleTurn: {
      status: 'passed',
      visibleAnswerConfirmed: true,
      providerModelProfileVisible: true,
      workspaceCommandIdVisible: true,
    },
    artifactFollowUp: {
      status: 'passed',
      visibleAnswerConfirmed: true,
      providerModelProfileVisible: true,
      workspaceCommandIdVisible: true,
    },
    multiTurn: {
      status: 'passed',
      visibleAnswerConfirmed: true,
      providerModelProfileVisible: true,
      workspaceCommandIdVisible: true,
      secondTurnVisibleAnswerConfirmed: true,
    },
  };
}

function passedKvGroundManifest(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.kv-ground-smoke.v1',
    runId: 'kv-ground-smoke-20260525T000000Z',
    createdAt: '2026-05-25T00:00:00.000Z',
    endpoint: 'http://127.0.0.1:18081',
    checks: {
      health: {
        ok: true,
      },
      predict: {
        coordinates: [480, 1062],
      },
    },
    predictRequest: {
      imageRef: 'docs/assets/sciforge-product-overview.png',
      textPrompt: 'Click the Ask SciForge input box',
    },
  };
}

function passedCuNextAcceptanceManifest(
  taskId: string,
  options: {
    antiShortcutRejectedClaims?: Array<Record<string, unknown>>;
    fixture?: boolean;
    dryRun?: boolean;
    sharedSystemInput?: boolean;
    omitGuiPresentClaim?: boolean;
  } = {},
): Record<string, unknown> {
  const runId = `${taskId.toLowerCase()}-dense-grounding`;
  return {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId,
    taskId,
    scenarioId: 'CU-LONG-004',
    createdAt: '2026-05-25T00:00:00.000Z',
    status: 'multi-app-workflow-passed',
    taskText: `${taskId} visual-grounding-pressure-test with coarse fine focus crop rejected excluded targets`,
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'Dense Toolbar App', 'Finder'],
      windowSwitchTraceRefs: [`.sciforge/vision-runs/${runId}/window-switch-trace.json`],
    },
    antiShortcutGuard: {
      status: options.antiShortcutRejectedClaims?.length ? 'failed' : 'passed',
      rejectedClaims: options.antiShortcutRejectedClaims ?? [],
    },
    tuiHostChain: [
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: `.sciforge/vision-runs/${runId}/computer-use-request.json`,
        hostPortsRef: `.sciforge/vision-runs/${runId}/host-ports.json`,
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef: `.sciforge/vision-runs/${runId}/tool-payload.json`,
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: 'present',
        recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      },
    ],
    screenshotRefs: {
      before: [`.sciforge/vision-runs/${runId}/before.png`],
      after: [`.sciforge/vision-runs/${runId}/after.png`],
    },
    focusCropRefs: [`.sciforge/vision-runs/${runId}/focus-crop.png`],
    groundingDiagnosticsRefs: [`.sciforge/vision-runs/${runId}/grounding-diagnostics.json`],
    executorLease: {
      status: 'present',
      ref: `.sciforge/vision-runs/${runId}/executor-lease.json`,
    },
    finalArtifactRef: `.sciforge/vision-runs/${runId}/dense-grounding-export.csv`,
    finalVisibleScreenshotRef: `.sciforge/vision-runs/${runId}/final-visible.png`,
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: `.sciforge/vision-runs/${runId}/verifier-verdict.json`,
    },
    guiPresent: {
      status: 'present',
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      payloadRef: `.sciforge/vision-runs/${runId}/gui-present-payload.json`,
      displayedRefs: [`.sciforge/vision-runs/${runId}/dense-grounding-export.csv`],
    },
    evidenceClaims: [
      {
        id: 'real-computer-use-trace',
        kind: 'real-computer-use',
        ref: `.sciforge/vision-runs/${runId}/vision-trace.json`,
      },
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter',
        refs: [`.sciforge/vision-runs/${runId}/virtual-pointer-events.json`],
        sessionRefs: [`computer-use-session:${runId}`],
      },
      {
        id: 'dense-grounding-rejections',
        kind: 'grounding-diagnostics-ref',
        refs: [`.sciforge/vision-runs/${runId}/coarse-fine-rejected-targets.json`],
      },
      ...(options.omitGuiPresentClaim
        ? []
        : [
            {
              id: 'gui-present-record',
              kind: 'gui-present-record',
              ref: `.sciforge/vision-runs/${runId}/gui-present.json`,
              refs: [`.sciforge/vision-runs/${runId}/gui-present.json`],
              artifactRefs: [`.sciforge/vision-runs/${runId}/dense-grounding-export.csv`],
            },
          ]),
    ],
    trace: {
      testActionFixtureMode: options.fixture ? true : false,
      dryRun: options.dryRun ? true : false,
      allowSharedSystemInput: options.sharedSystemInput ? true : false,
      pointerKeyboardOwnership: options.sharedSystemInput
        ? 'shared-system-pointer-keyboard'
        : 'independent-simulated-input-adapter',
    },
  };
}

function realCuNextAcceptanceInput(taskId: string): Parameters<typeof buildCuUserAcceptanceManifest>[0] {
  const runId = `${taskId.toLowerCase()}-real-builder`;
  return {
    runId,
    taskId,
    createdAt: '2026-05-25T00:00:00.000Z',
    taskText: `${taskId} visual-grounding-pressure-test with coarse fine focus crop rejected excluded targets`,
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'Dense Toolbar App', 'Finder'],
      windowSwitchTraceRefs: [`.sciforge/vision-runs/${runId}/window-switch-trace.json`],
    },
    tuiHostChain: [
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: `.sciforge/vision-runs/${runId}/computer-use-request.json`,
        hostPortsRef: `.sciforge/vision-runs/${runId}/host-ports.json`,
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef: `.sciforge/vision-runs/${runId}/tool-payload.json`,
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: 'present',
        recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      },
    ],
    evidenceClaims: [
      {
        id: 'real-computer-use-trace',
        kind: 'real-computer-use',
        ref: `.sciforge/vision-runs/${runId}/vision-trace.json`,
      },
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter',
        refs: [`.sciforge/vision-runs/${runId}/virtual-pointer-events.json`],
        sessionRefs: [`computer-use-session:${runId}`],
      },
      {
        id: 'gui-present-record',
        kind: 'gui-present-record',
        ref: `.sciforge/vision-runs/${runId}/gui-present.json`,
        refs: [`.sciforge/vision-runs/${runId}/gui-present.json`],
        artifactRefs: [`.sciforge/vision-runs/${runId}/dense-grounding-export.csv`],
      },
    ],
    screenshotRefs: {
      before: [`.sciforge/vision-runs/${runId}/before.png`],
      after: [`.sciforge/vision-runs/${runId}/after.png`],
    },
    focusCropRefs: [`.sciforge/vision-runs/${runId}/focus-crop.png`],
    groundingDiagnosticsRefs: [`.sciforge/vision-runs/${runId}/coarse-fine-rejected-targets.json`],
    executorLease: {
      status: 'present',
      ref: `.sciforge/vision-runs/${runId}/executor-lease.json`,
    },
    finalArtifactRef: `.sciforge/vision-runs/${runId}/dense-grounding-export.csv`,
    finalVisibleScreenshotRef: `.sciforge/vision-runs/${runId}/final-visible.png`,
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: `.sciforge/vision-runs/${runId}/verifier-verdict.json`,
      reason: `${taskId} coarse fine focus crop rejected excluded targets passed.`,
    },
    guiPresent: {
      status: 'present',
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      payloadRef: `.sciforge/vision-runs/${runId}/gui-present-payload.json`,
      displayedRefs: [`.sciforge/vision-runs/${runId}/dense-grounding-export.csv`],
    },
  };
}
