import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  defaultSciForgeConfig,
  loadSciForgeConfig,
  normalizeConfig,
  normalizeFeedbackGithubRepo,
  normalizeFeedbackGithubToken,
  normalizePeerInstances,
  normalizeWorkspaceRootPath,
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
  });

  it('round-trips qwen/openrouter style model settings through localStorage', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });

    const saved = updateConfig(defaultSciForgeConfig, {
      modelProvider: 'openrouter',
      modelBaseUrl: 'https://openrouter.ai/api/v1/',
      modelName: 'qwen/qwen3.6-plus:free',
      apiKey: 'test-key',
      maxContextWindowTokens: 128000,
    });

    saveSciForgeConfig(saved);
    const loaded = loadSciForgeConfig();

    assert.equal(loaded.modelProvider, 'openrouter');
    assert.equal(loaded.modelBaseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(loaded.modelName, 'qwen/qwen3.6-plus:free');
    assert.equal(loaded.apiKey, 'test-key');
    assert.equal(loaded.maxContextWindowTokens, 128000);
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

  it('validates peer instance URLs, required writer URL, and unique names', () => {
    const peers = normalizePeerInstances([
      { name: 'peer-a', appUrl: 'notaurl', workspaceWriterUrl: '', role: 'main', trustLevel: 'readonly' },
      { name: 'Peer-A', appUrl: 'http://127.0.0.1:5173', workspaceWriterUrl: 'ftp://127.0.0.1:5174' },
    ]);

    assert.deepEqual(validatePeerInstances(peers), [
      'peer-a: appUrl must be a valid http(s) URL.',
      'peer-a: workspaceWriterUrl is required.',
      'Peer-A: name must be unique.',
      'Peer-A: workspaceWriterUrl must be a valid http(s) URL.',
    ]);
  });

  it('normalizes accidental .sciforge internal paths back to the workspace root', () => {
    const root = '/Applications/workspace/ailab/research/app/SciForge/workspace';

    assert.equal(normalizeWorkspaceRootPath(`${root}/.sciforge/tasks/.sciforge/logs`), root);
    assert.equal(normalizeWorkspaceRootPath(`${root}/.sciforge`), root);
    assert.equal(updateConfig(defaultSciForgeConfig, { workspacePath: `${root}/.sciforge/tasks/run-1` }).workspacePath, root);
  });

  it('preserves gemini as a selectable AgentBackend', () => {
    const config = updateConfig(defaultSciForgeConfig, { agentBackend: 'gemini' });

    assert.equal(config.agentBackend, 'gemini');
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
