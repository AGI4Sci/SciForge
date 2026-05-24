import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultSciForgeConfig } from '../../config';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import {
  Sidebar,
  TopBar,
  buildSidebarProjectThreadGroups,
  buildSidebarSearchMatches,
  buildSidebarThreadItems,
  sidebarThreadTitle,
} from './ShellPanels';

test('sidebar thread list stays empty for seed-only default chats', () => {
  const sessions = {
    'literature-evidence-review': session({
      sessionId: 'seed-session',
      messages: [{ id: 'seed-1', role: 'scenario', content: 'demo', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  };

  assert.deepEqual(buildSidebarThreadItems(sessions), []);
});

test('sidebar thread title falls back from evidence refs to the user prompt', () => {
  const item = session({
    title: 'artifact:research-report',
    messages: [{ id: 'user-1', role: 'user', content: '请总结这篇论文的局限', createdAt: '2026-05-21T00:00:00.000Z' }],
  });

  assert.equal(sidebarThreadTitle(item), '请总结这篇论文的局限');
});

test('sidebar thread detail uses user semantics instead of internal counts', () => {
  const items = buildSidebarThreadItems({
    'literature-evidence-review': session({
      sessionId: 'semantic-thread',
      title: 'provider:model run-internal-123',
      messages: [
        { id: 'user-1', role: 'user', content: '请总结这篇论文的局限', createdAt: '2026-05-21T00:00:00.000Z' },
        { id: 'scenario-1', role: 'scenario', content: '已生成一份总结报告。', createdAt: '2026-05-21T00:01:00.000Z' },
      ],
      runs: [{
        id: 'run-internal-123',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: 'internal prompt',
        response: 'internal response',
        createdAt: '2026-05-21T00:01:00.000Z',
      }],
      artifacts: [{
        id: 'artifact-internal',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
      }] as SciForgeSession['artifacts'],
    }),
  });

  assert.equal(items[0]?.title, '请总结这篇论文的局限');
  assert.equal(items[0]?.detail, '最近回答：已生成一份总结报告。');
  assert.doesNotMatch(`${items[0]?.title} ${items[0]?.detail}`, /messages?|runs?|artifacts?|ExecutionUnit|provider|model|profile|runtime codex|run id|run-internal|stdout|stderr/i);
});

test('sidebar thread detail folds internal-only latest messages', () => {
  const items = buildSidebarThreadItems({
    'literature-evidence-review': session({
      sessionId: 'internal-latest-thread',
      title: '可读标题',
      messages: [
        { id: 'user-1', role: 'user', content: '继续完善报告', createdAt: '2026-05-21T00:00:00.000Z' },
        { id: 'scenario-1', role: 'scenario', content: 'provider model raw JSONL stdout stderr run-internal-123', createdAt: '2026-05-21T00:01:00.000Z' },
      ],
    }),
  });

  assert.equal(items[0]?.detail, '最近有新进展');
  assert.doesNotMatch(`${items[0]?.title} ${items[0]?.detail}`, /provider|model|raw JSONL|stdout|stderr|run-internal/i);
});

test('sidebar project groups show current project, peer projects, and top-k threads', () => {
  const sessions = Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const n = index + 1;
    return [`scenario-${n}`, session({
      scenarioId: `scenario-${n}`,
      sessionId: `thread-${n}`,
      title: `线程 ${n}`,
      messages: [{ id: `user-${n}`, role: 'user', content: `问题 ${n}`, createdAt: `2026-05-21T00:0${index}:00.000Z` }],
      updatedAt: `2026-05-21T00:0${index}:00.000Z`,
    })];
  })) as Record<ScenarioInstanceId, SciForgeSession>;

  const groups = buildSidebarProjectThreadGroups({
    ...defaultSciForgeConfig,
    workspacePath: '/workspace/SciForge',
    peerInstances: [{
      name: 'AgentServer',
      appUrl: 'http://127.0.0.1:5174',
      workspaceWriterUrl: 'http://127.0.0.1:6174',
      workspacePath: '/workspace/AgentServer',
      role: 'peer',
      trustLevel: 'readonly',
      enabled: true,
    }],
  }, sessions);

  assert.equal(groups[0]?.label, 'SciForge');
  assert.equal(groups[0]?.threads.length, 6);
  assert.equal(groups[1]?.label, 'AgentServer');
  assert.deepEqual(groups[1]?.threads, []);
});

test('sidebar project chat markup keeps only top-k threads visible by default', () => {
  const sessions = Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const n = index + 1;
    return [`scenario-${n}`, session({
      scenarioId: `scenario-${n}`,
      sessionId: `thread-${n}`,
      title: `线程 ${n}`,
      messages: [{ id: `user-${n}`, role: 'user', content: `问题 ${n}`, createdAt: `2026-05-21T00:0${index}:00.000Z` }],
      updatedAt: `2026-05-21T00:0${index}:00.000Z`,
    })];
  })) as Record<ScenarioInstanceId, SciForgeSession>;

  const html = renderToStaticMarkup(React.createElement(Sidebar, {
    page: 'workbench',
    setPage: () => undefined,
    scenarioId: 'scenario-1',
    setScenarioId: () => undefined,
    config: { ...defaultSciForgeConfig, workspacePath: '/tmp/SciForge' },
    sessionsByScenario: sessions,
    archivedSessions: [],
    onNewChat: () => undefined,
    onSearchNavigate: () => undefined,
    onSettingsOpen: () => undefined,
    workspaceStatus: '已连接',
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /项目对话/);
  assert.match(html, /SciForge/);
  assert.match(html, /展开显示/);
  assert.match(html, /2 条/);
  assert.match(html, /线程 6/);
  assert.match(html, /线程 3/);
  assert.doesNotMatch(html, /线程 2/);
  assert.doesNotMatch(html, /线程 1/);
});

