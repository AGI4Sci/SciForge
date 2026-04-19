import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { defaultBioAgentConfig, loadBioAgentConfig, saveBioAgentConfig, updateConfig } from './config';

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

describe('BioAgent config persistence', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('round-trips qwen/openrouter style model settings through localStorage', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });

    const saved = updateConfig(defaultBioAgentConfig, {
      modelProvider: 'openrouter',
      modelBaseUrl: 'https://openrouter.ai/api/v1/',
      modelName: 'qwen/qwen3.6-plus:free',
      apiKey: 'test-key',
    });

    saveBioAgentConfig(saved);
    const loaded = loadBioAgentConfig();

    assert.equal(loaded.modelProvider, 'openrouter');
    assert.equal(loaded.modelBaseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(loaded.modelName, 'qwen/qwen3.6-plus:free');
    assert.equal(loaded.apiKey, 'test-key');
  });
});
