import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA,
  runDesktopComputerUseHardConfirmProductSmoke,
  validateDesktopComputerUseHardConfirmProductSmokeManifest,
  type DesktopComputerUseHardConfirmProductRunEvidence,
} from '../../tools/desktop-computer-use-hard-confirm-product-smoke-runner.js';

test('desktop Computer Use hard-confirm product smoke script is wired as diagnostic-by-default', () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const script = packageJson.scripts?.['smoke:desktop-computer-use-hard-confirm-product'];
  const strictScript = packageJson.scripts?.['smoke:desktop-computer-use-hard-confirm-product:strict'];

  assert.equal(script, 'node --import tsx tools/desktop-computer-use-hard-confirm-product-smoke-runner.ts');
  assert.equal(strictScript, 'SCIFORGE_DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_EXECUTE_REAL=1 npm run smoke:desktop-computer-use-hard-confirm-product');
  assert.doesNotMatch(script ?? '', /SCIFORGE_DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_EXECUTE_REAL=1/);
});

test('desktop Computer Use hard-confirm product smoke routes dummy member provider only through Model Router env', () => {
  const source = readFileSync(join(process.cwd(), 'tools', 'desktop-computer-use-hard-confirm-product-smoke-runner.ts'), 'utf8');

  assert.doesNotMatch(source, /SCIFORGE_PROXY_(?:UPSTREAM_BASE_URL|API_KEY_ENV|DEFAULT_MODEL|QUIET)/);
  assert.match(source, /SCIFORGE_TEXT_BASE_URL/);
  assert.match(source, /SCIFORGE_TEXT_API_KEY_ENV/);
  assert.match(source, /SCIFORGE_TEXT_MODEL/);
  assert.match(source, /SCIFORGE_RUNTIME_API_KEY/);
  assert.match(source, /SCIFORGE_RUNTIME_MODEL/);
  assert.match(source, /SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS/);
});

test('desktop Computer Use hard-confirm product smoke writes blocked diagnostic evidence by default', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-cu-hard-confirm-'));
  const outputPath = join(tmp, 'manifest.json');

  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    outputPath,
    executeRealProduct: false,
    now: '2026-06-06T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8'));
  const validation = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest);

  assert.deepEqual(written, manifest);
  assert.equal(manifest.schemaVersion, DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_SMOKE_SCHEMA);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.claimScope, 'blocked-or-diagnostic');
  assert.equal(manifest.realProductRun.status, 'not-run');
  assert.equal(manifest.externalSideEffects, 'not-executed');
  assert.deepEqual(manifest.productRequirements.required, [
    'electron-product-shell',
    'electron-dynamic-workspace-writer',
    'electron-native-host',
    'runtime-codex-transport',
    'computer-use-guard-or-preflight-surface',
    'computer-use-hard-confirm-surface',
  ]);
  assert.deepEqual(manifest.productRequirements.observed, []);
  assert.ok(manifest.blockers.includes('electron-product-smoke-opt-in-required'));
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('electron-product-smoke-opt-in-required'));
  assert.ok(validation.blockReasons.includes('real-electron-product-run-required'));
  assert.ok(validation.blockReasons.includes('electron-dynamic-workspace-writer-required'));
});

test('desktop Computer Use hard-confirm product smoke consumes trusted opt-in executor evidence', async () => {
  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    executeRealProduct: true,
    now: '2026-06-06T00:00:00.000Z',
    realProductExecutor: async () => trustedProductEvidence(),
  });
  const validation = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest);

  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.passClaim, true);
  assert.equal(manifest.claimScope, 'electron-product-computer-use-hard-confirm');
  assert.equal(manifest.realProductRun.status, 'executed');
  assert.equal(manifest.externalSideEffects, 'not-executed');
  assert.deepEqual(manifest.productRequirements.observed, manifest.productRequirements.required);
  assert.deepEqual(manifest.surfaceEvidence.guardOrPreflight.controls, ['blocked-diagnostic', 'recovery-action']);
  assert.deepEqual(manifest.surfaceEvidence.hardConfirm.controls, ['Confirm', 'Cancel']);
  assert.equal(validation.canClaimPass, true);
  assert.deepEqual(validation.blockReasons, []);
});

