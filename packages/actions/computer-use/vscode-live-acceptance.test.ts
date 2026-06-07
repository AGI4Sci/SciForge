import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cleanupVSCodeLiveAcceptanceArtifacts,
  runVSCodeLiveAcceptance,
  VSCODE_LIVE_ACCEPTANCE_ENV,
  VSCODE_LIVE_ACCEPTANCE_CAPABILITY,
} from './vscode-live-acceptance.js';

const liveEnabled = process.env[VSCODE_LIVE_ACCEPTANCE_ENV] === '1';

test('VSCode live acceptance stays blocked by default and does not claim product readiness', async () => {
  const root = join(tmpdir(), `sciforge-cu-vscode-default-${Date.now()}`);
  const manifest = await runVSCodeLiveAcceptance({
    root,
    env: {},
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.skipReason, 'missing-env:SCIFORGE_COMPUTER_USE_VSCODE_PRIMITIVE_ACCEPTANCE');
  assert.equal(manifest.productReady, false);
  assert.equal(manifest.maturity, 'live-diagnostic');
  assert.equal(manifest.sharedSystemInputUsed, true);
  assert.equal(manifest.userProfileUsed, true);
  assert.equal(manifest.vscodeLaunched, false);
  assert.equal(manifest.primitiveChainRequired, 'bind -> observe -> act -> observe -> control(release)');
  assert.deepEqual(manifest.primitiveChainObserved, []);
  assert.deepEqual(manifest.tempDirs, {
    workspaceCreated: false,
    userDataDirCreated: false,
    extensionsDirCreated: false,
    homeDirCreated: false,
    deletedAfterRun: true,
  });
  assert.doesNotMatch(JSON.stringify(manifest), /sentinelText|rawScreenshot|base64|file:\/\/|\/tmp\//i);

  const persisted = JSON.parse(await readFile(join(root, 'docs', 'test-artifacts', 'computer-use-vscode-live', 'manifest.json'), 'utf8')) as typeof manifest;
  assert.equal(persisted.status, 'blocked');
  await rm(root, { recursive: true, force: true });
});

test('VSCode live acceptance capability is explicitly diagnostic and env-gated', () => {
  assert.equal(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.requiresExplicitEnv, 'SCIFORGE_COMPUTER_USE_VSCODE_PRIMITIVE_ACCEPTANCE=1');
  assert.equal(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.productReady, false);
  assert.equal(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.maturity, 'live-diagnostic');
  assert.equal(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.userProfileUsed, true);
  assert.equal(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.cleanup.required, true);
  assert.ok(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('temporary-workspace-deleted'));
  assert.ok(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('test-file-tab-closed'));
  assert.ok(VSCODE_LIVE_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('input-lease-cursor-adapter-released'));
});

test('VSCode live acceptance cleanup removes stale artifacts and temp dirs by default', async () => {
  const root = join(tmpdir(), `sciforge-cu-vscode-cleanup-${Date.now()}`);
  const artifactRoot = join(root, 'docs', 'test-artifacts', 'computer-use-vscode-live');
  const workspaceDir = join(root, 'workspace');
  const userDataDir = join(root, 'user-data');
  const extensionsDir = join(root, 'extensions');
  await mkdir(join(artifactRoot, 'stale-run'), { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(extensionsDir, { recursive: true });
  await writeFile(join(artifactRoot, 'stale-run', 'manifest.json'), '{}\n', 'utf8');

  await cleanupVSCodeLiveAcceptanceArtifacts({
    artifactRoot,
    tempRoots: [workspaceDir, userDataDir, extensionsDir],
    keepArtifacts: false,
  });

  await assert.rejects(readFile(join(artifactRoot, 'stale-run', 'manifest.json'), 'utf8'), /ENOENT/);
  await assert.rejects(readFile(join(workspaceDir, 'anything'), 'utf8'), /ENOENT/);
  await rm(root, { recursive: true, force: true });
});

test('Computer Use primitives operate a real VSCode window end to end', {
  skip: liveEnabled ? undefined : `set ${VSCODE_LIVE_ACCEPTANCE_ENV}=1 to run the live VSCode primitive acceptance`,
  timeout: 90_000,
}, async () => {
  const manifest = await runVSCodeLiveAcceptance();

  assert.equal(manifest.status, 'passed', manifest.blockedReasons.join('; '));
  assert.equal(manifest.productReady, false);
  assert.deepEqual(manifest.primitiveChainObserved, ['bind', 'observe', 'act', 'act', 'act', 'observe', 'control(release)']);
  assert.ok(manifest.evidence.screenshotRefs.length >= 2);
  assert.ok(manifest.evidence.accessibilityRefs.length >= 2);
  assert.ok(manifest.evidence.textRefs.length >= 2);
  assert.ok(manifest.evidence.fileValidatorRefs.length >= 1);
  assert.ok(manifest.evidence.releaseRefs.some((ref) => ref.startsWith('scoped-input-lease:')));
  assert.ok(manifest.evidence.releaseRefs.some((ref) => ref.startsWith('input-adapter:')));
  assert.ok(manifest.evidence.releaseRefs.some((ref) => ref.startsWith('cursor-marker:')));
  assert.equal(manifest.verification.targetWindowStable, true);
  assert.equal(manifest.verification.sentinelVisibleInTextRefs, true);
  assert.equal(manifest.verification.beforeAfterScreenshotChanged, true);
  assert.equal(manifest.verification.fileContentMatched, true);
  assert.equal(manifest.verification.cleanupPassed, true);
  assert.equal(manifest.tempDirs.deletedAfterRun, true);
  assert.doesNotMatch(JSON.stringify(manifest), /sentinelText|rawScreenshot|base64|file:\/\/|\/tmp\//i);
});
