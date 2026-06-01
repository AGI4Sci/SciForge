import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultSciForgeConfig } from '../../config';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import { I18nProvider } from '../../i18nContext';
import {
  Sidebar,
  TopBar,
  buildSidebarCursorAgentProjectionForShell,
  buildSidebarArchivedThreadItems,
  buildSidebarProjectThreadGroups,
  buildSidebarSearchMatches,
  buildSidebarThreadItems,
  findSidebarThreadSearchTarget,
  sidebarThreadTitle,
} from './ShellPanels';
import { createOptimisticUserTurnSession } from '../chat/sessionTransforms';

test('archived sessions stay out of the active sidebar thread list', () => {
  const active = session({
    sessionId: 'active-thread',
    title: 'Current chat',
    messages: [{ id: 'user-1', role: 'user', content: 'hello', createdAt: '2026-05-21T00:00:00.000Z' }],
  });
  const archived = session({
    sessionId: 'archived-thread',
    title: 'Archived chat',
    messages: [{ id: 'user-2', role: 'user', content: 'old chat', createdAt: '2026-05-20T00:00:00.000Z' }],
  });

  const items = buildSidebarThreadItems({
    'literature-evidence-review': active,
  });

  assert.deepEqual(items.map((item) => item.sessionId), ['active-thread']);
  assert.ok(buildSidebarArchivedThreadItems([archived]).some((item) => item.sessionId === 'archived-thread'));
});