test('desktop Computer Use hard-confirm product smoke requires dynamic Workspace Writer evidence for pass', async () => {
  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    executeRealProduct: true,
    now: '2026-06-06T00:00:00.000Z',
    realProductExecutor: async () => trustedProductEvidence({
      observedRequirements: [
        'electron-product-shell',
        'electron-native-host',
        'runtime-codex-transport',
        'computer-use-guard-or-preflight-surface',
        'computer-use-hard-confirm-surface',
      ],
    }),
  });
  const validation = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest);

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.ok(validation.blockReasons.includes('electron-dynamic-workspace-writer-required' as never));
});

test('desktop Computer Use hard-confirm product smoke ignores executor unless explicitly opted in', async () => {
  let executorCalled = false;

  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    executeRealProduct: false,
    now: '2026-06-06T00:00:00.000Z',
    realProductExecutor: async () => {
      executorCalled = true;
      return trustedProductEvidence();
    },
  });

  assert.equal(executorCalled, false);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.realProductRun.status, 'not-run');
  assert.ok(validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest).blockReasons.includes('electron-product-smoke-opt-in-required'));
});

test('desktop Computer Use hard-confirm product smoke rejects caller-supplied forged pass evidence', async () => {
  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    executeRealProduct: true,
    now: '2026-06-06T00:00:00.000Z',
    realProductEvidence: trustedProductEvidence(),
  });
  const validation = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest);

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.realProductRun.status, 'not-run');
  assert.ok(validation.blockReasons.includes('trusted-in-process-electron-runner-required'));
});

test('desktop Computer Use hard-confirm product smoke records bounded strict executor blockers', async () => {
  const manifest = await runDesktopComputerUseHardConfirmProductSmoke({
    executeRealProduct: true,
    now: '2026-06-06T00:00:00.000Z',
    realProductExecutor: async () => {
      throw new Error('Hard-confirm surface did not expose Confirm/Cancel controls with sk-secret-test-token');
    },
  });
  const validation = validateDesktopComputerUseHardConfirmProductSmokeManifest(manifest, { executeRealProduct: true });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.match(manifest.realProductRun.blockedReason ?? '', /Hard-confirm surface did not expose Confirm\/Cancel controls/);
  assert.doesNotMatch(manifest.realProductRun.blockedReason ?? '', /sk-secret-test-token/);
  assert.ok(validation.blockReasons.includes('strict-product-executor-blocked' as never));
});

function trustedProductEvidence(
  overrides: Partial<DesktopComputerUseHardConfirmProductRunEvidence> = {},
): DesktopComputerUseHardConfirmProductRunEvidence {
  return {
    status: 'executed',
    runRef: 'desktop-cu-hard-confirm-product-run:2026-06-06T00-00-00Z',
    auditRefs: [
      'electron-product-shell:loaded-dist-ui',
      'electron-native-host:sciforgeDesktop',
      'runtime-codex-transport:stream',
      'computer-use-guard:blocked-preflight-surface',
      'computer-use-hard-confirm:confirm-cancel-surface',
    ],
    observedRequirements: [
      'electron-product-shell',
      'electron-dynamic-workspace-writer',
      'electron-native-host',
      'runtime-codex-transport',
      'computer-use-guard-or-preflight-surface',
      'computer-use-hard-confirm-surface',
    ],
    surfaceEvidence: {
      guardOrPreflight: {
        status: 'surfaced',
        surface: 'chat-or-runtime-codex-stream',
        textRef: 'runtime-codex-transport:guard-blocked-text',
        controls: ['blocked-diagnostic', 'recovery-action'],
      },
      hardConfirm: {
        status: 'surfaced',
        surface: 'chat-or-runtime-codex-stream',
        textRef: 'runtime-codex-transport:hard-confirm-text',
        controls: ['Confirm', 'Cancel'],
      },
    },
    ...overrides,
  };
}
