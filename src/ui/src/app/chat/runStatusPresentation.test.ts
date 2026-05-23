import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultSciForgeConfig, updateConfig } from '../../config';
import type { AgentStreamEvent } from '../../domain';
import { runReadiness, runningMessageContentFromStream } from './runStatusPresentation';

test('running message uses user-facing waiting status for audit-only stderr warnings', () => {
  const events: AgentStreamEvent[] = [{
    id: 'evt-runtime-stderr',
    type: 'stderr',
    label: 'stderr',
    detail: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json',
    createdAt: '2026-05-08T00:00:00.000Z',
    raw: {
      stream: 'stderr',
      chunk: 'Plugin manifest warning: failed to load plugin manifest from /tmp/plugin.json',
    },
  }];

  const content = runningMessageContentFromStream('', events);

  assert.match(content, /正在等待工作区进度/);
  assert.match(content, /详细日志已收起/);
  assert.doesNotMatch(content, /Plugin manifest warning|failed to load plugin|\/tmp\/plugin\.json/);
});

test('run readiness displays provider setup as a non-routing notice', () => {
  const readiness = runReadiness({
    input: 'run the task',
    isSending: false,
    config: updateConfig(defaultSciForgeConfig, {
      modelProvider: 'openrouter',
      modelBaseUrl: 'https://openrouter.ai/api/v1',
      modelName: 'qwen/qwen3.6-plus:free',
      apiKey: '',
      workspacePath: '/tmp/ws',
    }),
    runtimeHealth: [
      { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: 'ok' },
      { id: 'codex-runtime', label: 'Codex Runtime', status: 'online', detail: 'ok' },
    ],
  });

  assert.equal(readiness.ok, true);
  assert.equal(readiness.severity, 'warning');
  assert.match(readiness.message, /Provider 诊断/);
  assert.match(readiness.message, /只作为提示展示，不改变当前聊天路由/);
});
