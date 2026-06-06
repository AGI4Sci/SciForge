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
import {
  isolatedL3CompletionEvidence as baseIsolatedL3CompletionEvidence,
  passedBundleLocalCuNext07AcceptanceManifest,
} from './helpers/cu-next-runner-fixtures.js';

const execFileAsync = promisify(execFile);

test('current CU-NEXT readiness manifest requires both checked PROJECT items and task evidence gates', async () => {
  const projectText = await readFile('PROJECT.md', 'utf8');
  const hasCurrentCuNextBoard = projectText.includes('## 当前任务板：下一轮 Computer Use 真实复杂任务');
  const manifest = await buildCuNextReadinessManifest({
    generatedAt: '2026-05-25T00:00:00.000Z',
  });

  assert.equal(manifest.schemaVersion, 'sciforge.computer-use.cu-next-readiness.v1');
  assert.ok(['ready', 'blocked'].includes(manifest.status));
  assert.equal(manifest.completionEligible, manifest.status === 'ready');
  assert.equal(manifest.tasks.length, CU_NEXT_TASK_MAPPINGS.length);
  assert.deepEqual(manifest.tasks.map((task) => task.id), CU_NEXT_TASK_MAPPINGS.map((mapping) => mapping.taskId));
  assert.equal(Object.hasOwn(manifest.globalEvidence, 'kvGround'), false);
  assert.equal(manifest.globalEvidence.modelRouterGrounding.status, manifest.globalEvidence.runtimeBrowser.status);
  assert.ok(['passed', 'blocked'].includes(manifest.globalEvidence.runtimeBrowser.status));

  for (const task of manifest.tasks) {
    if (hasCurrentCuNextBoard) {
      assert.equal(task.totalChecklistItems, 2);
      assert.equal(task.checkedChecklistItems, 2, `${task.id} current PROJECT.md acknowledgement should be checked with inline evidence`);
      assert.equal(task.blockedItems.some((item) => item.id.startsWith('project-checklist')), false);
    } else {
      assert.equal(task.totalChecklistItems, 0);
      assert.equal(task.checkedChecklistItems, 0, `${task.id} old CU-NEXT checklist should not be inferred from a replaced PROJECT board`);
      assert.equal(task.blockedItems.some((item) => (
        item.id.startsWith('project-checklist') || item.id === 'project-section-missing'
      )), true);
    }
    assert.ok(
      task.status === 'passed'
        || task.blockedItems.some((item) => item.id === 'missing-live-l2-l3-user-acceptance-manifest')
        || (!hasCurrentCuNextBoard && task.blockedItems.some((item) => (
          item.id.startsWith('project-checklist') || item.id === 'project-section-missing'
        ))),
      `${task.id} may pass when local live evidence is present, otherwise it must be blocked on evidence rather than PROJECT acknowledgement`,
    );
  }
  assert.equal(
    manifest.blockedItems.some((item) => item.id.endsWith('-not-passed')),
    manifest.status !== 'ready',
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
          data: {
            ...passedCuNextAcceptanceManifest('CU-NEXT-07'),
            kind: 'fixture',
            fixture: true,
          },
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

    const shellDirectArtifactWrite = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: {
            ...passedCuNextAcceptanceManifest('CU-NEXT-07'),
            artifactCausality: {
              shellDirectArtifactWrite: true,
            },
          },
        },
      ],
    });
    assert.equal(shellDirectArtifactWrite.tasks.find((task) => task.id === 'CU-NEXT-07')?.status, 'blocked');

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
    assert.equal(uncheckedTask?.status, 'evidence-ready', JSON.stringify(uncheckedTask, null, 2));
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

