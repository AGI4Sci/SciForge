import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const projectRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(`${projectRoot}/package.json`, 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};
const projectBoard = readFileSync(`${projectRoot}/PROJECT.md`, 'utf8');
const contractDoc = readFileSync(`${projectRoot}/docs/DesktopNativeChangeVerificationContract.md`, 'utf8');

test('desktop native change verification contract is wired into package scripts and fast verification', () => {
  assert.equal(
    scripts['smoke:desktop-native-change-verification-contract'],
    'node --import tsx --test tests/smoke/smoke-desktop-native-change-verification-contract.test.ts',
  );
  assert.match(
    scripts['verify:fast'] ?? '',
    /npm run smoke:desktop-native-change-verification-contract\b/,
  );
});

test('desktop action, annotation, and browser native changes require real Desktop native path evidence', () => {
  for (const required of [
    'Browser native surface',
    'Annotation native bridge',
    'Window Action native path',
    'Image / Evidence native capture',
    'SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1',
    'SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON',
    'npm run smoke:desktop-browser-native-live-acceptance',
    'tests/smoke/smoke-desktop-annotation-overlay.test.ts',
    'tests/smoke/smoke-desktop-screen-region-overlay-bridge.test.ts',
    'tests/smoke/smoke-desktop-window-capture.test.ts',
    'src/runtime/window-action-session.test.ts',
    'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json',
  ]) {
    assert.match(contractDoc, escaped(required), `contract doc must include ${required}`);
  }
});

test('desktop native pass claims reject web screenshots and legacy browser substitutes', () => {
  for (const forbidden of [
    'web screenshot',
    'Vite screenshot',
    'Playwright page screenshot',
    'iframe',
    'proxy',
    'snapshot',
    'frame-stream',
    'external browser',
    'raw screenshot',
    'base64',
  ]) {
    assert.match(contractDoc, escaped(forbidden), `contract doc must explicitly reject ${forbidden}`);
  }

  assert.match(
    projectBoard,
    /Vite\/Web dev 下 Browser \/ Computer Use live action 只能显示 blocked\/diagnostic，不能冒充 Desktop native product pass。/,
  );
  assert.match(
    projectBoard,
    /Desktop smoke 使用 Electron native host 验证 BrowserHostSession、native surface、Computer Use preflight 和 hard-confirm surface；Vite 只作为 diagnostic。/,
  );
});

function escaped(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
