import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarProjectChatSection } from './SidebarProjectChatSection';
import type { SidebarProjectThreadGroup, SidebarThreadItem } from './ShellPanels';
import type { SidebarCursorAgentProjectGroup } from './sidebarCursorAgentModel';
import { defaultSidebarPreferences } from './sidebarPreferences';

test('sidebar thread row actions stay out of the pointer hit area until visible', () => {
  const css = readFileSync(new URL('../../styles/app-01.css', import.meta.url), 'utf8');
  const hiddenActionsRule = Array.from(css.matchAll(
    /\.sidebar\.cursor-agent-sidebar:not\(\.collapsed\) \.sidebar-thread-actions\s*{[^}]*}/gs,
  )).map((match) => match[0]).find((rule) => rule.includes('right: 3px')) ?? '';
  const visibleActionsRule = css.match(/\.sidebar\.cursor-agent-sidebar:not\(\.collapsed\) \.sidebar-thread-row:hover \.sidebar-thread-actions,[\s\S]*?\.sidebar\.cursor-agent-sidebar:not\(\.collapsed\) \.sidebar-thread-row\.active \.sidebar-thread-actions\s*{[^}]*}/)?.[0] ?? '';

  assert.match(hiddenActionsRule, /opacity:\s*0/);
  assert.match(hiddenActionsRule, /pointer-events:\s*none/);
  assert.match(visibleActionsRule, /opacity:\s*1/);
  assert.match(visibleActionsRule, /pointer-events:\s*auto/);
});

test('sidebar project chat section renders search, Cursor-like project heads, and top-k threads', () => {
  const project: SidebarProjectThreadGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: '/tmp/SciForge',
    current: true,
    threads: Array.from({ length: 7 }, (_, index) => ({
      sessionId: `thread-${index + 1}`,
      scenarioId: `scenario-${index + 1}`,
      title: `Thread ${index + 1}`,
      detail: `Question ${index + 1}`,
      updatedAt: `2026-05-29T00:0${index}:00.000Z`,
    })) as SidebarThreadItem[],
  };

  const html = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    sidebarSearchQuery: 'paper',
    sidebarSearchMatches: [
      { id: 'match-action', label: 'Search in Files', detail: 'File action', page: 'workbench', kind: 'file', action: 'search-files' },
      { id: 'match-file', label: 'ShellPanels.tsx', detail: 'Workspace file · src/ui/src/app/appShell', page: 'workbench', kind: 'file', workspaceRelativePath: 'src/ui/src/app/appShell/ShellPanels.tsx' },
      { id: 'match-1', label: 'Paper project', detail: 'Project', page: 'workbench' },
    ],
    allProjectThreadsCollapsed: false,
    activeMenuKind: 'project',
    projectThreadLimit: 6,
    projectThreadVisibleCounts: {},
    sidebarProjectThreadGroups: [project],
    visibleSections: defaultSidebarPreferences().visibleSections,
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onHideSidebar: () => undefined,
    onGoBack: () => undefined,
    onGoForward: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onShowMoreProjectThreads: () => undefined,
    onOpenProjectNewChat: () => undefined,
    onOpenAutomations: () => undefined,
    onOpenCustomize: () => undefined,
    renderSidebarThreadRow: (item) => React.createElement('span', { key: item.sessionId }, item.title),
  }));

  assert.match(html, /New Agent/);
  assert.match(html, /Hide Sidebar/);
  assert.match(html, /Go Back/);
  assert.match(html, /Go Forward/);
  assert.match(html, /Automations/);
  assert.match(html, /Customize/);
  assert.match(html, /aria-label="Customize"/);
  assert.match(html, /Search files, actions, agents/);
  assert.match(html, /Command palette results/);
  assert.match(html, /Actions/);
  assert.match(html, /Files/);
  assert.match(html, /Pages/);
  assert.match(html, /Search in Files/);
  assert.match(html, /ShellPanels\.tsx/);
  assert.match(html, /Paper project/);
  assert.match(html, /Repositories/);
  assert.match(html, /Customize Sidebar/);
  assert.match(html, /Open Workspace/);
  assert.match(html, /SciForge/);
  assert.match(html, /Collapse chats in SciForge/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /New Agent in SciForge/);
  assert.doesNotMatch(html, /project actions|Project actions/);
  assert.doesNotMatch(html, /sidebar-project-current-label|>Current</);
  assert.match(html, /Thread 1/);
  assert.match(html, /Thread 6/);
  assert.doesNotMatch(html, /Thread 7/);
  assert.match(html, /See more/);
  assert.match(html, /aria-label="See more chats in SciForge"/);
  assert.doesNotMatch(html, /Show more|Show less/);
  assert.doesNotMatch(html, /<small>1<\/small>/);
});

test('sidebar project chat section reveals additional repository rows behind See more', () => {
  const project: SidebarProjectThreadGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: '/tmp/SciForge',
    current: true,
    threads: Array.from({ length: 15 }, (_, index) => ({
      sessionId: `thread-${index + 1}`,
      scenarioId: `scenario-${index + 1}`,
      title: `Thread ${index + 1}`,
      detail: `Question ${index + 1}`,
      updatedAt: `2026-05-29T00:${String(index).padStart(2, '0')}:00.000Z`,
    })) as SidebarThreadItem[],
  };

  const html = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    sidebarSearchQuery: '',
    sidebarSearchMatches: [],
    allProjectThreadsCollapsed: false,
    projectThreadLimit: 6,
    projectThreadVisibleCounts: { 'project-main': 14 },
    sidebarProjectThreadGroups: [project],
    visibleSections: defaultSidebarPreferences().visibleSections,
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onHideSidebar: () => undefined,
    onGoBack: () => undefined,
    onGoForward: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onShowMoreProjectThreads: () => undefined,
    onOpenProjectNewChat: () => undefined,
    onOpenAutomations: () => undefined,
    onOpenCustomize: () => undefined,
    renderSidebarThreadRow: (item) => React.createElement('span', { key: item.sessionId }, item.title),
  }));

  assert.match(html, /Thread 14/);
  assert.doesNotMatch(html, /Thread 15/);
  assert.match(html, /See more/);
  assert.doesNotMatch(html, /Show less|<small>1<\/small>/);
});