test('readiness manifest only promotes completion-grade isolated-L3 evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-next-readiness-'));
  try {
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    const targetBoundAcceptance = passedCuNextAcceptanceManifest('CU-NEXT-07', {
      completionEvidence: {
        evidenceKind: 'target-bound-real',
        status: 'completed',
        targetEnvironmentKind: 'package-owned-target-bound-window',
        realWindowEvidence: true,
        userAcceptanceEligible: false,
        diagnosticOnly: false,
        l3Workflow: {
          status: 'completed',
          completed: true,
          sameSession: true,
          sourceToWriterToPreviewCausality: true,
        },
      },
    });
    await writeEvidenceBundle(workspace, acceptanceRef, targetBoundAcceptance);
    const base = {
      root: workspace,
      projectText: cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }),
      projectRef: 'PROJECT.md',
      generatedAt: '2026-05-25T00:00:00.000Z',
      runtimeBrowserManifest: {
        path: 'docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json',
        data: passedBrowserManifest(),
      },
    };

    const targetBound = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: targetBoundAcceptance,
        },
      ],
    });
    const blockedTask = targetBound.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(blockedTask?.status, 'blocked');
    assert.equal(blockedTask?.acceptedEvidenceRef, undefined);
    assert.ok(blockedTask?.blockedItems.some((item) => item.id === 'completion-ineligible-evidence-kind'));
    assert.match(blockedTask?.blockedItems.map((item) => item.reason).join('\n') ?? '', /target-bound-real evidence is diagnostic or candidate-only/);

    const missingCompletedEvidence = isolatedL3CompletionEvidence();
    delete (missingCompletedEvidence.l3Workflow as Record<string, unknown>).completed;
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07', {
      completionEvidence: missingCompletedEvidence,
    }));
    const missingCompleted = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', {
            completionEvidence: missingCompletedEvidence,
          }),
        },
      ],
    });
    const missingCompletedTask = missingCompleted.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(missingCompletedTask?.status, 'blocked');
    assert.equal(missingCompletedTask?.acceptedEvidenceRef, undefined);
    assert.ok(missingCompletedTask?.blockedItems.some((item) => item.id === 'completion-ineligible-evidence-kind'));

    const missingRefEvidence = isolatedL3CompletionEvidence();
    delete missingRefEvidence.finalArtifactRef;
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07', {
      completionEvidence: missingRefEvidence,
    }));
    const missingRef = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', {
            completionEvidence: missingRefEvidence,
          }),
        },
      ],
    });
    const missingRefTask = missingRef.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(missingRefTask?.status, 'blocked');
    assert.equal(missingRefTask?.acceptedEvidenceRef, undefined);
    assert.match(
      missingRefTask?.blockedItems.map((item) => item.reason).join('\n') ?? '',
      /missing completed L3 ref field finalArtifactRef/,
    );

    const forgedMissingBlocksEvidence = isolatedL3CompletionEvidence();
    for (const field of [
      'workflowRequirements',
      'applicationEvidence',
      'crossAppTransitions',
      'sourceEvidence',
      'derivedContentEvidence',
      'artifactCausality',
      'directoryEvidence',
      'presentationEvidence',
    ]) {
      delete forgedMissingBlocksEvidence[field];
    }
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07', {
      completionEvidence: forgedMissingBlocksEvidence,
    }));
    const forgedMissingBlocks = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', {
            completionEvidence: forgedMissingBlocksEvidence,
          }),
        },
      ],
    });
    const forgedMissingBlocksTask = forgedMissingBlocks.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(forgedMissingBlocksTask?.status, 'blocked');
    assert.equal(forgedMissingBlocksTask?.acceptedEvidenceRef, undefined);
    assert.match(
      forgedMissingBlocksTask?.blockedItems.map((item) => item.reason).join('\n') ?? '',
      /missing critical L3 semantic block applicationEvidence/,
    );

    const nestedParentEscapeEvidence = isolatedL3CompletionEvidence();
    const applicationEvidence = nestedParentEscapeEvidence.applicationEvidence as Array<Record<string, unknown>>;
    applicationEvidence[0].firstScreenshotRef = '../escape.png';
    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07', {
      completionEvidence: nestedParentEscapeEvidence,
    }));
    const nestedParentEscape = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07', {
            completionEvidence: nestedParentEscapeEvidence,
          }),
        },
      ],
    });
    const nestedParentEscapeTask = nestedParentEscape.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(nestedParentEscapeTask?.status, 'blocked');
    assert.equal(nestedParentEscapeTask?.acceptedEvidenceRef, undefined);
    assert.match(
      nestedParentEscapeTask?.blockedItems.map((item) => item.reason).join('\n') ?? '',
      /applicationEvidence\[0\]\.firstScreenshotRef.*\.\.\/escape\.png.*parent-directory escapes/,
    );

    await writeEvidenceBundle(workspace, acceptanceRef, passedCuNextAcceptanceManifest('CU-NEXT-07'));
    const isolatedL3 = buildCuNextReadinessManifestFromData({
      ...base,
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: passedCuNextAcceptanceManifest('CU-NEXT-07'),
        },
      ],
    });
    const readyTask = isolatedL3.tasks.find((task) => task.id === 'CU-NEXT-07');
    assert.equal(readyTask?.status, 'passed', JSON.stringify(readyTask, null, 2));
    assert.equal(readyTask?.acceptedEvidenceRef, acceptanceRef);
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
    const acceptanceRef = denseGroundingAcceptanceRef('CU-NEXT-07');
    const acceptancePath = join(workspace, acceptanceRef);
    const outPath = join(workspace, 'readiness.json');
    await writeFile(projectPath, cuNextProjectFixture({ checkedTask: 'CU-NEXT-07' }));
    await writeFile(browserPath, JSON.stringify(passedBrowserManifest({ observedAt: new Date().toISOString() }), null, 2));
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
      '--acceptance-manifest',
      acceptancePath,
      '--out',
      outPath,
    ]);

    assert.match(stdout, new RegExp(`\\[blocked\\] CU-NEXT readiness 1\\/${CU_NEXT_TASK_MAPPINGS.length} passed; completionEligible=false`));
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    assert.equal(written.schemaVersion, 'sciforge.computer-use.cu-next-readiness.v1');
    assert.equal(written.tasks.find((task: { id: string }) => task.id === 'CU-NEXT-07')?.status, 'passed');
    assert.equal(Object.hasOwn(written.globalEvidence, 'kvGround'), false);
    assert.equal(written.globalEvidence.modelRouterGrounding.status, 'passed');
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
      userAcceptanceManifests: [
        {
          path: acceptanceRef,
          data: acceptance,
        },
      ],
    });

    const task = manifest.tasks.find((candidate) => candidate.id === 'CU-NEXT-07');
    assert.equal(task?.status, 'passed', JSON.stringify(task, null, 2));
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
  const manifestDir = dirname(resolveLocalFixtureRef(root, manifestRef));
  const skipRefs = new Set(options.skipRefs ?? []);
  const completionEvidenceRef = isRecord(data) && typeof data.completionEvidenceRef === 'string'
    ? data.completionEvidenceRef
    : undefined;
  const refs = collectLocalEvidenceRefs(data).filter((ref) => ref !== completionEvidenceRef && !skipRefs.has(ref));
  await Promise.all(refs.map((ref) => writeFixtureFile(root, manifestDir, ref)));
  if (completionEvidenceRef && !skipRefs.has(completionEvidenceRef)) {
    const completionEvidence = isRecord(data) && isRecord(data.completionEvidence)
      ? data.completionEvidence
      : {};
    const path = resolve(manifestDir, completionEvidenceRef);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(completionEvidence, null, 2));
    await materializeCompletionEvidenceRefs(manifestDir, completionEvidence);
  }
}

