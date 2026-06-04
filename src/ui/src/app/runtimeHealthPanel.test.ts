import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RuntimeHealthPanel, runtimeStartServicesPublicDetail, runtimeStartServicesPublicError } from './runtimeHealthPanel';
import type { RuntimeHealthItem } from '../runtimeHealth';

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
