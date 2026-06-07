import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  runRuntimeCodexBrowserOrdinaryChatLocalDogfood,
  RUNTIME_CODEX_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_SCHEMA_VERSION,
} from '../../src/runtime/runtime-codex-browser-ordinary-chat-local-dogfood.js';
import type { RuntimeCodexBrowserOrdinaryChatAcceptanceOptions } from '../../src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.js';

test('Runtime Codex browser ordinary-chat local dogfood wraps the acceptance writer without leaking local config', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-local-'));
  const configPath = join(workspace, 'config.local.json');
  const outputDir = join(workspace, 'out');
  const secret = 'LOCAL_ORDINARY_CHAT_SECRET_SHOULD_NOT_LEAK';
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: secret,
      model: 'local-model',
    },
  }), 'utf8');
  const calls: RuntimeCodexBrowserOrdinaryChatAcceptanceOptions[] = [];

  try {
    const manifest = await runRuntimeCodexBrowserOrdinaryChatLocalDogfood({
      workspacePath: workspace,
      configPath,
      outputDir,
      commandText: '请打开 OpenAI 官方 changelog 并总结最近更新。',
      now: () => new Date('2026-06-07T00:00:00.000Z'),
      writer: async (options) => {
        calls.push(options);
        return {
          schemaVersion: 'sciforge.runtime-codex.browser-acceptance.v1',
          status: 'passed',
          source: 'codex-in-app-browser',
          observedAt: '2026-06-07T00:00:01.000Z',
          commandId: options.commandId,
          startedFromDefaultChatEntry: true,
          submittedThroughRuntimeCodex: true,
          providerModelProfileVisible: true,
          workspaceVisible: true,
          commandIdVisible: true,
          mainAnswerVisible: true,
          rawAuditFoldedByDefault: true,
          automationSubstituteUsed: false,
          seedDemoFixtureEvidenceUsed: false,
          acceptanceConclusionFromRealBrowser: true,
          seedOrDemoMessagesExcluded: true,
          liveAcceptanceScope: 'non-seed-runtime-codex-messages-only',
          releaseBlocking: false,
          releaseEligible: true,
          actualTaskResult: {
            status: 'passed',
            summary: 'BrowserHostSession-backed answer.',
            userIntentSatisfied: true,
            outputVerified: true,
            evidenceRefs: [
              'runtime-truth:module.invoke/browser.open_read/local-ordinary-chat',
              'browser-host-session:ordinary/source-pages/source-1.source.json',
              'browser-host-session:ordinary/source-pages/source-1.txt',
              'artifact:runtime-codex-browser-acceptance/final-answer.md',
            ],
          },
          liveRuntimeCodexProof: {
            messageProvenance: 'live-runtime-codex',
            commandId: options.commandId,
            nativeDefaultChatAssistantAnswerRendered: true,
            runtimeOutputObserved: true,
            seedOrDemoExcluded: true,
            eventEvidenceRefs: [
              'runtime-truth:module.invoke/browser.open_read/local-ordinary-chat',
              'browser-host-session:ordinary/source-pages/source-1.source.json',
              'browser-host-session:ordinary/source-pages/source-1.txt',
            ],
          },
          evidence: { notesPath: 'final-answer.md', runtimeAuditPath: 'runtime-audit.json' },
        };
      },
    });
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');

    assert.equal(manifest.schemaVersion, RUNTIME_CODEX_BROWSER_ORDINARY_CHAT_LOCAL_DOGFOOD_SCHEMA_VERSION);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.localConfig.apiKeyPresent, true);
    assert.equal(manifest.localConfig.secretValuesRedacted, true);
    assert.equal(manifest.ordinaryChatAcceptance.status, 'passed');
    assert.equal(manifest.releaseGate.status, 'local-dogfood-only');
    assert.equal(manifest.releaseGate.strictReleaseStillRequiresServiceEnv, true);
    assert.equal(calls[0]?.workspacePath, workspace);
    assert.equal(calls[0]?.outputDir, join(outputDir, 'ordinary-chat-acceptance'));
    assert.match(calls[0]?.commandId ?? '', /^browser-ordinary-chat-local-/);
    assert.ok(calls[0]?.browserBoundedOperationPorts?.manager);
    assert.doesNotMatch(manifestText, new RegExp(secret));
    assert.doesNotMatch(manifestText, /provider\.example\.invalid|http:\/\/|https:\/\/provider/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Runtime Codex browser ordinary-chat local dogfood blocks before writer when config.local is unavailable', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-ordinary-chat-local-'));
  const outputDir = join(workspace, 'out');
  let writerCalled = false;
  try {
    const manifest = await runRuntimeCodexBrowserOrdinaryChatLocalDogfood({
      workspacePath: workspace,
      configPath: join(workspace, 'missing-config.local.json'),
      outputDir,
      now: () => new Date('2026-06-07T00:00:00.000Z'),
      writer: async () => {
        writerCalled = true;
        throw new Error('writer must not run');
      },
    });

    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.releaseEligible, false);
    assert.equal(writerCalled, false);
    assert.match(manifest.blockedReason ?? '', /config.local/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
