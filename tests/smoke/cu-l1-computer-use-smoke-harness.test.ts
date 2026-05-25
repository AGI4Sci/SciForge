import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildCuL1SmokeManifest,
  CU_L1_LOW_RISK_TARGET_REF,
  evaluateAntiShortcutGuard,
  writeCuL1SmokeManifest,
} from '../../tools/cu-l1-computer-use-smoke-harness.js';

const execFileAsync = promisify(execFile);

test('CU L1 harness records low-risk target and blocked manifest without real host chain', async () => {
  const targetHtml = await readFile(CU_L1_LOW_RISK_TARGET_REF, 'utf8');
  assert.match(targetHtml, /<input[^>]+id="cu-smoke-input"/);
  assert.match(targetHtml, /<button[^>]+id="cu-smoke-button"/);
  assert.match(targetHtml, /id="cu-smoke-result"/);
  assert.match(targetHtml, /Result text/);

  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l1-harness-'));
  try {
    const manifestPath = join(workspace, 'blocked-manifest.json');
    const manifest = await writeCuL1SmokeManifest(manifestPath, {
      runId: 'cu-l1-fixture-blocked',
      createdAt: '2026-05-25T00:00:00.000Z',
      screenshotRefs: {
        before: ['.sciforge/vision-runs/cu-l1-fixture/step-001-before.png'],
        after: ['.sciforge/vision-runs/cu-l1-fixture/step-001-after.png'],
      },
      traceRefs: ['.sciforge/vision-runs/cu-l1-fixture/vision-trace.json'],
    });

    assert.equal((await stat(manifestPath)).isFile(), true);
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.target.risk, 'low');
    assert.equal(manifest.target.surface, 'local-web-fixture');
    assert.deepEqual(manifest.target.requiredControls, {
      input: '#cu-smoke-input',
      button: '#cu-smoke-button',
      resultText: '#cu-smoke-result',
    });
    assert.deepEqual(manifest.screenshotRefs.before, ['.sciforge/vision-runs/cu-l1-fixture/step-001-before.png']);
    assert.deepEqual(manifest.screenshotRefs.after, ['.sciforge/vision-runs/cu-l1-fixture/step-001-after.png']);
    assert.deepEqual(manifest.traceRefs, ['.sciforge/vision-runs/cu-l1-fixture/vision-trace.json']);
    assert.equal(manifest.groundingMetadata.required, true);
    assert.equal(manifest.groundingMetadata.coordinateSpace, 'window-local');
    assert.ok(manifest.groundingMetadata.forbiddenSources.includes('dom-query'));
    assert.equal(manifest.executorLease.required, true);
    assert.equal(manifest.executorLease.status, 'missing');
    assert.equal(manifest.verifierVerdict.status, 'blocked');
    assert.equal(manifest.verifierVerdict.verdict, 'blocked-no-real-host-chain');
    assert.ok(manifest.hostChain.some((link) => link.kind === 'missing'));
    assert.ok(manifest.blockedItems.some((item) => item.id === 'CU-04-L1-real-input-smoke'));

    const written = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest;
    assert.equal(written.schemaVersion, 'sciforge.computer-use.l1-smoke-manifest.v1');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L1 anti-shortcut guard rejects DOM, Playwright, and accessibility evidence', () => {
  const guard = evaluateAntiShortcutGuard([
    { id: 'dom-result-text', kind: 'dom', ref: 'document.querySelector("#cu-smoke-result").textContent' },
    { id: 'playwright-fill', kind: 'playwright', ref: 'page.fill("#cu-smoke-input", "...")' },
    { id: 'ax-button', kind: 'accessibility', ref: 'AXButton:Write Result' },
    { id: 'trace', kind: 'real-computer-use', ref: '.sciforge/vision-runs/cu-l1/vision-trace.json' },
  ]);

  assert.equal(guard.status, 'failed');
  assert.deepEqual(
    guard.rejectedClaims.map((claim) => claim.kind),
    ['dom', 'playwright', 'accessibility'],
  );
});

test('CU L1 ready state still does not claim L1 success before verifier runs', () => {
  const manifest = buildCuL1SmokeManifest({
    runId: 'cu-l1-host-chain-ready',
    createdAt: '2026-05-25T00:00:00.000Z',
    hostChain: [
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: '.sciforge/vision-runs/cu-l1/request.json',
        hostPortsRef: '.sciforge/vision-runs/cu-l1/host-ports.json',
      },
      {
        id: 'shared-input-ack',
        kind: 'shared-input-ack',
        status: 'present',
        acknowledgementRef: '.sciforge/vision-runs/cu-l1/shared-input-ack.json',
      },
    ],
  });

  assert.equal(manifest.status, 'ready-for-real-executor');
  assert.equal(manifest.verifierVerdict.status, 'not-run');
  assert.equal(manifest.verifierVerdict.verdict, 'not-run');
  assert.deepEqual(manifest.blockedItems, []);
});

