import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nativeDefaultChatPositiveFixture,
  rejectedBrowserAcceptanceFixtureFiles,
  type RuntimeCodexBrowserAcceptanceFixtureContext,
  writeRuntimeCodexBrowserAcceptanceFixtures,
} from './runtime-codex-browser-acceptance-fixtures.js';

type RuntimeCodexBrowserAcceptanceNegativeFixtureOptions<Manifest> = RuntimeCodexBrowserAcceptanceFixtureContext & {
  assertBrowserAcceptanceManifest: (manifest: Manifest) => void;
  instanceId: string;
};

export function assertRuntimeCodexBrowserAcceptanceNegativeFixtures<Manifest>(
  options: RuntimeCodexBrowserAcceptanceNegativeFixtureOptions<Manifest>,
): void {
  const { assertBrowserAcceptanceManifest, instanceId, ...context } = options;
  const fixtureDir = mkdtempSync(join(tmpdir(), `sciforge-${instanceId}-negative-manifest-validator-`));
  writeRuntimeCodexBrowserAcceptanceFixtures(fixtureDir, context);
  const nativeOnly = JSON.parse(readFileSync(join(fixtureDir, nativeDefaultChatPositiveFixture), 'utf8')) as Manifest;
  assertBrowserAcceptanceManifest(nativeOnly);
  for (const fixture of rejectedBrowserAcceptanceFixtureFiles) {
    const manifest = JSON.parse(readFileSync(join(fixtureDir, fixture), 'utf8')) as Manifest;
    let rejected = false;
    try {
      assertBrowserAcceptanceManifest(manifest);
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, `negative fixture must be rejected: ${fixture}`);
  }
}
