import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  DEFAULT_CODEX_RUNTIME_BASE_URL,
  DEFAULT_CODEX_RUNTIME_MODEL,
  DEFAULT_CODEX_RUNTIME_PROFILE,
  DEFAULT_CODEX_RUNTIME_PROVIDER,
  INTERNAL_CODEX_RESPONSES_PROXY_BASE_URL,
  defaultSciForgeConfig,
  loadDesktopRuntimeConfigDefaults,
  loadSciForgeConfig,
  normalizeConfig,
  normalizeFeedbackGithubRepo,
  normalizeFeedbackGithubToken,
  normalizePeerInstances,
  normalizeWorkspaceRootPath,
  applyWorkspaceProjectSwitch,
  resolvePeerWorkspaceWriterUrl,
  saveSciForgeConfig,
  updateConfig,
  validatePeerInstances,
} from './config';
import { loadFileBackedSciForgeConfig, saveFileBackedSciForgeConfig } from './api/workspaceClient';

const originalFetch = globalThis.fetch;

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

describe('SciForge config persistence', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  it('defaults feedback github repo to upstream SciForge', () => {
    assert.equal(defaultSciForgeConfig.feedbackGithubRepo, 'AGI4Sci/SciForge');
    assert.deepEqual(defaultSciForgeConfig.feedbackGithubLabels, ['feedback', 'sciforge-inbox']);
    assert.equal(defaultSciForgeConfig.feedbackGithubDryRun, false);
  });

  it('defaults to English locale and normalizes supported app languages', () => {
    assert.equal(defaultSciForgeConfig.locale, 'en-US');
    assert.equal(normalizeConfig({ locale: 'en' }).locale, 'en-US');
    assert.equal(normalizeConfig({ locale: 'zh-Hans' }).locale, 'zh-CN');
    assert.equal(updateConfig(defaultSciForgeConfig, { locale: 'en-US' }).locale, 'en-US');
  });

  it('默认 Runtime Codex 使用 Model Router profile 且不允许 OpenAI 自动回退', () => {
    assert.equal(defaultSciForgeConfig.runtimeProfile, DEFAULT_CODEX_RUNTIME_PROFILE);
    assert.equal(defaultSciForgeConfig.modelProvider, DEFAULT_CODEX_RUNTIME_PROVIDER);
    assert.equal(defaultSciForgeConfig.modelName, DEFAULT_CODEX_RUNTIME_MODEL);
    assert.equal(defaultSciForgeConfig.modelBaseUrl, DEFAULT_CODEX_RUNTIME_BASE_URL);
    assert.equal(defaultSciForgeConfig.modelBaseUrl, '');
    assert.equal(defaultSciForgeConfig.allowOpenAiRuntime, false);
  });

  it('ignores legacy allowOpenAiRuntime config so Runtime Codex stays on Model Router', () => {
    assert.equal(normalizeConfig({}).allowOpenAiRuntime, false);
    assert.equal(normalizeConfig({ allowOpenAiRuntime: true }).allowOpenAiRuntime, false);
    assert.equal(normalizeConfig({ allowOpenAiRuntime: 'true' }).allowOpenAiRuntime, false);
  });

  it('round-trips custom model settings through localStorage', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });

    const saved = updateConfig(defaultSciForgeConfig, {
      modelProvider: 'custom-provider',
      modelBaseUrl: 'https://provider.example/api/v1/',
      modelName: 'custom/model-alias',
      apiKey: 'test-key',
      maxContextWindowTokens: 128000,
    });

    saveSciForgeConfig(saved);
    const loaded = loadSciForgeConfig();

    assert.equal(loaded.modelProvider, 'custom-provider');
    assert.equal(loaded.modelBaseUrl, 'https://provider.example/api/v1');
    assert.equal(loaded.modelName, 'custom/model-alias');
    assert.equal(loaded.apiKey, 'test-key');
    assert.equal(loaded.maxContextWindowTokens, 128000);
  });

  it('keeps saved legacy default endpoints aligned to instance build defaults', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });

    saveSciForgeConfig(updateConfig(defaultSciForgeConfig, {
      agentServerBaseUrl: 'http://127.0.0.1:18080',
      workspaceWriterBaseUrl: 'http://127.0.0.1:5174',
      workspacePath: '/Applications/workspace/ailab/research/app/SciForge/workspace',
      modelBaseUrl: 'http://127.0.0.1:4765/v1',
    }));

    const loaded = loadSciForgeConfig();

    assert.equal(loaded.agentServerBaseUrl, defaultSciForgeConfig.agentServerBaseUrl);
    assert.equal(loaded.workspaceWriterBaseUrl, defaultSciForgeConfig.workspaceWriterBaseUrl);
    assert.equal(loaded.workspacePath, defaultSciForgeConfig.workspacePath);
    assert.equal(loaded.modelBaseUrl, defaultSciForgeConfig.modelBaseUrl);
  });

  it('does not persist internal Responses proxy URLs as the user-facing provider base URL', () => {
    assert.equal(normalizeConfig({ modelBaseUrl: INTERNAL_CODEX_RESPONSES_PROXY_BASE_URL }).modelBaseUrl, '');
  });

  it('keeps desktop sidecar URLs out of user-facing model and AgentServer settings', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sciforgeDesktop: {
          getRuntimeConfig: async () => ({
            schemaVersion: 'sciforge.desktop.runtime-config.v1',
            workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
            modelBaseUrl: 'http://127.0.0.1:3891/v1',
            runtimeCodexBaseUrl: 'http://127.0.0.1:18080',
            workspacePath: '/tmp/sciforge-workspace',
            ports: [
              { name: 'model-router', url: 'http://127.0.0.1:3891' },
              { name: 'runtime-codex', url: 'http://127.0.0.1:18080' },
            ],
          }),
        },
      },
    });

    const defaults = await loadDesktopRuntimeConfigDefaults();

    assert.equal(defaults?.workspaceWriterBaseUrl, 'http://127.0.0.1:6173');
    assert.equal(defaults?.workspacePath, '/tmp/sciforge-workspace');
    assert.equal(defaults?.modelBaseUrl, undefined);
    assert.equal(defaults?.agentServerBaseUrl, undefined);
  });

  it('normalizes peer instances for config reads', () => {
    const config = normalizeConfig({
      peerInstances: [
        {
          name: ' Repair Peer ',
          appUrl: 'http://127.0.0.1:5175/',
          workspaceWriterUrl: 'http://127.0.0.1:5176/',
          workspacePath: '/tmp/sciforge-peer/.sciforge/tasks/run-1',
          role: 'repair',
          trustLevel: 'sync',
          enabled: false,
        },
        {
          name: 'Loose Peer',
          workspaceWriterUrl: 'http://127.0.0.1:6174',
          role: 'unknown',
          trustLevel: 'unknown',
        },
      ],
    });

    assert.deepEqual(config.peerInstances, [
      {
        name: 'Repair Peer',
        appUrl: 'http://127.0.0.1:5175',
        workspaceWriterUrl: 'http://127.0.0.1:5176',
        workspacePath: '/tmp/sciforge-peer',
        role: 'repair',
        trustLevel: 'sync',
        enabled: false,
      },
      {
        name: 'Loose Peer',
        appUrl: '',
        workspaceWriterUrl: 'http://127.0.0.1:6174',
        workspacePath: '',
        role: 'peer',
        trustLevel: 'readonly',
        enabled: true,
      },
    ]);
  });

  it('normalizes feedback GitHub sync options without storing blank list entries', () => {
    const config = normalizeConfig({
      feedbackGithubLabels: 'feedback, bug, feedback, ',
      feedbackGithubAssignees: ['alice', ' ', 'bob', 'alice'],
      feedbackGithubMilestone: '42',
      feedbackGithubDryRun: true,
    });

    assert.deepEqual(config.feedbackGithubLabels, ['feedback', 'bug']);
    assert.deepEqual(config.feedbackGithubAssignees, ['alice', 'bob']);
    assert.equal(config.feedbackGithubMilestone, '42');
    assert.equal(config.feedbackGithubDryRun, true);
  });

  it('normalizes configured tool provider routes for runtime requests', () => {
    const config = normalizeConfig({
      toolProviderRoutes: {
        playwright_edge_browser: {
          enabled: true,
          capabilityId: 'playwright_edge_browser',
          source: 'mcp',
          primaryProviderId: 'sciforge.observe.playwright-edge-mcp',
          fallbackProviderIds: ['fallback.provider', 'fallback.provider', ''],
          health: 'ready',
          endpoint: 'http://127.0.0.1:8931/mcp/',
          timeoutMs: 60_000.4,
        },
      },
    });

    assert.deepEqual(config.toolProviderRoutes, {
      playwright_edge_browser: {
        enabled: true,
        capabilityId: 'playwright_edge_browser',
        source: 'mcp',
        primaryProviderId: 'sciforge.observe.playwright-edge-mcp',
        fallbackProviderIds: ['fallback.provider'],
        health: 'ready',
        endpoint: 'http://127.0.0.1:8931/mcp',
        timeoutMs: 60000,
      },
    });
  });

  it('round-trips peer instances through localStorage save/read', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });

    const saved = updateConfig(defaultSciForgeConfig, {
      peerInstances: [
        {
          name: 'repair-peer',
          appUrl: 'http://127.0.0.1:5175',
          workspaceWriterUrl: 'http://127.0.0.1:5176',
          workspacePath: '/tmp/sciforge-peer',
          role: 'repair',
          trustLevel: 'repair',
          enabled: true,
        },
      ],
    });

    saveSciForgeConfig(saved);

    assert.deepEqual(loadSciForgeConfig().peerInstances, saved.peerInstances);
  });

  it('saves and reads peer instances through the config.local.json API flow', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let fileBackedConfig: unknown = {
      ...defaultSciForgeConfig,
      peerInstances: [
        {
          name: 'main-peer',
          appUrl: 'http://127.0.0.1:5173',
          workspaceWriterUrl: 'http://127.0.0.1:5174',
          workspacePath: '/tmp/main-peer',
          role: 'main',
          trustLevel: 'sync',
          enabled: true,
        },
      ],
    };
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as { config: unknown };
          fileBackedConfig = body.config;
        }
        return new Response(JSON.stringify({ ok: true, config: fileBackedConfig }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    const saved = await saveFileBackedSciForgeConfig(updateConfig(defaultSciForgeConfig, {
      peerInstances: [
        {
          name: 'repair-peer',
          appUrl: 'http://127.0.0.1:5175',
          workspaceWriterUrl: 'http://127.0.0.1:5176',
          workspacePath: '/tmp/repair-peer',
          role: 'repair',
          trustLevel: 'repair',
          enabled: false,
        },
      ],
    }));
    const loaded = await loadFileBackedSciForgeConfig(defaultSciForgeConfig);

    assert.equal(requests[0].url, 'http://127.0.0.1:5174/api/sciforge/config');
    assert.equal(requests[0].init?.method, 'POST');
    assert.deepEqual(saved?.peerInstances, loaded?.peerInstances);
    assert.deepEqual(loaded?.peerInstances?.[0], {
      name: 'repair-peer',
      appUrl: 'http://127.0.0.1:5175',
      workspaceWriterUrl: 'http://127.0.0.1:5176',
      workspacePath: '/tmp/repair-peer',
      role: 'repair',
      trustLevel: 'repair',
      enabled: false,
    });
  });

  it('validates peer instance URLs and unique names', () => {
    const peers = normalizePeerInstances([
      { name: 'peer-a', appUrl: 'notaurl', workspaceWriterUrl: '', role: 'main', trustLevel: 'readonly' },
      { name: 'Peer-A', appUrl: 'http://127.0.0.1:5173', workspaceWriterUrl: 'ftp://127.0.0.1:5174' },
    ]);

    assert.deepEqual(validatePeerInstances(peers), [
      'peer-a: appUrl must be a valid http(s) URL.',
      'Peer-A: name must be unique.',
      'Peer-A: workspaceWriterUrl must be a valid http(s) URL.',
    ]);
  });

  it('resolvePeerWorkspaceWriterUrl keeps readonly peers on the shared writer', () => {
    const config = updateConfig(defaultSciForgeConfig, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
      peerInstances: [{
        name: 'p2',
        appUrl: '',
        workspaceWriterUrl: 'http://127.0.0.1:6174',
        workspacePath: '/tmp/p2',
        role: 'peer',
        trustLevel: 'readonly',
        enabled: true,
      }],
    });

    assert.equal(resolvePeerWorkspaceWriterUrl(config, config.peerInstances![0]), 'http://127.0.0.1:6173');
  });

  it('applyWorkspaceProjectSwitch only changes workspace routing fields', () => {
    const config = updateConfig(defaultSciForgeConfig, {
      workspacePath: '/tmp/p1',
      workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
      modelName: 'shared-model',
      apiKey: 'shared-key',
    });
    const next = applyWorkspaceProjectSwitch(config, {
      workspacePath: '/tmp/p2',
      peerInstances: [{ name: 'p1', appUrl: '', workspaceWriterUrl: '', workspacePath: '/tmp/p1', role: 'peer', trustLevel: 'readonly', enabled: true }],
    });

    assert.equal(next.workspacePath, '/tmp/p2');
    assert.equal(next.workspaceWriterBaseUrl, 'http://127.0.0.1:6173');
    assert.equal(next.modelName, 'shared-model');
    assert.equal(next.apiKey, 'shared-key');
  });

  it('normalizes accidental .sciforge internal paths back to the workspace root', () => {
    const root = '/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1';

    assert.equal(normalizeWorkspaceRootPath(`${root}/.sciforge/tasks/.sciforge/logs`), root);
    assert.equal(normalizeWorkspaceRootPath(`${root}/.sciforge`), root);
    assert.equal(updateConfig(defaultSciForgeConfig, { workspacePath: `${root}/.sciforge/tasks/run-1` }).workspacePath, root);
  });

  it('normalizes legacy non-Codex AgentBackend selections back to Codex', () => {
    const config = updateConfig(defaultSciForgeConfig, { agentBackend: 'gemini' });

    assert.equal(config.agentBackend, 'codex');
  });

  it('normalizes user context window limits', () => {
    assert.equal(updateConfig(defaultSciForgeConfig, { maxContextWindowTokens: 64000 }).maxContextWindowTokens, 64000);
    assert.equal(updateConfig(defaultSciForgeConfig, { maxContextWindowTokens: 12 }).maxContextWindowTokens, 1000);
  });

  it('defaults shared system input for vision-sense and preserves explicit opt-out', () => {
    assert.equal(defaultSciForgeConfig.visionAllowSharedSystemInput, true);
    assert.equal(updateConfig(defaultSciForgeConfig, { visionAllowSharedSystemInput: false }).visionAllowSharedSystemInput, false);
  });

  it('normalizes feedback github repo to owner/repo', () => {
    assert.equal(normalizeFeedbackGithubRepo('acme/SciForge'), 'acme/SciForge');
    assert.equal(normalizeFeedbackGithubRepo('https://github.com/acme/SciForge.git'), 'acme/SciForge');
    assert.equal(normalizeFeedbackGithubRepo(''), undefined);
    assert.equal(normalizeFeedbackGithubRepo('not-a-repo'), undefined);
    assert.equal(updateConfig(defaultSciForgeConfig, { feedbackGithubRepo: 'https://github.com/org/repo-name' }).feedbackGithubRepo, 'org/repo-name');
  });

  it('normalizes feedback github token', () => {
    assert.equal(normalizeFeedbackGithubToken('  ghp_abcd  '), 'ghp_abcd');
    assert.equal(normalizeFeedbackGithubToken(''), undefined);
    assert.equal(updateConfig(defaultSciForgeConfig, { feedbackGithubToken: ' tok ' }).feedbackGithubToken, 'tok');
  });
});
