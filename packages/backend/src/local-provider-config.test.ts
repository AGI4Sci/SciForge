import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  agentServerEnvFromLocalSettings,
  computerUseWorkspaceEnvFromLocalSettings,
  LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS,
  localProviderSettings,
  providerEnvFromLocalSettings,
  readLocalProviderSettings,
  runtimeCodexEnvFromLocalSettings,
  virtualAppScreenEnvFromLocalSettings,
} from './local-provider-config';

test('local provider settings preserve dev launcher precedence across root llm textLLM and proxy config', () => {
  const settings = localProviderSettings({
    apiKey: 'root-key',
    modelBaseUrl: 'https://root.example/v1///',
    modelName: 'root-model',
    llm: {
      apiKey: 'llm-key',
      baseUrl: 'https://llm.example/v1',
      model: 'llm-model',
    },
    textLLM: {
      apiKey: 'text-key',
      baseUrl: 'https://text.example/v1',
      model: 'text-model',
      env: {
        SCIFORGE_RUNTIME_API_KEY: 'text-env-key',
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://text-env.example/v1',
      },
    },
    codexProxy: {
      apiKey: 'proxy-key',
      upstreamBaseUrl: 'https://proxy.example/v1',
      defaultModel: 'proxy-model',
    },
  });

  assert.equal(settings.apiKey, 'root-key');
  assert.equal(settings.baseUrl, 'https://root.example/v1');
  assert.equal(settings.model, 'root-model');
});

test('local provider settings read textLLM env fallback before codex proxy', () => {
  const settings = localProviderSettings({
    textLLM: {
      env: {
        SCIFORGE_RUNTIME_API_KEY: 'text-env-key',
        SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://text-env.example/v1/',
      },
    },
    codexProxy: {
      apiKey: 'proxy-key',
      upstreamBaseUrl: 'https://proxy.example/v1',
    },
  });

  assert.equal(settings.apiKey, 'text-env-key');
  assert.equal(settings.baseUrl, 'https://text-env.example/v1');
  assert.deepEqual(providerEnvFromLocalSettings(settings), {
    SCIFORGE_RUNTIME_API_KEY: 'text-env-key',
    SCIFORGE_RUNTIME_BASE_URL: 'https://text-env.example/v1',
    SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://text-env.example/v1',
  });
});

test('local provider settings support runtimeCodexProxy alias and source metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sciforge-local-provider-'));
  const configPath = join(dir, 'config.local.json');
  writeFileSync(configPath, JSON.stringify({
    runtimeProvider: 'openai-compatible',
    runtimeCodexProxy: {
      apiKey: 'runtime-proxy-key',
      baseUrl: 'https://runtime-proxy.example/v1',
      model: 'runtime-proxy-model',
      forceNonStreamingUpstream: true,
    },
  }));

  const settings = readLocalProviderSettings(configPath);

  assert.equal(settings.apiKey, 'runtime-proxy-key');
  assert.equal(settings.apiKeySource, `${configPath}:runtimeCodexProxy.apiKey`);
  assert.equal(settings.provider, 'openai-compatible');
  assert.equal(settings.baseUrl, 'https://runtime-proxy.example/v1');
  assert.equal(settings.model, 'runtime-proxy-model');
  assert.equal(settings.forceNonStreamingUpstream, true);
});

test('local provider settings fall back from empty codexProxy fields to runtimeCodexProxy', () => {
  const settings = localProviderSettings({
    llm: {
      provider: 'llm-provider',
    },
    codexProxy: {},
    runtimeCodexProxy: {
      apiKey: 'runtime-proxy-key',
      upstreamBaseUrl: 'https://runtime-proxy.example/v1',
      defaultModel: 'runtime-model',
    },
  });

  assert.equal(settings.provider, 'llm-provider');
  assert.equal(settings.apiKey, 'runtime-proxy-key');
  assert.equal(settings.baseUrl, 'https://runtime-proxy.example/v1');
  assert.equal(settings.model, 'runtime-model');
});