async function writeJsonRef(root: string, ref: string, data: unknown): Promise<void> {
  const path = resolveLocalFixtureRef(root, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

async function writeFixtureFile(root: string, manifestDir: string, ref: string): Promise<void> {
  const path = resolveEvidenceFixtureRef(root, manifestDir, ref);
  await mkdir(dirname(path), { recursive: true });
  if (/rejected-.+-target\.json$|coarse-fine-rejected-targets\.json$/.test(ref)) {
    await writeFile(path, JSON.stringify(denseGroundingRejectedTargetFixture(ref), null, 2));
    return;
  }
  if (/\.validation\.json$/i.test(ref)) {
    await writeFile(path, JSON.stringify(productArtifactValidationFixture(), null, 2));
    return;
  }
  if (/freshness-check\.json$/i.test(ref)) {
    await writeFile(path, JSON.stringify(freshnessCheckFixture(ref), null, 2));
    return;
  }
  await writeFile(path, 'fixture evidence\n');
}

function productArtifactValidationFixture(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.artifact-validation.v1',
    status: 'passed',
    ok: true,
    finalArtifactRef: 'dense-grounding-export.csv',
    artifactRef: 'dense-grounding-export.csv',
    contentRefs: ['dense-grounding-export.csv'],
    checkedRefs: ['dense-grounding-export.csv'],
    sourceRefs: ['before.png', 'source-facts.json'],
    format: 'csv',
    validator: 'sciforge-generic-csv-artifact-contract-validator',
    sha256: 'b643a37f2b949e7c08d5c8c8b861c907a07781dcb4d4294ac467b234e9b1f4f8',
    bytes: 32,
    metadata: {
      validationScope: 'product-smoke-record',
      finalArtifactRef: 'dense-grounding-export.csv',
    },
  };
}

function denseGroundingRejectedTargetFixture(ref: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
    status: 'recorded',
    selectedTarget: {
      targetDescription: 'Export button in the toolbar.',
    },
    rejectedTargets: [
      { targetDescription: ref.includes('share') ? 'Share button' : 'Save button', reason: 'neighboring decoy target' },
    ],
    coarseWindowScreenshotRef: ref.replace(/rejected-.+-target\.json$/, 'coarse-window.png'),
    focusCropRef: ref.replace(/rejected-.+-target\.json$/, 'focus-crop.png'),
    fineGroundingDiagnosticRef: ref.replace(/rejected-.+-target\.json$/, 'fine-grounding-diagnostic.json'),
  };
}

