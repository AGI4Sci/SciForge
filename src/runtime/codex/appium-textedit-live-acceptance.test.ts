import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAppiumTextEditLiveAcceptance } from './appium-textedit-live-acceptance.js';
import type { AppiumMac2WindowActionClient } from './appium-mac2-window-action-adapter.js';

test('Appium TextEdit live acceptance writes blocked manifest with exact readiness gaps when not opted in', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-appium-textedit-live-'));
  try {
    const manifest = await runAppiumTextEditLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {},
      now: () => new Date('2026-06-07T01:02:03.000Z'),
    });
    const manifestText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.forbiddenSubstitutes.workspaceWriter, false);
    assert.equal(manifest.forbiddenSubstitutes.fixtures, false);
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_T1_APPIUM_TEXTEDIT_LIVE'));
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_APPIUM_MAC2_SERVER_URL'));
    assert.ok(manifest.blockedReasons.includes('missing-env:SCIFORGE_T1_TEXTEDIT_ARTIFACT_PATH'));
    assert.doesNotMatch(manifestText, /secret|token|bearer|api[-_]?key/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Appium TextEdit live acceptance can only pass through scoped Appium type/save and artifact verification', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-appium-textedit-live-'));
  try {
    const artifactPath = join(workspace, 'textedit-proof.txt');
    const text = 'T1 acceptance proof from scoped Appium TextEdit';
    const calls: string[] = [];
    const client: AppiumMac2WindowActionClient = async (request) => {
      calls.push(request.action);
      if (request.action === 'type') {
        return {
          executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/webdriver-session`,
          inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/type-input`,
          verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
          afterEvidenceRef: `appium-mac2:textedit/actions/${request.actionId}/after-source`,
          freshnessInvalidationRef: `window-action-session:${request.sessionId}/actions/${request.actionId}/freshness-invalidation.json`,
        };
      }
      await writeFile(artifactPath, `${text}\n`, 'utf8');
      return {
        executorEventRef: `appium-mac2:textedit/actions/${request.actionId}/webdriver-session`,
        inputEventRef: `appium-mac2:textedit/actions/${request.actionId}/save-input`,
        verifierRef: `appium-mac2:textedit/actions/${request.actionId}/verification/source-read`,
        afterEvidenceRef: `appium-mac2:textedit/actions/${request.actionId}/after-source`,
        artifactValidatorRef: `appium-mac2:textedit/actions/${request.actionId}/artifact-validator/content-match`,
        freshnessInvalidationRef: `window-action-session:${request.sessionId}/actions/${request.actionId}/freshness-invalidation.json`,
      };
    };

    const manifest = await runAppiumTextEditLiveAcceptance({
      workspacePath: workspace,
      outputDir: join(workspace, 'out'),
      env: {
        SCIFORGE_T1_APPIUM_TEXTEDIT_LIVE: '1',
        SCIFORGE_APPIUM_MAC2_SERVER_URL: 'http://127.0.0.1:4723',
        SCIFORGE_T1_TEXTEDIT_ARTIFACT_PATH: artifactPath,
      },
      artifactPath,
      serverUrl: 'http://127.0.0.1:4723',
      text,
      client,
      now: () => new Date('2026-06-07T01:02:03.000Z'),
    });

    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.passClaim, true);
    const manifestText = await readFile(join(workspace, 'out', 'manifest.json'), 'utf8');
    assert.doesNotMatch(manifestText, /textedit-proof\.txt|\/tmp|http:\/\/|workspace-file-writer|shared-system-input|osascript|CGEvent|base64|secret|token/i);
    assert.deepEqual(calls, ['type', 'save']);
    assert.deepEqual(manifest.scopedExecutor.routeAdapters, ['appium-mac2', 'appium-mac2']);
    assert.equal(manifest.actions[0]?.status, 'completed');
    assert.equal(manifest.actions[1]?.status, 'completed');
    assert.ok(manifest.actions[1]?.artifactValidatorRefs.some((ref) => /artifact-validator\/content-match/.test(ref)));
    assert.equal(manifest.artifactVerification.status, 'passed');
    assert.equal(manifest.artifactVerification.contentContainsExpectedText, true);
    assert.equal(manifest.desktopSoftwareTaskEvidence.status, 'passed');
    assert.deepEqual(manifest.desktopSoftwareTaskEvidence.missing, []);
    assert.match(manifest.finalAnswerRef ?? '', /^window-action-session:t1-textedit-live\/final-answer/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
