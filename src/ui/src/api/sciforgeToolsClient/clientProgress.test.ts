import test from 'node:test';
import assert from 'node:assert/strict';
import { isBackendProgressEvent } from './client';
import type { AgentStreamEvent } from '../../domain';

test('Runtime Codex heartbeat progress does not reset the real backend progress watchdog', () => {
  const heartbeat = {
    type: 'process-progress',
    label: 'Codex Runtime',
    detail: 'Codex app-server stream 仍然连接；已等待 5s，正在等待下一条 rich-client 事件。',
    raw: {
      type: 'process-progress',
      heartbeat: {
        status: 'waiting-for-codex-app-server-event',
        elapsedMs: 5000,
        quietMs: 5000,
      },
      progress: {
        phase: 'wait',
        status: 'running',
        reason: 'runtime-codex-waiting-for-app-server-event',
        title: 'Codex app-server 正在运行',
      },
    },
  } as AgentStreamEvent;
  const realProgress = {
    type: 'process-progress',
    label: 'BrowserRuntime',
    detail: 'Opened browser reference.',
    raw: {
      type: 'process-progress',
      progress: {
        phase: 'execute',
        status: 'running',
        reason: 'browser-action',
      },
    },
  } as AgentStreamEvent;

  assert.equal(isBackendProgressEvent(heartbeat), false);
  assert.equal(isBackendProgressEvent(realProgress), true);
});
