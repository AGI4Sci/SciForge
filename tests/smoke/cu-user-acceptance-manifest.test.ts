import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildCuUserAcceptanceManifest,
  evaluateCuUserAcceptanceAntiShortcutGuard,
} from '../../tools/cu-user-acceptance-manifest.js';

const execFileAsync = promisify(execFile);

test('CU-05 manifest records blocked evidence without faking user acceptance success', () => {
  const manifest = buildCuUserAcceptanceManifest({
    runId: 'cu-05-blocked',
    createdAt: '2026-05-25T00:00:00.000Z',
    taskText: 'Create a one-slide acceptance artifact.',
    level: 'L2',
    appWorkflow: {
      kind: 'single-app-artifact',
      apps: ['LibreOffice Impress'],
    },
    tuiHostChain: [
      {
        id: 'host-chain-missing',
        kind: 'missing',
        status: 'blocked',
        note: 'No TUI Host runTask evidence was supplied.',
      },
    ],
  });

  assert.equal(manifest.schemaVersion, 'sciforge.computer-use.user-acceptance-manifest.v1');
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.executorLease.required, true);
  assert.equal(manifest.executorLease.status, 'missing');
  assert.deepEqual(manifest.screenshotRefs, { before: [], after: [] });
  assert.deepEqual(manifest.focusCropRefs, []);
  assert.deepEqual(manifest.groundingDiagnosticsRefs, []);
  assert.equal(manifest.verifierVerdict.status, 'not-run');
  assert.equal(manifest.guiPresent.required, true);
  assert.equal(manifest.guiPresent.status, 'missing');
  assert.ok(manifest.blockedItems[0]?.reason.includes('TUI Host runTask chain'));
  assert.ok(manifest.nonSubstitutes.includes('generated files without visible Computer Use execution'));
});

test('CU-05 ready means host chain and executor lease exist but pass evidence is not complete', () => {
  const manifest = buildCuUserAcceptanceManifest({
    runId: 'cu-05-ready',
    createdAt: '2026-05-25T00:05:00.000Z',
    taskText: 'Create a one-slide acceptance artifact.',
    level: 'L2',
    appWorkflow: {
      kind: 'single-app-artifact',
      apps: ['Keynote'],
    },
    tuiHostChain: requiredHostChain('cu-05-ready'),
    executorLease: {
      status: 'present',
      ref: '.sciforge/vision-runs/cu-05-ready/executor-lease.json',
      owner: 'computer-use',
    },
  });

  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.verifierVerdict.status, 'not-run');
  assert.deepEqual(manifest.blockedItems, []);
  assert.equal(manifest.finalArtifactRef, undefined);
  assert.equal(manifest.guiPresent.status, 'missing');
});

test('CU-05 records single-app-artifact-passed only with required Computer Use refs and gui.present evidence', () => {
  const manifest = buildCuUserAcceptanceManifest(validSingleAppPassInput());

  assert.equal(manifest.status, 'single-app-artifact-passed');
  assert.equal(manifest.antiShortcutGuard.status, 'passed');
  assert.equal(manifest.executorLease.status, 'present');
  assert.deepEqual(manifest.screenshotRefs.before, ['.sciforge/vision-runs/cu-05-single/before.png']);
  assert.deepEqual(manifest.screenshotRefs.after, ['.sciforge/vision-runs/cu-05-single/after.png']);
  assert.deepEqual(manifest.focusCropRefs, ['.sciforge/vision-runs/cu-05-single/focus-crop.png']);
  assert.deepEqual(manifest.groundingDiagnosticsRefs, ['.sciforge/vision-runs/cu-05-single/grounding-diagnostics.json']);
  assert.equal(manifest.finalArtifactRef, '.sciforge/vision-runs/cu-05-single/acceptance-slide.pptx');
  assert.equal(manifest.finalVisibleScreenshotRef, '.sciforge/vision-runs/cu-05-single/final-visible.png');
  assert.equal(manifest.verifierVerdict.verdict, 'single-app-artifact-passed');
  assert.equal(manifest.guiPresent.status, 'present');
  assert.ok(manifest.guiPresent.displayedRefs?.includes('.sciforge/vision-runs/cu-05-single/acceptance-slide.pptx'));
  assert.deepEqual(manifest.blockedItems, []);
});

test('CU-05 records multi-app-workflow-passed only with app switch trace and matching verifier verdict', () => {
  const manifest = buildCuUserAcceptanceManifest(validMultiAppPassInput());

  assert.equal(manifest.status, 'multi-app-workflow-passed');
  assert.equal(manifest.appWorkflow.apps.length, 3);
  assert.deepEqual(manifest.appWorkflow.windowSwitchTraceRefs, [
    '.sciforge/vision-runs/cu-05-multi/window-switch-trace.json',
  ]);
  const independentInputClaim = manifest.evidenceClaims.find((claim) => claim.kind === 'independent-input-adapter');
  assert.ok(independentInputClaim);
  assert.deepEqual(independentInputClaim.sessionRefs, [
    '.sciforge/vision-runs/cu-05-multi/independent-input-session.json',
  ]);
  assert.ok(independentInputClaim.evidenceRefs?.includes('.sciforge/vision-runs/cu-05-multi/virtual-pointer-events.json'));
  assert.equal(manifest.guiPresent.sourceRef, 'gui.present:cu-05-multi');
  assert.deepEqual(manifest.guiPresent.sessionRefs, ['codex-thread:cu-05-multi']);
});

