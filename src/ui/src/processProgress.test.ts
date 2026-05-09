import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentStreamEvent } from './domain';
import { buildSilentStreamProgressEvent, formatProgressHeadline, progressModelFromEvent } from './processProgress';

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

test('builds generic waiting progress after 60s without new backend events and keeps last real event', () => {
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'queued', label: '已提交', detail: 'run', createdAt: '2026-05-08T00:00:00.000Z' }),
      event({ type: 'tool-call', label: '读取', detail: '正在读取 /workspace/input/papers.csv', createdAt: '2026-05-08T00:00:10.000Z' }),
    ],
    nowMs: Date.parse('2026-05-08T00:01:11.000Z'),
    backend: 'agentserver',
  });

  const model = silent ? progressModelFromEvent(silent) : undefined;
  assert.equal(model?.phase, 'wait');
  assert.equal(model?.reason, 'backend-waiting');
  assert.equal(model?.waitingFor, '后端返回新事件');
  assert.equal(model?.lastEvent?.label, '读取');
  assert.equal(model?.canAbort, true);
  assert.equal(model?.canContinue, true);
  assert.match(formatProgressHeadline(model) ?? '', /最近 读取/);
});

test('builds generic waiting progress after 60s without any real backend event', () => {
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'queued', label: '已提交', detail: 'run', createdAt: '2026-05-08T00:00:00.000Z' }),
    ],
    nowMs: Date.parse('2026-05-08T00:01:01.000Z'),
  });

  const model = silent ? progressModelFromEvent(silent) : undefined;
  assert.equal(model?.phase, 'wait');
  assert.equal(model?.lastEvent, undefined);
  assert.match(model?.detail ?? '', /尚无可展示的后端事件/);
  assert.match(model?.nextStep ?? '', /中止当前 stream/);
});

test('does not show backend waiting before the silent threshold', () => {
  const silent = buildSilentStreamProgressEvent({
    events: [
      event({ type: 'tool-call', label: '读取', detail: '正在读取 file', createdAt: '2026-05-08T00:00:10.000Z' }),
    ],
    nowMs: Date.parse('2026-05-08T00:01:09.000Z'),
  });

  assert.equal(silent, undefined);
});
