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

test('running message keeps silent wait concise without runtime diagnostics', () => {
  const events: AgentStreamEvent[] = [{
    id: 'evt-silent-stream-wait',
    type: 'process-progress',
    label: 'Waiting',
    detail: 'Still waiting for workspace activity after 6s. Latest event: Codex Runtime - provider sciforge-deepseek-proxy · model bailian/deepseek-v4-flash · profile sciforge-runtime-deepseek · workspace /Applications/workspace/ailab/research/app/SciForge/workspace',
    createdAt: '2026-05-31T00:00:00.000Z',
    raw: {
      progress: {
        phase: 'wait',
        title: 'Waiting for workspace activity',
        detail: 'Still waiting for workspace activity after 6s. Latest event: Codex Runtime - provider sciforge-deepseek-proxy · model bailian/deepseek-v4-flash · profile sciforge-runtime-deepseek · workspace /Applications/workspace/ailab/research/app/SciForge/workspace',
        waitingFor: 'workspace activity',
        nextStep: 'SciForge will continue when new activity arrives. You can also stop the task or queue more guidance.',
        lastEvent: {
          label: 'Codex Runtime',
          detail: 'provider sciforge-deepseek-proxy · model bailian/deepseek-v4-flash · profile sciforge-runtime-deepseek · workspace /Applications/workspace/ailab/research/app/SciForge/workspace',
        },
        reason: 'backend-waiting',
        status: 'running',
      },
    },
  }];

  const content = runningMessageContentFromStream('', events);

  assert.equal(content, 'Waiting for workspace activity');
  assert.doesNotMatch(content, /Codex Runtime|provider|model|profile|\/Applications\/workspace|Next SciForge/i);
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

test('running message folds path-only assistant drafts into concise status copy', () => {
  const content = runningMessageContentFromStream([
    '/Applications/workspace/ailab/research/app/SciForge/tools/computer-use-chat-live-e2e.ts',
    '/Applications/workspace/ailab/research/app/SciForge/tools/computer-use-next/approval-chain.ts',
    '/Applications/workspace/ailab/research/app/SciForge/tests/smoke/cu-next-user-acceptance-harness.test.ts',
    '/Applications/workspace/ailab/research/app/SciForge/tests/smoke/smoke-runtime-codex-final-acceptance.ts',
    '/Applications/workspace/ailab/research/app/SciForge/src/runtime/task-projects.test.ts',
  ].join('\n'), [], 'zh-CN');

  assert.match(content, /正在整理工作区上下文/);
  assert.doesNotMatch(content, /\/Applications\/workspace|computer-use-chat-live|task-projects\.test/);
});

test('running message folds dense inline local path drafts into concise status copy', () => {
  const content = runningMessageContentFromStream([
    '/Applications/workspace/ailab/research/app/SciForge/node_modules/recharts/AGENTS.md',
    '/Applications/workspace/ailab/research/app/SciForge/tools/check-runtime-codex-truth-source.ts',
    '/Applications/workspace/ailab/research/app/SciForge/tools/check-boundary-inventory.ts',
    '/Applications/workspace/ailab/research/app/SciForge/tests/smoke/smoke-runtime-codex-final-acceptance.ts',
    '/Applications/workspace/ailab/research/app/SciForge/packages/backend/src/proxy.ts',
    '/Applications/workspace/ailab/research/app/SciForge/packages/backend/src/response-compat.ts',
    '/Applications/workspace/ailab/research/app/SciForge/packages/scenarios/core/src/scenarioDemoData.test.ts',
    '/Applications/workspace/ailab/research/app/SciForge/src/ui/src/app/ChatPanel.tsx',
  ].join(' '), [], 'zh-CN');

  assert.match(content, /正在整理工作区上下文/);
  assert.doesNotMatch(content, /\/Applications\/workspace|node_modules|scenarioDemoData/);
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

test('run readiness treats runtime checking as a non-blocking send notice', () => {
  const readiness = runReadiness({
    input: 'hello',
    isSending: false,
    config: updateConfig(defaultSciForgeConfig, {
      locale: 'en-US',
      workspacePath: '/tmp/ws',
      modelProvider: 'openai',
      modelName: 'gpt-5',
      apiKey: 'test-key',
    }),
    runtimeHealth: [
      { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: 'ok' },
      { id: 'codex-runtime', label: 'Codex Runtime', status: 'checking', detail: 'Runtime Profile sciforge-runtime-deepseek' },
    ],
  });

  assert.equal(readiness.ok, true);
  assert.equal(readiness.severity, 'info');
  assert.match(readiness.message, /You can send now/);
  assert.doesNotMatch(readiness.message, /Please wait before sending/);
});

test('run readiness still blocks truly offline required runtime services', () => {
  const readiness = runReadiness({
    input: 'hello',
    isSending: false,
    config: updateConfig(defaultSciForgeConfig, {
      locale: 'en-US',
      workspacePath: '/tmp/ws',
      modelProvider: 'openai',
      modelName: 'gpt-5',
      apiKey: 'test-key',
    }),
    runtimeHealth: [
      { id: 'workspace', label: 'Workspace Writer', status: 'offline', detail: 'http://127.0.0.1:5175', recoverAction: 'start workspace server' },
      { id: 'codex-runtime', label: 'Codex Runtime', status: 'checking', detail: 'Runtime Profile sciforge-runtime-deepseek' },
    ],
  });

  assert.equal(readiness.ok, false);
  assert.equal(readiness.severity, 'warning');
  assert.match(readiness.message, /Workspace Writer is not ready/);
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
