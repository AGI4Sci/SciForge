import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SciForgeConfig } from '../../domain';
import type { WorkspaceTerminalSession } from '../../api/workspaceClient';
import {
  RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
  rightPaneTerminalOwnerKey,
  stopRightPaneTerminalSessionOnce,
  stopRightPaneTerminalSessionsOnce,
} from './terminalPaneLifecycle';

describe('right pane terminal lifecycle', () => {
  it('stops active terminal sessions once with the close-tab reason', async () => {
    const calls: Array<{ url: string; id: string; reason?: string; workspacePath?: string }> = [];
    const stopping = new Set<string>();
    const stopped = stopRightPaneTerminalSessionOnce({
      config: testConfig(),
      session: terminalSession('terminal-1', 'running'),
      reason: RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
      stoppingSessionIds: stopping,
      stopSession: async (config, id, input) => {
        assert.ok(input);
        calls.push({ url: config.workspaceWriterBaseUrl, id, reason: input?.reason, workspacePath: input?.workspacePath });
        return terminalSession(id, 'cancelled');
      },
    });

    assert.equal(stopped, true);
    await Promise.resolve();
    assert.deepEqual(calls, [{
      url: 'http://127.0.0.1:6173',
      id: 'terminal-1',
      reason: RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
      workspacePath: '/tmp/sciforge',
    }]);
  });

  it('does not stop inactive terminal sessions', () => {
    let count = 0;
    for (const status of ['idle', 'failed', 'cancelled'] as const) {
      stopRightPaneTerminalSessionOnce({
        config: testConfig(),
        session: terminalSession(`terminal-${status}`, status),
        reason: RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
        stoppingSessionIds: new Set(),
        stopSession: async () => {
          count += 1;
          return terminalSession('unused', 'cancelled');
        },
      });
    }
    assert.equal(count, 0);
  });

  it('dedupes duplicate tab mappings and honors session writer override', async () => {
    const calls: string[] = [];
    const config = testConfig();
    const shared = {
      ...terminalSession('shared-terminal', 'running'),
      workspaceWriterBaseUrl: 'http://127.0.0.1:7000',
    };
    const count = stopRightPaneTerminalSessionsOnce({
      config,
      sessionsByTabId: {
        first: shared,
        second: shared,
      },
      reason: RIGHT_PANE_TERMINAL_TAB_CLOSE_STOP_REASON,
      stoppingSessionIds: new Set(),
      stopSession: async (nextConfig, id) => {
        calls.push(`${nextConfig.workspaceWriterBaseUrl}:${id}`);
        return terminalSession(id, 'cancelled');
      },
    });

    assert.equal(count, 1);
    await Promise.resolve();
    assert.deepEqual(calls, ['http://127.0.0.1:7000:shared-terminal']);
  });

  it('keys terminal ownership by writer, workspace, and session id', () => {
    const first = rightPaneTerminalOwnerKey(testConfig(), 'session-a');
    const second = rightPaneTerminalOwnerKey({ ...testConfig(), workspaceWriterBaseUrl: 'http://127.0.0.1:7000/' }, 'session-a');
    const third = rightPaneTerminalOwnerKey({ ...testConfig(), workspacePath: '/tmp/other' }, 'session-a');

    assert.notEqual(first, second);
    assert.notEqual(first, third);
  });
});

function testConfig(): SciForgeConfig {
  return {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: 'http://127.0.0.1:6173',
    workspacePath: '/tmp/sciforge',
    agentBackend: 'codex',
    modelProvider: 'openai',
    modelBaseUrl: '',
    modelName: 'test-model',
    apiKey: '',
    requestTimeoutMs: 30000,
    maxContextWindowTokens: 128000,
    visionAllowSharedSystemInput: false,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function terminalSession(id: string, status: WorkspaceTerminalSession['status']): WorkspaceTerminalSession {
  return {
    schemaVersion: 1,
    id,
    status,
    workspacePath: '/tmp/sciforge',
    cwd: '/tmp/sciforge',
    shell: '/bin/zsh',
    transcriptRef: `terminal-transcript:${id}`,
    startedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    webSocketPath: `/api/sciforge/terminal/sessions/${id}/ws`,
  };
}
