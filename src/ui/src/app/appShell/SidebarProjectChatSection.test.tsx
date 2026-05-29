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
      title: `线程 ${index + 1}`,
      detail: `问题 ${index + 1}`,
      updatedAt: `2026-05-29T00:0${index}:00.000Z`,
    })) as SidebarThreadItem[],
  };

  const html = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    sidebarSearchQuery: 'paper',
    sidebarSearchMatches: [{ id: 'match-1', label: '论文项目', detail: '项目', page: 'workbench' }],
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

  assert.match(html, /搜索聊天、项目、页面/);
  assert.match(html, /侧边栏搜索结果/);
  assert.match(html, /论文项目/);
  assert.match(html, /项目对话/);
  assert.match(html, /SciForge/);
  assert.match(html, /当前/);
  assert.match(html, /项目操作/);
  assert.match(html, /新聊天/);
  assert.match(html, /线程 1/);
  assert.match(html, /线程 4/);
  assert.doesNotMatch(html, /线程 5/);
  assert.match(html, /展开显示/);
  assert.match(html, /1 条/);
});