test('CU-05 L3 final pass requires independent input adapter evidence, not shared system input ack', () => {
  const validInput = validMultiAppPassInput('cu-05-shared-input');
  const manifest = buildCuUserAcceptanceManifest({
    ...validInput,
    evidenceClaims: [
      ...(validInput.evidenceClaims ?? []).filter((claim) => claim.kind !== 'independent-input-adapter'),
      {
        id: 'shared-system-input-ack',
        kind: 'shared-input-ack' as const,
        ref: '.sciforge/vision-runs/cu-05-shared-input/shared-input-ack.json',
        note: 'Shared system mouse and keyboard were acknowledged for the run.',
      },
    ],
  });

  assert.equal(manifest.status, 'blocked');
  assert.notEqual(manifest.status, 'multi-app-workflow-passed');
  assert.ok(manifest.blockedItems[0]?.reason.includes('independent simulated input adapter evidence claim'));
  assert.ok(manifest.blockedItems[0]?.reason.includes('shared-input-ack is shared system input'));
});

test('CU-05 L3 final pass requires independent input virtual and session refs, not a bare label', () => {
  const validInput = validMultiAppPassInput('cu-05-bare-independent-input');
  const manifest = buildCuUserAcceptanceManifest({
    ...validInput,
    evidenceClaims: (validInput.evidenceClaims ?? []).map((claim) => (
      claim.kind === 'independent-input-adapter'
        ? {
            id: 'independent-input-adapter',
            kind: 'independent-input-adapter' as const,
            note: 'Claim label without virtual adapter records or session evidence.',
          }
        : claim
    )),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.blockedItems[0]?.reason.includes('independent simulated input adapter virtual evidence refs'));
  assert.ok(manifest.blockedItems[0]?.reason.includes('independent simulated input adapter session evidence refs'));
});

test('CU-05 anti-shortcut guard rejects DOM, Playwright, accessibility, and generated-file-only substitutes', () => {
  const guard = evaluateCuUserAcceptanceAntiShortcutGuard([
    { id: 'dom-slide-title', kind: 'dom', ref: 'document.querySelector("h1").textContent' },
    { id: 'playwright-save', kind: 'playwright', ref: 'page.click("text=Save")' },
    { id: 'ax-window', kind: 'accessibility', ref: 'AXWindow:Untitled' },
    { id: 'generated-pptx', kind: 'generated-file-only', ref: '.sciforge/vision-runs/cu-05/acceptance-slide.pptx' },
    { id: 'real-trace', kind: 'real-computer-use', ref: '.sciforge/vision-runs/cu-05/trace.json' },
  ]);

  assert.equal(guard.status, 'failed');
  assert.deepEqual(
    guard.rejectedClaims.map((claim) => claim.kind),
    ['dom', 'playwright', 'accessibility', 'generated-file-only'],
  );

  const manifest = buildCuUserAcceptanceManifest({
    ...validSingleAppPassInput(),
    evidenceClaims: [
      { id: 'generated-pptx', kind: 'generated-file-only', ref: '.sciforge/vision-runs/cu-05/acceptance-slide.pptx' },
    ],
  });
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.antiShortcutGuard.status, 'failed');
  assert.ok(manifest.blockedItems[0]?.reason.includes('shortcut substitute evidence'));
});

test('CU-05 CLI writes the evaluated manifest from JSON input', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-user-acceptance-'));
  try {
    const inputPath = join(workspace, 'input.json');
    const manifestPath = join(workspace, 'manifest.json');
    await writeFile(inputPath, JSON.stringify(validSingleAppPassInput(), null, 2));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-user-acceptance-manifest.ts',
      '--input-json',
      inputPath,
      '--out',
      manifestPath,
    ]);

    assert.match(stdout, /\[single-app-artifact-passed\]/);
    const written = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(written.status, 'single-app-artifact-passed');
    assert.equal(written.schemaVersion, 'sciforge.computer-use.user-acceptance-manifest.v1');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function requiredHostChain(runId: string) {
  return [
    {
      id: 'terminal-equivalent-text',
      kind: 'gui-terminal-equivalent-text' as const,
      status: 'present' as const,
      recordRef: `.sciforge/vision-runs/${runId}/terminal-equivalent-request.json`,
    },
    {
      id: 'tui-host-runTask',
      kind: 'tui-host-runTask' as const,
      status: 'present' as const,
      requestRef: `.sciforge/vision-runs/${runId}/computer-use-request.json`,
      hostPortsRef: `.sciforge/vision-runs/${runId}/host-ports.json`,
    },
    {
      id: 'action-provider-result',
      kind: 'computer-use-action-provider' as const,
      status: 'present' as const,
      toolPayloadRef: `.sciforge/vision-runs/${runId}/tool-payload.json`,
    },
    {
      id: 'gui-present',
      kind: 'gui.present' as const,
      status: 'present' as const,
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
    },
  ];
}

