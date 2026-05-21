import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Search } from 'lucide-react';

import { defaultSciForgeConfig } from '../../config';
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

test('聊天头部保持 Codex-style 低噪声，不展示 runtime/provider/model/profile', () => {
  const html = renderToStaticMarkup(React.createElement(ChatPanelHeader, {
    scenario,
    config: {
      ...defaultSciForgeConfig,
      runtimeProfile: 'sciforge-runtime-deepseek',
      modelProvider: 'sciforge-deepseek-proxy',
      modelName: 'bailian/deepseek-v4-flash',
    },
    archivedCount: 2,
    isSending: false,
    onConfigChange: () => undefined,
    onNewChat: () => undefined,
    onToggleHistory: () => undefined,
    onAbort: () => undefined,
    onExport: () => undefined,
    onDeleteChat: () => undefined,
  }));

  assert.match(html, /Ask SciForge/);
  assert.match(html, /在线/);
  assert.match(html, /2 已归档/);
  assert.doesNotMatch(html, /archived/);
  assert.doesNotMatch(html, /sciforge-runtime-deepseek/);
  assert.doesNotMatch(html, /sciforge-deepseek-proxy/);
  assert.doesNotMatch(html, /bailian\/deepseek-v4-flash/);
  assert.doesNotMatch(html, /provider|model|profile|runtime codex|run id/i);
  assert.doesNotMatch(html, /AgentServer/);
});
