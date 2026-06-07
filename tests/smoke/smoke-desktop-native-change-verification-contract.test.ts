import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const projectRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(`${projectRoot}/package.json`, 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};
const projectBoard = readFileSync(`${projectRoot}/PROJECT.md`, 'utf8');
const computerUseDoc = readFileSync(`${projectRoot}/docs/ComputerUseRuntimeArchitecture.md`, 'utf8');
const browserDoc = readFileSync(`${projectRoot}/docs/BrowserRuntimeArchitecture.md`, 'utf8');

test('desktop native change verification standalone doc is retired', () => {
  assert.equal(
    existsSync(`${projectRoot}/docs/DesktopNativeChangeVerificationContract.md`),
    false,
    'Desktop native verification should no longer be a standalone docs/ feature document.',
  );
});

test('desktop native change verification smoke remains callable as a focused guard', () => {
  assert.equal(
    scripts['smoke:desktop-native-change-verification-contract'],
    'node --import tsx --test tests/smoke/smoke-desktop-native-change-verification-contract.test.ts',
  );
});

test('desktop action and browser evidence boundaries are covered by feature-owned docs', () => {
  for (const required of [
    'WindowActionSession',
    'scoped input lease',
    'before observation ref',
    'executor event ref',
    'after observation ref',
    'stale invalidation refs',
  ]) {
    assert.match(computerUseDoc, escaped(required), `Computer Use doc must include ${required}`);
  }

  for (const required of [
    'BrowserHostSession',
    'session / navigation refs',
    'frame / screenshot / DOM / AX refs',
    'download artifact refs',
  ]) {
    assert.match(browserDoc, escaped(required), `Browser doc must include ${required}`);
  }
});

test('desktop native pass claims still require current-run evidence in project boundary', () => {
  assert.match(
    projectBoard,
    /Contract test、module operation test、fixture、package probe、legacy diagnostic、GUI projection、手动脚本或局部 smoke 通过，不能单独打 `\[x\]`。/,
  );
  assert.match(
    projectBoard,
    /缺 native host、target binding、fresh evidence、permission refs、scoped executor 或 stop \/ cancel path 时，必须 blocked，并说明恢复路径。/,
  );
});

function escaped(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
