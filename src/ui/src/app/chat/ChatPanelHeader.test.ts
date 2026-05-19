import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Search } from 'lucide-react';

import { defaultSciForgeConfig, updateConfig } from '../../config';
import { ChatPanelHeader } from './ChatPanelHeader';
import type { ScenarioViewConfig } from '../../data';

const scenario: ScenarioViewConfig = {
  id: 'literature-evidence-review',
  name: 'Literature',
  domain: 'literature',
  desc: 'test',
  icon: Search,
  color: '#38bdf8',
  tools: [],
  status: 'active',
  defaultResult: '',
};

test('聊天头部展示 Runtime Codex 的 provider、model 和 profile', () => {
  const html = renderToStaticMarkup(React.createElement(ChatPanelHeader, {
    scenario,
    config: updateConfig(defaultSciForgeConfig, {}),
    archivedCount: 0,
    isSending: false,
    onConfigChange: () => undefined,
    onNewChat: () => undefined,
    onToggleHistory: () => undefined,
    onAbort: () => undefined,
    onExport: () => undefined,
    onDeleteChat: () => undefined,
  }));

  assert.match(html, /sciforge-runtime-deepseek/);
  assert.match(html, /sciforge-deepseek-proxy/);
  assert.match(html, /bailian\/deepseek-v4-flash/);
  assert.match(html, />runtime</);
  assert.doesNotMatch(html, /AgentServer/);
});
