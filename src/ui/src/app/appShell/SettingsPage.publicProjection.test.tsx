import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { defaultSciForgeConfig } from '../../config';
import type { SciForgeConfig } from '../../domain';
import { SettingsPage } from './SettingsPage';

const sensitiveConfig: SciForgeConfig = {
  ...defaultSciForgeConfig,
  agentServerBaseUrl: 'http://127.0.0.1:4765/v1?token=runtime-secret',
  workspaceWriterBaseUrl: 'http://127.0.0.1:6174/private?token=writer-secret',
  workspacePath: '/Applications/workspace/ailab/private-project',
  runtimeProfile: 'private-runtime-profile',
  modelProvider: 'native',
  modelBaseUrl: 'https://provider.internal/v1?api_key=base-secret',
  modelName: 'private/provider-model',
  apiKey: 'sk-live-settings-secret',
  peerInstances: [{
    name: 'peer-alpha',
    role: 'peer',
    trustLevel: 'readonly',
    enabled: true,
    appUrl: 'http://127.0.0.1:5173/peer?token=peer-app-secret',
    workspaceWriterUrl: 'http://127.0.0.1:6175/peer?token=peer-writer-secret',
    workspacePath: '/Users/alice/private-peer-workspace',
  }],
  updatedAt: '2026-06-04T00:00:00.000Z',
};

test('settings page renders public config projection without URLs, secrets, model ids, profiles, or absolute paths', () => {
  const html = ['workspace', 'models', 'connections'].map((section) => renderToStaticMarkup(React.createElement(SettingsPage, {
    config: sensitiveConfig,
    onChange: () => undefined,
    saveState: { status: 'idle' },
    onSave: () => undefined,
    onBack: () => undefined,
    initialSection: section as 'workspace' | 'models' | 'connections',
  }))).join('\n')
    + renderToStaticMarkup(React.createElement(SettingsPage, {
      config: sensitiveConfig,
      onChange: () => undefined,
      saveState: {
        status: 'error',
        message: 'Save failed at http://127.0.0.1:6174/private?token=github_pat_settingssecret123456 from /Applications/workspace/ailab/private-project',
      },
      onSave: () => undefined,
      onBack: () => undefined,
      initialSection: 'workspace',
    }));

  for (const forbidden of [
    'http://127.0.0.1',
    'provider.internal',
    'runtime-secret',
    'writer-secret',
    'base-secret',
    'peer-app-secret',
    'peer-writer-secret',
    'github_pat_settingssecret123456',
    'sk-live-settings-secret',
    'private-runtime-profile',
    'private/provider-model',
    'private-project',
    'private-peer-workspace',
    '/Applications/workspace',
    '/Users/alice',
  ]) {
    assert.doesNotMatch(html, new RegExp(escapeRegExp(forbidden)), forbidden);
  }

  assert.match(html, /Workspace path: present \(masked\)|Workspace Path/);
  assert.match(html, /API key: present \(masked\)/);
  assert.match(html, /Runtime Profile|Runtime profile/);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
