import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  RuntimeHealthPanel,
  buildRuntimeHealthItems,
  runtimeStartServicesPublicDetail,
  runtimeStartServicesPublicError,
  shouldContinueRuntimeHealthRefresh,
} from './runtimeHealthPanel';
import type { RuntimeHealthItem } from '../runtimeHealth';
import { defaultSciForgeConfig, updateConfig } from '../config';
import { runReadiness } from './chat/runStatusPresentation';

test('Runtime Health 面板展示 Codex Runtime 而不是把 AgentServer 当默认运行时', () => {
  const items: RuntimeHealthItem[] = [
    { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
    { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: 'Workspace Writer configured (masked)' },
    { id: 'codex-runtime', label: 'Codex Runtime', status: 'online', detail: 'Runtime profile configured' },
    { id: 'model', label: 'Model Provider', status: 'online', detail: 'Model provider configured (API key masked)' },
    { id: 'library', label: 'Scenario Library', status: 'optional', detail: '可先导入官方 package 或编译新场景' },
  ];

  const html = renderToStaticMarkup(React.createElement(RuntimeHealthPanel, { items }));

  assert.match(html, /Runtime Health/);
  assert.match(html, /Codex Runtime/);
  assert.match(html, /Runtime profile configured/);
  assert.match(html, /Model Provider/);
  assert.doesNotMatch(html, /AgentServer/);
  assert.doesNotMatch(html, /127\.0\.0\.1|sciforge-runtime-deepseek|bailian\/deepseek/);
});

test('Runtime Health start-service status projects arbitrary service records publicly', () => {
  const detail = runtimeStartServicesPublicDetail({
    ok: false,
    services: [{
      id: 'writer http://127.0.0.1:6173',
      label: 'Workspace Writer /Applications/private/workspace token=github_pat_1234567890abcdef',
      status: 'failed with stdout and sk-runtime-secret-123456',
    }],
    error: 'failed at http://127.0.0.1:6173 with /Applications/private/workspace',
  });
  const error = runtimeStartServicesPublicError(new Error('stderr from http://127.0.0.1:6173 sk-runtime-secret-123456 /Applications/private/workspace'));
  const combined = `${detail}\n${error}`;

  assert.doesNotMatch(combined, /127\.0\.0\.1|github_pat_1234567890abcdef|sk-runtime-secret|\/Applications\/private|stdout|stderr/);
  assert.match(combined, /\[redacted-url\]|\[redacted-path\]|\[redacted-secret\]|runtime audit/);
});

test('Runtime Health retries a desktop dynamic writer before keeping stale static default diagnostics', async () => {
  const dynamicWriter = 'http://127.0.0.1:60993';
  const staticDefaultWriter = defaultSciForgeConfig.workspaceWriterBaseUrl.replace(/\/+$/, '');
  const attempts: string[] = [];
  const config = updateConfig(defaultSciForgeConfig, {
    workspaceWriterBaseUrl: dynamicWriter,
    workspacePath: '/tmp/sciforge-desktop-workspace',
    modelProvider: 'sciforge-model-router',
    modelName: 'sciforge-router',
    apiKey: 'configured-key',
  });
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    attempts.push(url);
    if (url === `${dynamicWriter}/health` && attempts.filter((entry) => entry === url).length === 1) {
      throw new Error('dynamic writer is still starting');
    }
    if (url === `${dynamicWriter}/health`) {
      return jsonResponse({
        ok: true,
        service: 'sciforge-workspace-writer',
        capabilities: ['runtime-module-dispatcher', 'browser-host-session', 'browser-host-native-surface'],
      });
    }
    if (url === `${staticDefaultWriter}/health`) {
      return jsonResponse({
        ok: true,
        service: 'sciforge-workspace-writer',
        capabilities: ['runtime-module-dispatcher'],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const items = await buildRuntimeHealthItems(config, 0, {
    fetchImpl: fetchImpl as typeof fetch,
    retryAttempts: 2,
    retryDelayMs: 0,
    allowStaticDefaultProbe: false,
  });

  const workspace = items.find((item) => item.id === 'workspace');
  assert.equal(workspace?.status, 'online');
  assert.equal(workspace?.recoverAction, undefined);
  assert.deepEqual(attempts.filter((entry) => entry === `${dynamicWriter}/health`), [
    `${dynamicWriter}/health`,
    `${dynamicWriter}/health`,
  ]);
  assert.equal(attempts.some((entry) => entry === `${staticDefaultWriter}/health`), false);
  const readiness = runReadiness({ input: 'search with browser', isSending: false, config, runtimeHealth: items });
  assert.equal(readiness.ok, true);
  assert.doesNotMatch(readiness.message, /Workspace Writer is not ready|改回默认值|default writer/i);
});

test('Runtime Health keeps refreshing stale desktop sidecar startup states without retrying ordinary web pages forever', () => {
  const staleDesktopItems: RuntimeHealthItem[] = [
    { id: 'ui', label: 'Web UI', status: 'online', detail: 'loaded' },
    { id: 'workspace', label: 'Workspace Writer', status: 'offline', detail: 'Workspace Writer configured (masked)' },
    { id: 'codex-runtime', label: 'Codex Runtime', status: 'checking', detail: 'Runtime profile configured' },
  ];
  const readyDesktopItems: RuntimeHealthItem[] = [
    { id: 'ui', label: 'Web UI', status: 'online', detail: 'loaded' },
    { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: 'Workspace Writer configured (masked)' },
    { id: 'codex-runtime', label: 'Codex Runtime', status: 'online', detail: 'Runtime profile configured' },
  ];

  assert.equal(shouldContinueRuntimeHealthRefresh(staleDesktopItems, { desktopBridgeAvailable: true, elapsedMs: 10_000 }), true);
  assert.equal(shouldContinueRuntimeHealthRefresh(staleDesktopItems, { desktopBridgeAvailable: false, elapsedMs: 10_000 }), false);
  assert.equal(shouldContinueRuntimeHealthRefresh(staleDesktopItems, { desktopBridgeAvailable: true, elapsedMs: 91_000 }), false);
  assert.equal(shouldContinueRuntimeHealthRefresh(readyDesktopItems, { desktopBridgeAvailable: true, elapsedMs: 10_000 }), false);
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
