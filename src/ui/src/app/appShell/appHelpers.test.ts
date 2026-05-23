import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultSciForgeConfig, updateConfig } from '../../config';
import { mergeFileBackedConfig } from './appHelpers';

test('file-backed config does not preserve stale browser-cached GitHub tokens', () => {
  const current = updateConfig(defaultSciForgeConfig, {
    feedbackGithubToken: 'stale-browser-token',
    modelProvider: 'openai',
    modelBaseUrl: 'https://models.example/v1',
    modelName: 'configured-model',
    apiKey: 'model-key',
  });
  const fileBacked = updateConfig(defaultSciForgeConfig, {
    feedbackGithubToken: '',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  });

  const merged = mergeFileBackedConfig(current, fileBacked);

  assert.equal(merged.feedbackGithubToken, undefined);
  assert.equal(merged.modelProvider, 'openai');
  assert.equal(merged.modelBaseUrl, 'https://models.example/v1');
  assert.equal(merged.modelName, 'configured-model');
  assert.equal(merged.apiKey, 'model-key');
});