test('agent server env uses the same shared local provider settings', () => {
  const env = agentServerEnvFromLocalSettings(localProviderSettings({
    textLLM: {
      provider: 'text-provider',
      apiKey: 'text-key',
      baseUrl: 'https://text.example/v1/',
      model: 'text-model',
    },
  }));

  assert.equal(env.AGENT_SERVER_MODEL_PROVIDER, 'text-provider');
  assert.equal(env.AGENT_SERVER_ADAPTER_LLM_PROVIDER, 'text-provider');
  assert.equal(env.AGENT_SERVER_MODEL_API_KEY, 'text-key');
  assert.equal(env.AGENT_SERVER_MODEL_BASE_URL, 'https://text.example/v1');
  assert.equal(env.AGENT_SERVER_MODEL, 'text-model');
  assert.equal(env.AGENT_SERVER_MODEL_NAME, 'text-model');
  assert.equal(env.AGENT_SERVER_ADAPTER_LLM_MODEL, 'text-model');
});

test('local provider settings expose only safe VirtualAppScreen native driver env', () => {
  const settings = localProviderSettings({
    computerUse: {
      virtualAppScreen: {
        env: {
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: true,
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON: {
            kind: 'vscode-editor',
            bundleId: 'com.microsoft.VSCode',
          },
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON: [
            'run',
            'virtual-app-screen-macos-pid-scoped-ax-hook',
            '--silent',
          ],
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS: 45000,
          SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_PERMISSION_GRANTS: true,
          SCIFORGE_RUNTIME_API_KEY: 'must-not-leak',
          EMPTY_VALUE: '',
        },
      },
    },
  });

  assert.deepEqual(virtualAppScreenEnvFromLocalSettings(settings), {
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: '1',
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_JSON: JSON.stringify({
      kind: 'vscode-editor',
      bundleId: 'com.microsoft.VSCode',
    }),
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_ARGS_JSON: JSON.stringify([
      'run',
      'virtual-app-screen-macos-pid-scoped-ax-hook',
      '--silent',
    ]),
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_INPUT_CONTROL_HOOK_TIMEOUT_MS: '45000',
  });
});

test('local provider settings support root VirtualAppScreen env aliases without merging them into provider env', () => {
  const settings = localProviderSettings({
    apiKey: 'root-key',
    virtualAppScreen: {
      env: {
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: 'word',
        SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN: '.*',
      },
    },
  });

  assert.deepEqual(virtualAppScreenEnvFromLocalSettings(settings), {
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: 'word',
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_WINDOW_TITLE_PATTERN: '.*',
  });
  assert.deepEqual(providerEnvFromLocalSettings(settings), {
    SCIFORGE_RUNTIME_API_KEY: 'root-key',
  });
});

test('runtime codex env keeps VirtualAppScreen native driver env out of the app-server boundary', () => {
  const settings = localProviderSettings({
    apiKey: 'root-key',
    modelName: 'root-model',
    computerUse: {
      virtualAppScreen: {
        env: {
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: true,
          SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: 'vscode-editor',
        },
      },
    },
  });

  assert.deepEqual(runtimeCodexEnvFromLocalSettings(settings), {
    SCIFORGE_RUNTIME_API_KEY: 'root-key',
    SCIFORGE_RUNTIME_MODEL: 'root-model',
  });
  assert.deepEqual(computerUseWorkspaceEnvFromLocalSettings(settings), {
    SCIFORGE_RUNTIME_API_KEY: 'root-key',
    SCIFORGE_RUNTIME_MODEL: 'root-model',
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_HOOKS: '1',
    SCIFORGE_VIRTUAL_APP_SCREEN_NATIVE_DRIVER_TARGET_APP_KIND: 'vscode-editor',
  });
});

test('local provider api key candidate paths include textLLM env and runtimeCodexProxy', () => {
  assert.ok(LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS.some((path) => path.join('.') === 'textLLM.env.SCIFORGE_RUNTIME_API_KEY'));
  assert.ok(LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS.some((path) => path.join('.') === 'runtimeCodexProxy.apiKey'));
});