test('sidebar shell renders Codex-style navigation labels without internal runtime terms', () => {
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(Sidebar, {
      page: 'workbench',
      setPage: () => undefined,
      scenarioId: 'literature-evidence-review',
      setScenarioId: () => undefined,
      config: {
        ...defaultSciForgeConfig,
        workspacePath: '/tmp/sciforge-project',
        runtimeProfile: 'sciforge-runtime-deepseek',
        modelProvider: 'sciforge-deepseek-proxy',
        modelName: 'bailian/deepseek-v4-flash',
      },
      sessionsByScenario: {
        'literature-evidence-review': session({
          sessionId: 'sidebar-dom-thread',
          title: 'provider model run-internal-123',
          messages: [
            { id: 'user-1', role: 'user', content: '整理今天的研究计划', createdAt: '2026-05-21T00:00:00.000Z' },
            { id: 'scenario-1', role: 'scenario', content: '已整理计划。', createdAt: '2026-05-21T00:01:00.000Z' },
          ],
          runs: [{
            id: 'run-internal-123',
            scenarioId: 'literature-evidence-review',
            status: 'completed',
            prompt: 'internal prompt',
            response: 'internal response',
            createdAt: '2026-05-21T00:01:00.000Z',
          }],
        }),
      } as Record<ScenarioInstanceId, SciForgeSession>,
      archivedSessions: [],
      onNewChat: () => undefined,
      onSearchNavigate: () => undefined,
      onSettingsOpen: () => undefined,
      workspaceStatus: '已连接',
      onWorkspacePathChange: () => undefined,
    }),
    React.createElement(TopBar, {
      onSearch: () => undefined,
      onSettingsOpen: () => undefined,
      theme: 'dark',
      onThemeToggle: () => undefined,
      healthItems: [],
    }),
  ));

  for (const label of ['新聊天', '搜索聊天、项目、页面', '项目对话', '项目', '应用', '自动化', '设置', '注释', 'SciForge · 就绪']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /最近回答：已整理计划。/);
  assert.doesNotMatch(html, /sciforge-runtime-deepseek|sciforge-deepseek-proxy|bailian\/deepseek-v4-flash/);
  assert.doesNotMatch(html, /\b\d+\s+(?:messages?|runs?|artifacts?)\b|>\d+\s+(?:条消息|轮处理|个结果)</i);
  assert.doesNotMatch(html, /ExecutionUnit|provider|model|profile|runtime codex|run id|run-internal|stdout|stderr|raw JSONL|ConversationProjection|ArtifactDelivery/i);
  assert.doesNotMatch(html, />Threads<|>Projects<|>Plugins<|>Automations<|>Settings<|>\d+ actions<|>ready</);
});

test('sidebar search returns concise matches and empty arrays for misses', () => {
  const sessions = {
    'structure-exploration': session({
      scenarioId: 'structure-exploration',
      sessionId: 'protein-thread',
      title: 'Protein pocket review',
      messages: [{ id: 'user-1', role: 'user', content: 'find pockets', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  };

  assert.ok(buildSidebarSearchMatches('protein', sessions).some((match) => match.id === 'thread:protein-thread'));
  assert.ok(buildSidebarSearchMatches('timeline', sessions).some((match) => match.page === 'timeline'));
  assert.deepEqual(buildSidebarSearchMatches('zzzz-no-result', sessions), []);
});

function session(patch: Partial<SciForgeSession> = {}): SciForgeSession {
  const scenarioId = patch.scenarioId ?? 'literature-evidence-review';
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: scenarioId as ScenarioInstanceId,
    title: '默认聊天',
    createdAt: '2026-05-21T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-21T00:01:00.000Z',
    ...patch,
  };
}
