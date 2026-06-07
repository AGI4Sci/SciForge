import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import type { AppiumMac2WindowActionRequest } from './appium-mac2-window-action-adapter.js';
import { createTextEditSavedArtifactValidator } from './textedit-saved-artifact-validator.js';

test('TextEdit saved artifact validator reads the real file and returns only a bounded validation ref', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-textedit-validator-'));
  try {
    const artifactPath = join(dir, 'proof.txt');
    await writeFile(artifactPath, 'Draft report\n', 'utf8');
    const validator = createTextEditSavedArtifactValidator({ artifactPath });
    assert.ok(validator, 'validator should be created for an absolute artifact path');

    const ref = await validator({
      sourceXml: '<AXApplication><AXTextArea value="Draft report"/></AXApplication>',
      request: request(),
    });

    assert.equal(ref, 'appium-mac2:textedit/actions/action-1/artifact-validator/content-match');
    assert.doesNotMatch(ref, /\/tmp|Draft report|proof\.txt|secret|token|password|bearer/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TextEdit saved artifact validator fails closed on missing or mismatched artifact content without leaking details', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-textedit-validator-'));
  try {
    const artifactPath = join(dir, 'proof.txt');
    await writeFile(artifactPath, 'Different content\n', 'utf8');
    const validator = createTextEditSavedArtifactValidator({ artifactPath });
    assert.ok(validator);

    await assert.rejects(
      async () => validator({
        sourceXml: '<AXApplication><AXTextArea value="Draft report"/></AXApplication>',
        request: request(),
      }),
      (error: unknown) => {
        assert.match(error instanceof Error ? error.message : String(error), /TextEdit saved artifact validation failed/);
        assert.doesNotMatch(error instanceof Error ? error.message : String(error), /\/tmp|Draft report|Different content|proof\.txt/i);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TextEdit saved artifact validator is not created for unsafe path configuration', () => {
  assert.equal(createTextEditSavedArtifactValidator({ artifactPath: 'relative/proof.txt' }), undefined);
  assert.equal(createTextEditSavedArtifactValidator({ artifactPath: 'https://example.invalid/proof.txt' }), undefined);
  assert.equal(createTextEditSavedArtifactValidator({ artifactPath: '/tmp/secret-token-proof.txt' }), undefined);
});

function request(): AppiumMac2WindowActionRequest {
  return {
    serverUrl: 'http://127.0.0.1:4723',
    bundleId: 'com.apple.TextEdit',
    actionId: 'action-1',
    action: 'save',
    sessionId: 'textedit-main',
    targetWindowRef: 'window:textedit:main',
  };
}