test('CU L1 manifest can record capability-smoke-passed only after real Computer Use verification evidence', () => {
  const manifest = buildCuL1SmokeManifest({
    runId: 'cu-l1-real-pass',
    createdAt: '2026-05-25T00:30:00.000Z',
    hostChain: [
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: '.sciforge/vision-runs/cu-l1-real/request.json',
        hostPortsRef: '.sciforge/vision-runs/cu-l1-real/host-ports.json',
      },
      {
        id: 'shared-input-ack',
        kind: 'shared-input-ack',
        status: 'present',
        acknowledgementRef: '.sciforge/vision-runs/cu-l1-real/shared-input-ack.json',
      },
    ],
    evidenceClaims: [
      {
        id: 'package-bridge-real-trace',
        kind: 'real-computer-use',
        ref: '.sciforge/vision-runs/cu-l1-real/vision-trace.json',
      },
    ],
    screenshotRefs: {
      before: ['.sciforge/vision-runs/cu-l1-real/step-001-before-window-1.png'],
      after: ['.sciforge/vision-runs/cu-l1-real/step-003-after-window-1.png'],
    },
    traceRefs: ['.sciforge/vision-runs/cu-l1-real/vision-trace.json'],
    verifierVerdict: {
      status: 'passed',
      verdict: 'result-text-visible',
      reason: 'Final screenshot shows the expected Result text for the low-risk local fixture.',
      resultTextRef: '.sciforge/vision-runs/cu-l1-real/result-text-verdict.json',
      finalScreenshotRef: '.sciforge/vision-runs/cu-l1-real/step-003-after-window-1.png',
    },
  });

  assert.equal(manifest.status, 'capability-smoke-passed');
  assert.equal(manifest.executorLease.status, 'present');
  assert.equal(manifest.verifierVerdict.status, 'passed');
  assert.equal(manifest.verifierVerdict.verdict, 'capability-smoke-passed');
  assert.deepEqual(manifest.blockedItems, []);
});

