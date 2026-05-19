import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AgentStreamEvent } from '../../domain';
import { runningMessageContentFromStream } from './runStatusPresentation';

test('running message uses stable Runtime Codex status for audit-only stderr warnings', () => {
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

  assert.match(content, /Runtime Codex 正在运行/);
  assert.match(content, /等待后端事件/);
  assert.doesNotMatch(content, /Plugin manifest warning|failed to load plugin|\/tmp\/plugin\.json/);
});
