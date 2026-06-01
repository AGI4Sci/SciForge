import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildVirtualAppScreenUserAcceptanceManifest,
  validateVirtualAppScreenUserAcceptanceManifest,
  VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION,
  type VirtualAppScreenUserAcceptanceInput,
} from '../../tools/virtual-app-screen-user-acceptance-manifest.js';

const execFileAsync = promisify(execFile);

test('VirtualAppScreen user acceptance manifest passes only with refs-first causality evidence', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(validInput());

  assert.equal(manifest.schemaVersion, VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.blockedReason, null);
  assert.equal(manifest.userAcceptanceEligible, true);
  assert.equal(manifest.diagnosticOnly, false);
  assert.equal(manifest.validation.ok, true);
  assert.equal(manifest.taskId, 'P0-CU-UA-FIRST-SCENARIO');
  assert.equal(manifest.scenarioId, 'virtual-app-screen-local-research-note');
  assert.deepEqual(manifest.targetAppRefs, ['app:browser-research-profile']);
  assert.deepEqual(manifest.targetWindowRefs, ['window:browser-research-profile/main']);
  assert.deepEqual(manifest.sessionRefs, ['computer-use-session:vas-local-research-note']);
  assert.deepEqual(manifest.adapterReadinessRefs, ['computer-use:adapter-readiness/browser-background.json']);
  assert.deepEqual(manifest.screenFrameRefs, [
    'computer-use:session/vas-local-research-note/frames/before.png',
    'computer-use:session/vas-local-research-note/frames/after.png',
  ]);
  assert.deepEqual(manifest.inputIntentRefs, ['computer-use:session/vas-local-research-note/input-intents/highlight-title.json']);
  assert.deepEqual(manifest.executorEventRefs, ['computer-use:session/vas-local-research-note/executor-events/highlight-title.json']);
  assert.deepEqual(manifest.beforeAfterFrameRefs, ['computer-use:session/vas-local-research-note/before-after/highlight-title.json']);
  assert.deepEqual(manifest.annotationProposalRefs, ['computer-use:session/vas-local-research-note/annotation-proposals/highlight-title.json']);
  assert.deepEqual(manifest.artifactRefs, ['file:research-note.md']);
  assert.deepEqual(manifest.verificationRefs, ['computer-use:session/vas-local-research-note/verifier/research-note.json']);
  assert.deepEqual(manifest.guiPresentRefs, ['gui.present:virtual-app-screen/research-note']);
  assert.equal(manifest.replayRef, 'computer-use:session/vas-local-research-note/replay.json');
  assert.equal(manifest.evidenceLedgerRef, 'computer-use:session/vas-local-research-note/evidence-ledger.json');
});

test('VirtualAppScreen manifest blocks missing refs instead of fabricating user acceptance', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    screenFrameRefs: [],
    beforeAfterFrameRefs: [],
    guiPresentRefs: [],
    replayRef: undefined,
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.deepEqual(manifest.validation.missingRefs, [
    'screenFrameRefs',
    'beforeAfterFrameRefs',
    'guiPresentRefs',
    'replayRef',
  ]);
  assert.match(String(manifest.blockedReason), /missing screenFrameRefs/);
});

test('VirtualAppScreen manifest uses needs-confirmation for high-risk pending approval', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    confirmationRequired: true,
    confirmationRef: 'approval:computer-use/annotate-save',
  });

  assert.equal(manifest.status, 'needs-confirmation');
  assert.match(String(manifest.blockedReason), /User confirmation is required/);
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.equal(manifest.confirmationRef, 'approval:computer-use/annotate-save');
  assert.equal(manifest.validation.ok, true);
});

test('VirtualAppScreen manifest requires handoff when isolation cannot be proven', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    isolationFlags: {
      ...validInput().isolationFlags,
      backgroundRenderable: false,
      requiresFocusSteal: true,
      sharedSystemInputUsed: true,
      affectsPhysicalDisplay: true,
      physicalDisplayPopup: true,
    },
  });

  assert.equal(manifest.status, 'requires-handoff');
  assert.match(String(manifest.blockedReason), /background rendering is unavailable/);
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.match(String(manifest.requiresHandoffReason), /background rendering is unavailable/);
  assert.match(String(manifest.requiresHandoffReason), /requires focus steal/);
  assert.match(String(manifest.requiresHandoffReason), /shared system input/);
  assert.match(String(manifest.requiresHandoffReason), /physical display/);
});

test('VirtualAppScreen manifest rejects package smoke, M6, DOM, fixture, and shell-only substitute pass evidence', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    evidenceClaims: [
      realVirtualAppScreenClaim(),
      { id: 'package-smoke', kind: 'package-smoke', userAcceptanceEligible: true },
      { id: 'm6', kind: 'm6-native-multi-screen', completionEvidence: true },
      { id: 'fixture', kind: 'target-bound-fixture', userAcceptanceEligible: true },
      { id: 'dom', kind: 'dom', completionEvidence: true },
      { id: 'playwright', kind: 'playwright', completionEvidence: true },
      { id: 'accessibility', kind: 'accessibility', completionEvidence: true },
      { id: 'shell', kind: 'shell-direct-artifact', userAcceptanceEligible: true },
    ],
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.deepEqual(manifest.validation.rejectedClaimKinds, [
    'package-smoke',
    'm6-native-multi-screen',
    'target-bound-fixture',
    'dom',
    'playwright',
    'accessibility',
    'shell-direct-artifact',
  ]);
  assert.match(manifest.validation.issues.join('\n'), /non-substitute evidence/);
});