function validSingleAppPassInput(runId = 'cu-05-single') {
  return {
    runId,
    createdAt: '2026-05-25T00:10:00.000Z',
    taskText: 'Create a one-slide acceptance artifact titled SciForge Computer Use Acceptance.',
    level: 'L2' as const,
    appWorkflow: {
      kind: 'single-app-artifact' as const,
      apps: ['LibreOffice Impress'],
    },
    tuiHostChain: requiredHostChain(runId),
    evidenceClaims: [
      {
        id: 'real-computer-use-trace',
        kind: 'real-computer-use' as const,
        ref: `.sciforge/vision-runs/${runId}/computer-use-trace.json`,
      },
    ],
    screenshotRefs: {
      before: [`.sciforge/vision-runs/${runId}/before.png`],
      after: [`.sciforge/vision-runs/${runId}/after.png`],
    },
    focusCropRefs: [`.sciforge/vision-runs/${runId}/focus-crop.png`],
    groundingDiagnosticsRefs: [`.sciforge/vision-runs/${runId}/grounding-diagnostics.json`],
    executorLease: {
      status: 'present' as const,
      ref: `.sciforge/vision-runs/${runId}/executor-lease.json`,
      owner: 'computer-use',
      acquiredAt: '2026-05-25T00:10:30.000Z',
    },
    finalArtifactRef: `.sciforge/vision-runs/${runId}/acceptance-slide.pptx`,
    finalVisibleScreenshotRef: `.sciforge/vision-runs/${runId}/final-visible.png`,
    verifierVerdict: {
      status: 'passed' as const,
      verdict: 'single-app-artifact-passed' as const,
      ref: `.sciforge/vision-runs/${runId}/verifier-verdict.json`,
      reason: 'Verifier saw the saved slide artifact and final visible screenshot.',
    },
    guiPresent: {
      status: 'present' as const,
      recordRef: `.sciforge/vision-runs/${runId}/gui-present.json`,
      payloadRef: `.sciforge/vision-runs/${runId}/gui-present-payload.json`,
      displayedRefs: [
        `.sciforge/vision-runs/${runId}/acceptance-slide.pptx`,
        `.sciforge/vision-runs/${runId}/final-visible.png`,
      ],
    },
  };
}

function validMultiAppPassInput(runId = 'cu-05-multi') {
  const input = validSingleAppPassInput(runId);
  return {
    ...input,
    level: 'L3' as const,
    appWorkflow: {
      kind: 'multi-app-workflow' as const,
      apps: ['Browser', 'LibreOffice Impress', 'Finder'],
      windowSwitchTraceRefs: [`.sciforge/vision-runs/${runId}/window-switch-trace.json`],
    },
    evidenceClaims: [
      ...(input.evidenceClaims ?? []),
      {
        id: 'independent-input-adapter',
        kind: 'independent-input-adapter' as const,
        ref: `.sciforge/vision-runs/${runId}/independent-input-adapter.json`,
        refs: [
          `.sciforge/vision-runs/${runId}/independent-input-adapter.json`,
          `.sciforge/vision-runs/${runId}/pointer-icon.png`,
        ],
        recordRefs: [`.sciforge/vision-runs/${runId}/independent-input-adapter.json`],
        evidenceRefs: [
          `.sciforge/vision-runs/${runId}/virtual-pointer-events.json`,
          `.sciforge/vision-runs/${runId}/virtual-keyboard-events.json`,
        ],
        sessionRefs: [`.sciforge/vision-runs/${runId}/independent-input-session.json`],
        note: 'Virtual pointer and keyboard adapter drove the final L3 flow.',
      },
    ],
    guiPresent: {
      ...input.guiPresent,
      sourceRef: `gui.present:${runId}`,
      recordRefs: [`.sciforge/vision-runs/${runId}/gui-present.json`],
      artifactRefs: [`.sciforge/vision-runs/${runId}/acceptance-slide.pptx`],
      sessionRefs: [`codex-thread:${runId}`],
    },
    verifierVerdict: {
      status: 'passed' as const,
      verdict: 'multi-app-workflow-passed' as const,
      ref: `.sciforge/vision-runs/${runId}/verifier-verdict.json`,
      reason: 'Verifier saw Browser source collection, slide creation, Finder save, and visible GUI presentation.',
    },
  };
}