test('sidebar thread list stays empty for seed-only default chats', () => {
  const sessions = {
    'literature-evidence-review': session({
      sessionId: 'seed-session',
      messages: [{ id: 'seed-1', role: 'scenario', content: 'demo', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  };

  assert.deepEqual(buildSidebarThreadItems(sessions), []);
});

test('sidebar thread items expose strict runtime states for row status and actions', () => {
  const items = buildSidebarThreadItems({
    running: session({
      scenarioId: 'running' as ScenarioInstanceId,
      sessionId: 'running-thread',
      title: 'Running thread',
      runs: [{
        id: 'run-running',
        scenarioId: 'running' as ScenarioInstanceId,
        status: 'running',
        prompt: 'run analysis',
        response: '',
        createdAt: '2026-05-21T00:03:00.000Z',
      }],
      updatedAt: '2026-05-21T00:03:00.000Z',
    }),
    blocked: session({
      scenarioId: 'blocked' as ScenarioInstanceId,
      sessionId: 'blocked-thread',
      title: 'Blocked thread',
      executionUnits: [{
        id: 'unit-blocked',
        tool: 'analysis.task',
        params: '{}',
        status: 'needs-human',
        hash: 'hash-blocked',
      }],
      updatedAt: '2026-05-21T00:02:00.000Z',
    }),
    failed: session({
      scenarioId: 'failed' as ScenarioInstanceId,
      sessionId: 'failed-thread',
      title: 'Failed thread',
      runs: [{
        id: 'run-failed',
        scenarioId: 'failed' as ScenarioInstanceId,
        status: 'failed',
        prompt: 'run analysis',
        response: 'failed',
        createdAt: '2026-05-21T00:01:00.000Z',
      }],
      updatedAt: '2026-05-21T00:01:00.000Z',
    }),
    done: session({
      scenarioId: 'done' as ScenarioInstanceId,
      sessionId: 'done-thread',
      title: 'Done thread',
      messages: [{ id: 'user-1', role: 'user', content: 'finished prompt', createdAt: '2026-05-21T00:00:00.000Z' }],
      updatedAt: '2026-05-21T00:00:00.000Z',
    }),
  }, { limit: 10 });

  const states = new Map(items.map((item) => [item.sessionId, item.state]));
  assert.equal(states.get('running-thread'), 'running');
  assert.equal(states.get('blocked-thread'), 'blocked');
  assert.equal(states.get('failed-thread'), 'failed');
  assert.equal(states.get('done-thread'), 'done');
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
  assert.equal(items[0]?.detail, 'Last answer: 已生成一份总结报告。');
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

  assert.equal(items[0]?.detail, 'Recent progress');
  assert.doesNotMatch(`${items[0]?.title} ${items[0]?.detail}`, /provider|model|raw JSONL|stdout|stderr|run-internal/i);
});

test('sidebar thread detail folds raw webpage dumps before previewing latest answer', () => {
  const items = buildSidebarThreadItems({
    'literature-evidence-review': session({
      sessionId: 'raw-webpage-latest-thread',
      title: '单细胞论文检索',
      messages: [
        { id: 'user-1', role: 'user', content: '检索最近单细胞基础模型论文', createdAt: '2026-06-01T00:00:00.000Z' },
        {
          id: 'scenario-1',
          role: 'scenario',
          content: '<title>Scoring gene importance by interpreting single-cell foundation models</title>\nQuick links Login Help Pages About\n--- Paper 1 ---\nmetadata abstract search result\n\n## 总结\n最新单细胞基础模型论文概览：SIGnature 和 CITE-VAE 是主要候选。',
          createdAt: '2026-06-01T00:01:00.000Z',
        },
      ],
    }),
  });

  assert.match(items[0]?.detail ?? '', /Last answer: .*最新单细胞基础模型/);
  assert.doesNotMatch(items[0]?.detail ?? '', /<title|Quick links|--- Paper|metadata abstract search result/i);
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

test('sidebar project groups keep full repository history for See more paging', () => {
  const sessions = Object.fromEntries(Array.from({ length: 15 }, (_, index) => {
    const n = index + 1;
    return [`scenario-${n}`, session({
      scenarioId: `scenario-${n}`,
      sessionId: `thread-${n}`,
      title: `Thread ${n}`,
      messages: [{ id: `user-${n}`, role: 'user', content: `Question ${n}`, createdAt: `2026-05-21T00:${String(index).padStart(2, '0')}:00.000Z` }],
      updatedAt: `2026-05-21T00:${String(index).padStart(2, '0')}:00.000Z`,
    })];
  })) as Record<ScenarioInstanceId, SciForgeSession>;

  const groups = buildSidebarProjectThreadGroups({
    ...defaultSciForgeConfig,
    workspacePath: '/workspace/SciForge',
  }, sessions);

  assert.equal(groups[0]?.threads.length, 15);
  assert.deepEqual(groups[0]?.threads.slice(0, 3).map((thread) => thread.title), ['Thread 15', 'Thread 14', 'Thread 13']);
  assert.equal(groups[0]?.threads.at(-1)?.title, 'Thread 1');
});

test('sidebar project groups support Cursor-like workspace updated status environment and manual ordering', () => {
  const config = {
    ...defaultSciForgeConfig,
    workspacePath: '/workspace/current',
    peerInstances: [{
      name: 'alpha',
      appUrl: '',
      workspaceWriterUrl: '',
      workspacePath: '/workspace/alpha',
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }, {
      name: 'beta',
      appUrl: '',
      workspaceWriterUrl: '',
      workspacePath: '/workspace/beta',
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };
  const current = session({
    scenarioId: 'current-scenario' as ScenarioInstanceId,
    sessionId: 'current-thread',
    title: 'Current finished',
    messages: [{ id: 'user-current', role: 'user', content: 'current done', createdAt: '2026-05-21T00:00:00.000Z' }],
    updatedAt: '2026-05-21T00:02:00.000Z',
  });
  const alpha = session({
    scenarioId: 'alpha-scenario' as ScenarioInstanceId,
    sessionId: 'alpha-running',
    title: 'Alpha running',
    runs: [{
      id: 'run-alpha',
      scenarioId: 'alpha-scenario' as ScenarioInstanceId,
      status: 'running',
      prompt: 'run alpha',
      response: '',
      createdAt: '2026-05-21T00:03:00.000Z',
    }],
    updatedAt: '2026-05-21T00:03:00.000Z',
  });
  const beta = session({
    scenarioId: 'beta-scenario' as ScenarioInstanceId,
    sessionId: 'beta-failed',
    title: 'Beta failed',
    runs: [{
      id: 'run-beta',
      scenarioId: 'beta-scenario' as ScenarioInstanceId,
      status: 'failed',
      prompt: 'run beta',
      response: 'failed',
      createdAt: '2026-05-21T00:01:00.000Z',
    }],
    updatedAt: '2026-05-21T00:01:00.000Z',
  });
  const projectSessionsByPath = {
    '/workspace/current': { sessionsByScenario: { [current.scenarioId]: current }, archivedSessions: [] },
    '/workspace/alpha': { sessionsByScenario: { [alpha.scenarioId]: alpha }, archivedSessions: [] },
    '/workspace/beta': { sessionsByScenario: { [beta.scenarioId]: beta }, archivedSessions: [] },
  };
  const labelsFor = (projectSort: 'manual' | 'workspace' | 'updated' | 'status' | 'environment', projectOrder: string[] = []) => buildSidebarProjectThreadGroups(config, {
    [current.scenarioId]: current,
  }, [], {
    projectSessionsByPath,
    activeWorkspacePath: config.workspacePath,
    projectSort,
    projectOrder,
  }).map((project) => project.label);

  assert.deepEqual(labelsFor('manual', ['/workspace/beta', '/workspace/current', '/workspace/alpha']), ['beta', 'current', 'alpha']);
  assert.deepEqual(labelsFor('workspace'), ['current', 'alpha', 'beta']);
  assert.deepEqual(labelsFor('updated'), ['alpha', 'current', 'beta']);
  assert.deepEqual(labelsFor('status'), ['alpha', 'beta', 'current']);
  assert.deepEqual(labelsFor('environment'), ['current', 'alpha', 'beta']);
});

test('shell sidebar publishes Cursor Agent-like projection without local path refs', () => {
  const sessions = {
    'literature-evidence-review': session({
      sessionId: 'thread-main',
      title: '实验计划',
      messages: [{ id: 'user-1', role: 'user', content: '整理下一步实验', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const archived = session({
    scenarioId: 'structure-exploration',
    sessionId: 'archived-main',
    title: '归档实验',
    archiveState: 'archived',
    messages: [{ id: 'user-2', role: 'user', content: '旧实验记录', createdAt: '2026-05-20T00:00:00.000Z' }],
  });
  const discarded = session({
    scenarioId: 'paper-qa',
    sessionId: 'discarded-main',
    title: 'Temporary chat (deleted)',
    archiveState: 'discarded',
    messages: [{ id: 'user-3', role: 'user', content: '不要保留这段探索', createdAt: '2026-05-19T00:00:00.000Z' }],
    versions: [{
      id: 'version-deleted',
      reason: 'deleted current chat',
      createdAt: '2026-05-19T00:01:00.000Z',
      messageCount: 1,
      runCount: 0,
      artifactCount: 0,
      checksum: 'checksum',
      snapshot: {} as never,
    }],
  });
  const config = {
    ...defaultSciForgeConfig,
    workspacePath: '/tmp/sciforge-project',
    peerInstances: [{
      name: 'Peer Project',
      appUrl: 'http://127.0.0.1:5174',
      workspaceWriterUrl: 'http://127.0.0.1:6174',
      workspacePath: '/tmp/sciforge-peer-project',
      role: 'peer' as const,
      trustLevel: 'readonly' as const,
      enabled: true,
    }],
  };
  const groups = buildSidebarProjectThreadGroups(config, sessions, [archived, discarded], {
    pinnedThreadIds: ['thread-main'],
  });
  const projection = buildSidebarCursorAgentProjectionForShell(config, groups, {
    searchQuery: '实验',
    workspaceStatus: 'Connected',
    currentBranch: 'feature/sidebar',
    activeThreadId: 'thread-main',
    pinnedThreadIds: ['thread-main'],
  });

  assert.equal(projection.kind, 'cursor-agent-like-sidebar');
  assert.equal(projection.groups[0]?.threads[0]?.title, '实验计划');
  assert.equal(projection.groups[0]?.threads[0]?.pinned, true);
  assert.equal(projection.groups[0]?.threads.some((thread) => thread.state === 'archived'), true);
  assert.equal(projection.groups[0]?.threads.some((thread) => thread.state === 'discarded'), true);
  assert.equal(projection.groups[0]?.selected, true);
  assert.equal(projection.groups[0]?.threads.some((thread) => thread.selected), true);
  assert.equal(projection.groups[0]?.status.branch.label, 'feature/sidebar');
  assert.equal(projection.groups[0]?.status.context.detail, '200k available');
  assert.ok(projection.actions.some((action) => action.intent === 'new-project' && action.commandText?.includes('--workspace-ref')));
  assert.ok(projection.actions.some((action) => action.intent === 'open-workspace' && action.commandText?.includes('open-workspace')));
  for (const intent of ['open-repositories', 'open-automations', 'open-customize']) {
    const action = projection.presentationActions.find((item) => item.intent === intent);
    assert.equal(action?.effect, 'local-presentation');
    assert.equal(action?.mutates, false);
    assert.equal(action?.commandText, undefined);
  }
  assert.ok(projection.groups.some((group) => group.actions.some((action) => action.intent === 'new-chat')));
  assert.ok(projection.groups.some((group) => !group.current && group.actions.some((action) => action.intent === 'remove-project' && action.commandText?.includes('--keep-files'))));
  assert.doesNotMatch(JSON.stringify(projection), /\/tmp\/sciforge-(?:project|peer-project)|file:\/tmp|provider|model|Authorization|secret|token/i);
});

test('shell sidebar projection keeps seed-only active chat as draft without rendering it as active thread', () => {
  const sessions = {
    'literature-evidence-review': session({
      sessionId: 'draft-thread',
      messages: [{ id: 'seed-1', role: 'scenario', content: 'provider model bootstrap', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const config = { ...defaultSciForgeConfig, workspacePath: '/tmp/sciforge-project' };
  const groups = buildSidebarProjectThreadGroups(config, sessions, [], { activeSessionId: 'draft-thread' });
  const projection = buildSidebarCursorAgentProjectionForShell(config, groups, {
    activeThreadId: 'draft-thread',
  });

  assert.deepEqual(groups[0]?.threads, []);
  assert.equal(projection.groups[0]?.threads[0]?.state, 'draft');
  assert.equal(projection.groups[0]?.threads[0]?.selected, true);
  assert.equal(projection.groups[0]?.threads[0]?.title, 'New chat');
  assert.doesNotMatch(JSON.stringify(projection), /provider|model|bootstrap|\/tmp\/sciforge-project/i);
});

test('shell sidebar selected thread shares the chat title derived from the active session', () => {
  const firstTurn = createOptimisticUserTurnSession({
    baseSession: session({
      sessionId: 'active-first-turn',
      title: 'New chat',
      messages: [],
    }),
    prompt: 'Compare CRISPR delivery evidence',
    references: [],
  });
  const sessions = {
    'literature-evidence-review': firstTurn.session,
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const config = { ...defaultSciForgeConfig, workspacePath: '/tmp/sciforge-project' };
  const groups = buildSidebarProjectThreadGroups(config, sessions, [], {
    activeSessionId: firstTurn.session.sessionId,
    activeWorkspacePath: config.workspacePath,
  });
  const projection = buildSidebarCursorAgentProjectionForShell(config, groups, {
    activeProjectId: groups[0]?.id,
    activeThreadId: firstTurn.session.sessionId,
  });
  const selectedThread = projection.groups[0]?.threads.find((thread) => thread.selected);

  assert.equal(firstTurn.session.title, 'Compare CRISPR delivery evidence');
  assert.equal(groups[0]?.threads[0]?.title, firstTurn.session.title);
  assert.equal(selectedThread?.title, firstTurn.session.title);
  assert.equal(selectedThread?.selected, true);
});

test('shell sidebar hides inactive default drafts from other scenarios', () => {
  const sessions = {
    'literature-evidence-review': session({
      scenarioId: 'literature-evidence-review',
      sessionId: 'current-draft',
      messages: [],
    }),
    'structure-exploration': session({
      scenarioId: 'structure-exploration',
      sessionId: 'inactive-default-draft',
      messages: [{ id: 'seed-1', role: 'scenario', content: 'seed prompt', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  } as Record<ScenarioInstanceId, SciForgeSession>;
  const config = { ...defaultSciForgeConfig, workspacePath: '/tmp/sciforge-project' };
  const groups = buildSidebarProjectThreadGroups(config, sessions, [], { activeSessionId: 'current-draft' });

  assert.deepEqual(groups[0]?.draftThreads?.map((thread) => thread.sessionId), ['current-draft']);
});

test('sidebar project chat markup keeps only Cursor-style top-k repository threads visible by default', () => {
  const sessions = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
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
      onProjectNewChat: () => undefined,
    onSearchNavigate: () => undefined,
    onSettingsOpen: () => undefined,
    workspaceStatus: 'Connected',
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /Repositories/);
  assert.match(html, /New Agent/);
  assert.match(html, /SciForge/);
  assert.match(html, /See more/);
  assert.doesNotMatch(html, /Show more|Show less/);
  assert.doesNotMatch(html, /<small>2<\/small>/);
  assert.match(html, /线程 8/);
  assert.match(html, /线程 3/);
  assert.doesNotMatch(html, /线程 2/);
  assert.doesNotMatch(html, /线程 1/);
});

test('sidebar shell DOM renders active and draft rows while archived and discarded stay out of the main list', () => {
  const html = renderToStaticMarkup(React.createElement(Sidebar, {
    page: 'workbench',
    setPage: () => undefined,
    scenarioId: 'structure-exploration',
    setScenarioId: () => undefined,
    config: { ...defaultSciForgeConfig, workspacePath: '/tmp/SciForge' },
    sessionsByScenario: sessionMap({
      'literature-evidence-review': session({
        scenarioId: 'literature-evidence-review',
        sessionId: 'active-thread',
        title: 'Active research thread',
        messages: [{ id: 'user-active', role: 'user', content: '继续总结论文', createdAt: '2026-05-21T00:00:00.000Z' }],
      }),
      'structure-exploration': session({
        scenarioId: 'structure-exploration',
        sessionId: 'draft-thread',
        messages: [{ id: 'seed-structure', role: 'scenario', content: 'seed prompt', createdAt: '2026-05-21T00:00:00.000Z' }],
      }),
    }),
    archivedSessions: [
      session({
        scenarioId: 'paper-qa',
        sessionId: 'archived-thread',
        title: 'Archived paper notes',
        archiveState: 'archived',
        messages: [{ id: 'user-archived', role: 'user', content: '旧论文笔记', createdAt: '2026-05-20T00:00:00.000Z' }],
      }),
      session({
        scenarioId: 'browser-task',
        sessionId: 'discarded-thread',
        title: 'Discarded scratch chat',
        archiveState: 'discarded',
        messages: [{ id: 'user-discarded', role: 'user', content: '临时探索', createdAt: '2026-05-19T00:00:00.000Z' }],
      }),
    ],
    onProjectNewChat: () => undefined,
    onArchiveThread: () => undefined,
    onDiscardThread: () => undefined,
    onRestoreThread: () => undefined,
    onSearchNavigate: () => undefined,
    onSettingsOpen: () => undefined,
    workspaceStatus: 'Connected',
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /Active research thread/);
  assert.match(html, /New chat/);
  assert.match(html, /Draft ready|Draft/);
  assert.doesNotMatch(html, /Archived paper notes/);
  assert.doesNotMatch(html, /Discarded scratch chat/);
  assert.doesNotMatch(html, /aria-label="Restore chat: Archived paper notes"/);
  assert.doesNotMatch(html, /aria-label="Restore chat: Discarded scratch chat"/);
  assert.match(html, /aria-label="Archive chat: Active research thread"/);
  assert.doesNotMatch(html, /aria-label="Delete chat: Active research thread"/);
  assert.match(html, /aria-label="Discard draft: New chat"/);
  assert.doesNotMatch(html, /aria-label="Archive chat: New chat"/);
});

test('sidebar shell DOM publishes multi-row thread state and action contracts', () => {
  const html = renderToStaticMarkup(React.createElement(Sidebar, {
    page: 'workbench',
    setPage: () => undefined,
    scenarioId: 'draft-scenario' as ScenarioInstanceId,
    setScenarioId: () => undefined,
    config: { ...defaultSciForgeConfig, workspacePath: '/tmp/SciForge' },
    sessionsByScenario: {
      running: session({
        scenarioId: 'running' as ScenarioInstanceId,
        sessionId: 'running-thread',
        title: 'Running thread',
        runs: [{
          id: 'run-running',
          scenarioId: 'running' as ScenarioInstanceId,
          status: 'running',
          prompt: 'run analysis',
          response: '',
          createdAt: '2026-05-21T00:04:00.000Z',
        }],
        updatedAt: '2026-05-21T00:04:00.000Z',
      }),
      blocked: session({
        scenarioId: 'blocked' as ScenarioInstanceId,
        sessionId: 'blocked-thread',
        title: 'Blocked thread',
        executionUnits: [{
          id: 'unit-blocked',
          tool: 'analysis.task',
          params: '{}',
          status: 'needs-human',
          hash: 'hash-blocked',
        }],
        updatedAt: '2026-05-21T00:03:00.000Z',
      }),
      failed: session({
        scenarioId: 'failed' as ScenarioInstanceId,
        sessionId: 'failed-thread',
        title: 'Failed thread',
        runs: [{
          id: 'run-failed',
          scenarioId: 'failed' as ScenarioInstanceId,
          status: 'failed',
          prompt: 'run analysis',
          response: 'failed',
          createdAt: '2026-05-21T00:02:00.000Z',
        }],
        updatedAt: '2026-05-21T00:02:00.000Z',
      }),
      done: session({
        scenarioId: 'done' as ScenarioInstanceId,
        sessionId: 'done-thread',
        title: 'Done thread',
        messages: [{ id: 'user-done', role: 'user', content: 'finished prompt', createdAt: '2026-05-21T00:01:00.000Z' }],
        updatedAt: '2026-05-21T00:01:00.000Z',
      }),
      'draft-scenario': session({
        scenarioId: 'draft-scenario' as ScenarioInstanceId,
        sessionId: 'draft-thread',
        title: 'New chat',
        messages: [],
        updatedAt: '2026-05-21T00:00:00.000Z',
      }),
    } as unknown as Record<ScenarioInstanceId, SciForgeSession>,
    archivedSessions: [],
    onProjectNewChat: () => undefined,
    onArchiveThread: () => undefined,
    onDiscardThread: () => undefined,
    onRestoreThread: () => undefined,
    onSearchNavigate: () => undefined,
    onSettingsOpen: () => undefined,
    workspaceStatus: 'Connected',
    onWorkspacePathChange: () => undefined,
  }));

  assert.equal((html.match(/data-sidebar-thread-row="true"/g) ?? []).length, 5);
  for (const state of ['running', 'blocked', 'failed', 'done', 'draft']) {
    assert.match(html, new RegExp(`data-sidebar-thread-state="${state}"`));
  }
  for (const label of ['Running', 'Blocked', 'Failed', 'Done', 'Draft']) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.equal((html.match(/data-sidebar-thread-actions="true"/g) ?? []).length, 5);
  assert.match(html, /data-sidebar-thread-action="pin"/);
  for (const title of ['Running thread', 'Blocked thread', 'Failed thread', 'Done thread']) {
    assert.match(html, new RegExp(`aria-label="Archive chat: ${title}"`));
  }
  assert.match(html, /data-sidebar-thread-action="archive"/);
  assert.match(html, /data-sidebar-thread-action="discard"/);
  assert.match(html, /aria-label="Discard draft: New chat"/);
  assert.doesNotMatch(html, /aria-label="Archive chat: New chat"/);
  assert.doesNotMatch(html, /data-sidebar-thread-action="restore"/);
});

test('sidebar shell keeps retained previous chats visible after starting a new chat', () => {
  const html = renderToStaticMarkup(React.createElement(Sidebar, {
    page: 'workbench',
    setPage: () => undefined,
    scenarioId: 'literature-evidence-review',
    setScenarioId: () => undefined,
    config: { ...defaultSciForgeConfig, workspacePath: '/tmp/SciForge' },
    sessionsByScenario: {
      'literature-evidence-review': session({
        scenarioId: 'literature-evidence-review',
        sessionId: 'fresh-draft',
        title: 'New chat',
        messages: [],
      }),
    } as Record<ScenarioInstanceId, SciForgeSession>,
    archivedSessions: [
      session({
        scenarioId: 'literature-evidence-review',
        sessionId: 'previous-visible-thread',
        title: 'Previous visible research thread',
        messages: [{ id: 'user-previous', role: 'user', content: '旧对话仍应留在左栏', createdAt: '2026-05-20T00:00:00.000Z' }],
        versions: [{
          id: 'version-retained',
          reason: 'new chat retained previous session',
          createdAt: '2026-05-20T00:01:00.000Z',
          messageCount: 1,
          runCount: 0,
          artifactCount: 0,
          checksum: 'checksum',
          snapshot: {} as never,
        }],
      }),
    ],
    onProjectNewChat: () => undefined,
    onArchiveThread: () => undefined,
    onDiscardThread: () => undefined,
    onRestoreThread: () => undefined,
    onSearchNavigate: () => undefined,
    onSettingsOpen: () => undefined,
    workspaceStatus: 'Connected',
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /New chat/);
  assert.match(html, /Previous visible research thread/);
  assert.match(html, /aria-label="Archive chat: Previous visible research thread"/);
  assert.doesNotMatch(html, /aria-label="Delete chat: Previous visible research thread"/);
  assert.doesNotMatch(html, /aria-label="Restore chat: Previous visible research thread"/);
});

test('sidebar shell keeps the newly retained previous chat in the visible recent window', () => {
  const activeThreads = Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const n = index + 1;
    return [`scenario-${n}`, session({
      scenarioId: `scenario-${n}`,
      sessionId: `active-thread-${n}`,
      title: `Active thread ${n}`,
      messages: [{ id: `user-active-${n}`, role: 'user', content: `active prompt ${n}`, createdAt: `2026-05-21T00:0${index}:00.000Z` }],
      updatedAt: `2026-05-21T00:0${index}:00.000Z`,
    })];
  })) as Record<ScenarioInstanceId, SciForgeSession>;
  const html = renderToStaticMarkup(React.createElement(Sidebar, {
    page: 'workbench',
    setPage: () => undefined,
    scenarioId: 'literature-evidence-review',
    setScenarioId: () => undefined,
    config: { ...defaultSciForgeConfig, workspacePath: '/tmp/SciForge' },
    sessionsByScenario: {
      ...activeThreads,
      'literature-evidence-review': session({
        scenarioId: 'literature-evidence-review',
        sessionId: 'fresh-draft',
        title: 'New chat',
        messages: [],
        updatedAt: '2026-05-21T00:10:00.000Z',
      }),
    } as Record<ScenarioInstanceId, SciForgeSession>,
    archivedSessions: [
      session({
        scenarioId: 'literature-evidence-review',
        sessionId: 'previous-visible-thread',
        title: 'Previous visible research thread',
        messages: [{ id: 'user-previous', role: 'user', content: '旧对话仍应留在左栏', createdAt: '2026-05-21T00:09:00.000Z' }],
        updatedAt: '2026-05-21T00:09:00.000Z',
        versions: [{
          id: 'version-retained',
          reason: 'new chat retained previous session',
          createdAt: '2026-05-21T00:09:00.000Z',
          messageCount: 1,
          runCount: 0,
          artifactCount: 0,
          checksum: 'checksum',
          snapshot: {} as never,
        }],
      }),
    ],
    onProjectNewChat: () => undefined,
    onArchiveThread: () => undefined,
    onDiscardThread: () => undefined,
    onRestoreThread: () => undefined,
    onSearchNavigate: () => undefined,
    onSettingsOpen: () => undefined,
    workspaceStatus: 'Connected',
    onWorkspacePathChange: () => undefined,
  }));

  assert.match(html, /New chat/);
  assert.match(html, /Previous visible research thread/);
  assert.match(html, /aria-label="Archive chat: Previous visible research thread"/);
  assert.doesNotMatch(html, /aria-label="Restore chat: Previous visible research thread"/);
  assert.doesNotMatch(html, /Active thread 1/);
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
      onProjectNewChat: () => undefined,
      onSearchNavigate: () => undefined,
      onSettingsOpen: () => undefined,
      workspaceStatus: 'Connected',
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

  for (const label of ['Navigation', 'Feedback', 'Agents', 'Tools', 'Search files, actions, agents', 'Repositories', 'Customize Sidebar', 'Open Workspace', 'New Agent', 'Automations', 'Settings', 'Annotate', 'SciForge · Ready', 'No branch', 'Local environment', 'Context']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(html, /Workspace file tree|sidebar-panel-block-explorer|>Files</);
  assert.match(html, /Last answer: 已整理计划。/);
  assert.match(html, /data-gui-region-id="sidebar"/);
  assert.match(html, /data-gui-region-ref="gui:\/gui\/regions\/sidebar"/);
  assert.doesNotMatch(html, /sciforge-runtime-deepseek|sciforge-deepseek-proxy|bailian\/deepseek-v4-flash/);
  assert.doesNotMatch(html, /\b\d+\s+(?:messages?|runs?|artifacts?)\b|>\d+\s+(?:条消息|轮处理|个结果)</i);
  assert.doesNotMatch(html, /ExecutionUnit|provider|model|profile|runtime codex|run id|run-internal|stdout|stderr|raw JSONL|ConversationProjection|ArtifactDelivery/i);
  assert.doesNotMatch(html, />Threads<|>Projects<|>Plugins<|>\d+ actions<|>ready</);
});

test('sidebar shell follows the selected app locale', () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, {
    locale: 'zh-CN',
    children: React.createElement(React.Fragment, null,
      React.createElement(Sidebar, {
        page: 'workbench',
        setPage: () => undefined,
        scenarioId: 'literature-evidence-review',
        setScenarioId: () => undefined,
        config: {
          ...defaultSciForgeConfig,
          locale: 'zh-CN',
          workspacePath: '/tmp/sciforge-project',
        },
        sessionsByScenario: {} as Record<ScenarioInstanceId, SciForgeSession>,
        archivedSessions: [],
        onProjectNewChat: () => undefined,
        onSearchNavigate: () => undefined,
        onSettingsOpen: () => undefined,
        workspaceStatus: 'Connected',
        onWorkspacePathChange: () => undefined,
      }),
      React.createElement(TopBar, {
        onSearch: () => undefined,
        onSettingsOpen: () => undefined,
        theme: 'dark',
        onThemeToggle: () => undefined,
        healthItems: [],
      }),
    ),
  }));

  for (const label of ['导航', '反馈', '智能体', '工具', '搜索文件、动作、智能体', '仓库', '打开工作区', '新建智能体', '自动化', '设置', '标注', 'SciForge · 就绪']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(html, /工作区文件树|sidebar-panel-block-explorer|>文件</);
  assert.doesNotMatch(html, /Search files, actions, agents|Repositories|New Agent|SciForge · Ready/);
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

  const proteinMatch = buildSidebarSearchMatches('protein', sessions).find((match) => match.id === 'thread:protein-thread');
  assert.equal(proteinMatch?.sessionId, 'protein-thread');
  assert.equal(proteinMatch?.threadState, 'done');
  assert.ok(buildSidebarSearchMatches('feedback', sessions).some((match) => match.page === 'feedback'));
  assert.deepEqual(buildSidebarSearchMatches('zzzz-no-result', sessions), []);
});

test('sidebar search exposes Automations, Customize, and Repositories as local sidebar actions', () => {
  const sessions = {} as Record<ScenarioInstanceId, SciForgeSession>;
  const automations = buildSidebarSearchMatches('automation', sessions).find((match) => match.action === 'open-automations');
  const customize = buildSidebarSearchMatches('customize', sessions).find((match) => match.action === 'open-customize');
  const repositories = buildSidebarSearchMatches('repos', sessions).find((match) => match.action === 'open-repositories');
  const localized = buildSidebarSearchMatches('自动化', sessions, { locale: 'zh-CN' }).find((match) => match.action === 'open-automations');

  assert.equal(automations?.label, 'Automations');
  assert.equal(automations?.detail, 'Sidebar action');
  assert.equal(automations?.page, 'components');
  assert.equal(customize?.label, 'Customize');
  assert.equal(customize?.detail, 'Sidebar action');
  assert.equal(customize?.page, 'workbench');
  assert.equal(repositories?.label, 'Repositories');
  assert.equal(repositories?.detail, 'Sidebar section');
  assert.equal(repositories?.page, 'workbench');
  assert.equal(localized?.label, '自动化');
  assert.doesNotMatch(JSON.stringify([automations, customize, repositories, localized]), /provider|model|Authorization|secret|token|\/tmp|\/Applications/i);
});

test('sidebar search keeps Customize for sidebar presentation and exposes Marketplace separately', () => {
  const sessions = {} as Record<ScenarioInstanceId, SciForgeSession>;
  const customize = buildSidebarSearchMatches('customize sidebar', sessions).find((match) => match.action === 'open-customize');
  const marketplace = buildSidebarSearchMatches('marketplace plugins', sessions).find((match) => match.action === 'open-marketplace');

  assert.equal(customize?.page, 'workbench');
  assert.equal(customize?.kind, 'action');
  assert.equal(marketplace?.label, 'Open Marketplace');
  assert.equal(marketplace?.page, 'components');
  assert.equal(marketplace?.kind, 'skill');
  assert.doesNotMatch(JSON.stringify([customize, marketplace]), /provider|Authorization|secret|token|\/tmp|\/Applications/i);
});

test('sidebar search behaves like a unified command palette without leaking runtime paths', () => {
  const sessions = {} as Record<ScenarioInstanceId, SciForgeSession>;
  const config = {
    ...defaultSciForgeConfig,
    workspacePath: '/Applications/private/sciforge',
    modelName: 'private-model-name',
    toolProviderRoutes: {
      'vision-mcp': {
        source: 'mcp' as const,
        capabilityId: 'Vision MCP',
        endpoint: 'http://127.0.0.1:8931/mcp?token=secret',
      },
    },
  };

  const newAgent = buildSidebarSearchMatches('agent', sessions).find((match) => match.action === 'new-agent');
  const fileAction = buildSidebarSearchMatches('files', sessions).find((match) => match.kind === 'file');
  const mode = buildSidebarSearchMatches('plan', sessions).find((match) => match.kind === 'mode');
  const model = buildSidebarSearchMatches('model', sessions, { config }).find((match) => match.kind === 'model');
  const skill = buildSidebarSearchMatches('plot', sessions, { config }).find((match) => match.kind === 'skill');
  const mcpMatches = buildSidebarSearchMatches('mcp', sessions, { config });
  const mcp = mcpMatches.find((match) => match.kind === 'mcp' && match.label === 'Vision MCP');
  const mcpSettings = mcpMatches.find((match) => match.action === 'open-mcp-settings');
  const groupWorkspace = buildSidebarSearchMatches('workspace', sessions).find((match) => match.action === 'group-by-workspace');
  const groupStatus = buildSidebarSearchMatches('status', sessions).find((match) => match.action === 'group-by-status');
  const groupEnvironment = buildSidebarSearchMatches('environment', sessions).find((match) => match.action === 'group-by-environment');

  assert.equal(newAgent?.label, 'New Agent');
  assert.equal(newAgent?.kind, 'agent');
  assert.equal(newAgent?.shortcut, '⌘N');
  assert.equal(fileAction?.detail, 'File action');
  assert.equal(mode?.detail, 'Chat mode');
  assert.equal(model?.action, 'open-settings');
  assert.ok(skill?.label);
  assert.equal(mcp?.label, 'Vision MCP');
  assert.equal(mcpSettings?.action, 'open-mcp-settings');
  assert.equal(groupWorkspace?.label, 'Group by Workspace');
  assert.equal(groupStatus?.label, 'Group by Status');
  assert.equal(groupEnvironment?.label, 'Group by Environment');
  assert.doesNotMatch(
    JSON.stringify([newAgent, fileAction, mode, model, skill, mcp, groupWorkspace, groupStatus, groupEnvironment]),
    /\/Applications|private-model-name|127\.0\.0\.1|secret|token|Authorization|api key/i,
  );
});

test('sidebar search includes safe workspace file projections as relative command palette results', () => {
  const sessions = {} as Record<ScenarioInstanceId, SciForgeSession>;
  const workspaceRootPath = '/Applications/private/sciforge';
  const matches = buildSidebarSearchMatches('ShellPanels', sessions, {
    workspaceRootPath,
    workspaceEntries: [{
      kind: 'file',
      name: 'ShellPanels.tsx',
      path: '/Applications/private/sciforge/src/ui/src/app/appShell/ShellPanels.tsx',
    }, {
      kind: 'file',
      name: 'config.local.json',
      path: '/Applications/private/sciforge/config.local.json',
    }, {
      kind: 'file',
      name: 'trace.jsonl',
      path: '/Applications/private/sciforge/.sciforge/sessions/run-1/trace.jsonl',
    }],
  });
  const file = matches.find((match) => match.workspaceRelativePath === 'src/ui/src/app/appShell/ShellPanels.tsx');

  assert.equal(file?.kind, 'file');
  assert.equal(file?.label, 'ShellPanels.tsx');
  assert.equal(file?.detail, 'Workspace file · src/ui/src/app/appShell');
  assert.equal(file?.page, 'workbench');
  assert.doesNotMatch(JSON.stringify(matches), /\/Applications|private|\.sciforge|config\.local|trace\.jsonl|token|secret/i);
});

test('sidebar search includes projects and archived threads without exposing local paths', () => {
  const config = { ...defaultSciForgeConfig, workspacePath: '/tmp/protein-project' };
  const archived = session({
    scenarioId: 'structure-exploration',
    sessionId: 'archived-search-thread',
    title: 'Protein archive note',
    archiveState: 'archived',
    messages: [{ id: 'user-1', role: 'user', content: 'archive protein note', createdAt: '2026-05-21T00:00:00.000Z' }],
  });
  const groups = buildSidebarProjectThreadGroups(config, {}, [archived]);
  const matches = buildSidebarSearchMatches('protein', {}, { groups, archivedSessions: [archived] });
  const archivedMatch = matches.find((match) => match.id === 'archived-thread:archived-search-thread');
  const projectMatch = matches.find((match) => match.id.startsWith('project:') && match.detail === 'Current project');

  assert.equal(matches.filter((match) => match.sessionId === 'archived-search-thread').length, 1);
  assert.equal(archivedMatch?.sessionId, 'archived-search-thread');
  assert.equal(archivedMatch?.threadState, 'archived');
  assert.match(archivedMatch?.projectId ?? '', /^project-target:/);
  assert.match(projectMatch?.projectId ?? '', /^project-target:/);
  const target = archivedMatch ? findSidebarThreadSearchTarget(groups, archivedMatch) : undefined;
  assert.equal(target?.project.id, groups[0]?.id);
  assert.equal(target?.thread.sessionId, 'archived-search-thread');
  assert.equal(target?.thread.state, 'archived');
  assert.doesNotMatch(JSON.stringify(matches), /\/tmp\/protein-project/);
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

function sessionMap(record: Record<string, SciForgeSession>): Record<ScenarioInstanceId, SciForgeSession> {
  return record as unknown as Record<ScenarioInstanceId, SciForgeSession>;
}