test('VirtualAppScreen adapter readiness schema fail-closes unsafe capabilities', () => {
  const unsafe = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    adapterReadinessRecords: [{
      adapterKind: 'macos-global-input-diagnostic',
      targetScope: 'window',
      supportedActions: ['click'],
      captureSupported: true,
      backgroundRenderable: false,
      affectsPhysicalDisplay: true,
      requiresFocusSteal: true,
      sharedSystemInputUsed: true,
      blockedReason: 'Global system input would move the user desktop.',
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    }],
  });

  assert.equal(unsafe.status, 'requires-handoff');
  assert.equal(unsafe.validation.ok, false);
  assert.ok(unsafe.validation.issues.some((issue) => issue.includes('backgroundRenderable must be true')));
  assert.ok(unsafe.validation.issues.some((issue) => issue.includes('sharedSystemInputUsed must be false')));

  const validation = validateVirtualAppScreenUserAcceptanceManifest(unsafe);
  assert.equal(validation.ok, false);
});

test('VirtualAppScreen manifest CLI writes refs-first status output', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-acceptance-'));
  try {
    const inputPath = join(workspace, 'input.json');
    const outPath = join(workspace, 'manifest.json');
    await writeFile(inputPath, `${JSON.stringify(validInput(), null, 2)}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'tools/virtual-app-screen-user-acceptance-manifest.ts',
      '--input-json',
      inputPath,
      '--out',
      outPath,
    ]);
    const manifest = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;

    assert.match(stdout, /\[passed\] wrote sciforge\.computer-use\.virtual-app-screen-user-acceptance-manifest\.v1/);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.blockedReason, null);
    assert.equal(manifest.userAcceptanceEligible, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function validInput(): VirtualAppScreenUserAcceptanceInput {
  return {
    taskId: 'P0-CU-UA-FIRST-SCENARIO',
    scenarioId: 'virtual-app-screen-local-research-note',
    userIntent: 'Read local research notes in a background app screen, annotate a sentence, and produce research-note.md.',
    targetAppRefs: ['app:browser-research-profile'],
    targetWindowRefs: ['window:browser-research-profile/main'],
    sessionRefs: ['computer-use-session:vas-local-research-note'],
    adapterReadinessRefs: ['computer-use:adapter-readiness/browser-background.json'],
    adapterReadinessRecords: [{
      adapterKind: 'browser-runtime-window',
      targetScope: 'window',
      supportedActions: ['click', 'type', 'scroll', 'hotkey', 'annotate'],
      captureSupported: true,
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      blockedReason: null,
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    }],
    screenFrameRefs: [
      'computer-use:session/vas-local-research-note/frames/before.png',
      'computer-use:session/vas-local-research-note/frames/after.png',
    ],
    inputIntentRefs: ['computer-use:session/vas-local-research-note/input-intents/highlight-title.json'],
    executorEventRefs: ['computer-use:session/vas-local-research-note/executor-events/highlight-title.json'],
    beforeAfterFrameRefs: ['computer-use:session/vas-local-research-note/before-after/highlight-title.json'],
    annotationProposalRefs: ['computer-use:session/vas-local-research-note/annotation-proposals/highlight-title.json'],
    artifactRefs: ['file:research-note.md'],
    verificationRefs: ['computer-use:session/vas-local-research-note/verifier/research-note.json'],
    guiPresentRefs: ['gui.present:virtual-app-screen/research-note'],
    replayRef: 'computer-use:session/vas-local-research-note/replay.json',
    evidenceLedgerRef: 'computer-use:session/vas-local-research-note/evidence-ledger.json',
    isolationFlags: {
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      physicalDisplayPopup: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      diagnosticOnly: false,
    },
    evidenceClaims: [
      realVirtualAppScreenClaim(),
      {
        id: 'gui-present',
        kind: 'gui-present',
        status: 'present',
        ref: 'gui.present:virtual-app-screen/research-note',
      },
      {
        id: 'verifier',
        kind: 'validator-verifier',
        status: 'present',
        ref: 'computer-use:session/vas-local-research-note/verifier/research-note.json',
      },
    ],
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

function realVirtualAppScreenClaim() {
  return {
    id: 'real-virtual-app-screen',
    kind: 'real-virtual-app-screen' as const,
    status: 'present' as const,
    ref: 'computer-use:session/vas-local-research-note/evidence-ledger.json',
    refs: ['computer-use:session/vas-local-research-note/replay.json'],
    evidenceRefs: ['computer-use:session/vas-local-research-note/before-after/highlight-title.json'],
    sessionRefs: ['computer-use-session:vas-local-research-note'],
  };
}
