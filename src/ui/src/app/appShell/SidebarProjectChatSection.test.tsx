import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarProjectChatSection } from './SidebarProjectChatSection';
import type { SidebarProjectThreadGroup, SidebarThreadItem } from './ShellPanels';

test('sidebar project chat section renders search, project actions, and top-k threads', () => {
  const project: SidebarProjectThreadGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: '/tmp/SciForge',
    current: true,
    threads: Array.from({ length: 5 }, (_, index) => ({
      sessionId: `thread-${index + 1}`,
      scenarioId: `scenario-${index + 1}`,
      title: `Thread ${index + 1}`,
      detail: `Question ${index + 1}`,
      updatedAt: `2026-05-29T00:0${index}:00.000Z`,
    })) as SidebarThreadItem[],
  };

  const html = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    sidebarSearchQuery: 'paper',
    sidebarSearchMatches: [{ id: 'match-1', label: 'Paper project', detail: 'Project', page: 'workbench' }],
    allProjectThreadsCollapsed: false,
    activeMenuKind: 'project',
    activeProjectMenuId: 'project-main',
    projectThreadLimit: 4,
    sidebarProjectThreadGroups: [project],
    expandedProjectThreads: new Set<string>(),
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onToggleProjectThreadExpansion: () => undefined,
    onOpenProjectNewChat: () => undefined,
    renderSidebarThreadRow: (item) => React.createElement('span', { key: item.sessionId }, item.title),
  }));

  assert.match(html, /New Agent/);
  assert.match(html, /Search chats, projects, pages/);
  assert.match(html, /Sidebar search results/);
  assert.match(html, /Paper project/);
  assert.match(html, /Repositories/);
  assert.match(html, /Customize Sidebar/);
  assert.match(html, /Open Workspace/);
  assert.match(html, /SciForge/);
  assert.match(html, /Current/);
  assert.match(html, /Project actions/);
  assert.match(html, /New Agent in SciForge/);
  assert.match(html, /Thread 1/);
  assert.match(html, /Thread 4/);
  assert.doesNotMatch(html, /Thread 5/);
  assert.match(html, /Show more/);
  assert.match(html, /<span>Show more<\/span><small>1<\/small>/);
});

test('sidebar project chat section renders unified active draft archived and discarded rows', () => {
  const project: SidebarProjectThreadGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: '/tmp/SciForge',
    current: true,
    draftThreads: [{
      sessionId: 'thread-draft',
      scenarioId: 'scenario-draft',
      title: 'New chat',
      detail: 'Draft ready',
      updatedAt: '2026-05-29T00:00:00.000Z',
      state: 'draft',
    }],
    threads: [{
      sessionId: 'thread-active',
      scenarioId: 'scenario-active',
      title: 'Active thread',
      detail: 'Ready',
      updatedAt: '2026-05-29T00:01:00.000Z',
      state: 'active',
    }],
    archivedThreads: [{
      sessionId: 'thread-archived',
      scenarioId: 'scenario-archived',
      title: 'Archived thread',
      detail: 'Archived',
      updatedAt: '2026-05-29T00:02:00.000Z',
      state: 'archived',
      archived: true,
    }, {
      sessionId: 'thread-discarded',
      scenarioId: 'scenario-discarded',
      title: 'Discarded thread',
      detail: 'Discarded',
      updatedAt: '2026-05-29T00:03:00.000Z',
      state: 'discarded',
      discarded: true,
    }],
  };

  const html = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    sidebarSearchQuery: '',
    sidebarSearchMatches: [],
    allProjectThreadsCollapsed: false,
    projectThreadLimit: 3,
    sidebarProjectThreadGroups: [project],
    expandedProjectThreads: new Set<string>(),
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onToggleProjectThreadExpansion: () => undefined,
    onOpenProjectNewChat: () => undefined,
    renderSidebarThreadRow: (item) => React.createElement('span', { key: item.sessionId }, `${item.state}:${item.title}`),
  }));

  assert.match(html, /draft:New chat/);
  assert.match(html, /active:Active thread/);
  assert.match(html, /archived:Archived thread/);
  assert.doesNotMatch(html, /discarded:Discarded thread/);
  assert.match(html, /Show more/);
  assert.match(html, /<span>Show more<\/span><small>1<\/small>/);
});
