import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

type PackageJson = {
  scripts?: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as PackageJson;
const scripts = packageJson.scripts ?? {};

test('verify:fast stays limited to contract, security, no-hardcoded-success, and no-legacy-path gates', () => {
  const verifyFast = requiredScript('verify:fast');

  assertScriptRuns(scripts.verify, 'verify:fast');

  for (const target of [
    'smoke:final-shape-verify-guard',
    'smoke:runtime-contracts',
    'smoke:stable-runtime-contracts',
    'smoke:release-gate',
    'smoke:no-hardcoded-success',
    'smoke:module-boundaries',
    'smoke:fixed-platform-boundary',
    'smoke:no-src-capability-semantics',
    'smoke:no-legacy-paths',
    'smoke:runtime-codex-truth-source',
    'smoke:package-runtime-boundary',
  ]) {
    assertScriptRuns(verifyFast, target);
  }

  for (const forbidden of [
    'typecheck',
    'test',
    'smoke:all',
    'build',
    'smoke:build-budget',
    'smoke:long-file-budget',
    'smoke:browser',
    'smoke:runtime-codex-browser-acceptance:strict',
    'verify:browser:desktop-product-live',
    'verify:computer-use:desktop-product',
    'verify:computer-use:live',
    'verify:computer-use:release',
    'smoke:real-task-protocol-gates',
    'smoke:real-task-provider-security-gates',
    'smoke:desktop-native-change-verification-contract',
    'smoke:desktop-browser-native-live-acceptance',
    'smoke:desktop-browser-native-live-acceptance:strict',
    'smoke:desktop-computer-use-hard-confirm-product',
    'smoke:desktop-computer-use-hard-confirm-product:strict',
    'smoke:computer-use-chat-live-preflight:strict',
    'smoke:computer-use-chat-live-e2e:opt-in',
    'smoke:computer-use-chat-live-e2e:product-strict',
    'smoke:computer-use-chat-live-complex-matrix:opt-in',
    'smoke:computer-use-chat-live-complex-matrix:opt-in-isolated',
    'smoke:computer-use-product-path',
    'smoke:real-task-matrix',
    'packages:check',
    'desktop:package:dir',
    'artifacts:index',
  ]) {
    assertScriptDoesNotRun(verifyFast, forbidden);
  }
});

test('Desktop product gates require Electron native host instead of Web or Vite diagnostics', () => {
  const browserDesktopProductLive = requiredScript('verify:browser:desktop-product-live');
  const computerUseDesktopProduct = requiredScript('verify:computer-use:desktop-product');
  const computerUseProductStrict = requiredScript('smoke:computer-use-chat-live-e2e:product-strict');

  assertScriptRuns(browserDesktopProductLive, 'smoke:desktop-browser-native-live-acceptance:strict');
  assertScriptRuns(computerUseDesktopProduct, 'smoke:desktop-computer-use-hard-confirm-product:strict');
  assertScriptRuns(computerUseDesktopProduct, 'smoke:computer-use-chat-live-e2e:product-strict');
  assertScriptDoesNotRun(browserDesktopProductLive, 'smoke:runtime-codex-browser-acceptance:strict');
  assertScriptDoesNotRun(computerUseDesktopProduct, 'smoke:runtime-codex-browser-acceptance:strict');
  assertScriptDoesNotRun(computerUseDesktopProduct, 'smoke:computer-use-chat-live-e2e:opt-in');

  const desktopBrowserStrictRunner = readFileSync(
    join(process.cwd(), 'tools', 'desktop-browser-native-live-acceptance-strict-runner.ts'),
    'utf8',
  );
  assert.match(desktopBrowserStrictRunner, /SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE:\s*'1'/);
  assert.match(desktopBrowserStrictRunner, /delete env\.SCIFORGE_DESKTOP_RENDERER_URL/);
  assert.match(desktopBrowserStrictRunner, /delete env\.SCIFORGE_DESKTOP_DEV/);
  assert.match(
    requiredScript('smoke:desktop-browser-native-live-acceptance:strict'),
    /tools\/desktop-browser-native-live-acceptance-strict-runner\.ts/,
  );
  assert.match(
    requiredScript('smoke:desktop-computer-use-hard-confirm-product:strict'),
    /SCIFORGE_DESKTOP_COMPUTER_USE_HARD_CONFIRM_PRODUCT_EXECUTE_REAL=1/,
  );
  assert.match(computerUseProductStrict, /--product-strict\b/);
  assert.match(computerUseProductStrict, /--strict\b/);
  assert.doesNotMatch(computerUseProductStrict, /\b(vite|dev:ui|runtime-codex-browser-acceptance)\b/);
});

test('Browser live and Computer Use live gates run separately before the combined release gate', () => {
  const computerUseLive = requiredScript('verify:computer-use:live');
  const complexLiveOptIn = requiredScript('verify:computer-use:complex-live:opt-in');
  const combinedRelease = requiredScript('verify:computer-use:release');
  const isolatedComplexMatrix = requiredScript('smoke:computer-use-chat-live-complex-matrix:opt-in-isolated');

  assertScriptRuns(computerUseLive, 'smoke:computer-use-chat-live-preflight:strict');
  assertScriptRuns(computerUseLive, 'smoke:computer-use-chat-live-e2e:opt-in');

  assertScriptRuns(complexLiveOptIn, 'smoke:computer-use-chat-live-complex-matrix:opt-in-isolated');
  assertScriptRuns(complexLiveOptIn, 'release:computer-use-chat-live-complex-matrix-report');
  assert.match(isolatedComplexMatrix, /--case-isolation\s+per-case-workspace-fork\b/);
  assert.match(isolatedComplexMatrix, /--workspace\s+["']?\$PWD["']?\b/);

  assertScriptRuns(combinedRelease, 'verify:browser:desktop-product-live');
  assertScriptRuns(combinedRelease, 'verify:computer-use:desktop-product');
  assertScriptRuns(combinedRelease, 'verify:computer-use:live');
  assertOrdered(
    combinedRelease,
    ['verify:browser:desktop-product-live', 'verify:computer-use:desktop-product', 'verify:computer-use:live'],
  );
  assertScriptDoesNotRun(combinedRelease, 'verify:computer-use:complex-live:opt-in');

  for (const defaultGate of [
    scripts.verify,
    scripts['verify:fast'],
    scripts['verify:full'],
  ]) {
    assertScriptDoesNotRun(defaultGate ?? '', 'verify:computer-use:complex-live:opt-in');
    assertScriptDoesNotRun(defaultGate ?? '', 'smoke:computer-use-chat-live-complex-matrix:opt-in-isolated');
  }
});

test('Computer Use chat live business tools stay below the split threshold', () => {
  for (const file of [
    join(process.cwd(), 'tools', 'computer-use-chat-live-e2e.ts'),
    join(process.cwd(), 'tools', 'computer-use-chat-live-complex-matrix.ts'),
  ]) {
    const lineCount = readFileSync(file, 'utf8').split('\n').length;
    assert.ok(lineCount <= 2_000, `${file} has ${lineCount} lines; split business code above 2000 lines`);
  }
});

function requiredScript(name: string): string {
  const script = scripts[name];
  assert.ok(script, `package.json must define ${name}`);
  return script;
}

function assertScriptRuns(script: string | undefined, target: string) {
  assert.match(script ?? '', runPattern(target), `script must run npm run ${target}`);
}

function assertScriptDoesNotRun(script: string | undefined, target: string) {
  assert.doesNotMatch(script ?? '', runPattern(target), `script must not run npm run ${target}`);
}

function assertOrdered(script: string, targets: readonly string[]) {
  let previousIndex = -1;
  for (const target of targets) {
    const index = script.indexOf(`npm run ${target}`);
    assert.ok(index > previousIndex, `npm run ${target} must come after the previous release gate step`);
    previousIndex = index;
  }
}

function runPattern(target: string): RegExp {
  return new RegExp(`(?:^|&&)\\s*npm\\s+run\\s+${escapeRegExp(target)}(?:\\s|&&|$)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
