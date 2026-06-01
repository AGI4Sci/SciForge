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
    chatTitle: 'Literature review thread',
    requestId: 'session:public-session',
    archivedCount: 2,
    isSending: false,
    actions: [],
    onConfigChange: () => undefined,
    onNewChat: () => undefined,
    onToggleHistory: () => undefined,
    onAbort: () => undefined,
    onExport: () => undefined,
    onDeleteChat: () => undefined,
    onAction: () => undefined,
  }));

  assert.match(html, /Chat title\./);
  assert.match(html, /Literature review thread/);
  assert.match(html, /Online/);
  assert.match(html, /2 archived/);
  assert.doesNotMatch(html, /sciforge-runtime-deepseek/);
  assert.doesNotMatch(html, /sciforge-deepseek-proxy/);
  assert.doesNotMatch(html, /bailian\/deepseek-v4-flash/);
  assert.doesNotMatch(html, /provider|model|profile|runtime codex|run id/i);
  assert.doesNotMatch(html, /AgentServer/);
});

test('聊天头部 actions menu exposes Cursor-like actions with shortcuts and typed ids', () => {
  const html = renderToStaticMarkup(React.createElement(ChatPanelHeader, {
    scenario,
    config: defaultSciForgeConfig,
    chatTitle: 'Current thread',
    requestId: 'run:run-public',
    archivedCount: 0,
    isSending: false,
    actions: [
      {
        id: 'split-right',
        label: 'Split Right',
        shortcut: '⌘D',
        effect: 'presentation',
        commandText: '/chat split --direction right --presentation-only',
        auditBoundary: 'presentation-only',
      },
      {
        id: 'split-down',
        label: 'Split Down',
        shortcut: '⇧⌘D',
        effect: 'presentation',
        commandText: '/chat split --direction down --presentation-only',
        auditBoundary: 'presentation-only',
      },
      {
        id: 'fork-chat',
        label: 'Fork Chat',
        effect: 'thread-lifecycle',
        commandText: '/chat fork --from-current-thread',
        auditBoundary: 'thread lifecycle',
      },
      {
        id: 'copy-messages',
        label: 'Copy Messages',
        effect: 'clipboard',
        commandText: '/chat copy --messages --semantic-transcript',
        auditBoundary: 'clipboard',
      },
      {
        id: 'copy-request-id',
        label: 'Copy Request ID',
        effect: 'clipboard',
        commandText: '/chat copy --request-id --public-id-only',
        auditBoundary: 'clipboard',
      },
      {
        id: 'archive-chat',
        label: 'Archive',
        shortcut: '⇧⌘E',
        effect: 'thread-lifecycle',
        commandText: '/chat archive --current-thread',
        auditBoundary: 'archive',
      },
    ],
    onConfigChange: () => undefined,
    onNewChat: () => undefined,
    onToggleHistory: () => undefined,
    onAbort: () => undefined,
    onExport: () => undefined,
    onDeleteChat: () => undefined,
    onAction: () => undefined,
  }));

  for (const id of ['split-right', 'split-down', 'fork-chat', 'copy-messages', 'copy-request-id', 'archive-chat']) {
    assert.match(html, new RegExp(`data-chat-action="${id}"`));
  }
  for (const label of ['Split Right', 'Split Down', 'Fork Chat', 'Copy Messages', 'Copy Request ID', 'Archive']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /⌘D/);
  assert.match(html, /⇧⌘D/);
  assert.match(html, /⇧⌘E/);
  assert.match(html, /run:run-public/);
});
