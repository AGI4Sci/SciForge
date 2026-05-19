import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RuntimeHealthPanel } from './runtimeHealthPanel';
import type { RuntimeHealthItem } from '../runtimeHealth';

test('Runtime Health 面板展示 Codex Runtime 而不是把 AgentServer 当默认运行时', () => {
  const items: RuntimeHealthItem[] = [
    { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
    { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: 'http://127.0.0.1:5174' },
    { id: 'codex-runtime', label: 'Codex Runtime', status: 'online', detail: 'Runtime Profile sciforge-runtime-deepseek' },
    { id: 'model', label: 'Model Provider', status: 'online', detail: 'sciforge-deepseek-proxy · bailian/deepseek-v4-flash' },
    { id: 'library', label: 'Scenario Library', status: 'optional', detail: '可先导入官方 package 或编译新场景' },
  ];

  const html = renderToStaticMarkup(React.createElement(RuntimeHealthPanel, { items }));

  assert.match(html, /Runtime Health/);
  assert.match(html, /Codex Runtime/);
  assert.match(html, /Runtime Profile sciforge-runtime-deepseek/);
  assert.match(html, /Model Provider/);
  assert.doesNotMatch(html, /AgentServer/);
});
