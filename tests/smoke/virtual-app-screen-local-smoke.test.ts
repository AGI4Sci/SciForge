import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildVirtualAppScreenLocalSmokeBundle,
  writeVirtualAppScreenLocalSmokeBundle,
} from '../../tools/computer-use-next/virtual-app-screen-local-smoke.js';

const execFileAsync = promisify(execFile);

test('VirtualAppScreen local smoke defaults to blocked diagnostic instead of claiming acceptance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-local-smoke-'));
  try {
    const bundle = await writeVirtualAppScreenLocalSmokeBundle(workspace, {
      runId: 'default-local-smoke',
    });
    const manifest = JSON.parse(
      await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const diagnostic = JSON.parse(await readFile(join(workspace, 'blocked-diagnostic.json'), 'utf8')) as Record<string, unknown>;

    assert.equal(bundle.taskId, 'P2-CU-UA-OPERABILITY');
    assert.equal(bundle.mode, 'diagnostic');
    assert.equal(bundle.appSessionAttach.status, 'blocked');
    assert.equal(bundle.blockedDiagnostic?.category, 'adapter-unavailable');
    assert.match(String(bundle.blockedDiagnostic?.blockedReason), /No real background VirtualAppScreen adapter/);
    assert.match(String(bundle.blockedDiagnostic?.blockedReason), /cannot claim user-level acceptance/);
    assert.equal(bundle.manifest.status, 'blocked');
    assert.equal(bundle.manifest.diagnosticOnly, true);
    assert.equal(bundle.manifest.userAcceptanceEligible, false);
    assert.equal(manifest.userAcceptanceEligible, false);
    assert.equal(diagnostic.userAcceptanceEligible, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('VirtualAppScreen local smoke distinguishes missing adapter from missing permission', () => {
  const missingAdapter = buildVirtualAppScreenLocalSmokeBundle({
    runId: 'missing-adapter',
    mode: 'diagnostic',
  });

  assert.equal(missingAdapter.blockedDiagnostic?.category, 'adapter-unavailable');
  assert.equal(missingAdapter.manifest.userAcceptanceEligible, false);
  assert.equal(missingAdapter.manifest.adapterReadinessRecords[0]?.captureSupported, false);
  assert.equal(missingAdapter.manifest.adapterReadinessRecords[0]?.blockedReason, missingAdapter.blockedDiagnostic?.blockedReason);
  assert.ok(missingAdapter.manifest.validation.issues.some((issue) => issue.includes('captureSupported must be true')));

  const missingPermission = buildVirtualAppScreenLocalSmokeBundle({
    runId: 'missing-permission',
    mode: 'diagnostic',
    adapterAvailable: true,
    permissionGranted: false,
  });

  assert.equal(missingPermission.blockedDiagnostic?.category, 'permission-missing');
  assert.equal(missingPermission.sessionPermission.status, 'missing');
  assert.equal(missingPermission.sessionPermission.allowBackgroundAppControl, false);
  assert.match(String(missingPermission.manifest.blockedReason), /permission is missing/);
  assert.equal(missingPermission.manifest.userAcceptanceEligible, false);
  assert.equal(missingPermission.manifest.adapterReadinessRecords[0]?.blockedReason, missingPermission.blockedDiagnostic?.blockedReason);
});

test('VirtualAppScreen local smoke contract real-evidence mode remains blocked without real Host opt-in evidence', () => {
  const complete = buildVirtualAppScreenLocalSmokeBundle({
    runId: 'complete-real-evidence',
    mode: 'real-evidence',
  });

  assert.equal(complete.blockedDiagnostic?.category, 'real-evidence-incomplete');
  assert.equal(complete.appSessionAttach.status, 'blocked');
  assert.equal(complete.manifest.status, 'blocked');
  assert.equal(complete.manifest.diagnosticOnly, false);
  assert.equal(complete.manifest.userAcceptanceEligible, false);
  assert.deepEqual(complete.manifest.validation.missingRefs, []);
  assert.ok(complete.manifest.validation.issues.some((issue) => issue.includes('real VirtualAppScreen action-causality evidence is required')));
  assert.deepEqual(complete.refsFirstFlow.beforeAfterFrameRefs, [complete.refs.beforeAfterRef]);
  assert.deepEqual(complete.refsFirstFlow.guiPresentRefs, [complete.refs.guiPresentRef]);

  const incomplete = buildVirtualAppScreenLocalSmokeBundle({
    runId: 'incomplete-real-evidence',
    mode: 'real-evidence',
    includeBeforeAfter: false,
  });

  assert.equal(incomplete.blockedDiagnostic?.category, 'real-evidence-incomplete');
  assert.equal(incomplete.appSessionAttach.status, 'blocked');
  assert.equal(incomplete.manifest.status, 'blocked');
  assert.equal(incomplete.manifest.userAcceptanceEligible, false);
  assert.ok(incomplete.manifest.validation.missingRefs.includes('beforeAfterFrameRefs'));
  assert.ok(incomplete.manifest.validation.missingRefs.includes('verificationRefs'));
});

test('VirtualAppScreen local smoke rejects shell-only artifact writes in real-evidence mode', () => {
  const bundle = buildVirtualAppScreenLocalSmokeBundle({
    runId: 'shell-only-local-smoke',
    mode: 'real-evidence',
    shellDirectArtifactWrite: true,
  });

  assert.equal(bundle.blockedDiagnostic?.category, 'shell-only-rejected');
  assert.equal(bundle.firstScenario.artifact.shellDirectArtifactWrite, true);
  assert.equal(bundle.firstScenario.artifactValidation.ok, false);
  assert.equal(bundle.manifest.status, 'blocked');
  assert.equal(bundle.manifest.userAcceptanceEligible, false);
  assert.deepEqual(bundle.manifest.validation.rejectedClaimKinds, ['shell-direct-artifact']);
  assert.match(String(bundle.manifest.blockedReason), /shell direct artifact writes/);
});

test('VirtualAppScreen local smoke CLI writes clear blocked output by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-local-smoke-cli-'));
  try {
    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'tools/computer-use-next/virtual-app-screen-local-smoke.ts',
      '--out-dir',
      workspace,
      '--run-id',
      'cli-default-local-smoke',
    ]);
    const manifest = JSON.parse(
      await readFile(join(workspace, 'virtual-app-screen-user-acceptance-manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const diagnostic = JSON.parse(await readFile(join(workspace, 'blocked-diagnostic.json'), 'utf8')) as Record<string, unknown>;

    assert.match(stdout, /\[blocked\] wrote sciforge\.computer-use\.virtual-app-screen-local-smoke\.v1/);
    assert.match(stdout, /userAcceptanceEligible=false/);
    assert.match(stdout, /No real background VirtualAppScreen adapter/);
    assert.equal(manifest.userAcceptanceEligible, false);
    assert.equal(manifest.diagnosticOnly, true);
    assert.equal(diagnostic.category, 'adapter-unavailable');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