test('sidebar project chat section supports per-project thread collapse', () => {
  const project: SidebarProjectThreadGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: '/tmp/SciForge',
    current: true,
    threads: Array.from({ length: 7 }, (_, index) => ({
      sessionId: `thread-${index + 1}`,
      scenarioId: `scenario-${index + 1}`,
      title: `Thread ${index + 1}`,
      detail: `Question ${index + 1}`,
      updatedAt: `2026-05-29T00:0${index}:00.000Z`,
    })) as SidebarThreadItem[],
  };

  const html = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    sidebarSearchQuery: '',
    sidebarSearchMatches: [],
    allProjectThreadsCollapsed: false,
    projectThreadLimit: 6,
    projectThreadVisibleCounts: {},
    collapsedProjectThreadIds: { 'project-main': true },
    sidebarProjectThreadGroups: [project],
    visibleSections: defaultSidebarPreferences().visibleSections,
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onHideSidebar: () => undefined,
    onGoBack: () => undefined,
    onGoForward: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onShowMoreProjectThreads: () => undefined,
    onOpenProjectNewChat: () => undefined,
    onOpenAutomations: () => undefined,
    onOpenCustomize: () => undefined,
    renderSidebarThreadRow: (item) => React.createElement('span', { key: item.sessionId }, item.title),
  }));

  assert.match(html, /SciForge/);
  assert.match(html, /Expand chats in SciForge/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /is-collapsed/);
  assert.doesNotMatch(html, /Thread 1|Thread 6|See more|No chats yet/);
});

test('sidebar customization visible sections hide project status without hiding repository threads', () => {
  const project: SidebarProjectThreadGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: '/tmp/SciForge',
    current: true,
    threads: [{
      sessionId: 'thread-active',
      scenarioId: 'scenario-active',
      title: 'Active thread',
      detail: 'Ready',
      updatedAt: '2026-05-29T00:01:00.000Z',
      state: 'done',
    }],
  };
  const cursorProject: SidebarCursorAgentProjectGroup = {
    id: 'project-main',
    label: 'SciForge',
    detail: 'Current workspace',
    resourceRef: 'gui://sidebar/project/project-main',
    current: true,
    selected: true,
    status: {
      branch: { label: 'No branch', detail: 'Git status', state: 'warning' },
      localEnvironment: { label: 'Local environment', detail: 'Ready', state: 'ready' },
      context: { label: 'Context', detail: 'Within budget', state: 'ready' },
    },
    actions: [],
    presentationActions: [],
    threads: [],
  };
  const baseProps = {
    sidebarSearchQuery: '',
    sidebarSearchMatches: [],
    allProjectThreadsCollapsed: false,
    projectThreadLimit: 3,
    projectThreadVisibleCounts: {},
    sidebarProjectThreadGroups: [project],
    cursorProjectGroups: [cursorProject],
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onHideSidebar: () => undefined,
    onGoBack: () => undefined,
    onGoForward: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onShowMoreProjectThreads: () => undefined,
    onOpenProjectNewChat: () => undefined,
    onOpenAutomations: () => undefined,
    onOpenCustomize: () => undefined,
    renderSidebarThreadRow: (item: SidebarThreadItem) => React.createElement('span', { key: item.sessionId }, item.title),
  };

  const shown = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    ...baseProps,
    visibleSections: defaultSidebarPreferences().visibleSections,
  }));
  const hidden = renderToStaticMarkup(React.createElement(SidebarProjectChatSection, {
    ...baseProps,
    visibleSections: { ...defaultSidebarPreferences().visibleSections, status: false },
  }));

  assert.match(shown, /Project status/);
  assert.match(shown, /No branch/);
  assert.match(hidden, /Active thread/);
  assert.doesNotMatch(hidden, /Project status|No branch|Local environment|Context/);
});

test('sidebar project chat section keeps archived and discarded rows out of the active list', () => {
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
      state: 'done',
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
    projectThreadVisibleCounts: {},
    sidebarProjectThreadGroups: [project],
    visibleSections: defaultSidebarPreferences().visibleSections,
    onSearchQueryChange: () => undefined,
    onSearchSubmit: () => undefined,
    onOpenSearchMatch: () => undefined,
    onHideSidebar: () => undefined,
    onGoBack: () => undefined,
    onGoForward: () => undefined,
    onOpenProjectMenuAt: () => undefined,
    onToggleProjectMenu: () => undefined,
    onToggleAllProjectThreadsCollapsed: () => undefined,
    onActivateProject: () => undefined,
    onShowMoreProjectThreads: () => undefined,
    onOpenProjectNewChat: () => undefined,
    onOpenAutomations: () => undefined,
    onOpenCustomize: () => undefined,
    renderSidebarThreadRow: (item) => React.createElement('span', { key: item.sessionId }, `${item.state}:${item.title}`),
  }));

  assert.match(html, /draft:New chat/);
  assert.match(html, /done:Active thread/);
  assert.doesNotMatch(html, /archived:Archived thread/);
  assert.doesNotMatch(html, /discarded:Discarded thread/);
  assert.doesNotMatch(html, /See more|Show more/);
});
