import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import { defaultSciForgeConfig, updateConfig } from './config';
import { modelHealth, workspaceWriterHealth } from './runtimeHealth';

describe('runtime health model status', () => {
  it('marks empty native model configuration as setup instead of online', () => {
    const health = modelHealth(updateConfig(defaultSciForgeConfig, {
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
    }));

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.NOT_CONFIGURED);
    assert.equal(health.detail, 'native · user model not set');
    assert.match(String(health.recoverAction), /不会回退到 AgentServer 默认模型/);
  });

  it('treats native user model endpoints as an explicit online configuration', () => {
    const health = modelHealth(updateConfig(defaultSciForgeConfig, {
      modelProvider: 'native',
      modelBaseUrl: 'https://models.example.test/v1',
      modelName: 'sciforge-model',
      apiKey: 'test-key',
    }));

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.ONLINE);
    assert.match(health.detail, /sciforge-model/);
    assert.match(health.detail, /models\.example\.test/);
  });

  it('keeps OpenAI-compatible providers not-configured until API key is present', () => {
    const health = modelHealth(updateConfig(defaultSciForgeConfig, {
      modelProvider: 'openrouter',
      modelBaseUrl: 'https://openrouter.ai/api/v1',
      modelName: 'qwen/qwen3.6-plus:free',
      apiKey: '',
    }));

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.NOT_CONFIGURED);
    assert.equal(health.recoverAction, '填写 API Key 或使用 native backend');
  });

  it('diagnoses stale Workspace Writer port drift when the default writer is reachable', () => {
    const health = workspaceWriterHealth(updateConfig(defaultSciForgeConfig, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:21431',
    }), false, true);

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.OFFLINE);
    assert.equal(health.detail, 'http://127.0.0.1:21431');
    assert.match(String(health.recoverAction), /默认 writer http:\/\/127\.0\.0\.1:5174 在线/);
    assert.match(String(health.recoverAction), /Settings/);
  });

  it('keeps the generic Workspace Writer recovery action when no default writer is reachable', () => {
    const health = workspaceWriterHealth(updateConfig(defaultSciForgeConfig, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:65535',
    }), false, false);

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.OFFLINE);
    assert.equal(health.recoverAction, '启动 npm run workspace:server 后刷新');
  });
});