test('CU L1 CLI accepts host chain, screenshot, and trace refs as JSON input', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l1-cli-ready-'));
  try {
    const inputPath = join(workspace, 'input.json');
    const manifestPath = join(workspace, 'manifest.json');
    await writeFile(inputPath, JSON.stringify({
      runId: 'cu-l1-cli-host-chain-ready',
      createdAt: '2026-05-25T01:00:00.000Z',
      hostChain: [
        {
          id: 'tui-host-runTask',
          kind: 'tui-host-runTask',
          status: 'present',
          requestRef: '.sciforge/vision-runs/cu-l1-cli/request.json',
          hostPortsRef: '.sciforge/vision-runs/cu-l1-cli/host-ports.json',
        },
        {
          id: 'desktop-bridge-ack',
          kind: 'desktop-bridge-ack',
          status: 'present',
          acknowledgementRef: '.sciforge/vision-runs/cu-l1-cli/desktop-bridge-ack.json',
        },
      ],
      screenshotRefs: {
        before: ['.sciforge/vision-runs/cu-l1-cli/before.png'],
        after: ['.sciforge/vision-runs/cu-l1-cli/after.png'],
      },
      traceRefs: ['.sciforge/vision-runs/cu-l1-cli/vision-trace.json'],
    }, null, 2));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-l1-computer-use-smoke-harness.ts',
      '--out',
      manifestPath,
      '--input-json',
      inputPath,
    ]);

    assert.match(stdout, /\[ready-for-real-executor\]/);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.status, 'ready-for-real-executor');
    assert.equal(manifest.verifierVerdict.status, 'not-run');
    assert.equal(manifest.verifierVerdict.verdict, 'not-run');
    assert.deepEqual(manifest.screenshotRefs.before, ['.sciforge/vision-runs/cu-l1-cli/before.png']);
    assert.deepEqual(manifest.screenshotRefs.after, ['.sciforge/vision-runs/cu-l1-cli/after.png']);
    assert.deepEqual(manifest.traceRefs, ['.sciforge/vision-runs/cu-l1-cli/vision-trace.json']);
    assert.equal(JSON.stringify(manifest).includes('capability-smoke-passed'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L1 CLI records capability-smoke-passed when verifier evidence is present', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l1-cli-passed-'));
  try {
    const inputPath = join(workspace, 'input.json');
    const manifestPath = join(workspace, 'manifest.json');
    await writeFile(inputPath, JSON.stringify({
      runId: 'cu-l1-cli-real-pass',
      createdAt: '2026-05-25T01:15:00.000Z',
      hostChain: [
        {
          id: 'tui-host-runTask',
          kind: 'tui-host-runTask',
          status: 'present',
          requestRef: '.sciforge/vision-runs/cu-l1-cli-pass/request.json',
          hostPortsRef: '.sciforge/vision-runs/cu-l1-cli-pass/host-ports.json',
        },
        {
          id: 'shared-input-ack',
          kind: 'shared-input-ack',
          status: 'present',
          acknowledgementRef: '.sciforge/vision-runs/cu-l1-cli-pass/shared-input-ack.json',
        },
      ],
      evidenceClaims: [
        {
          id: 'package-bridge-real-trace',
          kind: 'real-computer-use',
          ref: '.sciforge/vision-runs/cu-l1-cli-pass/vision-trace.json',
        },
      ],
      screenshotRefs: {
        before: ['.sciforge/vision-runs/cu-l1-cli-pass/step-001-before-window-1.png'],
        after: ['.sciforge/vision-runs/cu-l1-cli-pass/step-003-after-window-1.png'],
      },
      traceRefs: ['.sciforge/vision-runs/cu-l1-cli-pass/vision-trace.json'],
      verifierVerdict: {
        status: 'passed',
        verdict: 'result-text-visible',
        reason: 'Final screenshot shows the expected Result text.',
        resultTextRef: '.sciforge/vision-runs/cu-l1-cli-pass/result-text-verdict.json',
        finalScreenshotRef: '.sciforge/vision-runs/cu-l1-cli-pass/step-003-after-window-1.png',
      },
    }, null, 2));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-l1-computer-use-smoke-harness.ts',
      '--out',
      manifestPath,
      '--input-json',
      inputPath,
    ]);

    assert.match(stdout, /\[capability-smoke-passed\]/);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.status, 'capability-smoke-passed');
    assert.equal(manifest.executorLease.status, 'present');
    assert.equal(manifest.verifierVerdict.status, 'passed');
    assert.equal(manifest.verifierVerdict.finalScreenshotRef, '.sciforge/vision-runs/cu-l1-cli-pass/step-003-after-window-1.png');
    assert.deepEqual(manifest.blockedItems, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L1 CLI keeps dry-run or shortcut evidence blocked instead of L1 success', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l1-cli-blocked-'));
  try {
    const inputPath = join(workspace, 'input.json');
    const manifestPath = join(workspace, 'manifest.json');
    await writeFile(inputPath, JSON.stringify({
      runId: 'cu-l1-cli-dry-run-blocked',
      createdAt: '2026-05-25T01:30:00.000Z',
      hostChain: [
        {
          id: 'package-bridge-dry-run',
          kind: 'missing',
          status: 'blocked',
          note: 'Package bridge dry-run trace exists, but no real executor lease or host input acknowledgement exists.',
        },
      ],
      evidenceClaims: [
        {
          id: 'package-bridge-dry-run-trace',
          kind: 'synthetic-fixture',
          ref: '.sciforge/vision-runs/cu-tui-extension-20260525-package-bridge-dryrun/vision-trace.json',
        },
        {
          id: 'playwright-result-check',
          kind: 'playwright',
          ref: 'page.locator("#cu-smoke-result")',
        },
      ],
      traceRefs: ['.sciforge/vision-runs/cu-tui-extension-20260525-package-bridge-dryrun/vision-trace.json'],
    }, null, 2));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-l1-computer-use-smoke-harness.ts',
      '--out',
      manifestPath,
      '--input-json',
      inputPath,
    ]);

    assert.match(stdout, /\[blocked\]/);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.antiShortcutGuard.status, 'failed');
    assert.deepEqual(manifest.antiShortcutGuard.rejectedClaims.map((claim: { kind: string }) => claim.kind), ['playwright']);
    assert.equal(manifest.executorLease.status, 'missing');
    assert.equal(manifest.verifierVerdict.status, 'blocked');
    assert.ok(manifest.nonSubstitutes.includes('dry-run traces without real host acknowledgement'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
