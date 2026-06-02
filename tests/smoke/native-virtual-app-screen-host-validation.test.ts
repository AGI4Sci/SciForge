import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildNativeHostContractRun,
  runNativeVirtualAppScreenHostValidation,
  type NativeVirtualAppScreenHostValidationProfile,
} from '../../tools/check-native-virtual-app-screen-host-validation.js';
import { validateNativeHostEvidenceLedger } from '../../packages/actions/computer-use/virtual-app-screen-host/src/index.js';

const execFileAsync = promisify(execFile);

test('Native VirtualAppScreen Host validation covers manifest/API, ownership, readiness, and ledger false-pass guards', async () => {
  const summary = await runNativeVirtualAppScreenHostValidation('all');

  assert.equal(summary.status, 'passed', summary.issues.join('\n'));
  assert.deepEqual(summary.checks, [
    'manifest-api',
    'ownership-map',
    'provider-readiness',
    'contract-ledger',
    'permission-ledger',
    'ui-only-negative',
    'fixture-only-negative',
    'missing-frame-negative',
    'unverified-grant-negative',
  ]);
});

test('Native Host contract ledger passes only after frame, input, automation, and grant validation evidence', () => {
  const { ledger } = buildNativeHostContractRun();
  const validation = validateNativeHostEvidenceLedger(ledger, {
    requireFrame: true,
    requireHumanInput: true,
    requireAutomationBarrier: true,
    requireGrantValidation: true,
  });

  assert.equal(validation.ok, true, validation.issues.join('\n'));
  assert.deepEqual(ledger.entries.map((entry) => entry.type), [
    'session.created',
    'app.launched',
    'surface.attached',
    'grant.validated',
    'frame.read',
    'human-input.accepted',
    'frame.read',
    'automation.barrier-completed',
  ]);
  assert.ok(ledger.currentRunPointerRef);
  assert.equal(ledger.headSha256, ledger.entries.at(-1)?.sha256);
});

test('Native Host validation profiles map PROJECT_CU smoke entrypoints to targeted checks', async () => {
  const expectedChecks: Record<NativeVirtualAppScreenHostValidationProfile, string[]> = {
    all: [
      'manifest-api',
      'ownership-map',
      'provider-readiness',
      'contract-ledger',
      'permission-ledger',
      'ui-only-negative',
      'fixture-only-negative',
      'missing-frame-negative',
      'unverified-grant-negative',
    ],
    'manifest-api': ['manifest-api', 'ownership-map'],
    viewer: ['manifest-api', 'ownership-map', 'contract-ledger', 'permission-ledger', 'ui-only-negative', 'missing-frame-negative', 'unverified-grant-negative'],
    fixtures: ['manifest-api', 'fixture-only-negative'],
    'provider-readiness': ['manifest-api', 'provider-readiness', 'contract-ledger', 'permission-ledger'],
    'user-acceptance': ['manifest-api', 'contract-ledger', 'permission-ledger', 'ui-only-negative', 'fixture-only-negative', 'missing-frame-negative', 'unverified-grant-negative'],
  };

  for (const [profile, checks] of Object.entries(expectedChecks) as Array<[NativeVirtualAppScreenHostValidationProfile, string[]]>) {
    const summary = await runNativeVirtualAppScreenHostValidation(profile);
    assert.equal(summary.status, 'passed', `${profile}: ${summary.issues.join('\n')}`);
    assert.deepEqual(summary.checks, checks, profile);
  }
});

test('Native Host validation CLI reports profile-specific pass status', async () => {
  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/check-native-virtual-app-screen-host-validation.ts',
    '--profile',
    'viewer',
  ]);

  assert.match(stdout, /^\[passed\] Native VirtualAppScreen Host validation profile=viewer/);
  assert.match(stdout, /ui-only-negative/);
  assert.match(stdout, /missing-frame-negative/);
  assert.match(stdout, /unverified-grant-negative/);
});
