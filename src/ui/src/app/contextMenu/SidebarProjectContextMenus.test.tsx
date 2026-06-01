import assert from 'node:assert/strict';
import test from 'node:test';
import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  SidebarProjectActionContextMenu,
  SidebarProjectCreateContextMenu,
  SidebarThreadsGlobalContextMenu,
} from './SidebarProjectContextMenus';

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (typeof node.type === 'function') {
      return textContent((node.type as (props: Record<string, unknown>) => ReactNode)(node.props as Record<string, unknown>));
    }
    return textContent(node.props.children);
  }
  return '';
}

function menuItemLabels(menu: ReactElement<{ children?: ReactNode }>): string[] {
  return React.Children.toArray(menu.props.children)
    .map((child) => textContent(child).trim())
    .filter(Boolean);
}

function assertProjectHeaderMenuLabels(current: boolean) {
  const props: Parameters<typeof SidebarProjectActionContextMenu>[0] = {
    x: 12,
    y: 24,
    project: {
      id: 'project-lab',
      label: 'Lab',
      detail: '/tmp/lab',
      current,
    },
    onMarkAllAsRead: () => undefined,
    onArchiveChats: () => undefined,
    onRemoveProject: () => undefined,
  };

  const labels = menuItemLabels(SidebarProjectActionContextMenu(props));
  const expectedLabels = ['Mark All as Read', 'Archive All', 'Remove from Sidebar'];

  assert.deepEqual(labels, expectedLabels);

  for (const expectedLabel of expectedLabels) {
    assert.ok(labels.includes(expectedLabel), `missing project menu item: ${expectedLabel}`);
  }

  for (const forbiddenLabel of ['Open in Finder', 'Archive chats', 'Copy path', 'Copy relative path', 'Add to chat']) {
    assert.ok(!labels.includes(forbiddenLabel), `unexpected project menu item: ${forbiddenLabel}`);
  }
}

test('repository project context menu exposes Cursor-like project-header actions only', () => {
  assertProjectHeaderMenuLabels(false);
  assertProjectHeaderMenuLabels(true);
});

test('repositories global customization menu exposes presentation-only sidebar controls', () => {
  const labels = menuItemLabels(SidebarThreadsGlobalContextMenu({
    x: 12,
    y: 24,
    visibleSections: {
      status: true,
      git: true,
      environment: true,
      archiveUnread: true,
      source: false,
      metadata: false,
    },
    onGroupByRepository: () => undefined,
    onToggleVisibleSection: () => undefined,
    onCollapseAll: () => undefined,
    onMarkAllAsRead: () => undefined,
    onReferenceToChat: () => undefined,
  }));

  assert.ok(labels.some((label) => label.includes('Group by') && label.includes('Repository')), 'missing group-by repository control');
  for (const expectedLabel of ['Show', 'Status', 'Git', 'Environment', 'Archive, Unread', 'Source', 'Metadata', 'Collapse All', 'Mark All as Read']) {
    assert.ok(labels.includes(expectedLabel), `missing global menu item: ${expectedLabel}`);
  }
  for (const forbiddenLabel of ['Apps', 'Marketplace', 'Open in Finder', 'Copy path', 'Add to chat', '/Applications', '.sciforge']) {
    assert.ok(!labels.includes(forbiddenLabel), `unexpected global menu item: ${forbiddenLabel}`);
  }
});

test('repositories create menu keeps workspace commands separate from customization', () => {
  const labels = menuItemLabels(SidebarProjectCreateContextMenu({
    x: 12,
    y: 24,
    onNewProject: () => undefined,
    onOpenWorkspace: () => undefined,
    onSetCurrentDirectory: () => undefined,
  }));

  assert.deepEqual(labels, ['New Project...', 'Open Workspace...', 'Set Current Directory...']);
  for (const forbiddenLabel of ['Apps', 'Marketplace', 'Customize Sidebar', 'Copy path', '.sciforge']) {
    assert.ok(!labels.includes(forbiddenLabel), `unexpected create menu item: ${forbiddenLabel}`);
  }
});
