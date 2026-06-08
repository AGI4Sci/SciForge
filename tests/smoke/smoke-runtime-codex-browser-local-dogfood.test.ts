import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  runRuntimeCodexBrowserLocalDogfood,
  RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION,
} from '../../src/runtime/runtime-codex-browser-local-dogfood.js';
import {
  BROWSER_HOST_DISCOVERY_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  type BrowserHostDiscoveryInput,
  type BrowserHostDiscoveryOutput,
  type BrowserHostSessionManager,
} from '../../src/runtime/browser-host-session.js';

test('Runtime Codex browser local dogfood records source page refs without leaking config secrets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-local-dogfood-'));
  const configPath = join(workspace, 'config.local.json');
  const outputDir = join(workspace, 'out');
  const secret = 'LOCAL_DOGFOOD_SECRET_SHOULD_NOT_LEAK';
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: secret,
      model: 'local-model',
    },
  }), 'utf8');
  const calls: BrowserHostDiscoveryInput[] = [];
  const manager = {
    async search(_workspacePath: string, input: BrowserHostDiscoveryInput): Promise<BrowserHostDiscoveryOutput> {
      calls.push(input);
      return {
        schemaVersion: BROWSER_HOST_DISCOVERY_SCHEMA,
        query: input.query,
        engine: 'bing',
        searchedAt: '2026-06-07T00:00:00.000Z',
        searchUrl: 'https://www.bing.com/search?q=openai',
        finalUrl: 'https://www.bing.com/search?q=openai',
        results: [{ title: 'OpenAI product update', url: 'https://openai.com/index/update', snippet: 'Official update' }],
        sourcePages: [{
          resultIndex: 0,
          title: 'Unofficial OpenAI roundup',
          url: 'https://example.test/openai-roundup',
          finalUrl: 'https://example.test/openai-roundup',
          openedAt: '2026-06-07T00:00:01.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:local/source-pages/source-1.source.json',
          textRef: 'browser-host-session:local/source-pages/source-1.txt',
          textPreview: 'A third-party page that mentions OpenAI.',
          textCharCount: 40,
        }, {
          resultIndex: 1,
          title: 'OpenAI product update',
          url: 'https://openai.com/index/update',
          finalUrl: 'https://openai.com/index/update',
          openedAt: '2026-06-07T00:00:01.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:local/source-pages/source-2.source.json',
          textRef: 'browser-host-session:local/source-pages/source-2.txt',
          textPreview: 'OpenAI released a product update with official details.',
          textCharCount: 58,
        }, {
          resultIndex: 2,
          title: 'OpenAI models documentation',
          url: 'https://platform.openai.com/docs/models',
          finalUrl: 'https://developers.openai.com/api/docs/models',
          openedAt: '2026-06-07T00:00:01.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:local/source-pages/source-3.source.json',
          textRef: 'browser-host-session:local/source-pages/source-3.txt',
          textPreview: 'Home API Codex ChatGPT Resources Start searching API Dashboard Get started Overview Quickstart Models Pricing SDKs and CLI Latest: GPT-5.5 Prompt guidance Core concepts.',
          textCharCount: 160,
        }],
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'local',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: workspace,
          requestedUrl: 'https://www.bing.com/search?q=openai',
          url: 'https://www.bing.com/search?q=openai',
          startedAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:01.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: [],
          automationSummary: {
            schemaVersion: 'sciforge.browser-runtime.automation-summary.v1',
            boundedRefsOnly: true,
            kind: 'scrape',
            status: 'completed',
            title: 'BrowserHostSession search scrape',
            summary: 'read',
            itemCount: 1,
            refs: [{ kind: 'search-result', ref: 'browser-host-session:local/search-results.json' }],
            diagnostics: [],
          },
        },
        searchResultRef: 'browser-host-session:local/search-results.json',
      };
    },
  } as unknown as BrowserHostSessionManager;

  try {
    const manifest = await runRuntimeCodexBrowserLocalDogfood({
      workspacePath: workspace,
      configPath,
      outputDir,
      manager,
      now: () => new Date('2026-06-07T00:00:02.000Z'),
    });
    const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');
    const finalAnswer = await readFile(join(outputDir, 'final-answer.md'), 'utf8');

    assert.equal(manifest.schemaVersion, RUNTIME_CODEX_BROWSER_LOCAL_DOGFOOD_SCHEMA_VERSION);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.localConfig.apiKeyPresent, true);
    assert.equal(manifest.localConfig.secretValuesRedacted, true);
    assert.deepEqual(manifest.sourcePageRefs, [
      'browser-host-session:local/source-pages/source-2.source.json',
      'browser-host-session:local/source-pages/source-3.source.json',
    ]);
    assert.deepEqual(manifest.pageTextRefs, [
      'browser-host-session:local/source-pages/source-2.txt',
      'browser-host-session:local/source-pages/source-3.txt',
    ]);
    assert.match(finalAnswer, /实际读取页面/);
    assert.match(finalAnswer, /https:\/\/openai\.com\/index\/update/);
    assert.doesNotMatch(finalAnswer.split('实际读取页面：')[0], /OpenAI models documentation/);
    assert.doesNotMatch(finalAnswer, /example\.test/);
    assert.equal(calls[0]?.sourcePageLimit, 3);
    assert.equal(calls[0]?.preferredResults?.[0]?.url, 'https://platform.openai.com/docs/changelog');
    assert.doesNotMatch(manifestText, new RegExp(secret));
    assert.doesNotMatch(manifestText, /provider\.example\.invalid/);
    assert.equal(manifest.releaseGate.strictReleaseStillRequiresServiceEnv, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Runtime Codex browser local dogfood fails when official source text is empty', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-local-dogfood-'));
  const configPath = join(workspace, 'config.local.json');
  const outputDir = join(workspace, 'out');
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: 'redacted',
      model: 'local-model',
    },
  }), 'utf8');
  const manager = {
    async search(_workspacePath: string, input: BrowserHostDiscoveryInput): Promise<BrowserHostDiscoveryOutput> {
      return {
        schemaVersion: BROWSER_HOST_DISCOVERY_SCHEMA,
        query: input.query,
        engine: 'bing',
        searchedAt: '2026-06-07T00:00:00.000Z',
        searchUrl: 'https://www.bing.com/search?q=openai',
        finalUrl: 'https://www.bing.com/search?q=openai',
        results: [{ title: 'OpenAI release notes', url: 'https://openai.com/products/release-notes/', snippet: 'Official release notes' }],
        sourcePages: [{
          resultIndex: 0,
          title: 'OpenAI release notes',
          url: 'https://openai.com/products/release-notes/',
          finalUrl: 'https://openai.com/products/release-notes/',
          openedAt: '2026-06-07T00:00:01.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:local/source-pages/source-1.source.json',
          textRef: 'browser-host-session:local/source-pages/source-1.txt',
          textPreview: '',
          textCharCount: 0,
        }],
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'local',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: workspace,
          requestedUrl: 'https://www.bing.com/search?q=openai',
          url: 'https://www.bing.com/search?q=openai',
          startedAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:01.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: [],
          automationSummary: {
            schemaVersion: 'sciforge.browser-runtime.automation-summary.v1',
            boundedRefsOnly: true,
            kind: 'scrape',
            status: 'completed',
            title: 'BrowserHostSession search scrape',
            summary: 'empty source',
            itemCount: 1,
            refs: [{ kind: 'search-result', ref: 'browser-host-session:local/search-results.json' }],
            diagnostics: [],
          },
        },
        searchResultRef: 'browser-host-session:local/search-results.json',
      };
    },
  } as unknown as BrowserHostSessionManager;

  try {
    const manifest = await runRuntimeCodexBrowserLocalDogfood({
      workspacePath: workspace,
      configPath,
      outputDir,
      manager,
      now: () => new Date('2026-06-07T00:00:02.000Z'),
    });

    assert.equal(manifest.status, 'failed');
    assert.match(manifest.blockedReason ?? '', /non-empty official source page text/i);
    assert.deepEqual(manifest.sourcePageRefs, []);
    assert.deepEqual(manifest.pageTextRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Runtime Codex browser local dogfood summarizes changelog text without navigation preamble', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-local-dogfood-'));
  const configPath = join(workspace, 'config.local.json');
  const outputDir = join(workspace, 'out');
  await writeFile(configPath, JSON.stringify({
    llm: {
      provider: 'local-provider',
      baseUrl: 'https://provider.example.invalid/v1',
      apiKey: 'redacted',
      model: 'local-model',
    },
  }), 'utf8');
  const manager = {
    async search(_workspacePath: string, input: BrowserHostDiscoveryInput): Promise<BrowserHostDiscoveryOutput> {
      return {
        schemaVersion: BROWSER_HOST_DISCOVERY_SCHEMA,
        query: input.query,
        engine: 'bing',
        searchedAt: '2026-06-07T00:00:00.000Z',
        searchUrl: 'https://www.bing.com/search?q=openai',
        finalUrl: 'https://www.bing.com/search?q=openai',
        results: [{ title: 'OpenAI API changelog', url: 'https://platform.openai.com/docs/changelog', snippet: 'Official changelog' }],
        sourcePages: [{
          resultIndex: 0,
          title: 'OpenAI API changelog',
          url: 'https://platform.openai.com/docs/changelog',
          finalUrl: 'https://developers.openai.com/api/docs/changelog',
          openedAt: '2026-06-07T00:00:01.000Z',
          status: 'read',
          sourcePageRef: 'browser-host-session:local/source-pages/source-1.source.json',
          textRef: 'browser-host-session:local/source-pages/source-1.txt',
          textPreview: 'Home API Codex ChatGPT Resources Start searching API Dashboard Changelog June, 2026 Jun 4 Feature omni-moderation-latest v1/responses v1/chat/completions Added moderation scores to the Responses API and Chat Completions API. Jun 3 Update Announced the deprecation of reusable prompt objects, the Evals platform, and Agent Builder.',
          textSummary: 'Jun 4 Feature omni-moderation-latest v1/responses v1/chat/completions Added moderation scores to the Responses API and Chat Completions API. Jun 3 Update Announced the deprecation of reusable prompt objects, the Evals platform, and Agent Builder. May, 2026',
          textCharCount: 310,
        }],
        session: {
          schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
          id: 'local',
          owner: 'host',
          providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
          status: 'ready',
          workspacePath: workspace,
          requestedUrl: 'https://www.bing.com/search?q=openai',
          url: 'https://developers.openai.com/api/docs/changelog',
          startedAt: '2026-06-07T00:00:00.000Z',
          updatedAt: '2026-06-07T00:00:01.000Z',
          viewport: { width: 800, height: 600 },
          canGoBack: false,
          canGoForward: false,
          diagnostics: [],
        },
        searchResultRef: 'browser-host-session:local/search-results.json',
      };
    },
  } as unknown as BrowserHostSessionManager;

  try {
    await runRuntimeCodexBrowserLocalDogfood({
      workspacePath: workspace,
      configPath,
      outputDir,
      manager,
      now: () => new Date('2026-06-07T00:00:02.000Z'),
    });
    const finalAnswer = await readFile(join(outputDir, 'final-answer.md'), 'utf8');

    assert.match(finalAnswer, /Jun 4.*Added moderation scores/);
    assert.doesNotMatch(finalAnswer.split('实际读取页面：')[0], /May, 2026/);
    assert.doesNotMatch(finalAnswer, /Home API Codex ChatGPT Resources/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
