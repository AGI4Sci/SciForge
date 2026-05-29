import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WorkspaceExplorerStatusPanel,
  conciseWorkspaceOnboardingReason,
} from './WorkspaceExplorerStatusPanel';

test('workspace explorer status panel renders onboarding, notice, and error states', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceExplorerStatusPanel, {
    workspacePath: '/tmp/missing-project',
    workspaceError: 'ENOENT workspace-state.json',
    workspaceStatus: '未找到',
    workspaceNotice: '正在检查项目',
    onInitializeWorkspacePath: () => undefined,
  }));

  assert.match(html, /初始化 SciForge 项目/);
  assert.match(html, /未找到项目工作区/);
  assert.match(html, /创建项目工作区/);
  assert.match(html, /role="status"/);
  assert.match(html, /正在检查项目/);
  assert.match(html, /ENOENT workspace-state\.json/);
});

test('workspace explorer onboarding reason stays concise and user-facing', () => {
  assert.equal(conciseWorkspaceOnboardingReason('', '', ''), '还没有项目。选择项目路径后会显示文件。');
  assert.equal(conciseWorkspaceOnboardingReason('/tmp/project', 'EACCES', ''), '无法读取当前项目；请检查权限。');
  assert.equal(conciseWorkspaceOnboardingReason('/tmp/project', 'not found', ''), '未找到项目工作区。');
  assert.equal(conciseWorkspaceOnboardingReason('/tmp/project', '', ''), '项目尚未初始化。');
});
