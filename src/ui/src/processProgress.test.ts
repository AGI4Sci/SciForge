import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentStreamEvent } from './domain';
import { formatProgressHeadline, progressModelFromEvent } from './processProgress';

function event(partial: Partial<AgentStreamEvent>): AgentStreamEvent {
  return {
    id: partial.id ?? `evt-${partial.type ?? 'test'}`,
    type: partial.type ?? 'event',
    label: partial.label ?? partial.type ?? 'event',
    createdAt: partial.createdAt ?? '2026-05-02T00:00:00.000Z',
    ...partial,
  };
}

test('normalizes Python process-progress events into visible work model', () => {
  const progressEvent = event({
    type: 'process-progress',
    label: '过程',
    detail: '正在等待 AgentServer 返回',
    raw: {
      type: 'process-progress',
      progress: {
        phase: 'wait',
        title: '正在等待 AgentServer 返回',
        detail: 'HTTP stream still waiting.',
        reading: ['/workspace/input/papers.csv'],
        writing: ['/workspace/tasks/review.py'],
        waitingFor: 'AgentServer 返回',
        nextStep: '收到新事件后继续执行。',
      },
    },
  });

  const model = progressModelFromEvent(progressEvent);
  assert.equal(model?.phase, 'wait');
  assert.deepEqual(model?.reading, ['/workspace/input/papers.csv']);
  assert.deepEqual(model?.writing, ['/workspace/tasks/review.py']);
  assert.match(formatProgressHeadline(model) ?? '', /下一步 收到新事件后继续执行/);
});
