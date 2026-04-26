import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultBioAgentConfig, updateConfig } from './config';
import { modelHealth } from './runtimeHealth';

describe('runtime health model status', () => {
  it('marks empty native model configuration as setup instead of online', () => {
    const health = modelHealth(updateConfig(defaultBioAgentConfig, {
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
    }));

    assert.equal(health.status, 'not-configured');
    assert.equal(health.detail, 'native · user model not set');
    assert.match(String(health.recoverAction), /不会回退到 AgentServer 默认模型/);
  });

  it('treats native user model endpoints as an explicit online configuration', () => {
    const health = modelHealth(updateConfig(defaultBioAgentConfig, {
      modelProvider: 'native',
      modelBaseUrl: 'https://models.example.test/v1',
      modelName: 'bioagent-model',
      apiKey: 'test-key',
    }));

    assert.equal(health.status, 'online');
    assert.match(health.detail, /bioagent-model/);
    assert.match(health.detail, /models\.example\.test/);
  });

  it('keeps OpenAI-compatible providers not-configured until API key is present', () => {
    const health = modelHealth(updateConfig(defaultBioAgentConfig, {
      modelProvider: 'openrouter',
      modelBaseUrl: 'https://openrouter.ai/api/v1',
      modelName: 'qwen/qwen3.6-plus:free',
      apiKey: '',
    }));

    assert.equal(health.status, 'not-configured');
    assert.equal(health.recoverAction, '填写 API Key 或使用 native backend');
  });
});
