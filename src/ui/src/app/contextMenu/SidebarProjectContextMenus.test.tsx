import assert from 'node:assert/strict';
import test from 'node:test';
import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { SidebarProjectActionContextMenu } from './SidebarProjectContextMenus';

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
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
