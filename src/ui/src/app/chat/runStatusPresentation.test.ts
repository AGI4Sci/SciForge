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

  assert.match(content, /Waiting for workspace activity/);
  assert.doesNotMatch(content, /Plugin manifest warning|failed to load plugin|\/tmp\/plugin\.json/);
});

test('running message hides app-server transport progress copy', () => {
  const events: AgentStreamEvent[] = [{
    id: 'evt-app-server-progress',
    type: 'process-progress',
    label: 'Progress',
    detail: 'Codex app-server stream 仍然连接；正在等待下一条 rich-client 事件。',
    createdAt: '2026-05-30T00:00:00.000Z',
    raw: {
      progress: {
        title: 'Codex app-server 正在运行',
        waitingFor: '下一条 Codex app-server rich-client 事件',
        nextStep: '收到事件后继续按顺序展示执行轨迹。',
        reason: 'app-server-waiting',
      },
    },
  }];

  const content = runningMessageContentFromStream('', events);

  assert.match(content, /Working on your request/);
  assert.doesNotMatch(content, /Codex app-server|rich-client|backend|下一条/);
});

test('running message localizes generic status copy', () => {
  const content = runningMessageContentFromStream('', [{
    id: 'evt-audit-only',
    type: 'stderr',
    label: 'stderr',
    detail: 'transport-only stderr',
    createdAt: '2026-05-30T00:00:00.000Z',
    raw: { stream: 'stderr' },
  }], 'zh-CN');

  assert.equal(content, '正在等待工作区活动。');
});

test('running message normalizes active assistant draft before rendering', () => {
  const content = runningMessageContentFromStream(
    '[local path] [redacted-path] SciForge 需要保持 final- answer-pro se 纯净，splitFinal Message Presentation 的 initially Expanded 状态也要稳定。',
    [],
  );

  assert.doesNotMatch(content, /\[local path\]|\[redacted-path\]|final-\s+answer-pro\s+se|splitFinal Message|initially Expanded/i);
  assert.match(content, /final-answer-prose/);
  assert.match(content, /splitFinalMessagePresentation/);
  assert.match(content, /initiallyExpanded/);
});

test('run readiness displays provider setup as a non-routing notice', () => {
  const readiness = runReadiness({
    input: 'run the task',
    isSending: false,
    config: updateConfig(defaultSciForgeConfig, {
      locale: 'en-US',
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
  assert.match(readiness.message, /Connection notice/);
  assert.match(readiness.message, /Set an API Key/);
  assert.doesNotMatch(readiness.message, /OpenAI provider|fallback/i);
});

test('run readiness follows the selected Chinese locale', () => {
  const readiness = runReadiness({
    input: '',
    isSending: false,
    config: updateConfig(defaultSciForgeConfig, { locale: 'zh-CN' }),
  });

  assert.equal(readiness.ok, false);
  assert.match(readiness.message, /输入问题即可开始/);
});