function freshnessCheckFixture(ref: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.freshness-check.v1',
    ref,
    status: 'current',
    observedAt: '2026-05-28T00:00:00.000Z',
    checkedAt: '2026-05-28T00:00:00.000Z',
    maxAgeMs: 30_000,
  };
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
  if (!filePath || filePath.startsWith('/') || filePath.startsWith('~')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(filePath)) return false;
  if (filePath.split(/[\\/]+/).some((part) => part === '..' || part === '.')) return false;
  return /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(filePath.split('/').at(-1) ?? '');
}

async function materializeCompletionEvidenceRefs(bundleDir: string, completionEvidence: Record<string, unknown>) {
  await Promise.all(collectCompletionEvidenceFileRefs(completionEvidence).map(async (ref) => {
    const path = resolve(bundleDir, ref);
    await mkdir(dirname(path), { recursive: true });
    if (/\.validation\.json$/i.test(ref)) {
      await writeFile(path, JSON.stringify(productArtifactValidationFixture(), null, 2));
      return;
    }
    await writeFile(path, 'fixture completion evidence ref\n');
  }));
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
  const trimmed = value.trim();
  const fileRef = completionEvidenceFixtureFileRef(trimmed);
  return /ref/i.test(key)
    && trimmed.length > 0
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

function resolveLocalFixtureRef(root: string, ref: string): string {
  const filePath = ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
  return resolve(root, filePath);
}

function resolveEvidenceFixtureRef(root: string, manifestDir: string, ref: string): string {
  const filePath = ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
  return filePath.startsWith('.sciforge/') ? resolve(root, filePath) : resolve(manifestDir, filePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function passedCuNextAcceptanceManifest(
  taskId: string,
  options: {
    antiShortcutRejectedClaims?: Array<Record<string, unknown>>;
    fixture?: boolean;
    dryRun?: boolean;
    sharedSystemInput?: boolean;
    omitGuiPresentClaim?: boolean;
    completionEvidence?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const manifest = passedBundleLocalCuNext07AcceptanceManifest();
  manifest.taskId = taskId;
  manifest.taskText = `${taskId} visual-grounding-pressure-test with coarse fine focus crop rejected excluded targets`;
  manifest.antiShortcutGuard = {
    status: options.antiShortcutRejectedClaims?.length ? 'failed' : 'passed',
    rejectedClaims: options.antiShortcutRejectedClaims ?? [],
  };
  manifest.evidenceClaims = Array.isArray(manifest.evidenceClaims)
    ? manifest.evidenceClaims.filter((claim) => (
        !options.omitGuiPresentClaim
        || !isRecord(claim)
        || claim.kind !== 'gui-present-record'
      ))
    : [];
  manifest.completionEvidence = options.completionEvidence ?? isolatedL3CompletionEvidence(String(manifest.finalArtifactRef ?? 'dense-grounding-export.csv'));
  manifest.completionEvidenceRef = 'isolated-desktop-l3-workflow-evidence.json';
  manifest.trace = {
    testActionFixtureMode: options.fixture ? true : false,
    dryRun: options.dryRun ? true : false,
    allowSharedSystemInput: options.sharedSystemInput ? true : false,
    pointerKeyboardOwnership: options.sharedSystemInput
      ? 'shared-system-pointer-keyboard'
      : 'independent-simulated-input-adapter',
  };
  return manifest;
}

function realCuNextAcceptanceInput(taskId: string): Parameters<typeof buildCuUserAcceptanceManifest>[0] {
  const runId = `${taskId.toLowerCase()}-real-builder`;
  const base = passedBundleLocalCuNext07AcceptanceManifest() as Record<string, any>;
  const mapping = CU_NEXT_TASK_MAPPINGS.find((candidate) => candidate.taskId === taskId);
  const finalArtifactRef = String(base.finalArtifactRef ?? 'dense-grounding-export.csv');
  return {
    runId,
    taskId,
    scenarioId: 'CU-LONG-004',
    createdAt: '2026-05-25T00:00:00.000Z',
    taskText: `${taskId} visual-grounding-pressure-test with coarse fine focus crop rejected excluded targets`,
    level: 'L3',
    appWorkflow: base.appWorkflow,
    tuiHostChain: base.tuiHostChain,
    evidenceClaims: base.evidenceClaims,
    screenshotRefs: base.screenshotRefs,
    focusCropRefs: base.focusCropRefs,
    groundingDiagnosticsRefs: base.groundingDiagnosticsRefs,
    executorLease: base.executorLease,
    finalArtifactRef,
    finalVisibleScreenshotRef: base.finalVisibleScreenshotRef,
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: String(base.verifierVerdict?.ref ?? 'verifier-verdict.json'),
      reason: `${taskId} coarse fine focus crop rejected excluded targets passed.`,
    },
    guiPresent: base.guiPresent,
    evidenceMarkers: base.evidenceMarkers,
    completionEvidence: isolatedL3CompletionEvidence(finalArtifactRef),
    completionEvidenceRef: 'isolated-desktop-l3-workflow-evidence.json',
    cuNextTask: {
      taskId,
      primaryScenarioId: mapping?.primaryScenarioId ?? 'CU-LONG-004',
      longScenarioIds: mapping?.longScenarioIds ?? ['CU-LONG-004'],
    },
    productPathClassification: base.productPathClassification,
    userControlPlane: base.userControlPlane,
    platformSidecarIsolationReport: base.platformSidecarIsolationReport,
    virtualDisplayGroup: base.virtualDisplayGroup,
    actorCursorProvenance: base.actorCursorProvenance,
    cursorEvents: base.cursorEvents,
    observeBeforeMutate: base.observeBeforeMutate,
    browserRuntimeDomAxObservation: base.browserRuntimeDomAxObservation,
    actionProposals: base.actionProposals,
    executorQueue: base.executorQueue,
    mutatingActions: base.mutatingActions,
    replayBundle: base.replayBundle,
    evidenceLedger: base.evidenceLedger,
    evidenceLedgerActions: base.evidenceLedgerActions,
    evidenceIndex: base.evidenceIndex,
    evidenceIndexRef: base.evidenceIndexRef,
    actionLedgerRef: base.actionLedgerRef,
  };
}

function isolatedL3CompletionEvidence(taskFinalArtifactRef?: string): Record<string, unknown> {
  return baseIsolatedL3CompletionEvidence(taskFinalArtifactRef ? [taskFinalArtifactRef] : []);
}
